class_name EditorRegionPicker
extends Control

signal done(regions: Array)
signal closed

const ACCENT := Color("#2bc1f3")
const LINE := Color(1, 1, 1, 0.1)
const CARD := Color(1, 1, 1, 0.04)
const TEXT := Color("#f4f4f5")
const MUTED := Color(1, 1, 1, 0.55)
const SURFACE := Color("#1b1b1e")
const SEA := Color("#070e18")
const UNOWNED := Color(20 / 255.0, 25 / 255.0, 35 / 255.0, 0.65)
const REGION_EDGE := Color(10 / 255.0, 12 / 255.0, 16 / 255.0, 0.55)
const HOVER_FILL := Color(1, 1, 1, 0.48)
const PICKED_EDGE := Color(1, 1, 1, 0.9)
const MAX_OL_ZOOM := 8.0
const MIN_OL_ZOOM := 1.0

var engine: EngineLink
var single := false
var tiles_cache := ""
var rows: Array = []
var selected: Array = []
var owners: Array = []
var map: MapView
var map_ready := false
var load_failed := false
var _row_by_id := {}
var _fills := {}
var _ids := PackedStringArray()
var _index_of := {}
var _query := ""
var _owner := ""
var _hover := -1
var _search_call := 0
var _dialog: PanelContainer
var _hover_label: Label
var _map_frame: PanelContainer
var _map_holder: Control
var _status: Label
var _viewport: SubViewport
var _container: SubViewportContainer
var _overlay: Control
var _search: LineEdit
var _owner_select: OptionButton
var _owner_toggle: Button
var _matches_scroll: ScrollContainer
var _matches: VBoxContainer
var _count_label: Label
var _clear_button: Button
var _chips: HFlowContainer
var _empty_label: Label
var _done_button: Button
var _dragging := false
var _drag_distance := 0.0
var _painted := {}


static func small_button(text: String, extra := {}) -> Button:
	var button := Button.new()
	button.text = text
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var bg: Color = extra.get("bg", UiTheme.pick("overlay_card", CARD))
	var edge: Color = extra.get("border", UiTheme.pick("line", LINE))
	var pad: float = float(extra.get("pad", 9.6))
	var box := UI.box(bg, edge, 8, 1, Vector4(pad, 0, pad, 0))
	var lit := UI.box(Color(bg.r, bg.g, bg.b, minf(1.0, bg.a + 0.05)), edge, 8, 1, Vector4(pad, 0, pad, 0))
	for state in [["normal", box], ["focus", box], ["disabled", box], ["hover", lit], ["pressed", lit], ["hover_pressed", lit]]:
		button.add_theme_stylebox_override(state[0], state[1])
	button.add_theme_font_override("font", UI.font(int(extra.get("weight", 400))))
	button.add_theme_font_size_override("font_size", int(extra.get("size", 12)))
	var ink: Color = extra.get("ink", UiTheme.pick("text", TEXT))
	for slot in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color", "font_disabled_color"]:
		button.add_theme_color_override(slot, ink)
	button.custom_minimum_size.y = float(extra.get("height", 32.0))
	return button


static func field_box() -> StyleBoxFlat:
	return UI.box(Color(0, 0, 0, 0.3), UiTheme.pick("line", LINE), 8, 1, Vector4(9.6, 0, 9.6, 0))


func open(link: EngineLink, source: Dictionary, initial: Array, only_one: bool) -> void:
	engine = link
	single = only_one
	for entry in initial:
		if entry is Dictionary and not str((entry as Dictionary).get("id", "")).is_empty():
			selected.append((entry as Dictionary).duplicate())
	_build()
	_render_selection()
	_load(source)


