class_name Spinner
extends Control

var diameter := 15.0
var tone := Color(1, 1, 1, 0.88)
var _angle := 0.0


func _init(size_px := 15.0, color := Color(1, 1, 1, 0.88)) -> void:
	diameter = size_px
	tone = color
	custom_minimum_size = Vector2(size_px, size_px)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	size_flags_vertical = Control.SIZE_SHRINK_CENTER


func _process(delta: float) -> void:
	_angle = fposmod(_angle + delta * TAU / 0.7, TAU)
	queue_redraw()


func _draw() -> void:
	var centre := size * 0.5
	var radius := diameter * 8.0 / 24.0
	var width := diameter * 2.2 / 24.0
	draw_arc(centre, radius, 0.0, TAU, 32, Color(1, 1, 1, 0.2), width, true)
	draw_arc(centre, radius, _angle - PI * 0.5, _angle, 16, tone, width, true)
