# Priorities — what earns a place

Basis: **prioritised (I1–I5)**. 30 ledger rows in, 30 accounted for, 20 drawn and 10 folded or
omitted.

## Drawn, with the criterion that earned each one

| relation | criterion | why it is on the canvas |
|---|---|---|
| R1, R2 host ↔ h | I1, I5 | the only boundary crossing into the package, and the seam the whole report is about |
| R3 host → client | I1, I3 | external→external; it carries the fact that no transport ships |
| R4, R5 → models | I1, I3 | boundary crossing; carries the protocol fact (streamed response, classifier, image model) |
| R6, R7, R8 → store, chord | I1, I4 | boundary crossing plus data ownership of the schema |
| R9, R10, R11 → os, qjs | I1, I2 | boundary crossing; the machine end of the system |
| R12, R13 → schema, telemetry | I1 | boundary crossing at the demand end |
| R14, R15, R17 → s, v | I2, I4 | the primary path: commit, publish, window |
| R18, R20 → tl, cm | I2 | control path: one durable task per tool call, extension install |
| R22 cm → s | I2 | the second writer path, which a reader cannot infer from the boxes |
| R23, R24 ts → st, en | I5 | countable parallel conformance paths |
| R25 v → chord | I3 | carries the WatchHandle/ops contract |

## Folded (C2 — same hop, the label carries both verbs)

| row | folded into | why C2 |
|---|---|---|
| R16 v → s | R15 s → v | same hop; "publish; mount" carries the reverse read |
| R19 tl → h | R18 h → tl | same hop; "tool task / nested" carries both directions |
| R21 cm → h | R20 h → cm | same hop; "install / nested" carries both directions |
| R26 st → h (cache layer) | R6 s → st | the cache is an internal layer of the same commit hop |
| R27 tl → chord (buffers) | R25 v → chord | same library, same hop class; the label says Watch · ops |
| R28 cm → chord (slices) | R25 v → chord | same library, same hop class |
| R29 h → chord (contexts) | R25 v → chord | same library, same hop class |
| R3 p0 → client leg | L0 host → client | the view reaches the client only through the host's send |

## Omitted (with class)

| row | class | why |
|---|---|---|
| R30 st → store-indexeddb-global | C1 | a platform global inside one adapter; no boundary, protocol or actor information |
| tl → os (wasm read, worker thread) | C4 | second artefact of the same pull as tl → qjs (Photon) |

## Elements dropped

| element | class | why |
|---|---|---|
| TESTRUN | C3 | no call site names a runner; the kit is invoked, never invokes |
| dsqlite, didb, djsonl | C2 | three files of one medium; no relation differs, so one `store` box |
| client at L1/L1b | C2 | folded into `host`, since the package never reaches it |

## Notes on the scope

- The removed event stream has no element. 1.5.0 deleted `watchEvents()`, `AgentEvent`,
  `AgentEventStream` (`CHANGELOG.md:124`); the view is the channel.
- No transport element exists, and that absence is the finding, not a gap: zero matches for
  `node:http`, `createServer`, `WebSocket` in `dist/`.
