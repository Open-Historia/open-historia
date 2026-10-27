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

const NEUTRAL := Color8(58, 60, 66)
const UNIT_GLYPH := {"infantry": "I", "armor": "A", "air": "✈", "naval": "N", "artillery": "R", "garrison": "G"}
const WORLD := 4096.0
const REVIEW_COLORS := {"pending": Color("#f59e0b"), "conflict": Color("#f97316"), "accepted": Color("#22c55e"), "rejected": Color(148 / 255.0, 163 / 255.0, 184 / 255.0, 0.75), "proposed": Color("#38bdf8")}

var map: MapView
var tool := "select"
var ids: PackedStringArray = []
var names: PackedStringArray = []
var centroids: PackedVector2Array = []
var areas: PackedFloat32Array = []
var index_of := {}
var fills: Array = []
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
var paint_color := NEUTRAL
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
	map.set_state({"owners": owner_index, "ownerNames": part.get("owners", []), "ownerColors": part.get("ownerColors", [])})
	set_names(part.get("names", {}))
	apply_fills()


func fill_color(index: int) -> Color:
	var value := int(fills[index]) if index < fills.size() and fills[index] != null else -1
	var color := NEUTRAL
	if value >= 0:
		color = Color8((value >> 16) & 255, (value >> 8) & 255, value & 255)
	if review_tint.has(index):
		color = color.lerp(Color(review_tint[index], 1.0), 0.15)
	if selection.has(index):
		color = color.lerp(Color(1, 1, 1), 0.38)
	return color


func apply_fills() -> void:
	var count := mini(ids.size(), map.editor_region_count()) if ready_to_draw else 0
	if count <= 0:
		return
	var colors := PackedColorArray()
	colors.resize(count)
	for index in range(count):
		colors[index] = fill_color(index)
	map.editor_set_region_colors(colors)
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
		map.editor_set_region_color(int(key), fill_color(int(key)), false)
	map.editor_commit_colors()


func preview_paint(index: int) -> void:
	if not ready_to_draw:
		return
	map.editor_set_region_color(index, paint_color, false)
	_dirty_fills = true


func _process(_delta: float) -> void:
	if _dirty_fills and map:
		_dirty_fills = false
		map.editor_commit_colors()
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
	return int(map.baker.pick(screen_to_world(point)))


func ol_zoom() -> float:
	return map.zoom_level() + 1.0


func meters_per_pixel() -> float:
	return 40075016.68557849 / (WORLD * map.camera.zoom.x)


func fit_bounds(bounds: Array, max_level := 8.0, duration := 0.35) -> void:
	if bounds.size() < 2:
		return
	map.fit_lonlat_bounds(bounds, max_level - 1.0, duration)
	_overlay.queue_redraw()


func locate(lonlat: Vector2, ol_level := 6.0) -> void:
	map.editor_set_view(lonlat_to_world(lonlat), pow(2.0, ol_level) / 16.0)
	_overlay.queue_redraw()
	view_moved.emit()


func start_view() -> void:
	map.editor_set_view(lonlat_to_world(Vector2(0, 20)), pow(2.0, 2.1) / 16.0)


func _pan(delta: Vector2) -> void:
	map.editor_pan(delta)
	_overlay.queue_redraw()
	view_moved.emit()


func _zoom(point: Vector2, factor: float) -> void:
	map.editor_zoom_at(point, factor)
	_overlay.queue_redraw()
	view_moved.emit()


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
	reference = {"texture": texture, "aspect": aspect, "rect": Rect2(centre - Vector2(width, height) * 0.5, Vector2(width, height)), "opacity": float(reference.get("opacity", 0.5)), "visible": bool(reference.get("visible", true))}
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


func _reference_press(point: Vector2) -> bool:
	if reference.is_empty():
		return false
	var corners := _reference_corners()
	for index in range(corners.size()):
		if map.world_to_screen(corners[index]).distance_to(point) <= 11.0:
			_reference_drag = {"mode": "resize", "anchor": corners[(index + 2) % 4]}
			return true
	var world := screen_to_world(point)
	var rect: Rect2 = reference["rect"]
	if rect.has_point(world):
		_reference_drag = {"mode": "move", "last": world}
		return true
	return false


