-- Rex keybindings aligned with the tmux config in this repo:
-- C-a prefix, vim-style hjkl pane navigation, | and - splits.
-- Reload after edits: rex config reload

-- Missions: read the ground and steer its seats (rex/missions.lua)
require("missions")

-- Focus panes, vim-style (tmux: bind -r h/j/k/l select-pane)
rex.bind("ctrl+a>h", "pane.focus.left")
rex.bind("ctrl+a>j", "pane.focus.down")
rex.bind("ctrl+a>k", "pane.focus.up")
rex.bind("ctrl+a>l", "pane.focus.right")

-- Tabs are tmux windows (tmux: H/L previous/next window, c new window)
rex.bind("ctrl+a>shift+h", "client.tab.previous")
rex.bind("ctrl+a>shift+l", "client.tab.next")
rex.bind("ctrl+a>n", "client.tab.next")
rex.bind("ctrl+a>p", "client.tab.previous")
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

-- Activity page with its search focused (tmux has no counterpart). It lists
-- every tab and focuses the one you pick. C-a o, where o stands for overview.
-- Rex has no query for whether the page is open, so this key toggles it:
-- a press opens it with the filter focused, the next press closes it.
rex.action{
  name  = "activity_search",
  title = "Activity Search",
  run = function()
    rex.client.queue("client.sidebar.activity.toggle")
    rex.client.queue("client.sidebar.filter.focus")
  end,
}
rex.bind("ctrl+a>o", "activity_search")

-- Session picker with its search field focused (C-a s)
rex.bind("ctrl+a>s", "session.switch")

-- tmux defaults that the map above did not cover yet. Keys follow .tmux.conf
-- where it maps, and tmux's own defaults where that file is silent.

-- Move a divider (tmux: C-a C-arrow, resize-pane)
rex.bind("ctrl+a>shift+left", "pane.resize", { direction = "left" })
rex.bind("ctrl+a>shift+right", "pane.resize", { direction = "right" })
rex.bind("ctrl+a>shift+up", "pane.resize", { direction = "up" })
rex.bind("ctrl+a>shift+down", "pane.resize", { direction = "down" })

-- Step to the previous pane (tmux: ; select-pane -l)
rex.bind("ctrl+a>;", "pane.focus_previous")

-- Break the focused pane out into its own tab (tmux: ! break-pane)
rex.bind("ctrl+a>shift+1", "pane.move_to_new_tab")

-- Rename and close the tab (tmux: , rename-window, & kill-window)
rex.bind("ctrl+a>,", "client.tab.rename")
rex.bind("ctrl+a>shift+7", "client.tab.close")

-- Rename the session (tmux: $ rename-session)
rex.bind("ctrl+a>shift+4", "session.rename")

-- Jump straight to a tab by number (tmux: 0-9 select-window)
for tab = 1, 9 do
  rex.bind("ctrl+a>" .. tab, "client.tab.goto", { index = tab })
end
