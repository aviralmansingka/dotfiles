#!/usr/bin/env bash
# Offline validation for the ccgram prototype package.
# Touches no live state: parses the systemd unit syntax and scans the package
# for accidentally committed secrets.
set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fail=0

for UNIT in "$PKG_DIR"/.config/systemd/user/*.service; do
    echo "==> systemd unit syntax: $UNIT"
    if command -v systemd-analyze >/dev/null 2>&1; then
        # verify parses the unit offline; it does not start or inspect live units.
        # Expected warning (not a syntax error): the ccgram/sidecar binaries are
        # installed by stow during onboarding, so they may not exist on this host yet.
        verify_out="$(systemd-analyze verify "$UNIT" 2>&1)" || true
        unexpected="$(printf '%s\n' "$verify_out" | grep -v '^$' \
            | grep -vE 'Command /.*/\.local/bin/(ccgram|ccgram-thinking-sidecar) is not executable' || true)"
        if [[ -n "$unexpected" ]]; then
            echo "    FAIL: systemd-analyze verify reported problems:"
            printf '%s\n' "$unexpected"
            fail=1
        else
            echo "    ok (binary-missing warning filtered: deployed by stow at onboarding)"
        fi
    else
        echo "    skipped: systemd-analyze not available on this host"
    fi
done

echo "==> thinking sidecar: syntax + unit tests (offline, no Telegram)"
SIDECAR="$PKG_DIR/.local/bin/ccgram-thinking-sidecar"
if command -v python3 >/dev/null 2>&1; then
    if python3 -m py_compile "$SIDECAR" \
        && python3 -m unittest discover -s "$PKG_DIR/thinking-sidecar" -t "$PKG_DIR/thinking-sidecar" >/dev/null 2>&1; then
        echo "    ok: sidecar compiles and unit tests pass"
    else
        echo "    FAIL: sidecar compile or unit tests failed; run:"
        echo "        python3 -m unittest discover -s ccgram-prototype/thinking-sidecar -v"
        fail=1
    fi
else
    echo "    skipped: python3 not available on this host"
fi
if [[ -x "$SIDECAR" ]]; then
    echo "    ok: sidecar is executable (stow will deploy it to ~/.local/bin)"
else
    echo "    FAIL: $SIDECAR is not executable"
    fail=1
fi

echo "==> Pi hook shim: syntax + hooks.json parse (offline)"
SHIM="$PKG_DIR/.local/bin/ccgram-pi-hook"
HOOKS_JSON="$PKG_DIR/.pi/agent/extensions/hooks.json"
if command -v python3 >/dev/null 2>&1; then
    if python3 -m py_compile "$SHIM" \
        && python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$HOOKS_JSON"; then
        echo "    ok: shim compiles and hooks.json parses"
    else
        echo "    FAIL: shim compile or hooks.json parse failed"
        fail=1
    fi
else
    echo "    skipped: python3 not available on this host"
fi
if [[ -x "$SHIM" ]]; then
    echo "    ok: shim is executable (stow will deploy it to ~/.local/bin)"
else
    echo "    FAIL: $SHIM is not executable"
    fail=1
fi

echo "==> Pi patch stack (renderer parity + low-noise + transcript binding + frontdoor live status): applies cleanly + offline fixture tests"
PATCH_SH="$PKG_DIR/pi-renderer-patch.sh"
CCGRAM_PY="$HOME/.local/share/uv/tools/ccgram/bin/python"
if [[ ! -x "$CCGRAM_PY" ]]; then
    CCGRAM_PY="$(printf '%s\n' "$HOME"/.local/share/uv/tools/ccgram/bin/python* 2>/dev/null | head -1)"
fi
if [[ ! -x "$CCGRAM_PY" ]] && command -v uv >/dev/null 2>&1; then
    CCGRAM_PY="$(uv tool dir 2>/dev/null)/ccgram/bin/python"
fi
if [[ -x "$CCGRAM_PY" ]]; then
    if bash "$PATCH_SH" check >/dev/null 2>&1; then
        echo "    ok: patch stack state is consistent (applied or cleanly applicable)"
    else
        echo "    FAIL: pi-renderer-patch.sh check failed (dirty tree or version mismatch)"
        fail=1
    fi
    if "$CCGRAM_PY" -m unittest discover -s "$PKG_DIR/pi-renderer" \
        -t "$PKG_DIR/pi-renderer" >/dev/null 2>&1; then
        echo "    ok: patch-stack fixture tests pass (patched copy, no Telegram)"
    else
        echo "    FAIL: patch-stack tests failed; run:"
        echo "        $CCGRAM_PY -m unittest discover -s ccgram-prototype/pi-renderer -v"
        fail=1
    fi
    if "$CCGRAM_PY" -m unittest discover -s "$PKG_DIR/transcript-binding" \
        -t "$PKG_DIR/transcript-binding" >/dev/null 2>&1; then
        echo "    ok: transcript-binding race tests pass (patched copy, reused-directory fixture)"
    else
        echo "    FAIL: transcript-binding tests failed; run:"
        echo "        $CCGRAM_PY -m unittest discover -s ccgram-prototype/transcript-binding -v"
        fail=1
    fi
else
    echo "    skipped: ccgram uv tool python not found on this host"
fi

echo "==> secret scan: $PKG_DIR"
# Telegram bot tokens look like 123456789:AAE... (digits:35+ url-safe chars).
# Only placeholder-shaped values may appear in tracked files.
secret_hits="$(grep -rEn '[0-9]{6,}:[A-Za-z0-9_-]{30,}' "$PKG_DIR" \
    --exclude=validate.sh || true)"
# Allow the documented placeholder in the env example.
secret_hits="$(printf '%s\n' "$secret_hits" | grep -v '123456789:replace-with-prototype-bot-token' || true)"
if [[ -n "$secret_hits" ]]; then
    echo "    FAIL: possible bot token committed:"
    printf '%s\n' "$secret_hits"
    fail=1
else
    echo "    ok: no real tokens found"
fi

# The filled-in env file must never be tracked.
if git -C "$PKG_DIR" ls-files --error-unmatch \
    'ccgram-prototype/.config/ccgram-prototype.env' >/dev/null 2>&1; then
    echo "    FAIL: ccgram-prototype.env (real secrets file) is tracked in git"
    fail=1
else
    echo "    ok: real env file is not tracked"
fi

if [[ "$fail" -ne 0 ]]; then
    echo "==> validation FAILED"
    exit 1
fi
echo "==> validation passed"
