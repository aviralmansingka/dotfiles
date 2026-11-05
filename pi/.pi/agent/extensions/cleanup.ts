/**
 * `/cleanup` — tear down this worktree's session after its work ships.
 *
 * Deletes, in order:
 *   0. the vault mission record bound to this worktree (`mission close --force`)
 *   1. the configured upstream branch, when one exists
 *   2. the current linked Git worktree
 *   3. the local branch (`git branch -D`, run from the main checkout)
 *   4. the Herdr workspace that hosts the worktree (`herdr workspace close`),
 *      when a Herdr workspace id is set
 *   5. the Rex session that hosts the worktree (`rex session kill <id>`), when
 *      it is exactly this worktree's mission session
 * then closes the pi session gracefully via `ctx.shutdown()`. Both multiplexer
 * closes run last, from the shutdown callback, because this session's pane dies
 * with them: the Rex session first, then the workspace.
 *
 * The Rex step is the pair of the Herdr close for a Rex captain. Rex has no
 * `session destroy`: the kill is `rex session kill <session_id>`, on the id read
 * back from `rex session inspect <REX_SESSION> --json`. It destroys one session
 * only — the one whose label is exactly `mission-<slug>` for the handle bound to
 * this worktree and whose name is the worktree directory, and whose every block
 * runs in this worktree. The army session is never destroyed, and neither is a
 * session that holds a block running anywhere else. Outside Rex the step is
 * skipped, and it is a soft failure like the Herdr close: a missing binary, a
 * mismatched label, or a non-zero exit is reported and nothing throws.
 *
 * The mission step closes the record first, so a retired mission stops offering
 * work and cannot revive its deleted checkout on relaunch. The binding comes
 * from `mission --json list`; without a mission binary, a vault, or a matching
 * `runtime.cwd`, the step is skipped and says nothing.
 *
 * Refuses to run on the main checkout, on `main`/`master`, outside a listed
 * linked worktree, in a spawned subagent, or in a session that neither owns the
 * worktree's mission binding nor holds its claim. A record that names no session
 * of its own cannot contradict a durable caller, so absence alone never refuses
 * it. A confirm dialog lists the exact targets plus local-file and
 * upstream-ahead warnings. The destructive steps are best-effort and idempotent:
 * an already-deleted remote branch, an already removed worktree, or an already
 * deleted local branch counts as done, and any other git failure is reported
 * without stopping the remaining steps. The session always closes once the
 * pre-flight checks pass. The Herdr close is a soft failure too: a missing binary
 * or a non-zero exit is reported and nothing throws. The workspace of the main
 * checkout is never closed.
 *
 * The spawn test keys on `PI_SUBAGENT_NAME`, never on `PI_SUBAGENT_SESSION`.
 * PI_SUBAGENT_SESSION is a child-target hint, not an identity marker: a Rex
 * captain starts as a plain pi session (`rex window new`) with no subagent
 * identity and no parent, and `mission launch` sets that hint in its tab only so
 * the troopers it deploys land in the mission session. A trooper or sergeant is
 * a real interactive subagent and carries PI_SUBAGENT_NAME. The older guard
 * refused whenever the hint existed, so every launched captain was locked out
 * of its own cleanup (hit on captain-pi-resize). Outside a mission there is no
 * binding to own, so any durable session may still clean up its worktree.
 */
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const GIT_TIMEOUT_MS = 30_000;
const HERDR_TIMEOUT_MS = 30_000;
const MISSION_TIMEOUT_MS = 30_000;
const REX_TIMEOUT_MS = 30_000;
const DEFAULT_HERDR_BIN = "herdr";
const DEFAULT_MISSION_BIN = "mission";
const DEFAULT_REX_BIN = "rex";
/** The session the human's own work lives in. `/cleanup` never destroys it. */
const ARMY_LABEL = "army";
/** The note every `/cleanup` close records, so the vault says why. */
export const MISSION_CLOSE_NOTE = "worktree retired by /cleanup";
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

// --- herdr helpers -------------------------------------------------------------

export type HerdrRunner = (bin: string, args: string[]) => void;

export interface HerdrContext {
	/** Workspace id from HERDR_WORKSPACE_ID, or null outside Herdr. */
	workspaceId: string | null;
	/** Binary from HERDR_BIN, else `herdr` on `PATH`. */
	bin: string;
	/** Run the Herdr CLI. Throw on a non-zero exit or a missing binary. */
	run: HerdrRunner;
	/**
	 * Report the close as pending and let the caller run it. `/cleanup` sets this
	 * so the report reaches the screen before the pane dies with its workspace.
	 */
	deferClose?: boolean;
}

function runHerdr(bin: string, args: string[]): void {
	execFileSync(bin, args, {
		encoding: "utf8",
		timeout: HERDR_TIMEOUT_MS,
		stdio: ["pipe", "pipe", "pipe"],
	});
}

