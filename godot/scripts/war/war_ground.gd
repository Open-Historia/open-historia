class_name WarGround
extends Node2D

const OUTLINE_SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform sampler2D groups : filter_nearest, repeat_disable;
uniform sampler2D colours : filter_nearest, repeat_disable;
uniform int columns = 1024;
uniform float pixel_world = 1.0;
uniform float width_px = 2.0;
uniform float soft_px = 1.0;
uniform bool casing = false;
uniform float opacity = 0.95;
varying vec4 tint;
varying float edge;
varying float core;
varying float soft;

int group_of(int region) {
	if (region < 0) {
		return 0;
	}
	return int(texelFetch(groups, ivec2(region % columns, region / columns), 0).r * 255.0 + 0.5);
}

void vertex() {
	int a = int(UV.x + 0.5);
	int b = int(floor(UV.y + 0.5));
	vec2 offset = COLOR.rg * 2.0 - 1.0;
	edge = COLOR.b * 2.0 - 1.0;
	int ga = group_of(a);
	int gb = b >= 0 ? group_of(b) : 0;
	float width = 0.0;
	tint = vec4(0.0);
	soft = soft_px;
	if (ga != gb) {
		int g = ga > 0 ? ga : gb;
		vec3 c = texelFetch(colours, ivec2(g - 1, 0), 0).rgb;
		width = width_px;
		tint = casing ? vec4(5.0 / 255.0, 8.0 / 255.0, 13.0 / 255.0, 0.9 * opacity) : vec4(c, opacity);
	}
	core = width * 0.5;
	float half_px = core + soft;
	VERTEX += offset * half_px * pixel_world;
	edge *= half_px;
}

void fragment() {
	float d = abs(edge);
	float coverage = clamp((core + soft * 0.5 - d) / soft, 0.0, 1.0);
	COLOR = vec4(tint.rgb, tint.a * coverage);
}
"""

const WASH_SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform float factor = 1.0;

void fragment() {
	COLOR = vec4(COLOR.rgb, COLOR.a * factor);
}
"""

const PATTERN_SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform sampler2D pattern : filter_nearest, repeat_enable;
uniform float zoom = 1.0;
uniform float size = 97.0;
uniform float factor = 1.0;
varying vec2 world;

void vertex() {
	world = VERTEX;
}

