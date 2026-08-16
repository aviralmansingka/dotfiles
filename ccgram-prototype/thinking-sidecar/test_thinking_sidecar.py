#!/usr/bin/env python3
"""Offline unit tests for the ccgram thinking sidecar (stdlib unittest, no Telegram).

Run from the repo root:  python3 -m unittest discover -s ccgram-prototype/thinking-sidecar -v
(also wired into ccgram-prototype/validate.sh)
"""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE.parent / ".local" / "bin" / "ccgram-thinking-sidecar"
FIXTURES = HERE / "fixtures"

# The sidecar ships extensionless for ~/.local/bin; load it explicitly as source.
from importlib.machinery import SourceFileLoader

_loader = SourceFileLoader("thinking_sidecar", str(SCRIPT))
spec = importlib.util.spec_from_loader("thinking_sidecar", _loader)
ts = importlib.util.module_from_spec(spec)
sys.modules["thinking_sidecar"] = ts  # dataclass needs __module__ resolvable
_loader.exec_module(ts)


def fixture_lines() -> list[str]:
    return (FIXTURES / "sample_pi_session.jsonl").read_text().splitlines()


class FakeClient:
    """Records Telegram calls instead of performing them."""

    def __init__(self) -> None:
        self.calls: list[tuple] = []
        self._next_id = 100

    def send_message(self, chat_id: int, thread_id: int, text: str):
        self._next_id += 1
        self.calls.append(("send", chat_id, thread_id, text))
        return self._next_id

    def edit_message(self, chat_id: int, message_id: int, text: str):
        self.calls.append(("edit", chat_id, message_id, text))
        return True

    def delete_message(self, chat_id: int, message_id: int):
        self.calls.append(("delete", chat_id, message_id))
        return True


def make_sidecar(client, tmp: Path, **kw):
    kw.setdefault("edit_min_secs", 0.0)
    kw.setdefault("idle_delete_secs", 600.0)
    return ts.Sidecar(client, state_dir=tmp, **kw)


def feed_fixture(sidecar: ts.Sidecar, chat: int = -1001, thread: int = 46) -> None:
    for line in fixture_lines():
        event = ts.parse_transcript_line(line)
        if event is not None:
            sidecar.handle_event(chat, thread, event)
        sidecar.flush()


class ParseTests(unittest.TestCase):
    def test_thinking_blocks_extracted_as_steps(self):
        events = [ts.parse_transcript_line(ln) for ln in fixture_lines()]
        thinking = [e for e in events if e and e["kind"] == "thinking"]
        # m2, m4 and m8 carry thinking blocks; m4/m6 also carry text so they
        # classify differently (see below).
        kinds = [(e or {}).get("kind") for e in events]
        self.assertEqual(
            kinds,
            [None, None, "user", "thinking", None, "thinking", None, "final", "user", "error"],
        )
        self.assertEqual(thinking[0]["steps"], ["Let me look at demo.py first."])
        self.assertEqual(thinking[1]["steps"], ["Found it: the slice drops the last element."])

    def test_mid_turn_text_with_tooluse_is_not_final(self):
        # m4 has thinking + text + toolCall with stopReason "toolUse": the turn
        # is still in flight, so the temp trace must survive.
        event = ts.parse_transcript_line(fixture_lines()[5])
        self.assertEqual(event["kind"], "thinking")

    def test_final_requires_text(self):
        event = ts.parse_transcript_line(fixture_lines()[7])
        self.assertEqual(event["kind"], "final")

    def test_error_event(self):
        # m8 carries a thinking block too, but an error stopReason ends the
        # turn: the sidecar treats it as "delete the trace".
        event = ts.parse_transcript_line(fixture_lines()[9])
        self.assertEqual(event["kind"], "error")

    def test_garbage_and_non_message_lines_ignored(self):
        self.assertIsNone(ts.parse_transcript_line("not json"))
        self.assertIsNone(ts.parse_transcript_line('{"type":"session"}'))
        self.assertIsNone(ts.parse_transcript_line(fixture_lines()[4]))  # toolResult


class RenderTests(unittest.TestCase):
    def test_tree_shape(self):
        text = ts.render_tree(["step one", "step two"], max_steps=8)
        lines = text.splitlines()
        self.assertTrue(lines[0].startswith("\U0001f9e0 Thinking"))
        self.assertEqual(lines[1], "\u251c\u2500 step one")
        self.assertEqual(lines[2], "\u251c\u2500 step two")
        self.assertIn("still thinking", lines[3])

    def test_overflow_shows_earlier_step_count(self):
        steps = [f"step {i}" for i in range(12)]
        text = ts.render_tree(steps, max_steps=8)
        self.assertIn("(4 earlier steps)", text)
        self.assertIn("step 11", text)
        self.assertNotIn("step 3\n", text)

    def test_first_line_collapses_and_truncates(self):
        self.assertEqual(ts._first_line("  hello   world \nsecond"), "hello world")
        long_line = "x" * 500
        self.assertLessEqual(len(ts._first_line(long_line)), ts.STEP_MAX_CHARS)


