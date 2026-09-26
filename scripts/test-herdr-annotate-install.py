#!/usr/bin/env python3
"""Offline installer contract check: uv run --no-project python scripts/test-herdr-annotate-install.py."""
from pathlib import Path
import hashlib
import os
import subprocess
import tempfile
import tomllib

REPO = Path(__file__).resolve().parent.parent
RECIPE = REPO / "ops/herdr-annotate-review"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def executable(path, text):
    path.write_text("#!/bin/bash\nset -eu\n" + text)
    path.chmod(0o755)


with tempfile.TemporaryDirectory(prefix="annotate-install-test-") as tmp:
    home = Path(tmp) / "home with spaces"
    tools = Path(tmp) / "bin"
    home.mkdir()
    tools.mkdir()
    log = Path(tmp) / "calls"
    env = {
        **os.environ,
        "HOME": str(home),
        "XDG_DATA_HOME": str(home / "data with spaces"),
        "PATH": f"{tools}:{os.environ['PATH']}",
        "CALL_LOG": str(log),
        "REVISION": (RECIPE / "upstream-ref").read_text().strip(),
    }
    executable(tools / "git", '''
printf 'git %s\\n' "$*" >> "$CALL_LOG"
if [[ "$1" == init ]]; then mkdir -p "$3"; fi
if [[ "$*" == *'rev-parse HEAD' ]]; then printf '%s\\n' "$REVISION"; fi
if [[ "$*" == *'apply --check'* && "${FAIL_PATCH:-}" == 1 ]]; then exit 1; fi
''')
    executable(tools / "cargo", '''
printf 'cargo %s\\n' "$*" >> "$CALL_LOG"
if [[ "$1" == test && "${FAIL_TEST:-}" == 1 ]]; then exit 1; fi
if [[ "$1" == build ]]; then
    target="${!#}"
    mkdir -p "$target/release"
    printf '#!/bin/sh\\nprintf "plannotator-tui 0.7.0\\\\n"\\n' > "$target/release/plannotator-tui"
    chmod +x "$target/release/plannotator-tui"
fi
''')
    executable(tools / "herdr", '''
printf 'herdr %s\\n' "$*" >> "$CALL_LOG"
if [[ "$1 $2" == 'plugin install' ]]; then
    mkdir -p "$HOME/upstream-managed-plugin"
    printf '%s\\n' "$*" > "$HOME/upstream-managed-plugin/install"
fi
''')

    def install(**extra):
        return subprocess.run(
            ["bash", str(REPO / "scripts/install-herdr-annotate")],
            env={**env, **extra}, capture_output=True, text=True,
        )

    result = install()
    assert result.returncode == 0, result.stderr
    root = Path(env["XDG_DATA_HOME"]) / "herdr/annotate-review"
    binary = root / "plannotator-tui"
    manifest = root / "herdr-plugin.toml"
    receipt = root / "build-receipt.txt"
    assert os.access(binary, os.X_OK)
    assert manifest.read_bytes() == (RECIPE / "herdr-plugin.toml").read_bytes()
    assert f"binary_sha256={digest(binary)}" in receipt.read_text()
    assert f"patch_sha256={digest(RECIPE / 'customizations.patch')}" in receipt.read_text()
    assert f"upstream_revision={env['REVISION']}" in receipt.read_text()
    calls = log.read_text()
    assert f"fetch -q --depth 1 origin {env['REVISION']}" in calls
    assert "cargo test --locked --workspace" in calls
    assert "cargo clippy --locked --workspace --all-targets -- -D warnings" in calls
    assert calls.index("cargo test") < calls.index("herdr plugin link")
    assert "plannotator/herdr-annotate/lite --ref" in calls

    before = {path.name: path.read_bytes() for path in root.iterdir()}
    for failure in ({"FAIL_PATCH": "1"}, {"FAIL_TEST": "1"}):
        log.write_text("")
        result = install(**failure)
        assert result.returncode != 0
        assert {path.name: path.read_bytes() for path in root.iterdir()} == before
        assert "herdr plugin" not in log.read_text(), "failed build must not relink/install"

    # Upstream updates have a distinct plugin id and location.
    subprocess.run(["herdr", "plugin", "install", "plannotator/herdr-annotate/lite", "--yes"], env=env, check=True)
    assert {path.name: path.read_bytes() for path in root.iterdir()} == before
    assert install().returncode == 0
    assert (root / "plannotator-tui.previous").read_bytes() == before["plannotator-tui"]

    plugin = tomllib.loads(manifest.read_text())
    config = tomllib.loads((REPO / "herdr/.config/herdr/config.toml").read_text())
    keys = {item["key"]: item["command"] for item in config["keys"]["command"]}
    assert plugin["id"] == "annotate-review"
    assert "build" not in plugin, "link must not download a stock binary"
    assert keys["prefix+o"] == "annotate-review.open"
    assert keys["prefix+shift+o"] == "annotate-review.last"
    assert keys["prefix+a"] == "annotate.capture"
    for action in plugin["actions"]:
        assert action["command"][0] == "./plannotator-tui"
    assert plugin["link_handlers"][0]["action"] == "open-link"
    assert "$HERDR_PLUGIN_ROOT/plannotator-tui" in plugin["panes"][0]["command"][2]

print("PASS: pinned recipe, failed-build safety, rollback, paths with spaces, and independent update routing")