func _build() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	var backdrop := ColorRect.new()
	backdrop.color = Color(6 / 255.0, 6 / 255.0, 7 / 255.0, 0.72)
	backdrop.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	backdrop.gui_input.connect(_on_backdrop)
	add_child(backdrop)
	var centre := CenterContainer.new()
	centre.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	centre.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(centre)
	_dialog = PanelContainer.new()
	var face := UI.box(UiTheme.pick("surface", SURFACE), UiTheme.pick("line", LINE), 16, 1, Vector4(0, 0, 0, 0))
	face.shadow_color = Color(0, 0, 0, 0.5)
	face.shadow_size = 35
	face.shadow_offset = Vector2(0, 24)
	_dialog.add_theme_stylebox_override("panel", face)
	_dialog.mouse_filter = Control.MOUSE_FILTER_STOP
	_dialog.clip_contents = true
	centre.add_child(_dialog)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	_dialog.add_child(column)
	column.add_child(_header())
	var body := MarginContainer.new()
	for side in ["margin_left", "margin_right", "margin_top", "margin_bottom"]:
		body.add_theme_constant_override(side, 11)
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	column.add_child(body)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 11)
	body.add_child(row)
	row.add_child(_map_side())
	row.add_child(_aside())
	_fit()
	get_viewport().size_changed.connect(_fit)


func _fit() -> void:
	if not is_instance_valid(_dialog):
		return
	var view := get_viewport_rect().size
	_dialog.custom_minimum_size = Vector2(minf(1152.0, view.x - 32.0), minf(736.0, view.y - 32.0))
	_dialog.reset_size()


func _header() -> Control:
	var holder := VBoxContainer.new()
	holder.add_theme_constant_override("separation", 0)
	var margin := MarginContainer.new()
	for side in [["margin_left", 13], ["margin_right", 13], ["margin_top", 10], ["margin_bottom", 10]]:
		margin.add_theme_constant_override(side[0], side[1])
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	var title := UI.label("Pick a region" if single else "Pick regions", 16, UiTheme.pick("text", TEXT), 800)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(title)
	var close_button := small_button("×", {"size": 16, "pad": 0.0})
	close_button.custom_minimum_size = Vector2(35, 32)
	close_button.tooltip_text = "Close region picker"
	close_button.pressed.connect(_close)
	row.add_child(close_button)
	margin.add_child(row)
	holder.add_child(margin)
	var rule := ColorRect.new()
	rule.color = UiTheme.pick("line", LINE)
	rule.custom_minimum_size.y = 1
	holder.add_child(rule)
	return holder


func _map_side() -> Control:
	var side := VBoxContainer.new()
	side.add_theme_constant_override("separation", 0)
	side.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	side.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_hover_label = UI.label("", 12, MUTED)
	_hover_label.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	_hover_label.custom_minimum_size.y = 18
	_hover_label.clip_text = true
	_hover_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	side.add_child(_hover_label)
	side.add_child(EditorKit.gap(5))
	_map_frame = PanelContainer.new()
	_map_frame.add_theme_stylebox_override("panel", UI.box(SEA, Color(1, 1, 1, 0.12), 14, 1, Vector4(1, 1, 1, 1)))
	_map_frame.clip_contents = true
	_map_frame.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_map_frame.custom_minimum_size.y = 220
	side.add_child(_map_frame)
	_map_holder = Control.new()
	_map_holder.clip_contents = true
	_map_frame.add_child(_map_holder)
	_status = UI.label("Loading the map…", 13, MUTED)
	_status.position = Vector2(16, 16)
	_map_holder.add_child(_status)
	return side


