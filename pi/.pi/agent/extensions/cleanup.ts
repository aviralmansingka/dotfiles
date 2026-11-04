/**
 * `/cleanup` — tear down this worktree's session after its work ships.
 *
 * Deletes, in order:
 *   1. the configured upstream branch, when one exists
 *   2. the current linked Git worktree
 *   3. the local branch (`git branch -D`, run from the main checkout)
 * then closes the pi session gracefully via `ctx.shutdown()`.
 *
 * Refuses to run on the main checkout, on `main`/`master`, or outside a listed
 * linked worktree or a sub-agent session. A confirm dialog lists the exact
 * targets plus local-file and upstream-ahead warnings. The destructive steps
 * are best-effort and idempotent: an already-deleted remote branch, an already
 * removed worktree, or an already deleted local branch counts as done, and any
 * other git failure is reported without stopping the remaining steps. The
 * session always closes once the pre-flight checks pass.
 */
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const GIT_TIMEOUT_MS = 30_000;
const PROTECTED_BRANCHES = new Set(["main", "master"]);

// --- git helpers -------------------------------------------------------------

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		timeout: GIT_TIMEOUT_MS,
		stdio: ["pipe", "pipe", "pipe"],
	}).trim();
}

function localRemotePath(cwd: string, url: string): string | null {
	if (url.startsWith("file://")) return fileURLToPath(url);
	if (/^[^/]+:/.test(url)) return null;
	return resolve(cwd, url);
}

export interface WorktreeEntry {
	path: string;
	branch?: string;
	head?: string;
	bare?: boolean;
	detached?: boolean;
}

export function parseWorktreeList(porcelain: string): WorktreeEntry[] {
	const entries: WorktreeEntry[] = [];
	let current: WorktreeEntry | null = null;
	for (const line of porcelain.split("\n")) {
		if (line.startsWith("worktree ")) {
			current = { path: line.slice("worktree ".length).trim() };
			entries.push(current);
		} else if (current && line.startsWith("HEAD ")) {
			current.head = line.slice("HEAD ".length).trim();
		} else if (current && line.startsWith("branch ")) {
			current.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
		} else if (current && line.startsWith("bare")) {
			current.bare = true;
		} else if (current && line.startsWith("detached")) {
			current.detached = true;
		}
	}
	return entries;
}

// --- cleanup facts -------------------------------------------------------------

export interface CleanupFacts {
	worktreePath: string;
	mainPath: string;
	branch: string;
	/** Configured upstream remote, or null when no upstream exists. */
	remote: string | null;
	/** Branch name on the upstream remote, or null when no upstream exists. */
	remoteBranch: string | null;
	/** Local file count reported by Git, including ignored files. */
	dirtyCount: number;
	/** Commits on HEAD not on the upstream, or null without an upstream. */
	aheadCount: number | null;
	/** The configured upstream ref no longer exists (deleted and pruned remotely). */
	upstreamGone: boolean;
}

export type CleanupFactsResult =
	| { ok: true; facts: CleanupFacts }
	| { ok: false; reason: string };

