class_name SharedGameOverlay
extends Control

signal left

const GLASS_TINT := Color(19 / 255.0, 19 / 255.0, 21 / 255.0, 0.86)
const GLASS_BORDER := Color(1, 1, 1, 0.1)
const MENU_TINT := Color(19 / 255.0, 19 / 255.0, 21 / 255.0, 0.94)
const INK := Color(246 / 255.0, 246 / 255.0, 248 / 255.0, 0.94)
const BAR_INK := Color("#f8f8f9")
const BAR_MUTED := Color(233 / 255.0, 233 / 255.0, 236 / 255.0, 0.64)
const SMALL := Color(1, 1, 1, 0.6)
const NEW_INK := Color(246 / 255.0, 246 / 255.0, 248 / 255.0, 0.92)
const PROBLEM := Color("#fca5a5")
const PROBLEM_LINE := Color(252 / 255.0, 165 / 255.0, 165 / 255.0, 0.45)
const BUTTON_BG := Color(1, 1, 1, 0.07)
const BUTTON_BORDER := Color(1, 1, 1, 0.12)
const PRIMARY_BG := Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.2)
const PRIMARY_BORDER := Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.6)
const PRIMARY_INK := Color("#e6f8ff")
const ACCENT := Color("#2bc1f3")
const BADGE_INK := Color("#06141a")
const CODE_BG := Color(1, 1, 1, 0.06)
const SECTION_LINE := Color(1, 1, 1, 0.08)
const MARK_LINE := Color(1, 1, 1, 0.18)
const NOTICE_SHOWN_MS := 8000.0
const PHASES := {
	"lobby": "Lobby",
	"planning": "Planning",
	"countdown": "Countdown",
	"resolving": "The world moves…",
	"revealing": "What happened",
}
const REFUSAL_LABELS := {
	"taken": "Another player holds that country.",
	"game-started": "The game is under way, and the host does not let new players join.",
	"full": "The game is full.",
	"not-a-country": "That country is not in this game.",
	"ask-host": "Ask the host to change your country.",
	"released": "The host released you from that country.",
}
const PEOPLE_SVG := "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'/><circle cx='9' cy='7' r='4'/><path d='M22 21v-2a4 4 0 0 0-3-3.87'/><path d='M16 3.13a4 4 0 0 1 0 7.75'/></svg>"
const CHEVRON_SVG := "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>"

var engine: EngineLink
var context := {}
var _state := {}
var _received_at := 0
var _choice := ""
var _pick_status := {"text": "", "problem": false}
var _change_refused := ""
var _ready_refused := {"round": 0, "text": ""}
var _copied := false
var _open := ""
var _read_before := 0.0
var _round_seen := false
var _stopping := false
var _banning := ""
var _pressed_start := false
var _said_starting := false
var _seen_error := ""
var _gm_open := false
var _gm_text := ""
var _told_left := false
var _dismissed := false
var _compact := false
var _root: Control
var _bar: Control
var _menu: Control
var _note: Control
var _clock_label: Label
var _tick: Timer
var _start_timer: Timer


func _init() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	visible = false
	_compact = UI.phone()
	_tick = Timer.new()
	_tick.wait_time = 0.5
	_tick.timeout.connect(_on_tick)
	add_child(_tick)
	_start_timer = Timer.new()
	_start_timer.one_shot = true
	_start_timer.wait_time = 15.0
	_start_timer.timeout.connect(_on_start_waited)
	add_child(_start_timer)


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


func _on_event(event_name: String, data: Variant) -> void:
	if event_name == "multiplayer.shared" and typeof(data) == TYPE_DICTIONARY:
		show_state(data)


func show_state(view: Dictionary) -> void:
	var was_mode := _mode()
	_state = view
	_received_at = Time.get_ticks_msec()
	var mode := _mode()
	if mode != "ended":
		_dismissed = false
	if mode == "off" or (mode != "ended" and was_mode in ["off", "ended"]):
		_reset_local()
	var starting := bool(_engine_status().get("starting", false))
	if starting != _said_starting:
		_said_starting = starting
		if starting:
			_pressed_start = false
	var error := str(_state.get("error", ""))
	if error != _seen_error:
		_seen_error = error
		if not error.is_empty():
			_pressed_start = false
	if mode == "ended" and bool(_state.get("reloaded", false)) and not _told_left:
		_told_left = true
		left.emit()
	_render()


func _reset_local() -> void:
	_open = ""
	_round_seen = false
	_stopping = false
	_banning = ""
	_gm_open = false
	_gm_text = ""
	_pick_status = {"text": "", "problem": false}
	_change_refused = ""
	_ready_refused = {"round": 0, "text": ""}
	_told_left = false


func _mode() -> String:
	return str(_state.get("mode", "off"))


func _role() -> String:
	return str(_state.get("role", ""))


func _dict(value: Variant) -> Dictionary:
	return value if typeof(value) == TYPE_DICTIONARY else {}


func _array(value: Variant) -> Array:
	return value if typeof(value) == TYPE_ARRAY else []


func _lobby() -> Dictionary:
	return _dict(_state.get("lobby"))


func _settings() -> Dictionary:
	return _dict(_lobby().get("settings"))


func _round() -> Dictionary:
	return _dict(_state.get("round"))


func _screen() -> Dictionary:
	return _dict(_state.get("screen"))


func _engine_status() -> Dictionary:
	return _dict(_state.get("engine"))


func _notices() -> Array:
	return _array(_state.get("notices"))


func _rem(value: float) -> float:
	return roundf(value * 16.0)


func _button(caption: String, primary := false, options := {}) -> Button:
	var ink: Color = options.get("ink", UiTheme.pick("glass_active_text", PRIMARY_INK) if primary else UiTheme.pick("text", INK))
	var made := CommunityKit.pill_button(caption, {
		"bg": UiTheme.pick("glass_active", PRIMARY_BG) if primary else UiTheme.pick("glass_chip", BUTTON_BG),
		"border": options.get("border", UiTheme.pick("glass_active_line", PRIMARY_BORDER) if primary else UiTheme.pick("glass_line", BUTTON_BORDER)),
		"ink": ink,
		"size": int(options.get("size", 13)),
		"weight": 650,
		"height": float(options.get("height", 32.0)),
		"pad": float(options.get("pad", 12.0)),
		"radius": 999,
	})
	made.set_meta("oh_tap_exempt", true)
	return made


func _small(value: String, color := Color(0, 0, 0, 0), size := 12) -> Label:
	var ink := color if color.a > 0.0 else UiTheme.pick("muted", SMALL)
	return CommunityKit.para(value, size, ink, 400, 1.45)


func _gap_top(node: Control, top: float) -> MarginContainer:
	var holder := MarginContainer.new()
	holder.add_theme_constant_override("margin_top", int(top))
	holder.add_child(node)
	return holder


func _column(gap_px: float) -> VBoxContainer:
	var stack := VBoxContainer.new()
	stack.add_theme_constant_override("separation", int(gap_px))
	return stack


