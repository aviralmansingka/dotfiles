#!/usr/bin/env python3
"""Tests for pi-telegram-daemon.

Run with: python3 -m unittest test_pi_telegram_daemon -v
All tests are offline and deterministic: the Telegram API is always mocked,
timers use injected/fake clocks, and no sleep exceeds 100 ms.
"""

from __future__ import annotations

import base64
import importlib.util
import json
import os
import re
import shutil
import sys
import tempfile
import time
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

    def test_fallback_title_uses_substantive_command_after_separator(self):
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "toolCall", "id": "c1", "name": "bash", "arguments": {
                "command": "date; ls -t /tmp/builds | head -1",
            }},
        ]})
        text = tree.render(1)
        self.assertIn("Listing files builds", text)
        self.assertNotIn("date;", text)

    def test_fallback_title_finds_loop_body_command(self):
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "toolCall", "id": "c1", "name": "bash", "arguments": {
                "command": "for f in *.log; do grep -q error \"$f\"; done",
            }},
        ]})
        text = tree.render(1)
        self.assertIn("Searching text error", text)
        self.assertNotIn(" for", text)

    def test_fallback_title_condenses_long_quoted_search_pattern(self):
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "toolCall", "id": "c1", "name": "bash", "arguments": {
                "command": "rg -n '123456789012345678901234|another-pattern' sessions",
            }},
        ]})
        text = tree.render(1)
        self.assertIn("Searching text 123456789012345678901234", text)
        self.assertNotIn("|</b>", text)

    def test_fallback_title_skips_multiline_assignment(self):
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "toolCall", "id": "c1", "name": "bash", "arguments": {
                "command": "ROOT=/tmp/builds\nls -t \"$ROOT\" | head -1",
            }},
        ]})
        text = tree.render(1)
        self.assertIn("Listing files $ROOT", text)
        self.assertNotIn("Running command", text)

    def test_fallback_title_keeps_trailing_slash_search_subject(self):
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "toolCall", "id": "c1", "name": "bash", "arguments": {
                "command": "grep -R /tmp/builds/ output.log",
            }},
        ]})
        text = tree.render(1)
        self.assertIn("Searching text builds", text)

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
        """Thinking with no tool calls shows the first thinking line as title."""
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_start({"role": "assistant"})
        tree.on_assistant_event({"type": "thinking_delta", "contentIndex": 0,
                                 "delta": "I need to check the config"})
        text = tree.render(1)
        # No tools, no text title → first thinking line is the title
        self.assertIn("check the config", text)
        self.assertIn("▹", text)
        self.assertNotIn("•", text)
        self.assertNotIn("Thinking", text)

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

    def test_thinking_no_text_prefers_tool_title(self):
        """Thinking + tools but no text: tool-derived title preferred over 'Thinking'."""
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "thinking", "thinking": "Deep thought about the problem"},
            {"type": "toolCall", "id": "c1", "name": "read", "arguments": {"path": "x.py"}},
        ]})
        text = tree.render(1)
        # Tool fallback wins over "Thinking" when tools are present
        self.assertIn("Reading", text)
        self.assertIn("x.py", text)
        self.assertNotIn("Thinking", text)
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

    def test_no_per_step_timer_in_render(self):
        """Timers were removed — step lines carry glyph + title only."""
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "text", "text": "Running tests"},
            {"type": "toolCall", "id": "c1", "name": "bash", "arguments": {"command": "sleep 10"}},
        ]})
        tree.on_tool_execution_start("c1", "bash", {"command": "sleep 10"})
        tree.current_step.started_at = 0.0
        tree.current_step.tool_calls[0].started_at = 0.0
        text = tree.render(2.5)
        self.assertIn("Running tests", text)
        # No elapsed suffix on the step line
        step_line = [l for l in text.split("\n") if "Running tests" in l][0]
        self.assertNotIn("s", step_line.split("</b>")[-1])
        self.assertTrue(step_line.endswith("</b>"))

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
        # Thinking line used as title; sanitizeTitle strips HTML tags,
        # & is HTML-escaped in output
        self.assertNotIn("•", text)
        self.assertIn("&amp;", text)
        self.assertNotIn("<i>", text)

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

    # -- dedup -----------------------------------------------------------

    def test_same_title_steps_merge(self):
        """Two consecutive steps with the same title merge into one line."""
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "toolCall", "id": "c1", "name": "bash", "arguments": {"command": "grep -r cache /etc"}},
        ]})
        tree.on_tool_execution_end("c1", False)
        tree.on_turn_end()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "thinking", "thinking": "Let me also check the cache config"},
            {"type": "toolCall", "id": "c2", "name": "bash", "arguments": {"command": "grep -r cache /var"}},
        ]})
        text = tree.render(5)
        # Only one "Searching text cache" line, not two
        self.assertEqual(text.count("Searching text cache"), 1)
        self.assertEqual(len([l for l in text.split("\n") if "▸" in l or "▹" in l]), 1)

    def test_different_title_steps_do_not_merge(self):
        """Steps with different titles stay as separate lines."""
        tree = self._new_tree()
        tree.on_agent_start()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "toolCall", "id": "c1", "name": "bash", "arguments": {"command": "grep -r cache /etc"}},
        ]})
        tree.on_tool_execution_end("c1", False)
        tree.on_turn_end()
        tree.on_turn_start()
        tree.on_message_end({"role": "assistant", "content": [
            {"type": "toolCall", "id": "c2", "name": "read", "arguments": {"path": "config.toml"}},
        ]})
        tree.on_tool_execution_end("c2", False)
        tree.on_turn_end()
        text = tree.render(5)
        self.assertIn("Searching text cache", text)
        self.assertIn("Reading config.toml", text)

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


