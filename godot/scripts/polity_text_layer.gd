class_name PolityTextLayer
extends Control

signal laid_out(info: Dictionary)

const RASTER_FONT_SIZE := 128
const HALO_WIDTH_PX := 5.0
const MSDF_PIXEL_RANGE := 16
const WORLD_WIDTH := 4096.0
const TEXT_COLOR := "rgba(250, 249, 244, 0.995)"
const HALO_COLOR := "rgba(4, 6, 9, 0.96)"
const RASTER_SHADER := """
shader_type canvas_item;
render_mode blend_mix;
uniform vec4 fill_color = vec4(1.0);
uniform vec4 halo_color = vec4(0.0, 0.0, 0.0, 1.0);
uniform float px_range = 16.0;
uniform float halo_px = 5.0;
uniform float max_footprint = 12.0;

float median3(vec3 c) {
	return max(min(c.r, c.g), min(max(c.r, c.g), c.b));
}

vec4 raster_texel(sampler2D atlas, vec2 uv) {
	vec4 s = texture(atlas, uv);
	float body = (min(median3(s.rgb), s.a) - 0.5) * px_range;
	float outer = (s.a - 0.5) * px_range;
	float fill = clamp(body + 0.5, 0.0, 1.0) * fill_color.a;
	float halo = clamp(outer + halo_px + 0.5, 0.0, 1.0) * halo_color.a;
	float alpha = fill + halo * (1.0 - fill);
	vec3 color = alpha > 0.0 ? (fill_color.rgb * fill + halo_color.rgb * halo * (1.0 - fill)) / alpha : vec3(0.0);
	return vec4(color, alpha);
}

void fragment() {
	vec2 texels = 1.0 / TEXTURE_PIXEL_SIZE;
	vec2 dx = dFdx(UV);
	vec2 dy = dFdy(UV);
	float span_x = length(dx * texels);
	float span_y = length(dy * texels);
	if (span_x > max_footprint) {
		dx *= max_footprint / span_x;
		span_x = max_footprint;
	}
	if (span_y > max_footprint) {
		dy *= max_footprint / span_y;
		span_y = max_footprint;
	}
	int taps = int(clamp(ceil(max(span_x, span_y)), 1.0, 4.0));
	vec4 sum = vec4(0.0);
	for (int i = 0; i < taps; i++) {
		for (int j = 0; j < taps; j++) {
			vec2 offset = ((float(i) + 0.5) / float(taps) - 0.5) * dx + ((float(j) + 0.5) / float(taps) - 0.5) * dy;
			sum += raster_texel(TEXTURE, UV + offset);
		}
	}
	COLOR = sum / float(taps * taps);
}
"""
const PROJECTED_SHADER := """
shader_type canvas_item;
render_mode blend_mix, skip_vertex_transform;
uniform vec4 fill_color = vec4(1.0);
uniform vec4 halo_color = vec4(0.0, 0.0, 0.0, 1.0);
uniform float px_range = 16.0;
uniform float halo_px = 5.0;
uniform float max_footprint = 12.0;
uniform vec2 screen_size = vec2(1440.0, 900.0);
uniform vec2 cam_world = vec2(2048.0, 2048.0);
uniform float px_per_world = 1.0;
uniform vec2 flat_right = vec2(1.0, 0.0);
uniform vec2 flat_up = vec2(0.0, -1.0);
uniform float pitch_sin = 0.0;
uniform float pitch_cos = 1.0;
uniform float focal = 1350.0;
uniform float sea_lift = 0.0;
uniform float globeness = 0.0;
uniform vec3 cam_pos = vec3(0.0, 0.0, 4.0);
uniform vec3 cam_right = vec3(1.0, 0.0, 0.0);
uniform vec3 cam_up = vec3(0.0, 1.0, 0.0);
uniform vec3 cam_fwd = vec3(0.0, 0.0, -1.0);
uniform float radius_px = 400.0;
uniform float world_width = 4096.0;
uniform float near_depth = 18.0;
uniform float far_depth = 100000.0;
uniform bool depth_clip = true;
uniform bool wrap_glyphs = false;

varying vec3 persp;
varying float keep;

const float PI_F = 3.14159265358979;

vec3 dir_of_world(vec2 w) {
	float lon = (w.x / world_width - 0.5) * 2.0 * PI_F;
	float lat = atan(sinh(PI_F * (1.0 - 2.0 * w.y / world_width)));
	float c = cos(lat);
	return vec3(sin(lon) * c, sin(lat), cos(lon) * c);
}

vec3 eye_of(vec2 w) {
	vec2 d = (w - cam_world) * px_per_world;
	float a = dot(d, flat_right);
	float v = dot(d, flat_up);
	vec3 flat_c = vec3(a, v * pitch_cos + sea_lift * pitch_sin, focal + v * pitch_sin - sea_lift * pitch_cos);
	if (globeness <= 0.0) {
		return flat_c;
	}
	vec3 q = dir_of_world(w) - cam_pos;
	return mix(flat_c, vec3(dot(q, cam_right), dot(q, cam_up), dot(q, cam_fwd)) * radius_px, globeness);
}

float keep_of(vec2 w, float depth) {
	if (depth_clip) {
		float ndc = (far_depth + near_depth) / (far_depth - near_depth) - 2.0 * far_depth * near_depth / ((far_depth - near_depth) * depth);
		return min(1.0 - ndc, 1.0 + ndc);
	}
	if (globeness <= 0.0) {
		return 1.0;
	}
	vec3 p = dir_of_world(w);
	float plane = (dot(p, cam_pos) - 1.0) / length(cam_pos);
	if (globeness >= 0.999) {
		return plane;
	}
	float share = clamp((globeness - 0.2) / 0.8, 0.0, 1.0);
	float globe_depth = dot(p - cam_pos, cam_fwd) * radius_px;
	return 1.0 - share * (1.0 - plane) * globe_depth / depth;
}

void vertex() {
	vec2 anchor = (MODEL_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xy;
	vec2 world = (MODEL_MATRIX * vec4(VERTEX, 0.0, 1.0)).xy;
	if (wrap_glyphs) {
		float shift = world_width * round((cam_world.x - anchor.x) / world_width);
		anchor.x += shift;
		world.x += shift;
	}
	vec3 held = eye_of(anchor);
	vec3 eye = eye_of(world);
	if (held.z <= near_depth) {
		VERTEX = vec2(-100000.0, -100000.0);
		persp = vec3(0.0, 0.0, 1.0);
		keep = -1.0;
	} else {
		float depth = max(eye.z, near_depth * 0.5);
		float q = focal / depth;
		VERTEX = vec2(screen_size.x * 0.5 + eye.x * q, screen_size.y * 0.5 - eye.y * q);
		persp = vec3(UV * q, q);
		keep = keep_of(world, depth);
	}
}

float median3(vec3 c) {
	return max(min(c.r, c.g), min(max(c.r, c.g), c.b));
}

vec4 raster_texel(sampler2D atlas, vec2 uv) {
	vec4 s = texture(atlas, uv);
	float body = (min(median3(s.rgb), s.a) - 0.5) * px_range;
	float outer = (s.a - 0.5) * px_range;
	float fill = clamp(body + 0.5, 0.0, 1.0) * fill_color.a;
	float halo = clamp(outer + halo_px + 0.5, 0.0, 1.0) * halo_color.a;
	float alpha = fill + halo * (1.0 - fill);
	vec3 color = alpha > 0.0 ? (fill_color.rgb * fill + halo_color.rgb * halo * (1.0 - fill)) / alpha : vec3(0.0);
	return vec4(color, alpha);
}

void fragment() {
	vec2 uv = persp.xy / persp.z;
	vec2 texels = 1.0 / TEXTURE_PIXEL_SIZE;
	vec2 dx = dFdx(uv);
	vec2 dy = dFdy(uv);
	if (keep < 0.0) {
		discard;
	}
	float span_x = length(dx * texels);
	float span_y = length(dy * texels);
	if (span_x > max_footprint) {
		dx *= max_footprint / span_x;
		span_x = max_footprint;
	}
	if (span_y > max_footprint) {
		dy *= max_footprint / span_y;
		span_y = max_footprint;
	}
	int taps = int(clamp(ceil(max(span_x, span_y)), 1.0, 4.0));
	vec4 sum = vec4(0.0);
	for (int i = 0; i < taps; i++) {
		for (int j = 0; j < taps; j++) {
			vec2 offset = ((float(i) + 0.5) / float(taps) - 0.5) * dx + ((float(j) + 0.5) / float(taps) - 0.5) * dy;
			sum += raster_texel(TEXTURE, uv + offset);
		}
	}
	COLOR = sum / float(taps * taps);
}
"""

