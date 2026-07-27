# Vault Hunter Atlas expanded-board prototype

> **Throwaway prototype** on branch `prototype/vault-hunter-atlas-expanded-board-styling`.
> It is not production, is not integrated with Neovim, and opens the Registry read-only.

## Purpose

This branch asks whether T22-style tree and timeline views, paired with the Gruvbox presentation hierarchy familiar from native Neovim Markdown, make an expanded Operations Board easier to understand before a production design is adopted.

## Run it

Prerequisites: Go, a terminal at least 120×32, and a Vault Hunter state directory containing at least one Registry run. From the repository root, run any variant:

```sh
go run ./cmd/vault-hunter-atlas-prototype \
  --variant trail-tree \
  --state-dir "${VAULT_HUNTER_STATE_DIR:-$HOME/.local/state/vault-hunter}"
```

```sh
go run ./cmd/vault-hunter-atlas-prototype \
  --variant time-river \
  --state-dir "${VAULT_HUNTER_STATE_DIR:-$HOME/.local/state/vault-hunter}"
```

```sh
go run ./cmd/vault-hunter-atlas-prototype \
  --variant state-deck \
  --state-dir "${VAULT_HUNTER_STATE_DIR:-$HOME/.local/state/vault-hunter}"
```

The latest updated run is selected by default. Add `--run-id RUN_ID` to select one explicitly. Add `--color auto`, `--color always`, or `--color never` to control color output (`auto` is the default).

## Variants

| Variant | Structure | Best question to evaluate |
| --- | --- | --- |
| `trail-tree` | Goals form a compact trail; the selected goal expands into a nested chronological trace. | Does hierarchy make goal activity and agent work easiest to scan? |
| `time-river` | A run-wide observation timeline sits beside a dossier for the selected goal. | Does chronology plus persistent context explain what happened fastest? |
| `state-deck` | Goals occupy state lanes, with the selected goal's tree trace below. | Does workflow state matter more than event order? |

## Controls and display

| Keys | Action |
| --- | --- |
| `↑` / `k`, `↓` / `j` | Select the previous or next goal |
| `←` / `h` / `[`, `→` / `l` / `]` | Select the previous or next run |
| `Enter` | Expand or collapse selected-goal detail |
| `Tab`, `Shift-Tab` | Cycle layouts forward or backward |
| `1`, `2`, `3` | Open `trail-tree`, `time-river`, or `state-deck` |
| `q`, `Esc`, `Ctrl-C` | Quit |

The minimum terminal size is **120×32**; the expanded presentation is also tested at **160×48**. Below the minimum, the prototype shows a resize diagnostic and only quit controls remain active.

## Visual language

- Rounded boxes frame shared run/task context and the footer without turning the body into another panel.
- The selected row spans its available width with background `#32302f` and H3 foreground `#b0b846`.
- A Markdown-like Gruvbox H1–H6 hierarchy differentiates title, task, selection, timeline, metadata, and warnings while displaying no Markdown punctuation.
- Tree rails and state glyphs (`○`, `◉`, `◇`, `!`, `×`, `✓`) carry structure and status independently of color.
- Bold marks headings, keycaps, and selection; italics mark narrative/output prose and empty-state text.

## Agent output behavior

Recognized `subagent/started` and `subagent/finished` observations are grouped by tool-call ID. A participant is attached deterministically only when exactly one active invocation has the matching role. If a future Registry record contains actual `output` or `result`, the prototype renders and wraps that text. Current Registry records often contain only a result digest; in that case the digest is shown and prose is never invented. Output that exceeds the visible row budget ends with the explicit marker `… output truncated`.

## Read-only scope and limitations

The command opens only the Registry reader: it has no Producer, writes, Herdr integration, or orchestration behavior. It makes no production-support promise. Hash-only payloads cannot reveal agent prose, so only their digest can be presented. Participant grouping is ambiguous when multiple active same-role invocations match; the prototype leaves such observations ungrouped rather than guessing.

Validate the prototype package from the repository root:

```sh
go test ./cmd/vault-hunter-atlas-prototype -count=1
```

## Capture and decision

Treat this branch as the primary source for screenshots, observations, and comparison notes. A winning approach must be rewritten and adopted deliberately into a production design; this prototype is not promoted as-is. Losing variants stay out of `main`.
