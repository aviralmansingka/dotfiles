#!/usr/bin/env bash
# Install the seat-independent Steam controller hidraw rule on the homelab.
#
# Usage (on homelab):
#   sudo ~/dotfiles/ops/homelab-steam-controller/apply.sh
#
# Afterwards: log the GNOME session out and back in (or reboot) so group
# "input" reaches already-running processes such as Steam, then reconnect the
# controller (PS button) or restart Steam. See README.md for why.
set -euo pipefail

readonly RULE_SRC="$(cd "$(dirname "$0")" && pwd -P)/71-steam-controller-hidraw.rules"
readonly RULE_DST="/etc/udev/rules.d/71-steam-controller-hidraw.rules"
readonly GAMING_USER="avirus"

install -m 0644 -o root -g root "$RULE_SRC" "$RULE_DST"
usermod -aG input "$GAMING_USER"
udevadm control --reload
# Apply the rule to already-connected controller hidraw nodes.
udevadm trigger --subsystem-match=hidraw --action=change

echo "Installed $RULE_DST"
echo "Added $GAMING_USER to group input (effective for new logins)."
echo "Next: re-login (or reboot), then reconnect the controller or restart Steam."
