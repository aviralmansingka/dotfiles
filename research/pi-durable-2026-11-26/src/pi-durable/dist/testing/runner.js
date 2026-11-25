import { createExpectAssertions } from "./assertions.js";
import { createEnvConformance } from "./env-conformance.js";
import { createStorageConformance } from "./storage-conformance.js";
/** Registers the runner-independent cases with a Vitest/Jest-compatible test runner. */
export function registerStorageConformance(runner, name, withStorage) {
    const cases = createStorageConformance({
        assertions: createExpectAssertions(runner.expect),
        withStorage,
    });
    runner.describe(name, () => {
        for (const testCase of cases)
            runner.it(testCase.name, testCase.run);
    });
}
/** Registers the runner-independent `ExecutionEnv` cases with a Vitest/Jest-compatible test runner. */
export function registerEnvConformance(runner, name, withEnv, options = {}) {
    const cases = createEnvConformance({ ...options, assertions: createExpectAssertions(runner.expect), withEnv });
    runner.describe(name, () => {
        for (const testCase of cases)
            runner.it(testCase.name, testCase.run, testCase.timeoutMs);
    });
}
//# sourceMappingURL=runner.js.map