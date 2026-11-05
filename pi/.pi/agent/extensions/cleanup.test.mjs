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

const gitRun = (cwd, args) =>
	execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();

/** A temp repository with one linked worktree, named by the caller. */
const tempRepo = (prefix, worktreeName) => {
	const repo = mkdtempSync(join(tempRoot, prefix));
	gitRun(repo, ["init", "-q", "-b", "main"]);
	gitRun(repo, ["config", "user.email", "test@test"]);
	gitRun(repo, ["config", "user.name", "test"]);
	writeFileSync(join(repo, "f.txt"), "x");
	gitRun(repo, ["add", "."]);
	gitRun(repo, ["commit", "-q", "-m", "init"]);
	const branch = `feat-${worktreeName}`;
	const wt = join(repo, worktreeName);
	gitRun(repo, ["worktree", "add", "-q", "-b", branch, wt]);
	return { repo, wt, branch };
};

try {
	const ext = jiti("./cleanup.ts");

	// --- /cleanup handler: the spawn guard -------------------------------------
	//
	// The guard keys on PI_SUBAGENT_NAME alone. A captain that `mission launch`
	// deployed carries PI_SUBAGENT_SESSION as a child-target hint, so it must be
	// allowed to clean up; a trooper carries PI_SUBAGENT_NAME and is refused.
	// Both calls run against a temp repository with a stub `mission` on PATH, so
	// neither one can reach this checkout's teardown.
	{
		const { repo, wt, branch } = tempRepo("cleanup-guard-", "wt-guard");
		const stubDir = mkdtempSync(join(tempRoot, "guard-bin-"));
		// An empty mission list keeps the real vault out of the test; the Rex step
		// is skipped because REX_SESSION is cleared.
		writeFileSync(join(stubDir, "mission"), '#!/bin/sh\nprintf \'%s\' \'{"ok":true,"data":[]}\'\n');
		chmodSync(join(stubDir, "mission"), 0o755);
		const saved = {
			path: process.env.PATH,
			workspace: process.env.HERDR_WORKSPACE_ID,
			missionBin: process.env.MISSION_BIN,
			rex: process.env.REX_SESSION,
			rexBin: process.env.REX_BIN,
			subagentSession: process.env.PI_SUBAGENT_SESSION,
			subagentName: process.env.PI_SUBAGENT_NAME,
		};
		const runHandler = async (cwd) => {
			const commands = new Map();
			ext.default({ registerCommand: (name, command) => commands.set(name, command) });
			const events = [];
			const notifications = [];
			let confirmed = false;
			await commands.get("cleanup").handler("", {
				cwd,
				ui: {
					notify: (message, level) => {
						events.push("notify");
						notifications.push([message, level]);
					},
					confirm: async () => {
						events.push("confirm");
						confirmed = true;
						return true;
					},
				},
				shutdown: () => events.push("shutdown"),
			});
			// Let the deferred closers and the shutdown run before assertions.
			await new Promise((resolveDelay) => setTimeout(resolveDelay, 900));
			return { events, notifications, confirmed };
		};
		try {
			process.env.PATH = `${stubDir}:${saved.path}`;
			delete process.env.HERDR_WORKSPACE_ID;
			delete process.env.MISSION_BIN;
			delete process.env.REX_SESSION;
			delete process.env.REX_BIN;

			// A spawned agent is refused before anything is listed or deleted.
			process.env.PI_SUBAGENT_NAME = "trooper-s03";
			process.env.PI_SUBAGENT_SESSION = "/tmp/trooper-s03.jsonl";
			const refused = await runHandler(wt);
			assert.deepEqual(refused.notifications, [
				[
					'Cleanup runs in the session that owns this worktree; this session is the subagent "trooper-s03".',
					"error",
				],
			]);
			assert.deepEqual(refused.events, ["notify"]);
			assert.equal(refused.confirmed, false);
			assert.equal(existsSync(wt), true);

			// A captain carrying the hint is a durable session: it cleans up. Against
			// the old PI_SUBAGENT_SESSION guard this call would be refused instead.
			delete process.env.PI_SUBAGENT_NAME;
			process.env.PI_SUBAGENT_SESSION = "/tmp/captain.jsonl";
			const allowed = await runHandler(wt);
			assert.equal(allowed.confirmed, true);
			assert.equal(allowed.events.filter((event) => event === "shutdown").length, 1);
			assert.equal(allowed.events.at(-1), "shutdown");
			assert.equal(allowed.notifications[0][1], "info");
			assert.match(allowed.notifications[0][0], /Cleanup done: worktree, local branch\./);
			assert.doesNotMatch(allowed.notifications[0][0], /Rex/);
			assert.equal(existsSync(wt), false);
			assert.equal(gitRun(repo, ["branch", "--list", branch]), "");
		} finally {
			if (saved.path === undefined) delete process.env.PATH;
			else process.env.PATH = saved.path;
			if (saved.workspace === undefined) delete process.env.HERDR_WORKSPACE_ID;
			else process.env.HERDR_WORKSPACE_ID = saved.workspace;
			if (saved.missionBin === undefined) delete process.env.MISSION_BIN;
			else process.env.MISSION_BIN = saved.missionBin;
			if (saved.rex === undefined) delete process.env.REX_SESSION;
			else process.env.REX_SESSION = saved.rex;
			if (saved.rexBin === undefined) delete process.env.REX_BIN;
			else process.env.REX_BIN = saved.rexBin;
			if (saved.subagentSession === undefined) delete process.env.PI_SUBAGENT_SESSION;
			else process.env.PI_SUBAGENT_SESSION = saved.subagentSession;
			if (saved.subagentName === undefined) delete process.env.PI_SUBAGENT_NAME;
			else process.env.PI_SUBAGENT_NAME = saved.subagentName;
			rmSync(repo, { recursive: true, force: true });
		}
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

	{
		// A bound mission is named, and unfinished steps are a warning.
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
			{ handle: "dotfiles/nix-fleet", unfinished: ["S02", "S03"] },
		);
		assert.match(message, /Mission:   dotfiles\/nix-fleet closes too/);
		assert.match(message, /mission steps not passed: S02, S03/);

		// A finished mission says nothing about steps.
		const finishedFacts = {
			worktreePath: "/wt/fix-x",
			mainPath: "/repo",
			branch: "fix-x",
			remote: null,
			remoteBranch: null,
			dirtyCount: 0,
			aheadCount: null,
			upstreamGone: false,
		};
		const done = ext.buildConfirmMessage(finishedFacts, "w8P", {
			handle: "dotfiles/nix-fleet",
			unfinished: [],
		});
		assert.match(done, /Mission:   dotfiles\/nix-fleet closes too/);
		assert.doesNotMatch(done, /steps not passed/);
		// No binding: the dialog says nothing about a mission.
		assert.doesNotMatch(ext.buildConfirmMessage(finishedFacts, "w8P"), /Mission:/);
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
			mission: { ok: true, already: false, skipped: true },
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

	// --- mission record step ---------------------------------------------------

	const missionDir = mkdtempSync(join(tempRoot, "mission-wt-"));
	const otherDir = mkdtempSync(join(tempRoot, "mission-other-"));
	const listedRecord = (cwd, handle = "dotfiles/nix-fleet", stepStatus = { S01: "passed", S02: "pending" }) => ({
		handle,
		mission: { steps: [{ id: "S01" }, { id: "S02" }] },
		state: {
			status: "running",
			steps: Object.fromEntries(Object.entries(stepStatus).map(([id, status]) => [id, { status }])),
			runtime: { cwd },
		},
	});
	const listed = (records) => JSON.stringify({ ok: true, data: records });

	{
		// The binding is the record whose runtime.cwd is this worktree, by realpath.
		const calls = [];
		const binding = ext.detectMissionBinding(missionDir, (args) => {
			calls.push(args.join(" "));
			return listed([
				listedRecord(otherDir),
				listedRecord(missionDir),
				// A record with no runtime binding never matches.
				{ handle: "dotfiles/unbound", mission: { steps: [] }, state: { status: "ready" } },
			]);
		});
		assert.deepEqual(calls, ["--json list"]);
		assert.deepEqual(binding, { handle: "dotfiles/nix-fleet", unfinished: ["S02"] });
	}

	{
		// No matching record, no binary, and unreadable output all skip the step.
		assert.equal(ext.detectMissionBinding(missionDir, () => listed([listedRecord(otherDir)])), null);
		assert.equal(
			ext.detectMissionBinding(missionDir, () => {
				throw new Error("spawnSync mission ENOENT");
			}),
			null,
		);
		assert.equal(ext.detectMissionBinding(missionDir, () => "not json"), null);
		assert.equal(ext.detectMissionBinding(missionDir, () => listed("nope")), null);
	}

	{
		// close runs the documented force contract with the cleanup note.
		const calls = [];
		const result = ext.closeMission({ handle: "dotfiles/nix-fleet", unfinished: ["S02"] }, (args) => {
			calls.push(args.join(" "));
			return JSON.stringify({ ok: true, data: { handle: "dotfiles/nix-fleet", status: "closed" } });
		});
		assert.deepEqual(calls, [
			`--json close dotfiles/nix-fleet --note ${ext.MISSION_CLOSE_NOTE} --force`,
		]);
		assert.deepEqual(result, { ok: true, already: false });
	}

	{
		// A second close is reported as already closed, never as a failure.
		const result = ext.closeMission({ handle: "dotfiles/nix-fleet", unfinished: [] }, () =>
			JSON.stringify({ ok: true, data: { handle: "dotfiles/nix-fleet", status: "closed", already: true } }),
		);
		assert.deepEqual(result, { ok: true, already: true });
	}

	{
		// A real close failure is recorded with its message.
		const thrown = ext.closeMission({ handle: "dotfiles/nix-fleet", unfinished: [] }, () => {
			throw new Error("Error: mission close dotfiles/nix-fleet: vault is locked");
		});
		assert.equal(thrown.ok, false);
		assert.match(thrown.error, /vault is locked/);
		const refused = ext.closeMission({ handle: "dotfiles/nix-fleet", unfinished: [] }, () =>
			JSON.stringify({ ok: false, error: { code: "unfinished", message: "still open" } }),
		);
		assert.equal(refused.ok, false);
		assert.match(refused.error, /still open/);
	}

	{
		// The mission step runs first, then the git steps, then the workspace.
		const timeline = [];
		const report = ext.executeCleanup(
			stepOrderFacts,
			(cwd, args) => timeline.push(args.join(" ")),
			herdrStep("w8P", timeline),
			{
				binding: { handle: "dotfiles/nix-fleet", unfinished: [] },
				run: (args) => {
					timeline.push(args.join(" "));
					return JSON.stringify({ ok: true, data: { status: "closed" } });
				},
			},
		);
		assert.deepEqual(timeline, [
			`--json close dotfiles/nix-fleet --note ${ext.MISSION_CLOSE_NOTE} --force`,
			"push team/origin --delete release",
			"worktree remove /wt/fix-x",
			"branch -D fix-x",
			["herdr", "workspace close w8P"],
		]);
		assert.deepEqual(report.steps.mission, { ok: true, already: false });
		assert.equal(report.missionClosed, true);
		assert.equal(report.missionHandle, "dotfiles/nix-fleet");
		assert.match(
			ext.describeCleanupReport(report),
			/Mission record dotfiles\/nix-fleet closed; Herdr workspace closed\.$/,
		);
	}

	{
		// No binding: the step is skipped and the report says nothing about it.
		const timeline = [];
		const report = ext.executeCleanup(
			stepOrderFacts,
			(cwd, args) => timeline.push(args.join(" ")),
			herdrStep("w8P", timeline),
			{ binding: null, run: () => assert.fail("skipped mission must not run") },
		);
		assert.deepEqual(report.steps.mission, { ok: true, already: false, skipped: true });
		assert.equal(report.missionClosed, false);
		assert.equal(report.missionHandle, null);
		assert.doesNotMatch(ext.describeCleanupReport(report), /[Mm]ission/);
		// Called without a mission context at all, the report is unchanged too.
		const plain = ext.executeCleanup(stepOrderFacts, () => {}, herdrStep("w8P", []));
		assert.deepEqual(plain.steps.mission, { ok: true, already: false, skipped: true });
		assert.doesNotMatch(ext.describeCleanupReport(plain), /[Mm]ission/);
	}

	{
		// A failed close is a best-effort step: everything else still runs.
		const timeline = [];
		const report = ext.executeCleanup(
			stepOrderFacts,
			(cwd, args) => timeline.push(args.join(" ")),
			herdrStep("w8P", timeline),
			{
				binding: { handle: "dotfiles/nix-fleet", unfinished: ["S02"] },
				run: () => {
					throw new Error("mission close failed: vault is read-only");
				},
			},
		);
		assert.equal(report.steps.mission.ok, false);
		assert.equal(report.missionClosed, false);
		assert.equal(report.worktreeRemoved, true);
		assert.deepEqual(timeline, [
			"push team/origin --delete release",
			"worktree remove /wt/fix-x",
			"branch -D fix-x",
			["herdr", "workspace close w8P"],
		]);
		assert.match(
			ext.describeCleanupReport(report),
			/Mission record dotfiles\/nix-fleet not closed: mission close failed: vault is read-only/,
		);
	}

	// --- Rex session teardown --------------------------------------------------

	{
		// The worktree directory name is the session label, mission-<slug>.
		const rexRoot = mkdtempSync(join(tempRoot, "rex-wt-"));
		const rexWt = join(rexRoot, "mission-fix-x");
		const nested = join(rexWt, "sub");
		mkdirSync(nested, { recursive: true });
		const rexFacts = { ...stepOrderFacts, worktreePath: rexWt, mainPath: rexRoot };
		const bound = { handle: "dotfiles/fix-x", unfinished: [] };

		// The label is `mission-<slug of the handle>`; a handle that names nothing
		// has no label, so the step refuses instead of guessing.
		assert.equal(ext.missionSessionLabel("dotfiles/cleanup-rex-sessions"), "mission-cleanup-rex-sessions");
		assert.equal(ext.missionSessionLabel("dotfiles/Fix X"), "mission-fix-x");
		assert.equal(ext.missionSessionLabel("dotfiles/..."), null);
		assert.equal(ext.missionSessionLabel(""), null);
		// No derivation can produce the army, so it is never a target.
		assert.notEqual(ext.missionSessionLabel("dotfiles/army"), "army");

		// Only the worktree's own mission label is a target, and only by exact name.
		assert.deepEqual(ext.rexTarget(rexFacts, null), {
			ok: false,
			reason: "no mission record is bound to this worktree, so no session label is known",
		});
		assert.deepEqual(ext.rexTarget(rexFacts, bound), { ok: true, label: "mission-fix-x" });
		assert.deepEqual(ext.rexTarget(rexFacts, { handle: "dotfiles/other", unfinished: [] }), {
			ok: false,
			reason: "session mission-other does not match worktree mission-fix-x",
		});

		// The environment picks the session and the binary; no session, no Rex.
		const fromEnv = ext.rexContext({ REX_SESSION: "mission-fix-x", REX_BIN: "/opt/rex" });
		assert.equal(fromEnv.session, "mission-fix-x");
		assert.equal(fromEnv.bin, "/opt/rex");
		const outsideRex = ext.rexContext({});
		assert.equal(outsideRex.session, null);
		assert.equal(outsideRex.bin, "rex");

		const inspected = (overrides = {}) =>
			JSON.stringify({
				session_id: "rex-1",
				label: "mission-fix-x",
				windows: [{ layers: [{ blocks: [{ block_id: "b1" }, { block_id: "b2" }] }] }],
				...overrides,
			});
		const blockProcess = (cwd, ancestors = []) =>
			JSON.stringify({ foreground: { cwd }, ancestors: ancestors.map((dir) => ({ cwd: dir })) });
		// Injected Rex runner: records every argv and answers from the case.
		const rexStub = (answers) => {
			const calls = [];
			const run = (bin, args) => {
				calls.push([bin, args.join(" ")]);
				const answer = answers(args);
				if (answer instanceof Error) throw answer;
				return answer;
			};
			return {
				calls,
				ctx: (extra = {}) => ({ session: "mission-fix-x", bin: "rex", run, ...extra }),
			};
		};
		const kills = (calls) => calls.filter(([, cmd]) => cmd.startsWith("session kill")).length;

		{
			// The matching mission session is inspected, checked block by block,
			// then killed by the id that inspect printed.
			const stub = rexStub((args) =>
				args[0] === "session" ? inspected() : blockProcess(nested),
			);
			const result = ext.closeRexSession(rexFacts, bound, stub.ctx());
			assert.deepEqual(result, { ok: true, already: false });
			assert.deepEqual(stub.calls, [
				["rex", "session inspect mission-fix-x --json"],
				// A block's cwd comes from `rex block call … process`, not inspect.
				["rex", "block call -b b1 process"],
				["rex", "block call -b b2 process"],
				["rex", "session kill rex-1"],
			]);
			assert.equal(ext.describeRexStep(result), "Rex session destroyed");
		}

		{
			// The army session is never destroyed: its label is not this worktree's
			// mission label, so the kill never runs.
			const stub = rexStub((args) =>
				args[0] === "session" ? inspected({ label: "army", session_id: "army-1" }) : blockProcess(nested),
			);
			const result = ext.closeRexSession(rexFacts, bound, stub.ctx({ session: "army" }));
			assert.equal(result.ok, false);
			assert.equal(result.error, 'session army is labelled "army", not "mission-fix-x"');
			assert.equal(kills(stub.calls), 0);
			assert.deepEqual(stub.calls, [["rex", "session inspect army --json"]]);
			assert.match(ext.describeRexStep(result), /^Rex session not destroyed: session army is labelled/);
		}

		{
			// A session that holds a block running in another checkout is refused,
			// because this session does not own every window in it.
			const stub = rexStub((args) =>
				args[0] === "session" ? inspected() : blockProcess(otherDir),
			);
			const result = ext.closeRexSession(rexFacts, bound, stub.ctx());
			assert.equal(result.ok, false);
			assert.equal(
				result.error,
				`the session holds a block running in ${otherDir}, outside ${rexWt}`,
			);
			assert.equal(kills(stub.calls), 0);
		}

		{
			// A missing binary is a soft failure: a report line, never a throw.
			const stub = rexStub(() => {
				const error = new Error("spawnSync rex ENOENT");
				error.code = "ENOENT";
				return error;
			});
			const result = ext.closeRexSession(rexFacts, bound, stub.ctx());
			assert.deepEqual(result, { ok: false, already: false, error: "rex not found" });
			assert.equal(kills(stub.calls), 0);
			assert.equal(ext.describeRexStep(result), "Rex session not destroyed: rex not found");
		}

		{
			// An already-gone session and unreadable output are both soft failures.
			const gone = rexStub(
				() => new Error('rex session inspect mission-fix-x --json: {"error":{"message":"session mission-fix-x not found"}}'),
			);
			assert.deepEqual(ext.closeRexSession(rexFacts, bound, gone.ctx()), {
				ok: true,
				already: true,
			});
			assert.equal(ext.describeRexStep({ ok: true, already: true }), "Rex session was already gone");

			const garbage = rexStub(() => "not json");
			assert.deepEqual(ext.closeRexSession(rexFacts, bound, garbage.ctx()), {
				ok: false,
				already: false,
				error: "rex session inspect printed no JSON",
			});

			// A block whose directory cannot be read blocks the kill as well.
			const unreadable = rexStub((args) => {
				if (args[0] === "session") return inspected();
				return new Error("rex block call -b b1 process: boom");
			});
			const unreadableResult = ext.closeRexSession(rexFacts, bound, unreadable.ctx());
			assert.equal(unreadableResult.ok, false);
			assert.match(unreadableResult.error, /the session holds block b1, which cannot be checked/);
			assert.equal(kills(unreadable.calls), 0);
		}

		{
			// No Rex session means the step says nothing at all; a session that
			// hosts the main checkout is named but never destroyed.
			const noSession = rexStub(() => assert.fail("no session must not run rex"));
			assert.deepEqual(ext.closeRexSession(rexFacts, bound, noSession.ctx({ session: null })), {
				ok: true,
				already: false,
				skipped: true,
			});
			assert.deepEqual(noSession.calls, []);
			assert.equal(ext.describeRexStep({ ok: true, already: false, skipped: true }), "");
			assert.deepEqual(
				ext.closeRexSession({ ...rexFacts, worktreePath: rexRoot, mainPath: rexRoot }, bound, noSession.ctx()),
				{ ok: true, already: false, reason: "the session hosts the main checkout" },
			);
		}

		{
			// A deferred close runs nothing here and reports `pending`, so the report
			// says the session closes next; the worktree is already gone by then.
			const stub = rexStub(() => assert.fail("a deferred rex close must not run"));
			const report = ext.executeCleanup(
				rexFacts,
				() => {},
				herdrStep(null, []),
				{ binding: bound, run: () => JSON.stringify({ ok: true, data: {} }) },
				stub.ctx({ deferClose: true }),
			);
			assert.deepEqual(stub.calls, []);
			assert.deepEqual(report.rex, { ok: true, already: false, pending: true });
			assert.equal(report.rexSessionDestroyed, false);
			assert.match(ext.describeCleanupReport(report), /Rex session closes next\.$/);

			// Without a Rex context the step is skipped, and the report stays silent.
			const plain = ext.executeCleanup(rexFacts, () => {}, herdrStep(null, []));
			assert.deepEqual(plain.rex, { ok: true, already: false, skipped: true });
			assert.doesNotMatch(ext.describeCleanupReport(plain), /\bRex\b/);
		}
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
			name: process.env.PI_SUBAGENT_NAME,
			rex: process.env.REX_SESSION,
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
			// This suite can itself run inside a subagent; the spawn guard would then
			// refuse before any teardown and break every assertion below.
			delete process.env.PI_SUBAGENT_NAME;
			// Inside a Rex captain this suite inherits REX_SESSION; the handler would
			// then append a Rex line and break the report anchor asserted below.
			delete process.env.REX_SESSION;

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
			if (saved.name === undefined) delete process.env.PI_SUBAGENT_NAME;
			else process.env.PI_SUBAGENT_NAME = saved.name;
			if (saved.rex === undefined) delete process.env.REX_SESSION;
			else process.env.REX_SESSION = saved.rex;
			rmSync(repo, { recursive: true, force: true });
		}
	}

	// --- /cleanup handler: the mission record closes with the worktree --------

	{
		const gitRun = (cwd, args) =>
			execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
		const handlerRepo = () => {
			const repo = mkdtempSync(join(tmpdir(), "cleanup-mission-"));
			gitRun(repo, ["init", "-q", "-b", "main"]);
			gitRun(repo, ["config", "user.email", "test@test"]);
			gitRun(repo, ["config", "user.name", "test"]);
			writeFileSync(join(repo, "f.txt"), "x");
			gitRun(repo, ["add", "."]);
			gitRun(repo, ["commit", "-q", "-m", "init"]);
			const wt = join(repo, "wt-mission");
			gitRun(repo, ["worktree", "add", "-q", "-b", "feat-mission", wt]);
			return { repo, wt };
		};
		// A stub `mission` on PATH stands in for the real CLI: it logs its
		// arguments, answers `--json list`, and answers the close call.
		const stubMission = (name, { records, closeFails = false }) => {
			const dir = mkdtempSync(join(tempRoot, `mission-bin-${name}-`));
			const log = join(dir, "mission-calls.log");
			const list = join(dir, "mission-list.json");
			writeFileSync(list, JSON.stringify({ ok: true, data: records }));
			const body = JSON.stringify({ ok: true, data: { handle: "dotfiles/nix-fleet", status: "closed" } });
			const tail = closeFails
				? `printf '%s' '${body}' >&2\nexit 1\n`
				: `printf '%s' '${body}'\n`;
			writeFileSync(
				join(dir, "mission"),
				`#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\nif [ "$2" = "list" ]; then cat "${list}"; exit 0; fi\n${tail}`,
			);
			chmodSync(join(dir, "mission"), 0o755);
			return { dir, log };
		};
		const runHandler = async (wt) => {
			const commands = new Map();
			ext.default({ registerCommand: (name, command) => commands.set(name, command) });
			const events = [];
			const notifications = [];
			const confirms = [];
			await commands.get("cleanup").handler("", {
				cwd: wt,
				ui: {
					notify: (message, level) => {
						events.push("notify");
						notifications.push([message, level]);
					},
					confirm: async (_title, message) => {
						events.push("confirm");
						confirms.push(message);
						return true;
					},
				},
				shutdown: () => events.push("shutdown"),
			});
			// Let the deferred workspace close and shutdown run before cleanup.
			await new Promise((resolveDelay) => setTimeout(resolveDelay, 900));
			return { events, notifications, confirms };
		};
		const saved = {
			path: process.env.PATH,
			workspace: process.env.HERDR_WORKSPACE_ID,
			missionBin: process.env.MISSION_BIN,
			subagent: process.env.PI_SUBAGENT_SESSION,
			name: process.env.PI_SUBAGENT_NAME,
			rex: process.env.REX_SESSION,
		};
		try {
			delete process.env.HERDR_WORKSPACE_ID;
			delete process.env.MISSION_BIN;
			delete process.env.PI_SUBAGENT_SESSION;
			// A suite that runs inside a subagent carries PI_SUBAGENT_NAME, which
			// would refuse the cleanup; REX_SESSION would add a report line.
			delete process.env.PI_SUBAGENT_NAME;
			delete process.env.REX_SESSION;

			// Case 1: a bound mission with an unfinished step is named, then closed.
			{
				const { repo, wt } = handlerRepo();
				const stub = stubMission("bound", {
					records: [listedRecord(realpathSync(wt), "dotfiles/nix-fleet")],
				});
				process.env.PATH = `${stub.dir}:${saved.path}`;
				try {
					const { notifications, confirms } = await runHandler(wt);
					assert.match(confirms[0], /Mission:   dotfiles\/nix-fleet closes too/);
					assert.match(confirms[0], /mission steps not passed: S02/);
					assert.match(notifications[0][0], /Mission record dotfiles\/nix-fleet closed/);
					assert.match(notifications[0][0], /Cleanup done: worktree, local branch\./);
					assert.equal(notifications[0][1], "info");
					const calls = readFileSync(stub.log, "utf8").trim().split("\n");
					assert.deepEqual(calls, [
						"--json list",
						`--json close dotfiles/nix-fleet --note ${ext.MISSION_CLOSE_NOTE} --force`,
					]);
					assert.equal(existsSync(wt), false);
					assert.equal(gitRun(repo, ["branch", "--list", "feat-mission"]), "");
				} finally {
					rmSync(repo, { recursive: true, force: true });
				}
			}

			// Case 2: a failed close is reported, and the worktree still goes.
			{
				const { repo, wt } = handlerRepo();
				const stub = stubMission("failing", {
					records: [listedRecord(realpathSync(wt), "dotfiles/nix-fleet")],
					closeFails: true,
				});
				process.env.PATH = `${stub.dir}:${saved.path}`;
				try {
					const { notifications } = await runHandler(wt);
					assert.equal(notifications[0][1], "warning");
					assert.match(
						notifications[0][0],
						/Mission record dotfiles\/nix-fleet not closed: .*dotfiles\/nix-fleet/,
					);
					assert.deepEqual(readFileSync(stub.log, "utf8").trim().split("\n"), [
						"--json list",
						`--json close dotfiles/nix-fleet --note ${ext.MISSION_CLOSE_NOTE} --force`,
					]);
					assert.equal(existsSync(wt), false);
					assert.equal(gitRun(repo, ["branch", "--list", "feat-mission"]), "");
				} finally {
					rmSync(repo, { recursive: true, force: true });
				}
			}

			// Case 3: no binding for this worktree means no close and no mention.
			{
				const { repo, wt } = handlerRepo();
				const stub = stubMission("unbound", { records: [listedRecord(otherDir)] });
				process.env.PATH = `${stub.dir}:${saved.path}`;
				try {
					const { notifications, confirms } = await runHandler(wt);
					assert.doesNotMatch(confirms[0], /Mission:/);
					assert.doesNotMatch(notifications[0][0], /[Mm]ission/);
					assert.deepEqual(readFileSync(stub.log, "utf8").trim().split("\n"), ["--json list"]);
					assert.equal(existsSync(wt), false);
				} finally {
					rmSync(repo, { recursive: true, force: true });
				}
			}
		} finally {
			if (saved.path === undefined) delete process.env.PATH;
			else process.env.PATH = saved.path;
			if (saved.workspace === undefined) delete process.env.HERDR_WORKSPACE_ID;
			else process.env.HERDR_WORKSPACE_ID = saved.workspace;
			if (saved.missionBin === undefined) delete process.env.MISSION_BIN;
			else process.env.MISSION_BIN = saved.missionBin;
			if (saved.subagent === undefined) delete process.env.PI_SUBAGENT_SESSION;
			else process.env.PI_SUBAGENT_SESSION = saved.subagent;
			if (saved.name === undefined) delete process.env.PI_SUBAGENT_NAME;
			else process.env.PI_SUBAGENT_NAME = saved.name;
			if (saved.rex === undefined) delete process.env.REX_SESSION;
			else process.env.REX_SESSION = saved.rex;
		}
	}

	// --- /cleanup handler: the Rex session teardown ----------------------------
	//
	// The kill is `rex session kill <session_id>`, on the id printed by
	// `rex session inspect <REX_SESSION> --json`, and it runs from the shutdown
	// callback after the worktree is gone. A stub `rex` on PATH logs every argv,
	// so no real session can be touched and every path stays offline.
	{
		// A stub `rex`: logs its argv, answers inspect and block call from files,
		// and records whether the worktree was still there when the kill ran.
		const stubRex = ({ inspect, blockCwd, worktree }) => {
			const dir = mkdtempSync(join(tempRoot, "rex-bin-"));
			const log = join(dir, "rex-calls.log");
			const inspectFile = join(dir, "inspect.json");
			const blockFile = join(dir, "block.json");
			writeFileSync(inspectFile, JSON.stringify(inspect));
			writeFileSync(blockFile, JSON.stringify({ foreground: { cwd: blockCwd }, ancestors: [] }));
			writeFileSync(
				join(dir, "rex"),
				[
					"#!/bin/sh",
					`printf '%s\\n' "$*" >> "${log}"`,
					`if [ "$1" = "session" ] && [ "$2" = "inspect" ]; then cat "${inspectFile}"; exit 0; fi`,
					`if [ "$1" = "block" ] && [ "$2" = "call" ]; then cat "${blockFile}"; exit 0; fi`,
					`if [ "$1" = "session" ] && [ "$2" = "kill" ]; then`,
					`  if [ -d "${worktree}" ]; then printf 'worktree=present\\n' >> "${log}"; else printf 'worktree=gone\\n' >> "${log}"; fi`,
					"  exit 0",
					"fi",
					"exit 0",
					"",
				].join("\n"),
			);
			chmodSync(join(dir, "rex"), 0o755);
			return { dir, log };
		};
		// A stub `mission`: answers `--json list` for this worktree and the close.
		const stubMission = (records) => {
			const dir = mkdtempSync(join(tempRoot, "rex-mission-bin-"));
			const log = join(dir, "mission-calls.log");
			const listFile = join(dir, "mission-list.json");
			writeFileSync(listFile, JSON.stringify({ ok: true, data: records }));
			writeFileSync(
				join(dir, "mission"),
				[
					"#!/bin/sh",
					`printf '%s\\n' "$*" >> "${log}"`,
					`if [ "$2" = "list" ]; then cat "${listFile}"; exit 0; fi`,
					`printf '%s' '{"ok":true,"data":{"status":"closed"}}'`,
					"",
				].join("\n"),
			);
			chmodSync(join(dir, "mission"), 0o755);
			return { dir, log };
		};
		const runHandler = async (wt) => {
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
					confirm: async () => {
						events.push("confirm");
						return true;
					},
				},
				shutdown: () => events.push("shutdown"),
			});
			// The Rex kill and the workspace close run from the timer.
			await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
			return { events, notifications };
		};
		const saved = {
			path: process.env.PATH,
			workspace: process.env.HERDR_WORKSPACE_ID,
			missionBin: process.env.MISSION_BIN,
			rex: process.env.REX_SESSION,
			rexBin: process.env.REX_BIN,
			subagent: process.env.PI_SUBAGENT_SESSION,
			name: process.env.PI_SUBAGENT_NAME,
		};
		const restorePath = () => {
			if (saved.path === undefined) delete process.env.PATH;
			else process.env.PATH = saved.path;
		};
		try {
			delete process.env.HERDR_WORKSPACE_ID;
			delete process.env.MISSION_BIN;
			delete process.env.PI_SUBAGENT_SESSION;
			// The suite can itself run inside a subagent, and inside a Rex session.
			delete process.env.PI_SUBAGENT_NAME;

			// Case 1: the matching mission session is inspected, then killed by id,
			// after the worktree is gone.
			{
				const { repo, wt, branch } = tempRepo("cleanup-rex-", "mission-fix-x");
				const missionStub = stubMission([listedRecord(realpathSync(wt), "dotfiles/fix-x")]);
				const rex = stubRex({
					inspect: {
						session_id: "rex-42",
						label: "mission-fix-x",
						windows: [{ layers: [{ blocks: [{ block_id: "b1" }] }] }],
					},
					blockCwd: realpathSync(wt),
					worktree: wt,
				});
				process.env.PATH = `${rex.dir}:${missionStub.dir}:${saved.path}`;
				delete process.env.REX_BIN;
				process.env.REX_SESSION = "mission-fix-x";
				try {
					const { events, notifications } = await runHandler(wt);
					assert.equal(events.at(-1), "shutdown");
					assert.equal(notifications[0][1], "info");
					// Deferred: the report says the session closes next.
					assert.match(notifications[0][0], /Mission record dotfiles\/fix-x closed/);
					assert.match(notifications[0][0], /Rex session closes next\./);
					assert.equal(
						notifications.some(([message]) => /Rex session not destroyed/.test(message)),
						false,
					);
					// The real argv, in order, and no other Rex call.
					assert.deepEqual(readFileSync(rex.log, "utf8").trim().split("\n"), [
						"session inspect mission-fix-x --json",
						"block call -b b1 process",
						"session kill rex-42",
						"worktree=gone",
					]);
					assert.equal(existsSync(wt), false);
					assert.equal(gitRun(repo, ["branch", "--list", branch]), "");
				} finally {
					restorePath();
					rmSync(repo, { recursive: true, force: true });
				}
			}

			// Case 2: the army session is never destroyed: its label is not this
			// worktree's mission label, so no kill argv exists at all.
			{
				const { repo, wt } = tempRepo("cleanup-rex-army-", "mission-fix-x");
				const missionStub = stubMission([listedRecord(realpathSync(wt), "dotfiles/fix-x")]);
				const rex = stubRex({
					inspect: {
						session_id: "army-1",
						label: "army",
						windows: [{ layers: [{ blocks: [{ block_id: "b1" }] }] }],
					},
					blockCwd: realpathSync(wt),
					worktree: wt,
				});
				process.env.PATH = `${rex.dir}:${missionStub.dir}:${saved.path}`;
				delete process.env.REX_BIN;
				process.env.REX_SESSION = "army";
				try {
					const { events, notifications } = await runHandler(wt);
					assert.equal(events.at(-1), "shutdown");
					const calls = readFileSync(rex.log, "utf8").trim().split("\n");
					assert.deepEqual(calls, ["session inspect army --json"]);
					assert.equal(calls.filter((call) => call.startsWith("session kill")).length, 0);
					assert.equal(
						notifications.some(
							([message, level]) =>
								level === "warning" &&
								message ===
									'Rex session not destroyed: session army is labelled "army", not "mission-fix-x"',
						),
						true,
					);
					assert.equal(existsSync(wt), false);
				} finally {
					restorePath();
					rmSync(repo, { recursive: true, force: true });
				}
			}

			// Case 3: a missing `rex` binary is a soft failure — a warning line and a
			// clean shutdown, never a throw.
			{
				const { repo, wt } = tempRepo("cleanup-rex-missing-", "mission-fix-x");
				const missionStub = stubMission([listedRecord(realpathSync(wt), "dotfiles/fix-x")]);
				const missing = join(mkdtempSync(join(tempRoot, "rex-missing-")), "rex-does-not-exist");
				process.env.PATH = `${missionStub.dir}:${saved.path}`;
				process.env.REX_SESSION = "mission-fix-x";
				process.env.REX_BIN = missing;
				try {
					const { events, notifications } = await runHandler(wt);
					assert.equal(events.at(-1), "shutdown");
					assert.equal(
						notifications.some(([message, level]) => level === "warning" && message === `Rex session not destroyed: ${missing} not found`),
						true,
					);
					assert.equal(existsSync(wt), false);
				} finally {
					restorePath();
					rmSync(repo, { recursive: true, force: true });
				}
			}
		} finally {
			restorePath();
			if (saved.workspace === undefined) delete process.env.HERDR_WORKSPACE_ID;
			else process.env.HERDR_WORKSPACE_ID = saved.workspace;
			if (saved.missionBin === undefined) delete process.env.MISSION_BIN;
			else process.env.MISSION_BIN = saved.missionBin;
			if (saved.rex === undefined) delete process.env.REX_SESSION;
			else process.env.REX_SESSION = saved.rex;
			if (saved.rexBin === undefined) delete process.env.REX_BIN;
			else process.env.REX_BIN = saved.rexBin;
			if (saved.subagent === undefined) delete process.env.PI_SUBAGENT_SESSION;
			else process.env.PI_SUBAGENT_SESSION = saved.subagent;
			if (saved.name === undefined) delete process.env.PI_SUBAGENT_NAME;
			else process.env.PI_SUBAGENT_NAME = saved.name;
		}
	}

	console.log("cleanup.test.mjs: all assertions passed");
} finally {
	rmSync(tempRoot, { recursive: true, force: true });
}
