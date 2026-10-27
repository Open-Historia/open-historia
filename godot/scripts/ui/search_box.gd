class_name SearchBox
extends Control

signal fly_to(lon: float, lat: float, zoom: float)
signal fit_bounds(west: float, south: float, east: float, north: float)
signal focus_unit(payload: Dictionary)
signal focus_feature(payload: Dictionary)
signal expanded_changed(expanded: bool)

const COMPACT := 38.0
const OPEN_WIDTH := 272.0
const LOCAL_LIMIT := 4
const SUGGESTION_LIMIT := 7
const DEBOUNCE := 0.3
const GLYPHS := {
	"search": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2.5' stroke-linecap='round'><circle cx='11' cy='11' r='7'/><line x1='16.5' y1='16.5' x2='22' y2='22'/></svg>",
	"close": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2.5' stroke-linecap='round'><line x1='18' y1='6' x2='6' y2='18'/><line x1='6' y1='6' x2='18' y2='18'/></svg>",
	"go": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><line x1='5' y1='12' x2='19' y2='12'/><polyline points='12 5 19 12 12 19'/></svg>",
	"globe": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2' stroke-linecap='round'><circle cx='12' cy='12' r='10'/><line x1='2' y1='12' x2='22' y2='12'/><path d='M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z'/></svg>",
	"city": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2' stroke-linecap='round'><rect x='3' y='9' width='18' height='12' rx='1'/><path d='M8 21V9M16 21V9M3 13h18M9 9V5h6v4'/></svg>",
	"pin": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2' stroke-linecap='round'><path d='M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z'/><circle cx='12' cy='9' r='2.5'/></svg>",
	"region": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2' stroke-linecap='round'><polygon points='3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21'/></svg>",
}

var engine: EngineLink
var context: Dictionary = {}
var expanded := false
var status := ""
var query := ""
var selected := -1
var suggestions: Array = []
var _local: Array = []
var _local_query := ""
var _remote_query := ""
var _remote: Array = []
var _fictional := false
var _remote_call := 0
var _debounce: Timer
var _shell: GlassPanel
var _list_panel: GlassPanel
var _list: VBoxContainer
var _toggle: Button
var _input: LineEdit
var _go: Button
var _spinner: PlaceSpinner
var _textures := {}
var _width_tween: Tween


func _init() -> void:
	anchor_left = 0.0
	anchor_right = 0.0
	anchor_top = 0.0
	anchor_bottom = 0.0
	offset_left = 0.0
	offset_top = 0.0
	offset_right = COMPACT
	offset_bottom = COMPACT
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_list_panel = GlassPanel.new(UI.HUD_BG_STRONG, 10.0)
	_list_panel.visible = false
	_list_panel.anchor_right = 1.0
	_list_panel.offset_left = -1.0
	_list_panel.offset_right = 1.0
	_list_panel.offset_bottom = 1.0
	_list = VBoxContainer.new()
	_list.add_theme_constant_override("separation", 0)
	_list_panel.add_child(_list)
	add_child(_list_panel)
	_shell = GlassPanel.new(UI.HUD_BG, 10.0)
	_shell.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_shell.clip_contents = true
	_shell.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	_shell.gui_input.connect(_on_shell_input)
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 0)
	line.mouse_filter = Control.MOUSE_FILTER_PASS
	_toggle = _glyph_button("search", Color(1, 1, 1, 0.8))
	_toggle.custom_minimum_size = Vector2(COMPACT, COMPACT)
	_toggle.tooltip_text = "Search place"
	_toggle.pressed.connect(_on_toggle)
	_spinner = PlaceSpinner.new()
	_spinner.visible = false
	_spinner.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	_spinner.custom_minimum_size = Vector2(14, 14)
	_spinner.offset_left = -7
	_spinner.offset_top = -7
	_spinner.offset_right = 7
	_spinner.offset_bottom = 7
	_toggle.add_child(_spinner)
	line.add_child(_toggle)
	_input = LineEdit.new()
	_input.placeholder_text = "Search place..."
	_input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_input.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_input.flat = true
	_input.caret_blink = true
	_input.context_menu_enabled = false
	_input.add_theme_font_override("font", UI.font(400))
	_input.add_theme_font_size_override("font_size", 14)
	_input.add_theme_color_override("font_color", UI.WHITE)
	_input.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.45))
	for state in ["normal", "focus", "read_only"]:
		_input.add_theme_stylebox_override(state, StyleBoxEmpty.new())
	_input.modulate.a = 0.0
	_input.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_input.editable = false
	_input.text_changed.connect(_on_text_changed)
	_input.gui_input.connect(_on_input_key)
	line.add_child(_input)
	_go = _glyph_button("go", Color(1, 1, 1, 0.2), 15)
	_go.custom_minimum_size = Vector2(35, COMPACT)
	_go.tooltip_text = "Go"
	_go.visible = false
	_go.pressed.connect(commit)
	line.add_child(_go)
	var holder := Control.new()
	holder.mouse_filter = Control.MOUSE_FILTER_PASS
	line.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	holder.add_child(line)
	_shell.add_child(holder)
	add_child(_shell)
	_debounce = Timer.new()
	_debounce.one_shot = true
	_debounce.wait_time = DEBOUNCE
	_debounce.timeout.connect(_fetch_remote)
	add_child(_debounce)


