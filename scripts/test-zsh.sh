#!/usr/bin/env bash
# Paths: zsh/** nix/modules/shared/default.nix
# zsh layer checks (CI surface: tracked shell dotfile contracts).
#
# Checks (PRs #13/#20/#21/#26, mission zsh-to-nix S01/S02):
#   zsh-syntax     : zsh -n over every tracked zsh/ file.
#   env-owner      : no tracked zsh file assigns PATH; the profile owns it.
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
#   dead-config    : no tracked zsh file carries a block for a tool this fleet
#                    does not have (nvm, the oh-my-zsh curl installer, the
#                    google-cloud-sdk).
#   alias-targets  : every programs.zsh.shellAliases target resolves in a stub
#                    PATH, is a repo file, or sits on the host-only allowlist
#                    (#26).
#   profile-owner  : starship, zoxide, direnv and fzf are home-manager program
#                    modules, and no tracked zsh file evals a tool init.
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
# (none currently — dvim was removed with the dead-code cleanup)
HOST_ONLY_ALIASES=""
# The aliases and the tool hooks moved out of the shell text: zsh/.zshrc keeps
# only what has no declarative form (mission zsh-to-nix S02). These checks read
# the module that owns them. SHARED_NIX_FILE is overridable so the selftest can
# point them at a mutated copy.
SHARED_NIX_FILE="${SHARED_NIX_FILE:-$REPO_ROOT/nix/modules/shared/default.nix}"

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
            # Only .zshenv: proves a zsh -c never needs .zshrc. The PATH and the
            # environment come from the Nix-generated hm-session-vars.sh, so the
            # sandbox carries a stand-in for it: the guarded source branch.
            stub_bin "$h/.cargo/bin" cargo
            stub_bin "$h/.local/bin" starship uv zoxide direnv
            mkdir -p "$h/.nix-profile/etc/profile.d"
            cat > "$h/.nix-profile/etc/profile.d/hm-session-vars.sh" <<'HSV'
export EDITOR=nvim
export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
HSV
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
    # The fake home's bin comes from the caller now, not from .zshrc: the
    # profile owns PATH and the sandbox has no profile.
    local h=$1 term=$2
    shift 2
    env -i HOME="$h" PATH="$h/.local/bin:/usr/bin:/bin" TERM="$term" "$ZSH_BIN" "$@"
}

runzsh_tmux() {
    # Same as runzsh, but simulates a shell inside a tmux pane: $TMUX is
    # set, so .zshrc must leave TERM exactly as tmux provided it (B23).
    local h=$1 term=$2
    shift 2
    env -i HOME="$h" PATH="$h/.local/bin:/usr/bin:/bin" TERM="$term" \
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
        [[ $EDITOR == nvim ]] || print -r -- "NO-SESSION-VARS"
        [[ $PATH == "$HOME/.cargo/bin:$HOME/.local/bin:"* ]] || print -r -- "NOTPREPENDED"
    ' 2>&1)"
    if [ -n "$out" ]; then
        report FAIL zshenv-path "zsh/.zshenv" "non-interactive zsh -c contract broken: $(echo "$out" | tr '\n' ' ')" "$(( $(now_ms) - t0 ))"
        rc=1
    else
        report PASS zshenv-path "zsh/.zshenv" "zsh -c with only .zshenv sources hm-session-vars.sh, so EDITOR and the home bins are present (#13/#20)" "$(( $(now_ms) - t0 ))"
    fi
    # With no profile on the host the guarded source is skipped and the shell
    # still starts clean: PATH is exactly what the caller passed in.
    local bare
    bare="$(mktemp -d "${TMPDIR:-/tmp}/zsh-test-home.XXXXXX")"
    register_home "$bare"
    cp "$src/.zshenv" "$bare/.zshenv" 2>/dev/null || true
    t0="$(now_ms)"
    # Compare before and after: the host's own /etc/zshenv may rewrite PATH
    # (nix-darwin does), so the contract is "unchanged", not a literal value.
    out="$(runzsh "$bare" xterm-256color -c '
        before=$PATH
        . $HOME/.zshenv
        [[ $PATH == $before ]] || print -r -- "CHANGED:$before -> $PATH"
    ' 2>&1)"
    if [ -z "$out" ]; then
        report PASS zshenv-path "zsh/.zshenv" "no hm-session-vars.sh on the host: PATH untouched, shell exits 0" "$(( $(now_ms) - t0 ))"
    else
        report FAIL zshenv-path "zsh/.zshenv" "without a Nix profile PATH must stay as inherited (got: $(echo "$out" | tr '\n' ' '))" "$(( $(now_ms) - t0 ))"
        rc=1
    fi
    return $rc
}

