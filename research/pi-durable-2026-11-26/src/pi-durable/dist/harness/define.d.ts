import type { JsonValue } from "@earendil-works/chord/json";
import type { Task } from "../types.ts";
import type { AnyTask, Extension, HookRegistration, HooksOf, HookTask, PromptSection, ToolRegistration, Wrap } from "./types.ts";
/** Identity function that types an extension. */
export declare function defineExtension<Tool extends ToolRegistration = ToolRegistration>(extension: Extension<Tool>): Extension<Tool>;
/** Identity function that types a tool: `args` from `parameters`, details from what it reports, `C` its park checkpoint. */
export declare function defineTool<TParameters extends object, TDetails extends JsonValue = JsonValue, C extends JsonValue = JsonValue>(tool: ToolRegistration<TParameters, TDetails, C>): ToolRegistration<TParameters, TDetails, C>;
/** A prompt section; tagged unless `tag` is false. */
export declare function section<Tool extends ToolRegistration = ToolRegistration>(key: string, render: PromptSection<Tool>["render"], options?: {
    readonly tag?: boolean;
}): PromptSection<Tool>;
/** Hook handlers for tasks with `task`'s name. */
export declare function hook<K extends AnyTask>(task: K, handlers: Partial<HooksOf<K>>): HookRegistration;
/** A task a hook (`afterTools`, `onYield`, `afterRun`) asks for, its input typed by the task. */
export declare function hookTask<I extends JsonValue, S extends {
    phase: string;
}, R, H extends object>(task: Task<I, S, R, H>, input: I): HookTask;
/**
 * Wrap the tool named like `tool` wherever the wrapping extension is selected. Wrappers never park: one passes `api` to
 * its base unchanged or spread and returns the base's park unchanged; a park of its own ends the call `invalid_park`.
 */
export declare function wrapTool<Tool extends ToolRegistration>(tool: Tool, wrapper: (tool: Tool) => Tool): Wrap<Tool>;
/** Wrap the section `key` wherever the wrapping extension is selected. */
export declare function wrapSection<Tool extends ToolRegistration = ToolRegistration>(key: string, wrapper: (section: PromptSection<Tool>) => PromptSection<Tool>): Wrap<Tool>;
//# sourceMappingURL=define.d.ts.map