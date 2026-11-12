class_name WorkshopMap
extends Control

signal baked_map
signal region_click(index: int, additive: bool)
signal region_double_click(index: int)
signal empty_click(additive: bool)
signal map_click(lonlat: Vector2, screen: Vector2, index: int)
signal point_click(kind: String, id: String, screen: Vector2)
signal delete_click(kind: String, id: String, index: int)
signal dissolve_click(index: int, neighbour: int)
signal paint_stroke(indices: PackedInt32Array)
signal lasso_done(ring: Array)
signal box_done(ids: PackedStringArray, additive: bool)
signal move_done(index: int, from: Vector2, to: Vector2)
signal move_started(index: int)
signal war_drawn(kind: String, coords: Array)
signal war_pick(kind: String, id: String)
signal war_reshaped(kind: String, id: String, geometry: Array)
signal view_moved
signal draw_point_requested(lonlat: Vector2, previous: Variant)
signal draw_finished(ring: Array)
signal vertex_edit(op: String, target: String, path: Array, index: int, lonlat: Vector2, alt: bool)
signal hover_moved(lonlat: Vector2)
signal scale_hover(from: Vector2, to: Vector2)
signal scale_drawn(from: Vector2, to: Vector2)

const NEUTRAL := Color8(130, 130, 138)
const ACCENT_STROKE := Color8(231, 231, 234)
const GROUP_TINT_ALPHA := 0.3
const FALLBACK_TYPE := {"id": "land", "opacity": 0.55, "unownedOpacity": 0.25, "zIndex": 1, "strokeWidth": 1.5, "strokeColor": [0, 0, 0], "strokeOpacity": 1.0, "zoomSettings": [{"minZoom": 0, "maxZoom": 24}]}
const PAINT_STROKE := Color(1, 1, 1, 0.88)
const PAINT_FILL_ERASE := Color(15 / 255.0, 23 / 255.0, 42 / 255.0, 0.72)
const PAINT_FILL_UNCOLOURED := Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.68)
const PAINT_FILL_ALPHA := 0.70
const LABEL_MIN_ZOOM := 4.0
const SKETCH_BLUE := Color8(0, 153, 255)
const SKETCH_FILL := Color(1, 1, 1, 0.5)
const BOX_FILL := Color(1, 1, 1, 0.75)
const WHEEL_DELTA_PER_ZOOM := 100.0
const WHEEL_MAX_DELTA := 2.0
const WHEEL_ZOOM_DURATION_MS := 180
const TRACKPAD_DELTA_PER_ZOOM := 300.0
const WHEEL_TIMEOUT_MS := 80
const ZOOM_DURATION_MS := 250
const BOX_ZOOM_DURATION_MS := 200
const KINETIC_DECAY := -0.005
const KINETIC_MIN_VELOCITY := 0.05
const KINETIC_DELAY_MS := 100
const KINETIC_DURATION_MS := 500
const BOX_ZOOM_TOOLS := ["select", "pan", "dissolve", "delete", "feature", "marker", "unit", "modify", "border", "move", "scale"]
const MARKER_GLYPHS := [
	["\\b(capital|city|town|settlement|metropolis|municipality)\\b", "●"],
	["\\b(military|army|naval|defen[cs]e|command|headquarters|hq|base|fort|fortress|bunker|silo|garrison|missile|radar|airfield|airbase|barracks|outpost|citadel|arsenal|testing range)\\b", "▲"],
	["\\b(lithium|resource|basin|mine|mining|deposit|oil ?field|gas ?field|coal ?field|ore ?field|quarry|well)\\b", "◆"],
	["\\b(port|harbou?r|terminal|logistics|rail|railway|station|airport|bridge|canal|corridor|transit|pipeline|grid|storage|hub)\\b", "■"],
	["\\b(factory|plant|works|industrial|manufactur|laborator|laboratory|research|science|scientific|technology|institute|university|energy|power|reactor)\\b", "✦"],
	["\\b(embassy|consulate|mission|secretariat|liaison|administration|diplomatic)\\b", "◇"],
]
const UNIT_GLYPH := {"infantry": "I", "armor": "A", "air": "✈", "naval": "N", "artillery": "R", "garrison": "G"}
const WORLD := 4096.0
const SCALE_INK := Color("#06222d")
const SCALE_BAR_PX := 9.0
const REVIEW_COLORS := {"pending": Color("#f59e0b"), "conflict": Color("#f97316"), "accepted": Color("#22c55e"), "rejected": Color(148 / 255.0, 163 / 255.0, 184 / 255.0, 0.75), "proposed": Color("#38bdf8")}

var map: MapView
var tool := "select"
var ids: PackedStringArray = []
var names: PackedStringArray = []
var centroids: PackedVector2Array = []
var areas: PackedFloat32Array = []
var index_of := {}
var fills: Array = []
var group_fills: Array = []
var type_index: Array = []
var type_keys: Array = []
var types_by_id := {}
var label_points: Array = []
var _painted := {}
var _band_key := ""
var _wheel_total := 0.0
var _wheel_started := -1
var _wheel_anchor := Vector2.ZERO
var _anim := {}
var _kinetic: Array = []
var _zoom_box: PanelContainer
var owner_index: Array = []
var owner_keys: Array = []
var selection := {}
var feature_selection := {}
var features: Array = []
var units: Array = []
var war := {}
var polity_colors := {}
var layers := {"regions": true, "labels": true, "groups": true, "features": true, "units": true, "fortifications": true, "freezing": true}
var show_terrain := false
var show_climate := false
var war_selected := {}
var review_tint := {}
var review_outlines: Array = []
var review_shapes: Array = []
var review_points: Array = []
var review_focus := {}
var draw_points: Array = []
var reference := {}
var scale_line := {}
var scale_sketch_label := ""
var _scale_start: Variant = null
var _scale_cursor := Vector2(-1, -1)
var reference_adjust := false
var _reference_drag := {}
var import_preview := {}
var snap_marker: Variant = null
var edit_rings: Array = []
var diagnostics: Array = []
var _edit_drag := {}
var _edit_hover := {}
var _halo: Variant = null
var paint_owner := ""
var paint_only := "*"
var paint_color := PAINT_FILL_ERASE
var ready_to_draw := false
var _container: SubViewportContainer
var _viewport: SubViewport
var _overlay: Overlay
var _drag := ""
var _drag_start := Vector2.ZERO
var _drag_last := Vector2.ZERO
var _drag_distance := 0.0
var _pressed_index := -1
var _stroke_visited := {}
var _stroke: PackedInt32Array = []
var _lasso: PackedVector2Array = []
var _box := Rect2()
var _sketch: Array = []
var _sketch_kind := ""
var _war_drag := {}
var _war_hover: Variant = null
var _freehand := PackedVector2Array()
var _move_line := PackedVector2Array()
var move_rings: Array = []
var region_overlays: WorkshopRegionOverlays
var striped := {}
var _dirty_fills := false
var _label_names := {}
var _last_view := Vector3.ZERO


func setup(tiles_cache: String) -> void:
	clip_contents = true
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_container = SubViewportContainer.new()
	_container.stretch = true
	_container.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_container.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_container)
	_viewport = SubViewport.new()
	_viewport.handle_input_locally = false
	_viewport.gui_disable_input = true
	_viewport.transparent_bg = false
	_viewport.size = Vector2i(1200, 800)
	_container.add_child(_viewport)
	map = MapView.new()
	_viewport.add_child(map)
	map.input_enabled = false
	map.editor_enable()
	region_overlays = WorkshopRegionOverlays.new()
	map.editor_set_top_layer(region_overlays)
	map.basemap.cache_dir = tiles_cache
	map.set_overlays_visible(false)
	map.baker.baked.connect(_on_baked_data)
	map.baked.connect(func(_info: Dictionary) -> void:
		map.set_overlays_visible(false)
		ready_to_draw = true
		baked_map.emit())
	_overlay = Overlay.new()
	_overlay.host = self
	_overlay.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_overlay.mouse_filter = Control.MOUSE_FILTER_STOP
	_overlay.focus_mode = Control.FOCUS_CLICK
	add_child(_overlay)
	_build_zoom_box()


func _build_zoom_box() -> void:
	_zoom_box = PanelContainer.new()
	_zoom_box.add_theme_stylebox_override("panel", UI.box(Color(18 / 255.0, 20 / 255.0, 26 / 255.0, 0.75), Color(1, 1, 1, 0.12), 8, 1, Vector4(4, 4, 4, 4)))
	_zoom_box.position = Vector2(12, 12)
	_zoom_box.mouse_filter = Control.MOUSE_FILTER_STOP
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 4)
	_zoom_box.add_child(column)
	for spec in [["+", "Zoom in", 1.0], ["–", "Zoom out", -1.0]]:
		var button := Button.new()
		button.text = str(spec[0])
		button.tooltip_text = str(spec[1])
		button.focus_mode = Control.FOCUS_NONE
		button.custom_minimum_size = Vector2(28, 28)
		button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		var idle := UI.box(Color(1, 1, 1, 0.08), Color(0, 0, 0, 0), 6, 0, Vector4(0, 0, 0, 0))
		var hover := UI.box(Color(1, 1, 1, 0.22), Color(0, 0, 0, 0), 6, 0, Vector4(0, 0, 0, 0))
		for state in ["normal", "focus", "disabled"]:
			button.add_theme_stylebox_override(state, idle)
		for state in ["hover", "pressed", "hover_pressed"]:
			button.add_theme_stylebox_override(state, hover)
		button.add_theme_font_override("font", UI.font(700))
		button.add_theme_font_size_override("font_size", 18)
		for state in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
			button.add_theme_color_override(state, Color(1, 1, 1))
		var delta := float(spec[2])
		button.pressed.connect(func() -> void: zoom_by(delta, Vector2(-1, -1), ZOOM_DURATION_MS))
		column.add_child(button)
	add_child(_zoom_box)


func load_regions(path: String) -> void:
	ready_to_draw = false
	map.load_regions(path)


func _on_baked_data(result: Dictionary) -> void:
	ids = result.get("ids", PackedStringArray())
	names = result.get("names", PackedStringArray())
	centroids = result.get("centroids", PackedVector2Array())
	areas = result.get("areas", PackedFloat32Array())
	index_of = {}
	for index in range(ids.size()):
		index_of[ids[index]] = index
	_label_names = {}


func set_names(overrides: Dictionary) -> void:
	_label_names = {}
	for key in overrides:
		_label_names[int(key)] = str(overrides[key])
	_overlay.queue_redraw()


