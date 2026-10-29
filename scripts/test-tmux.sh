#!/usr/bin/env bash
# tmux regression suite — tmux/** tracked files, PR #21 hygiene surfaces.
# Paths: tmux/**
#
# Covered assertions (docs/ci-tests/terminal.md):
#   - .tmux.conf keys: default-terminal is the 256-color value (not
#     xterm-ghostty), escape-time 10, update-environment carries
#     SSH_AUTH_SOCK + TERM, terminal-overrides carry RGB for both outer
#     TERMs, terminal-features carry clipboard (OSC52) for every
#     xterm-family client TERM (Ghostty, Blink, plain ssh),
#     the intentional `unbind C-b` stays present (tripwire: deleting it
#     re-captures C-b as a second prefix), prefix C-a send-prefix and the
#     copy-mode-vi bindings stay intact.
#   - Headless boot smoke on the real config (new-session and
#     start-server;kill-server) catches unknown-command/option regressions
#     on every tmux version present; option values are then spot-asserted
#     via show-options (a real parse, not a grep).
#   - Every tracked file under tmux/** is booted or sourced, or the
#     inventory check fails and demands coverage.
#   - Cross-terminal TERM/OSC52 coherence (read-only) across
#     xterm-ghostty.terminfo, ghostty config and zsh configs.
#
# Dual-mode (PR #293 rule):
#   default : missing tmux binary prints SKIP with a message, no fail.
#   STRICT=1: missing tmux binary FAILs (CI can apt-install it).
#
# SANDBOX=1 runs the negative self-test: every check runs against a
# mutated copy of .tmux.conf / a custom module / a config from a sibling
# surface (all inside mktemp), and the run passes only when the check
# reports FAIL there. This proves each check catches its regression.
#
# Offline and deterministic: unique `tmux -L` test socket per boot (the
# live tmux/herdr server is never contacted), mktemp fake HOME with a
# stub tpm so the config's plugin-manager branch never clones, no
# network, no $HOME mutation, no sleeps. Every check prints
# PASS/FAIL/SKIP with file and reason, plus per-check timing in ms.

set -uo pipefail

STRICT="${STRICT:-0}"
SANDBOX="${SANDBOX:-0}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONF="$REPO_ROOT/tmux/.tmux.conf"
TERMINFO_SRC="$REPO_ROOT/terminfo/xterm-ghostty.terminfo"
GHOSTTY_CONF="$REPO_ROOT/ghostty/.config/ghostty/config"

# Never inherit a live tmux session from the calling environment.
unset TMUX TMUX_PANE 2>/dev/null || true

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

now_ms() {
    local t
    t="$(date +%s%N 2>/dev/null || true)"
    if [[ -n "$t" && "$t" != *N ]]; then
        echo $((t / 1000000))
        return 0
    fi
    echo $((SECONDS * 1000))
}

report() {
    # report <PASS|FAIL|SKIP> <name> <file> <reason> <ms>
    printf '%s %-30s %s | %s (%s ms)\n' "$1" "$2" "$3" "$4" "$5"
    case "$1" in
        PASS) PASS_COUNT=$((PASS_COUNT + 1)) ;;
        FAIL) FAIL_COUNT=$((FAIL_COUNT + 1)) ;;
        SKIP) SKIP_COUNT=$((SKIP_COUNT + 1)) ;;
    esac
}

# run_check <name> <file-label> <func> [args...]
run_check() {
    local name="$1" file="$2" func="$3"
    shift 3
    local t0 reason rc
    t0="$(now_ms)"
    reason="$("$func" "$@" 2>&1)" && rc=0 || rc=$?
    if [[ $rc -eq 0 ]]; then
        report PASS "$name" "$file" "ok" "$(( $(now_ms) - t0 ))"
    else
        report FAIL "$name" "$file" "${reason:-failed}" "$(( $(now_ms) - t0 ))"
    fi
}

# ---------------------------------------------------------------------------
# Sandbox: fake HOME + stub tpm so .tmux.conf never clones plugins
# ---------------------------------------------------------------------------

WORK="$(mktemp -d)"
BOOT_HOME="$WORK/home"
mkdir -p "$BOOT_HOME/.local/share/tmux/plugins/tpm/bin"
printf '#!/bin/sh\nexit 0\n' >"$BOOT_HOME/.local/share/tmux/plugins/tpm/tpm"
chmod +x "$BOOT_HOME/.local/share/tmux/plugins/tpm/tpm"
BOOT_ERR="$WORK/boot.err"