func _aside() -> Control:
	var aside := VBoxContainer.new()
	aside.add_theme_constant_override("separation", 8)
	aside.custom_minimum_size.x = 336
	aside.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_search = LineEdit.new()
	_search.placeholder_text = "Search regions by name…"
	_search.tooltip_text = "Search regions"
	_search.custom_minimum_size.y = 34
	_search.add_theme_stylebox_override("normal", field_box())
	_search.add_theme_stylebox_override("focus", field_box())
	_search.add_theme_font_override("font", UI.font(400))
	_search.add_theme_font_size_override("font_size", 13)
	_search.add_theme_color_override("font_color", UiTheme.pick("text", TEXT))
	_search.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.4))
	_search.add_theme_color_override("caret_color", UiTheme.pick("text", TEXT))
	_search.text_changed.connect(_on_search)
	aside.add_child(_search)
	if not single:
		var owner_row := HBoxContainer.new()
		owner_row.add_theme_constant_override("separation", 6)
		_owner_select = OptionButton.new()
		_owner_select.focus_mode = Control.FOCUS_NONE
		_owner_select.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		_owner_select.custom_minimum_size.y = 34
		_owner_select.clip_text = true
		_owner_select.fit_to_longest_item = false
		_owner_select.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		for state in ["normal", "hover", "pressed", "focus", "disabled"]:
			_owner_select.add_theme_stylebox_override(state, field_box())
		_owner_select.add_theme_font_override("font", UI.font(400))
		_owner_select.add_theme_font_size_override("font_size", 13)
		_owner_select.add_theme_color_override("font_color", UiTheme.pick("text", TEXT))
		_owner_select.add_theme_color_override("font_hover_color", UiTheme.pick("text", TEXT))
		_owner_select.tooltip_text = "Country"
		_owner_select.add_item("Choose a country…")
		_owner_select.set_item_metadata(0, "")
		_owner_select.item_selected.connect(_on_owner_chosen)
		owner_row.add_child(_owner_select)
		_owner_toggle = small_button("Select all")
		_owner_toggle.disabled = true
		_owner_toggle.modulate.a = 0.5
		_owner_toggle.pressed.connect(_toggle_owner)
		owner_row.add_child(_owner_toggle)
		aside.add_child(owner_row)
	_matches_scroll = ScrollContainer.new()
	_matches_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_matches_scroll.visible = false
	_matches = VBoxContainer.new()
	_matches.add_theme_constant_override("separation", 4)
	_matches.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_matches_scroll.add_child(_matches)
	aside.add_child(_matches_scroll)
	var count_row := HBoxContainer.new()
	count_row.add_theme_constant_override("separation", 6)
	_count_label = UI.label("0 selected".to_upper(), 11, MUTED, 800, "Arial", 1)
	_count_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_count_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	count_row.add_child(_count_label)
	_clear_button = small_button("Clear", {"height": 27.0})
	_clear_button.pressed.connect(_clear_selection)
	count_row.add_child(_clear_button)
	count_row.custom_minimum_size.y = 27
	aside.add_child(count_row)
	var chip_scroll := ScrollContainer.new()
	chip_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	chip_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	chip_scroll.custom_minimum_size.y = 40
	var chip_column := VBoxContainer.new()
	chip_column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	chip_column.add_theme_constant_override("separation", 0)
	_empty_label = UI.wrapped("Click a region on the map." if single else "Click regions on the map, or search for them.", 12, MUTED)
	chip_column.add_child(_empty_label)
	_chips = HFlowContainer.new()
	_chips.add_theme_constant_override("h_separation", 5)
	_chips.add_theme_constant_override("v_separation", 5)
	_chips.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	chip_column.add_child(_chips)
	chip_scroll.add_child(chip_column)
	aside.add_child(chip_scroll)
	var footer := HBoxContainer.new()
	footer.add_theme_constant_override("separation", 7)
	footer.alignment = BoxContainer.ALIGNMENT_END
	var cancel := small_button("Cancel")
	cancel.pressed.connect(_close)
	footer.add_child(cancel)
	_done_button = small_button("Use this region" if single else "Insert", {"weight": 800})
	_done_button.pressed.connect(_finish)
	footer.add_child(_done_button)
	aside.add_child(footer)
	aside.resized.connect(_size_matches.bind(aside))
	_search.grab_focus.call_deferred()
	return aside


func _size_matches(aside: Control) -> void:
	if is_instance_valid(_matches_scroll):
		_matches_scroll.custom_minimum_size.y = minf(_matches.get_combined_minimum_size().y, aside.size.y * 0.4)


func _load(source: Dictionary) -> void:
	var reply: Dictionary = await engine.request("editor.rules.regionPicker", source)
	if not is_inside_tree():
		return
	if not reply.get("ok", false) or typeof(reply.get("result")) != TYPE_DICTIONARY:
		load_failed = true
		_status.text = "This scenario's map could not be loaded."
		_status.add_theme_color_override("font_color", Color("#fca5a5"))
		return
	var result: Dictionary = reply["result"]
	rows = result.get("rows", [])
	owners = result.get("owners", [])
	_fills = result.get("fills", {})
	_row_by_id.clear()
	for row in rows:
		_row_by_id[str((row as Dictionary).get("id", ""))] = row
	var named: Array = []
	for entry in selected:
		var record: Dictionary = (entry as Dictionary).duplicate()
		var known: Variant = _row_by_id.get(str(record.get("id", "")))
		record["name"] = str((known as Dictionary).get("name", "")) if known is Dictionary else str(record.get("name", record.get("id", "")))
		named.append(record)
	selected = named
	if is_instance_valid(_owner_select):
		for entry in owners:
			_owner_select.add_item("%s (%d)" % [str((entry as Dictionary).get("owner", "")), int((entry as Dictionary).get("count", 0))])
			_owner_select.set_item_metadata(_owner_select.item_count - 1, str((entry as Dictionary).get("owner", "")))
	_render_selection()
	if tiles_cache.is_empty():
		var hello: Dictionary = await engine.request("hello")
		var root := str((hello.get("result", {}) as Dictionary).get("dataRoot", "")) if hello.get("ok", false) and hello.get("result") is Dictionary else ""
		tiles_cache = root.path_join("native-cache").path_join("tiles") if not root.is_empty() else ""
	if not is_inside_tree():
		return
	_make_map(str(result.get("file", "")))


