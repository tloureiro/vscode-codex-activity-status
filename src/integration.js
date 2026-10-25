'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const START = '# BEGIN codex-completion notifier';
const END = '# END codex-completion notifier';
// Cleanup signatures only. They are never used to observe current Codex activity.
const LEGACY_START = '# BEGIN codex-activity-status completion notifier';
const LEGACY_END = '# END codex-activity-status completion notifier';
const LEGACY_SOUND = '/usr/bin/afplay /System/Library/Sounds/Sosumi.aiff';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function codexHome(env = process.env) {
  return env.CODEX_HOME ? path.resolve(env.CODEX_HOME) : path.join(os.homedir(), '.codex');
}

function markerPattern(start = START, end = END) {
  return new RegExp(
    `^[ \\t]*${escapeRegex(start)}[\\s\\S]*?[ \\t]*${escapeRegex(end)}[ \\t]*(?:\\n{1,2}|$)`,
    'gm',
  );
}

function removeOwnedNotify(text) {
  return text.replace(markerPattern(), '').replace(markerPattern(LEGACY_START, LEGACY_END), '');
}

function tableSegments(text) {
  const headers = [...text.matchAll(/^[ \t]*(\[{1,2}[^\n]+\]{1,2})[ \t]*(?:\n|$)/gm)];
  return headers.map((match, index) => ({
    header: match[1].replace(/\s/g, ''),
    start: match.index,
    end: headers[index + 1]?.index ?? text.length,
    body: text.slice(match.index, headers[index + 1]?.index ?? text.length),
  }));
}

function isLegacyHookCommand(command) {
  return (
    command === LEGACY_SOUND ||
    /codex[-_. ]?activity(?:[-_. ]?status)?/i.test(command) ||
    /tloureiro\.codex-activity-status/i.test(command)
  );
}

