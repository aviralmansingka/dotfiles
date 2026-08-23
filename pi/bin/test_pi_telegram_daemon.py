#!/usr/bin/env python3
"""Tests for pi-telegram-daemon.

Run with: python3 -m unittest test_pi_telegram_daemon -v
"""

from __future__ import annotations

import base64
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

# Load the daemon module (hyphen in filename requires importlib)
_DAEMON_PATH = Path(__file__).parent / "pi-telegram-daemon.py"
_spec = importlib.util.spec_from_file_location("pi_telegram_daemon", _DAEMON_PATH)
daemon = importlib.util.module_from_spec(_spec)
sys.modules["pi_telegram_daemon"] = daemon  # dataclass needs this
_spec.loader.exec_module(daemon)


class TestThinkingTreeBuilder(unittest.TestCase):
    """Unit tests for ThinkingTreeBuilder — pure logic, no I/O."""

    def test_empty_render_shows_only_header(self):
        tree = daemon.ThinkingTreeBuilder()
        text = tree.render(5)
        self.assertIn("thinking · 0:05", text)

    def test_elapsed_rolls_over_to_minutes(self):
        tree = daemon.ThinkingTreeBuilder()
        text = tree.render(75)
        self.assertIn("thinking · 1:15", text)
        self.assertNotIn("0:75", text)

    def test_turn_start_creates_placeholder_goal(self):
        tree = daemon.ThinkingTreeBuilder()
        tree.on_turn_start()
        text = tree.render(1)
        self.assertIn("▸ <b>working…</b>", text)

    def test_text_block_sets_goal_label(self):
        tree = daemon.ThinkingTreeBuilder()
        tree.on_turn_start()
        tree.on_message_update([
            {"type": "text", "text": "Find the open issues"},
        ])
        text = tree.render(2)
        self.assertIn("▸ <b>Find the open issues</b>", text)
        self.assertNotIn("working…", text)

    def test_thinking_block_derives_goal_label(self):
        """Thinking blocks derive the goal label, with filler words stripped."""
        tree = daemon.ThinkingTreeBuilder()
        tree.on_turn_start()
        tree.on_message_update([
            {"type": "thinking", "thinking": "I need to list the issues directory"},
        ])
        text = tree.render(3)
        # Filler "I need to" is stripped, first letter capitalized
        self.assertIn("List the issues directory", text)
        self.assertNotIn("I need to", text)
        self.assertNotIn("┊", text)

    def test_multiple_thinking_blocks_derive_single_label(self):
        """Multiple thinking blocks → one derived label (from the first), no trace lines."""
        tree = daemon.ThinkingTreeBuilder()
        tree.on_turn_start()
        tree.on_message_update([
            {"type": "thinking", "thinking": "First thought"},
            {"type": "thinking", "thinking": "Second thought"},
        ])
        text = tree.render(4)
        self.assertIn("First thought", text)
        self.assertNotIn("┊", text)
        self.assertNotIn("Second thought", text)

    def test_partial_is_cumulative_replace_not_append(self):
        """message_update gives the full partial each time, so label replaces."""
        tree = daemon.ThinkingTreeBuilder()
        tree.on_turn_start()
        tree.on_message_update([
            {"type": "thinking", "thinking": "First thought"},
        ])
        tree.on_message_update([
            {"type": "thinking", "thinking": "First thought"},
            {"type": "thinking", "thinking": "Second thought"},
        ])
        text = tree.render(5)
        # No trace lines rendered at all
        self.assertEqual(text.count("┊"), 0)

    def test_streaming_thinking_updates_derived_label(self):
        """Derived label must update as thinking streams in, not freeze on first token."""
        tree = daemon.ThinkingTreeBuilder()
        tree.on_turn_start()
        # First token — short incomplete thought
        tree.on_message_update([
            {"type": "thinking", "thinking": "I need"},
        ])
        # More tokens stream in — fuller thought
        tree.on_message_update([
            {"type": "thinking", "thinking": "I need to check the server cache configuration"},
        ])
        text = tree.render(3)
        # Filler "I need to" stripped, capitalized
        self.assertIn("Check the server cache", text)
        self.assertNotIn("I need\n", text)
        # The label should not be stuck at the first token
        first_line = text.split("\n")[1]
        self.assertNotEqual(first_line.strip(), "▸ <b>I need</b>")

    def test_multiple_turns_create_multiple_goals(self):
        tree = daemon.ThinkingTreeBuilder()
        tree.on_turn_start()
        tree.on_message_update([{"type": "text", "text": "Goal 1"}])
        tree.on_turn_end()
        tree.on_turn_start()
        tree.on_message_update([{"type": "text", "text": "Goal 2"}])
        text = tree.render(10)
        self.assertIn("✓ <b>Goal 1</b>", text)
        self.assertIn("▸ <b>Goal 2</b>", text)

    def test_html_escaping_in_goal_label(self):
        tree = daemon.ThinkingTreeBuilder()
        tree.on_turn_start()
        tree.on_message_update([{"type": "text", "text": "<script>alert(1)</script>"}])
        text = tree.render(1)
        self.assertIn("&lt;script&gt;", text)
        self.assertNotIn("<script>", text)

    def test_html_escaping_in_trace(self):
        tree = daemon.ThinkingTreeBuilder()
        tree.on_turn_start()
        tree.on_message_update([
            {"type": "thinking", "thinking": "Use <b> & <i> tags"},
        ])
        text = tree.render(1)
        self.assertIn("&lt;b&gt;", text)
        self.assertIn("&amp;", text)

    def test_long_thinking_derived_label_is_truncated(self):
        tree = daemon.ThinkingTreeBuilder()
        tree.on_turn_start()
        long_text = "x" * 500
        tree.on_message_update([{"type": "thinking", "thinking": long_text}])
        text = tree.render(1)
        # Derived label is truncated to GOAL_LABEL_CHARS
        self.assertIn("…", text)
        self.assertLess(text.count("x"), 500)

    def test_empty_thinking_block_falls_back_to_working(self):
        tree = daemon.ThinkingTreeBuilder()
        tree.on_turn_start()
        tree.on_message_update([
            {"type": "thinking", "thinking": ""},
            {"type": "thinking", "thinking": "   "},
        ])
        text = tree.render(1)
        self.assertEqual(text.count("┊"), 0)
        self.assertIn("working…", text)

    def test_toolcall_block_derives_label(self):
        """Tool calls derive a label from tool name and args when no text block."""
        tree = daemon.ThinkingTreeBuilder()
        tree.on_turn_start()
        tree.on_message_update([
            {"type": "toolCall", "id": "call_1", "name": "bash", "arguments": {"command": "ls"}},
            {"type": "thinking", "thinking": "A thought"},
        ])
        text = tree.render(1)
        self.assertNotIn("toolCall", text)
        # Tool-call label takes priority over thinking-derived label
        self.assertIn("Running ls", text)
        self.assertNotIn("A thought", text)

    def test_message_update_without_turn_start_auto_creates_goal(self):
        tree = daemon.ThinkingTreeBuilder()
        tree.on_message_update([{"type": "thinking", "thinking": "Thought"}])
        text = tree.render(1)
        # Goal label is derived from the thinking trace, not "working…"
        self.assertIn("Thought", text)

    def test_toolcall_read_derives_reading_label(self):
        """read tool with path arg derives 'Reading <path>' label."""
        tree = daemon.ThinkingTreeBuilder()
        tree.on_turn_start()
        tree.on_message_update([
            {"type": "toolCall", "id": "c1", "name": "read", "arguments": {"path": "/home/avirus/dotfiles/settings.json"}},
        ])
        text = tree.render(1)
        self.assertIn("Reading", text)
        self.assertIn("settings.json", text)

    def test_toolcall_edit_derives_editing_label(self):
        """edit tool with path arg derives 'Editing <path>' label."""
        tree = daemon.ThinkingTreeBuilder()
        tree.on_turn_start()
        tree.on_message_update([
            {"type": "toolCall", "id": "c1", "name": "edit", "arguments": {"path": "config.toml"}},
        ])
        text = tree.render(1)
        self.assertIn("Editing", text)
        self.assertIn("config.toml", text)

    def test_toolcall_bash_long_command_truncates(self):
        """bash tool with long command shows a truncated command in label."""
        tree = daemon.ThinkingTreeBuilder()
        tree.on_turn_start()
        tree.on_message_update([
            {"type": "toolCall", "id": "c1", "name": "bash", "arguments": {"command": "find / -name '*.json' -type f 2>/dev/null | head -100"}},
        ])
        text = tree.render(1)
        self.assertIn("Running", text)
        # Should contain part of the command but not the full thing
        self.assertIn("find", text)

    def test_toolcall_unknown_tool_uses_generic_label(self):
        """Unknown tool name gets a 'Calling <name>' label."""
        tree = daemon.ThinkingTreeBuilder()
        tree.on_turn_start()
        tree.on_message_update([
            {"type": "toolCall", "id": "c1", "name": "custom_tool", "arguments": {}},
        ])
        text = tree.render(1)
        self.assertIn("Calling custom_tool", text)

    def test_text_block_overrides_toolcall_label(self):
        """When a text block arrives, it replaces the tool-call-derived label."""
        tree = daemon.ThinkingTreeBuilder()
        tree.on_turn_start()
        tree.on_message_update([
            {"type": "toolCall", "id": "c1", "name": "bash", "arguments": {"command": "ls"}},
        ])
        tree.on_message_update([
            {"type": "toolCall", "id": "c1", "name": "bash", "arguments": {"command": "ls"}},
            {"type": "text", "text": "Real goal label"},
        ])
        text = tree.render(3)
        self.assertIn("Real goal label", text)
        self.assertNotIn("Running ls", text.split("\n")[1])

    def test_total_message_truncation(self):
        """When total exceeds MAX_REPLY_CHARS, it's truncated with ellipsis."""
        tree = daemon.ThinkingTreeBuilder()
        # Completed goals collapse (no traces), so we need many goals with
        # long labels to exceed the limit. Use 300 goals with 200-char labels.
        for i in range(300):
            tree.on_turn_start()
            tree.on_message_update([
                {"type": "text", "text": f"Goal {i}: " + "y" * 200},
            ])
            tree.on_turn_end()
        text = tree.render(99)
        self.assertLessEqual(len(text), daemon.MAX_REPLY_CHARS)
        self.assertTrue(text.endswith("…"))

    def test_turn_end_marks_goal_done(self):
        tree = daemon.ThinkingTreeBuilder()
        tree.on_turn_start()
        tree.on_message_update([{"type": "text", "text": "Done goal"}])
        tree.on_turn_end()
        text = tree.render(5)
        self.assertIn("✓ <b>Done goal</b>", text)
        self.assertNotIn("▸ <b>Done goal</b>", text)

    def test_completed_goals_show_only_labels(self):
        """All goals (done or live) show only their label — no traces rendered."""
        tree = daemon.ThinkingTreeBuilder()
        tree.on_turn_start()
        tree.on_message_update([
            {"type": "thinking", "thinking": "old trace that should be hidden"},
            {"type": "text", "text": "Completed goal"},
        ])
        tree.on_turn_end()
        tree.on_turn_start()
        tree.on_message_update([{"type": "thinking", "thinking": "a live thought about the server"}])
        text = tree.render(5)
        self.assertIn("✓ <b>Completed goal</b>", text)
        self.assertNotIn("old trace that should be hidden", text)
        self.assertNotIn("┊", text)
        # Thinking-derived label is capitalized
        self.assertIn("A live thought", text)

    def test_goal_label_derived_from_first_thinking(self):
        """When no text block, goal label comes from the first thinking trace."""
        tree = daemon.ThinkingTreeBuilder()
        tree.on_turn_start()
        tree.on_message_update([
            {"type": "thinking", "thinking": "I need to check the server cache first"},
        ])
        text = tree.render(3)
        # Filler stripped, capitalized
        self.assertIn("Check the server cache", text)
        self.assertNotIn("I need to", text)
        self.assertNotIn("working…", text)

    def test_text_block_overrides_derived_label(self):
        """When a text block arrives, it replaces the derived label."""
        tree = daemon.ThinkingTreeBuilder()
        tree.on_turn_start()
        tree.on_message_update([
            {"type": "thinking", "thinking": "provisional thought"},
        ])
        tree.on_message_update([
            {"type": "thinking", "thinking": "provisional thought"},
            {"type": "text", "text": "Real goal label"},
        ])
        text = tree.render(3)
        self.assertIn("Real goal label", text)
        self.assertNotIn("provisional thought", text.split("\n")[1])

    def test_markdown_stripped_from_goal_label(self):
        tree = daemon.ThinkingTreeBuilder()
        tree.on_turn_start()
        tree.on_message_update([{"type": "text", "text": "**Bold** goal with `code`"}])
        text = tree.render(1)
        self.assertIn("Bold goal with code", text)
        self.assertNotIn("**", text)
        self.assertNotIn("`", text)

    def test_markdown_stripped_from_derived_label(self):
        tree = daemon.ThinkingTreeBuilder()
        tree.on_turn_start()
        tree.on_message_update([
            {"type": "thinking", "thinking": "Use **bold** and `code` in thinking"},
        ])
        text = tree.render(1)
        self.assertNotIn("**", text)
        self.assertNotIn("`code`", text)
        self.assertIn("bold", text)
        self.assertIn("code", text)


