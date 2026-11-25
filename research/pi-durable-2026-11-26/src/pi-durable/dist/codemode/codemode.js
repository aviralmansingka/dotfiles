import { ownedSlice } from "@earendil-works/chord/delta";
import { copyJson } from "@earendil-works/chord/json";
import { toCodemodeIdentifier } from "@earendil-works/pi-codemode/declarations";
import { CODEMODE_SOURCE_GRAMMAR, parseCodemodeSource } from "@earendil-works/pi-codemode/source";
import { obj, str } from "@earendil-works/pi-schema";
import { defineDoc } from "../documents.js";
import { errorMessage } from "../errors.js";
import { defineExtension, defineTool, section } from "../harness/define.js";
import { NestedCallDoc } from "../harness/tool.js";
import { rankDocuments } from "../search.js";
import { codemodeDescription, codemodeSection, DEFAULT_CODEMODE_INLINE_BUDGET, declaredNamespaces, namespacesOf, sampleOf, } from "./describe.js";
import { CATALOG_GLOBALS, CODEMODE_INTERNAL_PREFIX, catalogCall, createModelTools, GENERATE_IMAGES_TOOL, MAX_CONCURRENT_MODEL_CALLS, MODEL_CALLS, } from "./models.js";
import { DEFAULT_MAX_OUTPUT_TOKENS, formatResult } from "./output.js";
/**
 * Version of everything in this module that turns stored results into what a script sees: result mapping, globals,
 * start data. Bump it when that changes, so a call started before an upgrade is not replayed by different code.
 */
export const CODEMODE_MODULE_VERSION = 2;
export const CODEMODE_TOOL_NAME = "codemode";
export const CodemodeRunDoc = defineDoc({
    kind: "pi.codemode.run",
    version: 1,
    scope: "task",
    initial: () => ({}),
    // The document retires with its task.
    checkpointWhen: () => false,
});
export const CodemodeJournalDoc = defineDoc({
    kind: "pi.codemode.journal",
    version: 1,
    scope: "task",
    initial: () => ({ entries: [] }),
    // The document retires with its task.
    checkpointWhen: () => false,
});
/**
 * What scripts keep with `store()` and read with `load()`, per conversation. Rewindable and copied as of the fork
 * point, so a fork sees the values as they were when its entry was committed.
 */
export const CodemodeStoreDoc = defineDoc({
    kind: "pi.codemode.store",
    version: 1,
    scope: "conversation",
    history: "rewindable",
    fork: "asOf",
    initial: () => ({ values: {} }),
    checkpointWhen: (_value, _ops, { deltasSinceBase }) => deltasSinceBase >= 64,
});
const ARGS_PREVIEW_CHARS = 200;
const ERROR_PREVIEW_CHARS = 500;
function cut(text, max) {
    // A copy: the row outlives the arguments or error text it previews.
    return text.length > max ? `${ownedSlice(text, 0, max - 3)}...` : text;
}
const codemodeSchema = obj({ code: str({ description: "Raw JavaScript source." }) }, { open: true });
/** Outputs bounded by the script's own token budget; the Harness's limits only stop a runaway. */
const OUTPUT_LIMITS = { maxBytes: 4 * 1024 * 1024, maxLines: 100_000 };
/** Globals for finding tools, answered from the start data, so a replay sees what the first run saw. */
const DISCOVERY_GLOBALS = ["searchTools", "describeTool", "describeNamespace"];
const DEFAULT_SEARCH_LIMIT = 8;
/** The code mode tool. Scripts call the conversation's callable tools as `tools.<name>(args)`. */
export function createCodemodeTool(options) {
    return defineTool({
        name: CODEMODE_TOOL_NAME,
        description: codemodeDescription(options.models !== false),
        parameters: codemodeSchema,
        outputLimits: OUTPUT_LIMITS,
        // Capable models write the script as raw text instead of a JSON-escaped string; pi-ai applies it only for them.
        constrainedSampling: { type: "grammar", variants: { openai_lark: CODEMODE_SOURCE_GRAMMAR } },
        callers: ["model"],
        replay: "safe",
        execute: (args, api, context) => new CodemodeCall(options, api, context).execute(args.code),
    });
}
/**
 * The `codemode` extension: the code mode tool, and the `codemode` prompt section listing the tools scripts can call.
 */
