#!/usr/bin/env -S uv run --no-project python
"""Build generation.json for case modal-runtime / round 01 from the files on disk."""

import hashlib
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "generation.json"


def sha(rel):
    p = ROOT / rel
    return hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None


def size(rel):
    p = ROOT / rel
    return p.stat().st_size if p.exists() else None


VIEWS = [
    {
        "id": "overview",
        "title": "modal-runtime overview (all 8 components, all 8 relations)",
        "purpose": "Single whole-system view: every component and every directed relation in one layout.",
        "spec": "spec/overview.json",
        "check": {
            "stdout": "checks/final-overview.out",
            "stderr": "checks/final-overview.err",
            "exit_code": "checks/final-overview.code",
            "summary": "ok: nodes=8 edges=8 flows=0 direction=tb theme=gruvbox / "
                       "layers=5 (explicit placement, sugiyama skipped) / extent=64x38 cells",
            "exit": 0,
            "warnings": [],
        },
        "pane_id": "w7E:p2Z",
        "dimensions": {"cols": 77, "rows": 47, "measured_file": "evidence/overview.tty-size.txt",
                       "raw": "47 77", "pane_rect": "80x49 at x=80,y=0 inside tab w7E:tP (area 159x49)"},
        "extent_cells": "64x38",
        "captures": {
            "text_none": "captures/overview.text.none.txt",
            "ansi_none": "captures/overview.ansi.none.txt",
            "text_selected_tab": "captures/overview.text.sel-tab.txt",
            "ansi_selected_tab": "captures/overview.ansi.sel-tab.txt",
            "text_selected_right": "captures/overview.text.sel-right.txt",
            "ansi_selected_right": "captures/overview.ansi.sel-right.txt",
            "trace": "evidence/overview.trace.txt",
            "ansi_analysis": "evidence/overview.ansi-analysis.txt",
        },
        "frames": [],
        "frames_note": "Source requests no animation; spec has 0 flows, so no animated frames exist.",
        "timestamps_utc": ["2026-11-02T08:24:52Z split+stty", "2026-11-02T08:25:29Z viewer launched",
                           "2026-11-02T08:25:30Z-08:25:38Z captures (text+ansi, none/Tab/Right)",
                           "2026-11-02T08:25:45Z q, pane self-closed"],
        "timeline": "evidence/overview.timeline.txt",
        "render_facts_measured": {
            "boxes": 8,
            "box_border_colors": {
                "modal-worker": "#d8a657 (layer 1)",
                "modal-runtime": "#7daea3 (layer 2)",
                "Task engine": "#d3869b (layer 3)",
                "Container backend": "#a9b665 (layer 4, green family)",
                "Filesystem + volumes": "#bdc97c (layer 4, green family)",
                "modal-daemon": "#8f9d4f (layer 4, green family)",
                "Task container": "#7da0b8 (layer 5, blue family)",
                "Blobnet": "#97b8ce (layer 5, blue family)",
            },
            "border_color_violations": 0,
            "arrowheads": {"▼": 7, "◀": 1, "total": 8, "edges": 8},
            "dot_glyphs": 0,
            "overflow_badge": False,
            "palette_overlap": "none — control palette occupies lines 41-46, cols 2-10; nearest box is Task container at cols 34-49",
            "selection_state": "color-only: Tab recolors Container backend border to accent #d8a657; Right moves it to Filesystem + volumes; plain text is byte-identical across the three states",
        },
    },
    {
        "id": "seams",
        "title": "RPC seams: worker ↔ runtime (gRPC) and runtime → daemon (HTTP over UDS)",
        "purpose": "Focused view that separates the two opposite-direction gRPC relations and the "
                   "HTTP-over-UDS daemon interface, which share the runtime box in the overview.",
        "spec": "spec/seams.json",
        "check": {
            "stdout": "checks/final-seams.out",
            "stderr": "checks/final-seams.err",
            "exit_code": "checks/final-seams.code",
            "summary": "ok: nodes=4 edges=4 flows=0 direction=tb theme=gruvbox / "
                       "layers=3 (explicit placement, sugiyama skipped) / extent=33x21 cells",
            "exit": 0,
            "warnings": [],
        },
        "pane_id": "w7E:p3N",
        "dimensions": {"cols": 77, "rows": 47, "measured_file": "evidence/seams.tty-size.txt",
                       "raw": "47 77", "pane_rect": "79x49 at x=80,y=0 inside tab w7E:tP (area 159x49)"},
        "extent_cells": "33x21",
        "captures": {
            "text_none": "captures/seams.text.none.txt",
            "ansi_none": "captures/seams.ansi.none.txt",
            "text_selected_tab": "captures/seams.text.sel-tab.txt",
            "ansi_selected_tab": "captures/seams.ansi.sel-tab.txt",
            "text_selected_right": "captures/seams.text.sel-right.txt",
            "ansi_selected_right": "captures/seams.ansi.sel-right.txt",
            "trace": "evidence/seams.trace.txt",
            "ansi_analysis": "evidence/seams.ansi-analysis.txt",
        },
        "frames": [],
        "frames_note": "No animation requested by the source; 0 flows.",
        "timestamps_utc": ["2026-11-02T08:26:55Z split+stty", "2026-11-02T08:26:57Z viewer launched",
                           "2026-11-02T08:27:00Z-08:27:02Z captures", "2026-11-02T08:27:03Z q, pane self-closed"],
        "timeline": "evidence/seams.timeline.txt",
        "render_facts_measured": {
            "boxes": 4,
            "box_border_colors": {
                "modal-worker": "#d8a657 (layer 1)",
                "modal-runtime": "#7daea3 (layer 2)",
                "modal-daemon": "#d3869b (layer 3, pink family)",
                "Task engine": "#e29caf (layer 3, pink family)",
            },
            "border_color_violations": 0,
            "arrowheads": {"▼": 3, "◀": 1, "total": 4, "edges": 4},
            "dot_glyphs": 0,
            "overflow_badge": False,
            "palette_overlap": "none — palette on lines 41-46, cols 2-10; boxes start at col 24",
            "selection_state": "color-only: Tab selects modal-worker (border -> accent #d8a657), Right moves selection on; text captures identical",
        },
    },
    {
        "id": "execution",
        "title": "Execution and storage path: engine → backend/container and engine → filesystem/blobnet",
        "purpose": "Focused view of the task path and the volume path, with no backward edge.",
        "spec": "spec/execution.json",
        "check": {
            "stdout": "checks/final-execution.out",
            "stderr": "checks/final-execution.err",
            "exit_code": "checks/final-execution.code",
            "summary": "ok: nodes=5 edges=4 flows=0 direction=tb theme=gruvbox / "
                       "layers=3 (explicit placement, sugiyama skipped) / extent=46x21 cells",
            "exit": 0,
            "warnings": [],
        },
        "pane_id": "w7E:p3S",
        "dimensions": {"cols": 77, "rows": 47, "measured_file": "evidence/execution.tty-size.txt",
                       "raw": "47 77", "pane_rect": "79x49 at x=80,y=0 inside tab w7E:tP (area 159x49)"},
        "extent_cells": "46x21",
        "captures": {
            "text_none": "captures/execution.text.none.txt",
            "ansi_none": "captures/execution.ansi.none.txt",
            "text_selected_tab": "captures/execution.text.sel-tab.txt",
            "ansi_selected_tab": "captures/execution.ansi.sel-tab.txt",
            "text_selected_right": "captures/execution.text.sel-right.txt",
            "ansi_selected_right": "captures/execution.ansi.sel-right.txt",
            "trace": "evidence/execution.trace.txt",
            "ansi_analysis": "evidence/execution.ansi-analysis.txt",
        },
        "frames": [],
        "frames_note": "No animation requested by the source; 0 flows.",
        "timestamps_utc": ["2026-11-02T08:27:03Z split+stty", "2026-11-02T08:27:05Z viewer launched",
                           "2026-11-02T08:27:08Z-08:27:09Z captures", "2026-11-02T08:27:11Z q, pane self-closed"],
        "timeline": "evidence/execution.timeline.txt",
        "render_facts_measured": {
            "boxes": 5,
            "box_border_colors": {
                "Task engine": "#d8a657 (layer 1)",
                "Container backend": "#7daea3 (layer 2, teal family)",
                "Filesystem + volumes": "#93c2b7 (layer 2, teal family)",
                "Task container": "#d3869b (layer 3, pink family)",
                "Blobnet": "#e29caf (layer 3, pink family)",
            },
            "border_color_violations": 0,
            "arrowheads": {"▼": 4, "total": 4, "edges": 4},
            "dot_glyphs": 0,
            "overflow_badge": False,
            "palette_overlap": "none — palette on lines 41-46, cols 2-10; boxes start at col 17",
            "selection_state": "color-only: Tab selects Task engine (border -> accent #d8a657), Right moves selection on; text captures identical",
        },
    },
]

