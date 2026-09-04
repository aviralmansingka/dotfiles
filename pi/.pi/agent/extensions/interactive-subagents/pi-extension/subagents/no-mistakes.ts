export interface NoMistakesActivity {
  id?: string;
  branch?: string;
  status: string;
  gate?: string;
  awaitingAgent?: string;
  phases: Array<{
    name: string;
    status: string;
    activeFor?: string;
    lastActivity?: string;
    round?: string;
  }>;
}

export function noMistakesWidgetStatus(activity: NoMistakesActivity): string {
  if (activity.gate) return ` waiting · ${activity.gate} gate `;
  const active = activity.phases.find((phase) =>
    ["running", "fixing", "awaiting"].includes(phase.status),
  );
  if (active) {
    const detail = [active.name, active.round, active.activeFor, active.lastActivity]
      .filter(Boolean)
      .join(" · ");
    return ` active${detail ? ` · ${detail}` : ""} `;
  }
  if (activity.status === "checks-passed") return " waiting · merge ";
  return ` ${activity.status} `;
}
