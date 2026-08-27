import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { Text } from "@mariozechner/pi-tui";
import * as fs from "node:fs";
import * as path from "node:path";

interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

interface StructuredSearchArgs {
	query?: string;
	exactPhrases?: string[];
	excludeTerms?: string[];
	site?: string;
	count?: number;
}

interface BuiltSearchQuery {
	/** Human-readable composed query, used for TUI display. */
	query: string;
	baseQuery?: string;
	exactPhrases: string[];
	excludeTerms: string[];
	/** excludeTerms that look like domains — sent as Tavily `exclude_domains`. */
	excludeDomains: string[];
	site?: string;
	/** True when exactPhrases is non-empty; enables Tavily `exact_match`. */
	exactMatch: boolean;
}

async function tavilySearch(
	built: BuiltSearchQuery,
	count: number,
	apiKey: string,
	signal?: AbortSignal,
): Promise<SearchResult[]> {
	const maxResults = Math.min(count, 10);

	// Tavily takes a plain query plus dedicated include/exclude domain params,
	// so the sent query omits the `site:` operator and domain-shaped excludes.
	const queryParts: string[] = [];
	if (built.baseQuery) queryParts.push(built.baseQuery);
	for (const phrase of built.exactPhrases) {
		queryParts.push(quoteForSearch(phrase));
	}
	for (const term of built.excludeTerms) {
		if (built.excludeDomains.includes(term)) continue;
		queryParts.push(`-${term.includes(" ") ? quoteForSearch(term) : term}`);
	}
	const tavilyQuery = queryParts.join(" ");

	const body: Record<string, unknown> = {
		query: tavilyQuery,
		max_results: maxResults,
		search_depth: "basic",
	};
	if (built.site) body.include_domains = [built.site];
	if (built.excludeDomains.length > 0) body.exclude_domains = built.excludeDomains;
	if (built.exactMatch) body.exact_match = true;

	const resp = await fetch("https://api.tavily.com/search", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify(body),
		signal,
	});
	if (!resp.ok) {
		const text = await resp.text();
		throw new Error(`Tavily API ${resp.status}: ${text.slice(0, 200)}`);
	}

	const data = (await resp.json()) as {
		results?: Array<{
			title: string;
			url: string;
			content?: string;
		}>;
	};

	if (!data.results || data.results.length === 0) return [];

	return data.results.map((item) => ({
		title: item.title,
		url: item.url,
		snippet: item.content?.replace(/\n/g, " ") ?? "",
	}));
}

const EXT_DIR = path.dirname(new URL(import.meta.url).pathname);
const AUTH_PATH = path.join(EXT_DIR, "auth.json");

function loadCredentials(): { apiKey: string } | null {
	const envApiKey = process.env.TAVILY_API_KEY;
	if (envApiKey) return { apiKey: envApiKey };

	if (!fs.existsSync(AUTH_PATH)) return null;
	try {
		const config = JSON.parse(fs.readFileSync(AUTH_PATH, "utf-8"));
		const apiKey = config.tavily_api_key as string;
		if (apiKey) return { apiKey };
	} catch {}
	return null;
}

function formatResults(results: SearchResult[]): string {
	if (results.length === 0) return "No results found.";
	return results
		.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
		.join("\n\n");
}

function stripWrappingQuotes(value: string): string {
	return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
		? value.slice(1, -1).trim()
		: value;
}

function cleanItems(values?: string[]): string[] {
	if (!values) return [];
	return values
		.map((value) => stripWrappingQuotes(value.trim().replace(/\s+/g, " ")))
		.filter(Boolean);
}

function cleanQuery(value?: string): string | undefined {
	if (typeof value !== "string") return undefined;
	const cleaned = value.trim().replace(/\s+/g, " ");
	return cleaned || undefined;
}

function normalizeSite(site?: string): string | undefined {
	if (typeof site !== "string") return undefined;

	let value = site.trim().replace(/^site:/i, "").trim();
	if (!value) return undefined;

	try {
		const candidate = /^[a-z]+:\/\//i.test(value)
			? value
			: `https://${value}`;
		const url = new URL(candidate);
		if (url.hostname) value = url.hostname;
	} catch {}

	return value.replace(/\/+$/, "") || undefined;
}

function looksLikeDomain(term: string): boolean {
	// No spaces, has a dot, and the trailing segment looks like a TLD.
	return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(term) && !term.includes(" ");
}

function quoteForSearch(value: string): string {
	return `"${value.replace(/"/g, '\\"')}"`;
}

