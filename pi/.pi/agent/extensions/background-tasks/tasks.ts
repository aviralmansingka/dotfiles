/**
 * Core background-task process management. No pi imports — safe to unit test
 * with plain node.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { constants as osConstants } from "node:os";

export const DEFAULT_BUFFER_LINES = 500;
export const MAX_LINE_LENGTH = 2000;
export const MAX_TASKS = 20;
export const DEFAULT_TAIL = 40;

const ANSI_RE = /\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;

export function stripAnsi(text: string): string {
	return text.replace(ANSI_RE, "");
}

export type OutputSource = "stdout" | "stderr";

export interface PartialOutputLine {
	lineNumber: number;
	text: string;
	source: OutputSource;
}

export interface OutputSnapshot {
	/** 1-based number of the first returned complete line (0 when empty). */
	fromLine: number;
	/** Completed-line cursor to pass to the next incremental read. */
	toLine: number;
	lines: string[];
	/** Current unterminated lines, exposed without advancing the completed-line cursor. */
	partialLines: PartialOutputLine[];
	/** Lines dropped from the buffer below the returned window. */
	truncated: boolean;
}

interface PendingOutput {
	text: string;
	truncated: boolean;
	order: number;
}

/** Line-oriented ring buffer with absolute line numbering. */
export class OutputBuffer {
	private lines: string[] = [];
	private pending = new Map<OutputSource, PendingOutput>();
	private nextPendingOrder = 0;
	totalLines = 0;

	get bufferedCount(): number {
		return this.lines.length;
	}

	constructor(private readonly maxLines = DEFAULT_BUFFER_LINES) {}

	push(chunk: string, source: OutputSource = "stdout"): void {
		const current = this.pending.get(source) ?? {
			text: "",
			truncated: false,
			order: this.nextPendingOrder++,
		};
		const parts = `${current.text}${chunk}`.split("\n");
		for (let i = 0; i < parts.length - 1; i++) {
			this.addLine(parts[i], i === 0 && current.truncated);
		}
		const remainder = parts.at(-1) ?? "";
		if (!remainder) {
			this.pending.delete(source);
			return;
		}
		const limit = MAX_LINE_LENGTH * 4;
		this.pending.set(source, {
			text: remainder.slice(-limit),
			truncated: (parts.length === 1 && current.truncated) || remainder.length > limit,
			order: parts.length > 1 ? this.nextPendingOrder++ : current.order,
		});
	}

	/** Flush any partial trailing lines (call when the streams end). */
	close(): void {
		for (const pending of [...this.pending.values()].sort((a, b) => a.order - b.order)) {
			this.addLine(pending.text, pending.truncated);
		}
		this.pending.clear();
	}

	/** Last `count` complete lines plus any current partial lines. */
	tail(count: number): OutputSnapshot {
		const lines = this.lines.slice(-count);
		return this.snapshot(lines);
	}

	/**
	 * Incremental read: all buffered complete lines numbered above `sinceLine`
	 * plus current partial lines without advancing the cursor.
	 */
	since(sinceLine: number): OutputSnapshot {
		const have = this.lines.length;
		const total = this.totalLines;
		if (have === 0) return this.snapshot([], sinceLine <= total, sinceLine);
		const oldest = total - have + 1;
		const from = Math.max(sinceLine + 1, oldest);
		if (from > total) return this.snapshot([], sinceLine <= total, sinceLine);
		return this.snapshot(this.lines.slice(from - oldest));
	}

	private snapshot(lines: string[], includePartial = true, cursorLine = 0): OutputSnapshot {
		const partialLines = includePartial
			? [...this.pending.entries()]
				.sort(([, a], [, b]) => a.order - b.order)
				.map(([source, pending], index) => ({
					lineNumber: this.totalLines + index + 1,
					text: this.formatLine(pending.text, pending.truncated),
					source,
				}))
			: [];
		if (lines.length === 0) {
			return { fromLine: 0, toLine: cursorLine, lines: [], partialLines, truncated: false };
		}
		const firstIndex = this.lines.length - lines.length;
		const fromLine = this.totalLines - this.lines.length + 1 + firstIndex;
		return {
			fromLine,
			toLine: fromLine + lines.length - 1,
			lines,
			partialLines,
			truncated: this.totalLines > this.lines.length,
		};
	}

