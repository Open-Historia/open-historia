class_name WarOverlay
extends Node2D

const WORLD := 4096.0
const COUNTER_STOPS := [[2, 7.0, 5.25], [6, 11.0, 8.25], [12, 16.0, 12.0]]
const FLAG_DISC_RATIO := 0.82
const UNIT_GLYPH_SIZE := [[2, 10], [6, 13], [12, 18]]
const UNIT_NAME_SIZE := [[3, 9], [8, 11], [12, 13]]
const SIDE_RADIUS := [[2, 6], [5, 10]]
const SIDE_COUNT_SIZE := [[2, 8], [5, 11]]
const SIDE_LIT_RADIUS := [[2, 10], [5, 15]]
const TROOP_LIT := [[3, 7], [7, 13], [10, 19]]
const TROOP_NAMED := [[4.75, 4.2], [7, 7.2], [10, 11]]
const TROOP_PLAIN := [[4.75, 3.1], [7, 5.6], [10, 9]]
const RAMPART_NAMED := [[4.75, 6.4], [7, 10.4], [10, 15]]
const RAMPART_PLAIN := [[4.75, 5.2], [7, 8.6], [10, 12.8]]
const TROOP_KIND_SIZE := [[6.5, 7], [10, 11]]
const TROOP_NAME_SIZE := [[6, 9], [10, 12]]
const WAY_CASING_WIDTH := [[2, 2.6], [7, 4.6]]
const WAY_WIDTH := [[2, 1.3], [7, 2.6]]
const TRANSPORT_ICON := [[2, 0.7], [6, 1.05], [9, 1.35]]
const LOST_SIZE := [[2, 20], [7, 30]]
const AIR_SIZE := [[3, 0.32], [6, 0.5], [9, 0.78]]
const BLOCKADE_WIDTH := [[2, 1.4], [7, 2.6]]
const BATTLE_RADIUS := [[2, 7], [6, 11], [9, 14]]
const BATTLE_STROKE := [[2, 1.5], [7, 2.5]]
const BATTLE_MARK := [[2, 13], [6, 19], [9, 24]]
const MARKER_SHAPE_SIZE := [[3, 13], [7, 19], [11, 25]]
const MARKER_LABEL_SIZE := [[4, 8.5], [10, 10.5]]
const MARKER_TIERS := {"strategic": [3.0, 3.8], "regional": [4.2, 5.0], "local": [5.8, 6.6]}
const GROUP_LABEL_SIZE := [[2, 10], [5, 12.5], [8, 15]]
const ACCENT := Color("#2bc1f3")
const EDGE := Color(5 / 255.0, 8 / 255.0, 13 / 255.0, 0.92)
const SHIPS := {
	"sea": [[[24, 3], [31, 13], [33, 24], [33, 39], [29, 44], [19, 44], [15, 39], [15, 24], [17, 13]]],
	"land": [[[18, 4], [30, 4], [32, 7], [32, 21], [16, 21], [16, 7]], [[16, 25], [32, 25], [32, 43], [16, 43]]],
	"air": [[[24, 2], [27, 10], [28, 19], [45, 29], [45, 33], [28, 29], [27, 38], [33, 43], [33, 45], [24, 43], [15, 45], [15, 43], [21, 38], [20, 29], [3, 33], [3, 29], [20, 19], [21, 10]]],
}
const SHIP_MARKS := {
	"sea": [[[24, 12], [24, 38]], [[19, 26], [29, 26]]],
	"land": [[[24, 21], [24, 25]], [[19, 12], [29, 12]], [[19, 34], [29, 34]]],
	"air": [],
}
const PLANE := [[24, 2], [27, 10], [28, 19], [45, 29], [45, 33], [28, 29], [27, 38], [33, 43], [33, 45], [24, 43], [15, 45], [15, 43], [21, 38], [20, 29], [3, 33], [3, 29], [20, 19], [21, 10]]


class Painter extends Node2D:
	var paint: Callable

	func _draw() -> void:
		if paint.is_valid():
			paint.call(self)


var map: MapView
var level := 2.0
var zoom := 1.0
var camera := Vector2.ZERO
var view := Vector2.ZERO
var every_troop := false
var war_room := {"open": false, "battlefield": "", "side": -1, "highlight": -1, "selected": []}
var units: Array = []
var unit_positions: Dictionary = {}
var markers: Array = []
var troops: Array = []
var sides: Array = []
var troop_colours: Array = []
var troop_fields: Array = []
var transports: Dictionary = {}
var carrier_override: Dictionary = {}
var planes: Array = []
var seas: Dictionary = {}
var strikes: Dictionary = {}
var group_labels: Array = []
var _unit_hits: Array = []
var _taken_base: Array[Rect2] = []
var _taken_top: Array[Rect2] = []
var _base: Painter
var _planes: Painter
var _top: Painter
var _strikes: Painter
var _caches := {}


func _ready() -> void:
	_base = _part(_paint_base)
	_planes = _part(_paint_planes)
	_top = _part(_paint_top)
	_strikes = _part(_paint_strikes)


func _part(callable: Callable) -> Painter:
	var node := Painter.new()
	node.paint = callable
	add_child(node)
	return node


func redraw() -> void:
	for part in [_base, _planes, _top, _strikes]:
		if part:
			part.queue_redraw()