var map: MapView
var engine: EngineLink
var revision := 0
var label_count := 0
var last_error := ""
var _token := ""
var _families := PackedStringArray()
var _measure_font: SystemFont
var _draw_font: SystemFont
var _retired_fonts: Array[SystemFont] = []
var _measures := {}
var _labels: Array[Dictionary] = []
var _fill := Color(250 / 255.0, 249 / 255.0, 244 / 255.0, 0.995)
var _halo := Color(4 / 255.0, 6 / 255.0, 9 / 255.0, 0.96)
var _hidden := false
var _running := false
var _again := false
var _material: ShaderMaterial
var _direct: Painter
var _groups: Array[CanvasGroup] = []
var _group_painters: Array[Painter] = []
var _states := PackedInt32Array()
var _copies: Array[float] = []
var _fade_keys: Array = []
var _extent := Vector2.ZERO
var _projected_material: ShaderMaterial
var _projected := false
var _projected_rect := Rect2()
var _projected_wrap := false


class Painter extends Node2D:
	var layer: PolityTextLayer
	var items: Array[int] = []
	var copies: Array[float] = []

	func _draw() -> void:
		if layer and not items.is_empty():
			layer.paint(self, items, copies)


func _init() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var shader := Shader.new()
	shader.code = RASTER_SHADER
	_material = ShaderMaterial.new()
	_material.shader = shader
	_material.set_shader_parameter("px_range", float(MSDF_PIXEL_RANGE))
	_material.set_shader_parameter("halo_px", HALO_WIDTH_PX)
	var projected_shader := Shader.new()
	projected_shader.code = PROJECTED_SHADER
	_projected_material = ShaderMaterial.new()
	_projected_material.shader = projected_shader
	_projected_material.set_shader_parameter("px_range", float(MSDF_PIXEL_RANGE))
	_projected_material.set_shader_parameter("halo_px", HALO_WIDTH_PX)
	_apply_colors()
	_direct = _painter()
	add_child(_direct)


