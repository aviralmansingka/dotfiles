/**
 * `worktree` — put change work in a linked Git worktree instead of the main
 * checkout, and run it through an auto-exit worker subagent that lives in
 * the worktree session's first tab.
 *
 * Why: an agent that edits directly in the main checkout moves the repo's
 * neutral `main` branch — the picker invariants, the line-diff totals
 * against local main, and the "main may own multiple named durable
 * sessions" rule all assume main stays checked out there. A linked worktree
 * keeps every invariant intact (ADR-0002): the checkout lands under
 * `~/.herdr/worktrees/<repo>/<type>-<slug>`, joins the repository's shared
 * Herdr workspace, and owns exactly one durable session row.
 *
 * One tool call:
 *   1. `herdr worktree create --cwd <repo> --branch <type>/<slug>
 *      --base <base> --no-focus` — or `worktree open` to reuse an existing
 *      owned worktree (idempotent). Always `--no-focus`: an agent-spawned
 *      worktree never steals the human's focus.
 *   2. Read `.result.root_pane.pane_id` and the worktree path from the JSON.
 *   3. Spawn the worker through the interactive-subagents process global
 *      (`executeSubagent`) with `cwd` = the worktree and `pane` = the root
 *      pane, so the worker adopts the worktree session's first tab instead
 *      of opening its own. That machinery owns validation, the name
 *      registry, liveness/adoption, and the completion steer.
 *
 * Ownership: a fresh branch is marked `branch.<b>.piWorktree` in the repo's
 * local git config — the same pattern gh-dash-open-pr uses with
 * `branch.<b>.ghDashPr`. The tool reuses only worktrees and branches it
 * owns; anything else fails loudly instead of taking over.
 *
 * Lifecycle: the worker is auto-exit. On clean completion the subagent
 * machinery closes the whole tab, which folds the worktree session row; the
 * checkout and branch stay on disk, `herdr worktree open --cwd <repo>
 * --branch <b>` restores the row, and `/cleanup` (from a session in that
 * worktree) tears it down after ship.
 *
 * Herdr-only by design: `herdr worktree` drives the workspace API. The base
 * is the repo's LOCAL `main` by convention (the picker diffs against it);
 * pass `base` explicitly when a repo needs another branch.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parseWorktreeList, type WorktreeEntry } from "./cleanup.ts";

const GIT_TIMEOUT_MS = 30_000;
const HERDR_TIMEOUT_MS = 60_000;
const DEFAULT_BASE = "main";
const DEFAULT_AGENT = "worker";
const DEFAULT_BRANCH_TYPE = "feat";
const BRANCH_TYPES = ["feat", "fix", "explore", "chore", "task"] as const;
const WORKER_NAME_MAX = 32;
const OWNER_VALUE = "pi-worktree";

// --- git helpers -----------------------------------------------------------

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		timeout: GIT_TIMEOUT_MS,
		stdio: ["pipe", "pipe", "pipe"],
	}).trim();
}

function gitOk(cwd: string, args: string[]): string | null {
	try {
		return git(cwd, args);
	} catch {
		return null;
	}
}

// --- branch naming ---------------------------------------------------------

/**
 * Normalize a branch request into `<type>/<slug>`. A bare slug defaults to
 * `feat/`. The slug is lowercased, spaces become hyphens, and runs collapse;
 * the result stays within `[a-z0-9._-]` so it is always a safe ref component.
 * Throws a readable error otherwise.
 */
export function normalizeBranch(input: string): string {
	const raw = input.trim();
	if (!raw) throw new Error("branch must not be empty");
	let type: string = DEFAULT_BRANCH_TYPE;
	let slug = raw;
	if (raw.includes("/")) {
		const slash = raw.indexOf("/");
		type = raw.slice(0, slash).trim().toLowerCase();
		slug = raw.slice(slash + 1);
	}
	if (!(BRANCH_TYPES as readonly string[]).includes(type)) {
		throw new Error(
			`branch type "${type}" is not one of: ${BRANCH_TYPES.join(", ")}. ` +
				`Pass a bare slug (defaults to ${DEFAULT_BRANCH_TYPE}/) or <type>/<slug>.`,
		);
	}
	slug = slug
		.trim()
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
	if (!/^[a-z0-9][a-z0-9._-]*$/.test(slug)) {
		throw new Error(
			`branch slug "${slug}" is invalid — use lowercase letters, digits, ".", "_", "-" (for example: dark-mode-2)`,
		);
	}
	if (slug.includes("..")) {
		throw new Error(`branch slug "${slug}" is invalid — ".." is not allowed in a ref name`);
	}
	if (slug.endsWith(".lock")) {
		throw new Error(`branch slug "${slug}" is invalid — refs cannot end in ".lock"`);
	}
	return `${type}/${slug}`;
}

