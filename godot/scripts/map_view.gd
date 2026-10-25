class_name MapView
extends Node2D

signal region_clicked(index: int)
signal baked(info: Dictionary)
signal bake_failed(message: String)

const COLUMNS := 1024
const WORLD_WIDTH := 4096.0
const MIN_ZOOM := 0.3
const MAX_ZOOM := 400.0
const NEUTRAL_LAND := Color8(58, 60, 66)
const FILL_OPACITY := [[1.5, 0.46], [2.5, 0.50], [3.75, 0.56], [5.0, 0.62], [6.5, 0.68], [8.0, 0.72], [10.0, 0.78], [12.0, 0.82], [14.0, 0.84]]

const FILL_SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform sampler2D region_colors : filter_nearest;
uniform int columns = 1024;
uniform int selected = -1;
uniform float land_alpha = 0.5;
varying vec4 tint;
void vertex() {
	int region = int(UV.x + 0.5);
	vec4 c = texelFetch(region_colors, ivec2(region % columns, region / columns), 0);
	if (region == selected) {
		c.rgb = mix(c.rgb, vec3(1.0), 0.35);
	}
	tint = vec4(c.rgb, land_alpha);
}
void fragment() {
	COLOR = tint;
}
"""

const BORDER_SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform sampler2D owner_ids : filter_nearest;
uniform int columns = 1024;
uniform float zoom_level = 2.0;
uniform float pixel_world = 1.0;
uniform bool shadow = false;
varying vec4 tint;
varying float edge;
varying float core;
varying float soft;
vec3 owner_of(int region) {
	return texelFetch(owner_ids, ivec2(region % columns, region / columns), 0).rgb;
}
float stops5(float z, float a, float b, float c, float d, float e) {
	if (z <= 1.0) return a;
	if (z <= 3.0) return mix(a, b, (z - 1.0) / 2.0);
	if (z <= 6.0) return mix(b, c, (z - 3.0) / 3.0);
	if (z <= 9.0) return mix(c, d, (z - 6.0) / 3.0);
	if (z <= 12.0) return mix(d, e, (z - 9.0) / 3.0);
	return e;
}
void vertex() {
	int a = int(UV.x + 0.5);
	int b = int(floor(UV.y + 0.5));
	vec2 offset = COLOR.rg * 2.0 - 1.0;
	edge = COLOR.b * 2.0 - 1.0;
	float width = 0.0;
	tint = vec4(0.0);
	soft = 1.0;
	bool country = b >= 0 && distance(owner_of(a), owner_of(b)) > 0.001;
	if (country) {
		if (shadow) {
			width = stops5(zoom_level, 1.8, 2.5, 3.6, 4.7, 5.8);
			tint = vec4(1.0 / 255.0, 4.0 / 255.0, 8.0 / 255.0, 0.72 * 0.52);
			soft = mix(0.7, 1.5, clamp((zoom_level - 1.0) / 11.0, 0.0, 1.0)) + 1.0;
		} else {
			width = stops5(zoom_level, 0.58, 0.92, 1.34, 1.72, 2.08);
			tint = vec4(5.0 / 255.0, 8.0 / 255.0, 13.0 / 255.0, 0.96 * 0.94);
		}
	} else if (b >= 0 && !shadow) {
		float opacity = 0.0;
		if (zoom_level > 6.5) opacity = mix(0.0, 0.25, clamp(zoom_level - 6.5, 0.0, 1.0));
		if (zoom_level > 7.5) opacity = mix(0.25, 0.38, clamp((zoom_level - 7.5) / 2.5, 0.0, 1.0));
		if (zoom_level > 10.0) opacity = mix(0.38, 0.45, clamp((zoom_level - 10.0) / 2.0, 0.0, 1.0));
		width = mix(0.25, 0.5, clamp((zoom_level - 6.5) / 5.5, 0.0, 1.0));
		tint = vec4(8.0 / 255.0, 10.0 / 255.0, 14.0 / 255.0, opacity);
	}
	core = width * 0.5;
	float half_px = core + soft;
	VERTEX += offset * half_px * pixel_world;
	edge *= half_px;
}
void fragment() {
	float d = abs(edge);
	float coverage = clamp((core + soft * 0.5 - d) / soft, 0.0, 1.0) * min(1.0, core * 2.0 + 0.35);
	COLOR = vec4(tint.rgb, tint.a * coverage);
}
"""

