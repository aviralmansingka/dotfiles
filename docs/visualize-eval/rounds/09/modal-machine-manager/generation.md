# modal-machine-manager — round 09 generation

Worker `viz-ds09-6`, model `fireworks/accounts/fireworks/routers/deepseek-flash-latest`.
Candidate skill `docs/visualize-eval/rounds/09/SKILL.md` sha256 `ba2878c5…431381`.
Renderer `/tmp/visualize-eval/round-09/bin/rataflow-view` sha256 `405a61a6…6db495b`,
used by absolute path in every check, capture and dump.

Not green. Two of four views miss the 77×47 target and three relations plus one
component are not drawn. Details in *Known defects*.

## Step 0 — family

```
family: lifecycle-machines
evidence: one queue node fans to five phase targets (River jobs -> provider
          registry, SSH/BMC ops, janitor, S3, Postgres) while the machine side
          advances in a fixed stage order (enqueue -> provision -> allocate ->
          iPXE boot -> image pull -> agent heartbeat -> state write), and the
          chat's final correction is "one dot alive per line".
```

Tie-breakers considered: E>N argues mesh/fabric, but the density is one 5-way
phase fan rather than pairwise service edges; there is no double-arrowhead
redundancy and dots are explicitly requested, so not a fabric; no source-named
bus between disconnected worlds, so not placement-planes. Secondary recipe
applied: **service-meshes**, only for the single anti-parallel boot handshake
(`mch → boot` iPXE request / `boot → mch` boot.ipxe + S3 args) — both directions
drawn in **one** view (v2) as two distinct routes with distinct arrowheads.

## Views

| view | role | nodes | edges | extent | fit 77×47 | check |
|---|---|---|---|---|---|---|
| v1 | provisioning spine (phases 1–5) | 6 | 5 | 48×44 | yes | clean: 0 crossings, 5/5 labels, 5/5 origins |
| v2 | boot phase (phases 6–7) | 5 | 5 | 52×53 | **no, 6 rows over** | clean apart from fit |
| v3 | state/ops writes (phases 8–10) | 7 | 5 | 80×31 | **no, 3 cols over** | 1 label skipped |
| v4 | ops loop | 6 | 5 | 54×42 | yes | clean: 0 crossings, 5/5 labels, 5/5 origins |

Every edge: `dots: 1` + `flow: true` (constant 0.5 cells / 100 ms — the source
gives no rate and never asks for synchronized arrival). All four views carry a
21-frame capture; frame 0 puts every dot on its arrow origin (`origins: N/N`)
and frames advance every dot by the same cell count.

## Family recipe per view (phase ranks, one dot per line)

- **v1** — six ranks in the source's own provisioning order, read top to bottom.
  Capture `evidence/v1/v1-77x47.txt`: control plane (line 6) → private gRPC
  (line 14) → River job queue (line 22) → provider registry (line 30) →
  bare-metal providers (line 38) → bare-metal machines (line 46); the five dots
  sit on lines 9/17/25/33/41 at frame 0 and on lines 106/114/122/130/138 at
  frame 2 — the same one-cell advance on every route.
- **v2** — machines above the boot rank; the anti-parallel handshake is two
  routes in this one view. Capture `evidence/v2/v2-text.txt`: `boot.ipxe + S3
  args` (line 14) labels the downward run from the boot rank into bare-metal
  machines while `iPXE request` (line 16) labels the separate upward run —
  two routes, two arrowheads, one view.
- **v3** — one rank of phase-writers above the state/ops rank; each of the five
  routes descends with exactly one dot.
- **v4** — four pinned ranks in the source's ops order; `proposed actions`
  returns upward from janitor to webapi with its direction preserved.

## Structural levers (each with its source fact)

