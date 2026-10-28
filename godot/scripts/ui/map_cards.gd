class_name MapCards
extends Control

signal open_chat(country: String, draft: String)
signal open_country(name: String)
signal open_stats(name: String)
signal region_opened(index: int)
signal flag_changed(polity_key: String)

const Country := preload("res://scripts/ui/country_panel.gd")
const CARD_TINT := Color(24 / 255.0, 24 / 255.0, 27 / 255.0, 0.95)
const PANEL_TINT := Color(24 / 255.0, 24 / 255.0, 27 / 255.0, 0.97)
const PICK_RADIUS := 12.0
const EVENT_STEP := 30
const SOVEREIGN_PILLS := 80
const OTHER_PILLS := 40
const FILTERS := [["all", "All"], ["major", "Major"], ["minor", "Minor"]]
const ROUNDED_TOP := """
shader_type canvas_item;
uniform float radius = 12.0;
uniform vec2 rect_size = vec2(238.0, 96.0);
uniform float fade = 1.0;
varying vec2 local;
void vertex() {
	local = VERTEX;
}
void fragment() {
	vec2 p = local;
	vec4 color = texture(TEXTURE, UV) * COLOR;
	float alpha = 1.0;
	if (p.y < radius) {
		if (p.x < radius) alpha = clamp(radius - length(p - vec2(radius)) + 0.5, 0.0, 1.0);
		else if (p.x > rect_size.x - radius) alpha = clamp(radius - length(p - vec2(rect_size.x - radius, radius)) + 0.5, 0.0, 1.0);
	}
	COLOR = vec4(color.rgb, color.a * alpha * fade);
}
"""

var engine: EngineLink
var map_view: MapView
var context: Dictionary = {}
var _floating: Control
var _floating_kind := ""
var _floating_anchor := Vector2.ZERO
var _floating_width := 238.0
var _floating_lift := 10.0
var _floating_key := ""
var _floating_rise := 0.0
var _region: Dictionary = {}
var _region_index := -1
var _region_info_open := false
var _unit: Dictionary = {}
var _feature: Dictionary = {}
var _unit_request := ""
var _unit_state := "idle"
var _unit_error := ""
var _disbanding := false
var _info_panel: GlassPanel
var _info: Dictionary = {}
var _info_country: Dictionary = {}
var _info_search := ""
var _info_filter := 0
var _info_limit := EVENT_STEP
var _info_expanded: Dictionary = {}
var _report: Variant = null
var _report_key := ""
var _pickables: Dictionary = {"units": [], "markers": []}
var _cities: Array = []
var _sequence := 0
var _shader: Shader
var _info_body: VBoxContainer
var _info_footer: HFlowContainer
var _info_title: Label
var _info_flag: TextureRect
var _info_header: MarginContainer
var _info_margin: MarginContainer
var _info_footer_margin: MarginContainer
var _phone: ListenPhone
var _flag_picker: FlagPicker


func _init() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func setup(link: EngineLink, setup_context: Dictionary = {}) -> void:
	engine = link
	context = setup_context
	var view: Variant = setup_context.get("map_view")
	if view is MapView:
		map_view = view
	await refresh()


func set_cities(rows: Array) -> void:
	_cities = rows


func refresh() -> void:
	if not engine:
		return
	var reply: Dictionary = await engine.request("mapcards.pickables")
	if reply.get("ok", false):
		_pickables = reply.get("result", {})
	if _cities.is_empty():
		var cities: Dictionary = await engine.request("map.cities")
		if cities.get("ok", false):
			_cities = (cities.get("result", {}) as Dictionary).get("cities", [])
	if _floating_kind == "region" and _region_index >= 0:
		await _load_region(_region_index, str(_region.get("regionId", "")), str(_region.get("regionName", "")), "", false)
	elif _floating_kind == "unit":
		await _load_unit(str(_unit.get("id", "")), false)
	elif _floating_kind == "feature":
		await _load_feature(_feature, false)
	if _info_panel and _info_panel.visible:
		await _load_info(_info_country, false)


func dismiss() -> void:
	_close_floating()


func dismiss_all() -> void:
	_close_floating()
	_close_info()


func is_card_open() -> bool:
	return _floating != null


func show_region(region: Variant, region_name := "", owner := "", screen_pos := Vector2(-1, -1)) -> void:
	var index := -1
	var region_id := ""
	if typeof(region) == TYPE_INT or typeof(region) == TYPE_FLOAT:
		index = int(region)
	else:
		region_id = str(region)
	var key := "region:%s:%d" % [region_id, index]
	if _floating_kind == "region" and _floating_key == key:
		_close_floating()
		return
	if screen_pos.x >= 0.0 and map_view:
		_floating_anchor = _screen_to_world(screen_pos)
	elif map_view and index >= 0:
		_floating_anchor = _screen_to_world(get_viewport().get_mouse_position())
	_floating_key = key
	_region_index = index
	region_opened.emit(index)
	await _load_region(index, region_id, region_name, owner, true)


func show_unit(id: String) -> void:
	var key := "unit:%s" % id
	if _floating_kind == "unit" and _floating_key == key:
		_close_floating()
		return
	_floating_key = key
	_unit_request = ""
	_unit_state = "idle"
	_unit_error = ""
	_disbanding = false
	await _load_unit(id, true)


func focus_unit(payload: Dictionary) -> void:
	var id := str(payload.get("id", ""))
	if id.is_empty():
		return
	_floating_key = "unit:%s" % id
	_unit_request = ""
	_unit_state = "idle"
	_unit_error = ""
	await _load_unit(id, true)


func show_feature(payload: Dictionary) -> void:
	var key := _feature_key(payload)
	if _floating_kind == "feature" and _floating_key == key:
		_close_floating()
		return
	_floating_key = key
	await _load_feature(payload, true)


func focus_feature(payload: Dictionary) -> void:
	_floating_key = _feature_key(payload)
	await _load_feature(payload, true)


func show_country_info(name: String, code := "", polity_key := "") -> void:
	_info_country = {"name": name, "code": code, "polityKey": polity_key}
	_info_search = ""
	_info_filter = 0
	_info_limit = EVENT_STEP
	_info_expanded.clear()
	_report = null
	_report_key = ""
	await _load_info(_info_country, true)


func pick_unit_or_feature(world_pos: Vector2) -> Dictionary:
	if not map_view:
		return {}
	var click := map_view.world_to_screen(world_pos)
	var best: Dictionary = {}
	var nearest := PICK_RADIUS
	for item in _pickables.get("units", []):
		var unit: Dictionary = item
		var distance := map_view.world_to_screen(_project(float(unit.get("lng", 0)), float(unit.get("lat", 0)))).distance_to(click)
		if distance <= nearest:
			nearest = distance
			best = {"kind": "unit", "id": str(unit.get("id", "")), "lng": float(unit.get("lng", 0)), "lat": float(unit.get("lat", 0))}
	if not best.is_empty():
		return best
	nearest = PICK_RADIUS
	for item in _pickables.get("markers", []):
		var marker: Dictionary = item
		var distance := map_view.world_to_screen(_project(float(marker.get("lng", 0)), float(marker.get("lat", 0)))).distance_to(click)
		if distance <= nearest:
			nearest = distance
			best = {"kind": "feature", "payload": {"source": "marker", "id": str(marker.get("id", "")), "name": str(marker.get("name", "")), "kind": str(marker.get("kind", "")), "ownerCode": str(marker.get("ownerCode", "")), "lng": float(marker.get("lng", 0)), "lat": float(marker.get("lat", 0))}}
	if not best.is_empty():
		return best
	var level := map_view.zoom_level()
	nearest = PICK_RADIUS
	for item in _cities:
		var city: Array = item
		if city.size() < 6:
			continue
		var capital := int(city[3]) == 1
		var tier := int(city[5])
		var needed := 2.6 if capital else (4.0 if tier >= 3 else (5.2 if tier == 2 else 6.5))
		if level < needed:
			continue
		var distance := map_view.world_to_screen(_project(float(city[1]), float(city[2]))).distance_to(click)
		if distance <= nearest:
			nearest = distance
			best = {"kind": "feature", "payload": {"source": "city", "name": str(city[0]), "population": int(city[4]), "capital": "primary" if capital else "", "tier": tier, "lng": float(city[1]), "lat": float(city[2])}}
	return best


func handle_screen_click(screen_pos: Vector2) -> bool:
	if not map_view:
		return false
	return await handle_click(_screen_to_world(screen_pos))


func open_pick(pick: Dictionary) -> void:
	match str(pick.get("kind", "")):
		"unit":
			await show_unit(str(pick.get("id", "")))
		"feature":
			await show_feature(pick.get("payload", {}))


func handle_click(world_pos: Vector2) -> bool:
	var pick := pick_unit_or_feature(world_pos)
	if pick.is_empty():
		return false
	if str(pick.get("kind", "")) == "feature":
		var payload: Dictionary = pick.get("payload", {})
		var host := map_view.baker.pick(world_pos) if map_view else -1
		if host >= 0:
			payload["hostRegionName"] = map_view.region_name(host)
			payload["hostRegion"] = host
		pick["payload"] = payload
	await open_pick(pick)
	return true


func _project(lon: float, lat: float) -> Vector2:
	var clamped: float = clamp(lat, -85.0511, 85.0511)
	var x := (lon + 180.0) / 360.0 * MapView.WORLD_WIDTH
	var y := (0.5 - log(tan(PI / 4.0 + deg_to_rad(clamped) / 2.0)) / (2.0 * PI)) * MapView.WORLD_WIDTH
	return Vector2(x, y)


func _screen_to_world(point: Vector2) -> Vector2:
	if not map_view:
		return Vector2.ZERO
	if map_view.has_method("screen_to_world"):
		var placed: Variant = map_view.call("screen_to_world", point)
		if placed is Vector2:
			return placed
	var half := map_view.get_viewport_rect().size * 0.5
	return map_view.camera.position + (point - half) / map_view.camera.zoom.x


func _feature_key(payload: Dictionary) -> String:
	var id := str(payload.get("id", ""))
	if not id.is_empty():
		return "feature:%s:%s" % [str(payload.get("source", "")), id]
	return "feature:%s:%s:%.2f:%.2f" % [str(payload.get("source", "")), str(payload.get("name", "")), float(payload.get("lng", 0)), float(payload.get("lat", 0))]


func _process(_delta: float) -> void:
	if not _floating or not map_view:
		return
	var screen := map_view.world_to_screen(_floating_anchor)
	var view := get_viewport_rect().size
	var shown := screen.x >= 0.0 and screen.y >= 0.0 and screen.x <= view.x and screen.y <= view.y
	_floating.visible = shown
	if shown:
		var height := _floating.get_combined_minimum_size().y
		if not is_equal_approx(_floating.size.y, height):
			_floating.size = Vector2(_floating.size.x, height)
		_floating.position = Vector2(round(screen.x - max(_floating_width, _floating.size.x) * 0.5), round(screen.y - _floating_lift - height + _floating_rise))


func _close_floating() -> void:
	if _floating:
		var leaving := _floating
		var tween := leaving.create_tween().set_parallel(true).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_IN)
		tween.tween_property(leaving, "modulate:a", 0.0, 0.18)
		tween.tween_property(leaving, "position:y", leaving.position.y + 10.0, 0.18)
		tween.chain().tween_callback(leaving.queue_free)
	_floating = null
	_floating_kind = ""
	_floating_key = ""
	_region_info_open = false


func _mount_floating(card: Control, kind: String, width: float, lift: float, animate: bool) -> void:
	if _floating:
		_floating.queue_free()
	_floating = card
	_floating_kind = kind
	_floating_width = width
	_floating_lift = lift
	card.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(card)
	card.reset_size()
	if map_view:
		var screen := map_view.world_to_screen(_floating_anchor)
		card.position = Vector2(round(screen.x - width * 0.5), round(screen.y - lift - card.get_combined_minimum_size().y))
	if animate:
		card.modulate.a = 0.0
		_floating_rise = 10.0
		var tween := create_tween().set_parallel(true).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
		tween.tween_property(card, "modulate:a", 1.0, 0.22)
		tween.tween_property(self, "_floating_rise", 0.0, 0.22)
	else:
		_floating_rise = 0.0


func _shader_material(width: float, height: float) -> ShaderMaterial:
	if not _shader:
		_shader = Shader.new()
		_shader.code = ROUNDED_TOP
	var material := ShaderMaterial.new()
	material.shader = _shader
	material.set_shader_parameter("rect_size", Vector2(width, height))
	material.set_shader_parameter("radius", 12.0)
	return material


func _icon_button(glyph: String, title: String, size := 22) -> Button:
	var node := Button.new()
	node.text = glyph
	node.tooltip_text = title
	node.focus_mode = Control.FOCUS_NONE
	node.custom_minimum_size = Vector2(size, size)
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	node.add_theme_font_override("font", UI.font(400))
	node.add_theme_font_size_override("font_size", 11)
	node.add_theme_color_override("font_color", Color(1, 1, 1, 0.4))
	node.add_theme_color_override("font_hover_color", Color(1, 1, 1, 0.8))
	node.add_theme_color_override("font_pressed_color", Color(1, 1, 1, 0.8))
	node.add_theme_color_override("font_disabled_color", Color(1, 1, 1, 0.25))
	var normal := UI.box(Color(0, 0, 0, 0), Color(1, 1, 1, 0.15), 6, 1)
	var hover := UI.box(Color(1, 1, 1, 0.1), Color(1, 1, 1, 0.15), 6, 1)
	for state in [["normal", normal], ["focus", normal], ["disabled", normal], ["hover", hover], ["pressed", hover], ["hover_pressed", hover]]:
		node.add_theme_stylebox_override(state[0], state[1])
	return node


func _copy_button(title: String, value: String) -> Button:
	var node := _icon_button("⧉", title)
	node.pressed.connect(func() -> void:
		DisplayServer.clipboard_set(value)
		var copied := DisplayServer.clipboard_get() == value
		node.text = "✓" if copied else "✕"
		node.tooltip_text = "Copied" if copied else "Copy failed"
		await get_tree().create_timer(1.5).timeout
		if is_instance_valid(node):
			node.text = "⧉"
			node.tooltip_text = title)
	return node


func _close_button(title: String, size := 22) -> Button:
	var node := _icon_button("✕", title, size)
	node.add_theme_color_override("font_color", Color(1, 1, 1, 0.5))
	node.add_theme_color_override("font_hover_color", Color(1, 1, 1, 0.9))
	var normal := UI.box(Color(24 / 255.0, 24 / 255.0, 27 / 255.0, 0.7), Color(1, 1, 1, 0.12), 6, 1)
	var hover := UI.box(Color(24 / 255.0, 24 / 255.0, 27 / 255.0, 0.9), Color(1, 1, 1, 0.12), 6, 1)
	for state in [["normal", normal], ["focus", normal], ["hover", hover], ["pressed", hover], ["hover_pressed", hover]]:
		node.add_theme_stylebox_override(state[0], state[1])
	return node


