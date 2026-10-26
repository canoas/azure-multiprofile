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

## Releasing (maintainers)

Releases go through `.github/workflows/release.yml` when a version tag is pushed.
It runs the full test matrix, then **stages** the version on npm with
[`npm stage publish`](https://docs.npmjs.com/cli/commands/npm-stage). A staged
version can't be installed until a maintainer approves it with 2FA.

| Tag | npm dist-tag after approval | Install with |
|---|---|---|
| `v0.2.0-rc.1`, `v0.2.0-beta.1` | `next` | `npm i -g azure-multiprofile@next` |
| `v0.2.0` | `latest` | `npm i -g azure-multiprofile` |

```sh
# 1. Tag. CI tests, then stages to npm and creates a draft GitHub release
npm version prerelease --preid rc     # e.g. 0.1.1-rc.2; commits and tags
git push origin main "v$(node -p "require('./package.json').version")"

# 2. Approve from a normal terminal (needs your passkey/2FA)
npm stage list azure-multiprofile
npm stage approve <stage-id>          # or: npm stage reject <stage-id>

# 3. Check, then publish the draft release on GitHub
npm view azure-multiprofile dist-tags
gh release edit "v<version>" --draft=false

# Final release: same steps, starting with `npm version patch|minor|major`
```

Push only the new tag (as above) rather than `--follow-tags`, so older local tags
don't trigger the workflow again. Release tags are protected and can't be moved,
so if a release goes wrong, bump to the next version instead of re-tagging. Update
`CHANGELOG.md` before tagging a final release. The workflow refuses a tag that
doesn't match `package.json`, and a version that's already on npm.

Auth uses npm [trusted publishing](https://docs.npmjs.com/trusted-publishers),
so no npm token is stored in GitHub. The trust relationship only allows staging:

```sh
npx npm@11 trust github azure-multiprofile --repo canoas/azure-multiprofile \
  --file release.yml --allow-stage-publish
npx npm@11 trust list azure-multiprofile
```
