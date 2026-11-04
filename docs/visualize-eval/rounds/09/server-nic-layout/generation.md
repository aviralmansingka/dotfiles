# server-nic-layout — round 09 generation report

- generator: `viz-ds09-4` (fresh generator), model `fireworks/accounts/fireworks/routers/deepseek-flash-latest`
- frozen renderer: `/tmp/visualize-eval/round-09/bin/rataflow-view`, sha256 `405a61a674a7cc6271ae1276794eb270c9425dfc38585f4cbb1c48e9b6db495b`
- candidate skill snapshot: `docs/visualize-eval/rounds/09/SKILL.md`, sha256 `ba2878c5194cd6fc4bc1af5299a156064130de9be1b0ccf4c6eeb0236d431381`
- target viewport: 77x47, natural 100% zoom

## Step 0 — family

```
family: identity-probe-maps
evidence: eight relations over nine boxes whose content is identifiers and qualifiers
          (eno16595np0, 25GbE, 103.19.91.58/29, .57/.59/.60-.62, AS132717, AS13335,
          14.143.x/14.141.x, 0.1/1.8/7.1/8.6 ms, "7 ports dark", "free?", "no probe reply"),
          so omission — not geometry — is the failure mode.
```

Tie-breakers checked, in order: density (`E`=8, `N`=9 → chain, no edge surplus); no
anti-parallel pair anywhere (every relation is one-way: uplink, membership, transit hop) so
not a service-mesh despite the ToR fan; the /29 members are not a bus (three independent
membership facts, no source-stated shared corridor) so not placement-planes; the source is a
static traceroute/addressing snapshot with no motion, so not a lifecycle machine and no dots
anywhere. Identifier/qualifier content therefore outranks shape.

**Secondary recipe applied: none.** The ToR does receive a fan of three edges, which is the
mesh signature, but those edges carry independent membership observations with no
request/response pairing, so the mesh recipe does not apply. The egress half is a plain chain.
No reclassification happened after Step 0.

## Views and coverage map

| view | spec | carries | extent |
|---|---|---|---|
| v1 ports + uplink | `specs/v1-a3.json` | r1, r2, r3; `7 dark ports`, `server1 .58 R7725`, `eno16595np0 25GbE`, `.57 Arista (OUI) AS132717`, no-NAT / no-v6 / 0.1 ms | 49x28 |
| v2 egress | `specs/v2-a2.json` | r6, r7, r8; `14.143.x`, `14.141.x`, `1.1.1.1`, `AS13335`, 1.8/7.1/8.6 ms | 41x28 |
| v3 /29 plane | `specs/v3-a3.json` | r4, r5; `103.19.91.59`, `103.19.91.60-.62`, `free?`, `no probe reply` | 60x12 |

All eight audited relations are visible exactly once; nothing was dropped to shrink a view.

## Relationship audit

| id | from → to | label owner | label | style | view |
|---|---|---|---|---|---|
| r1 | dark → s1 | r1 | `no link seen` | dashed (inactive ≠ uncabled) | v1 |
| r2 | s1 → nic | r2 | `only uplink 25GbE` | solid | v1 |
| r3 | nic → gw | r3 | `.58/29 no NAT/v6 0.1ms` | solid | v1 |
| r4 | s2 → gw | r4 | `same /29` | solid | v3 |
| r5 | spare → gw | r5 | `no probe reply` | dashed (unresponsive ≠ free) | v3 |
| r6 | gw → airtel | r6 | `transit 1.8ms` | solid | v2 |
| r7 | airtel → airtelbb | r7 | `7.1 ms` | solid | v2 |
| r8 | airtelbb → cf | r8 | `8.6 ms` | solid | v2 |

## Levers used (structure declared, geometry derived)

- **direction** — all three views are `tb`. v1 has four ranks (dark, server1, NIC, ToR), v2
  four hops, v3 two ranks: the skill spends height at four or fewer layers. A `lr` v1 draft
  needed 69 cells of boxes plus three label rooms and failed routing.
- **groups (logical tags only, nothing drawn around members)** — `server1` / `nxtgen` in v1,
  `nxtgen` / `transit` in v2, `prefix` / `nxtgen` in v3, from the source's own split between
  the box's ports, the routed access layer, the ISP side and the address pool. The `groups:`
  line in each `check.txt` matches, and the ANSI captures carry the distinct hue families.
