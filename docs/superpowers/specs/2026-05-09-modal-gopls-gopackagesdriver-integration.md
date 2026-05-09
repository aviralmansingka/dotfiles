# Modal + gopls + GOPACKAGESDRIVER — goals and plan

Date: 2026-05-09  
Repo: dotfiles (`nvim/.config/nvim`)

## Problem statement

Editing Go inside the **modal** monorepo (Bazel + `rules_go`) should let **gopls** resolve packages correctly. That normally requires **`GOPACKAGESDRIVER`** pointing at a **`rules_go` gopackagesdriver** invocation. We host a small launcher script in dotfiles (`scripts/modal/gopackagesdriver.sh`) and merge Modal-specific **gopls** settings (**`workspaceFiles`**, **`directoryFilters`** including **`-bazel-modal`**) only when the Bazel workspace directory basename is **`modal`**.

## What success looks like

1. **gopls** receives **`settings.gopls.env.GOPACKAGESDRIVER`** set to the dotfiles launcher path for Modal workspaces (unless the user opted out via env or explicit settings).
2. Modal **merge** applies on **`settings.gopls`**: **`directoryFilters`** include **`-bazel-modal`** and **`-bazel-bin`** per our integration, **`workspaceFiles`** includes the BUILD / Bazel globs we intend.
3. **Live validation** on a Neovim session editing `~/modal/go/machine-manager/jobs/jobs.go` ends in **PASS**, not intermittent **FAIL** with **`GOPACKAGESDRIVER=nil`**.
4. **Non-Modal** Bazel repos: no Modal launcher injection; still prefer repo-local driver paths (`tools/gopackagesdriver*` etc.) when present.
5. Behavior is stable under **LazyVim** merges: survives **`lazyvim.json` extras**, multiple **`nvim-lspconfig`** specs, and **Lazy reload** / **LspRestart** workflows.

## What validation showed (facts)

Automated probing found **`vim.lsp.config["gopls"].before_init` absent** after **Lazy reload** + **LspRestart**, **`GOPACKAGESDRIVER` unset** on the client, and **`workspaceFiles`/`-bazel-modal` missing**.

Known non-causes checked:

- **mason-lspconfig** ships no **`lsp/gopls.lua`** for this workflow; Mason is unlikely to wipe **gopls** config via that overlay.
- **`Snacks.util.lsp.on`** used by LazyVim’s **`extras.lang.go`** setup does **not** return truthy **`setup`**; it should **not** skip **`vim.lsp.config(server, sopts)`** on its own.

Open root cause hypothesis:

**`opts.setup.gopls`** chaining in **`lua/plugins/go.lua`** does not reliably leave **`before_init`** on **`sopts`** that LazyVim finally passes into **`vim.lsp.config`**—for example **`setup`** overwritten by another **`nvim-lspconfig`** spec after **`go.lua`**, or timing / table identity issues during merge.

## Approaches

### A — Harden **`opts.setup.gopls`** chaining (small diff)

Raise Lazy **priority**, consolidate user **`nvim-lspconfig`** specs, or ensure **`opts.setup`** cannot be wholesale replaced **after** we wrap **`gopls`**.

Pros: aligns with LazyVim’s **`configure`** path. Cons: brittle if LazyVim or another plugin resets **`setup`**.

### B — Inject **`before_init` / modal settings** independently of **`setup`** (recommended)

After plugins load (**`VeryLazy`** or equivalent), **`vim.lsp.config("gopls", { ... })`** with **`vim.tbl_deep_extend("force", ...)`** that:

- chains any existing **`before_init`**, then calls **`before_init_packages_driver`**, and
- overlays Modal **`workspaceFiles`/filters** without erasing LazyVim defaults.

Pros: survives spec merge churn. Cons: must be **idempotent** and careful not to clobber **`settings`** subtrees unintentionally.

### C — Operational fallback

Document required **restart** / **reload** semantics and ship a standalone probe for manual runs.

Pros: low engineering risk. Cons: weaker “always works.”

### D — Naming flexibility (orthogonal)

Beyond basename **`modal`**, optional env or symlink guidance for clones not literally named **`modal`**.

Pros: ergonomics for fork layouts. Cons: separate from **`before_init`** wiring.

## Proposed plan

1. **Implement B** — add a deterministic post-merge hook (**`vim.lsp.config`** merge) keyed off the same **`modal`** helpers already in **`go.lua`**, with tests-by-probe in a live RPC session until **PASS**.
2. **Optionally tighten A** — reduce duplicate **`nvim-lspconfig`** surface area in **`lua/plugins/`** once B is verified.
3. **Keep validation script** usable (eventually under **`scripts/`** if desired); record **PASS** criteria in **`AGENTS`/README** only if asked (avoid doc sprawl by default).

## Approval

Approve **B-first** (`vim.lsp.config` merge hook) versus **A-only** (**`setup`** fix), before implementation edits.