# The environment belongs to the flake now: nix/modules/shared/default.nix
# declares home.sessionPath and home.sessionVariables. A tracked zsh file that
# assigns PATH again silently overrides the profile, so it is a hard failure.
check_env_owner() {
    local src=$1 rc=0 t0 f hits
    while IFS= read -r f; do
        [ -n "$f" ] || continue
        t0="$(now_ms)"
        hits="$(grep -nE '^[[:space:]]*(export[[:space:]]+)?PATH=' "$src/$f" 2>/dev/null | tr '\n' ' ')"
        if [ -n "$hits" ]; then
            report FAIL env-owner "zsh/$f" "assigns PATH ($hits); home.sessionPath in nix/modules/shared/default.nix owns it" "$(( $(now_ms) - t0 ))"
            rc=1
        else
            report PASS env-owner "zsh/$f" "no PATH assignment; the profile owns PATH" "$(( $(now_ms) - t0 ))"
        fi
    done < <(zsh_names "$src")
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

alias_pairs_from_module() {
    # Every `name = "value";` line inside `shellAliases = { ... }` in the shared
    # module, printed as `name=value`. A line the reader cannot read is printed
    # as `UNPARSED:<line>` so the caller fails loudly instead of skipping an
    # alias silently.
    local line t name value in_block=0
    while IFS= read -r line; do
        if [ "$in_block" = 0 ]; then
            case $line in *"shellAliases = {"*) in_block=1 ;; esac
            continue
        fi
        case $line in *"};"*) in_block=0; continue ;; esac
        t="${line#"${line%%[![:space:]]*}"}"
        [ -z "$t" ] && continue
        case $t in \#*) continue ;; esac
        # Kept bash-3.2-safe: no quoting inside the pattern (the guard is a
        # tracked-shell contract, and macOS /bin/bash is 3.2).
        if [[ $t =~ ^([A-Za-z0-9_.-]+)[[:space:]]+=[[:space:]]+(.*)\;$ ]]; then
            name="${BASH_REMATCH[1]}"
            value="${BASH_REMATCH[2]}"
            value="${value#\"}"
            value="${value%\"}"
            printf '%s=%s\n' "$name" "$value"
        else
            printf 'UNPARSED:%s\n' "$t"
        fi
    done < "$SHARED_NIX_FILE"
}

