/**
 * Background Tasks Extension
 *
 * Lets the agent run long-running shell commands as background tasks it can
 * monitor and steer without killing them: start a task, read its captured
 * output (tail or incremental), send stdin input to a waiting/prompting
 * process, wait for exit, or kill it. When a task exits on its own, the
 * extension injects a message with the exit status so the agent is woken up
 * instead of polling.
 *
 * Also provides a `/bg` user command:
 *   /bg                  list tasks with a short output tail
 *   /bg <taskId>         show the last 20 lines of a task
 *   /bg <taskId> <text>  send text to the task's stdin
 */

import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
	MessageRenderer,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	DEFAULT_TAIL,
	formatUptime,
	summarize,
	TaskManager,
	TaskManagerError,
	TaskSummary,
	type Task,
} from "./tasks";

export const EXIT_MESSAGE_TYPE = "bg-task-exit";

const MAX_WAIT_MS = 120_000;

interface BgDetails {
	action: string;
	task?: TaskSummary;
	snapshot?: { fromLine: number; toLine: number; partialLines: number[]; truncated: boolean };
	tasks?: TaskSummary[];
	error?: string;
}

const BackgroundTaskParams = Type.Object({
	action: StringEnum(["start", "send", "read", "wait", "kill", "list"] as const, {
		description: "What to do",
	}),
	command: Type.Optional(
		Type.String({ description: "Shell command to run in the background (action: start)" }),
	),
	name: Type.Optional(
		Type.String({ description: "Short label for the task, defaults to the first word (action: start)" }),
	),
	cwd: Type.Optional(
		Type.String({ description: "Working directory for the task (action: start)" }),
	),
	taskId: Type.Optional(
		Type.String({ description: "Task id from start/list (actions: send, read, wait, kill)" }),
	),
	input: Type.Optional(
		Type.String({ description: "Text to write to the task's stdin (action: send)" }),
	),
	newline: Type.Optional(
		Type.Boolean({ description: "Append a trailing newline to input, default true (action: send)" }),
	),
	tail: Type.Optional(
		Type.Number({ description: `Trailing lines to return, default ${DEFAULT_TAIL} (action: read)` }),
	),
	sinceLine: Type.Optional(
		Type.Number({
			description:
				"1-based line number from a previous read; return only newer lines (action: read, incremental)",
		}),
	),
	timeoutMs: Type.Optional(
		Type.Number({ description: "Max time to wait for exit in ms, default 30000 (action: wait)" }),
	),
	signal: Type.Optional(
		Type.String({ description: "Kill signal, default SIGTERM (action: kill)" }),
	),
});

const TOOL_DESCRIPTION = `Run and manage long-running background shell tasks.

Decision rule: before running any shell command, estimate how long it will take. If it will run for more than a few seconds — or keep running indefinitely — it belongs here, not in bash. Examples: dev servers, watchers, long builds or test suites, package/model downloads, deployments, migrations, anything queueing for remote or GPU capacity. Also use this for commands that may prompt for input. Use the plain bash tool only for quick commands that finish in about a second (ls, rg, git status, file inspection).

The task starts without blocking the turn, its output is captured, and you can check progress, send stdin input to a waiting process, or stop it later — all without killing or restarting it.

Actions:
- start: spawn command in the background, returns the task id immediately
- read: get output — pass tail for the last N lines, or sinceLine (a line number from a previous read) for only new lines
- send: write input (e.g. answer a y/n prompt or provide REPL input) to a running task's stdin
- wait: block until the task exits or timeoutMs (max ${MAX_WAIT_MS / 1000}s) elapses
- kill: interrupt or stop a task (SIGTERM by default)
- list: all tasks with state

When a task exits on its own, a message with its exit status and output tail is delivered to you automatically — no polling needed.`;

function textResult(text: string, details: BgDetails): AgentToolResult<BgDetails> {
	return { content: [{ type: "text", text }], details };
}

function describeState(task: TaskSummary): string {
	if (task.state === "running") {
		return `running, pid ${task.pid ?? "?"}, uptime ${formatUptime(task.startedAt)}, ${task.totalLines} lines`;
	}
	const how = task.exitSignal ? `signal ${task.exitSignal}` : `code ${task.exitCode ?? "?"}`;
	return `exited (${how}) after ${formatUptime(task.startedAt, task.exitedAt ?? Date.now())}, ${task.totalLines} lines`;
}

