import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ────────────────────────────────────────────────────────────────────────
// `mermaid` — validated Mermaid diagram generation.
//
// The agent passes a detailed spec (diagram type, nodes, edges, direction).
// The tool writes the diagram with a nested model call (default
// openai-codex/gpt-6.1-sol at max thinking; override with
// PI_MERMAID_MODEL=provider/id), validates it with mmdflux — a strict
// Mermaid parser that needs no browser — retries with the parse error fed
// back until it parses, then runs a second nested call that reads the
// rendered Unicode art against the spec ("verify by looking", adapted:
// the art is text, so a model can look at it) and retries on mismatch.
// Layout patterns come from ~/.agents/skills/mermaid/SKILL.md at call time
// (PI_MERMAID_SKILL overrides the path; a small fallback catalog applies
// when the file is absent), so the skill stays the single source of truth
// at zero parent-context cost. The validated diagram renders as Unicode
// art in the tool-result row, and the source returns as a fence the agent
// echoes verbatim. This replaces inline fence generation, which could ship
// diagrams that do not parse — or parse and still lie.
// ────────────────────────────────────────────────────────────────────────

const DEFAULT_MODEL_PROVIDER = "openai-codex";
const DEFAULT_MODEL_ID = "gpt-6.1-sol";
const DEFAULT_REASONING_EFFORT = "max";
const DEFAULT_MAX_ATTEMPTS = 4;
const MMDFLUX_TIMEOUT_MS = 30_000;
const OUTPUT_CAP = 512 * 1024;

export const MERMAID_BASE_PROMPT = [
	"You write Mermaid diagrams.",
	"Output exactly one ```mermaid fenced block and nothing else. No prose before or after.",
	"Keep the diagram small: few nodes, short labels, roots at the top, the goal node as the sink.",
	"Use plain node and edge syntax only. Do not use experimental or beta diagram types.",
	"The diagram must pass a strict Mermaid parser. When a parser error is given back, fix it and output the full corrected diagram.",
	"Node budget: at most ~7 nodes. If the spec lists more, cut the nodes and labels that do not earn their place; keep the idea intact. A diagram of 4 nodes that each pull weight beats one of 12 that fight for space.",
	"Truth: if an edge or label is uncertain, omit it rather than assert something false. Do not invent content. If the spec is thin, draw the smaller true diagram.",
	"If the spec needs a spatial or geometric picture (coordinates, vectors, function plots, exact positions) that Mermaid auto-layout cannot express, output exactly `NONE: <one-line reason>` and nothing else.",
].join("\n");

const CHAT_ASPECT_RULES = [
	"Aspect rules: the transcript is narrow; height is free. Target width under 60 columns.",
	"Prefer TD. Use LR only for 4 ranks or fewer. Labels: one or two words.",
	"Prefer the wrap pattern over serpentine for chat: the TUI fence renderer ignores inner subgraph directions.",
].join("\n");

const FALLBACK_CATALOG = [
	"Pattern catalog (fallback; the mermaid skill file was not found):",
	"- chain: flowchart LR, one node per step. Use for 6 linear steps or fewer.",
	"- tree: flowchart TD, one root, children fan out.",
	"- pipeline: flowchart TD, one subgraph per stage, stages link in order.",
	"- hub-and-spoke: flowchart TD, hub on top, spokes below, hub links each spoke.",
	"- fishbone: flowchart LR, causes above and below feed one spine node.",
	"- cycle: the last node links back to the first.",
	"- grid: subgraph rows, one row of peers per subgraph.",
	"- wrap: rows read left-to-right; the last node of each row links down to the first node of the next.",
	"- zones: subgraphs named for ownership or phase; arrows cross the borders.",
].join("\n");

/** Load the pattern catalog from the mermaid skill at call time; fallback when absent. */
export function loadPatternCatalog(): string {
	const skillPath = process.env.PI_MERMAID_SKILL || join(homedir(), ".agents", "skills", "mermaid", "SKILL.md");
	try {
		const raw = readFileSync(skillPath, "utf8");
		const patterns = /## Named layout patterns\n([\s\S]*?)(?=\n## )/.exec(raw)?.[1]?.trim();
		if (patterns) {
			return "Pattern catalog (from the mermaid skill; pick the pattern that fits the spec):\n" + patterns + "\n\n" + CHAT_ASPECT_RULES;
		}
	} catch {
		// Fall through to the fallback catalog.
	}
	return FALLBACK_CATALOG + "\n\n" + CHAT_ASPECT_RULES;
}

export function buildSystemPrompt(): string {
	return MERMAID_BASE_PROMPT + "\n\n" + loadPatternCatalog();
}

