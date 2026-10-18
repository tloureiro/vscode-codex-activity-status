#!/usr/bin/env node
'use strict';
// This is an opt-in stdio tee, not a second app-server or a transcript reader.
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { runtimeRoot } = require('./bridge');
const { ProtocolObserver, JsonLines } = require('./protocol');
const { ActivityState } = require('./state');
function run(real, args) {
  let socket,
    retry,
    exiting = false,
    connected = false,
    degraded = false;
  const snapshot = new ActivityState();
  snapshot.connect('live');
  const send = (event) => {
    snapshot.apply('live', event);
    if (connected) {
      if (socket.writableLength > 1024 * 1024) {
        degraded = true;
        socket.destroy();
        return;
      }
      socket.write(JSON.stringify({ event }) + '\n');
    }
  };
  const observer = new ProtocolObserver(send);
  function connect() {
    if (exiting || degraded) return;
    try {
      // Direct process parent, not cwd. The shell launcher execs this process.
      const registry = JSON.parse(
        fs.readFileSync(path.join(runtimeRoot(), process.ppid + '.json'), 'utf8'),
      );
      if (registry.pid !== process.ppid) return;
      socket = net.createConnection(registry.socketPath);
      socket.on('connect', () => {
        connected = true;
        socket.write(JSON.stringify({ token: registry.token, parent: process.ppid }) + '\n');
        // Reconcile live work only. Never replay historical completions.
        for (const [thread, t] of snapshot.sources.get('live').threads) {
          for (const request of t.pending)
            socket.write(JSON.stringify({ event: { type: 'submit', thread, request } }) + '\n');
          if (t.turn)
            socket.write(JSON.stringify({ event: { type: 'start', thread, turn: t.turn } }) + '\n');
          if (t.flags.length)
            socket.write(
              JSON.stringify({
                event: { type: 'status', thread, status: 'active', flags: t.flags },
              }) + '\n',
            );
          for (const request of t.requests)
            socket.write(
              JSON.stringify({ event: { type: 'wait', thread, turn: t.turn, request } }) + '\n',
            );
        }
      });
      socket.on('error', () => {});
      socket.on('close', () => {
        connected = false;
        if (!exiting && !degraded) retry = setTimeout(connect, 1000);
      });
    } catch {
      retry = setTimeout(connect, 1000);
    }
  }
  const listenArg = args.findIndex((a) => a === '--listen' || a.startsWith('--listen='));
  const stdio =
    listenArg < 0 ||
    (args[listenArg] === '--listen' ? args[listenArg + 1] : args[listenArg].slice(9)) ===
      'stdio://';
  const appServer =
    stdio &&
    args.includes('app-server') &&
    !args.includes('generate-json-schema') &&
    !args.includes('generate-ts');
  if (appServer) connect();
  const child = spawn(real, args, { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env } });
  const overflow = () => {
    degraded = true;
    if (socket) socket.destroy();
  };
  const client = new JsonLines((m) => observer.client(m), overflow),
    server = new JsonLines((m) => observer.server(m), overflow);
  if (appServer) {
    process.stdin.on('data', (b) => client.push(b));
    child.stdout.on('data', (b) => server.push(b));
  }
  process.stdin.pipe(child.stdin);
  child.stdout.pipe(process.stdout);
  child.stdin.on('error', () => {});
  process.stdout.on('error', () => child.kill('SIGTERM'));
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => child.kill(sig));
  function finish(code) {
    exiting = true;
    clearTimeout(retry);
    if (socket) socket.destroy();
    process.exitCode = code;
    process.stdin.destroy();
  }
  child.on('error', (e) => {
    process.stderr.write(`Codex Activity proxy: ${e.message}\n`);
    finish(1);
  });
  child.on('exit', (code, signal) => finish(code ?? (signal === 'SIGINT' ? 130 : 1)));
  process.stdin.on('end', () => {
    /* EOF is forwarded by pipe; child owns shutdown. */
  });
}
if (require.main === module) {
  const [real, ...args] = process.argv.slice(2);
  if (!real || !path.isAbsolute(real) || path.resolve(real) === __filename) {
    process.stderr.write('Expected an absolute real Codex executable path\n');
    process.exitCode = 1;
  } else run(real, args);
}
module.exports = { run };
