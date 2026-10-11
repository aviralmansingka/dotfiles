#!/usr/bin/env bash
# Paths: zsh/**
# zsh layer checks (CI surface: tracked shell dotfile contracts).
#
# Checks (PRs #13/#20/#21/#26):
#   zsh-syntax     : zsh -n over every tracked zsh/ file.
#   zshenv-path    : a non-login, non-interactive zsh (only .zshenv sourced)
#                    resolves cargo, starship, uv, zoxide, direnv from their
#                    canonical home bin dirs, prepended on PATH (#13/#20).
#   zshenv-exit0   : sourcing .zshenv alone exits 0 and never needs .zshrc.
#   term-rc        : .zshrc exports TERM=xterm-256color - never xterm-ghostty -
#                    for interactive and non-interactive sourcing outside
#                    tmux (#21); inside tmux ($TMUX set) TERM is left alone
#                    (tmux-256color survives - the B23 guard).
#   term-env       : .zshenv leaves TERM alone and never sets xterm-ghostty.
#   term-content   : no tracked zsh file references xterm-ghostty as a TERM
#                    value (#21).
#   alias-targets  : every alias target resolves in a stub PATH, is a repo
#                    file, or sits on the host-only allowlist (#26).
#   guard-struct   : the starship/zoxide/direnv init blocks in .zshrc are
#                    command -v-guarded on the same line.
#   guard-behavior : .zshrc sourced with those tools absent exits 0 with
#                    clean stderr.
#   idempotent     : sourcing .zshenv + .zshrc twice adds no duplicate PATH
#                    entries and keeps the PATH value stable.
#
# Dual-mode pattern (PR #293 rule):
#   default : a missing zsh prints SKIP with a message and does not fail.
#   STRICT=1: a missing zsh FAILs. Use this mode in CI.
#
# Every check prints PASS/FAIL/SKIP with file and reason, plus timing.
# Deterministic: fake homes under mktemp, controlled env via `env -i`,
# stub binaries, no network (a stub curl shadows the real one inside the
# sandbox), no $HOME mutation, no sleeps.
#
# SELFTEST=1 reruns every check against mutated copies of zsh/ (bad TERM,
# dropped guard, ...) and FAILs unless each mutation trips its check. This
# proves the checks catch their regressions.

set -uo pipefail

STRICT="${STRICT:-0}"
SELFTEST="${SELFTEST:-0}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ZSH_SRC="${ZSH_SRC:-$REPO_ROOT/zsh}"
# Aliases whose targets live in home checkouts outside this repo:
# dvim -> $HOME/tools/neovim (a Neovim source checkout, not this repo).
HOST_ONLY_ALIASES="dvim"

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

now_ms() {
    local t
    t="$(date +%s%N 2>/dev/null || true)"
    # GNU date: seconds+nanoseconds -> divide to ms.
    # BSD date (macOS): no %N, output ends in N or is empty -> seconds -> ms.
    case "$t" in
        *N|'') t="$(( $(date +%s) * 1000 ))" ;;
        *) t="$(( t / 1000000 ))" ;;
    esac
    printf '%s' "$t"
}

report() {
    # $1 status  $2 check name  $3 file  $4 reason  $5 ms
    printf '%s %-16s %s | %s (%s ms)\n' "$1" "$2" "$3" "$4" "$5"
    case "$1" in
        PASS) PASS_COUNT=$((PASS_COUNT + 1)) ;;
        FAIL) FAIL_COUNT=$((FAIL_COUNT + 1)) ;;
        SKIP) SKIP_COUNT=$((SKIP_COUNT + 1)) ;;
    esac
}

ZSH_BIN="$(command -v zsh 2>/dev/null || true)"

TOTAL_START="$(now_ms)"

echo "== zsh checks (STRICT=$STRICT SELFTEST=$SELFTEST) =="

if [ -z "$ZSH_BIN" ]; then
    if [ "$STRICT" = "1" ]; then
        report FAIL zsh-runtime "zsh" "zsh not found (STRICT=1); CI installs zsh" 0
    else
        report SKIP zsh-runtime "zsh" "zsh not found; install zsh to run these checks" 0
    fi
    TOTAL_MS="$(( $(now_ms) - TOTAL_START ))"
    echo "== zsh: $PASS_COUNT pass, $FAIL_COUNT fail, $SKIP_COUNT skip (total ${TOTAL_MS} ms) =="
    [ "$FAIL_COUNT" -eq 0 ]
    exit $?