var camera: Camera2D
var baker: MapBaker
var basemap: Basemap
var _fill_material: ShaderMaterial
var _border_material: ShaderMaterial
var _shadow_material: ShaderMaterial
var _colors_image: Image
var _colors_texture: ImageTexture
var _ids_image: Image
var _ids_texture: ImageTexture
var _copies: Array[Node2D] = []
var _names: PackedStringArray = []
var _centroids: PackedVector2Array = []
var _areas: PackedFloat32Array = []
var _adjacency: PackedInt32Array = []
var _region_count := 0
var _owners: PackedInt32Array = []
var _owner_names: PackedStringArray = []
var _owner_anchor: Array[Vector2] = []
var _owner_area: PackedFloat32Array = []
var _labels_layer: Control
var _labels: Array[Label] = []
var _cities: CityLayer
var _dragging := false
var _drag_distance := 0.0
var _ready_to_draw := false
var input_enabled := true


func _ready() -> void:
	camera = Camera2D.new()
	camera.position = Vector2(WORLD_WIDTH * 0.5, WORLD_WIDTH * 0.42)
	camera.zoom = Vector2.ONE * 0.4
	add_child(camera)
	camera.make_current()
	basemap = Basemap.new()
	basemap.world_width = WORLD_WIDTH
	add_child(basemap)
	baker = MapBaker.new()
	add_child(baker)
	baker.baked.connect(_on_baked)
	baker.failed.connect(func(message: String) -> void: bake_failed.emit(message))
	_fill_material = _material(FILL_SHADER)
	_border_material = _material(BORDER_SHADER)
	_shadow_material = _material(BORDER_SHADER)
	_shadow_material.set_shader_parameter("shadow", true)
	var layer := CanvasLayer.new()
	layer.layer = 1
	add_child(layer)
	_labels_layer = Control.new()
	_labels_layer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_labels_layer.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	layer.add_child(_labels_layer)
	_cities = CityLayer.new()
	_cities.map = self
	_labels_layer.add_child(_cities)
	visible = false


func _material(code: String) -> ShaderMaterial:
	var shader := Shader.new()
	shader.code = code
	var material := ShaderMaterial.new()
	material.shader = shader
	return material


func load_regions(path: String) -> void:
	_ready_to_draw = false
	baker.bake_file(path, WORLD_WIDTH)


func set_cities(cities: Array) -> void:
	_cities.set_cities(cities)
	_after_camera_move()


func set_overlays_visible(shown: bool) -> void:
	_labels_layer.visible = shown


func region_name(index: int) -> String:
	if index < 0 or index >= _names.size():
		return ""
	return _names[index]


func region_owner(index: int) -> String:
	if index < 0 or index >= _owners.size():
		return ""
	var owner := _owners[index]
	return _owner_names[owner] if owner >= 0 and owner < _owner_names.size() else ""


func owner_names() -> PackedStringArray:
	return _owner_names


func select_region(index: int) -> void:
	_fill_material.set_shader_parameter("selected", index)


func focus_owner(owner_name: String) -> void:
	var owner := _owner_names.find(owner_name)
	if owner < 0 or owner >= _owner_anchor.size():
		return
	camera.position = _owner_anchor[owner]
	var extent := sqrt(max(_owner_area[owner], 1.0))
	var target: float = clamp(get_viewport_rect().size.y / (extent * 2.6), MIN_ZOOM, 12.0)
	camera.zoom = Vector2.ONE * target
	_after_camera_move()


func zoom_level() -> float:
	return log(8.0 * camera.zoom.x) / log(2.0)


func world_to_screen(point: Vector2) -> Vector2:
	var adjusted := point
	adjusted.x += WORLD_WIDTH * round((camera.position.x - point.x) / WORLD_WIDTH)
	return (adjusted - camera.position) * camera.zoom.x + get_viewport_rect().size * 0.5


