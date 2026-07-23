import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_TASKS = 8;
const SIDEKICK_NAMED_SESSION = "SIDEKICK_NAMED_SESSION";

const TaskSchema = Type.Object({
  title: Type.String({ description: "Human-readable Wayfinder ticket/research title" }),
  prompt: Type.String({ description: "Complete prompt for the sub-agent" }),
  cwd: Type.Optional(Type.String({ description: "Working directory for this sub-agent. Defaults to current cwd." })),
  model: Type.Optional(Type.String({ description: "Optional Pi model pattern, e.g. openai/gpt-5.5 or sonnet:high" })),
});

const ParamsSchema = Type.Object({
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
  terminal_id?: string;
  workspace_id?: string;
};

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "task";
}

function hash(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 7);
}

function makePrompt(task: Params["tasks"][number]): string {
  return [
    "You are a Wayfinder sub-agent running in your own Pi session.",
    "Resolve exactly the task below. Do not broaden scope.",
    "If this is a Wayfinder research ticket, record findings on the ticket/map exactly as the Wayfinder skill requires.",
    "If blocked, leave a concise status note wherever the task asks you to report progress, then stop.",
    "",
    `Task title: ${task.title}`,
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

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "wayfinder_subagents",
    label: "Wayfinder Subagents",
    description: [
      "Launch Wayfinder sub-agent Pi sessions through Herdr.",
      "Use this after creating Wayfinder research/task tickets that can run AFK in parallel.",
      "Each session is named pi-wf-* so it appears in the existing Neovim Sidekick/Herdr named-session flow.",
    ].join(" "),
    promptSnippet: "Launch AFK Wayfinder research/task sub-agents as visible Herdr Pi sessions.",
    promptGuidelines: [
      "Use wayfinder_subagents only for AFK Wayfinder research/task tickets; do not use it for HITL grilling/prototype tickets.",
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

      const launched = [] as Array<{
        title: string;
        name: string;
        pane_id?: string;
        terminal_id?: string;
        workspace_id?: string;
        cwd: string;
        attach: string;
      }>;

      for (const [index, task] of params.tasks.entries()) {
        const slug = `wf-${slugify(task.title)}-${hash(`${task.title}\n${task.prompt}\n${Date.now()}\n${index}`)}`;
        const agentName = `pi-${slug}`;
        const cwd = task.cwd ?? ctx.cwd;
        const command = ["pi", "--name", slug];
        if (task.model) command.push("--model", task.model);
        command.push(makePrompt(task));

        const args = [
          "agent",
          "start",
          agentName,
          "--cwd",
          cwd,
          params.focus ? "--focus" : "--no-focus",
          "--env",
          `${SIDEKICK_NAMED_SESSION}=${slug}`,
          "--",
          ...command,
        ];

        const result = await herdr(args, signal);
        const agent = (result.agent ?? {}) as HerdrAgent;
        launched.push({
          title: task.title,
          name: agent.name ?? agentName,
          pane_id: agent.pane_id,
          terminal_id: agent.terminal_id,
          workspace_id: agent.workspace_id,
          cwd,
          attach: `herdr agent attach ${agent.name ?? agentName}`,
        });
      }

      const lines = launched.map((agent) => `- ${agent.title}: ${agent.name} (${agent.attach})`);
      return {
        content: [{ type: "text", text: `Launched ${launched.length} Wayfinder sub-agent(s):\n${lines.join("\n")}` }],
        details: { agents: launched },
      };
    },
  });
}