func _grid_row(grid: GridContainer, label: String, value: String, ink := Color(1, 1, 1, 0.84), weight := 400) -> void:
	var name := UI.label(label, 11, Color(1, 1, 1, 0.42))
	name.custom_minimum_size.x = 76
	name.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	grid.add_child(name)
	grid.add_child(Country.text(value, 11, ink, weight))


func _info_grid() -> GridContainer:
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 7)
	grid.add_theme_constant_override("v_separation", 3)
	grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	grid.mouse_filter = Control.MOUSE_FILTER_PASS
	return grid


func _divider(top := 7.0, bottom := 7.0, alpha := 0.1) -> Control:
	var holder := Country.column(0)
	holder.add_child(Country.gap(top))
	var rule := ColorRect.new()
	rule.color = Color(1, 1, 1, alpha)
	rule.custom_minimum_size.y = 1
	rule.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.add_child(rule)
	holder.add_child(Country.gap(bottom))
	return holder


func _subordination(holder: VBoxContainer, sub: Dictionary, sizes := [12, 11, 10]) -> void:
	var box := PanelContainer.new()
	var style := UI.box(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.13), 9, 1, Vector4(10, 7, 9, 7))
	style.border_width_left = 2
	style.border_color = Color(1, 1, 1, 0.13)
	box.add_theme_stylebox_override("panel", style)
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var stack := Country.column(3)
	stack.add_child(Country.text(str(sub.get("headline", "")), sizes[0], Color(1, 1, 1, 0.96), 800))
	stack.add_child(Country.text(str(sub.get("meaning", "")), sizes[1], Color(1, 1, 1, 0.82)))
	var facts: Array = sub.get("facts", [])
	if not facts.is_empty():
		var chips := Country.flow(3, 3)
		for fact in facts:
			chips.add_child(Country.pill(str(fact), Color(0, 0, 0, 0.25), Color(1, 1, 1, 0.1), Color(1, 1, 1, 0.7), sizes[2], 400))
		stack.add_child(chips)
	if not str(sub.get("provenance", "")).is_empty():
		stack.add_child(Country.text(str(sub["provenance"]), sizes[2], Color(1, 1, 1, 0.45)))
	box.add_child(stack)
	holder.add_child(box)


func _load_region(index: int, region_id: String, region_name: String, owner: String, animate: bool) -> void:
	_sequence += 1
	var sequence := _sequence
	var reply: Dictionary = await engine.request("mapcards.region", {"index": index, "regionId": region_id, "regionName": region_name, "owner": owner})
	if sequence != _sequence or not reply.get("ok", false):
		return
	_region = reply.get("result", {})
	_build_region(animate)


func _build_region(animate: bool) -> void:
	var width := 238.0
	var root := Country.column(0)
	root.custom_minimum_size.x = width
	var card := GlassPanel.new(CARD_TINT, 12.0)
	card.custom_minimum_size.x = width
	var stack := Country.column(0)
	var top := Control.new()
	top.custom_minimum_size = Vector2(width, 96)
	top.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var blank := ColorRect.new()
	blank.color = Color(41 / 255.0, 41 / 255.0, 45 / 255.0, 0.6)
	blank.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	blank.material = _shader_material(width, 96)
	blank.mouse_filter = Control.MOUSE_FILTER_IGNORE
	top.add_child(blank)
	var flag := Country.texture_for(str(_region.get("flag", "")), 96)
	if flag:
		var picture := TextureRect.new()
		picture.texture = flag
		picture.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		picture.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
		picture.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		picture.material = _shader_material(width, 96)
		(picture.material as ShaderMaterial).set_shader_parameter("fade", 0.9)
		picture.mouse_filter = Control.MOUSE_FILTER_IGNORE
		top.add_child(picture)
	else:
		var none := UI.label(str(_region.get("flagText", "No flag available")), 11, Color(1, 1, 1, 0.2), 400, "Arial", 1)
		none.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		none.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		none.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		top.add_child(none)
	var shut := _close_button("Close region card")
	shut.position = Vector2(width - 29, 7)
	shut.pressed.connect(_close_floating)
	top.add_child(shut)
	stack.add_child(top)
	var margin := MarginContainer.new()
	for side in [["margin_left", 10], ["margin_right", 10], ["margin_top", 8], ["margin_bottom", 10]]:
		margin.add_theme_constant_override(side[0], side[1])
	margin.mouse_filter = Control.MOUSE_FILTER_PASS
	var inner := Country.column(0)
	var unclaimed: bool = _region.get("isUnclaimed", false)
	var name_row := Country.row(6)
	name_row.custom_minimum_size.y = 26
	var dot := Country.StatDot.new()
	dot.color = Color("#3b82f6")
	dot.custom_minimum_size = Vector2(8, 8)
	dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	name_row.add_child(dot)
	var country_name := str(_region.get("displayCountry", ""))
	var title := Country.text(country_name, 13, Color(1, 1, 1, 0.95), 600)
	title.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	name_row.add_child(title)
	var buttons := Country.row(4)
	buttons.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	if not unclaimed:
		var chat := _icon_button("💬", "Open diplomatic chat")
		chat.pressed.connect(func() -> void:
			open_chat.emit(str(_region.get("chatTarget", country_name)), "")
			_close_floating())
		buttons.add_child(chat)
	buttons.add_child(_copy_button("Copy name", country_name))
	if not unclaimed:
		var intel := _icon_button("ⓘ", "Country intel (AI)")
		intel.pressed.connect(_open_country_from_region)
		buttons.add_child(intel)
	name_row.add_child(buttons)
	inner.add_child(name_row)
	var subordination: Variant = _region.get("subordination")
	if typeof(subordination) == TYPE_DICTIONARY:
		inner.add_child(Country.gap(7))
		_subordination(inner, subordination)
	var puppets: Variant = _region.get("puppets")
	if typeof(puppets) == TYPE_DICTIONARY:
		inner.add_child(Country.gap(7))
		var line := RichTextLabel.new()
		line.add_theme_font_override("normal_font", UI.font(400))
		line.bbcode_enabled = true
		line.fit_content = true
		line.scroll_active = false
		line.mouse_filter = Control.MOUSE_FILTER_IGNORE
		line.add_theme_font_size_override("normal_font_size", 11)
		line.add_theme_color_override("default_color", Color(1, 1, 1, 0.8))
		line.text = "[color=#ffffff73]%s[/color]%s" % [str((puppets as Dictionary).get("label", "")), str((puppets as Dictionary).get("text", "")).replace("[", "[lb]")]
		inner.add_child(line)
	inner.add_child(_divider())
	var region_row := Country.row(6)
	region_row.custom_minimum_size.y = 22
	var region_name := str(_region.get("regionName", ""))
	var region_label := Country.text(region_name, 12, Color(1, 1, 1, 0.65))
	region_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	region_row.add_child(region_label)
	var region_buttons := Country.row(4)
	region_buttons.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	region_buttons.add_child(_copy_button("Copy region name", region_name))
	var region_info := _icon_button("ⓘ", "Region info")
	if _region_info_open:
		region_info.add_theme_color_override("font_color", Color(1, 1, 1, 0.8))
	region_info.pressed.connect(func() -> void:
		_region_info_open = not _region_info_open
		_build_region(false))
	region_buttons.add_child(region_info)
	region_row.add_child(region_buttons)
	inner.add_child(region_row)
	if _region_info_open:
		inner.add_child(_divider(7, 5, 0.08))
		var info: Variant = _region.get("info")
		if typeof(info) == TYPE_DICTIONARY:
			var grid := _info_grid()
			var facts: Dictionary = info
			if not str(facts.get("cities", "")).is_empty():
				_grid_row(grid, "Cities", str(facts["cities"]))
			var neighbours: Array = facts.get("neighbours", [])
			if not neighbours.is_empty():
				var name := UI.label("Neighbours", 11, Color(1, 1, 1, 0.42))
				name.custom_minimum_size.x = 76
				name.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
				grid.add_child(name)
				var list := Country.column(1)
				for item in neighbours:
					var entry: Dictionary = item
					var neighbour := RichTextLabel.new()
					neighbour.add_theme_font_override("normal_font", UI.font(400))
					neighbour.bbcode_enabled = true
					neighbour.fit_content = true
					neighbour.scroll_active = false
					neighbour.mouse_filter = Control.MOUSE_FILTER_IGNORE
					neighbour.size_flags_horizontal = Control.SIZE_EXPAND_FILL
					neighbour.add_theme_font_size_override("normal_font_size", 11)
					neighbour.add_theme_color_override("default_color", Color(1, 1, 1, 0.84))
					neighbour.text = "[color=#ffffff8c]%s[/color] · %s" % [str(entry.get("owner", "")).replace("[", "[lb]"), str(entry.get("regions", "")).replace("[", "[lb]")]
					list.add_child(neighbour)
				grid.add_child(list)
			inner.add_child(grid)
		else:
			inner.add_child(Country.text(str(_region.get("infoEmpty", "")), 11, Color(1, 1, 1, 0.5)))
	var control: Variant = _region.get("control")
	if typeof(control) == TYPE_DICTIONARY:
		var status: Dictionary = control
		inner.add_child(_divider(7, 5, 0.08))
		var grid := _info_grid()
		if not unclaimed:
			_grid_row(grid, "Sovereign", str(status.get("sovereign", "")))
			_grid_row(grid, "Controlled by", str(status.get("controller", "")))
		_grid_row(grid, "Status", str(status.get("status", "")), Color("#fbbf24") if status.get("occupied", false) else Color(1, 1, 1, 0.84), 700)
		if not str(status.get("claimants", "")).is_empty():
			_grid_row(grid, "Claimants", str(status["claimants"]))
		inner.add_child(grid)
	var group: Variant = _region.get("group")
	if typeof(group) == TYPE_DICTIONARY:
		var held: Dictionary = group
		inner.add_child(_divider(7, 5, 0.08))
		var line := Country.row(6)
		var swatch := Country.StatDot.new()
		swatch.square = true
		swatch.color = Country.tone(str(held.get("color", "")))
		swatch.custom_minimum_size = Vector2(10, 10)
		swatch.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		line.add_child(swatch)
		line.add_child(UI.label("Group control", 11, Color(1, 1, 1, 0.42)))
		line.add_child(Country.text(str(held.get("name", "")), 11, Country.tone(str(held.get("color", ""))), 700))
		inner.add_child(line)
		if not str(held.get("description", "")).is_empty():
			inner.add_child(Country.gap(3))
			inner.add_child(Country.text(str(held["description"]), 11, Color(1, 1, 1, 0.72)))
	if _region.get("listenIn", false):
		inner.add_child(Country.gap(8))
		var listen := Country.small_button("", Color(1, 1, 1, 0.07), Color(1, 1, 1, 0.14), Color(1, 1, 1, 0.88), 12, 600, Vector4(8, 6, 8, 6), 8)
		listen.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		listen.custom_minimum_size.y = 28
		var listen_row := HBoxContainer.new()
		listen_row.alignment = BoxContainer.ALIGNMENT_CENTER
		listen_row.add_theme_constant_override("separation", 6)
		listen_row.mouse_filter = Control.MOUSE_FILTER_IGNORE
		listen_row.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		var phone_glyph := TextureRect.new()
		phone_glyph.texture = _phone_icon()
		phone_glyph.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
		phone_glyph.custom_minimum_size = Vector2(12, 12)
		phone_glyph.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		phone_glyph.mouse_filter = Control.MOUSE_FILTER_IGNORE
		listen_row.add_child(phone_glyph)
		var listen_words := UI.label("Listen in", 12, Color(1, 1, 1, 0.88), 600)
		listen_words.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		listen_row.add_child(listen_words)
		listen.add_child(listen_row)
		var identity: Dictionary = _region.get("identity", {})
		listen.pressed.connect(open_listen_in.bind({
			"regionId": str(_region.get("regionId", "")),
			"regionName": str(_region.get("regionName", "")),
			"polity": "" if unclaimed else country_name,
			"polityKey": "" if unclaimed else str(identity.get("polityKey", "")),
		}))
		inner.add_child(listen)
	margin.add_child(inner)
	stack.add_child(margin)
	card.add_child(stack)
	root.add_child(card)
	var pointer := CardPointer.new()
	pointer.custom_minimum_size = Vector2(width, 9)
	root.add_child(pointer)
	_mount_floating(root, "region", width, 10.0, animate)


func _open_country_from_region() -> void:
	var identity: Dictionary = _region.get("identity", {})
	var name := str(identity.get("name", _region.get("displayCountry", "")))
	_close_floating()
	await show_country_info(name, str(identity.get("code", "")), str(identity.get("polityKey", "")))


func _load_unit(id: String, animate: bool) -> void:
	_sequence += 1
	var sequence := _sequence
	var reply: Dictionary = await engine.request("mapcards.unit", {"id": id})
	if sequence != _sequence or not reply.get("ok", false):
		return
	var result: Dictionary = reply.get("result", {})
	if result.get("missing", false):
		_close_floating()
		return
	_unit = result
	_floating_anchor = _project(float(_unit.get("lng", 0)), float(_unit.get("lat", 0)))
	_build_unit(animate)


