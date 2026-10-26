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
var _taken: Array[Rect2] = []


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


func _text(center: Vector2, text: String, size: int, colour: Color, halo: Color, halo_width: float, weight := 700, font_override: Font = null) -> void:
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
			draw_string_outline(font, at, line, HORIZONTAL_ALIGNMENT_LEFT, -1, size, maxi(1, roundi(halo_width * 2.0)), halo)
		draw_string(font, at, line, HORIZONTAL_ALIGNMENT_LEFT, -1, size, colour)


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


func _free(box: Rect2) -> bool:
	for other in _taken:
		if other.intersects(box):
			return false
	return true


func _draw() -> void:
	_unit_hits.clear()
	_taken.clear()
	if view.x <= 0.0:
		return
	_draw_group_labels()
	_draw_markers()
	_draw_fronts()
	_draw_transports()
	_draw_planes()
	_draw_seas()
	_draw_units()
	_draw_strikes()


func _draw_group_labels() -> void:
	if group_labels.is_empty():
		return
	var size := roundi(WarKit.stops(level, GROUP_LABEL_SIZE))
	var font := UI.font(600, "Arial", roundi(size * 0.08))
	var halo := Color(5 / 255.0, 8 / 255.0, 13 / 255.0, 0.92)
	for item in group_labels:
		var entry: Dictionary = item
		var text := _wrap(str(entry.get("name", "")).to_upper(), size, 10.0, 600)
		var box_size := _text_size(text, size, 600)
		for at in _copies(_screen(entry["at"]), 200):
			var box := Rect2(at - box_size * 0.5, box_size)
			if not _free(box):
				continue
			_taken.append(box)
			_text(at, text, size, entry["color"], halo, 1.5, 600, font)


func _draw_markers() -> void:
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
			_text(at, glyph, shape_size, WarKit.faded(marker["color"], opacity), WarKit.faded(halo, opacity), 1.8, 400)
			var glyph_box := _text_size(glyph, shape_size, 400)
			var box := Rect2(at - glyph_box * 0.5 - Vector2(3, 3), glyph_box + Vector2(6, 6))
			_taken.append(box)
			placed.append([marker, at])
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
			if not _free(box):
				continue
			_taken.append(box)
			var opacity := float(marker.get("opacity", 1.0))
			_text(centre, text, label_size, Color(247 / 255.0, 246 / 255.0, 240 / 255.0, 0.96 * opacity), WarKit.faded(halo, opacity), 1.35, 600)
			break


func _in_war_room(entry: Array, battlefield_index: int, side: int) -> bool:
	if not war_room.get("open", false):
		return false
	var name := str(war_room.get("battlefield", ""))
	if battlefield_index < 0 or battlefield_index >= troop_fields.size():
		return false
	return str(troop_fields[battlefield_index]) == name and side == int(war_room.get("side", -1))


