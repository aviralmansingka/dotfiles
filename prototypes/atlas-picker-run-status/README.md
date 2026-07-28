# Atlas Picker Run Status Prototype

Three throwaway variants for the existing Sidekick agent picker's bottom-right `Atlas Preview` pane.

## Geometry

The production layout is in `nvim/.config/nvim/lua/plugins/sidekick/cwd_picker.lua`:

- the bottom row is `Workspaces | Agents | Atlas Preview`;
- it has a fixed 14-row outer allocation;
- each rounded child has `height = 12`, so Atlas receives a 12-row interior;
- the first two columns each request one third of the picker width and Atlas receives the remainder.

The deterministic Neovim harness in `scripts/verify-nvim.lua` exercises exact inner Atlas lookup dimensions:

- `100×30` host grid → `30×12` Atlas interior;
- `80×24` host grid → `23×12` Atlas interior.

The rounded border is outside those lookup dimensions. The 30-column frame is the preferred desktop reference; every variant also renders at the 23-column minimum fixture.

## Generate a summary for any recorded Run

From the repository root:

```bash
go run ./prototypes/atlas-picker-run-status \
  --run-id <run-id> \
  --width 30 \
  --color auto
```

`--state-dir <registry-root>` is optional; without it the CLI uses the normal `VAULT_HUNTER_STATE_DIR`, `XDG_STATE_HOME`, or `~/.local/state/vault-hunter` resolution. An ID absent from active Runs is looked up in the retired namespace. Use `--width 23` for the minimum picker fixture and `--color always|never` for deterministic capture.

Example against a checked-in fixture:

```bash
go run ./prototypes/atlas-picker-run-status \
  --run-id atlas-rich-run \
  --state-dir scripts/fixtures/vault-hunter-atlas \
  --width 30 \
  --color always
```

The CLI reads Registry schema v1 or v2 through `internal/vaultregistry`, derives Goal rows only from typed Goal/verifier IDs and states, sanitizes controls, and emits exactly 12 rows. It does not parse detail JSON or invent parent decisions, human gates, canonical completion, or live Herdr reconciliation.

## Render the static design comparison

```bash
python3 prototypes/atlas-picker-run-status/render.py --width 30
python3 prototypes/atlas-picker-run-status/render.py --width 23
python3 prototypes/atlas-picker-run-status/render.py --width 30 --no-color
```

## Variants

- **A — Status card:** fastest identity/current-state scan; weakest sense of journey.
- **B — Mini journey:** strongest Pi-like visual continuity; more truncation pressure at 23 columns.
- **C — Run dashboard:** best for stable counts and provenance; chronology is reduced to one latest row.

## Verdict

The user selected **B — Mini journey**. Its connected recorded-journey rail communicates current position and surrounding work better than the status card or metric dashboard within the picker pane. Preserve its Task/Run header, explicit recorded-journey label, semantic glyphs, participant/role footer, timestamp, and `projection, not authority` boundary. Production still requires final typed Atlas hydration and a deliberate 23-column truncation policy.

The selected canonical prototype capture is `selected-mini-journey-30x12.ansi`; `selected-mini-journey-30x12.txt` is its exact SGR-stripped semantic frame.

These are disposable UI sketches, not production renderer behavior.
