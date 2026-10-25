class_name Hud
extends Control

signal exit_game
signal open_menu
signal skip_requested(days: float)
signal auto_skip_requested

const PANEL_WIDTH := 418.0
const JUMPS := [["6 hours", 0.25], ["1 day", 1.0], ["3 days", 3.0], ["1 week", 7.0], ["1 month", 30.0], ["3 months", 90.0], ["6 months", 180.0], ["1 year", 365.0]]
const UNITS := [["days", 1.0], ["weeks", 7.0], ["months", 30.0], ["years", 365.0]]

var _pill_subtitle: Label
var _country: Label
var _date: Label
var _back_button: Button
var _forward_button: Button
var _flag: TextureRect
var _status: GlassPanel
var _status_label: Label
var _skip_panel: GlassPanel
var _events_panel: GlassPanel
var _jump_list: VBoxContainer
var _events_list: VBoxContainer
var _open_panel := ""
var _busy := false
var _game_date := ""
var _skip_buttons: Array[Button] = []
var _custom_value: LineEdit
var _custom_unit: OptionButton


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_build_top_left()
	_build_time_pill()
	_skip_panel = _panel("Timeline")
	_jump_list = VBoxContainer.new()
	_jump_list.alignment = BoxContainer.ALIGNMENT_BEGIN
	_jump_list.add_theme_constant_override("separation", 0)
	_jump_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	(_skip_panel.get_meta("body") as Container).add_child(_jump_list)
	_events_panel = _panel("Events")
	_events_list = VBoxContainer.new()
	_events_list.add_theme_constant_override("separation", 10)
	_events_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	(_events_panel.get_meta("body") as Container).add_child(_events_list)
	_build_dock()
	_build_bottom_right()
	_build_status()
	_show_panel("")


func _glass(tint: Color, radius: float, rect: Rect2, anchors := Vector4(0, 0, 0, 0), inner := Vector4(0, 0, 0, 0)) -> GlassPanel:
	var panel := GlassPanel.new(tint, radius, inner)
	panel.anchor_left = anchors.x
	panel.anchor_top = anchors.y
	panel.anchor_right = anchors.z
	panel.anchor_bottom = anchors.w
	panel.offset_left = rect.position.x
	panel.offset_top = rect.position.y
	panel.offset_right = rect.position.x + rect.size.x
	panel.offset_bottom = rect.position.y + rect.size.y
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


func _build_top_left() -> void:
	var menu := _glass(UI.HUD_BUTTON, 14, Rect2(8, 8, 64, 64))
	var menu_button := _flat_button("☰", 24, 800, UI.WHITE)
	menu_button.pressed.connect(func() -> void: open_menu.emit())
	menu.add_child(menu_button)
	var pill := _glass(UI.HUD_PILL, 13, Rect2(80, 8, 240, 45), Vector4(0, 0, 0, 0), Vector4(12, 0, 12, 0))
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
	var exit := _glass(UI.HUD_PILL, 11, Rect2(328, 8, 92, 46))
	var exit_button := _flat_button("⌂ Exit Game", 11, 600)
	exit_button.pressed.connect(func() -> void: exit_game.emit())
	exit.add_child(exit_button)


func _build_time_pill() -> void:
	var pill := _glass(UI.HUD_BG_STRONG, 14, Rect2(-296, 8, 288, 56), Vector4(1, 0, 1, 0), Vector4(9, 0, 9, 0))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 4)
	_back_button = _flat_button("«", 24, 900, Color(1, 1, 1, 0.7))
	_back_button.custom_minimum_size = Vector2(32, 32)
	_back_button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_back_button.tooltip_text = "Events"
	_back_button.pressed.connect(func() -> void: _toggle("events"))
	row.add_child(_back_button)
	var middle := HBoxContainer.new()
	middle.alignment = BoxContainer.ALIGNMENT_CENTER
	middle.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	middle.add_theme_constant_override("separation", 8)
	_country = UI.label("", 13, UI.HUD_BLUE, 700, "Arial", 1)
	_country.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	middle.add_child(_country)
	_date = UI.label("", 15, Color(1, 1, 1, 0.94))
	_date.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	middle.add_child(_date)
	row.add_child(middle)
	_forward_button = _flat_button("»", 24, 900, Color(1, 1, 1, 0.7))
	_forward_button.custom_minimum_size = Vector2(32, 32)
	_forward_button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_forward_button.tooltip_text = "Timeline"
	_forward_button.pressed.connect(func() -> void: _toggle("skip"))
	row.add_child(_forward_button)
	pill.add_child(row)


