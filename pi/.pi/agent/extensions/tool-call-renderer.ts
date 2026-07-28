import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const ASSISTANT_PATCHED = Symbol.for("aviral.pi.work-step-renderer.assistant");
const TOOL_PATCHED = Symbol.for("aviral.pi.work-step-renderer.tool");
const CONTROLLER = Symbol.for("aviral.pi.work-step-renderer.controller");
const WORK_STEP = Symbol.for("aviral.pi.work-step-renderer.step");
const WORK_STEP_ROW = Symbol.for("aviral.pi.work-step-renderer.row");
const THINKING_DRAFT = Symbol.for("aviral.pi.work-step-renderer.thinking-draft");
const SUBAGENT_BRIDGE = Symbol.for(
  "aviral.pi.work-step-renderer.subagent-bridge",
);
const ASSISTANT_INVALIDATING = Symbol.for(
  "aviral.pi.work-step-renderer.assistant-invalidating",
);
const CLOCK_SOURCE = Symbol.for("aviral.pi.work-step-renderer.clock-source");
const DEFAULT_CLOCK = () => Date.now();
const BACKGROUND_UPDATE_EVENT = "subagent:background-update";

type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  startedAt?: number;
  completedAt?: number;
};

type ConnectedOutputMode = "auto" | "hidden" | "expanded";

type ConnectedRenderBridge = {
  layout: "connected";
  outputMode: ConnectedOutputMode;
  thinkingVisible: boolean;
  clock?: () => number;
  invalidate?: () => void;
  parentRail: string;
  parentConnector: "├─" | "└─";
  lifecycle: {
    status: "pending" | "running" | "completed" | "failed";
    startedAt?: number;
    completedAt?: number;
    thinking: string[];
  };
};

type ConnectedComponentState = {
  bridge: ConnectedRenderBridge;
  expandedInitialized: boolean;
  collapsedSource: Exclude<ConnectedOutputMode, "expanded">;
};

type PersistedOutcome = {
  completedToolCallIds: Set<string>;
  failed: boolean;
};

type ActivityRun = {
  steps: WorkStep[];
  groups: ActivityGroup[];
};

type ActivityGroup = {
  steps: WorkStep[];
  run: ActivityRun;
};

type WorkStep = {
  title: string;
  titleLocked: boolean;
  thinking: string[];
  thinkingVisible: boolean;
  toolCalls: ToolCall[];
  toolCallIds: Set<string>;
  completedToolCallIds: Set<string>;
  failed: boolean;
  startedAt?: number;
  completedAt?: number;
  run: ActivityRun;
  group: ActivityGroup;
  row?: WorkStepRow;
};

type ThinkingDraft = {
  title?: string;
  thinking: string[];
};

type RendererState = {
  pending: Map<string, WorkStep>;
  persisted: WeakMap<object, PersistedOutcome>;
  assembling?: {
    step: WorkStep;
    remaining: Set<string>;
  };
  currentGroup?: ActivityGroup;
  currentRun?: ActivityRun;
  sessionId?: string;
  restoredToolCallIds: Set<string>;
  toolComponents: Map<string, any>;
  connected: WeakMap<object, ConnectedComponentState>;
  scheduler: ClockInvalidationScheduler;
};

