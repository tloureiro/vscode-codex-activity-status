'use strict';
const { StringDecoder } = require('node:string_decoder');

// Observe a bounded copy; the transport pipes the original bytes independently.
class JsonLines {
  constructor(onMessage, onOverflow = () => {}) {
    this.buffer = '';
    this.decoder = new StringDecoder('utf8');
    this.discard = false;
    this.onMessage = onMessage;
    this.onOverflow = onOverflow;
  }
  push(chunk) {
    const text = this.decoder.write(chunk);
    for (const part of text.split(/(?<=\n)/)) {
      if (!this.discard) this.buffer += part;
      if (this.buffer.length > 8 * 1024 * 1024) {
        this.buffer = '';
        this.discard = true;
        this.onOverflow();
      }
      if (part.endsWith('\n')) {
        if (!this.discard) {
          try {
            this.onMessage(JSON.parse(this.buffer));
          } catch {
            /* Non-JSON output is not activity. */
          }
        }
        this.buffer = '';
        this.discard = false;
      }
    }
  }
}
const waits = new Set([
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'item/permissions/requestApproval',
  'item/tool/requestUserInput',
  'tool/requestUserInput',
  'mcpServer/elicitation/request',
]);
class ProtocolObserver {
  constructor(emit) {
    this.emit = emit;
    this.pending = new Map();
    this.requests = new Map();
  }
  client(m) {
    const p = m.params || {};
    if (m.method === 'turn/start' && p.threadId && m.id !== undefined) {
      const request = String(m.id);
      this.pending.set(String(m.id), { thread: p.threadId, request });
      this.emit({ type: 'submit', thread: p.threadId, request });
    }
    if (!m.method && m.id !== undefined) this.resolve(m.id);
  }
  resolve(id) {
    const request = String(id),
      e = this.requests.get(request);
    if (e) {
      this.emit({ type: 'resolved', thread: e.thread, request });
      this.requests.delete(request);
    }
  }
  server(m) {
    const p = m.params || {},
      thread = p.threadId;
    const pending = this.pending.get(String(m.id));
    if (!m.method && pending) {
      this.pending.delete(String(m.id));
      this.emit({ ...pending, type: m.error ? 'rejected' : 'accepted' });
      if (!m.error && m.result?.turn?.id)
        this.emit({ type: 'start', thread: pending.thread, turn: m.result.turn.id });
    }
    if (m.method === 'turn/started' && thread && p.turn?.id)
      this.emit({ type: 'start', thread, turn: p.turn.id });
    if (m.method === 'turn/completed' && thread && p.turn?.id)
      this.emit({ type: 'complete', thread, turn: p.turn.id, status: p.turn.status });
    if (m.method === 'thread/status/changed' && thread)
      this.emit({ type: 'status', thread, status: p.status?.type, flags: p.status?.activeFlags });
    if (m.method === 'thread/closed' && thread) this.emit({ type: 'closed', thread });
    if (waits.has(m.method) && m.id !== undefined && thread && p.isBlocking !== false) {
      const e = { type: 'wait', thread, turn: p.turnId, request: String(m.id) };
      this.requests.set(String(m.id), e);
      this.emit(e);
    }
    if (m.method === 'serverRequest/resolved') this.resolve(p.requestId);
  }
}
module.exports = { JsonLines, ProtocolObserver };
