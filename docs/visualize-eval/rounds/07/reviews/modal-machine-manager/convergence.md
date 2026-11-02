# Round 07 convergence: modal-machine-manager

Blind record: [observed-first-rf.md](observed-first-rf.md), SHA-256 `0eb4e553f0e830d34219ecfcf67570449faa74b8aad934f73abb00b90a742037`, `saved_before_expected_reveal: true`. Hash independently rechecked. It is unchanged. Generator `viz-rf07` / `fireworks/accounts/fireworks/routers/deepseek-flash-latest`; reviewer `openai/gpt-6.1-sol`.

## Coordinates and evidence

`R(x,y)` is the 83×51 round-05 native `evidence/vN/vN-text.txt` screen, one-based column x and one-based screen row y; pinned 77×47 coordinates are separately named. `F(x,y)` is the full React Flow PNG scaled to 856×2000, matching the blind record (multiply x by 2618/856 and y by 3.06 for original pixels). A rectangle uses top-left and bottom-right; approximate F precision ±3 scaled pixels. These are two different views/scales, not overlaid coordinates. R normal/selected ANSI support hue/state; pinned frames and prior result establish target behavior. Complete per-node and per-label F coordinates appear in the blind record; the table below maps every edge, including its R owner-label location, F label and important geometry. For R label anchors listed from the prior audit, coordinates are **77×47 pinned**, zero-based x and screen y as recorded in the delivered audit; they are marked `P` and are not mixed with R.

## Structural and geometric comparison

- v1 R control plane near (21,14), humans (53,14), private gRPC (21,22), webapi (50,22), queue (36,30), Slack (66,30), Postgres (19,38). F humans (319,99), Slack (433,99), control plane (319,206), webapi (433,206), private gRPC (319,261), queue (381,368), Postgres (343,475). Two-stage subgroup layout lifts Slack to humans row and puts control directly beneath; R is node-ranked with Slack at queue rank. F titled boxes HUMANS B(265,74;487,115), CONTROL B(265,181;487,277), QUEUE B(327,343;435,383), STATE B(289,450;397,490); R only individual colored node borders, no group outline/title. Hue families mostly correspond; related-group proximity is imposed by F boxes, not R geometry.
- v2 R queue (23,10), registry (24,18), reconcile (58,18), providers (24,26), Postgres (55,26), machines (21,34), boot (22,42); F queue (289,589), reconcile (457,589), registry (295,711), providers (295,774), Postgres (463,743), machines (295,895), boot (295,958). F subflows queue B(227,560;350,606), control B(396,560;519,606), providers B(234,682;357,791), state B(402,714;525,760), machines B(234,867;357,976). Registry/providers and machine/boot are boxed together; R hues without containing boxes. F puts reconcile above registry rather than at the same rank.
- v3 R machines (24,14), queue (57,14), agent (27,22), S3 (55,22), public gRPC (26,30), Postgres (24,38); F machines (363,1079), agent (363,1153), queue (318,1297), public gRPC (510,1297), S3 (242,1440), Postgres (395,1440). F state grouping puts S3 and Postgres together at bottom instead of S3 near the top; machines/agent occupy MACHINES B(290,1046;435,1174), queue B(245,1264;391,1318), control B(437,1264;582,1318), state B(170,1407;467,1462). R is hue-only.
- v4 R queue (40,18), janitor (23,26), SSH (56,26), webapi (23,34), machines (54,34). F queue (376,1594), SSH (295,1746), janitor (457,1746), machines (275,1898), webapi (477,1898): the two branches reverse left/right. F QUEUE B(300,1559;453,1616), OPS B(219,1710;534,1768), MACHINES B(199,1863;351,1920), CONTROL B(401,1863;554,1920) versus R hue-only boxes. F group and node borders are complete except intentional title cutouts on group borders.

## Every edge label / attachment comparison

R values in this table are `P` (pinned coordinates) from the delivered edge audit; F values are screenshot label centers. Names are the actual directed endpoints, not inferred from label proximity. R has dedicated per-edge stems and heads, F always uses the single invisible bottom-center source/top-center target handles for TB. All 23 R routes are reported with zero crossings/shared corridors; F intersection details below are not automatically equivalent to X crossings.

