# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - Unreleased

### Added
- Profiles that isolate `AZURE_CONFIG_DIR` (and optionally `AZD_CONFIG_DIR`) per account.
- `add` wizard with non-interactive flags, `list`, `status`, `rename`, `remove`.
- `exec`, `login`, `env` (sh, fish, pwsh, cmd, dotenv, json), `current`, `prompt`.
- Shell integration for zsh, bash, fish and PowerShell: `azmp use/off/reload`,
  `az-<profile>` / `azd-<profile>` one-shot functions, `.azprofile` per-folder auto-switch.
- `setup` / `init` with managed rc-file blocks that never touch lines outside the markers.
- Settings seeding from `~/.azure` through an allowlist, with secret keys stripped.
- `doctor` with `--fix`, snapshots and `--undo`, including a Windows WAM broker check.
