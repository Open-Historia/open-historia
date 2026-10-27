class_name WarRoomMap
extends Control

const ACCENT := Color("#2bc1f3")
const CLICK_PX := 5.0
const WAY_LEAST_PX := 28.0
const PICK_PX := 16.0
const WAY_STEP_PX := 6.0
const RAD := PI / 180.0
const EARTH_KM := 6371.0
const DRAW_COLOURS := {"route": Color("#2bc1f3"), "replan": Color("#2bc1f3"), "diversion": Color("#ffd24a"), "deploy": Color("#3ddc84")}
const SHADE_COLOURS := [
	Color(233 / 255.0, 185 / 255.0, 73 / 255.0, 0.34),
	Color(210 / 255.0, 53 / 255.0, 61 / 255.0, 0.44),
	Color(236 / 255.0, 231 / 255.0, 218 / 255.0, 0.34),
	Color(96 / 255.0, 186 / 255.0, 112 / 255.0, 0.42),
	Color(210 / 255.0, 53 / 255.0, 61 / 255.0, 0.4),
]
const CASING := Color(5 / 255.0, 8 / 255.0, 13 / 255.0, 0.82)
const HALO := Color(5 / 255.0, 8 / 255.0, 13 / 255.0, 0.92)
const SYMBOL_SPACING := 250.0
const TILE_PX := 512.0
const TEXT_PADDING := 2.0
const FLEET_COLOURS := {"fleet": Color("#c9a54c"), "picked": Color("#e9b949"), "course": Color("#f4f7fb")}

var map: MapView
var store: WarRoomStore
var record: Dictionary = {}
var _held: Dictionary = {}
var _draft: Variant = null
var _fitted := ""
var _seen := Vector3.ZERO
var last_labels := PackedStringArray()
var label_rects: Array[Rect2] = []
var _taken: Array[Rect2] = []
var _war_seen: Array[Rect2] = []


func _init() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	mouse_default_cursor_shape = Control.CURSOR_CROSS
	focus_mode = Control.FOCUS_NONE


func setup(map_view: MapView, shared: WarRoomStore) -> void:
	map = map_view
	store = shared
	store.changed.connect(_on_store)


func set_record(value: Dictionary) -> void:
	record = value
	_fit_if_asked()
	queue_redraw()


func _on_store(keys: PackedStringArray) -> void:
	var tool := str(store.value("tool"))
	var drawing := bool(store.value("open")) and tool != "pan"
	mouse_filter = Control.MOUSE_FILTER_STOP if drawing else Control.MOUSE_FILTER_IGNORE
	if not drawing:
		_held = {}
		_draft = null
	if "open" in keys and not bool(store.value("open")):
		_fitted = ""
		_publish([])
	if "fit" in keys or "open" in keys or "battlefield" in keys:
		_fit_if_asked()
	queue_redraw()


func _process(_delta: float) -> void:
	if not map or not store or not bool(store.value("open")):
		return
	var view: Array = map.render_view()
	var centre: Vector2 = view[0]
	var seen := Vector3(centre.x, centre.y, float(view[1]))
	if seen != _seen:
		_seen = seen
		queue_redraw()
	elif map.war_label_rects != _war_seen:
		queue_redraw()


func _fit_if_asked() -> void:
	if not map or not store or not bool(store.value("open")) or record.is_empty():
		return
	var bounds: Array = record.get("bounds", [])
	if bounds.size() < 2 or str(record.get("name", "")).to_lower() != str(store.value("battlefield")).to_lower():
		return
	var key := "%s|%d" % [str(store.value("battlefield")).to_lower(), int(store.value("fit"))]
	if _fitted == key:
		return
	_fitted = key
	var view := map.get_viewport_rect().size
	var right := maxf(0.0, minf(float(store.value("cover")), view.x - 240.0)) + 48.0
	var left := maxf(0.0, minf(float(store.value("rail")), 120.0)) + 48.0
	fit_bounds(bounds, Vector4(left, 96.0, right, 96.0), 8.5, 0.9)


