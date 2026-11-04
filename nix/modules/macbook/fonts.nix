# Fonts are a system concern on macOS: CoreText reads font directories, not the
# Nix store, so a `home.packages` font is invisible to applications. nix-darwin
# builds /Library/Fonts/Nix Fonts and the activation copies real files there.
#
# Mapping from the five Homebrew font casks captured in S02:
#   font-fira-code-nerd-font         -> nerd-fonts.fira-code
#   font-jetbrains-mono-nerd-font    -> nerd-fonts.jetbrains-mono
#   font-meslo-lg-nerd-font          -> nerd-fonts.meslo-lg
#   font-symbols-only-nerd-font      -> nerd-fonts.symbols-only
#   font-sf-mono                     -> accepted gap: Apple's SF Mono has no
#                                       nixpkgs package, so the cask stays
#                                       until the owner drops the family.
{ pkgs, ... }:

{
  fonts.packages = with pkgs; [
    nerd-fonts.fira-code
    nerd-fonts.jetbrains-mono
    nerd-fonts.meslo-lg
    nerd-fonts.symbols-only
  ];
}
