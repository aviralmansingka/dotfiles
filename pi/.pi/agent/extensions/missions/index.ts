import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { MissionBridge, missionContinues, missionToolBlock, trackingFailureBlock } from "./core.mjs";
import { LABEL_COLUMN, actionForKey, buildPanelModel, checkpointArgs } from "./panel.mjs";

export default function missions(pi: ExtensionAPI, options = {}) {
  const bridge = new MissionBridge(options);
  // The latest ctx, so the launch sweep can run on a timer while the session is
  // idle. The desk writes requests; this session claims and starts them.
  let live: any = null;
  const sweep = () => { if (live) bridge.sweepLaunches(live).catch((e: any) => { bridge.error = e.message; }); };
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
    await bridge.restore(ctx);
    sweep();
    if (bridge.hint) await bridge.record(ctx, {type:"session-start",summary:"Pi session restored from local mission context"});
    await badge(ctx);
  }));
  pi.on("session_before_switch", guarded(async (_e: any, ctx: any) => { await bridge.record(ctx, { type: "session-end", summary: "Session switch; ownership preserved for resume" }); }));
  pi.on("session_shutdown", guarded(async (_e: any, ctx: any) => { clearInterval(timer); await bridge.record(ctx, { type: "session-end", summary: "Session shutdown; preserve transcript and owner" }); }));
  pi.on("before_agent_start", async (_e, ctx) => {
    bridge.lastOutcome = undefined;
    if (!bridge.hint) {
      if (bridge.expectedAttachment) return {message:{customType:"mission-context",display:false,content:"Mission context cannot be restored. Repair its private credential cache before changing repository files."}};
      return;
    }
    try {
      await bridge.flush(ctx);
      const c = await bridge.current(ctx);
      return { message: { customType: "mission-context", display: false, content: c?.attempt ?
        `Mission ${bridge.hint.handle}, step ${c.attempt.step}, attempt ${c.attempt.id}.\n${c.attempt.brief_snapshot}\nWrite the artifact at ${bridge.vault}/6_missions/${bridge.hint.handle}/${c.attempt.artifact}. Report progress with the mission tool. Explicitly report finish/fail; turn end alone does not complete work. Stay in this worktree. Human reviews require the user.` :
        `Mission ${bridge.hint.handle} is ${c?.record.state.status}. Inspect status. Start another step only with mission action=next after reviews are decided. Do not modify code while no step is active.` } };
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
  pi.on("agent_start", guarded(async (_e: any, ctx: any) => { await bridge.record(ctx, { type: "agent-start", summary: "Pi turn started" }); }));
  // A press in the desk lands between turns, so poll for it: a captain that sits
  // idle still starts a mission the human asked for. Two seconds is fast enough
  // for a keypress and quiet enough to cost one directory read.
  const timer = setInterval(sweep, 2000);
  // The poll must never hold the process open: an idle session still exits.
  (timer as any)?.unref?.();
  pi.on("agent_end", guarded(async (event: any, ctx: any) => { await bridge.end(ctx, event); await badge(ctx); }));
  // agent_end can be followed by automatic retry/compaction/steered input.
  // Pi 1.5's final settlement boundary is the completion authority.
  pi.on("agent_before_settle", (event) => { bridge.lastOutcome = event.outcome; });
  pi.on("agent_settled", guarded(async (event: any, ctx: any) => {
    const result = await bridge.settled(ctx, { ...event, outcome: bridge.lastOutcome });
    await badge(ctx);
    sweep();
    // Starting a mission authorizes its eligible steps. Attaching an existing
    // session records its work without silently starting additional steps.
    // A finished or human-held mission never asks for another step.
    if (missionContinues(result?.state) && bridge.hint?.autoContinue && !ctx.hasPendingMessages()) {
      pi.sendMessage({customType:"mission-next",display:true,
        content:`The previous step of ${bridge.hint.handle} passed its checks. Call mission action=next to pick up the next eligible step in this same worktree. Read its returned brief before editing. Pause at human reviews.`},
        {triggerTurn:true,deliverAs:"followUp"});
    }
  }));
  pi.on("tool_execution_start", guarded(async (e: any, ctx: any) => { await bridge.record(ctx, { type: "tool-start", tool: e.toolName, summary: "Tool call " + e.toolCallId }); }));
  pi.on("tool_execution_end", guarded(async (e: any, ctx: any) => { await bridge.record(ctx, { type: "tool-end", tool: e.toolName, summary: "Tool call " + e.toolCallId + (e.isError ? " failed" : " ended") }); }));

  pi.registerTool({
    name: "mission", label: "Mission", exposure: "deferred",
    description: "Create, inspect, launch, or attach vault missions. Record structured progress and request verified step completion. One repository workspace, one persistent worktree and Pi owner per mission.",
    parameters: Type.Object({
      action: Type.Union(["list", "create", "steps", "edit", "status", "start", "attach", "next", "progress", "verify", "finish", "fail"].map(v => Type.Literal(v))),
      handle: Type.Optional(Type.String()), repo: Type.Optional(Type.String()), title: Type.Optional(Type.String()), goal: Type.Optional(Type.String()),
      kind: Type.Optional(Type.Union([Type.Literal("research"), Type.Literal("implementation")])), steps: Type.Optional(Type.Array(Type.String())),
      step: Type.Optional(Type.String()), instructions: Type.Optional(Type.String()), acceptance: Type.Optional(Type.String()),
      checks: Type.Optional(Type.Array(Type.String())), output: Type.Optional(Type.String()), agent: Type.Optional(Type.String()), launch_id: Type.Optional(Type.String()),
      status: Type.Optional(Type.Union(["working", "blocked", "needs-input", "ready"].map(v => Type.Literal(v)))),
      summary: Type.Optional(Type.String()), next: Type.Optional(Type.String()), blocker: Type.Optional(Type.String()),
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
    description: "Select a mission and open its panel",
    handler: async (_args, ctx) => {
      const handle = await pickHandle(ctx);
      if (handle) await openPanel(ctx, handle);
    },
  });
}
