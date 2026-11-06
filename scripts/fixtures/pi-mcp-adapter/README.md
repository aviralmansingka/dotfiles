# pi-mcp-adapter fixture

`proxy-modes.excerpt.ts` is a verbatim excerpt of `proxy-modes.ts` from
`pi-mcp-adapter` 7.0.1, the two functions `scripts/pi-mcp-adapter-patch`
edits: `ensureBackgroundAuthWatcher` and `attemptAutoAuth`. Only the header
comment and the `// …` elision markers are ours.

Upstream package: `pi-mcp-adapter`, MIT License, Copyright (c) 2026 Nico
Bailon.

The excerpt is the test fixture for `scripts/test-pi-mcp-adapter-patch.mjs`.
It carries the three patch anchors exactly, so a passing test proves the
script's string matches still hold. An adapter upgrade that changes these
functions needs a new excerpt, taken the same way from the installed
`proxy-modes.ts`, and re-derived anchors in the patch script.
