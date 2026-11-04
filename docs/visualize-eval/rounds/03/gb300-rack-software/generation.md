# gb300-rack-software — round 03 generation (DeepSeek)

Model: `fireworks/accounts/fireworks/routers/deepseek-flash-latest`
Candidate skill: `docs/visualize-eval/rounds/03/SKILL.md` (sha256 `cf796bcd…b6cc659c`)
Renderer: `/tmp/visualize-eval/round-03/bin/rataflow-view` (sha256 `b242b6a2…d9ee80f7`)

Two final views, both static (the case asks for no animation, so no dots were added):

| view | spec | nodes / edges | extent | crossings | labels | pane |
|---|---|---|---|---|---|---|
| v1 — OOB hardware control rail + nv-rms controller | `specs/v1.json` | 7 / 5 + 1 trunk | 59×31 | **3** | 6/6 placed | 77×47 @100% |
| v2 — in-band compute stack | `specs/v2.json` | 6 / 5 | 33×37 | **0** | 5/5 placed | 77×47 @100% |

Validator: `all checks passed` for both bundles (`--require-select --require-frames --attempts attempts.json`).

## Full `--check` output

v1 (`evidence/v1/check.txt`):

```
viewport: unknown zoom: 1.00 natural
ok: nodes=7 edges=5 flows=0 direction=tb theme=gruvbox
layers=4 (explicit placement, sugiyama skipped)
extent=59x31 cells
crossings: 3
labels: 6/6 placed, 0 on route cells, 0 skipped
groups: mgmt(1) oob(4) nvswitch(2)
trunks: oobdrop from oob to pwr, 2 branches
dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 synchronized at 2000ms
origins: 0/0 routes start at their arrow origin
```

v2 (`evidence/v2/check.txt`):

```
viewport: unknown zoom: 1.00 natural
ok: nodes=6 edges=5 flows=0 direction=tb theme=gruvbox
layers=5 (explicit placement, sugiyama skipped)
extent=33x37 cells
crossings: 0
labels: 5/5 placed, 0 on route cells, 0 skipped
groups: inband(5) nvswitch(1)
trunks:
dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 synchronized at 2000ms
origins: 0/0 routes start at their arrow origin
```

No warnings on either view. The one live-pane viewport line reads `unknown` inside the
alternate screen; the pane header (`77x47 @100%`) is the measured proof and both manifests
record it as `viewport_token`.

## Meaning ledger (condensed)

Drawn: nv-rms as rack aggregator and OOB client; Redfish/HTTPS; the OOB drops to compute
BMC, NVSwitch BMC, power shelf; rms southbound Redfish/HTTPS ×2 and NVUE REST+gRPC; NVOS
hosting NMX-C/T; K8s → GPU Operator; GPU Operator → DCGM as `DaemonSet`; DCGM → driver over
`NVML (local)`; `Prometheus :9400`; Fabric Mgr host residency (dashed).

Abbreviated: 1/10/25G air-gapped detail, SSH/SFTP and legacy IPMI, "power and serial console
only" on the NVSwitch BMC, compute-host residency (group colour + view framing only — the
renderer has no group legend).

Deliberately dropped, with reasons: `oob → nvos` (superseded by the line-283 correction —
OOB drops land on BMCs/power shelf, NVOS is reached through rms); CDU controller and PDUs
(outside the audited node set, and they re-create the arrow sprawl rejected at line 284);
paid software (Mission Control, UFM, NetQ, BCM, NGC); Slurm; the negative statements (OOB
carries no training traffic, OOB never touches DCGM, DCGM cannot run when a node will not
boot, NGC image entitlement) because the spec format has no annotation field — the positive
consequence is enforced instead: no OOB→DCGM edge exists anywhere.

## Relationship audit → visible edges

| id | from → to | label owner | view |
|---|---|---|---|
| e1 | nv-rms → OOB LAN | `client on LAN` | v1 |
| t1 | OOB LAN → Compute BMC | `OOB drops` (spur junction) | v1 |
| t1 | OOB LAN → NVSwitch BMC | `OOB drops` (spur junction) | v1 |
| t1 | OOB LAN → Power shelf | `OOB drops` (corridor terminus) | v1 |
| e2 | nv-rms → Compute BMC | `Redfish/HTTPS` | v1, v2 |
| e3 | nv-rms → Power shelf | `Redfish/HTTPS` | v1, v2 |
| e4 | nv-rms → NVOS | `NVUE REST+gRPC` | v1, v2 |
| e5 | NVOS → NMX-C/T | `hosts NMX-C/T` | v1, v2 |
| e6 | Kubernetes → GPU Operator | `runs on K8s` | v2 |
| e7 | GPU Operator → DCGM | `DaemonSet` | v2 |
| e8 | DCGM → dcgm-exporter | `Prometheus :9400` | v2 |
| e9 | DCGM → Driver+CUDA | `NVML (local)` | v2 |
| e10 | Driver+CUDA → Fabric Mgr | `hosts FM?` (dashed) | v2 |

Every historical relation maps to a visible edge except `oob → nvos` (drop recorded above);
three source-backed controller edges were added (`rms → Compute BMC`, `rms → Power shelf`,
`rms → NVOS`, line 283) so the API calls are visibly distinct from the OOB physical drops.
No relation, group order or label was traded for a lower crossing count.

## Layout attempts (budget: 4 views, 3 specs each)

- all-in-one view (abandoned, 1 spec): 61×41, **7 crossings**, 2 labels skipped, renderer
  warning above the 12/16 readable budget.
- v1 attempt 1: corridor ended at Compute BMC → renderer error, no obstacle-safe route for
  the Power shelf spur. Attempt 2: no explicit layers → 101×26, 7 crossings, overflows 77
  columns. Attempt 3 (kept, shipped with one label changed): 59×31, **3 crossings**.
- v2 attempt 1 (kept): 33×37, **0 crossings**.

## Remaining defects and blockers

1. **Blocker — no single split point.** The source demands one OOB arrow that splits exactly
   once into three destinations. `trunks` routes one corridor `from → to` and gives each
   `branches` entry its own junction, so v1 shows one bus with two junctions plus a corridor
   terminus. That is the closest honest shape; it is not presented as one split.
2. **Blocker — `nv-rms → NVSwitch BMC` is contested in the source** (line 283 lists the
   NVSwitch BMC as an rms device class, then says rms reaches the NVSwitch only through
   NVOS). Not drawn rather than guessed.
3. v1 keeps 3 crossings: the controller's API edges cross the rail's trunk corridor because
   the controller sits above the rail and the devices below it. Best measured of three.
4. `hosts FM?` is dashed with a question mark: the excerpts never state the driver↔Fabric
   Manager interface, so it is host residency, not a deploys/manages dependency.
5. Static views prove content only. Round-03 motion lines are vacuously clean (0 animated
   routes, `origins: 0/0`); the 5 captured frames are identical static frames.

## Evidence and cleanup

`evidence/v1/` and `evidence/v2/` hold `bin.sha256`, `check.txt`, plain text, ANSI,
`--select-all` ANSI, 5 timestamped frames, `manifest.json` and `validator.txt` per view.
Panes `w7E:pC1` (v1) and `w7E:pC3` (v2) are `confirmed_closed` in their manifests; no other
pane was opened. No reviewer was spawned — round 03 runs the Sol judge separately, and this
bundle makes no approval claim.
