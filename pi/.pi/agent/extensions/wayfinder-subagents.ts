import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_TASKS = 8;
const SIDEKICK_NAMED_SESSION = "SIDEKICK_NAMED_SESSION";
const MONITOR_INTERVAL_MS = 1000;
const SUMMARY_OUTPUT_CHARS = 4000;

const MapSchema = Type.Object({
  title: Type.String({ description: "Wayfinder map title; used for the dedicated Herdr workspace." }),
});

const TaskSchema = Type.Object({
  type: StringEnum(["research", "task"] as const, { description: "AFK Wayfinder ticket type." }),
  ticketId: Type.String({ description: "Tracker ticket identifier, e.g. #124 or 03." }),
  title: Type.String({ description: "Human-readable Wayfinder ticket title." }),
  prompt: Type.String({ description: "Complete prompt for the sub-agent" }),
  cwd: Type.Optional(Type.String({ description: "Working directory for this sub-agent. Defaults to current cwd." })),
  model: Type.Optional(Type.String({ description: "Optional Pi model ID." })),
});

const ParamsSchema = Type.Object({
  map: MapSchema,
  backend: Type.Optional(
    Type.String({
      description: "Sub-agent backend. Only 'herdr' is implemented; names are compatible with Neovim Sidekick's pi-* sessions.",
      default: "herdr",
    }),
  ),
  focus: Type.Optional(Type.Boolean({ description: "Focus each Herdr agent as it starts. Default false.", default: false })),
  tasks: Type.Array(TaskSchema, { description: "Wayfinder sub-agent tasks to launch in parallel." }),
});

type Params = Static<typeof ParamsSchema>;

type HerdrAgent = {
  name?: string;
  pane_id?: string;
  tab_id?: string;
  terminal_id?: string;
  workspace_id?: string;
};

type HerdrPlacement = {
  workspaceId: string;
  tabId: string;
  rootPaneId?: string;
  workspaceCreated: boolean;
};

type LaunchedAgent = {
  type: "research" | "task";
  ticket_id: string;
  title: string;
  name: string;
  pane_id?: string;
  tab_id: string;
  tab_label: string;
  terminal_id?: string;
  workspace_id?: string;
  workspace_label: string;
  cwd: string;
  attach: string;
};

type AgentOutcome = {
  agent: LaunchedAgent;
  status: "completed" | "blocked" | "lost";
  output?: string;
};

function slugify(value: string, maxLength = 48): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return slug || "task";
}

