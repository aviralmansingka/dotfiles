import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
			upstream: "origin/fix-x",
			remote: "origin",
			dirtyCount: 3,
			aheadCount: 2,
		});
		assert.match(message, /Worktree:  \/wt\/fix-x/);
		assert.match(message, /local \+ origin\/fix-x/);
		assert.match(message, /3 uncommitted file/);
		assert.match(message, /2 commit\(s\) not on origin\/fix-x/);
		assert.match(message, /session closes/);
	}

	{
		const message = ext.buildConfirmMessage({
			worktreePath: "/wt/fix-x",
			mainPath: "/repo",
			branch: "fix-x",
			upstream: null,
			remote: null,
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
				upstream: "origin/fix-x",
				remote: "origin",
				dirtyCount: 0,
				aheadCount: 0,
			},
			(cwd, args) => calls.push([cwd, args.join(" ")]),
		);
		assert.deepEqual(
			calls.map(([, cmd]) => cmd),
			["push origin --delete fix-x", "worktree remove /wt/fix-x", "branch -D fix-x"],
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
				upstream: null,
				remote: null,
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
					upstream: "origin/fix-x",
					remote: "origin",
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

			// Main checkout refuses.
			const mainResult = ext.collectCleanupFacts(repo);
			assert.equal(mainResult.ok, false);
			assert.match(mainResult.reason, /main checkout/);

			// Worktree facts: branch, no upstream, clean.
			const wtResult = ext.collectCleanupFacts(wt);
			assert.equal(wtResult.ok, true);
			assert.equal(wtResult.facts.branch, "feature-x");
			assert.equal(wtResult.facts.mainPath, require("node:fs").realpathSync(repo));
			assert.equal(wtResult.facts.upstream, null);
			assert.equal(wtResult.facts.dirtyCount, 0);

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
