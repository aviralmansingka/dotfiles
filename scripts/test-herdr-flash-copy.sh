#!/bin/bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
copy="$root/herdr/.local/bin/wl-copy"
text='Herdr Flash copy ✓'
expected=$'\033]52;c;'"$(printf %s "$text" | base64 | tr -d '\n')"$'\007'
actual=$(printf %s "$text" | "$copy")

[[ "$actual" == "$expected" ]]
printf 'PASS herdr-flash OSC52 clipboard bridge\n'
