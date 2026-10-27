class_name GameMenu
extends Control

signal closed
signal open_library
signal open_events
signal open_cheats
signal open_debug_console
signal setting_changed(key: String, value: Variant)
signal ai_setup_answered

const DISCORD_URL := "https://discord.gg/QaqAK7fQAg"
const REDDIT_URL := "https://www.reddit.com/r/OpenHistoria"
const GITHUB_URL := "https://github.com/Open-Historia/open-historia"
const REPORT_BUG_URL := "https://github.com/Open-Historia/open-historia/issues/new"
const WIKI_URL := "https://openhistoria.com/wiki/"
const PRIVACY_URL := "https://openhistoria.com/privacy/"
const DISCORD_BLURPLE := Color("#5865f2")
const REDDIT_ORANGERED := Color("#ff4500")
const WorkspaceScript := preload("res://scripts/ui/settings_workspace.gd")
const TABS := [["game", "Game"], ["tools", "Tools"], ["settings", "Settings"], ["help", "Help"]]
const TONES := {
	"neutral": [Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.08), Color(1, 1, 1, 0.08), Color("#f8fafc")],
	"slate": [Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.12), Color(1, 1, 1, 0.08), Color("#e4e4e7")],
	"blue": [Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.08), Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.18), Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.16), Color("#dbeafe")],
	"amber": [Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.07), Color(251 / 255.0, 191 / 255.0, 36 / 255.0, 0.17), Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.14), Color("#fde68a")],
}
const DISCORD_PATH := "M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"
const REDDIT_PATH := "M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"

var engine: EngineLink
var context := {}
var map_mode := "political"
var export_dir := ""
var reveal_saved_files := true
var tab := "tools"

var _open := false
var _card: GlassPanel
var _card_column: VBoxContainer
var _title: Label
var _subtitle: Label
var _tab_buttons := {}
var _panel_holder: VBoxContainer
var _workspace: WorkspaceScript
var _workspace_scope := "game"
var _prompt: ApiSetupPrompt
var _ai_setup_answered_for := "__none__"
var _marks := {}
var _shared_role := ""
var _update_check := {}
var _version_text := ""
var _version_loading := false


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_build_card()
	_card.visible = false
	visible = false
	get_viewport().size_changed.connect(_fit_card)


func setup(engine_link: EngineLink, setup_context: Dictionary) -> void:
	engine = engine_link
	var given: Variant = setup_context.get("context", {})
	if typeof(given) == TYPE_DICTIONARY:
		context = given
	map_mode = str(setup_context.get("map_mode", map_mode))
	export_dir = str(setup_context.get("export_dir", export_dir))
	if setup_context.has("reveal_saved_files"):
		reveal_saved_files = bool(setup_context.get("reveal_saved_files"))
	if engine and not engine.engine_event.is_connected(_on_engine_event):
		engine.engine_event.connect(_on_engine_event)


func _on_engine_event(event_name: String, data: Variant) -> void:
	if event_name == "update.state" and data is Dictionary:
		var told := str((data as Dictionary).get("versionText", ""))
		if not told.is_empty() and told != _version_text:
			_version_text = told
			_refresh_help()
		return
	if event_name != "multiplayer.shared" or not (data is Dictionary):
		return
	var state: Dictionary = data
	var mode := str(state.get("mode", "off"))
	var role := str(state.get("role", "")) if mode not in ["off", "ended"] else ""
	if role == _shared_role:
		return
	_shared_role = role
	if _open and _card.visible and tab == "tools":
		_show_tab(tab)


func is_open() -> bool:
	return _open


func toggle() -> void:
	if _open:
		close()
	else:
		open()


func set_map_mode(mode: String) -> void:
	map_mode = mode
	if _workspace:
		_workspace.map_mode = mode


func refresh() -> void:
	if not engine:
		return
	var reply: Dictionary = await engine.request("settings.context")
	if reply.get("ok", false) and typeof(reply.get("result")) == TYPE_DICTIONARY:
		context = reply["result"]
	_refresh_header()
	if _workspace and _workspace.visible:
		_workspace.context = context
		_workspace.refresh()


func open(section := "") -> void:
	_open = true
	visible = true
	await refresh()
	if not section.is_empty():
		tab = "settings"
		_show_tab(tab)
		_open_workspace(section, "game", Rect2())
		return
	tab = "tools"
	_show_tab(tab)
	_show_card(true)


func open_app_settings(section := "general") -> void:
	_open = true
	visible = true
	await refresh()
	_card.visible = false
	_open_workspace(section, "app", Rect2())


func close() -> void:
	if not _open:
		return
	_open = false
	if _workspace and _workspace.visible:
		_workspace.visible = false
	if _card.visible:
		var tween := create_tween().set_parallel(true).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
		tween.tween_property(_card, "scale", _grow_scale(), 0.22)
		tween.tween_property(_card, "modulate:a", 0.2, 0.22)
		await tween.finished
	_card.visible = false
	if not (_prompt and is_instance_valid(_prompt) and _prompt.visible):
		visible = false
	closed.emit()


func open_section(section: String) -> void:
	if not _open:
		await open(section)
		return
	_open_workspace(section, "game", _card_rect())


func maybe_show_ai_setup(game_id: String) -> void:
	if game_id == _ai_setup_answered_for or _open:
		return
	await show_ai_setup(false, game_id)


func show_ai_setup(force := false, game_id := "") -> void:
	if not engine:
		return
	var reply: Dictionary = await engine.request("settings.aiSetup")
	if not reply.get("ok", false):
		return
	var setup: Dictionary = reply["result"]
	if bool(setup.get("ready", false)) and not force:
		return
	if _prompt and is_instance_valid(_prompt):
		_prompt.queue_free()
	_prompt = ApiSetupPrompt.new(engine, setup)
	add_child(_prompt)
	visible = true
	_prompt.dismissed.connect(func() -> void:
		_ai_setup_answered_for = game_id
		_close_prompt())
	_prompt.configure.connect(func() -> void:
		_ai_setup_answered_for = game_id
		_close_prompt()
		open("ai"))
	_prompt.saved.connect(func() -> void:
		_ai_setup_answered_for = game_id
		_close_prompt())


func _close_prompt() -> void:
	if _prompt and is_instance_valid(_prompt):
		_prompt.queue_free()
	_prompt = null
	ai_setup_answered.emit()
	if not _open:
		visible = false


