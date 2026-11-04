import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, realpathSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const exec = promisify(execFile);
const hash = text => createHash("sha256").update(text).digest("hex");
export const slug = title => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64).replace(/-$/, "");
const active = a => a && ["running", "reported"].includes(a.status);
/** Every Herdr workspace that belongs to this repository lineage: the primary
 * checkout's workspace plus one linked-worktree workspace per worktree Herdr
 * has open (missions register their own mission/<slug> checkout). */
export function repositoryWorkspaces(workspaces, common) {
  return (workspaces || []).filter(w => w.worktree?.repo_key === common);
}
export function pendingCount(symbol) {
  const fn = globalThis[Symbol.for(symbol)];
  if (typeof fn !== "function") return 0;
  try { const n = fn(); return Number.isFinite(n) && n >= 0 ? n : Infinity; } catch { return Infinity; }
}
export function quiescent(event, ctx) {
  return event.aborted === false && event.outcome === "completed" && ctx.isIdle() && !ctx.hasPendingMessages() &&
    pendingCount("pi-subagents/running-children-count") === 0 && pendingCount("pi-subagents/keep-open-count") === 0;
}

/** Tools that only inspect: they never change the worktree or the vault, so the
 *  mission gate always passes them. `mission` stays available in every state so
 *  a held session can inspect its record, report progress, or pick up a step;
 *  `run-command` only prints a repair command, so a worker that owns no active
 *  step can still hand the human the exact command to run. */
export const INSPECTION_TOOLS = new Set(["read", "grep", "find", "ls", "tool_search", "mission", "run-command"]);

/** Mission statuses that hold no agent write authority: "waiting" and "review"
 *  wait on a human checkpoint decision, while "done" and "failed" already
 *  ended the mission. Status alone decides, never the active attempt — a closed
 *  mission has no attempt left, and blocking its tools would leave the session
 *  unable to report, clean up, or answer the human. */
export const CLOSED_MISSION_STATUSES = new Set(["waiting", "review", "done", "failed"]);

/** Step statuses the CLI still advances to (nextStep in go/mission). */
const CONTINUABLE_STEP_STATUSES = new Set(["pending", "needs_changes"]);

/** Gate one tool call by mission status. Returns a block reason, or undefined
 *  when the call may proceed. Inspection tools always pass. A closed mission
 *  passes every tool. An open mission authorizes changes only while one of its
 *  attempts is active; "ready" means the session must pick up a step first. */
export function missionToolBlock({ toolName, current = null, tracked = true, expectedAttachment = false }) {
  if (INSPECTION_TOOLS.has(toolName)) return undefined;
  if (!tracked) return expectedAttachment ? "Restore the mission credential cache before changing repository files." : undefined;
  const status = current?.record?.state?.status;
  if (CLOSED_MISSION_STATUSES.has(status)) return undefined;
  if (current?.attempt) return undefined;
  return "No active mission step. Inspect the checkpoint or explicitly pick up next.";
}

/** True only when a settled mission can start another step. Terminal
 *  ("done"/"failed") and human-facing ("waiting"/"review") statuses never
 *  continue, so the extension does not inject action=next after the end. */
export function missionContinues(state) {
  if (state?.status !== "ready" || state.pending_checkpoint) return false;
  return Object.values(state.steps ?? {}).some(step => CONTINUABLE_STEP_STATUSES.has(step.status));
}

/** Credentials and an unacknowledged hook outbox are local transport state.
 * Canonical mission facts, transcripts, and attempts live only in the CLI vault.
 * No credentials are put in a prompt, tool result, or a child's environment.
 */
