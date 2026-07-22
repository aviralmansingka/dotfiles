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

# Lavish Editor

Lavish Editor helps agents turn rich HTML artifacts into collaborative human review surfaces. Whenever you are about to give user a complex response that will be easier to understand via a rich / interactive page, consider using Lavish Editor. First generate an interactive HTML artifact according to user request, then use `~/dotfiles/scripts/lavish-homelab` so the homelab hosts the review session and the user can annotate elements or selected text, queue prompts, and send feedback back to the agent.

Use the local `npx -y lavish-axi` command only for read-only helpers such as `playbook` and `design`. Use the homelab wrapper for the review lifecycle even when remote Lavish output shows a bare `lavish-axi` follow-up command.

## Request

$ARGUMENTS

If the request above is non-empty, the user invoked `/lavish` explicitly - build an HTML artifact for that request now, following the workflow below.
If it is empty, infer what to visualize from the conversation.

## When to use

Use lavish-axi when the user asks for a visual artifact, HTML explainer, interactive prototype, review surface, product or technical plan, comparison, report, or browser-based feedback loop

## Workflow

1. Create the HTML artifact (default location `.lavish/<name>.html` in the working directory).
2. Run `~/dotfiles/scripts/lavish-homelab open <html-file>` to sync the artifact directory to the homelab and open or resume its review session. Share only the returned `https://homelab.tail1b3b66.ts.net:8443/session/<key>` URL.
3. Run `~/dotfiles/scripts/lavish-homelab poll <html-file>` to long-poll the homelab for the user's annotations, queued prompts, and browser-reported `layout_warnings`.
   The poll stays silent until the user acts or the real browser reports fresh layout warnings - leave it running, never kill it.
   If your harness limits how long a foreground command may run, run the poll as a background task; if it gets killed or times out anyway, just re-run it - queued feedback is never lost.
4. If poll returns `layout_warnings`, follow the returned `next_step`: fix and re-check fresh error-severity findings, but proceed with a note instead of looping when every current warning is persistent or low-severity.
5. Apply human feedback locally, then run `~/dotfiles/scripts/lavish-homelab poll <html-file> --agent-reply "<message>"`. The wrapper syncs the updated artifact before replying and waiting again.
6. Run `~/dotfiles/scripts/lavish-homelab end <html-file>` when the review is finished.
7. If the user ends the session from the browser instead, the wrapper refuses a plain reopen - only pass `--reopen` when the user asks for further review or something genuinely important needs their visual attention. Otherwise deliver remaining updates directly in this conversation.

## Homelab review

- The homelab owns the artifact copy, Lavish session state, feedback API, and Tailscale Serve endpoint. Client devices only edit locally, sync through the wrapper, and poll over SSH.
- Never run the review lifecycle with local `lavish-axi`, configure Tailscale Serve on the client, or fall back to a device URL without explicit user approval. If the homelab is unavailable, report that blocker and keep the artifact local until it returns.
- Share the homelab Lavish session URL, never `/artifact/...`, a `file://` URL, or an exported HTML file. The session shell injects the annotation SDK and keeps the shell, iframe, event stream, and feedback API under one HTTPS origin, so selected-element comments do not require CORS.
- Keep every local asset beside the HTML file and use relative references. The wrapper syncs the entire containing directory to a device-and-path-scoped directory on the homelab before `open` and `poll`.

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

- Run `~/dotfiles/scripts/lavish-homelab open <html-file>` to sync and open a Lavish Editor session on the homelab. Share only the returned `https://homelab.tail1b3b66.ts.net:8443/session/<key>` URL
- Unless the user specifies another location, create HTML artifacts in the current working directory under `.lavish/`
- Lavish serves the html file through a local express.js server. If your html needs to reference other filesystem assets such as images, CSS, fonts, and local scripts, copy them into the same directory as the HTML file, then reference them with relative paths from that directory. Never prepend `/` to those asset paths - root paths won't work
- Run `~/dotfiles/scripts/lavish-homelab poll <html-file>` to sync and wait for user feedback or browser-reported layout_warnings. It long-polls and stays silent until the user sends feedback, ends the session, or the real browser reports fresh layout_warnings, so leave it running - never kill it. Fix and re-check fresh error-severity layout_warnings before involving the human; if the poll says every current warning is persistent or low-severity, proceed with a note instead of looping. If your harness limits how long a foreground command may run, run the poll as a background task; if it gets killed or times out anyway, just re-run it - queued feedback is never lost. When it reports the session ended, stop polling and do not reopen it uninvited - deliver remaining updates in this conversation instead
- Run `~/dotfiles/scripts/lavish-homelab end <html-file>` to end a session as the agent - ending it this way still allows a plain reopen later. When the user ends it from the browser instead, pass `--reopen` only when reopening is warranted
- Run `npx -y lavish-axi export <html-file> [--out <path>]` to write a portable copy of the artifact - one HTML file with its LOCAL assets inlined - so it opens with no Lavish server and no sibling files. Remote CDN/font references are left as links, so it needs network to render those. Users can also export from the browser chrome's overflow menu
- Do not run `lavish-axi share` or publish to another host unless the user explicitly asks for external publishing; the default and canonical review host is the homelab
- Do not run `lavish-axi stop` from a client; the persistent homelab service is shared by every review session
- Run `npx -y lavish-axi playbook <playbook_id>` for focused artifact guidance. One artifact often combines several playbooks (for example a plan that includes a comparison and a diagram), so MUST open each matching playbook before writing HTML.
- Lavish does not auto-inject any design system - artifacts stay portable so they render identically when opened directly without lavish-axi running. Before writing any HTML, decide the design direction in this strict priority order, and only move to the next step when the current one truly yields nothing: (1) if the user asked for a specific look or named design system, use that; (2) otherwise you must first inspect the project the artifact is about - the subject or product whose content or UI it represents, which may differ from your current working directory - and match that project's design system: Tailwind or theme config, shared CSS variables or design tokens, component library, brand assets, or existing styled pages. If the artifact previews, proposes, or mocks a specific app's UI, render it in that app's own design system so it faithfully shows the product, even when you are running in a different repo; (3) only when both steps come up empty, use the Lavish-recommended Tailwind CSS browser runtime v4 + DaisyUI v5, available via CDN - run `npx -y lavish-axi design` for a content-to-playbook router, a copy-pasteable CDN snippet, a Mermaid CDN snippet/init for diagrams, and the DaisyUI component reference, and prefer the Tailwind/DaisyUI CDN snippet over hand-writing styles unless explicitly instructed otherwise by the user. When you deliver the artifact, state which of the three design sources you used and why.
- Use lavish-axi when the user asks for a visual artifact, HTML explainer, interactive prototype, review surface, product or technical plan, comparison, report, or browser-based feedback loop
