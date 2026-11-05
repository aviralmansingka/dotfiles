# Sourced by all zsh invocations (login, interactive, scripts).
# Keep this minimal — only what must be available everywhere.
#
# Nix owns the environment: nix/modules/shared/default.nix declares every
# PATH entry in home.sessionPath and every export in home.sessionVariables,
# and Home Manager writes them to ~/.nix-profile/etc/profile.d/
# hm-session-vars.sh. Home Manager installs this file as ~/.zshenv, so the
# text below is the whole of it.

# typeset -U keeps PATH free of duplicate entries across re-sourcing.
typeset -U path PATH

# Login shells read ~/.zprofile, which Home Manager writes and which sources
# the generated file. A shell that never reads ~/.zprofile (zsh -c, a script
# sub-shell) sources it here instead.
# if-form, not `[ -f ] &&`: a failed test as the last command would make
# an explicit `source ~/.zshenv` exit non-zero when the profile is absent.
if [ -f "$HOME/.nix-profile/etc/profile.d/hm-session-vars.sh" ]; then
  . "$HOME/.nix-profile/etc/profile.d/hm-session-vars.sh"
fi