func fit_bounds(bounds: Array, padding: Vector4, max_level: float, duration: float) -> void:
	var south_west: Array = bounds[0]
	var north_east: Array = bounds[1]
	var west := float(south_west[0])
	var south := float(south_west[1])
	var east := float(north_east[0])
	var north := float(north_east[1])
	if east < west:
		east += 360.0
	var top_left := MapView.CityLayer.ohproject(west, north)
	var bottom_right := MapView.CityLayer.ohproject(east, south)
	top_left.x = (west + 180.0) / 360.0 * MapView.WORLD_WIDTH
	bottom_right.x = (east + 180.0) / 360.0 * MapView.WORLD_WIDTH
	var view := map.get_viewport_rect().size
	var span := (bottom_right - top_left).abs()
	var fit := minf((view.x - padding.x - padding.z) / maxf(span.x, 0.0001), (view.y - padding.y - padding.w) / maxf(span.y, 0.0001))
	var zoom: float = clampf(minf(fit, pow(2.0, max_level) / 8.0), MapView.MIN_ZOOM, MapView.MAX_ZOOM)
	var aim := Vector2((padding.x + view.x - padding.z) * 0.5, (padding.y + view.y - padding.w) * 0.5)
	var centre := (top_left + bottom_right) * 0.5 - (aim - view * 0.5) / zoom
	var short_side := minf(view.x, view.y)
	var pad := clampf(roundf(short_side * 0.12), 16.0, 80.0) if short_side > 0.0 else 40.0
	var half := Vector2((view.x - 2.0 * pad) / zoom, (view.y - 2.0 * pad) / zoom) * 0.5
	var corner_a := _world_to_lnglat(centre - half)
	var corner_b := _world_to_lnglat(centre + half)
	map.fit_lonlat_bounds([[corner_a.x, corner_b.y], [corner_b.x, corner_a.y]], log(zoom * 8.0) / log(2.0) + 0.01, duration)


static func _world_to_lnglat(world: Vector2) -> Vector2:
	var lng := world.x / MapView.WORLD_WIDTH * 360.0 - 180.0
	var lat := rad_to_deg(2.0 * atan(exp((0.5 - world.y / MapView.WORLD_WIDTH) * 2.0 * PI)) - PI / 2.0)
	return Vector2(lng, lat)


func screen_to_lnglat(point: Vector2) -> Vector2:
	return _world_to_lnglat(map.screen_to_world(point))


static func unwrap_lng(lng: float, around: float) -> float:
	return lng - round((lng - around) / 360.0) * 360.0


func _project_way(points: Array) -> PackedVector2Array:
	var out := PackedVector2Array()
	if points.is_empty():
		return out
	if map.is_globe():
		for point in points:
			var lng := float(point[0])
			var world := MapView.CityLayer.ohproject(lng, float(point[1]))
			world.x = (lng + 180.0) / 360.0 * MapView.WORLD_WIDTH
			out.append(map.world_to_screen(world))
		return out
	var zoom := map.camera.zoom.x
	var half := map.get_viewport_rect().size * 0.5
	var shift := 0.0
	var first := true
	for point in points:
		var lng := float(point[0])
		var lat := float(point[1])
		var world := MapView.CityLayer.ohproject(lng, lat)
		world.x = (lng + 180.0) / 360.0 * MapView.WORLD_WIDTH
		if first:
			shift = MapView.WORLD_WIDTH * round((map.camera.position.x - world.x) / MapView.WORLD_WIDTH)
			first = false
		out.append((world + Vector2(shift, 0) - map.camera.position) * zoom + half)
	return out


func _zoom_value(stops: Array) -> float:
	var level := map.zoom_level()
	if level <= float(stops[0][0]):
		return float(stops[0][1])
	for index in range(1, stops.size()):
		var stop: Array = stops[index]
		if level <= float(stop[0]):
			var previous: Array = stops[index - 1]
			return lerpf(float(previous[1]), float(stop[1]), (level - float(previous[0])) / (float(stop[0]) - float(previous[0])))
	return float(stops[stops.size() - 1][1])


func _draw() -> void:
	last_labels = PackedStringArray()
	if not map or not store or not bool(store.value("open")):
		_publish([])
		return
	_war_seen = map.war_label_rects.duplicate()
	_taken = _war_seen.duplicate()
	var plan_labels := _place_plan_labels()
	var line_labels := _place_line_labels()
	var own: Array[Rect2] = []
	for index in range(_war_seen.size(), _taken.size()):
		own.append(_taken[index])
	_publish(own)
	_draw_shade()
	_draw_lines(line_labels)
	_draw_plans()
	_draw_plan_labels(plan_labels)
	_draw_fleets()
	_draw_tool()


func _publish(rects: Array[Rect2]) -> void:
	label_rects = rects
	if map:
		map.room_set_label_rects(rects)


func _fits(boxes: Array[Rect2]) -> bool:
	for box in boxes:
		for other in _taken:
			if other.intersects(box):
				return false
	return true


func _draw_shade() -> void:
	var runs: Array = []
	if bool(store.value("supply")) and store.value("supply_shade") is Array:
		runs.append_array(store.value("supply_shade"))
	if store.value("rehearsal_shade") is Array:
		runs.append_array(store.value("rehearsal_shade"))
	if runs.is_empty():
		return
	var view := get_viewport_rect().size
	for run in runs:
		var entry: Array = run
		var kind := int(entry[0])
		if kind < 0 or kind >= SHADE_COLOURS.size():
			continue
		var corners := _project_way([[entry[1], entry[2]], [entry[3], entry[4]]])
		var box := Rect2(corners[0], Vector2.ZERO).expand(corners[1])
		if box.end.x < 0 or box.end.y < 0 or box.position.x > view.x or box.position.y > view.y:
			continue
		draw_rect(box, SHADE_COLOURS[kind])


