# T20 Q35 machine-type evaluation and V01–V03 evidence

**Evaluation host:** `homelab` (Linux/KVM)
**Evidence collected:** V01: 2026-07-26 15:42:14Z–15:55:28Z; V02: 2026-07-26 17:23:04Z–17:26:33Z; V03: 2026-07-26 17:39:09Z–17:41:46Z; accepted review hardening and postchecks: 2026-07-26 18:02:05Z–18:04:50Z
**Status:** V01 recommendation **owner approved**; V02 and V03 verifiers **passed**; accepted review hardening **passed** with the V03 resources retained. Canonical V01 approval source: Vault Hunter Run `vh-T20-1785077639159`, Run observation `T20.V01.q35-selection.approved.2026-07-26` at Registry revision 12. The V02 host-local endpoint was separately approved in Run observation `T20.V02.host-local-probe.approved.2026-07-26`. This is not a claim of canonical vault completion or cleanup: no vault path was inspected or changed, and retained-resource teardown remains a checkpoint-two obligation.

## Recommendation

Recommend **QEMU/KVM Q35**, managed by libvirt's QEMU driver at `qemu:///system`, using the requested stable alias `q35`. On this host libvirt resolved that request to `pc-q35-noble` in domain XML.

Both Q35 and a carefully minimized `microvm` booted the approved Ubuntu fixture and passed the same block, network, console, and cold-lifecycle probes. The approved tie-break is operational maturity and compatibility first. Q35 worked through the ordinary `virt-install` path with Ubuntu 24.04 OS metadata and UEFI. `microvm` first failed with `No PCI buses available` and required hand-authored XML, explicit `virtio-mmio` addresses, and explicit suppression of libvirt's implicit USB, balloon, and video devices. That narrower and less conventional device/firmware path provides no material benefit required by T20, so Q35 wins the tie-break. Cloud Hypervisor cannot be managed by the installed libvirt build and was excluded before boot.

This is an owner-approved selection. This document is implementation evidence, not a vault ADR. V02 was performed under the canonical Run authorization while the shared vault lock was held elsewhere; no vault aggregate state was inspected or changed.

## Fixture and host identity

- Host kernel: `Linux homelab 7.0.0-28-generic ... x86_64 GNU/Linux`.
- Libvirt URI/driver: `qemu:///system`, QEMU driver (`Using API: QEMU 10.0.0`).
- Acceleration/hypervisor: domain type `kvm`; QEMU 8.2.2 at `/usr/bin/qemu-system-x86_64`.
- Libvirt: client, API, and daemon 10.0.0.
- Network: existing libvirt network `default`, active, persistent, bridge `virbr0`. Its definition, active/autostart state, and firewall were not altered. The two evaluated guests obtained ordinary dynamic DHCP leases.
- Representative image: Ubuntu 24.04 LTS Canonical cloud image, `noble-server-cloudimg-amd64.img`.
- Canonical source: `https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img`.
- Canonical checksum source: `https://cloud-images.ubuntu.com/noble/current/SHA256SUMS`.
- SHA-256 observed in Canonical metadata and verified after download: `d1940f7d69d343355e183dff1e08a59852d32e7309baa7a4bad8365b11b005ac`.
- Image metadata: qcow2, virtual size 3.5 GiB (3,758,096,384 bytes), downloaded file size 624,105,472 bytes. The guest console identified itself as Ubuntu 24.04.4 LTS; guest kernel was `6.8.0-136-generic`.

The image was downloaded only to `/var/tmp/t20-v01-work`, copied into the disposable `t20-v01-pool`, and removed during cleanup.

## Comparative disposition

| Criterion | QEMU/KVM Q35 | QEMU/KVM `microvm` | Cloud Hypervisor |
|---|---|---|---|
| Native libvirt manageability on `homelab` | **Pass.** QEMU driver, `qemu:///system`; ordinary `virt-install` completed. | **Pass with material caveat.** QEMU driver accepted hand-authored `microvm` XML only after implicit PCI-dependent devices were suppressed and virtio devices were explicitly addressed as `virtio-mmio`. | **Unavailable.** `ch:///system` returned `no connection driver available`; no `cloud-hypervisor` executable was installed. Excluded before boot under the V01 rule. |
| KVM acceleration | **Pass.** Live domain XML had `type="kvm"`; guest reported `systemd-detect-virt=kvm`. | **Pass.** Same observations. | **Not testable:** required native libvirt driver is unavailable. |
| Requested / observed machine | `q35` / `pc-q35-noble` | `microvm` / `microvm` | No domain could be defined. |
| Ubuntu 24.04 representative boot | **Pass.** Cloud-init `status: done`; SSH ready; systemd user transient unit passed; writable home. | **Pass after custom XML.** Same guest checks passed. | Not run because native management is unavailable. |
| Persistent block device | **Pass.** qcow2 root was `/dev/vda1` ext4; marker survived graceful shutdown and cold start. | **Pass.** Same result. | Not testable because native management is unavailable. |
| Libvirt-network connectivity | **Pass.** `network=default`, virtio NIC, DHCP address `192.168.122.116`; SSH from host and ping to `192.168.122.1` passed. | **Pass.** `network=default`, virtio-mmio NIC, DHCP address `192.168.122.190`; the same probes passed. | Not testable because native management is unavailable. |
| Headless diagnostics / console | **Pass.** No graphics, PTY serial console, active guest `serial-getty@ttyS0`; `virsh console` attached and displayed the Ubuntu login prompt. | **Pass.** No graphics, PTY serial console, active guest serial getty; `virsh console` attached. | Not testable because native management is unavailable. |
| Graceful stop/start | **Pass.** `virsh shutdown` reached `shut off` on poll 2; start succeeded; SSH returned on poll 3. | **Pass.** Same result. | Not testable because native management is unavailable. |
| Stable alias / version pin | **Recommend stable alias `q35`.** Record resolved `pc-q35-noble` as V02's expected XML value on this host; do not request the downstream resolved name as a production pin. | If selected, request stable `microvm`; no versioned alternative was reported. Rejected. | Not applicable. |
| Material limitations | Larger, conventional PC/PCI device surface; host-specific alias resolution means V02 must compare against the live observed value recorded below. | Default Ubuntu `virt-install` XML was incompatible; no automatic x86 EFI firmware was advertised for `microvm`; reduced PCI/USB/video/balloon support; requires specialized XML and virtio-mmio devices. | Installed libvirt has no `ch` connection driver, and the hypervisor executable is absent. |
| Disposition / rejection reason | **Recommended and owner approved.** Best maturity and compatibility. | **Rejected by tie-break**, despite functional probes: materially more specialized integration for no required benefit. | **Rejected/unavailable:** no native libvirt management on the target host. |

