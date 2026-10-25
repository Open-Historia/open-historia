class_name CountryPicker
extends Control

signal chosen(country: String, difficulty: String)
signal cancelled

var map_view: MapView
var scenario_name := ""
var default_country := ""
var _countries: Array = []
var _difficulties: Array = []
var _list: VBoxContainer
var _search: LineEdit
var _count_label: Label
var _picker: PanelContainer
var _difficulty: PanelContainer
var _difficulty_nation: HBoxContainer
var _selected := ""
var _viewport: SubViewport
var _camera: Camera2D
var _container: SubViewportContainer
var _dragging := false
var _drag := 0.0


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.55)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(dim)
	_build_picker()
	_build_difficulty()
	_difficulty.get_parent().visible = false


func open(countries: Array, difficulties: Array, playable: PackedStringArray) -> void:
	var flags := {}
	for entry in countries:
		flags[str(entry.get("name", ""))] = str(entry.get("flag", ""))
	if playable.is_empty():
		_countries = countries
	else:
		var names := Array(playable)
		names.sort_custom(func(a: String, b: String) -> bool: return a.naturalnocasecmp_to(b) < 0)
		_countries = names.map(func(name: String) -> Dictionary: return {"name": name, "flag": flags.get(name, "")})
	_difficulties = difficulties
	_count_label.text = "%d playable nations" % _countries.size()
	_fill_list("")
	_build_difficulty_cards()
	_picker.get_parent().visible = true
	_difficulty.get_parent().visible = false
	_viewport.world_2d = map_view.get_viewport().world_2d
	_camera.position = Vector2(MapView.WORLD_WIDTH * 0.5, MapView.WORLD_WIDTH * 0.47)
	_camera.zoom = Vector2.ONE * 0.2
	_sync.call_deferred()


func _modal(width: float, height: float) -> PanelContainer:
	var holder := CenterContainer.new()
	holder.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(holder)
	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(width, height)
	var style := UI.box(Color8(24, 25, 28, 250), Color(1, 1, 1, 0.1), 18, 1, Vector4(22, 18, 22, 18))
	UI.shadowed(style, Color(0, 0, 0, 0.5), 24, Vector2(0, 18))
	panel.add_theme_stylebox_override("panel", style)
	holder.add_child(panel)
	return panel


func _build_picker() -> void:
	_picker = _modal(1120, 717)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 12)
	_picker.add_child(column)
	var header := HBoxContainer.new()
	var titles := VBoxContainer.new()
	titles.add_theme_constant_override("separation", 4)
	var eyebrow := HBoxContainer.new()
	eyebrow.add_theme_constant_override("separation", 8)
	eyebrow.add_child(UI.pill("Scenario", Color(1, 1, 1, 0.08), Color(1, 1, 1, 0.14), Color(1, 1, 1, 0.7), true, 10))
	var scenario_label := UI.label("", 12, Color(1, 1, 1, 0.75), 600)
	scenario_label.name = "ScenarioName"
	eyebrow.add_child(scenario_label)
	titles.add_child(eyebrow)
	titles.add_child(UI.label("Choose your country", 22, UI.WHITE, 800, "Arial", -1))
	header.add_child(titles)
	header.add_child(UI.spacer())
	var segments := PanelContainer.new()
	segments.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.08), 10, 1, Vector4(3, 3, 3, 3)))
	segments.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var segment_row := HBoxContainer.new()
	segment_row.add_theme_constant_override("separation", 2)
	var pick := UI.button("Pick a country", "small")
	pick.add_theme_stylebox_override("normal", UI.box(Color(1, 1, 1, 0.12), Color(0, 0, 0, 0), 8, 0, Vector4(14, 0, 14, 0)))
	segment_row.add_child(pick)
	var group := UI.button("Play as a group", "plain")
	UI.set_disabled_look(group, "Playing as a group is not in the native app yet.")
	segment_row.add_child(group)
	segments.add_child(segment_row)
	header.add_child(segments)
	column.add_child(header)

	var body := HBoxContainer.new()
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_theme_constant_override("separation", 16)
	var left := VBoxContainer.new()
	left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	left.add_theme_constant_override("separation", 8)
	var frame := PanelContainer.new()
	frame.size_flags_vertical = Control.SIZE_EXPAND_FILL
	frame.add_theme_stylebox_override("panel", UI.box(Color8(16, 27, 39), Color(1, 1, 1, 0.1), 12, 1, Vector4(1, 1, 1, 1)))
	frame.clip_contents = true
	_container = SubViewportContainer.new()
	_container.stretch = true
	_container.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_container.gui_input.connect(_on_map_input)
	_viewport = SubViewport.new()
	_viewport.transparent_bg = false
	_viewport.handle_input_locally = false
	_camera = Camera2D.new()
	_viewport.add_child(_camera)
	_container.add_child(_viewport)
	frame.add_child(_container)
	left.add_child(frame)
	var hint := HBoxContainer.new()
	hint.add_child(UI.label("●  Drag to pan • Scroll to zoom • Click any nation to select", 11, Color(1, 1, 1, 0.5)))
	hint.add_child(UI.spacer())
	_count_label = UI.label("", 11, Color(1, 1, 1, 0.5))
	hint.add_child(_count_label)
	left.add_child(hint)
	body.add_child(left)

	var right := VBoxContainer.new()
	right.custom_minimum_size.x = 341
	right.add_theme_constant_override("separation", 8)
	right.add_child(UI.label("Select Nation", 12, UI.WHITE, 700))
	_search = LineEdit.new()
	_search.placeholder_text = "Search countries or codes..."
	_search.custom_minimum_size.y = 32
	_search.add_theme_stylebox_override("normal", UI.box(Color(0, 0, 0, 0.25), Color(1, 1, 1, 0.12), 8, 1, Vector4(10, 0, 10, 0)))
	_search.add_theme_stylebox_override("focus", UI.box(Color(0, 0, 0, 0.3), Color(1, 1, 1, 0.24), 8, 1, Vector4(10, 0, 10, 0)))
	_search.add_theme_font_override("font", UI.font(400))
	_search.add_theme_font_size_override("font_size", 12)
	_search.text_changed.connect(_fill_list)
	right.add_child(_search)
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_list = VBoxContainer.new()
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_list.add_theme_constant_override("separation", 4)
	scroll.add_child(_list)
	right.add_child(scroll)
	body.add_child(right)
	column.add_child(body)
	var footer := HBoxContainer.new()
	footer.add_child(UI.spacer())
	var cancel := UI.button("Cancel", "header")
	cancel.pressed.connect(func() -> void: cancelled.emit())
	footer.add_child(cancel)
	column.add_child(footer)


