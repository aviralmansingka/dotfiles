"""Offline fixture tests for the ccgram Pi transcript-binding patch.

Reproduces the reused-directory / off-by-one race: Pi's SessionStart hook
for session B fires while only session A's transcript exists in the shared
session directory. Expected: ccgram NEVER binds B to A; B stays pending and
binds its own transcript once the file appears, with a clean (reset) read
offset — no mid-file corruption and no stale replay of A.

Runs against a THROWAWAY COPY of the installed ccgram package with the
tracked patch stack applied (the live uv tool is never touched). Requires
the ccgram uv tool's python — validate.sh invokes this with
`~/.local/share/uv/tools/ccgram/bin/python`. No tmux/Herdr/Telegram calls
are made: the monitor's multiplexer lookup is stubbed and HOME is
redirected to a temp dir per test.

Coverage:
  1. hook._resolve_pi_transcript_path / _resolve_transcript_path: exact
     session-id match only — defer ("") while only A exists, refuse a
     mismatched payload transcript, resolve B once B's file appears.
  2. SessionMonitor.check_for_updates: a pending Pi session (empty
     transcript_path) is not bound to A, then binds B's file on a later
     poll with a fresh offset, and new content flows.
  3. TranscriptReader: when a session's transcript path changes, the stale
     tracked offset is dropped and the session rebinds fresh (no corrupted
     offset, no replay of the previous file).
  4. session_map._prefer_existing_primary: the nested-session primary
     preservation no longer pins a Pi window to the prior tenant, while
     the claude preservation behavior is unchanged.
  5. Shim: find_transcript waits for the exact *_<session_id>.jsonl file
     and never returns a prior tenant's transcript.
"""

from __future__ import annotations

import asyncio
import glob
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

PKG_DIR = Path(__file__).resolve().parent.parent
# Patch stack, in apply order.
PATCH_FILES = [
    PKG_DIR / "patches" / "ccgram-4.5.2-pi-renderer-parity.patch",
    PKG_DIR / "patches" / "ccgram-4.5.2-low-noise-notifications.patch",
    PKG_DIR / "patches" / "ccgram-4.5.2-pi-transcript-binding.patch",
]
SHIM = PKG_DIR / ".local" / "bin" / "ccgram-pi-hook"

# ccgram.config constructs at import time and requires a token; give it a
# placeholder (never used — no Bot API calls happen here).
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "0:offline-fixture-placeholder")
os.environ.setdefault("ALLOWED_USERS", "123")

LEASE_CWD = "/tmp/lease"
SID_A = "aaaaaaaa-1111-2222-3333-444444444444"
SID_B = "bbbbbbbb-5555-6666-7777-888888888888"


def _find_site_packages() -> Path:
    candidates = glob.glob(
        os.path.expanduser("~/.local/share/uv/tools/ccgram/lib/python*/site-packages")
    )
    for cand in candidates:
        if (Path(cand) / "ccgram").is_dir():
            return Path(cand)
    raise unittest.SkipTest("ccgram uv tool not installed; cannot run patch tests")


