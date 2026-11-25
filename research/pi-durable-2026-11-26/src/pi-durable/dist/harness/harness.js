import { withAbortSignal, withoutAbortSignal } from "@earendil-works/chord/context";
import { cleanupSessionResources } from "@earendil-works/pi-ai/session-resources";
import { mergeClientIdentity, PI_ATTRIBUTION, withClientIdentity, } from "@earendil-works/pi-ai/utils/identity";
import { createTypedMetrics, NOOP_TELEMETRY_CONTEXT, NOOP_TELEMETRY_METRICS, } from "@earendil-works/pi-telemetry";
import { ResetEntry } from "../entries.js";
import { contained, SessionImpl } from "../session/session.js";
import { hostTimers } from "../timers.js";
import { ROOT_CONVERSATION_ID } from "../types.js";
import { AgentDoc, configure, createAgent, resolveAgent, resolveSettings } from "./agent.js";
import { createCompaction } from "./compaction.js";
import { readContext } from "./context.js";
import { InboxDoc, withdrawAbortedInputs } from "./inbox.js";
import { LIMITS_RESTARTS, LiveDoc, settleSchedulerOutcome } from "./live.js";
import { ProviderDoc } from "./provider.js";
import { BUILTIN_TASKS } from "./registry.js";
import { TaskScheduler } from "./scheduler.js";
import { Submissions } from "./submissions.js";
import { TaskGraphView } from "./task-graph.js";
import { DURABLE_TELEMETRY_SCHEMA } from "./telemetry.js";
import { gatedCall, keepsChildren } from "./tool.js";
import { addUsageState, UsageDoc } from "./usage.js";
import { conversationEntries, scanAll } from "./util.js";
import { ConversationViews } from "./view.js";
const SCAN_PAGE_SIZE = 256;
/** Key of the Harness's internal index-size getter, for tests. */
export const SCHEDULER_INDEX_SIZES = Symbol.for("pi-durable.schedulerIndexSizes");
/** Key of the Harness's internal idle-state getter (kept contexts against a full recompute), for tests. */
export const SCHEDULER_IDLE_STATE = Symbol.for("pi-durable.schedulerIdleState");
class ConversationImpl {
    id;
    #host;
    constructor(id, host) {
        this.id = id;
        this.#host = host;
    }
    agent(context) {
        return this.#host.harness.resolveAgent(this.id, undefined, context);
    }
    configure(change, context) {
        return this.#host.harness.commitWith((tx) => configure(tx, this.id, change), context);
    }
    submit(submission, context) {
        return this.#host.submissions.submit(this.id, submission, context);
    }
    admit(tx, submission) {
        return this.#host.submissions.admit(tx, this.id, submission);
    }
    async compact(instructions, context) {
        this.#host.tasks.resume();
        const input = { reason: "manual", ...(instructions === undefined ? {} : { instructions }) };
        return this.#host.harness.commitWith((tx) => createCompaction(tx, this.id, input), context);
    }
    async reset(handoff, context) {
        const model = handoff === undefined
            ? {}
            : { model: [{ role: "user", content: handoff, timestamp: this.#host.now() }] };
        const entry = { kind: ResetEntry.kind, head: "self", ...model };
        await this.#host.submissions.submit(this.id, { type: "write", entry }, context);
    }
    commit(change, context, options) {
        return this.#host.harness.commitWith(change, context, { conversationId: this.id }, options);
    }
    context(context, options) {
        return readContext(this.#host.harness, this.#host.storage, this.id, context, options?.at);
    }
    entries(query, limit, cursor, context) {
        const scan = conversationEntries(this.id, query);
        return this.#host.harness.readOnLine((storage) => storage.scanEntries(scan, limit, cursor, context));
    }
    fork(at, options, context) {
        return this.#host.create({ kind: "fork", parentId: this.id, at, ownership: options.ownership }, options, context);
    }
    async abort(context, options) {
        this.#host.tasks.resume();
        return this.#host.tasks.abortConversation(this.id, options?.background === true, context);
    }
    async waitForIdle(context) {
        this.#host.tasks.resume();
        return this.#host.tasks.waitForIdle(this.id, context);
    }
    watch(context, window) {
        return this.#host.views.watch(this.id, context, window);
    }
}
/** Request identity of a Harness's model requests: pi-ai's defaults with provider attribution to pi. */
export const DEFAULT_HARNESS_IDENTITY = { attribution: PI_ATTRIBUTION };
/**
 * `HarnessOptions.models` as a function with `HarnessOptions.identity` applied. A plain `Models` is wrapped once; a
 * function's result is wrapped at each call.
 */
function currentModels(models, identity) {
    const merged = mergeClientIdentity(DEFAULT_HARNESS_IDENTITY, identity) ?? DEFAULT_HARNESS_IDENTITY;
    if (typeof models === "function")
        return () => withClientIdentity(models(), merged);
    const wrapped = withClientIdentity(models, merged);
    return () => wrapped;
}
/** `HarnessOptions.settings` as a function: plain settings, or none, are returned at every call. */
function currentSettings(settings) {
    return typeof settings === "function" ? settings : () => settings;
}
/** Session kernel extended with conversation handles and a registry. */
class HarnessImpl extends SessionImpl {
    #options;
    #hostSettings;
    #report;
    #host;
    #tasks;
    #submissions;
    #taskGraph;
    constructor(rawStorage, options, context) {
        const report = safeReport(options.onReport, options.telemetry ?? NOOP_TELEMETRY_CONTEXT);
        const now = safeNow(options.now, report);
        const hostSettings = currentSettings(options.settings);
        // Read at each use, as all settings are, but only these fields: they are read on every commit.
        super(rawStorage, now, () => hostSettings()?.documentRetentionMs, options.setTimer, options.readOnly === true, () => hostSettings()?.progress?.persistWithinMs);
        // Every component reads and writes through the Session's failure guard: `rawStorage` serves only `super()`.
        const storage = this.storage;
        this.#options = options;
        this.#report = report;
        this.#hostSettings = hostSettings;
        const settings = () => resolveSettings(hostSettings());
        this.#tasks = new TaskScheduler({
            telemetry: options.telemetry,
            session: this,
            storage,
            registry: options.registry,
            models: currentModels(options.models, options.identity),
            agent: (id, snapshot, callContext) => this.resolveAgent(id, snapshot, callContext),
            settings,
            env: (id, callContext) => this.buildEnv(id, callContext),
            now,
            onWake: options.onWake,
            timers: hostTimers(options.setTimer, (error) => report(error, { kind: "host_error", callback: "setTimer" })),
            writeAtClose: (writes) => this.writeAtClose(writes),
            report: this.#report,
            limitsRestarts: (kind) => LIMITS_RESTARTS.has(kind),
            keepsAbandoned: keepsChildren,
            gated: gatedCall,
            settleOutcome: settleSchedulerOutcome,
            withdrawInputs: withdrawAbortedInputs,
            conversation: async (id, binding, callContext) => {
                const record = await this.readOnLine((line) => line.conversation(id, callContext));
                return record === undefined ? undefined : boundConversation(id, binding, this.#submissions, this.#tasks);
            },
            context: withoutAbortSignal(context),
            readOnly: options.readOnly === true,
        });
        this.#submissions = new Submissions(this, now, settings, () => this.#tasks.resume(), options.telemetry);
        this.#taskGraph = new TaskGraphView(this, {
            blocked: (record) => this.#tasks.blockedReason(record),
            subscribeBlocked: (listener) => this.#tasks.subscribeBlocked(listener),
        });
        this.#host = {
            harness: this,
            storage,
            tasks: this.#tasks,
            submissions: this.#submissions,
            views: new ConversationViews(this),
            now,
            create: (target, createOptions, context) => this.#create(target, createOptions, context),
        };
    }
    /** Resolve a conversation's committed `pi.agent` against `snapshot`, or the current one, and the current settings. */
    async resolveAgent(id, snapshot, context) {
        const registry = snapshot ?? this.#options.registry.snapshot();
        const state = await this.snapshot(AgentDoc, id, context);
        return resolveAgent(state, registry, resolveSettings(this.#hostSettings()), (error, extension) => this.#report(error, { kind: "extension_error", conversationId: id, extension }, context));
    }
    /** Build a conversation's environment from its current `cwd`; `undefined` without an `env` option. */
    async buildEnv(id, context) {
        const build = this.#options.env;
        if (build === undefined)
            return undefined;
        const cwd = (await this.snapshot(AgentDoc, id, context))?.cwd;
        return build({ conversationId: id, ...(cwd === undefined ? {} : { cwd }), read: this }, context);
    }
    /** Reconcile surviving `running` tasks to `pending`; part of open. */
    openTasks(context) {
        return this.#tasks.open(context);
    }
    resume() {
        this.assertUsable();
        this.#tasks.resume();
    }
    wake() {
        this.assertUsable();
        return this.#tasks.wake();
    }
    getTask(id, context) {
        return this.readOnLine((storage) => storage.task(id, context));
    }
    /** Internal, for tests: sizes of the scheduler's ownership indexes. */
    get [SCHEDULER_INDEX_SIZES]() {
        return this.#tasks.indexSizes;
    }
    /** Internal, for tests: the kept contexts' idle state and its disagreements with a full recompute. */
    get [SCHEDULER_IDLE_STATE]() {
        return this.#tasks.idleState;
    }
    inspect(context) {
        return this.readOnLine(async (storage) => {
            const { scheduling, tasks } = await this.#tasks.inspect(this.#options.registry.snapshot());
            const scan = (status) => scanAll((cursor) => storage.scanSubmissions({ status }, SCAN_PAGE_SIZE, cursor, context));
            const submissions = [...(await scan("queued")), ...(await scan("placed"))].sort((a, b) => a.id - b.id);
            return { scheduling, tasks, submissions };
        });
    }
    submission(id, context) {
        return this.#submissions.get(id, context);
    }
    abortSubmission(id, context, conversationId) {
        return this.#submissions.abort(id, context, conversationId);
    }
    abortTask(id, context) {
        return this.#tasks.abort(id, context);
    }
    async signal(taskId, token, key, value, context) {
        this.#tasks.resume();
        return this.commitWith((tx) => tx.signal(taskId, token, key, value), context);
    }
    async waitForTask(id, context) {
        this.#tasks.resume();
        return this.#tasks.waitForTask(id, context);
    }
    async waitForIdle(context) {
        this.#tasks.resume();
        return this.#tasks.waitForIdle(undefined, context);
    }
    /** Sum every conversation's committed `pi.usage`. Each document is read at its own point; totals only grow. */
    async usage(context) {
        const conversations = await this.readOnLine((storage) => scanAll((cursor) => storage.scanConversations({}, SCAN_PAGE_SIZE, cursor, context)));
        const total = UsageDoc.definition.initial();
        for (const { id } of conversations) {
            const state = await this.snapshot(UsageDoc, id, context);
            if (state !== undefined)
                addUsageState(total, state);
        }
        return total;
    }
    watchTaskGraph(context) {
        return this.#taskGraph.watch(context);
    }
    async observeTaskGraph(observer, context) {
        this.assertUsable();
        return this.#taskGraph.observe(observer, context);
    }
    async observeConversation(id, observer, context, window) {
        this.assertUsable();
        return this.#host.views.observe(id, observer, context, window);
    }
    root(context, options) {
        return this.#create({ kind: "root" }, options ?? {}, context);
    }
    async conversation(id, context) {
        this.assertUsable();
        const record = await this.readOnLine((storage) => storage.conversation(id, context));
        return record === undefined ? undefined : new ConversationImpl(record.id, this.#host);
    }
    createConversation(options, context) {
        return this.#create({ kind: "independent", ownership: options.ownership }, options, context);
    }
    report(error, info = { kind: "listener_error" }, context) {
        this.#report(error, info, context);
    }
    /** The ownership memberships a commit's task changes write, from the scheduler's index. */
    membershipKeys(tx) {
        return this.#tasks.membershipKeys(tx);
    }
    /** Join task invocations before releasing provider resources, so none close while in use or outlive the Harness. */
    beforeClose() {
        const joined = this.#tasks.join();
        if (this.#tasks.providerSessionIds.size === 0)
            return joined;
        return joined.then(() => {
            for (const sessionId of this.#tasks.providerSessionIds) {
                contained(() => cleanupSessionResources(sessionId), (error) => this.#report(error, { kind: "host_error", callback: "models" }));
            }
            this.#tasks.providerSessionIds.clear();
        });
    }
    async #create(target, options, context) {
        this.assertUsable();
        const id = await this.commitWith(async (tx) => {
            if (target.kind === "root" && (await tx.conversation(ROOT_CONVERSATION_ID)) !== undefined) {
                return ROOT_CONVERSATION_ID;
            }
            const record = target.kind === "root"
                ? await tx.createRootConversation()
                : target.kind === "fork"
                    ? await tx.forkConversation(target.parentId, target.at, { ownership: target.ownership })
                    : await tx.createConversation({ ownership: target.ownership });
            if (options.agent !== undefined)
                await configure(tx, record.id, options.agent);
            if (options.init !== undefined)
                await options.init(tx, record.id);
            return record.id;
        }, context);
        return new ConversationImpl(id, this.#host);
    }
    /**
     * The built-in creation hook, in every commit that creates or forks a conversation: empty `pi.live`, `pi.inbox`, and
     * `pi.usage`, a fresh `pi.provider`, the conversation's `pi.agent` (see `createAgent()`), then
     * `HarnessOptions.conversationCreated`.
     */
    async conversationCreated(tx, record) {
        await tx.doc(LiveDoc, record.id);
        await tx.doc(InboxDoc, record.id);
        await tx.doc(UsageDoc, record.id);
        await tx.doc(ProviderDoc, record.id);
        await createAgent(tx, record);
        await this.#options.conversationCreated?.(tx, record);
    }
}
/**
 * Report to `onReport`, then count it and record its event. Never throws, since reports also come from inside Storage's
 * `adopt`: a throwing `onReport` is dropped, and so is a throwing metric or event, as reporting it would report again.
 */
function safeReport(onReport, telemetry) {
    const reports = createTypedMetrics(telemetry.metrics ?? NOOP_TELEMETRY_METRICS, [DURABLE_TELEMETRY_SCHEMA]).counter("pi.durable.reports");
    return (error, info, context) => {
        if (onReport !== undefined) {
            contained(() => onReport({ ...info, error }), () => { });
        }
        const attributes = {
            type: info.kind,
        };
        switch (info.kind) {
            case "task_faulted":
            case "task_interrupted":
            case "task_outdated":
                attributes.reason = info.reason;
                attributes.extension = info.extension;
                attributes["task.id"] = info.task.id;
                break;
            case "migration_failed":
            case "task_error":
            case "extension_error":
                attributes.extension = info.extension;
                attributes["task.id"] = info.task?.id;
                break;
            case "host_error":
                attributes["task.id"] = info.task?.id;
                break;
        }
        try {
            reports.add(1, { type: info.kind });
            context?.telemetry.addEvent("pi.durable.report", attributes);
        }
        catch {
            // Dropped: see above.
        }
    };
}
/**
 * The host clock, falling back to `Date.now` when it throws: a broken clock must not stop commits. The first throw is
 * reported; the clock is read in every task change, so later ones are not.
 */
export function safeNow(now, report) {
    if (now === undefined)
        return Date.now;
    let reported = false;
    return () => {
        try {
            return now();
        }
        catch (error) {
            // Set first: a report handler that reads the clock again must not report again.
            if (!reported) {
                reported = true;
                report(error, { kind: "host_error", callback: "now" });
            }
            return Date.now();
        }
    };
}
/**
 * Invocation-bound handle for tasks and tools. Every operation, and every operation of a submission it returns, first
 * checks the invocation and runs under its signal, so it rejects once the invocation ends; admitted work stays durable.
 */
function boundConversation(id, binding, submissions, tasks) {
    const bind = (context) => withAbortSignal(binding.signal, context);
    const bound = (operation) => {
        return async (context) => {
            binding.check();
            return operation(bind(context));
        };
    };
    const submit = async (draft, context) => {
        binding.check();
        const submission = await submissions.submit(id, draft, bind(context));
        return {
            id: submission.id,
            status: bound((callContext) => submission.status(callContext)),
            wait: bound((callContext) => submission.wait(callContext)),
            abort: bound((callContext) => submission.abort(callContext)),
        };
    };
    return {
        id,
        submit,
        admit: async (tx, draft) => {
            binding.check();
            // The caller's commit carries its own context, so the invocation's abort is checked here.
            binding.signal.throwIfAborted();
            return submissions.admit(tx, id, draft);
        },
        abort: async (context, options) => {
            binding.check();
            return tasks.abortConversation(id, options?.background === true, bind(context));
        },
        waitForIdle: bound((callContext) => tasks.waitForIdle(id, callContext)),
    };
}
export const Harness = {
    /** Open a Harness over storage. The registry may keep changing while the Harness runs. */
    async open(storage, options, context) {
        context.abortSignal?.throwIfAborted();
        const snapshot = options.registry.snapshot();
        const missing = BUILTIN_TASKS.filter((task) => snapshot.task(task.definition.name) === undefined);
        if (missing.length > 0) {
            const names = missing.map((task) => task.definition.name).join(", ");
            throw new Error(`Registry lacks built-in tasks ${names}; create it with createRegistry()`);
        }
        const harness = new HarnessImpl(storage, options, context);
        try {
            await harness.openTasks(context);
        }
        catch (error) {
            // The caller's context may be what failed open: close without it, and rethrow the open error.
            // A failing Storage close fails the Session, which reports it.
            await harness.close(withoutAbortSignal(context)).catch(() => { });
            throw error;
        }
        return harness;
    },
};
//# sourceMappingURL=harness.js.map