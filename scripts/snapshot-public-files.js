'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Run only in a fresh CI checkout, before dependencies or build outputs exist.
// Exclude only root Git metadata; even accidentally committed ignored files
// must reach the public-file check. Do not follow directory symlinks.
const files = [];
function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (file === '.git') continue;
    if (entry.isDirectory()) visit(file);
    else files.push(file.split(path.sep).join('/'));
  }
}

if (!process.argv[2])
  throw new Error('Usage: node scripts/snapshot-public-files.js <manifest-path>');
visit('.');
fs.writeFileSync(process.argv[2], files.join('\0') + '\0');
