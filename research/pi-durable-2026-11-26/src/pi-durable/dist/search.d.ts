/**
 * BM25 tool search for code mode's `searchTools()` and the `tool_search` tool, a copy of the coding agent's tool search
 * ranking: durable keeps its own copy of what it needs from the coding agent.
 */
/** A tool as the ranker sees it: its name, its text, and the text of its namespace. */
export type SearchDocument = {
    readonly name: string;
    /** Description and parameter names and descriptions; not the name, which the ranker reads from `name`. */
    readonly text: string;
    /** Name, description, and instructions of the tool's namespace. */
    readonly namespaceText?: string;
};
/**
 * Okapi BM25 (k1 1.2, b 0.75) over `text`, with the name and the namespace as separate fields: the names of the best
 * matches, best first; ties keep document order.
 * - A tool that matches more of the query's terms, in any field, ranks above one that matches fewer, whatever their
 *   scores: for `screenshot window`, a tool whose description has both words beats `window` whose name has one.
 * - A query term in the name scores more than any number of mentions in the text.
 * - A tool whose whole local name (after the last `__`) is in the query gets a bonus worth one more match of every
 *   query term, so among tools matching as many terms, `peekaboo app` finds `mcp__peekaboo__app` over tools that
 *   only mention the words.
 * - A query that is exactly a tool's name, or its name after a `__`, ranks that tool first, before coverage.
 *
 * Only `text` is length-normalized, so a long name or long namespace instructions do not lower a tool's score.
 */
export declare function rankDocuments(query: string, documents: readonly SearchDocument[], limit: number): string[];
/** Unicode word segmentation with identifier boundaries and English stop words/singular forms. */
export declare function tokenize(text: string): string[];
//# sourceMappingURL=search.d.ts.map