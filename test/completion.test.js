'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { CompletionEvents, matchesWorkspace } = require('../src/completion-events');
const { CompletionState } = require('../src/completion-state');

test('completion state keeps an unread result until focus return or editor interaction', () => {
  const state = new CompletionState();
  state.focused = true;
  state.complete({ thread: 'one', turn: 'a' });
  assert.deepEqual(state.summary(), { state: 'finished', unread: 1 });
  state.focus(false);
  assert.equal(state.summary().unread, 1);
  state.focus(true);
  assert.equal(state.summary().unread, 0);
  state.complete({ thread: 'two', turn: 'b' });
  state.interaction(1);
  assert.equal(state.summary().unread, 0);
});

test('workspace matching accepts either side of a nested local path', () => {
  const folders = [{ uri: { scheme: 'file', fsPath: '/work/project' } }];
  assert.equal(matchesWorkspace('/work/project/subdir', folders), true);
  assert.equal(matchesWorkspace('/work', folders), true);
  assert.equal(matchesWorkspace('/other', folders), false);
  assert.equal(matchesWorkspace('/work/project', [], true), true);
});

test('notifier stores only completion metadata and the watcher routes it', (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'completion-test-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const result = spawnSync(
    process.execPath,
    [
      path.resolve(__dirname, '../src/notifier.js'),
      JSON.stringify({
        type: 'agent-turn-complete',
        'thread-id': 'thread',
        'turn-id': 'turn',
        cwd: '/work/project',
        'last-assistant-message': 'private response',
        'input-messages': ['private prompt'],
      }),
    ],
    { env: { ...process.env, TMPDIR: temporary } },
  );
  assert.equal(result.status, 0, result.stderr.toString());
  const root = path.join(temporary, 'codex-completion-' + process.getuid());
  const files = fs.readdirSync(root);
  assert.equal(files.length, 1);
  const stored = JSON.parse(fs.readFileSync(path.join(root, files[0])));
  assert.deepEqual(Object.keys(stored), ['type', 'thread', 'turn', 'cwd', 'at']);
  const received = [];
  const watcher = new CompletionEvents(
    {
      workspace: { workspaceFolders: [{ uri: { scheme: 'file', fsPath: '/work/project' } }] },
      window: { state: { focused: true } },
    },
    (event) => received.push(event),
    { root },
  );
  watcher.scan();
  watcher.dispose();
  assert.equal(received.length, 1);
  assert.equal(received[0].thread, 'thread');
  assert.equal(JSON.stringify(received).includes('private'), false);
});