func setup(link: EngineLink, setup_context: Dictionary = {}) -> void:
	engine = link
	context = setup_context


func open() -> void:
	if expanded:
		return
	expanded = true
	_input.editable = true
	_input.mouse_filter = Control.MOUSE_FILTER_STOP
	_shell.mouse_default_cursor_shape = Control.CURSOR_ARROW
	_toggle.tooltip_text = "Close"
	_set_glyph(_toggle, "close", _toggle_color())
	_go.visible = true
	_animate_width(OPEN_WIDTH)
	var fade := create_tween()
	fade.tween_interval(0.15)
	fade.tween_property(_input, "modulate:a", 1.0, 0.2)
	_input.grab_focus()
	expanded_changed.emit(true)
	if engine:
		var reply: Dictionary = await engine.request("mapcards.search", {"query": ""})
		if reply.get("ok", false):
			_fictional = bool((reply.get("result", {}) as Dictionary).get("fictional", false))


func close() -> void:
	_debounce.stop()
	if _remote_call > 0 and engine:
		engine.cancel(_remote_call)
	_remote_call = 0
	expanded = false
	query = ""
	status = ""
	selected = -1
	_remote = []
	_remote_query = ""
	_local = []
	_local_query = ""
	suggestions = []
	_input.text = ""
	_input.placeholder_text = "Search place..."
	_input.add_theme_color_override("font_color", UI.WHITE)
	_input.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.45))
	_set_glyph(_toggle, "search", Color(1, 1, 1, 0.8))
	_spinner.visible = false
	_input.editable = false
	_input.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_input.modulate.a = 0.0
	_input.release_focus()
	_shell.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	_toggle.tooltip_text = "Search place"
	_go.visible = false
	_animate_width(COMPACT)
	_paint()
	expanded_changed.emit(false)


func is_expanded() -> bool:
	return expanded


func _animate_width(width: float) -> void:
	if _width_tween:
		_width_tween.kill()
	_width_tween = create_tween().set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	_width_tween.tween_property(self, "offset_right", offset_left + width, 0.35)


