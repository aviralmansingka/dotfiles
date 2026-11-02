# Independent Sol critique — modal-machine-manager, round 03

## Verdict: FAIL — not green

| Fixed category | Decision | Main reason |
|---|---|---|
| `semantic_fidelity` | **fail** | All 17 components and all 23 directed endpoint pairs survive, but `verify reimage` loses its object, `pull boot image` loses its verb, and the diagnostics label has an uncertain visual owner. |
| `arrow_traceability` | **fail** | Static stems/heads are readable, but 20 directly observed frame-0 dots start one cell late, which expressly fails the round-03 direction rule. The diagnostics label can attach to the wrong S3 input. |
| `layout_fit` | **fail** | All four target captures visibly fit at 77×47 and 100%. The one v4 crossing is nevertheless avoidable without reordering any source group or deleting a relation. Independent live-pane columns/rectangles are also missing; that gap does not erase the crossing failure. |
| `conceptual_grouping_color` | **pass** | Captured hue families and proximity follow control, APIs, jobs, providers, machines, state, and humans rather than geometric depth. |
| `border_integrity` | **pass** | ANSI establishes complete, color-continuous normal and selected borders for all 26 node occurrences. |
| `workflow_evidence` | **blocked** | Hashes, identities, blind-first ordering, captures, windows, and cleanup attestations exist; exact expanded execution commands, separate stderr/empty-stderr records, independent pane rectangles, raw cleanup probes, and complete target-size labeled frame 0 do not. |
| `animation` | **fail** | Twenty directly observed origin offsets; no visible arrowhead arrivals; all 24 route occurrences have zero visible dots at 2000 ms. Short routes disappear earlier. |

Result: **2 pass / 4 fail / 1 blocked**. Animation is applicable, not N/A. A known failure remains fail despite missing evidence. All 23 required-edge audit rows fail their complete animated contract; this does **not** mean all 23 static endpoint pairs are missing or reversed. There is also one audit of an extra *apparent label meaning*, not an additional drawn stroke.

No viewer, new pane, installation, fix, commit, or subagent was used for this review. All locations are 1-based `[column,row,width,height]` within the referenced capture/frame.

## Identity, freeze correction, and artifact paths

- Generator: **`viz-ds03-6`**, model **`fireworks/accounts/fireworks/routers/deepseek-flash-latest`**. The worker label is corroborated by frozen metadata; the generator bundle identifies its fresh generation role/model and says it did not judge itself.
- Reviewer: **`viz-judge03-machine-manager`**, actual model **`openai/gpt-6.1-sol`**. No identity was substituted or falsified.
- Round field in the result is integer **`3`**.
- Evidence inventory paths are relative to repository root `/Users/aviral/.herdr/worktrees/dotfiles/fix-visualize-skill`. Source references use repository-relative filenames with JSON pointers or section fragments. The external executable remains at `/tmp/visualize-eval/round-03/bin/rataflow-view`; its actual bytes were hashed directly, while repository-local `bin.sha256` files and manifests witness that same hash.

### Reviewer-identity correction episode

The captain disclosed that the frozen rubric's `required_reviewer_model` and embedded result-schema reviewer const still named the round-01 identity `openai/gpt-6-astra`. Before any reviewer-result JSON existed, those identity fields were corrected to **`openai/gpt-6.1-sol`**, the rubric was rehashed, and metadata was updated. Revision 4 and `metadata.json.frozen_input_corrections` preserve that episode. Criteria and thresholds were not weakened. I emit the true Sol identity and the corrected, actually verified rubric hash.

The `workflow_evidence.pass_iff` prose still contains the older Astra name. I do not pretend that text is absent, nor treat it as authority to falsify my identity: the explicit corrected model field/schema, revision note, and captain's instruction resolve that clerical residue in favor of Sol. This is disclosed rather than silently edited. No round-01/02 verdict contributes evidence to this review.

### Verified hashes

