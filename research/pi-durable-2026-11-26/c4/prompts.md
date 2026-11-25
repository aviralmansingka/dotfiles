# Scout returns

Four `scout` runs, all read-only, launched from the session cwd with the package path absolute.
The element, relation and boundary tables are merged into `ledger.md`; the level assignment is
in `generation.json`. This file keeps what the scouts decided and where they corrected each other.

## Scope

Anchor `package.json:1-12`. 26 member rows, 12 externals, 7 actors, 11 entry points, 6 store
targets. Its open questions that mattered: Chord ships transports the package never imports;
`photon` and `diff` are ordinary npm deps; the tarball carries no `src/`, `test/` or `docs/spec.md`,
so every citation is against `dist/`, README or CHANGELOG.

## Relationships

First run: provider connect timeout, no output. Retry with a tighter scope (three files, then
`dist/` greps) returned 71 rows. Two findings carried the diagram:

- Zero matches in `dist/` for `node:http`, `node:https`, `node:net`, `WebSocket`, `fetch(`,
  `.listen(`. No `rpc`, no `createServer`, no CBOR.
- The host seam is not one callback but eight typed ones: `HostCallback = now | settings |
  registry | env | models | setTimer | onWake | telemetry` (`dist/types.d.ts:110-116`).

## Boundary

Verified correction to my own brief: `ConversationView` is assembled in `dist/harness/view.js`
(`advance()` at 188, window at 35-45, mount at 109) — Chord supplies `Watch` and the delta ops
only. The boundary is the `exports` map plus `files`: members are the runtime, view/transcript,
env contract + NodeExecutionEnv, tools/codemode/tool-search/images, eight storage subpaths, and
`./testing`. Neighbours: Chord, pi-ai, pi-codemode, pi-schema, pi-telemetry, photon, diff, the
host, the transport, the renderers, pi-env, providers, the OS, unsupported databases.

## Levels

Proposed L0, L1, L1b, L2 with no L2b, and justified L1b by one measurement: 10 of 11 externals
attach at one end, Chord attaches at both, so one L1 needs a corridor from the view seam down to
the adapter band. Its L2 claim — eight members, nine relations, max band span 1 — was correct
about ranks and wrong about route density; see `generation.json` deviations.
