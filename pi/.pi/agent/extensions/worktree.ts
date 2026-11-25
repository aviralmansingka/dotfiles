/**
 * `worktree` — put change work in a linked Git worktree instead of the main
 * checkout, and open that checkout as a user-driven session: an unfocused
 * Rex tab (or the Herdr worktree pane) running an ordinary `pi` there.
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
 *   3. Start `pi` in that pane, unless the worktree was reused: a reused
 *      surface may already host the session's own pi.
 *
 * No subagent. Nothing is spawned, registered, watched, or auto-exited, so
 * the tab stays parked for the human, carries no `PI_SUBAGENT_*` identity,
 * and never reports a completion steer. The tool passes no task: the human
 * drives the session. There is no `task` or `agent` parameter, so a caller
 * that wants a worker uses `subagent` instead.
 *
 * Ownership: a fresh branch is marked `branch.<b>.piWorktree` in the repo's
 * local git config — the same pattern gh-dash-open-pr uses with
 * `branch.<b>.ghDashPr`. The tool reuses only worktrees and branches it
 * owns; anything else fails loudly instead of taking over.
 *
 * Lifecycle: the session is durable. Its pi exits when the human quits it, the
 * checkout and branch stay on disk, `herdr worktree open --cwd <repo>
 * --branch <b>` restores a folded Herdr row, a repeat call finds the worktree's
 * tab again, and `/cleanup` (from a session in that worktree) tears it down
 * after ship.
 *
 * Two surfaces: Herdr carries a worktree API, so `herdr worktree create/open`
 * does the checkout AND yields the pane pi starts in — already inside the
 * repository's shared workspace. Rex has no worktree command, so this file
 * creates the checkout with `git worktree add` itself and adds one tab to the
 * repository's own session, its analogue of that workspace. Both surfaces share one
 * worktree root (`~/.herdr/worktrees/<repo>/<type>-<slug>`) so a checkout
 * stays usable when the human switches multiplexers. The base is the repo's
 * LOCAL `main` by convention (the picker diffs against it); pass `base`
 * explicitly when a repo needs another branch.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parseWorktreeList, type WorktreeEntry } from "./cleanup.ts";

const GIT_TIMEOUT_MS = 30_000;
const MUX_TIMEOUT_MS = 60_000;
const DEFAULT_BASE = "main";
const DEFAULT_BRANCH_TYPE = "feat";
const BRANCH_TYPES = ["feat", "fix", "explore", "chore", "task"] as const;
const LABEL_MAX = 32;
const OWNER_VALUE = "pi-worktree";

/** Which multiplexer this session runs under, or null when neither applies. */
export type MuxSurface = "herdr" | "rex";

/**
 * Detect the multiplexer. A Rex block (REX_SESSION + REX_BLOCK) wins over a
 * stale HERDR_ENV inherited from an outer Herdr pane, because Rex owns the
 * innermost tabs in that case.
 */
export function detectSurface(env: NodeJS.ProcessEnv = process.env): MuxSurface | null {
	if (env.REX_SESSION && env.REX_BLOCK) return "rex";
	if (env.HERDR_ENV === "1" && env.HERDR_PANE_ID) return "herdr";
	return null;
}

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

