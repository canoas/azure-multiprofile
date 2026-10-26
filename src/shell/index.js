import { renderPosix } from './posix.js';
import { renderFish } from './fish.js';
import { renderPwsh } from './pwsh.js';
import * as quote from './quote.js';

export function renderInit(shell, opts) {
  switch (shell) {
    case 'zsh':
    case 'bash':
      return renderPosix(shell, opts);
    case 'fish':
      return renderFish(opts);
    case 'pwsh':
    case 'powershell':
      return renderPwsh(opts);
    default:
      throw Object.assign(new Error(`Unsupported shell "${shell}". Use zsh, bash, fish or pwsh.`), { exitCode: 2 });
  }
}

/**
 * Environment assignments for one profile in a given syntax.
 * `vars` maps name -> value, where null means "unset".
 */
export function renderEnv(format, vars) {
  const entries = Object.entries(vars);
  switch (format) {
    case 'sh':
    case 'zsh':
    case 'bash':
      return entries.map(([k, v]) => (v == null ? `unset ${k}` : `export ${k}=${quote.sh(v)}`)).join('\n');
    case 'fish':
      return entries.map(([k, v]) => (v == null ? `set -e ${k}` : `set -gx ${k} ${quote.fish(v)}`)).join('\n');
    case 'pwsh':
    case 'powershell':
      return entries
        .map(([k, v]) =>
          v == null ? `Remove-Item Env:${k} -ErrorAction SilentlyContinue` : `$env:${k} = ${quote.pwsh(v)}`,
        )
        .join('\n');
    case 'cmd':
      return entries.map(([k, v]) => (v == null ? `set "${k}="` : `set "${k}=${quote.cmd(v)}"`)).join('\r\n');
    case 'dotenv':
      return entries
        .filter(([, v]) => v != null)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join('\n');
    case 'json':
      return JSON.stringify(vars, null, 2);
    default:
      throw Object.assign(new Error(`Unknown format "${format}". Use sh, fish, pwsh, cmd, dotenv or json.`), {
        exitCode: 2,
      });
  }
}
