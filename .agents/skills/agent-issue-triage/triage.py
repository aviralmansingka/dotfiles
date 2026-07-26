#!/usr/bin/env python3
"""Discover, review, and safely update ordinary vault issue notes."""

from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import os
import re
import stat
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SCALAR_FIELDS = {"status", "epic", "feature", "order", "priority"}
ACTIONS = {"keep", "defer", "close", "split"}


class TriageError(Exception):
    """An expected validation or mutation error."""


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


@dataclass
class Change:
    path: Path
    relative_path: str
    old: bytes | None
    new: bytes


@dataclass
class Plan:
    action: str
    issue: Issue
    changes: list[Change]


def scalar(value: str) -> str | None:
    value = re.sub(r"\s+#.*$", "", value.strip())
    if not value or value[0] in "[{|>":
        return None
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        value = value[1:-1]
    return value.strip() or None


def priority_scalar(value: Any, label: str = "priority") -> str:
    normalized = value.strip() if isinstance(value, str) else ""
    if (
        not re.fullmatch(r"[A-Za-z][A-Za-z0-9 ._-]*", normalized)
        or normalized.casefold() in {"null", "true", "false", "yes", "no", "on", "off"}
    ):
        raise TriageError(
            f"{label} must begin with a letter and contain only letters, numbers, "
            "spaces, dots, underscores, or hyphens"
        )
    return normalized


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
    headings = [
        i for i, line in enumerate(body) if re.match(r"^##\s+Triage\s*$", line, re.I)
    ]
    labels = {
        "user-facing outcome": "outcome",
        "smallest next action": "next_action",
        "disposition": "disposition",
    }
    start = headings[-1] + 1 if headings else len(body)
    for raw_line in body[start:]:
        if raw_line.startswith("## "):
            break
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


def resolve_issue_reference(vault: Path, projects: list[str], reference: str) -> Issue:
    """Resolve only an exact path or an exact, unique issue title."""
    issues, _ = discover(vault, projects)
    reference = reference.strip()
    path_matches = [issue for issue in issues if issue.relative_path == reference]
    if path_matches:
        return path_matches[0]

    title_matches = [issue for issue in issues if issue.title.casefold() == reference.casefold()]
    if len(title_matches) == 1:
        return title_matches[0]
    if len(title_matches) > 1:
        paths = ", ".join(issue.relative_path for issue in title_matches)
        raise TriageError(f"issue identity is ambiguous; clarify with an exact path: {paths}")
    raise TriageError("issue identity was not found; clarify with an exact path or exact title")


def _resolve_inside_vault(vault: Path, path: Path, label: str) -> Path:
    resolved = path.resolve()
    try:
        resolved.relative_to(vault.resolve())
    except ValueError as error:
        raise TriageError(f"{label} must remain inside the vault") from error
    return resolved


def resolve_owner(vault: Path, projects: list[str], owner: str) -> tuple[str, str, Path]:
    """Resolve a named project/feature owner without guessing a theme."""
    parts = owner.strip().split("/")
    if len(parts) != 2 or any(
        not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", part) for part in parts
    ):
        raise TriageError("owner must name an existing project/feature")
    project, feature = parts
    if project not in projects:
        raise TriageError("owner project is not in the selected projects; clarify ownership")
    project_root = vault / "1_projects" / project
    _resolve_inside_vault(vault, project_root, "owner project path")
    matches = sorted(
        path for path in project_root.glob(f"themes/*/features/{feature}") if path.is_dir()
    )
    for path in matches:
        _resolve_inside_vault(vault, path, "owner feature path")
    if not matches:
        raise TriageError("owner was not found; clarify the project/feature owner")
    if len(matches) > 1:
        paths = ", ".join(path.relative_to(vault).as_posix() for path in matches)
        raise TriageError(f"owner is ambiguous; clarify the owning feature path: {paths}")
    return project, feature, matches[0]


def render(vault: Path, projects: list[str]) -> str:
    """Render the V01-compatible dry triage."""
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


def render_weekly(vault: Path, projects: list[str]) -> str:
    """Render all non-done ordinary issues without changing the vault."""
    issues, diagnostics = discover(vault, projects)
    lines = ["# Weekly issue review (read-only)", "", f"Projects: {', '.join(projects)}"]
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
            review_state = "Deferred" if issue.disposition.casefold() == "defer" else "Open"
            lines.extend(
                [
                    "",
                    f"#### {issue.title}",
                    f"- Path: {issue.relative_path}",
                    f"- Review state: {review_state}",
                    f"- Current status: {issue.status}",
                    f"- User-facing outcome: {issue.outcome}",
                    f"- Smallest next action: {issue.next_action}",
                    f"- Disposition: {issue.disposition}",
                ]
            )
    return "\n".join(lines) + "\n"


