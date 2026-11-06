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

## Install with nix

Home Manager installs `tb-vim` from `nix/pkgs/tb-vim.nix` on every host that
imports the shared module. The flake packages `scripts/tb-vim` as a
`writeShellApplication` with Node on its runtime path, so no manual setup is
needed after a profile switch.

```bash
nix build --impure --expr '(import <nixpkgs> {}).callPackage ./nix/pkgs/tb-vim.nix {}'
```

## Install into a tab

```bash
tb-vim --watch      # install now and keep tabs covered (default)
tb-vim --once       # install into open tabs, then exit
tb-vim --all        # every open tab, not only the first
tb-vim --list       # show browsers and page targets
tb-vim --cdp 9222   # use a raw CDP port instead of terminal-browser
```

From the repo, use `./tb-vim.mjs` instead of `tb-vim`.

Run `--watch` in its own pane or under `nohup`, because the keys stop after a
navigation once the process exits:

```bash
nohup tb-vim --watch >/tmp/tb-vim.log 2>&1 &
```

Chromium drops `Page.addScriptToEvaluateOnNewDocument` registrations when the
CDP client disconnects. In watch mode the process keeps one session per tab and
re-evaluates the layer on every `Page.loadEventFired`, so keys survive reloads
and full navigations.

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
4. In watch mode the same session stays open. Each page load re-runs the layer,
   which is what makes the keys survive navigation.

## Limits

- Links inside iframes and open shadow roots are not hinted.
- Tab commands (`t`, `J`, `K`, `x`) live in the terminal-browser app, not the
  page, so this layer cannot provide them.
- Each tab needs a new install unless you keep `--watch` running.
