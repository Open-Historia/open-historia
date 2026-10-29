class_name Basemap
extends Node2D

signal loading_changed(loading: bool)

const ESRI_URL := "https://server.arcgisonline.com/ArcGIS/rest/services/%s/MapServer/tile/%d/%d/%d"
const ETOPO_URL := "https://tiles.arcgis.com/tiles/C8EMgrsFcRFL6LrL/arcgis/rest/services/ETOPO1_Global_Relief_Model_Color_Shaded_Relief/MapServer/tile/%d/%d/%d"
const NATGEO_PHYSICAL_URL := "https://services.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/%d/%d/%d"
const TERRARIUM_URL := "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/%d/%d/%d.png"
const MAX_ZOOM := 13
const LAND_BUDGET_USEC := 3000
const MAX_REQUESTS := 6
const KEEP_TEXTURES := 320
const EVICT_SLACK := 64
const PLACEHOLDER_MIN_ZOOM := 9
const DEFAULT_ID := "ocean"
const BASE_GREY := Color8(11, 16, 23)
const CUSTOM_SEA := Color8(11, 26, 43)
const COVER_FOV_DEG := 36.86989764584402
const COVER_MAX_ZOOM_LEVELS := 9.314
const COVER_TILE_COUNT_RATIO := 3.0
const COVER_MAX_ZOOM := 24
const MAX_MERCATOR_HORIZON_ANGLE := 89.25

const SERVICES := {
	"atlas-relief": ["Ocean/World_Ocean_Base", 13],
	"atlas-relief-dark": ["Ocean/World_Ocean_Base", 13],
	"midnight-terrain": ["World_Terrain_Base", 13],
	"imagery": ["World_Imagery", 19],
	"streets": ["World_Street_Map", 19],
	"topo": ["World_Topo_Map", 19],
	"terrain": ["World_Terrain_Base", 13],
	"shaded": ["World_Shaded_Relief", 13],
	"physical": ["World_Physical_Map", 8],
	"natgeo": ["NatGeo_World_Map", 16],
	"natgeo-dark": ["NatGeo_World_Map", 16],
	"ocean": ["Ocean/World_Ocean_Base", 13],
	"ocean-dark": ["Ocean/World_Ocean_Base", 13],
	"light-gray": ["Canvas/World_Light_Gray_Base", 16],
	"dark-gray": ["Canvas/World_Dark_Gray_Base", 16],
}

const PAINTS := {
	"satellite": {"saturation": -0.08, "contrast": 0.02, "low": 0.04, "high": 0.72},
	"atlas": {"saturation": 0.08, "contrast": 0.20, "low": 0.05, "high": 0.98},
	"world_relief": {"saturation": -0.26, "contrast": 0.36, "low": 0.015, "high": 0.68, "ramp": [[0.0, 1.0], [3.0, 1.0], [3.5, 0.78], [4.0, 0.42], [4.45, 0.16], [4.85, 0.0]]},
	"offline_relief": {"saturation": -0.26, "contrast": 0.36, "low": 0.015, "high": 0.68, "ramp": [[0.0, 1.0], [5.0, 1.0], [8.0, 0.55]]},
	"relief_terrain": {"saturation": 0.18, "contrast": 0.38, "low": 0.025, "high": 0.92, "ramp": [[0.0, 0.0], [2.75, 0.04], [3.2, 0.18], [3.65, 0.52], [4.1, 0.78], [4.6, 0.90], [7.0, 0.92], [12.0, 0.92]]},
	"ocean_dark_world": {"hue": 34.0, "saturation": -0.34, "contrast": 0.64, "low": 0.0, "high": 0.30, "ramp": [[0.0, 0.86], [3.0, 0.86], [3.5, 0.68], [4.0, 0.36], [4.45, 0.14], [4.85, 0.0]]},
	"ocean_dark_terrain": {"hue": 34.0, "saturation": 0.06, "contrast": 0.62, "low": 0.0, "high": 0.39, "ramp": [[0.0, 0.0], [2.75, 0.03], [3.2, 0.14], [3.65, 0.38], [4.1, 0.58], [4.6, 0.67], [7.0, 0.68], [12.0, 0.68]]},
	"atlas_dark_world": {"saturation": -0.82, "contrast": 0.68, "low": 0.0, "high": 0.22, "ramp": [[0.0, 0.82], [3.0, 0.82], [3.5, 0.62], [4.0, 0.30], [4.45, 0.10], [4.85, 0.0]]},
	"atlas_dark_terrain": {"saturation": -0.80, "contrast": 0.70, "low": 0.0, "high": 0.27, "ramp": [[0.0, 0.0], [2.75, 0.04], [3.2, 0.16], [3.65, 0.42], [4.1, 0.60], [4.6, 0.66], [12.0, 0.66]]},
	"midnight_world": {"saturation": -0.96, "contrast": 0.30, "low": 0.0, "high": 0.16, "ramp": [[0.0, 0.82], [3.0, 0.82], [3.5, 0.66], [4.0, 0.38], [4.45, 0.15], [4.85, 0.0]]},
	"midnight_terrain": {"saturation": -0.92, "contrast": 0.38, "low": 0.0, "high": 0.20, "ramp": [[0.0, 0.0], [2.75, 0.02], [3.2, 0.11], [3.65, 0.34], [4.1, 0.54], [4.6, 0.66], [5.4, 0.70], [6.5, 0.74], [8.0, 0.76], [12.0, 0.78]]},
	"natgeo_physical": {"hue": -4.0, "saturation": -0.18, "contrast": 0.40, "low": 0.01, "high": 0.46, "ramp": [[0.0, 0.92], [3.5, 0.90], [5.5, 0.84], [7.5, 0.68], [9.0, 0.34], [10.5, 0.10], [11.5, 0.0]]},
	"plain": {},
}