func region_name(index: int) -> String:
	if _label_names.has(index):
		return str(_label_names[index])
	return names[index] if index >= 0 and index < names.size() else ""


func set_regions(part: Dictionary) -> void:
	if not ready_to_draw:
		return
	owner_index = part.get("ownerIndex", [])
	owner_keys = part.get("owners", [])
	fills = part.get("fills", [])
	group_fills = part.get("groupFills", [])
	type_index = part.get("typeIndex", [])
	type_keys = part.get("typeKeys", [])
	_painted = {}
	map.set_state({"owners": owner_index, "ownerNames": part.get("owners", []), "ownerColors": part.get("ownerColors", [])})
	set_names(part.get("names", {}))
	apply_fills()


func set_types(types: Array) -> void:
	var by_id := {}
	for entry in types:
		if entry is Dictionary:
			by_id[str((entry as Dictionary).get("id", ""))] = entry
	if by_id == types_by_id:
		return
	types_by_id = by_id
	_band_key = ""
	apply_fills()
	_overlay.queue_redraw()


func set_label_points(points: Array) -> void:
	label_points = points
	_overlay.queue_redraw()


func region_type(index: int) -> Dictionary:
	var at := int(type_index[index]) if index >= 0 and index < type_index.size() and type_index[index] != null else -1
	var key := str(type_keys[at]) if at >= 0 and at < type_keys.size() else "land"
	var found: Variant = types_by_id.get(key)
	return found if found is Dictionary else FALLBACK_TYPE


static func _number(row: Dictionary, key: String, fallback: float) -> float:
	var value: Variant = row.get(key)
	return float(value) if (value is float or value is int) else fallback


static func zoom_band(type: Dictionary, zoom: float) -> Variant:
	var bands: Variant = type.get("zoomSettings")
	if not (bands is Array) or (bands as Array).is_empty():
		return {}
	for entry in bands:
		var band: Dictionary = entry if entry is Dictionary else {}
		if zoom >= _number(band, "minZoom", 0.0) and zoom <= _number(band, "maxZoom", 24.0):
			return band
	return null


static func _rgb(value: Variant, fallback: Color) -> Color:
	if value is Array and (value as Array).size() >= 3:
		return Color8(int(value[0]), int(value[1]), int(value[2]))
	return fallback


static func _packed(value: int) -> Color:
	return Color8((value >> 16) & 255, (value >> 8) & 255, value & 255)


static func over(top: Color, bottom: Color) -> Color:
	var alpha := top.a + bottom.a * (1.0 - top.a)
	if alpha <= 0.0:
		return Color(bottom.r, bottom.g, bottom.b, 0.0)
	var mix := func(a: float, b: float) -> float: return (a * top.a + b * bottom.a * (1.0 - top.a)) / alpha
	return Color(mix.call(top.r, bottom.r), mix.call(top.g, bottom.g), mix.call(top.b, bottom.b), alpha)


func region_shown(index: int) -> bool:
	if index < 0 or index >= fills.size() or fills[index] == null or int(fills[index]) < 0:
		return false
	return zoom_band(region_type(index), ol_zoom()) != null


func region_look(index: int) -> Array:
	var hidden := [Color(0, 0, 0, 0), Color(0, 0, 0, 0), Color(0, 0, 0, 0)]
	var value := int(fills[index]) if index < fills.size() and fills[index] != null else -1
	if value < 0:
		return hidden
	var type := region_type(index)
	var found: Variant = zoom_band(type, ol_zoom())
	if found == null:
		return hidden
	var band: Dictionary = found
	var owned := index < owner_index.size() and owner_index[index] != null and int(owner_index[index]) >= 0
	var base := _packed(value)
	var alpha := _number(band, "opacity", _number(type, "opacity", 0.55)) if owned else _number(type, "unownedOpacity", 0.25)
	var tinted := base
	if review_tint.has(index):
		tinted = base.lerp(Color(review_tint[index], 1.0), 0.15)
	var fill := Color(tinted, alpha)
	var group := int(group_fills[index]) if index < group_fills.size() and group_fills[index] != null else -1
	if group >= 0:
		fill = over(Color(_packed(group), GROUP_TINT_ALPHA), fill)
	var stroke_opacity := _number(type, "strokeOpacity", 1.0)
	var stroke := Color(_rgb(type.get("strokeColor"), Color(0, 0, 0)), stroke_opacity)
	var width := _number(band, "strokeWidth", _number(type, "strokeWidth", 1.5))
	var state := 0.0
	if striped.has(index):
		fill.a = 0.0
	if selection.has(index):
		var a := clampf(alpha, 0.0, 1.0)
		var lifted := 0.0 if a >= 1.0 else maxf(0.0, 1.0 - (1.0 - minf(1.0, a + 0.22)) / (1.0 - a))
		if not striped.has(index):
			fill = over(Color(base, lifted), fill)
		stroke = Color(ACCENT_STROKE, stroke_opacity)
		width = maxf(2.25, width + 1.0)
		state = 1.0
	if _painted.has(index):
		fill = over(paint_color, fill)
		stroke = PAINT_STROKE
		width = 1.25
		state = 2.0
	return [fill, stroke, Color(width, _number(type, "zIndex", 1.0), state, 1.0)]


func fill_color(index: int) -> Color:
	return region_look(index)[0]


func _put(index: int) -> void:
	var look := region_look(index)
	map.editor_set_region_style(index, look[0], look[1], look[2])


func _band_signature() -> String:
	var zoom := ol_zoom()
	var parts: PackedStringArray = []
	for key in type_keys:
		var found: Variant = types_by_id.get(str(key))
		var band: Variant = zoom_band(found if found is Dictionary else FALLBACK_TYPE, zoom)
		parts.append("-" if band == null else JSON.stringify(band))
	return "|".join(parts)


func apply_fills() -> void:
	var count := mini(ids.size(), map.editor_region_count()) if ready_to_draw else 0
	if count <= 0:
		return
	_band_key = _band_signature()
	for index in range(count):
		_put(index)
	map.editor_commit_colors()
	set_regions_visible(bool(layers.get("regions", true)))


func set_regions_visible(on: bool) -> void:
	map.editor_set_regions_visible(on)
	sync_overlay_layers()


func sync_overlay_layers() -> void:
	if region_overlays == null:
		return
	region_overlays.show_regions = bool(layers.get("regions", true))
	region_overlays.show_groups = bool(layers.get("groups", true))
	region_overlays.show_freezing = bool(layers.get("freezing", true))
	region_overlays.refresh()


func set_selection(indices: Array) -> void:
	var before := selection.duplicate()
	selection = {}
	for index in indices:
		selection[int(index)] = true
	if not ready_to_draw or map.editor_region_count() <= 0:
		return
	var touched := {}
	for key in before:
		touched[key] = true
	for key in selection:
		touched[key] = true
	for key in touched:
		_put(int(key))
	map.editor_commit_colors()


func preview_paint(index: int) -> void:
	if not ready_to_draw:
		return
	_painted[index] = true
	_put(index)
	_dirty_fills = true


func _process(_delta: float) -> void:
	if _dirty_fills and map:
		_dirty_fills = false
		map.editor_commit_colors()
	if _wheel_started >= 0 and Time.get_ticks_msec() - _wheel_started >= WHEEL_TIMEOUT_MS:
		var levels := -clampf(_wheel_total, -WHEEL_MAX_DELTA * WHEEL_DELTA_PER_ZOOM, WHEEL_MAX_DELTA * WHEEL_DELTA_PER_ZOOM) / WHEEL_DELTA_PER_ZOOM
		var anchor := _wheel_anchor
		_wheel_total = 0.0
		_wheel_started = -1
		zoom_by(levels, anchor, WHEEL_ZOOM_DURATION_MS)
	if not _anim.is_empty():
		_step_animation()
	if ready_to_draw and not type_keys.is_empty() and _band_signature() != _band_key:
		apply_fills()
	if map and map.camera and _overlay:
		var view := Vector3(map.camera.position.x, map.camera.position.y, map.camera.zoom.x)
		if view != _last_view:
			_last_view = view
			region_overlays.set_zoom(map.camera.zoom.x)
			_overlay.queue_redraw()


func redraw() -> void:
	if _overlay:
		_overlay.queue_redraw()


func screen_to_world(point: Vector2) -> Vector2:
	var half := Vector2(_viewport.size) * 0.5
	return map.camera.position + (point - half) / map.camera.zoom.x


func world_to_lonlat(world: Vector2) -> Vector2:
	var x := fposmod(world.x, WORLD)
	var lon := x / WORLD * 360.0 - 180.0
	var n := PI - 2.0 * PI * world.y / WORLD
	var lat := rad_to_deg(atan(sinh(n)))
	return Vector2(lon, lat)


func lonlat_to_world(lonlat: Vector2) -> Vector2:
	return MapView.CityLayer.ohproject(lonlat.x, lonlat.y)


func screen_of(lonlat: Vector2) -> Vector2:
	return map.world_to_screen(lonlat_to_world(lonlat))


func pick(point: Vector2) -> int:
	if not ready_to_draw:
		return -1
	var index := int(map.baker.pick(screen_to_world(point)))
	if index >= 0 and not type_keys.is_empty() and not region_shown(index):
		return -1
	return index


func ol_zoom() -> float:
	return map.zoom_level() + 1.0


func meters_per_pixel() -> float:
	return 40075016.68557849 / (WORLD * map.camera.zoom.x)


func fit_bounds(bounds: Array, max_level := 8.0, duration := 0.35) -> void:
	if bounds.size() < 2 or not ready_to_draw:
		return
	var south_west: Array = bounds[0]
	var north_east: Array = bounds[1]
	var west := float(south_west[0])
	var east := float(north_east[0])
	if east < west:
		east += 360.0
	var top_left := lonlat_to_world(Vector2(west, float(north_east[1])))
	var bottom_right := lonlat_to_world(Vector2(east, float(south_west[1])))
	if east > 180.0:
		bottom_right.x = (east + 180.0) / 360.0 * WORLD
	var view := Vector2(_viewport.size)
	var span := (bottom_right - top_left).abs()
	var fit := minf((view.x - 160.0) / maxf(span.x, 0.0001), (view.y - 160.0) / maxf(span.y, 0.0001))
	var zoom := minf(maxf(fit, 0.0001), pow(2.0, max_level) / 16.0)
	_animate((top_left + bottom_right) * 0.5, zoom, int(duration * 1000.0), false)


