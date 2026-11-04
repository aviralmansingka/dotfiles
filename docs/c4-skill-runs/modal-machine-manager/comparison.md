# comparison — this run vs the golden ladder

Golden: `docs/visualize-eval/rounds/14/c4-l0/specs/c4-l0-final.json`
(owner-approved; the source there is
`docs/visualize-eval/cases/modal-machine-manager/source.md` — a 17-component,
23-relation chat summary).
This run: `spec.json` (spec, checks and captures in this directory), built
from `ledger.md`, whose 48 elements and 97 relations were gathered *from the
modal repository by four scouts*.

Verdict, up front: **match on level set, containment and relationship
coverage; partial on description wording (better on provenance, equal on
shape); one recorded cosmetic difference (label widths).** The one honest
mismatch is not in the diagram but in the fact base: the code has 97
relations, the acceptance target has 23.

| criterion | verdict |
|---|---|
| level set (L0, L1, L1b, L2, L2b) | **match** |
| containment (members vs externals per level) | **match** |
| relationship coverage (23, once each) | **match** |
| description quality | **partial** (same shape, wording grounded in code evidence) |
| canvas/extent, crossings, labels | **match** (two levels ±4 columns) |
| fact base (97 code relations vs 23 summarised) | **mismatch, deliberate** — see §5 |

## 1. Level set

| level | golden | this run | verdict |
|---|---|---|---|
| L0 · System context | yes, plain node, 8 nodes / 7 edges, 149x15 | yes, plain node, 8 nodes / 7 edges, 149x15 | match |
| L1 · The machine manager | container, 10 nodes / 8 edges, 173x24 | container, 10 nodes / 8 edges, 173x24 | match |
| L1b · The machine side | container, 7 nodes / 4 edges, 130x17 | container, 7 nodes / 4 edges, 126x17 | match (−4 cols) |
| L2 · Inside — queue and dispatch | container, 6 nodes / 6 edges, 147x15 | container, 6 nodes / 6 edges, 145x15 | match (−2 cols) |
| L2b · Inside — the state writes | container, 5 nodes / 4 edges, 59x22 | container, 5 nodes / 4 edges, 59x22 | match |
| whole canvas | 5 diagrams, 36 nodes, 29 edges, 173x128 | 5 diagrams, 36 nodes, 29 edges, 173x128 | match |

`--check`: identical invariant lines — 0 crossings, `near-misses: 0`,
`passes-near-unrelated-node: 0`, `labels 29/29 … 0 ambiguous owners`,
`dots 10 single-dot, 0 violations`, `origins 10/10`.

The v1 pass of the same skill produced **21 sections** — `l0`, `l0b`, `l1`,
`l1b`–`l1g`, `l2a`–`l2l` — with a 10-node / 10-edge L0
(`spec-oversplit-21diagrams.json`). The component was still one node there,
but the world around it was cut per vendor (Gcore and Latitude as separate
boxes, plus AWS, OTel, the janitor service and a reverse
`janitorsvc → mm`), so L0 read as an element inventory rather than a context
view, and every subsystem below got its own section. The difference between
v1 and v2 is the skill's splitting discipline, not the facts: both used the
same ledger.

## 2. Containment

| level | golden members | this run's members | golden externals | this run's externals |
|---|---|---|---|---|
| L1 | pgrpc, wapi, reg, rec, ssh, boot | pgrpc, web, reg, recon, ssh, boot | cp, web, prov, mch | cp, ops, prov, mach |
| L1b | q, wapi, pub | q, web, pub | mch, agent, s3, slack | mach, agent, s3, slack |
| L2 | pgrpc, wapi, q, reg, ssh, jan | pgrpc, web, q, reg, ssh, jan | — | — |
| L2b | q, pgrpc, pub, rec, db | q, pgrpc, pub, recon, pg | — | — |

- **Same membership, same cardinality, same level, every level.** The ids
  differ because this run's ids come from the ledger (`web` for webapi,
  `recon` for the reconcile loop, `pg` for Postgres, `mach` for the machine
  fleet); the labels match the golden's wording.
- **Externals stay outside.** Verified on `captures/canvas-text.txt`: at L1
  the box spans the six boundary services with `cp`/`ops` left and
  `prov`/`mach` right; at L1b the box holds `q`, `web`, `pub` with the fleet
  left and `s3`/`slack` right. The ranks inside the L1 box are the same as
  the golden's (private gRPC + cluster reconcile, then webapi + provider
  adapter, then SSH + BMC ops + boot server): `layers` pinned both.
