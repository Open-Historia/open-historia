class_name RegionOverlays
extends Node

const COLUMNS := 1024
const STRIPE_OPACITY := 0.22
const GROUP_TINT_OPACITY := 0.2
const GROUP_FADE_SECONDS := 0.3
const WORKSHOP_ZOOM_OFFSET := 1.0

const UNDER_SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform sampler2D stripe_regions : filter_nearest;
uniform sampler2D stripe_palette : filter_nearest;
uniform sampler2D group_regions : filter_nearest;
uniform int columns = 1024;
uniform float pattern_scale = 1.0;
uniform float stripe_opacity = 0.22;
uniform float group_opacity = 0.2;
uniform bool show_stripes = false;
uniform bool show_groups = false;
varying flat int region;
varying vec2 local_pos;
void vertex() {
	region = int(UV.x + 0.5);
	local_pos = VERTEX;
}
void fragment() {
	ivec2 cell = ivec2(region % columns, region / columns);
	vec4 result = vec4(0.0);
	if (show_stripes) {
		vec4 stripe = texelFetch(stripe_regions, cell, 0);
		if (stripe.r >= 0.0) {
			int count = max(1, int(stripe.g + 0.5));
			int period = count * 8;
			ivec2 pixel = ivec2(floor(local_pos * pattern_scale));
			int k = (pixel.x + pixel.y) % period;
			if (k < 0) {
				k += period;
			}
			vec3 band = texelFetch(stripe_palette, ivec2(k / 8, int(stripe.r + 0.5)), 0).rgb;
			result = vec4(band, stripe_opacity);
		}
	}
	if (show_groups) {
		vec4 group = texelFetch(group_regions, cell, 0);
		if (group.a > 0.5) {
			float alpha = group_opacity + result.a * (1.0 - group_opacity);
			vec3 rgb = (group.rgb * group_opacity + result.rgb * result.a * (1.0 - group_opacity)) / max(alpha, 0.00001);
			result = vec4(rgb, alpha);
		}
	}
	if (result.a <= 0.0) {
		discard;
	}
	COLOR = result;
}
"""

const ICE_SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform sampler2D ice_regions : filter_nearest;
uniform sampler2D crack_a : filter_linear, repeat_enable;
uniform sampler2D crack_b : filter_linear, repeat_enable;
uniform vec2 size_a = vec2(181.0);
uniform vec2 size_b = vec2(241.0);
uniform vec3 tint = vec3(0.8627, 0.9255, 0.9725);
uniform float pattern_scale = 1.0;
uniform int columns = 1024;
varying flat int region;
varying vec2 local_pos;
void vertex() {
	region = int(UV.x + 0.5);
	local_pos = VERTEX;
}
void fragment() {
	if (texelFetch(ice_regions, ivec2(region % columns, region / columns), 0).r < 0.5) {
		discard;
	}
	vec4 acc = vec4(tint * 0.3, 0.3);
	vec2 pattern = local_pos * pattern_scale;
	vec4 a = texture(crack_a, pattern / size_a);
	acc = vec4(a.rgb * 0.9 + acc.rgb * (1.0 - a.a * 0.9), a.a * 0.9 + acc.a * (1.0 - a.a * 0.9));
	vec4 b = texture(crack_b, pattern / size_b);
	acc = vec4(b.rgb * 0.9 + acc.rgb * (1.0 - b.a * 0.9), b.a * 0.9 + acc.a * (1.0 - b.a * 0.9));
	COLOR = vec4(acc.rgb / max(acc.a, 0.00001), acc.a);
}
"""

