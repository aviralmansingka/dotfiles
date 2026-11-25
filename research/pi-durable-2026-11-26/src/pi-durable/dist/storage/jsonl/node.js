import { NodeExecutionEnv } from "../../env/node.js";
import { JsonlStorage } from "./storage.js";
/** Open or create a JSONL storage directory using the local Node filesystem; `readOnly` opens one without writing. */
export async function openNodeJsonlStorage(directory, context, options = {}) {
    return JsonlStorage.open(directory, new NodeExecutionEnv({ cwd: process.cwd() }), context, options);
}
export { JsonlStorage, JsonlStorageReadOnlyError } from "./storage.js";
//# sourceMappingURL=node.js.map