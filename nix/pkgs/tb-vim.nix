# tb-vim: vim-style keyboard navigation for terminal-browser tabs.
#
# terminal-browser has no Chrome extension support yet, so this installs a small
# page layer over the browser's CDP port instead. The wrapper keeps the Node
# entry point and the page layer together, so `tb-vim` works from any directory.
{
  lib,
  writeShellApplication,
  nodejs,
}:

let
  src = ../../scripts/tb-vim;
in
writeShellApplication {
  name = "tb-vim";
  runtimeInputs = [ nodejs ];
  text = ''
    exec node ${src}/tb-vim.mjs "$@"
  '';

  meta = {
    description = "Vim-style keyboard navigation for terminal-browser tabs";
    mainProgram = "tb-vim";
    license = lib.licenses.mit;
  };
}
