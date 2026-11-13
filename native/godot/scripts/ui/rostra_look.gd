class_name RostraLook
extends RefCounted

const LOOKS := ["phone", "newspaper", "scroll", "tablet"]
const REM := 16.0

const GRAINS := {
	"newspaper": [
		{"size": 180, "freq": Vector2(0.85, 0.85), "octaves": 2, "seed": 3, "colour": Color(0.22, 0.18, 0.1), "k": 0.42, "c": -0.16},
		{"size": 360, "freq": Vector2(0.004, 0.09), "octaves": 2, "seed": 8, "colour": Color(0.35, 0.28, 0.15), "k": 0.3, "c": -0.17},
	],
	"scroll": [
		{"size": 160, "freq": Vector2(0.7, 0.7), "octaves": 2, "seed": 5, "colour": Color(0.3, 0.18, 0.05), "k": 0.5, "c": -0.19},
		{"size": 420, "freq": Vector2(0.009, 0.009), "octaves": 4, "seed": 11, "colour": Color(0.5, 0.3, 0.08), "k": 1.05, "c": -0.45, "spread": 0.7},
	],
	"tablet": [
		{"size": 140, "freq": Vector2(1.7, 1.7), "octaves": 1, "seed": 2, "colour": Color(1, 1, 0.96), "k": 2.6, "c": -1.75},
		{"size": 150, "freq": Vector2(1.5, 1.5), "octaves": 1, "seed": 9, "colour": Color(0.12, 0.11, 0.1), "k": 2.4, "c": -1.6},
		{"size": 200, "freq": Vector2(0.9, 0.9), "octaves": 3, "seed": 4, "colour": Color(0.16, 0.15, 0.13), "k": 0.62, "c": -0.24},
		{"size": 460, "freq": Vector2(0.011, 0.011), "octaves": 4, "seed": 6, "colour": Color(0.2, 0.19, 0.16), "k": 0.95, "c": -0.38, "spread": 0.7},
	],
}

const FRAMES := {
	"newspaper": {
		"padding": Vector4(0.75, 0.7, 0.75, 0.65),
		"margin": 0.0,
		"drops": [[Vector2(0, 16), 26.0, Color(0, 0, 0, 0.5)], [Vector2(0, 2), 3.0, Color(0, 0, 0, 0.3)]],
		"material": {"base": Color("#f0e9d6"), "border": [1.0, Color("#cbbf9f")], "top": Vector2(2, 2), "bottom": Vector2(2, 2), "insets": [[Vector2.ZERO, 34.0, Color(150 / 255.0, 118 / 255.0, 58 / 255.0, 0.22)]]},
	},
	"scroll": {
		"padding": Vector4(0.9, 0.55, 0.9, 0.6),
		"margin": 1.35,
		"drops": [[Vector2(0, 16), 24.0, Color(0, 0, 0, 0.5)]],
		"material": {"base": Color("#eddaa9"), "insets": [[Vector2.ZERO, 46.0, Color(120 / 255.0, 72 / 255.0, 18 / 255.0, 0.42)], [Vector2.ZERO, 10.0, Color(120 / 255.0, 72 / 255.0, 18 / 255.0, 0.3)]]},
	},
	"tablet": {
		"padding": Vector4(0.95, 1.9, 0.95, 0.95),
		"margin": 0.0,
		"drops": [[Vector2(0, 18), 26.0, Color(0, 0, 0, 0.55)], [Vector2(0, 2), 2.0, Color(0, 0, 0, 0.35)]],
		"material": {"base": Color("#a29d91"), "top": Vector2(11 * 16.0, 5.2 * 16.0), "bottom": Vector2(0.9 * 16.0, 0.9 * 16.0), "insets": [[Vector2(0, 3), 0.0, Color(1, 1, 1, 0.28)], [Vector2(0, -4), 0.0, Color(0, 0, 0, 0.28)], [Vector2.ZERO, 28.0, Color(0, 0, 0, 0.22)]]},
		"inner": {"base": Color(40 / 255.0, 36 / 255.0, 30 / 255.0, 0.07), "top": Vector2(8.5 * 16.0, 3.4 * 16.0), "bottom": Vector2(8, 8), "insets": [[Vector2(0, 3), 6.0, Color(0, 0, 0, 0.4)], [Vector2(0, -1), 0.0, Color(1, 1, 1, 0.35)]], "drops": [[Vector2(0, 1), 0.0, Color(1, 1, 1, 0.3)]]},
		"inner_top": 1.6,
	},
}

