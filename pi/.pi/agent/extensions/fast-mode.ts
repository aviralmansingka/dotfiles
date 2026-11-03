/**
 * Fast mode — OpenAI priority tier by default, Fireworks fast models on demand.
 *
 * OpenAI: every request to an OpenAI provider (`openai`, `openai-codex`) for a
 * `gpt-*` model carries `service_tier: "priority"` unless the payload already
 * sets a tier. Priority is a speed tier; pi bills it at 2x (2.5x for gpt-5.5).
 * The installed catalog ships no fast model variants, so OpenAI models never
 * swap — the payload rewrite is the whole story.
 *
 * Fireworks: `service_tier` there is a reliability path, NOT speed, so it is
 * never sent. Fireworks speed comes from Fast router ids (`glm-latest` ->
 * `glm-fast-latest`, `kimi-k3` -> `kimi-k3-fast`); `/fast on|off` swaps the
 * active model to/from its Fast sibling when both are registered.
 *
 * Session state defaults to ON. Kill switch: PI_FAST_MODE in 0/off/false/no
 * (any case, trimmed) forces it off at load; `/fast on|off|toggle` then sets a
 * session override that beats the env default.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const FAST_PROVIDERS = new Set(["openai", "openai-codex"]);
const OFF_VALUES = new Set(["0", "off", "false", "no"]);

type Env = Record<string, string | undefined>;
type ModelRef = { provider?: string; id?: string };

export function fastModeEnabled(env: Env = process.env): boolean {
	return !OFF_VALUES.has((env.PI_FAST_MODE ?? "").trim().toLowerCase());
}

export function applyFastMode(
	payload: unknown,
	model: ModelRef | undefined,
	enabled: boolean = true,
): object | undefined {
	if (!enabled || !model) return undefined;
	if (!FAST_PROVIDERS.has(model.provider ?? "")) return undefined;
	if (!(model.id ?? "").startsWith("gpt-")) return undefined;
	if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return undefined;
	if ("service_tier" in payload) return undefined;
	return { ...payload, service_tier: "priority" };
}

/** Base -> Fast router id: insert `-fast` before a trailing `-latest`, else append it. */
export function fastVariantId(id: string): string {
	return id.endsWith("-latest") ? `${id.slice(0, -"-latest".length)}-fast-latest` : `${id}-fast`;
}

/** Fast -> base id: drop `-fast` before a trailing `-latest`, else drop a trailing `-fast`. */
export function baseVariantId(id: string): string {
	if (id.endsWith("-fast-latest")) return `${id.slice(0, -"-fast-latest".length)}-latest`;
	return id.endsWith("-fast") ? id.slice(0, -"-fast".length) : id;
}

function isFastVariantId(id: string): boolean {
	return id.endsWith("-fast") || id.endsWith("-fast-latest");
}

/**
 * The registered Fireworks sibling id for `id` — fast direction for a base id,
 * base direction for a Fast id — or undefined when no sibling exists.
 * deepseek, minimax, auto, firerouter, and gpt-oss ids stay alone.
 */
export function fireworksSibling(id: string, modelIds: readonly string[]): string | undefined {
	if (!id) return undefined;
	const candidate = isFastVariantId(id) ? baseVariantId(id) : fastVariantId(id);
	return modelIds.includes(candidate) ? candidate : undefined;
}

function describe(model: ModelRef | undefined, fwIds: readonly string[]): string {
	if (!model?.id) return "no active model";
	if (model.provider && FAST_PROVIDERS.has(model.provider)) {
		return model.id.startsWith("gpt-") ? `${model.id}: OpenAI priority tier` : `${model.id}: no fast variant`;
	}
	if (model.provider === "fireworks") {
		if (isFastVariantId(model.id)) return `${model.id}: Fireworks fast variant active`;
		const sibling = fireworksSibling(model.id, fwIds);
		return sibling
			? `${model.id}: Fireworks fast sibling ${sibling} available`
			: `${model.id}: no Fireworks fast sibling`;
	}
	return `${model.id}: no fast variant`;
}

export default function fastMode(pi: ExtensionAPI): void {
	let enabled = fastModeEnabled();

	pi.on("before_provider_request", (event, ctx) => applyFastMode(event.payload, ctx?.model, enabled));

	pi.registerCommand("fast", {
		description: "Toggle fast mode: OpenAI priority tier, Fireworks fast models",
		handler: async (args, ctx) => {
			const notify = (message: string, type: "info" | "warning" = "info") => ctx.ui.notify(message, type);
			const arg = (args ?? "").trim().toLowerCase();
			if (arg && arg !== "on" && arg !== "off" && arg !== "toggle") {
				notify(`Usage: /fast [on|off|toggle] (got "${arg}")`, "warning");
				return;
			}
			const model = ctx.model;
			const fwModels = (ctx.modelRegistry?.getModelsOfType("chat", "fireworks") ?? []) as ModelRef[];
			const fwIds = fwModels.map((m) => m.id ?? "");
			if (!arg) {
				notify(`Fast mode ${enabled ? "ON" : "OFF"} — ${describe(model, fwIds)}`);
				return;
			}
			const turningOn = arg === "on" || (arg === "toggle" && !enabled);
			enabled = turningOn;
			const alreadyFast = !!model?.id && isFastVariantId(model.id);
			if (model?.provider !== "fireworks" || !model.id || turningOn === alreadyFast) {
				notify(`Fast mode ${turningOn ? "ON" : "OFF"} — ${describe(model, fwIds)}`);
				return;
			}
			const siblingId = fireworksSibling(model.id, fwIds);
			const sibling = siblingId ? fwModels.find((m) => m.id === siblingId) : undefined;
			if (!siblingId || !sibling) {
				notify(
					`Fast mode ${turningOn ? "ON" : "OFF"} — ${model.id} has no ${turningOn ? "Fast" : "base"} sibling registered`,
					"warning",
				);
				return;
			}
			const swapped = await pi.setModel(sibling as Parameters<typeof pi.setModel>[0]);
			notify(
				swapped
					? `Fast mode ${turningOn ? "ON" : "OFF"} — switched ${model.id} -> ${siblingId}`
					: `Fast mode ${turningOn ? "ON" : "OFF"} — could not switch to ${siblingId}`,
				swapped ? "info" : "warning",
			);
		},
	});
}
