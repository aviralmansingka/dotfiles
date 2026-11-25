# Coverage — every ledger row accounted for

```
ledger rows: 30
  drawn:            20
  folded:            8   (C2, into named relations)
  omitted:           2   (C1, C4 — one line each)
  unaccounted:       0
basis: prioritised (I1–I5)
```

| row | disposition | level | drawn as / fold target / class |
|---|---|---|---|
| R1 | drawn | L0, L1 | `host → h` open · submit |
| R2 | drawn | L0, L1 | `h → host` callbacks |
| R3 | drawn | L0 | `host → client` view + ops (host transport), dashed |
| R4 | drawn | L0, L1 | `h → models` stream |
| R5 | drawn | L0, L1 | `cm → models` classifier |
| R6 | drawn | L0, L2 | `h → s` / `s → st` commit |
| R7 | drawn | L0, L1b | `st → store` commit |
| R8 | drawn | L0, L1b | `st → chord` store bridge |
| R9 | drawn | L0, L1b | `en → os` files · shell |
| R10 | drawn | L2b | `tl → en` files · shell |
| R11 | drawn | L0, L1b | `tl → qjs` photon |
| R12 | drawn | L0 | `p0 → libs` schema · sandbox |
| R13 | drawn | L0 | `p0 → libs` schema · sandbox |
| R14 | drawn | L2 | `h → s` commit |
| R15 | drawn | L2 | `s → v` publish; mount |
| R16 | folded | L2 | into R15 — C2, same hop, reverse read |
| R17 | drawn | L2 | `h → v` window |
| R18 | drawn | L2 | `h → tl` tool task / nested |
| R19 | folded | L2 | into R18 — C2, same hop |
| R20 | drawn | L2 | `h → cm` install / nested |
| R21 | folded | L2 | into R20 — C2, same hop |
| R22 | drawn | L2 | `cm → s` journal |
| R23 | drawn | L2b | `ts → st` conformance |
| R24 | drawn | L2b | `ts → en` conformance |
| R25 | drawn | L0, L1 | `v → chord` Watch · ops |
| R26 | folded | L2 | into R6 — C2, cache layer of the same commit hop |
| R27 | folded | L0, L1 | into R25 — C2, same library |
| R28 | folded | L0 | into R25 — C2, same library |
| R29 | folded | L0 | into R25 — C2, same library |
| R30 | omitted | — | C1 — platform global inside one adapter |
| tl → os wasm | omitted | — | C4 — second artefact of the same Photon pull |

## L0's coarse arrows are summaries

| L0 edge | summarises | nothing counted twice |
|---|---|---|
| `p0 → store` commit | R6 + R7 | both are the same commit hop at two zooms |
| `p0 → chord` Watch · ops | R25 + R8 | watch seam and store bridge, one library |
| `p0 → libs` schema · sandbox | R12, R13, R11 | four libraries, two verbs |
| `p0 → os` files · shell | R9 + R10 | the machine end summarised |

## Level accounting

```
L0  · 8 nodes, 8 edges   drawn whole at 100% (83x25)
L1  · 11 nodes, 5 edges  drawn whole at 100% (95x22) — pans a little past a 77-col pane
L1b · 12 nodes, 4 edges  drawn whole at 100% (57x33)
L2  · 8 nodes, 7 edges   drawn whole at 100% (106x18) — pans past a 77-col pane
L2b · 8 nodes, 4 edges   drawn whole at 100% (77x22)
canvas 106x150
```