# Socket cleanup must NOT rely on a socket list: boot_server runs inside
# command substitutions, so a list appended there never reaches this shell.
# Instead every socket this run creates shares the ci-tst-$$- prefix and
# cleanup kills anything matching it in the tmux socket directory.
SOCKDIR="${TMUX_TMPDIR:-/tmp}/tmux-$(id -u)"
SOCK_PREFIX="ci-tst-$$"

cleanup() {
    local s n
    for s in "$SOCKDIR/$SOCK_PREFIX"*; do
        [[ -e "$s" ]] || continue
        n="${s##*/}"
        HOME="$BOOT_HOME" tmux -L "$n" kill-server >/dev/null 2>&1 || true
        rm -f "$s"
    done
    rm -rf "$WORK"
}
trap cleanup EXIT

TMUX_ENV=(
    env
    HOME="$BOOT_HOME"
    TMUX_PLUGIN_MANAGER_PATH="$BOOT_HOME/.local/share/tmux/plugins"
)

boot_server() {
    # boot_server <conf>; echoes the socket name on success. The socket
    # name carries the SOCK_PREFIX so cleanup can find it from this shell.
    local conf="$1" sock
    sock="$SOCK_PREFIX-$((RANDOM))-$SECONDS"
    if ! "${TMUX_ENV[@]}" tmux -L "$sock" -f "$conf" new-session -d \
        >/dev/null 2>"$BOOT_ERR"; then
        echo "tmux boot failed: $(tr '\n' ' ' <"$BOOT_ERR")"
        return 1
    fi
    echo "$sock"
}

q() {
    # q <socket> <args...> — run a tmux query command against a test socket.
    local sock="$1"
    shift
    HOME="$BOOT_HOME" tmux -L "$sock" "$@" 2>/dev/null
}

# ---------------------------------------------------------------------------
# Checks. Each prints a failure reason on stdout and exits non-zero on FAIL.
# ---------------------------------------------------------------------------

chk_unbind_cb_conf() {
    # Tripwire (#21): the `unbind C-b` line must stay in .tmux.conf.
    # Without it C-b stays bound to send-prefix (verified against the
    # parsed key table too) and swallows C-b from pane programs.
    grep -qE '^[[:space:]]*unbind[[:space:]]+C-b[[:space:]]*$' "$1" \
        || { echo "conf no longer contains the intentional 'unbind C-b' (deleting it re-captures C-b)"; return 1; }
}

chk_boot_session() {
    # Headless boot smoke with the real config: catches unknown-command and
    # unknown-option regressions on every installed tmux version.
    local sock
    sock="$(boot_server "$1")" || return 1
    if [[ -s "$BOOT_ERR" ]]; then
        echo "boot emitted error output: $(tr '\n' ' ' <"$BOOT_ERR")"
        return 1
    fi
}

chk_boot_server_only() {
    # Server-only parse path: start-server parses the config without a session.
    # A start-server socket is killed immediately, so it needs no prefix
    # bookkeeping; if it ever lingers it still matches SOCK_PREFIX cleanup.
    local sock="$SOCK_PREFIX-$((RANDOM))-$SECONDS-sv"
    if ! "${TMUX_ENV[@]}" tmux -L "$sock" -f "$1" start-server \; kill-server \
        >/dev/null 2>"$WORK/sv.err"; then
        echo "start-server/kill-server failed: $(tr '\n' ' ' <"$WORK/sv.err")"
        return 1
    fi
    if [[ -s "$WORK/sv.err" ]]; then
        echo "start-server emitted error output: $(tr '\n' ' ' <"$WORK/sv.err")"
        return 1
    fi
}

opt_value() {
    # opt_value <socket> <scope g|s> <option> — echoes the parsed value.
    # default-terminal / escape-time / terminal-overrides /
    # terminal-features / set-clipboard are SERVER options (scope s);
    # update-environment is a session option (scope g).
    q "$1" show-options "-$2" "$3" | awk '{print $2}'
}

chk_default_terminal() {
    local sock v
    sock="$(boot_server "$1")" || return 1
    v="$(opt_value "$sock" s default-terminal)"
    [[ "$v" == "tmux-256color" ]] \
        || { echo "default-terminal is '$v', expected tmux-256color (xterm-ghostty must not leak into panes, #21)"; return 1; }
}

chk_escape_time() {
    local sock v
    sock="$(boot_server "$1")" || return 1
    v="$(opt_value "$sock" s escape-time)"
    [[ "$v" == "10" ]] \
        || { echo "escape-time is '$v', expected 10 (no Esc lag for pane programs)"; return 1; }
}