func locate(lonlat: Vector2, ol_level := 6.0, duration_ms := 0) -> void:
	_animate(lonlat_to_world(lonlat), pow(2.0, ol_level) / 16.0, duration_ms, false)


func start_view() -> void:
	map.editor_set_view(lonlat_to_world(Vector2(0, 20)), pow(2.0, 2.1) / 16.0)


func _pan(delta: Vector2) -> void:
	map.editor_pan(delta)
	_overlay.queue_redraw()
	view_moved.emit()


func _zoom(point: Vector2, factor: float) -> void:
	_anim = {}
	map.editor_zoom_at(point, factor)
	_overlay.queue_redraw()
	view_moved.emit()


func zoom_by(levels: float, anchor: Vector2, duration_ms: int) -> void:
	if not ready_to_draw or levels == 0.0:
		return
	var target := clampf(map.camera.zoom.x * pow(2.0, levels), map.zoom_floor(), map.zoom_ceiling())
	_animate(map.camera.position, target, duration_ms, true, anchor)


func _animate(center: Vector2, zoom: float, duration_ms: int, ease_out: bool, anchor := Vector2(-1, -1)) -> void:
	_anim = {}
	var target_zoom := clampf(zoom, map.zoom_floor(), map.zoom_ceiling())
	var from := map.camera.position
	var to := center
	to.x += WORLD * round((from.x - to.x) / WORLD)
	if duration_ms <= 0:
		if anchor.x >= 0.0:
			var held := screen_to_world(anchor)
			to = held - (anchor - Vector2(_viewport.size) * 0.5) / target_zoom
		map.editor_set_view(to, target_zoom)
		_after_view()
		return
	_anim = {"start": Time.get_ticks_msec(), "duration": float(duration_ms), "from": from, "to": to, "from_res": 1.0 / map.camera.zoom.x, "to_res": 1.0 / target_zoom, "ease_out": ease_out, "anchor": anchor, "held": screen_to_world(anchor) if anchor.x >= 0.0 else Vector2.ZERO}


func _step_animation() -> void:
	var t := clampf(float(Time.get_ticks_msec() - int(_anim["start"])) / float(_anim["duration"]), 0.0, 1.0)
	var e := 1.0 - pow(1.0 - t, 3.0) if bool(_anim["ease_out"]) else t * t * (3.0 - 2.0 * t)
	var zoom := 1.0 / lerpf(float(_anim["from_res"]), float(_anim["to_res"]), e)
	var anchor: Vector2 = _anim["anchor"]
	var center: Vector2 = (_anim["from"] as Vector2).lerp(_anim["to"], e)
	if anchor.x >= 0.0:
		center = (_anim["held"] as Vector2) - (anchor - Vector2(_viewport.size) * 0.5) / zoom
	if t >= 1.0:
		_anim = {}
	map.editor_set_view(center, zoom)
	_after_view()


func _after_view() -> void:
	_overlay.queue_redraw()
	view_moved.emit()


func _kinetic_glide() -> void:
	var now := Time.get_ticks_msec()
	var count := _kinetic.size()
	if count < 2:
		return
	var last: Array = _kinetic[count - 1]
	if int(last[2]) < now - KINETIC_DELAY_MS:
		return
	var first := count - 2
	while first > 0 and int((_kinetic[first] as Array)[2]) > now - KINETIC_DELAY_MS:
		first -= 1
	var start: Array = _kinetic[first]
	var duration := float(int(last[2]) - int(start[2]))
	if duration < 1000.0 / 60.0:
		return
	var moved := Vector2(float(last[0]) - float(start[0]), float(last[1]) - float(start[1]))
	var velocity := moved.length() / duration
	if velocity <= KINETIC_MIN_VELOCITY:
		return
	var distance := (KINETIC_MIN_VELOCITY - velocity) / KINETIC_DECAY
	var target := map.camera.position - moved.normalized() * distance / map.camera.zoom.x
	_animate(target, map.camera.zoom.x, KINETIC_DURATION_MS, true)


func neighbour_of(point: Vector2, index: int) -> int:
	for offset in [Vector2(9, 0), Vector2(-9, 0), Vector2(0, 9), Vector2(0, -9), Vector2(7, 7), Vector2(-7, 7), Vector2(7, -7), Vector2(-7, -7), Vector2(14, 0), Vector2(-14, 0), Vector2(0, 14), Vector2(0, -14)]:
		var other := pick(point + offset)
		if other >= 0 and other != index:
			return other
	return -1


func point_at(point: Vector2, kinds: Array, tolerance := 8.0) -> Dictionary:
	if kinds.has("unit"):
		for unit in units:
			var row: Dictionary = unit
			var screen := screen_of(Vector2(float(row.get("lng", 0)), float(row.get("lat", 0))))
			if screen.distance_to(point) <= 10.0:
				return {"kind": "unit", "id": str(row.get("id", ""))}
	if kinds.has("feature"):
		var best := {}
		var best_distance := tolerance + 1.0
		for feature in features:
			var row: Dictionary = feature
			var coord: Variant = row.get("coord")
			if not (coord is Array) or (coord as Array).size() < 2:
				continue
			if not _feature_shown(row) and not feature_selection.has(str(row.get("id", ""))):
				continue
			var screen := screen_of(Vector2(float(coord[0]), float(coord[1])))
			var distance := screen.distance_to(point)
			if distance <= tolerance and distance < best_distance:
				best = {"kind": "feature", "id": str(row.get("id", ""))}
				best_distance = distance
		if not best.is_empty():
			return best
	return {}


func war_shape_near(point: Vector2, kinds: Array) -> Dictionary:
	var reach := 8.0
	for kind in kinds:
		var key := "terrainAreas" if kind == "terrain" else "fortifications" if kind == "fortification" else "climateZones"
		if kind == "terrain" and not show_terrain:
			continue
		if kind == "climate" and not show_climate:
			continue
		if kind == "fortification" and not layers.get("fortifications", true):
			continue
		for shape in war.get(key, []):
			var row: Dictionary = shape
			for line in _shape_lines(kind, row):
				var poly: PackedVector2Array = line
				for at in range(poly.size() - 1):
					if Geometry2D.get_closest_point_to_segment(point, poly[at], poly[at + 1]).distance_to(point) <= reach:
						return {"kind": kind, "id": str(row.get("id", ""))}
	return {}


func _shape_lines(kind: String, row: Dictionary) -> Array:
	var out: Array = []
	if kind == "fortification":
		var line := PackedVector2Array()
		for point in row.get("points", []):
			var p: Array = point
			line.append(screen_of(Vector2(float(p[0]), float(p[1]))))
		out.append(line)
		return out
	for ring in row.get("rings", []):
		var line := PackedVector2Array()
		for point in ring:
			var p: Array = point
			line.append(screen_of(Vector2(float(p[0]), float(p[1]))))
		if line.size() > 0:
			line.append(line[0])
		out.append(line)
	return out


func _feature_shown(row: Dictionary) -> bool:
	if not layers.get("features", true):
		return false
	var zoom := ol_zoom()
	var tags: Array = row.get("tags", [])
	if bool(row.get("isMap", false)):
		return zoom >= 3.0
	var pop := float(row.get("population", 0))
	var large := tags.has("capital") or pop >= 1000000.0
	var mid := pop >= 100000.0
	return large or (mid and zoom >= 3.5) or zoom >= 5.0


func _war_key(kind: String) -> String:
	return "terrainAreas" if kind == "terrain" else "fortifications" if kind == "fortification" else "climateZones"


func _war_row(kind: String, id: String) -> Dictionary:
	for shape in war.get(_war_key(kind), []):
		if str((shape as Dictionary).get("id", "")) == id:
			return shape
	return {}


func _war_lists(kind: String, row: Dictionary) -> Array:
	if kind == "fortification":
		return [row.get("points", [])]
	return row.get("rings", [])


func _war_handle(point: Vector2) -> Dictionary:
	var kind := str(war_selected.get("kind", ""))
	if kind != tool or not _sketch.is_empty():
		return {}
	var id := str(war_selected.get("id", ""))
	var row := _war_row(kind, id)
	if row.is_empty():
		return {}
	var lists := _war_lists(kind, row)
	for at in range(lists.size()):
		var list: Array = lists[at]
		for index in range(list.size()):
			var coord: Array = list[index]
			var screen := screen_of(Vector2(float(coord[0]), float(coord[1])))
			if screen.distance_to(point) <= 12.0:
				return {"kind": kind, "id": id, "list": at, "index": index, "insert": false, "screen": screen}
	for at in range(lists.size()):
		var list: Array = lists[at]
		for index in range(list.size() - 1):
			var a: Array = list[index]
			var b: Array = list[index + 1]
			var closest := Geometry2D.get_closest_point_to_segment(point, screen_of(Vector2(float(a[0]), float(a[1]))), screen_of(Vector2(float(b[0]), float(b[1]))))
			if closest.distance_to(point) <= 12.0:
				return {"kind": kind, "id": id, "list": at, "index": index + 1, "insert": true, "screen": closest}
	return {}


func _move_war_vertex(point: Vector2) -> void:
	var kind := str(_war_drag.get("kind", ""))
	var row := _war_row(kind, str(_war_drag.get("id", "")))
	if row.is_empty():
		return
	var list: Array = _war_lists(kind, row)[int(_war_drag["list"])]
	var index := int(_war_drag["index"])
	var lonlat := world_to_lonlat(screen_to_world(point))
	var coord := [lonlat.x, lonlat.y]
	list[index] = coord
	if kind != "fortification" and list.size() > 1:
		if index == 0:
			list[list.size() - 1] = coord.duplicate()
		elif index == list.size() - 1:
			list[0] = coord.duplicate()
	_war_hover = point
	_overlay.queue_redraw()


func _lean(points: PackedVector2Array) -> PackedVector2Array:
	var tolerance := 1.5 / map.camera.zoom.x
	var kept := points
	while kept.size() > 1500 and tolerance < 1e7:
		kept = _simplify_path(points, tolerance)
		tolerance *= 2.0
	return kept


