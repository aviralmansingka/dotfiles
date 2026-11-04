# Round 09 pipeline — blind observations, stage A

Evidence inspected: final and two candidate specs, `evidence/v1/` captures and manifest/check/validator. No expectations, source, rubric, or other cases inspected; no viewer run. Final spec SHA-256 independently measured `2623986f89d0bc134eef5e0b58ef7b40a818012d48ac793f7eb9bce0aabb9357`, matches manifest.

## Visible text and layout

Coordinates are [column,row,width,height], 1-based, relative to the 82×51 `v1-text.txt` view, including its header. Diagram labels:

- `CLI` [41,5,3,1]; `API gateway` [37,13,11,1]; `Auth` [33,27,4,1]; `Job queue` [42,27,9,1]; `Worker pool` [40,35,11,1]; `Postgres` [38,47,8,1].
- `verify` [30,20,6,1]; `enqueue` [41,20,7,1]; `read` [28,37,4,1]; `write` [42,41,5,1]. Their nearest respective routes are API→Auth, API→Job queue, Auth→Postgres, Worker pool→Postgres; no ownership is uncertain.
- UI header `rataflow-view · 82x51 @100% · pipeline-v1-a1.json · 6 nodes · 6 edges · q quit` starts [2,1]; controls `+ [+]`, `− [-]`, `⊡ [f]`, `□ [i]` begin at [4,46], [4,47], [4,48], [4,49] respectively. These are UI, not graph labels.

Six arrows, all down-pointing intact `▼`, each path traceable: CLI→API gateway (down, then left); API gateway→Auth (`verify`, down then left); API gateway→Job queue (`enqueue`, down then right); Job queue→Worker pool (down then left); Worker pool→Postgres (`write`, down); Auth→Postgres (`read`, down then right). Each has a distinct route; the adjacent API fan lines and the two Postgres arrowheads remain distinguishable. A reader can follow every hop; long runs and close parallel lines require some attention. Four edge labels are visibly alongside their paths, not in a shared junction.

There are no visible route crossings, touching bends, bridge glyphs, or inter-route junctions. The apparent fan is two separate lines leaving API and the apparent convergence is two distinct arrowheads at Postgres. The reported `crossings: 0 bridges, 0 touching bends` agrees. No disjoint worlds: all six nodes form one connected component. Widest outgoing fan is two (API); zero reciprocal node pairs. Postgres receives two separate arrowheads. Labels are brief component names or single action words, with few identifiers and no long qualifiers. The page reads top-to-bottom as a progression, with a parallel Auth/Job queue level, Worker pool below Job queue, then Postgres.

## Group, rank, borders and selection

Groups are logical tags, not containers. No group box, border, title, label line or tier band appears around members, which is correct under this round's contract. Normal ANSI border RGB values:

- ingress: CLI `231;138;78`, API gateway `241;164;108` — orange family; ordered vertically, CLI then API.
- control: Auth `211;134;155`, Job queue `226;156;175` — pink family; Auth left, Job queue right.
- compute: Worker pool `211;134;155` — pink, exactly identical to Auth's control border, so the families are not all visually distinct.
- storage: Postgres `125;160;184` — blue family.

There are four declared groups but only three visually distinct hue families; the exact compute/control collision is measured above. Singleton groups have no sibling ordering to compare. Only one final view is captured, so cross-view stability cannot be demonstrated. All six individual node boxes have four complete sides and corners, and ANSI shows each normal border in one continuous color. `v1-selected.ansi` captures all six borders selected in bold RGB `216;166;87`: 6/6 node occurrences, with complete continuous borders. The selected capture is simultaneous selection, not six separate individual-selection captures.

Final spec declares no explicit rank pins. Visible levels top-to-bottom: CLI; API gateway; Auth and Job queue; Worker pool; Postgres. `generation.json` is not among the permitted captures/spec files for this stage, so any separately claimed pin list cannot be verified here. No tier names are visible.