check_alias_targets() {
    # The repo's own aliases live in programs.zsh.shellAliases now (S02), so the
    # source of truth is the module, not .zshrc. Home Manager writes them as
    # `alias -- name='value'` at the end of the generated rc.
    local src=$1 rc=0 t0 h pair name value word rest
    local -a pairs=()
    mk_home "$src" rc-alias
    h=$SB_HOME
    t0="$(now_ms)"
    while IFS= read -r pair; do
        [ -n "$pair" ] && pairs+=("$pair")
    done < <(alias_pairs_from_module)
    if [ "${#pairs[@]}" -eq 0 ]; then
        report FAIL alias-targets "nix/modules/shared/default.nix" "no aliases found in programs.zsh.shellAliases (#26)" "$(( $(now_ms) - t0 ))"
        return 1
    fi
    for pair in "${pairs[@]}"; do
        case $pair in
            UNPARSED:*)
                report FAIL alias-targets "nix/modules/shared/default.nix" "unreadable programs.zsh.shellAliases line: ${pair#UNPARSED:}" "$(( $(now_ms) - t0 ))"
                rc=1
                continue ;;
        esac
        name="${pair%%=*}"
        value="${pair#*=}"
        word="${value%%[[:space:]]*}"
        case $word in
            '$HOME'/*|'~'/*|/*)
                rest="${word#\$HOME/}"; rest="${rest#\~/}"
                if [ -f "$REPO_ROOT/$rest" ]; then
                    report PASS alias-targets "nix/modules/shared/default.nix" "alias '$name': target is a tracked repo file" "$(( $(now_ms) - t0 ))"
                elif [[ " $HOST_ONLY_ALIASES " == *" $name "* ]]; then
                    report PASS alias-targets "nix/modules/shared/default.nix" "alias '$name': host-only target '$word' (home checkout, allowlisted)" "$(( $(now_ms) - t0 ))"
                else
                    report FAIL alias-targets "nix/modules/shared/default.nix" "alias '$name' target '$word' is neither a repo file nor allowlisted (#26)" "$(( $(now_ms) - t0 ))"
                    rc=1
                fi ;;
            *)
                # The binary must resolve in the stub PATH. The stub dir is
                # prepended inside the shell: no tracked zsh file manages PATH
                # (the profile does), and a host's global rc may rebuild it.
                if runzsh "$h" xterm-256color -c \
                    'PATH=$HOME/.local/bin:$PATH; command -v -- $1' \
                    zsh "$word" >/dev/null 2>&1; then
                    report PASS alias-targets "nix/modules/shared/default.nix" "alias '$name': binary '$word' resolves in the stub PATH" "$(( $(now_ms) - t0 ))"
                else
                    report FAIL alias-targets "nix/modules/shared/default.nix" "alias '$name': binary '$word' resolves nowhere (#26)" "$(( $(now_ms) - t0 ))"
                    rc=1
                fi ;;
        esac
    done
    return $rc
}

check_dead_config() {
    # Blocks for tools this fleet does not have. Each one used to sit in the
    # tracked .zshrc: ~/.nvm never existed, the oh-my-zsh curl installer ran on
    # every shell start on a machine without ~/.oh-my-zsh, and no host has the
    # Google Cloud SDK (mission zsh-to-nix S02).
    local src=$1 rc=0 t0 f hits
    while IFS= read -r f; do
        [ -n "$f" ] || continue
        t0="$(now_ms)"
        hits="$(grep -nE 'NVM_DIR|nvm\.sh|curl -fsSL|google-cloud-sdk|gcloud' "$src/$f" 2>/dev/null | tr '\n' ' ')"
        if [ -n "$hits" ]; then
            report FAIL dead-config "zsh/$f" "carries a dead tool block ($hits); nvm, the oh-my-zsh curl installer and the Google Cloud SDK are absent fleet-wide (S02)" "$(( $(now_ms) - t0 ))"
            rc=1
        else
            report PASS dead-config "zsh/$f" "no nvm, oh-my-zsh curl installer or google-cloud-sdk block" "$(( $(now_ms) - t0 ))"
        fi
    done < <(zsh_names "$src")
    return $rc
}

check_profile_owner() {
    # S02: the three eval-based tool hooks and the fzf default command are
    # home-manager program modules, and the aliases are shellAliases. A tracked
    # zsh file must not eval a tool init again - that would double-init the tool
    # or shadow the module.
    local src=$1 rc=0 t0 f hits missing="" marker
    t0="$(now_ms)"
    for marker in \
        'programs.starship.enable = true;' \
        'programs.zoxide.enable = true;' \
        'programs.direnv.enable = true;' \
        'programs.fzf = {' \
        'shellAliases = {'; do
        grep -Fq -- "$marker" "$SHARED_NIX_FILE" 2>/dev/null || missing+="$marker "
    done
    if [ -z "$missing" ]; then
        report PASS profile-owner "nix/modules/shared/default.nix" "starship, zoxide, direnv and fzf are program modules; the aliases are shellAliases" "$(( $(now_ms) - t0 ))"
    else
        report FAIL profile-owner "nix/modules/shared/default.nix" "the profile no longer declares: $missing" "$(( $(now_ms) - t0 ))"
        rc=1
    fi
    while IFS= read -r f; do
        [ -n "$f" ] || continue
        t0="$(now_ms)"
        hits="$(grep -nE 'eval[[:space:]]+"\$\((starship|zoxide|direnv)[[:space:]]' "$src/$f" 2>/dev/null | tr '\n' ' ')"
        if [ -n "$hits" ]; then
            report FAIL profile-owner "zsh/$f" "evals a tool init ($hits); the program module owns it (S02)" "$(( $(now_ms) - t0 ))"
            rc=1
        else
            report PASS profile-owner "zsh/$f" "no eval-based tool init; the program modules own them" "$(( $(now_ms) - t0 ))"
        fi
    done < <(zsh_names "$src")
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

ALL_CHECKS="check_syntax check_env_owner check_zshenv_path check_zshenv_exit0 check_term_rc check_term_env check_term_content check_dead_config check_alias_targets check_profile_owner check_guard_behavior check_idempotent"

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
    st_run_nix() { # $1 check fn  $2 label  $3 mutation snippet (cwd: temp nix/ copy)
        local chk=$1 label=$2 mut=$3 tmp caught=1
        tmp="$(mktemp -d "${TMPDIR:-/tmp}/zsh-test-mut.XXXXXX")"
        register_home "$tmp"
        mkdir -p "$tmp/nix"
        cp "$SHARED_NIX_FILE" "$tmp/nix/shared.nix"
        ( cd "$tmp/nix" && eval "$mut" ) >/dev/null 2>&1
        if ( SHARED_NIX_FILE="$tmp/nix/shared.nix" "$chk" "$ZSH_SRC" ) >/dev/null 2>&1; then
            caught=0
        fi
        rm -rf "$tmp"
        if [ "$caught" -eq 1 ]; then
            report PASS "selftest-$label" "nix/modules/shared/default.nix" "mutation caught by $chk" 0
        else
            report FAIL "selftest-$label" "nix/modules/shared/default.nix" "mutation NOT caught by $chk" 0
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
    st_run check_env_owner      path-owner   "printf 'export PATH=\"/tmp/x:\$PATH\"\n' >> .zshrc"
    st_run check_zshenv_path    zshenv-path  "mut_sed .zshenv 's|hm-session-vars.sh|hm-session-vars-absent.sh|'"
    st_run check_zshenv_exit0   zshenv-exit  "printf 'false\n' >> .zshenv"
    st_run check_term_rc        term-rc      "mut_sed .zshrc 's|export TERM=\"xterm-256color\"|export TERM=\"xterm-ghostty\"|'"
    st_run check_term_rc        term-guard   "printf 'export TERM=\"xterm-256color\"\n' >> .zshrc"
    st_run check_term_env       term-env     "printf 'export TERM=\"xterm-ghostty\"\n' >> .zshenv"
    st_run check_term_content   term-content "mut_sed .zshrc 's|export TERM=\"xterm-256color\"|export TERM=\"xterm-ghostty\"|'"
    st_run_nix check_alias_targets alias-target "mut_sed shared.nix \"s|gh dash|gh-dash-missing|\""
    st_run check_dead_config    nvm-block    "printf 'export NVM_DIR=\"\$HOME/.nvm\"\\n' >> .zshrc"
    # The module owns the aliases and the tool hooks now, so st_run_nix mutates
    # a copy of it: dropping a program module or an alias must trip its check.
    st_run_nix check_profile_owner hook-drop  "mut_sed shared.nix 's|programs.zoxide.enable = true;||'"
    st_run check_guard_behavior guard-drop   "printf 'st4rship init zsh\\n' >> .zshrc"
    # Without typeset -U a PATH assignment in the shell files duplicates on a
    # re-source; that is the guarantee the check defends.
    st_run check_idempotent     dup-path     "mut_sed .zshenv '/^typeset -U path PATH$/d'; printf 'PATH=\"/tmp/dup:\$PATH\"\n' >> .zshrc"
fi

TOTAL_MS="$(( $(now_ms) - TOTAL_START ))"
echo "== zsh: $PASS_COUNT pass, $FAIL_COUNT fail, $SKIP_COUNT skip (total ${TOTAL_MS} ms) =="

[ "$FAIL_COUNT" -eq 0 ]
