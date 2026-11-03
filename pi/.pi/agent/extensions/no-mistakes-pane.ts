// Visible no-mistakes pane.
//
// `no-mistakes axi` prints machine-readable TOON on stdout and progress on
// stderr. Running it inline in the agent's bash tool hides that progress in
// tool output. This extension instead opens a Herdr pane beside the agent
// pane, runs the same axi command there, and keeps the streams useful:
//
//   pane terminal <- stdout (tee) + stderr  (the captain watches it live)
//   capture file  <- stdout                 (the agent parses the TOON)
//
// The pane is reused across one run's gate loop (`run` -> `respond` ->
// `status` ...) instead of splitting a new pane per call. The pane-open and
// focus machinery is reused from nvim-open.ts.

import { Type } from "typebox";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import {
	buildPaneScript,
	extractMarkedOutput,
	NM_PANE_LABEL,
	NM_PANE_TIMEOUT_MS,
	paneLabel,
	paneStateFromResponse,
	QUICK_SUBCOMMANDS,
	subcommandOf,
	wantsPane,
} from "./no-mistakes-pane/capture";
import { focusEditorPane, getCurrentPane, parseArgs } from "./nvim-open";

const execFileAsync = promisify(execFile);
const HERDR_TIMEOUT_MS = 5000;
const POLL_MS = 300;
/** Poll the pane's existence every N capture-file polls. */
const LIVENESS_EVERY = 10;

interface PendingRun {
	token: string;
	outFile: string;
	scriptFile: string;
	paneId: string;
}

/** Pane this session opened for no-mistakes, reused across calls. */
let runPaneId: string | null = null;
/** A dispatched call that has not finished yet (timed out or aborted). */
let pending: PendingRun | null = null;
/** Set synchronously while a call is on its way to the pane. */
let dispatching = false;

// ---------------------------------------------------------------------------
// Herdr helpers (async: polling must not block the TUI)
// ---------------------------------------------------------------------------
async function execText(
	command: string,
	args: string[],
	signal?: AbortSignal,
	timeout = HERDR_TIMEOUT_MS,
): Promise<string> {
	const { stdout } = await execFileAsync(command, args, {
		encoding: "utf8",
		maxBuffer: 1024 * 1024,
		signal,
		timeout,
	});
	return String(stdout);
}

async function herdrJson(args: string[], signal?: AbortSignal): Promise<any | null> {
	try {
		return JSON.parse(await execText("herdr", args, signal));
	} catch {
		return null;
	}
}

async function herdrOk(args: string[], signal?: AbortSignal): Promise<boolean> {
	try {
		await execText("herdr", args, signal);
		return true;
	} catch {
		return false;
	}
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) return Promise.reject(new Error("cancelled"));
	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				reject(new Error("cancelled"));
			},
			{ once: true },
		);
	});
}

function readText(path: string): string {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}

/** True while the pane still exists; false only when Herdr says it is gone. */
async function paneState(paneId: string, signal?: AbortSignal): Promise<boolean | null> {
	return paneStateFromResponse(await herdrJson(["pane", "get", paneId], signal));
}

/**
 * Return the pane to use, splitting one beside the agent pane the first time.
 * The split does NOT take focus: the pipeline runs in the background, and the
 * captain pulls focus with `/no-mistakes`.
 */
async function ensurePane(cwd: string, signal?: AbortSignal): Promise<string | null> {
	if (runPaneId) {
		// An unknown answer keeps the pane: a Herdr hiccup must not orphan a
		// healthy run and split a duplicate pane beside it.
		if ((await paneState(runPaneId, signal)) !== false) return runPaneId;
		runPaneId = null;
	}
	if (!process.env.HERDR_PANE_ID && !getCurrentPane()) return null;
	const split = await herdrJson(
		["pane", "split", "--current", "--direction", "right", "--cwd", cwd],
		signal,
	);
	const paneId = split?.result?.pane?.pane_id;
	if (!paneId) return null;
	runPaneId = paneId;
	await herdrOk(["pane", "rename", paneId, NM_PANE_LABEL], signal);
	return paneId;
}