The DHCP addresses above are historical evidence only. Both domains, their interfaces, storage, and scratch data were removed; no evaluated guest is currently reachable at either value. Any DHCP lease-record expiry remains owned by the unchanged existing network.

## Reproduction values for V02 and V03

These are the literal values observed and verified during V02. `T20_GUEST` records that observation, not a static address:

```sh
T20_URI='qemu:///system'
T20_DOMAIN='t20-v02-q35'
T20_GUEST='t20eval@192.168.122.164'
T20_KEY='/home/avirus/.local/state/t20-v02-q35/id_ed25519'
T20_KNOWN_HOSTS='/home/avirus/.local/state/t20-v02-q35/known_hosts'
T20_EXPECTED_DOMAIN_TYPE='kvm'
T20_EXPECTED_MACHINE='pc-q35-noble'
T20_EXPECTED_EMULATOR='/usr/bin/qemu-system-x86_64'
T20_PEER_HOST='192.168.122.1'
T20_PEER_PORT='18767'
```

V03 and later retained-state checks use the same `T20_URI` and `T20_DOMAIN`, but must re-read the dynamic lease and construct `T20_GUEST` immediately before use. The successful checked SSH mechanism was:

```sh
T20_IP=$(virsh -c "$T20_URI" domifaddr "$T20_DOMAIN" --source lease | awk '$3 == "ipv4" {sub(/\/.*/, "", $4); print $4; exit}')
test -n "$T20_IP"
T20_GUEST="t20eval@$T20_IP"
timeout 60 ssh -n -i "$T20_KEY" \
  -o BatchMode=yes -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$T20_KNOWN_HOSTS" \
  -o ConnectTimeout=2 "$T20_GUEST" /usr/bin/true
```

Any canonical command abbreviated as plain `ssh "$T20_GUEST" ...` requires these equivalent checked identity, batch, host-key, known-hosts, and timeout options either on the command line or in effective SSH configuration; unchecked default plain SSH is not the reproduced mechanism. The TCP peer was V02-only and no longer exists. Continue requesting stable alias `q35`; if the host package set changes and it resolves differently, review the new live value rather than forcing `pc-q35-noble`. Resource sizing, autostart, crash restart, production image lifecycle, and production provisioning remain outside V01/V02.

## Live command evidence

Outputs below are limited to candidate-relevant fields. SSH keys, credentials, tokens, unrelated domains, and unrelated host data were neither printed nor recorded. Bracketed exit statuses are from the target host unless identified as the local SSH wrapper.

### Host, driver, capabilities, and image

At `2026-07-26T15:42:14Z`:

```console
$ virsh -c qemu:///system uri
qemu:///system
[exit 0]

$ virsh -c qemu:///system version --daemon
Compiled against library: libvirt 10.0.0
Using library: libvirt 10.0.0
Using API: QEMU 10.0.0
Running hypervisor: QEMU 8.2.2
Running against daemon: 10.0.0
[exit 0]

$ qemu-system-x86_64 --version
QEMU emulator version 8.2.2 (Debian 1:8.2.2+ds-0ubuntu1.17)
[exit 0]

$ virsh -c qemu:///system domcapabilities --virttype kvm --arch x86_64 --machine q35
<domainCapabilities>
  <path>/usr/bin/qemu-system-x86_64</path>
  <domain>kvm</domain>
  <machine>pc-q35-noble</machine>
  ...
</domainCapabilities>
[exit 0]

$ virsh -c qemu:///system domcapabilities --virttype kvm --arch x86_64 --machine microvm
<domainCapabilities>
  <path>/usr/bin/qemu-system-x86_64</path>
  <domain>kvm</domain>
  <machine>microvm</machine>
  ...
  <os supported='yes'>
    <enum name='firmware'/>
    ...
  </os>
  ...
</domainCapabilities>
[exit 0]
```

At `2026-07-26T15:43:15Z`, the existing network was read without `sudo`:

```console
$ virsh -c qemu:///system net-info default
Name:           default
UUID:           [omitted]
Active:         yes
Persistent:     yes
Autostart:      yes
Bridge:         virbr0
[exit 0]
```

The operator account is in `libvirt` and `kvm`. Non-interactive `sudo -n true` exited 1 (`sudo: a password is required`), but no privileged operation was needed: all evaluation lifecycle and storage-pool operations succeeded through the system libvirt API as the operator. No authentication blocker remained.

At `2026-07-26T15:43:15Z` and `15:44:34Z`:

```console
$ sh -c "curl -fsSL https://cloud-images.ubuntu.com/noble/current/SHA256SUMS | awk '$2 == \"noble-server-cloudimg-amd64.img\" || $2 == \"*noble-server-cloudimg-amd64.img\" {print; found=1} END {exit !found}'"
d1940f7d69d343355e183dff1e08a59852d32e7309baa7a4bad8365b11b005ac *noble-server-cloudimg-amd64.img
[exit 0]

$ curl -fL https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img -o /var/tmp/t20-v01-work/noble-server-cloudimg-amd64.img
[exit 0]

$ printf '%s  %s\n' d1940f7d69d343355e183dff1e08a59852d32e7309baa7a4bad8365b11b005ac /var/tmp/t20-v01-work/noble-server-cloudimg-amd64.img | sha256sum --check
/var/tmp/t20-v01-work/noble-server-cloudimg-amd64.img: OK
[exit 0]
```

### Cloud Hypervisor exclusion

This is the exact local capability test supporting pre-boot exclusion, collected at `2026-07-26T15:42:14Z`:

