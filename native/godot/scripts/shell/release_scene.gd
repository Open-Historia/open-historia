class_name ReleaseScene
extends Control

const MAP_SHADER := """
shader_type canvas_item;
uniform sampler2D plane : filter_linear_mipmap, repeat_disable;
uniform sampler2D relief : filter_linear_mipmap, repeat_disable;
uniform vec3 row_x;
uniform vec3 row_y;
uniform vec3 row_w;
uniform vec2 extent;
uniform float lift;
varying vec2 spot;

float erf_of(float x) {
	float x2 = x * x;
	return sign(x) * sqrt(1.0 - exp(-x2 * (1.2732395 + 0.147 * x2) / (1.0 + 0.147 * x2)));
}

void vertex() {
	spot = VERTEX;
}

void fragment() {
	vec3 at = vec3(spot, 1.0);
	float w = dot(row_w, at);
	float ahead = step(0.0, w);
	vec2 q = vec2(dot(row_x, at), dot(row_y, at)) / max(abs(w), 1e-6);
	vec2 uv = q / extent;
	float k = 1.0 / (40.0 * 1.41421356);
	float sx = 0.5 * (erf_of(q.x * k) - erf_of((q.x - extent.x) * k));
	float sy = 0.5 * (erf_of((q.y - 40.0) * k) - erf_of((q.y - 40.0 - extent.y) * k));
	vec4 shade = vec4(0.0, 0.0, 0.0, 0.6 * sx * sy * ahead);
	vec2 edge = min(uv, 1.0 - uv) / max(fwidth(uv), vec2(1e-6));
	float cover = clamp(min(edge.x, edge.y) + 0.5, 0.0, 1.0) * ahead;
	vec4 base = texture(plane, clamp(uv, 0.0, 1.0));
	vec4 top = texture(relief, clamp(uv + vec2(0.0, lift), 0.0, 1.0));
	vec3 colour = mix(base.rgb, top.rgb, top.a);
	COLOR = mix(shade, vec4(colour, 1.0), cover);
}
"""

const RES := {"bombers": 0.82, "seal": 1.8, "dove": 1.4}
const WIDE := {"hero": Vector2(1600, 900)}
const SOLID := {"far": [565.0, Color("#121923")], "mid": [645.0, Color("#0e141c")], "near": [765.0, Color("#080b10")], "front": [845.0, Color("#040608")]}

const STAR := Color("#e8e2d0")
const BEAM := Color(243 / 255.0, 231 / 255.0, 196 / 255.0, 0.05)
const WINDOW := Color("#e8b04b")
const CLOTH := Color("#b8402f")
const EMBER := Color("#f08a3c")
const ARROW := Color(156 / 255.0, 199 / 255.0, 226 / 255.0, 0.85)
const FLASH := Color("#f6c35a")
const SMOKE := Color("#5b5f5a")
const FLAK := Color("#f2b35a")
const SEA := Color("#0a1824")
const SEARCH := Color(233 / 255.0, 242 / 255.0, 248 / 255.0, 0.06)
const RAIN := Color("#9cc3dc")
const SNOW := Color("#f4f8fb")
const SUN := Color("#f0c85a")
const GREETING := Color("#f3efe6")
const SPEED := Color(201 / 255.0, 210 / 255.0, 220 / 255.0, 0.16)
const MERIDIAN := Color(92 / 255.0, 195 / 255.0, 201 / 255.0, 0.5)
const HERO_SKY := Color("#090d13")
const SKIES_SKY := Color("#0c1520")
const ABYSS := Color("#040506")
const WORKS := Color("#0d1014")
const GAUGE := Color("#2a313a")
const GAUGE_FILL := Color("#c9d2dc")
const TICK := Color("#6b7682")
const NEEDLE := Color("#e8edf2")
const SEASONS := [
	[Color("#2d5470"), Color("#1c2b38")],
	[Color("#2c4436"), Color("#9fb3c2")],
	[Color("#34512f"), Color("#c3d2dd")],
	[Color("#26587a"), Color("#d6e7f0")],
	[Color("#3e5f2f"), Color("#e3ecf2")],
	[Color("#22391f"), Color("#dfe8ee")],
]
const PALETTES := [
	[Color("#131315"), Color("#232327"), Color("#d4d4d8")],
	[Color("#111d2a"), Color("#20364a"), Color("#85cbe6")],
	[Color("#121e19"), Color("#283c32"), Color("#78c8a1")],
	[Color("#241f19"), Color("#403528"), Color("#d6b77d")],
]
const ARROWS := [
	[Vector2(420, 300), Vector2(560, 280), Vector2(680, 300), Vector2(860, 250), 720.0, 1000.0, "arrow0"],
	[Vector2(440, 470), Vector2(600, 480), Vector2(720, 520), Vector2(900, 470), 720.0, 1000.0, "arrow1"],
	[Vector2(300, 380), Vector2(520, 380), Vector2(760, 400), Vector2(1060, 360), 1100.0, 1200.0, "arrow2"],
]
const BURSTS := [Vector2(690, 230), Vector2(720, 500), Vector2(660, 640), Vector2(820, 380)]
const FLAKS := [Vector2(520, 250), Vector2(700, 300), Vector2(610, 180), Vector2(820, 230)]
const TREES := [Vector2(90, 640), Vector2(150, 660), Vector2(700, 650), Vector2(760, 670), Vector2(980, 640), Vector2(1040, 660), Vector2(1100, 645)]
const FLAGS := [Vector2(300, 700), Vector2(1310, 712)]
const FLASH_STOPS := [0.0, 0.3, 0.6, 1.0]
const FLASH_ALPHA := [0.95, 0.6, 0.0, 0.0]
const FLASH_SCALE := [0.3, 1.0, 1.3, 1.3]
const SMOKE_ALPHA_STOPS := [0.0, 0.2, 0.4, 1.0]
const SMOKE_ALPHA := [0.0, 0.0, 0.5, 0.0]
const SMOKE_MOVE_STOPS := [0.0, 0.2, 1.0]
const SMOKE_MOVE := [0.0, 0.0, 1.0]
const FLAK_STOPS := [0.0, 0.4, 0.7, 1.0]
const FLAK_ALPHA := [0.95, 0.7, 0.0, 0.0]
const FLAK_SCALE := [0.2, 1.1, 1.5, 1.5]
const GREET_STOPS := [0.0, 0.12, 0.4, 0.55, 1.0]
const GREET_ALPHA := [0.0, 0.85, 0.85, 0.0, 0.0]
const GREET_RISE := [14.0, 0.0, 0.0, -10.0, 14.0]

