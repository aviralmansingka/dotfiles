# rataflow-view, built from the in-repo crate. The crate is the renderer the
# `visualize` skill runs; building it here keeps one owner for the binary and
# removes the `cargo install --path rataflow` step install.sh used to run.
#
# `rataflowSrc` is the repo's rataflow/ directory, passed as a plain path:
# a source outside the flake directory cannot be a plain relative path, because
# Nix copies it into the store with its parent chain collapsed.
{
  lib,
  rustPlatform,
  rataflowSrc,
}:

rustPlatform.buildRustPackage {
  pname = "rataflow-view";
  version = "0.1.0";

  src = rataflowSrc;
  cargoLock.lockFile = "${rataflowSrc}/Cargo.lock";

  # The crate's test fixtures are repo-level files under docs/visualize-eval,
  # outside the crate directory, so they cannot be part of this source. The
  # package therefore compiles the binary only; behaviour is covered by
  # `cargo test` in the checkout and by scripts/test-rataflow.py.
  doCheck = false;

  meta = {
    description = "Live ratatui node-graph viewer";
    mainProgram = "rataflow-view";
    license = lib.licenses.mit;
  };
}
