# pi-mcp-adapter patch tests

Run `node scripts/test-pi-mcp-adapter-patch.mjs` from the repository root.

## Purpose

The npm package `pi-mcp-adapter` has one upstream bug. Its OAuth flow writes
the authorization URL with `console.log` when the caller gives no
`onAuthorizationUrl`. In an interactive Pi session, that write lands in the
middle of a frame and corrupts the footer. `scripts/pi-mcp-adapter-patch`
applies a small, idempotent source patch to the installed copy.
`install.sh` runs the patch. This suite proves the patch is safe to repeat.

## Overview

`dist/main.js` in Pi sets `shouldTakeOverStdout = appMode !== "interactive"`.
So in an interactive TUI session, an extension's `console.log` goes straight
to the tty. The footer is redrawn on a frame timer. A raw line from an
extension lands between frame writes. The result is a broken footer, and the
agent cannot start MCP authentication.

The adapter calls the bad line at `mcp-auth-flow.ts:1064`. The live path that
gives no `onAuthorizationUrl` is `ensureBackgroundAuthWatcher` in
`proxy-modes.ts`. `mcp({action:"auth-start"})` and `mcp({action:"install", url})`
for an OAuth server both reach it.

## What the patch changes

Three exact string matches in `proxy-modes.ts`:

1. Add a `reportAuthorizationUrl` helper. It sends an `info` notification and
   a `mcp-oauth-required` transcript message. The user can copy the URL.
2. `ensureBackgroundAuthWatcher`: pass `onAuthorizationUrl` in `authOptions`.
3. `attemptAutoAuth`: build one `autoAuthOptions` object with
   `onAuthorizationUrl`, then make one `authenticate` call.

The marker `function reportAuthorizationUrl(` means the file is patched. A
second run prints `already patched (VERSION)` and writes nothing. `--check`
prints `patched` or `unpatched` and never writes. If an anchor is missing, the
script writes nothing, names the anchor and the adapter version, and exits 1.
If the package is not installed, it prints `pi-mcp-adapter not installed` and
exits 0, so `install.sh` never fails.

## How to re-derive the patch after an upgrade

1. Run `node scripts/pi-mcp-adapter-patch --check`. `unpatched` means the
   upgrade replaced `proxy-modes.ts`.
2. Run the patch. If it fails, read the anchor name in the error.
3. Diff the new `proxy-modes.ts` against the fixture
   `scripts/fixtures/pi-mcp-adapter/proxy-modes.excerpt.ts`. Update the three
   anchor strings in the script to the new text. Keep the inserted helper.
4. Refresh the fixture excerpt from the new installed file, and update its
   README version line.
5. Run the suite. A green run proves the new anchors match.

## How to run

```sh
node scripts/test-pi-mcp-adapter-patch.mjs
node scripts/pi-mcp-adapter-patch --check
```

## Runtime and SLA

About 0.4 s on a warm host. The suite starts seven short Node processes. The CI
entry limit is 120 s.

## Coverage result

7 checks pass:

- a pristine fixture gets all three edits.
- a second run is a no-op and keeps the file byte-identical.
- `--check` reports `patched` with exit 0 and does not write.
- `--check` reports `unpatched` with exit 1 and does not write.
- a file with one anchor removed exits 1, names the anchor, and stays
  byte-identical.
- a missing package directory exits 0.
- `PI_CODING_AGENT_DIR` resolves the default package path.

## Known gaps

The suite proves the string patch on the committed fixture, not on the live
installed package. The live tree is checked by hand:
`node scripts/pi-mcp-adapter-patch --check` must print `patched`. The suite
also does not run the OAuth flow. That needs a live Pi session and a network,
which the repository rules keep out of CI.
