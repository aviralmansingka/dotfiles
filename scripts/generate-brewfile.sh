#!/bin/bash
# Generate Brewfile from dependencies.yml configuration

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Generating Brewfile from dependencies.yml..."

cd "$REPO_ROOT"
python3 scripts/install-deps.py --os macos --format brewfile > Brewfile

echo "✅ Brewfile updated successfully!"

# Show what changed
if command -v git >/dev/null 2>&1; then
    echo ""
    echo "Changes to Brewfile:"
    git diff --no-index /dev/null Brewfile 2>/dev/null | tail -n +5 || echo "No git available to show diff"
fi