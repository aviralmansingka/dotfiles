# server-nic-layout — round 10 generation

Generator: `viz-ds10-4`, model `fireworks/accounts/fireworks/routers/deepseek-flash-latest`.
Frozen inputs: candidate skill `docs/visualize-eval/rounds/10/SKILL.md`
(sha256 `9c125679…f77e56d`), renderer `/tmp/visualize-eval/round-10/bin/rataflow-view`
(sha256 `db70722b…b92df8`). Static case: no dots anywhere.

## Step 0 — family

```
family: identity-probe-maps
evidence: the source is an identifier inventory — one host's /29 (103.19.91.58/29,
          gateway .57, .60-.62 free), a named NIC (eno16595np0 25 GbE), two Dell
          R7725 boxes, a ToR vendor known only from a MAC OUI, and a probe caveat
          (hops 3 and 6 silent, hop 5 80% loss, "a missing hop proves nothing
          about Layer 2").
```

Tie-breakers: `E ≈ N` would suggest flow-chains, but tie-breaker 3
(identifier/qualifier content outranks shape) decides it, and the skill's own
frozen-case table lists `server-nic-layout` under identity-probe-maps. No bus
with disconnected worlds, so not placement-planes. No motion at all, so no dots.
Secondary recipe: none applied.

## Views (3 of 4 allowed)

| view | carries | spec | extent | check |
|---|---|---|---|---|
| v1 box + ports | 7 dark NICs, server1 R7725 103.19.91.58, eno16595np0 25 GbE | `specs/v1.json` | 41×20 | 0 crossings, 2/2 labels, 0 ambiguous, no warnings |
| v2 /29 peers | server2 .59, spare .60-.62, gateway .57 (no NAT, no v6, same /29, free? unprobed) | `specs/v2.json` | 66×13 | 0 crossings, 3/3 labels, 0 ambiguous, no warnings |
| v3 egress + caveat | gw → silent hops (NxtGen AS132717 BLR) → Airtel 1.8 ms → AirtelBB 7.1 ms → CF 8.3-8.6 ms | `specs/v3.json` | 44×36 | 0 crossings, 4/4 labels, 0 ambiguous, no warnings |

Coverage map: e1–e2 → v1; e3–e5 → v2; e6 (split e6a/e6b) –e8 → v3. Every audited
relation and every ledger row names its view in `generation.json`.

## Family recipe and levers

Identity-probe-maps: coverage first, geometry second. Each fact became a ledger
row with a named view before any spec was written; the view split follows the
source's own fact clusters (the box and its ports, the address plan, the egress
path). Levers used: `group` tags (ports, hosts, pool, plant, transit, internet;
the silent-hop marker deliberately has none), `label_slot` on every labelled
edge, and `style: "dashed"` for the three inference/unproven links. No trunks
(the /29 is a star, not a bus that splits once), no `layers`, no `minlen`.

Mandatory round-09 misses, all now visible: gateway role (the `gw .57 Arista?
0.1ms` node in two views, plus the "default gw" wording in the audit), the
Dell/NxtGen identifiers (`server1 R7725 …` / `server2 R7725 .59` labels and the
`NxtGen AS132717 BLR` edge label), and the missing-hop caveat (`1.8 ms, no L2
proof` on the dashed span through `3,6 silent, 5 lossy`).

## Recipe yield (measured)

The recipe's "deep lr chain" was measured as impossible here: the 6-node draft
was **57×63 in tb** (pinned 77×47 dump showed `graph overflows · drag to pan`)
and **120×14 in lr**. Both directions were recorded (`attempts-log.jsonl`),
the content was re-split into three clusters instead of shortened, and every
shipped view fits 77×47 at natural 100% zoom (pinned dumps in `pinned/`).
Direction is the yielded element; nothing was dropped to buy the fit.

## Evidence

- `evidence/v{1,2,3}/` — `check.txt`, plain text, ANSI, `--select-all` ANSI,
  3 timestamped frames (static: all three frames byte-identical), `manifest.json`
  with the binary path/sha256, the pane token (`82x51 @100%`) and
  `cleanup: confirmed_closed`.
- `pinned/v{1,2,3}-final-77x47.txt` — pinned `COLUMNS=77 LINES=47 --frames 3`
  dumps of each view's FINAL spec: `viewport: 77x47 zoom: 1.00 natural`, no
  overflow banner (the pinned-fit ruling).
- `attempts-log.jsonl` — 14 record-wrapper entries (every probe, draft and pinned
  dump, with command, exit status and raw stdout/stderr hashes).
- `attempts.json` — 3 views, 2/1/3 spec candidates, 2 `abandoned_shapes`.
- `validator/v{1,2,3}.txt` — `scripts/viz-validate.py` with `--require-select
  --require-frames --require-records`: **all checks passed** on every view.

Two checks failed transiently before the final run (no `generation.json` yet for
the pinned-fit lookup; one raw dump deleted and then restored byte-for-byte to
the recorded hash). Both are described in `generation.json` →
`validator_output.transient_failures_before_the_final_run`.

## Defects and limits

- v1 is deliberately thin (3 nodes, 2 edges); merging it with v2 measured 57×63
  in tb, so the split stayed.
- v3's `1.8 ms` is Airtel's cumulative RTT on the arrival half of the split
  transit edge — the source gives cumulative values only.
- The gateway label carries four facts (`gw`, `.57`, `Arista?`, `0.1ms`) because
  the renderer has no qualifier/badge field; `Arista?` and `free? unprobed` keep
  the OUI inference and the unprobed-pool claim marked instead of promoted.
- Dropped with reasons (in the ledger): host runtime state (no GPUs, 1.5 d
  uptime), on-disk spec paths, the "modern reality" background essay.
- Blockers: none. No reviewer was spawned (the captain runs the terra judge).