func _panel(title: String) -> GlassPanel:
	var panel := _glass(UI.HUD_BG_STRONG, 18, Rect2(8, -78 - 480, PANEL_WIDTH, 480), Vector4(0, 1, 0, 1))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	var header := MarginContainer.new()
	for side in [["margin_left", 20], ["margin_right", 18], ["margin_top", 16], ["margin_bottom", 12]]:
		header.add_theme_constant_override(side[0], side[1])
	var header_row := HBoxContainer.new()
	header_row.add_child(UI.label(title, 16, Color(1, 1, 1, 0.96), 700))
	header_row.add_child(UI.spacer())
	var close := Button.new()
	close.flat = true
	close.focus_mode = Control.FOCUS_NONE
	close.icon = UI.icon("close", 16, Color(1, 1, 1, 0.5))
	close.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	close.pressed.connect(func() -> void: _show_panel(""))
	header_row.add_child(close)
	header.add_child(header_row)
	column.add_child(header)
	var rule := ColorRect.new()
	rule.color = Color(1, 1, 1, 0.07)
	rule.custom_minimum_size.y = 1
	column.add_child(rule)
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	var body := MarginContainer.new()
	body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for side in [["margin_left", 20], ["margin_right", 20], ["margin_top", 15], ["margin_bottom", 20]]:
		body.add_theme_constant_override(side[0], side[1])
	scroll.add_child(body)
	column.add_child(scroll)
	panel.add_child(column)
	panel.set_meta("body", body)
	panel.set_meta("scroll", scroll)
	return panel


func _build_dock() -> void:
	var dock := _glass(UI.HUD_BG, 14, Rect2(8, -72, 205, 64), Vector4(0, 1, 0, 1), Vector4(11, 5, 11, 5))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	for entry in [["chat", 18, "Diplomacy is not in the native app yet."], ["actions", 16, "Actions are not in the native app yet."], ["events", 18, ""]]:
		var tile := Button.new()
		tile.focus_mode = Control.FOCUS_NONE
		tile.custom_minimum_size = Vector2(53, 53)
		tile.icon = UI.icon(entry[0], entry[1])
		tile.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
		tile.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		var normal := UI.box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.1), 10, 1)
		var hover := UI.box(Color(1, 1, 1, 0.09), Color(1, 1, 1, 0.18), 10, 1)
		for state in ["normal", "focus", "disabled"]:
			tile.add_theme_stylebox_override(state, normal)
		for state in ["hover", "pressed", "hover_pressed"]:
			tile.add_theme_stylebox_override(state, hover)
		if str(entry[2]).is_empty():
			tile.pressed.connect(func() -> void: _toggle("events"))
		else:
			UI.set_disabled_look(tile, entry[2])
		row.add_child(tile)
	dock.add_child(row)
	var search := Button.new()
	search.icon = UI.icon("search", 14)
	search.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
	search.add_theme_stylebox_override("normal", UI.box(UI.HUD_BG, UI.HUD_BORDER, 10, 1))
	search.add_theme_stylebox_override("disabled", UI.box(UI.HUD_BG, UI.HUD_BORDER, 10, 1))
	search.anchor_top = 1.0
	search.anchor_bottom = 1.0
	search.offset_left = 222
	search.offset_top = -52
	search.offset_right = 260
	search.offset_bottom = -14
	UI.set_disabled_look(search, "Search is not in the native app yet.")
	add_child(search)