	private addLine(raw: string, truncated = false): void {
		this.totalLines++;
		this.lines.push(this.formatLine(raw, truncated));
		if (this.lines.length > this.maxLines) this.lines.shift();
	}

	private formatLine(raw: string, truncated: boolean): string {
		const clean = stripAnsi(raw);
		if (!truncated && clean.length <= MAX_LINE_LENGTH) return clean;
		return `…${clean.slice(-(MAX_LINE_LENGTH - 1))}`;
	}
}

export type TaskState = "running" | "exited";

export interface Task {
	id: string;
	name: string;
	command: string;
	cwd: string;
	pid: number | undefined;
	startedAt: number;
	state: TaskState;
	exitCode: number | null;
	exitSignal: string | null;
	exitedAt: number | null;
	/** True once a tool result has already reported this task's exit. */
	exitReported: boolean;
	/** True when the exit stems from kill()/killAll(); the killer reports it. */
	suppressExitNotify: boolean;
	buffer: OutputBuffer;
	readonly child: ChildProcess;
}

export interface TaskSummary {
	id: string;
	name: string;
	command: string;
	cwd: string;
	pid: number | undefined;
	startedAt: number;
	state: TaskState;
	exitCode: number | null;
	exitSignal: string | null;
	exitedAt: number | null;
	totalLines: number;
	bufferedLines: number;
}

export function summarize(task: Task): TaskSummary {
	return {
		id: task.id,
		name: task.name,
		command: task.command,
		cwd: task.cwd,
		pid: task.pid,
		startedAt: task.startedAt,
		state: task.state,
		exitCode: task.exitCode,
		exitSignal: task.exitSignal,
		exitedAt: task.exitedAt,
		totalLines: task.buffer.totalLines,
		bufferedLines: task.buffer.bufferedCount,
	};
}

export interface ReadOptions {
	sinceLine?: number;
	tail?: number;
}

export interface ReadResult extends OutputSnapshot {
	task: TaskSummary;
}

export interface StartOptions {
	command: string;
	cwd?: string;
	name?: string;
}

export class TaskManagerError extends Error {}

export class TaskManager {
	private readonly tasks = new Map<string, Task>();
	private nextId = 1;

	constructor(
		private readonly options: {
			onExit?: (task: Task) => void;
			shell?: string;
			maxTasks?: number;
		} = {},
	) {}

	get shell(): string {
		return this.options.shell ?? process.env.SHELL ?? "/bin/sh";
	}

	list(): TaskSummary[] {
		return [...this.tasks.values()].map(summarize).sort((a, b) => a.startedAt - b.startedAt);
	}

	get(id: string): Task | undefined {
		return this.tasks.get(id);
	}

	start(opts: StartOptions): TaskSummary {
		const maxTasks = this.options.maxTasks ?? MAX_TASKS;
		const runningTasks = [...this.tasks.values()].filter((task) => task.state === "running").length;
		if (runningTasks >= maxTasks) {
			throw new TaskManagerError(`too many running background tasks (max ${maxTasks}); stop one first`);
		}
		const command = opts.command.trim();
		if (!command) throw new TaskManagerError("command must not be empty");
		const id = `t${this.nextId++}`;
		const name = (opts.name ?? command.split(/\s+/)[0] ?? "task").slice(0, 40);
		const cwd = opts.cwd ?? process.cwd();

		let child: ChildProcess;
		try {
			// detached makes the task its own process group so kill() can take down
			// the whole tree (sh -c "npm run dev" spawns grandchildren).
			child = spawn(this.shell, ["-c", command], {
				cwd,
				stdio: ["pipe", "pipe", "pipe"],
				detached: true,
			});
		} catch (err) {
			throw new TaskManagerError(`failed to spawn: ${(err as Error).message}`);
		}

		const task: Task = {
			id,
			name,
			command,
			cwd,
			pid: child.pid,
			startedAt: Date.now(),
			state: "running",
			exitCode: null,
			exitSignal: null,
			exitedAt: null,
			exitReported: false,
			suppressExitNotify: false,
			buffer: new OutputBuffer(),
			child,
		};
		this.tasks.set(id, task);

		child.stdout?.setEncoding("utf8");
		child.stderr?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => task.buffer.push(chunk, "stdout"));
		child.stderr?.on("data", (chunk: string) => task.buffer.push(chunk, "stderr"));
		child.stdin?.on("error", () => {});
		child.on("error", (err) => {
			task.buffer.push(`[spawn error] ${err.message}\n`);
			this.finish(task, null, null);
		});
		child.on("close", (code, signal) => {
			this.finish(task, code, signal);
		});