def _prepare_patched_copy() -> Path:
    """Copy the installed ccgram package to a temp dir and apply the stack."""
    sp = _find_site_packages()
    tmp = Path(tempfile.mkdtemp(prefix="ccgram-patched-binding-"))
    shutil.copytree(
        sp / "ccgram",
        tmp / "ccgram",
        ignore=shutil.ignore_patterns("__pycache__"),
    )

    def renderer_parity_applied(root: Path) -> bool:
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

    def transcript_binding_applied(root: Path) -> bool:
        hook = (root / "ccgram/hook.py").read_text(encoding="utf-8")
        pi = (root / "ccgram/providers/pi.py").read_text(encoding="utf-8")
        reader = (root / "ccgram/transcript_reader.py").read_text(encoding="utf-8")
        return (
            "Refusing Pi transcript path" in hook
            and "def resolve_session_transcript" in pi
            and "Transcript path changed for session" in reader
        )

    marker_checks = [
        renderer_parity_applied,
        low_noise_applied,
        transcript_binding_applied,
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


def _session_dir(home: Path) -> Path:
    return home / ".pi" / "agent" / "sessions" / "--tmp-lease--"


def _write_transcript(path: Path, session_id: str, texts: list[str]) -> None:
    """Write a minimal Pi v3 JSONL transcript: header + user/assistant turns."""
    lines = [
        json.dumps(
            {"type": "session", "id": session_id, "cwd": LEASE_CWD, "version": 3}
        )
    ]
    for i, text in enumerate(texts):
        role = "user" if i % 2 == 0 else "assistant"
        message: dict = {"role": role, "content": [{"type": "text", "text": text}]}
        if role == "assistant":
            message["stopReason"] = "stop"
        lines.append(
            json.dumps(
                {
                    "type": "message",
                    "timestamp": f"2026-08-16T00:00:{i:02d}Z",
                    "message": message,
                }
            )
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


class TranscriptBindingTest(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = _prepare_patched_copy()
        sys.path.insert(0, str(cls.tmp))
        for mod in list(sys.modules):
            if mod == "ccgram" or mod.startswith("ccgram."):
                del sys.modules[mod]

        from ccgram import hook
        from ccgram import session_map
        from ccgram.monitor_state import TrackedSession
        from ccgram.session_monitor import SessionMonitor
        from ccgram.window_state_store import (
            WindowStateStore,
            install_window_store,
        )

        cls.hook = hook
        cls.session_map = session_map
        cls.TrackedSession = TrackedSession
        cls.SessionMonitor = SessionMonitor
        cls.WindowStateStore = WindowStateStore
        cls.install_window_store = install_window_store

    @classmethod
    def tearDownClass(cls) -> None:
        sys.path.remove(str(cls.tmp))
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def setUp(self) -> None:
        # Redirect HOME so Path.home()-based session-dir lookups land in a
        # per-test temp dir; seed it with only transcript A (prior tenant).
        self.home = Path(tempfile.mkdtemp(prefix="ccgram-binding-home-"))
        self._old_home = os.environ.get("HOME")
        os.environ["HOME"] = str(self.home)
        session_dir = _session_dir(self.home)
        session_dir.mkdir(parents=True)
        self.a_path = session_dir / f"2026-08-15T21-00-00-000Z_{SID_A}.jsonl"
        _write_transcript(
            self.a_path, SID_A, ["previous tenant brief", "previous tenant final"]
        )
        self.b_path = session_dir / f"2026-08-15T21-05-00-000Z_{SID_B}.jsonl"
        # Wire an empty window store so primary-preservation code paths run.
        # (call via type(): plain functions stored as class attrs would bind)
        type(self).install_window_store(
            self.WindowStateStore(
                schedule_save=lambda: None,
                on_hookless_provider_switch=lambda window_id: None,
            )
        )

    def tearDown(self) -> None:
        if self._old_home is None:
            os.environ.pop("HOME", None)
        else:
            os.environ["HOME"] = self._old_home
        shutil.rmtree(self.home, ignore_errors=True)

    def _make_monitor(self) -> "SessionMonitor":
        monitor = self.SessionMonitor(
            projects_path=self.home / "no-projects",
            poll_interval=1.0,
            state_file=self.home / "monitor_state.json",
        )

        async def _no_active_cwds() -> set:
            return set()

        # No multiplexer in tests: the cwd-fallback discovery scan is a no-op.
        monitor._get_active_cwds = _no_active_cwds
        return monitor

    def _pending_map(self) -> dict:
        return {
            "w1": {
                "session_id": SID_B,
                "cwd": LEASE_CWD,
                "transcript_path": "",
                "provider_name": "pi",
                "window_name": "w1",
            }
        }

    # ── 1. Hook resolver: exact match only ───────────────────────────────

    def test_hook_resolver_defers_while_only_prior_transcript_exists(self):
        self.assertEqual(self.hook._resolve_pi_transcript_path(SID_B, LEASE_CWD), "")
        # A payload transcript that names a different session is refused too.
        self.assertEqual(
            self.hook._resolve_transcript_path(
                "pi", SID_B, LEASE_CWD, str(self.a_path)
            ),
            "",
        )

    def test_hook_resolver_binds_exact_file_once_it_appears(self):
        _write_transcript(self.b_path, SID_B, ["worker B brief"])
        self.assertEqual(
            self.hook._resolve_pi_transcript_path(SID_B, LEASE_CWD), str(self.b_path)
        )
        # Exact payload path is accepted.
        self.assertEqual(
            self.hook._resolve_transcript_path(
                "pi", SID_B, LEASE_CWD, str(self.b_path)
            ),
            str(self.b_path),
        )
        # Stale payload path is overridden by the exact on-disk match.
        self.assertEqual(
            self.hook._resolve_transcript_path(
                "pi", SID_B, LEASE_CWD, str(self.a_path)
            ),
            str(self.b_path),
        )

    # ── 2. Monitor: pending session never binds A, then binds B ──────────

    async def test_monitor_pending_session_never_binds_prior_transcript(self):
        monitor = self._make_monitor()

        # Poll 1: SessionStart for B deferred (only A exists) — no binding.
        messages = await monitor.check_for_updates(self._pending_map())
        self.assertEqual(messages, [])
        self.assertIsNone(monitor.state.get_session(SID_B))

        # B's transcript appears (as Pi creates it, ~4s later live).
        _write_transcript(self.b_path, SID_B, ["worker B brief"])

        # Poll 2: pending resolution binds B's own file with a clean offset.
        messages = await monitor.check_for_updates(self._pending_map())
        tracked = monitor.state.get_session(SID_B)
        self.assertIsNotNone(tracked, "pending Pi session did not bind its file")
        self.assertEqual(tracked.file_path, str(self.b_path))
        # Clean start: offset belongs to B's file, never carried over from A.
        self.assertEqual(tracked.last_byte_offset, self.b_path.stat().st_size)
        for msg in messages:
            self.assertNotIn("previous tenant", msg.text)

        # New content in B flows to the topic.
        with self.b_path.open("a", encoding="utf-8") as fh:
            fh.write(
                json.dumps(
                    {
                        "type": "message",
                        "timestamp": "2026-08-15T21:05:30Z",
                        "message": {
                            "role": "assistant",
                            "content": [{"type": "text", "text": "worker B final"}],
                            "stopReason": "stop",
                        },
                    }
                )
                + "\n"
            )
        messages = await monitor.check_for_updates(self._pending_map())
        self.assertIn("worker B final", [m.text for m in messages])

    # ── 3. Offset reset when a session's transcript path changes ─────────

    async def test_offset_reset_on_transcript_path_change(self):
        monitor = self._make_monitor()
        # Pre-patch state reproduced: B tracked against A's file at A's EOF.
        a_size = self.a_path.stat().st_size
        monitor.state.update_session(
            self.TrackedSession(
                session_id=SID_B,
                file_path=str(self.a_path),
                last_byte_offset=a_size,
            )
        )
        monitor._file_mtimes[SID_B] = self.a_path.stat().st_mtime

        # B's real file appears, SHORTER than the stale offset — the exact
        # case that used to fire "File truncated… Resetting" + full replay.
        _write_transcript(self.b_path, SID_B, ["worker B brief"])
        self.assertLess(self.b_path.stat().st_size, a_size)

        bound_map = self._pending_map()
        bound_map["w1"]["transcript_path"] = str(self.b_path)
        messages = await monitor.check_for_updates(bound_map)

        tracked = monitor.state.get_session(SID_B)
        self.assertIsNotNone(tracked)
        self.assertEqual(tracked.file_path, str(self.b_path))
        # Fresh rebind: offset reset to B's clean start, not A's stale EOF.
        self.assertEqual(tracked.last_byte_offset, self.b_path.stat().st_size)
        # No replay of the previous tenant's transcript into the topic.
        for msg in messages:
            self.assertNotIn("previous tenant", msg.text)

    # ── 4. Primary preservation no longer pins Pi windows ────────────────

    def test_primary_preservation_skipped_for_pi(self):
        from ccgram.window_state_store import window_store

        state = window_store.get_window_state("w1")
        state.session_id = SID_A
        state.cwd = LEASE_CWD
        state.transcript_path = str(self.a_path)
        state.provider_name = "pi"
        # A's transcript is "fresh" so the nested-session preservation WOULD
        # fire for a claude window; for pi it must not pin the prior tenant.
        incoming = {
            "session_id": SID_B,
            "cwd": LEASE_CWD,
            "transcript_path": "",
            "provider_name": "pi",
            "window_name": "w1",
        }
        self.assertIsNone(self.session_map._prefer_existing_primary("w1", incoming))

    def test_primary_preservation_still_applies_for_claude(self):
        from ccgram.window_state_store import window_store

        state = window_store.get_window_state("w2")
        state.session_id = SID_A
        state.cwd = LEASE_CWD
        state.transcript_path = str(self.a_path)
        state.provider_name = "claude"
        incoming = {
            "session_id": SID_B,
            "cwd": LEASE_CWD,
            "transcript_path": "",
            "provider_name": "claude",
            "window_name": "w2",
        }
        preferred = self.session_map._prefer_existing_primary("w2", incoming)
        self.assertIsNotNone(preferred, "claude nested-session preservation regressed")
        self.assertEqual(preferred["session_id"], SID_A)

    # ── 5. Shim: exact-match wait, never a prior tenant ──────────────────

    def _load_shim(self):
        from importlib.machinery import SourceFileLoader

        loader = SourceFileLoader("ccgram_pi_hook", str(SHIM))
        spec = importlib.util.spec_from_loader("ccgram_pi_hook", loader)
        module = importlib.util.module_from_spec(spec)
        loader.exec_module(module)
        return module

    def test_shim_never_returns_prior_tenant_transcript(self):
        shim = self._load_shim()
        # Only A exists and the deadline expires: empty, not A.
        start = time.monotonic()
        self.assertEqual(shim.find_transcript(LEASE_CWD, SID_B, 0.4), "")
        self.assertGreaterEqual(time.monotonic() - start, 0.35)

    def test_shim_returns_exact_transcript_once_present(self):
        shim = self._load_shim()
        _write_transcript(self.b_path, SID_B, ["worker B brief"])
        self.assertEqual(
            shim.find_transcript(LEASE_CWD, SID_B, 1.0), str(self.b_path)
        )

    def test_shim_ignores_empty_exact_file_until_written(self):
        shim = self._load_shim()
        self.b_path.touch()  # created but not yet written
        self.assertEqual(shim.find_transcript(LEASE_CWD, SID_B, 0.3), "")
        _write_transcript(self.b_path, SID_B, ["worker B brief"])
        self.assertEqual(
            shim.find_transcript(LEASE_CWD, SID_B, 0.5), str(self.b_path)
        )


if __name__ == "__main__":
    unittest.main()
