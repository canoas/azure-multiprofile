import fs from 'node:fs';
import path from 'node:path';
import { loadRegistry, saveRegistry, allProfiles } from '../registry.js';
import {
  DEFAULT_PROFILE,
  azureDirFor,
  azdDirFor,
  defaultAzureDir,
  expandHome,
  home,
  isWindows,
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

  if (ask) {
    out(dim('A profile has a short name you type in commands (azmp use <name>, az-<name>)'));
    out(dim('and a folder where az keeps that account\'s sign-in and settings.\n'));
  }

  let name = nameArg;
  if (!name && ask) {
    name = await ask.input({
      message: 'Profile name — what you will type in commands (e.g. work, contoso):',
      validate: (v) => nameProblem(v) ?? true,
    });
  }
  if (!name) throw usageError('Usage: azure-multiprofile add <name> [--dir PATH] [--azd] [--seed] [--login] [--yes]');
  const problem = nameProblem(name);
  if (problem) throw usageError(problem);

  const dirTaken = (dir) => allProfiles(reg).find((p) => samePath(p.azureConfigDir, dir) || samePath(p.azdConfigDir, dir));

  // --dir follows CLI convention (relative to the current directory); a bare
  // folder typed into the wizard goes under the home folder instead, so running
  // from e.g. C:\Windows\System32 never puts sign-ins there.
  let azureConfigDir = opts.dir ? expandHome(opts.dir) : azureDirFor(name);
  if (!opts.dir && ask) {
    const fromAnswer = (v) => resolveFolderAnswer(v, azureConfigDir);
    azureConfigDir = fromAnswer(
      await ask.input({
        message: 'Folder for this profile\'s az data (press Enter to use the default):',
        default: tildify(azureConfigDir),
        transformer: (v, { isFinal }) => {
          const full = fromAnswer(v);
          return isFinal || !v.trim() || tildify(full) === v.trim() ? v : `${v}  → ${tildify(full)}`;
        },
        validate: (v) => folderProblem(fromAnswer(v), dirTaken) ?? true,
      }),
    );
  }
  const problemDir = folderProblem(azureConfigDir, dirTaken);
  if (problemDir) throw usageError(problemDir);

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
  let signedIn = false;
  if (login) {
    if (!which('az')) {
      err('az was not found on PATH; skipping sign-in. Install it from https://aka.ms/azcli, then open a new terminal.');
    } else {
      const code = await run('az', ['login', ...loginArgs], environment);
      if (code !== 0) err(`az login exited with ${code}.`);
      signedIn = code === 0;
    }
  }

  const retryLogin = [`azmp login ${name}`, ...loginArgs].join(' ');
  out('');
  out(bold(`Next steps — use the profile name "${name}" in every command`));
  const steps = [
    ...(signedIn ? [] : [[retryLogin, 'sign in']]),
    ['azmp reload', 'load the new profile into open shells'],
    [`azmp use ${name}`, 'switch this shell'],
    [`az-${name} account show`, 'one-off command'],
    [`azmp link ${name}`, 'auto-switch in the current folder'],
  ];
  const width = Math.max(...steps.map(([c]) => c.length)) + 3;
  for (const [cmd, what] of steps) out(`  ${cmd.padEnd(width)}${dim(what)}`);
  if (isWindows()) {
    out(dim(`  azmp use and az-${name} need PowerShell. In cmd.exe use: azmp exec ${name} -- az account show`));
  }
  return 0;
}

/** Wizard answer -> absolute folder. Relative answers live under the home folder. */
export function resolveFolderAnswer(answer, fallback) {
  const v = answer.trim();
  if (!v) return fallback;
  if (v === '~' || v.startsWith('~/') || v.startsWith('~\\') || path.isAbsolute(v)) return expandHome(v);
  return path.join(home(), v);
}

function folderProblem(dir, dirTaken) {
  const taken = dirTaken(dir);
  if (taken) return `${tildify(dir)} is already used by profile "${taken.name}".`;
  if (isWindows()) {
    const sysRoot = process.env.SystemRoot || 'C:\\Windows';
    const rel = path.relative(sysRoot.toLowerCase(), dir.toLowerCase());
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
      return `Refusing to keep sign-ins under ${sysRoot}. Choose a folder in your user profile (the default is fine).`;
    }
  }
  return null;
}
