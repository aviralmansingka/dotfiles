// Durable's `Storage` on Chord's store (slice 6b D1, D2, §2): opening under an owner name (claims, tables, the
// allocator), commits as one composite write of the store's commit step, and the reads, each one guarded read of the
// store (several queries at one state in a read transaction), its request errors in a tagged result told after it.
import { findDocumentEntry, listDocumentEntries, StoreOwnerTables, } from "@earendil-works/chord";
import { StorageRequestError } from "../../errors.js";
import { idFromNumber, seqFromNumber } from "../../ids.js";
import { nextCursor, scanStart } from "../scan.js";
import { DurableCommit } from "./commit.js";
import { addressOf, namespaceOf, readAt, recordOfEntry, SCOPE_NAMESPACES } from "./documents.js";
import { storageQueries } from "./queries.js";
import { Conversations, Entries, EntryHeads, encodeIndexed, RecordIds, Submissions, Tasks } from "./tables.js";
/** The id condition of a table scan from `start`. */
function scanFrom(start) {
    return start.order === "ascending"
        ? ["id", "gt", start.after ?? -1]
        : ["id", "lt", start.after ?? Number.MAX_SAFE_INTEGER];
}
function page(values, limit, order) {
    const items = values.slice(0, limit);
    if (values.length <= limit)
        return { items };
    return { items, next: nextCursor(items.at(-1).id, order) };
}
function cursorId(cursor) {
    const after = cursor?.after;
    if (after === undefined)
        return undefined;
    if (typeof after !== "number" || !Number.isSafeInteger(after))
        throw new StorageRequestError("Invalid storage cursor");
    return after;
}
/**
 * Durable's `Storage` on Chord's store (slice 6b D1, D2, §2): its records as declared tables under an owner name, its
 * documents in the store's documents engine, its ids from the store's one allocator, each commit call as one series
 * of the store's commit queue (one backend transaction, one seq per batch), published in the host's batch. Several may share a store under distinct owner names
 * (claims); the app owns the store, and `close` leaves it open.
 */