export function createCodemodeExtension(options) {
    return defineExtension({
        name: "codemode",
        tools: [createCodemodeTool(options), ...(options.models === false ? [] : createModelTools())],
        sections: [
            section("codemode", (input) => codemodeSection(
            // Deferred tools are found with `searchTools()`, as the coding agent leaves them out too.
            input.agent.callable.filter((tool) => !tool.name.startsWith(CODEMODE_INTERNAL_PREFIX) && tool.deferred !== true), input.agent.extensions, options.inlineBudget ?? DEFAULT_CODEMODE_INLINE_BUDGET)),
        ],
    });
}
/**
 * What a script gets for a nested call, as in the coding agent. A tool with a schema resolves with its value, also on
 * an error result that carries one (`bash`'s `{ output, exitCode }` for a nonzero exit); a schema-less tool
 * resolves with its text output, images left out, as its declaration says. Any other error rejects, with its text: a
 * schema-less tool's output, else its error diagnostics.
 */
function outcomeOf(name, structured, result) {
    const value = structured ? result.structuredOutput : textOf(result.structuredOutput);
    if (!result.isError || (structured && value !== undefined))
        return { ok: true, value };
    const message = structured ? "" : value;
    const diagnostics = result.diagnostics
        .filter((diagnostic) => diagnostic.severity === "error")
        .map((diagnostic) => diagnostic.message)
        .join("\n");
    return {
        ok: false,
        message: message || diagnostics || `Tool ${name} failed`,
        ...(value === undefined ? {} : { properties: { structuredOutput: value } }),
    };
}
/** The text of a schema-less tool's collapsed output: a string, one image, or an array of text and image blocks. */
function textOf(value) {
    if (typeof value === "string")
        return value;
    if (!Array.isArray(value))
        return "";
    return value.flatMap((item) => (isText(item) ? [item.text] : [])).join("\n");
}
function isText(item) {
    return typeof item === "object" && item !== null && item.type === "text";
}
function errorResult(message) {
    return { output: [{ type: "text", text: message }], isError: true };
}
/** One execution of the code mode tool: a first run, or a rerun after a restart that replays the journal. */
class CodemodeCall {
    options;
    api;
    context;
    controller = new AbortController();
    run;
    start;
    /** The journal as this attempt found it; replay delivers exactly these. */
    replayed = [];
    /** Entries in the journal, replayed and live; the next delivery is `length + 1`. */
    journalLength = 0;
    /** Replayed entries delivered so far. */
    nextReplayed = 0;
    replaying = false;
    /** Whether an earlier attempt ran this call: its nested call keys may already exist. */
    rerun = false;
    /** Whether live calls may launch; before, they are held (see `release()`). */
    released = false;
    /** The count an earlier attempt recorded after the script's first run. */
    firstIssued;
    /** The highest issued count known to be committed: calls up to it may launch. */
    durableIssued = 0;
    /** Live calls waiting for their issued count to be committed. */
    waiting = [];
    /** Journal index of each replayed call ID. */
    replayIndex = new Map();
    /** Calls the VM issued so far; its call IDs are 1, 2, ... */
    issued = 0;
    /** Replay: results of journaled calls, ready to deliver in journal order. */
    ready = new Map();
    /** Replay: calls the journal does not have, admitted once replay is done. */
    held = [];
    /** Live: finished calls waiting for their journal commit. */
    queue = [];
    /** Acknowledged counts to record, by result number (0: the script's first run). */
    acks = new Map();
    committing = false;
    /** Set once the call decided an outcome other than the script's own (divergence, mismatch) or failed. */
    ended;
    failure;
    /** `models.classify()`/`generateImages()` calls in flight, and those waiting for a slot. */
    modelCalls = 0;
    modelWaiters = [];
    /** Images `models.generateImages()` returned, to notice a script that never shows them. */
    generatedImages = 0;
    /** The script's tool calls for `details`, by VM call ID. */
    rows = new Map();
    /** Resolves once the VM's fingerprint is checked or recorded; nothing is delivered or admitted before. */
    gate;
    openGate;
    constructor(options, api, context) {
        this.options = options;
        this.api = api;
        this.context = context;
        this.gate = new Promise((resolve) => {
            this.openGate = resolve;
        });
    }
    async execute(source) {
        const { code, options: sourceOptions } = parseCodemodeSource(source);
        const { api, context } = this;
        const agent = await api.agent(context);
        const tools = agent.callable.map((tool) => ({
            name: tool.name,
            jsName: toCodemodeIdentifier(tool.name),
            description: sampleOf(tool),
            ...(tool.structuredOutputSchema === undefined ? {} : { structured: true }),
            ...(tool.name.startsWith(CODEMODE_INTERNAL_PREFIX) ? { hidden: true } : {}),
        }));
        const callable = agent.callable.filter((tool) => !tool.name.startsWith(CODEMODE_INTERNAL_PREFIX));
        const models = this.options.models === false ? [] : [...CATALOG_GLOBALS, ...Object.keys(MODEL_CALLS)];
        const globals = [
            ...DISCOVERY_GLOBALS.map((name) => ({ name, spread: true })),
            ...models.map((name) => ({ name, spread: true })),
            ...(this.options.globals ?? []).map((global) => ({ name: global.name, spread: global.spread === true })),
        ];
        const toolNamespaces = namespacesOf(agent.extensions);
        const namespaces = declaredNamespaces(agent.extensions).map((namespace) => ({
            name: namespace.name,
            description: namespace.description,
            ...(namespace.instructions === undefined ? {} : { instructions: namespace.instructions }),
            tools: callable
                .filter((tool) => toolNamespaces.get(tool.name)?.name === namespace.name)
                .map((tool) => tool.name),
        }));
        const now = api.now();
        const seed = crypto.getRandomValues(new Uint32Array(1))[0];
        const found = await api.commit(async (tx) => {
            const run = await tx.doc(CodemodeRunDoc, api.taskId);
            if (run.result !== undefined)
                return { kind: "done", done: copyJson(run.result) };
            const rerun = run.start !== undefined;
            if (run.start === undefined) {
                const store = await tx.doc(CodemodeStoreDoc, api.conversationId);
                const timeout = sourceOptions.timeoutMs;
                run.start = {
                    version: CODEMODE_MODULE_VERSION,
                    startedAt: now,
                    seed,
                    ...(timeout === undefined ? {} : { deadline: now + timeout }),
                    tools,
                    namespaces,
                    globals,
                    maxOutputTokens: sourceOptions.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
                    store: copyJson(store.values),
                };
            }
            const journal = await tx.doc(CodemodeJournalDoc, api.taskId);
            return {
                kind: "started",
                start: copyJson(run.start),
                journal: copyJson(journal.entries),
                firstIssued: journal.firstIssued,
                rerun,
            };
        }, context);
        if (found.kind === "done")
            return found.done;
        this.start = found.start;
        this.replayed = found.journal;
        this.replayIndex = new Map(found.journal.map((entry, index) => [entry.id, index]));
        this.journalLength = found.journal.length;
        this.replaying = found.journal.length > 0;
        this.rerun = found.rerun;
        this.firstIssued = found.firstIssued;
        // A loop, not spread arguments: a journal can hold more entries than a call takes arguments.
        this.durableIssued = found.journal.reduce((max, entry) => Math.max(max, entry.issuedAfter ?? 0), found.firstIssued ?? 0);
        if (this.start.version !== CODEMODE_MODULE_VERSION) {
            return this.decide(errorResult(`The script cannot resume: it started under code mode version ${this.start.version}, this is ${CODEMODE_MODULE_VERSION}.`));
        }
        const remaining = this.start.deadline === undefined ? undefined : this.start.deadline - this.api.now();
        if (remaining !== undefined && remaining <= 0) {
            return this.decide(errorResult(`Script timed out: its deadline passed while it was interrupted.`));
        }
        const onAbort = () => this.controller.abort(context.abortSignal?.reason);
        context.abortSignal?.addEventListener("abort", onAbort, { once: true });
        if (context.abortSignal?.aborted)
            onAbort();
        try {
            this.run = this.options.sandbox.start(code, {
                startedAt: this.start.startedAt,
                seed: this.start.seed,
                tools: this.start.tools.filter((tool) => tool.hidden !== true),
                globals: this.start.globals,
                store: this.start.store,
                signal: this.controller.signal,
                ...(remaining === undefined ? {} : { timeoutMs: remaining }),
                onStarted: (fingerprint) => void this.checkFingerprint(fingerprint),
                onCall: (call) => this.onCall(call),
                onIdle: (seq, issued) => this.onIdle(seq, issued),
            });
            const result = await this.run.result;
            if (this.failure !== undefined)
                throw this.failure;
            if (this.ended !== undefined)
                return this.ended;
            context.abortSignal?.throwIfAborted();
            // Aborted, but not by this call: the host closed the sandbox, for example while shutting down before closing the
            // Harness. That decides nothing about the script: store nothing and end with this invocation, so a later attempt
            // replays it.
            if (!result.ok && result.error.kind === "aborted" && !this.controller.signal.aborted) {
                await new Promise((resolve) => {
                    if (context.abortSignal === undefined || context.abortSignal.aborted)
                        resolve();
                    else
                        context.abortSignal.addEventListener("abort", () => resolve(), { once: true });
                });
                context.abortSignal?.throwIfAborted();
                throw new Error("The code mode sandbox was closed while the script ran");
            }
            // A replay that ends where the live run went on is a divergence (design §4.3).
            const during = result.during;
            // Within the replayed part, the first run included: a rerun without journal entries replays that much too.
            if (this.rerun && during !== undefined && during.seq <= this.replayed.length) {
                // The live run went on: it acknowledged that result, or it made a call that later results answer, which the
                // replay never made.
                const continued = (during.seq === 0
                    ? this.replayed.length > 0 || this.firstIssued !== undefined
                    : this.replayed[during.seq - 1]?.issuedAfter !== undefined) ||
                    this.replayed.slice(during.seq).some((entry) => entry.id > during.issued);
                if (continued) {
                    return this.decide(errorResult(`The script took a different path when resumed after a restart: it ended after result ${during.seq}, where it went on before.`));
                }
            }
            return this.complete(result);
        }
        finally {
            context.abortSignal?.removeEventListener("abort", onAbort);
        }
    }
    /** Store an outcome the call decided, and end the VM if it runs; returns the outcome. */
    async decide(decided) {
        const result = { ...decided, details: this.details() };
        await this.api.commit(async (tx) => {
            const run = await tx.doc(CodemodeRunDoc, this.api.taskId);
            run.result ??= copyJson(result, { omitUndefinedProperties: true });
        }, this.context);
        return result;
    }
    /** End the call with `message`: store it as the outcome, then stop the VM with an error the script cannot catch. */
    diverge(message) {
        if (this.ended !== undefined || this.failure !== undefined)
            return;
        const result = errorResult(`The script took a different path when resumed after a restart: ${message}`);
        this.ended = result;
        this.decide(result).then(() => this.controller.abort(new Error(message)), (error) => this.fail(error));
    }
    /** Whether nothing more may happen: the run has its outcome, or the call decided or failed. */
    get stopped() {
        return this.ended !== undefined || this.failure !== undefined || this.run?.finished === true;
    }
    fail(error) {
        if (this.failure !== undefined)
            return;
        this.failure = error;
        this.controller.abort(error);
    }
    /** The script's own outcome, stored with its store writes in one transaction. */
    async complete(result) {
        const details = this.details();
        const formatted = await formatResult(result, {
            generatedImages: this.generatedImages,
            wallMs: this.api.now() - this.start.startedAt,
            maxOutputTokens: this.start.maxOutputTokens,
            calls: details.calls,
            limits: OUTPUT_LIMITS,
            write: this.outputFiles(),
        });
        const tool = {
            output: formatted.content,
            isError: !result.ok,
            details: {
                ...details,
                ...(formatted.fullOutputPath === undefined ? {} : { fullOutputPath: formatted.fullOutputPath }),
            },
        };
        const writes = result.ok ? result.storeWrites : undefined;
        return this.api.commit(async (tx) => {
            const run = await tx.doc(CodemodeRunDoc, this.api.taskId);
            if (run.result !== undefined)
                return run.result;
            run.result = copyJson(tool, { omitUndefinedProperties: true });
            if (writes !== undefined && (Object.keys(writes.set).length > 0 || writes.delete.length > 0)) {
                const store = await tx.doc(CodemodeStoreDoc, this.api.conversationId);
                for (const key of writes.delete)
                    delete store.values[key];
                for (const [key, value] of Object.entries(writes.set))
                    store.values[key] = value;
            }
            return tool;
        }, this.context);
    }
    /** Writes the result's files under fixed names into the run's output directory, so a rerun overwrites them. */
    outputFiles() {
        const env = this.api.env;
        let directory;
        return async (name, data) => {
            if (env === undefined)
                return { kind: "failed", error: "no execution environment" };
            try {
                directory ??= this.outputDir(env);
                const path = `${await directory}/${name}`;
                const written = await env.writeFile(path, data, this.context);
                return written.ok ? { kind: "saved", path } : { kind: "failed", error: written.error.message };
            }
            catch (error) {
                return { kind: "failed", error: errorMessage(error) };
            }
        };
    }
    /** The run's output directory: the recorded one, else a new temp directory, recorded before any file is written. */
    async outputDir(env) {
        const recorded = await this.api.commit(async (tx) => (await tx.doc(CodemodeRunDoc, this.api.taskId)).outputDir, this.context);
        if (recorded !== undefined)
            return recorded;
        const created = await env.createTempDir("pi-codemode-", this.context);
        if (!created.ok)
            throw new Error(created.error.message);
        return this.api.commit(async (tx) => {
            const run = await tx.doc(CodemodeRunDoc, this.api.taskId);
            run.outputDir ??= created.value;
            return run.outputDir;
        }, this.context);
    }
    async checkFingerprint(fingerprint) {
        const recorded = this.start.fingerprint;
        if (recorded !== undefined) {
            if (recorded !== fingerprint) {
                this.ended = errorResult(`The script cannot resume: the sandbox changed since it started (${recorded} -> ${fingerprint}).`);
                await this.decide(this.ended).catch((error) => this.fail(error));
                this.controller.abort(new Error("Sandbox fingerprint changed"));
                return;
            }
        }
        else {
            try {
                await this.api.commit(async (tx) => {
                    const run = await tx.doc(CodemodeRunDoc, this.api.taskId);
                    if (run.start !== undefined)
                        run.start.fingerprint = fingerprint;
                }, this.context);
            }
            catch (error) {
                this.fail(error);
                return;
            }
        }
        this.openGate();
        // Nothing was delivered before the gate: start now. A rerun without a journal releases its calls at the
        // script's first acknowledgment instead.
        if (this.replaying)
            this.deliverReplayed();
        else if (!this.rerun)
            void this.release();
    }
    onCall(made) {
        if (this.stopped)
            return;
        const call = asToolCall(made);
        if (call.target === "tool")
            this.started(call);
        this.issued = Math.max(this.issued, call.id);
        const index = this.replaying ? (this.replayIndex.get(call.id) ?? -1) : -1;
        if (index === -1) {
            if (this.released) {
                this.waiting.push(call);
                this.launchCovered();
            }
            else
                this.held.push(call);
            return;
        }
        const entry = this.replayed[index];
        if (entry.global !== undefined) {
            if (call.target !== "global" || call.name !== entry.global.name || !sameJson(call.args, entry.global.args)) {
                this.diverge(`call ${call.id} is ${describe(call)}, but was a call to ${entry.global.name}`);
                return;
            }
            this.ready.set(call.id, entry.global.outcome);
            void this.gate.then(() => this.deliverReplayed());
            return;
        }
        if (call.target !== "tool") {
            this.diverge(`call ${call.id} is ${describe(call)}, but was a tool call`);
            return;
        }
        void this.gate
            .then(() => this.callTool(call))
            .then((outcome) => {
            this.ready.set(call.id, outcome);
            this.deliverReplayed();
        }, (error) => {
            if (this.stopped)
                return;
            if (this.context.abortSignal?.aborted)
                this.fail(error);
            // The key names another tool or other arguments.
            else
                this.diverge(`call ${call.id} is ${describe(call)}: ${errorMessage(error)}`);
        });
    }
    /** Replay: deliver journaled results in journal order, each once the VM has issued its call. */
    deliverReplayed() {
        while (this.nextReplayed < this.replayed.length && !this.stopped) {
            const entry = this.replayed[this.nextReplayed];
            const outcome = this.ready.get(entry.id);
            if (entry.id > this.issued || outcome === undefined)
                return;
            this.ready.delete(entry.id);
            this.nextReplayed++;
            this.run.deliver(this.nextReplayed, entry.at, entry.id, outcome);
        }
    }
    onIdle(seq, issued) {
        if (this.stopped)
            return;
        // A count an earlier attempt recorded must match; a missing one is recorded now.
        if (this.rerun && seq <= this.replayed.length) {
            const recorded = seq === 0 ? this.firstIssued : this.replayed[seq - 1].issuedAfter;
            if (recorded !== undefined && recorded !== issued) {
                this.diverge(seq === 0
                    ? `its first run made ${issued} calls, where it had made ${recorded}`
                    : `after result ${seq} it had made ${issued} calls, where it had made ${recorded}`);
                return;
            }
        }
        this.acks.set(seq, issued);
        if (!this.replaying) {
            // A rerun without a journal: every call an earlier attempt could have admitted is made by now.
            if (seq === 0 && this.rerun)
                void this.release();
            // Committed at once when the script has processed everything delivered: calls it made wait for it, and a script
            // waiting on a long call is where a restart usually finds it. Otherwise with the next commit; the VM catches up
            // without waiting on anything.
            if (seq === this.journalLength)
                void this.pump();
            return;
        }
        // Caught up: the VM processed everything delivered and waits.
        if (seq !== this.nextReplayed)
            return;
        const next = this.replayed[seq];
        if (next !== undefined) {
            if (next.id > issued)
                this.diverge(`it waits without making call ${next.id}, which it made before`);
            return;
        }
        // The last replayed result is acknowledged: continue live, admitting the calls the journal did not have once their
        // count is committed.
        this.replaying = false;
        void this.pump();
        void this.release();
    }
    /**
     * Let the held calls launch, and later live calls, each once its issued count is committed. On a rerun, an earlier
     * attempt may have admitted some of them under their keys, as other calls: when the replay releases (idle after the
     * last journaled result, or after its first run without a journal) its counts matched every recorded one, so it has
     * made every call an earlier attempt could have admitted. All held calls are checked first, whatever their target,
     * and a divergence launches none. Calls made after this are new.
     */
    async release() {
        await this.gate;
        if (this.stopped || this.released)
            return;
        const calls = this.held.splice(0);
        if (this.rerun) {
            for (const call of calls) {
                let other;
                try {
                    other = await this.earlier(call);
                }
                catch (error) {
                    this.fail(error);
                    return;
                }
                if (this.stopped)
                    return;
                if (other !== undefined) {
                    this.diverge(`call ${call.id} is ${describe(call)}, but was ${other}`);
                    return;
                }
            }
        }
        this.released = true;
        this.waiting.push(...calls, ...this.held.splice(0));
        this.launchCovered();
    }
    /** Launch the waiting calls whose issued count is committed. */
    launchCovered() {
        if (!this.released || this.stopped)
            return;
        const covered = this.waiting.filter((call) => call.id <= this.durableIssued);
        if (covered.length === 0)
            return;
        this.waiting = this.waiting.filter((call) => call.id > this.durableIssued);
        for (const call of covered)
            this.launch(call);
    }
    /** The call an earlier attempt made under this call's key, when it is another one: another target, tool, or arguments. */
    async earlier(call) {
        const { api, context } = this;
        const taskId = (await api.snapshot(NestedCallDoc, api.taskId, `c${call.id}`, context))?.taskId;
        if (taskId === undefined)
            return undefined;
        const input = (await api.getTask(taskId, context))?.input;
        if (input?.kind !== "nested")
            return undefined;
        const made = input.call;
        if (call.target === "tool" && made.name === call.name && sameJson(made.arguments, call.args ?? {}))
            return undefined;
        return `tools.${made.name}(${JSON.stringify(made.arguments)})`;
    }
    /** Run one live call and journal its result. */
    launch(call) {
        if (this.stopped)
            return;
        const running = call.target === "tool"
            ? this.callTool(call).then((outcome) => ({ outcome }))
            : this.callGlobal(call).then((outcome) => ({
                outcome,
                global: {
                    name: call.name,
                    ...(call.args === undefined ? {} : { args: call.args }),
                    outcome: outcome,
                },
            }));
        running.then((done) => {
            // A result after the outcome is decided has nowhere to go, and the call's API has ended.
            if (this.stopped)
                return;
            this.queue.push({ id: call.id, at: this.api.now(), ...done });
            void this.pump();
        }, (error) => {
            // Stopped meanwhile: the outcome is decided, or a waiting model call gave up.
            if (this.stopped)
                return;
            if (this.context.abortSignal?.aborted)
                this.fail(error);
            // A key an earlier attempt admitted with another tool or other arguments: this attempt took another path.
            else
                this.diverge(`call ${call.id} is ${describe(call)}: ${errorMessage(error)}`);
        });
    }
    async callTool(call) {
        // Passed as the script gave them; validation reports arguments that are not an object.
        const args = (call.args ?? {});
        const model = call.name.startsWith(CODEMODE_INTERNAL_PREFIX);
        if (model) {
            await this.modelSlot();
            // The call may have stopped while this one waited: a finished script admits no new paid call.
            if (this.stopped) {
                this.releaseModelSlot();
                throw new Error("The script has ended");
            }
        }
        let result;
        try {
            result = await this.api.executeTool(call.name, args, this.context, { key: `c${call.id}` });
        }
        finally {
            if (model)
                this.releaseModelSlot();
        }
        if (call.name === GENERATE_IMAGES_TOOL)
            this.generatedImages += countImages(result.structuredOutput);
        const structured = this.start.tools.find((tool) => tool.name === call.name)?.structured === true;
        const outcome = outcomeOf(call.name, structured, result);
        this.finishRow(call.id, outcome, result);
        return outcome;
    }
    /** The script made a tool call: its row appears, running, also while it waits to launch. */
    started(call) {
        if (this.rows.has(call.id))
            return;
        const args = call.args === undefined ? "" : (JSON.stringify(call.args) ?? "");
        const name = call.name.startsWith(CODEMODE_INTERNAL_PREFIX)
            ? call.name.slice(CODEMODE_INTERNAL_PREFIX.length)
            : call.name;
        this.rows.set(call.id, { id: call.id, name, args: cut(args, ARGS_PREVIEW_CHARS), status: "running" });
    }
    /** A tool call ended: its row gets its status, duration, and error. */
    /** The call ended: an error result is an error row, also when the script got its value (bash's nonzero exit). */
    finishRow(id, outcome, result) {
        const row = this.rows.get(id);
        if (row === undefined)
            return;
        row.status = result.isError ? "error" : "ok";
        if (result.durationMs !== undefined)
            row.durationMs = result.durationMs;
        const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
        const error = !outcome.ok ? outcome.message : errors.map((diagnostic) => diagnostic.message).join("\n");
        if (result.isError && error !== "")
            row.error = cut(error, ERROR_PREVIEW_CHARS);
    }
    /** The rows in call order; calls still running when the script ended were cancelled. */
    details() {
        const calls = [...this.rows.values()]
            .sort((a, b) => a.id - b.id)
            .map((row) => (row.status === "running" ? { ...row, status: "cancelled" } : row));
        return { calls };
    }
    async callGlobal(call) {
        const discovery = DISCOVERY_GLOBALS.includes(call.name);
        const catalog = CATALOG_GLOBALS.includes(call.name);
        const global = discovery || catalog ? undefined : this.options.globals?.find((candidate) => candidate.name === call.name);
        if (!discovery && !catalog && global === undefined)
            return { ok: false, message: `Unknown global ${call.name}` };
        try {
            // `undefined` stays undefined: the journal omits the value, and a replay resolves with undefined again.
            const value = discovery
                ? this.discover(call)
                : catalog
                    ? await catalogCall(call.name, call.args, this.api.models, this.context)
                    : await global.execute(call.args, this.api, this.context);
            return { ok: true, value };
        }
        catch (error) {
            if (this.context.abortSignal?.aborted)
                throw error;
            return { ok: false, message: errorMessage(error) };
        }
    }
    async modelSlot() {
        if (this.modelCalls >= MAX_CONCURRENT_MODEL_CALLS) {
            await new Promise((resolve) => this.modelWaiters.push(resolve));
        }
        this.modelCalls++;
    }
    releaseModelSlot() {
        this.modelCalls--;
        this.modelWaiters.shift()?.();
    }
    /** `searchTools()`, `describeTool()`, `describeNamespace()`: answered from the start data. */
    discover(call) {
        const args = Array.isArray(call.args) ? call.args : [];
        const { namespaces } = this.start;
        const tools = this.start.tools.filter((tool) => tool.hidden !== true);
        const namespaceOfTool = (name) => namespaces.find((namespace) => namespace.tools.includes(name));
        const matchesNamespace = (namespace, query) => namespace.name === query || toCodemodeIdentifier(namespace.name) === toCodemodeIdentifier(query);
        if (call.name === "describeTool") {
            const [name] = args;
            if (typeof name !== "string")
                throw new Error("describeTool() expects a tool name");
            return tools.find((tool) => tool.name === name || tool.jsName === name)?.description;
        }
        if (call.name === "describeNamespace") {
            const [name] = args;
            if (typeof name !== "string")
                throw new Error("describeNamespace() expects a namespace name");
            const namespace = namespaces.find((candidate) => matchesNamespace(candidate, name));
            if (namespace === undefined)
                return undefined;
            return {
                name: namespace.name,
                ...(namespace.description === undefined ? {} : { description: namespace.description }),
                ...(namespace.instructions === undefined ? {} : { instructions: namespace.instructions }),
                tools: namespace.tools.map((tool) => toCodemodeIdentifier(tool)),
            };
        }
        const [query, options] = args;
        if (typeof query !== "string")
            throw new Error("searchTools() expects a query string");
        const limit = options?.limit ?? DEFAULT_SEARCH_LIMIT;
        if (typeof limit !== "number" || !Number.isInteger(limit) || limit <= 0) {
            throw new Error("searchTools() limit must be a positive integer");
        }
        const namespace = options?.namespace;
        if (namespace !== undefined && namespace !== null && typeof namespace !== "string") {
            throw new Error("searchTools() namespace must be a string");
        }
        const documents = tools.flatMap((tool) => {
            const own = namespaceOfTool(tool.name);
            if (typeof namespace === "string" && (own === undefined || !matchesNamespace(own, namespace)))
                return [];
            const namespaceText = own === undefined ? "" : [own.name, own.description ?? "", own.instructions ?? ""].join(" ");
            // `description` is the tool's sample: its description and declaration, with the parameters' names and descriptions.
            return [{ name: tool.name, text: tool.description, namespaceText }];
        });
        return rankDocuments(query, documents, limit).map((name) => {
            const tool = tools.find((candidate) => candidate.name === name);
            return { name: tool.jsName, description: tool.description };
        });
    }
    /**
     * Journal finished calls and acknowledged counts in one commit, then deliver the calls and launch the calls the
     * counts cover; one commit in flight at a time, so what arrives meanwhile goes into the next.
     */
    async pump() {
        if (this.committing || this.stopped)
            return;
        if (this.queue.length === 0 && this.acks.size === 0)
            return;
        this.committing = true;
        const batch = this.queue.splice(0);
        const acks = [...this.acks];
        this.acks.clear();
        try {
            await this.api.commit(async (tx) => {
                const journal = await tx.doc(CodemodeJournalDoc, this.api.taskId);
                for (const [seq, issued] of acks) {
                    if (seq === 0)
                        journal.firstIssued ??= issued;
                    else {
                        const entry = journal.entries[seq - 1];
                        if (entry !== undefined && entry.issuedAfter === undefined)
                            entry.issuedAfter = issued;
                    }
                }
                for (const item of batch) {
                    const entry = {
                        id: item.id,
                        at: item.at,
                        ...(item.global === undefined ? {} : { global: item.global }),
                    };
                    journal.entries.push(copyJson(entry, { omitUndefinedProperties: true }));
                }
            }, this.context);
        }
        catch (error) {
            this.fail(error);
            return;
        }
        for (const [, issued] of acks)
            this.durableIssued = Math.max(this.durableIssued, issued);
        for (const item of batch) {
            this.journalLength++;
            if (!this.run.finished)
                this.run.deliver(this.journalLength, item.at, item.id, item.outcome);
        }
        this.launchCovered();
        this.committing = false;
        void this.pump();
    }
}
/** A script's call of `models.classify()` or `models.generateImages()` as the call of its internal tool. */
function asToolCall(call) {
    const tool = call.target === "global" ? MODEL_CALLS[call.name] : undefined;
    if (tool === undefined)
        return call;
    const [model, context] = Array.isArray(call.args) ? call.args : [];
    return { id: call.id, target: "tool", name: tool, args: { model: model ?? null, context: context ?? null } };
}
/** Image blocks in a `models.generateImages()` result. */
function countImages(value) {
    const output = typeof value === "object" && value !== null ? value.output : undefined;
    return Array.isArray(output) ? output.filter((item) => item?.type === "image").length : 0;
}
function describe(call) {
    return `${call.target === "tool" ? "tools." : ""}${call.name}(${JSON.stringify(call.args) ?? ""})`;
}
/** Structural JSON equality; key order does not matter. */
function sameJson(a, b) {
    if (a === b)
        return true;
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null)
        return false;
    if (Array.isArray(a) || Array.isArray(b)) {
        return (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameJson(item, b[i])));
    }
    const keys = Object.keys(a);
    return (keys.length === Object.keys(b).length &&
        keys.every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key])));
}
//# sourceMappingURL=codemode.js.map