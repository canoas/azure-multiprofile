import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox } from './helpers.js';

let sb;
beforeEach(() => {
  sb = sandbox();
});
afterEach(() => sb.cleanup());

test('--version and help', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(sb.run(['--version']).stdout.trim(), pkg.version);
  assert.match(sb.run(['help']).stdout, /Usage: azure-multiprofile/);
  assert.equal(sb.run(['bogus']).code, 2);
});

test('add creates folders and a registry entry', () => {
  const r = sb.run(['add', 'work', '--azd', '--yes', '--no-shell']);
  assert.equal(r.code, 0, r.stderr);
  const reg = sb.registry();
  assert.equal(reg.profiles.work.azureConfigDir, path.join(sb.home, '.azure-work'));
  assert.equal(reg.profiles.work.azdConfigDir, path.join(sb.home, '.azd-work'));
  assert.ok(fs.existsSync(path.join(sb.home, '.azure-work')));
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path.join(sb.home, '.azure-work')).mode & 0o777, 0o700);
  }
});

test('add rejects bad, reserved, duplicate and colliding names', () => {
  assert.equal(sb.run(['add', 'Work!', '--yes']).code, 2);
  assert.equal(sb.run(['add', 'default', '--yes']).code, 2);
  assert.equal(sb.run(['add', 'work', '--yes', '--no-shell']).code, 0);
  assert.equal(sb.run(['add', 'work', '--yes', '--no-shell']).code, 2);
  const clash = sb.run(['add', 'other', '--dir', path.join(sb.home, '.azure-work'), '--yes', '--no-shell']);
  assert.equal(clash.code, 2);
  assert.match(clash.stderr, /already used by profile "work"/);
});

test('add --seed copies settings but not tokens; --shell installs the rc block', () => {
  fs.mkdirSync(path.join(sb.home, '.azure'));
  fs.writeFileSync(path.join(sb.home, '.azure', 'config'), '[core]\noutput = table\n');
  fs.writeFileSync(path.join(sb.home, '.azure', 'msal_token_cache.json'), '{"secret":1}');
  const r = sb.run(['add', 'work', '--seed', '--shell', 'zsh,bash', '--yes']);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(fs.readdirSync(path.join(sb.home, '.azure-work')), ['config']);
  assert.match(sb.read('.zshrc'), /azure-multiprofile init zsh/);
  const bashrc = process.platform === 'darwin' ? '.bash_profile' : '.bashrc';
  assert.match(sb.read(bashrc), /azure-multiprofile init bash/);
});

test('add never modifies ~/.azure', () => {
  fs.mkdirSync(path.join(sb.home, '.azure'));
  fs.writeFileSync(path.join(sb.home, '.azure', 'config'), '[storage]\nkey = s\n');
  sb.run(['add', 'work', '--seed', '--yes', '--no-shell']);
  assert.equal(fs.readFileSync(path.join(sb.home, '.azure', 'config'), 'utf8'), '[storage]\nkey = s\n');
});

test('list shows default first and reads the signed-in account offline', () => {
  sb.run(['add', 'work', '--yes', '--no-shell']);
  // az writes azureProfile.json with a BOM.
  fs.writeFileSync(
    path.join(sb.home, '.azure-work', 'azureProfile.json'),
    '﻿' +
      JSON.stringify({
        subscriptions: [
          { name: 'Other', isDefault: false, user: { name: 'x@y' } },
          { name: 'Prod', isDefault: true, user: { name: 'me@contoso.com' }, tenantId: 't' },
        ],
      }),
  );
  const out = sb.run(['list']).stdout;
  assert.ok(out.indexOf('default') < out.indexOf('work'));
  assert.match(out, /me@contoso\.com\s+Prod/);
  const json = JSON.parse(sb.run(['list', '--json']).stdout);
  assert.equal(json[1].account.subscription, 'Prod');
});

