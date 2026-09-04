export interface NoMistakesActivity {
  id?: string;
  status: string;
  outcome?: string;
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

export function noMistakesIsWaiting(activity: NoMistakesActivity): boolean {
  return Boolean(activity.gate || activity.outcome === "checks-passed");
}

function findingEmoji(severity: string): string | undefined {
  if (severity === "error") return "❌";
  if (severity === "warning") return "⚠️";
  if (severity === "info") return "ℹ️";
  return undefined;
}

export function noMistakesFindingLines(activity: NoMistakesActivity): string[] {
  return activity.reviewFindings.flatMap((finding) => {
    const emoji = findingEmoji(finding.severity);
    if (!emoji) return [];
    const location = finding.file ? `${finding.file}: ` : "";
    return `${emoji} ${location}${finding.description}`;
  });
}
