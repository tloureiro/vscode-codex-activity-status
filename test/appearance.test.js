'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parse, modify, applyEdits } = require('jsonc-parser');
const {
  palette,
  overlay,
  restore,
  foreground,
  validColor,
  restoreFile,
  Appearance,
} = require('../src/appearance');
test('K, M: palette includes whole-bar variants and equal focused/unfocused title colors', () => {
  const p = palette('processing', { surface: 'both' });
  for (const key of [
    'statusBar.background',
    'statusBar.inactiveBackground',
    'statusBar.debuggingBackground',
    'statusBar.noFolderBackground',
    'titleBar.activeBackground',
    'titleBar.inactiveBackground',
  ])
    assert.equal(p[key], '#245A91');
  assert.equal(palette('finished', {})['x'], undefined);
});
test('readability and invalid settings use safe opaque defaults', () => {
  assert.equal(foreground('#FFFFFF'), '#000000');
  assert.equal(foreground('#000000'), '#FFFFFF');
  assert.equal(validColor('#zzzzzz', '#625B78'), '#625B78');
  assert.equal(
    palette('finished', { finishedColor: 'invalid' })['statusBar.background'],
    '#625B78',
  );
});
test('L: restores owned keys and preserves user edits, theme blocks, unrelated settings', () => {
  const base = {
    'editor.background': '#111111',
    'statusBar.background': '#123456',
    'statusBar.inactiveBackground': '#112233',
    '[Dark]': {
      'statusBar.background': '#234567',
      'statusBar.inactiveBackground': '#223344',
      'editor.foreground': '#abcdef',
    },
  };
  const { colors, journal } = overlay(base, palette('approval', { surface: 'both' }), {
    '[Light]': {},
  });
  assert.equal(colors['[Dark]']['statusBar.background'], '#A66B16');
  assert.deepEqual(restore(colors, journal), base);
  colors['editor.background'] = '#222222';
  colors['statusBar.background'] = '#334455';
  const restored = restore(colors, journal);
  assert.equal(restored['editor.background'], '#222222');
  assert.equal(restored['statusBar.background'], '#334455');
});
test('crash recovery preserves JSONC and compare-and-restores only owned colors', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-appearance-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'window.code-workspace'),
    j = file + '.appearance.json';
  const { colors, journal } = overlay(undefined, palette('processing', {}));
  journal.hadColors = false;
  fs.writeFileSync(
    file,
    '// retained comment\n' +
      JSON.stringify({
        folders: [],
        settings: { 'editor.fontSize': 17, 'workbench.colorCustomizations': colors },
      }),
  );
  fs.writeFileSync(j, JSON.stringify(journal));
  restoreFile(file, j);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.startsWith('// retained'));
  assert.deepEqual(parse(text).settings, { 'editor.fontSize': 17 });
});
test('live appearance changes, disable, and user edits restore latest baseline', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-live-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let value;
  const c = {
    inspect: () => ({ workspaceValue: value }),
    get: () => value,
    update: async (_, v) => {
      value = v;
    },
  };
  const a = new Appearance(
    { workspace: { getConfiguration: () => c }, ConfigurationTarget: { Workspace: 2 } },
    path.join(dir, 'w'),
  );
  await a.update('processing', {});
  assert.equal(value['statusBar.background'], '#245A91');
  value['statusBar.background'] = '#ababab';
  value['editor.background'] = '#111111';
  await a.update('finished', { surface: 'titleBar', finishedColor: '#776688' });
  assert.equal(value['statusBar.background'], '#ababab');
  assert.equal(value['titleBar.inactiveBackground'], '#776688');
  await a.dispose();
  assert.deepEqual(value, { 'statusBar.background': '#ababab', 'editor.background': '#111111' });
});
test('journal recovers a crash before a palette update has reached settings', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-palette-crash-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'w'),
    journalFile = file + '.appearance.json';
  const old = overlay(undefined, palette('processing', {})),
    next = overlay(undefined, palette('finished', {}));
  next.journal.hadColors = false;
  for (const entry of next.journal.entries)
    entry.previous = [old.journal.entries.find((e) => e.key === entry.key).applied];
  fs.writeFileSync(
    file,
    JSON.stringify({ settings: { 'workbench.colorCustomizations': old.colors } }),
  );
  fs.writeFileSync(journalFile, JSON.stringify(next.journal));
  restoreFile(file, journalFile);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { settings: {} });
});
test('a user choosing a previous highlight color becomes the new baseline', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-old-palette-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let value;
  const c = {
    inspect: () => ({ workspaceValue: value }),
    get: () => value,
    update: async (_, v) => {
      value = v;
    },
  };
  const a = new Appearance(
    { workspace: { getConfiguration: () => c }, ConfigurationTarget: { Workspace: 2 } },
    path.join(dir, 'w'),
  );
  await a.update('processing', {});
  await a.update('finished', {});
  value['statusBar.background'] = '#245A91';
  await a.update('finished', {});
  await a.dispose();
  assert.deepEqual(value, { 'statusBar.background': '#245A91' });
});
test('single-folder recovery edits the existing settings root and preserves JSONC', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-folder-recovery-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json'),
    journalFile = path.join(dir, 'recovery.json');
  const { colors, journal } = overlay(undefined, palette('processing', {}));
  journal.hadColors = false;
  journal.container = 'folder';
  fs.writeFileSync(
    file,
    '// keep\n' +
      JSON.stringify({ 'editor.fontSize': 15, 'workbench.colorCustomizations': colors }),
  );
  fs.writeFileSync(journalFile, JSON.stringify(journal));
  restoreFile(file, journalFile);
  const result = fs.readFileSync(file, 'utf8');
  assert.ok(result.startsWith('// keep'));
  assert.deepEqual(parse(result), { 'editor.fontSize': 15 });
});
function folderAppearance(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-folder-cleanup-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, '.vscode', 'settings.json');
  const journalPath = path.join(dir, 'recovery.json');
  const current = () =>
    fs.existsSync(file)
      ? parse(fs.readFileSync(file, 'utf8'))['workbench.colorCustomizations']
      : undefined;
  const c = {
    inspect: () => ({ workspaceValue: current() }),
    get: current,
    update: async (_, value) => {
      const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '{}';
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        applyEdits(text, modify(text, ['workbench.colorCustomizations'], value, {})),
      );
    },
  };
  const appearance = new Appearance(
    { workspace: { getConfiguration: () => c }, ConfigurationTarget: { Workspace: 2 } },
    file,
    { container: 'folder', verifyDisk: true, journalPath },
  );
  return { appearance, file, journalPath };
}
test('idle leaves a clean folder alone; repeated highlights and disposal leave no settings artifacts', async (t) => {
  const { appearance, file, journalPath } = folderAppearance(t);
  await appearance.update('idle', {});
  assert.equal(fs.existsSync(path.dirname(file)), false);
  assert.equal(fs.existsSync(journalPath), false);
  for (let cycle = 0; cycle < 2; cycle++) {
    await appearance.update('processing', {});
    await appearance.update('finished', {});
    const journal = JSON.parse(fs.readFileSync(journalPath));
    assert.equal(journal.createdSettingsFile, true);
    assert.equal(journal.createdSettingsDirectory, true);
    if (cycle === 0) await appearance.update('idle', {});
    else await appearance.dispose();
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.existsSync(path.dirname(file)), false);
    assert.equal(fs.existsSync(journalPath), false);
  }
});
for (const recovery of ['live', 'crash']) {
  for (const scenario of [
    'new',
    'existing file',
    'existing directory',
    'new sibling',
    'user setting',
    'user comment',
  ]) {
    test(`${recovery} restoration cleans only extension-created empty settings: ${scenario}`, async (t) => {
      const { appearance, file, journalPath } = folderAppearance(t);
      const directory = path.dirname(file),
        sibling = path.join(directory, 'tasks.json');
      if (scenario === 'existing file' || scenario === 'existing directory') {
        fs.mkdirSync(directory);
        if (scenario === 'existing file') fs.writeFileSync(file, '{}');
      }
      await appearance.update('processing', {});
      await appearance.update('finished', {});
      if (scenario === 'new sibling') fs.writeFileSync(sibling, '{}');
      if (scenario === 'user setting') {
        const text = fs.readFileSync(file, 'utf8');
        fs.writeFileSync(file, applyEdits(text, modify(text, ['editor.fontSize'], 17, {})));
      }
      if (scenario === 'user comment') {
        fs.writeFileSync(file, '// keep my comment\n' + fs.readFileSync(file, 'utf8'));
      }
      if (recovery === 'crash') restoreFile(file, journalPath);
      else await appearance.update('idle', {});
      const keptFile = ['existing file', 'user setting', 'user comment'].includes(scenario);
      assert.equal(fs.existsSync(file), keptFile);
      assert.equal(fs.existsSync(directory), scenario !== 'new');
      assert.equal(fs.existsSync(journalPath), false);
      if (keptFile) {
        const text = fs.readFileSync(file, 'utf8');
        assert.deepEqual(parse(text), scenario === 'user setting' ? { 'editor.fontSize': 17 } : {});
        if (scenario === 'user comment') assert.ok(text.startsWith('// keep my comment'));
      }
      if (scenario === 'new sibling') assert.equal(fs.readFileSync(sibling, 'utf8'), '{}');
    });
  }
}
test('legacy recovery journals without file provenance preserve empty settings files', async (t) => {
  const { appearance, file, journalPath } = folderAppearance(t);
  await appearance.update('processing', {});
  const journal = JSON.parse(fs.readFileSync(journalPath));
  delete journal.createdSettingsFile;
  delete journal.createdSettingsDirectory;
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  await appearance.update('finished', {});
  await appearance.dispose();
  assert.deepEqual(parse(fs.readFileSync(file, 'utf8')), {});
});
test('a second window does not restore or replace another active window’s journal', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-owner-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let value;
  const c = {
    inspect: () => ({ workspaceValue: value }),
    get: () => value,
    update: async (_, v) => {
      value = v;
    },
  };
  const v = { workspace: { getConfiguration: () => c }, ConfigurationTarget: { Workspace: 2 } },
    file = path.join(dir, 'settings.json'),
    journalPath = path.join(dir, 'journal.json');
  const first = new Appearance(v, file, {
    owner: 'a',
    journalPath,
    container: 'folder',
    canRestoreOther: () => false,
  });
  const second = new Appearance(v, file, {
    owner: 'b',
    journalPath,
    container: 'folder',
    canRestoreOther: () => false,
  });
  await first.update('processing', {});
  await second.update('unknown', {});
  assert.equal(value['statusBar.background'], '#245A91');
  await first.update('unknown', {});
  assert.equal(value, undefined);
});
test('settings key reordering does not block safe restoration against the disk file', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-key-order-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  let value;
  const c = {
    inspect: () => ({ workspaceValue: value }),
    get: () => value,
    update: async (_, v) => {
      value = v;
      const disk = v && Object.fromEntries(Object.entries(v).reverse());
      fs.writeFileSync(file, JSON.stringify(disk ? { 'workbench.colorCustomizations': disk } : {}));
    },
  };
  const a = new Appearance(
    { workspace: { getConfiguration: () => c }, ConfigurationTarget: { Workspace: 2 } },
    file,
    { verifyDisk: true, container: 'folder' },
  );
  await a.update('processing', {});
  assert.equal(value['statusBar.background'], '#245A91');
  await a.dispose();
  assert.equal(value, undefined);
});
test('acknowledgement retries a settings-cache mismatch without another interaction', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-ack-retry-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  let value;
  const c = {
    inspect: () => ({ workspaceValue: value }),
    get: () => value,
    update: async (_, v) => {
      value = v;
      fs.writeFileSync(file, JSON.stringify(v ? { 'workbench.colorCustomizations': v } : {}));
    },
  };
  const a = new Appearance(
    { workspace: { getConfiguration: () => c }, ConfigurationTarget: { Workspace: 2 } },
    file,
    { verifyDisk: true, container: 'folder' },
  );
  await a.update('finished', {});
  const purple = structuredClone(value);
  // Model the short interval where VS Code's cache has the new palette but
  // disk still has its previous value. No configuration/interaction event follows.
  fs.writeFileSync(
    file,
    JSON.stringify({ 'workbench.colorCustomizations': palette('processing', {}) }),
  );
  const timer = setTimeout(
    () => fs.writeFileSync(file, JSON.stringify({ 'workbench.colorCustomizations': purple })),
    25,
  );
  t.after(() => clearTimeout(timer));
  await a.update('idle', {});
  assert.equal(value, undefined);
  assert.ok(a.timings.some((e) => e.state === 'idle' && e.retries > 0));
});
test('acknowledgement supersedes stale queued highlights behind an in-flight settings write', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-ack-queue-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let value, release, started;
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const writes = [];
  const c = {
    inspect: () => ({ workspaceValue: value }),
    get: () => value,
    update: async (_, v) => {
      writes.push(v?.['statusBar.background']);
      if (writes.length === 1) {
        started();
        await blocked;
      }
      value = v;
    },
  };
  const a = new Appearance(
    { workspace: { getConfiguration: () => c }, ConfigurationTarget: { Workspace: 2 } },
    path.join(dir, 'w'),
  );
  const work = a.update('processing', {});
  await entered;
  a.update('approval', {});
  a.update('finished', {});
  const acknowledge = a.update('idle', {});
  release();
  await work;
  await acknowledge;
  assert.deepEqual(writes, ['#245A91', undefined]);
  assert.equal(value, undefined);
});
test('reconciliation retries remain bounded if settings never synchronize', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-retry-limit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, '{}');
  const current = { 'statusBar.background': '#123456' };
  let writes = 0;
  const c = {
    inspect: () => ({ workspaceValue: current }),
    get: () => current,
    update: async () => {
      writes++;
    },
  };
  const a = new Appearance(
    { workspace: { getConfiguration: () => c }, ConfigurationTarget: { Workspace: 2 } },
    file,
    { verifyDisk: true, container: 'folder' },
  );
  await assert.rejects(a.update('idle', {}), /did not synchronize/);
  assert.equal(writes, 0);
  assert.equal(a.timings.at(-1).retries, 8);
});
