# gb300-rack-software — round 02 generation (worker `viz-ds02-gb300-rack-software`)

Generator: pi worker, model `fireworks/accounts/fireworks/routers/deepseek-flash-latest` (fresh generation, no reviewer spawned).
Candidate skill `docs/visualize-eval/rounds/02/SKILL.md` sha256 `7d1ff098…b75d70`.
Renderer `/tmp/visualize-eval/round-02/bin/rataflow-view` sha256 `ee085c0f…640e8ea` (absolute path in every command; the same digest is in each `evidence/*/bin.sha256`).
Target viewport 77×47 at natural 100% zoom — reached exactly, no pan, no zoom-out.

## Views

| view | carries | spec | extent | labels | pane |
|---|---|---|---|---|---|
| v1 | off-rack management (mgmt) + OOB hardware control (oob) + NVSwitch software (nvsw), one rms over the rail, the two paths into an NVSwitch tray | `v1.json` | **77×24** | 7/7, 0 on route, 0 skipped | `w7E:p7A`, 77×47, `confirmed_closed` |
| v2 | in-band compute software (inband): k8s → GPU Operator → DCGM → {dcgm-exporter, Driver+CUDA ⇢ Fabric Mgr} | `v2.json` | **33×37** | 5/5, 0 on route, 0 skipped | `w7E:p7D`, 77×47, `confirmed_closed` |

Both views: `direction: tb`, explicit `layers`, `group` on every node, `dots: 1` + `flow: true` on every edge (one live dot per route), trunk on v1, dashed on v2 (`Driver+CUDA ⇢ Fabric Mgr`).
`--check` on both: no warnings, `labels: n/n placed, 0 on route cells, 0 skipped`, `dots: … 0 violations`, `trunks: oob_lan from oob to pwr, 2 branches` (v1).

Validator: `scripts/viz-validate.py evidence/v1|v2 --require-select --require-frames --attempts attempts.json` → **24/24 PASS, "all checks passed"** for each view (`evidence/*/validator.txt`). No failing check to report.

## Why two views (coverage)

The case has 13 required nodes. `--check` rejects that as "above the readable budget (12/16)" and the single-frame attempt measured 154×40, so one honest four-plane frame is impossible. Split with explicit coverage: v1 owns e1–e6 + trunk t1 (and its two spurs), v2 owns e7–e11. Nothing is drawn twice; nothing audited is unowned.

The `oob → nvos` historical edge is dropped on purpose: no excerpt supports it, line 283 says NVOS hangs off **rms** and the NVSwitch BMC is the OOB endpoint for power/serial only, and the fixed constraint requires the trunk to split into exactly compute BMC, NVSwitch BMC, power shelf.

## The distinction the case turns on

- **Physical reach** (v1 trunk, labelled `1/10/25G Eth`): one rail → compute BMC, NVSwitch BMC, power shelf.
- **Controller API calls** (v1, labelled per protocol): `rms → bmc_c` Redfish/HTTPS, `rms → pwr` Redfish/HTTPS, `rms → nvos` NVUE REST/SSH, `rms → nmxc` NMX-C gRPC.
- **Never** `oob → dcgm`. Verified: neither spec contains such an edge. The negative relation has no renderer field, so it is stated here instead of faked.
- In-band (v2): DCGM reads through NVML against the driver (local, no network); the exporter serves `:9400`; Driver+CUDA ⇢ Fabric Mgr is dashed `co-resident` because the excerpts give no verb — no deploys/manages dependency is invented.
- Paid software (Mission Control, BCM, UFM, NetQ, NGC gated images) is absent everywhere; the gated nv-rms *image* caveat is recorded in `generation.json` since the node cannot carry it.

## Attempts (recorded before capture)

`attempts.json`: 2 views, 3 designs each, all in `attempts/` except the accepted `v1.json` / `v2.json`.
v1: 13-node single graph (154×40, over budget) → 7-node engine placement (`no obstacle-safe route for rms -> oob, rms -> bmc_c`) → 7-node explicit layers (accepted). Layer permutations inside the accepted design were tuned for fit (49×32 → 62×24 → 77×24); only the 77×24 variant places all seven labels.
v2: engine `tb` (47×40, too tall for the palette corner) → `lr` (133×11, past 77 columns) → explicit 5 layers (accepted, 33×37).

## Known defects / gaps (full list in generation.json)

1. v1 extent is exactly the pane width — zero horizontal margin.
2. The trunk splits at two junctions (one spur per branch); a single Y-split is not expressible.
3. Two paths land in Compute BMC and in Power shelf (reach + API) — intentional, densest area of the frame.
4. Empty space: v1 uses 24 of 47 rows, v2 uses 33 of 77 columns; no zoom-in available.
5. Group names are not rendered, so plane identity rides on node labels and hue.
6. Labels abbreviated: no `x18`, no CDU/PDU, `NVUE REST/SSH` folds SSH/SFTP, `Redfish/HTTPS` labels two distinct edges (same protocol, different device classes).
7. Capability blockers: no negative-link field, no rendered group legend, no single-split trunk, and no way to show 13 nodes as one frame.

## Cleanup

Capture panes `w7E:p7A` and `w7E:p7D` are `confirmed_closed` in their manifests. Three geometry-probe panes (`w7E:p72`, `w7E:p74`, `w7E:p75`) were closed; the probe that returned rect 79×49 is what proved the 77×47 content size before capturing. `w7E:p6R` (tab `w7E:t1V`) predates this worker and was not touched.

## Output

`docs/visualize-eval/rounds/02/gb300-rack-software/` — `v1.json`, `v2.json`, `attempts.json`, `attempts/`, `evidence/v1/`, `evidence/v2/`, `generation.json`, `generation.md`.
