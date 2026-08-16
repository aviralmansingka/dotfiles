"""Offline fixture tests for the ccgram Pi renderer-parity patch.

Runs against a THROWAWAY COPY of ccgram with the tracked patch stack
applied (the live uv tool is never touched).  The copy is built from the
PRISTINE 4.5.2 wheel in the uv cache when available (so the suite always
exercises the tracked stack, even when the live install carries an older
patch revision); otherwise it falls back to copying the installed package
and applying whatever layers are missing.  Requires the ccgram uv tool's
python (deps: telegram, structlog, dotenv) — validate.sh invokes this
with `~/.local/share/uv/tools/ccgram/bin/python`.

Coverage:
  1. pi_format: thinking blocks -> content_type "thinking", phase "pi-live";
     turn-terminal assistant text -> phase "pi-final"; mid-turn text
     (stopReason toolUse) and tool_use/tool_result stay phase-free so the
     existing ephemeral tool_batch keeps owning tool-call display.
  2. pi_live_transcript: status-bubble rendering (header timer, bold goal
     line, latest-step summary line) and the temporary-bubble state
     machine (silent send -> rate-limited edit -> delete) against a fake
     TelegramClient. No Bot API calls are made.
  3. Low-noise notifications: the thinking trace is silent on first send;
     under CCGRAM_QUIET_PROGRESS user-echo content tasks are delivered with
     disable_notification=True while the final answer still notifies;
     silent and notifying tasks never merge.
  4. Wiring: patched message_routing routes pi-live/pi-final phases and
     flags user echoes silent; the status bubble send honors quiet_progress.
  5. Frontdoor-style goal-line status bubble (patch layer 4): live elapsed
     timer in the header; one bold goal line per goal — `▸` active, `✓`
     done — matching pi/bin/pi-telegram-daemon.py's ThinkingTreeBuilder
     (thinking blocks can derive the active goal's label but never render
     as lines of their own; no ├─/└─ tree connectors, no prose
     paragraphs); CCGRAM_PI_TRACE_EDIT_SECS/_TICK_SECS/_IDLE_SECS/
     _WRAP_CHARS env knobs; mid-turn assistant text (stopReason toolUse)
     stamped pi-live-goal and folded into the bubble as the goal label
     (no separate message, no notification); same-message goal/thinking
     paraphrase dedupe (token-overlap heuristic), so the screenshot case
     displays the concise goal once; ticker timer refresh without new
     steps; idle-timeout deletion of stale trace bubbles; mobile-safe
     36-column label wrap with a blank hanging indent under the bullet.
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
os.environ.setdefault("CCGRAM_PI_TRACE_WRAP_CHARS", "36")


EXPECTED_VERSION = "4.5.2"


def _find_site_packages() -> Path:
    candidates = glob.glob(
        os.path.expanduser("~/.local/share/uv/tools/ccgram/lib/python*/site-packages")
    )
    for cand in candidates:
        if (Path(cand) / "ccgram").is_dir():
            return Path(cand)
    raise unittest.SkipTest("ccgram uv tool not installed; cannot run patch tests")


def _find_pristine_source() -> Path | None:
    """Locate a pristine ccgram wheel unpack in the uv cache, if present.

    Testing the tracked patch stack against the INSTALLED package breaks
    down when the live install carries an older revision of a patch layer
    (the new revision neither applies on top nor should be forced over
    live code).  uv keeps the pristine wheel unpacked under
    ``~/.cache/uv/archive-v0/*/``; a pristine 4.5.2 there lets the suite
    apply the full tracked stack from scratch — hermetic, and never
    touching the live install.
    """
    for dist_info in sorted(
        glob.glob(
            os.path.expanduser(
                f"~/.cache/uv/archive-v0/*/ccgram-{EXPECTED_VERSION}.dist-info"
            )
        )
    ):
        root = Path(dist_info).parent
        pkg = root / "ccgram"
        fmt = pkg / "providers" / "pi_format.py"
        if pkg.is_dir() and fmt.is_file():
            # Purity check: a patched unpack would carry layer-1 markers.
            if 'phase="pi-live"' not in fmt.read_text(encoding="utf-8"):
                return root
    return None


