# Blind observation — pipeline, stage A

Coordinates are 1-based [column,row,width,height] in the pinned 77×47 capture, counting the application header as row 1. This is a single graph surface, not a multi-diagram canvas. Observations are from shipped spec and captures, not the source or brief.

## Surface v1

**Shape.** Six visible boxes, six distinct directed routes and six arrowheads. Four route labels and six node labels. No diagram title or description is rendered or declared; therefore no region, clipping or occlusion applies to those fields. The application header is not a diagram title. No separate canvas diagrams or canvas block are reported.

**Labels** (text rectangle, not box): CLI [38,3,3,1]; API gateway [34,11,11,1]; Auth [30,25,4,1]; Job queue [39,25,9,1]; Worker pool [37,33,11,1]; Postgres [35,45,8,1]; verify [31,17,6,1]; enqueue [36,23,7,1]; read [26,35,4,1]; write [37,39,5,1]. None is clipped or occluded in the pinned capture. Owners of the four route labels are visually discernible; uncertain owners: 0. The actual 68×44 live pane capture clips the Postgres label and most of its box.

**Arrows.** CLI → API gateway: down, complete ▼, straight, traceable. API gateway → Auth: down then left then down, complete ▼, traceable, verify beside its initial vertical segment. API gateway → Job queue: down then right then down, complete ▼, traceable, enqueue just left of its arrowhead. Job queue → Worker pool: down, one-cell left jog, down, complete ▼, traceable. Worker pool → Postgres: down then left then down into right port, complete ▼, traceable, write alongside its vertical segment. Auth → Postgres: down then right then down into left port, complete ▼, traceable, read alongside its vertical segment. API gateway has two separate outgoing ports, not a drawn junction; Postgres has two separate incoming ports. There are no crossings, touching bends, bridge glyphs, junctions or actual shared branches. The two database routes are separated and their labels distinguish them.

**Near misses.** No route visibly enters an unrelated box's immediate surrounding ring: CLI→API, API→Auth, API→queue, queue→worker, worker→Postgres and Auth→Postgres each have zero such ring cells; therefore no closest offending cell or unrelated node to report. Check agrees: `near-misses: 0 cell(s) inside the 2-cell margin of a node the route does not serve (0 on trunk buses)` and `passes-near-unrelated-node: 0`. No per-route near-miss lines were printed. The check's 2-cell margin is wider than the immediate visual ring.

