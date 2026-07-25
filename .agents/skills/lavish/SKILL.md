---
name: lavish
description: Turn complex or visual agent responses into rich, reviewable HTML artifacts the user can annotate and send feedback on, using the lavish-axi CLI. Use when about to give a plan, comparison, diagram, table, code diff, report, or anything easier to grasp visually than as prose.
argument-hint: <what the artifact should show>
author: Kun Chen (kunchenguid)
metadata:
  hermes:
    tags: [html, review, artifacts, visualization]
    category: productivity
---

# Lavish

Lavish turns complex responses into rich HTML artifacts. Start with the artifact itself: generate the page, host it on
the homelab, and give the user the plain rendered page without editor chrome. Open the collaborative Lavish Editor,
annotation panel, feedback poll, and review lifecycle only when the user explicitly asks to annotate, review
interactively, or send feedback from the page.

Use the local `npx -y lavish-axi` command only for read-only helpers such as `playbook` and `design`. Use the homelab
wrapper for both plain artifacts and opt-in review sessions.

## Request

$ARGUMENTS

If the request above is non-empty, the user invoked `/lavish` explicitly - build an HTML artifact for that request now, following the workflow below.
If it is empty, infer what to visualize from the conversation.

## When to use

Use lavish-axi when the user asks for a visual artifact, HTML explainer, interactive prototype, review surface, product or technical plan, comparison, report, or browser-based feedback loop

## Workflow

1. Create the HTML artifact (default location `.lavish/<markdown-stem>.html` in the working directory). When it comes
   from a Markdown file, give the HTML the same filename stem.
2. Run `~/dotfiles/scripts/lavish-homelab render <html-file> --source-markdown <markdown-file>` to sync it and point
   its stable alias at the plain rendered artifact. Share the returned `alias_url`. Stop here by default.
3. Only for an explicitly requested collaborative review, run
   `~/dotfiles/scripts/lavish-homelab review <html-file> --source-markdown <markdown-file>` to point the alias at the
   Lavish Editor session, then run `~/dotfiles/scripts/lavish-homelab poll <html-file>` for annotations, queued
   prompts, and browser-reported `layout_warnings`.
   The poll stays silent until the user acts or the real browser reports fresh layout warnings - leave it running, never kill it.
   If your harness limits how long a foreground command may run, run the poll as a background task; if it gets killed or times out anyway, just re-run it - queued feedback is never lost.
4. If poll returns `layout_warnings`, follow the returned `next_step`: fix and re-check fresh error-severity findings, but proceed with a note instead of looping when every current warning is persistent or low-severity.
5. Apply human feedback locally, then run `~/dotfiles/scripts/lavish-homelab poll <html-file> --agent-reply "<message>"`.
6. Run `~/dotfiles/scripts/lavish-homelab end <html-file>` when the interactive review is finished.

## Homelab hosting

- The homelab owns the artifact copy, optional Lavish session state, and Tailscale Serve endpoint. Client devices edit
  locally and sync through the wrapper.
- Never configure Tailscale Serve on the client or fall back to a device URL without explicit user approval. If the
  homelab is unavailable, report that blocker and keep the artifact local until it returns.
- Share the stable port-443 `alias_url`. In default `render` mode it redirects directly to the artifact; in explicit
  `review` mode it redirects to the editor shell.
- Named aliases are collision-safe. The wrapper will never replace an existing port-443 route; if the Markdown-derived name is already owned, choose another explicit `--alias` or keep using that existing site as appropriate.
- Keep every local asset beside the HTML file and use relative references. The wrapper syncs the entire containing
  directory to a device-and-path-scoped directory on the homelab before `render`, `review`, and `poll`.

## Visual guidance

- Use visual hierarchy to make the most important decisions, risks, tradeoffs, and next actions obvious at a glance
- Use visual structure such as sections, cards, tables, diagrams, annotated snippets, and side-by-side comparisons instead of long prose
- Choose typography, spacing, color, and layout deliberately so the artifact has a clear point of view
- Prevent horizontal overflow at every nesting level: nested grid/flex children also need minmax(0, 1fr) tracks and min-width: 0, especially when badges, labels, or status text use wide pixel or monospace fonts; wrap, truncate, or contain long unbreakable text deliberately
- When the artifact would describe existing or current UI or state, show it instead: capture screenshots of the real pages (run the app read-only if needed) and embed them, rather than explaining the current look in prose; reserve prose for what cannot be shown such as rationale, trade-offs, and open questions

