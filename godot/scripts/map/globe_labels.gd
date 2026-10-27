class_name GlobeLabels
extends Node2D

var map_view: MapView
var _source: PolityTextLayer
var _active := false
var _direct: PolityTextLayer.Painter
var _groups: Array[CanvasGroup] = []
var _group_painters: Array[PolityTextLayer.Painter] = []
var _extent := Vector2(0.0, MapView.WORLD_WIDTH)
var _revision := -1
var _rect := Rect2()


func setup(view: MapView) -> void:
	map_view = view
	visibility_layer = GlobeView.MAP_LAYER_BIT
	z_as_relative = false
	z_index = RenderingServer.CANVAS_ITEM_Z_MAX
	visible = false
	view.add_child(self)


func set_active(on: bool) -> void:
	_active = on
	_bind()
	if _source:
		_source.visibility_layer = GlobeView.MAP_LAYER_BIT if on else 1
	if not on:
		visible = false


func _bind() -> void:
	var source := map_view.polity_text() if map_view else null
	if source == _source:
		return
	if _source and is_instance_valid(_source):
		_source.visibility_layer = 1
	_source = source
	_revision = -1
	if _direct:
		_direct.layer = _source
	for painter in _group_painters:
		painter.layer = _source


func painted_items() -> int:
	var total := 0
	if _direct:
		total += _direct.items.size()
	for index in range(_groups.size()):
		if _groups[index].visible:
			total += _group_painters[index].items.size()
	return total


func sync(rect: Rect2) -> void:
	if not _active:
		return
	_bind()
	if _source == null:
		visible = false
		return
	_source.visibility_layer = GlobeView.MAP_LAYER_BIT
	visible = _source.is_visible_in_tree()
	if not visible:
		return
	_rect = rect
	if _source.revision != _revision:
		_revision = _source.revision
		_extent = _label_extent()
	var copies := _copies_for(rect)
	var direct_source: PolityTextLayer.Painter = null
	var group_sources: Array[CanvasGroup] = []
	for child in _source.get_children():
		if child is CanvasGroup and (child as CanvasGroup).get_child_count() > 0 and (child as CanvasGroup).get_child(0) is PolityTextLayer.Painter:
			group_sources.append(child as CanvasGroup)
		elif child is PolityTextLayer.Painter:
			direct_source = child as PolityTextLayer.Painter
	while _groups.size() < group_sources.size():
		var group := CanvasGroup.new()
		var painter := _painter()
		group.add_child(painter)
		add_child(group)
		_groups.append(group)
		_group_painters.append(painter)
	if _direct == null:
		_direct = _painter()
		add_child(_direct)
	move_child(_direct, -1)
	for index in range(_groups.size()):
		var group := _groups[index]
		var painter := _group_painters[index]
		if index < group_sources.size() and group_sources[index].visible:
			var from: PolityTextLayer.Painter = group_sources[index].get_child(0)
			group.visible = true
			group.self_modulate = group_sources[index].self_modulate
			_mirror(painter, from, copies)
		else:
			group.visible = false
	if direct_source:
		_mirror(_direct, direct_source, copies)
	elif not _direct.items.is_empty():
		_direct.items = [] as Array[int]
		_direct.queue_redraw()


func _painter() -> PolityTextLayer.Painter:
	var painter := PolityTextLayer.Painter.new()
	painter.layer = _source
	painter.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
	return painter


func _mirror(painter: PolityTextLayer.Painter, from: PolityTextLayer.Painter, copies: Array[float]) -> void:
	if painter.material != from.material:
		painter.material = from.material
	if painter.layer != _source:
		painter.layer = _source
	if painter.items != from.items or painter.copies != copies:
		painter.items = from.items.duplicate()
		painter.copies = copies
		painter.queue_redraw()


func _label_extent() -> Vector2:
	var extent := Vector2(INF, -INF)
	for label in _source.labels_snapshot():
		var bounds: Rect2 = label.get("bounds", Rect2())
		extent = Vector2(minf(extent.x, bounds.position.x), maxf(extent.y, bounds.end.x))
	return extent if extent.x <= extent.y else Vector2(0.0, MapView.WORLD_WIDTH)


func _copies_for(rect: Rect2) -> Array[float]:
	var copies: Array[float] = []
	for step in range(-2, 3):
		var offset := step * MapView.WORLD_WIDTH
		if _extent.x + offset <= rect.end.x and _extent.y + offset >= rect.position.x:
			copies.append(offset)
	return copies
