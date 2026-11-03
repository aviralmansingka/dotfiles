/**
<<<<<<< Updated upstream
 * Fast mode — OpenAI priority tier, Fireworks fast router models.
 *
 * OpenAI (`openai`, `openai-codex`) `gpt-*` requests carry `service_tier:
 * "priority"` unless the payload sets a tier already. That is a reliability
 * path billed at 2x (2.5x for gpt-5.5), not a speed path, and the installed
 * codex catalog ships no fast variants — so it is a payload rewrite. Fireworks
 * never gets a tier: its speed comes from Fast router ids, so `/fast on` swaps
 * `glm-latest` -> `glm-fast-latest`. Ids with no Fast sibling (deepseek,
 * minimax, auto, firerouter, gpt-oss) never swap.
 *
 * State lives in one globalThis slot (fast-mode-slot.mjs): the loader builds
 * jiti with moduleCache: false, so every copy of this module gets its own
 * closure, and the payload hook, /fast, and the prompt bubble must read the
 * shared value. PI_FAST_MODE in {0, off, false, no} sets the startup default;
 * `/fast on|off` overrides it for the session.
=======
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
>>>>>>> Stashed changes
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fastModeSlot, notifyFastModeChange, resolveFastModeDefault, setFastModeEnabled } from "./fast-mode-slot.mjs";

const FAST_PROVIDERS = new Set(["openai", "openai-codex"]);
const FIREWORKS = "fireworks";

type Env = Record<string, string | undefined>;
<<<<<<< Updated upstream
type ModelLike = { provider?: string; id?: string };
type AnyModel = Parameters<ExtensionAPI["setModel"]>[0];
type Context = {
	model?: ModelLike;
	modelRegistry: { getModelsOfType(type: "chat", provider: string): readonly ModelLike[] };
	ui: { notify(message: string, level?: "info" | "warning" | "error"): void };
};
=======
type ModelRef = { provider?: string; id?: string };
>>>>>>> Stashed changes

/** PI_FAST_MODE parse — the startup default only; the live value is the slot. */
export function fastModeEnabled(env: Env = process.env): boolean {
	return resolveFastModeDefault(env);
}

export function applyFastMode(
	payload: unknown,
<<<<<<< Updated upstream
	model: ModelLike | undefined,
	enabled: boolean = fastModeSlot().getEnabled(),
=======
	model: ModelRef | undefined,
	enabled: boolean = true,
>>>>>>> Stashed changes
): object | undefined {
	if (!enabled || !model) return undefined;
	if (!FAST_PROVIDERS.has(model.provider ?? "")) return undefined;
	if (!(model.id ?? "").startsWith("gpt-")) return undefined;
	if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return undefined;
	if ("service_tier" in payload) return undefined;
	return { ...payload, service_tier: "priority" };
}

<<<<<<< Updated upstream
/** Base id -> Fast router id: insert `-fast` before a trailing `-latest`, else append it. */
export function fastIdFor(id: string): string | undefined {
	if (/(^|-)fast(-latest)?$/.test(id)) return undefined;
	return id.endsWith("-latest") ? `${id.slice(0, -7)}-fast-latest` : `${id}-fast`;
}

/** Fast router id -> base id: drop `-fast`, then restore a trailing `-latest`. */
export function baseIdFor(id: string): string | undefined {
	if (id.endsWith("-fast-latest")) return `${id.slice(0, -12)}-latest`;
	if (id.endsWith("-fast")) return id.slice(0, -5);
	return undefined;
}

/** The registry model a swap should land on; undefined when this id has no sibling there. */
export function siblingModel<M extends ModelLike>(
	model: ModelLike | undefined,
	models: readonly M[],
	want: "fast" | "base",
): M | undefined {
	if (!model?.id) return undefined;
	const id = want === "fast" ? fastIdFor(model.id) : baseIdFor(model.id);
	return id ? models.find((m) => m.id === id) : undefined;
}

function describe(model: ModelLike | undefined, models: readonly ModelLike[]): string {
	if (!model?.id) return "no active model";
	if (FAST_PROVIDERS.has(model.provider ?? "")) return "OpenAI priority tier on gpt-* requests";
	const fast = siblingModel(model, models, "fast");
	if (fast) return `fast sibling ${fast.id} available`;
	const base = baseIdFor(model.id);
	return base ? `fast variant of ${base}` : "no fast variant for it";
}

export default function fastMode(pi: ExtensionAPI): void {
	const slot = fastModeSlot();

	const fireworks = (ctx: Context): readonly ModelLike[] =>
		ctx?.model?.provider === FIREWORKS ? ctx.modelRegistry.getModelsOfType("chat", FIREWORKS) : [];

	const current = (ctx: Context): string => {
		const model = ctx?.model;
		return `${model?.id ?? "no model"}: ${describe(model, fireworks(ctx))}`;
	};

	const setEnabled = async (ctx: Context, next: boolean): Promise<void> => {
		setFastModeEnabled(next);
		notifyFastModeChange();
		const label = next ? "ON" : "OFF";
		const model = ctx?.model;
		const models = fireworks(ctx);
		const target = model?.provider === FIREWORKS ? siblingModel(model, models, next ? "fast" : "base") : undefined;
		if (!target) {
			ctx.ui.notify(`Fast mode ${label} — ${current(ctx)}`, "info");
			return;
		}
		const switched = await pi.setModel(target as unknown as AnyModel);
		ctx.ui.notify(
			switched
				? `Fast mode ${label} — ${model.id} -> ${target.id}`
				: `Fast mode ${label} — could not switch to ${target.id} (no auth configured for ${FIREWORKS})`,
			switched ? "info" : "error",
		);
	};

	pi.registerCommand("fast", {
		description: "Toggle fast mode — OpenAI priority tier, Fireworks fast models",
		handler: async (args, ctx) => {
			const arg = (args ?? "").trim().toLowerCase();
			const c = ctx as unknown as Context;
			if (!arg) {
				ctx.ui.notify(`Fast mode ${slot.getEnabled() ? "ON" : "OFF"} — ${current(c)}`, "info");
				return;
			}
			if (arg === "on") return setEnabled(c, true);
			if (arg === "off") return setEnabled(c, false);
			if (arg === "toggle") return setEnabled(c, !slot.getEnabled());
			ctx.ui.notify("Usage: /fast [on | off | toggle]", "warning");
		},
	});

	pi.on("before_provider_request", (event, ctx) => applyFastMode(event.payload, ctx?.model, slot.getEnabled()));
=======
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
>>>>>>> Stashed changes
}