```console
$ virsh -c ch:///system capabilities
error: failed to connect to the hypervisor
error: no connection driver available for ch:///system
[exit 1]

$ command -v cloud-hypervisor
[no output]
[exit 1]
```

`ch:///system` is the native libvirt Cloud Hypervisor URI. Because the local libvirt installation reports that it has no connection driver for that URI, it cannot define, boot, attach storage/network/console, or perform lifecycle operations for a Cloud Hypervisor domain. Per V01, no substitute direct-hypervisor test was performed.

### Q35 creation, identity, guest, and lifecycle

The creation command completed at `2026-07-26T15:45:05Z`:

```console
$ virt-install --connect qemu:///system --name t20-v01-q35 --memory 2048 --vcpus 2 --cpu host-passthrough --machine q35 --boot uefi --osinfo ubuntu24.04 --import --disk path=/var/tmp/t20-v01-pool/t20-v01-q35.qcow2,format=qcow2,bus=virtio --disk path=/var/tmp/t20-v01-pool/t20-v01-q35-seed.img,format=raw,bus=virtio --network network=default,model=virtio --graphics none --console pty,target.type=serial --noautoconsole
Domain creation completed.
[exit 0]
```

Relevant `virsh -c qemu:///system dumpxml t20-v01-q35` fields at `2026-07-26T15:45:31Z`:

```text
domain_type=kvm
machine=pc-q35-noble
emulator=/usr/bin/qemu-system-x86_64
disk_targets=disk/vda/virtio,disk/vdb/virtio
interfaces=network/default/virtio/mac=[omitted]
consoles=pty/serial
graphics_count=0
```

The exact guest probe body was run over batch SSH to `t20eval@192.168.122.116` at `2026-07-26T15:46:11Z`:

```sh
set -eu
cloud-init status --wait
echo "virt=$(systemd-detect-virt)"
echo "kernel=$(uname -r)"
echo "boot_id_present=$(test -s /proc/sys/kernel/random/boot_id && echo yes)"
echo "root_source=$(findmnt -n -o SOURCE /)"
echo "root_fstype=$(findmnt -n -o FSTYPE /)"
echo "home_writable=$(test -w "$HOME" && echo yes)"
systemd-run --user --wait --collect --quiet /usr/bin/true
echo "systemd_user_transient=pass"
gateway=$(ip -4 route show default | awk '{print $3; exit}')
test -n "$gateway"
ping -c 1 -W 2 "$gateway" >/dev/null
echo "default_gateway=$gateway ping=pass"
echo "serial_getty=$(systemctl is-active serial-getty@ttyS0.service || true)"
printf 'T20-Q35-PERSIST-%s\n' "$(date -u +%s)" >"$HOME/.t20-v01-persistence"
sync
cat "$HOME/.t20-v01-persistence"
```

```text
status: done
virt=kvm
kernel=6.8.0-136-generic
boot_id_present=
root_source=/dev/vda1
root_fstype=ext4
home_writable=yes
systemd_user_transient=pass
default_gateway=192.168.122.1 ping=pass
serial_getty=active
T20-Q35-PERSIST-1785080771
[exit 0]
```

`boot_id_present` was an informational print with an empty value and was not used as a pass criterion; cloud-init completion, successful SSH, the running guest probes, and the console provide the boot result.

At `2026-07-26T15:46:11Z`, a bounded controlling-TTY `virsh console` capture attached and displayed the `Ubuntu 24.04.4 LTS t20-v01-q35 ttyS0` login prompt. At `15:46:28Z`, `timeout 5 script -q -c "virsh -c qemu:///system console t20-v01-q35 --force" /dev/null < /dev/null` independently attached again. Exit 124 was expected because each observation was deliberately bounded by `timeout`.

Cold lifecycle at `2026-07-26T15:46:55Z–15:47:09Z`:

```console
$ virsh -c qemu:///system shutdown t20-v01-q35
Domain 't20-v01-q35' is being shutdown
[exit 0]
$ # poll: virsh domstate t20-v01-q35, up to 60 times with 2s delay
stopped=true state=shut off attempts=2
[exit 0]
$ virsh -c qemu:///system start t20-v01-q35
Domain 't20-v01-q35' started
[exit 0]
$ # batch-SSH poll, up to 60 times with 3s delay
reachable=true attempts=3
[exit 0]
$ ssh ... 'cat "$HOME/.t20-v01-persistence"; systemd-run --user --wait --collect --quiet /usr/bin/true'
T20-Q35-PERSIST-1785080771
post_start_systemd_user=pass
[exit 0]
```

### `microvm` creation, identity, guest, and lifecycle

The ordinary Ubuntu path failed at `2026-07-26T15:47:28Z`:

```console
$ virt-install --connect qemu:///system --name t20-v01-microvm --memory 2048 --vcpus 2 --cpu host-passthrough --machine microvm --osinfo ubuntu24.04 --import --disk path=/var/tmp/t20-v01-pool/t20-v01-microvm.qcow2,format=qcow2,bus=virtio --disk path=/var/tmp/t20-v01-pool/t20-v01-microvm-seed.img,format=raw,bus=virtio --network network=default,model=virtio --graphics none --console pty,target.type=serial --noautoconsole
ERROR    XML error: No PCI buses available
[exit 1]
```

A minimal domain with the same memory, CPU, disks, NIC, and serial console was then defined with these candidate-significant XML fields:

```xml
<domain type='kvm'>
  <name>t20-v01-microvm</name>
  <memory unit='MiB'>2048</memory><vcpu>2</vcpu>
  <os><type arch='x86_64' machine='microvm'>hvm</type><boot dev='hd'/></os>
  <features><acpi/><apic/></features>
  <cpu mode='host-passthrough'/>
  <devices>
    <emulator>/usr/bin/qemu-system-x86_64</emulator>
    <controller type='usb' model='none'/>
    <memballoon model='none'/><video><model type='none'/></video>
    <disk type='file' device='disk'><driver name='qemu' type='qcow2'/><source file='/var/tmp/t20-v01-pool/t20-v01-microvm.qcow2'/><target dev='vda' bus='virtio'/><address type='virtio-mmio'/></disk>
    <disk type='file' device='disk'><driver name='qemu' type='raw'/><source file='/var/tmp/t20-v01-pool/t20-v01-microvm-seed.img'/><target dev='vdb' bus='virtio'/><address type='virtio-mmio'/></disk>
    <interface type='network'><source network='default'/><model type='virtio'/><address type='virtio-mmio'/></interface>
    <serial type='pty'><target type='isa-serial' port='0'/></serial>
    <console type='pty'><target type='serial' port='0'/></console>
  </devices>
</domain>
```

