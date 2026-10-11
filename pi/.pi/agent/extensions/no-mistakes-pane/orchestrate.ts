// Orchestrator delegation — the tuicr-review architecture applied to
// no-mistakes runs.
//
// A run started from a Herdr-hosted captain session is not driven by the
// captain. The no_mistakes_axi tool spawns the bundled `nm-orchestrator`
// subagent (a visible, labeled tab of the captain's workspace) through
// interactive-subagents' shared spawn global — no model turn in between,
// exactly how the tuicr extension starts its `tuicr-review` agent.
//
// The orchestrator session then owns EVERY no-mistakes surface for that
// run, because the same extensions load inside it (normal discovery) and
// all their state is per-process:
//   - it submits `axi run` itself, so the axi watcher, result steers, and
//     bounded-hold reattach loops live in its session, not the captain's;
//   - the `no-mistakes attach` pane splits from ITS pane, inside its tab;
//   - gate panels open in ITS session — the human decides there;
//   - the interactive bridge (step-agent tabs) is claimed by ITS process,
//     so every no-mistakes step agent is hosted from the orchestrator;
//   - pane-state labels (`nm: <phase>`, CI red) report on ITS pane.
//
// The captain keeps only the delegation ack, read-only `status`/`logs`
// calls, and the orchestrator's completion steer: when the run reaches a
// terminal outcome the orchestrator writes the run summary as its final
// message and auto-exits (the pane extension suppresses auto-exit while a
// run is active — the same keep-open hook the tuicr watcher uses), and the
// subagent machinery steers that summary back to the captain.
//
// Delegation never nests: inside a subagent session (PI_SUBAGENT_NAME set)
// the tool executes axi directly — that is how the orchestrator itself
// drives the run. Without a TUI, without interactive-subagents, or when the
// spawn fails, the tool also falls back to today's direct driving, so
// headless hosts and non-Herdr contexts are unchanged.

/** Spawn/liveness surface interactive-subagents exposes on globalThis. */
export interface OrchestratorSpawnApi {
	executeSubagent(
		params: { agent: string; name: string; task: string; cwd?: string },
		ctx: unknown,
	): Promise<{
		content?: Array<{ type: string; text?: string }>;
		details?: { name?: string; error?: string };
		isError?: boolean;
	}>;
	isSubagentRunning(name: string): boolean;
}

export const ORCHESTRATOR_AGENT = "nm-orchestrator";
export const ORCHESTRATOR_SPAWN_NAME = "nm-orchestrator";

export type OrchestratorDecision =
	| { delegate: false; reason: "not-run-subcommand" | "help-call" | "inside-subagent" | "no-spawn-api" | "no-tui" }
	| { delegate: false; reason: "already-owned"; owner: string }
	| { delegate: true };

/** Should this axi call be delegated to the nm-orchestrator subagent?
 *  Pure: every ambient fact is passed in, so tests pin the policy. An
 *  existing registry entry counts as ownership only while its subagent is
 *  still running — a dead entry is replaced by the next run. */
export function orchestratorDelegationDecision(input: {
	subcommand: string;
	/** True when the call is `run --help` / `-h` — documentation, not a run. */
	helpOnly: boolean;
	/** True when PI_SUBAGENT_NAME is set — this session is itself a subagent. */
	insideSubagent: boolean;
	/** True when interactive-subagents' spawn global is available. */
	hasSpawnApi: boolean;
	/** True in an interactive TUI session (panels and tabs exist). */
	hasTui: boolean;
	/** Resolved call cwd. */
	cwd: string;
	/** Live orchestrator registry: resolved cwd → spawn name. */
	orchestrators: Map<string, string>;
	/** Liveness probe over interactive-subagents' running registry. */
	isRunning: (name: string) => boolean;
}): OrchestratorDecision {
	if (input.subcommand !== "run") return { delegate: false, reason: "not-run-subcommand" };
	if (input.helpOnly) return { delegate: false, reason: "help-call" };
	if (input.insideSubagent) return { delegate: false, reason: "inside-subagent" };
	if (!input.hasSpawnApi) return { delegate: false, reason: "no-spawn-api" };
	if (!input.hasTui) return { delegate: false, reason: "no-tui" };
	const owner = input.orchestrators.get(input.cwd);
	if (owner && input.isRunning(owner)) return { delegate: false, reason: "already-owned", owner };
	return { delegate: true };
}