func _reference_move(point: Vector2) -> void:
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
		var top_left := Vector2(minf(anchor.x, world.x), minf(anchor.y, world.y))
		var bottom_right := Vector2(maxf(maxf(anchor.x, world.x), top_left.x + least), maxf(maxf(anchor.y, world.y), top_left.y + least))
		rect = Rect2(top_left, bottom_right - top_left)
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
		canvas.draw_texture_rect(reference["texture"], area, false, Color(1, 1, 1, clampf(float(reference.get("opacity", 0.5)), 0.0, 1.0)))
	if not reference_adjust:
		return
	var frame := PackedVector2Array([area.position, area.position + Vector2(area.size.x, 0), area.position + area.size, area.position + Vector2(0, area.size.y), area.position])
	_dashed(canvas, frame, Color("#22d3ee"), 1.5, 6.0)
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
		if button.button_index == MOUSE_BUTTON_WHEEL_UP and button.pressed:
			_zoom(button.position, 1.15)
			return
		if button.button_index == MOUSE_BUTTON_WHEEL_DOWN and button.pressed:
			_zoom(button.position, 1.0 / 1.15)
			return
		if button.button_index == MOUSE_BUTTON_RIGHT or button.button_index == MOUSE_BUTTON_MIDDLE:
			_drag = "pan" if button.pressed else ""
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
		_pan(-gesture.delta * 12.0)


func _press(button: InputEventMouseButton) -> void:
	_drag_start = button.position
	_drag_last = button.position
	_drag_distance = 0.0
	if reference_adjust and _reference_press(button.position):
		_drag = "reference"
		return
	if button.double_click:
		if tool == "draw":
			_finish_draw()
			_drag = ""
			return
		if tool == "select":
			var hit := pick(button.position)
			if hit >= 0:
				region_double_click.emit(hit)
			_drag = ""
			return
		if tool in ["terrain", "fortification", "climate"]:
			_commit_sketch()
			_drag = ""
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
	if _overlay.mouse_default_cursor_shape != shape:
		_overlay.mouse_default_cursor_shape = shape