static var _shader: Shader

var scene := ""
var still := false
var progress := 0.0
var clock := 0.0
var step := 0

var _layers := {}
var _boxes := {}
var _task := -1
var _jobs: Array = []
var _results := {}
var _built := Vector3.ZERO
var _wanted := Vector3.ZERO
var _pending_for := Vector3.ZERO
var _base := Transform2D.IDENTITY
var _unit := 1.0
var _ease_io: CubicBezier
var _ease_out: CubicBezier
var _ease_swap: CubicBezier
var _beam_a := PackedVector2Array([Vector2(420, 900), Vector2(470, 900), Vector2(760, 0), Vector2(620, 0)])
var _beam_b := PackedVector2Array([Vector2(1120, 900), Vector2(1160, 900), Vector2(980, 0), Vector2(860, 0)])
var _cloth := PackedVector2Array([Vector2(4, -118), Vector2(70, -108), Vector2(4, -88)])
var _cloth_ring := PackedVector2Array([Vector2(4, -118), Vector2(70, -108), Vector2(4, -88), Vector2(4, -118)])
var _flak := PackedVector2Array([Vector2(0, -18), Vector2(5, -5), Vector2(18, 0), Vector2(5, 5), Vector2(0, 18), Vector2(-5, 5), Vector2(-18, 0), Vector2(-5, -5)])
var _search := PackedVector2Array([Vector2(1040, 800), Vector2(1080, 800), Vector2(760, 40), Vector2(640, 60)])
var _tree := PackedVector2Array([Vector2(0, -80), Vector2(30, 0), Vector2(-30, 0)])
var _tree_ring := PackedVector2Array([Vector2(0, -80), Vector2(30, 0), Vector2(-30, 0), Vector2(0, -80)])
var _needle := PackedVector2Array([Vector2(-6, 0), Vector2(0, -132), Vector2(6, 0)])
var _star := PackedVector2Array([Vector2(0, -44), Vector2(10, -10), Vector2(44, 0), Vector2(10, 10), Vector2(0, 44), Vector2(-10, 10), Vector2(-44, 0), Vector2(-10, -10)])
var _hills: Array = []
var _hill_rings: Array = []
var _lake := PackedVector2Array()
var _lake_ring := PackedVector2Array()
var _cap := PackedVector2Array()
var _arrow_points: Array = []
var _arrow_lengths: Array = []
var _greetings := PackedStringArray()
var _palette_from: Array = PALETTES[0]
var _palette_to: Array = PALETTES[0]
var _palette_at := -10.0
var _palette_step := 0
var _now: Array = [Color(), Color(), Color()]
var _boxes_yw := {}
var _water: ColorRect
var _plane: ColorRect
var _globe: MapGlobe


func _init() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_ease_io = CubicBezier.named("ease-in-out")
	_ease_out = CubicBezier.named("ease-out")
	_ease_swap = CubicBezier.named("cubic-bezier(0.4, 0, 0.2, 1)")