func _build_bottom_right() -> void:
	var flag_frame := _glass(UI.HUD_BUTTON, 14, Rect2(-72, -180, 64, 64), Vector4(1, 1, 1, 1), Vector4(8, 8, 8, 8))
	_flag = TextureRect.new()
	_flag.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_flag.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	_flag.clip_contents = true
	flag_frame.add_child(_flag)
	flag_frame.tooltip_text = "Your country panel is not in the native app yet."
	var advisor := _glass(UI.HUD_BUTTON, 14, Rect2(-72, -112, 64, 64), Vector4(1, 1, 1, 1))
	var advisor_icon := UI.icon_rect("advisor", 22)
	advisor.add_child(advisor_icon)
	advisor.tooltip_text = "The advisor is not in the native app yet."
	advisor.modulate = Color(1, 1, 1, 0.55)
	var toggle := _glass(UI.HUD_BG, 12, Rect2(-206, -44, 198, 36), Vector4(1, 1, 1, 1), Vector4(4, 4, 4, 4))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 4)
	var political := Button.new()
	political.text = "Political"
	political.icon = UI.icon("political", 15)
	political.focus_mode = Control.FOCUS_NONE
	political.custom_minimum_size = Vector2(87, 28)
	political.add_theme_font_override("font", UI.font(600))
	political.add_theme_font_size_override("font_size", 12)
	political.add_theme_color_override("font_color", UI.WHITE)
	political.add_theme_stylebox_override("normal", UI.box(Color(1, 1, 1, 0.14), Color(0, 0, 0, 0), 8, 0))
	political.add_theme_stylebox_override("hover", UI.box(Color(1, 1, 1, 0.16), Color(0, 0, 0, 0), 8, 0))
	row.add_child(political)
	var diplomatic := Button.new()
	diplomatic.text = "Diplomatic"
	diplomatic.icon = UI.icon("diplomatic", 15, Color(1, 1, 1, 0.55))
	diplomatic.flat = true
	diplomatic.focus_mode = Control.FOCUS_NONE
	diplomatic.custom_minimum_size = Vector2(99, 28)
	diplomatic.add_theme_font_override("font", UI.font(400))
	diplomatic.add_theme_font_size_override("font_size", 12)
	diplomatic.add_theme_color_override("font_color", Color(1, 1, 1, 0.55))
	diplomatic.add_theme_color_override("font_disabled_color", Color(1, 1, 1, 0.4))
	diplomatic.disabled = true
	diplomatic.tooltip_text = "The diplomatic map is not in the native app yet."
	row.add_child(diplomatic)
	toggle.add_child(row)


func _build_status() -> void:
	_status = _glass(UI.HUD_BG_STRONG, 12, Rect2(-296, 72, 288, 38), Vector4(1, 0, 1, 0), Vector4(14, 0, 14, 0))
	_status_label = UI.label("", 12, Color(1, 1, 1, 0.8), 600)
	_status_label.clip_text = true
	_status_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_status.add_child(_status_label)
	_status.visible = false


func set_game(view: Dictionary, game_name: String) -> void:
	_game_date = str(view.get("gameDate", ""))
	var country := str(view.get("country", ""))
	_country.text = country.to_upper()
	_date.text = UI.format_long_date(_game_date)
	_pill_subtitle.text = "%s / %s / %s" % [game_name, country, _game_date]
	_rebuild_jumps()
	_set_events(view.get("events", []))


func set_flag(texture: Texture2D) -> void:
	_flag.texture = texture


func set_busy(busy: bool) -> void:
	_busy = busy
	_forward_button.text = "◌" if busy else "»"
	for button in _skip_buttons:
		button.modulate = Color(1, 1, 1, 0.7 if busy else 1.0)


func set_status(text: String, problem := false) -> void:
	_status.visible = not text.is_empty()
	_status_label.text = text
	_status_label.add_theme_color_override("font_color", Color("#fca5a5") if problem else Color(1, 1, 1, 0.8))