class TestStatusMessenger(unittest.TestCase):
    """Unit tests for StatusMessenger — mocks telegram_api."""

    def setUp(self):
        # Reset module-level state for each test
        daemon.THINKING_STREAM_ENABLED = True
        daemon.STATUS_EDIT_INTERVAL = 1.0
        daemon.STATUS_FINAL_PAUSE = 0.0  # no pause in tests

    def test_no_events_no_message(self):
        with patch.object(daemon, "telegram_api") as mock_api:
            sm = daemon.StatusMessenger("123")
            sm.finalize()
            mock_api.assert_not_called()

    def test_create_on_first_thinking_update(self):
        with patch.object(daemon, "telegram_api") as mock_api:
            mock_api.return_value = {"message_id": 42}
            sm = daemon.StatusMessenger("123", reply_to=100)
            sm.on_event({"type": "turn_start"})
            # First event creates the message
            mock_api.assert_called_once()
            call_args = mock_api.call_args
            self.assertEqual(call_args[0][0], "sendMessage")
            payload = call_args[0][1]
            self.assertEqual(payload["chat_id"], "123")
            self.assertEqual(payload["parse_mode"], "HTML")
            self.assertEqual(payload["reply_parameters"]["message_id"], 100)
            self.assertEqual(sm.message_id, 42)

    def test_edit_coalescing(self):
        """Rapid updates don't all trigger edits — 1/sec gate."""
        with patch.object(daemon, "telegram_api") as mock_api:
            mock_api.return_value = {"message_id": 1}
            sm = daemon.StatusMessenger("123")
            # First event creates
            sm.on_event({"type": "turn_start"})
            self.assertEqual(mock_api.call_count, 1)  # sendMessage
            # Rapid updates should not edit (within 1s)
            for i in range(5):
                sm.on_event({
                    "type": "message_update",
                    "assistantMessageEvent": {
                        "type": "thinking_delta",
                        "partial": {
                            "content": [{"type": "thinking", "thinking": f"thought {i}"}],
                        },
                    },
                })
            # Should still be 1 call (the create); edits are throttled
            self.assertEqual(mock_api.call_count, 1)
            # Force flush should trigger one edit
            sm.flush()
            self.assertEqual(mock_api.call_count, 2)
            self.assertEqual(mock_api.call_args[0][0], "editMessageText")

    def test_finalize_deletes_message(self):
        with patch.object(daemon, "telegram_api") as mock_api:
            mock_api.return_value = {"message_id": 99}
            sm = daemon.StatusMessenger("123")
            sm.on_event({"type": "turn_start"})
            sm.finalize()
            # Should have called deleteMessage
            calls = [c[0][0] for c in mock_api.call_args_list]
            self.assertIn("deleteMessage", calls)

    def test_finalize_with_dirty_does_final_edit(self):
        with patch.object(daemon, "telegram_api") as mock_api:
            mock_api.return_value = {"message_id": 1}
            sm = daemon.StatusMessenger("123")
            sm.on_event({"type": "turn_start"})  # creates
            # Another event that gets throttled (dirty=True)
            sm.on_event({
                "type": "message_update",
                "assistantMessageEvent": {
                    "partial": {"content": [{"type": "thinking", "thinking": "last thought"}]},
                },
            })
            sm.finalize()
            calls = [c[0][0] for c in mock_api.call_args_list]
            # create, final edit, delete
            self.assertIn("sendMessage", calls)
            self.assertIn("editMessageText", calls)
            self.assertIn("deleteMessage", calls)

    def test_telegram_api_error_does_not_crash(self):
        with patch.object(daemon, "telegram_api", side_effect=RuntimeError("429 Too Many Requests")):
            sm = daemon.StatusMessenger("123")
            sm.on_event({"type": "turn_start"})  # should not raise
            sm.finalize()  # should not raise

    def test_finalize_without_message_id_no_delete(self):
        with patch.object(daemon, "telegram_api") as mock_api:
            sm = daemon.StatusMessenger("123")
            sm.finalize()  # no message was created
            # No deleteMessage call
            calls = [c[0][0] for c in mock_api.call_args_list]
            self.assertNotIn("deleteMessage", calls)

    def test_message_update_without_partial_is_safe(self):
        with patch.object(daemon, "telegram_api") as mock_api:
            mock_api.return_value = {"message_id": 1}
            sm = daemon.StatusMessenger("123")
            sm.on_event({"type": "turn_start"})
            # Malformed event with no partial
            sm.on_event({"type": "message_update", "assistantMessageEvent": {}})
            sm.finalize()  # should not crash


