#!/usr/bin/env python3
"""Assemble generation.json for case homelab-nic-trace, round 01.

Reads only files inside the round case directory; writes generation.json next to them.
Run with: uv run --no-project python tools/make_manifest.py
"""
import hashlib
import json
import os
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIN = "/tmp/visualize-eval/round-01/bin/rataflow-view"
SKILL = "/Users/aviral/.herdr/worktrees/dotfiles/fix-visualize-skill/docs/visualize-eval/rounds/01/SKILL.md"


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def rel(path):
    return os.path.relpath(path, ROOT)


def existing(*paths):
    return [rel(p) for p in paths if os.path.exists(p)]


VIEWS = {
    "v1": {
        "title": "host-local virtual networks into the host (libvirt NAT + Docker bridge)",
        "spec": "specs/v1-local-nets.json",
        "check": "checks/v1-check.txt",
        "extent": "35x21",
        "direction": "tb",
        "nodes": ["vm", "ctr", "virbr", "dkbr", "box"],
        "edges": [
            {"from": "vm", "to": "virbr", "label": "192.168.122.x"},
            {"from": "ctr", "to": "dkbr", "label": "172.18.2.x"},
            {"from": "virbr", "to": "box", "label": "NAT bridge"},
            {"from": "dkbr", "to": "box", "label": "Docker bridge"},
        ],
        "selected_node": "homelab host (box) — rows 31-34, cols 22-35, bold accent",
    },
    "v2": {
        "title": "overlay and host NIC attachments (wired primary, Wi-Fi standby)",
        "spec": "specs/v2-host-nics.json",
        "check": "checks/v2-check.txt",
        "extent": "76x12",
        "direction": "lr",
        "nodes": ["ts", "box", "bond0", "wlp"],
        "edges": [
            {"from": "ts", "to": "box", "label": "overlay"},
            {"from": "ts", "to": "bond0", "label": "UDP encap"},
            {"from": "box", "to": "bond0", "label": "eno1 2.5 GbE"},
            {"from": "box", "to": "wlp", "label": "backup"},
        ],
        "selected_node": "bond0 .1.197 — rows 20-24, cols 63-76, bold accent",
    },
    "v3": {
        "title": "LAN gateway, WAN transit and egress (qualified device roles)",
        "spec": "specs/v3-lan-wan.json",
        "check": "checks/v3-check.txt",
        "extent": "43x45",
        "direction": "tb",
        "nodes": ["bond0", "wlp", "rtr", "ont", "vzagg", "vzbb", "cf"],
        "edges": [
            {"from": "bond0", "to": "rtr", "label": "default gw 0.5 ms"},
            {"from": "wlp", "to": "rtr", "label": "metric 600"},
            {"from": "rtr", "to": "ont", "label": "NAT out"},
            {"from": "ont", "to": "vzagg", "label": "4.5 ms"},
            {"from": "vzagg", "to": "vzbb", "label": "6.6 ms"},
            {"from": "vzbb", "to": "cf", "label": "6-9 ms"},
        ],
        "selected_node": "bond0 .1.197 — rows 3-6, cols 24-37, bold accent",
    },
}

