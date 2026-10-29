extends Node

const BOOT_SCRIPTS := ["res://scripts/audio/sound_engine.gd", "res://scripts/ui/game_menu.gd", "res://scripts/ui/debug_console.gd", "res://scripts/ui/interactive_panel.gd", "res://scripts/ui/cheats_panel.gd", "res://scripts/shell/app_update.gd", "res://scripts/war/war_layers.gd", "res://scripts/map/map_extras.gd", "res://scripts/ui/forces_panel.gd", "res://scripts/ui/war_room.gd", "res://scripts/ui/war_room_button.gd", "res://scripts/multiplayer/shared_game_overlay.gd", "res://scripts/ui/scenario_editor.gd", "res://scripts/ui/after_action.gd", "res://scripts/shell/shell_notices.gd", "res://scripts/devtools/devtools.gd"]
const PROVIDERS := {"gemini": "Gemini — Google AI Studio / Gemini API", "openai": "OpenAI", "anthropic": "Anthropic"}

var engine: EngineLink
var map_view: MapView
var ui: Control
var boot: Control
var boot_label: Label
var shell: ShellBoot
var i18n: I18n
var hotkeys: Hotkeys
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
var game_menu: Node
var debug_console: Node
var interactive: Node
var cheats: Node
var in_game := false
var last_activity := 0
var background_timer: Timer
var editor: Node
var war: Node
var war_room: Node
var war_room_button: Node
var after_action: Node
var forces: Node
var map_extras: Node
var shared_overlay: Node
var shell_notices: Node
var devtools: Node
var crash: CrashScreen
var app_update: Node
var _extras_ready := false
var _engine_was_ready := false
var _fatal_message := ""
var _reloading := false
var _screen := "boot"
var _shared_role := ""
var _shared_view_ready := false
var _shared_view_busy := false
var _shared_view_keys := {}
var _play_game_id := ""
var _play_regions := ""
var _cities_raw: Array = []
var _city_renames_key := ""
var _minimized := false
var _presence_timer: Timer
var _reload_asking := false


func _ready() -> void:
	get_tree().auto_accept_quit = false
	get_window().title = "Open Historia"
	_plain_title.call_deferred()
	get_window().title_changed.connect(_plain_title)
	var mark := Image.load_from_file(UI.repo_path("public/icon-192.png"))
	if mark:
		DisplayServer.set_icon(mark)
	Hud.warm_scripts(BOOT_SCRIPTS)
	engine = EngineLink.new()
	add_child(engine)
	var engine_started := engine.start()
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
	game_menu = _mount("res://scripts/ui/game_menu.gd")
	debug_console = _mount("res://scripts/ui/debug_console.gd")
	interactive = _mount("res://scripts/ui/interactive_panel.gd")
	cheats = _make_node("res://scripts/ui/cheats_panel.gd")
	if cheats:
		hud.add_child(cheats)
		hud.cheats = cheats
	_build_settings()
	_build_boot()
	_show("boot")
	_build_crash()
	app_update = _make_node("res://scripts/shell/app_update.gd")
	if app_update:
		add_child(app_update)
		app_update.call("setup", engine)
	engine.engine_ready.connect(_on_engine_ready)
	engine.engine_stopped.connect(_on_engine_stopped)
	engine.engine_event.connect(_on_engine_event)
	menu.play_game.connect(_open_game)
	menu.start_scenario.connect(_start_scenario)
	menu.open_settings.connect(func() -> void:
		if game_menu:
			game_menu.call("open_app_settings")
		else:
			_open_settings())
	menu.refresh_requested.connect(_refresh_library)
	menu.engine = engine
	menu.game_left.connect(func(id: String) -> void:
		if id == game_id:
			_leave_game())
	hud.exit_game.connect(_exit_game)
	hud.open_menu.connect(func() -> void:
		if game_menu:
			game_menu.call("toggle")
		else:
			_open_settings())
	_wire_overlays()
	_mount_parts()
	hud.turn_landed.connect(_on_turn_landed)
	hud.world_changed.connect(_world_changed)
	picker.start.connect(_on_picker_start)
	picker.cancelled.connect(_on_picker_cancelled)
	map_view.bake_failed.connect(func(message: String) -> void: menu.set_status(message, true))
	background_timer = Timer.new()
	background_timer.wait_time = 60.0
	background_timer.timeout.connect(_background_tick)
	add_child(background_timer)
	last_activity = Time.get_ticks_msec()
	_presence_timer = Timer.new()
	_presence_timer.wait_time = 0.5
	_presence_timer.timeout.connect(_check_minimized)
	add_child(_presence_timer)
	_presence_timer.start()
	if not engine_started:
		shell.startup.set_status("The game engine could not be started. Is Node.js installed?")


