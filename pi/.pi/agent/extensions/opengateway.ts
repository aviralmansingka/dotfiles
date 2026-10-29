/**
 * OpenGateway provider — registers the OpenGateway token gateway
 * (opengateway.ai, Korean-based; UltraFast models served by Sionic AI)
 * as a pi chat provider.
 *
 * The gateway speaks the OpenAI Chat Completions protocol at
 * https://apis.opengateway.ai/v1, so this registration delegates streaming
 * to pi's built-in openai-completions implementation. No custom stream,
 * no OAuth: authentication is a single API key resolved from the
 * OPENGATEWAY_API_KEY environment variable (same interpolation syntax as
 * models.json — "$OPENGATEWAY_API_KEY"). Add the key to ~/.env; it is
 * never committed (auth state is local-only by repo policy).
 *
 * authHeader must be true: registerProvider configs default it to false,
 * and openai-completions does not add an Authorization header itself, so
 * omitting it would send unauthenticated requests.
 *
 * Scope: only deepseek/deepseek-v4.1-flash-ultrafast — the model this
 * deployment bought tokens for. To expose more gateway models later, add
 * entries to MODELS below (catalog: https://apis.opengateway.ai/v1/models)
 * or overlay them from the local ~/.pi/agent/models.json, which composes
 * above extension-registered providers.
 *
 * Cost fields pin the gateway's LIST prices, not the scheduled promo
 * prices: the UltraFast discount windows (90%/50% off, quoted in KST
 * windows) change daily, so list is the stable conservative bound. Pi cost
 * metadata drives display and accounting only — the gateway bills whatever
 * rate is live at request time.
 *
 * thinkingLevelMap hides minimal/xhigh/max: pi passes unmapped levels
 * through as reasoning_effort strings, and this gateway's effective enum
 * is the standard low/medium/high set. "off" sends no reasoning_effort;
 * whether the upstream then disables DeepSeek thinking is the gateway's
 * translation decision.
 *
 * promptCache is left unset: Sionic's cache retention for this model is
 * unpublished, so the model stays ineligible for cache warming rather
 * than spending on guessed lifetimes.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const OPENGATEWAY_BASE_URL = "https://apis.opengateway.ai/v1";
export const OPENGATEWAY_API_KEY_SPEC = "$OPENGATEWAY_API_KEY";

export const MODELS = [
	{
		id: "deepseek/deepseek-v4.1-flash-ultrafast",
		name: "DeepSeek V4.1 Flash UltraFast",
		reasoning: true,
		thinkingLevelMap: { minimal: null, xhigh: null, max: null },
		input: ["text", "image"] as ("text" | "image")[],
		contextWindow: 1_000_000,
		maxTokens: 65_536,
		// List prices per million tokens; scheduled promos bill lower.
		cost: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
	},
];

export default function opengatewayProvider(pi: ExtensionAPI): void {
	pi.registerProvider("opengateway", {
		name: "OpenGateway",
		baseUrl: OPENGATEWAY_BASE_URL,
		api: "openai-completions",
		apiKey: OPENGATEWAY_API_KEY_SPEC,
		authHeader: true,
		models: MODELS,
	});
}
