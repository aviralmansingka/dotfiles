# homelab-nic-trace — round 10 generation (viz-ds10-3)

Generator: `viz-ds10-3`, model `fireworks/accounts/fireworks/routers/deepseek-flash-latest`.
Candidate skill `docs/visualize-eval/rounds/10/SKILL.md` (sha256 `9c1256791069e272…`),
renderer `/tmp/visualize-eval/round-10/bin/rataflow-view` (sha256 `db70722b92777467…`).
Source read: `docs/visualize-eval/cases/homelab-nic-trace/source.md` only.

## Step 0 — family

```
family: identity-probe-maps
evidence: every relation in the source rides on an address, a name, or a qualifier
          (bond0 192.168.1.197, tailscale0 100.113.153.49, dkbr 172.18.2.1,
          ONT 169.254.3.1, vzbb AS701, cf AS13335, "metric 600", "WNC OUI", "(hist.)")
          and the egress path is a deep chain of probe hops.
```

Tie-breakers: density is chain-like (14 relations over 13 nodes — not a fabric, not a
mesh with an anti-parallel pair); there is no source-named bus splitting between
disconnected worlds (so not placement-planes); identifier/qualifier content is decisive.
Secondary recipes applied: the service-mesh fan rule (the two uplinks are two distinct
one-way ports into one router) and flow-chain corridor protection (one rank per egress hop).

## Views (4, budget 4)

| view | carries | extent | check |
|---|---|---|---|
| v1 host virtual nets | e1–e4, virbr0 / docker0 172.18.2.1 / VM vnet0 / ctr veth, both subnets, host name, "no global v6" | 54x20 | 0 bridges, labels 4/4, 0 ambiguous |
| v2 overlay + uplinks | e5–e8, tailscale0 100.113.153.49 (UDP encap), bond0 192.168.1.197/24, wlp8s0 .213, "no committed rate" | 57x21 | 0 bridges, labels 4/4, 0 ambiguous |
| v3 LAN gateway | e9–e10, 192.168.1.1, NAT+DHCP, WNC (hist.), gw 0.5 ms, metric 600 failover-not-ECMP | 73x12 | 0 bridges, labels 2/2, 0 ambiguous |
| v4 egress chain | e11–e14, collapsed ToR/spine/border/FW role, shared pool IP 71.251.12.240, ONT 169.254.3.1 = MMR analog, 100.41.x, AS701, 1.1.1.1 AS13335, 4.5/6.6/6-9 ms (hist.) | 65x36 | 0 bridges, labels 4/4, 0 ambiguous |

All 14 source relations keep their source direction, across four views with no dropped
fact. Views are static (the source shows no motion): no `flow`, no `dots`, but 3
timestamped frames per view whose drawings are byte-identical.

## Structural levers

`group` tags only (wired, wifi, overlay, libvirt, docker, host, egress) — the source
itself demands the five-way separation. `label_slot` on every labelled edge is the
decisive lever: without it a tb rank gap is as tall as its label is wide (v1 was 58x44
with plain labels). No `trunks` (no source-named shared bus), no `layers`/`minlen`
(no source tier pin), no dots. Historical traceroute hops are `style: "dashed"` and
labelled "(hist.)".

## Evidence and checks

Per view: `evidence/vN/` holds `check.txt`, `<v>-text.txt`, `<v>-ansi.ansi`,
`<v>-selected.ansi`, `<v>-frames.txt`, `<v>-frames.ansi`, `manifest.json` (binary path
+ sha256, measured `82x51 @100%`, `cleanup=confirmed_closed`). The pane in this tab is
larger than the target, so `pinned/<view>-77x47.txt` is the pinned direct dump of the
same FINAL spec at `COLUMNS=77 LINES=47` (`viewport: 77x47 zoom: 1.00 natural`, no
overflow banner).

Validator (`--require-select --require-frames --require-records --attempts attempts.json`):
33/33 PASS per view, exit 0 — `validator/v1.txt … validator/v4.txt`.

Attempts: 2/1/3/3 spec candidates for v1–v4 (cap 3), every probe and rejected draft
recorded with `scripts/viz-evidence.sh record` in `attempts-log.jsonl`; preserved drafts
in `attempts/` hash-match their records. Abandoned shapes are listed in `attempts.json`.

## Known defects

1. `wifi` hue drifts across views (magenta in v2, orange in v3): group families are
   resolved per spec from the declared name set, so the wheel is collision-free inside
   each view but not identical across views. Sibling order is stable.
2. The router carries complementary labels in v3 (identity/NAT/WNC) and v4 (collapsed
   fabric role); both are true and the coverage map names the owner.
3. One v1 capture run produced a pane with no app header and was repeated; the shipped
   bundle is the good capture. No capture, manifest or validator byte was hand-edited.

No blockers. No reviewer was spawned (the contract forbids it); the captain starts the
terra judge. Nothing here is claimed green.