| Item | SHA-256 |
|---|---|
| Frozen candidate `rounds/03/SKILL.md` | `cf796bcdc527897687ec2ca19844f399c921252409b9ca7ad04fbfa1b6cc659c` |
| Frozen executed renderer | `b242b6a28e2e27934b06b7a297be638c143e5c99680495e104380cd8d9ee80f7` |
| Corrected frozen round-03 rubric | `5519fd84f6b75973dbf7b5f5544c909a8f32a8841a876c8e7af00a1fcb119335` |
| Dataset manifest `cases.json` | `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05` |
| This case `source.md` | `a41065d9ceca1ed035bfd6282f0e937abbd0034ad497a33637a76f2d8a9ebab3` |
| This case `expected.json` | `c6d14814bcfa0f41e7401df3b57ea1400e15050b9fb4db3d2e12980d6fde9764` |
| This case `historical-variants.json` | `22f00c085b50f218115610ed1580e89f4c0a94d39f8ecf83c80d6712116a06b2` |
| Final-spec manifest | `b11f05ae40e52b0c0afa7905bc799943d101a066a119d7e7689768dfbc14557b` |
| Immutable blind record | `dbe209aa8828d9352d8713ebe34386932c91263c16eb68c1d42678dc6752f2f1` |

All these hashes were computed from actual files and matched the relevant frozen metadata. All ten saved attempt hashes matched `attempts.json`; all final spec and binary hashes matched every per-view manifest; all seven manifest-listed artifacts per view matched their recorded hashes. The final-spec manifest consists of four sorted repository-relative path/SHA-256 pairs. Its hash, not a concatenation chosen after judging, is `spec_sha256` in the result.

`observed-first.md` completed stage A before this reveal. It is inventoried with its original hash, and `observed_first.saved_before_expected_reveal` is **true**. I did not change it. Stage-B category judgments below apply the newly revealed criteria to those saved observations; they do not rewrite them.

## Source scope and complete cross-view coverage

I read the permitted source excerpts, expected data, historical variants, rubric/schema, round metadata, dataset manifest, and this case's candidate workflow/evidence. I did not open unrelated chat, credentials, other case bundles, or earlier rounds.

The architecture relations are explicitly historical generated claims, **not independently fact-verified Modal architecture**. I assess fidelity to this qualified source and its human corrections, not external architectural truth. Historical assistant simplifications do not override the fixed requirement for all original 17 components and 23 relations.

The latest human motion end state is slow, sparse motion with **one live dot per line**. The strengthened round-03 rubric additionally requires the first drawn edge cell as the origin and visible simultaneous arrowhead arrival. Earlier numeric speed values are not permission to waive those later rules. `gcore sync, 1 min` denotes a semantic operation cadence, not permission to give that visual dot a different traversal duration.

### Components

All 17 original concepts appear as their own readable nodes:

- v1: `Modal control plane`, `humans + mmctl`, `private gRPC`, `webapi server`, `River job queue`, `provider registry`, `bare-metal providers`.
- v2 adds `bare-metal machines`, `boot server`, `machine-agent`, `public gRPC`, `Postgres`.
- v3 adds `SSH + BMC ops`, `janitor app`, `S3 object store`, `Slack`.
- v4 adds `cluster reconcile loop`.

Repeated node labels explicitly bridge the splits: providers connect v1 to v2/v4; queue, webapi, machines, private/public gRPC, and Postgres connect their associated chains. Provider registry and machine-agent were **not silently dropped**. Counts are 7+6+7+6 = **26 node occurrences** and **17 unique components**.

### Every required relation

The JSON contains a full stem-to-head polyline, label location, crossing/junction account, source references, and finding IDs for each of the following. `D` means directly visible offset in labeled supplementary frame 0; `T` means position visible only in an untimestamped target-pane predecessor; `?` means no frame-0 position. A static coverage success does not waive a known motion failure.

