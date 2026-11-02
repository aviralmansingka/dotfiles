# Observed first — homelab-nic-trace — round01 — blind Stage A

## Evidence boundary and method

Inspected only this case's final `captures/v{1,2,3}-{unselected,selected}.{txt,ansi}`, `frames/v{1,2,3}-frame{01,02,03}.{txt,ansi}`, and `captures/v{1,2,3}-size.txt`. Did not read commands logs, specifications, checks, source briefs, renderer/generator code, attempts, other cases, or prior judgments. Used an independent, temporary Python ANSI-cell reader via `uv` to supplement direct raw-text inspection. This report records observations, not a comparison with intended semantics or a pass decision.

All locations below are 1-based `[column,row,width,height]`, in the named view. Node positions remain fixed across its five supplied states. Each size log says `47 77`; all ANSI captures contain 47 rows of 77 cells. Text files omit the final blank row and trim right whitespace; their remaining characters agree with the corresponding ANSI. No timestamp evidence was read. Frame sequence establishes changing samples, not elapsed time or an objectively slow animation rate. The requested natural100% scale is not independently measurable from the displayed chrome.

## Shared presentation

Background RGB is `(40,40,40)`. Node/edge-label text is cream `(235,219,178)`. Edge strokes and arrowheads are muted `(124,111,100)`; moving dots are gold `(216,166,87)`. Node borders have the colors listed below. Thus each **perimeter**, not all content of a node, has one uniform color. Text deliberately differs from the perimeter.

All node top, bottom, left and right sides and all four rounded corners are present in every supplied capture/frame. Independent per-cell inspection found no missing or differently colored perimeter segment. Source paths touch intact node borders without a junction/port glyph cut into the border. Arrowheads sit immediately outside destination borders. No separate selection handles are visible: selected nodes retain ordinary rounded corners, with the whole perimeter bold gold. Consequently a distinct handle interaction/appearance cannot be evaluated; the visible selected corners and sides are uniform.

A complete control box appears at `[2,41,9,6]` in every view. Its four labels are `+ [+]` at `[4,42,5,1]`, `− [-]` at `[4,43,5,1]`, `⊡ [f]` at `[4,44,5,1]`, and `□ [i]` at `[4,45,5,1]`. No graph element overlaps this box. The header is at `[1,1,77,1]`, with `rataflow-view`, a JSON filename, node/edge/flow counts and `drag pan`. View 1 displays `v1-local-nets.json`, `5 nodes`, `4 edges`, `4 flows`; view 2 displays `v2-host-nics.json`, `4 nodes`, `4 edges`, `3 flows`; view 3 displays `v3-lan-wan.json`, `7 nodes`, `6 edges`, `5 flows`. The view-2 header ends in a separator; view 3 ends in a lone `s`. Further help/status text is unknown, not assumed complete.

## View 1 — local pairs descending into a host

### All node labels and borders

| Visible node | Label rectangle | Whole node rectangle | Unselected border RGB |
|---|---|---|---|
| VM vnet0 | [25,16,8,1] | [24,15,10,4] | 216,166,87 |
| Container veth | [41,16,14,1] | [40,15,16,4] | 228,184,111 |
| virbr0 NAT | [24,24,10,1] | [23,23,12,4] | 125,174,163 |
| docker0 172.18 | [41,24,14,1] | [40,23,16,4] | 147,194,183 |
| homelab host | [23,32,12,1] | [22,31,14,4] | 211,134,155 |

Selected capture: `homelab host` changes to bold `(216,166,87)` on its entire perimeter `[22,31,14,4]`; other nodes keep their colors.

### Directed paths recovered from visible geometry

1. **VM vnet0 → virbr0 NAT.** Source stem `[25,19,1,2]`, short leftward bend `[24,21,2,1]`, downward arrow `[24,22,1,1]`. Label `192.168.122.x` at `[27,20,13,1]` is beside this stem.
2. **Container veth → docker0 172.18.** Straight downward stem `[41,19,1,3]`, arrow `[41,22,1,1]`. Label `172.18.2.x` at `[43,20,10,1]` associates clearly with it.
3. **virbr0 NAT → homelab host.** Stem `[24,27,1,2]`, short left bend `[23,29,2,1]`, downward arrow `[23,30,1,1]`. Label `NAT bridge` at `[26,28,10,1]` sits next to its source stem.
4. **docker0 172.18 → homelab host.** Stem `[41,27,1,2]`, leftward horizontal route `[25,29,17,1]`, downward arrow `[25,30,1,1]`. Label `Docker bridge` at `[27,30,13,1]` lies below that horizontal route and beside its destination arrow.

No additional directed link is established. At `[23,29,4,2]`, the two incoming host routes are extremely close: adjacent bend cells have no blank column between them. The selected snapshot has `╭●●` at the start of the apparent horizontal run. A reader of that single instant can mistake the two routes for a shared branch. Other samples expose the separate bends and the two distinct arrows. There is no explicit crossing or branch marker; dot-covered corner connectivity in that instant alone is unknown. I do not count the apparent merger as an additional proven edge.

