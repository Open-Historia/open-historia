class_name SharedGameOverlay
extends Control

signal left

const GLASS_TINT := Color(19 / 255.0, 19 / 255.0, 21 / 255.0, 0.86)
const GLASS_BORDER := Color(1, 1, 1, 0.1)
const INK := Color(246 / 255.0, 246 / 255.0, 248 / 255.0, 0.94)
const SMALL := Color(1, 1, 1, 0.6)
const PROBLEM := Color("#fca5a5")
const BUTTON_BG := Color(1, 1, 1, 0.07)
const BUTTON_BORDER := Color(1, 1, 1, 0.12)
const PRIMARY_BG := Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.2)
const PRIMARY_BORDER := Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.6)
const PRIMARY_INK := Color("#e6f8ff")
const PHASES := {
	"lobby": "Lobby",
	"planning": "Planning",
	"countdown": "Countdown",
	"resolving": "The world moves…",
	"revealing": "What happened",
}

var engine: EngineLink
var context := {}
var _state := {}
var _received_at := 0
var _choice := ""
var _status := ""
var _copied := false
var _show_players := false
var _panel: GlassPanel
var _clock_label: Label
var _notice_label: Label
var _tick: Timer


func _init() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	visible = false
	_tick = Timer.new()
	_tick.wait_time = 0.5
	_tick.timeout.connect(_on_tick)
	add_child(_tick)


func setup(link: EngineLink, extra := {}) -> void:
	engine = link
	context = extra
	if not engine.engine_event.is_connected(_on_event):
		engine.engine_event.connect(_on_event)
	var reply := await engine.request("multiplayer.state")
	if reply.get("ok", false) and is_instance_valid(self):
		show_state((reply["result"] as Dictionary).get("shared", {}))


func _exit_tree() -> void:
	if engine and engine.engine_event.is_connected(_on_event):
		engine.engine_event.disconnect(_on_event)


func _on_event(name: String, data: Variant) -> void:
	if name == "multiplayer.shared" and typeof(data) == TYPE_DICTIONARY:
		show_state(data)


func show_state(view: Dictionary) -> void:
	_state = view
	_received_at = Time.get_ticks_msec()
	_render()


func _mode() -> String:
	return str(_state.get("mode", "off"))


func _lobby() -> Dictionary:
	var lobby: Variant = _state.get("lobby")
	return lobby if typeof(lobby) == TYPE_DICTIONARY else {}


func _round() -> Dictionary:
	var current: Variant = _state.get("round")
	return current if typeof(current) == TYPE_DICTIONARY else {}


func _button(caption: String, primary := false) -> Button:
	return CommunityKit.pill_button(caption, {
		"bg": PRIMARY_BG if primary else BUTTON_BG,
		"border": PRIMARY_BORDER if primary else BUTTON_BORDER,
		"ink": PRIMARY_INK if primary else INK,
		"size": 13,
		"weight": 650,
		"height": 32.0,
		"pad": 14.0,
		"radius": 999,
	})


func _small(value: String, color := SMALL) -> Label:
	return CommunityKit.para(value, 12, color, 400, 1.35)


func _clear() -> void:
	if is_instance_valid(_panel):
		remove_child(_panel)
		_panel.queue_free()
	_panel = null
	_clock_label = null
	_notice_label = null


func _render() -> void:
	_clear()
	var mode := _mode()
	visible = mode != "off"
	_tick.stop()
	if mode == "off":
		return
	if mode == "ended":
		_render_ended()
		return
	var me := str(_state.get("me", ""))
	if _lobby().get("started", false) and not me.is_empty():
		_render_round(me)
	else:
		_render_lobby(me)


func _place_top(panel: Control, top: float, width: float) -> void:
	panel.anchor_left = 0.5
	panel.anchor_right = 0.5
	panel.anchor_top = 0.0
	panel.anchor_bottom = 0.0
	panel.offset_left = -width * 0.5
	panel.offset_right = width * 0.5
	panel.offset_top = top
	panel.grow_vertical = Control.GROW_DIRECTION_END


