# Kanata Setup Handout

## Goal

Install Kanata 1.12.0 on this Arch Linux ARM machine, give it only the device access it needs,
apply mirrored home-row modifiers to the Air65 Bluetooth keyboard, and keep it running as an
unprivileged systemd user service.

Do not run ahead during the guided session. Each state-changing command has a verification step.

## Input path

```mermaid
flowchart LR
    A[Air65 Bluetooth HID] --> B[Linux HID and evdev]
    B --> C[Kanata]
    C --> D[uinput virtual keyboard]
    D --> E[Hyprland and XKB]
    E --> F[Applications]
```

Kanata reads physical events from evdev and writes transformed events through uinput. Hyprland
sees the resulting virtual keyboard and applies its normal XKB configuration afterward.

## Observed host state

- Operating system: Omarchy 4.0.2, based on Arch Linux.
- Architecture: AArch64 on an Asahi kernel.
- Keyboard input name: `Air65 V3-3 Keyboard`.
- Current input node: `/dev/input/event4`; this number is not stable across reconnects.
- The keyboard node is owned by `root:input`, and `avirus` already belongs to `input`.
- `/dev/uinput` began as `root:root` mode `0600`; the installed rule now produces
  `root:uinput` mode `0660`.
- Kanata 1.12.0 is installed at `/usr/bin/kanata`.
- Pacman owns it through package `kanata 1.12.0-1`.
- Hyprland currently applies `ctrl:nocaps`; the first Kanata map leaves Caps Lock alone.

## Installation choice

Use the already-installed Arch package. It provides Kanata 1.12.0 at `/usr/bin/kanata`, so no
second installation or Rust toolchain is needed. Pacman now owns upgrades and removal.

## Permission model

Kanata needs two independent capabilities:

1. Read the Air65 event stream through `/dev/input/event*`.
2. Inject the transformed stream through `/dev/uinput`.

The first is already supplied by membership in `input`. The setup creates a system group named
`uinput`, assigns the uinput character device to it through udev, and adds `avirus` to that group.
This avoids running the entire remapper as root.

Membership in `input` permits raw keyboard reads. Membership in `uinput` permits synthetic input
injection. Both are security-sensitive capabilities.

## Implementation status

- The system group, udev rule, modules-load entry, and live `uinput` module are installed.
- The tested configuration and user unit are deployed through Stow.
- `kanata.service` is enabled and active.
- Kanata opened `/dev/input/event4` and `/dev/uinput`, ignored its own virtual device, and left the
  built-in keyboard and other input devices untouched.
- Deterministic simulations confirmed normal `l`-`a` overlap, intentional Right-Alt+A,
  Right-Super+1, right-Control+C, and a fast `D`-`F` roll.
- Physical Bluetooth power-cycle testing and fresh-login group verification remain manual checks.

## Home-row behavior

| Physical key | Tap | Hold |
| --- | --- | --- |
| `A` | `a` | Left Meta: Super on Linux, Command on macOS |
| `S` | `s` | Left Alt |
| `D` | `d` | Left Control |
| `F` | `f` | Left Shift |
| `J` | `j` | Right Shift |
| `K` | `k` | Right Control |
| `L` | `l` | Right Alt |
| `;` | `;` | Right Meta: Super on Linux, Command on macOS |

The map uses `tap-hold-opposite-hand-release`. A home-row key becomes a modifier when an
opposite-hand target is pressed and released while the modifier remains held. Releasing the
home-row key first preserves normal overlapping rolls such as `l` then `a`. For example, use
right-hand `K` as Control for `K+C`, and left-hand `D` as Control for `D+L`. Number keys are split
`1–5` left and `6–0` right, so right-hand `;` becomes Super for workspace combinations such as
`;+1`, `;+2`, and `;+3`.

The prior-idle threshold is 150 ms. If another key was pressed during the preceding 150 ms, a
home-row key resolves immediately as its letter. After a longer idle, normal tap-hold handling
uses a 180 ms hold timeout.

## Configuration file

Create `~/dotfiles/kanata/.config/kanata/config.kbd` with this tested configuration:

```lisp
(defcfg
  process-unmapped-keys yes
  tap-hold-require-prior-idle 150
  linux-dev-names-include ("Air65 V3-3 Keyboard")
  linux-continue-if-no-devs-found yes
)

(defhands
  (left  1 2 3 4 5 q w e r t a s d f g z x c v b)
  (right 6 7 8 9 0 y u i o p h j k l ; n m , . /))

(defsrc
  q   w   e   r   t   y   u   i   o   p
  a   s   d   f   g   h   j   k   l   ;
  z   x   c   v   b   n   m   ,   .   /
                  spc
)

(defvar
  hold-time 180
)

(defalias
  a (tap-hold-opposite-hand-release $hold-time a lmet)
  s (tap-hold-opposite-hand-release $hold-time s lalt)
  d (tap-hold-opposite-hand-release $hold-time d lctl)
  f (tap-hold-opposite-hand-release $hold-time f lsft)
  j (tap-hold-opposite-hand-release $hold-time j rsft)
  k (tap-hold-opposite-hand-release $hold-time k rctl)
  l (tap-hold-opposite-hand-release $hold-time l ralt)
  ; (tap-hold-opposite-hand-release $hold-time ; rmet)
)

(deflayer base
  q   w   e   r   t   y   u   i   o   p
  @a  @s  @d  @f  g   h   @j  @k  @l  @;
  z   x   c   v   b   n   m   ,   .   /
                  spc
)
```