# ---------------------------------------------------------------------------
# X2: group-chat mention gating (#126 multi-bot reply-loop guard)
# ---------------------------------------------------------------------------


class TestMentionGating(unittest.TestCase):
    """fetch_bot_identity / mention matching / mention stripping / should_handle."""

    def setUp(self):
        self._saved = (
            daemon.BOT_ID, daemon.BOT_USERNAME, daemon.ALLOWED_CHATS,
            daemon.PREFIX, daemon.REQUIRE_MENTION, daemon.MENTION_STRIP,
        )
        daemon.BOT_ID = 42
        daemon.BOT_USERNAME = "mybot"
        daemon.ALLOWED_CHATS = {"123"}
        daemon.PREFIX = "!pi"
        daemon.REQUIRE_MENTION = True
        daemon.MENTION_STRIP = True

    def tearDown(self):
        (daemon.BOT_ID, daemon.BOT_USERNAME, daemon.ALLOWED_CHATS,
         daemon.PREFIX, daemon.REQUIRE_MENTION, daemon.MENTION_STRIP) = self._saved

    def _msg(self, text="", chat_type="supergroup", entities=None,
             reply_to=None, sender_is_bot=False):
        message = {
            "message_id": 10,
            "date": 1700000000,
            "text": text,
            "chat": {"id": 123, "type": chat_type, "title": "Dev"},
            "from": {"id": 456, "is_bot": sender_is_bot, "username": "owner"},
        }
        if entities is not None:
            message["entities"] = entities
        if reply_to is not None:
            message["reply_to_message"] = reply_to
        return daemon.parse_message({"update_id": 1, "message": message})

    # -- fetch_bot_identity (mocked getMe) --------------------------------

    def test_fetch_bot_identity_populates_globals(self):
        with patch.object(daemon, "telegram_api") as api:
            api.return_value = {"id": 42, "username": "@MyBot"}
            daemon.BOT_ID, daemon.BOT_USERNAME = None, ""
            daemon.fetch_bot_identity()
            api.assert_called_once_with("getMe", {}, timeout=10)
            self.assertEqual(daemon.BOT_ID, 42)
            self.assertEqual(daemon.BOT_USERNAME, "mybot")  # @ stripped, lowered

    def test_fetch_bot_identity_failure_is_nonfatal(self):
        with patch.object(daemon, "telegram_api", side_effect=RuntimeError("network down")):
            daemon.BOT_ID, daemon.BOT_USERNAME = None, ""
            daemon.fetch_bot_identity()  # must not raise: daemon keeps running
            self.assertIsNone(daemon.BOT_ID)
            self.assertEqual(daemon.BOT_USERNAME, "")

    def test_fetch_bot_identity_missing_id(self):
        with patch.object(daemon, "telegram_api", return_value={}):
            daemon.BOT_ID, daemon.BOT_USERNAME = None, ""
            daemon.fetch_bot_identity()
            self.assertIsNone(daemon.BOT_ID)

    # -- message_mentions_bot ----------------------------------------------

    def test_mention_entity_matches_bot(self):
        msg = self._msg("@mybot do the thing",
                        entities=[{"type": "mention", "offset": 0, "length": 7}])
        self.assertTrue(daemon.message_mentions_bot(msg))

    def test_mention_entity_other_bot_does_not_match(self):
        msg = self._msg("@otherbot hi",
                        entities=[{"type": "mention", "offset": 0, "length": 10}])
        self.assertFalse(daemon.message_mentions_bot(msg))

    def test_text_mention_matches_bot_user_id(self):
        msg = self._msg("ping",
                        entities=[{"type": "text_mention", "offset": 0, "length": 4,
                                   "user": {"id": 42}}])
        self.assertTrue(daemon.message_mentions_bot(msg))

    def test_text_mention_other_user_does_not_match(self):
        msg = self._msg("ping",
                        entities=[{"type": "text_mention", "offset": 0, "length": 4,
                                   "user": {"id": 999}}])
        self.assertFalse(daemon.message_mentions_bot(msg))

    def test_bot_command_with_bot_suffix_matches(self):
        msg = self._msg("/status@mybot",
                        entities=[{"type": "bot_command", "offset": 0, "length": 13}])
        self.assertTrue(daemon.message_mentions_bot(msg))

    def test_bot_command_other_suffix_does_not_match(self):
        msg = self._msg("/status@otherbot",
                        entities=[{"type": "bot_command", "offset": 0, "length": 16}])
        self.assertFalse(daemon.message_mentions_bot(msg))

    def test_bare_bot_command_does_not_match(self):
        msg = self._msg("/status",
                        entities=[{"type": "bot_command", "offset": 0, "length": 7}])
        self.assertFalse(daemon.message_mentions_bot(msg))

    def test_no_identity_never_matches(self):
        daemon.BOT_ID, daemon.BOT_USERNAME = None, ""
        msg = self._msg("@mybot hi",
                        entities=[{"type": "mention", "offset": 0, "length": 7}])
        self.assertFalse(daemon.message_mentions_bot(msg))

    def test_invalid_entity_offsets_are_skipped(self):
        msg = self._msg("@mybot hi",
                        entities=[{"type": "mention", "offset": -1, "length": 7}])
        self.assertFalse(daemon.message_mentions_bot(msg))

    # -- is_reply_to_bot ----------------------------------------------------

    def test_reply_to_bot_matches(self):
        msg = self._msg("!pi hello",
                        reply_to={"message_id": 5, "from": {"id": 42, "is_bot": True}})
        self.assertTrue(daemon.is_reply_to_bot(msg))

    def test_reply_to_other_user_does_not_match(self):
        msg = self._msg("!pi hello",
                        reply_to={"message_id": 5, "from": {"id": 999, "is_bot": False}})
        self.assertFalse(daemon.is_reply_to_bot(msg))

    def test_reply_check_requires_identity(self):
        daemon.BOT_ID = None
        msg = self._msg("!pi hello",
                        reply_to={"message_id": 5, "from": {"id": 42, "is_bot": True}})
        self.assertFalse(daemon.is_reply_to_bot(msg))

    # -- strip_bot_mention ---------------------------------------------------

    def test_strip_mention_leaves_prompt(self):
        self.assertEqual(daemon.strip_bot_mention("hey @MyBot please"), "hey please")

    def test_strip_leading_mention_and_punctuation(self):
        self.assertEqual(daemon.strip_bot_mention("@MyBot, run tests"), "run tests")

    def test_similar_bot_name_is_not_stripped(self):
        self.assertEqual(daemon.strip_bot_mention("@mybot2 hi"), "@mybot2 hi")

    def test_bare_mention_strips_to_empty(self):
        # A message that is only the mention must strip to empty so
        # should_handle can map it to "status".
        self.assertEqual(daemon.strip_bot_mention("@MyBot"), "")

    def test_strip_without_identity_is_noop(self):
        daemon.BOT_USERNAME = ""
        self.assertEqual(daemon.strip_bot_mention("@mybot hi"), "@mybot hi")

    # -- should_handle gating -------------------------------------------------

    def test_group_message_without_mention_is_ignored(self):
        msg = self._msg("!pi do the thing")
        self.assertIsNone(daemon.should_handle(msg))

    def test_group_message_with_mention_is_handled_and_stripped(self):
        msg = self._msg("!pi @mybot do the thing",
                        entities=[{"type": "mention", "offset": 4, "length": 7}])
        self.assertEqual(daemon.should_handle(msg), "do the thing")

    def test_group_mention_without_strip_keeps_mention(self):
        daemon.MENTION_STRIP = False
        msg = self._msg("!pi @mybot do the thing",
                        entities=[{"type": "mention", "offset": 4, "length": 7}])
        self.assertEqual(daemon.should_handle(msg), "@mybot do the thing")

    def test_group_reply_to_bot_is_handled(self):
        msg = self._msg("!pi hello",
                        reply_to={"message_id": 5, "from": {"id": 42, "is_bot": True}})
        self.assertEqual(daemon.should_handle(msg), "hello")

    def test_group_reply_to_other_user_is_ignored(self):
        msg = self._msg("!pi hello",
                        reply_to={"message_id": 5, "from": {"id": 999, "is_bot": False}})
        self.assertIsNone(daemon.should_handle(msg))

    def test_require_mention_off_handles_group_messages(self):
        daemon.REQUIRE_MENTION = False
        msg = self._msg("!pi do the thing")
        self.assertEqual(daemon.should_handle(msg), "do the thing")

    def test_private_chat_is_never_mention_gated(self):
        msg = self._msg("!pi do the thing", chat_type="private")
        self.assertEqual(daemon.should_handle(msg), "do the thing")

    def test_bot_sender_is_always_ignored(self):
        # The multi-bot reply-loop guard (#126): another bot's message is
        # never handled, even when it mentions this bot.
        msg = self._msg("!pi @mybot do the thing", sender_is_bot=True,
                        entities=[{"type": "mention", "offset": 4, "length": 7}])
        self.assertIsNone(daemon.should_handle(msg))

    def test_group_mention_only_message_maps_to_status(self):
        msg = self._msg("!pi @mybot",
                        entities=[{"type": "mention", "offset": 4, "length": 7}])
        self.assertEqual(daemon.should_handle(msg), "status")


