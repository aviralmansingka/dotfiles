# gb300-rack-software — round 11 generation (viz-ds11-8)

Fresh generation from `docs/visualize-eval/cases/gb300-rack-software/source.md` only.
This is a rerun: round 10 failed the case on recipe and on absent direct nv-rms API paths.

Frozen inputs (used by every check and capture, absolute paths):

| input | sha256 |
|---|---|
| `/tmp/visualize-eval/round-10/bin/rataflow-view` | `db70722b92777467544b8ac0c9f03c52d48706e21f604e47da084cb0dfb92df8` |
| `docs/visualize-eval/rounds/11/SKILL.md` (proposal 10, the governing snapshot) | `fb975dbe337bee801dc098f58695e0068cb1b2d7d79f34c0e473e24a1626cd4e` |

Model: `fireworks/accounts/fireworks/routers/deepseek-flash-latest`. No judge, no subagent, no renderer/skill/rubric edit, no commit, no install, no cargo.

## Step 0 — family (named before the ledger)

```
family: placement-planes
evidence: the OOB LAN is "a SEPARATE PHYSICAL ETHERNET NETWORK ... usually air-gapped
          from the data plane" that drops to every BMC, while the in-band software
          (GPU Operator -> DCGM -> driver/Fabric Manager) has no relation to it —
          the source forbids the only edge that would join them ("never draw
          OOB -> DCGM"), so the rack is two weakly-connected worlds plus one bus.
```

Tie-breakers considered, in the skill's order: density (`E ≈ N`? no — 15 relations over 13 components, and the two halves are separate rather than one dense fabric); **bus with disconnected worlds — yes, this decides it**; identifier/qualifier content (protocols and the `x18` count matter, but they are per-edge qualifiers, not an address map, so identity-probe-map was rejected); motion (the source never animates anything, so every view is static — no dots anywhere).

Secondary recipe also applied: service-mesh habits in v3 (one core, a stable source-ordered protocol fan, engine-spread ports) and flow-chain habits in v4 (`E ≈ N`, one fact per hop).

No mid-round family change.

## Views

| view | file | direction | carries | extent | crossings | labels |
|---|---|---|---|---|---|---|
| v1 planes overview | `specs/v1-planes-a3.json` | tb | both worlds side by side, the OOB bus, both spines | 59x38 | 0 bridges, 0 bends | 7/7, 0 ambiguous |
| v2 OOB bus | `specs/v2-oob-bus-a2.json` | tb | the one bus that splits, plus rms as its client | 50x30 | 0 bridges, 0 bends | 2/2, 0 ambiguous |
| v3 rms API paths | `specs/v3-rms-api-a2.json` | lr | nv-rms's four device-class API paths + NVOS hosting NMX-C/T | 69x16 | 1 bridge | 5/5, 0 ambiguous |
| v4 in-band | `specs/v4-inband-a1.json` | tb | host-resident in-band software, exporter, driver path | 36x36 | 0 bridges, 0 bends | 5/5, 0 ambiguous |

All four views are static (source never animates). All four `--check` runs exit 0 with **zero warnings**.

### Coverage map

| view | carries |
|---|---|
| v1 | nodes + group membership + plane boundary + the bus (`e1`–`e6`) + both spines (`e11`,`e12`,`e14`,`e15`) |
| v2 | the bus alone at scale (`e2`–`e5`) plus the controller-as-client relation (`e1`) |
| v3 | the controller's API paths (`e7`–`e10`) and the NVOS-hosts-NMX residency (`e6`) |
| v4 | the in-band host chain (`e11`–`e15`) |

Every audited edge appears in at least one view; nothing is dropped for layout.

### Structural levers (each with its source fact)

