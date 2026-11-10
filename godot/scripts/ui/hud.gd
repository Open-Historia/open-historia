class_name Hud
extends Control

signal exit_game
signal open_menu
signal dock_panel(name: String, open: bool)
signal open_country
signal open_advisor
signal map_mode_changed(mode: String)
signal turn_landed(view: Dictionary)
signal open_interactive
signal world_changed
signal dock_resized

const DOCK_LAUNCHERS := [["chat", "Chat", 18], ["actions", "Actions and Projects", 16], ["social", "Rostra", 18]]
const PANEL_FILES := ["map_cards", "chat_panel", "actions_panel", "projects_panel", "rostra_panel", "rostra_search", "advisor_panel", "country_panel", "search_box", "diplomatic_legend", "chat_notices"]

var date_widget: DateWidget
var search_slot: Control
var active_panel := ""
var map_mode := "political"
var _pill_subtitle: Label
var _flag: TextureRect
var _flag_fallback: Label
var _flag_frame: GlassPanel
var _advisor_frame: GlassPanel
var _launchers := {}
var _chat_badge: PanelContainer
var _chat_badge_label: Label
var _dock: GlassPanel
var _rostra_badge: PanelContainer
var _rostra_badge_label: Label
var _rostra_unseen := 0
var _social_on := true
var _beside_war_room := false
var _mode_buttons := {}
var panels := {}
var drawers := {}
var map_cards: Control
var search: Control
var legend: Control
var chat_notices: Control
var open_drawer := ""
var _engine: EngineLink
var _right_layer: Control
var cheats: Node
var forces: Node
var war: Node
var after_action: Node
var _inset_tween: Tween
var _map: MapView
var _game: Dictionary = {}
var _game_name := ""
var _typing_timer: Timer
var _typing_dots := 1
var _advisor_button: Button
var _flag_info: Dictionary = {}


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_build_top_left()
	_build_dock()
	_build_bottom_right()
	date_widget = DateWidget.new()
	add_child(date_widget)
	UiTheme.events().changed.connect(_on_theme_changed)
	_on_theme_changed()
	date_widget.panel_changed.connect(_on_date_panel)
	date_widget.turn_landed.connect(func(view: Dictionary) -> void: turn_landed.emit(view))
	date_widget.open_interactive.connect(func() -> void: open_interactive.emit())
	_typing_timer = Timer.new()
	_typing_timer.wait_time = 0.45
	_typing_timer.timeout.connect(func() -> void:
		_typing_dots = (_typing_dots % 3) + 1
		if _chat_badge_label:
			_chat_badge_label.text = ".".repeat(_typing_dots)
			_fit_chat_badge())
	add_child(_typing_timer)


func _on_theme_changed() -> void:
	set_map_mode(map_mode)
	for name in _launchers.keys():
		_style_launcher(str(name), false)
	_refresh_flag_badge()


func setup(engine: EngineLink, map: MapView) -> void:
	_engine = engine
	_map = map
	date_widget.setup(engine, map)
	map.region_clicked.connect(_on_region_clicked)
	date_widget.turn_landed.connect(func(_view: Dictionary) -> void: refresh_panels())


func _glass(tint: Color, radius: float, rect: Rect2, anchors := Vector4(0, 0, 0, 0), inner := Vector4(0, 0, 0, 0), parent: Control = null) -> GlassPanel:
	var panel := GlassPanel.new(tint, radius, inner)
	panel.anchor_left = anchors.x
	panel.anchor_top = anchors.y
	panel.anchor_right = anchors.z
	panel.anchor_bottom = anchors.w
	panel.offset_left = rect.position.x
	panel.offset_top = rect.position.y
	panel.offset_right = rect.position.x + rect.size.x
	panel.offset_bottom = rect.position.y + rect.size.y
	if parent:
		parent.add_child(panel)
	else:
		add_child(panel)
	return panel


func _flat_button(text: String, size := 13, weight := 600, ink := UI.BUTTON_INK) -> Button:
	var button := Button.new()
	button.text = text
	button.flat = true
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.add_theme_font_override("font", UI.font(weight))
	button.add_theme_font_size_override("font_size", size)
	for name in ["font_color", "font_focus_color"]:
		button.add_theme_color_override(name, ink)
	for name in ["font_hover_color", "font_pressed_color", "font_hover_pressed_color"]:
		button.add_theme_color_override(name, UI.WHITE)
	var hover := UI.box(Color(1, 1, 1, 0.06), Color(0, 0, 0, 0), 8, 0)
	button.add_theme_stylebox_override("hover", hover)
	button.add_theme_stylebox_override("pressed", hover)
	button.add_theme_stylebox_override("normal", StyleBoxEmpty.new())
	button.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	return button


