import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { isWindows } from './paths.js';

/** Environment variables that select a profile. null means "unset". */
export function profileEnv(profile) {
  return {
    AZURE_CONFIG_DIR: profile.azureConfigDir,
    AZD_CONFIG_DIR: profile.azdConfigDir ?? null,
    AZMP_PROFILE: profile.name,
  };
}

export function mergeEnv(base, vars) {
  const env = { ...base };
  for (const [k, v] of Object.entries(vars)) {
    if (v == null) delete env[k];
    else env[k] = v;
  }
  return env;
}

/** PATH lookup that honours PATHEXT on Windows. Returns the full path or null. */
export function which(cmd, env = process.env) {
  const exts = isWindows() ? (env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean) : [''];
  for (const dir of (env.PATH || env.Path || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = path.join(dir, cmd + ext);
      try {
        const st = fs.statSync(full);
        if (st.isFile() && (isWindows() || st.mode & 0o111)) return full;
      } catch {
        // keep looking
      }
    }
  }
  return null;
}

/**
 * Runs a command with stdio attached to the terminal. Resolves with its exit code.
 * Windows needs a shell to launch .cmd shims such as az.cmd.
 */
export function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(Object.assign(new Error(`"${cmd}" was not found on PATH.`), { exitCode: 127 }));
      } else reject(err);
    });
    child.on('exit', (code, signal) => resolve(signal ? 128 + (os.constants.signals[signal] ?? 1) : (code ?? 1)));
  });
}

export function capture(cmd, args, env = process.env) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', env, shell: process.platform === 'win32', timeout: 60000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error };
}

/**
 * Reads the signed-in account from azureProfile.json without calling az or the network.
 * az writes this file with a UTF-8 BOM.
 */
export function readAccount(azureConfigDir) {
  const file = path.join(azureConfigDir, 'azureProfile.json');
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(raw.replace(/^﻿/, ''));
    const subs = Array.isArray(data.subscriptions) ? data.subscriptions : [];
    if (subs.length === 0) return null;
    const active = subs.find((s) => s.isDefault) || subs[0];
    return {
      user: active.user?.name ?? null,
      userType: active.user?.type ?? null,
      subscription: active.name ?? null,
      subscriptionId: active.id ?? null,
      tenantId: active.tenantId ?? null,
      cloud: active.environmentName ?? null,
      subscriptionCount: subs.length,
    };
  } catch {
    return null;
  }
}

export function azVersion(env = process.env) {
  const r = capture('az', ['version', '--output', 'json', '--only-show-errors'], env);
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout)['azure-cli'] ?? null;
  } catch {
    return null;
  }
}

export function azdVersion(env = process.env) {
  const r = capture('azd', ['version'], env);
  if (r.status !== 0) return null;
  return r.stdout.match(/(\d+\.\d+\.\d+)/)?.[1] ?? r.stdout.trim();
}