func _build_unit(animate: bool) -> void:
	var width := 240.0
	var card := GlassPanel.new(Color(24 / 255.0, 24 / 255.0, 27 / 255.0, 0.96), 12.0)
	card.custom_minimum_size.x = width
	var stack := Country.column(0)
	var head := MarginContainer.new()
	for side in [["margin_left", 12], ["margin_right", 12], ["margin_top", 10], ["margin_bottom", 8]]:
		head.add_theme_constant_override(side[0], side[1])
	var line := Country.row(9)
	var glyph := UI.label(str(_unit.get("glyph", "🛡")), 24, UI.WHITE)
	glyph.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	line.add_child(glyph)
	var titles := Country.column(1)
	titles.add_child(Country.text(str(_unit.get("name", "")), 13, UI.WHITE, 700))
	titles.add_child(Country.text(str(_unit.get("subtitle", "")), 11, Color(1, 1, 1, 0.6)))
	line.add_child(titles)
	var shut := _close_button("Close unit card", 20)
	shut.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	shut.pressed.connect(_close_floating)
	line.add_child(shut)
	head.add_child(line)
	stack.add_child(head)
	var margin := MarginContainer.new()
	for side in [["margin_left", 12], ["margin_right", 12], ["margin_top", 0], ["margin_bottom", 10]]:
		margin.add_theme_constant_override(side[0], side[1])
	var inner := Country.column(0)
	if _unit.get("covert", false):
		var covert := Country.pill("Unconfirmed contact", Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.25), Color("#f4f4f5"), 9, 700, Vector4(6, 2, 6, 2))
		covert.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		covert.mouse_filter = Control.MOUSE_FILTER_STOP
		covert.tooltip_text = "No confirmed line of support — assessed to have been operating in the area before it was detected."
		var corner := covert.get_theme_stylebox("panel") as StyleBoxFlat
		if corner:
			corner.set_corner_radius_all(5)
		inner.add_child(covert)
		inner.add_child(Country.gap(7))
	if not str(_unit.get("note", "")).is_empty():
		inner.add_child(Country.text(str(_unit["note"]), 12, Color(1, 1, 1, 0.85)))
		inner.add_child(Country.gap(3))
	if not str(_unit.get("composition", "")).is_empty():
		inner.add_child(Country.text(str(_unit["composition"]), 11, Color(1, 1, 1, 0.55)))
		inner.add_child(Country.gap(7))
	var strength := Country.row(4)
	strength.add_child(Country.text("Strength", 11, Color(1, 1, 1, 0.7)))
	strength.add_child(UI.label(str(_unit.get("strength", "")), 11, UI.WHITE, 600))
	inner.add_child(strength)
	inner.add_child(Country.gap(3))
	var bar := Country.StatBar.new()
	bar.value = float(_unit.get("strengthBar", 0))
	bar.color = Country.tone(str(_unit.get("strengthColor", "")))
	bar.track = Color(1, 1, 1, 0.12)
	bar.custom_minimum_size.y = 6
	bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	inner.add_child(bar)
	for item in _unit.get("rows", []):
		var entry: Array = item
		inner.add_child(Country.gap(4))
		var info := Country.row(10)
		var label := UI.label(str(entry[0]), 11, Color(1, 1, 1, 0.6))
		label.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
		info.add_child(label)
		var value := Country.text(str(entry[1]), 11, Color(1, 1, 1, 0.9))
		value.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		info.add_child(value)
		inner.add_child(info)
	if _unit.get("isOwn", false):
		inner.add_child(Country.gap(10))
		var request := TextEdit.new()
		request.text = _unit_request
		request.placeholder_text = "Request orders, e.g. move to the Med"
		request.custom_minimum_size.y = 48
		request.get_v_scroll_bar().modulate.a = 0.0
		request.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
		request.add_theme_font_size_override("font_size", 11)
		request.add_theme_stylebox_override("normal", UI.box(Color(0, 0, 0, 0.3), Color(1, 1, 1, 0.15), 6, 1, Vector4(6, 5, 6, 5)))
		request.add_theme_stylebox_override("focus", UI.box(Color(0, 0, 0, 0.35), Color(1, 1, 1, 0.25), 6, 1, Vector4(6, 5, 6, 5)))
		inner.add_child(request)
		inner.add_child(Country.gap(6))
		var actions := Country.row(5)
		var label := "✓ Queued" if _unit_state == "queued" else ("Queueing…" if _unit_state == "sending" else "Request orders")
		var ask := Country.small_button(label, Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.3), Color(1, 1, 1, 0.15), Color(1, 1, 1, 0.9), 11, 600, Vector4(4, 5, 4, 5), 6)
		ask.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		ask.disabled = _unit_state != "idle" or _unit_request.strip_edges().is_empty()
		ask.pressed.connect(_send_orders)
		actions.add_child(ask)
		var running: bool = _unit.get("turnRunning", false)
		var stand := Country.small_button("Disband", Color(1, 1, 1, 0.12), Color(1, 1, 1, 0.15), Color(1, 1, 1, 0.9), 11, 600, Vector4(4, 5, 4, 5), 6)
		stand.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		stand.disabled = running or _disbanding
		stand.pressed.connect(_disband)
		actions.add_child(stand)
		request.text_changed.connect(func() -> void:
			_unit_request = request.text
			if _unit_state == "queued":
				_unit_state = "idle"
				ask.text = "Request orders"
			if not _unit_error.is_empty():
				_unit_error = ""
			ask.disabled = _unit_state != "idle" or _unit_request.strip_edges().is_empty())
		inner.add_child(actions)
		if running:
			inner.add_child(Country.gap(5))
			var note := Country.text(str(_unit.get("turnRunningNote", "")), 10, Color(1, 1, 1, 0.45))
			note.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			inner.add_child(note)
		if not _unit_error.is_empty():
			inner.add_child(Country.gap(5))
			var problem := Country.text(_unit_error, 10, Color("#fca5a5"))
			problem.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			inner.add_child(problem)
		if _unit_state == "queued":
			inner.add_child(Country.gap(5))
			var queued := Country.text("Added to your actions for this round.", 10, Color(1, 1, 1, 0.45))
			queued.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			inner.add_child(queued)
	margin.add_child(inner)
	stack.add_child(margin)
	card.add_child(stack)
	_mount_floating(card, "unit", width, 14.0, animate)


func _send_orders() -> void:
	if _unit_request.strip_edges().is_empty() or _unit_state == "sending":
		return
	_unit_error = ""
	_unit_state = "sending"
	_build_unit(false)
	var reply: Dictionary = await engine.request("mapcards.unit.orders", {"id": str(_unit.get("id", "")), "text": _unit_request})
	var result: Dictionary = reply.get("result", {}) if reply.get("ok", false) else {"ok": false, "error": "The order could not be saved; the next time skip would not see it. Try again."}
	if result.get("ok", false):
		_unit_state = "queued"
		_unit_request = ""
	else:
		_unit_state = "idle"
		_unit_error = str(result.get("error", ""))
	if _floating_kind == "unit":
		_build_unit(false)


func _disband() -> void:
	if _disbanding or _unit.get("turnRunning", false):
		return
	_unit_error = ""
	_disbanding = true
	_build_unit(false)
	var reply: Dictionary = await engine.request("mapcards.unit.disband", {"id": str(_unit.get("id", ""))})
	_disbanding = false
	var result: Dictionary = reply.get("result", {}) if reply.get("ok", false) else {"ok": false, "error": "The order could not be saved; the next time skip would not see it. Try again."}
	if result.get("ok", false):
		_close_floating()
		await refresh()
		return
	_unit_error = str(result.get("error", ""))
	if _floating_kind == "unit":
		_build_unit(false)


func _load_feature(payload: Dictionary, animate: bool) -> void:
	_sequence += 1
	var sequence := _sequence
	var reply: Dictionary = await engine.request("mapcards.feature", {"payload": payload})
	if sequence != _sequence or not reply.get("ok", false):
		return
	var result: Dictionary = reply.get("result", {})
	if result.get("missing", false):
		_close_floating()
		return
	_feature = payload.duplicate()
	for key in result:
		_feature[key] = result[key]
	_floating_anchor = _project(float(_feature.get("lng", 0)), float(_feature.get("lat", 0)))
	_build_feature(animate)


func _build_feature(animate: bool) -> void:
	var width := 220.0
	var card := GlassPanel.new(Color(24 / 255.0, 24 / 255.0, 27 / 255.0, 0.96), 12.0)
	card.custom_minimum_size.x = width
	var stack := Country.column(0)
	var head := MarginContainer.new()
	for side in [["margin_left", 12], ["margin_right", 12], ["margin_top", 10], ["margin_bottom", 8]]:
		head.add_theme_constant_override(side[0], side[1])
	var line := Country.row(9)
	var glyph := UI.label(str(_feature.get("glyph", "📍")), 24, UI.WHITE)
	glyph.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	line.add_child(glyph)
	var titles := Country.column(1)
	titles.add_child(Country.text(str(_feature.get("name", "")), 13, UI.WHITE, 700))
	var kinds := Country.flow(5, 3)
	var kind_label := UI.label(str(_feature.get("kind", "")), 11, Color(1, 1, 1, 0.6))
	kinds.add_child(kind_label)
	var status: Variant = _feature.get("status")
	if typeof(status) == TYPE_DICTIONARY:
		var tint := Country.tone(str((status as Dictionary).get("color", "")))
		kinds.add_child(Country.pill(str((status as Dictionary).get("label", "")), Color(0, 0, 0, 0), Color(tint.r, tint.g, tint.b, 0.33), tint, 9, 800, Vector4(5, 1, 5, 1)))
	titles.add_child(kinds)
	line.add_child(titles)
	var shut := _close_button("Close feature card", 20)
	shut.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	shut.pressed.connect(_close_floating)
	line.add_child(shut)
	head.add_child(line)
	stack.add_child(head)
	var margin := MarginContainer.new()
	for side in [["margin_left", 12], ["margin_right", 12], ["margin_top", 0], ["margin_bottom", 10]]:
		margin.add_theme_constant_override(side[0], side[1])
	var inner := Country.column(3)
	for item in _feature.get("rows", []):
		var entry: Array = item
		inner.add_child(_detail_row(str(entry[0]), str(entry[1])))
	var host_name := str(_feature.get("hostRegionName", ""))
	if not host_name.is_empty():
		var host_row := Country.row(10)
		var label := UI.label("Region", 11, Color(1, 1, 1, 0.6))
		host_row.add_child(label)
		host_row.add_child(UI.spacer())
		if _feature.has("hostRegion"):
			var open_host := LinkButton.new()
			open_host.text = host_name
			open_host.underline = LinkButton.UNDERLINE_MODE_ALWAYS
			open_host.focus_mode = Control.FOCUS_NONE
			open_host.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
			open_host.add_theme_font_override("font", UI.font(400))
			open_host.add_theme_font_size_override("font_size", 11)
			for state in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
				open_host.add_theme_color_override(state, UI.ACCENT)
			open_host.tooltip_text = "Open the region's card"
			open_host.size_flags_horizontal = Control.SIZE_SHRINK_END
			open_host.pressed.connect(func() -> void:
				var host := int(_feature.get("hostRegion", -1))
				_close_floating()
				var screen := map_view.world_to_screen(_floating_anchor) if map_view else Vector2(-1, -1)
				show_region(host, host_name, map_view.region_owner(host) if map_view else "", screen))
			host_row.add_child(open_host)
		else:
			host_row.add_child(UI.label(host_name, 11, Color(1, 1, 1, 0.9)))
		inner.add_child(host_row)
	else:
		inner.add_child(_detail_row("Location", str(_feature.get("location", ""))))
	if not str(_feature.get("note", "")).is_empty():
		inner.add_child(Country.gap(5))
		inner.add_child(Country.text(str(_feature["note"]), 11, Color(1, 1, 1, 0.75)))
	if not str(_feature.get("approximate", "")).is_empty():
		inner.add_child(Country.gap(5))
		inner.add_child(Country.text(str(_feature["approximate"]), 11, Color(1, 210 / 255.0, 120 / 255.0, 0.9)))
	if _feature.get("settleable", false):
		inner.add_child(Country.gap(5))
		var settle := Country.row(6)
		var accept := Country.small_button("Accept", Color(1, 1, 1, 0.08), Color(1, 1, 1, 0.18), UI.WHITE, 11, 700, Vector4(8, 5, 8, 5), 6)
		accept.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		accept.pressed.connect(_accept_structure)
		settle.add_child(accept)
		var move := Country.small_button("Move", Color(1, 1, 1, 0.08), Color(1, 1, 1, 0.18), UI.WHITE, 11, 700, Vector4(8, 5, 8, 5), 6)
		move.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var structure_id := str(_feature.get("id", ""))
		move.pressed.connect(func() -> void:
			var handler: Variant = context.get("move_structure")
			if handler is Callable and (handler as Callable).is_valid():
				(handler as Callable).call(structure_id))
		settle.add_child(move)
		inner.add_child(settle)
	margin.add_child(inner)
	stack.add_child(margin)
	card.add_child(stack)
	_mount_floating(card, "feature", width, 14.0, animate)
	var over := card.get_combined_minimum_size().x - width
	if over > 0.5:
		var natural := kind_label.get_combined_minimum_size().x
		kind_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		kind_label.custom_minimum_size.x = max(24.0, natural - over)
		card.reset_size()
		card.size.x = width


func _detail_row(label: String, value: String) -> Control:
	var line := Country.row(10)
	var name := UI.label(label, 11, Color(1, 1, 1, 0.6))
	name.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	line.add_child(name)
	var shown := Country.text(value, 11, Color(1, 1, 1, 0.9))
	shown.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	line.add_child(shown)
	return line


func _accept_structure() -> void:
	await engine.request("mapcards.feature.accept", {"id": str(_feature.get("id", ""))})
	await _load_feature(_feature, false)


func _close_info() -> void:
	if _info_panel:
		_info_panel.visible = false
	_info_country = {}


func _load_info(country: Dictionary, reset: bool) -> void:
	if country.is_empty():
		return
	if reset or not _info_panel:
		_build_info_shell()
		_render_info(true)
	var reply: Dictionary = await engine.request("mapcards.countryinfo", country)
	if country != _info_country or not reply.get("ok", false):
		return
	_info = reply.get("result", {})
	if _report == null and typeof(_info.get("report")) == TYPE_STRING:
		_report = _info["report"]
		_report_key = str(_info.get("reportKey", ""))
	if _report == null and _info.get("reportPending", false):
		_run_report()
		return
	_render_info(false)