func _simplify_path(points: PackedVector2Array, tolerance: float) -> PackedVector2Array:
	if points.size() < 3:
		return points
	var keep := PackedByteArray()
	keep.resize(points.size())
	keep[0] = 1
	keep[points.size() - 1] = 1
	var spans: Array = [[0, points.size() - 1]]
	while not spans.is_empty():
		var span: Array = spans.pop_back()
		var first := int(span[0])
		var last := int(span[1])
		var worst := -1
		var worst_distance := tolerance
		for index in range(first + 1, last):
			var distance := Geometry2D.get_closest_point_to_segment(points[index], points[first], points[last]).distance_to(points[index])
			if distance > worst_distance:
				worst_distance = distance
				worst = index
		if worst >= 0:
			keep[worst] = 1
			spans.append([first, worst])
			spans.append([worst, last])
	var out := PackedVector2Array()
	for index in range(points.size()):
		if keep[index] == 1:
			out.append(points[index])
	return out


func _finish_freehand() -> void:
	var kind := tool
	var screens := _freehand
	_freehand = PackedVector2Array()
	_overlay.queue_redraw()
	if not kind in ["terrain", "fortification", "climate"]:
		return
	var worlds := PackedVector2Array()
	for point in screens:
		worlds.append(screen_to_world(point))
	worlds = _lean(worlds)
	var coords: Array = []
	for world in worlds:
		var lonlat := world_to_lonlat(world)
		coords.append([lonlat.x, lonlat.y])
	if kind == "fortification":
		if coords.size() >= 2:
			war_drawn.emit(kind, coords)
	elif coords.size() >= 3:
		coords.append((coords[0] as Array).duplicate())
		war_drawn.emit(kind, [coords])


func _commit_sketch() -> void:
	if _sketch_kind.is_empty():
		return
	var kind := _sketch_kind
	var points: Array = _sketch.duplicate()
	_sketch = []
	_sketch_kind = ""
	_overlay.queue_redraw()
	if kind == "fortification":
		if points.size() >= 2:
			war_drawn.emit(kind, points)
	elif points.size() >= 3:
		var ring: Array = points.duplicate()
		ring.append(points[0])
		war_drawn.emit(kind, [ring])


func abort_sketch() -> bool:
	if _scale_start != null:
		_scale_start = null
		scale_sketch_label = ""
		_overlay.queue_redraw()
		return true
	if not draw_points.is_empty():
		draw_points = []
		snap_marker = null
		_overlay.queue_redraw()
		return true
	if _sketch.is_empty():
		return false
	_sketch = []
	_sketch_kind = ""
	_overlay.queue_redraw()
	return true


func undo_sketch_point() -> bool:
	if not draw_points.is_empty():
		draw_points.pop_back()
		_overlay.queue_redraw()
		return true
	if _sketch.is_empty():
		return false
	_sketch.pop_back()
	if _sketch.is_empty():
		_sketch_kind = ""
	_overlay.queue_redraw()
	return true


func is_sketching() -> bool:
	return not _sketch.is_empty() or not draw_points.is_empty()


func add_draw_points(points: Array) -> void:
	for point in points:
		if point is Array and (point as Array).size() >= 2:
			draw_points.append([float(point[0]), float(point[1])])
	_overlay.queue_redraw()


func set_reference(texture: Texture2D, aspect: float) -> void:
	var width := _viewport.size.x / map.camera.zoom.x * 0.6
	var height := width / (aspect if aspect > 0.0 else 1.5)
	var centre := map.camera.position
	var crisp := CanvasTexture.new()
	crisp.diffuse_texture = texture
	crisp.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	reference = {"texture": texture, "crisp": crisp, "aspect": aspect, "rect": Rect2(centre - Vector2(width, height) * 0.5, Vector2(width, height)), "opacity": float(reference.get("opacity", 0.5)), "visible": bool(reference.get("visible", true)), "locked": null}
	var basemap := map.basemap
	var picture_aspect := float(basemap.get("picture_aspect")) if basemap else 0.0
	if picture_aspect > 0.0 and aspect > 0.0 and absf(aspect / picture_aspect - 1.0) < 0.01:
		reference["rect"] = basemap.get("picture_rect")
		reference["locked"] = true
	_overlay.queue_redraw()


func center_reference() -> void:
	if reference.is_empty():
		return
	var rect: Rect2 = reference["rect"]
	var width := _viewport.size.x / map.camera.zoom.x * 0.6
	var aspect := float(reference.get("aspect", 1.5))
	var height := width / (aspect if aspect > 0.0 else 1.5)
	rect = Rect2(map.camera.position - Vector2(width, height) * 0.5, Vector2(width, height))
	reference["rect"] = rect
	_overlay.queue_redraw()


func set_import_preview(texture: Texture2D, bounds: Dictionary, opacity: float) -> void:
	import_preview = {"texture": texture, "bounds": bounds, "opacity": opacity}
	_overlay.queue_redraw()


func clear_import_preview() -> void:
	if import_preview.is_empty():
		return
	import_preview = {}
	_overlay.queue_redraw()


func _draw_import_preview(canvas: Control) -> void:
	if import_preview.is_empty() or not (import_preview.get("texture") is Texture2D):
		return
	var texture: Texture2D = import_preview["texture"]
	var bounds: Dictionary = import_preview["bounds"]
	var west := float(bounds.get("west", -180.0))
	var east := float(bounds.get("east", 180.0))
	var north := clampf(float(bounds.get("north", 85.05112878)), -85.05112878, 85.05112878)
	var south := clampf(float(bounds.get("south", -85.05112878)), -85.05112878, 85.05112878)
	if not (east > west and north > south):
		return
	var tint := Color(1, 1, 1, clampf(float(import_preview.get("opacity", 0.46)), 0.05, 0.95))
	var columns := 24
	var rows := 48
	var grid: Array[PackedVector2Array] = []
	for row in range(rows + 1):
		var line := PackedVector2Array()
		var lat := north - (north - south) * float(row) / rows
		for column in range(columns + 1):
			line.append(screen_of(Vector2(west + (east - west) * float(column) / columns, lat)))
		grid.append(line)
	var colors := PackedColorArray([tint, tint, tint, tint])
	for row in range(rows):
		var top := float(row) / rows
		var bottom := float(row + 1) / rows
		for column in range(columns):
			var left := float(column) / columns
			var right := float(column + 1) / columns
			var points := PackedVector2Array([grid[row][column], grid[row][column + 1], grid[row + 1][column + 1], grid[row + 1][column]])
			var uvs := PackedVector2Array([Vector2(left, top), Vector2(right, top), Vector2(right, bottom), Vector2(left, bottom)])
			canvas.draw_primitive(points, colors, uvs, texture)


func _reference_corners() -> Array:
	var rect: Rect2 = reference.get("rect", Rect2())
	return [rect.position + Vector2(0, rect.size.y), rect.position + rect.size, rect.position + Vector2(rect.size.x, 0), rect.position]


func reference_locked() -> bool:
	return not reference.is_empty() and reference.get("locked") == true


func _reference_grab(point: Vector2) -> Dictionary:
	if reference.is_empty() or reference_locked():
		return {}
	var corners := _reference_corners()
	for index in range(corners.size()):
		if map.world_to_screen(corners[index]).distance_to(point) <= 12.0:
			return {"mode": "resize", "index": index}
	var rect: Rect2 = reference["rect"]
	var world := screen_to_world(point)
	var inside := world.x >= rect.position.x and world.x <= rect.end.x and world.y >= rect.position.y and world.y <= rect.end.y
	return {"mode": "move"} if inside else {}


func _reference_press(point: Vector2) -> bool:
	var grab := _reference_grab(point)
	if grab.is_empty():
		return false
	var rect: Rect2 = reference["rect"]
	if str(grab["mode"]) == "move":
		_reference_drag = {"mode": "move", "last": screen_to_world(point)}
	else:
		_reference_drag = {"mode": "resize", "anchor": _reference_corners()[(int(grab["index"]) + 2) % 4], "aspect": rect.size.x / maxf(rect.size.y, 0.000001)}
	return true


func _reference_move(point: Vector2, shift := false) -> void:
	if _reference_drag.is_empty() or reference.is_empty():
		return
	var world := screen_to_world(point)
	var rect: Rect2 = reference["rect"]
	if str(_reference_drag.get("mode", "")) == "move":
		var last: Vector2 = _reference_drag["last"]
		rect.position += world - last
		_reference_drag["last"] = world
	else:
		var anchor: Vector2 = _reference_drag["anchor"]
		var least := 8.0 / map.camera.zoom.x
		var width := maxf(absf(world.x - anchor.x), least)
		var height := maxf(absf(world.y - anchor.y), least)
		if shift:
			var keep := float(_reference_drag.get("aspect", 1.0))
			if width / height > keep:
				width = height * keep
			else:
				height = width / keep
		var far := Vector2(anchor.x + (width if world.x >= anchor.x else -width), anchor.y + (height if world.y >= anchor.y else -height))
		rect = Rect2(Vector2(minf(anchor.x, far.x), minf(anchor.y, far.y)), Vector2(width, height))
	reference["rect"] = rect
	_overlay.queue_redraw()


func _draw_reference(canvas: Control) -> void:
	if reference.is_empty():
		return
	var rect: Rect2 = reference["rect"]
	var top_left := map.world_to_screen(rect.position)
	var bottom_right := map.world_to_screen(rect.position + rect.size)
	var area := Rect2(top_left, bottom_right - top_left)
	if bool(reference.get("visible", true)) and reference.get("texture") is Texture2D:
		var picture: Texture2D = reference["texture"]
		var shown: Texture2D = reference["crisp"] if reference.get("crisp") is Texture2D and absf(area.size.x) > picture.get_width() else picture
		canvas.draw_texture_rect(shown, area, false, Color(1, 1, 1, clampf(float(reference.get("opacity", 0.5)), 0.0, 1.0)))
	if not reference_adjust:
		return
	var frame := PackedVector2Array([area.position, area.position + Vector2(area.size.x, 0), area.position + area.size, area.position + Vector2(0, area.size.y), area.position])
	_dashed(canvas, frame, Color("#22d3ee"), 1.5, 6.0)
	if reference_locked():
		return
	for corner in [area.position, area.position + Vector2(area.size.x, 0), area.position + area.size, area.position + Vector2(0, area.size.y)]:
		var at: Vector2 = corner
		var diamond := PackedVector2Array([at + Vector2(0, -7), at + Vector2(7, 0), at + Vector2(0, 7), at + Vector2(-7, 0)])
		canvas.draw_colored_polygon(diamond, Color("#22d3ee"))
		diamond.append(diamond[0])
		canvas.draw_polyline(diamond, Color("#083344"), 1.5, true)


func _finish_draw() -> void:
	if draw_points.size() < 3:
		return
	var ring: Array = draw_points.duplicate(true)
	draw_points = []
	snap_marker = null
	_overlay.queue_redraw()
	draw_finished.emit(ring)