func _theme_rim(frame: Control, source: Control, corner: float) -> Panel:
	var rim := Panel.new()
	rim.mouse_filter = Control.MOUSE_FILTER_IGNORE
	rim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	rim.visible = false
	rim.set_meta("theme_rim", true)
	frame.add_child(rim)
	source.mouse_entered.connect(_rim_hover.bind(rim, source, corner, true))
	source.mouse_exited.connect(_rim_hover.bind(rim, source, corner, false))
	UiTheme.events().changed.connect(_paint_rim.bind(rim, source, corner))
	_paint_rim(rim, source, corner)
	return rim


func _rim_hover(rim: Panel, source: Control, corner: float, hovered: bool) -> void:
	if not is_instance_valid(rim):
		return
	rim.set_meta("hovered", hovered)
	if hovered:
		_paint_rim(rim, source, corner)
	else:
		rim.visible = false


func _paint_rim(rim: Panel, source: Control, corner: float) -> void:
	if not is_instance_valid(rim) or not is_instance_valid(source):
		return
	var ring := UI.box(Color(0, 0, 0, 0), UiTheme.pick("accent", Color(0, 0, 0, 0)), int(corner) + 2, 1)
	ring.set_expand_margin_all(2)
	rim.add_theme_stylebox_override("panel", ring)
	rim.visible = UiTheme.themed() and bool(rim.get_meta("hovered", false)) and not (source is BaseButton and (source as BaseButton).disabled)


func _build_top_left() -> void:
	var menu := _glass(UI.HUD_BUTTON, 12, Rect2(8, 8, 46, 46)).theme_as("glass_pill", "hud_border")
	var menu_button := _flat_button("☰", 19, 800, UI.WHITE)
	menu_button.tooltip_text = "Game menu"
	menu_button.pressed.connect(func() -> void: open_menu.emit())
	menu.add_child(menu_button)
	_theme_rim(menu, menu_button, 12)
	var pill := _glass(UI.HUD_PILL, 12, Rect2(61, 8, 240, 46), Vector4(0, 0, 0, 0), Vector4(12, 0, 12, 0)).theme_as("glass_pill", "hud_border")
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 9)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var mark := TextureRect.new()
	mark.texture = UI.logo()
	mark.custom_minimum_size = Vector2(30, 30)
	mark.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	mark.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	mark.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(mark)
	var text := VBoxContainer.new()
	text.alignment = BoxContainer.ALIGNMENT_CENTER
	text.add_theme_constant_override("separation", 1)
	text.add_child(UI.label("Open Historia", 12, Color(1, 1, 1, 0.94), 800))
	_pill_subtitle = UI.label("", 10, Color(226 / 255.0, 226 / 255.0, 229 / 255.0, 0.42))
	_pill_subtitle.clip_text = true
	_pill_subtitle.custom_minimum_size.x = 170
	text.add_child(_pill_subtitle)
	row.add_child(text)
	pill.add_child(row)
	var exit := _glass(UI.HUD_PILL, 12, Rect2(308, 8, 92, 46)).theme_as("glass_pill", "hud_border")
	var exit_button := _flat_button("⌂ Exit Game", 11, 600)
	exit_button.tooltip_text = "Leave this game and return to the main menu"
	exit_button.pressed.connect(func() -> void: exit_game.emit())
	exit.add_child(exit_button)


func _launcher_style(open: bool, hovered: bool) -> StyleBoxFlat:
	if open:
		return UI.box(UiTheme.pick("glass_active", Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.16)), UiTheme.pick("glass_active_line", Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.34)), 10, 1)
	var fill := UiTheme.pick("glass_hover", Color(1, 1, 1, 0.08)) if hovered else UiTheme.pick("glass_chip", Color(1, 1, 1, 0.04))
	return UI.box(fill, UiTheme.pick("glass_line", Color(1, 1, 1, 0.1)), 10, 1)


