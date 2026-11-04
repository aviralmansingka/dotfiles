// Paths: pi/.pi/agent/extensions/cleanup.ts
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveJiti } from "./test-lib/jiti.mjs";

const require = createRequire(import.meta.url);
const { jitiPath } = resolveJiti();
const { createJiti } = require(jitiPath);
const stubAgent = "exports.registerCommand = () => {};\n";
const tempRoot = mkdtempSync(join(tmpdir(), "cleanup-test-"));
const stubPi = join(tempRoot, "pi-agent.cjs");
writeFileSync(stubPi, stubAgent);
const jiti = createJiti(import.meta.url, {
	alias: { "@earendil-works/pi-coding-agent": stubPi },
});

try {
	const ext = jiti("./cleanup.ts");

	{
		const commands = new Map();
		ext.default({ registerCommand: (name, command) => commands.set(name, command) });
		const cleanup = commands.get("cleanup");
		const notifications = [];
		let confirmed = false;
		const previousSession = process.env.PI_SUBAGENT_SESSION;
		process.env.PI_SUBAGENT_SESSION = "/tmp/subagent.jsonl";
		try {
			await cleanup.handler("", {
				cwd: process.cwd(),
				ui: {
					notify: (message, level) => notifications.push([message, level]),
					confirm: async () => {
						confirmed = true;
						return true;
					},
				},
				shutdown: () => assert.fail("subagent cleanup must not shut down"),
			});
		} finally {
			if (previousSession === undefined) delete process.env.PI_SUBAGENT_SESSION;
			else process.env.PI_SUBAGENT_SESSION = previousSession;
		}
		assert.equal(confirmed, false);
		assert.deepEqual(notifications, [["Cleanup is only available in the durable parent session.", "error"]]);
	}

	// --- parseWorktreeList ----------------------------------------------------

	{
		const porcelain = [
			"worktree /home/user/dotfiles",
			"HEAD abc123",
			"branch refs/heads/main",
			"",
			"worktree /home/user/.herdr/worktrees/dotfiles/fix-x",
			"HEAD def456",
			"branch refs/heads/fix-x",
			"",
			"worktree /srv/bare.git",
			"HEAD 000000",
			"bare",
			"",
		].join("\n");
		const entries = ext.parseWorktreeList(porcelain);
		assert.equal(entries.length, 3);
		assert.equal(entries[0].path, "/home/user/dotfiles");
		assert.equal(entries[0].branch, "main");
		assert.equal(entries[1].branch, "fix-x");
		assert.equal(entries[2].bare, true);
	}

	// --- buildConfirmMessage ----------------------------------------------------

	{
		// The id is explicit: the default reads HERDR_WORKSPACE_ID, so a test
		// that runs inside Herdr and on CI would otherwise assert two answers.
		const message = ext.buildConfirmMessage(
			{
				worktreePath: "/wt/fix-x",
				mainPath: "/repo",
				branch: "fix-x",
				remote: "team/origin",
				remoteBranch: "release",
				dirtyCount: 3,
				aheadCount: 2,
				upstreamGone: false,
			},
			"w8P",
		);
		assert.match(message, /Worktree:  \/wt\/fix-x/);
		assert.match(message, /Remote:    team\/origin branch release/);
		assert.match(message, /3 uncommitted file/);
		assert.match(message, /2 commit\(s\) not on team\/origin\/release/);
		assert.match(message, /Herdr:     workspace w8P closes too/);
		assert.match(message, /session closes/);
		assert.doesNotMatch(message, /already gone/);
		assert.doesNotMatch(message, /remote branch is still deleted/);
	}

	{
		const message = ext.buildConfirmMessage(
			{
				worktreePath: "/wt/fix-x",
				mainPath: "/repo",
				branch: "fix-x",
				remote: null,
				remoteBranch: null,
				dirtyCount: 0,
				aheadCount: null,
				upstreamGone: false,
			},
			"w8P",
		);
		assert.match(message, /local only, never pushed/);
		assert.match(message, /Herdr:     workspace w8P closes too/);
		assert.doesNotMatch(message, /Warning/);
	}

	{
		// Outside Herdr the confirmation says the workspace stays.
		const message = ext.buildConfirmMessage(
			{
				worktreePath: "/wt/fix-x",
				mainPath: "/repo",
				branch: "fix-x",
				remote: null,
				remoteBranch: null,
				dirtyCount: 0,
				aheadCount: null,
				upstreamGone: false,
			},
			null,
		);
		assert.match(message, /Herdr:     no workspace id, the workspace stays/);
	}

	{
		// The remote branch was deleted upstream: say so instead of refusing.
		const message = ext.buildConfirmMessage({
			worktreePath: "/wt/fix-x",
			mainPath: "/repo",
			branch: "fix-x",
			remote: "team/origin",
			remoteBranch: "release",
			dirtyCount: 0,
			aheadCount: null,
			upstreamGone: true,
		});
		assert.match(message, /Remote branch is already gone; local teardown only\./);
		assert.doesNotMatch(message, /still deleted/);
	}

	// --- executeCleanup step order ---------------------------------------------

	// Injected Herdr runner: records the call and never touches the real CLI.
	const herdrStep = (workspaceId, calls, extra = {}) => ({
		workspaceId,
		bin: "herdr",
		run: (bin, args) => calls.push([bin, args.join(" ")]),
		...extra,
	});

	const stepOrderFacts = {
		worktreePath: "/wt/fix-x",
		mainPath: "/repo",
		branch: "fix-x",
		remote: "team/origin",
		remoteBranch: "release",
		dirtyCount: 0,
		aheadCount: 0,
		upstreamGone: false,
	};

	{
		const calls = [];
		const report = ext.executeCleanup(
			stepOrderFacts,
			(cwd, args) => calls.push([cwd, args.join(" ")]),
			herdrStep("w8P", calls),
		);
		assert.deepEqual(
			calls.map(([, cmd]) => cmd),
			[
				"push team/origin --delete release",
				"worktree remove /wt/fix-x",
				"branch -D fix-x",
				// The workspace close runs last: the close kills this session's pane.
				"workspace close w8P",
			],
		);
		assert.equal(report.remoteDeleted, true);
		assert.equal(report.worktreeRemoved, true);
		assert.equal(report.localBranchDeleted, true);
		assert.equal(report.workspaceClosed, true);
		assert.deepEqual(report.steps, {
			remote: { ok: true, already: false },
			worktree: { ok: true, already: false },
			branch: { ok: true, already: false },
			workspace: { ok: true, already: false },
		});
		assert.match(
			ext.describeCleanupReport(report),
			/Cleanup done: remote branch, worktree, local branch\. Herdr workspace closed\.$/,
		);
	}

	{
		// No upstream: remote step skipped. Dirty worktree: remove gets --force.
		const calls = [];
		const report = ext.executeCleanup(
			{
				worktreePath: "/wt/fix-x",
				mainPath: "/repo",
				branch: "fix-x",
				remote: null,
				remoteBranch: null,
				dirtyCount: 2,
				aheadCount: null,
				upstreamGone: false,
			},
			(cwd, args) => calls.push([cwd, args.join(" ")]),
			herdrStep(null, calls),
		);
		assert.deepEqual(
			calls.map(([, cmd]) => cmd),
			["worktree remove --force /wt/fix-x", "branch -D fix-x"],
		);
		assert.equal(report.remoteDeleted, false);
		assert.equal(report.worktreeRemoved, true);
		assert.equal(report.localBranchDeleted, true);
		assert.equal(report.workspaceClosed, false);
	}

	{
		// An already-deleted remote branch must not stop the local teardown.
		const calls = [];
		const report = ext.executeCleanup(stepOrderFacts, (cwd, args) => {
			calls.push(args.join(" "));
			if (args[0] === "push") {
				throw new Error(
					"error: unable to delete 'release': remote ref does not exist",
				);
			}
		}, herdrStep(null, calls));
		assert.deepEqual(calls, [
			"push team/origin --delete release",
			"worktree remove /wt/fix-x",
			"branch -D fix-x",
		]);
		assert.equal(report.remoteDeleted, true);
		assert.equal(report.steps.remote.already, true);
		assert.equal(report.steps.remote.ok, true);
		assert.equal(report.steps.remote.error, undefined);
		assert.equal(report.worktreeRemoved, true);
		assert.equal(report.localBranchDeleted, true);
		assert.match(ext.describeCleanupReport(report), /remote branch was already gone/);
	}

	{
		// An already-removed worktree must not stop the branch deletion.
		const calls = [];
		const report = ext.executeCleanup(stepOrderFacts, (cwd, args) => {
			calls.push(args.join(" "));
			if (args[0] === "worktree") {
				throw new Error(`fatal: '${args[2]}' is not a working tree`);
			}
		}, herdrStep(null, calls));
		assert.deepEqual(calls, [
			"push team/origin --delete release",
			"worktree remove /wt/fix-x",
			"branch -D fix-x",
		]);
		assert.equal(report.steps.worktree.already, true);
		assert.equal(report.worktreeRemoved, true);
		assert.equal(report.localBranchDeleted, true);
	}

	{
		// A real remote error is recorded, and the later steps still run.
		const calls = [];
		const report = ext.executeCleanup(stepOrderFacts, (cwd, args) => {
			calls.push(args.join(" "));
			if (args[0] === "push") throw new Error("fatal: permission denied");
		}, herdrStep(null, calls));
		assert.deepEqual(calls, [
			"push team/origin --delete release",
			"worktree remove /wt/fix-x",
			"branch -D fix-x",
		]);
		assert.equal(report.steps.remote.ok, false);
		assert.equal(report.steps.remote.already, false);
		assert.match(report.steps.remote.error, /permission denied/);
		assert.equal(report.remoteDeleted, false);
		assert.equal(report.worktreeRemoved, true);
		assert.equal(report.localBranchDeleted, true);
		assert.match(
			ext.describeCleanupReport(report),
			/remote branch failed: fatal: permission denied/,
		);
	}

	// --- executeCleanup Herdr workspace step -----------------------------------

	{
		// Outside Herdr there is no workspace id: the step is skipped, not failed.
		const calls = [];
		const report = ext.executeCleanup(
			stepOrderFacts,
			(cwd, args) => calls.push(args.join(" ")),
			herdrStep(null, calls),
		);
		assert.deepEqual(calls, [
			"push team/origin --delete release",
			"worktree remove /wt/fix-x",
			"branch -D fix-x",
		]);
		assert.deepEqual(report.steps.workspace, {
			ok: true,
			already: false,
			reason: "HERDR_WORKSPACE_ID is not set",
		});
		assert.equal(report.workspaceClosed, false);
		assert.equal(report.remoteDeleted, true);
		assert.equal(report.worktreeRemoved, true);
		assert.equal(report.localBranchDeleted, true);
		assert.match(
			ext.describeCleanupReport(report),
			/\bHerdr workspace not closed: HERDR_WORKSPACE_ID is not set\.$/,
		);
	}

	{
		// A failing Herdr call is a soft failure: no throw, git results still there.
		const report = ext.executeCleanup(stepOrderFacts, () => {}, {
			workspaceId: "w8P",
			bin: "herdr",
			run: () => {
				throw new Error("herdr: connection refused");
			},
		});
		assert.equal(report.steps.workspace.ok, false);
		assert.equal(report.steps.workspace.already, false);
		assert.match(report.steps.workspace.error, /connection refused/);
		assert.equal(report.workspaceClosed, false);
		assert.equal(report.remoteDeleted, true);
		assert.equal(report.worktreeRemoved, true);
		assert.equal(report.localBranchDeleted, true);
		const line = ext.describeCleanupReport(report);
		assert.match(line, /Cleanup done: remote branch, worktree, local branch\./);
		assert.match(line, /Herdr workspace not closed: herdr: connection refused\.$/);
	}

	{
		// A missing binary is a soft failure with a readable reason.
		const report = ext.executeCleanup(stepOrderFacts, () => {}, {
			workspaceId: "w8P",
			bin: "/opt/missing/herdr",
			run: (bin) => {
				const error = new Error(`spawnSync ${bin} ENOENT`);
				error.code = "ENOENT";
				throw error;
			},
		});
		assert.equal(report.steps.workspace.ok, false);
		assert.equal(report.steps.workspace.error, "/opt/missing/herdr not found");
		assert.match(
			ext.describeCleanupReport(report),
			/Herdr workspace not closed: \/opt\/missing\/herdr not found/,
		);
	}

	{
		// An already-closed workspace is reported as gone, not as a failure.
		const report = ext.executeCleanup(stepOrderFacts, () => {}, {
			workspaceId: "w8P",
			bin: "herdr",
			run: () => {
				throw new Error(
					'herdr workspace close w8P: {"error":{"code":"workspace_not_found","message":"workspace w8P not found"}}',
				);
			},
		});
		assert.equal(report.steps.workspace.ok, true);
		assert.equal(report.steps.workspace.already, true);
		assert.equal(report.workspaceClosed, false);
		assert.match(ext.describeCleanupReport(report), /Herdr workspace already gone\.$/);
	}

	{
		// A workspace that hosts the main checkout is never closed.
		const calls = [];
		const mainFacts = { ...stepOrderFacts, worktreePath: "/repo", mainPath: "/repo" };
		const report = ext.executeCleanup(
			mainFacts,
			(cwd, args) => calls.push(args.join(" ")),
			herdrStep("w1", calls),
		);
		assert.equal(calls.some((cmd) => cmd.startsWith("workspace close")), false);
		assert.deepEqual(report.steps.workspace, {
			ok: true,
			already: false,
			reason: "the workspace hosts the main checkout",
		});
		assert.equal(report.workspaceClosed, false);
		assert.match(
			ext.describeCleanupReport(report),
			/Herdr workspace not closed: the workspace hosts the main checkout\.$/,
		);
	}

	{
		// A deferred close runs nothing here: the /cleanup handler closes it later.
		const calls = [];
		const report = ext.executeCleanup(
			stepOrderFacts,
			(cwd, args) => calls.push(args.join(" ")),
			herdrStep("w8P", calls, { deferClose: true }),
		);
		assert.deepEqual(calls, [
			"push team/origin --delete release",
			"worktree remove /wt/fix-x",
			"branch -D fix-x",
		]);
		assert.equal(report.steps.workspace.pending, true);
		assert.equal(report.workspaceClosed, false);
		assert.match(ext.describeCleanupReport(report), /Herdr workspace closes next\.$/);

		// Deferred or not, closeWorkspace runs the CLI from the context it gets.
		const late = [];
		ext.closeWorkspace(stepOrderFacts, herdrStep("w8P", late));
		assert.deepEqual(late, [["herdr", "workspace close w8P"]]);
	}

	{
		// The environment picks the workspace id and the binary.
		const fromEnv = ext.herdrContext({ HERDR_WORKSPACE_ID: "w42", HERDR_BIN: "/opt/herdr" });
		assert.equal(fromEnv.workspaceId, "w42");
		assert.equal(fromEnv.bin, "/opt/herdr");
		const empty = ext.herdrContext({});
		assert.equal(empty.workspaceId, null);
		assert.equal(empty.bin, "herdr");
	}

	// --- collectCleanupFacts against a real temp repository --------------------

	{
		const run = (cwd, args) =>
			execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();

		const repo = mkdtempSync(join(tmpdir(), "cleanup-repo-"));
		try {
			run(repo, ["init", "-q", "-b", "main"]);
			run(repo, ["config", "user.email", "test@test"]);
			run(repo, ["config", "user.name", "test"]);
			writeFileSync(join(repo, "f.txt"), "x");
			writeFileSync(join(repo, ".gitignore"), ".env\n");
			run(repo, ["add", "."]);
			run(repo, ["commit", "-q", "-m", "init"]);

			const wt = join(repo, "wt");
			run(repo, ["worktree", "add", "-q", "-b", "feature-x", wt]);

			// Main checkout and its subdirectories refuse.
			const mainResult = ext.collectCleanupFacts(repo);
			assert.equal(mainResult.ok, false);
			assert.match(mainResult.reason, /main checkout/);
			const mainSubdir = join(repo, "main-subdir");
			mkdirSync(mainSubdir);
			const mainSubdirResult = ext.collectCleanupFacts(mainSubdir);
			assert.equal(mainSubdirResult.ok, false);
			assert.match(mainSubdirResult.reason, /main checkout/);

			// Worktree facts use the listed root, even from a subdirectory.
			const wtSubdir = join(wt, "subdir");
			mkdirSync(wtSubdir);
			const wtResult = ext.collectCleanupFacts(wtSubdir);
			assert.equal(wtResult.ok, true);
			assert.equal(wtResult.facts.worktreePath, realpathSync(wt));
			assert.equal(wtResult.facts.branch, "feature-x");
			assert.equal(wtResult.facts.mainPath, realpathSync(repo));
			assert.equal(wtResult.facts.remote, null);
			assert.equal(wtResult.facts.remoteBranch, null);
			assert.equal(wtResult.facts.dirtyCount, 0);

			// Every safety lookup fails closed.
			for (const failedCommand of ["for-each-ref", "status"]) {
				const failedResult = ext.collectCleanupFacts(wt, (cwd, args) => {
					if (args[0] === failedCommand) throw new Error("lookup failed");
					return run(cwd, args);
				});
				assert.equal(failedResult.ok, false);
			}

			// A remote name can contain slashes, and its branch can differ locally.
			const remoteRepo = join(tempRoot, "remote.git");
			mkdirSync(remoteRepo);
			run(remoteRepo, ["init", "-q", "--bare"]);
			run(repo, ["remote", "add", "team/origin", remoteRepo]);
			run(repo, ["push", "-q", "team/origin", "main:main"]);
			run(wt, ["push", "-q", "-u", "team/origin", "HEAD:release"]);
			const upstreamResult = ext.collectCleanupFacts(wt);
			assert.equal(upstreamResult.ok, true);
			assert.equal(upstreamResult.facts.remote, "team/origin");
			assert.equal(upstreamResult.facts.remoteBranch, "release");
			assert.equal(upstreamResult.facts.aheadCount, 0);
			assert.equal(upstreamResult.facts.upstreamGone, false);

			// A pruned upstream ref (deleted on the remote) is not a refusal: it just
			// means there is nothing to compare against.
			const revListFailure = ext.collectCleanupFacts(wt, (cwd, args) => {
				if (args[0] === "rev-list") {
					throw new Error("fatal: bad revision 'refs/remotes/team/origin/release..HEAD'");
				}
				return run(cwd, args);
			});
			assert.equal(revListFailure.ok, true);
			assert.equal(revListFailure.facts.aheadCount, null);
			assert.equal(revListFailure.facts.upstreamGone, true);
			assert.match(
				ext.buildConfirmMessage(revListFailure.facts),
				/already gone; local teardown only/,
			);
			assert.equal(revListFailure.facts.dirtyCount, upstreamResult.facts.dirtyCount);

			// Non-throwing garbage output still fails closed.
			const revListGarbage = ext.collectCleanupFacts(wt, (cwd, args) => {
				if (args[0] === "rev-list") return "not-a-number";
				return run(cwd, args);
			});
			assert.equal(revListGarbage.ok, false);
			assert.match(revListGarbage.reason, /upstream comparison is invalid/);

			run(wt, ["branch", "--set-upstream-to", "team/origin/main", "feature-x"]);
			const protectedRemoteResult = ext.collectCleanupFacts(wt);
			assert.equal(protectedRemoteResult.ok, false);
			assert.match(protectedRemoteResult.reason, /protected remote branch/);

			run(repo, ["remote", "add", "self", "."]);
			run(repo, ["update-ref", "refs/remotes/self/safe", "HEAD"]);
			run(wt, ["config", "branch.feature-x.remote", "self"]);
			run(wt, ["config", "branch.feature-x.merge", "refs/heads/safe"]);
			const localRemoteResult = ext.collectCleanupFacts(wt);
			assert.equal(localRemoteResult.ok, false);
			assert.match(localRemoteResult.reason, /points to this repository/);

			run(wt, ["branch", "--set-upstream-to", "team/origin/release", "feature-x"]);
			run(wt, ["config", "--add", "remote.team/origin.pushurl", remoteRepo]);
			run(wt, ["config", "--add", "remote.team/origin.pushurl", "."]);
			const mixedRemoteResult = ext.collectCleanupFacts(wt);
			assert.equal(mixedRemoteResult.ok, false);
			assert.match(mixedRemoteResult.reason, /points to this repository/);
			run(wt, ["config", "--unset-all", "remote.team/origin.pushurl"]);

			// Dirty state counts tracked and ignored data.
			writeFileSync(join(wt, "f.txt"), "changed");
			writeFileSync(join(wt, ".env"), "secret");
			const dirtyResult = ext.collectCleanupFacts(wt);
			assert.equal(dirtyResult.ok, true);
			assert.equal(dirtyResult.facts.dirtyCount, 2);

		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	}

	// --- /cleanup handler: notify first, then close, then shutdown -------------

	{
		const run = (cwd, args) =>
			execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
		const repo = mkdtempSync(join(tmpdir(), "cleanup-handler-"));
		const log = join(repo, "herdr-calls.log");
		const stubHerdr = join(repo, "herdr-stub");
		writeFileSync(stubHerdr, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\n`);
		chmodSync(stubHerdr, 0o755);
		const saved = {
			workspace: process.env.HERDR_WORKSPACE_ID,
			bin: process.env.HERDR_BIN,
			subagent: process.env.PI_SUBAGENT_SESSION,
		};
		try {
			run(repo, ["init", "-q", "-b", "main"]);
			run(repo, ["config", "user.email", "test@test"]);
			run(repo, ["config", "user.name", "test"]);
			writeFileSync(join(repo, "f.txt"), "x");
			run(repo, ["add", "."]);
			run(repo, ["commit", "-q", "-m", "init"]);
			const wt = join(repo, "wt-workspace");
			run(repo, ["worktree", "add", "-q", "-b", "feat-workspace", wt]);

			// The stub binary stands in for Herdr, so no real workspace can close.
			process.env.HERDR_WORKSPACE_ID = "wTEST";
			process.env.HERDR_BIN = stubHerdr;
			delete process.env.PI_SUBAGENT_SESSION;

			const commands = new Map();
			ext.default({ registerCommand: (name, command) => commands.set(name, command) });
			const events = [];
			const notifications = [];
			await commands.get("cleanup").handler("", {
				cwd: wt,
				ui: {
					notify: (message, level) => {
						events.push("notify");
						notifications.push([message, level]);
					},
					confirm: async () => true,
				},
				shutdown: () => events.push("shutdown"),
			});

			// The report and "Closing session." land before the timer fires, and
			// nothing closes the workspace yet.
			assert.deepEqual(events, ["notify", "notify"]);
			assert.equal(existsSync(log), false);
			assert.equal(notifications[0][1], "info");
			assert.match(notifications[0][0], /Cleanup done: worktree, local branch\./);
			assert.match(notifications[0][0], /Herdr workspace closes next\.$/);
			assert.deepEqual(notifications[1], ["Closing session.", "info"]);

			await new Promise((resolveDelay) => setTimeout(resolveDelay, 1500));

			// The delayed callback closed the workspace, then shut the session down.
			assert.equal(events.at(-1), "shutdown");
			assert.equal(events.filter((event) => event === "shutdown").length, 1);
			assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), ["workspace close wTEST"]);

			// The git teardown really ran: no worktree, no branch.
			assert.equal(existsSync(wt), false);
			assert.equal(run(repo, ["branch", "--list", "feat-workspace"]), "");
		} finally {
			if (saved.workspace === undefined) delete process.env.HERDR_WORKSPACE_ID;
			else process.env.HERDR_WORKSPACE_ID = saved.workspace;
			if (saved.bin === undefined) delete process.env.HERDR_BIN;
			else process.env.HERDR_BIN = saved.bin;
			if (saved.subagent === undefined) delete process.env.PI_SUBAGENT_SESSION;
			else process.env.PI_SUBAGENT_SESSION = saved.subagent;
			rmSync(repo, { recursive: true, force: true });
		}
	}

	console.log("cleanup.test.mjs: all assertions passed");
} finally {
	rmSync(tempRoot, { recursive: true, force: true });
}
