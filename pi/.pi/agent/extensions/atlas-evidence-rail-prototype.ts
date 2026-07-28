import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

type Stage = {
  label: string;
  state: "done" | "active" | "pending" | "failed";
  summary: string;
  observedAt?: string;
  kind?: string;
  detail?: string;
  command?: string;
  exitStatus?: number;
};

type RunSnapshot = {
  runId: string;
  revision: number;
  title: string;
  stage: string;
  updatedAt: string;
  stages: Stage[];
};

const WIDGET_ID = "atlas-evidence-rail-prototype";
const POLL_MS = 1000;
const VIRTUAL_STEP_LIMIT = 8;
const REGISTRY_ROOT =
  process.env.VAULT_HUNTER_STATE_DIR ??
  join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "vault-hunter");

const EMPTY_STAGES: Stage[] = [
  {
    label: "No registered Run",
    state: "pending",
    summary: "Launch Vault Hunter from this Pi session",
  },
];

function pad(text: string, width: number): string {
  const clipped = truncateToWidth(text, width, "…");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

class EvidenceRailPrototype {
  private selected = VIRTUAL_STEP_LIMIT - 1;
  private expanded = true;
  private showAllSteps = false;

  constructor(
    private readonly theme: Theme,
    private readonly requestRender: () => void,
    private readonly done: () => void,
    private readonly currentRun: () => RunSnapshot | undefined,
  ) {}

  private allStages(): Stage[] {
    return this.currentRun()?.stages.length
      ? this.currentRun()!.stages
      : EMPTY_STAGES;
  }

  private stages(): Stage[] {
    const stages = this.allStages();
    return this.showAllSteps ? stages : stages.slice(-VIRTUAL_STEP_LIMIT);
  }

  handleInput(data: string): void {
    const stages = this.stages();
    if (matchesKey(data, Key.ctrl("v"))) {
      const selectedStage = stages[this.selected];
      this.showAllSteps = !this.showAllSteps;
      const nextStages = this.stages();
      const nextSelected = selectedStage ? nextStages.indexOf(selectedStage) : -1;
      this.selected = nextSelected >= 0 ? nextSelected : Math.max(0, nextStages.length - 1);
      this.requestRender();
      return;
    }

    if (
      matchesKey(data, "q") ||
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.ctrl("c"))
    ) {
      this.done();
      return;
    }

    if (
      (matchesKey(data, "j") || matchesKey(data, Key.down)) &&
      this.selected < stages.length - 1
    ) {
      this.selected += 1;
      this.requestRender();
      return;
    }

    if (
      (matchesKey(data, "k") || matchesKey(data, Key.up)) &&
      this.selected > 0
    ) {
      this.selected -= 1;
      this.requestRender();
      return;
    }

    if (matchesKey(data, Key.enter)) {
      this.expanded = !this.expanded;
      this.requestRender();
    }
  }

  render(width: number): string[] {
    if (width < 80) {
      return [
        this.theme.fg(
          "warning",
          truncateToWidth("Atlas rail prototype requires 80 columns", width),
        ),
      ];
    }

    const frameWidth = Math.min(width, 115);
    const leftWidth = Math.max(30, Math.floor((frameWidth - 3) * 0.39));
    const rightWidth = frameWidth - leftWidth - 3;
    const allStages = this.allStages();
    const stages = this.stages();
    const hiddenSteps = allStages.length - stages.length;
    if (this.selected >= stages.length) this.selected = stages.length - 1;
    const selected = stages[this.selected]!;
    const lines: string[] = [];

    const row = (left = "", right = "") => {
      lines.push(
        pad(left, leftWidth) +
          this.theme.fg("dim", " │ ") +
          pad(right, rightWidth),
      );
    };

    const rule = () =>
      this.theme.fg(
        "dim",
        "─".repeat(leftWidth) + "─┼─" + "─".repeat(rightWidth),
      );

    const snapshot = this.currentRun();
    const title =
      this.theme.fg("accent", this.theme.bold("VAULT HUNTER")) +
      "  " +
      this.theme.fg("text", this.theme.bold(snapshot?.title ?? "No registered Run")) +
      this.theme.fg(
        "muted",
        ` · ${snapshot ? `${snapshot.runId} · r${snapshot.revision}` : "Registry unavailable"}`,
      );
    const activeBadge = this.theme.bg(
      "toolSuccessBg",
      this.theme.fg("success", this.theme.bold(" ACTIVE ")),
    );
    lines.push(pad(title, frameWidth - 8) + activeBadge);

    row(
      this.theme.fg("warning", this.theme.bold("Run timeline")),
      this.theme.fg(
        "warning",
        this.theme.bold(`Selected · ${selected.label}`),
      ),
    );
    row(
      this.theme.fg(
        "muted",
        snapshot
          ? `${allStages.length} Registry entries · showing ${stages.length} · revision ${snapshot.revision}`
          : "Registry session not bound",
      ),
      this.theme.fg("muted", selected.summary),
    );
    lines.push(rule());

    const rightRows = this.detailRows(selected);
    let rightIndex = 0;

    row(this.theme.fg("dim", " │"), rightRows[rightIndex++] ?? "");
    if (hiddenSteps > 0) {
      row(
        this.theme.fg("dim", ` ├─ …  ${hiddenSteps} earlier ${hiddenSteps === 1 ? "step" : "steps"} · expand with <c-v>`),
        "",
      );
    }
    stages.forEach((stage, index) => {
      const last = index === stages.length - 1;
      const connector = last ? " └─ " : " ├─ ";
      const glyph = stage.state === "done" ? "✓" : stage.state === "active" ? "◉" : stage.state === "failed" ? "!" : "○";
      const color = stage.state === "done" ? "success" : stage.state === "active" ? "warning" : stage.state === "failed" ? "error" : "muted";
      let stageText =
        this.theme.fg("dim", connector) +
        this.theme.fg(color, ` ${glyph} ${stage.label} `);
      if (index === this.selected) {
        stageText =
          this.theme.fg("dim", connector) +
          this.theme.bg(
            "selectedBg",
            this.theme.fg(color, this.theme.bold(` ${glyph} ${stage.label} `)),
          );
      }
      row(stageText, rightRows[rightIndex++] ?? "");

      const childConnector = last ? "     " : " │   ";
      row(
        this.theme.fg("dim", childConnector + "└─ ") +
          this.theme.fg(index === this.selected ? "accent" : "muted", stage.summary),
        rightRows[rightIndex++] ?? "",
      );
    });

    while (rightIndex < rightRows.length) {
      row("", rightRows[rightIndex++] ?? "");
    }

    lines.push(rule());
    row(
      this.theme.fg(
        "dim",
        `j/k select · Enter detail · Ctrl+V ${this.showAllSteps ? "last 8" : "all"} · q quit`,
      ),
      this.theme.fg(
        "dim",
        `${snapshot ? `Registry ${snapshot.updatedAt || "snapshot"}` : "Registry unavailable"} · ${frameWidth}×${lines.length + 2}`,
      ),
    );

    return lines.map((line) => truncateToWidth(line, width, ""));
  }

  private detailRows(stage: Stage): string[] {
    const th = this.theme;
    const color = stage.state === "done" ? "success" : stage.state === "active" ? "warning" : stage.state === "failed" ? "error" : "muted";

    if (stage.kind) {
      const rows = [
        th.bg("customMessageBg", th.fg("customMessageLabel", th.bold(" Registry entry "))),
        th.fg("muted", " kind        ") + th.fg("syntaxNumber", stage.kind),
        th.fg("muted", " state       ") + th.fg(color, th.bold(stage.state)),
        th.fg("muted", " observed    ") + th.fg("text", stage.observedAt ?? "unknown"),
        th.fg("muted", " summary     ") + th.fg("text", stage.summary),
      ];
      if (!this.expanded) return rows;
      if (stage.detail) rows.push(th.fg("muted", " detail      ") + th.fg("text", stage.detail));
      if (stage.command) {
        rows.push(th.fg("muted", " reproduce"));
        rows.push(th.fg("mdLink", ` ${stage.command}`));
      }
      if (stage.exitStatus !== undefined) {
        rows.push(th.fg("muted", " exit        ") + th.fg(stage.exitStatus === 0 ? "success" : "error", String(stage.exitStatus)));
      }
      rows.push(th.fg("muted", " authority   ") + th.fg("mdLink", "Registry observation"));
      return rows;
    }

    return [
      th.fg("muted", "Registry session"),
      th.bg("customMessageBg", th.fg("customMessageLabel", ` ${stage.label} `)),
      th.fg("muted", " state       ") + th.fg(color, stage.state),
      th.fg("muted", " summary     ") + th.fg("text", stage.summary),
    ];
  }

  invalidate(): void {}
}