func _motion(motion: InputEventMouseMotion) -> void:
	if _drag.is_empty():
		_update_cursor(motion.position)
		if tool in ["terrain", "fortification", "climate"] and not _sketch.is_empty():
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
		"pan":
			_pan(motion.relative)
		"click":
			if _drag_distance >= 5.0:
				_pan(motion.relative)
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
			_reference_move(motion.position)
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
	var font := UI.font(600)
	var bold := UI.font(700)
	_draw_import_preview(canvas)
	_draw_reference(canvas)
	if layers.get("labels", true) and zoom >= 4.0:
		var taken: Array[Rect2] = []
		for index in range(mini(ids.size(), centroids.size())):
			var text := region_name(index)
			if text.is_empty():
				continue
			var screen := map.world_to_screen(centroids[index])
			if screen.x < -60 or screen.y < -20 or screen.x > view.x + 60 or screen.y > view.y + 20:
				continue
			var width := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, 12).x
			var box := Rect2(screen - Vector2(width * 0.5 + 2, 9), Vector2(width + 4, 16))
			var clash := false
			for other in taken:
				if other.intersects(box):
					clash = true
					break
			if clash:
				continue
			taken.append(box)
			var at := screen + Vector2(-width * 0.5, 4)
			canvas.draw_string_outline(font, at, text, HORIZONTAL_ALIGNMENT_LEFT, -1, 12, 3, Color(0, 0, 0, 0.85))
			canvas.draw_string(font, at, text, HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color(1, 1, 1, 0.95))
	if show_terrain:
		for shape in war.get("terrainAreas", []):
			_draw_shape(canvas, "terrain", shape)
	if show_climate:
		for shape in war.get("climateZones", []):
			_draw_shape(canvas, "climate", shape)
	if layers.get("fortifications", true):
		for shape in war.get("fortifications", []):
			_draw_shape(canvas, "fortification", shape)
	if not review_outlines.is_empty() or not review_shapes.is_empty() or not review_points.is_empty() or not review_focus.is_empty():
		_draw_review(canvas)
	if not diagnostics.is_empty():
		_draw_diagnostics(canvas)
	if tool in ["modify", "border"] and not edit_rings.is_empty():
		_draw_edit(canvas)
	if tool == "draw":
		_draw_region_sketch(canvas)
	if layers.get("features", true) or not feature_selection.is_empty():
		var taken_labels: Array[Rect2] = []
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
				_draw_map_feature(canvas, row, screen, zoom, selected, bold, font, taken_labels)
			else:
				_draw_city(canvas, row, screen, zoom, selected, bold, font, taken_labels)
	if layers.get("units", true):
		for unit in units:
			var row: Dictionary = unit
			var screen := screen_of(Vector2(float(row.get("lng", 0)), float(row.get("lat", 0))))
			if screen.x < -30 or screen.y < -30 or screen.x > view.x + 30 or screen.y > view.y + 30:
				continue
			_draw_unit(canvas, row, screen, zoom, bold)
	if _lasso.size() > 1:
		var closed := _lasso.duplicate()
		closed.append(_lasso[0])
		canvas.draw_polyline(closed, Color(1, 1, 1, 0.9), 1.5, true)
	if _box.size != Vector2.ZERO:
		canvas.draw_rect(_box, Color(1, 1, 1, 0.12), true)
		canvas.draw_rect(_box, Color(1, 1, 1, 0.8), false, 1.0)
	if _move_line.size() == 2:
		_draw_move_preview(canvas)
		canvas.draw_line(_move_line[0], _move_line[1], Color(1, 1, 1, 0.85), 2.0, true)
		canvas.draw_circle(_move_line[1], 4.0, WorkshopUI.ACCENT_GREY)
	if _freehand.size() >= 2:
		canvas.draw_polyline(_freehand, Color(1, 1, 1, 0.95), 2.0, true)
	if _war_hover is Vector2 and _sketch.is_empty() and _freehand.is_empty():
		canvas.draw_circle(_war_hover, 6.0, Color(1, 1, 1, 0.95))
		canvas.draw_arc(_war_hover, 6.0, 0.0, TAU, 20, Color(0.02, 0.03, 0.05, 0.9), 1.5, true)
	if not _sketch.is_empty():
		var line := PackedVector2Array()
		for point in _sketch:
			var p: Array = point
			line.append(screen_of(Vector2(float(p[0]), float(p[1]))))
		if canvas is Overlay and (canvas as Overlay).hover != Vector2.ZERO:
			line.append((canvas as Overlay).hover)
		if line.size() > 1:
			canvas.draw_polyline(line, Color(1, 1, 1, 0.95), 2.0, true)
		for point in line:
			canvas.draw_circle(point, 3.5, Color(1, 1, 1, 0.95))


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
	for entry in edit_rings:
		var line := _ring_screen(entry)
		if line.size() >= 2:
			canvas.draw_polyline(line, Color(1, 1, 1, 0.85), 1.5, true)
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
			canvas.draw_dashed_line(sa, now, Color(1, 1, 1, 0.9), 1.5, 4.0, true, true)
			canvas.draw_dashed_line(now, sb, Color(1, 1, 1, 0.9), 1.5, 4.0, true, true)
		_vertex_handle(canvas, now)
	elif not _edit_hover.is_empty():
		_vertex_handle(canvas, _edit_hover.get("screen", Vector2.ZERO))
	if _halo is Vector2:
		canvas.draw_circle(_halo, 10.0, Color(34 / 255.0, 211 / 255.0, 238 / 255.0, 0.25), true, -1.0, true)
		canvas.draw_arc(_halo, 10.0, 0.0, TAU, 28, Color("#22d3ee"), 2.5, true)