test('env prints each format, unsetting AZD_CONFIG_DIR when not isolated', () => {
  sb.run(['add', 'work', '--yes', '--no-shell']);
  const dir = path.join(sb.home, '.azure-work');
  assert.equal(
    sb.run(['env', 'work', '-f', 'sh']).stdout,
    `export AZURE_CONFIG_DIR='${dir}'\nunset AZD_CONFIG_DIR\nexport AZMP_PROFILE='work'\n`,
  );
  assert.match(sb.run(['env', 'work', '-f', 'fish']).stdout, /set -gx AZURE_CONFIG_DIR '.*\.azure-work'\nset -e AZD_CONFIG_DIR/);
  assert.match(sb.run(['env', 'work', '-f', 'pwsh']).stdout, /\$env:AZURE_CONFIG_DIR = '.*'\nRemove-Item Env:AZD_CONFIG_DIR/);
  assert.match(sb.run(['env', 'work', '-f', 'cmd']).stdout, /set "AZURE_CONFIG_DIR=.*"/);
  assert.deepEqual(JSON.parse(sb.run(['env', 'work', '-f', 'json']).stdout), {
    AZURE_CONFIG_DIR: dir,
    AZD_CONFIG_DIR: null,
    AZMP_PROFILE: 'work',
  });
  assert.equal(sb.run(['env', 'nope']).code, 2);
});