At `2026-07-26T15:49:29Z`, `virsh -c qemu:///system define ...` and `virsh -c qemu:///system start t20-v01-microvm` both exited 0. Relevant live XML at `15:49:49Z` was:

```text
domain_type=kvm
machine=microvm
emulator=/usr/bin/qemu-system-x86_64
disk=disk/vda/virtio/address=virtio-mmio
disk=disk/vdb/virtio/address=virtio-mmio
interface=network/default/virtio/mac=[omitted]/address=virtio-mmio
graphics_count=0
video=none
consoles=pty/serial
controllers=usb/none
balloon=none
```

An equivalent guest probe body ran at `2026-07-26T15:50:04Z` against the observed address `t20eval@192.168.122.190`; it omitted Q35's non-gating informational boot-ID print and changed the marker prefix:

```text
status: done
virt=kvm
kernel=6.8.0-136-generic
root_source=/dev/vda1
root_fstype=ext4
home_writable=yes
systemd_user_transient=pass
default_gateway=192.168.122.1 ping=pass
serial_getty=active
T20-MICROVM-PERSIST-1785081005
[exit 0]
```

At `2026-07-26T15:50:10Z`, the same bounded `virsh console` command attached successfully; exit 124 was the expected five-second observation timeout.

Cold lifecycle at `2026-07-26T15:50:35Z–15:50:47Z`:

```text
virsh shutdown: exit 0
stopped=true state=shut off attempts=2
virsh start: exit 0
post-start SSH reachable=true attempts=3
persisted marker=T20-MICROVM-PERSIST-1785081005
post_start_systemd_user=pass
[combined exit 0]
```

## Cleanup and safety result

The operator-managed resources created were `t20-v01-q35`, `t20-v01-microvm`, `t20-v01-pool`, `/var/tmp/t20-v01-work`, and `/var/tmp/t20-v01-pool`; libvirt generated only their transient child state (domain interfaces, Q35 NVRAM, and dynamic DHCP leases). Neither domain was marked for autostart. No hardware was rebound; no host service, firewall, existing domain or pool, existing network configuration/state, or STT Worker VM was changed; the host was not rebooted.

Cleanup ran at `2026-07-26T15:51:20Z–15:51:25Z`:

```text
virsh shutdown t20-v01-q35: exit 0; shut off on poll 2
virsh shutdown t20-v01-microvm: exit 0; shut off on poll 2
virsh undefine t20-v01-q35 --nvram: exit 0
virsh undefine t20-v01-microvm: exit 0
virsh pool-destroy t20-v01-pool: exit 0
virsh pool-undefine t20-v01-pool: exit 0
rm -rf -- /var/tmp/t20-v01-work /var/tmp/t20-v01-pool: exit 0
dominfo t20-v01-q35: exit 1 (expected absent)
dominfo t20-v01-microvm: exit 1 (expected absent)
pool-info t20-v01-pool: exit 1 (expected absent)
both path-absence tests: exit 0
cleanup_failed=0
```

**Owned live resources remaining: none.** A read-only check at `2026-07-26T15:55:28Z` showed that the unchanged `default` network still retained its ordinary time-bounded DHCP lease records for the now-absent `t20-v01-q35` and `t20-v01-microvm` clients. These are passive network records, not live domains/interfaces or reusable owned resources; they were left for normal expiry rather than editing or restarting the existing network.

## V01 self-audit

- [x] Q35, `microvm`, and Cloud Hypervisor are each dispositioned.
- [x] Every candidate records native manageability, KVM status, guest boot, persistent block, libvirt network, headless console, graceful lifecycle, limitations, and rejection reason where rejected; unavailable Cloud Hypervisor fields are explicitly not testable.
- [x] Cloud Hypervisor's pre-boot exclusion includes the exact local capability command, output, and status.
- [x] URI/driver, hypervisor, requested and observed machine, emulator, alias policy, image source/checksum, rationale, and all V02/V03 field names are recorded.
- [x] Unknown guest/TCP-peer values are `TBD before V02`, not invented.
- [x] Operational maturity and compatibility are applied as the approved tie-break.
- [x] Disposable resources were prefixed `t20-`, did not reuse an existing name/path, had autostart disabled, and were removed.
- [x] Final owner approval of the QEMU/KVM Q35 recommendation is recorded from the canonical source above.

## V02 Q35 implementation and verifier evidence

The canonical Run had already accepted baseline-red evidence that `t20-v02-q35` was absent at `2026-07-26T17:02:44Z`. A fresh read-only preflight at `2026-07-26T17:23:04Z` reconfirmed that exact domain and `t20-v02-pool` were absent (`virsh dominfo` and `pool-info` each exited 1), the three planned paths were absent, and `ss -H -ltnp 'sport = :18767'` returned no socket. No unrelated domain, network, pool, file, service, firewall rule, or STT Worker VM was modified.

### Guest creation

The operator was `avirus`; non-interactive system-libvirt access required no `sudo`. With `umask 077`, the following native V01-style flow ran from `2026-07-26T17:23:24Z` through `17:23:58Z`. The grouped shell exited 0; `set -eu` made every displayed creation step gating.

