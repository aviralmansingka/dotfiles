# gb300-rack-software — round 01 generation (fresh DeepSeek)

Live evaluation sample, not a CI step. Read-only on everything outside this
directory: no renderer, skill, example, rubric, other-case, or other-round file
was edited; nothing was built, installed, or committed. No reviewer/judge was
spawned — the captain owns the separate Astra judge.

## Identity and frozen inputs

| Item | Value |
|---|---|
| Case | `gb300-rack-software` |
| Round | `01` |
| Agent | `worker` subagent `viz-ds01-gb300-rack-software` |
| Model | `fireworks/accounts/fireworks/routers/deepseek-flash-latest` (`PI_PROVIDER=fireworks`, `PI_MODEL=accounts/fireworks/routers/deepseek-flash-latest`, `PI_REASONING_LEVEL=high`) |
| Session | `…/sessions/--Users-aviral-.herdr-worktrees-dotfiles-fix-visualize-skill--/2026-11-02T08-24-41-580Z_76e4ed69-db359e76-8245c22b-2b16.jsonl` |
| Own pane / tab | `w7E:p2Y` / `w7E:tR` |
| Candidate skill | `docs/visualize-eval/rounds/01/SKILL.md`, sha256 `9c5cea272a88300644cacda52c853c7c9169eeec91f0355d3460ee8741308d92` |
| Renderer | `/tmp/visualize-eval/round-01/bin/rataflow-view`, sha256 `4a883e73b822f009c504bd21d0c2fc383067bf1b83b9791ccbda431912e3a1d8` |

The candidate SKILL.md was read fresh for this run; the globally installed skill
and its stale copy were not used, and no prior generation, layout, or critique
was read.

## Viewport

* Target: **77 columns × 47 rows**, natural 100% zoom.
* Measured: **47 rows × 77 columns** from `stty size` inside a no-focus,
  right-direction, `--ratio 0.5` split of tab `w7E:tR`
  (`captures/dims-probe-raw.txt`, `captures/dims-probe.txt`,
  `captures/split-dims-probe.json`).
* Herdr reports `viewport_rows: 49` for the pane widget; the PTY the viewer
  draws into is 47 rows. No relabelling: the captures are 77×47 grids
  (`color-audit.py` prints `grid: 77 cols x 47 rows` for every final capture).
* No pan, no zoom, no `f`. Nothing was cropped to hide a defect; all four final
  graphs fit inside the pane (`--check` extents 69×18, 41×14, 68×11, 37×37).

## Relationships (stated before drawing)

Direction is `from` = the actor/consumer, `to` = the thing acted on:

* `nv-rms → OOB LAN` — the management node is a **client** on the out-of-band
  network (line 277), not part of it.
* `OOB LAN → Compute BMC / NVSwitch BMC / Power shelf` — physical drops of one
  management rail to independent hardware endpoints (line 271/277). The rail
  carries power, fan/temp/power telemetry, serial console and OS re-imaging.