type RendererController = {
  assistantNativeMessage(message: any): any;
  assistantUpdated(component: any, message: any): void;
  assistantThinkingChanged(component: any, hidden: boolean): void;
  assistantHasStep(component: any): boolean;
  renderAssistant(component: any, lines: string[], width: number): string[];
  toolUpdated(component: any): void;
  toolExpanded(component: any): void;
  renderTool(component: any, width: number): string[];
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function resolveConnectedClock(): () => number {
  try {
    const source = (globalThis as any)[CLOCK_SOURCE];
    if (!source || typeof source !== "object") return DEFAULT_CLOCK;
    const now = source.now;
    return typeof now === "function" && finiteNumber(now())
      ? now
      : DEFAULT_CLOCK;
  } catch {
    return DEFAULT_CLOCK;
  }
}

function bridgeNow(bridge?: ConnectedRenderBridge): number {
  try {
    const supplied = bridge?.clock?.();
    return finiteNumber(supplied) ? supplied : DEFAULT_CLOCK();
  } catch {
    return DEFAULT_CLOCK();
  }
}

function formatElapsed(milliseconds: number): string {
  if (milliseconds < 1000) return `${milliseconds}ms`;
  if (milliseconds < 60000) return `${(milliseconds / 1000).toFixed(1)}s`;
  return `${Math.floor(milliseconds / 60000)}m${Math.floor((milliseconds % 60000) / 1000)}s`;
}

class ClockInvalidationScheduler {
  private readonly live = new Map<any, ConnectedRenderBridge>();
  private timer?: ReturnType<typeof setTimeout>;
  private notifying = false;

  arm(component: any, bridge: ConnectedRenderBridge): void {
    if (bridge.lifecycle.status !== "running") {
      this.remove(component);
      return;
    }
    this.live.set(component, bridge);
    if (!this.timer && !this.notifying) this.schedule();
  }

  remove(component: any): void {
    this.live.delete(component);
    if (this.live.size === 0) this.clearTimer();
  }

  transfer(
    previous: any,
    replacement: any,
    bridge: ConnectedRenderBridge,
  ): void {
    if (this.live.get(previous) !== bridge) return;
    this.live.delete(previous);
    this.live.set(replacement, bridge);
    if (!this.timer && !this.notifying) this.schedule();
  }

  clear(): void {
    this.live.clear();
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(): void {
    if (this.live.size === 0 || this.timer) return;
    let delay = 1000;
    for (const bridge of this.live.values()) {
      const now = bridgeNow(bridge);
      const startedAt = bridge.lifecycle.startedAt;
      const elapsed = finiteNumber(startedAt) ? Math.max(0, now - startedAt) : 0;
      const precision = elapsed < 1000 ? 1 : elapsed < 60000 ? 100 : 1000;
      const untilBoundary = precision - (elapsed % precision);
      delay = Math.min(delay, Math.max(1, untilBoundary));
    }
    this.timer = setTimeout(() => this.tick(), delay);
    this.timer.unref?.();
  }

  private tick(): void {
    this.timer = undefined;
    this.notifying = true;
    try {
      for (const [component, bridge] of [...this.live]) {
        if (bridge.lifecycle.status !== "running") {
          this.live.delete(component);
          continue;
        }
        component.invalidate?.();
        component.ui?.requestRender?.();
      }
    } finally {
      this.notifying = false;
    }
    this.schedule();
  }
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function firstNonEmptyLine(value: string | undefined): string | undefined {
  return value
    ?.split("\n")
    .map((line) => line.trim())
    .find(Boolean);
}

function sanitizeTitle(value: string | undefined): string | undefined {
  const line = firstNonEmptyLine(value);
  if (!line) return undefined;

  const title = line
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/^\s*(?:#{1,6}\s+|>\s*|(?:[-+*]|\d+[.)])\s+)/, "")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return title || undefined;
}

function cleanToolName(value: unknown): string {
  return (
    asString(value)
      ?.replace(/[\u0000-\u001f\u007f]/g, "")
      .trim() || "tool"
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function displayToolName(toolCall: ToolCall): string {
  if (toolCall.name !== "mcp") return toolCall.name;
  const server =
    asString(toolCall.arguments.server)?.trim() ||
    asString(toolCall.arguments.connect)?.trim() ||
    "gateway";
  const label = cleanToolName(server).replace(/[_-]workspace$/i, "");
  return `mcp(${label || "gateway"})`;
}

function groupTools(toolCalls: ToolCall[]): string[] {
  const counts = new Map<string, number>();
  for (const toolCall of toolCalls) {
    const name = displayToolName(toolCall);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(
    ([name, count]) => `${name}${count === 1 ? "" : ` ×${count}`}`,
  );
}

function toolTarget(toolCall: ToolCall): string | undefined {
  const args = toolCall.arguments;
  const path = asString(args.path);
  if (path) return basename(path);
  const file = asString(args.file);
  if (file) return basename(file);
  return undefined;
}

function uniqueTargets(toolCalls: ToolCall[]): string[] {
  return [...new Set(toolCalls.map(toolTarget).filter((value): value is string => Boolean(value)))];
}

function formatTargets(targets: string[]): string | undefined {
  if (targets.length === 0) return undefined;
  if (targets.length <= 2) return targets.join(", ");
  return plural(targets.length, "file");
}

function isCheckCommand(toolCall: ToolCall): boolean {
  if (toolCall.name !== "bash") return false;
  const command = asString(toolCall.arguments.command) ?? "";
  return /(?:^|[\s/.-])(?:test|tests|verify|check|lint|typecheck|tsc)(?:[\s/.-]|$)/i.test(
    command,
  );
}

function fallbackTitle(toolCalls: ToolCall[]): string {
  const targets = uniqueTargets(toolCalls);
  const target = formatTargets(targets);
  if (toolCalls.every((toolCall) => ["edit", "write"].includes(toolCall.name)))
    return `Updating ${target ?? plural(toolCalls.length, "file")}`;
  if (toolCalls.every((toolCall) => toolCall.name === "read"))
    return `Reading ${target ?? plural(toolCalls.length, "file")}`;
  if (toolCalls.every(isCheckCommand)) return "Running checks";
  if (toolCalls.every((toolCall) => toolCall.name === "bash"))
    return `Running ${plural(toolCalls.length, "command")}`;
  if (target) return `Working with ${target}`;
  return `Using ${groupTools(toolCalls).join(", ")}`;
}

function titleFromTextContent(content: any[]): string | undefined {
  for (const item of content) {
    if (item?.type !== "text") continue;
    const title = sanitizeTitle(asString(item.text));
    if (title) return title;
  }
  return undefined;
}

function thinkingFromContent(content: any[]): string[] {
  return content
    .filter((item) => item?.type === "thinking")
    .map((item) => sanitizeTitle(asString(item.thinking)))
    .filter((item): item is string => Boolean(item));
}

function status(step: WorkStep): "pending" | "success" | "failure" {
  if (step.failed) return "failure";
  if (
    step.toolCallIds.size === 0 ||
    step.completedToolCallIds.size === step.toolCallIds.size
  )
    return "success";
  return "pending";
}

type SummaryPart = {
  text: string;
  role: "detail" | "strong" | "success" | "warning" | "error";
};

function outcomePart(step: WorkStep, successText: string): SummaryPart {
  const currentStatus = status(step);
  if (currentStatus === "pending") return { text: "running", role: "warning" };
  if (currentStatus === "failure") return { text: "failed", role: "error" };
  return { text: successText, role: "success" };
}

function summaryParts(step: WorkStep): SummaryPart[] {
  const calls = step.toolCalls;
  const targets = formatTargets(uniqueTargets(calls));
  const parts: SummaryPart[] = [];
  const add = (part: SummaryPart) => {
    if (parts.length > 0) parts.push({ text: " · ", role: "detail" });
    parts.push(part);
  };

  if (targets) add({ text: targets, role: "detail" });

  if (calls.every((call) => call.name === "edit")) {
    const edits = calls.reduce((count, call) => {
      const value = call.arguments.edits;
      return count + (Array.isArray(value) ? value.length : 1);
    }, 0);
    add({ text: plural(edits, "edit"), role: "strong" });
    add(outcomePart(step, "updated"));
    return parts;
  }

  if (calls.every((call) => call.name === "write")) {
    add({ text: plural(calls.length, "write"), role: "strong" });
    add(outcomePart(step, "written"));
    return parts;
  }

  if (calls.every((call) => call.name === "read")) {
    add({ text: plural(calls.length, "read"), role: "strong" });
    add(outcomePart(step, "loaded"));
    return parts;
  }

  if (calls.every(isCheckCommand)) {
    add({ text: plural(calls.length, "check"), role: "strong" });
    add(outcomePart(step, "passed"));
    return parts;
  }

  if (calls.every((call) => call.name === "bash")) {
    add({ text: plural(calls.length, "command"), role: "strong" });
    add(outcomePart(step, "completed"));
    return parts;
  }

  add({ text: plural(calls.length, "call"), role: "strong" });
  add({ text: groupTools(calls).join(" · "), role: "strong" });
  add(outcomePart(step, "completed"));
  return parts;
}

function renderSummary(theme: Theme, step: WorkStep): string {
  return summaryParts(step)
    .map((part) => {
      if (part.role === "detail") return theme.fg("muted", part.text);
      const color = part.role === "strong" ? "text" : part.role;
      return theme.fg(color, theme.bold(part.text));
    })
    .join("");
}

function renderedGroups(run: ActivityRun): WorkStep[][] {
  const groups: WorkStep[][] = [];
  let singles: WorkStep[] | undefined;
  for (const group of run.groups) {
    if (group.steps.length === 1) {
      if (!singles) {
        singles = [];
        groups.push(singles);
      }
      singles.push(group.steps[0]);
    } else {
      singles = undefined;
      groups.push(group.steps);
    }
  }
  return groups;
}

function renderActivityHeader(theme: Theme, steps: WorkStep[]): string {
  const calls = steps.reduce((count, step) => count + step.toolCalls.length, 0);
  const completed = steps.filter((step) => status(step) === "success").length;
  const failed = steps.some((step) => status(step) === "failure");
  const settled = completed === steps.length;
  const state = failed
    ? theme.fg("error", theme.bold("failed"))
    : settled
      ? theme.fg("success", theme.bold("all passed"))
      : theme.fg("warning", theme.bold(`${completed}/${steps.length} complete`));
  return (
    ` ${theme.fg("borderMuted", "│")}  ` +
    theme.fg("muted", `${plural(steps.length, "step")} · ${plural(calls, "call")} · `) +
    state
  );
}

const CONNECTED_THINKING = "Thinking…";
const CONNECTED_RGB = {
  muted: "146;131;116",
  dim: "102;92;84",
  text: "235;219;178",
  warning: "250;189;47",
  success: "184;187;38",
  error: "242;89;75",
} as const;

function connectedColor(
  color: keyof typeof CONNECTED_RGB,
  text: string,
  bold = false,
): string {
  return `\x1b[${bold ? "1;" : ""}38;2;${CONNECTED_RGB[color]}m${text}\x1b[0m`;
}

function connectedParentStatus(
  step: WorkStep,
): "running" | "completed" | "failed" {
  const current = status(step);
  return current === "pending"
    ? "running"
    : current === "failure"
      ? "failed"
      : "completed";
}

function truncateConnectedLine(text: string, maxWidth: number): string {
  if (text.includes("\n") || text.includes("\r"))
    text = text.replace(/\r?\n/g, "↵ ");
  if (visibleWidth(text) <= maxWidth) return text;

  let result = "";
  let width = 0;
  for (let index = 0; index < text.length; index++) {
    if (width >= maxWidth - 1) {
      const truncated = `${result}…`;
      return truncated.includes("\x1b[") ? `${truncated}\x1b[0m` : truncated;
    }
    if (text[index] === "\x1b") {
      const ansi = text.slice(index).match(/^\x1b\[[0-9;]*m/);
      if (ansi) {
        result += ansi[0];
        index += ansi[0].length - 1;
        continue;
      }
    }
    result += text[index];
    width++;
  }
  return result;
}

function renderConnectedActivityHeader(steps: WorkStep[]): string {
  const calls = steps.reduce((count, step) => count + step.toolCalls.length, 0);
  const failed = steps.some((step) => status(step) === "failure");
  const running = steps.some((step) => status(step) === "pending");
  const state = failed
    ? connectedColor("error", "failed", true)
    : running
      ? connectedColor("warning", "running")
      : connectedColor("success", "all passed", true);
  return (
    connectedColor("muted", " │  ") +
    connectedColor(
      "muted",
      `${plural(steps.length, "step")} · ${plural(calls, "call")} · `,
    ) +
    state
  );
}

function connectedStepElapsed(
  step: WorkStep,
  bridge: ConnectedRenderBridge,
): number | undefined {
  if (!finiteNumber(step.startedAt)) return undefined;
  const end = finiteNumber(step.completedAt)
    ? step.completedAt
    : connectedParentStatus(step) === "running"
      ? bridgeNow(bridge)
      : undefined;
  return finiteNumber(end) ? Math.max(0, end - step.startedAt) : undefined;
}

function renderConnectedInitialThinking(
  bridge: ConnectedRenderBridge,
  nativeLines: string[],
): string {
  const connector = nativeLines.length > 0 ? "├─" : "└─";
  return (
    connectedColor("muted", ` ${bridge.parentRail}${connector} `) +
    connectedColor("text", CONNECTED_THINKING)
  );
}

function renderConnectedParent(
  step: WorkStep,
  bridge: ConnectedRenderBridge,
  nativeSubtrees: string[][],
  width: number,
): string[] {
  const steps = step.group.steps;
  const lines = [
    truncateConnectedLine(renderConnectedActivityHeader(steps), width),
  ];
  for (const [index, item] of steps.entries()) {
    const current = connectedParentStatus(item);
    const last = index === steps.length - 1;
    const glyph =
      current === "running"
        ? connectedColor("warning", "⟳")
        : current === "failed"
          ? connectedColor("error", "×")
          : connectedColor("success", "●");
    const title = connectedColor(
      current === "failed" ? "error" : "text",
      item.title,
      true,
    );
    const elapsed =
      item === step ? connectedStepElapsed(item, bridge) : undefined;
    const timer = finiteNumber(elapsed)
      ? connectedColor("dim", ` · ${formatElapsed(elapsed)}`)
      : "";
    lines.push(
      truncateConnectedLine(
        `${connectedColor("muted", ` ${last ? "└─" : "├─"} `)}${glyph} ${title}${timer}`,
        width,
      ),
    );
    if (item === step) {
      for (const nativeLines of nativeSubtrees) lines.push(...nativeLines);
    }
  }
  return lines;
}

function renderThinkingDraft(
  theme: Theme,
  draft: ThinkingDraft,
  width: number,
): string[] {
  const lines = [
    "",
    ` ${theme.fg("accent", "◉")} ${theme.fg("text", theme.bold(draft.title ?? "Thinking"))}`,
  ];
  for (const [index, thought] of draft.thinking.entries()) {
    const connector = index === draft.thinking.length - 1 ? "└─" : "├─";
    lines.push(
      `   ${theme.fg("borderMuted", connector)} ${theme.fg("muted", "•")} ${theme.fg("muted", thought)}`,
    );
  }
  return lines.map((line) => truncateToWidth(line, width));
}

class WorkStepRow {
  constructor(
    private readonly theme: Theme,
    private readonly step: WorkStep,
  ) {}

  render(width: number): string[] {
    const lines: string[] = [];
    const groups = renderedGroups(this.step.run);
    for (const [groupIndex, steps] of groups.entries()) {
      lines.push(renderActivityHeader(this.theme, steps));
      for (const [stepIndex, step] of steps.entries()) {
        const currentStatus = status(step);
        const resultGlyph =
          currentStatus === "pending"
            ? this.theme.fg("accent", "◉")
            : currentStatus === "failure"
              ? this.theme.fg("error", "×")
              : this.theme.fg("success", "●");
        const finalStep = stepIndex === steps.length - 1;
        const outer = this.theme.fg("borderMuted", finalStep ? "└─" : "├─");
        const rail = this.theme.fg("borderMuted", finalStep ? "   " : "│  ");
        const inner = this.theme.fg("borderMuted", "└─");
        lines.push(
          ` ${outer} ${resultGlyph} ${this.theme.fg("text", this.theme.bold(step.title))}`,
        );
        if (step.thinking.length > 0) {
          for (const [thoughtIndex, thought] of step.thinking.entries()) {
            const finalThought = thoughtIndex === step.thinking.length - 1;
            const connector =
              step.toolCalls.length === 0 && finalThought ? "└─" : "├─";
            lines.push(
              ` ${rail}${this.theme.fg("borderMuted", connector)} ${this.theme.fg("muted", "•")} ${this.theme.fg("muted", thought)}`,
            );
          }
        }
        if (step.toolCalls.length > 0)
          lines.push(` ${rail}${inner} ${resultGlyph} ${renderSummary(this.theme, step)}`);
      }
      if (groupIndex < groups.length - 1) lines.push("");
    }
    return lines.map((line) => truncateToWidth(line, width));
  }
}

function toolCallsFrom(content: any[]): ToolCall[] {
  return content
    .filter((item) => item?.type === "toolCall")
    .map((item) => ({
      id: asString(item.id),
      name: cleanToolName(item.name),
      arguments: asRecord(item.arguments),
    }))
    .filter((item): item is ToolCall => Boolean(item.id));
}

function resolveRebuiltStep(
  toolCalls: ToolCall[],
  state: RendererState,
): WorkStep | undefined {
  const toolCallIds = new Set(toolCalls.map((toolCall) => toolCall.id));
  if (toolCallIds.size === 0 || toolCallIds.size !== toolCalls.length)
    return undefined;

  let resolved: WorkStep | undefined;
  for (const toolCallId of toolCallIds) {
    const component = state.toolComponents.get(toolCallId);
    const step = component?.[WORK_STEP] as WorkStep | undefined;
    if (!step || (resolved && resolved !== step)) return undefined;
    resolved = step;
  }
  if (!resolved || resolved.toolCallIds.size !== toolCallIds.size)
    return undefined;
  for (const toolCallId of toolCallIds) {
    if (!resolved.toolCallIds.has(toolCallId)) return undefined;
  }
  return resolved;
}

function releaseStep(state: RendererState, step: WorkStep): void {
  for (const toolCallId of step.toolCallIds) {
    if (state.pending.get(toolCallId) === step)
      state.pending.delete(toolCallId);
  }
  if (state.assembling?.step === step) state.assembling = undefined;
}

function applyPersistedOutcome(
  state: RendererState,
  step: WorkStep,
  outcome: PersistedOutcome,
): void {
  for (const toolCallId of outcome.completedToolCallIds) {
    if (step.toolCallIds.has(toolCallId))
      step.completedToolCallIds.add(toolCallId);
  }
  step.failed ||= outcome.failed;
  if (status(step) !== "pending") {
    releaseStep(state, step);
    return;
  }
  for (const toolCallId of step.completedToolCallIds)
    state.pending.delete(toolCallId);
}

function updateAssistant(
  component: any,
  message: any,
  state: RendererState,
): void {
  const content = Array.isArray(message?.content) ? message.content : [];
  const toolCalls = toolCallsFrom(content);
  const explicitTitle = titleFromTextContent(content);
  const thinking = thinkingFromContent(content);
  const hasThinking = content.some((item) => item?.type === "thinking");

  if (toolCalls.length === 0) {
    state.assembling = undefined;
    const settled =
      ["error", "aborted", "length"].includes(message?.stopReason) ||
      (message?.stopReason === "stop" &&
        Number(message?.usage?.totalTokens ?? 0) > 0);
    if (!settled) {
      component[THINKING_DRAFT] = hasThinking
        ? ({ title: explicitTitle, thinking } satisfies ThinkingDraft)
        : undefined;
      return;
    }

    const draft = component[THINKING_DRAFT] as ThinkingDraft | undefined;
    const stepThinking = thinking.length > 0 ? thinking : (draft?.thinking ?? []);
    if (stepThinking.length > 0) {
      const existing = component[WORK_STEP] as WorkStep | undefined;
      const run = existing?.run ?? state.currentRun ?? { steps: [], groups: [] };
      const group =
        existing?.group ??
        state.currentGroup ??
        ({ steps: [], run } satisfies ActivityGroup);
      const step =
        existing ??
        ({
          title: "Preparing response",
          titleLocked: true,
          thinking: stepThinking,
          thinkingVisible: !component.hideThinkingBlock,
          toolCalls: [],
          toolCallIds: new Set<string>(),
          completedToolCallIds: new Set<string>(),
          failed: ["error", "aborted", "length"].includes(message?.stopReason),
          run,
          group,
        } satisfies WorkStep);
      if (!existing) {
        if (!state.currentRun) state.currentRun = run;
        if (!state.currentGroup) {
          run.groups.push(group);
          state.currentGroup = group;
        }
        run.steps.push(step);
        group.steps.push(step);
      }
      step.thinking = stepThinking;
      step.thinkingVisible = !component.hideThinkingBlock;
      component[WORK_STEP] = step;
    }
    component[THINKING_DRAFT] = undefined;
    state.currentGroup = undefined;
    state.currentRun = undefined;
    return;
  }

  const draft = component[THINKING_DRAFT] as ThinkingDraft | undefined;
  const stepThinking = thinking.length > 0 ? thinking : (draft?.thinking ?? []);
  const stepExplicitTitle = explicitTitle ?? draft?.title;
  const title =
    stepThinking.length > 0
      ? stepExplicitTitle ?? "Thinking"
      : stepExplicitTitle ?? fallbackTitle(toolCalls);
  const existing =
    (component[WORK_STEP] as WorkStep | undefined) ??
    resolveRebuiltStep(toolCalls, state);
  const run = existing?.run ?? state.currentRun ?? { steps: [], groups: [] };
  const group =
    existing?.group ??
    state.currentGroup ??
    ({
      steps: [],
      run,
    } satisfies ActivityGroup);
  const step: WorkStep =
    existing ??
    ({
      title,
      titleLocked: Boolean(stepExplicitTitle),
      thinking: stepThinking,
      thinkingVisible: !component.hideThinkingBlock,
      toolCalls: [],
      toolCallIds: new Set<string>(),
      completedToolCallIds: new Set<string>(),
      failed: false,
      run,
      group,
    } satisfies WorkStep);

  if (!existing) {
    state.currentRun = run;
    if (!state.currentGroup) {
      run.groups.push(group);
      state.currentGroup = group;
    }
    run.steps.push(step);
    group.steps.push(step);
  }

  for (const toolCall of toolCalls) {
    const previous = step.toolCalls.find((call) => call.id === toolCall.id);
    if (previous) {
      toolCall.startedAt = previous.startedAt;
      toolCall.completedAt = previous.completedAt;
    }
  }
  step.toolCalls = toolCalls;
  step.toolCallIds = new Set(toolCalls.map((toolCall) => toolCall.id));
  if (!step.titleLocked) {
    step.title = title;
    step.titleLocked = Boolean(stepExplicitTitle);
  }
  step.thinking = stepThinking;
  step.thinkingVisible = !component.hideThinkingBlock;
  if (message.stopReason === "error" || message.stopReason === "aborted")
    step.failed = true;

  component[WORK_STEP] = step;
  component[THINKING_DRAFT] = undefined;
  for (const toolCallId of step.toolCallIds) {
    if (!step.completedToolCallIds.has(toolCallId) && !step.failed)
      state.pending.set(toolCallId, step);
  }

  const persisted = state.persisted.get(message);
  if (persisted) applyPersistedOutcome(state, step, persisted);
  if (step.failed) releaseStep(state, step);

  state.assembling = {
    step,
    remaining: new Set(step.toolCallIds),
  };
}

function sameToolArgumentValue(
  left: unknown,
  right: unknown,
  leftAncestors = new Set<object>(),
  rightAncestors = new Set<object>(),
): boolean {
  if (left === null || right === null) return left === right;
  if (typeof left !== "object" || typeof right !== "object") {
    if (typeof left === "number" || typeof right === "number")
      return finiteNumber(left) && finiteNumber(right) && left === right;
    return (
      ["string", "boolean"].includes(typeof left) &&
      typeof left === typeof right &&
      left === right
    );
  }

  if (leftAncestors.has(left) || rightAncestors.has(right)) return false;
  const leftArray = Array.isArray(left);
  if (leftArray !== Array.isArray(right)) return false;
  if (
    !leftArray &&
    (![Object.prototype, null].includes(Object.getPrototypeOf(left)) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(right)))
  )
    return false;

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  const expectedOwnKeyOffset = leftArray ? 1 : 0;
  if (
    Reflect.ownKeys(left).length !== leftKeys.length + expectedOwnKeyOffset ||
    Reflect.ownKeys(right).length !== rightKeys.length + expectedOwnKeyOffset ||
    (leftArray &&
      (left as unknown[]).length !== (right as unknown[]).length) ||
    leftKeys.length !== rightKeys.length ||
    leftKeys.some((key) => !Object.prototype.hasOwnProperty.call(right, key))
  )
    return false;

  leftAncestors.add(left);
  rightAncestors.add(right);
  try {
    return leftKeys.every((key) =>
      sameToolArgumentValue(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
        leftAncestors,
        rightAncestors,
      ),
    );
  } finally {
    leftAncestors.delete(left);
    rightAncestors.delete(right);
  }
}

function transferLivePartialObservation(
  previous: any,
  replacement: any,
  step: WorkStep,
  toolCallId: string,
): void {
  if (
    asString(previous.toolCallId) !== toolCallId ||
    previous.result == null ||
    previous.isPartial !== true ||
    replacement.result !== undefined ||
    replacement.resultRendererComponent !== undefined
  )
    return;

  const matchingCalls = step.toolCalls.filter((call) => call.id === toolCallId);
  if (matchingCalls.length !== 1) return;
  try {
    if (
      !sameToolArgumentValue(previous.args, replacement.args) ||
      !sameToolArgumentValue(replacement.args, matchingCalls[0].arguments)
    )
      return;
  } catch {
    return;
  }

  // The replacement's following native updateDisplay rebuilds renderer components.
  replacement.result = previous.result;
  replacement.isPartial = previous.isPartial;
  replacement.executionStarted = previous.executionStarted;
  replacement.argsComplete = previous.argsComplete;
}

function transferToolComponentOwnership(
  component: any,
  step: WorkStep,
  state: RendererState,
): boolean {
  const toolCallId = asString(component.toolCallId);
  if (!toolCallId) return false;
  const previous = state.toolComponents.get(toolCallId);
  if (!previous || previous === component) return true;
  if (previous[WORK_STEP] !== step) return false;

  const connected = state.connected.get(previous);
  if (
    previous.toolName !== "subagent" ||
    component.toolName !== "subagent" ||
    !connected
  )
    return false;

  transferLivePartialObservation(previous, component, step, toolCallId);
  state.connected.delete(previous);
  connected.expandedInitialized = false;
  state.connected.set(component, connected);
  const rendererState = (component.rendererState ??= {}) as Record<
    PropertyKey,
    unknown
  >;
  rendererState[SUBAGENT_BRIDGE] = connected.bridge;
  const previousRendererState = previous.rendererState as
    | Record<PropertyKey, unknown>
    | undefined;
  if (previousRendererState?.[SUBAGENT_BRIDGE] === connected.bridge) {
    previousRendererState[SUBAGENT_BRIDGE] = {
      ...connected.bridge,
      invalidate: undefined,
    } satisfies ConnectedRenderBridge;
  }
  connected.bridge.invalidate = () =>
    state.scheduler.arm(component, connected.bridge);
  state.scheduler.transfer(previous, component, connected.bridge);
  state.toolComponents.set(toolCallId, component);
  return true;
}

function bindToolComponent(
  component: any,
  state: RendererState,
): WorkStep | undefined {
  const toolCallId = asString(component.toolCallId);
  if (!toolCallId) return undefined;

  const assembly = state.assembling;
  const existing = component[WORK_STEP] as WorkStep | undefined;
  if (existing) {
    const owner = state.toolComponents.get(toolCallId);
    if (owner && owner !== component) return undefined;
    if (assembly?.step === existing) {
      assembly.remaining.delete(toolCallId);
      if (assembly.remaining.size === 0) state.assembling = undefined;
    }
    return existing;
  }

  const step = assembly?.step.toolCallIds.has(toolCallId)
    ? assembly.step
    : state.pending.get(toolCallId) ??
      (state.toolComponents.get(toolCallId)?.[WORK_STEP] as WorkStep | undefined);
  if (!step || !transferToolComponentOwnership(component, step, state))
    return undefined;

  component[WORK_STEP] = step;
  if (assembly?.step === step) {
    assembly.remaining.delete(toolCallId);
    if (assembly.remaining.size === 0) state.assembling = undefined;
  }
  return step;
}

function rootProgress(component: any): Record<string, unknown> | undefined {
  const result = component.result?.details?.results?.[0];
  return result && typeof result === "object"
    ? asRecord((result as Record<string, unknown>).progress)
    : undefined;
}

function rootFailed(component: any, progress: Record<string, unknown>): boolean {
  const result = component.result?.details?.results?.[0];
  return (
    component.result?.isError === true ||
    progress.status === "failed" ||
    (finiteNumber(result?.exitCode) && result.exitCode !== 0) ||
    Boolean(progress.error)
  );
}

function synchronizeConnectedObservation(
  component: any,
  step: WorkStep,
  state: RendererState,
  bridge?: ConnectedRenderBridge,
): void {
  const toolCallId = asString(component.toolCallId);
  const toolCall = step.toolCalls.find((call) => call.id === toolCallId);
  if (!toolCall) return;

  const progress = rootProgress(component);
  const observedStartedAt = progress?.startedAt;
  if (finiteNumber(observedStartedAt)) {
    toolCall.startedAt = observedStartedAt;
    const starts = step.toolCalls
      .map((call) => call.startedAt)
      .filter(finiteNumber);
    step.startedAt =
      starts.length > 0 ? Math.min(...starts) : observedStartedAt;
  } else if (progress?.status === "pending") {
    toolCall.startedAt = undefined;
    const starts = step.toolCalls
      .map((call) => call.startedAt)
      .filter(finiteNumber);
    step.startedAt = starts.length > 0 ? Math.min(...starts) : undefined;
  } else if (
    component.executionStarted &&
    !finiteNumber(toolCall.startedAt) &&
    !state.restoredToolCallIds.has(toolCall.id)
  ) {
    const startedAt = bridgeNow(bridge);
    toolCall.startedAt = startedAt;
    if (!finiteNumber(step.startedAt) || startedAt < step.startedAt)
      step.startedAt = startedAt;
  }

  const observedCompletedAt = progress?.completedAt;
  if (finiteNumber(observedCompletedAt))
    toolCall.completedAt ??= observedCompletedAt;

  if (progress?.status === "pending" || progress?.status === "running") {
    toolCall.completedAt = undefined;
    step.completedAt = undefined;
    step.completedToolCallIds.delete(toolCall.id);
    state.pending.set(toolCall.id, step);
    return;
  }

  if (!component.result || component.isPartial) return;
  toolCall.completedAt ??= state.restoredToolCallIds.has(toolCall.id)
    ? undefined
    : bridgeNow(bridge);
  step.completedToolCallIds.add(toolCall.id);
  step.failed ||= rootFailed(component, progress ?? {});
  state.pending.delete(toolCall.id);
  if (status(step) !== "pending") {
    if (finiteNumber(toolCall.completedAt))
      step.completedAt ??= toolCall.completedAt;
    releaseStep(state, step);
  }
}

function ensureConnectedBridge(
  component: any,
  step: WorkStep,
  state: RendererState,
): ConnectedRenderBridge | undefined {
  if (component.toolName !== "subagent") return undefined;
  const rendererState = (component.rendererState ??= {}) as Record<PropertyKey, unknown>;
  let connected = state.connected.get(component);
  if (!connected) {
    const published = rendererState[SUBAGENT_BRIDGE] as
      | ConnectedRenderBridge
      | undefined;
    const bridge: ConnectedRenderBridge =
      published?.layout === "connected"
        ? published
        : {
            layout: "connected",
            outputMode: "auto",
            thinkingVisible: true,
            parentRail: "   ",
            parentConnector: "└─",
            lifecycle: {
              status: "pending",
              thinking: [],
            },
          };
    if (typeof bridge.clock !== "function")
      bridge.clock = resolveConnectedClock();
    connected = {
      bridge,
      expandedInitialized: false,
      collapsedSource:
        bridge.outputMode === "hidden" ? "hidden" : "auto",
    };
    state.connected.set(component, connected);
    rendererState[SUBAGENT_BRIDGE] = bridge;
    bridge.invalidate = () => state.scheduler.arm(component, bridge);
  }

  const bridge = connected.bridge;
  synchronizeConnectedObservation(component, step, state, bridge);
  const toolCall = step.toolCalls.find(
    (call) => call.id === asString(component.toolCallId),
  );
  const progress = rootProgress(component);
  const observedStatus = progress?.status;
  const failed =
    observedStatus === "failed" ||
    Boolean(progress?.error) ||
    (component.result != null &&
      component.isPartial !== true &&
      rootFailed(component, progress ?? {}));
  bridge.lifecycle.status = failed
    ? "failed"
    : observedStatus === "pending" || observedStatus === "running"
      ? observedStatus
      : component.result != null && component.isPartial !== true
        ? "completed"
        : observedStatus === "completed" ||
            (toolCall && step.completedToolCallIds.has(toolCall.id))
          ? "completed"
          : component.executionStarted
            ? "running"
            : "pending";
  bridge.lifecycle.startedAt = toolCall?.startedAt;
  bridge.lifecycle.completedAt = toolCall?.completedAt;
  bridge.lifecycle.thinking = step.thinking;
  bridge.thinkingVisible = step.thinkingVisible;
  const last = step.group.steps.at(-1) === step;
  bridge.parentRail = last ? "   " : "│  ";
  const connectedCalls = step.toolCalls.filter(
    (call) => call.name === "subagent",
  );
  bridge.parentConnector =
    connectedCalls.at(-1)?.id === component.toolCallId ? "└─" : "├─";
  state.toolComponents.set(component.toolCallId, component);
  if (bridge.lifecycle.status !== "running") state.scheduler.remove(component);
  return bridge;
}

function toggleConnectedOutput(component: any, state: RendererState): void {
  const step = bindToolComponent(component, state);
  if (!step) return;
  const bridge = ensureConnectedBridge(component, step, state);
  const connected = state.connected.get(component);
  if (!bridge || !connected) return;
  if (!connected.expandedInitialized) {
    connected.expandedInitialized = true;
    return;
  }

  if (
    bridge.lifecycle.status === "pending" ||
    bridge.lifecycle.status === "running"
  ) {
    if (bridge.outputMode === "hidden") {
      bridge.outputMode = connected.collapsedSource;
    } else {
      connected.collapsedSource = bridge.outputMode;
      bridge.outputMode = "hidden";
    }
    return;
  }

  if (bridge.outputMode === "expanded") {
    bridge.outputMode = connected.collapsedSource;
  } else {
    connected.collapsedSource = bridge.outputMode;
    bridge.outputMode = "expanded";
  }
}

function renderToolComponent(
  component: any,
  width: number,
  state: RendererState,
  theme: Theme,
): string[] {
  const step = bindToolComponent(component, state);
  if (!step) return [];

  const owner = step.run.steps[0];
  if (step !== owner) return [];
  const toolCallId = asString(component.toolCallId);
  if (toolCallId !== owner.toolCallIds.values().next().value) return [];
  const toolOwner = toolCallId
    ? state.toolComponents.get(toolCallId)
    : undefined;
  if (toolOwner && toolOwner !== component) return [];

  const connectedComponents: Array<{
    component: any;
    bridge: ConnectedRenderBridge;
  }> = [];
  for (const call of step.toolCalls) {
    const candidate = state.toolComponents.get(call.id);
    if (candidate?.toolName !== "subagent" || candidate[WORK_STEP] !== step)
      continue;
    const candidateBridge = ensureConnectedBridge(candidate, step, state);
    if (candidateBridge) {
      const renderer = candidate.resultRendererComponent;
      if (
        typeof renderer?.render === "function" ||
        candidateBridge.lifecycle.status === "running"
      )
        connectedComponents.push({
          component: candidate,
          bridge: candidateBridge,
        });
    }
  }

  if (connectedComponents.length > 0) {
    const nativeSubtrees = connectedComponents.map(
      ({ component: candidate, bridge: candidateBridge }, index) => {
        candidateBridge.parentConnector =
          index === connectedComponents.length - 1 ? "└─" : "├─";
        const renderer = candidate.resultRendererComponent;
        const native =
          typeof renderer?.render === "function" ? renderer.render(width) : [];
        const progress = rootProgress(candidate);
        const hasChildProgress =
          Array.isArray(progress?.recentTools) &&
          progress.recentTools.length > 0;
        const needsInitialThinking =
          candidateBridge.thinkingVisible &&
          candidateBridge.lifecycle.status === "running" &&
          !hasChildProgress &&
          !native.some((line: string) => line.includes(CONNECTED_THINKING));
        return needsInitialThinking
          ? [
              truncateConnectedLine(
                renderConnectedInitialThinking(candidateBridge, native),
                width,
              ),
              ...native,
            ]
          : native;
      },
    );
    return renderConnectedParent(
      step,
      connectedComponents[0].bridge,
      nativeSubtrees,
      width,
    );
  }

  let row = component[WORK_STEP_ROW] as WorkStepRow | undefined;
  if (!row) {
    row = new WorkStepRow(theme, step);
    component[WORK_STEP_ROW] = row;
    step.row = row;
  }
  return row.render(width);
}

function disposeState(state: RendererState): void {
  state.scheduler.clear();
  const steps = new Set(state.pending.values());
  if (state.assembling) steps.add(state.assembling.step);
  for (const step of steps) step.row = undefined;
  state.pending.clear();
  state.persisted = new WeakMap();
  state.assembling = undefined;
  state.currentGroup = undefined;
  state.currentRun = undefined;
  state.sessionId = undefined;
  state.restoredToolCallIds.clear();
  state.toolComponents.clear();
  state.connected = new WeakMap();
}

function failPendingSteps(state: RendererState): void {
  const steps = new Set(state.pending.values());
  if (state.assembling) steps.add(state.assembling.step);
  for (const step of steps) {
    const hasBackgroundSubagent = step.toolCalls.some((toolCall) => {
      if (toolCall.name !== "subagent") return false;
      const progress = rootProgress(state.toolComponents.get(toolCall.id));
      return progress?.status === "pending" || progress?.status === "running";
    });
    if (hasBackgroundSubagent) continue;
    step.failed = true;
    for (const toolCall of step.toolCalls) {
      const component = state.toolComponents.get(toolCall.id);
      const bridge = component
        ? state.connected.get(component)?.bridge
        : undefined;
      if (!state.restoredToolCallIds.has(toolCall.id)) {
        toolCall.completedAt ??= bridgeNow(bridge);
        step.completedAt ??= toolCall.completedAt;
      }
      if (component) state.scheduler.remove(component);
    }
    releaseStep(state, step);
  }
  state.pending.clear();
  state.assembling = undefined;
  state.currentGroup = undefined;
  state.currentRun = undefined;
}

function scanPersistedSession(state: RendererState, entries: any[]): void {
  state.persisted = new WeakMap();
  state.restoredToolCallIds.clear();
  const messages = entries
    .filter((entry) => entry?.type === "message")
    .map((entry) => entry.message);
  const results = new Map<string, boolean>();

  for (const message of messages) {
    if (message?.role !== "toolResult") continue;
    const toolCallId = asString(message.toolCallId);
    if (toolCallId) results.set(toolCallId, Boolean(message.isError));
  }

  const reconciledSteps = new Set<WorkStep>();
  for (const message of messages) {
    if (message?.role !== "assistant") continue;
    const content = Array.isArray(message.content) ? message.content : [];
    const toolCalls = toolCallsFrom(content);
    if (toolCalls.length === 0) continue;
    for (const toolCall of toolCalls)
      state.restoredToolCallIds.add(toolCall.id);

    const completedToolCallIds = new Set<string>();
    let failed =
      message.stopReason === "error" || message.stopReason === "aborted";
    for (const toolCall of toolCalls) {
      if (results.has(toolCall.id)) {
        completedToolCallIds.add(toolCall.id);
        failed ||= results.get(toolCall.id) === true;
      } else if (message.stopReason) {
        failed = true;
      }
    }

    const outcome = { completedToolCallIds, failed };
    state.persisted.set(message, outcome);
    for (const toolCall of toolCalls) {
      const step = state.pending.get(toolCall.id);
      if (step) reconciledSteps.add(step);
    }
    for (const step of reconciledSteps)
      applyPersistedOutcome(state, step, outcome);
    reconciledSteps.clear();
  }
}

async function loadPiInternals(): Promise<{
  AssistantMessageComponent: any;
  ToolExecutionComponent: any;
  theme: Theme;
}> {
  const cliPath = realpathSync(process.argv[1] ?? "");
  const interactivePath = join(dirname(cliPath), "modes/interactive");
  const [assistantModule, toolModule, themeModule] = await Promise.all([
    import(
      pathToFileURL(join(interactivePath, "components/assistant-message.js"))
        .href
    ),
    import(
      pathToFileURL(join(interactivePath, "components/tool-execution.js")).href
    ),
    import(pathToFileURL(join(interactivePath, "theme/theme.js")).href),
  ]);
  return {
    AssistantMessageComponent: assistantModule.AssistantMessageComponent,
    ToolExecutionComponent: toolModule.ToolExecutionComponent,
    theme: themeModule.theme as Theme,
  };
}

function patchComponents(
  AssistantMessageComponent: any,
  ToolExecutionComponent: any,
  controller: RendererController,
): void {
  const assistantProto = AssistantMessageComponent.prototype as any;
  assistantProto[CONTROLLER] = controller;
  if (!assistantProto[ASSISTANT_PATCHED]) {
    assistantProto[ASSISTANT_PATCHED] = true;
    const updateContent = assistantProto.updateContent;
    assistantProto.updateContent = function (message: any) {
      const nativeMessage =
        assistantProto[CONTROLLER]?.assistantNativeMessage?.(message) ?? message;
      updateContent.call(this, nativeMessage);
      this.lastMessage = message;
      if (!this[ASSISTANT_INVALIDATING])
        assistantProto[CONTROLLER]?.assistantUpdated(this, message);
    };
    const setHideThinkingBlock = assistantProto.setHideThinkingBlock;
    assistantProto.setHideThinkingBlock = function (hidden: boolean) {
      this[ASSISTANT_INVALIDATING] = true;
      try {
        setHideThinkingBlock.call(this, hidden);
      } finally {
        this[ASSISTANT_INVALIDATING] = false;
      }
      assistantProto[CONTROLLER]?.assistantThinkingChanged(this, hidden);
    };
    const invalidate = assistantProto.invalidate;
    assistantProto.invalidate = function () {
      this[ASSISTANT_INVALIDATING] = true;
      try {
        return invalidate.call(this);
      } finally {
        this[ASSISTANT_INVALIDATING] = false;
      }
    };
    const render = assistantProto.render;
    assistantProto.render = function (width: number) {
      if (assistantProto[CONTROLLER]?.assistantHasStep(this)) return [];
      const lines = render.call(this, width);
      return (
        assistantProto[CONTROLLER]?.renderAssistant(this, lines, width) ?? lines
      );
    };
  }

  const toolProto = ToolExecutionComponent.prototype as any;
  toolProto[CONTROLLER] = controller;
  if (!toolProto[TOOL_PATCHED]) {
    toolProto[TOOL_PATCHED] = true;
    const updateDisplay = toolProto.updateDisplay;
    toolProto.updateDisplay = function () {
      toolProto[CONTROLLER]?.toolUpdated(this);
      return updateDisplay.call(this);
    };
    const setExpanded = toolProto.setExpanded;
    toolProto.setExpanded = function (expanded: boolean) {
      toolProto[CONTROLLER]?.toolExpanded(this);
      return setExpanded.call(this, expanded);
    };
    const render = toolProto.render;
    toolProto.render = function (width: number) {
      const activity = toolProto[CONTROLLER]?.renderTool(this, width) ?? [];
      if (this.toolName !== "subagent") return activity;
      const connected = this.rendererState?.[SUBAGENT_BRIDGE];
      return connected?.layout === "connected"
        ? activity
        : [...activity, ...render.call(this, width)];
    };
  }
}

export default async function (pi: ExtensionAPI) {
  const { AssistantMessageComponent, ToolExecutionComponent, theme } =
    await loadPiInternals();
  const state: RendererState = {
    pending: new Map(),
    persisted: new WeakMap(),
    restoredToolCallIds: new Set(),
    toolComponents: new Map(),
    connected: new WeakMap(),
    scheduler: new ClockInvalidationScheduler(),
  };
  const controller: RendererController = {
    assistantNativeMessage(message) {
      if (!Array.isArray(message?.content)) return message;
      return {
        ...message,
        content: message.content.filter((item: any) => item?.type !== "thinking"),
      };
    },
    assistantUpdated(component, message) {
      updateAssistant(component, message, state);
    },
    assistantThinkingChanged(component, hidden) {
      const step = component[WORK_STEP] as WorkStep | undefined;
      if (step) step.thinkingVisible = !hidden;
    },
    assistantHasStep(component) {
      const step = component[WORK_STEP] as WorkStep | undefined;
      return Boolean(step && step.toolCalls.length > 0);
    },
    renderAssistant(component, lines, width) {
      const draft = component[THINKING_DRAFT] as ThinkingDraft | undefined;
      if (draft) return renderThinkingDraft(theme, draft, width);

      const step = component[WORK_STEP] as WorkStep | undefined;
      if (!step || step.run.steps.some((item) => item.toolCalls.length > 0))
        return lines;
      let row = component[WORK_STEP_ROW] as WorkStepRow | undefined;
      if (!row) {
        row = new WorkStepRow(theme, step);
        component[WORK_STEP_ROW] = row;
      }
      const activity = row.render(width);
      return lines.length > 0 ? [...activity, "", ...lines] : activity;
    },
    toolUpdated(component) {
      const step = bindToolComponent(component, state);
      if (step) ensureConnectedBridge(component, step, state);
    },
    toolExpanded(component) {
      toggleConnectedOutput(component, state);
    },
    renderTool(component, width) {
      return renderToolComponent(component, width, state, theme);
    },
  };
  patchComponents(
    AssistantMessageComponent,
    ToolExecutionComponent,
    controller,
  );

  pi.on("session_start", (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    if (state.sessionId && state.sessionId !== sessionId) disposeState(state);
    state.sessionId = sessionId;
    scanPersistedSession(state, ctx.sessionManager.getEntries());
  });

  pi.on("agent_start", () => {
    state.assembling = undefined;
    state.currentGroup = undefined;
    state.currentRun = undefined;
  });

  pi.events.on(BACKGROUND_UPDATE_EVENT, (data: unknown) => {
    const update = asRecord(data);
    const toolCallId = asString(update.toolCallId);
    const result = update.result;
    const done = update.done === true;
    if (!toolCallId || !result || typeof result !== "object") return;
    const component = state.toolComponents.get(toolCallId);
    if (!component) return;
    const progress = asRecord((result as any).progress);
    const output = asString((result as any).output);
    component.updateResult?.(
      {
        content: [
          {
            type: "text",
            text: output || (done ? "(no output)" : "(running...)"),
          },
        ],
        details: { results: [result] },
        isError:
          done &&
          rootFailed(
            { result: { details: { results: [result] } } },
            progress,
          ),
      },
      !done,
    );
    const step = component[WORK_STEP] as WorkStep | undefined;
    if (!step) return;
    ensureConnectedBridge(component, step, state);
    component.invalidate?.();
    component.ui?.requestRender?.();
  });

  pi.on("tool_execution_end", (event) => {
    const component = state.toolComponents.get(event.toolCallId);
    const step =
      state.pending.get(event.toolCallId) ??
      (component?.[WORK_STEP] as WorkStep | undefined);
    if (!step) return;

    const toolCall = step.toolCalls.find((call) => call.id === event.toolCallId);
    const bridge = component
      ? state.connected.get(component)?.bridge
      : undefined;
    const progress = component ? rootProgress(component) : undefined;
    if (progress?.status === "pending" || progress?.status === "running") {
      step.completedToolCallIds.delete(event.toolCallId);
      state.pending.set(event.toolCallId, step);
      if (component) ensureConnectedBridge(component, step, state);
      return;
    }
    if (toolCall && !state.restoredToolCallIds.has(toolCall.id))
      toolCall.completedAt ??= bridgeNow(bridge);
    step.completedToolCallIds.add(event.toolCallId);
    step.failed ||= event.isError;
    state.pending.delete(event.toolCallId);
    if (status(step) !== "pending") {
      if (finiteNumber(toolCall?.completedAt))
        step.completedAt ??= toolCall.completedAt;
      releaseStep(state, step);
    }
    if (component) {
      ensureConnectedBridge(component, step, state);
      state.scheduler.remove(component);
    }
  });

  pi.on("agent_end", () => {
    failPendingSteps(state);
  });

  pi.on("session_shutdown", () => {
    disposeState(state);
  });
}
