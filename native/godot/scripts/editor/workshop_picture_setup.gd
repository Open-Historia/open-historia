class_name WorkshopPictureSetup
extends WorkshopShell

const QBAM_TYPE := "robinson"
const QBAM_CENTRE := 10.75
const QBAM_BOUNDS := {"west": -181.114, "south": -67.1689, "east": 180.586, "north": 67.0707}

var host: Workshop
var info := {}
var _projections: Array = []
var _freeform := "freeform"
var _type := "equirectangular"
var _centre: Variant = 0.0
var _box := {"north": 90.0, "south": -90.0, "west": -180.0, "east": 180.0}
var _delete_provinces := false
var _exact_bounds: Variant = null
var _busy := false
var _error := ""


func _init() -> void:
	super._init("Basemap picture", "layers", 320.0, "left")


func setup(workshop: Workshop, picture: Dictionary) -> void:
	host = workshop
	info = picture
	var reply := await host.request_raw("workshop.projection.options")
	if not is_instance_valid(self):
		return
	if reply.get("ok", false) and reply["result"] is Dictionary:
		var options: Dictionary = reply["result"]
		_freeform = str(options.get("freeform", "freeform"))
		for entry in options.get("projections", []):
			var row: Dictionary = entry
			var id := str(row.get("id", ""))
			_projections.append([id, "Freeform (no globe)" if id == _freeform else str(row.get("name", id))])
	_render()


func _note(text: String, color := Color(1, 1, 1, 0.6)) -> Label:
	return WorkshopUI.wrap(text, 11.5, color)


func _button(text: String, primary: bool, enabled := true) -> Button:
	var node := WorkshopUI.base_button(text)
	var bg := WorkshopUI.ACCENT if primary else Color(1, 1, 1, 0.08)
	var style := UI.box(bg, Color(1, 1, 1, 0.16), 8, 1, Vector4(10, 8, 10, 8))
	WorkshopUI._flat_styles(node, style, style, style, style)
	WorkshopUI._ink(node, Color("#06222d") if primary else Color(1, 1, 1, 0.86), 12.5, 700)
	node.add_theme_color_override("font_disabled_color", Color(Color("#06222d") if primary else Color(1, 1, 1, 0.86), 0.5))
	node.disabled = not enabled
	if not enabled:
		node.modulate = Color(1, 1, 1, 0.6)
		node.mouse_default_cursor_shape = Control.CURSOR_ARROW
	return node


func _number(value: Variant) -> bool:
	return value != null and (value is float or value is int) and is_finite(float(value))


func _valid() -> bool:
	if _type == _freeform:
		return true
	for value in [_box["north"], _box["south"], _box["west"], _box["east"], _centre]:
		if not _number(value):
			return false
	return float(_box["north"]) > float(_box["south"]) and float(_box["east"]) > float(_box["west"])


func _edited() -> void:
	_exact_bounds = null


