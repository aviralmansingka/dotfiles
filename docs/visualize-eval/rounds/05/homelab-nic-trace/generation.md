# homelab-nic-trace — round 05 generation (DeepSeek)

Case: `homelab-nic-trace`, round `05`. Generator: pi worker subagent `viz-ds05-3`,
provider `fireworks`, model `accounts/fireworks/routers/deepseek-flash-latest`.
No model switch, no judge, no reviewer subagent spawned.

Frozen inputs, both hashes verified by `shasum -a 256` before any work:

| input | sha256 |
|---|---|
| `docs/visualize-eval/rounds/05/SKILL.md` | `ff4a9d3f32ba0bf86e54ee6bfbac02fdea3fac3b95b82a958b3411accef0a949` |
| `/tmp/visualize-eval/round-05/bin/rataflow-view` | `b1ab9f2e78af11c2f2b005eea083a999079d184bf550e8d0b6d9c51867f22404` |

The binary was used by absolute path only for every check and every capture.

## Shape of the result

Four views, all `direction: tb`, all static (no dots anywhere — the source never
animated, and no flair dot was added). Placement was never written: only
`direction`, `theme`, `nodes`, `edges`, and `groups` are in the specs; no
`layers`, no `trunks`.

| view | carries | spec | extent | pane | pinned 77x47 |
|---|---|---|---|---|---|
| v1 | host + libvirt NAT + docker bridge (e1–e4) | `specs/v1.json` | 70x24 | 83x51 @100% | **fits** |
| v2 | overlay terminator + wired primary + Wi-Fi backup (e5, e7, e8) | `specs/v2.json` | 80x24 | 83x51 @100% | overflows, 3 cols |
| v3 | tailscale encap + LAN + gateway + shared pool address (e6, e9, e15) | `specs/v3.json` | 38x32 | 83x51 @100% | **fits** |
| v4 | Wi-Fi metric + NAT out + three historical transit hops + egress limits (e10–e14) | `specs/v4.json` | 34x48 | 83x51 @100% | overflows, 1 row |

`--check`, verbatim per view:

```
v1  extent=70x24 cells | crossings: 0 bridges, 0 touching bends
    labels: 4/4 placed, 0 on route cells, 0 skipped, 0 ambiguous owners
v2  extent=80x24 cells | crossings: 0 bridges, 0 touching bends
    labels: 3/3 placed, 0 on route cells, 0 skipped, 0 ambiguous owners
v3  extent=38x32 cells | crossings: 0 bridges, 0 touching bends
    labels: 3/3 placed, 0 on route cells, 0 skipped, 0 ambiguous owners
v4  extent=34x48 cells | crossings: 0 bridges, 0 touching bends
    labels: 5/5 placed, 0 on route cells, 0 skipped, 0 ambiguous owners
all:  dots: 0 single-dot routes, 0 periodic routes, 0 violations,
      0 constant at 0.5c/step, 0 same-arrival at 2000ms
      origins: 0/0 | arrivals: 0/0
      (no routes: line — not emitted by this binary and not expected in round 05)
```

Zero crossings, zero ambiguous label owners, zero skipped labels in every view —
the engine's label slots did their job. `0 ambiguous owners` is structurally
clean, not a lucky placement.

## Sizing: pane plus pinned target dump

The harness pane follows this agent's tab (measured `83x51 @100%` from the app's
own header token), which is not controlled. So each view also ships a direct
dump with the size pinned by environment:

```sh
COLUMNS=77 LINES=47 /tmp/visualize-eval/round-05/bin/rataflow-view --frames 5 specs/<view>.json
```

| view | pinned dump | reading |
|---|---|---|
| v1 | `evidence/v1/v1-77x47.txt` | no banner; graph rows 17–35, palette corner rows 41–46 complete |
| v2 | `evidence/v2/v2-77x47.txt` | `graph overflows · drag to pan` in all five frames; graph is 80 cells in a 77-column screen; palette bottom border clipped at row 47 |
| v3 | `evidence/v3/v3-77x47.txt` | no banner; graph rows 13–40, palette corner rows 41–46 complete |
| v4 | `evidence/v4/v4-77x47.txt` | `graph overflows · drag to pan` in all five frames; 48-row graph in 47 rows; `cf` node's bottom border clipped |

