#!/usr/bin/env node
import { main } from '../src/cli.js';

// A reader that goes away early (`azmp list | head -1`) is not a failure. Drop the
// rest of the output but keep running, so `add` still finishes its setup steps.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (e) => {
    if (e.code !== 'EPIPE' && e.code !== 'ERR_STREAM_DESTROYED') throw e;
  });
}

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
