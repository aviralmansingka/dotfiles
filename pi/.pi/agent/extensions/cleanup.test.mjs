import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const installRoot = join(homedir(), ".pi/agent/install");
const versionFile = join(installRoot, "current-version");
const jitiPath = [
	process.env.JITI_PATH,
	existsSync(versionFile) && join(installRoot, "releases", readFileSync(versionFile, "utf-8").trim(), "node_modules/jiti/lib/jiti.cjs"),
	"/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
	"/home/avirus/.nvm/versions/node/v22.22.3/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs",
].find((path) => path && existsSync(path));
if (!jitiPath) throw new Error("jiti not found; set JITI_PATH");
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
		});
		assert.match(message, /Worktree:  \/wt\/fix-x/);
		assert.match(message, /Remote:    team\/origin branch release/);
		assert.match(message, /3 uncommitted file/);
		assert.match(message, /2 commit\(s\) not on team\/origin\/release/);
		assert.match(message, /session closes/);
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
		});
		assert.match(message, /local only, never pushed/);
		assert.doesNotMatch(message, /Warning/);
	}

	// --- executeCleanup step order ---------------------------------------------

	{
		const calls = [];
		const report = ext.executeCleanup(
			{
				worktreePath: "/wt/fix-x",
				mainPath: "/repo",
				branch: "fix-x",
				remote: "team/origin",
				remoteBranch: "release",
				dirtyCount: 0,
				aheadCount: 0,
			},
			(cwd, args) => calls.push([cwd, args.join(" ")]),
		);
		assert.deepEqual(
			calls.map(([, cmd]) => cmd),
			["push team/origin --delete release", "worktree remove /wt/fix-x", "branch -D fix-x"],
		);
		assert.deepEqual(report, { remoteDeleted: true, worktreeRemoved: true, localBranchDeleted: true });
	}

	{
		// No upstream: remote step skipped. Dirty worktree: remove gets --force.
		const calls = [];
		ext.executeCleanup(
			{
				worktreePath: "/wt/fix-x",
				mainPath: "/repo",
				branch: "fix-x",
				remote: null,
				remoteBranch: null,
				dirtyCount: 2,
				aheadCount: null,
			},
			(cwd, args) => calls.push([cwd, args.join(" ")]),
		);
		assert.deepEqual(
			calls.map(([, cmd]) => cmd),
			["worktree remove --force /wt/fix-x", "branch -D fix-x"],
		);
	}

	{
		// A failing step throws before later steps run.
		const calls = [];
		assert.throws(() =>
			ext.executeCleanup(
				{
					worktreePath: "/wt/fix-x",
					mainPath: "/repo",
					branch: "fix-x",
					remote: "team/origin",
					remoteBranch: "release",
					dirtyCount: 0,
					aheadCount: 0,
				},
				(cwd, args) => {
					calls.push(args.join(" "));
					if (args[0] === "push") throw new Error("remote refused");
				},
			),
			/remote refused/,
		);
		assert.equal(calls.length, 1);
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

			const revListFailure = ext.collectCleanupFacts(wt, (cwd, args) => {
				if (args[0] === "rev-list") throw new Error("lookup failed");
				return run(cwd, args);
			});
			assert.equal(revListFailure.ok, false);

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

			// Dirty state counts.
			writeFileSync(join(wt, "f.txt"), "changed");
			const dirtyResult = ext.collectCleanupFacts(wt);
			assert.equal(dirtyResult.ok, true);
			assert.equal(dirtyResult.facts.dirtyCount, 1);

		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	}

	console.log("cleanup.test.mjs: all assertions passed");
} finally {
	rmSync(tempRoot, { recursive: true, force: true });
}
