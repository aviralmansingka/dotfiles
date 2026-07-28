---
status: done
---

# T09: Add Run Registry list and retire actions

Let operators discover and retire exact Vault Hunter Runs.

## Verifiers

- [x] **V01 — List active Runs**
  - **Command:** go test ./cmd/vault-hunter-registry
  - **Expected:** Returns bounded active Run summaries in deterministic order.