| View / edge | R label P | F label F | Distinction |
|---|---|---|---|
| v1 cp→pgrpc | create/terminate/repair (15,16) | (319,234) | F internal control midpoint; R by source. |
| v1 web→wapi | http (47,16) | (319,148) | F elbow leads across to wapi, coincides with opposite Slack route x433. |
| v1 pgrpc→q | enqueue job (17,24) | (319,316) | F source-column stack, shared queue approach. |
| v1 wapi→q | reinstall/reprov (29,24) | (433,304) | Both sides have uncertain owner; F text detached right of x381 route. |
| v1 pgrpc→db | machine rows nominal (1,28), actually `achine rows` | (319,304) | F text complete; F route partly hidden by queue. |
| v1 q→db | job rows (18,32) | (381,417) | F shares final approach with pgrpc→db. |
| v1 wapi→Slack | confirm/alerts (47,26) | (433,316) | R goes down/right to Slack; F Slack moved above and return runs through shared x433. |
| v2 q→registry | provision job (17,11) | (289,644) | F offset from target x295. |
| v2 registry→providers | provider API (18,21), ambiguous | (295,742) | F midpoint inside providers; shared route through registry makes direct reconcile route obscure. |
| v2 providers→machines | alloc instance (17,30) | (295,829) | Individually legible. |
| v2 machines→boot | iPXE request (17,36) | (295,926), **covered** | F reciprocal label superposition; R request visible. |
| v2 boot→machines | boot.ipxe + S3 args absent | (295,926), **visible** | R payload absent; F response text visible over downward-looking arrow; upward route not independently visible. |
| v2 reconcile→providers | gcore sync 1m (27,19) | (457,638) | F stack far above leftward route y681. |
| v2 reconcile→db | cluster state (36,21), ambiguous | (457,651) | F stacked on same source column. |
| v3 machines→agent | runs on host (21,18), ambiguous | (363,1116) | F clear midpoint within machines group. |
| v3 agent→public gRPC | register+hb (21,25) | (363,1227) | F stacked below pull boot img; horizontal arm y1225. |
| v3 public gRPC→db | machine state (21,32) | (510,1363) | F bottom-row db reached by lateral elbow. |
| v3 machines→S3 | pull boot img (29,16) | (363,1211) | F route hidden behind agent; R direct separate route. |
| v3 q→S3 | diag uploads (36,15), ambiguous | (319,1363) | F joins same S3 approach x242. |
| v4 q→SSH | audit reimage (35,22) | (376,1655) | F stack; both omit verify. |
| v4 SSH→machines | machine-audit (35,29) | (295,1816) | Branch ordering reversed vs R. |
| v4 q→janitor | diag events (21,20) | (376,1672) | F shared source stem. |
| v4 janitor→webapi | propose actions (20,28) | (457,1816) | Branch ordering reversed vs R. |

## Crossings, occlusion, animation, fit

- v1 R separate stems P(13,23), P(15,23), P(45,23), P(47,23) vs F overlapping source x319 and x433, merge at F(381,314), node-interior obstruction F(327–343,368), shared final x343 y413–463, plus opposite-direction coincident F x433 y111–194. F labels (319,304/316) and (433,304/316) are stacks; no isolated F X claimed. R has zero crossings, including no shared runs, and the prior audit records one clipped target label at P(1,28).
- v2 R reconcile→providers P(49,19)→(17,22) and queue→registry P(15,11)→(15,14) use distinct corridors; reciprocal boot route P(13,40)→(11,32)→(13,32) bypasses machines. F reconcile line meets queue line F(295,681), continues through registry F(242–347,698–724); reciprocal boot paths coincide at F x295, with both labels centered F(295,926). Generator's blanket claim that every label is separable is contradicted by the captured readable `boot.ipxe + S3 args` covering `iPXE request`.
- v3 R machines→S3 P(21,15)→(49,18) avoids agent; F passes behind agent B(301,1138;425,1168), then through queue-title area at F y1260, joins queue→S3 at F(242,1368). R owner ambiguities for `runs on host` and `diag uploads` differ from F's stacked `pull boot img` / `register+hb` F(363,1211/1227). F dots may also be hidden by labels.
- v4 R separate queue stems P(33,19) and P(35,19), destination heads P(18,22), P(48,22); F single shared stem x376 y1610–1670 then split at F(376,1670) to x295/457. R no shared junction; F no separate X.
- R round-05 77×47 frame 0 dots are one drawn cell late: e.g. cp→pgrpc source border P(13,14), first external P(13,15), dot P(13,16); R other 22 share this defect. R motion is cell-quantized and exhibits skipped non-origin corners and short looping stems; actual probes document e8 P(15,36)↔(15,37), head P(15,38). F DOM creates one `circle`/`animateMotion` per 23 edges starting at the path's source handle (e.g. cp bottom F≈(319,217)), with `dur=path length/55` for nominal constant SVG pixels/s and indefinite repeat. This is a **port-origin offset**, not proof that screenshot motion is correct: F still contains only 4/3/4/0 separately visible dot marks in v1/v2/v3/v4, and no time series, t=0 sample, full lap, unobscured path/origin, or measured speed. In particular F paths can pass under nodes and labels. Do not equate the animation source code with rendered moving evidence or claim simultaneous arrivals. R and F cannot be compared in absolute cells/sec to SVG px/sec.
- F all node/group extents fit each 1100×700 canvas at capture zoom, but v2 `iPXE request` is occluded; fit adaptation asks extent without pan, so fit passes while semantics/traceability do not. R delivered fit fail incorporates clipped `machine rows` and dropped response label. R has header/palette while F badges at F(691,501), (691,987), (691,1472), (691,1958) are non-overlapping attribution chrome.

## Notes verified, not adopted wholesale

`notes.md` correctly describes titled boxes, `fitView`, one SMIL circle in code and source-port start; it incorrectly asserts all labels are visible/separable and implies all paths avoid intervening nodes. It reports a reload digest `201387495`, but no raw pair of DOM measurements or timestamped F frames is preserved. `attempts.md` has three numbered attempts plus a 3b subiteration; attempted artifacts exist. `commands.txt` supplies capture steps but no preserved command output/exit statuses, raw DOM digest trace, browser close proof, or moving capture. These omissions block workflow, not proof of nondeterminism.
