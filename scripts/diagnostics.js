#!/usr/bin/env node
'use strict';
const { collect } = require('../src/diagnostics');
collect()
  .then((windows) => console.log(JSON.stringify({ windows }, null, 2)))
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
