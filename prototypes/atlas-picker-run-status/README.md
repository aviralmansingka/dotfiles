# Pi-Style Atlas Picker Timeline Prototype

One throwaway, read-only interactive prototype for the Sidekick agent picker's bottom-right `Atlas Preview` pane. The user selected the mini-journey direction; the older status-card and dashboard variants were removed.

## Run it

From the Scout worktree root:

```bash
go run ./prototypes/atlas-picker-run-status t02
```

The positional argument accepts one exact Run ID or one case-insensitive active Task ID. `t02` resolves to the active `vault-hunter-atlas-t02` Run. Ambiguous Task IDs fail and list their matching Run IDs instead of choosing heuristically.

Controls:

- `j` / Down — select the next recorded Goal;
- `k` / Up — select the previous recorded Goal;
- `g` / `G` — select the first / final Goal;
- `q`, Escape, or Ctrl-C — quit.

The selected Goal changes to bright Gruvbox yellow foreground. The standalone TUI draws the 30×12 Atlas interior inside its rounded `Atlas Preview` border. Use `--width 23` to exercise the minimum picker fixture.

## Static capture and Goal selection

```bash
go run ./prototypes/atlas-picker-run-status --snapshot --color always t02
go run ./prototypes/atlas-picker-run-status --list-goals t02
go run ./prototypes/atlas-picker-run-status --goal T02.V01 t02
```

`--state-dir <registry-root>` is optional; without it the CLI uses normal `VAULT_HUNTER_STATE_DIR`, `XDG_STATE_HOME`, or `~/.local/state/vault-hunter` resolution. Exact Run IDs fall back to the retired namespace when absent from active Runs.

## Picker geometry

Production `nvim/.config/nvim/lua/plugins/sidekick/cwd_picker.lua` allocates a 14-row bordered bottom section and a 12-row Atlas interior. The deterministic Neovim harness exercises:

- `100×30` host grid → `30×12` Atlas interior;
- `80×24` host grid → `23×12` Atlas interior.

## Current composition

- A two-to-four-line header shows the Feature name, compact Task ID/title, and a derived `recorded done`, `recorded accepted`, `recorded in progress`, `recorded pending`, or `recorded needs attention` status.
- The status is explicitly labelled `recorded` because Registry observations do not make Atlas canonical Task authority.
- Five real Goal rows use the normal terminal background. The selected Goal changes to bright yellow foreground; navigation keeps it visible without adding a separate selected-detail row.
- One compact ghost metric row continues the muted `│` rail into every `├─` branch and the closing `└─`. Its `G# · S# · V#` values report total Goals, up to five visible steps, and typed unique verifiers. The milestone mark is green when complete, orange when no evidence has completed yet, split green/orange when completed and incomplete evidence coexist, and red on any failure.
- The redundant `RECORDED JOURNEY` label and viewport-dangling connector remain removed.
- Current time and `projection, not authority` no longer consume rows.
- `N total · selected X/Y` remains on the final row.

## Pi Activity fidelity

The prototype follows the current Pi work-step renderer rather than the earlier generic Atlas sketch:

- muted `│`, `├─`, and `└─` connected rails;
- `◉` active, `●` successful, `×` failed, and neutral `○`/`?` fallback states;
- bold normal step titles and a distinct selected foreground;
- muted `G# · S# · V#` metrics followed by a semantic green/orange/split/red milestone mark;
- Gruvbox Material rail `#504945`, muted `#928374`, text `#ebdbb2`, selected yellow `#fabd2f`, active/accent `#f28534`, success `#b8bb26`, failure `#f2594b`, and feature heading `#83a597`.

The Goal state glyph and selected ordinal remain readable without color; color provides the stronger interactive highlight requested during review.

## Data boundary

The CLI reads Registry schema v1 or v2 through `internal/vaultregistry`. Goal rows come only from typed lifecycle `goal_id`, Evidence `verifier_id`, participant `goal_id`, or schema-v2 observation `goal_id` fields. It sanitizes controls and does not parse detail JSON or infer parent decisions, human gates, canonical completion, or live Herdr state.

The selected canonical captures are `selected-mini-journey-30x12.ansi` and `selected-mini-journey-23x12.ansi`; each has an exact SGR-stripped `.txt` frame and records T02 Goal 7 as the highlighted third row of five.

This remains disposable prototype code, not production Atlas behavior.
