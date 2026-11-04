# gb300-rack-software — round 09 generation (viz-ds09-8)

Fresh DeepSeek generation (`fireworks/accounts/fireworks/routers/deepseek-flash-latest`).
Frozen renderer `/tmp/visualize-eval/round-09/bin/rataflow-view`
(sha256 `405a61a674a7cc6271ae1276794eb270c9425dfc38585f4cbb1c48e9b6db495b`), candidate skill
`docs/visualize-eval/rounds/09/SKILL.md` (sha256 `ba2878c5194cd6fc4bc1af5299a156064130de9be1b0ccf4c6eeb0236d431381`).
No judges, no subagents, no renderer/skill/rubric edits, no commits, no installs, no cargo.

## Step 0 — family first

```
family: placement-planes
evidence: the rack software lives in weakly-connected worlds joined by one named bus — the OOB LAN is
          "a separate physical Ethernet network ... usually air-gapped from the data plane" whose every
          BMC hangs off it, while DCGM's whole job is in-band and "the only relationship to OOB is
          negative" (source lines 271/277).
```

Tie-breakers considered: density does not decide (11 relations / 13 concepts); tie-breaker 2 decides
(a source-named bus plus disconnected worlds); identifier density was rejected — the source has single
identifiers (`18` compute tray BMCs, `:9400`), not an address inventory. Secondary recipe actually
applied: identity-map coverage discipline (every identifier and qualifier got a ledger row before any
spec) plus service-mesh fan discipline (the controller's API fan keeps a stable port order and no
merged bidirectional arrow). Family never changed; only the view split did.

## Views

| view | spec | direction | nodes | edges | extent | crossings | live pane | fit proof |
|---|---|---|---|---|---|---|---|---|
| v1 OOB plane | `v1-oob-plane.json` | lr | 5 | 1 + trunk(2 spurs) | 49x14 | 0 bridges, 0 touching | 82x51 @100% (w7E:pP6) | `pinned/v1-77x47-frames.txt` |
| v2 NVSwitch plane | `v2-nvswitch-plane.json` | tb | 3 | 3 | 32x22 | 0 bridges, 0 touching | 82x51 @100% (w7E:pP7) | `pinned/v2-77x47-frames.txt` |
| v3 in-band plane | `v3-inband-compute-plane.json` | tb | 6 | 5 | 36x44 | 0 bridges, 0 touching | 82x51 @100% (w7E:pP9) | `pinned/v3-77x47-frames.txt` |

Every view is static (`dots: 0` everywhere): the source never animated anything and the human was
complaining about visual noise. Static proof: the pinned dumps' frames 0/1/2 are byte-identical; the
five live frames differ only by the pane's trailing shell-prompt lines.

## Recipe per view and where the capture shows it

Coordinates below are rows/columns counted from the app-header line as row 1 of a pinned frame block.