fi

# ---------------------------------------------------------------------------
# Sandbox helpers: fake homes under mktemp, never $HOME.
# mk_home sets the global SB_HOME (no command substitution, so the cleanup
# trap keeps track of every home it makes).
# ---------------------------------------------------------------------------

# Registry file for fake homes: subshells (selftest) inherit the path and
# append to it, so the cleanup trap removes every home, subshell or not.
SANDBOX_REGISTRY="$(mktemp "${TMPDIR:-/tmp}/zsh-test-registry.XXXXXX")"

cleanup() {
    if [ -s "$SANDBOX_REGISTRY" ]; then
        # One mktemp dir per line; this run owns the whole registry.
        while IFS= read -r d; do
            [ -n "$d" ] && rm -rf -- "$d" 2>/dev/null
        done < "$SANDBOX_REGISTRY"
    fi
    rm -f "$SANDBOX_REGISTRY" 2>/dev/null
    return 0
}
trap cleanup EXIT

register_home() {
    printf '%s\n' "$1" >> "$SANDBOX_REGISTRY"
}

stub_bin() {
    # $1 dir  $2.. names: create executable no-op stubs.
    local dir=$1 name
    shift
    mkdir -p "$dir"
    for name in "$@"; do
        printf '#!/bin/sh\n' > "$dir/$name"
        chmod +x "$dir/$name"
    done
}

mk_home() {
    # $1 src zsh dir  $2 mode: zshenv-only | rc-tools | rc-notools | rc-alias
    # Sets SB_HOME to the fake home path.
    local src=$1 mode=$2 h
    h="$(mktemp -d "${TMPDIR:-/tmp}/zsh-test-home.XXXXXX")"
    register_home "$h"
    cp "$src/.zshenv" "$h/.zshenv" 2>/dev/null || true
    case $mode in
        zshenv-only)
            # Only .zshenv: proves a zsh -c never needs .zshrc. Tool stubs in
            # their canonical home bin dirs: cargo in ~/.cargo/bin, the rest
            # in ~/.local/bin. A stub .cargo/env exercises the source branch.
            stub_bin "$h/.cargo/bin" cargo
            stub_bin "$h/.local/bin" starship uv zoxide direnv
            printf 'export PATH="$HOME/.cargo/bin:$PATH"\n' > "$h/.cargo/env"
            ;;
        rc-*)
            cp "$src/.zshrc" "$h/.zshrc" 2>/dev/null || true
            # oh-my-zsh stub: the install branch and omz sourcing stay offline.
            mkdir -p "$h/.oh-my-zsh"
            : > "$h/.oh-my-zsh/oh-my-zsh.sh"
            # Stub curl shadows the real one: an accidental network fetch in
            # the sandbox fails fast instead of going online.
            stub_bin "$h/.local/bin" curl
            case $mode in
                rc-tools)   stub_bin "$h/.local/bin" starship zoxide direnv uv ;;
                rc-notools) : ;;
                rc-alias)   stub_bin "$h/.local/bin" rg eza uv gh ;;
            esac
            ;;
        *) echo "mk_home: unknown mode $mode" >&2; return 1 ;;
    esac
    SB_HOME="$h"
}

runzsh() {
    # $1 fake home  $2 TERM for the sandbox  remaining args: zsh args.
    local h=$1 term=$2
    shift 2
    env -i HOME="$h" PATH=/usr/bin:/bin TERM="$term" "$ZSH_BIN" "$@"
}

runzsh_tmux() {
    # Same as runzsh, but simulates a shell inside a tmux pane: $TMUX is
    # set, so .zshrc must leave TERM exactly as tmux provided it (B23).
    local h=$1 term=$2
    shift 2
    env -i HOME="$h" PATH=/usr/bin:/bin TERM="$term" \
        TMUX="/tmp/tmux-0/default,12345,0" "$ZSH_BIN" "$@"
}

# ---------------------------------------------------------------------------
# Checks. Each takes the zsh dir under test and returns non-zero on failure.
# ---------------------------------------------------------------------------

zsh_names() {
    # File names (relative to the zsh dir), sorted. git first, find fallback.
    local names
    names="$(git -C "$REPO_ROOT" ls-files -- zsh/ 2>/dev/null | sed 's|^zsh/||' | sort)"
    if [ -z "$names" ]; then
        names="$(find "$1" -type f 2>/dev/null | sed "s|^$1/||" | sort)"
    fi
    printf '%s\n' "$names"
}

