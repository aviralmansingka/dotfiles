# macOS system settings, generated from the live Mac by
# scripts/capture-macos-defaults.py --nix-out nix/darwin/system-defaults.nix.
#
# The generated file is not committed: it holds machine-private preferences
# (2600+ keys, including local identifiers) and it changes whenever an app
# rewrites a domain. The deploy script regenerates it before a switch, so a
# fresh MacBook that has never run the capture still builds: this module falls
# back to an empty set and says so.
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
