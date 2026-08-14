# Herdr Attachment Leases: Phase 1 Review Guide

Phase 1 freezes the complete contract needed before runtime enforcement. It deliberately changes no Herdr, Sidekick, Pi,
or Codex behavior.

## What is finalized

| Milestone | Frozen result | Primary review question |
| --- | --- | --- |
| [V0](herdr-attachment-leases-v0.md) | Six terms, authority matrix, cardinality, and invariants | Do the names and ownership boundary match the intended system? |
| [V1](herdr-attachment-leases-v1.md) | Three lease states, events, rejection rules, transfer consent, renewal, release, and expiry | Does every surface transition behave like the approved prototype? |
| [V2](herdr-attachment-leases-v2.md) | Revisioned Capability Plan schema, surface providers, inspect command, and fail-closed compatibility | Can an adapter tell exactly what it may do without inferring authority? |
| [V3](herdr-attachment-leases-v3.md) | Five Pi and seven Codex executable journeys | Do both agent kinds preserve one session and transcript through success, failure, and recovery? |

The approved interactive prototype is retained only on local branch `prototype/herdr-attachment-leases` at commit
`02a7cf94c22509da4944be4582952bd90bdbee46`. It is evidence for V1, not production code.

## Run every verifier

```console
$ scripts/verify-herdr-attachment-leases-phase1
V0.1 canonical vocabulary: PASS
V0.2 authority boundary: PASS
V0.3 scope and unchanged runtime seam: PASS
V1.1 lifecycle contract: PASS
V1.2 executable transition journeys: PASS
V1.3 V0 regression and unchanged runtime: PASS
V2.1 Capability Plan schema and command contract: PASS
V2.2 surface plan resolution: PASS
V2.3 compatibility and V1 regression: PASS
V3.1 Pi/Codex fixture coverage: PASS
V3.2 executable end-to-end scenarios: PASS
V3.3 full Phase 1 regression and runtime boundary: PASS
```

Each verifier can also run independently by passing its exact case, for example:

```bash
scripts/verify-herdr-attachment-leases-v1 V1.2
scripts/verify-herdr-attachment-leases-v2 V2.2
scripts/verify-herdr-attachment-leases-v3 V3.2
```

## Evidence boundaries

- V1 and V2 reference reducers are verifier code, not the Phase 2 Herdr controller implementation.
- V3 uses modeled Pi/Codex identities and transcript events; it does not launch real agents.
- Fixture time is deterministic and does not select production heartbeat or expiry durations.
- Sidekick still uses native PTY scrollback and unconditional `--takeover`; the V0/V1 regression gates require that seam
  to remain byte-identical to baseline `11cdc2ccf076c898092ba1b5fd19c40cc25ab777` throughout Phase 1.

## Next implementation gate

Phase 2 may now implement the Herdr attachment registry and lease controller against these contracts. It should replay
the V1 and V3 fixtures against the real controller, emit V2 Capability Plans, retain read compatibility for existing
agents, and measure production liveness timing. Sidekick migration remains later: it must not remove unconditional
`--takeover` until Herdr enforcement and compatibility are demonstrably green.
