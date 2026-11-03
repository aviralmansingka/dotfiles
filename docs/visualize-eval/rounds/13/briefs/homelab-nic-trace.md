# Brief — homelab-nic-trace (troubleshooting ask)

**Framing:** troubleshooting. The reader wants one path end to end.
**Facts:** unchanged from `docs/visualize-eval/cases/homelab-nic-trace/source.md`
(`source_sha256 abe8b376eccd7d0027f2985aab55ed656603b2094c275ee66ed223a57421b4c4`).
This brief changes only the voice of the request.
**Triage annex:** `TRIAGE-homelab-nic-trace` (generator-task.md, TRIAGE PROTOCOL).
Expected triage load: medium — the main path is stated, but the role of the
Wi-Fi, overlay and virtual nets is a real question.

## The request

> I'm chasing why this box reaches the internet the way it does. Start at the
> host and walk me out: bond0, the Fios router, the ONT, the Verizon edge, the
> backbone, Cloudflare — I want to follow that single path with my finger, hop by
> hop. The Wi-Fi backup and the Tailscale encapsulation have to be there, but
> they're secondary; I need to see them without them tangling into the main line.
> Same for the libvirt and Docker bridges — they're local, keep them local.

## The reader's job

Following one chain and stopping at each hop to check a claim: 0.5 ms to the
gateway, 4.5 to the edge, 6.6 to the backbone, 6-9 to Cloudflare. The diagram is
a troubleshooting instrument, so a route that wanders, a hop that looks joined to
a neighbouring box it never touches, or a branch that appears from a line the
reader cannot account for destroys the instrument.

## What this framing exercises

- **Triage:** medium. The main path and the secondary paths are named; whether the
  local virtual nets share the pane or get their own described diagram is a
  genuine choice, and the reader leaves it to the generator.
- **Canvas:** either rung is legitimate, and the choice must be recorded with the
  fact that decided it. A canvas split by path (egress / local virtual / overlay)
  is the natural second rung; one pane is the first.
- **Density:** thirteen nodes, fourteen relations in three clusters — the local
  virtual cluster (`vm`, `virbr`, `ctr`, `dkbr`), the host/uplink cluster and the
  egress chain.
- **Traceability:** the strong test of the round-13 near-miss class. The egress
  chain runs past the host and uplink boxes; the overlay route (`ts -> bond0`)
  must not hug `box` or the router on its way. Direction must be unambiguous at
  every hop.
- **Motion:** optional in `cases.json`, and the source never shows motion, so a
  static surface with a recorded source-backed N/A reason is the honest result;
  the annex allows dots only if they help follow a hop.

## What must not change

Every fact from `source.md`: the fourteen relations in their stated direction,
the addresses and metrics, the ULA-only IPv6 note and the collapsed-Fios reading;
plus the fixed constraints — traceroute hops and MAC-vendor roles are historical
interpretations, the ONT and router identity stay qualified, the five path kinds
stay separate, and nothing is probed.
