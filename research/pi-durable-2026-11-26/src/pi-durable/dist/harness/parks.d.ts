import type { ToolExecutionResult, ToolPark, ToolRegistration } from "./types.ts";
/** Whether `execute()` returned a park rather than a result. */
export declare function isPark(returned: ToolExecutionResult | ToolPark): returned is ToolPark;
/**
 * The parks a wrapped base returned in one run of a tool, carried by that run's api under this key. An own enumerable
 * symbol property, so a wrapper that spreads the api, as wrappers do, passes it on to the base.
 */
export declare const BASE_PARKS: unique symbol;
/** A run's api with the parks its wrapped base returned. */
export type ParkCarrier = {
    readonly [BASE_PARKS]?: Set<ToolPark>;
};
/**
 * Why a park breaks its shape (spec suspendable §4.1), or `undefined`: kind `sleep` or `wait`, no result field, and, when `tool` is a wrapper's composite (§9), one its base returned in this run, whose api is `api`. Rules
 * on what it waits for are the commit's.
 */
export declare function parkError(tool: ToolRegistration, park: ToolPark, api: ParkCarrier): string | undefined;
/**
 * Apply `wrap` to `tool` as tool wrappers apply (spec suspendable §9): the first wrapper of a base gets a copy whose
 * `execute()` records every park it returns in its run's api, so the composite's own parks are told apart.
 */
export declare function wrapComposite<Tool extends ToolRegistration>(tool: Tool, wrap: (tool: Tool) => Tool): Tool;
//# sourceMappingURL=parks.d.ts.map