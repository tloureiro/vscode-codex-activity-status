'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { runtimeRoot, alive } = require('./bridge');

function query(registry, timeout = 1500) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(registry.socketPath);
    socket.setEncoding('utf8');
    let buffer = '',
      settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('Diagnostics request timed out')), timeout);
    socket.once('connect', () =>
      socket.write(
        JSON.stringify({ token: registry.token, parent: registry.pid, diagnostics: true }) + '\n',
      ),
    );
    socket.on('error', (error) => finish(error));
    socket.on('end', () => finish(new Error('Host closed diagnostics connection')));
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > 1024 * 1024) return finish(new Error('Diagnostics response too large'));
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      try {
        const result = JSON.parse(buffer.slice(0, newline));
        if (!result.diagnostics)
          return finish(new Error(result.error || 'Invalid diagnostics response'));
        finish(null, result.diagnostics);
      } catch (error) {
        finish(error);
      }
    });
  });
}
async function collect(root = runtimeRoot()) {
  const names = fs.readdirSync(root).filter((name) => /^\d+\.json$/.test(name));
  return Promise.all(
    names.map(async (name) => {
      let registry;
      try {
        registry = JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
        if (!alive(registry.pid)) return null;
        if (!registry.diagnostics)
          return {
            host: registry.pid,
            error: 'Reload this VS Code window once to load diagnostics instrumentation.',
          };
        return await query(registry);
      } catch (error) {
        return { host: registry?.pid, error: error.message };
      }
    }),
  ).then((results) => results.filter(Boolean));
}
module.exports = { query, collect };
