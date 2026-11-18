extends Node

const COLUMNS := 1024
const FLOOR := 0.78
const HATCH_KINDS := ["ceasefire", "puppet", "occupied", "candidate", "suspended"]
const HATCH_OPACITY := 0.85
const FRONT_WIDTH := [[1.0, 1.6], [4.0, 2.6], [8.0, 3.6], [12.0, 4.6]]
const FRONT_CASING_WIDTH := [[1.0, 3.4], [4.0, 5.0], [8.0, 6.6], [12.0, 8.0]]
const FOCUS_WIDTH := [[1.0, 1.4], [4.0, 2.2], [8.0, 3.0], [12.0, 3.8]]
const OUTLINE_WIDTH := [[1.0, 1.3], [3.0, 1.8], [6.0, 2.6], [9.0, 3.2], [12.0, 3.8]]
const OUTLINE_CASING_WIDTH := [[1.0, 2.8], [3.0, 3.6], [6.0, 4.8], [9.0, 5.8], [12.0, 6.8]]
const LINE_WIDTH := [[1.0, 1.1], [4.0, 1.6], [8.0, 2.2]]
const LINE_CASING_WIDTH := [[1.0, 2.6], [4.0, 3.4], [8.0, 4.4]]
const SEAT_RADIUS := [[1.0, 3.0], [6.0, 5.0]]
const CASING := Color(5 / 255.0, 8 / 255.0, 13 / 255.0)

const HATCH_SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform sampler2D region_hatch : filter_nearest;
uniform vec4 hatch_colors[6];
uniform int hatch_styles[6];
uniform int columns = 1024;
uniform float pattern_scale = 1.0;
uniform float opacity = 0.85;
varying flat int region;
varying vec2 local_pos;
void vertex() {
	region = int(UV.x + 0.5);
	local_pos = VERTEX;
}
void fragment() {
	int kind = int(texelFetch(region_hatch, ivec2(region % columns, region / columns), 0).r * 255.0 + 0.5);
	if (kind <= 0 || kind > 5) {
		discard;
	}
	ivec2 pixel = ivec2(floor(local_pos * pattern_scale));
	int forward = (pixel.x + pixel.y) % 12;
	if (forward < 0) {
		forward += 12;
	}
	int backward = (pixel.x - pixel.y) % 12;
	if (backward < 0) {
		backward += 12;
	}
	int style = hatch_styles[kind];
	bool on = style == 1 ? forward < 2 : (style == 2 ? backward < 2 : (forward < 2 || backward < 2));
	if (!on) {
		discard;
	}
	COLOR = vec4(hatch_colors[kind].rgb, 220.0 / 255.0 * opacity);
}
"""

const EDGE_SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform sampler2D region_owner : filter_nearest;
uniform sampler2D owner_flags : filter_nearest;
uniform sampler2D owner_pairs : filter_nearest;
uniform int columns = 1024;
uniform int kind = 0;
uniform float line_width = 1.0;
uniform float blur = 1.0;
uniform vec4 tint = vec4(1.0);
uniform float pixel_world = 1.0;
varying float edge;
varying float outset;
int owner_of(int region) {
	return int(texelFetch(region_owner, ivec2(region % columns, region / columns), 0).r + 0.5);
}
vec4 flags_of(int owner) {
	return texelFetch(owner_flags, ivec2(owner - 1, 0), 0);
}
void vertex() {
	int a = int(UV.x + 0.5);
	int b = int(floor(UV.y + 0.5));
	vec2 offset = COLOR.rg * 2.0 - 1.0;
	edge = COLOR.b * 2.0 - 1.0;
	int oa = owner_of(a);
	int ob = b >= 0 ? owner_of(b) : 0;
	bool shown = false;
	if (kind == 0) {
		shown = oa > 0 && ob > 0 && oa != ob && texelFetch(owner_pairs, ivec2(oa - 1, ob - 1), 0).r > 0.5;
	} else if (kind == 1) {
		shown = oa > 0 && ob > 0 && oa != ob && (flags_of(oa).r > 0.5 || flags_of(ob).r > 0.5);
	} else {
		bool in_a = oa > 0 && flags_of(oa).g > 0.5;
		bool in_b = ob > 0 && flags_of(ob).g > 0.5;
		shown = in_a != in_b;
	}
	float width = shown ? line_width : 0.0;
	outset = width > 0.0 ? width * 0.5 + 0.5 : 0.0;
	VERTEX += offset * outset * pixel_world;
	edge *= outset;
}
void fragment() {
	float coverage = clamp((outset - abs(edge)) / blur, 0.0, 1.0);
	COLOR = vec4(tint.rgb, tint.a * coverage);
}
"""