def _frontmatter_end(lines: list[str]) -> int:
    if not lines or lines[0].strip() != "---":
        raise TriageError("issue lost its opening frontmatter delimiter")
    try:
        return next(i for i in range(1, len(lines)) if lines[i].strip() == "---")
    except StopIteration as error:
        raise TriageError("issue lost its closing frontmatter delimiter") from error


def set_frontmatter_fields(text: str, updates: dict[str, str]) -> str:
    lines = text.splitlines()
    end = _frontmatter_end(lines)
    pending = dict(updates)
    for index in range(1, end):
        match = re.match(r"^([A-Za-z0-9_-]+)\s*:", lines[index])
        if match and match.group(1).lower() in pending:
            key = match.group(1).lower()
            lines[index] = f"{key}: {pending.pop(key)}"
    for key, value in pending.items():
        lines.insert(end, f"{key}: {value}")
        end += 1
    return "\n".join(lines) + "\n"


def set_triage(text: str, outcome: str, next_action: str, disposition: str) -> str:
    lines = text.splitlines()
    headings = [i for i, line in enumerate(lines) if re.match(r"^##\s+Triage\s*$", line, re.I)]
    values = {
        "user-facing outcome": outcome,
        "smallest next action": next_action,
        "disposition": disposition,
    }
    canonical = {
        "user-facing outcome": "User-facing outcome",
        "smallest next action": "Smallest next action",
        "disposition": "Disposition",
    }
    if not headings:
        if lines and lines[-1]:
            lines.append("")
        lines.extend(
            [
                "## Triage",
                "",
                f"- **User-facing outcome:** {outcome}",
                f"- **Smallest next action:** {next_action}",
                f"- **Disposition:** {disposition}",
            ]
        )
        return "\n".join(lines) + "\n"

    start = headings[-1]
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith("## ")), len(lines))
    seen: set[str] = set()
    rewritten: list[str] = []
    for line in lines[start + 1 : end]:
        plain = line.replace("**", "")
        match = re.match(r"^\s*-?\s*([^:]+):\s*.*$", plain)
        key = match.group(1).strip().lower() if match else ""
        if key not in values:
            rewritten.append(line)
        elif key not in seen:
            rewritten.append(f"- **{canonical[key]}:** {values[key]}")
            seen.add(key)
    while rewritten and not rewritten[-1]:
        rewritten.pop()
    if rewritten and rewritten[-1]:
        rewritten.append("")
    rewritten.extend(
        f"- **{canonical[key]}:** {values[key]}" for key in values if key not in seen
    )
    if end < len(lines) and rewritten and rewritten[-1]:
        rewritten.append("")
    lines[start + 1 : end] = rewritten
    return "\n".join(lines) + "\n"


def load_children(path: Path | None) -> list[dict[str, Any]]:
    if path is None:
        return []
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise TriageError(f"cannot read children JSON: {error}") from error
    if not isinstance(value, list):
        raise TriageError("children JSON must be a list")
    children: list[dict[str, Any]] = []
    required = ("slug", "title", "outcome", "next_action")
    for index, child in enumerate(value, 1):
        if not isinstance(child, dict):
            raise TriageError(f"child {index} must be an object")
        unknown = set(child) - {*required, "priority", "order"}
        if unknown:
            raise TriageError(f"child {index} has unknown fields: {', '.join(sorted(unknown))}")
        for key in required:
            if not isinstance(child.get(key), str) or not child[key].strip():
                raise TriageError(f"child {index} requires non-empty {key!r}")
        slug = child["slug"].strip()
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug):
            raise TriageError(f"child {index} slug must use lowercase letters, numbers, and hyphens")
        normalized = dict(child)
        if "priority" in child:
            normalized["priority"] = priority_scalar(
                child["priority"], f"child {index} priority"
            )
        if "order" in child and (
            isinstance(child["order"], bool) or not isinstance(child["order"], int)
        ):
            raise TriageError(f"child {index} order must be an integer")
        children.append(normalized)
    return children