func _draw_fronts() -> void:
	if troops.is_empty() and sides.is_empty():
		return
	var side_max := 5.25 if every_troop else 7.75
	var troop_min := 2.5 if every_troop else 7.5
	var kind_min := 6.5 if every_troop else 8.0
	var name_min := 6.0 if every_troop else 7.5
	var white := Color(1, 1, 1)
	if level < side_max:
		var radius := WarKit.stops(level, SIDE_RADIUS)
		var count_size := roundi(WarKit.stops(level, SIDE_COUNT_SIZE))
		var highlight := int(war_room.get("highlight", -1))
		for item in sides:
			var entry: Array = item
			var lit := highlight >= 0 and int(entry[3]) == highlight and _in_war_room(entry, int(entry[7]), int(entry[2]))
			var colour := WarKit.color_of(troop_colours[int(entry[4])] if int(entry[4]) < troop_colours.size() else null, 0.92)
			for at in _copies(_screen(Vector2(entry[0], entry[1])), 30):
				if lit:
					var lit_radius := WarKit.stops(level, SIDE_LIT_RADIUS)
					draw_circle(at, lit_radius, WarKit.faded(ACCENT, 0.38), true, -1.0, true)
					draw_circle(at, lit_radius + 0.75, WarKit.faded(ACCENT, 0.95), false, 1.5, true)
				draw_circle(at, radius, colour, true, -1.0, true)
				draw_circle(at, radius + 0.75, white, false, 1.5, true)
				_text(at, str(int(entry[5])), count_size, white, Color(0, 0, 0, 0.7), 1.0)
	if level < troop_min:
		return
	var picked: Array = war_room.get("selected", [])
	var highlight_troop := int(war_room.get("highlight", -1))
	var placed: Array = []
	for item in troops:
		var entry: Array = item
		var named := int(entry[9]) == 1
		var state := str(entry[8])
		var strength := float(entry[7])
		var radius := WarKit.stops(level, TROOP_NAMED if named else TROOP_PLAIN)
		var rampart := WarKit.stops(level, RAMPART_NAMED if named else RAMPART_PLAIN)
		var base := WarKit.color_of(troop_colours[int(entry[5])] if int(entry[5]) < troop_colours.size() else null)
		var opacity := 0.35 if state == "spent" else lerpf(0.5, 0.95, clampf(strength / 60.0, 0.0, 1.0))
		var stroke := Color("#ff6b6b") if state == "encircled" else (Color("#ffd24a") if state == "advancing" else white)
		stroke.a = 0.4 if state == "spent" else 0.9
		var in_room := _in_war_room(entry, int(entry[12]), int(entry[2]))
		var lit := in_room and highlight_troop >= 0 and int(entry[4]) == highlight_troop
		var is_picked := in_room and picked.has(int(entry[3]))
		for at in _copies(_screen(Vector2(entry[0], entry[1])), 30):
			if lit:
				var lit_radius := WarKit.stops(level, TROOP_LIT)
				draw_circle(at, lit_radius, WarKit.faded(ACCENT, 0.5), true, -1.0, true)
				draw_circle(at, lit_radius + 1.0, WarKit.faded(ACCENT, 0.95), false, 2.0, true)
			if state == "dug in":
				draw_circle(at, rampart, Color(16 / 255.0, 20 / 255.0, 28 / 255.0, 0.82), true, -1.0, true)
				draw_circle(at, rampart + 0.6, Color(230 / 255.0, 235 / 255.0, 242 / 255.0, 0.9), false, 1.2, true)
			draw_circle(at, radius, WarKit.faded(base, opacity), true, -1.0, true)
			var stroke_width := 1.8 if named else 1.0
			draw_circle(at, radius + stroke_width * 0.5, stroke, false, stroke_width, true)
			if is_picked:
				draw_circle(at, rampart + 1.1, white, false, 2.2, true)
			placed.append([entry, at])
	if level >= kind_min:
		var kind_size := roundi(WarKit.stops(level, TROOP_KIND_SIZE))
		for entry in placed:
			var troop: Array = entry[0]
			_text(entry[1], str(troop[6]), kind_size, white, Color(0, 0, 0, 0.65), 1.0)
	if level >= name_min:
		var name_size := roundi(WarKit.stops(level, TROOP_NAME_SIZE))
		var named_list: Array = placed.filter(func(entry: Array) -> bool: return int((entry[0] as Array)[9]) == 1 and not str((entry[0] as Array)[11]).is_empty())
		named_list.sort_custom(func(a: Array, b: Array) -> bool: return float((a[0] as Array)[7]) > float((b[0] as Array)[7]))
		for entry in named_list:
			var troop: Array = entry[0]
			var text := str(troop[11])
			var box_size := _text_size(text, name_size)
			var centre: Vector2 = entry[1] + Vector2(0, 1.2 * name_size)
			var box := Rect2(centre - box_size * 0.5 - Vector2(2, 2), box_size + Vector2(4, 4))
			if not _free(box):
				continue
			_taken.append(box)
			_text(centre, text, name_size, white, Color(0, 0, 0, 0.85), 1.2)


func _tone(name: String) -> Color:
	return WarKit.TONES.get(name, WarKit.TONES["other"])