func _mount(path: String, setup_now := true) -> Node:
	var node := _make_node(path)
	if not node:
		return null
	ui.add_child(node)
	if setup_now and node.has_method("setup"):
		node.call("setup", engine, {})
	return node


func _hook(node: Object, signal_name: String, target: Callable) -> void:
	if node and node.has_signal(signal_name):
		node.connect(signal_name, target)


func _call(node: Object, method: String, args: Array = []) -> Variant:
	if node and is_instance_valid(node) and node.has_method(method):
		return node.callv(method, args)
	return null


func _wire_overlays() -> void:
	_hook(game_menu, "open_library", func() -> void:
		await _exit_game()
		_call(menu, "_show_page", ["games"]))
	_hook(game_menu, "open_events", func() -> void: hud.set_active_panel("history"))
	_hook(game_menu, "open_cheats", func() -> void: _call(cheats, "open"))
	_hook(game_menu, "open_debug_console", func() -> void: _call(debug_console, "open"))
	_hook(game_menu, "setting_changed", _on_setting_changed)
	hud.map_mode_changed.connect(func(mode: String) -> void: _call(game_menu, "set_map_mode", [mode]))
	hud.open_interactive.connect(func() -> void: _call(interactive, "open"))
	_hook(interactive, "open_timeline", func() -> void: hud.set_active_panel("history"))
	_hook(interactive, "world_changed", _world_changed)
	_hook(cheats, "open_interactive", func() -> void: _call(interactive, "open"))
	_hook(cheats, "world_changed", _world_changed)
	_hook(cheats, "country_changed", func(_country: String) -> void: _world_changed())
	picker.engine = engine


func _place_above(node: Node, anchor: Node) -> void:
	ui.add_child(node)
	ui.move_child(node, anchor.get_index() + 1)


