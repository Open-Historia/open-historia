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
signal war_drawn(kind: String, coords: Array)
signal war_pick(kind: String, id: String)
signal view_moved

const NEUTRAL := Color8(58, 60, 66)
const UNIT_GLYPH := {"infantry": "I", "armor": "A", "air": "✈", "naval": "N", "artillery": "R", "garrison": "G"}
const WORLD := 4096.0

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
var _move_line := PackedVector2Array()
var _dirty_fills := false
var _label_names := {}


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
	if selection.has(index):
		color = color.lerp(Color(1, 1, 1), 0.38)
	return color


func apply_fills() -> void:
	if not ready_to_draw or map._colors_image == null:
		return
	var count := mini(ids.size(), map._region_count)
	var image := map._colors_image
	for index in range(count):
		image.set_pixel(index % MapView.COLUMNS, index / MapView.COLUMNS, fill_color(index))
	map._colors_texture.update(image)
	set_regions_visible(bool(layers.get("regions", true)))


func set_regions_visible(on: bool) -> void:
	for copy in map._copies:
		if is_instance_valid(copy):
			copy.visible = on


func set_selection(indices: Array) -> void:
	var before := selection.duplicate()
	selection = {}
	for index in indices:
		selection[int(index)] = true
	if not ready_to_draw or map._colors_image == null:
		return
	var touched := {}
	for key in before:
		touched[key] = true
	for key in selection:
		touched[key] = true
	var image := map._colors_image
	for key in touched:
		var index := int(key)
		if index < 0 or index >= map._region_count:
			continue
		image.set_pixel(index % MapView.COLUMNS, index / MapView.COLUMNS, fill_color(index))
	map._colors_texture.update(image)


func preview_paint(index: int) -> void:
	if not ready_to_draw or index < 0 or index >= map._region_count:
		return
	map._colors_image.set_pixel(index % MapView.COLUMNS, index / MapView.COLUMNS, paint_color)
	_dirty_fills = true


func _process(_delta: float) -> void:
	if _dirty_fills and map and map._colors_texture:
		_dirty_fills = false
		map._colors_texture.update(map._colors_image)


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
	var world := lonlat_to_world(lonlat)
	map.camera.position = world
	map.camera.zoom = Vector2.ONE * clampf(pow(2.0, ol_level) / 16.0, MapView.MIN_ZOOM, MapView.MAX_ZOOM)
	map._after_camera_move()
	_overlay.queue_redraw()
	view_moved.emit()


func start_view() -> void:
	map.camera.position = lonlat_to_world(Vector2(0, 20))
	map.camera.zoom = Vector2.ONE * clampf(pow(2.0, 2.1) / 16.0, MapView.MIN_ZOOM, MapView.MAX_ZOOM)
	map._after_camera_move()


func _pan(delta: Vector2) -> void:
	map.camera.position -= delta / map.camera.zoom.x
	map._after_camera_move()
	_overlay.queue_redraw()
	view_moved.emit()


func _zoom(point: Vector2, factor: float) -> void:
	map._zoom_at(point, factor)
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
	if _sketch.is_empty():
		return false
	_sketch = []
	_sketch_kind = ""
	_overlay.queue_redraw()
	return true


func undo_sketch_point() -> bool:
	if _sketch.is_empty():
		return false
	_sketch.pop_back()
	if _sketch.is_empty():
		_sketch_kind = ""
	_overlay.queue_redraw()
	return true


func is_sketching() -> bool:
	return not _sketch.is_empty()


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
	if button.double_click:
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
		"move":
			var hit := pick(button.position)
			if hit >= 0:
				_drag = "move"
				_pressed_index = hit
				_move_line = PackedVector2Array([button.position, button.position])
			else:
				_drag = "click"
		_:
			_drag = "click"


func _motion(motion: InputEventMouseMotion) -> void:
	if _drag.is_empty():
		if tool in ["terrain", "fortification", "climate"] and not _sketch.is_empty():
			_overlay.hover = motion.position
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
			_overlay.queue_redraw()
			if _drag_distance >= 3.0:
				move_done.emit(_pressed_index, from, to)
		"click":
			if _drag_distance < 5.0:
				_click(button)


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
		canvas.draw_line(_move_line[0], _move_line[1], Color(1, 1, 1, 0.85), 2.0, true)
		canvas.draw_circle(_move_line[1], 4.0, WorkshopUI.ACCENT_GREY)
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