func _texture(name: String, size: int, color: Color) -> Texture2D:
	var key := "%s:%d:%s" % [name, size, color.to_html()]
	if _textures.has(key):
		return _textures[key]
	var svg: String = str(GLYPHS.get(name, "")).replace("#fff", "#" + color.to_html(false))
	var image := Image.new()
	if image.load_svg_from_string(svg, float(size) / 24.0) != OK:
		return null
	if color.a < 1.0:
		image.convert(Image.FORMAT_RGBA8)
		for y in range(image.get_height()):
			for x in range(image.get_width()):
				var pixel := image.get_pixel(x, y)
				pixel.a *= color.a
				image.set_pixel(x, y, pixel)
	var texture := ImageTexture.create_from_image(image)
	_textures[key] = texture
	return texture


func _glyph_button(name: String, color: Color, size := 14) -> Button:
	var node := Button.new()
	node.flat = true
	node.focus_mode = Control.FOCUS_NONE
	node.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	for state in ["normal", "hover", "pressed", "focus", "disabled", "hover_pressed"]:
		node.add_theme_stylebox_override(state, StyleBoxEmpty.new())
	node.set_meta("glyph_size", size)
	_set_glyph(node, name, color)
	return node


func _set_glyph(node: Button, name: String, color: Color) -> void:
	node.icon = _texture(name, int(node.get_meta("glyph_size", 14)), color)


func _toggle_color() -> Color:
	return Color("#f87171") if status == "error" else Color(1, 1, 1, 0.8)


func _on_shell_input(event: InputEvent) -> void:
	if expanded or not (event is InputEventMouseButton):
		return
	var button := event as InputEventMouseButton
	if button.button_index == MOUSE_BUTTON_LEFT and not button.pressed:
		open()
		accept_event()


func _on_toggle() -> void:
	if expanded:
		close()
	else:
		open()


func _on_text_changed(value: String) -> void:
	query = value
	status = ""
	selected = -1
	_input.placeholder_text = "Search place..."
	_input.add_theme_color_override("font_color", UI.WHITE)
	_set_glyph(_toggle, "close" if expanded else "search", _toggle_color())
	_set_glyph(_go, "go", Color(1, 1, 1, 0.8) if not query.strip_edges().is_empty() else Color(1, 1, 1, 0.2))
	var typed := query.strip_edges()
	if _fictional or typed.is_empty() or query.length() < 2:
		_debounce.stop()
		if _remote_call > 0 and engine:
			engine.cancel(_remote_call)
		_remote_call = 0
		_remote = []
		_remote_query = ""
	else:
		if _remote_call > 0 and engine:
			engine.cancel(_remote_call)
		_remote_call = 0
		_debounce.start()
	await _search_local(typed)


func _search_local(typed: String) -> void:
	if typed.length() < 2 or not engine:
		_local = []
		_local_query = typed
		_compose()
		return
	var reply: Dictionary = await engine.request("mapcards.search", {"query": typed})
	if query.strip_edges() != typed or not reply.get("ok", false):
		return
	var result: Dictionary = reply.get("result", {})
	_fictional = bool(result.get("fictional", false))
	_local = result.get("results", [])
	_local_query = typed
	_compose()


func _fetch_remote() -> void:
	if not engine or _fictional:
		return
	var asked := query
	var call := engine.last_request_id() + 1
	_remote_call = call
	var reply: Dictionary = await engine.request("mapcards.places", {"query": asked})
	if _remote_call != call:
		return
	_remote_call = 0
	if not expanded:
		return
	if reply.get("ok", false):
		var result: Dictionary = reply.get("result", {})
		_remote_query = str(result.get("query", asked.strip_edges()))
		_remote = result.get("results", [])
	else:
		_remote_query = asked.strip_edges()
		_remote = []
	selected = -1
	_compose()


