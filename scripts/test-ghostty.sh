#!/usr/bin/env bash
# Ghostty + terminfo regression suite — PR #11 install surface.
# Paths: ghostty/** terminfo/xterm-ghostty.terminfo
#
# Ghostty is absent on this Linux host (macOS-only terminal), so the
# ghostty checks are parse-shape only: well-formed key=value lines, no
# duplicate keys, a complete 0-15 palette, referenced font/color keys
# present, and keybind actions from a small allow-list derived from the
# current file. Full key/action validation needs the ghostty binary and
# stays host-only (docs/ci-tests/terminal.md, Known gaps).
#
# The terminfo checks are real: tic compiles xterm-ghostty.terminfo into a
# mktemp dir (never $HOME), infocmp -x round-trips it through a second
# compile, and the key capabilities survive (colors 256, 80x24 cells,
# 256-color SGR setaf/setab, rgb initc, kmous, kf1..kf63).
#
# Dual-mode (PR #293 rule):
#   default : missing tic/infocmp prints SKIP with a message, no fail.
#   STRICT=1: missing tic/infocmp FAILs (CI can apt-install ncurses).
#
# SANDBOX=1 runs the negative self-test: mutated copies of the config and
# the terminfo (all inside mktemp) must make the matching check FAIL.
#
# Offline and deterministic: no network, no $HOME mutation, no sleeps.
# Every check prints PASS/FAIL/SKIP with file and reason, plus per-check
# timing in ms.

set -uo pipefail

STRICT="${STRICT:-0}"
SANDBOX="${SANDBOX:-0}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONF="$REPO_ROOT/ghostty/.config/ghostty/config"
TERMINFO_SRC="$REPO_ROOT/terminfo/xterm-ghostty.terminfo"

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

run_check() {
    # run_check <name> <file-label> <func> [args...]
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
# Config parsing helpers
# ---------------------------------------------------------------------------

conf_lines() {
    # Non-blank, non-comment lines of the config.
    grep -vE '^[[:space:]]*(#|$)' "$1" 2>/dev/null || true
}

conf_keys() {
    conf_lines "$1" | sed 's/[[:space:]]*=.*$//; s/[[:space:]]*$//'
}

norm_key() {
    # Normalized key: "palette <index>" and "keybind <trigger>" collapse
    # families of repeatable keys; every other key must stay unique.
    local key="$1" value="$2"
    case "$key" in
        palette)  echo "palette $(printf '%s' "$value" | cut -d= -f1)" ;;
        keybind)  echo "keybind $(printf '%s' "$value" | cut -d= -f1)" ;;
        *)        echo "$key" ;;
    esac
}

# Known key allow-list, derived from the current config file. A typo'd key
# fails here without the ghostty binary; adding a real new key means adding
# it to this list (and to docs/ci-tests/terminal.md).
KNOWN_KEYS="adjust-cell-height auto-update background clipboard-read
clipboard-trim-trailing-spaces clipboard-write cursor-color custom-shader-animation
font-family font-size font-thicken foreground link-url macos-titlebar-style mouse-hide-while-typing
mouse-scroll-multiplier palette scrollback-limit selection-background selection-foreground
shell-integration shell-integration-features window-colorspace window-decoration
window-save-state keybind"

# Known keybind action allow-list, derived from the current config file
# (only `text:` today). ghostty-validate on the Mac is the full check.
KNOWN_ACTIONS="text"

# Collapse the allow-lists onto single space-separated lines so the
# membership tests below see plain words.
KNOWN_KEYS="$(echo $KNOWN_KEYS | tr -s '[:space:]' ' ')"
KNOWN_ACTIONS="$(echo $KNOWN_ACTIONS | tr -s '[:space:]' ' ')"

# ---------------------------------------------------------------------------
# Ghostty config checks (shape only — no ghostty binary on Linux)
# ---------------------------------------------------------------------------

chk_shape() {
    local bad
    bad="$(conf_lines "$1" | grep -vE '^[A-Za-z0-9_-]+[[:space:]]*=[[:space:]]*.+$' || true)"
    [[ -z "$bad" ]] || { echo "malformed line(s) (expected key = value): $(echo "$bad" | head -3 | tr '\n' '; ')"; return 1; }
}

chk_known_keys() {
    local k unknown
    while IFS= read -r k; do
        unknown=1
        if [[ " $KNOWN_KEYS " == *" $k "* ]]; then
            unknown=0
        fi
        if [[ $unknown -eq 1 ]]; then
            echo "unknown key '$k' (typo, or extend KNOWN_KEYS for a real new key)"
            return 1
        fi
    done < <(conf_keys "$1")
    return 0
}

