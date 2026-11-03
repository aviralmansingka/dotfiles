#!/usr/bin/env python3
"""Tests for pi-telegram-daemon.

Run with: python3 -m unittest test_pi_telegram_daemon -v
All tests are offline and deterministic: the Telegram API is always mocked,
timers use injected/fake clocks, and no sleep exceeds 100 ms.
"""

from __future__ import annotations

import asyncio
import base64
import importlib.util
import io
import json
import os
import re
import shutil
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from types import SimpleNamespace
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


class TestCallTitles(unittest.TestCase):
    """Title resolution: model-written comment, stored title, or generated title."""

    def _call(self, name, arguments=None, result=None):
        return daemon.ToolCall(id="c1", name=name, arguments=arguments or {}, result=result)

    # -- model-written leading intent comments ----------------------------

    def test_bash_title_lifts_leading_intent_comment(self):
        call = self._call("bash", {"command": "# Check which weekday the log names start on\ndate +%A"})
        self.assertEqual(
            daemon._call_title(call),
            daemon._truncate_title("Check which weekday the log names start on"),
        )

    def test_powershell_title_lifts_hash_comment(self):
        call = self._call("powershell", {"command": "# Stop the stale service\nStop-Service pi-telegram"})
        self.assertEqual(daemon._call_title(call), "Stop the stale service")

    def test_python_title_lifts_hash_comment(self):
        call = self._call("python", {"code": "# Parse the session log for bash calls\nrows = []"})
        self.assertEqual(daemon._call_title(call), "Parse the session log for bash calls")

    def test_mcp_script_title_skips_options_directive(self):
        call = self._call(
            "mcpScript",
            {"code": "// @options: {}\n// Fan out searches and filter failures\nconst x = 1"},
        )
        self.assertEqual(daemon._call_title(call), "Fan out searches and filter failures")

    def test_multiline_comment_block_uses_first_line(self):
        call = self._call(
            "bash", {"command": "# Check the build directory\n# then report the newest file\nls -t /tmp"}
        )
        self.assertEqual(daemon._call_title(call), "Check the build directory")

    def test_comment_after_code_is_not_a_title(self):
        call = self._call("bash", {"command": "ls -la\n# List hidden files"})
        self.assertIsNone(daemon._call_title(call))

    def test_shebang_never_titles_a_call(self):
        call = self._call(
            "bash", {"command": "#!/bin/bash\n# Run the offline suite\nuv run python -m unittest"}
        )
        self.assertEqual(daemon._call_title(call), "Run the offline suite")

    # -- untitled calls never show a tool name, command, or argument --------

    def test_untitled_calls_have_no_fallback(self):
        for name, args in (
            ("bash", {"command": "date +%A; ls /tmp"}),
            ("read", {"path": "/a/b/secret.py"}),
            ("mcp__browserbase__search", {"query": "private"}),
            ("some_new_tool", {}),
        ):
            with self.subTest(name=name):
                self.assertIsNone(daemon._call_title(self._call(name, args)))

    # -- stored intentTitle ----------------------------------------------

    def test_stored_intent_title_wins_over_comment(self):
        call = self._call(
            "bash",
            {"command": "# Fallback comment\nls"},
            result={"details": {"intentTitle": "Check the weekday"}},
        )
        self.assertEqual(daemon._call_title(call), "Check the weekday")

    def test_stored_intent_title_is_sanitized_to_one_line(self):
        call = self._call(
            "read", {}, result={"details": {"intentTitle": "\n**Recheck** the build <b>now</b>\nsecond"}}
        )
        self.assertEqual(daemon._call_title(call), "Recheck the build now")

    def test_long_comment_title_is_truncated(self):
        title = daemon._call_title(self._call("bash", {"command": "# " + "x" * 200 + "\ntrue"}))
        self.assertLessEqual(len(title), daemon.TITLE_MAX + 1)
        self.assertTrue(title.endswith("…"))


class TestTraceBuilder(unittest.TestCase):
    """Title-only trace: one line per titled call, in call order."""

    def _tree(self, *calls):
        tree = daemon.TraceBuilder()
        for call_id, name, args in calls:
            tree.on_tool_execution_start(call_id, name, args)
        return tree

    def test_empty_tree_renders_nothing(self):
        self.assertEqual(daemon.TraceBuilder().render(), "")

    def test_one_title_per_call_in_call_order(self):
        tree = self._tree(
            ("c1", "bash", {"command": "# Read the daemon log\njournalctl --user -u pi-telegram"}),
            ("c2", "read", {"path": "/a/state.json"}),
            ("c3", "bash", {"command": "# Stop the running daemon\nsystemctl --user stop pi-telegram"}),
        )
        tree.on_title("c2", "Inspect the project state")
        self.assertEqual(
            tree.render().split("\n"),
            ["◇ Read the daemon log", "◇ Inspect the project state", "◇ Stop the running daemon"],
        )

    def test_repeated_calls_render_repeated_titles(self):
        tree = self._tree(
            ("c1", "bash", {"command": "# Check the build directory\nls"}),
            ("c2", "bash", {"command": "# Check the build directory\nls"}),
        )
        self.assertEqual(
            tree.render().split("\n"),
            ["◇ Check the build directory", "◇ Check the build directory"],
        )

    def test_render_has_no_heading_glyph_timer_or_body(self):
        tree = self._tree(("c1", "bash", {"command": "# List the builds\nls -t /tmp/builds"}))
        tree.on_tool_execution_end(
            "c1", {"content": [{"type": "text", "text": "traceback: boom"}], "details": {}}
        )
        text = tree.render()
        self.assertEqual(text, "◆ List the builds")
        for forbidden in (
            "thinking", "▹", "▸", "├─", "└─", "$", "0:", "1:", "<pre>",
            "traceback", "completed", "running",
        ):
            self.assertNotIn(forbidden, text)

    def test_failed_call_keeps_title_without_error_body(self):
        tree = self._tree(("c1", "bash", {"command": "# Run the offline suite\nuv run pytest"}))
        tree.on_tool_execution_end(
            "c1", {"content": [{"type": "text", "text": "3 failed"}], "details": {"exitCode": 1}}, True
        )
        self.assertEqual(tree.render(), "× Run the offline suite")

    def test_tool_execution_events_are_authoritative(self):
        """No assistant message events are needed: start carries id, name, args."""
        tree = daemon.TraceBuilder()
        tree.on_tool_execution_start("c1", "bash", {"command": "# Read the log\ntail -n 5 x"})
        self.assertEqual(tree.render(), "◇ Read the log")

    def test_untitled_failed_call_stays_hidden_until_a_title_arrives(self):
        tree = daemon.TraceBuilder()
        tree.on_tool_execution_start("m1", "mcp__calendar", {"query": "secret"})
        tree.on_tool_execution_end("m1", {"content": [{"type": "text", "text": "secret error"}]}, True)
        self.assertEqual(tree.render(), "")
        tree.on_title("m1", "Find calendar events")
        self.assertEqual(tree.render(), "× Find calendar events")

    def test_result_summaries_connect_to_finished_titles(self):
        tree = self._tree(
            ("a", "bash", {"command": "# Search calendar events\ntrue"}),
            ("b", "bash", {"command": "# Check the service\ntrue"}),
        )
        tree.on_summary("a", "3 events & reminders\nprivate second line")
        self.assertEqual(tree.render(), "◇ Search calendar events\n◇ Check the service")
        tree.on_tool_execution_end("a", {"content": [{"type": "text", "text": "raw private output"}]})
        tree.on_tool_execution_end("b", {"content": [{"type": "text", "text": "raw error body"}]}, True)
        tree.on_summary("b", "**Service** is unavailable")
        self.assertEqual(tree.render(),
                         "◆ Search calendar events\n└─ 3 events &amp; reminders\n"
                         "× Check the service\n└─ Service is unavailable")
        self.assertNotIn("raw", tree.render())
        self.assertNotIn("private", tree.render())

    def test_result_line_limit_includes_prefix_and_utf16_units(self):
        tree = self._tree(("a", "bash", {"command": "# Search mail\ntrue"}))
        tree.on_tool_execution_end("a", {})
        self.assertTrue(tree.on_summary("a", "3 emails matching XYZ"))
        self.assertEqual(tree.render(), "◆ Search mail\n└─ 3 emails matching XYZ")
        self.assertTrue(tree.on_summary("a", "x" * 23 + "🚀"))
        self.assertEqual(daemon._utf16_len(tree.render().split("\n")[1]), daemon.SUMMARY_LINE_MAX)
        self.assertFalse(tree.on_summary("a", "x" * 24 + "🚀"))
        self.assertFalse(tree.on_summary("a", "a summary that is much too long"))
        self.assertNotIn("…", tree.render())

    def test_result_summary_is_dropped_as_a_whole_line_at_the_limit(self):
        tree = self._tree(("a", "bash", {"command": "# Check events\ntrue"}))
        tree.on_tool_execution_end("a", {})
        tree.on_summary("a", "Found events & reminders")
        full = "◆ Check events\n└─ Found events &amp; reminders"
        with patch.object(daemon, "MAX_REPLY_CHARS", daemon._utf16_len(full) - 1):
            self.assertEqual(tree.render(), "◆ Check events")
        with patch.object(daemon, "MAX_REPLY_CHARS", daemon._utf16_len(full)):
            self.assertEqual(tree.render(), full)

    def test_reused_id_keeps_each_call(self):
        tree = self._tree(("c1", "bash", {"command": "# Read the first log\ntail x"}))
        tree.on_tool_execution_end("c1", {"details": {"intentTitle": "Read the first log"}})
        tree.on_tool_execution_start("c1", "bash", {"command": "# Read the second log\ntail y"})
        tree.on_tool_execution_end("c1", {"details": {"intentTitle": "Read the second log"}})
        self.assertEqual(tree.render(), "◆ Read the first log\n◆ Read the second log")

    def test_messenger_keeps_titles_across_agent_start_retries(self):
        """A retry or auto-continue re-emits agent_start; the trace keeps its calls."""
        with patch.object(daemon, "telegram_api") as mock_api:
            mock_api.return_value = {"message_id": 7}
            sm = daemon.StatusMessenger("123")
            sm.on_event({"type": "agent_start"})
            sm.on_event({"type": "tool_execution_start", "toolCallId": "c1",
                         "toolName": "bash", "args": {"command": "# Read the daemon log\ntail x"}})
            sm.on_event({"type": "agent_end"})
            sm.on_event({"type": "agent_start"})  # automatic retry
            sm.on_event({"type": "tool_execution_start", "toolCallId": "c2",
                         "toolName": "bash", "args": {"command": "# Read the daemon log\ntail x"}})
            sm.flush()
            self.assertEqual(
                mock_api.call_args[0][1]["text"], "◇ Read the daemon log\n◇ Read the daemon log"
            )

    def test_titles_are_html_escaped(self):
        tree = self._tree(("c1", "bash", {"command": "# Compare a<b and c & d\n[ a -lt b ]"}))
        text = tree.render()
        self.assertEqual(text, "◇ Compare a&lt;b and c &amp; d")
        self.assertNotIn("<", text)

    def test_multiline_comment_title_is_one_line(self):
        tree = self._tree(("c1", "bash", {"command": "# Rebuild the cache\n# then restart\nmake cache"}))
        self.assertEqual(tree.render(), "◇ Rebuild the cache")

    def test_total_message_stays_within_telegram_limits(self):
        """Overflow drops whole title lines: no cut entity, no ellipsis, no count row."""
        tree = daemon.TraceBuilder()
        for i in range(400):
            tree.on_tool_execution_start(
                f"c{i}", "bash", {"command": f"# Inspect the {i}th session log&entry\ntail x"}
            )
        text = tree.render()
        self.assertLessEqual(daemon._utf16_len(text), daemon.MAX_REPLY_CHARS)
        self.assertNotIn("…", text)
        self.assertNotIn("hidden", text)
        self.assertNotIn("more", text)
        self.assertNotIn("&entry</b>", text)
        for line in text.split("\n"):
            self.assertTrue(line.endswith("entry"))  # whole titles only
            self.assertFalse(line.startswith("&amp;"), line)  # never a chopped entity

    def test_limits_count_utf16_code_units(self):
        """An emoji title costs two units, so the byte cap is not the char cap."""
        tree = self._tree(("c1", "bash", {"command": "# 🚀 Spanning the emoji pipeline\ntrue"}))
        line = tree.render()
        self.assertEqual(daemon._utf16_len(line), len(line) + 1)
        with patch.object(daemon, "MAX_REPLY_CHARS", daemon._utf16_len(line) - 1):
            self.assertEqual(tree.render(), "")
        with patch.object(daemon, "MAX_REPLY_CHARS", daemon._utf16_len(line)):
            self.assertEqual(tree.render(), line)


