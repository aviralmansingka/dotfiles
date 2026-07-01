import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { writeFileSync } from "node:fs";

// Prefer the low-latency OpenAI Codex service tier for ChatGPT Plus/Pro
// subscription-backed sessions. OpenAI's API names this tier "priority";
// Codex CLI presents the same idea as service_tier = "fast".
const DEFAULT_FAST_TIER = "priority";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fastModeEnabled(): boolean {
  const raw = process.env.PI_OPENAI_CODEX_FAST_MODE ?? process.env.PI_OPENAI_SUBSCRIPTION_FAST_MODE ?? "1";
  return !/^(0|false|off|no)$/i.test(raw.trim());
}

function configuredServiceTier(): string {
  const raw = (
    process.env.PI_OPENAI_CODEX_SERVICE_TIER ??
    process.env.PI_OPENAI_SUBSCRIPTION_SERVICE_TIER ??
    DEFAULT_FAST_TIER
  ).trim();

  // Match Codex CLI naming while sending the service tier Pi/OpenAI expect.
  if (raw.toLowerCase() === "fast") return "priority";
  return raw || DEFAULT_FAST_TIER;
}

function looksLikeCodexSubscriptionPayload(payload: Record<string, unknown>): boolean {
  return (
    typeof payload.model === "string" &&
    payload.model.startsWith("gpt-") &&
    typeof payload.instructions === "string" &&
    payload.stream === true &&
    payload.store === false &&
    Array.isArray(payload.input)
  );
}

function writeProbe(payload: Record<string, unknown>, enabled: boolean): void {
  const probePath = process.env.PI_OPENAI_CODEX_FAST_MODE_PROBE;
  if (!probePath) return;
  writeFileSync(
    probePath,
    JSON.stringify(
      {
        enabled,
        model: payload.model,
        service_tier: payload.service_tier,
        stream: payload.stream,
        store: payload.store,
      },
      null,
      2,
    ),
  );
}

export default function (pi: ExtensionAPI) {
  pi.on("before_provider_request", (event) => {
    if (!isRecord(event.payload) || !looksLikeCodexSubscriptionPayload(event.payload)) return undefined;
    if (!fastModeEnabled()) {
      writeProbe(event.payload, false);
      return undefined;
    }

    const serviceTier = configuredServiceTier();
    const payload =
      event.payload.service_tier === serviceTier ? event.payload : { ...event.payload, service_tier: serviceTier };
    writeProbe(payload, true);
    return payload;
  });
}
