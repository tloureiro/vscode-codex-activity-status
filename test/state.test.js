'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ActivityState } = require('../src/state');
const { ProtocolObserver, JsonLines } = require('../src/protocol');
function setup() {
  const s = new ActivityState();
  s.connect('p');
  return s;
}
const start = (s, thread = 'a', turn = '1') => s.apply('p', { type: 'start', thread, turn });
const complete = (s, thread = 'a', turn = '1', status = 'completed') =>
  s.apply('p', { type: 'complete', thread, turn, status });

test('A–D, M: window state is independent; only a focus transition acknowledges', () => {
  const a = setup(),
    b = setup();
  start(a);
  assert.equal(a.summary().state, 'processing');
  assert.equal(b.summary().state, 'idle');
  a.focus(true);
  assert.equal(a.summary().state, 'processing');
  a.focus(false);
  complete(a);
  assert.equal(a.summary().state, 'finished');
  b.focus(true);
  assert.equal(a.summary().state, 'finished');
  a.focus(true);
  assert.equal(a.summary().state, 'idle');
});
test('E–F: multiple approval requests survive focus and resolve independently', () => {
  const s = setup();
  start(s);
  for (const request of ['x', 'y']) s.apply('p', { type: 'wait', thread: 'a', turn: '1', request });
  s.focus(true);
  s.interaction(1);
  assert.equal(s.summary().state, 'approval');
  s.apply('p', { type: 'resolved', thread: 'a', request: 'x' });
  assert.equal(s.summary().state, 'approval');
  s.apply('p', { type: 'resolved', thread: 'a', request: 'y' });
  assert.equal(s.summary().state, 'processing');
});
test('G: already-focused completion waits for supported editor interaction', () => {
  const s = setup();
  s.focus(true);
  start(s);
  complete(s);
  s.focus(true);
  s.interaction(3);
  s.interaction(undefined);
  assert.equal(s.summary().state, 'finished');
  s.interaction(2);
  assert.equal(s.summary().state, 'idle');
});
test('H–I: aggregation preserves unread tasks under blue and amber', () => {
  const s = setup();
  start(s);
  start(s, 'b', '2');
  complete(s);
  assert.equal(s.summary().state, 'processing');
  assert.equal(s.summary().unread, 1);
  s.apply('p', { type: 'wait', thread: 'b', turn: '2', request: 'x' });
  assert.equal(s.summary().state, 'approval');
  complete(s, 'b', '2');
  assert.equal(s.summary().unread, 2);
  start(s, 'a', '3');
  assert.equal(s.summary().state, 'processing');
  assert.equal(s.summary().unread, 1);
});
test('J: cancellation, failure, historical completion, disconnect never invent success', () => {
  for (const status of ['failed', 'interrupted', 'unexpected']) {
    const s = setup();
    start(s);
    complete(s, 'a', '1', status);
    assert.equal(s.summary().state, 'idle');
  }
  const s = setup();
  complete(s);
  assert.equal(s.summary().unread, 0);
  start(s);
  s.disconnect('p');
  assert.equal(s.summary().state, 'unknown');
});
test('duplicate and delayed completions cannot replace new work or recreate unread', () => {
  const s = setup();
  start(s);
  complete(s);
  s.acknowledge();
  start(s);
  complete(s);
  assert.equal(s.summary().unread, 0);
  start(s, 'a', '2');
  complete(s);
  assert.equal(s.summary().state, 'processing');
  s.apply('p', { type: 'wait', thread: 'a', turn: '1', request: 'late' });
  assert.equal(s.summary().state, 'processing');
});
test('automatic acknowledgement can be disabled', () => {
  const s = setup();
  s.autoAcknowledge = false;
  start(s);
  complete(s);
  s.focus(true);
  s.interaction(1);
  assert.equal(s.summary().state, 'finished');
  start(s, 'a', '2');
  assert.equal(s.summary().unread, 0);
});
test('status flags reconcile live work; idle never creates unread completion', () => {
  const s = setup();
  s.apply('p', { type: 'status', thread: 'a', status: 'active', flags: ['waitingOnUserInput'] });
  assert.equal(s.summary().state, 'approval');
  s.apply('p', { type: 'status', thread: 'a', status: 'active', flags: [] });
  assert.equal(s.summary().state, 'processing');
  s.apply('p', { type: 'status', thread: 'a', status: 'idle' });
  assert.equal(s.summary().state, 'idle');
});
test('protocol strips content, ignores ordinary tool calls and nonblocking questions', () => {
  const events = [],
    p = new ProtocolObserver((e) => events.push(e));
  p.server({ method: 'item/started', params: { threadId: 'a', item: { text: 'secret' } } });
  p.server({
    id: 1,
    method: 'item/tool/requestUserInput',
    params: { threadId: 'a', turnId: 't', isBlocking: false, questions: ['secret'] },
  });
  assert.deepEqual(events, []);
  p.server({
    id: 2,
    method: 'item/commandExecution/requestApproval',
    params: { threadId: 'a', turnId: 't', command: 'secret' },
  });
  p.client({ id: 2, result: { decision: 'accept' } });
  assert.deepEqual(events, [
    { type: 'wait', thread: 'a', turn: 't', request: '2' },
    { type: 'resolved', thread: 'a', request: '2' },
  ]);
});
test('protocol immediately reflects new requests and handles a rejected turn start', () => {
  const s = setup(),
    p = new ProtocolObserver((e) => s.apply('p', e));
  p.client({ id: 9, method: 'turn/start', params: { threadId: 'a', input: ['secret'] } });
  assert.equal(s.summary().state, 'processing');
  p.server({ id: 9, error: { code: 1 } });
  assert.equal(s.summary().state, 'idle');
});
test('fragmented UTF-8 and oversized messages leave subsequent events parseable', () => {
  const results = [],
    p = new JsonLines((m) => results.push(m));
  const bytes = Buffer.from('{"word":"é"}\n');
  for (const b of bytes) p.push(Buffer.from([b]));
  p.push(Buffer.from('x'.repeat(8 * 1024 * 1024 + 1) + '\n{"ok":true}\n'));
  assert.deepEqual(results, [{ word: 'é' }, { ok: true }]);
});
test('rejected new submit preserves a turn already running in that thread', () => {
  const s = setup(),
    p = new ProtocolObserver((e) => s.apply('p', e));
  start(s);
  p.client({ id: 1, method: 'turn/start', params: { threadId: 'a' } });
  p.server({ id: 1, error: { code: -1 } });
  assert.equal(s.summary().state, 'processing');
  complete(s);
  assert.equal(s.summary().state, 'finished');
});
test('turn notification preceding start response does not erase completed outcome', () => {
  const s = setup(),
    p = new ProtocolObserver((e) => s.apply('p', e));
  p.client({ id: 1, method: 'turn/start', params: { threadId: 'a' } });
  p.server({ method: 'turn/started', params: { threadId: 'a', turn: { id: '1' } } });
  p.server({
    method: 'turn/completed',
    params: { threadId: 'a', turn: { id: '1', status: 'completed' } },
  });
  p.server({ id: 1, result: { turn: { id: '1' } } });
  assert.equal(s.summary().state, 'finished');
});
test('late approval for an ended turn cannot recreate amber', () => {
  const s = setup();
  start(s);
  complete(s);
  s.acknowledge();
  s.apply('p', { type: 'wait', thread: 'a', turn: '1', request: 'late' });
  assert.equal(s.summary().state, 'idle');
});
