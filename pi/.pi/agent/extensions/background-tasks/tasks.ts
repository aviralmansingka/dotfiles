/**
 * Core background-task process management. No pi imports — safe to unit test
 * with plain node.
 */

import { spawn, type ChildProcess } from "node:child_process";

export const DEFAULT_BUFFER_LINES = 500;
export const MAX_LINE_LENGTH = 2000;
export const MAX_TASKS = 20;
export const DEFAULT_TAIL = 40;

const ANSI_RE = /\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;

export function stripAnsi(text: string): string {
	return text.replace(ANSI_RE, "");
}

export interface OutputSnapshot {
	/** 1-based number of the first returned line (0 when empty). */
	fromLine: number;
	/** 1-based number of the last returned line (0 when empty). */
	toLine: number;
	lines: string[];
	/** Lines dropped from the buffer below the returned window. */
	truncated: boolean;
}

/** Line-oriented ring buffer with absolute line numbering. */
export class OutputBuffer {
	private lines: string[] = [];
	private pending = "";
	totalLines = 0;

	get bufferedCount(): number {
		return this.lines.length;
	}

	constructor(private readonly maxLines = DEFAULT_BUFFER_LINES) {}

	push(chunk: string): void {
		this.pending += chunk;
		let idx = this.pending.indexOf("\n");
		while (idx !== -1) {
			this.addLine(this.pending.slice(0, idx));
			this.pending = this.pending.slice(idx + 1);
			idx = this.pending.indexOf("\n");
		}
		if (this.pending.length > MAX_LINE_LENGTH * 4) {
			// Pathological stream with no newlines: flush the partial line.
			this.addLine(this.pending);
			this.pending = "";
		}
	}

	/** Flush any partial trailing line (call when the stream ends). */
	close(): void {
		if (this.pending) {
			this.addLine(this.pending);
			this.pending = "";
		}
	}

	/** Last `count` lines with absolute numbering. */
	tail(count: number): OutputSnapshot {
		const lines = this.lines.slice(-count);
		return this.snapshot(lines);
	}

	/**
	 * Incremental read: all buffered lines numbered above `sinceLine`
	 * (a 1-based line number previously observed by the caller).
	 */
	since(sinceLine: number): OutputSnapshot {
		const have = this.lines.length;
		const total = this.totalLines;
		if (have === 0) return { fromLine: 0, toLine: 0, lines: [], truncated: false };
		const oldest = total - have + 1;
		const from = Math.max(sinceLine + 1, oldest);
		if (from > total) return { fromLine: 0, toLine: 0, lines: [], truncated: false };
		return this.snapshot(this.lines.slice(from - oldest));
	}

	private snapshot(lines: string[]): OutputSnapshot {
		if (lines.length === 0) return { fromLine: 0, toLine: 0, lines: [], truncated: false };
		const firstIndex = this.lines.length - lines.length;
		const fromLine = this.totalLines - this.lines.length + 1 + firstIndex;
		return {
			fromLine,
			toLine: fromLine + lines.length - 1,
			lines,
			truncated: this.totalLines > this.lines.length,
		};
	}

	private addLine(raw: string): void {
		const line = stripAnsi(raw).slice(0, MAX_LINE_LENGTH);
		this.totalLines++;
		this.lines.push(line);
		if (this.lines.length > this.maxLines) this.lines.shift();
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
		if (this.tasks.size >= (this.options.maxTasks ?? MAX_TASKS)) {
			throw new TaskManagerError(
				`too many background tasks (max ${this.options.maxTasks ?? MAX_TASKS}); kill one first`,
			);
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
		child.stdout?.on("data", (chunk: string) => task.buffer.push(chunk));
		child.stderr?.on("data", (chunk: string) => task.buffer.push(chunk));
		child.on("error", (err) => {
			task.buffer.push(`[spawn error] ${err.message}\n`);
			this.finish(task, null, null);
		});
		child.on("close", (code, signal) => {
			this.finish(task, code, signal);
		});

		return summarize(task);
	}

	send(id: string, input: string, newline = true): TaskSummary {
		const task = this.require(id);
		if (task.state !== "running") throw new TaskManagerError(`task ${id} has already exited`);
		if (!task.child.stdin || task.child.stdin.destroyed) {
			throw new TaskManagerError(`task ${id} has no writable stdin`);
		}
		task.child.stdin.write(newline ? `${input}\n` : input);
		return summarize(task);
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

	kill(id: string, signal: NodeJS.Signals = "SIGTERM"): TaskSummary {
		const task = this.require(id);
		if (task.state === "running") {
			task.suppressExitNotify = true;
			this.signal(task, signal);
			if (signal === "SIGKILL") this.finish(task, null, "SIGKILL");
		}
		return summarize(task);
	}

	killAll(signal: NodeJS.Signals = "SIGTERM"): void {
		for (const task of this.tasks.values()) {
			if (task.state === "running") {
				task.suppressExitNotify = true;
				this.signal(task, signal);
			}
		}
	}

	private signal(task: Task, signal: NodeJS.Signals): void {
		const pid = task.child.pid;
		try {
			// negative pid = the task's whole process group
			if (pid) process.kill(-pid, signal);
		} catch {
			try {
				task.child.kill(signal);
			} catch {
				// already gone
			}
		}
	}

	private require(id: string): Task {
		const task = this.tasks.get(id);
		if (!task) throw new TaskManagerError(`unknown task ${id}; use action "list" for task ids`);
		return task;
	}

	private finish(task: Task, code: number | null, signal: string | null): void {
		if (task.state === "exited") return;
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