func _make_map(file: String) -> void:
	_container = SubViewportContainer.new()
	_container.stretch = true
	_container.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_container.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_map_holder.add_child(_container)
	_viewport = SubViewport.new()
	_viewport.handle_input_locally = false
	_viewport.gui_disable_input = true
	_viewport.transparent_bg = false
	_container.add_child(_viewport)
	map = MapView.new()
	_viewport.add_child(map)
	map.input_enabled = false
	map.editor_enable()
	map.basemap.cache_dir = tiles_cache
	map.editor_apply_basemap({"basemapId": "ocean-dark"}, engine)
	map.set_overlays_visible(false)
	map.baker.baked.connect(_on_baker)
	map.baked.connect(_on_baked)
	_overlay = Control.new()
	_overlay.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_overlay.mouse_filter = Control.MOUSE_FILTER_STOP
	_overlay.gui_input.connect(_on_map_input)
	_overlay.mouse_exited.connect(_set_hover.bind(-1))
	_map_holder.add_child(_overlay)
	_map_holder.add_child(_zoom_box())
	_map_holder.move_child(_status, -1)
	map.load_regions(file)


func _zoom_box() -> Control:
	var box := PanelContainer.new()
	box.add_theme_stylebox_override("panel", UI.box(Color(18 / 255.0, 20 / 255.0, 26 / 255.0, 0.75), Color(1, 1, 1, 0.12), 8, 1, Vector4(4, 4, 4, 4)))
	box.position = Vector2(12, 12)
	box.mouse_filter = Control.MOUSE_FILTER_STOP
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 4)
	box.add_child(column)
	for spec in [["+", "Zoom in", 1.0], ["–", "Zoom out", -1.0]]:
		var button := Button.new()
		button.text = str(spec[0])
		button.tooltip_text = str(spec[1])
		button.focus_mode = Control.FOCUS_NONE
		button.custom_minimum_size = Vector2(24, 24)
		button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		var idle := UI.box(Color(1, 1, 1, 0.08), Color(0, 0, 0, 0), 6, 0, Vector4(0, 0, 0, 0))
		var lit := UI.box(Color(1, 1, 1, 0.22), Color(0, 0, 0, 0), 6, 0, Vector4(0, 0, 0, 0))
		for state in ["normal", "focus", "disabled"]:
			button.add_theme_stylebox_override(state, idle)
		for state in ["hover", "pressed", "hover_pressed"]:
			button.add_theme_stylebox_override(state, lit)
		button.add_theme_font_override("font", UI.font(700))
		button.add_theme_font_size_override("font_size", 16)
		for state in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
			button.add_theme_color_override(state, Color(1, 1, 1))
		button.pressed.connect(_zoom_step.bind(float(spec[2])))
		column.add_child(button)
	return box


func _on_baker(result: Dictionary) -> void:
	_ids = result.get("ids", PackedStringArray())
	_index_of.clear()
	for index in range(_ids.size()):
		_index_of[str(_ids[index])] = index
	if map_ready:
		_paint_all()


func _on_baked(_info: Dictionary) -> void:
	map.set_overlays_visible(false)
	map_ready = true
	_status.visible = false
	map.editor_set_view(MapView.CityLayer.ohproject(0.0, 20.0), _camera_zoom(2.0))
	_paint_all.call_deferred()


func _camera_zoom(ol_zoom: float) -> float:
	return pow(2.0, ol_zoom) / 16.0


func _viewport_size() -> Vector2:
	return Vector2(_viewport.size) if _viewport else Vector2.ZERO


