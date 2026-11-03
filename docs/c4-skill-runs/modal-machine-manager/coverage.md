# Coverage — relations → level, machine manager

Two fact sets are in play, and they differ in resolution:

- **The ledger** (`ledger.md`): 97 code-level rows (`e1`–`e97`) gathered by the
  four scouts from `/Users/aviral/modal`, each with `file:line`.
- **The view scope** (`spec.json`): the 23 relations between *elements*
  (`coverage` below). Call sites fold into their relation; the fold is listed
  here so nothing is invisible.

Rule applied (SKILL.md Step 6): every scoped relation is drawn exactly once;
every ledger row is either folded into a drawn relation or listed under
**not drawn** with a reason. Nothing is silently dropped.

Drawn relations: **23/23 once each**. Ids below are the spec's per-diagram
node ids.

## Drawn — L0 (7 context summaries + 1 atomic relation)

| # | drawn | ledger rows folded in | why L0 |
|---|---|---|---|
| 1 | `cp → mm` provisioning | e1, e2, e3, e4 (+e5 transport) | context arrow, summarises L1 |
| 2 | `ops → mm` http | e85 (browser → webapi), G-4 (mmctl → web, no row) | actor access, summarised |
| 3 | `agent → mm` register + heartbeat | e31, e32 | fleet reports to the manager |
| 4 | `mm → prov` provider API | e92, e93 | one arrow for both providers |
| 5 | `mm → mach` boot + audit | e23, e33, e34, e42 | the manager's outward machine work |
| 6 | `mm → slack` confirm + alerts | e70, e71 | notification egress |
| 7 | `mach → s3` pull boot image | e24, e25 | **atomic**: external → external, no container owns it, drawn once here |