func _edit_reach() -> float:
	return 24.0 if tool == "border" else 18.0


func _edit_hit(point: Vector2) -> Dictionary:
	var reach := _edit_reach()
	var best := {}
	var best_distance := reach + 1.0
	for entry in edit_rings:
		var row: Dictionary = entry
		var coords: Array = row.get("coords", [])
		for index in range(maxi(0, coords.size() - 1)):
			var c: Array = coords[index]
			var at := screen_of(Vector2(float(c[0]), float(c[1])))
			var distance := at.distance_to(point)
			if distance <= reach and distance < best_distance:
				best_distance = distance
				best = {"op": "move", "target": str(row.get("id", "")), "path": row.get("path", []), "index": index, "screen": at}
	if not best.is_empty():
		return best
	best_distance = reach + 1.0
	for entry in edit_rings:
		var row: Dictionary = entry
		var coords: Array = row.get("coords", [])
		for index in range(maxi(0, coords.size() - 1)):
			var a: Array = coords[index]
			var b: Array = coords[index + 1]
			var sa := screen_of(Vector2(float(a[0]), float(a[1])))
			var sb := screen_of(Vector2(float(b[0]), float(b[1])))
			var near := Geometry2D.get_closest_point_to_segment(point, sa, sb)
			var distance := near.distance_to(point)
			if distance <= reach and distance < best_distance:
				best_distance = distance
				best = {"op": "insert", "target": str(row.get("id", "")), "path": row.get("path", []), "index": index, "screen": near}
	return best


func _ring_screen(row: Dictionary) -> PackedVector2Array:
	var out := PackedVector2Array()
	for c in row.get("coords", []):
		out.append(screen_of(Vector2(float(c[0]), float(c[1]))))
	return out


func _shared_halo(point: Vector2) -> Variant:
	if tool != "border":
		return null
	var ids: Array = []
	for entry in edit_rings:
		var id := str((entry as Dictionary).get("id", ""))
		if not ids.has(id):
			ids.append(id)
	if ids.size() != 2:
		return null
	var reach := _edit_reach()
	var hits: Array = []
	for id in ids:
		var best: Variant = null
		var best_distance := INF
		for entry in edit_rings:
			var row: Dictionary = entry
			if str(row.get("id", "")) != id:
				continue
			var line := _ring_screen(row)
			for index in range(line.size() - 1):
				var near := Geometry2D.get_closest_point_to_segment(point, line[index], line[index + 1])
				var distance := near.distance_to(point)
				if distance < best_distance:
					best_distance = distance
					best = near
		if best == null or best_distance > reach:
			return null
		hits.append(best)
	return ((hits[0] as Vector2) + (hits[1] as Vector2)) * 0.5


func _handle(event: InputEvent) -> void:
	if not ready_to_draw:
		return
	if event is InputEventMouseButton:
		var button := event as InputEventMouseButton
		if (button.button_index == MOUSE_BUTTON_WHEEL_UP or button.button_index == MOUSE_BUTTON_WHEEL_DOWN) and button.pressed:
			_wheel(button)
			return
		if button.button_index == MOUSE_BUTTON_RIGHT or button.button_index == MOUSE_BUTTON_MIDDLE:
			if button.pressed:
				_anim = {}
				_kinetic = [[button.position.x, button.position.y, Time.get_ticks_msec()]]
				_drag = "pan"
			elif _drag == "pan":
				_drag = ""
				_kinetic_glide()
			_drag_last = button.position
			return
		if button.button_index != MOUSE_BUTTON_LEFT:
			return
		if button.pressed:
			_press(button)
		else:
			_release(button)
	elif event is InputEventMouseMotion:
		var motion := event as InputEventMouseMotion
		_motion(motion)
	elif event is InputEventMagnifyGesture:
		var magnify := event as InputEventMagnifyGesture
		_zoom(magnify.position, magnify.factor)
	elif event is InputEventPanGesture:
		var gesture := event as InputEventPanGesture
		_anim = {}
		map.editor_zoom_at(gesture.position, pow(2.0, -gesture.delta.y * 12.0 / TRACKPAD_DELTA_PER_ZOOM))
		_after_view()


func _wheel(button: InputEventMouseButton) -> void:
	var notches := button.factor if button.factor > 0.0 else 1.0
	var delta := (-100.0 if button.button_index == MOUSE_BUTTON_WHEEL_UP else 100.0) * notches
	if absf(delta) < 4.0:
		_anim = {}
		map.editor_zoom_at(button.position, pow(2.0, -delta / TRACKPAD_DELTA_PER_ZOOM))
		_after_view()
		return
	if _wheel_started < 0:
		_wheel_started = Time.get_ticks_msec()
	_wheel_total += delta
	_wheel_anchor = button.position


func _press(button: InputEventMouseButton) -> void:
	_drag_start = button.position
	_drag_last = button.position
	_drag_distance = 0.0
	_anim = {}
	_kinetic = [[button.position.x, button.position.y, Time.get_ticks_msec()]]
	if reference_adjust and _reference_press(button.position):
		_drag = "reference"
		return
	if button.double_click:
		_drag = ""
		if tool == "scale":
			_drag = "click"
			return
		if tool == "draw":
			_finish_draw()
			return
		if tool in ["terrain", "fortification", "climate"]:
			_commit_sketch()
			return
		if tool == "lasso":
			return
		if tool == "select":
			var hit := pick(button.position)
			if hit >= 0:
				region_double_click.emit(hit)
				return
		zoom_by(-1.0 if button.shift_pressed else 1.0, button.position, ZOOM_DURATION_MS)
		return
	if button.shift_pressed and tool in BOX_ZOOM_TOOLS:
		var blocked := false
		if tool in ["modify", "border"]:
			blocked = not _edit_hit(button.position).is_empty()
		elif tool == "move":
			blocked = pick(button.position) >= 0
		if not blocked:
			_drag = "zoombox"
			_box = Rect2(button.position, Vector2.ZERO)
			return
	match tool:
		"paint":
			_drag = "paint"
			_stroke_visited = {}
			_stroke = PackedInt32Array()
			_touch(button.position)
		"lasso":
			_drag = "lasso"
			_lasso = PackedVector2Array([button.position])
		"feature-box":
			_drag = "box"
			_box = Rect2(button.position, Vector2.ZERO)
		"modify", "border":
			var handle := _edit_hit(button.position)
			if handle.is_empty():
				_drag = "click"
			else:
				_edit_drag = handle.duplicate()
				_edit_drag["alt"] = button.alt_pressed
				_edit_drag["start"] = button.position
				_edit_drag["now"] = button.position
				_drag = "vertex"
		"terrain", "fortification", "climate":
			if button.shift_pressed and _sketch.is_empty():
				_drag = "freehand"
				_freehand = PackedVector2Array([button.position])
				return
			var handle := _war_handle(button.position)
			if handle.is_empty():
				_drag = "click"
				return
			var row := _war_row(str(handle["kind"]), str(handle["id"]))
			var list: Array = _war_lists(str(handle["kind"]), row)[int(handle["list"])]
			if bool(handle.get("insert", false)):
				var lonlat := world_to_lonlat(screen_to_world(handle["screen"]))
				list.insert(int(handle["index"]), [lonlat.x, lonlat.y])
			_war_drag = handle
			_drag = "war_vertex"
		"move":
			var hit := pick(button.position)
			if hit >= 0:
				_drag = "move"
				_pressed_index = hit
				_move_line = PackedVector2Array([button.position, button.position])
				move_rings = []
				move_started.emit(hit)
			else:
				_drag = "click"
		_:
			_drag = "click"


func _draw_move_preview(canvas: Control) -> void:
	var offset := _move_line[1] - _move_line[0]
	for entry in move_rings:
		var ring: Array = (entry as Dictionary).get("coords", [])
		if ring.size() < 3:
			continue
		var points := PackedVector2Array()
		for coord in ring:
			points.append(screen_of(Vector2(float(coord[0]), float(coord[1]))) + offset)
		var fill := Geometry2D.triangulate_polygon(points)
		if fill.size() >= 3:
			var colors := PackedColorArray()
			colors.resize(points.size())
			colors.fill(Color(1, 1, 1, 0.18))
			canvas.draw_polygon(points, colors)
		points.append(points[0])
		canvas.draw_polyline(points, Color(1, 1, 1, 0.9), 1.5, true)


func _update_cursor(point: Vector2) -> void:
	var shape := Control.CURSOR_ARROW
	if tool in ["lasso", "draw", "modify", "border", "paint", "feature-box", "terrain", "fortification", "climate"]:
		shape = Control.CURSOR_CROSS
	elif tool in ["feature", "marker", "delete", "unit"]:
		if not point_at(point, ["unit", "feature"], 8.0).is_empty() or (tool == "delete" and pick(point) >= 0):
			shape = Control.CURSOR_POINTING_HAND
		elif tool != "delete":
			shape = Control.CURSOR_CROSS
	elif tool in ["select", "dissolve"] and pick(point) >= 0:
		shape = Control.CURSOR_POINTING_HAND
	if reference_adjust:
		var grab := _reference_grab(point)
		if not grab.is_empty():
			shape = Control.CURSOR_MOVE if str(grab["mode"]) == "move" else (Control.CURSOR_BDIAGSIZE if int(grab["index"]) % 2 == 0 else Control.CURSOR_FDIAGSIZE)
	if _overlay.mouse_default_cursor_shape != shape:
		_overlay.mouse_default_cursor_shape = shape