# ---------------------------------------------------------------------------
# X3: image download edge cases (suffix sanitization, lying/absent sizes)
# ---------------------------------------------------------------------------


class TestDownloadTelegramImageEdges(unittest.TestCase):
    """Triple size-check and suffix fallback edge cases (#149)."""

    def _msg(self, **kwargs):
        msg = daemon.parse_message(_make_update({
            "photo": [{"file_id": "p1", "width": 10, "height": 10, "file_size": 100}],
        }))
        for key, value in kwargs.items():
            setattr(msg, key, value)
        return msg

    def test_absent_sizes_everywhere_still_downloads(self):
        # No file_size in the message, none in getFile: byte check still applies.
        msg = self._msg(image_file_size=0)
        with patch.object(daemon, "telegram_api", return_value={"file_path": "photos/x.jpg"}), \
             patch.object(daemon, "telegram_download", return_value=b"jpeg-bytes"):
            tmp = daemon.download_telegram_image(msg)
        try:
            self.assertEqual(tmp.suffix, ".jpg")
            self.assertEqual(tmp.read_bytes(), b"jpeg-bytes")
        finally:
            tmp.unlink(missing_ok=True)

    def test_absent_getfile_size_refuses_oversized_bytes(self):
        # getFile reports no size and the message size is absent; the
        # downloaded bytes still hit the hard limit.
        msg = self._msg(image_file_size=0)
        with patch.object(daemon, "MAX_IMAGE_BYTES", 4), \
             patch.object(daemon, "telegram_api", return_value={"file_path": "photos/x.jpg"}), \
             patch.object(daemon, "telegram_download", return_value=b"12345"):
            with self.assertRaises(RuntimeError) as ctx:
                daemon.download_telegram_image(msg)
            self.assertIn("too large", str(ctx.exception))

    def test_compound_suffix_uses_final_extension_only(self):
        # Path.suffix takes only the final extension; ".gz" passes the safe
        # suffix pattern, so it is kept as-is.
        msg = self._msg(image_mime_type="image/jpeg")
        with patch.object(daemon, "telegram_api", return_value={"file_path": "photos/f.tar.gz"}), \
             patch.object(daemon, "telegram_download", return_value=b"j"):
            tmp = daemon.download_telegram_image(msg)
        try:
            self.assertEqual(tmp.suffix, ".gz")
        finally:
            tmp.unlink(missing_ok=True)

    def test_suffix_with_unsafe_characters_rejected(self):
        msg = self._msg(image_mime_type="image/jpeg")
        with patch.object(daemon, "telegram_api",
                          return_value={"file_path": "photos/f.jpg%20x"}), \
             patch.object(daemon, "telegram_download", return_value=b"j"):
            tmp = daemon.download_telegram_image(msg)
        try:
            self.assertEqual(tmp.suffix, ".jpg")  # % fails the safe pattern → mime fallback
            self.assertNotIn("%", tmp.name)
        finally:
            tmp.unlink(missing_ok=True)

    def test_overlong_suffix_rejected(self):
        msg = self._msg(image_mime_type="image/jpeg")
        with patch.object(daemon, "telegram_api",
                          return_value={"file_path": "photos/f.abcdefghijkl"}), \
             patch.object(daemon, "telegram_download", return_value=b"j"):
            tmp = daemon.download_telegram_image(msg)
        try:
            self.assertEqual(tmp.suffix, ".jpg")
        finally:
            tmp.unlink(missing_ok=True)

    def test_uppercase_suffix_is_lowercased(self):
        msg = self._msg(image_mime_type="image/png")
        with patch.object(daemon, "telegram_api", return_value={"file_path": "photos/f.PNG"}), \
             patch.object(daemon, "telegram_download", return_value=b"p"):
            tmp = daemon.download_telegram_image(msg)
        try:
            self.assertEqual(tmp.suffix, ".png")
        finally:
            tmp.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# X3: image temp-file lifecycle through the main loop (#149)
