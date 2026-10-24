'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { privateDirectory, EVENTS } = require('./activity-helper');
const { atomic } = require('./project-hooks');

const RETAIN_MS = 30 * 60 * 1000;
const BATCH = 128;
class ActivityEvents {
  constructor(manifest, onEvent, onTerminal, options = {}) {
    this.root = manifest.root;
    this.project = manifest.project;
    this.onEvent = onEvent;
    this.onTerminal = onTerminal;
    this.onError = options.onError || (() => {});
    this.codexHome = path.resolve(
      options.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
    );
    this.receiver = path.join(this.root, 'receiver-' + crypto.randomUUID() + '.json');
    this.seen = new Map();
    this.transcripts = new Map();
    this.terminals = new Map();
    this.closed = false;
  }
  start() {
    if (!privateDirectory(this.root)) throw new Error('Unsafe activity receiver directory.');
    this.lease();
    this.poll = setInterval(() => this.scan(), 500);
    this.poll.unref();
    this.scan();
    return this;
  }
  lease() {
    if (this.closed || Date.now() - (this.lastLease || 0) < 4000) return;
    if (!privateDirectory(this.root)) throw new Error('Activity storage is no longer private.');
    atomic(this.receiver, JSON.stringify({ project: this.project, expiresAt: Date.now() + 15000 }));
    this.lastLease = Date.now();
  }
  async scan() {
    if (this.closed || this.scanning) return;
    this.scanning = true;
    try {
      this.lease();
      const now = Date.now();
      const names = await fsp.readdir(this.root);
      const incoming = [];
      let processed = 0;
      for (const name of names.sort()) {
        if (this.closed) return;
        if (!/^event-[0-9]+-[a-f0-9-]+\.json$/.test(name) || this.seen.has(name)) continue;
        if (++processed > BATCH) break;
        const file = path.join(this.root, name);
        this.seen.set(name, now);
        try {
          const stat = await fsp.lstat(file);
          if (
            !stat.isFile() ||
            stat.uid !== process.getuid() ||
            stat.mode & 0o077 ||
            stat.size > 16384
          )
            continue;
          if (now - stat.mtimeMs > RETAIN_MS) {
            await fsp.unlink(file);
            continue;
          }
          const event = JSON.parse(await fsp.readFile(file, 'utf8'));
          const relative =
            typeof event.cwd === 'string' ? path.relative(this.project, event.cwd) : '..';
          if (
            event.schema !== 1 ||
            event.project !== this.project ||
            !EVENTS.has(event.event) ||
            typeof event.sessionId !== 'string' ||
            !Number.isFinite(event.at) ||
            event.at > now + 5000 ||
            now - event.at > RETAIN_MS ||
            (event.turnId !== null && typeof event.turnId !== 'string') ||
            relative === '..' ||
            relative.startsWith('..' + path.sep) ||
            path.isAbsolute(relative)
          )
            continue;
          incoming.push(event);
        } catch {
          /* Ignore one malformed or concurrently removed record. */
        }
      }
      for (const event of incoming.sort((a, b) => a.at - b.at)) {
        if (this.closed) return;
        this.onEvent(event);
        if (typeof event.transcriptPath === 'string') {
          const file = path.resolve(event.transcriptPath);
          const allowed = ['sessions', 'archived_sessions'].some((folder) => {
            const relative = path.relative(path.join(this.codexHome, folder), file);
            return (
              relative &&
              relative !== '..' &&
              !relative.startsWith('..' + path.sep) &&
              !path.isAbsolute(relative)
            );
          });
          if (allowed && file.endsWith('.jsonl')) {
            if (!this.transcripts.has(file)) {
              if (this.transcripts.size >= 64)
                this.transcripts.delete(this.transcripts.keys().next().value);
              this.transcripts.set(file, {
                sessionId: event.sessionId,
                offset: null,
                remainder: '',
                pending: new Set(),
              });
            }
            const cursor = this.transcripts.get(file);
            if (event.turnId) cursor.pending.add(event.turnId);
            if (cursor.pending.size > 128)
              cursor.pending.delete(cursor.pending.values().next().value);
          }
        }
      }
      for (const [file, cursor] of this.transcripts) {
        if (this.closed) return;
        for (const turnId of cursor.pending)
          if (this.terminals.has(cursor.sessionId + '\0' + turnId)) cursor.pending.delete(turnId);
        // Completed conversations require no recurring transcript I/O.
        if (cursor.pending.size) await this.readTranscript(file, cursor);
      }
      for (const terminal of this.terminals.values()) {
        if (this.closed) return;
        this.onTerminal(terminal.sessionId, terminal.payload, terminal.at);
      }
      while (this.seen.size > 4096) this.seen.delete(this.seen.keys().next().value);
      // Cleanup is receiver-owned. The helper never needs to wait for maintenance.
      if (now - (this.lastCleanup || 0) > (names.length > 768 ? 5000 : 60000)) {
        this.lastCleanup = now;
        let removed = 0;
        for (const name of names) {
          if (removed >= BATCH) break;
          if (
            !/^(event-[0-9]+-[a-f0-9-]+\.json(?:\.tmp)?|receiver-[a-f0-9-]+\.json)$/.test(name) ||
            path.join(this.root, name) === this.receiver
          )
            continue;
          try {
            const file = path.join(this.root, name);
            const stat = await fsp.lstat(file);
            if (
              stat.isFile() &&
              stat.uid === process.getuid() &&
              now - stat.mtimeMs > (names.length > 768 ? 30000 : RETAIN_MS)
            ) {
              await fsp.unlink(file);
              removed++;
            }
          } catch {
            /* Another receiver may clean concurrently. */
          }
        }
        for (const [name, at] of this.seen) if (now - at > RETAIN_MS) this.seen.delete(name);
      }
    } catch (error) {
      this.dispose();
      this.onError(error);
    } finally {
      this.scanning = false;
    }
  }
  async readTranscript(file, cursor) {
    let handle;
    try {
      const real = await fsp.realpath(file);
      const home = await fsp.realpath(this.codexHome);
      if (
        !['sessions', 'archived_sessions'].some((folder) =>
          real.startsWith(path.join(home, folder) + path.sep),
        )
      )
        return;
      handle = await fsp.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.uid !== process.getuid()) return;
      if (cursor.offset === null || stat.ino !== cursor.ino || stat.size < cursor.offset) {
        cursor.offset = Math.max(0, stat.size - 256 * 1024);
        cursor.remainder = '';
        cursor.skipLine = cursor.offset > 0;
        cursor.ino = stat.ino;
      }
      const bytes = Math.min(256 * 1024, stat.size - cursor.offset);
      if (!bytes) return;
      const buffer = Buffer.alloc(bytes);
      const { bytesRead } = await handle.read(buffer, 0, bytes, cursor.offset);
      cursor.offset += bytesRead;
      const lines = (cursor.remainder + buffer.subarray(0, bytesRead).toString('utf8')).split('\n');
      cursor.remainder = lines.pop();
      if (cursor.skipLine) {
        lines.shift();
        cursor.skipLine = false;
      }
      if (cursor.remainder.length > 256 * 1024) {
        cursor.remainder = '';
        cursor.skipLine = true;
      }
      for (const line of lines) {
        if (this.closed) return;
        try {
          const record = JSON.parse(line);
          if (
            record.type === 'event_msg' &&
            ['task_complete', 'turn_complete', 'turn_aborted'].includes(record.payload?.type)
          ) {
            const payload = {
              type: record.payload.type,
              failed: Boolean(record.payload.error),
              turn_id: record.payload.turn_id,
              root_turn_id: record.payload.root_turn_id,
            };
            this.terminals.set(
              cursor.sessionId + '\0' + (payload.turn_id || payload.root_turn_id),
              { sessionId: cursor.sessionId, payload, at: Date.parse(record.timestamp) },
            );
            if (this.terminals.size > 256)
              this.terminals.delete(this.terminals.keys().next().value);
          }
        } catch {
          /* Prompts, responses, and malformed records are never retained. */
        }
      }
    } catch {
      /* Rollouts may be delayed, moved, absent, or truncated. Keep outcome unknown. */
    } finally {
      await handle?.close();
    }
  }
  dispose() {
    this.closed = true;
    clearInterval(this.poll);
    try {
      fs.unlinkSync(this.receiver);
    } catch {
      /* Missing receiver is already disabled. */
    }
  }
}
module.exports = { ActivityEvents, RETAIN_MS };