func _input(event: InputEvent) -> void:
	if not _open or not visible:
		return
	if _workspace and _workspace.visible:
		return
	if event is InputEventKey and (event as InputEventKey).pressed and (event as InputEventKey).keycode == KEY_ESCAPE:
		get_viewport().set_input_as_handled()
		close()


func _fs(rem: float) -> int:
	return int(round(rem * 16.0))


func _card_rect() -> Rect2:
	return Rect2(_card.position, _card.size)


func _grow_scale() -> Vector2:
	var size := _card.size
	return Vector2(64.0 / maxf(1.0, size.x), 64.0 / maxf(1.0, size.y))


func _fit_card() -> void:
	if not _card:
		return
	var view := get_viewport_rect().size
	var max_height := view.y - 8.0 - 16.0
	_card.custom_minimum_size = Vector2(minf(464.0, view.x - 16.0), minf(352.0, max_height))
	_card.size = Vector2(minf(464.0, view.x - 16.0), 0)
	_card.reset_size()
	if _card.size.y > max_height:
		_card.size.y = max_height


func _show_card(grow: bool) -> void:
	_card.visible = true
	_card.position = Vector2(8, 8)
	_fit_card()
	await get_tree().process_frame
	_fit_card()
	_card.pivot_offset = Vector2.ZERO
	if grow:
		_card.scale = _grow_scale()
		_card.modulate.a = 0.35
		_card_column.modulate.a = 0.0
		var tween := create_tween().set_parallel(true).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
		tween.tween_property(_card, "scale", Vector2.ONE, 0.24)
		tween.tween_property(_card, "modulate:a", 1.0, 0.24)
		tween.tween_property(_card_column, "modulate:a", 1.0, 0.18).set_delay(0.12)
	else:
		_card.scale = Vector2.ONE
		_card.modulate.a = 1.0
		_card_column.modulate.a = 0.0
		var fade := create_tween()
		fade.tween_property(_card_column, "modulate:a", 1.0, 0.18)


func _build_card() -> void:
	_card = GlassPanel.new(Color(32 / 255.0, 32 / 255.0, 35 / 255.0, 0.63), 14.0, Vector4(14, 14, 14, 14))
	_card.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(_card)
	_card_column = VBoxContainer.new()
	_card_column.add_theme_constant_override("separation", 0)
	_card.add_child(_card_column)
	var header := HBoxContainer.new()
	header.add_theme_constant_override("separation", 12)
	var mark := TextureRect.new()
	mark.texture = UI.logo()
	mark.custom_minimum_size = Vector2(36, 36)
	mark.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	mark.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	mark.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	header.add_child(mark)
	var titles := VBoxContainer.new()
	titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	titles.add_theme_constant_override("separation", 2)
	titles.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_title = UI.label("Open Historia", _fs(0.92), Color("#f8fafc"), 900)
	_title.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	_title.clip_text = true
	titles.add_child(_title)
	_subtitle = UI.label("Game menu", _fs(0.61), Color(1, 1, 1, 0.34))
	_subtitle.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	_subtitle.clip_text = true
	titles.add_child(_subtitle)
	header.add_child(titles)
	var close_button := Button.new()
	close_button.text = "×"
	close_button.focus_mode = Control.FOCUS_NONE
	close_button.tooltip_text = "Close game menu"
	close_button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	close_button.custom_minimum_size = Vector2(32, 32)
	close_button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var normal := UI.box(Color(1, 1, 1, 0.03), Color(1, 1, 1, 0.08), 8, 1)
	var hover := UI.box(Color(1, 1, 1, 0.07), Color(1, 1, 1, 0.12), 8, 1)
	for state in ["normal", "focus"]:
		close_button.add_theme_stylebox_override(state, normal)
	for state in ["hover", "pressed", "hover_pressed"]:
		close_button.add_theme_stylebox_override(state, hover)
	close_button.add_theme_font_size_override("font_size", 16)
	close_button.add_theme_color_override("font_color", Color(1, 1, 1, 0.58))
	close_button.add_theme_color_override("font_hover_color", UI.WHITE)
	close_button.pressed.connect(close)
	header.add_child(close_button)
	_card_column.add_child(header)
	var under := Control.new()
	under.custom_minimum_size.y = 11
	under.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_card_column.add_child(under)
	var rule := ColorRect.new()
	rule.color = Color(1, 1, 1, 0.07)
	rule.custom_minimum_size.y = 1
	rule.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_card_column.add_child(rule)
	var after_rule := Control.new()
	after_rule.custom_minimum_size.y = 12
	after_rule.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_card_column.add_child(after_rule)
	var strip := PanelContainer.new()
	strip.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.03), Color(1, 1, 1, 0.07), 10, 1, Vector4(3.2, 3.2, 3.2, 3.2)))
	var tabs := HBoxContainer.new()
	tabs.add_theme_constant_override("separation", 3)
	for pair: Array in TABS:
		var key: String = pair[0]
		var button := Button.new()
		button.text = str(pair[1]).to_upper()
		button.focus_mode = Control.FOCUS_NONE
		button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		button.custom_minimum_size.y = 33
		button.add_theme_font_override("font", UI.font(850))
		button.add_theme_font_size_override("font_size", _fs(0.72))
		button.pressed.connect(func() -> void: _show_tab(key))
		_tab_buttons[key] = button
		tabs.add_child(button)
	strip.add_child(tabs)
	_card_column.add_child(strip)
	var after_tabs := Control.new()
	after_tabs.custom_minimum_size.y = 13
	after_tabs.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_card_column.add_child(after_tabs)
	_panel_holder = VBoxContainer.new()
	_panel_holder.add_theme_constant_override("separation", 0)
	_panel_holder.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_card_column.add_child(_panel_holder)
	_style_tabs()


func _style_tabs() -> void:
	for key: String in _tab_buttons.keys():
		var button: Button = _tab_buttons[key]
		var selected := key == tab
		var normal := UI.box(Color(0, 0, 0, 0.42) if selected else Color(0, 0, 0, 0), Color(1, 1, 1, 0.28) if selected else Color(0, 0, 0, 0), 8, 1, Vector4(12.8, 0, 12.8, 0))
		var hover := normal.duplicate() as StyleBoxFlat
		if not selected:
			hover.bg_color = Color(1, 1, 1, 0.04)
		for state in ["normal", "focus", "disabled"]:
			button.add_theme_stylebox_override(state, normal)
		for state in ["hover", "pressed", "hover_pressed"]:
			button.add_theme_stylebox_override(state, hover)
		var ink := Color("#f4f4f5") if selected else Color(1, 1, 1, 0.56)
		for name in ["font_color", "font_focus_color"]:
			button.add_theme_color_override(name, ink)
		for name in ["font_hover_color", "font_pressed_color", "font_hover_pressed_color"]:
			button.add_theme_color_override(name, Color("#f4f4f5") if selected else Color(1, 1, 1, 0.8))


