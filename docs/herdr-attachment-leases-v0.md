# Herdr Attachment Leases: Phase 1 V0 Contract

V0 freezes the language and authority boundary for Attachment Leases. It does not change Herdr, Sidekick, Pi, or
Codex runtime behavior.

- Status: `frozen`
- Baseline: `11cdc2ccf076c898092ba1b5fd19c40cc25ab777`
- Machine-readable contract: [`contracts/herdr-attachment-leases-v0.json`](contracts/herdr-attachment-leases-v0.json)
- Architectural decision: [`ADR 0003`](adr/0003-keep-attachment-authority-in-herdr.md)
- Canonical language: [`CONTEXT.md`](../CONTEXT.md#agent-attachments)

## Canonical language

- **Agent Session** is the durable agent identity that continues independently of a view.
- **Surface Attachment** is one client view of an Agent Session.
- **Attachment Lease** is Herdr's exclusive, time-bounded live-input grant.
- **Lease Holder** is the Surface Attachment that currently has that grant.
- **Observer** is a Surface Attachment without live-input or interactive-mouse authority.
- **Capability Plan** is the inspectable assignment of capabilities to authorities for one Surface Attachment.

The exact definitions and avoided synonyms live in `CONTEXT.md`; the verifier rejects drift from them.

## Authority boundary

| Capability | Canonical authority | Surface responsibility |
| --- | --- | --- |
| Session identity and lifecycle | Herdr Agent Session | Request or reopen |
| Conversation and model state | Pi or Codex | Use the same running agent |
| Live rendering | Agent TUI | Display the running agent |
| Transcript storage | Herdr Agent Session | Read snapshots |
| Historical view | Capability Plan | Use surface-native history |
| Search, selection, and copy | Surface Attachment | Use surface-native controls |
| Live input | Attachment Lease | Lease Holder only |
| Interactive mouse routing | Attachment Lease | Lease Holder's Surface Attachment routes surface-native events |
| Link and file opening | Surface Attachment | Use the surface-native opener |
| Paste and file ingestion | Surface Attachment | Use surface-native normalization |
| Seen and unseen state | Herdr Agent Session | Report focus to Herdr |

Herdr is the authority for durable session truth and attachment arbitration. Adapters render the experience native to
their surfaces; they do not become session authorities.

## V0 invariants

1. Opening or closing a Surface Attachment never changes Agent Session identity.
2. An Agent Session may continue with no Surface Attachments and no Lease Holder.
3. An Observer cannot send live input or route interactive mouse events.
4. Transcript history is stored once by Herdr; surface history views are projections.
5. Every Surface Attachment receives an inspectable Capability Plan.
6. There may be zero or one Lease Holder and zero or more Observers.

## Milestone boundary

V0 deliberately does not define:

- lease states, transitions, renewal, release, expiry, or transfer; V1 owns those;
- the Capability Plan schema, commands, or compatibility behavior; V2 owns those;
- executable Pi and Codex surface scenarios; V3 owns those;
- runtime changes to Herdr, Sidekick, Pi, or Codex; later phases own those.

The current runtime seam remains the baseline: Sidekick uses native PTY scrollback and invokes Herdr 0.8 attachment
with unconditional `--takeover`. V0 records why that policy must eventually move; it does not move it.

## Verifier manifest

| Verifier | Command | Observable contract |
| --- | --- | --- |
| V0.1 | `scripts/verify-herdr-attachment-leases-v0 V0.1` | The six canonical terms, definitions, avoided synonyms, and order match `CONTEXT.md`. |
| V0.2 | `scripts/verify-herdr-attachment-leases-v0 V0.2` | The machine-readable authority matrix matches this document and ADR 0003. |
| V0.3 | `scripts/verify-herdr-attachment-leases-v0 V0.3` | Only Phase 1 contract paths changed; the Sidekick attachment seam is byte-identical to baseline and the retained Herdr 0.8 compatibility route passes. |

Running `scripts/verify-herdr-attachment-leases-v0` executes all three in order.

## Baseline evidence

Before the V0 artifacts existed:

- V0.1 failed because `CONTEXT.md` had no `Agent Attachments` section.
- V0.2 failed because the machine-readable authority contract did not exist.
- V0.3 passed, proving the branch began with the intended unchanged runtime seam.

The broader `scripts/verify-nvim sidekick-herdr` route is not a V0 prerequisite because the baseline currently fails an
unrelated Atlas picker-layout assertion. The focused `sidekick-herdr-compat` route is retained here and green.

## V1 handoff

V1 may now define the state machine using this language and authority boundary. It must not rename these terms or
move canonical authority without deliberately revisiting both `CONTEXT.md` and ADR 0003.