func _line_width(level: int) -> float:
	return _zoom_value([[3, 1.0 + 0.22 * level], [8, 2.0 + 0.5 * level]])


func _casing_width(level: int) -> float:
	return _zoom_value([[3, 3.0 + 0.22 * level], [8, 4.5 + 0.5 * level]])


func _draw_lines(labels: Array) -> void:
	for entry in labels:
		_draw_text_at(entry[5], str(entry[2]), entry[3], int(entry[4]))
	var draft: Variant = store.value("draft")
	if draft is Array and (draft as Array).size() >= 2:
		var level := int(store.value("level"))
		var points := _project_way(draft)
		_draw_round_polyline(points, Color(5 / 255.0, 8 / 255.0, 13 / 255.0, 0.8), _casing_width(level))
		_draw_dots(points, WarRoomWords.line_colour(level), _line_width(level), 0.3, 1.6)


func _world_way(points: Array) -> PackedVector2Array:
	var out := PackedVector2Array()
	var shift := 0.0
	for index in range(points.size()):
		var lng := float(points[index][0])
		var world := MapView.CityLayer.ohproject(lng, float(points[index][1]))
		world.x = (lng + 180.0) / 360.0 * MapView.WORLD_WIDTH
		if index == 0:
			shift = MapView.WORLD_WIDTH * round((map.camera.position.x - world.x) / MapView.WORLD_WIDTH)
		out.append(world + Vector2(shift, 0))
	return out


static func _clip_pieces(line: PackedVector2Array, box: Rect2) -> Array:
	var pieces: Array = []
	var current := PackedVector2Array()
	for index in range(line.size() - 1):
		var a := line[index]
		var b := line[index + 1]
		var t0 := 0.0
		var t1 := 1.0
		var d := b - a
		var inside := true
		for edge in [[-d.x, a.x - box.position.x], [d.x, box.end.x - a.x], [-d.y, a.y - box.position.y], [d.y, box.end.y - a.y]]:
			var p: float = edge[0]
			var q: float = edge[1]
			if absf(p) < 1e-12:
				if q < 0.0:
					inside = false
					break
				continue
			var r := q / p
			if p < 0.0:
				t0 = maxf(t0, r)
			else:
				t1 = minf(t1, r)
			if t0 > t1:
				inside = false
				break
		if not inside:
			if current.size() >= 2:
				pieces.append(current)
			current = PackedVector2Array()
			continue
		var start := a + d * t0
		var finish := a + d * t1
		if current.is_empty() or t0 > 0.0:
			if current.size() >= 2:
				pieces.append(current)
			current = PackedVector2Array([start])
		current.append(finish)
		if t1 < 1.0:
			pieces.append(current)
			current = PackedVector2Array()
	if current.size() >= 2:
		pieces.append(current)
	return pieces


static func _anchors(line: PackedVector2Array, offset: float, spacing: float, label_length: float, continued: bool, middle: bool, extent: float) -> Array:
	var total := 0.0
	for index in range(1, line.size()):
		total += line[index].distance_to(line[index - 1])
	var half := label_length / 2.0
	var distance := 0.0
	var marked := offset - spacing
	var found: Array = []
	for index in range(line.size() - 1):
		var a := line[index]
		var b := line[index + 1]
		var segment := a.distance_to(b)
		while marked + spacing < distance + segment:
			marked += spacing
			var at := a.lerp(b, (marked - distance) / segment)
			if at.x >= 0.0 and at.x < extent and at.y >= 0.0 and at.y < extent and marked - half >= 0.0 and marked + half <= total:
				found.append([at, (b - a).angle()])
		distance += segment
	if not middle and found.is_empty() and not continued:
		found = _anchors(line, distance / 2.0, spacing, label_length, continued, true, extent)
	return found


static func _upright(angle: float) -> float:
	return angle + PI if angle > PI / 2.0 or angle < -PI / 2.0 else angle


func _line_label_frame(spot: Vector2, screen: Vector2, angle: float) -> Transform2D:
	if not map.is_globe():
		return Transform2D(_upright(angle), screen)
	var plane := map.screen_frame_at(spot)
	var heading := plane.basis_xform(Vector2.from_angle(angle))
	var turned := angle + PI if heading.x < 0.0 else angle
	return map.label_plane_frame(spot, turned, map.label_plane_scale(spot))