var extras: Node
var map_view: MapView
var active := false
var payload: Dictionary = {}
var _rows := 1
var _hatch_image: Image
var _hatch_texture: ImageTexture
var _owner_image: Image
var _owner_texture: ImageTexture
var _flags_texture: ImageTexture
var _pairs_texture: ImageTexture
var _hatch_material: ShaderMaterial
var _edge_materials: Array[ShaderMaterial] = []
var _hatch_nodes: Array[Node2D] = []
var _edge_nodes: Array[Node2D] = []
var _lines: Control
var _has_hatch := false
var _has_edges := false


func setup(owner_extras: Node) -> void:
	extras = owner_extras
	map_view = extras.get("map_view")
	_hatch_material = _material(HATCH_SHADER)
	_hatch_material.set_shader_parameter("opacity", HATCH_OPACITY)
	for kind in [0, 0, 1, 2, 2]:
		var material := _material(EDGE_SHADER)
		material.set_shader_parameter("kind", kind)
		_edge_materials.append(material)
	_edge_materials[0].set_shader_parameter("tint", Color(CASING, 0.85 * 0.75))
	_edge_materials[3].set_shader_parameter("tint", Color(CASING, 0.9 * 0.55))
	_edge_materials[3].set_shader_parameter("blur", 1.6)
	_lines = DiplomaticLines.new()
	_lines.layers = self
	var layer: Variant = map_view.get("_labels_layer")
	if layer is Control:
		(layer as Control).add_child(_lines)
		(layer as Control).move_child(_lines, 0)
	_alloc()


func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE and _lines and is_instance_valid(_lines):
		_lines.queue_free()


func _material(code: String) -> ShaderMaterial:
	var shader := Shader.new()
	shader.code = code
	var material := ShaderMaterial.new()
	material.shader = shader
	return material


func _alloc() -> void:
	var count: int = max(1, map_view.extras_region_count())
	_rows = max(1, int(ceil(float(count) / COLUMNS)))
	_hatch_image = Image.create_empty(COLUMNS, _rows, false, Image.FORMAT_R8)
	_hatch_texture = ImageTexture.create_from_image(_hatch_image)
	_owner_image = Image.create_empty(COLUMNS, _rows, false, Image.FORMAT_RF)
	_owner_texture = ImageTexture.create_from_image(_owner_image)
	var blank := Image.create_empty(1, 1, false, Image.FORMAT_RGBA8)
	_flags_texture = ImageTexture.create_from_image(blank)
	_pairs_texture = ImageTexture.create_from_image(Image.create_empty(1, 1, false, Image.FORMAT_R8))
	_hatch_material.set_shader_parameter("region_hatch", _hatch_texture)
	_hatch_material.set_shader_parameter("columns", COLUMNS)
	for material in _edge_materials:
		material.set_shader_parameter("region_owner", _owner_texture)
		material.set_shader_parameter("owner_flags", _flags_texture)
		material.set_shader_parameter("owner_pairs", _pairs_texture)
		material.set_shader_parameter("columns", COLUMNS)


func rebuild() -> void:
	_alloc()
	_mount()
	if active:
		apply(payload)


func _mount() -> void:
	for node in _hatch_nodes + _edge_nodes:
		if is_instance_valid(node):
			node.queue_free()
	_hatch_nodes.clear()
	_edge_nodes.clear()
	var meshes: Dictionary = map_view.extras_meshes()
	if meshes.get("fill") == null:
		return
	for slot in extras.call("slots", "under"):
		var node := map_view.extras_region_layer("fill", _hatch_material)
		node.name = "diplomatic_hatch"
		node.visible = active and _has_hatch
		(slot as Node2D).add_child(node)
		_hatch_nodes.append(node)
	if meshes.get("border") == null:
		return
	for slot in extras.call("slots", "top"):
		var holder := Node2D.new()
		holder.name = "diplomatic_edges"
		for material in _edge_materials:
			holder.add_child(map_view.extras_region_layer("border", material))
		holder.visible = active and _has_edges
		(slot as Node2D).add_child(holder)
		_edge_nodes.append(holder)


