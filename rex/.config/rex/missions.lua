-- Missions as an army, read from Rex.
--
-- One army session holds the commander and one captain window per mission, and
-- every mission owns a mission-<slug> session where its troopers work. Those
-- labels are the rank vocabulary, and `mission plan` keeps its only copy, so
-- nothing here spells a label itself. Each action reads live state and keeps
-- none.

local terminal = "com.superlogical.terminal.shell"

-- plan asks the mission binary for one launch description. It is read-only: the
-- binary describes the deployment and changes nothing. An unknown mission, a
-- missing worktree or a closed record comes back as the binary's own message.
local function plan(handle)
  local r, err = rex.exec({ "mission", "plan", handle, "--mux", "rex", "--json" })
  if r == nil then error(err, 0) end
  local envelope = rex.json.decode(r.stdout)
  if envelope == nil then error(r.stderr ~= "" and r.stderr or r.stdout, 0) end
  if envelope.ok ~= true then
    local e = envelope.error
    error(e and e.message or "mission plan failed", 0)
  end
  return envelope.data
end

-- seat finds one mission's captain seat: the session it sits in and the window
-- itself. A seat that is not there is reported, never created.
local function seat(handle)
  local p = plan(handle)
  local list, err = rex.call("session.list", {})
  if list == nil then error(err, 0) end
  local session_id
  for _, s in ipairs(list.sessions or {}) do
    if s.label == p.session then session_id = s.session_id end
  end
  if session_id == nil then error(("no session labeled %q"):format(p.session), 0) end
  local view, verr = rex.session.view{ session_id = session_id }
  if view == nil then error(verr, 0) end
  for _, w in ipairs(view.windows or {}) do
    if w.label == p.captain_window then return session_id, w.window_id end
  end
  error(("no window labeled %q in session %q"):format(p.captain_window, p.session), 0)
end

-- The sitrep is the live picture of the ground: the mission desk in a window of
-- its own, so the human reads mission state without asking an agent.
rex.action{
  name = "mission_sitrep",
  title = "Situation Report",
  description = "Open the mission desk in a window of its own.",
  category = "Missions",
  run = function(ctx, args)
    local w, err = rex.session.new_window{
      window_label = "Situation Report",
      layout = rex.layout.block{
        flavor = terminal,
        options = { command = { "mission", "ui" } },
      },
    }
    if w == nil then error(err, 0) end
    return { window_id = w.window_id }
  end,
}

rex.action{
  name = "mission_focus",
  title = "Focus the Captain",
  description = "Focus the captain window of one mission.",
  category = "Missions",
  args = { handle = "string" },
  run = function(ctx, args)
    local session_id, window_id = seat(args.handle)
    local r, err = rex.session.focus_window{ session_id = session_id, window_id = window_id }
    if r == nil then error(err, 0) end
    return { handle = args.handle, session_id = session_id, window_id = window_id }
  end,
}

rex.action{
  name = "mission_standdown",
  title = "Stand Down",
  description = "Close the captain window of one mission, ending its seat.",
  category = "Missions",
  args = { handle = "string" },
  run = function(ctx, args)
    local session_id, window_id = seat(args.handle)
    local r, err = rex.session.close_window{ session_id = session_id, window_id = window_id }
    if r == nil then error(err, 0) end
    return { handle = args.handle, session_id = session_id, window_id = window_id }
  end,
}

-- picker is the deployment picker. It reads the ready missions through fzf and
-- deploys the chosen one, so the human picks from the ground, not from a list
-- an agent reprints. fzf itself is the only key surface: Enter deploys, Escape
-- exits 0, and every path that selects nothing leaves the vault and Rex alone.
local picker = [[
line=$(mission ready --json | jq -r '.data[] | [.handle, .title, .step.id] | @tsv' |
  fzf --header DEPLOYMENT --delimiter '\t' --with-nth 2,3 --preview 'mission show {1}' --preview-window 'down,60%') || exit 0
[ -n "$line" ] || exit 0
exec mission deploy "$(printf '%s' "$line" | cut -f1)" --mux rex
]]

-- The picker is the only key path a human needs: it reads the ground, then
-- deploys the chosen mission into army and its mission session.
rex.action{
  name = "mission_deploy_pick",
  title = "Deploy a Mission",
  description = "Pick a ready mission and seat it in the army.",
  category = "Missions",
  run = function(ctx, args)
    local layer, err = rex.session.new_layer{
      bounds = { 0.12, 0.12, 0.76, 0.66 },
      focus = true,
      layout = rex.layout.block{
        flavor = terminal,
        options = { command = { "sh", "-lc", picker } },
      },
    }
    if layer == nil then error(err, 0) end
    return { layer_id = layer.layer_id }
  end,
}

-- Bindings land with the actions, so the keymap never names an action this
-- file has not defined. C-a n and C-a p belong to tab cycling, so the deploy
-- picker sits on C-a D. Inside the picker, fzf moves with C-j and C-k.
rex.bind("ctrl+a>m", "mission_sitrep")
rex.bind("ctrl+a>shift+d", "mission_deploy_pick")
