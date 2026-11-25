import type { ToolRegistration } from "../harness/types.ts";
export declare const TOOL_SEARCH_TOOL_NAME = "tool_search";
export declare const DEFAULT_TOOL_SEARCH_LIMIT = 8;
/** `tool_search` result details: the tools it loaded. */
export type ToolSearchToolDetails = {
    loaded: string[];
};
export declare function createToolSearchTool(): ToolRegistration<import("@earendil-works/pi-schema").Schema<{
    query: string;
    limit?: number | undefined;
}>, import("@earendil-works/chord/json").JsonValue, import("@earendil-works/chord/json").JsonValue>;
/** The `tool_search` extension: install it and select it where the model should find deferred tools. */
export declare function createToolSearchExtension(): import("../harness/types.ts").Extension<ToolRegistration<import("@earendil-works/pi-schema").Schema<{
    query: string;
    limit?: number | undefined;
}>, import("@earendil-works/chord/json").JsonValue, import("@earendil-works/chord/json").JsonValue>>;
//# sourceMappingURL=tool-search.d.ts.map