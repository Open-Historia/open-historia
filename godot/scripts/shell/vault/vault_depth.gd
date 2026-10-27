extends Control

const SOCKET_STEPS := 40

var leaves: Array = []
var back := 0.07
var thickness := 0.3
var door := 0.44
var sockets: Array = [0.15, 0.26, 0.37]
var socket_radius := 0.17
var brush: Array = []
var progress := 0.0


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE


static func leaf_offset(move: Vector2, share: float, area: Vector2) -> Vector2:
	return Vector2(move.x * area.x * share, move.y * area.y * share)


static func sides_of(leaf: Dictionary, share: float, area: Vector2, depth_back: float) -> Array:
	var move: Vector2 = leaf["move"]
	var offset := leaf_offset(move, share, area)
	var centre := area / 2.0
	var result: Array = []
	for seam in leaf["seams"]:
		var from: Vector2 = seam[0]
		var to: Vector2 = seam[1]
		var front_a := Vector2(from.x * area.x, from.y * area.y) + offset
		var front_b := Vector2(to.x * area.x, to.y * area.y) + offset
		var back_a := centre + (front_a - centre) * (1.0 - depth_back)
		var back_b := centre + (front_b - centre) * (1.0 - depth_back)
		var across := (back_a + back_b - front_a - front_b) / 2.0
		var length := across.length()
		var facing := across / length if length > 1e-9 else Vector2.ZERO
		result.append({"front": [front_a, front_b], "back": [back_a, back_b], "facing": facing})
	return result


static func side_light(facing: Vector2) -> float:
	var to_light := -(facing.x + facing.y) / sqrt(2.0)
	return clampf(0.42 + 0.5 * to_light, 0.0, 1.0)


static func side_point(side: Dictionary, along: float, deep: float) -> Vector2:
	var front: Array = side["front"]
	var behind: Array = side["back"]
	var near: Vector2 = (front[0] as Vector2).lerp(front[1], along)
	var far: Vector2 = (behind[0] as Vector2).lerp(behind[1], along)
	return near.lerp(far, deep)


func _draw() -> void:
	if not (progress > 0.0):
		return
	for leaf in leaves:
		_shadow(leaf)
	for leaf in leaves:
		for side in sides_of(leaf, progress, size, back):
			_side(side)


func _shadow(leaf: Dictionary) -> void:
	var move: Vector2 = leaf["move"]
	var offset := leaf_offset(move, progress, size)
	var reach := minf(size.x, size.y) * 0.03 * minf(1.0, progress * 4.0)
	for step in [1.0, 0.66, 0.33]:
		var shift := Vector2(reach * float(step), reach * 1.5 * float(step))
		var points := PackedVector2Array()
		for corner in leaf["corners"]:
			var share: Vector2 = corner
			points.append(Vector2(share.x * size.x, share.y * size.y) + offset + shift)
		_fill(points, Color(0, 0, 0, 0.16))


func _fill(given: PackedVector2Array, color: Color) -> void:
	var count := given.size()
	if count < 3:
		return
	var area := 0.0
	for index in range(count):
		area += given[index].cross(given[(index + 1) % count])
	if absf(area) < 0.0001:
		return
	var points := PackedVector2Array(given)
	if area < 0.0:
		points.reverse()
	var normals := PackedVector2Array()
	var perimeter := 0.0
	for index in range(count):
		var edge := points[(index + 1) % count] - points[index]
		var length := edge.length()
		perimeter += length
		normals.append(Vector2(edge.y, -edge.x) / length if length > 1e-6 else Vector2.ZERO)
	var width := absf(area) / maxf(perimeter, 1e-6)
	var shrink := 0.5
	var ink := color
	if width < 1.0:
		shrink = 0.0
		ink.a *= width / (width + 0.5)
	var vertices := PackedVector2Array()
	var colors := PackedColorArray()
	var clear := Color(ink, 0.0)
	for index in range(count):
		var before := normals[(index - 1 + count) % count]
		var after := normals[index]
		var sum := before + after
		var offset := after * 0.5
		if sum.length() > 1e-6:
			var direction := sum.normalized()
			offset = direction * minf(0.5 / maxf(direction.dot(after), 0.25), 2.0)
		vertices.append(points[index] - offset * (shrink / 0.5))
		colors.append(ink)
		vertices.append(points[index] + offset)
		colors.append(clear)
	var indices := PackedInt32Array()
	for index in range(1, count - 1):
		indices.append_array([0, 2 * index, 2 * (index + 1)])
	for index in range(count):
		var next := (index + 1) % count
		indices.append_array([2 * index, 2 * next, 2 * next + 1, 2 * index, 2 * next + 1, 2 * index + 1])
	RenderingServer.canvas_item_add_triangle_array(get_canvas_item(), indices, vertices, colors)


