'use strict';
const STALE_MS = 2 * 60 * 1000;
const MAX_TURNS = 128;
const keyOf = (sessionId, turnId) => sessionId + '\0' + turnId;

class ActivityState {
  constructor(saved = []) {
    this.turns = new Map();
    this.connected = false;
    for (const turn of (Array.isArray(saved) ? saved : []).slice(-MAX_TURNS)) {
      if (
        !turn ||
        typeof turn.sessionId !== 'string' ||
        typeof turn.turnId !== 'string' ||
        !Number.isFinite(turn.at)
      )
        continue;
      this.turns.set(keyOf(turn.sessionId, turn.turnId), {
        ...turn,
        phase: turn.terminal ? turn.phase : 'unknown',
        tools: new Set(),
      });
    }
  }
  accept(event) {
    this.connected = true;
    if (!event.turnId) return;
    const key = keyOf(event.sessionId, event.turnId);
    let turn = this.turns.get(key);
    if (!turn) {
      turn = {
        sessionId: event.sessionId,
        turnId: event.turnId,
        at: event.at,
        phase: 'unknown',
        terminal: false,
        unread: false,
        tools: new Set(),
      };
      this.turns.set(key, turn);
    }
    // A persisted terminal record always wins over delayed async hook processes.
    if (turn.terminal) return;
    if (event.event === 'PostToolUse' && event.toolUseId) {
      turn.tools.add(event.toolUseId);
      if (turn.tools.size > 256) turn.tools.delete(turn.tools.values().next().value);
    }
    if (event.at < turn.at) return;
    turn.at = event.at;
    if (event.event === 'Interrupt') turn.phase = 'stopping';
    else if (event.event === 'Stop') turn.phase = 'checking';
    else if (event.event === 'PermissionRequest') {
      turn.phase = 'attention';
      turn.pendingTool = event.toolName;
    } else if (
      event.event === 'PreToolUse' &&
      event.toolName === 'request_user_input' &&
      !turn.tools.has(event.toolUseId)
    ) {
      turn.phase = 'attention';
      turn.pendingTool = event.toolName;
    } else if (event.event === 'PostToolUse') {
      if (event.toolName === turn.pendingTool) turn.pendingTool = null;
      turn.phase = turn.pendingTool ? 'attention' : 'working';
    } else if (event.event === 'PreToolUse')
      turn.phase = turn.pendingTool ? 'attention' : 'working';
    else if (event.event === 'UserPromptSubmit' && turn.phase === 'unknown') turn.phase = 'working';
    while (this.turns.size > MAX_TURNS) this.turns.delete(this.turns.keys().next().value);
  }
  terminal(sessionId, payload, at) {
    const turnId = payload.turn_id || payload.root_turn_id;
    const turn = this.turns.get(keyOf(sessionId, turnId));
    if (!turn || turn.terminal) return false;
    turn.terminal = true;
    turn.at = Number.isFinite(at) ? Math.max(turn.at, at) : turn.at;
    turn.phase = payload.failed
      ? 'failed'
      : payload.type === 'turn_aborted'
        ? 'interrupted'
        : 'finished';
    turn.unread = true;
    return true;
  }
  acknowledge(sessionId = null) {
    for (const turn of this.turns.values())
      if (!sessionId || turn.sessionId === sessionId) turn.unread = false;
  }
  summary(now = Date.now(), sessionId = null) {
    const turns = [...this.turns.values()].filter(
      (turn) => !sessionId || turn.sessionId === sessionId,
    );
    const live = turns.filter((turn) => !turn.terminal);
    const fresh = live.filter((turn) => now - turn.at < STALE_MS);
    const unread = turns.filter((turn) => turn.unread);
    const phase = fresh.some((turn) => turn.phase === 'attention')
      ? 'attention'
      : fresh.some((turn) => turn.phase === 'working')
        ? 'working'
        : fresh.some((turn) => turn.phase === 'checking' || turn.phase === 'stopping')
          ? 'checking'
          : unread.some((turn) => turn.phase === 'failed')
            ? 'failed'
            : unread.some((turn) => turn.phase === 'finished')
              ? 'finished'
              : unread.length
                ? 'interrupted'
                : live.length
                  ? 'unknown'
                  : 'idle';
    return {
      state: phase,
      unread: unread.length,
      conversations: new Set(turns.map((turn) => turn.sessionId)).size,
      connected: this.connected,
    };
  }
  sessions() {
    return [...new Set([...this.turns.values()].map((turn) => turn.sessionId))];
  }
  serialize() {
    return [...this.turns.values()].map(({ tools: _tools, ...turn }) => turn);
  }
}
module.exports = { ActivityState, STALE_MS, MAX_TURNS };