func _painter() -> Painter:
	var painter := Painter.new()
	painter.layer = self
	painter.material = _projected_material if _projected else _material
	painter.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
	return painter


func _apply_colors() -> void:
	for material: ShaderMaterial in [_material, _projected_material]:
		material.set_shader_parameter("fill_color", Vector4(_fill.r, _fill.g, _fill.b, _fill.a))
		material.set_shader_parameter("halo_color", Vector4(_halo.r, _halo.g, _halo.b, _halo.a))


func setup(map_view: MapView, link: EngineLink) -> void:
	map = map_view
	engine = link


func refresh() -> void:
	if not engine or not map:
		return
	if _running:
		_again = true
		return
	_running = true
	var passes := 0
	while passes < 8:
		passes += 1
		_again = false
		await _refresh_once()
		if not _again or not is_inside_tree():
			break
	_running = false


func busy() -> bool:
	return _running


func clear() -> void:
	_labels = []
	label_count = 0
	_token = ""
	_states = PackedInt32Array([-1])
	update_view()


func _refresh_once() -> void:
	var reply: Dictionary = await engine.request("labels.records")
	if not bool(reply.get("ok", false)):
		last_error = str(reply.get("error", ""))
		push_warning("The map's names could not be read: %s" % last_error)
		return
	var result: Dictionary = reply.get("result", {})
	_hidden = bool(result.get("hidden", false))
	var fill := css_color(str(result.get("textColor", TEXT_COLOR)), css_color(TEXT_COLOR, Color.WHITE))
	var halo := css_color(str(result.get("haloColor", HALO_COLOR)), css_color(HALO_COLOR, Color.BLACK))
	if fill != _fill or halo != _halo:
		_fill = fill
		_halo = halo
		_apply_colors()
	var families := PackedStringArray()
	for family: Variant in result.get("fontFamilies", ["Georgia"]):
		families.append(str(family))
	var fonts_changed := _set_fonts(families)
	var token := str(result.get("token", ""))
	if token == _token and not fonts_changed and not _labels.is_empty():
		update_view()
		return
	var metrics := {}
	for item: Variant in result.get("records", []):
		var record: Dictionary = item
		var key := str(record.get("measureKey", ""))
		if key.is_empty():
			continue
		if not _measures.has(key):
			_measures[key] = _measure(str(record.get("text", "")), float(record.get("letterSpacingEm", 0.0)))
		var measured: Dictionary = _measures[key]
		metrics[key] = [measured["width"], measured["ascent"], measured["descent"]]
	var laid: Dictionary = await engine.request("labels.layout", {"metrics": metrics})
	if not bool(laid.get("ok", false)):
		last_error = str(laid.get("error", ""))
		push_warning("The map's names could not be laid out: %s" % last_error)
		return
	var layout: Dictionary = laid.get("result", {})
	var built: Array[Dictionary] = []
	for item: Variant in layout.get("entries", []):
		var label := _build(item as Dictionary)
		if not label.is_empty():
			built.append(label)
	built.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return float(a["priority"]) < float(b["priority"]))
	var extent := Vector2(INF, -INF)
	for label in built:
		var bounds: Rect2 = label["bounds"]
		extent = Vector2(minf(extent.x, bounds.position.x), maxf(extent.y, bounds.end.x))
	_labels = built
	_extent = extent if extent.x <= extent.y else Vector2.ZERO
	_states = PackedInt32Array([-1])
	_token = token
	revision += 1
	label_count = _labels.size()
	last_error = ""
	update_view()
	_retired_fonts.clear()
	laid_out.emit({"revision": revision, "labels": label_count, "solved": int(layout.get("solved", 0))})


