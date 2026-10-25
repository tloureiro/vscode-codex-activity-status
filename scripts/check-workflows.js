'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

// Official release archives, pinned to their published SHA-256 digests.
const version = '1.7.12';
const checksums = {
  darwin_amd64: '5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644',
  darwin_arm64: 'aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f',
  linux_amd64: '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8',
  linux_arm64: '325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6',
};
const platform = `${process.platform}_${process.arch === 'x64' ? 'amd64' : process.arch}`;
if (!checksums[platform]) throw new Error(`Unsupported actionlint platform: ${platform}`);
const name = `actionlint_${version}_${platform}.tar.gz`;
const cache = path.resolve(__dirname, '../node_modules/.cache/actionlint');
const archive = path.join(cache, name);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-actionlint-'));
try {
  if (!fs.existsSync(archive)) {
    fs.mkdirSync(cache, { recursive: true });
    const download = path.join(temporary, name);
    console.log(`Downloading official actionlint ${version} (${platform})...`);
    execFileSync(
      'curl',
      [
        '--fail',
        '--silent',
        '--show-error',
        '--location',
        '--max-time',
        '60',
        '--output',
        download,
        `https://github.com/rhysd/actionlint/releases/download/v${version}/${name}`,
      ],
      { stdio: 'inherit' },
    );
    verify(download);
    fs.copyFileSync(download, archive);
  }
  verify(archive);
  execFileSync('tar', ['-xzf', archive, '-C', temporary, 'actionlint']);
  const workflows =
    process.argv.length > 2
      ? process.argv.slice(2)
      : fs
          .readdirSync('.github/workflows')
          .filter((file) => /\.ya?ml$/.test(file))
          .map((file) => path.join('.github/workflows', file));
  if (!workflows.length) throw new Error('No GitHub Actions workflows found.');
  // Explicit files avoid repository discovery. Optional external linters are
  // disabled so the same workflow checks run on every machine.
  execFileSync(
    path.join(temporary, 'actionlint'),
    ['-no-color', '-shellcheck=', '-pyflakes=', ...workflows],
    { stdio: 'inherit' },
  );
  console.log(`GitHub Actions workflow checks passed (actionlint ${version}).`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

function verify(file) {
  const actual = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (actual !== checksums[platform]) throw new Error(`actionlint checksum mismatch: ${file}`);
}