func setup(key: String, reduce_motion: bool) -> void:
	scene = key
	still = reduce_motion
	match scene:
		"front":
			for arrow in ARROWS:
				var points := PackedVector2Array()
				var lengths := PackedFloat32Array()
				var total := 0.0
				for i in range(65):
					var t := i / 64.0
					var point := _bezier(arrow[0], arrow[1], arrow[2], arrow[3], t)
					if i > 0:
						total += point.distance_to(points[i - 1])
					points.append(point)
					lengths.append(total)
				_arrow_points.append(points)
				_arrow_lengths.append(lengths)
			for i in range(11):
				var angle := -PI * 0.5 + PI * i / 10.0
				_cap.append(Vector2(cos(angle), sin(angle)) * 7.0)
		"world":
			for points in [
				[Vector2(0, 470), Vector2(140, 380), Vector2(280, 430), Vector2(420, 340), Vector2(560, 420), Vector2(700, 360), Vector2(860, 440), Vector2(1000, 370), Vector2(1200, 430), Vector2(1200, 800), Vector2(0, 800)],
				[Vector2(0, 560), Vector2(180, 500), Vector2(360, 540), Vector2(540, 490), Vector2(720, 550), Vector2(900, 510), Vector2(1200, 560), Vector2(1200, 800), Vector2(0, 800)],
				[Vector2(0, 690), Vector2(200, 650), Vector2(420, 700), Vector2(640, 660), Vector2(860, 710), Vector2(1200, 670), Vector2(1200, 800), Vector2(0, 800)],
			]:
				var hill := PackedVector2Array(points)
				_hills.append(hill)
				var ring := hill.duplicate()
				ring.append(hill[0])
				_hill_rings.append(ring)
			for i in range(72):
				var angle := TAU * i / 72.0
				_lake.append(Vector2(420 + cos(angle) * 230, 640 + sin(angle) * 46))
			_lake_ring = _lake.duplicate()
			_lake_ring.append(_lake[0])
		"yours":
			for entry in FirstSetup.GREETINGS.slice(0, 12):
				_greetings.append(str(entry[1]))
			_boxes_yw = {
				"bg": _rounded(18, Color(1, 1, 1, 0.1)),
				"side": _rounded(12),
				"chip": _rounded(10),
				"chip_on": _rounded(10),
				"bar": _rounded(10),
				"card": _rounded(12),
				"inner": _rounded(8, Color(1, 1, 1, 0.1)),
				"pill": _rounded(22),
				"line_a": _rounded(5),
				"line_b": _rounded(4),
			}
			(_boxes_yw["chip"] as StyleBoxFlat).bg_color = Color(1, 1, 1, 0.14)
			(_boxes_yw["line_a"] as StyleBoxFlat).bg_color = Color(233 / 255.0, 238 / 255.0, 242 / 255.0, 0.75)
			(_boxes_yw["line_b"] as StyleBoxFlat).bg_color = Color(233 / 255.0, 238 / 255.0, 242 / 255.0, 0.3)
			_palette_step = step
			_palette_from = PALETTES[clampi(step, 0, 3)]
			_palette_to = _palette_from
		"engine":
			_boxes_yw = {"track": _rounded(18), "fill": _rounded(18)}
			(_boxes_yw["track"] as StyleBoxFlat).bg_color = Color("#1c232b")
			(_boxes_yw["fill"] as StyleBoxFlat).bg_color = Color("#c9d2dc")
		"map":
			_water = ColorRect.new()
			_water.color = Color("#081117")
			_water.mouse_filter = Control.MOUSE_FILTER_IGNORE
			_water.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
			add_child(_water)
			if _shader == null:
				_shader = Shader.new()
				_shader.code = MAP_SHADER
			_plane = ColorRect.new()
			_plane.mouse_filter = Control.MOUSE_FILTER_IGNORE
			_plane.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
			var material := ShaderMaterial.new()
			material.shader = _shader
			_plane.material = material
			_plane.visible = false
			add_child(_plane)
			_globe = MapGlobe.new()
			_globe.owner_scene = self
			add_child(_globe)


static func _rounded(radius: int, line := Color(0, 0, 0, 0)) -> StyleBoxFlat:
	var box := StyleBoxFlat.new()
	box.set_corner_radius_all(radius)
	box.corner_detail = 10
	box.anti_aliasing = true
	if line.a > 0.0:
		box.border_color = line
		box.set_border_width_all(1)
	return box


static func _bezier(a: Vector2, b: Vector2, c: Vector2, d: Vector2, t: float) -> Vector2:
	var u := 1.0 - t
	return a * u * u * u + b * 3.0 * u * u * t + c * 3.0 * u * t * t + d * t * t * t


func is_ready() -> bool:
	return _task < 0 and not _layers.is_empty()


func _cover_scale(w: float, h: float) -> float:
	var native: Vector2 = WIDE.get(scene, Vector2(1200, 800))
	return maxf(w / native.x, h / native.y)


func _plane_width() -> float:
	return minf(size.x * 0.96, 1400.0)


func _globe_size() -> float:
	return clampf(size.x * 0.12, 90.0, 180.0)


func prepare(factor: float) -> void:
	if size.x < 2.0 or size.y < 2.0:
		return
	_wanted = Vector3(factor, size.x, size.y)
	if _task >= 0 or _wanted.is_equal_approx(_built):
		return
	_start()


func _start() -> void:
	var factor := _wanted.x
	var layers: Dictionary = ReleaseArt.LAYERS.get(scene, {})
	var unit := _cover_scale(_wanted.y, _wanted.z)
	_jobs = []
	for id in layers:
		var item: Dictionary = layers[id]
		var box: Array = item["box"]
		var scale_by := unit * factor * float(RES.get(id, 1.0))
		var mipmaps := false
		if scene == "map":
			if id == "globe":
				scale_by = _globe_size() * factor / 200.0
			else:
				scale_by = _plane_width() * 1.22 * factor / 1000.0
				mipmaps = true
		var svg := "<svg xmlns='http://www.w3.org/2000/svg' viewBox='%s %s %s %s' width='%s' height='%s'>%s</svg>" % [box[0], box[1], box[2], box[3], box[2], box[3], item["svg"]]
		_jobs.append([id, svg, scale_by, mipmaps, Rect2(float(box[0]), float(box[1]), float(box[2]), float(box[3]))])
	_results = {}
	_pending_for = _wanted
	_task = WorkerThreadPool.add_task(_rasterize, false, "release scene")
	set_process(true)