function restoredRunId(ctx: ExtensionContext): string | undefined {
  for (const entry of [...ctx.sessionManager.getBranch()].reverse()) {
    if (
      entry.type !== "message" ||
      entry.message.role !== "toolResult" ||
      entry.message.toolName !== "vault_hunter_run" ||
      entry.message.isError === true
    ) continue;
    const runId = (entry.message.details as { runId?: unknown } | undefined)?.runId;
    if (typeof runId === "string" && runId) return runId;
  }
  return undefined;
}

function registry(input: Record<string, unknown>, signal?: AbortSignal): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn("vault-hunter-registry", [], {
      stdio: ["pipe", "pipe", "pipe"],
      signal,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(stderr.trim() || `vault-hunter-registry exited ${code}`));
      try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

function sessionIdentity(ctx: ExtensionContext) {
  const sessionFile = ctx.sessionManager.getSessionFile();
  return sessionFile
    ? { source: "herdr:pi", kind: "path", value: sessionFile }
    : { source: "pi", kind: "session-id", value: ctx.sessionManager.getSessionId() };
}

function stageState(value: unknown): Stage["state"] {
  if (["failed", "rejected", "interrupted", "error"].includes(String(value))) return "failed";
  if (["active", "running", "invoked", "in-progress"].includes(String(value))) return "active";
  if (["passed", "accepted", "completed", "finished", "observed"].includes(String(value))) return "done";
  return "pending";
}

function usageSummary(detail: unknown): string | undefined {
  if (typeof detail !== "string") return undefined;
  try {
    const decoded = JSON.parse(detail);
    if (decoded?.schema !== "vault-hunter-parent-usage/v1") return undefined;
    const usage = decoded.usage ?? {};
    const tokens = Number(usage.total_tokens);
    const requests = Number(usage.requests);
    const cost = Number(usage.cost);
    return [
      Number.isFinite(requests) ? `${requests} requests` : undefined,
      Number.isFinite(tokens) ? `${(tokens / 1_000_000).toFixed(1)}m tokens` : undefined,
      Number.isFinite(cost) ? `$${cost.toFixed(2)}` : undefined,
    ].filter(Boolean).join(" · ");
  } catch {
    return undefined;
  }
}

function projectStages(record: any): Stage[] {
  const stages: Stage[] = [];
  for (const participant of record?.participants ?? []) {
    const session = participant?.agent_session;
    const herdr = participant?.herdr;
    stages.push({
      label: participant?.role === "driver" ? "Driver" : String(participant?.role ?? "Participant"),
      state: "active",
      summary: String(participant?.participant_id ?? "registered participant"),
      observedAt: participant?.observed_at,
      kind: "participant",
      detail: [
        session ? `${session.source}/${session.kind}` : undefined,
        herdr?.pane_id ? `pane ${herdr.pane_id}` : undefined,
      ].filter(Boolean).join(" · "),
    });
  }
  for (const event of record?.lifecycle ?? []) {
    const usage = usageSummary(event?.detail);
    stages.push({
      label: event?.kind === "run" ? "Run" : event?.kind === "parent/usage" ? "Parent usage" : String(event?.kind ?? "Lifecycle"),
      state: stageState(event?.state),
      summary: usage ?? String(event?.detail || event?.state || "recorded"),
      observedAt: event?.observed_at,
      kind: String(event?.kind ?? "lifecycle"),
      detail: usage ? `boundary telemetry · ${event?.state ?? "observed"}` : String(event?.detail ?? ""),
    });
  }
  for (const evidence of record?.evidence ?? []) {
    stages.push({
      label: String(evidence?.verifier_id ?? "Evidence"),
      state: stageState(evidence?.state),
      summary: String(evidence?.detail || evidence?.state || "recorded evidence"),
      observedAt: evidence?.observed_at,
      kind: "evidence",
      detail: evidence?.artifact_sha256 ? `artifact ${String(evidence.artifact_sha256).slice(0, 12)}…` : "",
      command: typeof evidence?.command === "string" ? evidence.command : undefined,
      exitStatus: Number.isInteger(evidence?.exit_status) ? evidence.exit_status : undefined,
    });
  }
  for (const observation of record?.observations ?? []) {
    stages.push({
      label: String(observation?.title || observation?.kind || "Observation"),
      state: stageState(observation?.state),
      summary: String(observation?.summary || observation?.state || "recorded observation"),
      observedAt: observation?.observed_at,
      kind: String(observation?.kind ?? "observation"),
      detail: typeof observation?.detail === "string" ? observation.detail : "",
    });
  }
  stages.sort((left, right) => String(left.observedAt ?? "").localeCompare(String(right.observedAt ?? "")));
  return stages.length ? stages : [{
    label: "Run",
    state: "active",
    summary: "Registry record loaded",
    observedAt: record?.updated_at,
    kind: "run",
  }];
}

function projectSnapshot(record: any): RunSnapshot {
  const runId = record?.run_id;
  const revision = record?.revision;
  const title = record?.task?.title ?? record?.work_reference?.title;
  if (typeof runId !== "string" || !Number.isSafeInteger(revision) || typeof title !== "string") {
    throw new Error("Registry returned an incomplete Run.");
  }
  return {
    runId,
    revision,
    title,
    stage: typeof record?.stage === "string" ? record.stage : "active",
    updatedAt: typeof record?.updated_at === "string" ? record.updated_at : "",
    stages: projectStages(record),
  };
}

export default function atlasEvidenceRailPrototype(pi: ExtensionAPI) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let controller: AbortController | undefined;
  let polling = false;
  let generation = 0;
  let candidateRunId: string | undefined;
  let snapshot: RunSnapshot | undefined;

  const display = (ctx: ExtensionContext) => {
    if (ctx.mode !== "tui" || !snapshot) {
      ctx.ui.setWidget(WIDGET_ID, undefined);
      ctx.ui.setStatus(WIDGET_ID, undefined);
      return;
    }
    ctx.ui.setWidget(
      WIDGET_ID,
      (_tui, theme) => ({
        render: (width: number) => [truncateToWidth(
          `${theme.fg("accent", theme.bold("Vault Hunter"))}${theme.fg("dim", " · ")}${theme.fg("text", snapshot!.title)}${theme.fg("dim", ` · r${snapshot!.revision} · ${snapshot!.stage}`)}`,
          width,
          "…",
        )],
        invalidate() {},
      }),
      { placement: "belowEditor" },
    );
    ctx.ui.setStatus(
      WIDGET_ID,
      `${ctx.ui.theme.fg("success", "●")}${ctx.ui.theme.fg("dim", ` VH r${snapshot.revision}`)}`,
    );
  };

  const refresh = async (ctx: ExtensionContext, expectedGeneration = generation) => {
    if (polling || !candidateRunId || ctx.mode !== "tui" || expectedGeneration !== generation) return;
    const refreshController = new AbortController();
    controller = refreshController;
    polling = true;
    let changed = false;
    try {
      const runs = await registry({
        action: "list",
        root: REGISTRY_ROOT,
        filter: {
          participant_id: `pi-${ctx.sessionManager.getSessionId()}`,
          agent_session: sessionIdentity(ctx),
        },
      }, refreshController.signal);
      if (refreshController.signal.aborted || expectedGeneration !== generation) return;
      if (!Array.isArray(runs) || runs.length !== 1 || runs[0]?.run_id !== candidateRunId) {
        if (snapshot) {
          snapshot = undefined;
          changed = true;
        }
        return;
      }
      if (snapshot?.runId === candidateRunId && snapshot.revision === runs[0]?.revision) return;
      const record = await registry({
        action: "get",
        root: REGISTRY_ROOT,
        run_id: candidateRunId,
      }, refreshController.signal);
      if (refreshController.signal.aborted || expectedGeneration !== generation) return;
      const next = projectSnapshot(record);
      if (next.runId !== candidateRunId) throw new Error("Registry returned a different Run.");
      snapshot = next;
      changed = true;
    } catch {
      // Preserve the last valid frame across transient read failures.
    } finally {
      if (controller === refreshController) controller = undefined;
      polling = false;
      if (!refreshController.signal.aborted && expectedGeneration === generation && changed) display(ctx);
    }
  };

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    candidateRunId = restoredRunId(ctx);
    const sessionGeneration = ++generation;
    void refresh(ctx, sessionGeneration);
    timer = setInterval(() => void refresh(ctx, sessionGeneration), POLL_MS);
    timer.unref?.();
  });

  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "vault_hunter_run" || event.isError || ctx.mode !== "tui") return;
    const runId = (event.details as { runId?: unknown } | undefined)?.runId;
    if (typeof runId !== "string" || !runId) return;
    if (candidateRunId !== runId) {
      candidateRunId = runId;
      snapshot = undefined;
      display(ctx);
    }
    await refresh(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    generation++;
    controller?.abort();
    controller = undefined;
    polling = false;
    if (timer) clearInterval(timer);
    timer = undefined;
    candidateRunId = undefined;
    snapshot = undefined;
    ctx.ui.setWidget(WIDGET_ID, undefined);
    ctx.ui.setStatus(WIDGET_ID, undefined);
  });

  pi.registerCommand("atlas-rail-prototype", {
    description: "Open the disposable Atlas evidence-forward rail",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("The Atlas rail prototype requires interactive TUI mode.", "warning");
        return;
      }

      await ctx.ui.custom<void>((tui, theme, _keybindings, done) =>
        new EvidenceRailPrototype(theme, () => tui.requestRender(), done, () => snapshot),
      );
    },
  });
}
