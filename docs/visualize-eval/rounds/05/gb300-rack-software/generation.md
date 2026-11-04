# gb300-rack-software — round 05 generation report

Generator: fresh DeepSeek worker (`fireworks/accounts/fireworks/routers/deepseek-flash-latest`), round 05, case `gb300-rack-software`.
Candidate skill `docs/visualize-eval/rounds/05/SKILL.md`, sha256 `ff4a9d3f32ba0bf86e54ee6bfbac02fdea3fac3b95b82a958b3411accef0a949` (verified with `shasum -a 256`).
Renderer `/tmp/visualize-eval/round-05/bin/rataflow-view`, sha256 `b1ab9f2e78af11c2f2b005eea083a999079d184bf550e8d0b6d9c51867f22404` (verified; absolute path used for every check, dump and capture).

Four focused views, four specs, all static — the source never animates and no spec declares `flow` or `dots`.

| view | spec | extent | check highlights |
|---|---|---|---|
| v1 off-rack mgmt on the OOB rail | `specs/v1-oob-rail.json` | 74x24 | `crossings: 0 bridges, 0 touching bends` · `labels: 2/2 placed … 0 ambiguous owners` · `trunks: oob_rail from oob to bmc_s, 2 branches, 2 junctions` |
| v2 nv-rms southbound APIs | `specs/v2-rms-apis.json` | 48x19 | `crossings: 0 bridges, 0 touching bends` · `labels: 2/2 placed … 0 ambiguous owners` |
| v3 NVSwitch tray software | `specs/v3-nvswitch-sw.json` | 34x24 | `crossings: 1 bridges, 0 touching bends` · `labels: 3/3 placed … 0 ambiguous owners` |
| v4 in-band compute software | `specs/v4-inband-compute.json` | 49x40 | `crossings: 0 bridges, 0 touching bends` · `labels: 5/5 placed … 0 ambiguous owners` |

Every view also reports `dots: 0 single-dot routes, 0 periodic routes, 0 violations …`, `origins: 0/0`, `arrivals: 0/0`, and **no warning line**.

## Full `--check` output

```
# v1
ok: nodes=5 edges=1 flows=0 direction=lr theme=gruvbox
extent=74x24 cells
crossings: 0 bridges, 0 touching bends
labels: 2/2 placed, 0 on route cells, 0 skipped, 0 ambiguous owners
groups: off-rack mgmt(1) OOB plant(1) rack hardware(3)
trunks: oob_rail from oob to bmc_s, 2 branches, 2 junctions
dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 constant at 0.5c/step, 0 same-arrival at 2000ms
origins: 0/0 routes start at their arrow origin
arrivals: 0/0 same-arrival routes show their dot at the arrowhead on the final step

# v2
ok: nodes=3 edges=2 flows=0 direction=lr theme=gruvbox
extent=48x19 cells
crossings: 0 bridges, 0 touching bends
labels: 2/2 placed, 0 on route cells, 0 skipped, 0 ambiguous owners
groups: off-rack mgmt(1) rack hardware(2)
dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 constant at 0.5c/step, 0 same-arrival at 2000ms
origins: 0/0 routes start at their arrow origin
arrivals: 0/0 same-arrival routes show their dot at the arrowhead on the final step

# v3
ok: nodes=3 edges=3 flows=0 direction=tb theme=gruvbox
extent=34x24 cells
crossings: 1 bridges, 0 touching bends
labels: 3/3 placed, 0 on route cells, 0 skipped, 0 ambiguous owners
groups: off-rack mgmt(1) NVSwitch tray(2)
dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 constant at 0.5c/step, 0 same-arrival at 2000ms
origins: 0/0 routes start at their arrow origin
arrivals: 0/0 same-arrival routes show their dot at the arrowhead on the final step

# v4
ok: nodes=6 edges=5 flows=0 direction=tb theme=gruvbox
extent=49x40 cells
crossings: 0 bridges, 0 touching bends
labels: 5/5 placed, 0 on route cells, 0 skipped, 0 ambiguous owners
groups: in-band cluster(2) compute host(4)
dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 constant at 0.5c/step, 0 same-arrival at 2000ms
origins: 0/0 routes start at their arrow origin
arrivals: 0/0 same-arrival routes show their dot at the arrowhead on the final step
```

