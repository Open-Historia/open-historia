class_name Basemap
extends Node2D

const TILE_URL := "https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/%d/%d/%d"
const MAX_ZOOM := 13
const RELIEF_ZOOM := 3
const MAX_REQUESTS := 6

const GRADE_SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform float saturation = 0.08;
uniform float contrast = 0.2;
uniform float brightness_min = 0.05;
uniform float brightness_max = 0.98;
void fragment() {
	vec4 c = texture(TEXTURE, UV);
	vec3 rgb = c.rgb;
	float average = (rgb.r + rgb.g + rgb.b) / 3.0;
	float saturation_factor = saturation > 0.0 ? 1.0 - 1.0 / (1.001 - saturation) : -saturation;
	rgb += (average - rgb) * saturation_factor;
	float contrast_factor = contrast > 0.0 ? 1.0 / (1.0 - contrast) : 1.0 + contrast;
	rgb = (rgb - 0.5) * contrast_factor + 0.5;
	rgb = mix(vec3(brightness_min), vec3(brightness_max), clamp(rgb, 0.0, 1.0));
	COLOR = vec4(rgb, c.a);
}
"""

var world_width := 4096.0
var cache_dir := ""
var _grade: ShaderMaterial
var _relief_grade: ShaderMaterial
var _textures := {}
var _failed := {}
var _sprites := {}
var _queue: Array[String] = []
var _pending := {}
var _active := 0
var _wanted := {}
var _relief: Node2D
var _base_placed := {}
var _relief_loaded := false


func _ready() -> void:
	var shader := Shader.new()
	shader.code = GRADE_SHADER
	_grade = ShaderMaterial.new()
	_grade.shader = shader
	_relief_grade = ShaderMaterial.new()
	_relief_grade.shader = shader
	_relief_grade.set_shader_parameter("saturation", -0.26)
	_relief_grade.set_shader_parameter("contrast", 0.36)
	_relief_grade.set_shader_parameter("brightness_min", 0.015)
	_relief_grade.set_shader_parameter("brightness_max", 0.68)
	_relief = Node2D.new()
	_relief.z_index = -20
	add_child(_relief)
	for x in range(4):
		for y in range(4):
			_request("2/%d/%d" % [x, y])
	_pump()


func _load_relief() -> void:
	if _relief_loaded:
		return
	_relief_loaded = true
	var count := 1 << RELIEF_ZOOM
	var tile := world_width / count
	for x in range(count):
		for y in range(count):
			var path := UI.repo_path("public/offline-relief/%d/%d/%d.jpg" % [RELIEF_ZOOM, x, y])
			var image := Image.load_from_file(path)
			if not image:
				continue
			var texture := ImageTexture.create_from_image(image)
			for copy in [-1, 0, 1]:
				var sprite := Sprite2D.new()
				sprite.texture = texture
				sprite.centered = false
				sprite.position = Vector2(x * tile + copy * world_width, y * tile)
				sprite.scale = Vector2.ONE * (tile / image.get_width())
				sprite.material = _relief_grade
				sprite.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
				_relief.add_child(sprite)


func update_view(centre: Vector2, zoom: float, viewport_size: Vector2) -> void:
	var tile_zoom := clampi(int(round(log(16.0 * zoom) / log(2.0))), 1, MAX_ZOOM)
	var count := 1 << tile_zoom
	var tile := world_width / count
	var half := viewport_size * 0.5 / zoom
	var left := int(floor((centre.x - half.x) / tile))
	var right := int(floor((centre.x + half.x) / tile))
	var top := clampi(int(floor((centre.y - half.y) / tile)), 0, count - 1)
	var bottom := clampi(int(floor((centre.y + half.y) / tile)), 0, count - 1)
	_wanted.clear()
	var all_ready := true
	for x in range(left, right + 1):
		for y in range(top, bottom + 1):
			var wrapped := posmod(x, count)
			var key := "%d/%d/%d" % [tile_zoom, wrapped, y]
			var place := "%s@%d" % [key, x]
			_wanted[place] = true
			if _sprites.has(place):
				continue
			if _textures.has(key):
				_place(place, key, Vector2(x * tile, y * tile), tile, tile_zoom)
			else:
				all_ready = false
				_request(key)
	for place in _sprites.keys():
		if _wanted.has(place):
			continue
		var sprite: Sprite2D = _sprites[place]
		if all_ready or int(sprite.get_meta("zoom")) == tile_zoom:
			sprite.queue_free()
			_sprites.erase(place)
	_queue = _queue.filter(func(key: String) -> bool: return key.begins_with("%d/" % tile_zoom) or key.begins_with("2/"))
	_pump()


func _place(place: String, key: String, origin: Vector2, tile: float, tile_zoom: int) -> void:
	var texture: Texture2D = _textures[key]
	if not texture:
		return
	var sprite := Sprite2D.new()
	sprite.texture = texture
	sprite.centered = false
	sprite.position = origin
	sprite.scale = Vector2.ONE * (tile / texture.get_width())
	sprite.material = _grade
	sprite.z_index = -10 + min(tile_zoom, 9)
	sprite.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
	sprite.set_meta("zoom", tile_zoom)
	add_child(sprite)
	_sprites[place] = sprite


func _request(key: String) -> void:
	if _pending.has(key) or _failed.has(key) or _queue.has(key):
		return
	var cached := _cache_path(key)
	if not cached.is_empty() and FileAccess.file_exists(cached):
		var texture := ImageLoader.decode(FileAccess.get_file_as_bytes(cached))
		if texture:
			_textures[key] = texture
			_after_load()
			return
	_queue.append(key)


func _pump() -> void:
	while _active < MAX_REQUESTS and not _queue.is_empty():
		var key: String = _queue.pop_back()
		var parts := key.split("/")
		_active += 1
		_pending[key] = true
		var request := HTTPRequest.new()
		request.timeout = 20.0
		add_child(request)
		request.request_completed.connect(func(result: int, code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
			_active -= 1
			_pending.erase(key)
			request.queue_free()
			var texture: Texture2D = null
			if result == HTTPRequest.RESULT_SUCCESS and code == 200:
				texture = ImageLoader.decode(body)
			if texture:
				_textures[key] = texture
				_store(key, body)
			else:
				_failed[key] = true
			_after_load()
			_pump())
		if request.request(TILE_URL % [int(parts[0]), int(parts[2]), int(parts[1])]) != OK:
			_active -= 1
			_pending.erase(key)
			_failed[key] = true
			request.queue_free()


func _after_load() -> void:
	var tile := world_width / 4.0
	for x in range(4):
		for y in range(4):
			var key := "2/%d/%d" % [x, y]
			if _failed.has(key):
				_load_relief()
			if _base_placed.has(key) or not _textures.has(key):
				continue
			_base_placed[key] = true
			for copy in [-1, 0, 1]:
				var sprite := Sprite2D.new()
				sprite.texture = _textures[key]
				sprite.centered = false
				sprite.position = Vector2(x * tile + copy * world_width, y * tile)
				sprite.scale = Vector2.ONE * (tile / (_textures[key] as Texture2D).get_width())
				sprite.material = _grade
				sprite.z_index = -15
				sprite.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
				add_child(sprite)
	var camera := get_viewport().get_camera_2d()
	if camera:
		update_view(camera.position, camera.zoom.x, get_viewport_rect().size)


func _cache_path(key: String) -> String:
	if cache_dir.is_empty():
		return ""
	return cache_dir.path_join("ocean").path_join(key + ".jpg")


func _store(key: String, body: PackedByteArray) -> void:
	var path := _cache_path(key)
	if path.is_empty():
		return
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file:
		file.store_buffer(body)