func _build_info_shell() -> void:
	if _info_panel:
		_info_panel.visible = true
		var host := _info_panel.get_parent()
		if host:
			host.move_child(_info_panel, -1)
		return
	_info_panel = GlassPanel.new(PANEL_TINT, 16.0)
	_info_panel.anchor_left = 1.0
	_info_panel.anchor_right = 1.0
	_info_panel.anchor_top = 0.0
	_info_panel.anchor_bottom = 0.0
	_info_panel.offset_right = -8.0
	_info_panel.offset_top = 76.0
	_info_panel.offset_bottom = 76.0 + 200.0
	var stack := Country.column(0)
	_info_header = MarginContainer.new()
	var header := _info_header
	for side in [["margin_left", 18], ["margin_right", 18], ["margin_top", 16], ["margin_bottom", 13]]:
		header.add_theme_constant_override(side[0], side[1])
	var line := Country.row(10)
	var flag_button := Button.new()
	flag_button.flat = true
	flag_button.focus_mode = Control.FOCUS_NONE
	flag_button.custom_minimum_size = Vector2(34, 22)
	flag_button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	flag_button.add_theme_stylebox_override("normal", UI.box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.15), 4, 1))
	flag_button.add_theme_stylebox_override("disabled", UI.box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.15), 4, 1))
	flag_button.clip_contents = true
	_info_flag = TextureRect.new()
	_info_flag.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_info_flag.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	_info_flag.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_info_flag.mouse_filter = Control.MOUSE_FILTER_IGNORE
	flag_button.add_child(_info_flag)
	flag_button.pressed.connect(_open_flag_picker)
	flag_button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	line.add_child(flag_button)
	_info_title = Country.clipped("", 18, UI.WHITE, 800)
	_info_title.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	line.add_child(_info_title)
	var flag_text := Country.small_button("Flag", Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.12), Color(1, 1, 1, 0.72), 11, 700, Vector4(7, 5, 7, 5), 7)
	flag_text.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	flag_text.tooltip_text = "Change flag"
	flag_text.pressed.connect(_open_flag_picker)
	line.add_child(flag_text)
	var shut := Country.link("✕", Color(1, 1, 1, 0.6), 18, 400)
	shut.tooltip_text = "Close country panel"
	shut.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	shut.pressed.connect(_close_info)
	line.add_child(shut)
	header.add_child(line)
	stack.add_child(header)
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	var margin := MarginContainer.new()
	_info_margin = margin
	margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for side in [["margin_left", 18], ["margin_right", 18], ["margin_top", 0], ["margin_bottom", 16]]:
		margin.add_theme_constant_override(side[0], side[1])
	_info_body = Country.column(6)
	margin.add_child(_info_body)
	scroll.add_child(margin)
	stack.add_child(scroll)
	var rule := ColorRect.new()
	rule.color = Color(1, 1, 1, 0.08)
	rule.custom_minimum_size.y = 1
	stack.add_child(rule)
	var footer_margin := MarginContainer.new()
	_info_footer_margin = footer_margin
	for side in [["margin_left", 18], ["margin_right", 18], ["margin_top", 13], ["margin_bottom", 13]]:
		footer_margin.add_theme_constant_override(side[0], side[1])
	_info_footer = Country.flow(10, 10)
	footer_margin.add_child(_info_footer)
	stack.add_child(footer_margin)
	_info_panel.add_child(stack)
	_overlay_host().add_child(_info_panel)
	_fit_info()
	resized.connect(_fit_info)


func _fit_info() -> void:
	if not _info_panel:
		return
	var width: float = min(448.0, get_viewport_rect().size.x - 16.0)
	_info_panel.offset_left = -8.0 - width
	await get_tree().process_frame
	if not _info_panel:
		return
	var most: float = get_viewport_rect().size.y - 92.0
	var needed := _info_header.get_combined_minimum_size().y + 1.0 + _info_margin.get_combined_minimum_size().y + _info_footer_margin.get_combined_minimum_size().y
	_info_panel.offset_bottom = _info_panel.offset_top + min(most, needed)


func _overlay_host() -> Control:
	var parent := get_parent()
	return parent as Control if parent is Control else self


func open_listen_in(place: Dictionary) -> void:
	if _phone and is_instance_valid(_phone):
		_phone.close()
	_phone = ListenPhone.new(engine, place)
	_overlay_host().add_child(_phone)


func _open_flag_picker() -> void:
	if _flag_picker and is_instance_valid(_flag_picker):
		_flag_picker.close()
	var polity: Dictionary = _flag_arguments()[0]
	_flag_picker = FlagPicker.new(engine, polity)
	_flag_picker.applied.connect(func() -> void:
		flag_changed.emit(str(polity.get("polityKey", "")))
		if not _info_country.is_empty():
			_load_info(_info_country, false))
	_overlay_host().add_child(_flag_picker)


func _flag_arguments() -> Array:
	return [{"polityKey": str(_info.get("key", _info_country.get("polityKey", ""))), "name": str(_info.get("name", _info_country.get("name", ""))), "code": str(_info_country.get("code", ""))}]


func _pills(holder: Container, names: Array, limit: int, key: String) -> void:
	var chips := Country.flow(5, 5)
	var expanded: bool = _info_expanded.get(key, false)
	var shown := names if expanded else names.slice(0, limit)
	for value in shown:
		chips.add_child(Country.pill(str(value), Color(0, 0, 0, 0), Color(1, 1, 1, 0.35), Color(1, 1, 1, 0.92), 12, 600, Vector4(10, 3, 10, 4)))
	if not expanded and names.size() > limit:
		var more := Country.small_button("+%d more" % (names.size() - limit), Color(0, 0, 0, 0), Color(1, 1, 1, 0.35), Color(1, 1, 1, 0.92), 12, 600, Vector4(10, 3, 10, 4), 999)
		more.modulate.a = 0.6
		more.pressed.connect(func() -> void:
			_info_expanded[key] = true
			_render_info(false))
		chips.add_child(more)
	holder.add_child(chips)


func _region_list(holder: Container, title: String, names: Array, limit: int, key: String, title_size := 14) -> void:
	var cell := Country.column(6)
	cell.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	cell.add_child(Country.text(title, title_size, UI.WHITE, 700))
	if names.is_empty():
		cell.add_child(UI.label("None", 12, Color(1, 1, 1, 0.45)))
	else:
		_pills(cell, names, limit, key)
	holder.add_child(cell)


func _render_info(loading: bool) -> void:
	for child in _info_body.get_children():
		child.queue_free()
	for child in _info_footer.get_children():
		child.queue_free()
	var name := str(_info.get("name", _info_country.get("name", ""))) if not loading else str(_info_country.get("name", ""))
	_info_title.text = name
	var flag := Country.texture_for(str(_info.get("flag", "")), 44) if not loading else null
	_info_flag.texture = flag
	var flag_button := _info_flag.get_parent() as Control
	if flag_button:
		flag_button.tooltip_text = "Change flag" if flag else "Set flag"
	var top := Country.row(6)
	top.add_child(Country.text("Related Events", 16, UI.WHITE, 800))
	var events: Array = [] if loading else _filtered_events()
	var count := "%d of %d shown" % [_info_limit, events.size()] if events.size() > _info_limit else "%d shown" % events.size()
	top.add_child(UI.label(count, 12, Color(1, 1, 1, 0.45)))
	_info_body.add_child(top)
	var search_row := Country.row(7)
	var search := LineEdit.new()
	search.placeholder_text = "Search events..."
	search.text = _info_search
	search.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	search.custom_minimum_size.y = 36
	search.add_theme_font_size_override("font_size", 13)
	search.add_theme_stylebox_override("normal", UI.box(Color(0, 0, 0, 0.28), Color(1, 1, 1, 0.14), 8, 1, Vector4(11, 6, 11, 6)))
	search.add_theme_stylebox_override("focus", UI.box(Color(0, 0, 0, 0.32), Color(1, 1, 1, 0.24), 8, 1, Vector4(11, 6, 11, 6)))
	search.text_changed.connect(func(value: String) -> void:
		_info_search = value
		_render_info(false)
		_refocus_info_search())
	search_row.add_child(search)
	var mode: Array = FILTERS[_info_filter]
	var filter := Country.small_button("ⱶ %s" % ("Filters" if mode[0] == "all" else mode[1]), Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.16), UI.WHITE, 12, 700, Vector4(11, 7, 11, 7), 8)
	filter.tooltip_text = "Filter by importance"
	filter.pressed.connect(func() -> void:
		_info_filter = (_info_filter + 1) % FILTERS.size()
		_render_info(false))
	search_row.add_child(filter)
	_info_body.add_child(search_row)
	if loading:
		_info_body.add_child(Country.text("Loading...", 13, Color(1, 1, 1, 0.5)))
		_info_footer_buttons(true)
		_fit_info()
		return
	if events.is_empty():
		_info_body.add_child(Country.text("No events found for this country.", 13, Color(1, 1, 1, 0.5)))
	else:
		var list := Country.column(7)
		for item in events.slice(0, _info_limit):
			var event: Dictionary = item
			var cell := Country.card(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.08), 10, Vector4(11, 9, 11, 9))
			var inner := Country.column(3)
			var line := Country.row(8)
			line.add_child(Country.text(str(event.get("title", "")), 13, UI.WHITE, 700))
			line.add_child(UI.label(str(event.get("date", "")), 11, Color(1, 1, 1, 0.4)))
			inner.add_child(line)
			if not str(event.get("description", "")).is_empty():
				inner.add_child(Country.text(str(event["description"]), 12, Color(1, 1, 1, 0.62)))
			cell.add_child(inner)
			list.add_child(cell)
		if events.size() > _info_limit:
			var more := Country.small_button("Show more events", Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.16), UI.WHITE, 12, 700, Vector4(11, 7, 11, 7), 8)
			more.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			more.pressed.connect(func() -> void:
				_info_limit += EVENT_STEP
				_render_info(false))
			list.add_child(more)
		_info_body.add_child(list)
	var subordination: Variant = _info.get("subordination")
	if typeof(subordination) == TYPE_DICTIONARY:
		_info_body.add_child(Country.gap(4))
		_subordination(_info_body, subordination, [14, 12, 11])
	var tags: Array = _info.get("tags", [])
	if not tags.is_empty():
		_info_body.add_child(Country.gap(4))
		var chips := Country.flow(5, 5)
		for tag in tags:
			var chip := Country.pill(str(tag), Color(1, 1, 1, 0.11), Color(1, 1, 1, 0.25), Color(1, 1, 1, 0.92), 12, 600, Vector4(10, 3, 10, 4))
			chip.mouse_filter = Control.MOUSE_FILTER_STOP
			chip.tooltip_text = "What this country is — the map-maker set this, and the AI reads it as context"
			chips.add_child(chip)
		_info_body.add_child(chips)
	_info_body.add_child(Country.gap(4))
	_info_body.add_child(Country.text("Details", 16, UI.WHITE, 800))
	var details := Country.row(13)
	var aliases := Country.column(6)
	aliases.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	aliases.size_flags_stretch_ratio = 1.0
	aliases.add_child(Country.text("Alternative Names", 14, UI.WHITE, 700))
	var alias_names: Array = _info.get("aliases", [])
	if alias_names.is_empty():
		aliases.add_child(UI.label("None", 12, Color(1, 1, 1, 0.45)))
	else:
		_pills(aliases, alias_names, 9999, "aliases")
	details.add_child(aliases)
	var sovereign: Array = _info.get("sovereign", [])
	_region_list(details, "Sovereign Regions (%d)" % sovereign.size(), sovereign, SOVEREIGN_PILLS, "sovereign")
	(details.get_child(details.get_child_count() - 1) as Control).size_flags_stretch_ratio = 1.4
	_info_body.add_child(details)
	var controlled: Array = _info.get("controlled", [])
	var occupied: Array = _info.get("occupied", [])
	if not controlled.is_empty() or not occupied.is_empty():
		_info_body.add_child(Country.gap(2))
		var others := Country.row(13)
		_region_list(others, "Controlled, Not Sovereign (%d)" % controlled.size(), controlled, OTHER_PILLS, "controlled", 13)
		_region_list(others, "Under Foreign Control (%d)" % occupied.size(), occupied, OTHER_PILLS, "occupied", 13)
		_info_body.add_child(others)
	if _report != null:
		_info_body.add_child(Country.gap(4))
		var box := Country.card(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.08), 10, Vector4(13, 11, 13, 11))
		var inner := Country.column(5)
		inner.add_child(Country.text("Advisor Report", 14, UI.WHITE, 700))
		if typeof(_report) == TYPE_STRING and str(_report) == "loading":
			inner.add_child(Country.text("Preparing the report…", 12, Color(1, 1, 1, 0.55)))
		elif typeof(_report) == TYPE_DICTIONARY:
			inner.add_child(Country.text(str((_report as Dictionary).get("error", "")), 12, Color("#f87171")))
		else:
			inner.add_child(_markdown(str(_report)))
		box.add_child(inner)
		_info_body.add_child(box)
	_info_footer_buttons(false)
	_fit_info()


func _refocus_info_search() -> void:
	await get_tree().process_frame
	for child in _info_body.get_children():
		if child is HBoxContainer:
			for inner in child.get_children():
				if inner is LineEdit:
					(inner as LineEdit).grab_focus()
					(inner as LineEdit).caret_column = (inner as LineEdit).text.length()
					return


func _filtered_events() -> Array:
	var mode: String = FILTERS[_info_filter][0]
	var query := _info_search.strip_edges().to_lower()
	var result: Array = []
	for item in _info.get("events", []):
		var event: Dictionary = item
		if mode != "all" and str(event.get("importance", "")) != mode:
			continue
		if not query.is_empty() and not str(event.get("search", "")).contains(query):
			continue
		result.append(event)
	return result


func _footer_button(label: String, strong := false) -> Button:
	var node := Country.small_button(label, Color(1, 1, 1, 0.15) if strong else Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.28) if strong else Color(1, 1, 1, 0.16), UI.WHITE, 14, 700, Vector4(14, 11, 14, 11), 999)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


func _info_footer_buttons(loading: bool) -> void:
	var has_report := typeof(_report) == TYPE_STRING and str(_report) != "loading"
	var report := _footer_button("Regenerate Report" if has_report else "Advisor Report")
	report.pressed.connect(_run_report)
	if loading:
		report.disabled = true
	_info_footer.add_child(report)
	var stats := _footer_button("Stats")
	stats.pressed.connect(func() -> void:
		var target := str(_info.get("key", "")) if not str(_info.get("key", "")).is_empty() else str(_info_country.get("polityKey", _info_country.get("name", "")))
		if target.is_empty():
			return
		_close_info()
		open_stats.emit(target))
	_info_footer.add_child(stats)
	if _info.get("listenIn", true):
		var listen := _footer_button("Listen in")
		var key := str(_info.get("key", ""))
		listen.pressed.connect(open_listen_in.bind({
			"polity": str(_info.get("name", _info_country.get("name", ""))),
			"polityKey": key if not key.is_empty() else str(_info_country.get("polityKey", _info.get("name", ""))),
		}))
		_info_footer.add_child(listen)
	var diplomacy := _footer_button("Open Diplomacy", true)
	diplomacy.pressed.connect(func() -> void:
		var target := str(_info.get("key", "")) if not str(_info.get("key", "")).is_empty() else str(_info.get("name", _info_country.get("name", "")))
		_close_info()
		open_chat.emit(target, ""))
	_info_footer.add_child(diplomacy)


