# Rendering core — CI test suite

## Purpose

This suite guards the work-step renderer in
`pi/.pi/agent/extensions/tool-call-renderer-public.ts` and the `/usage`
dashboard in `pi/.pi/agent/extensions/usage.ts`. The renderer owns every
tool row: call row, collapsed summary, and expanded body. Bugs shipped to
the user many times while the suite stayed green. The suite now proves the
shapes that broke, by behavior only.

## What the suite covers

- R1 Command rows. The suite checks the heredoc and quote state machine:
  single, double, and unquoted tags; `<<-`; tag plus operator on one line;
  quote state after a close; `&&`, `||`, `|`, and carried operators; `;`
  without a split; backslash wraps inside heredoc bodies; a `#` inside a
  heredoc body never lifts to a title.
- R2 Intent titles. A leading comment lifts to the row title. A title-less
  live row with complete args backfills one model request per tool call id.
  Bash, powershell, python, and mcpScript backfill. mcpScript skips
  `@options` lines. `tool_result` stores the title as `intentTitle`; a
  reload reseeds it and never requests.
- R3 Ownership. Connected, file, output, inspection, pedagogy, receipt, and
  MCP tools never delegate. Other tools keep our shell and collapsed row and
  pass only the expanded body downstream.
- R4 Truncation and fold. Blank input never yields an empty row set. Output
  folds 30 head plus 30 tail past 60 lines. `ls` and `find` read their
  limit and truncation fields. The suite checks no invented fields.
- R5 Theme sync and caches. `initTheme` runs on each new theme name. Render
  caches key on source, args, and theme. A theme change invalidates them.
- R6 Details contract. An error without `isError` still renders as an
  error. A `status` of `failed` renders as an error. `launched: false`
  stays a success. Zero results render dim, not red. Partial updates show
  `running`. Escapes strip from output. A wrap failure falls back to a
  truncated row.
- R7 Shortcut orthogonality. Ctrl+Q hides command bodies by default. Ctrl+O
  never reveals a hidden body. Hidden rows show the muted title and dim
  line counts. Failed rows keep full error color while hidden.
- R8 Width sweep. The suite renders every custom component at widths 20
  through 80, and no line exceeds the width. The `/usage` suite sweeps the
  same range and drives the real `usage.ts` functions, not a copy of the
  math.

## How to run

Run from the repo root. Set the CI environment first, then run:
```sh
npm install --prefix /tmp/ren-jiti jiti@2 typebox@1.3.27
export JITI_PATH=/tmp/ren-jiti/node_modules/jiti/lib/jiti.cjs NODE_PATH=/tmp/ren-jiti/node_modules
node pi/.pi/agent/extensions/tool-call-renderer-public.test.mjs
node pi/.pi/agent/extensions/usage.test.mjs
```

The suites `thinking-title`, `web-fetch`, and `web-search` run the same way:
jiti alias stubs, no network, no TTY, no pi install.

## Runtime and SLA

- `tool-call-renderer-public.test.mjs`: about 2.3 s (two 1.1 s clock
  waits). Other suites stay under 0.1 s each. Whole domain: under 3 s.

## Coverage result

Measured with c8 and `JITI_SOURCE_MAPS=true`:
- `tool-call-renderer-public.ts`: 97.1 % statements, 90.4 % branches, 99.0 %
  functions. Before this pass: 97.1 %, 89.8 %, 99.0 %.
- `usage.ts`: 99.6 % statements, 82.5 % branches, 92.0 % functions. Before
  this pass: 0 % — the old test never imported the module.

## Known gaps

- The heredoc scanner lives in three modules (renderer, `python.ts`,
  run-command). A shared scanner is deferred; do not merge them here.
- Some uncovered lines are map artifacts from the jiti transform: braces
  and comment lines report zero while the code runs. Do not chase them.
- The `usage.ts` branch for empty future cells depends on the run date. A
  run on the last day of a week leaves it cold.
- Keep the renderer suite in one file. Split per family only when it slows
  past the 5 s limit.