// ---------------------------------------------------------------------------
// axi execution: visible pane, with an inline fallback
// ---------------------------------------------------------------------------
interface AxiOutcome {
	output: string;
	exitCode: number;
	/** How the call ran, for the header line the agent reads. */
	where: string;
	/** Set when the call did not reach its END marker. */
	trouble?: string;
}

function formatOutcome(outcome: AxiOutcome): string {
	const status = outcome.exitCode >= 0 ? `, exit ${outcome.exitCode}` : "";
	const header = `no-mistakes axi ${outcome.where}${status}`;
	const body = outcome.output ? outcome.output : "(no output)";
	if (!outcome.trouble) return `${header}\n${body}`;
	return `${header}\n${outcome.trouble}\n\n${body}`;
}

/** Keep the TOON stdout block intact; progress from stderr follows it. */
function joinStreams(stdout?: string, stderr?: string): string {
	const out = (stdout ?? "").trim();
	const err = (stderr ?? "").trim();
	if (!err) return out;
	return out ? `${out}\n\n[stderr]\n${err}` : `[stderr]\n${err}`;
}

/** Run axi inline. Used when Herdr is unavailable or the pane is busy. */
async function runInline(
	axiArgs: string[],
	cwd: string,
	signal: AbortSignal | undefined,
	where: string,
): Promise<AxiOutcome> {
	try {
		const { stdout, stderr } = await execFileAsync("no-mistakes", ["axi", ...axiArgs], {
			cwd,
			encoding: "utf8",
			maxBuffer: 16 * 1024 * 1024,
			timeout: NM_PANE_TIMEOUT_MS,
			signal,
		});
		return {
			output: joinStreams(stdout, stderr),
			exitCode: 0,
			where,
		};
	} catch (error) {
		if (signal?.aborted) return { output: "", exitCode: -1, where, trouble: "Cancelled." };
		const e = error as {
			stdout?: string;
			stderr?: string;
			code?: unknown;
			killed?: boolean;
			signal?: string;
			message?: string;
		};
		if (e.stdout === undefined && e.stderr === undefined) {
			throw new Error(`no-mistakes axi failed to start: ${e.message ?? String(error)}`);
		}
		if (e.killed === true && e.signal === "SIGTERM") {
			return {
				output: joinStreams(e.stdout, e.stderr),
				exitCode: -1,
				where,
				trouble:
					`Killed after the ${NM_PANE_TIMEOUT_MS / 60_000}m inline timeout; ` +
					`call status to read the run state.`,
			};
		}
		const exitCode = typeof e.code === "number" ? e.code : 1;
		return {
			output: joinStreams(e.stdout, e.stderr),
			exitCode,
			where,
		};
	}
}

/**
 * Dispatch one axi command into the visible pane and wait for its END marker.
 * Completion is read from the capture file only; the pane buffer is never
 * scraped, because it also carries echoed wrapper text and progress noise.
 */