func _motion(motion: InputEventMouseMotion) -> void:
	if _drag.is_empty():
		_update_cursor(motion.position)
		if tool == "scale":
			_scale_cursor = motion.position
			if _scale_start != null:
				scale_hover.emit(_scale_start, _scale_lonlat(motion.position))
			_overlay.queue_redraw()
		elif tool in ["terrain", "fortification", "climate"] and not _sketch.is_empty():
			_overlay.hover = motion.position
			_overlay.queue_redraw()
		elif tool == "draw":
			_overlay.hover = motion.position
			hover_moved.emit(world_to_lonlat(screen_to_world(motion.position)))
			_overlay.queue_redraw()
		elif tool in ["terrain", "fortification", "climate"]:
			var handle := _war_handle(motion.position)
			var hover: Variant = handle.get("screen") if not handle.is_empty() else null
			if hover != _war_hover:
				_war_hover = hover
				_overlay.queue_redraw()
		elif tool in ["modify", "border"]:
			_edit_hover = _edit_hit(motion.position)
			_halo = _shared_halo(motion.position)
			_overlay.queue_redraw()
		return
	_drag_distance += motion.relative.length()
	match _drag:
		"pan", "click":
			_kinetic.append([motion.position.x, motion.position.y, Time.get_ticks_msec()])
			_pan(motion.relative)
		"zoombox":
			_box = Rect2(_drag_start, motion.position - _drag_start).abs()
			_overlay.queue_redraw()
		"paint":
			_touch_segment(_drag_last, motion.position)
		"lasso":
			_lasso.append(motion.position)
			_overlay.queue_redraw()
		"box":
			_box = Rect2(_drag_start, motion.position - _drag_start).abs()
			_overlay.queue_redraw()
		"move":
			_move_line[1] = motion.position
			_overlay.queue_redraw()
		"vertex":
			_edit_drag["now"] = motion.position
			_halo = _shared_halo(motion.position)
			_overlay.queue_redraw()
		"reference":
			_reference_move(motion.position, motion.shift_pressed)
		"freehand":
			_freehand.append(motion.position)
			_overlay.queue_redraw()
		"war_vertex":
			_move_war_vertex(motion.position)
	_drag_last = motion.position


func _release(button: InputEventMouseButton) -> void:
	var kind := _drag
	_drag = ""
	match kind:
		"paint":
			_touch_segment(_drag_last, button.position)
			var finished := _stroke
			_stroke = PackedInt32Array()
			if finished.size() > 0:
				paint_stroke.emit(finished)
		"lasso":
			var ring: Array = []
			for point in _lasso:
				var lonlat := world_to_lonlat(screen_to_world(point))
				ring.append([lonlat.x, lonlat.y])
			_lasso = PackedVector2Array()
			_overlay.queue_redraw()
			if ring.size() >= 3:
				lasso_done.emit(ring)
		"box":
			var picked := PackedStringArray()
			for feature in features:
				var row: Dictionary = feature
				var coord: Variant = row.get("coord")
				if not (coord is Array) or (coord as Array).size() < 2:
					continue
				if _box.has_point(screen_of(Vector2(float(coord[0]), float(coord[1])))):
					picked.append(str(row.get("id", "")))
			_box = Rect2()
			_overlay.queue_redraw()
			box_done.emit(picked, button.shift_pressed)
		"move":
			var from := world_to_lonlat(screen_to_world(_move_line[0]))
			var to := world_to_lonlat(screen_to_world(button.position))
			_move_line = PackedVector2Array()
			move_rings = []
			_overlay.queue_redraw()
			if _drag_distance >= 3.0:
				move_done.emit(_pressed_index, from, to)
		"click":
			if _drag_distance < 5.0:
				_click(button)
			else:
				_kinetic_glide()
		"zoombox":
			var area := _box
			_box = Rect2()
			_overlay.queue_redraw()
			if _drag_distance < 5.0:
				_click(button)
			elif area.size.x * area.size.y >= 64.0:
				var corner_a := screen_to_world(area.position)
				var corner_b := screen_to_world(area.end)
				var span := (corner_b - corner_a).abs()
				var view := Vector2(_viewport.size)
				_animate((corner_a + corner_b) * 0.5, minf(view.x / maxf(span.x, 0.0001), view.y / maxf(span.y, 0.0001)), BOX_ZOOM_DURATION_MS, true)
		"reference":
			_reference_drag = {}
		"freehand":
			_finish_freehand()
		"war_vertex":
			var handle := _war_drag
			_war_drag = {}
			_overlay.queue_redraw()
			var row := _war_row(str(handle.get("kind", "")), str(handle.get("id", "")))
			if not row.is_empty() and (_drag_distance >= 2.0 or bool(handle.get("insert", false))):
				var shape_kind := str(handle["kind"])
				var geometry: Array = row.get("points", []) if shape_kind == "fortification" else row.get("rings", [])
				war_reshaped.emit(shape_kind, str(handle["id"]), geometry.duplicate(true))
		"vertex":
			var handle := _edit_drag
			_edit_drag = {}
			_overlay.queue_redraw()
			var moved := _drag_distance >= 2.0
			var lonlat := world_to_lonlat(screen_to_world(button.position))
			if bool(handle.get("alt", false)) and not moved:
				if str(handle.get("op", "")) == "move":
					vertex_edit.emit("remove", str(handle.get("target", "")), handle.get("path", []), int(handle.get("index", -1)), lonlat, true)
			elif moved:
				vertex_edit.emit(str(handle.get("op", "move")), str(handle.get("target", "")), handle.get("path", []), int(handle.get("index", -1)), lonlat, false)


func _click(button: InputEventMouseButton) -> void:
	var point := button.position
	var additive := button.shift_pressed or button.ctrl_pressed or button.meta_pressed
	match tool:
		"select":
			var hit := pick(point)
			if hit >= 0:
				region_click.emit(hit, additive)
			else:
				empty_click.emit(additive)
		"delete":
			var thing := point_at(point, ["unit", "feature"], 8.0)
			if not thing.is_empty():
				delete_click.emit(str(thing["kind"]), str(thing["id"]), -1)
				return
			var shape := war_shape_near(point, ["fortification", "terrain", "climate"])
			if not shape.is_empty():
				delete_click.emit("war:" + str(shape["kind"]), str(shape["id"]), -1)
				return
			var hit := pick(point)
			if hit >= 0:
				delete_click.emit("region", ids[hit] if hit < ids.size() else "", hit)
		"dissolve":
			var hit := pick(point)
			if hit < 0:
				return
			var other := neighbour_of(point, hit)
			if other >= 0:
				dissolve_click.emit(hit, other)
		"feature", "marker":
			var thing := point_at(point, ["feature"], 8.0)
			if not thing.is_empty():
				point_click.emit("feature", str(thing["id"]), point)
				return
			map_click.emit(world_to_lonlat(screen_to_world(point)), point, pick(point))
		"unit":
			var thing := point_at(point, ["unit"], 10.0)
			if not thing.is_empty():
				point_click.emit("unit", str(thing["id"]), point)
				return
			map_click.emit(world_to_lonlat(screen_to_world(point)), point, pick(point))
		"draw":
			if draw_points.size() >= 3:
				var first: Array = draw_points[0]
				if screen_of(Vector2(float(first[0]), float(first[1]))).distance_to(point) <= 12.0:
					_finish_draw()
					return
			if draw_points.size() >= 2:
				var last: Array = draw_points[draw_points.size() - 1]
				if screen_of(Vector2(float(last[0]), float(last[1]))).distance_to(point) <= 12.0:
					draw_points.pop_back()
					_overlay.queue_redraw()
					return
			var previous: Variant = draw_points[draw_points.size() - 1] if not draw_points.is_empty() else null
			draw_point_requested.emit(world_to_lonlat(screen_to_world(point)), previous)
		"scale":
			if button.shift_pressed or button.ctrl_pressed or button.alt_pressed or button.meta_pressed:
				return
			var lonlat := _scale_lonlat(point)
			if _scale_start == null:
				_scale_start = lonlat
				scale_sketch_label = ""
			else:
				var from: Vector2 = _scale_start
				_scale_start = null
				scale_sketch_label = ""
				scale_drawn.emit(from, lonlat)
			_overlay.queue_redraw()
		"terrain", "fortification", "climate":
			if _sketch.is_empty():
				var shape := war_shape_near(point, [tool])
				if not shape.is_empty():
					war_pick.emit(tool, str(shape["id"]))
					return
			var lonlat := world_to_lonlat(screen_to_world(point))
			_sketch_kind = tool
			_sketch.append([lonlat.x, lonlat.y])
			_overlay.queue_redraw()


func _touch(point: Vector2) -> void:
	var index := pick(point)
	if index < 0 or _stroke_visited.has(index):
		return
	_stroke_visited[index] = true
	var current := int(owner_index[index]) if index < owner_index.size() else -1
	var before := str(owner_keys[current]) if current >= 0 and current < owner_keys.size() else ""
	_stroke.append(index)
	var allowed := true
	if paint_only == "__unowned__":
		allowed = before.is_empty()
	elif paint_only != "*":
		allowed = before == paint_only
	if allowed and before != paint_owner:
		preview_paint(index)


func _touch_segment(from: Vector2, to: Vector2) -> void:
	var distance := from.distance_to(to)
	var steps := maxi(1, int(ceil(distance / 5.0)))
	for step in range(1, steps + 1):
		_touch(from.lerp(to, float(step) / float(steps)))


