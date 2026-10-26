import fs from 'node:fs';
import path from 'node:path';

// Only these files are ever copied into a new profile. Token caches,
// azureProfile.json, service principal entries and logs are never touched.
export const SEED_FILES = ['config', 'clouds.config'];

// Keys that can hold secrets in the az `config` INI file, per section.
const SECRET_KEYS = {
  storage: new Set(['key', 'sas_token', 'connection_string']),
  batch: new Set(['access_key']),
  batchai: new Set(['storage_key']),
};

/** Drops secret-bearing keys from an az config INI file, preserving everything else verbatim. */
export function stripSecrets(ini) {
  let section = '';
  return ini
    .split(/\r?\n/)
    .filter((line) => {
      const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
      if (header) {
        section = header[1].trim().toLowerCase();
        return true;
      }
      const kv = line.match(/^\s*([^=#;\s][^=]*?)\s*=/);
      if (!kv) return true;
      return !SECRET_KEYS[section]?.has(kv[1].toLowerCase());
    })
    .join('\n');
}

/** Extension names installed in a config dir (az keeps one folder per extension). */
export function listExtensions(azureConfigDir) {
  const dir = path.join(azureConfigDir, 'cliextensions');
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_'))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Copies the allowlisted files from `from` into `to`. Existing files in `to` win.
 * Returns the list of files written.
 */
export function seedConfig(from, to) {
  const written = [];
  fs.mkdirSync(to, { recursive: true, mode: 0o700 });
  for (const name of SEED_FILES) {
    const src = path.join(from, name);
    const dst = path.join(to, name);
    if (!fs.existsSync(src) || fs.existsSync(dst)) continue;
    let content = fs.readFileSync(src, 'utf8');
    if (name === 'config') content = stripSecrets(content);
    fs.writeFileSync(dst, content, { mode: 0o600 });
    written.push(name);
  }
  return written;
}

/** Sets `[section] key = value` in an INI string, adding the section or key if missing. */
export function setIniValue(ini, section, key, value) {
  const lines = ini === '' ? [] : ini.split(/\r?\n/);
  let current = '';
  let sectionIdx = -1;
  let lastInSection = -1;
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i].match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) {
      current = header[1].trim();
      if (current === section) sectionIdx = lastInSection = i;
      continue;
    }
    if (current !== section) continue;
    if (lines[i].trim() !== '') lastInSection = i;
    const kv = lines[i].match(/^\s*([^=#;\s][^=]*?)\s*=/);
    if (kv && kv[1].toLowerCase() === key.toLowerCase()) {
      lines[i] = `${key} = ${value}`;
      return lines.join('\n');
    }
  }
  if (sectionIdx === -1) {
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    if (lines.length) lines.push('');
    lines.push(`[${section}]`, `${key} = ${value}`, '');
    return lines.join('\n');
  }
  lines.splice(lastInSection + 1, 0, `${key} = ${value}`);
  return lines.join('\n');
}

export function getIniValue(ini, section, key) {
  let current = '';
  for (const line of ini.split(/\r?\n/)) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) {
      current = header[1].trim();
      continue;
    }
    if (current !== section) continue;
    const kv = line.match(/^\s*([^=#;\s][^=]*?)\s*=\s*(.*)$/);
    if (kv && kv[1].toLowerCase() === key.toLowerCase()) return kv[2].trim();
  }
  return null;
}