```console
$ mkdir -p /home/avirus/.local/state/t20-v02-q35 /var/tmp/t20-v02-work /var/tmp/t20-v02-pool
$ chmod 700 /home/avirus/.local/state/t20-v02-q35 /var/tmp/t20-v02-work
$ chmod 755 /var/tmp/t20-v02-pool
$ ssh-keygen -q -t ed25519 -N '' -C t20-v02-q35 -f /home/avirus/.local/state/t20-v02-q35/id_ed25519
$ chmod 600 /home/avirus/.local/state/t20-v02-q35/id_ed25519
[private key contents omitted; each command exited 0]

$ curl -fL --retry 3 https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img -o /var/tmp/t20-v02-work/noble-server-cloudimg-amd64.img
$ printf '%s  %s\n' d1940f7d69d343355e183dff1e08a59852d32e7309baa7a4bad8365b11b005ac /var/tmp/t20-v02-work/noble-server-cloudimg-amd64.img | sha256sum --check
/var/tmp/t20-v02-work/noble-server-cloudimg-amd64.img: OK
$ qemu-img convert -p -O qcow2 /var/tmp/t20-v02-work/noble-server-cloudimg-amd64.img /var/tmp/t20-v02-pool/t20-v02-q35.qcow2
$ qemu-img resize /var/tmp/t20-v02-pool/t20-v02-q35.qcow2 8G
Image resized.
[each command exited 0]
```

`cloud-localds` created `/var/tmp/t20-v02-pool/t20-v02-q35-seed.img` from operator-owned metadata and cloud-config for locked-password user `t20eval`, inserting only the generated public key (omitted here), disabling SSH passwords/root, and enabling root growth. The source download was then removed. Pool setup and creation were:

```console
$ virsh -c qemu:///system pool-define-as t20-v02-pool dir --target /var/tmp/t20-v02-pool
$ virsh -c qemu:///system pool-start t20-v02-pool
$ virsh -c qemu:///system pool-refresh t20-v02-pool
[each command exited 0]

$ virt-install --connect qemu:///system --name t20-v02-q35 --memory 2048 --vcpus 2 --cpu host-passthrough --machine q35 --boot uefi --osinfo ubuntu24.04 --import --disk path=/var/tmp/t20-v02-pool/t20-v02-q35.qcow2,format=qcow2,bus=virtio --disk path=/var/tmp/t20-v02-pool/t20-v02-q35-seed.img,format=raw,bus=virtio --network network=default,model=virtio --graphics none --console pty,target.type=serial --noautoconsole
Domain creation completed.
[exit 0 at 2026-07-26T17:23:58Z]
```

The resulting domain was running and persistent with autostart disabled. The pool was active and persistent with autostart `no`. Its first DHCP lease was `192.168.122.164`; SSH and `cloud-init status --wait` passed on the first poll at `2026-07-26T17:24:14Z`.

### Approved temporary listener and complete verifier

No Tailscale or firewall command was run. The approved peer was bound only to the existing libvirt bridge address. After correcting a non-listening Python quoting error (exit 1, owned PID/log files removed, no socket created), this exact stdlib listener started:

```sh
nohup python3 -c 'import socket; s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1); s.bind(("192.168.122.1",18767)); s.listen(1); s.settimeout(180); c,a=s.accept(); data=c.recv(64); print("peer=%s token=%s" % (a[0],data.decode("ascii","replace").strip()),flush=True); c.sendall(b"T20-V02-ACK\n"); c.close(); s.close()' </dev/null >/var/tmp/t20-v02-work/listener.log 2>&1 &
echo $! >/var/tmp/t20-v02-work/listener.pid
```

At `2026-07-26T17:24:51Z`, PID `2697195` was owned by `avirus`, and `ss` showed only `192.168.122.1:18767`, process `python3`, PID `2697195`, as the matching listener. The listener accepted one connection and then closed itself, with a 180-second accept timeout as its outer bound.

The host's `virsh dumpxml` defaults to live XML for a running domain and does not support `--live`. One preliminary invocation with that unsupported option stopped before guest checks and exited 1 at `17:25:19Z`; it changed no state. The corrected complete verifier below ran at `2026-07-26T17:25:37Z–17:25:38Z` and exited 0:

```sh
T20_URI='qemu:///system'
T20_DOMAIN='t20-v02-q35'
T20_GUEST='t20eval@192.168.122.164'
T20_EXPECTED_DOMAIN_TYPE='kvm'
T20_EXPECTED_MACHINE='pc-q35-noble'
T20_EXPECTED_EMULATOR='/usr/bin/qemu-system-x86_64'
T20_PEER_HOST='192.168.122.1'
T20_PEER_PORT='18767'
T20_KEY='/home/avirus/.local/state/t20-v02-q35/id_ed25519'
T20_KNOWN_HOSTS='/home/avirus/.local/state/t20-v02-q35/known_hosts'

state=$(virsh -c "$T20_URI" domstate "$T20_DOMAIN")
test "$state" = running
virsh -c "$T20_URI" dumpxml "$T20_DOMAIN" >/var/tmp/t20-v02-work/live.xml
python3 -c 'import sys,xml.etree.ElementTree as E; r=E.parse(sys.argv[1]).getroot(); got=(r.get("type"),r.find("./os/type").get("machine"),r.findtext("./devices/emulator")); exp=tuple(sys.argv[2:]); print("domain_type=%s\nmachine=%s\nemulator=%s" % got); raise SystemExit(0 if got == exp else 1)' /var/tmp/t20-v02-work/live.xml "$T20_EXPECTED_DOMAIN_TYPE" "$T20_EXPECTED_MACHINE" "$T20_EXPECTED_EMULATOR"
timeout 60 ssh -i "$T20_KEY" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$T20_KNOWN_HOSTS" "$T20_GUEST" "T20_PEER_HOST=$T20_PEER_HOST T20_PEER_PORT=$T20_PEER_PORT bash -s" <<'GUEST'
set -eu
cloud-init status --wait
virt=$(systemd-detect-virt)
test "$virt" = kvm
printf 'guest_virtualization=%s\n' "$virt"
systemd-run --user --wait --collect --quiet /usr/bin/true
printf 'systemd_user_transient=pass\n'
test -n "$HOME" && test -d "$HOME" && test -w "$HOME"
printf 'guest_home=%s writable=yes\n' "$HOME"
exec 3<>"/dev/tcp/$T20_PEER_HOST/$T20_PEER_PORT"
printf 'T20-V02-PROBE\n' >&3
IFS= read -r ack <&3
test "$ack" = T20-V02-ACK
exec 3<&-; exec 3>&-
printf 'tcp_peer=%s:%s connected=yes ack=%s\n' "$T20_PEER_HOST" "$T20_PEER_PORT" "$ack"
GUEST
```

