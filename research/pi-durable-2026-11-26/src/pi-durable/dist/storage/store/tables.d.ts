import type { JsonValue } from "@earendil-works/chord/json";
import type { ConversationRecord, EntryRecord, SubmissionRecord, TaskRecord } from "../../types.ts";
/** Which record type owns an id: Durable's one namespace across its five record types. */
export declare const RecordIds: import("@earendil-works/chord").TableDefinition<{
    id: import("@earendil-works/chord").IntegerSchema;
    record_type: import("@earendil-works/chord").StringSchema;
}, readonly ["id"], 1>;
export declare const Conversations: import("@earendil-works/chord").TableDefinition<{
    id: import("@earendil-works/chord").IntegerSchema;
    owner_conversation_id: import("@earendil-works/chord").IntegerSchema;
    owner_task_id: import("@earendil-works/chord").IntegerSchema;
    record: import("@earendil-works/chord").JsonColumnSchema<unknown>;
}, readonly ["id"], 1>;
export declare const Entries: import("@earendil-works/chord").TableDefinition<{
    id: import("@earendil-works/chord").IntegerSchema;
    conversation_id: import("@earendil-works/chord").IntegerSchema;
    commit_seq: import("@earendil-works/chord").IntegerSchema;
    record: import("@earendil-works/chord").JsonColumnSchema<unknown>;
}, readonly ["id"], 1>;
/**
 * The entries with a head marker, by conversation: what `SqliteStorage`'s partial index on `head IS NOT NULL` is,
 * as rows written only with such an entry, so a commit of an entry without one updates no second index.
 */
export declare const EntryHeads: import("@earendil-works/chord").TableDefinition<{
    id: import("@earendil-works/chord").IntegerSchema;
    conversation_id: import("@earendil-works/chord").IntegerSchema;
}, readonly ["id"], 1>;
export declare const Tasks: import("@earendil-works/chord").TableDefinition<{
    id: import("@earendil-works/chord").IntegerSchema;
    conversation_id: import("@earendil-works/chord").IntegerSchema;
    kind: import("@earendil-works/chord").StringSchema;
    status: import("@earendil-works/chord").StringSchema;
    abort_requested: import("@earendil-works/chord").IntegerSchema;
    background: import("@earendil-works/chord").IntegerSchema;
    record: import("@earendil-works/chord").JsonColumnSchema<unknown>;
}, readonly ["id"], 1>;
export declare const Submissions: import("@earendil-works/chord").TableDefinition<{
    id: import("@earendil-works/chord").IntegerSchema;
    conversation_id: import("@earendil-works/chord").IntegerSchema;
    request_id: import("@earendil-works/chord").StringSchema;
    status: import("@earendil-works/chord").StringSchema;
    record: import("@earendil-works/chord").JsonColumnSchema<unknown>;
}, readonly ["id"], 1>;
/** Durable's JSON encoding of an indexed string: lossless whatever the string (lone surrogates, NUL). */
export declare const encodeIndexed: (value: string) => string;
/** The row of a conversation record. */
export declare function conversationRow(value: ConversationRecord): object;
/** The row of an entry record; `commit_seq` is stamped by the step. */
export declare function entryRow(value: EntryRecord): object;
/** The row of a task record. */
export declare function taskRow(value: TaskRecord<JsonValue, JsonValue, JsonValue>): object;
/** The row of a submission record. */
export declare function submissionRow(value: SubmissionRecord): object;
//# sourceMappingURL=tables.d.ts.map