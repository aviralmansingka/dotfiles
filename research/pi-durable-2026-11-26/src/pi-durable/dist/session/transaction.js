import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { track, } from "@earendil-works/chord/delta";
import { copyJson } from "@earendil-works/chord/json";
import { addressId, checkRecordScope, checkRecordVersion, documentCreate, materializeDocumentValue, resolveAddress, } from "../documents.js";
import { ReadAfterWrite } from "../errors.js";
import { deliverSignal, isSettled, SubmissionSettled } from "../signals.js";
import { ROOT_CONVERSATION_ID } from "../types.js";
import { prepareForkDocumentCopies } from "./forks.js";
import { documentKey, incarnationKey, scopeKey, tableKeys } from "./keys.js";
/**
 * Complete record after applying one change. Placement turns a queued input `placed` and a queued write `done`; a
 * continue is never queued, so never placed. Only a placed input or continue can be answered. A settled record stays.
 */
function applySubmissionChange(current, change) {
    if (current.status === "done" || current.status === "unanswered")
        return current;
    if (change.status === "placed") {
        if (current.status !== "queued")
            throw new Error(`Submission ${current.id} is not queued`);
        const status = current.type === "input" ? "placed" : "done";
        return { ...current, status, entry: change.entry };
    }
    if (change.status === "done" && current.status !== "placed") {
        throw new Error(`Submission ${current.id} is not a placed input or continue`);
    }
    // Queued and placed records carry no answer, reason, or detail; an unanswered input keeps its entry.
    return { ...current, ...change };
}
const INTERNAL_SCAN_PAGE_SIZE = 256;
const EMPTY_OPERATIONS = [];
const TABLE_JSON_COPY_OPTIONS = { omitUndefinedProperties: true };
/**
 * Transaction for one Session commit callback.
 *
 * Every asynchronous operation is tracked so callback settlement can reject and drain unfinished work. Session calls
 * one settlement method, then either discards prepared changes or adopts them once after Storage succeeds.
 */
