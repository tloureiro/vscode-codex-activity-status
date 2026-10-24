'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ProjectHooks, runtimeRoot, IGNORE } = require('../src/project-hooks');
const { emit, MAX_INPUT } = require('../src/activity-helper');
const { ActivityState, STALE_MS } = require('../src/activity-state');
const { ActivityEvents } = require('../src/activity-events');
const { html, presentation, ActivityView } = require('../src/activity-view');
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-activity-test-')));
  const project = path.join(root, "project's space");
  const home = path.join(root, 'codex-home');
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  const hooks = new ProjectHooks(project, path.resolve(__dirname, '..'), { tmp: root });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, project, home, hooks };
}
function input(project, overrides = {}) {
  return {
    hook_event_name: 'UserPromptSubmit',
    cwd: project,
    session_id: 'session',
    turn_id: 'turn',
    ...overrides,
  };
}
function signal(overrides = {}) {
  return {
    sessionId: 'session',
    turnId: 'turn',
    event: 'UserPromptSubmit',
    at: 1000,
    ...overrides,
  };
}

test('installation is planned without writes, ignored by default, and removed without touching unrelated files', (t) => {
  const { hooks, project } = fixture(t);
  assert.equal(hooks.status().code, 'setup');
  const plan = hooks.plan(process.execPath);
  assert.equal(fs.existsSync(hooks.codex), false);
  const manifest = hooks.install(plan);
  assert.equal(hooks.status().code, 'installed');
  assert.ok(fs.readFileSync(hooks.ignoreFile, 'utf8').includes(IGNORE));
  const config = JSON.parse(fs.readFileSync(hooks.hooksFile));
  assert.equal(Object.keys(config.hooks).length, 7);
  for (const groups of Object.values(config.hooks)) {
    assert.equal(groups[0].hooks[0].async, true);
    assert.equal(groups[0].hooks[0].timeout, 1);
  }
  fs.writeFileSync(
    path.join(manifest.root, 'receiver-0000.json'),
    JSON.stringify({ project, expiresAt: Date.now() + 10000 }),
    { mode: 0o600 },
  );
  const run = spawnSync('/bin/sh', ['-c', config.hooks.UserPromptSubmit[0].hooks[0].command], {
    input: JSON.stringify(input(project)),
    encoding: 'utf8',
  });
  assert.equal(run.status, 0);
  assert.equal(run.stdout, '');
  assert.equal(run.stderr, '');
  assert.equal(fs.readdirSync(manifest.root).filter((name) => name.startsWith('event-')).length, 1);
  fs.writeFileSync(path.join(hooks.directory, 'personal.txt'), 'keep');
  hooks.remove();
  assert.equal(fs.existsSync(hooks.hooksFile), false);
  assert.equal(fs.readFileSync(path.join(hooks.directory, 'personal.txt'), 'utf8'), 'keep');
  assert.equal(fs.existsSync(hooks.ignoreFile), true);
});

test('installer preserves existing hooks, edited helpers, and files changed during confirmation', (t) => {
  const { hooks } = fixture(t);
  fs.mkdirSync(hooks.codex);
  fs.writeFileSync(hooks.hooksFile, '{"hooks":{"Stop":[{"hooks":[{"command":"keep me"}]}]}}');
  const original = fs.readFileSync(hooks.hooksFile, 'utf8');
  assert.throws(() => hooks.plan(process.execPath), /already has/);
  assert.equal(fs.readFileSync(hooks.hooksFile, 'utf8'), original);
  fs.unlinkSync(hooks.hooksFile);
  const plan = hooks.plan(process.execPath);
  fs.writeFileSync(hooks.ignoreFile, 'changed during review\n');
  assert.throws(() => hooks.install(plan), /changed during confirmation/);
  hooks.install(hooks.plan(process.execPath));
  fs.appendFileSync(path.join(hooks.directory, 'observer.js'), '\n// personal edit\n');
  assert.equal(hooks.status().code, 'conflict');
  assert.throws(() => hooks.remove(), /edited or unrecognized/);
  assert.equal(fs.existsSync(hooks.hooksFile), true);
});

