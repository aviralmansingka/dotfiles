# Sourced by zsh login shells only (before .zshrc).
# The pi and rex binaries live in ~/.pi/agent/bin; a login shell needs them on
# PATH so `sh -lc 'command -v rex'`/pi's subagent gate can find them.
# case-guarded, not a bare export: re-sourcing must not duplicate the entry.
case ":$PATH:" in
    *":$HOME/.pi/agent/bin:"*) ;;
    *) PATH="$HOME/.pi/agent/bin:$PATH"; export PATH ;;
esac
