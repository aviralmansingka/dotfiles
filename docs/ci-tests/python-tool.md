# python tool — CI test suite

## Purpose

This suite guards the `python` tool in `pi/.pi/agent/extensions/python.ts`.
The tool runs Python code through `uv run python -` in the session cwd.
The extension also blocks bash calls that only run inline Python.
The suite proves both behaviors with real execution, not source checks.

## What the suite covers

- Registration. The extension registers the tool name, label, parameter
  schema, description, prompt snippet, prompt guidelines, and annotations.
- Execution. The tool runs real Python through uv. The tests check the
  session cwd, separate stdout and stderr, the exit code, and `durationMs`.
- Output cap. Output above 256 KiB is cut. The details set the `truncated`
  flag. The stdout length equals the cap exactly.
- Timeout. A slow script dies at the timeout. A `timeoutMs` below the 1 s
  floor clamps up to 1 s, not down.
- Abort. An abort signal kills the child mid-run and sets the `aborted` flag.
- Input guard. Empty or blank code returns an error. No child starts.
- Spawn guard. A missing uv binary returns a structured error. The error
  names uv and tells how to fix it.
- tool_call guard. The suite blocks heredoc variants: quoted and unquoted
  tags, `<<-`, with and without the stdin dash, env-prefixed, after a title
  comment, versioned, and flagged. The suite blocks `python -c` one-liners,
  with flags and with chain characters inside quotes. The block reason
  names the python tool. The suite passes script files, `python3 -m`,
  `pip install`, chained lines, piped lines, and `uv run` script calls.
  Non-bash tools stay untouched.

## How to run

Provision jiti and typebox once:

    npm install --prefix /tmp/py-jiti jiti@2 typebox@1.3.27

Then run the suite:

    JITI_PATH=/tmp/py-jiti/node_modules/jiti/lib/jiti.cjs \
    NODE_PATH=/tmp/py-jiti/node_modules \
    node pi/.pi/agent/extensions/python.test.mjs

uv must be on PATH. The suite runs offline. It writes only to a temp
directory.

For coverage, install c8 and run it over the suite:

    npm install --prefix /tmp/py-cov c8
    JITI_PATH=/tmp/py-jiti/node_modules/jiti/lib/jiti.cjs \
    NODE_PATH=/tmp/py-jiti/node_modules /tmp/py-cov/node_modules/.bin/c8 \
      --reporter=text --include='pi/.pi/agent/extensions/python.ts' \
      node pi/.pi/agent/extensions/python.test.mjs

## Runtime and SLA

The suite completes in about 2.4 s. Keep it under 5 s. Each uv call costs
between 0.2 s and 1 s. Timeout tests run a `time.sleep(30)` fixture with a
1 s timeout. The kill fires near the timeout. Add no test that waits more
than 1 s.

## Coverage result

c8 reports about 97% statements, 85% branches, and 100% functions. c8 line
numbers for jiti-loaded TypeScript are approximate. Treat the behavior
assertions as the source of truth.

## Known gaps

- The SIGTERM, 5 s grace, SIGKILL escalation needs more than 5 s of wall
  time. A manual check verified it. The suite omits it to hold the SLA.
  This escalation was dead code before this suite landed: the old `killed`
  flag stopped the SIGKILL call. The fix sends kills to the whole process
  group, so a child that traps SIGTERM still dies at the grace deadline.
- The spawn synchronous-throw catch has no test. It needs invalid spawn
  arguments. Behavior tests cannot reach it.
- The 120 s default and the 600 s clamp arm have no test. They need runs
  longer than the SLA.
- The heredoc classification exists here and in `tool-call-renderer-public.ts`.
  A consolidation is deferred. Do not refactor the renderer from this suite.