(`viewport: unknown zoom: 1.00 natural` and the `ok:` line are the first two lines of each `evidence/<view>/check.txt`; the frozen binary emits **no** `routes:` line — expected after the round-04 revert, not a defect.)

## Validator verdict

```
$ scripts/viz-validate.py evidence/<view> --require-select --require-frames --attempts attempts.json
v1 -> all checks passed
v2 -> all checks passed
v3 -> all checks passed
v4 -> all checks passed
```

Full output: `validation/v1.txt` … `validation/v4.txt`.

## Capture geometry

- Pane captures measure **83x51 @100%** (the app's own header token, e.g. `evidence/v1/v1-text.txt` line 1). The harness splits half of the calling pane and the calling pane follows this worker's tab (170x53); `herdr pane split --ratio` clamps at 0.1–0.9, so the 158-wide calling pane a 79-wide half would need cannot exist here. Measured size recorded as-is, never relabelled.
- Target-size fit is proved per view by pinned direct dumps: `COLUMNS=77 LINES=47 $BIN --frames 3 specs/<view>.json` → `evidence/<view>/<view>-target-77x47-frames.txt`. Each dump shows `viewport: 77x47 zoom: 1.00 natural`, three timestamped frames, the whole graph and **no** overflow banner. Hashes: `evidence/target-dumps.sha256`.
- Extents at that size: v1 74x24, v2 48x19, v3 34x24, v4 49x40 — all inside 77x47.
- Palette corner: no view overwrites it (`evidence/v4/v4-text.txt` rows 45-50 hold only `┌───────┐ │ + [+] │ …`; the nearest box, Fabric Mgr, ends at row 44, column 30).
- Static proof: 5 pane frames + 3 pinned frames per view are identical drawings (`evidence/<view>/<view>-frames.txt`).
- Cleanup: every capture's manifest says `cleanup: confirmed_closed`; this tab now holds only the worker pane (170x53). Probe panes closed: `w7E:pFX`, `w7E:pG2`, `w7E:pG3`, `w7E:pG5`, `w7E:pG6`.

## Residency framing (who runs where)

Groups give each node a stable hue family; node labels carry an explicit location where a hue alone is too thin. Measured from the ANSI captures:

- v1: `nv-rms` border `#7da0b8` (row 25, col 6) — off-rack mgmt; rack hardware `#e78a4e` (row 17, col 62) and `#d27438` (row 33, col 62) — one family, three members.
- v2: `nv-rms` `#7da0b8` vs compute BMC `#e78a4e`, power shelf `#f1a46c`.
- v3: `nv-rms` `#7da0b8` vs NVOS `#d3869b`, NMX-C/T `#e29caf`; `NVOS (tray)` label at `evidence/v3/v3-text.txt` row 26.
- v4: Kubernetes `#d3869b`, GPU Operator `#e29caf` (in-band cluster) vs DCGM `#7daea3`, dcgm-exporter `#93c2b7`, Fabric Mgr `#a8d3c8` (compute host); `DCGM (host)` label at row 26.

The renderer colours groups but does not draw a named block, so a plain-text-only reader gets residency from those node labels and from the view split. That is recorded as a defect (renderer capability), not glossed over.

## Relationship audit and coverage

| id | from → to | verb / tech | label | view |
|---|---|---|---|---|
| e1 | nv-rms → OOB LAN | client on the network (no protocol asserted) | `client` | v1 |
| t1 | OOB LAN → Compute BMC | physical reach, trunk branch | `physical reach` | v1 |
| t2 | OOB LAN → NVSwitch BMC | physical reach, corridor target | `physical reach` | v1 |
| t3 | OOB LAN → Power shelf | physical reach, trunk branch | `physical reach` | v1 |
| e2 | nv-rms → Compute BMC | Redfish/HTTPS | `Redfish/HTTPS` | v2 |
| e3 | nv-rms → Power shelf | Redfish/HTTPS | `Redfish shelf` | v2 |
| e4 | nv-rms → NVOS | NVUE REST | `NVUE REST` | v3 |
| e5 | nv-rms → NMX-C/T | NMX-C gRPC | `gRPC` | v3 |
| e6 | NVOS → NMX-C/T | hosts (residency) | `hosts` | v3 |
| e7 | Kubernetes → GPU Operator | hosts | `hosts` | v4 |
| e8 | GPU Operator → DCGM | deploys as DaemonSet | `DaemonSet` | v4 |
| e9 | DCGM → dcgm-exporter | serves Prometheus on :9400 | `serves :9400` | v4 |
| e10 | DCGM → Driver+CUDA | reads GPU state via NVML, no network | `reads NVML` | v4 |
| e11 | Driver+CUDA → Fabric Mgr | unsupported in the excerpts (dashed) | `unconfirmed` | v4 |

Historical relations: all eleven mapped except `oob -> nvos` (dropped, reason below); `rms -> oob` kept as e1 and never upgraded to a protocol claim. The source's southbound table adds e2–e5; the line-283 nuance "through NVOS, not through the NVSwitch BMC" is drawn as v3's topology.

## Deliberate drops

- `oob -> nvos` — the source's OOB reach list (BMCs, power-shelf controllers, CDU, PDUs) never includes NVOS, and line 283 puts NVOS behind nv-rms over NVUE REST. A fourth arrow out of the OOB LAN is exactly what the user rejected.
- direct `nv-rms -> NVSwitch BMC` API edge — line 283 asserts a direct edge to each device class and then corrects itself in the next sentence; drawing both would contradict. Also cost 1 ambiguous label owner (attempts/v2/01, /02).
- `18 compute tray BMCs` count, CDU/PDU reach, SSH/SFTP path, front-end/scale-out fabrics, paid software (Mission Control, UFM, NetQ, BCM, NGC gated images), Slurm — reasons in `generation.json.deliberate_drops` and the meaning ledger.

## Honest defects

1. **v1 reports 2 junctions, not 1.** `trunks: oob_rail from oob to bmc_s, 2 branches, 2 junctions`. The single-split hub (`try_hub`) does not fit this arrangement and falls back to one tap per branch; the capture shows both taps adjacent (`evidence/v1/v1-text.txt` row 33 `…┬┴─▶…`), so it reads as one fork but the check counts two. The arrangements whose check would report `1 junction(s)` carry 3–14 bridges, and with `to = Power shelf` an extra shared-run warning (attempts 1 and 2). `to = Compute BMC` (1 junction, 3 bridges) was found only in offline dumps **after** the third checked candidate; the per-view budget of three checks forbade a fourth, so it is preserved as a probe (`probes/v1-alt-trunk-to-bmc_c*.{json,txt}`, table in `probes/v1-trunk-permutations.txt`) and not shipped.
2. **v3 has 1 bridge** — the long gRPC edge crosses the NVUE REST run (`evidence/v3/check.txt`; glyph visible in `evidence/v3/v3-text.txt` row 23). `lr` was probed and is no better.
3. **Group names are not drawn** — colours only (renderer capability, see blockers).
4. **v2's shelf API label is abbreviated** to `Redfish shelf` because a second identical `Redfish/HTTPS` string cost 1 ambiguous owner.

## Blockers

- No caption/title/legend field: view titles live only in this bundle.
- Groups draw as colour families, not as named bordered blocks (skill Step 7 promises blocks).
- The one-split hub is infeasible for this trunk arrangement; recorded, not hidden.

## Attempts and probes

`attempts.json` holds three checked candidates for v1 and v2 and one each for v3 and v4, every one with its raw `--check` output under `attempts/<view>/`. Offline probes (77x47 dumps, no `--check`) are under `probes/`: trunk permutations, the alternate `to = Compute BMC` arrangement, the v3 `lr` alternative, and a fan-out diagnostic.

## Commands

```sh
shasum -a 256 docs/visualize-eval/rounds/05/SKILL.md /tmp/visualize-eval/round-05/bin/rataflow-view
/tmp/visualize-eval/round-05/bin/rataflow-view --check specs/<view>.json
COLUMNS=77 LINES=47 /tmp/visualize-eval/round-05/bin/rataflow-view --frames 3 specs/<view>.json
scripts/viz-evidence.sh --spec specs/<view>.json --bin /tmp/visualize-eval/round-05/bin/rataflow-view \
    --out evidence/<view> --label <view> --frames 5
scripts/viz-validate.py evidence/<view> --require-select --require-frames --attempts attempts.json
```

No independent review was run: the captain starts the Sol judge separately. Nothing here claims approval.
