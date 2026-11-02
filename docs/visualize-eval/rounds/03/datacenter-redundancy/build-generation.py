#!/usr/bin/env python3
"""Assemble generation.json from the captured evidence bundles.

Reads only files inside this round case directory (manifests, check.txt,
validator output, attempts.json) and writes generation.json next to them.
"""

from __future__ import annotations

import hashlib
import json
import pathlib

CASE = pathlib.Path(__file__).resolve().parent
SKILL_PATH = "docs/visualize-eval/rounds/03/SKILL.md"
SKILL_SHA = "cf796bcdc527897687ec2ca19844f399c921252409b9ca7ad04fbfa1b6cc659c"
BIN_PATH = "/tmp/visualize-eval/round-03/bin/rataflow-view"
BIN_SHA = "b242b6a28e2e27934b06b7a297be638c143e5c99680495e104380cd8d9ee80f7"


def sha(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def parse_check(text: str) -> dict[str, str]:
    lines = {}
    for line in text.splitlines():
        if line.startswith("extent="):
            lines["extent"] = line.split("=", 1)[1].strip()
            continue
        key, _, rest = line.partition(":")
        lines[key.strip()] = rest.strip() if rest else ""
    return lines


VIEW_META = {
    "v1": {
        "carries": "e1-e8: 4 ISPs -> 2 MUX appliances (2 ISPs each) -> 2 core routers with cross-connect.",
        "crossing_choice": (
            "attempts: 1 (chosen). 43x23, crossings 1. The single crossing is the mux<->core "
            "K2,2 fabric itself; the source requires every MUX to reach every core, so it cannot "
            "be removed without dropping a link or reordering a source group."
        ),
    },
    "v2": {
        "carries": "e9-e16: cores -> active/standby firewall pair -> border leaves, both firewalls to both leaves.",
        "crossing_choice": (
            "attempts: 3. attempt1 with 14-char 'standby unconf' labels skipped 3 labels (warnings) "
            "-> rejected; attempt2 with 'standby?' placed 8/8 at 30x23 with crossings 4 (chosen); "
            "attempt3 reversed the within-layer order and stayed at crossings 4, so the neutral "
            "source order was kept. The 4 crossings are the two K2,2 fans sharing the firewall row."
        ),
    },
    "v3": {
        "carries": (
            "e17-e24: border leaves and rack leaves on one shared level, both spines above them, "
            "every leaf attached to both spines with ECMP."
        ),
        "crossing_choice": (
            "attempts: 3. attempt1 put racks in the same view (49x30, crossings 12) -> rejected; "
            "attempt2 is the fabric alone (49x20, crossings 9, chosen); attempt3 added a reserved "
            "slot between the BL pair and the Leaf pair (53x20, crossings 9) -> no gain, rejected. "
            "9 is the honest floor here: the source mandates spines above, border leaves and rack "
            "leaves at the same level, so the upward BL->spine fan and the downward spine->leaf fan "
            "share one corridor band. Total across v3+v4 is 10 vs 13 for the single combined view."
        ),
    },
    "v4": {
        "carries": "e25-e28: both rack leaves dual-homed to both racks.",
        "crossing_choice": (
            "attempts: 1 (chosen). 21x14, crossings 1: the leaf<->rack K2,2 is one crossing by "
            "definition and every 'dual' label is placed."
        ),
    },
}

RELATIONSHIPS = [
    # id, from, to, verb/tech (as the source states it), label rendered, style, view
    ("e1", "ispA", "mux1", "unlabeled historical relation (no protocol given)", None, "solid", "v1"),
    ("e2", "ispB", "mux1", "unlabeled historical relation (no protocol given)", None, "solid", "v1"),
    ("e3", "ispC", "mux2", "unlabeled historical relation (no protocol given)", None, "solid", "v1"),
    ("e4", "ispD", "mux2", "unlabeled historical relation (no protocol given)", None, "solid", "v1"),
    ("e5", "mux1", "core1", "x-connect", "x-connect", "solid", "v1"),
    ("e6", "mux1", "core2", "x-connect", "x-connect", "solid", "v1"),
    ("e7", "mux2", "core1", "x-connect", "x-connect", "solid", "v1"),
    ("e8", "mux2", "core2", "x-connect", "x-connect", "solid", "v1"),
    ("e9", "core1", "fw1", "active (FW1 active, FW2 standby)", "active", "solid", "v2"),
    ("e10", "core2", "fw1", "active (FW1 active, FW2 standby)", "active", "solid", "v2"),
    ("e11", "core1", "fw2", "standby (FW1 active, FW2 standby)", "standby?", "dashed", "v2"),
    ("e12", "core2", "fw2", "standby (FW1 active, FW2 standby)", "standby?", "dashed", "v2"),
    ("e13", "fw1", "bl1", "active (FW1 active, FW2 standby)", "active", "solid", "v2"),
    ("e14", "fw1", "bl2", "active (FW1 active, FW2 standby)", "active", "solid", "v2"),
    ("e15", "fw2", "bl1", "standby (FW1 active, FW2 standby)", "standby?", "dashed", "v2"),
    ("e16", "fw2", "bl2", "standby (FW1 active, FW2 standby)", "standby?", "dashed", "v2"),
    ("e17", "bl1", "sp1", "ECMP", "ECMP", "solid", "v3"),
    ("e18", "bl1", "sp2", "ECMP", "ECMP", "solid", "v3"),
    ("e19", "bl2", "sp1", "ECMP", "ECMP", "solid", "v3"),
    ("e20", "bl2", "sp2", "ECMP", "ECMP", "solid", "v3"),
    ("e21", "sp1", "leaf1", "ECMP", "ECMP", "solid", "v3"),
    ("e22", "sp1", "leaf2", "ECMP", "ECMP", "solid", "v3"),
    ("e23", "sp2", "leaf1", "ECMP", "ECMP", "solid", "v3"),
    ("e24", "sp2", "leaf2", "ECMP", "ECMP", "solid", "v3"),
    ("e25", "leaf1", "rack1", "dual", "dual", "solid", "v4"),
    ("e26", "leaf2", "rack1", "dual", "dual", "solid", "v4"),
    ("e27", "leaf1", "rack2", "dual", "dual", "solid", "v4"),
    ("e28", "leaf2", "rack2", "dual", "dual", "solid", "v4"),
]

LEDGER = [
    ("ISP A identity", "identifier", "drawn", "node `ispA` label `ISP A` in v1"),
    ("ISP B identity", "identifier", "drawn", "node `ispB` label `ISP B` in v1"),
    ("ISP C identity", "identifier", "drawn", "node `ispC` label `ISP C` in v1"),
    ("ISP D identity", "identifier", "drawn", "node `ispD` label `ISP D` in v1"),
    ("MUX 1 / MUX 2 identities", "identifier", "drawn", "nodes `mux1`, `mux2` in v1"),
    ("2 ISPs patched into each MUX", "topology (fan-in)", "drawn", "e1, e2 into mux1; e3, e4 into mux2 (v1)"),
    ("Core 1 / Core 2 identities", "identifier", "drawn", "nodes `core1`, `core2` in v1 and v2 (boundary reuse)"),
    ("each MUX cross-connected to both cores", "topology (cross-connect)", "drawn", "e5-e8, label `x-connect` (v1)"),
    ("FW1 active / FW2 standby roles", "role / residency", "drawn", "node labels `FW1 active`, `FW2 standby` in v2"),
    ("cores into both firewalls", "topology (cross-connect)", "drawn", "e9-e12: `active` solid, `standby?` dashed (v2)"),
    ("firewalls into both border leaves", "topology (cross-connect)", "drawn", "e13-e16: `active` solid, `standby?` dashed (v2)"),
    ("BL 1 / BL 2 identities", "identifier", "drawn", "nodes `bl1`, `bl2` in v2 and v3 (boundary reuse)"),
    ("border leaves to both spines, ECMP", "topology + protocol", "drawn", "e17-e20, label `ECMP` (v3)"),
    ("Spine 1 / Spine 2 identities", "identifier", "drawn", "nodes `sp1`, `sp2` in v3"),
    ("both spines to every rack leaf, ECMP", "topology + protocol", "drawn", "e21-e24, label `ECMP` (v3)"),
    ("Leaf 1 / Leaf 2 identities", "identifier", "drawn", "nodes `leaf1`, `leaf2` in v3 and v4 (boundary reuse)"),
    ("each rack dual-homed to both leaves", "topology (redundancy)", "drawn", "e25-e28, label `dual` (v4)"),
    ("Rack 1 / Rack 2 identities", "identifier", "drawn", "nodes `rack1`, `rack2` in v4"),
    ("spines above the leaf level", "placement constraint", "drawn", "v3 layer 0 = spines, layer 1 = blades"),
    ("border leaves and rack leaves at one level", "placement constraint", "drawn", "v3 layer 1 holds bl1, bl2, leaf1, leaf2"),
    ("no arrows merged between mux1/mux2 or core1/core2", "human correction", "drawn", "one edge per link; `trunks:` empty in all four specs"),
    ("remove the flowing dots", "human correction", "drawn", "every edge has `\"dots\": 0`; `flows=0` and `0 periodic routes` in every check"),
    ("compact at default zoom", "human correction", "drawn", "extents 43x23, 30x23, 49x20, 21x14 -- all <= 77x47 at 100%"),
    ("arrow convention (physical links, not traffic direction)", "qualifier", "dropped with reason",
     "the renderer has no caption/legend field, so the convention is stated in generation.md and the reply, not inside a view"),
    ("active-passive firewall pair semantics", "role", "abbreviated",
     "the pair is two nodes in one `fw` group plus per-edge `active` / dashed `standby?`; no separate legend"),
    ("historical/uncertain status of the standby links", "qualifier", "drawn",
     "dashed style + `standby?` text on e11, e12, e15, e16"),
]

SOURCE_POINTERS = [
    "docs/visualize-eval/cases/datacenter-redundancy/source.md 'Original line 126 (user)' -- components: 4 ISPs, 2 MUX (2 ISPs each), 2 cores, active-passive firewall, border leaf, other leafs to racks, 2 spines over the leaves",
    "source.md 'Original line 134 (user)' -- remove dots flowing, re-render",
    "source.md 'Original line 142 (user)' -- show the cross-connect at each layer",
    "source.md 'Original line 150/158/166 (user)' -- compact, readable at default zoom, lower box height",
    "source.md 'Original line 248 (user)' -- border leaf and leaf at the same height, spines above the leaf",
    "source.md 'Original line 270 (user)' -- independent arrows; do not merge core1/core2 or mux1/mux2 arrows",
    "source.md 'Relationship facts from the historical attempt' -- 18 nodes and 28 relations e1-e28",
    "source.md 'Fixed constraints' -- cross-connect every adjacent redundant tier, keep all 28 links, no shared bus, physical-link arrow convention",
]


def main() -> None:
    attempts = json.loads((CASE / "attempts.json").read_text())
    views = []
    for view in ("v1", "v2", "v3", "v4"):
        bundle = CASE / "evidence" / view
        manifest = json.loads((bundle / "manifest.json").read_text())
        check_text = (bundle / "check.txt").read_text()
        facts = parse_check(check_text)
        validator = (CASE / "validator" / f"{view}.txt").read_text()
        spec = CASE / "specs" / f"{view}.json"
        views.append({
            "id": view,
            "carries": VIEW_META[view]["carries"],
            "spec": f"specs/{view}.json",
            "spec_sha256": sha(spec),
            "evidence": {
                "text": f"evidence/{view}/{view}-text.txt",
                "ansi": f"evidence/{view}/{view}-ansi.ansi",
                "selected_ansi": f"evidence/{view}/{view}-selected.ansi",
                "check": f"evidence/{view}/check.txt",
                "frames_text": f"evidence/{view}/{view}-frames.txt",
                "frames_ansi": f"evidence/{view}/{view}-frames.ansi",
                "manifest": f"evidence/{view}/manifest.json",
                "bin_sha256": f"evidence/{view}/bin.sha256",
                "validator_output": f"validator/{view}.txt",
            },
            "measured": {
                "pane_rect": {"width": 79, "height": 49,
                              "note": "herdr split --direction right --ratio 0.5 from the worker pane (159x49); Herdr draws a 1-cell border, so the app sees 77x47"},
                "app_columns": 77,
                "app_rows": 47,
                "viewport_token": manifest.get("viewport_token"),
                "viewport_line_in_frames": next(
                    (line for line in (bundle / f"{view}-frames.txt").read_text().splitlines()
                     if line.startswith("viewport: ")), None),
                "manifest_pane_cols": manifest.get("pane_cols"),
                "manifest_pane_rows": manifest.get("pane_rows"),
                "extent": facts.get("extent"),
            },
            "check": {
                "exit": manifest.get("check_exit"),
                "lines": check_text.strip().splitlines(),
                "warnings": [line for line in check_text.splitlines() if line.lower().startswith("warning:")],
                "crossings": int(facts["crossings"]),
                "labels": facts.get("labels"),
                "groups": facts.get("groups"),
                "trunks": facts.get("trunks", ""),
                "dots": facts.get("dots"),
                "origins": facts.get("origins"),
                "flow_motion": "none by design: every edge is dots:0 and no edge sets flow",
            },
            "frames": manifest.get("frames"),
            "frame_step_ms": manifest.get("frame_step_ms"),
            "pane_id": manifest.get("pane_id"),
            "cleanup": manifest.get("cleanup"),
            "crossing_choice": VIEW_META[view]["crossing_choice"],
            "validator": {
                "command": (
                    "python3 scripts/viz-validate.py docs/visualize-eval/rounds/03/"
                    f"datacenter-redundancy/evidence/{view} --require-select --require-frames "
                    "--attempts docs/visualize-eval/rounds/03/datacenter-redundancy/attempts.json"
                ),
                "verdict": "all checks passed" if "all checks passed" in validator else "FAILED",
                "failing_checks": [line.split(" — ")[0].removeprefix("FAIL ")
                                   for line in validator.splitlines() if line.startswith("FAIL ")],
                "full_output": validator.strip().splitlines(),
            },
        })

    audit = []
    for rid, src, dst, verb, label, style, view in RELATIONSHIPS:
        audit.append({
            "id": rid,
            "from": src,
            "to": dst,
            "verb_or_tech": verb,
            "label_rendered": label,
            "label_owner": "none (source gives no label)" if label is None else rid,
            "style": style,
            "dots": 0,
            "view": view,
        })

    mapping = [
        {"original_relation": f"{src} -> {dst}: {verb}", "view": view, "view_edge_id": rid,
         "rendered_label": label, "style": style, "dots": 0}
        for rid, src, dst, verb, label, style, view in RELATIONSHIPS
    ]

    generated = {
        "case_id": "datacenter-redundancy",
        "round": "03",
        "generator": {
            "identity": "fresh diagram generator worker viz-ds03-5 (round 03, isolated worktree, no prior-round or other-case reads)",
            "model": "fireworks/accounts/fireworks/routers/deepseek-flash-latest",
            "subagents_spawned": 0,
            "judges_spawned": 0,
            "independent_review": "not run by design: the captain starts the separate Sol judge after this result",
        },
        "frozen_inputs": {
            "candidate_skill": {"path": SKILL_PATH, "sha256": SKILL_SHA},
            "renderer": {"path": BIN_PATH, "sha256": BIN_SHA, "used_absolutely": True,
                         "rebuilt_or_substituted": False},
            "target": {"columns": 77, "rows": 47, "zoom": 1.0, "zoom_label": "natural"},
        },
        "arrow_convention": (
            "Arrows show the direction of the audited physical link (producer -> consumer as the "
            "source states it). They are NOT proof of one-way traffic; every link is physical "
            "connectivity between two ports. Rendering a link upward (BL -> spine) therefore means "
            "'this border leaf is cabled to that spine', not 'traffic only flows up'."
        ),
        "coverage_map": [
            {"view": "v1", "carries": "nodes ISP A-D, MUX 1-2, Core 1-2; edges e1-e8"},
            {"view": "v2", "carries": "nodes Core 1-2 (boundary), FW1 active, FW2 standby, BL 1-2; edges e9-e16"},
            {"view": "v3", "carries": "nodes BL 1-2 (boundary), Spine 1-2, Leaf 1-2; edges e17-e24; placement constraint spine-above-leaf and bl/leaf on one level"},
            {"view": "v4", "carries": "nodes Leaf 1-2 (boundary), Rack 1-2; edges e25-e28 (dual-homing)"},
        ],
        "views": views,
        "meaning_ledger": [
            {"fact": fact, "kind": kind, "fate": fate, "detail": detail}
            for fact, kind, fate, detail in LEDGER
        ],
        "relationship_audit": audit,
        "relationship_mapping": mapping,
        "coverage_check": {
            "original_relations": len(RELATIONSHIPS),
            "relations_drawn": sum(1 for row in RELATIONSHIPS),
            "nodes_total": 18,
            "nodes_drawn": 18,
            "edges_per_view": {"v1": 8, "v2": 8, "v3": 8, "v4": 4},
            "trunks_used": 0,
            "trunk_reason": "no link in the source is a shared bus; every redundant link stays its own traceable arrow",
        },
        "source_pointers": SOURCE_POINTERS,
        "abbreviations": [
            {"short": "ISP A", "full": "ISP A (one of the four upstream ISPs)", "key_on_view": "v1 node label"},
            {"short": "MUX 1 / MUX 2", "full": "the two MUX appliances; ISP membership is shown by edges e1-e4, not folded into the label", "key_on_view": "v1 node label + fan-in edges"},
            {"short": "Core 1 / Core 2", "full": "the two redundant core routers", "key_on_view": "v1/v2 node label"},
            {"short": "FW1 active / FW2 standby", "full": "the active/passive firewall pair, role carried in the node label", "key_on_view": "v2 node label"},
            {"short": "BL 1 / BL 2", "full": "border leaves of the spine fabric", "key_on_view": "v2/v3 node label"},
            {"short": "standby?", "full": "standby (passive) link whose standing the source only records historically; '?' marks it unconfirmed", "key_on_view": "v2 dashed edge label"},
            {"short": "ECMP", "full": "equal-cost multipath link between blade and spine", "key_on_view": "v3 edge label"},
            {"short": "dual", "full": "rack is dual-homed to both rack leaves", "key_on_view": "v4 edge label"},
            {"short": "x-connect", "full": "cross-connect between adjacent redundant tiers", "key_on_view": "v1 edge label"},
        ],
        "deliberate_drops": [
            {"fact": "a caption stating the arrow convention and the 28-link count",
             "reason": "the renderer exposes no caption/legend field; the header shows only the spec path",
             "where_it_lives_instead": "generation.md + the reply text"},
            {"fact": "per-ISP port counts or cabling media",
             "reason": "absent in the source; inventing them would fabricate facts"},
            {"fact": "a separate node for 'active/passive pair'",
             "reason": "the source describes two appliances; two nodes plus per-edge active/standby labels carry it without inventing a node"},
        ],
        "known_defects": [
            {"severity": "readability", "views": ["v3"],
             "defect": "9 crossings on 8 edges: the upward BL->spine fan and the downward spine->leaf fan share one corridor band, so several bridges (⌒) and adjacent ECMP labels appear",
             "root_cause": "the source mandates spines above while keeping border leaves and rack leaves on one level, so both fans occupy the same band; attempt1 (racks included) was worse at 12"},
            {"severity": "readability", "views": ["v1", "v2", "v4"],
             "defect": "repeated short labels land in adjacent cells ('activestandby?', 'activeactive', 'dualdual', stacked 'x-connect'); every label is placed and none sits on a route cell, but pairing a label to its own arrow needs tracing",
             "root_cause": "2-node tiers keep the fans narrow (extents 30x23 / 21x14), so label slots sit side by side"},
            {"severity": "data", "views": ["v1"],
             "defect": "the four ISP->MUX links carry no label",
             "root_cause": "deliberate: the source calls them unlabeled historical relations and forbids inventing a protocol"},
            {"severity": "evidence", "views": ["v1", "v2", "v3", "v4"],
             "defect": "manifest pane_cols/pane_rect are null because scripts/viz-evidence.sh resolves the pane rect with `herdr pane layout` (globally focused tab), which is not this worker's tab",
             "mitigation": "the app's own measured size is captured twice per bundle: header token '77x47 @100%' in the text frame and 'viewport: 77x47 zoom: 1.00 natural' in the frames capture; the split geometry (79x49 rect) was probed once and closed"},
            {"severity": "note", "views": ["v1", "v2", "v3", "v4"],
             "defect": "no route animates, so --check reports `origins: 0/0` and `0 synchronized at 2000ms`",
             "root_cause": "intended: the source asked for the flowing dots to be removed; 11 frames across a full 2000 ms cycle show no dot on any route"},
        ],
        "blockers": [
            {"capability": "caption / legend text inside the view",
             "status": "missing in the frozen renderer (no spec field, header shows only the spec path)",
             "impact": "the arrow convention and the view's tier description are stated in generation.md and the reply instead of in the pane"},
        ],
        "cleanup": {
            "panes": [
                {"view": view["id"], "pane_id": view["pane_id"], "result": view["cleanup"]}
                for view in views
            ],
            "probe_pane": {"pane_id": "w7E:pBJ", "result": "closed",
                           "note": "one throwaway split used to measure the 79x49 rect before capture"},
            "failures": [],
        },
        "commands": [
            "shasum -a 256 /tmp/visualize-eval/round-03/bin/rataflow-view docs/visualize-eval/rounds/03/SKILL.md",
            "/tmp/visualize-eval/round-03/bin/rataflow-view --check docs/visualize-eval/rounds/03/datacenter-redundancy/specs/v1.json",
            "/tmp/visualize-eval/round-03/bin/rataflow-view --check docs/visualize-eval/rounds/03/datacenter-redundancy/specs/v2.json",
            "/tmp/visualize-eval/round-03/bin/rataflow-view --check docs/visualize-eval/rounds/03/datacenter-redundancy/specs/v3.json",
            "/tmp/visualize-eval/round-03/bin/rataflow-view --check docs/visualize-eval/rounds/03/datacenter-redundancy/specs/v4.json",
            "scripts/viz-evidence.sh --spec docs/visualize-eval/rounds/03/datacenter-redundancy/specs/<view>.json --bin /tmp/visualize-eval/round-03/bin/rataflow-view --out docs/visualize-eval/rounds/03/datacenter-redundancy/evidence/<view> --label <view> --frames 11 --step-ms 200",
            "python3 scripts/viz-validate.py docs/visualize-eval/rounds/03/datacenter-redundancy/evidence/<view> --require-select --require-frames --attempts docs/visualize-eval/rounds/03/datacenter-redundancy/attempts.json",
        ],
        "status": "self-checked only; independent Sol review is the captain's step, not claimed here",
    }

    (CASE / "generation.json").write_text(json.dumps(generated, indent=2, ensure_ascii=False) + "\n")
    print("wrote", CASE / "generation.json")
    for view in views:
        print(view["id"], view["check"]["crossings"], view["measured"]["extent"], view["validator"]["verdict"])


if __name__ == "__main__":
    main()