const ICE_EDGE_SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform sampler2D ice_regions : filter_nearest;
uniform int columns = 1024;
uniform float zoom_level = 2.0;
uniform float pixel_world = 1.0;
varying float edge;
varying float outset;
float frozen(int region) {
	return texelFetch(ice_regions, ivec2(region % columns, region / columns), 0).r;
}
float ice_width(float z) {
	if (z <= 2.0) return 0.8;
	if (z <= 6.0) return mix(0.8, 1.6, (z - 2.0) / 4.0);
	if (z <= 10.0) return mix(1.6, 2.4, (z - 6.0) / 4.0);
	return 2.4;
}
void vertex() {
	int a = int(UV.x + 0.5);
	int b = int(floor(UV.y + 0.5));
	vec2 offset = COLOR.rg * 2.0 - 1.0;
	edge = COLOR.b * 2.0 - 1.0;
	bool shown = frozen(a) > 0.5 || (b >= 0 && frozen(b) > 0.5);
	float width = shown ? ice_width(zoom_level) : 0.0;
	outset = width > 0.0 ? width * 0.5 + 0.5 : 0.0;
	VERTEX += offset * outset * pixel_world;
	edge *= outset;
}
void fragment() {
	float coverage = clamp(outset - abs(edge), 0.0, 1.0);
	COLOR = vec4(238.0 / 255.0, 246.0 / 255.0, 1.0, 0.95 * coverage);
}
"""

const LINE_SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform sampler2D group_colors : filter_nearest;
uniform bool casing = false;
uniform float zoom_level = 2.0;
uniform float pixel_world = 1.0;
uniform float shown = 1.0;
varying flat int group;
varying float edge;
varying float outset;
float stops(float z, float a, float b, float c, float d, float e) {
	if (z <= 1.0) return a;
	if (z <= 3.0) return mix(a, b, (z - 1.0) / 2.0);
	if (z <= 6.0) return mix(b, c, (z - 3.0) / 3.0);
	if (z <= 9.0) return mix(c, d, (z - 6.0) / 3.0);
	if (z <= 12.0) return mix(d, e, (z - 9.0) / 3.0);
	return e;
}
void vertex() {
	group = int(COLOR.r * 255.0 + 0.5);
	float side = COLOR.g * 2.0 - 1.0;
	float width = casing ? stops(zoom_level, 2.4, 3.2, 4.4, 5.4, 6.4) : stops(zoom_level, 1.1, 1.6, 2.4, 3.0, 3.6);
	outset = width * 0.5 + 0.5;
	VERTEX += UV * outset * pixel_world;
	edge = side * outset;
}
void fragment() {
	float blur2 = casing ? 1.6 : 1.0;
	float coverage = clamp((outset - abs(edge)) / blur2, 0.0, 1.0);
	vec4 color = casing ? vec4(5.0 / 255.0, 8.0 / 255.0, 13.0 / 255.0, 0.9 * 0.4) : vec4(texelFetch(group_colors, ivec2(group, 0), 0).rgb, 0.95);
	COLOR = vec4(color.rgb, color.a * coverage * shown);
}
"""

var extras: Node
var map_view: MapView
var world: Dictionary = {}
var _rows := 1
var _stripe_regions: Image
var _stripe_regions_texture: ImageTexture
var _stripe_palette: Image
var _stripe_palette_texture: ImageTexture
var _group_regions: Image
var _group_regions_texture: ImageTexture
var _ice_regions: Image
var _ice_regions_texture: ImageTexture
var _style_image: Image
var _style_texture: ImageTexture
var _group_colors: Image
var _group_colors_texture: ImageTexture
var _under_material: ShaderMaterial
var _ice_material: ShaderMaterial
var _ice_edge_material: ShaderMaterial
var _casing_material: ShaderMaterial
var _outline_material: ShaderMaterial
var _ice_patterns_loaded := false
var _under_nodes: Array[MeshInstance2D] = []
var _ice_nodes: Array[Node2D] = []
var _line_nodes: Array[Node2D] = []
var _line_mesh: ArrayMesh
var _labels: GroupLabels
var _has_claims := false
var _has_groups := false
var _group_fade := 0.0
var _group_tween: Tween
var _group_data := false
var _has_ice := false
var _type_styles: Array = []
var _typed: Array = []
var _type_zoom_key := ""
var _group_request := 0