- **`label_slot`** — the decisive lever. A plain 1-rank label gap costs *label width + 3 rows*;
  v1's three labels (12, 17, 22 cells) would need 15+20+25 rows on top of 16 rows of boxes
  (76 rows against 47), and v2's would need 50. With gutter bands each gap stays 3 rows. In v3
  the gutters also moved both labels from the middle of a 17-row gap onto the first gap row of
  their own runs (`evidence/v3-draft-a1` vs `evidence/v3`).
- **`style: "dashed"`** — on r1 (inactive interface does not prove absence of a cable) and on
  r5 (an unresponsive address does not prove the address is free). The capture shows the
  dashed runs (`v1-text.txt` lines 17–19 `╎ … ╌╌╯`; `v3-text.txt` lines 25–27).
- **`trunks`** — deliberately unused. Trunking the two /29 members would draw one bus that
  splits, implying a shared cable or shared probe path the source never states.
- **`layers` / `minlen`** — unused: the source states no tiers to pin and no corridor that
  needs an empty rank.
- **`dots`** — `0` on every edge: the source shows no motion. The resulting static drawing is
  correct, and frames 0–3 of each `*-frames.txt` are byte-identical.

## Recipe yield (the view split)

The skill prefers one view per fact cluster. Two combined drafts tried to hold the whole case
in two views:

- `specs/v1-a1.json` (tb): `--check` exit 1, `no obstacle-safe route for s2 -> gw` — the gutter
  band for the 22-cell handoff label crosses the two /29 corridors.
- `specs/v1-a2.json` (lr, all gutters): `--check` exit 1, `no obstacle-safe route for spare -> gw`;
  removing the gutters instead costs 15+14+15 label rooms on top of 69 cells of boxes = 109
  columns against 77.

The combined view is structurally impossible in both orientations, so the case ships three
focused views. Raw records for both failures are in `attempts-log.jsonl`.

## Defects / deviations

1. **Pane measured 82x51, not 77x47** — this worker tab's own split geometry. Per the round-09
   pinned ruling, fit is proven by a pinned direct dump of each **final** spec at
   `COLUMNS=77 LINES=47` natural zoom with no overflow banner: `pinned/v1-77x47.txt`,
   `pinned/v2-77x47.txt`, `pinned/v3-77x47.txt`, each opening with
   `viewport: 77x47 zoom: 1.00 natural`. The 82x51 is recorded as measured, never relabelled.
2. **One Z-jog per hop** (renderer port rule: a lone port sits at `x+1`, and adjacent boxes
   differ in width). Visible in `v2-text.txt` lines 17–20. Not fixable by declared structure;
   crossings stay 0.
3. **No single view states `103.19.91.0/29` in full** — v1 carries `.58/29`, v3 carries the
   octets on its member labels (cross-view key, documented in `generation.json`).
4. **Source conflict: Cloudflare hop 8.6 ms (excerpt) vs 8.3 ms (relationship-fact list)** —
   the primary excerpt value is drawn, the conflict recorded.
5. **No `routes:` line** — the round-09 binary does not emit one; not chased.

Blockers: none.

## Evidence and validation

Every probe and rejected draft ran through
`scripts/viz-evidence.sh record --to …/attempts-log.jsonl --label <name> -- "$BIN" --check <spec>`
(8 records). Each final view was captured by `scripts/viz-evidence.sh --spec … --bin … --out … --label … --frames 5`
(panes `w7E:pNQ`, `w7E:pNR`, `w7E:pP1`, plus drafts `w7E:pNS`, `w7E:pNY`; all `confirmed_closed`).

```
scripts/viz-validate.py evidence/v1 --require-select --require-frames --require-records --attempts attempts.json   → all checks passed
scripts/viz-validate.py evidence/v2 …                                                                              → all checks passed
scripts/viz-validate.py evidence/v3 …                                                                              → all checks passed
```

Full validator output: `checks/validator-v1.txt`, `checks/validator-v2.txt`,
`checks/validator-v3.txt`. Check facts per view: `crossings: 0 bridges, 0 touching bends`;
labels fully placed with `0 ambiguous owners`; `0 violations`; extent inside 77x47.

No judge, reviewer or approval is claimed here — the captain starts the separate terra judge.