func fill_opacity(level: float) -> float:
	return maxf(MapExtras.political_fill_opacity(level), FLOOR)


func apply(next: Dictionary) -> void:
	payload = next
	var was := active
	active = not next.is_empty() and str(next.get("mode", "")) == "diplomatic"
	if _hatch_nodes.is_empty() and map_view.extras_ready():
		_mount()
	if map_view.extras_region_count() > _rows * COLUMNS:
		_alloc()
		_mount()
	_apply_hatch()
	_apply_owners()
	for node in _hatch_nodes:
		if is_instance_valid(node):
			node.visible = active and _has_hatch
			var slot := node.get_parent()
			if slot:
				slot.move_child(node, slot.get_child_count() - 1)
	for node in _edge_nodes:
		if is_instance_valid(node):
			node.visible = active and _has_edges
			var slot := node.get_parent()
			if slot:
				slot.move_child(node, slot.get_child_count() - 1)
	if was != active:
		map_view.call("_after_camera_move")
	on_zoom(map_view.zoom_level())
	if _lines:
		_lines.queue_redraw()


func on_state() -> void:
	if active:
		_apply_owners()
		if _lines:
			_lines.queue_redraw()


func _apply_hatch() -> void:
	_hatch_image.fill(Color(0, 0, 0, 0))
	var flat: Array = payload.get("hatch", []) if active else []
	var count := 0
	var capacity := _rows * COLUMNS
	for at in range(0, flat.size() - 1, 2):
		var index := int(flat[at])
		var kind := int(flat[at + 1])
		if index < 0 or index >= capacity or kind <= 0:
			continue
		_hatch_image.set_pixel(index % COLUMNS, index / COLUMNS, Color8(kind, 0, 0))
		count += 1
	_hatch_texture.update(_hatch_image)
	_has_hatch = count > 0
	var colors := PackedColorArray()
	var styles := PackedInt32Array()
	colors.resize(6)
	styles.resize(6)
	var hatches: Dictionary = payload.get("hatches", {})
	for slot in range(HATCH_KINDS.size()):
		var look: Dictionary = hatches.get(HATCH_KINDS[slot], {})
		var rgb: Array = look.get("color", [246, 241, 227])
		colors[slot + 1] = Color8(int(rgb[0]), int(rgb[1]), int(rgb[2]))
		var style := str(look.get("style", "diag"))
		styles[slot + 1] = 1 if style == "diag" else (2 if style == "back" else 3)
	_hatch_material.set_shader_parameter("hatch_colors", colors)
	_hatch_material.set_shader_parameter("hatch_styles", styles)


func _apply_owners() -> void:
	var owners := map_view.extras_owners()
	var names := map_view.extras_owner_names()
	var capacity := _rows * COLUMNS
	_owner_image.fill(Color(0, 0, 0, 0))
	for index in range(mini(owners.size(), capacity)):
		var slot := owners[index]
		if slot >= 0:
			_owner_image.set_pixel(index % COLUMNS, index / COLUMNS, Color(float(slot + 1), 0, 0, 0))
	_owner_texture.update(_owner_image)
	var count: int = max(1, names.size())
	var slot_of := {}
	for slot in range(names.size()):
		slot_of[names[slot]] = slot
	var flags := Image.create_empty(count, 1, false, Image.FORMAT_RGBA8)
	var info: Dictionary = payload.get("owners", {}) if active else {}
	var focus: Array = payload.get("focusOwners", []) if active else []
	var any_focus := false
	var any_area := false
	for slot in range(names.size()):
		var focused := focus.has(names[slot])
		var entry: Dictionary = info.get(names[slot], {})
		var area := bool(entry.get("area", false))
		any_focus = any_focus or focused
		any_area = any_area or area
		flags.set_pixel(slot, 0, Color(1.0 if focused else 0.0, 1.0 if area else 0.0, 0, 1))
	_flags_texture = ImageTexture.create_from_image(flags)
	var pairs := Image.create_empty(count, count, false, Image.FORMAT_R8)
	var any_front := false
	for pair in (payload.get("fronts", []) if active else []):
		if not (pair is Array) or (pair as Array).size() < 2:
			continue
		var a: int = slot_of.get(str(pair[0]), -1)
		var b: int = slot_of.get(str(pair[1]), -1)
		if a < 0 or b < 0:
			continue
		pairs.set_pixel(a, b, Color(1, 0, 0))
		pairs.set_pixel(b, a, Color(1, 0, 0))
		any_front = true
	_pairs_texture = ImageTexture.create_from_image(pairs)
	for material in _edge_materials:
		material.set_shader_parameter("owner_flags", _flags_texture)
		material.set_shader_parameter("owner_pairs", _pairs_texture)
	_has_edges = any_front or any_focus or any_area


