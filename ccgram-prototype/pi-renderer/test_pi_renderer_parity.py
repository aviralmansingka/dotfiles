"""Offline fixture tests for the ccgram Pi renderer-parity patch.

Runs against a THROWAWAY COPY of the installed ccgram package with the
tracked patch stack applied (the live uv tool is never touched). Requires
the ccgram uv tool's python (deps: telegram, structlog, dotenv) —
validate.sh invokes this with `~/.local/share/uv/tools/ccgram/bin/python`.

Coverage:
  1. pi_format: thinking blocks -> content_type "thinking", phase "pi-live";
     turn-terminal assistant text -> phase "pi-final"; mid-turn text
     (stopReason toolUse) and tool_use/tool_result stay phase-free so the
     existing ephemeral tool_batch keeps owning tool-call display.
  2. pi_live_transcript: tree rendering (folding, first-line nodes) and the
     temporary-bubble state machine (silent send -> rate-limited edit ->
     delete) against a fake TelegramClient. No Bot API calls are made.
  3. Low-noise notifications: the thinking trace is silent on first send;
     under CCGRAM_QUIET_PROGRESS user-echo content tasks are delivered with
     disable_notification=True while the final answer still notifies;
     silent and notifying tasks never merge.
  4. Wiring: patched message_routing routes pi-live/pi-final phases and
     flags user echoes silent; the status bubble send honors quiet_progress.
  5. Thinking-tree liveness (patch layer 4): live elapsed timer in the
     tree header; CCGRAM_PI_TRACE_EDIT_SECS/_TICK_SECS/_IDLE_SECS env knobs;
     mid-turn assistant text (stopReason toolUse) stamped pi-live-goal and
     folded into the tree as the bold goal line (no separate message, no
     notification); ticker timer refresh without new steps; idle-timeout
     deletion of stale trace bubbles.
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
# Patch stack, in apply order (patch 2's context depends on patch 1;
# patch 4 edits files added by patch 1).
PATCH_FILES = [
    PKG_DIR / "patches" / "ccgram-4.5.2-pi-renderer-parity.patch",
    PKG_DIR / "patches" / "ccgram-4.5.2-low-noise-notifications.patch",
    PKG_DIR / "patches" / "ccgram-4.5.2-pi-thinking-tree-live.patch",
]
FIXTURE = Path(__file__).resolve().parent / "fixtures" / "pi_turn.jsonl"

# ccgram.config constructs at import time and requires a token; give it a
# placeholder (not a real token, never used — no Bot API calls happen here).
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "0:offline-fixture-placeholder")
os.environ.setdefault("ALLOWED_USERS", "123")
# Low-noise mode under test: user echoes + status bubble go silent.
os.environ.setdefault("CCGRAM_QUIET_PROGRESS", "true")
# Liveness knobs under test (layer 4): 1s edit cadence like the prototype
# env; a long tick so the background ticker never fires mid-test (tests
# drive tick_once() directly); idle-timeout deletion stays at the default.
os.environ.setdefault("CCGRAM_PI_TRACE_EDIT_SECS", "1.0")
os.environ.setdefault("CCGRAM_PI_TRACE_TICK_SECS", "3600")
os.environ.setdefault("CCGRAM_PI_TRACE_WRAP_CHARS", "48")


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

    def renderer_parity_applied(root: Path) -> bool:
        # Marker-based detection: `patch -R --dry-run` auto-detects unreversed
        # patches and ignores -R, so it cannot tell applied from pristine.
        new_file = root / "ccgram/handlers/messaging_pipeline/pi_live_transcript.py"
        fmt = root / "ccgram/providers/pi_format.py"
        return new_file.exists() and 'phase="pi-live"' in fmt.read_text(
            encoding="utf-8"
        )

    def low_noise_applied(root: Path) -> bool:
        cfg = (root / "ccgram/config.py").read_text(encoding="utf-8")
        task = (
            root / "ccgram/handlers/messaging_pipeline/message_task.py"
        ).read_text(encoding="utf-8")
        return "CCGRAM_QUIET_PROGRESS" in cfg and "silent: bool = False" in task

    def thinking_tree_live_applied(root: Path) -> bool:
        live = root / "ccgram/handlers/messaging_pipeline/pi_live_transcript.py"
        fmt = root / "ccgram/providers/pi_format.py"
        return (
            live.exists()
            and "CCGRAM_PI_TRACE_EDIT_SECS" in live.read_text(encoding="utf-8")
            and "pi-live-goal" in fmt.read_text(encoding="utf-8")
        )

    marker_checks = [
        renderer_parity_applied,
        low_noise_applied,
        thinking_tree_live_applied,
    ]

    for patch_file, applied_check in zip(PATCH_FILES, marker_checks):
        if applied_check(tmp):
            continue  # live tool already patched; the copy is too
        with open(patch_file, "rb") as fh:
            dry = subprocess.run(
                ["patch", "-p1", "--dry-run", "--batch", "-s", "-d", str(tmp)],
                stdin=fh,
                check=False,
            )
        if dry.returncode != 0:
            raise unittest.SkipTest(
                f"{patch_file.name} does not apply cleanly; installed ccgram "
                "version differs from the patch target"
            )
        with open(patch_file, "rb") as fh:
            subprocess.run(
                ["patch", "-p1", "--batch", "-s", "-d", str(tmp)],
                stdin=fh,
                check=True,
            )
        if not applied_check(tmp):
            raise RuntimeError(f"{patch_file.name} applied but markers missing")
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
            {"chat_id": chat_id, "message_id": message_id, "text": text, **kwargs}
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

        from ccgram.config import config
        from ccgram.handlers.messaging_pipeline import message_queue, message_task
        from ccgram.handlers.messaging_pipeline import pi_live_transcript
        from ccgram.providers import pi_format
        from ccgram.providers.pi import PiProvider

        cls.config = config
        cls.message_queue = message_queue
        cls.message_task = message_task
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

    def test_mid_turn_text_is_stamped_pi_live_goal(self):
        # Layer 4: mid-turn assistant text (stopReason toolUse) folds into
        # the thinking tree as the goal line instead of a separate message.
        msgs = self._parse_fixture()
        mid_turn = [
            m
            for m in msgs
            if m.content_type == "text" and "I found the cause" in m.text
        ]
        self.assertEqual(len(mid_turn), 1)
        self.assertEqual(mid_turn[0].phase, "pi-live-goal")

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
        # Low-noise: the temporary trace is silent on first send — it is
        # edited in place and deleted on final, so it must never notify.
        self.assertIs(client.sent[0].get("disable_notification"), True)

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

    # ── 3. Low-noise notifications ───────────────────────────────────────

    def test_quiet_progress_config_flag(self):
        # CCGRAM_QUIET_PROGRESS=true is set at module import (top of file).
        self.assertTrue(self.config.quiet_progress)

    def test_silent_user_echo_sends_without_notification(self):
        client = _FakeClient()
        task = self.message_task.ContentTask(
            window_id="w1",
            parts=("\U0001f464 FIRSTMATE_OP: launch-brief",),
            role="user",
            thread_id=42,
            chat_id=-100999,
            silent=True,
        )
        asyncio.run(self.message_queue._process_content_task(client, 1, task))
        self.assertEqual(len(client.sent), 1)
        self.assertIs(client.sent[0].get("disable_notification"), True)

    def test_final_answer_still_notifies(self):
        client = _FakeClient()
        task = self.message_task.ContentTask(
            window_id="w1",
            parts=("Fixed the flaky parser test.",),
            role="assistant",
            thread_id=42,
            chat_id=-100999,
        )
        asyncio.run(self.message_queue._process_content_task(client, 1, task))
        self.assertEqual(len(client.sent), 1)
        self.assertIn(client.sent[0].get("disable_notification"), (None, False))

    def test_silent_and_notifying_tasks_never_merge(self):
        ct = self.message_task.ContentTask
        silent = ct(window_id="w", parts=("a",), silent=True)
        notifying = ct(window_id="w", parts=("b",), silent=False)
        # A silent user echo must never fold into the notifying final
        # answer (that would mute the answer's notification).
        self.assertFalse(self.message_queue._can_merge_tasks(silent, notifying))
        self.assertFalse(self.message_queue._can_merge_tasks(notifying, silent))
        other_silent = ct(window_id="w", parts=("c",), silent=True)
        self.assertTrue(self.message_queue._can_merge_tasks(silent, other_silent))

    # ── 5. Thinking-tree liveness (patch layer 4) ────────────────────────

    def test_liveness_env_knobs(self):
        # CCGRAM_PI_TRACE_EDIT_SECS=1.0 / _TICK_SECS=3600 / _WRAP_CHARS=48
        # set at module import (top of file); the idle-timeout default is
        # 10 minutes.
        self.assertEqual(self.trace.EDIT_MIN_SECS, 1.0)
        self.assertEqual(self.trace.TICK_SECS, 3600.0)
        self.assertEqual(self.trace.IDLE_SECS, 600.0)
        self.assertEqual(self.trace.WRAP_CHARS, 48)

    def test_header_shows_live_elapsed_timer(self):
        tree = self.trace.render_thinking_tree(["step"], elapsed=42.7)
        self.assertEqual(tree.splitlines()[0], "🧠 Thinking… · 0:42")
        # Without elapsed the header is unchanged (static render).
        bare = self.trace.render_thinking_tree(["step"])
        self.assertEqual(bare.splitlines()[0], "🧠 Thinking…")
        self.assertEqual(self.trace.format_elapsed(0), "0:00")
        self.assertEqual(self.trace.format_elapsed(65), "1:05")
        self.assertEqual(self.trace.format_elapsed(600), "10:00")

    def test_goal_line_markdown_stripped_and_bold(self):
        self.assertEqual(
            self.trace._strip_markdown("Fix **parser** `race` ~~now~~"),
            "Fix parser race now",
        )
        tree = self.trace.render_thinking_tree(
            ["step"], goal="Fix parser race now", elapsed=1
        )
        self.assertIn("▸ **Fix parser race now**", tree)
        # Goal sits directly under the header, above the step nodes.
        lines = tree.splitlines()
        self.assertTrue(lines[1].startswith("▸ **"))
        self.assertTrue(lines[2].startswith("├─"))

    def test_wrap_segments_word_wraps_and_hard_cuts(self):
        ws = self.trace.wrap_segments
        # Fits: single segment.
        self.assertEqual(ws(3, "short", 48), ["short"])
        # Word-boundary break: never splits a word that fits.
        segs = ws(3, "alpha beta gamma delta epsilon", 14)
        self.assertTrue(all(len(seg) <= 11 for seg in segs))
        self.assertEqual(" ".join(segs), "alpha beta gamma delta epsilon")
        # Unbreakable over-long word: hard-cut at the available width.
        segs = ws(3, "x" * 30, 13)
        self.assertEqual(segs, ["x" * 10, "x" * 10, "x" * 10])
        # Width 0 disables wrapping.
        self.assertEqual(ws(3, "a " * 50, 0), ["a " * 50])

    def test_long_step_wraps_with_hanging_indent(self):
        step = (
            "Checking whether the transcript binding race fix holds for "
            "reused session directories across consecutive worker spawns"
        )
        tree = self.trace.render_thinking_tree([step], wrap_chars=48)
        step_lines = [l for l in tree.splitlines() if "Checking" in l or l.startswith("   ")]
        self.assertGreater(len(step_lines), 1)  # actually wrapped
        self.assertTrue(step_lines[0].startswith("├─ "))
        for cont in step_lines[1:]:
            # Continuation aligns under the node's text column, so the
            # tree shape survives Telegram's phone-width wrapping.
            self.assertTrue(cont.startswith("   "), cont)
            self.assertNotIn("├─", cont)
        for line in step_lines:
            self.assertLessEqual(len(line), 48, line)
        # No text lost: stripping prefixes/indent reassembles the step.
        reassembled = " ".join(
            l.removeprefix("├─ ").strip() for l in step_lines
        )
        self.assertEqual(reassembled, step)

    def test_long_goal_wraps_bold_segments_with_hanging_indent(self):
        goal = (
            "Refactoring the message routing pipeline so mid-turn assistant "
            "text folds into the thinking tree instead of notifying"
        )
        tree = self.trace.render_thinking_tree(["step"], goal=goal, wrap_chars=48)
        goal_lines = [l for l in tree.splitlines() if "**" in l]
        self.assertGreater(len(goal_lines), 1)
        self.assertTrue(goal_lines[0].startswith("▸ **"))
        for cont in goal_lines[1:]:
            self.assertTrue(cont.startswith("  **"), cont)
            self.assertNotIn("▸", cont)
        for line in goal_lines:
            # Displayed width excludes the non-rendering ** markers.
            self.assertLessEqual(len(line) - 4, 48, line)
        reassembled = " ".join(
            l.removeprefix("▸ ").strip().strip("*") for l in goal_lines
        )
        self.assertEqual(reassembled, goal)

    def test_wrap_disabled_keeps_single_lines(self):
        tree = self.trace.render_thinking_tree(
            ["s " * 60], goal="g " * 60, wrap_chars=0
        )
        self.assertEqual(len(tree.splitlines()), 4)  # header, goal, step, spinner

    def test_mid_turn_text_folds_into_goal_line_no_new_message(self):
        trace = self.trace
        trace.clear_all_traces()
        client = _FakeClient()
        run = asyncio.run

        run(trace.handle_pi_thinking(client, 1, 42, -100999, "first step"))
        self.assertEqual(len(client.sent), 1)

        # Mid-turn assistant text (stopReason toolUse) edits the SAME
        # bubble's goal line: no separate message, no notification.
        key = (1, 42)
        trace._traces[key].last_edit_ts -= trace.EDIT_MIN_SECS + 1
        run(
            trace.handle_pi_goal(
                client, 1, 42, -100999, "I found the **cause**; patching it now."
            )
        )
        self.assertEqual(len(client.sent), 1)  # no new message
        self.assertEqual(len(client.edited), 1)
        self.assertEqual(client.edited[0]["message_id"], 1001)
        # convert_to_entities strips the markdown into bold entities, so
        # the plain text carries the stripped goal…
        self.assertIn("▸ I found the cause; patching it now.", client.edited[0]["text"])
        # …and the goal line is rendered bold via entities.
        entities = client.edited[0].get("entities") or []
        self.assertTrue(
            any(getattr(e, "type", None) == "bold" for e in entities),
            f"expected a bold entity on the goal line, got {entities!r}",
        )

        # Final answer still retires the bubble.
        run(trace.clear_pi_thinking(client, 1, 42))
        self.assertEqual(client.deleted, [{"chat_id": -100999, "message_id": 1001}])
        trace.clear_all_traces()

    def test_goal_before_any_thinking_starts_the_bubble_silently(self):
        trace = self.trace
        trace.clear_all_traces()
        client = _FakeClient()
        asyncio.run(trace.handle_pi_goal(client, 1, 42, -100999, "working on it"))
        self.assertEqual(len(client.sent), 1)
        self.assertIn("▸ working on it", client.sent[0]["text"])
        self.assertIs(client.sent[0].get("disable_notification"), True)
        trace.clear_all_traces()

    def test_ticker_advances_timer_without_new_steps(self):
        trace = self.trace
        trace.clear_all_traces()
        client = _FakeClient()
        run = asyncio.run
        run(trace.handle_pi_thinking(client, 1, 42, -100999, "first step"))
        self.assertEqual(len(client.edited), 0)

        # Simulate 65s passing with no new completed JSONL message: the
        # ticker still re-renders so the header timer visibly advances.
        tr = trace._traces[(1, 42)]
        tr.started_ts -= 65
        tr.last_edit_ts -= trace.EDIT_MIN_SECS + 1
        run(trace.tick_once())
        self.assertEqual(len(client.edited), 1)
        self.assertEqual(client.edited[0]["message_id"], 1001)
        self.assertIn("🧠 Thinking… · 1:05", client.edited[0]["text"])
        trace.clear_all_traces()

    def test_ticker_respects_edit_throttle(self):
        trace = self.trace
        trace.clear_all_traces()
        client = _FakeClient()
        run = asyncio.run
        run(trace.handle_pi_thinking(client, 1, 42, -100999, "first step"))

        # Timer text would change, but the edit throttle has not elapsed.
        tr = trace._traces[(1, 42)]
        tr.started_ts -= 65
        run(trace.tick_once())
        self.assertEqual(len(client.edited), 0)
        trace.clear_all_traces()

    def test_idle_cleanup_deletes_stale_bubble(self):
        trace = self.trace
        trace.clear_all_traces()
        client = _FakeClient()
        run = asyncio.run
        run(trace.handle_pi_thinking(client, 1, 42, -100999, "first step"))

        # Turn died mid-thinking: no activity for more than IDLE_SECS.
        trace._traces[(1, 42)].last_activity_ts -= trace.IDLE_SECS + 1
        run(trace.tick_once())
        self.assertEqual(client.deleted, [{"chat_id": -100999, "message_id": 1001}])
        self.assertNotIn((1, 42), trace._traces)

        # A live trace in another topic is untouched by the same sweep.
        run(trace.handle_pi_thinking(client, 1, 77, -100999, "fresh step"))
        run(trace.tick_once())
        self.assertIn((1, 77), trace._traces)
        self.assertEqual(len(client.deleted), 1)
        trace.clear_all_traces()

    # ── 4. Routing wiring ────────────────────────────────────────────────

    def test_routing_wires_pi_phases(self):
        src = (
            self.tmp / "ccgram/handlers/messaging_pipeline/message_routing.py"
        ).read_text(encoding="utf-8")
        self.assertIn("handle_pi_thinking(client, user_id, thread_id, chat_id", src)
        self.assertIn("clear_pi_thinking(client, user_id, thread_id)", src)
        self.assertIn('msg.phase == PI_LIVE_PHASE', src)
        self.assertIn('msg.phase == PI_FINAL_PHASE', src)

    def test_routing_folds_mid_turn_text_into_tree(self):
        # Layer 4: pi-live-goal text routes into the tree (and continues,
        # so it never becomes a separate progress message).
        src = (
            self.tmp / "ccgram/handlers/messaging_pipeline/message_routing.py"
        ).read_text(encoding="utf-8")
        self.assertIn("handle_pi_goal(client, user_id, thread_id, chat_id, msg.text)", src)
        self.assertIn("msg.phase == PI_GOAL_PHASE", src)

    def test_routing_flags_user_echoes_silent_under_quiet_progress(self):
        src = (
            self.tmp / "ccgram/handlers/messaging_pipeline/message_routing.py"
        ).read_text(encoding="utf-8")
        self.assertIn('silent=config.quiet_progress and msg.role == "user"', src)

    def test_status_bubble_send_honors_quiet_progress(self):
        # Functional coverage of send_status_text needs a wired SessionManager
        # (thread_router); assert the wiring instead.
        src = (self.tmp / "ccgram/handlers/status/status_bubble.py").read_text(
            encoding="utf-8"
        )
        self.assertIn("disable_notification=config.quiet_progress", src)


if __name__ == "__main__":
    unittest.main()
