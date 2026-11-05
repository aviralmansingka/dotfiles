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

# List the recipes.
default:
    @just --list

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