func _draw_transports() -> void:
	var ways: Array = transports.get("ways", [])
	var points: Array = transports.get("points", [])
	if ways.is_empty() and points.is_empty() and carrier_override.is_empty():
		return
	var casing_width := WarKit.stops(level, WAY_CASING_WIDTH)
	var width := WarKit.stops(level, WAY_WIDTH)
	for item in ways:
		var way: Dictionary = item
		var wake := str(way.get("what", "")) == "wake"
		for line in _line_copies(_screen_line(way["points"])):
			draw_polyline(line, Color(5 / 255.0, 8 / 255.0, 13 / 255.0, 0.7 * (0.35 if wake else 1.0)), casing_width, true)
	for item in ways:
		var way: Dictionary = item
		var what := str(way.get("what", ""))
		var plan := what == "plan"
		var colour := WarKit.faded(_tone(str(way.get("tone", "other"))), 0.8 if plan else (0.4 if what == "wake" else 0.95))
		for line in _line_copies(_screen_line(way["points"])):
			var dash := (0.6 if plan else 3.0) * width
			var gap := (1.8 if plan else 1.6) * width
			for piece in WarKit.dashes(line, dash, gap):
				draw_polyline(piece, colour, width, true)
	var icon_scale := WarKit.stops(level, TRANSPORT_ICON) * 0.5
	var drawn_ids := {}
	for item in points:
		var entry: Dictionary = item
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
				_text(at, "×", roundi(WarKit.stops(level, LOST_SIZE)), tone, Color(5 / 255.0, 8 / 255.0, 13 / 255.0, 0.92), 2.0)
				continue
			_ship(at, str(entry.get("medium", "sea")), tone, bearing, icon_scale, 0.72 if what == "plan" else 1.0)
			var count := str(entry.get("count", ""))
			if not count.is_empty():
				_text(at + Vector2(0, 1.5 * 11), count, 11, tone, Color(5 / 255.0, 8 / 255.0, 13 / 255.0, 0.92), 1.5)
	for id in carrier_override.keys():
		if drawn_ids.has(id):
			continue
		var place: Array = carrier_override[id]
		var tone := _tone(str(place[2]))
		for at in _copies(_screen(place[0]), 40):
			_ship(at, str(place[3]), tone, float(place[1]), icon_scale, 1.0)
			if not str(place[4]).is_empty():
				_text(at + Vector2(0, 1.5 * 11), str(place[4]), 11, tone, Color(5 / 255.0, 8 / 255.0, 13 / 255.0, 0.92), 1.5)


func _ship(at: Vector2, medium: String, colour: Color, bearing: float, icon_scale: float, opacity: float) -> void:
	var angle := deg_to_rad(bearing)
	var edge := Color(5 / 255.0, 8 / 255.0, 13 / 255.0, 0.92 * opacity)
	draw_set_transform(at, angle, Vector2(icon_scale, icon_scale))
	for outline in SHIPS.get(medium, SHIPS["sea"]):
		var shape := PackedVector2Array()
		for p in outline:
			shape.append(Vector2(float(p[0]) - 24.0, float(p[1]) - 24.0))
		draw_colored_polygon(shape, WarKit.faded(colour, opacity))
		var ring := shape.duplicate()
		ring.append(shape[0])
		draw_polyline(ring, edge, 2.6, true)
	for mark in SHIP_MARKS.get(medium, []):
		draw_line(Vector2(float(mark[0][0]) - 24.0, float(mark[0][1]) - 24.0), Vector2(float(mark[1][0]) - 24.0, float(mark[1][1]) - 24.0), edge, 2.0, true)
	draw_set_transform(Vector2.ZERO)


func _draw_planes() -> void:
	if planes.is_empty():
		return
	var size := WarKit.stops(level, AIR_SIZE) * 0.5
	var shape := PackedVector2Array()
	for p in PLANE:
		shape.append(Vector2(float(p[0]) - 24.0, float(p[1]) - 24.0))
	var ring := shape.duplicate()
	ring.append(shape[0])
	var shadow := Color(5 / 255.0, 8 / 255.0, 13 / 255.0, 0.55 * 0.8)
	for item in planes:
		var plane: Array = item
		for at in _copies(_screen(plane[0]), 30):
			draw_set_transform(at + Vector2(3, 4), deg_to_rad(float(plane[1])), Vector2(size, size))
			draw_colored_polygon(shape, shadow)
	for item in planes:
		var plane: Array = item
		var tone := _tone(str(plane[2]))
		for at in _copies(_screen(plane[0]), 30):
			draw_set_transform(at, deg_to_rad(float(plane[1])), Vector2(size, size))
			draw_colored_polygon(shape, tone)
			draw_polyline(ring, Color(5 / 255.0, 8 / 255.0, 13 / 255.0, 0.92), 2.4, true)
	draw_set_transform(Vector2.ZERO)