- **v1** — six `group` tags (mgmt / oob / bmc / nvsw / k8s / host) = the four worlds the task asks to separate (line 228); five pinned ranks (`layers`) because a 3-branch trunk needs a rank row of its own (`probe-trunk-lr` exits 1: "no obstacle-safe route for oob -> pwr"); one trunk `oob->nvos` with branches `[bmc_c,bmc_s,pwr]` (line 284's one-split demand, with the historical `oob -> nvos` as the corridor); `label_slot` on all six labelled edges.
- **v2** — trunk plus four pinned ranks; the same bus, isolated, so the split reads at scale.
- **v3** — groups only, no pins: the engine's own fan. Port order follows the source's southbound table (compute BMCs, power shelves, NVSwitch trays). No `label_slot`: the two identical `Redfish/HTTPS` labels each need their own gap cells.
- **v4** — groups only; `label_slot` on all five edges so `DaemonSet`, `serves :9400`, `reads NVML`, `same host` stay on their hops.

## Meaning ledger and relationship audit

Full tables in `generation.json` (`ledger`, `relationship_audit`, `relationship_mapping`). Summary of the load-bearing rows:

- Direct controller API paths **are drawn** — `rms->bmc_c` and `rms->pwr` "Redfish/HTTPS", `rms->nvos` "NVUE REST/SSH", `rms->nmxc` "NMX-C gRPC" (v3). This was the round-10 failure; §Claims below cites the pixels.
- `NVOS` hosts `NMX-C/T` — `nvos->nmxc` "hosts" (v1, v3), a residency fact, not a protocol.
- Reachability vs API is kept apart: the OOB bus is unlabelled spurs inside a trunk labelled `reach`; the API calls carry protocols. No view contains an `OOB -> DCGM` edge.
- `dcgm -> drvk` is "reads NVML" (the source's own read semantics over PCIe); `drvk -> fm` is "same host" — co-residency only, because the source never states an interface between the driver and Fabric Manager. No deploys/manages dependency was invented.
- `k8s -> gpuop` is "in-band" (a plane qualifier): the source gives no protocol for that hop.
- Devices have no edges between them; `NVSwitch BMC` deliberately has no controller API edge (nv-rms reaches the NVSwitch through NVOS). Both absences are source statements, not omissions.
- All 13 components of the historical graph are present: `nv-rms`, `OOB LAN`, `Kubernetes`, `Compute BMC x18`, `NVSwitch BMC`, `Power shelf`, `GPU Operator`, `NVOS`, `DCGM`, `NMX-C/T`, `dcgm-exporter`, `Driver+CUDA`, `Fabric Mgr`.

## Deviations from the plane pattern (each with its capture)

1. **The two worlds share one middle rank row.** In v1 the in-band chain runs down cols 9-44 and the management chain down cols 46-67, but the device row (frame row 23-26) spans cols 18-67: `DCGM` (box cols 9-14) sits on the same row as `Compute BMC x18` (cols 18-34), `NVSwitch BMC` (38-51) and `Power shelf` (55-67), because the bus's three branches must share one rank. Reason: DCGM is provisioned onto those same hosts by the GPU Operator, and the engine orders ranks only by barycenter — there is no spatial-area primitive. Capture: `pinned/v1-v1-planes-a3-77x47.txt` frame 0 rows 6–40.
2. **Each plane also gets its own labelled view (v3, v4).** One frame could not hold both worlds' labels: the merged management plane (`specs/v2-mgmt-a1.json`) measured `extent=81x28`, 10 bridges, 6 touching bends and 1 skipped label at 77 columns. Capture: `recorded/v2-a1-check.stdout`.
3. **Bus and API calls never share a view.** The source's own correction separates a physical wire from a client API on the same endpoint; merging them is what measured 10 bridges above.
4. **Three junctions, not one split point.** The frozen engine hubs only trunks with ≤2 branches (`rataflow/src/router.rs`: "A trunk with up to two branches gets ONE split point … Trunks with more branches keep a tap per branch"). `--check` reports `trunks: oob-bus from oob to nvos, 3 branches, 3 junctions`. One corridor still leaves the OOB LAN — no second arrow. Known checker item, recorded, not chased.
5. **Trunk label is `reach`, not `physical reach`.** A corridor has no `label_slot` (the engine hardcodes it), so in tb each character costs a rank-gap row: the full phrase measured `extent=52x32` with 1 ambiguous label owner (`v2-oob-bus-a1`), `reach` measures `50x30` with 0 (`evidence/v2/check.txt`).
6. **v2 holds one plain edge plus the trunk** — the renderer rejects a trunk-only spec ("the spec needs at least one edge"); `rms->oob` is the honest one, and it shows the controller as a client of the wire.
7. **Rank pins are declared in v1/v2** although the skill prefers omitting them: auto ranks make the corridor loop over the whole plane (`specs/v1-planes-a1.json`, and the corridor's rectangle in that dump), and lr cannot route the 3-branch trunk at all (`probe-trunk-lr`, exit 1).

## Deliberate drops (with reasons)

- **CDU controller and PDUs** — further OOB endpoints, dropped because the standing fixed constraint requires ONE trunk splitting ONCE into compute BMC, NVSwitch BMC and power shelf; a fourth/fifth spur reproduces the "millions of arrows" the human rejected. Recorded as a coverage gap, not a simplification.
- **OOB payload list** (power on/off, fan/temp telemetry, power draw, serial console, OS re-imaging) and **OOB detail** (1/10/25G, own switch pair, own subnet) — no annotation field exists on a node or trunk, and the payload list needs ~36 columns in a box label. Held here instead of silently vanishing.
- **nv-rms's gated NGC image** — text-only caveat (the human banned gated software from the drawing); the diagram shows no NGC, so it cannot read as "free gated images".
- **Mission Control, BCM, UFM, NetQ, gated NGC images** — required exclusion (line 271).
- **Slurm** — the source itself left it out ("free, but it added no distinct edge").
- **The driver↔Fabric Manager interface** — unstated in the source; only co-residency is drawn.

## Claims and the pixels that prove them

Coordinates are 0-based `(row, col)` inside frame 0 of the named pinned dump (77x47 canvas).

| claim | proof |
|---|---|
| the rack has two weakly-connected worlds side by side | `pinned/v1-v1-planes-a3-77x47.txt`: in-band column left, management column right — `Kubernetes` box cols 31-42 and `nv-rms` box cols 46-53 (row 6), `GPU Operator` 30-43 / `OOB LAN` 47-55 (row 14), `Driver+CUDA` 32-44 / `NVOS` 48-53 (row 32), `Fabric Mgr` 31-42 / `NMX-C/T` 46-54 (row 40): the two bands are separated by cols 43-45 with nothing drawn in them |
| the bus splits once, one arrow out of the OOB LAN | `pinned/v2-v2-oob-bus-a2-77x47.txt`: `OOB LAN (18,39-45)` → single run down `(19-23,39-42)` → junction `(24,39-42)` → spurs to `Compute BMC x18 (28,14-28)`, `NVSwitch BMC (28,34-45)`, `Power shelf` via `(31,43-47)`+`▲`, corridor ends at `NVOS (36,40-43)`; `reach` at `(31,43-47)` |
| the same bus, in the overview | `pinned/v1-v1-planes-a3-77x47.txt`: junction `(20,44-51)`, `reach (22,55-59)`, branch boxes on row 24 at cols 18-34 / 38-51 / 55-67 (the bus's three branches share one rank row, which is why that row spreads across both bands) |
| nv-rms → Compute BMC is Redfish/HTTPS | `pinned/v3-v3-rms-api-a2-77x47.txt`: `nv-rms (25,10-15)`, `Redfish/HTTPS (21,18-30)`, `Compute BMC x18 (18,34-48)` |
| nv-rms → Power shelf is Redfish/HTTPS (second copy, distinct cells) | same file: the second `Redfish/HTTPS` at `(29,19-31)` feeding `Power shelf (28,36-46)` (the first copy sits at `(21,18-30)`) |
| nv-rms → NVOS is NVUE REST/SSH | same file: `NVUE REST/SSH (21,32-44)` → `NVOS (23,40-43)` |
| nv-rms → NMX-C/T is NMX-C gRPC | same file: `NMX-C gRPC (31,39-48)` → `NMX-C/T (25,59-65)` |
| NVOS hosts NMX-C/T | same file: `nvos->nmxc` labelled `hosts (22,48-52)`; also `pinned/v1-...`: `hosts` between the same two boxes |
| DCGM reads NVML in-band, no OOB edge | `pinned/v4-v4-inband-a1-77x47.txt`: `reads NVML (29,37-46)`; `pinned/v1-...`: `reads NVML (27,14-23)`; no view contains an OOB→DCGM route |
| dcgm-exporter serves :9400 | `pinned/v4-v4-inband-a1-77x47.txt`: `serves :9400 (26,41-52)`, `dcgm-exporter (31,24-36)` |
| DCGM is a DaemonSet under the GPU Operator | `pinned/v4-...`: `DaemonSet (18,41-49)`; `pinned/v1-...`: `DaemonSet` between GPU Operator and DCGM |
| driver/CUDA, DCGM, Fabric Manager are host-resident and co-resident | `pinned/v4-...`: `same host (34,49-57)` → `Fabric Mgr (39,34-43)`; v1 shows the same hop |
| every node is individually selectable, palette corner clear | `evidence/v{1..4}/v*-selected.ansi` (one selected border each) and `v*-text.txt`; in the pinned dumps the palette occupies rows 41-44, cols 3-11 and touches no box (v1: `Fabric Mgr` starts at col 31) |

Pane captures (`evidence/v*/`) were taken at the wrapper's own measured pane size, `82x51 @100%` (this tab's 168x53 pane split in half). The target is 77x47, so fit is proved by the pinned direct dumps of each FINAL spec at exactly `COLUMNS=77 LINES=47`, natural zoom, no overflow banner (`pinned/*-77x47.txt`, first line `viewport: 77x47 zoom: 1.00 natural`).

## Static proof, selection proof, colour

- Every view is static (the source never animates). Each bundle holds 5 timestamped frames; the graph area of frames 0 and 3 is byte-identical in all four views (0 differing rows over the 51-row pane) and no dot glyph appears in any frame — `evidence/v*/v*-frames.txt`.
- `--select-all` frames exist per view and differ from the plain ANSI frame by the selected border style (SGR counts +72/+36/+42/+36 over 861/538/540/525, matching one selected border per node: 12/6/5/6 nodes). `evidence/v*/v*-selected.ansi`.
- Group hues are live in the ANSI frames (6 groups declared; the engine derives one hue family per group name and draws nothing around members).

## Validator

`scripts/viz-validate.py <bundle> --require-select --require-frames --require-records --attempts attempts.json`
→ **33 PASS / 0 FAIL for each of v1, v2, v3, v4**; full outputs in `evidence/v*/validator.txt`.

## Known defects

- v3 keeps 1 bridge (the `NMX-C gRPC` route crosses the fan column). The alternative put a same-rank edge into the view and read worse; not chased inside the three-spec budget.
- The trunk reports 3 junctions (see deviation 4).
- v1's two planes share one middle rank row (see deviation 1).
- `pane_rect`/`pane_cols` are null in the manifests: `herdr pane layout` without `--pane` reports the globally focused tab, not this `--no-focus` pane. The app's own header token and the pinned dumps are the measurements.

## Blocker

- Mid-round harness defect, now fixed: `scripts/viz-evidence.sh`'s `wait_for_header` matched the plain string `rataflow-view`, which also matches the *command echo* that `herdr pane run` types, so it returned before the viewer painted, then slept 1 s and captured a bare prompt; the follow-up `send-keys q` was buffered into the tty and killed the app at startup. Under this round's load (load average ≈300 with six generators) a pane needed 5–9 s per command and the app 2–5 s to paint, so all four bundles initially held only the typed command line. Fixed with the captain's approval at 2026-11-03T00:29:50Z: a bounded poll (≤60 s, 1 s interval) for the app's own ` rataflow-view · ` header, and the same poll for the last `frame N at ...` line in the frames step; both fail loudly instead of writing an empty capture. Everything else in the script is untouched. Disclosed here for `state.json`.

## Attempts

`attempts.json` — 4 views, 9 spec attempts (v1 3/3, v2 3/3, v3 2/3, v4 1/3), plus `abandoned_shapes` for the three recorded probes. Every `--check` run is preserved by `scripts/viz-evidence.sh record` in `attempts-log.jsonl` with raw stdout/stderr under `recorded/`.