func _refresh_header() -> void:
	var name := str(context.get("scenarioName", ""))
	if name.is_empty():
		name = str(context.get("gameName", ""))
	_title.text = name if not name.is_empty() else "Open Historia"
	var parts: PackedStringArray = []
	var country := str(context.get("countryName", ""))
	if not country.is_empty():
		parts.append("Playing as %s" % country)
	var date := str(context.get("date", ""))
	if not date.is_empty():
		parts.append(date)
	_subtitle.text = " · ".join(parts) if not parts.is_empty() else "Game menu"


func _show_tab(key: String) -> void:
	tab = key
	_style_tabs()
	for child in _panel_holder.get_children():
		_panel_holder.remove_child(child)
		child.queue_free()
	var panel: VBoxContainer
	match key:
		"game":
			panel = _quick_panel("Game", "Campaign identity and management actions.")
			panel.add_child(_context_card())
			panel.add_child(_quick_action("Game Management", "Switch, duplicate, import or manage campaigns", "▦", "neutral", func() -> void: _run_and_close(open_library)))
		"settings":
			panel = _quick_panel("Settings", "Jump straight into the options category you want.")
			var grid := _grid()
			grid.add_child(_quick_action("General", "Language, display, accessibility, sound and privacy", "◫", "blue", func() -> void: _open_workspace("general", "game", _card_rect())))
			grid.add_child(_quick_action("Sound", "The game's music and sound effects.", "♫", "blue", func() -> void: _open_workspace("sound", "game", _card_rect())))
			grid.add_child(_quick_action("Map", "Basemap, labels, globe and camera", "◇", "blue", func() -> void: _open_workspace("map", "game", _card_rect())))
			grid.add_child(_quick_action("AI", "Models, backups, keys and reasoning", "✦", "neutral", func() -> void: _open_workspace("ai", "game", _card_rect())))
			grid.add_child(_quick_action("Advanced", "Per-task models and expert controls", "⌘", "neutral", func() -> void: _open_workspace("advanced", "game", _card_rect())))
			panel.add_child(grid)
		"help":
			panel = _quick_panel("Help", "Guides, bug reporting and community links.")
			var grid := _grid()
			grid.add_child(_quick_action("Wiki", "How-to pages and setup help", "?", "neutral", func() -> void: OS.shell_open(WIKI_URL)))
			var checking := str(_update_check.get("status", "")) == "checking"
			grid.add_child(_quick_action("Checking for updates…" if checking else "Check for updates", _update_check_text(), "↻", "blue", _check_for_updates))
			grid.add_child(_quick_action("Report a Bug", "Open the issue/report page", "!", "amber", func() -> void: OS.shell_open(REPORT_BUG_URL)))
			grid.add_child(_quick_action("Privacy", "What the game keeps and sends", "§", "neutral", func() -> void: OS.shell_open(PRIVACY_URL)))
			panel.add_child(grid)
			var row := HBoxContainer.new()
			row.add_theme_constant_override("separation", 9)
			var community := UI.label("Community", _fs(0.6), Color(1, 1, 1, 0.24))
			community.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			row.add_child(community)
			row.add_child(UI.spacer())
			for link: Array in [["Discord", DISCORD_URL], ["Reddit", REDDIT_URL], ["GitHub", GITHUB_URL]]:
				row.add_child(_social_link(str(link[0]), str(link[1])))
			panel.add_child(row)
			if _version_text.is_empty():
				_load_version()
			else:
				panel.add_child(UI.label(_version_text, _fs(0.6), Color(1, 1, 1, 0.24)))
		_:
			panel = _quick_panel("Tools", "High-frequency in-game tools should stay one click away.")
			var grid := _grid()
			if _shared_role.is_empty():
				grid.add_child(_quick_action("Cheats", "Game master tools and world editing", "⌁", "slate", func() -> void: _run_and_close(open_cheats)))
			grid.add_child(_quick_action("Events / Timeline", "Review the current turn and world history", "◷", "blue", func() -> void: _run_and_close(open_events)))
			grid.add_child(_quick_action("AI debug console", "Every AI call, its prompt, answer and cost", "◈", "neutral", func() -> void: _run_and_close(open_debug_console)))
			var tiles := GridContainer.new()
			tiles.columns = 2
			tiles.add_theme_constant_override("h_separation", 9)
			tiles.add_theme_constant_override("v_separation", 9)
			tiles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			tiles.add_child(_community_tile(DISCORD_URL, "Join the Discord", DISCORD_BLURPLE, DISCORD_PATH))
			tiles.add_child(_community_tile(REDDIT_URL, "Open r/OpenHistoria on Reddit", REDDIT_ORANGERED, REDDIT_PATH))
			grid.add_child(tiles)
			panel.add_child(grid)
	_panel_holder.add_child(panel)
	if _card.visible:
		_fit_card.call_deferred()


func _run_and_close(action: Signal) -> void:
	action.emit()
	close()


func _update_check_text() -> String:
	match str(_update_check.get("status", "")):
		"checking":
			return "Checking the release channel right now…"
		"available":
			return "Update available — use the update banner above to install it."
		"current":
			return "You are up to date."
		"unsupported":
			return "This build does not support in-app update checks."
		"error":
			return "Could not check for updates. Try again."
	return "Check the installed app for a newer build right now."


func _check_for_updates() -> void:
	if str(_update_check.get("status", "")) == "checking":
		return
	_update_check = {"status": "checking"}
	_refresh_help()
	var reply: Dictionary = await engine.request("update.check", {"manual": true}) if engine else {"ok": false}
	var result: Variant = reply.get("result")
	_update_check = result if bool(reply.get("ok", false)) and result is Dictionary else {"status": "error"}
	_refresh_help()


func _refresh_help() -> void:
	if _open and _card and _card.visible and tab == "help":
		_show_tab("help")


