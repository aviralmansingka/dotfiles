/** The call's execution environment; a tool without one fails with an ordinary error result. */
export function requireEnv(api) {
    if (api.env === undefined)
        throw new Error("No execution environment is configured");
    return api.env;
}
//# sourceMappingURL=env.js.map