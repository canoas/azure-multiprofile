import fs from 'node:fs';
import path from 'node:path';
import { loadRegistry, requireProfile, allProfiles } from '../registry.js';
import { profileEnv, mergeEnv, run, readAccount } from '../azcli.js';
import { renderEnv } from '../shell/index.js';
import { isWindows, samePath, validateName, tildify, DEFAULT_PROFILE } from '../paths.js';
import { out, err, green, dim, usageError } from '../ui.js';

export const LINK_FILE = '.azprofile';

export async function env([name], opts) {
  if (!name) throw usageError('Usage: azure-multiprofile env <profile> [--format sh|fish|pwsh|cmd|dotenv|json]');
  const profile = requireProfile(loadRegistry(), name);
  const format = opts.format || opts.shell || (isWindows() ? 'pwsh' : 'sh');
  out(renderEnv(format, profileEnv(profile)));
  return 0;
}

export async function exec(args) {
  const [name, ...rest] = args;
  const cmd = rest[0] === '--' ? rest.slice(1) : rest;
  if (!name || cmd.length === 0) throw usageError('Usage: azure-multiprofile exec <profile> -- <command> [args...]');
  const profile = requireProfile(loadRegistry(), name);
  return run(cmd[0], cmd.slice(1), mergeEnv(process.env, profileEnv(profile)));
}

export async function login(args) {
  const [name, ...rest] = args;
  if (!name) throw usageError('Usage: azure-multiprofile login <profile> [--azd] [az login args...]');
  const profile = requireProfile(loadRegistry(), name);
  const withAzd = rest.includes('--azd');
  const azArgs = rest.filter((a) => a !== '--azd' && a !== '--');
  const environment = mergeEnv(process.env, profileEnv(profile));
  err(dim(`Signing in to profile "${name}" (${tildify(profile.azureConfigDir)})`));
  const code = await run('az', ['login', ...azArgs], environment);
  if (code !== 0) return code;
  if (withAzd) {
    if (!profile.azdConfigDir) err(dim('Profile has no isolated azd folder; azd will use its shared login.'));
    return run('azd', ['auth', 'login'], environment);
  }
  return 0;
}

export async function use(positionals, _opts, { command }) {
  const name = positionals[0];
  const how = command === 'off' ? 'azmp off' : `azmp use ${name ?? '<profile>'}`;
  err(`\`${how}\` changes your current shell, so it needs the shell integration.`);
  err('Set it up with:   azure-multiprofile setup     (then open a new terminal)');
  if (command !== 'off' && name) {
    const sample = isWindows()
      ? `Invoke-Expression (azure-multiprofile env ${name} | Out-String)`
      : `eval "$(azure-multiprofile env ${name})"`;
    err(`Or, just for now:  ${sample}`);
  }
  return 1;
}

export function findLink(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    const file = path.join(dir, LINK_FILE);
    try {
      const first = fs.readFileSync(file, 'utf8').split(/\r?\n/)[0].trim().split(/\s+/)[0];
      if (first) return { name: first, file, root: dir };
    } catch {
      // not here
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export async function link([name], opts) {
  if (!name) throw usageError('Usage: azure-multiprofile link <profile>');
  requireProfile(loadRegistry(), name);
  const file = path.join(process.cwd(), LINK_FILE);
  if (fs.existsSync(file) && !opts.force) {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing === name) {
      out(dim(`Already linked to "${name}".`));
      return 0;
    }
    throw usageError(`${LINK_FILE} already links this folder to "${existing}". Use --force to replace it.`);
  }
  fs.writeFileSync(file, `${name}\n`);
  out(`${green('✓')} Linked ${tildify(process.cwd())} to profile "${name}".`);
  out(dim(`  Shells with azmp integration switch automatically here. Commit ${LINK_FILE} or add it to .gitignore.`));
  return 0;
}

export async function unlink() {
  const file = path.join(process.cwd(), LINK_FILE);
  if (!fs.existsSync(file)) {
    out(dim(`No ${LINK_FILE} in this folder.`));
    return 0;
  }
  fs.rmSync(file);
  out(`${green('✓')} Removed ${LINK_FILE}.`);
  return 0;
}

/** Which profile is active for this process, and why. */
export function resolveCurrent(reg = loadRegistry(), environment = process.env) {
  const dir = environment.AZURE_CONFIG_DIR;
  if (dir) {
    const match = allProfiles(reg).find((p) => samePath(p.azureConfigDir, dir));
    if (match) return { name: match.name, source: 'env', profile: match };
    return { name: null, source: 'env', dir };
  }
  const linked = findLink();
  if (linked && !validateName(linked.name)) {
    const p = allProfiles(reg).find((x) => x.name === linked.name);
    if (p) return { name: p.name, source: 'link', link: linked, profile: p, inactive: true };
  }
  return { name: DEFAULT_PROFILE, source: 'default', profile: allProfiles(reg)[0] };
}

export async function current(_positionals, opts) {
  const c = resolveCurrent();
  if (!c.name) {
    out(opts.verbose ? `(unregistered) AZURE_CONFIG_DIR=${c.dir}` : '(unregistered)');
    return 0;
  }
  if (!opts.verbose) {
    out(c.name);
    return 0;
  }
  const why = {
    env: 'from AZURE_CONFIG_DIR in this shell',
    link: `linked by ${tildify(c.link?.file)}, but not active in this shell (no azmp integration?)`,
    default: 'AZURE_CONFIG_DIR is not set',
  }[c.source];
  out(`${c.name}  ${dim(why)}`);
  return 0;
}

export async function prompt(_positionals, opts) {
  const c = resolveCurrent();
  const dir = c.profile?.azureConfigDir ?? c.dir;
  const acct = dir ? readAccount(dir) : null;
  const values = {
    profile: c.name ?? 'custom',
    subscription: acct?.subscription ?? '',
    user: acct?.user ?? '',
    tenant: acct?.tenantId ?? '',
  };
  const fmt = opts.format ?? (values.subscription ? '{profile}:{subscription}' : '{profile}');
  process.stdout.write(fmt.replace(/\{(\w+)\}/g, (m, k) => (k in values ? values[k] : m)));
  return 0;
}