func _build_dock() -> void:
	var dock := _glass(UI.HUD_BG, 14, Rect2(8, -72, 205, 64), Vector4(0, 1, 0, 1), Vector4(11, 5, 11, 5)).theme_as("glass_pill", "hud_border")
	_dock = dock
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	for entry in DOCK_LAUNCHERS:
		var name: String = entry[0]
		var tile := Button.new()
		tile.focus_mode = Control.FOCUS_NONE
		tile.custom_minimum_size = Vector2(53, 53)
		tile.tooltip_text = entry[1]
		tile.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		var glyph := RostraPanel.dock_glyph(entry[2]) if name == "social" else UI.icon_rect(name, entry[2])
		glyph.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		tile.add_child(glyph)
		tile.pressed.connect(func() -> void: toggle_dock(name))
		tile.mouse_entered.connect(func() -> void: _style_launcher(name, true))
		tile.mouse_exited.connect(func() -> void: _style_launcher(name, false))
		_launchers[name] = tile
		_style_launcher(name, false)
		if name == "chat":
			_chat_badge = PanelContainer.new()
			_chat_badge.add_theme_stylebox_override("panel", UI.box(Color("#dc2626"), Color(1, 1, 1, 0.35), 999, 1, Vector4(3, 0, 3, 0)))
			_chat_badge.custom_minimum_size = Vector2(17, 17)
			_chat_badge.mouse_filter = Control.MOUSE_FILTER_IGNORE
			_chat_badge.position = Vector2(35, 9)
			_chat_badge_label = UI.label("", 10, UI.WHITE, 700)
			_chat_badge_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			_chat_badge_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
			_chat_badge.add_child(_chat_badge_label)
			_chat_badge.visible = false
			tile.add_child(_chat_badge)
		if name == "social":
			_rostra_badge = PanelContainer.new()
			var badge_style := UI.box(UI.ACCENT, Color(1, 1, 1, 0.35), 999, 1, Vector4(3, 0, 3, 0))
			badge_style.shadow_color = Color(0, 0, 0, 0.5)
			badge_style.shadow_size = 2
			badge_style.shadow_offset = Vector2(0, 1)
			_rostra_badge.add_theme_stylebox_override("panel", badge_style)
			_rostra_badge.custom_minimum_size = Vector2(17, 17)
			_rostra_badge.mouse_filter = Control.MOUSE_FILTER_IGNORE
			_rostra_badge_label = UI.label("", 10, Color("#06171d"), 800)
			_rostra_badge_label.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
			_rostra_badge_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			_rostra_badge_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
			_rostra_badge.add_child(_rostra_badge_label)
			_rostra_badge.visible = false
			tile.add_child(_rostra_badge)
		row.add_child(tile)
	dock.add_child(row)
	search_slot = Control.new()
	search_slot.anchor_top = 1.0
	search_slot.anchor_bottom = 1.0
	search_slot.offset_left = 221
	search_slot.offset_top = -52
	search_slot.offset_right = 259
	search_slot.offset_bottom = -14
	search_slot.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(search_slot)


func _style_launcher(name: String, hovered: bool) -> void:
	var tile: Button = _launchers.get(name)
	if not tile:
		return
	var open := active_panel == name
	var style := _launcher_style(open, hovered)
	for state in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
		tile.add_theme_stylebox_override(state, style)


func set_chat_badge(count: int, generating := false) -> void:
	if not _chat_badge:
		return
	_chat_badge.visible = active_panel != "chat" and (generating or count > 0)
	if generating:
		if _typing_timer.is_stopped():
			_typing_dots = 1
			_typing_timer.start()
		_chat_badge_label.text = ".".repeat(_typing_dots)
	else:
		_typing_timer.stop()
		_chat_badge_label.text = "9+" if count > 9 else str(count)
	_chat_badge_label.add_theme_font_size_override("font_size", 11 if generating else 10)
	_chat_badge.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0.35) if generating else Color("#dc2626"), Color(1, 1, 1, 0.35), 7 if generating else 999, 1, Vector4(5, 0, 5, 0) if generating else Vector4(3, 0, 3, 0)))
	_launchers["chat"].tooltip_text = "Chat — diplomacy in progress" if generating else "Chat"
	_fit_chat_badge()


func _fit_chat_badge() -> void:
	if not _chat_badge:
		return
	_chat_badge.reset_size()
	_chat_badge.position = Vector2(52.0 - _chat_badge.size.x, 9.0)


func set_rostra_badge(count: int) -> void:
	_rostra_unseen = count
	if not _rostra_badge:
		return
	_rostra_badge.visible = active_panel != "social" and count > 0
	_rostra_badge_label.text = "9+" if count > 9 else str(count)
	_rostra_badge.reset_size()
	_rostra_badge.position = Vector2(48.3 - _rostra_badge.size.x, 8.7)
	var tile: Button = _launchers.get("social")
	if tile:
		tile.tooltip_text = "Rostra"


func set_social_enabled(on: bool) -> void:
	_social_on = on
	var tile: Button = _launchers.get("social")
	if tile:
		tile.visible = on
	if not on and active_panel == "social":
		set_active_panel("")
	_place_dock()
	dock_resized.emit()


func beside_dock_left() -> float:
	return 8.0 + _dock_width() + 8.0


func _dock_width() -> float:
	var count := DOCK_LAUNCHERS.size() - (0 if _social_on else 1)
	return roundf((0.65 + count * (3.3 + 0.75)) * 16.0)