export class MissionBridge {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.vault = resolve((this.env.MISSION_VAULT || join(homedir(), "vault")).replace(/^~(?=\/|$)/, homedir()));
    if (existsSync(this.vault)) this.vault = realpathSync(this.vault);
    this.binary = this.env.MISSION_BIN || "mission";
    this.cacheDir = this.env.MISSION_STATE_DIR || join(this.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "pi-missions");
    this.run = options.run || (async (bin, args, options = {}) => {
      const r = await exec(bin, args, { encoding: "utf8", timeout: 180000, maxBuffer: 32 << 20, ...options });
      return r.stdout;
    });
    this.hint = null;
    this.error = null;
    this.surfaceSession = null;
    this.expectedAttachment = false;
  }
  key(ctx) { return join(this.cacheDir, hash(this.vault + "\0" + ctx.sessionManager.getSessionId()) + ".json"); }
  save(ctx) {
    mkdirSync(this.cacheDir, { recursive: true, mode: 0o700 });
    const file = this.key(ctx), temp = file + "." + randomUUID();
    writeFileSync(temp, JSON.stringify(this.hint), { mode: 0o600 }); renameSync(temp, file);
  }
  /** One file, one write, one rename: a reader never sees a half-written
   *  request, and the desk and this extension can both read at any moment. */
  writeJSON(file, value) {
    mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
    const temp = file + "." + randomUUID();
    writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
    renameSync(temp, file);
  }
  async call(args, token) {
    const env = { ...this.env };
    for (const key of Object.keys(env)) if (key.startsWith("MISSION_")) delete env[key];
    if (token) env.MISSION_TOKEN = token;
    let stdout;
    try { stdout = await this.run(this.binary, ["--json", "--vault", this.vault, ...args], { env }); }
    catch (e) { stdout = e.stdout; if (!stdout) throw new Error("Mission CLI unavailable: " + e.message); }
    let r;
    try { r = JSON.parse(stdout); } catch { throw new Error("Mission CLI returned invalid JSON"); }
    if (!r.ok) throw new Error(`${r.error?.code}: ${r.error?.message}`);
    // The CLI may just have created a vault under a symlinked parent (/tmp on
    // macOS). Use its canonical location before persisting session credentials.
    if (existsSync(this.vault)) this.vault = realpathSync(this.vault);
    return r.data;
  }
  async herdr(args) {
    if (this.env.HERDR_ENV !== "1") throw new Error("Mission session control requires a Herdr pane.");
    return JSON.parse(await this.run("herdr", args, { env: this.env })).result;
  }
  async common(cwd) { return realpathSync((await this.run("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"])).trim()); }
  async assertSurface(ctx) {
    const common = await this.common(ctx.cwd), cwd = realpathSync(ctx.cwd);
    const workspaces = repositoryWorkspaces((await this.herdr(["workspace", "list"])).workspaces, common);
    if (!workspaces.length) throw new Error("Open the repository's Herdr workspace first; missions register their worktree from it.");
    // A mission session lives in its own worktree workspace. Missions bound
    // before worktree workspaces existed still sit in the primary workspace, so
    // accept any workspace of this repository whose pane sits in the mission
    // checkout — the pane cwd, not the workspace count, is the binding.
    for (const w of workspaces) {
      const result = await this.herdr(["pane", "list", "--workspace", w.workspace_id]);
      const pane = result.panes?.find(p => p.pane_id === this.env.HERDR_PANE_ID);
      if (!pane || realpathSync(pane.foreground_cwd || pane.cwd) !== cwd) continue;
      this.surfaceSession = ctx.sessionManager.getSessionId();
      return { workspace: w.workspace_id, pane: pane.pane_id };
    }
    throw new Error("This session must run in the mission worktree inside the repository's Herdr workspace. Move/resume it there before attaching.");
  }
  async restore(ctx) {
    this.hint = null; this.error = null; this.surfaceSession = null; this.expectedAttachment = false;
    const file = this.key(ctx);
    if (!existsSync(file)) return;
    this.expectedAttachment = true;
    this.hint = JSON.parse(readFileSync(file, "utf8"));
    if (this.hint.session !== ctx.sessionManager.getSessionId() || this.hint.vault !== this.vault)
      throw new Error("Mission credential cache identity mismatch");
    await this.assertSurface(ctx);
    await this.flush(ctx);
    return this.current(ctx);
  }
  async current(ctx) {
    if (!this.hint) return null;
    if (this.surfaceSession !== ctx.sessionManager.getSessionId()) throw new Error("Restore the mission's Herdr attachment before continuing.");
    const r = await this.call(["show", this.hint.handle]);
    const b = r.state.runtime;
    if (!b || b.session_id !== ctx.sessionManager.getSessionId() || b.cwd !== realpathSync(ctx.cwd) || b.session_file !== realpathSync(ctx.sessionManager.getSessionFile() || ""))
      throw new Error("Mission owner differs from this session; tracking is suspended.");
    const a = r.state.attempts.find(a => a.id === r.state.active_attempt);
    if (active(a) && a.id !== this.hint.attempt) throw new Error("Mission attempt changed; explicitly attach before continuing.");
    return { record: r, attempt: a };
  }
  async attach(ctx, handle, launchID, agent) {
    if (this.hint && this.hint.handle !== handle) throw new Error("This session already tracks another mission.");
    const surface = await this.assertSurface(ctx);
    const record = await this.call(["show", handle]);
    const binding = record.state.runtime;
    if (binding && binding.cwd !== realpathSync(ctx.cwd)) throw new Error("This mission is bound to another worktree: " + binding.cwd);
    if (binding?.session_id && binding.session_id !== ctx.sessionManager.getSessionId()) throw new Error("Resume the existing Pi owner: " + binding.session_id);
    const previous = this.hint;
    this.hint ||= { handle, token: randomUUID() + randomUUID(), session: ctx.sessionManager.getSessionId(), vault: this.vault, outbox: [], autoContinue: this.env.PI_SUBAGENT_AGENT === "mission-worker" };
    // Persist the capability BEFORE claiming, so a crash can replay attach.
    this.save(ctx);
    try {
      const args = ["attach", handle, "--session-id", ctx.sessionManager.getSessionId(), "--session-file", ctx.sessionManager.getSessionFile() || "",
        "--cwd", ctx.cwd, "--workspace", surface.workspace, "--pane", surface.pane, "--agent", agent || "mission-worker"];
      if (launchID) args.push("--launch-id", launchID);
      const c = await this.call(args, this.hint.token);
      this.expectedAttachment = true;
      this.hint.attempt = c.attempt.id; this.hint.launchID = launchID; this.save(ctx);
      await this.record(ctx, { type: "session-start", summary: "Pi session attached" });
      return this.publicClaim(c);
    } catch (e) { if (previous) this.hint = previous; throw e; }
  }
  publicClaim(c) {
    return { handle: c.handle, step: c.step, attempt: c.attempt.id, brief: c.attempt.brief_snapshot,
      artifact: c.environment.MISSION_ARTIFACT, brief_file: c.environment.MISSION_BRIEF, cwd: c.attempt.cwd };
  }
  async flush(ctx) {
    const previous = this.flushing || Promise.resolve();
    const pending = previous.catch(() => {}).then(() => this.flushOutbox(ctx));
    this.flushing = pending;
    try { await pending; } finally { if (this.flushing === pending) this.flushing = null; }
  }
  async flushOutbox(ctx) {
    if (!this.hint?.attempt) return;
    while (this.hint.outbox.length) {
      const item = this.hint.outbox[0];
      // Hook argv contains bounded metadata only; credentials travel in env.
      const e = item.event;
      const args = ["hook", e.type, "--handle", this.hint.handle, "--attempt", item.attempt, "--event-id", e.id,
        "--session-id", e.session_id, "--session-file", e.session_file, "--pane", e.pane_id || "", "--workspace", e.workspace_id || "", "--message", e.summary || ""];
      if (e.tool) args.push("--tool", e.tool);
      if (e.model) args.push("--model", e.model);
      if (e.quiescent) args.push("--quiescent");
      await this.call(args, this.hint.token);
      this.hint.outbox.shift(); this.save(ctx);
    }
    this.error = null;
  }
  async record(ctx, event) {
    if (!this.hint?.attempt) return;
    if (this.hint.outbox.length >= 128) throw new Error("Mission hook outbox full; restore CLI recording before continuing.");
    this.hint.outbox.push({ attempt: this.hint.attempt, event: { id: randomUUID(), session_id: ctx.sessionManager.getSessionId(),
      session_file: ctx.sessionManager.getSessionFile(), pane_id: this.env.HERDR_PANE_ID, workspace_id: this.env.HERDR_WORKSPACE_ID,
      model:ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined, ...event } });
    this.save(ctx); await this.flush(ctx);
  }
  async end(ctx, event) {
    await this.record(ctx, { type: "agent-end", summary: "Pi turn ended; automatic continuations may still run" });
  }
  async settled(ctx, event) {
    await this.record(ctx, { type: "agent-settled", summary: "Pi run settled", quiescent: quiescent(event, ctx) });
    const current = await this.current(ctx);
    if (current?.attempt?.status === "reported" && quiescent(event, ctx)) {
      return this.call(["settle", this.hint.handle, "--attempt", this.hint.attempt, "--session-id", ctx.sessionManager.getSessionId()], this.hint.token);
    }
  }
  async start(ctx, handle) {
    if (this.env.PI_SUBAGENT_NAME) throw new Error("Launch missions from the captain; workers own only their assigned mission.");
    const spawn = globalThis.__pi_interactive_subagents?.executeSubagent;
    if (typeof spawn !== "function") throw new Error("The interactive-subagents extension must be loaded to launch missions.");
    const initial = await this.call(["show", handle]);
    const repos = await this.call(["repo", "list"]);
    const repo = repos.find(r => r.slug === initial.mission.repo);
    const checkout = repo?.checkouts?.[(await import("node:os")).hostname()];
    if (!checkout) throw new Error("Register a local repository checkout first.");
    const r = await this.call(["workspace", handle]);
    const cwd = r.state.runtime.cwd;
    const reservation = await this.call(["launch", handle]);
    if (!reservation.acquired) return { launched: false, reason: "Owner or launch intent already recorded; resume/attach it instead of spawning again.", runtime: reservation.runtime };
    const launchID = reservation.runtime.launch_id;
    // The CLI created the mission/<slug> checkout; Herdr registers it as the
    // repository's linked worktree workspace (idempotent: a relaunch reuses the
    // same workspace). Anchored on the primary checkout, because Herdr refuses
    // create/open from inside a linked worktree.
    const worktree = await this.herdr(["worktree", "open", "--cwd", checkout, "--path", cwd, "--no-focus"]);
    const workspace = worktree.workspace?.workspace_id;
    if (!workspace) throw new Error("Herdr did not return the mission worktree workspace; launch intent retained for inspection.");
    // A fresh workspace's first tab hosts the worker. A workspace that was
    // already open may be parked on the mission's previous session, so a
    // relaunch gets its own tab there instead of taking over that pane.
    const holder = worktree.already_open
      ? await this.herdr(["tab", "create", "--workspace", workspace, "--cwd", cwd, "--label", initial.mission.slug, "--no-focus"])
      : worktree;
    const pane = holder.root_pane?.pane_id;
    if (!pane || holder.root_pane.workspace_id !== workspace) throw new Error("Herdr returned a different workspace; launch intent retained for inspection.");
    const result = await spawn({ agent: "mission-worker", name: "mission-" + hash(handle).slice(0, 20), cwd, pane,
      missionContext: { vault: this.vault, binary: this.binary, stateDir: this.cacheDir },
      task: `Work on mission ${handle}. Before reading or editing repository files, call mission with action=attach, handle=${handle}, launch_id=${launchID}. Then follow the returned step brief and the missions skill. Report structured progress. Write the required artifact and call finish when the step is ready. Stop at checkpoints; keep this session and worktree for later steps.` }, ctx);
    const details = result?.details;
    if (details?.status !== "started" || !details.sessionFile || details.error)
      throw new Error("Mission launch was not acknowledged; intent and tab retained. Inspect the existing session before retrying.");
    await this.call(["launch", handle, "--launch-id", launchID, "--session-file", details.sessionFile]);
    return { launched: true, runtime: (await this.call(["show", handle])).state.runtime, session_file: details.sessionFile, pane, workspace };
  }
  /** Launch requests the desk left behind. The desk cannot start a mission: it
   *  writes one file per handle, this session claims it, and start() stays the
   *  only launch path. */
  launchDir() { return join(this.cacheDir, "launches"); }
  pendingLaunches() {
    const dir = this.launchDir();
    if (!existsSync(dir)) return [];
    const out = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const file = join(dir, name);
      try {
        const request = JSON.parse(readFileSync(file, "utf8"));
        if (request?.state === "pending" && request.handle) out.push({ ...request, file });
      } catch { /* a torn or foreign file is not a request */ }
    }
    return out;
  }
  /** Claim a request by rewriting it. A second claim reads "claimed" and loses,
   *  so one press can never produce two workers. */
  claimLaunch(request, sessionID) {
    let live;
    try { live = JSON.parse(readFileSync(request.file, "utf8")); } catch { return false; }
    if (live?.state !== "pending") return false;
    this.writeJSON(request.file, { ...live, state: "claimed", claimed_by: sessionID,
      updated_at: new Date().toISOString() });
    return true;
  }
  settleLaunch(request, patch) {
    let live;
    try { live = JSON.parse(readFileSync(request.file, "utf8")); } catch { live = request; }
    const { file, ...rest } = live;
    this.writeJSON(request.file, { ...rest, ...patch, updated_at: new Date().toISOString() });
  }
  /** The repository this session belongs to, by git common directory. A request
   *  from another repository is left for that repository's session. */
  async sessionRepo(ctx) {
    const common = await this.common(ctx.cwd);
    for (const repo of await this.call(["repo", "list"])) {
      for (const path of Object.values(repo.checkouts || {})) {
        try { if (await this.common(path) === common) return repo.slug; } catch { /* checkout is gone */ }
      }
    }
    return null;
  }
  /** The Herdr seat this session occupies. The desk writes the same two values
   *  into its request, so a request addressed to this workspace belongs here. */
  seat() { return { workspace: this.env.HERDR_WORKSPACE_ID || "", label: this.env.HERDR_PANE_ID || "" }; }
  /** Whether an addressed Herdr workspace still exists. A request whose seat is
   *  gone (the session quit, the pane closed) may be adopted; a live seat keeps
   *  its own request. Outside Herdr nothing is live, so a repository session
   *  adopts the request after the checkout-family check. */
  async workspaceLive(workspace) {
    if (!workspace || this.env.HERDR_ENV !== "1") return false;
    try {
      const list = (await this.herdr(["workspace", "list"])).workspaces || [];
      return list.some(w => w.workspace_id === workspace);
    } catch { return false; }
  }
  /** Which pending request this session may claim. One request belongs to one
   *  repository and one checkout family; the addressed workspace goes first, an
   *  unaddressed request next, and a dead address inside the same family last. */
  async mayClaim(request, repo, seat, common) {
    if (request.repo !== repo) return false;
    if (request.owner_common && common && request.owner_common !== common) return false;
    if (!request.owner_workspace || request.owner_workspace === seat.workspace) return true;
    return !(await this.workspaceLive(request.owner_workspace));
  }
  claimRank(request, seat) {
    if (request.owner_workspace && request.owner_workspace === seat.workspace) return 0;
    return request.owner_workspace ? 2 : 1;
  }
  /** Claim and start one pending request this session may serve. Workers never
   *  launch; a busy turn waits; a second sweep finds the claim gone. A captain
   *  that already owns a mission still serves this workspace's request, because
   *  start() puts the worker in the mission's own worktree workspace. */
  async sweepLaunches(ctx) {
    if (this.sweeping) return this.sweeping;
    this.sweeping = (async () => {
      if (this.env.PI_SUBAGENT_NAME) return;
      const pending = this.pendingLaunches();
      if (!pending.length) return;
      if (!ctx.isIdle() || ctx.hasPendingMessages()) return;
      const repo = await this.sessionRepo(ctx);
      if (!repo) return;
      const seat = this.seat();
      let common = null;
      try { common = await this.common(ctx.cwd); } catch { /* cwd is not a checkout */ }
      const candidates = [];
      for (const request of pending) if (await this.mayClaim(request, repo, seat, common)) candidates.push(request);
      candidates.sort((a, b) => this.claimRank(a, seat) - this.claimRank(b, seat));
      const request = candidates[0];
      if (!request || !this.claimLaunch(request, ctx.sessionManager.getSessionId())) return;
      try {
        const result = await this.start(ctx, request.handle);
        const launched = result?.launched === true;
        this.settleLaunch(request, { state: launched ? "started" : "failed", launch_id: result?.runtime?.launch_id,
          ...(launched ? { workspace: result?.workspace, pane: result?.pane, session_file: result?.session_file }
            : { error: result?.reason || "the launch was not acknowledged" }) });
      } catch (e) {
        this.settleLaunch(request, { state: "failed", error: e.message });
      }
    })();
    try { await this.sweeping; } finally { this.sweeping = null; }
  }
  async action(ctx, p, eventID = randomUUID()) {
    const handle = p.handle || this.hint?.handle;
    if (p.action === "list") return (await this.call(["list"])).map(r => ({handle:r.handle,title:r.mission.title,status:r.state.status,step:r.state.current_step,checkpoint:r.state.pending_checkpoint}));
    if (p.action === "create") {
      if (!p.repo || !p.title || !p.goal || !p.steps?.length) throw new Error("Create needs repo, title, goal, and step titles.");
      const args = ["new", p.handle || `${p.repo}/${slug(p.title)}`, "--title", p.title, "--goal", p.goal, "--kind", p.kind || "implementation"];
      for (const step of p.steps) args.push("--step", step);
      return this.call(args);
    }
    if (!handle) throw new Error("Choose a mission handle first.");
    if (p.action === "start") return this.start(ctx, handle);
    if (p.action === "attach" || p.action === "next") return this.attach(ctx, handle, p.launch_id || this.hint?.launchID, p.agent);
    if (p.action === "status") return this.call(["show", handle]);
    if (p.action === "steps") return this.call(["steps", handle]);
    if (p.action === "edit") {
      if (!p.step) throw new Error("Edit needs a step id.");
      const args = ["step", "edit", handle, p.step];
      for (const key of ["instructions", "acceptance", "output"]) if (p[key] !== undefined) args.push("--"+key, p[key]);
      if (p.checks) args.push("--checks", p.checks.join(","));
      // Reset is deliberately CLI-only: inspect history and obtain a user decision first.
      return this.call(args);
    }
    if (!this.hint?.attempt || handle !== this.hint.handle) throw new Error("Attach this session before reporting progress.");
    await this.flush(ctx);
    const current = await this.current(ctx);
    if (!active(current?.attempt)) throw new Error("No active step; inspect checkpoints or explicitly pick up next.");
    const args = [p.action, handle, "--attempt", this.hint.attempt];
    if (p.action === "progress") {
      args.push("--status", p.status || "working", "--summary", p.summary || "", "--event-id", p.event_id || eventID);
      if (p.next) args.push("--next", p.next);
      if (p.blocker) args.push("--blocker", p.blocker);
      for (const evidence of p.evidence || []) args.push("--evidence", evidence);
    } else if (p.action === "finish" || p.action === "fail") { if (p.summary) args.push("--note", p.summary); }
    else if (p.action !== "verify") throw new Error("Unknown mission action");
    const r = await this.call(args, this.hint.token);
    if (!r.state) return r;
    const a = r.state.attempts.find(a => a.id === this.hint.attempt);
    return { handle, status:r.state.status, attempt:a.id, attempt_status:a.status, step:a.step, checkpoint:r.state.pending_checkpoint,
      progress:a.progress?.at(-1), verification:a.verifications?.at(-1),
      message: p.action === "finish" || p.action === "fail" ? "Completion reported. Ownership remains until the turn settles; checks and checkpoints still apply." : undefined };
  }
}
