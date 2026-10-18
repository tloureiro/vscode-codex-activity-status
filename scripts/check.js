'use strict';
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
for (const dir of ['src', 'scripts', 'test', 'prototype/appearance'])
  for (const file of fs.readdirSync(dir))
    if (file.endsWith('.js'))
      execFileSync(process.execPath, ['--check', `${dir}/${file}`], { stdio: 'inherit' });
console.log('JavaScript syntax checks passed.');