func _place_dock() -> void:
	if _dock:
		_dock.offset_right = _dock.offset_left + _dock_width()
	var left := beside_dock_left() + (72.0 if _beside_war_room else 0.0)
	search_slot.offset_left = left
	search_slot.offset_right = left + 38.0


func open_rostra(place: Dictionary) -> void:
	if not panels.has("social") or not _social_on:
		return
	if active_panel != "social":
		set_active_panel("social")
	_invoke(panels["social"], "open_place", [place])


func open_actions_tab(tab: String) -> void:
	if not panels.has("actions"):
		return
	_invoke(panels["actions"], "set_tab", [tab])
	set_active_panel("actions")


func toggle_dock(name: String) -> void:
	set_active_panel("" if active_panel == name else name)


func set_active_panel(name: String) -> void:
	var previous := active_panel
	active_panel = name
	for key in panels.keys():
		var panel: Control = panels[key]
		if is_instance_valid(panel):
			var should: bool = key == name
			if should != bool(panel.call("is_open")):
				panel.call("set_open", should)
	if name in ["skip", "history"]:
		if date_widget.open_panel != name:
			date_widget.set_panel(name)
	elif date_widget.open_panel != "":
		date_widget.set_panel("")
	for launcher in _launchers.keys():
		_style_launcher(launcher, false)
		if launcher == previous and previous != name:
			dock_panel.emit(launcher, false)
	if _launchers.has(name) and previous != name:
		dock_panel.emit(name, true)
	if _chat_badge:
		if name == "chat":
			_chat_badge.visible = false
		elif previous == "chat":
			set_chat_badge(_chat_unread, _chat_generating)
	if _rostra_badge:
		_rostra_badge.visible = name != "social" and _rostra_unseen > 0


func _on_date_panel(name: String) -> void:
	if name.is_empty():
		if active_panel in ["skip", "history"]:
			active_panel = ""
		return
	if active_panel != name:
		var previous := active_panel
		active_panel = name
		if panels.has(previous) and is_instance_valid(panels[previous]):
			(panels[previous] as Control).call("set_open", false)
		if _launchers.has(previous):
			_style_launcher(previous, false)
			dock_panel.emit(previous, false)


func _build_bottom_right() -> void:
	_right_layer = Control.new()
	_right_layer.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_right_layer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_right_layer)
	_flag_frame = _glass(UI.HUD_BUTTON, 14, Rect2(-72, -180, 64, 64), Vector4(1, 1, 1, 1), Vector4(8, 8, 8, 8), _right_layer)
	_flag = TextureRect.new()
	_flag.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_flag.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	_flag.clip_contents = true
	_flag.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_flag_frame.add_child(_flag)
	_flag_fallback = UI.label("🏳️", 24, UI.WHITE, 400, "Segoe UI Emoji")
	_flag_fallback.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_flag_fallback.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_flag_fallback.custom_minimum_size = Vector2(48, 48)
	_flag_fallback.visible = false
	_flag_frame.add_child(_flag_fallback)
	var flag_button := _flat_button("", 12)
	flag_button.tooltip_text = "Your country"
	flag_button.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	flag_button.add_theme_stylebox_override("hover", StyleBoxEmpty.new())
	flag_button.add_theme_stylebox_override("pressed", StyleBoxEmpty.new())
	flag_button.pressed.connect(func() -> void:
		if open_drawer == "country":
			close_drawer()
			return
		open_country.emit()
		show_country(str(_game.get("country", ""))))
	_flag_frame.add_child(flag_button)
	_theme_rim(_flag_frame, flag_button, 14)
	_advisor_frame = _glass(UI.HUD_BUTTON, 14, Rect2(-72, -112, 64, 64), Vector4(1, 1, 1, 1), Vector4(0, 0, 0, 0), _right_layer)
	var advisor := _flat_button("", 12)
	_advisor_button = advisor
	advisor.tooltip_text = "Advisor"
	advisor.icon = UI.icon("advisor", 22)
	advisor.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
	advisor.pressed.connect(func() -> void:
		open_advisor.emit()
		toggle_drawer("advisor"))
	_advisor_frame.add_child(advisor)
	_theme_rim(_advisor_frame, advisor, 14)
	var toggle := _glass(UI.HUD_BG, 12, Rect2(-206, -44, 198, 36), Vector4(1, 1, 1, 1), Vector4(4, 4, 4, 4), _right_layer).theme_as("glass_pill", "hud_border")
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 4)
	for entry in [["political", "Political", 87], ["diplomatic", "Diplomatic", 99]]:
		var mode: String = entry[0]
		var button := Button.new()
		button.text = entry[1]
		button.focus_mode = Control.FOCUS_NONE
		button.custom_minimum_size = Vector2(entry[2], 28)
		button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		button.add_theme_font_size_override("font_size", 12)
		button.pressed.connect(func() -> void:
			set_map_mode(mode, true)
			if _engine:
				_engine.request("hud.setMapMode", {"mode": mode})
			_apply_map_mode())
		button.tooltip_text = "Political map mode" if mode == "political" else "Diplomatic map mode"
		_mode_buttons[mode] = button
		row.add_child(button)
		_theme_rim(button, button, 8)
	toggle.add_child(row)
	set_map_mode("political")


