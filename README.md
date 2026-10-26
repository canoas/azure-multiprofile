# azure-multiprofile

[![test](https://github.com/canoas/azure-multiprofile/actions/workflows/test.yml/badge.svg)](https://github.com/canoas/azure-multiprofile/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/azure-multiprofile)](https://www.npmjs.com/package/azure-multiprofile)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Run several **Azure CLI** (`az`) and **Azure Developer CLI** (`azd`) accounts on one computer at the same time: work and personal, several customers, several tenants. Each account lives in its own isolated profile. Signing in to one never signs you out of another.

```console
$ azmp list
   PROFILE   SIGNED IN AS           SUBSCRIPTION      AZURE_CONFIG_DIR   AZD_CONFIG_DIR
   default   me@outlook.com         Pay-As-You-Go     ~/.azure           shared
*  work      jose@contoso.com       Contoso-Prod      ~/.azure-work      ~/.azd-work
   client-a  jose@fabrikam.com      Fabrikam-Dev      ~/.azure-client-a  shared

$ az-client-a group list -o table      # one-off command as client-a
$ azmp use work                        # switch this terminal to work
$ cd ~/src/fabrikam-api                # folder linked to client-a: switches automatically
```

> Community project. Not affiliated with or supported by Microsoft.

## Why

`az` keeps everything (settings, the signed-in account list, and the MSAL token cache) in one folder, `~/.azure`. Open two terminals, sign in to a second account in one of them, and both terminals now share that state. `az account set` only switches between subscriptions of accounts that are already signed in. It can't keep a work identity and a customer identity apart, and it can't keep two terminals on different accounts.

The CLI does support moving that folder with the `AZURE_CONFIG_DIR` environment variable. [Rakhesh Sasidharan described the trick](https://rakhesh.com/azure/az-cli-and-multiple-accounts/) with a couple of shell functions. **azure-multiprofile** turns it into a tool:

- a registry of profiles and a wizard to create them
- `azmp use <profile>` to switch the current shell, and `az-<profile> …` for one-off commands
- **per-folder auto-switch** with a `.azprofile` file, like `.nvmrc`
- `AZD_CONFIG_DIR` isolation for `azd`
- prompt integration (starship, oh-my-posh, plain PS1)
- `doctor --fix` (with `--undo`) for the things that go wrong
- zsh, bash, fish and PowerShell, on macOS, Linux and Windows

## Install

Requires Node.js 20.17+ and the [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli).

```sh
npm install -g azure-multiprofile
azmp add          # wizard: name, folders, azd, copy settings, shell setup, sign in
```

`azmp` is a short alias for `azure-multiprofile`. Both are installed.

## Quick start

```sh
azmp add work --azd --seed --login     # create, copy settings from ~/.azure, sign in
azmp add client-a --tenant fabrikam.onmicrosoft.com   # implies --login
azmp setup                             # add shell integration to your rc file (the wizard offers this too)
exec $SHELL                            # or open a new terminal

azmp use work && az account show       # this terminal is now "work"
az-client-a account show               # one command as client-a; the shell stays on "work"
azmp off                               # back to ~/.azure
```

The untouched `~/.azure` is always available as the profile named **`default`**.

## How it works

| What | Where |
|---|---|
| Profile's Azure CLI folder | `~/.azure-<name>` (`%USERPROFILE%\.azure-<name>` on Windows) |
| Profile's azd folder (optional) | `~/.azd-<name>` |
| Registry | `~/.config/azure-multiprofile/profiles.json` (`%APPDATA%\azure-multiprofile` on Windows), plus a `.bak` of the last good copy |
| `doctor --fix` snapshots | `~/.config/azure-multiprofile/snapshots/` (last 10) |
| Shell integration | a marked block in `~/.zshrc`, `~/.bashrc` (`~/.bash_profile` on macOS), `~/.config/fish/config.fish` or your PowerShell `$PROFILE` |

A profile is just a pair of environment variables:

```sh
AZURE_CONFIG_DIR=~/.azure-work     # az: settings, accounts, token cache, extensions, logs
AZD_CONFIG_DIR=~/.azd-work         # azd: its own login and settings (if enabled)
AZMP_PROFILE=work                  # for your prompt
```

Anything that reads Azure CLI credentials follows `AZURE_CONFIG_DIR`. That includes Terraform's `azurerm` provider, Bicep, `kubelogin -l azurecli`, and `AzureCliCredential` / `DefaultAzureCredential` in the Azure SDKs. So `azmp exec work -- terraform plan` works without any extra setup.

### Shell integration

The rc-file block is one line that runs `azure-multiprofile init <shell>` when the shell starts. The generated script:

- defines `azmp`. `use`, `off`, `reload`, `link` and `unlink` act on the current shell; other subcommands go to the CLI.
- defines `az-<profile>` (and `azd-<profile>`) for each profile.
- adds a hook that auto-switches on `cd`: zsh `chpwd`, bash `PROMPT_COMMAND`, fish `--on-variable PWD`, PowerShell `LocationChangedAction`. The hook is plain shell and never starts Node.
- exports `AZMP_PROFILE` and defines `azmp_prompt_info` for your prompt.

Profile folders are written into the generated script. The terminal where you run `azmp add`, `rename` or `remove` reloads itself. In other open terminals, run `azmp reload` or open new ones. `azmp status` tells you when a shell is stale.

Lines outside the `# >>> azure-multiprofile >>>` markers are never modified. `azmp setup --uninstall` removes the block.

### Per-folder profiles

```sh
cd ~/src/fabrikam-api
azmp link client-a       # writes .azprofile containing "client-a"
```

When you `cd` into that folder or any subfolder, the shell switches to `client-a`. When you leave, it restores whatever was active before. An explicit `azmp use` overrides links until you run `azmp off`. Set `AZMP_NO_AUTO=1` to turn auto-switching off. You can commit `.azprofile` so teammates with the same profile names get the same behavior, or add it to `.gitignore`.

Outside an interactive shell (CI, scripts, Makefiles), use `azmp exec <name> -- …`, or `eval "$(azmp env <name>)"`.

### Prompt

Cheapest (reads an env var, nothing runs):

```sh
# zsh / bash
PS1='$(azmp_prompt_info)'"$PS1"
```

```toml
# starship.toml
[env_var.AZMP_PROFILE]
format = "[az:$env_value]($style) "
style = "blue"
```

With the subscription name (starts Node once per prompt and reads `azureProfile.json` offline, with no network):

```toml
[custom.azmp]
command = "azure-multiprofile prompt --format '{profile}:{subscription}'"
when = "true"
format = "[az:$output]($style) "
```

Placeholders: `{profile}`, `{subscription}`, `{user}`, `{tenant}`.

## Commands

| Command | What it does |
|---|---|
| `add [name]` | Create a profile. Interactive by default. Flags: `--dir PATH`, `--azd/--no-azd`, `--seed/--no-seed`, `--extensions`, `--shell zsh,bash`, `--no-shell`, `--login`, `--tenant T`, `--device-code`, `--yes` |
| `list [--json]` | Profiles with the signed-in user and subscription (read offline) |
| `status` | Folder and sign-in state, rc blocks, and whether this shell's integration is current |
| `use <name>` / `off` | Switch the current shell (shell integration only) |
| `exec <name> -- <cmd…>` | Run any command with the profile's environment |
| `login <name> [--azd] [az login args]` | `az login` (and `azd auth login`) inside the profile |
| `env <name> [-f sh\|fish\|pwsh\|cmd\|dotenv\|json]` | Print the profile's variables |
| `link <name>` / `unlink` | Write or remove `.azprofile` in the current folder |
| `current [-v]` | Active profile, and with `-v`, why |
| `prompt [-f FORMAT]` | Prompt segment |
| `rename <old> <new>` | Rename a profile. Moves `~/.azure-old` to `~/.azure-new` and keeps sign-ins. `--keep-dirs` leaves the folders where they are |
| `remove <name> [--delete-data] [-y]` | Remove from the registry. Folders are kept unless you pass `--delete-data` and confirm |
| `setup [--shell s,…] [--uninstall]` | Add or remove the rc-file block |
| `init <shell>` | Print the integration script (what the rc block runs) |
| `doctor [--fix] [--undo] [--json]` | Diagnose, repair, revert |

## Copying settings (`--seed`)

New profiles can start with your existing `az` preferences. Only `config` and `clouds.config` are copied from `~/.azure`, and secret-bearing keys are removed first: `[storage] key / sas_token / connection_string`, `[batch] access_key` and `[batchai] storage_key`. These are **never** copied: `msal_token_cache.*`, `azureProfile.json`, `service_principal_entries.*`, `accessTokens.json`, `msal_http_cache*`, logs and caches.

Extensions are installed per folder (`$AZURE_CONFIG_DIR/cliextensions`). With `--extensions`, the wizard reinstalls the ones you have in `~/.azure`. To share one extension folder across all profiles, set `AZURE_EXTENSION_DIR` yourself.

## doctor

`azmp doctor` checks:

- `az`/`azd` are on PATH, with their versions
- the registry is valid (`--fix` restores `.bak`)
- profile folders exist (`--fix` creates them) and aren't readable by other users (`--fix` runs `chmod 700`)
- no two profiles share a folder
- no rc file exports `AZURE_CONFIG_DIR` for every shell (reported only; your lines are never edited)
- rc blocks aren't outdated or duplicated (`--fix` rewrites them)
- on Windows, the WAM broker is turned off (see below; `--fix` turns it off)

Every `--fix` run first snapshots each file it will touch. `azmp doctor --undo` reverts the latest run.

## Windows notes

- Use PowerShell 7 (`pwsh`). `azmp setup --shell pwsh` adds the integration to `$PROFILE`.
- Since Azure CLI 2.61, `az login` on Windows uses the **Web Account Manager (WAM)** broker. WAM keeps accounts in Windows, not in `AZURE_CONFIG_DIR`, so the account picker shows the accounts of every profile and it's easy to pick the wrong one. `azmp doctor --fix` sets `core.enable_broker_on_windows=false` in each profile's own `config`, which brings back the browser sign-in for that profile only.

## Common patterns

```sh
# A different tenant in the same account
azmp add contoso-gov --tenant contoso.onmicrosoft.us --device-code

# A service principal profile for testing pipelines locally
azmp add ci --yes --no-shell
azmp exec ci -- az login --service-principal -u "$APP_ID" -p "$SECRET" --tenant "$TENANT"

# Terraform / Bicep / kubectl with a specific identity
azmp exec client-a -- terraform apply
azmp exec work -- az deployment group create -g rg -f main.bicep
azmp exec work -- kubectl get pods            # with kubelogin -l azurecli

# direnv instead of the built-in auto-switch
echo 'eval "$(azure-multiprofile env client-a)"' > .envrc
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `azmp use` says it needs shell integration | `azmp setup`, then open a new terminal |
| `unknown profile … run: azmp reload` | The shell started before the profile was created. Run `azmp reload` |
| `az-<name>: command not found` | Same as above |
| Auto-switch doesn't happen in PowerShell 5.1 | Use PowerShell 7, or load the integration after any prompt theme (5.1 falls back to wrapping `prompt`) |
| Every terminal is stuck on one account | An rc file exports `AZURE_CONFIG_DIR` globally. `azmp doctor` shows the file and line |
| Wrong account offered at sign-in on Windows | `azmp doctor --fix` (WAM, see above) |

## Isolation and limitations

- Isolation is per **process environment**. Anything started from a shell inherits the active profile. GUI apps (VS Code's Azure extensions, for example) don't see it unless VS Code is started from that shell (`code .`).
- Az PowerShell (`Connect-AzAccount`) keeps its own context in `~/.Azure` and is not covered. Use `Save-AzContext` / `-Scope Process` for that.
- `az` itself is unchanged and installed only once. Its version and the CLI binary are shared. Extensions are per profile, unless you share them through `AZURE_EXTENSION_DIR`.

## Security

- The tool never reads, copies or uploads tokens. The only file it reads from a profile folder is `azureProfile.json` (account names, for `list` and `prompt`).
- It never writes to `~/.azure`.
- It makes no network calls of its own. Network traffic comes only from `az`/`azd`/`npm` when you ask for them.
- Profile folders are created with mode `0700` on macOS and Linux.

See [SECURITY.md](SECURITY.md) to report a vulnerability.

## Contributing

Issues and PRs are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). `npm test` runs the whole suite in a throwaway HOME, using real zsh/bash/fish/pwsh when they are installed.

## Credits

- The `AZURE_CONFIG_DIR` technique: [Rakhesh Sasidharan](https://rakhesh.com/azure/az-cli-and-multiple-accounts/).
- Project shape (registry, managed rc blocks, `doctor --fix/--undo`): [claude-multiprofile](https://github.com/jmdarre-v/claude-multiprofile).

## License

[MIT](LICENSE)