func setup(owner_extras: Node) -> void:
	extras = owner_extras
	map_view = extras.get("map_view")
	_under_material = _material(UNDER_SHADER)
	_ice_material = _material(ICE_SHADER)
	_ice_edge_material = _material(ICE_EDGE_SHADER)
	_casing_material = _material(LINE_SHADER)
	_casing_material.set_shader_parameter("casing", true)
	_outline_material = _material(LINE_SHADER)
	_labels = GroupLabels.new()
	_labels.map_view = map_view
	var layer: Variant = map_view.get("_labels_layer")
	if layer is Control:
		(layer as Control).add_child(_labels)
	_alloc()


func _material(code: String) -> ShaderMaterial:
	var shader := Shader.new()
	shader.code = code
	var material := ShaderMaterial.new()
	material.shader = shader
	return material


func _alloc() -> void:
	var count: int = max(1, map_view.extras_region_count())
	_rows = max(1, int(ceil(float(count) / COLUMNS)))
	_stripe_regions = Image.create_empty(COLUMNS, _rows, false, Image.FORMAT_RGBAF)
	_stripe_regions.fill(Color(-1, 0, 0, 0))
	_stripe_regions_texture = ImageTexture.create_from_image(_stripe_regions)
	_stripe_palette = Image.create_empty(8, 1, false, Image.FORMAT_RGBA8)
	_stripe_palette_texture = ImageTexture.create_from_image(_stripe_palette)
	_group_regions = Image.create_empty(COLUMNS, _rows, false, Image.FORMAT_RGBA8)
	_group_regions.fill(Color(0, 0, 0, 0))
	_group_regions_texture = ImageTexture.create_from_image(_group_regions)
	_ice_regions = Image.create_empty(COLUMNS, _rows, false, Image.FORMAT_RGBA8)
	_ice_regions.fill(Color(0, 0, 0, 0))
	_ice_regions_texture = ImageTexture.create_from_image(_ice_regions)
	_style_image = Image.create_empty(COLUMNS, _rows * 2, false, Image.FORMAT_RGBAF)
	_style_texture = ImageTexture.create_from_image(_style_image)
	_group_colors = Image.create_empty(256, 1, false, Image.FORMAT_RGBA8)
	_group_colors_texture = ImageTexture.create_from_image(_group_colors)
	_under_material.set_shader_parameter("stripe_regions", _stripe_regions_texture)
	_under_material.set_shader_parameter("stripe_palette", _stripe_palette_texture)
	_under_material.set_shader_parameter("group_regions", _group_regions_texture)
	_under_material.set_shader_parameter("columns", COLUMNS)
	_under_material.set_shader_parameter("stripe_opacity", STRIPE_OPACITY)
	_under_material.set_shader_parameter("group_opacity", GROUP_TINT_OPACITY)
	_ice_material.set_shader_parameter("ice_regions", _ice_regions_texture)
	_ice_material.set_shader_parameter("columns", COLUMNS)
	_ice_edge_material.set_shader_parameter("ice_regions", _ice_regions_texture)
	_ice_edge_material.set_shader_parameter("columns", COLUMNS)
	_outline_material.set_shader_parameter("group_colors", _group_colors_texture)
	_casing_material.set_shader_parameter("group_colors", _group_colors_texture)


func rebuild() -> void:
	_alloc()
	_type_zoom_key = ""
	_mount()
	if not world.is_empty():
		set_world(world)


func _mount() -> void:
	for node in _under_nodes:
		if is_instance_valid(node):
			node.queue_free()
	_under_nodes.clear()
	for node in _ice_nodes:
		if is_instance_valid(node):
			node.queue_free()
	_ice_nodes.clear()
	var meshes: Dictionary = map_view.extras_meshes()
	var fill: Mesh = meshes.get("fill")
	var border: Mesh = meshes.get("border")
	if fill == null:
		return
	for slot in extras.call("slots", "under"):
		var node := MeshInstance2D.new()
		node.mesh = fill
		node.material = _under_material
		node.visible = _has_claims or _group_fade > 0.0
		(slot as Node2D).add_child(node)
		_under_nodes.append(node)
	for slot in extras.call("slots", "ice"):
		var holder := Node2D.new()
		var ice := MeshInstance2D.new()
		ice.mesh = fill
		ice.material = _ice_material
		holder.add_child(ice)
		if border:
			var edge := MeshInstance2D.new()
			edge.mesh = border
			edge.material = _ice_edge_material
			holder.add_child(edge)
		holder.visible = _has_ice
		(slot as Node2D).add_child(holder)
		_ice_nodes.append(holder)
	_mount_lines()