function shorten(value: string, maxLength = 56): string {
  const clean = value.trim().replace(/\s+/g, " ");
  return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength - 1).trimEnd()}…`;
}

function names(map: Params["map"], task: Params["tasks"][number]) {
  const mapSlug = slugify(map.title, 24);
  const ticketSlug = slugify(task.ticketId, 12);
  const titleSlug = slugify(task.title, 32);
  const slug = `wf-${mapSlug}-${task.type}-${ticketSlug}-${titleSlug}`;
  const typeLabel = task.type[0].toUpperCase() + task.type.slice(1);
  return {
    workspaceLabel: `Wayfinder · ${map.title}`,
    tabLabel: `${typeLabel} · ${task.ticketId} · ${shorten(task.title)}`,
    slug,
    agentName: `pi-${slug}`,
  };
}

function makePrompt(map: Params["map"], task: Params["tasks"][number]): string {
  return [
    "You are a Wayfinder sub-agent running in your own visible Pi coding-agent session.",
    "Resolve exactly the task below. Do not broaden scope.",
    "If this is a Wayfinder research ticket, record findings on the ticket/map exactly as the Wayfinder skill requires.",
    "If blocked, keep the ticket and session open and begin your final response with `BLOCKED:` followed by the reason.",
    "",
    `Map: ${map.title}`,
    `Ticket: ${task.ticketId} · ${task.title}`,
    `Type: ${task.type}`,
    "",
    task.prompt,
  ].join("\n");
}

async function herdr(args: string[], signal?: AbortSignal): Promise<Record<string, any>> {
  const result = await execFileAsync("herdr", args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    signal,
  });
  const stdout = String(result.stdout ?? "").trim();
  if (!stdout) return {};
  try {
    const decoded = JSON.parse(stdout);
    return decoded?.result && typeof decoded.result === "object" ? decoded.result : decoded;
  } catch {
    throw new Error(`herdr returned non-JSON output: ${stdout.slice(0, 500)}`);
  }
}

async function preparePlacement(
  workspaceLabel: string,
  tabLabel: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<HerdrPlacement> {
  const listed = await herdr(["workspace", "list"], signal);
  const existing = (listed.workspaces ?? []).find((workspace: any) => workspace.label === workspaceLabel);

  if (existing?.workspace_id) {
    const created = await herdr(
      ["tab", "create", "--workspace", existing.workspace_id, "--cwd", cwd, "--label", tabLabel, "--no-focus"],
      signal,
    );
    if (!created.tab?.tab_id) throw new Error(`Herdr did not create a tab in ${workspaceLabel}.`);
    return {
      workspaceId: existing.workspace_id,
      tabId: created.tab.tab_id,
      rootPaneId: created.root_pane?.pane_id,
      workspaceCreated: false,
    };
  }

  const created = await herdr(["workspace", "create", "--cwd", cwd, "--label", workspaceLabel, "--no-focus"], signal);
  const workspaceId = created.workspace?.workspace_id;
  const tabId = created.root_pane?.tab_id ?? created.workspace?.active_tab_id;
  if (!workspaceId || !tabId) throw new Error(`Herdr did not create the ${workspaceLabel} workspace.`);
  await herdr(["tab", "rename", tabId, tabLabel], signal);
  return {
    workspaceId,
    tabId,
    rootPaneId: created.root_pane?.pane_id,
    workspaceCreated: true,
  };
}

async function cleanupPlacement(placement: HerdrPlacement): Promise<void> {
  const args = placement.workspaceCreated
    ? ["workspace", "close", placement.workspaceId]
    : ["tab", "close", placement.tabId];
  try {
    await herdr(args);
  } catch {
    // Preserve the launch error; an empty Herdr tab is safe to remove manually.
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readAgentOutput(name: string): Promise<string | undefined> {
  try {
    const result = await herdr(["agent", "read", name, "--source", "recent-unwrapped", "--lines", "80", "--format", "text"]);
    const text = result.read?.text;
    return typeof text === "string" ? text.slice(-SUMMARY_OUTPUT_CHARS) : undefined;
  } catch {
    return undefined;
  }
}

async function monitorAgent(agent: LaunchedAgent): Promise<AgentOutcome> {
  let sawWorking = false;

  while (true) {
    let status: string | undefined;
    try {
      const result = await herdr(["agent", "get", agent.name]);
      status = result.agent?.agent_status;
    } catch {
      return { agent, status: "lost" };
    }

    if (status === "working") sawWorking = true;
    if (status === "blocked") {
      return { agent, status: "blocked", output: await readAgentOutput(agent.name) };
    }
    if (status === "done" || (sawWorking && status === "idle")) {
      const output = await readAgentOutput(agent.name);
      if (output && /^\s*(?:[•*-]\s*)?BLOCKED:/m.test(output)) {
        return { agent, status: "blocked", output };
      }
      try {
        await herdr(["tab", "close", agent.tab_id]);
      } catch {
        return { agent, status: "lost", output };
      }
      return { agent, status: "completed", output };
    }

    await delay(MONITOR_INTERVAL_MS);
  }
}

function monitorAgents(pi: ExtensionAPI, map: Params["map"], agents: LaunchedAgent[]): void {
  void Promise.all(agents.map(monitorAgent)).then((outcomes) => {
    const results = outcomes.flatMap(({ agent, status, output }) => {
      const session = status === "completed" ? "terminated" : status === "blocked" ? "kept open" : "unavailable";
      return [
        `Ticket: ${agent.ticket_id} · ${agent.title}`,
        `Type: ${agent.type}`,
        `Outcome: ${status}`,
        `Session: ${session}`,
        output ? `Final output:\n${output}` : "Final output unavailable.",
      ];
    });

    pi.sendMessage(
      {
        customType: "wayfinder-subagents-settled",
        content: [
          "Wayfinder sub-agents have settled.",
          `Map: ${map.title}`,
          "Give the user a concise completion summary now.",
          "Include the map, each related ticket, what completed or is blocked, the key conclusion, and session cleanup state.",
          "Do not claim the whole map is complete unless the supplied results establish that.",
          "",
          ...results,
        ].join("\n"),
        display: false,
      },
      { deliverAs: "followUp", triggerTurn: true },
    );
  }).catch(() => {
    // The parent Pi session may have shut down or reloaded while agents ran.
  });
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "wayfinder_subagents",
    label: "Wayfinder Subagents",
    description: [
      "Launch Wayfinder sub-agent Pi coding-agent sessions with the full interactive TUI through Herdr.",
      "Use this after creating Wayfinder research/task tickets that can run AFK in parallel.",
      "Each map gets a dedicated Herdr workspace and each ticket gets its own tab.",
      "Sessions use deterministic pi-wf-<map>-<type>-<ticket>-<title> names for Neovim Sidekick.",
      "Completed sessions are terminated after evidence capture; blocked sessions remain open and the parent receives a summary.",
    ].join(" "),
    promptSnippet: "Launch AFK Wayfinder research/task sub-agents as full interactive Herdr Pi sessions.",
    promptGuidelines: [
      "Use wayfinder_subagents only for AFK Wayfinder research/task tickets; do not use it for HITL grilling/prototype tickets.",
      "When using wayfinder_subagents, pass the map title plus each ticket's type and tracker ID as structured fields.",
      "When using wayfinder_subagents, include the map name/link, ticket name/link, exact question, reporting instructions, and any tracker-specific claim/close rules in each task prompt.",
    ],
    parameters: ParamsSchema,

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if ((params.backend ?? "herdr") !== "herdr") {
        throw new Error("Only the Herdr backend is implemented.");
      }
      if (params.tasks.length === 0) {
        return { content: [{ type: "text", text: "No sub-agent tasks provided." }], details: { agents: [] } };
      }
      if (params.tasks.length > MAX_TASKS) {
        throw new Error(`Too many tasks (${params.tasks.length}); max is ${MAX_TASKS}.`);
      }

      const launched: LaunchedAgent[] = [];

      for (const task of params.tasks) {
        const identity = names(params.map, task);
        const cwd = task.cwd ?? ctx.cwd;
        const placement = await preparePlacement(identity.workspaceLabel, identity.tabLabel, cwd, signal);
        const command = ["pi", "--name", identity.slug];
        if (task.model) command.push("--model", task.model);
        command.push(makePrompt(params.map, task));

        const args = [
          "agent",
          "start",
          identity.agentName,
          "--cwd",
          cwd,
          "--workspace",
          placement.workspaceId,
          "--tab",
          placement.tabId,
          params.focus ? "--focus" : "--no-focus",
          "--env",
          `${SIDEKICK_NAMED_SESSION}=${identity.slug}`,
          "--",
          ...command,
        ];

        let agent: HerdrAgent;
        try {
          const result = await herdr(args, signal);
          agent = (result.agent ?? {}) as HerdrAgent;
          if (!agent.pane_id) throw new Error(`Herdr did not return a pane for ${identity.agentName}.`);
          if (placement.rootPaneId && placement.rootPaneId !== agent.pane_id) {
            await herdr(["pane", "close", placement.rootPaneId], signal);
          }
        } catch (error) {
          await cleanupPlacement(placement);
          throw error;
        }

        launched.push({
          type: task.type,
          ticket_id: task.ticketId,
          title: task.title,
          name: agent.name ?? identity.agentName,
          pane_id: agent.pane_id,
          tab_id: agent.tab_id ?? placement.tabId,
          tab_label: identity.tabLabel,
          terminal_id: agent.terminal_id,
          workspace_id: agent.workspace_id ?? placement.workspaceId,
          workspace_label: identity.workspaceLabel,
          cwd,
          attach: `herdr agent attach ${agent.name ?? identity.agentName} --takeover`,
        });
      }

      monitorAgents(pi, params.map, launched);

      const lines = launched.map(
        (agent) => `- ${agent.tab_label}: ${agent.name} (${agent.attach})`,
      );
      return {
        content: [{ type: "text", text: `Launched ${launched.length} Wayfinder sub-agent(s):\n${lines.join("\n")}` }],
        details: { agents: launched },
      };
    },
  });
}
