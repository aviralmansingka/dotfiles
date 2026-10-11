# config-lint CI tests

## Purpose

`scripts/test-config-lint.py` guards the config files that had no test suite: it parses every
file, checks the structure of each file class, and blocks absolute user paths. It runs offline,
never changes `$HOME`, and never uses the network.

## Overview (merged PRs)

- **#30 neovide font.** The font pin moved from Lua into `neovide/config.toml`. The suite fails when
  the `[font]` section, the `size` key, or `normal.family` disappears.
- **#8/#9 portability drift.** Machine-specific absolute paths broke portability twice. The tripwire
  fails on any new `/home/<user>` or `/Users/<user>` path in a tracked config.

## What the suite covers

- **C1-C3 parse gates.** Every tracked TOML, JSON, and YAML file parses (PyYAML, then ruby, then a
  loud failure); a malformed file fails with its name.
- **C4 starship.** Module blocks are known modules; format-string `$token`s name modules.
- **C5 aerospace.** `[mode.main]` exists; every mode has a binding table; keys, commands, `mode`
  targets, startup hooks, and window-detected runs all resolve.
- **C6 tmuxinator.** Projects have a session name and a non-empty window list; window options are
  known keys; referenced scripts exist.
- **C7 k9s skin.** Anchors resolve; the `k9s` mapping exists; colors are hex, names, or skin tokens.
- **C8 neovide.** Keys stay on a vendored allow-list; the #30 font pin stays intact.
- **C9 git config.** `git config --list` parses it; `user.name`, `user.email`, and
  `credential.helper` are set; delta and credential sections keep a sane shape.
- **C10 lazygit.** Top-level keys are lazygit sections; keybinding and diff-renderer shapes hold.
- **C11 omarchy template.** Placeholders are balanced and call known functions; rendered output
  parses as Lua when `luac` exists.
- **C12 code snippets.** Lua parses via `luac -p`, Go via `gofmt`; a missing tool prints SKIP.
- **C13 blinksh theme.** All 16 colors are defined and passed to the palette; prefs keys are known.
- **C14 portability tripwire.** No tracked scope file holds an absolute user path beyond one gap.

## How to run

Run `./scripts/test-config-lint.py`. It prints one PASS, FAIL, or SKIP line per finding; every FAIL
names the file and the reason, and it exits non-zero on any FAIL. It needs `git` and Python 3.11+;
YAML needs PyYAML or ruby. Run `--selftest` to prove each check fails on a mutated mktemp sandbox
copy; it never touches the worktree.

## Runtime and SLA

Reruns give the same result. One run takes under 0.1 s, the selftest under 0.5 s; the budget is 30 s.

## Coverage result

All 22 tracked files in scope are checked:

| File | Checks |
| --- | --- |
| `aerospace/.aerospace.toml` | C1, C5, C14 |
| `blinksh/gruvbox.js` | C13, C14 |
| `code/**` snippets (10 files) | C12, C14 |
| `git/.config/git/config` | C9, C14 |
| `git/.config/git/ignore` | C14 only; patterns, no structure |
| `git/.config/lazygit/config.yml` | C10, C14 |
| `kube/.config/k9s/skins/gruvbox-dark.yaml` | C3, C7, C14 |
| `neovide/.config/neovide/config.toml` | C1, C8, C14 |
| `omarchy/.config/omarchy/themed/hyprland.lua.tpl` | C11, C14 |
| `starship/.config/starship.toml` | C1, C4, C14 |
| `tmuxinator/.tmuxinator/*.yaml` (3 files) | C3, C6, C14 |

The repo-config suite owns the herdr config class (#156-#158); this suite does not repeat it.

## Known gaps

- `neovide` sets `neovim-bin` to an absolute `/Users/aviral/...` bob path. The tripwire records
  this one path as a gap: the zsh config does not put the bob bin dir on `PATH`, so removal could
  break GUI launch, and a portable form needs a captain decision. Remove the gap entry in the
  same change that fixes the path.
- `git` sets `credential.helper = osxkeychain`. This helper exists on macOS only; Linux hosts warn
  and skip it. A per-host helper needs a captain decision.
- `git` holds `[editor] tool = nvim`. Git has no `editor.tool` setting; it does nothing. The suite
  records the shape; it does not judge the key.
- The aerospace, neovide, lazygit, and omarchy allow-lists are vendored from the current files. Add
  a new value in the same change that uses it, or the suite fails.
- `docs/ci-tests/repo-config.md` still lists starship, neovide, lazygit, k9s skins, and tmuxinator
  as unowned. This suite owns them now; update that doc when the lanes merge.
