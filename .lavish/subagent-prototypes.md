# Subagent rendering — 3 tree-renderer prototypes

Three approaches for integrating `pi-interactive-subagents` (the vendored Herdr-surface fork) into
the captain's tree renderer (`tool-call-renderer.ts`). Each re-expresses the subagent lifecycle
(spawn → active → waiting → stalled → done/failed) in the tree renderer's native glyph vocabulary
(`▸ ▹ ◆ ◇ × • ├─ └─ │`) and Gruvbox Material theme tokens — **no background boxes, no raw-ANSI
blue**, which is exactly the visual disconnect the reference surfaced.

## The shared design constraint

The tree renderer is foreground-glyph + theme-token only. Every prototype below drops the live
widget's `#4da3ff` blue border and the completion box's `toolSuccessBg`/`toolErrorBg` backgrounds,
and speaks only in:

| Glyph | Meaning | Token | Hex |
|---|---|---|---|
| `▹` | working step | accent | `#f28534` |
| `▸` | done step | muted | `#928374` |
| `×` | failed step | error | `#f2594b` |
| `◆` | tool done | success | `#b8bb26` |
| `◇` | tool pending | accent | `#f28534` |
| `•` | thought bullet | muted | `#928374` |
| `├─ └─ │` | connectors | borderMuted | `#504945` |

Stalled is expressed as a working step (`▹` accent) with a `warning`-yellow label, since the tree
renderer has no dedicated stalled glyph — this keeps us inside its vocabulary rather than inventing
one.

## The canonical scenario (rendered identically by all three)

A parent pi thinks, then dispatches two subagents in parallel: `scout` (scout agent) and
`researcher` (researcher agent), both on `glm-5p3-flash`.

- **scout** — runs `read ×2`, `bash`; succeeds in 43s, 3 tools, finds files.
- **researcher** — starts, waits 2m, stalls (wrong activity id), then fails (provider rate-limit
  error) at 1m 12s.

Each prototype shows a **LIVE** frame (mid-run: scout active, researcher waiting) and a **FINAL**
frame (both completed: scout success, researcher failed), so the approaches are compared on the
same evidence.

## Prototype A — Nested subtree

The subagent is a child branch of the parent's trace; the subagent's own tool calls are deeper
leaves on the same tree. Deepest integration — subagent work unfolds inside the parent trace.

## Prototype B — Subagent step block

A dedicated subagent step type: one `▹`/`▸`/`×` row carries a rich inline summary (agent · model ·
status · tools · duration · tokens), with the subagent's tool calls as a contained mini-tree
beneath. The completion box's content, re-expressed in tree vocabulary.

## Prototype C — Inline chip + expandable trace

Minimal footprint while live: one-line chips inline in the parent trace, no nested tree while
running. On completion the chip becomes a collapsed `▸`/`×` row that expands on `ctrl+o` to reveal
the full subagent tool tree. Most space-efficient for parallel runs.

## What these are not

These are rendering prototypes — visual proposals for how subagent lifecycle should look in the
tree renderer. The actual `tool-call-renderer.ts` integration (wiring subagent state into the
renderer's step/call model) is a separate ship task once the captain picks a direction.
