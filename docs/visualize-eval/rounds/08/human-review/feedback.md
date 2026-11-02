# Round 08 human review — feedback

Reviewer: the owner. Tabs opened 2026-11-02 (seven cases; machine-manager's
tab was superseded by directives before opening). Closed same day on
directive — no per-case written verdicts; the directives below are the
authoritative round-08 human feedback and override judge verdicts where
they conflict.

## Directives

1. **Remove drawn group regions.** The bordered/titled subgraph boxes are
   not wanted. "I don't need this subgraph structure actually shown in the
   diagrams. Let's remove them. Most of the time I just want them to be
   logically grouped (potentially via some tagging conventions), I almost
   never want them to have a border around them. Adding that also
   increases the complexity of rendering." → Round-09 item 0, worktree
   `feat/region-removal`. Grouping stays logical: `group:` tag + hue
   families + global block order; nothing painted.

2. **Parallel round-09 plan approved.** Three parallel groups by file
   ownership: region removal (renderer), dots+labels+guard-rail fixtures
   (renderer), harness+rubric+skill text (eval worktree). Serial tail:
   merge, gate, freeze, round-09 eval.

3. **Keep improvements without sacrificing:** guard-rail fixture per
   closed blocker (per drawing path), one shared definition per
   pixel-level claim, input levers over renderer features, wire dead
   label_slot, recipe yields where the renderer is structurally
   incapable, non-boxed source-semantic shades, pin the fit-proof
   ruling, freeze judge+rubric for round 09.

## On "is round 08 better than previous attempts"

Captain's assessment (accepted): overall no — 17/62 pass (27%) vs round
05's 20/52 (38%), under a harder rubric; the region-geometry regression
drove five grouping fails, and regions are exactly what the owner now
removes. Verdict-confirmed wins to keep: datacenter rank pins, gb300
one-junction trunk, machine-manager carried labels, category system,
hue-family distinctness, no-dots holding.
