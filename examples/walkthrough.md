# Walkthrough

A full session: one personal account in the default `~/.azure`, plus a work
account and a customer tenant. Output is shortened.

## 1. Install and create the first profile

```console
$ npm install -g azure-multiprofile
$ azmp add
? Profile name — what you will type in commands (e.g. work, contoso): work
? Folder for this profile's az data (press Enter to use the default): ~/.azure-work
? Also isolate the Azure Developer CLI (azd) login? Yes
? Copy your az settings from ~/.azure? (settings only — never sign-ins or tokens) Yes
? Install your 2 az extension(s) in the new profile (aks-preview, containerapp)? No
? Add azmp shell integration to ~/.zshrc? (enables `azmp use`, az-work, auto-switch) Yes
? Sign in to "work" now? Yes
? How do you want to sign in? Browser
? Tenant ID or domain (optional):
✓ Created profile work → ~/.azure-work
✓ azd folder → ~/.azd-work
✓ Copied config from ~/.azure
✓ Shell integration added to ~/.zshrc
(browser opens, sign in as jose@contoso.com)
```

## 2. A second profile, without the wizard

```console
$ azmp add fabrikam --tenant fabrikam.onmicrosoft.com --device-code --yes
✓ Created profile fabrikam → ~/.azure-fabrikam
To sign in, use a web browser to open the page https://microsoft.com/devicelogin ...
```

## 3. See everything

```console
$ exec zsh            # load the integration
$ azmp list
   PROFILE   SIGNED IN AS        SUBSCRIPTION    AZURE_CONFIG_DIR   AZD_CONFIG_DIR
   default   me@outlook.com      Pay-As-You-Go   ~/.azure           shared
   fabrikam  jose@fabrikam.com   Fabrikam-Dev    ~/.azure-fabrikam  shared
   work      jose@contoso.com    Contoso-Prod    ~/.azure-work      ~/.azd-work
```

## 4. Use them side by side

```console
$ az account show --query user.name -o tsv          # default
me@outlook.com
$ az-work account show --query user.name -o tsv     # one-off
jose@contoso.com
$ azmp use fabrikam                                 # this terminal only
$ az account show --query user.name -o tsv
jose@fabrikam.com
```

In a second terminal, `az` is still on `default`. Nothing is shared.

## 5. Pin a repository to a profile

```console
$ cd ~/src/fabrikam-api
$ azmp link fabrikam
✓ Linked ~/src/fabrikam-api to profile "fabrikam".
$ cd ~ && echo $AZMP_PROFILE
                                   # back to whatever you had before
$ cd ~/src/fabrikam-api/infra && echo $AZMP_PROFILE
fabrikam
$ terraform plan                   # azurerm uses jose@fabrikam.com
```

## 6. Scripts and CI

```console
$ azmp exec work -- az deployment group create -g rg-app -f main.bicep
$ eval "$(azmp env work)"          # POSIX shells
$ azmp env work -f dotenv > .env.azure
```

## 7. When something looks wrong

```console
$ azmp doctor
Tools
  ✓ az 2.90.0 at /opt/homebrew/bin/az
  ✓ azd 1.37.1 at /opt/homebrew/bin/azd
Registry
  ✓ Registry ~/.config/azure-multiprofile/profiles.json
Profiles
  ! work: ~/.azure-work is readable by other users (mode 755); it holds sign-in tokens  [fixable: chmod 700 ~/.azure-work]
Shells
  ! ~/.zshrc:12 sets AZURE_CONFIG_DIR for every shell; remove it and use profiles instead
  ✓ zsh integration in ~/.zshrc

1 issue(s) can be fixed automatically: azmp doctor --fix
$ azmp doctor --fix
...
  Snapshot 2026-10-26T17-40-12-000Z saved; `azmp doctor --undo` reverts this run.
```

## 8. Clean up

```console
$ azmp remove fabrikam --delete-data
? Remove profile "fabrikam"? Yes
? Delete ~/.azure-fabrikam (sign-in tokens and settings)? Yes
$ azmp setup --uninstall            # removes the ~/.zshrc block
```