# ---------------------------------------------------------------------------


class TestImageTempFileLifecycle(unittest.TestCase):
    """The temp image file is deleted only AFTER pi.ask() returns —
    on success and on exception. Premature delete means pi reads a
    missing file."""

    def setUp(self):
        self._saved = (daemon.BOT_TOKEN, daemon.ALLOWED_CHATS, daemon.PREFIX)
        daemon.BOT_TOKEN = "test-token"
        daemon.ALLOWED_CHATS = {"123"}
        daemon.PREFIX = "!pi"

    def tearDown(self):
        daemon.BOT_TOKEN, daemon.ALLOWED_CHATS, daemon.PREFIX = self._saved

    def _run_main_with_image(self, ask_behavior):
        image_update = _make_update({
            "photo": [{"file_id": "p1", "width": 10, "height": 10, "file_size": 50}],
        })
        tmp_dir = tempfile.mkdtemp(prefix="pi-tg-lifecycle-")
        self.addCleanup(shutil.rmtree, tmp_dir, ignore_errors=True)
        tmp_path = Path(tmp_dir) / "shot.jpg"
        tmp_path.write_bytes(b"image-bytes")
        seen = {}

        pi = MagicMock()

        def fake_ask(message, chat_id=None, reply_to=None, images=None):
            seen["exists_during_ask"] = tmp_path.exists()
            seen["images"] = images
            return ask_behavior(message)

        pi.ask.side_effect = fake_ask
        replies = []

        with patch.object(daemon, "load_state", return_value={"last_update_id": 0}), \
             patch.object(daemon, "save_state"), \
             patch.object(daemon, "fetch_bot_identity"), \
             patch.object(daemon, "send_chat_action"), \
             patch.object(daemon, "send_telegram",
                          side_effect=lambda chat_id, text, reply_to_message_id=None:
                              replies.append((chat_id, text))), \
             patch.object(daemon, "download_telegram_image", return_value=tmp_path), \
             patch.object(daemon, "PiRPC", return_value=pi), \
             patch.object(daemon, "fetch_updates", side_effect=[[image_update], SystemExit(0)]):
            with self.assertRaises(SystemExit):
                daemon.main()
        return tmp_path, seen, replies, pi

    def test_image_survives_ask_and_is_unlinked_after_success(self):
        tmp_path, seen, replies, pi = self._run_main_with_image(lambda m: "It is a screenshot.")
        pi.ask.assert_called_once()
        self.assertTrue(seen["exists_during_ask"])  # still on disk while pi.ask ran
        expected_b64 = base64.b64encode(b"image-bytes").decode("ascii")
        self.assertEqual(seen["images"][0]["data"], expected_b64)
        self.assertFalse(tmp_path.exists())  # deleted only after ask returned
        self.assertEqual(replies[-1], ("123", "It is a screenshot."))

    def test_image_is_unlinked_after_ask_exception(self):
        def boom(message):
            raise RuntimeError("pi exploded")

        tmp_path, seen, replies, pi = self._run_main_with_image(boom)
        self.assertTrue(seen["exists_during_ask"])
        self.assertFalse(tmp_path.exists())  # finally-block cleanup ran
        self.assertTrue(replies and "Pi bridge error" in replies[-1][1])


