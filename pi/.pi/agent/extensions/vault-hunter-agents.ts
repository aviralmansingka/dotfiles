import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";

type Agent = {
  name: string;
  description: string;
  tools: string[];
  model: string;
  thinking: string;
  systemPrompt: string;
  filePath: string;
};

type Registry = {
  registerAgent(agent: Agent): void;
  unregisterAgent(name: string): void;
};

const filePath = fileURLToPath(import.meta.url);
const readOnlyTools = ["read", "bash", "grep", "find", "ls"];
const agents: Agent[] = [
  {
    name: "delegate",
    description: "Return exact mechanical observations without synthesis or edits.",
    tools: readOnlyTools,
    model: "openai-codex/gpt-5.6-luna",
    thinking: "low",
    systemPrompt: "Perform only the bounded mechanical task. Do not edit files. Report exact commands, paths, values, and exit statuses. Stop when the requested evidence is complete.",
    filePath,
  },
  {
    name: "context-builder",
    description: "Draft specifications and verifier contracts from accepted context.",
    tools: readOnlyTools,
    model: "openai-codex/gpt-5.6-sol",
    thinking: "high",
    systemPrompt: "Use the supplied context to resolve the requested specification or verifier-design question. Read only directly relevant files. Do not edit files. Report concrete contracts, ambiguities, and evidence.",
    filePath,
  },
  {
    name: "reviewer",
    description: "Independently review a bounded change without editing it.",
    tools: readOnlyTools,
    model: "openai-codex/gpt-5.6-sol",
    thinking: "high",
    systemPrompt: "Independently review the supplied change. Do not edit files. Prioritize correctness and requirement gaps. Report findings by severity with exact evidence, then residual risks.",
    filePath,
  },
];

export default function (pi: ExtensionAPI) {
  let installed = false;
  pi.on("before_agent_start", async (event) => {
    if (!installed) {
      const registry = (globalThis as { __pi_subagents?: Registry }).__pi_subagents;
      if (!registry) throw new Error("The configured subagent extension did not expose its agent registry.");
      for (const name of ["scout", "researcher", "worker", "delegate", "context-builder", "reviewer"]) registry.unregisterAgent(name);
      for (const agent of agents) registry.registerAgent(agent);
      installed = true;
    }
    return {
      systemPrompt: `${event.systemPrompt}\n\nThe only configured headless subagents are delegate, context-builder, and reviewer, and they are read-only. Use visible Herdr-tracked Pi sessions for implementation, verification, review, and delivery unless the user explicitly authorizes a headless exception.`,
    };
  });
}
