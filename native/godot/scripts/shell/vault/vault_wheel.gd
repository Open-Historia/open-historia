extends Control

const RING := Color("#d4d4d8")

var area := Vector2.ZERO
var wheel_texture: Texture2D
var shadow_texture: Texture2D
var turn := 0.0
var shake := Vector3.ZERO
var zoom := 1.0
var ring := false


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func side() -> float:
	return minf(area.x, area.y) * 0.56


func _draw() -> void:
	var length := side()
	if length <= 0.0:
		return
	var centre := area / 2.0
	if shadow_texture:
		var offset := Vector2(0.013, 0.024) * length * zoom
		var factor := length / float(shadow_texture.get_width()) * zoom
		draw_set_transform(centre + offset, deg_to_rad(turn), Vector2(factor, factor))
		draw_texture(shadow_texture, -Vector2(shadow_texture.get_size()) / 2.0, Color(1, 1, 1, 0.42))
	var moved := centre + Vector2(shake.x, shake.y) * zoom
	if wheel_texture:
		var factor := length / float(wheel_texture.get_width()) * zoom
		var angle := deg_to_rad(shake.z + turn)
		var origin := -Vector2(wheel_texture.get_size()) / 2.0
		if is_zero_approx(angle) and is_equal_approx(factor, 1.0):
			draw_set_transform((moved + origin).round() - origin, 0.0, Vector2.ONE)
		else:
			draw_set_transform(moved, angle, Vector2(factor, factor))
		draw_texture(wheel_texture, origin)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	if ring:
		draw_arc(moved, (length / 2.0 + 7.0) * zoom, 0.0, TAU, 160, RING, 2.0 * zoom, true)