class TestStatusMessenger(unittest.TestCase):
    """Live title trace message lifecycle — telegram_api is mocked."""

    def setUp(self):
        daemon.STATUS_EDIT_INTERVAL = 1.0
        daemon.STATUS_FINAL_PAUSE = 0.0  # no pause in tests

    @staticmethod
    def _call_event(call_id="c1", name="bash", args=None):
        return {
            "type": "tool_execution_start",
            "toolCallId": call_id,
            "toolName": name,
            "args": args if args is not None else {"command": "# Read the daemon log\njournalctl"},
        }

    def test_no_trace_message_before_first_tool_call(self):
        with patch.object(daemon, "telegram_api") as mock_api:
            sm = daemon.StatusMessenger("123")
            sm.on_event({"type": "agent_start"})
            sm.on_event({"type": "turn_start"})
            mock_api.assert_not_called()
            sm.finalize()
            mock_api.assert_not_called()

    def test_text_only_turn_leaves_no_trace(self):
        """A turn whose only events are non-tool events never creates a message."""
        with patch.object(daemon, "telegram_api") as mock_api:
            sm = daemon.StatusMessenger("123")
            sm.on_event({"type": "agent_start"})
            sm.on_event({"type": "tool_execution_end", "toolCallId": "ghost", "result": {}})
            sm.finalize()
            mock_api.assert_not_called()

    def test_first_tool_call_creates_title_only_message(self):
        with patch.object(daemon, "telegram_api") as mock_api:
            mock_api.return_value = {"message_id": 42}
            sm = daemon.StatusMessenger("123")
            sm.on_event({"type": "agent_start"})
            sm.on_event(self._call_event())
            self.assertEqual(mock_api.call_count, 1)
            method, payload = mock_api.call_args[0]
            self.assertEqual(method, "sendMessage")
            self.assertEqual(payload["chat_id"], "123")
            self.assertEqual(payload["parse_mode"], "HTML")
            self.assertEqual(payload["link_preview_options"], {"is_disabled": True})
            self.assertEqual(payload["text"], "◇ Read the daemon log")
            # The trace never quotes the prompt and never carries buttons.
            self.assertNotIn("reply_parameters", payload)
            self.assertNotIn("reply_markup", payload)
            self.assertEqual(sm.message_id, 42)

    def test_second_call_edits_the_same_message(self):
        with patch.object(daemon, "STATUS_EDIT_INTERVAL", 3600.0), \
             patch.object(daemon, "telegram_api") as mock_api:
            mock_api.return_value = {"message_id": 7}
            sm = daemon.StatusMessenger("123")
            sm.on_event(self._call_event())
            sm.on_event(self._call_event("c2", "read", {"path": "x"}))
            sm.on_event({"type": "extension_ui_request", "method": "setStatus",
                         "statusKey": "pi-telegram:title:c2", "statusText": "Inspect project state"})
            self.assertEqual(mock_api.call_count, 1)  # edit held by the throttle
            sm.flush()
            method, payload = mock_api.call_args[0]
            self.assertEqual(method, "editMessageText")
            self.assertEqual(payload["message_id"], 7)
            self.assertEqual(payload["link_preview_options"], {"is_disabled": True})
            self.assertEqual(payload["text"], "◇ Read the daemon log\n◇ Inspect project state")
            self.assertNotIn("reply_markup", payload)

    def test_unchanged_titles_do_not_edit(self):
        with patch.object(daemon, "telegram_api") as mock_api:
            mock_api.return_value = {"message_id": 7}
            sm = daemon.StatusMessenger("123")
            sm.on_event(self._call_event())
            sm.on_event({"type": "tool_execution_end", "toolCallId": "c1", "isError": False,
                         "result": {"content": [{"type": "text", "text": "ok"}]}})
            sm.flush()
            # The glyph settled ◇ → ◆, so one edit lands; nothing after it.
            self.assertEqual([c[0][0] for c in mock_api.call_args_list], ["sendMessage", "editMessageText"])
            sm.flush()
            self.assertEqual(len(mock_api.call_args_list), 2)  # unchanged: no further edit

    def test_finalize_deletes_the_temporary_message(self):
        with patch.object(daemon, "telegram_api") as mock_api:
            mock_api.return_value = {"message_id": 7}
            sm = daemon.StatusMessenger("123")
            sm.on_event(self._call_event())
            sm.finalize()
            self.assertEqual([c[0][0] for c in mock_api.call_args_list], ["sendMessage", "deleteMessage"])
            self.assertEqual(mock_api.call_args_list[-1][0][1], {"chat_id": "123", "message_id": 7})
            self.assertIsNone(sm.message_id)

    def test_finalize_shows_success_or_failure_before_deletion(self):
        for is_error, glyph in ((False, "◆"), (True, "×")):
            with self.subTest(is_error=is_error), patch.object(daemon, "telegram_api") as api:
                api.return_value = {"message_id": 7}
                sm = daemon.StatusMessenger("123")
                sm.on_event(self._call_event())
                sm.on_event({"type": "tool_execution_end", "toolCallId": "c1", "result": {}, "isError": is_error})
                sm.finalize()
                self.assertEqual([c[0][0] for c in api.call_args_list],
                                 ["sendMessage", "editMessageText", "deleteMessage"])
                self.assertEqual(api.call_args_list[-2][0][1]["text"], f"{glyph} Read the daemon log")

    def test_finalize_does_not_create_a_missing_message(self):
        methods = []

        def api_side_effect(method, payload, timeout=60):
            methods.append(method)
            if method == "sendMessage" and methods.count("sendMessage") == 1:
                raise RuntimeError("429 Too Many Requests")
            return {"message_id": 7}

        with patch.object(daemon, "telegram_api", side_effect=api_side_effect), \
             patch.object(daemon, "log"):
            sm = daemon.StatusMessenger("123")
            sm.on_event(self._call_event())
            self.assertEqual(methods, ["sendMessage"])
            sm.finalize()
        self.assertEqual(methods, ["sendMessage"])
        self.assertIsNone(sm.message_id)

    def test_failed_call_shows_title_without_error_body(self):
        with patch.object(daemon, "telegram_api") as mock_api:
            mock_api.return_value = {"message_id": 7}
            sm = daemon.StatusMessenger("123")
            sm.on_event(self._call_event())
            sm.on_event({
                "type": "tool_execution_end", "toolCallId": "c1", "isError": True,
                "result": {"content": [{"type": "text", "text": "exit 1: boom"}], "details": {}},
            })
            sm.flush()
            sm.finalize()
            for call in mock_api.call_args_list:
                self.assertNotIn("exit 1", call[0][1].get("text", ""))
                self.assertNotIn("reply_markup", call[0][1])
            self.assertEqual(
                [c[0][1]["text"] for c in mock_api.call_args_list if "text" in c[0][1]][-1],
                "× Read the daemon log",
            )
            self.assertEqual(mock_api.call_args_list[-1][0][0], "deleteMessage")

    def test_generated_mcp_title_updates_only_its_call(self):
        with patch.object(daemon, "telegram_api") as api:
            api.return_value = {"message_id": 7}
            sm = daemon.StatusMessenger("123")
            sm.on_event(self._call_event("a", "mcp__slack", {"args": {"query": "private"}}))
            sm.on_event(self._call_event("b", "read", {"path": "private.txt"}))
            sm.on_event({"type": "extension_ui_request", "method": "setStatus",
                         "statusKey": "unrelated:a", "statusText": "Ignore this"})
            api.assert_not_called()  # no tool name or generic label before a title
            sm.on_event({"type": "extension_ui_request", "method": "setStatus",
                         "statusKey": "pi-telegram:title:a", "statusText": "Search chats & channels"})
            sm.on_event({"type": "extension_ui_request", "method": "setStatus",
                         "statusKey": "pi-telegram:title:b", "statusText": "Inspect project state"})
            sm.flush()
            self.assertEqual(api.call_args[0][1]["text"], "◇ Search chats &amp; channels\n◇ Inspect project state")
            self.assertNotIn("private", api.call_args[0][1]["text"])

    def test_title_can_arrive_before_start_or_after_end(self):
        with patch.object(daemon, "telegram_api") as api:
            api.return_value = {"message_id": 7}
            sm = daemon.StatusMessenger("123")
            sm.on_event({"type": "extension_ui_request", "method": "setStatus",
                         "statusKey": "pi-telegram:title:a", "statusText": "Find calendar events"})
            api.assert_not_called()
            sm.on_event(self._call_event("a", "mcp__calendar", {}))
            self.assertEqual(api.call_args[0][1]["text"], "◇ Find calendar events")
            sm.on_event({"type": "tool_execution_end", "toolCallId": "a", "result": {}, "isError": False})
            sm.on_event({"type": "extension_ui_request", "method": "setStatus",
                         "statusKey": "pi-telegram:title:a", "statusText": "Check calendar events"})
            sm.flush()
            self.assertEqual(api.call_args[0][1]["text"], "◆ Check calendar events")

    def test_summary_waits_for_a_title_and_is_rendered_only_after_completion(self):
        with patch.object(daemon, "telegram_api") as api:
            api.return_value = {"message_id": 7}
            sm = daemon.StatusMessenger("123")
            sm.on_event(self._call_event("a", "mcp__calendar", {"query": "private"}))
            sm.on_event({"type": "extension_ui_request", "method": "setStatus",
                         "statusKey": "pi-telegram:result:a", "statusText": "Found 3 events"})
            sm.on_event({"type": "tool_execution_end", "toolCallId": "a", "result": {}, "isError": False})
            api.assert_not_called()
            sm.on_event({"type": "extension_ui_request", "method": "setStatus",
                         "statusKey": "pi-telegram:title:a", "statusText": "Check upcoming events"})
            self.assertEqual(api.call_args[0][1]["text"], "◆ Check upcoming events\n└─ Found 3 events")

    def test_comment_and_stored_titles_take_precedence_over_generated_title(self):
        tree = daemon.TraceBuilder()
        tree.on_tool_execution_start("a", "codemode", {"code": "// Check the local notes\nrun()"})
        tree.on_title("a", "Generic generated title")
        self.assertEqual(tree.render(), "◇ Check the local notes")
        tree.on_tool_execution_end("a", {"details": {"intentTitle": "Stored intent title"}})
        self.assertEqual(tree.render(), "◆ Stored intent title")

    def test_error_without_calls_removes_any_status_message(self):
        """An unsuccessful path must not leave a stale status behind."""
        with patch.object(daemon, "telegram_api") as mock_api:
            mock_api.return_value = {"message_id": 9}
            sm = daemon.StatusMessenger("123")
            sm.message_id = 9  # a message existed, then the trace emptied
            sm.finalize()
            self.assertEqual([c[0][0] for c in mock_api.call_args_list], ["deleteMessage"])

    def test_nested_tool_calls_do_not_add_rows(self):
        with patch.object(daemon, "telegram_api") as mock_api:
            mock_api.return_value = {"message_id": 7}
            sm = daemon.StatusMessenger("123")
            sm.on_event(self._call_event("p1", "mcpScript", {"code": "// Search the workspace\nrun()"}))
            sm.on_event({
                "type": "tool_execution_start", "toolCallId": "n1", "toolName": "grep",
                "args": {"pattern": "x"}, "parentToolCallId": "p1",
            })
            sm.flush()
            self.assertEqual(mock_api.call_args[0][1]["text"], "◇ Search the workspace")

    def test_telegram_api_error_does_not_crash(self):
        with patch.object(daemon, "telegram_api", side_effect=RuntimeError("429 Too Many Requests")):
            sm = daemon.StatusMessenger("123")
            sm.on_event(self._call_event())  # create fails, swallowed
            sm.finalize()  # nothing was created, so there is nothing to delete
            sm.flush()

    def test_malformed_events_are_safe(self):
        with patch.object(daemon, "telegram_api") as mock_api:
            mock_api.return_value = {"message_id": 1}
            sm = daemon.StatusMessenger("123")
            sm.on_event({})
            sm.on_event({"type": "tool_execution_start"})
            sm.on_event({"type": "tool_execution_start", "toolCallId": "c1",
                         "toolName": "", "args": "not-a-dict"})
            sm.finalize()
            mock_api.assert_not_called()


