# Shared context — pi-durable research run (2026-11-26)

Read this first. Do not re-derive these facts; cite them as "verified".

## Main question

What is `@earendil-works/pi-durable`, how does its durable runtime work, and how do host
harnesses receive and show its events? Test the user claim (H1): "the only thing pi-durable
is missing is a UI for the harness to display the events."

H1 is a hypothesis, not a fact. Accept it only if the evidence supports it.

## Verified package facts

- `@earendil-works/pi-durable@1.6.1`, published `2026-11-25T13:36:14Z`.
- Description: "Durable conversation, task, and document runtime for Pi".
- Repo field: `github.com/earendil-works/pi`, directory `packages/durable`. MIT.
  `github.com/earendil-works/pi-durable` is HTTP 404 — not a repo.
- `engines.node: >=22.19.0`.
- README opens with: "> **Experimental.** The API changes without notice between releases."
- Extracted tarball (local, read-only use):
  `/Users/aviral/dotfiles/research/pi-durable-2026-11-26/src/pi-durable/`
  - `README.md` (1154 lines), `CHANGELOG.md` (439 lines), `dist/` (102 `.js`, ~100 `.d.ts`).
- Subpath exports: `.`, `./env`, `./env/node`, `./codemode`, `./tool-search`, `./tools`,
  `./images`, `./images/fit`, `./images/node`, `./images/cloudflare`, `./storage/memory`,
  `./storage/indexeddb`, `./storage/jsonl`, `./storage/jsonl/node`, `./storage/store`,
  `./storage/sqlite`, `./storage/sqlite/cloudflare`, `./storage/sqlite/node`, `./testing`.
- Runtime deps: `@earendil-works/chord@1.6.1`, `pi-ai@1.6.1`, `pi-codemode@1.6.1`,
  `pi-schema@1.6.1`, `pi-telemetry@1.6.1`, `@silvia-odwyer/photon@0.3.3`, `diff@8.0.4`.
  It does **not** depend on `pi-agent-core`, `pi-coding-agent`, or `pi-web-ui`.
- Release timeline (npm `time`): 1.0.3 2026-10-05, 1.3.0 2026-10-15, 1.4.0 2026-10-21,
  1.5.0 2026-11-02, 1.5.2 2026-11-10, 1.6.0 2026-11-20, 1.6.1 2026-11-25.

## Verified README/CHANGELOG facts (starting points, verify the detail yourself)

- "Watching a Conversation" (README ~line 578): "Everything a UI needs is committed state."
  `root.watch()` returns a Chord `WatchHandle`; each `{kind:"value", value, ops}` call carries
  a `ConversationView` (`entries` window, `docs["pi.live"]`, `pi.inbox`, `pi.usage`,
  `pi.agent`, `pi.provider`) plus Chord operations. `ConversationTranscript.merge()` gives a
  client-side transcript with "load earlier" and gap items. `watch(context, from)` resumes.
- Sync observers also exist: `harness.observeConversation`, `observeTaskGraph`,
  `observeDoc`, `observeCommits`.
- CHANGELOG line ~124: `watchEvents()`, `AgentEvent`, `AgentEventStream`, `SnapshotEvent`,
  `MessageChange`, `ToolEventCall` were **removed**. Reason given: "A renderer renders state
  instead of assembling it from events". Issue earendil-works/pi#11327.
- README table of contents line 27 links `#agent-events-experimental`, but no section with
  that heading exists in the file (dangling TOC entry).
- Related npm packages: `@earendil-works/chord@1.6.1` ("Object runtime for apps across
  processes: contracts, documents, a store, links, plugins with hot reload, HTTP, workers,
  web and terminal clients"), `@earendil-works/pi-protocol@1.1.0` ("Transport-neutral CBOR
  protocol for remote pi sessions"), `@earendil-works/pi-client@1.1.0`.
- `@earendil-works/pi-web-ui@0.75.3` is the newest web-ui release; `time.modified`
  2026-05-27; deps `pi-ai@^0.75.3`, `pi-tui@^0.75.3`; peers `lit@^3.3.1`,
  `@mariozechner/mini-lit@^0.2.0`. It is on the older 0.x line, not 1.6.x.
- Third-party storage adapters exist on npm: `@netzlabor/pi-durable-postgres@0.2.0`,
  `@gscode1/pi-durable-postgres@0.4.0`.

## Local Pi install (read only)

`/Users/aviral/.pi/agent/install/releases/1.6.0/node_modules/@earendil-works/`
has `pi-agent-core`, `pi-ai`, `pi-codemode`, `pi-coding-agent`, `pi-mcp`, `pi-schema`,
`pi-telemetry`, `pi-tui`. Pi docs: that tree, `pi-coding-agent/docs/`
(`rpc.md`, `rpc-commands.md`, `rpc-extension-ui.md`, `extensions.md`, `sdk.md`).
Note the version skew: local Pi is 1.6.0, the pi-durable tarball is 1.6.1.

## Public dependents / examples to inspect

`earendil-works/pi-durable-cloudflare`, `disler/durable-pi`, `finnvoor/PiDurableKit`,
`TannerMidd/pi-pocket`, `HazAT/ultimate`, `vercel-labs/durable-harness`,
`The-Vibe-Company/companion`, `xiaomoBoy/pi-durable-assistant`, `Crokily/pi-durable-bot`.

## Rules for every researcher

- Do not change any file. Do not start other agents. Do not run installs or live sessions.
- Return a brief as your final message (the orchestrator saves it).
- Separate observed facts, calculations, and inferences. Keep links and version numbers.
- If evidence is thin, say so; do not fill gaps with plausible guesses.
- Prefer primary sources: the local tarball, npm registry metadata, GitHub repos/raw files.
