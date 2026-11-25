import type { DocumentAddress, DocumentCreate, DocumentRecord } from "../../types.ts";
/** A value of a stored cell, as Durable's rows hold them. */
export type Cell = string | number | null;
/** A document's scope as its `scope_kind` and `owner_id` columns. */
export type ScopeColumns = {
    readonly scopeKind: DocumentRecord["scope"]["kind"];
    readonly ownerId: number;
};
/** Parses a stored JSON column. */
export declare const parseJson: <T>(value: string) => T;
/** Encodes a value as a stored JSON column. */
export declare const encodeJson: (value: unknown) => string;
/** Encodes an indexed string column. Some SQLite bindings replace lone UTF-16 surrogates; JSON keeps it lossless. */
export declare const encodeIndexedString: (value: string) => string;
/** A document scope's columns. */
export declare const scopeColumns: (scope: DocumentRecord["scope"]) => ScopeColumns;
/** A document address's columns, as `documents` stores and indexes them. */
export declare const addressParts: (address: DocumentAddress | DocumentCreate | DocumentRecord) => {
    scopeKind: DocumentRecord["scope"]["kind"];
    ownerId: number;
    kind: string;
    family: number;
    keyValue: string;
};
/** One string per document address, from its stored columns. */
export declare const addressColumnsKey: (kind: string, scopeKind: string, ownerId: number, family: number, keyValue: string) => string;
/** One string per document address. */
export declare const addressKey: (address: DocumentAddress | DocumentCreate | DocumentRecord) => string;
/** Whether a document keeps only its current state: its revisions go at each new base and at retirement. */
export declare const isCurrentOnly: (record: DocumentRecord) => boolean;
/** A document record's `documents` row: id, kind, family, key, scope, owner, created and retired seqs, record. */
export declare function documentRow(record: DocumentRecord): Cell[];
//# sourceMappingURL=rows.d.ts.map