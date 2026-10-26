import fs from 'node:fs';
import { loadRegistry, saveRegistry, allProfiles, requireProfile, registryHash } from '../registry.js';
import { readAccount } from '../azcli.js';
import { SHELLS, inspectShell } from '../rcfile.js';
import { VERSION } from '../cli.js';
import { DEFAULT_PROFILE, azureDirFor, azdDirFor, samePath, tildify, validateName } from '../paths.js';
import { out, err, bold, dim, green, icon, table, confirm, usageError } from '../ui.js';

export async function list(_positionals, opts) {
  const reg = loadRegistry();
  const rows = allProfiles(reg).map((p) => ({ ...p, account: readAccount(p.azureConfigDir) }));
  if (opts.json) {
    out(JSON.stringify(rows, null, 2));
    return 0;
  }
  const active = process.env.AZMP_PROFILE;
  out(
    table(
      ['', 'PROFILE', 'SIGNED IN AS', 'SUBSCRIPTION', 'AZURE_CONFIG_DIR', 'AZD_CONFIG_DIR'],
      rows.map((p) => [
        p.name === active ? green('*') : ' ',
        bold(p.name),
        p.account?.user ?? dim('(not signed in)'),
        p.account?.subscription ?? '',
        tildify(p.azureConfigDir),
        p.azdConfigDir ? tildify(p.azdConfigDir) : dim('shared'),
      ]),
    ),
  );
  return 0;
}

export async function status() {
  const reg = loadRegistry();
  let problems = 0;
  out(bold('Profiles'));
  for (const p of allProfiles(reg)) {
    const exists = fs.existsSync(p.azureConfigDir);
    const acct = exists ? readAccount(p.azureConfigDir) : null;
    const level = exists ? (acct ? 'ok' : 'warn') : p.implicit ? 'info' : 'error';
    if (level === 'error') problems++;
    const detail = !exists
      ? p.implicit
        ? 'not created yet (az creates it on first use)'
        : `missing ${tildify(p.azureConfigDir)}`
      : acct
        ? `${acct.user} — ${acct.subscription}`
        : `not signed in (run: azmp login ${p.name})`;
    out(`  ${icon(level)} ${p.name.padEnd(14)} ${detail}`);
    if (p.azdConfigDir && !fs.existsSync(p.azdConfigDir)) {
      out(`    ${icon('warn')} azd folder ${tildify(p.azdConfigDir)} is missing`);
    }
  }

  out(bold('\nShell integration'));
  let installed = 0;
  for (const shell of SHELLS) {
    const s = inspectShell(shell);
    if (!s.exists || s.blocks === 0) continue;
    installed++;
    if (s.current) out(`  ${icon('ok')} ${shell.padEnd(5)} ${tildify(s.file)}`);
    else {
      problems++;
      out(`  ${icon('warn')} ${shell.padEnd(5)} ${tildify(s.file)} — ${s.blocks > 1 ? 'duplicate blocks' : 'outdated block'} (run: azmp doctor --fix)`);
    }
  }
  if (!installed) out(`  ${icon('warn')} not installed in any rc file (run: azmp setup)`);

  const loaded = process.env.AZMP_INIT_HASH;
  const expected = registryHash(reg, VERSION);
  if (!loaded) out(`  ${icon('info')} this shell has not loaded the integration`);
  else if (loaded !== expected) {
    out(`  ${icon('warn')} this shell's integration is stale — run ${bold('azmp reload')} or open a new terminal`);
  } else out(`  ${icon('ok')} loaded in this shell`);

  return problems ? 1 : 0;
}

export async function rename([from, to], opts) {
  if (!from || !to) throw usageError('Usage: azure-multiprofile rename <old> <new>');
  if (from === DEFAULT_PROFILE || to === DEFAULT_PROFILE) throw usageError('The default profile cannot be renamed.');
  const bad = validateName(to);
  if (bad) throw usageError(bad);
  const reg = loadRegistry();
  const p = requireProfile(reg, from);
  if (reg.profiles[to]) throw usageError(`A profile named "${to}" already exists.`);

  const entry = { ...reg.profiles[from] };
  const moves = [];
  if (!opts['keep-dirs']) {
    // Only move folders that follow the naming convention; custom paths stay put.
    if (samePath(p.azureConfigDir, azureDirFor(from))) moves.push(['azureConfigDir', azureDirFor(to)]);
    if (p.azdConfigDir && samePath(p.azdConfigDir, azdDirFor(from))) moves.push(['azdConfigDir', azdDirFor(to)]);
  }
  for (const [, dest] of moves) {
    if (fs.existsSync(dest)) throw usageError(`${tildify(dest)} already exists; not overwriting it.`);
  }
  for (const [key, dest] of moves) {
    if (fs.existsSync(entry[key])) fs.renameSync(entry[key], dest);
    out(dim(`  moved ${tildify(entry[key])} → ${tildify(dest)}`));
    entry[key] = dest;
  }
  delete reg.profiles[from];
  reg.profiles[to] = entry;
  saveRegistry(reg);
  out(`${green('✓')} Renamed "${from}" to "${to}". Run ${bold('azmp reload')} in open shells.`);
  out(dim('  Folders with a .azprofile pointing at the old name need `azmp link` again.'));
  return 0;
}

export async function remove([name], opts) {
  if (!name) throw usageError('Usage: azure-multiprofile remove <name> [--delete-data] [--yes]');
  if (name === DEFAULT_PROFILE) throw usageError('The default profile (~/.azure) cannot be removed.');
  const reg = loadRegistry();
  const p = requireProfile(reg, name);
  if (!(await confirm(`Remove profile "${name}"?`, { default: true, yes: opts.yes }))) {
    err('Cancelled.');
    return 1;
  }
  delete reg.profiles[name];
  saveRegistry(reg);
  out(`${green('✓')} Removed "${name}" from the registry.`);

  const dirs = [p.azureConfigDir, p.azdConfigDir].filter((d) => d && fs.existsSync(d));
  if (dirs.length === 0) return 0;
  const del =
    opts['delete-data'] &&
    (await confirm(`Delete ${dirs.map(tildify).join(' and ')} (sign-in tokens and settings)?`, {
      default: false,
      yes: opts.yes,
    }));
  if (del) {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
    out(`${green('✓')} Deleted ${dirs.map(tildify).join(', ')}.`);
  } else {
    out(dim(`  Kept ${dirs.map(tildify).join(', ')}. Delete manually or re-run with --delete-data.`));
  }
  return 0;
}