# ---------------------------------------------------------------------------
# X3b: scan_session bridge-header stripping
# ---------------------------------------------------------------------------


class TestScanSession(unittest.TestCase):
    """scan_session strips this daemon's own bridge headers from labels."""

    def _write_session(self, lines):
        fd, name = tempfile.mkstemp(prefix="pi-tg-scan-", suffix=".jsonl")
        os.close(fd)
        path = Path(name)
        self.addCleanup(path.unlink, missing_ok=True)
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return path

    @staticmethod
    def _user_line(text):
        return json.dumps({"type": "message",
                           "message": {"role": "user", "content": text}})

    def _header_case(self, header):
        path = self._write_session([
            json.dumps({"type": "session", "cwd": "/home/avirus/vault"}),
            self._user_line(f"{header} Dev by owner at unix timestamp 1700000000:\n\nthe real prompt"),
        ])
        cwd, label = daemon.scan_session(path)
        self.assertEqual(cwd, "/home/avirus/vault")
        self.assertEqual(label, "the real prompt")

    def test_image_header_is_stripped(self):
        self._header_case("Telegram image from chat")

    def test_command_header_is_stripped(self):
        self._header_case("Telegram command from chat")

    def test_voice_header_is_stripped(self):
        self._header_case("Telegram voice-note transcript from chat")

    def test_header_without_blank_line_is_kept(self):
        # No "\n\n" separator: nothing is stripped.
        path = self._write_session([
            self._user_line("Telegram command from chat Dev by owner:\nno separator"),
        ])
        _cwd, label = daemon.scan_session(path)
        self.assertTrue(label.startswith("Telegram command from chat"))

    def test_content_list_form_is_supported(self):
        path = self._write_session([
            self._user_line([{"type": "text",
                              "text": "Telegram image from chat Dev by owner at unix "
                                      "timestamp 1:\n\nlist-form prompt"}]),
        ])
        _cwd, label = daemon.scan_session(path)
        self.assertEqual(label, "list-form prompt")

    def test_session_info_name_used_without_user_message(self):
        path = self._write_session([
            json.dumps({"type": "session_info", "name": "Named session"}),
            json.dumps({"type": "message",
                        "message": {"role": "assistant", "content": "hi"}}),
        ])
        _cwd, label = daemon.scan_session(path)
        self.assertEqual(label, "Named session")

    def test_falls_back_to_path_stem(self):
        path = self._write_session(["this line is not json"])
        path = path.with_name("2025-06-01_12-00_session_abcd1234.jsonl")
        path.write_text("junk\n", encoding="utf-8")
        self.addCleanup(path.unlink, missing_ok=True)
        _cwd, label = daemon.scan_session(path)
        self.assertEqual(label, "abcd1234")

    def test_user_message_past_line_400_is_ignored(self):
        lines = [json.dumps({"type": "note"}) for _ in range(401)]
        lines.append(self._user_line("way too late"))
        path = self._write_session(lines)
        _cwd, label = daemon.scan_session(path)
        self.assertNotEqual(label, "way too late")


# ---------------------------------------------------------------------------
# X4: env-example <-> daemon env-key parity (#146/#148/#149 drift class)
# ---------------------------------------------------------------------------

_ENV_EXAMPLE_PATH = Path(__file__).parent.parent / ".config" / "pi-telegram.env.example"


class TestEnvKeyParity(unittest.TestCase):
    """Every env key the daemon reads must appear in pi-telegram.env.example."""

    # Generic shared vars, not daemon-specific; PATH is never read via .get().
    _EXEMPT = {"OPENAI_API_KEY", "PATH"}
    _PLACEHOLDER_MARKS = ("...", "replace-with", "/path", "sk-", "$HOME")

    _ENV_READ_RE = re.compile(
        r'os\.environ\.get\(\s*"([A-Z][A-Z0-9_]+)"\s*'
        r'(?:,\s*(?:"([^"]*)"|\'([^\']*)\'))?'
    )
    _EXAMPLE_LINE_RE = re.compile(r"^(#?)\s*([A-Z][A-Z0-9_]+)=(.*)$", re.M)

    def _daemon_env_reads(self):
        source = _DAEMON_PATH.read_text(encoding="utf-8")
        reads = {}
        for m in self._ENV_READ_RE.finditer(source):
            default = m.group(2) if m.group(2) is not None else m.group(3)
            reads[m.group(1)] = default  # None when the default is not a literal
        return reads

    def _example_entries(self):
        text = _ENV_EXAMPLE_PATH.read_text(encoding="utf-8")
        entries = {}
        for m in self._EXAMPLE_LINE_RE.finditer(text):
            entries.setdefault(m.group(2), []).append(
                (m.group(1) == "#", m.group(3).strip()))
        return entries

    def test_every_daemon_env_key_is_documented(self):
        reads = self._daemon_env_reads()
        documented = self._example_entries()
        missing = sorted(
            k for k in reads if k not in self._EXEMPT and k not in documented)
        self.assertEqual(
            missing, [],
            f"env keys read by the daemon but missing from "
            f"{_ENV_EXAMPLE_PATH.name}: {missing}")

    def test_commented_example_defaults_match_daemon_defaults(self):
        reads = self._daemon_env_reads()
        documented = self._example_entries()
        drift = []
        for key, occurrences in documented.items():
            raw_default = reads.get(key)
            if raw_default is None:
                continue  # daemon default is not a literal; presence check only
            for commented, value in occurrences:
                if not commented:
                    continue  # uncommented lines are per-machine fill-ins
                value = value.strip().strip('"').strip("'")
                if not value or any(mark in value for mark in self._PLACEHOLDER_MARKS):
                    continue  # placeholder sample, not a documented default
                if value != raw_default:
                    drift.append(f"{key}: example={value!r} daemon={raw_default!r}")
        self.assertEqual(drift, [], f"documented defaults drifted: {drift}")


