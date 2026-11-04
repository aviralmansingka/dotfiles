# Fleet recipes. `just deploy <profile> <target>` is the one deployment entry
# point; see docs/nix-profiles.md.
#
#   just deploy remote homelab
#   just deploy remote devbox
#   just deploy macbook mac
#   just deploy remote homelab --dry-run

# List recipes.
default:
    @just --list

# Deploy a profile to a target host (local or over ssh).
deploy profile target *flags:
    scripts/nix-deploy {{profile}} {{target}} {{flags}}

# Print the deploy plan without changing anything.
plan profile target:
    scripts/nix-deploy {{profile}} {{target}} --dry-run

# Capture the live Mac's defaults into the nix-darwin module the profile imports.
capture-macos:
    python3 scripts/capture-macos-defaults.py --nix-out nix/darwin/system-defaults.nix

# Inventory credentials without reading values out.
audit-secrets:
    python3 scripts/audit-secrets.py

# Offline test for the deploy script (no network, stub hosts).
test-deploy:
    scripts/test-nix-deploy.sh
