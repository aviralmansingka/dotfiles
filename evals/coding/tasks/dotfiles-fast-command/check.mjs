// Behaviour-only check for the /fast command.
//
// Drives the registered command and the payload hook the way pi does, and
// asserts the session state machine, the Fireworks sibling swap and the
// payload rewrite. Helper names are never imported, so any internal design
// that behaves correctly passes.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { callHook, commandCtx, fail, loadExtension, ok } from "../../lib/pi-harness.mjs";

const SELF = fileURLToPath(import.meta.url);
const EXT = "pi/.pi/agent/extensions/fast-mode.ts";
const IDS = ["glm-latest", "glm-fast-latest", "kimi-k3", "kimi-k3-fast", "deepseek-v3", "auto"];
const models = IDS.map((id) => ({ provider: "fireworks", id }));
const gptCtx = { provider: "openai", id: "gpt-5.5" };

export function drive(handlers) {
  const name = [...handlers.keys()].find((n) => /provider_request|before_provider/i.test(n));
  if (!name) fail(`no before_provider_request hook (registered: ${[...handlers.keys()].join(", ") || "none"})`);
  return callHook(handlers, name, { type: "before_provider_request", payload: { model: "gpt-5.5" } }, { model: gptCtx });
}

async function boot() {
  const surface = await loadExtension(EXT);
  const cmd = [...surface.commands.keys()].find((n) => /fast/i.test(n));
  if (!cmd) fail(`no /fast command registered (registered: ${[...surface.commands.keys()].join(", ") || "none"})`);
  return { ...surface, cmd };
}

// Phase 2 runs with PI_FAST_MODE=off: the env default must be overridable.
if (process.env.FAST_OFF_PHASE === "1") {
  const { handlers, commands, cmd } = await boot();
  if (drive(handlers) !== undefined) fail("PI_FAST_MODE=off did not switch fast mode off at load");
  const { ctx } = commandCtx({ model: { provider: "openai", id: "gpt-5.5" }, models });
  await commands.get(cmd).handler("on", ctx);
  const out = drive(handlers);
  if (!out || out.service_tier !== "priority") fail("/fast on did not override PI_FAST_MODE=off");
  ok("/fast on overrides a PI_FAST_MODE=off default");
  process.exit(0);
}

const { handlers, commands, cmd, models: swapped } = await boot();
const command = commands.get(cmd);

async function run(arg, model) {
  const { ctx, notes } = commandCtx({ model, models });
  await command.handler(arg, ctx);
  return notes;
}

if (!drive(handlers)) fail("fast mode is not on by default");
if ((await run("", { provider: "openai", id: "gpt-5.5" })).length === 0) fail("`/fast` with no argument reported nothing");

await run("off", gptCtx);
if (drive(handlers) !== undefined) fail("/fast off did not stop the payload rewrite");
await run("on", gptCtx);
if (!drive(handlers)) fail("/fast on did not restart the payload rewrite");

// Fireworks: sibling swap through the registry.
await run("on", { provider: "fireworks", id: "glm-latest" });
if (swapped.at(-1)?.id !== "glm-fast-latest") fail(`no swap to the Fast sibling, got ${JSON.stringify(swapped.at(-1))}`);
await run("off", { provider: "fireworks", id: "glm-fast-latest" });
if (swapped.at(-1)?.id !== "glm-latest") fail(`no swap back to the base model, got ${JSON.stringify(swapped.at(-1))}`);

await run("on", { provider: "fireworks", id: "kimi-k3" });
if (swapped.at(-1)?.id !== "kimi-k3-fast") fail("no swap for kimi-k3");

const before = swapped.length;
const noSibling = await run("on", { provider: "fireworks", id: "deepseek-v3" });
if (swapped.length !== before) fail("a model without a Fast sibling was swapped");
if (noSibling.length === 0) fail("no report for a model without a Fast sibling");

if ((await run("bogus", gptCtx)).length === 0) fail("an unknown argument printed nothing");

const off = spawnSync(process.execPath, [SELF], { env: { ...process.env, PI_FAST_MODE: "off", FAST_OFF_PHASE: "1" }, encoding: "utf8" });
if (off.status !== 0) {
  process.stdout.write(off.stdout ?? "");
  process.stderr.write(off.stderr ?? "");
  fail("env-off override phase failed");
}

ok("/fast reports state, toggles the hook, swaps Fireworks siblings through the registry and handles bad input");