COVERAGE = [
    {"source": "vm -> virbr", "source_label": "192.168.122.x", "view": "v1",
     "visible": "edge vm -> virbr, label '192.168.122.x' at row 20 cols 27-40, arrow (22,24) into virbr0 NAT top border"},
    {"source": "virbr -> box", "source_label": "NAT bridge", "view": "v1",
     "visible": "edge virbr0 NAT -> homelab host, label 'NAT bridge' at row 28 cols 26-40, arrow (30,23) into host top border"},
    {"source": "ctr -> dkbr", "source_label": "172.18.2.x", "view": "v1",
     "visible": "edge Container veth -> docker0, label '172.18.2.x' at row 20 cols 43-52, arrow (22,41) into docker0 top border"},
    {"source": "dkbr -> box", "source_label": "Docker bridge", "view": "v1",
     "visible": "edge docker0 -> homelab host, label 'Docker bridge' at row 30 cols 27-39, arrow (30,25) into host top border"},
    {"source": "ts -> box", "source_label": "overlay", "view": "v2",
     "visible": "edge tailscale0 -> homelab host, label 'overlay' at row 22 cols 20-26, arrow (21,30) into host left border"},
    {"source": "ts -> bond0", "source_label": "encap over UDP", "view": "v2",
     "visible": "edge tailscale0 -> bond0 drawn over the host, label 'UDP encap' at row 20 cols 51-59, arrow (21,62) into bond0 left border; label shortened from 'encap over UDP', meaning preserved"},
    {"source": "box -> bond0", "source_label": "eno1 2.5 GbE", "view": "v2",
     "visible": "edge homelab host -> bond0, label 'eno1 2.5 GbE' at row 22 cols 47-58, arrow (23,62) into bond0 left border"},
    {"source": "box -> wlp", "source_label": "backup path", "view": "v2",
     "visible": "edge homelab host -> wlp8s0, label 'backup' at row 24 cols 49-54, arrow (27,62) into wlp8s0 left border; label shortened from 'backup path', meaning preserved"},
    {"source": "bond0 -> rtr", "source_label": "default gw 0.5 ms", "view": "v3",
     "visible": "edge bond0 -> Fios router?, label 'default gw 0.5 ms' at row 7 cols 27-47, arrow (10,22) into router top border"},
    {"source": "wlp -> rtr", "source_label": "metric 600", "view": "v3",
     "visible": "edge wlp8s0 -> Fios router?, label 'metric 600' at row 8 cols 31-47, arrow (10,24) into router top border"},
    {"source": "rtr -> ont", "source_label": "NAT out", "view": "v3",
     "visible": "edge Fios router? -> ONT?, label 'NAT out' at row 15 cols 24-30, arrow (18,23) into ONT top border"},
    {"source": "ont -> vzagg", "source_label": "4.5 ms", "view": "v3",
     "visible": "edge ONT? -> VZ agg (hop), label '4.5 ms' at row 24 cols 25-30, arrow (26,20) into VZ agg top border"},
    {"source": "vzagg -> vzbb", "source_label": "6.6 ms", "view": "v3",
     "visible": "edge VZ agg (hop) -> VZ backbone AS701 (hop), label '6.6 ms' at row 32 cols 22-27, arrow (34,19) into backbone top border"},
    {"source": "vzbb -> cf", "source_label": "6-9 ms", "view": "v3",
     "visible": "edge VZ backbone AS701 (hop) -> Cloudflare, label '6-9 ms' at row 39 cols 21-26, arrow (42,22) into Cloudflare top border"},
]

ATTEMPTS = [
    {"view": "v1", "attempt": 1, "spec": "specs/v1-local-nets.json", "result": "accepted",
     "note": "first draft; tb with 3 explicit layers; check clean at 35x21"},
    {"view": "v1", "attempt": 2, "spec": "attempts/v1-a2-lr.json", "check": "checks/attempt-v1-a2-lr-check.txt",
     "result": "rejected", "note": "lr variant; extent 81x11 exceeds the 77-column pane, and no warning was hiding a defect - simply too wide"},
    {"view": "v2", "attempt": 1, "spec": "attempts/v2-a1-tb-reconstructed.json",
     "check": "checks/attempt-v2-a1-tb-reconstructed-check.txt", "result": "rejected",
     "note": "tb with the 14-character source labels; '1 edge label(s) had no free slot' at 34x22. The draft file was overwritten when the winning variant was promoted to specs/v2-host-nics.json; this file is a faithful reconstruction (same nodes, layers, labels, direction) whose re-check reproduces the same warning. It is marked reconstructed, not a captured original."},
    {"view": "v2", "attempt": 2, "spec": "attempts/v2-a2-lr.json", "check": "checks/attempt-v2-a2-lr-check.txt",
     "result": "accepted", "note": "lr, short edge labels ('UDP encap', 'backup'); no warnings, 76x12. Promoted to specs/v2-host-nics.json (identical bytes, sha256 c74d69c2...)."},
    {"view": "v2", "attempt": 3, "spec": "attempts/v2-a3-tb.json", "check": "checks/attempt-v2-a3-tb-check.txt",
     "result": "rejected", "note": "tb with the same short labels still reported '1 edge label(s) had no free slot' at 34x22; the missing slot is structural (skip edge over the host row), not a label-length problem"},
    {"view": "v3", "attempt": 1, "spec": "attempts/v3-a1-lan-wan.json", "check": "checks/attempt-v3-a1-lan-wan-check.txt",
     "result": "superseded", "note": "check clean at 38x45; replaced because it did not mark the two Verizon traceroute hops as hops"},
    {"view": "v3", "attempt": 2, "spec": "attempts/v3-a2-lan-wan-hops.json", "check": "checks/attempt-v3-a2-lan-wan-hops-check.txt",
     "result": "accepted", "note": "adds '(hop)' to 'VZ agg 100.41.x' and 'VZ backbone AS701'; check clean at 43x45. Promoted to specs/v3-lan-wan.json (identical bytes, sha256 454a27aa...)."},
]

