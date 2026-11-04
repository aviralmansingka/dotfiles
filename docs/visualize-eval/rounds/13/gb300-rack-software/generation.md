# gb300-rack-software — round 13

Generator: **viz-ds13-7** · model `fireworks/accounts/fireworks/routers/deepseek-flash-latest`
Skill `docs/visualize-eval/rounds/13/SKILL.md` (proposal 12, sha `65d826f0…`) ·
binary `/tmp/visualize-eval/round-13/bin/rataflow-view` (sha `1f28d87d…`) · rubric rev **11** ·
source sha `10d440af…` · target **77x47 @100%**.

## Result in one line

Two worlds on one described canvas — an OOB hardware-control section with **one trunk that
splits once** into Compute BMC / NVSwitch BMC / Power shelf, and an in-band section carrying
Kubernetes → GPU Operator → DCGM → {dcgm-exporter, Driver+CUDA} → Fabric Mgr plus NVOS → NMX-C/T.
All 13 nodes and all 11 relations are drawn, the trunk corridor and the whole in-band world route
**clear** of unrelated boxes, and **two validator checks fail** on the trunk's split arms
(19 ring-2 cells) and on the engine's own trunk shared-run warning. Not green.

## Triage (annex `TRIAGE-gb300-rack-software`)

Asked, in order, and answered from the annex: **Q1** how separate the worlds are (answer 1:
completely — own Ethernet network) · **Q2** one line per BMC or one trunk (answer 2: one trunk
that splits exactly once into the three branches) · **Q3** free software only (answer 3: nothing
that costs money, don't imply the gated images are free) · **Q4** panes or canvas (answer 4: a
canvas with a diagram per world is fine).

Two questions the annex cannot answer, decided from the source and the skill:

- **Q5** — the canvas form cannot route between diagrams (ids are namespaced, sections are
  separated by a rule), so how is the one cross-plane relation `oob → nvos` drawn? *Own judgment:*
  draw the OOB LAN a second time inside the in-band diagram as a **boundary stub** with the same
  `oob-lan` group tag, and let its single edge reach NVOS. Dropping the relation is forbidden; the
  stub keeps it visible and keeps the plane's hue identical across the canvas.
- **Q6** — which verbs and protocols label routes when the frozen relation list says "unlabeled,
  do not invent a protocol"? *Own judgment:* only what the excerpts state, on the route that
  states it — `client`, `Redfish/HTTPS`, `hosts`, `DaemonSet`, `:9400`, `NVML`. `k8s → gpuop` and
  `drvk → fm` stay unlabeled on purpose: no excerpt gives a verb, and "manages"/"deploys" is
  exactly the invented dependency the case forbids.

Framing made unnecessary: motion (the source animates nothing → static) and size (the annex
already admits a canvas). Convergence: reader's job, audited claims, shape, trunk and the free
rule were all settled; nothing else could change the drawing.

## Classification

```
family: placement-planes
evidence: two weakly-connected worlds (oob/rms/bmc_c/bmc_s/pwr vs
          k8s/gpuop/dcgm/dcgmx/drvk/fm/nvos/nmxc) joined by one bus — the OOB LAN,
          which fans to three device classes — and one cross-plane relation (oob → nvos).
```

Tie-breakers: density (E=11 < N=13) would suggest a chain, but a chain has one relation per node
and the OOB LAN has four (tie-breaker 1 loses); a bus between disconnected worlds is
placement-planes (tie-breaker 2); identifier content (protocols, `:9400`) is labels here, not the
subject, so identity-probe-map does not win (tie-breaker 3). Borrowed its coverage habit anyway.
No reclassification.

## View shape

**Rung 2 — one canvas, two named and described diagrams.** Decided by: the source's own task line
separating four tiers into two worlds; exactly one relation crossing the seam, so the split loses
nothing; 13 nodes / 11 relations with six labels can't read at 77x47 in one layout — the two
worlds have different rank depths (3 vs 5), so one drawing takes the union depth plus the label
gutters (the sections measure 58x38 and 32x49 on their own, 95 rows stacked); and the reader's
stated preference is a diagram per world.
Rejected rung 1 (one side-by-side view): would need thinning relations or shrinking text. Rejected
rung 3 (extra diagrams): nothing was dropped, and a three-node NVSwitch section would be a
fragment, not a concept — the brief places NVOS/NMX-C/T inside the in-band world.

| diagram | title | description | at | extent | nodes | edges | routes |
|---|---|---|---|---|---|---|---|
| `oob` | OOB hardware-control plane | one OOB trunk to the BMCs and power shelf; nv-rms source is free | 0,3 | 58x38 | 5 | 1 (+ trunk, 3 legs) | 4 |
| `inband` | In-band compute and NVSwitch software | compute chain plus NVSwitch software; the OOB LAN reaches NVOS | 0,46 | 32x49 | 9 | 7 | 7 |

Whole canvas `64x95`, drawn whole at 100% and navigated by pan
(`evidence/canvas/canvas-77x47-frames.txt` line 3: `canvas 64x95`; pane token `68x44 @100%`).

## The trunk

