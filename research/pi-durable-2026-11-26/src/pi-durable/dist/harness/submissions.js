import { withTelemetry } from "@earendil-works/chord/context";
import { copyJson } from "@earendil-works/chord/json";
import { createTypedSpanStarter, NOOP_TELEMETRY_CONTEXT, } from "@earendil-works/pi-telemetry";
import { ConversationBusy, ConversationIdle, ReadAfterWrite } from "../errors.js";
import { isSettled } from "../signals.js";
import { startRun } from "./generation.js";
import { appendInput, applyBoundary, hasQueuedReset, InboxDoc, isDisplayOnly, isStale, pickInputEntry, prepareBoundary, removeInboxItem, } from "./inbox.js";
import { LiveDoc } from "./live.js";
import { DURABLE_TELEMETRY_SCHEMA } from "./telemetry.js";
import { closedError, Waiters } from "./util.js";
/** Admission, waits, and withdrawal of the durable submissions of one Harness. */
export class Submissions {
    #telemetry;
    #session;
    #now;
    /** Read at each admission, on the Session line. */
    #queueModes;
    /** Enable task scheduling; submitting or waiting asks for progress. */
    #resume;
    #waiters = new Waiters();
    #closed = false;
    constructor(session, now, queueModes, resume, telemetry = NOOP_TELEMETRY_CONTEXT) {
        this.#telemetry = telemetry;
        this.#session = session;
        this.#now = now;
        this.#queueModes = queueModes;
        this.#resume = resume;
        session.followCommits((publication) => this.#observe(publication));
        session.subscribeClose(() => {
            this.#closed = true;
            this.#waiters.rejectAll(closedError(this.#session));
        });
    }
    /** Admit a submission in one commit; see `admitSubmission()`. */
    async submit(conversationId, draft, context) {
        const { id } = await this.#traced(conversationId, draft, context, (span) => this.#session.commitWith((tx) => admitSubmission(tx, conversationId, draft, this.#now(), this.#queueModes(), span), withTelemetry(span, context)));
        return new SubmissionHandle(id, this);
    }
    /**
     * Admit a submission inside the caller's commit `tx`, with the rules of `submit()`. The admission is stored or lost
     * with that commit. It must come before the commit's first table write, another admission's included.
     */
    async admit(tx, conversationId, draft) {
        if (!this.#session.ownsTransaction(tx))
            throw new Error("The transaction belongs to another Session");
        // Enforced on every path: admission reads tables only on some (request IDs, an idle boundary, a steer's trace).
        if (tx.hasTableWrite)
            throw new ReadAfterWrite("submit(tx, draft)");
        const admission = await this.#traced(conversationId, draft, tx.context, (span) => admitSubmission(tx, conversationId, draft, this.#now(), this.#queueModes(), span));
        return admission.id;
    }
    /** Run one admission in its `pi.durable.submit` span, asking for progress first, as the run it starts needs it. */
    #traced(conversationId, draft, context, admit) {
        this.#resume();
        // Inputs and continues start runs: root traces linked to their callers.
        const startsRun = draft.type !== "write";
        const parent = startsRun ? this.#telemetry : context.telemetry;
        return createTypedSpanStarter(parent, [DURABLE_TELEMETRY_SCHEMA])("pi.durable.submit", {
            "submission.type": draft.type,
            "conversation.id": conversationId,
        }, async (span) => {
            if (startsRun)
                span.addLink({ context: context.telemetry });
            try {
                const admission = await admit(span);
                span.setAttributes({ "submission.id": admission.id, result: admission.status });
                return admission;
            }
            catch (error) {
                // Error text may contain caller content. Record only the status.
                span.setStatus({ status: "error" });
                throw error;
            }
        });
    }
    /** Handle for an existing submission, or `undefined`. */
    async get(id, context) {
        const record = await this.#session.readOnLine((storage) => storage.submission(id, context));
        return record === undefined ? undefined : new SubmissionHandle(record.id, this);
    }
    async status(id, context) {
        const record = await this.#session.readOnLine((storage) => storage.submission(id, context));
        if (record === undefined)
            throw new Error(`Submission ${id} does not exist`);
        return record;
    }
    async wait(id, context) {
        this.#resume();
        // Check and register on the line so no settling publication falls between them.
        const found = await this.#session.readOnLine(async (storage) => {
            const record = await storage.submission(id, context);
            if (record === undefined)
                throw new Error(`Submission ${id} does not exist`);
            if (isSettled(record))
                return { promise: Promise.resolve(record) };
            // Close rejects registered waiters synchronously and may begin during the read.
            if (this.#closed)
                throw closedError(this.#session);
            return { promise: this.#waiters.add(id, context) };
        });
        return found.promise;
    }
    /** Withdraw a queued submission and remove its inbox item; placed inputs and settled submissions are reported. */
    abort(id, context, conversationId) {
        return this.#session.commitWith(async (tx) => {
            const record = await tx.submission(id);
            if (record === undefined || (conversationId !== undefined && record.conversationId !== conversationId)) {
                return "not_found";
            }
            if (record.status === "queued") {
                tx.settleSubmission(id, { status: "unanswered", reason: "aborted" });
                await removeInboxItem(tx, record.conversationId, id);
                return "aborted";
            }
            return record.status === "placed" ? "already_placed" : "settled";
        }, context);
    }
    #observe(publication) {
        // A commit held in memory changes documents only.
        if (publication.kind === "memory")
            return;
        for (const change of publication.changes) {
            if (change.type !== "submission" || !isSettled(change.value))
                continue;
            this.#waiters.resolve(change.value.id, change.value);
        }
    }
}
class SubmissionHandle {
    id;
    #submissions;
    constructor(id, submissions) {
        this.id = id;
        this.#submissions = submissions;
    }
    status(context) {
        return this.#submissions.status(this.id, context);
    }
    wait(context) {
        return this.#submissions.wait(this.id, context);
    }
    async abort(context) {
        const result = await this.#submissions.abort(this.id, context);
        if (result === "not_found")
            throw new Error(`Submission ${this.id} does not exist`);
        return result;
    }
}
/** Reject an input entry an untyped caller got wrong: its kind must be a non-empty string outside the `pi.` prefix. */
function checkInputEntry(entry) {
    const { kind } = entry;
    if (typeof kind !== "string" || kind.length === 0 || kind.startsWith("pi.")) {
        throw new TypeError(`An input entry's kind must be a non-empty string not starting with "pi.", got ${String(kind)}`);
    }
}
/**
 * Admit a submission inside a commit (spec §6); both `Conversation.submit()` forms and conversation-owned compactions
 * share it. A known request ID returns its existing submission without writing. A display-only write (only `kind` and
 * `data`) is appended and settled `done` at once, busy or not, as it changes nothing the model sees; only behind a
 * queued reset it queues, so it lands after the reset instead of before it in the context the reset ends. A busy
 * conversation queues anything else in `pi.inbox`, or rejects `whenBusy: "reject"` input and any continue with
 * `ConversationBusy`; an idle one rejects `whenIdle: "reject"` input with `ConversationIdle`. An idle continue places
 * queued items and starts a run with them and itself, placing no entry of its own. An idle conversation with queued
 * items queues it behind them and runs a final boundary. Otherwise idle input places its entry (`pi.user`, or the
 * input's own) and starts a run, and an idle write appends its entry and settles `done`, or `stale` when its head
 * reaches before the active range.
 */