func _picked_ids() -> Dictionary:
	var ids := {}
	for entry in selected:
		ids[str((entry as Dictionary).get("id", ""))] = true
	return ids


func _look(index: int, picked: Dictionary) -> Array:
	var id := str(_ids[index]) if index < _ids.size() else ""
	if picked.has(id):
		return [Color(ACCENT, 0.9), PICKED_EDGE, Color(1.6, 1.0, 1.0, 1.0)]
	if index == _hover:
		return [HOVER_FILL, REGION_EDGE, Color(0.6, 0.0, 0.0, 1.0)]
	var row: Variant = _row_by_id.get(id)
	var owner := str((row as Dictionary).get("owner", "")) if row is Dictionary else ""
	var fill := UNOWNED
	if not owner.is_empty() and _fills.has(owner):
		var shade: Array = _fills[owner]
		fill = Color(float(shade[0]) / 255.0, float(shade[1]) / 255.0, float(shade[2]) / 255.0, float(shade[3]))
	return [fill, REGION_EDGE, Color(0.6, 0.0, 0.0, 1.0)]


func _paint_all() -> void:
	if not map_ready:
		return
	var picked := _picked_ids()
	var count := mini(_ids.size(), map.editor_region_count())
	for index in range(count):
		var look := _look(index, picked)
		map.editor_set_region_style(index, look[0], look[1], look[2])
	_painted = picked
	map.editor_commit_colors()


func _repaint(indices: Array) -> void:
	if not map_ready:
		return
	var picked := _picked_ids()
	for index in indices:
		if int(index) >= 0 and int(index) < _ids.size():
			var look := _look(int(index), picked)
			map.editor_set_region_style(int(index), look[0], look[1], look[2])
	map.editor_commit_colors()


func region_fill(id: String) -> Color:
	var index := int(_index_of.get(id, -1))
	if index < 0:
		return Color(0, 0, 0, 0)
	return _look(index, _picked_ids())[0]


func _to_world(local: Vector2) -> Vector2:
	return map.camera.position + (local - _viewport_size() * 0.5) / map.camera.zoom.x


func _on_map_input(event: InputEvent) -> void:
	if not map_ready:
		return
	if event is InputEventMouseButton:
		var press := event as InputEventMouseButton
		if press.button_index == MOUSE_BUTTON_WHEEL_UP and press.pressed:
			map.editor_zoom_at(press.position, 1.15)
			_clamp_zoom()
		elif press.button_index == MOUSE_BUTTON_WHEEL_DOWN and press.pressed:
			map.editor_zoom_at(press.position, 1.0 / 1.15)
			_clamp_zoom()
		elif press.button_index == MOUSE_BUTTON_LEFT:
			if press.pressed:
				_dragging = true
				_drag_distance = 0.0
			else:
				_dragging = false
				if _drag_distance < 5.0:
					click_at(press.position)
	elif event is InputEventMouseMotion:
		var motion := event as InputEventMouseMotion
		if _dragging:
			_drag_distance += motion.relative.length()
			map.editor_pan(motion.relative)
		else:
			_set_hover(map.baker.pick(_to_world(motion.position)))


func _clamp_zoom() -> void:
	var zoom := clampf(map.camera.zoom.x, _camera_zoom(MIN_OL_ZOOM), _camera_zoom(MAX_OL_ZOOM))
	if zoom != map.camera.zoom.x:
		map.editor_set_view(map.camera.position, zoom)


func _zoom_step(delta: float) -> void:
	if not map_ready:
		return
	map.editor_zoom_at(_viewport_size() * 0.5, pow(2.0, delta))
	_clamp_zoom()


func _set_hover(index: int) -> void:
	if index == _hover:
		return
	var before := _hover
	_hover = index
	var id := str(_ids[index]) if index >= 0 and index < _ids.size() else ""
	var row: Variant = _row_by_id.get(id)
	if row is Dictionary:
		var owner := str((row as Dictionary).get("owner", ""))
		_hover_label.text = "%s%s" % [str((row as Dictionary).get("name", "")), " · %s" % owner if not owner.is_empty() else ""]
	else:
		_hover_label.text = ""
	if is_instance_valid(_overlay):
		_overlay.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if index >= 0 else Control.CURSOR_ARROW
	_repaint([before, index])


