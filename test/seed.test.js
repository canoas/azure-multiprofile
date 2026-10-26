import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stripSecrets, seedConfig, listExtensions, setIniValue, getIniValue } from '../src/seed.js';

test('stripSecrets drops storage and batch credentials only', () => {
  const ini = [
    '[core]',
    'output = table',
    '[storage]',
    'account = mystore',
    'key = AAAA',
    'SAS_TOKEN=?sv=x',
    'connection_string = DefaultEndpoints...',
    '[batch]',
    'account = b',
    'access_key = zzz',
    '[defaults]',
    'key = not-a-secret-here',
  ].join('\n');
  const out = stripSecrets(ini);
  assert.match(out, /output = table/);
  assert.match(out, /account = mystore/);
  assert.match(out, /key = not-a-secret-here/);
  assert.doesNotMatch(out, /AAAA|sv=x|DefaultEndpoints|zzz/);
});

test('seedConfig copies only allowlisted files and never token caches', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'azmp-seed-'));
  const from = path.join(root, 'from');
  const to = path.join(root, 'to');
  fs.mkdirSync(path.join(from, 'cliextensions', 'aks-preview'), { recursive: true });
  for (const f of [
    'config',
    'clouds.config',
    'msal_token_cache.json',
    'msal_token_cache.bin',
    'azureProfile.json',
    'service_principal_entries.json',
    'accessTokens.json',
    'msal_http_cache.bin',
  ]) {
    fs.writeFileSync(path.join(from, f), f === 'config' ? '[storage]\nkey = SECRET\n' : 'x');
  }
  const written = seedConfig(from, to);
  assert.deepEqual(written.sort(), ['clouds.config', 'config']);
  assert.deepEqual(fs.readdirSync(to).sort(), ['clouds.config', 'config']);
  assert.doesNotMatch(fs.readFileSync(path.join(to, 'config'), 'utf8'), /SECRET/);
  assert.deepEqual(listExtensions(from), ['aks-preview']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('seedConfig never overwrites files already in the profile', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'azmp-seed-'));
  fs.mkdirSync(path.join(root, 'from'));
  fs.mkdirSync(path.join(root, 'to'));
  fs.writeFileSync(path.join(root, 'from', 'config'), 'new');
  fs.writeFileSync(path.join(root, 'to', 'config'), 'mine');
  assert.deepEqual(seedConfig(path.join(root, 'from'), path.join(root, 'to')), []);
  assert.equal(fs.readFileSync(path.join(root, 'to', 'config'), 'utf8'), 'mine');
  fs.rmSync(root, { recursive: true, force: true });
});

test('setIniValue updates, appends to a section, or adds the section', () => {
  assert.equal(getIniValue(setIniValue('[core]\nx = 1\n', 'core', 'x', '2'), 'core', 'x'), '2');
  const appended = setIniValue('[core]\noutput = json\n\n[cloud]\nname = AzureCloud\n', 'core', 'enable_broker_on_windows', 'false');
  assert.equal(getIniValue(appended, 'core', 'enable_broker_on_windows'), 'false');
  assert.match(appended, /\[core\]\noutput = json\nenable_broker_on_windows = false\n/);
  const added = setIniValue('', 'core', 'enable_broker_on_windows', 'false');
  assert.equal(added, '[core]\nenable_broker_on_windows = false\n');
});
