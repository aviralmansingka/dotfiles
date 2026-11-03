# Brief — server-nic-layout (detail-complete ask)

**Framing:** detail-complete. "Everything, and I'll navigate."
**Facts:** unchanged from `docs/visualize-eval/cases/server-nic-layout/source.md`
(`source_sha256 235d296fef435710c8a49bcd247455c8c82b844e71726f146c4cedf227d0308b`).
This brief changes only the voice of the request.
**Triage annex:** `TRIAGE-server-nic-layout` (generator-task.md, TRIAGE PROTOCOL).
Expected triage load: light — the shape preference is explicit; the open
questions are about coverage, not size.

## The request

> Show me the whole server1 picture, not a summary. Eight physical NICs with one
> live, the /29 with every address accounted for, the neighbour, the router, and
> the hops the trace actually answered. Keep the "not cabled" and "free" and
> "historical" qualifiers where they belong — I don't want them tidied away. If
> holding all of it means a bigger canvas that I pan around, fine: label each
> part clearly and I'll navigate. I just don't want a pretty diagram that drops
> the dark ports.

## The reader's job

An audit pass. They will move from port to port and address to address and check
their own notes against the drawing. They will also re-read the qualifiers to see
which facts were observed and which were inferred. They are willing to pan and
zoom; they are not willing to guess.

## What this framing exercises

- **Triage:** light-to-medium. The canvas offer is explicit, but the skill still
  has to ask whether the qualifiers stay and whether unobserved fabric switches
  get drawn — and answer "no" from the source, not from taste.
- **Canvas:** the positive case, and the first test of the dual fit rule: a single
  concept taken together with its qualifiers and addresses may not fit 77x47, so
  a described canvas is legitimate — but only with a drawn title and an accurate
  description per diagram, and per-diagram extents reported by `--check`.
- **Density:** nine nodes, nine relations, plus seven dark ports and three free
  addresses folded into nodes and labels — the coverage pressure is in the
  qualifiers, not the node count.
- **Identity-map habits:** every address, AS number, OUI and qualifier is a
  ledger row before any spec exists.
- **Motion:** optional in `cases.json`; the source never animates, so the honest
  answer is static with a recorded N/A reason.

## What must not change

Every fact from `source.md`: `dark -> s1` "no cable", `s1 -> nic` only uplink,
`nic -> gw` 0.1 ms, `s2 -> gw` same /29, `spare -> gw` free in /29,
`gw -> airtel` 1.8 ms, `airtel -> airtelbb` 7.1 ms, `airtelbb -> cf` 8.3 ms;
plus the fixed constraints — no WhatsApp/SSH access, MAC OUI does not prove a ToR
role, inactive interfaces do not prove no cable, unresponsive addresses do not
prove free, and no invented spine/leaf switches.
