# Independent critique: modal-runtime, round 11

**Verdict: FAIL.** All eight component names and arrow geometries are present, but the worker seam's required **gRPC** qualifier is absent and four labels cannot reliably be assigned to their arrows from the capture. In addition, the frozen dataset manifest hash does not match the actual manifest bytes. The latter is an evidence blocker, not proof of an altered case source. A known semantic failure takes precedence over a blocker in the overall status.

Paths in this critique and the result's inventory are relative to the repository root. Coordinates are 1-based `[column,row,width,height]` in frame 0 of the pinned 77×47 dumps, not the live 82×51 pane. The blind record `docs/visualize-eval/rounds/11/reviews/modal-runtime/observed-first.md` was saved before expectations were revealed; SHA-256 `86ae44045f51ff5d5ccfbe6b2577f0c20d54437f629c431075a923792bca0573` was reverified unchanged. The three sorted spec-path/hash pairs are in `spec-manifest.json`, SHA-256 `3de5ff572658a0a075d66d29311e206141edeab80cc465c2c2b8781bc31e5e97`.

## Category matrix

| Category | Decision | Evidence and scope |
|---|---|---|
| semantic_fidelity | **fail** | 8 components and 8 correctly oriented routes; worker gRPC omitted, and v1/v3 shared-gutter labels are not reliably owned. |
| arrow_traceability | **pass** | All 8 stems, turns, and arrowheads independently traceable; no visible crossing, bridge, shared junction, or unnecessary loop. This evaluates route geometry; label ownership separately fails semantics. |
| layout_fit | **fail** | Pinned final specs all physically fit 77×47 at natural 100%, but the category also requires complete readable source coverage, which the missing gRPC qualifier and uncertain labels defeat. |
| conceptual_grouping_color | **pass** | Final logical tags form four distinguishable related hue families; no group box/title is painted. Source names concepts, not explicit ranked tiers. v2's source-listing reversal is disclosed; a relation's position in the source list alone does not establish a semantic tier. |
| category_fit | **pass** | Closest family **service-meshes**; stated family same. The source and captures show a core fan and anti-parallel pair. Pair co-viewed, chain-like secondary ranks visible, split and fan-order deviations recorded with reasons. The round-11 softened rule treats classification as a hint; the known semantic defects still fail their own categories. |
| border_integrity | **pass** | Normal and selected ANSI establish complete, color-continuous sides and corners for 10/10 node occurrences; selected capture is simultaneous select-all, not proof of separate interactive selections. |
| workflow_evidence | **blocked** | `cases.json` actual SHA-256 disagrees with frozen `metadata.json`'s `cases_sha256`; dataset identity is unresolved. Case source, expected and variants hashes do match their individual frozen values. Blind identity, other frozen hashes, 28 record raw hashes, and manifest artifacts verified. Offline validators pass for all views. |
| animation | **N/A** | `cases.json` and `expected.json` mark it optional; source does not request animation. All five 0–400 ms frames per view show no dots. |

The generator's verbatim stated line is in `generation.json` under `step0_classification`: `family: service-meshes`; `evidence: modal-runtime is the core of a 3-branch RPC fan (worker e1/e2, task engine e3, modal-daemon e8) and the source states an explicit anti-parallel pair between the same two boxes: worker -> runtime "task input + control RPCs" and runtime -> worker "events + management RPCs".` Its secondary flow-chain recipe is named and visible in v3. The single-frame fan yielded after an 8-node overview and three four-node shapes produced, respectively, excess height/skipped label/ambiguous owner, ambiguous labels, skipped labels with a bridge, or skipped label with bridges/touching bends. These are measured failed attempts, not proof that every conceivable configuration is impossible. The v2 node-order probe rendered identically when declarations changed; an edge-order variant was not tested. This recorded reason is sufficient for the softened category-fit decision, not a waiver of independent semantic or layout gates.

## Per-edge audit

`source.md` lists historical graph relationships and fixed constraints; `expected.json` characterizes these as historical generated relations, not independent fact verification. No extra apparent relationship is seen.

