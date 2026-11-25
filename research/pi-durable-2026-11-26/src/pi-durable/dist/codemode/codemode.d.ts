/**
 * Durable code mode: a tool that runs model-written JavaScript in a QuickJS sandbox, whose script survives a restart.
 *
 * Problem: a script is in-memory VM state. A restart while
 *
 *     const results = await Promise.all(paths.map((path) => tools.read({ path })));
 *
 * waits for the last of 200 reads would lose the script and every read it made.
 *
 * Solution: deterministic replay (`CodemodeSandboxBase.start()` in pi-codemode). The VM only runs when the host hands
 * it a result; given the same start data, clock, seed, and results in the same order, it makes the same calls with
 * the same arguments. The tool is replay-safe: after a restart, `execute()` runs again, starts the script again from
 * the stored start data, and hands it the results it got before, in the order it got them, from a journal written
 * before each delivery. Nested tool calls reattach to their tasks by key (`c<VM call id>`), so they never run twice
 * unless their own replay policy reruns them; their results come from `NestedCallDoc`. Then the script continues live.
 *
 * Documents, scoped to the code mode call's task and gone when it settles:
 * - `pi.codemode.run`: the start data, written once before the VM starts, and the outcome, written once when the call
 *   decides it (with the store writes, in one transaction), so a rerun after that returns it without a VM.
 * - `pi.codemode.journal`: one entry per delivered result, in delivery order: the VM call ID, the clock value, the
 *   calls the VM had issued after processing it (once acknowledged), and a global's outcome, which nothing else stores.
 *
 * Each result's acknowledged call count is recorded with the next journal commit, or at once when the VM has processed
 * everything delivered: a script waiting on a long call is where a restart usually finds it. A sequential script
 * therefore costs one journal commit and one count commit per result, on top of its nested calls' own; that is the
 * price of checking the most common crash point.
 *
 * A call is launched only once the count of calls issued in the drain that made it is committed. So every key an earlier
 * attempt admitted is at most its last recorded count; a replay checks every recorded count, so when it releases its
 * calls it has made every call an earlier attempt could have admitted, and later calls are new.
 *
 * A rerun refuses to replay (no new nested calls; nested calls admitted earlier may still resume on their own and are
 * aborted by the call's cleanup) when this module's version or the VM's fingerprint changed, when the deadline passed,
 * or when the script diverges: it makes another call, or calls in another order, than the journal says. Each ends the
 * call with an error result.
 */
import type { Context } from "@earendil-works/chord/context";
import { type JsonValue } from "@earendil-works/chord/json";
import type { CodemodeSandboxBase } from "@earendil-works/pi-codemode/portable";
import { type Static } from "@earendil-works/pi-schema";
import type { Extension, ToolExecutionApi, ToolRegistration } from "../harness/types.ts";
import type { JsonObject } from "../types.ts";
/**
 * Version of everything in this module that turns stored results into what a script sees: result mapping, globals,
 * start data. Bump it when that changes, so a call started before an upgrade is not replayed by different code.
 */
export declare const CODEMODE_MODULE_VERSION = 2;
export declare const CODEMODE_TOOL_NAME = "codemode";
/** One tool as the script sees it: `tools.<jsName>`. */
/**
 * `structured`: the tool declares `structuredOutputSchema`, so an error result with a value resolves with it.
 * `hidden`: an internal tool of this extension (`pi.codemode.*`), which scripts reach only through a global such as
 * `models.classify()`; never in `tools`, `ALL_TOOLS`, or tool search.
 */
