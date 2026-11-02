# Attempt log — modal-machine-manager, round 01 (DeepSeek generator)

Frozen renderer for every attempt: `/tmp/visualize-eval/round-01/bin/rataflow-view`
(sha256 `4a883e73b822f009c504bd21d0c2fc383067bf1b83b9791ccbda431912e3a1d8`).
Budget: at most three local spec attempts per view.

| view | attempt | spec | direction / layers | nodes | edges | `--check` result | outcome |
|---|---|---|---|---|---|---|---|
| v1 | a1 | `probe/v1-a1.json` | tb, 6 layers | 9 | 8 | `extent=48x45`, no warnings, exit 0 | **final** |
| v2 | a1 | `probe/v2-a1.json` | tb, 2 layers (3 boxes in the lower row) | 4 | 4 | `extent=63x14`, 1 skipped label, exit 0 | **final** |
| v2 | a2 | `probe/v2-a2.json` | lr, 2 layers (3 boxes stacked) | 4 | 4 | `extent=55x19`, no warnings, exit 0 | rejected |
| v2 | a3 | `probe/v2-a3.json` | tb, 2 layers, 3 nodes | 3 | 3 | `extent=44x14`, 1 skipped label, exit 0 | rejected |
| v3 | a1 | `probe/v3-a1.json` | tb, 4 layers (`mch` / `agent`,`pgrpc` / `pub`,`q`,`rec` / `db`) | 7 | 6 | `extent=63x30`, 1 skipped label, exit 0 | **final** |
| v3 | a2 | `probe/v3-a2.json` | tb, 4 layers, writers staggered two-deep | 7 | 6 | `extent=43x31`, 2 skipped labels, exit 0 | rejected |
| v3 | a3 | `probe/v3-a3.json` | tb, 4 layers, all four writers in one row | 7 | 6 | exit 1: `no obstacle-safe route for rec -> db; increase node/layer spacing` | rejected (renderer could not route it) |
| v4 | a1 | `probe/v4-a1.json` | tb, 4 layers | 7 | 6 | `extent=60x30`, no warnings, exit 0 | **final** |

Checks are stored verbatim in `checks/<attempt>.out`, `.err`, `.exit` (this directory).

## Why the rejected attempts were rejected

- **v2 a2 (lr)** — checked clean, but the render put `pull image` and `iPXE request`
  in the two one-row gaps between three adjacent horizontal stubs leaving the
  machines box. Each label was then the same distance from the `machines → boot`
  route and the `machines → S3` route, so a reader can bind the iPXE label to the
  image-pull line. Evidence: `probe/v2-a2_render.txt` (and its `stty size` record
  `probe/v2-a2_dimensions.txt`); the kept layout is `probe/v2-a1_render.txt`.
- **v2 a3 (3 nodes)** — removing `machines → agent` (already drawn in v3) freed no
  label slot: one label was still skipped, and the view lost a relation without
  gaining a legible one.
- **v3 a2 (staggered writers)** — two labels were skipped instead of one: the long
  `private gRPC → Postgres` diagonal consumed the fan-in slots.
- **v3 a3 (four writers in one row)** — the router refuses the graph outright
  (`no obstacle-safe route for rec -> db`). Recorded as a layout blocker, not
  papered over.

## Kept honest results

- **v2 a1** keeps all four routes with visible arrowheads and three labels that sit
  directly beside their own stems. The fourth label (`boot.ipxe`, the boot server's
  reply) is the one the renderer skipped; the return route itself is drawn.
- **v3 a1** keeps every writer route to Postgres with its own arrowhead; the
  `public gRPC → Postgres` label (`machine state`) is the one skipped.

Both dropped labels are the renderer's free-slot decisions at these densities, not
removed facts: the relations are in the specs and in both captures' routes.