func _rasterize() -> void:
	for job in _jobs:
		var image := Image.new()
		if image.load_svg_from_string(str(job[1]), float(job[2])) == OK:
			if bool(job[3]):
				image.generate_mipmaps()
			_results[str(job[0])] = image


func _process(_delta: float) -> void:
	if _task < 0:
		set_process(false)
		return
	if not WorkerThreadPool.is_task_completed(_task):
		return
	WorkerThreadPool.wait_for_task_completion(_task)
	_task = -1
	for job in _jobs:
		var id := str(job[0])
		_boxes[id] = job[4]
		if _results.has(id):
			_layers[id] = ImageTexture.create_from_image(_results[id])
	_results = {}
	_jobs = []
	_built = _pending_for
	if scene == "map" and _plane:
		var material := _plane.material as ShaderMaterial
		material.set_shader_parameter("plane", _layers.get("plane"))
		material.set_shader_parameter("relief", _layers.get("relief"))
		_plane.visible = _layers.has("plane")
		_globe.texture = _layers.get("globe")
	advance(progress, clock, step)
	if not _wanted.is_equal_approx(_built):
		_start()


func _exit_tree() -> void:
	if _task >= 0:
		WorkerThreadPool.wait_for_task_completion(_task)
		_task = -1


func advance(p: float, time: float, passage: int) -> void:
	progress = p
	clock = time
	if passage != step:
		step = passage
		if scene == "yours":
			_palette_colours()
			_palette_from = _now.duplicate()
			_palette_to = PALETTES[clampi(step, 0, 3)]
			_palette_at = clock
			_palette_step = step
	if scene == "map":
		_place_map()
		return
	queue_redraw()


func _palette_colours() -> void:
	var k := 1.0 if still else _ease_swap.at(clampf((clock - _palette_at) / 0.6, 0.0, 1.0))
	for i in range(3):
		_now[i] = (_palette_from[i] as Color).lerp(_palette_to[i], k)


func _phase(delay: float, duration: float) -> float:
	var local := clock - delay
	if still or local < 0.0:
		return -1.0
	return fmod(local, duration) / duration


func _key(u: float, stops: Array, values: Array, curve: CubicBezier) -> float:
	for i in range(stops.size() - 1):
		var high: float = stops[i + 1]
		if u <= high:
			var low: float = stops[i]
			var f := 0.0 if high <= low else (u - low) / (high - low)
			return lerpf(values[i], values[i + 1], curve.at(f))
	return values[values.size() - 1]


func _tex(id: String, xf: Transform2D, alpha := 1.0) -> void:
	var texture: Texture2D = _layers.get(id)
	if texture == null:
		return
	draw_set_transform_matrix(_base * xf)
	draw_texture_rect(texture, _boxes[id], false, Color(1, 1, 1, alpha))


func _solid(id: String, xf: Transform2D) -> void:
	var below: Array = SOLID[id]
	draw_set_transform_matrix(_base * xf)
	draw_rect(Rect2(-10.0, float(below[0]) - 0.5, 1620.0, 1500.0 - float(below[0])), below[1])


func _shape(points: PackedVector2Array, ring: PackedVector2Array, colour: Color) -> void:
	draw_colored_polygon(points, colour)
	draw_polyline(ring, colour, 1.0, true)


static func _move(x: float, y: float) -> Transform2D:
	return Transform2D(0.0, Vector2(x, y))


static func _turn(degrees: float, at: Vector2) -> Transform2D:
	var angle := deg_to_rad(degrees)
	return Transform2D(angle, at - at.rotated(angle))


static func _place(at: Vector2, degrees := 0.0, scaled := Vector2.ONE) -> Transform2D:
	return Transform2D(deg_to_rad(degrees), scaled, 0.0, at)


func _draw() -> void:
	if scene == "map" or scene.is_empty():
		return
	var native: Vector2 = WIDE.get(scene, Vector2(1200, 800))
	_unit = maxf(size.x / native.x, size.y / native.y)
	var x := (size.x - native.x * _unit) * 0.5
	var y := size.y - native.y * _unit if scene == "hero" else (size.y - native.y * _unit) * 0.5
	_base = Transform2D(0.0, Vector2(_unit, _unit), 0.0, Vector2(x, y))
	match scene:
		"hero":
			_draw_hero()
		"front":
			_draw_front()
		"skies":
			_draw_skies()
		"table":
			_draw_table()
		"world":
			_draw_world()
		"yours":
			_draw_yours()
		"engine":
			_draw_engine()
		"finale":
			_draw_finale()
	draw_set_transform_matrix(Transform2D.IDENTITY)


func _swing(delay: float, duration: float) -> float:
	var local := clock - delay
	if still or local < 0.0:
		return -1.0
	var turns := local / duration
	var f := turns - floorf(turns)
	return 1.0 - f if int(floorf(turns)) % 2 == 1 else f


func _twinkle(delay: float, duration: float, rest: float) -> float:
	var u := _phase(delay, duration)
	if u < 0.0:
		return rest
	if u < 0.5:
		return lerpf(0.25, 1.0, _ease_io.at(u / 0.5))
	return lerpf(1.0, 0.25, _ease_io.at((u - 0.5) / 0.5))