| Source edge | Actual visible view edge(s) | Static endpoint/label assessment | Origin evidence |
|---|---|---|---|
| e1 control plane → private gRPC: create / terminate / repair | v1.E2 | Direction and all three verbs readable | T |
| e2 humans + mmctl → webapi: http | v1.E1 | Readable | T |
| e3 private gRPC → River: enqueue job | v1.E4 | Readable | D |
| e4 webapi → River: reinstall / reprovision | v1.E3 | Both actions readable | D |
| e5 River → registry: provision job | v1.E5 | Readable | D |
| e6 registry → providers: provider API | v1.E6 | Readable | D |
| e7 providers → machines: allocate instance | v2.E1 | Readable in target pane; cropped from complete-frame dump | ? |
| e8 machines → boot: iPXE request | v2.E2 | Rightward `▶` is present | D |
| e9 boot → machines: boot.ipxe + S3 args | v2.E3 | Full response payload and leftward `◀` are present | D |
| e10 machines → machine-agent: runs on host | v2.E4 | Host/agent relationship readable | D |
| e11 machine-agent → public gRPC: register + heartbeat | v2.E5 | Both actions readable | D |
| e12 public gRPC → Postgres: machine state | v2.E6 and v4.E5 | Readable twice; not an invented extra relationship | T in v2, D in v4 |
| e13 private gRPC → Postgres: machine rows | v4.E3 | Readable, including upward approach jog before final down head | D |
| e14 River → Postgres: job rows | v4.E4 | Readable through the bridge crossing | D |
| e15 River → SSH/BMC: audit / verify reimage | v3.E1 | Endpoint pair readable; `reimage` absent from label | D |
| e16 SSH/BMC → machines: run machine-audit | v3.E2 | Readable | D |
| e17 machines → S3: pull boot image | v3.E4 | Endpoint pair readable; `pull` absent | D |
| e18 River → S3: diagnose uploads | v3.E3 | Stroke readable; diagnostics label visually favors the other S3 input | D |
| e19 River → janitor: diagnostic events | v3.E5 | Readable | D |
| e20 janitor → webapi: proposed actions | v3.E6 | Proposal direction preserved | D |
| e21 webapi → Slack: confirm + alerts | v3.E7 | Both actions readable | D |
| e22 reconcile → providers: gcore sync, 1 min | v4.E1 | Cadence retained; bridge crosses e14 without a junction | D |
| e23 reconcile → Postgres: cluster state | v4.E2 | Readable | D |

There are 23 unique required endpoint pairs and 24 drawn edge occurrences because e12 is restated. All static stems and arrowheads can be followed in the target view. There is no source-named bus, and declaring a trunk is neither needed nor justified. Independent queue fan-out and convergent Postgres inputs remain separate ports, not fake branches. No actual extra stroke is invented. The extra apparent relation audit records only the risk that `diagnose uploads` is read as a machines-to-S3 payload on the already existing image-retrieval stroke.

### Boot response: verified, not missing

The exact string **`boot.ipxe + S3 args`** is present in v2 at **`[35,19,19,1]`**. Its response stroke goes from the boot-server side at `(45,17)` left to the arrowhead **`[42,17,1,1]`**, immediately before the machines border. The separate request goes right from `(42,15)` to `(45,15)` with `iPXE request` above it. Both directions and both payload meanings survive. I make no inference from an earlier round's verdict.

## Findings: defects versus evidence gaps

### MM-A01 — defect, high: no visible common arrival and intermittent disappearance

Evidence: per-view `vN-frames.txt`, especially `frame 20 at 2000ms`, region **`[1,1,77,47]`**; supporting complete `checks/vN-frames-full.txt`.

At 2000 ms all 24 route occurrences show their arrowheads and **zero `●` dots**. No supplied frame visibly places a dot on any arrowhead. Across the 480 route-frame opportunities in pane frames 1–20, 390 have one dot, 90 have none, and zero have multiple dots.

Target-pane totals, frames 1–20 in order:

- v1: `[6,6,6,6,6,6,6,6,6,6,6,6,6,6,2,2,2,2,2,0]`
- v2: `[6,6,6,6,6,6,6,6,6,6,6,6,6,6,1,1,0,0,0,0]`
- v3: `[7,7,7,7,7,7,7,7,7,7,7,7,7,7,5,5,5,2,2,0]`
- v4: `[5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,4,4,0]`

For example v1's four short routes have no visible dot from 1500 ms onward while its two longer queue inputs retain dots through 1900 ms. v2 routes vanish at 1500 or 1700 ms; v3 at 1500, 1800, or 2000 ms; v4 at 1800 or 2000 ms. The generator's own notes acknowledge this but call it a legibility defect rather than a rule violation. Under the revealed rubric, it **is a rule violation**. Common disappearance by 2000 ms is not common visible arrowhead arrival.

The check reports six/six/seven/five synchronized routes at 2000 ms and zero violations. **The captures contradict that claim when interpreted as rendered, visible simultaneous arrival.** They might be compatible with an internal clock or hidden dot position, but that is not the required visible finished state.

### MM-A02 — defect, high: initial dots are one drawn cell late

Evidence: all four complete dumps' labeled **frame 0**, limited to visible cells. The result inventories separate `vN-full-frame0` evidence IDs and 20 exact first-cell/dot regions.

Twenty routes directly show their dot on the **second** drawn edge cell, rather than the first after the source port. Example in target coordinates: v4 reconcile→providers starts with first edge cell `(8,18)` but the frame-0 dot is `(8,19)`; in its 80×24 dump these are `(10,6)` and `(10,7)`, region **`[10,6,1,2]`**. This is not a border dot, but it is still one cell too late. Both opposing boot routes similarly begin one cell past their first drawn cells.

Three additional offset positions are visible only in the unlabeled truncated pane predecessors: v1's control-plane and humans inputs and v2's public-gRPC→Postgres route. I retain their weaker `T` status. The allocation route has no frame-0 position in either source. Therefore:

- **Contradicted:** the universal `origins: 24/24` assertion, by 20 directly observable counterexamples.
- **Not proven:** the remaining four frame-0 cases from timestamped target-size evidence; three have supporting tails, one is absent entirely.
- **Proven true-origin starts:** zero.

The fixed arrow-traceability rule expressly says an offset dot leaves that animated arrow's direction unproven, even though its static head is correct. The sequence never shows a reversal or multiple dots, but that does not satisfy the required origin.

### MM-T01 — defect, high: diagnostics label has an uncertain owner

Evidence: v3 text/ANSI, region **`[17,31,24,5]`**, especially label **`[25,34,16,1]`**.

`diagnose uploads` starts immediately right of the machine-to-S3 vertical at column 24. The actual queue-to-S3 route is to its left at column 17 and turns through columns 17–22 in row 34. Without the JSON, a reader can attach the diagnostics payload to machine image retrieval. This is exactly the source's required distinction between River diagnostics and machine image pull. The uncertainty was recorded blind; knowing the intended owner afterward cannot cure it.

The candidate has seven placed edge labels here and none on route cells. Those checker results are true but insufficient to prove label ownership.

### MM-S01 — defect, high: `verify reimage` loses its object

Evidence: v3 label **`[25,17,14,1]`** says `audit + verify` rather than the required `audit / verify reimage`.

Spacing and slash changes do not matter, but the action object does. No target-view text expands what is verified. A meaning ledger outside the view is not an on-view abbreviation key. The source's job/audit path remains present; this is a required label-meaning loss, not a missing endpoint pair. The generator admits the full text was not retried after the spacing change that ultimately made the view fit.

### MM-S02 — defect, medium: `pull boot image` loses its verb

Evidence: v3 label **`[22,32,10,1]`** says only `boot image`.

The generator says direction carries “pull.” A directed machines→S3 line could instead describe uploading/writing an image. Direction alone cannot recover the read/pull operation, especially with the diagnostics label nearby. This localized omission still fails semantic fidelity; it is not excused by its lower severity.

