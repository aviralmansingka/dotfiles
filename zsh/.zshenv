# Sourced by all zsh invocations (login, interactive, scripts)
# Keep this minimal — only PATH setup that must be available everywhere

# typeset -U keeps PATH free of duplicate entries across re-sourcing.
typeset -U path PATH
export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
# if-form, not `[ -f ] &&`: a failed test as the last command would make
# an explicit `source ~/.zshenv` exit non-zero when cargo/env is absent.
if [ -f "$HOME/.cargo/env" ]; then . "$HOME/.cargo/env"; fi