const SURFACE_SHADER := """
shader_type canvas_item;
uniform vec2 box = vec2(100.0, 100.0);
uniform float outset = 0.0;
uniform vec4 base : source_color = vec4(1.0);
uniform vec2 r_top = vec2(0.0);
uniform vec2 r_bottom = vec2(0.0);
uniform int jag_n = 0;
uniform float jag_l[72];
uniform float jag_r[72];
uniform float jag_b[72];
uniform int layers = 0;
uniform sampler2D grain0 : repeat_enable, filter_linear;
uniform sampler2D grain1 : repeat_enable, filter_linear;
uniform sampler2D grain2 : repeat_enable, filter_linear;
uniform sampler2D grain3 : repeat_enable, filter_linear;
uniform vec4 tint[4];
uniform vec4 curve[4];
uniform int insets = 0;
uniform vec4 inset_col[3];
uniform vec4 inset_geo[3];
uniform int drops = 0;
uniform vec4 drop_col[2];
uniform vec4 drop_geo[2];
uniform float border_w = 0.0;
uniform vec4 border_col = vec4(0.0);

float jl(float t) {
	if (jag_n <= 0) return 0.0;
	float f = clamp(t, 0.0, 1.0) * float(jag_n);
	int i = int(floor(f));
	int j = min(i + 1, jag_n);
	return mix(jag_l[i], jag_l[j], f - float(i));
}
float jr(float t) {
	if (jag_n <= 0) return 0.0;
	float f = clamp(t, 0.0, 1.0) * float(jag_n);
	int i = int(floor(f));
	int j = min(i + 1, jag_n);
	return mix(jag_r[i], jag_r[j], f - float(i));
}
float jb(float t) {
	if (jag_n <= 0) return 0.0;
	float f = clamp(t, 0.0, 1.0) * float(jag_n);
	int i = int(floor(f));
	int j = min(i + 1, jag_n);
	return mix(jag_b[i], jag_b[j], f - float(i));
}

float sdf(vec2 p) {
	vec2 h = box * 0.5;
	vec2 q = p - h;
	vec2 r = q.y < 0.0 ? r_top : r_bottom;
	r = min(r, h);
	vec2 d = abs(q) - (h - r);
	float s;
	if (d.x > 0.0 && d.y > 0.0 && r.x > 0.0 && r.y > 0.0) {
		s = (length(d / r) - 1.0) * min(r.x, r.y);
	} else {
		s = max(abs(q.x) - h.x, abs(q.y) - h.y);
	}
	s = max(s, jl(p.y / box.y) - p.x);
	s = max(s, p.x - (box.x - jr(p.y / box.y)));
	s = max(s, p.y - (box.y - jb(p.x / box.x)));
	return s;
}

float cover(float s, float blur) {
	if (blur <= 0.0) return clamp(0.5 - s, 0.0, 1.0);
	return 1.0 - smoothstep(-blur, blur, s);
}

vec4 over(vec4 under, vec3 c, float a) {
	float out_a = a + under.a * (1.0 - a);
	if (out_a <= 0.0) return vec4(0.0);
	vec3 rgb = (c * a + under.rgb * under.a * (1.0 - a)) / out_a;
	return vec4(rgb, out_a);
}

float grain(int i, vec2 p) {
	vec2 uv = p / curve[i].zw;
	if (i == 0) return texture(grain0, uv).r;
	if (i == 1) return texture(grain1, uv).r;
	if (i == 2) return texture(grain2, uv).r;
	return texture(grain3, uv).r;
}

void fragment() {
	vec2 p = UV * (box + 2.0 * outset) - outset;
	float s = sdf(p);
	vec4 fill = vec4(base.rgb, base.a);
	for (int i = layers - 1; i >= 0; i--) {
		float n = 0.5 + (grain(i, p) - 0.5) * tint[i].a;
		float a = clamp(curve[i].x * n + curve[i].y, 0.0, 1.0);
		fill = over(fill, tint[i].rgb, a);
	}
	for (int i = insets - 1; i >= 0; i--) {
		float c = cover(sdf(p - inset_geo[i].xy), inset_geo[i].z);
		fill = over(fill, inset_col[i].rgb, inset_col[i].a * (1.0 - c));
	}
	if (border_w > 0.0) {
		float a = clamp(s + border_w + 0.5, 0.0, 1.0);
		fill = over(fill, border_col.rgb, border_col.a * a);
	}
	fill.a *= clamp(0.5 - s, 0.0, 1.0);
	vec4 shade = vec4(0.0);
	for (int i = drops - 1; i >= 0; i--) {
		float c = cover(sdf(p - drop_geo[i].xy), drop_geo[i].z);
		shade = over(shade, drop_col[i].rgb, drop_col[i].a * c);
	}
	COLOR = over(shade, fill.rgb, fill.a);
}
"""

