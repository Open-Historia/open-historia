class_name DevToolsHighlight
extends CanvasLayer

signal picked(node: Node)
signal picking_changed(on: bool)

const FILL := Color(0.169, 0.757, 0.953, 0.18)
const EDGE := Color(0.169, 0.757, 0.953, 0.95)
const PICK_FILL := Color(0.169, 0.757, 0.953, 0.1)

var target_id := 0
var hover_id := 0
var picking := false
var _canvas: Control
var _last := PackedVector2Array()
var _last_hover := PackedVector2Array()


func _init() -> void:
	name = "DevToolsHighlight"
	layer = 128
	process_mode = Node.PROCESS_MODE_ALWAYS
	_canvas = Control.new()
	_canvas.name = "Outline"
	_canvas.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_canvas.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_canvas.draw.connect(_draw_outline)
	add_child(_canvas)


func show_node(node: Node) -> void:
	target_id = node.get_instance_id() if node else 0
	_refresh(true)


func hover_node(node: Node) -> void:
	if picking:
		return
	hover_id = node.get_instance_id() if node else 0
	_refresh(false)


func set_picking(on: bool) -> void:
	if picking == on:
		return
	picking = on
	hover_id = 0
	_refresh(true)
	picking_changed.emit(on)


func _process(_delta: float) -> void:
	if picking:
		var hovered := get_viewport().gui_get_hovered_control()
		hover_id = hovered.get_instance_id() if hovered and not _owned(hovered) else 0
	_refresh(false)


func _input(event: InputEvent) -> void:
	if not picking:
		return
	if event is InputEventMouseButton and (event as InputEventMouseButton).pressed:
		get_viewport().set_input_as_handled()
		if (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT:
			var hovered := get_viewport().gui_get_hovered_control()
			set_picking(false)
			if hovered and not _owned(hovered):
				picked.emit(hovered)
		else:
			set_picking(false)
	elif event is InputEventKey and (event as InputEventKey).pressed and (event as InputEventKey).keycode == KEY_ESCAPE:
		get_viewport().set_input_as_handled()
		set_picking(false)


func _owned(node: Node) -> bool:
	return node == _canvas or is_ancestor_of(node)


func _refresh(force: bool) -> void:
	var shape := outline(instance_from_id(target_id) as Node if target_id != 0 else null)
	var hover := outline(instance_from_id(hover_id) as Node) if hover_id != 0 and hover_id != target_id else PackedVector2Array()
	if force or shape != _last or hover != _last_hover:
		_last = shape
		_last_hover = hover
		_canvas.queue_redraw()


static func outline(node: Node) -> PackedVector2Array:
	if node == null or not is_instance_valid(node) or not node.is_inside_tree():
		return PackedVector2Array()
	if node is CanvasItem and not (node as CanvasItem).is_visible_in_tree():
		return PackedVector2Array()
	var rect := Rect2()
	var transform := Transform2D.IDENTITY
	if node is Control:
		var control := node as Control
		rect = Rect2(Vector2.ZERO, control.size)
		transform = control.get_global_transform_with_canvas()
	elif node is Node2D:
		var item := node as Node2D
		transform = item.get_global_transform_with_canvas()
		rect = Rect2(-6, -6, 12, 12)
		if item.has_method("get_rect"):
			var found: Variant = item.call("get_rect")
			if found is Rect2 and (found as Rect2).has_area():
				rect = found
	elif node is Node3D:
		var camera := node.get_viewport().get_camera_3d() if node.get_viewport() else null
		var spot := (node as Node3D).global_position
		if camera == null or camera.is_position_behind(spot):
			return PackedVector2Array()
		var at := camera.unproject_position(spot)
		rect = Rect2(at - Vector2(6, 6), Vector2(12, 12))
	elif node == node.get_tree().root:
		rect = (node as Viewport).get_visible_rect()
	else:
		return PackedVector2Array()
	return PackedVector2Array([transform * rect.position, transform * Vector2(rect.end.x, rect.position.y), transform * rect.end, transform * Vector2(rect.position.x, rect.end.y)])


func _draw_outline() -> void:
	if _last_hover.size() == 4:
		_canvas.draw_colored_polygon(_last_hover, PICK_FILL)
		_canvas.draw_polyline(_close(_last_hover), EDGE, 1.0)
	if _last.size() != 4:
		return
	_canvas.draw_colored_polygon(_last, FILL)
	_canvas.draw_polyline(_close(_last), EDGE, 1.5)
	var node := instance_from_id(target_id) as Node
	if node == null:
		return
	var tag := _tag(node)
	var font := UI.font(600, "Segoe UI")
	var width := font.get_string_size(tag, HORIZONTAL_ALIGNMENT_LEFT, -1, 11).x + 14.0
	var top := _last[0]
	for point in _last:
		if point.y < top.y or (point.y == top.y and point.x < top.x):
			top = point
	var view := _canvas.size
	var spot := Vector2(clampf(top.x, 2.0, maxf(2.0, view.x - width - 2.0)), top.y - 24.0)
	if spot.y < 2.0:
		var bottom := _last[0].y
		for point in _last:
			bottom = maxf(bottom, point.y)
		spot.y = minf(bottom + 4.0, view.y - 22.0)
	var box := Rect2(spot, Vector2(width, 20))
	_canvas.draw_rect(box, Color(0.075, 0.075, 0.082, 0.94))
	_canvas.draw_rect(box, Color(1, 1, 1, 0.16), false, 1.0)
	_canvas.draw_string(font, spot + Vector2(7, 14), tag, HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Color(0.92, 0.92, 0.94))


func _close(points: PackedVector2Array) -> PackedVector2Array:
	var closed := points.duplicate()
	closed.append(points[0])
	return closed


static func _tag(node: Node) -> String:
	var kind := node.get_class()
	var script := node.get_script() as Script
	if script and not str(script.get_global_name()).is_empty():
		kind = str(script.get_global_name())
	var size := ""
	if node is Control:
		var control := node as Control
		size = "  %d × %d" % [int(round(control.size.x)), int(round(control.size.y))]
	return "%s  %s%s" % [node.name, kind, size]
