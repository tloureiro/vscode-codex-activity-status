'use strict';
// A small detached child restores persisted colors after an extension-host crash.
const fs = require('node:fs');
const { restoreFile } = require('./appearance');
const [workspace, lock, token, journalFile] = process.argv.slice(2);
process.on('message', (message) => {
  if (message === 'stop') process.exit(0);
});
process.on('disconnect', () => {
  try {
    const owner = JSON.parse(fs.readFileSync(lock, 'utf8'));
    if (owner.token !== token) return;
    const journalPath = journalFile || workspace + '.appearance.json';
    const journal = fs.existsSync(journalPath)
      ? JSON.parse(fs.readFileSync(journalPath, 'utf8'))
      : null;
    if (!journal?.owner || journal.owner === token) restoreFile(workspace, journalPath);
    fs.unlinkSync(lock);
  } catch {
    /* Keep journal/lock for startup recovery if a file was being edited. */
  }
  process.exit(0);
});