func _set_fonts(families: PackedStringArray) -> bool:
	if families == _families and _draw_font != null:
		return false
	if _draw_font != null:
		_retired_fonts.append(_draw_font)
		_retired_fonts.append(_measure_font)
	_families = families
	_measure_font = SystemFont.new()
	_measure_font.font_names = families
	_measure_font.font_weight = 400
	_measure_font.font_italic = false
	_measure_font.hinting = TextServer.HINTING_NONE
	_measure_font.subpixel_positioning = TextServer.SUBPIXEL_POSITIONING_DISABLED
	_measure_font.antialiasing = TextServer.FONT_ANTIALIASING_GRAY
	_draw_font = SystemFont.new()
	_draw_font.font_names = families
	_draw_font.font_weight = 400
	_draw_font.font_italic = false
	_draw_font.hinting = TextServer.HINTING_NONE
	_draw_font.multichannel_signed_distance_field = true
	_draw_font.msdf_size = 128
	_draw_font.msdf_pixel_range = MSDF_PIXEL_RANGE
	_draw_font.generate_mipmaps = false
	_measures.clear()
	return true


func _shaped(text: String, font: Font) -> Array:
	var line := TextLine.new()
	line.add_string(text, font, RASTER_FONT_SIZE)
	var ts := TextServerManager.get_primary_interface()
	return ts.shaped_text_get_glyphs(line.get_rid())


func _measure(text: String, spacing_em: float) -> Dictionary:
	var ts := TextServerManager.get_primary_interface()
	var value := text.strip_edges()
	var drawn := _shaped(value, _draw_font)
	var probed := _shaped(value, _measure_font)
	var paired := drawn.size() == probed.size()
	var spacing := maxf(0.0, spacing_em) * RASTER_FONT_SIZE
	var pen := 0.0
	var top := INF
	var bottom := -INF
	var glyphs: Array[Dictionary] = []
	for index in range(drawn.size()):
		var draw_glyph: Dictionary = drawn[index]
		var probe_glyph: Dictionary = probed[index] if paired else draw_glyph
		var offset: Vector2 = probe_glyph.get("offset", Vector2.ZERO)
		var advance := float(probe_glyph.get("advance", 0.0))
		var glyph_index := int(probe_glyph.get("index", 0))
		var contours: Dictionary = ts.font_get_glyph_contours(probe_glyph["font_rid"], RASTER_FONT_SIZE, glyph_index)
		var points: PackedVector3Array = contours.get("points", PackedVector3Array())
		var left := INF
		var right := -INF
		for point in points:
			left = minf(left, point.x)
			right = maxf(right, point.x)
			top = minf(top, point.y + offset.y)
			bottom = maxf(bottom, point.y + offset.y)
		var center := (left + right) * 0.5 if left <= right else advance * 0.5
		if not points.is_empty():
			glyphs.append({
				"rid": draw_glyph["font_rid"],
				"index": int(draw_glyph.get("index", 0)),
				"pen": pen + offset.x,
				"lift": offset.y,
				"center": center,
			})
		pen += advance
		var last_in_cluster := index == drawn.size() - 1 or int((drawn[index + 1] as Dictionary).get("start", -1)) != int(draw_glyph.get("start", -2))
		if last_in_cluster:
			pen += spacing
	return {
		"width": pen,
		"ascent": -top if top < INF else 0.0,
		"descent": bottom if bottom > -INF else 0.0,
		"glyphs": glyphs,
	}