func click_at(local: Vector2) -> void:
	var index := map.baker.pick(_to_world(local))
	if index < 0 or index >= _ids.size():
		return
	await toggle(str(_ids[index]))


func toggle(id: String) -> void:
	var reply: Dictionary = await engine.request("editor.rules.toggleRegions", {"selected": selected, "id": id, "single": single})
	if reply.get("ok", false) and typeof(reply.get("result")) == TYPE_DICTIONARY:
		selected = (reply["result"] as Dictionary).get("selected", selected)
	_selection_changed()


func _toggle_owner() -> void:
	if _owner.is_empty():
		return
	var reply: Dictionary = await engine.request("editor.rules.toggleRegions", {"selected": selected, "owner": _owner})
	if reply.get("ok", false) and typeof(reply.get("result")) == TYPE_DICTIONARY:
		selected = (reply["result"] as Dictionary).get("selected", selected)
	_selection_changed()


func _clear_selection() -> void:
	selected = []
	_selection_changed()


func _remove(id: String) -> void:
	var kept: Array = []
	for entry in selected:
		if str((entry as Dictionary).get("id", "")) != id:
			kept.append(entry)
	selected = kept
	_selection_changed()


func _selection_changed() -> void:
	_render_selection()
	_render_matches_marks()
	if not map_ready:
		return
	var picked := _picked_ids()
	var touched: Array = []
	for id in picked:
		if not _painted.has(id):
			touched.append(int(_index_of.get(id, -1)))
	for id in _painted:
		if not picked.has(id):
			touched.append(int(_index_of.get(id, -1)))
	_painted = picked
	_repaint(touched)


func _render_selection() -> void:
	if not is_instance_valid(_chips):
		return
	_count_label.text = ("1 selected" if selected.size() == 1 else "%d selected" % selected.size()).to_upper()
	_clear_button.visible = not selected.is_empty()
	_empty_label.visible = selected.is_empty()
	EditorKit.clear(_chips)
	for entry in selected:
		_chips.add_child(_chip(entry))
	var any := not selected.is_empty()
	_done_button.disabled = not any
	var bg := ACCENT if any else UiTheme.pick("overlay_card", CARD)
	var edge := ACCENT if any else UiTheme.pick("line", LINE)
	var face := UI.box(bg, edge, 8, 1, Vector4(9.6, 0, 9.6, 0))
	for state in ["normal", "focus", "disabled", "hover", "pressed", "hover_pressed"]:
		_done_button.add_theme_stylebox_override(state, face)
	var ink := Color("#06131a") if any else MUTED
	for slot in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color", "font_disabled_color"]:
		_done_button.add_theme_color_override(slot, ink)
	_done_button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if any else Control.CURSOR_ARROW
	_update_owner_toggle()


func _chip(entry: Dictionary) -> Button:
	var id := str(entry.get("id", ""))
	var chip := small_button("", {"border": ACCENT, "height": 28.8})
	chip.tooltip_text = id
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var words := UI.label(str(entry.get("name", id)), 12, UiTheme.pick("text", TEXT))
	words.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	words.mouse_filter = Control.MOUSE_FILTER_IGNORE
	words.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(words)
	var cross := UI.label("×", 12, MUTED)
	cross.mouse_filter = Control.MOUSE_FILTER_IGNORE
	cross.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(cross)
	var margin := MarginContainer.new()
	margin.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for side in [["margin_left", 10], ["margin_right", 10]]:
		margin.add_theme_constant_override(side[0], side[1])
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	margin.add_child(row)
	chip.add_child(margin)
	chip.custom_minimum_size.x = row.get_combined_minimum_size().x + 20.0
	chip.pressed.connect(_remove.bind(id))
	return chip


func _on_search(text: String) -> void:
	_query = text
	_search_call += 1
	var call := _search_call
	if text.strip_edges().is_empty():
		_show_matches([])
		_matches_scroll.visible = false
		return
	var reply: Dictionary = await engine.request("editor.rules.searchRegions", {"query": text})
	if call != _search_call or not is_inside_tree():
		return
	var found: Array = (reply.get("result", {}) as Dictionary).get("matches", []) if reply.get("ok", false) and reply.get("result") is Dictionary else []
	_show_matches(found)


