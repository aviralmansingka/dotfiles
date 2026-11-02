/**
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
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fastModeSlot, notifyFastModeChange, resolveFastModeDefault, setFastModeEnabled } from "./fast-mode-slot.mjs";

const FAST_PROVIDERS = new Set(["openai", "openai-codex"]);
const FIREWORKS = "fireworks";

type Env = Record<string, string | undefined>;
type ModelLike = { provider?: string; id?: string };
type AnyModel = Parameters<ExtensionAPI["setModel"]>[0];
type Context = {
	model?: ModelLike;
	modelRegistry: { getModelsOfType(type: "chat", provider: string): readonly ModelLike[] };
	ui: { notify(message: string, level?: "info" | "warning" | "error"): void };
};

/** PI_FAST_MODE parse — the startup default only; the live value is the slot. */
export function fastModeEnabled(env: Env = process.env): boolean {
	return resolveFastModeDefault(env);
}

export function applyFastMode(
	payload: unknown,
	model: ModelLike | undefined,
	enabled: boolean = fastModeSlot().getEnabled(),
): object | undefined {
	if (!enabled || !model) return undefined;
	if (!FAST_PROVIDERS.has(model.provider ?? "")) return undefined;
	if (!(model.id ?? "").startsWith("gpt-")) return undefined;
	if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return undefined;
	if ("service_tier" in payload) return undefined;
	return { ...payload, service_tier: "priority" };
}

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
}
