{ lib, ... }:

let
  generated = ../../darwin/system-defaults.nix;
in
if builtins.pathExists generated then
  import generated
else
  lib.warn ''
    nix/modules/macbook/system-defaults.nix: no captured defaults module at
    nix/darwin/system-defaults.nix. The MacBook builds without system settings.
    Run: python3 scripts/capture-macos-defaults.py --nix-out nix/darwin/system-defaults.nix
  '' { }