`mach → s3` is the one L0 arrow that is not a summary: the machines talk to the
object store directly, so L0 is its most-fitting level and L1/L1b do not
repeat it (they carry the manager's own S3 traffic instead).

## Drawn — L1, container `Machine manager` = pgrpc, web, reg, recon, ssh, boot

| # | drawn | ledger rows folded in |
|---|---|---|
| 8 | `cp → pgrpc` create / terminate / repair | e1, e2, e3, e4 |
| 9 | `ops → web` http | e85, G-4 |
| 10 | `reg → prov` provider API | e92, e93 |
| 11 | `recon → prov` gcore sync, 1 min | e86 (timer), e87, e88, e89 |
| 12 | `ssh → mach` run machine-audit | e33, e34, e42, e48 |
| 13 | `boot → mach` boot.ipxe + S3 args | e20, e21, G-2 (chainload) |
| 14 | `mach → boot` iPXE request | e23, G-2 |
| 15 | `prov → mach` allocate instance | e92 (cluster create), e61 (machines imported once allocated) |

Externals at L1: `cp`, `ops`, `prov`, `mach` — the same four that were outside
at L0 apart from `agent`/`s3`/`slack`, which the fleet-side slice (L1b) owns.

## Drawn — L1b, container `Machine manager` = q, web, pub

| # | drawn | ledger rows folded in |
|---|---|---|
| 16 | `mach → agent` runs on host | e28 (systemd unit), e30 (local subprocess) |
| 17 | `agent → pub` register + heartbeat | e31, e32 |
| 18 | `q → s3` diagnose uploads | e35 (audit JSON), e38/e46 (bench artefacts) |
| 19 | `web → slack` confirm + alerts | e70, e71 |

## Drawn — L2, container `Machine manager` = pgrpc, web, q, reg, ssh, jan

| # | drawn | ledger rows folded in |
|---|---|---|
| 20 | `pgrpc → q` enqueue job | e7, e8, e9 (enqueue/cancel in tx) |
| 21 | `web → q` reinstall / reprovision | e74, e75, e76 |
| 22 | `q → reg` provision job | e57, e58, e60, e61 |
| 23 | `q → ssh` audit / verify reimage | e34, e42, e54-adjacent worker paths |
| 24 | `q → jan` diagnostic events | e54 (all six trigger sites) |
| 25 | `jan → web` proposed actions | e66, e67, e63, e64 |

## Drawn — L2b, container `Machine manager` = q, pgrpc, pub, recon, pg

| # | drawn | ledger rows folded in |
|---|---|---|
| 26 | `q → pg` job rows | e56, e7 (same tx) |
| 27 | `pgrpc → pg` machine rows | e6, e10, e11, e12 |
| 28 | `pub → pg` machine state | e13, e16, e18 |
| 29 | `recon → pg` cluster state | e86, e59 |

(The table numbers 1–29 cover 23 scoped relations + 6 L0 summaries; the seven
L0 summary rows are not extra relations — 1–6 summarise 8–15 and 17–19, and
row 7 is the atomic one. 23 = 1 atomic + 8 L1 + 4 L1b + 6 L2 + 4 L2b.)

## Not drawn — folded, with reason

| ledger rows | reason |
|---|---|
| e5 | transport of e1–e4 (`dial`), folded into relation 1 |
| e22 | **re-attributed** (C-01): the 307 target is S3, not webapi; folded into e21 and G-1 |
| e28, e30 | co-location, folded into relation 16 |
| e36, e41, e43, e44, e53 | worker → queue inserts (C-02): intra-element in this view, folded into the queue element |
| e6–e12 detail, e13–e19 detail | per-query rows folded into relations 20–29 (element-level store traffic) |
| e24, e25 | folded into relation 7 at L0 |
| e70/e71 vs e69/e72 | the Slack client's S3/Secrets-Manager detail folds into relation 19; the janitor event upload (e69) sits under relation 18's S3 traffic |
| e77, e78, e79, e83, e84 | webapi → S3/Latitude/BMC, BMC → secrets: inside-process detail of `web`/`ssh` members, no element-to-element arrow of their own |
| e80, e81 | bmcs → store / sshx: both endpoints are inside the same element pair folded into `ssh` |
| e86–e91 detail | reconcile loop internals, folded into relations 11 and 29 |
| e92–e94 | provider-adapter internals, folded into relations 4, 10, 15 |
| e95 | telemetry export (`web/otel → otelp`): out of the C4 element model asked for; noted as a gap for a later level |
| e96, e97 | River UI reads and the pgx pool: storage detail, folded into relation 26 |
| G-3, G-4, G-8, G-9, G-10, G-11 | gaps the scouts recorded, not rows; G-4 is drawn as part of relation 2 |

## Deliberate exclusions of *elements*

- `envoy`/ingress, the NLB, and the gateway routes are infrastructure in front
  of `pub`/`boot`, not elements calling the manager (C-17). They appear in
  `ledger.md` only.
- `alertsapp`, `datadog-api`, `anthropic`, `circ`, `wf` have no drawn relation
  (dead code or no API, C-04/C-12). They stay in the ledger.
- `auditbin` (`machine-audit`) ships inside the image but executes on the host
  (C-07); it is not a node — its effect is relation 12.

## Known imprecision, stated not hidden

1. **`mach` is one node for "host OS" and "BMC"** (C-08): Redfish traffic is
   really `ssh → bmcout`. The golden drew `ssh → mch` as one arrow; this run
   keeps that shape and records the split as an improvement, not a defect of
   coverage (relation 12 carries both).
2. **`q` merges `riverq` and `riverw`** (C-02). The workers and the queue are
   two in-process halves of one element; drawing both would add an arrow the
   relation set does not have.
3. **`prov → mach` (relation 15) has no single call site**: allocation happens
   provider-side and the machine appears through import (e61). The arrow is
   the honest element-level summary; `ledger.md §5` carries the caveat.
4. **`reg` is the provider adapter, `prov` is the providers.** The golden used
   the same split (`reg` / `prov`); the ledger calls the adapter `prov`, so
   the ids collide across documents — the *spec* names are the ones in the
   columns above.