Relevant unredacted output contained no secrets:

```text
domain_state=running
domain_type=kvm
machine=pc-q35-noble
emulator=/usr/bin/qemu-system-x86_64
status: done
guest_virtualization=kvm
systemd_user_transient=pass
guest_home=/home/t20eval writable=yes
tcp_peer=192.168.122.1:18767 connected=yes ack=T20-V02-ACK
V02_VERIFIER=PASS
[exit 0]
```

The listener log independently recorded `peer=192.168.122.164 token=T20-V02-PROBE`.

### Listener cleanup and V03-owned residual resources

At `2026-07-26T17:26:05Z`, `kill -0 2697195` failed because the one-shot listener had already exited. `ss -H -ltnp 'sport = :18767'` returned no socket. The owned listener PID/log, XML snapshot, cloud-init source, and `/var/tmp/t20-v02-work` were removed. A second socket-absence check at `17:26:33Z` passed. No listener, PID file, or temporary work directory remains.

The following resources are intentionally retained exclusively for immediate V03:

- running persistent domain `t20-v02-q35` through `qemu:///system`, autostart `disable`;
- active persistent directory pool `t20-v02-pool`, autostart `no`;
- `/var/tmp/t20-v02-pool/t20-v02-q35.qcow2` (owner `libvirt-qemu:kvm`, mode 644) and attached seed `/var/tmp/t20-v02-pool/t20-v02-q35-seed.img` (same owner/mode);
- libvirt-managed UEFI NVRAM `/var/lib/libvirt/qemu/nvram/t20-v02-q35_VARS.fd` (owner `libvirt-qemu:kvm`, mode 600);
- SSH state directory `/home/avirus/.local/state/t20-v02-q35` (owner `avirus:avirus`, mode 700), containing private key `id_ed25519` (mode 600), its public key, and `known_hosts`. The exact private-key path is `/home/avirus/.local/state/t20-v02-q35/id_ed25519`; its contents were never printed or committed.

V03 owns final teardown: gracefully stop `t20-v02-q35`, undefine it with its NVRAM, destroy/undefine `t20-v02-pool`, and remove `/var/tmp/t20-v02-pool` plus `/home/avirus/.local/state/t20-v02-q35`. Any ordinary dynamic DHCP record should be left for normal expiry rather than changing the shared `default` network. V02 did not execute V03 lifecycle checks or teardown. Unrelated host state, including the existing network, firewall, Tailscale state, services, other domains/pools/files, and the STT Worker VM, was left untouched.

## V03 cold-lifecycle and persistence verifier evidence

The canonical Run's immutable pre-V02 absence evidence remains the accepted V03 baseline-red proof. V03 did not inspect or edit the vault or touch its foreign-owned shared lock. The artifact entered V03 at commit `7422e330c6ef0b4a5c8c2c7abcad7a0faf85dd63`, tree `b12ceb6ff1f2010b8b8935d44c37d73cbe06fb93`, and SHA-256 `e61584126a6e50765e57ff2629a6a932525b7434305e06454b085bbc5e1e822b`, with a clean worktree.

### Ownership and address preflight

The exact outer invocation for each host-side block in this section was `ssh -o BatchMode=yes homelab 'bash -s'`; no `sudo` was used. The preflight block used `set -eu` and ran at `2026-07-26T17:39:09Z`. Its gating reads were:

```sh
T20_URI='qemu:///system'
T20_DOMAIN='t20-v02-q35'
T20_POOL='t20-v02-pool'
T20_KEY='/home/avirus/.local/state/t20-v02-q35/id_ed25519'
id -un
virsh -c "$T20_URI" uri
virsh -c "$T20_URI" dominfo "$T20_DOMAIN"
virsh -c "$T20_URI" pool-info "$T20_POOL"
virsh -c "$T20_URI" domblklist "$T20_DOMAIN" --details
virsh -c "$T20_URI" pool-dumpxml "$T20_POOL"
virsh -c "$T20_URI" dumpxml "$T20_DOMAIN"
stat -c 'path=%n owner=%U:%G mode=%a type=%F' \
  /var/tmp/t20-v02-pool \
  /var/tmp/t20-v02-pool/t20-v02-q35.qcow2 \
  /var/tmp/t20-v02-pool/t20-v02-q35-seed.img \
  /var/lib/libvirt/qemu/nvram/t20-v02-q35_VARS.fd \
  /home/avirus/.local/state/t20-v02-q35 \
  "$T20_KEY" \
  /home/avirus/.local/state/t20-v02-q35/id_ed25519.pub \
  /home/avirus/.local/state/t20-v02-q35/known_hosts
T20_IP=$(virsh -c "$T20_URI" domifaddr "$T20_DOMAIN" --source lease | awk '$3 == "ipv4" {sub(/\/.*/, "", $4); print $4; exit}')
test -n "$T20_IP"
test "$(stat -c %a "$T20_KEY")" = 600
test "$(stat -c %U:%G "$T20_KEY")" = avirus:avirus
test "$(virsh -c "$T20_URI" domstate "$T20_DOMAIN")" = running
test "$(virsh -c "$T20_URI" dominfo "$T20_DOMAIN" | awk -F: '/^Autostart:/ {gsub(/[ \t]/, "", $2); print $2}')" = disable
test "$(virsh -c "$T20_URI" pool-info "$T20_POOL" | awk -F: '/^State:/ {gsub(/[ \t]/, "", $2); print $2}')" = running
test "$(virsh -c "$T20_URI" pool-info "$T20_POOL" | awk -F: '/^Autostart:/ {gsub(/[ \t]/, "", $2); print $2}')" = no
if ss -H -ltn 'sport = :18767' | grep -q .; then exit 1; fi
```

Selected output is redacted only by omitting UUIDs, MAC addresses, XML not needed by the checks, and all key contents (which were not read):

