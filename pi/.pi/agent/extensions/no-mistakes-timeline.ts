import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

const WIDGET_ID = "no-mistakes-timeline";
const POLL_MS = 1000;

type Step = {
  name: string;
  status: string;
  findings?: number;
  durationMs?: number;
  activity?: string;
};

type Snapshot = {
  id?: string;
  branch?: string;
  head?: string;
  status: string;
  steps: Step[];
};

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {}
  }
  return trimmed;
}

function splitRow(row: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < row.length; index++) {
    const character = row[index]!;
    if (character === '"') {
      if (quoted && row[index + 1] === '"') {
        value += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value.trim());
  return values.map(unquote);
}

function scalar(output: string, key: string): string | undefined {
  const match = output.match(new RegExp(`^\\s{0,2}${key}:\\s*(.+)$`, "m"));
  return match ? unquote(match[1]!) : undefined;
}

function table(output: string, name: string): Array<Record<string, string>> {
  const lines = output.split("\n");
  const headerIndex = lines.findIndex((line) =>
    new RegExp(`^${name}\\[\\d+\\]\\{([^}]+)\\}:$`).test(line.trim()),
  );
  if (headerIndex < 0) return [];
  const header = lines[headerIndex]!.trim().match(/\{([^}]+)\}/)?.[1]?.split(",") ?? [];
  const rows: Array<Record<string, string>> = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (!/^\s{2,}\S/.test(line)) break;
    const values = splitRow(line.trim());
    if (values.length !== header.length) continue;
    rows.push(Object.fromEntries(header.map((column, index) => [column, values[index] ?? ""])));
  }
  return rows;
}

export function parseNoMistakesStatus(output: string): Snapshot | undefined {
  if (/^runs:\s*0 runs yet/m.test(output)) return undefined;
  const active = new Map(table(output, "active_steps").map((row) => [row.step, row]));
  const steps = table(output, "steps").map((row): Step => {
    const live = active.get(row.step);
    const findings = Number(row.findings);
    const durationMs = Number(row.duration_ms);
    return {
      name: row.step || "step",
      status: row.status || "pending",
      findings: Number.isFinite(findings) ? findings : undefined,
      durationMs: Number.isFinite(durationMs) ? durationMs : undefined,
      activity: [live?.round, live?.active_for, live?.last_activity].filter(Boolean).join(" · ") || undefined,
    };
  });
  if (steps.length === 0) return undefined;
  return {
    id: scalar(output, "id"),
    branch: scalar(output, "branch"),
    head: scalar(output, "head"),
    status: scalar(output, "outcome") ?? scalar(output, "status") ?? scalar(output, "gate") ?? "running",
    steps,
  };
}

function duration(milliseconds?: number): string | undefined {
  if (!milliseconds || milliseconds < 1) return undefined;
  if (milliseconds < 1000) return `${milliseconds}ms`;
  if (milliseconds < 60000) return `${(milliseconds / 1000).toFixed(1)}s`;
  return `${Math.floor(milliseconds / 60000)}m${Math.floor((milliseconds % 60000) / 1000)}s`;
}

function glyph(status: string): { symbol: string; color: "success" | "warning" | "error" | "dim" } {
  switch (status) {
    case "completed":
    case "passed":
    case "checks-passed":
      return { symbol: "●", color: "success" };
    case "running":
    case "fixing":
    case "awaiting":
      return { symbol: "⟳", color: "warning" };
    case "failed":
    case "cancelled":
      return { symbol: "×", color: "error" };
    case "skipped":
      return { symbol: "–", color: "dim" };
    default:
      return { symbol: "○", color: "dim" };
  }
}