func _mount_parts() -> void:
	war = _make_node("res://scripts/war/war_layers.gd")
	if war:
		war.call("setup", engine, map_view)
		hud.set_war(war)
		_hook(war, "unit_selected", func(id: String) -> void: _call(hud.map_cards, "show_unit", [id]))
		hud.map_mode_changed.connect(func(mode: String) -> void: _call(war, "set_map_mode", [mode]))
	map_extras = _make_node("res://scripts/map/map_extras.gd")
	if map_extras:
		hud.add_child(map_extras)
	forces = _make_node("res://scripts/ui/forces_panel.gd")
	if forces:
		_place_above(forces, hud)
		hud.forces = forces
	war_room = _make_node("res://scripts/ui/war_room.gd")
	if war_room:
		_place_above(war_room, forces if forces else hud)
	war_room_button = _make_node("res://scripts/ui/war_room_button.gd")
	if war_room_button:
		_place_above(war_room_button, war_room if war_room else hud)
	shared_overlay = _make_node("res://scripts/multiplayer/shared_game_overlay.gd")
	if shared_overlay:
		_place_above(shared_overlay, menu)
	editor = _make_node("res://scripts/ui/scenario_editor.gd")
	if editor:
		ui.add_child(editor)
	after_action = _make_node("res://scripts/ui/after_action.gd")
	if after_action:
		ui.add_child(after_action)
		hud.after_action = after_action
	shell_notices = _make_node("res://scripts/shell/shell_notices.gd")
	if shell_notices:
		ui.add_child(shell_notices)
	_hook(war_room, "shown_changed", func(open: bool) -> void:
		if in_game:
			hud.visible = not open
		_call(war_room_button, "set_room_open", [open])
		_sound("set_war_room", [open])
		_call(map_extras, "set_rotation_paused", [open]))
	_hook(war_room, "open_chat", func(country: String) -> void: hud.open_chat(country))
	_hook(war_room, "map_state_changed", func(state: Dictionary) -> void: _call(war, "set_war_room", [state]))
	_hook(war_room_button, "pressed", func() -> void:
		if not bool(_call(war_room, "is_open")):
			hud.close_drawer()
		_call(war_room, "toggle"))
	_hook(war_room_button, "presence_changed", func(at_war: bool) -> void: hud.set_beside_war_room(at_war))
	_hook(forces, "world_changed", _world_changed)
	_hook(cheats, "open_forces", func() -> void:
		_call(cheats, "close")
		_call(forces, "open"))
	_hook(shared_overlay, "left", func() -> void:
		_leave_game()
		await _refresh_library()
		_show("menu"))
	_hook(editor, "library_changed", func() -> void:
		await _refresh_library()
		menu.refresh_trash())
	_hook(editor, "play_game", _play_from_workshop)
	_hook(editor, "game_deleted", func(id: String) -> void:
		if id == game_id:
			_leave_game())
	_hook(editor, "failed", func(message: String) -> void: menu.set_status(message, true))
	_hook(editor, "scenario_update_requested", func(id: String, post_id: int) -> void: menu.update_scenario(id, post_id))
	_hook(editor, "busy_changed", func(busy: bool) -> void: menu.set_creating(busy))
	menu.edit_scenario.connect(func(id: String) -> void: _call(editor, "open_scenario", [id]))
	menu.clone_scenario.connect(func(scenario: Dictionary) -> void: _call(editor, "clone_scenario", [scenario]))
	menu.create_scenario.connect(func() -> void: _call(editor, "create_scenario"))
	menu.edit_game.connect(func(id: String) -> void: _call(editor, "open_game", [id]))
	menu.enter_active_game.connect(_enter_active_game)
	menu.open_history.connect(func() -> void: _call(shell, "open_history"))
	menu.scenario_imported.connect(func(id: String, note: String) -> void: _call(editor, "open_scenario", [id, note]))
	menu.scenario_updated.connect(func(id: String) -> void:
		if bool(_call(editor, "is_open")) and str(_call(editor, "current_id")) == id:
			_call(editor, "open_scenario", [id]))
	engine.engine_ready.connect(_setup_parts)


func _setup_parts(_data: Dictionary) -> void:
	if editor:
		editor.call("setup", engine, {"loader": menu.loader})
		menu.set_editing_enabled(true)
	if forces:
		forces.call("setup", engine, {"map_view": map_view})
	if war_room_button:
		war_room_button.call("setup", engine)
	if after_action:
		after_action.call("setup", engine)
	if shared_overlay:
		shared_overlay.call("setup", engine, {})
	if shell_notices:
		shell_notices.call("setup", engine)
	if war_room:
		await war_room.call("setup", engine, {"map_view": map_view})


func _refresh_war_parts() -> void:
	_call(war_room_button, "refresh")
	_call(war_room, "refresh")
	_call(after_action, "refresh")
	_call(forces, "refresh")


func _enter_active_game() -> void:
	await _refresh_library()
	var id := str(library.get("activeGameId", ""))
	if not id.is_empty():
		await _open_game(id)


func _plain_title() -> void:
	DisplayServer.window_set_title("Open Historia")


func _on_setting_changed(key: String, value: Variant) -> void:
	var redraw := key == "Globe" and in_game and _screen == "game"
	if redraw:
		_cover_game(_game_named(game_id))
	_call(map_extras, "apply_map_settings", [{key: value}])
	if redraw:
		shell.end_game_loading()
	if key == "ui_language":
		await i18n.set_language(str(value))
		_plain_title()
	elif key == "map_mode":
		hud.set_map_mode(str(value))
		hud._apply_map_mode()
		_call(war, "set_map_mode", [str(value)])
	elif key in ["map_hide_country_labels", "map_label_font"]:
		_call(map_view, "refresh_polity_text")
	elif key == "map_disable_event_camera":
		await hud.date_widget.refresh_status()