func open_events() -> void:
	_show_panel("events")


func add_live_events(events: Array) -> void:
	for event in events:
		_events_list.add_child(_event_row(event))
	var scroll := _events_panel.get_meta("scroll") as ScrollContainer
	scroll.scroll_vertical = int(scroll.get_v_scroll_bar().max_value)


func clear_events() -> void:
	for child in _events_list.get_children():
		child.queue_free()


func _set_events(events: Array) -> void:
	clear_events()
	if events.is_empty():
		_events_list.add_child(UI.wrapped("No events yet.", 13, Color(1, 1, 1, 0.5)))
		return
	for event in events:
		_events_list.add_child(_event_row(event))


func _event_row(event: Dictionary) -> Control:
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.035), Color(1, 1, 1, 0.07), 12, 1, Vector4(12, 10, 12, 11)))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 3)
	var related: bool = event.get("playerRelated", false)
	column.add_child(UI.label(UI.format_long_date(str(event.get("date", ""))).to_upper(), 10, Color(147 / 255.0, 197 / 255.0, 253 / 255.0, 0.85) if related else Color(1, 1, 1, 0.4), 700, "Arial", 1))
	var title := UI.wrapped(str(event.get("title", "")), 14, UI.WHITE, 700)
	column.add_child(title)
	var description := UI.wrapped(str(event.get("description", "")), 12, Color(1, 1, 1, 0.62))
	column.add_child(description)
	card.add_child(column)
	return card


func _connector() -> Control:
	var holder := CenterContainer.new()
	var line := ColorRect.new()
	line.color = Color(1, 1, 1, 0.1)
	line.custom_minimum_size = Vector2(2, 20)
	holder.add_child(line)
	return holder


func _rebuild_jumps() -> void:
	for child in _jump_list.get_children():
		child.queue_free()
	_skip_buttons.clear()
	var today := PanelContainer.new()
	today.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.07), Color(1, 1, 1, 0.28), 999, 2, Vector4(0, 5, 0, 6)))
	today.custom_minimum_size.x = 88
	var today_label := UI.label(UI.short_date(_game_date), 11, Color("#e4e4e7"), 700, "Arial", 1)
	today_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	today.add_child(today_label)
	_jump_list.add_child(_centered(today))
	for jump in JUMPS:
		_jump_list.add_child(_connector())
		_jump_list.add_child(_centered(_jump_node(jump[0], jump[1])))
	_jump_list.add_child(_connector())
	var auto := Button.new()
	auto.text = "Auto-jump"
	auto.focus_mode = Control.FOCUS_NONE
	auto.custom_minimum_size = Vector2(200, 35)
	auto.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	auto.add_theme_font_override("font", UI.font(700))
	auto.add_theme_font_size_override("font_size", 14)
	auto.add_theme_color_override("font_color", UI.WHITE)
	auto.add_theme_stylebox_override("normal", UI.box(Color(37 / 255.0, 99 / 255.0, 235 / 255.0, 0.2), Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.45), 12, 1))
	auto.add_theme_stylebox_override("hover", UI.box(Color(37 / 255.0, 99 / 255.0, 235 / 255.0, 0.3), Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.6), 12, 1))
	auto.pressed.connect(func() -> void:
		if not _busy:
			auto_skip_requested.emit())
	_skip_buttons.append(auto)
	_jump_list.add_child(_centered(auto))
	_jump_list.add_child(_connector())
	var custom := PanelContainer.new()
	custom.custom_minimum_size.x = 200
	custom.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.1), 12, 1, Vector4(8, 7, 8, 7)))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	_custom_value = LineEdit.new()
	_custom_value.placeholder_text = "Custom"
	_custom_value.custom_minimum_size = Vector2(54, 26)
	_custom_value.add_theme_stylebox_override("normal", UI.box(Color(0, 0, 0, 0.25), Color(1, 1, 1, 0.16), 8, 1, Vector4(6, 0, 6, 0)))
	_custom_value.add_theme_font_size_override("font_size", 12)
	_custom_value.text_submitted.connect(func(_text: String) -> void: _run_custom())
	row.add_child(_custom_value)
	_custom_unit = OptionButton.new()
	for unit in UNITS:
		_custom_unit.add_item(unit[0])
	_custom_unit.custom_minimum_size = Vector2(78, 26)
	_custom_unit.add_theme_stylebox_override("normal", UI.box(Color(0, 0, 0, 0.25), Color(1, 1, 1, 0.16), 8, 1, Vector4(6, 0, 6, 0)))
	_custom_unit.add_theme_font_size_override("font_size", 12)
	row.add_child(_custom_unit)
	var go := Button.new()
	go.text = "Go"
	go.focus_mode = Control.FOCUS_NONE
	go.custom_minimum_size = Vector2(39, 26)
	go.add_theme_font_override("font", UI.font(700))
	go.add_theme_font_size_override("font_size", 13)
	go.add_theme_stylebox_override("normal", UI.box(Color(1, 1, 1, 0.1), Color(1, 1, 1, 0.28), 8, 1))
	go.add_theme_stylebox_override("hover", UI.box(Color(1, 1, 1, 0.16), Color(1, 1, 1, 0.36), 8, 1))
	go.pressed.connect(_run_custom)
	row.add_child(go)
	custom.add_child(row)
	_jump_list.add_child(_centered(custom))