func _show_matches(found: Array) -> void:
	EditorKit.clear(_matches)
	_matches_scroll.visible = not _query.strip_edges().is_empty()
	if found.is_empty() and _matches_scroll.visible:
		var none := UI.label("No region by that name.", 12, MUTED)
		_matches.add_child(none)
	for row in found:
		_matches.add_child(_match_row(row))
	_size_matches.call_deferred(_matches_scroll.get_parent())


func _match_row(row: Dictionary) -> Button:
	var id := str(row.get("id", ""))
	var button := small_button("")
	button.set_meta("region", id)
	button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var line := HBoxContainer.new()
	line.mouse_filter = Control.MOUSE_FILTER_IGNORE
	line.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	line.offset_left = 10
	line.offset_right = -10
	var words := UI.label(str(row.get("name", "")), 12, UiTheme.pick("text", TEXT))
	words.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	words.clip_text = true
	words.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	words.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	words.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	words.mouse_filter = Control.MOUSE_FILTER_IGNORE
	line.add_child(words)
	var whose := UI.label(str(row.get("owner", "")), 11, MUTED)
	whose.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	whose.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	whose.mouse_filter = Control.MOUSE_FILTER_IGNORE
	line.add_child(whose)
	button.add_child(line)
	_mark_match(button, _picked_ids().has(id))
	button.pressed.connect(_pick_match.bind(id))
	return button


func _mark_match(button: Button, on: bool) -> void:
	var face := UI.box(Color(0, 0, 0, 0.42) if on else UiTheme.pick("overlay_card", CARD), ACCENT if on else UiTheme.pick("line", LINE), 8, 1, Vector4(9.6, 0, 9.6, 0))
	for state in ["normal", "focus", "disabled", "hover", "pressed", "hover_pressed"]:
		button.add_theme_stylebox_override(state, face)


func _render_matches_marks() -> void:
	if not is_instance_valid(_matches):
		return
	var picked := _picked_ids()
	for child in _matches.get_children():
		if child is Button and child.has_meta("region"):
			_mark_match(child as Button, picked.has(str(child.get_meta("region"))))


func _pick_match(id: String) -> void:
	await toggle(id)
	focus_region(id)


func focus_region(id: String) -> void:
	if not map_ready:
		return
	var index := int(_index_of.get(id, -1))
	if index < 0:
		return
	var centre: Vector2 = map.war_region_centroid(index)
	var span := maxf(4.0, sqrt(maxf(0.0, map.war_region_area(index))) * 1.6)
	var view := _viewport_size()
	var fit := minf((view.x - 96.0) / span, (view.y - 96.0) / span)
	map.editor_set_view(centre, clampf(fit, _camera_zoom(MIN_OL_ZOOM), _camera_zoom(6.0)))


func _on_owner_chosen(index: int) -> void:
	_owner = str(_owner_select.get_item_metadata(index))
	_update_owner_toggle()


func _update_owner_toggle() -> void:
	if not is_instance_valid(_owner_toggle):
		return
	var total := 0
	for entry in owners:
		if str((entry as Dictionary).get("owner", "")) == _owner:
			total = int((entry as Dictionary).get("count", 0))
	var picked := _picked_ids()
	var mine := 0
	if not _owner.is_empty():
		for row in rows:
			if str((row as Dictionary).get("owner", "")) == _owner and picked.has(str((row as Dictionary).get("id", ""))):
				mine += 1
	_owner_toggle.text = "Deselect all" if not _owner.is_empty() and mine == total else "Select all"
	_owner_toggle.disabled = _owner.is_empty()
	_owner_toggle.modulate.a = 0.5 if _owner.is_empty() else 1.0
	_owner_toggle.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if not _owner.is_empty() else Control.CURSOR_ARROW


func _on_backdrop(event: InputEvent) -> void:
	if event is InputEventMouseButton and (event as InputEventMouseButton).pressed and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT:
		_close()


func _input(event: InputEvent) -> void:
	if event is InputEventKey and (event as InputEventKey).pressed and (event as InputEventKey).keycode == KEY_ESCAPE and is_visible_in_tree():
		get_viewport().set_input_as_handled()
		_close()


func _finish() -> void:
	if selected.is_empty():
		return
	done.emit(selected.duplicate(true))


func _close() -> void:
	closed.emit()
