# Herdr and Sidekick feature-work pattern

## Principles

- Reuse the implementation repository's existing Herdr workspace.
- Resolve all IDs from JSON responses; treat them as opaque.
- Use Git worktrees for branch isolation and Herdr tabs/panes for the review surface.
- Use interactive Codex so the pane shows the TUI. Do not launch `codex exec`.
- Name Herdr agents `codex-<slug>-<role>` or `pi-<slug>-<role>` so Sidekick can discover them.
- Set `SIDEKICK_NAMED_SESSION=<slug>-<role>` so Sidekick distinguishes the named process from the base tool.

## Worktrees

Validate that the branch names and exact paths do not already exist. Start from committed `main`:

```sh
mkdir -p "/Users/aviral/worktrees/$repo_name"

git -C "$repo_root" worktree add \
  -b "feature/$feature_slug" \
  "/Users/aviral/worktrees/$repo_name/$feature_slug" \
  main

git -C "$repo_root" worktree add \
  -b "task/$feature_slug-code" \
  "/Users/aviral/worktrees/$repo_name/$feature_slug-code" \
  "feature/$feature_slug"

git -C "$repo_root" worktree add \
  -b "task/$feature_slug-verify" \
  "/Users/aviral/worktrees/$repo_name/$feature_slug-verify" \
  "feature/$feature_slug"
```

Do not copy dirty files from the primary checkout into these worktrees.

## Resolve the workspace

Never hardcode a workspace such as `w15`:

```sh
workspace_id="$(
  herdr worktree list --cwd "$repo_root" --json |
    jq -r '.result.source.source_workspace_id // empty'
)"
```

If no source workspace exists, create one with `herdr workspace create --cwd "$repo_root" --label "$repo_name"
--no-focus`, then parse `.result.workspace.workspace_id`.

## Create one tab with interactive agents

Create the tab and retain both opaque IDs:

```sh
tab_json="$(
  herdr tab create \
    --workspace "$workspace_id" \
    --cwd "$integration_path" \
    --label "Feature · $human_task_name" \
    --no-focus
)"
tab_id="$(jq -r '.result.tab.tab_id' <<<"$tab_json")"
root_pane_id="$(jq -r '.result.root_pane.pane_id' <<<"$tab_json")"
```

Start the first interactive agent with its complete bounded prompt:

```sh
herdr agent start "codex-$feature_slug-code" \
  --cwd "$code_path" \
  --workspace "$workspace_id" \
  --tab "$tab_id" \
  --env "SIDEKICK_NAMED_SESSION=$feature_slug-code" \
  --no-focus \
  -- codex "$code_prompt"
```

Close the temporary root pane only after the first agent starts:

```sh
herdr pane close "$root_pane_id"
```

Start the verifier on the right, then focus the completed tab:

```sh
herdr agent start "codex-$feature_slug-verify" \
  --cwd "$verify_path" \
  --workspace "$workspace_id" \
  --tab "$tab_id" \
  --split right \
  --env "SIDEKICK_NAMED_SESSION=$feature_slug-verify" \
  --no-focus \
  -- codex "$verify_prompt"

herdr tab focus "$tab_id"
```

For a one-agent feature, omit the verifier worktree and second pane.

## Resume or steer an interactive session

Resume the same readable TUI, not a headless process:

```sh
herdr agent start "codex-$feature_slug-code" \
  --cwd "$code_path" \
  --workspace "$workspace_id" \
  --tab "$tab_id" \
  --env "SIDEKICK_NAMED_SESSION=$feature_slug-code" \
  --no-focus \
  -- codex resume "$codex_session_id"
```

`herdr agent send` and `herdr pane send-text` write literal text without submitting it. Submit an interactive Codex
prompt with the pane's `return` key:

```sh
herdr pane send-text "$pane_id" "$followup_prompt"
herdr pane send-keys "$pane_id" return
```

Use `return`; do not assume the display label `Enter` submits correctly.

## Inspect before integrating

```sh
herdr agent get "codex-$feature_slug-code"
herdr agent read "codex-$feature_slug-code" --source visible --lines 80 --format text
herdr pane process-info --pane "$pane_id"
git -C "$code_path" status --short --branch
git -C "$code_path" show --stat --oneline HEAD
```

Wait for each agent to reach `done`. Confirm its cwd, changed paths, commit, and checks rather than trusting the status
label alone.

## Neovim and Sidekick

- `<leader>al`: cwd-scoped named sessions.
- `<leader>aL`: all named sessions.
- `<C-.>`: reopen the last picker-selected named session; falls back to the cwd picker.
- Sidekick derives the named tool from the Herdr agent prefix and uses `SIDEKICK_NAMED_SESSION` to match its process.
- Keep only one Sidekick tool terminal visible. Existing picker/toggle behavior hides the others.
- `done` means completed but unseen. Focusing its terminal transitions it to `idle`.
- `blocked` remains actionable and must not be cleared merely by viewing another session.

## Cleanup

Once every worker is complete and its evidence is captured, terminate all
launched sessions before integration by closing the exact feature tab:

```sh
herdr tab close "$tab_id"
```

Verify the captured feature-agent names are absent from `herdr agent list`.
Keep their branches and worktrees until the landed result passes from primary
`main`. Then:

```sh
git -C "$repo_root" worktree remove "$code_path"
git -C "$repo_root" worktree remove "$verify_path"
git -C "$repo_root" worktree remove "$integration_path"
git -C "$repo_root" branch -d \
  "task/$feature_slug-code" \
  "task/$feature_slug-verify"
```

Never use `--force` to remove a dirty worktree.

Cherry-picked task commits are patch-equivalent but not ancestors, so `branch -d` can refuse. Before deleting those
exact ephemeral refs, require:

```sh
git -C "$repo_root" cherry main "task/$feature_slug-code"
git -C "$repo_root" cherry main "task/$feature_slug-verify"
```

Every line must begin `-`. If any begins `+`, unique work remains; do not delete the branch.
