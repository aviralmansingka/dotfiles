#!/bin/bash
# Offline test for scripts/sandbox. No AWS calls, no network.
# Paths: scripts/sandbox scripts/test-sandbox.sh
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SANDBOX="$REPO/scripts/sandbox"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
pass() { echo "PASS $1: ${2:-}"; PASS=$((PASS + 1)); }
fail() { echo "FAIL $1: ${2:-}"; FAIL=$((FAIL + 1)); }

BIN="$TMP/bin"
mkdir -p "$BIN" "$TMP/home/.ssh" "$TMP/home/.aws/keypairs"
CALLS="$TMP/calls"
: >"$CALLS"
# The stubs write to $CALLS, so it has to be in their environment.
export CALLS BIN

# --------------------------------------------------------------- aws stub ---
# Every invocation is recorded; the answers are fixed so the assertions can be
# about which call was made and with which arguments.
cat >"$BIN/aws" <<'STUB'
#!/usr/bin/env bash
echo "aws $*" >>"$CALLS"
args="$*"
case "$args" in
*"sts get-caller-identity"*) echo '{"Account":"000000000000"}' ;;
*"describe-regions"*) printf 'ap-south-1\nus-east-1\neu-west-1\n' ;;
*"describe-images"*) echo "ami-test-0001" ;;
*"describe-vpcs"*) echo "vpc-test" ;;
*"describe-subnets"*) echo "subnet-test" ;;
*"describe-security-groups"*) echo "sg-test" ;;
*"create-security-group"*) echo "sg-test" ;;
*"describe-key-pairs"*) printf 'decoy-key\nrack-bench-iperf\n' ;;
*"run-instances"*) echo "i-test0001" ;;
*"wait instance-running"*) exit 0 ;;
*"describe-instances"*"PublicIpAddress"*) echo "203.0.113.9" ;;
*"describe-instances"*) printf 'i-test0001\tap-south-1b\tt3.micro\t2026-01-01\t203.0.113.9\n' ;;
*"terminate-instances"*) echo '{}' ;;
*"authorize-security-group-ingress"*) echo '{}' ;;
*) echo "{}" ;;
esac
STUB
chmod +x "$BIN/aws"

# -------------------------------------------------------------- curl stub ---
# The region with the smallest time_connect must win. checkip returns an address.
cat >"$BIN/curl" <<'STUB'
#!/usr/bin/env bash
for a in "$@"; do
  case "$a" in
  *checkip*) echo "198.51.100.7"; exit 0 ;;
  *ec2.ap-south-1.*) printf '0.011' ; exit 0 ;;
  *ec2.us-east-1.*) printf '0.240'; exit 0 ;;
  *ec2.eu-west-1.*) printf '0.180'; exit 0 ;;
  esac
done
printf '0.500'
STUB
chmod +x "$BIN/curl"

# A key pair whose private key is present, next to one that is not.
: >"$TMP/home/.ssh/rack-bench-iperf.pem"

run() { # $1 case name, rest: args
  local name="$1"
  shift
  : >"$CALLS"
  OUT="$(HOME="$TMP/home" PATH="$BIN:$PATH" AWS_CLI="$BIN/aws" "$SANDBOX" "$@" 2>&1)"
  RC=$?
  export OUT RC
  case "$name" in
  *) : ;;
  esac
}
expect_rc() { if [ "$RC" = "$2" ]; then pass "$1" "exit $2"; else fail "$1" "expected rc=$2, got rc=$RC"; fi }
expect_out() { if grep -qF -- "$2" <<<"$OUT"; then pass "$1" "${3:-}"; else fail "$1" "output lacks '$2'"; fi }
expect_call() { if grep -qF -- "$2" "$CALLS"; then pass "$1" "${3:-}"; else fail "$1" "no call matching '$2'"; fi }
expect_no_call() { if grep -qF -- "$2" "$CALLS"; then fail "$1" "unexpected call matching '$2'"; else pass "$1" "${3:-}"; fi }

