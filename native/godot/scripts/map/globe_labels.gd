class_name GlobeLabels
extends Node

var map_view: MapView
var _source: PolityTextLayer
var _active := false


func setup(view: MapView) -> void:
	map_view = view
	view.add_child(self)


func set_active(on: bool) -> void:
	_active = on
	_bind()
	if _source and not on:
		_source.unproject()


func _bind() -> void:
	var source := map_view.polity_text() if map_view else null
	if source == _source:
		return
	if _source and is_instance_valid(_source):
		_source.unproject()
	_source = source


func active() -> bool:
	return _active and _source != null and _source.projected()


func painted_items() -> int:
	if not _active or _source == null:
		return 0
	return _source.projected_items()


func sync(rect: Rect2, uniforms: Dictionary) -> void:
	if not _active:
		return
	_bind()
	if _source == null:
		return
	_source.project(uniforms, rect, float(uniforms.get("globeness", 0.0)) > 0.0)