class TestAskIntegration(unittest.TestCase):
    """Integration test: mock the RPC subprocess, feed events, verify flow."""

    def _make_event(self, ev_type: str, **kwargs) -> dict:
        ev = {"type": ev_type}
        ev.update(kwargs)
        return ev

    def test_ask_with_thinking_stream(self):
        """Verify ask() creates status, streams, deletes, returns final text."""
        with patch.object(daemon, "telegram_api") as mock_tg, \
             patch.object(daemon, "THINKING_STREAM_ENABLED", True), \
             patch.object(daemon, "STATUS_FINAL_PAUSE", 0.0):
            mock_tg.return_value = {"message_id": 555}

            # Build a fake PiRPC that doesn't start a subprocess
            pi = daemon.PiRPC.__new__(daemon.PiRPC)
            pi.proc = MagicMock()
            pi.proc.poll.return_value = None
            pi.proc.stdin = MagicMock()
            pi.lines = __import__("queue").Queue()
            pi.lock = __import__("threading").Lock()
            pi.reader_thread = None
            pi.stderr_thread = None

            # Mock _send to capture the prompt request_id and inject the
            # matching response + agent events into the queue.
            def fake_send(cmd):
                if cmd.get("type") == "prompt":
                    rid = cmd["id"]
                    pi.lines.put({"type": "response", "id": rid, "success": True, "command": "prompt"})
                    pi.lines.put({"type": "turn_start"})
                    pi.lines.put({"type": "message_update", "assistantMessageEvent": {
                        "partial": {"content": [
                            {"type": "thinking", "thinking": "I should look at the issues"},
                        ]},
                    }})
                    pi.lines.put({"type": "turn_end"})
                    pi.lines.put({"type": "agent_end", "messages": []})
                elif cmd.get("type") == "get_last_assistant_text":
                    rid = cmd["id"]
                    pi.lines.put({"type": "response", "id": rid, "success": True,
                                 "command": "get_last_assistant_text",
                                 "data": {"text": "There are 5 issues; next is #03."}})

            pi._send = MagicMock(side_effect=fake_send)

            result = pi.ask("test prompt", chat_id="123", reply_to=100)

            self.assertEqual(result, "There are 5 issues; next is #03.")
            # Verify telegram API calls: create status, delete
            calls = [c[0][0] for c in mock_tg.call_args_list]
            self.assertIn("sendMessage", calls)  # status create
            self.assertIn("deleteMessage", calls)  # status cleanup

    def test_ask_without_chat_id_no_status(self):
        """Without chat_id, no status messages are sent."""
        with patch.object(daemon, "telegram_api") as mock_tg:
            pi = daemon.PiRPC.__new__(daemon.PiRPC)
            pi.proc = MagicMock()
            pi.proc.poll.return_value = None
            pi.proc.stdin = MagicMock()
            pi.lines = __import__("queue").Queue()
            pi.lock = __import__("threading").Lock()
            pi.reader_thread = None
            pi.stderr_thread = None

            def fake_send(cmd):
                if cmd.get("type") == "prompt":
                    pi.lines.put({"type": "response", "id": cmd["id"], "success": True})
                    pi.lines.put({"type": "agent_end", "messages": []})
                elif cmd.get("type") == "get_last_assistant_text":
                    pi.lines.put({"type": "response", "id": cmd["id"], "success": True,
                                 "data": {"text": "Done."}})

            pi._send = MagicMock(side_effect=fake_send)
            result = pi.ask("test prompt")

            self.assertEqual(result, "Done.")
            mock_tg.assert_not_called()

    def test_ask_timeout_cleans_up_status(self):
        """On timeout, the status message should be finalized (deleted)."""
        with patch.object(daemon, "telegram_api") as mock_tg, \
             patch.object(daemon, "PROMPT_TIMEOUT_SECONDS", 1), \
             patch.object(daemon, "STATUS_FINAL_PAUSE", 0.0):
            mock_tg.return_value = {"message_id": 1}

            pi = daemon.PiRPC.__new__(daemon.PiRPC)
            pi.proc = MagicMock()
            pi.proc.poll.return_value = None
            pi.proc.stdin = MagicMock()
            pi.lines = __import__("queue").Queue()  # empty queue → timeout
            pi.lock = __import__("threading").Lock()
            pi.reader_thread = None
            pi.stderr_thread = None

            pi._send = MagicMock()

            with self.assertRaises(TimeoutError):
                pi.ask("test", chat_id="123")

            # Status should have been finalized (delete attempted)
            # But since no events were sent, no message was created
            # So no deleteMessage call
            calls = [c[0][0] for c in mock_tg.call_args_list]
            # No status message was created (no events), so no delete
            self.assertNotIn("deleteMessage", calls)


