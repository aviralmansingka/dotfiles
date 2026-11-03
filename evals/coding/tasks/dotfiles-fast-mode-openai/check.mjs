// Behaviour-only check for the OpenAI fast-mode extension.
//
// Drives the extension the way pi does - load the default export, find the
// before_provider_request hook, feed it payloads - and asserts the rewrite
// rules from the brief. No helper name is assumed, so any internal design that
// behaves correctly passes.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { callHook, fail, loadExtension, ok } from "../../lib/pi-harness.mjs";

const SELF = fileURLToPath(import.meta.url);
const EXT = "pi/.pi/agent/extensions/fast-mode.ts";

if (process.env.FAST_OFF_PHASE === "1") {
  // Fresh process with PI_FAST_MODE=off: the hook must leave everything alone.
  const { handlers } = await loadExtension(EXT);
  const ctx = { model: { provider: "openai", id: "gpt-5.5" } };
  const out = callHook(handlers, pickHook(handlers), { type: "before_provider_request", payload: { model: "gpt-5.5" } }, ctx);
  if (out !== undefined) fail("PI_FAST_MODE=off still rewrote the payload");
  ok("PI_FAST_MODE=off disables the rewrite");
  process.exit(0);
}

function pickHook(handlers) {
  const names = [...handlers.keys()];
  const hit = names.find((n) => /provider_request|before_provider/i.test(n));
  if (!hit) fail(`no before_provider_request hook registered (registered: ${names.join(", ") || "none"})`);
  return hit;
}

const { handlers } = await loadExtension(EXT);
const hook = pickHook(handlers);

function drive(payload, model) {
  return callHook(handlers, hook, { type: "before_provider_request", payload }, { model });
}

const base = { model: "gpt-5.5", input: [{ role: "user", content: "hi" }] };
const fast = drive(base, { provider: "openai", id: "gpt-5.5" });
if (!fast || fast.service_tier !== "priority") fail(`openai gpt model not sent at priority tier: ${JSON.stringify(fast)}`);
if (base.service_tier !== undefined) fail("the incoming payload was mutated");
if (fast === base) fail("the incoming payload object was returned instead of a copy");
if (fast.input !== base.input) fail("payload contents were not preserved");

const codexFast = drive({ model: "gpt-5.1-codex" }, { provider: "openai-codex", id: "gpt-5.1-codex" });
if (!codexFast || codexFast.service_tier !== "priority") fail("openai-codex gpt model not sent at priority tier");

if (drive({ model: "o3" }, { provider: "openai", id: "o3" }) !== undefined) fail("non-gpt model was rewritten");
if (drive({ model: "gpt-5.5" }, { provider: "fireworks", id: "gpt-5.5" }) !== undefined) fail("other provider was rewritten");
if (drive({ model: "glm-latest" }, { provider: "fireworks", id: "glm-latest" }) !== undefined) fail("fireworks model was rewritten");
if (drive({ model: "gpt-5.5" }, undefined) !== undefined) fail("a missing model was rewritten");
if (drive(null, { provider: "openai", id: "gpt-5.5" }) !== undefined) fail("a null payload was rewritten");

const flex = { model: "gpt-5.5", service_tier: "flex" };
const flexOut = drive(flex, { provider: "openai", id: "gpt-5.5" });
if (flexOut !== undefined) fail("an explicit service_tier was overridden");
if (flex.service_tier !== "flex") fail("an explicit service_tier was mutated");

const off = spawnSync(process.execPath, [SELF], {
  env: { ...process.env, PI_FAST_MODE: "off", FAST_OFF_PHASE: "1" },
  encoding: "utf8",
});
if (off.status !== 0) {
  process.stdout.write(off.stdout ?? "");
  process.stderr.write(off.stderr ?? "");
  fail("the PI_FAST_MODE kill switch does not disable the rewrite");
}

ok("fast-mode rewrites gpt models on openai/openai-codex, copies the payload, honours an explicit tier and the kill switch");
