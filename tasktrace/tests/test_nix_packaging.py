"""The hook ships from the nix profile: one path on PATH, no repo path, no `uv`.

These are the packaging facts the AeroSpace config depends on. They read the
declarative files, so they hold without a nix build or a running AeroSpace.
"""

from __future__ import annotations

import tomllib
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
CONFIG = REPO / "aerospace" / ".aerospace.toml"
PKG = REPO / "nix" / "pkgs" / "tasktrace.nix"
SHARED = REPO / "nix" / "modules" / "shared" / "default.nix"


def test_the_aerospace_hook_line_is_a_bare_program_name():
    lines = [line for line in CONFIG.read_text().splitlines() if "tasktrace" in line]
    assert lines == ["on-focus-changed = ['exec-and-forget tasktrace-hook focus']"]
    assert "$HOME" not in lines[0]
    assert "/" not in lines[0].split("exec-and-forget ", 1)[1]
    # The line still parses as one AeroSpace command list.
    assert tomllib.loads(CONFIG.read_text())["on-focus-changed"] == [
        "exec-and-forget tasktrace-hook focus"
    ]


def test_the_derivation_exists_and_names_both_programs():
    text = PKG.read_text()
    assert 'name = "tasktrace";' in text
    assert 'name = "tasktrace-hook";' in text
    # Both names come out of one derivation, so a profile switch installs both.
    assert "symlinkJoin" in text
    assert text.count("paths = [") == 1


def test_the_derivation_follows_the_tb_vim_pattern():
    text = PKG.read_text()
    assert "writeShellApplication" in text
    assert "runtimeInputs = [ python3 ]" in text
    assert "../../tasktrace" in text
    assert 'PYTHONPATH="${src}/src"' in text
    # stdlib only: the wrapper never shells out to uv.
    assert '${uv}' not in text and "uv run --project" not in text


def test_the_hook_wrapper_passes_entry_and_args_through():
    hook = PKG.read_text().split('name = "tasktrace-hook"', 1)[1]
    assert "if [ \"$#\" -eq 0 ]" in hook
    assert "set -- focus" in hook
    assert 'exec ${python3}/bin/python3 -m tasktrace hook "$@"' in hook


def test_the_shared_module_declares_the_package_like_tb_vim():
    text = SHARED.read_text()
    assert "tasktrace = pkgs.callPackage ../../pkgs/tasktrace.nix { };" in text
    declared = text.split("home.packages =", 1)[1]
    assert "tb-vim" in declared.split("++", 1)[0]
    assert "tasktrace" in declared.split("++", 1)[0]


def test_the_console_scripts_match_the_two_program_names():
    project = tomllib.loads((REPO / "tasktrace" / "pyproject.toml").read_text())
    assert sorted(project["project"]["scripts"]) == ["tasktrace", "tasktrace-hook"]
    assert project["build-system"]["build-backend"] == "uv_build"