### Groups, fit and motion

The display suggests two gold endpoint peers, two teal bridge peers, and a pink common host. These are color/spatial groups, not named group containers or a legend. All graph content fits inside `[22,15,34,20]` with ample surrounding blank space; none of the visible node or edge labels is truncated.

Dots change on all four paths across the samples. On the long docker-to-host run, row-29 dots move from columns 28/35 (frame01), to 26/33/40 (frame02), to 30/37 (frame03). With repeated dots, phase matching is not unique; leftward movement is consistent with the destination, but speed and individual-dot identity are unknown. On shorter paths, dots replace a corner or stem cell, e.g. `[24,21,2,1]` and `[23,29,2,1]`. No node, label or border moves.

## View 2 — left source, central host and right interfaces

### All node labels and borders

| Visible node | Label rectangle | Whole node rectangle | Unselected border RGB |
|---|---|---|---|
| tailscale0 .49 | [3,22,14,1] | [2,20,16,5] | 216,166,87 |
| homelab host | [32,22,12,1] | [31,20,14,5] | 125,174,163 |
| bond0 .1.197 | [64,22,12,1] | [63,20,14,5] | 211,134,155 |
| wlp8s0 .213 | [64,27,11,1] | [63,26,13,4] | 226,156,175 |

Selected capture: `bond0 .1.197` is uniformly bold gold at `[63,20,14,5]`. Other perimeters do not change.

### Directed paths recovered from visible geometry

1. **tailscale0 .49 → homelab host.** Lower source stem `[18,23,11,1]` turns up at `[29,23,1,1]`, rises through `[29,22,1,1]`, then turns right at `[29,21,1,1]` into arrow `[30,21,1,1]`.
2. **tailscale0 .49 → bond0 .1.197.** Upper source run `[18,21,11,1]` turns upward at column 28, rises to row 18, crosses rightward over the host along `[28,18,34,1]`, descends at `[61,19,1,2]`, then turns into the upper bond arrow `[62,21,1,1]`.
3. **homelab host → bond0 .1.197.** Upper host source run `[45,21,16,1]` turns down at column 60, descends through `[60,22,1,1]`, turns right on row 23 and ends at the lower bond arrow `[62,23,1,1]`.
4. **homelab host → wlp8s0 .213.** Lower host source run `[45,23,15,1]` turns down at column 59, descends through `[59,24,1,3]`, turns right along row 27 and ends at arrow `[62,27,1,1]`.

These are the path readings supported by comparing bends across samples. No direct tailscale-to-wifi link, reverse link, or host self-link is visible.

### All edge labels and association limits

- `overlay` at `[20,22,7,1]` lies exactly between the two tailscale source runs. It plausibly names the host-bound lower path, but has no leader and is equally adjacent to the upper run. Exclusive association is **unknown from placement alone**.
- `UDP encap` at `[51,20,9,1]` is above the host-to-bond run and immediately left of the outer tailscale-to-bond descent. It could describe that outer route, but the nearby host run makes exclusive ownership **unknown**.
- `eno1 2.5 GbE` at `[47,22,12,1]` is between the host's two outgoing horizontal runs. It plausibly labels the bond-bound upper route; without a leader, exclusive ownership remains **uncertain**.
- `backup` at `[49,24,6,1]` lies below the host's lower run and is the clearest association: the route descending to `wlp8s0 .213`.

### False joins, groups, fit and motion

Three packed bend regions require care: `[28,21,3,1]`, `[60,21,3,1]`, and `[59,23,4,1]`. Different routes' opposing bends touch side by side, with no intervening blank column. For example, a host-source horizontal stroke appears to continue into the outer bond arrow on row 21 when a dot masks the down-turn at column 60. Frame02 exposes the opposing corner glyphs more clearly. Likewise the lower host run can appear to continue directly to the lower bond arrow on row 23, although its exposed corner turns toward wifi. These are real single-frame false-continuity risks; no explicit crossing/junction symbol establishes a shared branch. The surrounding separate stems and exposed turns across frames support the four routes above. Exact connectivity at a dot-masked local bend in one snapshot remains unknown.

Gold left node, teal central host, and two related pink right nodes give three visual groups, but no textual group headers or legend. All visible graph content fits in `[2,18,75,12]`; the rightmost border is column 76, leaving one blank column. No label is cut, though margins are tight horizontally.

Three paths show changing dots; the lower host-to-wifi backup path has no dots in these samples. On the upper long run, frame01 columns 30/37/44/51/58 become 32/39/46/53/60 in frame02; frame03 includes 28/35/42/49/56 with a dot descending at `[61,20,1,1]`. This is consistent with rightward travel and a turn toward bond. The source runs and host-to-bond route also change dot positions. Dots obscure corner glyphs, but do not cover labels or node borders. Speed cannot be certified.

## View 3 — two top interfaces converging into a downward chain