func _right_row(gap_px: float) -> HFlowContainer:
	var row := CommunityKit.flow(gap_px, gap_px)
	row.alignment = FlowContainer.ALIGNMENT_END
	return row


func _select(items: Array, current: String, on_pick: Callable, size := 13) -> OptionButton:
	var select := OptionButton.new()
	select.set_meta("oh_tap_exempt", true)
	select.clip_text = true
	select.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	for index in range(items.size()):
		var item: Array = items[index]
		select.add_item(str(item[0]))
		select.set_item_metadata(index, str(item[1]))
		if str(item[1]) == current:
			select.selected = index
	select.focus_mode = Control.FOCUS_NONE
	select.custom_minimum_size.y = 32
	var style := UI.box(UiTheme.pick("glass_chip", BUTTON_BG), UiTheme.pick("glass_line", BUTTON_BORDER), 999, 1, Vector4(12, 0, 12, 0))
	for state in ["normal", "hover", "pressed", "focus", "disabled"]:
		select.add_theme_stylebox_override(state, style)
	select.add_theme_font_override("font", UI.font(650))
	select.add_theme_font_size_override("font_size", size)
	for color_name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
		select.add_theme_color_override(color_name, UiTheme.pick("text", INK))
	var popup := select.get_popup()
	popup.add_theme_stylebox_override("panel", UI.box(Color("#1f1f23"), Color(1, 1, 1, 0.12), 8, 1, Vector4(4, 4, 4, 4)))
	popup.add_theme_color_override("font_color", Color("#f4f4f5"))
	select.item_selected.connect(func(index: int) -> void: on_pick.call(str(select.get_item_metadata(index))))
	var widest := 0.0
	for item in items:
		widest = maxf(widest, UI.font(650).get_string_size(str(item[0]), HORIZONTAL_ALIGNMENT_LEFT, -1, size).x)
	select.custom_minimum_size.x = widest + 48.0
	return select


func _clear() -> void:
	for node in [_root, _bar, _menu, _note]:
		if is_instance_valid(node):
			remove_child(node)
			(node as Node).queue_free()
	_root = null
	_bar = null
	_menu = null
	_note = null
	_clock_label = null


func _render() -> void:
	_clear()
	var mode := _mode()
	visible = mode != "off" and not (mode == "ended" and _dismissed)
	_tick.stop()
	if not visible:
		return
	if mode == "ended":
		_render_ended()
		return
	var screen := _screen()
	var me := str(screen.get("me", _state.get("me", "")))
	var watching := str(screen.get("watching", ""))
	var started := bool(_lobby().get("started", false))
	var in_game := started and (not me.is_empty() or not watching.is_empty())
	if in_game:
		_render_bar(me, watching)
	else:
		if _role() == "guest" and bool(_state.get("cutOff", false)):
			_render_cut_off()
		_render_lobby(me)


func _place_centre(panel: Control, top: float, width: float) -> void:
	panel.anchor_left = 0.5
	panel.anchor_right = 0.5
	panel.anchor_top = 0.0
	panel.anchor_bottom = 0.0
	panel.offset_left = -width * 0.5
	panel.offset_right = width * 0.5
	panel.offset_top = top
	panel.grow_vertical = Control.GROW_DIRECTION_END


func _glass(pad: Vector4, corner := 16.0) -> GlassPanel:
	var panel := GlassPanel.new(GLASS_TINT, corner, pad, GLASS_BORDER)
	panel.mouse_filter = Control.MOUSE_FILTER_STOP
	return panel


func _fit_width(holder: Control, content: Control, cap: float) -> float:
	return minf(cap, content.get_combined_minimum_size().x + holder.get_combined_minimum_size().x - content.get_combined_minimum_size().x)


func _render_ended() -> void:
	var view := get_viewport_rect().size
	var panel := _glass(Vector4(19, 16, 19, 16))
	var stack := _column(0)
	stack.add_child(UI.label("The shared game ended", 16, INK, 750))
	var reason := str(_state.get("error", ""))
	var why := _small(reason if not reason.is_empty() else "The connection closed.")
	var gap := MarginContainer.new()
	gap.add_theme_constant_override("margin_top", 6)
	gap.add_theme_constant_override("margin_bottom", 13)
	gap.add_child(why)
	stack.add_child(gap)
	if not bool(_state.get("leaving", false)):
		var button := _button("Leave" if not _role().is_empty() else "OK")
		button.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		if _role().is_empty():
			button.pressed.connect(_dismiss)
		else:
			button.pressed.connect(_leave)
		stack.add_child(button)
	panel.add_child(stack)
	_root = panel
	add_child(panel)
	var cap := minf(480.0, view.x - 32.0)
	var natural := maxf(UI.font(750).get_string_size("The shared game ended", HORIZONTAL_ALIGNMENT_LEFT, -1, 16).x, UI.font(400).get_string_size(why.text, HORIZONTAL_ALIGNMENT_LEFT, -1, 12).x) + 38.0
	_place_centre(panel, view.y * 0.15, minf(cap, natural))


func _render_cut_off() -> void:
	var panel := _glass(Vector4(14, 7, 14, 7))
	var words := _small(str(_screen().get("cutOff", "")), PROBLEM)
	words.autowrap_mode = TextServer.AUTOWRAP_OFF
	panel.add_child(words)
	_note = panel
	add_child(panel)
	var view := get_viewport_rect().size
	var width := minf(view.x - 32.0, UI.font(400).get_string_size(words.text, HORIZONTAL_ALIGNMENT_LEFT, -1, 12).x + 30.0)
	_place_centre(panel, 8.0 + UI.safe_insets().y, width)


