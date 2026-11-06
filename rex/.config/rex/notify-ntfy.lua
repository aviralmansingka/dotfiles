-- Push a phone notification when a program in any Rex session blocks.
--
-- Runs as a long-lived `rex do` script: it registers one handler and keeps
-- running, hearing every session, including ones created later. Install it
-- with the com.aviral.rex-notify launchd agent.
--
-- Delivery goes through ntfy. The topic is the secret: anyone who knows it can
-- publish to it, so it never lives in this file. It is read from
-- $REX_NTFY_TOPIC, or from ~/.local/state/rex-ntfy/topic (mode 600, outside
-- every repository). $REX_NTFY_SERVER overrides https://ntfy.sh for a
-- self-hosted server.
--
-- Only `blocked` and `error` states push, and only when a block's report
-- actually changes, so a status that re-reports the same message stays quiet.

local home = os.getenv("HOME") or "/Users/aviral"
local state_dir = home .. "/.local/state/rex-ntfy"

local function read_topic()
	local from_env = os.getenv("REX_NTFY_TOPIC")
	if from_env and from_env ~= "" then return from_env end
	local file = io.open(state_dir .. "/topic", "r")
	if file == nil then return nil end
	local topic = file:read("*l")
	file:close()
	if topic == nil or topic == "" then return nil end
	return topic
end

local function push(title, body, priority)
	local topic = read_topic()
	if topic == nil then
		rex.log("warn", "notify-ntfy: no topic in $REX_NTFY_TOPIC or " .. state_dir .. "/topic")
		return
	end
	local server = os.getenv("REX_NTFY_SERVER") or "https://ntfy.sh"
	local r, err = rex.exec({
		"curl",
		"--silent", "--show-error", "--max-time", "10",
		"-X", "POST",
		"-H", "Title: " .. title,
		"-H", "Priority: " .. priority,
		"-d", body,
		server .. "/" .. topic,
	})
	if r == nil then
		rex.log("warn", "notify-ntfy: " .. tostring(err))
	elseif r.exit_code ~= nil and r.exit_code ~= 0 then
		rex.log("warn", "notify-ntfy: curl exited " .. tostring(r.exit_code))
	end
end

-- The last report pushed per record id, so repeats stay quiet.
local last_pushed = {}

rex.on("terminal.program_status_changed", function(ctx, ev)
	local record = ev.record
	if record == nil then return end
	local state = record.state
	if state ~= "blocked" and state ~= "error" then return end

	local fingerprint = state .. "|" .. tostring(record.msg or "")
	if last_pushed[ev.id] == fingerprint then return end
	last_pushed[ev.id] = fingerprint

	local label = "unknown session"
	local view = rex.session.view{}
	if view and view.label and view.label ~= "" then label = view.label end

	local app = record.app or "a program"
	local body = app .. " " .. state .. ": " .. tostring(record.msg or "no message")
	if record.kind then body = body .. " (" .. record.kind .. ")" end

	push("Rex - " .. label, body, "high")
end)