func _run_custom() -> void:
	var value := _custom_value.text.to_float()
	if value <= 0.0 or _busy:
		return
	skip_requested.emit(value * float(UNITS[_custom_unit.selected][1]))


func _centered(control: Control) -> Control:
	var holder := CenterContainer.new()
	holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	holder.add_child(control)
	return holder


func _jump_node(label: String, days: float) -> Button:
	var node := Button.new()
	node.focus_mode = Control.FOCUS_NONE
	node.custom_minimum_size = Vector2(200, 43)
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	node.add_theme_stylebox_override("normal", UI.box(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.18), 10, 1))
	node.add_theme_stylebox_override("hover", UI.box(Color(1, 1, 1, 0.1), Color(1, 1, 1, 0.28), 10, 1))
	node.add_theme_stylebox_override("pressed", UI.box(Color(1, 1, 1, 0.1), Color(1, 1, 1, 0.28), 10, 1))
	node.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	var stack := VBoxContainer.new()
	stack.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	stack.alignment = BoxContainer.ALIGNMENT_CENTER
	stack.add_theme_constant_override("separation", 0)
	stack.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var landing := UI.label(UI.short_date(UI.add_days(_game_date, days)), 14, UI.WHITE, 600)
	landing.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	stack.add_child(landing)
	var span := UI.label(label, 11, Color("#e4e4e7"))
	span.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	stack.add_child(span)
	node.add_child(stack)
	node.pressed.connect(func() -> void:
		if not _busy:
			skip_requested.emit(days))
	_skip_buttons.append(node)
	return node


func _toggle(panel: String) -> void:
	_show_panel("" if _open_panel == panel else panel)


func _show_panel(panel: String) -> void:
	_open_panel = panel
	for entry in [[_skip_panel, "skip"], [_events_panel, "events"]]:
		var node: GlassPanel = entry[0]
		var open: bool = entry[1] == panel
		var tween := create_tween().set_parallel(true).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
		tween.tween_property(node, "offset_top", -78.0 - 480.0 if open else 200.0, 0.35)
		tween.tween_property(node, "offset_bottom", -78.0 if open else 680.0, 0.35)
		tween.tween_property(node, "modulate:a", 1.0 if open else 0.0, 0.35)
		node.mouse_filter = Control.MOUSE_FILTER_STOP if open else Control.MOUSE_FILTER_IGNORE
	_forward_button.add_theme_color_override("font_color", Color("#e4e4e7") if panel == "skip" else Color(1, 1, 1, 0.7))
