# gb300-rack-software — React Flow twin (round 07 pilot)

Source: round-05 final specs, `docs/visualize-eval/rounds/05/gb300-rack-software/specs/`.
Hashes re-verified with `shasum -a 256` against `generation.json.views[].spec_sha256`
(the builder refuses to run on a mismatch):

| view | spec | sha256 | nodes | edges |
|---|---|---|---:|---:|
| v1 | `specs/v1-oob-rail.json` | `0239c7b29fa04f96bdc0f8b736d6fe18ce54ec39d272d7fad6f93d47b5d8a801` | 5 | 1 edge + 1 trunk (3 destinations) |
| v2 | `specs/v2-rms-apis.json` | `fa5c790f1c76f9a8dd390ce1ed7482652c0142f3614cc60285952408cabffc42` | 3 | 2 |
| v3 | `specs/v3-nvswitch-sw.json` | `3425e2863c313eb2dc214f9afa424e10dd61bbd71969150846d01d5dc6d67920` | 3 | 3 |
| v4 | `specs/v4-inband-compute.json` | `70cafa96988990a96badf8cecef0d01ad30671db40705df15f4d96b2da20973f` | 6 | 5 |

`reactflow.html` sha256 `7614f6053c9d61c37411dc4ba4635217ec51480a7be2a2fbbed7411542081417`.

## Render

- One 1100x700 canvas per round-05 view, stacked with a caption; `fitView`
  (padding 0.10, maxZoom 1.2).
- Layout: dagre only; direction from the spec (v1 `lr`, v2 `lr`, v3 `tb`, v4 `tb`);
  `ranksep 120`, `nodesep 62`, `edgesep 20`; inner layout `ranksep 58`,
  `nodesep 38`; node box 168x42; subflow padding x14/top24/bottom8; engine
  `@dagrejs/dagre@1.1.5`.
- Subflows: v1 `off-rack mgmt, OOB plant, rack hardware`; v2 `off-rack mgmt,
  rack hardware`; v3 `off-rack mgmt, NVSwitch tray`; v4 `in-band cluster,
  compute host`.
- Trunk handling (v1): the spec's `oob_rail` trunk (`oob → bmc_s`, branches
  `bmc_c`, `pwr`, label `physical reach`) is rendered as three edges out of
  `oob`: the primary `oob → bmc_s` carries the `physical reach` label, the two
  branch edges are unlabelled. React Flow has no trunk/bus primitive.
- Animation: **none** — the source never animated and no spec edge declares
  `flow`/`dots`; measured `0 animateMotion` in every view.
- `style: "dashed"` on v4's `unconfirmed` link is rendered dashed.
- Node colours lifted from the round-05 ANSI captures: off-rack mgmt `#7da0b8`,
  OOB plant `#7daea3`, rack hardware orange family `#e78a4e/#f1a46c/#d27438`,
  NVSwitch tray pink `#d3869b/#e29caf`, compute host teal
  `#7daea3/#93c2b7/#63978d/#a8d3c8`.

## Measured from the page (re-measured after a reload: identical digest `799123879`)

| view | zoom | edges | labels | animated dots | subflow boxes |
|---|---:|---:|---:|---:|---:|
| v1 | 1.2000 | 4 | 2 | 0 | 3 |
| v2 | 1.2000 | 2 | 2 | 0 | 2 |
| v3 | 1.2000 | 3 | 3 | 0 | 2 |
| v4 | 1.1204 | 5 | 5 | 0 | 2 |

(v1 has 4 drawn edges for 1 spec edge + a 3-destination trunk; 2 of them carry a
label — `client` and `physical reach`.)

## Capture

- `capture.png` — full-page capture trimmed to the page box, 2278x6120 px (2x CSS),
  sha256 `e1985ef5eb1bb53651f7fc359a6b281fd4c0395c37e7df209e495ad0a1e59340`.
- `capture-raw.png` — the browser's own full-page output, 4556x12240 px.
- `commands.txt` — the exact commands.

## Divergences vs the round-05 rataflow rendering (observations, not claims)

1. **The trunk lost its single-split shape.** Rataflow v1 draws one bus from
   `OOB LAN` to `NVSwitch BMC` with `Compute BMC` and `Power shelf` branching off
   it (`trunks: oob_rail ... 2 branches, 2 junctions`). React Flow cannot draw a
   trunk, so the three destinations leave `OOB LAN` as three independent edges.
   The two branch edges happen to turn vertically at the same x in the gutter,
   which reads a little like a bus, but there is no junction and no shared run —
   and both branches are unlabelled, so `physical reach` appears to belong to the
   `NVSwitch BMC` edge only.
2. **Subflows are drawn here.** Round 05 v1 grouped by hue only (`off-rack mgmt`
   was a blue node border and a row of text, no box). Here the three blocks are
   visible, which makes the "nv-rms is off the rack" fact readable from the frame
   rather than from the colour.
3. **Direction preserved.** v1 and v2 `lr`, v3 and v4 `tb`, exactly as the specs
   declare; the `off-rack mgmt → OOB plant → rack hardware` chain therefore reads
   left to right in both renderings.
4. **Extent/scale is not comparable.** Rataflow fit `74x24` cells (v1) in a 77x47
   terminal; React Flow fits the same graph in 1100x700 at zoom 1.2, so relative
   box sizes differ even though the topology is identical.
5. **Labels.** v2's two southbound API labels (`Redfish/HTTPS`, `Redfish shelf`)
   sit in the single gutter between the two blocks and read cleanly, matching
   rataflow's `labels: 2/2 placed`. v4's intra-subflow labels (`hosts`,
   `serves :9400`, `reads NVML`) sit at the path midpoint inside the block, where
   rataflow rode them on the route next to their source port; `serves :9400` and
   `reads NVML` nearly touch, which round-05 recorded as `0 ambiguous owners`.
6. **No animation on either side** (0 dots in rataflow's checks, 0 `animateMotion`
   here), so the animated-nothing requirement is satisfied by construction.
