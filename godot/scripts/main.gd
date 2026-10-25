extends Node

const PROVIDERS := {"gemini": "Gemini — Google AI Studio / Gemini API", "openai": "OpenAI", "anthropic": "Anthropic"}

var engine: EngineLink
var map_view: MapView
var ui: Control
var boot: Control
var boot_label: Label
var menu: MainMenu
var hud: Hud
var picker: CountryPicker
var settings: Control
var settings_provider: OptionButton
var settings_key: LineEdit
var settings_status: Label
var popup: GlassPanel
var popup_title: Label
var popup_owner: Label
var info := {}
var library := {}
var game_id := ""
var game_name := ""
var creating_id := ""
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
	ui.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	ui.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(ui)
	hud = Hud.new()
	ui.add_child(hud)
	_build_popup()
	menu = MainMenu.new()
	ui.add_child(menu)
	picker = CountryPicker.new()
	picker.map_view = map_view
	ui.add_child(picker)
	picker.visible = false
	_build_settings()
	_build_boot()
	_show("boot")
	engine.engine_ready.connect(_on_engine_ready)
	engine.engine_stopped.connect(func(message: String) -> void:
		_show("boot")
		boot_label.text = message)
	engine.engine_event.connect(_on_engine_event)
	menu.play_game.connect(_open_game)
	menu.start_scenario.connect(_start_scenario)
	menu.open_settings.connect(_open_settings)
	menu.refresh_requested.connect(_refresh_library)
	hud.exit_game.connect(_exit_game)
	hud.open_menu.connect(_open_settings)
	hud.skip_requested.connect(_skip)
	hud.auto_skip_requested.connect(_auto_skip)
	picker.chosen.connect(_on_country_chosen)
	picker.cancelled.connect(_on_picker_cancelled)
	map_view.region_clicked.connect(_on_region_clicked)
	map_view.bake_failed.connect(func(message: String) -> void: menu.set_status(message, true))
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


func _build_boot() -> void:
	boot = ColorRect.new()
	(boot as ColorRect).color = UI.PAGE
	boot.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var centre := CenterContainer.new()
	centre.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var column := VBoxContainer.new()
	column.alignment = BoxContainer.ALIGNMENT_CENTER
	column.add_theme_constant_override("separation", 14)
	var mark := TextureRect.new()
	mark.texture = UI.logo()
	mark.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	mark.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	mark.custom_minimum_size = Vector2(96, 96)
	column.add_child(mark)
	boot_label = UI.label("Starting the game engine…", 13, UI.SOFT)
	boot_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	boot_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	boot_label.custom_minimum_size.x = 520
	column.add_child(boot_label)
	centre.add_child(column)
	boot.add_child(centre)
	ui.add_child(boot)


func _build_popup() -> void:
	popup = GlassPanel.new(UI.HUD_BG_STRONG, 12, Vector4(14, 10, 14, 11))
	popup.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 2)
	popup_title = UI.label("", 14, UI.WHITE, 700)
	popup_owner = UI.label("", 12, Color(1, 1, 1, 0.6))
	column.add_child(popup_title)
	column.add_child(popup_owner)
	popup.add_child(column)
	popup.visible = false
	hud.add_child(popup)


