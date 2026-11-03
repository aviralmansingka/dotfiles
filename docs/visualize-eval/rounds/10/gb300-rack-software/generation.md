# gb300-rack-software — round 10 generation (viz-ds10-8)

Model: `fireworks/accounts/fireworks/routers/deepseek-flash-latest` · generator `viz-ds10-8`
Frozen binary: `/tmp/visualize-eval/round-10/bin/rataflow-view` (sha256 `db70722b92777467…b92df8`)
Candidate skill: `docs/visualize-eval/rounds/10/SKILL.md` (sha256 `9c1256791069e272…d46f77e56d`, the snapshot that governed)
Render source snapshot: sha256 `0efb3117939b5f1d…b6a40ada` · target 77×47 at 100% natural zoom

## Step 0 — family

```
family: placement-planes
evidence: the rack's software splits into weakly-connected worlds — off-rack nv-rms, the OOB
          LAN rail every BMC hangs off, the NVSwitch tray (NVOS + NMX-C/T), and an in-band
          compute chain — and the OOB world shares no edge with the in-band world because the
          source calls OOB a "separate physical Ethernet network … distinct from every
          traffic-carrying fabric".
```

Tie-breakers: density (`E≈N`, 12 relations / 13 nodes) would hint at flow-chains, but the source has four
weakly-connected components plus a source-named shared bus, so tie-breaker 2 decides (bus + disconnected
worlds ⇒ placement-planes). Motion is not a signature (nothing is animated ⇒ static case, no dots).
Identifier density is low (software names and protocols, not addresses), so identity-probe-maps does not
apply. Secondary recipe actually applied: **flow-chains** habits inside the in-band world (one node per
rank, corridors bought with `label_slot`, no invented branches). The **redundant-fabrics** habit (parallel
lanes / trunks) was deliberately not applied: the only bundle is the OOB rail the human asked for.

Family reclassification: none.

## Views (3 of a max 4; each view ≤3 spec candidates)

| view | spec | carries | extent | crossings | labels | check warnings |
|---|---|---|---|---|---|---|
| v1 | `spec-v1.json` | plant world + ONE split bus; in-band world and its five relations | 67×42 | 2 bridges, 1 touching | 6/6, 0 ambiguous | trunk shared cells (known checker item) |
| v2 | `spec-v2.json` | nv-rms as OOB client + Redfish/HTTPS API paths to Compute BMC x18, NVSwitch BMC, Power shelf | 73×14 | 0 | 4/4, **1 ambiguous** | ambiguous owner |
| v3 | `spec-v3.json` | nv-rms → NVOS (NVUE REST/SSH) → NMX-C/T (hosts), nv-rms → NMX-C/T (NMX-C gRPC), historical OOB → NVOS dashed | 65×10 | 0 | 4/4, 0 ambiguous | none |

Measured size: every live pane reported `82x51 @100%`; per the pinned ruling the fit proof for each view is
`pinned/<view>-77x47.txt` — a pinned direct dump of **that view's final spec** at `COLUMNS=77 LINES=47`,
line `viewport: 77x47 zoom: 1.00 natural`, no overflow banner, three identical frames.

## Structural levers (each tied to a source fact)

- **v1 `trunks`** — line 284 demands one arrow out of the OOB LAN that splits in exactly one spot into the
  three device classes; lines 271/277 call the OOB LAN one shared rail every BMC hangs off. Declared as
  `from: oob, to: bmc_c, branches: [bmc_s, pwr]`, which the engine draws as **one junction with one arm per
  branch** (`trunks: … 2 branches, 1 junctions`; capture row 18 col 49).
- **v1/v2/v3 `group`** — logical plane tags only: `plant` (OOB LAN), `devices` (Compute BMC x18 → NVSwitch
  BMC → Power shelf, one stable sibling order in both views that carry them), `management` (nv-rms),
  `tray` (NVOS, NMX-C/T), `inband` (Kubernetes → GPU Operator → DCGM → dcgm-exporter / Driver+CUDA →
  Fabric Mgr). Nothing is drawn around members.
- **v1/v2 `label_slot`** — buys horizontal gutters for the protocol labels: v1 shrinks from 73 rows to 42,
  v2 stays 14 rows instead of reserving a 13-row rank gap.
- **v3 `direction: lr` + `style: dashed`** — lr is the only orientation measured with 0 ambiguous owners for
  the two-hop tray path (v3-a in tb: 1 ambiguous); dashed keeps the historical, unlabelled OOB → NVOS edge
  visibly unconfirmed.
- No `layers`, no `minlen` are shipped: a five-layer plane pin reproduced the identical 67×42 / 2-bridge
  layout (record `probe-v1-layers`), and no source-stated corridor exists to reserve.