**Groups, ranks and borders.** ANSI capture shows client: CLI blue RGB (115,161,206); services: API gateway pink (206,115,138), Auth lighter pink (219,153,170); workers: Job queue green (115,206,115), Worker pool lighter green (153,219,153); store: Postgres orange (206,161,115), top border only in live ANSI. The two siblings in each group retain a consistent darker-first then lighter ordering in the one surface. No enclosing group border, box, title, or tier label is drawn; the hues mark group membership but the group names are not visible. No explicit rank pins are declared (generation's layers lever says unused); actual top-to-bottom ranks are CLI; API gateway; Auth and Job queue; Worker pool; Postgres. All six boxes have complete sides and corners in the pinned text. ANSI confirms uniform colored borders for the five fully visible nodes; only the Postgres top border is captured in ANSI, so full color continuity for it is unproven. Selection capture highlights all six nodes' visible border parts in (216,166,87): six node occurrences have selected border evidence, but only five complete selected borders are visible, because Postgres is clipped. This is a simultaneous select-all state, not six separate individual selection captures.

**Motion and dot hues.** The pinned dump has 40 frames from 0 through 3900 ms at 100 ms intervals, six dots in every frame, one per route. Each route has one dot, so inter-dot spacing on an individual route is not applicable. All six start at their source route's first cell in frame 0; check says `origins: 6/6 routes start at their arrow origin`. Dots advance toward targets then wrap; arrowheads remain visible rather than being occupied in these captures, and they do not all arrive at arrowheads in one frame. No dot rests on a box corner, route corner, bridge, junction, label or arrowhead in the pinned frames; dots sometimes sit immediately beside a label. Check: `dots: 6 single-dot routes, 0 periodic routes, 0 violations, 6 constant at 0.5c/step, 0 same-arrival at 2000ms`; `arrivals: 0/0 same-arrival routes show their dot at the arrowhead on the final step`. The separate frame audit reports evenly spaced frames, steady routes 6/6, 25 equal-distance windows, rates 0.500..0.500 cells/frame, spread 0.0 and PASS. These observations support slow uniform motion; the static dot snapshots alone do not establish subjective readability in a live pane.

Frame coordinates below are route order e1 CLI→API, e2 API→Auth, e3 API→queue, e4 queue→worker, e5 worker→Postgres, e6 Auth→Postgres. Each entry represents both the listed even-numbered frame at 100×frame ms and the immediately following frame 100 ms later; each pair has identical positions. Coordinates are (column,row).

| Frames | e1 | e2 | e3 | e4 | e5 | e6 |
|---|---|---|---|---|---|---|
| 0–1 | 39,6 | 38,14 | 40,14 | 43,28 | 42,36 | 31,28 |
| 2–3 | 39,7 | 38,15 | 40,15 | 43,29 | 42,37 | 31,29 |
| 4–5 | 39,8 | 38,16 | 40,16 | 43,28 | 42,38 | 31,30 |
| 6–7 | 39,6 | 38,17 | 40,17 | 43,29 | 42,39 | 31,31 |
| 8–9 | 39,7 | 38,18 | 40,18 | 43,28 | 42,40 | 31,32 |
| 10–11 | 39,8 | 38,19 | 40,19 | 43,29 | 42,41 | 31,33 |
| 12–13 | 39,6 | 38,20 | 40,20 | 43,28 | 41,42 | 31,34 |
| 14–15 | 39,7 | 37,21 | 40,21 | 43,29 | 40,42 | 31,35 |
| 16–17 | 39,8 | 36,21 | 41,22 | 43,28 | 42,36 | 31,36 |
| 18–19 | 39,6 | 35,21 | 42,22 | 43,29 | 42,37 | 31,37 |
| 20–21 | 39,7 | 34,21 | 40,14 | 43,28 | 42,38 | 31,38 |
| 22–23 | 39,8 | 33,21 | 40,15 | 43,29 | 42,39 | 31,39 |
| 24–25 | 39,6 | 32,21 | 40,16 | 43,28 | 42,40 | 31,40 |
| 26–27 | 39,7 | 31,22 | 40,17 | 43,29 | 42,41 | 31,41 |
| 28–29 | 39,8 | 38,14 | 40,18 | 43,28 | 41,42 | 32,42 |
| 30–31 | 39,6 | 38,15 | 40,19 | 43,29 | 40,42 | 33,42 |
| 32–33 | 39,7 | 38,16 | 40,20 | 43,28 | 42,36 | 34,42 |
| 34–35 | 39,8 | 38,17 | 40,21 | 43,29 | 42,37 | 35,42 |
| 36–37 | 39,6 | 38,18 | 41,22 | 43,28 | 42,38 | 36,42 |
| 38–39 | 39,7 | 38,19 | 42,22 | 43,29 | 42,39 | 31,28 |

The live ANSI capture independently shows dot RGB and source/destination border RGB as follows: e1 (115,161,206) / (115,161,206) / (206,115,138); e2 (206,115,138) / (206,115,138) / (219,153,170); e3 (206,115,138) / (206,115,138) / (115,206,115); e4 (115,206,115) / (115,206,115) / (153,219,153); e5 (153,219,153) / (153,219,153) / (206,161,115); e6 (219,153,170) / (219,153,170) / (206,161,115). Every dot exactly matches its source border, not its destination; e2/e3 share RGB. Check agrees: `dot hues: 6 by source, 0 by destination, 1 shared-hue pair(s) (source-only 1, destination-only 1)`. Hue comparison of Postgres uses its visible top border.

**Fit.** Check says `viewport: unknown zoom: 1.00 natural` and `extent=31x46 cells`; pinned capture says `viewport: 77x47 zoom: 1.00 natural`. Pinned frame fits the whole drawing and controls without a drag-to-pan or overflow banner; one graphical view rather than multiple diagrams, so no diagram origins or per-diagram extent lines and no inter-diagram overlap. At the target size the stated single-fitting-view description exemption applies. Live capture instead says `68x44 @100% · canvas 21x46` and `canvas 21x46 at 100% · drag to pan`: its 44-row pane cuts off the database box and label, so the full view there requires panning. The check extent and app canvas extent differ (31 vs 21 columns); do not conflate them. Check `crossings: 0 bridges, 0 touching bends` agrees with the visible drawing. No `routes:` line is expected or present. The capture's manifest reports cleanup `confirmed_closed`.

**Neutral structural observations.** Six nodes, six edges, a widest outgoing fan of two at API gateway; no reciprocal box pair; Postgres receives two independently routed arrowheads. One weakly connected world: the two paths leaving the gateway reconverge at Postgres, one through Auth and the other through queue and worker. Labels are short component names and four verbs, with no addresses, port numbers or visible qualifiers. Top-to-bottom progression looks phase-like, though the graph itself does not label phases.

**Generator classification** (generation.json, classification): `family: flow-chains`; `evidence: E ≈ N: six components carry six relations along one shallow chain (cli -> api -> {auth, queue} -> worker -> db), the source asks for slow sparse traffic on it, and there is no bus, no fan of three around a core and no identifier/qualifier content.` This is quoted as a claim, not independently verified against the withheld source. The capture visibly has two arrowheads at Postgres despite the generator's separate tie-breaker claim that there are no double-arrowhead targets.

## Canvas total / blind scorecard

Single view, not a diagram canvas: nodes 6; edges 6; routes 6; labels 10 total (6 node, 4 route); group hue families 4; pinned ranks 0; crossings 0; uncertain label owners 0; clipped items 0 at 77×47, at least Postgres label and box in actual 68×44 pane; selected-state coverage 6/6 partial-or-better, 5/6 full borders, 0 separate individual states; dot violations 0 reported and observed; near-miss routes 0 reported/observed; dot hue matches 6 source, 0 destination; shared-hue pairs 1. Diagram count for a canvas, per-diagram title/description/origin/extent, description correctness, and cross-diagram hue changes: not applicable. No source/brief/rubric/expected data were opened. Pinned capture is textual, not ANSI, so it cannot prove full Postgres border color. No provided evidence format was inaccessible.
