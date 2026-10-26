class_name LobbiesPage
extends VBoxContainer

signal enter_game
signal hosting_changed(open: bool)

const MAX_WIDTH := 992.0
const CARD_BG := Color("#12141a")
const CARD_BORDER := Color(1, 1, 1, 0.09)
const FIELD_BG := Color(1, 1, 1, 0.04)
const FIELD_BORDER := Color(1, 1, 1, 0.1)
const FIELD_INK := Color("#f8fafc")
const LABEL_INK := Color(1, 1, 1, 0.72)
const LEAD_INK := Color(1, 1, 1, 0.62)
const NOTE_INK := Color(1, 1, 1, 0.55)
const ERROR_INK := Color("#fca5a5")
const BUTTON_BG := Color(1, 1, 1, 0.06)
const BUTTON_BORDER := Color(1, 1, 1, 0.12)
const BUTTON_INK := Color(246 / 255.0, 246 / 255.0, 248 / 255.0, 0.94)
const PRIMARY_BG := Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.18)
const PRIMARY_BORDER := Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.55)
const PRIMARY_INK := Color("#e6f8ff")
const JOIN_NOTE := "The host and the services that connect you (public relay servers, and Google's and Cloudflare's address-lookup servers) see your network address. The game does not show it to other players, but anyone who has the invite code could find it out."
const HOST_NOTE := "Players connect straight to your computer: you and each player see each other's network address, and so do the services that connect you (public relay servers, and Google's and Cloudflare's address-lookup servers). The game does not show a player's address to other players, but anyone you give the invite code to could find it out, so share the code only with people you trust. Some strict networks (many mobile carriers) cannot connect this way."
const JOIN_NEEDS_WEBRTC := "Joining needs a WebRTC connection, which the native app cannot make yet."
const HOST_NEEDS_WEBRTC := "Hosting needs WebRTC and the shared-game engine, which the native app does not have yet."
const READY_SHARES := [["Half", 0.5], ["Two thirds", 2.0 / 3.0], ["Three quarters", 0.75], ["Everyone", 1.0]]

var engine: EngineLink
var context := {}
var hosting := false
var _state := {}
var _settings := {}
var _join_error := ""
var _host_error := ""
var _host_busy := false
var _code := ""
var _join_name := ""
var _host_name := ""
var _column: VBoxContainer
var _invite_card: PanelContainer
var _host_card: PanelContainer
var _public: PublicLobbies
var _invite_row: HFlowContainer
var _code_field: Control
var _name_field: Control
var _join_button: Button
var _host_grid: GridContainer


func _init() -> void:
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	add_theme_constant_override("separation", 0)
	_column = VBoxContainer.new()
	_column.add_theme_constant_override("separation", 18)
	_column.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	add_child(_column)
	add_child(CommunityKit.gap(48))
	resized.connect(_fit)


func setup(link: EngineLink, extra := {}) -> void:
	engine = link
	context = extra
	hosting = bool(extra.get("hosting", false))
	if not engine.engine_event.is_connected(_on_event):
		engine.engine_event.connect(_on_event)


func _exit_tree() -> void:
	if engine and engine.engine_event.is_connected(_on_event):
		engine.engine_event.disconnect(_on_event)


func _on_event(name: String, data: Variant) -> void:
	if name != "multiplayer.shared" or typeof(data) != TYPE_DICTIONARY:
		return
	_state["shared"] = data
	_restyle_join()


func open() -> void:
	await refresh()


func refresh() -> void:
	var reply := await engine.request("multiplayer.state")
	if not is_instance_valid(self):
		return
	if reply.get("ok", false):
		_state = reply["result"]
		if _settings.is_empty():
			_reset_settings()
		_join_name = str(_state.get("name", "")) if _join_name.is_empty() else _join_name
		_host_name = str(_state.get("name", "")) if _host_name.is_empty() else _host_name
	_render()