func on_zoom(level: float) -> void:
	var pixel := 1.0 / map_view.camera.zoom.x
	_hatch_material.set_shader_parameter("pattern_scale", pow(2.0, floorf(level)) / 8.0)
	var widths := [stops(FRONT_CASING_WIDTH, level), stops(FRONT_WIDTH, level), stops(FOCUS_WIDTH, level), stops(OUTLINE_CASING_WIDTH, level), stops(OUTLINE_WIDTH, level)]
	var lines: Dictionary = payload.get("paint", {}).get("lines", {}) if payload.get("paint") is Dictionary else {}
	var war: Array = lines.get("war", [224, 90, 58])
	var focus: Array = payload.get("paint", {}).get("self", [246, 241, 227]) if payload.get("paint") is Dictionary else [246, 241, 227]
	_edge_materials[2].set_shader_parameter("tint", Color(Color8(int(focus[0]), int(focus[1]), int(focus[2])), 0.9))
	var outline: Array = payload.get("paint", {}).get("outline", [246, 241, 227]) if payload.get("paint") is Dictionary else [246, 241, 227]
	_edge_materials[1].set_shader_parameter("tint", Color(Color8(int(war[0]), int(war[1]), int(war[2])), 0.95))
	_edge_materials[4].set_shader_parameter("tint", Color(Color8(int(outline[0]), int(outline[1]), int(outline[2])), 0.95))
	for index in range(_edge_materials.size()):
		_edge_materials[index].set_shader_parameter("line_width", widths[index])
		_edge_materials[index].set_shader_parameter("pixel_world", pixel)
	if _lines:
		_lines.queue_redraw()


static func stops(table: Array, level: float) -> float:
	var first: Array = table[0]
	if level <= float(first[0]):
		return float(first[1])
	for index in range(1, table.size()):
		var stop: Array = table[index]
		if level <= float(stop[0]):
			var previous: Array = table[index - 1]
			return lerpf(float(previous[1]), float(stop[1]), (level - float(previous[0])) / (float(stop[0]) - float(previous[0])))
	var last: Array = table[table.size() - 1]
	return float(last[1])


func line_count() -> int:
	return (payload.get("lines", []) as Array).size() if active else 0


func hatched_regions() -> int:
	return (payload.get("hatch", []) as Array).size() / 2 if active else 0


