#!/usr/bin/env python3
"""Deterministic V03 checks for explicit-intent Telegram voice-note handling."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SKILL = Path(__file__).resolve().parent
HELPER = SKILL / "triage.py"
SKILL_DOC = SKILL / "SKILL.md"
FIXTURE = SKILL / "fixtures" / "voice-vault"
VAULT_FIXTURE = FIXTURE / "vault"
CASES_FILE = FIXTURE / "cases.json"
PROJECTS = "neovim,pi-agent"


def manifest(root: Path) -> dict[str, str]:
    return {
        path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


class V03Tests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.vault = Path(self.temporary.name) / "vault"
        shutil.copytree(VAULT_FIXTURE, self.vault)
        cases = json.loads(CASES_FILE.read_text(encoding="utf-8"))
        self.cases = {case["id"]: case for case in cases}

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def command(self, *arguments: str) -> list[str]:
        return [
            "python3",
            str(HELPER),
            "--vault",
            str(self.vault),
            "--projects",
            PROJECTS,
            *arguments,
        ]

    def preview_and_apply(self, arguments: list[str]) -> tuple[str, str]:
        preview = subprocess.run(
            self.command(*arguments), check=True, text=True, capture_output=True
        ).stdout
        match = re.search(r"^Confirmation token: ([0-9a-f]+)$", preview, re.MULTILINE)
        self.assertIsNotNone(match)
        applied = subprocess.run(
            self.command(*arguments, "--apply", match.group(1)),
            check=True,
            text=True,
            capture_output=True,
        ).stdout
        return preview, applied

    def test_fixture_has_exactly_the_four_canonical_manual_cases(self) -> None:
        raw = json.loads(CASES_FILE.read_text(encoding="utf-8"))
        self.assertEqual(
            [case["id"] for case in raw],
            [
                "issue-like-no-intent",
                "explicit-create",
                "exact-update",
                "ambiguous-update",
            ],
        )
        self.assertIsNone(raw[0]["explicit_intent"])
        self.assertEqual(raw[1]["owner"], "pi-agent/agent-issue-triage")
        self.assertEqual(raw[1]["source"]["kind"], "voice note")
        self.assertTrue(raw[2]["issue"].endswith("/exact-update.md"))
        self.assertEqual(len(raw[3]["expected"]["candidates"]), 2)
        policy = " ".join(SKILL_DOC.read_text(encoding="utf-8").split())
        self.assertIn("Explicit intent only", policy)
        self.assertIn("Do not alter Telegram transport or transcription", policy)

    def test_issue_like_statement_without_explicit_intent_does_not_write(self) -> None:
        case = self.cases["issue-like-no-intent"]
        before = manifest(self.vault)
        self.assertIsNone(case["explicit_intent"])
        self.assertEqual(case["expected"], {"result": "respond-only", "write": False})
        result = subprocess.run(
            self.command("--transcript", case["transcript"]),
            text=True,
            capture_output=True,
        )
        self.assertEqual(result.returncode, 2)
        self.assertNotIn("Confirmation token", result.stdout)
        self.assertEqual(manifest(self.vault), before)

    def test_explicit_create_previews_then_creates_under_named_owner_with_source(self) -> None:
        case = self.cases["explicit-create"]
        owner_issues = (self.vault / case["expected"]["path"]).parent
        (owner_issues / "exact-update.md").unlink()
        owner_issues.rmdir()
        arguments = [
            "--create-owner",
            case["owner"],
            "--slug",
            case["slug"],
            "--title",
            case["title"],
            "--outcome",
            case["outcome"],
            "--next-action",
            case["next_action"],
            "--source-id",
            case["source"]["message_id"],
            "--transcript",
            case["transcript"],
        ]
        before = manifest(self.vault)
        preview = subprocess.run(
            self.command(*arguments), check=True, text=True, capture_output=True
        ).stdout
        self.assertIn(f"Issue: {case['expected']['path']}", preview)
        self.assertIn("No files changed", preview)
        self.assertEqual(manifest(self.vault), before)

        _, applied = self.preview_and_apply(arguments)
        self.assertEqual(applied, f"Created issue: {case['expected']['path']}\n")
        after = manifest(self.vault)
        self.assertEqual(set(after) - set(before), {case["expected"]["path"]})
        self.assertTrue(all(after[path] == digest for path, digest in before.items()))
        text = (self.vault / case["expected"]["path"]).read_text(encoding="utf-8")
        for expected in (
            "- **Channel:** Telegram",
            "- **Kind:** voice note",
            f"- **Message ID:** {case['source']['message_id']}",
            f"- **Owner:** {case['owner']}",
            f"- **Transcript:** {case['transcript']}",
        ):
            self.assertIn(expected, text)

    def test_create_preserves_multiline_transcript_paragraphs_and_tabs(self) -> None:
        relative = (
            "1_projects/pi-agent/themes/vault-issue-workflow/features/"
            "agent-issue-triage/issues/multiline-source.md"
        )
        transcript = (
            "\nFirst paragraph keeps\tits inline tab.\n\n"
            "\tSecond paragraph keeps its leading tab.\n"
        )
        preserved = transcript.strip()
        arguments = [
            "--create-owner",
            "pi-agent/agent-issue-triage",
            "--slug",
            "multiline-source",
            "--title",
            "Multiline Source",
            "--outcome",
            "The complete source remains reviewable",
            "--next-action",
            "Compare the source block byte for byte",
            "--source-id",
            "telegram-multiline-01",
            "--transcript",
            transcript,
        ]

        self.preview_and_apply(arguments)
        text = (self.vault / relative).read_text(encoding="utf-8")
        self.assertIn(f"## Source\n\n- **Channel:** Telegram", text)
        self.assertTrue(text.endswith(f"- **Transcript:** {preserved}\n"))
        self.assertNotIn("First paragraph keeps its inline tab.", text)

    def test_create_then_update_preserves_mixed_newline_source_bytes(self) -> None:
        relative = (
            "1_projects/pi-agent/themes/vault-issue-workflow/features/"
            "agent-issue-triage/issues/triage-heading-source.md"
        )
        transcript = (
            "Keep this source byte for byte.\r\n\r\n"
            "## Triage\r\n\r\n"
            "- **User-facing outcome:** This is transcript text, not metadata\n"
            "- **Smallest next action:** Do not rewrite this source line\r\n"
            "- **Disposition:** transcript-only\r\n\r\n"
            "## Transcript Notes\n\n"
            "The canonical triage section comes earlier."
        )
        create_arguments = [
            "--create-owner",
            "pi-agent/agent-issue-triage",
            "--slug",
            "triage-heading-source",
            "--title",
            "Triage Heading Source",
            "--outcome",
            "Preserve the Telegram source",
            "--next-action",
            "Update only canonical triage metadata",
            "--source-id",
            "telegram-triage-heading-01",
            "--transcript",
            transcript,
        ]
        self.preview_and_apply(create_arguments)

        path = self.vault / relative
        created = path.read_bytes()
        source_offset = created.index(b"## Source\n")
        canonical_before = created[:source_offset]
        source_before = created[source_offset:]
        self.assertEqual(created.count(b"## Triage"), 2)
        self.assertIn(transcript.encode("utf-8"), source_before)

        update_outcome = "The source survives a later update"
        update_action = "Check the canonical section only"
        update_arguments = [
            "--issue",
            relative,
            "--action",
            "keep",
            "--outcome",
            update_outcome,
            "--next-action",
            update_action,
            "--priority",
            "P1",
        ]
        self.preview_and_apply(update_arguments)

        updated = path.read_bytes()
        source_offset = updated.index(b"## Source\n")
        canonical_after = updated[:source_offset]
        source_after = updated[source_offset:]
        self.assertEqual(updated.count(b"## Triage"), 2)
        self.assertEqual(source_after, source_before)
        self.assertNotEqual(canonical_after, canonical_before)
        self.assertIn(b"priority: P1\n", canonical_after)
        self.assertEqual(canonical_after.count(update_outcome.encode("utf-8")), 1)
        self.assertEqual(canonical_after.count(update_action.encode("utf-8")), 1)
        self.assertNotIn(update_outcome.encode("utf-8"), source_after)
        self.assertNotIn(update_action.encode("utf-8"), source_after)

        weekly = subprocess.run(
            self.command("--weekly"), check=True, text=True, capture_output=True
        ).stdout
        self.assertIn(f"- User-facing outcome: {update_outcome}", weekly)
        self.assertIn(f"- Smallest next action: {update_action}", weekly)

    def test_update_without_existing_triage_preserves_source_suffix_bytes(self) -> None:
        relative = (
            "1_projects/pi-agent/themes/vault-issue-workflow/features/"
            "agent-issue-triage/issues/exact-update.md"
        )
        path = self.vault / relative
        original = (
            b"---\r\nstatus: open\r\n---\r\n# Source Only\r\n\r\n"
            b"This note has no triage metadata yet.\r\n\r\n"
            b"## Source\r\n\r\n- **Channel:** Telegram\n"
            b"- **Transcript:** Keep\tthis source byte for byte.\r\n"
            b"Final source line without a newline"
        )
        path.write_bytes(original)
        source_before = original[original.index(b"## Source") :]
        update_outcome = "The source-only note has canonical triage"
        update_action = "Verify the preserved source suffix"

        self.preview_and_apply(
            [
                "--issue",
                relative,
                "--action",
                "keep",
                "--outcome",
                update_outcome,
                "--next-action",
                update_action,
                "--priority",
                "P1",
            ]
        )

        updated = path.read_bytes()
        source_offset = updated.index(b"## Source")
        canonical = updated[:source_offset]
        self.assertEqual(updated[source_offset:], source_before)
        self.assertEqual(canonical.count(b"## Triage\n"), 1)
        self.assertIn(b"priority: P1\n", canonical)
        self.assertIn(update_outcome.encode("utf-8"), canonical)
        self.assertIn(update_action.encode("utf-8"), canonical)

    def test_exact_update_previews_then_changes_only_the_exact_issue(self) -> None:
        case = self.cases["exact-update"]
        arguments = [
            "--issue",
            case["issue"],
            "--action",
            case["action"],
            "--outcome",
            case["outcome"],
            "--next-action",
            case["next_action"],
        ]
        before = manifest(self.vault)
        preview = subprocess.run(
            self.command(*arguments), check=True, text=True, capture_output=True
        ).stdout
        self.assertIn(f"Issue: {case['issue']}", preview)
        self.assertEqual(manifest(self.vault), before)

        _, applied = self.preview_and_apply(arguments)
        self.assertEqual(applied, f"Applied keep: {case['issue']}\n")
        after = manifest(self.vault)
        changed = {path for path in before if before[path] != after[path]}
        self.assertEqual(changed, {case["issue"]})
        text = (self.vault / case["issue"]).read_text(encoding="utf-8")
        self.assertIn(f"- **User-facing outcome:** {case['outcome']}", text)
        self.assertIn(f"- **Smallest next action:** {case['next_action']}", text)

    def test_ambiguous_update_requests_clarification_and_does_not_write(self) -> None:
        case = self.cases["ambiguous-update"]
        before = manifest(self.vault)
        result = subprocess.run(
            self.command(
                "--issue-reference",
                case["issue_reference"],
                "--action",
                "keep",
                "--outcome",
                "Must not be written",
                "--next-action",
                "Clarify the exact issue",
            ),
            text=True,
            capture_output=True,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("issue identity is ambiguous; clarify with an exact path", result.stderr)
        for candidate in case["expected"]["candidates"]:
            self.assertIn(candidate, result.stderr)
        self.assertNotIn("Confirmation token", result.stdout)
        self.assertEqual(manifest(self.vault), before)


if __name__ == "__main__":
    unittest.main(verbosity=2)
