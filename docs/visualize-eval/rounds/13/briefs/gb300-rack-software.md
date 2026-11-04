# Brief — gb300-rack-software (plane-separation ask)

**Framing:** plane separation. Two worlds that must not bleed into each other.
**Facts:** unchanged from
`docs/visualize-eval/cases/gb300-rack-software/source.md`
(`source_sha256 10d440af0be8d3730c448e710a48d4dfbd527a966f532084e7f98fd2d4b83fda`).
This brief changes only the voice of the request.
**Triage annex:** `TRIAGE-gb300-rack-software` (generator-task.md, TRIAGE
PROTOCOL). Expected triage load: medium — the trunk and the free-software rule
are stated; the plane split and canvas question are real choices.

## The request

> Two separate worlds, and I want to see that they're separate. The out-of-band
> world: the management LAN, the compute BMCs, the NVSwitch BMCs, the power
> shelf, and nv-rms sitting over them. The in-band world: Kubernetes, the GPU
> Operator, DCGM and its exporter, the driver, NVOS, NMX-C/T, Fabric Manager.
> One trunk coming out of the OOB LAN that splits exactly once into the BMC and
> power-shelf branches — not a swarm of lines that happen to touch. And nothing
> that costs money: if a tool needs a licence, it isn't in the picture.

## The reader's job

Deciding, per component, which plane it lives in and which controller reaches it.
They will check two specific claims — that nv-rms is a client on the OOB LAN
rather than part of it, and that DCGM has no OOB edge — and they will look for
routes that appear to cross the plane boundary without a reason.

## What this framing exercises

- **Triage:** medium. Whether the two worlds share one canvas or get a described
  diagram each materially changes the result, and the reader has a preference;
  the skill must ask, not assume.
- **Canvas:** branch B is the natural answer (two planes, one canvas, one diagram
  per world) and the test is that the plane boundary is drawn as space and a few
  long edges, never as a box, and that each diagram's description says which
  world it holds.
- **Traceability:** the flagship round-13 case for `passes-near-unrelated-node`.
  The named a3 defect — `nvos -> nmxc` and the in-band routes hugging the OOB LAN
  until they read as connected — is exactly what this framing forbids. Ring
  violations, not just overlaps, count.
- **Density:** thirteen nodes, eleven relations, with a trunk that fans to three
  branches and a five-node in-band chain (`k8s -> gpuop -> dcgm -> drvk -> fm`,
  plus the `dcgm -> dcgmx` side relation).
- **Grouping:** case-wide hue families so a reader can tell OOB from in-band in
  every diagram; a plane that changes hue across diagrams fails.
- **Motion:** optional in `cases.json`; the source animates nothing, so the
  honest result is static.

## What must not change

Every node and relation of `source.md`, the ONE OOB trunk splitting ONCE into
compute BMC, NVSwitch BMC and power shelf, NVOS hosting NMX-C/T and rms reaching
NVOS, protocols where the excerpts give them, and the fixed constraints — exclude
paid-only software (Mission Control, UFM, NetQ), never draw OOB -> DCGM, do not
promote the unlabeled DCGM/driver/Fabric-Manager chain into an invented deploy
dependency, and keep driver/CUDA/DCGM/Fabric Manager on compute hosts rather than
on the GPU die.
