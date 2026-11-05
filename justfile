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
#   just sandbox --files              # Nix plus the dotfiles stowed
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

# ---- from main: the build recipes ----

# Build the repo's two CLI binaries straight from this checkout.
# Nothing is installed or fetched beyond what the Go and Rust toolchains need:
# no `go install`, no `cargo install`, no `curl | sh`.
#
#   just build     -> ~/.local/bin/mission and ~/.local/bin/rataflow-view
#
# Both binaries are compiled into the repo's gitignored build dirs
# (go/mission/bin/, rataflow/target/) and then moved into place, so a clean
# checkout builds and the working tree stays clean. Set BIN_DIR to override
# the destination directory.

bin_dir := env("BIN_DIR", home_directory() / ".local/bin")

# Dependencies run in order and stop on the first failure, so a Go error
# never hides behind a Rust build.
# Build mission and rataflow-view into BIN_DIR.
build: build-mission build-rataflow-view

# Compile the mission CLI from go/mission.
build-mission:
    mkdir -p {{bin_dir}}
    cd go/mission && GOTOOLCHAIN=local go build -trimpath -o bin/mission ./cmd/mission
    mv -f go/mission/bin/mission {{bin_dir}}/mission
    @echo "built {{bin_dir}}/mission"

# ~/.cargo/bin precedes ~/.local/bin in this machine's shell PATH (zsh/.zshenv),
# so an old `cargo install`ed copy keeps shadowing the fresh one until it goes:
#   rm ~/.cargo/bin/rataflow-view
# Compile rataflow-view with --locked and install it into BIN_DIR.
build-rataflow-view:
    mkdir -p {{bin_dir}}
    cargo build --release --locked --manifest-path rataflow/Cargo.toml
    mv -f rataflow/target/release/rataflow-view {{bin_dir}}/rataflow-view
    @echo "built {{bin_dir}}/rataflow-view"
