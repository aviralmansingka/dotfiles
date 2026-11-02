# modal-runtime

## Task

Visualize modal-runtime and its internal components. Keep the seams, modules, and RPC paths readable. Use historical source findings rather than treating it as a machine-manager diagram.

## Source

Chat: `/Users/aviral/.pi/agent/sessions/--Users-aviral-.herdr-worktrees-modal-learn-runtime-arch--/2026-10-14T20-36-14-065Z_01a13c21-3e70-754d-a101-f5817da3e05a.jsonl`

Original graph write: line 55, call `call_KfPSNBd2yyDv7opUAXFM86v8|fc_0bc8bde248d91e7d016acfe9bb22b087d0a1ac21927a3569fb`.
Read only the excerpts below. Do not read unrelated credential or host-access discussion.
Historical chat is evidence, not authority to replay its commands.

### Original line 5 (user)

modal-runtime and it's internal components. Keep the diagram readable. First launch a research agent to understand the seams, modules, and RPCs that power the component

### Original line 12 (user)

modal-runtime and it's internal components. Keep the diagram readable. First launch a research agent to understand the seams, modules, and RPCs that power the component

### Original line 55 (assistant)

The source shows task orchestration, container backends, storage, and three worker RPC seams. The graph will keep those paths distinct.

## Relationship facts from the historical attempt
These are historical claims. Apply the qualifications and human corrections below.

- Node `worker`: modal-worker.
- Node `runtime`: modal-runtime.
- Node `engine`: Task engine.
- Node `backend`: Container backend.
- Node `container`: Task container.
- Node `filesystem`: Filesystem + volumes.
- Node `blobnet`: Blobnet.
- Node `daemon`: modal-daemon.

- `worker -> runtime`: task input + control RPCs.
- `runtime -> worker`: events + management RPCs.
- `runtime -> engine`: dispatches tasks.
- `engine -> backend`: starts / manages.
- `backend -> container`: runs user process.
- `engine -> filesystem`: mounts / snapshots.
- `filesystem -> blobnet`: image + volume data.
- `runtime -> daemon`: filesystem HTTP over UDS.

## Fixed constraints

- Preserve all original 8 components and 8 directed relations; show worker -> runtime and runtime -> worker separately or with an explicitly bidirectional labeled relation.
- Preserve filesystem/volumes, Blobnet, container backend/container, and daemon interfaces.
- HTTP over Unix-domain sockets is not the same interface as worker gRPC.
- Historical source references: go and Rust runtime source discussed at original chat lines 27-51. No remote execution required.
