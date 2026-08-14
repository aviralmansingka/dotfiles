# Herdr Attachment Leases: Phase 1 V1 Lifecycle Contract

V1 freezes the Attachment Lease lifecycle accepted through the throwaway prototype. It extends V0 without changing
Herdr, Sidekick, Pi, or Codex runtime behavior.

- Status: `frozen`
- V0 authority contract: [`contracts/herdr-attachment-leases-v0.json`](contracts/herdr-attachment-leases-v0.json)
- Machine-readable lifecycle: [`contracts/herdr-attachment-leases-v1.json`](contracts/herdr-attachment-leases-v1.json)
- Transfer decision: [`ADR 0004`](adr/0004-require-holder-consent-for-healthy-lease-transfer.md)
- Approved prototype evidence: branch `prototype/herdr-attachment-leases`, commit `02a7cf94c22509da4944be4582952bd90bdbee46`

## Approved decisions

1. A request for an unheld Attachment Lease is granted immediately.
2. Exactly one transfer request may wait behind a healthy Lease Holder.
3. The Lease Holder retains live authority while transfer is requested.
4. Only the Lease Holder may approve or deny a healthy transfer request.
5. Release, hide, close, detach, explicit switch, or expiry promotes the pending requester; without one the lease becomes unheld.
6. A Lease Holder may renew while a transfer request is pending, without clearing that request.

There is no healthy-holder force path in V1. A holder may deny and continue renewing. Recovery remains bounded because
loss of liveness reaches the same expiry transition as the prototype clock.

## Durable lease states

Release and expiry are transition causes, not durable states. Observer is a Surface Attachment role, not a lease state.

| State | Lease Holder | Pending requester | Deadline |
| --- | --- | --- | --- |
| `unheld` | absent | absent | absent |
| `held` | required | absent | required |
| `transfer_requested` | required | required and different from holder | required |

An Agent Session may remain in `unheld` with no Surface Attachments. Its identity, agent process, conversation, and
canonical transcript do not depend on the lease state.

## Events and authority

| Event | Authorized actor | Result |
| --- | --- | --- |
| `open` | detached Surface Attachment | Attach; grant immediately when unheld, otherwise become Observer. |
| `request` | Observer | Grant when unheld; otherwise record one pending requester without displacing the Lease Holder. |
| `approve` | Lease Holder | Promote the requester and start a fresh lease deadline. |
| `deny` | Lease Holder | Clear the requester while preserving the holder and existing deadline. |
| `renew` | Lease Holder | Start a fresh deadline and preserve any pending requester. |
| `release` | Lease Holder | Promote the requester or make the lease unheld; the releasing surface remains an Observer. |
| `hide`, `close`, `detach` | attached Surface Attachment | Unregister the surface; if it held the lease, promote the requester or make the lease unheld. |
| `explicit_switch` | Lease Holder | Release deliberately and promote the pending requester. |
| `tick` | Herdr clock | Advance deterministic time; at the deadline, expire and promote the requester or make the lease unheld. |
| `live_input` | Surface Attachment | Advance the transcript only for the Lease Holder; reject Observer input without state mutation. |
| `interactive_mouse` | Surface Attachment | Route only for the Lease Holder; reject Observer mouse events without state mutation. |
| `read_history`, `focus` | attached Surface Attachment | Update surface projection state without changing lease authority. |

Rejected events leave all authoritative state unchanged. Repeating `open` for an attached surface, requesting as the
current holder, or deciding when no transfer is pending is an idempotent no-op.

## Release and promotion

The release causes are explicit release, hide, close, detach, explicit switch, and expiry.

- With a pending requester, any holder release cause promotes it immediately and starts a fresh deadline.
- Without a requester, the result is `unheld`.
- `release` keeps the old holder attached as an Observer.
- `hide`, `close`, and `detach` unregister that Surface Attachment.
- Closing the pending requester cancels only its request; the healthy holder and existing deadline remain.

## Timing boundary

V1 fixtures use deterministic integer ticks and a four-tick duration. Four ticks are test notation, not a production
duration. Phase 2 must measure real Herdr and Neovim stalls before choosing heartbeat and expiry intervals.

## Invariants

1. Agent Session identity never changes across attachment or lease transitions.
2. There are zero or one Lease Holders and zero or one pending requesters.
3. The Lease Holder and pending requester are attached and are different Surface Attachments.
4. Every held lease has one finite deadline; an unheld lease has none.
5. A pending transfer does not reduce the Lease Holder's live authority.
6. Observer live-input and interactive-mouse attempts are rejected without authoritative state mutation.
7. History reads and focus reports never grant or transfer an Attachment Lease.
8. Release and expiry promote the pending requester; without one they leave the lease unheld.
9. Renewal preserves a pending requester while replacing the deadline.
10. Only accepted Lease Holder live input advances the canonical transcript revision.

## Executable evidence

`scripts/fixtures/herdr-attachment-leases-v1/scenarios.json` replays the approved prototype path plus rejection and
recovery variants through the verifier's independent reference reducer.

| Verifier | Observable contract |
| --- | --- |
| `V1.1` | The JSON lifecycle, this document, ADR 0004, and captured prototype evidence agree. |
| `V1.2` | Fourteen transition journeys preserve every V1 invariant after every action. |
| `V1.3` | All V0 checks remain green and the Sidekick runtime seam is byte-identical to the Phase 1 baseline. |

Run `scripts/verify-herdr-attachment-leases-v1` to execute all three in order.

## Milestone boundary

V1 does not define the V2 Capability Plan schema or commands, V3 Pi/Codex surface integration, production timeout
values, or runtime changes. Sidekick therefore continues to use native PTY scrollback and unconditional `--takeover`.
