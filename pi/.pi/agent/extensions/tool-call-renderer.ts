import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { truncateToWidth } from "@earendil-works/pi-tui";

const ASSISTANT_PATCHED = Symbol.for("aviral.pi.work-step-renderer.assistant");
const TOOL_PATCHED = Symbol.for("aviral.pi.work-step-renderer.tool");
const CONTROLLER = Symbol.for("aviral.pi.work-step-renderer.controller");
const WORK_STEP = Symbol.for("aviral.pi.work-step-renderer.step");
const WORK_STEP_ROW = Symbol.for("aviral.pi.work-step-renderer.row");
const THINKING_DRAFT = Symbol.for("aviral.pi.work-step-renderer.thinking-draft");
const ASSISTANT_INVALIDATING = Symbol.for(
  "aviral.pi.work-step-renderer.assistant-invalidating",
);

type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
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
  toolCalls: ToolCall[];
  toolCallIds: Set<string>;
  completedToolCallIds: Set<string>;
  failed: boolean;
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
};

type RendererController = {
  assistantNativeMessage(message: any): any;
  assistantUpdated(component: any, message: any): void;
  assistantHasStep(component: any): boolean;
  renderAssistant(component: any, lines: string[], width: number): string[];
  toolUpdated(component: any): void;
  renderTool(component: any, width: number): string[];
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
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
  const existing = component[WORK_STEP] as WorkStep | undefined;
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

  step.toolCalls = toolCalls;
  step.toolCallIds = new Set(toolCalls.map((toolCall) => toolCall.id));
  if (!step.titleLocked) {
    step.title = title;
    step.titleLocked = Boolean(stepExplicitTitle);
  }
  step.thinking = stepThinking;
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

function bindToolComponent(
  component: any,
  state: RendererState,
): WorkStep | undefined {
  const toolCallId = asString(component.toolCallId);
  if (!toolCallId) return undefined;

  const assembly = state.assembling;
  const existing = component[WORK_STEP] as WorkStep | undefined;
  if (existing) {
    if (assembly?.step === existing) {
      assembly.remaining.delete(toolCallId);
      if (assembly.remaining.size === 0) state.assembling = undefined;
    }
    return existing;
  }

  const step = assembly?.step.toolCallIds.has(toolCallId)
    ? assembly.step
    : state.pending.get(toolCallId);
  if (!step) return undefined;

  component[WORK_STEP] = step;
  if (assembly?.step === step) {
    assembly.remaining.delete(toolCallId);
    if (assembly.remaining.size === 0) state.assembling = undefined;
  }
  return step;
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

  let row = component[WORK_STEP_ROW] as WorkStepRow | undefined;
  if (!row) {
    row = new WorkStepRow(theme, step);
    component[WORK_STEP_ROW] = row;
    step.row = row;
  }
  return row.render(width);
}

function disposeState(state: RendererState): void {
  const steps = new Set(state.pending.values());
  if (state.assembling) steps.add(state.assembling.step);
  for (const step of steps) step.row = undefined;
  state.pending.clear();
  state.persisted = new WeakMap();
  state.assembling = undefined;
  state.currentGroup = undefined;
  state.currentRun = undefined;
  state.sessionId = undefined;
}

function failPendingSteps(state: RendererState): void {
  const steps = new Set(state.pending.values());
  if (state.assembling) steps.add(state.assembling.step);
  for (const step of steps) {
    step.failed = true;
    releaseStep(state, step);
  }
  state.pending.clear();
  state.assembling = undefined;
  state.currentGroup = undefined;
  state.currentRun = undefined;
}

function scanPersistedSession(state: RendererState, entries: any[]): void {
  state.persisted = new WeakMap();
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
    toolProto.render = function (width: number) {
      return toolProto[CONTROLLER]?.renderTool(this, width) ?? [];
    };
  }
}

export default async function (pi: ExtensionAPI) {
  const { AssistantMessageComponent, ToolExecutionComponent, theme } =
    await loadPiInternals();
  const state: RendererState = {
    pending: new Map(),
    persisted: new WeakMap(),
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
      bindToolComponent(component, state);
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

  pi.on("tool_execution_end", (event) => {
    const step = state.pending.get(event.toolCallId);
    if (!step) return;

    step.completedToolCallIds.add(event.toolCallId);
    step.failed ||= event.isError;
    state.pending.delete(event.toolCallId);
    if (status(step) !== "pending") releaseStep(state, step);
  });

  pi.on("agent_end", () => {
    failPendingSteps(state);
  });

  pi.on("session_shutdown", () => {
    disposeState(state);
  });
}
