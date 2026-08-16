#!/usr/bin/env bash
# Apply / roll back the ccgram Pi patch stack.
#
# The stack (applied IN ORDER) lives at patches/ and edits the INSTALLED
# ccgram uv tool (4.5.2) so its own Pi rendering pipeline owns the whole
# topic transcript flow:
#
#   1. ccgram-4.5.2-pi-renderer-parity.patch
#      Thinking (temporary tree-style trace), tool-call display (existing
#      ephemeral batch), final-answer delivery, phase stamping in pi_format.
#   2. ccgram-4.5.2-low-noise-notifications.patch
#      Final-answer-only notifications: the thinking trace bubble is silent
#      on first send; under CCGRAM_QUIET_PROGRESS=true the status bubble and
#      user transcript echoes (Firstmate worker briefs) are sent with
#      disable_notification=True. Tool calls need no patch — config
#      (CCGRAM_HIDE_TOOL_CALLS=true) suppresses them upstream.
#   3. ccgram-4.5.2-pi-transcript-binding.patch
#      Transcript-binding race fix: Pi SessionStart never binds a transcript
#      whose filename does not contain the session id (no newest-file
#      fallback — deferred Pi bindings stay pending until the exact file
#      appears and the monitor re-resolves them every poll), tracked read
#      offsets reset whenever a session's transcript path changes, and the
#      nested-session primary preservation no longer pins reused Pi windows
#      to the previous tenant's transcript.
#   4. ccgram-4.5.2-pi-thinking-tree-live.patch
#      Thinking-tree liveness: live elapsed timer in the trace header plus a
#      background ticker that re-renders the bubble at the edit cadence even
#      when no new JSONL message arrived; CCGRAM_PI_TRACE_EDIT_SECS /
#      _TICK_SECS / _IDLE_SECS / _WRAP_CHARS env knobs; mid-turn assistant
#      text (stopReason=toolUse) folds into the tree as the bold goal line
#      instead of a separate notifying message, with same-message
#      goal/thinking paraphrase dedupe in pi_format (a thinking block whose
#      first line near-duplicates the goal text is dropped so the pair does
#      not render as adjacent twins); mobile-safe wrap default (36 columns —
#      48 was wider than a phone bubble's pixel capacity and shattered the
#      tree on Telegram mobile); idle-timeout deletion of stale trace
#      bubbles (default 10 min).
#
# Patch 2's context includes files added/edited by patch 1, so patch 2 only
# applies on top of patch 1; patch 3 touches disjoint files and applies on
# top of either; patch 4 edits files from patch 1, so it applies on top of
# patch 1 (with or without 2 and 3). Rollback reverses the stack in reverse
# order.
# This script makes the hot-patches tracked, idempotent, and reversible.
#
# Usage:
#   ./pi-renderer-patch.sh status     # per-patch: applied | not-applied | unknown
#   ./pi-renderer-patch.sh check      # dry-run: would the missing patches apply cleanly?
#   ./pi-renderer-patch.sh apply      # backup originals, then patch (idempotent)
#   ./pi-renderer-patch.sh rollback   # reverse the whole stack (idempotent)
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
EXPECTED_VERSION="4.5.2"

# Patch stack, in apply order. Rollback walks this list in reverse.
PATCH_NAMES=(
    ccgram-4.5.2-pi-renderer-parity.patch
    ccgram-4.5.2-low-noise-notifications.patch
    ccgram-4.5.2-pi-transcript-binding.patch
    ccgram-4.5.2-pi-thinking-tree-live.patch
)

patch_file() { printf '%s/patches/%s\n' "$PKG_DIR" "$1"; }

