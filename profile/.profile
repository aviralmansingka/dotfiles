# Sourced by sh/bash login shells (`sh -lc` reads this file on macOS).
# Mirrors zsh/.zprofile: the pi and rex binaries live in ~/.pi/agent/bin, and a
# captain process started from a login shell cannot spawn pi children without
# them on PATH.
# case-guarded, not a bare export: re-sourcing must not duplicate the entry.
case ":$PATH:" in
    *":$HOME/.pi/agent/bin:"*) ;;
    *) PATH="$HOME/.pi/agent/bin:$PATH"; export PATH ;;
esac