const FLAG_SHADER := """
shader_type canvas_item;
render_mode blend_mul;
uniform int look = 0;
void fragment() {
	vec4 c = texture(TEXTURE, UV);
	vec3 rgb = c.rgb;
	float grey = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
	if (look == 1) {
		rgb = vec3(grey);
		rgb = (rgb - 0.5) * 1.35 + 0.5;
		rgb *= 0.92;
	} else if (look == 2) {
		vec3 sep = vec3(dot(rgb, vec3(0.393, 0.769, 0.189)), dot(rgb, vec3(0.349, 0.686, 0.168)), dot(rgb, vec3(0.272, 0.534, 0.131)));
		rgb = mix(rgb, sep, 0.75);
		float g2 = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
		rgb = mix(vec3(g2), rgb, 0.7);
		rgb = (rgb - 0.5) * 0.95 + 0.5;
	} else if (look == 3) {
		rgb = mix(rgb, vec3(grey), 0.85);
		vec3 sep = vec3(dot(rgb, vec3(0.393, 0.769, 0.189)), dot(rgb, vec3(0.349, 0.686, 0.168)), dot(rgb, vec3(0.272, 0.534, 0.131)));
		rgb = mix(rgb, sep, 0.25);
		rgb = (rgb - 0.5) * 0.85 + 0.5;
		rgb *= 1.05;
		rgb = mix(vec3(1.0), rgb, 0.85);
	}
	rgb = clamp(rgb, 0.0, 1.0);
	COLOR = vec4(mix(vec3(1.0), rgb, c.a), 1.0);
}
"""

const SHADOW_SHADER := """
shader_type canvas_item;
uniform vec4 tint : source_color = vec4(1.0, 1.0, 1.0, 0.4);
void fragment() {
	COLOR = vec4(tint.rgb, tint.a * texture(TEXTURE, UV).a);
}
"""

static var _surface_shader: Shader
static var _flag_materials := {}
static var _grains := {}
static var _fonts := {}
static var _marks := {}


static func index_of(look: String) -> int:
	return maxi(0, LOOKS.find(look))