async function runVisible(
	paneId: string,
	axiArgs: string[],
	cwd: string,
	signal: AbortSignal | undefined,
): Promise<AxiOutcome> {
	const token = randomUUID().replace(/-/g, "");
	const outFile = `${tmpdir()}/pi-nm-${token}.out`;
	const scriptFile = `${tmpdir()}/pi-nm-${token}.sh`;
	writeFileSync(scriptFile, buildPaneScript(axiArgs, token, outFile, cwd));
	const where = `in pane ${paneId}`;
	// Mark the pane busy before the first await, so a concurrent sibling call
	// cannot dispatch a second command into the same shell.
	pending = { token, outFile, scriptFile, paneId };

	await herdrOk(["pane", "rename", paneId, paneLabel(axiArgs)], signal);
	if (!(await herdrOk(["pane", "run", paneId, "bash", scriptFile], signal))) {
		clearPending();
		await herdrOk(["pane", "close", paneId], signal);
		runPaneId = null;
		return {
			output: "",
			exitCode: -1,
			where,
			trouble: `Could not start no-mistakes in pane ${paneId}. The pane may have been closed; call again to reopen it.`,
		};
	}

	const deadline = Date.now() + NM_PANE_TIMEOUT_MS;
	let ticks = 0;
	while (true) {
		const parsed = extractMarkedOutput(readText(outFile), token);
		if (parsed.complete) {
			clearPending();
			return {
				output: parsed.output ?? "",
				exitCode: parsed.exitCode ?? -1,
				where,
			};
		}
		if (signal?.aborted) {
			return {
				output: parsed.output ?? "",
				exitCode: -1,
				where,
				trouble:
					`Cancelled while no-mistakes was still running. Pane ${paneId} keeps going; ` +
					`call status to read its state, or run /no-mistakes close to stop it.`,
			};
		}
		if (Date.now() > deadline) {
			return {
				output: parsed.output ?? "",
				exitCode: -1,
				where,
				trouble:
					`Still running after ${NM_PANE_TIMEOUT_MS / 60_000}m. Pane ${paneId} keeps going. ` +
					`Call status (it runs inline while the pane is busy) or /no-mistakes to focus the pane.`,
			};
		}
		if (ticks++ % LIVENESS_EVERY === 0) {
			const state = await paneState(paneId, signal);
			if (state === false) {
				clearPending();
				runPaneId = null;
				return {
					output: parsed.output ?? "",
					exitCode: -1,
					where,
					trouble: `Pane ${paneId} was closed before no-mistakes finished, so the run was cancelled.`,
				};
			}
		}
		// A cancelled tool call must still return the partial TOON instead of
		// throwing, so the pane's state is reported rather than lost.
		await sleep(POLL_MS, signal).catch(() => undefined);
	}
}

function clearPending(): void {
	if (!pending) return;
	rmSync(pending.outFile, { force: true });
	rmSync(pending.scriptFile, { force: true });
	pending = null;
}

/**
 * Is an earlier call still holding the pane? Drops the pending record when its
 * END marker has since landed, so a timed-out call heals on the next call.
 */
function paneBusy(): boolean {
	if (dispatching) return true;
	if (!pending) return false;
	const parsed = extractMarkedOutput(readText(pending.outFile), pending.token);
	if (parsed.complete) {
		clearPending();
		return false;
	}
	return true;
}

/** Normalise the tool's `args` string into axi arguments (without `axi`). */
function toAxiArgs(raw: string): string[] {
	const parsed = parseArgs(raw.trim());
	if (parsed[0] === "no-mistakes") parsed.shift();
	if (parsed[0] === "axi") parsed.shift();
	return parsed;
}

async function runAxi(
	rawArgs: string,
	cwd: string,
	signal?: AbortSignal,
	uiAvailable = true,
): Promise<string> {
	const axiArgs = toAxiArgs(rawArgs);
	const sub = subcommandOf(axiArgs);
	const inHerdr = uiAvailable && Boolean(process.env.HERDR_PANE_ID || getCurrentPane());
	let busy = paneBusy();

	// Fast introspection, no Herdr, or a pane already owned by a live call:
	// these all stay out of the pane so a visible run is never corrupted.
	if (!wantsPane(axiArgs)) {
		const where = axiArgs.length === 0 ? "(inline: home view)" : "(inline: help)";
		const done = await runInline(axiArgs, cwd, signal, where);
		return formatOutcome(done);
	}
	if (!inHerdr) {
		const done = await runInline(axiArgs, cwd, signal, "(inline: no Herdr pane available)");
		return formatOutcome(done);
	}
	if (busy && !dispatching && pending) {
		const stale = pending;
		dispatching = true;
		try {
			if ((await paneState(stale.paneId, signal)) === false) {
				clearPending();
				runPaneId = null;
			}
		} finally {
			dispatching = false;
		}
		busy = paneBusy();
	}
	if (busy) {
		if (!QUICK_SUBCOMMANDS.has(sub)) {
			return (
				`A no-mistakes call is still running in pane ${pending?.paneId ?? runPaneId}. ` +
				`Do not start another ${sub || "call"}: wait, call status to read its state, ` +
				`or run /no-mistakes to watch it.`
			);
		}
		const done = await runInline(axiArgs, cwd, signal, "(inline: pane busy with an earlier call)");
		return formatOutcome(done);
	}

	dispatching = true;
	try {
		const paneId = await ensurePane(cwd, signal);
		if (!paneId) {
			const done = await runInline(axiArgs, cwd, signal, "(inline: Herdr pane could not be opened)");
			return formatOutcome(done);
		}
		return formatOutcome(await runVisible(paneId, axiArgs, cwd, signal));
	} finally {
		dispatching = false;
	}
}