func _compose() -> void:
	var typed := query.strip_edges()
	var local: Array = _local if typed.length() >= 2 and _local_query == typed else []
	var named := {}
	for item in local:
		named[str((item as Dictionary).get("primary", "")).to_lower()] = true
	var answered := _remote_query.to_lower()
	var stale := answered != typed.to_lower()
	var usable := not answered.is_empty() and (not stale or typed.to_lower().begins_with(answered))
	var combined: Array = []
	for item in local.slice(0, LOCAL_LIMIT):
		var entry: Dictionary = (item as Dictionary).duplicate()
		entry["stale"] = false
		combined.append(entry)
	if usable:
		for item in _remote:
			var entry: Dictionary = (item as Dictionary).duplicate()
			if named.has(str(entry.get("primary", "")).to_lower()):
				continue
			entry["stale"] = stale
			combined.append(entry)
	suggestions = combined.slice(0, SUGGESTION_LIMIT)
	if selected >= suggestions.size():
		selected = suggestions.size() - 1
	_paint()


func _paint() -> void:
	for child in _list.get_children():
		child.queue_free()
	var show := expanded and not suggestions.is_empty()
	_list_panel.visible = show
	if not show:
		return
	for index in range(suggestions.size()):
		var entry: Dictionary = suggestions[index]
		var row := PlaceRow.new()
		row.index = index
		row.highlight = index == selected
		row.last = index == suggestions.size() - 1
		row.modulate.a = 0.5 if entry.get("stale", false) else 1.0
		row.picked.connect(_pick_index)
		row.hovered.connect(_hover_index)
		var line := HBoxContainer.new()
		line.add_theme_constant_override("separation", 9)
		line.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var glyph := TextureRect.new()
		glyph.texture = _texture(str(entry.get("icon", "pin")), 14, Color(1, 1, 1, 0.45))
		glyph.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
		glyph.custom_minimum_size = Vector2(14, 14)
		glyph.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		glyph.mouse_filter = Control.MOUSE_FILTER_IGNORE
		line.add_child(glyph)
		var words := VBoxContainer.new()
		words.add_theme_constant_override("separation", 0)
		words.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		words.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var primary := UI.label(str(entry.get("primary", "")), 13, Color(1, 1, 1, 0.9))
		primary.clip_text = true
		primary.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		primary.custom_minimum_size.x = 1
		words.add_child(primary)
		if not str(entry.get("region", "")).is_empty():
			var region := UI.label(str(entry["region"]), 12, Color(1, 1, 1, 0.4))
			region.clip_text = true
			region.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
			region.custom_minimum_size.x = 1
			words.add_child(region)
		line.add_child(words)
		if entry.get("local", false):
			var tag := PanelContainer.new()
			tag.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0), Color(1, 1, 1, 0.18), 999, 1, Vector4(5, 1, 5, 1)))
			tag.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			tag.mouse_filter = Control.MOUSE_FILTER_IGNORE
			tag.add_child(UI.label("IN WORLD", 9, Color(1, 1, 1, 0.45), 700, "Arial", 1))
			line.add_child(tag)
		row.add_child(line)
		_list.add_child(row)
	await get_tree().process_frame
	var height := _list.get_combined_minimum_size().y
	_list_panel.offset_top = -height
	_list_panel.offset_bottom = 1.0


func _hover_index(index: int) -> void:
	if selected == index:
		return
	selected = index
	for child in _list.get_children():
		if child is PlaceRow:
			(child as PlaceRow).highlight = (child as PlaceRow).index == selected
			(child as PlaceRow).queue_redraw()


func _pick_index(index: int) -> void:
	if index >= 0 and index < suggestions.size():
		await _fly_to_entry(suggestions[index])


func _on_input_key(event: InputEvent) -> void:
	if not (event is InputEventKey) or not (event as InputEventKey).pressed:
		return
	match (event as InputEventKey).keycode:
		KEY_ESCAPE:
			close()
			_input.accept_event()
		KEY_DOWN:
			selected = min(selected + 1, suggestions.size() - 1)
			_paint()
			_input.accept_event()
		KEY_UP:
			selected = max(selected - 1, -1)
			_paint()
			_input.accept_event()
		KEY_ENTER, KEY_KP_ENTER:
			commit()
			_input.accept_event()