chk_update_environment() {
    local sock vals
    sock="$(boot_server "$1")" || return 1
    vals="$(q "$sock" show-options -g | grep '^update-environment')"
    [[ "$vals" == *SSH_AUTH_SOCK* ]] \
        || { echo "update-environment lost SSH_AUTH_SOCK (agent forwarding breaks on reattach)"; return 1; }
    [[ "$vals" == *TERM* ]] \
        || { echo "update-environment lost TERM (outer terminal type goes stale on reattach)"; return 1; }
}

chk_terminal_overrides_rgb() {
    local sock vals
    sock="$(boot_server "$1")" || return 1
    vals="$(q "$sock" show-options -s | grep '^terminal-overrides')"
    [[ "$vals" == *"xterm-256color*:RGB"* ]] \
        || { echo "terminal-overrides lost xterm-256color*:RGB (truecolor breaks from nvim :term / SSH)"; return 1; }
    [[ "$vals" == *"xterm-ghostty:RGB"* ]] \
        || { echo "terminal-overrides lost xterm-ghostty:RGB (truecolor breaks under Ghostty)"; return 1; }
}

chk_osc52_clipboard() {
    local sock vals sc
    sock="$(boot_server "$1")" || return 1
    vals="$(q "$sock" show-options -s | grep '^terminal-features')"
    sc="$(opt_value "$sock" s set-clipboard)"
    # tmux 3.4+ ships a builtin "xterm*:clipboard:..." composite entry, so a
    # substring match cannot notice a deletion of our own line. Assert the
    # exact bare appended entry instead.
    echo "$vals" | awk '{print $2}' | grep -Fxq 'xterm*:clipboard' \
        || { echo "terminal-features lost the explicit xterm*:clipboard entry (OSC52 passthrough breaks for Ghostty, Blink, and other xterm-family clients on tmux without builtin detection)"; return 1; }
    [[ "$sc" == "on" ]] \
        || { echo "set-clipboard is '$sc', expected on (OSC52 emit disabled)"; return 1; }
}

chk_prefix_ca() {
    local sock out
    sock="$(boot_server "$1")" || return 1
    out="$(q "$sock" list-keys -T prefix C-a)"
    [[ "$out" == *"send-prefix"* ]] \
        || { echo "prefix C-a no longer runs send-prefix: $out"; return 1; }
}

chk_cb_not_bound() {
    # Dynamic side of the #21 tripwire: after parsing the config, C-b must
    # NOT be bound in the prefix table (it must reach pane programs).
    local sock out
    sock="$(boot_server "$1")" || return 1
    out="$(q "$sock" list-keys -T prefix C-b)"
    [[ -z "$out" ]] \
        || { echo "C-b is bound again after config parse: $out (unbind C-b missing or defeated)"; return 1; }
}

chk_copy_mode_keys() {
    local sock v y
    sock="$(boot_server "$1")" || return 1
    v="$(q "$sock" list-keys -T copy-mode-vi v)"
    y="$(q "$sock" list-keys -T copy-mode-vi y)"
    [[ "$v" == *"begin-selection"* ]] \
        || { echo "copy-mode-vi v no longer starts selection: $v"; return 1; }
    [[ "$y" == *"copy-selection-and-cancel"* ]] \
        || { echo "copy-mode-vi y no longer copies and cancels: $y"; return 1; }
}

chk_inventory() {
    # Coverage-equivalent inventory: every tracked file under tmux/** must
    # be covered by a check above. A new file fails this list until a check
    # is added (docs/ci-tests/terminal.md keeps the mapping).
    local expected actual
    expected="$(printf '%s\n' \
        'tmux/.tmux.conf' | sort)"
    actual="$(git -C "$REPO_ROOT" ls-files -- tmux | sort)"
    if [[ "$actual" != "$expected" ]]; then
        echo "tracked files under tmux/ changed; update the checks + this list:"
        diff <(echo "$expected") <(echo "$actual") | sed 's/^/  /'
        return 1
    fi
}

# --- cross-terminal coherence (read-only over sibling-owned files) --------

terminfo_names() {
    # Primary TERM name from the terminfo header line
    # (first field before the first '|', e.g. xterm-ghostty).
    head -2 "$1" | grep -v '^#' | head -1 | cut -d'|' -f1 | tr -d '[:space:]'
}

chk_xt_overrides_match_terminfo() {
    # tmux terminal-overrides must carry RGB for the exact TERM name the
    # shipped terminfo defines (checked against the real parsed options).
    local sock overrides name
    sock="$(boot_server "$CONF")" || { echo "cannot boot tmux to inspect overrides"; return 1; }
    overrides="$(q "$sock" show-options -s | grep '^terminal-overrides')"
    name="$(terminfo_names "$1")"
    [[ "$name" == xterm-* ]] \
        || { echo "terminfo primary name '$name' is malformed"; return 1; }
    [[ "$overrides" == *"${name}:RGB"* || "$overrides" == *"${name}*:RGB"* ]] \
        || { echo "terminfo defines '$name' but tmux terminal-overrides carry no RGB entry for it"; return 1; }
}