This exact file was checked successfully with Kanata 1.12.0 built from the tagged source.

`linux-dev-names-include` uses the whole device name because Bluetooth keyboards generally lack a
stable `/dev/input/by-id` link. `linux-continue-if-no-devs-found` keeps Kanata alive while the
keyboard sleeps or disconnects; the Linux backend watches `/dev/input` and reopens matching
devices when they return.

## User service

Create `~/dotfiles/systemd/.config/systemd/user/kanata.service`:

```systemd
[Unit]
Description=Kanata keyboard remapper
Documentation=https://github.com/jtroo/kanata

[Service]
Type=simple
ExecStart=/usr/bin/kanata --cfg %h/.config/kanata/config.kbd --no-wait
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
```

- `%h` expands to the service user's home directory.
- `--cfg` selects the stowed configuration.
- `--no-wait` makes Kanata exit immediately after an error, allowing systemd to restart it.
- `Restart=on-failure` retries crashes but does not restart a normal emergency exit.
- `WantedBy=default.target` starts the unit with the user manager after login.

The user manager has `Linger=no`, so this service does not run before login or at disk unlock.

## Guided command reference

### 1. Locate the executable

```bash
command -v kanata
```

`command -v` searches the shell's executable path. The observed result is `/usr/bin/kanata`; the
lookup performs no kernel or package changes.

### 2. Verify package ownership

```bash
pacman -Qo "$(command -v kanata)"
```

`-Q` queries the installed package database and `-o` asks which package owns the resolved path.
This reads pacman's local database without changing packages.

### 3. Verify the executable version

```bash
kanata --version
```

This executes the userspace binary without opening input devices. The required version is 1.12.0.

### 4. Check for the output group

```bash
getent group uinput
```

`getent` queries the Name Service Switch group database. On this host, no `uinput` group currently
exists, so a nonzero exit is expected.

### 5. Create the system group

```bash
sudo groupadd --system uinput
```

`--system` allocates a system-group ID and updates `/etc/group` and `/etc/gshadow`. It does not
change the current process's supplementary groups.

### 6. Add the login user

```bash
sudo usermod -aG uinput "$USER"
```

`-G` names a supplementary group; `-a` appends rather than replacing existing memberships. The
new membership takes effect for processes created by a fresh login session.

### Safety check before step 7

```bash
if [[ -e /etc/udev/rules.d/99-kanata-uinput.rules ]]; then printf 'exists\n'; else printf 'absent\n'; fi
```

This checks whether the exact destination already exists before `tee` overwrites it. The observed
state is `absent`.

### 7. Install the udev rule

```bash
printf '%s\n' 'KERNEL=="uinput", MODE="0660", GROUP="uinput", OPTIONS+="static_node=uinput"' \
  | sudo tee /etc/udev/rules.d/99-kanata-uinput.rules
```

The rule matches the kernel's `uinput` misc device. udev will make its character node writable by
root and members of `uinput`; `static_node` preserves `/dev/uinput` creation semantics.

### Validate step 7

```bash
udevadm verify /etc/udev/rules.d/99-kanata-uinput.rules
```

`verify` parses the rule file without changing devices. It should report one success and no
failures before the rule is activated.

### Safety check before step 8

```bash
if [[ -e /etc/modules-load.d/uinput.conf ]]; then printf 'exists\n'; else printf 'absent\n'; fi
```

This protects an existing boot-module configuration from accidental replacement. The observed
state is `absent`.

### 8. Load uinput on future boots

```bash
printf '%s\n' uinput | sudo tee /etc/modules-load.d/uinput.conf
```

`systemd-modules-load` reads this file during boot and requests the kernel module named `uinput`.

### 9. Reload udev rules

```bash
sudo udevadm control --reload-rules
```

This asks the running udev manager to re-read rule files. It does not itself replay a device event.

### 10. Load the kernel module now

```bash
sudo modprobe uinput
```

`modprobe` loads `uinput.ko`, which registers the userspace input character device at major 10,
minor 223.

### 11. Verify the loaded module

```bash
grep '^uinput ' /proc/modules
```

`/proc/modules` reflects the running kernel's module list. A line beginning with `uinput` confirms
that the live driver, rather than only its boot configuration, is present.

### 12. Verify persistent device permissions

```bash
stat -c '%A %U:%G %n' /dev/uinput
```

`-c` selects the displayed mode, owner, group, and path. The persistent expected state is
`crw-rw---- root:uinput /dev/uinput`. A trailing `+` appears while the temporary named-user ACL is
present.