func _build_settings() -> void:
	settings = Control.new()
	settings.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.55)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	settings.add_child(dim)
	var centre := CenterContainer.new()
	centre.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	settings.add_child(centre)
	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(420, 0)
	var style := UI.box(Color8(30, 31, 35, 252), Color(1, 1, 1, 0.12), 14, 1, Vector4(20, 18, 20, 18))
	UI.shadowed(style, Color(0, 0, 0, 0.5), 24, Vector2(0, 18))
	panel.add_theme_stylebox_override("panel", style)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 10)
	column.add_child(UI.label("Set up your AI provider", 17, UI.WHITE, 800))
	column.add_child(UI.wrapped("Open Historia writes every turn, advisor reply and diplomatic message with an AI model. Paste your details below and you are ready to play.", 12, Color(1, 1, 1, 0.65)))
	column.add_child(UI.label("PROVIDER", 10, Color(1, 1, 1, 0.55), 700, "Arial", 1))
	settings_provider = OptionButton.new()
	for key in PROVIDERS:
		settings_provider.add_item(PROVIDERS[key])
		settings_provider.set_item_metadata(settings_provider.item_count - 1, key)
	settings_provider.custom_minimum_size.y = 32
	settings_provider.add_theme_stylebox_override("normal", UI.box(Color(0, 0, 0, 0.3), Color(1, 1, 1, 0.14), 7, 1, Vector4(10, 0, 10, 0)))
	settings_provider.add_theme_font_size_override("font_size", 12)
	column.add_child(settings_provider)
	column.add_child(UI.label("API KEY", 10, Color(1, 1, 1, 0.55), 700, "Arial", 1))
	settings_key = LineEdit.new()
	settings_key.secret = true
	settings_key.placeholder_text = "Paste your API key"
	settings_key.custom_minimum_size.y = 32
	settings_key.add_theme_stylebox_override("normal", UI.box(Color(0, 0, 0, 0.3), Color(1, 1, 1, 0.14), 7, 1, Vector4(10, 0, 10, 0)))
	settings_key.add_theme_stylebox_override("focus", UI.box(Color(0, 0, 0, 0.35), Color(1, 1, 1, 0.26), 7, 1, Vector4(10, 0, 10, 0)))
	settings_key.add_theme_font_size_override("font_size", 12)
	column.add_child(settings_key)
	settings_status = UI.label("", 11, Color(1, 1, 1, 0.5))
	column.add_child(settings_status)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	row.add_child(UI.spacer())
	var later := UI.button("Not now", "small")
	later.pressed.connect(func() -> void: settings.visible = false)
	row.add_child(later)
	var save := UI.button("Save", "accent")
	save.custom_minimum_size.y = 32
	save.pressed.connect(_save_settings)
	row.add_child(save)
	column.add_child(row)
	panel.add_child(column)
	centre.add_child(panel)
	settings.visible = false
	ui.add_child(settings)


func _show(screen: String) -> void:
	boot.visible = screen == "boot"
	menu.visible = screen == "menu"
	hud.visible = screen == "game"
	map_view.visible = screen == "game" or picker.visible
	map_view.input_enabled = screen == "game"
	map_view.set_overlays_visible(screen == "game")
	if screen != "game":
		popup.visible = false


func _on_engine_ready(_data: Dictionary) -> void:
	var hello := await engine.request("hello")
	if hello.get("ok", false):
		info = hello["result"]
		menu.set_origin(str(info.get("origin", "")))
		map_view.basemap.cache_dir = str(info.get("dataRoot", "")).path_join("native-cache").path_join("tiles")
	await _refresh_library()
	_show("menu")


func _refresh_library() -> void:
	var reply := await engine.request("library.list")
	if not reply.get("ok", false):
		menu.set_status(str(reply.get("error", "The library could not be read.")), true)
		return
	library = reply["result"]
	menu.set_status("")
	menu.set_library(library)


func _game_named(id: String) -> Dictionary:
	for game in library.get("games", []):
		if str(game.get("id", "")) == id:
			return game
	return {}


func _load_map() -> bool:
	var regions := await engine.request("map.regions")
	if not regions.get("ok", false):
		menu.set_status(str(regions.get("error", "The map could not be read.")), true)
		return false
	map_view.load_regions(str(regions["result"]["file"]))
	await map_view.baked
	var state := await engine.request("map.state")
	if state.get("ok", false):
		map_view.set_state(state["result"])
	var cities := await engine.request("map.cities")
	if cities.get("ok", false):
		map_view.set_cities(cities["result"].get("cities", []))
	return true


func _open_game(id: String) -> void:
	menu.set_status("Opening the game…")
	var opened := await engine.request("game.open", {"id": id})
	if not opened.get("ok", false):
		menu.set_status(str(opened.get("error", "The game could not be opened.")), true)
		return
	if not await _load_map():
		return
	await _refresh_library()
	game_id = id
	game_name = str(_game_named(id).get("name", ""))
	await _enter_game(opened["result"])


func _enter_game(view: Dictionary) -> void:
	hud.set_game(view, game_name)
	var flag := await engine.request("game.flag", {"country": str(view.get("country", ""))})
	if flag.get("ok", false):
		hud.set_flag(UI.flag(str(flag["result"].get("flag", "")), 48))
	menu.set_status("")
	_show("game")
	map_view.focus_owner(str(view.get("country", "")))