export async function admitSubmission(tx, conversationId, draft, now, queueModes, span) {
    if (draft.type === "input" && draft.entry !== undefined)
        checkInputEntry(draft.entry);
    if (draft.requestId !== undefined) {
        const existing = await tx.submissionByRequest(conversationId, draft.requestId);
        if (existing !== undefined) {
            if (existing.type !== draft.type) {
                throw new Error(`Request ${draft.requestId} already identifies a submission of type ${existing.type}`);
            }
            return { id: existing.id, status: existing.status === "unanswered" ? "done" : existing.status };
        }
    }
    const fields = {
        conversationId,
        requestId: draft.requestId,
        trace: span?.propagation?.inject(span),
        notify: draft.notify,
    };
    if (draft.type === "write" &&
        isDisplayOnly(draft.entry) &&
        !hasQueuedReset((await tx.doc(InboxDoc, conversationId)).items)) {
        const entry = await tx.appendEntry(conversationId, draft.entry);
        const write = { ...fields, type: "write", status: "done", entry: entry.id };
        return { id: (await tx.createSubmission(write)).id, status: "done" };
    }
    const live = await tx.doc(LiveDoc, conversationId);
    const busy = live.run !== undefined;
    if (draft.type === "input" &&
        draft.whenBusy === "steer" &&
        live.run !== undefined &&
        span?.propagation !== undefined) {
        const run = await tx.task(live.run.taskId);
        if (run?.trace !== undefined)
            span.addLink({ context: span.propagation.extract(run.trace) });
    }
    if (busy && draft.type === "input" && draft.whenBusy === "reject")
        throw new ConversationBusy(conversationId);
    if (!busy && draft.type === "input" && draft.whenIdle === "reject")
        throw new ConversationIdle(conversationId);
    if (draft.type === "continue") {
        // Never queued: whether a run can continue depends on how the current one ends. Rejected before any write.
        if (busy)
            throw new ConversationBusy(conversationId);
        const boundary = await prepareBoundary(tx, conversationId, queueModes);
        const { id } = await tx.createSubmission({ ...fields, type: "continue", status: "placed" });
        // Items an earlier failed run left queued (`afterFailedRun: "keep"`) are placed first and join the run. Its history
        // starts with the failed run's, so `afterRun` hooks see what that run did.
        const { users, first } = await applyBoundary(tx, boundary, "final", now);
        await startRun(tx, conversationId, live, { inputs: [...users, id], first: live.runFailure?.first ?? first });
        return { id, status: "placed" };
    }
    // A boundary reads the table, so it is prepared before the first table write; a busy one needs none.
    const boundary = busy ? undefined : await prepareBoundary(tx, conversationId, queueModes);
    if (boundary === undefined || boundary.inbox.items.length > 0) {
        const { id } = await tx.createSubmission({
            ...fields,
            type: draft.type,
            status: "queued",
        });
        // Hosts may leave optional fields `undefined`; drafts take strict JSON.
        const value = copyJson(draft.type === "write" ? draft.entry : draft.content, {
            omitUndefinedProperties: true,
        });
        const items = (boundary?.inbox ?? (await tx.doc(InboxDoc, conversationId))).items;
        if (draft.type === "write")
            items.push({ id, mode: "write", entry: value });
        else {
            const mode = draft.whenBusy === "steer" ? "steer" : "followUp";
            const content = value;
            const entry = draft.entry === undefined ? {} : { entry: pickInputEntry(draft.entry) };
            items.push({ id, mode, content, ...entry, ...(draft.onAbort === "keep" ? { onAbort: "keep" } : {}) });
        }
        if (boundary === undefined)
            return { id, status: "queued" };
        const { users, first } = await applyBoundary(tx, boundary, "final", now);
        if (users.length > 0)
            await startRun(tx, conversationId, live, { inputs: users, first });
        return { id, status: draft.type === "write" ? "done" : users.at(-1) === id ? "placed" : "queued" };
    }
    if (draft.type === "write") {
        if (isStale(boundary, draft.entry)) {
            const stale = { status: "unanswered", reason: "stale" };
            return {
                id: (await tx.createSubmission({ ...fields, type: "write", ...stale })).id,
                status: "done",
            };
        }
        const entry = await tx.appendEntry(conversationId, draft.entry);
        const write = { ...fields, type: "write", status: "done", entry: entry.id };
        return { id: (await tx.createSubmission(write)).id, status: "done" };
    }
    const entry = await appendInput(tx, conversationId, draft.content, draft.entry, now);
    const input = { ...fields, type: "input", status: "placed", entry: entry.id };
    const { id } = await tx.createSubmission(input);
    await startRun(tx, conversationId, live, { inputs: [id], first: entry.id });
    return { id, status: "placed" };
}
//# sourceMappingURL=submissions.js.map