v2 and v4 are complete and legible in the measured 51-row, 83-column pane
(`evidence/v2/v2-text.txt` rows 17–36, `evidence/v4/v4-text.txt` rows 3–50), but
they do not meet the 77x47 target. That is reported as defects D1/D2, not
papered over — see "Unmet requirement" below.

## Motion

None. Every view is static and each bundle carries five timestamped frames
(0, 100, 200, 300, 400 ms) from the pane plus the same five in the pinned dump.
In all four views frames 0–3 are byte-identical apart from the timestamp; frame 4
differs only because the app has exited and the pane's shell prompt is appended.
That is the "time passes, nothing moves" proof the round requires.

## Meaning ledger (22 rows)

Full machine-readable form in `generation.json`. Summary of the fates:

- **Drawn as text:** `homelab`, ASUS bare metal + Linux 7.0 (v1 row 34);
  `bond0 192.168.1.197` + `2.5 GbE` + `eno1` + `/24` (v2 row 34, v3 row 22);
  `wlp8s0 192.168.1.213` (v2 row 34, v4 row 8); `tailscale0 100.113.153.49`
  + `encap over UDP` + `overlay`; `vm · vnet0`, `virbr0 NAT`, `192.168.122.x`,
  `NAT bridge`; `ctr · veth`, `docker 172.18.2.1`, `172.18.2.x`,
  `docker bridge`; `rtr 192.168.1.1 NAT+DHCP·claimed` (v3 row 30);
  `rtr WNC ToR/spine/BF claimed` (v4 row 16); `def gw 0.5 ms` (v3 row 26);
  `pool 71.251.12.240` (v3 row 38); `ont 169.254.3.1 · claimed` (v4 row 24);
  `vz edge 100.41.x` (v4 row 32); `vz bb AS701` (v4 row 40);
  `cf 1.1.1.1 AS13335` (v4 row 48); `metric 600` (v4 row 12); `NAT out` (v4 row 20);
  `no v6 (ULA), no committed rate` (v4 rows 4–6).
- **Abbreviated with a reason:** `~/rack-bench` → `rack-bench` (workload name,
  tilde path dropped); `ToR, spine, border, firewall` → `ToR/spine/BF`;
  `ULA prefixes only` → `ULA`; the ONT/demarc analogy → the single unbroken
  chain (words not on screen, defect D6); `metric failover, not ECMP` →
  structure only, words not on screen (defect D5).
- **Deliberate drops:** intermediate traceroute hops not named in the brief;
  Oct 11 run detail beyond the workload name.

Nothing else left the ledger silently.

## Relationship audit (15 rows)

| id | from → to | tech / verb | label | view | style |
|---|---|---|---|---|---|
| e1 | vm → virbr | libvirt VM on NAT bridge | `192.168.122.x` | v1 | solid |
| e2 | virbr → box | NAT bridge | `NAT bridge` | v1 | solid |
| e3 | ctr → dkbr | container veth | `172.18.2.x` | v1 | solid |
| e4 | dkbr → box | docker bridge | `docker bridge` | v1 | solid |
| e5 | ts → box | Tailscale overlay | `overlay` | v2 | solid |
| e6 | ts → bond0 | UDP encapsulation | `encap over UDP` | v3 | solid |
| e7 | box → bond0 | eno1, wired uplink | `2.5 GbE` | v2 | solid |
| e8 | box → wlp | Wi-Fi backup | `backup` | v2 | solid |
| e9 | bond0 → rtr | default gateway | `def gw 0.5 ms` | v3 | solid |
| e10 | wlp → rtr | metric 600 | `metric 600` | v4 | solid |
| e11 | rtr → ont | NAT on egress | `NAT out` | v4 | solid |
| e12 | ont → vzagg | traceroute hop | `4.5 ms hist` | v4 | dashed |
| e13 | vzagg → vzbb | traceroute hop | `6.6 ms hist` | v4 | dashed |
| e14 | vzbb → cf | traceroute hop | `6-9 ms hist` | v4 | dashed |
| e15 | rtr → pool | shared NAT egress address | `NAT egress` | v3 | solid |

