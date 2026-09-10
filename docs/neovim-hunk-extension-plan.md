# Neovim / Hunk: extension-first replacement

Status: source-adapter proof implemented under
`hunk/.config/hunk/extensions/nvim-review/`; live Neovim/question integration is
not implemented or activated. Supersedes the earlier
headless-host → attached-viewer → dotfiles merge plan.

The old prototype is preserved in local checkpoint commits: dotfiles `c1d5250`
on `feat/hunk-nvim-integration`, and Hunk `d6d1815` on `feat/neovim-annotations`.
The replacement branches start at the original baselines; Hunk core is unchanged.

## Approved simplification

Use one normal Hunk TUI as the review owner. Neovim remains the primary question,
answer, sign, and hover UI. Opening the integration opens or reuses that Hunk
review; closing Hunk ends its annotation session. Existing live sessions stay
untouched until a separately approved cutover.

## What we maintain

- A custom Hunk extension under `hunk/.config/hunk/extensions/nvim-review/`.
  Use only public `hunkdiff/extension` APIs, never private Hunk imports.
- The existing Neovim Sidekick integration: prompts, exact buffer capture,
  adjacent-agent selection, signs, hover, and conservative delivery state.
- One local bridge between them. Prefer Neovim's existing RPC endpoint and an
  established client over another daemon, HTTP API, or custom wire protocol.
  Restrict endpoint access; retain message limits and input validation.
- Stock Hunk owns the ReviewStore, reconciliation, drafts, thread rendering,
  navigation, terminal lifecycle, and broker registration.

The source-only proof currently accepts a snapshot JSON file; this is not the
live bridge. It requires API 25 and `diff --vcs`, verified on upstream source
`0a2d52f`. Installed Hunk 0.21.1 (API 16) lacks that CLI option and is not supported.

The custom VCS adapter is selected explicitly; it must not take over ordinary
Git reviews. `load()` captures one immutable source snapshot, builds context-only
patches, closes `readFileSource` over the same text, and supplies `sourceCacheKey`.
No disk fallback, fake added-line diffs, or second authoritative note collection.

## Small upstream prerequisite—not an extension-only promise

The checked public extension API is version 25. Its event review controls expose
reload, not snapshots or note creation. Command snapshots already exist.

Propose one small upstream change:

1. Make the existing immutable `snapshot()` available to lifecycle handlers.
2. Add narrow atomic user-note creation to those generation-scoped controls:
   a stable file key plus line/inclusive range, or a parent note ID, and body.
   Return the assigned note ID and publication position; preserve any TUI draft.
   Reuse the shared note intent, not a second reducer or generic public dispatcher.
3. Retain the shared reconciliation fix: changed source makes notes stale;
   removed source orphans roots and replies; reappearance does not revive them.

Old controls expire on reload. The new `changeset_loaded` context supplies the
committed snapshot. The extension acknowledges source updates only at that point,
not when reload starts. Serialize source replacement and question creation so a
later edit cannot silently replace the source captured with the question.

Agent answers keep using existing `hunk session comment add --reply-to`.
`note_changed` pushes saved changes to Neovim; a fresh snapshot repairs reconnects
and reloads. CLI comment summaries are not a substitute for complete snapshots:
they omit reconciliation status and may omit orphaned notes.

Resolve the exact Hunk session by its reported process PID, not by repository
alone. Save and acknowledge the question before prompting an agent. Preserve
questions after cancellation/rejection, block ambiguous retries, and accept
answers only through the saved parent ID. Never infer answers from agent status.

## Delete rather than relocate

The replacement branches no longer contain the old 1,640-line editor/attachment
implementation stack. The checkpoints retain it for rollback; only small
source-building pieces are reused in the adapter. Keep these out of the new design:

- `app/editor/*` and the dedicated editor CLI/startup/producer wiring.
- `app/attach/*`, `ui/runAttachedReview*`, and the signed attachment polling loop.
- Generic `session action` CLI exposure and its feature-only protocol/auth changes.
- Viewer-only shared-helper refactors, routing, generated docs, and tests.
- Separate viewer/editor installation wrappers and private daemon setup, but only
  after their existing sessions end and replacement activation is approved.

Keep ordinary session commands, the stock producer/broker, and the Codex inline
edit workflow. Do not move private implementation files into an extension and
call that fork-free.

## Short execution plan

1. Validate and publish the source-adapter proof separately. The user authorized
   the no-mistakes push/PR workflow for that limited scope; no live cutover or
   installed-binary replacement is authorized. Prove the bridge separately next.
2. Implement only the proposed upstream controls needed to prove an unsaved range
   question, concurrent draft preservation, and a correlated agent reply.
3. Carry forward safety assertions into the replacement E2E: exact CRLF/empty
   buffers, unchanged disk, stale/orphan reconciliation, missing agent, ambiguous
   delivery, reconnect, and Hunk-close cleanup. Add focused core conformance tests.
4. Once the replacement passes, prune superseded code and documentation. Target
   one small upstream change plus the personal extension/Neovim integration—not
   three feature PRs maintaining another host and renderer.
5. Pin a released Hunk version containing the required public hooks. If upstream
   does not accept them, pause and revisit the requirement rather than quietly
   retaining a permanent fork.