func _render_lobby(me: String) -> void:
	var lobby := _lobby()
	var settings := _settings()
	var role := _role()
	var host := role == "host"
	var error := str(_state.get("error", ""))
	var screen := _screen()
	var view := get_viewport_rect().size
	var width := minf(544.0, view.x - 32.0)
	var top := view.y * 0.12
	var panel := _glass(Vector4.ZERO)
	var frame := _column(0)
	panel.add_child(frame)
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	var pad := MarginContainer.new()
	pad.add_theme_constant_override("margin_left", 21)
	pad.add_theme_constant_override("margin_right", 21)
	pad.add_theme_constant_override("margin_top", 19)
	pad.add_theme_constant_override("margin_bottom", 6)
	pad.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(pad)
	var stack := _column(0)
	stack.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	pad.add_child(stack)
	frame.add_child(scroll)
	var lobby_name := str(settings.get("name", ""))
	stack.add_child(CommunityKit.margin_below(UI.label(lobby_name if not lobby_name.is_empty() else "Shared game", 18, INK, 800), 3))
	var line := ""
	if not lobby.is_empty():
		var scenario := _dict(lobby.get("scenario"))
		var scenario_name := str(scenario.get("name", ""))
		line = "%s · %s min rounds · %s days a round" % [scenario_name if not scenario_name.is_empty() else "Scenario", _number_text(settings.get("roundMinutes")), _number_text(settings.get("daysPerRound"))]
	elif host and bool(_engine_status().get("preparing", false)):
		line = "Setting up the start of the game before anyone joins…"
	else:
		line = str(_state.get("stage", ""))
		if line.is_empty():
			line = "Opening your shared game…" if host else "Finding the host…"
	stack.add_child(_small(line))
	if lobby.is_empty() and not host and error.is_empty():
		stack.add_child(_gap_top(_small(str(_state.get("ownMapNote", ""))), 6))
	if host:
		var invite := _host_invite()
		if invite:
			stack.add_child(_gap_top(invite, 10))
	var players := _column(0)
	players.add_child(CommunityKit.margin_below(_small("PLAYERS"), 6))
	_seat_list(players, lobby.get("seats", []), [], host, false)
	if host:
		var replies := _replies_setting(true)
		if replies:
			players.add_child(replies)
	_game_rules(players)
	stack.add_child(_gap_top(players, 16))
	var stand_in := str(_state.get("standIn", ""))
	var closed: bool = bool(lobby.get("started", false)) and settings.get("allowMidGameJoin", true) == false
	if me.is_empty() and not lobby.is_empty() and not host and stand_in != "ready" and error.is_empty():
		stack.add_child(_gap_top(_small("Setting up the map…"), 16))
	if me.is_empty() and not lobby.is_empty() and not host and stand_in == "ready" and closed:
		stack.add_child(_gap_top(_small(REFUSAL_LABELS["game-started"]), 16))
	if me.is_empty() and not lobby.is_empty() and not host and stand_in == "ready" and not closed:
		stack.add_child(_country_picker(false))
	if not me.is_empty() and not bool(lobby.get("started", false)) and not host:
		var mine := CommunityKit.flow(8, 6)
		var words := _small("You play %s. Waiting for the host to start." % me)
		words.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		mine.add_child(CommunityKit.inline(words, mine))
		var change := _button("Change")
		change.pressed.connect(_change)
		mine.add_child(change)
		stack.add_child(_gap_top(mine, 16))
	if not _change_refused.is_empty():
		stack.add_child(_gap_top(_small(_change_refused, PROBLEM), 6))
	if not error.is_empty():
		stack.add_child(_gap_top(CommunityKit.para(error, 13, PROBLEM, 400, 1.35), 11))
	var notices := _notice_list(float(_state.get("noticesReadAt", 0)), 6)
	if notices:
		stack.add_child(notices)
	if not _notices().is_empty() and float(_state.get("noticesReadAt", 0)) < float(_dict(_notices().back()).get("at", 0)):
		engine.request("multiplayer.notices.read")
	var foot := PanelContainer.new()
	var foot_style := StyleBoxFlat.new()
	foot_style.bg_color = Color(0, 0, 0, 0)
	foot_style.border_color = SECTION_LINE
	foot_style.border_width_top = 1
	foot_style.content_margin_left = 21
	foot_style.content_margin_right = 21
	foot_style.content_margin_top = 11
	foot_style.content_margin_bottom = 14
	foot.add_theme_stylebox_override("panel", foot_style)
	var foot_stack := _column(0)
	foot.add_child(foot_stack)
	var busy_line := str(screen.get("busyLine", ""))
	if not busy_line.is_empty():
		var busy := _small(busy_line, PROBLEM)
		busy.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		foot_stack.add_child(CommunityKit.margin_below(busy, 7))
	var buttons := _right_row(8)
	_leave_button(buttons, "Stop sharing")
	if host and not lobby.is_empty() and not bool(lobby.get("started", false)):
		var starting := _pressed_start or bool(_engine_status().get("starting", false))
		var start := _button("Starting…" if starting else "Start the game", true)
		CommunityKit.set_idle(start, starting)
		start.pressed.connect(_start)
		buttons.add_child(start)
	foot_stack.add_child(buttons)
	frame.add_child(foot)
	_root = panel
	add_child(panel)
	_place_centre(panel, top, width)
	await get_tree().process_frame
	if is_instance_valid(scroll) and is_instance_valid(pad) and is_instance_valid(foot):
		var most := minf(view.y * 0.8, view.y - top - 16.0) - foot.get_combined_minimum_size().y
		scroll.custom_minimum_size.y = minf(pad.get_combined_minimum_size().y, maxf(80.0, most))


func _host_invite() -> Control:
	var token := str(_state.get("token", ""))
	if token.is_empty():
		return null
	var invite := _column(0)
	var seats: Variant = _settings().get("seats")
	invite.add_child(_small("Invite code: anyone who has it can join, up to %s players." % (_number_text(seats) if seats != null else "8")))
	var code_row := HBoxContainer.new()
	code_row.add_theme_constant_override("separation", 8)
	var code := PanelContainer.new()
	code.add_theme_stylebox_override("panel", UI.box(UiTheme.pick("overlay_card", CODE_BG), Color(0, 0, 0, 0), 8, 0, Vector4(10, 7, 10, 7)))
	code.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var code_text := UI.label(token, 12, INK, 400, "Consolas")
	code_text.clip_text = true
	code_text.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	code.add_child(code_text)
	code_row.add_child(code)
	var copy := _button("✓ Copied!" if _copied else "Copy")
	copy.pressed.connect(_copy_code)
	code_row.add_child(copy)
	var rotate := _button("New code")
	rotate.tooltip_text = "A new code: the old one stops working"
	rotate.pressed.connect(_control.bind("rotate", null))
	code_row.add_child(rotate)
	invite.add_child(_gap_top(code_row, 6))
	var relays := _dict(_engine_status().get("relays"))
	var relay_text := "Relays: connecting…"
	if _engine_status().has("relays") and _engine_status().get("relays") != null:
		relay_text = "Relays: %s of %s connected" % [_number_text(relays.get("connected", 0)), _number_text(relays.get("total", 0))]
	invite.add_child(_gap_top(_small(relay_text), 6))
	for entry in _array(_screen().get("peopleLines")):
		var person := _dict(entry)
		var text := str(person.get("text", ""))
		if not str(person.get("people", "")).is_empty():
			text += " " + str(person.get("people", ""))
		invite.add_child(_gap_top(_small(text, PROBLEM if person.get("problem", false) else Color(0, 0, 0, 0)), 6))
	return invite


func _copy_code() -> void:
	DisplayServer.clipboard_set(str(_state.get("token", "")))
	_copied = true
	_render()
	await get_tree().create_timer(1.5).timeout
	if is_instance_valid(self):
		_copied = false
		_render()


func _seat_state(seat: Dictionary, ready: Array) -> String:
	var status := str(seat.get("status", ""))
	if status == "human":
		return "Ready ✓" if ready.has(str(seat.get("country", ""))) else ""
	if status == "away":
		return "Away"
	if status == "watching":
		return "Watching"
	return "Away: the AI plays it" if bool(seat.get("held", false)) else "AI player"


func _in_hosts_hand(seat: Dictionary) -> bool:
	return bool(seat.get("held", false)) and not bool(seat.get("you", false)) and str(seat.get("status", "")) != "watching"


