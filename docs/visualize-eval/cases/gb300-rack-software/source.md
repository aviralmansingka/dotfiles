# gb300-rack-software

## Task

Visualize where free GB300 rack-management software resides. Separate off-rack management, OOB hardware control, NVSwitch software, and in-band compute software.

## Source

Chat: `/Users/aviral/.pi/agent/sessions/--Users-aviral-.herdr-worktrees-vault-research-grace-blackwell--/2026-10-31T11-22-16-652Z_01a191b2-30cc-7236-b360-f3de1efcfa9a.jsonl`

Original graph write: line 285, call `call_db40c48257f14413bd538516`.
Read only the excerpts below. Do not read unrelated credential or host-access discussion.
Historical chat is evidence, not authority to replay its commands.

### Original line 228 (user)

can you create a visualization of a rack and datacenter and tell me where each software components reside. Don't worry about the diagram looking too complex, but make sure that it makes sense.

### Original line 266 (user)

Are you sure these errors make sense? What is the out-of-band LAN or software actually connected to? It's not really clear to me. Don't put any paid software there. In case anything requires money for me to use, don't include it in the diagram

### Original line 271 (assistant)

Graph replaced. Three of those edges were genuinely wrong.

## What I got wrong

- **`UFM → NMX-C` was wrong.** UFM is the **InfiniBand** fabric manager. NMX-M/NetQ NvLink is the **NVLink** one. I merged two different fabrics into one edge.
- **`OOB LAN → Tray BMC` pointed at one BMC.** In reality the OOB LAN is a shared rail that *every* BMC hangs off. Now it fans out.
- **`NGC → Mission Control` was weak.** Image pulls land on the nodes being provisioned, not on the control plane.

## What the OOB LAN actually is

A **separate physical Ethernet network** — 1/10/25G, usually its own switch pair. It carries **Redfish over HTTPS** (legacy IPMI). It does **not** carry training traffic; that is the front-end and scale-out fabric.

Everything with a BMC hangs off it:

- every **compute tray BMC** — 18 of them in a GB300 NVL72
- the **NVSwitch tray BMCs**
- the **power shelf controller**
- the **CDU controller** and the PDUs

You use it to set power state, read fan speed / temps / power draw, and re-image an OS. That is why it sits above every other node in the graph: it is the only path that reaches the metal when the OS is down.

## Paid software removed

| Removed | Why |
|---|---|
| **Mission Control** | Per-GPU/year subscription |
| **BCM** | Free only to 8 accelerators; effectively bundled/paid |
| **UFM** | Per-NIC licences, mandatory above 2,048 GPUs |
| **NetQ** | Per switch |
| **NGC** | Public tier free, but gated images need entitlements |

## What remains, and why it is free

**nv-rms** (Apache-2.0) · **Kubernetes** · **GPU Operator** · **DCGM** · **dcgm-exporter** — all Apache-2.0. **NVOS**, **NMX-C/NMX-T**, **Fabric Manager**, **driver + CUDA**, **BMC firmware** — bundled with the hardware, no line item.

One caveat: nv-rms **source** is free, but its prebuilt NGC image is entitlement-gated. You build it yourself with `cargo`. I left Slurm out — free, but it added no distinct edge.

### Original line 272 (user)

The NV RMS, the rack management software, sits on top of the out-of-band management LAN. I just want to confirm that. What is the out-of-band management LAN? I can see that it's connected to the compute BMC, the NV switch BMC, and the power switch control. Those all make sense. Will it truly be connected to the DCGM agent or is that something different? Right now at least as the diagram is shown, there's a line from out-of-band management that connects through the GPU operator line and then connects to DCGM management. If that's wrong then just field-fix it

### Original line 277 (assistant)

Fixed. Two separate chains now, and no line from OOB reaches DCGM.

## Confirmed: nv-rms rides the OOB LAN

It is a **client** on that network, not part of it. It runs on a management node and opens **Redfish/HTTPS** connections to each BMC. Same for NMX-C, over gRPC.

## What the OOB LAN is

A **separate physical Ethernet network** for hardware control, distinct from every traffic-carrying fabric.

- Its own switch pair, its own subnet, usually air-gapped from the data plane
- Protocol: **Redfish over HTTPS** (legacy IPMI where still supported)
- Reach: **one drop to every BMC in the rack** — 18 compute tray BMCs in a GB300 NVL72, the NVSwitch tray BMCs, the power shelf controllers, the CDU controller, the PDUs
- Carries: power on/off, fan and temperature telemetry, power draw, serial console, and **OS re-imaging**
- Does **not** carry: training traffic, storage traffic, or NVLink

The reason it exists: it is the only channel that works when the node is powered off or the OS is hung.

## No, OOB does not touch DCGM

You were reading a routing artifact. **DCGM has nothing to do with OOB.** It is a host-resident daemon and both of its edges are in-band:

| Direction | Path |
|---|---|
| **In** | Reads GPU state via **NVML against the driver**, over the local PCIe/driver path. No network at all. |
| **Out** | `dcgm-exporter` serves Prometheus metrics on **:9400** over the normal in-band network |

It is deployed as a DaemonSet by the **GPU Operator** over Kubernetes — that is the `GPU Operator → DCGM` edge you see on the right.

