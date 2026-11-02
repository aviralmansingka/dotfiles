/**
 * Fast mode — OpenAI priority service tier by default.
 *
 * Every request to an OpenAI provider (`openai`, `openai-codex`) for a `gpt-*`
 * model carries `service_tier: "priority"` unless the payload already sets a
 * tier. Both the Responses API and chat completions honor the field; pi bills
 * priority at 2x (2.5x for gpt-5.5). The installed codex catalog no longer
 * ships fast model variants, so this is a payload rewrite, not a model alias.
 *
 * Kill switch: set PI_FAST_MODE to 0, off, false, or no (any case, trimmed) to
 * leave payloads untouched. Unset — or any other value — keeps fast mode on.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const FAST_PROVIDERS = new Set(["openai", "openai-codex"]);
const OFF_VALUES = new Set(["0", "off", "false", "no"]);

type Env = Record<string, string | undefined>;

export function fastModeEnabled(env: Env = process.env): boolean {
	return !OFF_VALUES.has((env.PI_FAST_MODE ?? "").trim().toLowerCase());
}

export function applyFastMode(
	payload: unknown,
	model: { provider?: string; id?: string } | undefined,
	env: Env = process.env,
): object | undefined {
	if (!fastModeEnabled(env) || !model) return undefined;
	if (!FAST_PROVIDERS.has(model.provider ?? "")) return undefined;
	if (!(model.id ?? "").startsWith("gpt-")) return undefined;
	if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return undefined;
	if ("service_tier" in payload) return undefined;
	return { ...payload, service_tier: "priority" };
}

export default function fastMode(pi: ExtensionAPI): void {
	pi.on("before_provider_request", (event, ctx) => applyFastMode(event.payload, ctx?.model));
}
