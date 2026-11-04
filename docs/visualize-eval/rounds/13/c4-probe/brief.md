# Brief — C4 probe: explain modal-machine-manager with C4 diagrams (owner-requested)

**Framing:** architectural. The reader asked to "explain the machine
manager using the C4 diagrams." The C4 model (Simon Brown) explains a
system at four zoom levels; this eval asks for the levels that fit the
source's granularity:

- **Level 1 — System Context:** the machine manager as ONE box, with
  the actors and external systems around it: humans + mmctl, Slack
  (notifications), S3 (object storage), the bare-metal provider(s), and
  the machines as a deployment target. One-line relations with their
  qualifiers.
- **Level 2 — Container:** the deployable/runtime units — public gRPC
  API, private gRPC API, webapi server, River job queue, reconcile
  loop, provider registry, Postgres, S3, SSH+BMC ops, janitor, boot
  server, machine-agent. This is where most of the 23 source relations
  live most naturally.
- **Level 3 — Component (optional):** the internals of ONE container
  (e.g. the control plane's webapi: auth, intake, jobs, persistence).
  Include only if the source's facts support it; do not invent internals
  the source never states.
- **Level 4 — Code:** out of scope (class-level; the source has none).

**Facts:** ONLY `docs/visualize-eval/cases/modal-machine-manager/source.md`.
Same frozen dataset file, same 23 relations, same components — the C4
lens reorganizes, it never drops: every source relation must appear at
its most-fitting level, and `generation.json` must carry a coverage map
(relations -> level). C4's zoom semantics mean a context-level edge
EXPANDS into several container-level edges — record that expansion in the
map rather than repeating a relation verbatim at the wrong zoom.

**Reader's job:** understand the system top-down — context first, then
containers, then (maybe) one container's internals.

**Expected form:** one canvas, described diagrams per level, following
the skill's view ladder and the round-13 canvas rules (uniform dividers,
top divider included). The triage protocol applies.