func _on_baked(result: Dictionary) -> void:
	for copy in _copies:
		copy.queue_free()
	_copies.clear()
	_names = result["names"]
	_centroids = result["centroids"]
	_areas = result["areas"]
	_adjacency = result["adjacency"]
	_region_count = _names.size()
	var rows: int = max(1, int(ceil(float(max(_region_count, 1)) / COLUMNS)))
	_colors_image = Image.create_empty(COLUMNS, rows, false, Image.FORMAT_RGBA8)
	_colors_image.fill(NEUTRAL_LAND)
	_colors_texture = ImageTexture.create_from_image(_colors_image)
	_ids_image = Image.create_empty(COLUMNS, rows, false, Image.FORMAT_RGBA8)
	_ids_image.fill(Color(0, 0, 0, 1))
	_ids_texture = ImageTexture.create_from_image(_ids_image)
	_fill_material.set_shader_parameter("region_colors", _colors_texture)
	_fill_material.set_shader_parameter("columns", COLUMNS)
	_fill_material.set_shader_parameter("selected", -1)
	for material in [_border_material, _shadow_material]:
		material.set_shader_parameter("owner_ids", _ids_texture)
		material.set_shader_parameter("columns", COLUMNS)

	var fill_arrays := []
	fill_arrays.resize(Mesh.ARRAY_MAX)
	fill_arrays[Mesh.ARRAY_VERTEX] = result["vertices"]
	fill_arrays[Mesh.ARRAY_TEX_UV] = result["uvs"]
	fill_arrays[Mesh.ARRAY_INDEX] = result["indices"]
	var fill_mesh := ArrayMesh.new()
	fill_mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, fill_arrays)

	var border_arrays := []
	border_arrays.resize(Mesh.ARRAY_MAX)
	border_arrays[Mesh.ARRAY_VERTEX] = result["border_vertices"]
	border_arrays[Mesh.ARRAY_TEX_UV] = result["border_uvs"]
	border_arrays[Mesh.ARRAY_COLOR] = result["border_sides"]
	border_arrays[Mesh.ARRAY_INDEX] = result["border_indices"]
	var border_mesh := ArrayMesh.new()
	border_mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, border_arrays)

	for offset in [-WORLD_WIDTH, 0.0, WORLD_WIDTH]:
		var copy := Node2D.new()
		copy.position = Vector2(offset, 0)
		for entry in [[fill_mesh, _fill_material], [border_mesh, _shadow_material], [border_mesh, _border_material]]:
			var instance := MeshInstance2D.new()
			instance.mesh = entry[0]
			instance.material = entry[1]
			copy.add_child(instance)
		add_child(copy)
		_copies.append(copy)
	visible = true
	_ready_to_draw = true
	baked.emit({"regions": _region_count, "triangles": (result["indices"] as PackedInt32Array).size() / 3, "borders": (result["border_indices"] as PackedInt32Array).size() / 6})


func set_state(state: Dictionary) -> void:
	if not _ready_to_draw:
		return
	var owners: Array = state.get("owners", [])
	_owner_names = PackedStringArray(state.get("ownerNames", []))
	var owner_colors: Array = state.get("ownerColors", [])
	_owners = PackedInt32Array()
	_owners.resize(_region_count)
	var palette: Array[Color] = []
	for rgb in owner_colors:
		palette.append(Color8(int(rgb[0]), int(rgb[1]), int(rgb[2])))
	for index in range(_region_count):
		var owner := int(owners[index]) if index < owners.size() else -1
		_owners[index] = owner
		var x := index % COLUMNS
		var y := index / COLUMNS
		if owner >= 0 and owner < palette.size():
			_colors_image.set_pixel(x, y, palette[owner])
			var id := owner + 1
			_ids_image.set_pixel(x, y, Color8(id & 255, (id >> 8) & 255, (id >> 16) & 255, 255))
		else:
			_colors_image.set_pixel(x, y, NEUTRAL_LAND)
			_ids_image.set_pixel(x, y, Color(0, 0, 0, 1))
	_place_owner_anchors()
	_colors_texture.update(_colors_image)
	_ids_texture.update(_ids_image)
	_rebuild_labels()
	_after_camera_move()


func _place_owner_anchors() -> void:
	var parent: Array[int] = []
	parent.resize(_region_count)
	for index in range(_region_count):
		parent[index] = index
	var find := func(start: int) -> int:
		var at := start
		while parent[at] != at:
			parent[at] = parent[parent[at]]
			at = parent[at]
		return at
	for pair in range(0, _adjacency.size(), 2):
		var a := _adjacency[pair]
		var b := _adjacency[pair + 1]
		if a >= _region_count or b >= _region_count or _owners[a] < 0 or _owners[a] != _owners[b]:
			continue
		var root_a: int = find.call(a)
		var root_b: int = find.call(b)
		if root_a != root_b:
			parent[root_b] = root_a
	var reference := {}
	var largest := {}
	for index in range(_region_count):
		if _owners[index] < 0:
			continue
		var root: int = find.call(index)
		if _areas[index] > float(largest.get(root, -1.0)):
			largest[root] = _areas[index]
			reference[root] = _centroids[index]
	var total := {}
	var weighted := {}
	for index in range(_region_count):
		if _owners[index] < 0 or _areas[index] <= 0.0:
			continue
		var root: int = find.call(index)
		var point := _centroids[index]
		var ref: Vector2 = reference[root]
		point.x += WORLD_WIDTH * round((ref.x - point.x) / WORLD_WIDTH)
		total[root] = float(total.get(root, 0.0)) + _areas[index]
		weighted[root] = (weighted.get(root, Vector2.ZERO) as Vector2) + point * _areas[index]
	_owner_anchor = []
	_owner_anchor.resize(_owner_names.size())
	_owner_area = PackedFloat32Array()
	_owner_area.resize(_owner_names.size())
	for root in total:
		var owner := _owners[root]
		var area: float = total[root]
		if area > _owner_area[owner]:
			_owner_area[owner] = area
			var centre: Vector2 = (weighted[root] as Vector2) / area
			centre.x = fposmod(centre.x, WORLD_WIDTH)
			_owner_anchor[owner] = centre