func _build(entry: Dictionary) -> Dictionary:
	var key := str(entry.get("measureKey", ""))
	if not _measures.has(key):
		return {}
	var measured: Dictionary = _measures[key]
	var raster: Dictionary = entry.get("raster", {})
	var width := float(raster.get("width", 0.0))
	var height := float(raster.get("height", 0.0))
	var padding := float(raster.get("paddingPx", 0.0))
	var ascent := float(raster.get("ascent", 0.0))
	var flat: Array = entry.get("points", [])
	var count := flat.size() / 2
	if count < 2 or width <= 0.0 or height <= 0.0:
		return {}
	var points := PackedVector2Array()
	points.resize(count)
	for index in range(count):
		points[index] = Vector2(float(flat[index * 2]), float(flat[index * 2 + 1])) * WORLD_WIDTH
	var cumulative := PackedFloat64Array()
	cumulative.resize(count)
	var total := 0.0
	for index in range(1, count):
		total += points[index].distance_to(points[index - 1])
		cumulative[index] = total
	if total <= 0.0:
		return {}
	var normals := PackedVector2Array()
	normals.resize(count)
	for index in range(count):
		var tangent := points[mini(count - 1, index + 1)] - points[maxi(0, index - 1)]
		var length := tangent.length()
		tangent = tangent / length if length > 0.0 else Vector2.RIGHT
		normals[index] = Vector2(tangent.y, -tangent.x)
	var scale := total / width
	var half_height := height * 0.5 * scale
	var min_point := Vector2(INF, INF)
	var max_point := Vector2(-INF, -INF)
	for index in range(count):
		for side: float in [-1.0, 1.0]:
			var edge := points[index] + normals[index] * half_height * side
			min_point = min_point.min(edge)
			max_point = max_point.max(edge)
	var lift := (height * 0.5 - (padding + ascent)) * scale
	var anchors := PackedVector2Array()
	var angles := PackedFloat32Array()
	var offsets := PackedVector2Array()
	var indices := PackedInt32Array()
	var rids: Array[RID] = []
	var segment := 1
	for item: Dictionary in measured["glyphs"]:
		var pen_x := padding + float(item["pen"])
		var center_x := pen_x + float(item["center"])
		var along := clampf(center_x / width, 0.0, 1.0) * total
		while segment < count - 1 and cumulative[segment] < along:
			segment += 1
		var start := segment - 1
		var span := cumulative[segment] - cumulative[start]
		var t := clampf((along - cumulative[start]) / span, 0.0, 1.0) if span > 0.0 else 0.0
		var point := points[start].lerp(points[segment], t)
		var normal := normals[start].lerp(normals[segment], t)
		anchors.append(point + normal * lift)
		angles.append(atan2(normal.x, -normal.y))
		offsets.append(Vector2(pen_x - center_x, float(item["lift"])))
		indices.append(int(item["index"]))
		rids.append(item["rid"])
	return {
		"owner": str(entry.get("owner", "")),
		"text": str(entry.get("text", "")),
		"min_zoom": float(entry.get("minZoom", 0.0)),
		"max_zoom": float(entry.get("maxZoom", 6.2)),
		"fade_in": float(entry.get("fadeInZoomSpan", 0.18)),
		"fade_out_start": float(entry.get("fadeOutStartZoom", 5.0)),
		"fade_key": "%s|%s|%s|%s" % [entry.get("minZoom", 0.0), entry.get("maxZoom", 6.2), entry.get("fadeInZoomSpan", 0.18), entry.get("fadeOutStartZoom", 5.0)],
		"priority": float(entry.get("priorityScale", 0.0)),
		"font_px_z4": float(entry.get("effectiveFontPxAtZoom4", 0.0)),
		"ascent": float(measured["ascent"]),
		"scale": scale,
		"bounds": Rect2(min_point, max_point - min_point),
		"center_x": (min_point.x + max_point.x) * 0.5,
		"support": points,
		"anchors": anchors,
		"angles": angles,
		"offsets": offsets,
		"indices": indices,
		"rids": rids,
	}


static func smooth(value: float) -> float:
	var t := clampf(value, 0.0, 1.0)
	return t * t * (3.0 - 2.0 * t)


