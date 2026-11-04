# pipeline — round 01 generation (DeepSeek)

Generator: pi subagent worker `viz-ds01-pipeline`, model
`fireworks/accounts/fireworks/routers/deepseek-flash-latest` (provider `fireworks`,
reasoning level `high`), read from this session's `PI_*` environment.
Worktree `/Users/aviral/.herdr/worktrees/dotfiles/fix-visualize-skill`, branch
`fix/visualize-skill`. Candidate skill invoked fresh from `../SKILL.md`
(sha256 `9c5cea27…308d92`). Renderer
`/tmp/visualize-eval/round-01/bin/rataflow-view` (sha256 `4a883e73…e3a1d8`).

## What the diagram says

The source asks for a job pipeline with the read/write split and the
authentication/queue split visible, slow sparse traffic motion, semantic tiers,
related shades inside a tier, a plain background and no border dots.

One view carries all six nodes and all six relations (`tb`):

```
CLI ──request──▶ API gateway ──verify──▶ Auth ──read──▶ Postgres
                       └────enqueue───▶ Job queue ──dispatch──▶ Worker pool ──write──▶ Postgres
```

The final spec is `spec/view1.json`, identical to `attempts/view1-attempt3.json`:

```json
{
  "direction": "tb",
  "theme": "gruvbox",
  "nodes": [
    { "id": "cli", "label": "CLI" },
    { "id": "api", "label": "API gateway" },
    { "id": "auth", "label": "Auth" },
    { "id": "queue", "label": "Job queue" },
    { "id": "worker", "label": "Worker pool" },
    { "id": "db", "label": "Postgres" }
  ],
  "edges": [
    { "from": "cli", "to": "api", "label": "request", "flow": 0.2 },
    { "from": "api", "to": "auth", "label": "verify", "flow": 0.2 },
    { "from": "api", "to": "queue", "label": "enqueue", "flow": 0.2 },
    { "from": "queue", "to": "worker", "label": "dispatch", "flow": 0.2 },
    { "from": "worker", "to": "db", "label": "write", "flow": 0.2 },
    { "from": "auth", "to": "db", "label": "read", "flow": 0.2 }
  ]
}
```

Two relations are historically unlabeled. They carry neutral verbs only
(`request`, `dispatch`); no protocol, transport or API name is invented.
`verify` is the brief's own gloss for `api -> auth`. `write` and `read` stay
separate: different source boxes, different columns, different ports into
Postgres, different labels — neither is dropped, reversed or merged.

## Check

```
$ /tmp/visualize-eval/round-01/bin/rataflow-view --check spec/view1.json
ok: nodes=6 edges=6 flows=6 direction=tb theme=gruvbox
extent=36x40 cells
exit=0, stderr empty
```

No density warning, no shared-corridor warning, no skipped label.

## Measured viewport and render

- Target 77 columns x 47 rows; measured **47 rows x 77 columns** with `stty size`
  inside the viewer pane before the viewer started. Target met.
- Extent 36x40 cells, so the graph fits at natural 100 %; no `f`, scroll, zoom,
  pan or drag was used, and the `graph overflows` badge never appeared.
- Header verified in every capture: `rataflow-view · view1.json · 6 nodes ·
  6 edges · 6 flows · drag pan · scroll`.
- Six node boxes, all five to thirteen cells wide and four rows tall (>= 4x4),
  all four sides and corners complete, one border colour per box, no dot on any
  border or inside any box, one background colour across all 3619 cells
  (`40,40,40` — plain, shared with the boxes).
- Layer hues: CLI `216,166,87`, API gateway `125,174,163`, Job queue
  `211,134,155` and Auth `226,156,175` (related pinks, one layer),
  Worker pool `169,182,101`, Postgres `125,160,184`.
- All six arrowheads sit on the target's top border with a visible stem from the
  source's bottom border; every edge label is drawn.
- Motion: `flow: 0.2`; three timestamped frames per run show dots advancing about
  three cells per two seconds; per-edge dot spacing measured 7–14 cells.

Evidence: `captures/view1-visible.txt` (text), `captures/view1-ansi-unselected.txt`
(ANSI), `captures/view1-selected{1,2}-{visible,ansi}.txt` (API gateway and Auth
selected), `captures/view1-frame1..4.txt` and `captures/view1-live-frame1..3.txt`
(animation), `checks/view1-render-audit.txt` (box/colour audit),
`checks/view1.check.*` (stdout, stderr, exit), `checks/hashes.txt`.

## Three local attempts

| # | idea | extent | warnings | outcome |
|---|---|---|---|---|
| 1 | explicit semantic layers, Postgres alone in the last layer | 31x37 | 0 | superseded: two Postgres entries two cells apart with elbows stacked one row apart, a dot inside the auth elbow, one-cell jog on the queue drop |
| 2 | same layers, Postgres under the worker column | 31x37 | 0 | rejected: dots replaced route corners, the cli corner vanished, read/write labels floated |
| 3 | automatic placement, no explicit layers | 36x40 | 0 | **final**: balanced left/right branches, straight queue drop, separate read/write ports and labels |

Attempt 1 and 2 captures are kept (`captures/view1-attempt1-*`,
`captures/view1-attempt2-*`) so the choice is auditable.

## Remaining defects (honest)

1. **D1** — the request arrow enters the API gateway top at col 36 while the box
   spans 35–47 (centre 41); the CLI stem is also one cell left of its box centre.
   Cosmetic off-centre attachment, arrowhead attached.
2. **D2** — Postgres receives the write and read arrowheads at cols 36 and 38,
   two cells apart, with the two approach runs on the same row one cell apart.
   Ports are separate and both labelled, but the target reads as a tight pair.
3. **D3** — the `read` label sits four cells left of its own vertical, in the free
   space between the write stem and the read line; ANSI shows it touches neither.
4. **D4** — during animation a dot can cover a route corner (e.g. the enqueue
   elbow at row 20 col 23 renders as `●` instead of `╭` in
   `captures/view1-live-frame1.txt`). Frozen-renderer behaviour.
5. **D5** — the layer-0 hue equals the flow-dot and selection accent colour, so the
   CLI box always looks accent-coloured and a selected CLI cannot be told apart by
   border colour. Theme mapping; gruvbox is required by the source.

`Tab` cycles selection and never clears it, so the unselected capture came from a
fresh viewer launch.

## Coverage of split views

No split was used. One view holds six nodes and six edges, inside the skill's
budget, and `--check` reports no warning. Coverage is explicit in
`generation.json > relationship_mapping`: each of the six source relations names
its visible edge label, source stem, route and target port. If a judge wants the
two paths separated further, the natural split is a write-path view
(queue → worker → db) and a read-path view (api → auth → db); nothing in this
round needed it.

## Review and cleanup

No independent review was run: the round brief keeps judging with a
captain-owned Astra judge, so this generator spawned no subagent. Nothing here is
claimed as approved.

All four panes this generator created (`w7E:p2X`, `w7E:p3A`, `w7E:p3E`, `w7E:p3R`)
were closed — three by `herdr pane close`, the last by its own self-closing launch
command after `q`. `herdr pane get w7E:p3R` returns `pane_not_found` and tab
`w7E:tJ` holds only the generator pane `w7E:p2Q`. No cleanup failure. Leftover
`rataflow-view` processes on the host belong to other cases' generators and were
not touched.
