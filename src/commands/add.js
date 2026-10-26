import fs from 'node:fs';
import { loadRegistry, saveRegistry, allProfiles } from '../registry.js';
import {
  DEFAULT_PROFILE,
  azureDirFor,
  azdDirFor,
  defaultAzureDir,
  expandHome,
  samePath,
  tildify,
  validateName,
} from '../paths.js';
import { seedConfig, listExtensions } from '../seed.js';
import { which, run, mergeEnv, profileEnv } from '../azcli.js';
import { inspectShell, installShell, currentShell } from '../rcfile.js';
import { parseShells } from './shell.js';
import { out, err, bold, dim, green, isInteractive, prompts, usageError } from '../ui.js';

/** Boolean option with a --no-x twin; undefined means "ask". */
const flag = (opts, key) => (opts[key] ? true : opts[`no-${key}`] ? false : undefined);

export default async function add([nameArg], opts) {
  const reg = loadRegistry();
  const interactive = isInteractive() && !opts.yes;
  const ask = interactive ? await prompts() : null;

  const nameProblem = (n) => {
    const bad = validateName(n);
    if (bad) return bad;
    if (n === DEFAULT_PROFILE) return '"default" is reserved for ~/.azure.';
    if (reg.profiles[n]) return `A profile named "${n}" already exists.`;
    return null;
  };

  let name = nameArg;
  if (!name && ask) {
    name = await ask.input({ message: 'Profile name (e.g. work, client-a):', validate: (v) => nameProblem(v) ?? true });
  }
  if (!name) throw usageError('Usage: azure-multiprofile add <name> [--dir PATH] [--azd] [--seed] [--login] [--yes]');
  const problem = nameProblem(name);
  if (problem) throw usageError(problem);

  const dirTaken = (dir) => allProfiles(reg).find((p) => samePath(p.azureConfigDir, dir) || samePath(p.azdConfigDir, dir));

  let azureConfigDir = opts.dir ? expandHome(opts.dir) : azureDirFor(name);
  if (!opts.dir && ask) {
    azureConfigDir = expandHome(
      await ask.input({
        message: 'Azure CLI folder for this profile:',
        default: tildify(azureConfigDir),
        validate: (v) => {
          const taken = dirTaken(expandHome(v));
          return taken ? `Already used by profile "${taken.name}".` : true;
        },
      }),
    );
  }
  const taken = dirTaken(azureConfigDir);
  if (taken) throw usageError(`${tildify(azureConfigDir)} is already used by profile "${taken.name}".`);

  let azd = flag(opts, 'azd');
  if (azd === undefined) {
    const hasAzd = Boolean(which('azd'));
    azd = ask
      ? await ask.confirm({ message: 'Also isolate the Azure Developer CLI (azd) login?', default: hasAzd })
      : false;
  }

  const sourceDir = defaultAzureDir();
  const canSeed = fs.existsSync(`${sourceDir}/config`) || fs.existsSync(`${sourceDir}/clouds.config`);
  let seed = flag(opts, 'seed');
  if (seed === undefined) {
    seed =
      canSeed && ask
        ? await ask.confirm({
            message: `Copy your az settings from ${tildify(sourceDir)}? (settings only — never sign-ins or tokens)`,
            default: true,
          })
        : false;
  }

  const extensions = seed ? listExtensions(sourceDir) : [];
  let installExt = Boolean(opts.extensions);
  if (!installExt && extensions.length && ask) {
    installExt = await ask.confirm({
      message: `Install your ${extensions.length} az extension(s) in the new profile (${extensions.join(', ')})?`,
      default: false,
    });
  }

  // Create everything before any network or shell work, so a failed login leaves a usable profile.
  fs.mkdirSync(azureConfigDir, { recursive: true, mode: 0o700 });
  const entry = { azureConfigDir, azdConfigDir: null, createdAt: new Date().toISOString() };
  if (azd) {
    entry.azdConfigDir = azdDirFor(name);
    fs.mkdirSync(entry.azdConfigDir, { recursive: true, mode: 0o700 });
  }
  reg.profiles[name] = entry;
  saveRegistry(reg);
  out(`${green('✓')} Created profile ${bold(name)} → ${tildify(azureConfigDir)}`);
  if (entry.azdConfigDir) out(`${green('✓')} azd folder → ${tildify(entry.azdConfigDir)}`);

  if (seed) {
    const copied = seedConfig(sourceDir, azureConfigDir);
    out(copied.length ? `${green('✓')} Copied ${copied.join(', ')} from ${tildify(sourceDir)}` : dim('  Nothing to copy.'));
  }

  const environment = mergeEnv(process.env, profileEnv({ name, ...entry }));
  if (installExt) {
    for (const ext of extensions) {
      out(dim(`  az extension add --name ${ext}`));
      const code = await run('az', ['extension', 'add', '--name', ext, '--only-show-errors'], environment);
      if (code !== 0) err(`  could not install ${ext} (exit ${code}); continuing`);
    }
  }

  // Shell integration: explicit --shell installs; otherwise offer it once if missing.
  if (!opts['no-shell']) {
    let shells = [];
    if (opts.shell) shells = parseShells(opts.shell);
    else if (ask) {
      const sh = currentShell();
      const state = inspectShell(sh);
      if (!state.blocks) {
        const yes = await ask.confirm({
          message: `Add azmp shell integration to ${tildify(state.file)}? (enables \`azmp use\`, az-${name}, auto-switch)`,
          default: true,
        });
        if (yes) shells = [sh];
      }
    }
    for (const sh of shells) {
      const r = installShell(sh);
      out(r.changed ? `${green('✓')} Shell integration added to ${tildify(r.file)}` : dim(`  ${tildify(r.file)} already set up`));
    }
  }

  let login = Boolean(opts.login || opts.tenant || opts['device-code']);
  const loginArgs = [];
  if (opts['device-code']) loginArgs.push('--use-device-code');
  if (opts.tenant) loginArgs.push('--tenant', opts.tenant);
  if (!login && ask) {
    login = await ask.confirm({ message: `Sign in to "${name}" now?`, default: true });
    if (login) {
      const method = await ask.select({
        message: 'How do you want to sign in?',
        choices: [
          { name: 'Browser', value: 'browser' },
          { name: 'Device code (another device, SSH, containers)', value: 'device' },
        ],
      });
      if (method === 'device') loginArgs.push('--use-device-code');
      const tenant = await ask.input({ message: 'Tenant ID or domain (optional):', default: '' });
      if (tenant.trim()) loginArgs.push('--tenant', tenant.trim());
    }
  }
  if (login) {
    if (!which('az')) err('az was not found on PATH; skipping sign-in.');
    else {
      const code = await run('az', ['login', ...loginArgs], environment);
      if (code !== 0) err(`az login exited with ${code}. Retry with: azmp login ${name}`);
    }
  }

  out('');
  out(bold('Next steps'));
  const steps = [
    ...(login ? [] : [[`azmp login ${name}`, 'sign in']]),
    ['azmp reload', 'load the new profile into open shells'],
    [`azmp use ${name}`, 'switch this shell'],
    [`az-${name} account show`, 'one-off command'],
    [`azmp link ${name}`, 'auto-switch in the current folder'],
  ];
  const width = Math.max(...steps.map(([c]) => c.length)) + 3;
  for (const [cmd, what] of steps) out(`  ${cmd.padEnd(width)}${dim(what)}`);
  return 0;
}
