import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { MissionBridge } from "./core.mjs";

export default function missions(pi: ExtensionAPI, options = {}) {
  const bridge = new MissionBridge(options);
  const guarded = (fn: Function) => async (event: any, ctx: any) => {
    try { await fn(event, ctx); }
    catch (e: any) { bridge.error = e.message; ctx.ui.notify("Mission tracking: " + e.message, "warning"); }
  };
  const badge = async (ctx: any) => {
    if (!bridge.hint) { ctx.ui.setStatus("mission", undefined); return; }
    const c = await bridge.current(ctx);
    ctx.ui.setStatus("mission", `${bridge.hint.handle} · ${c?.attempt?.step || c?.record.state.status}`);
  };
  pi.on("session_start", guarded(async (_e: any, ctx: any) => {
    await bridge.restore(ctx);
    if (bridge.hint) await bridge.record(ctx, {type:"session-start",summary:"Pi session restored from local mission context"});
    await badge(ctx);
  }));
  pi.on("session_before_switch", guarded(async (_e: any, ctx: any) => { await bridge.record(ctx, { type: "session-end", summary: "Session switch; ownership preserved for resume" }); }));
  pi.on("session_shutdown", guarded(async (_e: any, ctx: any) => { await bridge.record(ctx, { type: "session-end", summary: "Session shutdown; preserve transcript and owner" }); }));
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
        `Mission ${bridge.hint.handle}, step ${c.attempt.step}, attempt ${c.attempt.id}.\n${c.attempt.brief_snapshot}\nWrite the artifact at ${bridge.vault}/6_missions/${bridge.hint.handle}/${c.attempt.artifact}. Report progress with the mission tool. Explicitly report finish/fail; turn end alone does not complete work. Stay in this worktree. Human checkpoints require the user.` :
        `Mission ${bridge.hint.handle} is ${c?.record.state.status}. Inspect status. Start another step only with mission action=next after checkpoints are accepted. Do not modify code while no step is active.` } };
    } catch (e: any) { bridge.error = e.message; return { message: { customType: "mission-context", display: false, content: "Mission tracking failed: " + e.message + ". Restore tracking before making changes." } }; }
  });
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "mission" || event.toolName === "read" || event.toolName === "tool_search") return;
    if (!bridge.hint) {
      if (bridge.expectedAttachment) return {block:true,reason:"Restore the mission credential cache before changing repository files."};
      return;
    }
    try { await bridge.flush(ctx); const c = await bridge.current(ctx); if (!c?.attempt) return { block: true, reason: "No active mission step. Inspect the checkpoint or explicitly pick up next." }; }
    catch (e: any) { return { block: true, reason: "Mission tracking must recover before work continues: " + e.message }; }
  });
  pi.on("agent_start", guarded(async (_e: any, ctx: any) => { await bridge.record(ctx, { type: "agent-start", summary: "Pi turn started" }); }));
  pi.on("agent_end", guarded(async (event: any, ctx: any) => { await bridge.end(ctx, event); await badge(ctx); }));
  // agent_end can be followed by automatic retry/compaction/steered input.
  // Pi 1.5's final settlement boundary is the completion authority.
  pi.on("agent_before_settle", (event) => { bridge.lastOutcome = event.outcome; });
  pi.on("agent_settled", guarded(async (event: any, ctx: any) => {
    const result = await bridge.settled(ctx, { ...event, outcome: bridge.lastOutcome });
    await badge(ctx);
    // Starting a mission authorizes its eligible steps. Attaching an existing
    // session records its work without silently starting additional steps.
    if (result?.state.status === "ready" && bridge.hint?.autoContinue && !ctx.hasPendingMessages()) {
      pi.sendMessage({customType:"mission-next",display:true,
        content:`The previous step of ${bridge.hint.handle} passed its checks. Call mission action=next to pick up the next eligible step in this same worktree. Read its returned brief before editing. Pause at human checkpoints.`},
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
  pi.registerCommand("mission", {
    description: "Mission: /mission attach|start|status|steps|next REPO/SLUG",
    handler: async (args, ctx) => {
      const [action = "status", handle] = args.trim().split(/\s+/).filter(Boolean);
      if (!["attach", "start", "status", "steps", "next"].includes(action)) { ctx.ui.notify("Use /mission attach|start|status|steps|next REPO/SLUG", "warning"); return; }
      try { const result = await bridge.action(ctx, { action, handle }); await badge(ctx); ctx.ui.notify(JSON.stringify(result, null, 2), "info"); }
      catch (e: any) { ctx.ui.notify(e.message, "error"); }
    },
  });
  pi.registerCommand("missions", {
    description: "Select a mission to inspect, start, or attach to this session",
    handler: async (_args, ctx) => {
      try {
        const records = await bridge.call(["list"]);
        if (!ctx.hasUI) { ctx.ui.notify(JSON.stringify(records), "info"); return; }
        const labels = records.map((r: any) => `${r.handle} · ${r.state.status} · ${r.mission.title}`);
        const selected = await ctx.ui.select("Missions", labels);
        if (!selected) return;
        const handle = records[labels.indexOf(selected)].handle;
        const action = await ctx.ui.select(handle, ["status", "steps", "start", "attach", "next"]);
        if (action) { const result = await bridge.action(ctx, { action, handle }); await badge(ctx); ctx.ui.notify(JSON.stringify(result, null, 2), "info"); }
      } catch (e: any) { ctx.ui.notify(e.message, "error"); }
    },
  });
}