static func color_of(css: Variant, fallback: Color) -> Color:
	var value := str(css).strip_edges()
	if value.begins_with("#"):
		return Color.html(value) if Color.html_is_valid(value) else fallback
	if value.begins_with("rgb"):
		var inside := value.substr(value.find("(") + 1)
		inside = inside.substr(0, inside.find(")"))
		var parts := inside.split(",")
		if parts.size() < 3:
			return fallback
		var alpha := float(parts[3]) if parts.size() > 3 else 1.0
		return Color(float(parts[0]) / 255.0, float(parts[1]) / 255.0, float(parts[2]) / 255.0, alpha)
	return fallback


static func families(css: Variant) -> PackedStringArray:
	var out := PackedStringArray()
	for part in str(css).split(","):
		var name := part.strip_edges().trim_prefix("'").trim_suffix("'").trim_prefix("\"").trim_suffix("\"")
		if not name.is_empty():
			out.append(name)
	if out.is_empty():
		out.append("sans-serif")
	for extra in ["Segoe UI Symbol", "Segoe UI Emoji"]:
		if not out.has(extra):
			out.append(extra)
	return out


static func font(names: PackedStringArray, weight := 400, italic := false, spacing := 0.0) -> Font:
	var key := "%s|%d|%s|%s" % [",".join(names), weight, italic, spacing]
	if _fonts.has(key):
		return _fonts[key]
	var system := SystemFont.new()
	system.font_names = names
	system.font_weight = 700 if weight > 700 and weight < 800 else weight
	system.font_italic = italic
	system.antialiasing = TextServer.FONT_ANTIALIASING_GRAY
	system.hinting = TextServer.HINTING_LIGHT
	system.subpixel_positioning = TextServer.SUBPIXEL_POSITIONING_AUTO
	var result: Font = system
	if spacing != 0.0:
		var variation := FontVariation.new()
		variation.base_font = system
		variation.spacing_glyph = int(round(spacing))
		result = variation
	_fonts[key] = result
	return result


static func grain(look: String, index: int) -> Texture2D:
	var key := "%s:%d" % [look, index]
	if _grains.has(key):
		return _grains[key]
	var spec: Dictionary = (GRAINS.get(look, []) as Array)[index]
	var size := int(spec["size"])
	var freq: Vector2 = spec["freq"]
	var noise := FastNoiseLite.new()
	noise.noise_type = FastNoiseLite.TYPE_PERLIN
	noise.seed = int(spec["seed"])
	noise.fractal_type = FastNoiseLite.FRACTAL_FBM if int(spec["octaves"]) > 1 else FastNoiseLite.FRACTAL_NONE
	noise.fractal_octaves = int(spec["octaves"])
	noise.fractal_lacunarity = 2.0
	noise.fractal_gain = 0.5
	noise.frequency = freq.y
	var wide := size
	if not is_equal_approx(freq.x, freq.y):
		wide = maxi(4, int(round(float(size) * freq.x / freq.y)))
	var image := noise.get_seamless_image(wide, size, false, false, 0.1, false)
	image.convert(Image.FORMAT_L8)
	var texture := ImageTexture.create_from_image(image)
	_grains[key] = texture
	return texture


static func surface_shader() -> Shader:
	if _surface_shader == null:
		_surface_shader = Shader.new()
		_surface_shader.code = SURFACE_SHADER
	return _surface_shader


static func flag_material(look: String) -> Material:
	if look == "phone":
		return null
	if _flag_materials.has(look):
		return _flag_materials[look]
	var shader := Shader.new()
	shader.code = FLAG_SHADER
	var material := ShaderMaterial.new()
	material.shader = shader
	material.set_shader_parameter("look", index_of(look))
	_flag_materials[look] = material
	return material


static func silhouette(tint: Color) -> Material:
	var shader := Shader.new()
	shader.code = SHADOW_SHADER
	var material := ShaderMaterial.new()
	material.shader = shader
	material.set_shader_parameter("tint", tint)
	return material


