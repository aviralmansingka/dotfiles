# nvim autoread test suite

## Purpose

This suite proves one behaviour: a Neovim buffer with no unsaved changes
loads the file from disk again when another program changes that file.
The reload must never touch a buffer with local edits, a special buffer,
or a nameless buffer.

## Overview

The code is the augroup `autoread_changed_on_disk` in
`nvim/.config/nvim/lua/config/autocmds.lua`. The option `autoread` alone
does nothing, because Neovim runs `:checktime` on few events only. The
augroup compares the file timestamp on these events: FocusGained,
TermLeave, BufEnter, CursorHold, CursorHoldI, and BufWritePost.

The suite runs `nvim --headless -u NONE` and loads the spec
`nvim/.config/nvim/tests/ci/autoread_spec.lua` with the shared harness.
Each case makes a real temporary file and fires the real event. The case
then asserts the buffer text. No case copies the reload logic, and no
case greps the source text.

The file timestamp is part of the test fixture. The case writes the
file, then sets the timestamp with `vim.uv.fs_utime` to a time in the
future. The reload therefore never needs a sleep, and it never depends
on the timestamp precision of the file system.

## What the suite covers

| Case | Check |
|---|---|
| wiring | `autoread` is on; the group handles FocusGained, BufEnter, CursorHold, CursorHoldI, TermLeave, BufWritePost, BufReadPost |
| clean buffer | an outside write reloads the buffer, keeps the cursor line, and sends one INFO message that names the file |
| unchanged file | the same mtime gives no reload and no message |
| modified buffer | local edits stay, the buffer stays modified, and no message appears |
| special buffer | a `nofile` buffer with a file name never reloads, even after a second event |
| nameless buffer | a buffer with no name is skipped |
| deleted file | the text stays, the buffer stays clean, and no error is raised |
| write elsewhere | `:write` of one buffer reloads a changed buffer in another window and keeps the current buffer |
| sibling with edits | one focus event reloads the clean buffer only |

## How to run

Run `scripts/test-nvim-autoread.sh` from the repository root. The script
finds nvim on `PATH`. It runs with neutral XDG directories, so a stowed
`~/.config/nvim` copy cannot mask a worktree regression. Each case
prints its own `PASS` line. The script exits non-zero when any case
fails. When nvim is absent, the script prints `SKIP` and exits zero; set
`STRICT=1` to make the absence a failure.

The shared `scripts/test-nvim-headless.sh` also runs this spec by glob,
because the spec lives in `nvim/.config/nvim/tests/ci/`.

## Runtime and SLA

The entry finishes in about 0.15 s on this host. The SLA is 60 s for the
entry and 30 s for the spec. Every case is deterministic: no `vim.wait`,
no sleep, and a timestamp that the fixture sets. Run the entry twice
before you merge.

## Coverage result

| Surface | Covered | Not covered |
|---|---|---|
| reload | clean buffer, mtime change, cursor position, message | window scroll position in a long file |
| guards | modified buffer, `buftype ~= ""`, empty name, deleted file | insert mode, command-line window, macro replay |
| events | FocusGained, BufEnter, CursorHold, BufWritePost | TermLeave and CursorHoldI fire through the same `check_all` path only |

## Known gaps

A headless editor has no UI loop. It does not enter insert mode, so the
insert-mode guard and the CursorHoldI trigger are not reached. It does
not open a command-line window, so the `getcmdwintype` guard is not
reached. A macro guard is not reached either: the reload path for
`reg_recording` needs a real recorded macro.

The suite cannot assert the window scroll position, because a headless
window has one line of height. It asserts the cursor line only.

`TermLeave` needs a live `:terminal` job. It shares its callback and its
`check_all` path with FocusGained, which the suite covers. A live check
stays a manual step.