func _draw_overlay(canvas: Control) -> void:
	if not ready_to_draw:
		return
	var view := canvas.size
	var zoom := ol_zoom()
	var font := UI.font(700)
	var bold := UI.font(700)
	_draw_import_preview(canvas)
	_draw_reference(canvas)
	if show_terrain:
		for shape in war.get("terrainAreas", []):
			_draw_shape(canvas, "terrain", shape)
	if show_climate:
		for shape in war.get("climateZones", []):
			_draw_shape(canvas, "climate", shape)
	if layers.get("fortifications", true):
		for shape in war.get("fortifications", []):
			_draw_shape(canvas, "fortification", shape)
	var taken: Array[Rect2] = []
	if layers.get("units", true):
		for unit in units:
			var row: Dictionary = unit
			var screen := screen_of(Vector2(float(row.get("lng", 0)), float(row.get("lat", 0))))
			if screen.x < -30 or screen.y < -30 or screen.x > view.x + 30 or screen.y > view.y + 30:
				continue
			_draw_unit(canvas, row, screen, zoom, bold, taken)
	if layers.get("features", true) or not feature_selection.is_empty():
		for feature in features:
			var row: Dictionary = feature
			var coord: Variant = row.get("coord")
			if not (coord is Array) or (coord as Array).size() < 2:
				continue
			var selected := feature_selection.has(str(row.get("id", "")))
			if not selected and not _feature_shown(row):
				continue
			var screen := screen_of(Vector2(float(coord[0]), float(coord[1])))
			if screen.x < -30 or screen.y < -30 or screen.x > view.x + 30 or screen.y > view.y + 30:
				continue
			if bool(row.get("isMap", false)):
				_draw_map_feature(canvas, row, screen, zoom, selected, bold, font, taken)
			else:
				_draw_city(canvas, row, screen, zoom, selected, bold, font, taken)
	if layers.get("labels", true) and zoom > LABEL_MIN_ZOOM:
		_draw_region_labels(canvas, view, font, taken)
	if not review_outlines.is_empty() or not review_shapes.is_empty() or not review_points.is_empty() or not review_focus.is_empty():
		_draw_review(canvas)
	if not diagnostics.is_empty():
		_draw_diagnostics(canvas)
	if tool in ["modify", "border"] and not edit_rings.is_empty():
		_draw_edit(canvas)
	if tool == "draw":
		_draw_region_sketch(canvas)
	if _lasso.size() > 1:
		_sketch_shape(canvas, _lasso, true, _lasso[_lasso.size() - 1])
	if _box.size != Vector2.ZERO:
		canvas.draw_rect(_box, BOX_FILL, true)
		canvas.draw_rect(_box.grow(-0.75), Color(1, 1, 1), false, 1.5)
	if _move_line.size() == 2:
		_draw_move_preview(canvas)
		canvas.draw_line(_move_line[0], _move_line[1], Color(1, 1, 1, 0.85), 2.0, true)
		canvas.draw_circle(_move_line[1], 4.0, WorkshopUI.ACCENT_GREY)
	if _freehand.size() >= 2:
		_sketch_shape(canvas, _freehand, tool != "fortification", _freehand[_freehand.size() - 1])
	if _war_hover is Vector2 and _sketch.is_empty() and _freehand.is_empty() and tool in ["terrain", "fortification", "climate"]:
		_vertex_handle(canvas, _war_hover)
	if not _sketch.is_empty():
		var line := PackedVector2Array()
		for point in _sketch:
			var p: Array = point
			line.append(screen_of(Vector2(float(p[0]), float(p[1]))))
		var hover := Vector2(-1, -1)
		if canvas is Overlay and (canvas as Overlay).hover != Vector2.ZERO:
			hover = (canvas as Overlay).hover
			line.append(hover)
		_sketch_shape(canvas, line, _sketch_kind != "fortification", hover)
	if not scale_line.is_empty():
		_draw_scale_line(canvas, screen_of(scale_line["from"]), screen_of(scale_line["to"]), str(scale_line.get("label", "")))
	if tool == "scale":
		if _scale_start != null and _scale_cursor.x >= 0.0:
			_draw_scale_line(canvas, screen_of(_scale_start), _scale_cursor, scale_sketch_label)
		if _scale_cursor.x >= 0.0:
			canvas.draw_circle(_scale_cursor, 5.0, WorkshopUI.ACCENT, true, -1.0, true)
			canvas.draw_arc(_scale_cursor, 5.0, 0.0, TAU, 24, SCALE_INK, 1.5, true)


func _scale_lonlat(point: Vector2) -> Vector2:
	var lonlat := world_to_lonlat(screen_to_world(point))
	return Vector2(snappedf(lonlat.x, 0.00001), snappedf(lonlat.y, 0.00001))


func _draw_scale_line(canvas: Control, first: Vector2, last: Vector2, label: String) -> void:
	if first.distance_to(last) < 0.5:
		return
	var along := (last - first).normalized()
	canvas.draw_line(first, last, Color(0, 0, 0, 0.75), 6.0)
	var length := first.distance_to(last)
	var at := 0.0
	while at < length:
		var stop := minf(at + 14.0, length)
		canvas.draw_line(first + along * at, first + along * stop, WorkshopUI.ACCENT, 3.0)
		at += 20.0
	var across := Vector2(-along.y, along.x) * SCALE_BAR_PX
	for end in [first, last]:
		var tip: Vector2 = end
		canvas.draw_line(tip - across, tip + across, WorkshopUI.ACCENT, 3.0, true)
		canvas.draw_circle(tip - across, 1.5, WorkshopUI.ACCENT, true, -1.0, true)
		canvas.draw_circle(tip + across, 1.5, WorkshopUI.ACCENT, true, -1.0, true)
	if label.is_empty():
		return
	var font := UI.font(700)
	var width := font.get_string_size(label, HORIZONTAL_ALIGNMENT_LEFT, -1, 12).x
	var height := font.get_height(12)
	var middle := (first + last) * 0.5 + Vector2(0, -16)
	var box := Rect2(middle - Vector2(width * 0.5 + 6.0, height * 0.5 + 3.0), Vector2(width + 12.0, height + 6.0))
	canvas.draw_rect(box, WorkshopUI.ACCENT, true)
	canvas.draw_string(font, Vector2(middle.x - width * 0.5, middle.y + (font.get_ascent(12) - font.get_descent(12)) * 0.5), label, HORIZONTAL_ALIGNMENT_LEFT, -1, 12, SCALE_INK)


func _sketch_shape(canvas: Control, points: PackedVector2Array, area: bool, cursor: Vector2) -> void:
	if area and points.size() >= 3 and Geometry2D.triangulate_polygon(points).size() > 0:
		canvas.draw_colored_polygon(points, SKETCH_FILL)
	if points.size() >= 2:
		canvas.draw_polyline(points, Color(1, 1, 1), 5.0, true)
		canvas.draw_polyline(points, SKETCH_BLUE, 3.0, true)
	if cursor.x >= 0.0:
		_sketch_point(canvas, cursor)


func _sketch_point(canvas: Control, at: Vector2) -> void:
	canvas.draw_circle(at, 6.0, SKETCH_BLUE, true, -1.0, true)
	canvas.draw_arc(at, 6.0, 0.0, TAU, 24, Color(1, 1, 1), 1.5, true)


static func _free(taken: Array[Rect2], box: Rect2) -> bool:
	for other in taken:
		if other.intersects(box):
			return false
	return true


static func _text_box(font: Font, text: String, size: int, centre: Vector2) -> Rect2:
	var width := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x + 3.0
	var height := font.get_height(size) + 3.0
	return Rect2(centre - Vector2(width, height) * 0.5, Vector2(width, height))


static func _text(canvas: Control, font: Font, text: String, size: int, centre: Vector2, fill: Color, stroke: Color) -> void:
	var width := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
	var at := Vector2(centre.x - width * 0.5, centre.y + (font.get_ascent(size) - font.get_descent(size)) * 0.5)
	canvas.draw_string_outline(font, at, text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, 5, stroke)
	canvas.draw_string(font, at, text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, fill)


static func _square(canvas: Control, at: Vector2, radius: float, fill: Color, stroke: Color, stroke_width: float) -> void:
	var half := radius / sqrt(2.0)
	var corners := PackedVector2Array([at + Vector2(-half, -half), at + Vector2(half, -half), at + Vector2(half, half), at + Vector2(-half, half)])
	canvas.draw_colored_polygon(corners, fill)
	corners.append(corners[0])
	canvas.draw_polyline(corners, stroke, stroke_width, true)


func _draw_region_labels(canvas: Control, view: Vector2, font: Font, taken: Array[Rect2]) -> void:
	var scale := map.camera.zoom.x
	for index in range(ids.size()):
		var text := region_name(index)
		if text.is_empty() or not region_shown(index):
			continue
		if bool(region_type(index).get("includedInLabels", true)) == false:
			continue
		var places: Array = label_points[index] if index < label_points.size() and label_points[index] is Array else []
		var fits := not places.is_empty()
		if places.is_empty() and index < centroids.size():
			places = [[centroids[index].x, centroids[index].y, 0.0]]
		var label_width := -1.0
		for place in places:
			var spot: Array = place
			var screen := map.world_to_screen(Vector2(float(spot[0]), float(spot[1])))
			if screen.x < -80 or screen.y < -20 or screen.x > view.x + 80 or screen.y > view.y + 20:
				continue
			if label_width < 0.0:
				label_width = font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, 12).x + 3.0
			if fits and float(spot[2]) * scale < label_width:
				continue
			var box := _text_box(font, text, 12, screen)
			if not _free(taken, box):
				continue
			taken.append(box)
			_text(canvas, font, text, 12, screen, Color(1, 1, 1, 0.95), Color(0, 0, 0, 0.85))


func _screen_ring(ring: Variant) -> PackedVector2Array:
	var out := PackedVector2Array()
	if not (ring is Array):
		return out
	for point in ring:
		if point is Array and (point as Array).size() >= 2:
			out.append(screen_of(Vector2(float(point[0]), float(point[1]))))
	return out


func _dashed(canvas: Control, line: PackedVector2Array, color: Color, width: float, dash: float) -> void:
	for at in range(line.size() - 1):
		canvas.draw_dashed_line(line[at], line[at + 1], color, width, dash, true, true)


func _review_ring(canvas: Control, ring: Variant, color: Color, width: float, dash: float, fill: Color) -> void:
	var line := _screen_ring(ring)
	if line.size() < 2:
		return
	if fill.a > 0.0 and line.size() >= 4:
		var area := line.slice(0, line.size() - 1)
		if Geometry2D.triangulate_polygon(area).size() > 0:
			canvas.draw_colored_polygon(area, fill)
	if line[0].distance_to(line[line.size() - 1]) > 0.5:
		line.append(line[0])
	if dash > 0.0:
		_dashed(canvas, line, color, width, dash)
	else:
		canvas.draw_polyline(line, color, width, true)


func _review_point(canvas: Control, coord: Variant, state: String, focused: bool) -> void:
	if not (coord is Array) or (coord as Array).size() < 2:
		return
	var at := screen_of(Vector2(float(coord[0]), float(coord[1])))
	var color: Color = REVIEW_COLORS.get(state, REVIEW_COLORS["pending"])
	var radius := 9.0 if focused else 7.0
	canvas.draw_circle(at, radius, Color(148 / 255.0, 163 / 255.0, 184 / 255.0, 0.35) if state == "rejected" else Color(color, 0x55 / 255.0))
	canvas.draw_arc(at, radius, 0.0, TAU, 28, Color(1, 1, 1) if focused else color, 3.0 if focused else 2.0, true)


func _draw_diagnostics(canvas: Control) -> void:
	for entry in diagnostics:
		var item: Dictionary = entry
		var gap := str(item.get("kind", "")) == "gap"
		for ring in item.get("rings", []):
			_review_ring(canvas, ring, Color(251 / 255.0, 191 / 255.0, 36 / 255.0) if gap else Color(248 / 255.0, 113 / 255.0, 113 / 255.0), 2.0, 0.0, Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.42) if gap else Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.42))


func _vertex_handle(canvas: Control, at: Vector2) -> void:
	canvas.draw_circle(at, 7.0, Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.95), true, -1.0, true)
	canvas.draw_arc(at, 7.0, 0.0, TAU, 24, Color(1, 1, 1, 0.95), 2.0, true)


