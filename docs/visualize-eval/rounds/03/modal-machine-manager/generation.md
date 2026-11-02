# Round 03 — modal-machine-manager (fresh DeepSeek generation)

Generator: fresh generator subagent, model `fireworks/accounts/fireworks/routers/deepseek-flash-latest`.
No judge was spawned from this session. This bundle does not mark itself green.

Frozen inputs used:

| item | value |
|---|---|
| candidate skill | `docs/visualize-eval/rounds/03/SKILL.md` · `cf796bcdc527897687ec2ca19844f399c921252409b9ca7ad04fbfa1b6cc659c` |
| renderer | `/tmp/visualize-eval/round-03/bin/rataflow-view` · `b242b6a28e2e27934b06b7a297be638c143e5c99680495e104380cd8d9ee80f7` |

Only `docs/visualize-eval/cases/modal-machine-manager/source.md` was read for the case.
`expected.json`, `historical-variants.json`, other cases, earlier rounds, and the globally
installed skill were not read. Nothing was built, installed, or committed.

## Views (4 of 4 used)

| view | carries | spec | extent | crossings | labels | dots | origins |
|---|---|---|---|---|---|---|---|
| v1 | request/provisioning chain: web + control plane → webapi + private gRPC → River → registry → providers | `specs/v1-attempt2.json` | 64x40 | 0 | 6/6 | 6 sync @2000ms, 0 violations | 6/6 |
| v2 | provisioning handoff, iPXE boot (both directions), heartbeat: providers → machines ⇄ boot server, machine-agent → public gRPC → Postgres | `specs/v2-attempt3.json` | 40x41 | 0 | 6/6 | 6 sync @2000ms, 0 violations | 6/6 |
| v3 | slow ops path: jobs → SSH/BMC audits, diagnostics → janitor → webapi → Slack, S3 image/diagnostic traffic | `specs/v3-attempt3.json` | 42x32 | 0 | 7/7 | 7 sync @2000ms, 0 violations | 7/7 |
| v4 | state writers + reconcile: reconcile loop → providers + Postgres, private/public gRPC and River → Postgres | `specs/v4-attempt2.json` | 69x23 | 1 | 5/5 | 5 sync @2000ms, 0 violations | 5/5 |

All four captured panes report `77x47 @100%` in the app header and the validator accepts that
as the measured size at natural zoom. Every pane closed (`confirmed_closed`).

## Exact `--check` output

```
v1  extent=64x40  crossings: 0  labels: 6/6 placed, 0 on route cells, 0 skipped
    dots: 6 single-dot routes, 0 periodic routes, 0 violations, 6 synchronized at 2000ms
    origins: 6/6 routes start at their arrow origin
v2  extent=40x41  crossings: 0  labels: 6/6 placed, 0 on route cells, 0 skipped
    dots: 6 single-dot routes, 0 periodic routes, 0 violations, 6 synchronized at 2000ms
    origins: 6/6 routes start at their arrow origin
v3  extent=42x32  crossings: 0  labels: 7/7 placed, 0 on route cells, 0 skipped
    dots: 7 single-dot routes, 0 periodic routes, 0 violations, 7 synchronized at 2000ms
    origins: 7/7 routes start at their arrow origin
v4  extent=69x23  crossings: 1  labels: 5/5 placed, 0 on route cells, 0 skipped
    dots: 5 single-dot routes, 0 periodic routes, 0 violations, 5 synchronized at 2000ms
    origins: 5/5 routes start at their arrow origin
```

Full text per view: `evidence/<view>/check.txt`. Groups, `trunks:` (empty — no real shared bus
in the source) and the `ok:` line are in the same files.

## Coverage

All 17 nodes and all 23 directed relations are drawn. `generation.json` carries the meaning
ledger (28 facts), the relationship audit (23 rows with label owners), and the mapping from each
original relation to its visible view edge.

- v1: e1–e6
- v2: e7–e12
- v3: e15–e21 (e17 included, so machines pull boot images from S3 lives here)
- v4: e13, e14, e22, e23 (+ e12 restated as the shared sink)

Nodes: web·cp·reg (v1), wapi·pgrpc·q (v1 + later views), mch·boot·agent·pub·db (v2),
ssh·jan·s3·slack (v3), rec (v4).

## Motion

Every edge is `"dots": 1, "flow": true` with the shared default `duration_ms: 2000`, because the
source's correction was "keep one dot alive per line" and every relation there is animated. No
per-edge `duration_ms` override exists, so the synchronization is the renderer's own.

## Groups

