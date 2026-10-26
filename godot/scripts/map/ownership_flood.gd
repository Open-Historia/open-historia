class_name OwnershipFlood
extends Node

const COLUMNS := 1024
const FLOOD_BUDGET_MS := 350
const SWEEP_BUDGET_MS := 900
const SWEEP_DURATION_MS := 680.0
const SWEEP_STEPS := 24

const FIELD_SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform vec3 from_color = vec3(0.5);
uniform vec3 to_color = vec3(0.5);
uniform float progress = 0.0;
uniform float feather = 0.028;
uniform float opacity = 0.5;
void fragment() {
	vec4 field = texture(TEXTURE, UV);
	float mask = field.a;
	if (mask <= 0.04) {
		discard;
	}
	float arrival = field.r;
	float detached = field.g;
	float spread = mix(feather, max(feather, 0.12), detached);
	float target_mix = 1.0 - smoothstep(progress - spread, progress + spread, arrival);
	vec3 color = mix(from_color, to_color, target_mix);
	float edge_alpha = smoothstep(0.04, 0.88, mask);
	COLOR = vec4(color, edge_alpha * opacity);
}
"""

const SWEEP_SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform sampler2D sweep_data : filter_nearest;
uniform int columns = 1024;
uniform int rows = 1;
uniform float threshold = 0.0;
uniform float opacity = 0.5;
uniform float world_width = 4096.0;
varying flat int region;
varying vec2 local_pos;
const float PI_F = 3.14159265358979;
vec3 unpack_rgb(float packed) {
	float value = floor(packed + 0.5);
	return vec3(floor(value / 65536.0), mod(floor(value / 256.0), 256.0), mod(value, 256.0)) / 255.0;
}
void vertex() {
	region = int(UV.x + 0.5);
	local_pos = VERTEX;
}
void fragment() {
	ivec2 cell = ivec2(region % columns, region / columns);
	vec4 basis = texelFetch(sweep_data, cell, 0);
	vec4 span = texelFetch(sweep_data, cell + ivec2(0, rows), 0);
	vec4 colors = texelFetch(sweep_data, cell + ivec2(0, rows * 2), 0);
	if (span.w < 0.5) {
		discard;
	}
	float lon = local_pos.x / world_width * 360.0 - 180.0;
	float lat = degrees(atan(sinh(PI_F * (1.0 - 2.0 * local_pos.y / world_width))));
	float t = (lon - basis.x) * basis.z + (lat - basis.y) * basis.w;
	float bands = max(span.z, 1.0);
	float width = max((span.y - span.x) / bands, 0.000001);
	float band = clamp(floor((t - span.x) / width), 0.0, bands - 1.0);
	float transition_t = (band + 1.0) / bands;
	vec3 color = transition_t <= threshold ? unpack_rgb(colors.y) : unpack_rgb(colors.x);
	COLOR = vec4(color, opacity);
}
"""

var extras: Node
var map_view: MapView
var _queue: Array[Dictionary] = []
var _active: Dictionary = {}
var _held := {}
var _canonical := {}
var _snapshot_colors: Image
var _snapshot_ids: Image
var _token := 0
var _nodes: Array[Node2D] = []
var _field_materials: Array[ShaderMaterial] = []
var _sweep_material: ShaderMaterial
var _sweep_image: Image
var _sweep_texture: ImageTexture
var _rows := 1
var _phase := ""
var _started_at := 0
var last_mode := ""
var last_elapsed_ms := 0
var last_compute_ms := 0
var completed := 0


func setup(owner_extras: Node) -> void:
	extras = owner_extras
	map_view = extras.get("map_view")
	var shader := Shader.new()
	shader.code = SWEEP_SHADER
	_sweep_material = ShaderMaterial.new()
	_sweep_material.shader = shader


func rebuild() -> void:
	_abort()
	_queue.clear()
	_held.clear()
	_canonical.clear()
	_snapshot_colors = null
	_snapshot_ids = null
	_rows = max(1, int(ceil(float(max(1, map_view.extras_region_count())) / COLUMNS)))
	_sweep_image = Image.create_empty(COLUMNS, _rows * 3, false, Image.FORMAT_RGBAF)
	_sweep_texture = ImageTexture.create_from_image(_sweep_image)
	_sweep_material.set_shader_parameter("sweep_data", _sweep_texture)
	_sweep_material.set_shader_parameter("columns", COLUMNS)
	_sweep_material.set_shader_parameter("rows", _rows)


func busy() -> bool:
	return not _active.is_empty() or not _queue.is_empty()


static func css(colour: Color) -> String:
	return "rgb(%d, %d, %d)" % [int(roundf(colour.r * 255.0)), int(roundf(colour.g * 255.0)), int(roundf(colour.b * 255.0))]


