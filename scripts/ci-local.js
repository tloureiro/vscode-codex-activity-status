'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const requiredNode = fs.readFileSync(path.join(root, '.node-version'), 'utf8').trim();
if (process.versions.node.split('.')[0] !== requiredNode) {
  console.error(`CI uses Node ${requiredNode}. Select that version, then run npm run ci:local.`);
  process.exit(1);
}
if (process.platform !== 'darwin') {
  console.error('CI uses macOS. Run this rehearsal on macOS to match the runner.');
  process.exit(1);
}

// Copy only wrapper-approved public candidates, including current untracked
// changes. Ignored local dependencies, hooks and build output stay outside it.
const files = execFileSync(
  process.env.GIT_READ_ONLY_BIN || path.join(os.homedir(), 'sync', 'scripts', 'git-safe'),
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: root, encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-ci-'));
const checkout = path.join(temporary, 'checkout');
fs.mkdirSync(checkout);
const env = {
  ...process.env,
  PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`,
  PUBLIC_FILES_MANIFEST: path.join(temporary, 'public-files.txt'),
};
const run = (command, args) =>
  execFileSync(command, args, { cwd: checkout, env, stdio: 'inherit' });
console.log(`Rehearsing CI with Node ${process.versions.node} in ${temporary}`);
try {
  for (const file of files) {
    const source = path.resolve(root, file);
    if (!source.startsWith(root + path.sep)) throw new Error(`Invalid candidate: ${file}`);
    if (!fs.existsSync(source)) continue;
    if (!fs.lstatSync(source).isFile()) throw new Error(`Candidate is not a regular file: ${file}`);
    const destination = path.join(checkout, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
  run(process.execPath, ['scripts/snapshot-public-files.js', env.PUBLIC_FILES_MANIFEST]);
  run('npm', ['ci']);
  run('npm', ['run', 'validate']);
  run('npm', ['run', 'package']);
  console.log('Local CI rehearsal passed. Temporary checkout removed.');
  fs.rmSync(temporary, { recursive: true, force: true });
} catch (error) {
  console.error(error.message);
  console.error(`Failed rehearsal preserved for inspection: ${temporary}`);
  process.exitCode = 1;
}
