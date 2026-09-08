# Aviral's Lavish theme

Use this profile by default for developer tooling, terminal workflows, architecture, implementation plans, and other
technical artifacts unless the user requests another look or the artifact must faithfully reproduce a product's own UI.
It is distilled from the existing Neovim, Sidekick, ANSI-fence, and deployment-review artifacts.

## Direction

- Render technical subjects as a compact terminal-native surface, not a generic SaaS dashboard.
- Use Gruvbox Material dark, `medium` background, `mix` foreground, low UI contrast.
- Use monospace for terminal chrome, controls, labels, metrics, code, and tables. Sans-serif is allowed only for longer
  explanatory prose where it improves reading.
- Prefer flat nested panes, 1px borders, line-number gutters, title bars, status lines, keyboard hints, tree glyphs,
  compact tags, and restrained radii (`4px`–`10px`).
- Keep density high: body text around `13px`–`15px`, metadata around `11px`–`12px`, and compact spacing.
- Use shadows only to separate a main terminal/window from the page. Do not give every card a floating shadow.
- Avoid glassmorphism, oversized marketing headings, pill-heavy layouts, neon gradients, and default
  Tailwind/DaisyUI styling.
- Preserve real terminal hierarchy and behavior. When mocking Neovim or a CLI, include authentic borders, selection
  rows, modes, status semantics, keyboard controls, and responsive overflow behavior.

## Canonical tokens

Inline these variables so the standalone artifact remains portable:

```css
:root {
  color-scheme: dark;
  --bg0: #282828;
  --bg1: #32302f;
  --bg2: #3c3836;
  --bg3: #45403d;
  --border: #504945;
  --ghost: #665c54;
  --muted: #928374;
  --fg0: #e2cca9;
  --fg1: #e2cca9;
  --orange: #f28534;
  --yellow: #e9b143;
  --yellow-bright: #fabd2f;
  --green: #b0b846;
  --green-bright: #b8bb26;
  --aqua: #8bba7f;
  --blue: #80aa9e;
  --purple: #d3869b;
  --red: #f2594b;
  --red-soft: #ea6962;
  --mono: "JetBrainsMono Nerd Font", "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace;
  --sans: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
```

## Semantic mapping

- Page and terminal background: `--bg0`; secondary surfaces: `--bg1`; raised/selected surfaces: `--bg2`/`--bg3`.
- Primary text: `--fg1`; brightest text: `--fg0`; secondary text: `--muted`; disabled/ghost text: `--ghost`.
- Headings, active tool titles, and keywords: `--orange`; functions: `--yellow`; strings/success: `--green`.
- Information/links/types: `--blue` or `--aqua`; branches/custom labels: `--purple`; errors/removals: `--red`.
- Borders stay `--border`; active borders may use `--blue`; selected rows use `--bg3` rather than a bright outline.
- For real product mockups, the product's actual design system still wins over this profile.
