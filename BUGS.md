# Known Bugs

No open issues currently.

Neovide's two open issues (background-color inconsistency, intermittent
OSC52 clipboard errors) were closed by removing Neovide entirely — the
cask, the `nvim/.config/nvim/lua/plugins/neovide.lua` spec, and its BUGS
entries — in the dead-code cleanup. The fixed signature-help duplicate
(noice handler disabled; blink.cmp is the sole provider) lives on in
`nvim/.config/nvim/lua/plugins/noice.lua` and in git history.
