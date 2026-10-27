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
var _picture_aspect := 0.0
var _shape_edit: LineEdit


func _init() -> void:
	super._init("Projection", "layers", 320.0, "left")


func setup(workshop: Workshop) -> void:
	host = workshop
	var reply := await host.request_raw("workshop.projection.options")
	if reply.get("ok", false):
		_options = reply["result"]
		var current: Dictionary = _options.get("current", {})
		_type = str(current.get("type", "mercator"))
	_picture_aspect = _aspect_of(str(_options.get("pictureFile", "")))
	var check := await host.request_raw("workshop.projection.check", {"type": _type, "shape": "", "pictureAspect": _picture_aspect})
	if check.get("ok", false):
		_shape = str((check["result"] as Dictionary).get("shapeText", "2:1"))
	await _recheck()


func _recheck() -> void:
	var reply := await host.request_raw("workshop.projection.check", {"type": _type, "shape": _shape, "pictureAspect": _picture_aspect})
	if reply.get("ok", false):
		_check = reply["result"]
	_render()


func _aspect_of(file: String) -> float:
	var image := Image.new()
	if file.is_empty() or image.load(file) != OK or image.get_width() <= 0 or image.get_height() <= 0:
		return 0.0
	return float(image.get_width()) / float(image.get_height())


func _note(text: String, warn := false) -> Label:
	return WorkshopUI.wrap(text, 11.5, Color("#ffb4a8") if warn else Color(1, 1, 1, 0.6))


func _render() -> void:
	var typing := _shape_edit != null and is_instance_valid(_shape_edit) and _shape_edit.has_focus()
	_shape_edit = null
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
		_shape_edit = shape
		body.add_child(WorkshopUI.row("Shape (width : height)", shape))
		if typing:
			shape.grab_focus.call_deferred()
			shape.caret_column = shape.text.length()
		if _picture_aspect > 0.0:
			var own := WorkshopUI.base_button("Use the picture's own shape")
			var own_style := UI.box(Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.16), 7, 1, Vector4(8, 5, 8, 5))
			WorkshopUI._flat_styles(own, own_style, UI.box(Color(1, 1, 1, 0.1), Color(1, 1, 1, 0.22), 7, 1, Vector4(8, 5, 8, 5)), own_style, own_style)
			WorkshopUI._ink(own, Color(1, 1, 1), 12.0, 600)
			own.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
			own.pressed.connect(func() -> void:
				var text := str(_check.get("pictureShape", ""))
				if not text.is_empty():
					_shape = text
					_recheck())
			body.add_child(own)
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
		var args := {"target": _check.get("chosen"), "keepPicture": offers_keep and _keep}
		var reply := await host.request("workshop.projection.convert", args)
		if reply.get("redraw") is Dictionary:
			var redrawn := await _redraw(args["target"], reply["redraw"])
			if redrawn.has("error"):
				reply = {"error": redrawn["error"]}
			else:
				args["redrawn"] = redrawn
				reply = await host.request("workshop.projection.convert", args)
		if not is_instance_valid(self):
			return
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


func _redraw(target: Variant, spec: Dictionary) -> Dictionary:
	var image := Image.new()
	if image.load(str(spec.get("file", ""))) != OK or image.get_width() <= 0 or image.get_height() <= 0:
		return {"error": "The basemap picture could not be read."}
	if image.is_compressed():
		image.decompress()
	image.convert(Image.FORMAT_RGBA8)
	var stamp := Time.get_ticks_usec()
	var raw_file := OS.get_temp_dir().path_join("oh-redraw-%d.rgba" % stamp)
	var out := FileAccess.open(raw_file, FileAccess.WRITE)
	if out == null:
		return {"error": error_string(FileAccess.get_open_error())}
	out.store_buffer(image.get_data())
	out.close()
	var reply := await host.request_raw("workshop.projection.redraw", {"target": target, "rawFile": raw_file, "width": image.get_width(), "height": image.get_height()})
	if not reply.get("ok", false):
		return {"error": str(reply.get("error", "The basemap picture could not be redrawn."))}
	var result: Dictionary = reply["result"]
	if result.has("error"):
		return {"error": str(result["error"])}
	var width := int(result.get("width", 0))
	var height := int(result.get("height", 0))
	var drawn_file := str(result.get("rawFile", ""))
	var bytes := FileAccess.get_file_as_bytes(drawn_file)
	DirAccess.remove_absolute(drawn_file)
	if width <= 0 or height <= 0 or bytes.size() != width * height * 4:
		return {"error": "The basemap picture could not be redrawn."}
	var drawn := Image.create_from_data(width, height, false, Image.FORMAT_RGBA8, bytes)
	var jpeg := bool(result.get("jpeg", false))
	var encoded := PackedByteArray()
	if jpeg:
		var flat := Image.create_empty(width, height, false, Image.FORMAT_RGBA8)
		flat.fill(Color(0, 0, 0, 1))
		flat.blend_rect(drawn, Rect2i(0, 0, width, height), Vector2i.ZERO)
		flat.convert(Image.FORMAT_RGB8)
		encoded = flat.save_jpg_to_buffer(0.92)
	else:
		encoded = drawn.save_png_to_buffer()
	var file := OS.get_temp_dir().path_join("oh-redrawn-%d.%s" % [stamp, "jpg" if jpeg else "png"])
	var written := FileAccess.open(file, FileAccess.WRITE)
	if written == null:
		return {"error": error_string(FileAccess.get_open_error())}
	written.store_buffer(encoded)
	written.close()
	return {"file": file, "mime": "image/jpeg" if jpeg else "image/png", "aspect": result.get("aspect"), "bounds": result.get("bounds")}


func _view(patch: Dictionary) -> void:
	await host.request("workshop.projection.view", {"patch": patch})
	var options := await host.request_raw("workshop.projection.options")
	if options.get("ok", false):
		_options = options["result"]