func _draw_seas() -> void:
	var rings: Array = seas.get("rings", [])
	var battles: Array = seas.get("battles", [])
	var labels: Array = seas.get("labels", [])
	if rings.is_empty() and battles.is_empty() and labels.is_empty():
		return
	var ring_width := WarKit.stops(level, BLOCKADE_WIDTH)
	for item in rings:
		var ring: Dictionary = item
		var colour := WarKit.faded(_tone(str(ring.get("tone", "other"))), 0.9)
		for line in _line_copies(_screen_line(ring["points"])):
			for piece in WarKit.dashes(line, 2.0 * ring_width, 2.4 * ring_width):
				draw_polyline(piece, colour, ring_width, true)
	var radius := WarKit.stops(level, BATTLE_RADIUS)
	var stroke := WarKit.stops(level, BATTLE_STROKE)
	var mark_size := roundi(WarKit.stops(level, BATTLE_MARK))
	var edge := Color(5 / 255.0, 8 / 255.0, 13 / 255.0, 0.92)
	for item in battles:
		var battle: Dictionary = item
		var shown := 1.0 if battle.get("fresh", false) else 0.5
		var tone := _tone(str(battle.get("tone", "other")))
		for at in _copies(_screen(battle["world"]), 40):
			draw_circle(at, radius, Color(5 / 255.0, 8 / 255.0, 13 / 255.0, 0.6 * shown), true, -1.0, true)
			draw_circle(at, radius + stroke * 0.5, WarKit.faded(tone, shown), false, stroke, true)
			_text(at, "×", mark_size, WarKit.faded(tone, shown), Color(0, 0, 0, 0), 0.0)
			if level >= 3.0:
				var text := _wrap(str(battle.get("label", "")), 11, 14.0)
				var box_size := _text_size(text, 11)
				var centre := at + Vector2(0, 1.4 * 11 + box_size.y * 0.5)
				var box := Rect2(centre - box_size * 0.5, box_size)
				if _free(box):
					_taken.append(box)
					_text(centre, text, 11, WarKit.faded(tone, shown), WarKit.faded(edge, shown), 1.5)
	if level >= 2.0:
		for item in labels:
			var label: Dictionary = item
			var tone := _tone(str(label.get("tone", "other")))
			for at in _copies(_screen(label["world"]), 60):
				var text := _wrap(str(label.get("label", "")), 11, 14.0)
				var box_size := _text_size(text, 11)
				_text(at + Vector2(0, 2.6 * 11 + box_size.y * 0.5), text, 11, tone, edge, 1.5)


func _draw_units() -> void:
	if units.is_empty():
		return
	var normal_radius := WarKit.stops(level, _stops_column(1))
	var covert_radius := WarKit.stops(level, _stops_column(2))
	var glyph_size := roundi(WarKit.stops(level, UNIT_GLYPH_SIZE))
	var white := Color(1, 1, 1)
	var placed: Array = []
	for item in units:
		var unit: Dictionary = item
		var id := str(unit.get("id", ""))
		if not unit_positions.has(id):
			continue
		var status := str(unit.get("status", ""))
		var covert := bool(unit.get("covert", false))
		var pending := status == "pending"
		var radius := covert_radius if covert else normal_radius
		var fill_alpha := 0.32 if pending else (0.42 if covert else 0.92)
		var stroke_width := 1.5 if pending else 2.0
		var stroke := Color("#93c5fd") if pending else (Color("#e4e4e7") if covert else (Color("#ffd24a") if status == "moving" else (Color("#ff6b6b") if status == "engaged" else white)))
		stroke.a = 0.55 if pending else (0.7 if covert else 1.0)
		var colour := WarKit.color_of(unit.get("rgb", null), fill_alpha)
		for at in _copies(_screen(unit_positions[id]), 30):
			draw_circle(at, radius, colour, true, -1.0, true)
			draw_circle(at, radius + stroke_width * 0.5, stroke, false, stroke_width, true)
			_unit_hits.append([at, radius + stroke_width, id])
			placed.append([unit, at, radius])
	var by_strength := placed.duplicate()
	by_strength.sort_custom(func(a: Array, b: Array) -> bool: return float((a[0] as Dictionary).get("strength", 0)) > float((b[0] as Dictionary).get("strength", 0)))
	for entry in by_strength:
		var unit: Dictionary = entry[0]
		var at: Vector2 = entry[1]
		var radius: float = entry[2]
		var status := str(unit.get("status", ""))
		var covert := bool(unit.get("covert", false))
		var opacity := 0.5 if status == "pending" else (0.6 if covert else 1.0)
		var texture := WarKit.flag(str(unit.get("flag", "")))
		if texture:
			var diameter := 2.0 * radius * FLAG_DISC_RATIO
			draw_texture_rect(texture, Rect2(at - Vector2(diameter, diameter) * 0.5, Vector2(diameter, diameter)), false, Color(1, 1, 1, opacity))
		else:
			_text(at, str(unit.get("glyph", "I")), glyph_size, WarKit.faded(white, opacity), Color(0, 0, 0, 0.65 * opacity), 1.0)
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
		_taken.append(box)
		_text(centre, text, name_size, white, Color(0, 0, 0, 0.85), 1.2)