func _render_ended() -> void:
	_panel = GlassPanel.new(GLASS_TINT, 16.0, Vector4(19, 16, 19, 16), GLASS_BORDER)
	_panel.mouse_filter = Control.MOUSE_FILTER_STOP
	var stack := VBoxContainer.new()
	stack.add_theme_constant_override("separation", 0)
	stack.add_child(UI.label("The shared game ended", 14, INK, 750))
	var reason := str(_state.get("error", ""))
	var why := _small(reason if not reason.is_empty() else "The connection closed.")
	var gap := MarginContainer.new()
	gap.add_theme_constant_override("margin_top", 6)
	gap.add_theme_constant_override("margin_bottom", 13)
	gap.add_child(why)
	stack.add_child(gap)
	var back := _button("Back to my games")
	back.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	back.pressed.connect(_leave)
	stack.add_child(back)
	_panel.add_child(stack)
	add_child(_panel)
	_place_top(_panel, get_viewport_rect().size.y * 0.15, 360.0)


func _render_lobby(me: String) -> void:
	var lobby := _lobby()
	var role := str(_state.get("role", ""))
	var error := str(_state.get("error", ""))
	var token := str(_state.get("token", ""))
	var view := get_viewport_rect().size
	var width := minf(544.0, view.x - 32.0)
	_panel = GlassPanel.new(GLASS_TINT, 16.0, Vector4(21, 19, 21, 19), GLASS_BORDER)
	_panel.mouse_filter = Control.MOUSE_FILTER_STOP
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	var stack := VBoxContainer.new()
	stack.add_theme_constant_override("separation", 0)
	stack.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(stack)
	_panel.add_child(scroll)
	var settings: Dictionary = lobby.get("settings", {}) if typeof(lobby.get("settings")) == TYPE_DICTIONARY else {}
	var name := str(settings.get("name", ""))
	stack.add_child(CommunityKit.margin_below(UI.label(name if not name.is_empty() else "Shared game", 18, INK, 800), 3))
	var line := ""
	if not lobby.is_empty():
		var scenario: Dictionary = lobby.get("scenario", {}) if typeof(lobby.get("scenario")) == TYPE_DICTIONARY else {}
		var scenario_name := str(scenario.get("name", ""))
		line = "%s · %s min rounds · %s days a round" % [scenario_name if not scenario_name.is_empty() else "Scenario", _number_text(settings.get("roundMinutes")), _number_text(settings.get("daysPerRound"))]
	else:
		line = str(_state.get("stage", ""))
		if line.is_empty():
			line = "Finding the host…"
	stack.add_child(_small(line))
	if lobby.is_empty() and role != "host" and error.is_empty():
		var waiting := MarginContainer.new()
		waiting.add_theme_constant_override("margin_top", 6)
		waiting.add_child(_small(str(_state.get("ownMapNote", ""))))
		stack.add_child(waiting)
	if role == "host" and not token.is_empty():
		var invite := VBoxContainer.new()
		invite.add_theme_constant_override("separation", 0)
		var top := MarginContainer.new()
		top.add_theme_constant_override("margin_top", 16)
		top.add_child(invite)
		var seats: Variant = settings.get("seats")
		invite.add_child(_small("Invite code: anyone who has it can join, up to %s players." % (_number_text(seats) if seats != null else "8")))
		var code_row := HBoxContainer.new()
		code_row.add_theme_constant_override("separation", 8)
		var code := PanelContainer.new()
		code.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.06), Color(0, 0, 0, 0), 8, 0, Vector4(10, 7, 10, 7)))
		code.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var code_text := UI.label(token, 12, INK, 400, "Consolas")
		code_text.clip_text = true
		code_text.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		code.add_child(code_text)
		code_row.add_child(code)
		var copy := _button("✓ Copied!" if _copied else "Copy")
		copy.pressed.connect(func() -> void:
			DisplayServer.clipboard_set(token)
			_copied = true
			_render()
			await get_tree().create_timer(1.5).timeout
			if is_instance_valid(self):
				_copied = false
				_render())
		code_row.add_child(copy)
		var rotate := _button("New code")
		rotate.tooltip_text = "A new code: the old one stops working"
		rotate.pressed.connect(func() -> void: _control("rotate"))
		code_row.add_child(rotate)
		var row_gap := MarginContainer.new()
		row_gap.add_theme_constant_override("margin_top", 6)
		row_gap.add_child(code_row)
		invite.add_child(row_gap)
		var engine_status: Variant = _state.get("engine")
		var relays: Variant = (engine_status as Dictionary).get("relays") if typeof(engine_status) == TYPE_DICTIONARY else null
		var relay_text := "Relays: connecting…"
		if typeof(relays) == TYPE_DICTIONARY:
			relay_text = "Relays: %s of %s connected" % [_number_text((relays as Dictionary).get("connected", 0)), _number_text((relays as Dictionary).get("total", 0))]
		var relay_gap := MarginContainer.new()
		relay_gap.add_theme_constant_override("margin_top", 6)
		relay_gap.add_child(_small(relay_text))
		invite.add_child(relay_gap)
		for entry in _state.get("people", []):
			var person: Dictionary = entry
			var person_gap := MarginContainer.new()
			person_gap.add_theme_constant_override("margin_top", 6)
			person_gap.add_child(_small(str(person.get("text", "")), PROBLEM if person.get("problem", false) else SMALL))
			invite.add_child(person_gap)
		stack.add_child(top)
	var players := VBoxContainer.new()
	players.add_theme_constant_override("separation", 0)
	var players_gap := MarginContainer.new()
	players_gap.add_theme_constant_override("margin_top", 16)
	players_gap.add_child(players)
	players.add_child(CommunityKit.margin_below(UI.label("PLAYERS", 12, SMALL), 6))
	_seat_list(players, lobby.get("seats", []), [])
	stack.add_child(players_gap)
	var stand_in := str(_state.get("standIn", ""))
	if me.is_empty() and not lobby.is_empty() and role != "host" and stand_in != "ready" and error.is_empty():
		var setting_up := MarginContainer.new()
		setting_up.add_theme_constant_override("margin_top", 16)
		setting_up.add_child(_small("Setting up the map…"))
		stack.add_child(setting_up)
	if me.is_empty() and not lobby.is_empty() and role != "host" and stand_in == "ready":
		var pick_row := HBoxContainer.new()
		pick_row.add_theme_constant_override("separation", 8)
		var taken := {}
		for seat in lobby.get("seats", []):
			taken[str((seat as Dictionary).get("country", ""))] = true
		var select := OptionButton.new()
		select.add_item("Choose your country…")
		select.set_item_metadata(0, "")
		for country in lobby.get("countries", []):
			if taken.has(str(country)):
				continue
			select.add_item(str(country))
			select.set_item_metadata(select.item_count - 1, str(country))
			if str(country) == _choice:
				select.selected = select.item_count - 1
		select.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		select.focus_mode = Control.FOCUS_NONE
		var select_style := UI.box(BUTTON_BG, BUTTON_BORDER, 999, 1, Vector4(14, 0, 14, 0))
		for state in ["normal", "hover", "pressed", "focus"]:
			select.add_theme_stylebox_override(state, select_style)
		select.add_theme_font_size_override("font_size", 13)
		select.item_selected.connect(func(index: int) -> void:
			_choice = str(select.get_item_metadata(index))
			_render())
		pick_row.add_child(select)
		var take := _button("Take it", true)
		CommunityKit.set_idle(take, _choice.is_empty())
		take.pressed.connect(_pick)
		pick_row.add_child(take)
		var pick_gap := MarginContainer.new()
		pick_gap.add_theme_constant_override("margin_top", 16)
		pick_gap.add_child(pick_row)
		stack.add_child(pick_gap)
	if not me.is_empty() and not lobby.get("started", false):
		var mine := CommunityKit.flow(8, 6)
		var words := _small("You play %s. %s" % [me, "Start when everyone is in." if role == "host" else "Waiting for the host to start."])
		words.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		mine.add_child(CommunityKit.inline(words, mine))
		if role != "host":
			var change := _button("Change")
			change.pressed.connect(func() -> void: _request("unpick", {}))
			mine.add_child(change)
		var mine_gap := MarginContainer.new()
		mine_gap.add_theme_constant_override("margin_top", 16)
		mine_gap.add_child(mine)
		stack.add_child(mine_gap)
	var problem := _status if not _status.is_empty() else error
	if not problem.is_empty():
		var problem_gap := MarginContainer.new()
		problem_gap.add_theme_constant_override("margin_top", 11)
		problem_gap.add_child(CommunityKit.para(problem, 13, PROBLEM, 400, 1.35))
		stack.add_child(problem_gap)
	var buttons := HBoxContainer.new()
	buttons.add_theme_constant_override("separation", 8)
	buttons.alignment = BoxContainer.ALIGNMENT_END
	var leave := _button("Stop sharing" if role == "host" else "Leave")
	leave.pressed.connect(_leave)
	buttons.add_child(leave)
	if role == "host" and not lobby.is_empty() and not lobby.get("started", false):
		var start := _button("Start the game", true)
		start.pressed.connect(func() -> void: _control("start"))
		buttons.add_child(start)
	var buttons_gap := MarginContainer.new()
	buttons_gap.add_theme_constant_override("margin_top", 18)
	buttons_gap.add_child(buttons)
	stack.add_child(buttons_gap)
	add_child(_panel)
	_place_top(_panel, view.y * 0.12, width)
	await get_tree().process_frame
	if is_instance_valid(scroll) and is_instance_valid(stack):
		scroll.custom_minimum_size.y = minf(stack.get_combined_minimum_size().y, view.y * 0.8 - 38.0)