### MM-L02 — defect, medium: the one crossing is avoidable without source reordering

Evidence: v4 bridge **`[31,21,1,1]`**, right-side corridor **`[55,18,5,12]`**, and row-29 corridor **`[17,29,41,1]`**.

The actual crossing is **reconcile→providers (e22) across River→Postgres (e14)**. The generator incorrectly describes it as reconcile→Postgres across River→Postgres. The hump `⌒` clearly distinguishes crossing from connection, so the current stroke is traceable; the count is correctly one.

There is a concrete geometric reason not to call it unavoidable. With every existing box, group, label, and other route held fixed, a queue route could leave its existing `(37,18)` port toward column 57, descend through that empty right-side corridor to row 29, and return to its existing `(17,31)` Postgres head along the existing sink approach. The geometric witness is:

`(37,18) → (57,18) → (57,29) → (17,29) → (17,31)`.

Column 57 is between the provider box ending at column 54 and the private-gRPC route at column 60. Row 29 from columns 17–57 is clear except for the queue route being replaced. The public-gRPC route occupies columns 12–15 there, while the private-gRPC bottom approach is in rows 30–31. The existing `job rows`, `machine rows`, and `machine state` labels stay off this corridor. The unnecessary bridge cell on e22 could then be straightened.

This is a **review-only geometric witness**, not an executed alternate sample, a claim about a renderer option, or an implemented fix. It establishes that the crossing is not forced by the source groups, band order, viewport, or other graph content. The source does not request a junction there. I do not require proof of global optimality or carry an earlier round's result; the localized avoidable pair is sufficient under this rubric. Its correction may require router capability rather than a skill-only spec change.

### MM-L01 — evidence gap, high: rendered viewport is known, actual live-pane rectangle is not

The normal ANSI stills measure **77 columns × 47 rows** each, and all numbered pane frames have `77x47 @100%` headers. No node, full label, or route is clipped or hidden by controls at that target viewport. All 26 node borders fit completely. `viewport.verified` is therefore **true**.

Separately, every manifest has `pane_cols: null`, `pane_rect: null`, `pane_rows: 47`, and `viewport_line: null`. The requested independent live-pane rectangle/column measurement is absent; `live_pane` is therefore **null**. I do not fabricate a 77-column live measurement from a header or substitute the supplementary 80×24 dimensions. This is an evidence gap, not a finding that the target graph visibly overflows. The category remains **fail** for MM-L02 rather than being downgraded to blocked by this additional gap.

### MM-W01 — evidence gap, high: incomplete execution provenance

The bundle preserves the check text, `check_exit: 0`, UTC check/capture windows, absolute binary path/hash, all final spec hashes, actual pane captures, and cleanup confirmations. It does not preserve exact expanded executed split/run/read/check/close commands with their actual argument values, separate stderr or an explicit empty-stderr record, independent live-pane rectangles, or raw close/probe transcripts. The validator command in the narrative is a template, not an expanded execution log. `attempts.json` also admits extra scratch layout probes whose inputs/results were not retained.

These missing records block complete workflow verification. I do not infer that panes were left open, that stderr contained errors, or that an unlogged command used the wrong binary. Those would be unsupported failures, not justified findings. The validator's 28/28 passing output per view confirms only its own checks; it cannot manufacture absent evidence or overrule observed motion.

### MM-W02 — evidence gap, high: full temporal coverage is at the wrong spatial viewport

All four target-pane sequences retain numbered frames **1–20**, not a complete timestamped frame 0. An unlabeled 36-line predecessor survives, missing the first 11 screen rows. The direct `checks/` dumps contain **all 21 numbered frames** but explicitly say **`viewport: 80x24 zoom: 1.00 natural`**.

