# Vault Hunter Atlas T04 ANSI evidence

These artifacts were generated on **macOS 15.7.4** (24G517) by the headless Neovim/Sidekick verifier harness in `scripts/verify-nvim.lua`. They capture native terminal preview buffers produced by the real Sidekick preview rendering and lifecycle path exercised by T04 V01 and V02. The matched Atlas frames and fallback transcript text are deterministic fixtures supplied through mocked verifier hooks; this evidence run did not invoke the production `vault-hunter-atlas` lookup or Herdr read transport.

The evidence was generated from the rebased implementation at commit `a7fbb100` and tree `3724f8d0` with:

```sh
T04_EVIDENCE_DIR=docs/evidence/vault-hunter-atlas-t04 scripts/verify-nvim sidekick-herdr
```

## Captures

- `matched-100x30.ansi`: V01 matched Atlas preview on a 100x30 headless Neovim grid (96x10 preview window).
- `matched-80x24.ansi`: V01 matched Atlas preview on an 80x24 headless Neovim grid (76x4 preview window).
- `fallback-restored.ansi`: V02's actual restored default Sidekick preview buffer on the 80x24 headless grid after the Atlas fallback checks.

Neovim's native terminal buffer interpreted and normalized the source SGR before buffer capture. As an explicit user-approved substitute for a screen capture, the opt-in exporter applies the deterministic renderer convention `SGR 1;36` (bold cyan) plus `SGR 0` only around captured heading lines when the captured buffer contains no SGR. All captured text, spacing, ordering, and trailing blank buffer lines are otherwise preserved verbatim. The ANSI wrappers add presentation only. With `T04_EVIDENCE_DIR` absent, the verifier does not create or modify evidence files.

## SHA-256

```text
d4d70b5d2872fbad1d951d2ef50b28fef92fba3fcb58833e66c2f01474d6e330  fallback-restored.ansi
f6ba84198c92b818fc05d7aeed64e04caef08afcb29ca4ca5a197c30fd6209b7  matched-100x30.ansi
7cc2b90511282c3ab9a44e2ee28be939c3f0779c98d2db03676eec040d812cde  matched-80x24.ansi
```
