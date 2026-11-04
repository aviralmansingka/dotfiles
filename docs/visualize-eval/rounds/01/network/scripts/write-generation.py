#!/usr/bin/env python3
"""Write generation.json for the round-01 network sample from the captured evidence."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CASE = ROOT
SKILL = Path("/Users/aviral/.herdr/worktrees/dotfiles/fix-visualize-skill/docs/visualize-eval/rounds/01/SKILL.md")
BIN = Path("/tmp/visualize-eval/round-01/bin/rataflow-view")


def sha(p: Path) -> str:
    h = hashlib.sha256()
    h.update(p.read_bytes())
    return h.hexdigest()


def rel(p: Path) -> str:
    return str(p.relative_to(CASE))


def read(p: Path) -> str:
    return p.read_text().replace("\r\n", "\n")


views = []
for vdir in sorted((CASE / "views").iterdir()):
    cap = vdir / "captures"
    spec = json.loads((vdir / "spec.json").read_text())
    commands = read(cap / "commands.txt").strip().split("\n")
    stamps = [l for l in read(cap / "timestamps.txt").strip().split("\n") if l]
    verify = read(cap / "verify.txt")
    arrow_lines = [l for l in verify.split("\n") if "points into" in l]
    views.append(
        {
            "view_id": vdir.name,
            "purpose": {
                "01-request-path": "request path WAN -> firewall -> core switch -> web tier -> DB tier, all three link speeds on the ingress legs plus the web->DB query relation",
                "02-core-cache-fill": "core-to-Redis 25 GbE link and the Redis-to-DB fill relation",
                "03-session-fill": "web-to-Redis session relation and the Redis-to-DB fill relation",
            }[vdir.name],
            "direction": spec["direction"],
            "theme": spec["theme"],
            "nodes": [n["label"] for n in spec["nodes"]],
            "edges": [f'{e["from"]}->{e["to"]} [{e.get("label","")}] flow={e.get("flow")}' for e in spec["edges"]],
            "spec": rel(vdir / "spec.json"),
            "spec_sha256": sha(vdir / "spec.json"),
            "check_stdout": rel(vdir / "check.txt"),
            "check_stderr": rel(vdir / "check.stderr.txt"),
            "check_exit": int(read(vdir / "check.txt").strip().split("exit=")[-1]),
            "check_summary": read(vdir / "check.txt").strip().split("\n")[:-1],
            "extent": read(vdir / "check.txt").split("extent=")[1].split(" cells")[0],
            "pane": {
                "pane_id": read(cap / "pane-id.txt").strip().split("=")[1],
                "split_command": commands[0].split(" herdr pane split", 1)[1].join(["herdr pane split", ""]),
                "split_json": rel(cap / "pane-split.json"),
                "pane_get_json": rel(cap / "pane-get.json"),
                "rect": "79x49 (herdr pane rect; includes 2 columns + 2 rows of pane chrome)",
                "command_log": rel(cap / "commands.txt"),
            },
            "dimensions": {
                "target": "77x47",
                "measured_stty_size": "47 77",
                "measured_cols": 77,
                "measured_rows": 47,
                "matches_target": True,
                "raw": rel(cap / "dims-raw.txt"),
            },
            "captures": {
                "header": rel(cap / "header.txt"),
                "unselected_text": rel(cap / "unselected.txt"),
                "unselected_ansi": rel(cap / "unselected.ansi.txt"),
                "selected_tab_text": rel(cap / "selected-tab.txt"),
                "selected_tab_ansi": rel(cap / "selected-tab.ansi.txt"),
                "selected_right_text": rel(cap / "selected-right.txt"),
                "selected_right_ansi": rel(cap / "selected-right.ansi.txt"),
                "selected_animation_frame": rel(cap / "selected-after-frames.txt"),
                "frames": [rel(cap / "frames" / f"frame-0{i}.txt") for i in (1, 2, 3, 4)],
                "frame_timestamps": rel(cap / "timestamps.txt"),
                "hashes": {
                    "unselected.txt": sha(cap / "unselected.txt"),
                    "unselected.ansi.txt": sha(cap / "unselected.ansi.txt"),
                    "selected-tab.ansi.txt": sha(cap / "selected-tab.ansi.txt"),
                },
                "verify_report": rel(cap / "verify.txt"),
            },
            "verify_result": verify.strip().split("\n")[-1],
            "arrow_evidence": arrow_lines,
            "window": {"first": stamps[0], "last": stamps[-1], "frame_interval_s": 2.5},
            "observed_render": read(cap / "unselected.txt").split("\n")[1:]
            and [
                l for l in read(cap / "unselected.txt").split("\n")[1:] if l.strip()
            ],
        }
    )

doc = {
    "case_id": "network",
    "round": "01",
    "generated_at": "2026-11-02T08:33:30Z",
    "generator": {
        "role": "fresh diagram generator in the DeepSeek lane; replaced a user-cancelled Astra-generation round; no artifact from that round was read or reused",
        "subagent_name": "viz-ds01-network",
        "model": "fireworks/accounts/fireworks/routers/deepseek-flash-latest",
        "model_env": {
            "PI_PROVIDER": "fireworks",
            "PI_MODEL": "accounts/fireworks/routers/deepseek-flash-latest",
            "PI_REASONING_LEVEL": "high",
        },
        "harness": "pi (PI_CODING_AGENT=true), Herdr session w7E, own tab w7E:tK, own pane w7E:p2R",
        "session_id": "01a19b5b-df8c-7445-a692-a034d81b3b06",
        "astra_review": "not run; separate diagram judges are captain-owned and no reviewer subagent was spawned",
    },
    "candidate": {
        "skill_path": "docs/visualize-eval/rounds/01/SKILL.md",
        "skill_sha256": sha(SKILL),
        "skill_sha256_expected": "9c5cea272a88300644cacda52c853c7c9169eeec91f0355d3460ee8741308d92",
        "renderer_path": str(BIN),
        "renderer_sha256": sha(BIN),
        "renderer_sha256_expected": "4a883e73b822f009c504bd21d0c2fc383067bf1b83b9791ccbda431912e3a1d8",
        "renderer_used_only_via": "the frozen executable; no other binary, build, or install was used",
    },
    "viewport": {
        "target": "77x47 at natural 100% zoom",
        "measured_cols": 77,
        "measured_rows": 47,
        "measurement": "stty size / tput inside each viewer pane before rataflow-view started; all three panes reported '47 77'",
        "pane_rect": "79x49 (herdr pane layout JSON), inner terminal 77x47 after chrome",
        "split": "herdr pane split --current --direction right --ratio 0.5 --cwd <case dir> --no-focus (even half split, own tab only)",
        "pan_zoom": "none; the viewer never received f, arrow-pan, or scroll input; frames show the initial 100% fit",
        "usable_graph_rows": "47 terminal rows minus 1 header row",
    },
    "views": views,
    "relationship_coverage": [
        {
            "original": "wan -> fw (1 GbE)",
            "view": "01-request-path",
            "visible_edge": "WAN -1 GbE-> Firewall, straight stem, ▼ into Firewall top border",
        },
        {
            "original": "fw -> core (10 GbE)",
            "view": "01-request-path",
            "visible_edge": "Firewall -10 GbE-> Core switch, straight stem, ▼ into Core switch top border",
        },
        {
            "original": "core -> web (10 GbE)",
            "view": "01-request-path",
            "visible_edge": "Core switch -10 GbE-> Web tier, straight stem, ▼ into Web tier top border",
        },
        {
            "original": "web -> db (queries)",
            "view": "01-request-path",
            "visible_edge": "Web tier -queries-> DB tier, straight stem, ▼ into DB tier top border",
        },
        {
            "original": "core -> cache (25 GbE)",
            "view": "02-core-cache-fill",
            "visible_edge": "Core switch -25 GbE-> Redis cache, straight stem, ▼ into Redis cache top border",
        },
        {
            "original": "cache -> db (fill)",
            "view": "02-core-cache-fill (primary) and 03-session-fill (declared duplicate)",
            "visible_edge": "Redis cache -fill-> DB tier, straight stem, ▼ into DB tier top border",
        },
        {
            "original": "web -> cache (session)",
            "view": "03-session-fill",
            "visible_edge": "Web tier -session-> Redis cache, straight stem, ▼ into Redis cache top border",
        },
    ],
    "fixed_constraints": {
        "separate_core_and_web_cache_relations": "kept as two distinct labelled edges with different sources and different views: core->cache '25 GbE' (02) and web->cache 'session' (03). They are never merged, shortened, or reversed. A single pane holding both was rendered (attempts/fanin-4node) and the frozen renderer attached web->cache to the side of Redis without an arrowhead, so the pair is shown in two focused views instead.",
        "speeds_visible_without_motion_measurement": "1 GbE, 10 GbE and 25 GbE appear as text edge labels in views 01 and 02. Every edge carries the same flow speed 0.2 (about 2 cells/second, dots >= 7 cells apart), so motion direction shows traffic direction and motion speed measures nothing. The historical request to let dot speed encode link speed is deliberately not implemented.",
        "slow_sparse_motion": "uniform flow=0.2 on all 7 edges; 4 timestamped frames per view show dots advancing roughly 5-6 cells per 2.5 s interval",
    },
    "decisions": [
        "Direction tb everywhere: lr for the 5-layer request path measured 92x8 (wider than the 77-column pane), and lr for the 3-node views measured 53x8 with one dropped edge label.",
        "Node label 'Redis cache' instead of 'Redis': it is faithful to the source (node cache = Redis) and it widens the box so the frozen renderer can place the 'session' label in view 03; with label 'Redis' the 14-column layout dropped that label (--check warning).",
        "Edge labels are copied verbatim from the source: 1 GbE, 10 GbE, 25 GbE, session, queries, fill.",
        "The graph is split into three focused views because the frozen renderer only draws a forward edge cleanly when the target box is roughly below the source; see known_defects and blockers.",
        "Full 6-node, 7-edge spec is preserved in attempts/full-graph-6node.json with its own --check output, so every relationship can be traced back to one place.",
    ],
    "known_defects": [
        {
            "id": "D1",
            "what": "every node's two connection-handle border cells (top-centre and bottom-centre in tb) are painted with the muted stroke colour 38;2;146;131;116 instead of the node's layer hue",
            "where": "all three views; see the '[NOTE] box ...' lines in each captures/verify.txt",
            "severity": "cosmetic, renderer-owned",
            "fixable_by_spec": False,
        },
        {
            "id": "D2",
            "what": "the graph occupies 17 of the 77 columns in every view, so the pane is mostly empty (nothing is clipped and no badge appears)",
            "where": "01-request-path (17x40), 02-core-cache-fill (17x24), 03-session-fill (17x24)",
            "severity": "composition, not readability",
            "fixable_by_spec": "only by adding unrelated nodes or longer labels, which would distort the diagram",
        },
        {
            "id": "D3",
            "what": "the 'fill' relation is drawn twice, in 02 and in 03, with identical direction and label",
            "where": "views 02-core-cache-fill and 03-session-fill",
            "severity": "declared duplication for label placement (a 2-node view drops its single edge label)",
            "fixable_by_spec": False,
        },
        {
            "id": "D4",
            "what": "the historical request 'dot speed represents link speed' is not implemented; motion is uniform",
            "where": "all views",
            "severity": "deliberate, required by the round's fixed constraint",
            "fixable_by_spec": "not without breaking the fixed constraint",
        },
    ],
    "blockers": [
        {
            "id": "B1",
            "what": "a single view of the whole network needs 48 rows (extent 40x48 for the 6-node 7-edge spec) and cannot fit the 47-row viewport, whose graph area is 46 rows below the header",
            "evidence": "attempts/full-graph-6node.check.txt",
        },
        {
            "id": "B2",
            "what": "the frozen renderer attaches a forward edge to the side handle of a horizontally offset target and draws no arrowhead, and it drops edge labels from very narrow layouts; every compact arrangement tested hit one of these",
            "evidence": "attempts/link-path-02-auto-5edge/text.txt (core->web enters the left border with '─' and no arrowhead), attempts/fanout-3node/text.txt, attempts/fanin-4node/text.txt, attempts/app-chain-span/text.txt, attempts/link-path-03-explicit5/check.txt (2 labels dropped), attempts/explicit-grid-2x2/text.txt",
            "consequence": "the case is delivered as three focused views with explicit coverage instead of one compact graph",
        },
        {
            "id": "B3",
            "what": "independent Astra readability review did not run in this round",
            "evidence": "captain-owned judges; the generator spawned no reviewer, per the round instructions",
        },
    ],
    "attempts": [
        {"path": "attempts/direction-probe-tb-full.json", "what": "6-node/7-edge spec, tb", "check": "extent 40x48 -> 2 rows taller than the viewport", "verdict": "rejected: does not fit"},
        {"path": "attempts/direction-probe-lr-full.json", "what": "6-node/7-edge spec, lr", "check": "extent 144x20", "verdict": "rejected: wider than the pane"},
        {"path": "attempts/full-graph-6node.json", "what": "the preserved full spec (same 7 relationships)", "check": "attempts/full-graph-6node.check.txt", "verdict": "reference only, does not fit"},
        {"path": "attempts/link-path-01-auto-4edge/", "render_text": "attempts/link-path-01-auto-4edge/text.txt", "render_ansi": "attempts/link-path-01-auto-4edge/ansi.txt", "what": "5 nodes, 4 speed links, auto layers", "render": "Web tier and Redis landed in one layer; both core edges entered side handles with no arrowhead", "verdict": "rejected: missing arrowheads"},
        {"path": "attempts/link-path-02-auto-5edge/", "render_text": "attempts/link-path-02-auto-5edge/text.txt", "render_ansi": "attempts/link-path-02-auto-5edge/ansi.txt", "what": "5 nodes, 4 speed links + session", "render": "core->web enters Web tier's left border with no arrowhead and the session stem branches off that same cell", "verdict": "rejected: detached arrowhead + false branch"},
        {"path": "attempts/link-path-02b-explicit4/", "render_text": "attempts/link-path-02b-explicit4/text.txt", "what": "explicit 4-layer placement", "render": "labels detached from stems, corner clusters, no arrowheads", "verdict": "rejected"},
        {"path": "attempts/link-path-03-explicit5/", "what": "explicit 5-layer placement", "check": "extent 14x37 with '2 edge label(s) had no free slot'", "verdict": "rejected: labels dropped"},
        {"path": "attempts/fanout-3node/", "render_text": "attempts/fanout-3node/text.txt", "what": "web->redis, web->db fan-out", "render": "both edges leave Web tier's sides, neither has an arrowhead", "verdict": "rejected"},
        {"path": "attempts/fanin-4node/", "render_text": "attempts/fanin-4node/text.txt", "what": "core,web->redis and web->db, cache->db", "render": "core->cache gets ▼, but web->cache, web->db and cache->db enter side handles without arrowheads", "verdict": "rejected"},
        {"path": "attempts/app-chain-span/", "render_text": "attempts/app-chain-span/text.txt", "what": "web->redis->db plus web->db span", "render": "session and fill are side-attached without arrowheads; label slots collide", "verdict": "rejected"},
        {"path": "attempts/explicit-grid-2x2/", "render_text": "attempts/explicit-grid-2x2/text.txt", "what": "two aligned links on an explicit 2x2 grid", "render": "stems zigzag, no arrowheads, stray dots", "verdict": "rejected"},
        {"path": "attempts/direction-probe-tb-full.json", "what": "6-node/7-edge spec in tb", "check": "attempts/direction-probe-tb-full.check.txt", "verdict": "reference: extent 40x48"},
        {"path": "attempts/direction-probe-lr-full.json", "what": "6-node/7-edge spec in lr", "check": "attempts/direction-probe-lr-full.check.txt", "verdict": "reference: extent 144x20"},
    ],
    "cleanup": {
        "panes_created_and_closed": ["w7E:p33", "w7E:p38", "w7E:p3H", "w7E:p30", "w7E:p44", "w7E:p46", "w7E:p4B", "w7E:p4J", "w7E:p4P", "w7E:p52", "w7E:p54", "w7E:p5A", "w7E:p5D"],
        "method": "each viewer ran 'rataflow-view <spec>; herdr pane close <pane-id>' and was also quit with q; every pane was verified gone via herdr pane get before the next capture",
        "owner_tab_after": "w7E:tK holds only the generator's own pane w7E:p2R (herdr pane layout checked)",
        "failures": "none",
        "side_effects": "no builds, no installs, no remote commands, no commits, no edits outside this case directory (only /tmp scratch spec files outside it)",
    },
    "files": {
        "notes": "generation.md",
        "capture_scripts": ["scripts/capture-view.sh", "scripts/verify-view.py", "scripts/write-generation.py"],
    },
}

(CASE / "generation.json").write_text(json.dumps(doc, indent=2) + "\n")
print("wrote generation.json", len(doc["views"]), "views")
for v in doc["views"]:
    print(v["view_id"], v["extent"], v["check_summary"], v["dimensions"]["measured_stty_size"])