chk_duplicate_keys() {
    local dups
    dups="$(paste <(conf_keys "$1") <(conf_lines "$1" | sed 's/^[^=]*=[[:space:]]*//') \
        | while IFS=$'\t' read -r k v; do norm_key "$k" "$v"; done \
        | sort | uniq -d)"
    [[ -z "$dups" ]] || { echo "duplicate key(s): $(echo "$dups" | tr '\n' ' ')"; return 1; }
}

chk_palette_complete() {
    # comm needs lexically sorted input on both sides ("10" sorts
    # before "2"), so both the found indices and the 0..15 expectation
    # go through plain sort.
    local idx missing
    idx="$(conf_lines "$1" | sed -n 's/^palette[[:space:]]*=[[:space:]]*\([0-9]\{1,2\}\)=.*$/\1/p' | sort | uniq)"
    missing="$(seq 0 15 | sort | comm -23 - <(echo "$idx") | tr '\n' ' ')"
    [[ -z "$missing" ]] || { echo "palette entries missing: $missing"; return 1; }
    local extra
    extra="$(echo "$idx" | comm -13 <(seq 0 15 | sort) - | tr '\n' ' ')"
    [[ -z "$extra" ]] || { echo "palette entries out of range: $extra"; return 1; }
}

chk_font_color_keys() {
    # Referenced theme/font keys must exist with a usable value.
    local line
    for k in font-family font-size background foreground cursor-color; do
        line="$(conf_lines "$1" | grep -E "^${k}[[:space:]]*=" | head -1)"
        [[ -n "$line" ]] || { echo "required key '$k' missing"; return 1; }
    done
    # Hex colors must be well-formed #rrggbb.
    local badhex
    badhex="$(conf_lines "$1" \
        | sed -n 's/^\(background\|foreground\|cursor-color\|selection-background\|selection-foreground\)[[:space:]]*=[[:space:]]*//p' \
        | grep -vE '^#[0-9a-fA-F]{6}$' || true)"
    [[ -z "$badhex" ]] || { echo "malformed hex color(s): $(echo "$badhex" | tr '\n' ' ')"; return 1; }
}

chk_keybind_actions() {
    # keybind = <trigger>=<action>[:<arg>]; the action must come from the
    # allow-list. Full validation needs the ghostty binary (host-only).
    local kb action bad
    while IFS= read -r kb; do
        # value is "<trigger>=<action>[:<arg>]" — split on the second '='.
        action="$(printf '%s' "$kb" | sed 's/^keybind[[:space:]]*=[[:space:]]*//' \
            | cut -d= -f2 | cut -d: -f1)"
        [[ " $KNOWN_ACTIONS " == *" $action "* ]] \
            || { echo "keybind action '$action' not in allow-list [$KNOWN_ACTIONS] (line: $kb)"; return 1; }
    done < <(conf_lines "$1" | grep -E '^keybind[[:space:]]*=')
}

chk_clipboard_osc52() {
    # Ghostty side of the OSC52 story: read and write must be allowed, or
    # tmux's set-clipboard/terminal-features OSC52 work is dead on arrival.
    local v
    v="$(conf_lines "$1" | sed -n 's/^clipboard-read[[:space:]]*=[[:space:]]*//p' | head -1)"
    [[ "$v" == "allow" ]] || { echo "clipboard-read is '${v:-unset}', expected allow (OSC52 read broken)"; return 1; }
    v="$(conf_lines "$1" | sed -n 's/^clipboard-write[[:space:]]*=[[:space:]]*//p' | head -1)"
    [[ "$v" == "allow" ]] || { echo "clipboard-write is '${v:-unset}', expected allow (OSC52 write broken)"; return 1; }
}

chk_inventory() {
    # Coverage-equivalent inventory: every tracked file under ghostty/**
    # must be covered; the root terminfo is covered by the terminfo checks.
    local expected actual
    expected="ghostty/.config/ghostty/config"
    actual="$(git -C "$REPO_ROOT" ls-files -- ghostty | sort)"
    if [[ "$actual" != "$expected" ]]; then
        echo "tracked files under ghostty/ changed; update the checks + this list:"
        diff <(echo "$expected") <(echo "$actual") | sed 's/^/  /'
        return 1
    fi
}