DEFECTS = {
    "v1": [
        "vm -> virbr and virbr -> box each make a one-cell left jog just above the arrowhead (row 21 and row 29); the route is continuous but reads as a step rather than a straight drop.",
        "The virbr -> box turn glyph at (29,24) and the docker0 -> box turn glyph at (29,25) are vertically adjacent, so the two separate routes touch corner-to-corner. They do not share a cell and the labels are distinct, but a fast look can read the pair as one junction.",
        "'Docker bridge' sits on row 30, one row below its route segment on row 29 and one row above the host's top border, because the free slot is between route and box.",
    ],
    "v2": [
        "At row 21 cols 28-31 the 'UDP encap' route turns up at (21,28) immediately beside the 'overlay' route's arrival corner and arrowhead at (21,29)-(21,30): '──╯╭▶'. The two edges are separate (different source ports at rows 21 and 23, no shared cell) and both arrowheads are visible, but the collinear stub can be misread as a branch into the host.",
        "At row 23 cols 59-62 the 'backup' route turns down at (23,59) immediately beside the 'eno1' arrival corner at (23,60): '╮╰─▶'. Same adjacency class as above.",
        "Extent is 76 cells wide in a 77-column pane, i.e. one spare column. The graph itself never overflows, but there is no width budget left for a longer label.",
        "Direction is lr while v1 and v3 are tb (forced by the dropped-label warning in tb); the three views therefore do not share an orientation.",
        "Flow dots overwrite the corner glyph of the cell they sit on (e.g. the encap corner at (21,28) in some frames), so a frame can momentarily show a bare dot where a turn was.",
    ],
    "v3": [
        "Each rung of the WAN ladder steps one or two cells sideways before its arrowhead (e.g. 'NAT out' jog at (17,22)-(18,23), '4.5 ms' step at (25,20)-(25,21), '6-9 ms' step at (41,22)-(41,23)); every last segment is vertical and every arrowhead is visible, but the ladder is not a straight column.",
        "The graph reaches row 46, the last row of the 47-row pane, so there is no bottom margin below the Cloudflare box. The bottom-left control palette (cols 2-10, rows 41-46) is clear of it.",
        "The 'metric 600' label sits at row 8, one row above the wlp route it names (row 9), directly under the 'default gw 0.5 ms' label of the other ingress; it is not beside its source stem.",
        "The header line is clipped by the 77-column pane ('... · drag'); renderer chrome, not graph content.",
    ],
}

ABBREVIATIONS = {
    "bond0 .1.197": "bond0, 192.168.1.197 on the 192.168.1.0/24 LAN (source node 'bond0 192.168.1.197')",
    "wlp8s0 .213": "wlp8s0, 192.168.1.213 on the same LAN (source: 'wlp8s0 wifi .213')",
    "tailscale0 .49": "tailscale0, 100.113.153.49 (source: 'tailscale0 100.113.153.49'); the 100.64/10 overlay prefix is implied",
    "Fios router? .1.1": "claimed Verizon Fios gateway at 192.168.1.1; '?' = role taken from MAC OUI and the historical chat, not verified",
    "ONT? 169.254.3.1": "claimed ONT/demarc at 169.254.3.1; '?' = historical interpretation of a link-local first hop, not verified physical topology",
    "VZ": "Verizon",
    "VZ agg 100.41.x (hop)": "Verizon aggregation hop 100.41.x; '(hop)' = traceroute hop, not a verified device",
    "VZ backbone AS701 (hop)": "Verizon backbone in AS701 as seen from traceroute; '(hop)' = traceroute hop, not a verified device",
    "UDP encap": "the source phrase 'encap over UDP' (Tailscale encapsulation over the wired path)",
    "backup": "the source phrase 'backup path' (Wi-Fi standby route; metric failover, not ECMP)",
}

