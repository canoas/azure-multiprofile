import fs from 'node:fs';
import path from 'node:path';
import { loadRegistry, validateRegistry, allProfiles, RegistryError, registryHash } from '../registry.js';
import { SHELLS, inspectShell, installShell, readFileOr, findBlocks } from '../rcfile.js';
import { which, azVersion, azdVersion } from '../azcli.js';
import { getIniValue, setIniValue } from '../seed.js';
import { VERSION } from '../cli.js';
import { isWindows, registryFile, snapshotsDir, samePath, tildify } from '../paths.js';
import { out, bold, dim, green, icon } from '../ui.js';

const KEEP_SNAPSHOTS = 10;

/**
 * Each check returns findings: { level, message, fix?: { describe, files, apply } }.
 * `files` lists every path the fix may write, so it can be snapshotted for --undo.
 */
function checkRegistry() {
  const file = registryFile();
  if (!fs.existsSync(file)) return [{ level: 'info', message: 'No profiles yet (run: azmp add)' }];
  try {
    loadRegistry(file);
    return [{ level: 'ok', message: `Registry ${tildify(file)}` }];
  } catch (e) {
    if (!(e instanceof RegistryError)) throw e;
    const bak = `${file}.bak`;
    let bakOk = false;
    try {
      bakOk = !validateRegistry(JSON.parse(fs.readFileSync(bak, 'utf8')));
    } catch {
      bakOk = false;
    }
    return [
      {
        level: 'error',
        message: `Registry ${tildify(file)} is corrupt`,
        fix: bakOk
          ? { describe: `restore ${tildify(bak)}`, files: [file], apply: () => fs.copyFileSync(bak, file) }
          : undefined,
      },
    ];
  }
}

function checkTools(profiles) {
  const findings = [];
  if (!which('az')) {
    findings.push({ level: 'error', message: 'az is not on PATH (https://aka.ms/azcli)' });
  } else {
    const v = process.env.AZMP_SKIP_VERSION ? null : azVersion();
    findings.push({ level: 'ok', message: `az ${v ?? ''} at ${which('az')}`.replace('  ', ' ') });
  }
  if (profiles.some((p) => p.azdConfigDir)) {
    if (!which('azd')) findings.push({ level: 'warn', message: 'A profile isolates azd, but azd is not on PATH' });
    else {
      const v = process.env.AZMP_SKIP_VERSION ? null : azdVersion();
      findings.push({ level: 'ok', message: `azd ${v ?? ''} at ${which('azd')}`.replace('  ', ' ') });
    }
  }
  return findings;
}

function checkProfiles(profiles) {
  const findings = [];
  const seen = [];
  for (const p of profiles) {
    for (const [label, dir] of [
      ['AZURE_CONFIG_DIR', p.azureConfigDir],
      ['AZD_CONFIG_DIR', p.azdConfigDir],
    ]) {
      if (!dir) continue;
      const clash = seen.find((s) => samePath(s.dir, dir));
      if (clash) {
        findings.push({
          level: 'error',
          message: `Profiles "${clash.name}" and "${p.name}" share ${tildify(dir)}; they will sign each other out. Edit or remove one.`,
        });
      }
      seen.push({ name: p.name, dir });
      if (p.implicit) continue;
      if (!fs.existsSync(dir)) {
        findings.push({
          level: 'warn',
          message: `${p.name}: ${label} ${tildify(dir)} is missing`,
          fix: { describe: `create ${tildify(dir)}`, files: [], dirs: [dir], apply: () => fs.mkdirSync(dir, { recursive: true, mode: 0o700 }) },
        });
      } else if (!isWindows()) {
        const mode = fs.statSync(dir).mode & 0o777;
        if (mode & 0o077) {
          findings.push({
            level: 'warn',
            message: `${p.name}: ${tildify(dir)} is readable by other users (mode ${mode.toString(8)}); it holds sign-in tokens`,
            fix: { describe: `chmod 700 ${tildify(dir)}`, files: [], modes: [[dir, mode]], apply: () => fs.chmodSync(dir, 0o700) },
          });
        }
      }
    }
    if (isWindows() && fs.existsSync(p.azureConfigDir)) findings.push(...checkBroker(p));
  }
  if (!findings.some((f) => f.level !== 'ok')) findings.push({ level: 'ok', message: `${profiles.length} profile(s), folders OK` });
  return findings;
}