- **v1 (placement-planes):** two worlds side by side, nothing drawn around either. `pinned/v1-77x47-frames.txt`
  frame 0: the `nv-rms` box is columns 15-22 rows 24-27 (label row 25) and the `OOB LAN` box columns
  27-35 rows 24-27 (label row 25); the device world starts at column 47 (`Compute BMC x18` columns 47-63
  rows 19-22, `NVSwitch BMC` columns 49-62 rows 24-27, `Power shelf` columns 49-61 rows 29-32). The bus
  corridor leaves `OOB LAN` at column 36 on row 25 (label `1/10/25G`, row 24 cols 36-43) and reaches ONE
  junction cell `┼` at row 25 column 45; from that single cell exactly three ends leave — up column 45 to
  row 20 then `╭▶` into `Compute BMC x18`, straight `▶` at row 25 column 48 into `NVSwitch BMC`, down
  column 45 to row 30 then `──▶` into `Power shelf`. `--check`: `trunks: oob_bus from oob to bmc_c,
  2 branches, 1 junctions`. Levers: `trunks` (justified by line 284, the human's one-split instruction),
  `label_slot` on `e1` (line 277: rms is "a client on that network, not part of it"), groups
  `off-rack mgmt` / `OOB hardware` (line 283). The worlds are joined only by `nv-rms ───▶ OOB LAN`
  (row 25 cols 23-26) labelled `LAN client` (row 28 cols 19-28).
- **v2 (placement-planes, second world pair):** controller world above (`nv-rms` box columns 35-42 rows
  16-19), NVSwitch software world below (`NVOS` columns 34-39 rows 24-27, `NMX-C/T` columns 35-43 rows
  32-35), no box or title around either. Two separate one-way stems leave nv-rms's bottom ports at
  columns 36 and 38 carrying `NVUE/SSH/SFTP` (row 20 cols 41-53) and `gRPC` (row 21 cols 41-44), and
  `hosts` (row 28 cols 39-43) is the separate NVOS → NMX-C/T residency edge. Levers: groups,
  `label_slot` (protocol names are long), tb.
- **v3 (placement-planes, the unreachable plane):** the in-band world in its own area, and the plane
  boundary is a drawn absence — no route in any view connects a v1/v2 node to a v3 node. The chain runs
  from `Kubernetes` (label row 5 cols 35-44) to `Fabric Mgr` (row 45 cols 35-44) inside columns 24-60;
  the labels land beside their own routes (`operator` row 8, `DaemonSet` row 16, `metrics` row 33 cols
  29-35, `NVML read` row 29 cols 42-50, `same host` row 40) with 5/5 placed and 0 ambiguous owners.
  Compare `pinned/v3-77x47-frames.txt` with the other two dumps: the node sets are disjoint, so the
  source's negative relationship ("DCGM has nothing to do with OOB") is visible as the missing line,
  not as a drawn one. Levers: groups `in-band ctrl` / `compute host` (line 277 residency), `label_slot`
  on the chain edges, no `label_slot` on the dcgm fan (measured, see Y1).

## Yields (recorded, with the attempts that proved them)

**Y1 — the controller's device-class API fan cannot share a view with the bus.** Four measured
failures: `v1-a1` (lr, six out-edges) `no obstacle-safe route for rms -> bmc_c, rms -> nmxc`; `v1-a2`
(tb, four out-edges) fails all four; the 5-node lr view with one API edge fails for `bmc_c`
(log label `v1-a3-check`) and, retargeted, for `pwr` (`probe-p3-lr-api-to-pwr`). Control probe
`probe-p1-tb-nolabels` routes the same 7-node topology (73x23, 1 junction), so the trunk shape is fine
and only rank-spanning controller edges are not. Yield: the API edges live in v2, where each spans one
rank; v1 keeps the controller's membership edge.

**Y2 — the bus's payload protocol is not drawn.** `Redfish/HTTPS` had to share the only trunk label
band, which this renderer sizes as a whole rank gap, with the medium; the medium (`1/10/25G`) took it.
The delivered protocols are the controller's API protocols in v2.

## Defects and blockers (see `generation.json` for the full text)

1. **D1 (v1, renderer):** `--check` prints `warning: two edges share 1 cell(s), including ports`.
   The one-split hub necessarily shares its junction cell with one arm; `probes/p4-hub-minimal.json`
   reproduces it on a 5-node minimal spec. `viz-validate.py` therefore fails `check_warnings_absent`
   for v1. Clearing it would mean giving up the trunk shape the human demanded, so it is reported
   instead of hidden.
2. **D2 (v2, router preference):** the `gRPC` route takes a long detour around the NMX-C/T box: it
   leaves nv-rms's left bottom port (row 20 col 36), runs left to col 32, down to row 37, right to col
   45, up to row 30, left to col 38 and down into NMX-C/T's top (0 bridges, so the router prefers the
   detour). Two attempts to shorten it failed to route at all (`v2-a2` with rank pins, `v2-a3` in lr).
3. **D3 (all, process):** `attempts-log.jsonl` line 8 cannot verify — the label `probe-p4-hub-minimal`
   was used twice and the rerun overwrote the first run's raw files. The log was not edited. Every
   other line verifies.
4. **D4 (all, environment):** live panes measured 82x51 @100%, so each view's FINAL spec was dumped at
   exactly `COLUMNS=77 LINES=47` with no overflow banner (`pinned/<view>-77x47-frames.txt`).

## Validation

```
scripts/viz-validate.py docs/visualize-eval/rounds/09/gb300-rack-software/evidence/v1 \
  --require-select --require-frames --require-records \
  --attempts docs/visualize-eval/rounds/09/gb300-rack-software/attempts.json
```

- v1 — 2 failed: `check_warnings_absent` (D1), `attempts_records_complete` (D3). Everything else
  passes, including labels 2/2 with 0 ambiguous owners, `crossings` reported, viewport proven by the
  pinned 77x47 dump, cleanup confirmed.
- v2 — 1 failed: `attempts_records_complete` (D3).
- v3 — 1 failed: `attempts_records_complete` (D3).

Full output per view is preserved at `evidence/<view>/validator.txt`. This report does not claim
independence or a green result; the captain runs the terra judge separately.

## Cleanup

Three half panes were opened by `scripts/viz-evidence.sh` in this worker's own tab — `w7E:pP6`
(v1), `w7E:pP7` (v2), `w7E:pP9` (v3) — and each manifest records `cleanup: confirmed_closed`.
No other pane was touched and the captain's tab was never used.