def _renderer_parity_applied(root: Path) -> bool:
    # Marker-based detection: `patch -R --dry-run` auto-detects unreversed
    # patches and ignores -R, so it cannot tell applied from pristine.
    new_file = root / "ccgram/handlers/messaging_pipeline/pi_live_transcript.py"
    fmt = root / "ccgram/providers/pi_format.py"
    return new_file.exists() and 'phase="pi-live"' in fmt.read_text(
        encoding="utf-8"
    )


def _low_noise_applied(root: Path) -> bool:
    cfg = (root / "ccgram/config.py").read_text(encoding="utf-8")
    task = (root / "ccgram/handlers/messaging_pipeline/message_task.py").read_text(
        encoding="utf-8"
    )
    return "CCGRAM_QUIET_PROGRESS" in cfg and "silent: bool = False" in task


def _thinking_tree_live_applied(root: Path) -> bool:
    # Revision markers: an installed tool carrying an OLDER layer-4
    # revision (tree renderer, or goal folding without the same-message
    # goal/thinking dedupe) fails this check, so the copy is NOT mistaken
    # for the tracked stack and the suite skips with a clear reason
    # instead of silently testing stale code.
    live = root / "ccgram/handlers/messaging_pipeline/pi_live_transcript.py"
    fmt = root / "ccgram/providers/pi_format.py"
    return (
        live.exists()
        and "render_thinking_status" in live.read_text(encoding="utf-8")
        and "pi-live-goal" in fmt.read_text(encoding="utf-8")
        and "is_goal_thinking_duplicate" in fmt.read_text(encoding="utf-8")
    )


_MARKER_CHECKS = [
    _renderer_parity_applied,
    _low_noise_applied,
    _thinking_tree_live_applied,
]


def _apply_patch_file(patch_file: Path, tmp: Path) -> None:
    with open(patch_file, "rb") as fh:
        subprocess.run(
            ["patch", "-p1", "--batch", "-s", "-d", str(tmp)],
            stdin=fh,
            check=True,
        )


def _prepare_from_pristine(src: Path) -> Path:
    """Apply the full tracked patch stack to a pristine wheel unpack copy.

    A patch that fails against pristine 4.5.2 is a hard error here (not a
    skip): this path proves the tracked stack applies cleanly from
    scratch.
    """
    tmp = Path(tempfile.mkdtemp(prefix="ccgram-pristine-"))
    shutil.copytree(
        src / "ccgram",
        tmp / "ccgram",
        ignore=shutil.ignore_patterns("__pycache__"),
    )
    for patch_file, applied_check in zip(PATCH_FILES, _MARKER_CHECKS):
        _apply_patch_file(patch_file, tmp)
        if not applied_check(tmp):
            raise RuntimeError(f"{patch_file.name} applied but markers missing")
    return tmp