func _draw_edit(canvas: Control) -> void:
	if not _edit_drag.is_empty():
		var now: Vector2 = _edit_drag.get("now", Vector2.ZERO)
		var row := {}
		for entry in edit_rings:
			var candidate: Dictionary = entry
			if str(candidate.get("id", "")) == str(_edit_drag.get("target", "")) and str(candidate.get("path", [])) == str(_edit_drag.get("path", [])):
				row = candidate
		var coords: Array = row.get("coords", [])
		var index := int(_edit_drag.get("index", -1))
		var count := coords.size() - 1
		if count >= 3 and index >= 0:
			var a_index := index
			var b_index := index + 1
			if str(_edit_drag.get("op", "")) == "move":
				a_index = (index - 1 + count) % count
				b_index = (index + 1) % count
			var a: Array = coords[a_index]
			var b: Array = coords[b_index]
			var sa := screen_of(Vector2(float(a[0]), float(a[1])))
			var sb := screen_of(Vector2(float(b[0]), float(b[1])))
			canvas.draw_polyline(PackedVector2Array([sa, now, sb]), ACCENT_STROKE, 2.5, true)
		_vertex_handle(canvas, now)
	elif not _edit_hover.is_empty():
		_vertex_handle(canvas, _edit_hover.get("screen", Vector2.ZERO))
	if _halo is Vector2:
		canvas.draw_circle(_halo, 9.0, Color(34 / 255.0, 211 / 255.0, 238 / 255.0, 0.20), true, -1.0, true)
		canvas.draw_arc(_halo, 9.0, 0.0, TAU, 28, Color("#22d3ee"), 2.5, true)


func _draw_region_sketch(canvas: Control) -> void:
	var path := PackedVector2Array()
	for point in draw_points:
		var p: Array = point
		path.append(screen_of(Vector2(float(p[0]), float(p[1]))))
	var cursor: Vector2 = _overlay.hover if _overlay else Vector2.ZERO
	if snap_marker is Vector2:
		cursor = screen_of(snap_marker)
	if cursor == Vector2.ZERO:
		cursor = Vector2(-1, -1)
	else:
		path.append(cursor)
	_sketch_shape(canvas, path, true, cursor)


func _draw_review(canvas: Control) -> void:
	for entry in review_outlines:
		var outline: Dictionary = entry
		var state := str(outline.get("state", "pending"))
		var dash := 2.0 if state == "rejected" else (5.0 if state in ["pending", "conflict"] else 0.0)
		_review_ring(canvas, outline.get("ring"), REVIEW_COLORS.get(state, REVIEW_COLORS["pending"]), 2.0, dash, Color(0, 0, 0, 0))
	for entry in review_shapes:
		var shape: Dictionary = entry
		for ring in shape.get("rings", []):
			_review_ring(canvas, ring, REVIEW_COLORS["proposed"], 2.5, 6.5, Color(56 / 255.0, 189 / 255.0, 248 / 255.0, 0.12))
	for entry in review_points:
		var point: Dictionary = entry
		_review_point(canvas, point.get("coord"), str(point.get("state", "pending")), false)
	if review_focus.is_empty():
		return
	var focus_state := str(review_focus.get("state", "pending"))
	for ring in review_focus.get("outlines", []):
		_review_ring(canvas, ring, Color(1, 1, 1), 3.5, 0.0, Color(0, 0, 0, 0))
	for rings in review_focus.get("shapes", []):
		for ring in rings:
			_review_ring(canvas, ring, REVIEW_COLORS["proposed"], 3.5, 6.5, Color(56 / 255.0, 189 / 255.0, 248 / 255.0, 0.12))
	for coord in review_focus.get("points", []):
		_review_point(canvas, coord, focus_state, true)


func _draw_shape(canvas: Control, kind: String, shape: Variant) -> void:
	var row: Dictionary = shape
	var selected: bool = str(war_selected.get("kind", "")) == kind and str(war_selected.get("id", "")) == str(row.get("id", ""))
	var color := Color(1, 1, 1, 0.8)
	if kind == "climate":
		color = Color.html(str(row.get("color", "#7f8c99"))) if Color.html_is_valid(str(row.get("color", "#7f8c99"))) else Color("#7f8c99")
	elif kind == "terrain":
		color = Color("#c8a46e")
	else:
		color = Color("#e5e7eb")
	for line in _shape_lines(kind, row):
		var poly: PackedVector2Array = line
		if poly.size() < 2:
			continue
		if kind != "fortification" and poly.size() >= 4:
			var fill := poly.slice(0, poly.size() - 1)
			if Geometry2D.triangulate_polygon(fill).size() > 0:
				canvas.draw_colored_polygon(fill, Color(color, 0.18))
		canvas.draw_polyline(poly, Color(0.02, 0.03, 0.05, 0.8), 5.0 if kind == "fortification" else 3.5, true)
		canvas.draw_polyline(poly, WorkshopUI.ACCENT_GREY if selected else color, 3.0 if kind == "fortification" else 2.0, true)


func _draw_city(canvas: Control, row: Dictionary, screen: Vector2, zoom: float, selected: bool, bold: Font, font: Font, taken: Array[Rect2]) -> void:
	var tags: Array = row.get("tags", [])
	var pop := float(row.get("population", 0))
	var large := tags.has("capital") or pop >= 1000000.0
	var mid := pop >= 100000.0
	var radius := 6.0 if large else (4.5 if mid else 3.5)
	var ring := 9.0 if large else (7.5 if mid else 6.5)
	var image_size := (2.0 * ring + 2.5) if selected else (2.0 * radius + 1.0)
	var image_box := Rect2(screen - Vector2.ONE * image_size * 0.5, Vector2.ONE * image_size)
	var show := selected or zoom >= 6.0 or (large and zoom >= 4.3) or (mid and zoom >= 5.3)
	var text := str(row.get("name", "")) if show else ""
	var face := bold if selected else font
	var text_centre := screen + Vector2(0, -13.0 if selected else -11.0)
	var text_box := _text_box(face, text, 11, text_centre) if not text.is_empty() else Rect2()
	if not _free(taken, image_box) or (not text.is_empty() and not _free(taken, text_box)):
		return
	taken.append(image_box)
	if not text.is_empty():
		taken.append(text_box)
	if selected:
		canvas.draw_circle(screen, ring, Color("#facc15", 0.35), true, -1.0, true)
		canvas.draw_arc(screen, ring, 0.0, TAU, 24, Color("#facc15"), 2.5, true)
	else:
		_square(canvas, screen, radius, Color("#ffd54a"), Color(0, 0, 0), 1.0)
	if not text.is_empty():
		_text(canvas, face, text, 11, text_centre, Color("#fef3c7") if selected else Color(1, 1, 1), Color(0, 0, 0, 0.9) if selected else Color(0, 0, 0, 0.85))


func _draw_map_feature(canvas: Control, row: Dictionary, screen: Vector2, zoom: float, selected: bool, bold: Font, font: Font, taken: Array[Rect2]) -> void:
	var status := str(row.get("status", "active"))
	var faded := status in ["destroyed", "abandoned", "inactive", "planned"]
	var owner := str(row.get("owner", "")) if row.get("owner") != null else ""
	var color := Color(226 / 255.0, 222 / 255.0, 205 / 255.0)
	if not owner.is_empty() and polity_colors.has(owner):
		color = WorkshopUI.rgb_color(polity_colors[owner])
	if faded:
		color.a = 0.55
	if selected:
		color = Color("#facc15")
	var glyph := marker_glyph(str(row.get("kind", "")), str(row.get("name", "")))
	var size := 17 if selected else 15
	var glyph_box := _text_box(bold, glyph, size, screen)
	if _free(taken, glyph_box):
		taken.append(glyph_box)
		_text(canvas, bold, glyph, size, screen, color, Color(0, 0, 0, 0.9))
	if selected or zoom >= 4.5:
		var text := str(row.get("name", ""))
		if text.is_empty():
			return
		var centre := screen + Vector2(0, -14)
		var box := _text_box(font, text, 11, centre)
		if not _free(taken, box):
			return
		taken.append(box)
		_text(canvas, font, text, 11, centre, Color("#fef3c7") if selected else Color(1, 1, 1), Color(0, 0, 0, 0.85))


static var _marker_patterns: Array = []


static func marker_glyph(kind: String, name: String) -> String:
	if _marker_patterns.is_empty():
		for rule in MARKER_GLYPHS:
			var pattern := RegEx.new()
			pattern.compile(str(rule[0]))
			_marker_patterns.append([pattern, str(rule[1])])
	var clean := RegEx.create_from_string("[^a-z0-9]+")
	var searchable := ("%s %s" % [clean.sub((kind if not kind.is_empty() else "landmark").to_lower(), " ", true).strip_edges(), clean.sub(name.to_lower(), " ", true).strip_edges()]).strip_edges()
	for rule in _marker_patterns:
		if (rule[0] as RegEx).search(searchable) != null:
			return str(rule[1])
	return "•"


func _draw_unit(canvas: Control, row: Dictionary, screen: Vector2, zoom: float, bold: Font, taken: Array[Rect2]) -> void:
	var owner := str(row.get("ownerCode", ""))
	var color := Color8(110, 110, 120)
	if polity_colors.has(owner):
		color = WorkshopUI.rgb_color(polity_colors[owner])
	var glyph := str(UNIT_GLYPH.get(str(row.get("type", "infantry")), "?"))
	var text := glyph
	var offset := 0.0
	if zoom >= 4.5 and not str(row.get("name", "")).is_empty():
		text = "%s %s" % [glyph, str(row.get("name", ""))]
		offset = -15.0
	var image_box := Rect2(screen - Vector2.ONE * 9.75, Vector2.ONE * 19.5)
	var centre := screen + Vector2(0, offset)
	var text_box := _text_box(bold, text, 11, centre)
	if not _free(taken, image_box) or not _free(taken, text_box):
		return
	taken.append(image_box)
	taken.append(text_box)
	_square(canvas, screen, 9.0, color, Color(0, 0, 0, 0.9), 1.5)
	_text(canvas, bold, text, 11, centre, Color(1, 1, 1), Color(0, 0, 0, 0.9))


class Overlay extends Control:
	var host: WorkshopMap
	var hover := Vector2.ZERO

	func _gui_input(event: InputEvent) -> void:
		host._handle(event)
		if event is InputEventMouseButton:
			accept_event()

	func _draw() -> void:
		host._draw_overlay(self)

	func _notification(what: int) -> void:
		if what == NOTIFICATION_RESIZED:
			queue_redraw()