func _world_changed() -> void:
	if not in_game:
		return
	if war:
		await war.call("refresh")
	else:
		var state := await engine.request("map.state")
		if state.get("ok", false):
			map_view.set_state(state["result"])
	var view := await engine.request("game.view")
	if view.get("ok", false):
		hud.set_game(view["result"], game_name)
		await _refresh_flag(str(view["result"].get("country", "")))
	await hud.date_widget.refresh_status()
	hud.date_widget._render_all()
	await hud.date_widget.reload_history()
	hud.refresh_panels()
	_call(game_menu, "refresh")
	_refresh_war_parts()
	await _load_cities()


func _refresh_flag(country: String) -> void:
	var flag := await engine.request("game.flag", {"country": country})
	if flag.get("ok", false):
		hud.set_flag_info(flag["result"])


func _load_cities(only_renamed := false) -> void:
	var args := {"unless": _city_renames_key} if only_renamed and not _cities_raw.is_empty() else {}
	var cities := await engine.request("map.cities", args)
	if not cities.get("ok", false):
		return
	var result: Dictionary = cities["result"]
	_city_renames_key = str(result.get("renamesKey", ""))
	if result.get("unchanged", false):
		return
	_cities_raw = result.get("cities", [])
	_call(hud.map_cards, "set_cities", [_cities_raw])
	_apply_city_names()


func _apply_city_names() -> void:
	if picker.visible and _play_game_id.is_empty():
		return
	var translating := i18n != null and i18n.language != "en"
	var shown: Array = []
	for city in _cities_raw:
		var row: Array = (city as Array).duplicate()
		if translating and row.size() > 7 and int(row[6]) == 0:
			var translated: Variant = i18n.book.get_exact(str(row[7]))
			if translated is String and not (translated as String).strip_edges().is_empty() and translated != row[7]:
				row[0] = translated
		shown.append(row)
	map_view.set_cities(shown)


func _make_node(path: String) -> Node:
	var script: Variant = Hud.take_script(path)
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
	if not in_game or _screen != "game" or not engine.is_ready():
		return
	if bool(_call(editor, "is_open")) or _minimized or not _shared_role.is_empty():
		return
	var present := Time.get_ticks_msec() - last_activity < 600000
	engine.request("turn.background", {"diplomacy": present})


func _check_minimized() -> void:
	_plain_title()
	var minimized := DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_MINIMIZED
	if minimized == _minimized:
		return
	_minimized = minimized
	if engine and engine.is_ready():
		engine.request("presence", {"visible": not minimized})


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST:
		if app_update:
			await app_update.call("install_on_quit")
		engine.stop()
		get_tree().quit()


func _build_crash() -> void:
	var layer := CanvasLayer.new()
	layer.layer = 60
	add_child(layer)
	crash = CrashScreen.new()
	layer.add_child(crash)
	crash.reload_requested.connect(_reload_app)


func _on_engine_stopped(message: String) -> void:
	if _reloading:
		return
	shell.cancel_game_loading(true)
	if not _engine_was_ready:
		_show("boot")
		shell.startup.set_status(message)
		return
	in_game = false
	var first := _fatal_message if not _fatal_message.is_empty() else message.get_slice("\n", 0)
	crash.show_crash(first, message)


func _reload_blocked() -> bool:
	var workshop: Variant = editor.get("_workshop") if editor else null
	if not (workshop is Node) or not is_instance_valid(workshop):
		return false
	var state: Variant = (workshop as Node).get("state")
	if not (state is Dictionary) or str((workshop as Node).get("session")).is_empty():
		return false
	var status: Dictionary = (state as Dictionary).get("status", {})
	return str(status.get("saveStatus", "saved")) in ["dirty", "saving", "error"]


func _on_reload_requested(_force: bool) -> void:
	if crash.is_shown() or not _reload_blocked():
		_reload_app()
		return
	if _reload_asking:
		return
	_reload_asking = true
	var leave: bool = await EditorKit.ask(self, "Reload the app? Changes you made may not be saved.", "Reload", "Cancel")
	_reload_asking = false
	if leave:
		_reload_app()


