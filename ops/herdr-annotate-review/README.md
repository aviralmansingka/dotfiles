# Protected Herdr Annotate reviewer

`annotate` is upstream Annotate Lite: terminal capture, saved comments, clipboard export,
and the manager. `annotate-review` is a separate local plugin: document/reply reviews,
syntax highlighting, and mouse-hover `y` to copy an entire code block. Both keep their
existing annotation storage; changing launchers does not migrate or delete notes.

## Install / rebuild

From a dotfiles checkout:

```sh
./scripts/install-herdr-annotate
```

Requires Git, Rust/Cargo (including rustfmt and clippy), a C compiler for oniguruma,
Herdr, Bun for Annotate Lite, and `shasum`. The main `install.sh` calls this helper after
stowing Herdr's configuration. The helper itself does not rewrite live keybindings.
It fetches exactly `upstream-ref`, applies `customizations.patch`, runs formatting,
workspace tests and lint, then installs the release binary. A failed patch or build
leaves the existing installation unchanged. No dependency on `~/plannotator-tui` remains.

The local plugin and binary are copied to
`${XDG_DATA_HOME:-~/.local/share}/herdr/annotate-review/`, outside upstream's managed
plugin checkout. `build-receipt.txt` records the source revision, patch hash and binary
hash. Installation copies rather than symlinks, so deleting the source worktree is safe.
The previous local binary is retained as `plannotator-tui.previous` on rebuild.

Configuration in `herdr/.config/herdr/config.toml` binds:

- `prefix+o` → `annotate-review.open`
- `prefix+Shift+o` → `annotate-review.last`
- Terminal capture/export/manager stay on `annotate.*`.
- Ctrl-click Markdown links → the local reviewer's `open-link` action.

Close and reopen a reviewer to pick up a rebuilt binary. No Herdr server restart is needed.
After changing keybindings, use `herdr config check` and `herdr server reload-config`.

## Upstream updates

Update terminal annotation tools independently with:

```sh
herdr plugin install plannotator/herdr-annotate/lite --yes
```

That updates `annotate`, not `annotate-review`; it cannot replace the local binary or
these review keybindings. Do not reinstall the Full variant: its Markdown-link handler
would compete with the local one (the review keybindings would still remain protected).
The dotfiles installer pins Lite and will return it to that version on the next run.

To update the reviewer deliberately, change `upstream-ref`, refresh the patch against
that exact commit (including `Cargo.lock`), and rerun the installer. Patch conflicts fail
closed rather than silently dropping the customizations. Once upstream supports both
features, remove the patch and local plugin as an explicit migration.

## Checks and rollback

```sh
uv run --no-project python scripts/test-herdr-annotate-install.py
herdr plugin list --plugin annotate-review --json
```

For binary rollback, close the reviewer, copy `plannotator-tui.previous` to a temporary
file in the same directory, and rename it to `plannotator-tui`. Keep the previous binary
until you have verified the restored reviewer; `build-receipt.txt` describes the last
installed build, not a manual rollback.
