'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parse, modify, applyEdits } = require('jsonc-parser');
const defaults = { processing: '#245A91', finished: '#625B78', approval: '#A66B16' };
function validColor(value, fallback) {
  return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value : fallback;
}
function foreground(hex) {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  const l = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return (l + 0.05) / 0.05 > 1.05 / (l + 0.05) ? '#000000' : '#FFFFFF';
}
function palette(state, config) {
  if (!defaults[state]) return {};
  const bg = validColor(config[state + 'Color'], defaults[state]),
    fg = foreground(bg),
    out = {};
  if (config.surface !== 'titleBar') {
    // Newer VS Code themes can replace statusBar.background on blur. Keep the
    // activity visible in both focus states; journal/restore this key as usual.
    out['statusBar.inactiveBackground'] = bg;
    for (const [background, foregroundKey] of [
      ['statusBar.background', 'statusBar.foreground'],
      ['statusBar.debuggingBackground', 'statusBar.debuggingForeground'],
      ['statusBar.noFolderBackground', 'statusBar.noFolderForeground'],
    ]) {
      out[background] = bg;
      out[foregroundKey] = fg;
    }
    out['statusBar.border'] = bg;
  }
  if (config.surface === 'titleBar' || config.surface === 'both') {
    for (const focus of ['active', 'inactive']) {
      out[`titleBar.${focus}Background`] = bg;
      out[`titleBar.${focus}Foreground`] = fg;
    }
    out['titleBar.border'] = bg;
  }
  return out;
}
const clone = (x) => (x === undefined ? undefined : structuredClone(x));
function equal(a, b) {
  if (a === b) return true;
  if (
    !a ||
    !b ||
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]))
  );
}
// Journal only keys owned by the overlay; a user's edits always win restoration.
function restore(current, journal) {
  const out = clone(current || {});
  for (const entry of journal?.entries || []) {
    const target = entry.block ? out[entry.block] : out;
    if (
      !target ||
      ![entry.applied, ...(entry.previous || [])].some((v) => equal(target[entry.key], v))
    )
      continue;
    if (entry.had) target[entry.key] = entry.original;
    else delete target[entry.key];
    if (entry.block && !Object.keys(target).length) delete out[entry.block];
  }
  return out;
}
function overlay(current, colors, effective = {}) {
  const out = clone(current || {}),
    entries = [];
  const blocks = new Set([
    '',
    ...Object.keys(effective).filter((k) => k.startsWith('[')),
    ...Object.keys(out).filter((k) => k.startsWith('[')),
  ]);
  for (const block of blocks) {
    if (block && !out[block]) out[block] = {};
    const target = block ? out[block] : out;
    if (!target || typeof target !== 'object') continue;
    for (const [key, applied] of Object.entries(colors)) {
      entries.push({
        block,
        key,
        had: Object.hasOwn(target, key),
        original: clone(target[key]),
        applied,
      });
      target[key] = applied;
    }
  }
  return { colors: out, journal: { entries, hadColors: current !== undefined } };
}
function atomicJson(path, value) {
  const tmp = path + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(tmp, path);
}
function removeCreatedSettings(file, journal) {
  if (journal?.container !== 'folder' || !journal.createdSettingsFile) return;
  try {
    // Keep user settings, comments, and replacement symlinks. An empty file is
    // ours to remove only when the journal recorded its original absence.
    if (!fs.lstatSync(file).isFile() || !/^\s*\{\s*\}\s*$/.test(fs.readFileSync(file, 'utf8')))
      return;
    fs.unlinkSync(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (journal.createdSettingsDirectory) {
    try {
      fs.rmdirSync(path.dirname(file));
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
    }
  }
}
function restoreFile(workspace, journalPath) {
  if (!fs.existsSync(journalPath)) return;
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  if (!fs.existsSync(workspace)) {
    removeCreatedSettings(workspace, journal);
    fs.unlinkSync(journalPath);
    return;
  }
  const text = fs.readFileSync(workspace, 'utf8'),
    errors = [],
    data = parse(text, errors);
  if (errors.length || !data || typeof data !== 'object')
    throw new Error('Settings file is invalid JSONC; keeping recovery journal');
  const settings = journal.container === 'folder' ? data : data.settings;
  if (!settings) {
    fs.unlinkSync(journalPath);
    return;
  }
  const colors = restore(settings['workbench.colorCustomizations'], journal);
  const value = !journal.hadColors && !Object.keys(colors).length ? undefined : colors;
  fs.writeFileSync(
    workspace,
    applyEdits(
      text,
      modify(
        text,
        journal.container === 'folder'
          ? ['workbench.colorCustomizations']
          : ['settings', 'workbench.colorCustomizations'],
        value,
        { formattingOptions: { insertSpaces: true, tabSize: 2 } },
      ),
    ),
  );
  removeCreatedSettings(workspace, journal);
  fs.unlinkSync(journalPath);
}
class Appearance {
  constructor(vscode, workspace, options = {}) {
    this.vscode = vscode;
    this.workspace = workspace;
    this.options = options;
    this.journalPath = options.journalPath || workspace + '.appearance.json';
    this.queue = Promise.resolve();
    this.last = null;
    this.stopping = false;
    this.pending = null;
    this.running = false;
    this.timings = [];
  }
  update(state, config) {
    // Keep only the newest requested appearance while a settings write is in
    // flight. A focus acknowledgement must not wait behind obsolete colors.
    this.pending = { state, config, requestedAt: Date.now(), retries: 0 };
    if (!this.running) {
      this.running = true;
      this.queue = Promise.resolve().then(() => this.drain());
    }
    return this.queue;
  }
  async drain() {
    let failure;
    try {
      while (this.pending) {
        const request = this.pending;
        this.pending = null;
        const state = this.stopping ? 'unknown' : request.state;
        const started = Date.now();
        try {
          const result = await this.apply(state, request.config);
          failure = undefined;
          if (result === 'reconcile') {
            if (!this.pending && request.retries < 8) {
              // The renderer's settings cache and disk can catch up without a
              // second click. An incoming newer request takes precedence.
              request.retries++;
              this.pending = request;
              await new Promise((resolve) => setTimeout(resolve, 50));
              continue;
            }
            if (!this.pending)
              throw new Error('Appearance settings did not synchronize; see activity diagnostics.');
          }
          this.record({
            state,
            waitMs: started - request.requestedAt,
            elapsedMs: Date.now() - request.requestedAt,
            retries: request.retries,
            outcome: result || 'settled',
          });
        } catch (error) {
          failure = error;
          this.record({
            state,
            elapsedMs: Date.now() - request.requestedAt,
            retries: request.retries,
            outcome: 'error',
            error: error.message,
          });
        }
      }
      if (failure) throw failure;
    } finally {
      this.running = false;
    }
  }
  record(entry) {
    if (entry.outcome === 'unchanged' && !entry.retries) return;
    const event = { at: new Date().toISOString(), ...entry };
    this.timings.push(event);
    if (this.timings.length > 30) this.timings.shift();
    this.options.onUpdate?.(event);
  }
  async apply(state, config) {
    const c = this.vscode.workspace.getConfiguration('workbench');
    const current = c.inspect('colorCustomizations')?.workspaceValue;
    if (this.options.canHighlight && !this.options.canHighlight()) state = 'unknown';
    const signature = JSON.stringify(palette(state, config));
    if (this.signature === signature && equal(current, this.last)) return 'unchanged';
    if (this.options.verifyDisk) {
      // A crash helper or another window may restore the file before VS Code's
      // configuration cache sees it. Wait for that configuration event instead
      // of capturing the departing window's overlay as the user's baseline.
      const errors = [];
      const data = fs.existsSync(this.workspace)
        ? parse(fs.readFileSync(this.workspace, 'utf8'), errors)
        : {};
      const settings = this.options.container === 'folder' ? data : data?.settings;
      if (errors.length)
        throw new Error(
          'Appearance settings contain invalid JSONC; fix the file to resume coloring.',
        );
      if (!equal(current, settings?.['workbench.colorCustomizations'])) return 'reconcile';
    }
    const journal = fs.existsSync(this.journalPath)
      ? JSON.parse(fs.readFileSync(this.journalPath, 'utf8'))
      : null;
    if (journal?.owner && journal.owner !== this.options.owner && !this.options.canRestoreOther?.())
      return 'otherOwner';
    const base = restore(current, journal);
    const colors = palette(state, config);
    const next = Object.keys(colors).length
      ? overlay(base, colors, c.get('colorCustomizations'))
      : { colors: base, journal: null };
    // Preserve the absence of the workspace override as well as its keys.
    const had = journal ? journal.hadColors : current !== undefined;
    if (next.journal) {
      next.journal.hadColors = had;
      next.journal.container = this.options.container || 'workspace';
      if (next.journal.container === 'folder') {
        // Carry provenance through palette changes, owner handoffs and crashes.
        // Older journals have no provenance, so never delete their settings file.
        next.journal.createdSettingsFile = journal
          ? journal.createdSettingsFile === true
          : !fs.existsSync(this.workspace);
        next.journal.createdSettingsDirectory = journal
          ? journal.createdSettingsDirectory === true
          : !fs.existsSync(path.dirname(this.workspace));
      }
      if (this.options.owner) next.journal.owner = this.options.owner;
      for (const entry of next.journal.entries) {
        const old = journal?.entries.find((e) => e.block === entry.block && e.key === entry.key);
        if (old)
          entry.previous = [old.applied, ...(old.previous || [])].filter(
            (v, i, a) => a.indexOf(v) === i,
          );
      }
      atomicJson(this.journalPath, next.journal);
    }
    const value = !had && !Object.keys(next.colors).length ? undefined : next.colors;
    this.last = clone(value);
    this.signature = signature;
    if (!equal(current, value)) {
      try {
        await c.update('colorCustomizations', value, this.vscode.ConfigurationTarget.Workspace);
      } catch (error) {
        this.signature = undefined;
        throw error;
      }
    }
    if (next.journal) {
      // Previous colors are recovery candidates only until the settings write
      // commits. Keeping them longer would mistake a later user edit for ours.
      for (const entry of next.journal.entries) delete entry.previous;
      atomicJson(this.journalPath, next.journal);
    } else if (journal) {
      try {
        removeCreatedSettings(this.workspace, journal);
        fs.unlinkSync(this.journalPath);
      } catch (error) {
        this.signature = undefined;
        throw error;
      }
    }
    return equal(current, value) ? 'unchanged' : 'written';
  }
  isOwnChange() {
    return equal(
      this.vscode.workspace.getConfiguration('workbench').inspect('colorCustomizations')
        ?.workspaceValue,
      this.last,
    );
  }
  async dispose() {
    this.stopping = true;
    await this.update('unknown', {});
  }
}
module.exports = {
  defaults,
  validColor,
  foreground,
  palette,
  overlay,
  restore,
  restoreFile,
  atomicJson,
  Appearance,
};
