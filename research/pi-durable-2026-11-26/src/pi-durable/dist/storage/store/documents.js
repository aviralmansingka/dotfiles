// Durable's documents in the store's documents engine (slice 6b §1.5, R1): a Durable address as an engine address
// under the storage's owner name (its scope as the namespace, its kind and key JSON-encoded as Durable's indexed
// strings), a Durable record as an engine record and back (the Durable record in `meta`), and a document read at a
// point.
import { loadContent, readDocumentEntry, } from "@earendil-works/chord";
import { seqFromNumber } from "../../ids.js";
import { encodeIndexed } from "./tables.js";
/** The namespaces a storage claims under its owner: Durable's scopes (Chord's namespaces never contain a `:`). */
export const SCOPE_NAMESPACES = ["session", "conversation:", "task:"];
/** The engine namespace of a Durable scope: `session`, `conversation:<id>`, `task:<id>`. */
export function namespaceOf(scope) {
    switch (scope.kind) {
        case "session":
            return "session";
        case "conversation":
            return `conversation:${scope.conversationId}`;
        case "task":
            return `task:${scope.taskId}`;
    }
}
/** The engine address of a Durable address under `owner`. */
export function addressOf(address, owner) {
    const at = { owner, namespace: namespaceOf(address.scope), kind: encodeIndexed(address.kind) };
    return address.key === undefined ? at : { ...at, key: encodeIndexed(address.key) };
}
/** What a record of `scope` keeps: session and task documents and latest conversation ones their latest state. */
export function historyOf(record) {
    return record.scope.kind === "conversation" && record.history === "rewindable" ? "rewindable" : "latest";
}
/**
 * The engine record of a Durable creation at `seq` (retired at once for an empty lifetime): the Durable record itself,
 * its creation seq included, in `meta`, so a read of a live record parses one JSON text from one column, as
 * `SqliteStorage`'s does (a retirement later sets only the engine's `retired_at`).
 */
export function engineRecord(create, owner, version, seq, retired) {
    return {
        id: create.id,
        ...addressOf(create, owner),
        history: historyOf(create),
        createdAt: seq,
        ...(retired ? { retiredAt: seq } : {}),
        meta: JSON.stringify({ ...create, createdAt: seq }),
        revision: 1,
        version,
        fingerprint: "",
    };
}
/**
 * The Durable record of an engine record of this storage's owner and scopes, `undefined` for anyone else's (a Chord
 * document, another owner's): its id is unknown to this storage.
 */
export function durableRecord(record, owner) {
    const { meta } = record;
    if (meta === undefined || !ownedHere(record, owner))
        return undefined;
    return recordOfEntry({ meta, retired_at: record.retiredAt ?? null });
}
/** The Durable record of an engine entry read at one of this storage's addresses or scopes (the record in `meta`). */
export function recordOfEntry(entry) {
    // Written by `engineRecord`, parsed fresh: a retirement since is set on it in place.
    const record = JSON.parse(entry.meta);
    if (entry.retired_at !== undefined && entry.retired_at !== null)
        record.retiredAt = seqFromNumber(entry.retired_at);
    return record;
}
/** Whether a record is this storage's: `owner`'s, in one of Durable's scopes (not a Chord document of the owner). */
function ownedHere(record, owner) {
    const { namespace } = record;
    if (record.owner !== owner)
        return false;
    return namespace === "session" || namespace.startsWith("conversation:") || namespace.startsWith("task:");
}
/** Whether a document is alive at `at` (the half-open lifetime). */
export function aliveAt(record, at) {
    if (at === "current")
        return record.retiredAt === undefined;
    return record.createdAt <= at && (record.retiredAt === undefined || at < record.retiredAt);
}
/**
 * Document `id` of `owner` at `at`: absent (unknown, someone else's, not alive at `at`), a record whose history does
 * not reach back to `at`, or its value from the base at or below `at` and the deltas up to it.
 */
export async function readAt(executor, id, at, owner) {
    const entry = await readDocumentEntry(executor, id);
    if (entry === undefined || entry.meta === null || !ownedHere(entry, owner)) {
        return { kind: "found", document: undefined };
    }
    const record = recordOfEntry(entry);
    if (at !== "current" && entry.history !== "rewindable")
        return { kind: "current_only", id };
    if (!aliveAt(record, at))
        return { kind: "found", document: undefined };
    const point = at;
    const loaded = await loadContent(executor, id, point);
    // The engine stores what Durable's commits gave it: JSON objects.
    const value = loaded.value;
    return {
        kind: "found",
        document: { record, version: loaded.version, value, deltasSinceBase: loaded.deltasSinceBase },
    };
}
//# sourceMappingURL=documents.js.map