type DeclaredTool = {
    name: string;
    jsName: string;
    description: string;
    structured?: true;
    hidden?: true;
};
/** What a call starts with; a rerun starts the VM from exactly this. */
type Start = {
    version: number;
    startedAt: number;
    seed: number;
    /** The VM's fingerprint, recorded by the first run before any call is admitted. */
    fingerprint?: string;
    /** `startedAt + timeout_ms` when the script set one. */
    deadline?: number;
    tools: DeclaredTool[];
    /**
     * The namespaces the selected extensions declare (`Extension.namespace`), with their tools, as `describeNamespace()`
     * and `searchTools()` see them; a namespace without tools yet is listed too.
     */
    namespaces: {
        name: string;
        description?: string;
        instructions?: string;
        tools: string[];
    }[];
    globals: {
        name: string;
        spread: boolean;
    }[];
    /** `max_output_tokens` of the script's options line, or the default. */
    maxOutputTokens: number;
    store: Record<string, JsonValue>;
};
type RunState = {
    start?: Start;
    /** Directory of the result's files (the full output, images), created once: a rerun writes the same files again. */
    outputDir?: string;
    /** The outcome, decided once. */
    result?: JsonObject;
};
export declare const CodemodeRunDoc: import("../types.ts").TaskDocToken<RunState>;
type JournalEntry = {
    /** The VM's call ID. Its result is the entry's position + 1 (`seq`). */
    id: number;
    /** The VM clock while it processes this result. */
    at: number;
    /** Calls the VM had issued after processing this result; absent until acknowledged. */
    issuedAfter?: number;
    /** A global's call and outcome; a tool's result is its nested call's. */
    global?: {
        name: string;
        args?: JsonValue;
        outcome: JsonObject;
    };
};
type JournalState = {
    entries: JournalEntry[];
    /** Calls the VM had issued after the script's first run, before any result; absent until acknowledged. */
    firstIssued?: number;
};
export declare const CodemodeJournalDoc: import("../types.ts").TaskDocToken<JournalState>;
/**
 * What scripts keep with `store()` and read with `load()`, per conversation. Rewindable and copied as of the fork
 * point, so a fork sees the values as they were when its entry was committed.
 */
export declare const CodemodeStoreDoc: import("../types.ts").RewindableConversationDocToken<{
    values: Record<string, JsonValue>;
}>;
/** One tool call a script made, as the code mode call's details show it. */
export type CodemodeNestedCall = {
    /** The VM's number for the call; its nested call ID is `<callId>/c<id>`. */
    id: number;
    name: string;
    /** Compact JSON of the arguments, cut for display. */
    args: string;
    status: "running" | "ok" | "error" | "cancelled";
    durationMs?: number;
    /** Error text, cut for display. */
    error?: string;
};
/**
 * The code mode call's details, in its result: its tool calls in the order it made them, with their status. Calls to
 * globals are not listed. While the script runs, UIs show its nested calls from `pi.live.nestedTools`, so the list is
 * written once, with the result.
 */
export type CodemodeToolDetails = {
    calls: CodemodeNestedCall[];
    /** Temp file with the complete text output, when the output was cut to its token budget. */
    fullOutputPath?: string;
};
/** A function scripts call as a top-level global; its result is journaled. */
export type CodemodeGlobal = {
    readonly name: string;
    readonly spread?: boolean;
    execute(args: unknown, api: ToolExecutionApi, context: Context): Promise<JsonValue | undefined>;
};
declare const codemodeSchema: import("@earendil-works/pi-schema").Schema<{
    code: string;
}>;
export type CodemodeToolInput = Static<typeof codemodeSchema>;
export type CodemodeToolOptions = {
    /** Runs the scripts: `CodemodeSandbox` on Node, `RemoteCodemodeSandbox` on Cloudflare. */
    readonly sandbox: CodemodeSandboxBase;
    /** Estimated tokens the tool declarations in the `codemode` section may use. Default 3000. */
    readonly inlineBudget?: number;
    /** Give scripts `models.*`: the model catalog, classifiers, and image generation. Default true. */
    readonly models?: boolean;
    /** @internal Host functions scripts call as globals. */
    readonly globals?: readonly CodemodeGlobal[];
};
/** The code mode tool. Scripts call the conversation's callable tools as `tools.<name>(args)`. */
export declare function createCodemodeTool(options: CodemodeToolOptions): ToolRegistration<typeof codemodeSchema>;
/**
 * The `codemode` extension: the code mode tool, and the `codemode` prompt section listing the tools scripts can call.
 */
export declare function createCodemodeExtension(options: CodemodeToolOptions): Extension;
export {};
//# sourceMappingURL=codemode.d.ts.map