func _line_label_boxes(frame: Transform2D, width: float, size: int) -> Array[Rect2]:
	var along := frame.basis_xform(Vector2.RIGHT)
	var across := frame.basis_xform(Vector2.DOWN)
	var count := maxi(1, int(ceil(width / float(size))))
	var half := float(size) * 0.5 * maxf(across.length(), along.length()) + TEXT_PADDING
	var boxes: Array[Rect2] = []
	for index in range(count):
		var centre := frame.origin + along * ((float(index) + 0.5) / float(count) - 0.5) * width - across * 1.1 * float(size)
		boxes.append(Rect2(centre - Vector2(half, half), Vector2(half, half) * 2.0))
	return boxes


func _draw_text_at(frame: Transform2D, label: String, colour: Color, size: int) -> void:
	var font := UI.font(700)
	var width := font.get_string_size(label, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
	var baseline := -1.1 * size + (font.get_ascent(size) - font.get_descent(size)) * 0.5
	last_labels.append(label)
	draw_set_transform_matrix(frame)
	draw_string_outline(font, Vector2(-width * 0.5, baseline), label, HORIZONTAL_ALIGNMENT_LEFT, -1, size, 3, HALO)
	draw_string(font, Vector2(-width * 0.5, baseline), label, HORIZONTAL_ALIGNMENT_LEFT, -1, size, colour)
	draw_set_transform(Vector2.ZERO, 0.0)


func _place_line_labels() -> Array:
	var placed: Array = []
	var level := map.zoom_level()
	var tile_zoom := floorf(level)
	var tile_world := MapView.WORLD_WIDTH / pow(2.0, tile_zoom)
	var size := int(round(_zoom_value([[4, 10.0], [8, 13.0]])))
	var font := UI.font(700)
	var half_view := map.get_viewport_rect().size * 0.5
	for mark in record.get("marks", []):
		var entry: Dictionary = mark
		var label := str(entry.get("label", ""))
		if label.is_empty() or str(entry.get("what", "")) == "draft":
			continue
		var world := _world_way(entry.get("points", []))
		if world.size() < 2:
			continue
		var label_length := font.get_string_size(label, HORIZONTAL_ALIGNMENT_LEFT, -1, 13).x
		var spacing := SYMBOL_SPACING
		if spacing - label_length < spacing / 4.0:
			spacing = label_length + spacing / 4.0
		var bounds := Rect2(world[0], Vector2.ZERO)
		for point in world:
			bounds = bounds.expand(point)
		var colour := Color(str(entry.get("colour", "#e09440")))
		for tx in range(int(floor(bounds.position.x / tile_world)), int(floor(bounds.end.x / tile_world)) + 1):
			for ty in range(int(floor(bounds.position.y / tile_world)), int(floor(bounds.end.y / tile_world)) + 1):
				var tile := Rect2(Vector2(tx, ty) * tile_world, Vector2(tile_world, tile_world))
				for piece in _clip_pieces(world, tile):
					var local := PackedVector2Array()
					for point in piece:
						local.append((point - tile.position) / tile_world * TILE_PX)
					var first: Vector2 = local[0]
					var continued := first.x <= 0.0001 or first.y <= 0.0001 or first.x >= TILE_PX - 0.0001 or first.y >= TILE_PX - 0.0001
					var offset := fmod(spacing / 2.0, spacing) if continued else fmod(label_length / 2.0 + 26.0, spacing)
					for anchor in _anchors(local, offset, spacing, label_length, continued, false, TILE_PX):
						var spot: Vector2 = tile.position + (anchor[0] as Vector2) / TILE_PX * tile_world
						var screen := map.world_to_screen(spot) if map.is_globe() else (spot - map.camera.position) * map.camera.zoom.x + half_view
						var frame := _line_label_frame(spot, screen, float(anchor[1]))
						var boxes := _line_label_boxes(frame, font.get_string_size(label, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x, size)
						if not _fits(boxes):
							continue
						_taken.append_array(boxes)
						placed.append([screen, float(anchor[1]), label, colour, size, frame])
	return placed


func _draw_round_polyline(points: PackedVector2Array, colour: Color, width: float) -> void:
	if points.size() < 2:
		return
	draw_polyline(points, colour, width, true)
	for point in points:
		draw_circle(point, width * 0.5, colour, true, -1.0, true)


func _draw_dashed(points: PackedVector2Array, colour: Color, width: float, on: float, off: float) -> void:
	var dash := on * width
	var gap := off * width
	var drawing := true
	var left := dash
	for index in range(1, points.size()):
		var a := points[index - 1]
		var b := points[index]
		var length := a.distance_to(b)
		var at := 0.0
		while at < length:
			var step := minf(left, length - at)
			if drawing and step > 0.0:
				draw_line(a.lerp(b, at / length), a.lerp(b, (at + step) / length), colour, width, true)
			at += step
			left -= step
			if left <= 0.0001:
				drawing = not drawing
				left = dash if drawing else gap


func _draw_dots(points: PackedVector2Array, colour: Color, width: float, on: float, off: float) -> void:
	var spacing := maxf(1.0, (on + off) * width)
	var carry := 0.0
	for index in range(1, points.size()):
		var a := points[index - 1]
		var b := points[index]
		var length := a.distance_to(b)
		var at := carry
		while at < length:
			draw_circle(a.lerp(b, at / length), width * 0.5, colour, true, -1.0, true)
			at += spacing
		carry = at - length


static func smooth_way(way: Array, rounds := 2) -> Array:
	var points := way
	for _round in range(rounds):
		if points.size() < 3:
			break
		var next: Array = [points[0]]
		for index in range(points.size() - 1):
			var a: Array = points[index]
			var b: Array = points[index + 1]
			if index > 0:
				next.append([float(a[0]) * 0.75 + float(b[0]) * 0.25, float(a[1]) * 0.75 + float(b[1]) * 0.25])
			if index + 2 < points.size():
				next.append([float(a[0]) * 0.25 + float(b[0]) * 0.75, float(a[1]) * 0.25 + float(b[1]) * 0.75])
		next.append(points[points.size() - 1])
		points = next
	return points


static func middle_of(way: Array) -> Array:
	var half := length_of(way) / 2.0
	var walked := 0.0
	for index in range(1, way.size()):
		var shrink := cos(((float(way[index][1]) + float(way[index - 1][1])) / 2.0) * RAD)
		var dx := (float(way[index][0]) - float(way[index - 1][0])) * shrink
		var dy := float(way[index][1]) - float(way[index - 1][1])
		var step := sqrt(dx * dx + dy * dy)
		if walked + step >= half and step > 0.0:
			var part := (half - walked) / step
			return [float(way[index - 1][0]) + (float(way[index][0]) - float(way[index - 1][0])) * part, float(way[index - 1][1]) + (float(way[index][1]) - float(way[index - 1][1])) * part]
		walked += step
	return way[way.size() - 1]


static func length_of(way: Array) -> float:
	var total := 0.0
	for index in range(1, way.size()):
		var shrink := cos(((float(way[index][1]) + float(way[index - 1][1])) / 2.0) * RAD)
		var dx := (float(way[index][0]) - float(way[index - 1][0])) * shrink
		var dy := float(way[index][1]) - float(way[index - 1][1])
		total += sqrt(dx * dx + dy * dy)
	return total


static func arrow_head(way: Array) -> Array:
	if way.size() < 2:
		return []
	var tip: Array = way[way.size() - 1]
	var from: Array = []
	for index in range(way.size() - 2, -1, -1):
		var ddx := float(tip[0]) - float(way[index][0])
		var ddy := float(tip[1]) - float(way[index][1])
		if ddx * ddx + ddy * ddy > 1e-8:
			from = way[index]
			break
	if from.is_empty():
		return []
	var shrink := maxf(0.1, cos(float(tip[1]) * RAD))
	var dx := (float(tip[0]) - float(from[0])) * shrink
	var dy := float(tip[1]) - float(from[1])
	var length := sqrt(dx * dx + dy * dy)
	var ux := dx / length
	var uy := dy / length
	var size := maxf(0.09, minf(0.32, length_of(way) * 0.13))
	var back := [float(tip[0]) - (ux * size) / shrink, float(tip[1]) - uy * size]
	var half := size * 0.55
	var left := [back[0] - (uy * half) / shrink, back[1] + ux * half]
	var right := [back[0] + (uy * half) / shrink, back[1] - ux * half]
	return [tip, left, right]


func _plan_width(pointed: bool) -> float:
	return _zoom_value([[3, 3.2 if pointed else 2.0], [8, 6.0 if pointed else 4.0]])


func _plan_casing(pointed: bool) -> float:
	return _zoom_value([[3, 5.6 if pointed else 4.0], [8, 9.5 if pointed else 7.0]])


func _draw_plans() -> void:
	var pointed := str(store.value("pointed"))
	for pair in _drawn_plans():
		var plan: Dictionary = pair[0]
		var theirs: bool = pair[1]
		var tone := WarRoomWords.plan_tone(plan, theirs)
		var colour: Color = WarRoomTheme.PLAN_COLOURS[tone]
		var lit := str(plan.get("id", "")) == pointed
		var ways: Array = plan.get("ways", [])
		if tone == "deploy" and str(plan.get("form", "")) == "swarm":
			if not ways.is_empty() and (ways[0] as Array).size() > 0:
				var spot: Array = ways[0][0]
				var at := _project_way([spot])[0]
				var radius := _zoom_value([[3, 6.0 if lit else 4.5], [8, 9.0 if lit else 7.0]])
				draw_circle(at, radius + 1.5, CASING, true, -1.0, true)
				draw_circle(at, radius, colour, true, -1.0, true)
			continue
		for raw in ways:
			var way_points: Array = raw
			if way_points.size() < 2:
				continue
			var way := smooth_way(way_points)
			var points := _project_way(way)
			_draw_round_polyline(points, CASING, _plan_casing(lit))
			var width := _plan_width(lit)
			if tone == "decoy":
				_draw_dots(points, colour, width, 0.2, 1.9)
			elif tone == "deploy":
				_draw_round_polyline(points, colour, width)
			else:
				_draw_dashed(points, colour, width, 2.4, 1.3)
			if tone != "deploy":
				var head := arrow_head(way)
				if not head.is_empty():
					var shape := _project_way(head)
					draw_colored_polygon(shape, colour)
					var outline := shape.duplicate()
					outline.append(shape[0])
					draw_polyline(outline, Color(5 / 255.0, 8 / 255.0, 13 / 255.0, 0.9), 1.0, true)


func _drawn_plans() -> Array:
	var pointed := str(store.value("pointed"))
	var drawn: Array = []
	for plan in store.value("plans"):
		var entry: Dictionary = plan
		if (not bool(entry.get("begun", false)) and not bool(entry.get("done", false))) or str(entry.get("id", "")) == pointed:
			drawn.append([entry, false])
	for plan in store.value("known"):
		drawn.append([plan, true])
	return drawn


func _label_ratio(lnglat: Array) -> float:
	if not map.is_globe():
		return 1.0
	return map.label_perspective(_lnglat_world(lnglat))


func _lnglat_world(lnglat: Array) -> Vector2:
	var lng := float(lnglat[0])
	var world := MapView.CityLayer.ohproject(lng, float(lnglat[1]))
	world.x = (lng + 180.0) / 360.0 * MapView.WORLD_WIDTH
	return world


func _place_plan_labels() -> Array:
	var placed: Array = []
	var font := UI.font(700)
	var base_size := _zoom_value([[3, 10.0], [8, 13.0]])
	for pair in _drawn_plans():
		var plan: Dictionary = pair[0]
		var tone := WarRoomWords.plan_tone(plan, pair[1])
		if tone == "deploy" and str(plan.get("form", "")) == "swarm":
			continue
		var label := str(plan.get("name", "")).strip_edges() if str(plan.get("kind", "")) == "project" or not str(plan.get("project", "")).is_empty() else ""
		if label.is_empty():
			continue
		var middle: Array = []
		for raw in plan.get("ways", []):
			if (raw as Array).size() >= 2:
				middle = middle_of(smooth_way(raw))
				break
		if middle.is_empty():
			continue
		var at := _project_way([middle])[0]
		var ratio := _label_ratio(middle)
		if ratio < MapView.LABEL_PERSPECTIVE_CUTOFF:
			continue
		var size := maxi(1, int(round(base_size * ratio)))
		var most := 12.0 * size
		var height := font.get_height(size)
		var rows: Array[String] = []
		var row := ""
		for word in label.split(" ", false):
			var trial: String = word if row.is_empty() else row + " " + word
			if not row.is_empty() and font.get_string_size(trial, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x > most:
				rows.append(row)
				row = word
			else:
				row = trial
		if not row.is_empty():
			rows.append(row)
		var top := at.y - 1.1 * size - height * rows.size() * 0.5
		var widest := 0.0
		for text in rows:
			widest = maxf(widest, font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x)
		var box := Rect2(at.x - widest * 0.5, top, widest, height * rows.size()).grow(TEXT_PADDING)
		var boxes: Array[Rect2] = [box]
		if not _fits(boxes):
			continue
		_taken.append(box)
		placed.append([at, rows, top, WarRoomTheme.PLAN_COLOURS[tone], size, label])
	return placed


func _draw_plan_labels(labels: Array) -> void:
	var font := UI.font(700)
	for entry in labels:
		var at: Vector2 = entry[0]
		var rows: Array = entry[1]
		var top: float = entry[2]
		var colour: Color = entry[3]
		var size: int = entry[4]
		var height := font.get_height(size)
		last_labels.append(str(entry[5]))
		for index in range(rows.size()):
			var text: String = rows[index]
			var width := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
			var spot := Vector2(at.x - width * 0.5, top + height * index + font.get_ascent(size))
			draw_string_outline(font, spot, text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, 3, HALO)
			draw_string(font, spot, text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, colour)


static func ring_around(lng: float, lat: float, km: float, count := 48) -> Array:
	var delta := maxf(0.0, km) / EARTH_KM
	var phi := lat * RAD
	var lambda := lng * RAD
	var ring: Array = []
	for index in range(count):
		var bearing := (float(index) / count) * PI * 2.0
		var phi2 := asin(sin(phi) * cos(delta) + cos(phi) * sin(delta) * cos(bearing))
		var lambda2 := lambda + atan2(sin(bearing) * sin(delta) * cos(phi), cos(delta) - sin(phi) * sin(phi2))
		ring.append([lambda2 / RAD, phi2 / RAD])
	ring.append(ring[0])
	return ring


func _draw_fleets() -> void:
	var picked := str(store.value("fleet"))
	var radius_stops := func(lit: bool) -> float: return _zoom_value([[2, 13.0 if lit else 10.0], [6, 18.0 if lit else 14.0], [12, 24.0 if lit else 19.0]])
	for fleet in record.get("fleets", []):
		var entry: Dictionary = fleet
		var lit := not picked.is_empty() and str(entry.get("id", "")) == picked
		var colour: Color = FLEET_COLOURS["picked"] if lit else FLEET_COLOURS["fleet"]
		var lng := float(entry.get("lng", 0))
		var lat := float(entry.get("lat", 0))
		var order: Variant = entry.get("order")
		if typeof(order) == TYPE_DICTIONARY:
			var standing: Dictionary = order
			var to_lng := float(standing.get("toLng", 0))
			var to_lat := float(standing.get("toLat", 0))
			if str(standing.get("kind", "")) == "patrol" and float(standing.get("radiusKm", 0)) > 0.0:
				var ring := _project_way(ring_around(to_lng, to_lat, float(standing.get("radiusKm", 0))))
				_draw_dashed(ring, Color(colour, 0.95 if lit else 0.7), 2.4 if lit else 1.6, 2.2, 1.6)
			elif str(standing.get("kind", "")) == "move":
				var course_colour: Color = FLEET_COLOURS["course"]
				var to := [to_lng + 360.0 * round((lng - to_lng) / 360.0), to_lat]
				var way := [[lng, lat], to]
				var points := _project_way(way)
				_draw_dashed(points, Color(course_colour, 1.0 if lit else 0.75), 3.0 if lit else 2.0, 2.4, 1.3)
				var head := arrow_head(way)
				if not head.is_empty():
					var shape := _project_way(head)
					draw_colored_polygon(shape, Color(course_colour, 1.0 if lit else 0.75))
		var at := _project_way([[lng, lat]])[0]
		draw_arc(at, radius_stops.call(lit), 0.0, TAU, 48, colour, 3.0 if lit else 1.8, true)


func _draw_tool() -> void:
	if _draft == null:
		return
	if _draft is Rect2:
		var box: Rect2 = (_draft as Rect2).abs()
		draw_rect(box, Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.14))
		var corners := PackedVector2Array([box.position, Vector2(box.end.x, box.position.y), box.end, Vector2(box.position.x, box.end.y), box.position])
		_dash_px(corners, ACCENT, 1.5, 6.0, 4.0)
		return
	var points: PackedVector2Array = _draft
	if points.size() < 2:
		return
	var tool := str(store.value("tool"))
	var colour: Color = WarRoomWords.line_colour(int(store.value("level"))) if tool == "fortify" else DRAW_COLOURS.get(tool, ACCENT)
	_draw_round_polyline(points, Color(5 / 255.0, 8 / 255.0, 13 / 255.0, 0.85), 7.0)
	if tool == "diversion":
		_dash_px(points, colour, 3.5, 3.0, 9.0, true)
	else:
		_draw_round_polyline(points, colour, 3.5)


func _dash_px(points: PackedVector2Array, colour: Color, width: float, on: float, off: float, round_caps := false) -> void:
	var drawing := true
	var left := on
	for index in range(1, points.size()):
		var a := points[index - 1]
		var b := points[index]
		var length := a.distance_to(b)
		var at := 0.0
		while at < length:
			var step := minf(left, length - at)
			if drawing and step > 0.0:
				var from := a.lerp(b, at / length)
				var to := a.lerp(b, (at + step) / length)
				draw_line(from, to, colour, width, true)
				if round_caps:
					draw_circle(from, width * 0.5, colour, true, -1.0, true)
					draw_circle(to, width * 0.5, colour, true, -1.0, true)
			at += step
			left -= step
			if left <= 0.0001:
				drawing = not drawing
				left = on if drawing else off


func _placing() -> bool:
	var tool := str(store.value("tool"))
	return tool == "transport" or tool == "fleet" or (tool == "deploy" and str(store.value("deploy_form")) == "swarm")


func _mine() -> Array:
	return record.get("standing", [])


func _pick_at(point: Vector2) -> int:
	var best := -1
	var best_px := PICK_PX * PICK_PX
	var mine := _mine()
	for index in range(mine.size()):
		var place: Variant = mine[index]
		if not (place is Array):
			continue
		var shown := _project_way([place])[0]
		var off := shown.distance_squared_to(point)
		if off <= best_px:
			best_px = off
			best = index
	return best


func _in_frame(place: Vector2) -> Array:
	return [unwrap_lng(place.x, float(record.get("frameLng", 0.0))), place.y]


func _gui_input(event: InputEvent) -> void:
	if not map or not store or str(store.value("tool")) == "pan":
		return
	if event is InputEventMouseButton:
		var button := event as InputEventMouseButton
		if button.button_index == MOUSE_BUTTON_WHEEL_UP or button.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			if button.pressed:
				map._zoom_at(button.position, 1.15 if button.button_index == MOUSE_BUTTON_WHEEL_UP else 1.0 / 1.15)
			accept_event()
			return
		if button.button_index != MOUSE_BUTTON_LEFT:
			accept_event()
			return
		if button.pressed:
			_press(button.position, button.shift_pressed)
		else:
			_release(button.position)
		accept_event()
	elif event is InputEventMouseMotion and not _held.is_empty():
		_move((event as InputEventMouseMotion).position)
		accept_event()
	elif event is InputEventMagnifyGesture:
		var magnify := event as InputEventMagnifyGesture
		map._zoom_at(magnify.position, magnify.factor)
		accept_event()


func _press(point: Vector2, add: bool) -> void:
	_held = {"from": point, "way": PackedVector2Array([point]), "add": add, "moved": 0.0}
	var tool := str(store.value("tool"))
	if tool == "select":
		_draft = Rect2(point, Vector2.ZERO)
	elif _placing():
		_draft = null
	else:
		_draft = PackedVector2Array([point])
	queue_redraw()


func _move(point: Vector2) -> void:
	if _held.is_empty():
		return
	var way: PackedVector2Array = _held["way"]
	var last := way[way.size() - 1]
	if _placing():
		_held["moved"] = float(_held["moved"]) + absf(point.x - last.x) + absf(point.y - last.y)
		way.append(point)
		_held["way"] = way
		map.view_pan(point - last, point)
		map._after_camera_move()
		return
	if str(store.value("tool")) == "select":
		var from: Vector2 = _held["from"]
		_draft = Rect2(from, point - from)
		queue_redraw()
		return
	if point.distance_squared_to(last) < WAY_STEP_PX * WAY_STEP_PX:
		return
	way.append(point)
	_held["way"] = way
	_draft = way
	queue_redraw()


func _release(point: Vector2) -> void:
	if _held.is_empty():
		return
	var done := _held
	_held = {}
	_draft = null
	queue_redraw()
	var tool := str(store.value("tool"))
	var from: Vector2 = done["from"]
	if tool == "select":
		var before: Array = []
		if bool(done["add"]):
			before = (store.value("selected") as Array).duplicate()
		var moved := absf(point.x - from.x) + absf(point.y - from.y)
		if moved < CLICK_PX:
			var picked := _pick_at(point)
			if picked >= 0:
				if picked in before:
					before.erase(picked)
				else:
					before.append(picked)
		else:
			var box := Rect2(from, point - from).abs()
			var mine := _mine()
			for index in range(mine.size()):
				var place: Variant = mine[index]
				if not (place is Array):
					continue
				var shown := _project_way([place])[0]
				if shown.x >= box.position.x and shown.x <= box.end.x and shown.y >= box.position.y and shown.y <= box.end.y and not index in before:
					before.append(index)
		before.sort()
		store.set_values({"selected": before})
		return
	if tool == "transport":
		if float(done["moved"]) >= CLICK_PX:
			return
		var place := screen_to_lnglat(point)
		var medium := str(store.value("medium"))
		store.take_tool("pan")
		store.report_way("transport", [[place.x, place.y]], {"medium": medium})
		return
	if tool == "deploy" and str(store.value("deploy_form")) == "swarm":
		if float(done["moved"]) >= CLICK_PX:
			return
		var spot := _in_frame(screen_to_lnglat(point))
		store.take_tool("pan")
		store.report_way("deploy", [spot], {"form": "swarm"})
		return
	if tool == "fleet":
		if float(done["moved"]) >= CLICK_PX:
			return
		var at := screen_to_lnglat(point)
		var fleet := str(store.value("fleet"))
		var station := str(store.value("station"))
		store.take_tool("pan")
		store.report_way("fleet", [[unwrap_lng(at.x, 0.0), at.y]], {"fleet": fleet, "station": station})
		return
	var way: PackedVector2Array = done["way"]
	var length := 0.0
	for index in range(1, way.size()):
		length += way[index].distance_to(way[index - 1])
	if length < WAY_LEAST_PX:
		return
	var drawn: Array = []
	for screen in way:
		drawn.append(_in_frame(screen_to_lnglat(screen)))
	var replan := str(store.value("replan"))
	store.take_tool("pan")
	store.report_way(tool, drawn, {"replan": replan})


func cancel_drawing() -> void:
	_held = {}
	_draft = null
	queue_redraw()
