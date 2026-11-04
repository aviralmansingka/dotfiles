# Round 08 — gb300-rack-software

Generator: round-08 diagram generator worker · model `fireworks/accounts/fireworks/routers/deepseek-flash-latest`
Candidate skill `docs/visualize-eval/rounds/08/SKILL.md` sha256 `b1bdb4d3d38336cb…` (verified with shasum)
Renderer `/tmp/visualize-eval/round-08/bin/rataflow-view` sha256 `ea24593b0f80c161…` (verified, never rebuilt, never substituted)
No judge and no reviewer were spawned. Nothing is marked green.

## Step 0 — family

```
family: placement-planes
evidence: two weakly-connected worlds (off-rack management + the OOB hardware-control
          plant) joined to an in-band software world by exactly one bus, and the source
          demands that bus split once into three device classes while insisting the
          device classes have no edges between them.
```

Secondary recipe: **identity-probe-maps** for the qualifier content (18 BMCs, Redfish/HTTPS,
NVUE REST / SSH/SFTP / NMX-C gRPC, `:9400`, "usually air-gapped"). Those are ledger rows
before any spec.

Motion: **static**, no dots, no flow. The source never animates a link and the brief says
static; every edge carries `"dots": 0`. `--check` reads
`dots: 0 single-dot routes, 0 periodic routes, 0 violations …` in every view.

## Views and coverage

| view | direction | nodes / edges | extent | maps to |
|---|---|---|---|---|
| v1 OOB bus | tb | 5 / 1 + 1 trunk | 62×43 | the one OOB bus splitting into compute BMC (×18), NVSwitch BMC, power shelf; nv-rms as a LAN client; Redfish/HTTPS |
| v2 OOB plant | tb | 6 / 5 | 62×34 | OOB reach: 18 BMCs, CDU controller, PDUs, power shelf (Redfish/HTTPS) and the air gap to the in-band network |
| v3 NVSwitch software | lr | 5 / 4 | 67×11 | nv-rms → NVOS (NVUE REST / SSH-SFTP) → NMX-C/T hosted there; NMX-C gRPC; OOB → NVSwitch BMC power+serial only |
| v4 in-band compute | tb | 7 / 6 | 50×44 | Kubernetes → GPU Operator → DCGM (DaemonSet) → dcgm-exporter `:9400`; DCGM → driver+CUDA by NVML; driver+CUDA → Fabric Manager (bundled); metrics on the in-band net |

Every audited relationship has a view (see `generation.json.relationship_mapping`), including
the corrections: no `OOB → DCGM` edge anywhere, `nv-rms` reaches the NVSwitch through NVOS
and not through the NVSwitch BMC, and the device classes stay siblings with no edges between
them.

## Structural levers (each with its source fact)

- **trunk (v1)** — one corridor `OOB LAN → Compute BMC×18` with spurs to `NVSwitch BMC` and
  `Power shelf`. Source: line 284 — "just have one arrow … that one arrow split in exactly
  one spot". `--check`: `trunks: oob-bus from oob to bmc_c, 2 branches, 1 junctions`.
- **layers (v1)** — `[["rms"],["oob"],["bmc_c","bmc_s","pwr"]]`. Source: line 272 "sits on top of
  the out-of-band management LAN" + line 271 "why it sits above every other node".
- **group regions** — v1 `off-rack mgmt / OOB plant / rack hw`, v2 `OOB plant / rack hw(4) / in-band`,
  v4 `cluster / in-band`. Groups are source concepts (management plane, OOB plant, rack device
  classes, cluster, in-band fabric), never rows or depths.
- **minlen 2 (v2)** — the `OOB LAN → in-band net` edge skips a rank to give the air gap its own
  space. Source: "its own switch pair, its own subnet, usually air-gapped".
- **dashed style (v2)** — the same edge, because the source qualifies it with "usually".
- **no pins in v4** — the source states no geometry for the in-band chain, so ranks are pure
  longest-path ranking.

## Renderer facts measured (and what they cost)

1. **A labelled tb rank gap costs `label length − 1` rows.** 2-node tb chain: 12 rows
   unlabelled, 14 at length 3, 19 at length 8, 24 at length 13. In lr the cost is paid in
   columns (23 / 25 / 30 / 35). At 46 usable rows a five-rank chain (v4) can afford almost no
   edge labels: v4 attempt 1 with six labels measured 50×60 and its frame showed
   `graph overflows · drag to pan`. The verbs therefore live in node labels
   (`DCGM (DaemonSet)`, `Fabric Mgr (bundled)`, `dcgm-exporter :9400`).