# Files pre-existing in pristine ccgram that the stack modifies — backed up
# before the first patch that touches them. (pi_live_transcript.py is ADDED
# by patch 1, so there is no pristine original to back up.)
TARGET_FILES=(
    ccgram/providers/pi_format.py
    ccgram/handlers/messaging_pipeline/message_routing.py
    ccgram/handlers/messaging_pipeline/message_queue.py
    ccgram/handlers/messaging_pipeline/message_task.py
    ccgram/handlers/status/status_bubble.py
    ccgram/config.py
    ccgram/hook.py
    ccgram/providers/pi.py
    ccgram/session_monitor.py
    ccgram/session_map.py
    ccgram/session_resolver.py
    ccgram/transcript_reader.py
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

# --- Marker-based applied detection ---------------------------------------
# `patch -R --dry-run` auto-detects unreversed patches and silently ignores
# -R, so it cannot distinguish applied from pristine. Each patch's own
# fingerprints can.

has_markers_renderer_parity() {
    local sp="$1"
    [[ -f "$sp/ccgram/handlers/messaging_pipeline/pi_live_transcript.py" ]] \
        && grep -q 'phase="pi-live"' "$sp/ccgram/providers/pi_format.py" \
        && grep -q 'handle_pi_thinking' "$sp/ccgram/handlers/messaging_pipeline/message_routing.py"
}

has_no_markers_renderer_parity() {
    local sp="$1"
    [[ ! -e "$sp/ccgram/handlers/messaging_pipeline/pi_live_transcript.py" ]] \
        && ! grep -q 'phase="pi-live"' "$sp/ccgram/providers/pi_format.py" \
        && ! grep -q 'handle_pi_thinking' "$sp/ccgram/handlers/messaging_pipeline/message_routing.py"
}

has_markers_low_noise() {
    local sp="$1"
    grep -q 'CCGRAM_QUIET_PROGRESS' "$sp/ccgram/config.py" \
        && grep -q 'disable_notification=True' \
            "$sp/ccgram/handlers/messaging_pipeline/pi_live_transcript.py" 2>/dev/null \
        && grep -q 'silent: bool = False' \
            "$sp/ccgram/handlers/messaging_pipeline/message_task.py"
}

has_no_markers_low_noise() {
    local sp="$1"
    ! grep -q 'CCGRAM_QUIET_PROGRESS' "$sp/ccgram/config.py" \
        && ! { [[ -f "$sp/ccgram/handlers/messaging_pipeline/pi_live_transcript.py" ]] \
            && grep -q 'disable_notification=True' \
                "$sp/ccgram/handlers/messaging_pipeline/pi_live_transcript.py"; } \
        && ! grep -q 'silent: bool = False' \
            "$sp/ccgram/handlers/messaging_pipeline/message_task.py"
}

has_markers_transcript_binding() {
    local sp="$1"
    grep -q 'Refusing Pi transcript path' "$sp/ccgram/hook.py" \
        && grep -q 'def resolve_session_transcript' "$sp/ccgram/providers/pi.py" \
        && grep -q 'resolve_session_transcript' "$sp/ccgram/session_monitor.py" \
        && grep -q 'Transcript path changed for session' "$sp/ccgram/transcript_reader.py" \
        && grep -q 'pi has no nested-observer' "$sp/ccgram/session_map.py" \
        && grep -q 'Stale path from a previous session' "$sp/ccgram/session_resolver.py"
}

has_no_markers_transcript_binding() {
    local sp="$1"
    ! grep -q 'Refusing Pi transcript path' "$sp/ccgram/hook.py" \
        && ! grep -q 'def resolve_session_transcript' "$sp/ccgram/providers/pi.py" \
        && ! grep -q 'resolve_session_transcript' "$sp/ccgram/session_monitor.py" \
        && ! grep -q 'Transcript path changed for session' "$sp/ccgram/transcript_reader.py" \
        && ! grep -q 'pi has no nested-observer' "$sp/ccgram/session_map.py" \
        && ! grep -q 'Stale path from a previous session' "$sp/ccgram/session_resolver.py"
}

has_markers_thinking_tree_live() {
    local sp="$1"
    grep -q 'CCGRAM_PI_TRACE_EDIT_SECS' \
            "$sp/ccgram/handlers/messaging_pipeline/pi_live_transcript.py" 2>/dev/null \
        && grep -q 'pi-live-goal' "$sp/ccgram/providers/pi_format.py" \
        && grep -q 'handle_pi_goal' \
            "$sp/ccgram/handlers/messaging_pipeline/message_routing.py"
}

has_no_markers_thinking_tree_live() {
    local sp="$1"
    ! { [[ -f "$sp/ccgram/handlers/messaging_pipeline/pi_live_transcript.py" ]] \
            && grep -q 'CCGRAM_PI_TRACE_EDIT_SECS' \
                "$sp/ccgram/handlers/messaging_pipeline/pi_live_transcript.py"; } \
        && ! grep -q 'pi-live-goal' "$sp/ccgram/providers/pi_format.py" \
        && ! grep -q 'handle_pi_goal' \
            "$sp/ccgram/handlers/messaging_pipeline/message_routing.py"
}

marker_fn() {
    # Echo the marker function base name for a patch file name.
    case "$1" in
        ccgram-4.5.2-pi-renderer-parity.patch) echo "renderer_parity" ;;
        ccgram-4.5.2-low-noise-notifications.patch) echo "low_noise" ;;
        ccgram-4.5.2-pi-transcript-binding.patch) echo "transcript_binding" ;;
        ccgram-4.5.2-pi-thinking-tree-live.patch) echo "thinking_tree_live" ;;
        *) echo "FAIL: no marker functions registered for patch '$1'" >&2; exit 2 ;;
    esac
}

patch_state() {
    # 0 = applied, 1 = not applied, 2 = partially applied (dirty tree)
    local sp="$1" name="$2" base
    base="$(marker_fn "$name")"
    if "has_markers_$base" "$sp"; then
        return 0
    fi
    if "has_no_markers_$base" "$sp"; then
        return 1
    fi
    return 2
}

