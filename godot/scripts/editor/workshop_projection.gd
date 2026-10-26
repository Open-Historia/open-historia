class_name WorkshopProjection
extends WorkshopShell

var host: Workshop
var _options := {}
var _type := "mercator"
var _shape := "2:1"
var _keep := false
var _busy := false
var _error := ""
var _check := {}


func _init() -> void:
	super._init("Projection", "layers", 320.0, "left")


func setup(workshop: Workshop) -> void:
	host = workshop
	var reply := await host.request_raw("workshop.projection.options")
	if reply.get("ok", false):
		_options = reply["result"]
		var current: Dictionary = _options.get("current", {})
		_type = str(current.get("type", "mercator"))
	var check := await host.request_raw("workshop.projection.check", {"type": _type, "shape": ""})
	if check.get("ok", false):
		_shape = str((check["result"] as Dictionary).get("shapeText", "2:1"))
	await _recheck()


func _recheck() -> void:
	var reply := await host.request_raw("workshop.projection.check", {"type": _type, "shape": _shape})
	if reply.get("ok", false):
		_check = reply["result"]
	_render()


func _note(text: String, warn := false) -> Label:
	return WorkshopUI.wrap(text, 11.5, Color("#ffb4a8") if warn else Color(1, 1, 1, 0.6))


func _render() -> void:
	clear_body()
	var freeform := str(_options.get("freeform", "freeform"))
	var projections: Array = []
	for entry in _options.get("projections", []):
		projections.append([str((entry as Dictionary)["id"]), str((entry as Dictionary)["name"])])
	var select := WorkshopUI.select(projections, _type, func(value: String) -> void:
		_type = value
		_recheck(), 12.0, 28.0)
	select.custom_minimum_size.x = 170
	select.size_flags_horizontal = Control.SIZE_SHRINK_END
	body.add_child(WorkshopUI.row("Projection", select))
	var current: Dictionary = _options.get("current", {})
	if _type == freeform:
		var shape := WorkshopUI.input(_shape, "16:9", func(text: String) -> void:
			_shape = text
			_recheck(), 12.0, 28.0)
		shape.custom_minimum_size.x = 110
		shape.size_flags_horizontal = Control.SIZE_SHRINK_END
		body.add_child(WorkshopUI.row("Shape (width : height)", shape))
		if not bool(_check.get("aspectOk", true)):
			body.add_child(_note("Give the shape as width : height, such as 16:9 or 2:1.", true))
	var offers_keep := bool(_options.get("hasPicture", false)) and _type != freeform and str(current.get("type", "")) != freeform
	if offers_keep:
		body.add_child(WorkshopUI.row("The picture is already drawn for it", WorkshopUI.toggle(_keep, func(on: bool) -> void: _keep = on)))
	body.add_child(_note("Converting moves every region, city and unit together with the basemap. Undo does not reach back past it: convert again to return."))
	if not _error.is_empty():
		body.add_child(_note(_error, true))
	var blocked := str(_options.get("blocked", ""))
	var changed := bool(_check.get("changed", false))
	if not blocked.is_empty() and changed:
		body.add_child(_note(blocked, true))
	var can_convert := changed and not _busy and blocked.is_empty()
	var convert := WorkshopUI.base_button("Converting the map…" if _busy else ("Convert the map" if changed else "The map is in this projection"))
	var on_style := UI.box(WorkshopUI.ACCENT, Color(1, 1, 1, 0.16), 8, 1, Vector4(10, 8, 10, 8))
	var off_style := UI.box(Color(1, 1, 1, 0.08), Color(1, 1, 1, 0.16), 8, 1, Vector4(10, 8, 10, 8))
	var style := on_style if can_convert else off_style
	WorkshopUI._flat_styles(convert, style, style, style, off_style)
	WorkshopUI._ink(convert, Color("#06222d") if can_convert else Color(1, 1, 1, 0.45), 12.5, 700)
	convert.add_theme_color_override("font_disabled_color", Color(1, 1, 1, 0.45))
	convert.disabled = not can_convert
	convert.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	convert.pressed.connect(func() -> void:
		if not can_convert:
			return
		_busy = true
		_error = ""
		_render()
		var reply := await host.request("workshop.projection.convert", {"target": _check.get("chosen"), "keepPicture": offers_keep and _keep})
		_busy = false
		_error = str(reply.get("error", ""))
		var options := await host.request_raw("workshop.projection.options")
		if options.get("ok", false):
			_options = options["result"]
		await _recheck()
		if _error.is_empty():
			host.fit_to_data())
	body.add_child(convert)
	body.add_child(WorkshopUI.row("Disable the 3D globe", WorkshopUI.toggle(current.get("globe") == false, func(off: bool) -> void: _view({"globe": not off}))))
	body.add_child(WorkshopUI.row("Disable map looping", WorkshopUI.toggle(current.get("wrap") == false, func(off: bool) -> void: _view({"wrap": not off}))))
	fit()


func _view(patch: Dictionary) -> void:
	await host.request("workshop.projection.view", {"patch": patch})
	var options := await host.request_raw("workshop.projection.options")
	if options.get("ok", false):
		_options = options["result"]