* `OOB LAN → NVOS` — historical drop, **unconfirmed** (line 283 puts NVOS off
  nv-rms and the BMC as the tray's OOB endpoint).
* `NVOS → NMX-C/T` — NVOS hosts the NVLink fabric software, `NMX-C gRPC` on the
  nv-rms southbound path (line 283).
* `nv-rms → Compute BMC / Power shelf / NVOS` — direct controller API calls:
  `Redfish` for BMC and power shelf, `NVUE REST` for the NVSwitch tray through
  NVOS (line 277/283). These three are **added from the correction at line
  283**, not from the historical 11-edge graph.
* `Kubernetes → GPU Operator` — the operator runs over Kubernetes (line 277).
* `GPU Operator → DCGM` — DCGM ships as a `DaemonSet` (line 277).
* `DCGM → dcgm-exporter` — the exporter serves Prometheus metrics on `:9400`
  (line 277). Read-out direction, not deployment.
* `DCGM → Driver+CUDA` — DCGM **reads** GPU state via `NVML` against the driver
  (line 277). Explicitly not a deploys/manages edge.
* `Driver+CUDA → Fabric Mgr` — colocation on the compute host only. The
  excerpts give no protocol, so the label asserts nothing beyond the fixed
  constraint that both run on the host, not on the GPU die.

Paid-only software (Mission Control, BCM, UFM, NetQ) and entitlement-gated NGC
images are absent; Slurm is absent because the source dropped it as adding no
distinct edge. No view implies the gated NGC image is free.

## Views

| View | Spec | Dir | Nodes/Edges | Extent | Pane | Capture |
|---|---|---|---|---|---|---|
| v1-rail — off-rack nv-rms on the OOB rail | `specs/v1-a4-rail-lr.json` | lr | 5 / 4 | 69×18 | `w7E:p3D` | `captures/v1-a4-unselected.{txt,ansi}` |
| v2-rms-api — nv-rms southbound control | `specs/v2-a2-rms-api.json` | tb | 4 / 3 | 41×14 | `w7E:p3V` | `captures/v2-a2-unselected.{txt,ansi}` |
| v3-nvswitch — tray BMC vs NVOS/NMX | `specs/v3-a3-nvswitch-lr.json` | lr | 4 / 3 | 68×11 | `w7E:p43` | `captures/v3-a3-unselected.{txt,ansi}` |
| v4-inband — in-band compute stack | `specs/v4-a2-inband.json` | tb | 6 / 5 | 37×37 | `w7E:p4C` | `captures/v4-a2-unselected.{txt,ansi}` |

Every view also has a selected-node capture (`*-selected.txt`, `*-selected.ansi`):
selection repaints only the selected node's border in the accent colour, so the
plain-text files are byte-identical while the ANSI files differ.

### Commands (identical shape per view)

```sh
# split, no focus, even half of my own tab
herdr pane split --current --direction right --ratio 0.5 --cwd "$PWD" --no-focus
# self-closing viewer: quitting the app removes the pane
herdr pane run <pane> "stty size; /tmp/visualize-eval/round-01/bin/rataflow-view $PWD/specs/<spec>.json; herdr pane close <pane>"
herdr pane read <pane> --source visible > captures/<view>-unselected.txt
herdr pane read <pane> --source visible --format ansi > captures/<view>-unselected.ansi
herdr pane send-keys <pane> Tab
herdr pane read <pane> --source visible --format ansi > captures/<view>-selected.ansi
herdr pane send-keys <pane> q      # app exits, its own trailing close removes the pane
```

Header verified in every capture, e.g.
` rataflow-view · v1-a4-rail-lr.json · 5 nodes · 4 edges · 0 flows · drag pan`.
No `graph overflows` badge appears in any capture.

Timestamps (UTC): v1 split `08:26:03Z`, captures `08:26:44Z`; v2 split
`08:27:16Z`, captures `08:27:32Z`; v3 split `08:28:00Z`, captures `08:28:12Z`;
v4 split `08:28:43Z`, captures `08:29:04Z`; `--check` batch `08:29:32Z`; dims
probe `08:29:27Z`; feature probe `08:29:49Z`. Per-view launch windows are in
`generation.json`.

## Checks

`--check` on the four final specs: **exit 0, no warnings**, all extents inside
77×47 (`captures/check-*.txt` carries command, timestamp, stdout/stderr, exit).

`color-audit.py` (parses the ANSI captures into a cell grid) reports for every
final capture: uniform border colour per box, no off-colour border cell, no
arrow or dot glyph on a border, zero flow dots. Layer hue families: V1
orange / teal / three pink shades; V2 orange / three teal shades; V3 orange,
teal pair (the tray's two endpoints), pink; V4 orange / teal / pink / two olive
shades / blue. Selection paints the chosen node's border accent orange
`rgb(216,166,87)` — the same RGB as the first layer family, so a selected node
can read like a layer-0 node. Reported, not fixed (that is renderer behaviour).

No arrow glyph is adjacent to a letter in any final capture. The rejected
`attempts/v4-a1-inband.json` had `serves :9400▼`; the final v4 spec adds a layer
gap so the label no longer touches the arrowhead.

## Blocker: the requested single OOB trunk that splits once

The user asked for **one** OOB arrow that splits in exactly one place (line
284), and the fixed constraints make that mandatory. The frozen renderer cannot
express it:

* the spec schema has no trunk, junction, merge, or edge-group primitive
  (`--help`: `direction`, `theme`, `nodes`, `edges`; edge fields `from`, `to`,
  `label`, `flow`); `style` is rejected as an unknown field
  (`captures/probe-feature-surface.txt`);
* every edge receives its own port and its own A*-planned corridor with no
  shared runs, so three drops render as three separate lines from three ports —
  visible in all four v1 attempts and in the final capture (exits at rows
  17/19/21, separate corridors to columns 56/54 and to the three boxes).

v1 therefore shows the honest fan-out and the blocker is recorded rather than
faked. Additional unsupported (and therefore blocked, not invented) needs:

* **no edge-kind encoding** — physical reachability vs controller API call is
  carried by label wording and by view separation only (no dash/category/legend
  channel);
* **no grouping** — "runs on compute hosts" cannot be a boundary, only the
  `same host` label;
* **no negative relationship** — `OOB does not reach DCGM` is guaranteed only by
  the absence of such an edge in every view.

## Defects that remain

* **v1**: three ports stand in for the split-once trunk; the three drops share
  the identical label `power serial`; two corridors turn at adjacent cells
  (row 19: `╮` col 56, `╰` col 57) and can be misread as a junction; the
  nv-rms arrow enters the OOB LAN's left border two rows above the box centre.
* **v2**: two edges carry the identical label `Redfish`, and the lower one sits
  below its corridor instead of above it.
* **v3**: `reach hist.` sits between the NVSwitch BMC and NVOS corridors on the
  arrow row, so which drop it labels is ambiguous.
* **v4**: `serves :9400` sits beneath the Driver+CUDA corridor and just above
  dcgm-exporter's top border; association needs tracing. The control palette
  occupies rows 41-43 beside the graph but covers nothing.

Attempts are listed with their rejection reasons in `generation.json`
(`prior_attempts`); both label-warning attempts (`v2-a1`, `v3-a2`) were fixed by
shortening or reordering, never by deleting an edge or dropping a label.

## Cleanup

Nine panes were created and all nine are closed (`w7E:p35`, `w7E:p3B`, `w7E:p3D`,
`w7E:p3V`, `w7E:p3Z`, `w7E:p43`, `w7E:p47`, `w7E:p4C`, `w7E:p4K`); each viewer
pane ran the self-closing command and exited with `q`, the size probe pane was
closed explicitly. `herdr pane list` confirms tab `w7E:tR` holds only my own
pane `w7E:p2Y`. No captain pane, no raw tmux. A `rataflow-view` process for
another case's spec (`v2-host-nics.json`, pid 85639) and other agents' panes in
other tabs belong to parallel generators and were not touched.

## Status

Not green, no independent approval claimed. Four honest views, clean
`--check`, captured unselected and selected states, zero animation frames
because the source requests none, and one hard blocker (the split-once OOB
trunk) recorded with evidence.