# ---------------------------------------------------------------------------
# Terminfo checks (real compile + round-trip via tic/infocmp)
# ---------------------------------------------------------------------------

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

TI1="$WORK/ti1"
TI2="$WORK/ti2"
mkdir -p "$TI1" "$TI2"

chk_terminfo_compile() {
    # PR #11 install surface: install.sh runs `tic -x -w` on this file.
    # Here it compiles into a mktemp dir — never $HOME.
    local out
    out="$(tic -o "$TI1" "$1" 2>&1)"
    [[ $? -eq 0 ]] || { echo "tic failed: $out"; return 1; }
    [[ -z "$out" ]] || { echo "tic emitted warnings: $out"; return 1; }
    [[ -f "$TI1/x/xterm-ghostty" ]] || { echo "compiled terminfo entry not found at $TI1/x/xterm-ghostty"; return 1; }
}

chk_terminfo_roundtrip() {
    # infocmp -x the compiled entry, re-compile it, infocmp again; the two
    # dumps must agree after stripping the volatile header comment.
    TERMINFO="$TI1" infocmp -1 -x xterm-ghostty 2>/dev/null \
        | grep -v '^#' >"$WORK/rt1" || { echo "infocmp failed on first dump"; return 1; }
    tic -o "$TI2" "$WORK/rt1" >/dev/null 2>&1 || { echo "second tic compile failed"; return 1; }
    TERMINFO="$TI2" infocmp -1 -x xterm-ghostty 2>/dev/null \
        | grep -v '^#' >"$WORK/rt2" || { echo "infocmp failed on second dump"; return 1; }
    cmp -s "$WORK/rt1" "$WORK/rt2" \
        || { echo "round-trip drift between the two infocmp dumps"; return 1; }
}

chk_terminfo_key_caps() {
    # Key capabilities after a real compile: 256 colors, 80x24 default
    # cells, 256-color SGR setaf/setab, rgb initc (direct-color path for
    # truecolor tools), kmous, and the full kf1..kf63 family.
    local dump="$WORK/rt1"
    [[ -s "$dump" ]] || { echo "no compiled dump available"; return 1; }
    local colors
    colors="$(sed -n 's/.*[[:space:]]colors#\([0-9x]\+\),\?$/\1/p' "$dump" | head -1)"
    [[ -n "$colors" ]] || { echo "colors# capability missing"; return 1; }
    # infocmp prints hex (0x100) on some ncurses versions, decimal elsewhere.
    colors=$(( colors ))
    [[ "$colors" -eq 256 ]] || { echo "colors#$colors, expected 256"; return 1; }
    grep -qE '^\s*cols#80,' "$dump" || { echo "cols#80 missing"; return 1; }
    grep -qE '^\s*lines#24,' "$dump" || { echo "lines#24 missing"; return 1; }
    grep -qE '^\s*setab=.*48;5;' "$dump" || { echo "setab lacks 256-color SGR (48;5)"; return 1; }
    grep -qE '^\s*setaf=.*38;5;' "$dump" || { echo "setaf lacks 256-color SGR (38;5)"; return 1; }
    grep -qE '^\s*initc=.*rgb' "$dump" || { echo "initc lacks rgb: (direct-color init)"; return 1; }
    grep -qE '^\s*kmous=' "$dump" || { echo "kmous missing (mouse reporting)"; return 1; }
    local n
    n="$(grep -cE '^\s*kf[0-9]+=' "$dump")"
    [[ "$n" -eq 63 ]] || { echo "kf* capability count is $n, expected 63 (kf1..kf63)"; return 1; }
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
    local total_t0
    total_t0="$(now_ms)"
    echo "== ghostty + terminfo checks (STRICT=$STRICT SANDBOX=$SANDBOX) =="

    # Ghostty config: shape checks, no ghostty binary needed.
    run_check ghostty-config-shape "$CONF" chk_shape "$CONF"
    run_check ghostty-known-keys "$CONF" chk_known_keys "$CONF"
    run_check ghostty-no-duplicate-keys "$CONF" chk_duplicate_keys "$CONF"
    run_check ghostty-palette-complete "$CONF" chk_palette_complete "$CONF"
    run_check ghostty-font-color-keys "$CONF" chk_font_color_keys "$CONF"
    run_check ghostty-keybind-actions "$CONF" chk_keybind_actions "$CONF"
    run_check ghostty-clipboard-osc52 "$CONF" chk_clipboard_osc52 "$CONF"
    run_check ghostty-inventory "ghostty/**" chk_inventory

    # Terminfo: real compile + round-trip, needs tic/infocmp.
    if command -v tic >/dev/null 2>&1 && command -v infocmp >/dev/null 2>&1; then
        run_check terminfo-compile "$TERMINFO_SRC" chk_terminfo_compile "$TERMINFO_SRC"
        run_check terminfo-roundtrip "$TERMINFO_SRC" chk_terminfo_roundtrip "$TERMINFO_SRC"
        run_check terminfo-key-caps "$TERMINFO_SRC" chk_terminfo_key_caps
    else
        local reason="tic/infocmp not found; install ncurses to run this check"
        local names=(terminfo-compile terminfo-roundtrip terminfo-key-caps)
        local n
        for n in "${names[@]}"; do
            if [[ "$STRICT" = "1" ]]; then
                report FAIL "$n" "$TERMINFO_SRC" "tic/infocmp not found (STRICT=1)" 0
            else
                report SKIP "$n" "$TERMINFO_SRC" "$reason" 0
            fi
        done
    fi

    if [[ "$SANDBOX" = "1" ]]; then
        sandbox
    fi

    echo "== ghostty + terminfo checks: $PASS_COUNT pass, $FAIL_COUNT fail, $SKIP_COUNT skip ($(( $(now_ms) - total_t0 )) ms) =="
    [[ "$FAIL_COUNT" -eq 0 ]]
}