class DiplomaticLines extends Control:
	var layers: Node

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)

	func _ready() -> void:
		var map: Variant = layers.get("map_view")
		if map is MapView and not (map as MapView).camera_moved.is_connected(queue_redraw):
			(map as MapView).camera_moved.connect(queue_redraw)

	func _screen(map: MapView, coordinates: Array) -> Array:
		var world := PackedVector2Array()
		var previous := 0.0
		for coordinate in coordinates:
			var lon := float(coordinate[0])
			if not world.is_empty():
				while lon - previous > 180.0:
					lon -= 360.0
				while lon - previous < -180.0:
					lon += 360.0
			previous = lon
			var at := GlobeView.world_of_lonlat(lon, float(coordinate[1]))
			at.x = (lon + 180.0) / 360.0 * MapView.WORLD_WIDTH
			world.append(at)
		if world.is_empty():
			return []
		if map.is_globe():
			var shown := map.world_to_screen_many(world)
			var depths := map.label_depth_many(world)
			var runs: Array = []
			var run := PackedVector2Array()
			for index in range(shown.size()):
				if clampf(0.5 + 0.5 / depths[index], 0.0, 4.0) >= MapView.LABEL_PERSPECTIVE_CUTOFF:
					run.append(shown[index])
				elif run.size() > 1:
					runs.append(run)
					run = PackedVector2Array()
				else:
					run = PackedVector2Array()
			if run.size() > 1:
				runs.append(run)
			return runs
		var zoom := map.camera.zoom.x
		var half := map.get_viewport_rect().size * 0.5
		var shift: float = MapView.WORLD_WIDTH * round((map.camera.position.x - world[0].x) / MapView.WORLD_WIDTH)
		var out: Array = []
		for copy in [-1.0, 0.0, 1.0]:
			var points := PackedVector2Array()
			for at in world:
				points.append((Vector2(at.x + shift + copy * MapView.WORLD_WIDTH, at.y) - map.camera.position) * zoom + half)
			out.append(points)
		return out

	func _draw() -> void:
		if layers == null or not bool(layers.get("active")):
			return
		var map: MapView = layers.get("map_view")
		var payload: Dictionary = layers.get("payload")
		var lines: Array = payload.get("lines", [])
		var seat: Variant = payload.get("seat")
		if lines.is_empty() and not (seat is Array):
			return
		var level := map.zoom_level()
		var width: float = layers.call("stops", LINE_WIDTH, level)
		var casing: float = layers.call("stops", LINE_CASING_WIDTH, level)
		var paint: Dictionary = payload.get("paint", {})
		var tints: Dictionary = paint.get("lines", {})
		var drawn: Array = []
		for line in lines:
			drawn.append([str((line as Dictionary).get("kind", "")), _screen(map, (line as Dictionary).get("points", []))])
		for entry in drawn:
			for points in entry[1]:
				draw_polyline(points, Color(CASING, 0.8 * 0.6), casing, true)
		for kind in ["ally", "war", "ceasefire"]:
			var rgb: Array = tints.get(kind, [246, 241, 227])
			var alpha := 0.85 if kind == "ally" else (0.95 if kind == "war" else 0.9)
			var colour := Color(Color8(int(rgb[0]), int(rgb[1]), int(rgb[2])), alpha)
			for entry in drawn:
				if entry[0] != kind:
					continue
				for points in entry[1]:
					if kind == "ally":
						draw_polyline(points, colour, width, true)
						draw_circle(points[0], width * 0.5, colour, true, -1.0, true)
						draw_circle(points[points.size() - 1], width * 0.5, colour, true, -1.0, true)
					else:
						_dashed(points, colour, width, [3.0, 2.0] if kind == "war" else [1.0, 2.5])
		if seat is Array and (seat as Array).size() >= 2:
			var radius: float = layers.call("stops", SEAT_RADIUS, level)
			var self_rgb: Array = paint.get("self", [246, 241, 227])
			for points in _screen(map, [seat]):
				var at: Vector2 = points[0]
				draw_circle(at, radius + 1.5, Color(CASING, 0.9), true, -1.0, true)
				draw_circle(at, radius, Color8(int(self_rgb[0]), int(self_rgb[1]), int(self_rgb[2])), true, -1.0, true)

	func _dashed(points: PackedVector2Array, colour: Color, width: float, pattern: Array) -> void:
		var on := float(pattern[0]) * width
		var off := float(pattern[1]) * width
		var drawing := true
		var left := on
		for index in range(points.size() - 1):
			var a := points[index]
			var b := points[index + 1]
			var length := a.distance_to(b)
			var walked := 0.0
			while walked < length:
				var step := minf(left, length - walked)
				var from := a.lerp(b, walked / length)
				var to := a.lerp(b, (walked + step) / length)
				if drawing:
					draw_line(from, to, colour, width, true)
				walked += step
				left -= step
				if left <= 0.0001:
					drawing = not drawing
					left = on if drawing else off
