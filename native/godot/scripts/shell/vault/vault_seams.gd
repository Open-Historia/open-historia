extends Control

const EDGE := Color("#15171a")
const ENDS := [Vector2(0.0, 0.15), Vector2(1.0, 0.15), Vector2(0.5, 1.0)]


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func _draw() -> void:
	var middle := size * 0.5
	for end in ENDS:
		var share: Vector2 = end
		draw_line(middle, Vector2(share.x * size.x, share.y * size.y), EDGE, 5.0, true)
