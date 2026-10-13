# mermaid — CI test doc

## Purpose

This suite guards the `mermaid` tool in
`pi/.pi/agent/extensions/mermaid.ts`. The tool takes a diagram as data,
emits canonical source, and runs three local gates: strict parse with
`mmdflux`, a structure diff, and a `grok-mermaid` pane-fit render.

Version 1 shipped wrong architecture. Its unit tests passed, but real calls
took 8.5 minutes and failed 67 percent of the time. Version 2 adds a corpus
harness as a manual gate.

## What the suite covers

- `validateParams`. It rejects unknown types and names the supported list.
  It rejects double quotes in every label slot. It checks ids, members, and
  endpoints per type.
- `emitMermaid`. It asserts the exact form per type. Subgraph members keep
  their labels. `classDiagram` emits class names, not param ids. Newlines
  become `<br/>` in boxes and spaces in sequence lines. Relation kinds map
  to exact arrows.
- `diffStructure`. Reversed edges do not false-match. `classDiagram`
  relations may match in either orientation. `[*]` maps to the root
  pseudo-states. Invented nodes are named.
- `diffArtContainment`. Every actor label and message text must appear in the art.
- Renderer resolution. A bare `import("grok-mermaid")` cannot resolve from
  a jiti-loaded extension, which silently demoted real sessions to the
  mmdflux fallback — a renderer about 40 percent wider and taller than the
  chat's. The suite pins `grokCandidates` (PI_MERMAID_GROK override first,
  managed-install releases second, current version first) and proves a
  broken override falls through to the managed copy.
- `trimArt`. The displayed art is cut to its smallest bounding box:
  trailing spaces, blank edge rows, and blank edge columns go. Interior
  spacing stays. Width is the trimmed width, not the renderer's claim.
- `renderWithGrok`. The suite stubs the renderer. It asserts the crash,
  no-art, and good-render shapes.
- Width policy. `paneWidth` reads `PI_MERMAID_WIDTH` first. Values under 40
  are ignored. Fractions are floored. Stdout columns lose 4 pane columns.
  Wide-but-fitting beats narrow: the tool guidance prefers a wide diagram
  that fits the measured pane over a forced-tall one.
- Execute paths. The suite runs the tool with fake `mmdflux` binaries. It
  asserts success, the LR-to-TD re-emit on width overrun, and every
  rejection: parse bug, mismatch, warnings, crash, environment failure,
  and abort. Each error names its retry rule.
- Transcript rows. A delivered diagram sends one custom message. Collapsed
  rows show the art. Expanded rows add the fence.
- Real `mmdflux`. When the binary exists, the suite round-trips every emitted
  type. It skips this section when the binary is absent.

## How to run

```
npm install --prefix /tmp/mm-jiti jiti@2 typebox@1.3.27
export JITI_PATH=/tmp/mm-jiti/node_modules/jiti/lib/jiti.cjs
export NODE_PATH=/tmp/mm-jiti/node_modules
cd pi/.pi/agent/extensions && node mermaid.test.mjs
```

The suite stays offline and deterministic. It stubs `grok-mermaid` and pins
it as the first resolver candidate via `PI_MERMAID_GROK`, fakes `mmdflux`
through `PI_MERMAID_MMDFLUX`, and restores every environment variable in a
`finally` block. The unavailable path also points
`PI_MANAGED_INSTALL_ROOT` at an empty temp tree so the host's real managed
copy cannot leak into the test.


## Runtime and SLA

The suite runs in about 0.45 seconds. The budget is 5 seconds. The runtime
stays flat because only short shell fakes spawn.

## Coverage result

`c8` reports the suite against `mermaid.ts`: statements 94.6 percent
(baseline 90.7), branches 81.2 percent (baseline 65.8), functions 100
percent (baseline 90.9).

```
/tmp/mm-cov/node_modules/.bin/c8 --reporter=text \
  --include='mermaid.ts' node mermaid.test.mjs
```

## Known gaps

- `mermaid.corpus.mjs` stays a manual, local gate. It needs the real
  `mmdflux` and the real `grok-mermaid`. It never runs in CI. The unit
  suite pins only its skip behavior: without the binaries it exits 2 with
  a message, not a stack trace.
- The "no mmdflux candidate at all" branch needs a host without any binary.
  The suite cannot fake all three candidates, so it stays uncovered.
- The `mmdflux` timeout branch needs a 30-second wait. The suite does not wait.
- The corpus `gates` mode needs a historical fence corpus. Build one before
  a merge that touches the emitter.