export const CHECKER_SYSTEM_PROMPT = [
	"You verify rendered Mermaid diagrams against their spec.",
	"You receive a spec and the rendered Unicode art of a diagram.",
	"Reply with exactly one line: `VERDICT: MATCH` when the art shows exactly what the spec says — every node, every label, every edge direction, nothing invented.",
	"Or `VERDICT: MISMATCH: <one-line reason>` when anything differs, is missing, or was invented.",
	"The syntax already parsed. Judge truth to the spec, not syntax.",
].join("\n");

export function buildCheckerPrompt(spec: string, art: string): string {
	return "Spec:\n" + spec + "\n\nRendered diagram (Unicode art):\n" + art;
}

export function parseCheckerVerdict(raw: string): { match: true } | { match: false; reason: string } {
	if (/VERDICT:\s*MATCH\b/i.test(raw)) return { match: true };
	const mismatch = /VERDICT:\s*MISMATCH:\s*([\s\S]+)/i.exec(raw);
	if (mismatch) return { match: false, reason: mismatch[1].trim().slice(0, 300) };
	return { match: false, reason: "checker returned no verdict" };
}

const MermaidParams = Type.Object({
	spec: Type.String({
		description:
			"Detailed description of the diagram: diagram type (flowchart, sequenceDiagram, stateDiagram-v2, classDiagram, erDiagram, gantt, pie, mindmap), every node with its exact label, every edge with its direction and optional label, and layout direction (TD or LR).",
	}),
});

interface MermaidDetails {
	source?: string;
	/** Unicode box art from mmdflux, shown in the transcript. */
	art?: string;
	/** Last error, on failure. */
	error?: string;
	/** Reason the spec is not expressible in Mermaid, on escape. */
	escape?: string;
	attempts: number;
}

/** Pull the mermaid source out of a model reply's mermaid fence. */
export function extractMermaidSource(raw: string): string | null {
	const fence = /```mermaid\s*\n([\s\S]*?)```/.exec(raw);
	const body = fence?.[1]?.trim();
	return body || null;
}

/** Detect the spatial escape hatch: `NONE: <reason>`. */
export function extractNoneEscape(raw: string): string | null {
	const m = /NONE:\s*(.+)/.exec(raw.trim());
	return m ? m[1].trim().slice(0, 200) : null;
}

/** Build the user prompt for one generation attempt. */
export function buildAttemptPrompt(spec: string, previous?: { source: string; error: string }): string {
	const lines = [
		"Write ONE Mermaid diagram for this spec:",
		"",
		spec,
		"",
		"Rules:",
		"- Output only one ```mermaid fenced block. No prose.",
		"- Keep the diagram small: at most ~7 nodes, short labels.",
		"- Roots at the top. The goal node is the sink.",
		"- Use plain node and edge syntax only. No experimental or beta diagram types.",
	];
	if (previous) {
		lines.push(
			"",
			"Your previous diagram was rejected:",
			"",
			"```mermaid",
			previous.source,
			"```",
			"",
			`Reason: ${previous.error}`,
			"",
			"Fix the reason. Keep the spec. Output the full corrected diagram.",
		);
	}
	return lines.join("\n");
}

/** Candidate mmdflux binaries, in order. */
export function mmdfluxCandidates(): string[] {
	const list: string[] = [];
	if (process.env.PI_MERMAID_MMDFLUX) list.push(process.env.PI_MERMAID_MMDFLUX);
	const local = join(homedir(), ".local", "bin", "mmdflux");
	if (existsSync(local)) list.push(local);
	list.push("mmdflux");
	return list;
}

