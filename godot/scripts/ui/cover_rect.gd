class_name CoverRect
extends ColorRect

const SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform sampler2D cover : filter_linear_mipmap;
uniform bool has_cover = false;
uniform vec4 accent : source_color = vec4(0.169, 0.757, 0.953, 1.0);
uniform vec4 card : source_color = vec4(0.071, 0.078, 0.102, 1.0);
uniform vec2 rect_size = vec2(303.0, 154.0);
uniform vec2 cover_scale = vec2(1.0, 1.0);
uniform float radius = 24.0;
uniform float glow = 1.0;
void fragment() {
	vec2 p = UV * rect_size;
	vec3 colour = vec3(0.16, 0.17, 0.2);
	if (has_cover) {
		vec2 uv = (UV - 0.5) * cover_scale + 0.5;
		colour = texture(cover, uv).rgb;
	}
	colour = mix(colour, vec3(4.0, 6.0, 12.0) / 255.0, 0.56);
	vec2 centre = vec2(0.14, 0.18) * rect_size;
	vec2 far_corner = max(centre, rect_size - centre);
	float reach = 0.34 * length(far_corner);
	float g = clamp(1.0 - distance(p, centre) / reach, 0.0, 1.0);
	colour = mix(colour, accent.rgb, 0.72 * g * glow);
	float fade = smoothstep(rect_size.y - 19.0, rect_size.y, p.y);
	colour = mix(colour, card.rgb, fade);
	float alpha = 1.0;
	if (p.y < radius) {
		if (p.x < radius) {
			alpha = clamp(radius - length(p - vec2(radius)) + 0.5, 0.0, 1.0);
		} else if (p.x > rect_size.x - radius) {
			alpha = clamp(radius - length(p - vec2(rect_size.x - radius, radius)) + 0.5, 0.0, 1.0);
		}
	}
	COLOR = vec4(colour, alpha);
}
"""

static var _shader: Shader
var _material: ShaderMaterial
var _texture: Texture2D


func _init(accent := UI.ACCENT, glow := 1.0) -> void:
	if not _shader:
		_shader = Shader.new()
		_shader.code = SHADER
	_material = ShaderMaterial.new()
	_material.shader = _shader
	_material.set_shader_parameter("accent", accent)
	_material.set_shader_parameter("card", UI.CARD)
	_material.set_shader_parameter("glow", glow)
	material = _material
	color = Color.WHITE
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	resized.connect(_fit)


func _ready() -> void:
	_fit()


func _notification(what: int) -> void:
	if what == NOTIFICATION_RESIZED:
		_fit()


func set_cover(texture: Texture2D) -> void:
	_texture = texture
	_material.set_shader_parameter("has_cover", texture != null)
	if texture:
		_material.set_shader_parameter("cover", texture)
	_fit()


func _fit() -> void:
	_material.set_shader_parameter("rect_size", size)
	if _texture and size.x > 0 and size.y > 0:
		var texture_aspect: float = float(_texture.get_width()) / maxf(1.0, float(_texture.get_height()))
		var rect_aspect := size.x / size.y
		if texture_aspect > rect_aspect:
			_material.set_shader_parameter("cover_scale", Vector2(rect_aspect / texture_aspect, 1.0))
		else:
			_material.set_shader_parameter("cover_scale", Vector2(1.0, texture_aspect / rect_aspect))