# ---------------------------------------------------------------------------
# X5: supervisor loops with fake clocks (PR #152 blind spot)
# ---------------------------------------------------------------------------


class _FakeTime:
    """Injected clock: deterministic monotonic/time, recorded sleeps."""

    def __init__(self, start=0.0):
        self.now = start
        self.sleeps = []

    def monotonic(self):
        return self.now

    def time(self):
        return self.now

    def strftime(self, fmt):
        return "2025-01-01 00:00:00"

    def sleep(self, seconds):
        self.sleeps.append(seconds)


class TestChatActionLoop(unittest.TestCase):
    """The typing-indicator ticker keeps running when a tick fails."""

    def test_send_chat_action_swallows_api_errors(self):
        # The never-raises contract that keeps the ticker loop alive.
        with patch.object(daemon, "telegram_api", side_effect=RuntimeError("429 Too Many Requests")):
            daemon.send_chat_action("123")  # must not raise

    def test_loop_ticks_repeatedly_and_stops_cleanly(self):
        calls = []
        with patch.object(daemon, "send_chat_action",
                          side_effect=lambda chat_id, action="typing": calls.append(chat_id)):
            loop = daemon.ChatActionLoop("9", interval=0.02)
            with loop:
                deadline = time.monotonic() + 2.0
                while len(calls) < 3 and time.monotonic() < deadline:
                    time.sleep(0.005)
        self.assertGreaterEqual(len(calls), 3)
        self.assertIsNotNone(loop.thread)
        self.assertFalse(loop.thread.is_alive())  # __exit__ joined it

    def test_loop_keeps_ticking_when_every_api_call_fails(self):
        attempts = []

        def failing_api(method, payload, timeout=60):
            attempts.append(method)
            raise RuntimeError("429 Too Many Requests")

        with patch.object(daemon, "telegram_api", side_effect=failing_api), \
             patch.object(daemon, "log"):
            loop = daemon.ChatActionLoop("9", interval=0.02)
            with loop:
                deadline = time.monotonic() + 2.0
                while len(attempts) < 3 and time.monotonic() < deadline:
                    time.sleep(0.005)
        self.assertGreaterEqual(len(attempts), 3)  # ticker survived every failed tick

    def test_zero_interval_disables_indicator_and_thread(self):
        # Set to 0: no typing indicator at all and no ticker thread.
        calls = []
        with patch.object(daemon, "send_chat_action",
                          side_effect=lambda chat_id, action="typing": calls.append(chat_id)):
            loop = daemon.ChatActionLoop("9", interval=0)
            with loop:
                pass
        self.assertEqual(calls, [])
        self.assertIsNone(loop.thread)


class TestStatusMessengerFakeClock(unittest.TestCase):
    """Deferred flush and error survival, driven by an injected clock."""

    def test_deferred_flush_fires_when_throttle_cools(self):
        fake = _FakeTime(100.0)
        with patch.object(daemon, "time", fake), \
             patch.object(daemon, "STATUS_EDIT_INTERVAL", 10.0), \
             patch.object(daemon, "STATUS_FINAL_PAUSE", 0.0), \
             patch.object(daemon, "telegram_api") as api:
            api.return_value = {"message_id": 7}
            sm = daemon.StatusMessenger("1")
            sm.on_event({"type": "turn_start"})  # t=100: create
            self.assertEqual([c[0][0] for c in api.call_args_list], ["sendMessage"])

            fake.now = 103.0  # throttle hot: 103-100 < 10
            sm.on_event({"type": "message_update", "assistantMessageEvent": {
                "type": "text_delta", "contentIndex": 0, "delta": "Read"}})
            sm.on_event({"type": "message_update", "assistantMessageEvent": {
                "type": "text_delta", "contentIndex": 0, "delta": "ing config"}})
            self.assertEqual(api.call_count, 1)  # edit deferred, change held
            self.assertTrue(sm.dirty)

            fake.now = 111.0  # throttle cold: 111-100 >= 10
            sm.on_event({"type": "tool_execution_start",
                         "toolCallId": "c1", "toolName": "read", "args": {}})
            self.assertEqual(api.call_count, 2)  # deferred change flushed now
            method, payload = api.call_args[0][0], api.call_args[0][1]
            self.assertEqual(method, "editMessageText")
            self.assertIn("Reading config", payload["text"])

    def test_edit_failure_in_one_tick_does_not_kill_messenger(self):
        fake = _FakeTime(100.0)
        failing = {"next_edit_fails": True}

        def api_side_effect(method, payload, timeout=60):
            if method == "sendMessage":
                return {"message_id": 7}
            if method == "editMessageText" and failing["next_edit_fails"]:
                failing["next_edit_fails"] = False
                raise RuntimeError("429 Too Many Requests")
            return {}

        with patch.object(daemon, "time", fake), \
             patch.object(daemon, "STATUS_EDIT_INTERVAL", 0.0), \
             patch.object(daemon, "STATUS_FINAL_PAUSE", 0.0), \
             patch.object(daemon, "telegram_api", side_effect=api_side_effect) as api:
            sm = daemon.StatusMessenger("1")
            sm.on_event({"type": "turn_start"})  # create
            sm.on_event({"type": "turn_start"})  # edit raises — swallowed
            sm.on_event({"type": "turn_start"})  # next edit succeeds
            sm.finalize()  # final edit + delete still work
        methods = [c[0][0] for c in api.call_args_list]
        self.assertEqual(methods.count("editMessageText"), 2)
        self.assertIn("deleteMessage", methods)


