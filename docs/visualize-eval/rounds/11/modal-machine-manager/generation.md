# modal-machine-manager — round 11 generation (viz-ds11-6)

Model: `fireworks/accounts/fireworks/routers/deepseek-flash-latest`.
Frozen binary `/tmp/visualize-eval/round-10/bin/rataflow-view`
(sha256 `db70722b…b92df8`), candidate skill `docs/visualize-eval/rounds/11/SKILL.md`
(sha256 `fb975dbe…626cd4e`, proposal 10). Neither was modified.

## Step 0 — family

```
family: lifecycle-machines
evidence: one machine-manager lifecycle reads in a single phase order
          (control plane -> private gRPC -> River jobs -> provider registry ->
          bare-metal providers -> bare-metal machines -> iPXE boot ->
          machine-agent heartbeat -> Postgres), the widest fan is five out of
          one node (River jobs -> reg/db/ssh/s3/jan), and the source asks for
          one slow dot per live line.
```

Secondary recipe: **service-meshes**, for the single anti-parallel pair — e8
`machines -> boot server` ("iPXE request") and e9 `boot server -> machines`
("boot.ipxe + S3 args") are two distinct edges at two ports in the same view
(v2), never one bidirectional arrow, never split across views.

Tie-breakers: E=23 > N=17 rules out flow-chains; the anti-parallel pair is a
mesh signature but the mesh wants a 2–3 fan around a core while the queue fans
to five; no source-named bus between two disconnected worlds (not
placement-planes); the identifiers are plain component names (not an
identity-probe map); dots are requested on a wide fan (the skill's motion
tie-breaker).

## Views (all `direction: tb`, `theme: gruvbox`, constant-speed dots)

| view | spec | carries | measured | crossings | labels |
|---|---|---|---|---|---|
| v1 provisioning | `specs/v1-provision-att3.json` | cp→pgrpc→q→reg→prov→mch (e1,e3,e5,e6,e7) | 82x51 pane, 52x44 extent | 0 | 5/5, 0 ambiguous |
| v2 boot + heartbeat | `specs/v2-boot-heartbeat.json` | mch↔boot, mch→s3, mch→agent→pub→db, pgrpc→db (e8,e9,e10,e11,e12,e13,e17) | 82x51, 41x36 | 0 | 7/7, 0 ambiguous |
| v3 slow ops fan | `specs/v3-ops-att3.json` | q→ssh→mch, q→s3, q→jan (e15,e16,e18,e19) | 82x51, 63x21 | 0 | 4/4, **1 ambiguous** |
| v4 console + reconcile | `specs/v4-humans-reconcile-att2.json` | web→wapi→q→db, jan→wapi→slack, rec→prov/db (e2,e4,e14,e20,e21,e22,e23) | 82x51, 62x30 | **3 bridges** | 7/7, **1 ambiguous** |

Coverage: **17/17 components, 23/23 relations**, each relation drawn exactly
once (see `coverage_map` and `relationship_audit` in `generation.json`).

Levers used: `group` tags (no box, no border, no title) for six source tiers;
`label_slot` on every labelled edge — without it the same six-rank spine
measured 52×93 (v1 attempts 1 and 2), so it is the single lever that makes the
case fit at all; `dots: 1` on 20 live routes, static on the two structural
handoffs (e3, e6) and the residency fact e10; no trunks and no `minlen`
because the source names no shared bus and no corridor.

## Yields (measured)

- **one 10-rank spine**: impossible at 77×47. lr six ranks = 123×7
  (`recorded/probe-lr-6chain`); tb six ranks = 52×93 without `label_slot`
  (v1 att 1–2) and 52×44 with it (v1 att 3). The spine is therefore split v1/v2
  and the phase order is carried per view plus the coverage map.
- **one dot per live line, sparse**: 20 animated routes; 3 static.

## Motion

Constant mode (0.5 cells/100 ms step) everywhere. Origins 3/3, 6/6, 4/4, 7/7.
Every dot advances exactly one cell per two steps (frame 0 → frame 2 in each
pinned dump). Full 48-frame lap proof per view in `pinned/<view>-77x47.txt`.

**Engine defect (recorded, not chased):** v1's routes are 2 cells long after
`label_slot` compression, so each dot cycles between its first two cells
(frames 0–3: (7,38),(7,38),(8,38),(8,38) then back) instead of traversing —
the round-10 v1 oscillation, reproduced. In v2 the same effect appears only on
the 2-cell ports of the boot pair.

## Remaining defects

1. v3: one ambiguous-owner label — the engine writes a leftward fan branch's
   label to the right of its route, so "diagnostic events" lands on the S3 run.
   Three attempts (4 targets, 3 targets, re-ordered targets) reproduce it.
2. v4: one ambiguous-owner label ("gcore sync, 1 min" between the two reconcile
   routes) and 3 bridges between the three sources and the console rank.
3. v1: the 2-cell dot oscillation above.
4. All views: the in-pane `--frames` capture stops at 19 of 48 frames (pane
   snapshot lag); the pinned 77×47 dumps carry the lap proof.

## Blockers (environment)

- `scripts/viz-evidence.sh` waits 1 s for the app header; panes here surface
  output ~1.5 s after launch (6–8 s while the tab is unfocused), so the first
  captures were shell echoes. Captures were re-run with this generator's tab
  focused (`herdr tab focus w7E:tAN`) and focus was returned to the captain tab
  `w7E:t1`. **No repository file, script, spec input, binary or validator was
  modified.**
- The live pane measures 82×51, not 77×47; fit at the target is proven by the
  pinned direct dumps (`pinned/<view>-77x47.txt`, natural zoom, no overflow).

## Validator

`validator-output.txt`. v1 and v2 pass every check. v3 and v4 fail exactly
`check_warnings_absent` + `labels_ownership_clear` (the ambiguous label
above); every other check passes, including the pinned-dump fit proof, frames,
select-all, records log and the 3-candidate-per-view budget.

No independent review was run and this bundle is not marked green.
