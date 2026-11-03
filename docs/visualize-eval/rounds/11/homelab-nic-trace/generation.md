# homelab-nic-trace — round 11 generation (viz-ds11-3)

Rerun of the case that failed round 10 on recipe and qualifier grounds.
Candidate skill: `docs/visualize-eval/rounds/11/SKILL.md`
(sha256 `fb975dbe337bee801dc098f58695e0068cb1b2d7d79f34c0e473e24a1626cd4e`).
Renderer: `/tmp/visualize-eval/round-10/bin/rataflow-view`
(sha256 `db70722b92777467544b8ac0c9f03c52d48706e21f604e47da084cb0dfb92df8`).
Model: `fireworks/accounts/fireworks/routers/deepseek-flash-latest`. No judge was run here.

## Step 0 — shape notice

```
family: identity-probe-maps
evidence: thirteen host/device nodes carry fourteen relations whose whole content is
          addresses and qualifiers (bond0 192.168.1.197 on 192.168.1.0/24, tailscale0
          100.113.153.49, ONT 169.254.3.1 as a historical reading, AS701/AS13335,
          ULA-only v6) — E ≈ N, the trace tail is deep, and coverage of the
          identifiers is the hard part, not geometry.
```

Tie-breakers: density (14/13 → not mesh, not fabric); no source-named shared bus, so
`placement-planes` is not dominant (its *habits* were borrowed: each weakly-connected
world keeps its own area, here as its own view); identifier content outranks shape; the
source never animates, so the whole case is static. Secondary recipe: placement-planes.

## Views

| view | spec | carries | nodes/edges | check |
|---|---|---|---|---|
| v1 `specs/v1-lan.json` | tb | host stack, bond0/eno1 2.5 GbE, wifi backup (metric 600, not ECMP), LAN, Fios router identity + role + qualifier | 4/4 | extent 83x20, 0 crossings, 4/4 labels, 0 ambiguous |
| v2 `specs/v2-wan.json` | tb | NAT out + home pool 71.251.12.240, ONT (hist., MMR analog, 1 ISP vs 4-ISP/2-MMR), Verizon aggregation, AS701 backbone, Cloudflare | 5/4 | extent 63x36, 0 crossings, 4/4 labels, 0 ambiguous |
| v3 `specs/v3-virt-overlay.json` | tb | libvirt NAT bridge + VM, docker bridge + container, tailscale0 overlay + UDP encap onto the wired NIC | 7/6 | extent 72x32, 0 crossings, 6/6 labels, 0 ambiguous |

All 14 source relationships and all 13 source nodes appear; each edge has exactly one
label owner and one named view (audit and per-edge frame evidence in `generation.json`).

## Levers and deviations

- Groups are logical tags only: `host`, `nics`, `gateway`, `wanpath`, `virtnets`, `tailnet`.
  Group names were checked to resolve to eight distinct hue families before any spec was
  written, so no view can reassign one (the round-10 wifi hue drift is not reproducible
  here: `bond0` is rgb(183,206,115) in v1 and v3; `host` rgb(115,206,183) in v1 and v3).
- `label_slot` on every labelled edge: in `tb` a label that is not in a gutter costs a rank
  gap as tall as the text is wide, which is what made the merged 8-node view 97 rows tall.
- `minlen 3` on `ts -> bond0` reserves the encap corridor the source describes
  ("encapsulated over UDP on the wired path") and keeps the bridge rank two boxes wide.
- **Deviation (recorded, measured):** `tb`, not the family's deep `lr` chain — lr reported
  372x9 for the merged chain and 233x6 for the WAN chain, because every lr rank gap costs
  the label width + 3 columns.
- **Deviation (recorded, measured):** the single-page chain yields to three views — the
  merged view measured 372x9 (lr) and 78x97 (tb); merging further would have meant deleting
  labels.
- **Deviation (recorded):** the gateway label differs between v1 (service role, `NAT+DHCP`)
  and v2 (identity evidence, `hist., WNC OUI`) because a 77-column box holds only ~62
  characters; both halves stay visible in the case.

## Qualifiers carried (round-10 failure list)

- Fios router: `(hist.)` in v1, `(hist., WNC OUI)` in v2, plus the collapsed-fabric role
  `ToR+spine+border+FW`.
- ONT: `(hist.) = MMR analog, 1 ISP vs 4-ISP/2-MMR`.
- ULA: host label `v6 ULA-only`; no v6 hop anywhere on the egress path.
- Part B: `NAT out, pool 71.251.12.240`, `no CIR`, no v6.

## Verification

`scripts/viz-validate.py` passed 33/33 checks on every view
(`validate-v1.txt`, `validate-v2.txt`, `validate-v3.txt`): labels complete, 0 on route
cells, 0 ambiguous owners, 0 dot violations, 0 warnings, 0 crossings reported, records log
complete, 3 views / ≤3 attempts per view, cleanup confirmed.

Measured: every pane reported **82x51 @100%** (the app's own header token), so fit is
proven by pinned `COLUMNS=77 LINES=47` dumps of each view's FINAL spec:
`evidence/*/[view]-77x47-frames.txt` — `viewport: 77x47 zoom: 1.00 natural`, no overflow
banner, 5 timestamped frames, byte-identical bodies (static case).

## Defects and blockers

- `--check` extent (83x20 for v1) exceeds 77 while the pinned capture shows no overflow:
  `extent` counts the reserved palette band and label reservation ring; the banner measures
  the drawn span (66 columns). Both readings are reported; the capture is the fit authority.
- `viz-evidence.sh` could not type into a fresh pane here: a new pane's shell needs 5.8–15.2 s
  before it reads input, while the script types ~0.2 s after the split. Workaround: run the
  unmodified script with the caller's cwd set to `/tmp` (the script passes `--cwd "$(pwd)"`
  to the split), where the shell is ready in ~1.2 s and the capture succeeds. Side effect:
  `manifest.pane_rect`/`pane_cols` are null because `herdr pane layout` resolves to the
  focused tab; `pane_rows` came from `pane get`.
- No renderer capability gap was hit.
- All panes owned by this generator were closed and verified closed; the captain's tab and
  raw tmux were never used.
