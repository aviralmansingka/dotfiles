import type { Context } from "@earendil-works/chord/context";
import { JsonlStorage, type JsonlStorageOptions } from "./storage.ts";
/** Open or create a JSONL storage directory using the local Node filesystem; `readOnly` opens one without writing. */
export declare function openNodeJsonlStorage(directory: string, context: Context, options?: JsonlStorageOptions): Promise<JsonlStorage>;
export { JsonlStorage, type JsonlStorageOptions, JsonlStorageReadOnlyError } from "./storage.ts";
//# sourceMappingURL=node.d.ts.map