# Fleet recipes. `just deploy <profile> <target>` is the one deployment entry
# point; see docs/nix-profiles.md.
#
#   just deploy remote homelab
#   just deploy remote devbox
#   just deploy macbook mac
#   just deploy remote homelab --dry-run
#
#   just sandbox                      # Ubuntu box, best-latency region, 30 min
#   just sandbox --nix                # the same, with Nix bootstrapped
#   just sandbox list
#   just sandbox down --all

# List recipes.
default:
    @just --list

# Deploy a profile to a target host (local or over ssh).
deploy profile target *flags:
    scripts/nix-deploy {{profile}} {{target}} {{flags}}

# Spin up a short-lived Ubuntu EC2 sandbox in the lowest-latency region.
# It terminates itself after 30 minutes (SANDBOX_MINUTES to change that).
sandbox *flags:
    scripts/sandbox up {{flags}}

# List running sandboxes.
sandbox-list:
    scripts/sandbox list

# Terminate a sandbox by id, or every sandbox with --all.
sandbox-down *args:
    scripts/sandbox down {{args}}

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