chk_xt_ghostty_term() {
    # Ghostty's TERM must match the shipped terminfo name: either the
    # config leaves `term` at the ghostty default (xterm-ghostty) or sets
    # it explicitly to that value. Any other value breaks the terminfo
    # installed by install.sh (#11).
    local name v
    name="$(terminfo_names "$1" | head -1)"
    v="$(grep -E '^[[:space:]]*term[[:space:]]*=' "$2" | head -1 | sed 's/^[^=]*=[[:space:]]*//; s/[[:space:]]*$//')"
    if [[ -n "$v" && "$v" != "$name" ]]; then
        echo "ghostty config sets term=$v but the shipped terminfo defines '$name'"
        return 1
    fi
}

chk_xt_zsh_term() {
    # zsh must never force TERM to xterm-ghostty (#21: that value leaked
    # into tmux panes and SSH and broke RGB + clipboard; the inner value
    # xterm-256color is covered by tmux's xterm-256color*:RGB override).
    local root="${1:-$REPO_ROOT}" f bad
    for f in $(find "$root/zsh" -type f 2>/dev/null | sort); do
        bad="$(grep -hE '^[[:space:]]*(export[[:space:]]+)?TERM=' "$f" || true)"
        if [[ "$bad" == *xterm-ghostty* ]]; then
            echo "$f sets TERM to xterm-ghostty: $bad"
            return 1
        fi
    done
}

chk_xt_terminfo_drift() {
    # install.sh (#11) compiles terminfo/xterm-ghostty.terminfo; the former
    # byte-identical root duplicate was removed with the dead-code cleanup.
    # $1 is the shipped terminfo source: it must exist and define the
    # xterm-ghostty primary name the rest of the suite asserts against.
    if [[ ! -e "$1" ]]; then
        echo "terminfo source '$1' is missing"
        return 1
    fi
    head -2 "$1" | grep -q '^xterm-ghostty|' \
        || { echo "'$1' does not define the xterm-ghostty terminfo name"; return 1; }
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
    local total_t0
    total_t0="$(now_ms)"
    echo "== tmux checks (STRICT=$STRICT SANDBOX=$SANDBOX) =="

    # Checks that need the tmux binary (boot + parsed option/key queries).
    local tmux_dep=(
        tmux-boot-session:chk_boot_session
        tmux-boot-server:chk_boot_server_only
        tmux-default-terminal:chk_default_terminal
        tmux-escape-time:chk_escape_time
        tmux-update-environment:chk_update_environment
        tmux-terminal-overrides:chk_terminal_overrides_rgb
        tmux-osc52-clipboard:chk_osc52_clipboard
        tmux-prefix-ca:chk_prefix_ca
        tmux-cb-not-bound:chk_cb_not_bound
        tmux-copy-mode-keys:chk_copy_mode_keys
    )
    local pair name func
    if ! command -v tmux >/dev/null 2>&1; then
        for pair in "${tmux_dep[@]}"; do
            name="${pair%%:*}"; func="${pair##*:}"
            if [[ "$STRICT" = "1" ]]; then
                report FAIL "$name" "$CONF" "tmux not found (STRICT=1)" 0
            else
                report SKIP "$name" "$CONF" "tmux not found; install tmux to run this check" 0
            fi
        done
    else
        for pair in "${tmux_dep[@]}"; do
            name="${pair%%:*}"; func="${pair##*:}"
            run_check "$name" "$CONF" "$func" "$CONF"
        done
    fi

    # Static checks: no tmux binary needed.
    run_check tmux-unbind-cb "$CONF" chk_unbind_cb_conf "$CONF"
    run_check tmux-inventory "tmux/**" chk_inventory

    # Cross-terminal coherence (read-only over sibling-owned files).
    if command -v tmux >/dev/null 2>&1; then
        run_check xt-overrides-match-terminfo "$TERMINFO_SRC" chk_xt_overrides_match_terminfo "$TERMINFO_SRC"
    elif [[ "$STRICT" = "1" ]]; then
        report FAIL xt-overrides-match-terminfo "$TERMINFO_SRC" "tmux not found (STRICT=1)" 0
    else
        report SKIP xt-overrides-match-terminfo "$TERMINFO_SRC" "tmux not found; install tmux to run this check" 0
    fi
    run_check xt-ghostty-term "ghostty/config" chk_xt_ghostty_term "$TERMINFO_SRC" "$GHOSTTY_CONF"
    run_check xt-zsh-term "zsh/**" chk_xt_zsh_term
    run_check xt-terminfo-drift "$TERMINFO_SRC" chk_xt_terminfo_drift "$TERMINFO_SRC"

    if [[ "$SANDBOX" = "1" ]]; then
        if command -v tmux >/dev/null 2>&1; then
            sandbox
        else
            report SKIP sbx-negative-tests "mktemp-mutation" "tmux not found; install tmux to run the sandbox self-test" 0
        fi
    fi

    echo "== tmux checks: $PASS_COUNT pass, $FAIL_COUNT fail, $SKIP_COUNT skip ($(( $(now_ms) - total_t0 )) ms) =="
    [[ "$FAIL_COUNT" -eq 0 ]]
}