export function collectCleanupFacts(
	cwd: string,
	runGit: (cwd: string, args: string[]) => string = git,
): CleanupFactsResult {
	let worktreePath: string;
	let porcelain: string;
	try {
		worktreePath = realpathSync(runGit(cwd, ["rev-parse", "--show-toplevel"]));
		porcelain = runGit(worktreePath, ["worktree", "list", "--porcelain"]);
	} catch {
		return { ok: false, reason: "Not inside a valid Git worktree." };
	}

	const entries = parseWorktreeList(porcelain);
	const currentEntry = entries.find((entry) => {
		try {
			return realpathSync(entry.path) === worktreePath;
		} catch {
			return false;
		}
	});
	if (!currentEntry) {
		return { ok: false, reason: "The current directory is not a listed Git worktree." };
	}

	const mainEntry = entries[0];
	if (!mainEntry || mainEntry.bare) {
		return { ok: false, reason: "No main checkout found for this repository." };
	}

	let mainPath: string;
	try {
		mainPath = realpathSync(mainEntry.path);
	} catch {
		return { ok: false, reason: "The main checkout path is not available." };
	}
	if (mainPath === worktreePath) {
		return {
			ok: false,
			reason: "This is the main checkout, not a worktree. Nothing to clean up.",
		};
	}

	let branch: string;
	try {
		branch = runGit(worktreePath, ["branch", "--show-current"]);
	} catch {
		return { ok: false, reason: "Could not read the current branch; refusing to clean up." };
	}
	if (!branch) {
		return { ok: false, reason: "Detached HEAD or empty branch name; refusing to clean up." };
	}
	if (PROTECTED_BRANCHES.has(branch)) {
		return { ok: false, reason: `Refusing to delete protected branch "${branch}".` };
	}

	let upstreamRaw: string;
	try {
		upstreamRaw = runGit(worktreePath, [
			"for-each-ref",
			"--format=%(upstream)%00%(upstream:remotename)%00%(upstream:remoteref)",
			`refs/heads/${branch}`,
		]);
	} catch {
		return { ok: false, reason: "Could not read the upstream branch; refusing to clean up." };
	}
	const [upstreamRef = "", remoteValue = "", remoteRef = "", ...extra] = upstreamRaw.split("\0");
	if (extra.length > 0 || (!upstreamRef && (remoteValue || remoteRef))) {
		return { ok: false, reason: "The upstream branch data is invalid; refusing to clean up." };
	}
	if (upstreamRef && (!remoteValue || !remoteRef.startsWith("refs/heads/"))) {
		return { ok: false, reason: "The upstream branch data is invalid; refusing to clean up." };
	}
	const remote = upstreamRef ? remoteValue : null;
	const remoteBranch = upstreamRef ? remoteRef.slice("refs/heads/".length) : null;
	if (remoteBranch && PROTECTED_BRANCHES.has(remoteBranch)) {
		return { ok: false, reason: `Refusing to delete protected remote branch "${remoteBranch}".` };
	}
	if (remote) {
		try {
			const remoteUrls = runGit(worktreePath, ["remote", "get-url", "--push", "--all", remote])
				.split("\n")
				.filter(Boolean);
			if (remoteUrls.length === 0) throw new Error("missing push URL");
			const localCommonDir = realpathSync(
				runGit(worktreePath, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
			);
			for (const remoteUrl of remoteUrls) {
				const remotePath = localRemotePath(worktreePath, remoteUrl);
				if (!remotePath) continue;
				const remoteCommonDir = realpathSync(
					runGit(remotePath, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
				);
				if (localCommonDir === remoteCommonDir) {
					return { ok: false, reason: "The upstream remote points to this repository; refusing to clean up." };
				}
			}
		} catch {
			return { ok: false, reason: "Could not validate the upstream remote; refusing to clean up." };
		}
	}

	let status: string;
	try {
		status = runGit(worktreePath, ["status", "--porcelain", "--ignored"]);
	} catch {
		return { ok: false, reason: "Could not read worktree status; refusing to clean up." };
	}
	const dirtyCount = status.split("\n").filter((line) => line.trim() !== "").length;

	let aheadCount: number | null = null;
	let upstreamGone = false;
	if (upstreamRef) {
		let aheadRaw: string | null = null;
		try {
			aheadRaw = runGit(worktreePath, ["rev-list", "--count", `${upstreamRef}..HEAD`]);
		} catch {
			// The upstream ref is configured but no longer exists locally, which is
			// what a remotely deleted (and pruned) branch looks like. Nothing to
			// compare against, and nothing fatal: continue with local teardown.
			upstreamGone = true;
		}
		if (aheadRaw !== null) {
			if (!/^\d+$/.test(aheadRaw)) {
				return { ok: false, reason: "The upstream comparison is invalid; refusing to clean up." };
			}
			aheadCount = Number(aheadRaw);
		}
	}

	return {
		ok: true,
		facts: {
			worktreePath,
			mainPath,
			branch,
			remote,
			remoteBranch,
			dirtyCount,
			aheadCount,
			upstreamGone,
		},
	};
}

// --- confirm message -----------------------------------------------------------

export function buildConfirmMessage(facts: CleanupFacts): string {
	const lines = [
		`Worktree:  ${facts.worktreePath}`,
		`Branch:    ${facts.branch}`,
		facts.remote && facts.remoteBranch
			? `Remote:    ${facts.remote} branch ${facts.remoteBranch}`
			: "Remote:    none (local only, never pushed)",
	];
	if (facts.upstreamGone) {
		lines.push("Note:      Remote branch is already gone; local teardown only.");
	}
	if (facts.dirtyCount > 0) {
		lines.push(`Warning:   ${facts.dirtyCount} uncommitted file(s) — discarded with the worktree.`);
	}
	if (facts.aheadCount !== null && facts.aheadCount > 0) {
		lines.push(`Warning:   ${facts.aheadCount} commit(s) not on ${facts.remote}/${facts.remoteBranch}.`);
	}
	lines.push("", "The pi session closes after cleanup.");
	return lines.join("\n");
}

// --- execution ---------------------------------------------------------------

export interface StepResult {
	/** The step completed, or there was nothing left for it to do. */
	ok: boolean;
	/** Git reported the target as already absent (deleted/pruned/not registered). */
	already: boolean;
	/** Real failure message, when `ok` is false. */
	error?: string;
}

export interface CleanupStepReport {
	remoteDeleted: boolean;
	worktreeRemoved: boolean;
	localBranchDeleted: boolean;
	steps: { remote: StepResult; worktree: StepResult; branch: StepResult };
}

/** Git error messages that mean "the thing you asked to delete is not there". */
const ALREADY_GONE: Record<keyof CleanupStepReport["steps"], RegExp[]> = {
	remote: [/remote ref does not exist/i, /unable to delete/i, /does not match any/i],
	worktree: [/is not a working tree/i, /not registered/i],
	branch: [/branch .* not found/i, /no branch named/i, /branch .* does not exist/i],
};

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function attemptStep(
	run: (cwd: string, args: string[]) => void,
	cwd: string,
	args: string[],
	gonePatterns: RegExp[],
): StepResult {
	try {
		run(cwd, args);
		return { ok: true, already: false };
	} catch (error) {
		const message = errorMessage(error);
		if (gonePatterns.some((pattern) => pattern.test(message))) {
			return { ok: true, already: true };
		}
		return { ok: false, already: false, error: message };
	}
}

/** Run the destructive steps. Exposed for tests with injected git runners. */
export function executeCleanup(
	facts: CleanupFacts,
	run: (cwd: string, args: string[]) => void,
): CleanupStepReport {
	const hasRemote = Boolean(facts.remote && facts.remoteBranch);
	const report: CleanupStepReport = {
		remoteDeleted: false,
		worktreeRemoved: false,
		localBranchDeleted: false,
		steps: {
			remote: { ok: true, already: false },
			worktree: { ok: true, already: false },
			branch: { ok: true, already: false },
		},
	};

	// 1. Remote branch — from the still-existing worktree.
	if (hasRemote) {
		report.steps.remote = attemptStep(
			run,
			facts.worktreePath,
			["push", facts.remote as string, "--delete", facts.remoteBranch as string],
			ALREADY_GONE.remote,
		);
		report.remoteDeleted = report.steps.remote.ok;
	}

	// 2. Worktree — driven from the main checkout so it survives its own removal.
	report.steps.worktree = attemptStep(
		run,
		facts.mainPath,
		["worktree", "remove", ...(facts.dirtyCount > 0 ? ["--force"] : []), facts.worktreePath],
		ALREADY_GONE.worktree,
	);
	report.worktreeRemoved = report.steps.worktree.ok;

	// 3. Local branch — only deletable once no worktree has it checked out.
	report.steps.branch = attemptStep(
		run,
		facts.mainPath,
		["branch", "-D", facts.branch],
		ALREADY_GONE.branch,
	);
	report.localBranchDeleted = report.steps.branch.ok;

	return report;
}

/** One notification line summarising what happened, including notes and errors. */
export function describeCleanupReport(report: CleanupStepReport): string {
	const done = [
		report.remoteDeleted ? "remote branch" : null,
		report.worktreeRemoved ? "worktree" : null,
		report.localBranchDeleted ? "local branch" : null,
	]
		.filter(Boolean)
		.join(", ");
	const notes: string[] = [];
	for (const [label, step] of [
		["remote branch", report.steps.remote],
		["worktree", report.steps.worktree],
		["local branch", report.steps.branch],
	] as const) {
		if (step.already) notes.push(`${label} was already gone`);
		else if (!step.ok) notes.push(`${label} failed: ${step.error}`);
	}
	const base = done ? `Cleanup done: ${done}.` : "Cleanup: nothing left to delete.";
	return notes.length > 0 ? `${base} ${notes.join("; ")}.` : base;
}

// --- extension ----------------------------------------------------------------

const SHUTDOWN_DELAY_MS = 750;

export default function (pi: ExtensionAPI) {
	pi.registerCommand("cleanup", {
		description: "Delete this worktree, its local and remote branch, then close the session",
		handler: async (_args, ctx) => {
			if (process.env.PI_SUBAGENT_SESSION !== undefined) {
				ctx.ui.notify("Cleanup is only available in the durable parent session.", "error");
				return;
			}

			const result = collectCleanupFacts(ctx.cwd);
			if (!result.ok) {
				ctx.ui.notify(result.reason, "error");
				return;
			}
			const facts = result.facts;

			const confirmed = await ctx.ui.confirm(
				"Delete worktree and branches?",
				buildConfirmMessage(facts),
			);
			if (!confirmed) {
				ctx.ui.notify("Cleanup cancelled.", "info");
				return;
			}

			try {
				const report = executeCleanup(facts, (cwd, args) => {
					git(cwd, args);
				});
				const failed =
					!report.steps.remote.ok || !report.steps.worktree.ok || !report.steps.branch.ok;
				ctx.ui.notify(describeCleanupReport(report), failed ? "warning" : "info");
			} catch (error) {
				// The steps are individually guarded, so this is unexpected — but the
				// owner wants the session dead either way.
				ctx.ui.notify(`Cleanup failed: ${errorMessage(error)}`, "error");
			}

			ctx.ui.notify("Closing session.", "info");

			// Give the notification a moment on screen before the TUI exits.
			setTimeout(() => ctx.shutdown(), SHUTDOWN_DELAY_MS);
		},
	});
}