func _draw_hero() -> void:
	var p := progress
	draw_set_transform_matrix(_base)
	draw_rect(Rect2(-10, -10, 1620, 920), HERO_SKY)
	draw_set_transform_matrix(_base * _move(0, -40.0 * p))
	for i in range(70):
		var alpha := 0.8 if still else _twinkle((i % 9) * 0.4, 3.6, 1.0)
		draw_circle(Vector2((i * 233) % 1600, (i * 97) % 420), 1.8 if i % 7 == 0 else 1.0, Color(STAR, alpha), true, -1.0, true)
	_tex("moon", _move(0, -90.0 * p))
	for which in range(2):
		var swung := _swing(0.0 if which == 0 else -4.5, 9.0)
		var angle := 0.0 if swung < 0.0 else lerpf(-9.0, 9.0, _ease_io.at(swung))
		draw_set_transform_matrix(_base * _move(0, -60.0 * p) * _turn(angle, Vector2(590, 900) if which == 0 else Vector2(1010, 900)))
		draw_colored_polygon(_beam_a if which == 0 else _beam_b, BEAM)
	var fly := Transform2D.IDENTITY
	if not still:
		var u := fmod(clock, 26.0) / 26.0
		fly = _move(lerpf(-500.0, 2000.0, u), lerpf(300.0, 80.0, u))
	_tex("planes", _move(0, -160.0 * p) * fly)
	_tex("far", _move(0, -60.0 * p))
	_solid("far", _move(0, -60.0 * p))
	var mid := _move(0, -130.0 * p)
	_tex("mid", mid)
	_solid("mid", mid)
	draw_set_transform_matrix(_base * mid)
	var lamp := 1.0 if still else _twinkle(0.0, 4.2, 1.0)
	draw_rect(Rect2(1080, 458, 7, 12), Color(WINDOW, lamp))
	draw_rect(Rect2(1176, 488, 7, 12), Color(WINDOW, lamp))
	var near := _move(0, -220.0 * p)
	_tex("near", near)
	_solid("near", near)
	var wave := Transform2D.IDENTITY
	var waving := _swing(0.0, 2.8)
	if waving >= 0.0:
		var e := _ease_io.at(waving)
		var skew := deg_to_rad(lerpf(-6.0, 5.0, e))
		var stretch := lerpf(0.94, 1.0, e)
		var basis := Transform2D(Vector2(stretch, stretch * tan(skew)), Vector2(0, 1), Vector2.ZERO)
		var origin := Vector2(4, -103)
		wave = Transform2D(basis.x, basis.y, origin - basis.basis_xform(origin))
	for flag in FLAGS:
		draw_set_transform_matrix(_base * near * Transform2D(0.0, flag) * wave)
		_shape(_cloth, _cloth_ring, CLOTH)
	draw_set_transform_matrix(_base)
	if not still:
		for i in range(26):
			var u := _phase(((i * 370) % 6000) / 1000.0, (5200 + (i % 6) * 700) / 1000.0)
			if u < 0.0:
				continue
			var alpha := 0.9 * u / 0.12 if u < 0.12 else 0.9 * (1.0 - (u - 0.12) / 0.88)
			draw_circle(Vector2((i * 61) % 1600 + 40.0 * u, 760 + (i % 5) * 22 - 420.0 * u), 3.0 if i % 4 == 0 else 2.0, Color(EMBER, alpha), true, -1.0, true)
	_tex("front", _move(0, -320.0 * p))
	_solid("front", _move(0, -320.0 * p))


func _draw_front() -> void:
	var p := progress
	_tex("base", Transform2D.IDENTITY)
	_tex("enemy", _move(300.0 * p, 0))
	_tex("fortline", _move(300.0 * p, 0), clampf(1.0 - p * 1.5, 0.0, 1.0))
	_tex("own", _move(260.0 * p, 0))
	for index in range(ARROWS.size()):
		_draw_arrow(index, p)
	_tex("swarm", _move(380.0 * p, -120.0 * p))
	if still:
		return
	for index in range(BURSTS.size()):
		var at: Vector2 = BURSTS[index]
		draw_set_transform_matrix(_base)
		var u := _phase(index * 0.65, 2.6)
		if u >= 0.0:
			draw_circle(at, 16.0 * _key(u, FLASH_STOPS, FLASH_SCALE, _ease_out), Color(FLASH, _key(u, FLASH_STOPS, FLASH_ALPHA, _ease_out)), true, -1.0, true)
		u = _phase(index * 0.65 + 0.3, 2.6)
		if u >= 0.0:
			var k := _key(u, SMOKE_MOVE_STOPS, SMOKE_MOVE, _ease_out)
			draw_circle(at + Vector2(14.0 * k, -70.0 * k), 12.0 * lerpf(0.6, 2.2, k), Color(SMOKE, _key(u, SMOKE_ALPHA_STOPS, SMOKE_ALPHA, _ease_out)), true, -1.0, true)


