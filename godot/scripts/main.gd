extends Node

const ACCENT := Color("#2bc1f3")
const INK := Color("#e9e9ec")
const SOFT := Color("#a3a5ad")
const FAINT := Color("#6b6d74")
const PROBLEM := Color("#ff8a80")
const SKIPS := [["1 week", 7], ["1 month", 30], ["6 months", 182], ["1 year", 365]]
const PROVIDERS := {"gemini": "Google Gemini", "openai": "OpenAI", "anthropic": "Anthropic"}

var engine: EngineLink
var map_view: MapView
var ui: Control
var boot_panel: PanelContainer
var boot_label: Label
var library_panel: PanelContainer
var games_list: VBoxContainer
var library_status: Label
var hud: Control
var country_label: Label
var date_label: Label
var status_label: Label
var events_list: VBoxContainer
var region_panel: PanelContainer
var region_title: Label
var region_owner: Label
var skip_buttons: Array[Button] = []
var ai_panel: PanelContainer
var ai_provider: OptionButton
var ai_key: LineEdit
var ai_status: Label
var game_country := ""
var skipping := false


func _ready() -> void:
	get_tree().auto_accept_quit = false
	engine = EngineLink.new()
	add_child(engine)
	map_view = MapView.new()
	add_child(map_view)
	var layer := CanvasLayer.new()
	layer.layer = 10
	add_child(layer)
	ui = Control.new()
	ui.set_anchors_preset(Control.PRESET_FULL_RECT)
	ui.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ui.theme = _make_theme()
	layer.add_child(ui)
	_build_boot()
	_build_library()
	_build_hud()
	_build_ai_panel()
	_show(boot_panel)
	engine.engine_ready.connect(_on_engine_ready)
	engine.engine_stopped.connect(_on_engine_stopped)
	engine.engine_event.connect(_on_engine_event)
	map_view.region_clicked.connect(_on_region_clicked)
	map_view.bake_failed.connect(func(message: String) -> void: _set_status(message, true))
	if not engine.start():
		boot_label.text = "The game engine could not be started. Is Node.js installed?"


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST:
		engine.stop()
		get_tree().quit()
	elif what == NOTIFICATION_APPLICATION_FOCUS_IN and engine and engine.is_ready():
		engine.request("presence", {"visible": true})
	elif what == NOTIFICATION_APPLICATION_FOCUS_OUT and engine and engine.is_ready():
		engine.request("presence", {"visible": false})


func _make_theme() -> Theme:
	var theme := Theme.new()
	theme.default_font_size = 15
	var panel := StyleBoxFlat.new()
	panel.bg_color = Color("#17181ce8")
	panel.border_color = Color("#2a2c32")
	panel.set_border_width_all(1)
	panel.set_corner_radius_all(10)
	panel.set_content_margin_all(14)
	theme.set_stylebox("panel", "PanelContainer", panel)
	var card := panel.duplicate() as StyleBoxFlat
	card.bg_color = Color("#1f2025")
	card.set_content_margin_all(10)
	card.set_corner_radius_all(8)
	theme.set_type_variation("Card", "PanelContainer")
	theme.set_stylebox("panel", "Card", card)
	var normal := StyleBoxFlat.new()
	normal.bg_color = Color("#24262c")
	normal.border_color = Color("#34363d")
	normal.set_border_width_all(1)
	normal.set_corner_radius_all(8)
	normal.content_margin_left = 14
	normal.content_margin_right = 14
	normal.content_margin_top = 7
	normal.content_margin_bottom = 7
	var hover := normal.duplicate() as StyleBoxFlat
	hover.bg_color = Color("#2d3037")
	var pressed := normal.duplicate() as StyleBoxFlat
	pressed.bg_color = Color("#33363e")
	var disabled := normal.duplicate() as StyleBoxFlat
	disabled.bg_color = Color("#1c1d21")
	disabled.border_color = Color("#26282d")
	for state in [["normal", normal], ["hover", hover], ["pressed", pressed], ["disabled", disabled], ["focus", hover]]:
		theme.set_stylebox(state[0], "Button", state[1])
		theme.set_stylebox(state[0], "OptionButton", state[1])
	theme.set_color("font_color", "Button", INK)
	theme.set_color("font_hover_color", "Button", Color.WHITE)
	theme.set_color("font_pressed_color", "Button", Color.WHITE)
	theme.set_color("font_disabled_color", "Button", FAINT)
	var accent := normal.duplicate() as StyleBoxFlat
	accent.bg_color = ACCENT
	accent.border_color = ACCENT
	var accent_hover := accent.duplicate() as StyleBoxFlat
	accent_hover.bg_color = ACCENT.lightened(0.15)
	theme.set_type_variation("AccentButton", "Button")
	for state in [["normal", accent], ["hover", accent_hover], ["pressed", accent], ["focus", accent_hover]]:
		theme.set_stylebox(state[0], "AccentButton", state[1])
	theme.set_color("font_color", "AccentButton", Color("#0b0c0f"))
	theme.set_color("font_hover_color", "AccentButton", Color("#0b0c0f"))
	theme.set_color("font_pressed_color", "AccentButton", Color("#0b0c0f"))
	var field := normal.duplicate() as StyleBoxFlat
	field.bg_color = Color("#111215")
	theme.set_stylebox("normal", "LineEdit", field)
	theme.set_stylebox("focus", "LineEdit", field)
	theme.set_color("font_color", "Label", INK)
	theme.set_color("font_color", "LineEdit", INK)
	return theme