func make_host_button() -> Button:
	var button := UI.button("Host a lobby", "header")
	var content := HBoxContainer.new()
	content.alignment = BoxContainer.ALIGNMENT_CENTER
	content.add_theme_constant_override("separation", 7)
	content.mouse_filter = Control.MOUSE_FILTER_IGNORE
	content.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	content.add_child(CommunityKit.mark_rect("host", 15, UI.BUTTON_INK))
	var caption := UI.label("Host a lobby", 13, UI.BUTTON_INK, 600)
	caption.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	content.add_child(caption)
	button.text = ""
	button.add_child(content)
	button.custom_minimum_size.x = UI.font(600).get_string_size("Host a lobby", HORIZONTAL_ALIGNMENT_LEFT, -1, 13).x + 15 + 7 + 32
	button.pressed.connect(func() -> void: set_hosting(true))
	return button


func set_hosting(open: bool) -> void:
	if hosting == open:
		return
	hosting = open
	if open:
		_host_error = ""
		_host_busy = false
		_host_name = str(_state.get("name", ""))
		_reset_settings()
	hosting_changed.emit(open)
	_render()
	if open:
		refresh()


func _reset_settings() -> void:
	var defaults: Dictionary = _state.get("defaults", {})
	_settings = defaults.duplicate()
	var game: Variant = _state.get("activeGame")
	var game_name := str((game as Dictionary).get("name", "")) if typeof(game) == TYPE_DICTIONARY else ""
	var regex := RegEx.create_from_string("(?i)^(?:shared game:\\s*)+")
	var trimmed := regex.sub(game_name, "").strip_edges()
	_settings["name"] = trimmed if not trimmed.is_empty() else str(defaults.get("name", ""))


func _shared_mode() -> String:
	var shared: Dictionary = _state.get("shared", {})
	return str(shared.get("mode", "off"))


func _card() -> PanelContainer:
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", UI.box(CARD_BG, CARD_BORDER, 18, 1, Vector4(21, 19, 21, 19)))
	card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return card


func _heading(text: String) -> Label:
	return UI.label(text, 18, Color(1, 1, 1), 800)


func _lead(text: String) -> Label:
	return CommunityKit.para(text, 14, LEAD_INK, 400, 1.55)


func _note(text: String, color := NOTE_INK) -> Label:
	return CommunityKit.para(text, 12, color, 400, 1.5)


func _field_label(text: String) -> Label:
	var label := UI.label(text.to_upper(), 12, LABEL_INK, 600)
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	label.add_theme_constant_override("line_spacing", -2)
	return label


func _text_input(value: String, placeholder: String, max_length: int) -> LineEdit:
	var field := LineEdit.new()
	field.text = value
	field.placeholder_text = placeholder
	field.max_length = max_length
	field.custom_minimum_size.y = 40
	field.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var style := UI.box(FIELD_BG, FIELD_BORDER, 9, 1, Vector4(14, 0, 14, 0))
	field.add_theme_stylebox_override("normal", style)
	field.add_theme_stylebox_override("focus", style)
	field.add_theme_font_override("font", UI.font(400))
	field.add_theme_font_size_override("font_size", 14)
	field.add_theme_color_override("font_color", FIELD_INK)
	field.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.42))
	field.add_theme_color_override("caret_color", FIELD_INK)
	return field


func _button(caption: String, primary := false, height := 37.0) -> Button:
	return CommunityKit.pill_button(caption, {
		"bg": PRIMARY_BG if primary else BUTTON_BG,
		"border": PRIMARY_BORDER if primary else BUTTON_BORDER,
		"ink": PRIMARY_INK if primary else BUTTON_INK,
		"size": 13,
		"weight": 650,
		"height": height,
		"pad": 18.0,
	})


func _field(title: String, control: Control, hint := "") -> VBoxContainer:
	var holder := VBoxContainer.new()
	holder.add_theme_constant_override("separation", 0)
	holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	holder.add_child(CommunityKit.margin_below(_field_label(title), 6))
	holder.add_child(control)
	if not hint.is_empty():
		var words := _note(hint)
		var top := MarginContainer.new()
		top.add_theme_constant_override("margin_top", 6)
		top.add_child(words)
		holder.add_child(top)
	return holder