COVERAGE = [
    {"id": "R1", "from": "worker", "to": "runtime", "fact": "task input + control RPCs",
     "edge_label": "control gRPC", "kind": "gRPC request seam",
     "visible_in": {
         "overview": "worker bottom port col 12 → down (label row 11, cols 14-26) → elbow at line 12 → arrowhead ▼ line 13 col 11 → runtime top border",
         "seams": "worker bottom port col 25 → down (label line 20, right of the port) → elbow line 21 → arrowhead ▼ line 22 col 24 → runtime top border",
     }},
    {"id": "R2", "from": "runtime", "to": "worker", "fact": "events + management RPCs",
     "edge_label": "events gRPC", "kind": "gRPC reverse seam (separate edge, not merged)",
     "visible_in": {
         "overview": "runtime right-side stem line 15 → up the right corridor at col 26 → corner ╮ line 7 col 25 → arrowhead ◀ line 7 col 24 → worker right border",
         "seams": "runtime right-side stem line 24 → up col 39 → corner ╮ line 16 col 38 → arrowhead ◀ line 16 col 38 → worker right border",
     }},
    {"id": "R3", "from": "runtime", "to": "engine", "fact": "dispatches tasks",
     "edge_label": "task dispatch",
     "visible_in": {
         "overview": "runtime bottom port col 11 → jog at line 20 → down col 12 → arrowhead ▼ line 21 col 12 → engine top border",
         "seams": "runtime bottom port col 26 → right along line 28 to col 43 → down → arrowhead ▼ line 30 col 43 → engine top border; label line 27 right of port",
     }},
    {"id": "R4", "from": "engine", "to": "backend", "fact": "starts / manages containers",
     "edge_label": "starts/manages",
     "visible_in": {
         "overview": "engine bottom port col 12 → left along line 29 to col 9 → down → arrowhead ▼ line 30 col 9 → backend top border",
         "execution": "engine bottom port col 21 → left along line 21 to col 18 → down → arrowhead ▼ line 22 col 18 → backend top border; label on line 22",
     }},
    {"id": "R5", "from": "backend", "to": "container", "fact": "runs the user process",
     "edge_label": "runs process",
     "visible_in": {
         "overview": "backend bottom port col 9 → right along line 37 to col 35 → down → arrowhead ▼ line 38 col 35 → container top border",
         "execution": "backend bottom port col 18 → right along line 29 to col 20 → down → arrowhead ▼ line 30 col 20 → container top border; label line 27",
     }},
    {"id": "R6", "from": "engine", "to": "filesystem", "fact": "mounts / snapshots",
     "edge_label": "mount/snapshot",
     "visible_in": {
         "overview": "engine bottom port col 14 → right along line 29 to col 32 → down → arrowhead ▼ line 30 col 32 → filesystem top border; label line 28",
         "execution": "engine bottom port col 23 → right along line 21 to col 40 → down → arrowhead ▼ line 22 col 40 → filesystem top border; label line 20",
     }},
    {"id": "R7", "from": "filesystem", "to": "blobnet", "fact": "image + volume data",
     "edge_label": "image/vol data",
     "visible_in": {
         "overview": "filesystem bottom port col 31 → right along line 36 to col 60 → down → arrowhead ▼ line 38 col 61 → blobnet top border; label on line 35",
         "execution": "filesystem bottom port col 40 → right along line 29 to col 47 → down → arrowhead ▼ line 30 col 48 → blobnet top border; label line 28",
     }},
    {"id": "R8", "from": "runtime", "to": "daemon", "fact": "filesystem HTTP over Unix-domain socket",
     "edge_label": "fs HTTP over UDS", "kind": "HTTP over UDS — deliberately not merged with the gRPC seams",
     "visible_in": {
         "overview": "runtime bottom port col 13 → right along line 19 to col 58 → down → arrowhead ▼ line 30 col 58 → daemon top border; label on line 18",
         "seams": "runtime bottom port col 24 → jog to col 25 at line 29 → down → arrowhead ▼ line 30 col 25 → daemon top border; label line 29",
     }},
]

