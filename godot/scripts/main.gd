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
var info := {}
var library := {}
var game_id := ""
var game_name := ""
var picking_scenario := ""
var sound: Node
var in_game := false
var last_activity := 0
var background_timer: Timer


func _ready() -> void:
	get_tree().auto_accept_quit = false
	get_window().title = "Open Historia"
	var mark := Image.load_from_file(UI.repo_path("public/icon-192.png"))
	if mark:
		DisplayServer.set_icon(mark)
	engine = EngineLink.new()
	add_child(engine)
	sound = _make_node("res://scripts/audio/sound_engine.gd")
	if sound:
		add_child(sound)
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
	hud.setup(engine, map_view)
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
	menu.engine = engine
	menu.game_left.connect(func(id: String) -> void:
		if id == game_id:
			in_game = false)
	hud.exit_game.connect(_exit_game)
	hud.open_menu.connect(_open_settings)
	hud.turn_landed.connect(_on_turn_landed)
	picker.start.connect(_on_picker_start)
	picker.cancelled.connect(_on_picker_cancelled)
	map_view.bake_failed.connect(func(message: String) -> void: menu.set_status(message, true))
	background_timer = Timer.new()
	background_timer.wait_time = 60.0
	background_timer.timeout.connect(_background_tick)
	add_child(background_timer)
	background_timer.start()
	last_activity = Time.get_ticks_msec()
	if not engine.start():
		boot_label.text = "The game engine could not be started. Is Node.js installed?"


func _make_node(path: String) -> Node:
	var script: Variant = load(path)
	if script is GDScript and (script as GDScript).can_instantiate():
		var made: Variant = (script as GDScript).new()
		if made is Node:
			return made
	return null


func _sound(method: String, args: Array = []) -> void:
	if sound and is_instance_valid(sound) and sound.has_method(method):
		sound.callv(method, args)


func _input(event: InputEvent) -> void:
	if event is InputEventMouseButton or event is InputEventKey or event is InputEventMouseMotion or event is InputEventScreenTouch or event is InputEventPanGesture:
		last_activity = Time.get_ticks_msec()


func _background_tick() -> void:
	if not in_game or not engine.is_ready() or not hud.visible or not get_window().has_focus():
		return
	var present := Time.get_ticks_msec() - last_activity < 600000
	engine.request("turn.background", {"diplomacy": present})


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
	if screen == "menu":
		_sound("enter_menu")
	elif screen == "game":
		_sound("enter_game")


func _on_engine_ready(_data: Dictionary) -> void:
	_sound("setup", [engine])
	var hello := await engine.request("hello")
	if hello.get("ok", false):
		info = hello["result"]
		menu.set_origin(str(info.get("origin", "")))
		map_view.basemap.cache_dir = str(info.get("dataRoot", "")).path_join("native-cache").path_join("tiles")
	await _refresh_library()
	menu.refresh_trash()
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
	if in_game and id == game_id:
		menu.set_status("")
		_show("game")
		return
	in_game = false
	menu.set_status("Opening the game…")
	var opened := await engine.request("game.open", {"id": id})
	if not opened.get("ok", false):
		menu.set_status(str(opened.get("error", "The game could not be opened.")), true)
		_sound("enter_menu")
		return
	_sound("enter_loading")
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
	in_game = true
	_show("game")
	map_view.focus_owner(str(view.get("country", "")))
	hud.mount_panels(view)
	await hud.enter_game()


func _start_scenario(scenario_id: String) -> void:
	in_game = false
	menu.set_status("Preparing the map…")
	var opened := await engine.request("picker.open", {"scenarioId": scenario_id})
	if not opened.get("ok", false):
		menu.set_status(str(opened.get("error", "The map could not be read.")), true)
		return
	var data: Dictionary = opened["result"]
	map_view.load_regions(str(data["map"]["file"]))
	await map_view.baked
	map_view.set_state(data["map"]["state"])
	map_view.set_cities([])
	picking_scenario = scenario_id
	picker.visible = true
	picker.open(data)
	map_view.visible = true
	menu.set_status("")


func _on_picker_start(request: Dictionary) -> void:
	picker.visible = false
	map_view.select_region(-1)
	menu.set_status("Starting the game…")
	_sound("enter_loading")
	var args := request.duplicate()
	args["scenarioId"] = picking_scenario
	var started := await engine.request("picker.start", args)
	if not started.get("ok", false):
		menu.set_status(str(started.get("error", "The game could not be created.")), true)
		_show("menu")
		return
	if not await _load_map():
		_show("menu")
		return
	await _refresh_library()
	game_id = str(started["result"].get("id", ""))
	game_name = str(_game_named(game_id).get("name", ""))
	picking_scenario = ""
	await _enter_game(started["result"].get("view", {}))


func _on_country_chosen(country: String, difficulty: String) -> void:
	await _on_picker_start({"country": country, "difficulty": difficulty})


func _on_picker_cancelled() -> void:
	picker.visible = false
	picking_scenario = ""
	map_view.select_region(-1)
	_show("menu")


func _exit_game() -> void:
	await _refresh_library()
	_show("menu")


func _on_turn_landed(view: Dictionary) -> void:
	hud.set_game(view, game_name)
	_sound("refresh_war")
	await _refresh_library()


func _on_engine_event(_name: String, _data: Variant) -> void:
	pass


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
