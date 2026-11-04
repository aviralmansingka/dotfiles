# GB300 rack software — round 00 generation

**Not approved.** Four fresh focused views, with outstanding semantic and rendering blockers. Independent review belongs to the captain.

## Evidence

All output is under `docs/visualize-eval/rounds/00/gb300-rack-software/`.

| View | Subject | Final extent | Local spec attempts | Check |
|---|---|---:|---:|---|
| `01-oob` | Physical OOB reachability | 67×20 | 2 | exit 0, no warnings |
| `02-control` | RMS controller APIs and switch software | 57×21 | 3 | exit 0, one omitted label |
| `03-inband` | Kubernetes/operator and host telemetry | 53×26 | 2 | exit 0, no warnings |
| `04-hosts` | Compute-host residency | 72×13 | 3 | exit 0, no warnings |

Each directory contains `spec.json`, `visible.txt`, `visible.ansi`, `selected.txt`, `selected.ansi`, `dimensions.txt`, `capture.json`, `check.txt`, `check.stderr.txt`, `check.exit.txt`, and `check.metadata.json`. `generation.json` maps source relations to exact view edges. `execution.json` preserves exact commands, stdout/stderr/exit and UTC timestamps for the final capture pass. `hashes.sha256` hashes saved evidence. Final checks have their own exact argv and timestamps.

**Measured size: 77 columns × 47 rows for every view**, from `stty size` inside each viewer pane. All views used initial natural zoom1; no fit, pan or zoom inputs. A Tab input produced a changed ANSI capture in each view, preserving selected and unselected states. Actual viewer headers were verified before final capture. No animation was required; no flow edges were invented.

All viewers used `/tmp/visualize-eval/round-00/bin/rataflow-view`. Both frozen hashes matched the supplied values:

- Candidate skill: `9c5cea272a88300644cacda52c853c7c9169eeec91f0355d3460ee8741308d92`
- Renderer: `b6e11b05b4fb79ce969dc2646c667572535a949bd1a396fd711e1a5466298c8f`

Viewers opened only in generator tab `w7E:tG`, using `pane split --current --direction right --ratio 0.5 --no-focus`. Every viewer command included self-closing cleanup. All created viewer panes were closed after evidence was saved.

Evidence limitation: exploratory check outputs were overwritten by final checks, and exploratory timestamps were not recorded before the clarification. Those earlier commands remain in the session transcript, not the final execution log. No retrospective timestamps were fabricated. A preliminary capture accidentally matched the shell's command text; it was discarded and replaced after matching the actual `rataflow-view · spec.json ·` header.

## Meaning and residence

These views are a qualified interpretation of historical chat, **not independently verified NVIDIA interface documentation**.

- **Off-rack management:** nv-rms runs on a management node and acts as a client of the physical OOB Ethernet network. “client on” is membership/reachability, not a protocol and not management of the network itself. Kubernetes/GPU Operator belong to the separate in-band orchestration context; the excerpts do not prove a specific physical control-plane host placement.
- **OOB hardware endpoints:** compute-tray BMCs, NVSwitch-tray BMCs and power-shelf controllers have their own management endpoints. The class-level compute BMC box represents all 18 compute-tray BMCs described in line 277, not one particular tray. These controllers have no peer-to-peer links in this model. BMC firmware resides on the hardware controllers.
- **NVSwitch software:** NVOS resides on the switch tray and hosts the NMX-C/T software grouping required by the brief. RMS's NVOS and NMX-C API paths are separate from the switch BMC's hardware power/serial path. The `NMX-C gRPC` edge applies to NMX-C; it does not claim NMX-T implements that interface.
- **In-band compute:** DCGM, dcgm-exporter, driver/CUDA and Fabric Manager reside on the compute host, not the GPU die. GPU Operator deploys DCGM as a Kubernetes DaemonSet. DCGM reads GPU state through NVML/driver locally; the edge is not a network or deployment dependency. The grouped Driver/CUDA box does not mean DCGM reads CUDA itself. Exporter metrics are available to Prometheus on port 9400 over the in-band network [277].
- OOB is a separate physical Ethernet network. It is not DCGM, NVLink, training traffic or storage traffic. There is no OOB-to-DCGM edge. CDU and PDU reachability, mentioned in lines 271/277, is retained here as text only, not drawn in the focused three-branch view.

