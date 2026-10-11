# Subagent rendering — final design (Prototype C + retained blue widget)

Chosen direction: **Prototype C** (inline chips + expandable trace in the tree renderer) **plus the
existing blue-border live widget retained** as the `aboveEditor` overview. The two surfaces coexist
with complementary roles — neither duplicates the other.

## Role split

| Surface | Region | Shows | Lifetime |
|---|---|---|---|
| Blue widget | `aboveEditor` | running subagents (fleet overview) | clears when nothing is running |
| Tree chips | parent trace | per-subagent lifecycle inline in reasoning | permanent record; expandable on `ctrl+o` |

The widget gives at-a-glance "what's running right now"; the tree chips give "how each subagent
fits the parent's reasoning + its full tool trace on demand."

## Canonical scenario

Parent pi dispatches two subagents in parallel — `scout` (scout, `glm-5p3-flash`) and `researcher`
(researcher, `glm-5p3-flash`). `scout` runs `read ×2` + `bash`, succeeds in 43s, 3 tools.
`researcher` starts, waits 2m, stalls (wrong activity id), then fails (provider rate-limit) at
1m 12s.

## LIVE (mid-run: scout active, researcher waiting)
Both surfaces visible: the blue widget above the editor, and the inline chips in the parent trace.

## Stalled moment
Widget shows `researcher` with the red `⟳` and stalled label; the tree chip carries a
warning-yellow label.

## FINAL (collapsed: both completed, widget cleared)
No subagents running → widget hidden. The tree chips persist as `▸`/`×` rows, expand on `ctrl+o`.

## EXPANDED (scout opened with ctrl+o)
The collapsed `▸ scout` row expands to reveal the full subagent tool tree, in the tree renderer's
`◆ ◇ ├─ └─ │` vocabulary and theme tokens.
