'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { EVENTS, privateDirectory } = require('./activity-helper');

const OWNER = 'tloureiro.codex-activity-status/project-hooks/v1';
const HOOK_LABELS = {
  SessionStart: 'Codex Activity — session started',
  UserPromptSubmit: 'Codex Activity — prompt submitted',
  PreToolUse: 'Codex Activity — tool starting',
  PermissionRequest: 'Codex Activity — permission requested',
  PostToolUse: 'Codex Activity — tool finished',
  Stop: 'Codex Activity — turn stopped; check completion',
  Interrupt: 'Codex Activity — turn interrupted',
};
const IGNORE =
  '# Codex Activity (local installation)\n/hooks.json\n/codex-activity/\n/.gitignore\n';
const quote = (value) => "'" + value.replace(/'/g, "'\\''") + "'";
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
function read(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
function regular(file) {
  try {
    const stat = fs.lstatSync(file);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
function atomic(file, text, mode = 0o600) {
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, text, { mode, flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch {
      /* Already published. */
    }
  }
}
function runtimeRoot(project, tmp = os.tmpdir()) {
  const parent = path.join(tmp, 'codex-activity-' + process.getuid());
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (!privateDirectory(parent)) throw new Error('Unsafe activity storage directory.');
  const root = path.join(parent, 'project-' + hash(project).slice(0, 24));
  fs.mkdirSync(root, { mode: 0o700, recursive: true });
  if (!privateDirectory(root)) throw new Error('Unsafe project activity storage.');
  return root;
}
async function resolveNode(configured = '') {
  const candidates = configured
    ? [configured]
    : [
        '/opt/homebrew/bin/node',
        '/usr/local/bin/node',
        ...(process.env.PATH || '')
          .split(path.delimiter)
          .filter(Boolean)
          .map((directory) => path.join(directory, 'node')),
      ];
  for (const candidate of [...new Set(candidates)]) {
    if (!path.isAbsolute(candidate)) continue;
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      const version = await new Promise((resolve, reject) =>
        execFile(
          candidate,
          ['--version'],
          {
            timeout: 2000,
            maxBuffer: 1024,
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
          },
          (error, stdout) => (error ? reject(error) : resolve(stdout.trim())),
        ),
      );
      if (/^v(\d+)\./.test(version) && Number(version.slice(1).split('.')[0]) >= 18)
        return candidate;
    } catch {
      /* Try another independently installed Node runtime. */
    }
  }
  throw new Error(
    'Node.js 18+ is required for the project helper. Install Node or set codexActivity.nodePath.',
  );
}

class ProjectHooks {
  constructor(project, extensionPath, options = {}) {
    this.project = fs.realpathSync(project);
    this.source = path.join(extensionPath, 'src/activity-helper.js');
    this.codex = path.join(this.project, '.codex');
    this.directory = path.join(this.codex, 'codex-activity');
    this.hooksFile = path.join(this.codex, 'hooks.json');
    this.ignoreFile = path.join(this.codex, '.gitignore');
    this.manifestFile = path.join(this.directory, 'installation.json');
    this.tmp = options.tmp;
  }
  safePaths() {
    for (const directory of [this.codex, this.directory]) {
      try {
        const stat = fs.lstatSync(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink())
          throw new Error('Project integration paths must be ordinary directories.');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    for (const file of [
      this.hooksFile,
      this.ignoreFile,
      this.manifestFile,
      path.join(this.directory, 'observer.js'),
      path.join(this.directory, 'observer-config.json'),
    ]) {
      try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink())
          throw new Error('Project integration files must be ordinary files.');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  status() {
    try {
      this.safePaths();
      const hooks = read(this.hooksFile);
      const installed = read(this.manifestFile);
      if (!installed) {
        const orphaned = ['observer.js', 'observer-config.json'].some(
          (name) => read(path.join(this.directory, name)) !== null,
        );
        return hooks === null && !orphaned
          ? { code: 'setup', detail: 'Enable activity for this project.' }
          : {
              code: 'conflict',
              detail:
                hooks !== null
                  ? 'This project already has hooks.json. It has been left unchanged.'
                  : 'Local helper files have no ownership manifest. Review them manually; no files were changed.',
            };
      }
      const manifest = JSON.parse(installed);
      if (manifest.owner !== OWNER || manifest.project !== this.project)
        return {
          code: 'conflict',
          detail: 'Unrecognized project integration. No files were changed.',
        };
      if (hooks !== null && hash(hooks) !== manifest.hooksHash)
        return {
          code: 'conflict',
          detail:
            'The project hooks were edited. Automatic updates are paused to preserve your changes.',
        };
      const helper = read(path.join(this.directory, 'observer.js'));
      const config = read(path.join(this.directory, 'observer-config.json'));
      if (
        (helper !== null && hash(helper) !== manifest.helperHash) ||
        (config !== null && hash(config) !== manifest.configHash)
      )
        return {
          code: 'conflict',
          detail:
            'The local helper was edited. Automatic updates are paused to preserve your changes.',
        };
      const ready =
        hooks === this.configuration(manifest.node) &&
        helper !== null &&
        hash(helper) === hash(fs.readFileSync(this.source)) &&
        config !== null &&
        hash(config) === manifest.configHash &&
        fs.existsSync(manifest.node) &&
        (read(this.ignoreFile) || '').includes(IGNORE);
      return {
        code: ready ? 'installed' : 'repair',
        detail: ready
          ? 'Hooks installed. Review them in Codex settings → Hooks, then start a new chat.'
          : 'Run Codex Activity: Repair or Set Up to update the hooks and helper.',
        manifest,
      };
    } catch (error) {
      return { code: 'conflict', detail: error.message };
    }
  }
  configuration(node) {
    const command = `${quote(node)} ${quote(path.join(this.directory, 'observer.js'))} >/dev/null 2>&1 || :`;
    const hooks = {
      description: OWNER,
      hooks: Object.fromEntries(
        [...EVENTS].map((event) => [
          event,
          [
            {
              hooks: [
                {
                  type: 'command',
                  command,
                  statusMessage: HOOK_LABELS[event],
                  async: true,
                  timeout: 1,
                },
              ],
            },
          ],
        ]),
      ),
    };
    return JSON.stringify(hooks, null, 2) + '\n';
  }
  plan(node) {
    this.safePaths();
    const status = this.status();
    if (status.code === 'conflict') throw new Error(status.detail);
    return {
      node,
      hooks: this.configuration(node),
      beforeIgnore: read(this.ignoreFile),
      beforeFiles: this.snapshot(),
      status,
    };
  }
  snapshot() {
    return [
      this.hooksFile,
      this.ignoreFile,
      this.manifestFile,
      path.join(this.directory, 'observer.js'),
      path.join(this.directory, 'observer-config.json'),
    ].map((file) => [file, read(file)]);
  }
  check(plan) {
    this.safePaths();
    if (JSON.stringify(this.snapshot()) !== JSON.stringify(plan.beforeFiles))
      throw new Error('Project files changed during confirmation. Review setup again.');
  }
  install(plan) {
    this.check(plan);
    const root = runtimeRoot(this.project, this.tmp);
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const config = JSON.stringify({ schema: 1, project: this.project, root });
    const helper = fs.readFileSync(this.source, 'utf8');
    const manifest = {
      owner: OWNER,
      project: this.project,
      root,
      node: plan.node,
      hooksHash: hash(plan.hooks),
      helperHash: hash(helper),
      configHash: hash(config),
      installedAt: new Date().toISOString(),
    };
    // Publish the command registration last. No partially installed hook is enabled.
    const ignore = plan.beforeIgnore || '';
    const nextIgnore = ignore.includes(IGNORE)
      ? ignore
      : ignore + (ignore && !ignore.endsWith('\n') ? '\n' : '') + IGNORE;
    atomic(
      this.ignoreFile,
      nextIgnore,
      regular(this.ignoreFile) ? fs.statSync(this.ignoreFile).mode & 0o777 : 0o644,
    );
    atomic(path.join(this.directory, 'observer.js'), helper);
    atomic(path.join(this.directory, 'observer-config.json'), config);
    atomic(this.manifestFile, JSON.stringify(manifest, null, 2) + '\n');
    atomic(this.hooksFile, plan.hooks);
    return manifest;
  }
  remove() {
    this.safePaths();
    const status = this.status();
    const manifest = status.manifest;
    if (!manifest || !['installed', 'repair'].includes(status.code))
      throw new Error(
        'Cannot remove edited or unrecognized project hooks automatically. Open the hook file to review it.',
      );
    // Unregister before removing the helper. Never remove somebody else's edits.
    if (read(this.hooksFile) !== null) fs.unlinkSync(this.hooksFile);
    for (const [name, expected] of [
      ['observer.js', manifest.helperHash],
      ['observer-config.json', manifest.configHash],
    ]) {
      const file = path.join(this.directory, name);
      const data = read(file);
      if (data !== null && hash(data) === expected) fs.unlinkSync(file);
    }
    fs.unlinkSync(this.manifestFile);
    // Retain ignore rules: they protect any local edits and do not affect execution.
    try {
      fs.rmdirSync(this.directory);
    } catch {
      /* Preserve unknown files. */
    }
  }
}
module.exports = { ProjectHooks, resolveNode, runtimeRoot, atomic, OWNER, IGNORE, hash };