/** Session/tab label for a worktree: the branch slug, without its type prefix. */
export function labelFor(branch: string): string {
	const slug = branch.slice(branch.indexOf("/") + 1);
	return slug.length > LABEL_MAX ? slug.slice(0, LABEL_MAX) : slug;
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

/**
 * Root that holds every worktree checkout, shared by both surfaces so the
 * same checkout stays usable when the human switches multiplexers.
 */
export function worktreeRoot(primary: string): string {
	return join(realHome(), ".herdr", "worktrees", basename(primary));
}

/**
 * `$HOME` with symlinks resolved. git reports realpaths (`/private/var` on
 * macOS) in `worktree list`, so a fresh create and a later reuse must agree on
 * one spelling or the two paths look like different checkouts.
 */
function realHome(): string {
	try {
		return realpathSync(homedir());
	} catch {
		return homedir();
	}
}

/** Checkout path for a branch: `<root>/<type>-<slug>` (slashes become hyphens). */
export function worktreePathFor(primary: string, branch: string): string {
	return join(worktreeRoot(primary), branch.replace(/\//g, "-"));
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

/** One `herdr`/`rex` call: stdout on success, a readable error otherwise. */
function mux(bin: "herdr" | "rex", args: string[]): string {
	try {
		return execFileSync(bin, args, {
			encoding: "utf8",
			timeout: MUX_TIMEOUT_MS,
			stdio: ["pipe", "pipe", "pipe"],
		});
	} catch (error: any) {
		const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
		throw new Error(`${bin} ${args.join(" ")} failed: ${stderr || error?.message || String(error)}`);
	}
}

function herdr(args: string[]): Record<string, any> {
	let stdout: string;
	try {
		stdout = mux("herdr", args);
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

// --- rex ------------------------------------------------------------------

function rexJson(args: string[]): Record<string, any> | null {
	try {
		const out = mux("rex", args).trim();
		return out ? (JSON.parse(out) as Record<string, any>) : null;
	} catch {
		return null;
	}
}

/** Tab label for a worktree: the π glyph plus the branch slug. */
export function rexTabLabel(branch: string): string {
	return `π ${labelFor(branch)}`;
}

/** Window id whose label matches exactly in `session`, or null. */
function rexWindowByLabel(session: string, label: string): string | null {
	const listed = rexJson(["window", "ls", "-s", session, "--json"]);
	const hit = (listed?.windows ?? []).find(
		(entry: any) => entry?.label === label && typeof entry?.window_id === "string" && entry.window_id,
	);
	return typeof hit?.window_id === "string" ? hit.window_id : null;
}

/** A window's first block id, for the ack. */
function rexWindowBlock(session: string, windowId: string): string | null {
	const info = rexJson(["window", "inspect", "-s", session, windowId, "--json"]);
	const block = info?.focused_block_id ?? info?.layers?.[0]?.blocks?.[0]?.block_id;
	return typeof block === "string" && block !== "" ? block : null;
}

/**
 * Open — or reuse — the worktree's tab in the calling repository's session, with
 * an ordinary `pi` in it. A Rex session is the analogue of a Herdr workspace, so
 * a worktree is one more tab in the repo's session rather than a session of its
 * own. `--focus=false` keeps the human where they are, and the tab is keyed by
 * label so a repeat call reuses it instead of stacking a second one.
 */
export function openRexTab(
	session: string,
	branch: string,
	cwd: string,
): { window: string; pane: string; created: boolean } {
	const label = rexTabLabel(branch);
	const existing = rexWindowByLabel(session, label);
	if (existing) {
		return { window: existing, pane: rexWindowBlock(session, existing) ?? "", created: false };
	}
	const out = mux("rex", [
		"window", "new", "-s", session, label,
		"--focus=false", "-c", cwd, "--json", "--", "pi",
	]);
	let parsed: any;
	try {
		parsed = JSON.parse(out);
	} catch {
		throw new Error(`rex window new ${label} returned non-JSON output: ${out.slice(0, 200)}`);
	}
	const windowId = parsed?.window_id;
	const pane = parsed?.block_ids?.[0] ?? parsed?.initial_windows?.[0]?.block_ids?.[0];
	if (typeof windowId !== "string" || !windowId || typeof pane !== "string" || !pane) {
		throw new Error(`rex window new ${label} returned no window or block id`);
	}
	return { window: windowId, pane, created: true };
}

// --- tool ------------------------------------------------------------------

const WorktreeParams = Type.Object({
	branch: Type.String({
		description:
			"Branch for the worktree: a bare slug like 'dark-mode' (becomes feat/dark-mode) or a full " +
			`'<type>/<slug>' with type one of ${BRANCH_TYPES.join(", ")}. An existing worktree/branch ` +
			"owned by this tool is reused; anything else the tool does not own is refused.",
	}),
	base: Type.Optional(
		Type.String({
			description:
				`Base branch for a NEW worktree (default "${DEFAULT_BASE}", the repo's local main; ` +
				"must exist locally). Ignored when reusing or checking out an existing branch.",
		}),
	),
});

const DESCRIPTION =
	"Put change work in a linked Git worktree based on the repo's local main, and open that checkout " +
	"as a user-driven session. Use this instead of editing the main checkout. The checkout lands at " +
	"~/.herdr/worktrees/<repo>/<branch> and gets its own session: under Herdr it joins the repo's " +
	"shared workspace, under Rex it opens a labeled tab running an ordinary pi. No subagent runs " +
	"there and no task is passed — the human drives that session. Tear down with /cleanup from it " +
	"after the work ships.";

export default function worktreeExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "worktree",
		label: "worktree",
		description: DESCRIPTION,
		promptSnippet:
			"Make repo changes with the worktree tool instead of editing the main checkout. It bases the " +
			"worktree on local main, never on the current branch, and opens it as a user-driven tab for " +
			"the human; it launches no subagent and passes no task.",
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

			// 1. Surface guard — Herdr drives worktrees through its workspace API;
			// Rex has no worktree command, so this file runs git directly there.
			const surface = detectSurface();
			if (!surface) {
				return fail(
					"The worktree tool requires a session inside Herdr or Rex. " +
					"Start pi in one of them, or create the worktree by hand with `git worktree add`.",
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

			// 5. Create or open — never focus-stealing. Herdr wants `--cwd` to name
			// the repo's PRIMARY checkout (it refuses create/open from a linked
			// worktree); Rex needs no anchor at all and checks the tree out with git.
			const primary = primaryCheckout(worktrees);
			let mode: "created" | "created-existing" | "reused";
			let worktreePath: string;
			let rootPane: string | null = null;
			let workspaceId: string | null = null;
			let surfaceSession: string | null = null;
			// Set when this call started pi; a reuse adopts a surface that may already
			// host the session's own pi, so it never starts a second one.
			let startedPi = false;
			let warning: string | null = null;

			if (surface === "rex") {
				const target = worktreePathFor(primary, branch);
				try {
					if (decision.action === "open") {
						worktreePath = decision.path;
						mode = "reused";
					} else {
						mkdirSync(dirname(target), { recursive: true });
						if (decision.action === "create-branch") {
							git(repo, ["worktree", "add", target, branch]);
							mode = "created-existing";
						} else {
							git(repo, ["worktree", "add", "-b", branch, target, base]);
							markOwned(repo, branch);
							mode = "created";
						}
						worktreePath = target;
					}
				} catch (error: any) {
					return fail(error?.message ?? String(error), { branch, base, surface });
				}

				// One tab per worktree, inside the repository's own session — the Rex
				// analogue of the Herdr workspace the worktree joins. Keyed by label, so a
				// repeat call reuses the tab instead of stacking a second one.
				const rexSessionId = process.env.REX_SESSION?.trim();
				if (!rexSessionId) {
					return fail(
						`The worktree is ready at ${worktreePath} (branch ${branch}), but this session has no ` +
							`REX_SESSION, so no tab could be opened. Start one with ` +
							`\`rex window new ${rexTabLabel(branch)} -c ${worktreePath} -- pi\`.`,
						{ branch, path: worktreePath, surface },
					);
				}
				try {
					const opened = openRexTab(rexSessionId, branch, worktreePath);
					rootPane = opened.pane;
					surfaceSession = rexSessionId;
					startedPi = opened.created;
				} catch (error: any) {
					return fail(
						`The worktree is ready at ${worktreePath} (branch ${branch}), but its tab could not be ` +
							`opened: ${error?.message ?? String(error)}. Start one with ` +
							`\`rex window new ${rexTabLabel(branch)} -c ${worktreePath} -- pi\`.`,
						{ branch, path: worktreePath, surface },
					);
				}
			} else {
				const herdrCwd = primary;
				let response: Record<string, any>;
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
				const pane = result?.root_pane?.pane_id;
				if (mode !== "reused") {
					worktreePath = result?.worktree?.path;
				}
				workspaceId = result?.workspace?.workspace_id ?? null;
				if (
					typeof pane !== "string" ||
					pane.length === 0 ||
					typeof worktreePath !== "string" ||
					worktreePath.length === 0
				) {
					return fail(
						`herdr returned an unexpected response (no root_pane.pane_id or worktree.path). ` +
							`The worktree may exist — inspect it with \`herdr worktree list --cwd ${herdrCwd}\`.`,
						{ branch, mode, herdrResponse: JSON.stringify(response).slice(0, 400) },
					);
				}
				rootPane = pane;
				if (mode !== "reused") {
					// `pane run` sends the text plus Enter, so pi owns the pane instead of
					// sitting behind a shell. A reused worktree may already host pi.
					try {
						mux("herdr", ["pane", "run", pane, "pi"]);
						startedPi = true;
					} catch (error: any) {
						warning = `pi did not start in ${pane}: ${error?.message ?? String(error)}`;
					}
				}
			}

			// 6. Ack. No subagent runs here and no steer follows: the tab is the
			// human's, parked and unfocused, with an ordinary pi at its prompt.
			const label = labelFor(branch);
			const where =
				surface === "herdr"
					? `in the worktree pane (${rootPane}), unfocused`
					: `in the repository session as tab "${rexTabLabel(branch)}" (${rootPane}), unfocused`;
			const reopenHint =
				surface === "herdr"
					? `\`herdr worktree open --cwd ${primary} --branch ${branch}\``
					: `its tab \`${rexTabLabel(branch)}\` in this session`;
			const startHint = startedPi
				? ""
				: `\n- pi: not started (the surface was reused; run \`pi\` there if it is idle)`;
			return {
				content: [
					{
						type: "text" as const,
						text:
							`Worktree ${mode === "reused" ? "reused" : "created"}; user-driven session ${where}.\n` +
							`- branch: ${branch}${mode === "created" ? ` (from ${base})` : ""}\n` +
							`- path: ${worktreePath}${startHint}` +
							(warning ? `\n- warning: ${warning}` : "") +
							`\n\nNo subagent runs there and this tool sent no task — switch to that tab and drive it. ` +
							`Tear down with /cleanup from a session in that worktree, or reopen it any time with ${reopenHint}.`,
					},
				],
				details: {
					branch,
					base: mode === "created" ? base : null,
					path: worktreePath,
					pane: rootPane,
					workspace: workspaceId ?? null,
					session: surfaceSession,
					label,
					tab: surface === "rex" ? rexTabLabel(branch) : null,
					surface,
					mode,
					startedPi,
					warning,
				},
			};
		},
	});
}