func set_world(next: Dictionary) -> void:
	world = next
	if _under_nodes.is_empty() and map_view.extras_ready():
		_mount()
	var region_count := map_view.extras_region_count()
	if region_count > _rows * COLUMNS:
		_alloc()
		_mount()
	var shown := bool(world.get("worldKnown", false)) and bool(world.get("customRegions", false))
	_apply_claims(world.get("claims", []), shown)
	_apply_groups(world.get("groups", []), world.get("groupRegions", []), shown)
	_apply_ice(world.get("frozen", []))
	var types: Dictionary = world.get("regionTypes", {}) if world.get("regionTypes") is Dictionary else {}
	_type_styles = types.get("styles", [])
	_typed = types.get("regions", [])
	_type_zoom_key = ""
	_apply_types(map_view.zoom_level(), true)
	for material in map_view.extras_border_materials():
		material.set_shader_parameter("province_outlines", bool(world.get("worldKnown", false)))
	if _has_groups:
		_load_group_areas()
	elif _group_fade <= 0.0:
		_clear_lines()


func _apply_claims(claims: Array, shown: bool) -> void:
	_stripe_regions.fill(Color(-1, 0, 0, 0))
	var palettes := {}
	var rows: Array = []
	for entry in claims:
		if not (entry is Dictionary):
			continue
		var index := int(entry.get("index", -1))
		var stripes: Array = entry.get("stripes", [])
		if index < 0 or stripes.size() < 2 or index >= _rows * COLUMNS:
			continue
		var key := JSON.stringify(stripes)
		if not palettes.has(key):
			palettes[key] = rows.size()
			rows.append(stripes)
		_stripe_regions.set_pixel(index % COLUMNS, index / COLUMNS, Color(float(palettes[key]), float(min(stripes.size(), 8)), 0, 0))
	var width := 8
	_stripe_palette = Image.create_empty(width, max(1, rows.size()), false, Image.FORMAT_RGBA8)
	for row in range(rows.size()):
		var stripes: Array = rows[row]
		for slot in range(min(stripes.size(), width)):
			var rgb: Array = stripes[slot]
			_stripe_palette.set_pixel(slot, row, Color8(int(rgb[0]), int(rgb[1]), int(rgb[2])))
	_stripe_palette_texture = ImageTexture.create_from_image(_stripe_palette)
	_stripe_regions_texture.update(_stripe_regions)
	_under_material.set_shader_parameter("stripe_palette", _stripe_palette_texture)
	_has_claims = shown and not rows.is_empty()
	_under_material.set_shader_parameter("show_stripes", _has_claims)
	for node in _under_nodes:
		if is_instance_valid(node):
			node.visible = _has_claims or _group_fade > 0.0


func _apply_groups(groups: Array, members: Array, shown: bool) -> void:
	_group_regions.fill(Color(0, 0, 0, 0))
	_group_colors.fill(Color(0, 0, 0, 0))
	var colors: Array[Color] = []
	for group in groups:
		var colour := Color.from_string(str((group as Dictionary).get("color", "#e11d48")), Color("#e11d48")) if group is Dictionary else Color("#e11d48")
		colors.append(colour)
	for slot in range(min(colors.size(), 256)):
		_group_colors.set_pixel(slot, 0, colors[slot])
	for pair in members:
		if not (pair is Array) or (pair as Array).size() < 2:
			continue
		var index := int(pair[0])
		var group := int(pair[1])
		if index < 0 or index >= _rows * COLUMNS or group < 0 or group >= colors.size():
			continue
		var colour := colors[group]
		_group_regions.set_pixel(index % COLUMNS, index / COLUMNS, Color(colour.r, colour.g, colour.b, 1.0))
	_group_regions_texture.update(_group_regions)
	_group_colors_texture.update(_group_colors)
	var had_data := _group_data
	_group_data = not members.is_empty() and not groups.is_empty()
	_has_groups = shown and _group_data
	_fade_groups(1.0 if _has_groups else 0.0, had_data and _group_data)