func _quad(side: Dictionary, from: float, to: float, deep_from := 0.0, deep_to := 1.0) -> PackedVector2Array:
	return PackedVector2Array([side_point(side, from, deep_from), side_point(side, to, deep_from), side_point(side, to, deep_to), side_point(side, from, deep_to)])


func _side(side: Dictionary) -> void:
	var light := side_light(side["facing"])
	var short := minf(size.x, size.y)
	var front: Array = side["front"]
	var length := (front[1] as Vector2).distance_to(front[0])
	if not (length > 0.0):
		return
	var door_ends := minf(1.0, door * short / length)
	var tone := 0.55 + 0.75 * light
	_fill(_quad(side, 0.0, door_ends), Color8(roundi(52 * tone), roundi(57 * tone), roundi(65 * tone)))
	if door_ends < 1.0:
		_fill(_quad(side, door_ends, 1.0), Color8(roundi(40 * tone), roundi(44 * tone), roundi(50 * tone)))
	for entry in brush:
		var line: Dictionary = entry
		var at := float(line.get("at", 0.0))
		var alpha := float(line.get("alpha", 0.0))
		var ink := Color(230.0 / 255.0, 236.0 / 255.0, 245.0 / 255.0, alpha * (0.5 + light)) if bool(line.get("light", false)) else Color(0, 0, 0, alpha * 1.4)
		draw_line(side_point(side, 0.0, at), side_point(side, 1.0, at), ink, 1.0, true)
	_fill(_quad(side, 0.0, 1.0, 0.64, 0.7), Color(0, 0, 0, 0.42))
	_fill(_quad(side, 0.0, 1.0, 0.7, 0.72), Color(214.0 / 255.0, 220.0 / 255.0, 230.0 / 255.0, 0.05 + 0.14 * light))
	if door_ends < 1.0:
		draw_line(side_point(side, door_ends, 0.0), side_point(side, door_ends, 1.0), Color(0, 0, 0, 0.7), 3.0, true)
		var lip := minf(1.0, door_ends + 2.5 / length)
		draw_line(side_point(side, lip, 0.0), side_point(side, lip, 1.0), Color(214.0 / 255.0, 220.0 / 255.0, 230.0 / 255.0, 0.06 + 0.14 * light), 1.0, true)
	var radius := socket_radius * thickness * short
	for entry in sockets:
		var along := float(entry) * short / length
		if along * length > radius and along < door_ends:
			_socket(side, along, light, radius, length)
	_fill(_quad(side, 0.0, 1.0, 0.0, 0.035), Color(222.0 / 255.0, 228.0 / 255.0, 238.0 / 255.0, 0.18 + 0.42 * light))
	_fill(_quad(side, 0.0, 1.0, 0.9, 1.0), Color(0, 0, 0, 0.5))


func _socket(side: Dictionary, along: float, light: float, radius: float, length: float) -> void:
	var front: Array = side["front"]
	var unit: Vector2 = ((front[1] as Vector2) - (front[0] as Vector2)) / length
	_ellipse(side, along, unit, radius, 0.42, 1.12, Color(214.0 / 255.0, 220.0 / 255.0, 230.0 / 255.0, 0.1 + 0.22 * light))
	_ellipse(side, along, unit, radius, 0.42, 1.0, Color(6.0 / 255.0, 7.0 / 255.0, 9.0 / 255.0, 0.9))
	_ellipse(side, along, unit, radius, 0.47, 0.74, Color8(roundi(46 + 40 * light), roundi(50 + 42 * light), roundi(57 + 44 * light)))
	_ellipse(side, along, unit, radius, 0.44, 0.34, Color(214.0 / 255.0, 220.0 / 255.0, 230.0 / 255.0, 0.08 + 0.2 * light))


func _ellipse(side: Dictionary, along: float, unit: Vector2, radius: float, deep: float, scale: float, color: Color) -> void:
	var centre := side_point(side, along, deep)
	var across := side_point(side, along, deep + socket_radius * scale) - centre
	var reach := unit * radius * scale
	var points := PackedVector2Array()
	for index in range(SOCKET_STEPS):
		var turn := TAU * float(index) / SOCKET_STEPS
		points.append(centre + reach * cos(turn) + across * sin(turn))
	_fill(points, color)
