class_name DevToolsGraph
extends Control

const SAMPLES := 120

var color := DevToolsStyle.ACCENT
var floor_value := 0.0
var values := PackedFloat32Array()


func _init() -> void:
	custom_minimum_size = Vector2(0, 44)
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func push(value: float) -> void:
	values.append(value)
	if values.size() > SAMPLES:
		values = values.slice(values.size() - SAMPLES)
	queue_redraw()


func _draw() -> void:
	var area := Rect2(Vector2.ZERO, size)
	draw_rect(area, Color(0, 0, 0, 0.22))
	draw_line(Vector2(0, size.y * 0.5), Vector2(size.x, size.y * 0.5), DevToolsStyle.LINE, 1.0)
	if values.size() < 2:
		return
	var top := floor_value
	for value in values:
		top = maxf(top, value)
	top = maxf(top * 1.15, 0.0001)
	var step := size.x / float(SAMPLES - 1)
	var start := size.x - step * float(values.size() - 1)
	var line := PackedVector2Array()
	for index in range(values.size()):
		line.append(Vector2(start + step * index, size.y - 2.0 - (size.y - 4.0) * clampf(values[index] / top, 0.0, 1.0)))
	var fill := line.duplicate()
	fill.append(Vector2(line[line.size() - 1].x, size.y))
	fill.append(Vector2(line[0].x, size.y))
	draw_colored_polygon(fill, Color(color, 0.12))
	draw_polyline(line, color, 1.5, true)
