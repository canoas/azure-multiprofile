# Security policy

azure-multiprofile manages folders that contain Azure sign-in tokens, so we take
security reports seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's
[private vulnerability reporting](https://github.com/canoas/azure-multiprofile/security/advisories/new)
instead. Include the version (`azmp --version`), your OS and shell, and steps to
reproduce. You can expect an acknowledgement within a few days.

## What the tool does and does not do

- It never reads, copies, logs or transmits token caches (`msal_token_cache.*`,
  `service_principal_entries.*`, `accessTokens.json`).
- The only file it reads inside a profile folder is `azureProfile.json` (account
  and subscription names) and, for `doctor`, the profile's `config`.
- It never writes to `~/.azure`.
- It makes no network requests. Network traffic comes only from `az`, `azd` or `npm`
  when you run them.
- It writes only to: profile folders it created, its registry
  (`~/.config/azure-multiprofile` or `%APPDATA%\azure-multiprofile`), the managed
  block in your shell rc files, and `.azprofile` files you ask for.
- Profile folders are created with mode `0700` on POSIX systems, and `doctor` warns
  when they are readable by other users.

## Supported versions

Only the latest released version receives fixes.
