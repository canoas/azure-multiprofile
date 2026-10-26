import { allProfiles, loadRegistry, registryHash } from '../registry.js';
import { renderInit } from '../shell/index.js';
import { SHELLS, currentShell, installShell, uninstallShell } from '../rcfile.js';
import { VERSION } from '../cli.js';
import { out, green, dim, usageError } from '../ui.js';
import { tildify } from '../paths.js';

export function initScript(shell, reg = loadRegistry()) {
  return renderInit(shell, { profiles: allProfiles(reg), hash: registryHash(reg, VERSION) });
}

export async function init([shell]) {
  if (!shell) throw usageError('Usage: azure-multiprofile init <zsh|bash|fish|pwsh>');
  process.stdout.write(initScript(shell === 'powershell' ? 'pwsh' : shell));
  return 0;
}

export function parseShells(value) {
  if (!value) return [currentShell()];
  const list = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s === 'powershell' ? 'pwsh' : s));
  const bad = list.filter((s) => !SHELLS.includes(s));
  if (bad.length) throw usageError(`Unsupported shell(s): ${bad.join(', ')}. Use ${SHELLS.join(', ')}.`);
  return list;
}

export async function setup(_positionals, opts) {
  for (const shell of parseShells(opts.shell)) {
    const r = opts.uninstall ? uninstallShell(shell) : installShell(shell);
    const verb = opts.uninstall ? 'Removed integration from' : 'Installed integration in';
    out(r.changed ? `${green('✓')} ${verb} ${tildify(r.file)}` : dim(`  ${tildify(r.file)} already up to date`));
  }
  if (!opts.uninstall) out(dim('  Open a new terminal (or source the file) to start using `azmp`.'));
  return 0;
}