func _draw_arrow(index: int, p: float) -> void:
	var arrow: Array = ARROWS[index]
	var id: String = arrow[6]
	var texture: Texture2D = _layers.get(id)
	if texture == null:
		return
	var points: PackedVector2Array = _arrow_points[index]
	var lengths: PackedFloat32Array = _arrow_lengths[index]
	var total := lengths[lengths.size() - 1]
	var shown := minf(float(arrow[5]) * p, float(arrow[4]))
	if shown <= 0.0:
		return
	if shown >= total:
		_tex(id, Transform2D.IDENTITY, ARROW.a)
		return
	var at := 1
	while at < lengths.size() - 1 and lengths[at] < shown:
		at += 1
	var span := lengths[at] - lengths[at - 1]
	var f := 0.0 if span <= 0.0 else (shown - lengths[at - 1]) / span
	var tip := points[at - 1].lerp(points[at], f)
	var heading := (points[at] - points[at - 1]).angle()
	var box: Rect2 = _boxes[id]
	var k := texture.get_width() / box.size.x
	var cut := tip.x - box.position.x
	draw_set_transform_matrix(_base)
	draw_texture_rect_region(texture, Rect2(box.position, Vector2(cut, box.size.y)), Rect2(0, 0, cut * k, box.size.y * k), Color(1, 1, 1, ARROW.a))
	draw_set_transform_matrix(_base * Transform2D(heading, tip))
	draw_colored_polygon(_cap, ARROW)


func _draw_skies() -> void:
	var p := progress
	draw_set_transform_matrix(_base)
	draw_rect(Rect2(-10, -10, 1220, 820), SKIES_SKY)
	_tex("clouds", _move(-160.0 * p, 0))
	draw_set_transform_matrix(_base * _turn(-50.0 * p + 20.0, Vector2(1036, 800)))
	draw_colored_polygon(_search, SEARCH)
	_tex("bombers", Transform2D(0.0, Vector2(0.82, 0.82), 0.0, Vector2(1150.0 * p - 200.0, 340.0 - 100.0 * p)))
	_tex("interceptors", _move(1300.0 - 760.0 * p, 470.0 - 230.0 * p))
	if not still:
		for index in range(FLAKS.size()):
			var u := _phase(index * 0.52, 2.1)
			if u < 0.0:
				continue
			var grown := _key(u, FLAK_STOPS, FLAK_SCALE, _ease_out)
			draw_set_transform_matrix(_base * Transform2D(0.0, Vector2(grown, grown), 0.0, FLAKS[index]))
			draw_colored_polygon(_flak, Color(FLAK, _key(u, FLAK_STOPS, FLAK_ALPHA, _ease_out)))
	draw_set_transform_matrix(_base)
	draw_rect(Rect2(-10, 520, 1220, 300), SEA)
	_tex("waves", _move(0.0 if still else 160.0 * fmod(clock, 4.0) / 4.0, 0))
	_tex("fleet", _move(320.0 * p, 0))


func _draw_table() -> void:
	var p := progress
	_tex("base", Transform2D.IDENTITY)
	_tex("treaty_left", _place(Vector2(330.0 + 210.0 * p, 330.0 + 60.0 * p), -14.0 + 10.0 * p))
	_tex("treaty_right", _place(Vector2(870.0 - 210.0 * p, 470.0 - 60.0 * p), 16.0 - 12.0 * p))
	var seal := clampf(2.4 - 1.6 * p, 0.6, 1.8)
	_tex("seal", _place(Vector2(600, 400), 0.0, Vector2(seal, seal)), clampf(4.0 * p - 2.2, 0.0, 1.0))
	var doves := clampf(4.0 * p - 2.8, 0.0, 1.0)
	if doves <= 0.0:
		return
	_tex("dove", _place(Vector2(600.0 - 380.0 * p, 400.0 - 300.0 * p), 0.0, Vector2(1.4, 1.4)), doves)
	_tex("dove", _place(Vector2(600.0 + 380.0 * p, 400.0 - 300.0 * p), 0.0, Vector2(-1.4, 1.4)), doves)
	_tex("dove", _place(Vector2(600.0 - 420.0 * p, 400.0 + 240.0 * p), 0.0, Vector2(1.2, 1.2)), doves)
	_tex("dove", _place(Vector2(600.0 + 420.0 * p, 400.0 + 240.0 * p), 0.0, Vector2(-1.2, 1.2)), doves)


func _season(index: int, p: float) -> Color:
	var pair: Array = SEASONS[index]
	return (pair[0] as Color).lerp(pair[1], p)