def child_text(child: dict[str, Any], feature: str | None = None) -> str:
    lines = ["---", "status: open"]
    if feature is not None:
        lines.append(f"feature: {feature}")
    if "priority" in child:
        lines.append(f"priority: {priority_scalar(child['priority'])}")
    if "order" in child:
        lines.append(f"order: {child['order']}")
    lines.extend(
        [
            "---",
            f"# {child['title'].strip()}",
            "",
            "## Triage",
            "",
            f"- **User-facing outcome:** {child['outcome'].strip()}",
            f"- **Smallest next action:** {child['next_action'].strip()}",
            "- **Disposition:** keep",
            "",
        ]
    )
    return "\n".join(lines)


def telegram_voice_issue_text(
    owner: str,
    title: str,
    outcome: str,
    next_action: str,
    source_id: str,
    transcript: str,
) -> str:
    transcript = transcript.strip()
    lines = [
        "---",
        "status: open",
        "---",
        f"# {title.strip()}",
        "",
        "## Source",
        "",
        "- **Channel:** Telegram",
        "- **Kind:** voice note",
        f"- **Message ID:** {source_id.strip()}",
        f"- **Owner:** {owner}",
        f"- **Transcript:** {transcript}",
        "",
        "## Triage",
        "",
        f"- **User-facing outcome:** {outcome.strip()}",
        f"- **Smallest next action:** {next_action.strip()}",
        "- **Disposition:** keep",
        "",
    ]
    return "\n".join(lines)


def create_plan(
    vault: Path,
    projects: list[str],
    owner: str,
    slug: str,
    title: str,
    outcome: str,
    next_action: str,
    source_id: str,
    transcript: str,
) -> Plan:
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug):
        raise TriageError("issue slug must use lowercase letters, numbers, and hyphens")
    values = (title, outcome, next_action, source_id, transcript)
    if any(not value.strip() for value in values):
        raise TriageError("title, outcome, next action, source ID, and transcript must be non-empty")
    if any("\n" in value or "\r" in value for value in (title, source_id)):
        raise TriageError("title and source ID must each be one line")

    project, feature, feature_root = resolve_owner(vault, projects, owner)
    path = feature_root / "issues" / f"{slug}.md"
    _resolve_inside_vault(vault, path, "issue creation path")
    relative_path = path.relative_to(vault).as_posix()
    if path.exists():
        raise TriageError(f"issue already exists: {relative_path}")
    text = telegram_voice_issue_text(
        owner, title, outcome, next_action, source_id, transcript
    ).encode("utf-8")
    issue = Issue(
        path=path,
        relative_path=relative_path,
        project=project,
        feature=feature,
        status="open",
        title=title.strip(),
        order=None,
        priority=None,
        outcome=outcome.strip(),
        next_action=next_action.strip(),
        disposition="keep",
    )
    return Plan("create", issue, [Change(path, relative_path, None, text)])


def mutation_plan(
    vault: Path,
    projects: list[str],
    issue_path: str,
    action: str,
    outcome: str,
    next_action: str,
    priority: str | None = None,
    order: int | None = None,
    children: list[dict[str, Any]] | None = None,
) -> Plan:
    if action not in ACTIONS:
        raise TriageError(f"unsupported action: {action}")
    if not outcome.strip() or not next_action.strip():
        raise TriageError("outcome and next action must both be non-empty")
    normalized_priority = None if priority is None else priority_scalar(priority)

    requested = vault / issue_path
    _resolve_inside_vault(vault, requested, "issue path")
    issues, _ = discover(vault, projects)
    issue = next(
        (candidate for candidate in issues if candidate.relative_path == issue_path), None
    )
    if issue is None:
        raise TriageError("issue is not an open ordinary issue in the selected projects")
    if issue.path.is_symlink():
        raise TriageError("issue path must not be a symbolic link")

    try:
        old = issue.path.read_bytes()
        text = old.decode("utf-8")
    except (OSError, UnicodeError) as error:
        raise TriageError(f"cannot read issue: {error}") from error

    updates: dict[str, str] = {}
    if action in {"close", "split"}:
        updates["status"] = "done"
    if normalized_priority is not None:
        updates["priority"] = normalized_priority
    if order is not None:
        updates["order"] = str(order)
    parent_text = set_triage(
        set_frontmatter_fields(text, updates), outcome.strip(), next_action.strip(), action
    )
    parent_change = Change(issue.path, issue.relative_path, old, parent_text.encode("utf-8"))

    child_specs = children or []
    if action != "split" and child_specs:
        raise TriageError("children are valid only for split")
    if action == "split":
        if len(child_specs) < 2:
            raise TriageError("split requires at least two confirmed children")
        slugs = [child["slug"].strip() for child in child_specs]
        if len(slugs) != len(set(slugs)):
            raise TriageError("split child slugs must be unique")
        parent_fields, _, _ = frontmatter(text)
        assert parent_fields is not None
        project_issue_root = vault / "1_projects" / issue.project / "issues"
        child_feature = (
            parent_fields.get("feature")
            if issue.path.parent == project_issue_root
            else None
        )
        changes: list[Change] = []
        for child in child_specs:
            path = issue.path.parent / f"{child['slug'].strip()}.md"
            if path.exists():
                raise TriageError(f"split child already exists: {path.relative_to(vault).as_posix()}")
            changes.append(
                Change(
                    path,
                    path.relative_to(vault).as_posix(),
                    None,
                    child_text(child, child_feature).encode("utf-8"),
                )
            )
        changes.append(parent_change)
        return Plan(action, issue, changes)
    return Plan(action, issue, [parent_change])