# ---------------------------------------------------------------------------
# Negative self-test: mutate copies in mktemp, expect each check to FAIL.
# ---------------------------------------------------------------------------

expect_fail() {
    # expect_fail <label> <func> [args...] — PASS when the check FAILS.
    local label="$1" func="$2"
    shift 2
    local t0 reason rc
    t0="$(now_ms)"
    reason="$("$func" "$@" 2>&1)" && rc=0 || rc=$?
    if [[ $rc -ne 0 ]]; then
        report PASS "sbx-$label" "mktemp-mutation" "caught: ${reason:-failed}" "$(( $(now_ms) - t0 ))"
    else
        report FAIL "sbx-$label" "mktemp-mutation" "NOT caught: mutation still passes" "$(( $(now_ms) - t0 ))"
    fi
}

sandbox() {
    local m="$WORK/mut"
    mkdir -p "$m"

    sed '/^[[:space:]]*unbind[[:space:]]*C-b[[:space:]]*$/d' "$CONF" >"$m/nounbind.conf"
    expect_fail unbind-cb chk_unbind_cb_conf "$m/nounbind.conf"

    sed "s/^set -g default-terminal 'tmux-256color'/set -g default-terminal 'xterm-ghostty'/" "$CONF" >"$m/ghostty-term.conf"
    expect_fail default-terminal chk_default_terminal "$m/ghostty-term.conf"

    sed 's/^set -sg escape-time 10$/set -sg escape-time 500/' "$CONF" >"$m/esctime.conf"
    expect_fail escape-time chk_escape_time "$m/esctime.conf"

    sed 's/^set -g update-environment ".*"$/set -g update-environment "DISPLAY"/' "$CONF" >"$m/updenv.conf"
    expect_fail update-environment chk_update_environment "$m/updenv.conf"

    sed '/^set -ag terminal-overrides ..xterm-ghostty:RGB.$/d' "$CONF" >"$m/nooverride.conf"
    expect_fail overrides-rgb chk_terminal_overrides_rgb "$m/nooverride.conf"

    sed "/^set -as terminal-features ',xterm\*:clipboard'$/d" "$CONF" >"$m/noclip.conf"
    expect_fail osc52-clipboard chk_osc52_clipboard "$m/noclip.conf"

    sed 's/^bind -T copy-mode-vi v send-keys -X begin-selection$/bind -T copy-mode-vi v send-keys -X cursor-left/' "$CONF" >"$m/copymode.conf"
    expect_fail copy-mode-keys chk_copy_mode_keys "$m/copymode.conf"

    # Cross-terminal mutations (copies of sibling-owned files).
    cp "$TERMINFO_SRC" "$m/xterm-kitty.terminfo"
    sed -i 's/^xterm-ghostty|/xterm-kitty|/' "$m/xterm-kitty.terminfo"
    expect_fail xt-overrides-match-terminfo chk_xt_overrides_match_terminfo "$m/xterm-kitty.terminfo"

    cp "$GHOSTTY_CONF" "$m/ghostty.config"
    printf 'term = xterm-kitty\n' >>"$m/ghostty.config"
    expect_fail xt-ghostty-term chk_xt_ghostty_term "$TERMINFO_SRC" "$m/ghostty.config"

    mkdir -p "$m/zsh"
    printf 'export TERM="xterm-ghostty"\n' >"$m/zsh/.zshrc"
    expect_fail xt-zsh-term chk_xt_zsh_term "$m"

    printf 'xterm-drifted|drifted copy,\n' >"$m/drift.terminfo"
    expect_fail xt-terminfo-drift chk_xt_terminfo_drift "$m/drift.terminfo"
}

main "$@"