func _reload_app() -> void:
	if _reloading:
		return
	_reloading = true
	var tree := get_tree()
	if tree.current_scene == self:
		tree.reload_current_scene()
		return
	var parent := get_parent()
	var scene := load("res://main.tscn") as PackedScene
	if parent == null or scene == null:
		_reloading = false
		return
	var index := get_index()
	parent.remove_child(self)
	queue_free()
	var fresh := scene.instantiate()
	parent.add_child(fresh)
	parent.move_child(fresh, index)


func _build_boot() -> void:
	i18n = I18n.new()
	add_child(i18n)
	i18n.translations_changed.connect(func() -> void:
		if in_game:
			_apply_city_names())
	hotkeys = Hotkeys.new()
	add_child(hotkeys)
	hotkeys.setup(engine)
	hotkeys.reload_requested.connect(_on_reload_requested)
	devtools = _make_node("res://scripts/devtools/devtools.gd")
	if devtools:
		add_child(devtools)
		devtools.call("setup", engine, self)
		hotkeys.devtools_requested.connect(func() -> void: _call(devtools, "toggle"))
	shell = ShellBoot.new()
	add_child(shell)
	shell.map_view = map_view
	shell.setup(engine, menu.loader, hud)
	boot = shell.startup


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
	_screen = screen
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
	_report_presence(screen != "game")


func _report_presence(in_menu: bool) -> void:
	if engine and engine.is_ready():
		engine.request("discord.presence", {"inMenu": in_menu})


func _on_engine_ready(_data: Dictionary) -> void:
	_engine_was_ready = true
	_sound("setup", [engine])
	var hello := await engine.request("hello")
	if hello.get("ok", false):
		info = hello["result"]
		menu.set_origin(str(info.get("origin", "")))
		map_view.basemap.cache_dir = str(info.get("dataRoot", "")).path_join("native-cache").path_join("tiles")
		picker.context = {"tiles_cache": map_view.basemap.cache_dir}
	if app_update and bool(await app_update.call("run_launch")):
		return
	await i18n.start(engine)
	await shell.prepare()
	_show("menu")
	shell.reveal()
	Hud.warm_panels()
	i18n.activate()
	await _refresh_library()
	menu.refresh_trash()


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
	_call(war, "clear")
	var regions := await engine.request("map.regions")
	if not regions.get("ok", false):
		menu.set_status(str(regions.get("error", "The map could not be read.")), true)
		return false
	map_view.load_regions(str(regions["result"]["file"]))
	await map_view.baked
	shell.game_loading_phase("settling")
	var state := await engine.request("map.state")
	if state.get("ok", false):
		map_view.set_state(state["result"])
	await _load_cities()
	return true


func _cover_game(entry: Dictionary) -> void:
	shell.begin_game_loading({"gameName": str(entry.get("name", "")), "scenarioName": str(entry.get("scenarioName", "")), "countryName": str(entry.get("country", "")), "coverUrl": str(entry.get("coverImageUrl", ""))})


func _open_game(id: String) -> void:
	if in_game and id == game_id:
		menu.set_status("")
		_show("game")
		return
	in_game = false
	_cover_game(_game_named(id))
	menu.set_status("Opening the game…")
	var opened := await engine.request("game.open", {"id": id})
	if not opened.get("ok", false):
		menu.set_status(str(opened.get("error", "The game could not be opened.")), true)
		_sound("enter_menu")
		shell.cancel_game_loading()
		return
	_sound("enter_loading")
	if not await _load_map():
		shell.cancel_game_loading()
		return
	await _refresh_library()
	game_id = id
	game_name = str(_game_named(id).get("name", ""))
	await _enter_game(opened["result"])
	shell.end_game_loading()