func _load_version() -> void:
	if _version_loading or engine == null or not engine.is_ready():
		return
	_version_loading = true
	var reply: Dictionary = await engine.request("update.state")
	_version_loading = false
	var result: Variant = reply.get("result")
	if bool(reply.get("ok", false)) and result is Dictionary:
		var told := str((result as Dictionary).get("versionText", ""))
		if not told.is_empty() and told != _version_text:
			_version_text = told
			_refresh_help()


func _quick_panel(title: String, description: String) -> VBoxContainer:
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 12)
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var head := VBoxContainer.new()
	head.add_theme_constant_override("separation", 3)
	head.add_child(UI.label(title, _fs(0.82), Color("#f8fafc"), 850))
	var text := UI.wrapped(description, _fs(0.64), Color(1, 1, 1, 0.36))
	head.add_child(text)
	column.add_child(head)
	return column


func _grid() -> GridContainer:
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 9)
	grid.add_theme_constant_override("v_separation", 9)
	grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return grid


func _quick_action(title: String, description: String, symbol: String, tone: String, on_press: Callable) -> ActionTile:
	var palette: Array = TONES.get(tone, TONES["neutral"])
	var background: Color = palette[0]
	var border: Color = palette[1]
	var icon_bg: Color = palette[2]
	var ink: Color = palette[3]
	var normal := UI.box(background, border, 11, 1, Vector4(12.8, 11.5, 12.8, 11.5))
	var hover := UI.box(Color(background.r, background.g, background.b, minf(1.0, background.a + 0.03)), Color(border.r, border.g, border.b, minf(1.0, border.a + 0.06)), 11, 1, Vector4(12.8, 11.5, 12.8, 11.5))
	var action := ActionTile.new(normal, hover)
	action.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	action.custom_minimum_size = Vector2(0, 70)
	var row := HBoxContainer.new()
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.add_theme_constant_override("separation", 12)
	var tile := PanelContainer.new()
	tile.mouse_filter = Control.MOUSE_FILTER_IGNORE
	tile.custom_minimum_size = Vector2(38, 38)
	tile.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	tile.add_theme_stylebox_override("panel", UI.box(icon_bg, border, 8, 1))
	var glyph := UI.label(symbol, 16, ink, 900)
	glyph.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	glyph.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	tile.add_child(glyph)
	row.add_child(tile)
	var texts := VBoxContainer.new()
	texts.mouse_filter = Control.MOUSE_FILTER_IGNORE
	texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	texts.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	texts.add_theme_constant_override("separation", 2)
	texts.add_child(UI.label(title, _fs(0.84), ink, 850))
	var detail := UI.wrapped(description, _fs(0.64), Color(1, 1, 1, 0.38))
	detail.add_theme_constant_override("line_spacing", 0)
	texts.add_child(detail)
	row.add_child(texts)
	action.add_child(row)
	if on_press.is_valid():
		action.pressed.connect(func() -> void: on_press.call())
	_marks[title] = action
	return action


func _context_card() -> Control:
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.03), Color(1, 1, 1, 0.07), 11, 1, Vector4(13.6, 12.8, 13.6, 12.8)))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 7)
	column.add_child(UI.label("Current session", _fs(0.74), Color(1, 1, 1, 0.82), 800))
	var spacer := Control.new()
	spacer.custom_minimum_size.y = 2
	column.add_child(spacer)
	var scenario := str(context.get("scenarioName", ""))
	if scenario.is_empty():
		scenario = str(context.get("gameName", ""))
	var rows := [
		["Scenario", scenario if not scenario.is_empty() else "Open Historia"],
		["Playing as", str(context.get("countryName", "")) if not str(context.get("countryName", "")).is_empty() else "—"],
		["Date", str(context.get("date", "")) if not str(context.get("date", "")).is_empty() else "—"],
	]
	for row_data: Array in rows:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 6)
		var name := UI.label(str(row_data[0]).to_upper(), _fs(0.63), Color(1, 1, 1, 0.34), 700)
		name.custom_minimum_size.x = 83
		row.add_child(name)
		var value := UI.label(str(row_data[1]), _fs(0.72), Color(1, 1, 1, 0.78), 650)
		value.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		value.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		value.clip_text = true
		row.add_child(value)
		column.add_child(row)
	card.add_child(column)
	return card


func _social_link(text: String, url: String) -> Button:
	var button := Button.new()
	button.text = text
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var normal := UI.box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.08), 7, 1, Vector4(8.8, 6, 8.8, 6))
	var hover := UI.box(Color(1, 1, 1, 0.08), Color(1, 1, 1, 0.14), 7, 1, Vector4(8.8, 6, 8.8, 6))
	for state in ["normal", "focus"]:
		button.add_theme_stylebox_override(state, normal)
	for state in ["hover", "pressed", "hover_pressed"]:
		button.add_theme_stylebox_override(state, hover)
	button.add_theme_font_override("font", UI.font(700))
	button.add_theme_font_size_override("font_size", _fs(0.68))
	button.add_theme_color_override("font_color", Color(1, 1, 1, 0.58))
	button.add_theme_color_override("font_hover_color", Color(1, 1, 1, 0.85))
	button.pressed.connect(func() -> void: OS.shell_open(url))
	return button


func _community_tile(url: String, label: String, color: Color, path: String) -> Button:
	var button := Button.new()
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.tooltip_text = label
	button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	button.custom_minimum_size = Vector2(0, 70)
	var normal := UI.box(color, Color(1, 1, 1, 0.14), 11, 1)
	var hover := UI.box(color.lightened(0.08), Color(1, 1, 1, 0.22), 11, 1)
	for state in ["normal", "focus"]:
		button.add_theme_stylebox_override(state, normal)
	for state in ["hover", "pressed", "hover_pressed"]:
		button.add_theme_stylebox_override(state, hover)
	var image := Image.new()
	var svg := "<svg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'><path fill='#ffffff' d='%s'/></svg>" % path
	if image.load_svg_from_string(svg, 32.0 / 24.0) == OK:
		var mark := TextureRect.new()
		mark.texture = ImageTexture.create_from_image(image)
		mark.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
		mark.mouse_filter = Control.MOUSE_FILTER_IGNORE
		mark.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		button.add_child(mark)
	button.pressed.connect(func() -> void: OS.shell_open(url))
	return button