class TestCallbackSafety(unittest.TestCase):
    """Old Details buttons are inert but every callback query is answered."""

    def test_old_details_button_is_answered_without_edit(self):
        with patch.object(daemon, "ALLOWED_CHATS", {"123"}), \
             patch.object(daemon, "telegram_api") as mock_api:
            daemon.handle_callback_query({"callback_query": {
                "id": "cb1", "data": "d:stale-token",
                "message": {"chat": {"id": 123}, "message_id": 7},
            }})
            self.assertEqual(mock_api.call_count, 1)
            method, payload = mock_api.call_args[0]
            self.assertEqual(method, "answerCallbackQuery")
            self.assertEqual(payload["callback_query_id"], "cb1")
            self.assertIn("no longer available", payload["text"])

    def test_old_hide_button_is_answered(self):
        with patch.object(daemon, "ALLOWED_CHATS", {"123"}), \
             patch.object(daemon, "telegram_api") as mock_api:
            daemon.handle_callback_query({"callback_query": {
                "id": "cb2", "data": "h:stale-token", "message": {"chat": {"id": 123}},
            }})
            method, payload = mock_api.call_args[0]
            self.assertEqual(method, "answerCallbackQuery")
            self.assertIn("no longer available", payload["text"])

    def test_unrelated_callbacks_are_preserved(self):
        with patch.object(daemon, "telegram_api") as mock_api:
            daemon.handle_callback_query({"callback_query": {"id": "cb3", "data": "other:thing"}})
            method, payload = mock_api.call_args[0]
            self.assertEqual(method, "answerCallbackQuery")
            self.assertNotIn("text", payload)  # no toast, no edit

    def test_old_button_from_a_foreign_chat_is_rejected(self):
        with patch.object(daemon, "ALLOWED_CHATS", {"123"}), \
             patch.object(daemon, "telegram_api") as mock_api:
            daemon.handle_callback_query({"callback_query": {
                "id": "cb5", "data": "d:stale-token",
                "message": {"chat": {"id": 999}, "message_id": 7},
            }})
        method, payload = mock_api.call_args[0]
        self.assertEqual(method, "answerCallbackQuery")
        self.assertIn("Not allowed", payload["text"])

    def test_old_button_edit_is_never_sent(self):
        with patch.object(daemon, "ALLOWED_CHATS", {"123"}), \
             patch.object(daemon, "telegram_api") as mock_api:
            daemon.handle_callback_query({"callback_query": {
                "id": "cb6", "data": "h:stale-token",
                "message": {"chat": {"id": "123"}, "message_id": 7},
            }})
        methods = [c[0][0] for c in mock_api.call_args_list]
        self.assertEqual(methods, ["answerCallbackQuery"])

    def test_callback_without_id_is_ignored(self):
        with patch.object(daemon, "telegram_api") as mock_api:
            daemon.handle_callback_query({"callback_query": {"data": "d:x"}})
            mock_api.assert_not_called()

    def test_answer_failure_is_swallowed(self):
        with patch.object(daemon, "telegram_api", side_effect=RuntimeError("gone")), \
             patch.object(daemon, "log"):
            daemon.handle_callback_query({"callback_query": {"id": "cb4", "data": "d:x"}})