/**
 * On Windows, az signs in through WAM by default. WAM keeps accounts in the OS,
 * not in AZURE_CONFIG_DIR, so the account picker can surface another profile's identity.
 */
function checkBroker(p) {
  const file = path.join(p.azureConfigDir, 'config');
  const ini = readFileOr(file);
  const value = (getIniValue(ini, 'core', 'enable_broker_on_windows') ?? '').toLowerCase();
  if (['false', 'no', 'off', '0'].includes(value)) return [];
  return [
    {
      level: 'warn',
      message: `${p.name}: WAM broker is on; Windows may offer the wrong account at sign-in`,
      fix: {
        describe: `set core.enable_broker_on_windows=false in ${tildify(file)}`,
        files: [file],
        apply: () => fs.writeFileSync(file, setIniValue(ini, 'core', 'enable_broker_on_windows', 'false')),
      },
    },
  ];
}

const GLOBAL_EXPORT = /^\s*(export\s+|set\s+-[gUx]+\s+|\$env:)?(AZURE_CONFIG_DIR|AZD_CONFIG_DIR)\s*[= ]/;

function checkShells(reg) {
  const findings = [];
  let installed = 0;
  for (const shell of SHELLS) {
    const s = inspectShell(shell);
    if (!s.exists) continue;
    const content = readFileOr(s.file);
    // Global exports outside our block pin every terminal to one profile.
    const blocks = findBlocks(content);
    content.split('\n').forEach((line, i) => {
      if (blocks.some((b) => i >= b.start && i <= b.end)) return;
      const m = line.match(GLOBAL_EXPORT);
      if (m) {
        findings.push({
          level: 'warn',
          message: `${tildify(s.file)}:${i + 1} sets ${m[2]} for every shell; remove it and use profiles instead`,
        });
      }
    });
    if (!s.blocks) continue;
    installed++;
    if (s.current) findings.push({ level: 'ok', message: `${shell} integration in ${tildify(s.file)}` });
    else {
      findings.push({
        level: 'warn',
        message: `${tildify(s.file)}: ${s.blocks > 1 ? `${s.blocks} duplicate blocks` : 'outdated block'}`,
        fix: { describe: 'rewrite the managed block', files: [s.file], apply: () => installShell(shell) },
      });
    }
  }
  if (!installed) {
    findings.push({ level: 'warn', message: 'Shell integration is not installed (run: azmp setup)' });
  }
  const loaded = process.env.AZMP_INIT_HASH;
  if (loaded && reg && loaded !== registryHash(reg, VERSION)) {
    findings.push({ level: 'info', message: 'This shell has stale integration; run `azmp reload` or open a new terminal' });
  }
  return findings;
}

function checkEnvironment(profiles) {
  const dir = process.env.AZURE_CONFIG_DIR;
  if (!dir) return [];
  if (profiles.some((p) => samePath(p.azureConfigDir, dir))) return [];
  return [{ level: 'info', message: `AZURE_CONFIG_DIR=${tildify(dir)} in this shell is not a registered profile` }];
}

export function runChecks() {
  const sections = [];
  const regFindings = checkRegistry();
  let reg = null;
  try {
    reg = loadRegistry();
  } catch {
    reg = null;
  }
  const profiles = reg ? allProfiles(reg) : [];
  sections.push(['Tools', checkTools(profiles)]);
  sections.push(['Registry', regFindings]);
  if (reg) sections.push(['Profiles', [...checkProfiles(profiles), ...checkEnvironment(profiles)]]);
  sections.push(['Shells', checkShells(reg)]);
  return sections;
}