SOURCE_POINTERS = [
    "docs/visualize-eval/cases/homelab-nic-trace/source.md — 'Relationship facts from the historical attempt' (13 nodes, 14 edges), 'What the probes found', and 'Fixed constraints'",
    "same file, quoting historical chat line 48 (user: do it for the rack-bench host) and line 68 (assistant summary of the live graph)",
]

BLOCKERS = [
    "None for rendering: the frozen binary accepted every final spec and --check exited 0 with no warnings.",
    "Not a blocker but unmet: the skill's 'Independent readability review' section cannot be satisfied by this generator (it must not spawn an Astra judge; the captain owns that review), so no pass/fail visual verdict exists in this output.",
    "Planar-view limitation, not a renderer bug: 13 nodes and 14 edges do not fit one 77x47 pane at 100% zoom without crowding, so the layout is split into three views and the host is repeated as a bridge node in v1 and v2 (bond0/wlp repeat in v2 and v3).",
]

CLEANUP = {
    "panes_created": ["w7E:p34", "w7E:p3T", "w7E:p45", "w7E:p4D", "w7E:p4N", "w7E:p4S", "w7E:p4V"],
    "panes_closed": ["w7E:p34", "w7E:p3T", "w7E:p45", "w7E:p4D", "w7E:p4N", "w7E:p4S", "w7E:p4V"],
    "method": "every viewer ran the skill's self-closing command ('rataflow-view <spec>; herdr pane close <pane>') and was quit with 'q'; each pane id was then re-queried with 'herdr pane get' and returned pane_not_found",
    "failures": [],
}