I classify those dumps as **supporting-but-clipped actual-render evidence**, not layout proof and not an equivalent 77×47 full cycle. They are useful for the 20 directly visible origin counterexamples and for confirming frame-20 disappearance. They do not establish content outside their viewport. In v4 their controls even hide the reconcile→Postgres dot at frames 13–14, while the corresponding target-pane frames show it. In v3 the minimap cuts `webapi server` to `webapi s`; in v1/v2 entire upper/lower boxes/routes are absent.

The target-size viewport proof comes from the 77×47 pane sequences, normal ANSI grids, and header tokens, never from those direct dumps. Missing complete target-size origin evidence stays blocked. Known offset/arrival failures stay fail. No extrapolated frame, source inspection, or new execution repairs the gap.

## Borders, colors, crossings, and motion details that did pass

### Borders and selection

All four rounded corners and four sides are complete for every node in normal and select-all ANSI. Normal border colors are continuous per node, including sides adjacent to edge ports. Selected borders are uniformly bold **RGB `(216,166,87)`**. Coverage is **7/7 + 6/6 + 7/7 + 6/6 = 26/26 node occurrences**. The blind record lists every box rectangle, label rectangle, and normal RGB.

This proves the captured select-all state for every occurrence. It is not evidence of unobserved drag handles or every possible interactive state; none is invented or required as an extra test here.

### Conceptual grouping

Source-related pairs/triples use related hues and nearby chains:

- v1: control plane/webapi use teal shades; registry/providers use blue shades.
- v2: machines/boot/agent use teal-family borders.
- v3: River/janitor use amber shades, SSH/machines use teal shades.
- v4: reconcile/River use amber shades, private/public gRPC use teal shades.

Singleton families remain distinct. The initial node in a view uses the existing accent treatment. This does not turn the grouping into geometric-depth coloring. I impose no separate cross-view per-node hue-stability gate; the rubric explicitly excludes that requirement.

### Traceability and motion subproperties

The 24 target-view paths have 22 downward, one rightward, and one leftward arrowheads. No unrelated touching bend, shared corridor, false branch, or in-route junction is visible. Adjacent corner glyphs on short horizontal steps belong to one route. Queue fan-out and Postgres/S3 fan-in use separate ports. The single bridge at `(31,21)` is legible as a crossing, not a connection.

Dots remain on intended source-to-target route order, never multiply on one route, never visibly sit on borders, corners, bridges, or labels, and do not reverse. They dwell on repeated cells and sometimes jump up to four route cells per 100 ms on long paths. Those successful subproperties cannot waive the origin, live-count, or visible-arrival failures. No arrowhead-occupied dot is visible; in this rubric that last absence is a failure of the required endpoint state, not a virtue.

## Executed windows and cleanup records

| View | Pane | Recorded check window UTC | Recorded capture window UTC | Cleanup record |
|---|---|---|---|---|
| v1 | `w7E:pBG` | 11:16:59–11:16:59, 2026-11-02 | 11:16:59–11:17:03, 2026-11-02 | `confirmed_closed` |
| v2 | `w7E:pBH` | 11:17:12–11:17:12, 2026-11-02 | 11:17:12–11:17:16, 2026-11-02 | `confirmed_closed` |
| v3 | `w7E:pBK` | 11:17:19–11:17:19, 2026-11-02 | 11:17:19–11:17:23, 2026-11-02 | `confirmed_closed` |
| v4 | `w7E:pBM` | 11:17:24–11:17:24, 2026-11-02 | 11:17:24–11:17:28, 2026-11-02 | `confirmed_closed` |

The generation record states that pane-get failed after closure for each owned pane. The result's cleanup status `done` reflects these preserved attestations, not a new live verification. Raw probe transcripts/expanded commands are missing as noted above. The reviewer created no panes and has none to close.

## Correction candidates — not changes made

### Skill/generator-level candidates

