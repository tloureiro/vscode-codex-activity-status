'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, fork } = require('node:child_process');
const { once } = require('node:events');
const { listen } = require('../src/bridge');
const { ActivityState } = require('../src/state');
const { overlay, palette } = require('../src/appearance');
const waitFor = async (fn) => {
  for (let i = 0; i < 100; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('Timed out');
};

test('authenticated routing rejects wrong parents and unrelated connections', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-routing-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const connected = [],
    events = [],
    b = await listen(
      (id) => connected.push(id),
      (id, e) => events.push([id, e]),
      () => {},
      root,
    );
  t.after(() => b.dispose());
  const registry = JSON.parse(fs.readFileSync(b.registry));
  for (const bad of [
    { token: 'wrong', parent: process.pid },
    { token: registry.token, parent: process.pid + 1 },
  ]) {
    const s = net.createConnection(b.socketPath);
    await once(s, 'connect');
    s.write(JSON.stringify(bad) + '\n');
    await once(s, 'close');
  }
  assert.equal(connected.length, 0);
  const s = net.createConnection(b.socketPath);
  await once(s, 'connect');
  s.write(
    JSON.stringify({ token: registry.token, parent: process.pid }) +
      '\n' +
      JSON.stringify({ event: { type: 'start', thread: 'a', turn: 't' } }) +
      '\n',
  );
  await waitFor(() => events.length);
  assert.equal(connected.length, 1);
  assert.equal(events[0][0], connected[0]);
  s.destroy();
});
test('proxy relays exact bytes, forwards only activity, and passes child exit status', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-proxy-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const s = new ActivityState(),
    events = [];
  const b = await listen(
    (id) => s.connect(id),
    (id, e) => {
      events.push(e);
      s.apply(id, e);
    },
    (id) => s.disconnect(id),
  );
  t.after(() => b.dispose());
  const fake = path.join(dir, 'fake.cjs');
  fs.writeFileSync(
    fake,
    `setTimeout(() => { process.stdout.write(JSON.stringify({method:'turn/started',params:{threadId:'a',turn:{id:'t'}}})+'\\n'); },150); process.stdin.on('data',b=>process.stdout.write(b)); process.stdin.on('end',()=>setTimeout(()=>process.exit(7),100));`,
  );
  const child = spawn(
    process.execPath,
    [path.resolve('src/proxy.js'), process.execPath, fake, 'app-server'],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  t.after(() => child.kill());
  let output = '';
  child.stdout.on('data', (b) => {
    output += b;
  });
  await waitFor(() => s.summary().state === 'processing');
  const bytes = Buffer.from(' {"secret":"é: conversation text"}\n');
  child.stdin.end(bytes);
  const [code] = await once(child, 'close');
  assert.equal(code, 7);
  assert.ok(output.endsWith(bytes.toString()));
  assert.deepEqual(events, [{ type: 'start', thread: 'a', turn: 't' }]);
  assert.equal(s.summary().state, 'unknown');
});
test('watchdog restores colors after parent IPC disappears', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-watchdog-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const workspace = path.join(dir, 'a.code-workspace'),
    lock = path.join(dir, 'lock');
  const { colors, journal } = overlay(undefined, palette('processing', {}));
  journal.hadColors = false;
  fs.writeFileSync(
    workspace,
    JSON.stringify({
      settings: { 'workbench.colorCustomizations': colors, 'editor.fontSize': 14 },
    }),
  );
  fs.writeFileSync(workspace + '.appearance.json', JSON.stringify(journal));
  fs.writeFileSync(lock, JSON.stringify({ token: 'test' }));
  const child = fork(path.resolve('src/watchdog.js'), [workspace, lock, 'test'], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  child.disconnect();
  await once(child, 'exit');
  assert.deepEqual(JSON.parse(fs.readFileSync(workspace)).settings, { 'editor.fontSize': 14 });
  assert.ok(!fs.existsSync(lock));
});
