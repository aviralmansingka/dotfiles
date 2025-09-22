#!/bin/bash

# Generate Brewfile from dependencies.json
# Simple wrapper around install_deps.py for Brewfile generation

set -e

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Generate the Brewfile
echo "Generating Brewfile from dependencies.json..."
python3 "$SCRIPT_DIR/install_deps.py" --os macos --format brewfile --deps-file "$ROOT_DIR/dependencies.json" > "$ROOT_DIR/Brewfile"

echo "Brewfile generated successfully!"
echo "Run 'brew bundle' to install all dependencies."