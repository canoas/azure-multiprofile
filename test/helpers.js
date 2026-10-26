import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BIN = path.join(ROOT, 'bin', 'azure-multiprofile.js');
const isWin = process.platform === 'win32';

/**
 * A throwaway HOME + state dir, with stub `az`/`azd` and an `azure-multiprofile`
 * shim on PATH. Nothing outside the sandbox is read or written.
 */
export function sandbox() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'azmp-test-')));
  const home = path.join(root, 'home');
  const state = path.join(root, 'state');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(bin, { recursive: true });

  if (isWin) {
    fs.writeFileSync(path.join(bin, 'az.cmd'), '@echo az[%AZURE_CONFIG_DIR%] %*\r\n');
    fs.writeFileSync(path.join(bin, 'azd.cmd'), '@echo azd[%AZD_CONFIG_DIR%] %*\r\n');
    fs.writeFileSync(path.join(bin, 'azure-multiprofile.cmd'), `@"${process.execPath}" "${BIN}" %*\r\n`);
  } else {
    const write = (name, body) => {
      fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`);
      fs.chmodSync(path.join(bin, name), 0o755);
    };
    write('az', 'echo "az[$AZURE_CONFIG_DIR] $*"');
    write('azd', 'echo "azd[$AZD_CONFIG_DIR] $*"');
    write('azure-multiprofile', `exec "${process.execPath}" "${BIN}" "$@"`);
  }

  const env = {
    ...process.env,
    AZMP_HOME: home,
    AZMP_STATE_DIR: state,
    AZMP_SKIP_VERSION: '1',
    AZMP_PWSH_PROFILE: path.join(home, 'pwsh_profile.ps1'),
    AZMP_SHELL: 'bash',
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    NO_COLOR: '1',
    CI: '1',
  };
  for (const k of ['AZURE_CONFIG_DIR', 'AZD_CONFIG_DIR', 'AZMP_PROFILE', 'AZMP_INIT_HASH', 'AZMP_MANUAL', 'AZMP_AUTO_ROOT']) {
    delete env[k];
  }

  const run = (args, opts = {}) => {
    const r = spawnSync(process.execPath, [BIN, ...args], {
      env: { ...env, ...opts.env },
      cwd: opts.cwd ?? home,
      encoding: 'utf8',
    });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  };

  return {
    root,
    home,
    state,
    bin,
    env,
    run,
    read: (p) => fs.readFileSync(path.join(home, p), 'utf8'),
    registry: () => JSON.parse(fs.readFileSync(path.join(state, 'profiles.json'), 'utf8')),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

export function has(cmd) {
  const r = spawnSync(isWin ? 'where' : 'which', [cmd], { encoding: 'utf8' });
  return r.status === 0;
}
