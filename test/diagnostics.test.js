'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');
const { listen } = require('../src/bridge');
const { query, collect } = require('../src/diagnostics');

test('diagnostics reads live state without connecting a source or acknowledging it', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-diagnostics-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const activity = [];
  let unread = 1;
  const bridge = await listen(
    () => activity.push('connect'),
    () => activity.push('event'),
    () => activity.push('disconnect'),
    root,
    { diagnostics: () => ({ workspace: '/project/é', summary: { unread } }) },
  );
  t.after(() => bridge.dispose());
  const registry = JSON.parse(fs.readFileSync(bridge.registry));
  assert.deepEqual(await collect(root), [{ workspace: '/project/é', summary: { unread: 1 } }]);
  unread = 2;
  assert.equal((await query(registry)).summary.unread, 2, 'Snapshot is current, not cached');
  assert.deepEqual(activity, []);
  assert.equal(unread, 2);
});

test('diagnostics authenticates and ignores injected activity on a diagnostics connection', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-diagnostics-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const activity = [];
  const bridge = await listen(
    () => activity.push('connect'),
    () => activity.push('event'),
    () => activity.push('disconnect'),
    root,
    { diagnostics: () => ({ summary: { unread: 1 } }) },
  );
  t.after(() => bridge.dispose());
  const registry = JSON.parse(fs.readFileSync(bridge.registry));
  await assert.rejects(query({ ...registry, token: 'wrong' }));
  const socket = net.createConnection(registry.socketPath);
  await once(socket, 'connect');
  let response = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    response += chunk;
  });
  socket.write(
    JSON.stringify({ token: registry.token, parent: registry.pid, diagnostics: true }) +
      '\n' +
      JSON.stringify({ event: { type: 'start', thread: 'x', turn: 't' } }) +
      '\n',
  );
  await once(socket, 'close');
  assert.equal(JSON.parse(response).diagnostics.summary.unread, 1);
  assert.deepEqual(activity, []);
});
