#!/usr/bin/env bash
# Paths: scripts/nix-deploy justfile nix/**
#
# Offline test for scripts/nix-deploy. No network, no switch, no real host: the
# script runs with a stub PATH so `hostname`, `uname`, `ssh`, `tar`, `git`,
# `stow` and `home-manager` record their argv instead of doing work. Each case
# runs against a throwaway $HOME, so the file phase's `rm -f` and `stow` never
# touch the real one.
#
# What it proves:
#   - the plan for a local target names home-manager, never darwin-rebuild or
#     sudo (every host is a standalone Home Manager configuration)
#   - the plan for a remote target stages only the deploy tree
#   - `--dry-run` never calls ssh or a switch
#   - an unknown profile or target exits 3/2 before any work
#   - a profile that does not apply to a target is refused
#   - the deploy tree excludes the dotfiles checkout by construction
#   - every repo path the flake reads at evaluation time is in the deploy tree
#     (self-tested: dropping rex/ must fail the check)
#
# Usage: scripts/test-nix-deploy.sh   (exit 0 pass, 1 fail)
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY="$REPO/scripts/nix-deploy"
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

PASS=0
FAIL=0
pass() { echo "PASS $1: ${2:-}"; PASS=$((PASS + 1)); }
fail() { echo "FAIL $1: ${2:-}"; FAIL=$((FAIL + 1)); }

# --------------------------------------------------------------- stub host ---
BIN="$TMP/bin"
mkdir -p "$BIN"
CALLS="$TMP/calls"