func _render() -> void:
	for child in _column.get_children():
		_column.remove_child(child)
		child.queue_free()
	_invite_card = _build_invite()
	_column.add_child(_invite_card)
	_host_card = null
	if hosting:
		_host_card = _build_host()
		_column.add_child(_host_card)
	_public = PublicLobbies.new()
	_public.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_column.add_child(_public)
	_fit.call_deferred()


func _fit() -> void:
	var width := minf(size.x, MAX_WIDTH)
	if width <= 0.0:
		return
	_column.custom_minimum_size.x = width
	if is_instance_valid(_invite_row):
		var inner := width - 42.0
		var button_width := _join_button.get_combined_minimum_size().x
		var spare := inner - 256.0 - 144.0 - button_width - 22.0
		if spare >= 0.0:
			_code_field.custom_minimum_size.x = 256.0 + spare * 0.75
			_name_field.custom_minimum_size.x = 144.0 + spare * 0.25
		else:
			_code_field.custom_minimum_size.x = inner
			_name_field.custom_minimum_size.x = inner
	if is_instance_valid(_host_grid):
		var inner_host := width - 42.0
		_host_grid.columns = max(1, int((inner_host + 14.0) / (192.0 + 14.0)))


func _build_invite() -> PanelContainer:
	var card := _card()
	var stack := VBoxContainer.new()
	stack.add_theme_constant_override("separation", 0)
	card.add_child(stack)
	stack.add_child(CommunityKit.margin_below(_heading("Join a private lobby"), 6))
	stack.add_child(CommunityKit.margin_below(_lead("Enter the invite code the host sent you. You will need the lobby's scenario in your library."), 16))
	_invite_row = CommunityKit.flow(11, 11)
	var code := _text_input(_code, "oh1-…", 0)
	code.text_changed.connect(func(value: String) -> void:
		_code = value
		_restyle_join())
	code.text_submitted.connect(func(_value: String) -> void: _join())
	_code_field = _field("Invite code", code)
	_code_field.size_flags_horizontal = Control.SIZE_FILL
	_invite_row.add_child(_code_field)
	var name := _text_input(_join_name, "Player", 40)
	name.text_changed.connect(func(value: String) -> void: _join_name = value)
	name.text_submitted.connect(func(_value: String) -> void: _join())
	_name_field = _field("Your name", name)
	_name_field.size_flags_horizontal = Control.SIZE_FILL
	_invite_row.add_child(_name_field)
	_join_button = _button("Join", true, 44.0)
	_join_button.size_flags_vertical = Control.SIZE_SHRINK_END
	_join_button.pressed.connect(_join)
	var join_holder := VBoxContainer.new()
	join_holder.alignment = BoxContainer.ALIGNMENT_END
	join_holder.size_flags_vertical = Control.SIZE_FILL
	join_holder.add_child(_join_button)
	_invite_row.add_child(join_holder)
	stack.add_child(_invite_row)
	_restyle_join()
	var note := MarginContainer.new()
	note.add_theme_constant_override("margin_top", 13)
	note.add_child(_note(JOIN_NOTE))
	stack.add_child(note)
	if not _join_error.is_empty():
		var problem := MarginContainer.new()
		problem.add_theme_constant_override("margin_top", 11)
		problem.add_child(CommunityKit.para(_join_error, 13, ERROR_INK, 400, 1.4))
		stack.add_child(problem)
	return card


func _restyle_join() -> void:
	if not is_instance_valid(_join_button):
		return
	if not _state.get("webrtc", false):
		UI.set_disabled_look(_join_button, JOIN_NEEDS_WEBRTC)
		return
	var idle := _code.strip_edges().is_empty() or _shared_mode() != "off"
	_join_button.disabled = idle
	_join_button.tooltip_text = ""
	_join_button.mouse_default_cursor_shape = Control.CURSOR_ARROW if idle else Control.CURSOR_POINTING_HAND


