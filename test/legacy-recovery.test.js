'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { parse } = require('jsonc-parser');
const { overlay, palette, atomicJson } = require('../src/appearance');
const { ColorLease } = require('../src/color-lease');
const { LegacyRecovery } = require('../src/legacy-recovery');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-migration-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'project', '.vscode', 'settings.json');
  const root = path.join(dir, 'runtime');
  fs.mkdirSync(root);
  let value;
  const updates = [];
  const vscode = {
    ConfigurationTarget: { Workspace: 2 },
    workspace: {
      getConfiguration: () => ({
        inspect: () => ({ workspaceValue: value }),
        get: () => value,
        update: async (_, next) => {
          value = next;
          updates.push(next);
          fs.writeFileSync(
            file,
            JSON.stringify(next ? { 'workbench.colorCustomizations': next } : {}),
          );
        },
      }),
    },
  };
  const recovery = new LegacyRecovery(vscode, { file, container: 'folder' }, () => {}, { root });
  t.after(() => recovery.dispose());
  const seed = (journalPath, owner) => {
    const base = { 'editor.background': '#112233', 'statusBar.background': '#010203' };
    const applied = overlay(base, palette('approval', { surface: 'both' }));
    value = applied.colors;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ 'workbench.colorCustomizations': value }));
    atomicJson(journalPath, { ...applied.journal, container: 'folder', owner });
    return base;
  };
  return { recovery, file, root, updates, seed };
}
test('migration leaves a clean project untouched and releases its temporary lease', async (t) => {
  const f = fixture(t);
  await f.recovery.start();
  assert.equal(fs.existsSync(path.dirname(f.file)), false);
  assert.equal(f.updates.length, 0);
  assert.equal(f.recovery.lease, null);
});
test('migration restores a generated-workspace-era journal without applying new colors', async (t) => {
  const f = fixture(t);
  const journal = f.file + '.appearance.json';
  const base = f.seed(journal);
  await f.recovery.start();
  assert.deepEqual(parse(fs.readFileSync(f.file, 'utf8'))['workbench.colorCustomizations'], base);
  assert.equal(fs.existsSync(journal), false);
  assert.equal(f.updates.length, 1);
  assert.equal(f.recovery.detail, null);
});
test('migration waits for live old owners, then restores the normal journal', async (t) => {
  const f = fixture(t);
  const old = new ColorLease(f.file, () => {}, f.root);
  t.after(() => old.dispose());
  const base = f.seed(old.journalPath, old.owner.token);
  await f.recovery.start();
  assert.equal(f.updates.length, 0);
  assert.match(f.recovery.detail, /older window/);
  old.dispose();
  f.recovery.lease.refresh();
  await f.recovery.retry();
  assert.deepEqual(parse(fs.readFileSync(f.file, 'utf8'))['workbench.colorCustomizations'], base);
  assert.equal(fs.existsSync(old.journalPath), false);
  assert.equal(f.recovery.lease, null);
});
test('invalid JSONC retains the recovery journal and reports a recoverable limitation', async (t) => {
  const f = fixture(t);
  const journal = f.file + '.appearance.json';
  f.seed(journal);
  fs.writeFileSync(f.file, '{broken');
  await f.recovery.start();
  assert.equal(fs.existsSync(journal), true);
  assert.equal(f.updates.length, 0);
  assert.match(f.recovery.detail, /invalid JSONC/);
});
