# terminal — CI checks

## Purpose

This page documents the terminal test scripts. They check the tmux config,
the Ghostty config, and the xterm-ghostty terminfo file. The scripts run
offline and never contact the live tmux or herdr server.

## Overview (merged PRs)

- #21 (tmux hygiene): the config keeps the 256-color default terminal,
  a 10 ms escape time, and the RGB plus OSC52 overrides. The `unbind C-b`
  tripwire stays present. zsh keeps TERM at xterm-256color.
- #11 (terminfo install): `install.sh` compiles
  `terminfo/xterm-ghostty.terminfo` with `tic`; the suite proves that file
  compiles clean (the byte-identical root duplicate was removed with the
  dead-code cleanup).

## What the suite covers

`scripts/test-tmux.sh` checks `tmux/.tmux.conf`:

- Headless boot: `new-session -d` and `start-server` parse the config
  with no error output. This catches unknown commands and options.
- Parsed values (a real `show-options` parse, not a grep): default-terminal
  tmux-256color, escape-time 10, update-environment with SSH_AUTH_SOCK and
  TERM, RGB overrides for both outer TERMs, clipboard feature for every
  xterm-family client TERM (Ghostty, Blink, plain ssh), set-clipboard on.
- Key tables: C-a runs send-prefix. C-b stays unbound. The copy-mode-vi
  keys v and y keep their actions.
- Cross-terminal checks: the tmux overrides name the TERM the terminfo
  defines, the Ghostty config sets no other TERM, zsh never exports
  xterm-ghostty, and the shipped terminfo defines the xterm-ghostty name.

`scripts/test-ghostty.sh` checks `ghostty/.config/ghostty/config` and
`terminfo/xterm-ghostty.terminfo`:

- Config shape: every line is a key = value pair. No key repeats. The
  palette holds the indices 0 to 15. The font and color keys hold
  well-formed values. Keys and keybind actions come from allow-lists.
  clipboard-read and clipboard-write stay set to allow, so OSC52 stays
  alive on the Ghostty side.
- Terminfo: `tic` compiles the file into a mktemp directory. `infocmp -x`
  dumps it, a second `tic` compiles the dump, and a second `infocmp` agrees
  with the first dump. The entry keeps 256 colors, 80x24 cells, 256-color
  SGR set colors, rgb init, mouse keys, and the kf1 to kf63 family.

## How to run

    ./scripts/test-tmux.sh
    ./scripts/test-ghostty.sh

Set `SANDBOX=1` to add the negative self-test: it mutates copies in mktemp
directories, and each mutation must make its check fail. Set `STRICT=1` for
CI: a missing tmux, tic, or infocmp binary then fails the run. Without
STRICT the scripts print SKIP with a message. The tmux script uses private
sockets and a fake HOME in mktemp, with a stub tpm tree and full cleanup.

## Runtime and SLA

Each entry finishes in under 0.5 s on this host. The SLA is 30 s. The
scripts use no network, no sleeps, and no `$HOME` writes.

## Coverage result

Every tracked file under `tmux/` and `ghostty/` has at least one check. An
inventory check fails when a new tracked file lacks one. The root terminfo
covers compile, round-trip, key capabilities, name coherence, and drift.

## Known gaps

- The ghostty binary is absent on this Linux host. The checks test the
  file shape, not the meaning of every key and action. Full validation
  needs the ghostty binary and stays host-only.
- The key and action allow-lists come from the current files. A new key
  needs a list update, or the check fails.
- zsh exports TERM with no `$TMUX` guard. The value is the safe
  xterm-256color, so the suite passes. A guard would keep the pane TERM at
  tmux-256color. The zsh owner should decide.