func commit() -> void:
	var highlighted: Dictionary = suggestions[selected] if selected >= 0 and selected < suggestions.size() else {}
	var chosen := highlighted
	if chosen.is_empty() and not suggestions.is_empty() and not (suggestions[0] as Dictionary).get("stale", false):
		chosen = suggestions[0]
	if not chosen.is_empty():
		await _fly_to_entry(chosen)
	elif not query.strip_edges().is_empty():
		await _fly_to_query(query.strip_edges())


func _fly_to_entry(entry: Dictionary) -> void:
	var lng: Variant = entry.get("lng")
	var lat: Variant = entry.get("lat")
	var placed := (typeof(lng) == TYPE_FLOAT or typeof(lng) == TYPE_INT) and (typeof(lat) == TYPE_FLOAT or typeof(lat) == TYPE_INT)
	if not placed:
		var lookup := str(entry.get("lookup", ""))
		await _fly_to_query(lookup if not lookup.is_empty() else str(entry.get("primary", "")))
		return
	var bounds: Variant = entry.get("bounds")
	if typeof(bounds) == TYPE_ARRAY and (bounds as Array).size() == 4:
		var box: Array = bounds
		fit_bounds.emit(float(box[0]), float(box[1]), float(box[2]), float(box[3]))
	else:
		fly_to.emit(float(lng), float(lat), float(entry.get("zoom", 7)))
	var payload: Variant = entry.get("payload")
	if typeof(payload) == TYPE_DICTIONARY:
		var data: Dictionary = payload
		if str(data.get("source", "")) == "unit":
			focus_unit.emit(data)
		else:
			focus_feature.emit(data)
	close()


func _fly_to_query(place: String) -> void:
	status = "loading"
	_remote = []
	_remote_query = ""
	_spinner.visible = true
	_toggle.icon = null
	_compose()
	var reply: Dictionary = await engine.request("mapcards.places", {"query": place}) if engine else {"ok": false}
	_spinner.visible = false
	var results: Array = (reply.get("result", {}) as Dictionary).get("results", []) if reply.get("ok", false) else []
	if results.is_empty():
		status = "error"
		_input.placeholder_text = "Place not found..."
		_input.add_theme_color_override("font_color", Color("#f87171"))
		_input.add_theme_color_override("font_placeholder_color", Color("#f87171"))
		_set_glyph(_toggle, "close", _toggle_color())
		_compose()
		return
	status = ""
	_input.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.45))
	_set_glyph(_toggle, "close", _toggle_color())
	await _fly_to_entry(results[0])


class PlaceRow extends PanelContainer:
	signal picked(index: int)
	signal hovered(index: int)
	var index := 0
	var highlight := false
	var last := false

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_STOP
		mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 0, Vector4(12, 7, 12, 7)))
		mouse_entered.connect(func() -> void: hovered.emit(index))

	func _draw() -> void:
		if highlight:
			draw_rect(Rect2(Vector2.ZERO, size), Color(1, 1, 1, 0.08))
		if not last:
			draw_rect(Rect2(0, size.y - 1, size.x, 1), Color(1, 1, 1, 0.05))

	func _gui_input(event: InputEvent) -> void:
		if event is InputEventMouseButton and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT and (event as InputEventMouseButton).pressed:
			accept_event()
			picked.emit(index)


class PlaceSpinner extends Control:
	var angle := 0.0

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func _process(delta: float) -> void:
		if visible:
			angle = fposmod(angle + delta * TAU / 0.8, TAU)
			queue_redraw()

	func _draw() -> void:
		var centre := size * 0.5
		var radius: float = min(size.x, size.y) * 0.5 - 1.0
		draw_arc(centre, radius, 0, TAU, 32, Color(1, 1, 1, 0.2), 2.0, true)
		draw_arc(centre, radius, angle, angle + PI * 0.5, 16, Color(1, 1, 1, 0.8), 2.0, true)
