import { spawn } from "node:child_process";
import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";

// ────────────────────────────────────────────────────────────────────────────
// python — a codemode-style sibling of the bash tool.
//
// The house style runs exploratory Python constantly (~3,100 `python3 - <<`
// heredocs across the session history), and every one of those renders dim
// and unhighlighted because the bash row scanner cannot know a heredoc's
// language. A structured `code` parameter dissolves that ambiguity: the
// renderer (tool-call-renderer-public.ts) highlights it with the python
// grammar, and execution gets a clean contract —
//   - `uv run python -` honors the AGENTS.md uv invariant and picks up a
//     surrounding project's dependencies via the session cwd;
//   - stdout and stderr are captured separately and capped;
//   - the abort signal and a bounded timeout kill the child (SIGTERM, then
//     SIGKILL after a grace period);
//   - details carry exitCode/stdout/stderr/durationMs so the renderer's
//     exit banner and line counts work unchanged.
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const MIN_TIMEOUT_MS = 1_000;
const KILL_GRACE_MS = 5_000;
const OUTPUT_CAP = 256 * 1024;

const PythonParams = Type.Object({
	code: Type.String({
		description:
			"Python source to execute. Runs via `uv run python -` with the session cwd, so a surrounding project's dependencies apply. print() the values you need — stdout, stderr, and the exit code come back structured.",
	}),
	timeoutMs: Type.Optional(
		Type.Number({
			description: `Execution timeout in milliseconds (default ${DEFAULT_TIMEOUT_MS / 1000}s, max ${MAX_TIMEOUT_MS / 1000}s).`,
			minimum: MIN_TIMEOUT_MS,
			maximum: MAX_TIMEOUT_MS,
		}),
	),
});

export type PythonDetails = {
	exitCode?: number;
	stdout: string;
	stderr: string;
	durationMs?: number;
	timedOut?: boolean;
	aborted?: boolean;
	truncated?: boolean;
};

type Child = ReturnType<typeof spawn>;

export default function pythonTool(pi: ExtensionAPI) {
	pi.registerTool({
		name: "python",
		label: "python",
		description:
			"Run a Python snippet for exploratory data work: parse JSON/state files, compute, munge text, inspect transcripts. Executes `uv run python -` in the session cwd and returns stdout, stderr, and the exit code. Prefer this tool over `python3 - <<` heredocs and `python3 -c` one-liners in bash.",
		promptSnippet:
			"Run Python snippets with the python tool instead of python heredocs or `python3 -c` in bash; it returns structured stdout/stderr/exit code.",
		promptGuidelines: [
			"Prefer the python tool over bash `python3 - <<` heredocs and `python3 -c` one-liners; its code parameter renders with Python syntax highlighting.",
			"One snippet per call. print() the values you need — stdout returns to you.",
			"Code runs with `uv run python -` in the session cwd, so a surrounding project's dependencies apply.",
		],
		// Honest hints for any permission extension: this executes arbitrary code.
		annotations: { readOnlyHint: false, destructiveHint: true },

		parameters: PythonParams,

		async execute(_toolCallId, params: Static<typeof PythonParams>, signal, _onUpdate, ctx) {
			const code = params.code;
			if (!code.trim()) {
				return {
					content: [{ type: "text" as const, text: "python requires a non-empty code parameter." }],
					isError: true,
					details: { stdout: "", stderr: "" } satisfies PythonDetails,
				};
			}
			const timeoutMs = Math.min(Math.max(params.timeoutMs ?? DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
			const startedAt = Date.now();
			return new Promise((resolve) => {
				let stdout = "";
				let stderr = "";
				let truncated = false;
				let timedOut = false;
				let aborted = false;
				let settled = false;
				let hardKill: ReturnType<typeof setTimeout> | undefined;
				const capture = (current: string, chunk: Buffer): string => {
					if (current.length >= OUTPUT_CAP) {
						truncated = true;
						return current;
					}
					const next = current + chunk.toString("utf8");
					if (next.length > OUTPUT_CAP) {
						truncated = true;
						return next.slice(0, OUTPUT_CAP);
					}
					return next;
				};
				let child: Child;
				try {
					child = spawn("uv", ["run", "python", "-"], {
						cwd: ctx?.cwd,
						stdio: ["pipe", "pipe", "pipe"],
					});
				} catch (error) {
					resolve({
						content: [{ type: "text" as const, text: `Could not start \`uv run python\`: ${String(error)}` }],
						isError: true,
						details: { stdout, stderr } satisfies PythonDetails,
					});
					return;
				}
				let killed = false;
				const kill = (sig: NodeJS.Signals): void => {
					if (killed || !child.pid) return;
					killed = true;
					try {
						child.kill(sig);
					} catch {
						// Already dead; the close event settles the promise.
					}
				};
				const timer = setTimeout(() => {
					timedOut = true;
					kill("SIGTERM");
					hardKill = setTimeout(() => kill("SIGKILL"), KILL_GRACE_MS);
				}, timeoutMs);
				const onAbort = (): void => {
					aborted = true;
					kill("SIGTERM");
					hardKill = setTimeout(() => kill("SIGKILL"), KILL_GRACE_MS);
				};
				signal?.addEventListener("abort", onAbort);
				const finish = (exitCode: number | undefined): void => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					if (hardKill) clearTimeout(hardKill);
					signal?.removeEventListener("abort", onAbort);
					const durationMs = Date.now() - startedAt;
					const parts: string[] = [];
					if (aborted) parts.push("Execution aborted before completion.");
					if (timedOut) parts.push(`Timed out after ${Math.round(timeoutMs / 1000)}s and was killed.`);
					if (stdout) parts.push(stdout.replace(/\n$/, ""));
					if (stderr) parts.push(`stderr:\n${stderr.replace(/\n$/, "")}`);
					if (!parts.length) parts.push("(no output)");
					resolve({
						content: [{ type: "text" as const, text: parts.join("\n") }],
						isError: aborted || timedOut || (exitCode ?? 0) !== 0,
						details: {
							exitCode,
							stdout,
							stderr,
							durationMs,
							timedOut: timedOut || undefined,
							aborted: aborted || undefined,
							truncated: truncated || undefined,
						} satisfies PythonDetails,
					});
				};
				child.stdout?.on("data", (chunk: Buffer) => {
					stdout = capture(stdout, chunk);
				});
				child.stderr?.on("data", (chunk: Buffer) => {
					stderr = capture(stderr, chunk);
				});
				child.on("error", (error) => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					if (hardKill) clearTimeout(hardKill);
					signal?.removeEventListener("abort", onAbort);
					resolve({
						content: [
							{
								type: "text" as const,
								text: `Could not run \`uv run python\`: ${error.message}. Ensure uv is installed and on PATH.`,
							},
						],
						isError: true,
						details: { stdout, stderr } satisfies PythonDetails,
					});
				});
				child.on("close", (exitCode) => finish(exitCode));
				// The child can exit before stdin accepts the script (syntax
				// errors report fast); EPIPE on stdin must not reject.
				child.stdin?.on("error", () => {});
				child.stdin?.end(code);
			});
		},
	});
}