stack_state() {
    # Echoes per-patch state lines; overall rc 0 when every patch is in a
    # definite state (applied or cleanly not-applied), 2 otherwise.
    local sp="$1" rc=0 name st
    for name in "${PATCH_NAMES[@]}"; do
        st=0
        patch_state "$sp" "$name" || st=$?
        case "$st" in
            0) echo "  $name: applied" ;;
            1) echo "  $name: not-applied" ;;
            *) echo "  $name: unknown (partial markers — dirty tree)"; rc=2 ;;
        esac
    done
    return "$rc"
}

# Scratch-verify that the missing tail of the stack applies from the live
# tree's current state: copy the affected files to a temp dir and really
# apply the missing patches there (dry-run alone can't validate a sequence).
verify_stack_applies() {
    local sp="$1"
    local tmp rel name st
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' RETURN
    for rel in "${TARGET_FILES[@]}" \
        ccgram/handlers/messaging_pipeline/pi_live_transcript.py; do
        if [[ -f "$sp/$rel" ]]; then
            mkdir -p "$tmp/$(dirname "$rel")"
            cp -p "$sp/$rel" "$tmp/$rel"
        fi
    done
    for name in "${PATCH_NAMES[@]}"; do
        st=0
        patch_state "$tmp" "$name" || st=$?
        if [[ $st -eq 0 ]]; then
            continue  # already applied; skip
        fi
        if [[ $st -ne 1 ]]; then
            echo "FAIL: $name is partially applied; tree is dirty" >&2
            return 1
        fi
        if ! (cd "$tmp" && patch -p1 --batch -s < "$(patch_file "$name")"); then
            echo "FAIL: $name does not apply cleanly from the current state" >&2
            return 1
        fi
    done
}

cmd="${1:-}"
SP="$(site_packages)" || { echo "FAIL: cannot locate ccgram uv tool site-packages" >&2; exit 1; }

case "$cmd" in
    status)
        echo "patch stack state ($SP):"
        stack_state "$SP"
        ;;
    check)
        check_version "$SP"
        rc=0
        stack_state "$SP" >/dev/null || rc=$?
        if [[ $rc -ne 0 ]]; then
            stack_state "$SP" >&2
            echo "FAIL: patch stack is in a partial/dirty state" >&2
            exit 1
        fi
        if verify_stack_applies "$SP"; then
            echo "ok: patch stack state is consistent; missing patches apply cleanly ($SP)"
        else
            exit 1
        fi
        ;;
    apply)
        check_version "$SP"
        rc=0
        stack_state "$SP" >/dev/null || rc=$?
        if [[ $rc -ne 0 ]]; then
            stack_state "$SP" >&2
            echo "FAIL: $SP has a partially applied stack; refusing to patch a dirty tree" >&2
            exit 1
        fi
        backup_dir="$HOME/.ccgram-prototype/renderer-patch-backup/$(installed_version "$SP")"
        applied_any=0
        for name in "${PATCH_NAMES[@]}"; do
            st=0
            patch_state "$SP" "$name" || st=$?
            if [[ $st -eq 0 ]]; then
                echo "ok: $name already applied; skipping"
                continue
            fi
            for rel in "${TARGET_FILES[@]}"; do
                if [[ -f "$SP/$rel" && ! -f "$backup_dir/$rel" ]]; then
                    mkdir -p "$backup_dir/$(dirname "$rel")"
                    cp -p "$SP/$rel" "$backup_dir/$rel"
                fi
            done
            (cd "$SP" && patch -p1 --batch -s < "$(patch_file "$name")")
            if ! "has_markers_$(marker_fn "$name")" "$SP"; then
                echo "FAIL: $name ran but markers are missing; restore the backup:" >&2
                echo "      $backup_dir" >&2
                exit 1
            fi
            echo "applied: $name -> $SP"
            applied_any=1
        done
        if [[ $applied_any -eq 1 ]]; then
            echo "backup: $backup_dir"
            echo "restart: systemctl --user restart ccgram-prototype.service"
        fi
        ;;
    rollback)
        for ((i=${#PATCH_NAMES[@]}-1; i>=0; i--)); do
            name="${PATCH_NAMES[$i]}"
            st=0
            patch_state "$SP" "$name" || st=$?
            if [[ $st -eq 1 ]]; then
                echo "ok: $name not applied; skipping"
                continue
            fi
            if [[ $st -ne 0 ]]; then
                echo "FAIL: $name is partially applied; refusing to roll back a dirty tree" >&2
                exit 1
            fi
            (cd "$SP" && patch -R -p1 --batch -s < "$(patch_file "$name")")
            if ! "has_no_markers_$(marker_fn "$name")" "$SP"; then
                echo "FAIL: reverse patch ran but markers remain; tree may be dirty" >&2
                exit 1
            fi
            echo "rolled back: $name"
        done
        echo "restart: systemctl --user restart ccgram-prototype.service"
        ;;
    *)
        echo "usage: $0 {status|check|apply|rollback}" >&2
        exit 2
        ;;
esac
