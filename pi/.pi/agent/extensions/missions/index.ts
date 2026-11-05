import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { CommanderInbox, MissionBridge, driverTask, missionContinues, missionToolBlock, trackingFailureBlock } from "./core.mjs";
import { LABEL_COLUMN, actionForKey, buildPanelModel, checkpointArgs } from "./panel.mjs";

// The turn after the contract keeps one line of the driver stance, so a
// compacted history still reads as the driver of this attempt.
const DRIVER_REMINDER = "Stay the driver of this attempt: send the step work to one work subagent with this brief, send the verification to one judge subagent (mission action=judge), write no artifact yourself, and report finish only after a judge records a pass.";

export default function missions(pi: ExtensionAPI, options = {}) {
  const bridge = new MissionBridge(options);
  // The latest ctx, so the launch sweep can run on a timer while the session is
  // idle. The desk writes requests; this session claims and starts them.
  let live: any = null;
  const sweep = () => { if (live) bridge.sweepLaunches(live).catch((e: any) => { bridge.error = e.message; }); };
  // The ask channel's receiving half. A captain writes its question into the
  // mission record and stops; only the commander's session drains it. Nothing
  // here depends on the role answer except the drain itself, and the files stay
  // on disk when no commander session exists.
  const inbox = new CommanderInbox({
    vault: bridge.vault, env: bridge.env,
    run: (bin: string, args: string[], opts: any) => bridge.run(bin, args, opts),
    send: (message: any, opts: any) => pi.sendMessage(message, opts),
  });
  // Deliver on idle only: a tool that is running owns the turn, and a captain or
  // trooper session owns a mission of its own, so its pane is never a mailbox.
  const deliverAsks = async () => {
    if (!live || bridge.hint || bridge.env.PI_SUBAGENT_NAME) return;
    if (!live.isIdle() || live.hasPendingMessages()) return;
    try { await inbox.drain(live.sessionManager.getSessionId()); }
    catch (e: any) { bridge.error = e.message; }
  };
  const guarded = (fn: Function) => async (event: any, ctx: any) => {
    try { await fn(event, ctx); }
    catch (e: any) { bridge.error = e.message; ctx.ui.notify("Mission tracking: " + e.message, "warning"); }
  };
  // The one-line badge names the attached mission. An untracked session shows
  // the mission its panel last opened, so every action refreshes a real line.
  const badge = async (ctx: any, record?: any) => {
    if (!bridge.hint) {
      ctx.ui.setStatus?.("mission", record ? `${record.handle} · ${record.state?.status || "unknown"}` : undefined);
      return;
    }
    const c = await bridge.current(ctx);
    ctx.ui.setStatus?.("mission", `${bridge.hint.handle} · ${c?.attempt?.step || c?.record.state.status}`);
  };
  pi.on("session_start", guarded(async (_e: any, ctx: any) => {
    live = ctx;
    // Resolve the commander seat once at session start, then let the slow
    // re-check in the drain keep it honest.
    inbox.reset();
    void inbox.isCommander(true).catch(() => {});
    await bridge.restore(ctx);
    sweep();
    if (bridge.hint) await bridge.record(ctx, {type:"session-start",summary:"Pi session restored from local mission context"});
    await badge(ctx);
  }));
  pi.on("session_before_switch", guarded(async (_e: any, ctx: any) => { await bridge.record(ctx, { type: "session-end", summary: "Session switch; ownership preserved for resume" }); }));
  pi.on("session_shutdown", guarded(async (_e: any, ctx: any) => { clearInterval(timer); clearInterval(askTimer); await bridge.record(ctx, { type: "session-end", summary: "Session shutdown; preserve transcript and owner" }); }));
  pi.on("before_agent_start", async (_e, ctx) => {
    bridge.lastOutcome = undefined;
    if (!bridge.hint) {
      if (bridge.expectedAttachment) return {message:{customType:"mission-context",display:false,content:"Mission context cannot be restored. Repair its private credential cache before changing repository files."}};
      return;
    }
    try {
      await bridge.flush(ctx);
      const c = await bridge.current(ctx);
      // The whole driver contract rides the attach, once per attempt. The turns
      // after it keep the attempt line and the step brief, so a compacted
      // history still reads as a driver and no duty is restated every turn.
      const contract = c?.attempt && bridge.contractTurn(c.attempt) ? driverTask(bridge.hint.handle, bridge.hint.launchID) : DRIVER_REMINDER;
      return { message: { customType: "mission-context", display: false, content: c?.attempt ?
        `Mission ${bridge.hint.handle}, step ${c.attempt.step}, attempt ${c.attempt.id}.\n${c.attempt.brief_snapshot}\n${contract}` :
        `Mission ${bridge.hint.handle} is ${c?.record.state.status}. Inspect status and answer the human's status and admin prompts here. Start another step only with mission action=next after reviews are decided. Do not modify code while no step is active.` } };
    } catch (e: any) { bridge.error = e.message; return { message: { customType: "mission-context", display: false, content: "Mission tracking failed: " + e.message + ". Restore tracking before making changes." } }; }
  });
  pi.on("tool_call", async (event, ctx) => {
    if (!bridge.hint) {
      const reason = missionToolBlock({ toolName: event.toolName, tracked: false, expectedAttachment: bridge.expectedAttachment });
      return reason ? { block: true, reason } : undefined;
    }
    let current;
    try { await bridge.flush(ctx); current = await bridge.current(ctx); }
    catch (e: any) {
      // A record that cannot be read must not stop the worker from reading it.
      // Read and bash-class tools degrade to a warning; edits keep blocking.
      const reason = trackingFailureBlock(event.toolName, e.message);
      if (reason) return { block: true, reason };
      ctx.ui.notify("Mission tracking: " + e.message, "warning");
      return undefined;
    }
    const reason = missionToolBlock({ toolName: event.toolName, action: event.input?.action, current });
    return reason ? { block: true, reason } : undefined;
  });
  // One line the outbox owes the model: an item set aside after repeated
  // failures, or a judge report that carried no session. The tool call that
  // flushed it still succeeds, and the notice rides the result that follows.
  pi.on("tool_result", (event: any) => {
    const notices = bridge.takeNotices();
    if (!notices.length) return;
    const patch: any = { content: [...(event.content || []), ...notices.map((text: string) => ({ type: "text", text }))] };
    // Content and structured content must stay in step, so keep the latter.
    if (event.structuredContent !== undefined) patch.structuredContent = event.structuredContent;
    return patch;
  });
  pi.on("agent_start", guarded(async (_e: any, ctx: any) => { await bridge.record(ctx, { type: "agent-start", summary: "Pi turn started" }); }));
  // A press in the desk lands between turns, so poll for it: a captain that sits
  // idle still starts a mission the human asked for. Two seconds is fast enough
  // for a keypress and quiet enough to cost one directory read.
  const timer = setInterval(sweep, 2000);
  // The poll must never hold the process open: an idle session still exits.
  (timer as any)?.unref?.();
  // Five seconds is short enough to unblock a captain quickly and quiet enough
  // to cost one directory read per tick when the vault has no asks.
  const askTimer = setInterval(() => { void deliverAsks(); }, 5000);
  (askTimer as any)?.unref?.();
  pi.on("agent_end", guarded(async (event: any, ctx: any) => { await bridge.end(ctx, event); await badge(ctx); }));
  // agent_end can be followed by automatic retry/compaction/steered input.
  // Pi 1.5's final settlement boundary is the completion authority.
  pi.on("agent_before_settle", (event) => { bridge.lastOutcome = event.outcome; });
  pi.on("agent_settled", guarded(async (event: any, ctx: any) => {
    const result = await bridge.settled(ctx, { ...event, outcome: bridge.lastOutcome });
    await badge(ctx);
    sweep();
    // The turn is over and settled, so a question waiting on disk can land now
    // instead of waiting for the next five-second tick.
    void deliverAsks();
    // Starting a mission authorizes its eligible steps. Attaching an existing
    // session records its work without silently starting additional steps.
    // A finished or human-held mission never asks for another step.
    const settledState = result?.state ?? (await bridge.current(ctx).catch(() => null))?.record?.state;
    if (missionContinues(settledState) && bridge.hint?.autoContinue && !ctx.hasPendingMessages()) {
      pi.sendMessage({customType:"mission-next",display:true,
        content:`The previous step of ${bridge.hint.handle} passed its checks. Call mission action=next to pick up the next eligible step in this same worktree. Read its returned brief before editing. Pause at human reviews.`},
        {triggerTurn:true,deliverAs:"followUp"});
    }
  }));
  pi.on("tool_execution_start", guarded(async (e: any, ctx: any) => { await bridge.record(ctx, { type: "tool-start", tool: e.toolName, summary: "Tool call " + e.toolCallId }); }));
  pi.on("tool_execution_end", guarded(async (e: any, ctx: any) => { await bridge.record(ctx, { type: "tool-end", tool: e.toolName, summary: "Tool call " + e.toolCallId + (e.isError ? " failed" : " ended") }); }));
  // A finished subagent is a trooper on the ground. The interactive subagents
  // extension delivers every completion as a `subagent_result` message (spawn,
  // adoption, and orphan finalize), so one report leaves the parent for each
  // finished subagent — named by the subagent itself, so a judge step records
  // the judge. The report rides the same outbox as the lifecycle hooks, so a
  // reload replays it under one ID instead of appending a second copy.
  pi.on("message_end", guarded(async (event: any, ctx: any) => { await bridge.report(ctx, event?.message); }));

  pi.registerTool({
    name: "mission", label: "Mission", exposure: "deferred",
    description: "Create, inspect, launch, or attach vault missions. Record structured progress and request verified step completion. One repository workspace, one persistent worktree and Pi owner per mission.",
    parameters: Type.Object({
      action: Type.Union(["list", "create", "steps", "edit", "status", "start", "attach", "next", "progress", "judge", "verify", "finish", "fail", "retry"].map(v => Type.Literal(v))),
      handle: Type.Optional(Type.String()), repo: Type.Optional(Type.String()), title: Type.Optional(Type.String()), goal: Type.Optional(Type.String()),
      kind: Type.Optional(Type.Union([Type.Literal("research"), Type.Literal("implementation")])), steps: Type.Optional(Type.Array(Type.String())),
      step: Type.Optional(Type.String()), instructions: Type.Optional(Type.String()), acceptance: Type.Optional(Type.String()),
      checks: Type.Optional(Type.Array(Type.String())), output: Type.Optional(Type.String()), agent: Type.Optional(Type.String()), launch_id: Type.Optional(Type.String()),
      revision: Type.Optional(Type.Integer()),
      status: Type.Optional(Type.Union(["working", "blocked", "needs-input", "ready"].map(v => Type.Literal(v)))),
      summary: Type.Optional(Type.String()), next: Type.Optional(Type.String()), blocker: Type.Optional(Type.String()),
      actor: Type.Optional(Type.String()),
      evidence: Type.Optional(Type.Array(Type.String())), event_id: Type.Optional(Type.String()),
    }),
    async execute(id, p, _signal, _update, ctx) {
      try {
        const result = await bridge.action(ctx, p, id);
        await badge(ctx);
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
      } catch (e: any) { return { content: [{ type: "text", text: e.message }], isError: true }; }
    },
  });
  // The panel: one pop-up shows the record as rows and takes one key. The view
  // model and the key map live in panel.mjs, so the suite tests them without a
  // terminal. A missing vault, handle, or field shows what exists plus a reason.
  const readRecord = async (handle?: string) => {
    if (!handle) return { error: "A mission handle is required." };
    try { return { record: await bridge.call(["show", handle]) }; }
    catch (e: any) { return { error: e.message }; }
  };
  const pickHandle = async (ctx: any): Promise<string | undefined> => {
    try {
      const records = await bridge.call(["list"]);
      if (!records?.length) { ctx.ui?.notify?.("No missions in this vault.", "info"); return undefined; }
      if (records.length === 1) return records[0].handle;
      if (typeof ctx.ui?.select !== "function") return records[0].handle;
      const labels = records.map((r: any) => `${r.handle} · ${r.state?.status || "unknown"} · ${r.mission?.title || ""}`);
      const selected = await ctx.ui.select("Missions", labels);
      return selected ? records[labels.indexOf(selected)]?.handle : undefined;
    } catch (e: any) { ctx.ui?.notify?.(e.message, "error"); return undefined; }
  };
  // One key, one CLI call. A checkpoint decision is a human attestation, so the
  // panel signs it with this user's name and a fixed note.
  const actInPanel = async (ctx: any, action: string, handle: string, record: any) => {
    if (action === "open") return "Mission desk opened in " + (await bridge.openDesk()) + ".";
    if (action === "start") await bridge.action(ctx, { action: "start", handle });
    else if (action === "retry") await bridge.call(["retry", handle]);
    else await bridge.call(checkpointArgs(handle, record, { decision: action }));
    return action + " done.";
  };
  const openPanel = async (ctx: any, request?: string) => {
    let handle = request || bridge.hint?.handle;
    if (!handle) handle = await pickHandle(ctx);
    if (!handle) return;
    const target = handle;
    let loaded: any = await readRecord(target);
    try { await badge(ctx, loaded.record); } catch { /* the badge is display only */ }
    if (!ctx.hasUI || typeof ctx.ui?.custom !== "function") {
      // A host without custom components still gets the whole record.
      ctx.ui?.notify?.(JSON.stringify(loaded.record ?? { handle: target, error: loaded.error }, null, 2), loaded.error ? "warning" : "info");
      return;
    }
    // The extension factory must load where pi's own modules are absent (the
    // CI suite resolves jiti and typebox only), so pi-tui loads only when a
    // panel opens.
    const { Key, matchesKey, truncateToWidth, visibleWidth } = await import("@earendil-works/pi-tui");
    await ctx.ui.custom<void>((tui: any, theme: any, _kb: any, done: () => void) => {
      let busy: string | undefined;
      let notice: string | undefined;
      let cachedLines: string[] | undefined;
      let cachedWidth = -1;
      const invalidate = () => { cachedLines = undefined; cachedWidth = -1; };
      const model = () => buildPanelModel({ record: loaded.record, handle: target, error: loaded.error });

      const runAction = async (action: string) => {
        busy = action; notice = undefined;
        invalidate(); tui.requestRender();
        try { notice = await actInPanel(ctx, action, target, loaded.record); }
        catch (e: any) { notice = e.message; }
        busy = undefined;
        loaded = await readRecord(target);
        try { await badge(ctx, loaded.record); } catch { /* the badge is display only */ }
        invalidate(); tui.requestRender();
      };

      return {
        render(width: number): string[] {
          if (cachedLines && cachedWidth === width) return cachedLines;
          const m = model();
          const name = m.handle || target;
          const lines: string[] = [];
          const push = (line: string) => { lines.push(truncateToWidth(line, width, "…")); };
          const gap = Math.max(1, width - visibleWidth(name) - visibleWidth(m.statusLine));
          push(theme.fg("accent", theme.bold(name)) + " ".repeat(gap) + theme.fg(m.tone, m.statusLine));
          if (m.error) push(theme.fg("error", m.error));
          for (const row of m.rows) {
            const status = row.status ? theme.fg(row.tone, row.status) : "";
            const column = LABEL_COLUMN + 1;
            const budget = Math.max(8, width - column - (row.status ? visibleWidth(row.status) + 1 : 0));
            const value = truncateToWidth(row.value, budget, "…");
            const used = column + visibleWidth(value) + (row.status ? visibleWidth(row.status) + 1 : 0);
            push(theme.fg("dim", row.label.padEnd(LABEL_COLUMN)) + " " + theme.fg(row.tone, value) + " ".repeat(Math.max(1, width - used)) + status);
          }
          lines.push("");
          // A disabled key keeps its place and dims, so the layout never jumps.
          push(m.keys.map(k => k.enabled
            ? theme.fg("accent", k.key) + " " + theme.fg("text", k.label)
            : theme.fg("dim", k.key + " " + k.label)).join("   "));
          const blocked = m.keys.filter(k => !k.enabled && k.action !== "close").map(k => `${k.key} ${k.action}: ${k.reason}`);
          if (blocked.length) push(theme.fg("dim", blocked.join(" · ")));
          if (busy) push(theme.fg("warning", "running " + busy + "…"));
          else if (notice) push(theme.fg("dim", notice));
          cachedLines = lines; cachedWidth = width;
          return lines;
        },
        handleInput(data: string): void {
          if (matchesKey(data, Key.escape) || data === "q") { done(); return; }
          const action = actionForKey(data);
          if (!action) return;
          const entry = model().keys.find(k => k.action === action);
          if (!entry?.enabled) {
            notice = `${entry?.key || data} ${action}: ${entry?.reason || "cannot run now"}`;
            invalidate(); tui.requestRender();
            return;
          }
          void runAction(action);
        },
        invalidate,
      };
    }, { blocked: { kind: "question", message: "Mission panel: " + target } });
  };

  pi.registerCommand("mission", {
    description: "Mission panel: /mission [HANDLE]; /mission attach|start|steps|next REPO/SLUG",
    handler: async (args, ctx) => {
      const [action = "panel", handle] = args.trim().split(/\s+/).filter(Boolean);
      // A bare handle opens its panel too, so `/mission dotfiles/x` works.
      if (action === "panel" || action === "status" || action.includes("/")) {
        await openPanel(ctx, action.includes("/") ? action : handle);
        return;
      }
      if (!["attach", "start", "steps", "next"].includes(action)) { ctx.ui.notify("Use /mission [HANDLE] or /mission attach|start|status|steps|next REPO/SLUG", "warning"); return; }
      try { const result = await bridge.action(ctx, { action, handle }); await badge(ctx); ctx.ui.notify(JSON.stringify(result, null, 2), "info"); }
      catch (e: any) { ctx.ui.notify(e.message, "error"); }
    },
  });
  pi.registerCommand("missions", {
    description: "Open the mission desk in a Herdr pane",
    handler: async (_args, ctx) => {
      // The Go desk owns its terminal, so it runs in a pane of its own and the
      // command draws no picker here. Outside Herdr there is no pane to host
      // it, so the command reports that instead of falling back to a picker.
      try { ctx.ui.notify("Mission desk opened in " + (await bridge.openDesk()) + ".", "info"); }
      catch (e: any) { ctx.ui.notify("The mission desk needs a Herdr pane: " + e.message, "warning"); }
    },
  });
}