def plan_token(plan: Plan) -> str:
    digest = hashlib.sha256()
    digest.update(plan.action.encode())
    for change in plan.changes:
        digest.update(b"\0" + change.relative_path.encode() + b"\0")
        digest.update(b"MISSING" if change.old is None else hashlib.sha256(change.old).digest())
        digest.update(hashlib.sha256(change.new).digest())
    return digest.hexdigest()[:20]


def render_preview(plan: Plan) -> str:
    lines = [f"# Mutation preview: {plan.action}", f"Issue: {plan.issue.relative_path}", ""]
    for change in plan.changes:
        old_lines = [] if change.old is None else change.old.decode("utf-8").splitlines(keepends=True)
        new_lines = change.new.decode("utf-8").splitlines(keepends=True)
        lines.extend(
            line.rstrip("\n")
            for line in difflib.unified_diff(
                old_lines,
                new_lines,
                fromfile="/dev/null" if change.old is None else f"a/{change.relative_path}",
                tofile=f"b/{change.relative_path}",
            )
        )
        lines.append("")
    lines.append(f"Confirmation token: {plan_token(plan)}")
    lines.append("No files changed. Apply only after the user confirms this exact preview.")
    return "\n".join(lines) + "\n"


def _verify_unchanged(plan: Plan) -> None:
    for change in plan.changes:
        if change.old is None:
            if change.path.exists():
                raise TriageError(f"planned new file now exists: {change.relative_path}")
        else:
            try:
                current = change.path.read_bytes()
            except OSError as error:
                raise TriageError(f"cannot re-read {change.relative_path}: {error}") from error
            if current != change.old:
                raise TriageError(f"issue changed after preview: {change.relative_path}")


def _stage(change: Change) -> Path:
    descriptor: int | None = None
    temporary: Path | None = None
    staged = False
    try:
        descriptor, name = tempfile.mkstemp(prefix=f".{change.path.name}.", dir=change.path.parent)
        temporary = Path(name)
        handle = os.fdopen(descriptor, "wb")
        descriptor = None
        with handle:
            handle.write(change.new)
            handle.flush()
            os.fsync(handle.fileno())
        mode = 0o644 if change.old is None else stat.S_IMODE(change.path.stat().st_mode)
        os.chmod(temporary, mode)
        staged = True
        return temporary
    except OSError as error:
        raise TriageError(f"cannot stage {change.relative_path}: {error}") from error
    finally:
        if descriptor is not None:
            try:
                os.close(descriptor)
            except OSError:
                pass
        if temporary is not None and not staged:
            try:
                temporary.unlink()
            except OSError:
                pass


def _publish_new(staged: Path, target: Path) -> None:
    os.link(staged, target)


def apply_plan(plan: Plan) -> None:
    _verify_unchanged(plan)
    staged: list[tuple[Change, Path]] = []
    created_directory: Path | None = None
    if plan.action == "create":
        parent = plan.changes[0].path.parent
        try:
            if not parent.exists():
                parent.mkdir()
                created_directory = parent
            elif not parent.is_dir():
                raise TriageError(f"issue parent is not a directory: {parent}")
        except OSError as error:
            raise TriageError(f"cannot create issue directory: {error}") from error
    try:
        for change in plan.changes:
            staged.append((change, _stage(change)))
        if plan.action != "split":
            try:
                if plan.action == "create":
                    _publish_new(staged[0][1], staged[0][0].path)
                else:
                    os.replace(staged[0][1], staged[0][0].path)
            except OSError as error:
                raise TriageError(f"mutation was not applied: {error}") from error
            return

        published: list[Path] = []
        try:
            for change, temporary in staged[:-1]:
                _publish_new(temporary, change.path)
                published.append(change.path)
            os.replace(staged[-1][1], staged[-1][0].path)
        except OSError as error:
            for path in reversed(published):
                try:
                    path.unlink()
                except FileNotFoundError:
                    pass
            raise TriageError(f"split was not applied: {error}") from error
    finally:
        for _, temporary in staged:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass
        if created_directory is not None and not plan.changes[0].path.exists():
            try:
                created_directory.rmdir()
            except OSError:
                pass


