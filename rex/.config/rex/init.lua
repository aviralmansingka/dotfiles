-- Rex keybindings aligned with the tmux config in this repo:
-- C-a prefix, vim-style hjkl pane navigation, | and - splits.
-- Reload after edits: rex config reload

-- Focus panes, vim-style (tmux: bind -r h/j/k/l select-pane)
rex.bind("ctrl+a>h", "pane.focus.left")
rex.bind("ctrl+a>j", "pane.focus.down")
rex.bind("ctrl+a>k", "pane.focus.up")
rex.bind("ctrl+a>l", "pane.focus.right")

-- Tabs are tmux windows (tmux: H/L previous/next window, c new window)
rex.bind("ctrl+a>shift+h", "client.tab.previous")
rex.bind("ctrl+a>shift+l", "client.tab.next")
rex.bind("ctrl+a>c", "client.tab.new")

-- Splits (tmux: | split-window -h, - split-window -v)
rex.bind("ctrl+a>shift+\\", "pane.split.right")
rex.bind("ctrl+a>-", "pane.split.down")

-- Pane state (tmux defaults: z zoom, x kill-pane)
rex.bind("ctrl+a>z", "pane.zoom")
rex.bind("ctrl+a>x", "pane.close")

-- Type a literal C-a in the pane (tmux: bind C-a send-prefix)
rex.bind("ctrl+a>ctrl+a", "pane.send_key", { key = "ctrl+a" })

-- App UI (C-a b expands and minimizes the sidebar/tab viewer)
rex.bind("ctrl+a>b", "client.sidebar.toggle")
