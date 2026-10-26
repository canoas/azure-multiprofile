import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  DEFAULT_PROFILE,
  azureDirFor,
  registryFile,
  validateName,
} from './paths.js';

export class RegistryError extends Error {}

const EMPTY = () => ({ version: 1, profiles: {} });

/**
 * Registry shape:
 * { version: 1, profiles: { work: { azureConfigDir, azdConfigDir|null, createdAt } } }
 * The `default` profile is implicit (~/.azure) and never stored.
 */
export function loadRegistry(file = registryFile()) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return EMPTY();
    throw err;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new RegistryError(
      `${file} is not valid JSON. Run \`azure-multiprofile doctor --fix\` to restore the last good copy.`,
    );
  }
  const problem = validateRegistry(data);
  if (problem) {
    throw new RegistryError(`${file} is invalid (${problem}). Run \`azure-multiprofile doctor --fix\`.`);
  }
  return data;
}

export function validateRegistry(data) {
  if (!data || typeof data !== 'object') return 'not an object';
  if (data.version !== 1) return `unsupported version ${data.version}`;
  if (!data.profiles || typeof data.profiles !== 'object') return 'missing "profiles"';
  for (const [name, p] of Object.entries(data.profiles)) {
    if (validateName(name) || name === DEFAULT_PROFILE) return `bad profile name "${name}"`;
    if (!p || typeof p.azureConfigDir !== 'string') return `profile "${name}" has no azureConfigDir`;
  }
  return null;
}

/** Atomic write; the previous good file is kept as profiles.json.bak. */
export function saveRegistry(data, file = registryFile()) {
  const problem = validateRegistry(data);
  if (problem) throw new RegistryError(`Refusing to save an invalid registry: ${problem}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    try {
      const current = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!validateRegistry(current)) fs.copyFileSync(file, `${file}.bak`);
    } catch {
      // Current file is corrupt: keep the existing .bak, which is the last good one.
    }
  }
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function defaultProfile() {
  return {
    name: DEFAULT_PROFILE,
    azureConfigDir: azureDirFor(DEFAULT_PROFILE),
    azdConfigDir: null,
    createdAt: null,
    implicit: true,
  };
}

/** All profiles, `default` first, as an array of { name, ...entry }. */
export function allProfiles(reg) {
  const named = Object.entries(reg.profiles)
    .map(([name, p]) => ({ name, azdConfigDir: null, ...p }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [defaultProfile(), ...named];
}

export function getProfile(reg, name) {
  if (name === DEFAULT_PROFILE) return defaultProfile();
  const p = reg.profiles[name];
  return p ? { name, azdConfigDir: null, ...p } : null;
}

export function requireProfile(reg, name) {
  const p = getProfile(reg, name);
  if (!p) {
    const known = allProfiles(reg).map((x) => x.name).join(', ');
    const err = new Error(`Unknown profile "${name}". Known profiles: ${known}.`);
    err.exitCode = 2;
    throw err;
  }
  return p;
}

/** Short fingerprint of the profile set; shells compare it to spot a stale `init`. */
export function registryHash(reg, version) {
  const h = crypto.createHash('sha1');
  h.update(version);
  h.update(JSON.stringify(allProfiles(reg).map((p) => [p.name, p.azureConfigDir, p.azdConfigDir])));
  return h.digest('hex').slice(0, 10);
}