class TargetTests(unittest.TestCase):
    def test_load_targets_maps_pi_topics_only(self):
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            transcript = tmp / "session.jsonl"
            transcript.write_text("\n".join(fixture_lines()))
            raw = json.loads((FIXTURES / "sample_state.json").read_text())
            raw["window_states"]["herdr-session-v1-aaaa"]["transcript_path"] = str(transcript)
            state = tmp / "state.json"
            state.write_text(json.dumps(raw))

            targets = ts.load_targets(state, group_id=-1001234567890)
            self.assertEqual(targets, {(-1001234567890, 46): str(transcript)})

            # Without a group filter, the other chat binding for the same Pi
            # window is included; the claude window never is.
            targets = ts.load_targets(state, group_id=None)
            self.assertEqual(len(targets), 2)
            self.assertNotIn((-1001234567890, 47), targets)

    def test_missing_state_file_yields_no_targets(self):
        self.assertEqual(ts.load_targets(Path("/nonexistent/state.json"), None), {})


class TailerTests(unittest.TestCase):
    def test_replay_reads_history_and_follows_appends(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "s.jsonl"
            lines = fixture_lines()
            path.write_text("\n".join(lines[:3]) + "\n")
            tailer = ts.Tailer(str(path), replay=True)
            self.assertEqual(len(tailer.read_new_lines()), 3)
            self.assertEqual(tailer.read_new_lines(), [])
            with path.open("a") as fh:
                fh.write(lines[3] + "\n")
            self.assertEqual(tailer.read_new_lines(), [lines[3]])

    def test_live_mode_starts_at_eof(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "s.jsonl"
            path.write_text("\n".join(fixture_lines()) + "\n")
            tailer = ts.Tailer(str(path), replay=False)
            self.assertEqual(tailer.read_new_lines(), [])

    def test_partial_line_buffered_until_newline(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "s.jsonl"
            path.write_text("")
            tailer = ts.Tailer(str(path), replay=True)
            line = fixture_lines()[2]
            with path.open("a") as fh:
                fh.write(line[:40])
            self.assertEqual(tailer.read_new_lines(), [])
            with path.open("a") as fh:
                fh.write(line[40:] + "\n")
            self.assertEqual(tailer.read_new_lines(), [line])


class SidecarFlowTests(unittest.TestCase):
    def test_full_turn_send_edit_delete(self):
        with tempfile.TemporaryDirectory() as td:
            client = FakeClient()
            sidecar = make_sidecar(client, Path(td))
            feed_fixture(sidecar)
            kinds = [c[0] for c in client.calls]
            # Turn 1: one send, one rate-limited edit, one delete on final.
            # Turn 2: a lone error event has no live trace, so it is a no-op.
            self.assertEqual(kinds, ["send", "edit", "delete"])
            send_text = client.calls[0][3]
            self.assertIn("Let me look at demo.py first.", send_text)
            edit_text = client.calls[1][3]
            self.assertIn("Found it: the slice drops the last element.", edit_text)
            # The delete targets the message id returned by the send.
            self.assertEqual(client.calls[2][2], 101)

    def test_error_deletes_live_trace(self):
        with tempfile.TemporaryDirectory() as td:
            client = FakeClient()
            sidecar = make_sidecar(client, Path(td))
            sidecar.handle_event(-1, 1, {"kind": "thinking", "steps": ["hmm"]})
            sidecar.handle_event(-1, 1, {"kind": "error"})
            self.assertEqual([c[0] for c in client.calls], ["send", "delete"])
            self.assertEqual(sidecar.runtimes, {})

    def test_edit_coalescing_respects_min_interval(self):
        with tempfile.TemporaryDirectory() as td:
            client = FakeClient()
            sidecar = make_sidecar(client, Path(td), edit_min_secs=60.0)
            feed_fixture(sidecar)
            kinds = [c[0] for c in client.calls]
            self.assertNotIn("edit", kinds)  # cooled down; deletes still happen
            self.assertEqual(kinds, ["send", "delete"])

    def test_idle_sweep_deletes_orphan(self):
        with tempfile.TemporaryDirectory() as td:
            client = FakeClient()
            sidecar = make_sidecar(client, Path(td), idle_delete_secs=5.0)
            sidecar.handle_event(-1, 1, {"kind": "thinking", "steps": ["hmm"]})
            rt = sidecar.runtimes[(-1, 1)]
            rt.last_activity = time.monotonic() - 10.0
            sidecar.sweep_idle()
            self.assertEqual([c[0] for c in client.calls], ["send", "delete"])
            self.assertEqual(sidecar.runtimes, {})

    def test_state_roundtrip_restores_message_for_cleanup(self):
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            client = FakeClient()
            sidecar = make_sidecar(client, tmp)
            sidecar.handle_event(-1, 7, {"kind": "thinking", "steps": ["persist me"]})
            self.assertTrue(sidecar.state_path.is_file())
            revived = make_sidecar(client, tmp)
            rt = revived.runtimes[(-1, 7)]
            self.assertEqual(rt.message_id, 101)
            self.assertEqual(rt.steps, ["persist me"])
            rt.last_activity = time.monotonic() - 9999
            revived.sweep_idle()
            self.assertEqual(client.calls[-1][0], "delete")

    def test_final_without_message_is_noop(self):
        with tempfile.TemporaryDirectory() as td:
            client = FakeClient()
            sidecar = make_sidecar(client, Path(td))
            sidecar.handle_event(-1, 1, {"kind": "final"})
            self.assertEqual(client.calls, [])


if __name__ == "__main__":
    unittest.main()