func _run_report() -> void:
	if typeof(_report) == TYPE_STRING and str(_report) == "loading":
		return
	if _info.is_empty():
		return
	var asked := _info_country
	_report = "loading"
	_render_info(false)
	var reply: Dictionary = await engine.request("mapcards.report", {"key": str(_info.get("key", "")), "code": str(_info.get("code", "")), "name": str(_info.get("name", ""))})
	if asked != _info_country:
		return
	if not reply.get("ok", false):
		_report = {"error": str(reply.get("error", "Couldn't generate a report. Set an AI provider + key in Settings."))}
	else:
		var result: Dictionary = reply.get("result", {})
		_report_key = str(result.get("reportKey", ""))
		if result.has("error"):
			_report = {"error": str(result["error"])}
		else:
			_report = str(result.get("text", "No information available."))
	_render_info(false)


func _markdown(source: String) -> RichTextLabel:
	var node := RichTextLabel.new()
	node.bbcode_enabled = true
	node.fit_content = true
	node.scroll_active = false
	node.selection_enabled = true
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.add_theme_font_override("normal_font", UI.font(400))
	node.add_theme_font_override("bold_font", UI.font(700))
	node.add_theme_font_size_override("normal_font_size", 13)
	node.add_theme_font_size_override("bold_font_size", 13)
	node.add_theme_color_override("default_color", Color(1, 1, 1, 0.85))
	node.add_theme_constant_override("line_separation", 3)
	var lines: PackedStringArray = []
	var bold := RegEx.new()
	bold.compile("\\*\\*(.+?)\\*\\*")
	var italic := RegEx.new()
	italic.compile("(?<![*\\w])\\*(?!\\s)(.+?)(?<!\\s)\\*(?![*\\w])")
	for raw in source.replace("<br>", "\n").replace("<br/>", "\n").split("\n"):
		var line := raw.strip_edges(false, true).replace("[", "[lb]")
		var stripped := line.strip_edges()
		if stripped.begins_with("- ") or stripped.begins_with("* ") or stripped.begins_with("• "):
			line = "•  " + stripped.substr(2)
		elif stripped.begins_with("#"):
			line = "[b]%s[/b]" % stripped.lstrip("# ")
		line = bold.sub(line, "[b]$1[/b]", true)
		line = italic.sub(line, "[i]$1[/i]", true)
		lines.append(line)
	node.text = "\n".join(lines)
	return node


func _phone_icon() -> Texture2D:
	var svg := "<svg viewBox='0 0 24 24' fill='none' stroke='#ffffff' stroke-opacity='0.88' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect x='6' y='2' width='12' height='20' rx='2.5'/><path d='M11 18h2'/></svg>"
	var image := Image.new()
	if image.load_svg_from_string(svg, 0.5) != OK:
		return null
	return ImageTexture.create_from_image(image)


class CardPointer extends Control:
	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func _draw() -> void:
		var middle := size.x * 0.5
		draw_colored_polygon(PackedVector2Array([Vector2(middle - 8, 0), Vector2(middle + 8, 0), Vector2(middle, 9)]), Color(24 / 255.0, 24 / 255.0, 27 / 255.0, 0.95))


