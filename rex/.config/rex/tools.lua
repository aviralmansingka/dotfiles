-- Tools: lazygit and gh-dash in floating layers, one key each.
--
-- A layer is server state, so the toggle keeps it: the first press opens it, the
-- second minimizes it, and the third brings back the same layer in the same
-- place. A minimized layer keeps its bounds on the server, so a restore passes
-- none and the layer comes back where it was.
--
-- init.lua passes the block-directory reader in, so the rules for where a block
-- actually runs keep one definition.

local notes = require("notes")

if type(notes) ~= "table" or notes.bounds_for == nil then
  error("rex/tools.lua needs rex/notes.lua to return its card helpers", 0)
end

local terminal = "com.superlogical.terminal.shell"

-- The room each tool draws. lazygit arranges its panels in these columns and
-- rows; gh-dash needs the width to show a review list beside its detail pane.
local LAZYGIT_W, LAZYGIT_H = 100, 34
local GHDASH_W, GHDASH_H = 110, 40

return function(shared)
  local block_cwd = shared.block_cwd

  -- active_window is the window the human is looking at.
  local function active_window(view)
    for _, window in ipairs(view.windows or {}) do
      if window.window_id == view.active_window_id then return window end
    end
    return nil
  end

  -- toplevel_of is the git top level of a directory, or nil outside a
  -- repository.
  local function toplevel_of(cwd)
    local r = rex.exec({ "git", "-C", cwd, "rev-parse", "--show-toplevel" })
    if r == nil or r.ok ~= true then return nil end
    local top = (r.stdout or ""):gsub("%s+$", "")
    if top == "" then return nil end
    return top
  end

  -- repo_dir is where a tool runs: the top level of the block's repository. It
  -- falls back to the block's own directory, with one line that says so.
  local function repo_dir(session_id, block_id, label)
    local cwd = block_cwd(session_id, block_id)
    if cwd == nil then return nil, "no block directory; opening at the default" end
    local top = toplevel_of(cwd)
    if top == nil then
      return cwd, ("%s: %s is not in a git repository, opening there"):format(label, cwd)
    end
    return top
  end

  -- block_label_is says whether a layer holds the block carrying this label.
  local function block_label_is(layer, label)
    for _, block in ipairs(layer.blocks or {}) do
      if block.label == label then return true end
    end
    return false
  end

  -- layer_with_label finds the tool's layer in one window, and nowhere else.
  local function layer_with_label(window, label)
    for _, layer in ipairs(window.layers or {}) do
      if layer.kind == "floating" and block_label_is(layer, label) then return layer end
    end
    return nil
  end

  local function apply_state(session_id, layer_id, state, focus)
    local r, e = rex.session.set_layer_state{
      session_id = session_id,
      layer_id = layer_id,
      state = state,
      focus = focus,
    }
    if r == nil then error(e, 0) end
  end

  -- flip is the second and third press. A restore puts the tool back in front,
  -- so it takes focus; a minimize gives the layout back and leaves focus where
  -- the human put it.
  local function flip(session_id, layer, label)
    local minimising = layer.state ~= "minimized"
    local state = minimising and "minimized" or "normal"
    apply_state(session_id, layer.layer_id, state, not minimising)
    return { label = label, layer_id = layer.layer_id, state = state }
  end

  -- open is the first press: the tool's own layer, in the active window,
  -- focused.
  local function open(session_id, window, ctx, spec)
    local block_id = window.focused_block_id or ctx.block_id
    local dir, note = repo_dir(session_id, block_id, spec.label)
    if note ~= nil then print(note) end
    local layer, err = rex.session.new_layer{
      session_id = session_id,
      window_id = window.window_id,
      bounds = notes.bounds_for(session_id, spec.w, spec.h),
      focus = true,
      layout = rex.layout.block{
        flavor = terminal,
        label = spec.label,
        options = {
          command = spec.command,
          -- The program starts at the box's own size, so it is never clipped
          -- while the layer settles.
          size = { columns = spec.w, rows = spec.h },
          cwd = dir,
        },
      },
    }
    if layer == nil then error(err, 0) end
    return { label = spec.label, layer_id = layer.layer_id, state = "normal", cwd = dir, note = note }
  end

  -- toggle steps the tool through open, minimized, open again.
  local function toggle(ctx, spec)
    local session_id = ctx.session_id or rex.session_id
    local view, err = rex.session.view{ session_id = session_id }
    if view == nil then error(err, 0) end
    local window = active_window(view)
    if window == nil then error("no active window", 0) end
    local layer = layer_with_label(window, spec.label)
    if layer ~= nil then return flip(session_id, layer, spec.label) end
    return open(session_id, window, ctx, spec)
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

  -- C-a g for the git tool and C-a G for the dashboard: both chords were free,
  -- and with the prefix they cannot be taken by a global application shortcut.
  rex.bind("ctrl+a>g", "lazygit")
  rex.bind("ctrl+a>shift+g", "gh_dash")
end