const GRADE_SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform float saturation_factor = 0.0;
uniform float contrast_factor = 1.0;
uniform float brightness_low = 0.0;
uniform float brightness_high = 1.0;
uniform vec3 spin = vec3(1.0, 0.0, 0.0);
uniform float opacity = 1.0;
uniform bool graded = true;
void fragment() {
	vec4 c = texture(TEXTURE, UV);
	if (!graded) {
		COLOR = vec4(c.rgb, c.a * opacity);
	} else {
		vec3 rgb = vec3(dot(c.rgb, spin.xyz), dot(c.rgb, spin.zxy), dot(c.rgb, spin.yzx));
		float average = (c.r + c.g + c.b) / 3.0;
		rgb += (average - rgb) * saturation_factor;
		rgb = (rgb - 0.5) * contrast_factor + 0.5;
		rgb = mix(vec3(brightness_low), vec3(brightness_high), rgb);
		COLOR = vec4(clamp(rgb, 0.0, 1.0), c.a * opacity);
	}
}
"""

const HILLSHADE_SHADER := """
shader_type canvas_item;
render_mode unshaded, blend_premul_alpha;
uniform float dem_zoom = 5.0;
uniform vec2 latrange = vec2(0.0, 0.0);
uniform float intensity = 0.1;
uniform float azimuth_radians = 5.846852994181004;
const float PI_F = 3.141592653589793;
float elevation(sampler2D dem, ivec2 at) {
	ivec2 size = textureSize(dem, 0);
	ivec2 clamped = clamp(at, ivec2(0), size - ivec2(1));
	vec3 rgb = texelFetch(dem, clamped, 0).rgb * 255.0;
	return rgb.r * 256.0 + rgb.g + rgb.b / 256.0 - 32768.0;
}
vec2 slope_at(sampler2D dem, ivec2 at) {
	float a = elevation(dem, at + ivec2(-1, -1));
	float b = elevation(dem, at + ivec2(0, -1));
	float c = elevation(dem, at + ivec2(1, -1));
	float d = elevation(dem, at + ivec2(-1, 0));
	float f = elevation(dem, at + ivec2(1, 0));
	float g = elevation(dem, at + ivec2(-1, 1));
	float h = elevation(dem, at + ivec2(0, 1));
	float i = elevation(dem, at + ivec2(1, 1));
	float factor = dem_zoom < 2.0 ? 0.4 : (dem_zoom < 4.5 ? 0.35 : 0.3);
	float exaggeration = dem_zoom < 15.0 ? (dem_zoom - 15.0) * factor : 0.0;
	float tile_size = float(textureSize(dem, 0).x);
	vec2 deriv = vec2((c + f + f + i) - (a + d + d + g), (g + h + h + i) - (a + b + b + c)) * tile_size / pow(2.0, exaggeration + (28.2562 - dem_zoom));
	vec2 stored = clamp(deriv / 8.0 + 0.5, 0.0, 1.0);
	return floor(stored * 255.0 + 0.5) / 255.0;
}
void fragment() {
	vec2 size = vec2(textureSize(TEXTURE, 0));
	vec2 p = UV * size - 0.5;
	ivec2 base = ivec2(floor(p));
	vec2 t = fract(p);
	vec2 s00 = slope_at(TEXTURE, base);
	vec2 s10 = slope_at(TEXTURE, base + ivec2(1, 0));
	vec2 s01 = slope_at(TEXTURE, base + ivec2(0, 1));
	vec2 s11 = slope_at(TEXTURE, base + ivec2(1, 1));
	vec2 rg = mix(mix(s00, s10, t.x), mix(s01, s11, t.x), t.y);
	float scale_factor = cos(radians((latrange.x - latrange.y) * (1.0 - UV.y) + latrange.y));
	vec2 deriv = ((rg * 8.0) - 4.0) / scale_factor;
	float azimuth = azimuth_radians + PI_F;
	float slope = atan(0.625 * length(deriv));
	float aspect = deriv.x != 0.0 ? atan(deriv.y, -deriv.x) : PI_F / 2.0 * (deriv.y > 0.0 ? 1.0 : -1.0);
	float base_value = 1.875 - intensity * 1.75;
	float max_value = 0.5 * PI_F;
	float scaled = intensity != 0.5 ? ((pow(base_value, slope) - 1.0) / (pow(base_value, max_value) - 1.0)) * max_value : slope;
	float accent = cos(scaled);
	vec4 accent_color = (1.0 - accent) * vec4(0.0, 0.0, 0.0, 1.0) * clamp(intensity * 2.0, 0.0, 1.0);
	float shade = abs(mod((aspect + azimuth) / PI_F + 0.5, 2.0) - 1.0);
	vec4 shade_color = mix(vec4(0.0, 0.0, 0.0, 1.0), vec4(1.0, 1.0, 1.0, 1.0), shade) * sin(scaled) * clamp(intensity * 2.0, 0.0, 1.0);
	COLOR = accent_color * (1.0 - shade_color.a) + shade_color;
}
"""

const VECTOR_SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform sampler2D fills : filter_nearest;
uniform int columns = 1024;
varying vec4 tint;
void vertex() {
	int region = int(UV.x + 0.5);
	tint = texelFetch(fills, ivec2(region % columns, region / columns), 0);
}
void fragment() {
	COLOR = tint;
}
"""