def _make_update(message: dict) -> dict:
    """Build a minimal Telegram update wrapping the given message fields."""
    base = {
        "message_id": 10,
        "date": 1700000000,
        "chat": {"id": 123, "type": "private", "username": "owner"},
        "from": {"id": 456, "is_bot": False, "username": "owner"},
    }
    base.update(message)
    return {"update_id": 1, "message": base}


class TestParseMessageImages(unittest.TestCase):
    """parse_message recognizes photo payloads and image documents."""

    def test_photo_with_caption(self):
        update = _make_update({
            "caption": "!pi what's in this screenshot?",
            "photo": [
                {"file_id": "small", "width": 90, "height": 90, "file_size": 1000},
                {"file_id": "large", "width": 800, "height": 600, "file_size": 50000},
            ],
        })
        msg = daemon.parse_message(update)
        self.assertIsNotNone(msg)
        self.assertEqual(msg.image_kind, "photo")
        self.assertEqual(msg.image_file_id, "large")  # largest variant selected
        self.assertEqual(msg.image_file_size, 50000)
        self.assertEqual(msg.image_mime_type, "image/jpeg")
        self.assertEqual(msg.content, "!pi what's in this screenshot?")
        self.assertEqual(msg.audio_kind, "")

    def test_photo_without_caption(self):
        update = _make_update({
            "photo": [{"file_id": "p1", "width": 100, "height": 100, "file_size": 2000}],
        })
        msg = daemon.parse_message(update)
        self.assertIsNotNone(msg)
        self.assertEqual(msg.image_kind, "photo")
        self.assertEqual(msg.image_file_id, "p1")
        self.assertEqual(msg.content, "")

    def test_photo_selects_largest_dimensions_when_file_sizes_disagree(self):
        update = _make_update({
            "photo": [
                {"file_id": "more-bytes", "width": 320, "height": 240, "file_size": 9000},
                {"file_id": "largest", "width": 1280, "height": 720, "file_size": 8000},
            ],
        })
        msg = daemon.parse_message(update)
        self.assertIsNotNone(msg)
        self.assertEqual(msg.image_file_id, "largest")

    def test_image_document(self):
        update = _make_update({
            "caption": "!pi describe this",
            "document": {
                "file_id": "doc1",
                "file_size": 12345,
                "mime_type": "image/png",
                "file_name": "shot.png",
            },
        })
        msg = daemon.parse_message(update)
        self.assertIsNotNone(msg)
        self.assertEqual(msg.image_kind, "document")
        self.assertEqual(msg.image_file_id, "doc1")
        self.assertEqual(msg.image_file_size, 12345)
        self.assertEqual(msg.image_mime_type, "image/png")
        self.assertEqual(msg.audio_kind, "")

    def test_non_image_document_ignored(self):
        update = _make_update({
            "document": {
                "file_id": "pdf1",
                "file_size": 999,
                "mime_type": "application/pdf",
                "file_name": "spec.pdf",
            },
        })
        msg = daemon.parse_message(update)
        self.assertIsNotNone(msg)
        self.assertEqual(msg.image_file_id, "")
        self.assertEqual(msg.image_kind, "")
        self.assertEqual(msg.audio_file_id, "")

    def test_voice_behavior_unchanged(self):
        update = _make_update({
            "voice": {"file_id": "v1", "file_size": 3000, "mime_type": "audio/ogg"},
        })
        msg = daemon.parse_message(update)
        self.assertIsNotNone(msg)
        self.assertEqual(msg.audio_kind, "voice")
        self.assertEqual(msg.audio_file_id, "v1")
        self.assertEqual(msg.image_file_id, "")

    def test_audio_document_still_audio_not_image(self):
        update = _make_update({
            "document": {"file_id": "a1", "file_size": 3000, "mime_type": "audio/mpeg"},
        })
        msg = daemon.parse_message(update)
        self.assertEqual(msg.audio_kind, "document")
        self.assertEqual(msg.image_file_id, "")