/** Widget/registry label for a worktree worker: the branch slug, without its type prefix. */
export function workerNameFor(branch: string): string {
	const slug = branch.slice(branch.indexOf("/") + 1);
	return slug.length > WORKER_NAME_MAX ? slug.slice(0, WORKER_NAME_MAX) : slug;
}

/**
 * The repo's PRIMARY checkout path. `git worktree list` lists the main
 * worktree first, then each linked worktree. Herdr's `worktree create/open`
 * must start "from the repo parent workspace": `--cwd` has to name the primary
 * checkout, so a session running inside a linked worktree passes this, never
 * its own toplevel.
 */
export function primaryCheckout(worktrees: WorktreeEntry[]): string {
	const first = worktrees.find((w) => !w.bare);
	if (!first) throw new Error("git worktree list reported no checkout");
	return first.path;
}

// --- ownership -------------------------------------------------------------

/** git-config key marking a branch as owned by this tool (gh-dash pattern). */
export function ownershipKey(branch: string): string {
	return `branch.${branch}.piWorktree`;
}

function isOwned(repo: string, branch: string): boolean {
	const value = gitOk(repo, ["config", "--local", "--get", ownershipKey(branch)]);
	return typeof value === "string" && value.trim() !== "";
}

function markOwned(repo: string, branch: string): void {
	git(repo, ["config", "--local", ownershipKey(branch), OWNER_VALUE]);
}

// --- decision (pure) -------------------------------------------------------

export type WorktreeDecision =
	| { action: "create-fresh"; base: string }
	| { action: "create-branch" }
	| { action: "open"; path: string }
	| { action: "refuse"; reason: string };

/**
 * Decide how to obtain the worktree for `branch`, given the repo's worktree
 * list, whether the branch exists, and whether this tool owns it. Pure —
 * callers gather the facts, this picks the action:
 *   - owned worktree present      → open (idempotent reuse)
 *   - owned branch, no worktree   → create-branch (checks the branch out)
 *   - branch absent               → create-fresh from base, then mark owned
 *   - anything not owned          → refuse, loudly
 */
export function decideWorktreeAction(opts: {
	branch: string;
	base: string;
	worktrees: WorktreeEntry[];
	branchExists: boolean;
	owned: boolean;
	checkoutExists: (path: string) => boolean;
}): WorktreeDecision {
	const existing = opts.worktrees.find(
		(w) => !w.bare && !w.detached && w.branch === opts.branch,
	);
	if (existing) {
		if (!opts.owned) {
			return {
				action: "refuse",
				reason:
					`branch ${opts.branch} is checked out at ${existing.path} but was not created by the worktree tool. ` +
					`Refusing to take it over — work there directly or pick another branch name.`,
			};
		}
		if (!opts.checkoutExists(existing.path)) {
			return {
				action: "refuse",
				reason:
					`branch ${opts.branch} is registered at ${existing.path} but that directory is gone. ` +
					`Run \`git worktree prune\` in the repo, then call worktree again.`,
			};
		}
		return { action: "open", path: existing.path };
	}
	if (opts.branchExists) {
		if (!opts.owned) {
			return {
				action: "refuse",
				reason:
					`branch ${opts.branch} already exists but was not created by the worktree tool. ` +
					`Refusing to check it out — pick another branch name.`,
			};
		}
		return { action: "create-branch" };
	}
	return { action: "create-fresh", base: opts.base };
}

// --- herdr -----------------------------------------------------------------

function herdr(args: string[]): Record<string, any> {
	let stdout: string;
	try {
		stdout = execFileSync("herdr", args, {
			encoding: "utf8",
			timeout: HERDR_TIMEOUT_MS,
			stdio: ["pipe", "pipe", "pipe"],
		});
	} catch (error: any) {
		// The CLI prints a JSON error object on stderr; surface its message when
		// parseable, else the raw stderr, else the spawn error.
		const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
		let detail = stderr || (error?.message ?? String(error));
		try {
			const parsed = JSON.parse(stderr);
			if (parsed?.error?.message) detail = String(parsed.error.message);
		} catch {}
		throw new Error(`herdr ${args.join(" ")} failed: ${detail}`);
	}
	try {
		return JSON.parse(stdout) as Record<string, any>;
	} catch {
		throw new Error(
			`herdr ${args.join(" ")} returned non-JSON output: ${stdout.slice(0, 200)}`,
		);
	}
}

// --- tool ------------------------------------------------------------------