const VECTOR_LINE_SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform float pixel_world = 1.0;
varying float edge;
varying float outset;
void vertex() {
	vec2 offset = COLOR.rg * 2.0 - 1.0;
	edge = COLOR.b * 2.0 - 1.0;
	outset = 0.2 + 0.5;
	VERTEX += offset * outset * pixel_world;
	edge *= outset;
}
void fragment() {
	float coverage = clamp(outset - abs(edge), 0.0, 1.0);
	COLOR = vec4(0.0, 0.0, 0.0, 0.18 * coverage);
}
"""

var world_width := 4096.0
var cache_dir := ""
var style: Dictionary = {}
var _engine: EngineLink
var _layers: Array[TileLayer] = []
var _background: Polygon2D
var _custom: Node2D
var _queue: Array[Array] = []
var _active := 0
var _view := [Vector2(2048, 2048), 0.4, Vector2(1440, 900)]
var cover: Dictionary = {}
var _terrain := true
var _wrap := true
var _offline := false
var _style_key := ""
var _placeholders := {}
var _placeholder_loading := {}
var _loading := false
var _vector_baker: MapBaker
var _vector_file := ""
var _vector_fills: Array = []
var _line_material: ShaderMaterial
var _decodes: Array[int] = []
var _decoding := 0
var _queued := {}
var _landed: Array = []
var _missing := {}


func _ready() -> void:
	_background = Polygon2D.new()
	_background.polygon = PackedVector2Array([Vector2(-world_width, -world_width), Vector2(world_width * 2.0, -world_width), Vector2(world_width * 2.0, world_width * 2.0), Vector2(-world_width, world_width * 2.0)])
	_background.color = BASE_GREY
	_background.z_index = -60
	add_child(_background)
	_custom = Node2D.new()
	_custom.z_index = -40
	add_child(_custom)
	var line_shader := Shader.new()
	line_shader.code = VECTOR_LINE_SHADER
	_line_material = ShaderMaterial.new()
	_line_material.shader = line_shader
	set_process(false)
	_rebuild_layers()


func set_terrain(enabled: bool) -> void:
	if _terrain == enabled:
		return
	_terrain = enabled
	_rebuild_layers()


func set_wrap(enabled: bool) -> void:
	if _wrap == enabled:
		return
	_wrap = enabled
	_rebuild_layers()
	_mount_custom()


func apply_style(next: Dictionary, engine: EngineLink = null) -> void:
	if engine:
		_engine = engine
	var key := "%s|%s|%s|%s" % [str(next.get("kind", "builtin")), str(next.get("basemapId", DEFAULT_ID)), str(next.get("key", "")), JSON.stringify(next.get("relief"))]
	style = next
	if key == _style_key:
		return
	_style_key = key
	_rebuild_layers()
	_mount_custom()


func _style_kind() -> String:
	return str(style.get("kind", "builtin"))


func _basemap_id() -> String:
	var id := str(style.get("basemapId", DEFAULT_ID))
	return id if SERVICES.has(id) else DEFAULT_ID


func _rebuild_layers() -> void:
	for layer in _layers:
		layer.queue_free()
	_layers.clear()
	_queue.clear()
	_queued.clear()
	var kind := _style_kind()
	if kind != "builtin":
		_background.color = CUSTOM_SEA
		var relief: Variant = style.get("relief")
		if kind == "vector" and relief is Dictionary:
			var terrain: Dictionary = relief
			var layer := _add_layer("relief-tiles", "pmtiles", "plain", clampi(int(terrain.get("minzoom", 0)), 0, 22), clampi(int(terrain.get("maxzoom", 0)), 0, 22), -1, -36)
			layer.pmtiles_url = str(terrain.get("url", ""))
			var bounds: Variant = terrain.get("bounds")
			if bounds is Array and (bounds as Array).size() == 4:
				layer.bounds = Rect2(Vector2(float(bounds[0]), float(bounds[1])), Vector2(float(bounds[2]) - float(bounds[0]), float(bounds[3]) - float(bounds[1])))
		_update_layers()
		return
	if _offline:
		_background.color = BASE_GREY
		_add_layer("offline-relief", "offline", "offline_relief", 0, 3, -1, -50)
		_update_layers()
		return
	var id := _basemap_id()
	var composed := id in ["atlas-relief", "atlas-relief-dark", "ocean-dark", "midnight-terrain"]
	var rendered := "terrain" if composed else id
	var service: String = SERVICES[rendered][0]
	var max_zoom: int = SERVICES[rendered][1]
	var paint := "satellite" if id == "imagery" else "atlas"
	var world_paint := ""
	match id:
		"midnight-terrain":
			paint = "midnight_terrain"
			world_paint = "midnight_world"
			_background.color = Color("#000205")
		"ocean-dark":
			paint = "ocean_dark_terrain"
			world_paint = "ocean_dark_world"
			_background.color = Color("#030a14")
		"atlas-relief-dark":
			paint = "atlas_dark_terrain"
			world_paint = "atlas_dark_world"
			_background.color = Color("#050609")
		"atlas-relief":
			paint = "relief_terrain"
			world_paint = "world_relief"
			_background.color = BASE_GREY
		_:
			_background.color = BASE_GREY
	if id == "natgeo-dark":
		_background.color = Color("#111416")
		_add_layer("natgeo-physical", "natgeo", "natgeo_physical", 0, 8, -1, -48)
	else:
		var lowres := _add_layer(service + "#low", "esri", paint, 0, 2, 2, -55)
		lowres.service = service
		var detail := _add_layer(service, "esri", paint, 0, max_zoom, -1, -50)
		detail.service = service
		detail.placeholder = true
		if composed:
			_add_layer("etopo", "etopo", world_paint, 0, 3, -1, -30)
	if _terrain and id != "natgeo-dark":
		var hills := _add_layer("terrarium", "dem", "plain", 0, 5, -1, -25)
		hills.dem = true
	_update_layers()


func _add_layer(id: String, source: String, paint: String, min_zoom: int, max_zoom: int, fixed_zoom: int, z: int) -> TileLayer:
	var layer := TileLayer.new()
	layer.basemap = self
	layer.id = id
	layer.source = source
	layer.min_zoom = min_zoom
	layer.max_zoom = max_zoom
	layer.fixed_zoom = fixed_zoom
	layer.z_index = z
	layer.paint = PAINTS.get(paint, {})
	layer.material_template = _grade_material(paint)
	add_child(layer)
	_layers.append(layer)
	return layer


func _grade_material(paint: String) -> ShaderMaterial:
	var shader := Shader.new()
	shader.code = GRADE_SHADER
	var material := ShaderMaterial.new()
	material.shader = shader
	var spec: Dictionary = PAINTS.get(paint, {})
	if spec.is_empty():
		material.set_shader_parameter("graded", false)
		return material
	var saturation := float(spec.get("saturation", 0.0))
	var contrast := float(spec.get("contrast", 0.0))
	material.set_shader_parameter("saturation_factor", (1.0 - 1.0 / (1.001 - saturation)) if saturation > 0.0 else -saturation)
	material.set_shader_parameter("contrast_factor", (1.0 / (1.0 - contrast)) if contrast > 0.0 else 1.0 + contrast)
	material.set_shader_parameter("brightness_low", float(spec.get("low", 0.0)))
	material.set_shader_parameter("brightness_high", float(spec.get("high", 1.0)))
	var angle := deg_to_rad(float(spec.get("hue", 0.0)))
	var s := sin(angle)
	var c := cos(angle)
	material.set_shader_parameter("spin", Vector3((2.0 * c + 1.0) / 3.0, (-sqrt(3.0) * s - c + 1.0) / 3.0, (sqrt(3.0) * s - c + 1.0) / 3.0))
	return material


static func ramp_at(ramp: Array, level: float) -> float:
	if ramp.is_empty():
		return 1.0
	var first: Array = ramp[0]
	if level <= float(first[0]):
		return float(first[1])
	for index in range(1, ramp.size()):
		var stop: Array = ramp[index]
		if level <= float(stop[0]):
			var previous: Array = ramp[index - 1]
			return lerpf(float(previous[1]), float(stop[1]), (level - float(previous[0])) / (float(stop[0]) - float(previous[0])))
	var last: Array = ramp[ramp.size() - 1]
	return float(last[1])


func update_view(centre: Vector2, zoom: float, viewport_size: Vector2) -> void:
	_view = [centre, zoom, viewport_size]
	_update_layers()


func _update_layers() -> void:
	var centre: Vector2 = _view[0]
	var zoom: float = _view[1]
	var size: Vector2 = _view[2]
	var level := log(8.0 * zoom) / log(2.0)
	var camera: Camera2D = get_viewport().get_camera_2d() if is_inside_tree() else null
	var view_level := level
	if camera:
		view_level = log(8.0 * camera.zoom.x) / log(2.0)
	cover = _covering_tiles()
	for layer in _layers:
		layer.update(centre, zoom, size, view_level)
	_line_material.set_shader_parameter("pixel_world", 1.0 / zoom)
	_pump()
	_report_loading()


func _covering_tiles() -> Dictionary:
	var map := get_parent() as MapView
	if map == null or map.extras == null or not map.extras_ready():
		return {}
	var globe: Variant = map.extras.get("globe")
	if globe is GlobeView and (globe as GlobeView).globeness() > 0.0:
		return {}
	var pitch_deg := map.pitch
	var bearing_deg := map.bearing
	var max_constant_pitch := clampf(78.5 - COVER_FOV_DEG * 0.5, 0.0, 60.0)
	var variable := (_terrain and _style_kind() == "builtin" and not _offline) or pitch_deg > max_constant_pitch
	if is_zero_approx(pitch_deg) and is_zero_approx(bearing_deg) and not variable:
		return {}
	var size := map.get_viewport_rect().size
	if size.x <= 0.0 or size.y <= 0.0:
		return {}
	var centre := map.camera.position
	var px_per_world := map.camera.zoom.x
	var level := map.zoom_level()
	var focal := 0.5 / GlobeView.TAN_HALF * size.y
	var pitch := deg_to_rad(pitch_deg)
	var bearing := deg_to_rad(bearing_deg)
	var up := Vector2(sin(bearing), -cos(bearing))
	var quad := PackedVector2Array()
	for corner in [Vector2.ZERO, Vector2(size.x, 0.0), size, Vector2(0.0, size.y)]:
		quad.append(ground_point(corner, size, centre, px_per_world, bearing_deg, pitch_deg))
	var quad_low := quad[0]
	var quad_high := quad[0]
	for point in quad:
		quad_low = quad_low.min(point)
		quad_high = quad_high.max(point)
	var camera_ground := (centre - up * (focal * sin(pitch) / px_per_world)) / world_width
	var distance_z := focal * cos(pitch) / px_per_world / world_width
	var distance_centre := focal / px_per_world / world_width
	var requested := level + 1.0
	var nominal := maxi(0, roundi(requested))
	var behaviour := cover_loading_behaviour()
	var count_term := cover_count_term(distance_z, distance_centre, behaviour) if variable else 0.0
	var axes := quad_axes(quad)
	var tiles: Array = []
	var stack: Array[Array] = []
	var key := nominal * 7919 + (1 if variable else 0)
	if _wrap:
		for wrap in range(1, 4):
			stack.append([0, 0, 0, -wrap])
			stack.append([0, 0, 0, wrap])
	stack.append([0, 0, 0, 0])
	while not stack.is_empty():
		var node: Array = stack.pop_back()
		var zoom: int = node[0]
		var x: int = node[1]
		var y: int = node[2]
		var wrap: int = node[3]
		var count := 1 << zoom
		var low := Vector2((float(wrap) + float(x) / count) * world_width, float(y) / count * world_width)
		var high := low + Vector2.ONE * world_width / count
		if not quad_meets_with(axes, quad_low, quad_high, low, high):
			continue
		var desired := nominal
		if variable:
			var nearest := camera_ground.clamp(low / world_width, high / world_width)
			var distance_2d := nearest.distance_to(camera_ground)
			desired = maxi(0, roundi(cover_tile_zoom_with(requested, distance_2d, distance_z, distance_centre, behaviour, count_term)))
		var target := mini(desired, COVER_MAX_ZOOM)
		if zoom >= target:
			var middle := (low + high) * 0.5 / world_width
			tiles.append([zoom, x + wrap * count, y, desired, middle.distance_squared_to(centre / world_width)])
			key = (key * 1000003 + ((zoom * 64 + desired) * 8192 + x + wrap * count + 4096) * 65536 + y) & 0x3fffffffffffffff
			continue
		for child in range(4):
			stack.append([zoom + 1, (x << 1) + (child % 2), (y << 1) + (child >> 1), wrap])
	tiles.sort_custom(func(a: Array, b: Array) -> bool: return float(a[4]) > float(b[4]))
	return {"tiles": tiles, "nominal": nominal, "variable": variable, "key": key if key != 0 else 1}


static func ground_point(screen: Vector2, size: Vector2, centre: Vector2, px_per_world: float, bearing_deg: float, pitch_deg: float) -> Vector2:
	var focal := 0.5 / GlobeView.TAN_HALF * size.y
	var pitch := deg_to_rad(pitch_deg)
	var bearing := deg_to_rad(bearing_deg)
	var right := Vector2(cos(bearing), sin(bearing))
	var up := Vector2(sin(bearing), -cos(bearing))
	var sx := screen.x - size.x * 0.5
	var sy := size.y * 0.5 - screen.y
	var denominator := maxf(focal * cos(pitch) - sy * sin(pitch), 1e-3)
	var v := sy * focal / denominator
	var a := sx * (focal + v * sin(pitch)) / focal
	return centre + (right * a + up * v) / px_per_world


static func quad_axes(quad: PackedVector2Array) -> PackedFloat64Array:
	var axes := PackedFloat64Array()
	for index in range(quad.size()):
		var edge := quad[(index + 1) % quad.size()] - quad[index]
		var axis := Vector2(-edge.y, edge.x)
		var quad_min := INF
		var quad_max := -INF
		for point in quad:
			var along := point.dot(axis)
			quad_min = minf(quad_min, along)
			quad_max = maxf(quad_max, along)
		axes.append_array([axis.x, axis.y, quad_min, quad_max])
	return axes


static func quad_meets_with(axes: PackedFloat64Array, quad_low: Vector2, quad_high: Vector2, low: Vector2, high: Vector2) -> bool:
	if quad_high.x < low.x or quad_low.x > high.x or quad_high.y < low.y or quad_low.y > high.y:
		return false
	for at in range(0, axes.size(), 4):
		var axis := Vector2(axes[at], axes[at + 1])
		var a := low.dot(axis)
		var b := Vector2(high.x, low.y).dot(axis)
		var c := high.dot(axis)
		var d := Vector2(low.x, high.y).dot(axis)
		if maxf(maxf(a, b), maxf(c, d)) < axes[at + 2] or minf(minf(a, b), minf(c, d)) > axes[at + 3]:
			return false
	return true


static func quad_meets(quad: PackedVector2Array, quad_low: Vector2, quad_high: Vector2, low: Vector2, high: Vector2) -> bool:
	if quad_high.x < low.x or quad_low.x > high.x or quad_high.y < low.y or quad_low.y > high.y:
		return false
	var corners := [low, Vector2(high.x, low.y), high, Vector2(low.x, high.y)]
	for index in range(quad.size()):
		var edge := quad[(index + 1) % quad.size()] - quad[index]
		var axis := Vector2(-edge.y, edge.x)
		var quad_min := INF
		var quad_max := -INF
		for point in quad:
			var along := point.dot(axis)
			quad_min = minf(quad_min, along)
			quad_max = maxf(quad_max, along)
		var rect_min := INF
		var rect_max := -INF
		for corner: Vector2 in corners:
			var along := corner.dot(axis)
			rect_min = minf(rect_min, along)
			rect_max = maxf(rect_max, along)
		if rect_max < quad_min or rect_min > quad_max:
			return false
	return true


static func cover_loading_behaviour() -> float:
	var ratio := cos(deg_to_rad(MAX_MERCATOR_HORIZON_ANGLE - COVER_FOV_DEG)) / cos(deg_to_rad(MAX_MERCATOR_HORIZON_ANGLE))
	return 2.0 * ((COVER_MAX_ZOOM_LEVELS - 1.0) / (log(ratio) / log(2.0)) - 1.0)


static func _cos_power_integral(power: float, from: float, to: float) -> float:
	var steps := 10
	var total := 0.0
	var step := (to - from) / steps
	for index in range(steps):
		var at := from + (index + 0.5) / steps * (to - from)
		total += step * pow(cos(at), power)
	return total


static func cover_tile_zoom(requested: float, distance_2d: float, distance_z: float, distance_centre: float, behaviour: float) -> float:
	return cover_tile_zoom_with(requested, distance_2d, distance_z, distance_centre, behaviour, cover_count_term(distance_z, distance_centre, behaviour))


static func cover_count_term(distance_z: float, distance_centre: float, behaviour: float) -> float:
	var half_fov := deg_to_rad(COVER_FOV_DEG * 0.5)
	var centre_pitch := acos(clampf(distance_z / distance_centre, -1.0, 1.0))
	var flat_count := 2.0 * _cos_power_integral(behaviour - 1.0, 0.0, half_fov)
	var highest := minf(deg_to_rad(MAX_MERCATOR_HORIZON_ANGLE), centre_pitch + half_fov)
	var lowest := minf(highest, centre_pitch - half_fov)
	var tile_count := _cos_power_integral(behaviour - 1.0, lowest, highest)
	return (log(maxf(1.0, tile_count / flat_count / COVER_TILE_COUNT_RATIO)) / log(2.0)) / 2.0


static func cover_tile_zoom_with(requested: float, distance_2d: float, distance_z: float, distance_centre: float, behaviour: float, count_term: float) -> float:
	var half_fov := deg_to_rad(COVER_FOV_DEG * 0.5)
	var tile_pitch := atan(distance_2d / distance_z)
	var distance_3d := sqrt(distance_2d * distance_2d + distance_z * distance_z)
	var zoom := requested
	zoom += log(distance_centre / distance_3d / maxf(0.5, cos(half_fov))) / log(2.0)
	zoom += behaviour * (log(cos(tile_pitch)) / log(2.0)) / 2.0
	zoom -= count_term
	return zoom


func _report_loading() -> void:
	var loading := _active > 0 or _decoding > 0 or not _queue.is_empty()
	if loading != _loading:
		_loading = loading
		loading_changed.emit(loading)


func request_tile(layer: TileLayer, key: String) -> void:
	var tag := "%d|%s" % [layer.get_instance_id(), key]
	if _queued.has(tag):
		return
	_queued[tag] = true
	_queue.append([layer, key, tag])


func _url_of(layer: TileLayer, z: int, x: int, y: int) -> String:
	match layer.source:
		"esri":
			return ESRI_URL % [layer.service, z, y, x]
		"etopo":
			return ETOPO_URL % [z, y, x]
		"natgeo":
			return NATGEO_PHYSICAL_URL % [z, y, x]
		"dem":
			return TERRARIUM_URL % [z, x, y]
	return ""


func _cache_path(layer: TileLayer, key: String) -> String:
	if cache_dir.is_empty() or layer.source in ["offline", "pmtiles"]:
		return ""
	var folder := layer.id.replace("/", "_").replace("#low", "")
	if layer.service == "Ocean/World_Ocean_Base":
		folder = "ocean"
	var extension := "png" if layer.source == "dem" else "jpg"
	return cache_dir.path_join(folder).path_join(key + "." + extension)


func _pump() -> void:
	while _active < MAX_REQUESTS and not _queue.is_empty():
		var entry: Array = _queue.pop_back()
		_queued.erase(entry[2])
		var layer: TileLayer = entry[0]
		var key: String = entry[1]
		if not is_instance_valid(layer) or layer.is_queued_for_deletion():
			continue
		if layer.textures.has(key) or layer.pending.has(key):
			continue
		var parts := key.split("/")
		var z := int(parts[0])
		var x := int(parts[1])
		var y := int(parts[2])
		if layer.source == "offline":
			var path := UI.repo_path("public/offline-relief/%d/%d/%d.jpg" % [z, y, x])
			var image := Image.load_from_file(path)
			layer.on_loaded(key, ImageTexture.create_from_image(image) if image else null, PackedByteArray())
			continue
		var cached := _cache_path(layer, key)
		if not cached.is_empty() and not _missing.has(cached):
			_decode_later(layer, key, cached, PackedByteArray())
			continue
		if layer.source == "pmtiles":
			_fetch_pmtiles(layer, key, z, x, y)
			continue
		_fetch(layer, key, _url_of(layer, z, x, y))
	_report_loading()


func _fetch(layer: TileLayer, key: String, url: String) -> void:
	if url.is_empty():
		layer.on_loaded(key, null, PackedByteArray())
		return
	_active += 1
	layer.pending[key] = true
	var request := HTTPRequest.new()
	request.timeout = 20.0
	add_child(request)
	var layer_ref: WeakRef = weakref(layer)
	request.request_completed.connect(func(result: int, code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
		_active -= 1
		request.queue_free()
		var owner_layer := layer_ref.get_ref() as TileLayer
		if owner_layer == null or not is_instance_valid(owner_layer):
			_pump()
			return
		if result == HTTPRequest.RESULT_SUCCESS and code == 200 and body.size() >= 4:
			_decode_later(owner_layer, key, "", body)
		else:
			owner_layer.pending.erase(key)
			owner_layer.on_loaded(key, null, PackedByteArray())
			if owner_layer.fixed_zoom == 2 and owner_layer.source == "esri" and not _offline and result != HTTPRequest.RESULT_SUCCESS:
				_offline = true
				_rebuild_layers.call_deferred()
		_pump())
	if request.request(url) != OK:
		_active -= 1
		layer.pending.erase(key)
		request.queue_free()
		layer.on_loaded(key, null, PackedByteArray())


func _fetch_pmtiles(layer: TileLayer, key: String, z: int, x: int, y: int) -> void:
	if _engine == null:
		layer.on_loaded(key, null, PackedByteArray())
		return
	_active += 1
	layer.pending[key] = true
	var reply: Dictionary = await _engine.request("mapextras.reliefTile", {"url": layer.pmtiles_url, "z": z, "x": x, "y": y})
	_active -= 1
	if not is_instance_valid(layer):
		_pump()
		return
	layer.pending.erase(key)
	var result: Dictionary = reply.get("result", {}) if reply.get("result") is Dictionary else {}
	var data := str(result.get("data", ""))
	if data.is_empty():
		layer.on_loaded(key, null, PackedByteArray())
	else:
		var bytes := Marshalls.base64_to_raw(data)
		var texture := _decode(layer, bytes)
		var levels := int(result.get("levels", 0))
		if texture and levels > 0:
			layer.crops[key] = [levels, int(result.get("ox", 0)), int(result.get("oy", 0))]
		layer.on_loaded(key, texture, bytes)
	_pump()


func _decode_later(layer: TileLayer, key: String, path: String, body: PackedByteArray) -> void:
	layer.pending[key] = true
	_decoding += 1
	var layer_ref: WeakRef = weakref(layer)
	var dem := layer.dem
	_decodes.append(WorkerThreadPool.add_task(func() -> void:
		var bytes := body if path.is_empty() else FileAccess.get_file_as_bytes(path)
		_decoded.call_deferred(layer_ref, key, decode_image(dem, bytes), bytes, path), false, "basemap tile"))


static func decode_image(dem: bool, bytes: PackedByteArray) -> Image:
	if bytes.size() < 4:
		return null
	var image := Image.new()
	var status := ERR_FILE_UNRECOGNIZED
	if dem:
		status = image.load_png_from_buffer(bytes)
		if status == OK:
			image.convert(Image.FORMAT_RGBA8)
	elif bytes[0] == 0x89 and bytes[1] == 0x50:
		status = image.load_png_from_buffer(bytes)
	elif bytes[0] == 0xFF and bytes[1] == 0xD8:
		status = image.load_jpg_from_buffer(bytes)
	elif bytes[0] == 0x52 and bytes[1] == 0x49 and not ImageLoader.is_avif(bytes):
		status = image.load_webp_from_buffer(bytes)
	return image if status == OK else null


func _decoded(layer_ref: WeakRef, key: String, image: Image, bytes: PackedByteArray, path: String) -> void:
	_landed.append([layer_ref, key, image, bytes, path])
	set_process(true)


func _process(_delta: float) -> void:
	if _landed.is_empty():
		set_process(false)
		return
	var started := Time.get_ticks_usec()
	while not _landed.is_empty() and (Time.get_ticks_usec() - started < LAND_BUDGET_USEC):
		var entry: Array = _landed.pop_front()
		_land(entry[0], entry[1], entry[2], entry[3], entry[4])
	var kept: Array[int] = []
	for task in _decodes:
		if WorkerThreadPool.is_task_completed(task):
			WorkerThreadPool.wait_for_task_completion(task)
		else:
			kept.append(task)
	_decodes = kept
	_pump()


func _land(layer_ref: WeakRef, key: String, image: Image, bytes: PackedByteArray, path: String) -> void:
	_decoding = maxi(0, _decoding - 1)
	var fetched := path.is_empty()
	var layer := layer_ref.get_ref() as TileLayer
	if layer == null or not is_instance_valid(layer) or layer.is_queued_for_deletion():
		return
	layer.pending.erase(key)
	if not fetched and bytes.is_empty():
		_missing[path] = true
		request_tile(layer, key)
		return
	var texture: Texture2D = ImageTexture.create_from_image(image) if image else null
	if texture == null and not layer.dem:
		texture = ImageLoader.decode(bytes)
	if texture:
		if fetched:
			_store(layer, key, bytes)
		_accept(layer, key, texture, bytes)
	elif fetched:
		layer.on_loaded(key, null, PackedByteArray())
	elif layer.source == "pmtiles":
		var parts := key.split("/")
		_fetch_pmtiles(layer, key, int(parts[0]), int(parts[1]), int(parts[2]))
	else:
		var parts := key.split("/")
		_fetch(layer, key, _url_of(layer, int(parts[0]), int(parts[1]), int(parts[2])))


func _exit_tree() -> void:
	for task in _decodes:
		WorkerThreadPool.wait_for_task_completion(task)
	_decodes.clear()


func _decode(layer: TileLayer, bytes: PackedByteArray) -> Texture2D:
	if layer.dem:
		var image := Image.new()
		if image.load_png_from_buffer(bytes) != OK:
			return null
		image.convert(Image.FORMAT_RGBA8)
		return ImageTexture.create_from_image(image)
	return ImageLoader.decode(bytes)


func _accept(layer: TileLayer, key: String, texture: Texture2D, bytes: PackedByteArray) -> void:
	if not layer.placeholder or layer.source != "esri":
		layer.on_loaded(key, texture, bytes)
		return
	var z := int(key.split("/")[0])
	if z <= PLACEHOLDER_MIN_ZOOM:
		layer.on_loaded(key, texture, bytes)
		return
	var service := layer.service
	if not _placeholders.has(service):
		_load_placeholder(service)
		layer.waiting[key] = [texture, bytes]
		return
	var reference: Variant = _placeholders[service]
	if reference is PackedByteArray and reference == bytes:
		layer.on_placeholder(key)
	else:
		layer.on_loaded(key, texture, bytes)


func _load_placeholder(service: String) -> void:
	if _placeholder_loading.has(service):
		return
	_placeholder_loading[service] = true
	var samples: Array[PackedByteArray] = []
	for spec in [[13, 0, 0], [13, 5091, 1365]]:
		var request := HTTPRequest.new()
		request.timeout = 20.0
		add_child(request)
		var url := ESRI_URL % [service, spec[0], spec[1], spec[2]]
		if request.request(url) != OK:
			request.queue_free()
			samples.append(PackedByteArray())
			continue
		var response: Array = await request.request_completed
		request.queue_free()
		if int(response[0]) == HTTPRequest.RESULT_SUCCESS and int(response[1]) == 200:
			samples.append(response[3])
		else:
			samples.append(PackedByteArray())
	var reference: Variant = null
	if samples.size() == 2 and not samples[0].is_empty() and samples[0] == samples[1]:
		reference = samples[0]
	_placeholders[service] = reference
	for layer in _layers:
		if not is_instance_valid(layer) or layer.service != service:
			continue
		for key in layer.waiting.keys():
			var held: Array = layer.waiting[key]
			if reference is PackedByteArray and reference == held[1]:
				layer.on_placeholder(key)
			else:
				layer.on_loaded(key, held[0], held[1])
		layer.waiting.clear()
		layer.place_all()


func _store(layer: TileLayer, key: String, body: PackedByteArray) -> void:
	var path := _cache_path(layer, key)
	if path.is_empty():
		return
	_missing.erase(path)
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file:
		file.store_buffer(body)


func _mount_custom() -> void:
	for child in _custom.get_children():
		child.queue_free()
	var kind := _style_kind()
	if kind == "image":
		var image_spec: Variant = style.get("image")
		if not (image_spec is Dictionary):
			return
		var spec: Dictionary = image_spec
		var bytes := Marshalls.base64_to_raw(str(spec.get("data", "")))
		var texture := ImageLoader.decode(bytes)
		if texture == null:
			return
		var quad: Array = spec.get("quad", [])
		if quad.size() < 4:
			return
		var top_left: Array = quad[0]
		var bottom_right: Array = quad[2]
		var origin := _project(float(top_left[0]), float(top_left[1]))
		var corner := _project(float(bottom_right[0]), float(bottom_right[1]))
		for offset in _copy_offsets():
			var sprite := Sprite2D.new()
			sprite.texture = texture
			sprite.centered = false
			sprite.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
			sprite.position = origin + Vector2(offset, 0)
			sprite.scale = Vector2((corner.x - origin.x) / texture.get_width(), (corner.y - origin.y) / texture.get_height())
			_custom.add_child(sprite)
	elif kind == "vector":
		var vector_spec: Variant = style.get("vector")
		if not (vector_spec is Dictionary):
			return
		var spec: Dictionary = vector_spec
		_vector_fills = spec.get("fills", [])
		var file := str(spec.get("file", ""))
		if file.is_empty():
			return
		if _vector_baker == null:
			_vector_baker = MapBaker.new()
			add_child(_vector_baker)
			_vector_baker.baked.connect(_on_vector_baked)
		_vector_file = file
		_vector_baker.bake_file(file, world_width)


func _on_vector_baked(result: Dictionary) -> void:
	if _style_kind() != "vector":
		return
	for child in _custom.get_children():
		child.queue_free()
	var count := (result["names"] as PackedStringArray).size()
	var rows: int = max(1, int(ceil(float(max(count, 1)) / 1024.0)))
	var fills := Image.create_empty(1024, rows, false, Image.FORMAT_RGBA8)
	fills.fill(Color8(0x33, 0x43, 0x5c))
	for index in range(min(count, _vector_fills.size())):
		var rgb: Variant = _vector_fills[index]
		if rgb is Array and (rgb as Array).size() >= 3:
			var alpha := float(rgb[3]) if (rgb as Array).size() > 3 else 1.0
			fills.set_pixel(index % 1024, index / 1024, Color(float(rgb[0]) / 255.0, float(rgb[1]) / 255.0, float(rgb[2]) / 255.0, alpha))
	var shader := Shader.new()
	shader.code = VECTOR_SHADER
	var material := ShaderMaterial.new()
	material.shader = shader
	material.set_shader_parameter("fills", ImageTexture.create_from_image(fills))
	var fill_arrays := []
	fill_arrays.resize(Mesh.ARRAY_MAX)
	fill_arrays[Mesh.ARRAY_VERTEX] = result["vertices"]
	fill_arrays[Mesh.ARRAY_TEX_UV] = result["uvs"]
	fill_arrays[Mesh.ARRAY_INDEX] = result["indices"]
	var fill_mesh := ArrayMesh.new()
	if (result["indices"] as PackedInt32Array).size() > 0:
		fill_mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, fill_arrays)
	var line_arrays := []
	line_arrays.resize(Mesh.ARRAY_MAX)
	line_arrays[Mesh.ARRAY_VERTEX] = result["border_vertices"]
	line_arrays[Mesh.ARRAY_TEX_UV] = result["border_uvs"]
	line_arrays[Mesh.ARRAY_COLOR] = result["border_sides"]
	line_arrays[Mesh.ARRAY_INDEX] = result["border_indices"]
	var line_mesh := ArrayMesh.new()
	if (result["border_indices"] as PackedInt32Array).size() > 0:
		line_mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, line_arrays)
	for offset in _copy_offsets():
		var holder := Node2D.new()
		holder.position = Vector2(offset, 0)
		var fill := MeshInstance2D.new()
		fill.mesh = fill_mesh
		fill.material = material
		holder.add_child(fill)
		var line := MeshInstance2D.new()
		line.mesh = line_mesh
		line.material = _line_material
		holder.add_child(line)
		_custom.add_child(holder)


func _copy_offsets() -> Array[float]:
	if _wrap:
		return [-world_width, 0.0, world_width]
	return [0.0]


func _project(lon: float, lat: float) -> Vector2:
	var clamped := clampf(lat, -85.0511287798066, 85.0511287798066)
	return Vector2((lon + 180.0) / 360.0 * world_width, (0.5 - log(tan(PI / 4.0 + deg_to_rad(clamped) / 2.0)) / (2.0 * PI)) * world_width)


func wrap_enabled() -> bool:
	return _wrap


static var _hillshade: Shader


static func hillshade_shader() -> Shader:
	if _hillshade == null:
		_hillshade = Shader.new()
		_hillshade.code = HILLSHADE_SHADER
	return _hillshade


class TileLayer extends Node2D:
	var basemap: Basemap
	var id := ""
	var source := ""
	var service := ""
	var pmtiles_url := ""
	var bounds := Rect2()
	var min_zoom := 0
	var max_zoom := 13
	var fixed_zoom := -1
	var placeholder := false
	var dem := false
	var paint: Dictionary = {}
	var material_template: ShaderMaterial
	var textures := {}
	var placeholders := {}
	var crops := {}
	var pending := {}
	var waiting := {}
	var sprites := {}
	var current_zoom := -1
	var _wanted := {}
	var _last_args: Array = []
	var _cover_key := 0
	var _place_queued := false
	var _stamp := {}
	var _tick := 0
	var _trimmed_at := 0

	func tile_zoom_for(zoom: float) -> int:
		var ideal := int(roundf(log(16.0 * zoom) / log(2.0)))
		if fixed_zoom >= 0:
			return fixed_zoom
		return clampi(ideal, min_zoom, max_zoom)

	func update(centre: Vector2, zoom: float, viewport_size: Vector2, level: float) -> void:
		_last_args = [centre, zoom, viewport_size, level]
		_tick += 1
		var opacity := Basemap.ramp_at(paint.get("ramp", []), level)
		if material_template:
			material_template.set_shader_parameter("opacity", opacity)
		visible = opacity > 0.0 or dem
		if not basemap.cover.is_empty():
			_update_cover(basemap.cover)
			return
		_cover_key = 0
		var tile_zoom := tile_zoom_for(zoom)
		var overscaled := maxi(int(roundf(log(16.0 * zoom) / log(2.0))), tile_zoom)
		var count := 1 << tile_zoom
		var world_width := basemap.world_width
		var tile := world_width / count
		var half := viewport_size * 0.5 / zoom
		var left := int(floor((centre.x - half.x) / tile))
		var right := int(floor((centre.x + half.x) / tile))
		var top := clampi(int(floor((centre.y - half.y) / tile)), 0, count - 1)
		var bottom := clampi(int(floor((centre.y + half.y) / tile)), 0, count - 1)
		if not basemap.wrap_enabled():
			left = maxi(left, 0)
			right = mini(right, count - 1)
		if right - left > count * 3:
			right = left + count * 3
		_wanted.clear()
		var all_ready := true
		for x in range(left, right + 1):
			for y in range(top, bottom + 1):
				var wrapped := posmod(x, count)
				if not _inside_bounds(tile_zoom, wrapped, y):
					continue
				var key := "%d/%d/%d" % [tile_zoom, wrapped, y]
				var place := "%s@%d" % [key, x]
				_wanted[place] = true
				_stamp[key] = _tick
				if sprites.has(place):
					continue
				if textures.has(key) or placeholders.has(key):
					_place(place, key, Vector2(x * tile, y * tile), tile, tile_zoom, overscaled)
				elif not pending.has(key) and not waiting.has(key):
					all_ready = false
					basemap.request_tile(self, key)
				else:
					all_ready = false
		for place in sprites.keys():
			if _wanted.has(place):
				continue
			var sprite: Sprite2D = sprites[place]
			if all_ready or int(sprite.get_meta("zoom")) == tile_zoom:
				sprite.queue_free()
				sprites.erase(place)
		if dem:
			for place in sprites.keys():
				var sprite: Sprite2D = sprites[place]
				var material := sprite.material as ShaderMaterial
				if material:
					material.set_shader_parameter("dem_zoom", float(overscaled))
		current_zoom = tile_zoom
		_trim()

	func _update_cover(cover: Dictionary) -> void:
		var cover_key := int(cover.get("key", 0))
		if cover_key != 0 and cover_key == _cover_key:
			return
		_cover_key = cover_key
		var limit := fixed_zoom if fixed_zoom >= 0 else max_zoom
		var world_width := basemap.world_width
		var chosen := {}
		var order: Array[String] = []
		for entry: Array in cover["tiles"]:
			var z := int(entry[0])
			var x := int(entry[1])
			var y := int(entry[2])
			var deep := int(entry[3])
			if z > limit:
				x = x >> (z - limit)
				y = y >> (z - limit)
				z = limit
			if z < min_zoom:
				continue
			var id := "%d/%d/%d" % [z, x, y]
			if chosen.has(id):
				var known: Array = chosen[id]
				known[3] = maxi(int(known[3]), deep)
				continue
			chosen[id] = [z, x, y, deep]
			order.append(id)
		_wanted.clear()
		var missing: Array[Rect2] = []
		for id in order:
			var item: Array = chosen[id]
			var z: int = item[0]
			var x: int = item[1]
			var y: int = item[2]
			var count := 1 << z
			var wrapped := posmod(x, count)
			if not _inside_bounds(z, wrapped, y):
				continue
			var key := "%d/%d/%d" % [z, wrapped, y]
			var place := "%s@%d" % [key, x]
			_wanted[place] = true
			_stamp[key] = _tick
			var span := world_width / count
			var overscaled := maxi(int(item[3]), z)
			if sprites.has(place):
				if dem:
					var material := (sprites[place] as Sprite2D).material as ShaderMaterial
					if material:
						material.set_shader_parameter("dem_zoom", float(overscaled))
				continue
			if textures.has(key) or placeholders.has(key):
				_place(place, key, Vector2(x * span, y * span), span, z, overscaled)
			else:
				if not pending.has(key) and not waiting.has(key):
					basemap.request_tile(self, key)
				missing.append(Rect2(x * span, y * span, span, span))
		for place in sprites.keys():
			if _wanted.has(place):
				continue
			var sprite: Sprite2D = sprites[place]
			var area := Rect2(sprite.position, Vector2.ONE * world_width / float(1 << int(sprite.get_meta("zoom"))))
			var held := false
			for gap in missing:
				if gap.intersects(area):
					held = true
					break
			if not held:
				sprite.queue_free()
				sprites.erase(place)
		current_zoom = clampi(int(cover["nominal"]), min_zoom, limit)
		_trim()

	func _trim() -> void:
		if textures.size() <= maxi(KEEP_TEXTURES, _trimmed_at) + EVICT_SLACK or basemap.cache_dir.is_empty() or source in ["offline", "pmtiles"]:
			return
		var shown := {}
		for sprite: Sprite2D in sprites.values():
			if is_instance_valid(sprite) and sprite.texture:
				shown[sprite.texture.get_instance_id()] = true
		var held: Array = []
		for key: String in textures.keys():
			var texture: Texture2D = textures[key]
			if texture == null or shown.has(texture.get_instance_id()) or int(_stamp.get(key, 0)) >= _tick:
				continue
			held.append(key)
		held.sort_custom(func(a: String, b: String) -> bool: return int(_stamp.get(a, 0)) < int(_stamp.get(b, 0)))
		var excess := textures.size() - KEEP_TEXTURES
		for key: String in held:
			if excess <= 0:
				break
			textures.erase(key)
			_stamp.erase(key)
			excess -= 1
		_trimmed_at = textures.size()
		if _stamp.size() > textures.size() * 4:
			for key: String in _stamp.keys():
				if not textures.has(key) and int(_stamp[key]) < _tick:
					_stamp.erase(key)

	func _inside_bounds(z: int, x: int, y: int) -> bool:
		if bounds.size == Vector2.ZERO:
			return true
		var count := float(1 << z)
		var west := x / count * 360.0 - 180.0
		var east := (x + 1) / count * 360.0 - 180.0
		var north := rad_to_deg(atan(sinh(PI * (1.0 - 2.0 * y / count))))
		var south := rad_to_deg(atan(sinh(PI * (1.0 - 2.0 * (y + 1) / count))))
		return east >= bounds.position.x and west <= bounds.end.x and north >= bounds.position.y and south <= bounds.end.y

	func on_loaded(key: String, texture: Texture2D, _bytes: PackedByteArray) -> void:
		textures[key] = texture
		place_all()

	func on_placeholder(key: String) -> void:
		placeholders[key] = true
		textures.erase(key)
		var parts := key.split("/")
		var z := int(parts[0])
		var x := int(parts[1])
		var y := int(parts[2])
		for parent_zoom in range(z - 1, -1, -1):
			var shift := z - parent_zoom
			var parent_key := "%d/%d/%d" % [parent_zoom, x >> shift, y >> shift]
			if textures.has(parent_key) and textures[parent_key] != null:
				break
			if placeholders.has(parent_key):
				continue
			if not pending.has(parent_key):
				basemap.request_tile(self, parent_key)
			break
		place_all()

	func place_all() -> void:
		_cover_key = 0
		if _place_queued:
			return
		_place_queued = true
		_place_now.call_deferred()

	func _place_now() -> void:
		_place_queued = false
		if _last_args.is_empty() or not is_inside_tree():
			return
		_cover_key = 0
		update(_last_args[0], _last_args[1], _last_args[2], _last_args[3])

	func _place(place: String, key: String, origin: Vector2, tile: float, tile_zoom: int, overscaled: int) -> void:
		var texture: Texture2D = textures.get(key)
		var region := Rect2()
		if placeholders.has(key):
			var parts := key.split("/")
			var z := int(parts[0])
			var x := int(parts[1])
			var y := int(parts[2])
			texture = null
			for parent_zoom in range(z - 1, -1, -1):
				var shift := z - parent_zoom
				var parent_key := "%d/%d/%d" % [parent_zoom, x >> shift, y >> shift]
				if placeholders.has(parent_key):
					continue
				var candidate: Texture2D = textures.get(parent_key)
				_stamp[parent_key] = _tick
				if candidate == null:
					if not textures.has(parent_key) and not pending.has(parent_key):
						basemap.request_tile(self, parent_key)
					return
				var span := candidate.get_width() / float(1 << shift)
				region = Rect2((x - ((x >> shift) << shift)) * span, (y - ((y >> shift) << shift)) * span, span, span)
				texture = candidate
				break
		if texture == null:
			return
		if crops.has(key):
			var crop: Array = crops[key]
			var levels := int(crop[0])
			var span := texture.get_width() / float(1 << levels)
			region = Rect2(int(crop[1]) * span, int(crop[2]) * span, span, span)
		var sprite := Sprite2D.new()
		sprite.texture = texture
		sprite.centered = false
		sprite.position = origin
		if region.size != Vector2.ZERO:
			sprite.region_enabled = true
			sprite.region_rect = region
			sprite.scale = Vector2.ONE * (tile / region.size.x)
		else:
			sprite.scale = Vector2.ONE * (tile / texture.get_width())
		sprite.z_index = min(tile_zoom, 22)
		sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST if dem else CanvasItem.TEXTURE_FILTER_LINEAR
		if dem:
			var material := ShaderMaterial.new()
			material.shader = Basemap.hillshade_shader()
			var count := float(1 << tile_zoom)
			var parts := key.split("/")
			var y := float(int(parts[2]))
			material.set_shader_parameter("latrange", Vector2(rad_to_deg(atan(sinh(PI * (1.0 - 2.0 * y / count)))), rad_to_deg(atan(sinh(PI * (1.0 - 2.0 * (y + 1.0) / count))))))
			material.set_shader_parameter("dem_zoom", float(overscaled))
			sprite.material = material
		else:
			sprite.material = material_template
		sprite.set_meta("zoom", tile_zoom)
		add_child(sprite)
		sprites[place] = sprite
