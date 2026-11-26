"""The single AeroSpace hook line calls the profile program, not a repo path."""

from __future__ import annotations

import tomllib
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
CONFIG = REPO / "aerospace" / ".aerospace.toml"
SHIM = REPO / "tasktrace" / "bin" / "tasktrace-hook"

EXPECTED = "exec-and-forget tasktrace-hook focus"


def config() -> dict:
    return tomllib.loads(CONFIG.read_text())


def test_config_still_parses():
    parsed = config()
    assert parsed["start-at-login"] is True
    assert parsed["on-focused-monitor-changed"] == ["move-mouse monitor-lazy-center"]


def test_exactly_one_hook_line_was_added():
    text = CONFIG.read_text()
    assert text.count("tasktrace-hook") == 1
    assert [line for line in text.splitlines() if "tasktrace" in line] == [
        f"on-focus-changed = ['{EXPECTED}']"
    ]


def test_hook_line_names_the_profile_program_and_the_focus_entry_point():
    assert config()["on-focus-changed"] == [EXPECTED]
    assert EXPECTED.split(" ")[1] == "tasktrace-hook"


def test_the_hook_line_carries_no_repo_path():
    # AeroSpace runs hooks with PATH=/usr/bin:/bin:/usr/sbin:/sbin, so the only
    # thing a config line may name is the program the profile installs.
    for forbidden in ("$HOME", "/Users", "dotfiles", "tasktrace/bin", "uv"):
        assert forbidden not in EXPECTED


def test_the_dev_shim_forwards_to_the_hook_command():
    text = SHIM.read_text()
    assert "tasktrace hook" in text
    assert 'entry="${1:-focus}"' in text or 'entry="focus"' in text
    assert 'exec "$uv" run --quiet --project "$repo" tasktrace hook' in text
    assert SHIM.is_file()
    assert SHIM.stat().st_mode & 0o111


def test_the_dev_shim_finds_uv_without_a_login_shell():
    text = SHIM.read_text()
    assert "/nix-profile/bin/uv" in text or "$HOME/.nix-profile/bin/uv" in text
    assert "command -v uv" in text


def test_other_aerospace_keys_are_untouched():
    parsed = config()
    assert parsed["accordion-padding"] == 20
    assert parsed["enable-normalization-flatten-containers"] is False
    assert parsed["mode"]["main"]["binding"]["alt-1"] == "workspace 1"
    assert parsed["on-window-detected"] == [{"if": {"app-id": "com.mitchellh.ghostty"}, "run": ["layout tiling"]}]