func redraw_base() -> void:
	if _base:
		_base.queue_redraw()


func redraw_planes() -> void:
	if _planes:
		_planes.queue_redraw()


func redraw_top() -> void:
	if _top:
		_top.queue_redraw()


func redraw_strikes() -> void:
	if _strikes:
		_strikes.queue_redraw()


func _font(weight := 700) -> Font:
	return UI.font(weight)


func _screen(world: Vector2) -> Vector2:
	var x: float = world.x + WORLD * roundf((camera.x - world.x) / WORLD)
	return (Vector2(x, world.y) - camera) * zoom + view * 0.5


func _copies(screen: Vector2, margin: float) -> Array[Vector2]:
	var out: Array[Vector2] = []
	var span := WORLD * zoom
	for k in [-1, 0, 1]:
		var p := screen + Vector2(span * k, 0)
		if p.x > -margin and p.x < view.x + margin and p.y > -margin and p.y < view.y + margin:
			out.append(p)
	return out


func _screen_line(world_points: PackedVector2Array) -> PackedVector2Array:
	var out := PackedVector2Array()
	if world_points.is_empty():
		return out
	var shift: float = WORLD * roundf((camera.x - world_points[0].x) / WORLD)
	out.resize(world_points.size())
	for index in range(world_points.size()):
		var p := world_points[index]
		out[index] = (Vector2(p.x + shift, p.y) - camera) * zoom + view * 0.5
	return out


func _line_copies(line: PackedVector2Array) -> Array[PackedVector2Array]:
	var out: Array[PackedVector2Array] = []
	if line.size() < 2:
		return out
	var box := Rect2(line[0], Vector2.ZERO)
	for p in line:
		box = box.expand(p)
	var span := WORLD * zoom
	var screen := Rect2(Vector2(-40, -40), view + Vector2(80, 80))
	for k in [-1, 0, 1]:
		var moved := Rect2(box.position + Vector2(span * k, 0), box.size)
		if not moved.intersects(screen):
			continue
		if k == 0:
			out.append(line)
			continue
		var copy := PackedVector2Array()
		copy.resize(line.size())
		for index in range(line.size()):
			copy[index] = line[index] + Vector2(span * k, 0)
		out.append(copy)
	return out


