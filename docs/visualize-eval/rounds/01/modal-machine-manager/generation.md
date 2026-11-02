# Generation report — modal-machine-manager, round 01

Generator: `viz-ds01-modal-machine-manager` (pi worker subagent), model
`fireworks/accounts/fireworks/routers/deepseek-flash-latest`
(`PI_PROVIDER=fireworks`, `PI_MODEL=accounts/fireworks/routers/deepseek-flash-latest`, reasoning `high`).

| input | path | sha256 |
|---|---|---|
| candidate skill (fresh) | `docs/visualize-eval/rounds/01/SKILL.md` | `9c5cea272a88300644cacda52c853c7c9169eeec91f0355d3460ee8741308d92` |
| frozen renderer | `/tmp/visualize-eval/round-01/bin/rataflow-view` | `4a883e73b822f009c504bd21d0c2fc383067bf1b83b9791ccbda431912e3a1d8` |
| case source | `docs/visualize-eval/cases/modal-machine-manager/source.md` | `a41065d9ceca1ed035bfd6282f0e937abbd0034ad497a33637a76f2d8a9ebab3` |

Nothing was built, installed, committed, or edited outside
`docs/visualize-eval/rounds/01/modal-machine-manager/`.

## Viewport

Target 77 columns × 47 rows at natural zoom 1.0. Measured inside each viewer pane
with `stty size` **before** the viewer started: each pane reported `47 77`, so the
target was met exactly — no pan, no zoom, no `f`. The only keys sent to a viewer
were `Tab` (to capture the selected-node state) and `q` (to quit).

Panes were created in a dedicated no-focus tab (`herdr tab create --workspace w7E
--no-focus`), one `herdr pane split --direction right --ratio 0.5 --no-focus` per
view, and each viewer was launched with the self-closing command
`rataflow-view <spec>; herdr pane close <pane>`.

## Views (4 of a permitted 4)

| view | what it shows | spec | extent | pane | warnings |
|---|---|---|---|---|---|
| v1-provisioning | control plane / webapi → private gRPC → River queue → provider registry → providers → machines; humans + mmctl → webapi; reconcile → providers | `specs/v1-provisioning.json` | 48×45 | `w7E:p4Q` | none |
| v2-boot-image | the boot handshake in **both** directions plus image pull from S3, and `machines → machine-agent` | `specs/v2-boot-image.json` | 63×14 | `w7E:p4T` | 1 skipped label |
| v3-state-writes | heartbeat (`machine-agent → public gRPC → Postgres`) plus `private gRPC`, `River queue`, `reconcile` writes into Postgres | `specs/v3-state-writes.json` | 63×30 | `w7E:p4W` | 1 skipped label |
| v4-ops-diagnostics | River queue → SSH audits → machines; River queue → S3 diagnostic uploads; River queue → janitor → webapi → Slack | `specs/v4-ops-diagnostics.json` | 60×30 | `w7E:p4X` | none |

Every view: 9 or fewer nodes, 8 or fewer edges, 2–6 layers, `tb` orientation
(v2 was tried in `lr` and rejected — see `attempts/attempts.md`).

## Relationship coverage (23 of 23)

| # | source relation | view | how it appears |
|---|---|---|---|
| 1 | cp → pgrpc (create / terminate / repair) | v1 | "Control plane → private gRPC", label `create/terminate`, slow dots |
| 2 | web → wapi (http) | v1 | `http` |
| 3 | pgrpc → q (enqueue job) | v1 | `enqueue job`, slow dots |
| 4 | wapi → q (reinstall / reprovision) | v1 | `reinstall` |
| 5 | q → reg (provision job) | v1 | `provision job`, slow dots |
| 6 | reg → prov (provider API) | v1 | `provider API`, slow dots |
| 7 | prov → mch (allocate instance) | v1 | `allocate`, slow dots |
| 8 | rec → prov (gcore sync, 1 min) | v1 | `gcore sync 1m` |
| 9 | mch → boot (iPXE request) | v2 | `iPXE request`, slow dots |
| 10 | boot → mch (boot.ipxe + S3 args) | v2 | route over the machine's left side into its border; **label skipped by the renderer** |
| 11 | mch → s3 (pull boot image) | v2 | `pull image` |
| 12 | mch → agent (runs on host) | v2 **and** v3 | `runs on host` (deliberate duplicate, both labelled) |
| 13 | agent → pub (register + heartbeat) | v3 | `register+hb`, slow dots |
| 14 | pub → db (machine state) | v3 | route into Postgres's top; **label skipped by the renderer** |
| 15 | pgrpc → db (machine rows) | v3 | `machine rows` |
| 16 | q → db (job rows) | v3 | `job rows` |
| 17 | rec → db (cluster state) | v3 | `cluster state` |
| 18 | q → ssh (audit / verify reimage) | v4 | `audit/reimage` |
| 19 | ssh → mch (run machine-audit) | v4 | `machine-audit` |
| 20 | q → s3 (diagnose uploads) | v4 | `upload diags` |
| 21 | q → jan (diagnostic events) | v4 | `diag events` |
| 22 | jan → wapi (proposed actions) | v4 | `propose action` |
| 23 | wapi → slack (confirm + alerts) | v4 | `confirm/alerts` |