```json
{ "id": "lane", "label": "Redfish/HTTPS", "from": "oob", "to": "pwr",
  "branches": ["bmc_c", "sw"] }
```

Check line: `trunks: oob:lane from oob to pwr, 2 branches, 1 junctions` — one corridor, **one
junction**, one arm per branch: the bus splits exactly once and feeds Compute BMC, NVSwitch BMC and
(straight on) the Power shelf. A three-branch trunk cannot do this: `try_hub` only builds a single
split point for at most two branches, so a third branch falls back to one tap each.

## Routing record — the round's flagship

| attempt | near-misses | what it was |
|---|---|---|
| canvas-v1 | 16 | corridor descending over the NVSwitch BMC (10) + its arm (6) |
| canvas-v2 | 24 | same fan plus a new in-band hug (8) after `label_slot` collapsed the gaps |
| probe-fan (a) | 19 | terminus centred: corridor clean, arms 6 + 13 |
| probe-fan (b) | 10 | lr stack: corridor beside the boxes (6) + arm (4) |
| probe-fan (c) | 24 | terminus pinned a rank below: corridor in the 3-cell sibling gap (18) + arm (6) |
| **canvas-v3 (shipped)** | **19** | corridor **0**, in-band **0**, arms 6 + 13 |

Relief levers that worked: **id order** (within-rank order is id-lexicographic — measured in
`probe-order`, not declaration order, which is why canvas-v2's reordering changed nothing) puts
the Power shelf in the middle of the fan, so the corridor descends into its own target; and
**shortening the exporter label** to `:9400` keeps the in-band rank gap wide enough that
`dcgm → Driver+CUDA` passes a sibling box cleanly.

What remains is structural: the hub junction is placed at the corridor cell nearest the branch
centroid, i.e. one to two rows above the middle box's top, so both arms leave there and cross the
Power shelf's span at ring 2. Routing cannot recover — the near-node price is 8 against a
10-per-cell step cost, so A* only detours for less than one cell. Six measured layouts agree; the
yield is recorded in `generation.json` and not hidden.

## Hue record

`oob-mgmt` (nv-rms) · `oob-lan` (OOB LAN, Compute BMC, NVSwitch BMC, Power shelf **+ the in-band
boundary stub**) · `switch` (NVOS, NMX-C/T) · `inband` (Kubernetes, GPU Operator, DCGM,
dcgm-exporter, Driver+CUDA, Fabric Mgr). `groups: oob-mgmt(1) oob-lan(5) switch(2) inband(6)` — no
group changes hue anywhere on the canvas; the stub is how the reader sees it is the same plane.
`dot hues: 0 by source, 0 by destination, 0 shared-hue pair(s)` — nothing is animated, because the
source animates nothing.

## Validator

```
scripts/viz-validate.py …/evidence/canvas --require-select --require-frames \
    --require-records --attempts …/attempts.json
38 passed, 2 failed: check_warnings_absent, routes_near_unrelated_nodes
```

Full output at `evidence/canvas/validator.txt`. Everything else passes: labels 6/6 with 0
leader-ticked / 0 on-route / 0 skipped / 0 ambiguous, dots 0 violations, origins and arrivals
reported, canvas extents recorded and consistent, viewport proven, select-all frame, 5 and 12
timestamped frames, cleanup `confirmed_closed`, view and spec budgets, the record log, and every
probe input bundled.

## Defects and blockers

1. **19 arm cells at ring 2 of the Power shelf** — structural yield, six attempts measured.
2. **`warning: two edges share 2 cell(s), including ports`** — the hub junction is *designed* to be
   shared; all four trunk specs here emit it and a trunk-free spec (`probe-order`) does not. Since
   `check_warnings_absent` treats any warning as a failure, **no spec using the case's mandated
   `trunks` feature can pass the round-13 validator.** That is the main blocker to report.
3. Canvas 64x95 does not fit the pane — the reader pans; expected for the canvas form.
4. **The palette corner overwrites the drawing in a clipped view.** The palette is anchored to the
   viewport, not the canvas, so on the 77x47 pinned dump and the 68x44 pane it sits on top of the
   Compute BMC border and the in-band title row (`canvas-text.txt` 38-43); in a full 96-row dump it
   sits clear at the canvas's bottom-left. Engine behaviour, unfixable from the spec.
5. The OOB LAN is drawn twice (boundary stub) — deliberate, same hue, recorded.
6. Two source details are dropped with reasons in the ledger: the LAN's 1/10/25G rates and the
   CDU/PDU drops (outside the frozen relation set), plus the NVUE/SSH/gRPC southbound list (no
   frozen edge to carry it).

## Files

```
gb300-rack-software/
  specs/canvas-v3.json            shipped spec (v1, v2 kept as rejected attempts)
  evidence/canvas/                check, text, ansi, selected, frames, pinned 77x47, manifest, validator
  attempts/                       probe-capability, probe-order, probe-fan (layout instruments)
  recorded/                       raw stdout/stderr of every recorded probe
  attempts-log.jsonl              the record log the validator reads
  attempts.json  generation.json  generation.md
```