export function renderNoMistakesTimeline(snapshot: Snapshot, theme: Theme, width: number): string[] {
  const statusGlyph = glyph(snapshot.status);
  const title = [
    theme.fg("accent", theme.bold("No Mistakes")),
    snapshot.branch ? theme.fg("text", snapshot.branch) : undefined,
    theme.fg(statusGlyph.color, `${statusGlyph.symbol} ${snapshot.status}`),
  ].filter(Boolean).join(theme.fg("dim", " · "));
  const lines = [truncateToWidth(title, width, "…")];
  snapshot.steps.forEach((step, index) => {
    const stepGlyph = glyph(step.status);
    const connector = index === snapshot.steps.length - 1 ? "└─" : "├─";
    const details = [
      step.status,
      duration(step.durationMs),
      step.findings ? `${step.findings} findings` : undefined,
      step.activity,
    ].filter(Boolean).join(" · ");
    lines.push(truncateToWidth(
      `${theme.fg("borderMuted", `  ${connector}`)} ${theme.fg(stepGlyph.color, stepGlyph.symbol)} ${theme.fg("text", theme.bold(step.name))}${details ? theme.fg("dim", ` · ${details}`) : ""}`,
      width,
      "…",
    ));
  });
  return lines;
}

export default function noMistakesTimeline(pi: ExtensionAPI) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let enabled = true;
  let polling = false;
  let generation = 0;
  let pollController: AbortController | undefined;
  let snapshot: Snapshot | undefined;

  const display = (ctx: ExtensionContext) => {
    if (!enabled || !snapshot || ctx.mode !== "tui") {
      ctx.ui.setWidget(WIDGET_ID, undefined);
      ctx.ui.setStatus(WIDGET_ID, undefined);
      return;
    }
    ctx.ui.setWidget(
      WIDGET_ID,
      (_tui, theme) => ({
        render: (width: number) => renderNoMistakesTimeline(snapshot!, theme, width),
        invalidate() {},
      }),
      { placement: "belowEditor" },
    );
    const state = glyph(snapshot.status);
    ctx.ui.setStatus(WIDGET_ID, themeStatus(ctx, state.symbol, snapshot.status, state.color));
  };

  const refresh = async (ctx: ExtensionContext, expectedGeneration = generation) => {
    if (polling || !enabled || ctx.mode !== "tui" || expectedGeneration !== generation) return;
    const controller = new AbortController();
    pollController = controller;
    polling = true;
    try {
      const result = await pi.exec("no-mistakes", ["axi", "status"], {
        cwd: ctx.cwd,
        signal: controller.signal,
        timeout: 5000,
      });
      if (controller.signal.aborted || expectedGeneration !== generation) return;
      snapshot = result.code === 0 ? parseNoMistakesStatus(result.stdout) : undefined;
    } catch {
      if (controller.signal.aborted || expectedGeneration !== generation) return;
      snapshot = undefined;
    } finally {
      if (pollController === controller) {
        pollController = undefined;
        polling = false;
      }
      if (!controller.signal.aborted && expectedGeneration === generation) display(ctx);
    }
  };

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    const sessionGeneration = ++generation;
    void refresh(ctx, sessionGeneration);
    timer = setInterval(() => void refresh(ctx, sessionGeneration), POLL_MS);
    timer.unref?.();
  });

  pi.on("session_shutdown", (_event, ctx) => {
    generation++;
    pollController?.abort();
    pollController = undefined;
    polling = false;
    if (timer) clearInterval(timer);
    timer = undefined;
    ctx.ui.setWidget(WIDGET_ID, undefined);
    ctx.ui.setStatus(WIDGET_ID, undefined);
  });

  pi.registerCommand("no-mistakes-timeline", {
    description: "Toggle or refresh the No Mistakes pipeline timeline",
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase();
      if (action === "off") enabled = false;
      else if (action === "on") enabled = true;
      else if (action === "refresh") enabled = true;
      else enabled = !enabled;
      const commandGeneration = generation;
      if (enabled) await refresh(ctx, commandGeneration);
      else display(ctx);
      if (commandGeneration === generation) {
        ctx.ui.notify(`No Mistakes timeline ${enabled ? "on" : "off"}`, "info");
      }
    },
  });
}

function themeStatus(
  ctx: ExtensionContext,
  symbol: string,
  status: string,
  color: "success" | "warning" | "error" | "dim",
): string {
  return `${ctx.ui.theme.fg(color, symbol)}${ctx.ui.theme.fg("dim", ` NM ${status}`)}`;
}
