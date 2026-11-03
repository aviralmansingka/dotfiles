# Brief — modal-runtime (ambiguous ask)

**Framing:** ambiguous. Vague about scope on purpose — triage is the exercise.
**Facts:** unchanged from `docs/visualize-eval/cases/modal-runtime/source.md`
(`source_sha256 c6e4552d5842347bc9472e53a2351897c3624c92b5a14541aaa3c28216dc4a0d`).
This brief changes only the voice of the request.
**Triage annex:** `TRIAGE-modal-runtime` (generator-task.md, TRIAGE PROTOCOL).
Expected triage load: heavy — scope, reader's job, shape and motion are all open.

## The request

> Can you diagram modal-runtime for me? It keeps coming up and I don't have a
> clear picture of it.

That is the whole request. Nothing about which components, nothing about the
reader's job, nothing about size. The annex supplies what a live user would say
when asked — which is the point: the skill's Step 0 has to get there first.

## The reader's job

Once triaged: understand which seam carries which protocol, across all eight
components and their eight relations, without the worker gRPC path blurring into
the filesystem HTTP path. They will look at it while reading the runtime source,
so a seam that reads as two things at once is worse than a seam that needed its
own described diagram.

## What this framing exercises

- **Triage:** heavy, and the strictest test of the persistent loop. A vague ask
  must produce focused questions — scope, reader's job, panes-vs-canvas, motion,
  and the machine-manager false lead — and then stop. A generator that asks
  nothing fails the honesty bar; one that keeps asking after the picture is clear
  fails it too.
- **Canvas:** resolved by triage, not by node count. One pane if the
  anti-parallel pair fits; a described canvas if the labels need room. Either is
  legitimate if the recorded reason matches the evidence.
- **Density:** eight components, eight relations, with an anti-parallel pair
  (`worker -> runtime` / `runtime -> worker`) that must be two edges in one view —
  or an evidenced yield.
- **Motion:** optional in `cases.json` and never shown in the source; the annex
  says keep it static, so this case should carry an explicit source-backed N/A
  rather than leaving applicability unknown.
- **Labels:** the failure this case repeats round after round. `task input +
  control RPCs` and `events + management RPCs` must each have one owner, and no
  route may pass near a box it does not touch (round-13 near-miss class).

## What must not change

All eight components and eight directed relations of `source.md`, both directions
of the worker/runtime pair drawn separately or explicitly bidirectional, the
`filesystem -> blobnet`, container backend/container and daemon interfaces kept
distinct, and the fixed constraint that HTTP over Unix-domain sockets is not the
worker gRPC interface.