Every label has exactly one owner; no label is shared between two edges.
Directions are the source's directions — none reversed. `e15` is the one edge
with no counterpart in the brief: the shared pool IP is an address of the
router's WAN side, and drawing it as a labelled attachment was chosen over
dropping the address. It is recorded as a deliberate abstraction.

No trunk was declared. The brief describes no shared bus that splits: the LAN
has two independent uplinks with different metrics, and libvirt/docker are
separate NAT domains. Drawing a trunk there would assert a shared corridor the
source does not state.

## Coverage map

- **v1** — e1–e4, host identity, all four virtual-side identifiers.
- **v2** — e5, e7, e8, `tailscale0` / `bond0` / `wlp8s0` identifiers, the rack-bench workload.
- **v3** — e6, e9, e15, LAN subnet `/24`, `eno1`, NAT+DHCP roles, claim marker, 0.5 ms.
- **v4** — e10–e14, all transit AS/address identifiers, the historical qualifiers, and the two egress limits.

Every source relationship appears in exactly one view; no relation, qualifier or
identifier was dropped to clear a warning or to reach the size target.

## Qualifications (fixed constraints)

`claimed` sits in the router label in v3 and v4 and in the ONT label in v4;
`hist` sits in all three transit edge labels, and those edges are `dashed`,
which this build renders with `╎` (v4 rows 27–45). MAC-vendor and traceroute
roles are therefore never presented as verified physical topology.

## Validator

`scripts/viz-validate.py <bundle> --require-select --require-frames --attempts attempts.json`

| view | passed | failed | verdict |
|---|---|---|---|
| v1 | 32 | — | all checks passed |
| v2 | 31 | `viewport_matches_target` | no pinned 77x47 dump proves the fit (the dump overflows) |
| v3 | 32 | — | all checks passed |
| v4 | 31 | `viewport_matches_target` | no pinned 77x47 dump proves the fit (the dump overflows) |

Not green, and not claimed green. Full output per view:
`evidence/<view>/validator.txt`. Nothing in the validator, the manifests or the
captures was edited to clear a check.

## Defects

- **D1** v2 misses the 77x47 target by 3 columns (extent 80x24). The pinned dump
  shows `graph overflows · drag to pan` and clips the palette corner's bottom
  border at row 47; the 83-column pane capture is complete. The two-edge fan out
  of the host box sets the width, and v2's 3-candidate budget is spent
  (82x24 with an ambiguous owner → 80x24 → 80x24).
- **D2** v4 misses the target by 1 row (extent 34x48). The pinned dump shows the
  banner and clips the `cf` node's bottom border; the 51-row pane capture is
  complete. Six tb ranks cost 48 rows — removing the limits annotation
  (candidate `v4-a3`) left the height unchanged, so the annotation and its two
  facts stayed.
- **D3** Group names are not rendered by this build — no bordered block, no
  block title, only a hue on borders and routes (`nic` 169;182;101,
  `historical traceroute` 211;134;155). No source fact rides on a group name.
  This is a gap against the candidate skill's claim that the engine draws groups
  as bordered blocks with titles.
- **D4** The v4 `no v6 (ULA), no committed rate` node is unattached: an absence
  has no peer to arrow to. Attempt `v4-a1` used two such nodes and they
  overlapped (`attempts/v4-a1-frames.txt` rows 7–10), so the final view uses one.
- **D5** `metric failover, not ECMP` is carried structurally only; the negative
  phrase is not on screen.
- **D6** `the ONT is the demarc, the MMR analog: one ISP, one path` is carried as
  the single unbroken v4 chain; the words are not on screen.
