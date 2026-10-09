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
 * linked worktree. A confirm dialog lists the exact targets plus dirty-file and
 * upstream-ahead warnings. Any failed git step aborts the remaining steps and
 * keeps the session open.
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
	/** Uncommitted file count in the worktree. */
	dirtyCount: number;
	/** Commits on HEAD not on the upstream, or null without an upstream. */
	aheadCount: number | null;
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
	if (upstreamRef) {
		let aheadRaw: string;
		try {
			aheadRaw = runGit(worktreePath, ["rev-list", "--count", `${upstreamRef}..HEAD`]);
		} catch {
			return { ok: false, reason: "Could not compare the upstream branch; refusing to clean up." };
		}
		if (!/^\d+$/.test(aheadRaw)) {
			return { ok: false, reason: "The upstream comparison is invalid; refusing to clean up." };
		}
		aheadCount = Number(aheadRaw);
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
	if (facts.dirtyCount > 0) {
		lines.push(`Warning:   ${facts.dirtyCount} uncommitted file(s) — discarded with the worktree.`);
	}
	if (facts.aheadCount !== null && facts.aheadCount > 0) {
		lines.push(`Warning:   ${facts.aheadCount} commit(s) not on ${facts.remote}/${facts.remoteBranch} — the remote branch is still deleted.`);
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
	if (facts.remote && facts.remoteBranch) {
		run(facts.worktreePath, ["push", facts.remote, "--delete", facts.remoteBranch]);
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
