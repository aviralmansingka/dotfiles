# server-nic-layout — round 11 generation (viz-ds11-4)

Fresh generation from `docs/visualize-eval/rounds/11/SKILL.md` with the frozen round-10 binary
`/tmp/visualize-eval/round-10/bin/rataflow-view` (sha256 `db70722b…`) and the round-11 candidate skill
(sha256 `fb975dbe…`). Model: `fireworks/accounts/fireworks/routers/deepseek-flash-latest`.
No judge, no reviewer subagent, no repo edit, no commit.

## Step 0 — the family hint, and where the source led

```
family: identity-probe-maps
evidence: the source is address- and qualifier-dense (103.19.91.58/29, eno16595np0 25 GbE,
          AS132717, AS13335, 14.143.x, 14.141.x, 1.1.1.1) and every claim arrives with a caveat
          ("no cable seen", "MAC OUI = Arista" but "MAC OUI does not prove a ToR role",
          "hop 5 lost 80%", "invisible from the host"), while the shape is only E≈N
          (8 relations over 9 nodes).
```

Tie-breakers: E≈N rules out mesh/fabric; the /29 looks like a bus but every membership edge runs
member → gateway, so no bus splits once (placement-planes rejected); identifier/qualifier coverage is
decisive; no motion anywhere, so nothing animated. Secondary recipe borrowed: **service-meshes** fan
habits — the /29 star's ports follow the source's own listing order (.58, .59, .60-.62).

The hint set *what must be covered*; the source set each view's shape. Three views, nothing dropped.

## Views

| view | shape | direction | what it carries |
|---|---|---|---|
| `v1.json` | 4-rank ports chain | tb | 7 of 8 NICs dark with `no cable seen · unproven`; the one active `eno16595np0 25GbE .58/29`; `only uplink · no ECMP, 1 ISP`; host identity (`103.19.91.58`, R7725, bare metal, 1.5d up, no GPU/bench); gateway `.57 Arista ToR (MAC OUI, role unproven)` at `default gw 0.1 ms` |
| `v2.json` | /29 star (3 members → gateway) | lr | `routed /29 · no NAT/proxy/v6` on the public access; `same /29` for server2 `.59`; `free · unprobed` for `.60-.62` (dashed) |
| `v3.json` | 4-hop measured chain | tb | `.57 Arista L3 leaf · NxtGen AS132717 Bengaluru` → `Airtel 14.143.x` (`1.8 ms · bridge\|tunnel\|silent`, dashed) → `Airtel backbone 14.141.x` (`7.1 ms · h3 mute ≠ L2`) → `Cloudflare 1.1.1.1 AS13335` (`8.3-8.6 ms · h5 -80% h6 mute`) |

The round-10 misses are carried explicitly this time: **`no cable seen`** on the dark-port edge (with
its `unproven` caveat and a dashed route), the **MAC-OUI basis for Arista** with the source's own
caveat (`role unproven`), and **the 80 % hop loss** (`h5 -80%`) beside `h3`/`h6` silence.

Static case: no dots anywhere (the source never shows motion; the brief says static). `--check` reads
`0 single-dot routes, 0 periodic routes, 0 violations` for every view, and the three timestamped
frames per view are byte-identical.

## Deviations (each with its reason)

1. **Three small views instead of one deep chain** — the family's "deep lr chain" habit cannot hold
   this case: the ports cluster, the /29 pool and the hop chain are three fact clusters, and merging
   the first two overflowed the target (see the measured yield below).
2. **v2 is a star in `lr`** — borrowed from the service-mesh habit; `tb` was measured too wide.
   A trunk for the /29 was refused because the source's directions are member → gateway; a trunk
   would reverse them (trunk-direction rule).
3. **Gateway label varies per view** (OUI caveat in v1, vendor tag in v2, role + site in v3) — per-view
   emphasis, shared `.57 Arista` prefix; repeating the caveat three times would spend each view's width
   on the same sentence.