func _open_workspace(section: String, scope: String, rect: Rect2) -> void:
	_workspace_scope = scope
	if not _workspace:
		_workspace = WorkspaceScript.new()
		add_child(_workspace)
		_workspace.back_requested.connect(_on_workspace_back)
		_workspace.close_requested.connect(func() -> void: close())
		_workspace.open_debug_console.connect(func() -> void:
			open_debug_console.emit()
			close())
		_workspace.setting_changed.connect(func(key: String, value: Variant) -> void:
			if key == "map_mode":
				map_mode = str(value)
			setting_changed.emit(key, value))
	_workspace.setup(engine, {"scope": scope, "section": section, "map_mode": map_mode, "context": context, "export_dir": export_dir, "reveal_saved_files": reveal_saved_files})
	_card.visible = false
	move_child(_workspace, get_child_count() - 1)
	await _workspace.open(section, rect)


func _on_workspace_back() -> void:
	if _workspace_scope == "app":
		close()
		return
	tab = "settings" if tab.is_empty() else tab
	_show_tab(tab)
	_show_card(false)


class ActionTile extends PanelContainer:
	signal pressed

	var disabled := false
	var _normal: StyleBox
	var _hover: StyleBox

	func _init(normal: StyleBox, hover: StyleBox) -> void:
		_normal = normal
		_hover = hover
		add_theme_stylebox_override("panel", _normal)
		mouse_filter = Control.MOUSE_FILTER_STOP
		mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		mouse_entered.connect(func() -> void:
			if not disabled:
				add_theme_stylebox_override("panel", _hover))
		mouse_exited.connect(func() -> void: add_theme_stylebox_override("panel", _normal))

	func set_disabled(reason: String) -> void:
		disabled = true
		UI.set_disabled_look(self, reason)
		mouse_default_cursor_shape = Control.CURSOR_ARROW

	func _gui_input(event: InputEvent) -> void:
		if disabled:
			return
		if event is InputEventMouseButton:
			var click := event as InputEventMouseButton
			if click.button_index == MOUSE_BUTTON_LEFT and not click.pressed and get_global_rect().has_point(click.global_position):
				accept_event()
				pressed.emit()


