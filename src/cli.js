import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { usageError } from './ui.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
export const VERSION = pkg.version;

const HELP = `azure-multiprofile ${VERSION} — run several Azure CLI accounts side by side

Usage: azure-multiprofile <command> [options]     (short alias: azmp)

Profiles
  add [name]                 Create a profile (interactive wizard, or flags)
  list                       Show profiles and who is signed in to each
  status                     Check directories and shell integration
  rename <old> <new>         Rename a profile (moves its folders)
  remove <name>              Remove a profile (keeps data unless --delete-data)

Using a profile
  use <name> | off           Switch the current shell (needs shell integration)
  az-<name> ...              One-off az command, e.g. az-work group list
  exec <name> -- <cmd...>    Run any command with the profile's environment
  login <name> [args...]     az login inside the profile (--azd also runs azd auth login)
  env <name> [--format f]    Print variables: sh, fish, pwsh, cmd, dotenv, json
  link <name> | unlink       Pin the current directory to a profile (.azprofile)
  current [-v]               Print the active profile
  prompt [--format f]        Prompt segment, e.g. "{profile}:{subscription}"

Setup and maintenance
  setup [--shell s,...]      Add shell integration to your rc files (--uninstall removes it)
  init <shell>               Print the shell integration script (zsh, bash, fish, pwsh)
  doctor [--fix] [--undo]    Diagnose and repair common problems

  help, --help, -h           Show this help
  --version, -v              Print the version`;

/** Commands and their parseArgs option specs. Loaded lazily. */
const COMMANDS = {
  add: {
    load: () => import('./commands/add.js'),
    options: {
      dir: { type: 'string' },
      azd: { type: 'boolean' },
      'no-azd': { type: 'boolean' },
      seed: { type: 'boolean' },
      'no-seed': { type: 'boolean' },
      extensions: { type: 'boolean' },
      shell: { type: 'string' },
      'no-shell': { type: 'boolean' },
      login: { type: 'boolean' },
      tenant: { type: 'string' },
      'device-code': { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
    },
  },
  list: { load: () => import('./commands/profiles.js'), fn: 'list', options: { json: { type: 'boolean' } } },
  ls: { alias: 'list' },
  status: { load: () => import('./commands/profiles.js'), fn: 'status', options: {} },
  rename: { load: () => import('./commands/profiles.js'), fn: 'rename', options: { 'keep-dirs': { type: 'boolean' } } },
  remove: {
    load: () => import('./commands/profiles.js'),
    fn: 'remove',
    options: { 'delete-data': { type: 'boolean' }, yes: { type: 'boolean', short: 'y' } },
  },
  rm: { alias: 'remove' },
  env: {
    load: () => import('./commands/env.js'),
    fn: 'env',
    options: { format: { type: 'string', short: 'f' }, shell: { type: 'string' } },
  },
  exec: { load: () => import('./commands/env.js'), fn: 'exec', raw: true },
  login: { load: () => import('./commands/env.js'), fn: 'login', raw: true },
  use: { load: () => import('./commands/env.js'), fn: 'use', options: {} },
  off: { load: () => import('./commands/env.js'), fn: 'use', options: {} },
  link: { load: () => import('./commands/env.js'), fn: 'link', options: { force: { type: 'boolean' } } },
  unlink: { load: () => import('./commands/env.js'), fn: 'unlink', options: {} },
  current: {
    load: () => import('./commands/env.js'),
    fn: 'current',
    options: { verbose: { type: 'boolean', short: 'v' } },
  },
  prompt: {
    load: () => import('./commands/env.js'),
    fn: 'prompt',
    options: { format: { type: 'string', short: 'f' } },
  },
  init: { load: () => import('./commands/shell.js'), fn: 'init', options: {} },
  setup: {
    load: () => import('./commands/shell.js'),
    fn: 'setup',
    options: { shell: { type: 'string' }, uninstall: { type: 'boolean' } },
  },
  doctor: {
    load: () => import('./commands/doctor.js'),
    options: { fix: { type: 'boolean' }, undo: { type: 'boolean' }, json: { type: 'boolean' } },
  },
};

export async function main(argv) {
  let [name, ...rest] = argv;
  if (!name || name === 'help' || name === '--help' || name === '-h') {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  if (name === '--version' || name === '-v' || name === 'version') {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  let spec = COMMANDS[name];
  if (spec?.alias) {
    name = spec.alias;
    spec = COMMANDS[name];
  }
  if (!spec) throw usageError(`Unknown command "${name}". Run \`azure-multiprofile help\`.`);
  if (rest.includes('--help') || rest.includes('-h')) {
    if (!spec.raw || rest[0] === '--help' || rest[0] === '-h') {
      process.stdout.write(`${HELP}\n`);
      return 0;
    }
  }

  const mod = await spec.load();
  const fn = mod[spec.fn ?? 'default'];
  if (spec.raw) return fn(rest, { command: name });

  let parsed;
  try {
    parsed = parseArgs({ args: rest, options: spec.options, allowPositionals: true, strict: true });
  } catch (e) {
    throw usageError(e.message);
  }
  return fn(parsed.positionals, parsed.values, { command: name });
}
