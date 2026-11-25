import { apply } from "@earendil-works/chord/delta";
import { StorageRequestError } from "../../errors.js";
import { idFromNumber, seqFromNumber } from "../../ids.js";
import { nextCursor, scanStart } from "../scan.js";
import { CommitState, claimOf, PendingWrites, prepareDocumentActions } from "./commit.js";
import { applySqliteMigrationsForSchema } from "./migrations.js";
import { addressParts, encodeIndexedString, isCurrentOnly, parseJson, scopeColumns } from "./rows.js";
import { createSqliteSchema } from "./schema.js";
const cursorId = (cursor) => {
    const after = cursor?.after;
    if (after === undefined)
        return undefined;
    if (typeof after !== "number" || !Number.isSafeInteger(after))
        throw new StorageRequestError("Invalid storage cursor");
    return idFromNumber(after);
};
const page = (values, limit, order = "ascending") => {
    const items = values.slice(0, limit);
    if (values.length <= limit)
        return { items };
    return { items, next: nextCursor(items.at(-1).id, order) };
};
/** The ID condition, its parameter, and the `ORDER BY` direction of a table scan. */
const scanSql = (start) => start.order === "ascending"
    ? { clause: "id > ?", param: start.after ?? -1, direction: "ASC" }
    : { clause: "id < ?", param: start.after ?? Number.MAX_SAFE_INTEGER, direction: "DESC" };
const isAliveAt = (record, at) => {
    if (at === "current")
        return record.retiredAt === undefined;
    return record.createdAt <= at && (record.retiredAt === undefined || at < record.retiredAt);
};
/**
 * `executor`, setting `calls.failed` when one of its calls throws, synchronously (a synchronous driver) or by
 * rejecting, with any value: then a failing check is the database's, not one of Durable's own.
 */