2. **Trunk junctions.** 1–2 spurs → one hub split point (`1 junctions`); 3+ spurs → one tap per
   branch. A trunk's `to` and `branches` must be distinct nodes, so **three destinations can
   only be encoded as two spurs**, i.e. hub mode. Hub mode always shares the source port cell
   and the hub cell — which is exactly what a bus is — and the checker reports it as
   `warning: two edges share 2 cell(s), including ports`. A four-destination probe (3 spurs)
   printed `3 branches, 3 junctions` with no warning, but that shape is not available for the
   three destinations the source names. Recorded raw, not hidden.
3. **Regions.** A single-member group draws no titled region in tb but a displaced empty box in
   lr; a multi-member group whose members span ranks can draw its box displaced from them.
   Regions are therefore declared only where the capture shows the box over its members
   (v1/v2 `rack hw`, v4 `cluster` and `in-band`). v3's `NVSwitch` region and v4's
   `compute host` region were dropped after their boxes rendered over neighbouring nodes or
   over blank space; the captures that killed them are in `checks/v3-a2.txt`,
   `checks/v4-a2.txt` and this file's notes.

## Verdict from the harness validator

```
v1  evidence/v1/validator.txt   1 check(s) failed: check_warnings_absent   (the bus's shared port+hub cells; see defects)
v2  evidence/v2/validator.txt   all checks passed
v3  evidence/v3/validator.txt   all checks passed
v4  evidence/v4/validator.txt   all checks passed
```

All views report `0 ambiguous owners`, `0 skipped` labels, `0 labels on route cells`, `0 dot
violations`, `0/0 origins`, `0/0 arrivals`, and every capture proves pane close
(`cleanup: confirmed_closed`).

## Known defects, honestly

- **v1**: `warning: two edges share 2 cell(s), including ports` — structural for a
  three-destination trunk in this build (see measure 2). The validator fails that one check.
- **v1**: the `rack hw` region title renders as `r▼ck hw` — the third destination's arrowhead
  lands on the title's x and paint order puts the route over the text
  (`evidence/v1/v1-text.txt`). The repo's own `rataflow/examples/trunk.json` shows the same
  class of damage (`── te│ants ───`).
- **v2**: the CDU and PDU drops are unlabelled — three labels in one tb rank gap lost one and
  made another ambiguous (`checks/v2-a1.txt`).
- **v3**: no declared region for the NVSwitch software plane; every placement drew a mangled
  title across a neighbouring node.
- **v4**: only two of six edges are labelled (rank-gap cost); deployment/bundling/address
  facts sit on node labels.

## Blockers

- **Viewport**: this worker's Herdr tab splits to **83×51**, so the live captures measure
  `83x51 @100%` (manifest `viewport_token`). The app never zooms below 100 %, so the captures
  are natural zoom, but the target 77×47 is *not* what the pane measured. Recorded as a
  blocker, not relabelled. Pinned direct dumps at `COLUMNS=77 LINES=47` are stored for every
  view (`evidence/<v>/<v>-77x47-frames.txt`, `pinned/`): each prints
  `viewport: 77x47 zoom: 1.00 natural` and no `overflows`, and the validator accepts them as
  fit proof (`viewport_matches_target` PASS).
- No renderer feature was needed that the build lacks; the two limits above (label-slot cost,
  hub-only single split) are cost/bug limits, recorded with raw output.

## Attempts and budget

`attempts.json` records every candidate with its raw `--check` in `checks/`: v1 ×2, v2 ×3,
v3 ×3, v4 ×3 — all within the three-per-view budget. Rejected-attempt spec bytes were
overwritten by later drafts, so no hash is claimed for them; their raw check output is
preserved verbatim.

## Files

- `specs/` final specs · `checks/` raw `--check` per attempt · `pinned/` 77×47 dumps
- `evidence/v1..v4/` per-view bundle: `bin.sha256`, `check.txt`, `-text.txt`, `-ansi.ansi`,
  `-selected.ansi`, `-frames.txt`, `-77x47-frames.txt`, `manifest.json`, `validator.txt`
- `attempts.json`, `generation.json`, `generation.md`