### All node labels and borders

| Visible node | Label rectangle | Whole node rectangle | Unselected border RGB |
|---|---|---|---|
| bond0 .1.197 | [25,4,12,1] | [24,3,14,4] | 216,166,87 |
| wlp8s0 .213 | [48,4,11,1] | [47,3,13,4] | 228,184,111 |
| Fios router? .1.1 | [22,12,17,1] | [21,11,19,4] | 125,174,163 |
| ONT? 169.254.3.1 | [23,20,16,1] | [22,19,18,4] | 211,134,155 |
| VZ agg 100.41.x (hop) | [20,28,21,1] | [19,27,23,4] | 169,182,101 |
| VZ backbone AS701 (hop) | [19,36,23,1] | [18,35,25,4] | 125,160,184 |
| Cloudflare 1.1.1.1 | [22,44,18,1] | [21,43,20,4] | 231,138,78 |

Question marks, partial IP forms, and `(hop)` are literal visible text, not resolved identities. Selected capture: `bond0 .1.197` retains its gold RGB but becomes bold across its complete perimeter `[24,3,14,4]`.

### Directed paths and every edge label

1. **bond0 .1.197 → Fios router? .1.1.** Stem `[25,7,1,1]`, leftward bend/run `[22,8,4,1]`, descent `[22,9,1,1]`, arrow `[22,10,1,1]`. `default gw 0.5 ms` at `[27,7,17,1]` sits beside this source stem.
2. **wlp8s0 .213 → Fios router? .1.1.** Stem `[48,7,1,2]`, leftward run `[24,9,25,1]`, arrow `[24,10,1,1]`. `metric 600` at `[31,8,10,1]` is immediately above this long horizontal route. The proximity supports this association; there is no explicit leader.
3. **Fios router? .1.1 → ONT? 169.254.3.1.** Source stem `[22,15,1,2]`, rightward bend `[22,17,2,1]`, arrow `[23,18,1,1]`. `NAT out` at `[24,15,7,1]` is alongside the stem.
4. **ONT? 169.254.3.1 → VZ agg 100.41.x (hop).** Stem `[23,23,1,2]`, leftward bend `[20,25,4,1]`, arrow `[20,26,1,1]`. `4.5 ms` at `[25,24,6,1]` is beside the stem.
5. **VZ agg 100.41.x (hop) → VZ backbone AS701 (hop).** Stem `[20,31,1,2]`, left bend `[19,33,2,1]`, arrow `[19,34,1,1]`. `6.6 ms` at `[22,32,6,1]` is beside this stem.
6. **VZ backbone AS701 (hop) → Cloudflare 1.1.1.1.** Stem `[19,39,1,2]`, rightward bend/run `[19,41,4,1]`, arrow `[22,42,1,1]`. `6-9 ms` at `[21,39,6,1]` is beside this source stem.

No extra branch, crossing, or reverse link is established. The two router arrows are separated by a blank column and terminate at different top-border positions. The remainder is a clearly separated serial chain. Dots replace small bend glyphs, but no second route is close to those bends.

### Groups, fit and motion

Two same-family gold top nodes converge into a chain of individually colored downstream nodes. There are no drawn group containers, group labels, or color legend. Familiar names suggest interfaces, router, ONT, provider hops and a final remote endpoint; that is a reader interpretation, not proof of network semantics. The displayed question marks make uncertainty visible.

Graph bounds are `[18,3,42,44]`. Cloudflare's entire bottom border is present on row 46, with one blank row beneath; all sides and all labels are visible. The graph does not overlap the controls. This is a complete but vertically tight fit of the visible content, not a claim that undisplayed intended content exists or is absent.

Five routes show dot changes; the wifi-to-router path stays dot-free. Examples: the router-to-ONT dot at `[22,17,1,1]` in frame01/02 becomes dots at `[22,16,1,1]` and `[23,17,1,1]` in frame03; the aggregation-to-backbone dot at `[20,33,1,1]` becomes dots at `[20,32,1,1]` and `[19,33,1,1]`. The long bottom bend also changes from dots at `[19,41,1,1]` and `[22,41,1,1]` to `[19,40,1,1]` and `[21,41,1,1]`. Repetition and short paths prevent unique particle tracking or a speed judgment. Static topology and readable labels remain fixed.

## Blind summary and unresolved points

The raw views support 5/4/7 fully visible nodes and 4/4/6 directed route readings, respectively. All node perimeters are complete and internally uniform, including selected corners and sides. The three scenes fit the supplied 77×47 grid; the header/help tail is not fully interpretable. Animation changes dots without moving node geometry.

Most important reservations: touching, dot-masked opposing bends create false-continuity risks in views 1 and especially 2; view-2 edge-label ownership is not uniquely established by placement. Missing/ambiguous label associations remain unknown rather than supplied from assumed network semantics. Timing, exact zoom, separate selection handles, intended group names, and correctness against any expected source remain unevaluated. No Stage B verdict is made.