ATTEMPTS = [
    {"view": "overview", "n": 1, "file": "attempts/overview.v1.json", "outcome": "promoted to spec/overview.json",
     "check": "checks/overview.v1.out", "extent": "64x38", "note": "clean check; rendered and captured"},
    {"view": "overview", "n": 2, "file": "attempts/overview.v2.json",
     "outcome": "rejected — byte-identical render, no improvement",
     "check": "checks/overview.v2.out", "extent": "64x38",
     "note": "declared runtime→worker before worker→runtime to try to separate the two RPC labels; render unchanged (same extents, same label rows)"},
    {"view": "seams", "n": 1, "file": "attempts/seams.v1.json", "outcome": "superseded by v3",
     "check": "checks/seams.v1.out", "extent": "34x21",
     "note": "layer 3 ordered [engine, daemon]; defect: the label 'fs HTTP over UDS' began immediately on an arrowhead glyph (line 30 read '▼fs HTTP over UDS ▼'), which invites mis-attribution"},
    {"view": "seams", "n": 2, "file": "attempts/seams.v2.json", "outcome": "rejected on extent only, never rendered",
     "check": "checks/seams.v2.out", "extent": "81x13",
     "note": "lr direction better separates the pair but 81 cells exceeds the 77-column pane, so it would overflow at 100% zoom"},
    {"view": "seams", "n": 3, "file": "attempts/seams.v3.json", "outcome": "promoted to spec/seams.json",
     "check": "checks/seams.v3.out", "extent": "33x21",
     "note": "layer 3 ordered [daemon, engine]; labels no longer touch arrowheads"},
    {"view": "execution", "n": 1, "file": "attempts/execution.v1.json", "outcome": "promoted to spec/execution.json",
     "check": "checks/execution.v1.out", "extent": "46x21", "note": "clean check; rendered and captured"},
    {"view": "execution", "n": 2, "file": "attempts/execution.v2.json", "outcome": "equivalent alternative, not promoted",
     "check": "checks/execution.v2.out", "extent": "46x21",
     "note": "layers 2-3 ordered [filesystem, backend] / [blobnet, container]; label/arrow placement equally good, kept v1 because backend→container reads left-to-right as the primary path"},
]

