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
#   just build     -> ~/.local/bin/mission and rataflow/target/release/rataflow-view
#
# `mission` is compiled into the repo's gitignored build dir and moved into
# place; `rataflow-view` stays in the crate's target dir, because the installed
# copy comes from the Nix profile (nix/pkgs/rataflow-view.nix). Set BIN_DIR to
# override the mission destination directory.

bin_dir := env("BIN_DIR", home_directory() / ".local/bin")

# Dependencies run in order and stop on the first failure, so a Go error
# never hides behind a Rust build.
# Build mission into BIN_DIR and rataflow-view into its target dir.
build: build-mission build-rataflow-view

# Compile the mission CLI from go/mission.
build-mission:
    mkdir -p {{bin_dir}}
    cd go/mission && GOTOOLCHAIN=local go build -trimpath -o bin/mission ./cmd/mission
    mv -f go/mission/bin/mission {{bin_dir}}/mission
    @echo "built {{bin_dir}}/mission"

# The installed rataflow-view is a profile package (nix/pkgs/rataflow-view.nix),
# so this recipe only compiles the checkout: the release binary lands in
# rataflow/target/release/ and nothing is moved or installed.
build-rataflow-view:
    cargo build --release --locked --manifest-path rataflow/Cargo.toml
    @echo "built rataflow/target/release/rataflow-view"
