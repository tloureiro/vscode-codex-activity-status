'use strict';
const { spawn } = require('node:child_process');
const readline = require('node:readline');

class Client {
  constructor(binary, root, env, sandboxProfile) {
    this.child = spawn('/usr/bin/sandbox-exec', ['-f', sandboxProfile, binary, 'app-server'], {
      cwd: root,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.messages = [];
    this.pending = new Map();
    this.nextId = 1;
    this.errors = '';
    this.child.stderr.on('data', (chunk) => {
      this.errors = (this.errors + chunk).slice(-12000);
    });
    readline.createInterface({ input: this.child.stdout }).on('line', (line) => {
      try {
        const message = JSON.parse(line);
        this.messages.push(message);
        const entry = this.pending.get(message.id);
        if (entry) {
          this.pending.delete(message.id);
          clearTimeout(entry.timer);
          if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
          else entry.resolve(message.result);
        }
      } catch {
        /* Non-protocol output is retained in the launch log by the caller. */
      }
    });
  }
  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('RPC timeout: ' + method));
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  async initialize() {
    await this.request('initialize', {
      clientInfo: { name: 'hook-feasibility', version: '0.0.1' },
      capabilities: { experimentalApi: true },
    });
    this.child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  }
  async wait(predicate, timeout = 15000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const message = this.messages.find(predicate);
      if (message) return message;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw new Error('Notification timeout');
  }
  async close() {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    const exited = new Promise((resolve) => this.child.once('exit', resolve));
    this.child.stdin.end();
    const timer = setTimeout(() => this.child.kill(), 2000);
    await exited;
    clearTimeout(timer);
  }
}
module.exports = { Client };
