class_name MapView
extends Node2D

signal region_clicked(index: int)
signal baked(info: Dictionary)
signal bake_failed(message: String)
signal camera_moved

const COLUMNS := 1024
const WORLD_WIDTH := 4096.0
const MIN_ZOOM := 0.5946035575013605
const MAX_ZOOM := 400.0
const NEUTRAL_LAND := Color8(88, 98, 110)
const FILL_OPACITY := [[1.5, 0.46], [2.5, 0.50], [3.75, 0.56], [5.0, 0.62], [6.5, 0.68], [8.0, 0.72], [10.0, 0.78], [12.0, 0.82], [14.0, 0.84]]

const FILL_SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform sampler2D region_colors : filter_nearest;
uniform sampler2D region_style : filter_nearest;
uniform bool styled = false;
uniform int columns = 1024;
uniform int selected = -1;
uniform float land_alpha = 0.5;
varying vec4 tint;
vec3 unpack_rgb(float packed) {
	float value = floor(packed + 0.5);
	return vec3(floor(value / 65536.0), mod(floor(value / 256.0), 256.0), mod(value, 256.0)) / 255.0;
}
void vertex() {
	int region = int(UV.x + 0.5);
	ivec2 cell = ivec2(region % columns, region / columns);
	vec4 c = texelFetch(region_colors, cell, 0);
	float alpha = land_alpha;
	if (styled) {
		vec4 style = texelFetch(region_style, cell, 0);
		if (style.r >= 0.0) {
			c.rgb = unpack_rgb(style.r);
		}
		alpha = min(1.0, land_alpha * style.g);
	}
	tint = vec4(c.rgb, c.a < 0.5 ? 0.0 : alpha);
}
void fragment() {
	COLOR = tint;
}
"""

const BORDER_SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform sampler2D owner_ids : filter_nearest;
uniform sampler2D region_style : filter_nearest;
uniform bool styled = false;
uniform int style_rows = 1;
uniform bool province_outlines = true;
uniform int columns = 1024;
uniform float zoom_level = 2.0;
uniform float pixel_world = 1.0;
uniform bool shadow = false;
varying vec4 tint;
varying float edge;
varying float core;
varying float soft;
varying float outset;
vec3 owner_of(int region) {
	return texelFetch(owner_ids, ivec2(region % columns, region / columns), 0).rgb;
}
vec3 unpack_rgb(float packed) {
	float value = floor(packed + 0.5);
	return vec3(floor(value / 65536.0), mod(floor(value / 256.0), 256.0), mod(value, 256.0)) / 255.0;
}
float province_width(float z) {
	if (z <= 4.15) return 0.40;
	if (z <= 5.0) return mix(0.40, 0.48, (z - 4.15) / 0.85);
	if (z <= 6.5) return mix(0.48, 0.56, (z - 5.0) / 1.5);
	if (z <= 8.0) return mix(0.56, 0.62, (z - 6.5) / 1.5);
	if (z <= 12.0) return mix(0.62, 0.72, (z - 8.0) / 4.0);
	return 0.72;
}
float province_opacity(float z) {
	if (z <= 4.15) return 0.0;
	if (z <= 4.45) return mix(0.0, 0.18, (z - 4.15) / 0.30);
	if (z <= 4.90) return mix(0.18, 0.30, (z - 4.45) / 0.45);
	if (z <= 5.50) return mix(0.30, 0.42, (z - 4.90) / 0.60);
	if (z <= 7.0) return mix(0.42, 0.50, (z - 5.50) / 1.5);
	if (z <= 12.0) return mix(0.50, 0.58, (z - 7.0) / 5.0);
	return 0.58;
}
float shadow_blur(float z) {
	if (z <= 1.0) return 0.7;
	if (z <= 6.0) return mix(0.7, 1.15, (z - 1.0) / 5.0);
	if (z <= 12.0) return mix(1.15, 1.5, (z - 6.0) / 6.0);
	return 1.5;
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
			soft = shadow_blur(zoom_level) + 1.0;
		} else {
			width = stops5(zoom_level, 0.58, 0.92, 1.34, 1.72, 2.08);
			tint = vec4(5.0 / 255.0, 8.0 / 255.0, 13.0 / 255.0, 0.96 * 0.94);
		}
	} else if (!shadow && province_outlines && zoom_level >= 4.15) {
		vec4 stroke = vec4(205.0 / 255.0, 218.0 / 255.0, 228.0 / 255.0, 0.64);
		float scale = 1.0;
		if (styled) {
			int owner_region = b >= 0 ? b : a;
			vec4 style = texelFetch(region_style, ivec2(owner_region % columns, owner_region / columns), 0);
			float own_scale = texelFetch(region_style, ivec2(owner_region % columns, owner_region / columns + style_rows), 0).r;
			if (b >= 0 && own_scale <= 0.0) {
				style = texelFetch(region_style, ivec2(a % columns, a / columns), 0);
				own_scale = texelFetch(region_style, ivec2(a % columns, a / columns + style_rows), 0).r;
			}
			if (style.b >= 0.0) {
				stroke = vec4(unpack_rgb(style.b), style.a);
			}
			scale = own_scale;
		}
		width = province_width(zoom_level) * scale;
		tint = vec4(stroke.rgb, stroke.a * province_opacity(zoom_level));
	}
	core = width * 0.5;
	outset = width > 0.0 ? core + 0.5 : 0.0;
	VERTEX += offset * outset * pixel_world;
	edge *= outset;
}
void fragment() {
	float d = abs(edge);
	float coverage = clamp((outset - d) / soft, 0.0, 1.0);
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
var _fill_mesh: ArrayMesh
var _border_mesh: ArrayMesh
var _fill_parts: Array[ArrayMesh] = []
var _border_parts: Array[ArrayMesh] = []
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
var _labels_text: PolityTextLayer
var _labels_engine: EngineLink
var _labels_regions := ""
var _cities: CityLayer
var _dragging := false
var _drag_distance := 0.0
var _ready_to_draw := false
var input_enabled := true


func _ready() -> void:
	camera = Camera2D.new()
	camera.position = Vector2(WORLD_WIDTH * 0.5, WORLD_WIDTH * 0.42)
	camera.zoom = Vector2.ONE * 0.4
	camera.process_mode = Node.PROCESS_MODE_DISABLED
	add_child(camera)
	camera.make_current()
	get_viewport().size_changed.connect(camera.force_update_scroll)
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


var _loaded_file := ""
var _last_bake: Dictionary = {}


func load_regions(path: String) -> void:
	if path == _loaded_file and _ready_to_draw:
		baked.emit.call_deferred(_last_bake)
		return
	_loaded_file = path
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
	bearing = 0.0
	pitch = 0.0
	_after_camera_move()


var _fly: Tween


func fit_lonlat_bounds(bounds: Array, max_level := 6.8, duration := 1.8) -> void:
	if bounds.size() < 2 or not _ready_to_draw:
		return
	var south_west: Array = bounds[0]
	var north_east: Array = bounds[1]
	var west := float(south_west[0])
	var south := float(south_west[1])
	var east := float(north_east[0])
	var north := float(north_east[1])
	if east < west:
		east += 360.0
	if absf(east - west) < 0.35:
		west -= 0.6
		east += 0.6
	if absf(north - south) < 0.35:
		south -= 0.45
		north += 0.45
	var top_left := CityLayer.ohproject(west, north)
	var bottom_right := CityLayer.ohproject(east, south)
	if east > 180.0:
		bottom_right.x = (east + 180.0) / 360.0 * WORLD_WIDTH
	var view := get_viewport_rect().size
	var short_side := minf(view.x, view.y)
	var padding := clampf(roundf(short_side * 0.12), 16.0, 80.0) if short_side > 0.0 else 40.0
	var span := (bottom_right - top_left).abs()
	var fit := minf((view.x - 2.0 * padding) / maxf(span.x, 0.0001), (view.y - 2.0 * padding) / maxf(span.y, 0.0001))
	var target_zoom: float = clamp(minf(fit, pow(2.0, max_level) / 8.0), MIN_ZOOM, MAX_ZOOM)
	var target_center := (top_left + bottom_right) * 0.5
	var start_center := camera.position
	target_center.x += WORLD_WIDTH * round((start_center.x - target_center.x) / WORLD_WIDTH)
	var start_zoom := camera.zoom.x
	if _fly and _fly.is_valid():
		_fly.kill()
	if duration <= 0.0:
		camera.position = target_center
		camera.zoom = Vector2.ONE * target_zoom
		_after_camera_move()
		return
	var projector := _relief_globe()
	if projector and projector.active:
		projector.elevation_ease_begin(target_center)
	_fly = create_tween().set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_IN_OUT)
	_fly.tween_method(func(t: float) -> void:
		var level := lerpf(log(start_zoom), log(target_zoom), t)
		camera.zoom = Vector2.ONE * exp(level)
		camera.position = start_center.lerp(target_center, t)
		if projector and is_instance_valid(projector):
			projector.elevation_ease_step(t)
		_after_camera_move(), 0.0, 1.0, duration)


func zoom_level() -> float:
	return log(8.0 * camera.zoom.x) / log(2.0)


func world_to_screen(point: Vector2) -> Vector2:
	if globe_on and extras:
		return extras.call("globe_world_to_screen", point)
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
	_fill_mesh = fill_mesh
	_border_mesh = border_mesh
	_fill_parts = _chunk_meshes(result.get("fill_chunks", []), false)
	_border_parts = _chunk_meshes(result.get("border_chunks", []), true)

	for offset in [-WORLD_WIDTH, 0.0, WORLD_WIDTH]:
		var copy := Node2D.new()
		copy.position = Vector2(offset, 0)
		copy.add_child(extras_region_layer("fill", _fill_material))
		copy.add_child(extras_region_layer("border", _shadow_material))
		copy.add_child(extras_region_layer("border", _border_material))
		add_child(copy)
		_copies.append(copy)
	visible = true
	_ready_to_draw = true
	_last_bake = {"regions": _region_count, "triangles": (result["indices"] as PackedInt32Array).size() / 3, "borders": (result["border_indices"] as PackedInt32Array).size() / 6}
	baked.emit(_last_bake)


var _last_state: Dictionary = {}
var _color_override: Dictionary = {}
var _override_neutral := Color(0, 0, 0, 0)


func set_owner_color_override(colors: Dictionary, neutral: Color) -> void:
	_color_override = colors
	_override_neutral = neutral
	if not _last_state.is_empty():
		set_state(_last_state)


func fly_to_lonlat(lon: float, lat: float, level: float, duration := 1.6) -> void:
	var span := 360.0 / pow(2.0, maxf(level, 0.0)) * 0.5
	var lat_span := span * 0.6
	fit_lonlat_bounds([[lon - span, lat - lat_span], [lon + span, lat + lat_span]], level, duration)


func set_state(state: Dictionary) -> void:
	if not _ready_to_draw:
		return
	_last_state = state
	var previous_owners := _owners
	var previous_names := _owner_names
	var owners: Array = state.get("owners", [])
	_owner_names = PackedStringArray(state.get("ownerNames", []))
	var owner_colors: Array = state.get("ownerColors", [])
	_owners = PackedInt32Array()
	_owners.resize(_region_count)
	var palette: Array[Color] = []
	for rgb in owner_colors:
		palette.append(political_color(rgb))
	if not _color_override.is_empty():
		var names: Array = state.get("ownerNames", [])
		for slot in range(palette.size()):
			var shade: Array = _color_override.get(str(names[slot]) if slot < names.size() else "", [100, 116, 139])
			palette[slot] = Color8(int(shade[0]), int(shade[1]), int(shade[2]))
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
			_colors_image.set_pixel(x, y, _override_neutral if not _color_override.is_empty() and _override_neutral.a > 0.0 else NEUTRAL_LAND)
			_ids_image.set_pixel(x, y, Color(0, 0, 0, 1))
	_place_owner_anchors()
	if extras:
		extras.call("state_applied", previous_owners, previous_names, palette)
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
	if _labels_text == null:
		_labels_text = PolityTextLayer.new()
		_labels_layer.add_child(_labels_text)
	_labels_layer.move_child(_labels_text, 0)
	_labels_layer.move_child(_cities, -1)
	if _labels_engine == null:
		var parent_engine: Variant = get_parent().get("engine") if get_parent() else null
		if parent_engine is EngineLink:
			_labels_engine = parent_engine
	var regions_key := "%d|%s|%s" % [_region_count, _names[0] if not _names.is_empty() else "", _names[-1] if not _names.is_empty() else ""]
	if regions_key != _labels_regions:
		_labels_regions = regions_key
		_labels_text.clear()
	_labels_text.setup(self, _labels_engine)
	_labels_text.refresh()


func _update_labels() -> void:
	if _labels_text:
		_labels_text.update_view()


func _after_camera_move() -> void:
	camera.position.x = fposmod(camera.position.x, WORLD_WIDTH)
	camera.position.y = clamp(camera.position.y, 0.0, WORLD_WIDTH)
	if extras:
		extras.call("constrain_camera")
	var level := zoom_level()
	var render := render_view()
	_fill_material.set_shader_parameter("land_alpha", _fill_opacity(level))
	for material in [_border_material, _shadow_material]:
		material.set_shader_parameter("zoom_level", level)
		material.set_shader_parameter("pixel_world", 1.0 / float(render[3] if render.size() > 3 else render[1]))
	basemap.update_view(render[0], render[1], render[2])
	_update_labels()
	camera_moved.emit()
	_cities.queue_redraw()
	if extras:
		extras.call("after_camera_move", level)


func _fill_opacity(level: float) -> float:
	if extras:
		var custom := float(extras.call("fill_opacity_at", level))
		if custom >= 0.0:
			return custom
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
	if _fly and _fly.is_valid() and (event is InputEventMouseButton or event is InputEventMagnifyGesture or event is InputEventPanGesture):
		_fly.kill()
	if extras and bool(extras.call("map_input", event)):
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
	var _ordered_points := PackedVector2Array()
	var _ordered_needed := PackedFloat64Array()

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
		_ordered_points = PackedVector2Array()
		_ordered_needed = PackedFloat64Array()
		for index in _order:
			var city: Array = cities[index]
			var tier := int(city[5])
			_ordered_points.append(_points[index])
			_ordered_needed.append(2.6 if int(city[3]) == 1 else (4.0 if tier >= 3 else (5.2 if tier == 2 else 6.5)))
		queue_redraw()

	static func ohproject(lon: float, lat: float) -> Vector2:
		var clamped: float = clamp(lat, -85.0511, 85.0511)
		var x := (lon + 180.0) / 360.0 * MapView.WORLD_WIDTH
		var y := (0.5 - log(tan(PI / 4.0 + deg_to_rad(clamped) / 2.0)) / (2.0 * PI)) * MapView.WORLD_WIDTH
		return Vector2(x, y)

	static func _near(area: Rect2, point: Vector2) -> bool:
		if point.y < area.position.y or point.y >= area.end.y:
			return false
		var low := area.position.x
		var high := area.end.x
		var x := point.x
		return (x >= low and x < high) or (x - MapView.WORLD_WIDTH >= low and x - MapView.WORLD_WIDTH < high) or (x + MapView.WORLD_WIDTH >= low and x + MapView.WORLD_WIDTH < high)

	func _draw() -> void:
		if not map or _cities.is_empty():
			return
		var level := map.zoom_level()
		var view := map.get_viewport_rect().size
		var font := UI.font(700)
		var star := UI.icon("star", 13)
		var taken: Array[Rect2] = map.war_label_rects.duplicate()
		taken.append_array(map.room_label_rects)
		taken.append_array(map.war_marker_rects)
		var own: Array[Rect2] = []
		var area: Variant = map.cull_world_rect(Vector2(41.0, 21.0))
		var picked: Array[int] = []
		var places := PackedVector2Array()
		var culled := area is Rect2
		var bounds: Rect2 = area if culled else Rect2()
		for slot in range(_ordered_needed.size()):
			if level < _ordered_needed[slot]:
				continue
			var point := _ordered_points[slot]
			if culled and not _near(bounds, point):
				continue
			picked.append(_order[slot])
			places.append(point)
		var screens := map.world_to_screen_many(places)
		var shown: Array[int] = []
		var shown_places := PackedVector2Array()
		var shown_screens := PackedVector2Array()
		for slot in range(picked.size()):
			var screen := screens[slot]
			if screen.x < -40 or screen.y < -20 or screen.x > view.x + 40 or screen.y > view.y + 20:
				continue
			shown.append(picked[slot])
			shown_places.append(places[slot])
			shown_screens.append(screen)
		var depths := map.label_depth_many(shown_places)
		var kept: Array[int] = []
		var kept_places := PackedVector2Array()
		for slot in range(shown.size()):
			if clampf(0.5 + 0.5 / depths[slot], 0.0, 4.0) >= MapView.LABEL_PERSPECTIVE_CUTOFF:
				kept.append(slot)
				kept_places.append(shown_places[slot])
		var sights := map.terrain_visibility_many(kept_places)
		for order in range(kept.size()):
			var slot := kept[order]
			var index := shown[slot]
			var city: Array = _cities[index]
			var capital := int(city[3]) == 1
			var tier := int(city[5])
			var needed := 2.6 if capital else (4.0 if tier >= 3 else (5.2 if tier == 2 else 6.5))
			var screen := shown_screens[slot]
			var ratio := clampf(0.5 + 0.5 / depths[slot], 0.0, 4.0)
			var seen := sights[order]
			var circle_scale := 1.0 / depths[slot]
			if capital:
				var star_size := 13.0 * ratio
				draw_texture_rect(star, Rect2(screen - Vector2(star_size, star_size) * 0.5, Vector2(star_size, star_size)), false, Color(1, 1, 1, seen))
			else:
				draw_circle(screen, 2.6 * circle_scale, Color(0.04, 0.05, 0.07, 0.9 * seen))
				draw_circle(screen, 1.8 * circle_scale, Color(0.98, 0.98, 0.96, seen))
			if capital or level >= needed + 0.6:
				var size := maxi(1, roundi((11.0 if capital else 10.0) * ratio))
				var text := str(city[0])
				var width := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
				var at := screen + Vector2(-width * 0.5, 15.0 * ratio)
				var box := Rect2(at - Vector2(2, size), Vector2(width + 4, size + 4))
				var clash := false
				for other in taken:
					if other.intersects(box):
						clash = true
						break
				if clash:
					continue
				taken.append(box)
				own.append(box)
				draw_string_outline(font, at, text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, 4, Color(0.02, 0.03, 0.05, 0.92 * seen))
				draw_string(font, at, text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, Color(0.98, 0.98, 0.96, seen))
		map.city_label_rects = own


func set_label_engine(link: EngineLink) -> void:
	_labels_engine = link
	if _labels_text:
		_labels_text.setup(self, link)


func polity_text() -> PolityTextLayer:
	return _labels_text


func refresh_polity_text() -> void:
	if _labels_text:
		_labels_text.refresh()


func war_copies() -> Array[Node2D]:
	return _copies


func war_fill_mesh() -> Mesh:
	return _war_mesh_with(_fill_material)


func war_border_mesh() -> Mesh:
	return _war_mesh_with(_border_material)


func _war_mesh_with(material: Material) -> Mesh:
	if _copies.is_empty():
		return null
	if material == _fill_material:
		return _fill_mesh
	if material == _border_material or material == _shadow_material:
		return _border_mesh
	return null


func _chunk_meshes(chunks: Array, border: bool) -> Array[ArrayMesh]:
	var out: Array[ArrayMesh] = []
	for item: Variant in chunks:
		var chunk: Dictionary = item
		var arrays := []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX] = chunk["vertices"]
		arrays[Mesh.ARRAY_TEX_UV] = chunk["uvs"]
		if border:
			arrays[Mesh.ARRAY_COLOR] = chunk["sides"]
		arrays[Mesh.ARRAY_INDEX] = chunk["indices"]
		var mesh := ArrayMesh.new()
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		out.append(mesh)
	return out


func extras_region_layer(kind: String, material: Material) -> Node2D:
	var parts := _fill_parts if kind == "fill" else _border_parts
	if parts.is_empty():
		var single := MeshInstance2D.new()
		single.mesh = _fill_mesh if kind == "fill" else _border_mesh
		single.material = material
		return single
	var group := Node2D.new()
	group.material = material
	for part in parts:
		var piece := MeshInstance2D.new()
		piece.mesh = part
		piece.use_parent_material = true
		group.add_child(piece)
	return group


func war_insert_under_borders(copy: Node2D, node: Node) -> void:
	copy.add_child(node)
	for child in copy.get_children():
		if child is CanvasItem and (child as CanvasItem).material == _shadow_material:
			copy.move_child(node, child.get_index())
			return


func war_insert_before_fills(node: Node) -> void:
	add_child(node)
	move_child(node, basemap.get_index() + 1)


func war_region_count() -> int:
	return _region_count


func war_region_centroid(index: int) -> Vector2:
	return _centroids[index] if index >= 0 and index < _centroids.size() else Vector2.ZERO


func war_region_area(index: int) -> float:
	return _areas[index] if index >= 0 and index < _areas.size() else 0.0


func war_overlays_visible() -> bool:
	return _labels_layer != null and _labels_layer.visible


func war_cancel_drag() -> void:
	_dragging = false
	_drag_distance = 99.0


func war_fill_opacity() -> float:
	return _fill_opacity(zoom_level())


var extras: Node = null
var globe_on := false


func attach_extras(node: Node) -> void:
	extras = node


func render_view() -> Array:
	if extras:
		var view: Variant = extras.call("render_view")
		if view is Array and (view as Array).size() >= 3:
			return view
	return [camera.position, camera.zoom.x, get_viewport_rect().size]


func screen_to_world(point: Vector2) -> Vector2:
	if globe_on and extras:
		return extras.call("globe_screen_to_world", point)
	var half := get_viewport_rect().size * 0.5
	return camera.position + (point - half) / camera.zoom.x


func is_globe() -> bool:
	return globe_on


func screen_frame_at(point: Vector2) -> Transform2D:
	if globe_on and extras:
		return extras.call("globe_frame_at", point)
	return Transform2D(Vector2(1, 0), Vector2(0, 1), world_to_screen(point))


func extras_fill_material() -> ShaderMaterial:
	return _fill_material


func extras_border_materials() -> Array[ShaderMaterial]:
	return [_border_material, _shadow_material]


func extras_copies() -> Array[Node2D]:
	return _copies


func extras_meshes() -> Dictionary:
	return {"fill": _war_mesh_with(_fill_material), "border": _war_mesh_with(_border_material)}


func extras_child_index(copy: Node2D, kind: String) -> int:
	var material: Material = _fill_material if kind == "fill" else (_shadow_material if kind == "shadow" else _border_material)
	for child in copy.get_children():
		if child is CanvasItem and (child as CanvasItem).material == material:
			return child.get_index()
	return -1


func extras_region_count() -> int:
	return _region_count


func extras_owners() -> PackedInt32Array:
	return _owners


func extras_owner_names() -> PackedStringArray:
	return _owner_names


func extras_images() -> Dictionary:
	return {"colors": _colors_image, "ids": _ids_image}


func extras_commit_images() -> void:
	if _colors_texture:
		_colors_texture.update(_colors_image)
	if _ids_texture:
		_ids_texture.update(_ids_image)


func extras_centroids() -> PackedVector2Array:
	return _centroids


func extras_areas() -> PackedFloat32Array:
	return _areas


func extras_ready() -> bool:
	return _ready_to_draw


func extras_click(screen: Vector2) -> void:
	region_clicked.emit(baker.pick(screen_to_world(screen)))


func extras_drag_state() -> Array:
	return [_dragging, _drag_distance]


func extras_set_drag_state(dragging: bool, distance: float) -> void:
	_dragging = dragging
	_drag_distance = distance


func extras_stop_flight() -> void:
	if _fly and _fly.is_valid():
		_fly.kill()


static func political_color(rgb: Array) -> Color:
	var parts: Array[float] = []
	for slot in range(3):
		var value := float(rgb[slot]) if slot < rgb.size() else 0.0
		parts.append(clampf(value if is_finite(value) else 0.0, 0.0, 255.0))
	var luminance := 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2]
	var chroma: float = maxf(parts[0], maxf(parts[1], parts[2])) - minf(parts[0], minf(parts[1], parts[2]))
	var boost := 0.05 if chroma < 18.0 else (0.18 if chroma < 150.0 else 0.09)
	for slot in range(3):
		parts[slot] = luminance + (parts[slot] - luminance) * (1.0 + boost)
	var high: float = maxf(parts[0], maxf(parts[1], parts[2]))
	var low: float = minf(parts[0], minf(parts[1], parts[2]))
	var lightness := (high + low) / 510.0
	if lightness < 0.30:
		var lift := minf(0.22, (0.30 - lightness) * 0.7)
		for slot in range(3):
			parts[slot] += (255.0 - parts[slot]) * lift
	elif lightness > 0.64:
		var dim := minf(0.18, (lightness - 0.64) * 0.75)
		for slot in range(3):
			parts[slot] *= 1.0 - dim
	return Color8(int(roundf(clampf(parts[0], 0.0, 255.0))), int(roundf(clampf(parts[1], 0.0, 255.0))), int(roundf(clampf(parts[2], 0.0, 255.0))))


func editor_region_count() -> int:
	return _region_count if _ready_to_draw else 0


func editor_set_region_color(index: int, color: Color, commit := true) -> void:
	if not _ready_to_draw or _colors_image == null or index < 0 or index >= _region_count:
		return
	_colors_image.set_pixel(index % COLUMNS, index / COLUMNS, color)
	if commit:
		_colors_texture.update(_colors_image)


func editor_set_region_colors(colors: PackedColorArray) -> void:
	if not _ready_to_draw or _colors_image == null:
		return
	for index in range(mini(colors.size(), _region_count)):
		_colors_image.set_pixel(index % COLUMNS, index / COLUMNS, colors[index])
	_colors_texture.update(_colors_image)


func editor_commit_colors() -> void:
	if _colors_texture and _colors_image:
		_colors_texture.update(_colors_image)


func editor_set_regions_visible(shown: bool) -> void:
	for copy in _copies:
		if is_instance_valid(copy):
			copy.visible = shown


func editor_zoom_at(screen_point: Vector2, factor: float) -> void:
	_zoom_at(screen_point, factor)


func editor_pan(screen_delta: Vector2) -> void:
	camera.position -= screen_delta / camera.zoom.x
	_after_camera_move()


func editor_set_view(world_centre: Vector2, zoom: float) -> void:
	camera.position = world_centre
	camera.zoom = Vector2.ONE * clampf(zoom, MIN_ZOOM, MAX_ZOOM)
	_after_camera_move()


func editor_apply_basemap(style: Dictionary, link: EngineLink) -> void:
	if basemap and basemap.has_method("apply_style"):
		basemap.apply_style(style, link)


var war_quiet: Dictionary = {}


func war_quiet_regions() -> Dictionary:
	return war_quiet


var war_label_rects: Array[Rect2] = []
var city_label_rects: Array[Rect2] = []


func war_set_label_rects(rects: Array[Rect2]) -> void:
	if rects == war_label_rects:
		return
	war_label_rects = rects
	if _cities:
		_cities.queue_redraw()


func war_city_label_rects() -> Array[Rect2]:
	return city_label_rects


func war_cancel_globe_drag() -> void:
	var globe_node: Variant = extras.get("globe") if extras else null
	if globe_node is Object:
		(globe_node as Object).set("_dragging", false)
		(globe_node as Object).set("_drag_distance", 99.0)


var room_label_rects: Array[Rect2] = []


func room_set_label_rects(rects: Array[Rect2]) -> void:
	if rects == room_label_rects:
		return
	room_label_rects = rects
	if _cities:
		_cities.queue_redraw()


var war_marker_rects: Array[Rect2] = []


func war_set_marker_rects(rects: Array[Rect2]) -> void:
	if rects == war_marker_rects:
		return
	war_marker_rects = rects
	if _cities:
		_cities.queue_redraw()


var _editor_session_layer: Node2D


func editor_set_session_layer(layer: Node2D) -> void:
	if is_instance_valid(_editor_session_layer):
		_editor_session_layer.queue_free()
	_editor_session_layer = layer
	if layer == null:
		return
	add_child(layer)
	move_child(layer, basemap.get_index() + 1)


var _editor_top_layer: Node2D


func editor_set_top_layer(layer: Node2D) -> void:
	if is_instance_valid(_editor_top_layer):
		_editor_top_layer.queue_free()
	_editor_top_layer = layer
	if layer != null:
		add_child(layer)


var bearing := 0.0
var pitch := 0.0


func view_pan(screen_delta: Vector2, around := Vector2(-1.0, -1.0)) -> void:
	if extras and extras.has_method("pan_view"):
		extras.call("pan_view", screen_delta, around)
		return
	camera.position -= screen_delta / camera.zoom.x
	_after_camera_move()


const LABEL_PERSPECTIVE_CUTOFF := 0.6


func label_depth(world: Vector2) -> float:
	if not globe_on or extras == null:
		return 1.0
	var globe_node: Variant = extras.get("globe")
	if globe_node is GlobeView and (globe_node as GlobeView).active:
		return maxf((globe_node as GlobeView).depth_at(world), 0.000001)
	return 1.0


func label_perspective(world: Vector2) -> float:
	return clampf(0.5 + 0.5 / label_depth(world), 0.0, 4.0)


func world_to_screen_many(points: PackedVector2Array) -> PackedVector2Array:
	if globe_on and extras:
		return extras.call("globe_world_to_screen_many", points)
	var out := PackedVector2Array()
	out.resize(points.size())
	var centre := camera.position
	var zoom := camera.zoom.x
	var half := get_viewport_rect().size * 0.5
	for index in range(points.size()):
		var adjusted := points[index]
		adjusted.x += WORLD_WIDTH * round((centre.x - adjusted.x) / WORLD_WIDTH)
		out[index] = (adjusted - centre) * zoom + half
	return out


func label_depth_many(points: PackedVector2Array) -> PackedFloat64Array:
	var projector := _relief_globe() if globe_on else null
	if projector == null or not projector.active:
		var flat := PackedFloat64Array()
		flat.resize(points.size())
		flat.fill(1.0)
		return flat
	var out := projector.depth_many(points)
	for index in range(out.size()):
		out[index] = maxf(out[index], 0.000001)
	return out


func terrain_visibility_many(points: PackedVector2Array) -> PackedFloat64Array:
	var projector := _relief_globe() if globe_on else null
	if projector == null:
		var flat := PackedFloat64Array()
		flat.resize(points.size())
		flat.fill(1.0)
		return flat
	return projector.visibility_many(points)


func cull_world_rect(pad: Vector2) -> Variant:
	if globe_on:
		var projector := _relief_globe()
		return projector.cull_rect(pad) if projector and projector.active else null
	var half := (get_viewport_rect().size * 0.5 + pad) / camera.zoom.x
	return Rect2(camera.position - half, half * 2.0).grow(1.0)


func label_plane_scale(world: Vector2) -> float:
	return clampf(0.5 + 0.5 * label_depth(world), 0.0, 4.0)


func label_plane_frame(world: Vector2, angle: float, scale: float) -> Transform2D:
	var frame := screen_frame_at(world)
	return Transform2D(frame.x, frame.y, frame.origin) * Transform2D(angle, Vector2(scale, scale), 0.0, Vector2.ZERO)


func _relief_globe() -> GlobeView:
	var globe_node: Variant = extras.get("globe") if extras else null
	return globe_node as GlobeView if globe_node is GlobeView else null


func terrain_revision() -> int:
	var projector := _relief_globe()
	return projector.relief_revision() if projector else 0


func ground_disc_scale(world: Vector2) -> float:
	var projector := _relief_globe()
	if projector == null or not globe_on:
		return 1.0
	var g := projector.globeness()
	if g <= 0.0:
		return 1.0
	var lat_c := deg_to_rad(GlobeView.lonlat_of_world(camera.position).y)
	var lat := deg_to_rad(GlobeView.lonlat_of_world(world).y)
	return lerpf(1.0, cos(lat_c) / maxf(cos(lat), 0.0001), g)


func terrain_visibility(world: Vector2) -> float:
	var projector := _relief_globe()
	if projector == null or not globe_on:
		return 1.0
	return projector.anchor_visibility(world)