```text
operator=avirus
uri=qemu:///system
domain_name=t20-v02-q35
domain_state=running
domain_persistent=yes
domain_autostart=disable
pool_name=t20-v02-pool
pool_state=running
pool_persistent=yes
pool_autostart=no
domain_block_devices:
 file   disk     vda      /var/tmp/t20-v02-pool/t20-v02-q35.qcow2
 file   disk     vdb      /var/tmp/t20-v02-pool/t20-v02-q35-seed.img
pool_target=/var/tmp/t20-v02-pool
domain_nvram=/var/lib/libvirt/qemu/nvram/t20-v02-q35_VARS.fd
path=/var/tmp/t20-v02-pool owner=avirus:avirus mode=755 type=directory
path=/var/tmp/t20-v02-pool/t20-v02-q35.qcow2 owner=libvirt-qemu:kvm mode=644 type=regular file
path=/var/tmp/t20-v02-pool/t20-v02-q35-seed.img owner=libvirt-qemu:kvm mode=644 type=regular file
path=/var/lib/libvirt/qemu/nvram/t20-v02-q35_VARS.fd owner=libvirt-qemu:kvm mode=600 type=regular file
path=/home/avirus/.local/state/t20-v02-q35 owner=avirus:avirus mode=700 type=directory
path=/home/avirus/.local/state/t20-v02-q35/id_ed25519 owner=avirus:avirus mode=600 type=regular file
path=/home/avirus/.local/state/t20-v02-q35/id_ed25519.pub owner=avirus:avirus mode=644 type=regular file
path=/home/avirus/.local/state/t20-v02-q35/known_hosts owner=avirus:avirus mode=644 type=regular file
guest_address=192.168.122.164
listener_18767=absent
preflight=PASS
local_ssh_wrapper_exit=0
```

This matched the V02 handoff exactly, so no ownership conflict was present and V03 continued.

### Complete cold-lifecycle verifier

Two preliminary invocations are recorded for completeness. At `2026-07-26T17:39:54Z`, `timeout 60 ssh_guest ...` attempted to pass a shell function to `timeout`; `timeout` returned 127 (`failed to run command 'ssh_guest': No such file or directory`) before any guest command or state change. At `17:40:32Z–17:40:35Z`, the corrected invocation created and synced marker `T20-V03-PERSIST-20260726T174032Z-2828916`, gracefully reached `shut off` on poll 2, and started the domain, but its SSH polling helper lacked `ssh -n` and consumed the remaining parent standard input. The host wrapper exited 0 without recording the required post-start assertions; that incomplete result was not accepted. It left the guest running and the marker in place. The complete invocation below replaced that marker with a new unique value and removed the marker path after all assertions passed.

The accepted verifier ran under `set -eu`. These are its exact lifecycle commands (the address was freshly obtained from `virsh domifaddr --source lease` immediately before the shown block):

```sh
T20_URI='qemu:///system'
T20_DOMAIN='t20-v02-q35'
T20_POOL='t20-v02-pool'
T20_IP=$(virsh -c "$T20_URI" domifaddr "$T20_DOMAIN" --source lease | awk '$3 == "ipv4" {sub(/\/.*/, "", $4); print $4; exit}')
test -n "$T20_IP"
T20_GUEST="t20eval@$T20_IP"
T20_KEY='/home/avirus/.local/state/t20-v02-q35/id_ed25519'
T20_KNOWN_HOSTS='/home/avirus/.local/state/t20-v02-q35/known_hosts'
T20_MARKER="T20-V03-PERSIST-$(date -u +%Y%m%dT%H%M%SZ)-$$"
ssh_guest() {
  ssh -n -i "$T20_KEY" -o BatchMode=yes -o IdentitiesOnly=yes \
    -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$T20_KNOWN_HOSTS" \
    -o ConnectTimeout=2 "$T20_GUEST" "$@"
}

timeout 60 ssh -i "$T20_KEY" -o BatchMode=yes -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$T20_KNOWN_HOSTS" \
  -o ConnectTimeout=2 "$T20_GUEST" "bash -s -- '$T20_MARKER'" <<'GUEST_CREATE'
set -eu
expected=$1
marker_path="$HOME/.t20-v03-persistence"
printf '%s\n' "$expected" >"$marker_path"
sync
actual=$(cat "$marker_path")
test "$actual" = "$expected"
printf 'marker_created=%s\n' "$actual"
printf 'marker_sync=pass\n'
GUEST_CREATE

virsh -c "$T20_URI" shutdown "$T20_DOMAIN"
stop_attempts=0
stop_state=''
while [ "$stop_attempts" -lt 60 ]; do
  stop_attempts=$((stop_attempts + 1))
  stop_state=$(virsh -c "$T20_URI" domstate "$T20_DOMAIN")
  if [ "$stop_state" = 'shut off' ]; then break; fi
  if [ "$stop_attempts" -lt 60 ]; then sleep 2; fi
done
test "$stop_state" = 'shut off'

virsh -c "$T20_URI" start "$T20_DOMAIN"
ssh_attempts=0
ssh_ready=false
while [ "$ssh_attempts" -lt 60 ]; do
  ssh_attempts=$((ssh_attempts + 1))
  if ssh_guest /usr/bin/true >/dev/null 2>&1; then
    ssh_ready=true
    break
  fi
  if [ "$ssh_attempts" -lt 60 ]; then sleep 3; fi
done
test "$ssh_ready" = true

timeout 60 ssh -i "$T20_KEY" -o BatchMode=yes -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$T20_KNOWN_HOSTS" \
  -o ConnectTimeout=2 "$T20_GUEST" "bash -s -- '$T20_MARKER'" <<'GUEST_VERIFY'
set -eu
expected=$1
marker_path="$HOME/.t20-v03-persistence"
actual=$(cat "$marker_path")
test "$actual" = "$expected"
printf 'persisted_marker=%s exact_match=yes\n' "$actual"
systemd-run --user --wait --collect --quiet /usr/bin/true
printf 'systemd_user_transient=pass\n'
rm -f -- "$marker_path"
test ! -e "$marker_path"
printf 'marker_removed=yes\n'
GUEST_VERIFY

test "$(virsh -c "$T20_URI" domstate "$T20_DOMAIN")" = running
test "$(virsh -c "$T20_URI" dominfo "$T20_DOMAIN" | awk -F: '/^Autostart:/ {gsub(/[ \t]/, "", $2); print $2}')" = disable
test "$(virsh -c "$T20_URI" pool-info "$T20_POOL" | awk -F: '/^State:/ {gsub(/[ \t]/, "", $2); print $2}')" = running
test "$(virsh -c "$T20_URI" pool-info "$T20_POOL" | awk -F: '/^Autostart:/ {gsub(/[ \t]/, "", $2); print $2}')" = no
test "$(stat -c %a "$T20_KEY")" = 600
test -f /var/tmp/t20-v02-pool/t20-v02-q35.qcow2
test -f /var/tmp/t20-v02-pool/t20-v02-q35-seed.img
test -f /var/lib/libvirt/qemu/nvram/t20-v02-q35_VARS.fd
test -f "$T20_KEY"
if ss -H -ltn 'sport = :18767' | grep -q .; then exit 1; fi
```

