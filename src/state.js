'use strict';

// Each instance belongs to one window. A source is one live proxy connection.
class ActivityState {
  constructor() {
    this.sources = new Map();
    this.focused = false;
    this.autoAcknowledge = true;
  }
  connect(source) {
    this.sources.set(source, { threads: new Map(), ended: new Set() });
  }
  disconnect(source) {
    this.sources.delete(source);
  }
  clear() {
    this.sources.clear();
  }
  acknowledge() {
    for (const s of this.sources.values()) for (const t of s.threads.values()) t.unread = false;
  }
  focus(focused) {
    const returned = focused && !this.focused;
    this.focused = focused;
    if (returned && this.autoAcknowledge) this.acknowledge();
  }
  interaction(kind) {
    if (this.focused && this.autoAcknowledge && (kind === 1 || kind === 2)) this.acknowledge();
  }
  apply(source, e) {
    const s = this.sources.get(source);
    if (!s || typeof e.thread !== 'string' || !e.thread || e.thread.length > 256) return;
    let t = s.threads.get(e.thread);
    if (!t) {
      if (s.threads.size >= 1024) return;
      t = {
        turn: null,
        pending: new Set(),
        unread: false,
        requests: new Set(),
        flags: [],
        problem: '',
      };
      s.threads.set(e.thread, t);
    }
    if (e.type === 'submit') {
      t.pending.add(String(e.request));
      t.unread = false;
      t.problem = '';
    } else if (e.type === 'accepted' || e.type === 'rejected') {
      t.pending.delete(String(e.request));
      if (e.type === 'rejected') t.problem = 'Request rejected';
    } else if (e.type === 'start' && typeof e.turn === 'string') {
      if (s.ended.has(e.turn)) return;
      if (t.turn !== e.turn) {
        if (t.turn !== '@live') {
          t.requests.clear();
          t.flags = [];
        }
        t.turn = e.turn;
        t.unread = false;
      }
      t.problem = '';
    } else if (e.type === 'complete' && e.turn === t.turn) {
      t.turn = null;
      t.requests.clear();
      t.flags = [];
      t.unread = e.status === 'completed';
      t.problem = t.unread
        ? ''
        : e.status === 'interrupted'
          ? 'Interrupted'
          : 'Failed or unknown outcome';
      s.ended.add(e.turn);
      if (s.ended.size > 2048) s.ended.delete(s.ended.values().next().value);
    } else if (e.type === 'wait' && (!e.turn || !t.turn || t.turn === e.turn)) {
      // A server request is reliable even when attaching mid-turn.
      if (e.turn && s.ended.has(e.turn)) return;
      if (!t.turn) t.turn = e.turn || '@live';
      t.requests.add(String(e.request));
    } else if (e.type === 'resolved') {
      t.requests.delete(String(e.request));
    } else if (e.type === 'status') {
      if (e.status === 'active') {
        if (!t.turn) t.turn = '@live';
        t.flags = Array.isArray(e.flags)
          ? e.flags.filter((x) => x === 'waitingOnApproval' || x === 'waitingOnUserInput')
          : [];
      } else if (['idle', 'notLoaded', 'systemError'].includes(e.status)) {
        // An idle status is never evidence of a successful completion. Keep a known
        // turn until turn/completed arrives; synthetic live state can be dropped.
        if (t.turn === '@live' || e.status !== 'idle') t.turn = null;
        if (e.status !== 'idle') t.pending.clear();
        t.requests.clear();
        t.flags = [];
        if (e.status === 'systemError') t.problem = 'Codex system error';
      }
    } else if (e.type === 'closed') {
      t.pending.clear();
      t.turn = null;
      t.requests.clear();
      t.flags = [];
    }
  }
  summary() {
    let processing = 0,
      waiting = 0,
      unread = 0;
    const problems = new Set();
    for (const s of this.sources.values())
      for (const t of s.threads.values()) {
        if (t.requests.size || t.flags.length) waiting++;
        else if (t.turn || t.pending.size) processing++;
        if (t.unread) unread++;
        if (t.problem) problems.add(t.problem);
      }
    return {
      state: waiting
        ? 'approval'
        : processing
          ? 'processing'
          : unread
            ? 'finished'
            : this.sources.size
              ? 'idle'
              : 'unknown',
      processing,
      waiting,
      unread,
      connected: this.sources.size,
      problems: [...problems],
    };
  }
}
module.exports = { ActivityState };