check_syntax() {
    local src=$1 rc=0 f t0
    while IFS= read -r f; do
        [ -n "$f" ] || continue
        t0="$(now_ms)"
        if "$ZSH_BIN" -n "$src/$f" >/dev/null 2>&1; then
            report PASS zsh-syntax "zsh/$f" "parses (zsh -n)" "$(( $(now_ms) - t0 ))"
        else
            report FAIL zsh-syntax "zsh/$f" "zsh -n reports a parse error" "$(( $(now_ms) - t0 ))"
            rc=1
        fi
    done < <(zsh_names "$src")
    return $rc
}

check_zshenv_path() {
    local src=$1 rc=0 t0 h out
    mk_home "$src" zshenv-only
    h=$SB_HOME
    t0="$(now_ms)"
    out="$(runzsh "$h" xterm-256color -c '
        for t in cargo starship uv zoxide direnv; do
            command -v -- $t >/dev/null 2>&1 || print -r -- "MISSING:$t"
        done
        [[ $PATH == "$HOME/.cargo/bin:$HOME/.local/bin:"* ]] || print -r -- "NOTPREPENDED"
    ' 2>&1)"
    if [ -n "$out" ]; then
        report FAIL zshenv-path "zsh/.zshenv" "non-interactive zsh -c contract broken: $(echo "$out" | tr '\n' ' ')" "$(( $(now_ms) - t0 ))"
        rc=1
    else
        report PASS zshenv-path "zsh/.zshenv" "zsh -c with only .zshenv resolves cargo/starship/uv/zoxide/direnv, home bins prepended (#13/#20)" "$(( $(now_ms) - t0 ))"
    fi
    return $rc
}

check_zshenv_exit0() {
    local src=$1 rc=0 t0 h
    h="$(mktemp -d "${TMPDIR:-/tmp}/zsh-test-home.XXXXXX")"
    register_home "$h"
    cp "$src/.zshenv" "$h/.zshenv" 2>/dev/null || true
    # No .zshrc in the fake home: sourcing must not need it.
    t0="$(now_ms)"
    if runzsh "$h" xterm-256color -c '. $HOME/.zshenv' >/dev/null 2>&1 \
        && runzsh "$h" xterm-256color -c 'true' >/dev/null 2>&1 \
        && ! grep -Eq 'zshrc|oh-my-zsh' "$h/.zshenv" 2>/dev/null; then
        report PASS zshenv-exit0 "zsh/.zshenv" "sourcing .zshenv alone exits 0, no .zshrc needed" "$(( $(now_ms) - t0 ))"
    else
        report FAIL zshenv-exit0 "zsh/.zshenv" "sourcing .zshenv must exit 0 and never reference .zshrc/oh-my-zsh" "$(( $(now_ms) - t0 ))"
        rc=1
    fi
    return $rc
}

check_term_rc() {
    local src=$1 rc=0 t0 h v
    mk_home "$src" rc-notools
    h=$SB_HOME
    t0="$(now_ms)"
    v="$(runzsh "$h" xterm-ghostty -c 'source $HOME/.zshrc; print -r -- $TERM' 2>/dev/null)"
    if [ "$v" = "xterm-256color" ]; then
        report PASS term-rc "zsh/.zshrc" "non-interactive sourcing exports TERM=xterm-256color even when TERM=xterm-ghostty (#21)" "$(( $(now_ms) - t0 ))"
    else
        report FAIL term-rc "zsh/.zshrc" "non-interactive TERM is '$v', must be xterm-256color (#21)" "$(( $(now_ms) - t0 ))"
        rc=1
    fi
    t0="$(now_ms)"
    v="$(runzsh "$h" xterm-ghostty -i -c 'print -r -- $TERM' </dev/null 2>/dev/null)"
    if [ "$v" = "xterm-256color" ]; then
        report PASS term-rc "zsh/.zshrc" "interactive shell exports TERM=xterm-256color even when TERM=xterm-ghostty (#21)" "$(( $(now_ms) - t0 ))"
    else
        report FAIL term-rc "zsh/.zshrc" "interactive TERM is '$v', must be xterm-256color (#21)" "$(( $(now_ms) - t0 ))"
        rc=1
    fi
    # Inside a tmux pane ($TMUX set) the export must be skipped: tmux sets
    # tmux-256color there and a .zshrc override breaks the pane contract.
    t0="$(now_ms)"
    v="$(runzsh_tmux "$h" tmux-256color -i -c 'print -r -- $TERM' </dev/null 2>/dev/null)"
    if [ "$v" = "tmux-256color" ]; then
        report PASS term-rc "zsh/.zshrc" "inside tmux (\$TMUX set) .zshrc leaves TERM untouched (tmux-256color survives) (B23)" "$(( $(now_ms) - t0 ))"
    else
        report FAIL term-rc "zsh/.zshrc" "inside-tmux interactive TERM is '$v', must stay tmux-256color (no export when \$TMUX is set) (B23)" "$(( $(now_ms) - t0 ))"
        rc=1
    fi
    t0="$(now_ms)"
    v="$(runzsh_tmux "$h" tmux-256color -c 'source $HOME/.zshrc; print -r -- $TERM' 2>/dev/null)"
    if [ "$v" = "tmux-256color" ]; then
        report PASS term-rc "zsh/.zshrc" "inside tmux, non-interactive sourcing also leaves TERM alone (B23)" "$(( $(now_ms) - t0 ))"
    else
        report FAIL term-rc "zsh/.zshrc" "inside-tmux non-interactive TERM is '$v', must stay tmux-256color (B23)" "$(( $(now_ms) - t0 ))"
        rc=1
    fi
    return $rc
}