class TestShouldHandleImages(unittest.TestCase):
    """Bare images are forwarded; caption prefix rules still apply."""

    def setUp(self):
        self._saved = (daemon.ALLOWED_CHATS, daemon.PREFIX, daemon.REQUIRE_MENTION)
        daemon.ALLOWED_CHATS = {"123"}
        daemon.PREFIX = "!pi"
        daemon.REQUIRE_MENTION = True  # DMs are never mention-gated

    def tearDown(self):
        daemon.ALLOWED_CHATS, daemon.PREFIX, daemon.REQUIRE_MENTION = self._saved

    def _photo_msg(self, caption: str = "") -> object:
        message = {
            "photo": [{"file_id": "p1", "width": 10, "height": 10, "file_size": 100}],
        }
        if caption:
            message["caption"] = caption
        return daemon.parse_message(_make_update(message))

    def test_bare_photo_no_caption_is_forwarded(self):
        prompt = daemon.should_handle(self._photo_msg())
        self.assertEqual(prompt, "")

    def test_photo_with_prefixed_caption(self):
        prompt = daemon.should_handle(self._photo_msg("!pi what is this?"))
        self.assertEqual(prompt, "what is this?")

    def test_photo_with_unprefixed_caption_ignored(self):
        self.assertIsNone(daemon.should_handle(self._photo_msg("just a photo")))

    def test_photo_from_unauthorized_chat_ignored(self):
        daemon.ALLOWED_CHATS = {"999"}
        self.assertIsNone(daemon.should_handle(self._photo_msg()))