void fragment() {
	vec4 c = texture(pattern, floor(world * zoom) / size);
	COLOR = vec4(c.rgb, c.a * COLOR.a * factor);
}
"""

const OUTLINE_WIDTH := [[1, 1.1], [3, 1.6], [6, 2.4], [9, 3.0], [12, 3.6]]
const CASING_WIDTH := [[1, 2.4], [3, 3.2], [6, 4.4], [9, 5.4], [12, 6.4]]
const WALL := Color("#1d1915")
const STONE := Color("#b9ad94")
const WALL_STOPS := [[3, 2.6], [6, 5.0], [9, 8.0], [12, 11.0]]
const ARROW_MIN_ZOOM := 4.25
const PAST_WIDTH := [[4.5, 0.7], [7, 1.2], [10, 1.8]]
const CASING := Color(5 / 255.0, 8 / 255.0, 13 / 255.0, 0.92)
const WASH_STOPS := [[3, 1.0], [10, 0.6]]
const PATTERN_STOPS := [[3, 0.95], [7, 0.8], [10, 0.55]]


class Painter extends Node2D:
	var paint: Callable

	func _draw() -> void:
		if paint.is_valid():
			paint.call(self)


var map: MapView
var level := 2.0
var zoom := 1.0
var _outline_nodes: Array[MeshInstance2D] = []
var _outline_material: ShaderMaterial
var _casing_material: ShaderMaterial
var _group_image: Image
var _group_texture: ImageTexture
var _group_colours: Image
var _group_colours_texture: ImageTexture
var _groups_on := false
var _walls_painter: Painter
var _weather_root: Node2D
var _weather_wash: ShaderMaterial
var _weather_patterns: Array[ShaderMaterial] = []
var _arrows_painter: Painter
var _orders_painter: Painter
var _walls: Array = []
var _orders: Array = []
var _arrows: Array = []
var _arrow_colours: Array = []
var _arrow_cache := {}


func setup(map_view: MapView) -> void:
	map = map_view
	z_index = 1
	_outline_material = _material(OUTLINE_SHADER)
	_casing_material = _material(OUTLINE_SHADER)
	_casing_material.set_shader_parameter("casing", true)
	_casing_material.set_shader_parameter("soft_px", 1.6)
	_group_image = Image.create_empty(1024, 4, false, Image.FORMAT_R8)
	_group_texture = ImageTexture.create_from_image(_group_image)
	_group_colours = Image.create_empty(256, 1, false, Image.FORMAT_RGBA8)
	_group_colours_texture = ImageTexture.create_from_image(_group_colours)
	for material in [_outline_material, _casing_material]:
		material.set_shader_parameter("groups", _group_texture)
		material.set_shader_parameter("colours", _group_colours_texture)
		material.set_shader_parameter("columns", 1024)
	_walls_painter = _painter(_paint_walls)
	_weather_root = Node2D.new()
	add_child(_weather_root)
	_arrows_painter = _painter(_paint_arrows)
	_orders_painter = _painter(_paint_orders)


func _material(code: String) -> ShaderMaterial:
	var shader := Shader.new()
	shader.code = code
	var material := ShaderMaterial.new()
	material.shader = shader
	return material


func _painter(callable: Callable) -> Painter:
	var node := Painter.new()
	node.paint = callable
	add_child(node)
	return node


func clear() -> void:
	_walls = []
	_orders = []
	_arrows = []
	_arrow_cache = {}
	set_groups([])
	for child in _weather_root.get_children():
		child.queue_free()
	_redraw_all()


func set_view(next_level: float, next_zoom: float) -> void:
	level = next_level
	zoom = next_zoom
	var pixel := 1.0 / maxf(zoom, 0.00001)
	_outline_material.set_shader_parameter("pixel_world", pixel)
	_casing_material.set_shader_parameter("pixel_world", pixel)
	_outline_material.set_shader_parameter("width_px", WarKit.stops(level, OUTLINE_WIDTH))
	_casing_material.set_shader_parameter("width_px", WarKit.stops(level, CASING_WIDTH))
	_casing_material.set_shader_parameter("opacity", 0.4)
	_outline_material.set_shader_parameter("opacity", 0.95)
	if _weather_wash:
		_weather_wash.set_shader_parameter("factor", WarKit.stops(level, WASH_STOPS))
	for material in _weather_patterns:
		material.set_shader_parameter("zoom", zoom)
		material.set_shader_parameter("factor", WarKit.stops(level, PATTERN_STOPS))
	_arrow_cache = {}
	_redraw_all()


func _redraw_all() -> void:
	for painter in [_walls_painter, _arrows_painter, _orders_painter]:
		if painter:
			painter.queue_redraw()


func set_groups(groups: Array) -> void:
	var count := map.war_region_count() if map else 0
	var rows: int = maxi(1, int(ceil(float(maxi(count, 1)) / 1024.0)))
	if _group_image.get_height() != rows:
		_group_image = Image.create_empty(1024, rows, false, Image.FORMAT_R8)
		_group_texture = ImageTexture.create_from_image(_group_image)
		for material in [_outline_material, _casing_material]:
			material.set_shader_parameter("groups", _group_texture)
	_group_image.fill(Color(0, 0, 0, 1))
	_group_colours.fill(Color(0, 0, 0, 1))
	var id := 0
	for item in groups:
		var group: Dictionary = item
		id += 1
		if id > 255:
			break
		_group_colours.set_pixel(id - 1, 0, WarKit.color_of(group.get("color", [225, 29, 72])))
		for value in group.get("regions", []):
			var index := int(value)
			_group_image.set_pixel(index % 1024, index / 1024, Color8(id, 0, 0, 255))
	_group_texture.update(_group_image)
	_group_colours_texture.update(_group_colours)
	var on := id > 0
	if on != _groups_on or (on and _outline_nodes.is_empty()):
		_groups_on = on
		rebuild_copies()


func rebuild_copies() -> void:
	for node in _outline_nodes:
		if is_instance_valid(node):
			node.queue_free()
	_outline_nodes.clear()
	if not _groups_on or map == null:
		return
	var border := map.war_border_mesh()
	if border == null:
		return
	var at := 0
	for material in [_casing_material, _outline_material]:
		for offset in [-MapView.WORLD_WIDTH, 0.0, MapView.WORLD_WIDTH]:
			var node := MeshInstance2D.new()
			node.mesh = border
			node.material = material
			node.position = Vector2(offset, 0)
			add_child(node)
			move_child(node, at)
			at += 1
			_outline_nodes.append(node)


func set_walls(walls: Array) -> void:
	_walls = walls
	_arrow_cache.erase("walls")
	_walls_painter.queue_redraw()


func set_orders(orders: Array) -> void:
	_orders = orders
	_arrow_cache.erase("orders")
	_orders_painter.queue_redraw()


func set_arrows(arrows: Array, colours: Array) -> void:
	_arrows = arrows
	_arrow_colours = colours
	for key in ["shadow", "edge", "face", "outlines", "past"]:
		_arrow_cache.erase(key)
	_arrows_painter.queue_redraw()


func set_weather(weather: Dictionary) -> void:
	for child in _weather_root.get_children():
		child.queue_free()
	_weather_patterns.clear()
	_weather_wash = null
	var areas: Array = weather.get("areas", [])
	if areas.is_empty():
		return
	var patterns: Dictionary = weather.get("patterns", {})
	var wash_points := PackedVector2Array()
	var wash_colours := PackedColorArray()
	var wash_indices := PackedInt32Array()
	var by_state := {}
	for item in areas:
		var area: Dictionary = item
		var floats := Marshalls.base64_to_raw(str(area.get("points", ""))).to_float32_array()
		var points := PackedVector2Array()
		points.resize(floats.size() / 2)
		for at in range(points.size()):
			points[at] = Vector2(floats[at * 2], floats[at * 2 + 1])
		var indices := Marshalls.base64_to_raw(str(area.get("indices", ""))).to_int32_array()
		var strength := float(area.get("strength", 0.0))
		if area.get("wash", null) is Array:
			var base := wash_points.size()
			var colour := WarKit.color_of(area["wash"], float(area.get("washOpacity", 0.0)) * strength)
			wash_points.append_array(points)
			for _index in range(points.size()):
				wash_colours.append(colour)
			for value in indices:
				wash_indices.append(base + value)
		var state := str(area.get("weather", ""))
		if str(area.get("pattern", "")).is_empty() or not patterns.has(state):
			continue
		if not by_state.has(state):
			by_state[state] = [PackedVector2Array(), PackedColorArray(), PackedInt32Array()]
		var bucket: Array = by_state[state]
		var bucket_points: PackedVector2Array = bucket[0]
		var bucket_colours: PackedColorArray = bucket[1]
		var bucket_indices: PackedInt32Array = bucket[2]
		var start := bucket_points.size()
		bucket_points.append_array(points)
		var tone := Color(1, 1, 1, strength)
		for _index in range(points.size()):
			bucket_colours.append(tone)
		for value in indices:
			bucket_indices.append(start + value)
		bucket[0] = bucket_points
		bucket[1] = bucket_colours
		bucket[2] = bucket_indices
	if not wash_indices.is_empty():
		_weather_wash = _material(WASH_SHADER)
		_mesh_copies(_mesh(wash_points, wash_colours, wash_indices), _weather_wash)
	for layer in range(3):
		for state in by_state.keys():
			var tiles: Array = patterns[state]
			if layer >= tiles.size():
				continue
			var tile: Dictionary = tiles[layer]
			var image := Image.create_from_data(int(tile["width"]), int(tile["height"]), false, Image.FORMAT_RGBA8, Marshalls.base64_to_raw(str(tile["data"])))
			var material := _material(PATTERN_SHADER)
			material.set_shader_parameter("pattern", ImageTexture.create_from_image(image))
			material.set_shader_parameter("size", float(tile["width"]))
			_weather_patterns.append(material)
			var bucket: Array = by_state[state]
			_mesh_copies(_mesh(bucket[0], bucket[1], bucket[2]), material)
	set_view(level, zoom)


func _mesh(points: PackedVector2Array, colours: PackedColorArray, indices: PackedInt32Array) -> ArrayMesh:
	var mesh := ArrayMesh.new()
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = points
	arrays[Mesh.ARRAY_COLOR] = colours
	arrays[Mesh.ARRAY_INDEX] = indices
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh


func _mesh_copies(mesh: ArrayMesh, material: Material) -> void:
	for offset in [-MapView.WORLD_WIDTH, 0.0, MapView.WORLD_WIDTH]:
		var node := MeshInstance2D.new()
		node.mesh = mesh
		node.material = material
		node.position = Vector2(offset, 0)
		_weather_root.add_child(node)


func _wall_width(factor: float, weight: float) -> float:
	return WarKit.stops(level, WALL_STOPS) * factor * weight


func _wall_batches() -> Array:
	var pixel := 1.0 / maxf(zoom, 0.00001)
	var layers: Array = []
	for layer in ["rubble", "planned", "progress", "casing", "core", "teeth"]:
		var into := WarKit.batch()
		for item in _walls:
			var wall: Dictionary = item
			var part := str(wall.get("part", ""))
			var weight := float(wall.get("weight", 1.0))
			var points := WarKit.points_of(wall.get("line", []))
			if points.size() < 2:
				continue
			match layer:
				"rubble":
					if part == "rubble":
						var width := _wall_width(0.4, weight) * pixel
						for dash in WarKit.dashes(points, 0.1 * width, 2.2 * width):
							WarKit.disc(into, dash[0].lerp(dash[dash.size() - 1], 0.5), width * 0.5, pixel, WarKit.faded(WALL, 0.55))
				"planned", "progress":
					if part == layer:
						var width := _wall_width(0.7, weight) * pixel
						for dash in WarKit.dashes(points, 1.6 * width, 1.2 * width):
							WarKit.stroke(into, dash, width, pixel, WarKit.faded(WALL, 0.38 if layer == "planned" else 0.78))
				"casing":
					if part == "wall":
						WarKit.stroke(into, points, _wall_width(1.0, weight) * pixel, pixel, WarKit.faded(WALL, 0.92))
				"core":
					if part == "wall":
						WarKit.stroke(into, points, _wall_width(0.28, weight) * pixel, pixel, WarKit.faded(STONE, 0.85))
				"teeth":
					if part == "wall":
						var width := _wall_width(0.55, weight) * pixel
						var shifted := WarKit.offset_line(points, _wall_width(0.75, weight) * pixel)
						for dash in WarKit.dashes(shifted, width, width):
							WarKit.stroke(into, dash, width, pixel, WarKit.faded(WALL, 0.92))
		layers.append(into)
	return layers


func _paint_walls(node: Node2D) -> void:
	if _walls.is_empty():
		return
	if not _arrow_cache.has("walls"):
		_arrow_cache["walls"] = _wall_batches()
	var layers: Array = _arrow_cache["walls"]
	var item := node.get_canvas_item()
	for offset in [-MapView.WORLD_WIDTH, 0.0, MapView.WORLD_WIDTH]:
		node.draw_set_transform(Vector2(offset, 0))
		for into in layers:
			WarKit.flush(item, into)
	node.draw_set_transform(Vector2.ZERO)


func _arrow_layers() -> Dictionary:
	if _arrow_cache.has("face"):
		return _arrow_cache
	var pixel := 1.0 / maxf(zoom, 0.00001)
	var shadow := WarKit.batch()
	var edge := WarKit.batch()
	var face := WarKit.batch()
	var outlines := WarKit.batch()
	var past := WarKit.batch()
	var past_width := WarKit.stops(level, PAST_WIDTH) * pixel
	for item in _arrows:
		var arrow: Dictionary = item
		var alpha := float(arrow.get("alpha", 1.0))
		var rgb_at := int(arrow.get("rgb", 0))
		var rgb := WarKit.color_of(_arrow_colours[rgb_at] if rgb_at < _arrow_colours.size() else null)
		if arrow.get("past", false):
			WarKit.stroke(past, WarKit.points_of(arrow.get("line", [])), past_width, pixel, WarKit.faded(rgb, 0.4 * alpha))
			continue
		var dark_at := int(arrow.get("dark", 0))
		var dark := WarKit.color_of(_arrow_colours[dark_at] if dark_at < _arrow_colours.size() else null)
		var points := WarKit.points_of(arrow.get("points", []))
		var indices := WarKit.ints_of(arrow.get("indices", []))
		var ring := points.duplicate()
		if ring.size() > 0:
			ring.append(ring[0])
		_fill(shadow, points, indices, WarKit.faded(CASING, 0.28 * alpha))
		WarKit.stroke(shadow, ring, pixel, pixel, WarKit.faded(CASING, 0.28 * alpha))
		_fill(edge, points, indices, WarKit.faded(dark, 0.95 * alpha))
		WarKit.stroke(edge, ring, pixel, pixel, WarKit.faded(dark, 0.95 * alpha))
		_fill(face, points, indices, WarKit.faded(rgb, 0.94 * alpha))
		WarKit.stroke(outlines, ring, pixel, pixel, WarKit.faded(dark, 0.94 * alpha))
	_arrow_cache["shadow"] = shadow
	_arrow_cache["edge"] = edge
	_arrow_cache["face"] = face
	_arrow_cache["outlines"] = outlines
	_arrow_cache["past"] = past
	return _arrow_cache


func _fill(into: Array, points: PackedVector2Array, indices: PackedInt32Array, colour: Color) -> void:
	var verts: PackedVector2Array = into[0]
	var colours: PackedColorArray = into[1]
	var out: PackedInt32Array = into[2]
	var start := verts.size()
	verts.append_array(points)
	for _index in range(points.size()):
		colours.append(colour)
	for value in indices:
		out.append(start + value)
	into[0] = verts
	into[1] = colours
	into[2] = out


func _paint_arrows(node: Node2D) -> void:
	if _arrows.is_empty() or level < ARROW_MIN_ZOOM:
		return
	var layers := _arrow_layers()
	var pixel := 1.0 / maxf(zoom, 0.00001)
	var item := node.get_canvas_item()
	for offset in [-MapView.WORLD_WIDTH, 0.0, MapView.WORLD_WIDTH]:
		node.draw_set_transform(Vector2(offset, 0))
		WarKit.flush(item, layers["past"])
		node.draw_set_transform(Vector2(offset, 0) + Vector2(3, 4) * pixel)
		WarKit.flush(item, layers["shadow"])
		node.draw_set_transform(Vector2(offset, 0) + Vector2(1.4, 2) * pixel)
		WarKit.flush(item, layers["edge"])
		node.draw_set_transform(Vector2(offset, 0))
		WarKit.flush(item, layers["face"])
		WarKit.flush(item, layers["outlines"])
	node.draw_set_transform(Vector2.ZERO)


func _order_batch() -> Array:
	var pixel := 1.0 / maxf(zoom, 0.00001)
	var into := WarKit.batch()
	for item in _orders:
		var order: Dictionary = item
		var points := WarKit.points_of(order.get("line", []))
		var colour := WarKit.color_of(order.get("rgb", null))
		if str(order.get("kind", "")) == "heading":
			if level < 3.0:
				continue
			for dash in WarKit.dashes(points, 3.0 * pixel, 3.0 * pixel):
				WarKit.stroke(into, dash, 1.5 * pixel, pixel, WarKit.faded(colour, 0.6))
		else:
			for dash in WarKit.dashes(points, 3.6 * pixel, 3.6 * pixel):
				WarKit.stroke(into, dash, 1.2 * pixel, pixel, WarKit.faded(colour, 0.35))
	return into


func _paint_orders(node: Node2D) -> void:
	if _orders.is_empty():
		return
	if not _arrow_cache.has("orders"):
		_arrow_cache["orders"] = _order_batch()
	var into: Array = _arrow_cache["orders"]
	var item := node.get_canvas_item()
	for offset in [-MapView.WORLD_WIDTH, 0.0, MapView.WORLD_WIDTH]:
		node.draw_set_transform(Vector2(offset, 0))
		WarKit.flush(item, into)
	node.draw_set_transform(Vector2.ZERO)