func _fade_groups(target: float, eased: bool) -> void:
	if _group_tween and _group_tween.is_valid():
		_group_tween.kill()
	if not eased or is_equal_approx(_group_fade, target) or not is_inside_tree():
		_set_group_fade(target)
		return
	_group_tween = create_tween().set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_IN_OUT)
	_group_tween.tween_method(_set_group_fade, _group_fade, target, GROUP_FADE_SECONDS)


func _set_group_fade(value: float) -> void:
	_group_fade = value
	var on := value > 0.0
	_under_material.set_shader_parameter("show_groups", on)
	_under_material.set_shader_parameter("group_opacity", GROUP_TINT_OPACITY * value)
	for material in [_casing_material, _outline_material]:
		(material as ShaderMaterial).set_shader_parameter("shown", value)
	for node in _under_nodes:
		if is_instance_valid(node):
			node.visible = _has_claims or on
	_labels.modulate.a = value
	_labels.visible = on
	if not on and not _has_groups:
		_clear_lines()


func _apply_ice(frozen: Array) -> void:
	_ice_regions.fill(Color(0, 0, 0, 0))
	var count := 0
	for value in frozen:
		var index := int(value)
		if index < 0 or index >= _rows * COLUMNS:
			continue
		_ice_regions.set_pixel(index % COLUMNS, index / COLUMNS, Color(1, 0, 0, 1))
		count += 1
	_ice_regions_texture.update(_ice_regions)
	_has_ice = count > 0
	for node in _ice_nodes:
		if is_instance_valid(node):
			node.visible = _has_ice
	if _has_ice and not _ice_patterns_loaded:
		_load_ice_patterns()


func _load_ice_patterns() -> void:
	var engine: EngineLink = extras.get("engine")
	if engine == null:
		return
	_ice_patterns_loaded = true
	var reply: Dictionary = await engine.request("mapextras.patterns")
	if not bool(reply.get("ok", false)) or not (reply.get("result") is Dictionary):
		_ice_patterns_loaded = false
		return
	var result: Dictionary = reply["result"]
	var tiles: Array = result.get("ice", [])
	var names := ["crack_a", "crack_b"]
	var sizes := ["size_a", "size_b"]
	for layer in range(min(tiles.size(), 2)):
		var tile: Dictionary = tiles[layer]
		var bytes := Marshalls.base64_to_raw(str(tile.get("data", "")))
		var width := int(tile.get("width", 0))
		var height := int(tile.get("height", 0))
		if width <= 0 or height <= 0 or bytes.size() != width * height * 4:
			continue
		var image := Image.create_from_data(width, height, false, Image.FORMAT_RGBA8, bytes)
		image.premultiply_alpha()
		_ice_material.set_shader_parameter(names[layer], ImageTexture.create_from_image(image))
		_ice_material.set_shader_parameter(sizes[layer], Vector2(width, height))
	var tint := Color.from_string(str(result.get("tint", "#dcecf8")), Color("#dcecf8"))
	_ice_material.set_shader_parameter("tint", Vector3(tint.r, tint.g, tint.b))


func on_state() -> void:
	if not _typed.is_empty():
		_apply_types(map_view.zoom_level(), true)


func on_zoom(level: float) -> void:
	var scale := pow(2.0, floorf(level)) / 8.0
	_under_material.set_shader_parameter("pattern_scale", scale)
	_ice_material.set_shader_parameter("pattern_scale", scale)
	var pixel := 1.0 / map_view.camera.zoom.x
	for material in [_ice_edge_material, _casing_material, _outline_material]:
		(material as ShaderMaterial).set_shader_parameter("zoom_level", level)
		(material as ShaderMaterial).set_shader_parameter("pixel_world", pixel)
	if not _typed.is_empty():
		_apply_types(level, false)
	if _labels.visible:
		_labels.queue_redraw()


