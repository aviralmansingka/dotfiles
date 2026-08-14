---
name: artifact
description: Turn a Markdown file, notes, code, data, or a conversational brief into a polished standalone HTML artifact and deliver the rendered page. Use when the user invokes $artifact, says "artifact" with a filename such as `artifact docs/plan.md`, asks to turn a file into an artifact, or wants a visual report, diagram, table, comparison, plan, or technical explainer.
---

# Artifact

Turn the supplied source into a polished HTML page immediately. Prefer a good default over asking the user how to
visualize it.

## Accept the input

1. Treat a supplied filename as the source of truth. Resolve relative paths from the current working directory and read
   the file completely.
2. When the user says only `artifact <path>`, perform the whole workflow without asking for confirmation.
3. If no file is supplied, use the current conversation, pasted text, or named subject as the source.
4. Follow local links or inspect code only when needed to understand or verify the source. Do not invent missing facts.
5. For a Markdown source, write `.lavish/<markdown-stem>.html` by default and retain the original Markdown path for
   publishing.

Typical invocations:

```text
$artifact docs/architecture.md
artifact notes/decision.md
Turn README.md into an artifact
```

In Pi, `/skill:artifact docs/architecture.md` is equivalent.

## Resolve bundled resources

Set `skill_dir` to the directory containing this `SKILL.md`; if it was discovered through a symlink, either the symlinked
directory or its resolved target is valid. Resolve every bundled path below from `skill_dir`, never from the user's current
working directory:

- `skill_dir/references/visual-system.md` — fallback visual-system instructions; read this file.
- `skill_dir/assets/reference.html` — standalone HTML scaffold; copy it to the output path before editing it.
- `skill_dir/references/qa.md` — rendering and delivery checklist; read this file before verification.

Verify a bundled file exists before using it. Never modify a bundled resource while producing an artifact.

## Choose the page shape

Load `lavish` and read every playbook that matches the source before writing HTML:

- `diagram` for relationships, architecture, lifecycle, state, or sequence.
- `table` for repeated records, ownership, evidence, or status.
- `comparison` for options, tradeoffs, or current versus target.
- `plan` for phases, risks, decisions, and implementation approaches.
- `code` for source, commands, diffs, or before/after examples.

Do not force every source into an architecture page. Choose the smallest combination that makes the material easier to
understand than the Markdown.

Use this design order:

1. Honor a visual system the user names.
2. Otherwise inspect and match the subject project's existing visual system.
3. If neither exists, read `skill_dir/references/visual-system.md` and copy `skill_dir/assets/reference.html` as the starting
   point.

Use `domain-modeling` when terminology or ownership is unclear, `codebase-design` when the source proposes a module or
seam, and `ponytail` to remove speculative structure. These are reasoning aids, not mandatory decoration.

## Build the artifact

1. Lead with the source's main conclusion, question, or decision.
2. Preserve important detail. Move dense evidence below the opening summary instead of summarizing it away.
3. Use sections, cards, semantic tables, comparisons, code blocks, and inline SVG only where each helps the reader scan
   or decide.
4. Encode status and relationships with stable semantic colors and visible text labels. Include a legend for every
   diagram.
5. Give inline SVG a `viewBox`, `role="img"`, unique `title` and `desc`, page-scoped classes, and unique marker IDs.
6. Contain wide diagrams and tables with local horizontal scrolling. Never let the document root overflow at 390px.
7. Keep the HTML standalone. Do not add annotation controls, editor chrome, review-session code, or external app
   scaffolding unless explicitly requested.
8. Delete unused scaffold components and replace all example content. Never edit the retained reference asset in place.
9. Do not embed the artifact chat control in the HTML. The homelab render gateway adds the standard top-right control and
   right-side conversation drawer so the standalone file stays portable.

## Verify and deliver

Read `skill_dir/references/qa.md` and satisfy every applicable check.

Inspect the rendered page in a browser at desktop width and exactly 390px. Check the actual content, collisions, clipped
text, local scrollers, root overflow, focus visibility, and accessibility. A successful command or HTTP response is not
visual proof.

Publish a Markdown-backed artifact as a plain page by default:

```sh
~/dotfiles/scripts/lavish-homelab render .lavish/<stem>.html --source-markdown <source.md>
```

`render` clones the source repository's current pushed branch into an isolated homelab worktree, overlays the local
Git-visible files, launches a persistent Herdr workspace prefixed `Artifact-`, and connects the page's chat drawer to its
Codex agent. Questions are read-only by default; the agent may edit its worktree only when the user explicitly asks. The
drawer's **Check changes** action reports both the artifact delta since launch and Git status against the pushed baseline;
it never stages, commits, or pushes.

The returned `alias_url` serves that shell: the artifact frame plus the chat drawer, which supports queued sends
with Esc cancel, drag-to-resize, Markdown-rendered answers, and Vimium-style j/k/gg/G scrolling. The plain artifact
is served unchanged at `<alias_url>/__artifact/content/` — run browser QA and the SHA-256 comparison against that
content URL, then smoke-test the chat with one question via `POST <alias_url>/__artifact/api/chat` and confirm an
`assistant` reply before sharing. Share the alias URL; offer the plain content URL for embedding or distraction-free
reading.

Use `review` only when the user explicitly asks for interactive annotation. Verify the returned page content and compare
local, homelab, and HTTPS SHA-256 values before calling delivery complete. Open or share the final rendered page.

## Done means

- The artifact faithfully represents the supplied source.
- The opening screen makes its purpose and conclusion obvious.
- Visual structure clarifies the material instead of merely decorating it.
- Desktop and 390px mobile have no collisions, clipped content, or root overflow.
- The delivered URL serves the intended page and matches the verified local file.
- The delivered page exposes the top-right artifact chat, its `Artifact-` Herdr workspace is live on the homelab, and
  **Check changes** completes without mutating the worktree.