func _rebuild_labels() -> void:
	for label in _labels:
		label.queue_free()
	_labels.clear()
	for owner in range(_owner_names.size()):
		var label := Label.new()
		label.text = _owner_names[owner].to_upper()
		label.mouse_filter = Control.MOUSE_FILTER_IGNORE
		label.add_theme_color_override("font_color", Color(250 / 255.0, 249 / 255.0, 244 / 255.0, 0.995))
		label.add_theme_color_override("font_outline_color", Color(3 / 255.0, 4 / 255.0, 8 / 255.0, 0.98))
		label.visible = false
		_labels_layer.add_child(label)
		_labels.append(label)
	_labels_layer.move_child(_cities, -1)


func _update_labels() -> void:
	if _labels.is_empty():
		return
	var zoom := camera.zoom.x
	var view := get_viewport_rect().size
	var fade: float = clamp(1.0 - (zoom_level() - 6.95) / (9.0 - 6.95), 0.0, 1.0)
	for owner in range(_labels.size()):
		var label := _labels[owner]
		var area := _owner_area[owner] if owner < _owner_area.size() else 0.0
		var size := sqrt(max(area, 0.0)) * zoom * 0.066
		if size < 9.0 or fade <= 0.0:
			label.visible = false
			continue
		var screen := world_to_screen(_owner_anchor[owner])
		if screen.x < -400 or screen.y < -100 or screen.x > view.x + 400 or screen.y > view.y + 100:
			label.visible = false
			continue
		var font_size := int(clamp(size, 9.0, 40.0))
		label.add_theme_font_override("font", UI.font(400, "Georgia", int(round(font_size * 0.12))))
		label.add_theme_font_size_override("font_size", font_size)
		label.add_theme_constant_override("outline_size", max(3, int(font_size * 0.28)))
		label.modulate.a = fade
		label.reset_size()
		label.position = screen - label.size * 0.5
		label.visible = true


func _after_camera_move() -> void:
	camera.position.x = fposmod(camera.position.x, WORLD_WIDTH)
	camera.position.y = clamp(camera.position.y, 0.0, WORLD_WIDTH)
	var level := zoom_level()
	_fill_material.set_shader_parameter("land_alpha", _fill_opacity(level))
	for material in [_border_material, _shadow_material]:
		material.set_shader_parameter("zoom_level", level)
		material.set_shader_parameter("pixel_world", 1.0 / camera.zoom.x)
	basemap.update_view(camera.position, camera.zoom.x, get_viewport_rect().size)
	_update_labels()
	_cities.queue_redraw()


func _fill_opacity(level: float) -> float:
	if level <= FILL_OPACITY[0][0]:
		return FILL_OPACITY[0][1]
	for index in range(1, FILL_OPACITY.size()):
		var stop: Array = FILL_OPACITY[index]
		if level <= stop[0]:
			var previous: Array = FILL_OPACITY[index - 1]
			return lerp(float(previous[1]), float(stop[1]), (level - previous[0]) / (stop[0] - previous[0]))
	return FILL_OPACITY[-1][1]


func _zoom_at(screen_point: Vector2, factor: float) -> void:
	var half := get_viewport_rect().size * 0.5
	var before := camera.position + (screen_point - half) / camera.zoom.x
	var next_zoom: float = clamp(camera.zoom.x * factor, MIN_ZOOM, MAX_ZOOM)
	camera.zoom = Vector2.ONE * next_zoom
	var after := camera.position + (screen_point - half) / next_zoom
	camera.position += before - after
	_after_camera_move()


