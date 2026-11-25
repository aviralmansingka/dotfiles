import { DurableObjectSqliteDatabase } from "@earendil-works/chord/sqlite/cloudflare";
import { SqliteStorage } from "./storage.js";
export { DurableObjectSqliteDatabase } from "@earendil-works/chord/sqlite/cloudflare";
/**
 * Open durable storage on a SQLite-backed Durable Object, optionally under a table prefix. Calls given the same
 * storage object share an operation queue.
 */
export function openDurableObjectSqliteStorage(storage, options = {}) {
    return SqliteStorage.open(new DurableObjectSqliteDatabase(storage), options);
}
//# sourceMappingURL=cloudflare.js.map