/** Ack shown to the captain after a successful delegation. */
export function orchestratorAckMessage(name: string): string {
	return [
		`no-mistakes axi run delegated to the ${ORCHESTRATOR_AGENT} subagent ("${name}"; Herdr tab "subagent: ${name}").`,
		"It owns the run end to end: the attach pane, gate panels, and every step-agent tab live in its session — watch or steer that tab for gates and findings.",
		"Its final summary steers back here when the run completes. Do not re-issue run while it is active; status and logs stay available here for inspection.",
	].join(" ");
}

/** Refusal shown when a driving subcommand would double-drive an owned run. */
export function orchestratorOwnedMessage(owner: string, subcommand: string): string {
	return [
		`This run is owned by the ${ORCHESTRATOR_AGENT} subagent ("${owner}") — gates are decided in its session, and ${subcommand} from here would double-drive it.`,
		`Steer it instead: subagent_message({ name: "${owner}", message: "..." }).`,
		"Read-only inspection (status, logs) stays available here; abort remains allowed here as the escape hatch.",
	].join(" ");
}

/** Pointer shown for /no-mistakes (and its yolo form) while a run is owned. */
export function orchestratorSurfaceMessage(owner: string, yolo: boolean): string {
	if (yolo) {
		return [
			`This run is owned by the ${ORCHESTRATOR_AGENT} subagent ("${owner}"). Standing consent lives in its session — focus its tab and run /no-mistakes yolo there.`,
		].join(" ");
	}
	return [
		`This run is owned by the ${ORCHESTRATOR_AGENT} subagent ("${owner}") — the attach pane, gate panels, and step-agent tabs live in its tab. Focus "subagent: ${owner}" to watch or steer it.`,
	].join(" ");
}

/** The task handed to the orchestrator subagent. Self-contained: its model
 *  sees only this, its identity, and the results that steer back. */
export function buildOrchestratorTask(input: { args: string; cwd: string }): string {
	return [
		`Orchestrate one no-mistakes validation run for this repository, end to end: ${input.cwd}`,
		"",
		"1. Submit the run now through the no_mistakes_axi tool with exactly these args (verbatim, including --intent):",
		`   ${input.args}`,
		"   If the result says a run is already active on this branch, adopt it instead: poll no_mistakes_axi `status` until a gate or terminal outcome appears, then continue as below.",
		"2. Every result steers back to you as a no_mistakes_axi_result message. Read every one.",
		"3. Gates park the run. The user decides in THIS session's gate panel and the decision arrives attached to the result — submit the exact respond call the GATE DECISION block names. A gate result with no decision means no panel could open: relay its ask-user findings verbatim in your reply and wait; never resolve them yourself.",
		"4. Yolo: when a result says standing consent is active (or the user chose yolo), submit no_mistakes_axi `respond --yes` at this and every later gate without asking.",
		"5. A `wait ... elapsed` error is not a failure — the run keeps going. Reattach by submitting no_mistakes_axi `run --wait 27m` and keep driving.",
		"6. Never edit code, never commit, never fix findings yourself — the pipeline owns findings and fixes. Never start a second run and never drive another worktree's run.",
		"7. When an `outcome:` result arrives, write the run summary as your final reply: what was validated, every fix the pipeline applied, the branch and PR state, and any follow-up for the user. Then stop — the launching session receives your summary automatically and this session closes itself.",
		"",
		"The session parks while the run is active; results steer in on their own. Never poll in a loop (except the adoption case in step 1).",
	].join("\n");
}