def parse_projects(raw: str, parser: argparse.ArgumentParser) -> list[str]:
    projects = sorted(
        dict.fromkeys(project.strip() for project in raw.split(",") if project.strip()),
        key=str.casefold,
    )
    if not projects or any(project in {".", ".."} or "/" in project for project in projects):
        parser.error("--projects must be a comma-separated list of project directory names")
    return projects


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vault", type=Path, required=True)
    parser.add_argument("--projects", default="neovim,pi-agent")
    parser.add_argument("--weekly", action="store_true", help="render a read-only weekly review")
    parser.add_argument("--issue", help="exact vault-relative ordinary issue path to mutate")
    parser.add_argument("--issue-reference", help="exact path or exact, unique issue title")
    parser.add_argument("--action", choices=sorted(ACTIONS))
    parser.add_argument("--create-owner", metavar="PROJECT/FEATURE")
    parser.add_argument("--slug")
    parser.add_argument("--title")
    parser.add_argument("--source-id", help="Telegram voice-note message identifier")
    parser.add_argument("--transcript", help="Telegram voice-note transcript")
    parser.add_argument("--outcome")
    parser.add_argument("--next-action")
    parser.add_argument("--priority")
    parser.add_argument("--order", type=int)
    parser.add_argument("--children-file", type=Path)
    parser.add_argument("--apply", metavar="TOKEN", help="apply an already confirmed preview token")
    args = parser.parse_args()
    projects = parse_projects(args.projects, parser)
    vault = args.vault.expanduser().resolve()

    mutation_requested = any(
        value is not None
        for value in (
            args.issue,
            args.issue_reference,
            args.action,
            args.create_owner,
            args.slug,
            args.title,
            args.source_id,
            args.transcript,
            args.outcome,
            args.next_action,
            args.priority,
            args.order,
            args.children_file,
            args.apply,
        )
    )
    if args.weekly and mutation_requested:
        parser.error("--weekly cannot be combined with mutation options")
    if args.weekly:
        print(render_weekly(vault, projects), end="")
        return 0
    if not mutation_requested:
        print(render(vault, projects), end="")
        return 0
    creation_requested = any(
        value is not None
        for value in (args.create_owner, args.slug, args.title, args.source_id, args.transcript)
    )
    if creation_requested:
        if any(
            value is not None
            for value in (
                args.issue,
                args.issue_reference,
                args.action,
                args.priority,
                args.order,
                args.children_file,
            )
        ):
            parser.error("voice-note creation cannot be combined with update options")
        if not all(
            (
                args.create_owner,
                args.slug,
                args.title,
                args.outcome,
                args.next_action,
                args.source_id,
                args.transcript,
            )
        ):
            parser.error(
                "voice-note creation requires --create-owner, --slug, --title, --outcome, "
                "--next-action, --source-id, and --transcript"
            )
    else:
        if bool(args.issue) == bool(args.issue_reference):
            parser.error("update requires exactly one of --issue or --issue-reference")
        if not all((args.action, args.outcome, args.next_action)):
            parser.error("update requires --action, --outcome, and --next-action")

    try:
        if creation_requested:
            plan = create_plan(
                vault,
                projects,
                args.create_owner,
                args.slug,
                args.title,
                args.outcome,
                args.next_action,
                args.source_id,
                args.transcript,
            )
        else:
            issue_path = args.issue
            if args.issue_reference:
                issue_path = resolve_issue_reference(
                    vault, projects, args.issue_reference
                ).relative_path
            assert issue_path is not None
            plan = mutation_plan(
                vault,
                projects,
                issue_path,
                args.action,
                args.outcome,
                args.next_action,
                args.priority,
                args.order,
                load_children(args.children_file),
            )
        token = plan_token(plan)
        if args.apply is None:
            print(render_preview(plan), end="")
            return 0
        if args.apply != token:
            raise TriageError("confirmation token does not match the current mutation preview")
        apply_plan(plan)
        if plan.action == "create":
            print(f"Created issue: {plan.issue.relative_path}")
        else:
            print(f"Applied {plan.action}: {plan.issue.relative_path}")
        return 0
    except TriageError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
