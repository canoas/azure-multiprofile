const useColor = () => process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb';

const wrap = (open, close) => (s) => (useColor() ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));
export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const cyan = wrap(36, 39);

export const out = (s = '') => process.stdout.write(`${s}\n`);
export const err = (s = '') => process.stderr.write(`${s}\n`);

const ICON = { ok: green('✓'), warn: yellow('!'), error: red('✗'), info: cyan('i') };
export const icon = (level) => ICON[level] ?? ' ';

// eslint-disable-next-line no-control-regex
const visible = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '').length;

export function table(headers, rows) {
  const widths = headers.map((h, i) => Math.max(visible(h), ...rows.map((r) => visible(r[i] ?? ''))));
  const line = (cells) =>
    cells
      .map((c, i) => (i === cells.length - 1 ? String(c ?? '') : String(c ?? '') + ' '.repeat(widths[i] - visible(c ?? ''))))
      .join('  ')
      .trimEnd();
  return [bold(line(headers)), ...rows.map(line)].join('\n');
}

export const isInteractive = () => Boolean(process.stdin.isTTY && process.stdout.isTTY) && !process.env.CI;

/** Lazy-loads @inquirer/prompts so non-interactive commands start fast. */
export async function prompts() {
  return import('@inquirer/prompts');
}

export async function confirm(message, { default: def = false, yes = false } = {}) {
  if (yes) return true;
  if (!isInteractive()) return def;
  const { confirm: ask } = await prompts();
  return ask({ message, default: def });
}

export function usageError(message) {
  return Object.assign(new Error(message), { exitCode: 2 });
}
