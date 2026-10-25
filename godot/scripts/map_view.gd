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

const FILL_SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform sampler2D region_colors : filter_nearest;
uniform int columns = 1024;
uniform int selected = -1;
uniform float land_alpha = 0.9;
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
uniform float zoom = 1.0;
varying vec4 tint;
vec3 owner_of(int region) {
	return texelFetch(owner_ids, ivec2(region % columns, region / columns), 0).rgb;
}
void vertex() {
	int a = int(UV.x + 0.5);
	int b = int(floor(UV.y + 0.5));
	if (b < 0) {
		tint = vec4(0.0);
	} else if (distance(owner_of(a), owner_of(b)) > 0.001) {
		tint = vec4(0.05, 0.05, 0.06, 0.95);
	} else {
		tint = vec4(0.0, 0.0, 0.0, clamp((zoom - 1.5) * 0.08, 0.0, 0.3));
	}
}
void fragment() {
	COLOR = tint;
}
"""

var camera: Camera2D
var baker: MapBaker
var _fill_material: ShaderMaterial
var _border_material: ShaderMaterial
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
var _dragging := false
var _drag_distance := 0.0
var _last_view := Transform2D()
var _ready_to_draw := false


func _ready() -> void:
	camera = Camera2D.new()
	camera.position = Vector2(WORLD_WIDTH * 0.5, WORLD_WIDTH * 0.42)
	camera.zoom = Vector2.ONE * 0.4
	add_child(camera)
	camera.make_current()
	baker = MapBaker.new()
	add_child(baker)
	baker.baked.connect(_on_baked)
	baker.failed.connect(func(message: String) -> void: bake_failed.emit(message))
	_fill_material = ShaderMaterial.new()
	var fill_shader := Shader.new()
	fill_shader.code = FILL_SHADER
	_fill_material.shader = fill_shader
	_border_material = ShaderMaterial.new()
	var border_shader := Shader.new()
	border_shader.code = BORDER_SHADER
	_border_material.shader = border_shader
	var layer := CanvasLayer.new()
	layer.layer = 1
	add_child(layer)
	_labels_layer = Control.new()
	_labels_layer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_labels_layer.set_anchors_preset(Control.PRESET_FULL_RECT)
	layer.add_child(_labels_layer)
	visible = false


func load_regions(path: String) -> void:
	_ready_to_draw = false
	baker.bake_file(path, WORLD_WIDTH)


func is_baking() -> bool:
	return baker.is_baking()


func region_name(index: int) -> String:
	if index < 0 or index >= _names.size():
		return ""
	return _names[index]


func region_owner(index: int) -> String:
	if index < 0 or index >= _owners.size():
		return ""
	var owner := _owners[index]
	return _owner_names[owner] if owner >= 0 and owner < _owner_names.size() else ""


func select_region(index: int) -> void:
	_fill_material.set_shader_parameter("selected", index)
	queue_redraw()


func focus_owner(owner_name: String) -> void:
	var owner := _owner_names.find(owner_name)
	if owner < 0 or owner >= _owner_anchor.size():
		return
	camera.position = _owner_anchor[owner]
	var extent := sqrt(max(_owner_area[owner], 1.0))
	var target: float = clamp(get_viewport_rect().size.y / (extent * 2.4), MIN_ZOOM, 12.0)
	camera.zoom = Vector2.ONE * target
	_after_camera_move()


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
	_border_material.set_shader_parameter("owner_ids", _ids_texture)
	_border_material.set_shader_parameter("columns", COLUMNS)

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
	var border_mesh := ArrayMesh.new()
	border_mesh.add_surface_from_arrays(Mesh.PRIMITIVE_LINES, border_arrays)

	for offset in [-WORLD_WIDTH, 0.0, WORLD_WIDTH]:
		var copy := Node2D.new()
		copy.position = Vector2(offset, 0)
		var fill := MeshInstance2D.new()
		fill.mesh = fill_mesh
		fill.material = _fill_material
		copy.add_child(fill)
		var borders := MeshInstance2D.new()
		borders.mesh = border_mesh
		borders.material = _border_material
		copy.add_child(borders)
		add_child(copy)
		_copies.append(copy)
	visible = true
	_ready_to_draw = true
	baked.emit({"regions": _region_count, "triangles": (result["indices"] as PackedInt32Array).size() / 3, "borders": (result["border_vertices"] as PackedVector2Array).size() / 2})


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
		label.text = _owner_names[owner]
		label.mouse_filter = Control.MOUSE_FILTER_IGNORE
		label.add_theme_color_override("font_color", Color(0.96, 0.96, 0.97, 0.92))
		label.add_theme_color_override("font_outline_color", Color(0.04, 0.05, 0.07, 0.9))
		label.add_theme_constant_override("outline_size", 5)
		label.visible = false
		_labels_layer.add_child(label)
		_labels.append(label)


func _update_labels() -> void:
	if _labels.is_empty():
		return
	var zoom := camera.zoom.x
	var half := get_viewport_rect().size * 0.5
	for owner in range(_labels.size()):
		var label := _labels[owner]
		var area := _owner_area[owner] if owner < _owner_area.size() else 0.0
		var size := sqrt(max(area, 0.0)) * zoom * 0.055
		if size < 10.0:
			label.visible = false
			continue
		var anchor := _owner_anchor[owner]
		anchor.x += WORLD_WIDTH * round((camera.position.x - anchor.x) / WORLD_WIDTH)
		var screen := (anchor - camera.position) * zoom + half
		if screen.x < -300 or screen.y < -100 or screen.x > half.x * 2 + 300 or screen.y > half.y * 2 + 100:
			label.visible = false
			continue
		var font_size := int(clamp(size, 10.0, 34.0))
		label.add_theme_font_size_override("font_size", font_size)
		label.reset_size()
		label.position = screen - label.size * 0.5
		label.visible = true


func _after_camera_move() -> void:
	camera.position.x = fposmod(camera.position.x, WORLD_WIDTH)
	camera.position.y = clamp(camera.position.y, 0.0, WORLD_WIDTH)
	_border_material.set_shader_parameter("zoom", camera.zoom.x)
	_update_labels()


func _zoom_at(screen_point: Vector2, factor: float) -> void:
	var half := get_viewport_rect().size * 0.5
	var before := camera.position + (screen_point - half) / camera.zoom.x
	var next_zoom: float = clamp(camera.zoom.x * factor, MIN_ZOOM, MAX_ZOOM)
	camera.zoom = Vector2.ONE * next_zoom
	var after := camera.position + (screen_point - half) / next_zoom
	camera.position += before - after
	_after_camera_move()


func _unhandled_input(event: InputEvent) -> void:
	if not _ready_to_draw:
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
	if what == NOTIFICATION_WM_SIZE_CHANGED:
		_update_labels()
