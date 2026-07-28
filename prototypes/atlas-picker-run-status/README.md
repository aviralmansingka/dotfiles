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

## Render

```bash
python3 prototypes/atlas-picker-run-status/render.py --width 30
python3 prototypes/atlas-picker-run-status/render.py --width 23
python3 prototypes/atlas-picker-run-status/render.py --width 30 --no-color
```

The data is a visual fixture constrained to fields available in the current compact Registry-v1 projection: Task identity, Run ID/revision, selected Goal ordinal/ID, recorded lifecycle kind/state, participant/role, Evidence state, and recorded update time. It does not invent parent decisions, human gates, canonical completion, or live Herdr reconciliation.

## Variants

- **A — Status card:** fastest identity/current-state scan; weakest sense of journey.
- **B — Mini journey:** strongest Pi-like visual continuity; more truncation pressure at 23 columns.
- **C — Run dashboard:** best for stable counts and provenance; chronology is reduced to one latest row.

## Verdict

The user selected **B — Mini journey**. Its connected recorded-journey rail communicates current position and surrounding work better than the status card or metric dashboard within the picker pane. Preserve its Task/Run header, explicit recorded-journey label, semantic glyphs, participant/role footer, timestamp, and `projection, not authority` boundary. Production still requires final typed Atlas hydration and a deliberate 23-column truncation policy.

The selected canonical prototype capture is `selected-mini-journey-30x12.ansi`; `selected-mini-journey-30x12.txt` is its exact SGR-stripped semantic frame.

These are disposable UI sketches, not production renderer behavior.
