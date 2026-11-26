#!/usr/bin/env bash
# Paths: ops/provision/** scripts/test-provision.sh docs/ci-tests/provision.md
#
# Offline CI suite for the fleet provisioner in ops/provision.
#
# Every command runs from ops/provision and touches only the Go sources and
# the module cache: no AWS, no Docker, no SSM, no Tailscale, no OpenBao, no
# network. `go build -tags=integration ./...` compiles the live harness and
# never runs it, so no cloud call can happen.
#
# Two guards fail before any step:
#   PROVISION_LIVE_AWS  set and non-empty -> refuse
#   AWS_PROFILE         set and non-empty -> refuse
# Automated CI must never create a cloud resource.
#
# Usage: scripts/test-provision.sh   (exit 0 pass, 1 fail)
# Shell tracing stays off on purpose: `set -x` would print environment values.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$REPO/ops/provision"

STEP_PASS=0
STEP_FAIL=0
TOTAL_STEPS=7

now_ms() {
    local t
    t="$(date +%s%N 2>/dev/null || true)"
    # GNU date: seconds+nanoseconds -> divide to ms.
    # BSD date (macOS): no %N, output is empty -> seconds -> ms.
    case "$t" in
        ''|*N) t="$(( $(date +%s) * 1000 ))" ;;
        *) t="$(( t / 1000000 ))" ;;
    esac
    printf '%s' "$t"
}

summary() {
    local elapsed
    elapsed="$(( $(now_ms) - START_MS ))"
    echo "== provision: $STEP_PASS pass, $STEP_FAIL fail of $TOTAL_STEPS steps (${elapsed} ms) =="
}

run_step() { # $1 label, $2 command text, rest: argv
    local label="$1" display="$2"
    shift 2
    local out rc=0
    out="$("$@" 2>&1)" || rc=$?
    if [ "$rc" -eq 0 ]; then
        STEP_PASS=$((STEP_PASS + 1))
        echo "PASS $label: $display"
        return 0
    fi
    STEP_FAIL=$((STEP_FAIL + 1))
    echo "FAIL $label: $display (exit $rc)"
    if [ -n "$out" ]; then
        printf '%s\n' "$out" | sed 's/^/    /'
    fi
    summary
    echo "FAILED step: $label ($display)"
    exit 1
}

# gofmt prints the offending files and exits 0; the check needs the output.
gofmt_clean() {
    local out
    out="$(gofmt -l .)"
    if [ -n "$out" ]; then
        echo "unformatted files, run: gofmt -w ."
        printf '%s\n' "$out"
        return 1
    fi
    return 0
}

START_MS="$(now_ms)"

# ------------------------------------------------------------------ guards ---
if [ -n "${PROVISION_LIVE_AWS:-}" ]; then
    echo "FAIL guard PROVISION_LIVE_AWS: it is set and non-empty ('$PROVISION_LIVE_AWS')."
    echo "This suite never creates a cloud resource. Unset it to run offline."
    summary
    exit 1
fi

if [ -n "${AWS_PROFILE:-}" ]; then
    echo "FAIL guard AWS_PROFILE: it is set and non-empty ('$AWS_PROFILE')."
    echo "This suite never creates a cloud resource. Unset it to run offline."
    summary
    exit 1
fi

echo "== ops/provision offline checks =="

if [ ! -d "$DIR" ]; then
    echo "FAIL layout: $DIR does not exist"
    STEP_FAIL=$((STEP_FAIL + 1))
    summary
    exit 1
fi

cd "$DIR"

# ------------------------------------------------------------------- steps ---
run_step build    "go build ./..."                 go build ./...
run_step gofmt    "gofmt -l ."                     gofmt_clean
run_step vet      "go vet ./..."                   go vet ./...
run_step test     "go test -count=1 ./..."         go test -count=1 ./...
run_step race     "go test -race -count=1 ./..."   go test -race -count=1 ./...
run_step tidy     "go mod tidy -diff"              go mod tidy -diff
run_step live     "go build -tags=integration ./..." go build -tags=integration ./...

summary
