# gb300-rack-software — round 04 generation

Fresh generation, DeepSeek (`fireworks/accounts/fireworks/routers/deepseek-flash-latest`), no judge spawned.
Frozen inputs verified with `shasum -a 256`:

| input | sha256 |
|---|---|
| `docs/visualize-eval/rounds/04/SKILL.md` | `ac431c6d3035e466e29136f36d9579c551c2e070a354dc5df72999b1bb1beb3c` |
| `/tmp/visualize-eval/round-04/bin/rataflow-view` | `0da16d8d8ed46e2a25eb773fc71ecad4de9e310cd33e303a4c7fe77231ad95bc` |

Every command used the absolute binary path; nothing was rebuilt, installed or committed.

## Three views

| view | title | spec | extent | crossing | labels | routes |
|---|---|---|---|---|---|---|
| v1 | off-rack mgmt + the one OOB rail | `specs/v1-oob-rail.json` | 55×27 | 1 bridge | 2/2, 0 ambiguous | 1/1, 0 detours |
| v2 | mgmt → device API calls + NVSwitch software | `specs/v2-mgmt-api-a3.json` | 76×25 | 0 bridges | 5/5, 0 ambiguous | 5/5, 0 detours |
| v3 | in-band compute software on the hosts | `specs/v3-inband-host.json` | 64×37 | 0 bridges | 5/5, 0 ambiguous | 5/5, 0 detours |

Full `--check` lines per view are in `generation.json` → `views[].check_lines`, and raw in
`evidence/v*/check.txt`. The three things the round asked for are all there:

* `trunks: oob-rail from oob to bmc_c, 2 branches, 1 junction(s)` — one OOB corridor splitting
  once into compute BMC, NVSwitch BMC and power shelf, direction `oob → devices` as the source states.
* `0 ambiguous owners` in all three views.
* `routes: … 0 detours` in all three views; crossings are 1/0/0.

## The case in one paragraph

nv-rms is a client on the OOB LAN (v1: `rms → oob`, "Redfish client"), the OOB LAN is the physical
rail that splits once into the three device classes, and the same controller talks to those devices
and to NVOS over four labelled API paths (v2). Compute BMC, NVSwitch BMC and power shelf never talk
to each other — v1 draws no edge between them. The switch tray carries NVOS and NVOS hosts NMX-C/T
(v2). Everything in-band runs on the compute hosts and is marked `(host)`: Kubernetes hosts the GPU
Operator, the GPU Operator deploys DCGM as a DaemonSet, DCGM reads the driver over NVML, serves
`:9400` through dcgm-exporter, and the driver's link to Fabric Manager is dashed because the excerpts
never state that interface (v3). No OOB → DCGM route exists anywhere.

Residency is visible in the labels themselves: `nv-rms (mgmt)` / `nv-rms (src build)` (off-rack),
`NVOS (tray)`, `DCGM (host)`, `dcgm-exporter (host)`, `Driver+CUDA (host)`, `Fabric Mgr (host)`,
plus the `hosts operator` and `host DaemonSet` deploy hops.

## Motion

Constant mode only (0.5 cells / 100 ms); the source never asked for synchronized arrival, so no edge
sets `timing` or `duration_ms`. Dots are on the six routes that carry a real request, deploy or
scrape; v1 is static because its rail is a trunk (the renderer always draws trunk routes static) and
a single dot on the one plain hop would not read as flow. `--check` reports `origins: 4/4` (v2) and
`2/2` (v3). Capture and check disagree by one cell at frame 0 — the glyph sits one cell past the
arrow's first drawn cell. Both records are kept; see `known_defects` d4.

## Attempts (budget: 3 specs per view, every `--check` counted)

| view | attempt | spec | result |
|---|---|---|---|
| v1 | 1 | `specs/v1-oob-rail.json` | **shipped** — 55×27, 1 junction, 1 bridge |
| v1 | 2 | `specs/v1-oob-rail-a2.json` | rejected — extra spacer layer, same bridge, 55×34 |
| v1 | 3 | `specs/v1-oob-rail-a3.json` | rejected — `lr`; `no obstacle-safe route for oob -> bmc_s, oob -> pwr` |
| v2 | 1 | `specs/v2-mgmt-api.json` | rejected — `tb` fan-out, 1 ambiguous label owner |
| v2 | 2 | `specs/v2-mgmt-api-a2.json` | superseded — clean, but no licence qualifier |
| v2 | 3 | `specs/v2-mgmt-api-a3.json` | **shipped** — same layout, node relabelled `nv-rms (src build)` |
| v3 | 1 | `specs/v3-inband-host.json` | **shipped** — clean first try |

Raw `--check` output for every attempt: `checks/`.

## Evidence and validation

`scripts/viz-evidence.sh` captured each view in this session's own tab (`w7E:t40`) with a no-focus
half split, closed the pane afterwards, and every capture carries the absolute binary path and its
sha256. Measured size in all three views: the app's own header token `77x47 @100%`
(`evidence/pane-geometry-probe.txt` records the same split as a 79×49 pane rect → 77×47 interior).
The manifest's `pane_rect` is null because the capture script resolves `herdr pane layout` against
the globally focused tab; the header token is the accepted measurement.

```
scripts/viz-validate.py docs/visualize-eval/rounds/04/gb300-rack-software/evidence/v1 --require-select --attempts …/attempts.json
scripts/viz-validate.py docs/visualize-eval/rounds/04/gb300-rack-software/evidence/v2 --require-select --require-frames --attempts …/attempts.json
scripts/viz-validate.py docs/visualize-eval/rounds/04/gb300-rack-software/evidence/v3 --require-select --require-frames --attempts …/attempts.json
```

All three: `all checks passed` (32, 34, 34 PASS lines; full output in `validation/`).

Animation evidence: 21 frames at 100 ms per animated view, both from the live pane
(`v2-frames.txt`, `v3-frames.txt`) and as pinned-size direct dumps
(`v2-frames-77x47.txt`, `v3-frames-77x47.txt`) so frame 0 is preserved. Two well-spaced frames show
every dot advanced by the same number of cells (v2: cols 22 → 23 → 27 at frames 0, 2, 10; v3: 12 → 17
and 34 → 29 at frames 0 and 10).

## Honest defects

1. **v1 keeps one bridge** — the power-shelf spur crosses the corridor just above the junction
   (`evidence/v1/v1-text.txt` line 30 col 31). Two attempts could not remove it; the budget is spent.
2. **Inconsistent controller label** — `nv-rms (mgmt)` in v1, `nv-rms (src build)` in v2.
3. **v2 has one column of margin** (76 of 77) because of the wider controller label.
4. **Dot-origin discrepancy** — capture shows the glyph one cell past the arrow's first drawn cell
   while `--check` reports full origins.
5. **v1's `Redfish/HTTPS` label** sits on the trunk corridor but reads as the rail's protocol; the
   ownership is stated in the audit.
6. **Two negative facts are not drawn in words** — OOB carries no training/storage/NVLink traffic
   (only in `generation.json`), and DCGM has nothing to do with OOB (drawn structurally by absence).
7. **`power/serial` on `rms → bmc_s`** — the source names no protocol for that hop; the label states
   the documented function only.

No blockers: no required capability was missing. The one capability note is that a trunk cannot be
animated (corridor and spurs are always static), which this case did not need.

## Cleanup

5 panes created in this tab (3 evidence + 2 geometry probes), 5 confirmed closed
(`evidence/v*/manifest.json` → `confirmed_closed`, `evidence/pane-geometry-probe.txt`). No other tab
was split, read from or closed.

This sample is not marked green and has no independent approval; the Sol judge runs separately.