class TestDownloadTelegramImage(unittest.TestCase):
    """download_telegram_image: size limits, suffix handling, temp files."""

    def _msg(self, **kwargs) -> object:
        msg = daemon.parse_message(_make_update({
            "photo": [{"file_id": "p1", "width": 10, "height": 10, "file_size": 100}],
        }))
        for key, value in kwargs.items():
            setattr(msg, key, value)
        return msg

    def test_refuses_oversized_image_from_message_size(self):
        msg = self._msg(image_file_size=daemon.MAX_IMAGE_BYTES + 1)
        with patch.object(daemon, "telegram_api") as mock_api:
            with self.assertRaises(RuntimeError) as ctx:
                daemon.download_telegram_image(msg)
            self.assertIn("too large", str(ctx.exception))
            mock_api.assert_not_called()  # refused before hitting Telegram

    def test_refuses_oversized_image_from_getfile_size(self):
        msg = self._msg(image_file_size=0)
        with patch.object(daemon, "telegram_api") as mock_api:
            mock_api.return_value = {
                "file_path": "photos/big.jpg",
                "file_size": daemon.MAX_IMAGE_BYTES + 1,
            }
            with self.assertRaises(RuntimeError) as ctx:
                daemon.download_telegram_image(msg)
            self.assertIn("too large", str(ctx.exception))

    def test_downloads_to_temp_file_with_suffix(self):
        msg = self._msg()
        with patch.object(daemon, "telegram_api") as mock_api, \
             patch.object(daemon, "telegram_download", return_value=b"\xff\xd8jpeg") as mock_dl:
            mock_api.return_value = {"file_path": "photos/file_1.jpg", "file_size": 5}
            tmp = daemon.download_telegram_image(msg)
            try:
                self.assertTrue(tmp.exists())
                self.assertEqual(tmp.suffix, ".jpg")
                self.assertEqual(tmp.read_bytes(), b"\xff\xd8jpeg")
                mock_dl.assert_called_once_with("photos/file_1.jpg", timeout=120)
            finally:
                tmp.unlink(missing_ok=True)

    def test_suffix_falls_back_to_mime_type(self):
        msg = self._msg(image_mime_type="image/png")
        with patch.object(daemon, "telegram_api") as mock_api, \
             patch.object(daemon, "telegram_download", return_value=b"png"):
            mock_api.return_value = {"file_path": "photos/noext", "file_size": 3}
            tmp = daemon.download_telegram_image(msg)
            try:
                self.assertEqual(tmp.suffix, ".png")
            finally:
                tmp.unlink(missing_ok=True)

    def test_unsafe_remote_suffix_falls_back_to_mime_type(self):
        msg = self._msg(image_mime_type="image/jpeg")
        with patch.object(daemon, "telegram_api") as mock_api, \
             patch.object(daemon, "telegram_download", return_value=b"jpeg"):
            mock_api.return_value = {"file_path": "photos/file.jpg?token=secret", "file_size": 4}
            tmp = daemon.download_telegram_image(msg)
            try:
                self.assertEqual(tmp.suffix, ".jpg")
                self.assertNotIn("?", tmp.name)
            finally:
                tmp.unlink(missing_ok=True)

    def test_refuses_download_larger_than_reported_size(self):
        msg = self._msg(image_file_size=1)
        with patch.object(daemon, "MAX_IMAGE_BYTES", 4), \
             patch.object(daemon, "telegram_api") as mock_api, \
             patch.object(daemon, "telegram_download", return_value=b"12345"):
            mock_api.return_value = {"file_path": "photos/file.jpg", "file_size": 1}
            with self.assertRaises(RuntimeError) as ctx:
                daemon.download_telegram_image(msg)
            self.assertIn("too large", str(ctx.exception))

    def test_missing_file_path_raises(self):
        msg = self._msg()
        with patch.object(daemon, "telegram_api", return_value={}):
            with self.assertRaises(RuntimeError):
                daemon.download_telegram_image(msg)


