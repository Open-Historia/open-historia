class_name WorkshopSearch
extends PanelContainer

const WIDTH := 320.0

var host: Workshop
var _edit: LineEdit
var _box: Control
var _clear: Button
var _scroll: ScrollContainer
var _list: VBoxContainer
var _query := ""
var _serial := 0
var _open := false
var _results := {"custom": [], "regions": [], "world": []}


func _init() -> void:
	add_theme_stylebox_override("panel", UI.box(WorkshopUI.PANEL, Color(1, 1, 1, 0.09), 16, 1, Vector4(6, 6, 6, 6)))
	mouse_filter = Control.MOUSE_FILTER_STOP
	visible = false
	_scroll = ScrollContainer.new()
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	add_child(_scroll)
	_list = VBoxContainer.new()
	_list.add_theme_constant_override("separation", 2)
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_scroll.add_child(_list)


func setup(workshop: Workshop) -> void:
	host = workshop


func attach(edit: LineEdit, box: Control) -> void:
	_edit = edit
	_box = box
	edit.text = _query
	edit.text_changed.connect(_on_text)
	edit.focus_entered.connect(func() -> void: _set_open(true))
	edit.gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventKey and (event as InputEventKey).pressed and (event as InputEventKey).keycode == KEY_ESCAPE:
			_set_open(false))
	_clear = WorkshopUI.base_button("✕")
	var empty := StyleBoxEmpty.new()
	for state_name in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
		_clear.add_theme_stylebox_override(state_name, empty)
	WorkshopUI._ink(_clear, Color(1, 1, 1, 0.6), 13.0, 400)
	_clear.tooltip_text = "Clear"
	_clear.visible = not _query.is_empty()
	_clear.pressed.connect(func() -> void:
		_query = ""
		if is_instance_valid(_edit):
			_edit.text = ""
		_set_open(false)
		_search())
	var row := edit.get_parent()
	if row:
		row.add_child(_clear)


func _on_text(text: String) -> void:
	_query = text
	if is_instance_valid(_clear):
		_clear.visible = not text.is_empty()
	_set_open(true)
	_search()


func _set_open(on: bool) -> void:
	_open = on
	_render()


func _search() -> void:
	_serial += 1
	var serial := _serial
	var q := _query.strip_edges().to_lower()
	if q.length() < 2:
		_results = {"custom": [], "regions": [], "world": []}
		_render()
		return
	await get_tree().create_timer(0.18).timeout
	if serial != _serial or host == null or host.session.is_empty():
		return
	var reply := await host.request_raw("workshop.search", {"text": q})
	if serial != _serial or not reply.get("ok", false):
		return
	_results = reply["result"]
	_render()


func _format_pop(value: Variant) -> String:
	var n := float(value) if value != null else 0.0
	if n <= 0.0:
		return ""
	if n >= 1000000.0:
		return "%.1fM" % (n / 1000000.0)
	if n >= 1000.0:
		return "%dk" % int(round(n / 1000.0))
	return str(int(n))


func _badge(text: String, color: Color) -> PanelContainer:
	var holder := PanelContainer.new()
	holder.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0), Color(color, 0x44 / 255.0), 4, 1, Vector4(4, 1, 4, 1)))
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	holder.add_child(UI.label(text, 9, color, 700, "Arial", 1))
	return holder


func _row(badge_text: String, badge_color: Color, name: String, detail: String, action: Callable) -> PanelContainer:
	var holder := PanelContainer.new()
	var normal := UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 7, 0, Vector4(7, 5, 7, 5))
	var hover := UI.box(Color(1, 1, 1, 0.08), Color(0, 0, 0, 0), 7, 0, Vector4(7, 5, 7, 5))
	holder.add_theme_stylebox_override("panel", normal)
	holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 7)
	line.add_child(_badge(badge_text, badge_color))
	var title := UI.label(name, 13, Color(1, 1, 1), 600)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title.clip_text = true
	title.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	line.add_child(title)
	if not detail.is_empty():
		var right := UI.label(detail, 11, Color(1, 1, 1, 0.45))
		right.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		line.add_child(right)
	holder.add_child(line)
	WorkshopUI.ignore_mouse(holder)
	WorkshopUI.clickable(holder, func(_event: InputEventMouseButton) -> void: action.call())
	holder.mouse_entered.connect(func() -> void: holder.add_theme_stylebox_override("panel", hover))
	holder.mouse_exited.connect(func() -> void: holder.add_theme_stylebox_override("panel", normal))
	return holder