func _seat_list(holder: VBoxContainer, seats: Variant, ready: Array) -> void:
	for entry in (seats if typeof(seats) == TYPE_ARRAY else []):
		var seat: Dictionary = entry
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 8)
		var country := UI.label(str(seat.get("country", "")), 14, INK)
		country.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(country)
		row.add_child(UI.label(str(seat.get("name", "")) + (" (you)" if seat.get("you", false) else ""), 14, Color(1, 1, 1, 0.6)))
		var status := str(seat.get("status", ""))
		var tag := ""
		if status == "human":
			tag = "Ready ✓" if ready.has(str(seat.get("country", ""))) else ""
		elif status == "away":
			tag = "Away"
		else:
			tag = "AI player"
		row.add_child(UI.label(tag, 12, SMALL))
		var pad := MarginContainer.new()
		pad.add_theme_constant_override("margin_top", 3)
		pad.add_theme_constant_override("margin_bottom", 3)
		pad.add_child(row)
		holder.add_child(pad)


func _clock_text(ms: float) -> String:
	var total: int = maxi(0, int(ceil(ms / 1000.0)))
	var hours := total / 3600
	var minutes := (total % 3600) / 60
	var seconds := total % 60
	if hours > 0:
		return "%d:%02d:%02d" % [hours, minutes, seconds]
	return "%d:%02d" % [minutes, seconds]