func _enter_game(view: Dictionary) -> void:
	hud.set_game(view, game_name)
	await _refresh_flag(str(view.get("country", "")))
	menu.set_status("")
	in_game = true
	_call(war_room_button, "set_in_game", [true])
	last_activity = Time.get_ticks_msec()
	background_timer.start()
	_show("game")
	map_view.focus_owner(str(view.get("country", "")))
	var running := [0]
	var together := func(job: Callable) -> void:
		running[0] += 1
		await job.call()
		running[0] -= 1
	if war:
		together.call(func() -> void: await war.call("refresh"))
	hud.mount_panels(view)
	_call(cheats, "setup", [engine, {"map_view": map_view, "game": view, "forces_available": forces != null}])
	_call(game_menu, "refresh")
	if map_extras and not _extras_ready:
		_extras_ready = true
		together.call(func() -> void: await map_extras.call("setup", engine, {"map_view": map_view, "game": view}))
	elif map_extras:
		_call(map_extras, "refresh")
	while running[0] > 0:
		await get_tree().process_frame
	_refresh_war_parts()
	_call(shell_notices, "reset_for_game")
	await hud.enter_game()
	_call(game_menu, "maybe_show_ai_setup", [game_id])


func _start_scenario(scenario_id: String) -> void:
	in_game = false
	_call(war, "clear")
	menu.set_status("Preparing the map…")
	var opened := await engine.request("picker.open", {"scenarioId": scenario_id})
	if not opened.get("ok", false):
		menu.set_status(str(opened.get("error", "The map could not be read.")), true)
		return
	var data: Dictionary = opened["result"]
	map_view.load_regions(str(data["map"]["file"]))
	await map_view.baked
	map_view.set_state(data["map"]["state"])
	_cities_raw = []
	map_view.set_cities([])
	picking_scenario = scenario_id
	picker.visible = true
	picker.open(data)
	map_view.visible = true
	menu.set_status("")


func _on_picker_start(request: Dictionary) -> void:
	if not _play_game_id.is_empty():
		await _finish_play_pick(request)
		return
	picker.visible = false
	map_view.select_region(-1)
	var scenario := {}
	for entry in library.get("scenarios", []):
		if str(entry.get("id", "")) == picking_scenario:
			scenario = entry
	shell.begin_game_loading({"gameName": "", "scenarioName": str(scenario.get("name", "")), "countryName": str(request.get("country", "")), "coverUrl": str(scenario.get("coverImageUrl", ""))})
	menu.set_status("Starting the game…")
	_sound("enter_loading")
	var args := request.duplicate()
	args["scenarioId"] = picking_scenario
	var started := await engine.request("picker.start", args)
	if not started.get("ok", false):
		menu.set_status(str(started.get("error", "The game could not be created.")), true)
		shell.cancel_game_loading()
		_show("menu")
		return
	shell.refresh_game_loading(str(started["result"].get("id", "")))
	if not await _load_map():
		shell.cancel_game_loading()
		_show("menu")
		return
	await _refresh_library()
	game_id = str(started["result"].get("id", ""))
	game_name = str(_game_named(game_id).get("name", ""))
	var made := _game_named(game_id)
	shell.update_game_loading({"gameName": game_name, "scenarioName": str(made.get("scenarioName", scenario.get("name", ""))), "countryName": str(made.get("country", request.get("country", ""))), "coverUrl": str(made.get("coverImageUrl", scenario.get("coverImageUrl", "")))})
	picking_scenario = ""
	await _enter_game(started["result"].get("view", {}))
	shell.end_game_loading()
	var handoff := str(started["result"].get("error", ""))
	if not handoff.is_empty():
		_call(editor, "open_game", [game_id, handoff])


func _on_country_chosen(country: String, difficulty: String) -> void:
	await _on_picker_start({"country": country, "difficulty": difficulty})


func _on_picker_cancelled() -> void:
	if not _play_game_id.is_empty():
		await _finish_play_pick({})
		return
	picker.visible = false
	picking_scenario = ""
	map_view.select_region(-1)
	_show("menu")


func _play_from_workshop(id: String) -> void:
	await _open_game(id)
	if not in_game or game_id != id:
		return
	var opened := await engine.request("picker.forGame", {"gameId": id})
	if not opened.get("ok", false) or not in_game or game_id != id:
		return
	var data: Dictionary = opened["result"]
	_play_game_id = id
	_play_regions = ""
	_call(war, "clear")
	map_view.select_region(-1)
	var file := str((data.get("map", {}) as Dictionary).get("file", ""))
	if file != str(map_view.get("_loaded_file")):
		_play_regions = file
		map_view.load_regions(file)
		await map_view.baked
	picker.visible = true
	picker.open(data)


