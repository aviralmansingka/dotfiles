# CI tests — user input, quiz, explain, ask

## Purpose

This suite guards the user-input panels of the pi extensions: the tools
`ask_user_question`, `quiz`, and `explain`. Each test runs offline with
fake modules only. No test touches a real editor, pane, or network.

## What the suite covers

- **U1 Option wiring.** Digit keys select and submit in single-select ask.
  Digit keys toggle in multi-select ask and quiz. In single-select quiz, a
  digit key selects; Enter submits. `j` and `k` move the cursor, in plain
  and Kitty CSI-u form. Literal `j` and `k` stay as text in every editor
  mode. All four panels show the number and navigation hints.
- **U2 Input modes.** Tab cycles Answer and Steering. The question stays
  visible in Steering. Enter on an empty steering buffer does nothing. A
  steering submit ends the quiz with a visible `follow-up` result. The
  steering editor keeps its text on Enter. Ctrl+P works from both modes.
- **U3 Explain key routing.** Bare `h` opens the node view only when the
  answer field is empty or in the verdict phase. Once the learner composes
  text, every `h` is text; this state is sticky. `H` (Shift+H) opens the
  journal at every phase. Plain and Kitty encodings work. Alt is not
  routed. A failing open warns. It never throws.
- **U4 Prompt frame.** Every prompt row keeps one column of padding on
  each side, so content can not touch the borders. The two boxes merge at
  a tee row. The prompt box always shows a content row. Below 24 columns,
  the frame drops to borderless padded rows.
- **U5 Context files.** The quiz schema carries `contextFiles`. The `o`
  hint joins with the other hints. The `o` key opens exactly the listed
  files: it trims paths and drops empty ones. A failed open sends a
  warning notice. It never throws into the quiz.

The suite also pins the quiz result statuses: `answered`, `too-hard`,
`dontKnow` (Other), `follow-up`, `cancelled`, `unavailable`. It pins the
grader prompt contract: the answer travels verbatim, and no `reasoning`
key leaks. The quiz `renderCall` never shows the answer early.

## How to run

```sh
npm install --prefix /tmp/ui-jiti jiti@2 typebox@1.3.27
export JITI_PATH=/tmp/ui-jiti/node_modules/jiti/lib/jiti.cjs
export NODE_PATH=/tmp/ui-jiti/node_modules
for t in pi/.pi/agent/extensions/user-input/*.test.mjs \
         pi/.pi/agent/extensions/quiz-*.test.mjs \
         pi/.pi/agent/extensions/explain.test.mjs; do node "$t"; done
```

CI finds these files by glob (`**/*.test.mjs`). Do not add a hand list.

## Runtime and SLA

Each file runs in under 0.2 seconds on this host. The full set runs in
under 1 second. The SLA is 5 seconds per file and 30 seconds for the set.
The tests never sleep. One `setImmediate` tick lets fire-and-forget
promises settle. This stays deterministic.

## Coverage result

Coverage comes from `c8`, with `--include` on `user-input/**`, `quiz.ts`,
`explain.ts`, and `ask-user-question.ts`. Collect one run per file into a
temp directory, then merge with `c8 report`. One process that loads a
module through two jiti instances loses attribution.

- `user-input/**`: 100% lines, 100% branches.
- `quiz.ts`: 95% lines, 89% branches.
- `explain.ts`: 93% lines, 75% branches.
- `ask-user-question.ts`: 93% lines, 86% branches.

## Known gaps

- The plan row U3 names `alt+h`. The current design routes `H` (Shift+H)
  instead, because the window manager owns the Alt key. The suite pins the
  current design: Alt goes to the editor as text.
- The plan row U2 names a note mode. The quiz has Answer and Steering
  modes only. The suite pins the current two-mode cycle.
- `explain.ts` keeps some uncovered render branches with no new logic.
- The real `matchesKey` lives in pi-tui. The tests use a faithful fake.
  Its extra modifier branches belong to pi-tui, not to these extensions.