def _prepare_patched_copy() -> Path:
    """Copy ccgram to a temp dir and apply the tracked patch stack.

    Prefers a pristine wheel unpack from the uv cache (full stack applied
    from scratch); falls back to the installed package with only the
    missing layers applied.
    """
    pristine = _find_pristine_source()
    if pristine is not None:
        return _prepare_from_pristine(pristine)
    sp = _find_site_packages()
    tmp = Path(tempfile.mkdtemp(prefix="ccgram-patched-"))
    shutil.copytree(
        sp / "ccgram",
        tmp / "ccgram",
        ignore=shutil.ignore_patterns("__pycache__"),
    )

    for patch_file, applied_check in zip(PATCH_FILES, _MARKER_CHECKS):
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
                "version differs from the patch target, or the installed "
                "tool carries an older revision of this patch layer (apply "
                "the updated patch stack to run these tests)"
            )
        _apply_patch_file(patch_file, tmp)
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
        # the status bubble as the goal line instead of a separate message.
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

    def test_goal_lines_render_active_and_done_bullets(self):
        # Frontdoor shape: header + one bold line per goal (▸ active, ✓
        # done). No tree connectors, no prose lines, no spinner footer.
        node = self.trace._GoalNode
        bubble = self.trace.render_thinking_status(
            [node("first goal", done=True), node("current goal")]
        )
        lines = bubble.splitlines()
        self.assertEqual(lines[0], "🧠 Thinking…")
        self.assertEqual(lines[1], "✓ **first goal**")
        self.assertEqual(lines[2], "▸ **current goal**")
        self.assertEqual(len(lines), 3)
        for connector in ("├─", "└─", "⏳"):
            self.assertNotIn(connector, bubble)
        # A single active goal renders exactly one bullet line.
        bubble = self.trace.render_thinking_status([node("only goal")])
        self.assertEqual(
            bubble.splitlines(), ["🧠 Thinking…", "▸ **only goal**"]
        )

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
        # A thinking-only start derives the active goal's ▸ label.
        self.assertIn("▸ first step", client.sent[0]["text"])
        self.assertNotIn("├─", client.sent[0]["text"])
        # Low-noise: the temporary trace is silent on first send — it is
        # edited in place and deleted on final, so it must never notify.
        self.assertIs(client.sent[0].get("disable_notification"), True)

        # Rate limit: an immediate goal update does not edit yet.
        run(trace.handle_pi_goal(client, 1, 42, -100999, "second step"))
        self.assertEqual(len(client.edited), 0)

        # After the edit window, the same bubble is edited in place.  A
        # second text goal completes the first (✓) and takes over the ▸.
        key = (1, 42)
        trace._traces[key].last_edit_ts -= trace.EDIT_MIN_SECS + 1
        run(trace.handle_pi_goal(client, 1, 42, -100999, "third step"))
        self.assertEqual(len(client.edited), 1)
        self.assertEqual(client.edited[0]["message_id"], 1001)
        self.assertIn("✓ second step", client.edited[0]["text"])
        self.assertIn("▸ third step", client.edited[0]["text"])
        # The thinking-derived label was replaced, never ✓-retained.
        self.assertNotIn("first step", client.edited[0]["text"])

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

    # ── 5. No-tree live status bubble (patch layer 4) ─────────────────

    def test_liveness_env_knobs(self):
        # CCGRAM_PI_TRACE_EDIT_SECS=1.0 / _TICK_SECS=3600 / _WRAP_CHARS=36
        # set at module import (top of file); the idle-timeout default is
        # 10 minutes.
        self.assertEqual(self.trace.EDIT_MIN_SECS, 1.0)
        self.assertEqual(self.trace.TICK_SECS, 3600.0)
        self.assertEqual(self.trace.IDLE_SECS, 600.0)
        self.assertEqual(self.trace.WRAP_CHARS, 36)

    def test_header_shows_live_elapsed_timer(self):
        node = self.trace._GoalNode
        bubble = self.trace.render_thinking_status([node("step")], elapsed=42.7)
        self.assertEqual(bubble.splitlines()[0], "🧠 Thinking… · 0:42")
        # Without elapsed the header is unchanged (static render).
        bare = self.trace.render_thinking_status([node("step")])
        self.assertEqual(bare.splitlines()[0], "🧠 Thinking…")
        self.assertEqual(self.trace.format_elapsed(0), "0:00")
        self.assertEqual(self.trace.format_elapsed(65), "1:05")
        self.assertEqual(self.trace.format_elapsed(600), "10:00")

    def test_goal_line_markdown_stripped_and_bold(self):
        self.assertEqual(
            self.trace._strip_markdown("Fix **parser** `race` ~~now~~"),
            "Fix parser race now",
        )
        bubble = self.trace.render_thinking_status(
            [self.trace._GoalNode("Fix parser race now")], elapsed=1
        )
        self.assertIn("▸ **Fix parser race now**", bubble)
        lines = bubble.splitlines()
        self.assertEqual(lines[1], "▸ **Fix parser race now**")

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

    def test_long_label_wraps_subordinate_to_bullet(self):
        label = (
            "Checking whether the transcript binding race fix holds for "
            "reused session directories across consecutive worker spawns"
        )
        bubble = self.trace.render_thinking_status(
            [self.trace._GoalNode(label)], wrap_chars=48
        )
        label_lines = bubble.splitlines()[1:]
        self.assertGreater(len(label_lines), 1)  # actually wrapped
        self.assertTrue(label_lines[0].startswith("▸ **"))
        for cont in label_lines[1:]:
            # Continuation hangs under the label text: visually
            # subordinate to the bullet, with no tree connector.
            self.assertTrue(cont.startswith("  **"), cont)
            self.assertNotIn("▸", cont)
        for line in label_lines:
            # Displayed width excludes the non-rendering ** markers.
            self.assertLessEqual(len(line) - 4, 48, line)
        for connector in ("├─", "└─"):
            self.assertNotIn(connector, bubble)
        # No text lost across the wrap.
        reassembled = " ".join(
            l.removeprefix("▸ ").strip().strip("*") for l in label_lines
        )
        self.assertEqual(reassembled, label)

    def test_done_goal_wraps_with_check_bullet(self):
        label = (
            "Refactoring the message routing pipeline so mid-turn assistant "
            "text folds into the status bubble instead of notifying"
        )
        bubble = self.trace.render_thinking_status(
            [self.trace._GoalNode(label, done=True)], wrap_chars=48
        )
        label_lines = bubble.splitlines()[1:]
        self.assertGreater(len(label_lines), 1)
        self.assertTrue(label_lines[0].startswith("✓ **"))
        for cont in label_lines[1:]:
            self.assertTrue(cont.startswith("  **"), cont)
            self.assertNotIn("✓", cont)
        reassembled = " ".join(
            l.removeprefix("✓ ").strip().strip("*") for l in label_lines
        )
        self.assertEqual(reassembled, label)

    def test_wrap_disabled_keeps_single_lines(self):
        node = self.trace._GoalNode
        bubble = self.trace.render_thinking_status(
            [node("g " * 60), node("s " * 60)], wrap_chars=0
        )
        self.assertEqual(len(bubble.splitlines()), 3)  # header + 2 goal lines

    def test_mid_turn_text_folds_into_goal_line_no_new_message(self):
        trace = self.trace
        trace.clear_all_traces()
        client = _FakeClient()
        run = asyncio.run

        run(trace.handle_pi_thinking(client, 1, 42, -100999, "first step"))
        self.assertEqual(len(client.sent), 1)

        # Mid-turn assistant text (stopReason toolUse) edits the SAME
        # bubble's goal line: no separate message, no notification.  The
        # text label replaces the thinking-derived one (same goal node).
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
        # the plain text carries the ▸ bullet and the stripped goal
        # (word-wrapped at the 36-column mobile width)…
        self.assertIn("▸ I found the cause; patching it", client.edited[0]["text"])
        self.assertIn("now.", client.edited[0]["text"])
        # …and the derived label is gone (replaced, not ✓-retained).
        self.assertNotIn("first step", client.edited[0]["text"])
        self.assertNotIn("✓", client.edited[0]["text"])
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

    # ── 6. Goal/thinking dedupe + no-tree mobile wrap ──────────────────

    # The captain's 2026-08-16 mobile screenshot (scout report
    # ccgram-tree-regression-scout): transcript line 14 of the
    # fm-vault-next-work-scout session paired this visible text block…
    _LINE14_GOAL = (
        "Now let me check the vault's current state and recent activity "
        "since the prior scouts."
    )
    # …with this thinking block in the SAME assistant message — a
    # paraphrase ("check" vs "look at").  This is the EXACT thinking text
    # from the transcript (one long line, 250 chars): the PR150
    # character-level dedupe rule silently collapsed on it (difflib
    # autojunk) and the post-PR150 live smoke/replay still rendered the
    # pair twice, which is why the heuristic is now token-based.
    _LINE14_THINKING = (
        "Now let me look at the vault's current state to verify whether "
        "anything has changed since the prior scouts (auto-commits, weekly "
        "backlog W33/W34). Today is Sun Aug 16, 2026 (W33). Check recent "
        "git activity in the vault, the weekly backlog, WIP items."
    )
    # The next thinking block in that transcript (line 19) — topically
    # related but NOT a paraphrase of the goal; it must survive as the
    # bubble's step line.
    _LINE19_THINKING = (
        "Now check the trip plan note for the current state (booked or "
        "not), the reminder script state, daemon health, recruiting audit."
    )

    def _parse_assistant_blocks(self, blocks, stop_reason="toolUse"):
        line = json.dumps(
            {
                "type": "message",
                "id": "mx",
                "parentId": None,
                "timestamp": "2026-08-16T04:17:27.100Z",
                "message": {
                    "role": "assistant",
                    "content": blocks,
                    "stopReason": stop_reason,
                },
            }
        )
        entry = self.provider.parse_transcript_line(line)
        self.assertIsNotNone(entry)
        messages, _pending = self.provider.parse_transcript_entries([entry], {})
        return messages

    def test_same_message_goal_thinking_paraphrase_deduped(self):
        # Line-14 scenario: the paraphrasing thinking block is dropped at
        # parse time; only the goal text survives (plus tool calls).
        messages = self._parse_assistant_blocks(
            [
                {"type": "thinking", "thinking": self._LINE14_THINKING},
                {"type": "text", "text": self._LINE14_GOAL},
                {
                    "type": "toolCall",
                    "id": "call_x",
                    "name": "read",
                    "arguments": {"path": "note.md"},
                },
            ]
        )
        goals = [m for m in messages if m.phase == "pi-live-goal"]
        thinking = [m for m in messages if m.content_type == "thinking"]
        self.assertEqual([m.text for m in goals], [self._LINE14_GOAL])
        self.assertEqual(thinking, [])  # paraphrase suppressed
        tools = [m for m in messages if m.content_type == "tool_use"]
        self.assertEqual(len(tools), 1)  # tool calls unaffected

    def test_same_message_divergent_thinking_kept(self):
        # Same shape as line 14, but the thinking's first line is genuinely
        # different content: both the goal and the step must survive.
        messages = self._parse_assistant_blocks(
            [
                {
                    "type": "thinking",
                    "thinking": "The reminder script state looks stale; the "
                    "daemon may have skipped its tick.\nMore detail.",
                },
                {"type": "text", "text": self._LINE14_GOAL},
            ]
        )
        self.assertEqual(
            len([m for m in messages if m.phase == "pi-live-goal"]), 1
        )
        self.assertEqual(
            len([m for m in messages if m.content_type == "thinking"]), 1
        )

    def test_dedupe_leaves_other_message_shapes_untouched(self):
        # Thinking-only mid-turn messages still produce a step.
        thinking_only = self._parse_assistant_blocks(
            [{"type": "thinking", "thinking": self._LINE14_THINKING}]
        )
        self.assertEqual(
            [m.phase for m in thinking_only if m.content_type == "thinking"],
            ["pi-live"],
        )
        # Final answers (stopReason != toolUse) are never deduped: the
        # text is the delivered answer, not a bubble goal line.
        final = self._parse_assistant_blocks(
            [
                {"type": "thinking", "thinking": self._LINE14_THINKING},
                {"type": "text", "text": self._LINE14_GOAL},
            ],
            stop_reason="stop",
        )
        self.assertEqual(
            len([m for m in final if m.content_type == "thinking"]), 1
        )
        self.assertEqual(
            [m.phase for m in final if m.content_type == "text"], ["pi-final"]
        )

    def test_dedupe_heuristic_boundaries(self):
        dup = self.pi_format.is_goal_thinking_duplicate
        # The exact line-14 paraphrase pair (the PR150 live-replay miss).
        self.assertTrue(dup(self._LINE14_GOAL, self._LINE14_THINKING))
        # Exact prefix of a longer thinking line.
        self.assertTrue(
            dup(
                "Now let me check the vault state.",
                "Now let me check the vault state and then the trip plan.",
            )
        )
        # Different opening: not a duplicate even with topical overlap.
        self.assertFalse(
            dup(
                "Now I will run the test suite to verify the fix.",
                "The parser probably races on the tmp dir; serializing.",
            )
        )
        # Same opening but no substantial shared phrase.
        self.assertFalse(
            dup("Now let me see.", "Now let me try a completely different angle.")
        )
        # The line-19 follow-up is topically related but not a paraphrase.
        self.assertFalse(dup(self._LINE14_GOAL, self._LINE19_THINKING))

    def test_thinking_after_goal_never_renders_prose_line(self):
        # A thinking block arriving while a text goal is active changes
        # NOTHING visible: the label is not rewritten and the thinking
        # never appears as a prose line below the bullet (this is what
        # keeps the screenshot case showing the concise goal once even
        # if a paraphrasing thinking block slipped past parse dedupe).
        trace = self.trace
        trace.clear_all_traces()
        client = _FakeClient()
        run = asyncio.run
        run(trace.handle_pi_goal(client, 1, 42, -100999, self._LINE14_GOAL))
        self.assertEqual(len(client.sent), 1)
        trace._traces[(1, 42)].last_edit_ts -= trace.EDIT_MIN_SECS + 1
        run(trace.handle_pi_thinking(client, 1, 42, -100999, self._LINE14_THINKING))
        latest = client.edited[-1]["text"] if client.edited else client.sent[0]["text"]
        self.assertIn("▸ Now let me check the vault's", latest)
        self.assertNotIn("look at the vault", latest)
        trace.clear_all_traces()

    def test_derived_label_is_sticky_until_text_arrives(self):
        # Frontdoor label_derived semantics: a thinking-only turn derives
        # the active goal's label from its FIRST thinking block; later
        # thinking blocks never rewrite it (tracked, not rendered).
        trace = self.trace
        trace.clear_all_traces()
        client = _FakeClient()
        run = asyncio.run
        run(trace.handle_pi_thinking(client, 1, 42, -100999, "Reading the prior reports first."))
        self.assertIn("▸ Reading the prior reports first.", client.sent[0]["text"])
        trace._traces[(1, 42)].last_edit_ts -= trace.EDIT_MIN_SECS + 1
        run(trace.handle_pi_thinking(client, 1, 42, -100999, "Now checking daemon health instead."))
        latest = client.edited[-1]["text"] if client.edited else client.sent[0]["text"]
        self.assertIn("▸ Reading the prior reports first.", latest)
        self.assertNotIn("daemon health", latest)
        trace.clear_all_traces()

    def test_paraphrase_pair_renders_once_in_bubble(self):
        # End-to-end golden for the original screenshot scenario: the
        # exact line-14 blocks routed through the trace state machine
        # render the statement ONCE (bold goal line), with no duplicate
        # step and no tree connectors anywhere in the bubble.
        trace = self.trace
        trace.clear_all_traces()
        client = _FakeClient()
        run = asyncio.run

        messages = self._parse_assistant_blocks(
            [
                {"type": "thinking", "thinking": self._LINE14_THINKING},
                {"type": "text", "text": self._LINE14_GOAL},
            ]
        )
        for msg in messages:
            if msg.content_type == "thinking":
                run(
                    trace.handle_pi_thinking(client, 1, 42, -100999, msg.text)
                )
            elif msg.phase == "pi-live-goal":
                run(trace.handle_pi_goal(client, 1, 42, -100999, msg.text))
        self.assertEqual(len(client.sent), 1)
        bubble = client.sent[0]["text"]
        # The goal renders once as a ▸ bullet under the header,
        # word-wrapped at the 36-column mobile width
        # (convert_to_entities strips the ** markers into bold entities)…
        self.assertIn("▸ Now let me check the vault's", bubble)
        self.assertTrue(bubble.splitlines()[1].startswith("▸ "))
        # …and the thinking paraphrase appears nowhere: no prose line.
        self.assertNotIn("look at the vault", bubble)
        # No tree connectors anywhere.
        for connector in ("├─", "└─"):
            self.assertNotIn(connector, bubble)
        trace.clear_all_traces()

    def test_smoke_turn_bubble_lifecycle_goal_lines(self):
        # Live-smoke scenario (firstmate ▸ fm-ccgram-live-smoke-test):
        # a thinking-only message starts the bubble with a derived ▸
        # label, a mid-turn text replaces it, a later text goal completes
        # it (✓), and the final answer deletes the bubble — one message
        # throughout, no connectors, never notifying.
        trace = self.trace
        trace.clear_all_traces()
        client = _FakeClient()
        run = asyncio.run

        run(trace.handle_pi_thinking(client, 1, 42, -100999, "Reading the worker brief and prior reports."))
        self.assertEqual(len(client.sent), 1)
        self.assertIn("▸ Reading the worker brief", client.sent[0]["text"])
        self.assertIs(client.sent[0].get("disable_notification"), True)

        key = (1, 42)
        trace._traces[key].last_edit_ts -= trace.EDIT_MIN_SECS + 1
        run(trace.handle_pi_goal(client, 1, 42, -100999, "Verifying the mirrored topic renders cleanly."))
        trace._traces[key].last_edit_ts -= trace.EDIT_MIN_SECS + 1
        run(trace.handle_pi_goal(client, 1, 42, -100999, "Wrapping up the smoke verification."))
        self.assertEqual(len(client.sent), 1)  # still one bubble
        self.assertEqual(len(client.edited), 2)
        latest = client.edited[-1]["text"]
        self.assertIn("✓ Verifying the mirrored topic", latest)
        self.assertIn("▸ Wrapping up the smoke", latest)
        self.assertIn("verification.", latest)
        # The thinking-derived label was replaced, never ✓-retained, and
        # nothing tree-shaped or prose-like appears.
        self.assertNotIn("Reading the worker brief", latest)
        for connector in ("├─", "└─", "⏳"):
            self.assertNotIn(connector, latest)

        run(trace.clear_pi_thinking(client, 1, 42))
        self.assertEqual(client.deleted, [{"chat_id": -100999, "message_id": 1001}])
        trace.clear_all_traces()

    def test_mobile_wrap_width_36_keeps_bullet_shape(self):
        # The 2026-08-16 screenshot regression, restated for the bullet
        # bubble: 36 columns keeps intentional breaks ahead of Telegram's
        # own pixel wrap on typical phones, and the blank hanging indent
        # keeps continuations visually subordinate to the ▸ bullet.
        bubble = self.trace.render_thinking_status(
            [self.trace._GoalNode(self._LINE14_GOAL)], elapsed=14,
            wrap_chars=36,
        )
        lines = bubble.splitlines()
        self.assertEqual(lines[0], "🧠 Thinking… · 0:14")
        self.assertEqual(len(lines), 1 + 3)  # header + 3 wrapped segments
        self.assertTrue(lines[1].startswith("▸ **"))
        for line in lines[1:]:
            display = line.replace("**", "")  # ** renders as bold entities
            self.assertLessEqual(len(display), 36, line)
        for cont in lines[2:]:
            self.assertTrue(cont.startswith("  **"), cont)
        for connector in ("├─", "└─"):
            self.assertNotIn(connector, bubble)
        # No text lost across the wrap.
        reassembled = " ".join(
            l.removeprefix("▸ ").strip().strip("*") for l in lines[1:]
        )
        self.assertEqual(reassembled, self._LINE14_GOAL)

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

    def test_routing_folds_mid_turn_text_into_bubble(self):
        # Layer 4: pi-live-goal text routes into the bubble (and continues,
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