func _finish_play_pick(request: Dictionary) -> void:
	var id := _play_game_id
	_play_game_id = ""
	picker.visible = false
	map_view.select_region(-1)
	if request.is_empty():
		if not _play_regions.is_empty():
			_play_regions = ""
			await _load_map()
		await _world_changed()
		var country := ""
		var view := await engine.request("game.view")
		if view.get("ok", false):
			country = str(view["result"].get("country", ""))
		map_view.focus_owner(country)
		return
	_play_regions = ""
	var chosen := await engine.request("picker.choose", {"gameId": id, "country": str(request.get("country", "")), "difficulty": str(request.get("difficulty", ""))})
	if not chosen.get("ok", false):
		menu.set_status(str(chosen.get("error", "The game could not be changed.")), true)
	in_game = false
	await _open_game(id)


func _leave_game() -> void:
	in_game = false
	background_timer.stop()
	_call(war_room_button, "set_in_game", [false])
	if war_room_button:
		war_room_button.set("visible", false)


func _exit_game() -> void:
	if bool(_call(war_room, "is_open")):
		_call(war_room, "close")
	_call(forces, "close")
	background_timer.stop()
	_call(war_room_button, "set_in_game", [false])
	if war_room_button:
		war_room_button.set("visible", false)
	await _refresh_library()
	_show("menu")


func _on_turn_landed(view: Dictionary) -> void:
	hud.set_game(view, game_name)
	_call(game_menu, "refresh")
	_sound("refresh_war")
	_refresh_war_parts()
	await _load_cities(true)
	await _refresh_library()
	_report_presence(not hud.visible)


func _on_engine_event(event_name: String, data: Variant) -> void:
	if event_name == "sidecar.fatal" and data is Dictionary:
		_fatal_message = str((data as Dictionary).get("message", ""))
	elif event_name == "multiplayer.shared" and data is Dictionary:
		var state: Dictionary = data
		var mode := str(state.get("mode", "off"))
		var role := str(state.get("role", "")) if mode not in ["off", "ended"] else ""
		if role != _shared_role:
			_shared_role = role
			if not role.is_empty():
				_call(cheats, "close")
		var view_ready := bool(state.get("viewReady", false)) and not role.is_empty()
		var arrived := view_ready and not _shared_view_ready
		_shared_view_ready = view_ready
		if arrived and role == "guest":
			_enter_shared_game()
	elif event_name == "multiplayer.view" and data is Dictionary:
		var keys: Variant = (data as Dictionary).get("keys", [])
		_on_shared_view(keys if keys is Array else [])
	elif event_name == "multiplayer.round" and data is Dictionary:
		_on_shared_round(data)


func _enter_shared_game() -> void:
	await _refresh_library()
	var id := str(library.get("activeGameId", ""))
	if id.is_empty() or (in_game and id == game_id):
		return
	await _open_game(id)


func _on_shared_view(keys: Array) -> void:
	if not in_game or _shared_role.is_empty():
		return
	for key in keys:
		_shared_view_keys[str(key)] = true
	if _shared_view_busy:
		return
	_shared_view_busy = true
	while not _shared_view_keys.is_empty() and in_game:
		var changed := _shared_view_keys
		_shared_view_keys = {}
		if changed.has("world") or changed.has("colors") or changed.has("flags"):
			await _world_changed()
		elif changed.has("game") or changed.has("events"):
			var view := await engine.request("game.view")
			if view.get("ok", false):
				hud.set_game(view["result"], game_name)
			await hud.date_widget.refresh_status()
			await hud.date_widget.reload_history()
			hud.refresh_panels()
		else:
			hud.refresh_panels()
	_shared_view_keys = {}
	_shared_view_busy = false


func _on_shared_round(data: Dictionary) -> void:
	if not in_game or _shared_role.is_empty():
		return
	await _world_changed()
	await hud.date_widget.land_shared_round(data.get("view"))


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
