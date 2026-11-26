# tasktrace: attention spans from app focus and AeroSpace, and the hook that feeds them.
#
# AeroSpace runs its hooks with PATH=/usr/bin:/bin:/usr/sbin:/sbin, so the hook
# cannot reach `uv` in the profile and a `uv run` shim dies with 127. The package
# is stdlib-only Python, so the wrapper carries its own interpreter instead:
# `tasktrace` is the CLI, `tasktrace-hook` is the same CLI with `hook` applied.
#
# One derivation carries both names, because AeroSpace's `exec-and-forget` line
# and the CLI it feeds have to arrive together on PATH.
{
  lib,
  python3,
  writeShellApplication,
  symlinkJoin,
}:

let
  src = ../../tasktrace;

  # `python3 -m tasktrace` is the same entry point as the console script; the
  # package tree is on PYTHONPATH so no wheel install is needed at runtime.
  cli = writeShellApplication {
    name = "tasktrace";
    runtimeInputs = [ python3 ];
    text = ''
      export PYTHONPATH="${src}/src"
      exec ${python3}/bin/python3 -m tasktrace "$@"
    '';
  };

  hook = writeShellApplication {
    name = "tasktrace-hook";
    runtimeInputs = [ python3 ];
    text = ''
      export PYTHONPATH="${src}/src"
      # A bare `tasktrace-hook` means the focus entry point, as the dev shim did.
      if [ "$#" -eq 0 ]; then
        set -- focus
      fi
      exec ${python3}/bin/python3 -m tasktrace hook "$@"
    '';
  };
in
symlinkJoin {
  name = "tasktrace-0.1.0";
  paths = [
    cli
    hook
  ];

  meta = {
    description = "Collect attention spans and stitch them into task traces";
    mainProgram = "tasktrace";
    license = lib.licenses.mit;
  };
}
