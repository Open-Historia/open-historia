class_name Presence
extends RefCounted

const LEAVE_MS := 150.0

static var reduce_motion := false


static func enter(item: CanvasItem, kind := "fade") -> Tween:
	if reduce_motion or not item.is_inside_tree():
		item.modulate.a = 1.0
		return null
	if kind == "surface" and item is Control:
		var control := item as Control
		control.pivot_offset = control.size * 0.5
		var rest := control.position
		return CubicBezier.animate(control, func(t: float) -> void:
			control.modulate.a = t
			control.scale = Vector2.ONE * lerpf(0.985, 1.0, t)
			control.position = rest + Vector2(0.0, 6.0 * (1.0 - t)), 180.0, 0.0, "cubic-bezier(0.2, 0.7, 0.2, 1)")
	return CubicBezier.animate(item, func(t: float) -> void: item.modulate.a = t, 160.0, 0.0, "ease-out")


static func leave(item: CanvasItem, duration_ms := LEAVE_MS, free_after := false, kind := "surface") -> void:
	if not is_instance_valid(item):
		return
	if item is Control:
		(item as Control).mouse_filter = Control.MOUSE_FILTER_IGNORE
	if reduce_motion or not item.is_inside_tree():
		_done(item, free_after)
		return
	var tween: Tween
	if kind == "surface" and item is Control:
		var control := item as Control
		control.pivot_offset = control.size * 0.5
		var start := control.position
		tween = CubicBezier.animate(control, func(t: float) -> void:
			control.modulate.a = 1.0 - t
			control.scale = Vector2.ONE * lerpf(1.0, 0.985, t)
			control.position = start + Vector2(0.0, 6.0 * t), duration_ms, 0.0, "ease-in", false)
	else:
		tween = CubicBezier.animate(item, func(t: float) -> void: item.modulate.a = 1.0 - t, duration_ms, 0.0, "ease-in", false)
	await tween.finished
	_done(item, free_after)


static func _done(item: CanvasItem, free_after: bool) -> void:
	if not is_instance_valid(item):
		return
	if free_after:
		item.queue_free()
	else:
		item.visible = false
		item.modulate.a = 1.0
		if item is Control:
			(item as Control).scale = Vector2.ONE
