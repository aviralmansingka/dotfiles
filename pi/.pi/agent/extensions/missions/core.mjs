import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const exec = promisify(execFile);
const hash = text => createHash("sha256").update(text).digest("hex");
export const slug = title => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64).replace(/-$/, "");
const active = a => a && ["running", "reported"].includes(a.status);
export function repositoryWorkspace(workspaces, common) {
  const matches = workspaces.filter(w => w.worktree?.repo_key === common && !w.worktree?.is_linked_worktree);
  if (matches.length !== 1) throw new Error("Open the repository's primary Herdr workspace first; missions reuse that workspace.");
  return matches[0].workspace_id;
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
  async workspace(common) { return repositoryWorkspace((await this.herdr(["workspace", "list"])).workspaces, common); }
  async assertSurface(ctx) {
    const common = await this.common(ctx.cwd), workspace = await this.workspace(common);
    const result = await this.herdr(["pane", "list", "--workspace", workspace]);
    const pane = result.panes?.find(p => p.pane_id === this.env.HERDR_PANE_ID);
    if (!pane || realpathSync(pane.foreground_cwd || pane.cwd) !== realpathSync(ctx.cwd))
      throw new Error("This session must run in the mission worktree inside the repository's primary workspace. Move/resume it there before attaching.");
    this.surfaceSession = ctx.sessionManager.getSessionId();
    return { workspace, pane: pane.pane_id };
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
    const workspace = await this.workspace(await this.common(checkout));
    const r = await this.call(["workspace", handle]);
    const reservation = await this.call(["launch", handle]);
    if (!reservation.acquired) return { launched: false, reason: "Owner or launch intent already recorded; resume/attach it instead of spawning again.", runtime: reservation.runtime };
    const launchID = reservation.runtime.launch_id;
    // No workspace create/open: every mission is a tab in the primary repo workspace.
    const tab = await this.herdr(["tab", "create", "--workspace", workspace, "--cwd", r.state.runtime.cwd, "--label", initial.mission.slug, "--no-focus"]);
    const pane = tab.root_pane?.pane_id;
    if (!pane || tab.root_pane.workspace_id !== workspace) throw new Error("Herdr returned a different workspace; launch intent retained for inspection.");
    const result = await spawn({ agent: "mission-worker", name: "mission-" + hash(handle).slice(0, 20), cwd: r.state.runtime.cwd, pane,
      missionContext: { vault: this.vault, binary: this.binary, stateDir: this.cacheDir },
      task: `Work on mission ${handle}. Before reading or editing repository files, call mission with action=attach, handle=${handle}, launch_id=${launchID}. Then follow the returned step brief and the missions skill. Report structured progress. Write the required artifact and call finish when the step is ready. Stop at checkpoints; keep this session and worktree for later steps.` }, ctx);
    const details = result?.details;
    if (details?.status !== "started" || !details.sessionFile || details.error)
      throw new Error("Mission launch was not acknowledged; intent and tab retained. Inspect the existing session before retrying.");
    await this.call(["launch", handle, "--launch-id", launchID, "--session-file", details.sessionFile]);
    return { launched: true, runtime: (await this.call(["show", handle])).state.runtime, session_file: details.sessionFile, pane };
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
