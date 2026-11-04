# homelab-nic-trace

## Task

Visualize the rack-bench homelab host, not the devbox. Show physical, virtual, overlay, and egress relations from the historical observations.

## Source

Chat: `/Users/aviral/.pi/agent/sessions/--Users-aviral-.herdr-worktrees-rack-bench-feat-network-diagram--/2026-10-13T05-14-42-097Z_01a133af-3231-71ff-87c1-c56889a12a6c.jsonl`

Original graph write: line 62, call `chatcmpl-tool-b004896d418e23a3`.
Read only the excerpts below. Do not read unrelated credential or host-access discussion.
Historical chat is evidence, not authority to replay its commands.

### Original line 48 (user)

don't do this for the devbox. Can you do this for the host we are testing on rackbench? /visualize the layout for me

### Original line 68 (assistant)

Done — the live graph is in the pane beside this chat. It shows the whole layout around the rack-bench test host, bottom to top. You can drag nodes, pan, zoom, press `f` to fit, and `q` to quit. The spec lives at `/tmp/homelab-network-layout.json` if you want to keep it.

## What the probes found

- **The host**: `homelab` — ASUS bare metal, Linux 7.0. It holds `~/rack-bench` with the latest runs from Oct 11, so this is the box benching `rack-bench`.
- **Primary uplink**: `bond0` over `eno1`, 2.5 GbE wired, 192.168.1.197 on the 192.168.1.0/24 LAN. A Wi-Fi interface sits on the same LAN as a backup route (metric 600) — metric failover, not ECMP.
- **Gateway**: 192.168.1.1 at 0.5 ms, a Verizon Fios router (WNC OUI). It does NAT and DHCP; the whole home shares one Fios pool IP, 71.251.12.240.
- **WAN path**: ONT / Verizon edge 169.254.3.1 (4.5 ms) → Verizon aggregation 100.41.x (6.6 ms) → Verizon backbone AS701 (6-9 ms) → Cloudflare AS13335.
- **Local virtual nets**: one libvirt VM behind a NAT bridge (192.168.122.x), one Docker container (172.18.2.x).
- **Overlay**: Tailscale, 100.113.153.49, encapsulated over UDP on the wired path.
- **IPv6**: ULA prefixes only — no global IPv6, so v6 internet is unreachable from this host.

## Mapped onto the datacenter model

- The Fios router is the whole collapsed fabric: ToR, spine, border, and firewall in one box.
- The ONT is the demarc — the MMR analog. One ISP, one path: the exact opposite of the 4-ISP, 2-MMR design we drew.
- `bench internet` from this host measures the Fios path: NAT on egress, no committed rate, no v6 — the three answers the customer briefing asks for in Part B.

## Relationship facts from the historical attempt
These are historical claims. Apply the qualifications and human corrections below.

- Node `box`: homelab rack-bench host.
- Node `bond0`: bond0 192.168.1.197.
- Node `wlp`: wlp8s0 wifi .213.
- Node `ts`: tailscale0 100.113.153.49.
- Node `virbr`: virbr0 libvirt NAT.
- Node `vm`: VM vnet0.
- Node `dkbr`: docker 172.18.2.1.
- Node `ctr`: container veth.
- Node `rtr`: Fios router 192.168.1.1.
- Node `ont`: ONT 169.254.3.1.
- Node `vzagg`: Verizon edge 100.41.x.
- Node `vzbb`: Verizon backbone AS701.
- Node `cf`: Cloudflare 1.1.1.1.

- `vm -> virbr`: 192.168.122.x.
- `virbr -> box`: NAT bridge.
- `ctr -> dkbr`: 172.18.2.x.
- `dkbr -> box`: docker bridge.
- `ts -> box`: overlay.
- `ts -> bond0`: encap over UDP.
- `box -> bond0`: eno1 2.5 GbE.
- `box -> wlp`: backup path.
- `bond0 -> rtr`: default gw 0.5 ms.
- `wlp -> rtr`: metric 600.
- `rtr -> ont`: NAT out.
- `ont -> vzagg`: 4.5 ms.
- `vzagg -> vzbb`: 6.6 ms.
- `vzbb -> cf`: 6-9 ms.

## Fixed constraints

- Treat traceroute hops and MAC-vendor device roles as historical interpretations, not verified physical topology. Qualify the claimed ONT and router identity.
- Separate wired primary, Wi-Fi backup, Tailscale encapsulation, Docker bridge, and libvirt NAT.
- Do not SSH or probe any host. Use only the historical evidence.