func _draw_world() -> void:
	var p := progress
	draw_set_transform_matrix(_base)
	draw_rect(Rect2(-10, -10, 1220, 820), _season(0, p))
	draw_set_transform_matrix(_base * _turn(120.0 * p - 60.0, Vector2(600, 760)))
	draw_circle(Vector2(600, 120), 46.0, SUN, true, -1.0, true)
	draw_set_transform_matrix(_base)
	_shape(_hills[0], _hill_rings[0], _season(1, p))
	_shape(_hills[1], _hill_rings[1], _season(2, p))
	_shape(_lake, _lake_ring, _season(3, p))
	_shape(_hills[2], _hill_rings[2], _season(4, p))
	var tree := _season(5, p)
	for at in TREES:
		draw_set_transform_matrix(_base * Transform2D(0.0, at))
		_shape(_tree, _tree_ring, tree)
	draw_set_transform_matrix(_base)
	var rain := clampf(minf(p * 5.0 - 1.0, 3.0 - p * 5.0), 0.0, 1.0)
	if rain > 0.0:
		var colour := Color(RAIN, rain)
		for i in range(40):
			var u := _phase(((i * 90) % 900) / 1000.0, 0.9)
			var dy := 0.0 if u < 0.0 else -40.0 + 360.0 * u
			var start := Vector2((i * 31) % 1200, (i * 53) % 500 + dy)
			draw_line(start, start + Vector2(-10, 26), colour, 2.0, true)
	var snow := clampf(p * 4.0 - 2.0, 0.0, 1.0)
	if snow > 0.0 and not still:
		var flake := Color(SNOW, snow)
		for i in range(46):
			var u := _phase(((i * 260) % 5000) / 1000.0, (5000 + (i % 5) * 900) / 1000.0)
			var fall := maxf(u, 0.0)
			draw_circle(Vector2((i * 29) % 1200 - 40.0 * fall, -20.0 + 860.0 * fall), 4.0 if i % 3 == 0 else 2.5, flake, true, -1.0, true)
	_tex("phone", Transform2D.IDENTITY)
	var texture: Texture2D = _layers.get("feed")
	if texture == null:
		return
	var box: Rect2 = _boxes["feed"]
	var shift := -420.0 * p
	var top := maxf(24.0 - shift, box.position.y)
	var bottom := minf(394.0 - shift, box.end.y)
	if bottom <= top:
		return
	var k := texture.get_width() / box.size.x
	draw_set_transform_matrix(_base * _move(520, 170))
	draw_texture_rect_region(texture, Rect2(box.position.x, top + shift, box.size.x, bottom - top), Rect2(0, (top - box.position.y) * k, box.size.x * k, (bottom - top) * k))


func _draw_yours() -> void:
	var p := progress
	_palette_colours()
	var bg: Color = _now[0]
	var surface: Color = _now[1]
	var accent: Color = _now[2]
	draw_set_transform_matrix(_base)
	draw_rect(Rect2(-10, -10, 1220, 820), bg.lerp(ABYSS, 0.45))
	_tex("wheel", Transform2D.IDENTITY)
	var spin := _place(Vector2(250, 420), 300.0 * p)
	_tex("spokes", spin)
	draw_set_transform_matrix(_base * spin)
	draw_colored_polygon(_star, accent)
	draw_polyline(_star, accent, 1.0, true)
	draw_line(_star[_star.size() - 1], _star[0], accent, 1.0, true)
	draw_set_transform_matrix(_base * _move(560, 170))
	var boxes := _boxes_yw
	(boxes["bg"] as StyleBoxFlat).bg_color = bg
	(boxes["inner"] as StyleBoxFlat).bg_color = bg
	(boxes["side"] as StyleBoxFlat).bg_color = surface
	(boxes["bar"] as StyleBoxFlat).bg_color = surface
	(boxes["card"] as StyleBoxFlat).bg_color = surface
	(boxes["chip_on"] as StyleBoxFlat).bg_color = accent
	(boxes["pill"] as StyleBoxFlat).bg_color = accent
	draw_style_box(boxes["bg"], Rect2(0, 0, 560, 460))
	draw_style_box(boxes["side"], Rect2(16, 16, 96, 428))
	for i in range(5):
		draw_style_box(boxes["chip_on"] if i == 0 else boxes["chip"], Rect2(32, 36 + i * 62, 64, 44))
	draw_style_box(boxes["bar"], Rect2(128, 16, 424, 48))
	for i in range(2):
		var left := 128.0 + i * 216.0
		draw_style_box(boxes["card"], Rect2(left, 80, 208, 280))
		draw_style_box(boxes["inner"], Rect2(left + 12, 92, 184, 110))
		draw_style_box(boxes["line_a"], Rect2(left + 14, 220, 120, 10))
		draw_style_box(boxes["line_b"], Rect2(left + 14, 242, 170, 8))
		draw_style_box(boxes["line_b"], Rect2(left + 14, 260, 140, 8))
	draw_style_box(boxes["pill"], Rect2(354, 390, 190, 44))
	draw_set_transform_matrix(Transform2D.IDENTITY)
	var font := ReleaseNotice.font(true, 800)
	var font_size := maxi(1, int(round(34.0 * _unit)))
	for i in range(_greetings.size()):
		var alpha := 0.8
		var rise := 0.0
		if not still:
			var u := _phase(i * 0.9, 10.8)
			if u < 0.0:
				continue
			alpha = _key(u, GREET_STOPS, GREET_ALPHA, _ease_io)
			rise = _key(u, GREET_STOPS, GREET_RISE, _ease_io)
			if alpha <= 0.0:
				continue
		var at := _base * Vector2(60 + (i % 6) * 190, (110.0 if i < 6 else 730.0) + rise)
		draw_string(font, at, _greetings[i], HORIZONTAL_ALIGNMENT_LEFT, -1, font_size, Color(GREETING, alpha))


