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


class TestSanitizeTitle(unittest.TestCase):
    """Port of TUI sanitizeTitle — strips ANSI, markdown, HTML, collapses whitespace."""

    def test_strips_headings_fences_and_emphasis(self):
        self.assertEqual(
            daemon._sanitize_title("## Output\n```sh\nhello\n```\nDone **now** with `x`"),
            "Output",
        )

    def test_strips_markdown_link(self):
        self.assertEqual(daemon._sanitize_title("See [docs](https://x.com)"), "See docs")

    def test_strips_ansi_escapes(self):
        self.assertEqual(daemon._sanitize_title("\x1b[32mGreen text\x1b[0m"), "Green text")

    def test_first_non_empty_line(self):
        self.assertEqual(daemon._sanitize_title("\n\n  \nActual title"), "Actual title")

    def test_empty_returns_none(self):
        self.assertIsNone(daemon._sanitize_title(""))
        self.assertIsNone(daemon._sanitize_title("   \n  "))

    def test_strips_html_tags(self):
        self.assertEqual(daemon._sanitize_title("<b>Bold</b> text"), "Bold text")


class TestTraceBuilder(unittest.TestCase):
    """Unit tests for TraceBuilder — pure logic, no I/O."""

    def _new_tree(self):
        tree = daemon.TraceBuilder()
        tree.start_time = 0.0  # deterministic: render(N) → elapsed=N
        return tree

    # -- header / empty ---------------------------------------------------

    def test_empty_render_shows_only_header(self):
        tree = self._new_tree()
        text = tree.render(5)
        self.assertIn("thinking · 0:05", text)

    def test_elapsed_rolls_over_to_minutes(self):
        tree = self._new_tree()
        text = tree.render(75)
        self.assertIn("thinking · 1:15", text)
        self.assertNotIn("0:75", text)

    def test_turn_start_alone_shows_only_header(self):
        """No content yet — just the header, no steps."""
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        text = tree.render(1)
        self.assertIn("thinking · 0:01", text)
        # No step lines yet (no content assembled)
        self.assertNotIn("▸", text)
        self.assertNotIn("▹", text)

    # -- text title + tool calls ------------------------------------------

    def test_text_title_with_tool_call(self):
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "text", "text": "Reading config"},
            {"type": "toolCall", "id": "c1", "name": "read", "arguments": {"path": "config.toml"}},
        ]})
        text = tree.render(2)
        self.assertIn("Reading config", text)
        self.assertIn("▹", text)  # pending step (tool not completed)
        # Compact render: no tool detail, only title + timer
        self.assertNotIn("config.toml", text)

    def test_completed_step_shows_filled_triangle(self):
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "text", "text": "Reading config"},
            {"type": "toolCall", "id": "c1", "name": "read", "arguments": {"path": "config.toml"}},
        ]})
        tree.on_tool_execution_start("c1", "read", {"path": "config.toml"})
        tree.on_tool_execution_end("c1", False)
        tree.on_turn_end()
        text = tree.render(3)
        self.assertIn("▸", text)  # completed step
        self.assertNotIn("▹", text)
        # Tool glyphs and summaries are not rendered on mobile
        self.assertNotIn("◆", text)
        self.assertNotIn("loaded", text)

    # -- fallback titles (no explicit text) -------------------------------

    def test_fallback_title_read(self):
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "toolCall", "id": "c1", "name": "read", "arguments": {"path": "config.toml"}},
        ]})
        text = tree.render(1)
        self.assertIn("Reading", text)
        self.assertIn("config.toml", text)  # part of the derived title

    def test_fallback_title_edit(self):
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "toolCall", "id": "c1", "name": "edit", "arguments": {"path": "daemon.py"}},
        ]})
        text = tree.render(1)
        self.assertIn("Updating", text)
        self.assertIn("daemon.py", text)

    def test_fallback_title_bash(self):
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "toolCall", "id": "c1", "name": "bash", "arguments": {"command": "echo hello"}},
        ]})
        text = tree.render(1)
        # Fallback title summarizes the command intent
        self.assertIn("Printing", text)
        # Compact render: no tool summary line
        self.assertNotIn("$ echo hello", text)

    def test_fallback_title_checks(self):
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "toolCall", "id": "c1", "name": "bash", "arguments": {"command": "npm test"}},
        ]})
        text = tree.render(1)
        self.assertIn("Running checks", text)

    # -- summary helpers (not rendered, but tracked in the model) ---------

    def test_summary_text_edit_count(self):
        """_summary_text still formats tool summaries for potential future use."""
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "toolCall", "id": "c1", "name": "edit", "arguments": {
                "path": "daemon.py", "edits": [{"oldText": "a", "newText": "b"}]}},
        ]})
        tree.on_tool_execution_end("c1", False)
        tree.on_turn_end()
        summary = daemon._summary_text(tree.steps[0], 0.0)
        self.assertIn("1 edit", summary)
        self.assertIn("updated", summary)

    def test_summary_text_bash_command(self):
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "toolCall", "id": "c1", "name": "bash", "arguments": {"command": "git status"}},
        ]})
        summary = daemon._summary_text(tree.steps[0], 0.0)
        self.assertIn("$ git status", summary)

    # -- thinking ---------------------------------------------------------

    def test_thinking_draft_shown(self):
        """Thinking with no tool calls shows a thinking draft."""
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_start({"role": "assistant"})
        tree.on_assistant_event({"type": "thinking_delta", "contentIndex": 0,
                                 "delta": "I need to check the config"})
        text = tree.render(1)
        # Compact render: thinking draft shows title only, no bullets
        self.assertIn("Thinking", text)
        self.assertIn("▹", text)
        self.assertNotIn("•", text)
        self.assertNotIn("check the config", text)

    def test_thinking_with_tools_shows_bullets(self):
        """Thinking + tool calls: title from text, thinking shown as bullets."""
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "text", "text": "Analyzing the request"},
            {"type": "thinking", "thinking": "Need to check the config"},
            {"type": "toolCall", "id": "c1", "name": "read", "arguments": {"path": "config.toml"}},
        ]})
        text = tree.render(1)
        self.assertIn("Analyzing the request", text)
        # Compact render: no thinking bullets or tool glyphs
        self.assertNotIn("•", text)
        self.assertNotIn("Need to check the config", text)
        self.assertNotIn("◇", text)

    def test_thinking_no_text_shows_thinking_title(self):
        """Thinking + tools but no text: title defaults to 'Thinking'."""
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "thinking", "thinking": "Deep thought about the problem"},
            {"type": "toolCall", "id": "c1", "name": "read", "arguments": {"path": "x.py"}},
        ]})
        text = tree.render(1)
        self.assertIn("Thinking", text)
        # No thinking bullets in compact render
        self.assertNotIn("•", text)

    # -- tree structure ---------------------------------------------------

    def test_multiple_steps_tree_connectors(self):
        """Multiple steps show tree connectors (├─/└─/│)."""
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "text", "text": "Step 1"},
            {"type": "toolCall", "id": "c1", "name": "bash", "arguments": {"command": "ls"}},
        ]})
        tree.on_tool_execution_end("c1", False)
        tree.on_turn_end()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "text", "text": "Step 2"},
            {"type": "toolCall", "id": "c2", "name": "bash", "arguments": {"command": "pwd"}},
        ]})
        text = tree.render(5)
        self.assertIn("Step 1", text)
        self.assertIn("Step 2", text)
        # Compact render: no tree connectors
        self.assertNotIn("├─", text)
        self.assertNotIn("└─", text)
        self.assertNotIn("│", text)

    def test_activity_header_shows_counts(self):
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "text", "text": "Step 1"},
            {"type": "toolCall", "id": "c1", "name": "read", "arguments": {"path": "a.py"}},
            {"type": "toolCall", "id": "c2", "name": "read", "arguments": {"path": "b.py"}},
        ]})
        text = tree.render(1)
        # Compact render: no activity header
        self.assertNotIn("step", text)
        self.assertNotIn("call", text)

    def test_activity_header_all_passed(self):
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "toolCall", "id": "c1", "name": "bash", "arguments": {"command": "echo ok"}},
        ]})
        tree.on_tool_execution_end("c1", False)
        tree.on_turn_end()
        text = tree.render(1)
        self.assertNotIn("all passed", text)

    def test_activity_header_failed(self):
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "toolCall", "id": "c1", "name": "bash", "arguments": {"command": "false"}},
        ]})
        tree.on_tool_execution_end("c1", True)
        tree.on_turn_end()
        text = tree.render(1)
        self.assertIn("×", text)  # failed step glyph

    # -- tool summary format ----------------------------------------------

    def test_edit_summary_shows_edit_count(self):
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "toolCall", "id": "c1", "name": "edit", "arguments": {
                "path": "daemon.py", "edits": [{"oldText": "a", "newText": "b"}]}},
        ]})
        tree.on_tool_execution_end("c1", False)
        tree.on_turn_end()
        text = tree.render(1)
        self.assertNotIn("1 edit", text)
        self.assertNotIn("updated", text)

    def test_bash_summary_shows_command(self):
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "toolCall", "id": "c1", "name": "bash", "arguments": {"command": "git status"}},
        ]})
        text = tree.render(1)
        self.assertNotIn("$ git status", text)
        self.assertNotIn("running", text)

    def test_multiple_bash_shows_per_call_lines(self):
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "toolCall", "id": "c1", "name": "bash", "arguments": {"command": "echo a"}},
            {"type": "toolCall", "id": "c2", "name": "bash", "arguments": {"command": "echo b"}},
        ]})
        text = tree.render(1)
        self.assertNotIn("$ echo a", text)
        self.assertNotIn("$ echo b", text)

    # -- elapsed timers ---------------------------------------------------

    def test_running_tool_shows_elapsed(self):
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "toolCall", "id": "c1", "name": "bash", "arguments": {"command": "sleep 10"}},
        ]})
        tree.on_tool_execution_start("c1", "bash", {"command": "sleep 10"})
        # Override timestamps for deterministic testing (on_tool_execution_start
        # uses real time.monotonic, which doesn't match start_time=0.0)
        tree.current_step.started_at = 0.0
        tree.current_step.tool_calls[0].started_at = 0.0
        # Simulate 2.5 seconds elapsed
        text = tree.render(2.5)
        self.assertIn("2.", text)  # 2.Xs
        self.assertIn("s", text)

    # -- HTML escaping ----------------------------------------------------

    def test_html_escaping_in_title(self):
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "text", "text": "<script>alert(1)</script>"},
            {"type": "toolCall", "id": "c1", "name": "bash", "arguments": {"command": "ls"}},
        ]})
        text = tree.render(1)
        # sanitizeTitle strips HTML tags, leaving just the text content
        self.assertIn("alert(1)", text)
        self.assertNotIn("<script>", text)

    def test_html_escaping_in_thinking(self):
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_start({"role": "assistant"})
        tree.on_assistant_event({"type": "thinking_delta", "contentIndex": 0,
                                 "delta": "Use <b> & <i> tags"})
        text = tree.render(1)
        # Compact render: thinking draft title only, no bullet lines
        self.assertNotIn("•", text)
        self.assertNotIn("&amp;", text)

    def test_html_escaping_in_command(self):
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "toolCall", "id": "c1", "name": "bash", "arguments": {"command": "echo '<x>'"}},
        ]})
        text = tree.render(1)
        # Title is derived from fallback, not the command; no command in render
        self.assertNotIn("<x>", text)

    # -- title truncation -------------------------------------------------

    def test_long_title_truncated(self):
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        long_title = "x" * 100
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "text", "text": long_title},
            {"type": "toolCall", "id": "c1", "name": "bash", "arguments": {"command": "ls"}},
        ]})
        text = tree.render(1)
        self.assertIn("…", text)
        self.assertLess(text.count("x"), 100)

    # -- delta assembly ---------------------------------------------------

    def test_text_deltas_accumulate(self):
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_start({"role": "assistant"})
        tree.on_assistant_event({"type": "text_start", "contentIndex": 0})
        tree.on_assistant_event({"type": "text_delta", "contentIndex": 0, "delta": "Editing "})
        tree.on_assistant_event({"type": "text_delta", "contentIndex": 0, "delta": "daemon"})
        tree.on_assistant_event({"type": "toolcall_end", "contentIndex": 1, "toolCall": {
            "id": "t1", "name": "edit", "arguments": {"path": "d.py"},
        }})
        text = tree.render(1)
        self.assertIn("Editing daemon", text)

    def test_toolcall_end_from_delta(self):
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_start({"role": "assistant"})
        tree.on_assistant_event({"type": "toolcall_start", "contentIndex": 0})
        tree.on_assistant_event({"type": "toolcall_delta", "contentIndex": 0, "delta": ""})
        tree.on_assistant_event({"type": "toolcall_end", "contentIndex": 0, "toolCall": {
            "type": "toolCall", "id": "t1", "name": "read", "arguments": {"path": "/etc/hosts"},
        }})
        text = tree.render(1)
        self.assertIn("Reading", text)
        self.assertIn("hosts", text)

    def test_toolcall_arguments_as_json_string(self):
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_start({"role": "assistant"})
        tree.on_assistant_event({"type": "toolcall_end", "contentIndex": 0, "toolCall": {
            "name": "bash", "arguments": '{"command": "git status"}',
        }})
        text = tree.render(1)
        # Fallback title summarizes: git status → "Git status"
        self.assertIn("git status", text)
        self.assertNotIn("$ git status", text)

    def test_message_end_applies_authoritative_content(self):
        """Non-streaming providers only emit message_start/message_end."""
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "text", "text": "Final label"},
            {"type": "toolCall", "id": "c1", "name": "bash", "arguments": {"command": "ls"}},
        ]})
        text = tree.render(1)
        self.assertIn("Final label", text)

    def test_non_assistant_messages_do_not_reset_blocks(self):
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_start({"role": "assistant"})
        tree.on_assistant_event({"type": "text_delta", "contentIndex": 0, "delta": "My title"})
        tree.on_assistant_event({"type": "toolcall_end", "contentIndex": 1, "toolCall": {
            "id": "c1", "name": "bash", "arguments": {"command": "ls"},
        }})
        tree.on_message_start({"role": "toolResult"})
        tree.on_message_end({"role": "toolResult", "content": [{"type": "toolResult", "output": "x"}]})
        text = tree.render(1)
        self.assertIn("My title", text)

    def test_assistant_message_start_resets_blocks(self):
        """Each assistant message gets its own step; old steps persist in the tree."""
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_start({"role": "assistant"})
        tree.on_assistant_event({"type": "text_delta", "contentIndex": 0, "delta": "Old"})
        tree.on_assistant_event({"type": "toolcall_end", "contentIndex": 1, "toolCall": {
            "id": "c1", "name": "bash", "arguments": {"command": "ls"},
        }})
        tree.on_message_start({"role": "assistant"})
        tree.on_assistant_event({"type": "text_delta", "contentIndex": 0, "delta": "New"})
        tree.on_assistant_event({"type": "toolcall_end", "contentIndex": 1, "toolCall": {
            "id": "c2", "name": "bash", "arguments": {"command": "ls"},
        }})
        text = tree.render(1)
        self.assertIn("New", text)
        # Both steps visible (compact render still shows all steps)
        self.assertIn("Old", text)

    # -- agent_end fails pending ------------------------------------------

    def test_agent_end_fails_pending_steps(self):
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "toolCall", "id": "c1", "name": "bash", "arguments": {"command": "ls"}},
        ]})
        # Don't complete the tool — agent_end should mark it failed
        tree.on_agent_end()
        text = tree.render(1)
        self.assertIn("×", text)  # failed step glyph

    # -- markdown stripping in titles -------------------------------------

    def test_markdown_stripped_from_title(self):
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "text", "text": "**Bold** goal with `code`"},
            {"type": "toolCall", "id": "c1", "name": "bash", "arguments": {"command": "ls"}},
        ]})
        text = tree.render(1)
        self.assertIn("Bold goal with code", text)
        self.assertNotIn("**", text)

    # -- total truncation -------------------------------------------------

    def test_total_message_truncation(self):
        """When total exceeds MAX_REPLY_CHARS, it's truncated with ellipsis."""
        tree = self._new_tree()
        tree.on_agent_start()
        for i in range(300):
            tree.on_turn_start()
            tree.on_message_end({"role": "assistant", "content": [
                {"type": "text", "text": f"Goal {i}: " + "y" * 200},
                {"type": "toolCall", "id": f"c{i}", "name": "bash", "arguments": {"command": "ls"}},
            ]})
            tree.on_tool_execution_end(f"c{i}", False)
            tree.on_turn_end()
        text = tree.render(99)
        self.assertLessEqual(len(text), daemon.MAX_REPLY_CHARS)
        self.assertTrue(text.endswith("…"))
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
                        "contentIndex": 0,
                        "delta": f"thought {i} ",
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
                    "type": "thinking_delta",
                    "contentIndex": 0,
                    "delta": "last thought",
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

    def test_malformed_message_update_is_safe(self):
        with patch.object(daemon, "telegram_api") as mock_api:
            mock_api.return_value = {"message_id": 1}
            sm = daemon.StatusMessenger("123")
            sm.on_event({"type": "turn_start"})
            # Events with no delta type and no contentIndex must be ignored.
            sm.on_event({"type": "message_update", "assistantMessageEvent": {}})
            sm.on_event({"type": "message_update", "assistantMessageEvent": {"type": "text_delta"}})
            sm.finalize()  # should not crash

    def test_streaming_deltas_show_text_title(self):
        """Regression: labels stayed "working…" when deltas were ignored."""
        with patch.object(daemon, "telegram_api") as mock_api:
            mock_api.return_value = {"message_id": 1}
            sm = daemon.StatusMessenger("123")
            sm.tree.start_time = 0.0
            sm.on_event({"type": "agent_start"})
            sm.on_event({"type": "turn_start"})
            sm.on_event({"type": "message_start", "message": {"role": "assistant"}})
            sm.on_event({"type": "message_update", "assistantMessageEvent": {
                "type": "text_delta", "contentIndex": 0, "delta": "Reading config",
            }})
            text = sm.tree.render(3)
            self.assertIn("Reading config", text)


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
                    pi.lines.put({"type": "message_start", "message": {"role": "assistant"}})
                    pi.lines.put({"type": "message_update", "assistantMessageEvent": {
                        "type": "thinking_delta", "contentIndex": 0,
                        "delta": "I should look at the issues",
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
