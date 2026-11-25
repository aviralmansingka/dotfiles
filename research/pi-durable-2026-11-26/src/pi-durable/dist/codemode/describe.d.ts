/**
 * What the model reads about code mode, copied from the coding agent's code mode: the tool's fixed description (the
 * script environment and its globals), and the `codemode` prompt section, which lists the tools scripts can call as
 * TypeScript declarations, grouped by the namespaces their extensions declare and limited to a token budget. Tools
 * that do not fit, and deferred tools, are found with `searchTools()`. Every selected extension's namespace is listed
 * (with its description) whether or not it has tools yet, so the section stays the same when an extension's deferred
 * tools come and go (an MCP server connecting); the tool's description never changes.
 */
import type { CodemodeJsonSchema } from "@earendil-works/pi-codemode";
import type { Extension, ToolNamespace, ToolRegistration } from "../harness/types.ts";
/** Default token budget of the tool declarations in the `codemode` section, as in the coding agent. */
export declare const DEFAULT_CODEMODE_INLINE_BUDGET = 3000;
/** The code mode tool's description: the script environment and its globals, the same for every conversation. */
export declare function codemodeDescription(models: boolean): string;
/** What a script sees of a tool: its declaration. Tools without an output schema resolve to their text output. */
export declare function declarationOf(tool: ToolRegistration): {
    name: string;
    description: string;
    inputSchema: CodemodeJsonSchema;
    outputSchema: CodemodeJsonSchema;
};
/** `toolSample` of a tool: its description and TypeScript declaration. */
export declare function sampleOf(tool: ToolRegistration): string;
/**
 * The namespace of each tool the extensions bring, by tool name: its extension's `namespace`. A tool several
 * extensions name belongs to the first one's (with none when the first declares none).
 */
export declare function namespacesOf(extensions: readonly Extension[]): ReadonlyMap<string, ToolNamespace>;
/** The namespaces the extensions declare, by name (the first declaration of a name wins), sorted by name. */
export declare function declaredNamespaces(extensions: readonly Extension[]): readonly ToolNamespace[];
/**
 * The `codemode` section: the tools scripts can call (ungrouped ones first), then every namespace the selected
 * `extensions` declare, by name, as `## <name>` and its description, each followed by its tools' declarations as far as
 * the budget allows. Headers carry no counts, so the text changes only with the declared tools. `undefined` without
 * callable tools and namespaces.
 */
export declare function codemodeSection(tools: readonly ToolRegistration[], extensions: readonly Extension[], budget: number): string | undefined;
//# sourceMappingURL=describe.d.ts.map