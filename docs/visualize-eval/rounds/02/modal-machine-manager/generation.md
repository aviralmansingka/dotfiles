# Generation report — modal-machine-manager (round 02)

- **Case:** `modal-machine-manager`
- **Worker:** `viz-ds02-modal-machine-manager` (tab label `viz-ds02-undefined-6`; the `undefined` in the spawn message was a bug, corrected by the captain)
- **Generator model:** `fireworks/accounts/fireworks/routers/deepseek-flash-latest`
- **Candidate skill:** `docs/visualize-eval/rounds/02/SKILL.md` — sha256 `7d1ff098d3ff460046e794c29925482ffd0ccb8c6fa493bc390758d976b75d70`
- **Renderer:** `/tmp/visualize-eval/round-02/bin/rataflow-view` — sha256 `ee085c0f3a82e9b7d516cde7532f394864b3490c99691cd7ac5b2d36d640e8ea` (absolute path in every command; global binary never used)
- **Target:** 77x47 at 100% zoom — every capture measured exactly `77x47 @100%`
- **Views:** 4 (budget 4). Spec attempts: v1 1, v2 3, v3 2, v4 3 (budget 3 each)
- **Reviewer:** none spawned (the captain runs separate Sol judges)

## What the source had to survive

17 components and 23 directed relations, plus two hard constraints: the machine↔boot
exchange must keep **both** directions, and the jobs→S3 diagnostics route must stay
separate from providers, janitor and image pull. One shape cannot carry that at 77x47,
so the source's own three paths became the split.

| view | role | nodes | edges |
|---|---|---|---|
| v1 | provisioning request path | web, cp, wapi, pgrpc, q, reg, prov, mch (8) | e1–e7 (7) |
| v2 | boot exchange + heartbeat | mch, agent, boot, pub, db (5) | e8–e12 (5) |
| v3 | ops, diagnostics, image pull | q, ssh, s3, jan, mch, wapi, slack (7) | e15–e21 (7) |
| v4 | state writers + reconcile | pgrpc, q, rec, db, prov (5) | e13, e14, e22, e23 (4) |

All 17 nodes and all 23 relations are drawn at least once; the full edge→view and
node→view maps are in `generation.json` (`coverage_map`, `relationship_audit`).

Groups are conceptual and consistent across views: `humans` (web, slack), `control`
(cp, wapi, pgrpc, pub), `jobs` (q, rec), `cloud` (reg, prov), `metal` (mch, agent),
`artifact` (boot, s3), `state` (db), `ops` (ssh, jan). `agent` shares the `metal` family
because its relation to the machine is residency ("runs on host"), not a service hop.

Every route carries exactly one slow dot (`dots: 1`, `flow: 0.5`) — the human
corrections at source lines 148/217. The one human-mediated, transport-unstated link
(webapi → Slack) is the dashed route.

## Per-view result

| view | dir | extent | labels | dots | validator |
|---|---|---|---|---|---|
| v1 | tb | 48x45 | 7/7 placed, 0 skipped | 7 single-dot, 0 violations | all 24 checks PASS |
| v2 | tb | 42x30 | **4/5 placed, 1 skipped** | 5 single-dot, 0 violations | **3 FAIL** (warnings, labels_complete, labels_not_skipped) |
| v3 | tb | 42x32 | 7/7 placed, 0 skipped | 7 single-dot, 0 violations | all 24 checks PASS |
| v4 | lr | 66x19 | 4/4 placed, 0 skipped | 4 single-dot, 0 violations | all 24 checks PASS |

Frames: 5 timestamped frames per view (`vN-frames.txt`), 7 dots per v3 frame across all
5 frames = one live dot per route, 5 dashed cells visible on e21.

## The one real failure, and why it stayed

`v2` edge **e9 (boot server → machines, "boot.ipxe + S3 args")** is drawn — route,
arrowhead into the machine box, one dot — but its label is skipped. `--check` says
`labels: 4/5 placed, 1 skipped` with an explicit warning.

I isolated it as a renderer gap, not a label-width problem:

- `probes/probe-pair.json` — a bare 2-node graph with one forward and one reverse edge:
  the reverse label is skipped (`1/2 placed`).
- `probes/probe-pair-short.json` — same graph, reverse label cut to 9 characters
  (`boot.ipxe`): still skipped.
- `probes/probe-pair-lr.json` — same graph, `direction: lr`: `2/2 placed`.

So a reverse (upward) route in `tb` exposes no label slot at any label length; only a
different composition (`lr`) fixes it. v2 was already at its third spec attempt when the
probe proved this, so I kept the honest result and recorded the blocker instead of
spending a fourth attempt.

Second structural finding, also recorded: `lr` refuses to route a reverse edge that
skips a layer (`attempts/v3-attempt1.json` → `no obstacle-safe route for mch -> s3`),
which is why v3 was recomposed in `tb` with every edge running forward.

## Trunks: available, deliberately unused

The trunk capability works in this build (`probes/probe-capability.json` → `trunks: t
from a to d, 2 branches`). This source has no single shared corridor: the queue's
fan-out (e15/e18/e19), the Postgres sinks (e12/e13/e14/e23) and the boot exchange
(e8/e9) each carry different per-branch meaning, and one trunk label would merge
relations that must stay distinguishable. Refused per SKILL Steps 3/5 rather than drawn
as a fake bus.

## Remaining defects (disclosed, not hidden)

1. **v2 e9** has no visible label (above) — the only validator FAIL.
2. **v3 e21** is dashed, but the label (`confirm + alerts`) does not itself repeat the
   uncertainty qualifier the skill asks for.
3. **v1** puts the labels of its two parallel columns in one band; `create/term/repair`
   sits one blank cell from its own line and four from the neighbour. Traceable, not
   ideal.
4. **v4** has two parallel runs leaving `rec`; `gcore sync 1min` is one blank row from
   each, so ownership needs the audit table.
5. **Manifest gap (harness, not renderer):** `pane_rect`/`pane_cols` are null in every
   manifest because this herdr build's `pane layout` JSON did not expose the split
   pane's rect to the capture script's jq filter; measured size comes from the app's own
   `77x47 @100%` header token, which the validator accepts.

## Cleanup

4 panes opened (one per capture), 4 closed, all `confirmed_closed` in their manifests;
my tab has 1 pane afterwards. No panes were opened for probes — they ran offline via
`--check` / `--frames`. No commits, no installs, no renderer edits, no reviewer subagent.

## Files

```
v1.json v2.json v3.json v4.json      final specs (captured bytes)
attempts.json                        per-view attempts + hashes (written before capture)
attempts/*.json                      superseded drafts (reconstructed; see the note in attempts.json)
evidence/vN/                         bin.sha256, check.txt, vN-text.txt, vN-ansi.ansi,
                                     vN-selected.ansi, vN-frames.txt, vN-frames.ansi,
                                     manifest.json, validator.txt
probes/                              capability/label-slot probes proving the blocker
validator-all.txt                    all four validator runs
generation.json                      ledger, audit, coverage, defects, blockers
```