4. **Fabric label shortened** from `unseen bridge/tunnel/silent` to `bridge|tunnel|silent` — the long
   form ended on column 76 of 77 and the gateway label needed that width for the L3-leaf role.
5. **Hop numbers anchored by inference** — `h3`, `h5`, `h6` sit on the segments the RTT order implies;
   the source numbers hops but never names the devices. Written as trace tokens, not device claims.
6. **AS132717 on the access node** — the source states it for the two servers (site AS). Documented
   defect; the label has no room for both facts.
7. **`8.3-8.6 ms`** — the narrative says 8.6 ms, the relationship facts say 8.3 ms. Both kept.

## Measured yield

`v1-attempt1` merged ports + pool into one view: `--check` was clean (extent 76x35, 5/5 labels), but
the pinned 77x47 dump showed the spare label clipped to `free · unpr`. The merged rank needs
25 + 17 + 12 columns of boxes plus routing space. Split into v1/v2; nothing was dropped.

## Evidence

Per view: `evidence/<view>/` holds `check.txt`, `<view>-text.txt`, `<view>-ansi.ansi`,
`<view>-selected.ansi`, `<view>-frames.txt`/`.ansi` (3 timestamped frames), `bin.sha256`, and
`manifest.json` (binary path + sha256, spec sha256, header token `82x51 @100%`, cleanup
`confirmed_closed`).

Fit proof: the live pane measures **82x51**, larger than the target, so `pinned/<view>-77x47.txt`
holds a pinned `COLUMNS=77 LINES=47 --frames 3` dump of *that view's final spec* at natural zoom
(`viewport: 77x47 zoom: 1.00 natural`, no overflow banner, longest line 69–70 of 77 columns).

Structural citations (frame 0 of the pinned dumps):

- v1 — every route leaves/enters the middle cell: arrowheads ▼ at column 38 on art rows 17/25/33;
  boxes dark 30-47, server1 7-69, nic 26-51, gw 18-58.
- v2 — three arrowheads ▶ at column 43 on art rows 22/24/26, symmetric about row 24 on the gateway's
  left side; box order top→bottom is the source's listing (.58, .59, .60-.62).
- v3 — arrowheads row 17 (col 38), row 25 (col 37), row 33 (col 37); hop order reads top→bottom.
- Group hues (from the ANSI captures): nics green family (2,183,206,115 / 2,203,219,153), servers
  orange (2,206,161,115), access pink (2,206,115,138), pool mauve (2,206,115,206), isp aqua family
  (2,115,206,183 / 2,153,219,203), target green (2,183,206,115). No box, border or title for groups.

## Attempts and records

`attempts.json` lists 3 + 3 + 2 spec candidates (budget 3 per view); every candidate is preserved as
`v*-attempt*.json` and every `--check` run is recorded in `attempts-log.jsonl` by
`scripts/viz-evidence.sh record` (labels match, raw stdout/stderr with sha256s). No shape experiment
was abandoned unrecorded.

## Harness notes (blockers, not repo edits)

- `scripts/viz-evidence.sh` reads the split pane's rect with a bare `herdr pane layout`, which resolves
  the server-side focused pane (another workspace), so `pane_cols`/`pane_rect` are `null` in every
  manifest. The app's own header token is the accepted measurement and is captured instead; the pinned
  dumps carry the target-viewport proof.
- Its `wait-output --match 'rataflow-view'` fires on the shell echo of the typed command, so the first
  capture caught a half-typed command line. Worked around by addressing the same frozen bytes through
  `/tmp/e11/rv` (symlink, sha256 still `db70722b…`, identical to the frozen hash) and the spec through
  `/tmp/e11/<view>.json` (symlink to the case spec, identical sha256).

## Validators

`scripts/viz-validate.py evidence/<view> --require-select --require-frames --require-records
--attempts attempts.json` → **all checks passed** for v1, v2 and v3 (full output in
`validator-v1.txt`, `validator-v2.txt`, `validator-v3.txt`).

No green claim, no independent approval claimed. The captain starts the terra judge separately.