static func edge_jags(points: Array) -> Dictionary:
	var left := {}
	var right := {}
	var bottom := {}
	for point in points:
		var p: Array = point
		if p.size() < 4:
			continue
		var fx := float(p[0])
		var px := float(p[1])
		var fy := float(p[2])
		var py := float(p[3])
		if is_equal_approx(fx, 1.0) and py == 0.0:
			right[fy] = -px
		elif is_equal_approx(fy, 1.0) and px == 0.0 and not is_equal_approx(fx, 1.0):
			bottom[fx] = -py
		elif is_zero_approx(fx) and py == 0.0 and not is_zero_approx(fy):
			left[fy] = px
	var steps := 0
	for side in [left, right, bottom]:
		steps = maxi(steps, (side as Dictionary).size())
	if steps == 0:
		return {"n": 0}
	steps = mini(steps, 71)
	return {"n": steps, "l": _sampled(left, steps), "r": _sampled(right, steps), "b": _sampled(bottom, steps)}


static func _sampled(side: Dictionary, steps: int) -> PackedFloat32Array:
	var out := PackedFloat32Array()
	out.resize(72)
	if side.is_empty():
		return out
	var keys: Array = side.keys()
	keys.sort()
	for i in range(steps + 1):
		var t := float(i) / float(steps)
		var value := 0.0
		for key in keys:
			if absf(float(key) - t) < 0.5 / float(steps):
				value = float(side[key])
		out[i] = value
	return out


class Surface extends ColorRect:
	var spec := {}
	var outset := 0.0

	func _init(params: Dictionary, look := "", jags: Dictionary = {}, grow := 0.0) -> void:
		spec = params
		outset = grow
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		color = Color(1, 1, 1, 1)
		var shaded := ShaderMaterial.new()
		shaded.shader = RostraLook.surface_shader()
		material = shaded
		shaded.set_shader_parameter("outset", outset)
		shaded.set_shader_parameter("base", params.get("base", Color(1, 1, 1, 1)))
		shaded.set_shader_parameter("r_top", params.get("top", Vector2.ZERO))
		shaded.set_shader_parameter("r_bottom", params.get("bottom", Vector2.ZERO))
		var layers: Array = RostraLook.GRAINS.get(look, []) if bool(params.get("grain", true)) else []
		shaded.set_shader_parameter("layers", layers.size())
		var tints := PackedVector4Array()
		var curves := PackedVector4Array()
		for i in range(4):
			if i < layers.size():
				var layer: Dictionary = layers[i]
				var tone: Color = layer["colour"]
				tints.append(Vector4(tone.r, tone.g, tone.b, float(layer.get("spread", 1.0))))
				var tile := float(layer["size"])
				curves.append(Vector4(float(layer["k"]), float(layer["c"]), tile, tile))
				shaded.set_shader_parameter("grain%d" % i, RostraLook.grain(look, i))
			else:
				tints.append(Vector4.ZERO)
				curves.append(Vector4(0, 0, 1, 1))
		shaded.set_shader_parameter("tint", tints)
		shaded.set_shader_parameter("curve", curves)
		_shadows(shaded, "insets", "inset", 3, params.get("insets", []))
		_shadows(shaded, "drops", "drop", 2, params.get("drops", []))
		var border: Array = params.get("border", [])
		shaded.set_shader_parameter("border_w", float(border[0]) if border.size() == 2 else 0.0)
		shaded.set_shader_parameter("border_col", border[1] if border.size() == 2 else Color(0, 0, 0, 0))
		shaded.set_shader_parameter("jag_n", int(jags.get("n", 0)))
		for side in ["l", "r", "b"]:
			var values: PackedFloat32Array = jags.get(side, PackedFloat32Array())
			if values.size() != 72:
				values = PackedFloat32Array()
				values.resize(72)
			shaded.set_shader_parameter("jag_" + side, values)
		resized.connect(_on_resized)

	func _shadows(shaded: ShaderMaterial, count: String, prefix: String, most: int, list: Array) -> void:
		var colours := PackedVector4Array()
		var geos := PackedVector4Array()
		for i in range(most):
			if i < list.size():
				var entry: Array = list[i]
				var offset: Vector2 = entry[0]
				var tone: Color = entry[2]
				colours.append(Vector4(tone.r, tone.g, tone.b, tone.a))
				geos.append(Vector4(offset.x, offset.y, float(entry[1]), 0))
			else:
				colours.append(Vector4.ZERO)
				geos.append(Vector4.ZERO)
		shaded.set_shader_parameter(count, mini(list.size(), most))
		shaded.set_shader_parameter(prefix + "_col", colours)
		shaded.set_shader_parameter(prefix + "_geo", geos)

	func _on_resized() -> void:
		(material as ShaderMaterial).set_shader_parameter("box", size - Vector2(outset, outset) * 2.0)