All 17 components appear: `web cp pgrpc wapi pub boot q rec ssh db s3 reg prov mch
agent jan slack` (see `component_coverage` in `generation.json` for per-view lists).
Both boot directions are drawn. The janitor → webapi proposal is present and was
never dropped to make routing easier. River-jobs → S3 diagnostics stays separate
from providers, from janitor, and from the machine image pull (different view, own
label).

## Animation

Slow, sparse dots (`flow: 0.15`) travel on eight selected communication edges:
`cp→pgrpc`, `pgrpc→q`, `q→reg`, `reg→prov`, `prov→mch`, `mch→boot`, `agent→pub`,
`pub→db`. Dots sit on edge segments only — none on a node border, none on an
arrow-attachment cell. Five timestamped frames per view are stored under `frames/`;
they are byte-distinct wherever flows exist (v4 has no flows, so its frames are
identical by design).

## Colour facts (from the ANSI captures, not from source)

Background `48;2;40;40;40`; every edge one muted stroke `38;2;124;111;100`; node
text `38;2;235;219;178`; accent `38;2;216;166;87` on flow dots and on the selected
node only. Each layer has its own hue family with related shades (v1: orange
216,166,87 / 228,184,111, pink 211,134,155, olive 189,201,124 / 169,182,101, teal
147,194,183 / 125,174,163, blue 125,160,184). Box top/bottom border rows carry only
that node's layer colour; the selected box's whole border and all four corners go
bold (see `captures/<view>.selected.ansi`).

## Known defects (kept, not hidden)

1. **v2:** the `boot → machines` reply edge has no visible label — the renderer
   skipped `boot.ipxe` (the `--check` warning). The route and its arrowhead into the
   machines box are visible.
2. **v3:** the `public gRPC → Postgres` edge has no visible label — the renderer
   skipped `machine state`. Route and arrowhead are visible.
3. **v3:** the four-way fan-in at Postgres is the densest area; three horizontal
   jogs sit in adjacent rows with one crossing hop (`⌒`). Ports are separate and
   `--check` reports no shared corridor.
4. **v1:** the `webapi→queue` S-bend sits directly beside the `private-gRPC→queue`
   bend on one row (`╭╯╭`). Arrowheads land on separate queue ports.
5. **v1:** the viewer's own banner is clipped at 77 columns after `drag pa` — app
   chrome, not graph content.
6. `machines → machine-agent` is drawn twice (v2 and v3) on purpose.

No relationship was deleted, reversed, or unlabelled to silence a warning: both
missing labels are renderer free-slot decisions, and both edges are still drawn.

## Blockers and tooling notes

- Viewport: none — 77×47 was reached exactly.
- `--check` reports only a *count* of skipped labels; which edge lost its label had
  to be found by rendering.
- Label slots are chosen from free space, not bound to their own route. That is why
  the `lr` v2 layout was rejected: `pull image` and `iPXE request` landed in the
  gaps between two adjacent parallel routes, equidistant from both.
- The v3 layout with all four Postgres writers in one row is unroutable:
  `no obstacle-safe route for rec -> db; increase node/layer spacing` (exit 1).
- `herdr pane wait-output --match 'rataflow-view · <spec>'` timed out on the banner
  (colour escapes split the match); each header was verified from line 1 of the
  visible capture instead (`checks/<view>.header.txt`).
- No independent review was run. The skills' review section is the captain's Astra
  judge, not this generator's.

## Evidence map

- specs: `specs/*.json`
- checks: `checks/<view>.check.{out,err}` + `checks/<view>.check.exit` (full stdout,
  stderr, exit code), `checks/<view>.header.txt`, `checks/<view>.spec.sha256`,
  `checks/<view>.capture.sha256`, `checks/<view>.frames.txt`,
  `checks/<view>.cleanup.txt`
- visible text: `captures/<view>.unselected.txt`, `captures/<view>.selected.txt`
- ANSI: `captures/<view>.unselected.ansi`, `captures/<view>.selected.ansi`
- dimensions: `captures/<view>.dimensions.txt` (`47 77` inside the pane)
- exact commands + pane ids + timestamps: `captures/<view>.commands.txt`
- animation frames: `frames/<view>.frame{1..5}.txt`
- attempts: `attempts/attempts.md`, `attempts/probe/*.json`,
  `attempts/checks/*.{out,err,exit}`, `attempts/probe/*_render.txt`
- capture helper: `scripts/capture-view.sh`

Selected node per view: v1 `Control plane`, v2 `machine-agent`, v3 `machine-agent`,
v4 `janitor app`.

## Cleanup

The dedicated tab `w7E:tT` was created for this case and closed at the end; each
viewer closed its own pane (`q`), and every `checks/<view>.cleanup.txt` records
`pane w7E:p4* not found`. The captain's panes and this generator's own session pane
were never touched.