humans (web, slack) · control (cp, wapi) · api (pgrpc, pub) · jobs (q, rec, jan) ·
provision (reg, prov) · machines (mch, agent, boot, ssh) · state (db, s3).

Trunks were not used: the source states no shared bus, and faking one would invent a split.
No edge is dashed: the brief marks no individual relation unconfirmed, so historical provenance
is recorded here instead of mislabelling confirmed links as uncertain.

## Attempts and crossing decisions

`attempts.json` lists 2 / 3 / 3 / 2 saved spec attempts. The crossing work that mattered:

- v1 attempt 1 put machines + S3 in the chain and measured 64x56 — too tall for 47 rows. The split
  into v1/v2 lowered the extent to 64x40 without touching relations.
- v2 attempt 1 measured 109 wide with 1 dot violation and origins 6/7; attempt 2 (S3 moved to v3)
  was 71x40 but still 1 violation and origins 5/6, caused by the short reversed `mch ⇄ boot` pair
  in `tb`. Attempt 3 places machines and boot server in one band, so both boot routes are
  same-band runs: 40x41, 0 crossings, 0 violations, origins 6/6, both labels placed, and the
  known round-03 `tb` upward-route label bug is avoided by geometry (no label or edge deleted).
- v3 attempts 1 and 2 skipped two labels (`q→ssh`, `mch→s3`); shortening the text did not help, so
  the cause was routing space. Attempt 3 moves S3 into the bottom sink band with Slack: 42x32,
  0 crossings, 7/7 labels.
- v4 attempt 1 (72x23) and attempt 2 (69x23) both measure 1 crossing; attempt 2 was kept for the
  narrower extent. Band order and both routes were preserved; no label was dropped.

## Remaining defects (honest list)

1. **v4 has 1 crossing** — the reconcile → Postgres route bridges River → Postgres.
2. **Frame 0 is missing from the harness frames artifacts.** `viz-evidence.sh` reads
   `--source recent --lines 4000`, but the pane keeps ~1000 lines, so 21 frames of ~47 rows
   truncate the first one; captured frames are 1..20 (100–2000 ms). The `origins: N/N` check line
   is the origin proof, and frame 1 shows exactly one dot per route on the first drawn cell after
   its source port. `checks/<view>-frames-full.txt` are direct `--frames 21` dumps that do include
   frame 0, but they render at the binary's own 80x24 default (they say "graph overflows"), so
   they are supplementary only, never layout evidence.
3. **Short adjacent-band routes show no visible travel.** In v1 the four short vertical routes'
   dots vanish at frame 15 while the two long horizontal routes keep theirs until frame 20; the
   dot quantizes to one cell and the arrowhead glyph then replaces it. `--check` reports no
   violations and synchronization at 2000 ms, so this is a legibility defect, not a rule break.
   Fixing it needs larger inter-band gaps that the spec cannot request; making those routes static
   would drop required flow.
4. **`manifest.pane_cols` is null** for all views (the frozen harness's pane-rect probe returned
   nothing). `pane_rows` is 47 and the app header proves `77x47 @100%`.
5. **v1 is vertically dense** (40 of 46 usable rows). It fits and the viewer reports no overflow,
   but there is little slack.
6. **Two edge labels are abbreviated**: `audit / verify reimage` → `audit + verify`, and
   `pull boot image` → `boot image` (direction carries "pull"). Both are recorded in the ledger;
   the fuller e15 text was never re-tested after the v3 band fix because the view was already at
   its third attempt.

## Blockers

None. `flow`, `dots: 1`, `group`, and explicit `layers` all exist and were used; nothing was
invented and no required capability is missing.

## Validator

```
python3 scripts/viz-validate.py docs/visualize-eval/rounds/03/modal-machine-manager/evidence/<view> \
  --require-select --require-frames --attempts docs/visualize-eval/rounds/03/modal-machine-manager/attempts.json
```

All four bundles: `all checks passed` (28/28 checks, no failing check). Full output kept in
`validator-v1.txt` … `validator-v4.txt`.

## Files

```
docs/visualize-eval/rounds/03/modal-machine-manager/
  generation.json  generation.md  attempts.json
  specs/           10 spec attempts (final: v1-attempt2, v2-attempt3, v3-attempt3, v4-attempt2)
  evidence/v1..v4/ check.txt, *-text.txt, *-ansi.ansi, *-selected.ansi, *-frames.txt, *-frames.ansi,
                   manifest.json, bin.sha256
  checks/          supplementary direct --frames dumps
  validator-v1..v4.txt
```