check_term_env() {
    local src=$1 rc=0 t0 h v
    h="$(mktemp -d "${TMPDIR:-/tmp}/zsh-test-home.XXXXXX")"
    register_home "$h"
    cp "$src/.zshenv" "$h/.zshenv" 2>/dev/null || true
    t0="$(now_ms)"
    v="$(runzsh "$h" xterm-256color -c 'print -r -- $TERM' 2>/dev/null)"
    if [ "$v" = "xterm-256color" ]; then
        report PASS term-env "zsh/.zshenv" ".zshenv leaves TERM alone (or sets xterm-256color), never xterm-ghostty (#21)" "$(( $(now_ms) - t0 ))"
    else
        report FAIL term-env "zsh/.zshenv" ".zshenv must not move TERM away from xterm-256color (got '$v') (#21)" "$(( $(now_ms) - t0 ))"
        rc=1
    fi
    return $rc
}

check_term_content() {
    local src=$1 rc=0 f t0
    while IFS= read -r f; do
        [ -n "$f" ] || continue
        t0="$(now_ms)"
        if grep -Fq 'xterm-ghostty' "$src/$f" 2>/dev/null; then
            report FAIL term-content "zsh/$f" "references xterm-ghostty; that TERM leak broke RGB/clipboard in tmux/SSH (#21)" "$(( $(now_ms) - t0 ))"
            rc=1
        else
            report PASS term-content "zsh/$f" "no xterm-ghostty TERM value" "$(( $(now_ms) - t0 ))"
        fi
    done < <(zsh_names "$src")
    return $rc
}