func set_map_mode(mode: String, announce := false) -> void:
	map_mode = mode
	for key in _mode_buttons.keys():
		var button: Button = _mode_buttons[key]
		var on: bool = key == mode
		var diplomatic: bool = key == "diplomatic"
		var ink := Color(1, 1, 1, 0.55)
		var fill := Color(0, 0, 0, 0)
		var edge := Color(0, 0, 0, 0)
		if on and diplomatic:
			ink = UiTheme.pick("glass_active_text", Color("#60a5fa"))
			fill = UiTheme.pick("glass_active", Color(37 / 255.0, 99 / 255.0, 235 / 255.0, 0.3))
			edge = UiTheme.pick("glass_active_line", Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.4))
		elif on:
			ink = UI.WHITE
			fill = UiTheme.pick("glass_active", Color(1, 1, 1, 0.14))
		button.icon = UI.icon(key, 15, ink)
		button.add_theme_font_override("font", UI.font(600 if on else 400))
		for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
			button.add_theme_color_override(name, ink)
		var normal := UI.box(fill, edge, 8, 1 if diplomatic else 0)
		var hover := normal if on else UI.box(Color(1, 1, 1, 0.06), edge, 8, 1 if diplomatic else 0)
		button.add_theme_stylebox_override("normal", normal)
		button.add_theme_stylebox_override("focus", normal)
		button.add_theme_stylebox_override("hover", hover)
		button.add_theme_stylebox_override("pressed", hover)
	if announce:
		map_mode_changed.emit(mode)


func set_game(view: Dictionary, game_name: String) -> void:
	_game_name = game_name
	var country := str(view.get("countryName", ""))
	if country.is_empty():
		country = str(view.get("country", ""))
	var date := str(view.get("gameDate", ""))
	_pill_subtitle.text = "%s / %s / %s" % [game_name, country if not country.is_empty() else "No country", date if not date.is_empty() else "No date"]
	if not str(view.get("country", "")).is_empty():
		_game["country"] = str(view.get("country", ""))
		if view.has("countryName"):
			_game["countryName"] = str(view.get("countryName", ""))


func set_flag(texture: Texture2D, emoji := "") -> void:
	_flag.texture = texture
	_flag_fallback.text = emoji if texture == null and not emoji.is_empty() else "🏳️"
	_flag_fallback.add_theme_font_size_override("font_size", 22 if texture == null and not emoji.is_empty() else 16)
	_flag_fallback.visible = texture == null
	var fallback_box: StyleBox = StyleBoxEmpty.new() if not emoji.is_empty() else UI.box(Color(1, 1, 1, 0.063), Color(1, 1, 1, 0.12), 5, 1)
	_flag_fallback.add_theme_stylebox_override("normal", fallback_box)
	_refresh_flag_badge()


func set_flag_info(info: Dictionary) -> void:
	_flag_info = info
	var path := str(info.get("flag", ""))
	var texture: Texture2D = null
	if not path.is_empty():
		texture = UI.flag(path, 48) if path.get_extension().to_lower() == "svg" else _image_texture(path)
	set_flag(texture, str(info.get("emoji", "")))


func _image_texture(path: String) -> Texture2D:
	return ImageLoader.texture_from_file(path)


func enter_game() -> void:
	set_active_panel("")
	await date_widget.enter_game()


var _chat_unread := 0
var _chat_generating := false
var _unavailable := {}


static func warm_scripts(paths: Array) -> void:
	for path in paths:
		if not ResourceLoader.has_cached(path) and ResourceLoader.load_threaded_get_status(path) == ResourceLoader.THREAD_LOAD_INVALID_RESOURCE:
			ResourceLoader.load_threaded_request(path, "", true)


static func warm_panels() -> void:
	var paths := []
	for file in PANEL_FILES:
		paths.append("res://scripts/ui/%s.gd" % file)
	warm_scripts(paths)