/** Read the Herdr identity from the environment. No id means no Herdr workspace. */
export function herdrContext(
	env: NodeJS.ProcessEnv = process.env,
	run: HerdrRunner = runHerdr,
): HerdrContext {
	const workspaceId = env.HERDR_WORKSPACE_ID?.trim();
	const bin = env.HERDR_BIN?.trim();
	return {
		workspaceId: workspaceId ? workspaceId : null,
		bin: bin ? bin : DEFAULT_HERDR_BIN,
		run,
	};
}

// --- rex helpers ---------------------------------------------------------------

export type RexRunner = (bin: string, args: string[]) => string;

export interface RexContext {
	/** Session id or label from REX_SESSION, or null outside Rex. */
	session: string | null;
	/** Binary from REX_BIN, else `rex` on `PATH`. */
	bin: string;
	/** Run the Rex CLI. Throw on a non-zero exit or a missing binary. */
	run: RexRunner;
	/**
	 * Report the kill as pending and let the caller run it. `/cleanup` sets this
	 * so the kill follows the worktree removal, from the shutdown callback.
	 */
	deferClose?: boolean;
}

function runRex(bin: string, args: string[]): string {
	return execFileSync(bin, args, {
		encoding: "utf8",
		timeout: REX_TIMEOUT_MS,
		stdio: ["pipe", "pipe", "pipe"],
		maxBuffer: 8 * 1024 * 1024,
	});
}

/** Read the Rex identity from the environment. No session means no Rex teardown. */
export function rexContext(
	env: NodeJS.ProcessEnv = process.env,
	run: RexRunner = runRex,
): RexContext {
	return {
		session: nonEmpty(env.REX_SESSION) ?? null,
		bin: nonEmpty(env.REX_BIN) ?? DEFAULT_REX_BIN,
		run,
	};
}

/**
 * The Rex session label this worktree's mission owns, from its handle:
 * `dotfiles/cleanup-rex-sessions` → `mission-cleanup-rex-sessions`. That is the
 * label the mission plan gives the session (`seatLabel`), and the worktree
 * directory carries the same string. A handle that names nothing gives null.
 */