The complete invocation ran from `2026-07-26T17:41:32Z` through `17:41:46Z`. Relevant output was:

```text
guest_address=192.168.122.164
marker_created=T20-V03-PERSIST-20260726T174132Z-2837397
marker_sync=pass
marker_create_ssh_exit=0
shutdown_request_utc=2026-07-26T17:41:33Z
Domain 't20-v02-q35' is being shutdown
virsh_shutdown_exit=0
shutdown_observed_utc=2026-07-26T17:41:35Z
shutdown_state=shut off poll_attempts=2 max_attempts=60 delay_seconds=2
start_request_utc=2026-07-26T17:41:35Z
Domain 't20-v02-q35' started
virsh_start_exit=0
ssh_ready_utc=2026-07-26T17:41:46Z
batch_ssh_ready=true poll_attempts=3 max_attempts=60 delay_seconds=3
persisted_marker=T20-V03-PERSIST-20260726T174132Z-2837397 exact_match=yes
systemd_user_transient=pass
marker_removed=yes
post_start_guest_check_exit=0
postcheck_utc=2026-07-26T17:41:46Z
domain_state=running
domain_autostart=disable
pool_state=running
pool_autostart=no
listener_18767=absent
retained_disk_seed_nvram_ssh_state=yes
v03_end_utc=2026-07-26T17:41:46Z
V03_VERIFIER=PASS
local_ssh_wrapper_exit=0
```

### Retained state and later cleanup obligation

V03 deliberately performed no final cleanup. At V03 completion, domain `t20-v02-q35` was running and persistent with autostart disabled; pool `t20-v02-pool` was active and persistent with autostart `no`; and the qcow2 disk, seed image, libvirt-managed NVRAM, and complete SSH state remained at the V02 paths and ownership/modes shown above. The V03 marker was removed, and listener port 18767 remained absent. V03 did not run the V02 listener and did not inspect or alter Tailscale, networking, the firewall, unrelated resources, or the STT Worker VM.

A later authorized cleanup still must gracefully stop `t20-v02-q35`, undefine it with its NVRAM, destroy and undefine `t20-v02-pool`, and remove `/var/tmp/t20-v02-pool` and `/home/avirus/.local/state/t20-v02-q35`. Leave any dynamic DHCP record for normal expiry; do not alter the shared `default` network.

## Accepted review hardening and retained-state postcheck

At `2026-07-26T17:59:58Z`, exact ownership validation bound the domain's `vda` and `vdb`, its NVRAM, and the pool target to the retained paths before any mode change. Immediately before hardening at `18:02:05Z`, the exact modes were:

```text
/var/tmp/t20-v02-pool                                  avirus:avirus     755
/var/tmp/t20-v02-pool/t20-v02-q35.qcow2               libvirt-qemu:kvm  644
/var/tmp/t20-v02-pool/t20-v02-q35-seed.img             libvirt-qemu:kvm  644
/var/lib/libvirt/qemu/nvram/t20-v02-q35_VARS.fd         libvirt-qemu:kvm  600
/home/avirus/.local/state/t20-v02-q35/id_ed25519        avirus:avirus     600
```

Because `avirus` owned the directory but not the two libvirt-owned files, a direct non-interactive `sudo -n chmod 0640` made no change and exited 1 (`sudo: a password is required`). The domain was then gracefully stopped (`shut off` on poll 2). With both source inodes held open, only the two validated paths were replaced byte-for-byte under `umask 0027`, grouped to `kvm`, and set to `0640`; the directory was grouped to `kvm` and set to `0750`:

```sh
exec 3<"$QCOW2"; exec 4<"$SEED"
rm -- "$QCOW2" "$SEED"
(umask 0027; cp --sparse=always /proc/self/fd/3 "$QCOW2"; cp --sparse=always /proc/self/fd/4 "$SEED")
exec 3<&-; exec 4<&-
chgrp kvm "$QCOW2" "$SEED"; chmod 0640 "$QCOW2" "$SEED"
chgrp kvm "$POOL_PATH"; chmod 0750 "$POOL_PATH"
```

The before/after SHA-256 values matched exactly: qcow2 `ab6c0e8c43119c17a6c363f697e7f6a32b7a42a418b2fc4d0e4e50a5d7e925ef`; seed `8e177a96172a62148aed2b5a60103193b1f5f9c8f98465815869677c02893205`. Starting the domain restored the two files' libvirt ownership while retaining the hardened modes. The accepted postcheck at `2026-07-26T18:03:04Z` recorded:

```text
/var/tmp/t20-v02-pool                                  avirus:kvm        750
/var/tmp/t20-v02-pool/t20-v02-q35.qcow2               libvirt-qemu:kvm  640
/var/tmp/t20-v02-pool/t20-v02-q35-seed.img             libvirt-qemu:kvm  640
/var/lib/libvirt/qemu/nvram/t20-v02-q35_VARS.fd         libvirt-qemu:kvm  600
/home/avirus/.local/state/t20-v02-q35/id_ed25519        avirus:avirus     600
```

The postcheck re-read dynamic address `192.168.122.164`, used the checked SSH command above successfully (exit 0), and passed with domain `running`/autostart `disable`, pool `running`/autostart `no`, and listener 18767 absent; a final read-only validation at `18:04:50Z` reconfirmed every result. NVRAM and private-key modes were only verified as existing `0600`; they were not changed. All retained resources and the later cleanup obligation remain in place; this hardening is not final cleanup or canonical vault completion.
