import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Loader, truncateToWidth, type TUI } from "@earendil-works/pi-tui";

const ASSISTANT_PATCHED = Symbol.for("aviral.pi.work-step-renderer.assistant");
const TOOL_PATCHED = Symbol.for("aviral.pi.work-step-renderer.tool");
const CONTROLLER = Symbol.for("aviral.pi.work-step-renderer.controller");
const WORK_STEP = Symbol.for("aviral.pi.work-step-renderer.step");
const WORK_STEP_ROW = Symbol.for("aviral.pi.work-step-renderer.row");

type ToolCall = {
  id: string;
  name: string;
};

type PersistedOutcome = {
  completedToolCallIds: Set<string>;
  failed: boolean;
};

type WorkStep = {
  title: string;
  titleLocked: boolean;
  toolNames: string[];
  toolCallIds: Set<string>;
  completedToolCallIds: Set<string>;
  failed: boolean;
  row?: WorkStepRow;
};

type RendererState = {
  pending: Map<string, WorkStep>;
  persisted: WeakMap<object, PersistedOutcome>;
  assembling?: {
    step: WorkStep;
    remaining: Set<string>;
  };
  sessionId?: string;
};

type RendererController = {
  assistantUpdated(component: any, message: any): void;
  assistantHasStep(component: any): boolean;
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

function groupTools(toolNames: string[]): string[] {
  const counts = new Map<string, number>();
  for (const name of toolNames) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(
    ([name, count]) => `${name}${count === 1 ? "" : ` ×${count}`}`,
  );
}

function summarizeTools(toolNames: string[]): string {
  const counts = new Map<string, number>();
  for (const name of toolNames) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [
    plural(toolNames.length, "call"),
    ...[...counts.entries()].map(([name, count]) => `${name} ×${count}`),
  ].join(" · ");
}

function titleFromContent(
  content: any[],
  toolNames: string[],
): { title: string; synthesized: boolean } {
  const thinking = content
    .filter((item) => item?.type === "thinking")
    .map((item) => asString(item.thinking))
    .filter((value): value is string => Boolean(value));

  for (const block of thinking) {
    for (const line of block.split("\n")) {
      const heading = line.match(
        /^\s*(?:#{1,6}\s*)?\*\*([^*\n]+)\*\*:?\s*$/,
      )?.[1];
      const title = sanitizeTitle(heading);
      if (title) return { title, synthesized: false };
    }
  }

  for (const block of thinking) {
    const title = sanitizeTitle(block);
    if (title) return { title, synthesized: false };
  }

  for (const item of content) {
    if (item?.type !== "text") continue;
    const title = sanitizeTitle(asString(item.text));
    if (title) return { title, synthesized: false };
  }

  return {
    title: `Using ${groupTools(toolNames).join(", ")}`,
    synthesized: true,
  };
}

function status(step: WorkStep): "pending" | "success" | "failure" {
  if (step.failed) return "failure";
  if (
    step.toolCallIds.size > 0 &&
    step.completedToolCallIds.size === step.toolCallIds.size
  )
    return "success";
  return "pending";
}

class WorkStepRow {
  private loader?: Loader;
  private loaderTitle?: string;

  constructor(
    private readonly ui: TUI,
    private readonly theme: Theme,
    private readonly step: WorkStep,
  ) {
    this.sync();
  }

  sync(): void {
    if (status(this.step) === "pending") {
      if (this.loader) {
        if (this.loaderTitle !== this.step.title)
          this.loader.setMessage(this.step.title);
      } else {
        const foreground = (text: string) => this.theme.fg("text", text);
        this.loader = new Loader(
          this.ui,
          foreground,
          foreground,
          this.step.title,
        );
      }
      this.loaderTitle = this.step.title;
      return;
    }
    this.disposeLoader();
  }

  render(width: number): string[] {
    this.sync();
    const currentStatus = status(this.step);
    const title =
      currentStatus === "pending"
        ? (this.loader?.render(width).find((line) => line.trim()) ?? "")
        : this.theme.fg(
            "text",
            ` ${currentStatus === "failure" ? "!" : "✓"} ${this.step.title}`,
          );
    const summary = this.theme.fg(
      "text",
      `  ${summarizeTools(this.step.toolNames)}`,
    );
    return ["", truncateToWidth(title, width), truncateToWidth(summary, width)];
  }

  invalidate(): void {
    this.loader?.invalidate();
  }

  dispose(): void {
    this.disposeLoader();
  }

  private disposeLoader(): void {
    this.loader?.stop();
    this.loader = undefined;
    this.loaderTitle = undefined;
  }
}

function toolCallsFrom(content: any[]): ToolCall[] {
  return content
    .filter((item) => item?.type === "toolCall")
    .map((item) => ({ id: asString(item.id), name: cleanToolName(item.name) }))
    .filter((item): item is ToolCall => Boolean(item.id));
}

function releaseStep(state: RendererState, step: WorkStep): void {
  for (const toolCallId of step.toolCallIds) {
    if (state.pending.get(toolCallId) === step)
      state.pending.delete(toolCallId);
  }
  if (state.assembling?.step === step) state.assembling = undefined;
  step.row?.sync();
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
  step.row?.sync();
}

function updateAssistant(
  component: any,
  message: any,
  state: RendererState,
): void {
  const content = Array.isArray(message?.content) ? message.content : [];
  const toolCalls = toolCallsFrom(content);
  if (toolCalls.length === 0) {
    state.assembling = undefined;
    return;
  }

  const toolNames = toolCalls.map((toolCall) => toolCall.name);
  const candidate = titleFromContent(content, toolNames);
  const step: WorkStep =
    component[WORK_STEP] ??
    ({
      title: candidate.title,
      titleLocked: !candidate.synthesized,
      toolNames: [],
      toolCallIds: new Set<string>(),
      completedToolCallIds: new Set<string>(),
      failed: false,
    } satisfies WorkStep);

  step.toolNames = toolNames;
  step.toolCallIds = new Set(toolCalls.map((toolCall) => toolCall.id));
  if (!step.titleLocked) {
    step.title = candidate.title;
    step.titleLocked = !candidate.synthesized;
  }
  if (message.stopReason === "error" || message.stopReason === "aborted")
    step.failed = true;

  component[WORK_STEP] = step;
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
  step.row?.sync();
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

  const toolCallId = asString(component.toolCallId);
  if (toolCallId !== step.toolCallIds.values().next().value) return [];

  let row = component[WORK_STEP_ROW] as WorkStepRow | undefined;
  if (!row) {
    row = new WorkStepRow(component.ui as TUI, theme, step);
    component[WORK_STEP_ROW] = row;
    step.row = row;
  }
  return row.render(width);
}

function disposeState(state: RendererState): void {
  const steps = new Set(state.pending.values());
  if (state.assembling) steps.add(state.assembling.step);
  for (const step of steps) {
    step.row?.dispose();
    step.row = undefined;
  }
  state.pending.clear();
  state.persisted = new WeakMap();
  state.assembling = undefined;
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
      updateContent.call(this, message);
      assistantProto[CONTROLLER]?.assistantUpdated(this, message);
    };
    const render = assistantProto.render;
    assistantProto.render = function (width: number) {
      return assistantProto[CONTROLLER]?.assistantHasStep(this)
        ? []
        : render.call(this, width);
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
    assistantUpdated(component, message) {
      updateAssistant(component, message, state);
    },
    assistantHasStep(component) {
      return Boolean(component[WORK_STEP]);
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

  pi.on("tool_execution_end", (event) => {
    const step = state.pending.get(event.toolCallId);
    if (!step) return;

    step.completedToolCallIds.add(event.toolCallId);
    step.failed ||= event.isError;
    state.pending.delete(event.toolCallId);
    if (status(step) !== "pending") releaseStep(state, step);
    step.row?.sync();
  });

  pi.on("agent_end", () => {
    failPendingSteps(state);
  });

  pi.on("session_shutdown", () => {
    disposeState(state);
  });
}
