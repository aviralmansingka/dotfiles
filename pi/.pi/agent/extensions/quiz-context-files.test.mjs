import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Allow CI to supply its own jiti via JITI_PATH; fall back to the host pi install.
const _jitiCjs = process.env.JITI_PATH || "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs";
const {
	createJiti,
} = require(_jitiCjs);
const jiti = createJiti(import.meta.url);
const { contextFileHint, normalizeContextFiles } = jiti("./user-input/context-files.ts");

const h100SmokeFiles = [
	"/Users/aviral/.treehouse/vault-278260/2/vault/professor-lessons/h100-matmul-modal/bench_core.py",
	"/Users/aviral/.treehouse/vault-278260/2/vault/professor-lessons/h100-matmul-modal/reference/fast.cu/h100/matmul.cu",
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