// ---------------------------------------------------------------------------
// extension registration
// ---------------------------------------------------------------------------
const noMistakesAxiTool = defineTool({
	name: "no_mistakes_axi",
	label: "No Mistakes (visible pane)",
	description:
		"Drive no-mistakes through `no-mistakes axi` with the pipeline running in a visible Herdr pane beside the agent pane. stdout (gate, findings, outcome) comes back as TOON; stderr (live progress) streams in the pane. Use this instead of the bash tool for every no-mistakes command. Empty args show the home view inline.",
	promptSnippet: "Run no-mistakes axi in a visible Herdr pane and return its TOON result",
	promptGuidelines: [
		"Use no_mistakes_axi for every no-mistakes command: run, respond, answer, status, logs, sync, abort, handoff, retry.",
		"Pass the arguments after `axi`, for example: run --intent \"...\" or respond --action fix --findings r1.",
		"Each call returns the TOON result (gate, findings, outcome). On a gate: read the findings and respond; loop until an outcome.",
		"ask-user findings are never yours to resolve: escalate them per the no-mistakes skill. This tool changes only the invocation surface, not gate authority.",
		"The command runs in a visible Herdr pane beside the agent pane, so the captain watches the pipeline live. Do not re-run it through the bash tool.",
	],
	parameters: Type.Object({
		args: Type.String({
			description:
				"The axi arguments as one string, without the leading `axi`, for example: run --intent \"add a --json flag\" or respond --action approve. Empty shows the home view.",
		}),
	}),
	async execute(_toolCallId, params, signal, _onUpdate, ctx) {
		const cwd = ctx?.cwd ?? process.cwd();
		const uiAvailable = (ctx as { hasUI?: boolean } | undefined)?.hasUI !== false;
		const text = await runAxi(String(params.args ?? ""), cwd, signal, uiAvailable);
		return { content: [{ type: "text", text }] };
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(noMistakesAxiTool);
	pi.registerCommand("no-mistakes", {
		description: "Focus or close the visible no-mistakes run pane",
		handler: async (
			args: unknown,
			ctx: { ui?: { notify: (message: string, level: string) => void } },
		) => {
			const notify = (message: string) => ctx?.ui?.notify(message, "info");
			const action = typeof args === "string" ? args.trim() : "";
			if (!runPaneId) {
				notify("No no-mistakes pane yet. Start one with the no_mistakes_axi tool.");
				return;
			}
			if (action === "close" || action === "stop") {
				await herdrOk(["pane", "send-text", runPaneId, "\x03"]);
				await herdrOk(["pane", "close", runPaneId]);
				clearPending();
				runPaneId = null;
				notify("Closed the no-mistakes pane.");
				return;
			}
			const current =
				process.env.HERDR_PANE_ID ?? getCurrentPane()?.pane_id ?? null;
			if (current && focusEditorPane(runPaneId, current)) {
				notify(`Focused the no-mistakes pane (${runPaneId}).`);
				return;
			}
			notify(`no-mistakes pane is ${runPaneId}.`);
		},
	});
}
