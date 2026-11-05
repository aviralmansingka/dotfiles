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

  doCheck = false;

  meta = {
    description = "Live ratatui node-graph viewer";
    mainProgram = "rataflow-view";
    license = lib.licenses.mit;
  };
}
