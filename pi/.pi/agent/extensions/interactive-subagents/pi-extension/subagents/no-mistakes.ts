export interface NoMistakesActivity {
  id?: string;
  status: string;
  gate?: string;
  summary: string;
  phases: Array<{
    name: string;
    status: string;
    findings?: number;
  }>;
  reviewFindings: Array<{
    severity: string;
    file?: string;
    description: string;
  }>;
}

export function noMistakesWidgetStatus(activity: NoMistakesActivity): string {
  return ` ${activity.summary} `;
}

function findingEmoji(severity: string): string {
  const normalized = severity.toLowerCase();
  if (["error", "critical", "blocking"].includes(normalized)) return "❌";
  if (["info", "note"].includes(normalized)) return "ℹ️";
  return "⚠️";
}

export function noMistakesFindingLines(activity: NoMistakesActivity, limit = 3): string[] {
  const findings = activity.reviewFindings.map((finding) => {
    const location = finding.file ? `${finding.file}: ` : "";
    return `${findingEmoji(finding.severity)} ${location}${finding.description}`;
  });
  if (findings.length === 0 && activity.gate === "review") {
    const count = activity.phases.find((phase) => phase.name === "review")?.findings ?? 0;
    if (count > 0) findings.push(`⚠️ ${count} review finding${count === 1 ? "" : "s"}`);
  }
  if (findings.length <= limit) return findings;
  return [...findings.slice(0, limit), `… +${findings.length - limit} more`];
}