func _join() -> void:
	if not _state.get("webrtc", false) or _code.strip_edges().is_empty() or _shared_mode() != "off":
		return
	_join_error = ""
	var reply := await engine.request("multiplayer.join", {"token": _code, "name": _join_name})
	if not is_instance_valid(self):
		return
	if reply.get("ok", false):
		enter_game.emit()
		return
	_join_error = str(reply.get("error", ""))
	_render()


func _build_host() -> PanelContainer:
	var card := _card()
	var stack := VBoxContainer.new()
	stack.add_theme_constant_override("separation", 0)
	card.add_child(stack)
	stack.add_child(CommunityKit.margin_below(_heading("Host a lobby"), 6))
	stack.add_child(CommunityKit.margin_below(_lead("Your lobby is the game you have open. You keep playing your own country; players you send the invite code to take others. Your computer runs the game and pays for its AI with your key."), 16))
	var game: Variant = _state.get("activeGame")
	var has_game := typeof(game) == TYPE_DICTIONARY
	_host_grid = null
	if not has_game:
		stack.add_child(_note("Open a game first (the Games tab), then come back to host it."))
	else:
		_host_grid = GridContainer.new()
		_host_grid.columns = 4
		_host_grid.add_theme_constant_override("h_separation", 14)
		_host_grid.add_theme_constant_override("v_separation", 14)
		var host_name := _text_input(_host_name, "Host", 40)
		host_name.text_changed.connect(func(value: String) -> void: _host_name = value)
		_host_grid.add_child(_field("Your name", host_name))
		var lobby_name := _text_input(str(_settings.get("name", "")), "", 60)
		lobby_name.text_changed.connect(func(value: String) -> void: _settings["name"] = value)
		_host_grid.add_child(_field("Lobby name", lobby_name))
		_host_grid.add_child(_seats_field())
		_host_grid.add_child(_field("Round length (minutes)", _number("roundMinutes", 1, 10080)))
		_host_grid.add_child(_field("Ready share to start the countdown", _ready_select(), "When this share of players is ready, the countdown starts."))
		_host_grid.add_child(_field("Countdown (seconds)", _number("countdownSeconds", 0, 3600)))
		_host_grid.add_child(_field("Game time per round (days)", _number("daysPerRound", 1, 3650)))
		_host_grid.add_child(_field("A leaver's country waits (minutes)", _number("leaverGraceMinutes", 0, 1440), "Then the AI plays it until they come back."))
		stack.add_child(_host_grid)
		var check_row := MarginContainer.new()
		check_row.add_theme_constant_override("margin_top", 14)
		var check := CommunityKit.checkbox("Players may join a game already under way, taking a country the AI plays")
		check.button_pressed = bool(_settings.get("allowMidGameJoin", true))
		check.toggled.connect(func(on: bool) -> void: _settings["allowMidGameJoin"] = on)
		check_row.add_child(check)
		stack.add_child(check_row)
		var note := MarginContainer.new()
		note.add_theme_constant_override("margin_top", 13)
		note.add_child(_note(HOST_NOTE))
		stack.add_child(note)
	var buttons := HBoxContainer.new()
	buttons.add_theme_constant_override("separation", 10)
	var holder := MarginContainer.new()
	holder.add_theme_constant_override("margin_top", 16)
	holder.add_child(buttons)
	if has_game:
		var open := _button("Opening…" if _host_busy else "Open the lobby", true)
		if not (_state.get("webrtc", false) and _state.get("hostEngine", false)):
			UI.set_disabled_look(open, HOST_NEEDS_WEBRTC)
		else:
			open.disabled = _host_busy or _shared_mode() != "off"
			open.pressed.connect(_open_lobby)
		buttons.add_child(open)
	var cancel := _button("Cancel")
	cancel.pressed.connect(func() -> void: set_hosting(false))
	buttons.add_child(cancel)
	stack.add_child(holder)
	if _host_busy and _host_error.is_empty():
		var busy := MarginContainer.new()
		busy.add_theme_constant_override("margin_top", 13)
		busy.add_child(_note("Starting the game on this computer. If it is busy with something else, this can take a minute or two."))
		stack.add_child(busy)
	if not _host_error.is_empty():
		var problem := MarginContainer.new()
		problem.add_theme_constant_override("margin_top", 11)
		problem.add_child(CommunityKit.para(_host_error, 13, ERROR_INK, 400, 1.4))
		stack.add_child(problem)
	return card