The off-rack and switch residency contexts are provided here rather than explicit on-pane containers. This limits standalone pane interpretation and is recorded as a known defect.

## Protocol and licensing qualifications

Line 283 claims RMS uses Redfish/HTTPS for compute BMCs and power controllers, NVUE REST plus SSH/SFTP for NVOS, and NMX-C gRPC for switch control. `NVUE SSH/SFTP` is the compact label for that historical interface family; it does not imply all requests use all transports. These interface claims were not externally verified. Earlier prose about RMS directly controlling the NVSwitch BMC is qualified by line 283's later nuance: its switch-software control goes through NVOS/NMX, while the BMC remains an OOB hardware endpoint.

“reaches” adds no protocol to the formerly unlabeled OOB edges. “hosts,” “runs operator,” and “metrics” distinguish residence, orchestration and telemetry instead of inventing a generic manages/deploys chain.

No Mission Control, BCM, UFM, NetQ or NGC image node is included. Line 271 describes nv-rms source as Apache-2.0 and self-buildable, while its prebuilt NGC image is entitlement-gated. No free-image claim is made. Its descriptions of NVOS/NMX/Fabric Manager/driver/firmware as hardware-bundled with no separate line item are historical assertions, **not a new license verification or a claim that hardware costs nothing**.

Abbreviations: OOB = out-of-band; BMC = baseboard management controller; RMS = rack management software; Fabric Mgr = Fabric Manager; Switch BMCs = NVSwitch-tray BMCs; Power shelf = power-shelf controller; DCGM / exporter = DCGM plus dcgm-exporter. NMX-C/T is the source's grouped component label, not proof of identical APIs.

## Blocked requirements and defects

1. **One OOB trunk splitting once is unsupported.** The candidate schema offers independently routed edges, not a shared trunk/junction primitive. View 01 preserves physical reachability only. Apparent intersections are not a substitute for the requested one-split topology.
2. **Historical driver → Fabric Manager dependency is unsupported.** The excerpts do not establish a direction or dependency type. View 04 shows only the supported compute-host residency of both; no manages/deploys edge was fabricated.
3. **View 02 drops `rms → c: Redfish/HTTPS`.** Its check returns zero but warns about one omitted relationship label. The complete edge remains in the spec and coverage map.
4. **Arrowheads are missing in actual captures.** View 01: RMS→OOB, OOB→compute BMCs, OOB→power shelf. View 02: RMS→compute BMCs, RMS→NVOS, RMS→NMX-C/T, NVOS→NMX-C/T. View 03: Kubernetes→GPU Operator, GPU Operator→DCGM, DCGM→driver. View 04: host→DCGM/exporter and host→Fabric Manager.
5. **False branches and crossings remain.** Views 01, 02 and 04 have visually joining or crossing routes. View 03's DCGM→exporter route starts sideways and appears joined to the driver route. The checks do not establish route readability.
6. **Node border colors are not uniform.** The ANSI evidence shows muted gray handle cells within colored node borders, including Kubernetes, GPU Operator and DCGM. Selected-state evidence is saved for separate inspection.
7. No pane showed an overflow badge; labels and boxes fit the measured dimensions, and controls sit below the graphs. This is not a claim that the graphs pass visual review.
8. CDU/PDU physical relations and exporter port 9400 are text-only. Earlier exploratory execution evidence lacks timestamps and retained per-attempt check files. These gaps remain explicit.

## Original evidence pointers

Only the assigned `docs/visualize-eval/cases/gb300-rack-software/source.md` excerpts were read. Original chat pointer:

`/Users/aviral/.pi/agent/sessions/--Users-aviral-.herdr-worktrees-vault-research-grace-blackwell--/2026-10-31T11-22-16-652Z_01a191b2-30cc-7236-b360-f3de1efcfa9a.jsonl`

Relevant original lines: 228 (location request), 266 (free-only/OOB clarification), 271 (physical reachability and historical licensing), 272/277 (DCGM separation and host read/metrics semantics), 278/283 (RMS aggregation and corrected NVOS path), 284 (one-trunk requirement), 291 (overlap complaint). The original graph-write pointer is line 285, call `call_db40c48257f14413bd538516`; its generated layout was not read or copied.
