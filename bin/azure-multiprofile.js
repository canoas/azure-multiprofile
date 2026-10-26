#!/usr/bin/env node
import { main } from '../src/cli.js';

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code ?? 0;
  },
  (err) => {
    if (err?.name === 'ExitPromptError') {
      process.exitCode = 130;
      return;
    }
    process.stderr.write(`azure-multiprofile: ${err?.message ?? err}\n`);
    if (process.env.AZMP_DEBUG) process.stderr.write(`${err?.stack}\n`);
    process.exitCode = err?.exitCode ?? 1;
  },
);
