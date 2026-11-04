# Fleet recipes. `just deploy <profile> <target>` is the one deployment entry
# point; see docs/nix-profiles.md.
#
#   just deploy remote            # the machine you are on (target defaults to local)
#   just deploy macbook           # the same, for the Mac profile
#   just deploy remote homelab    # explicitly, another host
#   just deploy remote devbox
#   just deploy remote --dry-run
#
#   just sandbox                      # Ubuntu box, best-latency region, 30 min
#   just sandbox --nix                # the same, with Nix bootstrapped
#   just sandbox list
#   just sandbox down --all

# List recipes.
default:
    @just --list

# Deploy a profile to a target host. The target defaults to `local`, which
# means the machine this runs on; name a target to deploy over ssh instead.
deploy profile target="local" *flags:
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
plan profile target="local":
    scripts/nix-deploy {{profile}} {{target}} --dry-run

# List the deploy targets the flake knows, with their platform.
targets:
    @nix --extra-experimental-features "nix-command flakes" eval --json .#fleet.targets | python3 -c 'import json,sys; d=json.load(sys.stdin); [print(n, v["system"], v["kind"], v["attr"]) for n,v in sorted(d.items())]'

# Offline test for the deploy script (no network, stub hosts).
test-deploy:
    scripts/test-nix-deploy.sh