func _band_shown(style: Dictionary, level: float) -> bool:
	var bands: Variant = style.get("bands")
	if not (bands is Array) or (bands as Array).is_empty():
		return true
	var workshop := level + WORKSHOP_ZOOM_OFFSET
	for band in bands:
		if band is Array and (band as Array).size() >= 2 and workshop >= float(band[0]) and workshop <= float(band[1]):
			return true
	return false


func _apply_types(level: float, force: bool) -> void:
	var key := ""
	for style in _type_styles:
		if style is Dictionary and (style as Dictionary).get("bands") is Array:
			key += "1" if _band_shown(style, level) else "0"
	if not force and key == _type_zoom_key:
		return
	_type_zoom_key = key
	var fill_material: ShaderMaterial = map_view.extras_fill_material()
	if _typed.is_empty():
		fill_material.set_shader_parameter("styled", false)
		for material in map_view.extras_border_materials():
			material.set_shader_parameter("styled", false)
		return
	_style_image.fill(Color(-1, 1, -1, 0))
	for row in range(_rows, _rows * 2):
		for column in range(COLUMNS):
			_style_image.set_pixel(column, row, Color(1, 0, 0, 0))
	var owners := map_view.extras_owners()
	for pair in _typed:
		if not (pair is Array) or (pair as Array).size() < 2:
			continue
		var index := int(pair[0])
		var slot := int(pair[1])
		if index < 0 or index >= _rows * COLUMNS or slot < 0 or slot >= _type_styles.size():
			continue
		var style: Dictionary = _type_styles[slot]
		var shown := _band_shown(style, level)
		var owned := index < owners.size() and owners[index] >= 0
		var scale := float(style.get("ownedScale", 1.0)) if owned else float(style.get("unownedScale", 1.0))
		var fill: Variant = style.get("fill")
		var stroke: Variant = style.get("stroke")
		var fill_packed := -1.0
		if fill is Array and (fill as Array).size() >= 3:
			fill_packed = float(int(fill[0]) * 65536 + int(fill[1]) * 256 + int(fill[2]))
		var stroke_packed := -1.0
		var stroke_alpha := 0.0
		if stroke is Array and (stroke as Array).size() >= 3:
			stroke_packed = float(int(stroke[0]) * 65536 + int(stroke[1]) * 256 + int(stroke[2]))
			stroke_alpha = float(stroke[3]) if (stroke as Array).size() > 3 else 1.0
		var opacity := scale if shown else 0.0
		var stroke_scale := float(style.get("strokeScale", 1.0)) if shown else 0.0
		_style_image.set_pixel(index % COLUMNS, index / COLUMNS, Color(fill_packed, opacity, stroke_packed, stroke_alpha))
		_style_image.set_pixel(index % COLUMNS, index / COLUMNS + _rows, Color(stroke_scale, 0, 0, 0))
	_style_texture.update(_style_image)
	var styled := true
	fill_material.set_shader_parameter("region_style", _style_texture)
	fill_material.set_shader_parameter("styled", styled)
	for material in map_view.extras_border_materials():
		material.set_shader_parameter("region_style", _style_texture)
		material.set_shader_parameter("styled", styled)
		material.set_shader_parameter("style_rows", _rows)


func _load_group_areas() -> void:
	var engine: EngineLink = extras.get("engine")
	if engine == null:
		return
	_group_request += 1
	var ticket := _group_request
	var reply: Dictionary = await engine.request("mapextras.groupAreas")
	if ticket != _group_request or not bool(reply.get("ok", false)) or not (reply.get("result") is Dictionary):
		return
	var result: Dictionary = reply["result"]
	var groups: Array = world.get("groups", [])
	var slot_of := {}
	for slot in range(groups.size()):
		slot_of[str((groups[slot] as Dictionary).get("name", ""))] = slot
	_line_mesh = _build_lines(result.get("outlines", []), slot_of)
	_mount_lines()
	var labels: Array[Dictionary] = []
	for entry in result.get("labels", []):
		if entry is Dictionary:
			labels.append(entry)
	labels.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return int(a.get("regions", 0)) > int(b.get("regions", 0)))
	_labels.set_labels(labels)
	_labels.visible = _has_groups


