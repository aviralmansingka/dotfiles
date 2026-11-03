# Brief — pipeline (quick-reference ask)

**Framing:** quick reference, alive beside the chat while the reader works.
**Facts:** unchanged from `docs/visualize-eval/cases/pipeline/source.md`
(`source_sha256 68aa197fdc597c3a22d1b8ca88a3ebee861dcda34684da15ae69b6946b741e58`).
This brief changes only the voice of the request.
**Triage annex:** `TRIAGE-pipeline` (generator-task.md, TRIAGE PROTOCOL).
Expected triage load: light — the framing states the shape, so the generator
converges after one pass and records the questions its framing already answered.

## The request

> Give me something for this pipeline that I can keep open next to my chat —
> a small diagram I can read at a glance while I'm working. Six things: the CLI,
> the API gateway, auth, the job queue, the worker pool, Postgres. I want to see
> that auth reads the database and the workers write to it, and I want to see the
> traffic moving, slowly, so I can tell the direction apart from the speed.

## The reader's job

Glancing left of the chat and back, repeatedly, while running jobs. They are not
studying the diagram; they are confirming which way traffic goes and that the two
database paths are separate. Anything that needs dragging, or a second look to
identify a box, has already failed them.

## What this framing exercises

- **Triage:** light. The shape preference (one side-by-side view) and the reader's
  job are inside the request; the persistence clause still has to stop asking
  once the picture is clear instead of padding questions.
- **Canvas:** the negative case. A canvas here would be the wrong rung — this is
  the ladder's rung 1, and choosing rung 2 without a fit-proof attempt fails
  `layout_fit`'s branch rule and `navigation_clarity`'s separability.
- **Density:** six nodes, six relations — the small end of the case set, so the
  test is whether the generator pads the layout or invents side structure.
- **Motion:** required by `cases.json` and by the request. Constant speed, sparse
  dots, one per animated hop; direction readable, speed not a measurement.
- **Labels:** the two database paths (`read` from auth, `write` from workers) must
  keep distinct owners — a shared "db" label is the failure this case exists for.

## What must not change

Every node, relation direction and fixed constraint from `source.md`: the six
components, `cli -> api` and `queue -> worker` unlabeled (do not invent a
protocol), `api -> auth` verify, `api -> queue` enqueue, `worker -> db` write,
`auth -> db` read, plus semantic tiers, related shades, a plain background and no
border dots.