const WorktreeParams = Type.Object({
	branch: Type.String({
		description:
			"Branch for the worktree: a bare slug like 'dark-mode' (becomes feat/dark-mode) or a full " +
			`'<type>/<slug>' with type one of ${BRANCH_TYPES.join(", ")}. An existing worktree/branch ` +
			"owned by this tool is reused; anything else the tool does not own is refused.",
	}),
	task: Type.String({
		description:
			"Task for the worker subagent. It starts with no prior conversation context — include every " +
			"file path, decision, and constraint it needs.",
	}),
	agent: Type.Optional(
		Type.String({ description: `Worker agent to spawn (default "${DEFAULT_AGENT}")` }),
	),
	base: Type.Optional(
		Type.String({
			description:
				`Base branch for a NEW worktree (default "${DEFAULT_BASE}", the repo's local main; ` +
				"must exist locally). Ignored when reusing or checking out an existing branch.",
		}),
	),
});

const DESCRIPTION =
	"Create or reuse a linked Git worktree from the repo's local main, and launch an auto-exit worker " +
	"subagent that does the change work there — in the worktree session's first tab, unfocused. Use this " +
	"instead of editing the main checkout: main stays the neutral checked-out branch, and the worktree " +
	"joins the repo's shared Herdr workspace with its own picker row under the repository. The checkout " +
	"lands at ~/.herdr/worktrees/<repo>/<branch>. The worker's result arrives automatically as a steer " +
	"message when it finishes — never poll for it. After the work ships, tear down with /cleanup from a " +
	"session in that worktree, or reopen the row with `herdr worktree open --cwd <repo> --branch <b>`. " +
	"Herdr-only; refuses branches and worktrees the tool does not own.";