func _seat_list(holder: VBoxContainer, seats: Variant, ready: Array, host: bool, hands_only: bool) -> void:
	for entry in _array(seats):
		var seat := _dict(entry)
		if hands_only and not _in_hosts_hand(seat):
			continue
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 8)
		var country := UI.label(str(seat.get("country", "")), 14, INK)
		country.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		country.clip_text = true
		row.add_child(country)
		var who := str(seat.get("name", ""))
		row.add_child(UI.label("%s (you)" % who if bool(seat.get("you", false)) else who, 14, UiTheme.pick("muted", SMALL)))
		var tag := _seat_state(seat, ready)
		if not tag.is_empty():
			row.add_child(UI.label(tag, 12, UiTheme.pick("muted", SMALL)))
		if host and _in_hosts_hand(seat):
			_seat_actions(row, str(seat.get("country", "")))
		var pad := MarginContainer.new()
		pad.add_theme_constant_override("margin_top", 3)
		pad.add_theme_constant_override("margin_bottom", 3)
		pad.add_child(row)
		holder.add_child(pad)


func _seat_actions(row: HBoxContainer, country: String) -> void:
	if _banning == country:
		var ban := _button("Ban for good", false, {"ink": PROBLEM, "height": 26.0})
		ban.pressed.connect(_kick.bind(country, true))
		row.add_child(ban)
		var cancel := _button("Cancel", false, {"height": 26.0})
		cancel.pressed.connect(_set_banning.bind(""))
		row.add_child(cancel)
		return
	var release := _button("Release", false, {"height": 26.0})
	release.tooltip_text = "Anyone may take this country; its player can no longer come back to it"
	release.pressed.connect(_kick.bind(country, false))
	row.add_child(release)
	var ban_button := _button("Ban", false, {"height": 26.0})
	ban_button.tooltip_text = "Release this country and keep its player out of this game"
	ban_button.pressed.connect(_set_banning.bind(country))
	row.add_child(ban_button)


func _set_banning(country: String) -> void:
	_banning = country
	_render()


func _kick(country: String, ban: bool) -> void:
	_banning = ""
	var args := {"country": country}
	if ban:
		args["ban"] = true
	_control("kick", args)
	_render()


func _change_requests(holder: VBoxContainer) -> void:
	for entry in _array(_lobby().get("changes")):
		var change := _dict(entry)
		var from := str(change.get("from", ""))
		var who := str(change.get("name", "")) if not str(change.get("name", "")).is_empty() else from
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 8)
		var words := CommunityKit.para("%s (%s) asks to play %s." % [who, from, str(change.get("to", ""))], 14, INK, 400, 1.35)
		words.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(words)
		var allow := _button("Allow", true, {"height": 26.0})
		allow.pressed.connect(_control.bind("seat", {"op": "allow", "from": from}))
		row.add_child(allow)
		var refuse := _button("Refuse", false, {"height": 26.0})
		refuse.pressed.connect(_control.bind("seat", {"op": "refuse", "from": from}))
		row.add_child(refuse)
		var pad := MarginContainer.new()
		pad.add_theme_constant_override("margin_top", 4)
		pad.add_theme_constant_override("margin_bottom", 4)
		pad.add_child(row)
		holder.add_child(pad)


func _country_picker(asking: bool) -> Control:
	var holder := _column(0)
	var lobby := _lobby()
	var held := {}
	for entry in _array(lobby.get("seats")):
		var seat := _dict(entry)
		if bool(seat.get("held", false)):
			held[str(seat.get("country", ""))] = true
	var items: Array = [["Ask to play another country…" if asking else "Choose your country…", ""]]
	for country in _array(lobby.get("countries")):
		if not held.has(str(country)):
			items.append([str(country), str(country)])
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	var select := _select(items, _choice, _choose)
	select.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	select.custom_minimum_size.x = 0
	row.add_child(select)
	var take := _button("Ask the host" if asking else "Take it", true)
	CommunityKit.set_idle(take, _choice.is_empty())
	take.pressed.connect(_pick)
	row.add_child(take)
	holder.add_child(_gap_top(row, 12))
	if not str(_pick_status.get("text", "")).is_empty():
		holder.add_child(_gap_top(_small(str(_pick_status["text"]), PROBLEM if _pick_status.get("problem", false) else Color(0, 0, 0, 0)), 7))
	var answered := _dict(_screen().get("seatAnswer"))
	if not answered.is_empty() and not str(answered.get("text", "")).is_empty():
		holder.add_child(_gap_top(_small(str(answered["text"]), PROBLEM if str(answered.get("level", "")) == "warn" else Color(0, 0, 0, 0)), 5))
	return holder


func _choose(country: String) -> void:
	_choice = country
	_render()


func _replies_setting(at_end: bool) -> Control:
	if _lobby().is_empty() or _role() != "host":
		return null
	var mode := "own" if str(_settings().get("replies", "")) == "own" else "host"
	var row := CommunityKit.flow(8, 8)
	row.alignment = FlowContainer.ALIGNMENT_END if at_end else FlowContainer.ALIGNMENT_BEGIN
	var words := UI.label("AI countries answer with", 12, UiTheme.pick("muted", SMALL))
	words.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(words)
	row.add_child(_select([["Your AI key", "host"], ["Each player's own AI key", "own"]], mode, _set_replies, 12))
	return _gap_top(row, 8) if at_end else row


func _set_replies(mode: String) -> void:
	_control("replies", {"mode": mode})


func _host_answers_setting() -> Control:
	var value := int(_settings().get("hostAnswers", 0))
	var choices: Array = _array(_screen().get("hostAnswerChoices")).duplicate()
	var known := false
	for choice in choices:
		if int(choice) == value:
			known = true
	if not known:
		choices.append(value)
		choices.sort()
	var items: Array = []
	for choice in choices:
		items.append(["None" if int(choice) == 0 else str(int(choice)), str(int(choice))])
	var row := CommunityKit.flow(8, 8)
	var words := UI.label("Your AI's answers per player a round", 12, UiTheme.pick("muted", SMALL))
	words.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(words)
	row.add_child(_select(items, str(value), _set_host_answers, 12))
	return _gap_top(row, 6)


func _set_host_answers(count: String) -> void:
	_control("hostAnswers", {"count": int(count)})


func _game_master_log(holder: VBoxContainer) -> void:
	for entry in _array(_screen().get("gameMasterLog")):
		var log_entry := _dict(entry)
		var text := "%s %s" % [str(log_entry.get("head", "")), str(log_entry.get("summary", ""))]
		for line in _array(log_entry.get("lines")):
			text += " " + str(line)
		holder.add_child(_gap_top(_small(text), 4))


func _game_rules(holder: VBoxContainer) -> void:
	if _settings().is_empty():
		return
	var host := _role() == "host"
	var own := str(_settings().get("replies", "")) == "own"
	var changes := not _array(_screen().get("gameMasterLog")).is_empty()
	if not (host and own) and not changes:
		return
	var rules := _column(0)
	if host and own:
		rules.add_child(_host_answers_setting())
	if changes:
		rules.add_child(_gap_top(CommunityKit.margin_below(_small("GAME MASTER CHANGES"), 4), 11))
		_game_master_log(rules)
	holder.add_child(_gap_top(rules, 6))


