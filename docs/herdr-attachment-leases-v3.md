# Herdr Attachment Leases: Phase 1 V3 Scenario Contract

V3 closes Phase 1 with executable Pi and Codex scenario fixtures. The fixtures combine the V1 lifecycle and V2
Capability Plan projection without launching real agents or changing the installed runtime.

- Status: `frozen`
- Capability Plan contract: [`contracts/herdr-attachment-leases-v2.json`](contracts/herdr-attachment-leases-v2.json)
- Machine-readable scenario contract: [`contracts/herdr-attachment-leases-v3.json`](contracts/herdr-attachment-leases-v3.json)
- Executable fixtures: [`../scripts/fixtures/herdr-attachment-leases-v3/scenarios.json`](../scripts/fixtures/herdr-attachment-leases-v3/scenarios.json)

## Fixture boundary

The scenarios use modeled identities and transcript events; no real Pi or Codex process is launched. Time uses
deterministic integer ticks. Capability Plans project only the frozen V2 role and live-authority rules. Runtime remains
unchanged.

This is intentionally the strongest Phase 1 evidence available before the owning Herdr repository has an attachment
controller. Phase 2 must replay these same journeys against real processes rather than weakening or replacing them.

## Agent identities

| Agent | Herdr identity source | Identity kind | Conversation provider |
| --- | --- | --- | --- |
| Pi | `herdr:pi` | persisted session `path` | Pi |
| Codex | `herdr:codex` | session `id` | Codex |

Both agents use exactly the same lease events, invariant checks, Neovim/terminal surface declarations, and effective plan
rules. The different identity shapes are preserved byte-for-byte through each journey.

## Pi journeys

| Scenario | What it proves |
| --- | --- |
| `pi_nvim_launch_and_input` | First Neovim open receives the lease; accepted input and Pi output advance one transcript. |
| `pi_terminal_continue_after_hide` | Sidekick hide releases immediately; terminal requests the unheld lease without restarting Pi. |
| `pi_observer_rejection` | A concurrent terminal Observer can read history but cannot send input or mouse events. |
| `pi_stale_holder_recovery` | Four deterministic ticks expire stale Neovim ownership and promote the terminal requester. |
| `pi_background_completion` | Pi produces output and completes with no attachments; terminal reopens the same final transcript. |

## Codex journeys

| Scenario | What it proves |
| --- | --- |
| `codex_nvim_launch_and_input` | First Neovim open receives the lease; accepted input and Codex output share one transcript. |
| `codex_approved_terminal_transfer` | The healthy holder approves a terminal requester, which then becomes the only live authority. |
| `codex_denied_transfer_and_renewal` | A holder may deny, accept a later request, and renew without clearing it. |
| `codex_release_promotes_terminal` | Explicit release promotes the requester while the old holder remains attached as Observer. |
| `codex_explicit_switch_promotes_terminal` | An explicit switch moves live authority without closing either surface. |
| `codex_second_request_rejected` | Exactly one requester waits; another terminal request changes nothing. |
| `codex_background_completion` | Codex completes after terminal detach; Neovim reopens the same final transcript. |

## Required outcomes

1. Launching once preserves one Agent Session identity across all surface transitions.
2. Exactly one Surface Attachment has a Lease Holder plan whenever the lease is held.
3. Concurrent non-holders receive Observer plans and cannot send live input or interactive mouse events.
4. Hide, close, detach, release, and explicit switch relinquish live authority immediately.
5. Expiry recovers from a stale holder and promotes a pending requester without restarting the agent.
6. The Agent Session can produce output and complete with no Surface Attachments.
7. Reopening after background completion projects the same transcript revision and session identity.
8. Only accepted Lease Holder input and agent output advance the canonical transcript revision.
9. A second pending transfer request is rejected without changing authority.
10. Pi and Codex use identical lease semantics despite different session identity shapes.

The verifier checks the complete authoritative state and effective plan after every action, including rejected actions.
A rejected action must leave session identity, transcript revision, attachments, holder, requester, deadline, and plan
revision unchanged.

## Verifier manifest

| Verifier | Observable contract |
| --- | --- |
| `V3.1` | The contract and fixture set contain the exact five Pi and seven Codex journeys in canonical order. |
| `V3.2` | Every action preserves lifecycle and Capability Plan invariants; every expected outcome is observed. |
| `V3.3` | V2, V1, and V0 remain green and no Herdr or Sidekick runtime path changed. |

Run `scripts/verify-herdr-attachment-leases-v3` to execute all three in order.

## Phase 1 completion boundary

Phase 1 is complete when V0 through V3 are green together. It does not include real Pi or Codex runtime attachment,
Herdr attachment controller implementation, Sidekick adapter migration, or production heartbeat duration. Those remain
Phase 2 and later implementation work.
