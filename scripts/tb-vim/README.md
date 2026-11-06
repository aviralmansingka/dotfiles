# tb-vim

Vim-style keyboard navigation for terminal-browser, without an extension.
terminal-browser has no Chrome extension support yet, so this installs a small
page layer over the browser's CDP port instead.

## Keys

| Key | Action |
| --- | --- |
| `j` / `k` | scroll down / up |
| `h` / `l` | scroll left / right |
| `d` / `u` | half page down / up |
| `gg` / `G` | top / bottom |
| `f` / `F` | link hints, same tab / new tab |
| `/` | find in page |
| `n` / `N` | next / previous match |
| `H` / `L` | history back / forward |
| `r` | reload |
| `?` | help panel |
| `Esc` | cancel hints, find, help |

Keys are ignored while focus is in an input, textarea, select or a
contenteditable element, so forms keep working.

## Install into a tab

```bash
./tb-vim.mjs            # active tab of the first browser
./tb-vim.mjs --all      # every open tab
./tb-vim.mjs --watch    # keep installing into new tabs
./tb-vim.mjs --list     # show browsers and page targets
```

The layer is registered with `Page.addScriptToEvaluateOnNewDocument`, so it
survives navigation for the life of the tab. Without `--watch` the command
exits at once and the layer stays installed.

## Try it

```bash
terminal-browser new-tab "$(pwd)/demo.html" --split right
./tb-vim.mjs
```

Then move focus to the browser pane and press `j`, `f`, `/`.

## How it works

1. `terminal-browser ls --json` gives the CDP port of each browser.
2. `http://127.0.0.1:<port>/json/list` gives one WebSocket URL per page target.
3. The installer enables `Page`, registers the layer for future documents, and
   evaluates it once for the current document.

## Limits

- Links inside iframes and open shadow roots are not hinted.
- Tab commands (`t`, `J`, `K`, `x`) live in the terminal-browser app, not the
  page, so this layer cannot provide them.
- Each tab needs a new install unless you keep `--watch` running.
- This is a prototype. It is not wired into the `terminal-browser` skill yet.