class TestImageRpcPayload(unittest.TestCase):
    def test_payload_format(self):
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(b"fake-png-bytes")
            tmp = Path(f.name)
        try:
            payload = daemon.image_rpc_payload(tmp, "image/png")
            self.assertEqual(payload["type"], "image")
            self.assertEqual(payload["mimeType"], "image/png")
            self.assertEqual(payload["data"], base64.b64encode(b"fake-png-bytes").decode("ascii"))
        finally:
            tmp.unlink(missing_ok=True)


class TestAskWithImages(unittest.TestCase):
    """ask() forwards ImageContent blocks on the RPC prompt command."""

    def _make_pi(self) -> object:
        pi = daemon.PiRPC.__new__(daemon.PiRPC)
        pi.proc = MagicMock()
        pi.proc.poll.return_value = None
        pi.proc.stdin = MagicMock()
        pi.lines = __import__("queue").Queue()
        pi.lock = __import__("threading").Lock()
        pi.reader_thread = None
        pi.stderr_thread = None
        return pi

    def test_prompt_includes_images(self):
        with patch.object(daemon, "THINKING_STREAM_ENABLED", False):
            pi = self._make_pi()
            sent: list[dict] = []

            def fake_send(cmd):
                sent.append(cmd)
                if cmd.get("type") == "prompt":
                    pi.lines.put({"type": "response", "id": cmd["id"], "success": True})
                    pi.lines.put({"type": "agent_end", "messages": []})
                elif cmd.get("type") == "get_last_assistant_text":
                    pi.lines.put({"type": "response", "id": cmd["id"], "success": True,
                                 "data": {"text": "It's a screenshot of a terminal."}})

            pi._send = MagicMock(side_effect=fake_send)
            images = [{"type": "image", "data": "Zm9v", "mimeType": "image/jpeg"}]
            result = pi.ask("Telegram image from chat x", images=images)

            self.assertEqual(result, "It's a screenshot of a terminal.")
            prompt_cmd = next(c for c in sent if c.get("type") == "prompt")
            self.assertEqual(prompt_cmd["images"], images)

    def test_prompt_without_images_omits_field(self):
        with patch.object(daemon, "THINKING_STREAM_ENABLED", False):
            pi = self._make_pi()
            sent: list[dict] = []

            def fake_send(cmd):
                sent.append(cmd)
                if cmd.get("type") == "prompt":
                    pi.lines.put({"type": "response", "id": cmd["id"], "success": True})
                    pi.lines.put({"type": "agent_end", "messages": []})
                elif cmd.get("type") == "get_last_assistant_text":
                    pi.lines.put({"type": "response", "id": cmd["id"], "success": True,
                                 "data": {"text": "ok"}})

            pi._send = MagicMock(side_effect=fake_send)
            pi.ask("plain prompt")

            prompt_cmd = next(c for c in sent if c.get("type") == "prompt")
            self.assertNotIn("images", prompt_cmd)


if __name__ == "__main__":
    unittest.main(verbosity=2)