func _number(key: String, low: int, high: int) -> SpinBox:
	var spin := SpinBox.new()
	spin.min_value = low
	spin.max_value = high
	spin.step = 1
	spin.rounded = true
	spin.value = float(_settings.get(key, low))
	spin.custom_minimum_size.y = 40
	spin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var line := spin.get_line_edit()
	var style := UI.box(FIELD_BG, FIELD_BORDER, 9, 1, Vector4(14, 0, 14, 0))
	line.add_theme_stylebox_override("normal", style)
	line.add_theme_stylebox_override("focus", style)
	line.add_theme_font_override("font", UI.font(400))
	line.add_theme_font_size_override("font_size", 14)
	line.add_theme_color_override("font_color", FIELD_INK)
	CommunityKit.bare_spinbox(spin)
	spin.value_changed.connect(func(value: float) -> void: _settings[key] = int(value))
	return spin


func _ready_select() -> OptionButton:
	var select := OptionButton.new()
	var current := float(_settings.get("readyThreshold", 2.0 / 3.0))
	var picked := 1
	for index in range(READY_SHARES.size()):
		select.add_item(str(READY_SHARES[index][0]))
		if absf(float(READY_SHARES[index][1]) - current) < 0.0001:
			picked = index
	select.selected = picked
	select.focus_mode = Control.FOCUS_NONE
	select.custom_minimum_size.y = 40
	var style := UI.box(FIELD_BG, FIELD_BORDER, 9, 1, Vector4(14, 0, 14, 0))
	for state in ["normal", "hover", "pressed", "focus"]:
		select.add_theme_stylebox_override(state, style)
	select.add_theme_font_override("font", UI.font(400))
	select.add_theme_font_size_override("font_size", 14)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
		select.add_theme_color_override(name, FIELD_INK)
	var popup := select.get_popup()
	popup.add_theme_stylebox_override("panel", UI.box(Color("#1f1f23"), Color(1, 1, 1, 0.12), 8, 1, Vector4(4, 4, 4, 4)))
	popup.add_theme_color_override("font_color", Color("#f4f4f5"))
	select.item_selected.connect(func(index: int) -> void: _settings["readyThreshold"] = float(READY_SHARES[index][1]))
	return select


func _seats_field() -> VBoxContainer:
	var max_seats := int(_state.get("maxSeats", 64))
	var seats_now := int(_state.get("seatsNow", 8))
	var slider := HSlider.new()
	slider.min_value = 2
	slider.max_value = max_seats
	slider.step = 1
	slider.value = float(_settings.get("seats", seats_now))
	slider.custom_minimum_size.y = 40
	slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	slider.focus_mode = Control.FOCUS_NONE
	CommunityKit.chrome_slider(slider)
	var holder := _field("Players: %d" % int(_settings.get("seats", seats_now)), slider, "Up to %d for now; up to %d is coming later." % [seats_now, max_seats])
	var title := (holder.get_child(0) as MarginContainer).get_child(0) as Label
	slider.value_changed.connect(func(value: float) -> void:
		var clamped: int = mini(seats_now, int(value))
		_settings["seats"] = clamped
		if int(slider.value) != clamped:
			slider.set_value_no_signal(clamped)
		title.text = ("Players: %d" % clamped).to_upper())
	return holder


func _open_lobby() -> void:
	_host_busy = true
	_host_error = ""
	_render()
	var reply := await engine.request("multiplayer.host", {"settings": _settings, "name": _host_name})
	if not is_instance_valid(self):
		return
	_host_busy = false
	if reply.get("ok", false):
		set_hosting(false)
		enter_game.emit()
		return
	_host_error = str(reply.get("error", ""))
	_render()