class TestMainLoopResilience(unittest.TestCase):
    """The main supervisor loop restarts after an exception in one tick,
    with recorded (never real) backoff sleeps."""

    def test_outer_loop_survives_fetch_failure_with_backoff(self):
        fake = _FakeTime(0.0)
        status_update = _make_update({"text": "!pi status"})
        pi = MagicMock()
        pi.status.return_value = "All good."
        replies = []

        with patch.object(daemon, "time", fake), \
             patch.object(daemon, "RETRY_SECONDS", 3.5), \
             patch.object(daemon, "BOT_TOKEN", "test-token"), \
             patch.object(daemon, "ALLOWED_CHATS", {"123"}), \
             patch.object(daemon, "PREFIX", "!pi"), \
             patch.object(daemon, "load_state", return_value={"last_update_id": 0}), \
             patch.object(daemon, "save_state"), \
             patch.object(daemon, "fetch_bot_identity"), \
             patch.object(daemon, "send_chat_action"), \
             patch.object(daemon, "send_telegram",
                          side_effect=lambda chat_id, text, reply_to_message_id=None:
                              replies.append((chat_id, text))), \
             patch.object(daemon, "PiRPC", return_value=pi), \
             patch.object(daemon, "fetch_updates",
                          side_effect=[RuntimeError("long poll failed"),
                                       [status_update],
                                       SystemExit(0)]):
            with self.assertRaises(SystemExit):
                daemon.main()

        # The injected failure did not stop the loop: the next tick ran.
        pi.status.assert_called_once()
        self.assertEqual(replies[-1], ("123", "All good."))
        # Backoff happened once, through the fake clock — never a real sleep.
        self.assertEqual(fake.sleeps, [3.5])


# ---------------------------------------------------------------------------
# Extra daemon-behavior coverage (pure logic, offline)
# ---------------------------------------------------------------------------


class TestReplyFormatting(unittest.TestCase):
    """chunk_reply splitting and telegram_html rendering."""

    def test_short_reply_is_one_chunk(self):
        with patch.object(daemon, "MAX_REPLY_CHARS", 100):
            self.assertEqual(daemon.chunk_reply("hello"), ["hello"])

    def test_split_on_line_boundary(self):
        text = "aaaa\nbbbb\n"
        with patch.object(daemon, "MAX_REPLY_CHARS", 5):
            chunks = daemon.chunk_reply(text)
        self.assertEqual(chunks, ["aaaa", "bbbb"])

    def test_overlong_single_line_is_hard_split(self):
        with patch.object(daemon, "MAX_REPLY_CHARS", 4):
            chunks = daemon.chunk_reply("abcdefghij")
        self.assertEqual(chunks, ["abcd", "efgh", "ij"])

    def test_empty_reply_is_single_empty_chunk(self):
        with patch.object(daemon, "MAX_REPLY_CHARS", 10):
            self.assertEqual(daemon.chunk_reply(""), [""])

    def test_html_escapes_raw_markup(self):
        out = daemon.telegram_html("a <b> & c")
        self.assertIn("a &lt;b&gt; &amp; c", out)
        self.assertNotIn("<b>", out)

    def test_html_renders_bold_code_and_bullet(self):
        out = daemon.telegram_html("**bold** and `code`\n- item")
        self.assertIn("<b>bold</b>", out)
        self.assertIn("<code>code</code>", out)
        self.assertIn("• item", out)

    def test_html_renders_code_fence_as_pre(self):
        out = daemon.telegram_html("before\n```py\nprint(1 < 2)\n```\nafter")
        self.assertIn("<pre>print(1 &lt; 2)</pre>", out)
        self.assertIn("before", out)
        self.assertIn("after", out)

    def test_html_empty_becomes_space(self):
        self.assertEqual(daemon.telegram_html(""), " ")