static func opacity_at(zoom: float, min_zoom: float, max_zoom: float, fade_in: float, fade_out_start: float) -> float:
	if zoom < min_zoom or zoom > max_zoom:
		return 0.0
	var span := maxf(0.0, fade_in)
	var out_start := minf(max_zoom, fade_out_start)
	var opacity := 1.0
	if span > 0.0 and zoom < min_zoom + span:
		opacity *= smooth((zoom - min_zoom) / span)
	if max_zoom > out_start and zoom > out_start:
		opacity *= 1.0 - smooth((zoom - out_start) / (max_zoom - out_start))
	return clampf(opacity, 0.0, 1.0)


func update_view() -> void:
	var states := PackedInt32Array()
	states.resize(_labels.size())
	var fading := {}
	var alphas := {}
	var direct: Array[int] = []
	var copies: Array[float] = []
	if map and not _hidden and not _labels.is_empty():
		var level := map.zoom_level()
		for index in range(_labels.size()):
			var label := _labels[index]
			var opacity := opacity_at(level, float(label["min_zoom"]), float(label["max_zoom"]), float(label["fade_in"]), float(label["fade_out_start"]))
			if opacity <= 0.002:
				continue
			if opacity >= 1.0:
				states[index] = 1
				direct.append(index)
				continue
			var key: String = label["fade_key"]
			states[index] = 2
			if not fading.has(key):
				fading[key] = [] as Array[int]
				alphas[key] = opacity
			(fading[key] as Array[int]).append(index)
		copies = _projected_copies() if _projected else _copies_in_view()
	if states != _states or copies != _copies or fading.keys() != _fade_keys:
		_states = states
		_copies = copies
		_fade_keys = fading.keys()
		_assign(fading, direct, copies)
	for index in range(_groups.size()):
		if index < _fade_keys.size():
			_groups[index].self_modulate = Color(1, 1, 1, float(alphas[_fade_keys[index]]))
	_follow_camera()


func _copies_in_view() -> Array[float]:
	var copies: Array[float] = []
	var zoom := map.camera.zoom.x
	var half_width := map.get_viewport_rect().size.x * 0.5 / zoom
	var left := map.camera.position.x - half_width
	var right := map.camera.position.x + half_width
	for step in range(-2, 3):
		var offset := step * WORLD_WIDTH
		if _extent.x + offset <= right and _extent.y + offset >= left:
			copies.append(offset)
	return copies


func _projected_copies() -> Array[float]:
	var copies: Array[float] = []
	if _projected_wrap:
		copies.append(0.0)
		return copies
	for step in range(-2, 3):
		var offset := step * WORLD_WIDTH
		if _extent.x + offset <= _projected_rect.end.x and _extent.y + offset >= _projected_rect.position.x:
			copies.append(offset)
	return copies


func _follow_camera() -> void:
	if not map:
		return
	if _projected:
		var screen := Rect2(Vector2.ZERO, map.get_viewport_rect().size)
		for painter: Painter in _all_painters():
			painter.transform = Transform2D.IDENTITY
			RenderingServer.canvas_item_set_custom_rect(painter.get_canvas_item(), true, screen)
		return
	var zoom := map.camera.zoom.x
	var follow := Transform2D(0.0, Vector2(zoom, zoom), 0.0, map.get_viewport_rect().size * 0.5 - map.camera.position * zoom)
	_direct.transform = follow
	for painter in _group_painters:
		painter.transform = follow


func _all_painters() -> Array[Painter]:
	var painters: Array[Painter] = [_direct]
	painters.append_array(_group_painters)
	return painters


func projected() -> bool:
	return _projected


func project(uniforms: Dictionary, rect: Rect2, wrap: bool) -> void:
	for key: String in uniforms:
		_projected_material.set_shader_parameter(key, uniforms[key])
	_projected_material.set_shader_parameter("wrap_glyphs", wrap)
	_projected_rect = rect
	_projected_wrap = wrap
	if not _projected:
		_projected = true
		for painter: Painter in _all_painters():
			painter.material = _projected_material
	update_view()


func unproject() -> void:
	if not _projected:
		return
	_projected = false
	for painter: Painter in _all_painters():
		painter.material = _material
		RenderingServer.canvas_item_set_custom_rect(painter.get_canvas_item(), false)
		painter.queue_redraw()
	update_view()