func state_applied(previous_owners: PackedInt32Array, previous_names: PackedStringArray, _palette: Array[Color]) -> void:
	var images: Dictionary = map_view.extras_images()
	var colors: Image = images["colors"]
	var ids: Image = images["ids"]
	if colors == null or ids == null:
		return
	var owners := map_view.extras_owners()
	var names := map_view.extras_owner_names()
	var count := owners.size()
	for index in _held.keys():
		var region := int(index)
		_canonical[region] = [colors.get_pixel(region % COLUMNS, region / COLUMNS), ids.get_pixel(region % COLUMNS, region / COLUMNS)]
	var animate := _snapshot_colors != null and previous_owners.size() == count and count > 0 and _allowed()
	var changes: Array[Dictionary] = []
	if animate:
		for index in range(count):
			var before_slot := previous_owners[index]
			var after_slot := owners[index]
			var before := previous_names[before_slot] if before_slot >= 0 and before_slot < previous_names.size() else ""
			var after := names[after_slot] if after_slot >= 0 and after_slot < names.size() else ""
			if before == after or before.is_empty() or after.is_empty():
				continue
			var x := index % COLUMNS
			var y := index / COLUMNS
			var presented: Array = _held[index] if _held.has(index) else [_snapshot_colors.get_pixel(x, y), _snapshot_ids.get_pixel(x, y)]
			var target: Color = colors.get_pixel(x, y)
			_canonical[index] = [target, ids.get_pixel(x, y)]
			_held[index] = presented
			var from_color: Color = presented[0]
			changes.append({"index": index, "from": before, "to": after, "fromColor": css(from_color), "toColor": css(target), "from_rgb": from_color, "to_rgb": target})
	for index in _held.keys():
		var region := int(index)
		var presented: Array = _held[region]
		var colour: Color = presented[0]
		var active_regions: Dictionary = _active.get("regions", {})
		var hidden: bool = _phase == "running" and active_regions.has(region)
		colors.set_pixel(region % COLUMNS, region / COLUMNS, Color(colour.r, colour.g, colour.b, 0.0 if hidden else 1.0))
		ids.set_pixel(region % COLUMNS, region / COLUMNS, presented[1])
	if not changes.is_empty():
		_queue.append({"changes": changes, "previousOwners": previous_owners, "previousNames": previous_names})
	_snapshot_colors = colors.duplicate()
	_snapshot_ids = ids.duplicate()
	if _active.is_empty() and not _queue.is_empty():
		_start(_queue.pop_front())


func capture() -> void:
	var images: Dictionary = map_view.extras_images()
	var colors: Image = images.get("colors")
	var ids: Image = images.get("ids")
	if colors and ids and map_view.extras_owners().size() > 0:
		_snapshot_colors = colors.duplicate()
		_snapshot_ids = ids.duplicate()


func _allowed() -> bool:
	var world: Dictionary = extras.get("world")
	if not bool(world.get("customRegions", true)):
		return false
	return not bool(extras.call("reduce_motion"))


func _process(_delta: float) -> void:
	if _active.is_empty():
		if not _queue.is_empty():
			_start(_queue.pop_front())
		return
	var now := Time.get_ticks_msec()
	if _phase == "armed":
		_phase = "running"
		_started_at = now
		_hide_base(true)
		for node in _nodes:
			if is_instance_valid(node):
				node.visible = true
		return
	if _phase != "running":
		return
	if str(_active.get("mode", "")) == "flood":
		var complete := true
		var fields: Array = _active.get("fields", [])
		for slot in range(fields.size()):
			var field: Dictionary = fields[slot]
			var duration := maxf(1.0, float(field.get("durationMs", 480)))
			var raw := clampf(float(now - _started_at) / duration, 0.0, 1.0)
			if raw < 1.0:
				complete = false
			var progress := clampf(raw + sin(PI * raw) * 0.12, 0.0, 1.0)
			if slot < _field_materials.size():
				_field_materials[slot].set_shader_parameter("progress", progress)
		if complete:
			_finish()
	else:
		var raw := clampf(float(now - _started_at) / SWEEP_DURATION_MS, 0.0, 1.0)
		var step := mini(SWEEP_STEPS, int(floor(raw * SWEEP_STEPS)))
		_sweep_material.set_shader_parameter("threshold", float(step) / SWEEP_STEPS)
		if raw >= 1.0:
			_finish()