static func take_script(path: String) -> Resource:
	var status := ResourceLoader.load_threaded_get_status(path)
	if status == ResourceLoader.THREAD_LOAD_INVALID_RESOURCE:
		return load(path)
	var deadline := Time.get_ticks_msec() + 4000
	while status == ResourceLoader.THREAD_LOAD_IN_PROGRESS and Time.get_ticks_msec() < deadline:
		OS.delay_usec(500)
		status = ResourceLoader.load_threaded_get_status(path)
	var warmed := ResourceLoader.load_threaded_get(path)
	return warmed if warmed else load(path)


func _make(file: String) -> Control:
	var script: Variant = take_script("res://scripts/ui/%s.gd" % file)
	if script is GDScript and (script as GDScript).can_instantiate():
		var made: Variant = (script as GDScript).new()
		if made is Control:
			return made
		if made is Node:
			(made as Node).queue_free()
	_unavailable[file] = true
	return null


func _hook(node: Object, signal_name: String, target: Callable) -> void:
	if node and node.has_signal(signal_name):
		node.connect(signal_name, target)


func _setup(node: Object, context: Dictionary) -> void:
	if node and node.has_method("setup"):
		node.call("setup", _engine, context)


func _invoke(node: Object, method: String, args: Array = []) -> Variant:
	if node and is_instance_valid(node) and node.has_method(method):
		return node.callv(method, args)
	return null


func mount_panels(game: Dictionary) -> void:
	_game = game
	_unavailable.clear()
	var old: Array = panels.values() + drawers.values() + [map_cards, search, legend, chat_notices]
	for node in old:
		if node is Node and is_instance_valid(node):
			(node as Node).queue_free()
	panels.clear()
	drawers.clear()
	open_drawer = ""
	active_panel = ""
	set_right_inset(0.0)
	var ctx := {"game": game, "map_view": _map}
	map_cards = _make("map_cards")
	if map_cards:
		add_child(map_cards)
		move_child(map_cards, 0)
		_hook(map_cards, "open_chat", open_chat)
		_hook(map_cards, "open_stats", func(name: String) -> void: show_country(name))
		_hook(map_cards, "flag_changed", func(_key: String) -> void: _reload_flag_and_map())
		_hook(map_cards, "open_rostra", open_rostra)
		var cards_ctx := ctx.duplicate()
		if forces and is_instance_valid(forces) and forces.has_method("begin_structure_place"):
			cards_ctx["move_structure"] = func(marker_id: String) -> void:
				_invoke(map_cards, "dismiss")
				_invoke(forces, "begin_structure_place", [marker_id])
		_setup(map_cards, cards_ctx)
	var chat := _make("chat_panel")
	if chat:
		_add_panel("chat", chat)
		_hook(chat, "world_changed", func() -> void: world_changed.emit())
		_hook(chat, "unread_changed", func(count: int) -> void:
			_chat_unread = count
			set_chat_badge(_chat_unread, _chat_generating))
		_hook(chat, "generating_changed", func(generating: bool) -> void:
			_chat_generating = generating
			set_chat_badge(_chat_unread, _chat_generating))
		_setup(chat, {"game": game, "map_view": _map, "hud": self, "right_offset": _right_offset})
	var actions := _make("actions_panel")
	if actions:
		_add_panel("actions", actions)
		_hook(actions, "open_advisor", seed_advisor)
		_hook(actions, "show_on_map", func(lng: float, lat: float, zoom: float) -> void: _map.fly_to_lonlat(lng, lat, zoom))
		_setup(actions, ctx)
	var rostra := _make("rostra_panel")
	if rostra:
		_add_panel("social", rostra)
		_hook(rostra, "unseen_changed", set_rostra_badge)
		_hook(rostra, "enabled_changed", set_social_enabled)
		_setup(rostra, ctx)
	var advisor := _make("advisor_panel")
	if advisor:
		_add_drawer("advisor", advisor)
		_hook(advisor, "open_actions", func() -> void: open_actions_tab("actions"))
		_hook(advisor, "open_projects", func() -> void: open_actions_tab("projects"))
		_hook(advisor, "open_chat", open_chat)
		_hook(advisor, "open_thread", func(target: Dictionary, draft: String) -> void:
			if not panels.has("chat"):
				return
			set_active_panel("chat")
			_invoke(panels["chat"], "open_target", [target, draft]))
		_hook(advisor, "focus_point", func(lng: float, lat: float, zoom: float) -> void: _map.fly_to_lonlat(lng, lat, zoom))
		_hook(advisor, "width_changed", func(_width: float) -> void: _sync_inset())
		_setup(advisor, ctx)
	var country := _make("country_panel")
	if country:
		_add_drawer("country", country)
		_hook(country, "request_focus", func(bounds: Rect2) -> void:
			_map.fit_lonlat_bounds([[bounds.position.x, bounds.position.y], [bounds.end.x, bounds.end.y]]))
		_hook(country, "show_event", func(event_id: String) -> void: date_widget.show_event(event_id))
		_hook(country, "width_changed", func(_width: float) -> void: _sync_inset())
		_hook(country, "open_war_report", func(battlefield: String) -> void: _invoke(after_action, "open_report", [battlefield]))
		_hook(country, "open_chat", func(enemy: String) -> void: open_chat(enemy))
		var country_ctx := ctx.duplicate()
		country_ctx["war_reports"] = after_action != null and is_instance_valid(after_action)
		_setup(country, country_ctx)
	search = _make("search_box")
	if search:
		search_slot.add_child(search)
		_hook(search, "fly_to", func(lon: float, lat: float, zoom: float) -> void: _map.fly_to_lonlat(lon, lat, zoom))
		_hook(search, "fit_bounds", func(west: float, south: float, east: float, north: float) -> void:
			_map.fit_lonlat_bounds([[west, south], [east, north]]))
		_hook(search, "focus_unit", func(payload: Dictionary) -> void: _invoke(map_cards, "focus_unit", [payload]))
		_hook(search, "focus_feature", func(payload: Dictionary) -> void: _invoke(map_cards, "focus_feature", [payload]))
		_setup(search, {"map_cards": map_cards, "map_view": _map, "game": game})
	legend = _make("diplomatic_legend")
	if legend:
		_right_layer.add_child(legend)
		_setup(legend, ctx)
		legend.visible = map_mode == "diplomatic"
	chat_notices = _make("chat_notices")
	if chat_notices:
		add_child(chat_notices)
		_hook(chat_notices, "open_thread", open_chat_thread)
		_setup(chat_notices, {"chat_panel": chat, "game": game, "right_offset": _right_offset})
	set_rostra_badge(0)
	for entry in [["chat", "chat_panel"], ["actions", "actions_panel"], ["social", "rostra_panel"]]:
		var tile: Button = _launchers.get(entry[0])
		if tile:
			if _unavailable.has(entry[1]):
				UI.set_disabled_look(tile, "This panel could not be loaded.")
			else:
				tile.disabled = false
				tile.modulate = Color(1, 1, 1, 1)
				tile.tooltip_text = DOCK_LAUNCHERS.filter(func(item: Array) -> bool: return item[0] == entry[0])[0][1]
	move_child(_right_layer, get_child_count() - 1)
	move_child(date_widget, get_child_count() - 1)
	var saved := await _engine.request("hud.mapMode")
	if saved.get("ok", false):
		set_map_mode(str(saved["result"].get("mode", "political")), true)
	_apply_map_mode()


