'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SnapshotReader } = require('../research/introspection/reader');

test('snapshot reader rejects debugger operations and unknown versions before inspection', async () => {
  const reader = new SnapshotReader();
  assert.throws(() => reader.post('Debugger.enable', {}), /excluded/);
  assert.throws(() => reader.post('Runtime.callFunctionOn', {}), /excluded/);
  await assert.rejects(reader.read({ packageJSON: { version: 'unknown' } }), /Unverified/);
  assert.equal(reader.calls, 0);
});

test('yielded inspector failures reject the read without escaping into the event loop', async () => {
  const reader = new SnapshotReader();
  reader.started = performance.now();
  reader.session.post = () => {
    throw new Error('Synthetic disconnected inspector');
  };
  await assert.rejects(
    reader.post('Runtime.getProperties', { objectId: 'owned-fixture' }),
    /Synthetic disconnected/,
  );
});

test('snapshot reader reads nonempty retained maps without getters, listeners, or target mutations', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-reader-'));
  fs.mkdirSync(path.join(directory, 'out'));
  const file = path.join(directory, 'out', 'extension.js');
  const source = `
let DX, active, lifecycle, getterCalls = 0;
const observer = { lifecycleByConversationId: new Map(), onNotification() {} };
exports.activate = () => {
  const v = {
    initialized: true,
    providers: new Map([['codex.chatSessionObserver', { onNotification: observer.onNotification.bind(observer) }]]),
    internalNotificationHandlers: new Set([() => {}]),
    turnCwds: { startedByTurnId: new Map(), pendingByStartId: new Map(), approvalThreadIdByRequestId: new Map() },
    requestUserInputAutoResolutionCoordinator: { pendingRequestByConversationId: new Map() },
    get dangerousGetter() { getterCalls++; throw new Error('Getter invoked'); },
    registerInternalNotificationHandler() { throw new Error('Listener registration prohibited'); }
  };
  const owned = {};
  DX = () => owned;
  exports.verify = () => JSON.stringify({
    initialized: v.initialized,
    active: [...v.turnCwds.startedByTurnId],
    approvals: [...v.turnCwds.approvalThreadIdByRequestId],
    lifecycle: [...observer.lifecycleByConversationId],
    listenerCount: v.internalNotificationHandlers.size,
    getterCalls
  });
  active = v;
  lifecycle = observer.lifecycleByConversationId;
};
exports.deactivate = () => DX?.();
exports.driveFixture = (phase) => {
  active.turnCwds.startedByTurnId.clear();
  active.turnCwds.approvalThreadIdByRequestId.clear();
  if (phase !== 'finished') active.turnCwds.startedByTurnId.set('thread:turn', { threadId: 'thread', cwds: ['ignored'] });
  if (phase === 'approval') active.turnCwds.approvalThreadIdByRequestId.set(123, 'thread');
  if (phase === 'oversized') for (let i = 0; i < 129; i++) active.turnCwds.startedByTurnId.set('extra-' + i, { threadId: 'thread' });
  lifecycle.set('thread', { status: phase === 'finished' ? 1 : 2, startTime: 100, endTime: phase === 'finished' ? 200 : undefined });
};
`;
  fs.writeFileSync(file, source);
  const fixture = require(file);
  const extension = { packageJSON: { version: 'fixture' }, extensionPath: directory };
  const reader = new SnapshotReader({
    version: 'fixture',
    bundleSha: crypto.createHash('sha256').update(source).digest('hex'),
  });
  fixture.activate();
  try {
    for (const phase of ['running', 'approval', 'finished']) {
      fixture.driveFixture(phase);
      const before = fixture.verify();
      const snapshot = await reader.read(extension);
      assert.equal(fixture.verify(), before, 'Target state remains unchanged');
      assert.equal(snapshot.activeTurns.length, phase === 'finished' ? 0 : 1);
      assert.equal(snapshot.approvals.length, phase === 'approval' ? 1 : 0);
      assert.equal(snapshot.lifecycle[0].status, phase === 'finished' ? 1 : 2);
      assert.equal(snapshot.lifecycle[0].threadId, 'thread');
      assert.equal(snapshot.internalHandlerCount, 1);
      assert.equal(snapshot.blockingInputCoverage, false);
      assert.ok(!JSON.stringify(snapshot).includes('ignored'));
      assert.ok(reader.methods.has('Runtime.releaseObjectGroup'));
    }
    fixture.driveFixture('oversized');
    const beforeFailure = fixture.verify();
    await assert.rejects(reader.read(extension), /oversized/);
    assert.equal(fixture.verify(), beforeFailure);
    fixture.driveFixture('running');
    assert.equal((await reader.read(extension)).activeTurns.length, 1);
    const selectiveReader = new SnapshotReader({
      version: 'fixture',
      bundleSha: crypto.createHash('sha256').update(source).digest('hex'),
      selectiveScopes: true,
    });
    assert.throws(
      () =>
        selectiveReader.post('Runtime.callFunctionOn', {
          functionDeclaration: 'function() { return this; }',
        }),
      /excluded/,
    );
    const beforeSelective = fixture.verify();
    const selected = await selectiveReader.read(extension);
    assert.equal(fixture.verify(), beforeSelective);
    assert.equal(selected.activeTurns.length, 1);
    assert.equal(selected.lifecycle[0].threadId, 'thread');
    assert.ok(selectiveReader.methods.has('Runtime.callFunctionOn'));
    const pendingRead = reader.read(extension);
    await assert.rejects(reader.read(extension), /Concurrent/);
    assert.equal((await pendingRead).activeTurns.length, 1);
    assert.equal((await reader.read(extension)).activeTurns.length, 1);
    await assert.rejects(new SnapshotReader({ version: 'fixture' }).read(extension), /hash/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