# ---------------------------------------------------------------------------
# Negative self-test: mutate copies in mktemp, expect each check to FAIL.
# ---------------------------------------------------------------------------

expect_fail() {
    # expect_fail <label> <func> [args...] — PASS when the check FAILs.
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

rebuild_dump() {
    # rebuild_dump <terminfo-src> — compile into TI1 and refresh the rt1
    # dump so cap-level checks can run against a chosen mutation.
    rm -rf "$TI1"; mkdir -p "$TI1"
    tic -o "$TI1" "$1" >/dev/null 2>&1 || return 1
    TERMINFO="$TI1" infocmp -1 -x xterm-ghostty 2>/dev/null \
        | grep -v '^#' >"$WORK/rt1"
}

sandbox() {
    local m="$WORK/mut"
    mkdir -p "$m"

    cp "$CONF" "$m/badshape.config"
    printf 'this line is not key value\n' >>"$m/badshape.config"
    expect_fail config-shape chk_shape "$m/badshape.config"

    cp "$CONF" "$m/dupkey.config"
    printf 'font-size = 20\n' >>"$m/dupkey.config"
    expect_fail duplicate-keys chk_duplicate_keys "$m/dupkey.config"

    cp "$CONF" "$m/gappalette.config"
    sed -i '/^palette = 7=/d' "$m/gappalette.config"
    expect_fail palette-complete chk_palette_complete "$m/gappalette.config"

    cp "$CONF" "$m/typokey.config"
    printf 'font-fmaily = "X"\n' >>"$m/typokey.config"
    expect_fail known-keys chk_known_keys "$m/typokey.config"

    cp "$CONF" "$m/badbind.config"
    printf 'keybind = ctrl+a=confirm_close_surface\n' >>"$m/badbind.config"
    expect_fail keybind-actions chk_keybind_actions "$m/badbind.config"

    cp "$CONF" "$m/noclip.config"
    sed -i '/^clipboard-read =/d' "$m/noclip.config"
    expect_fail clipboard-osc52 chk_clipboard_osc52 "$m/noclip.config"

    # Terminfo mutations.
    cp "$TERMINFO_SRC" "$m/lowcolor.terminfo"
    sed -i 's/colors#256/colors#8/' "$m/lowcolor.terminfo"
    rebuild_dump "$m/lowcolor.terminfo" || { echo "lowcolor mutation failed to compile"; }
    expect_fail terminfo-key-caps-lowcolor chk_terminfo_key_caps

    cp "$TERMINFO_SRC" "$m/nomouse.terminfo"
    sed -i 's/kmous=\\E\[M, //' "$m/nomouse.terminfo"
    rebuild_dump "$m/nomouse.terminfo" || { echo "nomouse mutation failed to compile"; }
    expect_fail terminfo-key-caps-nomouse chk_terminfo_key_caps

    cp "$TERMINFO_SRC" "$m/garbage.terminfo"
    printf 'not valid terminfo syntax!!!\n' >>"$m/garbage.terminfo"
    expect_fail terminfo-compile-garbage chk_terminfo_compile "$m/garbage.terminfo"
}

main "$@"