export class Transaction {
    #host;
    #context;
    #scope;
    #pendingOperations = new Set();
    #sealed = false;
    #hasTableWrite = false;
    /** Atomic batch; conversation and entry writes stage eagerly, while task and document writes assemble later. */
    #writes = [];
    #createdConversationIds = new Set();
    #forkSourceConversationIds = new Set();
    #forkSourceDocumentIds = new Set();
    /** One entry per task touched by a public read, candidate write, or document-owner lookup. */
    #tasksById = new Map();
    /** Submissions created by this transaction, by ID. */
    #submissions = new Map();
    /** Submission settlements and placements in staging order; resolved against the latest candidate record during assembly. */
    #submissionChanges = [];
    /** Write and publication plans of every staged incarnation, built during assembly. */
    #plans = [];
    /** Every document acquisition or retirement marker in staging order. */
    #documents = [];
    /** Latest transaction-local incarnation or retirement marker at each logical address. */
    #latestDocumentByAddress = new Map();
    constructor(host, context, scope = {}) {
        this.#host = host;
        this.#context = context;
        this.#scope = scope;
    }
    /** Internal: the context of the commit this transaction belongs to. */
    get context() {
        return this.#context;
    }
    /** Internal: whether a table write was staged, after which table reads throw `ReadAfterWrite`. */
    get hasTableWrite() {
        return this.#hasTableWrite;
    }
    /**
     * Internal: whether `tx` is a transaction of a commit of the Session behind `host`. A brand check, so a proxy or
     * another wrapper of a transaction is not one.
     */
    static ownedBy(tx, host) {
        return #host in tx && tx.#host === host;
    }
    // ─── Table reads ────────────────────────────────────────────────────────
    conversation(id) {
        return this.#read("conversation", () => this.#host.storage.conversation(id, this.#context));
    }
    entry(first, second) {
        const kind = typeof first === "number" ? undefined : first.kind;
        const id = typeof first === "number" ? first : second;
        return this.#read("entry", async () => {
            const entry = (await this.#host.storage.entry(id, this.#context))?.entry;
            return kind === undefined || entry?.kind === kind ? entry : undefined;
        });
    }
    task(id) {
        return this.#read("task", () => this.#committedTask(id));
    }
    scanConversations(query, limit, cursor) {
        return this.#read("scanConversations", () => this.#host.storage.scanConversations(query, limit, cursor, this.#context));
    }
    scanEntries(query, limit, cursor) {
        return this.#read("scanEntries", () => this.#host.storage.scanEntries(query, limit, cursor, this.#context));
    }
    latestHeadMarker(conversationId) {
        return this.#read("latestHeadMarker", () => this.#host.latestHeadMarker(conversationId, this.#context));
    }
    latestEntryId(conversationId) {
        return this.#read("latestEntryId", () => this.#host.latestEntryId(conversationId, this.#context));
    }
    scanTasks(query, limit, cursor) {
        return this.#read("scanTasks", () => this.#host.storage.scanTasks(query, limit, cursor, this.#context));
    }
    /** Committed submission record. */
    submission(id) {
        return this.#read("submission", () => this.#host.storage.submission(id, this.#context));
    }
    /** Committed submission with a conversation-scoped request ID. */
    submissionByRequest(conversationId, requestId) {
        return this.#read("submissionByRequest", () => this.#host.storage.submissionByRequest(conversationId, requestId, this.#context));
    }
    // ─── Table writes ───────────────────────────────────────────────────────
    createConversation(options) {
        return this.#write(() => this.#stageConversation(undefined, options.ownership));
    }
    /** Internal final-form bootstrap path for the reserved root identity. */
    createRootConversation() {
        return this.#write(() => this.#stageConversation(undefined, { kind: "ownerless" }, ROOT_CONVERSATION_ID));
    }
    forkConversation(parentConversationId, at, options) {
        return this.#write(() => this.#stageConversation({ conversationId: parentConversationId, at }, options.ownership));
    }
    async #stageConversation(parent, ownership, reservedId) {
        const ownerTaskId = ownership.kind === "task" ? ownership.taskId : undefined;
        const id = reservedId ?? (await this.#host.storage.mintId());
        this.#assertOpen();
        let owner;
        if (ownerTaskId !== undefined) {
            const task = await this.#currentTask(ownerTaskId);
            this.#assertOpen();
            if (task === undefined)
                throw new Error(`Conversation owner task ${ownerTaskId} does not exist`);
            owner = { conversationId: task.conversationId, taskId: ownerTaskId };
        }
        const record = {
            id,
            ...(parent === undefined ? {} : { parent }),
            ...(owner === undefined ? {} : { owner }),
        };
        const copies = parent === undefined
            ? []
            : await prepareForkDocumentCopies(this.#host.storage, parent.conversationId, parent.at, id, this.#context);
        this.#assertOpen();
        for (const copy of copies) {
            this.#forkSourceDocumentIds.add(copy.source.id);
            const entry = {
                addressId: addressId(copy.record),
                address: copy.record,
                target: { kind: "fork-copy", ...copy },
                retireOnCommit: false,
            };
            this.#documents.push(entry);
            this.#latestDocumentByAddress.set(entry.addressId, entry);
        }
        if (parent !== undefined)
            this.#forkSourceConversationIds.add(parent.conversationId);
        this.#createdConversationIds.add(id);
        this.#writes.push({ type: "conversation", value: record });
        await this.#host.conversationCreated(this, record);
        this.#assertOpen();
        return record;
    }
    appendEntry(first, second, third) {
        if (typeof first === "number")
            return this.#appendEntry(first, second);
        return this.#appendEntry(second, { ...third, kind: first.kind });
    }
    #appendEntry(conversationId, value) {
        return this.#write(async () => {
            await this.#requireConversation(conversationId);
            this.#assertOpen();
            const id = await this.#host.storage.mintId();
            this.#assertOpen();
            const { head, ...rest } = value;
            // Undefined `head` and `byTaskId` are omitted by the copy.
            const record = copyJson({
                ...rest,
                id,
                conversationId,
                head: head === "self" ? id : head,
                byTaskId: this.#scope.taskId,
            }, TABLE_JSON_COPY_OPTIONS);
            this.#writes.push({ type: "entry", value: record });
            return record;
        });
    }
    createTask(task, input, options) {
        return this.#write(async () => {
            if (options.submissionIds !== undefined) {
                let trace;
                let links;
                for (let index = 0; index < options.submissionIds.length; index++) {
                    const id = options.submissionIds[index];
                    const submission = this.#submissions.get(id) ?? (await this.#host.storage.submission(id, this.#context));
                    if (index === 0)
                        trace = submission?.trace ?? "root";
                    else if (submission?.trace !== undefined) {
                        links ??= [];
                        links.push(submission.trace);
                    }
                }
                options = { ...options, trace, links };
            }
            const ownership = options.ownership;
            let owner;
            if (ownership.kind === "task") {
                // Validated again against the owner's final candidate during assembly.
                owner = await this.#currentTask(ownership.taskId);
                this.#assertOpen();
                if (owner === undefined)
                    throw new Error(`Task owner ${ownership.taskId} does not exist`);
                if (options.background === true)
                    throw new TypeError("A child task cannot be background");
                if (options.conversationId !== undefined && options.conversationId !== owner.conversationId) {
                    throw new Error(`A child task lives in its owner's conversation ${owner.conversationId}`);
                }
            }
            const conversationId = owner?.conversationId ?? options.conversationId ?? this.#scope.conversationId;
            if (conversationId === undefined)
                throw new TypeError("Tx.createTask() requires options.conversationId");
            await this.#requireConversation(conversationId);
            this.#assertOpen();
            const definition = task.definition;
            const checkpoint = definition.initial(input);
            const id = await this.#host.storage.mintId();
            this.#assertOpen();
            const record = copyJson({
                id,
                conversationId,
                kind: definition.name,
                version: definition.version,
                input,
                trace: options.trace === "root"
                    ? undefined
                    : (options.trace ?? this.#context.telemetry.propagation?.inject(this.#context.telemetry)),
                links: options.links,
                ...(owner === undefined ? {} : { owner: owner.id }),
                background: options.background ?? false,
                abortRequested: false,
                ...(options.abandonOnRestart === true ? { abandonOnRestart: true } : {}),
                state: { status: "pending", checkpoint },
            }, TABLE_JSON_COPY_OPTIONS);
            this.#tasksById.set(id, { write: { kind: "create", record } });
            return id;
        });
    }
    /** Create a raw submission record with a fresh ID; no admission rules apply. */
    createSubmission(create) {
        return this.#write(async () => {
            await this.#requireConversation(create.conversationId);
            this.#assertOpen();
            const id = await this.#host.storage.mintId();
            this.#assertOpen();
            const record = copyJson({ ...create, id }, TABLE_JSON_COPY_OPTIONS);
            this.#submissions.set(id, record);
            return record;
        });
    }
    /**
     * Settle a submission. Resolved during assembly against the transaction's latest candidate record, falling back to
     * committed state, so it is not a caller table read and works after the first table write.
     */
    settleSubmission(id, settlement) {
        this.#assertOpen();
        this.#hasTableWrite = true;
        this.#submissionChanges.push({ id, change: copyJson(settlement) });
    }
    /** Place a queued submission at `entry`; resolved during assembly like `settleSubmission()`. */
    placeSubmission(id, entry) {
        this.#assertOpen();
        this.#hasTableWrite = true;
        this.#submissionChanges.push({ id, change: { status: "placed", entry } });
    }
    /** Deliver a signal to a task (spec suspendable §3.2): a read of the task, then a write of it when the key changes. */
    signal(taskId, token, key, value) {
        return this.#read("signal", async () => {
            const committed = await this.#committedTask(taskId);
            // Read after the await: a delivery started alongside, in `Promise.all()`, may have staged the key since.
            const record = this.#tasksById.get(taskId)?.write?.record ?? committed;
            const delivered = deliverSignal(record, token, key, value, this.#host.now());
            if (delivered.record !== undefined)
                this.setTask(delivered.record);
            return delivered.result;
        });
    }
    /**
     * Internal: replace one task record. Tasks change their own state through their runtime. A live replacement keeps the
     * memos an earlier write of this transaction staged, so no write erases another.
     */
    setTask(value) {
        this.#assertOpen();
        this.#hasTableWrite = true;
        this.#stageTask(value);
    }
    /** Stage a task record over the transaction's candidate, also during assembly. */
    #stageTask(value) {
        const task = this.#taskEntry(value.id);
        const candidate = task.write?.record;
        if (candidate?.state.status === "terminal") {
            throw new Error(`Task ${value.id} already has a terminal candidate`);
        }
        if (candidate !== undefined && candidate.conversationId !== value.conversationId) {
            throw new Error(`Task ${value.id} cannot change conversations`);
        }
        // A live replacement keeps the memos an earlier write staged, such as a signal delivered to a task whose own commit
        // then changes its state: no write erases another.
        const status = value.state.status;
        const keeps = candidate?.memos !== undefined && status !== "terminal" && status !== "completing";
        const composed = keeps ? { ...value, memos: { ...candidate.memos, ...value.memos } } : value;
        task.write = {
            kind: task.write?.kind === "create" ? "create" : "replace",
            record: copyJson(this.#stampTimes(composed, candidate), TABLE_JSON_COPY_OPTIONS),
        };
    }
    /** Internal: candidate records of the tasks this transaction created or replaced so far. */
    stagedTasks() {
        const records = [];
        for (const task of this.#tasksById.values())
            if (task.write !== undefined)
                records.push(task.write.record);
        return records;
    }
    /** Internal: IDs of the tasks this transaction creates. */
    createdTaskIds() {
        const ids = [];
        for (const [id, task] of this.#tasksById)
            if (task.write?.kind === "create")
                ids.push(id);
        return ids;
    }
    /** Internal: conversations this transaction created or forked so far. */
    stagedConversations() {
        const records = [];
        for (const write of this.#writes)
            if (write.type === "conversation")
                records.push(write.value);
        return records;
    }
    doc(token, ...args) {
        try {
            this.#assertOpen();
            const definition = token.definition;
            const resolved = resolveAddress(definition, args);
            this.#assertTaskDocumentsOpen(resolved);
            const latest = this.#latestDocumentByAddress.get(resolved.id);
            if (latest !== undefined && !latest.retireOnCommit) {
                if (latest.draftPromise !== undefined)
                    return latest.draftPromise;
                if (latest.target?.kind === "fork-copy") {
                    latest.draftPromise = this.#track(this.#acquireForkCopy(latest, definition, latest.target));
                    return latest.draftPromise;
                }
            }
            const seed = definition.family === true ? copyJson(args[resolved.nextArgument]) : undefined;
            const docEntry = {
                addressId: resolved.id,
                address: resolved.address,
                definition,
                retireOnCommit: false,
            };
            this.#documents.push(docEntry);
            this.#latestDocumentByAddress.set(docEntry.addressId, docEntry);
            // Capture retirement before awaiting so a pending old acquisition and its replacement stay distinct.
            docEntry.draftPromise = this.#track(this.#acquire(docEntry, seed, latest?.retireOnCommit === true));
            return docEntry.draftPromise;
        }
        catch (error) {
            return Promise.reject(error);
        }
    }
    retireDoc(token, ...args) {
        try {
            this.#assertOpen();
            const definition = token.definition;
            const resolved = resolveAddress(definition, args);
            const latest = this.#latestDocumentByAddress.get(resolved.id);
            if (latest?.retireOnCommit)
                return Promise.resolve();
            if (latest?.target?.kind === "fork-copy") {
                checkRecordScope(definition, latest.target.record);
                latest.retireOnCommit = true;
                return Promise.resolve();
            }
            if (latest?.draftPromise !== undefined) {
                // Retirement of an acquired draft persists its final content before retirement.
                latest.retireOnCommit = true;
                return this.#track(latest.draftPromise.then(() => undefined));
            }
            const entry = {
                addressId: resolved.id,
                address: resolved.address,
                definition,
                retireOnCommit: true,
            };
            this.#documents.push(entry);
            this.#latestDocumentByAddress.set(entry.addressId, entry);
            return this.#track(this.#findRetirement(entry));
        }
        catch (error) {
            return Promise.reject(error);
        }
    }
    async #acquire(entry, seed, skipLoad) {
        const definition = entry.definition;
        const loaded = skipLoad
            ? undefined
            : await this.#host.load(definition, entry.addressId, entry.address, this.#context);
        this.#assertOpen();
        if (loaded !== undefined) {
            checkRecordScope(definition, loaded.record);
            checkRecordVersion(definition, loaded.record, loaded.storedVersion);
            entry.target = { kind: "loaded", document: loaded };
            entry.change = loaded.tracker.beginChange();
            return entry.change.state;
        }
        const scope = entry.address.scope;
        if (scope.kind === "conversation")
            await this.#requireConversation(scope.conversationId);
        if (scope.kind === "task") {
            const task = await this.#currentTask(scope.taskId);
            if (task === undefined)
                throw new Error(`Task ${scope.taskId} does not exist`);
            if (task.state.status === "terminal")
                throw new Error(`Task ${scope.taskId} is terminal`);
        }
        this.#assertOpen();
        const value = copyJson(definition.family === true ? definition.initial(seed) : definition.initial());
        const id = await this.#host.storage.mintId();
        this.#assertOpen();
        const tracker = track(value);
        entry.target = {
            kind: "created",
            record: documentCreate(definition, entry.address, id),
            version: definition.version,
            tracker,
        };
        entry.change = tracker.beginChange();
        return entry.change.state;
    }
    async #acquireForkCopy(entry, definition, target) {
        const stored = await this.#host.storage.document(target.source.id, target.source.at, this.#context);
        this.#assertOpen();
        if (stored === undefined) {
            throw new Error(`Fork source document ${target.source.id} cannot be read`);
        }
        if (stored.record.scope.kind !== "conversation" ||
            stored.record.kind !== target.record.kind ||
            stored.record.key !== target.record.key ||
            stored.record.history !== target.record.history ||
            stored.record.fork !== target.record.fork) {
            throw new Error(`Fork source document ${target.source.id} does not match the copied record`);
        }
        const value = materializeDocumentValue(definition, target.record, stored.version, stored.value);
        const tracker = track(value);
        entry.definition = definition;
        entry.target = { kind: "created", record: target.record, version: definition.version, tracker };
        entry.change = tracker.beginChange();
        return entry.change.state;
    }
    async #findRetirement(entry) {
        const gate = this.#host.touch(documentKey(entry.addressId));
        if (gate !== undefined)
            await gate;
        const record = this.#host.cached(entry.addressId)?.record ??
            (await this.#host.storage.findDocument(entry.address, "current", this.#context));
        this.#assertOpen();
        if (record === undefined)
            return;
        checkRecordScope(entry.definition, record);
        entry.target = { kind: "retire-only", record };
    }
    // ─── Settlement ─────────────────────────────────────────────────────────
    /** Seal after callback failure: abort every change and observe every pending operation. */
    async settleFailure() {
        this.#sealed = true;
        this.#abortChanges();
        await Promise.allSettled(this.#pendingOperations);
        this.#context = BACKGROUND_CONTEXT;
    }
    /**
     * Seal after callback success, prepare every open change, and assemble the atomic batch.
     * Any failure aborts every change before Storage admission.
     */
    async settleSuccess() {
        this.#sealed = true;
        if (this.#pendingOperations.size > 0) {
            this.#abortChanges();
            await Promise.allSettled(this.#pendingOperations);
            this.#context = BACKGROUND_CONTEXT;
            throw new Error("Session commit callback settled before its pending Tx operations");
        }
        try {
            // Synchronously prepare every open change; this revokes every draft.
            for (const document of this.#documents) {
                if (document.change !== undefined)
                    document.prepared = document.change.prepare();
            }
            return await this.#assemble();
        }
        catch (error) {
            this.#abortChanges();
            throw error;
        }
        finally {
            this.#context = BACKGROUND_CONTEXT;
        }
    }
    /** Abort every prepared change after Storage failure or when no write is required. */
    discard() {
        this.#abortChanges();
    }
    /**
     * Internal: what a deferred commit holds in memory instead of storing (`CommitPersistence`), each changed incarnation
     * with its operations and whether they selected a base; `undefined` when the commit must be stored. It may be held
     * only when every write changes an existing `latest`, `initial`-fork conversation document at its stored version.
     */
    holdable() {
        if (this.#writes.some((write) => write.type !== "document.change"))
            return undefined;
        const held = [];
        for (const plan of this.#plans) {
            const { content, change } = plan;
            if (content === undefined && !plan.retire)
                continue;
            if (plan.retire || change?.loaded === undefined || content?.type !== "document.change")
                return undefined;
            const { loaded, prepared, version } = change;
            const record = loaded.record;
            if (record.scope.kind !== "conversation" || record.history !== "latest" || record.fork !== "initial") {
                return undefined;
            }
            // A migration stores a base at once.
            if (loaded.storedVersion !== version)
                return undefined;
            held.push({ loaded, ops: prepared.ops, base: content.content.kind === "base" });
        }
        return held;
    }
    /**
     * Internal: adopt a held commit (`holdable()`) in memory only. Trackers advance by pointer swap; stored versions and
     * delta counts stay, as nothing was stored. Returns its publication for the Session's own observers.
     */
    adoptHeld() {
        const publications = [];
        for (const plan of this.#plans) {
            // Every plan of a held commit changes or reads a loaded incarnation (`holdable()`).
            const { tracker, prepared, version, loaded } = plan.change;
            if (prepared.ops.length === 0) {
                prepared.abort();
                continue;
            }
            tracker.adopt(prepared);
            const record = loaded.record;
            const conversationId = plan.conversationId;
            publications.push({
                type: "document",
                kind: "change",
                record,
                conversationId,
                version,
                value: prepared.value,
                ops: prepared.ops,
            });
        }
        return publications;
    }
    /**
     * Internal: store the held changes of every incarnation this commit reads or writes in front of its own, so a stored
     * document never misses an operation its later ones build on. Called right before Storage admission, after every
     * fallible step, because it empties the holds: a failure earlier keeps them. Returns the holds it took.
     */
    takeHeld(held) {
        const taken = [];
        for (const plan of this.#plans) {
            // A new incarnation holds nothing yet.
            if (plan.kind === "new")
                continue;
            const hold = held(plan.record.id);
            if (hold === undefined)
                continue;
            taken.push(hold);
            const own = plan.content?.type === "document.change" ? plan.content : undefined;
            const change = plan.change;
            const value = change?.prepared.value ?? hold.loaded.tracker.value;
            const stored = storeHeld(hold, change?.prepared.ops ?? EMPTY_OPERATIONS, value, hold.loaded.valueVersion);
            // A base this commit selected or must write covers what was held.
            const content = own?.content.kind === "base" ? own.content : stored.content;
            const write = { type: "document.change", id: plan.record.id, content };
            if (own !== undefined)
                this.#writes[this.#writes.indexOf(own)] = write;
            else
                this.#insertBeforeRetirement(write);
            if (!plan.retire)
                plan.held = { ops: stored.ops, observed: own !== undefined };
            plan.content = write;
            // Held documents are conversation documents; one this commit only read has no owner resolved yet.
            if (plan.record.scope.kind === "conversation")
                plan.conversationId = plan.record.scope.conversationId;
        }
        return taken;
    }
    /**
     * Internal: the keys this commit writes, once settled (and after `takeHeld()`), for the Session's unpublished write
     * set: its table records, and the address and incarnation of every document it creates, changes, or retires, with
     * the scope of every incarnation it creates or retires.
     */
    writeKeys() {
        const keys = [];
        tableKeys(this.#writes, keys);
        for (const plan of this.#plans) {
            if (plan.content === undefined && !plan.retire)
                continue;
            keys.push(documentKey(plan.addressId), incarnationKey(plan.record.id));
            if (plan.retire || plan.kind === "new")
                keys.push(scopeKey(plan.record.scope));
        }
        return keys;
    }
    /** Stage a content write for an incarnation, before its retirement when it retires. */
    #insertBeforeRetirement(write) {
        const at = this.#writes.findIndex((candidate) => candidate.type === "document.retire" && candidate.id === write.id);
        if (at < 0)
            this.#writes.push(write);
        else
            this.#writes.splice(at, 0, write);
    }
    /** Adopt every prepared change by pointer swap after Storage success and describe the publication. */
    adopt(seq) {
        const publications = [];
        // Only when the commit stored held changes: then what Storage got differs from what memory adopted.
        let stored;
        for (const plan of this.#plans) {
            const committed = plan.kind === "committed";
            let record = plan.kind === "committed" ? plan.record : { ...plan.record, createdAt: seq };
            if (plan.retire)
                record = { ...record, retiredAt: seq };
            const change = plan.change;
            if (change !== undefined) {
                const { tracker, prepared, loaded, version } = change;
                // A new incarnation is adopted unless it retires in the same commit; a loaded one only when it changed.
                if (loaded === undefined ? !plan.retire : prepared.ops.length > 0)
                    tracker.adopt(prepared);
                else
                    prepared.abort();
                if (loaded !== undefined) {
                    if (loaded.storedVersion < version)
                        loaded.storedVersion = version;
                    if (plan.content?.type === "document.change") {
                        if (plan.content.content.kind === "base")
                            loaded.deltasSinceBase = 0;
                        else
                            loaded.deltasSinceBase++;
                    }
                }
                else if (!plan.retire) {
                    this.#host.install({
                        addressId: plan.addressId,
                        record,
                        storedVersion: version,
                        valueVersion: version,
                        deltasSinceBase: 0,
                        tracker,
                    });
                }
            }
            if (plan.retire && committed)
                this.#host.evict(plan.addressId, record.id);
            const publication = describe(plan, record);
            if (publication === undefined)
                continue;
            const held = plan.held;
            if (held === undefined) {
                publications.push(publication);
                stored?.push(publication);
                continue;
            }
            stored ??= [...publications];
            if (held.observed)
                publications.push(publication);
            // Only a document change of a loaded incarnation carries held operations; a retirement is published alone.
            stored.push(publication.type === "document" && publication.kind === "change"
                ? { ...publication, ops: held.ops }
                : publication);
        }
        return { observed: publications, stored: stored ?? publications };
    }
    async #assemble() {
        const storage = this.#host.storage;
        const plans = this.#plans;
        for (const document of this.#documents) {
            const plan = planDocument(document);
            if (plan !== undefined)
                plans.push(plan);
        }
        this.#rejectForkSourceWrites(plans);
        await this.#validateOwners();
        for (const [id, task] of this.#tasksById) {
            if (task.write?.kind !== "replace")
                continue;
            const committed = await this.#committedTask(id);
            if (committed === undefined)
                throw new Error(`Task ${id} does not exist`);
            if (committed.state.status === "terminal")
                throw new Error(`Task ${id} is already terminal`);
            if (committed.conversationId !== task.write.record.conversationId) {
                throw new Error(`Task ${id} cannot change conversations`);
            }
        }
        // Terminal settlement retires every task document, including ones created by this transaction.
        const terminalTaskIds = new Set();
        for (const task of this.#tasksById.values()) {
            if (task.write?.record.state.status === "terminal")
                terminalTaskIds.add(task.write.record.id);
        }
        if (terminalTaskIds.size > 0) {
            const retiring = new Set();
            for (const plan of plans) {
                const scope = plan.record.scope;
                if (scope.kind !== "task" || !terminalTaskIds.has(scope.taskId))
                    continue;
                plan.retire = true;
                retiring.add(plan.record.id);
            }
            const retire = (record) => {
                if (retiring.has(record.id))
                    return;
                plans.push({ kind: "committed", addressId: addressId(record), record, retire: true });
                retiring.add(record.id);
            };
            for (const taskId of terminalTaskIds) {
                if (this.#tasksById.get(taskId)?.write?.kind === "create")
                    continue;
                // The Session knows the documents of the tasks it created; any other task's are scanned.
                const gate = this.#host.touch(scopeKey({ kind: "task", taskId }));
                if (gate !== undefined)
                    await gate;
                const known = this.#host.taskDocuments(taskId);
                if (known !== undefined) {
                    for (const record of known)
                        retire(record);
                    continue;
                }
                let cursor;
                do {
                    const page = await storage.scanDocuments({ scope: { kind: "task", taskId }, at: "current" }, INTERNAL_SCAN_PAGE_SIZE, cursor, this.#context);
                    for (const record of page.items)
                        retire(record);
                    cursor = page.next;
                } while (cursor !== undefined);
            }
        }
        // Resolve publication ownership before Storage admission so adoption remains synchronous.
        for (const plan of plans) {
            if (!publishes(plan))
                continue;
            const scope = plan.record.scope;
            if (scope.kind === "conversation")
                plan.conversationId = scope.conversationId;
            if (scope.kind !== "task")
                continue;
            const task = this.#taskEntry(scope.taskId);
            if (task.publicationConversationId === undefined) {
                const current = await this.#currentTask(scope.taskId);
                if (current !== undefined)
                    task.publicationConversationId = current.conversationId;
            }
            plan.conversationId = task.publicationConversationId;
        }
        // Created settled, or settled by a change: each one with `notify` signals its task (spec suspendable §4.5).
        const settling = [...this.#submissions.values()].filter(isSettled);
        for (const { id, change } of this.#submissionChanges) {
            const current = this.#submissions.get(id) ?? (await storage.submission(id, this.#context));
            if (current === undefined)
                throw new Error(`Submission ${id} does not exist`);
            const next = applySubmissionChange(current, change);
            if (next === current)
                continue;
            this.#submissions.set(id, next);
            if (isSettled(next))
                settling.push(next);
        }
        for (const record of settling)
            if (record.notify !== undefined)
                await this.#notify(record, record.notify);
        const writes = this.#writes;
        for (const value of this.#submissions.values())
            writes.push({ type: "submission", value });
        for (const task of this.#tasksById.values()) {
            if (task.write !== undefined)
                writes.push({ type: "task", value: task.write.record });
        }
        for (const plan of plans) {
            const change = plan.change;
            // Checkpoint predicates run last, after every validation.
            if (plan.content?.type === "document.change" && plan.content.content.kind === "delta" && change?.loaded) {
                const { prepared, version } = change;
                const info = { deltasSinceBase: change.loaded.deltasSinceBase };
                if (change.definition.checkpointWhen(prepared.value, prepared.ops, info)) {
                    plan.content = { ...plan.content, content: { version, kind: "base", value: prepared.value } };
                }
            }
            if (plan.content !== undefined)
                writes.push(plan.content);
            if (plan.retire)
                writes.push({ type: "document.retire", id: plan.record.id });
        }
        return writes;
    }
    // ─── Helpers ────────────────────────────────────────────────────────────
    /**
     * Deliver `SubmissionSettled` for a submission this commit settles, against the transaction's latest candidate of the
     * task; a delivery the task refuses changes nothing and fails nothing.
     */
    async #notify(record, notify) {
        const committed = await this.#committedTask(notify.taskId);
        const target = this.#tasksById.get(notify.taskId)?.write?.record ?? committed;
        const delivered = deliverSignal(target, SubmissionSettled, notify.key, record, this.#host.now());
        if (delivered.record !== undefined)
            this.#stageTask(delivered.record);
    }
    /**
     * New owned work needs a live owner, judged on the owner's final candidate: not `completing`, terminal, or
     * abort-marked. A task therefore cannot create owned work in the commit that finishes it (spec §5.5).
     */
    async #validateOwners() {
        const owners = [];
        for (const write of this.#writes) {
            if (write.type !== "conversation" || write.value.owner === undefined)
                continue;
            owners.push({ what: "Conversation owner task", taskId: write.value.owner.taskId });
        }
        for (const task of this.#tasksById.values()) {
            const record = task.write?.kind === "create" ? task.write.record : undefined;
            if (record?.owner !== undefined)
                owners.push({ what: "Task owner", taskId: record.owner });
        }
        for (const { what, taskId } of owners) {
            const task = await this.#currentTask(taskId);
            if (task === undefined)
                throw new Error(`${what} ${taskId} does not exist`);
            if (task.state.status === "terminal" || task.state.status === "completing") {
                throw new Error(`${what} ${taskId} is ${task.state.status}`);
            }
            if (task.abortRequested)
                throw new Error(`${what} ${taskId} is abort-marked`);
        }
    }
    #rejectForkSourceWrites(plans) {
        for (const plan of plans) {
            if (plan.content === undefined && !plan.retire)
                continue;
            const record = plan.record;
            if (this.#forkSourceDocumentIds.has(record.id)) {
                throw new Error(`Cannot change fork source document ${record.id} in the fork transaction`);
            }
            const scope = plan.record.scope;
            if (scope.kind === "conversation" &&
                this.#forkSourceConversationIds.has(scope.conversationId) &&
                record.scope.kind === "conversation" &&
                record.fork === "current") {
                throw new Error(`Cannot fork conversation ${scope.conversationId} while changing its current-policy documents`);
            }
        }
    }
    #abortChanges() {
        for (const document of this.#documents)
            document.change?.abort();
    }
    #assertOpen() {
        if (this.#sealed)
            throw new Error("Transaction has settled");
    }
    #assertTaskDocumentsOpen(resolved) {
        const scope = resolved.address.scope;
        if (scope.kind === "task" && this.#tasksById.get(scope.taskId)?.write?.record.state.status === "terminal") {
            throw new Error(`Task ${scope.taskId} is terminal`);
        }
    }
    /** Register an operation so callback settlement can reject and drain it. */
    #track(operation) {
        this.#pendingOperations.add(operation);
        const settle = () => {
            this.#pendingOperations.delete(operation);
        };
        operation.then(settle, settle);
        return operation;
    }
    #read(method, read) {
        try {
            this.#assertOpen();
            if (this.#hasTableWrite)
                throw new ReadAfterWrite(`Tx.${method}()`);
            return this.#track(read());
        }
        catch (error) {
            return Promise.reject(error);
        }
    }
    #write(write) {
        try {
            this.#assertOpen();
            this.#hasTableWrite = true;
            return this.#track(write());
        }
        catch (error) {
            return Promise.reject(error);
        }
    }
    async #requireConversation(id) {
        if (this.#createdConversationIds.has(id))
            return;
        if ((await this.#host.storage.conversation(id, this.#context)) === undefined) {
            throw new Error(`Conversation ${id} does not exist`);
        }
    }
    /**
     * Lifecycle times: `startedAt` on the first change to `running`, `endedAt` on the change to `terminal`. Once set,
     * they carry over from the replaced record; records written before they existed lack them.
     */
    #stampTimes(value, candidate) {
        const status = value.state.status;
        const now = (stamps) => (stamps ? this.#host.now() : undefined);
        const startedAt = candidate?.startedAt ?? value.startedAt ?? now(status === "running");
        const endedAt = candidate?.endedAt ?? value.endedAt ?? now(status === "terminal");
        if (startedAt === value.startedAt && endedAt === value.endedAt)
            return value;
        return {
            ...value,
            ...(startedAt === undefined ? {} : { startedAt }),
            ...(endedAt === undefined ? {} : { endedAt }),
        };
    }
    #taskEntry(id) {
        let task = this.#tasksById.get(id);
        if (task === undefined) {
            task = {};
            this.#tasksById.set(id, task);
        }
        return task;
    }
    /** Latest candidate task record, falling back to committed state; not a caller table read. */
    async #currentTask(id) {
        return this.#tasksById.get(id)?.write?.record ?? (await this.#committedTask(id));
    }
    #committedTask(id) {
        const task = this.#taskEntry(id);
        task.committedRead ??= this.#host.storage.task(id, this.#context);
        return task.committedRead;
    }
}
/** Plan of one staged document: its record, content write, and prepared change. Retirement is decided later. */
function planDocument(document) {
    const target = document.target;
    if (target === undefined)
        return undefined;
    const plan = { addressId: document.addressId, retire: document.retireOnCommit };
    switch (target.kind) {
        case "created": {
            const prepared = document.prepared;
            const { record, version, tracker } = target;
            const content = { version, kind: "base", value: prepared.value };
            return {
                ...plan,
                kind: "new",
                record,
                content: { type: "document.create", record, content },
                change: { tracker, prepared, version },
            };
        }
        case "fork-copy":
            return {
                ...plan,
                kind: "new",
                record: target.record,
                content: { type: "document.copy", record: target.record, source: target.source },
            };
        case "retire-only":
            return { ...plan, kind: "committed", record: target.record };
        case "loaded": {
            const loaded = target.document;
            const definition = document.definition;
            const prepared = document.prepared;
            const version = definition.version;
            const id = loaded.record.id;
            // A version change stores a base even without operations; otherwise only a change stores a delta.
            const content = loaded.storedVersion < version
                ? { type: "document.change", id, content: { version, kind: "base", value: prepared.value } }
                : prepared.ops.length > 0
                    ? { type: "document.change", id, content: { version, kind: "delta", ops: prepared.ops } }
                    : undefined;
            const change = {
                tracker: loaded.tracker,
                prepared,
                version,
                loaded,
                definition,
            };
            return {
                ...plan,
                kind: "committed",
                record: loaded.record,
                change,
                ...(content === undefined ? {} : { content }),
            };
        }
    }
}
/** The publication of one adopted plan, if it publishes (`publishes()`), with `record` as committed. */
function describe(plan, record) {
    const conversationId = plan.conversationId;
    if (plan.retire)
        return { type: "document", kind: "retire", record, conversationId };
    if (plan.content?.type === "document.copy") {
        return { type: "document.copy", record, conversationId: conversationId, source: plan.content.source };
    }
    const change = plan.change;
    if (change === undefined || !publishes(plan))
        return undefined;
    const ops = change.loaded === undefined ? EMPTY_OPERATIONS : change.prepared.ops;
    return {
        type: "document",
        kind: "change",
        record,
        conversationId,
        version: change.version,
        value: change.prepared.value,
        ops,
    };
}
/**
 * Take a hold's changes after `ops`, a commit's own on top of them, as one stored content for an incarnation now at
 * `value`, and the operations a reader of the stored state applies to reach it: the folded ones, or a root replacement
 * after the queue overflowed, which stores a base, as does a hold whose commits selected one.
 */
export function storeHeld(hold, ops, value, version) {
    hold.pending.push(ops);
    const taken = hold.pending.take();
    if (taken.kind === "replace")
        return { content: { version, kind: "base", value }, ops: [["r", value]] };
    if (hold.base)
        return { content: { version, kind: "base", value }, ops: taken.ops };
    return { content: { version, kind: "delta", ops: taken.ops }, ops: taken.ops };
}
/**
 * Whether adoption publishes the plan: every creation, copy, and retirement, and a loaded incarnation that writes
 * content, which includes a migration-only base so observers of the older shape receive the new value.
 */
function publishes(plan) {
    return plan.retire || plan.change?.loaded === undefined || plan.content !== undefined;
}
//# sourceMappingURL=transaction.js.map