func _label(text: String, size := 15, color := INK) -> Label:
	var label := Label.new()
	label.text = text
	label.add_theme_font_size_override("font_size", size)
	label.add_theme_color_override("font_color", color)
	return label


func _button(text: String, accent := false) -> Button:
	var button := Button.new()
	button.text = text
	if accent:
		button.theme_type_variation = "AccentButton"
	return button


func _center(panel: Control, width: float, height: float) -> void:
	panel.custom_minimum_size = Vector2(width, height)


func _centered(panel: Control) -> Control:
	var holder := CenterContainer.new()
	holder.set_anchors_preset(Control.PRESET_FULL_RECT)
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.add_child(panel)
	return holder


func _build_boot() -> void:
	boot_panel = PanelContainer.new()
	_center(boot_panel, 520, 140)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 10)
	box.add_child(_label("Open Historia", 28))
	boot_label = _label("Starting the game engine…", 15, SOFT)
	boot_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	box.add_child(boot_label)
	boot_panel.add_child(box)
	ui.add_child(_centered(boot_panel))


func _build_library() -> void:
	library_panel = PanelContainer.new()
	_center(library_panel, 680, 560)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 12)
	box.add_child(_label("Open Historia", 30))
	box.add_child(_label("Your games", 17, SOFT))
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	games_list = VBoxContainer.new()
	games_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	games_list.add_theme_constant_override("separation", 8)
	scroll.add_child(games_list)
	box.add_child(scroll)
	library_status = _label("", 14, SOFT)
	library_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	box.add_child(library_status)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	var create := _button("New game", true)
	create.pressed.connect(_on_new_game)
	row.add_child(create)
	var ai := _button("AI connection")
	ai.pressed.connect(_open_ai_panel)
	row.add_child(ai)
	box.add_child(row)
	library_panel.add_child(box)
	ui.add_child(_centered(library_panel))


func _build_hud() -> void:
	hud = Control.new()
	hud.set_anchors_preset(Control.PRESET_FULL_RECT)
	hud.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ui.add_child(hud)

	var top := PanelContainer.new()
	top.set_anchors_preset(Control.PRESET_TOP_WIDE)
	top.offset_left = 12
	top.offset_right = -12
	top.offset_top = 12
	var bar := HBoxContainer.new()
	bar.add_theme_constant_override("separation", 14)
	country_label = _label("", 18)
	bar.add_child(country_label)
	date_label = _label("", 16, SOFT)
	bar.add_child(date_label)
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	bar.add_child(spacer)
	for skip in SKIPS:
		var button := _button(skip[0])
		var days: int = skip[1]
		button.pressed.connect(func() -> void: _skip(days))
		bar.add_child(button)
		skip_buttons.append(button)
	var home := _button("Library")
	home.pressed.connect(_back_to_library)
	bar.add_child(home)
	top.add_child(bar)
	hud.add_child(top)

	status_label = _label("", 14, SOFT)
	status_label.set_anchors_preset(Control.PRESET_TOP_LEFT)
	status_label.position = Vector2(26, 74)
	status_label.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.8))
	status_label.add_theme_constant_override("outline_size", 4)
	hud.add_child(status_label)

	var side := PanelContainer.new()
	side.set_anchors_preset(Control.PRESET_RIGHT_WIDE)
	side.offset_left = -372
	side.offset_right = -12
	side.offset_top = 76
	side.offset_bottom = -12
	var side_box := VBoxContainer.new()
	side_box.add_theme_constant_override("separation", 8)
	side_box.add_child(_label("Events", 17))
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	events_list = VBoxContainer.new()
	events_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	events_list.add_theme_constant_override("separation", 8)
	scroll.add_child(events_list)
	side_box.add_child(scroll)
	side.add_child(side_box)
	hud.add_child(side)

	region_panel = PanelContainer.new()
	region_panel.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	region_panel.offset_left = 12
	region_panel.offset_top = -96
	region_panel.offset_bottom = -12
	region_panel.offset_right = 340
	var region_box := VBoxContainer.new()
	region_title = _label("", 17)
	region_owner = _label("", 14, SOFT)
	region_box.add_child(region_title)
	region_box.add_child(region_owner)
	region_panel.add_child(region_box)
	region_panel.visible = false
	hud.add_child(region_panel)
	hud.visible = false


