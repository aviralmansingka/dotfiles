# Pi-Style Atlas Picker Timeline Prototype

One throwaway, read-only interactive prototype for the Sidekick agent picker's bottom-right `Atlas Preview` pane. The
user selected the mini-journey direction; the older status-card and dashboard variants were removed.

## Run it

From the Scout worktree root:

```bash
go run ./prototypes/atlas-picker-run-status t02
```

The positional argument accepts one exact Run ID or one case-insensitive active Task ID. `t02` resolves to the active
`vault-hunter-atlas-t02` Run. Ambiguous Task IDs fail and list their matching Run IDs instead of choosing heuristically.

Controls:

- `j` / Down — select the next crew stage;
- `k` / Up — select the previous crew stage;
- `g` / `G` — select the first / final crew stage;
- `q`, Escape, or Ctrl-C — quit.

The selected stage changes to bright Gruvbox yellow foreground. The standalone TUI draws the 30×12 Atlas interior inside
its rounded `Atlas Preview` border. Use `--width 23` to exercise the minimum picker fixture.

## Static capture and stage selection

```bash
go run ./prototypes/atlas-picker-run-status --snapshot --color always t02
go run ./prototypes/atlas-picker-run-status --list-goals t02
go run ./prototypes/atlas-picker-run-status --goal Convergence t02
```

`--state-dir <registry-root>` is optional; without it the CLI uses normal `VAULT_HUNTER_STATE_DIR`, `XDG_STATE_HOME`, or
`~/.local/state/vault-hunter` resolution. Exact Run IDs fall back to the retired namespace when absent from active Runs.

## Neovim integration prototype

Build the worktree Atlas binary and launch Neovim with the guarded replacement-pane experiment:

```bash
go build -o /tmp/atlas ./cmd/atlas
PATH=/tmp:$PATH \
  XDG_CONFIG_HOME="$PWD/nvim/.config" \
  SIDEKICK_ATLAS_WORKSPACE_PROTOTYPE=1 \
  nvim
```

With the flag set, hovering any heading or nested agent row in a registered Task Workspace replaces the existing Agents
pane buffer with the fixed-size crew journey. An unregistered workspace shows its Herdr tabs. Switching to the Agents
selector restores the same Agents window and buffer. The flag is intentionally absent from normal configuration, which
retains T10's shipped three-pane behavior while this Scout prototype is reviewed.

## Picker geometry

Production `nvim/.config/nvim/lua/plugins/sidekick/cwd_picker.lua` allocates a 14-row bordered bottom section and a
12-row Atlas interior. The deterministic Neovim harness exercises:

- `100×30` host grid → `30×12` Atlas interior;
- `80×24` host grid → `23×12` Atlas interior.

## Current composition

- A two-to-four-line header shows the Feature name, compact Task ID/title, and a derived `recorded done`,
  `recorded accepted`, `recorded in progress`, `recorded pending`, or `recorded needs attention` status.
- The status is explicitly labelled `recorded` because Registry observations do not make Atlas canonical Task authority.
- Five crew-stage rows use T14's current `Parent → Verifier → Convergence → Delivery → Parent closure` order. The
  selected stage changes to bright yellow foreground; navigation keeps it visible without adding a separate detail row.
- Stage state is projected from typed Run stage/state, registered participant and worker roles, and verifier attempts.
  The prototype does not parse lifecycle prose or treat workspace labels as identity.
- One compact ghost metric row continues the muted `│` rail into every `├─` branch and the closing `└─`. This disposable
  iteration always shows `3 G · 5 S · 2 V`, regardless of Registry counts, where G, S, and V stand for Goals, Steps, and
  Verifiers. The milestone mark derives only from typed Registry state: a green `●` means complete, an orange `●` means
  in progress with no completed milestone, adjacent green/orange `◐◑` glyphs mean completed and incomplete verifier
  evidence coexist, and a red `×` means failure. Verifier Evidence and the latest observation for each verifier attempt
  take precedence; typed Goal states are used only when no verifier record exists.
- The redundant `RECORDED JOURNEY` label and viewport-dangling connector remain removed.
- Current time and `projection, not authority` no longer consume rows.
- `N total · selected X/Y` remains on the final row.

## Pi Activity fidelity

The prototype follows the current Pi work-step renderer rather than the earlier generic Atlas sketch:

- muted `│`, `├─`, and `└─` connected rails;
- `◉` active, `●` successful, `×` failed, and neutral `○`/`?` fallback states;
- bold normal step titles and a distinct selected foreground;
- muted `3 G · 5 S · 2 V` metrics followed by a semantic green/orange/split/red milestone mark;
- Gruvbox Material rail `#504945`, muted `#928374`, text `#ebdbb2`, selected yellow `#fabd2f`, active/accent `#f28534`,
  success `#b8bb26`, failure `#f2594b`, and feature heading `#83a597`.

The stage glyph and selected ordinal remain readable without color; color provides the stronger interactive highlight
requested during review.

## Data boundary

The CLI reads Registry schema v1 or v2 through `internal/vaultregistry`. Crew stages come only from typed Run
stage/state, participant roles, worker roles, Evidence, and verifier-attempt observations. It sanitizes controls and does
not parse detail JSON, derive identity from workspace labels, or become canonical completion authority.

The selected canonical captures are `selected-mini-journey-30x12.ansi` and `selected-mini-journey-23x12.ansi`; each has
an exact SGR-stripped `.txt` frame and highlights `Convergence`, the third of five crew stages.

This remains disposable prototype code, not production Atlas behavior.