def main():
    gen = {
        "case_id": "homelab-nic-trace",
        "round": "01",
        "generated_utc": subprocess.run(["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"], capture_output=True, text=True).stdout.strip(),
        "generator": {
            "role": "fresh diagram generator (no reuse of earlier rounds or other cases)",
            "harness": "pi worker subagent, session " + os.environ.get("PI_SESSION_ID", "unknown"),
            "agent_name": os.environ.get("PI_SUBAGENT_NAME", "viz-ds01-homelab-nic-trace"),
            "provider": os.environ.get("PI_PROVIDER", "unknown"),
            "model_env": os.environ.get("PI_MODEL", "unknown"),
            "model_exact": "fireworks/accounts/fireworks/routers/deepseek-flash-latest",
            "reasoning_level": os.environ.get("PI_REASONING_LEVEL", "unknown"),
            "model_declared_in_task": "fireworks/accounts/fireworks/routers/deepseek-flash-latest",
        },
        "inputs": {
            "candidate_skill": {"path": rel(SKILL), "sha256": sha(SKILL)},
            "renderer": {"path": BIN, "sha256": sha(BIN)},
            "source_brief": {"path": "../../../cases/homelab-nic-trace/source.md", "sha256": sha(os.path.join(ROOT, "../../../cases/homelab-nic-trace/source.md"))},
            "frozen_binary_used_for_every_command": True,
        },
        "measured_viewport": {
            "target": "77 columns x 47 rows at natural 100% zoom",
            "measured": "47 rows x 77 columns of terminal content",
            "method": "herdr pane split --current --direction right --ratio 0.5 --no-focus, then 'stty size' inside each viewer pane before the viewer started; pane rect is 79x49 because the pane chrome takes the rest",
            "match": True,
            "per_view": {v: "47 77" for v in VIEWS},
            "pan_or_zoom_used": False,
            "fit_key_used": False,
        },
        "views": {},
        "relationship_coverage": COVERAGE,
        "source_pointers": SOURCE_POINTERS,
        "abbreviations": ABBREVIATIONS,
        "qualified_evidence": [
            "'Fios router?' and 'ONT?' carry a '?' because the source brief says to treat MAC-vendor roles and traceroute hops as historical interpretations, not verified physical topology.",
            "'VZ agg 100.41.x (hop)' and 'VZ backbone AS701 (hop)' are labelled '(hop)' because they are traceroute hops from the historical attempt.",
            "The Fios router's NAT/DHCP role and the single shared Fios pool IP 71.251.12.240 are not drawn as nodes; the egress claim lives in the source summary and in the 'NAT out' edge.",
            "IPv6: the source says the host has ULA prefixes only and no reachable global IPv6. That fact has no edge in the historical relationship list, so it is not drawn; it is recorded here rather than invented as a node.",
        ],
        "known_defects": DEFECTS,
        "blockers": BLOCKERS,
        "attempts": ATTEMPTS,
        "attempt_policy": "at most three local spec attempts per view; v2 used all three, v1 and v3 used two",
        "cleanup": CLEANUP,
        "independent_review": {
            "status": "not run by this generator",
            "reason": "the visual verdict is captain-owned and uses a separate Astra judge; this generator did not spawn one",
            "claims_green": False,
        },
    }

    for vid, v in VIEWS.items():
        digits = vid
        gen["views"][vid] = {
            "title": v["title"],
            "spec": v["spec"],
            "spec_sha256": sha(os.path.join(ROOT, v["spec"])),
            "check": {
                "file": v["check"],
                "sha256": sha(os.path.join(ROOT, v["check"])),
                "exit_code": 0,
                "warnings": [],
                "extent_cells": v["extent"],
            },
            "pane": {
                "id": {"v1": "w7E:p4V", "v2": "w7E:p4N", "v3": "w7E:p4S"}[vid],
                "tab": "w7E:tM",
                "split": "no-focus, --direction right --ratio 0.5 (my own tab, not the captain's)",
                "measured_size": "47 rows x 77 cols (stty size)",
                "commands_log": f"captures/{vid}-commands.txt",
                "size_log": f"captures/{vid}-size.txt",
            },
            "direction": v["direction"],
            "nodes": v["nodes"],
            "edges": v["edges"],
            "captures": {
                "unselected_text": f"captures/{vid}-unselected.txt",
                "unselected_ansi": f"captures/{vid}-unselected.ansi",
                "selected_text": f"captures/{vid}-selected.txt",
                "selected_ansi": f"captures/{vid}-selected.ansi",
                "selected_node": v["selected_node"],
                "frames": existing(
                    os.path.join(ROOT, f"frames/{vid}-frame01.txt"),
                    os.path.join(ROOT, f"frames/{vid}-frame01.ansi"),
                    os.path.join(ROOT, f"frames/{vid}-frame02.txt"),
                    os.path.join(ROOT, f"frames/{vid}-frame02.ansi"),
                    os.path.join(ROOT, f"frames/{vid}-frame03.txt"),
                    os.path.join(ROOT, f"frames/{vid}-frame03.ansi"),
                ),
                "frame_hashes": {
                    os.path.basename(p): sha(p) for p in sorted(
                        [os.path.join(ROOT, f"frames/{vid}-frame0{i}.txt") for i in (1, 2, 3)]
                    )
                },
            },
            "border_color_check": {
                "file": f"checks/{vid}-borders.json",
                "result": "all node boxes have four complete sides, one uniform border color per box, and no arrow or flow dot on a border cell",
            },
            "selection_diff": f"checks/{vid}-selection-diff.json",
            "attempt_captures": {
                "v1": ["attempts/v1-a1-captures/"],
                "v2": ["attempts/v2-a2-captures/"],
                "v3": ["attempts/v3-a1-unselected.txt", "attempts/v3-a2-captures/"],
            }[vid],
        }

    gen["tools"] = {
        "render_view.sh": "repeatable pane split + stty measurement + viewer launch + capture + cleanup",
        "ansi_grid.py": "ANSI pane capture -> cell grid (char, fg, bold); diff mode for selected vs unselected",
        "validate_grid.py": "detects node boxes and checks four complete sides, uniform border color, and arrow/dot glyphs on border cells",
    }
    gen["file_hashes"] = {}
    for dirpath, _dirnames, filenames in os.walk(ROOT):
        for fn in sorted(filenames):
            p = os.path.join(dirpath, fn)
            if fn == "generation.json":
                continue
            gen["file_hashes"][rel(p)] = sha(p)

    out = os.path.join(ROOT, "generation.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(gen, fh, indent=2, sort_keys=False)
        fh.write("\n")
    print("wrote", out, "views:", len(gen["views"]), "files hashed:", len(gen["file_hashes"]))


if __name__ == "__main__":
    main()
