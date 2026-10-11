# Subagent rendering — color-accurate reference

A faithful, color-accurate reproduction of how `pi-interactive-subagents` (the vendored fork with the Herdr surface layer) **currently** renders in pi, on the captain's Gruvbox Material theme. Every color below is the exact hex the extension emits — either a **raw ANSI** value (the live widget bypasses the theme) or a **theme token** resolved through `gruvbox-material.json` (the completion boxes).

This is the "current state" we align on before prototyping tree-renderer integration.

## Color legend (exact values used)

| Element | Source | Hex | Token / raw |
|---|---|---|---|
| Terminal bg | theme | `#282828` | `bg0` |
| Default text | theme | `#ebdbb2` | `fg1` |
| **Widget border** | raw ANSI | `#4da3ff` | `ACCENT` (non-theme blue) |
| Active / running icon `⟳` | raw ANSI | `#d6b55e` | `ICON_YELLOW` |
| Stalled icon `⟳` | raw ANSI | `#e06c75` | `ICON_RED` |
| Waiting / starting icon `○` | raw ANSI | `#808080` | `ICON_DIM` |
| Success icon `✓` | theme | `#b8bb26` | `success` = `greenBright` |
| Failure icon `✗` | theme | `#f2594b` | `error` = `red` |
| Title (name) | theme | `#f28534` | `toolTitle` = `orange` (bold) |
| Agent / model / `—` / duration | theme | `#665c54` | `dim` = `ghost` |
| Preview / follow-up text | theme | `#665c54` | `dim` = `ghost` |
| Overflow / "ctrl+o to expand" | theme | `#928374` | `muted` |
| Context gauge >90% | theme | `#f2594b` | `error` |
| Context gauge >70% | theme | `#fabd2f` | `warning` = `yellowBright` |
| Success box bg | theme | `#353d25` | `toolSuccessBg` |
| Failure box bg | theme | `#3d1f1f` | `toolErrorBg` |

> Note the mismatch that motivates this work: the **live widget** draws its border in a non-theme blue (`#4da3ff`) and its icons in non-theme yellow/red/gray, while the **completion box** speaks the theme's token language. Neither uses the tree renderer's glyph vocabulary (`▸ ▹ ◆ ◇ ├─ └─ │`) at all.

---

## 1. Live status widget (`placement: "aboveEditor"`)

Rendered by `renderSubagentWidgetLines` — a rounded box, one row per running subagent. The border and icons are **raw ANSI** (bypass theme); row text is default `fg1`. Shown with three subagents in three different states (active, waiting, stalled) so every icon color is visible.

<pre style="background:#282828;color:#ebdbb2;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:1.5;padding:14px 16px;border-radius:6px;white-space:pre;overflow-x:auto;margin:0">
<span style="color:#4da3ff">╭─ Subagents ─────────────────────────── 3 running ─╮</span>
<span style="color:#4da3ff">│</span> <span style="color:#d6b55e">⟳</span> 00:23  scout (scout)              <span style="color:#665c54">  </span>active · bash 7m <span style="color:#4da3ff">│</span>
<span style="color:#4da3ff">│</span> <span style="color:#808080">○</span> 00:45  scout-2 (scout)                          waiting 2m <span style="color:#4da3ff">│</span>
<span style="color:#4da3ff">│</span> <span style="color:#e06c75">⟳</span> 01:12  researcher (researcher)      stalled 1m · wrong activity id <span style="color:#4da3ff">│</span>
<span style="color:#4da3ff">╰───────────────────────────────────────────────────╯</span>
</pre>

**Row anatomy** (from `renderSubagentWidgetLines` + `formatWidgetRightLabel`):
- Left: ` {icon} {MM:SS}  {name}{ (agent)} `
- Right (status): `active · {scope} {dur}` · `waiting {dur} (done)` · `stalled {dur} · {label}` · `starting…`
- Only the icon is colored; elapsed, name, agent tag, and right label are default `fg1`.

**Status → icon mapping** (`widgetIcon`):

| `kind` | icon | color |
|---|---|---|
| `active` / `running` | `⟳` | `#d6b55e` yellow |
| `stalled` | `⟳` | `#e06c75` red |
| `waiting` / `starting` | `○` | `#808080` dim gray |

---

## 2. Completion message — success (collapsed)

Rendered by the `subagent_result` message renderer via `Box` with `toolSuccessBg`. Real captured output from the earlier live demo (scout on `/tmp/demo-proj`). Collapsed: header + usage line + 5-line preview + overflow + expand hint.

<pre style="background:#353d25;color:#ebdbb2;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:1.5;padding:14px 16px;border-radius:6px;white-space:pre;overflow-x:auto;margin:0">
<span style="color:#b8bb26">✓</span> <span style="color:#f28534;font-weight:700">scout</span><span style="color:#665c54"> (scout)</span><span style="color:#665c54"> (accounts/fireworks/models/glm-5p3-flash)</span> <span style="color:#665c54">—</span> <span style="color:#665c54">3 tools · 43s</span>
<span style="color:#665c54">↑4.3k ↓717 R5.8k $0.001</span>  <span style="color:#665c54">4.3k ctx</span>
<span style="color:#665c54">## Files Found</span>
<span style="color:#665c54">1. `/tmp/demo-proj/README.md` — Project description: budget calculator…</span>
<span style="color:#665c54">2. `/tmp/demo-proj/budget.py` (11 lines) — Core module. Imports compute_tax…</span>
<span style="color:#665c54">3. `/tmp/demo-proj/taxes.py` (4 lines) — leaf module; compute_tax = amount * rate.</span>
<span style="color:#928374">… 28 more lines</span>
<span style="color:#928374">ctrl+o to expand</span>
</pre>

