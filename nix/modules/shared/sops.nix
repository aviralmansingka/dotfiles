# Fleet secrets, common half. The sops-nix Home Manager module is imported by
# both profile constructors (nix/lib/fleet.nix); this file says what every host
# needs from it: the two tools, and the format, which is the same everywhere.
#
# The encrypted files live in `secrets/` at the repo root and their recipients
# are in `.sops.yaml`. Both are tracked, because the ciphertext is the point;
# plaintext and the private keys are not (root .gitignore).
#
# Where the identity lives is per profile, because it differs: a Linux host uses
# its SSH host key (nix/modules/remote/default.nix), the MacBook names the admin
# age key file (nix/modules/macbook/home.nix). `sops.age.keyFile` is deliberately
# not set here: sops-install-secrets fails the whole activation when the file it
# names is missing, so only the machine that really holds the key may name it.
{
  pkgs,
  ...
}:

{
  # sops is needed on the host to edit or decrypt by hand; ssh-to-age turns an
  # SSH key into the age identity sops reads, which is how a host decrypts with
  # the key it already has.
  home.packages = [
    pkgs.sops
    pkgs.ssh-to-age
  ];

  sops.defaultSopsFormat = "yaml";
}