test('symlinked project paths and unsafe runtime storage are refused', (t) => {
  const { root, project, hooks } = fixture(t);
  const other = path.join(root, 'other');
  fs.mkdirSync(other);
  fs.symlinkSync(other, hooks.codex);
  assert.equal(hooks.status().code, 'conflict');
  assert.throws(() => hooks.plan(process.execPath), /ordinary directories/);
  assert.deepEqual(fs.readdirSync(other), []);
  const storage = runtimeRoot(project, root);
  fs.chmodSync(storage, 0o755);
  assert.equal(emit(JSON.stringify(input(project)), { schema: 1, project, root: storage }), false);
  assert.throws(() => runtimeRoot(project, root), /Unsafe/);
});

test('helper keeps only metadata, fails open without a receiver, and rejects oversized or foreign input', (t) => {
  const { hooks, project } = fixture(t);
  const manifest = hooks.install(hooks.plan(process.execPath));
  const config = JSON.parse(fs.readFileSync(path.join(hooks.directory, 'observer-config.json')));
  assert.equal(emit(JSON.stringify(input(project)), config), false);
  fs.writeFileSync(
    path.join(manifest.root, 'receiver-aaaa.json'),
    JSON.stringify({ project, expiresAt: Date.now() + 10000 }),
    { mode: 0o600 },
  );
  assert.equal(
    emit(
      JSON.stringify(
        input(project, {
          prompt: 'PRIVATE PROMPT',
          last_assistant_message: 'PRIVATE RESPONSE',
          tool_input: { command: 'PRIVATE COMMAND' },
        }),
      ),
      config,
    ),
    true,
  );
  const event = fs.readdirSync(manifest.root).find((name) => name.startsWith('event-'));
  const data = fs.readFileSync(path.join(manifest.root, event), 'utf8');
  assert.doesNotMatch(data, /PRIVATE|prompt|tool_input|assistant/);
  assert.equal(fs.statSync(path.join(manifest.root, event)).mode & 0o777, 0o600);
  assert.equal(emit(JSON.stringify(input(path.dirname(project))), config), false);
  assert.equal(emit('x'.repeat(MAX_INPUT + 1), config), false);
  const command = JSON.parse(fs.readFileSync(hooks.hooksFile)).hooks.Stop[0].hooks[0].command;
  fs.unlinkSync(path.join(hooks.directory, 'observer.js'));
  const missing = spawnSync('/bin/sh', ['-c', command], { input: '{}', encoding: 'utf8' });
  assert.equal(missing.status, 0);
  assert.equal(missing.stdout, '');
  assert.equal(missing.stderr, '');
});

test('state confirms outcomes, preserves unread state across reload, ignores late events and expires stale signals', () => {
  const state = new ActivityState();
  state.accept(signal());
  assert.equal(state.summary(1000).state, 'working');
  state.accept(signal({ event: 'PermissionRequest', at: 1010 }));
  assert.equal(state.summary(1010).state, 'attention');
  state.accept(signal({ event: 'Stop', at: 1020 }));
  assert.equal(state.summary(1020).state, 'checking');
  assert.equal(state.summary(1020 + STALE_MS).state, 'unknown');
  state.terminal('session', { type: 'task_complete', turn_id: 'turn' }, 1030);
  state.accept(signal({ event: 'PermissionRequest', at: 2000 }));
  assert.equal(state.summary(2000).state, 'finished');
  const restored = new ActivityState(state.serialize());
  assert.equal(restored.summary(2000).unread, 1);
  restored.acknowledge();
  assert.equal(new ActivityState(restored.serialize()).summary(2000).unread, 0);
  state.accept(signal({ turnId: 'failed', at: 3000 }));
  state.terminal('session', { type: 'task_complete', turn_id: 'failed', failed: true }, 3010);
  assert.equal(state.summary(3020).state, 'failed');
  state.acknowledge();
  state.accept(signal({ turnId: 'cancelled', at: 4000 }));
  state.terminal('session', { type: 'turn_aborted', turn_id: 'cancelled' }, 4010);
  assert.equal(state.summary(4020).state, 'interrupted');
});