static func surface(params: Dictionary, look := "", jags: Dictionary = {}, grow := 0.0) -> Surface:
	return Surface.new(params, look, jags, grow)


static func place_surface(node: Control, rect: Rect2) -> void:
	var grow := 0.0
	if node is Surface:
		grow = (node as Surface).outset
	node.position = rect.position - Vector2(grow, grow)
	node.size = rect.size + Vector2(grow, grow) * 2.0


class Cracks extends Control:
	const PATHS := [
		[Vector2(100, 46), Vector2(98.4, 48), Vector2(99.2, 50.5), Vector2(97.4, 53), Vector2(98, 55)],
		[Vector2(0, 150), Vector2(1.6, 151.5), Vector2(1, 154), Vector2(2.8, 156.5), Vector2(2.2, 159)],
		[Vector2(62, 200), Vector2(61.4, 198.6), Vector2(62.6, 197.6), Vector2(62, 196.4)],
		[Vector2(100, 128), Vector2(98.8, 129.4), Vector2(99.4, 131)],
	]

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		resized.connect(queue_redraw)

	func _draw() -> void:
		var unit := Vector2(size.x / 100.0, size.y / 200.0)
		for path in PATHS:
			var pale := PackedVector2Array()
			var dark := PackedVector2Array()
			for point in path:
				var at: Vector2 = point
				dark.append(at * unit)
				pale.append((at + Vector2(0, 0.45)) * unit)
			draw_polyline(pale, Color(1, 1, 1, 0.32), 1.0, true)
			draw_polyline(dark, Color(30 / 255.0, 27 / 255.0, 22 / 255.0, 0.55), 1.0, true)