## Playbooks

Run `npx -y lavish-axi playbook <id>` for focused, detailed guidance on any of these.
One artifact often combines several playbooks (for example a plan that includes a comparison and a diagram), so MUST open each matching playbook before writing HTML.
For flows, architecture, state, or sequence diagrams, do not hand-build boxes-and-arrows from div/flexbox; open the diagram playbook and use Mermaid unless SVG is needed for richly annotated nodes.

- `diagram` - Map relationships, flows, state, and architecture
- `table` - Turn dense records into scan-friendly review surfaces
- `comparison` - Show options, tradeoffs, and current vs target behavior
- `plan` - Explain a product or technical plan before implementation
- `code` - Render source code, code files, patches, PR diffs, and before/after code inside Lavish artifacts
- `input` - Must be used when the agent needs to collect user input on decisions, choices, preferences, triage, scope, or other structured feedback from within the artifact
- `slides` - Create a deliberate presentation when slides are requested

## Commands & rules

- Run `~/dotfiles/scripts/lavish-homelab render <html-file> --source-markdown <markdown-file>` by default. It syncs
  the artifact and returns a stable `alias_url` that opens the rendered HTML directly
- Run `~/dotfiles/scripts/lavish-homelab review <html-file> --source-markdown <markdown-file>` only when the user
  explicitly asks for the editor or annotation workflow. `open` remains a backward-compatible synonym for `review`
- Unless the user specifies another location, create HTML artifacts in the current working directory under `.lavish/`
- Lavish serves the html file through a local express.js server. If your html needs to reference other filesystem assets such as images, CSS, fonts, and local scripts, copy them into the same directory as the HTML file, then reference them with relative paths from that directory. Never prepend `/` to those asset paths - root paths won't work
- Use `poll` only during an explicit interactive review. Plain rendered artifacts do not start a feedback poll
- Run `~/dotfiles/scripts/lavish-homelab end <html-file>` to end a session as the agent - ending it this way still allows a plain reopen later. When the user ends it from the browser instead, pass `--reopen` only when reopening is warranted
- Run `npx -y lavish-axi export <html-file> [--out <path>]` to write a portable copy of the artifact - one HTML file with its LOCAL assets inlined - so it opens with no Lavish server and no sibling files. Remote CDN/font references are left as links, so it needs network to render those. Users can also export from the browser chrome's overflow menu
- Do not run `lavish-axi share` or publish to another host unless the user explicitly asks for external publishing; the default and canonical review host is the homelab
- Do not run `lavish-axi stop` from a client; the persistent homelab service is shared by every review session
- Run `npx -y lavish-axi playbook <playbook_id>` for focused artifact guidance. One artifact often combines several playbooks (for example a plan that includes a comparison and a diagram), so MUST open each matching playbook before writing HTML.
- Lavish does not auto-inject any design system - artifacts stay portable so they render identically when opened directly without lavish-axi running. Before writing any HTML, decide the design direction in this strict priority order, and only move to the next step when the current one truly yields nothing: (1) if the user asked for a specific look or named design system, use that; (2) otherwise you must first inspect the project the artifact is about - the subject or product whose content or UI it represents, which may differ from your current working directory - and match that project's design system: Tailwind or theme config, shared CSS variables or design tokens, component library, brand assets, or existing styled pages. If the artifact previews, proposes, or mocks a specific app's UI, render it in that app's own design system so it faithfully shows the product, even when you are running in a different repo; (3) only when both steps come up empty, use the Lavish-recommended Tailwind CSS browser runtime v4 + DaisyUI v5, available via CDN - run `npx -y lavish-axi design` for a content-to-playbook router, a copy-pasteable CDN snippet, a Mermaid CDN snippet/init for diagrams, and the DaisyUI component reference, and prefer the Tailwind/DaisyUI CDN snippet over hand-writing styles unless explicitly instructed otherwise by the user. When you deliver the artifact, state which of the three design sources you used and why.
- Use lavish-axi when the user asks for a visual artifact, HTML explainer, interactive prototype, review surface, product or technical plan, comparison, report, or browser-based feedback loop
