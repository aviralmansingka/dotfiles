import { StorageRequestError } from "../../errors.js";
import { idFromNumber, seqFromNumber } from "../../ids.js";
import { MemoryStorage } from "../memory.js";
const FORMAT_VERSION = 1;
const MAIN_FILE = "main.jsonl";
const RECLAIM_SUFFIX = ".reclaim";
/** Read-only opens retried after racing a writer's commits; each retry means another commit landed meanwhile. */
const READ_ONLY_OPEN_ATTEMPTS = 5;
const textDecoder = new TextDecoder("utf-8", { fatal: true });
export class JsonlCorruptionError extends Error {
    constructor(message, cause) {
        super(message, cause === undefined ? undefined : { cause });
        this.name = "JsonlCorruptionError";
    }
}
/** `commit()` on a storage opened with `readOnly: true`. Nothing was written. */
export class JsonlStorageReadOnlyError extends Error {
    constructor() {
        super("JSONL storage is open read-only");
        this.name = "JsonlStorageReadOnlyError";
    }
}
export class JsonlStoragePoisonedError extends Error {
    constructor(cause) {
        super("JSONL storage is poisoned and must be reopened", { cause });
        this.name = "JsonlStoragePoisonedError";
    }
}
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isSafeInteger = (value) => Number.isSafeInteger(value);
const sidecarFileName = (kind, id) => `${kind}-${id}.jsonl`;
const isSidecarFileName = (name) => /^(?:doc|task)-(?:0|[1-9]\d*)\.jsonl$/.test(name);
const isReclaimFileName = (name) => /^(?:doc|task)-(?:0|[1-9]\d*)\.jsonl\.reclaim$/.test(name);
const isCurrentOnly = (record) => record.scope.kind !== "conversation" || record.history === "latest";
const sidecarKey = (file, seq, ordinal) => JSON.stringify([file, seq, ordinal]);
const jsonLine = (value) => `${JSON.stringify(value)}\n`;
const errorFromFile = (action, error) => new Error(`JSONL ${action} failed: ${error.message}`, { cause: error });
const parseJson = (text, description) => {
    try {
        return JSON.parse(text);
    }
    catch (error) {
        throw new JsonlCorruptionError(`Malformed complete ${description}`, error instanceof Error ? error : undefined);
    }
};
const validateMainOperation = (value, description) => {
    if (!isObject(value) || typeof value.type !== "string") {
        throw new JsonlCorruptionError(`Invalid write in ${description}`);
    }
    switch (value.type) {
        case "conversation":
        case "entry":
        case "submission":
            if (!isObject(value.value) || !isSafeInteger(value.value.id)) {
                throw new JsonlCorruptionError(`Invalid ${value.type} write in ${description}`);
            }
            return value;
        case "task":
            if (!isObject(value.value) ||
                !isSafeInteger(value.value.id) ||
                !isObject(value.value.state) ||
                value.value.state.status !== "terminal") {
                throw new JsonlCorruptionError(`Invalid terminal task write in ${description}`);
            }
            return value;
        case "document.retire":
            if (!isSafeInteger(value.id))
                throw new JsonlCorruptionError(`Invalid document retirement in ${description}`);
            return value;
        case "task.sidecar":
            if (!isSafeInteger(value.id) || !isSafeInteger(value.ordinal) || value.ordinal < 0) {
                throw new JsonlCorruptionError(`Invalid task sidecar write in ${description}`);
            }
            return value;
        case "document.create":
            if (!isObject(value.record) ||
                !isSafeInteger(value.record.id) ||
                !isSafeInteger(value.ordinal) ||
                value.ordinal < 0) {
                throw new JsonlCorruptionError(`Invalid document creation in ${description}`);
            }
            return value;
        case "document.change":
            if (!isSafeInteger(value.id) || !isSafeInteger(value.ordinal) || value.ordinal < 0) {
                throw new JsonlCorruptionError(`Invalid document change in ${description}`);
            }
            return value;
        default:
            throw new JsonlCorruptionError(`Unknown write type in ${description}`);
    }
};
const parseMainMarker = (text, line) => {
    const description = `${MAIN_FILE} line ${line}`;
    const value = parseJson(text, description);
    if (!isObject(value) ||
        value.format !== FORMAT_VERSION ||
        value.type !== "commit" ||
        !isSafeInteger(value.seq) ||
        value.seq < 1 ||
        !Array.isArray(value.writes)) {
        throw new JsonlCorruptionError(`Invalid commit marker in ${description}`);
    }
    return {
        format: FORMAT_VERSION,
        type: "commit",
        seq: seqFromNumber(value.seq),
        writes: value.writes.map((write) => validateMainOperation(write, description)),
    };
};
const validateDocumentContent = (value, description) => {
    if (!isObject(value) || !isSafeInteger(value.version) || value.version < 1) {
        throw new JsonlCorruptionError(`Invalid document content in ${description}`);
    }
    if (value.kind === "base" && isObject(value.value))
        return value;
    if (value.kind === "delta" && Array.isArray(value.ops))
        return value;
    throw new JsonlCorruptionError(`Invalid document content in ${description}`);
};
const parseSidecarRecord = (text, file, line) => {
    const description = `${file} line ${line}`;
    const value = parseJson(text, description);
    if (!isObject(value) ||
        value.format !== FORMAT_VERSION ||
        value.type !== "record" ||
        !isSafeInteger(value.seq) ||
        value.seq < 1 ||
        !isSafeInteger(value.ordinal) ||
        value.ordinal < 0 ||
        !isObject(value.payload) ||
        typeof value.payload.type !== "string") {
        throw new JsonlCorruptionError(`Invalid sidecar record in ${description}`);
    }
    if (value.payload.type === "task") {
        if (!isObject(value.payload.value) ||
            !isSafeInteger(value.payload.value.id) ||
            !isObject(value.payload.value.state) ||
            value.payload.value.state.status === "terminal") {
            throw new JsonlCorruptionError(`Invalid live task record in ${description}`);
        }
    }
    else if (value.payload.type === "document") {
        if (!isSafeInteger(value.payload.id)) {
            throw new JsonlCorruptionError(`Invalid document record in ${description}`);
        }
        validateDocumentContent(value.payload.content, description);
    }
    else {
        throw new JsonlCorruptionError(`Unknown sidecar record type in ${description}`);
    }
    return value;
};
/** Portable JSONL implementation of the storage contract. */
export class JsonlStorage {
    fs;
    directory;
    mainPath;
    fsync;
    readOnly;
    memory = new MemoryStorage();
    currentOnlyDocuments = new Set();
    liveTaskSidecars = new Set();
    closed = false;
    /** Bytes of `main.jsonl` recovery read (`mainChanged()`). */
    mainSize = 0;
    poisonError;
    /** Settles once the batch being appended is; its batches are in memory already (`commit()`). */
    writing;
    constructor(fs, directory, mainPath, options) {
        this.fs = fs;
        this.directory = directory;
        this.mainPath = mainPath;
        this.fsync = options.fsync ?? false;
        this.readOnly = options.readOnly ?? false;
    }
    /**
     * Open or create a JSONL storage directory using the supplied filesystem. With `readOnly`, open an existing one
     * without writing; a recovery that fails while `main.jsonl` changes raced a writer's commit and is retried.
     */
    static async open(directory, fs, context, options = {}) {
        const absolute = await fs.absolutePath(directory, context);
        if (!absolute.ok)
            throw errorFromFile("path resolution", absolute.error);
        if (options.readOnly !== true) {
            const created = await fs.createDir(absolute.value, { recursive: true }, context);
            if (!created.ok)
                throw errorFromFile("directory creation", created.error);
        }
        const mainPathResult = await fs.joinPath([absolute.value, MAIN_FILE], context);
        if (!mainPathResult.ok)
            throw errorFromFile("path join", mainPathResult.error);
        for (let attempt = 1;; attempt++) {
            const storage = new JsonlStorage(fs, absolute.value, mainPathResult.value, options);
            try {
                await storage.recover(context);
                return storage;
            }
            catch (error) {
                if (!storage.readOnly ||
                    attempt === READ_ONLY_OPEN_ATTEMPTS ||
                    !(error instanceof JsonlCorruptionError) ||
                    !(await storage.mainChanged(context))) {
                    throw error;
                }
            }
        }
    }
    /**
     * Commit `batches` with one append per affected file: every batch's sidecar records first, then their markers in one
     * write of `main.jsonl`. Each batch is checked against the state the earlier ones left, so memory applies each one
     * as it passes, and reads wait until the appends are done; the first batch refused ends the batch. A torn append of
     * the markers recovers a shorter complete prefix; any failure once a batch applied poisons the storage.
     */
    async commit(batches, receive, context) {
        this.assertUsable();
        if (this.readOnly)
            throw new JsonlStorageReadOnlyError();
        const seqs = [];
        const encoded = [];
        const reclamations = new Map();
        let refused;
        const writing = Promise.withResolvers();
        this.writing = writing.promise;
        try {
            for (const writes of batches) {
                let prepared;
                try {
                    prepared = this.memory.prepareCommit(writes);
                }
                catch (error) {
                    refused = { error };
                    break;
                }
                const commit = this.encodeCommit(prepared.seq, prepared.writes);
                // A sidecar an earlier batch replaces keeps what the later ones append, unless they replace it again.
                for (const [file, content] of commit.sidecars) {
                    const replacement = reclamations.get(file);
                    if (replacement !== undefined)
                        reclamations.set(file, replacement + content);
                }
                for (const [file, content] of this.planReclamations(prepared.writes, commit))
                    reclamations.set(file, content);
                seqs.push(prepared.apply());
                this.adoptSidecarState(prepared.writes);
                encoded.push(commit);
            }
            if (encoded.length > 0)
                await this.append(encoded, context);
        }
        catch (error) {
            // Memory runs ahead of the file: once a batch applied, any failure poisons the storage before the reads
            // waiting on the append go on, so none of them returns what is not stored.
            if (seqs.length === 0)
                throw error;
            throw this.poison(error instanceof Error ? error : new Error("JSONL commit failed", { cause: error }));
        }
        finally {
            this.writing = undefined;
            writing.resolve();
        }
        // The markers are appended: the batches are durable. Reclaiming sidecars comes after the receipts.
        for (const [index, seq] of seqs.entries())
            receive(index, seq);
        await this.reclaimSidecars(reclamations, context);
        return refused === undefined
            ? { kind: "stored", stored: seqs.length }
            : { kind: "refused", stored: seqs.length, refused: refused.error };
    }
    /** Append the sidecar records of `commits`, flushed with `fsync`, then their markers in one write of `main.jsonl`. */
    async append(commits, context) {
        const contents = new Map();
        for (const commit of commits) {
            for (const [file, content] of commit.sidecars)
                contents.set(file, (contents.get(file) ?? "") + content);
        }
        const sidecars = await Promise.all([...contents].map(async ([file, content]) => ({
            file,
            content,
            path: await this.resolveFile(file, context),
        })));
        for (const sidecar of sidecars) {
            const result = await this.fs.appendFile(sidecar.path, sidecar.content, context);
            if (!result.ok)
                throw this.poison(errorFromFile(`append to ${sidecar.file}`, result.error));
        }
        if (this.fsync) {
            for (const sidecar of sidecars) {
                const result = await this.fs.flushFile(sidecar.path, context);
                if (!result.ok)
                    throw this.poison(errorFromFile(`flush of ${sidecar.file}`, result.error));
            }
        }
        const markers = commits.length === 1 ? commits[0].marker : commits.map((commit) => commit.marker).join("");
        const marker = await this.fs.appendFile(this.mainPath, markers, context);
        if (!marker.ok)
            throw this.poison(errorFromFile(`append to ${MAIN_FILE}`, marker.error));
    }
    async mintId() {
        return this.store.mintId();
    }
    async conversation(id, context) {
        return (await this.readable()).conversation(id, context);
    }
    async scanConversations(query, limit, cursor, context) {
        return (await this.readable()).scanConversations(query, limit, cursor, context);
    }
    async entry(idOrConversationId, idOrContext, context) {
        if (context === undefined)
            return (await this.readable()).entry(idFromNumber(idOrConversationId), idOrContext);
        if (typeof idOrContext !== "number")
            throw new StorageRequestError("Storage.entry() requires an entry ID");
        return (await this.readable()).entry(idFromNumber(idOrConversationId), idFromNumber(idOrContext), context);
    }
    async findLatestHeadMarker(conversationId, atOrBeforeEntryId, context) {
        return (await this.readable()).findLatestHeadMarker(conversationId, atOrBeforeEntryId, context);
    }
    async scanEntries(query, limit, cursor, context) {
        return (await this.readable()).scanEntries(query, limit, cursor, context);
    }
    async task(id, context) {
        return (await this.readable()).task(id, context);
    }
    async scanTasks(query, limit, cursor, context) {
        return (await this.readable()).scanTasks(query, limit, cursor, context);
    }
    async submission(id, context) {
        return (await this.readable()).submission(id, context);
    }
    async scanSubmissions(query, limit, cursor, context) {
        return (await this.readable()).scanSubmissions(query, limit, cursor, context);
    }
    async submissionByRequest(conversationId, requestId, context) {
        return (await this.readable()).submissionByRequest(conversationId, requestId, context);
    }
    async findDocument(address, at, context) {
        return (await this.readable()).findDocument(address, at, context);
    }
    async document(id, at, context) {
        return (await this.readable()).document(id, at, context);
    }
    async scanDocuments(query, limit, cursor, context) {
        return (await this.readable()).scanDocuments(query, limit, cursor, context);
    }
    async close(context) {
        if (this.closed)
            return;
        this.closed = true;
        await this.memory.close(context);
    }
    encodeCommit(seq, writes) {
        const mainWrites = [];
        const records = new Map();
        let nextOrdinal = 0;
        const addSidecar = (file, payload) => {
            const ordinal = nextOrdinal++;
            let fileRecords = records.get(file);
            if (fileRecords === undefined) {
                fileRecords = [];
                records.set(file, fileRecords);
            }
            fileRecords.push({ format: FORMAT_VERSION, type: "record", seq, ordinal, payload });
            return ordinal;
        };
        for (const write of writes) {
            switch (write.type) {
                case "conversation":
                case "entry":
                case "submission":
                case "document.retire":
                    mainWrites.push(write);
                    break;
                case "task":
                    if (write.value.state.status === "terminal")
                        mainWrites.push(write);
                    else {
                        const ordinal = addSidecar(sidecarFileName("task", write.value.id), {
                            type: "task",
                            value: write.value,
                        });
                        mainWrites.push({ type: "task.sidecar", id: write.value.id, ordinal });
                    }
                    break;
                case "document.create": {
                    const ordinal = addSidecar(sidecarFileName("doc", write.record.id), {
                        type: "document",
                        id: write.record.id,
                        content: write.content,
                    });
                    mainWrites.push({ type: "document.create", record: write.record, ordinal });
                    break;
                }
                case "document.change": {
                    const ordinal = addSidecar(sidecarFileName("doc", write.id), {
                        type: "document",
                        id: write.id,
                        content: write.content,
                    });
                    mainWrites.push({ type: "document.change", id: write.id, ordinal });
                    break;
                }
            }
        }
        const sidecars = new Map();
        for (const [file, fileRecords] of records) {
            sidecars.set(file, fileRecords.map((record) => jsonLine(record)).join(""));
        }
        const marker = {
            format: FORMAT_VERSION,
            type: "commit",
            seq,
            writes: mainWrites,
        };
        return { marker: jsonLine(marker), sidecars };
    }
    planReclamations(writes, encoded) {
        const createdCurrentOnlyDocuments = new Set();
        const retiredDocuments = new Set();
        const baseDocuments = new Set();
        const finalTasks = new Map();
        for (const write of writes) {
            switch (write.type) {
                case "document.create":
                    if (isCurrentOnly(write.record))
                        createdCurrentOnlyDocuments.add(write.record.id);
                    break;
                case "document.change":
                    if (write.content.kind === "base")
                        baseDocuments.add(write.id);
                    break;
                case "document.retire":
                    retiredDocuments.add(write.id);
                    break;
                case "task":
                    finalTasks.set(write.value.id, write.value);
                    break;
            }
        }
        const replacements = new Map();
        const isCurrentOnlyDocument = (id) => this.currentOnlyDocuments.has(id) || createdCurrentOnlyDocuments.has(id);
        for (const id of retiredDocuments) {
            if (isCurrentOnlyDocument(id))
                replacements.set(sidecarFileName("doc", id), "");
        }
        for (const id of baseDocuments) {
            if (!isCurrentOnlyDocument(id) || retiredDocuments.has(id))
                continue;
            const file = sidecarFileName("doc", id);
            const content = encoded.sidecars.get(file);
            if (content !== undefined)
                replacements.set(file, content);
        }
        for (const [id, task] of finalTasks) {
            if (task.state.status === "terminal" &&
                (this.liveTaskSidecars.has(id) || encoded.sidecars.has(sidecarFileName("task", id)))) {
                replacements.set(sidecarFileName("task", id), "");
            }
        }
        return replacements;
    }
    adoptSidecarState(writes) {
        for (const write of writes) {
            if (write.type === "document.create") {
                if (isCurrentOnly(write.record))
                    this.currentOnlyDocuments.add(write.record.id);
            }
            else if (write.type === "task") {
                if (write.value.state.status === "terminal")
                    this.liveTaskSidecars.delete(write.value.id);
                else
                    this.liveTaskSidecars.add(write.value.id);
            }
        }
    }
    /** The marker already published this state, so reclamation is retryable best-effort maintenance. */
    async reclaimSidecars(replacements, context) {
        if (replacements.size === 0)
            return;
        if (this.fsync) {
            const flushed = await this.fs.flushFile(this.mainPath, context);
            if (!flushed.ok)
                return;
        }
        for (const [file, content] of replacements)
            await this.replaceSidecar(file, content, context);
    }
    async replaceSidecar(file, content, context) {
        const path = await this.fs.joinPath([this.directory, file], context);
        if (!path.ok)
            return;
        if (content === "") {
            await this.fs.remove(path.value, { force: true }, context);
            return;
        }
        const temporaryPath = await this.fs.joinPath([this.directory, `${file}${RECLAIM_SUFFIX}`], context);
        if (!temporaryPath.ok)
            return;
        const written = await this.fs.writeFile(temporaryPath.value, content, context);
        if (!written.ok)
            return;
        if (this.fsync) {
            const flushed = await this.fs.flushFile(temporaryPath.value, context);
            if (!flushed.ok)
                return;
        }
        await this.fs.renameFile(temporaryPath.value, path.value, context);
    }
    /**
     * Load the confirmed state. A writable open also repairs the files: it truncates torn lines and unconfirmed sidecar
     * tails, removes leftover reclaim files, and reclaims sidecar records later commits made unnecessary. A read-only
     * open skips the same records in memory only.
     */
    async recover(context) {
        const fs = this.fs;
        const directory = this.directory;
        const memory = this.memory;
        const main = await this.readLines(this.mainPath, MAIN_FILE, context, (text, line) => parseMainMarker(text, line));
        this.mainSize = main.size;
        let previousSeq = 0;
        for (const marker of main.lines) {
            if (marker.value.seq <= previousSeq) {
                throw new JsonlCorruptionError(`Commit sequence does not strictly increase in ${MAIN_FILE}`);
            }
            previousSeq = marker.value.seq;
        }
        const listed = await fs.listDir(directory, context);
        if (!listed.ok)
            throw errorFromFile("directory listing", listed.error);
        for (const info of listed.value) {
            if (!this.readOnly && info.kind === "file" && isReclaimFileName(info.name)) {
                await fs.remove(info.path, { force: true }, context);
            }
        }
        const sidecarFiles = listed.value
            .filter((info) => info.kind === "file" && isSidecarFileName(info.name))
            .map((info) => info.name)
            .sort();
        const parsedFiles = new Map();
        const recordByKey = new Map();
        for (const file of sidecarFiles) {
            const pathResult = await fs.joinPath([directory, file], context);
            if (!pathResult.ok)
                throw errorFromFile("path join", pathResult.error);
            const parsed = await this.readLines(pathResult.value, file, context, (text, line) => parseSidecarRecord(text, file, line));
            parsedFiles.set(file, parsed);
            let previous;
            for (const line of parsed.lines) {
                if (previous !== undefined &&
                    (line.value.seq < previous.seq ||
                        (line.value.seq === previous.seq && line.value.ordinal <= previous.ordinal))) {
                    throw new JsonlCorruptionError(`Sidecar records are out of order in ${file}`);
                }
                previous = line.value;
                recordByKey.set(sidecarKey(file, line.value.seq, line.value.ordinal), line);
            }
        }
        const currentOnlyDocuments = new Set();
        const retiredDocuments = new Set();
        const finalTaskIsLive = new Map();
        for (const { value: marker } of main.lines) {
            for (const operation of marker.writes) {
                if (operation.type === "document.create") {
                    if (isCurrentOnly(operation.record))
                        currentOnlyDocuments.add(operation.record.id);
                }
                else if (operation.type === "document.retire") {
                    retiredDocuments.add(operation.id);
                }
                else if (operation.type === "task") {
                    finalTaskIsLive.set(operation.value.id, false);
                }
                else if (operation.type === "task.sidecar") {
                    finalTaskIsLive.set(operation.id, true);
                }
            }
        }
        const retiredCurrentOnlyDocuments = new Set([...retiredDocuments].filter((id) => currentOnlyDocuments.has(id)));
        const latestBases = new Map();
        for (const { value: marker } of main.lines) {
            for (const operation of marker.writes) {
                if (operation.type !== "document.create" && operation.type !== "document.change")
                    continue;
                const id = operation.type === "document.create" ? operation.record.id : operation.id;
                if (!currentOnlyDocuments.has(id))
                    continue;
                const record = recordByKey.get(sidecarKey(sidecarFileName("doc", id), marker.seq, operation.ordinal))?.value;
                if (record?.payload.type !== "document" ||
                    record.payload.id !== id ||
                    record.payload.content.kind !== "base") {
                    continue;
                }
                const previous = latestBases.get(id);
                if (previous === undefined ||
                    record.seq > previous.seq ||
                    (record.seq === previous.seq && record.ordinal > previous.ordinal)) {
                    latestBases.set(id, record);
                }
            }
        }
        const isBeforeLatestBase = (id, seq, ordinal) => {
            const base = latestBases.get(id);
            return base !== undefined && (seq < base.seq || (seq === base.seq && ordinal < base.ordinal));
        };
        const terminalTasks = new Set([...finalTaskIsLive].filter(([, live]) => !live).map(([id]) => id));
        const confirmed = new Set();
        for (const line of main.lines) {
            const marker = line.value;
            const writes = [];
            for (const operation of marker.writes) {
                switch (operation.type) {
                    case "conversation":
                    case "entry":
                    case "submission":
                    case "task":
                    case "document.retire":
                        writes.push(operation);
                        break;
                    case "task.sidecar": {
                        const optional = terminalTasks.has(operation.id);
                        const record = JsonlStorage.confirmRecord(marker, operation.ordinal, sidecarFileName("task", operation.id), recordByKey, confirmed, optional);
                        if (record !== undefined) {
                            if (record.payload.type !== "task" || record.payload.value.id !== operation.id) {
                                throw new JsonlCorruptionError(`Confirmed task sidecar data does not match commit ${marker.seq}`);
                            }
                            if (!optional)
                                writes.push({ type: "task", value: record.payload.value });
                        }
                        break;
                    }
                    case "document.create":
                    case "document.change": {
                        const id = operation.type === "document.create" ? operation.record.id : operation.id;
                        const reclaimed = retiredCurrentOnlyDocuments.has(id) || isBeforeLatestBase(id, marker.seq, operation.ordinal);
                        const record = JsonlStorage.confirmRecord(marker, operation.ordinal, sidecarFileName("doc", id), recordByKey, confirmed, reclaimed);
                        let content;
                        if (record !== undefined) {
                            if (record.payload.type !== "document" || record.payload.id !== id) {
                                throw new JsonlCorruptionError(`Confirmed document sidecar data does not match commit ${marker.seq}`);
                            }
                            content = record.payload.content;
                        }
                        if (operation.type === "document.create") {
                            if (content !== undefined && content.kind !== "base") {
                                throw new JsonlCorruptionError(`Document creation lacks a confirmed base in commit ${marker.seq}`);
                            }
                            writes.push({
                                type: "document.create",
                                record: operation.record,
                                content: reclaimed || content === undefined ? { kind: "base", version: 1, value: {} } : content,
                            });
                        }
                        else if (!reclaimed && content !== undefined) {
                            writes.push({ type: "document.change", id, content });
                        }
                        break;
                    }
                }
            }
            try {
                memory.prepareCommit(writes, marker.seq).apply();
            }
            catch (error) {
                throw new JsonlCorruptionError(`Invalid committed state at sequence ${marker.seq}`, error instanceof Error ? error : undefined);
            }
        }
        const reclamations = new Map();
        for (const [file, parsed] of parsedFiles) {
            let unconfirmedAt;
            for (const line of parsed.lines) {
                const key = sidecarKey(file, line.value.seq, line.value.ordinal);
                if (confirmed.has(key)) {
                    if (unconfirmedAt !== undefined) {
                        throw new JsonlCorruptionError(`Confirmed record follows an unconfirmed tail in ${file}`);
                    }
                }
                else if (unconfirmedAt === undefined) {
                    unconfirmedAt = line.start;
                }
            }
            if (unconfirmedAt !== undefined && !this.readOnly) {
                const truncated = await fs.truncateFile(parsed.path, unconfirmedAt, context);
                if (!truncated.ok)
                    throw errorFromFile(`tail truncation of ${file}`, truncated.error);
            }
            const numericId = Number(file.slice(file.indexOf("-") + 1, -".jsonl".length));
            const confirmedLines = parsed.lines.filter((line) => confirmed.has(sidecarKey(file, line.value.seq, line.value.ordinal)));
            let retainedLines;
            if (file.startsWith("task-") && terminalTasks.has(idFromNumber(numericId))) {
                retainedLines = [];
            }
            else if (file.startsWith("doc-")) {
                const documentId = idFromNumber(numericId);
                if (retiredCurrentOnlyDocuments.has(documentId)) {
                    retainedLines = [];
                }
                else if (latestBases.has(documentId)) {
                    retainedLines = confirmedLines.filter((line) => !isBeforeLatestBase(documentId, line.value.seq, line.value.ordinal));
                }
            }
            if (retainedLines !== undefined &&
                (retainedLines.length < confirmedLines.length || retainedLines.length === 0)) {
                reclamations.set(file, retainedLines.map((line) => jsonLine(line.value)).join(""));
            }
        }
        if (!this.readOnly)
            await this.reclaimSidecars(reclamations, context);
        for (const id of currentOnlyDocuments)
            this.currentOnlyDocuments.add(id);
        for (const [id, live] of finalTaskIsLive) {
            if (live)
                this.liveTaskSidecars.add(id);
        }
    }
    static confirmRecord(marker, ordinal, file, recordByKey, confirmed, optional) {
        const key = sidecarKey(file, marker.seq, ordinal);
        if (confirmed.has(key))
            throw new JsonlCorruptionError(`Sidecar record is confirmed more than once`);
        const line = recordByKey.get(key);
        if (line === undefined) {
            if (optional)
                return undefined;
            throw new JsonlCorruptionError(`Missing confirmed sidecar record ${file} at sequence ${marker.seq}`);
        }
        confirmed.add(key);
        return line.value;
    }
    /** Parse the complete lines of `path`; a torn final line is truncated, or only skipped when read-only. */
    async readLines(path, name, context, parse) {
        const read = await this.fs.readBinaryFile(path, context);
        if (!read.ok) {
            if (read.error.code === "not_found")
                return { path, lines: [], size: 0 };
            throw errorFromFile(`read of ${name}`, read.error);
        }
        const bytes = read.value;
        let completeSize = bytes.length;
        if (completeSize > 0 && bytes[completeSize - 1] !== 0x0a) {
            completeSize = bytes.lastIndexOf(0x0a) + 1;
            if (!this.readOnly) {
                const truncated = await this.fs.truncateFile(path, completeSize, context);
                if (!truncated.ok)
                    throw errorFromFile(`torn-line truncation of ${name}`, truncated.error);
            }
        }
        const lines = [];
        let start = 0;
        let lineNumber = 1;
        for (let end = 0; end < completeSize; end++) {
            if (bytes[end] !== 0x0a)
                continue;
            let text;
            try {
                text = textDecoder.decode(bytes.subarray(start, end));
            }
            catch (error) {
                throw new JsonlCorruptionError(`Invalid UTF-8 in complete ${name} line ${lineNumber}`, error instanceof Error ? error : undefined);
            }
            lines.push({ value: parse(text, lineNumber), start });
            start = end + 1;
            lineNumber++;
        }
        return { path, lines, size: bytes.length };
    }
    /**
     * Whether `main.jsonl` changed size since recovery read it. A writer reclaims a sidecar only after appending the
     * marker that allows it, so sidecars read while `main.jsonl` stayed the same match its markers; a recovery that
     * failed while it changed may have read a sidecar a newer commit reclaimed.
     */
    async mainChanged(context) {
        const info = await this.fs.fileInfo(this.mainPath, context);
        return info.ok && info.value.size !== this.mainSize;
    }
    async resolveFile(file, context) {
        const path = await this.fs.joinPath([this.directory, file], context);
        if (!path.ok)
            throw errorFromFile("path join", path.error);
        return path.value;
    }
    get store() {
        this.assertUsable();
        return this.memory;
    }
    /** The state to read once no batch is being appended: memory runs ahead of the file while one is. */
    async readable() {
        while (this.writing !== undefined)
            await this.writing;
        return this.store;
    }
    poison(cause) {
        this.poisonError ??= new JsonlStoragePoisonedError(cause);
        return this.poisonError;
    }
    assertUsable() {
        if (this.closed)
            throw new Error("JsonlStorage is closed");
        if (this.poisonError !== undefined)
            throw this.poisonError;
    }
}
//# sourceMappingURL=storage.js.map