func _remaining_ms() -> float:
	var current := _round()
	var remaining := float(_state.get("remainingMs", current.get("remainingMs", 0)))
	if current.get("paused", false):
		return remaining
	return maxf(0.0, remaining - float(Time.get_ticks_msec() - _received_at))


func _render_round(me: String) -> void:
	var current := _round()
	var role := str(_state.get("role", ""))
	var phase := str(current.get("phase", ""))
	var ready: Array = current.get("ready", []) if typeof(current.get("ready")) == TYPE_ARRAY else []
	var is_ready := ready.has(me)
	var timed := phase in ["planning", "countdown", "revealing"]
	_panel = GlassPanel.new(GLASS_TINT, 16.0, Vector4(14, 7, 10, 7), GLASS_BORDER)
	_panel.mouse_filter = Control.MOUSE_FILTER_STOP
	var stack := VBoxContainer.new()
	stack.add_theme_constant_override("separation", 0)
	var line := CommunityKit.flow(10, 6)
	line.alignment = FlowContainer.ALIGNMENT_CENTER
	var round_text := "Round %s · %s" % [_number_text(current.get("round")) if current.has("round") else "–", PHASES.get(phase, "…")]
	var round_label := UI.label(round_text, 13, INK, 750)
	round_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	line.add_child(round_label)
	if timed:
		_clock_label = UI.label("Paused" if current.get("paused", false) else _clock_text(_remaining_ms()), 13, INK)
		_clock_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		line.add_child(_clock_label)
	var counts := ""
	if not current.is_empty():
		counts = "%d of %s ready" % [ready.size(), _number_text(current.get("counted", 0))]
		if int(current.get("needed", 0)) > 0:
			counts += " (countdown at %s)" % _number_text(current.get("needed"))
	var counts_label := UI.label(counts, 12, SMALL)
	counts_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	line.add_child(counts_label)
	if phase in ["planning", "countdown"] and not me.is_empty():
		var ready_button := _button("Ready ✓" if is_ready else "I'm ready", is_ready)
		ready_button.pressed.connect(func() -> void: _request("ready", {"value": not is_ready}))
		line.add_child(ready_button)
	if role == "host" and phase in ["planning", "countdown"]:
		var paused: bool = current.get("paused", false)
		var pause := _button("Resume" if paused else "Pause")
		pause.pressed.connect(func() -> void: _control("resume" if paused else "pause"))
		line.add_child(pause)
		var now := _button("End round now")
		now.pressed.connect(func() -> void: _control("resolveNow"))
		line.add_child(now)
	var players := _button("Players", _show_players)
	players.pressed.connect(func() -> void:
		_show_players = not _show_players
		_render())
	line.add_child(players)
	var leave := _button("Stop" if role == "host" else "Leave")
	leave.pressed.connect(_leave)
	line.add_child(leave)
	stack.add_child(line)
	_notice_label = UI.label("", 12, SMALL)
	_notice_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_notice_label.visible = false
	stack.add_child(_notice_label)
	_refresh_notice()
	if _show_players:
		var list := VBoxContainer.new()
		list.add_theme_constant_override("separation", 0)
		var rule := ColorRect.new()
		rule.color = Color(1, 1, 1, 0.1)
		rule.custom_minimum_size.y = 1
		list.add_child(rule)
		var lobby := _lobby()
		_seat_list(list, lobby.get("seats", []), ready)
		stack.add_child(list)
	_panel.add_child(stack)
	add_child(_panel)
	var view := get_viewport_rect().size
	var preferred := 0.0
	var count := 0
	for child in line.get_children():
		preferred += (child as Control).get_combined_minimum_size().x
		count += 1
	preferred += 10.0 * maxf(0.0, float(count - 1)) + 26.0
	_place_top(_panel, 54.0, minf(view.x - 24.0, preferred))
	if timed or not str(_notice_label.text).is_empty():
		_tick.start()