check_alias_targets() {
    # Repo-defined aliases only: lines in .zshrc of the form `alias n=v`.
    # zsh built-in default aliases (run-help, which-command, ...) are not
    # repo definitions, and their targets (man, whence) are host-dependent.
    # HOST_ONLY: aliases that target home checkouts outside this repo:
    #   dvim -> $HOME/tools/neovim (a Neovim source checkout, not this repo).
    local src=$1 rc=0 t0 h name value word rest
    local -a names=()
    mk_home "$src" rc-alias
    h=$SB_HOME
    t0="$(now_ms)"
    while IFS= read -r name; do
        [ -n "$name" ] || continue
        names+=("$name")
    done < <(grep -E '^alias[[:space:]]+[A-Za-z0-9_.-]+=' "$src/.zshrc" 2>/dev/null \
        | sed -E 's|^alias[[:space:]]+([A-Za-z0-9_.-]+)=.*|\1|' | sort)
    if [ "${#names[@]}" -eq 0 ]; then
        report FAIL alias-targets "zsh/.zshrc" "no alias definitions found in .zshrc (#26)" "$(( $(now_ms) - t0 ))"
        return 1
    fi
    for name in "${names[@]}"; do
        # Value: text after `alias name=`, surrounding quotes stripped.
        value="$(grep -E "^alias[[:space:]]+$name=" "$src/.zshrc" | head -1 | sed -E "s|^alias[[:space:]]+$name=||")"
        value="${value%\"}"; value="${value#\"}"
        value="${value%\'}"; value="${value#\'}"
        word="${value%%[[:space:]]*}"
        case $word in
            '$HOME'/*|'~'/*|/*)
                rest="${word#\$HOME/}"; rest="${rest#\~/}"
                if [ -f "$REPO_ROOT/$rest" ]; then
                    report PASS alias-targets "zsh/.zshrc" "alias '$name': target is a tracked repo file" "$(( $(now_ms) - t0 ))"
                elif [[ " $HOST_ONLY_ALIASES " == *" $name "* ]]; then
                    report PASS alias-targets "zsh/.zshrc" "alias '$name': host-only target '$word' (home checkout, allowlisted)" "$(( $(now_ms) - t0 ))"
                else
                    report FAIL alias-targets "zsh/.zshrc" "alias '$name' target '$word' is neither a repo file nor allowlisted (#26)" "$(( $(now_ms) - t0 ))"
                    rc=1
                fi ;;
            *)
                # Defined after sourcing, and the binary resolves in the stub PATH.
                # (name and word pass as positional parameters, not interpolation)
                if runzsh "$h" xterm-256color -c \
                    'source $HOME/.zshrc; [[ -n $aliases[$1] ]] && command -v -- $2' \
                    zsh "$name" "$word" >/dev/null 2>&1; then
                    report PASS alias-targets "zsh/.zshrc" "alias '$name': binary '$word' resolves in the stub PATH" "$(( $(now_ms) - t0 ))"
                else
                    report FAIL alias-targets "zsh/.zshrc" "alias '$name': binary '$word' resolves nowhere after sourcing (#26)" "$(( $(now_ms) - t0 ))"
                    rc=1
                fi ;;
        esac
    done
    return $rc
}

check_guard_struct() {
    local src=$1 rc=0 tool arg pat t0
    for tool in starship zoxide direnv; do
        case $tool in
            direnv) arg="hook" ;;
            *)      arg="init" ;;
        esac
        t0="$(now_ms)"
        pat='eval "$('"$tool $arg zsh"')"'
        if ! grep -Fq "$pat" "$src/.zshrc" 2>/dev/null; then
            report FAIL guard-struct "zsh/.zshrc" "$tool $arg zsh block missing (#26)" "$(( $(now_ms) - t0 ))"
            rc=1
        elif ! grep -F "$pat" "$src/.zshrc" 2>/dev/null | grep -Fq "command -v $tool"; then
            report FAIL guard-struct "zsh/.zshrc" "$tool $arg zsh eval is not command -v-guarded on its line (#26)" "$(( $(now_ms) - t0 ))"
            rc=1
        else
            report PASS guard-struct "zsh/.zshrc" "$tool $arg zsh eval is command -v-guarded" "$(( $(now_ms) - t0 ))"
        fi
    done
    return $rc
}

check_guard_behavior() {
    local src=$1 rc=0 t0 h err rcz
    mk_home "$src" rc-notools
    h=$SB_HOME
    t0="$(now_ms)"
    err="$(runzsh "$h" xterm-256color -c 'source $HOME/.zshrc' 2>&1 >/dev/null)"
    rcz=$?
    if [ "$rcz" -eq 0 ] && ! printf '%s' "$err" | grep -Fq 'command not found'; then
        report PASS guard-behavior "zsh/.zshrc" "sourcing with starship/zoxide/direnv absent exits 0 with clean stderr" "$(( $(now_ms) - t0 ))"
    else
        report FAIL guard-behavior "zsh/.zshrc" "missing tools must not break or spam startup (exit=$rcz, stderr: $(printf '%s' "$err" | tr '\n' ' '))" "$(( $(now_ms) - t0 ))"
        rc=1
    fi
    return $rc
}

check_idempotent() {
    local src=$1 rc=0 t0 h out
    mk_home "$src" rc-tools
    h=$SB_HOME
    t0="$(now_ms)"
    out="$(runzsh "$h" xterm-256color -c '
        source $HOME/.zshenv
        source $HOME/.zshrc
        p1=$PATH
        source $HOME/.zshenv
        source $HOME/.zshrc
        [[ $PATH == $p1 ]] || print -r -- UNSTABLE
        typeset -A cnt
        typeset d
        for d in $path; do
            cnt[$d]=$(( ${cnt[$d]:-0} + 1 ))
            (( cnt[$d] > 1 )) && print -r -- "DUP:$d"
        done
    ' 2>&1)"
    if [ -n "$out" ]; then
        report FAIL idempotent "zsh/.zshenv+zsh/.zshrc" "re-sourcing changed PATH: $(echo "$out" | tr '\n' ' ')" "$(( $(now_ms) - t0 ))"
        rc=1
    else
        report PASS idempotent "zsh/.zshenv+zsh/.zshrc" "sourcing twice keeps the PATH value stable with no duplicate entries" "$(( $(now_ms) - t0 ))"
    fi
    return $rc
}

# ---------------------------------------------------------------------------
# Main run.
# ---------------------------------------------------------------------------

ALL_CHECKS="check_syntax check_zshenv_path check_zshenv_exit0 check_term_rc check_term_env check_term_content check_alias_targets check_guard_struct check_guard_behavior check_idempotent"

for chk in $ALL_CHECKS; do
    "$chk" "$ZSH_SRC" || true
done

# ---------------------------------------------------------------------------
# Selftest: each mutation must trip its check; the pristine tree must pass.
# Every mutation stays offline and deterministic (sed, printf).
# ---------------------------------------------------------------------------

if [ "$SELFTEST" = "1" ]; then
    mut_sed() { # $1 file  $2 sed expr (portable in-place via .bak)
        sed -i.bak "$2" "$1" && rm -f "$1.bak"
    }
    st_run() { # $1 check fn  $2 label  $3 mutation shell snippet
        local chk=$1 label=$2 mut=$3 tmp caught=1
        tmp="$(mktemp -d "${TMPDIR:-/tmp}/zsh-test-mut.XXXXXX")"
        register_home "$tmp"
        cp -r "$ZSH_SRC/." "$tmp/"
        ( cd "$tmp" && eval "$mut" ) >/dev/null 2>&1
        if ( "$chk" "$tmp" ) >/dev/null 2>&1; then
            caught=0
        fi
        rm -rf "$tmp"
        if [ "$caught" -eq 1 ]; then
            report PASS "selftest-$label" "zsh/*" "mutation caught by $chk" 0
        else
            report FAIL "selftest-$label" "zsh/*" "mutation NOT caught by $chk" 0
        fi
    }
    st_pristine() { # every check must pass on the pristine tree
        local chk ok=1
        for chk in $ALL_CHECKS; do
            if ! ( "$chk" "$ZSH_SRC" ) >/dev/null 2>&1; then
                report FAIL selftest-pristine "zsh/*" "$chk fails on the pristine tree" 0
                ok=0
            fi
        done
        if [ "$ok" -eq 1 ]; then
            report PASS selftest-pristine "zsh/*" "all checks pass on the pristine tree" 0
        fi
        return $ok
    }

    echo "== zsh selftest: mutations must trip their checks =="
    st_pristine || true
    st_run check_syntax         syntax       "printf 'if [[ -n broken\n' >> .zshrc"
    st_run check_zshenv_path    zshenv-path  "mut_sed .zshenv 's|\$HOME/.local/bin:||'"
    st_run check_zshenv_exit0   zshenv-exit  "printf 'false\n' >> .zshenv"
    st_run check_term_rc        term-rc      "mut_sed .zshrc 's|export TERM=\"xterm-256color\"|export TERM=\"xterm-ghostty\"|'"
    st_run check_term_rc        term-guard   "printf 'export TERM=\"xterm-256color\"\n' >> .zshrc"
    st_run check_term_env       term-env     "printf 'export TERM=\"xterm-ghostty\"\n' >> .zshenv"
    st_run check_term_content   term-content "mut_sed .zshrc 's|export TERM=\"xterm-256color\"|export TERM=\"xterm-ghostty\"|'"
    st_run check_alias_targets  alias-drop   "mut_sed .zshrc \"s|alias ghd='gh dash'|alias ghd='gh-dash-missing'|\""
    st_run check_guard_struct   guard-drop   "mut_sed .zshrc 's|command -v starship >/dev/null 2>&1 && ||'"
    st_run check_guard_behavior guard-drop   "mut_sed .zshrc 's|command -v starship >/dev/null 2>&1 && ||'"
    st_run check_idempotent     dedup-drop   "mut_sed .zshenv '/^typeset -U path PATH$/d'"
fi

TOTAL_MS="$(( $(now_ms) - TOTAL_START ))"
echo "== zsh: $PASS_COUNT pass, $FAIL_COUNT fail, $SKIP_COUNT skip (total ${TOTAL_MS} ms) =="

[ "$FAIL_COUNT" -eq 0 ]
