# Round 01: stop at required renderer capabilities

**Result: 0/8 green cases. All eight cases fail. No candidate is approved.**

Eight fresh DeepSeek generators produced the samples. Eight separate Astra judges
saved blind observations, then compared the same evidence with the source.
All complete critiques arrived before the next skill proposal. The captain also
resolved selected-state overclaims and an unsupported global-color requirement.
Original reports remain archived; all eight blind records remain unchanged.

The fixed stop rule permits stopping at an unsupported required capability.
The frozen renderer cannot declare GB300's single shared trunk or independently
request one live dot per edge. More skill-only retries cannot add those controls.
This stop is not a claim that two skill revisions failed; none was evaluated.

## Final matrix

P = pass. F = fail. B = missing required evidence or capability. — = source-backed N/A.
A known failure still determines FAIL when another category is blocked.

| Case | Meaning | Arrows | Fit | Groups/color | Borders | Evidence | Animation |
|---|---|---|---|---|---|---|---|
| Pipeline | P | P | P | P | B | B | F |
| Network | P | P | B | P | F | B | F |
| Homelab NIC trace | F | F | F | F | B | B | — |
| Server NIC layout | F | P | F | F | B | F | — |
| Datacenter redundancy | F | F | F | P | B | B | — |
| Modal machine manager | F | F | F | F | B | B | F |
| Modal runtime | F | P | P | F | B | F | — |
| GB300 rack software | F | F | F | F | B | B | — |

Of 51 applicable categories, **11 pass, 26 fail, and 14 are blocked**.
The recorded findings contain 12 critical, 33 high, and 7 medium entries.
These are reported findings, not a new weighted score or a unique-root-cause count.
The nominal comparison tuple is `(0, 11, -12, -33)`.

Round01 is the last and only completed baseline, so its last and best-observed
matrices are identical. It is not an eligible proof of improvement: execution
binding, state evidence, and attempt-budget problems remain. Cancelled round00
is excluded. There is no approved or successfully improved skill candidate.

Machine-readable results and report hashes: [matrix.json](matrix.json).
All complete critiques: [reviews/](reviews/).

## What failed

- **Pipeline:** all six relationships are readable. Adjacent simultaneous dots
  violate sparse motion. Four node occurrences lack their own selected evidence.
- **Network:** all seven relationships are readable. Actual captures show neutral
  border cells and adjacent dots. The launch used bare `rataflow-view`, so the
  record does not prove it executed the frozen binary. Do not attribute those
  border defects to the corrected renderer. Numeric zoom attestation is also
  blocked. Color passes after removing the unsupported global-stability rule.
- **Homelab:** 13 concepts and 14 relationships remain in JSON. Required address,
  role, and historical limitation details are missing. Six required relationship
  audits fail, plus four apparent-link audits. Touching or dot-masked bends and
  detached labels prevent clear reading.
- **Server:** eight arrows are traceable, but required address/AS context is lost.
  Colors mix unlike concepts. The recorded selected-node identity is also wrong
  for one capture; six node occurrences lack their own selected-state evidence.
- **Datacenter:** all 28 pairs remain in JSON. Only 19 complete relationship audits
  pass. Two paths cross label text, and seven other labels have uncertain owners.
  Source pair/tier grouping passes. Initial pane `w7E:p37` lacks raw closure proof;
  that is not proof of a leak.
- **Machine manager:** all 17 component IDs and 23 directed pairs remain in JSON,
  but repair, reprovision, verification, and boot-response arguments lose meaning.
  Two labels disappear. All eight selected animated routes violate the last
  one-live-dot correction. Full-pair presence does not establish full fidelity.
- **Runtime:** endpoint paths are traceable, but task-input/management and process
  meaning is incomplete. Groups do not match execution/storage concepts. Some
  launch, timestamp, and cleanup records conflict.
- **GB300:** three independent OOB paths replace the requested trunk. Hosting and
  protocol semantics are incomplete or incorrect, residence groups are unclear,
  and two labels have uncertain ownership. Some historical OOB→NVOS reachability
  remains unconfirmed; the renderer cannot resolve source uncertainty.

## Renderer boundary versus skill defects

The [frozen-source capability audit](capability-audit.md) identifies:

1. No bus/junction/shared-trunk declaration. The router allocates separate ports.
2. No independent live-dot count. `flow` controls speed; the periodic pattern can
   produce multiple dots and can replace ordinary bend glyphs.
3. No semantic-group color field independent of layout bands. This is a control
   limitation, not proof that every geometric layout must fail conceptual grouping.
4. Labels can obscure or detach from routes despite a clean check. This is an
   observed defect, not a proved impossibility for every alternate layout.

Meaning inventories, careful abbreviations, exact binary launches, complete
state captures, and honest cleanup records are skill/workflow changes. They do
not add renderer capabilities. The [proposed skill](../../proposals/02/SKILL.md)
addresses those authoring failures and stops honestly at unsupported features.
Its [change map](../../proposals/02/README.md) links the proposal to the critiques.
The proposal is **unevaluated and not installed**. The active working-tree skill
was not replaced after the round, and the global skill/binary were not updated.

Before another full evaluation, renderer support must demonstrate the explicit
trunk and independent one-dot requirement. Source-group color control and safe
label ownership also need work. Any renderer change requires a new frozen
baseline and all eight fresh DeepSeek samples with separate Astra judges.
The dataset, natural 77×47 target, and rubric must remain unchanged.

## Evidence corrections and execution limits

- Seven border categories are blocked because selected-state coverage is partial.
  No observed border defect is alleged in those seven cases. A frame with one
  selected node does not test the selected borders of all other visible nodes.
- Proven selected occurrences are 3/16 for homelab, 5/24 for datacenter, 4/27 for
  manager, 6/17 for runtime, and 4/19 for GB300. Superseded claims are archived.
- Network's color failure depended on an added global per-node hue-stability rule.
  Its judge withdrew that finding. The frozen related-concept hue rule remains.
  Other color failures identify source-backed grouping defects, not drift alone.
- Every source snapshot, expected/variant file, candidate, frozen binary, rubric,
  and frozen renderer-source hash still matches round metadata. The captain also
  checked all 522 final evidence records, schema fields, references, coordinates,
  animation applicability, worker role separation, and overall verdict logic.
- Hash verification proves file identity, not historical execution. Network's
  executable binding remains unproven despite its frozen binary hash matching.
- The generation limit was three local spec attempts per view. Datacenter records
  extra fabric alternatives beyond three and further merged/reference exploration.
  Network's attempt list has 13 entries, including duplicate/reference entries,
  and many alternatives without a clear bounded per-view accounting. These are
  protocol compliance problems, not evidence that the budget was satisfied.
  Final-view scoring does not excuse or hide that exploration.
- All generators reported cleanup. Some reports lack raw closure/probe evidence.
  Missing records remain blockers; current pane state cannot repair history.

## Regression checks

After review, without changing the renderer or frozen evidence:

- `cargo test --offline --manifest-path rataflow/Cargo.toml`: **46 tests pass**.
- `cargo clippy --offline --manifest-path rataflow/Cargo.toml --all-targets -- -D warnings`: **pass**.
- `uv run --offline scripts/test-rataflow.py`: **eight static checks pass**.
  It reports 9/9 including its skipped opt-in cargo step; cargo ran directly above.
- `git diff --check`: **pass**.

These checks do not overturn the failed visual evaluation. No new live sessions,
renderer changes, dependency additions, commits, installs, or remote access were
performed during final aggregation.

## Frozen identities

| Input | SHA-256 |
|---|---|
| Evaluated skill | `9c5cea272a88300644cacda52c853c7c9169eeec91f0355d3460ee8741308d92` |
| Renderer | `4a883e73b822f009c504bd21d0c2fc383067bf1b83b9791ccbda431912e3a1d8` |
| Rubric | `60997237bd996f1e1b6a16e0b68133859b9f03fd83c85e7f508e286743240f5d` |
| Dataset index | `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05` |
| Unevaluated proposal 02 | `bb2ccaeccca85ca52181d67fe7c0ceb785428d6179b2d6f9fa1dd294f15c265e` |

Detailed input, source chat, and renderer-source identities remain in the unchanged
[metadata.json](metadata.json). Current orchestration state is [state.json](../../state.json).