func set_scenario_name(name: String) -> void:
	scenario_name = name
	(_picker.find_child("ScenarioName", true, false) as Label).text = name


func _row(title: String, subtitle: String, flag_path: String, star := false) -> Button:
	var row := Button.new()
	row.focus_mode = Control.FOCUS_NONE
	row.custom_minimum_size.y = 46 if not subtitle.is_empty() else 30
	row.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var normal := UI.box(Color(1, 1, 1, 0.07 if star else 0.035), Color(1, 1, 1, 0.07), 7, 1)
	if star:
		normal.border_width_left = 3
		normal.border_color = Color("#f5bd4f")
	var hover := normal.duplicate() as StyleBoxFlat
	hover.bg_color = Color(1, 1, 1, 0.09)
	for state in ["normal", "focus"]:
		row.add_theme_stylebox_override(state, normal)
	for state in ["hover", "pressed", "hover_pressed"]:
		row.add_theme_stylebox_override(state, hover)
	var content := HBoxContainer.new()
	content.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	content.offset_left = 10
	content.add_theme_constant_override("separation", 10)
	content.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if star:
		content.add_child(UI.icon_rect("star", 16))
	else:
		var flag := TextureRect.new()
		flag.texture = UI.flag(flag_path, 16)
		flag.custom_minimum_size = Vector2(22, 16)
		flag.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		flag.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		flag.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		flag.mouse_filter = Control.MOUSE_FILTER_IGNORE
		content.add_child(flag)
	var text := VBoxContainer.new()
	text.alignment = BoxContainer.ALIGNMENT_CENTER
	text.add_theme_constant_override("separation", 1)
	text.mouse_filter = Control.MOUSE_FILTER_IGNORE
	text.add_child(UI.label(title, 13, UI.WHITE, 700))
	if not subtitle.is_empty():
		text.add_child(UI.label(subtitle, 10, Color(1, 1, 1, 0.5)))
	content.add_child(text)
	row.add_child(content)
	return row


func _fill_list(filter: String) -> void:
	for child in _list.get_children():
		child.queue_free()
	var needle := filter.strip_edges().to_lower()
	if needle.is_empty():
		var standard := _row("Scenario default", "Start with the scenario's designated country", "", true)
		standard.pressed.connect(func() -> void: _choose(default_country))
		_list.add_child(standard)
	for entry in _countries:
		var name := str(entry.get("name", ""))
		if not needle.is_empty() and not name.to_lower().contains(needle):
			continue
		var row := _row(name, "", str(entry.get("flag", "")))
		row.pressed.connect(func() -> void: _choose(name))
		_list.add_child(row)