# ------------------------------------------------------------------- up ----
echo "== up picks the lowest-latency region and launches a self-destructing box"
run "up" up --minutes 7 --nix
expect_rc "up" 0
expect_out "up" "region: ap-south-1" "chose the 11 ms region over 240 ms and 180 ms"
expect_out "up" "key:    rack-bench-iperf" "picked the key pair whose private key exists"
expect_out "up" "instance: i-test0001"
expect_call "up" "--key-name rack-bench-iperf" "passes the key pair at launch"
expect_call "up" "--instance-initiated-shutdown-behavior terminate" "a shutdown terminates, not stops"
expect_call "up" "--instance-type t3.micro" "cheap default type"
expect_call "up" "Value=nix-fleet-sandbox" "tags the instance so list and down find it"
expect_call "up" "shutdown -P +7" "the box kills itself after the requested minutes"
expect_call "up" "security-group-ingress" "opens ssh for the caller"
expect_call "up" "198.51.100.7/32" "ssh is limited to the caller's own address"
expect_no_call "up" "0.0.0.0/0" "ssh is not open to the world"

echo "== up writes the ssh alias with the matching key, not the first one it finds"
if grep -q "IdentityFile $TMP/home/.ssh/rack-bench-iperf.pem" "$TMP/home/.ssh/config" 2>/dev/null; then
  pass "alias/key" "IdentityFile points at the resolved key"
else
  fail "alias/key" "alias missing or wrong key: $(grep -A3 'Host probe' "$TMP/home/.ssh/config" 2>/dev/null | tr '\n' ' ')"
fi
if grep -q "^Host probe$" "$TMP/home/.ssh/config" 2>/dev/null; then
  pass "alias/name" "hostname is probe, the fleet target"
else
  fail "alias/name" "no 'Host probe' block"
fi

echo "== a second up replaces the alias instead of duplicating it"
run "up-again" up --minutes 5
[ "$(grep -c '^Host probe$' "$TMP/home/.ssh/config")" = "1" ] &&
  pass "alias/replace" "one probe block after two runs" ||
  fail "alias/replace" "duplicate probe blocks"

echo "== dry run touches nothing"
run "dry" up --dry-run
: >"$CALLS"
OUT="$(HOME="$TMP/home" PATH="$BIN:$PATH" AWS_CLI="$BIN/aws" SANDBOX_DRY_RUN=1 "$SANDBOX" up 2>&1)"
RC=$?
expect_rc "dry" 0
expect_out "dry" "dry run: would launch t3.micro" "prints the plan"
expect_no_call "dry" "run-instances" "no instance is created"

echo "== bad flag stops before any AWS call"
run "badflag" up --nope
expect_rc "badflag" 1
expect_out "badflag" "unknown flag" "says what is wrong"
expect_no_call "badflag" "run-instances" "no launch"

# ----------------------------------------------------------------- list ----
echo "== list filters by the sandbox tag"
run "list" list
expect_rc "list" 0
expect_call "list" "Name=tag-key,Values=nix-fleet-sandbox" "only tagged boxes are listed"

# ----------------------------------------------------------------- down ----
echo "== down --all terminates only sandbox-tagged instances"
run "down" down --all
expect_rc "down" 0
expect_call "down" "terminate-instances" "terminates"
expect_call "down" "Name=tag-key,Values=nix-fleet-sandbox" "targets the sandbox tag"
expect_call "down" "i-test0001" "uses the id it found"

echo "== down needs a target"
run "down-none" down
expect_rc "down-none" 1
expect_out "down-none" "nothing to terminate" "refuses to guess"

echo
if [ "$FAIL" = 0 ]; then
  echo "test-sandbox: $PASS passed, 0 failed"
else
  echo "test-sandbox: $PASS passed, $FAIL failed"
fi
[ "$FAIL" = 0 ]
