#!/usr/bin/env python3
"""Deterministic V02 regression checks for the bundled manual vault."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SKILL = Path(__file__).resolve().parent
HELPER = SKILL / "triage.py"
FIXTURE = SKILL / "fixtures" / "manual-vault"
EXPECTED_WEEKLY = SKILL / "fixtures" / "expected-weekly.txt"

spec = importlib.util.spec_from_file_location("triage_v02", HELPER)
assert spec and spec.loader
triage = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = triage
spec.loader.exec_module(triage)


def manifest(root: Path) -> dict[str, str]:
    return {
        path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


def fields(path: Path) -> dict[str, str]:
    parsed, error, _ = triage.frontmatter(path.read_text(encoding="utf-8"))
    if error:
        raise AssertionError(error)
    assert parsed is not None
    return parsed


class V02Tests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.vault = self.root / "vault"
        shutil.copytree(FIXTURE, self.vault)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def command(self, *arguments: str) -> list[str]:
        return [
            "python3",
            str(HELPER),
            "--vault",
            str(self.vault),
            "--projects",
            "neovim,pi-agent",
            *arguments,
        ]

    def preview_and_apply(self, *arguments: str) -> str:
        preview = subprocess.run(
            self.command(*arguments), check=True, text=True, capture_output=True
        ).stdout
        match = re.search(r"^Confirmation token: ([0-9a-f]+)$", preview, re.MULTILINE)
        self.assertIsNotNone(match)
        subprocess.run(
            self.command(*arguments, "--apply", match.group(1)),
            check=True,
            text=True,
            capture_output=True,
        )
        return preview

    def children_file(self) -> Path:
        path = self.root / "children.json"
        path.write_text(
            json.dumps(
                [
                    {
                        "slug": "first-child",
                        "title": "First Child",
                        "outcome": "Users can see the first result",
                        "next_action": "Run the first focused check",
                        "order": 1,
                    },
                    {
                        "slug": "second-child",
                        "title": "Second Child",
                        "outcome": "Users can see the second result",
                        "next_action": "Run the second focused check",
                        "order": 2,
                    },
                ]
            ),
            encoding="utf-8",
        )
        return path

    def test_fixture_shape_and_weekly_listing_are_deterministic(self) -> None:
        issues, diagnostics = triage.discover(self.vault.resolve(), ["neovim", "pi-agent"])
        self.assertEqual(diagnostics, [])
        self.assertEqual(
            [issue.title for issue in issues],
            [
                "Keep Candidate",
                "Defer Candidate",
                "Close Candidate",
                "Already Deferred",
                "Split Candidate",
                "Weekly Open",
            ],
        )
        command = self.command("--weekly")
        first = subprocess.run(command, check=True, text=True, capture_output=True).stdout
        second = subprocess.run(command, check=True, text=True, capture_output=True).stdout
        self.assertEqual(first, second)
        self.assertEqual(first, EXPECTED_WEEKLY.read_text(encoding="utf-8"))
        self.assertIn("#### Already Deferred", first)
        self.assertNotIn("Already Closed", first)

    def test_preview_rejection_changes_nothing(self) -> None:
        before = manifest(self.vault)
        preview = subprocess.run(
            self.command(
                "--issue",
                "1_projects/neovim/issues/keep-candidate.md",
                "--action",
                "keep",
                "--outcome",
                "Keep the useful behavior visible",
                "--next-action",
                "Run one focused check",
            ),
            check=True,
            text=True,
            capture_output=True,
        ).stdout
        self.assertIn("No files changed", preview)
        self.assertEqual(manifest(self.vault), before)

    def test_approved_keep_defer_and_close_statuses(self) -> None:
        cases = (
            ("keep-candidate.md", "keep", "open"),
            ("defer-candidate.md", "defer", "proposed"),
            ("close-candidate.md", "close", "done"),
        )
        for name, action, expected_status in cases:
            relative = f"1_projects/neovim/issues/{name}"
            self.preview_and_apply(
                "--issue",
                relative,
                "--action",
                action,
                "--outcome",
                f"Confirmed {action} outcome",
                "--next-action",
                f"Confirmed {action} next action",
            )
            path = self.vault / relative
            self.assertEqual(fields(path)["status"], expected_status)
            _, _, disposition = triage.triage_values(path.read_text().splitlines())
            self.assertEqual(disposition, action)

    def test_split_publishes_all_children_before_parent_done(self) -> None:
        children = self.children_file()
        relative = "1_projects/neovim/themes/editor/features/splitting/issues/split-candidate.md"
        arguments = (
            "--issue",
            relative,
            "--action",
            "split",
            "--outcome",
            "Replace the broad issue with actionable children",
            "--next-action",
            "Start the first child",
            "--children-file",
            str(children),
        )
        preview = subprocess.run(
            self.command(*arguments), check=True, text=True, capture_output=True
        ).stdout
        token = re.search(r"^Confirmation token: ([0-9a-f]+)$", preview, re.MULTILINE)
        self.assertIsNotNone(token)

        parent = self.vault / relative
        first = parent.parent / "first-child.md"
        second = parent.parent / "second-child.md"
        original_replace = triage.os.replace
        observed = []

        def observing_replace(source: Path, target: Path) -> None:
            if Path(target).resolve() == parent.resolve():
                observed.append((first.exists(), second.exists(), fields(parent)["status"]))
            original_replace(source, target)

        plan = triage.mutation_plan(
            self.vault.resolve(),
            ["neovim", "pi-agent"],
            relative,
            "split",
            "Replace the broad issue with actionable children",
            "Start the first child",
            children=triage.load_children(children),
        )
        triage.os.replace = observing_replace
        try:
            triage.apply_plan(plan)
        finally:
            triage.os.replace = original_replace

        self.assertEqual(observed, [(True, True, "in-progress")])
        self.assertEqual(fields(parent)["status"], "done")
        self.assertEqual(fields(first)["status"], "open")
        self.assertEqual(fields(second)["status"], "open")
        weekly = triage.render_weekly(self.vault.resolve(), ["neovim", "pi-agent"])
        self.assertIn("#### First Child", weekly)
        self.assertIn("#### Second Child", weekly)
        self.assertNotIn("#### Split Candidate", weekly)

    def test_failed_split_rolls_back_children_and_parent(self) -> None:
        children = self.children_file()
        relative = "1_projects/neovim/themes/editor/features/splitting/issues/split-candidate.md"
        before = manifest(self.vault)
        plan = triage.mutation_plan(
            self.vault.resolve(),
            ["neovim", "pi-agent"],
            relative,
            "split",
            "Replace the broad issue with actionable children",
            "Start the first child",
            children=triage.load_children(children),
        )
        original_publish = triage._publish_new
        calls = 0

        def failing_publish(staged: Path, target: Path) -> None:
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("deterministic publication failure")
            original_publish(staged, target)

        triage._publish_new = failing_publish
        try:
            with self.assertRaisesRegex(triage.TriageError, "split was not applied"):
                triage.apply_plan(plan)
        finally:
            triage._publish_new = original_publish
        self.assertEqual(manifest(self.vault), before)


if __name__ == "__main__":
    unittest.main(verbosity=2)
