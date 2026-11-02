Add a pi extension that makes OpenAI models use fast mode (priority service tier) by default.

## Context (verified facts, do not re-litigate)

- Repo: dotfiles at the worktree root. Extensions live in `pi/.pi/agent/extensions/`; that dir is symlinked to `~/.pi/agent/extensions`, so a new file there loads on the next session.
- pi 1.4.0 exposes the hook `before_provider_request`. Its event is `{ type, payload: unknown }` and a returned value replaces the payload (see `docs/extensions.md` in the installed package, example `examples/extensions/provider-payload.ts`).
- The handler's second arg `ctx` is `ExtensionContext`, which has `model: Model<any> | undefined`. Model has `provider` and `id`.
- `service_tier` is honored by both the Responses API (`openai-responses`, `openai-codex-responses`) and chat completions. Valid values include `priority` (fast) and `flex` (slow, half price). pi prices `priority` at 2x, or 2.5x for `gpt-5.5`.
- Installed pi codex catalog has no fast model variants; commit 266234047 removed them upstream. So this must be a payload rewrite, not a model variant.

## What to build

1. New file `pi/.pi/agent/extensions/fast-mode.ts`, TypeScript, same style as the neighbouring extensions (`export default function (pi: ExtensionAPI) {...}`).
2. In `before_provider_request`: read `ctx?.model`. Apply only when the provider is `openai` or `openai-codex` AND the model id starts with `gpt-` AND the payload is a non-null object AND it does not already carry a `service_tier` key. Then return `{ ...payload, service_tier: "priority" }`. Never mutate the incoming object; return a copy. Return nothing in all other cases.
3. Kill switch: if `process.env.PI_FAST_MODE` is set and trims to a falsy word (`0`, `off`, `false`, `no`, case-insensitive), do nothing. Unset or any other value keeps fast mode on. Document this in a short top-of-file comment.
4. No logging of payload contents, no network calls, no config file, no `/fast` command. Keep it under ~50 lines.
5. Test `pi/.pi/agent/extensions/fast-mode.test.mjs`, plain `node:test` + `node:assert/strict`, no live sessions, no network. Match the style of an existing `*.test.mjs` next to it. Cover: gpt model on `openai` gets `service_tier: "priority"`; `openai-codex` same; non-gpt id untouched; provider `fireworks` untouched; payload that already has `service_tier: "flex"` is preserved; `PI_FAST_MODE=off` disables; returned object is a copy, input not mutated. Export whatever small helper the test needs (e.g. `applyFastMode(payload, model)`), keeping the default export thin.
6. Run `node --test pi/.pi/agent/extensions/fast-mode.test.mjs` and `bash scripts/nm-test.sh` (the repo discovers every `pi/.pi/agent/extensions/**/*.test.mjs` automatically; do not hand-edit any test list). Both must pass. Do not run nvim, tmux, herdr, or any live pi session.

## Constraints

- Do not touch `~/.pi/agent` (outside the repo), do not edit `AGENTS.md`, do not add deps.
- Do not change `models.json` or any MCP config.
- Commit only the two new files with a conventional message.