## Meaning ledger (condensed; full rows in `generation.json`)

Drawn: nv-rms as rack aggregator and OOB client; all five southbound API paths with their protocols;
NVOS hosts NMX-C/T; the OOB rail as separate plane with Redfish over HTTPS; the 18 compute tray BMCs; the
independent device endpoints (no edges between them); Kubernetes → GPU Operator (DaemonSet) → DCGM (NVML
over the local driver path) → dcgm-exporter (`:9400`) and → Driver+CUDA → Fabric Mgr; DCGM has **no** OOB
relationship.
Abbreviated: trunk label `Redfish` (a 13-char label cost 6 rank rows — measured), `Redfish power`
(power + serial console), `Redfish pshelf`, `Compute BMC x18`, `same host` for the unlabelled
driver → Fabric Manager relation.
Dropped with reasons: CDU controller and PDUs as OOB endpoints (the human's own list and one-split demand
name exactly the three device classes); Mission Control / BCM / UFM / NetQ / gated NGC images / Slurm
(free-software-only request); the retracted `oob → DCGM` edge; OOB's negative payload list (a negative fact
has no edge). Qualified, not promoted: the air gap is "usually" in the source; NVOS's placement on the OOB
LAN is left dashed.

## Relationship audit → views

`T1` oob→{bmc_c | bmc_s | pwr} (trunk) · v1
`E1` rms→oob *client on* · v2 · `E2` rms→bmc_c *Redfish/HTTPS* · v2 · `E3` rms→bmc_s *Redfish power* · v2 ·
`E4` rms→pwr *Redfish pshelf* · v2 · `E5` rms→nvos *NVUE REST/SSH* · v3 · `E6` rms→nmxc *NMX-C gRPC* · v3 ·
`E7` nvos→nmxc *hosts* · v3 · `E8` oob→nvos *hist. unconf.* (dashed) · v3 ·
`E9` k8s→gpuop *hosts* · `E10` gpuop→dcgm *DaemonSet* · `E11` dcgm→dcgmx *Prom :9400* ·
`E12` dcgm→drvk *NVML (local)* · `E13` drvk→fm *same host* · all v1.

Every historical relation from the brief maps one-to-one onto a drawn edge (table in `generation.json`),
including the later human corrections (nv-rms → each device class) that round 09 lost.

## Verification

```sh
BIN=/tmp/visualize-eval/round-10/bin/rataflow-view
shasum -a 256 "$BIN"                      # db70722b…b92df8
scripts/viz-evidence.sh --spec <case>/spec-v1.json --bin "$BIN" --out <case>/evidence/v1 --label v1 --frames 3
COLUMNS=77 LINES=47 "$BIN" --frames 3 <case>/spec-v1.json > <case>/pinned/v1-77x47.txt
scripts/viz-validate.py <case>/evidence/v1 --require-select --require-frames --require-records \
    --attempts <case>/attempts.json
```

Validator (`validation/<view>-validator.txt`): **v3 all checks passed**; v1 fails only
`check_warnings_absent` (trunk shared-cell item); v2 fails `check_warnings_absent` and
`labels_ownership_clear` (1 ambiguous owner). Every probe and rejected draft ran through
`scripts/viz-evidence.sh record`, so `attempts_records_complete` passes on all three bundles.

## Defects and blockers

1. **v2, 1 ambiguous label owner.** Measured structural, not a tuning miss: two lanes in tb already give 1
   (`probe-v2j`), three-character labels still give 1 (`probe-v2u`), lr+`label_slot` skips labels
   (`probe-v2x`), only a single-lane fan is clean (`probe-v2n`) and a two-lane lr fan is clean
   (`probe-v2s`). The controller needs four lanes in one view; the defect is reported rather than hidden by
   deleting a protocol label or an API relation.
2. **v1 trunk shared-cell warning** — the task-known trunk-junction checker-semantics item. The control
   spec with the trunk replaced by three plain OOB edges (`probe-v1-plainfan`) has no such warning but
   breaks the human's one-split demand, so the trunk stayed.
3. **v1, 2 crossing bridges** where the trunk corridor meets the in-band corridor (rows 16–17, col 49).
4. **No all-worlds view.** 13 nodes measured 81×77 (`probe-all-tb`) and 11 nodes 55×48
   (`probe-worlds-rms`), both over budget, so the case ships three plane views plus a coverage map.

Blockers: none. Cleanup: all three capture panes were split and closed by the evidence harness
(`confirmed_closed` in each `manifest.json`); probes ran offline through `--check` only. No renderer, skill,
rubric, expected-data or other-case edits; no commits, installs, cargo or subagents.
