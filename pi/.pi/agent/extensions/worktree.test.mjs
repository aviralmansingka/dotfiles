// worktree tool — create/reuse a linked worktree from main and spawn the
// worker into its root pane.
//
// Coverage here mirrors the house offline pattern (cleanup.test.mjs fixtures
// + the interactive-subagents fake-herdr bin): stubbed pi package imports,
// a PATH-first fake `herdr` that records argv and serves canned JSON, real
// temp Git repos for the ownership/decision facts, and a fake
// __pi_interactive_subagents.executeSubagent global that records spawn
// params. No live Herdr, no live sessions, no sleeps.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { resolveJiti } from "./test-lib/jiti.mjs";

const require = createRequire(import.meta.url);

// #291 class guard: every captured child call pipes stdio so child
// stderr never inherits the TTY (scripts/test-child-stdio.py enforces this).
const gitx = (args, opts = {}) =>
	execFileSync("git", args, { stdio: ["pipe", "pipe", "pipe"], ...opts });

const { jitiPath } = resolveJiti();
const { createJiti } = require(jitiPath);

// macOS realpath-normalized once: git (rev-parse, worktree list) reports
// realpaths (/private/var vs /var), and every argv/path comparison below
// must match what the tool actually saw.
const root = realpathSync(mkdtempSync(join(tmpdir(), "worktree-tool-test-")));
try {
	// typebox stub: parameter schemas only need to load, not validate here.
	const typebox = join(root, "typebox.cjs");
	writeFileSync(typebox, "exports.Type = new Proxy({}, { get: () => (value) => value });\n");
	// pi-coding-agent stub: worktree.ts/cleanup.ts import only types from it.
	const agentStub = join(root, "agent.cjs");
	writeFileSync(agentStub, "exports.registerCommand = () => {};\n");
	const jiti = createJiti(import.meta.url, {
		alias: { typebox, "@earendil-works/pi-coding-agent": agentStub },
	});
	const ext = jiti("./worktree.ts");

	// --- pure helpers: branch normalization and worker naming ---
	assert.equal(ext.normalizeBranch("dark-mode"), "feat/dark-mode");
	assert.equal(ext.normalizeBranch("Dark Mode"), "feat/dark-mode");
	assert.equal(ext.normalizeBranch("fix/Pane Size"), "fix/pane-size");
	assert.equal(ext.normalizeBranch("explore/herdr-plannotator"), "explore/herdr-plannotator");
	assert.equal(ext.normalizeBranch("task/23-build-links"), "task/23-build-links");
	assert.throws(() => ext.normalizeBranch("docs/readme"), /branch type "docs" is not one of/);
	assert.throws(() => ext.normalizeBranch(""), /branch must not be empty/);
	assert.throws(() => ext.normalizeBranch("feat/"), /slug "" is invalid/);
	assert.throws(() => ext.normalizeBranch("feat/UPPER!"), /slug "upper!" is invalid/);
	assert.throws(() => ext.normalizeBranch("feat/a..b"), /\.\./);
	assert.throws(() => ext.normalizeBranch("feat/x.lock"), /\.lock/);
	assert.equal(ext.workerNameFor("feat/dark-mode"), "dark-mode");
	assert.equal(
		ext.workerNameFor(`feat/${"a".repeat(40)}`).length,
		32,
		"long slugs truncate to a registry-safe worker name",
	);
	assert.equal(ext.ownershipKey("feat/x"), "branch.feat/x.piWorktree");

	// --- pure decision table ---
	const entry = (path, branch) => ({ path, branch, head: "abc", bare: false, detached: false });
	const opts = (over) => ({
		branch: "feat/x",
		base: "main",
		worktrees: [],
		branchExists: false,
		owned: false,
		checkoutExists: () => true,
		...over,
	});
	assert.deepEqual(ext.decideWorktreeAction(opts({})), { action: "create-fresh", base: "main" });
	assert.deepEqual(
		ext.decideWorktreeAction(opts({ branchExists: true, owned: true })),
		{ action: "create-branch" },
	);
	assert.deepEqual(
		ext.decideWorktreeAction(opts({ worktrees: [entry("/w/feat-x", "feat/x")], owned: true })),
		{ action: "open", path: "/w/feat-x" },
	);
	assert.equal(
		ext.decideWorktreeAction(opts({ worktrees: [entry("/w/feat-x", "feat/x")] })).action,
		"refuse",
		"an existing worktree the tool does not own is refused",
	);
	assert.equal(
		ext.decideWorktreeAction(opts({ branchExists: true })).action,
		"refuse",
		"an existing branch the tool does not own is refused",
	);
	assert.equal(
		ext.decideWorktreeAction(
			opts({ worktrees: [entry("/w/gone", "feat/x")], owned: true, checkoutExists: () => false }),
		).action,
		"refuse",
		"a registered worktree whose directory is gone is refused",
	);
	assert.match(
		ext.decideWorktreeAction(
			opts({ worktrees: [entry("/w/gone", "feat/x")], owned: true, checkoutExists: () => false }),
		).reason,
		/git worktree prune/,
	);

	// --- tool harness: fake herdr bin, fake subagent global, git fixtures ---
	const bin = join(root, "bin");
	const capture = join(root, "herdr-calls");
	const fakePath = join(root, "fake-worktree");
	mkdirSync(bin, { recursive: true });
	writeFileSync(
		join(bin, "herdr"),
		`#!/bin/sh
printf '%s\\n' "$@" >> "$WT_TEST_CAPTURE"
printf '%s\\n' --call-- >> "$WT_TEST_CAPTURE"
case "$1:$2" in
	worktree:create)
		if [ "$WT_TEST_FAIL_CREATE" = 1 ]; then
			printf '%s\\n' '{"error":{"message":"boom create"}}' >&2
			exit 1
		fi
		printf '{"result":{"root_pane":{"pane_id":"%s"},"workspace":{"workspace_id":"wT"},"worktree":{"path":"%s","branch":"%s"}}}\\n' "$WT_TEST_PANE" "$WT_TEST_PATH" "$WT_TEST_BRANCH"
		;;
	worktree:open)
		printf '{"result":{"type":"worktree_opened","root_pane":{"pane_id":"%s"},"workspace":{"workspace_id":"wT2"},"worktree":{"path":"%s"}}}\\n' "$WT_TEST_OPEN_PANE" "$WT_TEST_OPEN_PATH"
		;;
	*) printf '%s\\n' '{"result":{}}' ;;
esac
`,
		{ mode: 0o755 },
	);
	mkdirSync(fakePath, { recursive: true });

	const spawnCalls = [];
	let spawnMode = "ok";
	globalThis.__pi_interactive_subagents = {
		executeSubagent: async (params, ctx) => {
			spawnCalls.push({ params, ctx });
			if (spawnMode === "throw") throw new Error("socket exploded");
			if (spawnMode === "errorDetails")
				return { content: [{ type: "text", text: "no mux" }], details: { error: "mux unavailable" } };
			return {
				content: [{ type: "text", text: "ok" }],
				details: { name: "spawned", sessionFile: "/tmp/wt-spawn.jsonl", status: "started" },
			};
		},
	};

	let tool;
	ext.default({ registerTool: (value) => { tool = value; } });
	assert.equal(tool.name, "worktree");
	assert.deepEqual(
		tool.annotations,
		{ readOnlyHint: false, destructiveHint: false, idempotentHint: true },
		"creating a worktree mutates but does not destroy; repeat calls reuse",
	);

	const calls = () => {
		try {
			return readFileSync(capture, "utf8")
				.split("--call--\n")
				.filter(Boolean)
				.map((call) => call.trim().split("\n"));
		} catch {
			return []; // no capture file yet — no herdr call was made
		}
	};
	const clearCalls = () => {
		try { rmSync(capture); } catch {}
	};

	function makeRepo() {
		const dir = mkdtempSync(join(tmpdir(), "worktree-repo-"));
		gitx(["-C", dir, "init", "-q", "-b", "main"]);
		gitx(["-C", dir, "config", "user.email", "t@example.com"]);
		gitx(["-C", dir, "config", "user.name", "t"]);
		gitx(["-C", dir, "commit", "-q", "--allow-empty", "-m", "init"]);
		// git rev-parse --show-toplevel (used by the tool) reports the
		// realpath; normalize the fixture once so every argv comparison matches.
		return gitx(["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
	}

	const run = (params, cwd) => tool.execute("t", params, undefined, undefined, { cwd });
	const finish = async (promise) => {
		const outcome = await promise;
		return {
			text: outcome.content[0].text,
			isError: outcome.isError === true,
			details: outcome.details ?? {},
		};
	};

	const savedEnv = {
		PATH: process.env.PATH,
		HERDR_ENV: process.env.HERDR_ENV,
		HERDR_PANE_ID: process.env.HERDR_PANE_ID,
		REX_SESSION: process.env.REX_SESSION,
		REX_BLOCK: process.env.REX_BLOCK,
	};
	try {
		process.env.PATH = `${bin}:${savedEnv.PATH}`;
		// A real Rex shell that launches this suite exports REX_SESSION/REX_BLOCK,
		// and ./worktree.ts prefers rex over herdr (innermost mux). Clear them so
		// every simulated Herdr case below starts from a Herdr-only session.
		delete process.env.REX_SESSION;
		delete process.env.REX_BLOCK;
		process.env.HERDR_ENV = "1";
		process.env.HERDR_PANE_ID = "wT:p0";
		process.env.WT_TEST_CAPTURE = capture;
		process.env.WT_TEST_PANE = "wT:p1";
		process.env.WT_TEST_PATH = fakePath;
		process.env.WT_TEST_OPEN_PANE = "wT:p2";
		process.env.WT_TEST_OPEN_PATH = join(root, "open-worktree");

		// Fresh create: exact herdr argv, ownership marker, spawn on the root pane.
		{
			clearCalls();
			spawnCalls.length = 0;
			spawnMode = "ok";
			const repo = makeRepo();
			process.env.WT_TEST_BRANCH = "feat/dark-mode";
			const { text, isError, details } = await finish(
				run({ branch: "dark-mode", task: "Ship dark mode." }, repo),
			);
			assert.equal(isError, false);
			assert.match(text, /Worktree created and worker launched/);
			assert.deepEqual(calls()[0], [
				"worktree", "create", "--cwd", repo,
				"--branch", "feat/dark-mode", "--base", "main", "--no-focus",
			], "create is unfocused and based on local main");
			assert.equal(
				gitx(["-C", repo, "config", "--local", "--get", "branch.feat/dark-mode.piWorktree"], { encoding: "utf8" }).trim(),
				"pi-worktree",
				"the fresh branch is ownership-marked like gh-dash marks PR branches",
			);
			assert.deepEqual(
				spawnCalls[0].params,
				{ agent: "worker", name: "dark-mode", task: "Ship dark mode.", cwd: fakePath, pane: "wT:p1" },
				"the worker adopts the worktree session's root pane",
			);
			assert.equal(details.branch, "feat/dark-mode");
			assert.equal(details.base, "main");
			assert.equal(details.path, fakePath);
			assert.equal(details.pane, "wT:p1");
			assert.equal(details.mode, "created");
			assert.equal(details.worker, "spawned");
		}

		// A session inside a linked worktree still addresses herdr through the
		// repo's PRIMARY checkout (herdr: "New and open worktree actions start
		// from the repo parent workspace") — never its own toplevel.
		{
			clearCalls();
			spawnCalls.length = 0;
			const repo = makeRepo();
			const linkedPath = join(root, "linked-checkout");
			gitx(["-C", repo, "worktree", "add", "-q", "-b", "feat/other", linkedPath]);
			process.env.WT_TEST_BRANCH = "feat/from-linked";
			const { isError } = await finish(
				run({ branch: "from-linked", task: "t" }, linkedPath),
			);
			assert.equal(isError, false);
			const createCall = calls()[0];
			assert.equal(createCall[1], "create");
			assert.equal(
				createCall[3], repo,
				"--cwd names the primary checkout, not the linked worktree the session sits in",
			);
			assert.equal(createCall.includes(linkedPath), false);
			assert.equal(spawnCalls[0].params.cwd, fakePath);
		}

		// A full <type>/<slug> branch is respected verbatim after normalization.
		{
			clearCalls();
			spawnCalls.length = 0;
			const repo = makeRepo();
			process.env.WT_TEST_BRANCH = "fix/pane-size";
			const { isError, details } = await finish(
				run({ branch: "fix/pane-size", task: "Fix pane size." }, repo),
			);
			assert.equal(isError, false);
			assert.equal(details.branch, "fix/pane-size");
			assert.equal(spawnCalls[0].params.name, "pane-size");
			assert.equal(spawnCalls[0].params.agent, "worker");
		}

		// An explicit agent override reaches the spawn.
		{
			spawnCalls.length = 0;
			const repo = makeRepo();
			await run({ branch: "x", task: "t", agent: "scout" }, repo);
			assert.equal(spawnCalls[0].params.agent, "scout");
		}

		// Invalid branch / missing base / base==branch: refused before any herdr call.
		for (const [params, pattern] of [
			[{ branch: "docs/readme", task: "t" }, /branch type "docs"/],
			[{ branch: "feat/a..b", task: "t" }, /\.\./],
			[{ branch: "feat/x", task: "t", base: "develop" }, /base branch "develop" does not exist locally/],
			[{ branch: "feat/x", task: "t", base: "feat/x" }, /base and branch are both feat\/x/],
		]) {
			clearCalls();
			spawnCalls.length = 0;
			const repo = makeRepo();
			const { isError, text } = await finish(run(params, repo));
			assert.equal(isError, true, JSON.stringify(params));
			assert.match(text, pattern);
			assert.equal(calls().length, 0, "no herdr call for a refused request");
			assert.equal(spawnCalls.length, 0, "no spawn for a refused request");
		}

		// Reuse: an owned, checked-out worktree is opened (never recreated).
		{
			clearCalls();
			spawnCalls.length = 0;
			const repo = makeRepo();
			const reusePath = join(root, "reuse-checkout");
			gitx(["-C", repo, "worktree", "add", "-q", "-b", "feat/reuse", reusePath]);
			gitx(["-C", repo, "config", "--local", "branch.feat/reuse.piWorktree", "pi-worktree"]);
			const { text, isError, details } = await finish(
				run({ branch: "reuse", task: "Continue the work." }, repo),
			);
			assert.equal(isError, false);
			assert.match(text, /Worktree reused/);
			assert.deepEqual(calls()[0], [
				"worktree", "open", "--cwd", repo, "--branch", "feat/reuse", "--no-focus",
			], "reuse opens the existing worktree without focus");
			assert.equal(calls().filter((c) => c[1] === "create").length, 0);
			assert.equal(spawnCalls[0].params.pane, "wT:p2");
			assert.equal(spawnCalls[0].params.cwd, reusePath, "the spawn cwd is the registered checkout path");
			assert.equal(details.mode, "reused");
			assert.equal(details.base, null, "no base applies to a reuse");
		}

		// Refusals: unowned worktree, unowned branch, gone directory.
		{
			const repo = makeRepo();
			gitx(["-C", repo, "worktree", "add", "-q", "-b", "feat/foreign", join(root, "foreign-checkout")]);
			clearCalls();
			const { isError, text } = await finish(run({ branch: "foreign", task: "t" }, repo));
			assert.equal(isError, true);
			assert.match(text, /was not created by the worktree tool/);
			assert.equal(calls().length, 0);
		}
		{
			const repo = makeRepo();
			gitx(["-C", repo, "branch", "feat/loose"]);
			clearCalls();
			const { isError, text } = await finish(run({ branch: "loose", task: "t" }, repo));
			assert.equal(isError, true);
			assert.match(text, /was not created by the worktree tool/);
		}
		{
			const repo = makeRepo();
			const gonePath = join(root, "gone-checkout");
			gitx(["-C", repo, "worktree", "add", "-q", "-b", "feat/gone", gonePath]);
			gitx(["-C", repo, "config", "--local", "branch.feat/gone.piWorktree", "pi-worktree"]);
			rmSync(gonePath, { recursive: true, force: true });
			clearCalls();
			const { isError, text } = await finish(run({ branch: "gone", task: "t" }, repo));
			assert.equal(isError, true);
			assert.match(text, /git worktree prune/);
		}

		// Owned branch without a worktree: created again, checked out, no --base.
		{
			clearCalls();
			spawnCalls.length = 0;
			const repo = makeRepo();
			gitx(["-C", repo, "branch", "feat/owned"]);
			gitx(["-C", repo, "config", "--local", "branch.feat/owned.piWorktree", "pi-worktree"]);
			process.env.WT_TEST_BRANCH = "feat/owned";
			const { isError, details } = await finish(run({ branch: "owned", task: "t" }, repo));
			assert.equal(isError, false);
			const createCall = calls()[0];
			assert.equal(createCall[1], "create");
			assert.equal(createCall.includes("--base"), false, "an existing branch is checked out, not rebased onto base");
			assert.equal(details.mode, "created-existing");
		}

		// Spawn failures keep the worktree and say so.
		{
			const repo = makeRepo();
			spawnMode = "errorDetails";
			const { isError, text } = await finish(run({ branch: "spawn-err", task: "t" }, repo));
			assert.equal(isError, true);
			assert.match(text, /The worktree is ready at/);
			assert.match(text, /mux unavailable/);
			spawnMode = "throw";
			const thrown = await finish(run({ branch: "spawn-throw", task: "t" }, repo));
			assert.equal(thrown.isError, true);
			assert.match(thrown.text, /socket exploded/);
			spawnMode = "ok";
		}

		// Missing interactive-subagents global: the worktree is still reported.
		{
			const savedFn = globalThis.__pi_interactive_subagents;
			delete globalThis.__pi_interactive_subagents;
			const repo = makeRepo();
			const { isError, text } = await finish(run({ branch: "noext", task: "t" }, repo));
			assert.equal(isError, true);
			assert.match(text, /interactive-subagents extension is not loaded/);
			assert.match(text, /The worktree is ready at/);
			globalThis.__pi_interactive_subagents = savedFn;
		}

		// herdr create failing surfaces the CLI error context.
		{
			const repo = makeRepo();
			process.env.WT_TEST_FAIL_CREATE = "1";
			const { isError, text } = await finish(run({ branch: "herdrfail", task: "t" }, repo));
			assert.equal(isError, true);
			assert.match(text, /herdr worktree create .* failed/);
			assert.match(text, /boom create/);
			delete process.env.WT_TEST_FAIL_CREATE;
		}

		// Rex: no worktree CLI, so the tool runs git itself and the Rex surface
		// opens the worker's tab instead of adopting a pane.
		{
			clearCalls();
			spawnCalls.length = 0;
			spawnMode = "ok";
			const repo = makeRepo();
			const homeRoot = mkdtempSync(join(tmpdir(), "worktree-home-"));
			const savedHome = process.env.HOME;
			delete process.env.HERDR_ENV;
			delete process.env.HERDR_PANE_ID;
			process.env.REX_SESSION = "session:test";
			process.env.REX_BLOCK = "block:test";
			process.env.HOME = homeRoot;
			try {
				const { isError, text, details } = await finish(
					run({ branch: "dark-mode", task: "Ship dark mode." }, repo),
				);
				assert.equal(isError, false, text);
				const expectedPath = join(
					realpathSync(homeRoot),
					".herdr",
					"worktrees",
					basename(repo),
					"feat-dark-mode",
				);
				assert.equal(details.surface, "rex");
				assert.equal(details.path, expectedPath, "the shared worktree root and <type>-<slug> naming");
				assert.equal(existsSync(join(expectedPath, ".git")), true, "the checkout exists on disk");
				assert.equal(details.pane, null, "Rex has no adoptable worktree pane");
				assert.deepEqual(
					Object.keys(spawnCalls[0].params).sort(),
					["agent", "cwd", "name", "task"],
					"the pane override is Herdr-only",
				);
				assert.equal(spawnCalls[0].params.cwd, expectedPath);
				assert.equal(calls().length, 0, "Rex is created with git, never through Herdr");
				assert.equal(
					gitx(["-C", repo, "config", "--local", "--get", "branch.feat/dark-mode.piWorktree"], { encoding: "utf8" }).trim(),
					"pi-worktree",
					"the Rex path keeps the same ownership marker",
				);

				// Idempotent reuse: the second call opens the same checkout.
				const again = await finish(run({ branch: "dark-mode", task: "t" }, repo));
				assert.equal(again.isError, false, again.text);
				assert.equal(again.details.mode, "reused");
				assert.equal(again.details.path, expectedPath);
			} finally {
				if (savedHome === undefined) delete process.env.HOME;
				else process.env.HOME = savedHome;
				delete process.env.REX_SESSION;
				delete process.env.REX_BLOCK;
				process.env.HERDR_ENV = "1";
				process.env.HERDR_PANE_ID = "wT:p0";
				rmSync(homeRoot, { recursive: true, force: true });
			}
		}

		// Outside a git repo, and outside Herdr/Rex: clear refusals.
		{
			const empty = mkdtempSync(join(tmpdir(), "worktree-empty-"));
			const { isError, text } = await finish(run({ branch: "x", task: "t" }, empty));
			assert.equal(isError, true);
			assert.match(text, /is not inside a Git repository/);
			rmSync(empty, { recursive: true, force: true });
		}
		{
			delete process.env.HERDR_ENV;
			const repo = makeRepo();
			const { isError, text } = await finish(run({ branch: "x", task: "t" }, repo));
			assert.equal(isError, true);
			assert.match(text, /requires a session inside Herdr or Rex/);
			process.env.HERDR_ENV = "1";
		}
	} finally {
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		for (const key of [
			"WT_TEST_CAPTURE", "WT_TEST_PANE", "WT_TEST_PATH", "WT_TEST_BRANCH",
			"WT_TEST_OPEN_PANE", "WT_TEST_OPEN_PATH", "WT_TEST_FAIL_CREATE",
		]) {
			delete process.env[key];
		}
		delete globalThis.__pi_interactive_subagents;
	}
} finally {
	rmSync(root, { recursive: true, force: true });
}
