import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { HOMEBREW_JITI, resolveJiti } from "./test-lib/jiti.mjs";

const require = createRequire(import.meta.url);
const { jitiPath } = resolveJiti({ extraFallbacks: [HOMEBREW_JITI] });
const { createJiti } = require(jitiPath);
const jiti = createJiti(import.meta.url);
const { contextFileHint, lessonFileHint, normalizeContextFiles } = jiti("./user-input/context-files.ts");

// The `h` shortcut focuses the current node; `H` opens the session lesson
// journal — always available, unconditional hint, stable string.
assert.equal(lessonFileHint(), "h node · H journal");
assert.equal(lessonFileHint(), lessonFileHint());

// Inert smoke data — only the count matters to the hint, so keep the paths
// host-neutral (no macOS-only absolute paths).
const h100SmokeFiles = [
	"~/vault/professor-lessons/h100-matmul-modal/bench_core.py",
	"~/vault/professor-lessons/h100-matmul-modal/reference/fast.cu/h100/matmul.cu",
];

assert.deepEqual(normalizeContextFiles(undefined), []);
assert.deepEqual(normalizeContextFiles([" bench_core.py ", "", "reference/fast.cu/h100/matmul.cu"]), [
	"bench_core.py",
	"reference/fast.cu/h100/matmul.cu",
]);
assert.equal(contextFileHint([]), undefined);
assert.equal(contextFileHint(["bench_core.py"]), "o open context file");
assert.equal(contextFileHint(h100SmokeFiles), "o open context files");

console.log("quiz context-file shortcut smoke passed");