class ListenPhone extends Control:
	signal finished
	const INK := Color(244 / 255.0, 244 / 255.0, 245 / 255.0, 1.0)
	const INK_SOFT := Color(244 / 255.0, 244 / 255.0, 245 / 255.0, 0.56)
	const INK_FAINT := Color(244 / 255.0, 244 / 255.0, 245 / 255.0, 0.34)
	const LINE := Color(1, 1, 1, 0.09)
	const SCREEN := Color(11 / 255.0, 11 / 255.0, 13 / 255.0, 1.0)
	const LIKED := Color(244 / 255.0, 63 / 255.0, 94 / 255.0, 1.0)
	const GLYPHS := {
		"reply": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'><path d='M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 21l2-5.6A8.4 8.4 0 1 1 21 11.5z'/></svg>",
		"repost": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'><path d='M17 2l4 4-4 4'/><path d='M3 12V9a3 3 0 0 1 3-3h15'/><path d='M7 22l-4-4 4-4'/><path d='M21 12v3a3 3 0 0 1-3 3H3'/></svg>",
		"heart": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'><path d='M20.8 5.6a5.2 5.2 0 0 0-7.4 0L12 7l-1.4-1.4a5.2 5.2 0 0 0-7.4 7.4L12 21.8l8.8-8.8a5.2 5.2 0 0 0 0-7.4z'/></svg>",
		"hearted": "<svg viewBox='0 0 24 24' fill='#fff' stroke='#fff' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'><path d='M20.8 5.6a5.2 5.2 0 0 0-7.4 0L12 7l-1.4-1.4a5.2 5.2 0 0 0-7.4 7.4L12 21.8l8.8-8.8a5.2 5.2 0 0 0 0-7.4z'/></svg>",
		"share": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'><path d='M4 13v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6'/><path d='M16 6l-4-4-4 4'/><path d='M12 2v13'/></svg>",
		"refresh": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'><path d='M21 4v6h-6'/><path d='M3 20v-6h6'/><path d='M5.2 9a8 8 0 0 1 13.6-2.6L21 10'/><path d='M18.8 15a8 8 0 0 1-13.6 2.6L3 14'/></svg>",
		"close": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'><path d='M6 6l12 12'/><path d='M18 6L6 18'/></svg>",
		"home": "<svg viewBox='0 0 24 24' fill='#fff'><path d='M12 3l9 8h-2.5v9h-5v-6h-3v6h-5v-9H3z'/></svg>",
		"search": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'><circle cx='11' cy='11' r='7'/><path d='M21 21l-4.5-4.5'/></svg>",
		"bell": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'><path d='M18 9a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8'/><path d='M13.7 21a2 2 0 0 1-3.4 0'/></svg>",
		"mail": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'><rect x='3' y='5' width='18' height='14' rx='2'/><path d='M3 7l9 6 9-6'/></svg>",
		"signal": "<svg viewBox='0 0 17 11' fill='#fff'><rect x='0' y='7' width='3' height='4' rx='0.7'/><rect x='4.6' y='5' width='3' height='6' rx='0.7'/><rect x='9.2' y='2.6' width='3' height='8.4' rx='0.7'/><rect x='13.8' y='0' width='3' height='11' rx='0.7'/></svg>",
		"wifi": "<svg viewBox='0 0 15 11' fill='none' stroke='#fff' stroke-width='1.6' stroke-linecap='round'><path d='M1 4.2a9.2 9.2 0 0 1 13 0'/><path d='M3.4 6.7a5.8 5.8 0 0 1 8.2 0'/><circle cx='7.5' cy='9.3' r='0.9' fill='#fff' stroke='none'/></svg>",
		"battery": "<svg viewBox='0 0 24 11' fill='none'><rect x='0.5' y='0.5' width='20' height='10' rx='2.6' stroke='#fff' stroke-opacity='0.45'/><rect x='2' y='2' width='14' height='7' rx='1.4' fill='#fff'/><rect x='21.6' y='3.4' width='1.6' height='4.2' rx='0.8' fill='#fff' fill-opacity='0.5'/></svg>",
	}

	var engine: EngineLink
	var place: Dictionary = {}
	var nationwide := true
	var session: Variant = null
	var asked: Dictionary = {}
	var loading: Dictionary = {}
	var failed: Dictionary = {}
	var liked: Dictionary = {}
	var view: Dictionary = {}
	var _dim: ColorRect
	var _frame: Control
	var _date_short: Label
	var _title: Label
	var _date_long: Label
	var _refresh: Button
	var _tabs: HBoxContainer
	var _scroll: ScrollContainer
	var _content: VBoxContainer
	var _shimmer: Array = []
	var _clock := 0.0
	var _closing := false
	var _textures := {}

	func _init(link: EngineLink, target: Dictionary) -> void:
		engine = link
		place = target
		set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		mouse_filter = Control.MOUSE_FILTER_STOP
		_dim = ColorRect.new()
		_dim.color = Color(6 / 255.0, 6 / 255.0, 8 / 255.0, 0.62)
		_dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		_dim.mouse_filter = Control.MOUSE_FILTER_STOP
		_dim.gui_input.connect(_on_dim_input)
		add_child(_dim)
		_frame = Control.new()
		_frame.mouse_filter = Control.MOUSE_FILTER_STOP
		add_child(_frame)
		_build()

	func _ready() -> void:
		_fit()
		get_viewport().size_changed.connect(_fit)
		modulate.a = 0.0
		var fade := create_tween()
		fade.tween_property(self, "modulate:a", 1.0, 0.16)
		_frame.pivot_offset = _frame.size * 0.5
		_frame.scale = Vector2.ONE * 0.985
		var settle := create_tween().set_parallel(true).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
		settle.tween_property(_frame, "scale", Vector2.ONE, 0.26)
		settle.tween_property(_frame, "position:y", _frame.position.y, 0.26).from(_frame.position.y + 18.0)
		await refresh_view()

	func _fit() -> void:
		var area := get_viewport_rect().size
		var width: float = min(376.0, area.x - 32.0)
		var height: float = min(784.0, area.y - 32.0)
		_frame.size = Vector2(width + 6.0, height + 6.0)
		_frame.position = ((area - _frame.size) * 0.5).round()
		_frame.pivot_offset = _frame.size * 0.5

	func _svg(name: String, width: int, height: int, color: Color) -> Texture2D:
		var key := "%s:%d:%d:%s" % [name, width, height, color.to_html()]
		if _textures.has(key):
			return _textures[key]
		var source: String = str(GLYPHS.get(name, "")).replace("#fff", "#" + color.to_html(false))
		var image := Image.new()
		var base := 24.0
		if name == "signal":
			base = 17.0
		elif name == "wifi":
			base = 15.0
		elif name == "battery":
			base = 24.0
		if image.load_svg_from_string(source, float(width) / base) != OK:
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

	func _glyph(name: String, size: int, color: Color, height := -1) -> TextureRect:
		var rect := TextureRect.new()
		rect.texture = _svg(name, size, height if height > 0 else size, color)
		rect.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
		rect.custom_minimum_size = Vector2(size, height if height > 0 else size)
		rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
		rect.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		return rect

	func _label(text: String, size: int, color: Color, weight := 400) -> Label:
		var node := UI.label(text, size, color, weight, "Segoe UI")
		return node

	func _round_button(name: String, tip: String) -> Button:
		var node := Button.new()
		node.focus_mode = Control.FOCUS_NONE
		node.tooltip_text = tip
		node.custom_minimum_size = Vector2(32, 32)
		node.icon = _svg(name, 18, 18, INK)
		node.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
		node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		var style := UI.box(Color(1, 1, 1, 0.06), Color(0, 0, 0, 0), 999, 0)
		var hover := UI.box(Color(1, 1, 1, 0.1), Color(0, 0, 0, 0), 999, 0)
		for state in [["normal", style], ["focus", style], ["disabled", style], ["hover", hover], ["pressed", hover], ["hover_pressed", hover]]:
			node.add_theme_stylebox_override(state[0], state[1])
		node.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		return node

	func _build() -> void:
		var outer := PanelContainer.new()
		outer.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		outer.add_theme_stylebox_override("panel", UI.box(Color(14 / 255.0, 14 / 255.0, 16 / 255.0), Color(0, 0, 0, 0), 53, 0, Vector4(2, 2, 2, 2)))
		outer.mouse_filter = Control.MOUSE_FILTER_STOP
		_frame.add_child(outer)
		var ring := PanelContainer.new()
		ring.add_theme_stylebox_override("panel", UI.box(Color(58 / 255.0, 58 / 255.0, 64 / 255.0), Color(0, 0, 0, 0), 51, 0, Vector4(1, 1, 1, 1)))
		ring.mouse_filter = Control.MOUSE_FILTER_PASS
		outer.add_child(ring)
		var body := PanelContainer.new()
		body.add_theme_stylebox_override("panel", UI.box(Color(23 / 255.0, 23 / 255.0, 26 / 255.0), Color(0, 0, 0, 0), 50, 0, Vector4(9.6, 9.6, 9.6, 9.6)))
		body.mouse_filter = Control.MOUSE_FILTER_PASS
		ring.add_child(body)
		for side in [[-3.0, 115.2, 32.0, true], [-3.0, 166.4, 54.4, true], [-3.0, 176.0, 80.0, false]]:
			var button := ColorRect.new()
			button.color = Color(44 / 255.0, 44 / 255.0, 49 / 255.0)
			button.mouse_filter = Control.MOUSE_FILTER_IGNORE
			button.size = Vector2(3, float(side[2]))
			button.position = Vector2(float(side[0]) if side[3] else 0.0, float(side[1]))
			if not side[3]:
				button.anchor_left = 1.0
				button.anchor_right = 1.0
				button.offset_left = 0.0
				button.offset_right = 3.0
				button.offset_top = float(side[1])
				button.offset_bottom = float(side[1]) + float(side[2])
			_frame.add_child(button)
		var screen := PanelContainer.new()
		screen.add_theme_stylebox_override("panel", UI.box(SCREEN, Color(0, 0, 0, 0), 41, 0))
		screen.clip_contents = true
		screen.mouse_filter = Control.MOUSE_FILTER_PASS
		body.add_child(screen)
		var column := VBoxContainer.new()
		column.add_theme_constant_override("separation", 0)
		screen.add_child(column)
		var status := MarginContainer.new()
		for entry in [["margin_left", 24], ["margin_right", 24], ["margin_top", 6], ["margin_bottom", 0]]:
			status.add_theme_constant_override(entry[0], entry[1])
		status.custom_minimum_size.y = 44
		var status_row := HBoxContainer.new()
		status_row.add_theme_constant_override("separation", 0)
		_date_short = _label("", 12, INK, 700)
		_date_short.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		_date_short.size_flags_stretch_ratio = 1.0
		_date_short.clip_text = true
		_date_short.custom_minimum_size.x = 1
		_date_short.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		status_row.add_child(_date_short)
		var island := Panel.new()
		island.custom_minimum_size = Vector2(90, 25)
		island.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		island.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0), Color(1, 1, 1, 0.05), 999, 1))
		island.mouse_filter = Control.MOUSE_FILTER_IGNORE
		status_row.add_child(island)
		var marks := HBoxContainer.new()
		marks.add_theme_constant_override("separation", 5)
		marks.alignment = BoxContainer.ALIGNMENT_END
		marks.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		marks.size_flags_stretch_ratio = 1.0
		marks.mouse_filter = Control.MOUSE_FILTER_IGNORE
		marks.add_child(_glyph("signal", 17, INK, 11))
		marks.add_child(_glyph("wifi", 15, INK, 11))
		marks.add_child(_glyph("battery", 24, INK, 11))
		status_row.add_child(marks)
		status.add_child(status_row)
		column.add_child(status)
		var header := MarginContainer.new()
		for entry in [["margin_left", 14], ["margin_right", 14], ["margin_top", 6], ["margin_bottom", 8]]:
			header.add_theme_constant_override(entry[0], entry[1])
		var header_row := HBoxContainer.new()
		header_row.add_theme_constant_override("separation", 10)
		var shut := _round_button("close", "Close")
		shut.pressed.connect(close)
		header_row.add_child(shut)
		var titles := VBoxContainer.new()
		titles.add_theme_constant_override("separation", 0)
		titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		titles.mouse_filter = Control.MOUSE_FILTER_IGNORE
		_title = _label("", 16, INK, 800)
		_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		_title.clip_text = true
		_title.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		_title.custom_minimum_size.x = 1
		titles.add_child(_title)
		_date_long = _label("", 11, INK_SOFT)
		_date_long.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		_date_long.clip_text = true
		_date_long.custom_minimum_size.x = 1
		titles.add_child(_date_long)
		header_row.add_child(titles)
		_refresh = _round_button("refresh", "Load new posts (one AI request)")
		_refresh.pressed.connect(_ask)
		header_row.add_child(_refresh)
		header.add_child(header_row)
		column.add_child(header)
		_tabs = HBoxContainer.new()
		_tabs.add_theme_constant_override("separation", 0)
		column.add_child(_tabs)
		_scroll = ScrollContainer.new()
		_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
		_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
		_scroll.get_v_scroll_bar().modulate.a = 0.0
		_content = VBoxContainer.new()
		_content.add_theme_constant_override("separation", 0)
		_content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		_scroll.add_child(_content)
		column.add_child(_scroll)
		var bar_rule := ColorRect.new()
		bar_rule.color = LINE
		bar_rule.custom_minimum_size.y = 1
		column.add_child(bar_rule)
		var bar := MarginContainer.new()
		for entry in [["margin_left", 16], ["margin_right", 16], ["margin_top", 9], ["margin_bottom", 5]]:
			bar.add_theme_constant_override(entry[0], entry[1])
		var bar_row := HBoxContainer.new()
		bar_row.add_theme_constant_override("separation", 0)
		for entry in [["home", INK], ["search", INK_SOFT], ["bell", INK_SOFT], ["mail", INK_SOFT]]:
			var holder := CenterContainer.new()
			holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
			holder.add_child(_glyph(entry[0], 22, entry[1]))
			bar_row.add_child(holder)
		bar.add_child(bar_row)
		column.add_child(bar)
		var indicator := CenterContainer.new()
		indicator.custom_minimum_size.y = 14
		indicator.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var pill := Panel.new()
		pill.custom_minimum_size = Vector2(118, 4.5)
		pill.add_theme_stylebox_override("panel", UI.box(Color(244 / 255.0, 244 / 255.0, 245 / 255.0, 0.85), Color(0, 0, 0, 0), 999, 0))
		pill.mouse_filter = Control.MOUSE_FILTER_IGNORE
		indicator.add_child(pill)
		var indicator_pad := MarginContainer.new()
		indicator_pad.add_theme_constant_override("margin_top", 0)
		indicator_pad.add_theme_constant_override("margin_bottom", 6)
		indicator_pad.add_child(indicator)
		column.add_child(indicator_pad)

	func _on_dim_input(event: InputEvent) -> void:
		if event is InputEventMouseButton and (event as InputEventMouseButton).pressed and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT:
			close()

	func _input(event: InputEvent) -> void:
		if event is InputEventKey and (event as InputEventKey).pressed and (event as InputEventKey).keycode == KEY_ESCAPE:
			get_viewport().set_input_as_handled()
			close()

	func _process(delta: float) -> void:
		if _shimmer.is_empty():
			return
		_clock += delta
		var glow := 0.5 + 0.5 * (0.5 - 0.5 * cos(_clock / 1.4 * TAU))
		for node in _shimmer:
			if is_instance_valid(node):
				(node as CanvasItem).modulate.a = glow

	func close() -> void:
		if _closing:
			return
		_closing = true
		finished.emit()
		var fade := create_tween()
		fade.tween_property(self, "modulate:a", 0.0, 0.12)
		fade.tween_callback(queue_free)

	func refresh_view() -> void:
		var reply: Dictionary = await engine.request("mapcards.listenin.view", {"place": place, "nationwide": nationwide, "session": session, "asked": asked, "loading": loading, "failed": failed})
		if _closing or not is_inside_tree():
			return
		if not reply.get("ok", false):
			return
		var result: Dictionary = reply.get("result", {})
		if result.get("closed", false):
			close()
			return
		view = result
		session = result.get("session")
		_render()
		if view.get("shouldAsk", false):
			await _load()

	func _ask() -> void:
		if view.get("canAsk", false):
			await _load()

	func _load() -> void:
		var key := str(view.get("requestKey", ""))
		if key.is_empty() or loading.has(key):
			return
		asked[key] = true
		failed.erase(key)
		loading[key] = true
		var target: Dictionary = view.get("place", place)
		var language := str((session as Dictionary).get("language", "")) if typeof(session) == TYPE_DICTIONARY else ""
		await refresh_view()
		var reply: Dictionary = await engine.request("mapcards.listenin.load", {"place": target, "language": language, "key": key})
		loading.erase(key)
		if _closing or not is_inside_tree():
			return
		var result: Dictionary = reply.get("result", {}) if reply.get("ok", false) else {"ok": false, "error": str(reply.get("error", ""))}
		if not result.get("ok", false):
			failed[key] = str(result.get("error", ""))
		elif typeof(session) == TYPE_DICTIONARY and str(result.get("campaignId", "")) == str((session as Dictionary).get("gameId", "")):
			var landed := str(result.get("gameDate", ""))
			if not landed.is_empty() and landed != str((session as Dictionary).get("gameDate", "")):
				(session as Dictionary)["gameDate"] = landed
		await refresh_view()

	func _pill(text: String) -> Button:
		var node := Button.new()
		node.text = text
		node.focus_mode = Control.FOCUS_NONE
		node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		node.add_theme_font_override("font", UI.font(800, "Segoe UI"))
		node.add_theme_font_size_override("font_size", 13)
		for state in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
			node.add_theme_color_override(state, SCREEN)
		var style := UI.box(INK, Color(0, 0, 0, 0), 999, 0, Vector4(17.6, 7.2, 17.6, 7.2))
		for state in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
			node.add_theme_stylebox_override(state, style)
		node.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
		node.pressed.connect(_load)
		return node

	func _rule() -> ColorRect:
		var node := ColorRect.new()
		node.color = LINE
		node.custom_minimum_size.y = 1
		node.mouse_filter = Control.MOUSE_FILTER_IGNORE
		return node

	func _render() -> void:
		_date_short.text = str(view.get("dateShort", ""))
		_title.text = str(view.get("title", ""))
		_date_long.text = str(view.get("dateLong", ""))
		var can_ask: bool = view.get("canAsk", false)
		_refresh.disabled = not can_ask
		_refresh.modulate.a = 1.0 if can_ask else 0.45
		_refresh.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if can_ask else Control.CURSOR_ARROW
		for child in _tabs.get_children():
			child.queue_free()
		var tabs: Variant = view.get("tabs")
		_tabs.visible = typeof(tabs) == TYPE_ARRAY
		if typeof(tabs) == TYPE_ARRAY:
			var names: Array = tabs
			var whole: bool = view.get("nationwide", false)
			for index in range(2):
				var active := (index == 0) == whole
				var tab := Button.new()
				tab.text = str(names[index])
				tab.focus_mode = Control.FOCUS_NONE
				tab.clip_text = true
				tab.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
				tab.size_flags_horizontal = Control.SIZE_EXPAND_FILL
				tab.custom_minimum_size = Vector2(1, 37)
				tab.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
				tab.add_theme_font_override("font", UI.font(700, "Segoe UI"))
				tab.add_theme_font_size_override("font_size", 13)
				for state in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
					tab.add_theme_color_override(state, INK if active else INK_SOFT)
				var style := StyleBoxFlat.new()
				style.bg_color = Color(0, 0, 0, 0)
				style.border_color = INK if active else Color(0, 0, 0, 0)
				style.border_width_bottom = 2
				style.content_margin_left = 8
				style.content_margin_right = 8
				style.content_margin_top = 9.6
				style.content_margin_bottom = 8
				for state in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
					tab.add_theme_stylebox_override(state, style)
				var whole_country := index == 0
				tab.pressed.connect(func() -> void:
					nationwide = whole_country
					refresh_view())
				_tabs.add_child(tab)
		var keep := _scroll.scroll_vertical
		for child in _content.get_children():
			child.queue_free()
		_shimmer.clear()
		var trends: Array = view.get("trends", [])
		if not trends.is_empty():
			var block := MarginContainer.new()
			for entry in [["margin_left", 16], ["margin_right", 16], ["margin_top", 10], ["margin_bottom", 11]]:
				block.add_theme_constant_override(entry[0], entry[1])
			var stack := VBoxContainer.new()
			stack.add_theme_constant_override("separation", 6)
			stack.add_child(UI.label("TRENDING", 11, INK_SOFT, 700, "Segoe UI", 1))
			var chips := HFlowContainer.new()
			chips.add_theme_constant_override("h_separation", 6)
			chips.add_theme_constant_override("v_separation", 6)
			for trend in trends:
				var chip := PanelContainer.new()
				chip.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.07), Color(0, 0, 0, 0), 999, 0, Vector4(9.6, 3.5, 9.6, 3.5)))
				chip.add_child(_label(str(trend), 12, INK, 600))
				chips.add_child(chip)
			stack.add_child(chips)
			block.add_child(stack)
			_content.add_child(block)
			_content.add_child(_rule())
		var waiting: bool = view.get("waiting", false)
		var failure: Variant = view.get("failure")
		var batches: Array = view.get("batches", [])
		if waiting:
			var tuning := MarginContainer.new()
			for entry in [["margin_left", 16], ["margin_right", 16], ["margin_top", 11], ["margin_bottom", 3]]:
				tuning.add_theme_constant_override(entry[0], entry[1])
			tuning.add_child(_label("Tuning in…", 12, INK_SOFT))
			_content.add_child(tuning)
			for width in [0.7, 0.48, 0.82]:
				_content.add_child(_skeleton(width))
		if typeof(failure) == TYPE_STRING and not waiting:
			var box := MarginContainer.new()
			for entry in [["margin_left", 16], ["margin_right", 16], ["margin_top", 18], ["margin_bottom", 18]]:
				box.add_theme_constant_override(entry[0], entry[1])
			var stack := VBoxContainer.new()
			stack.add_theme_constant_override("separation", 5)
			var headline := _label("The feed could not be loaded.", 14, INK, 700)
			headline.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			stack.add_child(headline)
			if not str(failure).is_empty():
				var detail := _label(str(failure), 12, INK_SOFT)
				detail.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
				detail.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
				detail.custom_minimum_size.x = 1
				stack.add_child(detail)
			stack.add_child(Control.new())
			stack.add_child(_pill("Try again"))
			box.add_child(stack)
			_content.add_child(box)
			_content.add_child(_rule())
		if not waiting and typeof(failure) != TYPE_STRING and batches.is_empty():
			var empty := MarginContainer.new()
			for entry in [["margin_left", 16], ["margin_right", 16], ["margin_top", 26], ["margin_bottom", 26]]:
				empty.add_theme_constant_override(entry[0], entry[1])
			var stack := VBoxContainer.new()
			stack.add_theme_constant_override("separation", 11)
			var nothing := _label("Nothing has come through yet.", 14, INK_SOFT)
			nothing.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			stack.add_child(nothing)
			stack.add_child(_pill("Load posts"))
			empty.add_child(stack)
			_content.add_child(empty)
		for item in batches:
			var batch: Dictionary = item
			if not str(batch.get("line", "")).is_empty():
				var line := PanelContainer.new()
				line.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.03), Color(0, 0, 0, 0), 0, 0, Vector4(16, 6.4, 16, 6.4)))
				var words := _label(str(batch["line"]), 11, INK_SOFT, 700)
				words.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
				line.add_child(words)
				_content.add_child(line)
				_content.add_child(_rule())
			for post_item in batch.get("posts", []):
				_content.add_child(_post(post_item))
				_content.add_child(_rule())
		if not batches.is_empty():
			var note := MarginContainer.new()
			for entry in [["margin_left", 19], ["margin_right", 19], ["margin_top", 14], ["margin_bottom", 19]]:
				note.add_theme_constant_override(entry[0], entry[1])
			var words := _label("Written by your AI model. Each new feed is one AI request.", 11, INK_FAINT)
			words.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			words.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			words.custom_minimum_size.x = 1
			note.add_child(words)
			_content.add_child(note)
		await get_tree().process_frame
		if is_instance_valid(_scroll):
			_scroll.scroll_vertical = keep

	func _skeleton(width: float) -> Control:
		var box := MarginContainer.new()
		for entry in [["margin_left", 16], ["margin_right", 16], ["margin_top", 13], ["margin_bottom", 13]]:
			box.add_theme_constant_override(entry[0], entry[1])
		var line := HBoxContainer.new()
		line.add_theme_constant_override("separation", 11)
		var face := Panel.new()
		face.custom_minimum_size = Vector2(40, 40)
		face.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.1), Color(0, 0, 0, 0), 999, 0))
		face.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
		_shimmer.append(face)
		line.add_child(face)
		var bars := VBoxContainer.new()
		bars.add_theme_constant_override("separation", 8)
		bars.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var gap_top := Control.new()
		gap_top.custom_minimum_size.y = 3
		bars.add_child(gap_top)
		for fraction in [0.45, 0.92, width]:
			var holder := Control.new()
			holder.custom_minimum_size.y = 11
			holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			var bar := Panel.new()
			bar.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.1), Color(0, 0, 0, 0), 999, 0))
			bar.anchor_right = float(fraction)
			bar.anchor_bottom = 1.0
			holder.add_child(bar)
			_shimmer.append(bar)
			bars.add_child(holder)
		line.add_child(bars)
		box.add_child(line)
		return box

	func _post(item: Variant) -> Control:
		var post: Dictionary = item
		var id := str(post.get("id", ""))
		var box := MarginContainer.new()
		for entry in [["margin_left", 16], ["margin_right", 16], ["margin_top", 13], ["margin_bottom", 13]]:
			box.add_theme_constant_override(entry[0], entry[1])
		var line := HBoxContainer.new()
		line.add_theme_constant_override("separation", 11)
		var face := PanelContainer.new()
		face.custom_minimum_size = Vector2(40, 40)
		face.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
		face.add_theme_stylebox_override("panel", UI.box(Color.html(str(post.get("colour", "#5f6875ff"))), Color(0, 0, 0, 0), 999, 0))
		var initials := UI.label(str(post.get("initials", "?")), 13, UI.WHITE, 700, "Segoe UI")
		initials.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		initials.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		face.add_child(initials)
		line.add_child(face)
		var words := VBoxContainer.new()
		words.add_theme_constant_override("separation", 0)
		words.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var who := HBoxContainer.new()
		who.add_theme_constant_override("separation", 5)
		var author := _label(str(post.get("author", "")), 14, INK, 700)
		author.clip_text = true
		author.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		author.custom_minimum_size.x = min(UI.font(700, "Segoe UI").get_string_size(author.text, HORIZONTAL_ALIGNMENT_LEFT, -1, 14).x + 2.0, 170.0)
		who.add_child(author)
		if not str(post.get("handle", "")).is_empty():
			var handle := _label(str(post["handle"]), 13, INK_SOFT)
			handle.clip_text = true
			handle.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
			handle.custom_minimum_size.x = 32
			handle.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			handle.size_flags_stretch_ratio = 10.0
			who.add_child(handle)
		who.add_child(_label(str(post.get("age", "")), 13, INK_SOFT))
		words.add_child(who)
		if not str(post.get("about", "")).is_empty():
			var about := _label(str(post["about"]), 12, INK_FAINT)
			about.clip_text = true
			about.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
			about.custom_minimum_size.x = 1
			words.add_child(about)
		var spacer := Control.new()
		spacer.custom_minimum_size.y = 3
		words.add_child(spacer)
		var text := _label(str(post.get("text", "")), 15, INK)
		text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		text.custom_minimum_size.x = 1
		text.add_theme_constant_override("line_spacing", 4)
		words.add_child(text)
		var actions_gap := Control.new()
		actions_gap.custom_minimum_size.y = 8
		words.add_child(actions_gap)
		var actions := HBoxContainer.new()
		actions.add_theme_constant_override("separation", 0)
		actions.custom_minimum_size.x = 0
		var is_liked: bool = liked.has(id)
		actions.add_child(_action("reply", str(post.get("replies", "")), INK_FAINT))
		actions.add_child(_action("repost", str(post.get("reposts", "")), INK_FAINT))
		var heart := Button.new()
		heart.flat = true
		heart.focus_mode = Control.FOCUS_NONE
		heart.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		heart.icon = _svg("hearted" if is_liked else "heart", 18, 18, LIKED if is_liked else INK_FAINT)
		heart.text = str(post.get("likesWithMine", "")) if is_liked else str(post.get("likes", ""))
		heart.add_theme_constant_override("h_separation", 5)
		heart.add_theme_font_override("font", UI.font(400, "Segoe UI"))
		heart.add_theme_font_size_override("font_size", 12)
		for state in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
			heart.add_theme_color_override(state, LIKED if is_liked else INK_FAINT)
		for state in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
			heart.add_theme_stylebox_override(state, StyleBoxEmpty.new())
		heart.custom_minimum_size.x = 48
		heart.alignment = HORIZONTAL_ALIGNMENT_LEFT
		heart.pressed.connect(func() -> void:
			if liked.has(id):
				liked.erase(id)
			else:
				liked[id] = true
			_render())
		var heart_holder := HBoxContainer.new()
		heart_holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		heart_holder.add_child(heart)
		actions.add_child(heart_holder)
		var share := HBoxContainer.new()
		share.add_child(_glyph("share", 18, INK_FAINT))
		actions.add_child(share)
		var limit := HBoxContainer.new()
		limit.add_child(actions)
		actions.custom_minimum_size.x = 272
		actions.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		words.add_child(limit)
		line.add_child(words)
		box.add_child(line)
		return box

	func _action(name: String, count: String, color: Color) -> Control:
		var holder := HBoxContainer.new()
		holder.add_theme_constant_override("separation", 5)
		holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		holder.custom_minimum_size.x = 48
		holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
		holder.add_child(_glyph(name, 18, color))
		if not count.is_empty():
			var label := _label(count, 12, color)
			label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
			holder.add_child(label)
		return holder


