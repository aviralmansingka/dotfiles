---
name: tb-vim
description: Vim-style keyboard navigation for terminal-browser tabs. Use when the user asks for vim keys, link hints, or keyboard scrolling in the terminal browser, or when a page in terminal-browser should be driven without a mouse.
---

terminal-browser has no Chrome extension support yet, so Vimium cannot be
installed. The `tb-vim` command installs a small page layer over the browser's
CDP port instead. It is a Nix profile package that wraps
`scripts/tb-vim` in the dotfiles repo.

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
contenteditable element.

## Use it

```bash
tb-vim --watch                        # every tab of the first browser
tb-vim --browser 43938-1 --watch      # one browser
tb-vim --once --all                   # install and exit
tb-vim --list                         # show browsers and page targets
```

Chromium drops script registrations when the CDP client disconnects. Without
`--watch` the keys stop after the next page load. Run the watcher in its own
pane or under `nohup`:

```bash
nohup tb-vim --watch >/tmp/tb-vim.log 2>&1 &
```

## Limits

- Tab commands such as `t`, `J`, `K` and `x` live in terminal-browser itself,
  not in the page, so the layer cannot provide them.
- Links inside iframes and open shadow roots are not hinted.
- Each browser window needs its own watcher when several are open.
