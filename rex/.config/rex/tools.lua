-- Tools: lazygit and gh-dash in floating layers, one key each.
--
-- A layer is server state, so the toggle keeps it: the first press opens it, the
-- second minimizes it, and the third brings back the same layer in the same
-- place. A minimized layer keeps its bounds on the server, so a restore passes
-- none and the layer comes back where it was.

local terminal = "com.superlogical.terminal.shell"

-- notes.lua owns the footprint math: a layer's rect is a fraction of the
-- window, so the box is sized in character cells and centered where it lands.
local notes = require("notes")

-- The room each tool draws. lazygit arranges its panels in these columns and
-- rows; gh-dash needs the width to show a review list beside its detail pane.
local LAZYGIT_W, LAZYGIT_H = 100, 34
local GHDASH_W, GHDASH_H = 110, 40

-- active_window is the window the human is looking at. Its id goes to
-- new_layer, so the layer lands there even if focus moves in between.
local function active_window(view)
  for _, window in ipairs(view.windows or {}) do
    if window.window_id == view.active_window_id then return window end
  end
  return nil
end

-- A block's directory comes from what the program in it reports, so init.lua
-- keeps that logic. It hands the function over in its return value, which it
-- also puts in the module table; this require reads that table instead of
-- running init.lua a second time.
local function block_cwd(session_id, block_id)
  local ok, shared = pcall(require, "init")
  if not ok or type(shared) ~= "table" or type(shared.block_cwd) ~= "function" then
    return nil, "no block_cwd from init.lua; opening at the default directory"
  end
  return shared.block_cwd(session_id, block_id)
end

-- Both tools work on a repository, so the block's directory climbs to the
-- top-level. Outside a repository the directory itself is used, and the caller
-- prints one line about it.
local function repo_dir(session_id, block_id, label)
  local cwd, why = block_cwd(session_id, block_id)
  if cwd == nil then return nil, why end
  local r = rex.exec({ "git", "-C", cwd, "rev-parse", "--show-toplevel" })
  local top = r ~= nil and r.ok == true and (r.stdout or ""):gsub("%s+$", "") or ""
  if top == "" then
    return cwd, ("%s: %s is not in a git repository, opening there"):format(label, cwd)
  end
  return top
end

-- toggle steps the tool's layer through normal, minimized, normal. The label is
-- matched inside the active window only, so a layer from another window or
-- another session is never reused.
local function toggle(ctx, spec)
  local session_id = ctx.session_id or rex.session_id
  local view, err = rex.session.view{ session_id = session_id }
  if view == nil then error(err, 0) end
  local window = active_window(view)
  if window == nil then error("no active window", 0) end

  local found
  for _, layer in ipairs(window.layers or {}) do
    if layer.kind == "floating" then
      for _, block in ipairs(layer.blocks or {}) do
        if block.label == spec.label then found = layer end
      end
    end
  end

  if found ~= nil then
    local minimising = found.state ~= "minimized"
    local state = minimising and "minimized" or "normal"
    local r, e = rex.session.set_layer_state{
      session_id = session_id,
      layer_id = found.layer_id,
      state = state,
      -- A restore puts the tool back in front, so it takes focus; a minimize
      -- gives the layout back and leaves focus where the human put it.
      focus = not minimising,
    }
    if r == nil then error(e, 0) end
    return { label = spec.label, layer_id = found.layer_id, state = state }
  end

  local block_id = window.focused_block_id or ctx.block_id
  local dir, note = repo_dir(session_id, block_id, spec.label)
  if note ~= nil then print(note) end
  local options = {
    command = spec.command,
    -- The program starts at the box's own size, so it is never clipped while
    -- the layer settles.
    size = { columns = spec.w, rows = spec.h },
  }
  if dir ~= nil then options.cwd = dir end
  local layer, lerr = rex.session.new_layer{
    session_id = session_id,
    window_id = window.window_id,
    bounds = notes.bounds_for(session_id, spec.w, spec.h),
    focus = true,
    layout = rex.layout.block{
      flavor = terminal,
      label = spec.label,
      options = options,
    },
  }
  if layer == nil then error(lerr, 0) end
  return { label = spec.label, layer_id = layer.layer_id, state = "normal", cwd = dir, note = note }
end

rex.action{
  name = "lazygit",
  title = "LazyGit",
  description = "Toggle lazygit in a floating layer at the focused block's repository.",
  category = "Tools",
  run = function(ctx, args)
    return toggle(ctx, {
      label = "lazygit",
      command = { "lazygit" },
      w = LAZYGIT_W,
      h = LAZYGIT_H,
    })
  end,
}

rex.action{
  name = "gh_dash",
  title = "gh-dash",
  description = "Toggle gh-dash in a floating layer at the focused block's repository.",
  category = "Tools",
  run = function(ctx, args)
    return toggle(ctx, {
      label = "gh-dash",
      -- gh-dash installs as a gh extension here, so it runs through gh.
      command = { "gh", "dash" },
      w = GHDASH_W,
      h = GHDASH_H,
    })
  end,
}

-- C-a g for the git tool and C-a G for the dashboard: both chords were free, and
-- with the prefix they cannot be taken by a global application shortcut.
rex.bind("ctrl+a>g", "lazygit")
rex.bind("ctrl+a>shift+g", "gh_dash")