class TestHandleSwitch(unittest.TestCase):
    """Session switching resolution over a mocked session list."""

    def setUp(self):
        self._sessions = [
            (Path("/s/alpha.jsonl"), "/home/avirus/vault", "alpha label", 1000.0),
            (Path("/s/beta-one.jsonl"), "/home/avirus/vault", "beta one", 1000.0),
            (Path("/s/beta-two.jsonl"), "/home/avirus/vault", "beta two", 1000.0),
        ]
        self._patcher = patch.object(daemon, "list_pi_sessions", return_value=self._sessions)
        self._patcher.start()
        self.addCleanup(self._patcher.stop)

    def test_switch_by_number(self):
        pi = MagicMock()
        pi.switch_session.return_value = None
        reply = daemon.handle_switch(pi, "1")
        pi.switch_session.assert_called_once_with("/s/alpha.jsonl")
        self.assertTrue(reply.startswith("Switched to:"))

    def test_switch_error_is_reported(self):
        pi = MagicMock()
        pi.switch_session.return_value = "Failed to switch session: busy"
        self.assertEqual(daemon.handle_switch(pi, "1"), "Failed to switch session: busy")

    def test_number_out_of_range(self):
        pi = MagicMock()
        self.assertIn("No chat '9'", daemon.handle_switch(pi, "9"))

    def test_ambiguous_name_match(self):
        pi = MagicMock()
        reply = daemon.handle_switch(pi, "beta")
        self.assertIn("matches 2 chats", reply)
        pi.switch_session.assert_not_called()

    def test_unique_name_match(self):
        pi = MagicMock()
        pi.switch_session.return_value = None
        reply = daemon.handle_switch(pi, "alpha")
        pi.switch_session.assert_called_once_with("/s/alpha.jsonl")
        self.assertTrue(reply.startswith("Switched to:"))

    def test_no_sessions(self):
        self._patcher.stop()
        with patch.object(daemon, "list_pi_sessions", return_value=[]):
            pi = MagicMock()
            self.assertIn("No pi sessions", daemon.handle_switch(pi, "1"))


class TestVoiceTranscriptionGuards(unittest.TestCase):
    """Provider resolution and command transcription, all offline."""

    def setUp(self):
        self._saved = (
            daemon.VOICE_TRANSCRIPTION_PROVIDER, daemon.VOICE_TRANSCRIPTION_CMD,
            daemon.VOICE_OPENAI_API_KEY,
        )

    def tearDown(self):
        (daemon.VOICE_TRANSCRIPTION_PROVIDER, daemon.VOICE_TRANSCRIPTION_CMD,
         daemon.VOICE_OPENAI_API_KEY) = self._saved

    def test_provider_resolution_matrix(self):
        cases = [
            # (provider, cmd, key, expected)
            ("none", "stt", "k", ""),
            ("", "stt", "k", ""),
            ("command", "stt", "", "command"),
            ("command", "", "", ""),
            ("openai", "", "k", "openai"),
            ("openai", "", "", ""),
            ("auto", "stt", "", "command"),
            ("auto", "", "k", "openai"),
            ("auto", "", "", ""),
            ("whisperx", "", "", "whisperx"),
        ]
        for provider, cmd, key, expected in cases:
            with self.subTest(provider=provider, cmd=cmd, key=key):
                daemon.VOICE_TRANSCRIPTION_PROVIDER = provider
                daemon.VOICE_TRANSCRIPTION_CMD = cmd
                daemon.VOICE_OPENAI_API_KEY = key
                self.assertEqual(daemon.configured_voice_provider(), expected)

    def test_transcribe_without_provider_raises(self):
        daemon.VOICE_TRANSCRIPTION_PROVIDER = "none"
        daemon.VOICE_TRANSCRIPTION_CMD = ""
        daemon.VOICE_OPENAI_API_KEY = ""
        msg = daemon.parse_message(_make_update({
            "voice": {"file_id": "v1", "file_size": 10, "mime_type": "audio/ogg"},
        }))
        with self.assertRaises(RuntimeError) as ctx:
            daemon.transcribe_telegram_audio(msg)
        self.assertIn("transcription configured", str(ctx.exception))

    def test_transcribe_with_command_substitutes_placeholder(self):
        daemon.VOICE_TRANSCRIPTION_CMD = "stt {file} --mime {mime}"
        audio = Path("/tmp/pi-telegram-voice-x.oga")
        sent = {}

        class _Result:
            returncode = 0
            stdout = "  hello transcript  \n"
            stderr = ""

        def fake_run(command, **kwargs):
            sent["command"] = command
            return _Result()

        with patch.object(daemon.subprocess, "run", side_effect=fake_run):
            out = daemon.transcribe_with_command(audio, "audio/ogg")
        self.assertEqual(out, "hello transcript")
        self.assertTrue(sent["command"].startswith("stt '"))
        self.assertIn("--mime 'audio/ogg'", sent["command"])
        self.assertIn(str(audio), sent["command"])

    def test_transcribe_with_command_failure_raises(self):
        daemon.VOICE_TRANSCRIPTION_CMD = "stt {file}"

        class _Result:
            returncode = 2
            stdout = ""
            stderr = "boom"

        with patch.object(daemon.subprocess, "run", return_value=_Result()):
            with self.assertRaises(RuntimeError) as ctx:
                daemon.transcribe_with_command(Path("/tmp/a.oga"), "audio/ogg")
        self.assertIn("failed (2)", str(ctx.exception))


class TestTelegramApiGuards(unittest.TestCase):
    """The no-token guard fails fast before any network call."""

    def test_api_without_token_raises(self):
        with patch.object(daemon, "BOT_TOKEN", ""):
            with self.assertRaises(RuntimeError) as ctx:
                daemon.telegram_api("getMe", {})
            self.assertIn("PI_TELEGRAM_BOT_TOKEN", str(ctx.exception))

    def test_download_without_token_raises(self):
        with patch.object(daemon, "BOT_TOKEN", ""):
            with self.assertRaises(RuntimeError) as ctx:
                daemon.telegram_download("photos/x.jpg")
            self.assertIn("PI_TELEGRAM_BOT_TOKEN", str(ctx.exception))


if __name__ == "__main__":
    unittest.main(verbosity=2)
