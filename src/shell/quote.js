/** POSIX sh single-quoted literal. */
export const sh = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** fish single-quoted literal (only \ and ' are special). */
export const fish = (s) => `'${String(s).replace(/[\\']/g, (c) => `\\${c}`)}'`;

/** PowerShell single-quoted literal. */
export const pwsh = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** cmd.exe `set` value: quoting the whole assignment keeps spaces and most specials literal. */
export const cmd = (s) => String(s).replace(/%/g, '%%');
