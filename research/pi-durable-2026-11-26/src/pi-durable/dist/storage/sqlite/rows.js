// How Durable's records map to SQLite: JSON text, indexed strings, and a document's scope and address columns.
/** Parses a stored JSON column. */
export const parseJson = (value) => JSON.parse(value);
/** Encodes a value as a stored JSON column. */
export const encodeJson = (value) => JSON.stringify(value);
/** Encodes an indexed string column. Some SQLite bindings replace lone UTF-16 surrogates; JSON keeps it lossless. */
export const encodeIndexedString = (value) => JSON.stringify(value);
/** A document scope's columns. */
export const scopeColumns = (scope) => {
    switch (scope.kind) {
        case "session":
            return { scopeKind: "session", ownerId: 0 };
        case "conversation":
            return { scopeKind: "conversation", ownerId: scope.conversationId };
        case "task":
            return { scopeKind: "task", ownerId: scope.taskId };
    }
};
/** A document address's columns, as `documents` stores and indexes them. */
export const addressParts = (address) => {
    const scope = scopeColumns(address.scope);
    return {
        kind: encodeIndexedString(address.kind),
        ...scope,
        family: address.key === undefined ? 0 : 1,
        keyValue: encodeIndexedString(address.key ?? ""),
    };
};
/** One string per document address, from its stored columns. */
export const addressColumnsKey = (kind, scopeKind, ownerId, family, keyValue) => JSON.stringify([kind, scopeKind, ownerId, family, keyValue]);
/** One string per document address. */
export const addressKey = (address) => {
    const parts = addressParts(address);
    return addressColumnsKey(parts.kind, parts.scopeKind, parts.ownerId, parts.family, parts.keyValue);
};
/** Whether a document keeps only its current state: its revisions go at each new base and at retirement. */
export const isCurrentOnly = (record) => record.scope.kind !== "conversation" || record.history === "latest";
/** A document record's `documents` row: id, kind, family, key, scope, owner, created and retired seqs, record. */
export function documentRow(record) {
    const parts = addressParts(record);
    return [
        record.id,
        parts.kind,
        parts.family,
        parts.keyValue,
        parts.scopeKind,
        parts.ownerId,
        record.createdAt,
        record.retiredAt ?? null,
        encodeJson(record),
    ];
}
//# sourceMappingURL=rows.js.map