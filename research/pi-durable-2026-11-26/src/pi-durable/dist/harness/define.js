/** Identity function that types an extension. */
export function defineExtension(extension) {
    return extension;
}
/** Identity function that types a tool: `args` from `parameters`, details from what it reports, `C` its park checkpoint. */
export function defineTool(tool) {
    return tool;
}
/** A prompt section; tagged unless `tag` is false. */
export function section(key, render, options) {
    return options?.tag === undefined ? { key, render } : { key, render, tag: options.tag };
}
/** Hook handlers for tasks with `task`'s name. */
export function hook(task, handlers) {
    return { task: task.definition.name, handlers };
}
/** A task a hook (`afterTools`, `onYield`, `afterRun`) asks for, its input typed by the task. */
export function hookTask(task, input) {
    return { task, input };
}
/**
 * Wrap the tool named like `tool` wherever the wrapping extension is selected. Wrappers never park: one passes `api` to
 * its base unchanged or spread and returns the base's park unchanged; a park of its own ends the call `invalid_park`.
 */
export function wrapTool(tool, wrapper) {
    return { kind: "tool", tool: tool.name, wrap: wrapper };
}
/** Wrap the section `key` wherever the wrapping extension is selected. */
export function wrapSection(key, wrapper) {
    return { kind: "section", section: key, wrap: wrapper };
}
//# sourceMappingURL=define.js.map