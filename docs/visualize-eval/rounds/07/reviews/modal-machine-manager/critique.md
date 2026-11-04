# React Flow critique — modal-machine-manager

**Result: fail, not green.** This is a source-backed judgment of the React Flow capture, not a re-judgment of the baseline. The seven paired statuses and evidence references are in [reviewer-result.json](reviewer-result.json); the coordinate-by-coordinate comparison is in [convergence.md](convergence.md).

## Highest-priority findings

1. **Reciprocal route and label collapse (high):** v2 machines↔boot both use the same F x≈295 corridor and both label boxes center on F(295,926); `iPXE request` is covered by `boot.ipxe + S3 args`. The visible downward arrow makes response direction ambiguous. The round-05 pinned response label was absent, but its separate return route remained traceable. Both response and request are source-required.
2. **Routes hidden by intermediate nodes and shared corridors (high):** v1 private gRPC→Postgres passes behind River queue around F(327–343,368); v2 reconcile→providers passes behind registry at F(242–347,698–724); v3 machines→S3 passes behind agent at F(301–425,1138–1168). A source/target object in HTML cannot substitute for a visible continuous route. F v1 webapi→Slack and web→webapi also co-route in opposite directions on x433.
3. **Source semantics not restored (high):** `audit reimage` omits verify; the fastest heartbeat and slow ops qualifications are absent. F v2 recovers the response payload text but loses the separately visible request label. Do not infer facts from the unrendered structure.
4. **Motion evidence blocker:** HTML creates one circle per edge and nominal path-length-based 55 SVG px/s; screenshot alone neither verifies all 23 independently visible moving dots nor origin, speed, or full lap. Four/three/four/zero distinct marks are seen in v1–v4. Frame-0 R is known one cell late; F declares path-start origin at the port, but no time-zero screenshot validates how that differs visually from first external cell. Source also says no dots on borders.
5. **Workflow evidence blocker:** command recipe, draft HTML and digest assertions exist. Their raw outputs/statuses, digest pair, browser-close evidence and timed per-view motion captures are not preserved. These are evidence gaps, not proof of broken determinism or a reason to manufacture motion.

## Positive evidence

Every view's node/group extent fits its captured canvas without pan; group boxes have titles and contain all declared members. Normal node borders are complete. The `machine rows` label is complete in F where the pinned R capture clips its first character. The React Flow badge is chrome and does not obscure the graph. These improvements do not resolve the failures above.

The immutable pre-reveal record and its hash are embedded in the result JSON. Generator's statement that all labels are separable is contradicted by the v2 screenshot. Future work should route reciprocal edges separately, preserve source facts, and capture a timed full cycle rather than treating object counts as visual evidence.
