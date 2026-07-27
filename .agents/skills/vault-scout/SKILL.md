---
name: vault-scout
description: Explore a vault Issue or ambiguous request in an isolated Herdr workspace and worktree, resolve meaning with Wayfinder-style decisions and prototypes, and propose strict autonomous Tasks with Goals, Verifiers, and Evidence. Use when invoked as $vault-scout with an Issue link or text, or when $vault-hunter rejects work as under-specified.
---

# Vault Scout

Keep eyes on the forest while exploring one Issue deeply enough to propose autonomous work. Resolve ambiguity and
produce Tasks; do not implement an unapproved Task.

## Domain

- A **Project** contains Themes; a **Theme** contains Features; a **Feature** contains Tasks.
- An **Issue** is the durable home for ambiguous, exploratory, or not-yet-executable work.
- A **Prototype** makes a design question concrete and is disposable evidence for deciding what to build.
- A **Task** is an autonomous execution contract containing one or more Goals, stable Verifiers, and required Evidence.
- A **Goal** states an outcome. A **Verifier** defines how to decide whether it holds. **Evidence** is the reproducible
  artifact and metadata produced by running that verifier against an implementation.

Use Wayfinder terms for large efforts: destination, map, decision ticket, frontier, blocking, and fog of war. Scout
extracts meaning from ambiguity; Hunter executes the resulting Task.

## Invocation and custody

Accept `$vault-scout <issue-or-text>`.

1. Resolve an Issue from the link or text. If none exists, create the smallest Issue in the owning Feature before
   deeper work. If Feature ownership is materially ambiguous, ask the user and stop rather than creating it arbitrarily.
2. Claim one Issue and inspect only its Project, Theme, Feature, related decisions, implementation target, and applicable
   instructions.
3. The Scout parent creates or reuses one named Herdr workspace and one-pane Scout session. Use an isolated
   `scout/<issue-slug>` worktree when a repository is involved; otherwise root the workspace at the relevant vault or
   target directory. Record whether each resource was created or reused.
4. Open a Scout Run through the available Registry adapter when supported. Registry and Atlas remain observational.

Name visible agents `<runtime>-<feature-slug>-<issue-slug>-scout`. Preserve unrelated sessions, worktrees, and dirt.
Only the parent writes or commits canonical vault notes.

## Explore

Work breadth-first:

1. State the destination and known constraints.
2. Separate decisions already made, open decision tickets, blockers, frontier work, fog, and out-of-scope work.
3. Reuse prior evidence before gathering more context. Delegate bounded research only when a named uncertainty requires
   it; give each worker one question and a stop condition.
4. Prefer a cheap prototype before defining a Task. Link the Task to that prototype. Skip a new prototype only when an
   existing implementation, fixture, trace, or artifact makes every verifier concrete, and record that rationale.
5. Ask the user only for decisions that materially change the contract. Suggest a default grounded in the Issue,
   prototype, and domain model.

Never disguise an unresolved decision as an implementation detail or let a research child create canonical Task state.

## Propose Tasks

Reject Task creation until each proposed Task can be executed autonomously. A ready Task contains:

- `## Intent` with one sentence;
- `## Goals` with observable outcomes;
- `## Decisions and boundaries` with settled constraints;
- `## Verifiers` with stable `V01`, `V02`, and later IDs;
- `## Unresolved decisions` set to `None`;
- `## Evidence` describing required artifacts and reproduction metadata;
- an implementation repository or bounded non-repository target;
- a linked prototype or explicit prototype-waiver rationale; and
- an estimated token budget and safe parallelism boundary.

Each verifier states behavior, exact command or manual observation, expected baseline-red result, artifact type and
location, implementation identity, and acceptance rule. For ANSI-capable CLIs, include an ANSI-preserving terminal
screenshot plus semantic output checks. Visual evidence supplements rather than replaces deterministic assertions.

If the contract is not ready, keep the work as an Issue. Record the missing decisions, the next frontier question, and
the prototype or research that would unblock it. Do not emit a weak Task merely to create momentum.

## Handoff

Present:

- the Issue and hierarchy;
- destination, decisions, blockers, frontier, and remaining fog;
- prototype links and conclusions;
- proposed Tasks with Goals, Verifiers, Evidence, dependencies, and token budgets;
- which Tasks are autonomous-ready and which remain Issues; and
- exact workspace, worktree, Run, and cleanup state.

Ask for approval of the Task specification. On approval, leave execution to `$vault-hunter`.