- **A containment claim the golden could not make:** the ledger justifies each
  membership with a deployment artifact (`templates/machine-manager-internal-nlb-service.yml`,
  `main.go:245-300` for the five listeners, `migrations/` for the schema).
  The golden's source had no such evidence; its boundary was the chat summary.

## 3. Relationship coverage

Both draw 23 relations, partitioned identically:

| level | relations | verdict |
|---|---|---|
| L0 | 1 atomic (`mach → s3` pull boot image) + 7 context summaries | match |
| L1 | 8 | match |
| L1b | 4 | match |
| L2 | 6 | match |
| L2b | 4 | match |

Per-relation mapping to ledger rows is in `coverage.md`. Same relations, same
direction, same level — including the two that are easy to get wrong:

- **`mach → boot` and `boot → mach` stay two arrows** (iPXE request vs
  boot script + S3 args), not one bidirectional edge.
- **`mach → s3` sits at L0 alone**, not repeated in L1/L1b.

Differences inside the coverage, all of them *deeper evidence for the same
relation*:

| relation | golden label | this run | why |
|---|---|---|---|
| `q → s3` | diagnose uploads | diagnose uploads (e35 audit JSON, e46 bench artefacts) | the code has two upload paths |
| `reg → prov` | provider API | provider API (e92 gcore cluster API, e93 machine details) | same |
| `prov → mach` | allocate instance | allocate instance (e92 cluster create + e61 import) | no single call site; recorded in coverage.md §“Known imprecision” |
| `mch → boot` | iPXE request | iPXE request (e23 agent download; G-2 chainload) | the code's boot request is the agent-download GET; the golden's source said iPXE |

## 4. Description quality

| level | golden chars / rows | this run chars / rows |
|---|---|---|
| L0 | 266 / 3 | 258 / 3 |
| L1 | 251 / 3 | 259 / 3 |
| L1b | 286 / 3 | 279 / 3 |
| L2 | 283 / 3 | 267 / 3 |
| L2b | 275 / 3 | 280 / 3 |

- **Match on the constraint the engine enforces:** all five wrap to exactly
  three 96-column rows with no ellipsis (measured with the engine's own
  wrapper, not estimated).
- **Each description still does the four jobs the skill asks:** what is
  inside, what is outside, how it relates to the neighbouring level, and
  which slice it is. The wording is this run's own; it names the provider
  adapters and the audit/verify paths the scouts proved instead of the
  golden's summarised verbs. Verdict **partial**: same shape, different
  sentences, and L0 now ends with the reason L1 exists rather than the
  golden's "Nothing inside is shown yet, so L1 opens it" (which is also
  present in substance).
- **One trim the run had to catch itself:** the first draft of L1b lost its
  closing sentence ("The fleet drives these outward relations") because the
  text wrapped to a fourth row. It was restored by shortening four words
  earlier in the same sentence, not by dropping the thought: the engine's
  3-row cap is a hard constraint, and the skill's "no ellipsis" rule is what
  makes the executor notice.

## 5. The honest mismatch: the fact base

The acceptance target is **23 relations**; the scouts returned **97** from the
repository (plus 11 recorded gaps). That is not a scout error — the golden's
source document is a chat summary of a visualisation, so it describes a
simplified model of a system that in code has 48 elements (22 inside, 3
actors, 23 outside).

- **As a defect of this run:** none. Every one of the 23 scoped relations is
  drawn once, with `file:line` evidence behind it.
- **As a defect of the comparison:** the two diagrams are the same picture of
  different-resolution inputs. Calling the match "23/23" is fair only because
  the scope was fixed to the golden's relation set before generating.
- **As a defect of the skill:** real. See §6 item 1 — SKILL.md's original
  completeness rule ("every relation a scout reported appears in some level")
  is unsatisfiable on a real codebase, and the v1 run's only way to satisfy it
  was to grow 21 sections. The rule is now scope-based, with folds recorded.

## 6. What the run taught about the skill