| view | groups (logical tags, nothing drawn) | rank pins | `minlen` | trunks | `label_slot` |
|---|---|---|---|---|---|
| v1 | control (cp, pgrpc, q), provision (reg, prov), hosts (mch) | none — longest-path ranking already equals the phase order | none | none — no shared bus on this path | all 5 edges; each gap has one band and each source is alone in its rank |
| v2 | hosts, control, provision, state | none | none | none — five independent relations | none — banding the fan failed routing (v2-b), so the gap carries the text |
| v3 | hosts, control, ops, provision, state | none | none | none — five different writers of five different facts | none — five bands from three sources cover each other's ports |
| v4 | control, ops, hosts, humans | `layers=4` pins [wapi] [q] [jan,ssh] [mch,slack] — the source states this ops order ("janitor proposes actions back through webapi") | none | none | `wapi→q` (21 chars) and `q→jan`; one band per gap, source alone in its rank |

`label_slot` was probed before use (`probes/probe-cal*.json`): the same 20-char
label costs 30 rows in-gap and 12 rows with a band. Bands are the reason v1 and
v4 fit at all; they are also the reason three earlier drafts failed routing.

## Ledger and audit

Full tables are in `generation.json` (`meaning_ledger`, `relationship_audit`).
Abbreviations: `reconcile loop` ← cluster reconcile loop; `audit / reimage` ←
audit / verify reimage; `machine-audit` ← run machine-audit; `diagnostics` ←
diagnostic events. Nothing was reversed or weakened; the three missing
relations are missing entirely, not hidden.

## Coverage

`v1` cp→pgrpc, pgrpc→q, q→reg, reg→prov, prov→mch · `v2` mch→boot, boot→mch,
mch→s3, mch→agent, q→s3 · `v3` agent→pub, q→db, q→ssh, rec→db, rec→prov ·
`v4` wapi→q, q→jan, jan→wapi, wapi→slack, ssh→mch.

Drawn: **16/17 components, 20/23 relations**. Missing: `web` and the relations
`web→wapi` (http), `pgrpc→db` (machine rows), `pub→db` (machine state).

## Attempts (3 candidates per view, 14 recorded runs)

`attempts.json` lists every candidate with its sha256; `attempts-log.jsonl`
holds the raw command, exit status and stdout/stderr for all 14 runs
(12 view candidates + 2 capability probes). What the attempts proved:

- One band per rank gap works; two or more bands from one source kill ports
  (`v1-b`: 4 routes unrouted; `v2-b`: 3 routes unrouted).
- A wide (20–23 char) band placed on a rank's port row can take out a sibling's
  port (`v1-a`: `web → wapi` unrouted).
- lr two-area fans with in-area labels have no horizontal corridor left: every
  return edge died (`v3-b`, `v3-c`, `v4-a`).
- A two-rank tb fan is the reliable fan shape, but its gap costs
  (widest label + 3) rows, which is why the boot view cannot reach 47 rows
  (`v2-a` 39×59, `v2-c` 52×53).

## Known defects

1. **D1 — v2 fit.** extent 52×53 vs 77×47. `evidence/v2/v2-77x47.txt` lines 4,
   52, 100: `graph overflows · drag to pan`.
2. **D2 — v3 fit.** extent 80×31 vs 77×47. `evidence/v3/v3-77x47.txt` lines 5,
   53, 101 show the same banner.
3. **D3 — v3 label.** `register + heartbeat` skipped (`labels: 4/5 placed`,
   warning line in `evidence/v3/check.txt`).
4. **D4 — coverage.** 16/17 components, 20/23 relations (above).

## Validator

`scripts/viz-validate.py evidence/vN --require-select --require-frames
--require-records --attempts attempts.json`, full output per view in
`evidence/vN/validator.txt`:

- v1: **all checks passed**
- v2: `1 check(s) failed: viewport_matches_target`
- v3: `4 check(s) failed: check_warnings_absent, labels_complete,
  labels_not_skipped, viewport_matches_target`
- v4: **all checks passed**

## Cleanup

Four panes opened by `viz-evidence.sh`, four closed; every manifest records
`cleanup: confirmed_closed`. No other tab touched, no raw tmux, no commits,
no installs, no renderer or skill edits.
