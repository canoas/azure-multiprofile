import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { sandbox, has } from './helpers.js';

// Sources the real `init` output in each installed shell and checks behaviour.
// Every script prints "<profile>|<basename of AZURE_CONFIG_DIR>" after each step.

let sb;
before(() => {
  sb = sandbox();
  sb.run(['add', 'work', '--azd', '--yes', '--no-shell']);
  sb.run(['add', 'client-a', '--yes', '--no-shell']);
  fs.mkdirSync(path.join(sb.home, 'proj', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(sb.home, 'proj', '.azprofile'), 'work\n');
});
after(() => sb?.cleanup());

const EXPECTED = [
  'orig|orig', // before: whatever the user had
  'work|.azure-work', // cd into a linked tree activates it
  'orig|orig', // leaving restores the previous value
  'oneshot:.azure-client-a', // az-<name> runs one command...
  'orig|orig', // ...without touching the shell
  'client-a|.azure-client-a', // azmp use
  'client-a|.azure-client-a', // manual choice beats the folder link
  'work|.azure-work', // azmp off hands control back to the link
];

function runShell(cmd, args, script) {
  const r = spawnSync(cmd, [...args, script], { env: sb.env, cwd: sb.home, encoding: 'utf8' });
  assert.equal(r.status, 0, `${cmd} failed:\n${r.stderr}\n${r.stdout}`);
  return r.stdout.trim().split(/\r?\n/).map((l) => l.trim());
}

const posixScript = (shell) => `
eval "$(azure-multiprofile init ${shell})"
p() { ${shell === 'bash' ? '__azmp_hook; ' : ''}echo "\${AZMP_PROFILE:-orig}|\${AZURE_CONFIG_DIR##*/}"; }
export AZURE_CONFIG_DIR=/x/orig
p
cd proj/sub; p
cd ../..; p
echo "oneshot:$(az-client-a | sed 's/^az\\[.*\\/\\(.*\\)\\].*/\\1/')"
p
azmp use client-a; p
cd proj; p
azmp off; export AZURE_CONFIG_DIR=$AZURE_CONFIG_DIR; p
`;

for (const shell of ['zsh', 'bash']) {
  test(`${shell} integration`, { skip: !has(shell) || process.platform === 'win32' }, () => {
    assert.deepEqual(runShell(shell, ['-c'], posixScript(shell)), EXPECTED);
  });
}

test('fish integration', { skip: !has('fish') || process.platform === 'win32' }, () => {
  const script = `
azure-multiprofile init fish | source
function p; echo (set -q AZMP_PROFILE; and echo $AZMP_PROFILE; or echo orig)"|"(basename "$AZURE_CONFIG_DIR"); end
set -gx AZURE_CONFIG_DIR /x/orig
p
cd proj/sub; p
cd ../..; p
echo "oneshot:"(az-client-a | string replace -r '^az\\[.*/(.*)\\].*' '$1')
p
azmp use client-a; p
cd proj; p
azmp off; p
`;
  assert.deepEqual(runShell('fish', ['-c'], script), EXPECTED);
});

test('pwsh integration', { skip: !has('pwsh') }, () => {
  const script = `
$ErrorActionPreference = 'Stop'
Invoke-Expression (& azure-multiprofile init pwsh | Out-String)
function p { __azmp_hook; $n = if ($env:AZMP_PROFILE) { $env:AZMP_PROFILE } else { 'orig' }; "$n|$(Split-Path -Leaf $env:AZURE_CONFIG_DIR)" }
$env:AZURE_CONFIG_DIR = (Join-Path ([IO.Path]::GetTempPath()) 'orig')
p
Set-Location proj/sub; p
Set-Location ../..; p
"oneshot:" + ((az-client-a | Out-String).Trim() -replace '^az\\[.*[\\\\/](.*)\\].*', '$1')
p
azmp use client-a; p
Set-Location proj; p
azmp off; p
`;
  assert.deepEqual(runShell('pwsh', ['-NoProfile', '-NonInteractive', '-Command'], script), EXPECTED);
});

for (const shell of ['zsh', 'bash']) {
  test(`${shell}: azmp add reloads the integration in the same shell`, { skip: !has(shell) || process.platform === 'win32' }, () => {
    const script = `
eval "$(azure-multiprofile init ${shell})"
azmp add fresh-${shell} --yes --no-shell >/dev/null
az-fresh-${shell} | sed 's/^az\\[.*\\/\\(.*\\)\\].*/\\1/'
azmp use fresh-${shell} && echo "$AZMP_PROFILE"
`;
    assert.deepEqual(runShell(shell, ['-c'], script), [`.azure-fresh-${shell}`, `fresh-${shell}`]);
  });
}

test('fish: azmp add reloads the integration in the same shell', { skip: !has('fish') || process.platform === 'win32' }, () => {
  const script = `
azure-multiprofile init fish | source
azmp add fresh-fish --yes --no-shell >/dev/null
az-fresh-fish | string replace -r '^az\\[.*/(.*)\\].*' '$1'
azmp use fresh-fish; and echo $AZMP_PROFILE
`;
  assert.deepEqual(runShell('fish', ['-c'], script), ['.azure-fresh-fish', 'fresh-fish']);
});