class Roll extends Control:
	var end := "top"

	func _init(at: String) -> void:
		end = at
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		z_index = 2
		var middle := RostraLook.surface({
			"base": Color("#dfc285"),
			"border": [1.0, Color("#a67c3d")],
			"top": Vector2(8.8, 8.8),
			"bottom": Vector2(8.8, 8.8),
			"insets": [[Vector2(0, -5), 0.0, Color(120 / 255.0, 76 / 255.0, 24 / 255.0, 0.32)], [Vector2(0, 3), 0.0, Color(1, 250 / 255.0, 230 / 255.0, 0.45)]],
			"drops": [[Vector2(0, 3), 6.0, Color(0, 0, 0, 0.35)]],
		}, "scroll", {}, 14.0)
		middle.name = "Middle"
		add_child(middle)
		for line in [[0.34, 0.3], [0.62, 0.22]]:
			var stroke := ColorRect.new()
			stroke.color = Color(120 / 255.0, 76 / 255.0, 24 / 255.0, float(line[1]))
			stroke.mouse_filter = Control.MOUSE_FILTER_IGNORE
			stroke.set_meta("at", float(line[0]))
			stroke.name = "Turn"
			add_child(stroke)
		for side in ["left", "right"]:
			var knob := RostraLook.surface({"base": Color("#4a2c12"), "border": [1.0, Color("#2e1a09")], "top": Vector2(15.2 * 0.45, 24.8 * 0.45), "bottom": Vector2(15.2 * 0.45, 24.8 * 0.45), "insets": [[Vector2(0, -3), 0.0, Color(0, 0, 0, 0.35)], [Vector2(0, 2), 0.0, Color(1, 1, 1, 0.22)]], "grain": false})
			knob.set_meta("side", side)
			knob.set_meta("part", "knob")
			add_child(knob)
			var collar := RostraLook.surface({"base": Color("#6b4220"), "border": [1.0, Color("#3b2410")], "top": Vector2(3, 3), "bottom": Vector2(3, 3), "insets": [[Vector2(0, 2), 0.0, Color(1, 1, 1, 0.2)]], "grain": false})
			collar.set_meta("side", side)
			collar.set_meta("part", "collar")
			add_child(collar)
		resized.connect(_lay_out)

	func _lay_out() -> void:
		var middle_rect := Rect2(1.35 * REM, 0.05 * REM, size.x - 2.7 * REM, size.y - 0.1 * REM)
		for child in get_children():
			var node := child as Control
			if node.name == "Middle":
				RostraLook.place_surface(node, middle_rect)
			elif node.has_meta("at"):
				node.position = Vector2(middle_rect.position.x + 0.4 * REM, middle_rect.position.y + middle_rect.size.y * float(node.get_meta("at")))
				node.size = Vector2(middle_rect.size.x - 0.8 * REM, 1)
			elif node.has_meta("part"):
				var knob_w := 0.95 * REM
				var is_knob := str(node.get_meta("part")) == "knob"
				var w := knob_w if is_knob else 0.5 * REM
				var h := 1.55 * REM if is_knob else 0.85 * REM
				var x := 0.0 if is_knob else knob_w
				if str(node.get_meta("side")) == "right":
					x = size.x - x - w
				RostraLook.place_surface(node, Rect2(x, (size.y - h) * 0.5, w, h))


static func mark_texture(look: String, size: int) -> Texture2D:
	var key := "%s:%d" % [look, size]
	if _marks.has(key):
		return _marks[key]
	var svg := seal_svg() if look == "scroll" else laurel_svg()
	var texture := UI.svg_texture(svg, float(size) / 40.0)
	_marks[key] = texture
	return texture


static func seal_svg() -> String:
	return "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><path d='M20 1.5c2.6 0 3.4 2.2 5.8 2.6 2.5.4 4.3-1.3 6.2.4 1.9 1.7.6 3.9 1.6 6.1 1 2.3 3.6 2.9 3.8 5.4.2 2.6-2 3.5-2.2 6-.2 2.4 1.9 4.1.8 6.4-1.1 2.3-3.6 1.8-5.4 3.4-1.8 1.7-1.7 4.3-4.1 5.1-2.4.8-4-1.3-6.5-1.3s-4.1 2.1-6.5 1.3c-2.4-.8-2.3-3.4-4.1-5.1-1.8-1.6-4.3-1.1-5.4-3.4-1.1-2.3 1-4 .8-6.4-.2-2.5-2.4-3.4-2.2-6 .2-2.5 2.8-3.1 3.8-5.4 1-2.2-.3-4.4 1.6-6.1 1.9-1.7 3.7 0 6.2-.4C16.6 3.7 17.4 1.5 20 1.5z' fill='#8f1d14'/><circle cx='20' cy='20' r='12.2' fill='#a3241a'/><circle cx='20' cy='20' r='12.2' fill='none' stroke='#6e140d' stroke-width='1.2'/><circle cx='20' cy='20' r='10.4' fill='none' stroke='#c2402f' stroke-width='0.7' stroke-dasharray='1.2 1.4'/><path d='M10 11.5c2-2.4 5-3.8 8.4-4' fill='none' stroke='#d6604d' stroke-width='1.1' stroke-linecap='round' opacity='0.7'/></svg>"