func _add_panel(name: String, panel: Control) -> void:
	add_child(panel)
	panels[name] = panel
	_hook(panel, "closed", func() -> void:
		if active_panel == name:
			set_active_panel(""))


func _add_drawer(name: String, panel: Control) -> void:
	add_child(panel)
	drawers[name] = panel
	_hook(panel, "closed", func() -> void:
		if open_drawer == name:
			close_drawer())


func toggle_drawer(name: String) -> void:
	if open_drawer == name:
		close_drawer()
	else:
		open_drawer_named(name)


func open_drawer_named(name: String) -> void:
	if not drawers.has(name):
		return
	for key in drawers.keys():
		if key != name and bool(_invoke(drawers[key], "is_open")):
			_invoke(drawers[key], "close")
	open_drawer = name
	var drawer: Control = drawers[name]
	if not bool(_invoke(drawer, "is_open")):
		_invoke(drawer, "open")
	_sync_inset()


func close_drawer() -> void:
	if drawers.has(open_drawer) and is_instance_valid(drawers[open_drawer]):
		var drawer: Control = drawers[open_drawer]
		if bool(_invoke(drawer, "is_open")):
			_invoke(drawer, "close")
	open_drawer = ""
	_sync_inset()


func _sync_inset() -> void:
	_refresh_flag_badge()
	if open_drawer.is_empty() or not drawers.has(open_drawer):
		set_right_inset(0.0)
		return
	var drawer: Control = drawers[open_drawer]
	var width: float = float(drawer.get_meta("width", 320.0))
	if drawer.has_method("current_width"):
		width = float(drawer.call("current_width"))
	set_right_inset(width)


func _right_offset() -> float:
	return maxf(0.0, -_right_layer.position.x) if _right_layer else 0.0


func set_right_inset(width: float) -> void:
	if _inset_tween and _inset_tween.is_valid():
		_inset_tween.kill()
	_inset_tween = create_tween().set_parallel(true).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_IN_OUT)
	_inset_tween.tween_property(_right_layer, "position:x", -width, 0.35)
	date_widget.set_right_inset(width)