- **D7** Selection state is colour-only in this build: the `--select-all` plain
  text equals the unselected plain text, and only the ANSI capture proves each
  node's selected border (accent 216;166;87).

## Unmet requirement — and why it is structural, not a missed tweak

The pinned-fit requirement is met by v1 and v3, not by v2 and v4. Two measured
facts explain both misses:

1. **A `tb` rank costs 8 rows** in this build (5 ranks = 40 rows, 6 ranks = 48
   rows), so a 77x47 view holds at most five ranks. v4 needs six, because the
   Wi-Fi path reaches the gateway one hop before the WAN chain begins:
   `wlp → rtr → ont → vzagg → vzbb → cf`.
2. **A two-node rank with two gap labels is about 80 columns** (v2's three
   checked candidates measured 82, 80 and 80), and v2 needs two nodes in one
   rank for the host's parallel uplinks.

Moving `wlp → rtr` (e10) from v4 into v3 would leave v4 a five-rank chain, but it
would hand v3 the same two-node-rank-plus-two-labels geometry that puts v2 at 80
columns — the breakage moves rather than disappears. The clean fix is a fifth
view splitting the WAN chain at `vzagg`; the round caps a case at four views. The
cheap-looking alternative, `v4-a1` (31x40, fits 47 rows), was rejected because it
drops e10: deleting a relation to satisfy a size check is not allowed.

## Attempts (budget 3 per view, every check preserved)

| view | attempts | outcome |
|---|---|---|
| v1 | 2 | a1 70x24 kept → a2 (limits annotation here) 80x24, rejected: it widened v1 for no gain |
| v2 | 3 | a1 82x24 + 1 ambiguous owner → a2 80x24 long labels → a3 80x24 kept |
| v3 | 3 | a1 80x24 (group-title facts, unrendered) → a2 84x32 → a3 38x32 kept |
| v4 | 3 | a1 31x40 with two overlapping annotations and no e10 → a2 34x48 kept → a3 34x48 without the limits, rejected |

Raw check output for every attempt is in `attempts/*-check.txt`; rejected specs
are in `specs/rejected/`. Three of them (`v2-a2`, `v3-a2`, `v4-a1`) plus `v1-a2`
and `v4-a3` were rewritten in place during iteration and are restored verbatim
from the attempt that produced their preserved check output.

## Commands used

```sh
shasum -a 256 docs/visualize-eval/rounds/05/SKILL.md /tmp/visualize-eval/round-05/bin/rataflow-view
/tmp/visualize-eval/round-05/bin/rataflow-view --check docs/visualize-eval/rounds/05/homelab-nic-trace/specs/vN.json
COLUMNS=77 LINES=47 /tmp/visualize-eval/round-05/bin/rataflow-view --frames 5 specs/vN.json > evidence/vN/vN-77x47.txt
scripts/viz-evidence.sh --spec docs/visualize-eval/rounds/05/homelab-nic-trace/specs/vN.json \
    --bin /tmp/visualize-eval/round-05/bin/rataflow-view \
    --out docs/visualize-eval/rounds/05/homelab-nic-trace/evidence/vN --label vN --frames 5
scripts/viz-validate.py docs/visualize-eval/rounds/05/homelab-nic-trace/evidence/vN \
    --require-select --require-frames \
    --attempts docs/visualize-eval/rounds/05/homelab-nic-trace/attempts.json
```

## Cleanup

Each capture pane was split no-focus from this agent's own tab, closed by the
harness, and re-probed with `herdr pane get`; all four manifests read
`cleanup: confirmed_closed`:

| view | pane | cleanup |
|---|---|---|
| v1 | `w7E:pGP` | confirmed_closed |
| v2 | `w7E:pGQ` | confirmed_closed |
| v3 | `w7E:pGR` | confirmed_closed |
| v4 | `w7E:pGT` | confirmed_closed |

The captain's tab was never touched and no raw tmux was used.
