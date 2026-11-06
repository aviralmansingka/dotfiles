/**
 * `/worktree` — make a linked worktree and start a fresh pi inside it.
 *
 * The command asks two questions and nothing else:
 *   1. Base repository, pre-filled with the git checkout that holds this
 *      session. Enter accepts it; any other path is resolved to its toplevel.
 *   2. Worktree name, pre-filled with the text typed after `/worktree`.
 *      `feat/login-fix` keeps its type; a bare `login-fix` becomes
 *      `feat/login-fix`. Enter accepts the shown value, typing replaces it.
 *
 * It then runs `git worktree add -b <branch> <path> <base>` and opens a tab in
 * that checkout running `pi --name <slug>`. The session name is the worktree
 * slug after the first slash (`feat/login-fix` → `login-fix`), because that is
 * the name the picker, the tab header, and `/cleanup` already agree on.
 *
 * The checkout lands under `~/.herdr/worktrees/<repo>/<type>-<slug>`, the same
 * root the `worktree` tool uses, so one checkout stays usable from either
 * command. The migration plan renames this root once Herdr is gone; until then
 * both callers must agree, so this file spells the root itself instead of
 * importing a module that also registers a tool.
 *
 * The base branch is the repo's local `main`, matching the picker's diff
 * baseline. A repo without `main` uses HEAD.
 *
 * Launch order: Rex tab when `REX_SESSION` is set, then Herdr, then tmux. With
 * no multiplexer the checkout is still made and the command to run is printed.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BRANCH_TYPES = ["feat", "fix", "explore", "chore", "task"] as const;
const DEFAULT_BRANCH_TYPE = "feat";
const WORKER_NAME_MAX = 32;

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		timeout: 30_000,
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

/** Resolve any path inside a checkout to its toplevel, or null. */
function toplevel(path: string): string | null {
	if (!path) return null;
	try {
		return realpathSync(git(path, ["rev-parse", "--show-toplevel"]));
	} catch {
		return null;
	}
}

/**
 * Normalize a name into `<type>/<slug>`. A bare slug defaults to `feat/`.
 * The slug is lowercased, spaces become hyphens, and the result stays within
 * `[a-z0-9._-]`, so it is always a safe ref component and file name.
 */
function normalizeBranch(input: string): string {
	const raw = input.trim();
	if (!raw) throw new Error("worktree name must not be empty");
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
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^[-.]+|[-.]+$/g, "");
	if (!slug) throw new Error("worktree name needs at least one letter or digit");
	return `${type}/${slug}`;
}

/** Session and tab name: the branch slug after the first slash. */
function sessionNameFor(branch: string): string {
	const slug = branch.slice(branch.indexOf("/") + 1);
	return slug.length > WORKER_NAME_MAX ? slug.slice(0, WORKER_NAME_MAX) : slug;
}

/** Checkout path: `~/.herdr/worktrees/<repo>/<type>-<slug>`. */
function worktreePathFor(primary: string, branch: string): string {
	const home = (() => {
		try {
			return realpathSync(homedir());
		} catch {
			return homedir();
		}
	})();
	return join(home, ".herdr", "worktrees", basename(primary), branch.replace(/\//g, "-"));
}

function run(args: string[], cwd?: string): string {
	return execFileSync(args[0], args.slice(1), {
		...(cwd ? { cwd } : {}),
		encoding: "utf8",
		timeout: 30_000,
		stdio: ["pipe", "pipe", "pipe"],
	}).trim();
}

/**
 * Open a tab in `cwd` running `pi --name <slug>`. Returns the surface it used,
 * or "" when only the manual command could be printed.
 */
function launchPi(slug: string, cwd: string): string {
	const label = `π ${slug}`;
	if (process.env.REX_SESSION) {
		const args = ["rex", "window", "new", "-s", process.env.REX_SESSION, label, "-c", cwd, "--", "pi", "--name", slug];
		run(args);
		return "rex tab";
	}
	if (process.env.HERDR_ENV === "1" && process.env.HERDR_WORKSPACE_ID) {
		const out = run([
			"herdr", "tab", "create",
			"--workspace", process.env.HERDR_WORKSPACE_ID,
			"--cwd", cwd,
			"--label", `subagent: ${slug}`,
			"--no-focus",
		]);
		const parsed = JSON.parse(out) as {
			result?: { root_pane?: { pane_id?: string }; tab?: { tab_id?: string }; tab_id?: string };
		};
		const pane = parsed?.result?.root_pane?.pane_id;
		if (!pane) throw new Error("herdr tab create returned no root pane");
		run(["herdr", "pane", "run", pane, `pi --name ${slug}`]);
		const tab = parsed?.result?.tab?.tab_id ?? parsed?.result?.tab_id;
		if (tab) {
			try {
				run(["herdr", "tab", "focus", tab]);
			} catch {
				// Best effort: the tab exists even when focus is refused.
			}
		}
		return "herdr tab";
	}
	if (process.env.TMUX) {
		run(["tmux", "new-window", "-c", cwd, "-n", slug, `pi --name ${slug}`]);
		return "tmux window";
	}
	return "";
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("worktree", {
		description: "Create a linked worktree and start pi in it",
		handler: async (args, ctx) => {
			try {
				const prefill = args.trim();
				const current = toplevel(ctx.cwd);

				const repoAnswer = await ctx.ui.input(
					"Base repository:",
					current ?? "path to a git checkout",
				);
				if (repoAnswer === undefined) return;
				const repo = toplevel(repoAnswer.trim() || current || "");
				if (!repo) {
					ctx.ui.notify("That path is not inside a git checkout.", "error");
					return;
				}

				const nameAnswer = await ctx.ui.input(
					"Worktree name:",
					prefill || `${DEFAULT_BRANCH_TYPE}/my-change`,
				);
				if (nameAnswer === undefined) return;
				const raw = nameAnswer.trim() || prefill;
				if (!raw) {
					ctx.ui.notify("A worktree name is required.", "warning");
					return;
				}

				const branch = normalizeBranch(raw);
				const path = worktreePathFor(repo, branch);
				if (existsSync(path)) {
					ctx.ui.notify(`Worktree already exists: ${path}`, "error");
					return;
				}
				if (gitOk(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])) {
					ctx.ui.notify(`Branch ${branch} already exists.`, "error");
					return;
				}

				const base = gitOk(repo, ["rev-parse", "--verify", "--quiet", "refs/heads/main"])
					? "main"
					: "HEAD";
				mkdirSync(dirname(path), { recursive: true });
				git(repo, ["worktree", "add", "-b", branch, path, base]);
				git(repo, ["config", "--local", `branch.${branch}.piWorktree`, "pi-worktree"]);

				const slug = sessionNameFor(branch);
				const surface = launchPi(slug, path);
				if (!surface) {
					ctx.ui.notify(
						`Worktree ${branch} is at ${path}. Start it with: cd ${path} && pi --name ${slug}`,
						"info",
					);
					return;
				}
				ctx.ui.notify(`Worktree ${branch} at ${path}. pi "${slug}" in a ${surface}.`, "info");
			} catch (error) {
				ctx.ui.notify(
					error instanceof Error ? error.message : String(error),
					"error",
				);
			}
		},
	});
}