class TestAskIntegration(unittest.TestCase):
    """Integration test: mock the RPC subprocess, feed events, verify flow."""

    def _make_event(self, ev_type: str, **kwargs) -> dict:
        ev = {"type": ev_type}
        ev.update(kwargs)
        return ev

    @staticmethod
    def _fake_pi(events):
        """A PiRPC whose prompt reply is a fixed event list — no subprocess."""
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
                pi.lines.put({"type": "response", "id": cmd["id"], "success": True, "command": "prompt"})
                for event in events:
                    pi.lines.put(event)
                pi.lines.put({"type": "agent_settled"})
            elif cmd.get("type") == "get_last_assistant_text":
                pi.lines.put({"type": "response", "id": cmd["id"], "success": True,
                              "command": "get_last_assistant_text",
                              "data": {"text": "There are 5 issues; next is #03."}})

        pi._send = MagicMock(side_effect=fake_send)
        return pi

    def test_ask_deletes_title_trace_after_response_is_ready(self):
        """A tool call creates a temporary title; the response fetch precedes deletion."""
        events = [
            {"type": "turn_start"},
            {"type": "tool_execution_start", "toolCallId": "c1", "toolName": "bash",
             "args": {"command": "# Check which weekday the log names start on\ndate +%A"}},
            {"type": "tool_execution_end", "toolCallId": "c1", "isError": False,
             "result": {"content": [{"type": "text", "text": "Monday"}], "details": {}}},
            {"type": "turn_end"},
        ]
        with patch.object(daemon, "telegram_api") as mock_tg, \
             patch.object(daemon, "THINKING_STREAM_ENABLED", True), \
             patch.object(daemon, "STATUS_FINAL_PAUSE", 0.0):
            mock_tg.return_value = {"message_id": 555}
            pi = self._fake_pi(events)
            wait_response = pi._wait_response

            def checked_wait(*args, **kwargs):
                self.assertNotIn("deleteMessage", [c[0][0] for c in mock_tg.call_args_list])
                return wait_response(*args, **kwargs)

            pi._wait_response = checked_wait
            result = pi.ask("test prompt", chat_id="123", reply_to=100)

        self.assertEqual(result, "There are 5 issues; next is #03.")
        methods = [c[0][0] for c in mock_tg.call_args_list]
        self.assertEqual(methods, ["sendMessage", "editMessageText", "deleteMessage"])
        payload = next(c[0][1] for c in mock_tg.call_args_list if c[0][0] == "sendMessage")
        self.assertEqual(payload["text"], "◇ Check which weekday the log names start…")
        self.assertEqual(mock_tg.call_args_list[-2][0][1]["text"], "◆ Check which weekday the log names start…")
        self.assertNotIn("reply_parameters", payload)  # never quotes the prompt
        self.assertNotIn("reply_markup", payload)  # no Details button
        self.assertNotIn("%A", payload["text"])

    def test_ask_deletes_status_if_reply_fetch_fails(self):
        events = [{"type": "tool_execution_start", "toolCallId": "c1", "toolName": "bash",
                   "args": {"command": "# Inspect the project state\ntrue"}}]
        with patch.object(daemon, "telegram_api") as api, \
             patch.object(daemon, "THINKING_STREAM_ENABLED", True), \
             patch.object(daemon, "STATUS_FINAL_PAUSE", 0.0):
            api.return_value = {"message_id": 555}
            pi = self._fake_pi(events)
            pi._wait_response = MagicMock(side_effect=RuntimeError("response fetch failed"))
            with self.assertRaisesRegex(RuntimeError, "response fetch failed"):
                pi.ask("test", chat_id="123")
            self.assertEqual([c[0][0] for c in api.call_args_list], ["sendMessage", "deleteMessage"])

    def test_ask_does_not_wait_for_a_handled_extension_command(self):
        pi = self._fake_pi([])

        def fake_send(cmd):
            if cmd.get("type") == "prompt":
                pi.lines.put({"type": "response", "id": cmd["id"], "success": True,
                              "data": {"disposition": "handled"}})
            else:
                self.fail("A handled command must not fetch an earlier assistant reply")

        pi._send = MagicMock(side_effect=fake_send)
        with patch.object(daemon, "telegram_api") as api, patch.object(daemon, "THINKING_STREAM_ENABLED", True):
            self.assertEqual(pi.ask("/example", chat_id="123"), "Command handled.")
        api.assert_not_called()
        self.assertEqual(pi._send.call_count, 1)

    def test_ask_without_tool_calls_leaves_no_trace(self):
        """A text-only turn sends no status message at all."""
        events = [
            {"type": "turn_start"},
            {"type": "message_start", "message": {"role": "assistant"}},
            {"type": "message_update", "assistantMessageEvent": {
                "type": "thinking_delta", "contentIndex": 0, "delta": "I should look at the issues"}},
            {"type": "turn_end"},
        ]
        with patch.object(daemon, "telegram_api") as mock_tg, \
             patch.object(daemon, "THINKING_STREAM_ENABLED", True), \
             patch.object(daemon, "STATUS_FINAL_PAUSE", 0.0):
            mock_tg.return_value = {"message_id": 555}
            pi = self._fake_pi(events)

            result = pi.ask("test prompt", chat_id="123", reply_to=100)

        self.assertEqual(result, "There are 5 issues; next is #03.")
        mock_tg.assert_not_called()

    def test_ask_never_sends_an_untitled_tool_name(self):
        events = [
            {"type": "tool_execution_start", "toolCallId": "m1", "toolName": "mcp__calendar", "args": {}},
            {"type": "tool_execution_end", "toolCallId": "m1", "result": {}, "isError": True},
        ]
        with patch.object(daemon, "telegram_api") as api, patch.object(daemon, "THINKING_STREAM_ENABLED", True):
            pi = self._fake_pi(events)
            pi.ask("test", chat_id="123")
            api.assert_not_called()

    def test_ask_applies_generated_mcp_title_to_the_live_message(self):
        events = [
            {"type": "tool_execution_start", "toolCallId": "m1", "toolName": "mcp__calendar", "args": {}},
            {"type": "extension_ui_request", "method": "setStatus",
             "statusKey": "pi-telegram:title:m1", "statusText": "Find calendar events"},
            {"type": "tool_execution_end", "toolCallId": "m1", "result": {}, "isError": False},
        ]
        with patch.object(daemon, "telegram_api") as api, \
             patch.object(daemon, "THINKING_STREAM_ENABLED", True), \
             patch.object(daemon, "STATUS_EDIT_INTERVAL", 0.0), \
             patch.object(daemon, "STATUS_FINAL_PAUSE", 0.0):
            api.return_value = {"message_id": 7}
            pi = self._fake_pi(events)
            self.assertEqual(pi.ask("test", chat_id="123"), "There are 5 issues; next is #03.")
            self.assertEqual(api.call_args_list[-2][0][1]["text"], "◆ Find calendar events")
            self.assertEqual(api.call_args_list[-1][0][0], "deleteMessage")
            self.assertFalse(any(c.args[0].get("type") == "extension_ui_response" for c in pi._send.call_args_list))

    def test_ask_shows_result_summary_before_deleting_status(self):
        events = [
            {"type": "tool_execution_start", "toolCallId": "c1", "toolName": "bash",
             "args": {"command": "# Check the service\ntrue"}},
            {"type": "tool_execution_end", "toolCallId": "c1", "isError": True,
             "result": {"content": [{"type": "text", "text": "raw secret error"}]}},
            {"type": "extension_ui_request", "method": "setStatus",
             "statusKey": "pi-telegram:result:c1", "statusText": "Service is unavailable"},
        ]
        with patch.object(daemon, "telegram_api") as api, \
             patch.object(daemon, "THINKING_STREAM_ENABLED", True), \
             patch.object(daemon, "STATUS_FINAL_PAUSE", 0.0):
            api.return_value = {"message_id": 7}
            pi = self._fake_pi(events)
            pi.ask("test", chat_id="123")
            self.assertEqual(api.call_args_list[-2][0][1]["text"],
                             "× Check the service\n└─ Service is unavailable")
            self.assertEqual(api.call_args_list[-1][0][0], "deleteMessage")
            self.assertNotIn("raw secret", str(api.call_args_list))

    def test_ask_waits_for_agent_settled_across_a_retry(self):
        """A retry emits another agent_start/agent_end; the trace keeps every title."""
        events = [
            {"type": "agent_start"},
            {"type": "turn_start"},
            {"type": "tool_execution_start", "toolCallId": "c1", "toolName": "bash",
             "args": {"command": "# Check which weekday the log names start on\ndate +%A"}},
            {"type": "tool_execution_end", "toolCallId": "c1", "result": {"content": [], "details": {}}},
            {"type": "agent_end"},
            {"type": "agent_start"},  # automatic retry of the same prompt
            {"type": "tool_execution_start", "toolCallId": "c2", "toolName": "read",
             "args": {"path": "/home/x/vault/state.json"}},
            {"type": "extension_ui_request", "method": "setStatus",
             "statusKey": "pi-telegram:title:c2", "statusText": "Inspect the project state"},
            {"type": "agent_end"},
        ]
        with patch.object(daemon, "telegram_api") as mock_tg, \
             patch.object(daemon, "THINKING_STREAM_ENABLED", True), \
             patch.object(daemon, "STATUS_EDIT_INTERVAL", 0.0), \
             patch.object(daemon, "STATUS_FINAL_PAUSE", 0.0):
            mock_tg.return_value = {"message_id": 555}
            pi = self._fake_pi(events)

            result = pi.ask("test prompt", chat_id="123", reply_to=100)

        self.assertEqual(result, "There are 5 issues; next is #03.")
        texts = [c[0][1]["text"] for c in mock_tg.call_args_list if "text" in c[0][1]]
        self.assertEqual(
            texts[-1], "◆ Check which weekday the log names start…\n◇ Inspect the project state"
        )
        self.assertEqual(mock_tg.call_args_list[-1][0][0], "deleteMessage")

    def test_ask_ignores_stale_events_before_the_prompt_response(self):
        """Events queued before this prompt's response belong to an older run."""
        with patch.object(daemon, "telegram_api") as mock_tg, \
             patch.object(daemon, "THINKING_STREAM_ENABLED", True), \
             patch.object(daemon, "STATUS_FINAL_PAUSE", 0.0):
            mock_tg.return_value = {"message_id": 555}
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
                    # Stale leftovers from the previous prompt, then the response.
                    pi.lines.put({"type": "tool_execution_start", "toolCallId": "stale",
                                  "toolName": "bash", "args": {"command": "# Stale leftover\ntrue"}})
                    pi.lines.put({"type": "agent_start"})
                    pi.lines.put({"type": "response", "id": cmd["id"], "success": True})
                    pi.lines.put({"type": "tool_execution_start", "toolCallId": "fresh",
                                  "toolName": "bash", "args": {"command": "# Read the fresh log\ntail x"}})
                    pi.lines.put({"type": "agent_settled"})
                elif cmd.get("type") == "get_last_assistant_text":
                    pi.lines.put({"type": "response", "id": cmd["id"], "success": True,
                                  "data": {"text": "Done."}})

            pi._send = MagicMock(side_effect=fake_send)
            pi.ask("test prompt", chat_id="123")

        texts = [c[0][1]["text"] for c in mock_tg.call_args_list if "text" in c[0][1]]
        self.assertEqual(texts[-1], "◇ Read the fresh log")

    def test_ask_drops_an_old_title_before_prompt_acceptance(self):
        with patch.object(daemon, "telegram_api") as api, \
             patch.object(daemon, "THINKING_STREAM_ENABLED", True), \
             patch.object(daemon, "STATUS_FINAL_PAUSE", 0.0):
            api.return_value = {"message_id": 7}
            pi = self._fake_pi([])

            def fake_send(cmd):
                if cmd.get("type") == "prompt":
                    pi.lines.put({"type": "extension_ui_request", "method": "setStatus",
                                  "statusKey": "pi-telegram:title:fresh", "statusText": "Old private title"})
                    pi.lines.put({"type": "response", "id": cmd["id"], "success": True})
                    pi.lines.put({"type": "tool_execution_start", "toolCallId": "fresh",
                                  "toolName": "mcp__calendar", "args": {}})
                    pi.lines.put({"type": "extension_ui_request", "method": "setStatus",
                                  "statusKey": "pi-telegram:title:fresh", "statusText": "Check calendar events"})
                    pi.lines.put({"type": "agent_settled"})
                elif cmd.get("type") == "get_last_assistant_text":
                    pi.lines.put({"type": "response", "id": cmd["id"], "success": True,
                                  "data": {"text": "Done."}})

            pi._send = MagicMock(side_effect=fake_send)
            pi.ask("test", chat_id="123")
            texts = [c[0][1]["text"] for c in api.call_args_list if "text" in c[0][1]]
            self.assertEqual(texts, ["◇ Check calendar events"])

    def test_ask_still_answers_extension_ui_requests_before_the_response(self):
        """Headless UI auto-cancel is not part of the trace gate."""
        with patch.object(daemon, "telegram_api") as mock_tg:
            pi = daemon.PiRPC.__new__(daemon.PiRPC)
            pi.proc = MagicMock()
            pi.proc.poll.return_value = None
            pi.proc.stdin = MagicMock()
            pi.lines = __import__("queue").Queue()
            pi.lock = __import__("threading").Lock()
            pi.reader_thread = None
            pi.stderr_thread = None
            sent = []

            def fake_send(cmd):
                if cmd.get("type") == "prompt":
                    pi.lines.put({"type": "extension_ui_request", "id": "ui1", "method": "confirm"})
                    pi.lines.put({"type": "response", "id": cmd["id"], "success": True})
                    pi.lines.put({"type": "agent_settled"})
                elif cmd.get("type") == "get_last_assistant_text":
                    pi.lines.put({"type": "response", "id": cmd["id"], "success": True,
                                  "data": {"text": "Done."}})
                sent.append(cmd)

            pi._send = MagicMock(side_effect=fake_send)
            pi.ask("test prompt")

        answers = [c for c in sent if c.get("type") == "extension_ui_response"]
        self.assertEqual(answers, [{"type": "extension_ui_response", "id": "ui1",
                                    "cancelled": True, "confirmed": False}])
        mock_tg.assert_not_called()

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
                    pi.lines.put({"type": "agent_settled"})
                elif cmd.get("type") == "get_last_assistant_text":
                    pi.lines.put({"type": "response", "id": cmd["id"], "success": True,
                                 "data": {"text": "Done."}})

            pi._send = MagicMock(side_effect=fake_send)
            result = pi.ask("test prompt")

            self.assertEqual(result, "Done.")
            mock_tg.assert_not_called()

    def test_ask_timeout_deletes_a_created_status(self):
        with patch.object(daemon, "telegram_api") as api, \
             patch.object(daemon, "THINKING_STREAM_ENABLED", True), \
             patch.object(daemon, "PROMPT_TIMEOUT_SECONDS", 1), \
             patch.object(daemon, "STATUS_FINAL_PAUSE", 0.0), \
             patch.object(daemon.time, "time", side_effect=[0, 0, 0, 2]):
            api.return_value = {"message_id": 7}
            pi = self._fake_pi([])

            def fake_send(cmd):
                if cmd.get("type") == "prompt":
                    pi.lines.put({"type": "response", "id": cmd["id"], "success": True})
                    pi.lines.put({"type": "tool_execution_start", "toolCallId": "c1", "toolName": "bash",
                                  "args": {"command": "# Inspect the project state\ntrue"}})

            pi._send = MagicMock(side_effect=fake_send)
            with self.assertRaises(TimeoutError):
                pi.ask("test", chat_id="123")
            self.assertEqual([c[0][0] for c in api.call_args_list], ["sendMessage", "deleteMessage"])

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
                    pi.lines.put({"type": "agent_settled"})
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
                    pi.lines.put({"type": "agent_settled"})
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

    def test_mention_after_emoji_uses_telegram_utf16_offsets(self):
        msg = self._msg("🙂 @mybot hello",
                        entities=[{"type": "mention", "offset": 3, "length": 6}])
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

    def test_bot_command_after_emoji_uses_telegram_utf16_offsets(self):
        msg = self._msg("🙂 /status@mybot",
                        entities=[{"type": "bot_command", "offset": 3, "length": 13}])
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

    def test_shortcut_header_is_stripped(self):
        self._header_case("iOS Shortcut voice-note transcript from chat")

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

    @staticmethod
    def _call(call_id, name="bash", args=None):
        return {"type": "tool_execution_start", "toolCallId": call_id,
                "toolName": name, "args": args or {"command": "# Inspect the project state\ntrue"}}

    def test_deferred_flush_fires_when_throttle_cools(self):
        fake = _FakeTime(100.0)
        with patch.object(daemon, "time", fake), \
             patch.object(daemon, "STATUS_EDIT_INTERVAL", 10.0), \
             patch.object(daemon, "STATUS_FINAL_PAUSE", 0.0), \
             patch.object(daemon, "telegram_api") as api:
            api.return_value = {"message_id": 7}
            sm = daemon.StatusMessenger("1")
            sm.on_event(self._call("c1"))  # t=100: create
            self.assertEqual([c[0][0] for c in api.call_args_list], ["sendMessage"])

            fake.now = 103.0  # throttle hot: 103-100 < 10
            sm.on_event(self._call("c2"))
            self.assertEqual(api.call_count, 1)  # edit deferred, change held
            self.assertTrue(sm.dirty)

            fake.now = 111.0  # throttle cold: 111-100 >= 10
            sm.on_event(self._call("c3"))
            self.assertEqual(api.call_count, 2)  # deferred change flushed now
            method, payload = api.call_args[0][0], api.call_args[0][1]
            self.assertEqual(method, "editMessageText")
            self.assertEqual(payload["text"], "◇ Inspect the project state\n◇ Inspect the project state\n◇ Inspect the project state")

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
            sm.on_event(self._call("c1"))  # create at 100
            fake.now = 103.0
            sm.on_event(self._call("c2"))  # edit raises — swallowed
            fake.now = 106.0
            sm.on_event(self._call("c3"))  # next edit succeeds
            sm.finalize()
        methods = [c[0][0] for c in api.call_args_list]
        self.assertEqual(methods.count("editMessageText"), 2)
        self.assertEqual(methods[-1], "deleteMessage")  # the temporary message is removed


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

    def test_uncertain_reply_delivery_does_not_send_a_second_message(self):
        status_update = _make_update({"text": "!pi status"})
        pi = MagicMock()
        pi.status.return_value = "All good."
        with patch.object(daemon, "BOT_TOKEN", "test-token"), \
             patch.object(daemon, "ALLOWED_CHATS", {"123"}), \
             patch.object(daemon, "PREFIX", "!pi"), \
             patch.object(daemon, "load_state", return_value={"last_update_id": 0}), \
             patch.object(daemon, "save_state"), \
             patch.object(daemon, "fetch_bot_identity"), \
             patch.object(daemon, "start_shortcut_listener"), \
             patch.object(daemon, "send_telegram", side_effect=TimeoutError("uncertain")) as send, \
             patch.object(daemon, "PiRPC", return_value=pi), \
             patch.object(daemon, "fetch_updates", side_effect=[[status_update], SystemExit(0)]):
            with self.assertRaises(SystemExit):
                daemon.main()
        send.assert_called_once_with("123", "All good.", reply_to_message_id=10)