func _render() -> void:
	clear_body()
	var name := str(info.get("name", ""))
	var aspect := float(info.get("aspect", 0.0)) if info.get("aspect") != null else 0.0
	var lead := ""
	if not name.is_empty() and aspect > 0.0:
		lead = I18n.ui("\"{{name}}\" ({{aspect}}:1) is kept exactly as it is. Say how it is drawn, and the map takes its projection.", {"name": name, "aspect": "%.2f" % aspect})
	elif not name.is_empty():
		lead = I18n.ui("\"{{name}}\" is kept exactly as it is. Say how it is drawn, and the map takes its projection.", {"name": name})
	elif aspect > 0.0:
		lead = I18n.ui("This picture ({{aspect}}:1) is kept exactly as it is. Say how it is drawn, and the map takes its projection.", {"aspect": "%.2f" % aspect})
	else:
		lead = "This picture is kept exactly as it is. Say how it is drawn, and the map takes its projection."
	body.add_child(_note(lead))
	var qbam := _button("It's Q-BAM", false)
	qbam.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	qbam.pressed.connect(func() -> void:
		_type = QBAM_TYPE
		_centre = QBAM_CENTRE
		_box = {"north": 90.0, "south": -90.0, "west": -180.0, "east": 180.0}
		_exact_bounds = QBAM_BOUNDS
		_render())
	body.add_child(qbam)
	var select := WorkshopUI.select(_projections, _type, func(value: String) -> void:
		_edited()
		_type = value
		_render(), 12.0, 28.0)
	select.custom_minimum_size.x = 150
	select.size_flags_horizontal = Control.SIZE_SHRINK_END
	body.add_child(WorkshopUI.row("Drawn in", select))
	var freeform := _type == _freeform
	if not freeform:
		body.add_child(WorkshopUI.row("Centre longitude", WorkshopUI.number_field(_centre, func(value: Variant) -> void:
			_edited()
			_centre = value
			_refresh_validity())))
		body.add_child(_note("The part of the globe it shows, in degrees, west and east measured from the centre. A whole-world map is 90, -90, -180, 180."))
		for pair in [["north", "North edge"], ["south", "South edge"], ["west", "West edge"], ["east", "East edge"]]:
			var key: String = pair[0]
			body.add_child(WorkshopUI.row(str(pair[1]), WorkshopUI.number_field(_box[key], func(value: Variant) -> void:
				_edited()
				_box[key] = value
				_refresh_validity())))
		_invalid_note = _note("North must be above south, and east right of west.", Color("#ffb4a8"))
		_invalid_note.visible = not _valid()
		body.add_child(_invalid_note)
	body.add_child(WorkshopUI.row("Delete the provinces and nations", WorkshopUI.toggle(_delete_provinces, func(on: bool) -> void:
		_delete_provinces = on
		_render())))
	var said := ""
	if freeform:
		said = "A freeform picture has no globe, so the provinces cannot be placed on it: kept, they are only stretched over it. Delete them to draw your own, or choose another basemap."
	elif _delete_provinces:
		said = "The map starts empty on the picture: provinces, cities and units are removed."
	else:
		said = "The provinces, cities and units are moved into the picture's projection. If they still do not match it, delete them or choose another basemap."
	body.add_child(_note(said, Color("#ffd59a") if freeform and not _delete_provinces else Color(1, 1, 1, 0.6)))
	if not _error.is_empty():
		body.add_child(_note(_error, Color("#ffb4a8")))
	var buttons := HBoxContainer.new()
	buttons.add_theme_constant_override("separation", 8)
	var another := _button("Choose another", false, not _busy)
	another.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	another.pressed.connect(func() -> void:
		if _busy:
			return
		closed.emit()
		host.open_basemaps())
	buttons.add_child(another)
	_use = _button("Applying…" if _busy else "Use this picture", true, not _busy and _valid())
	_use.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_use.pressed.connect(_apply)
	buttons.add_child(_use)
	body.add_child(buttons)
	_header.get_child(0).get_child(_header.get_child(0).get_child_count() - 1).visible = not _busy
	fit()


var _invalid_note: Label
var _use: Button


func _refresh_validity() -> void:
	var valid := _valid()
	if _invalid_note and is_instance_valid(_invalid_note):
		_invalid_note.visible = not valid
	if _use and is_instance_valid(_use):
		var enabled := not _busy and valid
		_use.disabled = not enabled
		_use.modulate = Color(1, 1, 1, 1) if enabled else Color(1, 1, 1, 0.6)
		_use.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if enabled else Control.CURSOR_ARROW
	fit()


func _apply() -> void:
	if _busy or not _valid():
		return
	_busy = true
	_error = ""
	_render()
	var args := {"type": _type, "centre": float(_centre) if _number(_centre) else 0.0, "aspect": info.get("aspect"), "deleteProvinces": _delete_provinces, "thumbnail": str(info.get("thumbnail", "")), "box": _box.duplicate(), "bounds": _exact_bounds}
	var reply := await host.request_raw("workshop.maps.pictureSetup", args)
	if not is_instance_valid(self):
		return
	var result: Dictionary = reply["result"] if reply.get("ok", false) and reply["result"] is Dictionary else {"error": str(reply.get("error", "Something went wrong."))}
	if result.has("status") or result.has("doc"):
		await host.apply(result)
		if not is_instance_valid(self):
			return
	_busy = false
	if result.has("error"):
		_error = str(result["error"])
		_render()
		return
	closed.emit()
	host.fit_to_data()
