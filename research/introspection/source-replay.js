'use strict';
// Executes copied handler definitions in an owned VM fixture, never in Codex.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const { BUNDLE_SHA } = require('./reader');

function definitions(source) {
  const classes = new Map();
  const functions = new Map();
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'ClassExpression') return;
    if (node.type === 'VariableDeclarator' && ['$1', 'H1'].includes(node.id?.name))
      classes.set(node.id.name, node.init);
    if (node.type === 'AssignmentExpression' && ['f_', 'Zx'].includes(node.left?.name))
      classes.set(node.left.name, node.right);
    if (
      node.type === 'FunctionDeclaration' &&
      ['VPt', 'lz', 'dm', 'Vk', 'jx', 'zk', 'lm'].includes(node.id?.name)
    )
      functions.set(node.id.name, node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(ast);
  assert.equal(classes.size, 4, 'Pinned class definitions found');
  assert.equal(functions.size, 7, 'Pinned helper definitions found');
  return { classes, functions };
}

function replay(project = path.resolve(__dirname, '..', '..')) {
  const manifest = JSON.parse(fs.readFileSync(path.join(project, 'sources', 'manifest.json')));
  const source = fs.readFileSync(
    path.join(project, 'sources', 'codex-extension', 'out', 'extension.js'),
    'utf8',
  );
  assert.equal(crypto.createHash('sha256').update(source).digest('hex'), BUNDLE_SHA);
  const { classes, functions } = definitions(source);
  const sandbox = {
    I0e: new WeakSet(),
    Map,
    Set,
    Date,
    process: { env: {} },
    // Only narrow input-shape validation is stubbed; tested payloads use these shapes.
    KRt: {
      safeParse(value) {
        const turn =
          value?.turn ||
          (typeof value?.turnId === 'string' ? { id: value.turnId, status: value.status } : null);
        return turn && typeof turn.id === 'string'
          ? { success: true, data: { id: turn.id, status: turn.status ?? null } }
          : { success: false };
      },
    },
    eM: 90000,
  };
  const context = vm.createContext(sandbox);
  for (const [name, node] of functions)
    vm.runInContext(`${source.slice(node.start, node.end)};`, context, {
      timeout: 1000,
      filename: `copied-${name}.js`,
    });
  function method(className, methodName) {
    const node = classes
      .get(className)
      .body.body.find(
        (entry) => entry.type === 'MethodDefinition' && entry.key.name === methodName,
      );
    assert.ok(node, `Pinned method ${className}.${methodName}`);
    return source.slice(node.start, node.end);
  }
  const methodNames = {
    connection: [
      'routeIncomingMessage',
      'isMcpResponseMessage',
      'isMcpRequestMessage',
      'isMcpNotificationMessage',
    ],
    lifecycle: ['handleMcpNotification', 'extractConversationId', 'updateConversationStatus'],
    questions: [
      'observeServerRequest',
      'observeServerNotification',
      'removePendingRequest',
      'stopTrackingRequest',
    ],
  };
  const trackerNode = classes.get('f_');
  vm.runInContext(`var Tracker = ${source.slice(trackerNode.start, trackerNode.end)};`, context, {
    timeout: 1000,
  });
  const build = (name, className) =>
    vm.runInContext(
      `({${methodNames[name].map((key) => method(className, key)).join(',')}})`,
      context,
      { timeout: 1000 },
    );
  const fixture = () => {
    const tracker = vm.runInContext('new Tracker(true)', context, { timeout: 1000 });
    const lifecycle = Object.assign(build('lifecycle', '$1'), {
      lifecycleByConversationId: new Map(),
      onDidChangeChatSessionItemsEmitter: { fire() {} },
    });
    const questions = Object.assign(build('questions', 'Zx'), {
      pendingRequestByConversationId: new Map(),
      conversationIdByRequestId: new Map(),
    });
    const connection = Object.assign(build('connection', 'H1'), {
      pendingRequests: new Map(),
      pendingTurnStartRequestIds: new Set(),
      pendingPrewarmedThreadStartRequestIds: new Set(),
      turnCwds: tracker,
      requestUserInputAutoResolutionCoordinator: questions,
      providers: new Map([
        ['view', { onNotification: lifecycle.handleMcpNotification.bind(lifecycle) }],
      ]),
      // Reproduces the installed cache-invalidation callback's tracker call.
      internalNotificationHandlers: new Set([
        (event) => {
          if (event.method === 'turn/completed') tracker.takeCompleted(event.params);
        },
      ]),
      ephemeralThreadTimeouts: new Map(),
      prewarmedThreads: { suppressThreadStarted: () => false },
      logger: { warning() {}, error() {} },
    });
    const snapshot = () => ({
      started: [...tracker.startedByTurnId].map(([key, value]) => [key, value.threadId]),
      approvals: [...tracker.approvalThreadIdByRequestId],
      lifecycle: [...lifecycle.lifecycleByConversationId],
      questions: [...questions.pendingRequestByConversationId],
    });
    // Owned fixture driver: these calls are not made against a running extension.
    const deliver = (message) => connection.routeIncomingMessage(message);
    const start = () => {
      tracker.track(
        { threadId: 'thread', cwd: '/synthetic', permissions: ':workspace' },
        'view:start',
      );
      connection.pendingTurnStartRequestIds.add('view:start');
      deliver({ id: 'view:start', result: { turn: { id: 'turn', status: 'inProgress' } } });
      deliver({
        method: 'turn/started',
        params: { threadId: 'thread', turn: { id: 'turn', status: 'inProgress' } },
      });
    };
    return { tracker, lifecycle, snapshot, deliver, start };
  };
  const result = {
    codexExtensionVersion: manifest.codexExtension.version,
    bundleSha256: BUNDLE_SHA,
    scope: 'exact copied handlers in owned VM; no live traffic, model calls, or Codex attachment',
    dependencies: {
      exact: [
        ...functions.keys(),
        'f_ class',
        ...Object.entries(methodNames).flatMap(([key, names]) =>
          names.map((name) => `${key}.${name}`),
        ),
      ],
      fixture: [
        'KRt shape validator for controlled payloads',
        'maps/emitters/provider container',
        'cache-invalidation callback tracker call',
      ],
    },
    findings: [],
  };
  const blocked = fixture();
  blocked.start();
  const running = JSON.stringify(blocked.snapshot());
  blocked.deliver({
    id: 77,
    method: 'item/tool/requestUserInput',
    params: { threadId: 'thread', turnId: 'turn', isBlocking: true, questions: [] },
  });
  blocked.deliver({
    method: 'thread/status/changed',
    params: { threadId: 'thread', status: { type: 'active', activeFlags: ['waitingOnUserInput'] } },
  });
  assert.equal(JSON.stringify(blocked.snapshot()), running);
  result.findings.push({ case: 'blocking-input', sameRetainedProjectionAsRunning: true });
  const approval = fixture();
  approval.start();
  approval.deliver({
    id: 88,
    method: 'item/commandExecution/requestApproval',
    params: { threadId: 'thread', turnId: 'turn' },
  });
  assert.equal(approval.snapshot().approvals.length, 1);
  approval.deliver({
    method: 'serverRequest/resolved',
    params: { threadId: 'thread', requestId: 88 },
  });
  assert.equal(approval.snapshot().approvals.length, 1);
  approval.deliver({
    method: 'turn/completed',
    params: { threadId: 'thread', turn: { id: 'turn', status: 'completed' } },
  });
  assert.equal(approval.snapshot().started.length, 0);
  assert.equal(approval.snapshot().approvals.length, 1);
  approval.tracker.observeClientResponse({ id: 88, result: { decision: 'accept' } });
  assert.equal(approval.snapshot().approvals.length, 0);
  result.findings.push({
    case: 'approval-resolution',
    serverResolutionLeavesEntry: true,
    completionLeavesEntry: true,
    clientResponseRemovesEntry: true,
  });
  const terminals = [];
  for (const status of ['completed', 'failed', 'interrupted']) {
    const current = fixture();
    current.start();
    current.deliver({
      method: 'turn/completed',
      params: {
        threadId: 'thread',
        turn: {
          id: 'turn',
          status,
          error: status === 'failed' ? { message: 'synthetic failure' } : null,
        },
      },
    });
    terminals.push(JSON.stringify(current.snapshot()));
  }
  assert.equal(new Set(terminals).size, 1);
  result.findings.push({
    case: 'v2-terminal-outcomes',
    completedFailedInterruptedHaveSameRetainedProjection: true,
  });
  const legacy = fixture();
  for (const method of ['codex/event/error', 'codex/event/task_complete'])
    legacy.deliver({ method, params: { conversationId: 'thread' } });
  assert.equal(legacy.lifecycle.lifecycleByConversationId.get('thread').status, 1);
  result.findings.push({
    case: 'legacy-outcome',
    errorFollowedByTaskCompleteEndsAsCompleted: true,
  });
  const rendererAsset = 'src-622b307a9baf.js';
  const rendererSha = 'e4a82a9ee669473490d25c1f2b6f7b60abc4a1b193acb1f9c0a92e074dc81eb5';
  const renderer = fs.readFileSync(
    path.join(manifest.codexExtension.installedPath, 'webview', 'assets', rendererAsset),
    'utf8',
  );
  assert.equal(crypto.createHash('sha256').update(renderer).digest('hex'), rendererSha);
  const rendererAst = acorn.parse(renderer, { ecmaVersion: 'latest', sourceType: 'module' });
  const handler = rendererAst.body.find(
    (node) => node.type === 'FunctionDeclaration' && node.id.name === 'Dh',
  );
  assert.ok(handler, 'Pinned renderer status handler found');
  const rendererContext = vm.createContext({ W: (value) => value });
  const statusHandler = vm.runInContext(
    `(${renderer.slice(handler.start, handler.end)})`,
    rendererContext,
    { timeout: 1000 },
  );
  const conversation = { id: 'thread', threadRuntimeStatus: null };
  const evidence = [];
  const argumentsFixture = {
    manager: { updateConversationState: (_id, update) => update(conversation) },
    notificationContext: {
      threadStore: {
        conversations: new Map([['thread', conversation]]),
        recordThreadRuntimeStatusEvidence: (_id, status) => evidence.push(status),
      },
    },
  };
  for (const status of [
    { type: 'active', activeFlags: [] },
    { type: 'active', activeFlags: ['waitingOnUserInput'] },
    { type: 'active', activeFlags: ['waitingOnApproval'] },
    { type: 'idle' },
    { type: 'systemError' },
    { type: 'notLoaded' },
  ]) {
    statusHandler(argumentsFixture, {
      method: 'thread/status/changed',
      params: { threadId: 'thread', status },
    });
    assert.deepEqual(conversation.threadRuntimeStatus, status);
  }
  result.renderer = {
    asset: rendererAsset,
    sha256: rendererSha,
    exactHandler: 'Dh',
    fixtureDependencies: ['identity thread-ID conversion', 'owned store/update functions'],
    retainedRuntimeStatuses: evidence,
    liveRendererAccessProved: false,
  };
  result.passed = true;
  return result;
}

if (require.main === module) {
  try {
    const result = replay();
    const target = path.resolve(__dirname, '../../sources/analysis/source-replay-result.json');
    fs.writeFileSync(target, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

module.exports = { replay };
