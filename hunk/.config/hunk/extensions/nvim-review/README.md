# Neovim review source proof

This dependency-free Hunk extension proves that unmodified upstream Hunk can
review exact Neovim buffer text through the public VCS adapter API.

Requires extension API **25** and `diff --vcs`. Verified against upstream commit
`0a2d52f` (`0.22.0-beta.1` source). Installed Hunk `0.21.1` exposes API 16 and
lacks `--vcs`; lowering the manifest version does not make it compatible. No fork
or installed-binary replacement is part of this proof.

```sh
hunk --extension ~/.config/hunk/extensions/nvim-review nvim-review /tmp/nvim-review-snapshot.json
```

From this dotfiles checkout, replace the extension path above with
`./hunk/.config/hunk/extensions/nvim-review`. Use a private snapshot file (mode
`0600` in a mode `0700` directory on POSIX); it contains unsaved source, not
saved questions.

The snapshot is source-only JSON:

```json
{
  "files": [{ "path": "src/example.ts", "text": "const unsaved = true;\n" }]
}
```

The command captures the snapshot path and delegates once to stock
`diff --vcs nvim-review`. The adapter reads one immutable version per load,
returns full-context patches containing no additions or deletions, and serves
both sides from the same captured text. It never reads or writes the buffer
paths. Press Hunk's normal reload key after atomically replacing the snapshot
file.

Limits are 4 MiB for the snapshot JSON and aggregate source, 1,000,000 UTF-8
bytes per buffer, 100,000 logical lines total, 512 files, and 4,096 UTF-8 bytes
per relative path. Absolute paths, traversal, controls, normalized duplicates,
non-files, invalid UTF-8, and unknown JSON fields are rejected.

Run the dependency-free checks with
`bun test ./hunk/.config/hunk/extensions/nvim-review/index.test.ts` from the
dotfiles root. A real PTY smoke against the upstream source also verified unsaved
text, quoted CRLF paths, empty buffers, zero-change stats, reload, and unchanged
files on disk.

This is only the source-adapter proof. It has no Neovim RPC or UI, no automatic
watch, and no question store. The
[extension-first plan](../../../../../docs/neovim-hunk-extension-plan.md) owns
the future integration constraints and upstream prerequisites.
