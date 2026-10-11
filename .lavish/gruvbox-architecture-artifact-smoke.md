# Command path: CLI to storage and back

This is a reference architecture, not a report about an inspected codebase. It fixes the responsibilities and return contracts for a command that crosses a CLI adapter, a domain service, and a storage backend.

## Target behavior

A shell invocation should cross three ownership boundaries without mixing their concerns:

1. The **CLI adapter** turns process-level input into a typed domain request.
2. The **domain service** decides what the command means and whether it is allowed.
3. The **storage backend** performs persistence and returns a storage result.
4. Success and failure both return through the same layers. Each owner translates only its own vocabulary.

The governing rule is: **translate at each boundary; never leak a lower layer's representation through an upper layer.**

## Command flow

```text
shell argv
  -> CLI adapter: parse + validate shape
  -> domain service: apply policy + orchestrate
  -> storage backend: read/write durable state

success
  <- CLI adapter: render result + exit 0
  <- domain service: domain outcome
  <- storage backend: stored record

failure
  <- CLI adapter: one actionable stderr message + non-zero exit
  <- domain service: domain failure
  <- storage backend: storage failure
```

The failure path is a return path, not an escape hatch. A storage failure first becomes a domain failure, then a process-level CLI response. The shell should not receive driver exceptions, SQL, filesystem paths, or backend-specific retry rules.

## Ownership contract

| Layer | Accepts | Owns | Returns | Must not own |
| --- | --- | --- | --- | --- |
| CLI adapter | `argv`, flags, environment | Syntax, help, display, exit codes | Typed request or process response | Business policy or persistence |
| Domain service | Typed request | Use-case policy, orchestration, domain invariants | Domain outcome or domain failure | Terminal formatting or driver details |
| Storage backend | Repository operation | Serialization, queries, durability, backend retries | Stored value or storage failure | User messaging or business policy |

## Failure walk

1. The storage backend returns `StorageFailure(kind, operation)`; it does not print or terminate the process.
2. The domain service maps that failure to `CommandFailure(code, context)` and decides whether retry is valid.
3. The CLI adapter maps the domain failure to one concise stderr message and a documented non-zero exit code.
4. The shell receives the failure. Logs may retain diagnostic detail, but the user-facing response stays stable.

## Invariants

- Dependencies point inward: CLI and storage depend on domain contracts; the domain service does not import terminal or driver concerns.
- No layer prints, exits, or catches broadly on behalf of another layer.
- Success and failure values are explicit at every boundary.
- The storage backend is replaceable without changing command syntax or domain policy.
- The CLI adapter is replaceable without changing domain behavior or stored representation.

## Acceptance test

Given a storage write failure, the shell receives one actionable message and a non-zero exit code, while no storage-specific exception or backend detail crosses the CLI boundary.
