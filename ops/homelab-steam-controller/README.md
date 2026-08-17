# Homelab Steam controller recognition fix

Fix for DualShock 4 controllers not registering as controllers in Steam on the
`homelab` host (Ubuntu 24.04, GNOME/Wayland, gdm-autologin, Steam native deb).

## Observed symptom

- Steam (Settings -> Controller) showed **no controller**, or at most one
  degraded "PS4 Controller" with no identity, while one or two DualShock 4 v2
  pads (`054c:09cc`, BT MACs `a4:ae:11:d0:25:f9` and `dc:af:68:fb:71:eb`) were
  connected.
- The kernel saw the pads fine the whole time: `hid-playstation` registered
  them, `/dev/input/eventN` + `jsN` + `/dev/hidrawN` existed, BlueZ showed
  `Connected: yes`, `Paired: yes`, `Trusted: yes`.

## Root cause

Separated into trigger, mechanism, masking condition, and visible symptom:

1. **Trigger (environmental, pre-existing):** since boot, the distro's
   `/usr/lib/udev/rules.d/71-nvidia.rules` fires failing
   `/sbin/modprobe nvidia*` calls in a tight loop (12,732 failures in the
   first 28 minutes after boot, still ongoing at diagnosis time; GPU is in
   vfio/nvidia flux from the RTX 3060 / `pi-stt` migration). `systemd-udevd`
   burns ~46% CPU continuously, `udevadm settle` never returns ("Timed out
   for waiting the udev queue being empty"), and GDM session workers time out
   waiting on the udev queue at login.
2. **Mechanism:** when a DS4 (re)connects over Bluetooth, devtmpfs creates
   `/dev/hidrawN` as `0600 root:root`. Access for `054c` hidraw nodes comes
   only from `TAG+="uaccess"` (stock `60-steam-input.rules`); the uaccess
   builtin needs a logind round-trip from the udev worker. Under the storm --
   and also whenever the GDM greeter owns the seat (this box idles at the
   login screen) -- that step fails or lags: the node stays `0600` (verified:
   node born 14:10:53 still `crw------- root root` minutes later, while its
   udev DB entry already carried `TAGS=:seat:uaccess:`). Steam's SDL opens
   the hidraw node at device-appearance time, gets `EACCES`, and **permanently
   registers the pad as `driver = NONE (DISABLED)`** for the process lifetime
   (`~/.local/share/Steam/logs/console_log.txt`:
   `HIDAPI_SetupDeviceDriver() couldn't open /dev/hidrawN: Permission denied`).
3. **Masking condition:** much later, SDL's generic evdev fallback can surface
   the pad, but with no serial -> Steam synthesizes `54c-9cc-395442b`, identical
   for both DS4s, so the two pads dedupe into ONE visible entry, with a degraded
   mapping (no touchpad) and broken per-controller config persistence.
4. **Visible symptom:** controller missing in Steam's controller UI and in
   games, despite being connected and functional at every OS layer.

Intermittency explained: on a quiet host (e.g. 2026-08-16 23:40-23:41) the same
hotplugs won the race and logged
`Added HIDAPI device ... driver = SDL_JOYSTICK_HIDAPI_PS4 (ENABLED)` with real
serials -- the proven path this fix restores deterministically.

## Layers checked

| Layer | Result |
| --- | --- |
| Physical / BT link | Both pads Connected/Paired/Trusted via onboard BT (Foxconn 0489:e0e2); links flap occasionally (see Follow-ups) |
| USB identity (`lsusb`) | n/a (Bluetooth HID), BT adapter healthy |
| Kernel input (`/proc/bus/input/devices`, journal) | `hid-playstation` registers both pads every time; evdev `js0/js1` present |
| `/dev/input` + hidraw perms | evdev `root:input 0660`; hidraw nodes intermittently left `0600 root:root` (the bug) |
| udev rules | Stock `60-steam-input.rules` present; grants access only via `uaccess` tag |
| Seat/session | Greeter owns seat while box idles; uaccess ACL follows active session -- but EACCES also reproduced during a confirmed-active session |
| Steam runtime/SDL | SDL 3.4.0, udev hidapi discovery; hotplug monitor alive (removals logged within 1s) |
| Steam Input settings | PlayStation hidapi path ENABLED at startup; per-controller configsets exist for the real serials |

## Counterfactual test and disconfirming evidence

- Test: with the GNOME session confirmed active, `bluetoothctl disconnect` /
  reconnect DS4 `a4:ae:11:d0:25:f9` (the pad not in use; the in-game pad was
  untouched and MK11 unaffected).
- Disconnect half: SDL removed the device within ~1s (monitor healthy).
- Reconnect half (after a physical PS-button press -- host-side reconnect is
  impossible once the DS4 powers off; BlueZ reports `Host is down (112)`):
  SDL **still** got `Permission denied` at 14:10:53 and re-registered the pad
  as `driver = NONE (DISABLED)`.
- This **disconfirmed** the initial "greeter owns the seat" theory as the sole
  cause and exposed the load-dependent uaccess/logind failure (the udev storm
  above). It also confirmed the group-based fix shape: GROUP/MODE are applied
  locally by udevd in the same rule pass that emits the uevent (rule processing
  demonstrably runs even under the storm -- DB entries/TAGS land); only the
  logind round-trip fails.

## Fix

`71-steam-controller-hidraw.rules` sets `GROUP="input", MODE="0660"` on Sony
controller hidraw nodes (`KERNELS=="0003:054C:*"` USB and `0005:054C:*"` BT;
vendor-attr matching silently never matches Bluetooth pads), keeping
`TAG+="uaccess"` for multi-seat correctness. `avirus` is added to group
`input`. Trade-off accepted by the captain: group `input` can read all
`/dev/input/event*` (incl. keyboards) on this single-user appliance box.

## Apply (on homelab)

```sh
sudo ~/dotfiles/ops/homelab-steam-controller/apply.sh
```

Then re-login (or reboot) so group membership reaches the running Steam, and
reconnect the pad (PS button) or restart Steam.

Expected verification after apply:

```
console_log.txt: Added HIDAPI device 'Wireless Controller' VID 0x054c, PID 0x09cc, bluetooth 1, serial a4:ae:11:d0:25:f9, driver = SDL_JOYSTICK_HIDAPI_PS4 (ENABLED)
controller.txt:  Local Device Found / type: 054c 09cc / !! Steam controller device opened for index N
```

and no `Permission denied` lines.

## Follow-ups (not fixed here)

- **udev storm:** `71-nvidia.rules` failing-`modprobe` loop (~46% CPU udevd,
  queue never settles) is a side effect of the RTX 3060 / `pi-stt` GPU
  migration owned by another worker. Controller hotplug becomes reliable once
  udevd is calm; this fix removes the remaining race margin. Do not "fix" the
  nvidia rule from this lane.
- **BT link flapping:** pads drop with `hid_read failure` on DS4 idle power-off
  (overnight: benign) and occasionally in rapid drop/reconnect bursts
  (2026-08-16 23:39-23:41: worth a `btmon` look another day). With deterministic
  hotplug recovery, a flap is a seconds-long blip instead of a permanently
  invisible controller.
