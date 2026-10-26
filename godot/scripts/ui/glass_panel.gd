class_name GlassPanel
extends PanelContainer

const SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform sampler2D screen_texture : hint_screen_texture, filter_linear;
uniform vec4 tint : source_color = vec4(0.07, 0.07, 0.08, 0.52);
uniform vec4 border_color : source_color = vec4(0.925, 0.925, 0.933, 0.17);
uniform float highlight = 0.10;
uniform float radius = 14.0;
uniform vec2 rect_size = vec2(100.0, 100.0);
uniform float blur_px = 5.0;
float rounded_box(vec2 p, vec2 half_size, float r) {
	vec2 q = abs(p) - half_size + vec2(r);
	return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - r;
}
void fragment() {
	vec2 p = UV * rect_size - rect_size * 0.5;
	float d = rounded_box(p, rect_size * 0.5, radius);
	float inside = clamp(0.5 - d, 0.0, 1.0);
	vec3 sum = vec3(0.0);
	float total = 0.0;
	for (int x = -3; x <= 3; x++) {
		for (int y = -3; y <= 3; y++) {
			float w = exp(-float(x * x + y * y) / 6.0);
			sum += texture(screen_texture, SCREEN_UV + vec2(float(x), float(y)) * SCREEN_PIXEL_SIZE * blur_px).rgb * w;
			total += w;
		}
	}
	vec3 base = sum / total;
	float grey = dot(base, vec3(0.299, 0.587, 0.114));
	base = mix(vec3(grey), base, 1.18);
	base = mix(base, tint.rgb, tint.a);
	float edge = clamp(1.0 - abs(d + 0.5), 0.0, 1.0);
	base = mix(base, border_color.rgb, border_color.a * edge);
	float top_line = clamp(1.0 - abs(p.y + rect_size.y * 0.5 - 1.5), 0.0, 1.0) * step(abs(p.x), rect_size.x * 0.5 - radius);
	base = mix(base, vec3(1.0), highlight * top_line);
	COLOR = vec4(base, inside);
}
"""

static var _shader: Shader

var tint := UI.HUD_BG
var radius := 14.0
var border := UI.HUD_BORDER
var padding := Vector4(0, 0, 0, 0)
var _backdrop: ColorRect
var _material: ShaderMaterial


func _init(tint_color := UI.HUD_BG, corner := 14.0, inner := Vector4(0, 0, 0, 0), border_color := UI.HUD_BORDER) -> void:
	tint = tint_color
	radius = corner
	padding = inner
	border = border_color
	mouse_filter = Control.MOUSE_FILTER_STOP
	var frame := UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), int(corner), 1, inner)
	add_theme_stylebox_override("panel", frame)
	if not _shader:
		_shader = Shader.new()
		_shader.code = SHADER
	_material = ShaderMaterial.new()
	_material.shader = _shader
	_material.set_shader_parameter("tint", tint)
	_material.set_shader_parameter("border_color", border)
	_material.set_shader_parameter("radius", radius)
	_backdrop = ColorRect.new()
	_backdrop.material = _material
	_backdrop.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_backdrop.show_behind_parent = true
	add_child(_backdrop)

func _notification(what: int) -> void:
	if what == NOTIFICATION_SORT_CHILDREN:
		fit_child_in_rect(_backdrop, Rect2(Vector2.ZERO, size))
		_material.set_shader_parameter("rect_size", size)


func set_tint(color: Color) -> void:
	tint = color
	_material.set_shader_parameter("tint", tint)