func _draw_region_sketch(canvas: Control) -> void:
	var line := PackedVector2Array()
	for point in draw_points:
		var p: Array = point
		line.append(screen_of(Vector2(float(p[0]), float(p[1]))))
	var hover: Vector2 = _overlay.hover if _overlay else Vector2.ZERO
	if snap_marker is Vector2:
		hover = screen_of(snap_marker)
	if line.size() >= 2:
		var area := line.duplicate()
		if hover != Vector2.ZERO:
			area.append(hover)
		if area.size() >= 3 and Geometry2D.triangulate_polygon(area).size() > 0:
			canvas.draw_colored_polygon(area, Color(1, 1, 1, 0.12))
	if not line.is_empty():
		var path := line.duplicate()
		if hover != Vector2.ZERO:
			path.append(hover)
		if path.size() >= 2:
			canvas.draw_polyline(path, Color(1, 1, 1, 0.95), 2.0, true)
		if line.size() >= 2 and hover != Vector2.ZERO:
			canvas.draw_dashed_line(hover, line[0], Color(1, 1, 1, 0.5), 1.5, 5.0, true, true)
		for point in line:
			canvas.draw_circle(point, 3.5, Color(1, 1, 1, 0.95))
	if snap_marker is Vector2:
		var at := screen_of(snap_marker)
		canvas.draw_circle(at, 6.0, Color(1, 1, 1, 0.2), true, -1.0, true)
		canvas.draw_arc(at, 6.0, 0.0, TAU, 20, Color(1, 1, 1, 0.95), 2.0, true)


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
	if selected:
		var ring := 9.0 if large else (7.5 if mid else 6.5)
		canvas.draw_circle(screen, ring, Color("#facc15", 0.35))
		canvas.draw_arc(screen, ring, 0.0, TAU, 24, Color("#facc15"), 2.5, true)
	else:
		var diamond := PackedVector2Array([screen + Vector2(0, -radius), screen + Vector2(radius, 0), screen + Vector2(0, radius), screen + Vector2(-radius, 0)])
		canvas.draw_colored_polygon(diamond, Color("#ffd54a"))
		diamond.append(diamond[0])
		canvas.draw_polyline(diamond, Color(0, 0, 0), 1.0, true)
	var show := selected or zoom >= 6.0 or (large and zoom >= 4.3) or (mid and zoom >= 5.3)
	if not show:
		return
	var text := str(row.get("name", ""))
	if text.is_empty():
		return
	var face := bold if selected else font
	var width := face.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, 11).x
	var at := screen + Vector2(-width * 0.5, -(13.0 if selected else 11.0) + 4)
	var box := Rect2(at - Vector2(2, 11), Vector2(width + 4, 14))
	for other in taken:
		if other.intersects(box):
			return
	taken.append(box)
	canvas.draw_string_outline(face, at, text, HORIZONTAL_ALIGNMENT_LEFT, -1, 11, 3, Color(0, 0, 0, 0.85))
	canvas.draw_string(face, at, text, HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Color("#fef3c7") if selected else Color(1, 1, 1))


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
	var glyph := "◆"
	var size := 17 if selected else 15
	var width := bold.get_string_size(glyph, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
	var at := screen + Vector2(-width * 0.5, size * 0.35)
	canvas.draw_string_outline(bold, at, glyph, HORIZONTAL_ALIGNMENT_LEFT, -1, size, 3, Color(0, 0, 0, 0.9))
	canvas.draw_string(bold, at, glyph, HORIZONTAL_ALIGNMENT_LEFT, -1, size, color)
	if selected or zoom >= 4.5:
		var text := str(row.get("name", ""))
		var text_width := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, 11).x
		var label_at := screen + Vector2(-text_width * 0.5, -10)
		var box := Rect2(label_at - Vector2(2, 11), Vector2(text_width + 4, 14))
		for other in taken:
			if other.intersects(box):
				return
		taken.append(box)
		canvas.draw_string_outline(font, label_at, text, HORIZONTAL_ALIGNMENT_LEFT, -1, 11, 3, Color(0, 0, 0, 0.85))
		canvas.draw_string(font, label_at, text, HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Color("#fef3c7") if selected else Color(1, 1, 1))


func _draw_unit(canvas: Control, row: Dictionary, screen: Vector2, zoom: float, bold: Font) -> void:
	var owner := str(row.get("ownerCode", ""))
	var color := Color8(110, 110, 120)
	if polity_colors.has(owner):
		color = WorkshopUI.rgb_color(polity_colors[owner])
	var diamond := PackedVector2Array([screen + Vector2(0, -9), screen + Vector2(9, 0), screen + Vector2(0, 9), screen + Vector2(-9, 0)])
	canvas.draw_colored_polygon(diamond, color)
	diamond.append(diamond[0])
	canvas.draw_polyline(diamond, Color(0, 0, 0, 0.9), 1.5, true)
	var glyph := str(UNIT_GLYPH.get(str(row.get("type", "infantry")), "?"))
	var text := glyph
	var offset := 0.0
	if zoom >= 4.5 and not str(row.get("name", "")).is_empty():
		text = "%s %s" % [glyph, str(row.get("name", ""))]
		offset = -15.0
	var width := bold.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, 11).x
	var at := screen + Vector2(-width * 0.5, offset + 4)
	canvas.draw_string_outline(bold, at, text, HORIZONTAL_ALIGNMENT_LEFT, -1, 11, 3, Color(0, 0, 0, 0.9))
	canvas.draw_string(bold, at, text, HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Color(1, 1, 1))


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