class ApiSetupPrompt extends Control:
	signal configure
	signal dismissed
	signal saved

	const TUTORIAL_VIDEO_URL := "https://www.youtube.com/watch?v=YdalQ8UqMR4"
	const AI_STUDIO_KEY_URL := "https://aistudio.google.com/app/apikey"
	const ENDPOINT_PLACEHOLDERS := {"openai-compatible": "http://localhost:11434/v1", "anthropic-compatible": "https://my-proxy.example/v1"}
	const EYE_SVG := "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z'/><circle cx='12' cy='12' r='3'/></svg>"
	const EYE_OFF_SVG := "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24'/><line x1='1' y1='1' x2='23' y2='23'/></svg>"

	var link: EngineLink
	var setup := {}
	var provider := "gemini"
	var api_key := ""
	var endpoint := ""
	var model := ""
	var error := ""
	var show_key := false
	var show_tutorial := true
	var online := true
	var _body: VBoxContainer
	var _scroll: ScrollContainer
	var _model_line: LineEdit
	var _suggest_box: PanelContainer
	var _suggest_list: VBoxContainer
	var _online_timer: Timer

	func _init(engine_link: EngineLink, setup_data: Dictionary) -> void:
		link = engine_link
		setup = setup_data
		provider = str(setup.get("defaultProvider", "gemini"))
		set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		mouse_filter = Control.MOUSE_FILTER_STOP
		var dim := ColorRect.new()
		dim.color = Color(0, 0, 0, 0.42)
		dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		add_child(dim)
		var centre := CenterContainer.new()
		centre.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		add_child(centre)
		var card := PanelContainer.new()
		card.add_theme_stylebox_override("panel", UI.box(Color(32 / 255.0, 32 / 255.0, 35 / 255.0, 0.965), UI.HUD_BORDER, 16, 1, Vector4(22.4, 21.6, 22.4, 19.2)))
		card.custom_minimum_size.x = 544
		_scroll = ScrollContainer.new()
		_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
		_scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_SHOW_NEVER
		_scroll.custom_minimum_size = Vector2(499, 600)
		_body = VBoxContainer.new()
		_body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		_body.add_theme_constant_override("separation", 0)
		_scroll.add_child(_body)
		card.add_child(_scroll)
		centre.add_child(card)
		resized.connect(_fit)
		_suggest_box = PanelContainer.new()
		_suggest_box.add_theme_stylebox_override("panel", UI.box(Color("#1f1f23"), Color(1, 1, 1, 0.16), 6, 1, Vector4(3, 3, 3, 3)))
		_suggest_box.visible = false
		_suggest_box.mouse_filter = Control.MOUSE_FILTER_STOP
		_suggest_list = VBoxContainer.new()
		_suggest_list.add_theme_constant_override("separation", 0)
		_suggest_box.add_child(_suggest_list)
		add_child(_suggest_box)
		_online_timer = Timer.new()
		_online_timer.wait_time = 3.0
		_online_timer.timeout.connect(_check_online)
		add_child(_online_timer)
		_render()

	func _ready() -> void:
		_online_timer.start()
		_check_online()

	func _check_online() -> void:
		if not link or not link.is_ready():
			return
		var reply: Dictionary = await link.request("net.online")
		if not is_instance_valid(self) or not reply.get("ok", false):
			return
		var next := bool((reply.get("result", {}) as Dictionary).get("online", true))
		if next != online:
			online = next
			if show_tutorial:
				_render()

	func _recent_models() -> Array:
		var table: Variant = setup.get("recentModels", {})
		if table is Dictionary and (table as Dictionary).get(provider) is Array:
			return (table as Dictionary)[provider]
		return []

	func _show_suggestions() -> void:
		if not _model_line or not is_instance_valid(_model_line) or not _model_line.has_focus():
			_suggest_box.visible = false
			return
		for child in _suggest_list.get_children():
			_suggest_list.remove_child(child)
			child.queue_free()
		var typed := model.strip_edges().to_lower()
		var shown := 0
		for entry: Variant in _recent_models():
			var value := str(entry)
			if value.is_empty() or value == model or (not typed.is_empty() and not value.to_lower().contains(typed)):
				continue
			var row := Button.new()
			row.text = value
			row.alignment = HORIZONTAL_ALIGNMENT_LEFT
			row.focus_mode = Control.FOCUS_NONE
			row.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
			row.add_theme_font_override("font", UI.font(400))
			row.add_theme_font_size_override("font_size", 13)
			row.add_theme_color_override("font_color", Color("#f4f4f5"))
			row.add_theme_color_override("font_hover_color", UI.WHITE)
			row.add_theme_stylebox_override("normal", UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 4, 0, Vector4(8, 5, 8, 5)))
			row.add_theme_stylebox_override("hover", UI.box(Color(1, 1, 1, 0.1), Color(0, 0, 0, 0), 4, 0, Vector4(8, 5, 8, 5)))
			row.add_theme_stylebox_override("pressed", UI.box(Color(1, 1, 1, 0.1), Color(0, 0, 0, 0), 4, 0, Vector4(8, 5, 8, 5)))
			row.pressed.connect(func() -> void:
				model = value
				if _model_line and is_instance_valid(_model_line):
					_model_line.text = value
					_model_line.caret_column = value.length()
				_suggest_box.visible = false)
			_suggest_list.add_child(row)
			shown += 1
		if shown == 0:
			_suggest_box.visible = false
			return
		var origin := _model_line.get_global_rect()
		_suggest_box.visible = true
		_suggest_box.size = Vector2(origin.size.x, 0)
		_suggest_box.reset_size()
		_suggest_box.size.x = origin.size.x
		_suggest_box.global_position = origin.position + Vector2(0, origin.size.y + 2)
		move_child(_suggest_box, get_child_count() - 1)

	func _hide_suggestions_later() -> void:
		await get_tree().process_frame
		if is_instance_valid(self) and _model_line and is_instance_valid(_model_line) and not _model_line.has_focus():
			_suggest_box.visible = false

	func _fit() -> void:
		if not is_inside_tree():
			return
		var room := get_viewport_rect().size.y - 32.0 - 40.8
		_scroll.custom_minimum_size = Vector2(499, minf(room, _body.get_combined_minimum_size().y))

	func _requirement() -> String:
		for option: Dictionary in setup.get("providers", []):
			if str(option.get("value", "")) == provider:
				return str(option.get("requirement", "apiKey"))
		return "apiKey"

	func _meta_label() -> String:
		for option: Dictionary in setup.get("providers", []):
			if str(option.get("value", "")) == provider:
				return str(option.get("label", ""))
		return provider

	func _model_placeholder() -> String:
		var chain: Array = setup.get("geminiChain", [])
		match provider:
			"gemini":
				return "Blank: %s, %s as backup" % [str(chain[0]) if chain.size() > 0 else "", str(chain[1]) if chain.size() > 1 else ""]
			"anthropic", "anthropic-compatible":
				return "claude-haiku-4-5"
			"openai":
				return "Blank: %s" % str(setup.get("openaiDefault", ""))
			"openai-compatible":
				return "Blank picks a chat model from the server"
		return "Model id"

	func _gap(height: float) -> void:
		var spacer := Control.new()
		spacer.custom_minimum_size.y = height
		spacer.mouse_filter = Control.MOUSE_FILTER_IGNORE
		_body.add_child(spacer)

	func _label(text: String) -> Label:
		return UI.label(text.to_upper(), 12, Color(1, 1, 1, 0.72), 700)

	func _input_box(line: Control) -> void:
		var normal := UI.box(Color(0, 0, 0, 0.35), Color(1, 1, 1, 0.14), 8, 1, Vector4(10.4, 8.8, 10.4, 8.8))
		var focus := UI.box(Color(0, 0, 0, 0.4), Color(1, 1, 1, 0.26), 8, 1, Vector4(10.4, 8.8, 10.4, 8.8))
		line.add_theme_stylebox_override("normal", normal)
		line.add_theme_stylebox_override("focus", focus)
		line.add_theme_font_override("font", UI.font(400))
		line.add_theme_font_size_override("font_size", 14)
		line.add_theme_color_override("font_color", UI.WHITE)
		line.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.36))

	func _helper(text: String) -> Label:
		var node := UI.wrapped(text, 11, Color(1, 1, 1, 0.45))
		node.add_theme_constant_override("line_spacing", 3)
		return node

	func _button(text: String, kind: String, on_press: Callable) -> Button:
		var button := Button.new()
		button.text = text
		button.focus_mode = Control.FOCUS_NONE
		button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		var bg := Color(1, 1, 1, 0.05)
		var border := Color(1, 1, 1, 0.12)
		var ink := Color(1, 1, 1, 0.78)
		if kind == "primary":
			bg = Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.22)
			border = Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.4)
			ink = Color("#dbeafe")
		elif kind == "link":
			bg = Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.14)
			border = Color(74 / 255.0, 222 / 255.0, 128 / 255.0, 0.35)
			ink = Color("#bbf7d0")
		var normal := UI.box(bg, border, 10, 1, Vector4(16, 9.6, 16, 9.6))
		var hover := UI.box(Color(bg.r, bg.g, bg.b, minf(1.0, bg.a + 0.06)), Color(border.r, border.g, border.b, minf(1.0, border.a + 0.1)), 10, 1, Vector4(16, 9.6, 16, 9.6))
		for state in ["normal", "focus", "disabled"]:
			button.add_theme_stylebox_override(state, normal)
		for state in ["hover", "pressed", "hover_pressed"]:
			button.add_theme_stylebox_override(state, hover)
		button.add_theme_font_override("font", UI.font(750))
		button.add_theme_font_size_override("font_size", 13)
		for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color", "font_disabled_color"]:
			button.add_theme_color_override(name, ink)
		button.pressed.connect(func() -> void: on_press.call())
		return button

	func _svg(svg: String, size: int, color: Color) -> Texture2D:
		var image := Image.new()
		if image.load_svg_from_string(svg.replace("#fff", "#" + color.to_html(false)), float(size) / 24.0) != OK:
			return null
		return ImageTexture.create_from_image(image)

	func _render() -> void:
		for child in _body.get_children():
			_body.remove_child(child)
			child.queue_free()
		var self_hosted := _requirement() == "endpoint"
		var label := _meta_label()
		_body.add_child(UI.label("Set up your AI provider", 17, UI.WHITE, 900))
		_gap(8)
		var intro := UI.wrapped("Open Historia writes every turn, advisor reply and diplomatic message with an AI model, and %s has %s missing. Until it is set, time skips fall back to canned events and the advisor cannot answer. Paste your details below and you are ready to play." % [str(setup.get("providerLabel", "the selected provider")), str(setup.get("missing", "an API key"))], 13, Color(1, 1, 1, 0.64))
		intro.add_theme_constant_override("line_spacing", 5)
		_body.add_child(intro)
		_gap(14.4)
		var box := PanelContainer.new()
		box.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.09), 12, 1, Vector4(14.4, 12.8, 14.4, 12.8)))
		var box_column := VBoxContainer.new()
		box_column.add_theme_constant_override("separation", 0)
		var head := HBoxContainer.new()
		head.add_theme_constant_override("separation", 8)
		var texts := VBoxContainer.new()
		texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		texts.add_theme_constant_override("separation", 2)
		texts.add_child(UI.label("New to API keys?", 14, UI.WHITE, 800))
		texts.add_child(UI.wrapped("A Gemini key is free. The video walks through getting one; the button opens the page where it is made.", 12, Color(1, 1, 1, 0.55)))
		head.add_child(texts)
		var get_key := _button("Get a key at Google AI Studio ↗", "link", func() -> void: OS.shell_open(AI_STUDIO_KEY_URL))
		get_key.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		head.add_child(get_key)
		box_column.add_child(head)
		if show_tutorial and not online:
			var spacer := Control.new()
			spacer.custom_minimum_size.y = 11
			box_column.add_child(spacer)
			var note := PanelContainer.new()
			note.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0.3), Color(0, 0, 0, 0), 10, 0, Vector4(14.4, 12.8, 14.4, 12.8)))
			var words := UI.wrapped("The video needs an internet connection. It plays here as soon as you are back online, and so does getting a key.", 12, Color(1, 1, 1, 0.6))
			words.add_theme_constant_override("line_spacing", 3)
			note.add_child(words)
			box_column.add_child(note)
		if show_tutorial:
			var spacer := Control.new()
			spacer.custom_minimum_size.y = 11 if online else 6
			box_column.add_child(spacer)
			var video := Button.new()
			video.focus_mode = Control.FOCUS_NONE
			video.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
			video.custom_minimum_size = Vector2(0, 268)
			video.text = "▶   Play the video (loads YouTube)"
			video.add_theme_stylebox_override("normal", UI.box(Color(0, 0, 0, 0.5), Color(0, 0, 0, 0), 10, 0))
			video.add_theme_stylebox_override("hover", UI.box(Color(0, 0, 0, 0.42), Color(0, 0, 0, 0), 10, 0))
			video.add_theme_stylebox_override("pressed", UI.box(Color(0, 0, 0, 0.42), Color(0, 0, 0, 0), 10, 0))
			video.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
			video.add_theme_font_override("font", UI.font(750))
			video.add_theme_font_size_override("font_size", 13)
			video.add_theme_color_override("font_color", Color(1, 1, 1, 0.86))
			video.add_theme_color_override("font_hover_color", UI.WHITE)
			video.pressed.connect(func() -> void: OS.shell_open(TUTORIAL_VIDEO_URL))
			if online:
				box_column.add_child(video)
				var spacer_two := Control.new()
				spacer_two.custom_minimum_size.y = 6
				box_column.add_child(spacer_two)
			else:
				video.queue_free()
			var links := HBoxContainer.new()
			var watch := LinkButton.new()
			watch.text = "Watch on YouTube ↗"
			watch.underline = LinkButton.UNDERLINE_MODE_ALWAYS
			watch.add_theme_font_size_override("font_size", 11)
			watch.add_theme_color_override("font_color", Color(147 / 255.0, 197 / 255.0, 253 / 255.0, 0.9))
			watch.pressed.connect(func() -> void: OS.shell_open(TUTORIAL_VIDEO_URL))
			links.add_child(watch)
			links.add_child(UI.spacer())
			var hide := Button.new()
			hide.text = "Hide the video"
			hide.flat = true
			hide.focus_mode = Control.FOCUS_NONE
			hide.add_theme_font_size_override("font_size", 11)
			hide.add_theme_color_override("font_color", Color(1, 1, 1, 0.45))
			hide.pressed.connect(func() -> void:
				show_tutorial = false
				_render())
			links.add_child(hide)
			box_column.add_child(links)
		else:
			var spacer := Control.new()
			spacer.custom_minimum_size.y = 9.6
			box_column.add_child(spacer)
			var show_video := _button("Show the video tutorial", "quiet", func() -> void:
				show_tutorial = true
				_render())
			show_video.add_theme_font_size_override("font_size", 12)
			show_video.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
			box_column.add_child(show_video)
		box.add_child(box_column)
		_body.add_child(box)
		_gap(15.2)
		_body.add_child(_label("Provider"))
		_gap(4.8)
		var select := OptionButton.new()
		select.focus_mode = Control.FOCUS_NONE
		select.custom_minimum_size.y = 38
		_input_box(select)
		select.add_theme_stylebox_override("hover", UI.box(Color(0, 0, 0, 0.4), Color(1, 1, 1, 0.2), 8, 1, Vector4(10.4, 8.8, 10.4, 8.8)))
		select.add_theme_stylebox_override("pressed", UI.box(Color(0, 0, 0, 0.4), Color(1, 1, 1, 0.2), 8, 1, Vector4(10.4, 8.8, 10.4, 8.8)))
		var popup := select.get_popup()
		popup.add_theme_stylebox_override("panel", UI.box(Color("#1f1f23"), Color(1, 1, 1, 0.12), 8, 1, Vector4(4, 4, 4, 4)))
		popup.add_theme_stylebox_override("hover", UI.box(Color(1, 1, 1, 0.08), Color(0, 0, 0, 0), 6, 0))
		popup.add_theme_color_override("font_color", Color("#f4f4f5"))
		popup.add_theme_color_override("font_separator_color", Color(1, 1, 1, 0.55))
		popup.add_theme_font_size_override("font_size", 13)
		var group := ""
		var selected_index := -1
		for option: Dictionary in setup.get("providers", []):
			var option_group := str(option.get("group", "Providers"))
			if option_group != group:
				group = option_group
				select.add_separator(group)
			select.add_item("%s — %s" % [str(option.get("label", "")), str(option.get("description", ""))])
			var index := select.item_count - 1
			select.set_item_metadata(index, str(option.get("value", "")))
			if str(option.get("value", "")) == provider:
				selected_index = index
		if selected_index >= 0:
			select.select(selected_index)
		select.item_selected.connect(func(index: int) -> void:
			provider = str(select.get_item_metadata(index))
			error = ""
			endpoint = str(ENDPOINT_PLACEHOLDERS.get(provider, "")) if _requirement() == "endpoint" else ""
			_render())
		_body.add_child(select)
		_gap(12)
		if self_hosted:
			_body.add_child(_label("API endpoint"))
			_gap(4.8)
			var endpoint_line := LineEdit.new()
			endpoint_line.text = endpoint
			endpoint_line.placeholder_text = str(ENDPOINT_PLACEHOLDERS.get(provider, "https://…"))
			endpoint_line.custom_minimum_size.y = 38
			_input_box(endpoint_line)
			endpoint_line.text_changed.connect(func(text: String) -> void:
				endpoint = text
				_refresh_save())
			_body.add_child(endpoint_line)
			_gap(4.8)
			_body.add_child(_helper("Base URL that exposes /chat/completions and /models (Ollama, LM Studio, OpenRouter, a gateway)." if provider == "openai-compatible" else "Base URL of a self-hosted proxy that speaks the Anthropic Messages API."))
			_gap(12)
		_body.add_child(_label("API key (optional)" if self_hosted else "%s API key" % label))
		_gap(4.8)
		var key_holder := Control.new()
		key_holder.custom_minimum_size.y = 38
		var key_line := LineEdit.new()
		key_line.text = api_key
		key_line.secret = not show_key
		key_line.placeholder_text = "Leave empty if your server needs none" if self_hosted else "Paste your %s API key" % label
		key_line.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		_input_box(key_line)
		key_line.add_theme_stylebox_override("normal", UI.box(Color(0, 0, 0, 0.35), Color(1, 1, 1, 0.14), 8, 1, Vector4(10.4, 8.8, 40, 8.8)))
		key_line.add_theme_stylebox_override("focus", UI.box(Color(0, 0, 0, 0.4), Color(1, 1, 1, 0.26), 8, 1, Vector4(10.4, 8.8, 40, 8.8)))
		key_line.text_changed.connect(func(text: String) -> void:
			api_key = text
			_refresh_save())
		key_line.text_submitted.connect(func(_text: String) -> void: _save())
		key_holder.add_child(key_line)
		var eye := Button.new()
		eye.flat = true
		eye.focus_mode = Control.FOCUS_NONE
		eye.icon = _svg(EYE_OFF_SVG if show_key else EYE_SVG, 18, Color("#38bdf8") if show_key else Color(1, 1, 1, 0.65))
		eye.tooltip_text = "Hide API key" if show_key else "Show API key"
		eye.anchor_left = 1.0
		eye.anchor_right = 1.0
		eye.offset_left = -38
		eye.offset_right = -4
		eye.offset_top = 3
		eye.offset_bottom = 35
		eye.pressed.connect(func() -> void:
			show_key = not show_key
			key_line.secret = not show_key
			eye.icon = _svg(EYE_OFF_SVG if show_key else EYE_SVG, 18, Color("#38bdf8") if show_key else Color(1, 1, 1, 0.65))
			eye.tooltip_text = "Hide API key" if show_key else "Show API key")
		key_holder.add_child(eye)
		_body.add_child(key_holder)
		_gap(4.8)
		_body.add_child(_helper("Stored only in this browser. It is sent to %s and nowhere else." % label))
		_gap(12)
		_body.add_child(_label("Model (optional)"))
		_gap(4.8)
		var model_line := LineEdit.new()
		model_line.text = model
		model_line.placeholder_text = _model_placeholder()
		model_line.custom_minimum_size.y = 38
		_input_box(model_line)
		_model_line = model_line
		_suggest_box.visible = false
		model_line.text_changed.connect(func(text: String) -> void:
			model = text
			_show_suggestions())
		model_line.focus_entered.connect(_show_suggestions)
		model_line.focus_exited.connect(_hide_suggestions_later)
		model_line.gui_input.connect(func(event: InputEvent) -> void:
			if event is InputEventMouseButton and (event as InputEventMouseButton).pressed and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT:
				_show_suggestions.call_deferred()
			elif event is InputEventKey and (event as InputEventKey).pressed and (event as InputEventKey).keycode == KEY_ESCAPE and _suggest_box.visible:
				_suggest_box.visible = false
				model_line.accept_event())
		model_line.text_submitted.connect(func(_text: String) -> void:
			_suggest_box.visible = false
			_save())
		_body.add_child(model_line)
		_gap(4.8)
		_body.add_child(_helper("Leave blank for the default. You can add more models and backup providers later under the game menu, Settings, AI."))
		if not error.is_empty():
			_gap(11.2)
			_body.add_child(UI.wrapped(error, 12, Color("#fca5a5")))
		_gap(17.6)
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 8)
		row.add_child(UI.spacer())
		row.add_child(_button("Not now", "quiet", func() -> void: dismissed.emit()))
		row.add_child(_button("Open full settings", "quiet", func() -> void: configure.emit()))
		var save_button := _button("Save and play", "primary", func() -> void: _save())
		save_button.name = "SaveAndPlay"
		row.add_child(save_button)
		_body.add_child(row)
		_refresh_save()
		_fit.call_deferred()

	func _refresh_save() -> void:
		var button := _body.find_child("SaveAndPlay", true, false) as Button
		if not button:
			return
		var self_hosted := _requirement() == "endpoint"
		var can_save := not endpoint.strip_edges().is_empty() if self_hosted else not api_key.strip_edges().is_empty()
		button.modulate.a = 1.0 if can_save else 0.5
		button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if can_save else Control.CURSOR_FORBIDDEN
		button.tooltip_text = "Save these settings and start playing" if can_save else ("Enter the server endpoint first" if self_hosted else "Paste an API key first")

	func _save() -> void:
		var self_hosted := _requirement() == "endpoint"
		var can_save := not endpoint.strip_edges().is_empty() if self_hosted else not api_key.strip_edges().is_empty()
		if not can_save or not link:
			return
		var reply: Dictionary = await link.request("settings.quickSetup", {"provider": provider, "apiKey": api_key, "endpoint": endpoint, "model": model})
		if not reply.get("ok", false):
			error = str(reply.get("error", "The settings could not be saved."))
			_render()
			return
		error = ""
		if bool((reply.get("result", {}) as Dictionary).get("ready", false)):
			saved.emit()
		else:
			_render()