export class StoreStorage {
    #store;
    #owner;
    #claimant;
    #tables;
    #queries;
    #closed = false;
    #closing;
    /** Calls underway, which `close` waits for before it releases the claims (`#drained` once they reach 0). */
    #underway = 0;
    #drained;
    constructor(store, owner, claimant, tables) {
        this.#store = store;
        this.#owner = owner;
        this.#claimant = claimant;
        this.#tables = tables;
        this.#queries = storageQueries(tables);
    }
    /**
     * Opens Durable's storage in `store` under `owner` (a lowercase `[a-z0-9@/._~-]` name): claims its tables and its
     * document namespaces (a second claim is refused `invalid/args`), creates or migrates its tables, and raises the
     * store's allocator above every id it holds (one index read). A failure releases what it claimed.
     */
    static async open(store, owner, context) {
        // Chord's own: `openStore` or `importStore` made it.
        const chord = store;
        const claimant = { label: `StoreStorage(${owner})` };
        try {
            const declared = new StoreOwnerTables(chord, owner, claimant);
            const tables = {
                recordIds: declared.declare(RecordIds),
                conversations: declared.declare(Conversations),
                entries: declared.declare(Entries),
                entryHeads: declared.declare(EntryHeads),
                tasks: declared.declare(Tasks),
                submissions: declared.declare(Submissions),
            };
            for (const namespace of SCOPE_NAMESPACES)
                chord.claims.documents(owner, namespace, claimant);
            await declared.prepare(context);
            const highest = await chord.read((executor) => executor.get(`SELECT max("id") AS id FROM "${tables.recordIds.sql.table}"`), context);
            if (highest?.id != null)
                chord.ids.raise(highest.id);
            return new StoreStorage(chord, owner, claimant, tables);
        }
        catch (error) {
            chord.claims.release(claimant);
            throw error;
        }
    }
    /**
     * Commit `batches` as one series of the store (`ChordStore.commitSeries`): one backend transaction, one seq per
     * batch, each batch's checks (at staging, then against the state the earlier ones left) before its writes.
     */
    commit(batches, receive, context) {
        return this.#call(() => {
            const store = this.#store;
            const raise = (id) => store.ids.raise(id);
            const commits = [];
            for (const writes of batches) {
                try {
                    commits.push(new DurableCommit(writes, this.#owner, this.#tables, raise, context));
                }
                catch (error) {
                    // Staging runs Durable's checks of the batch itself: a refusal in its turn, the batches before it stored.
                    commits.push({ check: () => Promise.reject(error), writes: [] });
                    break;
                }
            }
            return store.commitSeries(commits, (index, seq) => receive(index, seqFromNumber(seq)), context);
        });
    }
    /**
     * Run a commit's publication in the attached host's batch (`batch.within`: it joins a running batch, opens one, or
     * runs next while one sends): Chord sources over Durable's views are marked in one batch per commit. Plainly without
     * a host.
     */
    publishing(publish, context) {
        const batch = this.#store.batch;
        if (batch === undefined)
            publish();
        else
            batch.within(publish, context);
    }
    mintId() {
        return this.#call(async () => idFromNumber(this.#store.mintId()));
    }
    conversation(id, context) {
        return this.#read((executor) => this.#conversation(executor, id, context), context);
    }
    scanConversations(query, limit, cursor, context) {
        return this.#reading(() => {
            const start = scanStart(query.order, cursor, "ascending");
            const conditions = [scanFrom(start)];
            if (query.ownerConversationId !== undefined) {
                conditions.push(["owner_conversation_id", "eq", query.ownerConversationId]);
            }
            if (query.ownerTaskId !== undefined)
                conditions.push(["owner_task_id", "eq", query.ownerTaskId]);
            return this.#scan(this.#queries.conversations, conditions, start, limit, context);
        });
    }
    entry(idOrConversationId, idOrContext, maybeContext) {
        if (maybeContext === undefined) {
            const context = idOrContext;
            return this.#read((executor) => this.#entry(executor, idOrConversationId, context), context);
        }
        const context = maybeContext;
        const id = typeof idOrContext === "number" ? idFromNumber(idOrContext) : undefined;
        return this.#reading(() => {
            if (id === undefined)
                throw new StorageRequestError("Storage.entry() requires an entry ID");
            const conversationId = idOrConversationId;
            return this.#store
                .read((executor) => this.#visibleEntry(executor, conversationId, id, context), context)
                .then(told);
        });
    }
    findLatestHeadMarker(conversationId, atOrBeforeEntryId, context) {
        return this.#reading(() => this.#store
            .read((executor) => this.#latestHeadMarker(executor, conversationId, atOrBeforeEntryId, context), context)
            .then(told));
    }
    scanEntries(query, limit, cursor, context) {
        return this.#reading(() => {
            const { order, after } = scanStart(query.order, cursor, "descending");
            const read = order === "ascending"
                ? (executor) => this.#entriesAscending(executor, query, limit, after, context)
                : (executor) => this.#entriesDescending(executor, query, limit, after, context);
            return this.#store.read(read, context).then(told);
        });
    }
    task(id, context) {
        const tasks = this.#queries.tasks;
        return this.#read(async (executor) => {
            const row = await tasks.byId(executor, id);
            return row === undefined ? undefined : tasks.record(row, context);
        }, context);
    }
    scanTasks(query, limit, cursor, context) {
        return this.#reading(() => {
            const start = scanStart(query.order, cursor, "ascending");
            const conditions = [scanFrom(start)];
            if (query.conversationId !== undefined)
                conditions.push(["conversation_id", "eq", query.conversationId]);
            if (query.kind !== undefined)
                conditions.push(["kind", "eq", encodeIndexed(query.kind)]);
            if (query.status !== undefined)
                conditions.push(["status", "eq", query.status]);
            if (query.abortRequested !== undefined)
                conditions.push(["abort_requested", "eq", query.abortRequested ? 1 : 0]);
            if (query.background !== undefined)
                conditions.push(["background", "eq", query.background ? 1 : 0]);
            return this.#scan(this.#queries.tasks, conditions, start, limit, context);
        });
    }
    submission(id, context) {
        const submissions = this.#queries.submissions;
        return this.#read(async (executor) => {
            const row = await submissions.byId(executor, id);
            return row === undefined ? undefined : submissions.record(row, context);
        }, context);
    }
    scanSubmissions(query, limit, cursor, context) {
        return this.#reading(() => {
            const start = scanStart(query.order, cursor, "ascending");
            const conditions = [scanFrom(start)];
            if (query.conversationId !== undefined)
                conditions.push(["conversation_id", "eq", query.conversationId]);
            if (query.status !== undefined)
                conditions.push(["status", "eq", query.status]);
            return this.#scan(this.#queries.submissions, conditions, start, limit, context);
        });
    }
    submissionByRequest(conversationId, requestId, context) {
        const submissions = this.#queries.submissions;
        const conditions = [
            ["conversation_id", "eq", conversationId],
            ["request_id", "eq", encodeIndexed(requestId)],
        ];
        return this.#read(async (executor) => {
            const row = await submissions.first(executor, conditions, "ascending");
            return row === undefined ? undefined : submissions.record(row, context);
        }, context);
    }
    findDocument(address, at, context) {
        return this.#read(async (executor) => {
            const entry = await findDocumentEntry(executor, addressOf(address, this.#owner), at);
            return entry === undefined ? undefined : recordOfEntry(entry);
        }, context);
    }
    document(id, at, context) {
        // The record and its revisions must come from one committed state (S4).
        return this.#reading(() => this.#store.readTransaction((executor) => readAt(executor, id, at, this.#owner), context).then(documentOf));
    }
    scanDocuments(query, limit, cursor, context) {
        return this.#reading(() => {
            const after = cursorId(cursor) ?? -1;
            const scope = {
                owner: this.#owner,
                namespace: namespaceOf(query.scope),
                ...(query.kind === undefined ? {} : { kind: encodeIndexed(query.kind) }),
            };
            return this.#store
                .read((executor) => listDocumentEntries(executor, scope, query.at, after, limit + 1), context)
                .then((found) => page(found.map(recordOfEntry), limit, "ascending"));
        });
    }
    /**
     * Refuses new calls, waits for its commits underway, then releases its claims; the store stays open (the app's),
     * and finishes the reads underway, which change nothing.
     */
    close(_context) {
        if (this.#closing === undefined) {
            this.#closed = true;
            this.#closing = (async () => {
                if (this.#underway > 0) {
                    await new Promise((resolve) => {
                        this.#drained = resolve;
                    });
                }
                this.#store.claims.release(this.#claimant);
            })();
        }
        return this.#closing;
    }
    /** Runs one commit or mint of this storage: refused once it closed, counted until it settles (`close` waits). */
    async #call(run) {
        if (this.#closed)
            throw new Error("StoreStorage is closed");
        this.#underway++;
        try {
            return await run();
        }
        finally {
            if (--this.#underway === 0)
                this.#drained?.();
        }
    }
    /**
     * A call that is one guarded read of the store: refused once closed; not waited for by `close` (a read changes
     * nothing, and the store, which stays open, finishes it).
     */
    #read(read, context) {
        return this.#reading(() => this.#store.read(read, context));
    }
    /**
     * A read call: `read` prepares its guarded read (a request error thrown then, before it) and returns it. Refused
     * once closed; one promise per call besides the guard's (no async wrapper).
     */
    #reading(read) {
        try {
            if (this.#closed)
                throw new Error("StoreStorage is closed");
            return read();
        }
        catch (error) {
            return Promise.reject(error);
        }
    }
    async #conversation(executor, id, context) {
        const conversations = this.#queries.conversations;
        const row = await conversations.byId(executor, id);
        return row === undefined ? undefined : conversations.record(row, context);
    }
    #entry(executor, id, context) {
        const entries = this.#queries.entries;
        return entries.byId(executor, id).then((row) => {
            if (row === undefined)
                return undefined;
            return { entry: entries.record(row, context), commitSeq: seqFromNumber(row.commit_seq) };
        });
    }
    /** Entry `id` when visible through `conversationId`'s fork chain (`SqliteStorage.readEntry`). */
    async #visibleEntry(executor, conversationId, id, context) {
        let conversation = await this.#conversation(executor, conversationId, context);
        if (conversation === undefined)
            return unknownConversation(conversationId);
        const stored = await this.#entry(executor, id, context);
        if (stored === undefined)
            return NOTHING_FOUND;
        let upper = Number.POSITIVE_INFINITY;
        while (conversation.id !== stored.entry.conversationId) {
            if (conversation.parent === undefined)
                return NOTHING_FOUND;
            upper = Math.min(upper, conversation.parent.at);
            conversation = (await this.#conversation(executor, conversation.parent.conversationId, context));
        }
        return stored.entry.id > upper ? NOTHING_FOUND : { kind: "found", value: stored };
    }
    async #latestHeadMarker(executor, conversationId, atOrBeforeEntryId, context) {
        let conversation = await this.#conversation(executor, conversationId, context);
        if (conversation === undefined)
            return unknownConversation(conversationId);
        let upper = atOrBeforeEntryId;
        while (true) {
            const { latestHead } = this.#queries;
            const head = upper === undefined
                ? await executor.get(latestHead.any, conversation.id)
                : await executor.get(latestHead.atOrBefore, conversation.id, upper);
            if (head !== undefined) {
                // Written with its entry, in the same commit.
                const row = (await this.#queries.entries.byId(executor, head.id));
                const value = this.#queries.entries.record(row, context);
                return { kind: "found", value };
            }
            if (conversation.parent === undefined)
                return NOTHING_FOUND;
            upper = upper === undefined ? conversation.parent.at : Math.min(upper, conversation.parent.at);
            conversation = (await this.#conversation(executor, conversation.parent.conversationId, context));
        }
    }
    /** Newest first: each conversation of the fork chain up to its fork point (`SqliteStorage.readEntries`). */
    async #entriesDescending(executor, query, limit, after, context) {
        let conversation = await this.#conversation(executor, query.conversationId, context);
        if (conversation === undefined)
            return unknownConversation(query.conversationId);
        let upper = query.maxEntryId;
        if (after !== undefined)
            upper = Math.min(upper ?? Number.MAX_SAFE_INTEGER, after - 1);
        const values = [];
        while (true) {
            const range = this.#range(conversation.id, query.minEntryId, upper);
            const rows = await this.#queries.entries.select(executor, range, "descending", limit + 1 - values.length);
            this.#queries.entries.records(rows, values, context);
            if (values.length > limit || conversation.parent === undefined)
                break;
            upper = upper === undefined ? conversation.parent.at : Math.min(upper, conversation.parent.at);
            if (query.minEntryId !== undefined && upper < query.minEntryId)
                break;
            conversation = (await this.#conversation(executor, conversation.parent.conversationId, context));
        }
        return { kind: "found", value: page(values, limit, "descending") };
    }
    /** Oldest first: the fork chain's segments from the root forward, each up to its fork point. */
    async #entriesAscending(executor, query, limit, after, context) {
        const segments = [];
        let conversation = await this.#conversation(executor, query.conversationId, context);
        if (conversation === undefined)
            return unknownConversation(query.conversationId);
        let upper = query.maxEntryId;
        while (true) {
            segments.push({ conversationId: conversation.id, upper });
            if (conversation.parent === undefined)
                break;
            upper = upper === undefined ? conversation.parent.at : Math.min(upper, conversation.parent.at);
            if (query.minEntryId !== undefined && upper < query.minEntryId)
                break;
            conversation = (await this.#conversation(executor, conversation.parent.conversationId, context));
        }
        let lower = query.minEntryId;
        if (after !== undefined)
            lower = Math.max(lower ?? after + 1, after + 1);
        const values = [];
        for (const segment of segments.reverse()) {
            const range = this.#range(segment.conversationId, lower, segment.upper);
            const rows = await this.#queries.entries.select(executor, range, "ascending", limit + 1 - values.length);
            this.#queries.entries.records(rows, values, context);
            if (values.length > limit)
                break;
        }
        return { kind: "found", value: page(values, limit, "ascending") };
    }
    /** One conversation's entries with ids from `lower` to `upper` (inclusive, each optional). */
    #range(conversationId, lower, upper) {
        const conditions = [["conversation_id", "eq", conversationId]];
        if (lower !== undefined)
            conditions.push(["id", "gte", lower]);
        if (upper !== undefined)
            conditions.push(["id", "lte", upper]);
        return conditions;
    }
    /** A page of a table scan: up to `limit` records of `queries`' table whose `conditions` hold, from `start`. */
    #scan(queries, conditions, start, limit, context) {
        return this.#store
            .read((executor) => queries.select(executor, conditions, start.order, limit + 1), context)
            .then((rows) => {
            const values = [];
            queries.records(rows, values, context);
            return page(values, limit, start.order);
        });
    }
}
/** A read that found nothing. */
const NOTHING_FOUND = { kind: "found", value: undefined };
function unknownConversation(id) {
    return { kind: "refused", message: `Unknown conversation: ${id}` };
}
/** A read's data, its request error thrown now that the guarded read returned (slice 6b §1.4). */
function told(read) {
    if (read.kind === "refused")
        throw new StorageRequestError(read.message);
    return read.value;
}
/** A document read's result, a record that keeps no history at the point thrown as Durable's request error. */
function documentOf(read) {
    if (read.kind === "current_only")
        throw new StorageRequestError(`Document ${read.id} does not retain historical content`);
    return read.document;
}
//# sourceMappingURL=storage.js.map