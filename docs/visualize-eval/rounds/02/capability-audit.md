# Round 02 capability audit

Frozen before generation. This audit answers one question only: can the frozen
renderer express the semantics that round 01 could not? It makes no claim about
any generated diagram. Verdicts on samples come from the eight Sol judges.

## Frozen identities

| Input | Value |
|---|---|
| Binary | `/tmp/visualize-eval/round-02/bin/rataflow-view` |
| Binary SHA-256 | `ee085c0f3a82e9b7d516cde7532f394864b3490c99691cd7ac5b2d36d640e8ea` |
| Source snapshot | `/tmp/visualize-eval/round-02/renderer-source` |
| Source digest | `f01fdc7dc41eb26e56068353e0ef87a587f8813127f79c4af02bbb32cca65c26` |
| Candidate skill | `docs/visualize-eval/rounds/02/SKILL.md` (`7d1ff098…`) |
| Rubric | `docs/visualize-eval/rounds/02/rubric.json` (`555e3b1d…`) |
| Dataset | unchanged from round 01 (`e69179e5…`, case hashes identical) |

## Capability verdicts

| Round-01 gap | Frozen implementation | Verdict |
|---|---|---|
| No declared shared trunk | `SpecTrunk` (`src/lib.rs:119`); `router.rs:296-340` routes one corridor first, then one spur per branch on its own tap cell and its own branch port; junction cells merge into `┬ ┴ ├ ┤` and are never used by dots | **Supported** |
| No independent dot count | `DotMode::{Periodic, None, Single}` (`src/flow_edge.rs:93`); `dot_cells` excludes corners, bridges, junctions and arrowheads; `dot_stats` (`src/lib.rs:1139`) renders real frames and counts per-route violations | **Supported** |
| Color bound to layout bands | `SpecNode.group` plus `group_color(group, member)` (`src/lib.rs:490`); families follow group order of first appearance, members differ by shade; ungrouped nodes keep band colors | **Supported** |
| Labels overwrite routes | Label search (`src/router.rs:483-543`) treats every drawn route cell, node box and placed label as an obstacle, records the owning edge, and reports `labels_on_route` and per-edge skipped labels | **Supported, with a limit** — a narrow canvas can still skip a label; that is reported, never drawn over a line |
| No uncertainty style | `style: "dashed"` renders `╌`/`╎` on straight spans while corners, bridges, junctions and arrowheads stay intact | **Supported** |
| No per-node selected proof | `--select-all` selects every node before drawing | **Supported** |
| Motion evidence aliases | `--frames <n> --step-ms <ms>` renders timestamped plain-text frames offscreen | **Supported** |
| Zoom and size unproven | `viewport:` startup line for `--check`/`--frames`, and the live header carries `77x47 @100%` because the alternate screen erases the startup line | **Supported** |

## Limits that remain

- **Label space is reserved, not created.** A spec that stuffs more labels into a
  row than the pane can hold still skips a label. The harness rejects a skipped
  label, so the sample must be composed to fit.
- **A trunk branch needs a declared node.** A branch host that no edge touches
  must still appear in `nodes`.
- **Dashed links are a visual qualifier only.** The meaning of "unconfirmed"
  still lives in the label text and the audit table.
- **Dragging still falls back** to the library step router, so router guarantees
  apply to the planned layout at 100% zoom, not to a dragged node.
- **`--frames` output is plain text.** Color and selection survive in the
  `--select-all` ANSI frame, not in the motion frames.

## What this audit does not establish

No diagram was rendered, scored, or approved here. Capability presence is not a
pass: a sample passes only when a judge finds the semantics readable in actual
captures.