func _stops_column(column: int) -> Array:
	var out := []
	for stop in COUNTER_STOPS:
		out.append([stop[0], stop[column]])
	return out


func _draw_strikes() -> void:
	var ribbons: Array = strikes.get("ribbons", [])
	var discs: Array = strikes.get("discs", [])
	var points: Array = strikes.get("points", [])
	if ribbons.is_empty() and discs.is_empty() and points.is_empty():
		return
	for item in ribbons:
		var ribbon: Dictionary = item
		var line := _screen_line(ribbon["points"])
		var colour: Array = ribbon.get("colour", [1, 1, 1])
		var base := Color(float(colour[0]), float(colour[1]), float(colour[2]))
		var from := float(ribbon.get("from", 1.0))
		var to := float(ribbon.get("to", 1.0))
		var half := float(ribbon.get("width", 1.0)) * 0.5
		var last := line.size() - 1
		for copy in _line_copies(line):
			for at in range(last):
				var a := copy[at]
				var b := copy[at + 1]
				var along := b - a
				if along.length() < 0.0001:
					along = Vector2(1, 0)
				var normal := Vector2(-along.y, along.x).normalized() * half
				var alpha_a := from + (to - from) * float(at) / float(last)
				var alpha_b := from + (to - from) * float(at + 1) / float(last)
				var ca := Color(base.r, base.g, base.b, alpha_a)
				var cb := Color(base.r, base.g, base.b, alpha_b)
				draw_polygon(PackedVector2Array([a + normal, a - normal, b - normal, b + normal]), PackedColorArray([ca, ca, cb, cb]))
	for item in discs:
		var disc: Dictionary = item
		var colour: Array = disc.get("colour", [1, 1, 1])
		var alpha := float(disc.get("alpha", 1.0))
		var inner := Color(float(colour[0]), float(colour[1]), float(colour[2]), alpha)
		var outer := Color(inner.r, inner.g, inner.b, alpha * 0.5)
		var centre := _screen(disc["centre"])
		var rim := _screen_line(disc["rim"])
		var shift: float = WORLD * zoom * roundf((centre.x - rim[0].x) / (WORLD * zoom)) if rim.size() > 0 else 0.0
		for k in [-1, 0, 1]:
			var offset := Vector2(WORLD * zoom * k, 0)
			if (centre + offset).x < -400 or (centre + offset).x > view.x + 400:
				continue
			for at in range(rim.size() - 1):
				draw_polygon(PackedVector2Array([centre + offset, rim[at] + Vector2(shift, 0) + offset, rim[at + 1] + Vector2(shift, 0) + offset]), PackedColorArray([inner, outer, outer]))
	for item in points:
		var entry: Dictionary = item
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
				draw_set_transform(at, atan2(direction.x, -direction.y))
				draw_texture_rect(WarKit.sprite("plane_edge"), rect, false, Color(1, 1, 1, alpha))
				draw_texture_rect(WarKit.sprite("plane"), rect, false, tint)
				draw_set_transform(Vector2.ZERO)
				continue
			var sprite := "glow" if shape == 0 else ("flash" if shape == 2 else "ring")
			draw_texture_rect(WarKit.sprite(sprite), Rect2(at + rect.position, rect.size), false, tint)


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