export default function backgroundTasksExtension(pi: ExtensionAPI) {
	let ui: ExtensionContext["ui"] | undefined;
	let disposed = false;
	const exitTimers = new Set<ReturnType<typeof setTimeout>>();

	const manager = new TaskManager({
		onExit: (task) => {
			if (disposed) return;
			// Debounce so a read/wait tool result racing the exit event can claim
			// the report (exitReported) instead of waking the agent twice.
			const timer = setTimeout(() => {
				exitTimers.delete(timer);
				if (disposed || task.exitReported || task.suppressExitNotify) return;
				wakeOnExit(task);
			}, 400);
			exitTimers.add(timer);
		},
	});

	function wakeOnExit(task: Task) {
		const tail = task.buffer.tail(8).lines;
		const how = task.exitSignal ? `signal ${task.exitSignal}` : `code ${task.exitCode ?? "?"}`;
		const text =
			`Background task ${task.id} "${task.name}" (${task.command}) exited with ${how} ` +
			`after ${formatUptime(task.startedAt)}:\n` +
			(tail.length ? tail.join("\n") : "(no output)");
		if (ui) {
			ui.notify(`bg ${task.id} "${task.name}" exited (${how})`, task.exitCode === 0 ? "info" : "warning");
		}
		pi.sendMessage(
			{
				customType: EXIT_MESSAGE_TYPE,
				content: [{ type: "text", text }],
				display: true,
				details: { taskId: task.id, exitCode: task.exitCode, exitSignal: task.exitSignal },
			},
			{ triggerTurn: true },
		);
	}

	pi.on("session_start", async (_event, ctx) => {
		disposed = false;
		ui = ctx.ui;
	});

	pi.on("session_shutdown", async () => {
		disposed = true;
		for (const timer of exitTimers) clearTimeout(timer);
		exitTimers.clear();
		manager.killAll();
		ui = undefined;
	});

	type ExitDetails = { taskId: string; exitCode: number | null; exitSignal: string | null };
	pi.registerMessageRenderer<ExitDetails>(EXIT_MESSAGE_TYPE, ((message, _options, theme) => {
		const content = message.content;
		const first = Array.isArray(content) ? content[0] : content;
		const text = typeof first === "string" ? first : first?.type === "text" ? first.text : "";
		const lines = text.split("\n");
		const head = lines[0] ?? "";
		return new Text(theme.fg("warning", theme.bold(head)) + (lines.length > 1 ? "\n" + lines.slice(1).join("\n") : ""), 0, 0);
	}) as MessageRenderer<ExitDetails>);

	pi.registerTool({
		name: "background_task",
		label: "Background task",
		description: TOOL_DESCRIPTION,
		promptSnippet:
			"background_task: for shell commands expected to take more than a few seconds (or that may prompt for input) — read output, send stdin, wait, or kill by task id",
		promptGuidelines: [
			"Estimate a shell command's duration before running it: anything expected to take more than a few seconds (builds, test suites, dev servers, watchers, downloads, deployments, waits on network or GPU capacity) must run via background_task, never a blocking bash call.",
			"Reserve the bash tool for quick commands that finish in about a second — ls, rg, git status, file reads. If a bash call times out or you find yourself waiting on it, that command should have been a background_task.",
			"For commands that may prompt for input or need live monitoring, use background_task so progress can be checked and input sent without killing the process.",
		],
		parameters: BackgroundTaskParams,

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			ui = ctx.ui;
			try {
				switch (params.action) {
					case "start": {
						if (!params.command) throw new TaskManagerError("command is required for start");
						const task = manager.start({
							command: params.command,
							cwd: params.cwd ?? ctx.cwd,
							name: params.name,
						});
						return textResult(
							`Started task ${task.id} "${task.name}" (${task.command}) in ${task.cwd} — pid ${task.pid}, running in background. Use action "read" with taskId to check output.`,
							{ action: "start", task },
						);
					}
					case "send": {
						if (!params.taskId || params.input === undefined) {
							throw new TaskManagerError("taskId and input are required for send");
						}
						const task = await manager.send(params.taskId, params.input, params.newline ?? true);
						return textResult(`Sent input to task ${task.id} (${task.command}).`, {
							action: "send",
							task,
						});
					}
					case "read": {
						if (!params.taskId) throw new TaskManagerError("taskId is required for read");
						const result = manager.read(params.taskId, {
							sinceLine: params.sinceLine,
							tail: params.tail,
						});
						if (result.task.state === "exited") markReported(result.task.id);
						const numbered = result.lines
							.map((line, i) => `${String(result.fromLine + i).padStart(5)} | ${line}`)
							.join("\n");
						const partial = result.partialLines
							.map((line) => `${String(line.lineNumber).padStart(5)} | ${line.text} [${line.source} partial]`)
							.join("\n");
						const output = [numbered, partial].filter(Boolean).join("\n");
						const header = `task ${result.task.id} "${result.task.name}" (${result.task.command}) — ${describeState(result.task)}` +
							(result.truncated
								? ` (older lines dropped; ${result.task.totalLines - result.task.bufferedLines} not buffered)`
								: "");
						return {
							content: [
								{
									type: "text",
									text: output ? `${header}\noutput:\n${output}` : `${header}\n(no new output)`,
								},
							],
							details: {
								action: "read",
								task: result.task,
								snapshot: {
									fromLine: result.fromLine,
									toLine: result.toLine,
									partialLines: result.partialLines.map((line) => line.lineNumber),
									truncated: result.truncated,
								},
							} as BgDetails,
						};
					}
					case "wait": {
						if (!params.taskId) throw new TaskManagerError("taskId is required for wait");
						const timeout = Math.min(Math.max(params.timeoutMs ?? 30_000, 0), MAX_WAIT_MS);
						const aborted = new Promise<never>((_, reject) => {
							if (!signal) return;
							if (signal.aborted) reject(new Error("aborted"));
							else signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
						});
						const task = await Promise.race([manager.wait(params.taskId, timeout), aborted]);
						if (task.state === "exited") markReported(task.id);
						return textResult(
							task.state === "exited"
								? `task ${task.id} "${task.name}" ${describeState(task)}.`
								: `task ${task.id} still running after ${Math.round(timeout / 1000)}s (${describeState(task)}).`,
							{ action: "wait", task },
						);
					}
					case "kill": {
						if (!params.taskId) throw new TaskManagerError("taskId is required for kill");
						const sig = params.signal ?? "SIGTERM";
						const task = manager.kill(params.taskId, sig);
						if (task.state === "exited") markReported(task.id);
						return textResult(
							task.state === "exited"
								? `task ${task.id} "${task.name}" killed (${sig}), ${describeState(task)}.`
								: `Sent ${sig} to task ${task.id} "${task.name}"; still terminating.`,
							{ action: "kill", task },
						);
					}
					case "list": {
						const tasks = manager.list();
						return textResult(
							tasks.length
								? tasks.map((t) => `${t.id} "${t.name}" — ${describeState(t)} — ${t.command}`).join("\n")
								: "No background tasks running.",
							{ action: "list", tasks },
						);
					}
				}
			} catch (err) {
				if (signal?.aborted) throw err; // let the runtime record the cancellation
				const message = err instanceof TaskManagerError ? err.message : String(err);
				return textResult(`Error: ${message}`, { action: String(params.action), error: message });
			}

			function markReported(id: string) {
				const task = manager.get(id);
				if (task) task.exitReported = true;
			}
		},

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("bg ")) + theme.fg("muted", args.action);
			if (args.action === "start" && args.command) text += ` ${theme.fg("dim", `"${args.command}"`)}`;
			if (args.taskId) text += ` ${theme.fg("accent", args.taskId)}`;
			if (args.action === "send" && args.input !== undefined) {
				text += ` ${theme.fg("dim", JSON.stringify(args.input))}`;
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as BgDetails | undefined;
			const first = result.content[0];
			const text = first?.type === "text" ? first.text : "";
			if (!details || details.error) {
				return new Text(theme.fg(details?.error ? "error" : "muted", text), 0, 0);
			}
			const lines = text.split("\n");
			const head = lines[0] ?? "";
			if (!expanded) {
				return new Text(truncateToWidth(theme.fg("muted", head), 120), 0, 0);
			}
			return new Text(theme.fg("muted", lines.join("\n")), 0, 0);
		},
	});

	// User command: /bg [taskId [input...]]
	pi.registerCommand("bg", {
		description: "Inspect background tasks: list, tail a task, or send stdin",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			if (parts.length === 0) {
				const tasks = manager.list();
				if (tasks.length === 0) {
					ctx.ui.notify("No background tasks", "info");
					return;
				}
				const body = tasks
					.map((t) => {
						const snapshot = manager.read(t.id, { tail: 3 });
						const tail = [
							...snapshot.lines,
							...snapshot.partialLines.map((line) => `${line.text} [${line.source} partial]`),
						].map((line) => `    ${line}`).join("\n");
						return `  ${t.id} "${t.name}" — ${describeState(t)}\n    ${t.command}${tail ? `\n${tail}` : ""}`;
					})
					.join("\n");
				ctx.ui.notify(`Background tasks:\n${body}`, "info");
				return;
			}
			const id = parts[0];
			const task = manager.get(id);
			if (!task) {
				ctx.ui.notify(`No such task ${id}`, "error");
				return;
			}
			if (parts.length === 1) {
				const snapshot = manager.read(id, { tail: 20 });
				const body = [
					...snapshot.lines,
					...snapshot.partialLines.map((line) => `${line.text} [${line.source} partial]`),
				].join("\n") || "(no output)";
				ctx.ui.notify(
					`task ${task.id} "${task.name}" — ${describeState(summarize(task))}\n${body}`,
					"info",
				);
				return;
			}
			const input = args.trim().slice(id.length).trim();
			try {
				await manager.send(id, input, true);
				ctx.ui.notify(`Sent to ${id}: ${input}`, "info");
			} catch (err) {
				ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
			}
		},
	});
}