// --- snapshots for --undo -------------------------------------------------

function takeSnapshot(fixes) {
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(snapshotsDir(), id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const manifest = { id, createdAt: new Date().toISOString(), files: [], dirs: [], modes: [] };
  const files = [...new Set(fixes.flatMap((f) => f.files ?? []))];
  files.forEach((file, i) => {
    const existed = fs.existsSync(file);
    const backup = existed ? `${i}.bak` : null;
    if (existed) fs.copyFileSync(file, path.join(dir, backup));
    manifest.files.push({ path: file, existed, backup });
  });
  for (const f of fixes) {
    for (const d of f.dirs ?? []) if (!fs.existsSync(d)) manifest.dirs.push(d);
    for (const [d, mode] of f.modes ?? []) manifest.modes.push({ path: d, mode });
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  pruneSnapshots();
  return id;
}

function listSnapshots() {
  try {
    return fs
      .readdirSync(snapshotsDir())
      .filter((n) => fs.existsSync(path.join(snapshotsDir(), n, 'manifest.json')))
      .sort();
  } catch {
    return [];
  }
}

function pruneSnapshots() {
  const all = listSnapshots();
  for (const id of all.slice(0, Math.max(0, all.length - KEEP_SNAPSHOTS))) {
    fs.rmSync(path.join(snapshotsDir(), id), { recursive: true, force: true });
  }
}

function undo() {
  const all = listSnapshots();
  if (!all.length) {
    out('Nothing to undo.');
    return 0;
  }
  const id = all[all.length - 1];
  const dir = path.join(snapshotsDir(), id);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  for (const f of manifest.files) {
    if (f.existed) fs.copyFileSync(path.join(dir, f.backup), f.path);
    else fs.rmSync(f.path, { force: true });
    out(`${green('✓')} restored ${tildify(f.path)}`);
  }
  for (const m of manifest.modes) {
    if (fs.existsSync(m.path)) fs.chmodSync(m.path, m.mode);
    out(`${green('✓')} restored mode of ${tildify(m.path)}`);
  }
  for (const d of manifest.dirs.reverse()) {
    try {
      fs.rmdirSync(d); // only if still empty
      out(`${green('✓')} removed ${tildify(d)}`);
    } catch {
      out(dim(`  kept ${tildify(d)} (not empty)`));
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  out(dim(`Undid doctor run ${id}.`));
  return 0;
}

export default async function doctor(_positionals, opts) {
  if (opts.undo) return undo();

  let sections = runChecks();
  if (opts.json) {
    const plain = sections.map(([name, fs_]) => ({
      section: name,
      findings: fs_.map(({ level, message, fix }) => ({ level, message, fixable: Boolean(fix), fix: fix?.describe })),
    }));
    out(JSON.stringify(plain, null, 2));
    return sections.some(([, f]) => f.some((x) => x.level === 'error')) ? 1 : 0;
  }

  const print = () => {
    for (const [name, findings] of sections) {
      out(bold(name));
      for (const f of findings) {
        out(`  ${icon(f.level)} ${f.message}${f.fix && !opts.fix ? dim(`  [fixable: ${f.fix.describe}]`) : ''}`);
      }
    }
  };
  print();

  const fixes = sections.flatMap(([, f]) => f).filter((f) => f.fix).map((f) => f.fix);
  if (opts.fix && fixes.length) {
    const id = takeSnapshot(fixes);
    out(bold('\nFixing'));
    for (const fix of fixes) {
      fix.apply();
      out(`  ${green('✓')} ${fix.describe}`);
    }
    out(dim(`  Snapshot ${id} saved; \`azmp doctor --undo\` reverts this run.`));
    // Registry repair must happen before re-checking anything that reads it.
    sections = runChecks();
    out('');
    print();
  } else if (fixes.length) {
    out(dim(`\n${fixes.length} issue(s) can be fixed automatically: azmp doctor --fix`));
  }
  return sections.some(([, f]) => f.some((x) => x.level === 'error')) ? 1 : 0;
}
