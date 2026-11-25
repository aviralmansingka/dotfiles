/** Adapts a Vitest/Jest-compatible `expect` function without importing either runner. */
export function createExpectAssertions(expect) {
    const result = (actual, message) => expect(actual, message);
    return {
        ok(value, message) {
            result(value, message).toBeTruthy();
        },
        strictEqual(actual, expected) {
            result(actual).toBe(expected);
        },
        deepEqual(actual, expected) {
            result(actual).toEqual(expected);
        },
        partialDeepEqual(actual, expected) {
            result(actual).toMatchObject(expected);
        },
        greaterThan(actual, expected) {
            result(actual).toBeGreaterThan(expected);
        },
        async rejects(operation, messageIncludes) {
            await result(operation).rejects.toThrow(messageIncludes);
        },
    };
}
//# sourceMappingURL=assertions.js.map