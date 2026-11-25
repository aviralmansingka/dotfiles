/** Whether `execute()` returned a park rather than a result. */
export function isPark(returned) {
    // Tool code is a trust boundary: any `kind` makes a park, and `parkError` refuses one that is neither.
    return returned.kind !== undefined;
}
/**
 * The parks a wrapped base returned in one run of a tool, carried by that run's api under this key. An own enumerable
 * symbol property, so a wrapper that spreads the api, as wrappers do, passes it on to the base.
 */
export const BASE_PARKS = Symbol("pi.tool.baseParks");
/** Fields of a result; a park carrying one of them is invalid. */
const RESULT_FIELDS = ["output", "structuredOutput", "isError", "details", "diagnostics", "usage", "control"];
/**
 * Why a park breaks its shape (spec suspendable §4.1), or `undefined`: kind `sleep` or `wait`, no result field, and, when `tool` is a wrapper's composite (§9), one its base returned in this run, whose api is `api`. Rules
 * on what it waits for are the commit's.
 */
export function parkError(tool, park, api) {
    // Tool code is a trust boundary for the mixed objects its types forbid.
    const kind = park.kind;
    if (kind !== "sleep" && kind !== "wait")
        return `a park's kind is sleep or wait, not ${String(kind)}`;
    const field = RESULT_FIELDS.find((name) => name in park);
    if (field !== undefined)
        return `a park has no result field, but this one has ${field}`;
    if (composites.has(tool) && api[BASE_PARKS]?.has(park) !== true) {
        return "a wrapper returned a park its base did not return";
    }
    return undefined;
}
/** Composite tools a wrapper built; their parks must come from their base. */
const composites = new WeakSet();
/**
 * Apply `wrap` to `tool` as tool wrappers apply (spec suspendable §9): the first wrapper of a base gets a copy whose
 * `execute()` records every park it returns in its run's api, so the composite's own parks are told apart.
 */
export function wrapComposite(tool, wrap) {
    const base = composites.has(tool)
        ? tool
        : {
            ...tool,
            execute: async (args, api, context) => {
                const returned = await tool.execute(args, api, context);
                if (isPark(returned))
                    api[BASE_PARKS]?.add(returned);
                return returned;
            },
        };
    const composite = wrap(base);
    composites.add(composite);
    return composite;
}
//# sourceMappingURL=parks.js.map