func _unhandled_input(event: InputEvent) -> void:
	if not _ready_to_draw or not input_enabled:
		return
	if event is InputEventMouseButton:
		var button := event as InputEventMouseButton
		if button.button_index == MOUSE_BUTTON_WHEEL_UP and button.pressed:
			_zoom_at(button.position, 1.15)
		elif button.button_index == MOUSE_BUTTON_WHEEL_DOWN and button.pressed:
			_zoom_at(button.position, 1.0 / 1.15)
		elif button.button_index == MOUSE_BUTTON_LEFT:
			if button.pressed:
				_dragging = true
				_drag_distance = 0.0
			else:
				_dragging = false
				if _drag_distance < 5.0:
					var half := get_viewport_rect().size * 0.5
					var world := camera.position + (button.position - half) / camera.zoom.x
					region_clicked.emit(baker.pick(world))
		elif button.button_index == MOUSE_BUTTON_RIGHT or button.button_index == MOUSE_BUTTON_MIDDLE:
			_dragging = button.pressed
			_drag_distance = 99.0
	elif event is InputEventMouseMotion and _dragging:
		var motion := event as InputEventMouseMotion
		_drag_distance += motion.relative.length()
		camera.position -= motion.relative / camera.zoom.x
		_after_camera_move()
	elif event is InputEventMagnifyGesture:
		var magnify := event as InputEventMagnifyGesture
		_zoom_at(magnify.position, magnify.factor)
	elif event is InputEventPanGesture:
		var pan := event as InputEventPanGesture
		camera.position += pan.delta * 12.0 / camera.zoom.x
		_after_camera_move()


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_SIZE_CHANGED and _ready_to_draw:
		_after_camera_move()


class CityLayer extends Control:
	var map: MapView
	var _cities: Array = []
	var _points: PackedVector2Array = []
	var _order: Array[int] = []

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)

	func set_cities(cities: Array) -> void:
		_cities = cities
		_points = PackedVector2Array()
		for city in cities:
			_points.append(ohproject(float(city[1]), float(city[2])))
		_order = []
		for index in range(cities.size()):
			_order.append(index)
		_order.sort_custom(func(a: int, b: int) -> bool:
			var left: Array = cities[a]
			var right: Array = cities[b]
			if int(left[3]) != int(right[3]):
				return int(left[3]) > int(right[3])
			if int(left[5]) != int(right[5]):
				return int(left[5]) > int(right[5])
			return float(left[4]) > float(right[4]))
		queue_redraw()

	static func ohproject(lon: float, lat: float) -> Vector2:
		var clamped: float = clamp(lat, -85.0511, 85.0511)
		var x := (lon + 180.0) / 360.0 * MapView.WORLD_WIDTH
		var y := (0.5 - log(tan(PI / 4.0 + deg_to_rad(clamped) / 2.0)) / (2.0 * PI)) * MapView.WORLD_WIDTH
		return Vector2(x, y)

	func _draw() -> void:
		if not map or _cities.is_empty():
			return
		var level := map.zoom_level()
		var view := map.get_viewport_rect().size
		var font := UI.font(700)
		var star := UI.icon("star", 13)
		var taken: Array[Rect2] = []
		for index in _order:
			var city: Array = _cities[index]
			var capital := int(city[3]) == 1
			var tier := int(city[5])
			var needed := 2.6 if capital else (4.0 if tier >= 3 else (5.2 if tier == 2 else 6.5))
			if level < needed:
				continue
			var screen := map.world_to_screen(_points[index])
			if screen.x < -40 or screen.y < -20 or screen.x > view.x + 40 or screen.y > view.y + 20:
				continue
			if capital:
				draw_texture(star, screen - Vector2(6.5, 6.5))
			else:
				draw_circle(screen, 2.6, Color(0.04, 0.05, 0.07, 0.9))
				draw_circle(screen, 1.8, Color(0.98, 0.98, 0.96))
			if capital or level >= needed + 0.6:
				var size := 11 if capital else 10
				var text := str(city[0])
				var width := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
				var at := screen + Vector2(-width * 0.5, 15)
				var box := Rect2(at - Vector2(2, size), Vector2(width + 4, size + 4))
				var clash := false
				for other in taken:
					if other.intersects(box):
						clash = true
						break
				if clash:
					continue
				taken.append(box)
				draw_string_outline(font, at, text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, 4, Color(0.02, 0.03, 0.05, 0.92))
				draw_string(font, at, text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, Color(0.98, 0.98, 0.96))
