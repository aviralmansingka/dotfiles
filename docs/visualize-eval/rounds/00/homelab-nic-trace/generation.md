# homelab-nic-trace — round 00 generation

## Output and status

Four focused views preserve all **14 original directed relations**. `generation.json` maps each original relation to its view edge, including the wired-link duplication for context. `full-spec.json` is the unrendered canonical union, not a fifth presentation view.

| View directory | Content | Extent | Measured pane | Spec attempts |
|---|---|---|---|---|
| `01-local/` | VM/libvirt NAT and container/Docker bridge into homelab | 37×19 | 77 columns × 47 rows | 2 |
| `02-uplinks/` | Wired primary and Wi-Fi metric-600 backup | 62×19 | 77 columns × 47 rows | 2 |
| `03-overlay/` | Tailscale attachment and UDP encapsulation over wired uplink | 52×19 | 77 columns × 47 rows | 3 |
| `04-wan/` | Qualified historical Fios/ONT/Verizon/Cloudflare sequence | 20×33 | 77 columns × 47 rows | 2 |

Each directory contains `spec.json`, `visible.txt`, `visible.ansi`, `selected.txt`, `selected.ansi`, `dimensions.txt`, `capture.json`, `check.txt`, `check.stderr`, and `check.exit`. All final view checks exited **0**, with no warnings and empty stderr. The canonical union check exits 0 but warns that 13 nodes exceed the readable budget; its extent is 139×72. It is deliberately not presented as a fit diagram.

**This is not a readability approval.** The captain owns the separate Astra review. No reviewer was spawned here.

## Evidence and reproduction

`execution.json` records exact final replay commands, argv, UTC start/end timestamps, stdout, stderr, and exit status. `capture.json` records each view's pane/tab identity, measured dimensions, and capture timestamps. `generation.json` records per-file SHA256 hashes and both verified frozen-input hashes:

- Candidate skill: `9c5cea272a88300644cacda52c853c7c9169eeec91f0355d3460ee8741308d92`
- Renderer: `b6e11b05b4fb79ce969dc2646c667572535a949bd1a396fd711e1a5466298c8f`

Every check and viewer invocation used `/tmp/visualize-eval/round-00/bin/rataflow-view`. No renderer build or installation occurred. Each viewer opened with `herdr pane split --current --direction right --ratio 0.5 --cwd <worktree> --no-focus` in generator tab `w7E:tB`, never the captain tab. The exact self-closing viewer commands are logged. They record `stty size` inside the viewer pane before launching the binary. The header was checked before ANSI capture. Only the created viewers were closed, by sending `q` and allowing their trailing close command to execute.

The final capture pass reopened unchanged specs to record both launch-unselected and Tab-selected states. ANSI changes confirm selection, while text/geometry stays unchanged. The selected nodes are homelab in the local view, bond0 in the uplink and overlay views, and Cloudflare in the WAN view. There was no pan, scroll, fit, or manual zoom. All captures use natural zoom 1. This historical-topology case does not require animation; flow dots were not invented.

The final evidence replay is fully timestamped. Initial exploratory checks and captures preceded the clarification and do not have a complete timestamped command log; final files were replaced by the complete logged replay. Spec-attempt totals include that exploratory work, not just the replay. The first WAN attempt used `lr` (97×5), then changed to `tb` to fit; the five-layer orientation guidance was intentionally overridden because the measured `tb` result fits without shrinking text. The first uplink attempt dropped two labels; reserved spacing fixed that warning. Overlay attempt three improved routing but did not remove all visual defects.

## Meaning and qualifications

Arrows show recorded egress or attachment direction, not a claim that the links cannot carry return traffic.

- `01-local`: the VM reaches libvirt's NAT bridge on 192.168.122.x, then homelab. The container reaches the Docker bridge on 172.18.2.x, then homelab. These are separate virtual networks.
- `02-uplinks`: homelab's primary path is `eno1 2.5 GbE` through bond0 (192.168.1.197) to the default gateway. Wi-Fi `wlp8s0 .213` means 192.168.1.213 on the same 192.168.1.0/24 LAN. `def gw` means default gateway. Wi-Fi metric 600 is backup/failover, **not ECMP**.
- `03-overlay`: tailscale0 (100.113.153.49) attaches to the host and encapsulates over UDP through bond0. This is an overlay, not a separate physical WAN.
- `04-wan`: `Fios?` means historically inferred Verizon Fios router identity from WNC OUI, not verified equipment identity. `ONT?` means the historical ONT/Verizon-edge interpretation of 169.254.3.1, not a verified physical ONT. `VZ` means Verizon; `CF` means Cloudflare (AS13335). The intermediate 100.41.x node is the reported aggregation/edge observation. WAN arrows preserve the reported hop order and timing labels. **Traceroute does not establish physical adjacency or per-link latency.**

Historical context retained in this report rather than fabricated as extra edges: homelab is ASUS bare metal running Linux 7.0, holding `~/rack-bench` with Oct 11 runs—not the devbox. The router was reported to provide NAT and DHCP, with household public pool IP 71.251.12.240. The host had only IPv6 ULA prefixes and no global IPv6 internet connectivity. `bench internet` therefore measures the Fios NAT egress path, with no committed rate and no v6, rather than a datacenter fabric. In the original analogy, the home router collapses ToR, spine, border, and firewall roles; the claimed ONT is the demarc/MMR analog. There is one ISP and one path, not the separate four-ISP/two-MMR design.

All these are historical observations. No SSH, probes, credentials, or remote commands were used.

## Known defects and unaddressed requirements

- **Local:** `vm → virbr`, `ctr → dkbr`, and `virbr → box` lack visible target arrowheads. Only `dkbr → box` has a clear downward arrow.
- **Uplinks:** all four relationships lack visible target arrowheads.
- **Overlay:** `ts → box` and `ts → bond0` lack visible target arrowheads. `box → bond0` starts sideways below the host box. It crosses the UDP encapsulation route near the target with a junction-like glyph, risking a false branch.
- **WAN:** all four relationships lack visible target arrowheads. Labels `4.5 ms` and `6.6 ms` interrupt source stems below the historical ONT and aggregation nodes.
- **Color:** ANSI evidence shows muted edge-colored cells embedded in node top/bottom borders, including after selection changes the rest of the border to the accent color. This violates the candidate's uniform border/handle-color rule; independent review must assess every affected cell.
- No final view shows clipping or a graph-overflow badge. Controls occupy the empty lower-left region, clear of graph content. Clean checks do **not** resolve the arrow, crossing, source-stem, or border-color defects above.
- No required graph primitive was absent. Independent visual approval remains pending. The initial exploratory timestamp gap is disclosed above; the final reproduction evidence is complete.

## Source pointers used

Only the provided `docs/visualize-eval/cases/homelab-nic-trace/source.md` excerpts were read. It points to:

`/Users/aviral/.pi/agent/sessions/--Users-aviral-.herdr-worktrees-rack-bench-feat-network-diagram--/2026-10-13T05-14-42-097Z_01a133af-3231-71ff-87c1-c56889a12a6c.jsonl`

References: user line 48 (rack-bench host, not devbox), assistant line 68 (historical live visualization), and original graph write line 62, call `chatcmpl-tool-b004896d418e23a3` (source pointer only). The relationship/probe summaries and fixed qualifications in `source.md` supply the actual facts. The original chat file, prior layouts, other cases, expected data, and critics were not read.
