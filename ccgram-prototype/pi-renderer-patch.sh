#!/usr/bin/env bash
# Apply / roll back the ccgram Pi renderer-parity patch.
#
# The patch lives at patches/ccgram-4.5.2-pi-renderer-parity.patch and edits
# the INSTALLED ccgram uv tool (4.5.2) so its own Pi rendering pipeline owns
# thinking (temporary tree-style trace), tool-call display (existing
# ephemeral batch), and final-answer delivery. This script makes that
# hot-patch tracked, idempotent, and reversible.
#
# Usage:
#   ./pi-renderer-patch.sh status     # applied | not-applied | unknown
#   ./pi-renderer-patch.sh check      # dry-run: would the patch apply cleanly?
#   ./pi-renderer-patch.sh apply      # backup originals, then patch (idempotent)
#   ./pi-renderer-patch.sh rollback   # reverse the patch (idempotent)
#
# Safety:
#   - Refuses to touch a ccgram version other than 4.5.2 unless
#     CCGRAM_PATCH_FORCE=1 is set (the patch context is version-specific).
#   - apply takes a file-level backup under
#     ~/.ccgram-prototype/renderer-patch-backup/<version>/ before patching.
#     Rollback is `patch -R`; if that ever fails, restore the backup copies
#     by hand (paths are printed by `apply`).
#   - Restart the service after apply/rollback:
#       systemctl --user restart ccgram-prototype.service
set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH_FILE="$PKG_DIR/patches/ccgram-4.5.2-pi-renderer-parity.patch"
EXPECTED_VERSION="4.5.2"

TARGET_FILES=(
    ccgram/providers/pi_format.py
    ccgram/handlers/messaging_pipeline/message_routing.py
    ccgram/handlers/messaging_pipeline/pi_live_transcript.py  # added by patch
)

site_packages() {
    local tool_dir
    if command -v uv >/dev/null 2>&1; then
        tool_dir="$(uv tool dir 2>/dev/null)/ccgram"
    fi
    if [[ -z "${tool_dir:-}" || ! -d "$tool_dir" ]]; then
        tool_dir="$HOME/.local/share/uv/tools/ccgram"
    fi
    local sp
    sp="$(printf '%s\n' "$tool_dir"/lib/python*/site-packages 2>/dev/null | head -1)"
    if [[ -d "$sp/ccgram" ]]; then
        printf '%s\n' "$sp"
        return 0
    fi
    return 1
}

installed_version() {
    local sp="$1"
    grep -oE "^__version__ = version = '[0-9.]+'" "$sp/ccgram/_version.py" \
        | grep -oE "[0-9.]+" || true
}

check_version() {
    local sp="$1" v
    v="$(installed_version "$sp")"
    if [[ "$v" != "$EXPECTED_VERSION" && "${CCGRAM_PATCH_FORCE:-0}" != "1" ]]; then
        echo "FAIL: installed ccgram is '${v:-unknown}', patch targets $EXPECTED_VERSION." >&2
        echo "      Regenerate the patch for $v, or set CCGRAM_PATCH_FORCE=1 to proceed." >&2
        exit 1
    fi
}

has_markers() {
    # Marker-based applied detection: `patch -R --dry-run` auto-detects
    # unreversed patches and silently ignores -R, so it cannot distinguish
    # applied from pristine. The patch's own fingerprints can.
    local sp="$1"
    [[ -f "$sp/ccgram/handlers/messaging_pipeline/pi_live_transcript.py" ]] \
        && grep -q 'phase="pi-live"' "$sp/ccgram/providers/pi_format.py" \
        && grep -q 'handle_pi_thinking' "$sp/ccgram/handlers/messaging_pipeline/message_routing.py"
}

has_no_markers() {
    local sp="$1"
    [[ ! -e "$sp/ccgram/handlers/messaging_pipeline/pi_live_transcript.py" ]] \
        && ! grep -q 'phase="pi-live"' "$sp/ccgram/providers/pi_format.py" \
        && ! grep -q 'handle_pi_thinking' "$sp/ccgram/handlers/messaging_pipeline/message_routing.py"
}

is_applied() {
    # 0 = applied, 1 = cleanly applicable (not applied), 2 = neither (dirty tree)
    local sp="$1"
    if has_markers "$sp"; then
        return 0
    fi
    if has_no_markers "$sp" \
        && (cd "$sp" && patch -p1 --dry-run --batch -s < "$PATCH_FILE") >/dev/null 2>&1; then
        return 1
    fi
    return 2
}

cmd="${1:-}"
SP="$(site_packages)" || { echo "FAIL: cannot locate ccgram uv tool site-packages" >&2; exit 1; }

case "$cmd" in
    status)
        rc=0
        is_applied "$SP" || rc=$?
        case "$rc" in
            0) echo "applied ($SP)" ;;
            1) echo "not-applied ($SP)" ;;
            *) echo "unknown ($SP — tree matches neither pristine nor patched)" ;;
        esac
        ;;
    check)
        check_version "$SP"
        if has_markers "$SP"; then
            echo "ok: patch is applied (markers present in $SP)"
        elif (cd "$SP" && patch -p1 --dry-run --batch -s < "$PATCH_FILE") >/dev/null 2>&1; then
            echo "ok: patch would apply cleanly to $SP"
        else
            echo "FAIL: patch does not apply cleanly; tree is dirty or version-mismatched" >&2
            exit 1
        fi
        ;;
    apply)
        check_version "$SP"
        rc=0
        is_applied "$SP" || rc=$?
        if [[ $rc -eq 0 ]]; then
            echo "ok: already applied; nothing to do"
            exit 0
        fi
        if [[ $rc -ne 1 ]]; then
            echo "FAIL: $SP matches neither pristine nor patched state; refusing to patch a dirty tree" >&2
            exit 1
        fi
        backup_dir="$HOME/.ccgram-prototype/renderer-patch-backup/$(installed_version "$SP")"
        for rel in "${TARGET_FILES[@]}"; do
            if [[ -f "$SP/$rel" && ! -f "$backup_dir/$rel" ]]; then
                mkdir -p "$backup_dir/$(dirname "$rel")"
                cp -p "$SP/$rel" "$backup_dir/$rel"
            fi
        done
        echo "backup: $backup_dir"
        (cd "$SP" && patch -p1 --batch -s < "$PATCH_FILE")
        if ! has_markers "$SP"; then
            echo "FAIL: patch ran but markers are missing; restore the backup:" >&2
            echo "      $backup_dir" >&2
            exit 1
        fi
        echo "applied: $PATCH_FILE -> $SP"
        echo "restart: systemctl --user restart ccgram-prototype.service"
        ;;
    rollback)
        if ! is_applied "$SP"; then
            echo "ok: not applied; nothing to do"
            exit 0
        fi
        (cd "$SP" && patch -R -p1 --batch -s < "$PATCH_FILE")
        if ! has_no_markers "$SP"; then
            echo "FAIL: reverse patch ran but markers remain; tree may be dirty" >&2
            exit 1
        fi
        echo "rolled back: $SP"
        echo "restart: systemctl --user restart ccgram-prototype.service"
        ;;
    *)
        echo "usage: $0 {status|check|apply|rollback}" >&2
        exit 2
        ;;
esac
