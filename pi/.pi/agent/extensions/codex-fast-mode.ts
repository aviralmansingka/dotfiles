import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { writeFileSync } from "node:fs";

const FAST_MODE_EVENT = "fast-mode:changed";
const STATE_ENTRY = "fast-mode";
const SUPPORTED_PROVIDERS = new Set(["fireworks", "openai", "openai-codex"]);
const DEFAULT_FAST_TIER = "priority";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function initialFastModeEnabled(): boolean {
  const raw =
    process.env.PI_FAST_MODE ??
    process.env.PI_OPENAI_CODEX_FAST_MODE ??
    process.env.PI_OPENAI_SUBSCRIPTION_FAST_MODE ??
    "1";
  return !/^(0|false|off|no)$/i.test(raw.trim());
}

function configuredServiceTier(): string {
  const raw = (
    process.env.PI_FAST_SERVICE_TIER ??
    process.env.PI_OPENAI_CODEX_SERVICE_TIER ??
    process.env.PI_OPENAI_SUBSCRIPTION_SERVICE_TIER ??
    DEFAULT_FAST_TIER
  ).trim();
  return raw.toLowerCase() === "fast" ? DEFAULT_FAST_TIER : raw || DEFAULT_FAST_TIER;
}

function isStreamingTextPayload(payload: Record<string, unknown>): boolean {
  return (
    typeof payload.model === "string" &&
    payload.stream === true &&
    (Array.isArray(payload.input) || Array.isArray(payload.messages))
  );
}

export function applyFastMode(
  payload: unknown,
  provider: string | undefined,
  enabled: boolean,
  tier = DEFAULT_FAST_TIER,
): unknown {
  if (!provider || !SUPPORTED_PROVIDERS.has(provider) || !isRecord(payload) || !isStreamingTextPayload(payload)) {
    return payload;
  }
  const serviceTier = enabled ? tier : "default";
  return payload.service_tier === serviceTier ? payload : { ...payload, service_tier: serviceTier };
}

export function parseFastModeArgument(args: string, current: boolean): boolean | "status" | undefined {
  switch (args.trim().toLowerCase()) {
    case "":
    case "toggle":
      return !current;
    case "on":
    case "1":
    case "true":
      return true;
    case "off":
    case "0":
    case "false":
      return false;
    case "status":
      return "status";
    default:
      return undefined;
  }
}

function writeProbe(payload: unknown, provider: string | undefined, enabled: boolean): void {
  const probePath = process.env.PI_FAST_MODE_PROBE ?? process.env.PI_OPENAI_CODEX_FAST_MODE_PROBE;
  if (!probePath || !isRecord(payload)) return;
  writeFileSync(
    probePath,
    JSON.stringify({ enabled, provider, model: payload.model, service_tier: payload.service_tier }, null, 2),
  );
}

export default function (pi: ExtensionAPI) {
  let enabled = initialFastModeEnabled();
  const tier = configuredServiceTier();
  const publish = () => pi.events.emit(FAST_MODE_EVENT, { enabled, tier });

  pi.on("session_start", (_event, ctx) => {
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== STATE_ENTRY || !isRecord(entry.data)) continue;
      if (typeof entry.data.enabled === "boolean") enabled = entry.data.enabled;
    }
    publish();
  });

  pi.on("before_provider_request", (event, ctx) => {
    const payload = applyFastMode(event.payload, ctx.model?.provider, enabled, tier);
    writeProbe(payload, ctx.model?.provider, enabled);
    return payload === event.payload ? undefined : payload;
  });

  pi.registerCommand("fast", {
    description: "Toggle priority service tier for OpenAI and Fireworks (on|off|status)",
    getArgumentCompletions: (prefix) => {
      const options = ["on", "off", "status"];
      const matches = options.filter((value) => value.startsWith(prefix.trim().toLowerCase()));
      return matches.length ? matches.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const next = parseFastModeArgument(args, enabled);
      if (next === undefined) {
        ctx.ui.notify("Usage: /fast [on|off|status]", "error");
        return;
      }
      if (next !== "status") {
        enabled = next;
        pi.appendEntry(STATE_ENTRY, { enabled });
        publish();
      }
      ctx.ui.notify(`Fast mode ${enabled ? `on (${tier})` : "off"}`, "info");
    },
  });
}