export function missionSessionLabel(handle: string): string | null {
	const slug = (handle.split("/").pop() ?? "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug ? `mission-${slug}` : null;
}

/** The session `/cleanup` may destroy, or the reason it may not. */
export type RexTarget = { ok: true; label: string } | { ok: false; reason: string };

/**
 * Decide which Rex session this worktree may destroy — by name, and by nothing
 * else. Every branch below refuses rather than guesses, and no match is ever a
 * prefix or a fuzzy one: the label is `mission-<slug>` for the bound handle and
 * must equal the worktree directory name.
 */
export function rexTarget(facts: CleanupFacts, mission: MissionBinding | null): RexTarget {
	if (!mission) {
		return {
			ok: false,
			reason: "no mission record is bound to this worktree, so no session label is known",
		};
	}
	const label = missionSessionLabel(mission.handle);
	if (!label) {
		return { ok: false, reason: `mission ${mission.handle} names no session label` };
	}
	// The human's own session is never a cleanup target. The derivation below
	// cannot produce this label, and the rule stays stated so that a later change
	// to it cannot reach the army by accident.
	if (label === ARMY_LABEL) {
		return { ok: false, reason: "the army session is never destroyed" };
	}
	// Only a mission's own label counts, never a substring or a neighbour.
	if (!label.startsWith("mission-")) {
		return { ok: false, reason: `session ${label} is not a mission session label` };
	}
	const dir = basename(resolve(facts.worktreePath));
	if (dir !== label) {
		return { ok: false, reason: `session ${label} does not match worktree ${dir}` };
	}
	return { ok: true, label };
}

/**
 * A path with its live prefix canonicalized. The worktree is already gone when
 * the Rex guard runs on it, so `realpathSync` cannot resolve the whole path; the
 * deepest ancestor that still exists carries the symlinks (`/var` → `/private/var`
 * on macOS) and the deleted tail is appended as written.
 */
export function canonicalPath(path: string): string {
	const tail: string[] = [];
	let head = resolve(path);
	for (;;) {
		try {
			const base = realpathSync(head);
			return tail.length === 0 ? base : join(base, ...tail.reverse());
		} catch {
			const parent = dirname(head);
			if (parent === head) return resolve(path);
			tail.push(basename(head));
			head = parent;
		}
	}
}

/** True when `path` is `dir` or inside it, compared after canonicalization. */
export function insideDir(path: string, dir: string): boolean {
	const target = canonicalPath(dir);
	const candidate = canonicalPath(path);
	return candidate === target || candidate.startsWith(`${target.replace(/\/+$/, "")}/`);
}

/** The `rex session inspect --json` fields the teardown reads. */
interface RexInspect {
	session_id?: unknown;
	label?: unknown;
	windows?: Array<{ layers?: Array<{ blocks?: Array<{ block_id?: unknown }> }> }>;
}

/** Every block id of one inspected session, across all windows and layers. */
function sessionBlocks(inspected: RexInspect): string[] {
	const ids: string[] = [];
	for (const window of inspected?.windows ?? []) {
		for (const layer of window?.layers ?? []) {
			for (const block of layer?.blocks ?? []) {
				const id = nonEmpty(block?.block_id);
				if (id) ids.push(id);
			}
		}
	}
	return ids;
}

/**
 * The directories one block's process runs in: its foreground and its ancestors.
 * `/cleanup` needs this to prove a session holds no window but this worktree's,
 * and `rex block inspect` carries no directory, so the process read answers it.
 */
function blockDirs(rex: RexContext, blockId: string): string[] {
	let out: string;
	try {
		out = rex.run(rex.bin, ["block", "call", "-b", blockId, "process"]);
	} catch (error) {
		throw new Error(
			`block ${blockId} is unreadable: ${cliFailure(error, rex.bin, REX_GONE).message}`,
		);
	}
	let parsed: { foreground?: { cwd?: unknown }; ancestors?: unknown };
	try {
		parsed = JSON.parse(out) as typeof parsed;
	} catch {
		throw new Error(`block ${blockId} answered no JSON`);
	}
	const dirs: string[] = [];
	const add = (entry: unknown) => {
		if (!entry || typeof entry !== "object") return;
		const cwd = nonEmpty((entry as { cwd?: unknown }).cwd);
		if (cwd) dirs.push(cwd);
	};
	add(parsed?.foreground);
	for (const ancestor of Array.isArray(parsed?.ancestors) ? parsed.ancestors : []) add(ancestor);
	return dirs;
}

// --- mission helpers -----------------------------------------------------------

/** One vault mission bound to this worktree. */
export interface MissionBinding {
	/** `repo/slug` handle from `mission --json list`. */
	handle: string;
	/** Step ids the ledger has not passed yet; empty when the mission is done. */
	unfinished: string[];
	/**
	 * Session identities the record names for itself, when it names any: the
	 * runtime binding plus every attempt. A session matching one of these owns
	 * the mission; a record that names none leaves ownership unrecorded.
	 */
	owners?: MissionOwner[];
}

/** One session identity a mission record names for itself. */
export interface MissionOwner {
	/** Pi session id recorded by attach or claim. */
	sessionId?: string;
	/** Pi session file recorded by attach or claim. */
	sessionFile?: string;
	/** Herdr pane that hosted the attaching session. */
	pane?: string;
}

/** Run the mission CLI and return its stdout. Throw on a non-zero exit. */
export type MissionRunner = (args: string[]) => string;

export function missionBin(env: NodeJS.ProcessEnv = process.env): string {
	const bin = env.MISSION_BIN?.trim();
	return bin ? bin : DEFAULT_MISSION_BIN;
}

function runMission(args: string[]): string {
	return execFileSync(missionBin(), args, {
		encoding: "utf8",
		timeout: MISSION_TIMEOUT_MS,
		stdio: ["pipe", "pipe", "pipe"],
	});
}

interface ListedRecord {
	handle?: unknown;
	mission?: { steps?: unknown };
	state?: {
		status?: unknown;
		steps?: unknown;
		runtime?: unknown;
		attempts?: unknown;
	};
}

/** A trimmed non-empty string, or undefined for anything else. */
function nonEmpty(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** One named identity, or null when the source names nothing. */
function namedOwner(
	sessionId: unknown,
	sessionFile: unknown,
	pane: unknown,
): MissionOwner | null {
	const owner: MissionOwner = {
		sessionId: nonEmpty(sessionId),
		sessionFile: nonEmpty(sessionFile),
		pane: nonEmpty(pane),
	};
	return owner.sessionId || owner.sessionFile || owner.pane ? owner : null;
}

/** Session identities a listed record names: its runtime binding and its attempts. */
function ownerIdentities(record: ListedRecord): MissionOwner[] {
	const owners: MissionOwner[] = [];
	const add = (owner: MissionOwner | null) => {
		if (owner) owners.push(owner);
	};
	const runtime = record?.state?.runtime;
	if (runtime && typeof runtime === "object") {
		const r = runtime as Record<string, unknown>;
		add(namedOwner(r.session_id, r.session_file, r.pane_id));
	}
	const attempts = record?.state?.attempts;
	if (Array.isArray(attempts)) {
		for (const attempt of attempts) {
			if (!attempt || typeof attempt !== "object") continue;
			const a = attempt as Record<string, unknown>;
			add(namedOwner(a.session_id, a.session_file, null));
		}
	}
	return owners;
}

/** Unfinished step ids of one listed record, in mission order. */
function unfinishedSteps(record: ListedRecord): string[] {
	const steps = Array.isArray(record.mission?.steps) ? record.mission.steps : [];
	const states = record.state?.steps;
	const byId = states && typeof states === "object" ? (states as Record<string, unknown>) : {};
	return steps
		.map((step) => (step && typeof step === "object" ? (step as { id?: unknown }).id : undefined))
		.filter((id): id is string => typeof id === "string" && id !== "")
		.filter((id) => {
			const state = byId[id];
			const status =
				state && typeof state === "object" ? (state as { status?: unknown }).status : undefined;
			return status !== "passed";
		});
}

/**
 * Find the mission whose `runtime.cwd` is this worktree.
 *
 * No mission binary, no readable vault, or no matching record means there is
 * nothing to close: the caller skips the step and says nothing. The vault is
 * never parsed here; the CLI owns its format.
 */
export function detectMissionBinding(
	worktreePath: string,
	run: MissionRunner = runMission,
): MissionBinding | null {
	let listed: string;
	try {
		listed = run(["--json", "list"]);
	} catch {
		return null;
	}
	let payload: { data?: unknown };
	try {
		payload = JSON.parse(listed) as { data?: unknown };
	} catch {
		return null;
	}
	const records = Array.isArray(payload?.data) ? (payload.data as ListedRecord[]) : [];
	let path: string;
	try {
		path = realpathSync(worktreePath);
	} catch {
		return null;
	}
	for (const record of records) {
		const handle = typeof record?.handle === "string" ? record.handle : "";
		const runtime = record?.state?.runtime;
		const bound =
			runtime && typeof runtime === "object"
				? (runtime as { cwd?: unknown }).cwd
				: undefined;
		if (!handle || typeof bound !== "string" || bound === "") continue;
		let boundPath: string;
		try {
			boundPath = realpathSync(bound);
		} catch {
			continue;
		}
		if (boundPath === path) {
			const binding: MissionBinding = { handle, unfinished: unfinishedSteps(record) };
			const owners = ownerIdentities(record);
			if (owners.length > 0) binding.owners = owners;
			return binding;
		}
	}
	return null;
}

/**
 * Close the mission record bound to this worktree.
 *
 * `--force` is deliberate: cleanup deletes the checkout either way, so the
 * record must never keep `running` and revive it later. The confirm dialog has
 * already shown the owner which steps are unfinished.
 */
export function closeMission(
	binding: MissionBinding,
	run: MissionRunner = runMission,
): StepResult {
	let out: string;
	try {
		out = run(["--json", "close", binding.handle, "--note", MISSION_CLOSE_NOTE, "--force"]);
	} catch (error) {
		const message = errorMessage(error);
		return { ok: false, already: false, error: message };
	}
	let already = false;
	try {
		const payload = JSON.parse(out) as { data?: { already?: unknown }; ok?: unknown };
		if (payload?.ok === false) {
			return { ok: false, already: false, error: out.trim() || "mission close reported an error" };
		}
		already = payload?.data?.already === true;
	} catch {
		// A close that exits zero but prints no JSON still closed the record.
	}
	return { ok: true, already };
}

// --- durable owner ------------------------------------------------------------

/** What this session answers to, read from the session manager and the environment. */
export interface SessionIdentity {
	sessionId?: string;
	sessionFile?: string;
	/** The Herdr pane that hosts this session; it survives a resume. */
	pane?: string;
	/** Set only for a spawned agent: a trooper, sergeant, or worker. */
	subagentName?: string;
	/** A mission claim this session holds, with the handle it names. */
	claimToken?: string;
	claimHandle?: string;
}

/** The part of the command context the owner test reads. */
export interface SessionContextLike {
	sessionManager?: {
		getSessionId?: () => string;
		getSessionFile?: () => string | undefined;
	};
}

/** Read the running session's identity. A session manager that throws reads as absent. */
export function sessionIdentity(
	ctx: SessionContextLike,
	env: NodeJS.ProcessEnv = process.env,
): SessionIdentity {
	const read = (get: (() => string | undefined) | undefined): string | undefined => {
		try {
			return nonEmpty(get?.());
		} catch {
			return undefined;
		}
	};
	return {
		sessionId: read(ctx?.sessionManager?.getSessionId),
		sessionFile: read(ctx?.sessionManager?.getSessionFile),
		pane: nonEmpty(env.HERDR_PANE_ID),
		subagentName: nonEmpty(env.PI_SUBAGENT_NAME),
		claimToken: nonEmpty(env.MISSION_TOKEN),
		claimHandle: nonEmpty(env.MISSION_HANDLE),
	};
}

/** True when the record names this session among its owners. */
function ownsBinding(binding: MissionBinding, identity: SessionIdentity): boolean {
	return (binding.owners ?? []).some(
		(owner) =>
			(owner.sessionId !== undefined && owner.sessionId === identity.sessionId) ||
			(owner.sessionFile !== undefined && owner.sessionFile === identity.sessionFile) ||
			(owner.pane !== undefined && owner.pane === identity.pane),
	);
}

/** True when this session holds a claim for this mission. */
function holdsClaim(binding: MissionBinding, identity: SessionIdentity): boolean {
	if (!identity.claimToken) return false;
	return identity.claimHandle === undefined || identity.claimHandle === binding.handle;
}

/**
 * Why a spawned agent may not run `/cleanup`, or null for a durable session.
 *
 * Only `PI_SUBAGENT_NAME` marks a spawn: a trooper or sergeant is an
 * interactive subagent and carries it. `PI_SUBAGENT_SESSION` is a child-target
 * hint that a launched captain carries too, so it decides nothing here.
 */
export function subagentRefusal(identity: SessionIdentity): string | null {
	if (!identity.subagentName) return null;
	return `Cleanup runs in the session that owns this worktree; this session is the subagent "${identity.subagentName}".`;
}

/**
 * Why this session does not own the worktree's mission, or null when it does.
 *
 * A worktree with no mission record has no binding to own, so any durable
 * session may clean it up, and a record that names no session of its own leaves
 * nothing to contradict. A record that names a session, its file, or its pane
 * belongs to that session, or to whoever holds its claim: a session that is
 * neither says so instead of deleting the record and its checkout. Ownership is
 * never refused on absence alone, because a resumed or never-attached owner is
 * exactly the case this test must not strand.
 */
export function ownerRefusal(
	mission: MissionBinding | null,
	identity: SessionIdentity,
): string | null {
	if (!mission) return null;
	if ((mission.owners ?? []).length === 0) return null;
	if (ownsBinding(mission, identity) || holdsClaim(mission, identity)) return null;
	return `Cleanup runs in the session that owns this worktree; mission ${mission.handle} names another session and this one holds no claim.`;
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
	/** Local file count reported by Git, including ignored files. */
	dirtyCount: number;
	/** Commits on HEAD not on the upstream, or null without an upstream. */
	aheadCount: number | null;
	/** The configured upstream ref no longer exists (deleted and pruned remotely). */
	upstreamGone: boolean;
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
	let upstreamGone = false;
	if (upstreamRef) {
		let aheadRaw: string | null = null;
		try {
			aheadRaw = runGit(worktreePath, ["rev-list", "--count", `${upstreamRef}..HEAD`]);
		} catch {
			// The upstream ref is configured but no longer exists locally, which is
			// what a remotely deleted (and pruned) branch looks like. Nothing to
			// compare against, and nothing fatal: continue with local teardown.
			upstreamGone = true;
		}
		if (aheadRaw !== null) {
			if (!/^\d+$/.test(aheadRaw)) {
				return { ok: false, reason: "The upstream comparison is invalid; refusing to clean up." };
			}
			aheadCount = Number(aheadRaw);
		}
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
			upstreamGone,
		},
	};
}

// --- confirm message -----------------------------------------------------------

export function buildConfirmMessage(
	facts: CleanupFacts,
	workspaceId: string | null = herdrContext().workspaceId,
	mission: MissionBinding | null = null,
	rex: RexContext | null = null,
): string {
	const lines = [
		`Worktree:  ${facts.worktreePath}`,
		`Branch:    ${facts.branch}`,
		facts.remote && facts.remoteBranch
			? `Remote:    ${facts.remote} branch ${facts.remoteBranch}`
			: "Remote:    none (local only, never pushed)",
		`Herdr:     ${workspaceId ? `workspace ${workspaceId} closes too` : "no workspace id, the workspace stays"}`,
	];
	if (rex) {
		const target = rex.session
			? rexTarget(facts, mission)
			: { ok: false as const, reason: "REX_SESSION is not set" };
		lines.push(
			target.ok
				? `Rex:       session ${target.label} closes too`
				: `Rex:       the session stays (${target.reason})`,
		);
	}
	if (mission) {
		lines.push(`Mission:   ${mission.handle} closes too`);
	}
	if (facts.upstreamGone) {
		lines.push("Note:      Remote branch is already gone; local teardown only.");
	}
	if (facts.dirtyCount > 0) {
		lines.push(`Warning:   ${facts.dirtyCount} uncommitted file(s) — discarded with the worktree.`);
	}
	if (facts.aheadCount !== null && facts.aheadCount > 0) {
		lines.push(`Warning:   ${facts.aheadCount} commit(s) not on ${facts.remote}/${facts.remoteBranch}.`);
	}
	if (mission && mission.unfinished.length > 0) {
		lines.push(
			`Warning:   mission steps not passed: ${mission.unfinished.join(", ")} — the record closes anyway.`,
		);
	}
	lines.push("", "The pi session closes after cleanup.");
	return lines.join("\n");
}

// --- execution ---------------------------------------------------------------

export interface StepResult {
	/** The step completed, or there was nothing left for it to do. */
	ok: boolean;
	/** Git or Herdr reported the target as already absent. */
	already: boolean;
	/** The caller runs this step later; nothing ran here. */
	pending?: boolean;
	/** There is nothing to do here, and the report says nothing about it. */
	skipped?: boolean;
	/** Why the step did not run. */
	reason?: string;
	/** Real failure message, when `ok` is false. */
	error?: string;
}

export interface CleanupStepReport {
	remoteDeleted: boolean;
	worktreeRemoved: boolean;
	localBranchDeleted: boolean;
	workspaceClosed: boolean;
	/** The mission record bound to this worktree is now closed. */
	missionClosed: boolean;
	/** Handle of the closed mission, or null when no mission was bound. */
	missionHandle: string | null;
	/** The Rex session that hosted this worktree is now destroyed. */
	rexSessionDestroyed: boolean;
	/** The Rex teardown step; skipped when the caller has no Rex context. */
	rex: StepResult;
	steps: {
		mission: StepResult;
		remote: StepResult;
		worktree: StepResult;
		branch: StepResult;
		workspace: StepResult;
	};
}

/** The git steps. The mission and workspace steps have their own semantics. */
type GitStep = "remote" | "worktree" | "branch";

/** Git error messages that mean "the thing you asked to delete is not there". */
const ALREADY_GONE: Record<GitStep, RegExp[]> = {
	remote: [/remote ref does not exist/i, /unable to delete/i, /does not match any/i],
	worktree: [/is not a working tree/i, /not registered/i],
	branch: [/branch .* not found/i, /no branch named/i, /branch .* does not exist/i],
};

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function attemptStep(
	run: (cwd: string, args: string[]) => void,
	cwd: string,
	args: string[],
	gonePatterns: RegExp[],
): StepResult {
	try {
		run(cwd, args);
		return { ok: true, already: false };
	} catch (error) {
		const message = errorMessage(error);
		if (gonePatterns.some((pattern) => pattern.test(message))) {
			return { ok: true, already: true };
		}
		return { ok: false, already: false, error: message };
	}
}

/** Herdr errors that mean "the workspace you asked to close is not there". */
const WORKSPACE_GONE = /workspace[_ ]not[_ ]found|workspace .* not found/i;

/** Rex errors that mean "the session you asked for is not there". */
const REX_GONE = /not found|does not exist|no such session/i;

/** A failed CLI call: its message, and whether the target was already gone. */
interface CliFailure {
	message: string;
	/** The target is already gone, so the step did its job. */
	already: boolean;
}

function cliFailure(error: unknown, bin: string, gone: RegExp): CliFailure {
	const record = error as { code?: string; stderr?: unknown; message?: string } | null;
	if (record?.code === "ENOENT") return { message: `${bin} not found`, already: false };
	// The CLI prints a JSON error object on stderr. Prefer its message.
	const stderr = typeof record?.stderr === "string" ? record.stderr.trim() : "";
	let detail = stderr || record?.message || String(error);
	try {
		const parsed = JSON.parse(stderr);
		if (parsed?.error?.message) detail = String(parsed.error.message);
	} catch {
		// Not JSON; keep the raw text.
	}
	return { message: detail, already: gone.test(detail) };
}

function herdrFailure(error: unknown, bin: string): CliFailure {
	return cliFailure(error, bin, WORKSPACE_GONE);
}

/**
 * Close the Herdr workspace that hosts this worktree.
 *
 * Rule: never close the workspace that hosts the repository's main checkout. A
 * workspace is the main one when its checkout path equals the main checkout
 * path, so a durable session on `main` keeps its workspace and its picker row.
 */
export function closeWorkspace(facts: CleanupFacts, herdr: HerdrContext): StepResult {
	if (facts.worktreePath === facts.mainPath) {
		return { ok: true, already: false, reason: "the workspace hosts the main checkout" };
	}
	if (!herdr.workspaceId) {
		return { ok: true, already: false, reason: "HERDR_WORKSPACE_ID is not set" };
	}
	if (herdr.deferClose) return { ok: true, already: false, pending: true };
	try {
		herdr.run(herdr.bin, ["workspace", "close", herdr.workspaceId]);
		return { ok: true, already: false };
	} catch (error) {
		const failure = herdrFailure(error, herdr.bin);
		if (failure.already) return { ok: true, already: true };
		return { ok: false, already: false, error: failure.message };
	}
}

/** The mission step needs a binding and a runner; a null binding skips it. */
export interface MissionContext {
	binding: MissionBinding | null;
	run: MissionRunner;
}

/**
 * Destroy the Rex session that hosts this worktree.
 *
 * Rex has no `session destroy`, so the kill is `rex session kill <session_id>`,
 * on the id read back from `rex session inspect`. Every check below is a hard
 * stop, and a stop is a soft failure: the session survives, the report says why,
 * and nothing throws. A session is destroyed only when its label is exactly this
 * worktree's mission label, it exists under that same label, and every block it
 * holds runs inside the worktree — the army session and a session shared with
 * another checkout are therefore out of reach.
 */
export function closeRexSession(
	facts: CleanupFacts,
	mission: MissionBinding | null,
	rex: RexContext,
): StepResult {
	if (facts.worktreePath === facts.mainPath) {
		return { ok: true, already: false, reason: "the session hosts the main checkout" };
	}
	const session = rex.session;
	// Outside Rex there is no session of this worktree's to destroy, so the step
	// says nothing at all — the same silence the mission step keeps when nothing
	// is bound to the checkout.
	if (!session) return { ok: true, already: false, skipped: true };
	const target = rexTarget(facts, mission);
	if (!target.ok) return { ok: true, already: false, reason: target.reason };
	if (rex.deferClose) return { ok: true, already: false, pending: true };

	let out: string;
	try {
		out = rex.run(rex.bin, ["session", "inspect", session, "--json"]);
	} catch (error) {
		const failure = cliFailure(error, rex.bin, REX_GONE);
		if (failure.already) return { ok: true, already: true };
		return { ok: false, already: false, error: failure.message };
	}
	let inspected: RexInspect;
	try {
		inspected = JSON.parse(out) as RexInspect;
	} catch {
		return { ok: false, already: false, error: "rex session inspect printed no JSON" };
	}
	// The live label must be the derived one, exactly: no prefix, no resemblance.
	const label = nonEmpty(inspected?.label) ?? "";
	if (label !== target.label) {
		return {
			ok: false,
			already: false,
			error: `session ${session} is labelled "${label}", not "${target.label}"`,
		};
	}
	const id = nonEmpty(inspected?.session_id);
	if (!id) {
		return { ok: false, already: false, error: `session ${session} has no id` };
	}
	for (const blockId of sessionBlocks(inspected)) {
		let dirs: string[];
		try {
			dirs = blockDirs(rex, blockId);
		} catch (error) {
			return {
				ok: false,
				already: false,
				error: `the session holds block ${blockId}, which cannot be checked: ${errorMessage(error)}`,
			};
		}
		if (dirs.length === 0) {
			return {
				ok: false,
				already: false,
				error: `the session holds block ${blockId}, whose directory cannot be read`,
			};
		}
		const outside = dirs.find((dir) => !insideDir(dir, facts.worktreePath));
		if (outside !== undefined) {
			return {
				ok: false,
				already: false,
				error: `the session holds a block running in ${outside}, outside ${facts.worktreePath}`,
			};
		}
	}
	try {
		rex.run(rex.bin, ["session", "kill", id]);
		return { ok: true, already: false };
	} catch (error) {
		const failure = cliFailure(error, rex.bin, REX_GONE);
		if (failure.already) return { ok: true, already: true };
		return { ok: false, already: false, error: failure.message };
	}
}

/** Run the destructive steps. Exposed for tests with injected git and Herdr runners. */
export function executeCleanup(
	facts: CleanupFacts,
	run: (cwd: string, args: string[]) => void,
	herdr: HerdrContext,
	mission: MissionContext | null = null,
	rex: RexContext | null = null,
): CleanupStepReport {
	const hasRemote = Boolean(facts.remote && facts.remoteBranch);
	const report: CleanupStepReport = {
		remoteDeleted: false,
		worktreeRemoved: false,
		localBranchDeleted: false,
		workspaceClosed: false,
		missionClosed: false,
		missionHandle: mission?.binding?.handle ?? null,
		rexSessionDestroyed: false,
		rex: { ok: true, already: false, skipped: true },
		steps: {
			mission: { ok: true, already: false, skipped: true },
			remote: { ok: true, already: false },
			worktree: { ok: true, already: false },
			branch: { ok: true, already: false },
			workspace: { ok: true, already: false },
		},
	};

	// 0. Mission record — first, so the vault never keeps a live record for a
	// checkout that is about to disappear. No binding means nothing to say.
	if (mission && mission.binding) {
		report.steps.mission = closeMission(mission.binding, mission.run);
		report.missionClosed = report.steps.mission.ok && !report.steps.mission.already;
	}

	// 1. Remote branch — from the still-existing worktree.
	if (hasRemote) {
		report.steps.remote = attemptStep(
			run,
			facts.worktreePath,
			["push", facts.remote as string, "--delete", facts.remoteBranch as string],
			ALREADY_GONE.remote,
		);
		report.remoteDeleted = report.steps.remote.ok;
	}

	// 2. Worktree — driven from the main checkout so it survives its own removal.
	report.steps.worktree = attemptStep(
		run,
		facts.mainPath,
		["worktree", "remove", ...(facts.dirtyCount > 0 ? ["--force"] : []), facts.worktreePath],
		ALREADY_GONE.worktree,
	);
	report.worktreeRemoved = report.steps.worktree.ok;

	// 3. Local branch — only deletable once no worktree has it checked out.
	report.steps.branch = attemptStep(
		run,
		facts.mainPath,
		["branch", "-D", facts.branch],
		ALREADY_GONE.branch,
	);
	report.localBranchDeleted = report.steps.branch.ok;

	// 4. Herdr workspace — last, because this session lives inside it and its
	// pane dies with the close.
	report.steps.workspace = closeWorkspace(facts, herdr);
	const workspace = report.steps.workspace;
	report.workspaceClosed =
		workspace.ok && !workspace.already && !workspace.pending && workspace.reason === undefined;

	// 5. Rex session — reported here, killed by the shutdown callback once the
	// worktree is gone, because the kill takes this session's own pane with it.
	// No Rex context means no Rex teardown to report, so the step says nothing.
	report.rex = rex
		? closeRexSession(facts, mission?.binding ?? null, rex)
		: { ok: true, already: false, skipped: true };
	const rexStep = report.rex;
	report.rexSessionDestroyed =
		rexStep.ok &&
		!rexStep.already &&
		!rexStep.pending &&
		!rexStep.skipped &&
		rexStep.reason === undefined;

	return report;
}

/** One phrase for the mission step. A skipped step says nothing at all. */
export function describeMissionStep(
	step: StepResult,
	handle: string | null = null,
): string {
	if (step.skipped) return "";
	const name = handle ? `Mission record ${handle}` : "Mission record";
	if (step.reason !== undefined) return `${name} not closed: ${step.reason}`;
	if (!step.ok) return `${name} not closed: ${step.error}`;
	if (step.already) return `${name} was already closed`;
	return `${name} closed`;
}

/** One phrase for the Herdr workspace step. */
export function describeWorkspaceStep(step: StepResult): string {
	if (step.reason !== undefined) return `Herdr workspace not closed: ${step.reason}`;
	if (step.already) return "Herdr workspace already gone";
	if (!step.ok) return `Herdr workspace not closed: ${step.error}`;
	if (step.pending) return "Herdr workspace closes next";
	return "Herdr workspace closed";
}

/** One phrase for the Rex session step. A skipped step says nothing at all. */
export function describeRexStep(step: StepResult): string {
	if (step.skipped) return "";
	if (step.reason !== undefined) return `Rex session not destroyed: ${step.reason}`;
	if (!step.ok) return `Rex session not destroyed: ${step.error}`;
	if (step.already) return "Rex session was already gone";
	if (step.pending) return "Rex session closes next";
	return "Rex session destroyed";
}

/** One notification line summarising what happened, including notes and errors. */
export function describeCleanupReport(report: CleanupStepReport): string {
	const done = [
		report.remoteDeleted ? "remote branch" : null,
		report.worktreeRemoved ? "worktree" : null,
		report.localBranchDeleted ? "local branch" : null,
	]
		.filter(Boolean)
		.join(", ");
	const notes: string[] = [];
	const missionNote = describeMissionStep(report.steps.mission, report.missionHandle);
	if (missionNote) notes.push(missionNote);
	for (const [label, step] of [
		["remote branch", report.steps.remote],
		["worktree", report.steps.worktree],
		["local branch", report.steps.branch],
	] as const) {
		if (step.already) notes.push(`${label} was already gone`);
		else if (!step.ok) notes.push(`${label} failed: ${step.error}`);
	}
	const base = done ? `Cleanup done: ${done}.` : "Cleanup: nothing left to delete.";
	const all = [...notes, describeWorkspaceStep(report.steps.workspace)];
	const rexNote = describeRexStep(report.rex);
	if (rexNote) all.push(rexNote);
	return `${base} ${all.join("; ")}.`;
}

// --- extension ----------------------------------------------------------------

const SHUTDOWN_DELAY_MS = 750;

export default function (pi: ExtensionAPI) {
	pi.registerCommand("cleanup", {
		description: "Delete this worktree, its local and remote branch, its Rex session, and its Herdr workspace",
		handler: async (_args, ctx) => {
			const identity = sessionIdentity(ctx);
			const spawned = subagentRefusal(identity);
			if (spawned) {
				ctx.ui.notify(spawned, "error");
				return;
			}

			const result = collectCleanupFacts(ctx.cwd);
			if (!result.ok) {
				ctx.ui.notify(result.reason, "error");
				return;
			}
			const facts = result.facts;
			const herdr = herdrContext();
			const rex = rexContext();
			const mission = detectMissionBinding(facts.worktreePath);
			const unowned = ownerRefusal(mission, identity);
			if (unowned) {
				ctx.ui.notify(unowned, "error");
				return;
			}

			const confirmed = await ctx.ui.confirm(
				"Delete worktree and branches?",
				buildConfirmMessage(facts, herdr.workspaceId, mission, rex),
			);
			if (!confirmed) {
				ctx.ui.notify("Cleanup cancelled.", "info");
				return;
			}

			try {
				// Both multiplexer closes wait for the shutdown callback below: this session
				// lives in that workspace and in that Rex session, so the report must reach
				// the screen first, and the worktree must be gone before the kill.
				const report = executeCleanup(
					facts,
					(cwd, args) => {
						git(cwd, args);
					},
					{ ...herdr, deferClose: true },
					{ binding: mission, run: runMission },
					{ ...rex, deferClose: true },
				);
				const failed =
					!report.steps.mission.ok ||
					!report.steps.remote.ok ||
					!report.steps.worktree.ok ||
					!report.steps.branch.ok ||
					!report.rex.ok;
				ctx.ui.notify(describeCleanupReport(report), failed ? "warning" : "info");
			} catch (error) {
				// The steps are individually guarded, so this is unexpected — but the
				// owner wants the session dead either way.
				ctx.ui.notify(`Cleanup failed: ${errorMessage(error)}`, "error");
			}

			ctx.ui.notify("Closing session.", "info");

			// Give the notification a moment on screen before the TUI exits, then destroy
			// the Rex session (already stripped of its worktree) and close the workspace
			// last. Every pane this session owns dies with them.
			setTimeout(() => {
				try {
					const killed = closeRexSession(facts, mission, rex);
					if (killed.reason !== undefined || !killed.ok) {
						ctx.ui.notify(describeRexStep(killed), "warning");
					}
				} catch (error) {
					ctx.ui.notify(`Rex session not destroyed: ${errorMessage(error)}`, "warning");
				}
				try {
					const workspace = closeWorkspace(facts, herdr);
					if (!workspace.ok || workspace.reason !== undefined) {
						ctx.ui.notify(describeWorkspaceStep(workspace), "warning");
					}
				} catch (error) {
					ctx.ui.notify(`Herdr workspace not closed: ${errorMessage(error)}`, "warning");
				}
				ctx.shutdown();
			}, SHUTDOWN_DELAY_MS);
		},
	});
}
