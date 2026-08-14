# Artifact QA

Run these checks against the final local file and again against the served page.

## Content and structure

- Confirm the title, main heading, opening decision/question, evidence labels, acceptance headline, and footer all describe the intended subject.
- Search for scaffold phrases such as `Evidence-to-artifact`, `Replace`, `Example`, and placeholder brackets; none should remain unless intentionally part of the topic.
- Confirm exactly one `h1`, logical heading order, semantic tables, and useful link text.
- Verify claims against the cited code, notes, commands, or measurements. Label inference, proposal, and uncertainty explicitly.

## Diagram and accessibility

- Every SVG has `viewBox`, `role="img"`, `aria-labelledby`, a unique `title`, and a useful `desc`.
- Every marker, title, and description ID is unique within the page.
- A visible legend immediately follows or sits beside each diagram.
- The legend explains node roles and line styles in words; color is never the only signal.
- Keyboard focus is visible for links and controls. Images, when present, have useful `alt` text.

## Desktop browser check

At a desktop width around 1440px:

- Read the page from top to bottom; do not accept a screenshot alone.
- Confirm the hero hierarchy, card alignment, table headers, SVG labels, and legend are legible.
- Check for overlapping boxes, crossed labels, truncated paths, clipped shadows, accidental whitespace, and inconsistent accent meanings.
- Confirm the first diagram answers one question without requiring the evidence table.

## 390px mobile check

At exactly 390px wide:

- Confirm `document.documentElement.scrollWidth <= document.documentElement.clientWidth`.
- Confirm hero, summaries, legends, roadmaps, and decision cards collapse to one column.
- Confirm both panel-header labels become separate blocks with non-overlapping bounding boxes.
- Confirm only the diagram/table wrapper scrolls horizontally; the page itself must not.
- Scroll each wide wrapper to its far edge and verify no diagram node, label, or table column is clipped.
- Check that the terminal title hides, command text truncates intentionally, jump links remain reachable, and body text never becomes an unbroken horizontal strip.

Use a DOM overflow probe to list unexpected offenders rather than relying only on visual intuition:

```js
(() => ({
  rootOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  offenders: [...document.querySelectorAll('body *')]
    .filter((el) => {
      const style = getComputedStyle(el);
      return el.scrollWidth > el.clientWidth + 1 &&
        !['auto', 'scroll'].includes(style.overflowX);
    })
    .map((el) => el.className || el.tagName)
}))()
```

Treat intended text ellipsis as intentional only when the full value is available elsewhere or is non-essential terminal chrome.

## Served and remote proof

1. Run the plain homelab render command and capture its returned stable `alias_url`.
2. Confirm the command returns an `artifact_context`, and verify its live Herdr workspace label starts with `Artifact-`,
   its agent runs from the isolated homelab worktree, and its branch matches the local source branch.
3. Open the exact alias URL and recheck the artifact title, `h1`, diagram, legend, and acceptance headline inside the
   artifact frame. HTTP 200 alone is insufficient.
4. Confirm the fixed top-right **Ask about this** button opens a keyboard-accessible right-side drawer. Ask one bounded
   question and verify the answer appears in that same drawer from the artifact's Herdr agent.
5. Run **Check changes** and confirm it reports the pushed baseline, Git status, and whether the artifact changed since
   launch. Capture worktree status before and after and verify the check itself staged, committed, pushed, or changed
   nothing.
6. Compute SHA-256 for the local HTML and the framed artifact response at `<alias>/__artifact/content/`; they must match
   at launch. The alias root is the chat shell and is intentionally not byte-identical to the standalone HTML.
7. Re-run the 390px overflow probe inside the artifact frame and inspect the full-width mobile chat drawer separately.
8. Report the verified URL and whether desktop, mobile, structure, accessibility, chat, Herdr identity, delta, and framed
   checksum checks passed.

If the homelab is unavailable, keep the artifact local and report that delivery is incomplete. Do not configure Tailscale Serve on the client.