func _choose(country: String) -> void:
	_selected = country
	for child in _difficulty_nation.get_children():
		child.queue_free()
	var flag_path := ""
	for entry in _countries:
		if str(entry.get("name", "")) == country:
			flag_path = str(entry.get("flag", ""))
	var flag := TextureRect.new()
	flag.texture = UI.flag(flag_path, 18)
	flag.custom_minimum_size = Vector2(26, 18)
	flag.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	flag.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	flag.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_difficulty_nation.add_child(flag)
	var text := VBoxContainer.new()
	text.add_theme_constant_override("separation", 0)
	text.add_child(UI.label(country, 14, UI.WHITE, 700))
	text.add_child(UI.label("Selected Nation", 10, Color(1, 1, 1, 0.5)))
	_difficulty_nation.add_child(text)
	_picker.get_parent().visible = false
	_difficulty.get_parent().visible = true


func _build_difficulty() -> void:
	_difficulty = _modal(458, 0)
	var column := VBoxContainer.new()
	column.name = "DifficultyColumn"
	column.add_theme_constant_override("separation", 10)
	_difficulty.add_child(column)
	column.add_child(UI.label("Choose your difficulty", 19, UI.WHITE, 800))
	column.add_child(UI.label("How hard should the world fight back?", 12, Color(1, 1, 1, 0.55)))
	var nation := PanelContainer.new()
	nation.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.08), 8, 1, Vector4(10, 7, 10, 7)))
	_difficulty_nation = HBoxContainer.new()
	_difficulty_nation.add_theme_constant_override("separation", 10)
	nation.add_child(_difficulty_nation)
	column.add_child(nation)
	var grid := GridContainer.new()
	grid.name = "DifficultyGrid"
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 8)
	grid.add_theme_constant_override("v_separation", 8)
	column.add_child(grid)
	var back := UI.button("Back", "small")
	back.pressed.connect(func() -> void:
		_difficulty.get_parent().visible = false
		_picker.get_parent().visible = true)
	column.add_child(back)


func _build_difficulty_cards() -> void:
	var grid := _difficulty.find_child("DifficultyGrid", true, false) as GridContainer
	for child in grid.get_children():
		child.queue_free()
	for level in _difficulties:
		var card := Button.new()
		card.focus_mode = Control.FOCUS_NONE
		card.custom_minimum_size = Vector2(203, 84)
		card.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		var normal := UI.box(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.08), 8, 1)
		var hover := UI.box(Color(1, 1, 1, 0.1), Color(1, 1, 1, 0.2), 8, 1)
		for state in ["normal", "focus"]:
			card.add_theme_stylebox_override(state, normal)
		for state in ["hover", "pressed", "hover_pressed"]:
			card.add_theme_stylebox_override(state, hover)
		var stack := VBoxContainer.new()
		stack.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		stack.alignment = BoxContainer.ALIGNMENT_CENTER
		stack.add_theme_constant_override("separation", 2)
		stack.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var emoji := UI.label(str(level.get("emoji", "")), 20, UI.WHITE, 400, "Segoe UI Emoji")
		emoji.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		stack.add_child(emoji)
		var title := UI.label(str(level.get("label", "")), 13, UI.WHITE, 700)
		title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		stack.add_child(title)
		var blurb := UI.wrapped(str(level.get("blurb", "")), 10, Color(1, 1, 1, 0.55), 400, 2)
		blurb.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		stack.add_child(blurb)
		card.add_child(stack)
		var id := str(level.get("id", "medium"))
		card.pressed.connect(func() -> void: chosen.emit(_selected, id))
		grid.add_child(card)


func _on_map_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var button := event as InputEventMouseButton
		if button.button_index == MOUSE_BUTTON_WHEEL_UP and button.pressed:
			_zoom(button.position, 1.15)
		elif button.button_index == MOUSE_BUTTON_WHEEL_DOWN and button.pressed:
			_zoom(button.position, 1.0 / 1.15)
		elif button.button_index == MOUSE_BUTTON_LEFT:
			if button.pressed:
				_dragging = true
				_drag = 0.0
			else:
				_dragging = false
				if _drag < 5.0:
					var region := map_view.baker.pick(_to_world(button.position))
					var owner := map_view.region_owner(region)
					if not owner.is_empty():
						map_view.select_region(region)
						_choose(owner)
	elif event is InputEventMouseMotion and _dragging:
		var motion := event as InputEventMouseMotion
		_drag += motion.relative.length()
		_camera.position -= motion.relative / _camera.zoom.x
		_camera.position.x = fposmod(_camera.position.x, MapView.WORLD_WIDTH)
		_sync()


func _to_world(local: Vector2) -> Vector2:
	return _camera.position + (local - _container.size * 0.5) / _camera.zoom.x


func _zoom(local: Vector2, factor: float) -> void:
	var before := _to_world(local)
	_camera.zoom = Vector2.ONE * clamp(_camera.zoom.x * factor, 0.15, 40.0)
	_camera.position += before - _to_world(local)
	_sync()


func _sync() -> void:
	map_view.camera.position = _camera.position
	map_view.camera.zoom = _camera.zoom
	map_view._after_camera_move()