If the load event did not apply the rule, retrigger only this device and repeat the check:

```bash
sudo udevadm trigger --subsystem-match=misc --sysname-match=uinput
```

The observed load event already applied the rule, so the guided session skips this conditional
recovery command.

### Temporary current-session bridge

The guided setup kept the current graphical session alive by applying a named-user ACL:

```bash
sudo setfacl -m u:avirus:rw /dev/uinput
```

This grants the current device node to UID `avirus`; it does not update the user manager's
supplementary groups. Device recreation may remove this ACL, while the persistent group-based udev
rule remains. Do not rely on the ACL after reboot.

### 13. Refresh login credentials

Log out and back in, then run:

```bash
id -nG
```

`-n` prints names and `-G` prints supplementary groups. A process inherits this set when it is
created; editing `/etc/group` cannot alter the already-running user manager.

### 14. Create the Stow package directory

```bash
mkdir -p "$HOME/dotfiles/kanata/.config/kanata"
```

`-p` creates missing parent directories and is harmless if they already exist. This only changes
the repository working tree.

### 15. Edit the Kanata configuration

```bash
nvim "$HOME/dotfiles/kanata/.config/kanata/config.kbd"
```

Paste the tested configuration from this handout. This writes a repository file, not an active
system configuration yet.

### 16. Deploy the configuration

```bash
stow -R -d "$HOME/dotfiles" -t "$HOME" kanata
```

`-R` restows the package, `-d` selects the package directory, and `-t` selects the home-directory
target. Stow creates `~/.config/kanata/config.kbd` as a symlink into the repository.

### 17. Validate without grabbing the keyboard

```bash
kanata --check --cfg "$HOME/.config/kanata/config.kbd"
```

`--check` parses and validates, then exits. It does not open evdev or uinput devices.

### 18. Test in the foreground

```bash
kanata --debug --cfg "$HOME/.config/kanata/config.kbd"
```

`--debug` shows device discovery and key-resolution details. Kanata grabs only the exact Air65
name, reads its evdev stream, and creates a virtual keyboard through uinput.

Hold physical Left Control, Space, and Escape together for an emergency exit. Kanata recognizes
this chord from physical input state and exits normally. `Ctrl+C` in the launching terminal is
also available.

### 19. Create the user unit

```bash
nvim "$HOME/dotfiles/systemd/.config/systemd/user/kanata.service"
```

Paste the unit from this handout. The file remains under version control with the other user units.

### 20. Restow the systemd package

```bash
stow -R -d "$HOME/dotfiles" -t "$HOME" systemd
```

This adds the new unit symlink under `~/.config/systemd/user` without altering the existing units.

### 21. Validate the user unit

```bash
systemd-analyze --user verify "$HOME/.config/systemd/user/kanata.service"
```

`--user` selects the per-user unit search path. `verify` parses the unit, resolves specifiers, and
checks that its executable exists without starting the service.

### 22. Reload the user manager

```bash
systemctl --user daemon-reload
```

The command asks the per-user systemd manager to rescan unit files. It does not start Kanata.

### 23. Enable and start Kanata

```bash
systemctl --user enable --now kanata.service
```

`enable` creates a dependency link from `default.target`; `--now` also starts the unit immediately.
The service inherits the fresh login's `input` and `uinput` groups.

### 24. Inspect service state

```bash
systemctl --user status --no-pager kanata.service
```

`--no-pager` prints directly in the terminal. The expected state is `active (running)`.

### 25. Inspect service logs

```bash
journalctl --user -u kanata.service -b -n 50 --no-pager
```

`--user` selects the user journal, `-u` selects the unit, `-b` limits output to this boot, and
`-n 50` limits the result. These logs expose parse errors and Bluetooth rediscovery.

### 26. Verify Bluetooth reconnection

Turn the Air65 off, wait for disconnection, turn it on, and then repeat the journal command. Kanata
should remain running while no device matches and register `Air65 V3-3 Keyboard` when it returns.

## Immediate recovery

Stop the service from another keyboard, a TTY, or SSH:

```bash
systemctl --user stop kanata.service
```

This asks the user manager to terminate Kanata and releases its evdev grab.

Prevent it from starting at the next login:

```bash
systemctl --user disable kanata.service
```

Remove only the deployed Kanata configuration link while keeping the repository file:

```bash
stow -D -d "$HOME/dotfiles" -t "$HOME" kanata
```

`-D` removes links owned by that Stow package. It does not delete the source configuration.

## Sources

- [Kanata 1.12.0 release](https://github.com/jtroo/kanata/releases/tag/v1.12.0)
- [Kanata Linux setup](https://github.com/jtroo/kanata/blob/main/docs/setup-linux.md)
- [Kanata configuration guide](https://github.com/jtroo/kanata/blob/main/docs/config.adoc)
- [Linux uinput documentation](https://docs.kernel.org/input/uinput.html)
- [systemd user units](https://wiki.archlinux.org/title/Systemd/User)
- [GNU Stow manual](https://www.gnu.org/software/stow/manual/stow.html)