1. Preserve action objects and read/write verbs when shortening labels. `reimage` and `pull` need on-view wording or an explicit in-view expansion; an external ledger is not a replacement.
2. Treat label ownership as a visual test, not merely `labels: placed`. Move the diagnostics label to its own queue→S3 corridor so the two S3 inputs cannot exchange meanings.
3. Reject the argument that a checker-approved disappearing dot is only a legibility defect. The actual-render full cycle must satisfy the human rule.
4. Correct the skill's internal contradiction: Step 6 both demands dots visibly at arrowheads and says no dot may occupy an arrowhead. The rubric requires visible arrival; a lower-level protective-glyph rule cannot silently waive it. This is a candidate instruction correction, not a change performed here.
5. Preserve the coverage map and the complete boot response that are working in this candidate. Do not remove short-route animation or architecture relations merely to silence motion failures.

### Renderer-level candidates

1. Derive the visible frame-0 dot from the actual first drawn edge cell, not the next eligible interior cell.
2. Make the common endpoint state visibly represent one arriving dot per route while retaining readable arrow direction. Avoid route-length-dependent early disappearance and protected-cell jumps that erase arrival. Whether that needs composition changes is a renderer question, not something proven fixed by a spec field.
3. Route the queue→Postgres edge around the available outer corridor instead of across reconcile→providers, without moving source groups or merging links.
4. Keep source/payload ownership close when placing labels on convergent inputs. “Not on a route cell” is not sufficient.
5. Align `--check` origin/synchronization assertions with the actual rendered glyph state. Internal clock/path assertions must not report a visible pass the captures contradict.

### Harness/workflow-level candidates

1. Capture a complete labeled target-size frame 0 separately or stream the whole 77×47 cycle without the approximately 1000-line recent-buffer truncation.
2. Give direct frame dumps explicit target dimensions if supported, and preserve their viewport line. Never relabel an 80×24 dump as a 77×47 pane capture.
3. Record actual live pane columns/rows/rectangle, exact expanded commands, separate stdout/stderr/exit, and raw cleanup probe results. Keep crossing probes needed to reproduce search decisions.
4. Keep the disclosed reviewer-identity correction history and remove stale identity prose only in a properly labeled future baseline, not by changing this evaluated evidence.

These are proposed responsibilities, not implemented repairs. Renderer gains must not be credited as skill-only gains. The current source tree is not used as a substitute for the frozen binary's executed evidence. The captain must gather all eight full critiques before revising.

## Unresolved blockers and deliverables

- **Evidence blockers:** independent live-pane rectangles/columns; exact command and stream/probe provenance; complete timestamped frame 0 at 77×47; allocation's frame-0 position.
- **Required behavior failing in executed evidence:** origin-starting dots and visible simultaneous arrowhead arrival. This sample does not work. I do not claim universal impossibility or a missing renderer field solely from these captures; a new verified implementation/sample would be needed. No required model/tool was unavailable, and none was silently substituted.
- **Known defects are not blocked-only:** label meaning/ownership, origin/arrival behavior, and the avoidable crossing keep this case red even if the missing records were supplied.

## Verification performed

An offline standard-library Python validator checked the result against every constraint construct used by the embedded frozen schema, including required/additional fields, references, one-of/all-of branches, enums/constants, types, hash patterns, array uniqueness, and region shapes. No validation dependency was installed. It passed after a duplicate source reference was removed from the newly generated result. All 74 inventory hashes, evidence/finding references, capture-bound region limits, 23 required-edge identities, and the unchanged blind hash also passed. A separate geometric check confirmed that the review-only outer-corridor witness intersects no captured node, edge label, or other observed route and remains within 77×47 with the same source/target ports. This is static evidence analysis, not a viewer execution or a rendered repair.

Outputs under `docs/visualize-eval/rounds/03/reviews/modal-machine-manager/`:

- `observed-first.md` — unchanged stage-A record, original hash above.
- `spec-manifest.json` — deterministic four-spec identity manifest.
- `reviewer-result.json` — embedded-schema result with 74 evidence entries, seven category decisions, all 23 required-edge audits plus one apparent-label audit, evidence-linked findings, blockers, and cleanup records.
- `critique.md` — this full rationale.
