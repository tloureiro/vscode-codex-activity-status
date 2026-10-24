'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..', 'sources');
const snapshots = path.join(root, 'snapshots');

function options(args) {
  const result = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === '--help' || key === '--latest') result[key.slice(2)] = true;
    else if (['--codex-ref', '--vscode-ref', '--codex-extension', '--vscode-app'].includes(key)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
      result[key.slice(2)] = value;
    } else throw new Error(`Unknown option: ${key}. Use --help.`);
  }
  return result;
}

function json(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function installedExtension(override) {
  if (override) return path.resolve(override);
  const directory = path.join(os.homedir(), '.vscode', 'extensions');
  const entries = json(path.join(directory, 'extensions.json'))
    .filter((entry) => entry.identifier.id === 'openai.chatgpt')
    .sort((a, b) => (b.metadata?.installedTimestamp || 0) - (a.metadata?.installedTimestamp || 0));
  if (!entries.length)
    throw new Error('No installed Codex extension found. Supply --codex-extension PATH.');
  return path.join(directory, entries[0].relativeLocation);
}

function download(url, file) {
  execFileSync(
    'curl',
    [
      '--fail',
      '--location',
      '--silent',
      '--show-error',
      '--retry',
      '2',
      '--connect-timeout',
      '20',
      '--max-time',
      '600',
      '--proto',
      '=https',
      '--output',
      file,
      url,
    ],
    { stdio: 'inherit' },
  );
}

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function sourceSnapshot(name, repository, ref) {
  const staging = fs.mkdtempSync(path.join(snapshots, `.${name}-`));
  try {
    const resolved = path.join(staging, 'commit.json');
    console.log(`${name}: resolving ${repository}@${ref}`);
    download(
      `https://api.github.com/repos/${repository}/commits/${encodeURIComponent(ref)}`,
      resolved,
    );
    const commit = json(resolved);
    if (!/^[a-f0-9]{40}$/.test(commit.sha)) throw new Error(`Invalid ${name} commit response.`);
    const target = path.join(snapshots, `${name}-${commit.sha}`);
    const metadataFile = `${target}.json`;
    let metadata;
    if (fs.existsSync(target)) {
      metadata = json(metadataFile);
      if (metadata.commit !== commit.sha || metadata.repository !== repository)
        throw new Error(`Snapshot metadata mismatch: ${target}`);
      console.log(`${name}: reusing ${commit.sha}`);
    } else {
      const archive = path.join(staging, 'source.tar.gz');
      const archiveUrl = `https://codeload.github.com/${repository}/tar.gz/${commit.sha}`;
      console.log(`${name}: downloading ${commit.sha}`);
      download(archiveUrl, archive);
      const extracted = path.join(staging, 'extracted');
      fs.mkdirSync(extracted);
      execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', extracted], {
        stdio: 'inherit',
      });
      if (!fs.existsSync(path.join(extracted, 'README.md')))
        throw new Error(`Incomplete ${name} archive: missing README.md.`);
      metadata = {
        repository,
        commit: commit.sha,
        commitDate: commit.commit.committer.date,
        archiveUrl,
        archiveSha256: hash(archive),
        downloadedAt: new Date().toISOString(),
      };
      fs.renameSync(extracted, target);
      fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2) + '\n');
    }
    return { ...metadata, requestedRef: ref, snapshot: path.relative(root, target) };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function extensionSnapshot(directory) {
  const manifest = json(path.join(directory, 'package.json'));
  if (manifest.publisher !== 'openai' || manifest.name !== 'chatgpt')
    throw new Error('--codex-extension must point to the installed openai.chatgpt extension.');
  const files = ['package.json', 'out/extension.js', 'LICENSE.md', 'readme.md'].filter((file) =>
    fs.existsSync(path.join(directory, file)),
  );
  if (!files.includes('out/extension.js'))
    throw new Error('Installed extension bundle is missing.');
  const checksums = Object.fromEntries(
    files.map((file) => [file, hash(path.join(directory, file))]),
  );
  const digest = crypto.createHash('sha256').update(JSON.stringify(checksums)).digest('hex');
  const target = path.join(snapshots, `codex-extension-${digest}`);
  if (!fs.existsSync(target)) {
    const staging = fs.mkdtempSync(path.join(snapshots, '.codex-extension-'));
    try {
      for (const file of files) {
        const destination = path.join(staging, file);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(path.join(directory, file), destination);
      }
      fs.renameSync(staging, target);
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }
  console.log(`codex-extension: installed ${manifest.version} (compiled host bundle)`);
  return {
    kind: 'installed-compiled-bundle',
    version: manifest.version,
    installedPath: directory,
    files: checksums,
    snapshot: path.relative(root, target),
    note: 'Not original source. Native binaries and webview assets are omitted.',
  };
}

function publish(name, snapshot) {
  const destination = path.join(root, name);
  if (fs.existsSync(destination) && !fs.lstatSync(destination).isSymbolicLink())
    throw new Error(`Refusing to replace a non-symlink: ${destination}`);
  const temporary = path.join(root, `.${name}-${process.pid}`);
  try {
    fs.symlinkSync(snapshot, temporary, 'dir');
    fs.renameSync(temporary, destination);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function main(args = process.argv.slice(2)) {
  const settings = options(args);
  if (settings.help) {
    console.log(`Usage: npm run sources:update -- [options]

Default: match installed VS Code and the Codex CLI bundled with its extension.
  --latest                 Download main from both public repositories
  --codex-ref REF           Override Codex tag, branch, or commit
  --vscode-ref REF          Override VS Code tag, branch, or commit
  --codex-extension PATH    Installed openai.chatgpt extension directory
  --vscode-app PATH         VS Code .app directory (macOS)

Requires curl, tar, network access, and an installed Codex extension.
Archives and metadata stay in ignored sources/. No Git commands are run.
Existing snapshots are retained. A missing exact ref fails; no silent fallback.`);
    return;
  }
  const extension = installedExtension(settings['codex-extension']);
  const codexPackages = fs
    .readdirSync(path.join(extension, 'bin'))
    .map((name) => path.join(extension, 'bin', name, 'codex-package.json'))
    .filter((file) => fs.existsSync(file));
  const versions = [...new Set(codexPackages.map((file) => json(file).version))];
  if (versions.length !== 1)
    throw new Error('Cannot determine bundled Codex version from codex-package.json.');
  const app = settings['vscode-app'] || '/Applications/Visual Studio Code.app';
  const product = json(path.join(app, 'Contents', 'Resources', 'app', 'product.json'));
  const codexRef = settings['codex-ref'] || (settings.latest ? 'main' : `rust-v${versions[0]}`);
  const vscodeRef = settings['vscode-ref'] || (settings.latest ? 'main' : product.commit);
  if (!vscodeRef) throw new Error('VS Code build has no commit. Supply --vscode-ref REF.');
  fs.mkdirSync(snapshots, { recursive: true });
  const manifest = {
    updatedAt: new Date().toISOString(),
    mode: settings.latest ? 'latest-with-optional-overrides' : 'installed-with-optional-overrides',
    installed: { vscode: product.version, codex: versions[0] },
    codex: sourceSnapshot('codex', 'openai/codex', codexRef),
    vscode: sourceSnapshot('vscode', 'microsoft/vscode', vscodeRef),
    codexExtension: extensionSnapshot(extension),
  };
  publish('codex', manifest.codex.snapshot);
  publish('vscode', manifest.vscode.snapshot);
  publish('codex-extension', manifest.codexExtension.snapshot);
  const temporary = path.join(root, `.manifest-${process.pid}.json`);
  fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2) + '\n');
  fs.renameSync(temporary, path.join(root, 'manifest.json'));
  console.log('Updated sources/manifest.json. See docs/SOURCES.md for research entry points.');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Source update failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { options };
