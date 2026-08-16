"""Offline fixture tests for the ccgram Pi renderer-parity patch.

Runs against a THROWAWAY COPY of the installed ccgram package with the
tracked patch applied (the live uv tool is never touched). Requires the
ccgram uv tool's python (deps: telegram, structlog, dotenv) — validate.sh
invokes this with `~/.local/share/uv/tools/ccgram/bin/python`.

Coverage:
  1. pi_format: thinking blocks -> content_type "thinking", phase "pi-live";
     turn-terminal assistant text -> phase "pi-final"; mid-turn text
     (stopReason toolUse) and tool_use/tool_result stay phase-free so the
     existing ephemeral tool_batch keeps owning tool-call display.
  2. pi_live_transcript: tree rendering (folding, first-line nodes) and the
     temporary-bubble state machine (send -> rate-limited edit -> delete)
     against a fake TelegramClient. No Bot API calls are made.
  3. Wiring: patched message_routing routes pi-live/pi-final phases.
"""

from __future__ import annotations

import asyncio
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

PKG_DIR = Path(__file__).resolve().parent.parent
PATCH_FILE = PKG_DIR / "patches" / "ccgram-4.5.2-pi-renderer-parity.patch"
FIXTURE = Path(__file__).resolve().parent / "fixtures" / "pi_turn.jsonl"

# ccgram.config constructs at import time and requires a token; give it a
# placeholder (not a real token, never used — no Bot API calls happen here).
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "0:offline-fixture-placeholder")
os.environ.setdefault("ALLOWED_USERS", "123")


def _find_site_packages() -> Path:
    candidates = glob.glob(
        os.path.expanduser("~/.local/share/uv/tools/ccgram/lib/python*/site-packages")
    )
    for cand in candidates:
        if (Path(cand) / "ccgram").is_dir():
            return Path(cand)
    raise unittest.SkipTest("ccgram uv tool not installed; cannot run patch tests")


def _prepare_patched_copy() -> Path:
    """Copy the installed ccgram package to a temp dir and apply the patch."""
    sp = _find_site_packages()
    tmp = Path(tempfile.mkdtemp(prefix="ccgram-patched-"))
    shutil.copytree(
        sp / "ccgram",
        tmp / "ccgram",
        ignore=shutil.ignore_patterns("__pycache__"),
    )

    def already_patched(root: Path) -> bool:
        # Marker-based detection: `patch -R --dry-run` auto-detects unreversed
        # patches and ignores -R, so it cannot tell applied from pristine.
        new_file = root / "ccgram/handlers/messaging_pipeline/pi_live_transcript.py"
        fmt = root / "ccgram/providers/pi_format.py"
        return new_file.exists() and 'phase="pi-live"' in fmt.read_text(
            encoding="utf-8"
        )

    if already_patched(tmp):
        pass  # live tool already patched; the copy is too
    else:
        with open(PATCH_FILE, "rb") as fh:
            dry = subprocess.run(
                ["patch", "-p1", "--dry-run", "--batch", "-s", "-d", str(tmp)],
                stdin=fh,
                check=False,
            )
        if dry.returncode != 0:
            raise unittest.SkipTest(
                "patch does not apply cleanly; installed ccgram version "
                "differs from the patch target"
            )
        with open(PATCH_FILE, "rb") as fh:
            subprocess.run(
                ["patch", "-p1", "--batch", "-s", "-d", str(tmp)],
                stdin=fh,
                check=True,
            )
        if not already_patched(tmp):
            raise RuntimeError("patch applied but markers missing")
    return tmp


class _FakeMessage:
    def __init__(self, message_id: int) -> None:
        self.message_id = message_id


class _FakeClient:
    """Records the Bot API calls pi_live_transcript would make."""

    def __init__(self) -> None:
        self.sent: list[dict] = []
        self.edited: list[dict] = []
        self.deleted: list[dict] = []
        self._next_id = 1000

    async def send_message(self, chat_id, text, **kwargs):
        self._next_id += 1
        self.sent.append({"chat_id": chat_id, "text": text, **kwargs})
        return _FakeMessage(self._next_id)

    async def edit_message_text(self, chat_id, message_id, text, **kwargs):
        self.edited.append(
            {"chat_id": chat_id, "message_id": message_id, "text": text}
        )
        return _FakeMessage(message_id)

    async def delete_message(self, chat_id, message_id, **kwargs):
        self.deleted.append({"chat_id": chat_id, "message_id": message_id})


class PiRendererParityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = _prepare_patched_copy()
        sys.path.insert(0, str(cls.tmp))
        for mod in list(sys.modules):
            if mod == "ccgram" or mod.startswith("ccgram."):
                del sys.modules[mod]

        from ccgram.handlers.messaging_pipeline import pi_live_transcript
        from ccgram.providers import pi_format
        from ccgram.providers.pi import PiProvider

        cls.pi_format = pi_format
        cls.trace = pi_live_transcript
        cls.provider = PiProvider()

    @classmethod
    def tearDownClass(cls) -> None:
        sys.path.remove(str(cls.tmp))
        shutil.rmtree(cls.tmp, ignore_errors=True)

    # ── 1. Formatter: phases on the parsed transcript ────────────────────

    def _parse_fixture(self):
        entries = []
        for line in FIXTURE.read_text(encoding="utf-8").splitlines():
            parsed = self.provider.parse_transcript_line(line)
            if parsed is not None:
                entries.append(parsed)
        messages, _pending = self.provider.parse_transcript_entries(entries, {})
        return messages

    def test_thinking_blocks_become_pi_live_messages(self):
        thinking = [m for m in self._parse_fixture() if m.content_type == "thinking"]
        self.assertEqual(len(thinking), 3)
        for msg in thinking:
            self.assertEqual(msg.phase, "pi-live")
            self.assertTrue(msg.text.strip())

    def test_final_text_is_stamped_pi_final(self):
        final = [
            m
            for m in self._parse_fixture()
            if m.content_type == "text" and m.phase == "pi-final"
        ]
        texts = [m.text for m in final]
        self.assertIn("Fixed the flaky parser test by serializing tmp-dir setup.", texts)
        # Terminal error notice also retires the trace.
        self.assertIn("⚠ API error: provider rate limited", texts)

    def test_mid_turn_text_and_tool_calls_keep_no_phase(self):
        msgs = self._parse_fixture()
        mid_turn = [
            m
            for m in msgs
            if m.content_type == "text" and "I found the cause" in m.text
        ]
        self.assertEqual(len(mid_turn), 1)
        self.assertIsNone(mid_turn[0].phase)

        tool_msgs = [m for m in msgs if m.content_type in ("tool_use", "tool_result")]
        self.assertEqual(len(tool_msgs), 4)  # read+result, edit+result
        for msg in tool_msgs:
            self.assertIsNone(msg.phase)

    def test_user_messages_unaffected(self):
        users = [m for m in self._parse_fixture() if m.role == "user"]
        self.assertEqual(len(users), 2)
        for msg in users:
            self.assertIsNone(msg.phase)

    # ── 2. Live trace rendering + temporary-bubble state machine ─────────

    def test_tree_rendering_folds_overflow(self):
        steps = [f"step {i}" for i in range(1, 12)]
        tree = self.trace.render_thinking_tree(steps, max_steps=8)
        lines = tree.splitlines()
        self.assertEqual(lines[0], "🧠 Thinking…")
        self.assertIn("… (3 earlier steps)", lines[1])
        self.assertIn("step 11", tree)
        self.assertNotIn("step 3\n", tree)
        self.assertTrue(lines[-1].startswith("└─ ⏳ still thinking"))

    def test_normalize_step_first_line_and_truncation(self):
        self.assertEqual(
            self.trace.normalize_step("first line\nsecond line"), "first line"
        )
        long_step = "x" * 500
        self.assertLessEqual(
            len(self.trace.normalize_step(long_step)), self.trace.MAX_STEP_CHARS + 1
        )
        self.assertEqual(self.trace.normalize_step("   \n  "), "")

    def test_live_trace_send_edit_delete_cycle(self):
        trace = self.trace
        trace.clear_all_traces()
        client = _FakeClient()
        run = asyncio.run

        run(trace.handle_pi_thinking(client, 1, 42, -100999, "first step"))
        self.assertEqual(len(client.sent), 1)
        self.assertEqual(client.sent[0]["chat_id"], -100999)
        self.assertEqual(client.sent[0].get("message_thread_id"), 42)
        self.assertIn("├─ first step", client.sent[0]["text"])

        # Rate limit: an immediate second step does not edit yet.
        run(trace.handle_pi_thinking(client, 1, 42, -100999, "second step"))
        self.assertEqual(len(client.edited), 0)

        # After the edit window, the same bubble is edited in place.
        key = (1, 42)
        trace._traces[key].last_edit_ts -= trace.EDIT_MIN_SECS + 1
        run(trace.handle_pi_thinking(client, 1, 42, -100999, "third step"))
        self.assertEqual(len(client.edited), 1)
        self.assertEqual(client.edited[0]["message_id"], 1001)
        self.assertIn("├─ third step", client.edited[0]["text"])

        # Final answer retires the bubble.
        run(trace.clear_pi_thinking(client, 1, 42))
        self.assertEqual(client.deleted, [{"chat_id": -100999, "message_id": 1001}])

        # Clearing again is a no-op.
        run(trace.clear_pi_thinking(client, 1, 42))
        self.assertEqual(len(client.deleted), 1)

    def test_live_trace_isolated_per_topic(self):
        trace = self.trace
        trace.clear_all_traces()
        client = _FakeClient()
        run = asyncio.run
        run(trace.handle_pi_thinking(client, 1, 42, -100999, "topic A"))
        run(trace.handle_pi_thinking(client, 1, 77, -100999, "topic B"))
        self.assertEqual(len(client.sent), 2)
        run(trace.clear_pi_thinking(client, 1, 42))
        self.assertEqual(len(client.deleted), 1)
        self.assertIn((1, 77), trace._traces)

    # ── 3. Routing wiring ────────────────────────────────────────────────

    def test_routing_wires_pi_phases(self):
        src = (
            self.tmp / "ccgram/handlers/messaging_pipeline/message_routing.py"
        ).read_text(encoding="utf-8")
        self.assertIn("handle_pi_thinking(client, user_id, thread_id, chat_id", src)
        self.assertIn("clear_pi_thinking(client, user_id, thread_id)", src)
        self.assertIn('msg.phase == PI_LIVE_PHASE', src)
        self.assertIn('msg.phase == PI_FINAL_PHASE', src)


if __name__ == "__main__":
    unittest.main()