test('env quotes paths with spaces and quotes safely', () => {
  const weird = path.join(sb.home, "it's a dir");
  sb.run(['add', 'odd', '--dir', weird, '--yes', '--no-shell']);
  assert.match(sb.run(['env', 'odd', '-f', 'sh']).stdout, /export AZURE_CONFIG_DIR='.*it'\\''s a dir'/);
  assert.match(sb.run(['env', 'odd', '-f', 'pwsh']).stdout, /it''s a dir'/);
});

test('exec and login run az inside the profile', () => {
  sb.run(['add', 'work', '--azd', '--yes', '--no-shell']);
  const dir = path.join(sb.home, '.azure-work');
  const r = sb.run(['exec', 'work', '--', 'az', 'group', 'list']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`az\\[${dir.replace(/[\\.]/g, '\\$&')}\\] group list`));
  const l = sb.run(['login', 'work', '--use-device-code', '--azd']);
  assert.match(l.stdout, /az\[.*\.azure-work\] login --use-device-code/);
  assert.match(l.stdout, /azd\[.*\.azd-work\] auth login/);
});

test('use without shell integration explains how to set it up', () => {
  sb.run(['add', 'work', '--yes', '--no-shell']);
  const r = sb.run(['use', 'work']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /azure-multiprofile setup/);
  const reload = sb.run(['reload']);
  assert.equal(reload.code, 1);
  assert.match(reload.stderr, /`azmp reload` changes your current shell/);
  sb.run(['setup', '--shell', 'bash']);
  assert.match(sb.run(['reload']).stderr, /open a new terminal, or load it now with:\n {2}eval "\$\(azure-multiprofile init bash\)"/);
});

test('link, current and unlink', () => {
  sb.run(['add', 'work', '--yes', '--no-shell']);
  const proj = path.join(sb.home, 'proj', 'deep');
  fs.mkdirSync(proj, { recursive: true });
  assert.equal(sb.run(['link', 'nope'], { cwd: path.join(sb.home, 'proj') }).code, 2);
  assert.equal(sb.run(['link', 'work'], { cwd: path.join(sb.home, 'proj') }).code, 0);
  assert.equal(sb.read('proj/.azprofile'), 'work\n');
  assert.equal(sb.run(['current'], { cwd: proj }).stdout.trim(), 'work');
  assert.match(sb.run(['current', '-v'], { cwd: proj }).stdout, /not active in this shell/);
  // An explicit AZURE_CONFIG_DIR wins over the folder link.
  const env = { AZURE_CONFIG_DIR: path.join(sb.home, '.azure') };
  assert.equal(sb.run(['current'], { cwd: proj, env }).stdout.trim(), 'default');
  assert.equal(sb.run(['current'], { cwd: proj, env: { AZURE_CONFIG_DIR: '/elsewhere' } }).stdout.trim(), '(unregistered)');
  sb.run(['unlink'], { cwd: path.join(sb.home, 'proj') });
  assert.equal(sb.run(['current'], { cwd: proj }).stdout.trim(), 'default');
});

test('prompt renders profile and subscription', () => {
  sb.run(['add', 'work', '--yes', '--no-shell']);
  const env = { AZURE_CONFIG_DIR: path.join(sb.home, '.azure-work') };
  assert.equal(sb.run(['prompt'], { env }).stdout, 'work');
  fs.writeFileSync(
    path.join(sb.home, '.azure-work', 'azureProfile.json'),
    JSON.stringify({ subscriptions: [{ name: 'Dev', isDefault: true, user: { name: 'u' } }] }),
  );
  assert.equal(sb.run(['prompt'], { env }).stdout, 'work:Dev');
  assert.equal(sb.run(['prompt', '-f', '[{user}@{profile}]'], { env }).stdout, '[u@work]');
});

test('rename moves conventional folders and keeps tokens', () => {
  sb.run(['add', 'work', '--azd', '--yes', '--no-shell']);
  fs.writeFileSync(path.join(sb.home, '.azure-work', 'msal_token_cache.json'), 'tok');
  assert.equal(sb.run(['rename', 'work', 'job']).code, 0);
  const reg = sb.registry();
  assert.equal(reg.profiles.work, undefined);
  assert.equal(reg.profiles.job.azureConfigDir, path.join(sb.home, '.azure-job'));
  assert.equal(reg.profiles.job.azdConfigDir, path.join(sb.home, '.azd-job'));
  assert.equal(sb.read('.azure-job/msal_token_cache.json'), 'tok');
  assert.equal(sb.run(['rename', 'default', 'x']).code, 2);
});

test('remove keeps data unless --delete-data', () => {
  sb.run(['add', 'a', '--yes', '--no-shell']);
  sb.run(['add', 'b', '--yes', '--no-shell']);
  assert.equal(sb.run(['remove', 'a', '--yes']).code, 0);
  assert.ok(fs.existsSync(path.join(sb.home, '.azure-a')));
  assert.equal(sb.run(['remove', 'b', '--yes', '--delete-data']).code, 0);
  assert.ok(!fs.existsSync(path.join(sb.home, '.azure-b')));
  assert.deepEqual(sb.registry().profiles, {});
  assert.equal(sb.run(['remove', 'default', '--yes']).code, 2);
});

test('registry keeps a .bak and doctor --fix restores a corrupt file; --undo reverts', () => {
  sb.run(['add', 'a', '--yes', '--no-shell']);
  sb.run(['add', 'b', '--yes', '--no-shell']);
  const file = path.join(sb.state, 'profiles.json');
  fs.writeFileSync(file, '{ broken');
  assert.equal(sb.run(['list']).code, 1);
  const d = sb.run(['doctor']);
  assert.equal(d.code, 1);
  assert.match(d.stdout, /corrupt/);
  assert.equal(sb.run(['doctor', '--fix']).code, 0);
  assert.ok(sb.registry().profiles.a);
  assert.equal(sb.run(['doctor', '--undo']).code, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ broken');
});

test('doctor fixes missing folders, loose permissions and stale rc blocks', () => {
  sb.run(['add', 'work', '--yes', '--shell', 'zsh']);
  fs.rmSync(path.join(sb.home, '.azure-work'), { recursive: true });
  fs.writeFileSync(
    path.join(sb.home, '.zshrc'),
    'export AZURE_CONFIG_DIR=~/.azure-x\n# >>> azure-multiprofile >>>\nold\n# <<< azure-multiprofile <<<\n',
  );
  const before = sb.run(['doctor']).stdout;
  assert.match(before, /is missing/);
  assert.match(before, /outdated block/);
  assert.match(before, /\.zshrc:1 sets AZURE_CONFIG_DIR for every shell/);
  sb.run(['doctor', '--fix']);
  assert.ok(fs.existsSync(path.join(sb.home, '.azure-work')));
  assert.match(sb.read('.zshrc'), /init zsh/);
  assert.match(sb.read('.zshrc'), /^export AZURE_CONFIG_DIR=~\/\.azure-x\n/); // never touched outside the block
  sb.run(['doctor', '--undo']);
  assert.match(sb.read('.zshrc'), /\nold\n/);
  assert.ok(!fs.existsSync(path.join(sb.home, '.azure-work')));
});

test('doctor tightens folder permissions on POSIX', { skip: process.platform === 'win32' }, () => {
  sb.run(['add', 'work', '--yes', '--no-shell']);
  fs.chmodSync(path.join(sb.home, '.azure-work'), 0o755);
  assert.match(sb.run(['doctor']).stdout, /readable by other users/);
  sb.run(['doctor', '--fix']);
  assert.equal(fs.statSync(path.join(sb.home, '.azure-work')).mode & 0o777, 0o700);
});

test('doctor flags the Windows WAM broker and --fix turns it off', () => {
  const env = { AZMP_TEST_PLATFORM: 'win32' };
  sb.run(['add', 'work', '--yes', '--no-shell']);
  assert.match(sb.run(['doctor'], { env }).stdout, /WAM broker is on/);
  sb.run(['doctor', '--fix'], { env });
  assert.match(sb.read('.azure-work/config'), /\[core\]\nenable_broker_on_windows = false/);
  assert.doesNotMatch(sb.run(['doctor'], { env }).stdout, /WAM broker is on/);
});

test('setup installs and uninstalls the rc block idempotently', () => {
  const rc = path.join(sb.home, '.zshrc');
  fs.writeFileSync(rc, 'mine\n');
  sb.run(['setup', '--shell', 'zsh']);
  sb.run(['setup', '--shell', 'zsh']);
  assert.equal((fs.readFileSync(rc, 'utf8').match(/>>> azure-multiprofile >>>/g) || []).length, 1);
  sb.run(['setup', '--shell', 'zsh', '--uninstall']);
  assert.equal(fs.readFileSync(rc, 'utf8'), 'mine\n');
  sb.run(['setup', '--shell', 'pwsh']);
  assert.match(fs.readFileSync(sb.env.AZMP_PWSH_PROFILE, 'utf8'), /init pwsh/);
});

test('wizard folder answers: bare names go under home, never the current directory', async () => {
  process.env.AZMP_HOME = sb.home;
  try {
    const { resolveFolderAnswer } = await import('../src/commands/add.js');
    const fallback = path.join(sb.home, '.azure-x');
    assert.equal(resolveFolderAnswer('', fallback), fallback);
    assert.equal(resolveFolderAnswer('azure-client-tweakhub', fallback), path.join(sb.home, 'azure-client-tweakhub'));
    assert.equal(resolveFolderAnswer('~/.azure-y', fallback), path.join(sb.home, '.azure-y'));
    assert.equal(resolveFolderAnswer('/abs/dir', fallback), path.resolve('/abs/dir'));
  } finally {
    delete process.env.AZMP_HOME;
  }
});

test('add refuses to put a profile under the Windows system folder', () => {
  // Real Windows processes crash without their real SystemRoot, so only fake it elsewhere.
  // The folder is refused before anything is created, so the real one is safe to use.
  const onWindows = process.platform === 'win32';
  const sysRoot = onWindows ? process.env.SystemRoot : path.join(sb.root, 'Windows');
  const env = onWindows ? {} : { AZMP_TEST_PLATFORM: 'win32', SystemRoot: sysRoot };
  const r = sb.run(['add', 'client-a', '--dir', path.join(sysRoot, 'System32', 'azure-client'), '--yes', '--no-shell'], { env });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Refusing to keep sign-ins under/);
  assert.equal(sb.run(['add', 'client-a', '--yes', '--no-shell'], { env }).code, 0);
});

test('add lists the sign-in step when sign-in was requested but did not happen', () => {
  const env = { PATH: path.dirname(process.execPath) }; // no az on PATH
  const r = sb.run(['add', 'contoso', '--tenant', 'contoso.onmicrosoft.com', '--yes', '--no-shell'], { env });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /az was not found on PATH/);
  assert.match(r.stdout, /azmp login contoso --tenant contoso\.onmicrosoft\.com\s+sign in/);
  assert.match(r.stdout, /use the profile name "contoso"/);
  const win = sb.run(['add', 'other', '--yes', '--no-shell'], { env: { AZMP_TEST_PLATFORM: 'win32' } });
  assert.match(win.stdout, /In cmd\.exe use: azmp exec other -- az account show/);
});
