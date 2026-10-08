/**
 * `/cleanup` — tear down this worktree's session after its work ships.
 *
 * Deletes, in order:
 *   1. the remote branch (`git push <remote> --delete <branch>`)
 *   2. the Git worktree at the session cwd
 *   3. the local branch (`git branch -D`, run from the main checkout)
 * then closes the pi session gracefully via `ctx.shutdown()`.
 *
 * Refuses to run on the main checkout, on `main`/`master`, or when the cwd is
 * not a linked worktree root. A confirm dialog lists the exact targets plus
 * dirty-file and unpushed-commit warnings; any failed git step aborts the
 * remaining steps before shutdown so nothing is half-deleted.
 */
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
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

function tryGit(cwd: string, args: string[]): string | null {
	try {
		return git(cwd, args);
	} catch {
		return null;
	}
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
	/** Tracking ref like "origin/fix-x", or null when the branch was never pushed. */
	upstream: string | null;
	/** Remote name parsed from `upstream`, or null. */
	remote: string | null;
	/** Uncommitted file count in the worktree. */
	dirtyCount: number;
	/** Commits on HEAD not on the upstream, or null without an upstream. */
	aheadCount: number | null;
}

export type CleanupFactsResult =
	| { ok: true; facts: CleanupFacts }
	| { ok: false; reason: string };

export function collectCleanupFacts(cwd: string): CleanupFactsResult {
	const worktreePath = realpathSync(cwd);

	let porcelain: string;
	try {
		porcelain = git(cwd, ["worktree", "list", "--porcelain"]);
	} catch {
		return { ok: false, reason: "Not inside a Git repository." };
	}

	const entries = parseWorktreeList(porcelain);
	const mainEntry = entries.find((entry) => !entry.bare);
	if (!mainEntry) {
		return { ok: false, reason: "No main checkout found for this repository." };
	}
	if (realpathSync(mainEntry.path) === worktreePath) {
		return {
			ok: false,
			reason: "This is the main checkout, not a worktree. Nothing to clean up.",
		};
	}

	const branch = tryGit(cwd, ["branch", "--show-current"]);
	if (!branch) {
		return { ok: false, reason: "Detached HEAD or empty branch name; refusing to clean up." };
	}
	if (PROTECTED_BRANCHES.has(branch)) {
		return { ok: false, reason: `Refusing to delete protected branch "${branch}".` };
	}

	const upstream = tryGit(cwd, ["rev-parse", "--abbrev-ref", "@{u}"]);
	const remote = upstream ? upstream.split("/")[0] || null : null;

	const status = tryGit(cwd, ["status", "--porcelain"]) ?? "";
	const dirtyCount = status.split("\n").filter((line) => line.trim() !== "").length;

	const aheadRaw = upstream ? tryGit(cwd, ["rev-list", "--count", `${upstream}..HEAD`]) : null;
	const aheadCount = aheadRaw !== null && /^\d+$/.test(aheadRaw) ? Number(aheadRaw) : null;

	return {
		ok: true,
		facts: {
			worktreePath,
			mainPath: realpathSync(mainEntry.path),
			branch,
			upstream,
			remote,
			dirtyCount,
			aheadCount,
		},
	};
}

// --- confirm message -----------------------------------------------------------

export function buildConfirmMessage(facts: CleanupFacts): string {
	const lines = [
		`Worktree:  ${facts.worktreePath}`,
		`Branch:    ${facts.branch}` +
			(facts.upstream ? ` (local + ${facts.upstream})` : " (local only, never pushed)"),
	];
	if (facts.dirtyCount > 0) {
		lines.push(`Warning:   ${facts.dirtyCount} uncommitted file(s) — discarded with the worktree.`);
	}
	if (facts.aheadCount !== null && facts.aheadCount > 0) {
		lines.push(`Warning:   ${facts.aheadCount} commit(s) not on ${facts.upstream} — the remote branch is still deleted.`);
	}
	lines.push("", "The pi session closes after cleanup.");
	return lines.join("\n");
}

// --- execution ---------------------------------------------------------------

export interface CleanupStepReport {
	remoteDeleted: boolean;
	worktreeRemoved: boolean;
	localBranchDeleted: boolean;
}

/** Run the destructive steps. Exposed for tests with injected git runners. */
export function executeCleanup(
	facts: CleanupFacts,
	run: (cwd: string, args: string[]) => void,
): CleanupStepReport {
	const report: CleanupStepReport = {
		remoteDeleted: false,
		worktreeRemoved: false,
		localBranchDeleted: false,
	};

	// 1. Remote branch — from the still-existing worktree.
	if (facts.upstream && facts.remote) {
		run(facts.worktreePath, ["push", facts.remote, "--delete", facts.branch]);
		report.remoteDeleted = true;
	}

	// 2. Worktree — driven from the main checkout so it survives its own removal.
	run(facts.mainPath, [
		"worktree",
		"remove",
		...(facts.dirtyCount > 0 ? ["--force"] : []),
		facts.worktreePath,
	]);
	report.worktreeRemoved = true;

	// 3. Local branch — only deletable once no worktree has it checked out.
	run(facts.mainPath, ["branch", "-D", facts.branch]);
	report.localBranchDeleted = true;

	return report;
}

// --- extension ----------------------------------------------------------------

const SHUTDOWN_DELAY_MS = 750;

export default function (pi: ExtensionAPI) {
	pi.registerCommand("cleanup", {
		description: "Delete this worktree, its local and remote branch, then close the session",
		handler: async (_args, ctx) => {
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

			let report: CleanupStepReport;
			try {
				report = executeCleanup(facts, (cwd, args) => {
					git(cwd, args);
				});
			} catch (error: any) {
				ctx.ui.notify(`Cleanup failed: ${error?.message ?? String(error)}`, "error");
				return;
			}

			const done = [
				report.remoteDeleted ? "remote branch" : null,
				report.worktreeRemoved ? "worktree" : null,
				report.localBranchDeleted ? "local branch" : null,
			]
				.filter(Boolean)
				.join(", ");
			ctx.ui.notify(`Cleanup done: ${done}. Closing session.`, "info");

			// Give the notification a moment on screen before the TUI exits.
			setTimeout(() => ctx.shutdown(), SHUTDOWN_DELAY_MS);
		},
	});
}
