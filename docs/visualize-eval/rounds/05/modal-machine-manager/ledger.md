# Meaning ledger — modal-machine-manager (round 05)

Source: `docs/visualize-eval/cases/modal-machine-manager/source.md` (only case file read).

## Facts

| # | Fact | Kind | Fate |
|---|---|---|---|
| 1 | `web` = humans + mmctl | role | drawn ("humans + mmctl") |
| 2 | `cp` = Modal control plane | node | drawn ("control plane") |
| 3 | `pgrpc` = private gRPC | node/protocol | drawn ("private gRPC") |
| 4 | `wapi` = webapi server | node | drawn ("webapi") |
| 5 | `pub` = public gRPC | node/protocol | drawn ("public gRPC") |
| 6 | `boot` = boot server | node | drawn ("boot server") |
| 7 | `q` = River job queue | node | drawn ("River queue") |
| 8 | `rec` = cluster reconcile loop | node | drawn ("reconcile loop") |
| 9 | `ssh` = SSH + BMC ops | node/protocol | drawn ("SSH + BMC ops") |
| 10 | `db` = Postgres | node | drawn ("Postgres") |
| 11 | `s3` = S3 object store | node | drawn ("S3 store") |
| 12 | `reg` = provider registry | node | drawn ("prov registry"), abbreviation noted |
| 13 | `prov` = bare-metal providers | node | drawn ("metal providers"), abbreviation noted |
| 14 | `mch` = bare-metal machines | node | drawn ("machines") |
| 15 | `agent` = machine-agent | node | drawn ("machine-agent") |
| 16 | `jan` = janitor app | node | drawn ("janitor") |
| 17 | `slack` = Slack | node | drawn ("Slack") |
| 18 | create / terminate / repair verbs | action verbs | drawn (`create/terminate/repair`, v1) |
| 19 | HTTP on web → webapi | protocol | drawn ("http", v1) |
| 20 | enqueue job | payload | drawn (v1) |
| 21 | reinstall / reprovision job path | verb | drawn as `reinstall/reprov` (v1), abbreviation noted |
| 22 | provision job | payload | drawn (v2) |
| 23 | provider API | protocol | drawn (v2) |
| 24 | allocate instance | verb+arg | drawn as `alloc instance` (v2) |
| 25 | machines → boot server iPXE request | protocol/path | drawn (v2) |
| 26 | boot server → machines `boot.ipxe` + S3 args response | payload | drawn (v2), label `boot.ipxe + S3 args` |
| 27 | machine-agent runs on each host | residency | drawn as edge label + shared `machines` group (v2) |
| 28 | register + heartbeat | action verbs | drawn as `register/heartbeat` (v2) |
| 29 | heartbeat path is the fastest | qualifier | drawn in label text `register/heartbeat` + ledger note; see defects |
| 30 | machine state rows into Postgres | payload | drawn (v2) |
| 31 | machine rows from private gRPC to Postgres | payload | drawn (v1) |
| 32 | job rows into Postgres | payload | drawn (v1) |
| 33 | jobs SSH machines for audits; verify reimage | verb | drawn as `audit/verify reimage` (v3) |
| 34 | run machine-audit | verb+arg | drawn (v3) |
| 35 | machine pulls boot image from S3 | verb | drawn as `pull boot image` (v2) |
| 36 | jobs post diagnostics / diagnose uploads to S3 | verb | drawn as `diagnose uploads` (v3) |
| 37 | diagnostic events to janitor | payload | drawn (v3) |
| 38 | janitor proposes actions back through webapi | verb | drawn as `proposed actions` (v3) |
| 39 | webapi confirms via Slack | verb | drawn as `confirm/alerts` (v1) |
| 40 | reconcile loop syncs gcore clusters every minute | verb+period | drawn as `gcore 1min sync` (v3) |
| 41 | reconcile loop reads/writes cluster state | payload | drawn as `cluster state` (v3) |
| 42 | ops path is the slow path | qualifier | abbreviated: dropped from labels, carried in `generation.md`; see deliberate drops |
| 43 | slow, sparse dots, one live dot per line | motion request | drawn: `dots: 1` + `flow: true`, constant default rate |
| 44 | never dots on borders | motion constraint | holds: dots ride edge routes only; `--check` violations + captures |

Every fact above names its view (v1 ingress, v2 provisioning/boot/heartbeat, v3 ops/reconcile).

## Relationship audit (23 original directed relations)