func _build_ai_panel() -> void:
	ai_panel = PanelContainer.new()
	_center(ai_panel, 460, 240)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 10)
	box.add_child(_label("AI connection", 20))
	ai_provider = OptionButton.new()
	for key in PROVIDERS:
		ai_provider.add_item(PROVIDERS[key])
		ai_provider.set_item_metadata(ai_provider.item_count - 1, key)
	box.add_child(ai_provider)
	ai_key = LineEdit.new()
	ai_key.secret = true
	ai_key.placeholder_text = "API key"
	box.add_child(ai_key)
	ai_status = _label("", 13, SOFT)
	box.add_child(ai_status)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	var save := _button("Save", true)
	save.pressed.connect(_save_ai)
	row.add_child(save)
	var close := _button("Close")
	close.pressed.connect(func() -> void: ai_panel.visible = false)
	row.add_child(close)
	box.add_child(row)
	ai_panel.add_child(box)
	ai_panel.visible = false
	ui.add_child(_centered(ai_panel))


func _show(panel: Control) -> void:
	for candidate in [boot_panel, library_panel]:
		candidate.visible = candidate == panel
	hud.visible = panel == hud
	map_view.visible = panel == hud


func _on_engine_ready(_info: Dictionary) -> void:
	await _refresh_library()


func _on_engine_stopped(message: String) -> void:
	_show(boot_panel)
	boot_label.text = message


func _refresh_library() -> void:
	_show(library_panel)
	library_status.text = ""
	var reply := await engine.request("library.list")
	for child in games_list.get_children():
		child.queue_free()
	if not reply.get("ok", false):
		library_status.text = str(reply.get("error", "The library could not be read."))
		return
	var games: Array = reply["result"].get("games", [])
	if games.is_empty():
		games_list.add_child(_label("No games yet.", 15, SOFT))
	for game in games:
		var card := PanelContainer.new()
		card.theme_type_variation = "Card"
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 12)
		var text := VBoxContainer.new()
		text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		text.add_child(_label(str(game.get("name", "")), 16))
		var details := [str(game.get("country", "")), str(game.get("gameDate", "")), str(game.get("scenarioName", ""))]
		text.add_child(_label(" · ".join(details.filter(func(part: String) -> bool: return not part.is_empty())), 13, SOFT))
		row.add_child(text)
		var play := _button("Play", true)
		var id := str(game.get("id", ""))
		play.pressed.connect(func() -> void: _open_game(id))
		row.add_child(play)
		card.add_child(row)
		games_list.add_child(card)


func _on_new_game() -> void:
	library_status.text = "Creating a game…"
	var reply := await engine.request("game.create", {"scenarioId": "default"})
	if not reply.get("ok", false):
		library_status.text = str(reply.get("error", "The game could not be created."))
		return
	await _open_game(str(reply["result"].get("id", "")))