func _start(entry: Dictionary) -> void:
	_token += 1
	var token := _token
	var started := Time.get_ticks_msec()
	var regions := {}
	for change in entry["changes"]:
		regions[int((change as Dictionary)["index"])] = change
	_active = {"entry": entry, "regions": regions, "mode": "", "fields": []}
	_phase = "preparing"
	var engine: EngineLink = extras.get("engine")
	if engine == null:
		_finish()
		return
	var changes: Array = []
	for change in entry["changes"]:
		var item: Dictionary = change
		changes.append({"index": item["index"], "from": item["from"], "to": item["to"], "fromColor": item["fromColor"], "toColor": item["toColor"]})
	var last_state: Variant = map_view.get("_last_state")
	var sha := str((last_state as Dictionary).get("sha", "")) if last_state is Dictionary else ""
	var reply: Dictionary = await engine.request("mapextras.flood", {
		"changes": changes,
		"previousNames": Array(entry["previousNames"]),
		"previousOwners": Array(entry["previousOwners"]),
		"sha": sha,
	})
	if token != _token:
		return
	var elapsed := Time.get_ticks_msec() - started
	last_elapsed_ms = elapsed
	if not bool(reply.get("ok", false)) or not (reply.get("result") is Dictionary):
		_finish()
		return
	var result: Dictionary = reply["result"]
	var mode := str(result.get("mode", "none"))
	last_mode = mode
	last_compute_ms = int(result.get("elapsedMs", 0))
	if mode == "flood" and last_compute_ms <= FLOOD_BUDGET_MS:
		_build_flood(result.get("fields", []))
	elif mode == "sweep" and last_compute_ms <= SWEEP_BUDGET_MS:
		_build_sweep(result.get("regions", []))
	else:
		_finish()


func _build_flood(fields: Array) -> void:
	_clear_nodes()
	_field_materials.clear()
	var level := map_view.zoom_level()
	var opacity := float(MapExtras.political_fill_opacity(level))
	var regions: Dictionary = _active["regions"]
	var built: Array[Dictionary] = []
	var textures: Array[ImageTexture] = []
	for raw in fields:
		if not (raw is Dictionary):
			continue
		var field: Dictionary = raw
		var width := int(field.get("width", 0))
		var height := int(field.get("height", 0))
		var bytes := Marshalls.base64_to_raw(str(field.get("data", "")))
		var bounds: Dictionary = field.get("bounds", {})
		if width <= 0 or height <= 0 or bytes.size() != width * height * 4 or bounds.is_empty():
			continue
		var change: Dictionary = regions.get(int(field.get("index", -1)), {})
		var shader := Shader.new()
		shader.code = FIELD_SHADER
		var material := ShaderMaterial.new()
		material.shader = shader
		var from_rgb: Color = change.get("from_rgb", _parse_css(str(field.get("fromColor", ""))))
		var to_rgb: Color = change.get("to_rgb", _parse_css(str(field.get("toColor", ""))))
		material.set_shader_parameter("from_color", Vector3(from_rgb.r, from_rgb.g, from_rgb.b))
		material.set_shader_parameter("to_color", Vector3(to_rgb.r, to_rgb.g, to_rgb.b))
		material.set_shader_parameter("feather", clampf(float(field.get("feather", 0.028)), 0.002, 0.28))
		material.set_shader_parameter("progress", 0.0)
		material.set_shader_parameter("opacity", opacity)
		_field_materials.append(material)
		textures.append(ImageTexture.create_from_image(Image.create_from_data(width, height, false, Image.FORMAT_RGBA8, bytes)))
		built.append(field)
	if built.is_empty():
		_finish()
		return
	_active["mode"] = "flood"
	_active["fields"] = built
	for slot in extras.call("slots", "flood"):
		var holder := Node2D.new()
		holder.visible = false
		for index in range(built.size()):
			var field: Dictionary = built[index]
			var bounds: Dictionary = field["bounds"]
			var min_x := float(bounds.get("minX", 0.0)) * MapView.WORLD_WIDTH
			var min_y := float(bounds.get("minY", 0.0)) * MapView.WORLD_WIDTH
			var max_x := float(bounds.get("maxX", 0.0)) * MapView.WORLD_WIDTH
			var max_y := float(bounds.get("maxY", 0.0)) * MapView.WORLD_WIDTH
			var sprite := Sprite2D.new()
			sprite.centered = false
			sprite.texture = textures[index]
			sprite.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
			sprite.material = _field_materials[index]
			sprite.position = Vector2(min_x, min_y)
			sprite.scale = Vector2((max_x - min_x) / float(textures[index].get_width()), (max_y - min_y) / float(textures[index].get_height()))
			holder.add_child(sprite)
		(slot as Node2D).add_child(holder)
		_nodes.append(holder)
	_phase = "armed"


