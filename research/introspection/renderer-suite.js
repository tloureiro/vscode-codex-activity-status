'use strict';
// Final bounded feasibility gate. No debugger attachment, DOM scripts, or target callbacks.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const inspector = require('node:inspector');
const { performance } = require('node:perf_hooks');
const vscode = require('vscode');
const { SnapshotReader, BUNDLE_SHA } = require('./reader');

const CONTEXT_CAPABILITIES = `({
  hasDocument: typeof document !== 'undefined',
  hasWindow: typeof window !== 'undefined',
  processType: typeof process === 'object' ? process.type : null
})`;

async function visibleInspectorContexts() {
  const session = new inspector.Session();
  const contexts = new Map();
  // The listener belongs to our inspector session, not any Codex object.
  const collect = ({ params }) => contexts.set(params.context.id, params.context);
  const post = (method, params = {}) =>
    new Promise((resolve, reject) => {
      session.post(method, params, (error, result) => (error ? reject(error) : resolve(result)));
    });
  session.on('Runtime.executionContextCreated', collect);
  session.connect();
  try {
    await post('Runtime.enable');
    const result = [];
    assert.ok(contexts.size > 0 && contexts.size <= 8, 'Bounded context list');
    for (const [id] of contexts) {
      const evaluation = await post('Runtime.evaluate', {
        expression: CONTEXT_CAPABILITIES,
        contextId: id,
        returnByValue: true,
        throwOnSideEffect: true,
        silent: true,
        objectGroup: 'renderer-gate-contexts',
      });
      assert.equal(
        evaluation.exceptionDetails,
        undefined,
        'Read-only context capability expression',
      );
      result.push(evaluation.result.value);
    }
    return result;
  } finally {
    try {
      await post('Runtime.disable');
    } finally {
      await post('Runtime.releaseObjectGroup', { objectGroup: 'renderer-gate-contexts' });
      session.disconnect();
      session.removeListener('Runtime.executionContextCreated', collect);
    }
  }
}

class RendererBridgeReader extends SnapshotReader {
  async describe(extension) {
    assert.equal(extension.packageJSON.version, this.version);
    const main = fs.realpathSync(path.join(extension.extensionPath, 'out', 'extension.js'));
    assert.equal(
      crypto.createHash('sha256').update(fs.readFileSync(main)).digest('hex'),
      BUNDLE_SHA,
    );
    assert.ok(require.cache[main], 'Already loaded in this host');
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
      const activation = await this.closureValues(cleanup, ['$e']);
      const provider = await this.fields(activation.get('$e'));
      const sidebar = provider.get('sidebarView');
      const summary = {
        sidebarPresent: !!sidebar?.objectId,
        sidebarWebviewReady: provider.get('sidebarWebviewReady')?.value === true,
        threadStoreOwnDataFieldPresent: provider.has('threadStore'),
        calls: 0,
      };
      if (!sidebar?.objectId) return summary;
      const description = await this.properties(sidebar);
      summary.sidebarPrivateNames = (description.privateProperties || []).map(
        (entry) => entry.name,
      );
      // Packaged VS Code minifies private field names. Identify the one direct
      // wrapper field by its data descriptors, without invoking `webview`.
      const candidates = [
        ...description.result.filter((entry) => entry.name === 'webview'),
        ...(description.privateProperties || []),
      ].filter(
        (entry) => entry.value?.objectId && entry.value.type === 'object' && !entry.value.subtype,
      );
      assert.ok(candidates.length <= 16, 'Bounded direct private-field inspection');
      let webview;
      for (const candidate of candidates) {
        const fields = await this.fields(candidate.value);
        if (fields.has('_onMessageEmitter') && fields.has('onDidReceiveMessage')) {
          webview = candidate.value;
          summary.webviewPrivateFieldName = candidate.name;
          break;
        }
      }
      summary.webviewReferenceFound = !!webview?.objectId;
      if (!webview?.objectId) return summary;
      const webviewProperties = await this.properties(webview);
      summary.webviewOwnDataNames = webviewProperties.result
        .filter((entry) => entry.value)
        .map((entry) => entry.name);
      summary.webviewPrivateNames = (webviewProperties.privateProperties || []).map(
        (entry) => entry.name,
      );
      summary.threadStoreOwnDataFieldPresent ||= webviewProperties.result.some(
        (entry) => entry.name === 'threadStore' && entry.value,
      );
      summary.calls = this.calls;
      return summary;
    } finally {
      await new Promise((resolve) => {
        try {
          this.session.post('Runtime.releaseObjectGroup', { objectGroup: this.group }, () =>
            resolve(),
          );
        } catch {
          resolve();
        }
      });
      this.session.disconnect();
    }
  }
}

async function run() {
  const root = process.env.CODEX_SNAPSHOT_TEST_ROOT;
  assert.ok(root);
  assert.equal(vscode.version, '1.143.1');
  assert.equal(
    fs.realpathSync(process.env.CODEX_HOME),
    fs.realpathSync(path.join(root, 'codex-home')),
  );
  const result = {
    scope:
      'final renderer-access feasibility gate; disposable unsigned-in profile; no model requests',
    vscode: vscode.version,
    node: process.version,
    startedAt: new Date().toISOString(),
    inspectorPortBefore: inspector.url() ?? null,
    targetFunctionsInvokedByReader: false,
    targetListenersRegisteredByReader: false,
    rendererScriptsInjected: false,
    rendererDebuggerAttached: false,
  };
  try {
    const extension = vscode.extensions.getExtension('openai.chatgpt');
    assert.ok(extension);
    await extension.activate();
    const reader = new RendererBridgeReader({ selectiveScopes: true });
    result.beforeOpen = {
      contexts: await visibleInspectorContexts(),
      bridge: await reader.describe(extension),
    };
    // Normal UI action by the test driver only, not an introspection call.
    let deadline;
    try {
      await Promise.race([
        vscode.commands.executeCommand('chatgpt.openSidebar'),
        new Promise((_resolve, reject) => {
          deadline = setTimeout(() => reject(new Error('Sidebar open exceeded 15 seconds')), 15000);
        }),
      ]);
    } finally {
      clearTimeout(deadline);
    }
    let bridge;
    for (let attempt = 0; attempt < 20; attempt++) {
      bridge = await reader.describe(extension);
      if (bridge.sidebarWebviewReady) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    result.afterOpen = {
      contexts: await visibleInspectorContexts(),
      bridge,
    };
    assert.ok(bridge.sidebarPresent, 'Real official sidebar was created');
    assert.ok(bridge.sidebarWebviewReady, 'Official sidebar renderer reported ready');
    assert.ok(bridge.webviewReferenceFound, 'Inspected existing host-side webview wrapper');
    const rendererContextVisible = result.afterOpen.contexts.some(
      (context) => context.hasDocument && context.hasWindow,
    );
    result.rendererContextVisible = rendererContextVisible;
    result.directThreadStoreFieldVisible = bridge.threadStoreOwnDataFieldPresent;
    result.compliantRendererAccessDemonstrated = false;
    result.gateDecision =
      rendererContextVisible || bridge.threadStoreOwnDataFieldPresent
        ? 'unresolved-candidate-found-stop-without-expanding-scope'
        : 'no-go-for-full-fidelity-under-current-boundary';
    result.inspectorPortAfter = inspector.url() ?? null;
    assert.equal(result.inspectorPortAfter, result.inspectorPortBefore);
    result.probeCompleted = true;
  } catch (error) {
    result.probeCompleted = false;
    result.error = error.message;
    throw error;
  } finally {
    result.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  }
}

module.exports = { run };
