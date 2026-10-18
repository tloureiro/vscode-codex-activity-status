'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { JsonLines } = require('./protocol');
const { atomicJson } = require('./appearance');
function runtimeRoot() {
  const root = path.join(os.tmpdir(), 'codex-activity-' + process.getuid());
  fs.mkdirSync(root, { mode: 0o700, recursive: true });
  const stat = fs.lstatSync(root);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid() ||
    stat.mode & 0o077
  )
    throw new Error('Unsafe activity runtime directory');
  return root;
}
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code !== 'ESRCH';
  }
}
async function listen(onConnect, onEvent, onDisconnect, root = runtimeRoot(), options = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  const socketPath = path.join(
    root,
    `${process.pid}-${crypto.randomBytes(4).toString('hex')}.sock`,
  );
  const registry = path.join(root, process.pid + '.json');
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    let authenticated = false,
      source,
      diagnosticOnly = false;
    const deadline = setTimeout(() => socket.destroy(), 2000);
    const parser = new JsonLines(
      (m) => {
        if (diagnosticOnly) return;
        if (!authenticated) {
          if (m.token !== token || m.parent !== process.pid) {
            socket.destroy();
            return;
          }
          clearTimeout(deadline);
          // A diagnostics client never becomes a Codex source and cannot change
          // activity or acknowledge completion. Authenticate it identically.
          if (m.diagnostics === true) {
            diagnosticOnly = true;
            try {
              socket.end(
                JSON.stringify(
                  options.diagnostics
                    ? { diagnostics: options.diagnostics() }
                    : { error: 'Diagnostics unavailable in this host' },
                ) + '\n',
              );
            } catch {
              socket.end(JSON.stringify({ error: 'Diagnostics snapshot failed' }) + '\n');
            }
            return;
          }
          authenticated = true;
          source = crypto.randomUUID();
          onConnect(source);
        } else if (m.event && typeof m.event.type === 'string') onEvent(source, m.event);
      },
      () => socket.destroy(),
    );
    socket.on('data', (b) => parser.push(b));
    socket.on('error', () => {});
    socket.on('close', () => {
      clearTimeout(deadline);
      sockets.delete(socket);
      if (authenticated) onDisconnect(source);
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  fs.chmodSync(socketPath, 0o600);
  atomicJson(registry, { socketPath, token, pid: process.pid, diagnostics: !!options.diagnostics });
  return {
    registry,
    socketPath,
    reset() {
      for (const socket of sockets) socket.destroy();
    },
    dispose() {
      for (const socket of sockets) socket.destroy();
      server.close();
      try {
        const data = JSON.parse(fs.readFileSync(registry, 'utf8'));
        if (data.token === token) fs.unlinkSync(registry);
      } catch {
        /* Already gone. */
      }
    },
  };
}
module.exports = { runtimeRoot, listen, alive };
