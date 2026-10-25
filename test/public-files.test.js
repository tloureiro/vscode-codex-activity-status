'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const scripts = path.resolve(__dirname, '../scripts');

test('CI scans a fresh checkout without a Git wrapper and still rejects private files', (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'public-files-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const checkout = path.join(temporary, 'checkout');
  const manifest = path.join(temporary, 'files.txt');
  fs.mkdirSync(path.join(checkout, '.git'), { recursive: true });
  fs.mkdirSync(path.join(checkout, 'docs'));
  fs.writeFileSync(path.join(checkout, '.git', 'config'), 'not public\n');
  fs.writeFileSync(path.join(checkout, '.gitignore'), 'node_modules/\n.env\n');
  fs.writeFileSync(path.join(checkout, 'docs', 'a file.md'), 'Public documentation.\n');

  const env = {
    ...process.env,
    GIT_READ_ONLY_BIN: path.join(temporary, 'missing-wrapper'),
    PUBLIC_FILES_MANIFEST: manifest,
  };
  const run = (script, ...args) =>
    spawnSync(process.execPath, [path.join(scripts, script), ...args], {
      cwd: checkout,
      env,
      encoding: 'utf8',
    });
  const snapshot = () => {
    const result = run('snapshot-public-files.js', manifest);
    assert.equal(result.status, 0, result.stderr);
  };
  snapshot();
  assert.deepEqual(fs.readFileSync(manifest, 'utf8').split('\0').filter(Boolean).sort(), [
    '.gitignore',
    'docs/a file.md',
  ]);

  // Dependencies created after the snapshot are outside the checkout file list.
  fs.mkdirSync(path.join(checkout, 'node_modules'));
  fs.writeFileSync(path.join(checkout, 'node_modules', 'generated.js'), 'generated');
  const clean = run('check-public-files.js');
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.stdout, /Public-file checks passed \(2 candidate files\)/);

  fs.rmSync(path.join(checkout, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(checkout, '.env'), 'PRIVATE=value\n');
  const credential = 'sk-' + 'x'.repeat(40);
  fs.writeFileSync(path.join(checkout, 'docs', 'secret.txt'), credential + '\n');
  snapshot();
  const unsafe = run('check-public-files.js');
  assert.equal(unsafe.status, 1);
  assert.match(unsafe.stderr, /\.env: generated or private file should not be committed/);
  assert.match(unsafe.stderr, /docs\/secret\.txt:1: API credential/);
  assert.equal(unsafe.stderr.includes(credential), false);

  fs.unlinkSync(manifest);
  const missing = run('check-public-files.js');
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /ENOENT/);
  assert.doesNotMatch(missing.stderr, /missing-wrapper/);
});
