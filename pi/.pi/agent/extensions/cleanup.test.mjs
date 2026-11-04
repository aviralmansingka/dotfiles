import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
		const message = ext.buildConfirmMessage({
			worktreePath: "/wt/fix-x",
			mainPath: "/repo",
			branch: "fix-x",
			remote: "team/origin",
			remoteBranch: "release",
			dirtyCount: 3,
			aheadCount: 2,
			upstreamGone: false,
		});
		assert.match(message, /Worktree:  \/wt\/fix-x/);
		assert.match(message, /Remote:    team\/origin branch release/);
		assert.match(message, /3 uncommitted file/);
		assert.match(message, /2 commit\(s\) not on team\/origin\/release/);
		assert.match(message, /session closes/);
		assert.doesNotMatch(message, /already gone/);
		assert.doesNotMatch(message, /remote branch is still deleted/);
	}

	{
		const message = ext.buildConfirmMessage({
			worktreePath: "/wt/fix-x",
			mainPath: "/repo",
			branch: "fix-x",
			remote: null,
			remoteBranch: null,
			dirtyCount: 0,
			aheadCount: null,
			upstreamGone: false,
		});
		assert.match(message, /local only, never pushed/);
		assert.doesNotMatch(message, /Warning/);
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
		const report = ext.executeCleanup(stepOrderFacts, (cwd, args) =>
			calls.push([cwd, args.join(" ")]),
		);
		assert.deepEqual(
			calls.map(([, cmd]) => cmd),
			["push team/origin --delete release", "worktree remove /wt/fix-x", "branch -D fix-x"],
		);
		assert.equal(report.remoteDeleted, true);
		assert.equal(report.worktreeRemoved, true);
		assert.equal(report.localBranchDeleted, true);
		assert.deepEqual(report.steps, {
			remote: { ok: true, already: false },
			worktree: { ok: true, already: false },
			branch: { ok: true, already: false },
		});
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
		);
		assert.deepEqual(
			calls.map(([, cmd]) => cmd),
			["worktree remove --force /wt/fix-x", "branch -D fix-x"],
		);
		assert.equal(report.remoteDeleted, false);
		assert.equal(report.worktreeRemoved, true);
		assert.equal(report.localBranchDeleted, true);
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
		});
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
		});
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
		});
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

	console.log("cleanup.test.mjs: all assertions passed");
} finally {
	rmSync(tempRoot, { recursive: true, force: true });
}