# hostname prints the machine the test pretends to be on.
cat > "$BIN/hostname" <<'STUB'
#!/usr/bin/env bash
if [ "${1:-}" = "-s" ] || [ $# -eq 0 ]; then
  echo "${STUB_HOSTNAME:-testmac}"
else
  echo "${STUB_HOSTNAME:-testmac}"
fi
STUB

# uname: resolve_target falls back to the platform when no table entry claims
# the hostname, so the macbook cases must behave the same on a Linux CI runner
# as on the Mac. STUB_UNAME forces the answer; unset delegates to the real one.
cat > "$BIN/uname" <<'STUB'
#!/usr/bin/env bash
if [ "${1:-}" = "-s" ] && [ -n "${STUB_UNAME:-}" ]; then
  echo "$STUB_UNAME"
  exit 0
fi
exec /usr/bin/uname "$@"
STUB

# ssh records its argv and, when the command is a stage tar, consumes stdin.
cat > "$BIN/ssh" <<'STUB'
#!/usr/bin/env bash
echo "ssh $*" >> "$CALLS"
cat > /dev/null 2>&1 || true
exit 0
STUB

# tar: the local tar writes nothing useful; record that it ran.
cat > "$BIN/tar" <<'STUB'
#!/usr/bin/env bash
echo "tar $*" >> "$CALLS"
cat > /dev/null 2>&1 || true
exit 0
STUB

# git and stow: on a local target the file phase clones the checkout for real
# and stows into $HOME. Record the argv, so the phase stays offline (the
# checkout's url.insteadOf rewrites HTTPS to SSH, which would wait on a key).
cat > "$BIN/git" <<'STUB'
#!/usr/bin/env bash
echo "git $*" >> "$CALLS"
exit 0
STUB

cat > "$BIN/stow" <<'STUB'
#!/usr/bin/env bash
echo "stow $*" >> "$CALLS"
exit 0
STUB

cat > "$BIN/home-manager" <<'STUB'
#!/usr/bin/env bash
echo "home-manager $*" >> "$CALLS"
exit 0
STUB

# The deploy runs the flake's own home-manager through `nix run`. Record the
# wrapper call, then hand the argv to the home-manager stub above.
cat > "$BIN/nix" <<'STUB'
#!/usr/bin/env bash
echo "nix $*" >> "$CALLS"
# The deploy enables flakes explicitly; skip the flag pair so the `run`
# detection below still finds the subcommand.
if [ "${1:-}" = "--extra-experimental-features" ]; then
  shift 2
fi
# The target table lives in the flake; hand back a fixed one so the test can
# assert resolution without evaluating nixpkgs.
if [ "${1:-}" = "eval" ]; then
  cat <<JSON
{"devbox":{"attr":"remote-devbox","kind":"home-manager","localNames":["devbox","srv717581"],"managedUser":"aviral","ssh":"devbox","system":"x86_64-linux"},
 "homelab":{"attr":"remote","kind":"home-manager","localNames":["homelab"],"ssh":"homelab","system":"x86_64-linux"},
 "mac":{"attr":"macbook","kind":"home-manager","localNames":["mac","macbook"],"ssh":"mac","system":"aarch64-darwin"},
 "probe":{"attr":"remote-probe","kind":"home-manager","localNames":["probe"],"ssh":"probe","system":"x86_64-linux"}}
JSON
  exit 0
fi
if [ "${1:-}" = "run" ]; then
  shift 2
  [ "${1:-}" = "--" ] && shift
  exec "$BIN/home-manager" "$@"
fi
exit 0
STUB

cat > "$BIN/sudo" <<'STUB'
#!/usr/bin/env bash
echo "sudo $*" >> "$CALLS"
shift
exec "$@"
STUB

chmod +x "$BIN"/*
export CALLS
export BIN
export PATH="$BIN:$PATH"
# The deploy prefers the user profile's Nix over PATH. On a Mac that now has Nix
# installed, that would reach the real store, so the stub directory is handed
# over explicitly and the script puts it first.
export FLEET_STUB_BIN="$BIN"

run() { # $1 case name, rest: argv
  local name="$1" home
  shift
  : > "$CALLS"
  # A fresh $HOME per case: the file phase writes a checkout under it and runs
  # `rm -f` on .bashrc/.profile, which must never reach the real home.
  home="$TMP/home"
  mkdir -p "$home"
  OUT="$(HOME="$home" "$DEPLOY" "$@" 2>&1)"
  RC=$?
  export OUT RC
}

expect_rc() { # $1 case, $2 expected, $3 why
  if [ "${RC:-x}" = "$2" ]; then pass "$1" "$3"; else fail "$1" "expected rc=$2, got rc=${RC:-none}"; fi
}

expect_contains() { # $1 case, $2 needle, $3 why
  if printf '%s' "${OUT:-}" | grep -qF -- "$2"; then pass "$1" "$3"; else fail "$1" "output lacks '$2'"; fi
}

expect_not_contains() { # $1 case, $2 needle, $3 why
  if printf '%s' "${OUT:-}" | grep -qF -- "$2"; then fail "$1" "output contains '$2'"; else pass "$1" "$3"; fi
}

expect_call() { # $1 case, $2 needle, $3 why
  if grep -qF -- "$2" "$CALLS"; then pass "$1" "$3"; else fail "$1" "no call matching '$2'"; fi
}

expect_no_call() { # $1 case, $2 needle, $3 why
  if grep -qF -- "$2" "$CALLS"; then fail "$1" "unexpected call matching '$2'"; else pass "$1" "$3"; fi
}

# --------------------------------------------------------------- the cases ---
echo "== dry run, local macbook target"
STUB_HOSTNAME=testmac STUB_UNAME=Darwin run "dry local" macbook mac --dry-run
expect_rc "dry local" 0 "exit 0"
expect_contains "dry local" "homeConfigurations.macbook" "names the macbook attribute"
expect_contains "dry local" "home-manager switch" "names the switch command"
expect_not_contains "dry local" "darwin-rebuild" "never names darwin-rebuild"
expect_not_contains "dry local" "sudo" "never needs sudo"
expect_no_call "dry local" "ssh " "never opens ssh for a local target"
expect_no_call "dry local" "home-manager " "never calls a switch during a dry run"

echo "== dry run, remote devbox from the mac"
STUB_HOSTNAME=testmac run "dry remote" remote devbox --dry-run
expect_rc "dry remote" 0 "exit 0"
expect_contains "dry remote" "homeConfigurations.remote-devbox" "names the devbox attribute"
expect_contains "dry remote" "remote switch over" "reports the remote mode"
expect_contains "dry remote" "flake.nix flake.lock nix justfile scripts/nix-deploy rataflow terminfo" "lists the deploy tree only"
expect_contains "dry remote" "terminfo zsh secrets rex scripts/stow-packages" "stages the encrypted secrets the sops module reads at evaluation"
expect_contains "dry remote" " rex " "stages rex/, whose lua configs rex-host.nix reads at evaluation"

echo "== remote deploy copies the tree and switches over ssh"
STUB_HOSTNAME=testmac run "remote run" remote devbox
expect_rc "remote run" 0 "exit 0"
expect_call "remote run" "ssh devbox" "opens one ssh session to the target"
expect_call "remote run" \
  'NIX_CONFIG="experimental-features = nix-command flakes"' "enables flakes for the remote switch"
expect_call "remote run" "nix run" "runs the flake's pinned home-manager on the target"
expect_call "remote run" "#home-manager\" -- switch --flake" "passes the switch argv to that home-manager"
expect_call "remote run" ".nix-profile/bin" "prefers the user profile Nix on the target"
expect_call "remote run" "ssh devbox" "uses one ssh session for staging and switch, not the checkout"

echo "== local homelab deploy switches with home-manager"
STUB_HOSTNAME=homelab run "local remote" remote homelab
expect_rc "local remote" 0 "exit 0"
expect_call "local remote" \
  'nix --extra-experimental-features nix-command flakes run' "switches in place"
expect_no_call "local remote" "ssh " "no ssh for a local target"

echo "== the target table decides, and local is the default shape"
STUB_HOSTNAME=homelab run "local by name" remote local --dry-run
expect_rc "local by name" 0 "exit 0"
expect_contains "local by name" "attribute homeConfigurations.remote" "local resolves to homelab on the homelab"

STUB_HOSTNAME=srv717581 run "local by cloud hostname" remote local --dry-run
expect_rc "local by cloud hostname" 0 "exit 0"
expect_contains "local by cloud hostname" "attribute homeConfigurations.remote-devbox" "the cloud-init hostname resolves to devbox"

STUB_HOSTNAME=unknownbox STUB_UNAME=Darwin run "local by platform" macbook local --dry-run
expect_rc "local by platform" 0 "exit 0"
expect_contains "local by platform" "attribute homeConfigurations.macbook" "an unclaimed hostname falls back to the platform"

STUB_HOSTNAME=testmac run "managed user" remote devbox
expect_rc "managed user" 0 "exit 0"
expect_call "managed user" "su - aviral" "the managed user comes from the table, not a host literal"

echo "== an ad-hoc ssh destination needs no flake edit"
STUB_HOSTNAME=testmac run "adhoc plan" remote ubuntu@10.0.0.5 --dry-run
expect_rc "adhoc plan" 0 "exit 0"
expect_contains "adhoc plan" "host 10.0.0.5" "the user@host form resolves to the host part"
expect_contains "adhoc plan" "attribute homeConfigurations.remote-probe" "ad-hoc hosts use the generic Linux profile"

STUB_HOSTNAME=testmac run "adhoc run" remote ubuntu@10.0.0.5
expect_rc "adhoc run" 0 "exit 0"
expect_call "adhoc run" "ssh ubuntu@10.0.0.5" "dials the user at the destination, not a table name"
expect_no_call "adhoc run" "su - " "no user switch when the login user is the managed user"
expect_call "adhoc run" "identity.nix" "stages an identity module with the tree"

echo "== an ad-hoc destination still needs the right profile"
STUB_HOSTNAME=testmac run "adhoc wrong profile" macbook ubuntu@10.0.0.5
expect_rc "adhoc wrong profile" 3 "refused"
expect_contains "adhoc wrong profile" "needs the remote profile" "says which profile an ad-hoc host takes"

echo "== refusals happen before any work"
run "unknown profile" nixos mac
expect_rc "unknown profile" 2 "rejects an unknown profile"
run "unknown target" remote mars
expect_rc "unknown target" 3 "rejects an unknown target"
run "wrong pairing" macbook homelab
expect_rc "wrong pairing" 3 "refuses macbook on a Linux host"
expect_no_call "wrong pairing" "ssh " "no ssh on a refused pairing"

# The macbook profile needs the live Mac: a remote-origin refusal, even when the
# target name looks valid.
STUB_HOSTNAME=homelab run "remote macbook" macbook mac
expect_rc "remote macbook" 3 "refuses a macbook deploy from another host"
expect_no_call "remote macbook" "ssh " "refuses before staging"
expect_no_call "remote macbook" "home-manager " "never switches from the wrong host"

# ---------------------------------------------- evaluation-time paths ---
# A module that reads a repo path at evaluation time fails the switch on a fresh
# host before it starts: `path '…-source/rex/.config/rex/init.lua' does not
# exist`. rex-host.nix copies three files out of rex/, and rex/ was not in
# deploy_tree(), so the first `just deploy remote <host>` on a fresh host died
# and an operator added the directory by hand. This check is the offline
# version of that defect.
#
# What it covers: every `./x` / `../x` path literal in flake.nix and in every
# nix/**/*.nix is resolved against the file that names it. A path that stays
# inside nix/ travels with the `nix` entry; a path that leaves nix/ must exist
# in the checkout and its top-level directory must be one deploy_tree() stages.
# The tree comes from `--dry-run`, so this tracks the function itself rather
# than a copy of the list.
#
# What it cannot catch: a path built at run time (string interpolation, a store
# path, `builtins.toString` of a join), a `#` inside a string that truncates the
# line, a path literal inside a comment on the same line as real code, a module
# imported from outside nix/, and an incomplete stage — the file is checked in
# the checkout, not in the tar that lands on the host. A missing path on a
# `builtins.pathExists` line is tolerated on purpose: that is how the flake
# reads nix/adhoc/identity.nix, which nix-deploy writes on the target at staging
# time. It also says nothing about a staged top-level directory that .gitignore
# filters.
remote_path_offenders() { # $1 tree (words) -> offenders on stdout, nonzero exit
  # shellcheck disable=SC2086 # the tree list is word-split on purpose
  python3 - "$REPO" $1 <<'PY'
import os, re, sys

repo = os.path.abspath(sys.argv[1])
staged = {path.split("/")[0] for path in sys.argv[2:] if path}
literal = re.compile(r"\.\.?/[A-Za-z0-9._+@/-]*")

files = [os.path.join(repo, "flake.nix")]
for root, dirs, names in os.walk(os.path.join(repo, "nix")):
    dirs.sort()
    files += [os.path.join(root, n) for n in sorted(names) if n.endswith(".nix")]

bad = []
for path in files:
    source = os.path.relpath(path, repo)
    with open(path, encoding="utf-8") as handle:
        for lineno, line in enumerate(handle, 1):
            code = line.split("#", 1)[0]
            guarded = "pathExists" in code
            for token in sorted(set(literal.findall(code))):
                token = token.rstrip("/")
                if token in (".", ".."):
                    continue
                target = os.path.normpath(os.path.join(os.path.dirname(path), token))
                rel = os.path.relpath(target, repo)
                if rel.startswith(".."):
                    continue  # outside the checkout: nothing to stage
                top = rel.split("/")[0]
                if not os.path.exists(target):
                    if not guarded:
                        bad.append(f"{source}:{lineno}: {rel} does not exist")
                elif top != "nix" and top not in staged:
                    bad.append(
                        f"{source}:{lineno}: {rel} reads {top}/, "
                        "which deploy_tree() does not stage"
                    )
print("\n".join(bad))
sys.exit(1 if bad else 0)
PY
}

echo "== the flake reads only paths the deploy tree stages"
STUB_HOSTNAME=testmac run "deploy tree" remote devbox --dry-run
TREE_WORDS="$(printf '%s' "$OUT" | sed -n 's/^copies  : //p')"
if [ -z "$TREE_WORDS" ]; then
  fail "remote paths" "the plan printed no deploy tree to check"
elif OFFENDERS="$(remote_path_offenders "$TREE_WORDS")"; then
  pass "remote paths" "every path the flake reads travels with the deploy tree"
else
  fail "remote paths" "$(printf '%s' "$OFFENDERS" | tr '\n' ';')"
fi

# The check only counts if it fails on the tree that shipped the defect. Drop
# rex/ and rex-host.nix's three references must be reported.
if OFFENDERS="$(remote_path_offenders "$(printf '%s' "$TREE_WORDS" | sed 's/\(^\| \)rex\( \|$\)/\1\2/g')")"; then
  fail "remote paths self-test" "a tree without rex/ still passed"
elif printf '%s' "$OFFENDERS" | grep -qF 'rex/.config/rex/init.lua'; then
  pass "remote paths self-test" "a tree without rex/ reports the missing reference"
else
  fail "remote paths self-test" "reported '$(printf '%s' "$OFFENDERS" | tr '\n' ';')'"
fi

echo "== the checkout never travels"
TREE="$(cd "$REPO" && scripts/nix-deploy remote devbox --dry-run)"
if printf '%s' "$TREE" | grep -q 'dotfiles'; then
  fail "tree scope" "deploy tree mentions the checkout"
else
  pass "tree scope" "deploy tree names no checkout path"
fi
if grep -qE 'rsync' "$DEPLOY"; then
  fail "no rsync" "nix-deploy uses rsync"
else
  pass "no rsync" "nix-deploy never uses rsync"
fi
if bash -n "$DEPLOY" 2>/dev/null; then
  pass "lint/bash-n" "nix-deploy parses"
else
  fail "lint/bash-n" "bash -n rejected nix-deploy"
fi

echo
echo "passed $PASS, failed $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
