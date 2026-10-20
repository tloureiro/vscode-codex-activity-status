'use strict';
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

// Include untracked files so an initial commit receives the same checks.
// Report locations only, never the value of a possible credential.
const files = execFileSync(
  process.env.GIT_READ_ONLY_BIN || 'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean);
const rules = [
  ['private home path', /\/(?:Users|home)\/[^\s/<>]+\//],
  ['machine-specific temporary path', /\/var\/folders\/[a-z\d]{2}\/[a-z\d_]+\//i],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['GitHub credential', /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/],
  ['API credential', /\bsk-[A-Za-z0-9_-]{32,}\b/],
  ['AWS access key', /\bAKIA[A-Z0-9]{16}\b/],
];
const problems = [];
for (const file of files) {
  if (
    /^(?:node_modules|dist|coverage|\.vscode|\.vscode-test)\//.test(file) ||
    /(?:^|\/)\.env(?:$|\.(?!example$))/.test(file) ||
    /\.(?:vsix|log)$/.test(file)
  ) {
    problems.push(`${file}: generated or private file should not be committed`);
    continue;
  }
  const data = fs.readFileSync(file);
  if (data.includes(0)) continue; // Binary evidence is reviewed separately.
  const content = data.toString('utf8');
  for (const [index, line] of content.split('\n').entries()) {
    for (const [label, pattern] of rules)
      if (pattern.test(line)) problems.push(`${file}:${index + 1}: ${label}`);
    if (/[\t ]+$/.test(line)) problems.push(`${file}:${index + 1}: trailing whitespace`);
  }
  if (content && !content.endsWith('\n')) problems.push(`${file}: missing final newline`);
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else console.log(`Public-file checks passed (${files.length} candidate files).`);
