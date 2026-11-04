# Priorities — what the machine-manager C4 draws, and why

Basis: **prioritised (I1–I5)** — full ledger coverage was *not* asked for; the
owner asked for the relations that matter. Every one of the 97 ledger rows is
accounted for (see `coverage.md`).

```
ledger rows:      97
  drawn:          27
  folded:         44   (C2 — duplicate call sites of a drawn relation)
  omitted:        26   (C1 25, C2 1 — no boundary, protocol or actor fact)
  unaccounted:     0
```

Canvas: 156×145, five sections, 33 label-bearing arrows (27 relations + 6 L0
context summaries, which are aggregates, not ledger rows).

## The fifteen that carry the diagram

Ranked by how much of the system's meaning is lost if the arrow is missing.
Criterion letters refer to SKILL.md Step 3.

| # | relation | class | why it earns a place |
|---|---|---|---|
| 1 | `cp → pgrpc` create / terminate / repair | I1 I2 I3 | the control plane's whole contract with the manager, over private gRPC; every provisioning story starts here (e1–e4 fold) |
| 2 | `ops → webapi` http + spa | I1 I4 | the human/`mmctl` surface; without it the operability of the system is invisible (e85) |
| 3 | `agent → pubgrpc` register + heartbeat, 1 min | I1 I2 I3 | the fleet's liveness contract; the 1-minute interval is a qualifier a reader needs (e31, e32) |
| 4 | `mach → boot` agent download + callback | I1 I2 | how software reaches a machine; paired with the boot-image pull at L0 (e23, e26, e22) |
| 5 | `mach → s3` boot image | I1 I5 | the machines pull their own artefacts, never through the manager: the one context arrow that no container owns (e24, e25) |
| 6 | `webapi → Latitude API` reinstall server | I1 I3 | the only place an operator can force a reinstall; a distinct provider surface from Gcore (e78) |
| 7 | `provider adapter → Gcore API` cluster + machine api | I1 I3 | the provisioning substrate: clusters, tasks, machine details (e92, e93) |
| 8 | `SSH executor → mach` launch, audit, reimage | I1 I2 | the ops path the source calls out; nine job types collapse into one hop, and the hop is the meaning (e33–e51 fold) |
| 9 | `BMC service → BMC endpoints` redfish power + boot | I1 I3 | a second network surface (Redfish over a tunnel), not the host OS; a reader who misses it thinks SSH is the only access (e82) |
| 10 | `webapi → Slack API` confirm + alerts | I1 I2 | the human feedback loop; the janitor's confirmations land here (e70, e71) |
| 11 | `secrets cache → AWS Secrets Manager` ssh key + slack token | I1 I3 I4 | a store the reader cannot infer, and the reason no key appears in the chart (e94, e72) |
| 12 | `mm ↔ machine-janitor` diagnostic events / proposed actions | I1 I2 | a bidirectional system-context link: the manager ships diagnostics out and takes actions back (e65, e66, e67) |
| 13 | `pgrpc → riverq` enqueue launch / terminate | I2 I3 | the queue is the spine of asynchronous work; its job vocabulary is protocol information (e7–e9 fold) |
| 14 | `webapi → riverq` reinstall / reprovision | I2 I3 | the operator-triggered async paths, distinct from gRPC-triggered ones (e74–e76 fold) |
| 15 | `recon → prov` cluster create / resize, 1 min | I2 I3 | the reconciliation loop's only externally visible act plus its cadence (e88, e87, e89 fold) |

## The rest of the drawn set (12)

| relation | class | why |
|---|---|---|
| `prov → gcore` (drawn at L1b as `provider adapter → Gcore API`) | I1 I3 | see #7 |
| `store → Postgres` all sql over pgx | I4 | the single data store; explains every write below it |
| `pgrpc → store` machine rows | I4 | machine state ownership |
| `pubgrpc → store` machine state | I4 | heartbeat persistence (pairs with #3) |
| `webapi → store` reads + proposed actions | I4 | the operator surface's persistence |
| `boot → store` validate download | I2 | the boot path checks the machine before serving it |
| `riverw → store` job rows + transitions | I4 | the queue's own state, and where the state machine lives |
| `riverw → riverq` chain follow-up jobs | I2 | the job chain is the ops lifecycle (e36 fold of four follow-ups) |
| `pubgrpc → riverq` enqueue audit / retry | I2 | first-registration audit trigger |
| `riverw → prov` poll + patch gcore | I3 | Gcore work is asynchronous: the poll is the mechanism |
| `pubgrpc → prov` verify claimed ip | I3 | a real qualifier: registration rejects machines whose IP the provider does not own |
| `otel → otelp` traces + metrics | I1 | the only observability egress |

## What was left out, by class

| class | count | example |
|---|---|---|
| **C1** internal detail — wholly inside one container, no boundary, protocol or actor fact | 25 | `riverw → obj` upload audit JSON (`e35`): an object-store client write behind a hop already drawn; also `bmcs → sec` (`e84`), `web → bmcs` (`e79`), `recon → store` (`e86`) |
| **C2** duplicate call site — same hop as a drawn relation, differing only in job type or argument | 44 | `e2`/`e3`/`e4` are the three other RPCs on the `cp → pgrpc` hop drawn as `e1`; `e33`–`e51` are nine SSH jobs on the hop drawn as `e34` |
| **C2** (omitted, not folded) | 1 | `e20` `boot → prov` instance validation: a second lookup of the same provider data drawn at `e14` |
| **C3** helper — an element whose only job is to re-enter the container | 0 | none: `slackc`, `store` and `sec` all carry a boundary or store fact, so they stayed as elements or as label owners |
| **C4** redundant leg — a further parallel leg of a path that need not be countable | 0 | `e25` (machine image) is folded into `e24` (boot image) with the fold recorded rather than omitted |

Two rows moved from *drawn* to *omitted* during the run, both C1, both
defensible only in hindsight:

- `e27 mach → sshx.io` — a `curl | sh` installer, run once per host.
- `e29 agent → IMDS` — the 169.254.169.254 metadata read during bootstrap.

Both are boundary crossings (I1), and the first drafts drew them. They lost
their place because they made the context section 210 columns wide and forced
two long routes; the honest trade is recorded here rather than hidden in the
layout.

## Judgement calls that could go either way

1. **The janitor link at L0, not L1b.** `machine-janitor` is a separate
   deployment in the same namespace, so its two-way link with the manager is a
   *context* relation. Moving it to L0 also removed the only backward route
   from L1b, which was the source of three crossings. A reviewer could
   reasonably want it at L1b next to the Slack confirmation.
2. **`sshx.io` and `IMDS` omitted.** Both are real boundary hops; both are
   bootstrap plumbing. The diagram is cleaner without them and the omission is
   C1 with a reason, not a silent drop.
3. **The queue drawn as one element.** The ledger splits River workers from
   the River queue (C-02) — two in-process halves over one Postgres schema.
   The ladder keeps them separate only where the arrow direction differs
   (`→ riverq` at L2, `riverw → store` at L2b); a stricter reading would draw
   both elements in every slice.

## Relation to the earlier run

`spec-oversplit-21diagrams.json`, `generation.json` and `comparison.md`
describe the earlier full-scope attempt (21 sections) and the golden
comparison. This file supersedes their coverage basis: the diagram now draws a
prioritised 27 of the 97 ledger rows, and every exclusion is counted above.