func _build_sweep(entries: Array) -> void:
	_clear_nodes()
	_sweep_image.fill(Color(0, 0, 0, 0))
	var regions: Dictionary = _active["regions"]
	var count := 0
	for raw in entries:
		if not (raw is Dictionary):
			continue
		var entry: Dictionary = raw
		var index := int(entry.get("index", -1))
		if index < 0 or index >= _rows * COLUMNS:
			continue
		var change: Dictionary = regions.get(index, {})
		var center: Array = entry.get("center", [0, 0])
		var direction: Array = entry.get("d", [1, 0])
		var from_rgb: Color = change.get("from_rgb", Color.GRAY)
		var to_rgb: Color = change.get("to_rgb", Color.GRAY)
		var x := index % COLUMNS
		var y := index / COLUMNS
		_sweep_image.set_pixel(x, y, Color(float(center[0]), float(center[1]), float(direction[0]), float(direction[1])))
		_sweep_image.set_pixel(x, y + _rows, Color(float(entry.get("minT", 0.0)), float(entry.get("maxT", 1.0)), float(entry.get("bands", 1)), 1.0))
		_sweep_image.set_pixel(x, y + _rows * 2, Color(_pack(from_rgb), _pack(to_rgb), 0.0, 0.0))
		count += 1
	if count == 0:
		_finish()
		return
	_sweep_texture.update(_sweep_image)
	_sweep_material.set_shader_parameter("threshold", 0.0)
	_sweep_material.set_shader_parameter("opacity", float(MapExtras.political_fill_opacity(map_view.zoom_level())))
	_sweep_material.set_shader_parameter("world_width", MapView.WORLD_WIDTH)
	_active["mode"] = "sweep"
	var fill: Mesh = map_view.extras_meshes().get("fill")
	if fill == null:
		_finish()
		return
	for slot in extras.call("slots", "flood"):
		var holder := Node2D.new()
		holder.visible = false
		var mesh := MeshInstance2D.new()
		mesh.mesh = fill
		mesh.material = _sweep_material
		holder.add_child(mesh)
		(slot as Node2D).add_child(holder)
		_nodes.append(holder)
	_phase = "armed"


static func _pack(colour: Color) -> float:
	return float(int(roundf(colour.r * 255.0)) * 65536 + int(roundf(colour.g * 255.0)) * 256 + int(roundf(colour.b * 255.0)))


static func _parse_css(text: String) -> Color:
	var parts := text.replace("rgb(", "").replace(")", "").split(",")
	if parts.size() < 3:
		return Color.GRAY
	return Color8(int(parts[0].strip_edges()), int(parts[1].strip_edges()), int(parts[2].strip_edges()))


func _hide_base(hidden: bool) -> void:
	var images: Dictionary = map_view.extras_images()
	var colors: Image = images["colors"]
	if colors == null:
		return
	for index in _active.get("regions", {}).keys():
		var region := int(index)
		if not _held.has(region):
			continue
		var presented: Array = _held[region]
		var colour: Color = presented[0]
		colors.set_pixel(region % COLUMNS, region / COLUMNS, Color(colour.r, colour.g, colour.b, 0.0 if hidden else 1.0))
	map_view.extras_commit_images()


func on_zoom(level: float) -> void:
	var opacity := float(MapExtras.political_fill_opacity(level))
	for material in _field_materials:
		material.set_shader_parameter("opacity", opacity)
	_sweep_material.set_shader_parameter("opacity", opacity)


func _finish() -> void:
	var regions: Dictionary = _active.get("regions", {})
	var images: Dictionary = map_view.extras_images()
	var colors: Image = images["colors"]
	var ids: Image = images["ids"]
	for index in regions.keys():
		var region := int(index)
		var later := false
		for queued in _queue:
			for change in queued["changes"]:
				if int((change as Dictionary)["index"]) == region:
					later = true
					break
			if later:
				break
		if not _canonical.has(region):
			_held.erase(region)
			continue
		var canonical: Array = _canonical[region]
		if later:
			var change: Dictionary = regions[region]
			_held[region] = [change.get("to_rgb", canonical[0]), canonical[1]]
			var presented: Color = change.get("to_rgb", canonical[0])
			if colors:
				colors.set_pixel(region % COLUMNS, region / COLUMNS, Color(presented.r, presented.g, presented.b, 1.0))
			continue
		_held.erase(region)
		_canonical.erase(region)
		if colors and ids:
			colors.set_pixel(region % COLUMNS, region / COLUMNS, canonical[0])
			ids.set_pixel(region % COLUMNS, region / COLUMNS, canonical[1])
	map_view.extras_commit_images()
	if colors:
		_snapshot_colors = colors.duplicate()
	if ids:
		_snapshot_ids = ids.duplicate()
	_clear_nodes()
	_field_materials.clear()
	_active = {}
	_phase = ""
	completed += 1


func _abort() -> void:
	_token += 1
	_clear_nodes()
	_field_materials.clear()
	_active = {}
	_phase = ""


func _clear_nodes() -> void:
	for node in _nodes:
		if is_instance_valid(node):
			node.queue_free()
	_nodes.clear()