static func laurel_svg() -> String:
	var leaves := ""
	for i in range(7):
		var theta := 112.0 + float(i) * 21.0
		for side in [1, -1]:
			var angle: float = theta if side > 0 else 180.0 - theta
			var rad := deg_to_rad(angle)
			var x := 20.0 + 13.5 * cos(rad)
			var y := 20.5 + 13.5 * sin(rad)
			var tilt: float = angle + (-28.0 if side > 0 else 28.0)
			var grow := 1.0 - float(i) * 0.045
			leaves += "<ellipse cx='%.2f' cy='%.2f' rx='%.2f' ry='%.2f' transform='rotate(%.1f %.2f %.2f)'/>" % [x, y, 1.5 * grow, 3.6 * grow, tilt, x, y]
	return "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><path d='M12.5 32.5A13.5 13.5 0 0 1 7.6 12.8M27.5 32.5a13.5 13.5 0 0 0 4.9-19.7' fill='none' stroke='#4a3410' stroke-width='0.9' stroke-linecap='round'/><g fill='#7a561c' stroke='#3f2b0c' stroke-width='0.45'>" + leaves + "</g><path d='M16.5 34.5l3.5-1.6 3.5 1.6M20 32.9v3' fill='none' stroke='#3f2b0c' stroke-width='0.9' stroke-linecap='round'/></svg>"


static func look_mark(look: String) -> Control:
	var size := 34.0 if look == "scroll" else 40.0
	var holder := Control.new()
	holder.custom_minimum_size = Vector2(size, size)
	holder.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var picture := mark_texture(look, int(size))
	if look == "tablet":
		var glow := TextureRect.new()
		glow.texture = picture
		glow.material = silhouette(Color(1, 1, 1, 0.4))
		glow.position = Vector2(0, 1)
		glow.size = Vector2(size, size)
		glow.mouse_filter = Control.MOUSE_FILTER_IGNORE
		holder.add_child(glow)
	var image := TextureRect.new()
	image.texture = picture
	image.size = Vector2(size, size)
	image.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.add_child(image)
	var unit := size / 40.0
	if look == "scroll":
		for layer in [[25.6, Color("#6e140d")], [25.0, Color(214 / 255.0, 96 / 255.0, 77 / 255.0, 0.55)]]:
			holder.add_child(_letter("R", families("Georgia, 'Times New Roman', serif"), 15.0 * unit, layer[1], 700, float(layer[0]) * unit, size))
	else:
		holder.add_child(_letter("R", families("'Perpetua Titling MT', 'Times New Roman', serif"), 13.0 * unit, Color(1, 1, 1, 0.4), 700, 25.2 * unit + 1.0, size))
		holder.add_child(_letter("R", families("'Perpetua Titling MT', 'Times New Roman', serif"), 13.0 * unit, Color("#3a2a10"), 700, 25.2 * unit, size))
	return holder


static func _letter(word: String, names: PackedStringArray, px: float, tone: Color, weight: int, baseline: float, width: float) -> Label:
	var node := Label.new()
	node.text = word
	node.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	var face := font(names, weight)
	var px_int := int(round(px))
	node.add_theme_font_override("font", face)
	node.add_theme_font_size_override("font_size", px_int)
	node.add_theme_color_override("font_color", tone)
	node.add_theme_constant_override("shadow_offset_x", 0)
	node.add_theme_constant_override("shadow_offset_y", 0)
	node.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0))
	node.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var ascent := face.get_ascent(px_int)
	node.position = Vector2(0, baseline - ascent)
	node.size = Vector2(width, face.get_height(px_int))
	return node


static func line(tone: Color, height := 1.0) -> ColorRect:
	var node := ColorRect.new()
	node.color = tone
	node.custom_minimum_size.y = height
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return node


static func double_rule(tone: Color) -> VBoxContainer:
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 1)
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	box.add_child(line(tone))
	box.add_child(line(tone))
	return box


static func groove(dark: Color, pale: Color) -> VBoxContainer:
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 0)
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	box.add_child(line(dark))
	box.add_child(line(pale))
	return box