func _clear_lines() -> void:
	_line_mesh = null
	_mount_lines()
	_labels.set_labels([])


func _mount_lines() -> void:
	for node in _line_nodes:
		if is_instance_valid(node):
			node.queue_free()
	_line_nodes.clear()
	if _line_mesh == null or not _has_groups:
		return
	for slot in extras.call("slots", "top"):
		var holder := Node2D.new()
		for material in [_casing_material, _outline_material]:
			var line := MeshInstance2D.new()
			line.mesh = _line_mesh
			line.material = material
			holder.add_child(line)
		(slot as Node2D).add_child(holder)
		_line_nodes.append(holder)


func _build_lines(outlines: Array, slot_of: Dictionary) -> ArrayMesh:
	var vertices := PackedVector2Array()
	var extrusions := PackedVector2Array()
	var colours := PackedColorArray()
	var indices := PackedInt32Array()
	for outline in outlines:
		if not (outline is Dictionary):
			continue
		var group := int(slot_of.get(str((outline as Dictionary).get("group", "")), 0))
		var tag := float(clampi(group, 0, 255)) / 255.0
		for line in (outline as Dictionary).get("lines", []):
			if not (line is Array) or (line as Array).size() < 2:
				continue
			var points := PackedVector2Array()
			var previous_lon := 0.0
			for coordinate in line:
				if not (coordinate is Array) or (coordinate as Array).size() < 2:
					continue
				var lon := float(coordinate[0])
				if not points.is_empty():
					while lon - previous_lon > 180.0:
						lon -= 360.0
					while lon - previous_lon < -180.0:
						lon += 360.0
				previous_lon = lon
				var world_point := GlobeView.world_of_lonlat(lon, float(coordinate[1]))
				world_point.x = (lon + 180.0) / 360.0 * MapView.WORLD_WIDTH
				if points.is_empty() or points[points.size() - 1].distance_to(world_point) > 0.0001:
					points.append(world_point)
			if points.size() < 2:
				continue
			var base := vertices.size()
			for index in range(points.size()):
				var miter := _miter(points, index)
				vertices.append(points[index])
				vertices.append(points[index])
				extrusions.append(miter)
				extrusions.append(-miter)
				colours.append(Color(tag, 1.0, 0.0, 1.0))
				colours.append(Color(tag, 0.0, 0.0, 1.0))
			for index in range(points.size() - 1):
				var at := base + index * 2
				indices.append_array(PackedInt32Array([at, at + 1, at + 2, at + 2, at + 1, at + 3]))
	if indices.is_empty():
		return null
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_TEX_UV] = extrusions
	arrays[Mesh.ARRAY_COLOR] = colours
	arrays[Mesh.ARRAY_INDEX] = indices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh


static func _miter(points: PackedVector2Array, index: int) -> Vector2:
	var count := points.size()
	var before := (points[index] - points[index - 1]).normalized() if index > 0 else Vector2.ZERO
	var after := (points[index + 1] - points[index]).normalized() if index < count - 1 else Vector2.ZERO
	if before == Vector2.ZERO:
		return Vector2(-after.y, after.x)
	if after == Vector2.ZERO:
		return Vector2(-before.y, before.x)
	var normal_before := Vector2(-before.y, before.x)
	var normal_after := Vector2(-after.y, after.x)
	var join := normal_before + normal_after
	if join.length() < 0.0001:
		return normal_after
	join = join.normalized()
	var scale := 1.0 / maxf(join.dot(normal_after), 0.5)
	return join * scale


