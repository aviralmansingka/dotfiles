# homelab-nic-trace — Step 0 and meaning ledger (written before any spec)

## Step 0 — family

```
family: identity-probe-maps
evidence: 13 of 14 nodes are addresses, device names or AS numbers
(bond0 192.168.1.197, 100.113.153.49, 172.18.2.1, 169.254.3.1, AS701,
100.41.x) and the brief marks two device roles "claimed"/historical, so
omission — not geometry — is what loses meaning.
```

Tie-breakers considered, in the skill's order:

1. **Density (E ≈ N).** 14 edges / 13 nodes, so density is chain-like, not
   mesh/fabric-like. No double-arrowhead target, no redundant parallel lane.
2. **Bus with disconnected worlds?** No. Every node reaches `box` through
   the uplink; there is one weakly-connected world, so `placement-planes`
   does not apply even though `rtr` fans to `ont` and `bond0`/`wlp` both
   land on `rtr`.
3. **Identifier/qualifier content outranks shape.** Decides it: the graph is
   a deep address-labelled chain. `identity-probe-maps`.
4. **Motion is not a signature here.** The source is a historical
   description of a static topology; nothing animates, so the diagram is
   static and carries no dots.

Secondary recipe applied: none of the six is co-dominant. The `rtr` fan
(2 in, 1 out) was checked against `service-meshes` and rejected: there is no
anti-parallel pair between any two boxes, so no mesh port ordering is owed.

## Step 1 — meaning ledger

Every identifier (address, device, AS), and every qualifier the source
states. Fate is decided before drawing.

| # | Fact | Kind | Fate | Where |
|---|---|---|---|---|
| 1 | `homelab` = ASUS bare-metal rack-bench host | identifier/role | drawn | v1 `box` |
| 2 | `bond0` 192.168.1.197, LAN 192.168.1.0/24 | address | drawn | v1 `bond0` label |
| 3 | `wlp8s0` wifi .213 | address | abbreviated to `.213` with the device name on the same label | v1 `wlp` |
| 4 | `tailscale0` 100.113.153.49 | address | drawn | v1 `ts` |
| 5 | `virbr0` libvirt NAT, 192.168.122.x | address | drawn (segment on the edge) | v1 `virbr` + e1 |
| 6 | VM `vnet0` | identifier | drawn | v1 `vm` |
| 7 | docker bridge 172.18.2.1, 172.18.2.x | address | drawn | v1 `dkbr` + e3 |
| 8 | container `veth` | identifier | drawn | v1 `ctr` |
| 9 | Fios router 192.168.1.1, WNC OUI | address + qualifier | drawn, marked `claimed` | v2 `rtr` |
| 10 | ONT / demarc 169.254.3.1 | address + qualifier | drawn, marked `claimed` | v2 `ont` |
| 11 | Verizon edge 100.41.x | address | drawn | v2 `vzagg` |
| 12 | Verizon backbone AS701 | AS number | drawn | v2 `vzbb` |
| 13 | Cloudflare 1.1.1.1, AS13335 | address + AS | drawn | v2 `cf` |
| 14 | `eno1` 2.5 GbE wired primary | link tech | drawn | e7 label `eno1 2.5GbE` |
| 15 | default gw 0.5 ms | metric | drawn | e9 label `gw 0.5 ms` |
| 16 | wifi backup at metric 600, failover and **not** ECMP | qualifier | drawn | e8 `backup path` + e10 `metric 600` |
| 17 | ONT 4.5 ms / agg 6.6 ms / bb 6–9 ms | metric | drawn | e11–e13 labels |
| 18 | Tailscale encapsulation over UDP on the wired path | protocol | drawn | e6 `UDP encap` |
| 19 | router does NAT and DHCP; the home shares one Fios pool IP 71.251.12.240 | role + address | abbreviated: `NAT out` carries NAT egress; the pool IP is dropped (see D1) | e11 |
| 20 | ULA prefixes only — **no global IPv6, v6 internet unreachable** | limitation | drawn | v2 `rtr` qualifier `no v6` |
| 21 | ONT/router identity is a historical interpretation (traceroute hops + MAC-vendor OUI), not verified physical topology | qualifier | drawn | `claimed` on `rtr` and `ont` |
| 22 | Fios router is the whole collapsed fabric (ToR+spine+border+FW) | analogy | dropped — D2 | — |
| 23 | one ISP, one path — the opposite of the 4-ISP/2-MMR design | analogy | dropped — D2 | — |
| 24 | `bench internet` from this host answers Part B (NAT egress, no committed rate, no v6) | consequence | abbreviated: `no v6` on `rtr`; committed-rate claim is not a graph relation | D3 |
| 25 | this box holds `~/rack-bench` and benched rack-bench on Oct 11 | role/residency | abbreviated into label `homelab rack-bench` | v1 `box` |