class FlagPicker extends Control:
	signal applied
	const BUTTON_BG := Color(1, 1, 1, 0.06)
	const BUTTON_BORDER := Color(1, 1, 1, 0.14)

	var engine: EngineLink
	var polity: Dictionary = {}
	var tab := "game"
	var query := ""
	var busy := false
	var error := ""
	var game_view: Dictionary = {}
	var community: Array = []
	var community_state := "idle"
	var pack: Dictionary = {}
	var pack_flags: Array = []
	var pack_state := "idle"
	var pack_error := ""
	var _card: PanelContainer
	var _current: TextureRect
	var _current_empty: Panel
	var _name: Label
	var _tool_row: HFlowContainer
	var _error_holder: MarginContainer
	var _body: VBoxContainer
	var _scroll: ScrollContainer
	var _search: LineEdit
	var _dialog: FileDialog
	var _closing := false

	func _init(link: EngineLink, target: Dictionary) -> void:
		engine = link
		polity = target
		set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		mouse_filter = Control.MOUSE_FILTER_STOP
		var dim := ColorRect.new()
		dim.color = Color(2 / 255.0, 6 / 255.0, 23 / 255.0, 0.78)
		dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		add_child(dim)
		_card = PanelContainer.new()
		_card.add_theme_stylebox_override("panel", UI.box(Color(16 / 255.0, 18 / 255.0, 24 / 255.0, 0.99), Color(1, 1, 1, 0.13), 16, 1))
		_card.clip_contents = true
		add_child(_card)
		var column := VBoxContainer.new()
		column.add_theme_constant_override("separation", 0)
		_card.add_child(column)
		var header := MarginContainer.new()
		for entry in [["margin_left", 18], ["margin_right", 18], ["margin_top", 16], ["margin_bottom", 16]]:
			header.add_theme_constant_override(entry[0], entry[1])
		var header_row := HBoxContainer.new()
		header_row.add_theme_constant_override("separation", 13)
		var flag_holder := Control.new()
		flag_holder.custom_minimum_size = Vector2(46, 29)
		flag_holder.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		_current_empty = Panel.new()
		_current_empty.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		_current_empty.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0), Color(1, 1, 1, 0.18), 4, 1))
		flag_holder.add_child(_current_empty)
		_current = TextureRect.new()
		_current.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		_current.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		_current.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
		flag_holder.add_child(_current)
		header_row.add_child(flag_holder)
		var titles := VBoxContainer.new()
		titles.add_theme_constant_override("separation", 1)
		titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		titles.add_child(UI.label("Change flag", 16, UI.WHITE, 800))
		_name = UI.label("", 12, Color(1, 1, 1, 0.5))
		_name.clip_text = true
		_name.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		_name.custom_minimum_size.x = 1
		titles.add_child(_name)
		header_row.add_child(titles)
		var shut := _button("✕", Color(0, 0, 0, 0))
		shut.tooltip_text = "Close flag picker"
		shut.add_theme_font_size_override("font_size", 16)
		shut.pressed.connect(close)
		header_row.add_child(shut)
		header.add_child(header_row)
		column.add_child(header)
		column.add_child(_line(0.08))
		var tools := MarginContainer.new()
		for entry in [["margin_left", 16], ["margin_right", 16], ["margin_top", 12], ["margin_bottom", 12]]:
			tools.add_theme_constant_override(entry[0], entry[1])
		_tool_row = HFlowContainer.new()
		_tool_row.add_theme_constant_override("h_separation", 8)
		_tool_row.add_theme_constant_override("v_separation", 8)
		tools.add_child(_tool_row)
		column.add_child(tools)
		column.add_child(_line(0.06))
		_error_holder = MarginContainer.new()
		for entry in [["margin_left", 16], ["margin_right", 16], ["margin_top", 12], ["margin_bottom", 0]]:
			_error_holder.add_theme_constant_override(entry[0], entry[1])
		_error_holder.visible = false
		column.add_child(_error_holder)
		_scroll = ScrollContainer.new()
		_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
		_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
		var pad := MarginContainer.new()
		pad.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		for entry in [["margin_left", 16], ["margin_right", 16], ["margin_top", 16], ["margin_bottom", 16]]:
			pad.add_theme_constant_override(entry[0], entry[1])
		_body = VBoxContainer.new()
		_body.add_theme_constant_override("separation", 12)
		_body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		pad.add_child(_body)
		_scroll.add_child(pad)
		column.add_child(_scroll)
		_search = LineEdit.new()
		_search.custom_minimum_size = Vector2(192, 34)
		_search.add_theme_font_size_override("font_size", 13)
		_search.add_theme_stylebox_override("normal", UI.box(Color(0, 0, 0, 0.3), Color(1, 1, 1, 0.14), 9, 1, Vector4(11, 6, 11, 6)))
		_search.add_theme_stylebox_override("focus", UI.box(Color(0, 0, 0, 0.32), Color(1, 1, 1, 0.24), 9, 1, Vector4(11, 6, 11, 6)))
		_search.text_changed.connect(_on_search)
		_dialog = FileDialog.new()
		_dialog.file_mode = FileDialog.FILE_MODE_OPEN_FILE
		_dialog.access = FileDialog.ACCESS_FILESYSTEM
		_dialog.use_native_dialog = true
		_dialog.filters = PackedStringArray(["*.png, *.jpg, *.jpeg, *.webp, *.gif, *.svg ; Images"])
		_dialog.file_selected.connect(_upload)
		add_child(_dialog)

	func _ready() -> void:
		_fit()
		get_viewport().size_changed.connect(_fit)
		_build_tools()
		await refresh()

	func _fit() -> void:
		var area := get_viewport_rect().size
		var width: float = min(896.0, area.x * 0.96)
		_card.size.x = width
		await get_tree().process_frame
		if _closing or not is_inside_tree():
			return
		var tallest: float = area.y * 0.88
		var needed := _card.get_combined_minimum_size().y + _body.get_combined_minimum_size().y + 32.0
		_card.size = Vector2(width, min(tallest, needed))
		_card.position = ((area - _card.size) * 0.5).round()

	func _line(alpha: float) -> ColorRect:
		var node := ColorRect.new()
		node.color = Color(1, 1, 1, alpha)
		node.custom_minimum_size.y = 1
		node.mouse_filter = Control.MOUSE_FILTER_IGNORE
		return node

	func _button(text: String, bg := BUTTON_BG, border := BUTTON_BORDER) -> Button:
		var node := Button.new()
		node.text = text
		node.focus_mode = Control.FOCUS_NONE
		node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		node.add_theme_font_override("font", UI.font(700))
		node.add_theme_font_size_override("font_size", 13)
		for state in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
			node.add_theme_color_override(state, UI.WHITE)
		node.add_theme_color_override("font_disabled_color", Color(1, 1, 1, 0.5))
		var style := UI.box(bg, border, 9, 1 if border.a > 0.0 else 0, Vector4(12, 8.8, 12, 8.8))
		var hover := UI.box(Color(1, 1, 1, max(bg.a, 0.04) + 0.04), border, 9, 1 if border.a > 0.0 else 0, Vector4(12, 8.8, 12, 8.8))
		for state in [["normal", style], ["focus", style], ["disabled", style], ["hover", hover], ["pressed", hover], ["hover_pressed", hover]]:
			node.add_theme_stylebox_override(state[0], state[1])
		return node

	func _build_tools() -> void:
		for child in _tool_row.get_children():
			if child != _search:
				child.queue_free()
		if _search.get_parent():
			_search.get_parent().remove_child(_search)
		for entry in [["game", "In this game"], ["community", "Community"]]:
			var active: bool = entry[0] == tab
			var choice := _button(entry[1], Color(1, 1, 1, 0.14) if active else BUTTON_BG, Color(1, 1, 1, 0.28) if active else BUTTON_BORDER)
			var key: String = entry[0]
			choice.pressed.connect(func() -> void:
				tab = key
				query = ""
				_search.text = ""
				if key != "community":
					pack = {}
					pack_flags = []
					pack_state = "idle"
					pack_error = ""
				_build_tools()
				refresh())
			_tool_row.add_child(choice)
		_search.placeholder_text = "Search this pack…" if not pack.is_empty() else "Search flags…"
		_search.tooltip_text = "Search flags in this pack" if not pack.is_empty() else "Search flags"
		_tool_row.add_child(_search)
		var space := Control.new()
		space.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		_tool_row.add_child(space)
		var upload := _button("Upload image")
		upload.disabled = busy
		upload.modulate.a = 0.5 if busy else 1.0
		upload.pressed.connect(func() -> void: _dialog.popup_centered_ratio(0.6))
		_tool_row.add_child(upload)
		var standard := _button("Use standard")
		standard.tooltip_text = "Remove the custom flag and use the polity's safe stock/map fallback when one exists"
		standard.disabled = busy
		standard.modulate.a = 0.5 if busy else 1.0
		standard.pressed.connect(_apply.bind(""))
		_tool_row.add_child(standard)

	func _input(event: InputEvent) -> void:
		if event is InputEventKey and (event as InputEventKey).pressed and (event as InputEventKey).keycode == KEY_ESCAPE:
			get_viewport().set_input_as_handled()
			close()

	func close() -> void:
		if _closing:
			return
		_closing = true
		queue_free()

	func _on_search(value: String) -> void:
		query = value
		if tab == "game":
			await refresh()
		else:
			_render()

	func refresh() -> void:
		if tab == "game":
			var reply: Dictionary = await engine.request("mapcards.flags.view", {"polity": polity, "query": query})
			if _closing or not reply.get("ok", false):
				return
			game_view = reply.get("result", {})
		elif community_state == "idle":
			community_state = "loading"
			_render()
			var reply: Dictionary = await engine.request("mapcards.flags.community", {})
			if _closing:
				return
			var result: Dictionary = reply.get("result", {}) if reply.get("ok", false) else {"ok": false, "error": str(reply.get("error", ""))}
			if result.get("ok", false):
				community = result.get("posts", [])
				community_state = "ready"
			else:
				community_state = "error"
				error = str(result.get("error", "Could not load community flags."))
		if game_view.is_empty():
			var first: Dictionary = await engine.request("mapcards.flags.view", {"polity": polity, "query": ""})
			if first.get("ok", false):
				game_view = first.get("result", {})
		_render()

	func _texture(path: String) -> Texture2D:
		return Country.texture_for(path, 96)

	func _render() -> void:
		if _closing:
			return
		_name.text = str(game_view.get("name", polity.get("name", "")))
		var current := _texture(str(game_view.get("current", "")))
		_current.texture = current
		_current_empty.visible = current == null
		for child in _error_holder.get_children():
			child.queue_free()
		_error_holder.visible = not error.is_empty()
		if not error.is_empty():
			var box := PanelContainer.new()
			box.add_theme_stylebox_override("panel", UI.box(Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.12), Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.35), 8, 1, Vector4(12, 9.6, 12, 9.6)))
			var words := UI.label(error, 12, Color("#fca5a5"))
			words.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			words.custom_minimum_size.x = 1
			box.add_child(words)
			_error_holder.add_child(box)
		for child in _body.get_children():
			child.queue_free()
		var width: float = _card.size.x - 32.0
		if tab == "game":
			_body.add_child(_note("Reuse any flag already stored in this campaign. Choosing one copies the image to this polity's stable lineage; renaming the polity later will not detach it.", 0.55))
			if int(game_view.get("stored", 0)) == 0:
				_body.add_child(_note("No custom flags are stored in this campaign yet.", 0.35, 13))
			elif (game_view.get("choices", []) as Array).is_empty():
				_body.add_child(_note("No flags match “%s”." % query, 0.4, 13))
			else:
				var grid := _grid(width, 130.0)
				for item in game_view.get("choices", []):
					var choice: Dictionary = item
					var image_url := str(choice.get("imageUrl", ""))
					grid.add_child(_card_for(str(choice.get("file", "")), str(choice.get("label", "")), "", choice.get("selected", false), _apply.bind(image_url), grid.columns, width))
				_body.add_child(grid)
				if not str(game_view.get("more", "")).is_empty():
					_body.add_child(_note(str(game_view["more"]), 0.45))
		elif not pack.is_empty():
			var top := HBoxContainer.new()
			top.add_theme_constant_override("separation", 12)
			var back := _button("← Community")
			back.pressed.connect(func() -> void:
				pack = {}
				pack_flags = []
				pack_state = "idle"
				pack_error = ""
				query = ""
				_search.text = ""
				_build_tools()
				_render())
			top.add_child(back)
			var words := VBoxContainer.new()
			words.add_theme_constant_override("separation", 2)
			words.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			var heading := UI.label(str(pack.get("title", "")) if not str(pack.get("title", "")).is_empty() else "Scenario flag pack", 15, UI.WHITE, 800)
			heading.clip_text = true
			heading.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
			heading.custom_minimum_size.x = 1
			words.add_child(heading)
			var count := int(pack.get("flagCount", 0))
			var meta := ""
			if pack_state == "ready":
				meta = "%d custom flag%s" % [pack_flags.size(), "" if pack_flags.size() == 1 else "s"]
			elif count > 0:
				meta = "%d flag%s advertised" % [count, "" if count == 1 else "s"]
			else:
				meta = "Scenario flag pack"
			if not str(pack.get("author", "")).is_empty():
				meta += " · by %s" % str(pack["author"])
			words.add_child(UI.label(meta, 11, Color(1, 1, 1, 0.45)))
			top.add_child(words)
			_body.add_child(top)
			if pack_state == "loading":
				_body.add_child(_note("Loading this scenario's flags…", 0.45, 13))
			elif pack_state == "error":
				var problem := PanelContainer.new()
				problem.add_theme_stylebox_override("panel", UI.box(Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.1), Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.3), 8, 1, Vector4(13, 11, 13, 11)))
				var line := HBoxContainer.new()
				line.add_theme_constant_override("separation", 12)
				var said := UI.label(pack_error if not pack_error.is_empty() else "This flag pack could not be loaded.", 12, Color("#fca5a5"))
				said.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
				said.size_flags_horizontal = Control.SIZE_EXPAND_FILL
				said.custom_minimum_size.x = 1
				line.add_child(said)
				var retry := _button("Retry")
				retry.pressed.connect(_open_pack.bind(pack))
				line.add_child(retry)
				problem.add_child(line)
				_body.add_child(problem)
			elif pack_flags.is_empty():
				_body.add_child(_note("This scenario pack does not contain any custom flag images that can be selected individually.", 0.4, 13))
			else:
				var shown := _matching_pack_flags()
				if shown.is_empty():
					_body.add_child(_note("No flags match “%s”." % query, 0.4, 13))
				else:
					var grid := _grid(width, 145.0)
					for item in shown:
						var flag: Dictionary = item
						grid.add_child(_card_for(str(flag.get("file", "")), str(flag.get("code", "")), str(pack.get("title", "")) if not str(pack.get("title", "")).is_empty() else "Scenario flag pack", false, _apply.bind(str(flag.get("dataUrl", ""))), grid.columns, width))
					_body.add_child(grid)
		elif community_state == "loading":
			_body.add_child(_note("Loading community flags…", 0.45, 13))
		elif community_state == "error":
			_body.add_child(_note("Community flags could not be loaded.", 0.45, 13))
		elif community.is_empty():
			_body.add_child(_note("No community flags or scenario flag packs are available right now.", 0.4, 13))
		else:
			var shown := _matching_posts()
			if shown.is_empty():
				_body.add_child(_note("No flags match “%s”." % query, 0.4, 13))
			else:
				_body.add_child(_note("Choose a shared flag directly, or open a scenario flag pack to pick one of its flags without importing the scenario.", 0.55))
				var grid := _grid(width, 145.0)
				for item in shown:
					var post: Dictionary = item
					if post.get("fromScenario", false):
						grid.add_child(_pack_card(post, grid.columns, width))
					else:
						grid.add_child(_card_for(str(post.get("picture", "")), str(post.get("title", "")) if not str(post.get("title", "")).is_empty() else "Community flag", "by %s" % str(post["author"]) if not str(post.get("author", "")).is_empty() else "Community", false, _apply_community.bind(str(post.get("key", ""))), grid.columns, width))
				_body.add_child(grid)
		_fit()

	func _matching_posts() -> Array:
		var needle := query.strip_edges().to_lower()
		if needle.is_empty():
			return community
		var result: Array = []
		for item in community:
			if str((item as Dictionary).get("search", "")).contains(needle):
				result.append(item)
		return result

	func _matching_pack_flags() -> Array:
		var needle := query.strip_edges().to_lower()
		if needle.is_empty():
			return pack_flags
		var result: Array = []
		for item in pack_flags:
			if str((item as Dictionary).get("code", "")).to_lower().contains(needle):
				result.append(item)
		return result

	func _note(text: String, alpha: float, size := 12) -> Label:
		var node := UI.label(text, size, Color(1, 1, 1, alpha))
		node.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		node.custom_minimum_size.x = 1
		node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		return node

	func _grid(width: float, least: float) -> GridContainer:
		var grid := GridContainer.new()
		grid.columns = max(1, int(floor((width + 12.0) / (least + 12.0))))
		grid.add_theme_constant_override("h_separation", 12)
		grid.add_theme_constant_override("v_separation", 12)
		return grid

	func _card_for(file: String, label: String, meta: String, selected: bool, action: Callable, columns: int, width: float) -> Control:
		var cell_width := (width - 12.0 * (columns - 1)) / float(columns)
		var cell := Button.new()
		cell.focus_mode = Control.FOCUS_NONE
		cell.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		cell.custom_minimum_size.x = cell_width
		var style := UI.box(Color(0, 0, 0, 0.28) if selected else Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.28) if selected else Color(1, 1, 1, 0.1), 10, 1)
		var hover := UI.box(Color(1, 1, 1, 0.07), Color(1, 1, 1, 0.2), 10, 1)
		for state in [["normal", style], ["focus", style], ["disabled", style], ["hover", hover], ["pressed", hover], ["hover_pressed", hover]]:
			cell.add_theme_stylebox_override(state[0], state[1])
		var pad := MarginContainer.new()
		for entry in [["margin_left", 8], ["margin_right", 8], ["margin_top", 8], ["margin_bottom", 8]]:
			pad.add_theme_constant_override(entry[0], entry[1])
		pad.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var stack := VBoxContainer.new()
		stack.add_theme_constant_override("separation", 7)
		stack.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var picture_box := PanelContainer.new()
		picture_box.custom_minimum_size = Vector2(cell_width - 16.0, (cell_width - 16.0) * 2.0 / 3.0)
		picture_box.clip_contents = true
		picture_box.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0.25), Color(0, 0, 0, 0), 7, 0))
		picture_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var texture := _texture(file)
		if texture:
			var picture := TextureRect.new()
			picture.texture = texture
			picture.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
			picture.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
			picture.mouse_filter = Control.MOUSE_FILTER_IGNORE
			picture_box.add_child(picture)
		else:
			var none := UI.label("No preview", 11, Color(1, 1, 1, 0.3))
			none.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			none.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
			picture_box.add_child(none)
		stack.add_child(picture_box)
		var title := UI.label(label, 12, UI.WHITE, 700)
		title.clip_text = true
		title.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		title.custom_minimum_size.x = 1
		stack.add_child(title)
		if not meta.is_empty():
			var under := UI.label(meta, 11, Color(1, 1, 1, 0.45))
			under.clip_text = true
			under.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
			under.custom_minimum_size.x = 1
			stack.add_child(under)
		pad.add_child(stack)
		cell.add_child(pad)
		pad.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		cell.custom_minimum_size.y = stack.get_combined_minimum_size().y + 16.0
		cell.disabled = busy
		cell.pressed.connect(action)
		return cell

	func _pack_card(post: Dictionary, columns: int, width: float) -> Control:
		var count := int(post.get("flagCount", 0))
		var author := str(post.get("author", ""))
		var meta := ("%d flag%s" % [count, "" if count == 1 else "s"]) if count > 0 else "Scenario flag pack"
		if not author.is_empty():
			meta += " · by %s" % author
		var cell := _card_for(str(post.get("picture", "")), str(post.get("title", "")) if not str(post.get("title", "")).is_empty() else "Scenario flag pack", meta, false, _open_pack.bind(post), columns, width)
		var picture_box := (cell.get_child(0) as Control).get_child(0).get_child(0) as PanelContainer
		if picture_box and str(post.get("picture", "")).is_empty():
			for child in picture_box.get_children():
				child.queue_free()
			picture_box.add_theme_stylebox_override("panel", UI.box(Color(38 / 255.0, 38 / 255.0, 42 / 255.0, 0.9), Color(0, 0, 0, 0), 7, 0))
			var art := VBoxContainer.new()
			art.alignment = BoxContainer.ALIGNMENT_CENTER
			art.add_theme_constant_override("separation", 3)
			art.mouse_filter = Control.MOUSE_FILTER_IGNORE
			var glyph := UI.label("▦", 26, Color(1, 1, 1, 0.68))
			glyph.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			art.add_child(glyph)
			var words := UI.label("FLAG PACK", 10, Color(1, 1, 1, 0.68), 800, "Arial", 1)
			words.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			art.add_child(words)
			picture_box.add_child(art)
		if picture_box:
			var tag := PanelContainer.new()
			tag.add_theme_stylebox_override("panel", UI.box(Color(15 / 255.0, 23 / 255.0, 42 / 255.0, 0.9), Color(1, 1, 1, 0.23), 999, 1, Vector4(6, 3, 6, 3)))
			tag.mouse_filter = Control.MOUSE_FILTER_IGNORE
			tag.add_child(UI.label("PACK", 9, Color("#f4f4f5"), 800, "Arial", 1))
			var corner := Control.new()
			corner.mouse_filter = Control.MOUSE_FILTER_IGNORE
			corner.add_child(tag)
			tag.position = Vector2(picture_box.custom_minimum_size.x - 52.0, 7.0)
			picture_box.add_child(corner)
		return cell

	func _open_pack(post: Dictionary) -> void:
		pack = post
		pack_error = ""
		query = ""
		_search.text = ""
		pack_flags = []
		pack_state = "loading"
		_build_tools()
		_render()
		var reply: Dictionary = await engine.request("mapcards.flags.pack", {"key": str(post.get("key", ""))})
		if _closing or pack != post:
			return
		var result: Dictionary = reply.get("result", {}) if reply.get("ok", false) else {"ok": false, "error": str(reply.get("error", ""))}
		if result.get("ok", false):
			pack_flags = result.get("flags", [])
			pack_state = "ready"
		else:
			pack_state = "error"
			pack_error = str(result.get("error", "Could not load that scenario flag pack."))
		_render()

	func _apply(data_url: String, fallback := "Could not change the flag.") -> void:
		if busy:
			return
		busy = true
		error = ""
		_build_tools()
		var reply: Dictionary = await engine.request("mapcards.flags.apply", {"polity": polity, "dataUrl": data_url})
		busy = false
		var result: Dictionary = reply.get("result", {}) if reply.get("ok", false) else {"ok": false, "error": str(reply.get("error", ""))}
		if not result.get("ok", false):
			error = str(result.get("error", ""))
			if error.is_empty():
				error = fallback
		else:
			applied.emit()
		_build_tools()
		var view: Dictionary = await engine.request("mapcards.flags.view", {"polity": polity, "query": query if tab == "game" else ""})
		if view.get("ok", false):
			game_view = view.get("result", {})
		_render()

	func _apply_community(key: String) -> void:
		if busy:
			return
		busy = true
		error = ""
		_build_tools()
		var reply: Dictionary = await engine.request("mapcards.flags.community_apply", {"key": key, "polity": polity})
		busy = false
		var result: Dictionary = reply.get("result", {}) if reply.get("ok", false) else {"ok": false, "error": str(reply.get("error", ""))}
		if not result.get("ok", false):
			error = str(result.get("error", ""))
			if error.is_empty():
				error = "Could not install that community flag."
		else:
			applied.emit()
		_build_tools()
		var view: Dictionary = await engine.request("mapcards.flags.view", {"polity": polity, "query": ""})
		if view.get("ok", false):
			game_view = view.get("result", {})
		_render()

	func _upload(path: String) -> void:
		var extension := path.get_extension().to_lower()
		if not ["png", "jpg", "jpeg", "webp", "gif", "svg"].has(extension):
			error = "Use a PNG, JPEG, WEBP, GIF, or SVG image."
			_render()
			return
		var bytes := FileAccess.get_file_as_bytes(path)
		if bytes.is_empty():
			error = "Could not read that image."
			_render()
			return
		var image := Image.new()
		var loaded := ERR_FILE_UNRECOGNIZED
		match extension:
			"png":
				loaded = image.load_png_from_buffer(bytes)
			"jpg", "jpeg":
				loaded = image.load_jpg_from_buffer(bytes)
			"webp":
				loaded = image.load_webp_from_buffer(bytes)
			"svg":
				loaded = image.load_svg_from_buffer(bytes)
		if loaded != OK or image.is_empty():
			error = "Could not decode that image."
			_render()
			return
		var width := image.get_width()
		if width > 256:
			image.resize(256, max(1, int(round(image.get_height() * 256.0 / width))), Image.INTERPOLATE_LANCZOS)
		var png := image.save_png_to_buffer()
		await _apply("data:image/png;base64," + Marshalls.raw_to_base64(png), "Could not use that flag image.")