func _game_master_changes(holder: VBoxContainer) -> void:
	if _array(_screen().get("gameMasterLog")).is_empty():
		return
	holder.add_child(_gap_top(CommunityKit.margin_below(_small("GAME MASTER CHANGES"), 4), 11))
	_game_master_log(holder)


func _game_master_box() -> Control:
	if _role() != "host" or not bool(_screen().get("gameMaster", false)):
		return null
	if not _gm_open:
		var open_button := _button("Game Master", false, {"pad": 14.0})
		open_button.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		open_button.pressed.connect(_set_gm_open.bind(true))
		return open_button
	var busy := bool(_engine_status().get("gameMasterBusy", false))
	var resolving := str(_round().get("phase", "")) == "resolving"
	var box := _column(6)
	var field := TextEdit.new()
	field.text = _gm_text
	field.placeholder_text = "What should change in the world?"
	field.custom_minimum_size.y = 72
	field.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	var style := UI.box(UiTheme.pick("overlay_card", Color(1, 1, 1, 0.05)), UiTheme.pick("glass_line", BUTTON_BORDER), 10, 1, Vector4(10, 8, 10, 8))
	field.add_theme_stylebox_override("normal", style)
	field.add_theme_stylebox_override("focus", style)
	field.add_theme_font_size_override("font_size", 13)
	field.add_theme_color_override("font_color", INK)
	field.text_changed.connect(_gm_typed.bind(field))
	box.add_child(field)
	var row := CommunityKit.flow(8, 8)
	var send := _button("The Game Master is at work…" if busy else "Change it", true, {"pad": 14.0})
	CommunityKit.set_idle(send, _gm_text.strip_edges().is_empty() or busy or resolving)
	send.pressed.connect(_gm_send)
	row.add_child(send)
	var close := _button("Close", false, {"pad": 14.0})
	close.pressed.connect(_set_gm_open.bind(false))
	row.add_child(close)
	var note := _small("Not while a round is being resolved." if resolving else "It changes the world at once, and every player is told what it changed.")
	note.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(CommunityKit.inline(note, row))
	box.add_child(row)
	var outcome := _dict(_screen().get("gmAnswer"))
	if not busy and not outcome.is_empty() and not str(outcome.get("text", "")).is_empty():
		box.add_child(_small(str(outcome["text"]), PROBLEM if str(outcome.get("level", "")) == "warn" else Color(0, 0, 0, 0)))
	return box


func _gm_typed(field: TextEdit) -> void:
	var most := int(_screen().get("gameMasterMax", 2000))
	if field.text.length() > most:
		field.text = field.text.left(most)
	var was_empty := _gm_text.strip_edges().is_empty()
	_gm_text = field.text
	if was_empty != _gm_text.strip_edges().is_empty():
		_render()


func _set_gm_open(open: bool) -> void:
	_gm_open = open
	_render()


func _gm_send() -> void:
	var text := _gm_text.strip_edges()
	if text.is_empty() or bool(_engine_status().get("gameMasterBusy", false)) or str(_round().get("phase", "")) == "resolving":
		return
	_gm_text = ""
	await _control("gm", {"command": text.left(int(_screen().get("gameMasterMax", 2000)))})
	_render()


func _game_master_mark(compact_mark: bool) -> Control:
	var text := str(_screen().get("gameMasterMark", ""))
	if text.is_empty():
		return null
	var chip := PanelContainer.new()
	chip.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0), UiTheme.pick("glass_line", MARK_LINE), 999, 1, Vector4(8, 2, 8, 2)))
	chip.add_child(UI.label("Game Master on" if compact_mark else text, 12, UiTheme.pick("muted", SMALL)))
	chip.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	chip.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	if compact_mark:
		chip.tooltip_text = text
	return chip


func _notice_list(read_at: float, limit: int) -> Control:
	var shown := _notices().slice(maxi(0, _notices().size() - limit))
	if shown.is_empty():
		return null
	shown.reverse()
	var holder := _column(0)
	holder.add_child(CommunityKit.margin_below(_small("NOTICES"), 4))
	for entry in shown:
		var notice := _dict(entry)
		var fresh := float(notice.get("at", 0)) > read_at
		var color := PROBLEM if str(notice.get("level", "")) == "warn" else (NEW_INK if fresh else UiTheme.pick("muted", SMALL))
		var words := CommunityKit.para(str(notice.get("text", "")), 12, color, 650 if fresh else 400, 1.45)
		holder.add_child(_gap_top(words, 3))
	return _gap_top(holder, 10)


func _leave_button(row: Container, label_text: String) -> void:
	if _role() != "host":
		var leave := _button("Leave")
		leave.pressed.connect(_leave)
		row.add_child(leave)
		return
	if not _stopping:
		var stop := _button(label_text)
		stop.pressed.connect(_set_stopping.bind(true))
		row.add_child(stop)
		return
	var sure := _button("Stop sharing for everyone", false, {"ink": PROBLEM})
	sure.pressed.connect(_leave)
	row.add_child(sure)
	var cancel := _button("Cancel")
	cancel.pressed.connect(_set_stopping.bind(false))
	row.add_child(cancel)


func _set_stopping(on: bool) -> void:
	_stopping = on
	_render()


func _section(content: Control) -> Control:
	var holder := PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0, 0, 0, 0)
	style.border_color = UiTheme.pick("glass_line", SECTION_LINE)
	style.border_width_top = 1
	style.content_margin_top = 10
	holder.add_theme_stylebox_override("panel", style)
	holder.add_child(content)
	return _gap_top(holder, 10)


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


func _round_clock() -> String:
	var current := _round()
	var phase := str(current.get("phase", ""))
	if phase == "resolving":
		return _clock_text(float(current.get("elapsedMs", 0)) + float(Time.get_ticks_msec() - _received_at))
	if bool(_screen().get("waitsForTheHost", false)) or bool(current.get("paused", false)):
		return str(_screen().get("clockWords", ""))
	if phase in ["planning", "countdown", "revealing"]:
		return _clock_text(_remaining_ms())
	return ""


func _dates_text() -> String:
	var dates := _dict(_screen().get("dates"))
	if dates.is_empty():
		return ""
	var lands := str(dates.get("lands", ""))
	if lands.is_empty():
		return str(dates.get("now", ""))
	if int(dates.get("days", 0)) == 1:
		return "%s → %s (1 day)" % [str(dates.get("now", "")), lands]
	return "%s → %s (%d days)" % [str(dates.get("now", "")), lands, int(dates.get("days", 0))]


func _bar_button(caption: String, chosen: bool) -> Button:
	return _button(caption, chosen, {"size": 12, "height": 28.0, "pad": 7.0 if _compact else 11.0})