Deliberate drops, with reasons:

- **D1** Fios pool IP 71.251.12.240 — a *shared home* address, not a relation
  of this host; drawing it would imply this host owns it. `NAT out` already
  carries egress address translation.
- **D2** the datacenter-model comparison (collapsed fabric, MMR analog) —
  the brief's `.` section is commentary mapped onto a *different* diagram;
  it states no relation of this host. Recorded here so it is not lost
  silently.
- **D3** "no committed rate" — a measurement property of a test result, not a
  link or a box; no field carries it without inventing a node.

## Step 2 — relationship audit

| id | from → to | verb / tech | label owner | view |
|---|---|---|---|---|
| e1 | vm → virbr | 192.168.122.x segment | e1 `192.168.122.x` | v1 |
| e2 | virbr → box | NAT bridge | e2 `NAT bridge` | v1 |
| e3 | ctr → dkbr | 172.18.2.x segment | e3 `172.18.2.x` | v1 |
| e4 | dkbr → box | docker bridge | e4 `docker bridge` | v1 |
| e5 | ts → box | overlay | e5 `overlay` | v1 |
| e6 | ts → bond0 | encap over UDP | e6 `UDP encap` | v1 |
| e7 | box → bond0 | eno1 2.5 GbE | e7 `eno1 2.5GbE` | v1 |
| e8 | box → wlp | backup path (metric failover) | e8 `backup path` | v1 |
| e9 | bond0 → rtr | default gw 0.5 ms | e9 `gw 0.5 ms` | v2 |
| e10 | wlp → rtr | metric 600 | e10 `metric 600` | v2 |
| e11 | rtr → ont | NAT out | e11 `NAT out` | v2 |
| e12 | ont → vzagg | 4.5 ms | e12 `4.5 ms` | v2 |
| e13 | vzagg → vzbb | 6.6 ms | e13 `6.6 ms` | v2 |
| e14 | vzbb → cf | 6–9 ms | e14 `6-9 ms` | v2 |

Direction is producer → consumer as the source states it (the VM's traffic
leaves through `virbr` toward the host; the overlay encapsulates toward
`bond0`; egress runs outward to Cloudflare). No relation is bidirectional in
the source, so no anti-parallel pair exists and no relation is reversed.

## Step 3 — groups (source-named tiers)

The task names the tiers: "physical, virtual, overlay, and egress relations".

| group | members | source fact |
|---|---|---|
| `physical` | box, bond0, wlp | ASUS bare metal, `bond0` over `eno1` 2.5 GbE, `wlp8s0` backup |
| `virtual` | vm, virbr, ctr, dkbr | "local virtual nets: one libvirt VM behind a NAT bridge, one Docker container" |
| `overlay` | ts | "Overlay: Tailscale … encapsulated over UDP" |
| `egress` | rtr, ont, vzagg, vzbb, cf | the WAN path and the router that does NAT |

## Step 4 — capability preflight

| Need | Field | Available in frozen binary |
|---|---|---|
| 4 source-named tiers as color + order, nothing drawn | `group` | yes (no box/border/title by design) |
| historical "claimed" role marking | label text (`claimed`), `style: "dashed"` if the link itself were unconfirmed | yes — no dashed edge used, because the *hops* are measured and only the device *role* is inferred, which the node label carries |
| motion | none needed | source is static; `dots` omitted, no `flow` |
| long-label gutter | `label_slot` | available but not needed: every edge label is ≤ 13 characters |
| uncertainty | `style: "dashed"` | available, unused (see above) |

## Step 5 — view split coverage map (written before drawing)

| view | carries | why this cluster |
|---|---|---|
| v1 host | nodes vm, virbr, ctr, dkbr, ts, box, bond0, wlp; edges e1–e8 | the source's "local virtual nets" + "overlay" + the host's own physical ports form one fact cluster (everything inside the box) |
| v2 egress | nodes bond0, wlp, rtr, ont, vzagg, vzbb, cf; edges e9–e14 | the source's "primary uplink / gateway / WAN path" cluster (everything outside the box) |

Join nodes: `bond0` and `wlp` appear in both views (v1 as the host's ports,
v2 as the uplink sources); that is the declared join, so no relation crosses
a view boundary untraceably. Every ledger row above names its view.
