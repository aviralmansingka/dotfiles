#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd "$(dirname "$0")/.." && pwd -P)
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT
touch "$test_dir/example.html"
mkdir "$test_dir/Pretty Report"
touch "$test_dir/Pretty Report/index.html"

bash -n "$repo_dir/scripts/lavish-homelab"
remote_path=$("$repo_dir/scripts/lavish-homelab" remote-path "$test_dir/example.html")
[[ "$remote_path" =~ ^/home/avirus/\.local/share/lavish/artifacts/[A-Za-z0-9._-]+/[a-f0-9]{16}/example\.html$ ]]
[[ "$("$repo_dir/scripts/lavish-homelab" alias-for "$test_dir/example.html" --source-markdown "$test_dir/WBJ Payments.md")" == wbj-payments ]]
[[ "$("$repo_dir/scripts/lavish-homelab" alias-for "$test_dir/example.html" --alias "My Review")" == my-review ]]
[[ "$("$repo_dir/scripts/lavish-homelab" alias-for "$test_dir/Pretty Report/index.html")" == pretty-report ]]

echo "lavish-homelab: ok"