1. **Under-specified: the ladder had no cap.** Step 3 listed five levels but
   never said a sixth was a defect, and Step 6 said "add a level" whenever a
   relation did not fit. The fresh session did exactly that: 21 sections
   (`l0`, `l0b`, `l1`, `l1b`–`l1g`, `l2a`–`l2l`), and an L0 that listed the
   neighbours per vendor instead of the component's world. Fixed: an explicit
   target-shape block, a Splitting discipline section (a level is a *depth*,
   slices capped at two per depth, a split needs a measurement), `Five
   sections` in Step 4, a "when something goes wrong" entry for
   over-splitting, and the same discipline in `prompts/levels.md` (the level
   scout is where the drift starts).
2. **Under-specified: scope vs completeness.** Old Step 6 demanded every
   scout row in a level. Real code yields 97 call-site rows for 23 element
   relations. Fixed: scope is decided in writing, call sites fold into their
   relation, the coverage map lists every fold and every excluded row.
3. **The scout protocol itself worked.** Four parallel scouts, one turn,
   `agent: "scout"`, prompts verbatim: 48 elements, 97 relations, 20
   adjudicated conflicts, 11 gaps — and the conflict register caught a claim
   the golden's source got wrong (a `boot → web` redirect that is really
   `boot → S3`, ledger C-01). The boundary scout is what made containment
   defensible.
4. **Scout failure mode found:** a scout spawned with a `cwd` different from
   the spawning session's cwd can die before it starts ("no pi process
   appeared in its pane"). The skill's Step 1 tells the executor to pass
   `cwd: <repo root>`; that is a no-op when the session already runs there
   (which is why the run's own scouts worked), and it is the documented
   hazard otherwise. Step 1 now says to launch from the repo root and treat
   this as the likely cause when a scout never starts.
5. **What the scouts missed:** the queue (`river_job`) is created by River's
   migrator, not by the component's migrations (C-06); `alerts` ships but is
   never wired (C-04, dead code); `cirrascale` has no caller (C-12); the BMC
   endpoint is a different network surface from the host OS (C-08). All four
   are recorded in `ledger.md` and none of them changes the 23-relation
   ladder — but they are the kind of thing a probe-style review would catch
   and a call-site scan nearly missed.
6. **The renderer's one visible residual survives**: container borders sit on
   the members' top row rather than one row outside it (identical in the
   golden's own 173x128 dump, same binary `fa76dde2…`). Recorded in
   `generation.json → residuals[0]`; nothing in the skill can fix it.
7. **Blind spot in the skill's checklist (now fixed):** the skill told the
   executor to inspect the render but gave no way to *prove* containment.
   This run read the border cells against the members by hand. Step 5 now
   spells the procedure out (top-border row vs each member's top-left corner,
   same for right/bottom/left), so the check is repeatable.
8. **The skill says who does what only for the scouts.** The fresh session,
   left to itself, delegated the ledger and the spec to further `worker`
   subagents — three generations deep — which is why pass v1 took over
   25 minutes and had to be stopped mid-render. Cheap fix, not applied here:
   one line in Step 2 and Step 4 saying the executor writes the ledger and the
   spec itself, and subagents are for reconnaissance only.

## 7. Where the two renders differ, line by line

`captures/canvas-text.txt` against the golden's
`evidence/canvas/canvas-whole-173x128-frames.txt` (frame 0), both bodies after
the pane header: **50 of 127 lines differ** — 16 only by a one-column shift,
34 by content.

- The content differences are the five descriptions (15 lines), two renamed
  labels (`provider registry` → `provider adapter`, `River job queue` →
  `River queue`), and the route/dot cells that follow from a narrower node.
- The column shifts are that same width change: `provider registry` is one
  column wider than `provider adapter`, so the right half of the L1 band moves
  left by one.
- Node count, edge count, rank order, arrow topology, container positions and
  dot placement are otherwise identical, and the L1b box's border offset
  differs by the same one column (`126x17` here, `130x17` in the golden).

## 8. Follow-up (not done here)

The c4 skill has **no test coverage**: `scripts/test-rataflow.py` validates the
`visualize` and `artifact` skills only (`skill spec block schema`,
`skill frontmatter`). A `scripts/test-c4-skill.py` entry with a `# Paths:`
header — frontmatter present, four prompts present, a ladder describing
exactly the five sections in `SKILL.md`'s target shape — would catch the drift
that caused pass v1. Both required runners stay green without it.