| ID | Expected and visible route | Decision |
|---|---|---|
| e1 | worker → runtime, task input + control RPCs, worker seam gRPC. Upper straight route ends ◀ [38,23]; label `task input + ctrl RPCs` [29,27,22,1]. | **fail:** absent gRPC; shared gutter cannot uniquely assign label. |
| e2 | runtime → worker, events + management RPCs, same worker gRPC seam. Lower straight route ends ▶ [41,25]; `events + mgmt RPCs` [30,28,18,1]. | **fail:** absent gRPC; shared gutter cannot uniquely assign label. |
| e3 | runtime → Task engine, `dispatches tasks`. Lower v2 route ends ▶ [49,26], label [31,26,16,1]. | pass |
| e4 | Task engine → Container backend, `starts / manages`. Left v3 route ends ▼ [26,22], label [22,20,16,1]. | **fail:** label ownership uncertain in shared upper gutter. |
| e5 | Container backend → Task container, `runs user process`. Lower left route ends ▼ [32,30], label [28,28,17,1]. | pass |
| e6 | Task engine → Filesystem + volumes, `mounts / snapshots`. Right v3 route ends ▼ [49,22], label [19,19,18,1]. | **fail:** label ownership uncertain in shared upper gutter. |
| e7 | Filesystem + volumes → Blobnet, `image + volume data`. Lower right route ends ▼ [48,30], label [51,28,19,1]. | pass |
| e8 | runtime → modal-daemon, `filesystem HTTP over UDS`. Upper v2 route ends ▶ [48,21], label `fs HTTP over UDS` [30,22,16,1]. | pass: `fs` and UDS are recognizable abbreviations; the HTTP-over-UDS seam is visible. |

Every route has its own stem and arrowhead and none is merged. The v1 arrow rows 23 and 25 sit above both label rows 27 and 28. The v3 labels occupy rows 19 and 20 to the left of two neighboring vertical stems at columns 38 and 40; those routes separate at row 21, and the top label belongs to the right branch, not the left. In both cases the check's `0 ambiguous owners` is not persuasive visual evidence. The disclosed v1 vertical and un-slotted horizontal trials failed, but do not prove no unambiguous option exists. No demonstrated unambiguous alternative for the v3 pair is recorded. The stated exception for proven impossibility is therefore not established.

## Defects, blockers, and evidence gaps

- **Critical defect F1 — missing protocol:** `RPCs` is not a synonym for `gRPC`. The fixed constraint explicitly distinguishes worker gRPC from filesystem HTTP over Unix-domain sockets. Spec or generator ledger claims cannot replace the missing visible qualifier.
- **High defects F2–F3 — label ownership:** pair and upper engine labels share gutter bands; 4 labels are uncertain despite clean checks. Source meaning is not fully readable without consulting the ledger.
- **Evidence blocker F4 — frozen dataset identity:** `metadata.json` says `e69179e59a3d36985cd7e8672b319b566701f88caef385c9cbde76d060c92d05`; actual `cases.json` is `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05`. Do not silently substitute one for the other. The actual file still says this case's animation is optional; the case-specific frozen hashes match. Resolve the mismatch independently.
- **Evidence gap F5 — discarded hue collision:** generator says `storage` and `agents` both map to hue family 1. Agents' green is proven in final ANSI, but the superseded storage capture is plain text and cannot prove its border color. Final `volumes` purple versus agents green is proven and distinct. This gap concerns the claimed regression, not a demonstrated collision in the shipped views.
- **Evidence gap F6 — shortening test:** `ctrl`/`mgmt` shorten source words despite v1's reserved label slots. No recorded full-word attempt in the shipped geometry proves whether a full label would be placeable. Do not assert that it fits merely because it fits within the viewport; renderer label placement may constrain it.
- **Disclosed deviation:** v2 daemon label [50,21,12,1] precedes engine [51,26,11,1] visually, opposite the e3-before-e8 source listing. Its specific measured explanation and untested edge-order option are recorded; this is not treated as an independently mandated semantic ordering.
- **Capability/workflow limitation:** capture shell-start race and 82×51 panes required retries and pinned dumps; manifests confirm captured pane closure, while the nine manual diagnostic pane closures are generator-reported. No reviewer pane was launched.

## Fit, evidence and correction candidates

Pinned files for the **final** v1, v2 and v3 specs each explicitly report `viewport: 77x47 zoom: 1.00 natural`, with no overflow banner. Extents reported by checks are 44×7, 59×9 and 66×20; all graph content is physically visible. Live viewer headers show 82×51 @100%; the pinned v3 viewer chrome truncates `q quit` to `q`, not a graph label. No crossings, bridges, or touching bends are visible; all checks report zero. The `routes:` line is absent as expected for this renderer. All 28 log records' stdout/stderr hashes and each recorded capture-manifest artifact hash matched the stored bytes; rerunning the offline validator yielded all checks passed on all three bundles. This does not establish semantic correctness.

Potential **skill-level** corrections: make explicit protocol qualifiers part of the visual coverage ledger, never treat generic RPCs as gRPC, review ownership against competing nearby routes rather than trusting the check alone, and test full-word labels before abbreviation. Preserve the measured yield with its caveats. Potential **renderer-level** candidates: improve label-to-route assignment and its ambiguity diagnostics for shared gutter bands, and investigate name-hash hue collision using actual ANSI captures; the latter is not verified here. These are proposals only, not changes or attribution of an observed renderer gain.