		return summarize(task);
	}

	async send(id: string, input: string, newline = true): Promise<TaskSummary> {
		const task = this.require(id);
		if (task.state !== "running") {
			return Promise.reject(new TaskManagerError(`task ${id} has already exited`));
		}
		if (!task.child.stdin || task.child.stdin.destroyed) {
			return Promise.reject(new TaskManagerError(`task ${id} has no writable stdin`));
		}
		return new Promise((resolve, reject) => {
			try {
				task.child.stdin!.write(newline ? `${input}\n` : input, (error) => {
					if (error) reject(new TaskManagerError(`failed to send input to task ${id}: ${error.message}`));
					else resolve(summarize(task));
				});
			} catch (error) {
				reject(new TaskManagerError(`failed to send input to task ${id}: ${(error as Error).message}`));
			}
		});
	}

	read(id: string, opts: ReadOptions = {}): ReadResult {
		const task = this.require(id);
		const snapshot =
			opts.sinceLine !== undefined ? task.buffer.since(opts.sinceLine) : task.buffer.tail(opts.tail ?? DEFAULT_TAIL);
		return { task: summarize(task), ...snapshot };
	}

	/** Wait until the task exits or the timeout elapses. Never rejects. */
	async wait(id: string, timeoutMs = 30_000): Promise<TaskSummary> {
		const task = this.require(id);
		const deadline = Date.now() + timeoutMs;
		while (task.state === "running" && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
		return summarize(task);
	}

	kill(id: string, signal: string = "SIGTERM"): TaskSummary {
		const task = this.require(id);
		const validSignal = this.validateSignal(signal);
		if (task.state === "running") {
			this.signal(task, validSignal);
			task.suppressExitNotify = true;
			if (validSignal === "SIGKILL") this.finish(task, null, "SIGKILL");
		}
		return summarize(task);
	}

	killAll(signal: string = "SIGTERM"): void {
		const validSignal = this.validateSignal(signal);
		for (const task of this.tasks.values()) {
			if (task.state === "running") {
				this.signal(task, validSignal, true);
				task.suppressExitNotify = true;
			}
		}
	}

	private validateSignal(signal: string): NodeJS.Signals {
		if (!Object.hasOwn(osConstants.signals, signal)) {
			throw new TaskManagerError(`unsupported signal ${signal}`);
		}
		return signal as NodeJS.Signals;
	}

	private signal(task: Task, signal: NodeJS.Signals, allowMissing = false): void {
		let cause: unknown;
		try {
			if (task.pid) {
				process.kill(-task.pid, signal);
				return;
			}
		} catch (error) {
			cause = error;
		}
		try {
			if (task.child.kill(signal)) return;
		} catch (error) {
			cause = error;
		}
		if (allowMissing && (cause as NodeJS.ErrnoException | undefined)?.code === "ESRCH") return;
		const detail = cause instanceof Error ? `: ${cause.message}` : "";
		throw new TaskManagerError(`failed to send ${signal} to task ${task.id}${detail}`);
	}

	private require(id: string): Task {
		const task = this.tasks.get(id);
		if (!task) throw new TaskManagerError(`unknown task ${id}; use action "list" for task ids`);
		return task;
	}

	private finish(task: Task, code: number | null, signal: string | null): void {
		if (task.state === "exited") return;
		if (!task.suppressExitNotify && task.pid) {
			try {
				process.kill(-task.pid, "SIGKILL");
			} catch {}
		}
		task.state = "exited";
		task.exitCode = code;
		task.exitSignal = signal;
		task.exitedAt = Date.now();
		task.buffer.close();
		if (!task.suppressExitNotify) this.options.onExit?.(task);
	}
}

export function formatUptime(startedAt: number, now = Date.now()): string {
	const seconds = Math.max(0, Math.round((now - startedAt) / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m${seconds % 60}s`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h${minutes % 60}m`;
}