func _badge(count: int, label_text: String) -> Control:
	if count <= 0:
		return null
	var chip := PanelContainer.new()
	chip.add_theme_stylebox_override("panel", UI.box(UiTheme.pick("accent", ACCENT), Color(0, 0, 0, 0), 999, 0, Vector4(5, 2, 5, 2)))
	var words := UI.label("9+" if count > 9 else str(count), 10, UiTheme.pick("bg", BADGE_INK), 800)
	words.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	chip.add_child(words)
	chip.custom_minimum_size = Vector2(16, 0)
	chip.tooltip_text = label_text
	chip.mouse_filter = Control.MOUSE_FILTER_IGNORE
	chip.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	return chip


func _with_inside(button: Button, parts: Array) -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var width := 0.0
	for part in parts:
		if part == null:
			continue
		var node := part as Control
		node.mouse_filter = Control.MOUSE_FILTER_IGNORE
		row.add_child(node)
		width += node.get_combined_minimum_size().x + 6.0
	row.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	button.add_child(row)
	button.custom_minimum_size.x = width - 6.0 + (14.0 if _compact else 22.0)


func _icon(svg: String, side: int, color: Color) -> TextureRect:
	var rect := TextureRect.new()
	rect.texture = UI.svg_texture(svg.replace("#fff'", "#" + color.to_html(false) + "'"), float(side) / 24.0, color.a)
	rect.custom_minimum_size = Vector2(side, side)
	rect.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
	rect.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	return rect


func _render_bar(me: String, watching: String) -> void:
	var current := _round()
	var screen := _screen()
	var role := _role()
	var host := role == "host"
	var phase := str(current.get("phase", ""))
	var planning := phase in ["planning", "countdown"]
	var waits := bool(screen.get("waitsForTheHost", false))
	var ready_list := _array(current.get("ready"))
	var is_ready := not me.is_empty() and ready_list.has(me)
	var status := _dict(screen.get("status"))
	var clock_words := bool(screen.get("clockInWords", false))
	if not _round_seen and not current.is_empty():
		_round_seen = true
		if not watching.is_empty() and _open.is_empty():
			_open = "players"
		elif host and bool(current.get("paused", false)) and watching.is_empty():
			_open = "host"
	if not host and _open == "host":
		_open = ""
	var view := get_viewport_rect().size
	var safe := UI.safe_insets()
	var surface := GlassPanel.new(UI.HUD_BG_STRONG, 12.0, Vector4(8, 3, 4, 3) if _compact else Vector4(14, 3, 5, 3), UI.HUD_BORDER).theme_as("glass_pill", "hud_border")
	surface.mouse_filter = Control.MOUSE_FILTER_STOP
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 4 if _compact else 7)
	line.custom_minimum_size.y = 31
	surface.add_child(line)
	var round_name := "Round %s · %s" % [_number_text(current.get("round")) if current.has("round") else "–", PHASES.get(phase, "…")]
	var round_label := UI.label("Round %s" % (_number_text(current.get("round")) if current.has("round") else "–") if _compact else round_name, 12, UiTheme.pick("text", BAR_INK), 750)
	round_label.tooltip_text = round_name
	round_label.mouse_filter = Control.MOUSE_FILTER_PASS
	if _compact:
		round_label.clip_text = true
		round_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		round_label.custom_minimum_size.x = minf(48.0, UI.font(750).get_string_size(round_label.text, HORIZONTAL_ALIGNMENT_LEFT, -1, 12).x)
	round_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	line.add_child(round_label)
	var clock := _round_clock()
	var show_clock := not clock.is_empty() and not clock_words and not (_compact and not status.is_empty())
	if show_clock:
		_clock_label = UI.label(clock, 12, BAR_MUTED if bool(current.get("paused", false)) else UiTheme.pick("text", BAR_INK))
		_clock_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		line.add_child(_clock_label)
	var dates := _dict(screen.get("dates"))
	if not _compact and not str(dates.get("lands", "")).is_empty():
		var lands := UI.label("Lands on %s" % str(dates.get("lands", "")), 11, UiTheme.pick("muted", SMALL))
		lands.tooltip_text = _dates_text()
		lands.mouse_filter = Control.MOUSE_FILTER_PASS
		lands.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		line.add_child(lands)
	var step := _dict(current.get("step"))
	if phase == "resolving" and not str(step.get("label", "")).is_empty():
		var step_label := UI.label(str(step.get("label", "")), 11, UiTheme.pick("muted", SMALL))
		step_label.clip_text = true
		step_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		if not _compact:
			step_label.custom_minimum_size.x = minf(224.0, UI.font(400).get_string_size(step_label.text, HORIZONTAL_ALIGNMENT_LEFT, -1, 11).x)
		step_label.tooltip_text = ("%s %s" % [str(step.get("label", "")), str(step.get("detail", ""))]).strip_edges()
		step_label.mouse_filter = Control.MOUSE_FILTER_PASS
		step_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		line.add_child(step_label)
	if not status.is_empty():
		var problem := bool(status.get("problem", false))
		var caption := str(status.get("short", "")) if _compact and not str(status.get("short", "")).is_empty() else str(status.get("label", ""))
		var mark := _button(caption, false, {"size": 11, "height": 24.0, "pad": 7.0 if _compact else 9.0, "ink": PROBLEM if problem else BAR_MUTED, "border": PROBLEM_LINE if problem else UiTheme.pick("glass_line", BUTTON_BORDER)})
		mark.tooltip_text = str(status.get("title", ""))
		mark.pressed.connect(_open_from_mark.bind(str(status.get("opens", "players"))))
		line.add_child(mark)
	if _compact:
		var spring := Control.new()
		spring.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		spring.mouse_filter = Control.MOUSE_FILTER_IGNORE
		line.add_child(spring)
	else:
		var gm_mark := _game_master_mark(true)
		if gm_mark:
			line.add_child(gm_mark)
	if planning and not me.is_empty() and not waits:
		var ready_button := _bar_button("Ready ✓" if is_ready else ("Ready" if _compact else "I'm ready"), is_ready)
		ready_button.pressed.connect(_say_ready.bind(is_ready))
		line.add_child(ready_button)
	var players_open := _open == "players"
	var unread := 0 if players_open else int(screen.get("unread", 0))
	var players := _bar_button("" if _compact else ("Players" if unread == 0 else ""), players_open)
	if _compact:
		players.tooltip_text = "Players"
		_with_inside(players, [_icon(PEOPLE_SVG, 16, UiTheme.pick("glass_active_text", PRIMARY_INK) if players_open else UiTheme.pick("text", INK)), _badge(unread, str(screen.get("unreadLabel", "")))])
	elif unread > 0:
		_with_inside(players, [UI.label("Players", 12, UiTheme.pick("text", INK), 650), _badge(unread, str(screen.get("unreadLabel", "")))])
	players.pressed.connect(_toggle.bind("players"))
	line.add_child(players)
	if host:
		var host_open := _open == "host"
		var asking := _array(_lobby().get("changes")).size()
		var host_button := _bar_button("", host_open)
		var ink := UiTheme.pick("glass_active_text", PRIMARY_INK) if host_open else UiTheme.pick("text", INK)
		var parts: Array = [UI.label("Host", 12, ink, 650), _badge(asking, str(screen.get("askingLabel", "")))]
		if not _compact:
			var chevron := _icon(CHEVRON_SVG, 12, ink)
			if host_open:
				chevron.flip_v = true
			parts.append(chevron)
		_with_inside(host_button, parts)
		host_button.pressed.connect(_toggle.bind("host"))
		line.add_child(host_button)
	_bar = surface
	add_child(surface)
	var top := (64.0 if _compact else 70.0) + safe.y
	var bar_left := 0.0
	var bar_width := 0.0
	if _compact:
		bar_left = 66.0 + safe.x
		bar_width = view.x - bar_left - 8.0 - safe.z
	else:
		bar_width = minf(view.x - 16.0, surface.get_combined_minimum_size().x)
		bar_left = (view.x - bar_width) * 0.5
	surface.position = Vector2(bar_left, top)
	surface.size = Vector2(bar_width, 37)
	var bar_bottom := top + maxf(37.0, surface.get_combined_minimum_size().y)
	if not _open.is_empty():
		_render_menu(me, watching, bar_left, bar_width, bar_bottom)
	var refused := str(_ready_refused.get("text", ""))
	var note_text := ""
	var note_problem := false
	if not refused.is_empty() and int(_ready_refused.get("round", 0)) == int(current.get("round", 0)) and planning:
		note_text = refused
		note_problem = true
	elif _open.is_empty():
		var latest := _dict(_notices().back()) if not _notices().is_empty() else {}
		if not latest.is_empty() and Time.get_unix_time_from_system() * 1000.0 - float(latest.get("at", 0)) < NOTICE_SHOWN_MS:
			note_text = str(latest.get("text", ""))
			note_problem = str(latest.get("level", "")) == "warn"
	if not note_text.is_empty():
		var note := GlassPanel.new(UI.HUD_BG_STRONG, 10.0, Vector4(11, 4, 11, 4), UI.HUD_BORDER).theme_as("glass_pill", "hud_border")
		note.mouse_filter = Control.MOUSE_FILTER_PASS
		var words := UI.label(note_text, 12, PROBLEM if note_problem else UiTheme.pick("muted", SMALL))
		words.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		words.clip_text = true
		words.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		note.add_child(words)
		note.tooltip_text = note_text
		_note = note
		add_child(note)
		var note_width := minf(bar_width, UI.font(400).get_string_size(note_text, HORIZONTAL_ALIGNMENT_LEFT, -1, 12).x + 24.0) if not _compact else bar_width
		note.position = Vector2(bar_left + (bar_width - note_width) * 0.5 if not _compact else bar_left, bar_bottom + 5.0)
		note.size = Vector2(note_width, 0)
	move_child(_bar, get_child_count() - 1)
	if is_instance_valid(_menu):
		move_child(_menu, get_child_count() - 1)
	if phase in ["planning", "countdown", "revealing", "resolving"] or not note_text.is_empty():
		_tick.start()