func _draw_engine() -> void:
	var p := progress
	draw_set_transform_matrix(_base)
	draw_rect(Rect2(-10, -10, 1220, 820), WORKS)
	for i in range(14):
		var u := _phase(((i * 230) % 1400) / 1000.0, 1.4)
		var dx := 0.0
		var alpha := 1.0
		if u >= 0.0:
			dx = 1500.0 * u
			alpha = u / 0.2 if u < 0.2 else 1.0 - (u - 0.2) / 0.8
		var y := 60.0 + i * 52.0
		draw_line(Vector2(-200.0 + dx, y), Vector2(180.0 + (i % 4) * 90.0 + dx, y), Color(SPEED, SPEED.a * alpha), 3.0, true)
	_tex("gear_big", _place(Vector2(420, 420), 200.0 * p))
	_tex("gear_small", _place(Vector2(694, 228), -357.0 * p))
	_tex("gear_tiny", _place(Vector2(700, 560), -450.0 * p))
	draw_set_transform_matrix(_base * _move(960, 300))
	draw_arc(Vector2.ZERO, 150.0, PI, TAU, 64, GAUGE, 22.0, true)
	var filled := clampf(p * 472.0 / (PI * 150.0), 0.0, 1.0)
	if filled > 0.0:
		draw_arc(Vector2.ZERO, 150.0, PI, PI + PI * filled, maxi(2, int(64 * filled)), GAUGE_FILL, 22.0, true)
	for i in range(11):
		var angle := PI + PI * i / 10.0
		draw_line(Vector2(cos(angle), sin(angle)) * 120.0, Vector2(cos(angle), sin(angle)) * 104.0, TICK, 4.0, true)
	draw_set_transform_matrix(_base * _place(Vector2(960, 300), 180.0 * p - 90.0))
	draw_colored_polygon(_needle, NEEDLE)
	draw_set_transform_matrix(_base * _move(960, 300))
	draw_circle(Vector2.ZERO, 14.0, NEEDLE, true, -1.0, true)
	draw_set_transform_matrix(_base * _move(820, 560))
	draw_style_box(_boxes_yw["track"], Rect2(0, 0, 300, 36))
	draw_set_transform_matrix(_base * Transform2D(0.0, Vector2(1.0 - 0.45 * p, 1.0), 0.0, Vector2(820, 560)))
	draw_style_box(_boxes_yw["fill"], Rect2(0, 0, 300, 36))


func _draw_finale() -> void:
	var p := progress
	_tex("base", Transform2D.IDENTITY)
	_tex("ring_outer", _place(Vector2(600, 400), 90.0 * p))
	_tex("ring_inner", _place(Vector2(600, 400), -60.0 * p))
	_tex("star", _move(600, 400))


func _place_map() -> void:
	if _plane == null:
		return
	var p := progress
	var w := size.x
	var h := size.y
	var plane_w := _plane_width()
	var plane_h := plane_w * 0.7
	var sc := 0.88 + 0.34 * p
	var az := deg_to_rad(-24.0 * p)
	var ax := deg_to_rad(52.0 * p)
	var c := cos(az)
	var s := sin(az)
	var depth := 1400.0
	var ox := w * 0.5
	var oy := h * 0.5
	var cx := w * 0.44
	var cy := h * 0.5
	var along_y := Vector3(sc * s, sc * c, -sc * (s * plane_w * 0.5 + c * plane_h * 0.5))
	var along_x := Vector3(sc * c, -sc * s, -sc * (c * plane_w * 0.5 - s * plane_h * 0.5))
	var row_w := Vector3(0, 0, 1) - along_y * (sin(ax) / depth)
	var row_x := row_w * ox + Vector3(0, 0, cx - ox) + along_x
	var row_y := row_w * oy + Vector3(0, 0, cy - oy) + along_y * cos(ax)
	var forward := Basis(Vector3(row_x.x, row_y.x, row_w.x), Vector3(row_x.y, row_y.y, row_w.y), Vector3(row_x.z, row_y.z, row_w.z))
	var back := forward.inverse()
	var material := _plane.material as ShaderMaterial
	material.set_shader_parameter("row_x", Vector3(back.x.x, back.y.x, back.z.x))
	material.set_shader_parameter("row_y", Vector3(back.x.y, back.y.y, back.z.y))
	material.set_shader_parameter("row_w", Vector3(back.x.z, back.y.z, back.z.z))
	material.set_shader_parameter("extent", Vector2(plane_w, plane_h))
	material.set_shader_parameter("lift", 18.0 * p / 700.0)
	var globe := _globe_size()
	_globe.size = Vector2(globe, globe)
	_globe.position = Vector2(w - minf(704.0, w * 0.48) - w * 0.03 - globe, h * 0.92 - globe)
	_globe.queue_redraw()


class MapGlobe:
	extends Control

	var owner_scene: ReleaseScene
	var texture: Texture2D
	var _ring := PackedVector2Array()

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		_ring.resize(65)

	func _draw() -> void:
		if texture == null:
			return
		draw_texture_rect(texture, Rect2(Vector2.ZERO, size), false)
		var unit := size.x / 200.0
		var centre := Vector2(100, 100) * unit
		for index in range(3):
			var turn := 1.0
			if owner_scene and not owner_scene.still:
				var local := owner_scene.clock + index * 2.0
				turn = 1.0 - 2.0 * (fmod(local, 6.0) / 6.0)
			var across := 90.0 * unit * turn
			if absf(across) < 0.05:
				continue
			for i in range(65):
				var angle := TAU * i / 64.0
				_ring[i] = centre + Vector2(cos(angle) * across, sin(angle) * 90.0 * unit)
			draw_polyline(_ring, MERIDIAN, 2.0 * unit, true)
