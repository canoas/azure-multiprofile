import os from 'node:os';
import path from 'node:path';

// AZMP_TEST_PLATFORM lets the test suite exercise Windows-only branches on any OS.
export function platform() {
  return process.env.AZMP_TEST_PLATFORM || process.platform;
}

export function isWindows() {
  return platform() === 'win32';
}

export function home() {
  return process.env.AZMP_HOME || os.homedir();
}

/** Where the registry, snapshots and state live. Never inside a profile dir. */
export function stateDir() {
  if (process.env.AZMP_STATE_DIR) return process.env.AZMP_STATE_DIR;
  if (isWindows()) {
    const appData = process.env.APPDATA || path.join(home(), 'AppData', 'Roaming');
    return path.join(appData, 'azure-multiprofile');
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(home(), '.config');
  return path.join(xdg, 'azure-multiprofile');
}

export const registryFile = () => path.join(stateDir(), 'profiles.json');
export const snapshotsDir = () => path.join(stateDir(), 'snapshots');

export const DEFAULT_PROFILE = 'default';
export const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

export function validateName(name) {
  if (!name) return 'A profile name is required.';
  if (!NAME_RE.test(name)) {
    return 'Use 1-32 lowercase letters, digits or dashes, starting with a letter or digit.';
  }
  return null;
}

/** The directory az uses when AZURE_CONFIG_DIR is not set. */
export const defaultAzureDir = () => path.join(home(), '.azure');
export const defaultAzdDir = () => path.join(home(), '.azd');

export function azureDirFor(name) {
  return name === DEFAULT_PROFILE ? defaultAzureDir() : path.join(home(), `.azure-${name}`);
}

export function azdDirFor(name) {
  return name === DEFAULT_PROFILE ? defaultAzdDir() : path.join(home(), `.azd-${name}`);
}

export function tildify(p) {
  if (!p) return p;
  const h = home();
  if (p === h) return '~';
  if (p.startsWith(h + path.sep)) return `~${p.slice(h.length)}`;
  return p;
}

export function expandHome(p) {
  if (!p) return p;
  if (p === '~') return home();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(home(), p.slice(2));
  return path.resolve(p);
}

/** Compare paths the way the current OS does (case-insensitive on Windows and macOS default volumes). */
export function samePath(a, b) {
  if (!a || !b) return false;
  const na = path.resolve(a);
  const nb = path.resolve(b);
  if (isWindows() || platform() === 'darwin') return na.toLowerCase() === nb.toLowerCase();
  return na === nb;
}