func show_country(name: String, tab := "") -> void:
	if not drawers.has("country"):
		return
	var country: Control = drawers["country"]
	open_drawer_named("country")
	if country.has_method("show_country"):
		await country.call("show_country", name)
	if not tab.is_empty():
		_invoke(country, "set_tab", [tab])
	_sync_inset()


func seed_advisor(text: String) -> void:
	if not drawers.has("advisor"):
		return
	open_drawer_named("advisor")
	_invoke(drawers["advisor"], "seed", [text])


func open_chat(country: String, draft := "") -> void:
	if not panels.has("chat"):
		return
	set_active_panel("chat")
	_invoke(panels["chat"], "open_chat", [country, draft])


func open_chat_thread(chat_id: String) -> void:
	if not panels.has("chat"):
		return
	set_active_panel("chat")
	if not chat_id.is_empty():
		_invoke(panels["chat"], "open_thread", [chat_id])


func refresh_panels() -> void:
	for node in panels.values() + drawers.values() + [map_cards, chat_notices]:
		_invoke(node, "refresh")
	if map_mode == "diplomatic":
		_apply_map_mode()


func _apply_map_mode() -> void:
	if not legend or not is_instance_valid(legend) or not _map:
		return
	if map_mode == "diplomatic":
		_invoke(legend, "show_legend")
		var colors: Variant = await legend.call("stance_colors") if legend.has_method("stance_colors") else {}
		if map_mode == "diplomatic" and typeof(colors) == TYPE_DICTIONARY:
			var neutral: Variant = legend.get("neutral_land")
			_map.set_owner_color_override(colors, neutral if neutral is Color else Color(0, 0, 0, 0))
	else:
		_invoke(legend, "hide_legend")
		_map.set_owner_color_override({}, Color(0, 0, 0, 0))


func _on_region_clicked(index: int) -> void:
	if not map_cards or not is_instance_valid(map_cards) or not visible:
		return
	if cheats and is_instance_valid(cheats) and cheats.has_method("is_picking") and cheats.call("is_picking") == true:
		return
	if forces and is_instance_valid(forces) and forces.has_method("is_placing") and forces.call("is_placing") == true:
		return
	var mouse := get_viewport().get_mouse_position()
	if map_cards.has_method("handle_screen_click"):
		var handled: Variant = await map_cards.call("handle_screen_click", mouse)
		if handled == true:
			return
	_map.select_region(index)
	if index < 0:
		_invoke(map_cards, "dismiss")
		return
	if open_drawer == "country" and drawers.has("country"):
		_invoke(drawers["country"], "on_region_selected", [_map.region_owner(index)])
	_invoke(map_cards, "show_region", [index, _map.region_name(index), _map.region_owner(index), mouse])


func _reload_flag_and_map() -> void:
	if not _engine:
		return
	var country_drawer: Variant = drawers.get("country")
	if country_drawer is CountryPanel and (country_drawer as CountryPanel).is_open():
		(country_drawer as CountryPanel).refresh()
	var flag := await _engine.request("game.flag", {"country": str(_game.get("country", ""))})
	if flag.get("ok", false):
		set_flag_info(flag["result"])
	if war and is_instance_valid(war) and war.has_method("refresh"):
		await war.call("refresh")
		return
	var state := await _engine.request("map.state")
	if state.get("ok", false):
		_map.set_state(state["result"])


func set_war(node: Node) -> void:
	war = node
	date_widget.war = node


func set_beside_war_room(at_war: bool) -> void:
	_beside_war_room = at_war
	_place_dock()


func _refresh_flag_badge() -> void:
	if not _flag_frame:
		return
	var open := open_drawer == "country"
	_flag_frame.set_tint(UiTheme.pick("glass_active", Color(75 / 255.0, 143 / 255.0, 251 / 255.0, 0.17)) if open else UiTheme.pick("glass_pill", UI.HUD_BUTTON))
	var rest_edge := UiTheme.pick("hud_border", UI.HUD_BORDER)
	_flag_frame.set_border(UiTheme.pick("glass_active_line", rest_edge) if open else rest_edge)
	if _advisor_frame:
		_advisor_frame.set_tint(UiTheme.pick("glass_active", Color(1, 1, 1, 0.085)) if open_drawer == "advisor" else UiTheme.pick("glass_pill", UI.HUD_BUTTON))
		_advisor_frame.set_border(UiTheme.pick("glass_active_line", rest_edge) if open_drawer == "advisor" else rest_edge)
	var name := str(_game.get("countryName", ""))
	if name.is_empty():
		name = str(date_widget.status.get("playerCountry", _game.get("country", "")))
	for child in _flag_frame.get_children():
		if child is Button:
			(child as Button).tooltip_text = "%s · Open country panel" % name
