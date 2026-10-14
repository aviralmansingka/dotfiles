# remote subagent — CI test suite

## Purpose

This suite guards the `/remote` command in
`pi/.pi/agent/extensions/remote.ts`. The command spawns a pi subagent on
the saved Herdr SSH machine `devbox` through machine API forwarding, so
agent work survives a closed MacBook. The suite proves the command
sequence, the naming, and every failure path offline — no test reaches a
real SSH target or multiplexer.

## What the suite covers

- Registration. The extension registers exactly the `remote` command with
  a description.
- Name derivation. `slugifyAgentName` caps words and length, strips
  punctuation and trailing hyphens, and falls back to `remote`.
  `pickAgentName` appends `-2`, `-3`, … on collisions and still fits the
  suffix inside the 24-character cap.
- JSON parsing. `parseTabCreate` reads the ids the next steps need and
  rejects invalid JSON and missing fields with readable errors.
  `parseAgentList` keeps named agents with their states, drops nameless
  entries, and treats a missing array as empty.
- Spawn happy path. The exact argv sequence: `agent list`, `tab create`
  with `--cwd ~` and `--no-focus`, `agent start --kind pi`, and
  `agent prompt` with the whole task as one argv element. The notify is
  info and names the attach commands.
- Name collision. A taken name yields the `-2` variant in start and
  prompt.
- Unreachable host. A failed `agent list` notifies an error with the
  `herdr machine status devbox` hint and makes no further calls.
- Start failure. The tab this run created is closed; the error says
  nothing is running.
- Prompt failure. The live agent is kept — no tab close — and the error
  says the task was not submitted and how to attach.
- Status. No args, `status`, and blank args all list remote agents plus
  attach hints; an empty list says so; an unreachable host errors.

## How to run

Provision jiti and typebox once:

    npm install --prefix /tmp/remote-jiti jiti@2 typebox@1.3.27

Then run the suite:

    JITI_PATH=/tmp/remote-jiti/node_modules/jiti/lib/jiti.cjs \
    NODE_PATH=/tmp/remote-jiti/node_modules \
    node pi/.pi/agent/extensions/remote.test.mjs

The suite runs offline and writes only to a temp directory. A fake
`herdr` binary on PATH records every call and answers from env knobs
(`REMOTE_TEST_LIST_JSON`, `REMOTE_TEST_LIST_FAIL`, `REMOTE_TEST_TAB_FAIL`,
`REMOTE_TEST_START_FAIL`, `REMOTE_TEST_PROMPT_FAIL`), so assertions check
exact argv sequences.

For coverage, install c8 into the same prefix and run it over the suite:

    npm install --prefix /tmp/remote-jiti c8
    JITI_PATH=/tmp/remote-jiti/node_modules/jiti/lib/jiti.cjs \
    NODE_PATH=/tmp/remote-jiti/node_modules \
    /tmp/remote-jiti/node_modules/.bin/c8 --reporter=text \
      --include='pi/.pi/agent/extensions/remote.ts' \
      node pi/.pi/agent/extensions/remote.test.mjs

## Runtime and SLA

The suite completes in about 0.3 s. Keep it under 2 s. It spawns only the
fake `herdr` shell script; no network, no SSH, no sleeps.

## Coverage result

c8 reports 98.5% statements, 81.8% branches, and 100% functions over
remote.ts. c8 line numbers for jiti-loaded TypeScript are approximate.
Treat the behavior assertions as the source of truth.

## Known gaps

- `pickAgentName`'s exhaustion fallback (`remote-<timestamp>` after 20
  collisions) has no test; the loop is bounded and the branch is
  defensive.
- The best-effort `tab close` failure inside the start-failure path has
  no test; the primary error notify is the one that matters.
- Live behavior was smoke-tested by hand against the real devbox (tab
  create, agent start, `agent prompt --wait`, agent read, tab close)
  before this suite was written; the suite pins those recorded shapes.