function commandFromSegment(segment) {
  const match = /^[ \t]*command[ \t]*=[ \t]*(["'])(.*?)\1[ \t]*$/m.exec(segment.body);
  return match?.[2] || '';
}

function legacyHookCommands(text) {
  return tableSegments(text)
    .filter((segment) => /^\[\[hooks\.[^.\]]+\.hooks\]\]$/.test(segment.header))
    .map(commandFromSegment)
    .filter((command) => command && isLegacyHookCommand(command));
}

function removeLegacyTomlHooks(text) {
  const segments = tableSegments(text);
  const remove = new Set();
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    const command = commandFromSegment(segment);
    if (!/^\[\[hooks\.[^.\]]+\.hooks\]\]$/.test(segment.header)) continue;
    if (!command || !isLegacyHookCommand(command)) continue;
    remove.add(index);
    const eventMatch = /^\[\[hooks\.([^.\]]+)\.hooks\]\]$/.exec(segment.header);
    if (!eventMatch) continue;
    const groupHeader = `[[hooks.${eventMatch[1]}]]`;
    let group = index - 1;
    while (group >= 0 && segments[group].header !== groupHeader) group--;
    if (group >= 0) {
      const nextGroup = segments.findIndex(
        (candidate, candidateIndex) => candidateIndex > group && candidate.header === groupHeader,
      );
      const end = nextGroup < 0 ? segments.length : nextGroup;
      const remainingHandler = segments.some(
        (candidate, candidateIndex) =>
          candidateIndex > group &&
          candidateIndex < end &&
          candidate.header === segment.header &&
          !remove.has(candidateIndex),
      );
      if (!remainingHandler) remove.add(group);
    }
  }
  if (!remove.size) return { text, removed: [] };
  const removed = [...remove].map((index) => commandFromSegment(segments[index])).filter(Boolean);
  const noStopHooks = segments.every(
    (segment, index) => segment.header !== '[[hooks.Stop]]' || remove.has(index),
  );
  if (noStopHooks) {
    for (let index = 0; index < segments.length; index++)
      if (/^\[hooks\.state\..*:stop:\d+:\d+"\]$/i.test(segments[index].header)) remove.add(index);
    const state = segments.findIndex((segment) => segment.header === '[hooks.state]');
    if (state >= 0) {
      let hasRemainingChild = false;
      for (let index = state + 1; index < segments.length; index++) {
        if (!/^\[hooks\.state\./.test(segments[index].header)) break;
        if (!remove.has(index)) hasRemainingChild = true;
      }
      if (!hasRemainingChild) remove.add(state);
    }
  }
  let output = '';
  let cursor = 0;
  for (let index = 0; index < segments.length; index++) {
    output += text.slice(cursor, segments[index].start);
    if (!remove.has(index)) output += text.slice(segments[index].start, segments[index].end);
    cursor = segments[index].end;
  }
  output += text.slice(cursor);
  return { text: output.replace(/\n{3,}/g, '\n\n'), removed: [...new Set(removed)] };
}

function removeLegacyJsonHooks(text) {
  const data = JSON.parse(text);
  const removed = [];
  if (!data.hooks || typeof data.hooks !== 'object') return { text, removed };
  for (const [event, groups] of Object.entries(data.hooks)) {
    if (!Array.isArray(groups)) continue;
    data.hooks[event] = groups
      .map((group) => {
        if (!Array.isArray(group?.hooks)) return group;
        const hooks = group.hooks.filter((hook) => {
          if (typeof hook?.command !== 'string' || !isLegacyHookCommand(hook.command)) return true;
          removed.push(hook.command);
          return false;
        });
        return { ...group, hooks };
      })
      .filter((group) => !Array.isArray(group?.hooks) || group.hooks.length);
    if (!data.hooks[event].length) delete data.hooks[event];
  }
  return { text: removed.length ? JSON.stringify(data, null, 2) + '\n' : text, removed };
}

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  let mode = 0o600;
  try {
    mode = fs.statSync(file).mode & 0o777;
  } catch {
    // A new user config is private by default.
  }
  fs.writeFileSync(temporary, text, { mode });
  fs.renameSync(temporary, file);
}

class Integration {
  constructor(vscode, context, options = {}) {
    this.vscode = vscode;
    this.context = context;
    this.directory = context.globalStorageUri.fsPath;
    this.launcher = path.join(this.directory, 'codex-completion-notify');
    this.notifier = path.join(this.directory, 'notifier.js');
    const home = options.codexHome || codexHome();
    this.config = path.join(home, 'config.toml');
    this.hooksJson = path.join(home, 'hooks.json');
  }
  readConfig() {
    try {
      return fs.readFileSync(this.config, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return '';
      throw error;
    }
  }
  legacy() {
    const configured = this.vscode.workspace
      .getConfiguration('chatgpt')
      .inspect('cliExecutable')?.globalValue;
    const saved = this.context.globalState.get('bridge'); // State written by pre-0.3 releases.
    const ownedLauncher =
      typeof configured === 'string' &&
      (configured === saved?.launcher ||
        (path.dirname(configured) === this.directory &&
          path.basename(configured) === 'codex-activity-proxy'));
    const hooks = legacyHookCommands(this.readConfig());
    try {
      hooks.push(...removeLegacyJsonHooks(fs.readFileSync(this.hooksJson, 'utf8')).removed);
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    return { ownedLauncher, hooks: [...new Set(hooks)] };
  }
  plan() {
    // Snapshot every cleanup target before consent, including absent files.
    const files = [
      this.config,
      this.hooksJson,
      this.launcher,
      this.notifier,
      path.join(this.directory, 'codex-activity-proxy'),
    ];
    const saved = this.context.globalState.get('bridge');
    if (saved?.launcher && path.dirname(saved.launcher) === this.directory)
      files.push(saved.launcher);
    const before = [...new Set(files)].map((file) => {
      for (const candidate of [path.dirname(file), file]) {
        try {
          if (fs.lstatSync(candidate).isSymbolicLink())
            throw new Error('Legacy cleanup paths must not be symlinks.');
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      try {
        if (!fs.lstatSync(file).isFile()) throw new Error('Legacy cleanup expects ordinary files.');
        return [file, fs.readFileSync(file, 'utf8')];
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return [file, null];
      }
    });
    // Parse both formats before performing any cleanup.
    const config = this.readConfig();
    const json = before.find(([file]) => file === this.hooksJson)[1];
    if (json !== null) removeLegacyJsonHooks(json);
    const legacy = this.legacy();
    const notify = removeOwnedNotify(config) !== config;
    const artifacts = before.filter(
      ([file, text]) => text !== null && path.dirname(file) === this.directory,
    ).length;
    return {
      before,
      bridge: JSON.stringify(saved),
      executable: this.vscode.workspace.getConfiguration('chatgpt').inspect('cliExecutable')
        ?.globalValue,
      needed: Boolean(notify || legacy.ownedLauncher || legacy.hooks.length || artifacts || saved),
      detail: `${legacy.hooks.length} legacy hook(s), ${notify ? 1 : 0} notify block, ${legacy.ownedLauncher ? 1 : 0} executable override, ${artifacts} old helper file(s).`,
    };
  }
  check(plan) {
    const current = this.plan();
    if (JSON.stringify(current) !== JSON.stringify(plan))
      throw new Error('Legacy integration changed during confirmation. Run repair again.');
  }
  async restoreProxy() {
    const c = this.vscode.workspace.getConfiguration('chatgpt');
    const configured = c.inspect('cliExecutable')?.globalValue;
    const saved = this.context.globalState.get('bridge');
    const owned =
      typeof configured === 'string' &&
      (configured === saved?.launcher ||
        (path.dirname(configured) === this.directory &&
          path.basename(configured) === 'codex-activity-proxy'));
    if (owned)
      await c.update(
        'cliExecutable',
        saved?.had ? saved.previous : undefined,
        this.vscode.ConfigurationTarget.Global,
      );
    const candidates = new Set([
      saved?.launcher,
      path.join(this.directory, 'codex-activity-proxy'),
    ]);
    for (const file of candidates) {
      if (!file || path.dirname(file) !== this.directory) continue;
      try {
        fs.unlinkSync(file);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    await this.context.globalState.update('bridge', undefined);
    return owned;
  }
  removeLegacyHooks() {
    const removed = [];
    const configText = this.readConfig();
    const toml = removeLegacyTomlHooks(configText);
    if (toml.removed.length) {
      atomicWrite(this.config, toml.text);
      removed.push(...toml.removed);
    }
    try {
      const original = fs.readFileSync(this.hooksJson, 'utf8');
      const json = removeLegacyJsonHooks(original);
      if (json.removed.length) {
        atomicWrite(this.hooksJson, json.text);
        removed.push(...json.removed);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return [...new Set(removed)];
  }
  async cleanupLegacy() {
    const proxy = await this.restoreProxy();
    const hooks = this.removeLegacyHooks();
    return { proxy, hooks };
  }
  async remove(plan = this.plan()) {
    this.check(plan);
    const removed = await this.cleanupLegacy();
    const text = this.readConfig();
    const next = removeOwnedNotify(text);
    if (next !== text) atomicWrite(this.config, next);
    for (const file of [this.launcher, this.notifier]) {
      try {
        fs.unlinkSync(file);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    return removed;
  }
}

module.exports = {
  Integration,
  START,
  END,
  LEGACY_SOUND,
  removeOwnedNotify,
  legacyHookCommands,
  removeLegacyTomlHooks,
  removeLegacyJsonHooks,
};
