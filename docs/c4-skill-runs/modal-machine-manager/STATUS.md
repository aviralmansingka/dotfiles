# Status — modal machine-manager C4 run

Two passes, same skill, same scouts, different ladder discipline.

## Pass v1 — fresh session, untightened skill

A fresh `pi` session in `/Users/aviral/modal` (cwd = the modal checkout, no
prior knowledge of this evaluation) invoked the `c4` skill with
`--skill agents/.agents/skills/c4`. It ran the four scouts itself as
`subagent(agent: "scout")` calls — `c4-scope`, `c4-relationships`,
`c4-boundary`, `c4-levels` — then had two worker subagents build the ledger
and the spec.

Scout result: **48 elements** (22 inside, 3 actors, 23 neighbours) and
**97 relations**, each with `file:line`; 20 conflicts adjudicated, 11 gaps
recorded. See `scout-*.md` and `ledger.md`.

Spec result: **21 sections** — `l0`, `l0b`, `l1`, `l1b`–`l1g`, `l2a`–`l2l`
(89 nodes, 109 edges, L0 at 10 nodes / 10 edges). Kept as
`spec-oversplit-21diagrams.json`. Verdict: a level per topic, not a depth —
a skill defect, since the skill set no cap.

## Pass v2 — tightened skill

`SKILL.md` and `prompts/levels.md` gained the splitting discipline (five
sections; a level is a depth; slices capped at two per depth; a split needs a
measurement). The spec was regenerated from the same ledger.

Result (`spec.json`, `check.txt`, `captures/`):

- 5 sections: L0 (8 nodes / 7 edges, 149x15, plain node, no container),
  L1 (10/8, 173x24), L1b (7/4, 126x17), L2 (6/6, 145x15), L2b (5/4, 59x22).
- canvas 173x128, `drawn whole at 100%`.
- `crossings: 0 bridges, 0 touching bends`; `near-misses: 0`;
  `labels: 29/29 placed, 0 on route, 0 skipped, 0 ambiguous owners`;
  `dots: 10 single-dot routes, 0 violations`; `origins: 10/10`.
- **23/23 scoped relations drawn once each** (`coverage.md`), the same 23 the
  golden draws, at the same levels.
- Binary `rataflow-view` sha256 `fa76dde2c248af2c…` (the round-14 build).

## Unresolved

- Container borders sit on the members' top row instead of one row outside it
  — identical in the golden's own 173x128 dump, same binary; recorded as a
  renderer residual, not a spec error.
- The canvas pans at 77 columns (allowed, recorded).
- `mach` merges host SSH and BMC Redfish; `prov → mach` has no single call
  site. Both recorded in `coverage.md`.

See `comparison.md` for the golden comparison and the skill defects the run
exposed.