func _start_scenario(scenario_id: String) -> void:
	menu.set_status("Preparing the map…")
	var created := await engine.request("game.create", {"scenarioId": scenario_id})
	if not created.get("ok", false):
		menu.set_status(str(created.get("error", "The game could not be created.")), true)
		return
	creating_id = str(created["result"].get("id", ""))
	if not await _load_map():
		return
	var countries := await engine.request("countries.list")
	if not countries.get("ok", false):
		menu.set_status(str(countries.get("error", "")), true)
		return
	var view := await engine.request("game.view")
	var scenario_name := ""
	for scenario in library.get("scenarios", []):
		if str(scenario.get("id", "")) == scenario_id:
			scenario_name = str(scenario.get("name", ""))
	picker.default_country = str(view.get("result", {}).get("country", ""))
	picker.set_scenario_name(scenario_name)
	picker.visible = true
	picker.open(countries["result"].get("countries", []), countries["result"].get("difficulties", []), map_view.owner_names())
	map_view.visible = true
	menu.set_status("")


func _on_country_chosen(country: String, difficulty: String) -> void:
	picker.visible = false
	menu.set_status("Starting the game…")
	var updated := await engine.request("game.update", {"id": creating_id, "country": country, "difficulty": difficulty})
	if not updated.get("ok", false):
		menu.set_status(str(updated.get("error", "")), true)
		return
	await _refresh_library()
	game_id = creating_id
	game_name = str(_game_named(game_id).get("name", ""))
	creating_id = ""
	map_view.select_region(-1)
	await _enter_game(updated["result"])


func _on_picker_cancelled() -> void:
	picker.visible = false
	map_view.select_region(-1)
	if not creating_id.is_empty():
		await engine.request("game.delete", {"id": creating_id})
		creating_id = ""
	await _refresh_library()
	_show("menu")


func _exit_game() -> void:
	await _refresh_library()
	_show("menu")


func _skip(days: float) -> void:
	if skipping:
		return
	skipping = true
	hud.set_busy(true)
	hud.clear_events()
	hud.open_events()
	hud.set_status("Starting the time skip…")
	var reply := await engine.request("skip", {"days": days})
	await _after_skip(reply)


func _auto_skip() -> void:
	if skipping:
		return
	skipping = true
	hud.set_busy(true)
	hud.clear_events()
	hud.open_events()
	hud.set_status("Starting the auto-jump…")
	var reply := await engine.request("skip.auto")
	await _after_skip(reply)


func _after_skip(reply: Dictionary) -> void:
	skipping = false
	hud.set_busy(false)
	if not reply.get("ok", false):
		hud.set_status(str(reply.get("error", "The time skip failed.")), true)
		return
	hud.set_status("")
	hud.set_game(reply["result"]["view"], game_name)
	var state := await engine.request("map.state")
	if state.get("ok", false):
		map_view.set_state(state["result"])


func _on_engine_event(name: String, data: Variant) -> void:
	if typeof(data) != TYPE_DICTIONARY:
		return
	if name == "turn.progress":
		var progress: Variant = data.get("progress")
		if typeof(progress) == TYPE_DICTIONARY:
			var label := str(progress.get("label", ""))
			var detail := str(progress.get("detail", ""))
			hud.set_status(label if detail.is_empty() else "%s — %s" % [label, detail])
	elif name == "turn.events":
		hud.add_live_events(data.get("events", []))


func _on_region_clicked(index: int) -> void:
	map_view.select_region(index)
	if index < 0:
		popup.visible = false
		return
	popup_title.text = map_view.region_name(index)
	var owner := map_view.region_owner(index)
	popup_owner.text = owner if not owner.is_empty() else "Unclaimed"
	popup.visible = true
	popup.reset_size()
	var mouse := get_viewport().get_mouse_position()
	popup.position = (mouse + Vector2(14, 14)).clamp(Vector2(8, 80), get_viewport().get_visible_rect().size - popup.size - Vector2(8, 90))


func _open_settings() -> void:
	settings.visible = true
	settings_key.text = ""
	var reply := await engine.request("settings.ai.get")
	if not reply.get("ok", false):
		settings_status.text = str(reply.get("error", ""))
		return
	var provider := str(reply["result"].get("provider", "gemini"))
	for index in range(settings_provider.item_count):
		if str(settings_provider.get_item_metadata(index)) == provider:
			settings_provider.select(index)
	settings_status.text = "A key is saved for this provider." if reply["result"].get("hasKey", false) else "No key saved yet."


func _save_settings() -> void:
	var provider := str(settings_provider.get_item_metadata(settings_provider.selected))
	var reply := await engine.request("settings.ai.set", {"provider": provider, "key": settings_key.text})
	settings_key.text = ""
	if not reply.get("ok", false):
		settings_status.text = str(reply.get("error", ""))
		return
	settings.visible = false
