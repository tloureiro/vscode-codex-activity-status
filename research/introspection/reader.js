'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const inspector = require('node:inspector');
const { performance } = require('node:perf_hooks');

const BUNDLE_SHA = 'a9cc6736cd2c2d22f6cf43fc5763d5f8a873e4f741f522b44a600b1926f4e627';
const VERSION = '26.1021.22027';
const ALLOWED = new Set([
  'Runtime.evaluate',
  'Runtime.getProperties',
  'Runtime.releaseObjectGroup',
]);
// This function runs on an inspector-created scope wrapper, not a Codex object.
// It reads data descriptors and writes only a newly allocated projection.
const SCOPE_PROJECTION = `function () {
  const wrapper = Object.getOwnPropertyDescriptor(this, 'object');
  const scope = wrapper && wrapper.value;
  if (!scope) return {};
  return {
    DX: Object.getOwnPropertyDescriptor(scope, 'DX')?.value,
    v: Object.getOwnPropertyDescriptor(scope, 'v')?.value,
    e: Object.getOwnPropertyDescriptor(scope, 'e')?.value,
    $e: Object.getOwnPropertyDescriptor(scope, '$e')?.value
  };
}`;

class SnapshotReader {
  constructor({ version = VERSION, bundleSha = BUNDLE_SHA, selectiveScopes = false } = {}) {
    this.version = version;
    this.bundleSha = bundleSha;
    this.selectiveScopes = selectiveScopes;
    this.session = new inspector.Session();
    this.group = `codex-snapshot-${crypto.randomUUID()}`;
    this.calls = 0;
    this.methods = new Set();
  }
  post(method, params) {
    const projection =
      this.selectiveScopes &&
      method === 'Runtime.callFunctionOn' &&
      params?.functionDeclaration === SCOPE_PROJECTION &&
      params.throwOnSideEffect === true &&
      params.arguments?.length === 0;
    if (!ALLOWED.has(method) && !projection)
      throw new Error(`Inspector operation excluded: ${method}`);
    if (++this.calls > 160 || performance.now() - this.started > 2000)
      throw new Error('Inspection budget exceeded');
    this.methods.add(method);
    // Inspector callbacks are often synchronous. Yield between descriptor reads
    // so repeated Promise continuations do not monopolize the extension host.
    return new Promise((resolve, reject) => {
      setImmediate(() => {
        if (performance.now() - this.started > 2000) {
          reject(new Error('Inspection budget exceeded'));
          return;
        }
        try {
          this.session.post(method, params, (error, result) => {
            if (error) reject(error);
            else if (result.exceptionDetails) reject(new Error('Inspector expression failed'));
            else resolve(result);
          });
        } catch (error) {
          reject(error);
        }
      });
    });
  }
  properties(object, nonIndexedPropertiesOnly = false) {
    if (!object?.objectId) throw new Error('Expected retained object');
    return this.post('Runtime.getProperties', {
      objectId: object.objectId,
      ownProperties: true,
      generatePreview: false,
      nonIndexedPropertiesOnly,
    });
  }
  async fields(object) {
    const { result } = await this.properties(object);
    // Accessor descriptors deliberately have no value and are never invoked.
    return new Map(result.filter((entry) => entry.value).map((entry) => [entry.name, entry.value]));
  }
  async closureValues(fn, wanted) {
    const details = await this.properties(fn);
    const scopes = details.internalProperties?.find((entry) => entry.name === '[[Scopes]]')?.value;
    if (!scopes) throw new Error('Function scope descriptors unavailable');
    const list = await this.fields(scopes);
    const values = new Map();
    for (const [index, scope] of list) {
      if (!/^\d+$/.test(index) || !scope.description?.startsWith('Closure')) continue;
      if (+index > 8) throw new Error('Unexpected scope depth');
      let entries;
      if (this.selectiveScopes) {
        const projection = await this.post('Runtime.callFunctionOn', {
          objectId: scope.objectId,
          functionDeclaration: SCOPE_PROJECTION,
          arguments: [],
          objectGroup: this.group,
          silent: true,
          throwOnSideEffect: true,
        });
        entries = await this.fields(projection.result);
      } else entries = await this.fields(scope);
      for (const [name, value] of entries)
        if (!values.has(name) && value.type !== 'undefined') values.set(name, value);
      if (wanted.every((name) => values.has(name))) break;
    }
    return values;
  }
  async cleanupFromExports(exports) {
    let object = exports;
    // esbuild uses two getter layers. Inspect their scopes; never call them.
    for (let depth = 0; depth < 4; depth++) {
      const descriptor = (await this.properties(object)).result.find(
        (entry) => entry.name === 'deactivate',
      );
      const fn = descriptor?.get || descriptor?.value;
      if (fn?.type !== 'function') throw new Error('Expected deactivate function descriptor');
      const scope = await this.closureValues(fn, ['DX']);
      if (scope.get('DX')?.type === 'function') return scope.get('DX');
      object = scope.get('e');
      if (!object?.objectId) throw new Error('Pinned export closure layout changed');
    }
    throw new Error('Cleanup closure not found');
  }
  async collection(object, kind = 'Map') {
    const size = new RegExp(`^${kind}\\((\\d+)\\)`).exec(object?.description || '');
    if (!size || +size[1] > 128) throw new Error(`Unsupported or oversized ${kind}`);
    const details = await this.properties(object);
    const entries = details.internalProperties?.find(
      (entry) => entry.name === '[[Entries]]',
    )?.value;
    if (!entries && +size[1] === 0) return [];
    const list = await this.fields(entries);
    const result = [];
    for (const [index, entry] of list) {
      if (!/^\d+$/.test(index)) continue;
      result.push(await this.fields(entry));
    }
    return result;
  }
  async mapValues(object, fieldNames, identity) {
    const result = [];
    for (const entry of await this.collection(object)) {
      const fields = await this.fields(entry.get('value'));
      const row = Object.fromEntries(
        fieldNames.map((key) => [key, fields.get(key)?.value ?? null]),
      );
      if (identity) row[identity] = entry.get('key')?.value ?? null;
      result.push(row);
    }
    return result;
  }
  async read(extension) {
    if (this.busy) throw new Error('Concurrent inspection is excluded');
    this.busy = true;
    try {
      return await this.readOnce(extension);
    } finally {
      this.busy = false;
    }
  }
  async readOnce(extension) {
    if (extension.packageJSON.version !== this.version) throw new Error('Unverified Codex version');
    const main = fs.realpathSync(
      require('node:path').join(extension.extensionPath, 'out', 'extension.js'),
    );
    if (crypto.createHash('sha256').update(fs.readFileSync(main)).digest('hex') !== this.bundleSha)
      throw new Error('Unverified Codex bundle hash');
    if (!require.cache[main]) throw new Error('Codex is not loaded in this extension host');
    this.calls = 0;
    this.started = performance.now();
    this.session.connect();
    try {
      const { result: exports } = await this.post('Runtime.evaluate', {
        expression: `process.getBuiltinModule('module')._cache[${JSON.stringify(main)}].exports`,
        objectGroup: this.group,
        silent: true,
      });
      const cleanup = await this.cleanupFromExports(exports);
      const activation = await this.closureValues(cleanup, ['v']);
      const connection = await this.fields(activation.get('v'));
      if (!connection.has('providers') || !connection.has('internalNotificationHandlers'))
        throw new Error('Pinned connection layout changed');
      const tracker = await this.fields(connection.get('turnCwds'));
      const activeTurns = await this.mapValues(
        tracker.get('startedByTurnId'),
        ['threadId'],
        'turnKey',
      );
      const pendingTurns = await this.mapValues(tracker.get('pendingByStartId'), ['threadId']);
      const approvals = (await this.collection(tracker.get('approvalThreadIdByRequestId'))).map(
        (entry) => ({ threadId: entry.get('value')?.value ?? null }),
      );
      const providers = await this.collection(connection.get('providers'));
      const observer = providers.find(
        (entry) => entry.get('key')?.value === 'codex.chatSessionObserver',
      );
      let provider;
      if (observer) {
        const boundCallback = (await this.fields(observer.get('value'))).get('onNotification');
        provider = (await this.properties(boundCallback)).internalProperties?.find(
          (entry) => entry.name === '[[BoundThis]]',
        )?.value;
      }
      const lifecycle = provider?.objectId
        ? await this.mapValues(
            (await this.fields(provider)).get('lifecycleByConversationId'),
            ['status', 'startTime', 'endTime'],
            'threadId',
          )
        : null;
      const coordinator = await this.fields(
        connection.get('requestUserInputAutoResolutionCoordinator'),
      );
      const nonblockingQuestions = await this.collection(
        coordinator.get('pendingRequestByConversationId'),
      );
      const result = {
        available: true,
        initialized: connection.get('initialized')?.value,
        activeTurns,
        pendingTurns,
        approvals,
        lifecycle,
        autoResolvableQuestions: nonblockingQuestions.length,
        blockingInputCoverage: false,
        providerCount: providers.length,
        internalHandlerCount: (
          await this.collection(connection.get('internalNotificationHandlers'), 'Set')
        ).length,
        elapsedMs: Math.round((performance.now() - this.started) * 100) / 100,
        calls: this.calls,
      };
      return result;
    } finally {
      // Cleanup must run even when the normal inspection budget has expired.
      await new Promise((resolve) => {
        try {
          this.session.post('Runtime.releaseObjectGroup', { objectGroup: this.group }, () =>
            resolve(),
          );
        } catch {
          resolve();
        }
      });
      this.methods.add('Runtime.releaseObjectGroup');
      this.session.disconnect();
    }
  }
}

module.exports = { SnapshotReader, VERSION, BUNDLE_SHA };