**Line anatomy:**
- Header: `✓` (success) · bold orange **name** · `(agent)` ghost · `(model)` ghost · `—` ghost · `N tools · duration` ghost
- Usage: `↑in ↓out RcacheR WcacheW $cost` (each segment ghost) · context gauge color-coded (>90% red, >70% yellow, else ghost)
- Preview: up to 5 summary lines in `dim` (ghost)
- Overflow: `… N more lines` in `muted` (#928374)
- Hint: `ctrl+o to expand` in `muted`

---

## 3. Completion message — success (expanded)

Same box, `expanded` mode: full summary + follow-up handle + session file path.

<pre style="background:#353d25;color:#ebdbb2;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:1.5;padding:14px 16px;border-radius:6px;white-space:pre;overflow-x:auto;margin:0">
<span style="color:#b8bb26">✓</span> <span style="color:#f28534;font-weight:700">scout</span><span style="color:#665c54"> (scout)</span><span style="color:#665c54"> (accounts/fireworks/models/glm-5p3-flash)</span> <span style="color:#665c54">—</span> <span style="color:#665c54">3 tools · 43s</span>
<span style="color:#665c54">↑4.3k ↓717 R5.8k $0.001</span>  <span style="color:#665c54">4.3k ctx</span>
<span style="color:#ebdbb2">## Files Found</span>
<span style="color:#ebdbb2">1. `/tmp/demo-proj/README.md` — Project description: budget calculator; run via `python main.py`, tests via `python tests.py`.</span>
<span style="color:#ebdbb2">2. `/tmp/demo-proj/budget.py` (11 lines) — Core module. Imports compute_tax from taxes. Functions:</span>
<span style="color:#ebdbb2">   - `line_total(price, qty)` → `price * qty`</span>
<span style="color:#ebdbb2">   - `subtotal(lines)` → sum of line totals</span>
<span style="color:#ebdbb2">   - `grand_total(lines, tax_rate)` → pre * tax_rate  ← BUG</span>
<span style="color:#ebdbb2">3. `/tmp/demo-proj/taxes.py` (4 lines) — leaf module; compute_tax(amount, rate) = amount * rate.</span>
<span style="color:#ebdbb2">…</span>
<span style="color:#665c54">Follow up:  subagent_message({ name: "scout", message: "…" })</span>
<span style="color:#928374">Session file: /home/avirus/.pi/agent/sessions/--tmp--/2026-…scout….jsonl</span>
</pre>

**Expanded-only rows:**
- Full summary lines render in **default `fg1`** (not dim) — the preview-vs-full distinction is a brightness drop, not a color change.
- `Follow up: …` in `dim` (ghost)
- `Session file: …` in `muted` (#928374)

---

## 4. Completion message — failure (collapsed)

`toolErrorBg` background, `✗` in `error` red, failure reason in `error` red.

<pre style="background:#3d1f1f;color:#ebdbb2;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:1.5;padding:14px 16px;border-radius:6px;white-space:pre;overflow-x:auto;margin:0">
<span style="color:#f2594b">✗</span> <span style="color:#f28534;font-weight:700">worker</span><span style="color:#665c54"> (worker)</span><span style="color:#665c54"> (accounts/fireworks/models/glm-5p3-flash)</span> <span style="color:#665c54">—</span> <span style="color:#f2594b">failed (provider/agent error)</span> <span style="color:#665c54">· 1m 12s</span>
<span style="color:#665c54">↑8.1k ↓1.2k R0 $0.004</span>  <span style="color:#fabd2f">96.2%/128k</span>
<span style="color:#665c54">Error: upstream rate limit exceeded (auto-retry exhausted).</span>
<span style="color:#928374">ctrl+o to expand</span>
</pre>

**Failure-specific anatomy:**
- `✗` red, reason `failed (provider/agent error)` or `failed (exit N)` in **`error` red**
- Context gauge here shows `96.2%/128k` in **`warning` yellow** (>70%) — color-coded by fill
- Error message preview in `dim`; full trace available when expanded

---

## What this is NOT yet

None of these surfaces use the tree renderer's vocabulary. The captain's tree renderer (`tool-call-renderer.ts`) speaks a different glyph language:

```
 └─ ▸ Thinking                          (▸ muted = done, ▹ accent = working, × error = failed)
    ├─ • let me look at the project     (• muted bullet, borderMuted connector)
    └─ ◆ 2 reads · loaded               (◆ success, ◇ accent pending, × error)
```

The subagent widget is a **rounded box with raw-ANSI blue borders**; the completion is a **flat bg box with ✓/✗**. They sit beside, but visually disconnected from, the parent's tree trace. The next step (once this reference is approved) is three prototypes that re-express subagent lifecycle in the tree renderer's `▸ ▹ ◆ ◇ ├─ └─ │` language and theme tokens.