DEFECTS = [
    {"id": "D1", "views": ["overview", "seams"], "severity": "minor",
     "what": "The two RPC labels share one render row: overview line 11 reads '│ control gRPC│ events gRPC', seams line 20 the same.",
     "why": "Router picks the nearest free slot; each label sits immediately right of its own stem (control gRPC right of the down stem at col 12/25, events gRPC right of the return corridor at col 27/40).",
     "impact": "Attribution is correct but must be confirmed by following each stem; a reader could mistake the neighbouring bar for a delimiter.",
     "attempted_fix": "overview v2 (edge order) and seams v2 (lr) — neither removed it; lr also overflowed the pane."},
    {"id": "D2", "views": ["overview", "execution"], "severity": "minor",
     "what": "'starts/manages' is printed on the arrowhead row, between the two arrowheads (overview line 30 cols 14-27; execution line 22 cols 23-36).",
     "impact": "It belongs to engine→backend (the left arrow) but sits between two arrowheads, so a hasty reader could attach it to engine→filesystem.",
     "attempted_fix": "execution v2 (swapped layer order) moves the label but reproduces the same row-of-arrowheads placement.",
     "effect_on_meaning": "none — the edge and its label are both present and unmodified."},
    {"id": "D3", "views": ["overview"], "severity": "minor",
     "what": "worker→runtime enters runtime's top border at col 11, the same column where runtime's out-stem toward engine leaves the bottom (col 11, jogging to col 12).",
     "impact": "Column-aligned in/out can read as a pass-through edge; the ▼ arrowhead on line 13 terminates the inbound edge, and the outbound stem is labelled 'task dispatch'.",
     "effect_on_meaning": "none — both directions exist separately in the spec and in the render."},
    {"id": "D4", "views": ["seams"], "severity": "minor",
     "what": "'fs HTTP over UDS' ends flush against the engine's vertical corridor: line 29 reads 'fs HTTP over UDS│'.",
     "impact": "The label starts at the daemon corner it descends from, so attribution is right, but the adjacent bar can look like part of the label's edge.",
     "effect_on_meaning": "none."},
    {"id": "D5", "views": ["overview", "seams", "execution"], "severity": "cosmetic",
     "what": "The viewer's own header line is longer than 77 columns and is clipped mid-word ('… drag pan · scr', '… drag pan · scroll').",
     "impact": "Viewer chrome only; no diagram content is clipped and no 'graph overflows' badge appears in any view."},
    {"id": "D6", "views": ["overview", "seams", "execution"], "severity": "observation",
     "what": "Selection is expressed only as a border-colour change to the accent #d8a657, which is also layer 1's hue in the gruvbox theme.",
     "impact": "Selected vs unselected is provable from the ANSI captures (worker/backend/filesystem borders change) but not from plain text; no handle glyphs change. Reported because the task asks for both states to be inspectable.",
     "ownership": "renderer/theme behaviour, not spec — no spec change can alter it."},
]

