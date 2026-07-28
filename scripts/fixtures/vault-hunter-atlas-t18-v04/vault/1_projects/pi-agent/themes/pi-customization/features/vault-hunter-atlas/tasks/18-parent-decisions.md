---
status: in-progress
---

# T18: Parent decisions, Run retirement, and companion isolation

Validate Atlas authority transitions.

## Verifiers

- [ ] **V01 — Accept one verifier attempt**
  - **Command:** `scripts/verify-vault-hunter-atlas T18.V04`
  - **Expected:** Accepted attempts become passed without completing the Task or retiring the Run.
- [ ] **V02 — Reject one verifier attempt**
  - **Command:** `scripts/verify-vault-hunter-atlas T18.V04`
  - **Expected:** Rejected attempts keep the Verifier pending and require a new attempt ID.
- [ ] **V03 — Retry after rejection**
  - **Command:** `scripts/verify-vault-hunter-atlas T18.V04`
  - **Expected:** The retry uses a new attempt ID and stays pending until acceptance.
- [ ] **V04 — Retire one exact Run**
  - **Command:** `scripts/verify-vault-hunter-atlas T18.V04`
  - **Expected:** Retirement removes the Run from active lists, keeps exact reads, and rejects later writes.
- [ ] **V05 — Keep companion revival human-only**
  - **Command:** `scripts/verify-vault-hunter-atlas T18.V04`
  - **Expected:** Companion revival touches only Herdr and stays absent from Pi capabilities.