function watchCalls(executor, calls) {
    const watched = async (call) => {
        try {
            return await call();
        }
        catch (error) {
            calls.failed = true;
            throw error;
        }
    };
    return {
        exec: (sql) => watched(() => executor.exec(sql)),
        run: (sql, ...params) => watched(() => executor.run(sql, ...params)),
        runCounted: (sql, ...params) => watched(() => executor.runCounted(sql, ...params)),
        get: (sql, ...params) => watched(() => executor.get(sql, ...params)),
        all: (sql, ...params) => watched(() => executor.all(sql, ...params)),
    };
}
/** Portable SQLite implementation of the Pico storage contract. */
export class SqliteStorage {
    db;
    schema;
    nextId;
    closed = false;
    closing;
    admittedReads = 0;
    readsDrained;
    constructor(db, schema, nextId) {
        this.db = db;
        this.schema = schema;
        this.nextId = nextId;
    }
    /** Initialize storage over an owned SQLite database facade. */
    static async open(db, options = {}) {
        try {
            const schema = createSqliteSchema(options.prefix);
            await applySqliteMigrationsForSchema(db, schema);
            const metadata = await db.get(`SELECT next_id, next_seq FROM ${schema.tables.durableMetadata} WHERE singleton = 1`);
            if (metadata === undefined)
                throw new Error("Durable SQLite metadata is missing");
            return new SqliteStorage(db, schema, Number(metadata.next_id));
        }
        catch (error) {
            try {
                await db.close();
            }
            catch {
                // Preserve the initialization failure.
            }
            throw error;
        }
    }
    /**
     * Commit `batches` in one SQL transaction, each with its own seq. Each batch is checked before it writes anything,
     * against the state the earlier ones left, and the first one refused ends the batch: the transaction commits the ones
     * before it. No savepoints, which Durable Objects do not allow: the checks run before the writes instead. The checks
     * read the stored state of all batches up front and run in memory, and the accepted batches are written per table in
     * multi-row statements (`commit.ts`), so a call costs a few statements whatever its number of batches. A batch with a
     * copy reads the copy's source from the database: the batches before it are written first, so a call of many fork
     * batches costs a few statements per fork.
     */
    async commit(batches, receive, _context) {
        this.assertOpen();
        const seqs = [];
        let refused;
        let candidateNextId = this.nextId;
        await this.db.transaction(async (transaction) => {
            const metadata = await this.readMetadata(transaction);
            let next = metadata.next_seq;
            // A failure of the database rejects the call and rolls back the batches before it with the transaction.
            const state = await CommitState.read(transaction, this.schema.tables, batches);
            const pending = new PendingWrites();
            for (const writes of batches) {
                const checked = await this.checkBatch(transaction, state, pending, writes);
                if (checked.kind === "refused") {
                    refused = { error: checked.refused };
                    break;
                }
                const seq = seqFromNumber(next++);
                state.apply(writes, checked.actions, seq);
                pending.add(writes, checked.actions, seq, state);
                seqs.push(seq);
                candidateNextId = Math.max(candidateNextId, this.candidateNextId(writes));
            }
            await pending.flush(transaction, this.schema.tables);
            if (seqs.length > 0) {
                await this.writeMetadata(transaction, Math.max(Number(metadata.next_id), candidateNextId), next);
            }
        });
        this.nextId = Math.max(this.nextId, candidateNextId);
        // `COMMIT` returned: the stored batches are durable.
        for (const [index, seq] of seqs.entries())
            receive(index, seq);
        return refused === undefined
            ? { kind: "stored", stored: seqs.length }
            : { kind: "refused", stored: seqs.length, refused: refused.error };
    }
    async readMetadata(executor) {
        const metadata = await executor.get(`SELECT next_id, next_seq FROM ${this.schema.tables.durableMetadata} WHERE singleton = 1`);
        if (metadata === undefined)
            throw new Error("Durable SQLite metadata is missing");
        return metadata;
    }
    async writeMetadata(executor, nextId, nextSeq) {
        await executor.run(`UPDATE ${this.schema.tables.durableMetadata} SET next_id = ?, next_seq = ? WHERE singleton = 1`, String(nextId), nextSeq);
    }
    /**
     * Durable's own checks of one batch, against what the batches before it left: its document actions, or its refusal.
     * Only these checks refuse; a failure of a database call rejects. A copy reads its source from the database, so the
     * batches before it are written first.
     */
    async checkBatch(transaction, state, pending, writes) {
        let actions;
        try {
            actions = prepareDocumentActions(writes);
            state.check(writes, actions);
        }
        catch (error) {
            return { kind: "refused", refused: error };
        }
        if (![...actions.values()].some((action) => action.copy !== undefined))
            return { kind: "checked", actions };
        await pending.flush(transaction, this.schema.tables);
        const calls = { failed: false };
        try {
            await this.resolveCopies(watchCalls(transaction, calls), actions);
        }
        catch (error) {
            if (calls.failed)
                throw error;
            return { kind: "refused", refused: error };
        }
        return { kind: "checked", actions };
    }
    async mintId() {
        this.assertOpen();
        if (!Number.isSafeInteger(this.nextId))
            throw new Error("ID space is exhausted");
        return idFromNumber(this.nextId++);
    }
    async conversation(id, _context) {
        this.assertOpen();
        const row = await this.db.get(`SELECT record FROM ${this.schema.tables.conversations} WHERE id = ?`, id);
        return row === undefined ? undefined : parseJson(row.record);
    }
    async scanConversations(query, limit, cursor, _context) {
        this.assertOpen();
        const start = scanStart(query.order, cursor, "ascending");
        const scan = scanSql(start);
        const clauses = [scan.clause];
        const params = [scan.param];
        if (query.ownerConversationId !== undefined) {
            clauses.push("owner_conversation_id = ?");
            params.push(query.ownerConversationId);
        }
        if (query.ownerTaskId !== undefined) {
            clauses.push("owner_task_id = ?");
            params.push(query.ownerTaskId);
        }
        params.push(limit + 1);
        const rows = await this.db.all(`SELECT record FROM ${this.schema.tables.conversations} WHERE ${clauses.join(" AND ")} ORDER BY id ${scan.direction} LIMIT ?`, ...params);
        return page(rows.map((row) => parseJson(row.record)), limit, start.order);
    }
    entry(idOrConversationId, idOrContext, context) {
        return this.admitRead(() => this.readEntry(idOrConversationId, idOrContext, context));
    }
    findLatestHeadMarker(conversationId, atOrBeforeEntryId, _context) {
        return this.admitRead(() => this.readLatestHeadMarker(conversationId, atOrBeforeEntryId));
    }
    scanEntries(query, limit, cursor, _context) {
        return this.admitRead(() => this.readEntries(query, limit, cursor));
    }
    async readEntry(idOrConversationId, idOrContext, context) {
        const id = context === undefined
            ? idFromNumber(idOrConversationId)
            : typeof idOrContext === "number"
                ? idFromNumber(idOrContext)
                : undefined;
        if (id === undefined)
            throw new StorageRequestError("Storage.entry() requires an entry ID");
        let conversation;
        if (context !== undefined) {
            const conversationId = idFromNumber(idOrConversationId);
            conversation = await this.readConversation(conversationId);
            if (conversation === undefined)
                throw new StorageRequestError(`Unknown conversation: ${conversationId}`);
        }
        const row = await this.db.get(`SELECT record, commit_seq FROM ${this.schema.tables.entries} WHERE id = ?`, id);
        if (row === undefined)
            return undefined;
        const entry = parseJson(row.record);
        if (conversation !== undefined) {
            let upperEntryId = Number.POSITIVE_INFINITY;
            while (conversation.id !== entry.conversationId) {
                if (conversation.parent === undefined)
                    return undefined;
                upperEntryId = Math.min(upperEntryId, conversation.parent.at);
                conversation = (await this.readConversation(conversation.parent.conversationId));
            }
            if (entry.id > upperEntryId)
                return undefined;
        }
        return { entry, commitSeq: seqFromNumber(row.commit_seq) };
    }
    async readLatestHeadMarker(conversationId, atOrBeforeEntryId) {
        let conversation = await this.readConversation(conversationId);
        if (conversation === undefined)
            throw new StorageRequestError(`Unknown conversation: ${conversationId}`);
        let upper = atOrBeforeEntryId;
        while (true) {
            const row = upper === undefined
                ? await this.db.get(`SELECT record FROM ${this.schema.tables.entries} WHERE conversation_id = ? AND head IS NOT NULL ORDER BY id DESC LIMIT 1`, conversation.id)
                : await this.db.get(`SELECT record FROM ${this.schema.tables.entries} WHERE conversation_id = ? AND head IS NOT NULL AND id <= ? ORDER BY id DESC LIMIT 1`, conversation.id, upper);
            if (row !== undefined)
                return parseJson(row.record);
            if (conversation.parent === undefined)
                return undefined;
            upper = upper === undefined ? conversation.parent.at : Math.min(upper, conversation.parent.at);
            conversation = (await this.readConversation(conversation.parent.conversationId));
        }
    }
    async readEntries(query, limit, cursor) {
        const { order, after } = scanStart(query.order, cursor, "descending");
        if (order === "ascending")
            return this.readEntriesAscending(query, limit, after);
        let conversation = await this.readConversation(query.conversationId);
        if (conversation === undefined)
            throw new StorageRequestError(`Unknown conversation: ${query.conversationId}`);
        let upper = query.maxEntryId;
        if (after !== undefined)
            upper = Math.min(upper ?? Number.MAX_SAFE_INTEGER, after - 1);
        const values = [];
        while (true) {
            const clauses = ["conversation_id = ?"];
            const params = [conversation.id];
            if (query.minEntryId !== undefined) {
                clauses.push("id >= ?");
                params.push(query.minEntryId);
            }
            if (upper !== undefined) {
                clauses.push("id <= ?");
                params.push(upper);
            }
            params.push(limit + 1 - values.length);
            const rows = await this.db.all(`SELECT record FROM ${this.schema.tables.entries} WHERE ${clauses.join(" AND ")} ORDER BY id DESC LIMIT ?`, ...params);
            values.push(...rows.map((row) => parseJson(row.record)));
            if (values.length > limit || conversation.parent === undefined)
                break;
            upper = upper === undefined ? conversation.parent.at : Math.min(upper, conversation.parent.at);
            if (query.minEntryId !== undefined && upper < query.minEntryId)
                break;
            conversation = (await this.readConversation(conversation.parent.conversationId));
        }
        return page(values, limit, "descending");
    }
    /** Oldest first: the fork chain's segments from the root conversation forward, each up to its fork point. */
    async readEntriesAscending(query, limit, after) {
        const segments = [];
        let conversation = await this.readConversation(query.conversationId);
        if (conversation === undefined)
            throw new StorageRequestError(`Unknown conversation: ${query.conversationId}`);
        let upper = query.maxEntryId;
        while (true) {
            segments.push({ conversationId: conversation.id, upper });
            if (conversation.parent === undefined)
                break;
            upper = upper === undefined ? conversation.parent.at : Math.min(upper, conversation.parent.at);
            if (query.minEntryId !== undefined && upper < query.minEntryId)
                break;
            conversation = (await this.readConversation(conversation.parent.conversationId));
        }
        let lower = query.minEntryId;
        if (after !== undefined)
            lower = Math.max(lower ?? after + 1, after + 1);
        const values = [];
        for (const segment of segments.reverse()) {
            const clauses = ["conversation_id = ?"];
            const params = [segment.conversationId];
            if (lower !== undefined) {
                clauses.push("id >= ?");
                params.push(lower);
            }
            if (segment.upper !== undefined) {
                clauses.push("id <= ?");
                params.push(segment.upper);
            }
            params.push(limit + 1 - values.length);
            const rows = await this.db.all(`SELECT record FROM ${this.schema.tables.entries} WHERE ${clauses.join(" AND ")} ORDER BY id ASC LIMIT ?`, ...params);
            values.push(...rows.map((row) => parseJson(row.record)));
            if (values.length > limit)
                break;
        }
        return page(values, limit, "ascending");
    }
    async task(id, _context) {
        this.assertOpen();
        const row = await this.db.get(`SELECT record FROM ${this.schema.tables.tasks} WHERE id = ?`, id);
        return row === undefined ? undefined : parseJson(row.record);
    }
    async scanTasks(query, limit, cursor, _context) {
        this.assertOpen();
        const start = scanStart(query.order, cursor, "ascending");
        const scan = scanSql(start);
        const clauses = [scan.clause];
        const params = [scan.param];
        if (query.conversationId !== undefined) {
            clauses.push("conversation_id = ?");
            params.push(query.conversationId);
        }
        if (query.kind !== undefined) {
            clauses.push("kind = ?");
            params.push(encodeIndexedString(query.kind));
        }
        if (query.status !== undefined) {
            clauses.push("status = ?");
            params.push(query.status);
        }
        if (query.abortRequested !== undefined) {
            clauses.push("abort_requested = ?");
            params.push(query.abortRequested ? 1 : 0);
        }
        if (query.background !== undefined) {
            clauses.push("background = ?");
            params.push(query.background ? 1 : 0);
        }
        params.push(limit + 1);
        const rows = await this.db.all(`SELECT record FROM ${this.schema.tables.tasks} WHERE ${clauses.join(" AND ")} ORDER BY id ${scan.direction} LIMIT ?`, ...params);
        return page(rows.map((row) => parseJson(row.record)), limit, start.order);
    }
    async submission(id, _context) {
        this.assertOpen();
        const row = await this.db.get(`SELECT record FROM ${this.schema.tables.submissions} WHERE id = ?`, id);
        return row === undefined ? undefined : parseJson(row.record);
    }
    async scanSubmissions(query, limit, cursor, _context) {
        this.assertOpen();
        const start = scanStart(query.order, cursor, "ascending");
        const scan = scanSql(start);
        const clauses = [scan.clause];
        const params = [scan.param];
        if (query.conversationId !== undefined) {
            clauses.push("conversation_id = ?");
            params.push(query.conversationId);
        }
        if (query.status !== undefined) {
            clauses.push("status = ?");
            params.push(query.status);
        }
        params.push(limit + 1);
        const rows = await this.db.all(`SELECT record FROM ${this.schema.tables.submissions} WHERE ${clauses.join(" AND ")} ORDER BY id ${scan.direction} LIMIT ?`, ...params);
        return page(rows.map((row) => parseJson(row.record)), limit, start.order);
    }
    async submissionByRequest(conversationId, requestId, _context) {
        this.assertOpen();
        const row = await this.db.get(`SELECT record FROM ${this.schema.tables.submissions} WHERE conversation_id = ? AND request_id = ?`, conversationId, encodeIndexedString(requestId));
        return row === undefined ? undefined : parseJson(row.record);
    }
    async findDocument(address, at, _context) {
        this.assertOpen();
        const parts = addressParts(address);
        const sql = at === "current"
            ? `SELECT record FROM ${this.schema.tables.documents}
					WHERE kind = ? AND scope_kind = ? AND owner_id = ? AND family = ? AND key_value = ?
					AND retired_at IS NULL ORDER BY created_at DESC LIMIT 1`
            : `SELECT record FROM ${this.schema.tables.documents}
					WHERE kind = ? AND scope_kind = ? AND owner_id = ? AND family = ? AND key_value = ?
					AND created_at <= ? AND (retired_at IS NULL OR retired_at > ?)
					ORDER BY created_at DESC LIMIT 1`;
        const params = [parts.kind, parts.scopeKind, parts.ownerId, parts.family, parts.keyValue];
        if (at !== "current")
            params.push(at, at);
        const row = await this.db.get(sql, ...params);
        return row === undefined ? undefined : parseJson(row.record);
    }
    async document(id, at, _context) {
        this.assertOpen();
        // The record and revision queries must observe one committed state; a commit between them can replace the base.
        return this.db.transaction((transaction) => this.materializeDocument(transaction, id, at));
    }
    async scanDocuments(query, limit, cursor, _context) {
        this.assertOpen();
        const scope = scopeColumns(query.scope);
        const clauses = ["scope_kind = ?", "owner_id = ?", "id > ?"];
        const params = [scope.scopeKind, scope.ownerId, cursorId(cursor) ?? -1];
        if (query.kind !== undefined) {
            clauses.push("kind = ?");
            params.push(encodeIndexedString(query.kind));
        }
        if (query.at === "current") {
            clauses.push("retired_at IS NULL");
        }
        else {
            clauses.push("created_at <= ?", "(retired_at IS NULL OR retired_at > ?)");
            params.push(query.at, query.at);
        }
        params.push(limit + 1);
        const rows = await this.db.all(`SELECT record FROM ${this.schema.tables.documents} WHERE ${clauses.join(" AND ")} ORDER BY id LIMIT ?`, ...params);
        return page(rows.map((row) => parseJson(row.record)), limit);
    }
    close(_context) {
        if (this.closing === undefined) {
            this.closed = true;
            this.closing = this.closeDatabase();
        }
        return this.closing;
    }
    async closeDatabase() {
        if (this.admittedReads > 0) {
            await new Promise((resolve) => {
                this.readsDrained = resolve;
            });
        }
        await this.db.close();
    }
    /**
     * Run a read that issues several queries. Close waits for admitted reads, so their later queries never reach a
     * closed database. Single-query reads and transactions are already ordered before close by the database.
     */
    async admitRead(read) {
        this.assertOpen();
        this.admittedReads++;
        try {
            return await read();
        }
        finally {
            if (--this.admittedReads === 0)
                this.readsDrained?.();
        }
    }
    async readConversation(id) {
        const row = await this.db.get(`SELECT record FROM ${this.schema.tables.conversations} WHERE id = ?`, id);
        return row === undefined ? undefined : parseJson(row.record);
    }
    async materializeDocument(executor, id, at) {
        const row = await executor.get(`SELECT record FROM ${this.schema.tables.documents} WHERE id = ?`, id);
        if (row === undefined)
            return undefined;
        const record = parseJson(row.record);
        if (at !== "current" && isCurrentOnly(record)) {
            throw new StorageRequestError(`Document ${id} does not retain historical content`);
        }
        if (!isAliveAt(record, at))
            return undefined;
        const upper = at === "current" ? Number.MAX_SAFE_INTEGER : at;
        const base = await executor.get(`SELECT seq, kind, version, content FROM ${this.schema.tables.documentRevisions}
				WHERE document_id = ? AND kind = 'base' AND seq <= ? ORDER BY seq DESC LIMIT 1`, id, upper);
        if (base === undefined)
            throw new Error(`Document ${id} is missing a required base`);
        let value = parseJson(base.content);
        const tail = await executor.all(`SELECT seq, kind, version, content FROM ${this.schema.tables.documentRevisions}
				WHERE document_id = ? AND seq > ? AND seq <= ? ORDER BY seq`, id, base.seq, upper);
        for (const revision of tail) {
            if (revision.kind !== "delta" || revision.version !== base.version) {
                throw new Error(`Document ${id} crosses a stored version boundary without a base`);
            }
            value = apply(value, parseJson(revision.content));
        }
        return { record, version: base.version, value, deltasSinceBase: tail.length };
    }
    candidateNextId(writes) {
        let nextId = this.nextId;
        for (const write of writes) {
            const id = claimOf(write)?.id;
            if (id !== undefined)
                nextId = Math.max(nextId, id + 1);
        }
        return nextId;
    }
    /** Resolve each copy to a base of its source's state before this batch, which may not change the source. */
    async resolveCopies(executor, actions) {
        for (const [id, action] of actions) {
            if (action.copy === undefined)
                continue;
            try {
                const stored = await this.materializeDocument(executor, action.copy.id, action.copy.at);
                if (stored === undefined)
                    throw new Error(`Fork source document ${action.copy.id} cannot be read`);
                const create = action.create;
                if (stored.record.scope.kind !== "conversation" ||
                    create.scope.kind !== "conversation" ||
                    stored.record.kind !== create.kind ||
                    stored.record.key !== create.key ||
                    stored.record.history !== create.history ||
                    stored.record.fork !== create.fork) {
                    throw new Error(`Fork source document ${action.copy.id} does not match the copied record`);
                }
                action.content = { kind: "base", version: stored.version, value: stored.value };
            }
            catch (error) {
                throw new Error(`Document copy ${id} was rejected`, { cause: error });
            }
        }
    }
    assertOpen() {
        if (this.closed)
            throw new Error("SqliteStorage is closed");
    }
}
//# sourceMappingURL=storage.js.map