test('late tool-start delivery cannot recreate a resolved question signal', () => {
  const state = new ActivityState();
  state.accept(
    signal({
      event: 'PostToolUse',
      toolUseId: 'question',
      toolName: 'request_user_input',
      at: 1000,
    }),
  );
  state.accept(
    signal({
      event: 'PreToolUse',
      toolUseId: 'question',
      toolName: 'request_user_input',
      at: 1010,
    }),
  );
  assert.equal(state.summary(1020).state, 'working');
});

test('a delayed tool-start cannot erase its pending approval signal', () => {
  const state = new ActivityState();
  state.accept(signal({ event: 'PermissionRequest', toolName: 'Bash', at: 1000 }));
  state.accept(signal({ event: 'PreToolUse', toolName: 'Bash', at: 1010 }));
  assert.equal(state.summary(1020).state, 'attention');
  state.accept(signal({ event: 'PostToolUse', toolName: 'Bash', at: 1030 }));
  assert.equal(state.summary(1040).state, 'working');
});

test('receiver confirms outcomes even when hooks arrive late and never retains transcript content', async (t) => {
  const { hooks, home, project } = fixture(t);
  const manifest = hooks.install(hooks.plan(process.execPath));
  const state = new ActivityState();
  const events = new ActivityEvents(
    manifest,
    (event) => state.accept(event),
    (sessionId, payload, at) => state.terminal(sessionId, payload, at),
    { codexHome: home },
  );
  t.after(() => events.dispose());
  const directory = path.join(home, 'sessions');
  fs.mkdirSync(directory);
  const transcript = path.join(directory, 'test.jsonl');
  fs.writeFileSync(
    transcript,
    JSON.stringify({
      type: 'event_msg',
      timestamp: new Date().toISOString(),
      payload: { type: 'task_complete', turn_id: 'late', last_agent_message: 'PRIVATE RESPONSE' },
    }) + '\n',
  );
  events.lease();
  const config = { schema: 1, root: manifest.root, project };
  emit(JSON.stringify(input(project, { turn_id: 'first', transcript_path: transcript })), config);
  await events.scan();
  assert.equal(state.summary().state, 'working');
  emit(JSON.stringify(input(project, { turn_id: 'late', transcript_path: transcript })), config);
  await events.scan();
  assert.equal([...state.turns.values()].find((turn) => turn.turnId === 'late').phase, 'finished');
  assert.doesNotMatch(
    JSON.stringify([...events.terminals.values()]),
    /PRIVATE RESPONSE|last_agent_message/,
  );
  const foreign = path.join(hooks.project, 'outside.jsonl');
  fs.writeFileSync(foreign, '{}\n');
  emit(JSON.stringify(input(project, { turn_id: 'foreign', transcript_path: foreign })), config);
  await events.scan();
  assert.equal(events.transcripts.has(foreign), false);
  events.dispose();
  assert.equal(fs.existsSync(events.receiver), false);
  assert.equal(emit(JSON.stringify(input(project)), config), false);
});

test('webview escapes project names, constrains scripts, and repaints a recreated view', () => {
  const model = {
    enabled: true,
    project: '/local',
    projectName: '<img onerror="bad">',
    health: { code: 'installed' },
    summary: { state: 'attention', connected: true, unread: 0 },
  };
  assert.equal(presentation(model).color, '#edb537');
  const rendered = html(model);
  assert.doesNotMatch(rendered, /<img onerror/);
  assert.match(rendered, /default-src 'none'/);
  assert.match(rendered, /Attention requested/);
  const provider = new ActivityView(
    () => model,
    () => {},
  );
  const view = () => ({
    visible: true,
    webview: { onDidReceiveMessage: () => ({ dispose() {} }) },
    onDidChangeVisibility: () => ({ dispose() {} }),
    onDidDispose() {},
  });
  const first = view();
  provider.resolveWebviewView(first);
  assert.ok(first.webview.html);
  const second = view();
  provider.resolveWebviewView(second);
  assert.ok(second.webview.html);
  provider.dispose();
});
