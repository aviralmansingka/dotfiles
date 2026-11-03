# network — round 11 generation report

Case: `network` (rerun; round 10 failed it on fan order). Generator: `viz-ds11-2`,
model `fireworks/accounts/fireworks/routers/deepseek-flash-latest`.
Frozen inputs: skill `docs/visualize-eval/rounds/11/SKILL.md`
`fb975dbe337bee801dc098f58695e0068cb1b2d7d79f34c0e473e24a1626cd4e`,
renderer `/tmp/visualize-eval/round-10/bin/rataflow-view`
`db70722b92777467544b8ac0c9f03c52d48706e21f604e47da084cb0dfb92df8`.

## Step 0 — family

```
family: service-meshes
evidence: one core switch fans to two downstream tiers (core->web, core->cache)
          and the web tier fans to two services (web->cache, web->db); the source
          keeps core->cache and web->cache separate, so the fan's port order
          carries the meaning.
```

Tie-breakers: flow-chains rejected (E=7 > N=6, two fans, no one-relation-per-node
chain), redundant-fabrics rejected (no redundant parallel links, no
double-arrowhead tiers, and the source wants dots), lifecycle-machines rejected
(no phase order), placement-planes rejected (one connected world, no splitting
bus), identity-probe-maps rejected (no addresses/ports/qualifiers).
Secondary recipe applied: flow-chains for the short WAN->firewall->core spine.

## Ship: one view

`v1.json` — tb, gruvbox, 6 nodes, 7 edges, 5 pinned ranks
`[wan][fw][core][web,cache][db]`, `label_slot` on e1, e2, e5, e6.

```
check: extent 31x44 | crossings 0 bridges, 0 touching bends
       labels 7/7 placed, 0 on route cells, 0 skipped, 0 ambiguous owners
       groups ingress(2) switching(1) compute(1) data(2)
       dots 4 single-dot routes, 0 violations, 4 constant at 0.5c/step
       origins 4/4 | arrivals 0/0 | no warnings
```

Layout (pinned 77x47 dump, 0-based x,y):

```
WAN(37,3) --port(38,6)-- "1 GbE"(40,6) --> Firewall(34,11)
Firewall --port(37,14)-- "10 GbE"(40,14) --> Core switch(33,19)
Core switch dots (37,22) and (39,22) fan out:
   left  "10 GbE"(30,25) --> Web tier(29,32)     head (32,30)
   right "25 GbE"(41,25) --> Redis(42,32)        head (44,30)
Web tier --(38,32)->(39,32)▶(40,32)-- Redis      "session"(36,35)
Web tier (32,35) --> DB tier     "queries"(34,37)  head (37,41)
Redis    (44,35) --> DB tier     "fill"(39,38)     head (39,41)
```

The fan's ports match the source listing (web left, Redis right — round 10's
fail). Both inbound links to Redis are separate edges with their own labels and
ports. DB tier takes two arrowheads at two separate ports, (37,41) and (39,41).

## Motion

4 routes animate (core->web, core->cache, web->db, cache->db), constant mode
0.5 cells/100 ms. Longest route 14 cells → 28 frames required, 30 rendered.
Frames 0→10: every dot advances 5 cells (uniform). core->web/cache complete a
12-cell animatable lap (frame 0 cell 1, frames 20-21 cell 12, frame 22 wrap).

Three hops are static (`dots: 0`): wan->fw, fw->core, web->cache. Their
animatable path is 2 cells; measured frames show the dot alternating between two
cells and never reaching the arrowhead. Skill Step 6 invariant 3 → drawn static,
reason recorded (deviation D4).

## Deviations (all recorded with reasons + capture)

| id | deviation | reason |
|---|---|---|
| D1 | fan laid out with `layers` rank pins | auto ranking pushes Redis a rank below Web through web->cache, turning the fan into a chain (29x67, 27x45 measured); round 10 failed this case on fan order |
| D2 | no anti-parallel pair drawn or split | the source states no reverse relation between any pair; both Redis links and both DB links are separate forward relations |
| D3 | link speed never maps to dot speed | fixed constraint forbids implying motion speed is a measurement |
| D4 | 3 hops static | too short to show motion (2-cell animatable path) |
| D5 | `label_slot` on 4 of 7 edges | all-7 gutters measured 1 ambiguous label owner; mixed layout reads better at 31x44 |
| D6 | tb, not lr | lr refuses to route web->cache: exit 1, "no obstacle-safe route for web -> cache" |

## Levers and their source facts

- `groups`: ingress{wan,fw}, switching{core}, compute{web}, data{cache,db} — the
  source's own tiers. Four hue families verified in `v1-ansi.ansi` border
  foregrounds (183;206;115 / 203;219;153 | 206;161;115 | 115;161;206 |
  206;115;206 / 219;153;219) — collision-free.
- `layers`: 5 pinned ranks = the source's tier order; check reports
  `pins: 6 pinned, 0 conflict(s)`.
- `label_slot`: e1, e2, e5, e6 — keeps those labels beside their routes instead
  of costing a 9-10 row rank gap, which is what makes 77x47 fit.
- `minlen`: none (no source-described corridor; it would fight the pins).
- `trunks`: none (no shared bus that splits; inventing one would fabricate a
  topology).
- `dots`: 1 on the four routes with real travel, 0 on the three 2-cell hops.

## Evidence

- bundle `evidence/v1/`: `check.txt`, `v1-text.txt`, `v1-ansi.ansi`,
  `v1-selected.ansi`, `v1-frames.txt` (19 timestamped frames visible in pane
  scrollback), `v1-frames.ansi`, `manifest.json`, `bin.sha256`,
  `v1-pinned-77x47.txt`, `v1-frames-pinned-77x47.txt` (30 frames, pinned
  77x47).
- measured live viewport: **82x51 @100%** (half of a 168-column tab). Fit at the
  target proven by the pinned natural-zoom 77x47 dump of this final spec (no
  overflow banner, extent 31x44).
- `attempts.json` (3 candidates for v1, 10 probes listed under
  `abandoned_shapes`) and `attempts-log.jsonl` (25 raw records — 3 candidates +
  22 probes, every probe and rejected draft via `viz-evidence.sh record`).
- validator: `validator-v1.txt` (first run: 1 fail, `viewport_matches_target`,
  because `generation.json` — which the pinned-dump rule reads — did not exist
  yet) and `validator-v1-final.txt` (**all checks passed**).

## Defects / caveats

- Live pane measures 82x51 > 77x47 target (environment; fit proven by pinned
  dump, not relabelled).
- The engine keeps dots off corners and arrowheads, so the two 14-cell fan dots
  wrap from cell 12 to cell 1 without touching the head. No check violation;
  same-arrival mode is not used, so touching is not required.
- One capture raced the render and was redone with no spec change (pane
  w7E:pTA, replaced by w7E:pTD).
- No blockers, no capability gaps, no dropped source facts. Only chat-line 48's
  pane-split request and chat-line 5's skill-design request are dropped, both
  with reasons.
- Cleanup: panes w7E:pT2 (manual), w7E:pT3, w7E:pTA, w7E:pTD — all closed,
  manifests say `confirmed_closed`, `pane get` answers `pane_not_found`.

## Spec note

The three static hops keep `"flow": true`, which is inert at `"dots": 0` — the
renderer animates only routes that carry a dot, and the check line says
`4 constant routes`, not 7. The flags were left as-is so the shipped spec
sha256 (`ce5e36bb…`) still matches every artifact in the bundle.
