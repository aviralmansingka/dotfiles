import { validateSqliteSchemaPrefix } from "@earendil-works/chord/sqlite";
import { openNodeSqliteDatabase } from "@earendil-works/chord/sqlite/node";
import { SqliteStorage } from "./storage.js";
export { NodeSqliteDatabase, openNodeSqliteDatabase, } from "@earendil-works/chord/sqlite/node";
/** Open or create file-backed durable storage using Node's built-in SQLite, optionally under a table prefix. */
export async function openNodeSqliteStorage(path, options = {}) {
    const { prefix, ...databaseOptions } = options;
    if (prefix !== undefined)
        validateSqliteSchemaPrefix(prefix);
    return SqliteStorage.open(await openNodeSqliteDatabase(path, databaseOptions), { prefix });
}
//# sourceMappingURL=node.js.map