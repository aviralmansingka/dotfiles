Extend the existing fast-mode extension with a `/fast` command that toggles fast mode and handles two providers differently.

## Existing code (on main, do not rewrite from scratch)

- `pi/.pi/agent/extensions/fast-mode.ts` (39 lines): exports `fastModeEnabled(env)`, `applyFastMode(payload, model, env)`, and a default factory that registers `before_provider_request`. Sets `service_tier: "priority"` for provider `openai`/`openai-codex` with a `gpt-*` model id, unless the payload already has `service_tier`. `PI_FAST_MODE` in {0,off,false,no} disables it.
- `pi/.pi/agent/extensions/fast-mode.test.mjs` (103 lines): `node:test`, loaded via the shared `test-lib/jiti.mjs` + agent-package stub, mirroring `opengateway.test.mjs`.

## Verified API facts (pi 1.4.0, do not re-derive)

- `pi.registerCommand(name, { description, handler: async (args, ctx) => {} })`.
- `pi.setModel(model): Promise<boolean>`.
- `ctx.model` is the active `Model` (has `provider`, `id`); `ctx.modelRegistry.getModelsOfType("chat", "fireworks")` lists fireworks chat models; `ctx.ui.notify(message, "info" | "warning" | "error")`.
- Fireworks `service_tier: "priority"` is a reliability path, NOT speed. Fireworks speed comes from Fast router model ids. So do not send service_tier to fireworks.

## Behaviour to build

1. Session fast-mode state, default ON (today's behaviour). `PI_FAST_MODE=off` still forces it off at load. An explicit `/fast on` or `/fast off` sets a session override that beats the env default. Keep the state in the factory closure and pass it into `applyFastMode` instead of the raw env, so the hook follows the command.

2. Command `/fast`:
   - No argument: report state (on/off), the active model id, and what fast mode does for it (OpenAI priority tier, Fireworks fast sibling available or not, otherwise "no fast variant"). Use `ctx.ui.notify`.
   - `on` / `off` / `toggle`: set the state. When turning ON with the active model on provider `fireworks`, switch to its Fast sibling if one exists in `ctx.modelRegistry.getModelsOfType("chat", "fireworks")`. When turning OFF with a Fast sibling active, switch back to the base model. Report the swap, or that no sibling exists, via `ctx.ui.notify`. Unknown arguments print usage.
   - OpenAI models never swap; the payload hook covers them.
   - Await `pi.setModel` and respect its boolean result (report failure).

3. Sibling mapping helper, exported for tests:
   - base -> fast: `glm-latest` -> `glm-fast-latest`; `kimi-k3` -> `kimi-k3-fast`. Rule: if the id ends with `-latest`, insert `-fast` before `-latest`; otherwise append `-fast`.
   - fast -> base: `glm-fast-latest` -> `glm-latest`; `kimi-k3-fast` -> `kimi-k3`. Rule: remove `-fast` before a trailing `-latest`, else remove a trailing `-fast`.
   - Only swap when the candidate id exists among the fireworks chat models. Models without a sibling (deepseek, minimax, auto, firerouter, gpt-oss) must be left alone.

4. Keep the file under ~130 lines. No new deps, no config file, no logging of payloads, no network.

## Tests (`fast-mode.test.mjs`, extend it)

Cover: default on; `/fast off` stops the payload rewrite; `/fast on` re-enables it; env-off default is overridden by `/fast on`; base->fast and fast->base mapping for `glm-latest`, `kimi-k3`, `glm-fast-latest`, `kimi-k3-fast`; a no-sibling id returns undefined and never swaps; the command swaps the model via a stub `pi.setModel` and reports through a stub `ctx.ui.notify`; unknown argument prints usage. Keep tests fake-only: no live sessions, no nvim, tmux, or herdr.

## Verify

- `node --test pi/.pi/agent/extensions/fast-mode.test.mjs`
- `node scripts/test-extension-loader.mjs`
- `bash scripts/nm-test.sh` (auto-discovers `*.test.mjs`; do not hand-edit any list). Report pre-existing failures separately, and confirm your suite passes.
- `bash scripts/nm-lint.sh`

Do not touch `~/.pi/agent`, `AGENTS.md`, `models.json`, or MCP config. Commit only the two changed files.