func _open_game(id: String) -> void:
	library_status.text = "Opening the game…"
	var opened := await engine.request("game.open", {"id": id})
	if not opened.get("ok", false):
		library_status.text = str(opened.get("error", "The game could not be opened."))
		return
	var regions := await engine.request("map.regions")
	if not regions.get("ok", false):
		library_status.text = str(regions.get("error", "The map could not be read."))
		return
	library_status.text = "Drawing the map…"
	map_view.load_regions(str(regions["result"]["file"]))
	await map_view.baked
	var state := await engine.request("map.state")
	if state.get("ok", false):
		map_view.set_state(state["result"])
	_apply_view(opened["result"])
	_show(hud)
	map_view.focus_owner(game_country)


func _apply_view(view: Dictionary) -> void:
	game_country = str(view.get("country", ""))
	country_label.text = game_country
	date_label.text = _format_date(str(view.get("gameDate", "")))
	for child in events_list.get_children():
		child.queue_free()
	var events: Array = view.get("events", [])
	events.reverse()
	for event in events:
		events_list.add_child(_event_card(event))


func _format_date(iso: String) -> String:
	var parts := iso.split("-")
	if parts.size() < 3:
		return iso
	var months := ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
	var month := int(parts[1])
	if month < 1 or month > 12:
		return iso
	return "%d %s %s" % [int(parts[2]), months[month - 1], parts[0]]


func _event_card(event: Dictionary) -> Control:
	var card := PanelContainer.new()
	card.theme_type_variation = "Card"
	var box := VBoxContainer.new()
	box.add_child(_label(_format_date(str(event.get("date", ""))), 12, ACCENT if event.get("playerRelated", false) else FAINT))
	var title := _label(str(event.get("title", "")), 15)
	title.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	box.add_child(title)
	var description := _label(str(event.get("description", "")), 13, SOFT)
	description.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	box.add_child(description)
	card.add_child(box)
	return card


func _skip(days: int) -> void:
	if skipping:
		return
	skipping = true
	for button in skip_buttons:
		button.disabled = true
	_set_status("Starting the time skip…")
	var reply := await engine.request("skip", {"days": days})
	skipping = false
	for button in skip_buttons:
		button.disabled = false
	if not reply.get("ok", false):
		_set_status(str(reply.get("error", "The time skip failed.")), true)
		return
	_set_status("")
	_apply_view(reply["result"]["view"])
	var state := await engine.request("map.state")
	if state.get("ok", false):
		map_view.set_state(state["result"])


func _set_status(text: String, problem := false) -> void:
	status_label.text = text
	status_label.add_theme_color_override("font_color", PROBLEM if problem else SOFT)


func _on_engine_event(name: String, data: Variant) -> void:
	if name == "turn.progress" and typeof(data) == TYPE_DICTIONARY:
		var progress: Variant = data.get("progress")
		if typeof(progress) == TYPE_DICTIONARY:
			var label := str(progress.get("label", ""))
			var detail := str(progress.get("detail", ""))
			_set_status(label if detail.is_empty() else "%s — %s" % [label, detail])
	elif name == "turn.events" and typeof(data) == TYPE_DICTIONARY:
		for event in data.get("events", []):
			events_list.add_child(_event_card(event))
			events_list.move_child(events_list.get_child(events_list.get_child_count() - 1), 0)


func _on_region_clicked(index: int) -> void:
	map_view.select_region(index)
	if index < 0:
		region_panel.visible = false
		return
	region_title.text = map_view.region_name(index)
	var owner := map_view.region_owner(index)
	region_owner.text = owner if not owner.is_empty() else "Unclaimed"
	region_panel.visible = true


func _back_to_library() -> void:
	region_panel.visible = false
	await _refresh_library()


func _open_ai_panel() -> void:
	ai_panel.visible = true
	ai_key.text = ""
	var reply := await engine.request("settings.ai.get")
	if not reply.get("ok", false):
		ai_status.text = str(reply.get("error", ""))
		return
	var provider := str(reply["result"].get("provider", "gemini"))
	for index in range(ai_provider.item_count):
		if str(ai_provider.get_item_metadata(index)) == provider:
			ai_provider.select(index)
	ai_status.text = "A key is saved for this provider." if reply["result"].get("hasKey", false) else "No key saved yet."


func _save_ai() -> void:
	var provider := str(ai_provider.get_item_metadata(ai_provider.selected))
	var reply := await engine.request("settings.ai.set", {"provider": provider, "key": ai_key.text})
	ai_key.text = ""
	if not reply.get("ok", false):
		ai_status.text = str(reply.get("error", ""))
		return
	ai_status.text = "Saved."