func _render_menu(me: String, watching: String, bar_left: float, bar_width: float, bar_bottom: float) -> void:
	var view := get_viewport_rect().size
	var safe := UI.safe_insets()
	var panel := GlassPanel.new(MENU_TINT, 14.0, Vector4(14, 12, 14, 14), UI.HUD_BORDER).theme_as("overlay_strong", "line")
	panel.mouse_filter = Control.MOUSE_FILTER_STOP
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	var stack := _column(0)
	stack.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(stack)
	panel.add_child(scroll)
	if _open == "players":
		_players_menu(stack, me, watching)
	else:
		_host_menu(stack)
	_menu = panel
	add_child(panel)
	var left_x := 0.0
	var width := 0.0
	if _compact:
		left_x = bar_left - 58.0 - safe.x
		width = bar_left + bar_width - left_x
	else:
		width = minf(416.0, view.x - 16.0)
		left_x = minf(bar_left + bar_width - width, view.x - 8.0 - width)
		left_x = maxf(8.0, left_x)
	var top := bar_bottom + 6.0
	panel.position = Vector2(left_x, top)
	panel.size = Vector2(width, 0)
	await get_tree().process_frame
	if is_instance_valid(scroll) and is_instance_valid(stack):
		scroll.custom_minimum_size.y = minf(stack.get_combined_minimum_size().y, view.y - 128.0 - safe.y - 26.0)
		panel.size = Vector2(width, 0)


func _round_lines(holder: VBoxContainer, me: String) -> void:
	var current := _round()
	var screen := _screen()
	var phase := str(current.get("phase", ""))
	var planning := phase in ["planning", "countdown"]
	var lines := _column(3)
	if not str(screen.get("cutOff", "")).is_empty():
		lines.add_child(_small(str(screen["cutOff"]), PROBLEM))
	if not current.is_empty() and planning and not bool(screen.get("waitsForTheHost", false)):
		lines.add_child(_small(str(screen.get("readyText", ""))))
	var dates := _dates_text()
	if not dates.is_empty():
		lines.add_child(_small(dates))
	var clock := _round_clock()
	if bool(screen.get("clockInWords", false)) and not clock.is_empty():
		lines.add_child(_small(clock))
	if current.get("failed") and not str(screen.get("failureText", "")).is_empty():
		lines.add_child(_small(str(screen["failureText"]), PROBLEM))
	var step := _dict(current.get("step"))
	if phase == "resolving" and not str(step.get("detail", "")).is_empty():
		lines.add_child(_small("%s %s" % [str(step.get("label", "")), str(step.get("detail", ""))]))
	if not str(screen.get("payerLine", "")).is_empty():
		lines.add_child(_small(str(screen["payerLine"])))
	if not str(screen.get("watchingText", "")).is_empty():
		lines.add_child(_small(str(screen["watchingText"])))
	var gm_mark := _game_master_mark(false)
	if gm_mark:
		lines.add_child(gm_mark)
	if me.is_empty() and lines.get_child_count() == 0:
		return
	holder.add_child(lines)


func _players_menu(stack: VBoxContainer, me: String, watching: String) -> void:
	var host := _role() == "host"
	_round_lines(stack, me)
	var seats := _column(0)
	_seat_list(seats, _lobby().get("seats", []), _array(_round().get("ready")), false, false)
	if (not host or not watching.is_empty()) and (not me.is_empty() or not watching.is_empty()):
		seats.add_child(_country_picker(not me.is_empty()))
	stack.add_child(_section(seats) if stack.get_child_count() > 0 else seats)
	var gm := _column(0)
	_game_master_changes(gm)
	if gm.get_child_count() > 0:
		stack.add_child(gm)
	var notices := _notice_list(_read_before, 20)
	if notices:
		stack.add_child(notices)
	if not host:
		var row := _right_row(6)
		_leave_button(row, "Leave")
		stack.add_child(_section(row))