func _refresh_notice() -> void:
	if not is_instance_valid(_notice_label):
		return
	var notices: Array = _state.get("notices", []) if typeof(_state.get("notices")) == TYPE_ARRAY else []
	var latest: Dictionary = notices.back() if not notices.is_empty() else {}
	var now := Time.get_unix_time_from_system() * 1000.0
	var recent := not latest.is_empty() and now - float(latest.get("at", 0)) < 8000.0
	_notice_label.text = str(latest.get("text", "")) if recent else ""
	_notice_label.visible = recent


func _on_tick() -> void:
	if is_instance_valid(_clock_label) and not _round().get("paused", false):
		_clock_label.text = _clock_text(_remaining_ms())
	_refresh_notice()


func _number_text(value: Variant) -> String:
	if value == null:
		return ""
	var number := float(value)
	return str(int(number)) if is_equal_approx(number, roundf(number)) else str(number)


func _request(kind: String, fields: Dictionary) -> Dictionary:
	var reply := await engine.request("multiplayer.request", {"t": kind, "fields": fields})
	return reply.get("result", {}) if reply.get("ok", false) else {"ok": false, "error": str(reply.get("error", ""))}


func _pick() -> void:
	_status = ""
	var answer: Dictionary = await _request("pick", {"country": _choice})
	if not is_instance_valid(self):
		return
	if not answer.get("ok", false):
		var reason := str(answer.get("error", ""))
		_status = "Someone has taken that country." if reason == "taken" else (reason if not reason.is_empty() else "The host refused.")
	_render()


func _control(action: String) -> void:
	await engine.request("multiplayer.control", {"action": action})


func _leave() -> void:
	await engine.request("multiplayer.leave")
	if not is_instance_valid(self):
		return
	_state = {}
	_render()
	left.emit()
