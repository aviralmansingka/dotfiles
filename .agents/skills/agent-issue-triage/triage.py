#!/usr/bin/env python3
"""Read-only discovery and dry triage for ordinary vault issue notes."""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

SCALAR_FIELDS = {"status", "epic", "feature", "order", "priority"}


@dataclass
class Issue:
    path: Path
    relative_path: str
    project: str
    feature: str
    status: str
    title: str
    order: int | None
    priority: str | None
    outcome: str
    next_action: str
    disposition: str


def scalar(value: str) -> str | None:
    value = re.sub(r"\s+#.*$", "", value.strip())
    if not value or value[0] in "[{|>":
        return None
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        value = value[1:-1]
    return value.strip() or None


def frontmatter(text: str) -> tuple[dict[str, str] | None, str | None, list[str]]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return None, "missing opening frontmatter delimiter", lines

    try:
        end = next(i for i in range(1, len(lines)) if lines[i].strip() == "---")
    except StopIteration:
        return None, "missing closing frontmatter delimiter", lines

    fields: dict[str, str] = {}
    for line_number, line in enumerate(lines[1:end], 2):
        if not line.strip() or line.lstrip().startswith(("#", "-")) or line[:1].isspace():
            continue
        match = re.match(r"^([A-Za-z0-9_-]+)\s*:\s*(.*)$", line)
        if not match:
            return None, f"malformed frontmatter at line {line_number}", lines[end + 1 :]
        key, raw_value = match.group(1).lower(), match.group(2)
        if key not in SCALAR_FIELDS:
            continue
        if key in fields:
            return None, f"duplicate {key!r} frontmatter field", lines[end + 1 :]
        value = scalar(raw_value)
        if value is None:
            return None, f"{key!r} must be a scalar value", lines[end + 1 :]
        fields[key] = value

    return fields, None, lines[end + 1 :]


def triage_values(body: list[str]) -> tuple[str, str, str]:
    values: dict[str, str] = {}
    in_triage = False
    labels = {
        "user-facing outcome": "outcome",
        "smallest next action": "next_action",
        "disposition": "disposition",
    }
    for raw_line in body:
        if re.match(r"^##\s+Triage\s*$", raw_line, re.IGNORECASE):
            in_triage = True
            continue
        if in_triage and raw_line.startswith("## "):
            break
        if not in_triage:
            continue
        line = raw_line.replace("**", "")
        match = re.match(r"^\s*-?\s*([^:]+):\s*(.*?)\s*$", line)
        if match and match.group(1).strip().lower() in labels and match.group(2):
            values[labels[match.group(1).strip().lower()]] = match.group(2)

    return (
        values.get("outcome", "Unresolved"),
        values.get("next_action", "Unresolved"),
        values.get("disposition", "Untriaged"),
    )


def issue_candidates(project_root: Path) -> list[tuple[Path, str | None]]:
    candidates: list[tuple[Path, str | None]] = []
    issue_root = project_root / "issues"
    if issue_root.is_dir():
        candidates.extend((path, None) for path in issue_root.glob("*.md"))

    themes = project_root / "themes"
    if themes.is_dir():
        for path in themes.rglob("*.md"):
            parts = path.relative_to(project_root).parts
            for index, part in enumerate(parts):
                if part == "features" and len(parts) == index + 4 and parts[index + 2] == "issues":
                    candidates.append((path, parts[index + 1]))
                    break
    return sorted(candidates, key=lambda item: item[0].as_posix())


def discover(vault: Path, projects: list[str]) -> tuple[list[Issue], list[str]]:
    issues: list[Issue] = []
    diagnostics: list[str] = []
    root = vault / "1_projects"

    for project in projects:
        project_root = root / project
        if not project_root.is_dir():
            diagnostics.append(f"1_projects/{project}: project directory not found")
            continue
        for path, owning_feature in issue_candidates(project_root):
            relative_path = path.relative_to(vault).as_posix()
            try:
                text = path.read_text(encoding="utf-8")
            except (OSError, UnicodeError) as error:
                diagnostics.append(f"{relative_path}: unreadable: {error}")
                continue

            fields, error, body = frontmatter(text)
            if error:
                diagnostics.append(f"{relative_path}: {error}")
                continue
            assert fields is not None
            if "status" not in fields:
                diagnostics.append(f"{relative_path}: missing frontmatter status")
                continue
            if fields["status"].casefold() == "done":
                continue

            order: int | None = None
            if "order" in fields:
                if not re.fullmatch(r"[+-]?\d+", fields["order"]):
                    diagnostics.append(f"{relative_path}: order must be an integer")
                    continue
                order = int(fields["order"])

            epic = fields.get("epic")
            if epic and epic != project:
                diagnostics.append(
                    f"{relative_path}: epic {epic!r} conflicts with path project {project!r}"
                )

            title = next(
                (line[2:].strip() for line in body if line.startswith("# ") and line[2:].strip()),
                path.stem.replace("-", " ").title(),
            )
            outcome, next_action, disposition = triage_values(body)
            issues.append(
                Issue(
                    path=path,
                    relative_path=relative_path,
                    project=project,
                    feature=owning_feature or fields.get("feature", "Unassigned"),
                    status=fields["status"],
                    title=title,
                    order=order,
                    priority=fields.get("priority"),
                    outcome=outcome,
                    next_action=next_action,
                    disposition=disposition,
                )
            )

    issues.sort(
        key=lambda issue: (
            issue.project.casefold(),
            issue.feature.casefold(),
            issue.order is None,
            issue.order or 0,
            issue.priority is None,
            (issue.priority or "").casefold(),
            issue.title.casefold(),
            issue.relative_path,
        )
    )
    return issues, sorted(diagnostics)


def render(vault: Path, projects: list[str]) -> str:
    issues, diagnostics = discover(vault, projects)
    lines = ["# Issue dry triage (read-only)", "", f"Projects: {', '.join(projects)}"]
    if diagnostics:
        lines.extend(["", "## Diagnostics"])
        lines.extend(f"- {diagnostic}" for diagnostic in diagnostics)

    for project in projects:
        lines.extend(["", f"## Project: {project}"])
        project_issues = [issue for issue in issues if issue.project == project]
        if not project_issues:
            lines.append("No open ordinary issues.")
            continue
        current_feature = None
        for issue in project_issues:
            if issue.feature != current_feature:
                current_feature = issue.feature
                lines.extend(["", f"### Feature: {current_feature}"])
            lines.extend(
                [
                    "",
                    f"#### {issue.title}",
                    f"- Path: {issue.relative_path}",
                    f"- Project: {issue.project}",
                    f"- Feature: {issue.feature}",
                    f"- Current status: {issue.status}",
                    f"- User-facing outcome: {issue.outcome}",
                    f"- Smallest next action: {issue.next_action}",
                    f"- Disposition: {issue.disposition}",
                ]
            )
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vault", type=Path, required=True)
    parser.add_argument("--projects", default="neovim,pi-agent")
    args = parser.parse_args()
    projects = sorted(
        dict.fromkeys(project.strip() for project in args.projects.split(",") if project.strip()),
        key=str.casefold,
    )
    if not projects or any(project in {".", ".."} or "/" in project for project in projects):
        parser.error("--projects must be a comma-separated list of project directory names")
    print(render(args.vault.expanduser().resolve(), projects), end="")
    return 0


if __name__ == "__main__":
    sys.exit(main())
