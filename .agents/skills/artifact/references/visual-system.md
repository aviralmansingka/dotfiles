# House visual system

Use this Gruvbox terminal-page system only when the design-source routing in `SKILL.md` selects the house fallback.

## Tokens

| Token | Value | Default meaning |
| --- | --- | --- |
| `--bg0` | `#171918` | page background |
| `--bg1` | `#1d2021` | recessed surface |
| `--bg2` | `#282828` | card or diagram surface |
| `--bg3` | `#32302f` | terminal chrome and headers |
| `--border` | `#504945` | structure and separation |
| `--muted` | `#a89984` | supporting prose |
| `--fg0` | `#fbf1c7` | strongest text |
| `--fg1` | `#ebdbb2` | body text |
| `--red` | `#ea6962` | current failure, risk, blocked, or unsafe |
| `--green` | `#a9b665` | target, success, authority, or completion |
| `--yellow` | `#d8a657` | active control, ownership, attention, or unresolved choice |
| `--blue` | `#7daea3` | durable state, evidence, or read-only flow |
| `--aqua` | `#89b482` | section headings and neutral information |
| `--purple` | `#d3869b` | terminology or secondary category |
| `--orange` | `#e78a4e` | provenance, scope, or hero context |

Define matching low-contrast backgrounds for red, green, yellow, and blue. Keep contrast high enough that the text remains legible without the accent.

## Typography and density

- Use a system sans stack for explanatory prose and a system monospace stack for commands, labels, paths, states, and metadata.
- Use large, tightly tracked display type only for the page title. Keep the rest compact and scan-friendly.
- Prefer 10–12px monospace labels, 11–17px body text, and generous line-height over oversized cards.
- Use terminal chrome as orientation: window bar, command row, jump bar, and final status bar. It must frame the artifact, not imitate a working terminal.

## Page anatomy

The scaffold demonstrates the preferred order:

1. Terminal bar and representative command.
2. Hero with the decision/question and a small evidence/status stack.
3. Horizontal jump bar.
4. Current/target/invariant summary.
5. One architecture or lifecycle diagram plus legend.
6. Dense evidence in a semantic table or compact cards.
7. Delivery phases and decision/risk cards when applicable.
8. One memorable acceptance headline and a status footer.

Delete any section that does not help the reader decide or verify something.

## Components

- **Meta cards:** use a left accent to signal evidence, decision, active concern, or risk.
- **Summary cards:** align current, target, and governing rule. Keep corresponding facts in the same position.
- **Panels:** use a compact header, content area, then legend. The header states the question the visual answers.
- **Tables:** use real `table`, `thead`, `tbody`, `th`, and `td`; show the conclusion or status before raw detail.
- **Roadmaps:** highlight only the recommended or active phase. Do not make every phase look equally important.
- **Decision cards:** distinguish recommended/resolved, discuss/measure, and risk/dependency states with both text and color.
- **Acceptance headline:** reduce the design to one testable sentence, not a slogan detached from evidence.

## Diagram grammar

Choose meanings that fit the subject, then keep them stable throughout the page and state them in the legend. Useful defaults:

- Blue node: durable identity, canonical data, or read-only evidence.
- Green node: target component, authority, adapter, or successful result.
- Yellow node or enclosure: control plane, live ownership, or proposed seam.
- Red dashed node: unsafe state, external risk, failure, or read-only observer.
- Solid yellow edge: live control or grant.
- Dashed blue edge: evidence, snapshot, or read-only data.
- Dashed green edge: release, completion, or successful return.
- Dotted red edge: failure, timeout, rejection, or prohibited path.

Do not reuse a color for unrelated meanings in one artifact. When the subject needs another mapping, change the mapping and legend together.

Use inline SVG rather than div-based arrows. Keep geometry explicit, labels short, and dense evidence outside the SVG. Add a dark paint-order stroke behind edge labels so paths do not reduce legibility. Give marker IDs a page-specific prefix.

## Responsive behavior

- Use `minmax(0, 1fr)` for flexible grid tracks and `min-width: 0` on cards and nested children.
- At roughly 1050px, collapse the hero and reduce multi-column grids.
- At roughly 650px, use single-column cards and hide the centered terminal title.
- Give wide SVGs and tables an intentional minimum width inside an `overflow-x: auto` wrapper.
- Never solve diagram readability by making the document root wider than the viewport.
- Include a print palette and hide terminal-only navigation in print.

## Reference asset

`skill_dir/assets/reference.html` is a sanitized, self-contained example, where `skill_dir` is the directory containing
`SKILL.md`. Copy it as a starting point, then replace all example content and remove unused components. Retain its tokens,
containment rules, SVG accessibility shape, legend placement, and responsive breakpoints unless the subject requires a
deliberate change.