## Motion

Pinned 77×47 frames provide 21 timestamps, 0–2000 ms in 100 ms increments; six dots appear in every frame, one per route. Coordinates below use the pinned frame's own 1-based screen grid including header. Frame 0 origins, in route order CLI→API, API→Auth, API→queue, queue→worker, worker→Postgres, Auth→Postgres: (38,6), (34,14), (36,14), (39,28), (37,36), (30,28). Each is the first drawn route cell immediately after its source box border port, not a border cell. Frame 2: (38,7), (34,15), (36,15), (39,29), (37,37), (30,29): all six advance one cell down. Frame 1 equals frame 0, frame 3 equals frame 2; thereafter positions progress at roughly one eligible cell per 200 ms, with short paths looping sooner than long paths. For example CLI→API is back at (38,6) by frame 10 while API→Auth remains en route at (34,19); queue→worker is back at (39,28) by frame 6. Route-specific loop lengths therefore differ, and arrival is not synchronized. One dot per route makes within-route inter-dot spacing inapplicable.

Compared each dot location in every pinned frame to the frame-0 underlying route/label glyph: all are origin cells or straight `│`/`─` cells, not a corner, bridge, arrowhead, or label; 0 observed violations in 126 dot instances. Dots skip corner/arrowhead positions and loop; the capture does not show all six simultaneously at arrowheads. `check.txt` separately reports 6 single-dot routes, 0 violations, 6 constant at 0.5c/step, 6/6 origins and 0 same-arrival routes. It does not establish an all-route synchronized arrival. `v1-frames.txt` begins with a partial tail of an earlier frame then frames 2–20; the complete pinned frame series supplies frames 0 and 1.

## Fit and candidate disclosures

`check.txt`: `viewport: unknown zoom: 1.00 natural`, `extent=31x46 cells`; live text header reports 82×51 at 100%, manifest records 51 rows and `82x51 @100%` token (pane rectangle/columns field null). The pinned dump explicitly says `viewport: 77x47 zoom: 1.00 natural` and shows all graph labels, borders, arrowheads and routes without pan/zoom; Postgres bottom border is on the last row, so the 31×46-in-47-row vertical margin is thin. The pinned UI header is truncated at `q qu` rather than `q quit`: one UI text item clipped, zero graph items clipped. The 82×51 graph and header are complete. Evidence proves fit at these captured dimensions, not at arbitrary smaller panes.

Candidate a2 declares `label_slot` on all four labeled routes. Task disclosure says the renderer rejected the parallel fan-edge slots with `no obstacle-safe route`; record as a renderer limit, not a defect in shipped a1. Candidate a3 keeps slots only on the two Postgres edges; task disclosure says 31×42 and not shipped. Neither candidate is judged as the final capture. Task disclosure also says no `lr` orientation check was run because budget was spent; this is an untested orientation, not proof of failure.

The task message paraphrases the generator classification as `family: flow-chains`, E=N=6, tie-breakers recorded, no yield. The exact complete `family: …` / `evidence: …` classification line and its original location do not occur in the permitted captures or specs inspected; cannot quote or locate them verbatim from this evidence. No claim is made that the paraphrase is the full line.

## Blind scorecard

- visible nodes 6; edges 6; graph labels 10 (6 node + 4 edge); logical groups 4, visually distinct hue families 3; explicit spec rank pins 0 (generation pin declaration unavailable).
- crossings/bridges 0; touching bends 0; uncertain edge-label owners 0; clipped graph items 0; clipped UI items 1 in pinned view.
- selected border coverage 6/6 simultaneous; dot violations 0 across 21 pinned frames / 126 dot instances; 6/6 frame-zero origins; synchronized arrowhead arrival not demonstrated.
- Evidence readability: all inspected text and ANSI files readable. Full `v1-frames.txt` frame 0 and frame 1 absent from that file, but present in pinned series. Original classification line and generation rank claims not available within this stage's permitted evidence.
