import type {
  ExtensionAPI,
  ExtensionCommandContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

type Stage = {
  label: string;
  state: "done" | "active" | "pending";
  summary: string;
};

const STAGES: Stage[] = [
  { label: "Admission", state: "done", summary: "Registry fixture loaded" },
  {
    label: "Checkpoint one",
    state: "done",
    summary: "Human approval recorded",
  },
  {
    label: "T02.V01",
    state: "active",
    summary: "Snapshot verification running",
  },
  { label: "Review", state: "pending", summary: "Awaiting verification" },
  { label: "Delivery", state: "pending", summary: "Not started" },
];

function pad(text: string, width: number): string {
  const clipped = truncateToWidth(text, width, "…");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

class EvidenceRailPrototype {
  private selected = 2;
  private expanded = true;

  constructor(
    private readonly theme: Theme,
    private readonly requestRender: () => void,
    private readonly done: () => void,
  ) {}

  handleInput(data: string): void {
    if (
      matchesKey(data, "q") ||
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.ctrl("c"))
    ) {
      this.done();
      return;
    }

    if (
      (matchesKey(data, "j") || matchesKey(data, Key.down)) &&
      this.selected < STAGES.length - 1
    ) {
      this.selected += 1;
      this.requestRender();
      return;
    }

    if (
      (matchesKey(data, "k") || matchesKey(data, Key.up)) &&
      this.selected > 0
    ) {
      this.selected -= 1;
      this.requestRender();
      return;
    }

    if (matchesKey(data, Key.enter)) {
      this.expanded = !this.expanded;
      this.requestRender();
    }
  }

  render(width: number): string[] {
    if (width < 80) {
      return [
        this.theme.fg(
          "warning",
          truncateToWidth("Atlas rail prototype requires 80 columns", width),
        ),
      ];
    }

    const frameWidth = Math.min(width, 115);
    const leftWidth = Math.max(30, Math.floor((frameWidth - 3) * 0.39));
    const rightWidth = frameWidth - leftWidth - 3;
    const selected = STAGES[this.selected]!;
    const lines: string[] = [];

    const row = (left = "", right = "") => {
      lines.push(
        pad(left, leftWidth) +
          this.theme.fg("dim", " │ ") +
          pad(right, rightWidth),
      );
    };

    const rule = () =>
      this.theme.fg(
        "dim",
        "─".repeat(leftWidth) + "─┼─" + "─".repeat(rightWidth),
      );

    const title =
      this.theme.fg("accent", this.theme.bold("VAULT HUNTER")) +
      "  " +
      this.theme.fg("text", this.theme.bold("T02.V01")) +
      this.theme.fg("muted", " · atlas-rich-run");
    const activeBadge = this.theme.bg(
      "toolSuccessBg",
      this.theme.fg("success", this.theme.bold(" ACTIVE ")),
    );
    lines.push(pad(title, frameWidth - 8) + activeBadge);

    row(
      this.theme.fg("warning", this.theme.bold("Run timeline")),
      this.theme.fg("warning", this.theme.bold(`Selected · ${selected.label}`)),
    );
    row(
      this.theme.fg("muted", "2 complete · 1 active · 2 pending"),
      this.theme.fg("muted", selected.summary),
    );
    lines.push(rule());

    const rightRows = this.detailRows(selected);
    let rightIndex = 0;

    row(this.theme.fg("dim", " │"), rightRows[rightIndex++] ?? "");
    STAGES.forEach((stage, index) => {
      const last = index === STAGES.length - 1;
      const connector = last ? " └─ " : " ├─ ";
      const glyph =
        stage.state === "done" ? "✓" : stage.state === "active" ? "◉" : "○";
      const color =
        stage.state === "done"
          ? "success"
          : stage.state === "active"
            ? "warning"
            : "muted";
      let stageText =
        this.theme.fg("dim", connector) +
        this.theme.fg(color, ` ${glyph} ${stage.label} `);
      if (index === this.selected) {
        stageText =
          this.theme.fg("dim", connector) +
          this.theme.bg(
            "selectedBg",
            this.theme.fg(color, this.theme.bold(` ${glyph} ${stage.label} `)),
          );
      }
      row(stageText, rightRows[rightIndex++] ?? "");

      const childConnector = last ? "     " : " │   ";
      row(
        this.theme.fg("dim", childConnector + "└─ ") +
          this.theme.fg(
            index === this.selected ? "accent" : "muted",
            stage.summary,
          ),
        rightRows[rightIndex++] ?? "",
      );
    });

    while (rightIndex < rightRows.length) {
      row("", rightRows[rightIndex++] ?? "");
    }

    lines.push(rule());
    row(
      this.theme.fg("dim", "j/k select · Enter expand · q quit"),
      this.theme.fg(
        "dim",
        `recorded snapshot · ${frameWidth}×${lines.length + 2}`,
      ),
    );

    return lines.map((line) => truncateToWidth(line, width, ""));
  }

  private detailRows(stage: Stage): string[] {
    const th = this.theme;
    const rows = [
      th.fg("muted", "12:01  ") +
        th.fg("syntaxNumber", " ○ ") +
        "verifier queued ",
      th.fg("muted", "12:05  ") +
        th.bg("selectedBg", th.fg("warning", th.bold(" ◉ verifier active "))),
      th.fg("accent", "       Rendering deterministic snapshots"),
      th.fg("muted", "12:05  ") +
        th.bg(
          "toolErrorBg",
          th.fg("error", th.bold(" ! baseline evidence · failed · exit 1 ")),
        ),
      th.fg("error", "       Expected baseline-red result"),
    ];

    if (!this.expanded) return rows;

    if (stage.label !== "T02.V01") {
      return [
        th.fg("muted", "Recorded stage"),
        th.bg(
          "customMessageBg",
          th.fg("customMessageLabel", ` ${stage.label} `),
        ),
        th.fg("muted", " state       ") +
          th.fg(
            stage.state === "done"
              ? "success"
              : stage.state === "active"
                ? "warning"
                : "muted",
            stage.state,
          ),
        th.fg("muted", " summary     ") + th.fg("text", stage.summary),
      ];
    }

    return [
      ...rows,
      th.bg(
        "customMessageBg",
        th.fg("customMessageLabel", th.bold(" Result capsule ")),
      ),
      th.fg("muted", " outcome     ") + th.fg("error", th.bold("failed")),
      th.fg("muted", " phase       ") + th.fg("syntaxNumber", "baseline"),
      th.fg("muted", " reproduce"),
      th.fg("mdLink", " scripts/verify-vault-hunter-atlas T02.V01"),
      th.fg("muted", " artifact    ") + th.fg("syntaxNumber", "aaaaaaaaaaaa…"),
      th.bg(
        "customMessageBg",
        th.fg("customMessageLabel", th.bold(" Ownership ")),
      ),
      th.fg("muted", " driver      ") + "implementer",
      th.fg("muted", " review      ") + "reviewer",
      th.fg("muted", " authority   ") + th.fg("mdLink", "observation only"),
    ];
  }

  invalidate(): void {}
}

export default function atlasEvidenceRailPrototype(pi: ExtensionAPI) {
  pi.registerCommand("atlas-rail-prototype", {
    description: "Open the disposable Atlas evidence-forward rail",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify(
          "The Atlas rail prototype requires interactive TUI mode.",
          "warning",
        );
        return;
      }

      await ctx.ui.custom<void>(
        (tui, theme, _keybindings, done) =>
          new EvidenceRailPrototype(theme, () => tui.requestRender(), done),
      );
    },
  });
}