# ---------------------------------------------------------------------------
# Extra daemon-behavior coverage (pure logic, offline)
# ---------------------------------------------------------------------------


class TestReplyFormatting(unittest.TestCase):
    """Telegram reply filtering, Rich Markdown, and fallback rendering."""

    def test_suggested_followup_footer_is_removed(self):
        text = "The answer.\n\n## Suggested follow-up questions\n- Can you show more?\n- Can you check it?\n"
        self.assertEqual(daemon.strip_suggested_followups(text), "The answer.")

    def test_followup_heading_variants_are_removed(self):
        for heading in ("### SUGGESTED FOLLOW-UPS:", "**Suggested follow-up questions**"):
            with self.subTest(heading=heading):
                self.assertEqual(daemon.strip_suggested_followups(f"Done.\n\n{heading}\n- More?"), "Done.")

    def test_followup_filter_preserves_later_sections(self):
        text = "Done.\n\n## Suggested follow-up questions\n- More?\n\n## Details\nKeep this."
        self.assertEqual(daemon.strip_suggested_followups(text), "Done.\n\n## Details\nKeep this.")

    def test_followup_filter_preserves_code_and_ordinary_questions(self):
        text = "Example:\n```md\n## Suggested follow-up questions\n- Keep this.\n```\n\nWhat should I check?"
        self.assertEqual(daemon.strip_suggested_followups(text), text)
        similar = "## Suggested follow-up questions answered\nKeep this."
        self.assertEqual(daemon.strip_suggested_followups(similar), similar)

    def test_send_telegram_filters_before_rendering_and_keeps_reply_target(self):
        text = "Done.\n\n## Suggested follow-up questions\n- This footer must not be sent."
        with patch.object(daemon, "telegram_api") as api:
            daemon.send_telegram("123", text, reply_to_message_id=42)
        api.assert_called_once_with("sendRichMessage", {
            "chat_id": "123", "rich_message": {"markdown": "Done."},
            "reply_parameters": {"message_id": 42, "allow_sending_without_reply": True},
        }, timeout=60)

    def test_send_telegram_handles_a_followup_only_reply(self):
        with patch.object(daemon, "telegram_api") as api:
            daemon.send_telegram("123", "## Suggested follow-up questions\n- More?")
        self.assertEqual(api.call_args[0][1]["rich_message"]["markdown"], "(No response.)")

    def test_rich_message_keeps_markdown_and_does_not_split_at_standard_limit(self):
        text = "## Heading\n- **Bold** [link](https://example.com)\n\n| A | B |\n|---|---|\n| x | y |\n\n```py\nx = 1 + 2\n```"
        with patch.object(daemon, "MAX_REPLY_CHARS", 10), patch.object(daemon, "telegram_api") as api:
            daemon.send_telegram("123", text)
        api.assert_called_once_with("sendRichMessage", {
            "chat_id": "123", "rich_message": {"markdown": text},
        }, timeout=60)

    def test_rich_markdown_disables_html_and_media(self):
        text = (
            '<tg-button type="url">Press</tg-button> ![image](https://example.com/x.png)\n'
            '\\<escaped> \\![escaped](https://example.com/x)\n'
            '\\\\<unescaped> \\\\![unescaped](https://example.com/x)'
        )
        expected = (
            '\\<tg-button type="url">Press\\</tg-button> \\![image](https://example.com/x.png)\n'
            '\\<escaped> \\![escaped](https://example.com/x)\n'
            '\\\\\\<unescaped> \\\\\\![unescaped](https://example.com/x)'
        )
        self.assertEqual(daemon.telegram_rich_markdown(text), expected)

    def test_markup_with_possible_code_uses_safe_fallback_without_changing_code(self):
        for text in (
            '`x < y`', '```html\n<img src="x">\n```',
            '~~~html\n<img src="x">\n~~~', '    <img src="x">',
            '- item\n  ```\n<img src="x">',
            '[link](https://example.com/`x) <img src="x"> `',
            '`![](https://example.com/x)`',
        ):
            with self.subTest(text=text), patch.object(daemon, "telegram_api") as api:
                daemon.send_telegram("123", text)
                self.assertIsNone(daemon.telegram_rich_markdown(text))
                self.assertEqual(api.call_args.args[0], "sendMessage")
                self.assertEqual(api.call_args.args[1]["text"], daemon.telegram_html(text))

    def test_rejected_rich_message_uses_standard_html(self):
        for code in (400, 404):
            with self.subTest(code=code), patch.object(daemon, "telegram_api", side_effect=[
                daemon.TelegramAPIError("rejected", code), {},
            ]) as api, patch.object(daemon, "log"):
                daemon.send_telegram("123", "**Done**", reply_to_message_id=42)
            self.assertEqual(api.call_count, 2)
            self.assertEqual(api.call_args_list[1].args, ("sendMessage", {
                "chat_id": "123", "text": "<b>Done</b>", "parse_mode": "HTML",
                "link_preview_options": {"is_disabled": True},
                "reply_parameters": {"message_id": 42, "allow_sending_without_reply": True},
            }))

    def test_rejected_html_falls_back_to_plain_text(self):
        with patch.object(daemon, "telegram_api", side_effect=[
            daemon.TelegramAPIError("rich rejected", 400),
            daemon.TelegramAPIError("html rejected", 400), {},
        ]) as api, patch.object(daemon, "log"):
            daemon.send_telegram("123", "`**literal**`")
        self.assertEqual([call.args[0] for call in api.call_args_list], [
            "sendRichMessage", "sendMessage", "sendMessage",
        ])
        self.assertEqual(api.call_args.args[1], {
            "chat_id": "123", "text": "`**literal**`", "link_preview_options": {"is_disabled": True},
        })

    def test_uncertain_rich_send_is_not_retried(self):
        for error in (daemon.TelegramAPIError("rate limit", 429),
                      daemon.TelegramAPIError("server", 500),
                      urllib.error.URLError("network down"), TimeoutError("timeout")):
            with self.subTest(error=error), patch.object(daemon, "telegram_api", side_effect=error) as api:
                with self.assertRaises(type(error)):
                    daemon.send_telegram("123", "hello")
                api.assert_called_once()

    def test_oversized_rich_message_uses_chunked_standard_messages(self):
        with patch.object(daemon, "MAX_RICH_REPLY_CHARS", 5), \
             patch.object(daemon, "MAX_REPLY_CHARS", 4), \
             patch.object(daemon, "telegram_api") as api:
            daemon.send_telegram("123", "abcdefghij")
        self.assertEqual([call.args[0] for call in api.call_args_list], ["sendMessage"] * 3)
        self.assertEqual([call.args[1]["text"] for call in api.call_args_list], [
            "(1/3)\nabcd", "(2/3)\nefgh", "(3/3)\nij",
        ])

    def test_standard_chunk_limit_counts_emoji(self):
        with patch.object(daemon, "MAX_REPLY_CHARS", 4):
            chunks = daemon.chunk_reply("🙂🙂🙂a")
        self.assertEqual(chunks, ["🙂🙂", "🙂a"])
        self.assertTrue(all(daemon._utf16_len(chunk) <= 4 for chunk in chunks))

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

    def test_update_polls_include_callbacks_for_old_buttons(self):
        with patch.object(daemon, "telegram_api", return_value=[]) as api:
            daemon.get_latest_update_id()
            daemon.fetch_updates(42)
        for call in api.call_args_list:
            self.assertEqual(call.args[1]["allowed_updates"], ["message", "callback_query"])

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

    def test_http_error_keeps_code_without_leaking_response_or_token(self):
        error = urllib.error.HTTPError("https://example.com/bottest-token/sendRichMessage", 400,
                                       "bad", {}, io.BytesIO(b"private reply"))
        with patch.object(daemon, "BOT_TOKEN", "test-token"), \
             patch.object(daemon.urllib.request, "urlopen", side_effect=error):
            with self.assertRaises(daemon.TelegramAPIError) as ctx:
                daemon.telegram_api("sendRichMessage", {})
        self.assertEqual(ctx.exception.code, 400)
        self.assertNotIn("test-token", str(ctx.exception))
        self.assertNotIn("private reply", str(ctx.exception))

    def test_api_failure_response_keeps_code_without_leaking_contents(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps({
            "ok": False, "error_code": 400, "description": "private reply",
        }).encode()
        with patch.object(daemon, "BOT_TOKEN", "test-token"), \
             patch.object(daemon.urllib.request, "urlopen", return_value=response):
            with self.assertRaises(daemon.TelegramAPIError) as ctx:
                daemon.telegram_api("sendRichMessage", {})
        self.assertEqual(ctx.exception.code, 400)
        self.assertNotIn("private reply", str(ctx.exception))


class TestShortcutEndpoint(unittest.TestCase):
    """iOS Shortcut audio endpoint: parser, auth, and handler flow (offline)."""

    def setUp(self):
        self._saved = (
            daemon.SHORTCUT_TOKEN,
            daemon.SHORTCUT_SEND_TO_TELEGRAM,
            daemon.ALLOWED_CHATS,
        )
        daemon.SHORTCUT_TOKEN = "test-token"
        daemon.SHORTCUT_SEND_TO_TELEGRAM = False
        daemon.ALLOWED_CHATS = {"123456789", "-1001234567890"}

    def tearDown(self):
        (daemon.SHORTCUT_TOKEN, daemon.SHORTCUT_SEND_TO_TELEGRAM, daemon.ALLOWED_CHATS) = self._saved

    @staticmethod
    def _multipart(fields, boundary="x-boundary-123"):
        out = b""
        for name, (filename, data) in fields.items():
            out += f"--{boundary}\r\n".encode()
            if filename:
                out += f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode()
                out += b"Content-Type: audio/mp4\r\n"
            else:
                out += f'Content-Disposition: form-data; name="{name}"\r\n'.encode()
            out += b"\r\n" + data + b"\r\n"
        return out + f"--{boundary}--\r\n".encode(), boundary

    def _post(self, base, body, boundary):
        req = urllib.request.Request(
            base, data=body, method="POST",
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
        return urllib.request.urlopen(req, timeout=5)

    def test_parse_multipart(self):
        audio = b"ID3\x04\x00fake-bytes\r\nwith-crlf"
        body, boundary = self._multipart({
            "token": (None, b"secret-token"),
            "file": ("note.m4a", audio),
        })
        fields = daemon.parse_multipart(body, boundary)
        self.assertEqual(fields["token"], (None, b"secret-token"))
        self.assertEqual(fields["file"], ("note.m4a", audio))

    def test_build_multipart_round_trip(self):
        audio = b"ID3\x04\x00round-trip\r\nbytes"
        body, boundary = daemon._build_multipart({
            "chat_id": (None, b"123456789"),
            "voice": ("note.m4a", audio),
        })
        fields = daemon.parse_multipart(body, boundary)
        self.assertEqual(fields["chat_id"], (None, b"123456789"))
        self.assertEqual(fields["voice"], ("note.m4a", audio))

    def test_shortcut_uses_only_one_numeric_private_chat(self):
        daemon.ALLOWED_CHATS = {"@owner", "123456789", "-1001234567890"}
        self.assertEqual(daemon.shortcut_target_chat_id(), "123456789")
        for chats in ({"@owner"}, {"123456789", "111222333"}, {"１２３"}, {"0"}):
            with self.subTest(chats=chats):
                daemon.ALLOWED_CHATS = chats
                self.assertEqual(daemon.shortcut_target_chat_id(), "")

    def test_ambiguous_shortcut_target_never_sends_to_a_chat(self):
        daemon.ALLOWED_CHATS = {"123456789", "111222333"}
        pi = MagicMock()
        with patch.object(daemon, "send_telegram") as send, \
             patch.object(daemon, "transcribe_with_command") as transcribe, patch.object(daemon, "log"):
            daemon._run_shortcut_note(pi, "note.m4a", b"audio-bytes")
        send.assert_not_called()
        transcribe.assert_not_called()
        pi.ask.assert_not_called()

    def test_handle_shortcut_audio_flow(self):
        sent, asked, voices = [], [], []

        class FakePi:
            def ask(self, message, chat_id=None, reply_to=None, images=None):
                asked.append((chat_id, message))
                return "agent reply"

        with patch.object(daemon, "send_telegram",
                          side_effect=lambda cid, text, reply_to_message_id=None: sent.append((cid, text))), \
             patch.object(daemon, "send_telegram_voice",
                          side_effect=lambda cid, path: voices.append((cid, path))), \
             patch.object(daemon, "transcribe_with_command", return_value="hello from the shortcut"), \
             patch.object(daemon, "transcribe_with_openai", return_value="must not be used"), \
             patch.object(daemon, "configured_voice_provider", return_value="command"), \
             patch.object(daemon, "ChatActionLoop"):
            daemon.handle_shortcut_audio(FakePi(), "note.m4a", b"audio-bytes")
        self.assertEqual(asked[0][0], "123456789")
        self.assertIn("iOS Shortcut voice-note transcript", asked[0][1])
        self.assertIn("hello from the shortcut", asked[0][1])
        self.assertEqual(sent, [("123456789", "agent reply")])
        self.assertEqual(voices, [])  # disabled by default

    def test_shortcut_uncertain_delivery_does_not_send_an_error_message(self):
        pi = MagicMock()
        pi.ask.return_value = "agent reply"
        with patch.object(daemon, "send_telegram", side_effect=TimeoutError("uncertain")) as send, \
             patch.object(daemon, "transcribe_with_command", return_value="words"), \
             patch.object(daemon, "configured_voice_provider", return_value="command"), \
             patch.object(daemon, "ChatActionLoop"), patch.object(daemon, "log"):
            daemon._run_shortcut_note(pi, "note.m4a", b"audio-bytes")
        send.assert_called_once_with("123456789", "agent reply", reply_to_message_id=None)

    def test_handle_shortcut_audio_posts_voice_when_enabled(self):
        daemon.SHORTCUT_SEND_TO_TELEGRAM = True
        voices, sent, asked = [], [], []

        class FakePi:
            def ask(self, message, chat_id=None, reply_to=None, images=None):
                asked.append((chat_id, message))
                return "agent reply"

        def fake_voice(cid, path):
            voices.append((cid, Path(path).read_bytes()))

        with patch.object(daemon, "send_telegram",
                          side_effect=lambda cid, text, reply_to_message_id=None: sent.append((cid, text))), \
             patch.object(daemon, "send_telegram_voice", side_effect=fake_voice), \
             patch.object(daemon, "transcribe_with_command", return_value="words"), \
             patch.object(daemon, "configured_voice_provider", return_value="command"), \
             patch.object(daemon, "ChatActionLoop"):
            daemon.handle_shortcut_audio(FakePi(), "note.m4a", b"audio-bytes")
        self.assertEqual(voices, [("123456789", b"audio-bytes")])
        self.assertEqual(len(asked), 1)

    def test_shortcut_relay_uploads_and_answers_in_the_intake_chat(self):
        uploaded, texts = [], []

        class Relay:
            def chat_label(self):
                return "me"

            def send_voice_note(self, audio_path):
                uploaded.append(Path(audio_path).read_bytes())
                return True

            def send_text(self, text):
                texts.append(text)
                return True

        pi = MagicMock()
        with patch.object(daemon, "answer_voice_note", return_value="agent reply"), \
             patch.object(daemon, "transcribe_with_command") as transcribe, \
             patch.object(daemon, "send_telegram") as send, patch.object(daemon, "log"):
            daemon.handle_shortcut_audio(pi, "note.m4a", b"audio-bytes", Relay())
        self.assertEqual(uploaded, [b"audio-bytes"])
        self.assertEqual(texts, ["agent reply"])
        transcribe.assert_not_called()
        send.assert_not_called()
        pi.ask.assert_not_called()

    def test_shortcut_relay_leaves_the_answer_to_the_bot_path(self):
        uploaded = []

        class BotRelay:
            def chat_label(self):
                return "@virus_bot"

            def send_voice_note(self, audio_path):
                uploaded.append(Path(audio_path).read_bytes())
                return True

            def send_text(self, text):
                raise AssertionError("the bot path answers, not the relay")

            def answers_inline(self):
                return False

        pi = MagicMock()
        with patch.object(daemon, "answer_voice_note") as answer, patch.object(daemon, "log"):
            daemon.handle_shortcut_audio(pi, "note.m4a", b"audio-bytes", BotRelay())
        self.assertEqual(uploaded, [b"audio-bytes"])
        answer.assert_not_called()
        pi.ask.assert_not_called()

    def test_shortcut_relay_failure_falls_back_to_the_direct_answer(self):
        asked, sent = [], []

        class BrokenRelay:
            def chat_label(self):
                return "me"

            def send_voice_note(self, audio_path):
                raise RuntimeError("upload failed")

        class FakePi:
            def ask(self, message, chat_id=None, reply_to=None, images=None):
                asked.append(message)
                return "agent reply"

        with patch.object(daemon, "transcribe_with_command", return_value="words"), \
             patch.object(daemon, "configured_voice_provider", return_value="command"), \
             patch.object(daemon, "send_telegram",
                          side_effect=lambda cid, text, reply_to_message_id=None: sent.append(text)), \
             patch.object(daemon, "ChatActionLoop"), patch.object(daemon, "log"):
            daemon.handle_shortcut_audio(FakePi(), "note.m4a", b"audio-bytes", BrokenRelay())
        self.assertEqual(len(asked), 1)
        self.assertIn("words", asked[0])
        self.assertEqual(sent, ["agent reply"])

    def test_http_rejects_bad_token_and_missing_file(self):
        pi = MagicMock()
        with patch.object(daemon, "_run_shortcut_note") as run_note:
            server = daemon.ShortcutHTTPServer(("127.0.0.1", 0), pi)
            port = server.server_address[1]
            threading.Thread(target=server.serve_forever, daemon=True).start()
            try:
                base = f"http://127.0.0.1:{port}{daemon.SHORTCUT_PATH}"
                with urllib.request.urlopen(base, timeout=5) as r:  # GET health check
                    self.assertEqual(r.status, 200)
                body, boundary = self._multipart({
                    "token": (None, b"wrong-token"), "file": ("n.m4a", b"x")})
                with self.assertRaises(urllib.error.HTTPError) as ctx:
                    self._post(base, body, boundary)
                self.assertEqual(ctx.exception.code, 403)
                body, boundary = self._multipart({"token": (None, b"test-token")})
                with self.assertRaises(urllib.error.HTTPError) as ctx:
                    self._post(base, body, boundary)
                self.assertEqual(ctx.exception.code, 400)
                self.assertFalse(run_note.called)
            finally:
                server.shutdown()
                server.server_close()

    def test_http_accepts_valid_note(self):
        pi = MagicMock()
        with patch.object(daemon, "_run_shortcut_note") as run_note:
            server = daemon.ShortcutHTTPServer(("127.0.0.1", 0), pi)
            port = server.server_address[1]
            threading.Thread(target=server.serve_forever, daemon=True).start()
            try:
                base = f"http://127.0.0.1:{port}{daemon.SHORTCUT_PATH}"
                body, boundary = self._multipart({
                    "token": (None, b"test-token"), "file": ("note.m4a", b"audio-bytes")})
                with self._post(base, body, boundary) as r:
                    self.assertEqual(r.status, 200)
                    self.assertIn(b'"ok": true', r.read())
                deadline = time.time() + 2
                while time.time() < deadline and not run_note.called:
                    time.sleep(0.01)
                self.assertTrue(run_note.called)
                args = run_note.call_args[0]
                self.assertEqual(args[0], pi)
                self.assertEqual(args[1], "note.m4a")
                self.assertEqual(args[2], b"audio-bytes")
            finally:
                server.shutdown()
                server.server_close()


# ---------------------------------------------------------------------------
# Telethon user-session voice-note intake (offline, fake client)
# ---------------------------------------------------------------------------


class _FakeTelethonClient:
    """Stands in for telethon.TelegramClient. Records what the listener does."""

    def __init__(self, listener=None, authorized=True, connect_error=None):
        self.listener = listener
        self.authorized = authorized
        self.connect_error = connect_error
        self.connected = False
        self.disconnected = False
        self.handlers = []
        self.sent = []
        self.files = []
        self.attempts = 0

    async def connect(self):
        self.attempts += 1
        if self.connect_error is not None:
            raise self.connect_error
        self.connected = True

    async def is_user_authorized(self):
        return self.authorized

    async def get_me(self):
        return SimpleNamespace(username="owner", id=42)

    def add_event_handler(self, handler, event_filter):
        self.handlers.append((handler, event_filter))

    async def run_until_disconnected(self):
        if self.listener is not None:
            self.listener._stopping.set()

    async def send_message(self, chat_id, text, **kwargs):
        self.sent.append((chat_id, text, kwargs))

    async def send_file(self, chat_id, file, **kwargs):
        self.files.append((chat_id, Path(file).read_bytes(), kwargs))
        if kwargs.get("voice_note") and getattr(self, "reject_voice", False):
            raise RuntimeError("voice notes must be ogg")

    async def disconnect(self):
        self.disconnected = True


class _FakeEvent:
    def __init__(self, data=b"voice-bytes", chat_id=42, media="voice", mime_type="audio/ogg"):
        self.chat_id = chat_id
        self.sender_id = 42
        self._data = data
        self.downloads = 0
        if media is not None:
            setattr(self, media, SimpleNamespace(mime_type=mime_type, file_size=len(data)))

    async def download_media(self, file=None):
        self.downloads += 1
        return self._data


def _fake_telethon_module(client):
    return SimpleNamespace(
        TelegramClient=lambda *args, **kwargs: client,
        events=SimpleNamespace(NewMessage=lambda **kwargs: ("new-message", kwargs)),
    )


class TestTelethonSettings(unittest.TestCase):
    """The listener is opt-in, and a half-configured pair is loud."""

    def setUp(self):
        self._saved = (daemon.TELETHON_API_ID, daemon.TELETHON_API_HASH,
                       daemon.TELETHON_SESSION, daemon.TELETHON_CHAT)

    def tearDown(self):
        (daemon.TELETHON_API_ID, daemon.TELETHON_API_HASH,
         daemon.TELETHON_SESSION, daemon.TELETHON_CHAT) = self._saved

    def test_listener_is_off_without_credentials(self):
        daemon.TELETHON_API_ID = ""
        daemon.TELETHON_API_HASH = ""
        self.assertIsNone(daemon.telethon_settings())

    def test_half_configuration_is_an_operator_error(self):
        daemon.TELETHON_API_ID = "12345"
        daemon.TELETHON_API_HASH = ""
        with self.assertRaises(RuntimeError) as ctx:
            daemon.telethon_settings()
        self.assertIn("or neither", str(ctx.exception))
        daemon.TELETHON_API_ID = ""
        daemon.TELETHON_API_HASH = "hash"
        with self.assertRaises(RuntimeError):
            daemon.telethon_settings()

    def test_non_numeric_api_id_is_refused(self):
        daemon.TELETHON_API_ID = "abc"
        daemon.TELETHON_API_HASH = "hash"
        with self.assertRaises(RuntimeError) as ctx:
            daemon.telethon_settings()
        self.assertIn("numeric api_id", str(ctx.exception))

    def test_settings_default_to_saved_messages(self):
        daemon.TELETHON_API_ID = "12345"
        daemon.TELETHON_API_HASH = "hash"
        daemon.TELETHON_SESSION = "~/x/pi-telethon"
        daemon.TELETHON_CHAT = ""
        settings = daemon.telethon_settings()
        self.assertEqual(settings["api_id"], 12345)
        self.assertEqual(settings["session"], str(Path("~/x/pi-telethon").expanduser()))
        self.assertEqual(settings["chat"], "me")

    def test_missing_telethon_names_the_install_command(self):
        with patch.dict(sys.modules, {"telethon": None}):
            with self.assertRaises(RuntimeError) as ctx:
                daemon.import_telethon()
        self.assertIn("uv pip install telethon", str(ctx.exception))


class TestTelethonListener(unittest.TestCase):
    """The user-session listener against a fake Telethon client."""

    def _listener(self, client, settings=None):
        listener = daemon.TelethonNoteListener(
            MagicMock(),
            settings if settings is not None else {
                "api_id": 12345, "api_hash": "hash", "session": "/tmp/x", "chat": "me",
            },
        )
        client.listener = listener
        listener.client = client  # direct handler tests skip _serve's connect
        for patcher in (
            patch.object(daemon, "import_telethon",
                         return_value=_fake_telethon_module(client)),
            patch.object(daemon, "build_telethon_client", return_value=client),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        return listener

    def test_serve_registers_one_saved_messages_handler(self):
        client = _FakeTelethonClient()
        listener = self._listener(client)
        listener.run()
        self.assertTrue(client.connected)
        self.assertEqual(len(client.handlers), 1)
        self.assertEqual(client.handlers[0][1], ("new-message", {"chats": "me"}))

    def test_unauthorized_session_does_not_retry(self):
        client = _FakeTelethonClient(authorized=False)
        listener = self._listener(client)
        with patch.object(daemon, "log") as log:
            listener.run()
        self.assertTrue(client.disconnected)
        self.assertEqual(client.handlers, [])
        self.assertEqual(client.attempts, 1)
        self.assertTrue(any("--telethon-login" in str(c.args) for c in log.call_args_list))

    def test_start_is_a_no_op_when_settings_are_absent(self):
        listener = daemon.TelethonNoteListener(MagicMock(), settings=None)
        self.assertIsNone(listener.start())

    def test_start_reports_a_half_configured_pair(self):
        with patch.object(daemon, "TELETHON_API_ID", "12345"), \
             patch.object(daemon, "TELETHON_API_HASH", ""), \
             patch.object(daemon, "log") as log:
            self.assertIsNone(daemon.start_telethon_listener(MagicMock()))
        self.assertTrue(any("disabled" in str(c.args) for c in log.call_args_list))

    def test_note_is_answered_in_the_same_chat_and_temp_file_is_removed(self):
        client = _FakeTelethonClient()
        listener = self._listener(client)
        seen = {}

        def fake_answer(pi, audio_path, mime_type, source_note, chat_label, sender, timestamp):
            seen["exists"] = audio_path.exists()
            seen["bytes"] = audio_path.read_bytes()
            seen["mime"] = mime_type
            seen["source"] = source_note
            seen["chat"] = chat_label
            seen["sender"] = sender
            seen["path"] = audio_path
            return "agent reply"

        event = _FakeEvent()
        with patch.object(daemon, "answer_voice_note", side_effect=fake_answer), \
             patch.object(daemon, "log") as log:
            asyncio.run(listener._on_new_message(event))
        self.assertTrue(seen["exists"])
        self.assertEqual(seen["bytes"], b"voice-bytes")
        self.assertEqual(seen["mime"], "audio/ogg")
        self.assertIn("Saved Messages", seen["source"])
        self.assertEqual((seen["chat"], seen["sender"]), ("42", "42"))
        self.assertFalse(seen["path"].exists())
        self.assertEqual(client.sent[0][0], 42)
        self.assertIn("agent reply", client.sent[0][1])
        self.assertEqual(client.sent[0][2], {"parse_mode": "html", "link_preview": False})
        self.assertTrue(
            any("Telethon voice note answered" in str(c.args) for c in log.call_args_list)
        )

    def test_text_note_is_ignored(self):
        client = _FakeTelethonClient()
        listener = self._listener(client)
        event = _FakeEvent(media=None)
        with patch.object(daemon, "answer_voice_note") as answer:
            asyncio.run(listener._on_new_message(event))
        self.assertEqual(event.downloads, 0)
        self.assertFalse(answer.called)
        self.assertEqual(client.sent, [])

    def test_note_failure_answers_in_the_chat(self):
        client = _FakeTelethonClient()
        listener = self._listener(client)
        with patch.object(daemon, "answer_voice_note", side_effect=RuntimeError("no provider")), \
             patch.object(daemon, "log"):
            asyncio.run(listener._on_new_message(_FakeEvent()))
        self.assertEqual(len(client.sent), 1)
        self.assertIn("Pi voice-note error: no provider", client.sent[0][1])

    def test_long_reply_is_chunked(self):
        client = _FakeTelethonClient()
        listener = self._listener(client)
        reply = "\n".join(f"line {n}" for n in range(1, 6))
        with patch.object(daemon, "answer_voice_note", return_value=reply), \
             patch.object(daemon, "MAX_REPLY_CHARS", 10):
            asyncio.run(listener._on_new_message(_FakeEvent()))
        self.assertGreater(len(client.sent), 1)
        joined = "".join(text for _, text, _ in client.sent)
        self.assertEqual(joined.count("line"), reply.count("line"))

    def test_connection_failure_retries_until_stopped(self):
        client = _FakeTelethonClient(connect_error=ConnectionError("network down"))
        listener = self._listener(client)
        with patch.object(daemon, "RETRY_SECONDS", 0.01), patch.object(daemon, "log"):
            thread = threading.Thread(target=listener.run, daemon=True)
            thread.start()
            deadline = time.time() + 2
            while time.time() < deadline and client.attempts < 2:
                time.sleep(0.005)
            listener.stop()
            thread.join(timeout=2)
        self.assertFalse(thread.is_alive())
        self.assertGreaterEqual(client.attempts, 2)
        self.assertEqual(listener.error, "network down")

    def test_session_file_is_owner_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            settings = {"session": str(Path(tmp) / "pi-telethon")}
            session_file = Path(f"{settings['session']}.session")
            session_file.write_bytes(b"auth-key")
            session_file.chmod(0o644)
            daemon.protect_session_file(settings)
            self.assertEqual(session_file.stat().st_mode & 0o777, 0o600)
            # A missing session file is not an error (first connect).
            daemon.protect_session_file({"session": str(Path(tmp) / "absent")})

    def test_voice_note_path_keeps_ogg(self):
        note = Path("/tmp/note.ogg")
        with patch.object(daemon.shutil, "which") as which:
            self.assertEqual(daemon.voice_note_path(note), note)
        which.assert_not_called()

    def test_voice_note_path_transcodes_when_ffmpeg_exists(self):
        with tempfile.TemporaryDirectory() as tmp:
            note = Path(tmp) / "note.m4a"
            note.write_bytes(b"aac")
            expected = Path(tmp) / "note.voice.ogg"

            class _Result:
                returncode = 0

            def fake_run(args, **kwargs):
                Path(args[-1]).write_bytes(b"opus")
                return _Result()

            with patch.object(daemon.shutil, "which", return_value="/usr/bin/ffmpeg"), \
                 patch.object(daemon.subprocess, "run", side_effect=fake_run):
                out = daemon.voice_note_path(note)
            self.assertEqual(out, expected)
            self.assertTrue(expected.exists())

    def test_voice_note_path_without_ffmpeg_or_on_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            note = Path(tmp) / "note.m4a"
            note.write_bytes(b"aac")
            with patch.object(daemon.shutil, "which", return_value=None):
                self.assertIsNone(daemon.voice_note_path(note))

            class _Fail:
                returncode = 1

            with patch.object(daemon.shutil, "which", return_value="/usr/bin/ffmpeg"), \
                 patch.object(daemon.subprocess, "run", return_value=_Fail()), \
                 patch.object(daemon, "log"):
                self.assertIsNone(daemon.voice_note_path(note))
            self.assertEqual(sorted(p.name for p in Path(tmp).iterdir()), ["note.m4a"])

    def test_relay_chat_defaults_to_the_intake_chat(self):
        with patch.object(daemon, "TELETHON_API_ID", "12345"), \
             patch.object(daemon, "TELETHON_API_HASH", "hash"):
            settings = daemon.telethon_settings()
        self.assertEqual(settings["relay_chat"], settings["chat"])
        self.assertEqual(settings["relay_answer"], "inline")

    def test_relay_chat_and_answer_mode_overrides(self):
        with patch.object(daemon, "TELETHON_API_ID", "12345"), \
             patch.object(daemon, "TELETHON_API_HASH", "hash"), \
             patch.object(daemon, "TELETHON_RELAY_CHAT", "@virus_bot"), \
             patch.object(daemon, "TELETHON_RELAY_ANSWER", " bot "):
            settings = daemon.telethon_settings()
        self.assertEqual(settings["relay_chat"], "@virus_bot")
        self.assertEqual(settings["relay_answer"], "bot")
        listener = daemon.TelethonNoteListener(MagicMock(), settings)
        self.assertEqual(listener.chat_label(), "@virus_bot")
        self.assertFalse(listener.answers_inline())

    def test_relay_answer_mode_rejects_unknown_values(self):
        with self.assertRaises(RuntimeError):
            daemon._relay_answer_mode("sometimes")

    def test_own_uploads_are_not_answered_again(self):
        listener = self._listener(_FakeTelethonClient())
        event = MagicMock(out=True, voice=MagicMock(), chat_id=42)
        with patch.object(daemon, "log"):
            asyncio.run(listener._on_new_message(event))
        self.assertFalse(event.download_media.called)

    def test_relay_uploads_the_note_into_the_intake_chat(self):
        client = _FakeTelethonClient()
        listener = self._listener(client)
        with tempfile.TemporaryDirectory() as tmp:
            note = Path(tmp) / "note.m4a"
            note.write_bytes(b"note-bytes")
            with patch.object(daemon, "voice_note_path", return_value=None), \
                 patch.object(daemon, "log"):
                self.assertTrue(asyncio.run(listener._upload(note)))
        self.assertEqual(client.files[0][0], "me")
        self.assertEqual(client.files[0][1], b"note-bytes")
        self.assertEqual(client.files[0][2], {"voice_note": True})

    def test_relay_falls_back_to_audio_when_voice_is_rejected(self):
        client = _FakeTelethonClient()
        client.reject_voice = True
        listener = self._listener(client)
        with tempfile.TemporaryDirectory() as tmp:
            note = Path(tmp) / "note.m4a"
            note.write_bytes(b"note-bytes")
            with patch.object(daemon, "log"):
                self.assertTrue(asyncio.run(listener._upload(note)))
        self.assertEqual(len(client.files), 2)
        self.assertEqual(client.files[1][2], {})
    def test_relay_text_is_chunked_through_the_user_session(self):
        client = _FakeTelethonClient()
        listener = self._listener(client)
        with patch.object(daemon, "MAX_REPLY_CHARS", 10):
            self.assertTrue(asyncio.run(listener._send_chunks(daemon.chunk_reply("line 1\nline 2\nline 3"))))
        self.assertGreater(len(client.sent), 1)
        self.assertTrue(all(chat_id == "me" for chat_id, _, _ in client.sent))

    def test_relay_is_unavailable_without_a_connected_client(self):
        listener = daemon.TelethonNoteListener(MagicMock(), settings=None)
        self.assertFalse(listener.send_voice_note(Path("/tmp/nope.m4a")))

    def test_login_requires_credentials(self):
        with patch.object(daemon, "TELETHON_API_ID", ""), \
             patch.object(daemon, "TELETHON_API_HASH", ""), \
             patch.object(daemon, "log"):
            self.assertEqual(daemon.telethon_login(), 2)

    def test_login_authorizes_the_session_file(self):
        client = _FakeTelethonClient()
        started = []

        async def fake_start():
            started.append(True)

        client.start = fake_start
        with patch.object(daemon, "TELETHON_API_ID", "12345"), \
             patch.object(daemon, "TELETHON_API_HASH", "hash"), \
             patch.object(daemon, "build_telethon_client", return_value=client), \
             patch.object(daemon, "log"):
            self.assertEqual(daemon.telethon_login(), 0)
        self.assertEqual(started, [True])
        self.assertTrue(client.disconnected)

    def test_main_starts_the_listener(self):
        with patch.object(daemon, "BOT_TOKEN", "test-token"), \
             patch.object(daemon, "ALLOWED_CHATS", {"123"}), \
             patch.object(daemon, "fetch_bot_identity"), \
             patch.object(daemon, "load_state", return_value={"last_update_id": 0}), \
             patch.object(daemon, "save_state"), \
             patch.object(daemon, "start_shortcut_listener"), \
             patch.object(daemon, "start_telethon_listener") as start_telethon, \
             patch.object(daemon, "PiRPC"), \
             patch.object(daemon, "fetch_updates", side_effect=SystemExit(0)):
            with self.assertRaises(SystemExit):
                daemon.main()
        start_telethon.assert_called_once()


if __name__ == "__main__":
    unittest.main(verbosity=2)