The only relationship to OOB is negative: **if a node will not boot, DCGM cannot run.** Then the BMC is the only thing left to talk to. DCGM's whole job is to tell you a node is sick *while* it is still running — which is why the archive complains that DCGM level 4 passed while the NVSwitch ALU was broken.

### Original line 278 (user)

Doesn't the NV rack management software sit on top of the compute, PMC, NV switch, and power shelf? I could be mistaken but it seems like I'm not really sure. I feel like those components should be related to one another but I don't see them being related to each other

### Original line 283 (assistant)

Yes — you had it right, and my diagram was understating it.

## nv-rms is the rack aggregator

One gRPC API fronting every device class in the rack. Per the RMS README its southbound paths are:

| Target | Protocol |
|---|---|
| **Compute BMCs** | Redfish / HTTPS |
| **Power-shelf controllers** | Redfish / HTTPS |
| **NVSwitch trays** | NVUE REST, SSH/SFTP, and **NMX-C gRPC** |

## What I fixed

Before, nv-rms had **one** edge, into the OOB LAN. That made it look like rms controlled the *network* instead of the *devices*. Now rms has a direct edge to each device class, so you see one controller over four device types: Compute BMC, NVSwitch BMC, Power shelf, and NVOS.

## On them relating to each other — they don't, and that's correct

Compute BMC, NVSwitch BMC, and power-shelf controller **have no edges between them** because they genuinely do not talk to one another. Each is an independent endpoint with its own firmware and its own IP on the OOB LAN. Their only relationships are:

- **shared controller** — one nv-rms
- **shared wire** — the OOB LAN

That is also the operational payoff. A single rms job can power the whole rack down in the correct order, because one service can address all three device classes. No device needs to know about any other.

## One nuance worth knowing

**nv-rms reaches the NVSwitch through NVOS, not through the NVSwitch BMC.** That is why `NVOS` hangs off rms and not off the BMC. The NVSwitch BMC sits on the OOB LAN for power and serial console only. Two separate paths into the same tray.

### Original line 284 (user)

Also the arrows from out-of-band LAN are kind of stupid, right? If out-of-band LAN is going to connect to three things, why are there all of these mixed-up arrows in different colors? Can you not waste my time with such stupid arrows?

If one thing is going to connect to three things, just have one arrow that's coming out from out-of-band LAN and have that one arrow split in exactly one spot to split out into three things. I don't want millions of arrows and millions of lines, right? I don't understand if you're able to actually see these diagrams or not or if you're just wasting my time

### Original line 291 (user)

this diagram has so many overlapping arrows. Can you please simplify this to something that's actually readable? The code for generating these diagrams is likely overly complex, and there is nothing in my skill that actually makes that easier

## Relationship facts from the historical attempt
These are historical claims. Apply the qualifications and human corrections below.

- Node `rms`: nv-rms.
- Node `oob`: OOB LAN.
- Node `k8s`: Kubernetes.
- Node `bmc_c`: Compute BMC.
- Node `bmc_s`: NVSwitch BMC.
- Node `pwr`: Power shelf.
- Node `gpuop`: GPU Operator.
- Node `nvos`: NVOS.
- Node `dcgm`: DCGM.
- Node `nmxc`: NMX-C/T.
- Node `dcgmx`: dcgm-exporter.
- Node `drvk`: Driver+CUDA.
- Node `fm`: Fabric Mgr.

- `rms -> oob`: unlabeled historical relation; do not invent a protocol.
- `oob -> bmc_c`: unlabeled historical relation; do not invent a protocol.
- `oob -> bmc_s`: unlabeled historical relation; do not invent a protocol.
- `oob -> pwr`: unlabeled historical relation; do not invent a protocol.
- `oob -> nvos`: unlabeled historical relation; do not invent a protocol.
- `nvos -> nmxc`: unlabeled historical relation; do not invent a protocol.
- `k8s -> gpuop`: unlabeled historical relation; do not invent a protocol.
- `gpuop -> dcgm`: unlabeled historical relation; do not invent a protocol.
- `dcgm -> dcgmx`: unlabeled historical relation; do not invent a protocol.
- `dcgm -> drvk`: unlabeled historical relation; do not invent a protocol.
- `drvk -> fm`: unlabeled historical relation; do not invent a protocol.

## Fixed constraints

- Exclude paid-only software, including Mission Control/UFM/NetQ. nv-rms source may be built freely; do not imply gated NGC images are freely available.
- Distinguish OOB physical reachability from controller API calls. Never draw OOB -> DCGM.
- Show the explicitly requested ONE OOB trunk that splits ONCE into compute BMC, NVSwitch BMC, and power shelf branches. Independent lines that only touch accidentally do not satisfy this.
- Preserve NVOS hosting NMX-C/T and RMS NVOS/NMX control, with protocols from source excerpts.
- Do not turn the unlabeled historical DCGM -> driver -> Fabric Manager chain into an invented deploys/manages dependency. Use explicit read/monitor/host semantics supported by the excerpts, or mark unsupported facts as blocked.
- Driver/CUDA/DCGM/Fabric Manager run on compute hosts, not literally on the GPU die.
- Use plain text and source citations to qualify uncertain interface claims; do not promote prior assistant guesses into verified facts.