function buildSearchQuery(args: StructuredSearchArgs): BuiltSearchQuery {
	const baseQuery = cleanQuery(args.query);
	const exactPhrases = cleanItems(args.exactPhrases);
	const excludeTerms = cleanItems(args.excludeTerms);
	const site = normalizeSite(args.site);

	if (!baseQuery && exactPhrases.length === 0) {
		throw new Error(
			"At least one of 'query' or 'exactPhrases' is required.",
		);
	}

	const excludeDomains = excludeTerms.filter(looksLikeDomain);

	// Composed display string — keeps the familiar `site:` / `-term` shape for
	// the TUI even though the Tavily request splits these into dedicated params.
	const parts: string[] = [];
	if (baseQuery) parts.push(baseQuery);
	for (const phrase of exactPhrases) {
		parts.push(quoteForSearch(phrase));
	}
	for (const term of excludeTerms) {
		parts.push(`-${term.includes(" ") ? quoteForSearch(term) : term}`);
	}
	if (site) {
		parts.push(`site:${site}`);
	}

	return {
		query: parts.join(" "),
		baseQuery,
		exactPhrases,
		excludeTerms,
		excludeDomains,
		site,
		exactMatch: exactPhrases.length > 0,
	};
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search the web via the Tavily Search API. Build one search per call from a base query string, exact phrases, exclusions, and an optional site. Returns title, URL, and snippet.",
		promptSnippet:
			"Search the web via a query string plus optional exactPhrases, excludeTerms, and site. Use one tool call per search angle.",
		promptGuidelines: [
			"Use exactPhrases for exact phrase matching instead of embedding quote marks inside the main query string.",
			"Use one web_search tool call per search angle instead of batching multiple searches into one call.",
		],

		parameters: Type.Object({
			query: Type.Optional(
				Type.String({
					description:
						"Base search query as a normal string. Prefer this for the main search wording.",
				}),
			),
			exactPhrases: Type.Optional(
				Type.Array(Type.String(), {
					description:
						"Exact phrases to match. Each item becomes a quoted phrase in the final Tavily query.",
				}),
			),
			excludeTerms: Type.Optional(
				Type.Array(Type.String(), {
					description:
						"Terms or phrases to exclude. Domain-shaped items (e.g. espn.com) are sent as Tavily exclude_domains; others are passed as minus-prefixed terms in the query.",
				}),
			),
			site: Type.Optional(
				Type.String({
					description:
						"Optional site/domain restriction, such as example.com or a full URL. Mapped to Tavily include_domains.",
				}),
			),
			count: Type.Optional(
				Type.Number({
					description: "Number of results to return (default: 5, max: 10)",
					minimum: 1,
					maximum: 10,
				}),
			),
		}),

		async execute(_toolCallId, params: StructuredSearchArgs, signal) {
			const creds = loadCredentials();
			if (!creds) {
				throw new Error(
					`Missing Tavily API key. Set TAVILY_API_KEY, or create ${AUTH_PATH} from auth.example.json. Get credentials from https://tavily.com`,
				);
			}

			const count = params.count ?? 5;
			const built = buildSearchQuery(params);
			const results = await tavilySearch(built, count, creds.apiKey, signal);

			return {
				content: [
					{
						type: "text" as const,
						text: formatResults(results),
					},
				],
				details: {
					composedQuery: built.query,
					query: built.baseQuery,
					exactPhrases: built.exactPhrases,
					excludeTerms: built.excludeTerms,
					site: built.site,
					resultCount: results.length,
				},
			};
		},

		renderCall(args, theme, context) {
			const text =
				(context.lastComponent as Text | undefined) ??
				new Text("", 0, 0);
			const { count, ...searchArgs } = args as StructuredSearchArgs;

			try {
				const built = buildSearchQuery(searchArgs);
				const display =
					built.query.length > 70
						? built.query.slice(0, 67) + "..."
						: built.query;
				const lines = [
					theme.fg("toolTitle", theme.bold("search ")) +
						theme.fg("accent", `"${display}"`),
				];
				if (count && count !== 5) {
					lines.push(theme.fg("dim", `  count: ${count}`));
				}
				text.setText(lines.join("\n"));
				return text;
			} catch {
				text.setText(
					theme.fg("toolTitle", theme.bold("search ")) +
						theme.fg("error", "(invalid query)"),
				);
				return text;
			}
		},

		renderResult(result, { expanded, isPartial }, theme, context) {
			const text =
				(context.lastComponent as Text | undefined) ??
				new Text("", 0, 0);

			if (isPartial) {
				text.setText(theme.fg("warning", "Searching…"));
				return text;
			}

			if (context.isError) {
				const msg =
					result.content.find((c) => c.type === "text")?.text ||
					"Error";
				text.setText(theme.fg("error", msg));
				return text;
			}

			const details = result.details as {
				composedQuery?: string;
				resultCount?: number;
			};
			const status = theme.fg(
				"success",
				`${details?.resultCount ?? 0} results`,
			);
			if (!expanded) {
				text.setText(status);
				return text;
			}

			const content =
				result.content.find((c) => c.type === "text")?.text || "";
			const preview =
				content.length > 500 ? content.slice(0, 500) + "..." : content;
			const queryLine = details?.composedQuery
				? theme.fg("dim", `query: ${details.composedQuery}`)
				: "";
			text.setText(
				[status, queryLine, theme.fg("dim", preview)]
					.filter(Boolean)
					.join("\n"),
			);
			return text;
		},
	});
}