func projected_items() -> int:
	if not _projected or not is_visible_in_tree():
		return 0
	var total := _direct.items.size() * _direct.copies.size()
	for index in range(_groups.size()):
		if _groups[index].visible:
			total += _group_painters[index].items.size() * _group_painters[index].copies.size()
	return total


func _assign(fading: Dictionary, direct: Array[int], copies: Array[float]) -> void:
	var keys: Array = fading.keys()
	while _groups.size() < keys.size():
		var group := CanvasGroup.new()
		var painter := _painter()
		group.add_child(painter)
		add_child(group)
		move_child(_direct, -1)
		_groups.append(group)
		_group_painters.append(painter)
	for index in range(_groups.size()):
		var group := _groups[index]
		var painter := _group_painters[index]
		painter.copies = copies
		if index < keys.size():
			group.visible = true
			painter.items = fading[keys[index]]
		else:
			group.visible = false
			painter.items = [] as Array[int]
		painter.queue_redraw()
	_direct.copies = copies
	_direct.items = direct
	_direct.queue_redraw()


func paint(canvas: Node2D, items: Array[int], copies: Array[float]) -> void:
	var ts := TextServerManager.get_primary_interface()
	var item_rid := canvas.get_canvas_item()
	for copy in copies:
		var shift := Vector2(copy, 0.0)
		for item in items:
			var label := _labels[item]
			var anchors: PackedVector2Array = label["anchors"]
			var angles: PackedFloat32Array = label["angles"]
			var offsets: PackedVector2Array = label["offsets"]
			var indices: PackedInt32Array = label["indices"]
			var rids: Array[RID] = label["rids"]
			var size := float(label["scale"])
			var scale := Vector2(size, size)
			for index in range(anchors.size()):
				canvas.draw_set_transform(anchors[index] + shift, angles[index], scale)
				ts.font_draw_glyph(rids[index], item_rid, RASTER_FONT_SIZE, offsets[index], indices[index], Color.WHITE)
	canvas.draw_set_transform_matrix(Transform2D.IDENTITY)


func measures_snapshot() -> Dictionary:
	var snapshot := {}
	for key: String in _measures:
		var measured: Dictionary = _measures[key]
		snapshot[key] = [measured["width"], measured["ascent"], measured["descent"]]
	return snapshot


func labels_snapshot() -> Array[Dictionary]:
	var snapshot: Array[Dictionary] = []
	for label in _labels:
		snapshot.append({
			"owner": label["owner"],
			"text": label["text"],
			"min_zoom": label["min_zoom"],
			"priority": label["priority"],
			"font_px_z4": label["font_px_z4"],
			"bounds": label["bounds"],
			"glyphs": (label["anchors"] as PackedVector2Array).size(),
			"centres": _ink_centres(label),
			"glyph_height": float(label["ascent"]) * float(label["scale"]),
		})
	return snapshot


static func _ink_centres(label: Dictionary) -> PackedVector2Array:
	var anchors: PackedVector2Array = label["anchors"]
	var angles: PackedFloat32Array = label["angles"]
	var offsets: PackedVector2Array = label["offsets"]
	var size := float(label["scale"])
	var centres := PackedVector2Array()
	for index in range(anchors.size()):
		var local := Vector2(0.0, offsets[index].y - float(label["ascent"]) * 0.5)
		centres.append(anchors[index] + local.rotated(angles[index]) * size)
	return centres


static func css_color(text: String, fallback: Color) -> Color:
	var value := text.strip_edges().to_lower()
	if value.is_empty():
		return fallback
	if value.begins_with("rgb"):
		var open := value.find("(")
		var close := value.rfind(")")
		if open < 0 or close <= open:
			return fallback
		var parts := value.substr(open + 1, close - open - 1).replace(",", " ").replace("/", " ").split(" ", false)
		if parts.size() < 3:
			return fallback
		var channels: Array[float] = []
		for index in range(mini(parts.size(), 4)):
			var part := parts[index].strip_edges()
			var number := part.trim_suffix("%").to_float()
			if part.ends_with("%"):
				number = number / 100.0 * (255.0 if index < 3 else 1.0)
			channels.append(number)
		var alpha := clampf(channels[3], 0.0, 1.0) if channels.size() > 3 else 1.0
		return Color(clampf(channels[0], 0.0, 255.0) / 255.0, clampf(channels[1], 0.0, 255.0) / 255.0, clampf(channels[2], 0.0, 255.0) / 255.0, alpha)
	return Color.from_string(value, fallback)
