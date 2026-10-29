class_name WarGround
extends Node2D

const WEATHER_SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform sampler2D pattern_0 : filter_nearest, repeat_enable;
uniform sampler2D pattern_1 : filter_nearest, repeat_enable;
uniform sampler2D pattern_2 : filter_nearest, repeat_enable;
uniform float size_0 = 97.0;
uniform float size_1 = 97.0;
uniform float size_2 = 97.0;
uniform int layers = 0;
uniform float zoom = 1.0;
uniform float wash_factor = 1.0;
uniform float pattern_factor = 1.0;
varying vec2 world;
varying float strength;

void vertex() {
	world = VERTEX;
	strength = UV.x;
}

vec4 over(vec4 top, vec4 under) {
	float alpha = top.a + under.a * (1.0 - top.a);
	if (alpha <= 0.0) {
		return vec4(0.0);
	}
	return vec4((top.rgb * top.a + under.rgb * under.a * (1.0 - top.a)) / alpha, alpha);
}

vec4 layer(sampler2D pattern, float size) {
	vec4 c = texture(pattern, floor(world * zoom) / size);
	return vec4(c.rgb, c.a * strength * pattern_factor);
}

void fragment() {
	vec4 result = vec4(COLOR.rgb, COLOR.a * wash_factor);
	if (layers > 0) {
		result = over(layer(pattern_0, size_0), result);
	}
	if (layers > 1) {
		result = over(layer(pattern_1, size_1), result);
	}
	if (layers > 2) {
		result = over(layer(pattern_2, size_2), result);
	}
	COLOR = result;
}
"""

const WALL := Color("#1d1915")
const STONE := Color("#b9ad94")
const WALL_STOPS := [[3, 2.6], [6, 5.0], [9, 8.0], [12, 11.0]]
const ARROW_MIN_ZOOM := 4.25
const PAST_WIDTH := [[4.5, 0.7], [7, 1.2], [10, 1.8]]
const CASING := Color(5 / 255.0, 8 / 255.0, 13 / 255.0, 0.92)
const WASH_STOPS := [[3, 1.0], [10, 0.6]]
const PATTERN_STOPS := [[3, 0.95], [7, 0.8], [10, 0.55]]
const WEATHER_CELLS := 8


class Painter extends Node2D:
	var paint: Callable

	func _draw() -> void:
		if paint.is_valid():
			paint.call(self)


var map: MapView
var level := 2.0
var zoom := 1.0
var _walls_painter: Painter
var _weather_root: Node2D
var _weather_materials: Array[ShaderMaterial] = []
var _arrows_painter: Painter
var _orders_painter: Painter
var _walls: Array = []
var _orders: Array = []
var _arrows: Array = []
var _arrow_colours: Array = []
var _arrow_cache := {}
var _weather_serial := 0
var _weather_tasks: Array[int] = []
var _pattern_textures := {}
var _shaders := {}


func setup(map_view: MapView) -> void:
	map = map_view
	z_index = 1
	_walls_painter = _painter(_paint_walls)
	_weather_root = Node2D.new()
	add_child(_weather_root)
	_arrows_painter = _painter(_paint_arrows)
	_orders_painter = _painter(_paint_orders)


func _material(code: String) -> ShaderMaterial:
	var shader: Shader = _shaders.get(code)
	if shader == null:
		shader = Shader.new()
		shader.code = code
		_shaders[code] = shader
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
	_weather_serial += 1
	for child in _weather_root.get_children():
		child.queue_free()
	_redraw_all()


func set_view(next_level: float, next_zoom: float) -> void:
	level = next_level
	zoom = next_zoom
	for material in _weather_materials:
		material.set_shader_parameter("wash_factor", WarKit.stops(level, WASH_STOPS))
		material.set_shader_parameter("zoom", pow(2.0, floorf(level)) / 8.0)
		material.set_shader_parameter("pattern_factor", WarKit.stops(level, PATTERN_STOPS))
	_arrow_cache = {}
	_redraw_all()


func _redraw_all() -> void:
	for painter in [_walls_painter, _arrows_painter, _orders_painter]:
		if painter:
			painter.queue_redraw()


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
	_weather_serial += 1
	var serial := _weather_serial
	_reap_weather()
	var areas: Array = weather.get("areas", [])
	var patterns: Dictionary = weather.get("patterns", {})
	if areas.is_empty():
		_weather_built(serial, {}, {}, patterns)
		return
	_weather_tasks.append(WorkerThreadPool.add_task(_weather_buckets.bind(serial, areas, patterns), false, "war weather"))


func _weather_buckets(serial: int, areas: Array, patterns: Dictionary) -> void:
	var wash_cells := {}
	var by_state := {}
	for item in areas:
		var area: Dictionary = item
		var points := Marshalls.base64_to_raw(str(area.get("points", ""))).to_vector2_array()
		if points.is_empty():
			continue
		var cell := _weather_cell(points[0])
		var indices := Marshalls.base64_to_raw(str(area.get("indices", ""))).to_int32_array()
		var strength := float(area.get("strength", 0.0))
		var washed: bool = area.get("wash", null) is Array
		var wash := WarKit.color_of(area["wash"], float(area.get("washOpacity", 0.0)) * strength) if washed else Color(0, 0, 0, 0)
		var state := str(area.get("weather", ""))
		if not str(area.get("pattern", "")).is_empty() and patterns.has(state):
			if not by_state.has(state):
				by_state[state] = {}
			_weather_append(by_state[state], cell, points, indices, wash, strength)
		elif washed:
			_weather_append(wash_cells, cell, points, indices, wash, 0.0)
	_weather_built.call_deferred(serial, wash_cells, by_state, patterns)


func _weather_built(serial: int, wash_cells: Dictionary, by_state: Dictionary, patterns: Dictionary) -> void:
	_reap_weather()
	if serial != _weather_serial or not is_inside_tree():
		return
	for child in _weather_root.get_children():
		child.queue_free()
	_weather_materials.clear()
	if not wash_cells.is_empty():
		_cell_copies(wash_cells, _weather_material([]))
	for state in by_state.keys():
		_cell_copies(by_state[state], _weather_material(patterns[state]))
	set_view(level, zoom)


func _reap_weather() -> void:
	var kept: Array[int] = []
	for task in _weather_tasks:
		if WorkerThreadPool.is_task_completed(task):
			WorkerThreadPool.wait_for_task_completion(task)
		else:
			kept.append(task)
	_weather_tasks = kept


func _exit_tree() -> void:
	for task in _weather_tasks:
		WorkerThreadPool.wait_for_task_completion(task)
	_weather_tasks.clear()


func _pattern_texture(tile: Dictionary) -> ImageTexture:
	var data := str(tile["data"])
	var key := "%d|%d|%d|%d" % [int(tile["width"]), int(tile["height"]), data.length(), data.hash()]
	var known: Variant = _pattern_textures.get(key)
	if known is ImageTexture:
		return known
	var image := Image.create_from_data(int(tile["width"]), int(tile["height"]), false, Image.FORMAT_RGBA8, Marshalls.base64_to_raw(data))
	var texture := ImageTexture.create_from_image(image)
	if _pattern_textures.size() >= 32:
		_pattern_textures.clear()
	_pattern_textures[key] = texture
	return texture


func _weather_material(tiles: Array) -> ShaderMaterial:
	var material := _material(WEATHER_SHADER)
	var layers := mini(tiles.size(), 3)
	material.set_shader_parameter("layers", layers)
	for layer in range(layers):
		var tile: Dictionary = tiles[layer]
		material.set_shader_parameter("pattern_%d" % layer, _pattern_texture(tile))
		material.set_shader_parameter("size_%d" % layer, float(tile["width"]))
	_weather_materials.append(material)
	return material


static func _weather_cell(point: Vector2) -> int:
	var span := MapView.WORLD_WIDTH / float(WEATHER_CELLS)
	var column := clampi(floori(point.x / span), 0, WEATHER_CELLS - 1)
	var row := clampi(floori(point.y / span), 0, WEATHER_CELLS - 1)
	return row * WEATHER_CELLS + column


static func _weather_append(cells: Dictionary, cell: int, points: PackedVector2Array, indices: PackedInt32Array, colour: Color, strength: float) -> void:
	if not cells.has(cell):
		cells[cell] = [PackedVector2Array(), PackedColorArray(), PackedInt32Array(), PackedVector2Array()]
	var bucket: Array = cells[cell]
	var bucket_points: PackedVector2Array = bucket[0]
	var bucket_colours: PackedColorArray = bucket[1]
	var bucket_indices: PackedInt32Array = bucket[2]
	var bucket_uvs: PackedVector2Array = bucket[3]
	bucket[0] = PackedVector2Array()
	bucket[1] = PackedColorArray()
	bucket[2] = PackedInt32Array()
	bucket[3] = PackedVector2Array()
	var start := bucket_points.size()
	bucket_points.append_array(points)
	var tones := PackedColorArray()
	tones.resize(points.size())
	tones.fill(colour)
	bucket_colours.append_array(tones)
	var strengths := PackedVector2Array()
	strengths.resize(points.size())
	strengths.fill(Vector2(strength, 0.0))
	bucket_uvs.append_array(strengths)
	var shifted := PackedInt32Array()
	shifted.resize(indices.size())
	for at in range(indices.size()):
		shifted[at] = start + indices[at]
	bucket_indices.append_array(shifted)
	bucket[0] = bucket_points
	bucket[1] = bucket_colours
	bucket[2] = bucket_indices
	bucket[3] = bucket_uvs


func _cell_copies(cells: Dictionary, material: Material) -> void:
	var keys := cells.keys()
	keys.sort()
	for cell: int in keys:
		var bucket: Array = cells[cell]
		if (bucket[2] as PackedInt32Array).is_empty():
			continue
		_mesh_copies(_mesh(bucket[0], bucket[1], bucket[2], bucket[3]), material)


func _mesh(points: PackedVector2Array, colours: PackedColorArray, indices: PackedInt32Array, uvs: PackedVector2Array) -> ArrayMesh:
	var mesh := ArrayMesh.new()
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = points
	arrays[Mesh.ARRAY_COLOR] = colours
	arrays[Mesh.ARRAY_TEX_UV] = uvs
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
	into[0] = PackedVector2Array()
	into[1] = PackedColorArray()
	into[2] = PackedInt32Array()
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