class GroupLabels extends Control:
	var map_view: MapView
	var _labels: Array[Dictionary] = []
	var _font: Font

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		_font = UI.font(600)

	func set_labels(labels: Array[Dictionary]) -> void:
		_labels = labels
		queue_redraw()

	func _draw() -> void:
		if not map_view or _labels.is_empty():
			return
		var level := map_view.zoom_level()
		var size := 10.0
		if level <= 2.0:
			size = 10.0
		elif level <= 5.0:
			size = lerpf(10.0, 12.5, (level - 2.0) / 3.0)
		elif level <= 8.0:
			size = lerpf(12.5, 15.0, (level - 5.0) / 3.0)
		else:
			size = 15.0
		var base_size := size
		var view := get_viewport_rect().size
		var taken: Array[Rect2] = []
		var above: Array[Rect2] = []
		for list_name in ["war_label_rects", "city_label_rects", "room_label_rects", "war_marker_rects"]:
			var rects: Variant = map_view.get(list_name)
			if rects is Array:
				for rect: Variant in rects:
					if rect is Rect2:
						above.append(rect)
		for label in _labels:
			var point := GlobeView.world_of_lonlat(float(label.get("lng", 0.0)), float(label.get("lat", 0.0)))
			var screen := map_view.world_to_screen(point)
			if screen.x < -200.0 or screen.y < -100.0 or screen.x > view.x + 200.0 or screen.y > view.y + 100.0:
				continue
			var ratio := map_view.label_perspective(point)
			if ratio < MapView.LABEL_PERSPECTIVE_CUTOFF:
				continue
			size = base_size * ratio
			var font_size := maxi(1, int(roundf(size)))
			var spacing := size * 0.08
			var lines := _wrap(str(label.get("group", "")).to_upper(), font_size, spacing, size * 10.0)
			var line_height := size * 1.2
			var widths: Array[float] = []
			var widest := 0.0
			for line in lines:
				var width := _measure(line, font_size, spacing)
				widths.append(width)
				widest = maxf(widest, width)
			var box := Rect2(screen - Vector2(widest * 0.5, line_height * lines.size() * 0.5), Vector2(widest, line_height * lines.size())).grow(2.0)
			var clash := false
			for other in taken:
				if other.intersects(box):
					clash = true
					break
			if not clash:
				for other in above:
					if other.intersects(box):
						clash = true
						break
			if clash:
				continue
			taken.append(box)
			var colour := Color.from_string(str(label.get("color", "#e11d48")), Color("#e11d48"))
			var halo := Color(5.0 / 255.0, 8.0 / 255.0, 13.0 / 255.0, 0.92)
			for row in range(lines.size()):
				var baseline := Vector2(screen.x - widths[row] * 0.5, box.position.y + line_height * row + line_height * 0.5 + size * 0.35)
				_draw_spaced(lines[row], baseline, font_size, spacing, halo, true)
				_draw_spaced(lines[row], baseline, font_size, spacing, colour, false)

	func _measure(text: String, font_size: int, spacing: float) -> float:
		var width := 0.0
		for index in range(text.length()):
			width += _font.get_string_size(text[index], HORIZONTAL_ALIGNMENT_LEFT, -1, font_size).x + (spacing if index < text.length() - 1 else 0.0)
		return width

	func _draw_spaced(text: String, at: Vector2, font_size: int, spacing: float, colour: Color, outline: bool) -> void:
		var cursor := at
		for index in range(text.length()):
			var glyph := text[index]
			if outline:
				draw_string_outline(_font, cursor, glyph, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size, 3, colour)
			else:
				draw_string(_font, cursor, glyph, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size, colour)
			cursor.x += _font.get_string_size(glyph, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size).x + spacing

	func _wrap(text: String, font_size: int, spacing: float, max_width: float) -> PackedStringArray:
		var words := text.split(" ", false)
		var lines := PackedStringArray()
		var current := ""
		for word in words:
			var candidate := word if current.is_empty() else current + " " + word
			if current.is_empty() or _measure(candidate, font_size, spacing) <= max_width:
				current = candidate
			else:
				lines.append(current)
				current = word
		if not current.is_empty():
			lines.append(current)
		return lines