func _coord_of(value: Variant) -> Vector2:
	if value is Array and (value as Array).size() >= 2:
		return Vector2(float(value[0]), float(value[1]))
	return Vector2(INF, INF)


func _locate(value: Variant) -> void:
	var at := _coord_of(value)
	if is_finite(at.x) and is_finite(at.y):
		host.locate(at)


func _render() -> void:
	WorkshopUI.clear(_list)
	var shown := _open and _query.strip_edges().length() >= 2 and host != null
	visible = shown
	if not shown:
		return
	var custom: Array = _results.get("custom", []) if _results.get("custom") is Array else []
	var regions: Array = _results.get("regions", []) if _results.get("regions") is Array else []
	var world: Array = _results.get("world", []) if _results.get("world") is Array else []
	if custom.is_empty() and regions.is_empty() and world.is_empty():
		var none := MarginContainer.new()
		for pair in [["margin_left", 8], ["margin_right", 8], ["margin_top", 6], ["margin_bottom", 6]]:
			none.add_theme_constant_override(pair[0], pair[1])
		none.add_child(UI.label("No places found.", 12, Color(1, 1, 1, 0.5)))
		_list.add_child(none)
	for entry in custom:
		var place: Dictionary = entry
		var coord: Variant = place.get("coord")
		_list.add_child(_row("THIS MAP", Color("#d4d4d8"), str(place.get("name", "")), _format_pop(place.get("population")), func() -> void: _locate(coord)))
	for entry in regions:
		var region: Dictionary = entry
		var id := str(region.get("id", ""))
		var name := str(region.get("name", ""))
		_list.add_child(_row("REGION", Color("#86efac"), name if not name.is_empty() else "Region", str(region.get("ownerName", "")), func() -> void:
			host.set_selection([id])
			host.zoom_to([id])))
	for entry in world:
		var city: Dictionary = entry
		var coord: Variant = city.get("coord")
		var line := HBoxContainer.new()
		line.add_theme_constant_override("separation", 4)
		var detail := ("★ " if city.get("capital") == true else "") + _format_pop(city.get("population"))
		line.add_child(_row("WORLD", Color("#fcd34d"), str(city.get("name", "")), detail, func() -> void: _locate(coord)))
		var add := WorkshopUI.base_button("＋")
		var style := UI.box(Color(0, 0, 0, 0), Color(1, 1, 1, 0.2), 6, 1, Vector4(7, 3, 7, 3))
		var hover := UI.box(Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.28), 6, 1, Vector4(7, 3, 7, 3))
		WorkshopUI._flat_styles(add, style, hover, hover, style)
		WorkshopUI._ink(add, Color("#e4e4e7"), 11.0, 700)
		add.tooltip_text = "Add to this map as a city"
		add.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		add.pressed.connect(func() -> void: _add_city(city))
		line.add_child(add)
		_list.add_child(line)
	_place()


func _add_city(city: Dictionary) -> void:
	var reply := await host.request("workshop.feature.addCity", {"city": city})
	if reply.has("id"):
		_locate(city.get("coord"))


func _place() -> void:
	if not is_instance_valid(_box) or not visible or not get_parent():
		return
	var area := (get_parent() as Control).size if get_parent() is Control else get_viewport_rect().size
	var width := minf(WIDTH, area.x - 40.0)
	var origin := (get_parent() as Control).global_position if get_parent() is Control else Vector2.ZERO
	var at := _box.global_position - origin + Vector2(0, _box.size.y + 6.0)
	_scroll.custom_minimum_size = Vector2(width - 12.0, minf(_list.get_combined_minimum_size().y, area.y * 0.5 - 12.0))
	custom_minimum_size.x = width
	reset_size()
	position = Vector2(clampf(at.x, 4.0, maxf(4.0, area.x - width - 4.0)), at.y)


func _process(_delta: float) -> void:
	if visible:
		_place()


func _input(event: InputEvent) -> void:
	if not visible or not (event is InputEventMouseButton) or not (event as InputEventMouseButton).pressed:
		return
	var point := (event as InputEventMouseButton).global_position
	if get_global_rect().has_point(point):
		return
	if is_instance_valid(_box) and _box.get_global_rect().has_point(point):
		return
	_open = false
	visible = false
