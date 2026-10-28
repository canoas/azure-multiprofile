# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- Piping output into a command that stops reading early (`azmp list | head -1`) no longer
  crashes with an `EPIPE` stack trace. The rest of the output is dropped and the command
  still finishes, so `add` completes its shell setup and sign-in steps.

## [0.1.1] - 2026-10-28

First stable release. `0.1.0` was never published; `0.1.1-rc.0` to `0.1.1-rc.4` were
prereleases on the `next` tag.

### Added
- Profiles that isolate `AZURE_CONFIG_DIR` (and optionally `AZD_CONFIG_DIR`) per account.
- `add` wizard with non-interactive flags, `list`, `status`, `rename`, `remove`.
- `exec`, `login`, `env` (sh, fish, pwsh, cmd, dotenv, json), `current`, `prompt`.
- Shell integration for zsh, bash, fish and PowerShell: `azmp use/off/reload`,
  `az-<profile>` / `azd-<profile>` one-shot functions, `.azprofile` per-folder auto-switch.
- `setup` / `init` with managed rc-file blocks that never touch lines outside the markers.
- Settings seeding from `~/.azure` through an allowlist, with secret keys stripped.
- `doctor` with `--fix`, snapshots and `--undo`, including a Windows WAM broker check.

### Fixed (since the release candidates)
- `add` wizard: a folder typed as a bare name (e.g. `my-folder`) is now created in the
  home folder instead of the current directory, which was `C:\Windows\System32` in an
  elevated `cmd`. The wizard previews the full path as you type.
- `add` refuses to create profile folders under the Windows system folder.
- `add` keeps the `azmp login` step in "Next steps" when sign-in was requested but
  skipped (for example because `az` is not on PATH), including the `--tenant` you passed.
- `azmp reload` / `use` / `off` without shell integration now explain how to load it
  instead of "Unknown command".

### Changed
- Clearer wizard wording: the profile name is what you type in commands, and the folder
  only stores az data. "Next steps" says which name to use, and on Windows how to run
  commands from `cmd.exe`.
- README: new "Profile name vs. folder" section; Windows notes cover `cmd.exe`,
  Administrator terminals and a missing `az`.

[Unreleased]: https://github.com/canoas/azure-multiprofile/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/canoas/azure-multiprofile/releases/tag/v0.1.1
