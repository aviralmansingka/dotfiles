"""The nine hook entry points and their AeroSpace field mapping."""

from __future__ import annotations

import pytest

from tasktrace import hooks

NINE = ["app", "binding", "focus", "login", "mode", "monitor", "startup", "window", "workspace"]


def test_there_are_exactly_nine_entry_points():
    assert sorted(hooks.HOOKS) == NINE
    assert len(hooks.HOOKS) == 9


def test_every_entry_point_documents_a_paste_line():
    for hook in hooks.HOOKS.values():
        assert "tasktrace-hook" in hook.line
        assert hook.surface
        assert hook.kind in ("app", "ws", "monitor", "mode", "window", "boot", "bind")


def test_eight_entries_use_exec_and_forget_and_one_explains_why_it_cannot():
    exec_entries = [hook for hook in hooks.HOOKS.values() if "exec-and-forget" in hook.line]
    assert len(exec_entries) == 8
    workspace = hooks.HOOKS["workspace"]
    assert "exec-and-forget" not in workspace.line
    assert "/bin/sh" in workspace.line
    assert "cannot" in workspace.note


def test_focus_maps_app_and_workspace_from_one_line():
    event = hooks.build_event(
        "focus",
        {
            "AEROSPACE_FOCUSED_WORKSPACE": "A",
            "AEROSPACE_FOCUSED_WINDOW_ID": "42",
        },
        frontmost=("Ghostty", "com.mitchellh.ghostty"),
        ws="A",
        idle_s=12.5,
    )
    assert event.kind == "app"
    assert event.source == "aerospace"
    assert event.ws == "A"
    assert event.app == "Ghostty"
    assert event.bundle == "com.mitchellh.ghostty"
    assert event.idle_s == 12.5
    assert event.detail == {"hook": "focus", "window_id": "42"}


def test_empty_workspace_switch_is_recorded_without_an_app():
    event = hooks.build_event("focus", {"AEROSPACE_WORKSPACE": "B"}, frontmost=(None, None))
    assert (event.kind, event.ws, event.app) == ("app", "B", None)


def test_probed_workspace_is_used_when_aero_space_only_sends_a_window_id():
    event = hooks.build_event(
        "focus",
        {"AEROSPACE_WINDOW_ID": "8749"},
        frontmost=("Rex Beta", "com.superlogical.rex"),
        ws="1",
    )
    assert event.ws == "1"
    assert event.detail["window_id"] == "8749"


def test_env_workspace_wins_over_the_probe():
    event = hooks.build_event(
        "focus",
        {"AEROSPACE_FOCUSED_WORKSPACE": "A"},
        ws="B",
    )
    assert event.ws == "A"


def test_workspace_switch_keeps_the_previous_workspace():
    event = hooks.build_event(
        "workspace",
        {
            "AEROSPACE_FOCUSED_WORKSPACE": "B",
            "AEROSPACE_PREV_WORKSPACE": "A",
        },
        frontmost=("Ghostty", "com.mitchellh.ghostty"),
    )
    assert event.kind == "ws"
    assert event.ws == "B"
    assert event.detail == {"hook": "workspace", "prev_ws": "A"}
    assert event.app == "Ghostty"


def test_env_override_wins_over_the_probe():
    event = hooks.build_event(
        "app",
        {"TASKTRACE_APP": "Rex Beta", "TASKTRACE_BUNDLE": "com.superlogical.rex"},
        frontmost=("Finder", "com.apple.finder"),
    )
    assert (event.app, event.bundle) == ("Rex Beta", "com.superlogical.rex")


@pytest.mark.parametrize(
    "name,kind",
    [
        ("monitor", "monitor"),
        ("mode", "mode"),
        ("window", "window"),
        ("startup", "boot"),
        ("login", "boot"),
        ("binding", "bind"),
        ("app", "app"),
    ],
)
def test_entry_point_kinds(name, kind):
    event = hooks.build_event(name, {}, label="alt-1")
    assert event.kind == kind
    assert event.detail["hook"] == name
    assert event.detail["label"] == "alt-1"


def test_only_documented_aero_space_variables_are_read():
    # AeroSpace documents exactly four: WINDOW_ID, WORKSPACE, FOCUSED_WORKSPACE,
    # PREV_WORKSPACE.  Anything else must not leak into the row as fake context.
    event = hooks.build_event("mode", {"AEROSPACE_MODE": "service", "AEROSPACE_MONITOR": "main"})
    assert event.detail == {"hook": "mode"}
    assert event.ws is None


def test_unknown_entry_point_is_refused():
    with pytest.raises(KeyError):
        hooks.build_event("hotkey", {})


def test_missing_env_leaves_fields_null_instead_of_guessing():
    event = hooks.build_event("focus", {})
    assert event.ws is None
    assert event.app is None
    assert event.idle_s is None
