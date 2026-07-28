#!/usr/bin/env python3
"""PROTOTYPE: three Atlas Preview variants for Sidekick's bottom-right pane."""
import argparse
import re

RESET = "\033[0m"
COLORS = {
    "heading": "\033[1;38;2;242;133;52m",
    "text": "\033[38;2;235;219;178m",
    "muted": "\033[38;2;146;131;116m",
    "active": "\033[38;2;233;177;67m",
    "success": "\033[38;2;184;187;38m",
    "info": "\033[38;2;128;170;158m",
}
ANSI = re.compile(r"\033\[[0-9;]*m")


def clip(text, width):
    if len(text) <= width:
        return text
    return text[: max(0, width - 1)] + "…"


def paint(line):
    stripped = line.lstrip()
    role = "text"
    if line.startswith("T21") or line.startswith("RUN ") or line.startswith("RECORDED"):
        role = "heading"
    elif "◉" in line or "active" in line.lower():
        role = "active"
    elif "●" in line or "passed" in line.lower() or "done" in line.lower():
        role = "success"
    elif stripped.startswith(("Goal", "Evidence", "Participant", "Latest")):
        role = "info"
    elif stripped == "" or set(stripped) <= set("─│├└○ "):
        role = "muted"
    return COLORS[role] + line + RESET if line else ""


def variants(width):
    return {
        "A — Status card": [
            "T21  Atlas timeline",
            "run-a17 · rev 7",
            "",
            "◉ verifier · active",
            "Goal 3/5 · V02",
            "",
            "Participant driver",
            "Role verifier-steward",
            "Evidence V01 · passed",
            "",
            "updated 10:14 UTC",
            "recorded snapshot",
        ],
        "B — Mini journey": [
            "T21 · run-a17 · rev 7",
            "RECORDED JOURNEY · 3/5",
            "│",
            "├─ ● admission · done",
            "├─ ● V01 · passed",
            "├─ ◉ V02 · active",
            "├─ ○ review · pending",
            "└─ ○ landing · pending",
            "",
            "driver · verifier-steward",
            "latest 10:14 UTC",
            "projection, not authority",
        ],
        "C — Run dashboard": [
            "RUN STATUS · T21",
            "Atlas timeline",
            "",
            "◉ ACTIVE · verifier",
            "",
            "Goal         3/5 · V02",
            "Evidence     1 passed",
            "Participants 3 recorded",
            "Revision     7",
            "",
            "Latest  verifier active",
            "10:14 UTC · recorded",
        ],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--width", type=int, choices=(23, 30), default=30)
    parser.add_argument("--no-color", action="store_true")
    args = parser.parse_args()
    for name, lines in variants(args.width).items():
        print(f"\n{name} · {args.width}×12 interior")
        for line in lines:
            fitted = clip(line, args.width)
            print(fitted if args.no_color else paint(fitted))


if __name__ == "__main__":
    main()