export default function worktreeExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "worktree",
		label: "worktree",
		description: DESCRIPTION,
		promptSnippet:
			"Make repo changes with the worktree tool instead of editing the main checkout: it creates or reuses " +
			"a linked worktree from local main and runs an auto-exit worker subagent in that worktree's first tab; " +
			"the worker's result steers back automatically.",
		parameters: WorktreeParams,
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: true,
		},
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const fail = (
				message: string,
				details: Record<string, unknown> = {},
			) => ({
				content: [{ type: "text" as const, text: message }],
				isError: true,
				details: { error: message, ...details },
			});

			// 1. Herdr guard — `herdr worktree` drives the workspace API.
			if (process.env.HERDR_ENV !== "1" || !process.env.HERDR_PANE_ID) {
				return fail(
					"The worktree tool requires a session inside Herdr — " +
					"herdr worktree create/open drive the workspace API.",
				);
			}

			// 2. Repo resolution — any checkout of the repo works; herdr resolves
			// repository identity from the shared git common dir.
			const sessionCwd = typeof ctx?.cwd === "string" ? ctx.cwd : process.cwd();
			let repo: string;
			try {
				repo = git(sessionCwd, ["rev-parse", "--show-toplevel"]);
			} catch {
				return fail(`${sessionCwd} is not inside a Git repository.`);
			}

			// 3. Branch and base.
			let branch: string;
			try {
				branch = normalizeBranch(params.branch);
			} catch (error: any) {
				return fail(error?.message ?? String(error));
			}
			const base = (params.base ?? DEFAULT_BASE).trim();
			if (base === branch) {
				return fail(`base and branch are both ${branch} — pick a different branch name.`);
			}
			if (gitOk(repo, ["rev-parse", "--verify", `refs/heads/${base}`]) === null) {
				return fail(
					`base branch "${base}" does not exist locally in ${repo}. ` +
						`Pass base: "<branch>" or create the branch first.`,
			);
			}

			// 4. Decide create vs reuse vs refuse (ownership-marked, idempotent).
			const worktrees = parseWorktreeList(git(repo, ["worktree", "list", "--porcelain"]));
			const branchExists =
				gitOk(repo, ["rev-parse", "--verify", `refs/heads/${branch}`]) !== null;
			const decision = decideWorktreeAction({
				branch,
				base,
				worktrees,
				branchExists,
				owned: isOwned(repo, branch),
				checkoutExists: existsSync,
			});
			if (decision.action === "refuse") {
				return fail(decision.reason, { branch });
			}

			// 5. Create or open — never focus-stealing. `--cwd` must name the
			// repo's PRIMARY checkout: herdr refuses create/open from a linked
			// worktree ("start from the repo parent workspace").
			const herdrCwd = primaryCheckout(worktrees);
			let response: Record<string, any>;
			let mode: "created" | "created-existing" | "reused";
			let worktreePath: string | undefined;
			try {
				if (decision.action === "open") {
					response = herdr(["worktree", "open", "--cwd", herdrCwd, "--branch", branch, "--no-focus"]);
					mode = "reused";
					worktreePath = decision.path;
				} else if (decision.action === "create-branch") {
					response = herdr(["worktree", "create", "--cwd", herdrCwd, "--branch", branch, "--no-focus"]);
					mode = "created-existing";
				} else {
					response = herdr([
						"worktree",
						"create",
						"--cwd",
							herdrCwd,
						"--branch",
						branch,
						"--base",
						base,
						"--no-focus",
					]);
					markOwned(repo, branch);
					mode = "created";
				}
			} catch (error: any) {
				return fail(error?.message ?? String(error), { branch, base });
			}
			const result = response?.result ?? {};
			const rootPane = result?.root_pane?.pane_id;
			if (mode !== "reused") {
				worktreePath = result?.worktree?.path;
			}
			const workspaceId = result?.workspace?.workspace_id;
			if (
				typeof rootPane !== "string" ||
				rootPane.length === 0 ||
				typeof worktreePath !== "string" ||
				worktreePath.length === 0
			) {
				return fail(
					`herdr returned an unexpected response (no root_pane.pane_id or worktree.path). ` +
						`The worktree may exist — inspect it with \`herdr worktree list --cwd ${herdrCwd}\`.`,
					{ branch, mode, herdrResponse: JSON.stringify(response).slice(0, 400) },
				);
			}

			// 6. Spawn the worker through the interactive-subagents machinery.
			// The `pane` override makes it adopt the worktree session's root pane;
			// that machinery validates the pane, registers the name, and steers
			// the completion back here automatically.
			const spawnFn = (globalThis as any).__pi_interactive_subagents?.executeSubagent;
			if (typeof spawnFn !== "function") {
				return fail(
					`The worktree is ready at ${worktreePath} (branch ${branch}, pane ${rootPane}), but the worker ` +
						`could not launch: the interactive-subagents extension is not loaded. Open it with ` +
						`\`herdr worktree open --cwd ${herdrCwd} --branch ${branch}\` or work there directly.`,
					{ branch, path: worktreePath, pane: rootPane, workspace: workspaceId },
				);
			}
			const agent = params.agent?.trim() || DEFAULT_AGENT;
			const workerName = workerNameFor(branch);
			const spawnParams = {
				agent,
				name: workerName,
				task: params.task,
				cwd: worktreePath,
				pane: rootPane,
			};
			let spawn: any;
			try {
				spawn = await spawnFn(spawnParams, ctx);
			} catch (error: any) {
				return fail(
					`The worktree is ready at ${worktreePath} (branch ${branch}, pane ${rootPane}), but the worker ` +
						`launch failed: ${error?.message ?? String(error)}. The worktree stays — retry, or open it with ` +
						`\`herdr worktree open --cwd ${herdrCwd} --branch ${branch}\`.`,
					{ branch, path: worktreePath, pane: rootPane, workspace: workspaceId },
				);
			}
			const subagent = spawn?.details ?? {};
			if (subagent.error || subagent.status !== "started" || !subagent.sessionFile) {
				return fail(
					`The worktree is ready at ${worktreePath} (branch ${branch}, pane ${rootPane}), but the worker ` +
						`did not start: ${subagent.error ?? "unknown spawn error"}. The worktree stays — retry, or open it ` +
						`with \`herdr worktree open --cwd ${herdrCwd} --branch ${branch}\`.`,
					{ branch, path: worktreePath, pane: rootPane, workspace: workspaceId },
				);
			}

			// 7. Ack — the steer with the worker's result arrives on its own.
			const actualName =
				typeof subagent.name === "string" && subagent.name ? subagent.name : workerName;
			return {
				content: [
					{
					type: "text" as const,
					text:
						`Worktree ${mode === "reused" ? "reused" : "created"} and worker launched.\n` +
						`- branch: ${branch}${mode === "created" ? ` (from ${base})` : ""}\n` +
						`- path: ${worktreePath}\n` +
						`- worker: subagent "${actualName}" (agent "${agent}", auto-exit) in the worktree ` +
						`session's first tab (${rootPane}), unfocused\n` +
						`- session: ${subagent.sessionFile}\n\n` +
						`The worktree keeps the repo's shared Herdr workspace; its picker row is the one durable ` +
						`session for that worktree. The worker's result arrives automatically as a steer message — ` +
						`do not poll for it. After the work ships, tear down with /cleanup from a session in that ` +
						`worktree, or reopen the row any time with \`herdr worktree open --cwd ${herdrCwd} --branch ${branch}\`.`,
				},
			],
			details: {
				branch,
				base: mode === "created" ? base : null,
				path: worktreePath,
				pane: rootPane,
				workspace: workspaceId ?? null,
				worker: actualName,
				mode,
				subagent,
			},
			};
		},
	});
}