function spawnMmdflux(
	bin: string,
	source: string,
	signal?: AbortSignal,
): Promise<MmdfluxVerdict> {
	return new Promise((resolve, reject) => {
		const child = spawn(bin, ["-f", "text"], { stdio: ["pipe", "pipe", "pipe"] });
		let out = "";
		let err = "";
		let settled = false;
		const onAbort = () => {
			if (!settled) child.kill("SIGKILL");
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		const timer = setTimeout(() => child.kill("SIGKILL"), MMDFLUX_TIMEOUT_MS);
		const finish = () => {
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		};
		child.stdout.on("data", (d: Buffer) => {
			if (out.length < OUTPUT_CAP) out += d.toString("utf8");
		});
		child.stderr.on("data", (d: Buffer) => {
			if (err.length < OUTPUT_CAP) err += d.toString("utf8");
		});
		child.on("error", (e: NodeJS.ErrnoException) => {
			finish();
			reject(e);
		});
		child.on("close", (code: number | null, killSignal: NodeJS.Signals | null) => {
			finish();
			if (signal?.aborted) {
				reject(new Error("aborted"));
				return;
			}
			const art = out.trimEnd();
			if (code === 0 && art) {
				resolve({ ok: true, art });
				return;
			}
			if (code === null) {
				resolve({
					ok: false,
					kind: "environment",
					error: `mmdflux killed by ${killSignal ?? "unknown signal"} before exiting`,
				});
				return;
			}
			resolve({ ok: false, kind: "parse", error: (err || out || `mmdflux exited with code ${code}`).trim() });
		});
		child.stdin.on("error", () => {
			// EPIPE when the binary is missing; the child error event handles it.
		});
		child.stdin.end(source);
	});
}

export type MmdfluxVerdict =
	| { ok: true; art: string }
	| { ok: false; kind: "environment"; error: string }
	| { ok: false; kind: "parse"; error: string };

/** Validate and render a mermaid source with mmdflux. Never throws except on abort. */
export async function runMmdflux(source: string, signal?: AbortSignal): Promise<MmdfluxVerdict> {
	for (const bin of mmdfluxCandidates()) {
		try {
			return await spawnMmdflux(bin, source, signal);
		} catch (err: any) {
			if (signal?.aborted) throw new Error("aborted");
			if (err?.code === "ENOENT") continue;
			return {
				ok: false,
				kind: "environment",
				error: `mmdflux failed to start (${bin}): ${err?.message ?? String(err)}`,
			};
		}
	}
	return { ok: false, kind: "environment", error: "mmdflux binary not found; set PI_MERMAID_MMDFLUX to its path" };
}

function findAuthed(ctx: any, provider: string, id: string): any {
	const m = ctx?.modelRegistry?.find?.(provider, id);
	if (m && (!ctx?.modelRegistry?.hasConfiguredAuth || ctx.modelRegistry.hasConfiguredAuth(m))) return m;
	return undefined;
}

/** Pick the nested generation model: env override, then the default. */
export function pickModel(ctx: any): any {
	const override = process.env.PI_MERMAID_MODEL;
	if (override) {
		const slash = override.indexOf("/");
		if (slash > 0) {
			const m = findAuthed(ctx, override.slice(0, slash), override.slice(slash + 1));
			if (m) return m;
		}
	}
	return findAuthed(ctx, DEFAULT_MODEL_PROVIDER, DEFAULT_MODEL_ID);
}

const textContent = (text: string): { type: "text"; text: string }[] => [{ type: "text" as const, text }];

/** Sum nested-call usage so session token totals stay accurate. */
function addUsage(total: Record<string, number>, usage: any): Record<string, number> {
	if (!usage || typeof usage !== "object") return total;
	for (const key of Object.keys(usage)) {
		const value = usage[key];
		if (typeof value === "number") total[key] = (total[key] ?? 0) + value;
	}
	return total;
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "mermaid",
		description:
			"Generate a Mermaid diagram from a detailed spec, validate it with a strict parser, and retry with the parse error until it parses. Renders the validated diagram in the transcript and returns its source. Use this instead of writing mermaid fences inline.",
		promptGuidelines: [
			"Call this tool instead of writing a mermaid fence inline.",
			"Put the full context in `spec`: diagram type, every node label, every edge, and direction. The tool does not see the conversation.",
			"The returned fence is validated; embed it in the reply verbatim. Do not edit it.",
		],
		parameters: MermaidParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const spec = params.spec.trim();
			const maxAttempts = DEFAULT_MAX_ATTEMPTS;

			if (!spec) {
				return {
					isError: true,
					content: textContent("mermaid tool requires a non-empty `spec`."),
					details: { error: "empty spec", attempts: 0 } satisfies MermaidDetails,
				};
			}
			const model = pickModel(ctx);
			if (!model) {
				return {
					isError: true,
					content: textContent(
					`mermaid tool: no generation model with configured auth. Set PI_MERMAID_MODEL=provider/id (default ${DEFAULT_MODEL_PROVIDER}/${DEFAULT_MODEL_ID}).`,
				),
					details: { error: "no model", attempts: 0 } satisfies MermaidDetails,
				};
			}

			let usage: Record<string, number> = {};
			let previous: { source: string; error: string } | undefined;
			let lastSource: string | undefined;
			let lastError = "no attempt ran";
			let attemptsMade = 0;
			let success: { source: string; art: string; attempts: number } | undefined;

			for (let attempt = 1; attempt <= maxAttempts; attempt++) {
				if (signal?.aborted) break;
				attemptsMade = attempt;
				onUpdate?.({ content: textContent(`attempt ${attempt}/${maxAttempts}: writing diagram with ${model.id ?? "model"}`) });
				let response: any;
				try {
					response = await ctx.modelRegistry.complete(
						model,
						{
							systemPrompt: buildSystemPrompt(),
							messages: [{ role: "user", content: buildAttemptPrompt(spec, previous), timestamp: Date.now() } as any],
						},
						// Max thinking needs a large output budget or the model spends it all
					// on reasoning and emits no text block. The codex API rejects
					// temperature, so it stays unset.
					{ signal, maxTokens: 16000, reasoningEffort: DEFAULT_REASONING_EFFORT } as any,
					);
				} catch (err: any) {
					if (signal?.aborted) break;
					lastError = `model call failed: ${err?.message ?? String(err)}`;
					continue;
				}
				usage = addUsage(usage, response?.usage);

				const raw = (response?.content ?? [])
					.filter((c: any) => c?.type === "text")
					.map((c: any) => c.text)
					.join("\n");
				const escape = extractNoneEscape(raw);
				if (escape) {
					return {
						content: textContent(
							`The spec needs a picture Mermaid auto-layout cannot express: ${escape}. ` +
								"Describe it in text or hand-author an SVG. Do not force a Mermaid diagram.",
						),
						details: { escape, attempts: attempt } satisfies MermaidDetails,
						usage,
					};
				}
				const source = extractMermaidSource(raw);
				if (!source) {
					lastError = "model returned no mermaid block";
					continue;
				}
				lastSource = source;

				onUpdate?.({ content: textContent(`attempt ${attempt}/${maxAttempts}: validating with mmdflux`) });
				let verdict: Awaited<ReturnType<typeof runMmdflux>>;
				try {
					verdict = await runMmdflux(source, signal);
				} catch (err: any) {
					lastError = `validation failed: ${err?.message ?? String(err)}`;
					break;
				}
				if (verdict.ok) {
					// Verify by looking: the art is text, so a nested call can read it
					// against the spec. A checker infra failure never rejects the diagram.
					onUpdate?.({ content: textContent(`attempt ${attempt}/${maxAttempts}: checking the rendered diagram against the spec`) });
					let check: { match: boolean; reason?: string } = { match: true };
					try {
						const checkResponse = await ctx.modelRegistry.complete(
							model,
							{
								systemPrompt: CHECKER_SYSTEM_PROMPT,
								messages: [{ role: "user", content: buildCheckerPrompt(spec, verdict.art), timestamp: Date.now() } as any],
							},
							{ signal, maxTokens: 2000, reasoningEffort: "medium" } as any,
						);
						usage = addUsage(usage, checkResponse?.usage);
						const checkRaw = (checkResponse?.content ?? [])
							.filter((c: any) => c?.type === "text")
							.map((c: any) => c.text)
							.join("\n");
						check = parseCheckerVerdict(checkRaw);
					} catch (err: any) {
						if (signal?.aborted) break;
						// Checker unavailable: accept the parsed diagram rather than fail on infra.
					}
					if (check.match) {
						success = { source, art: verdict.art, attempts: attempt };
						break;
					}
					lastError = `diagram did not match the spec: ${check.reason ?? "unknown"}`;
					previous = { source, error: lastError };
					continue;
				}
				lastError = verdict.error;
				if (verdict.kind === "environment") break;
				previous = { source, error: verdict.error };
			}

			if (signal?.aborted && !success) {
				return {
					isError: true,
					content: textContent("mermaid tool: aborted."),
					details: { source: lastSource, error: "aborted", attempts: attemptsMade } satisfies MermaidDetails,
					usage,
				};
			}

			if (success) {
				return {
					content: textContent(
						`Mermaid diagram validated by strict parsing (mmdflux) on attempt ${success.attempts} of ${maxAttempts}.\n\n` +
						"```mermaid\n" +
						success.source +
						"\n```\n\n" +
						"Show this fence to the user in your reply, verbatim. Do not edit it.",
					),
					details: { source: success.source, art: success.art, attempts: success.attempts } satisfies MermaidDetails,
					usage,
				};
			}

			return {
				isError: true,
				content: textContent(
						`mermaid tool: no valid diagram after ${attemptsMade} attempt(s). Last error:\n${lastError}\n\n` +
						"Last source:\n```mermaid\n" +
						(lastSource ?? "(none)") +
						"\n```\n\nDescribe the structure to the user in text instead.",
					),
				details: { source: lastSource, error: lastError, attempts: attemptsMade } satisfies MermaidDetails,
				usage,
			};
		},

		renderResult(result, _options, theme) {
			const details = result.details as MermaidDetails | undefined;
			if (details?.escape) {
				return new Text(theme.fg("muted", `mermaid: not expressible in Mermaid — ${details.escape}`), 0, 0);
			}
			if (details?.art) {
				const header = `mermaid (validated, attempt ${details.attempts})`;
				return new Text(theme.fg("muted", header) + "\n" + details.art, 0, 0);
			}
			if (details?.error) {
				return new Text(
					theme.fg("error", `mermaid failed after ${details.attempts} attempt(s): ${details.error.slice(0, 300)}`),
					0,
					0,
				);
			}
			const text = result.content?.[0];
			return new Text(text?.type === "text" ? text.text : "", 0, 0);
		},
	});
}