func _text_size(text: String, size: int, weight := 700) -> Vector2:
	var font := _font(weight)
	var lines := text.split("\n")
	var width := 0.0
	for line in lines:
		width = maxf(width, font.get_string_size(line, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x)
	return Vector2(width, lines.size() * size * 1.2)


func _text(node: CanvasItem, center: Vector2, text: String, size: int, colour: Color, halo: Color, halo_width: float, weight := 700, font_override: Font = null) -> void:
	if text.is_empty() or colour.a <= 0.0:
		return
	var font := font_override if font_override else _font(weight)
	var lines := text.split("\n")
	var height := lines.size() * size * 1.2
	var ascent := font.get_ascent(size)
	var descent := font.get_descent(size)
	var top := center.y - height * 0.5
	for index in range(lines.size()):
		var line := lines[index]
		var width := font.get_string_size(line, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
		var baseline := top + index * size * 1.2 + (size * 1.2 - (ascent + descent)) * 0.5 + ascent
		var at := Vector2(center.x - width * 0.5, baseline)
		if halo_width > 0.0 and halo.a > 0.0:
			node.draw_string_outline(font, at, line, HORIZONTAL_ALIGNMENT_LEFT, -1, size, maxi(1, roundi(halo_width * 2.0)), halo)
		node.draw_string(font, at, line, HORIZONTAL_ALIGNMENT_LEFT, -1, size, colour)


func _wrap(text: String, size: int, max_ems: float, weight := 700) -> String:
	var font := _font(weight)
	var limit := max_ems * size
	var out: Array[String] = []
	for raw in text.split("\n"):
		var words := raw.split(" ")
		var line := ""
		for word in words:
			var trial := word if line.is_empty() else line + " " + word
			if not line.is_empty() and font.get_string_size(trial, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x > limit:
				out.append(line)
				line = word
			else:
				line = trial
		out.append(line)
	return "\n".join(out)


func _free(box: Rect2, own := Rect2()) -> bool:
	for list in [_taken_base, _taken_top]:
		for other in list:
			if other == own:
				continue
			if other.intersects(box):
				return false
	return true


func _paint_base(node: Painter) -> void:
	_taken_base.clear()
	if view.x <= 0.0:
		return
	_draw_group_labels(node)
	_draw_markers(node)
	_draw_fronts(node)
	_draw_transports(node)


func _paint_planes(node: Painter) -> void:
	if view.x > 0.0:
		_draw_planes(node)


func _paint_top(node: Painter) -> void:
	_taken_top.clear()
	_unit_hits.clear()
	if view.x <= 0.0:
		return
	_draw_seas(node)
	_draw_units(node)


func _paint_strikes(node: Painter) -> void:
	if view.x > 0.0:
		_draw_strikes(node)


func _draw_group_labels(node: Painter) -> void:
	if group_labels.is_empty():
		return
	var size := roundi(WarKit.stops(level, GROUP_LABEL_SIZE))
	var font := UI.font(600, "Arial", roundi(size * 0.08))
	for item in group_labels:
		var entry: Dictionary = item
		var text := _wrap(str(entry.get("name", "")).to_upper(), size, 10.0, 600)
		var box_size := _text_size(text, size, 600)
		for at in _copies(_screen(entry["at"]), 200):
			var box := Rect2(at - box_size * 0.5, box_size)
			if not _free(box):
				continue
			_taken_base.append(box)
			_text(node, at, text, size, entry["color"], EDGE, 1.5, 600, font)


func _draw_markers(node: Painter) -> void:
	if markers.is_empty():
		return
	var shape_size := roundi(WarKit.stops(level, MARKER_SHAPE_SIZE))
	var label_size := roundi(WarKit.stops(level, MARKER_LABEL_SIZE))
	var halo := Color(5 / 255.0, 8 / 255.0, 12 / 255.0, 0.92)
	var shown: Array = []
	for item in markers:
		var marker: Dictionary = item
		var tier: Array = MARKER_TIERS.get(str(marker.get("tier", "local")), [5.8, 6.6])
		if level >= float(tier[0]):
			shown.append(marker)
	shown.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return float(a.get("sort", 0)) < float(b.get("sort", 0)))
	var placed: Array = []
	for marker in shown:
		var opacity := float(marker.get("opacity", 1.0))
		for at in _copies(_screen(marker["world"]), 40):
			var glyph := str(marker.get("glyph", ""))
			_text(node, at, glyph, shape_size, WarKit.faded(marker["color"], opacity), WarKit.faded(halo, opacity), 1.8, 400)
			var glyph_box := _text_size(glyph, shape_size, 400)
			var box := Rect2(at - Vector2(glyph_box.x, shape_size) * 0.5 - Vector2(3, 3), Vector2(glyph_box.x, shape_size) + Vector2(6, 6))
			_taken_base.append(box)
			placed.append([marker, at, box])
	for entry in placed:
		var marker: Dictionary = entry[0]
		var at: Vector2 = entry[1]
		var tier: Array = MARKER_TIERS.get(str(marker.get("tier", "local")), [5.8, 6.6])
		if level < float(tier[1]):
			continue
		var text := _wrap(str(marker.get("name", "")), label_size, 16.0, 600)
		var box_size := _text_size(text, label_size, 600)
		var offset := 1.2 * label_size
		for anchor in ["top", "bottom", "left", "right"]:
			var centre := at
			match anchor:
				"top":
					centre = at + Vector2(0, offset + box_size.y * 0.5)
				"bottom":
					centre = at - Vector2(0, offset + box_size.y * 0.5)
				"left":
					centre = at + Vector2(offset + box_size.x * 0.5, 0)
				"right":
					centre = at - Vector2(offset + box_size.x * 0.5, 0)
			var box := Rect2(centre - box_size * 0.5 - Vector2(6, 6), box_size + Vector2(12, 12))
			if not _free(box, entry[2]):
				continue
			_taken_base.append(box)
			var opacity := float(marker.get("opacity", 1.0))
			_text(node, centre, text, label_size, Color(247 / 255.0, 246 / 255.0, 240 / 255.0, 0.96 * opacity), WarKit.faded(halo, opacity), 1.35, 600)
			break


func _same_key(a: Array, b: Array) -> bool:
	if a.size() != b.size():
		return false
	for index in range(a.size()):
		var left: Variant = a[index]
		var right: Variant = b[index]
		if typeof(left) != typeof(right):
			return false
		if left is Array or left is Dictionary:
			if not is_same(left, right):
				return false
		elif left != right:
			return false
	return true


func _cached(name: String, key: Array, build: Callable) -> Dictionary:
	var entry: Dictionary = _caches.get(name, {})
	if not entry.is_empty() and _same_key(entry["key"], key):
		return entry
	var batches: Array = build.call()
	var bounds := Rect2()
	var first := true
	for into in batches:
		var verts: PackedVector2Array = into[0]
		for p in verts:
			if first:
				bounds = Rect2(p, Vector2.ZERO)
				first = false
			else:
				bounds = bounds.expand(p)
	entry = {"key": key, "batches": batches, "bounds": bounds, "empty": first}
	_caches[name] = entry
	return entry


func _view_world() -> Rect2:
	var half := view * 0.5 / maxf(zoom, 0.00001)
	return Rect2(camera - half, half * 2.0)


func _view_cell() -> Vector2i:
	var size := _view_world().size
	return Vector2i(floori(camera.x / maxf(size.x, 1.0)), floori(camera.y / maxf(size.y, 1.0)))


func _cull_world() -> Rect2:
	var size := _view_world().size
	var cell := _view_cell()
	return Rect2(Vector2(cell.x - 1, cell.y - 1) * size, size * 3.0)


func _near(points: PackedVector2Array, cull: Rect2) -> bool:
	var box := Rect2(points[0], Vector2.ZERO)
	for p in points:
		box = box.expand(p)
	for k in [-1, 0, 1]:
		if Rect2(box.position + Vector2(WORLD * k, 0), box.size).intersects(cull):
			return true
	return false


func _flush_world(node: Painter, entry: Dictionary) -> void:
	if entry.get("empty", true):
		return
	var item := node.get_canvas_item()
	var bounds: Rect2 = entry["bounds"]
	var visible_world := _view_world().grow(64.0 / maxf(zoom, 0.00001))
	for k in [-1, 0, 1]:
		var moved := Rect2(bounds.position + Vector2(WORLD * k, 0), bounds.size)
		if not moved.intersects(visible_world):
			continue
		node.draw_set_transform(view * 0.5 - camera * zoom + Vector2(WORLD * k * zoom, 0), 0.0, Vector2(zoom, zoom))
		for into in entry["batches"]:
			WarKit.flush(item, into)
	node.draw_set_transform(Vector2.ZERO)


func _world_ring(into: Array, centre: Vector2, radius: float, width: float, colour: Color) -> void:
	var pixel := 1.0 / maxf(zoom, 0.00001)
	var steps := clampi(int(radius * zoom * 1.2) + 12, 16, 72)
	var points := PackedVector2Array()
	points.resize(steps + 2)
	for step in range(steps + 2):
		var angle := TAU * float(step % steps) / float(steps)
		points[step] = centre + Vector2(cos(angle), sin(angle)) * radius
	WarKit.stroke(into, points, width, pixel, colour)


func _in_war_room(battlefield_index: int, side: int) -> bool:
	if not war_room.get("open", false):
		return false
	if battlefield_index < 0 or battlefield_index >= troop_fields.size():
		return false
	return str(troop_fields[battlefield_index]) == str(war_room.get("battlefield", "")) and side == int(war_room.get("side", -1))


func _troop_colour(index: int, alpha := 1.0) -> Color:
	return WarKit.color_of(troop_colours[index] if index >= 0 and index < troop_colours.size() else null, alpha)


func _front_batches() -> Array:
	var pixel := 1.0 / maxf(zoom, 0.00001)
	var side_max := 5.25 if every_troop else 7.75
	var troop_min := 2.5 if every_troop else 7.5
	var white := Color(1, 1, 1)
	var highlight := int(war_room.get("highlight", -1))
	var side_lit := WarKit.batch()
	var side_bodies := WarKit.batch()
	if level < side_max:
		var radius := WarKit.stops(level, SIDE_RADIUS) * pixel
		var lit_radius := WarKit.stops(level, SIDE_LIT_RADIUS) * pixel
		for entry_item in sides:
			var entry: Array = entry_item
			var at := Vector2(entry[0], entry[1])
			if highlight >= 0 and int(entry[3]) == highlight and _in_war_room(int(entry[7]), int(entry[2])):
				WarKit.disc(side_lit, at, lit_radius, pixel, WarKit.faded(ACCENT, 0.38))
				_world_ring(side_lit, at, lit_radius + 0.75 * pixel, 1.5 * pixel, WarKit.faded(ACCENT, 0.95))
			WarKit.disc(side_bodies, at, radius, pixel, _troop_colour(int(entry[4]), 0.92))
			_world_ring(side_bodies, at, radius + 0.75 * pixel, 1.5 * pixel, white)
	var lit := WarKit.batch()
	var dug := WarKit.batch()
	var bodies := WarKit.batch()
	var rings := WarKit.batch()
	if level >= troop_min:
		var picked: Array = war_room.get("selected", [])
		var lit_size := WarKit.stops(level, TROOP_LIT) * pixel
		for entry_item in troops:
			var entry: Array = entry_item
			var at := Vector2(entry[0], entry[1])
			var named := int(entry[9]) == 1
			var state := str(entry[8])
			var in_room := _in_war_room(int(entry[12]), int(entry[2]))
			if in_room and highlight >= 0 and int(entry[4]) == highlight:
				WarKit.disc(lit, at, lit_size, pixel, WarKit.faded(ACCENT, 0.5))
				_world_ring(lit, at, lit_size + pixel, 2.0 * pixel, WarKit.faded(ACCENT, 0.95))
			var rampart := WarKit.stops(level, RAMPART_NAMED if named else RAMPART_PLAIN) * pixel
			if state == "dug in":
				WarKit.disc(dug, at, rampart, pixel, Color(16 / 255.0, 20 / 255.0, 28 / 255.0, 0.82))
				_world_ring(dug, at, rampart + 0.6 * pixel, 1.2 * pixel, Color(230 / 255.0, 235 / 255.0, 242 / 255.0, 0.9))
			var radius := WarKit.stops(level, TROOP_NAMED if named else TROOP_PLAIN) * pixel
			var opacity := 0.35 if state == "spent" else lerpf(0.5, 0.95, clampf(float(entry[7]) / 60.0, 0.0, 1.0))
			var stroke := Color("#ff6b6b") if state == "encircled" else (Color("#ffd24a") if state == "advancing" else white)
			stroke.a = 0.4 if state == "spent" else 0.9
			var stroke_width := (1.8 if named else 1.0) * pixel
			WarKit.disc(bodies, at, radius, pixel, _troop_colour(int(entry[5]), opacity))
			_world_ring(bodies, at, radius + stroke_width * 0.5, stroke_width, stroke)
			if in_room and picked.has(int(entry[3])):
				_world_ring(rings, at, rampart + 1.1 * pixel, 2.2 * pixel, white)
	return [side_lit, side_bodies, lit, dug, bodies, rings]


func _draw_fronts(node: Painter) -> void:
	if troops.is_empty() and sides.is_empty():
		return
	var side_max := 5.25 if every_troop else 7.75
	var troop_min := 2.5 if every_troop else 7.5
	var kind_min := 6.5 if every_troop else 8.0
	var name_min := 6.0 if every_troop else 7.5
	var white := Color(1, 1, 1)
	var geometry := _cached("fronts", [troops, sides, troop_colours, level, every_troop, war_room], _front_batches)
	var batches: Array = geometry["batches"]
	var sides_only := {"empty": geometry["empty"], "bounds": geometry["bounds"], "batches": [batches[0], batches[1]]}
	_flush_world(node, sides_only)
	if level < side_max:
		var count_size := roundi(WarKit.stops(level, SIDE_COUNT_SIZE))
		for entry_item in sides:
			var entry: Array = entry_item
			for at in _copies(_screen(Vector2(entry[0], entry[1])), 30):
				_text(node, at, str(int(entry[5])), count_size, white, Color(0, 0, 0, 0.7), 1.0)
	if level < troop_min:
		return
	_flush_world(node, {"empty": geometry["empty"], "bounds": geometry["bounds"], "batches": batches.slice(2)})
	var placed: Array = []
	if level >= kind_min or level >= name_min:
		for entry_item in troops:
			var entry: Array = entry_item
			for at in _copies(_screen(Vector2(entry[0], entry[1])), 30):
				placed.append([entry, at])
	if level >= kind_min:
		var kind_size := roundi(WarKit.stops(level, TROOP_KIND_SIZE))
		for placed_item in placed:
			var entry: Array = placed_item[0]
			_text(node, placed_item[1], str(entry[6]), kind_size, white, Color(0, 0, 0, 0.65), 1.0)
	if level >= name_min:
		var name_size := roundi(WarKit.stops(level, TROOP_NAME_SIZE))
		var named_list: Array = placed.filter(func(entry_item: Array) -> bool: return int((entry_item[0] as Array)[9]) == 1 and not str((entry_item[0] as Array)[11]).is_empty())
		named_list.sort_custom(func(a: Array, b: Array) -> bool: return float((a[0] as Array)[7]) > float((b[0] as Array)[7]))
		for placed_item in named_list:
			var entry: Array = placed_item[0]
			var text := str(entry[11])
			var box_size := _text_size(text, name_size)
			var centre: Vector2 = placed_item[1] + Vector2(0, 1.2 * name_size)
			var box := Rect2(centre - box_size * 0.5 - Vector2(2, 2), box_size + Vector2(4, 4))
			if not _free(box):
				continue
			_taken_base.append(box)
			_text(node, centre, text, name_size, white, Color(0, 0, 0, 0.85), 1.2)


func _tone(name: String) -> Color:
	return WarKit.TONES.get(name, WarKit.TONES["other"])


func _way_batches() -> Array:
	var pixel := 1.0 / maxf(zoom, 0.00001)
	var cull := _cull_world()
	var ways: Array = transports.get("ways", [])
	var casing_width := WarKit.stops(level, WAY_CASING_WIDTH) * pixel
	var width := WarKit.stops(level, WAY_WIDTH) * pixel
	var casing := WarKit.batch()
	var dashes := WarKit.batch()
	for entry_item in ways:
		var way: Dictionary = entry_item
		var line: PackedVector2Array = way["points"]
		if line.size() < 2:
			continue
		var what := str(way.get("what", ""))
		var wake := what == "wake"
		var plan := what == "plan"
		WarKit.stroke(casing, line, casing_width, pixel, Color(5 / 255.0, 8 / 255.0, 13 / 255.0, 0.7 * (0.35 if wake else 1.0)))
		var colour := WarKit.faded(_tone(str(way.get("tone", "other"))), 0.8 if plan else (0.4 if wake else 0.95))
		for piece in WarKit.dashes(line, (0.6 if plan else 3.0) * width, (1.8 if plan else 1.6) * width):
			if _near(piece, cull):
				WarKit.stroke(dashes, piece, width, pixel, colour)
	return [casing, dashes]


func _draw_transports(node: Painter) -> void:
	var ways: Array = transports.get("ways", [])
	var points: Array = transports.get("points", [])
	if ways.is_empty() and points.is_empty() and carrier_override.is_empty():
		return
	if not ways.is_empty():
		_flush_world(node, _cached("ways", [transports, level, _view_cell()], _way_batches))
	var icon_scale := WarKit.stops(level, TRANSPORT_ICON) * 0.5
	var drawn_ids := {}
	for entry_item in points:
		var entry: Dictionary = entry_item
		var id := str(entry.get("id", ""))
		var what := str(entry.get("what", ""))
		var world: Vector2 = entry["world"]
		var bearing := float(entry.get("bearing", 0.0))
		if carrier_override.has(id):
			var place: Array = carrier_override[id]
			world = place[0]
			bearing = place[1]
		drawn_ids[id] = true
		var tone := _tone(str(entry.get("tone", "other")))
		for at in _copies(_screen(world), 40):
			if what == "lost":
				_text(node, at, "×", roundi(WarKit.stops(level, LOST_SIZE)), tone, EDGE, 2.0)
				continue
			_ship(node, at, str(entry.get("medium", "sea")), tone, bearing, icon_scale, 0.72 if what == "plan" else 1.0)
			var count := str(entry.get("count", ""))
			if not count.is_empty():
				_text(node, at + Vector2(0, 1.5 * 11), count, 11, tone, EDGE, 1.5)
	for id in carrier_override.keys():
		if drawn_ids.has(id):
			continue
		var place: Array = carrier_override[id]
		var tone := _tone(str(place[2]))
		for at in _copies(_screen(place[0]), 40):
			_ship(node, at, str(place[3]), tone, float(place[1]), icon_scale, 1.0)
			if not str(place[4]).is_empty():
				_text(node, at + Vector2(0, 1.5 * 11), str(place[4]), 11, tone, EDGE, 1.5)


func _ship(node: Painter, at: Vector2, medium: String, colour: Color, bearing: float, icon_scale: float, opacity: float) -> void:
	var edge := Color(EDGE.r, EDGE.g, EDGE.b, EDGE.a * opacity)
	node.draw_set_transform(at, deg_to_rad(bearing), Vector2(icon_scale, icon_scale))
	for outline in SHIPS.get(medium, SHIPS["sea"]):
		var shape := PackedVector2Array()
		for p in outline:
			shape.append(Vector2(float(p[0]) - 24.0, float(p[1]) - 24.0))
		node.draw_colored_polygon(shape, WarKit.faded(colour, opacity))
		var ring := shape.duplicate()
		ring.append(shape[0])
		node.draw_polyline(ring, edge, 2.6, true)
	for mark in SHIP_MARKS.get(medium, []):
		node.draw_line(Vector2(float(mark[0][0]) - 24.0, float(mark[0][1]) - 24.0), Vector2(float(mark[1][0]) - 24.0, float(mark[1][1]) - 24.0), edge, 2.0, true)
	node.draw_set_transform(Vector2.ZERO)


func _draw_planes(node: Painter) -> void:
	if planes.is_empty():
		return
	var size := WarKit.stops(level, AIR_SIZE) * 0.5
	var shape := PackedVector2Array()
	for p in PLANE:
		shape.append(Vector2(float(p[0]) - 24.0, float(p[1]) - 24.0))
	var ring := shape.duplicate()
	ring.append(shape[0])
	var shadow := Color(5 / 255.0, 8 / 255.0, 13 / 255.0, 0.55 * 0.8)
	for entry_item in planes:
		var plane: Array = entry_item
		for at in _copies(_screen(plane[0]), 30):
			node.draw_set_transform(at + Vector2(3, 4), deg_to_rad(float(plane[1])), Vector2(size, size))
			node.draw_colored_polygon(shape, shadow)
	for entry_item in planes:
		var plane: Array = entry_item
		var tone := _tone(str(plane[2]))
		for at in _copies(_screen(plane[0]), 30):
			node.draw_set_transform(at, deg_to_rad(float(plane[1])), Vector2(size, size))
			node.draw_colored_polygon(shape, tone)
			node.draw_polyline(ring, EDGE, 2.4, true)
	node.draw_set_transform(Vector2.ZERO)


func _sea_batches() -> Array:
	var pixel := 1.0 / maxf(zoom, 0.00001)
	var cull := _cull_world()
	var rings: Array = seas.get("rings", [])
	var battles: Array = seas.get("battles", [])
	var ring_width := WarKit.stops(level, BLOCKADE_WIDTH) * pixel
	var dashes := WarKit.batch()
	for entry_item in rings:
		var ring: Dictionary = entry_item
		var line: PackedVector2Array = ring["points"]
		if line.size() < 2:
			continue
		var colour := WarKit.faded(_tone(str(ring.get("tone", "other"))), 0.9)
		for piece in WarKit.dashes(line, 2.0 * ring_width, 2.4 * ring_width):
			if _near(piece, cull):
				WarKit.stroke(dashes, piece, ring_width, pixel, colour)
	var radius := WarKit.stops(level, BATTLE_RADIUS) * pixel
	var stroke := WarKit.stops(level, BATTLE_STROKE) * pixel
	var circles := WarKit.batch()
	for entry_item in battles:
		var battle: Dictionary = entry_item
		var shown := 1.0 if battle.get("fresh", false) else 0.5
		var tone := _tone(str(battle.get("tone", "other")))
		var at: Vector2 = battle["world"]
		WarKit.disc(circles, at, radius, pixel, Color(5 / 255.0, 8 / 255.0, 13 / 255.0, 0.6 * shown))
		_world_ring(circles, at, radius + stroke * 0.5, stroke, WarKit.faded(tone, shown))
	return [dashes, circles]


func _draw_seas(node: Painter) -> void:
	var rings: Array = seas.get("rings", [])
	var battles: Array = seas.get("battles", [])
	var labels: Array = seas.get("labels", [])
	if rings.is_empty() and battles.is_empty() and labels.is_empty():
		return
	_flush_world(node, _cached("seas", [seas, level, _view_cell()], _sea_batches))
	var mark_size := roundi(WarKit.stops(level, BATTLE_MARK))
	var placed: Array = []
	for entry_item in battles:
		var battle: Dictionary = entry_item
		var shown := 1.0 if battle.get("fresh", false) else 0.5
		var tone := _tone(str(battle.get("tone", "other")))
		for at in _copies(_screen(battle["world"]), 40):
			placed.append([battle, at, tone, shown])
	for entry in placed:
		_text(node, entry[1], "×", mark_size, WarKit.faded(entry[2], entry[3]), Color(0, 0, 0, 0), 0.0)
	if level >= 3.0:
		for entry in placed:
			var battle: Dictionary = entry[0]
			var text := _wrap(str(battle.get("label", "")), 11, 14.0)
			var box_size := _text_size(text, 11)
			var centre: Vector2 = entry[1] + Vector2(0, 1.4 * 11 + box_size.y * 0.5)
			var box := Rect2(centre - box_size * 0.5, box_size)
			if not _free(box):
				continue
			_taken_top.append(box)
			_text(node, centre, text, 11, WarKit.faded(entry[2], entry[3]), WarKit.faded(EDGE, entry[3]), 1.5)
	if level >= 2.0:
		for entry_item in labels:
			var label: Dictionary = entry_item
			var tone := _tone(str(label.get("tone", "other")))
			for at in _copies(_screen(label["world"]), 60):
				var text := _wrap(str(label.get("label", "")), 11, 14.0)
				var box_size := _text_size(text, 11)
				_text(node, at + Vector2(0, 2.6 * 11 + box_size.y * 0.5), text, 11, tone, EDGE, 1.5)


func _stops_column(column: int) -> Array:
	var out := []
	for stop in COUNTER_STOPS:
		out.append([stop[0], stop[column]])
	return out


func _unit_style(unit: Dictionary) -> Dictionary:
	var status := str(unit.get("status", ""))
	var covert := bool(unit.get("covert", false))
	var pending := status == "pending"
	var white := Color(1, 1, 1)
	var stroke := Color("#93c5fd") if pending else (Color("#e4e4e7") if covert else (Color("#ffd24a") if status == "moving" else (Color("#ff6b6b") if status == "engaged" else white)))
	stroke.a = 0.55 if pending else (0.7 if covert else 1.0)
	return {
		"radius": WarKit.stops(level, _stops_column(2 if covert else 1)),
		"fill": 0.32 if pending else (0.42 if covert else 0.92),
		"stroke": stroke,
		"stroke_width": 1.5 if pending else 2.0,
		"icon": 0.5 if pending else (0.6 if covert else 1.0),
	}


func _unit_batches() -> Array:
	var pixel := 1.0 / maxf(zoom, 0.00001)
	var counters := WarKit.batch()
	for entry_item in units:
		var unit: Dictionary = entry_item
		var id := str(unit.get("id", ""))
		if not unit_positions.has(id):
			continue
		var style := _unit_style(unit)
		var at: Vector2 = unit_positions[id]
		var radius: float = float(style["radius"]) * pixel
		var stroke_width: float = float(style["stroke_width"]) * pixel
		WarKit.disc(counters, at, radius, pixel, WarKit.color_of(unit.get("rgb", null), float(style["fill"])))
		_world_ring(counters, at, radius + stroke_width * 0.5, stroke_width, style["stroke"])
	return [counters]


func _draw_units(node: Painter) -> void:
	if units.is_empty():
		return
	_flush_world(node, _cached("units", [units, unit_positions, level], _unit_batches))
	var glyph_size := roundi(WarKit.stops(level, UNIT_GLYPH_SIZE))
	var white := Color(1, 1, 1)
	var placed: Array = []
	for entry_item in units:
		var unit: Dictionary = entry_item
		var id := str(unit.get("id", ""))
		if not unit_positions.has(id):
			continue
		var style := _unit_style(unit)
		for at in _copies(_screen(unit_positions[id]), 30):
			_unit_hits.append([at, float(style["radius"]) + float(style["stroke_width"]), id])
			placed.append([unit, at, float(style["radius"]), float(style["icon"])])
	var by_strength := placed.duplicate()
	by_strength.sort_custom(func(a: Array, b: Array) -> bool: return float((a[0] as Dictionary).get("strength", 0)) > float((b[0] as Dictionary).get("strength", 0)))
	for entry in by_strength:
		var unit: Dictionary = entry[0]
		var at: Vector2 = entry[1]
		var radius: float = entry[2]
		var opacity: float = entry[3]
		var texture := WarKit.flag(str(unit.get("flag", "")))
		if texture:
			var diameter := 2.0 * radius * FLAG_DISC_RATIO
			node.draw_texture_rect(texture, Rect2(at - Vector2(diameter, diameter) * 0.5, Vector2(diameter, diameter)), false, Color(1, 1, 1, opacity))
		else:
			_text(node, at, str(unit.get("glyph", "I")), glyph_size, WarKit.faded(white, opacity), Color(0, 0, 0, 0.65 * opacity), 1.0)
	if level < 3.0:
		return
	var name_size := roundi(WarKit.stops(level, UNIT_NAME_SIZE))
	for entry in by_strength:
		var unit: Dictionary = entry[0]
		var text := str(unit.get("label", ""))
		if text.is_empty():
			continue
		var at: Vector2 = entry[1]
		var centre := at + Vector2(0, 1.35 * name_size)
		var box_size := _text_size(text, name_size)
		var box := Rect2(centre - box_size * 0.5 - Vector2(2, 2), box_size + Vector2(4, 4))
		if not _free(box):
			continue
		_taken_top.append(box)
		_text(node, centre, text, name_size, white, Color(0, 0, 0, 0.85), 1.2)


func _draw_strikes(node: Painter) -> void:
	var ribbons: Array = strikes.get("ribbons", [])
	var discs: Array = strikes.get("discs", [])
	var points: Array = strikes.get("points", [])
	if ribbons.is_empty() and discs.is_empty() and points.is_empty():
		return
	var item := node.get_canvas_item()
	var quads := WarKit.batch()
	for entry_item in ribbons:
		var ribbon: Dictionary = entry_item
		var line := _screen_line(ribbon["points"])
		var colour: Array = ribbon.get("colour", [1, 1, 1])
		var base := Color(float(colour[0]), float(colour[1]), float(colour[2]))
		var from := float(ribbon.get("from", 1.0))
		var to := float(ribbon.get("to", 1.0))
		var half := float(ribbon.get("width", 1.0)) * 0.5
		var last := line.size() - 1
		if last < 1:
			continue
		for copy in _line_copies(line):
			var verts: PackedVector2Array = quads[0]
			var tints: PackedColorArray = quads[1]
			var indices: PackedInt32Array = quads[2]
			for at in range(last):
				var a := copy[at]
				var b := copy[at + 1]
				var along := b - a
				if along.length() < 0.0001:
					along = Vector2(1, 0)
				var normal := Vector2(-along.y, along.x).normalized() * half
				var ca := Color(base.r, base.g, base.b, from + (to - from) * float(at) / float(last))
				var cb := Color(base.r, base.g, base.b, from + (to - from) * float(at + 1) / float(last))
				var start := verts.size()
				verts.append_array(PackedVector2Array([a + normal, a - normal, b - normal, b + normal]))
				tints.append_array(PackedColorArray([ca, ca, cb, cb]))
				indices.append_array(PackedInt32Array([start, start + 1, start + 2, start, start + 2, start + 3]))
			quads[0] = verts
			quads[1] = tints
			quads[2] = indices
	for entry_item in discs:
		var disc: Dictionary = entry_item
		var colour: Array = disc.get("colour", [1, 1, 1])
		var alpha := float(disc.get("alpha", 1.0))
		var inner := Color(float(colour[0]), float(colour[1]), float(colour[2]), alpha)
		var outer := Color(inner.r, inner.g, inner.b, alpha * 0.5)
		var centre := _screen(disc["centre"])
		var rim := _screen_line(disc["rim"])
		if rim.size() < 2:
			continue
		var shift: float = WORLD * zoom * roundf((centre.x - rim[0].x) / (WORLD * zoom))
		for k in [-1, 0, 1]:
			var offset := Vector2(WORLD * zoom * k, 0)
			if (centre + offset).x < -600 or (centre + offset).x > view.x + 600:
				continue
			var verts: PackedVector2Array = quads[0]
			var tints: PackedColorArray = quads[1]
			var indices: PackedInt32Array = quads[2]
			for at in range(rim.size() - 1):
				var start := verts.size()
				verts.append_array(PackedVector2Array([centre + offset, rim[at] + Vector2(shift, 0) + offset, rim[at + 1] + Vector2(shift, 0) + offset]))
				tints.append_array(PackedColorArray([inner, outer, outer]))
				indices.append_array(PackedInt32Array([start, start + 1, start + 2]))
			quads[0] = verts
			quads[1] = tints
			quads[2] = indices
	WarKit.flush(item, quads)
	for entry_item in points:
		var entry: Dictionary = entry_item
		var colour: Array = entry.get("colour", [1, 1, 1])
		var alpha := float(entry.get("alpha", 1.0))
		var tint := Color(float(colour[0]), float(colour[1]), float(colour[2]), alpha)
		var size := float(entry.get("size", 8.0))
		var shape := int(entry.get("shape", 0))
		var at_screen := _screen(entry["at"])
		var toward: Variant = entry.get("toward", null)
		for at in _copies(at_screen, size + 10.0):
			var rect := Rect2(-size * 0.5, -size * 0.5, size, size)
			if shape == 1:
				var direction := Vector2(0, -1)
				if toward is Vector2:
					var there := _screen(toward) + (at - at_screen)
					if there.distance_to(at) > 0.0001:
						direction = (there - at).normalized()
				node.draw_set_transform(at, atan2(direction.x, -direction.y))
				node.draw_texture_rect(WarKit.sprite("plane_edge"), rect, false, Color(1, 1, 1, alpha))
				node.draw_texture_rect(WarKit.sprite("plane"), rect, false, tint)
				node.draw_set_transform(Vector2.ZERO)
				continue
			var sprite := "glow" if shape == 0 else ("flash" if shape == 2 else "ring")
			node.draw_texture_rect(WarKit.sprite(sprite), Rect2(at + rect.position, rect.size), false, tint)


func unit_at(screen_point: Vector2) -> String:
	var best := ""
	var nearest := INF
	for hit in _unit_hits:
		var at: Vector2 = hit[0]
		var reach: float = hit[1]
		var distance := at.distance_to(screen_point)
		if distance <= reach and distance < nearest:
			nearest = distance
			best = str(hit[2])
	return best