BLOCKERS = []

UNMET = [
    "No label-placement control in the spec: edge labels are assigned free slots by the router, so D1/D2/D4 cannot be resolved further from the spec side without moving boxes (which would change the intended reading order).",
    "No animation was requested by the source, so 0 flows and no frame series exist; the pane is still interactive (drag/pan/zoom/fit), which the static captures cannot show.",
]

CLEANUP = {
    "panes_created": ["w7E:p2Z", "w7E:p39", "w7E:p3F", "w7E:p3K", "w7E:p3N", "w7E:p3S", "w7E:p3W"],
    "panes_closed_by_self_closing_launch": "all 7 (each ran the skill's '<viewer> <spec>; herdr pane close <pane>' command and exited on 'q')",
    "panes_closed_manually": [],
    "failures": [],
    "final_state": "tab w7E:tP contains only the generator's own pane w7E:p2V (verified with 'herdr pane list' and 'herdr pane layout')",
    "other_agents_panes_touched": "none",
}

generation = {
    "case_id": "modal-runtime",
    "round": "01",
    "generator": {
        "role": "fresh diagram generator (replaces the user-cancelled Astra generation round; none of its artifacts reused)",
        "subagent_name": "viz-ds01-modal-runtime",
        "subagent_id": "2cc07bfe",
        "session_id": "01a19b5b-dfbc-769c-9d57-59cbe78d41e5",
        "session_file": "/Users/aviral/.pi/agent/sessions/--Users-aviral-.herdr-worktrees-dotfiles-fix-visualize-skill--/2026-11-02T08-24-11-174Z_2cc07bfe-0b73dbf2-e1d8e006-b42b.jsonl",
        "provider": "fireworks",
        "model": "fireworks/accounts/fireworks/routers/deepseek-flash-latest",
        "model_id": "accounts/fireworks/routers/deepseek-flash-latest",
        "reasoning_level": "high",
        "harness": "pi coding agent (PI_CODING_AGENT=true) inside herdr 0.9.3, tab w7E:tP",
        "judges_spawned": 0,
        "reviewer_spawned": 0,
        "review_note": "The candidate skill's review section was deliberately not executed: judges are captain-owned. No approval is claimed.",
    },
    "inputs": {
        "candidate_skill": {
            "path": "docs/visualize-eval/rounds/01/SKILL.md",
            "sha256": "9c5cea272a88300644cacda52c853c7c9169eeec91f0355d3460ee8741308d92",
            "matches_frozen_value": hashlib.sha256(
                pathlib.Path("/Users/aviral/.herdr/worktrees/dotfiles/fix-visualize-skill/docs/visualize-eval/rounds/01/SKILL.md").read_bytes()
            ).hexdigest(),
            "read_fresh": True,
            "installed_skill_used": False,
        },
        "renderer": {
            "path": "/tmp/visualize-eval/round-01/bin/rataflow-view",
            "sha256": "4a883e73b822f009c504bd21d0c2fc383067bf1b83b9791ccbda431912e3a1d8",
            "global_binary_used": False,
            "built_or_installed": False,
        },
        "case_source": {
            "path": "docs/visualize-eval/cases/modal-runtime/source.md",
            "read": ["Task", "Source (pointer list)", "Original line 5", "Original line 12",
                     "Original line 55", "Relationship facts", "Fixed constraints"],
            "not_read": ["expected.json", "historical-variants.json", "rubric.json",
                         "previous generations", "critiques", "original session jsonl beyond the quoted lines"],
        },
    },
    "viewport": {
        "target": "77 columns x 47 rows at natural 100% zoom",
        "measured": "77 columns x 47 rows",
        "matches_target": True,
        "method": "stty size run inside each viewer pane before the viewer started; every pane reported '47 77' (rows cols)",
        "measurement_files": ["evidence/overview.tty-size.txt", "evidence/seams.tty-size.txt",
                              "evidence/execution.tty-size.txt", "evidence/seams-v1.tty-size.txt",
                              "evidence/overview-v2.tty-size.txt", "evidence/seams-v3.tty-size.txt",
                              "evidence/execution-v2.tty-size.txt"],
        "split": "herdr pane split --current --direction right --ratio 0.5 --cwd <case dir> --no-focus → 79x49 pane rect (80-col sibling), 77x47 tty",
        "panned_or_zoomed": "never; no 'f' key, no scroll, no drag in any capture",
        "overflow_badge_seen": False,
    },
    "views": VIEWS,
    "relationship_coverage": {
        "original_components": ["modal-worker", "modal-runtime", "Task engine", "Container backend",
                                "Task container", "Filesystem + volumes", "Blobnet", "modal-daemon"],
        "original_directed_relations": len(COVERAGE),
        "relations": COVERAGE,
        "coverage_summary": "overview shows all 8 components and all 8 relations in one layout; seams repeats R1, R2, R3, R8 with room between the two opposite gRPC edges; execution repeats R4, R5, R6, R7 with no backward edge. Every one of the 8 relations is visible in at least two views, and nothing is dropped, reversed, or relabelled.",
        "deliberate_abstractions": [
            "modal-daemon is placed in the same layer as Container backend and Filesystem + volumes because its only relation is runtime → daemon; layer position expresses 'adjacent to the storage layer', not a claim of physical co-location.",
            "Edge labels are shortened to fit 14-character slots (task input + control RPCs → 'control gRPC'; events + management RPCs → 'events gRPC'; dispatches tasks → 'task dispatch'; runs the user process → 'runs process'; mounts / snapshots → 'mount/snapshot'; image + volume data → 'image/vol data'; filesystem HTTP over UDS → 'fs HTTP over UDS'). Abbreviations are expanded below.",
        ],
    },
    "abbreviations": {
        "gRPC": "the worker RPC seams (task input + control RPCs, events + management RPCs)",
        "UDS": "Unix-domain socket",
        "fs": "filesystem",
        "vol": "volume",
    },
    "source_pointers": [
        "cases/modal-runtime/source.md → 'Task': visualize modal-runtime and its internal components, keeping seams, modules and RPC paths readable.",
        "source.md → 'Original line 5' and 'Original line 12' (identical user request): modal-runtime and its internal components, keep readable, research seams/modules/RPCs first.",
        "source.md → 'Original line 55': the historical attempt claimed task orchestration, container backends, storage and three worker RPC seams, kept distinct.",
        "source.md → 'Relationship facts' (the 8 nodes and 8 directed relations reproduced above).",
        "source.md → 'Fixed constraints': preserve all 8 components and 8 relations; show worker→runtime and runtime→worker separately or as an explicitly bidirectional labelled relation (this output uses two separate edges); HTTP over UDS is not the same interface as worker gRPC.",
        "source.md → 'Fixed constraints': historical references are go and Rust runtime source discussed at original chat lines 27-51; those lines were not read and no remote execution was performed, so every claim here is qualified as historical evidence from the brief.",
    ],
    "qualifications": [
        "All facts are historical claims from the brief, not verified against the modal-runtime source tree. Edge labels keep the brief's wording rather than asserting current implementation detail.",
        "The brief does not state which daemon endpoint serves which filesystem path; runtime → daemon is drawn with the brief's single relation and label only.",
        "No relation was inferred beyond the 8 listed; no component was added (e.g. no 'blobnet client' or 'gRPC transport' nodes).",
    ],
    "attempts": ATTEMPTS,
    "known_defects": DEFECTS,
    "blockers": BLOCKERS,
    "unmet_needs": UNMET,
    "evidence": {
        "commands": "evidence/commands.md",
        "manifest": "evidence/manifest.tsv",
        "split_jsons": "evidence/*.split.json",
        "launch_commands": "evidence/*.launch-cmd.txt",
        "timelines": "evidence/*.timeline.txt",
        "analysis_scripts": ["evidence/analyze_ansi.py", "evidence/trace_ansi.py"],
        "spec_hashes": "evidence/spec-hashes.txt",
        "final_spec_sha256": {
            "spec/overview.json": sha("spec/overview.json"),
            "spec/seams.json": sha("spec/seams.json"),
            "spec/execution.json": sha("spec/execution.json"),
        },
        "capture_sha256": {
            rel: sha(rel) for rel in [
                "captures/overview.text.none.txt", "captures/overview.ansi.none.txt",
                "captures/overview.text.sel-tab.txt", "captures/overview.ansi.sel-tab.txt",
                "captures/overview.text.sel-right.txt", "captures/overview.ansi.sel-right.txt",
                "captures/seams.text.none.txt", "captures/seams.ansi.none.txt",
                "captures/seams.text.sel-tab.txt", "captures/seams.ansi.sel-tab.txt",
                "captures/seams.text.sel-right.txt", "captures/seams.ansi.sel-right.txt",
                "captures/execution.text.none.txt", "captures/execution.ansi.none.txt",
                "captures/execution.text.sel-tab.txt", "captures/execution.ansi.sel-tab.txt",
                "captures/execution.text.sel-right.txt", "captures/execution.ansi.sel-right.txt",
            ]
        },
    },
    "cleanup": CLEANUP,
    "self_assessment": {
        "verdict": "not self-certified",
        "statement": "Checks were clean (exit 0, empty stderr, no density/corridor/label warnings) and the captures were measured, but a clean check is not a visual pass. D1-D4 are label-placement defects that remain in the final views, and no independent judge has reviewed this output.",
    },
    "not_done": [
        "No renderer, installed skill, example, rubric, expected-data, other-case or earlier-round file was read or modified.",
        "No build, install, remote command, or commit.",
        "No reviewer/judge subagent was spawned.",
    ],
}

OUT.write_text(json.dumps(generation, indent=2, sort_keys=False) + "\n")
print(f"wrote {OUT} ({size('generation.json')} bytes)")