func _host_menu(stack: VBoxContainer) -> void:
	var current := _round()
	var screen := _screen()
	var phase := str(current.get("phase", ""))
	var planning := phase in ["planning", "countdown"]
	var waits := bool(screen.get("waitsForTheHost", false))
	var head := _column(7)
	var clock := _round_clock()
	if bool(screen.get("clockInWords", false)) and not clock.is_empty():
		head.add_child(_small(clock))
	if current.get("failed") and not str(screen.get("failureText", "")).is_empty():
		head.add_child(_small(str(screen["failureText"]), PROBLEM))
	if not str(screen.get("busyLine", "")).is_empty():
		head.add_child(_small(str(screen["busyLine"]), PROBLEM))
	var row := CommunityKit.flow(7, 7)
	if planning and not waits:
		var paused := bool(current.get("paused", false))
		var pause := _button("Resume" if paused else "Pause", paused)
		pause.pressed.connect(_control.bind("resume" if paused else "pause", null))
		row.add_child(pause)
		var now := _button("End round now")
		now.pressed.connect(_control.bind("resolveNow", null))
		row.add_child(now)
	if current.get("failed") and planning:
		var again := _button("Try again now", true)
		again.pressed.connect(_control.bind("resolveNow", null))
		row.add_child(again)
	if current.get("failed") and str(_settings().get("payment", "")) == "cycle" and planning:
		var pay := _button("Pay it yourself", false, {"pad": 14.0})
		pay.pressed.connect(_control.bind("payRound", null))
		row.add_child(pay)
	if phase == "resolving":
		var cancel := _button("Cancel round")
		cancel.pressed.connect(_control.bind("cancelRound", null))
		row.add_child(cancel)
	if row.get_child_count() > 0:
		head.add_child(row)
	stack.add_child(head)
	var asking := not _array(_lobby().get("changes")).is_empty()
	var hands := false
	for entry in _array(_lobby().get("seats")):
		if _in_hosts_hand(_dict(entry)):
			hands = true
	if asking or hands:
		var seats := _column(0)
		seats.add_child(CommunityKit.margin_below(_small("PLAYERS"), 5))
		_change_requests(seats)
		_seat_list(seats, _lobby().get("seats", []), [], true, true)
		stack.add_child(_section(seats))
	var invite := _host_invite()
	if invite:
		stack.add_child(_section(invite))
	var answers := _column(0)
	var replies := _replies_setting(false)
	if replies:
		answers.add_child(replies)
	if str(_settings().get("replies", "")) == "own":
		answers.add_child(_host_answers_setting())
	var gm_box := _game_master_box()
	if gm_box:
		answers.add_child(_gap_top(gm_box, 9))
	stack.add_child(_section(answers))
	var leave_row := _right_row(6)
	_leave_button(leave_row, "Stop sharing")
	stack.add_child(_section(leave_row))


func _open_from_mark(which: String) -> void:
	if _open == which:
		return
	_toggle(which)


func _toggle(which: String) -> void:
	if _open == which:
		_open = ""
	else:
		if which == "players":
			_read_before = float(_state.get("noticesReadAt", 0))
			if int(_screen().get("unread", 0)) > 0:
				engine.request("multiplayer.notices.read")
		_open = which
	_render()


func _input(event: InputEvent) -> void:
	if _open.is_empty() or not visible:
		return
	if event is InputEventKey and (event as InputEventKey).pressed and (event as InputEventKey).keycode == KEY_ESCAPE:
		_open = ""
		_render()
		get_viewport().set_input_as_handled()
		return
	if event is InputEventMouseButton and (event as InputEventMouseButton).pressed:
		var at := (event as InputEventMouseButton).position
		var inside := false
		for node in [_bar, _menu]:
			if is_instance_valid(node) and (node as Control).get_global_rect().has_point(at):
				inside = true
		for child in get_children():
			if child is Window:
				inside = true
		if not inside and not _popup_open():
			_open = ""
			_render.call_deferred()


func _popup_open() -> bool:
	if not is_instance_valid(_menu):
		return false
	return _popup_in(_menu)


func _popup_in(node: Node) -> bool:
	if node is OptionButton and (node as OptionButton).get_popup().visible:
		return true
	for child in node.get_children():
		if _popup_in(child):
			return true
	return false


func _refresh_tick() -> void:
	if is_instance_valid(_clock_label):
		_clock_label.text = _round_clock()
	if is_instance_valid(_note) and _open.is_empty() and str(_ready_refused.get("text", "")).is_empty():
		var latest := _dict(_notices().back()) if not _notices().is_empty() else {}
		if latest.is_empty() or Time.get_unix_time_from_system() * 1000.0 - float(latest.get("at", 0)) >= NOTICE_SHOWN_MS:
			_render()


func _on_tick() -> void:
	_refresh_tick()


func _on_start_waited() -> void:
	_pressed_start = false
	if is_instance_valid(self):
		_render()


func _number_text(value: Variant) -> String:
	if value == null:
		return ""
	var number := float(value)
	return str(int(number)) if is_equal_approx(number, roundf(number)) else str(number)


func _request(kind: String, fields: Dictionary) -> Dictionary:
	var reply := await engine.request("multiplayer.request", {"t": kind, "fields": fields})
	return reply.get("result", {}) if reply.get("ok", false) and typeof(reply.get("result")) == TYPE_DICTIONARY else {"ok": false, "error": str(reply.get("error", ""))}


func _refusal(answer: Dictionary) -> String:
	var reason := str(answer.get("error", "")) if answer.get("error") != null else ""
	return str(REFUSAL_LABELS.get(reason, reason if not reason.is_empty() else "The host refused."))


func _pick() -> void:
	_pick_status = {"text": "", "problem": false}
	var answer: Dictionary = await _request("pick", {"country": _choice})
	if not is_instance_valid(self):
		return
	if not answer.get("ok", false):
		_pick_status = {"text": _refusal(answer), "problem": true}
	else:
		var result := _dict(answer.get("result"))
		if not str(result.get("asked", "")).is_empty():
			_pick_status = {"text": "You asked the host to let you play %s." % str(result["asked"]), "problem": false}
	_render()


func _change() -> void:
	_change_refused = ""
	var answer: Dictionary = await _request("unpick", {})
	if not is_instance_valid(self):
		return
	if not answer.get("ok", false):
		_change_refused = _refusal(answer)
	_render()


func _say_ready(was_ready: bool) -> void:
	var asked := int(_round().get("round", 0))
	_ready_refused = {"round": 0, "text": ""}
	var answer: Dictionary = await _request("ready", {"value": not was_ready})
	if not is_instance_valid(self):
		return
	if not answer.get("ok", false):
		var reason := str(answer.get("error", "")) if answer.get("error") != null else ""
		_ready_refused = {"round": asked, "text": reason if not reason.is_empty() else "The host did not take that."}
		_render()


func _start() -> void:
	_pressed_start = true
	_start_timer.start()
	_control("start", null)
	_render()


func _control(action: String, args: Variant = null) -> void:
	await engine.request("multiplayer.control", {"action": action, "args": args})


func _dismiss() -> void:
	_dismissed = true
	await engine.request("multiplayer.dismiss")
	if is_instance_valid(self):
		_render()


func _leave() -> void:
	await engine.request("multiplayer.leave")
	if not is_instance_valid(self):
		return
	_state = {}
	_reset_local()
	_render()
	left.emit()
