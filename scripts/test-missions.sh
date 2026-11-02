#!/usr/bin/env bash
# Paths: scripts/mission-cli/**
set -euo pipefail
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
command -v go >/dev/null || { echo 'FAIL: Go 1.26+ is required for mission CLI tests' >&2; exit 1; }
build_dir=$(mktemp -d)
trap 'rm -rf "$build_dir"' EXIT
cd "$repo_root/scripts/mission-cli"
go test ./...
go vet ./...
go build -o "$build_dir/mission" .
