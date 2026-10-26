# Contributing

Thanks for helping! Bug reports, docs fixes and PRs are all welcome.

## Development

```sh
git clone https://github.com/canoas/azure-multiprofile
cd azure-multiprofile
npm install
npm link            # puts azure-multiprofile / azmp on your PATH
npm test
```

The test suite never touches your real HOME. `test/helpers.js` creates a throwaway
HOME and state folder, puts stub `az`/`azd` commands on `PATH`, and points the tool
at them through these variables:

| Variable | Purpose |
|---|---|
| `AZMP_HOME` | Overrides the home folder |
| `AZMP_STATE_DIR` | Overrides the registry/snapshot folder |
| `AZMP_PWSH_PROFILE` | Overrides the PowerShell `$PROFILE` path |
| `AZMP_TEST_PLATFORM` | Pretends to run on another OS (e.g. `win32`) |
| `AZMP_SKIP_VERSION` | Skips the `az version` call in `doctor` |
| `AZMP_DEBUG` | Prints stack traces |

`test/shell.test.js` runs the generated integration in every shell that is
installed (zsh, bash, fish, pwsh). CI installs all of them, so please run the
shells you have locally before opening a PR.

## Layout

```
bin/azure-multiprofile.js   entry point
src/cli.js                  argument parsing and dispatch
src/paths.js                per-OS locations, name validation
src/registry.js             profiles.json (atomic writes, .bak)
src/rcfile.js               managed rc-file blocks
src/shell/                  init script generators (posix, fish, pwsh) and env renderers
src/seed.js                 allowlisted settings copy, INI helpers
src/azcli.js                az/azd helpers, offline account lookup
src/commands/               one module per command group
```

## Guidelines

- Keep the only runtime dependency `@inquirer/prompts`. Use Node built-ins for everything else.
- Never read or copy token caches. New files copied by `--seed` need a security rationale.
- Never edit rc-file lines outside the managed block.
- Every `doctor` fix must list the files it writes so `--undo` can restore them.
- Add a test for every bug fix.