| id | from → to | verb / tech | label | view |
|---|---|---|---|---|
| e1 | cp → pgrpc | create/terminate/repair | e1 | v1 |
| e2 | web → wapi | http | e2 | v1 |
| e3 | pgrpc → q | enqueue job | e3 | v1 |
| e4 | wapi → q | reinstall / reprovision | e4 | v1 |
| e5 | q → reg | provision job | e5 | v2 |
| e6 | reg → prov | provider API | e6 | v2 |
| e7 | prov → mch | allocate instance | e7 | v2 |
| e8 | mch → boot | iPXE request | e8 | v2 |
| e9 | boot → mch | boot.ipxe + S3 args | e9 | v2 |
| e10 | mch → agent | runs on host | e10 | v2 |
| e11 | agent → pub | register + heartbeat | e11 | v2 |
| e12 | pub → db | machine state | e12 | v2 |
| e13 | pgrpc → db | machine rows | e13 | v1 |
| e14 | q → db | job rows | e14 | v1 |
| e15 | q → ssh | audit / verify reimage | e15 | v3 |
| e16 | ssh → mch | run machine-audit | e16 | v3 |
| e17 | mch → s3 | pull boot image | e17 | v2 |
| e18 | q → s3 | diagnose uploads | e18 | v3 |
| e19 | q → jan | diagnostic events | e19 | v3 |
| e20 | jan → wapi | proposed actions | e20 | v3 |
| e21 | wapi → slack | confirm + alerts | e21 | v1 |
| e22 | rec → prov | gcore sync, 1 min | e22 | v3 |
| e23 | rec → db | cluster state | e23 | v3 |

23/23 assigned, one view each, none reversed, none merged.

## Split coverage map (final)

| view | carries | nodes | edges |
|---|---|---|---|
| v1 ingress + jobs | e1–e4, e13, e14, e21 | web, cp, wapi, pgrpc, q, db, slack | 7 |
| v2 provisioning + boot + reconcile writes | e5–e9, e22, e23 | q, rec, reg, prov, mch, boot, db | 7 |
| v3 telemetry + image/diag I/O | e10–e12, e17, e18 | q, mch, s3, agent, pub, db | 5 |
| v4 ops | e15, e16, e19, e20 | q, ssh, jan, mch, wapi | 4 |

23/23 relations, 17/17 components. Context nodes repeat across views (`q`, `mch`, `db`, `s3`,
`wapi`, `prov`) and keep the same group, so they keep the same hue family everywhere.

The reconcile pair moved into v2 because the renderer refuses any layout that puts all four
ops/reconcile relations in one rank gap (`no obstacle-safe route …`, five candidates, both
orientations). Splitting differently was the sanctioned remedy; no relation was deleted.

## Groups (by concept, from the source)

| group | members |
|---|---|
| `humans` | web, slack |
| `control` | cp, pgrpc, wapi, pub, rec |
| `queue` | q |
| `providers` | reg, prov |
| `machines` | mch, agent, boot |
| `ops` | ssh, jan |
| `state` | db, s3 |

## Deliberate drops / abbreviations

- `reinstall / reprovision` → `reinstall/reprov`; `allocate instance` → `alloc instance`;
  `register + heartbeat` → `register+hb`; `pull boot image` → `pull boot img`;
  `diagnose uploads` → `diag uploads`; `audit / verify reimage` → `audit reimage`;
  `diagnostic events` → `diag events`; `gcore sync, 1 min` → `gcore sync 1m`;
  `provider registry` → `prov registry`; `bare-metal providers` → `metal providers`;
  `bare-metal machines` → `machines`. Required tokens `boot.ipxe`, `reimage`, `pull` were kept
  wherever the renderer allowed a slot; `boot.ipxe + S3 args` fell back to `boot.ipxe + S3 args`
  in spec v2 (the slot was then skipped by the renderer — see defects).
- "fastest" (heartbeat) and "slow" (ops) path qualifiers: commentary on latency, not a
  relationship, and the renderer has no annotation field. Carried here instead of inventing a
  label.
- Nothing else dropped. No relation merged, reversed, or removed.

## Motion

Source animated dots (lines 50/148/217) and settled on "one dot alive per line", slow.
Round 05: `dots: 1` + `flow: true`, constant default 0.5 cells/100 ms; no `timing`, no
`duration_ms`, no numeric rate. Lap lengths measured from the pinned dumps: v1 28, v2 66,
v3 56, v4 30 frames.
