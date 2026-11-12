class_name WorkshopTypes
extends WorkshopShell

var host: Workshop
var _expanded := {}
var _draft := ""
var _usage := {}
var _types: Array = []
var _pending := false
var _initialized := false


func _init() -> void:
	super._init("Region Types", "types", 360.0, "left")


func setup(workshop: Workshop) -> void:
	host = workshop
	host.changed.connect(func(parts: Dictionary) -> void:
		if parts.has("regions") or parts.has("doc"):
			if typing_inside():
				_pending = true
				return
			_reload())
	await _reload()


func _process(_delta: float) -> void:
	if _pending and not typing_inside():
		_pending = false
		_reload()


func _reload() -> void:
	var doc: Dictionary = host.state.get("doc", {})
	_types = (doc.get("types", []) as Array).duplicate(true)
	if not _initialized and not _types.is_empty():
		_initialized = true
		_expanded[str((_types[0] as Dictionary).get("id", ""))] = true
	var reply := await host.request_raw("workshop.types.usage")
	if reply.get("ok", false):
		_usage = (reply["result"] as Dictionary).get("usage", {})
	_render()


func _save() -> void:
	await host.request("workshop.types.set", {"types": _types})


func _update(id: String, patch: Dictionary) -> void:
	for index in range(_types.size()):
		var row: Dictionary = _types[index]
		if str(row.get("id", "")) == id:
			for key in patch:
				row[key] = patch[key]
	_save()


func _update_zoom(id: String, patch: Dictionary) -> void:
	for index in range(_types.size()):
		var row: Dictionary = _types[index]
		if str(row.get("id", "")) != id:
			continue
		var bands: Array = row.get("zoomSettings", []) if row.get("zoomSettings") is Array else []
		var first: Dictionary = (bands[0] as Dictionary).duplicate() if not bands.is_empty() and bands[0] is Dictionary else {}
		for key in patch:
			first[key] = patch[key]
		row["zoomSettings"] = [first]
	_save()


func _render() -> void:
	clear_body()
	var top := HBoxContainer.new()
	top.add_theme_constant_override("separation", 6)
	top.add_child(WorkshopUI.input(_draft, "New type name (e.g. Mountain)", func(text: String) -> void: _draft = text, 12.5, 28.0))
	var add := WorkshopUI.pill("Add", true)
	add.icon = WorkshopUI.icon("plus", 14)
	add.pressed.connect(func() -> void:
		var id := "type_%s" % String.num_int64(int(Time.get_unix_time_from_system() * 1000.0), 36)
		var row := {"id": id, "name": _draft.strip_edges() if not _draft.strip_edges().is_empty() else "New Type", "opacity": 0.55, "unownedOpacity": 0.25, "zIndex": 1, "strokeWidth": 1.5, "strokeColor": [0, 0, 0], "strokeOpacity": 1, "overrideColor": null, "pathfindingSpeed": 1, "interactable": true, "showToDefaultPrompt": true, "passable": true, "includedInLabels": true, "zoomSettings": [{"minZoom": 0, "maxZoom": 24}]}
		_types.append(row)
		_expanded[id] = true
		_draft = ""
		_save())
	top.add_child(add)
	body.add_child(top)
	for entry in _types:
		var row: Dictionary = entry
		var id := str(row.get("id", ""))
		var open := _expanded.has(id)
		var parts := WorkshopUI.card(10, Color(0, 0, 0, 0), Color(1, 1, 1, 0.1), Vector4(0, 0, 0, 0), 0)
		var inner: VBoxContainer = parts[1]
		var head := PanelContainer.new()
		head.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.04), Color(0, 0, 0, 0), 10, 0, Vector4(10, 8, 10, 8)))
		var head_row := HBoxContainer.new()
		head_row.add_theme_constant_override("separation", 8)
		var override: Variant = row.get("overrideColor")
		head_row.add_child(WorkshopUI.swatch(WorkshopUI.rgb_color(override) if override is Array else Color(1, 1, 1, 0.25), 12.0, 3))
		var title := UI.label(str(row.get("name", "")), 13, Color(1, 1, 1), 700)
		title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		head_row.add_child(title)
		head_row.add_child(UI.label("%d regions" % int(_usage.get(id, 0)), 11, Color(1, 1, 1, 0.5)))
		head_row.add_child(WorkshopUI.icon_rect("close" if open else "plus", 13))
		head.add_child(head_row)
		WorkshopUI.ignore_mouse(head)
		WorkshopUI.clickable(head, func(_event: InputEventMouseButton) -> void:
			if _expanded.has(id):
				_expanded.erase(id)
			else:
				_expanded[id] = true
			_render())
		inner.add_child(head)
		if open:
			var fields := VBoxContainer.new()
			fields.add_theme_constant_override("separation", 7)
			var margin := MarginContainer.new()
			for pair in [["margin_left", 12], ["margin_right", 12], ["margin_top", 10], ["margin_bottom", 10]]:
				margin.add_theme_constant_override(pair[0], pair[1])
			margin.add_child(fields)
			var name_edit := WorkshopUI.input(str(row.get("name", "")), "", func(text: String) -> void: _update(id, {"name": text}), 12.0, 28.0)
			name_edit.custom_minimum_size.x = 150
			name_edit.size_flags_horizontal = Control.SIZE_SHRINK_END
			fields.add_child(WorkshopUI.row("Name", name_edit))
			fields.add_child(WorkshopUI.row("Opacity", WorkshopUI.number_field(row.get("opacity"), func(value: Variant) -> void: _update(id, {"opacity": value}))))
			fields.add_child(WorkshopUI.row("Unowned Opacity", WorkshopUI.number_field(row.get("unownedOpacity"), func(value: Variant) -> void: _update(id, {"unownedOpacity": value}))))
			fields.add_child(WorkshopUI.row("Z-Index", WorkshopUI.number_field(row.get("zIndex"), func(value: Variant) -> void: _update(id, {"zIndex": value}))))
			fields.add_child(WorkshopUI.row("Stroke Width", WorkshopUI.number_field(row.get("strokeWidth"), func(value: Variant) -> void: _update(id, {"strokeWidth": value}))))
			fields.add_child(WorkshopUI.row("Stroke Color", WorkshopUI.color_field(row.get("strokeColor", [0, 0, 0]) if row.get("strokeColor") is Array else [0, 0, 0], func(rgb: Array) -> void: _update(id, {"strokeColor": rgb}))))
			fields.add_child(WorkshopUI.row("Stroke Opacity", WorkshopUI.number_field(row.get("strokeOpacity"), func(value: Variant) -> void: _update(id, {"strokeOpacity": value}))))
			var override_row := HBoxContainer.new()
			override_row.add_theme_constant_override("separation", 6)
			override_row.add_child(WorkshopUI.toggle(override is Array, func(on: bool) -> void:
				_update(id, {"overrideColor": (override if override is Array else [90, 90, 100]) if on else null})
				_render()))
			if override is Array:
				override_row.add_child(WorkshopUI.color_field(override, func(rgb: Array) -> void: _update(id, {"overrideColor": rgb})))
			fields.add_child(WorkshopUI.row("Override Color", override_row, "Force a fixed fill color instead of the owner's color"))
			fields.add_child(WorkshopUI.row("Pathfinding Speed", WorkshopUI.number_field(row.get("pathfindingSpeed"), func(value: Variant) -> void: _update(id, {"pathfindingSpeed": value})), "1 is the usual speed. Below 1 is slower, above 1 is faster, and 0 is impassable."))
			fields.add_child(WorkshopUI.row("Interactable", WorkshopUI.toggle(bool(row.get("interactable", true)), func(on: bool) -> void: _update(id, {"interactable": on})), "Off: the AI places no units and builds no structures in these regions."))
			fields.add_child(WorkshopUI.row("Passable", WorkshopUI.toggle(bool(row.get("passable", true)), func(on: bool) -> void: _update(id, {"passable": on})), "Off: the AI moves no units into or through these regions."))
			fields.add_child(WorkshopUI.row("Water", WorkshopUI.toggle(_is_water(row), func(on: bool) -> void: _update(id, {"water": on})), "On: these regions are sea. Troop transporters sail through them, and no army marches across them."))
			fields.add_child(WorkshopUI.row("Included In Labels", WorkshopUI.toggle(bool(row.get("includedInLabels", true)), func(on: bool) -> void: _update(id, {"includedInLabels": on}))))
			var bands: Array = row.get("zoomSettings", []) if row.get("zoomSettings") is Array else []
			var band: Dictionary = bands[0] if not bands.is_empty() and bands[0] is Dictionary else {}
			var zoom_row := HBoxContainer.new()
			zoom_row.add_theme_constant_override("separation", 4)
			zoom_row.add_child(WorkshopUI.number_field(band.get("minZoom", 0), func(value: Variant) -> void: _update_zoom(id, {"minZoom": value}), 52.0))
			zoom_row.add_child(WorkshopUI.number_field(band.get("maxZoom", 24), func(value: Variant) -> void: _update_zoom(id, {"maxZoom": value}), 52.0))
			fields.add_child(WorkshopUI.row("Zoom Min / Max", zoom_row, "Type is hidden outside this zoom range"))
			var delete := WorkshopUI.pill("Delete type", false, Color("#f87171"))
			delete.icon = WorkshopUI.icon("trash", 13, Color("#f87171"))
			delete.disabled = _types.size() <= 1
			if _types.size() <= 1:
				delete.modulate.a = 0.4
			delete.pressed.connect(func() -> void:
				if _types.size() <= 1:
					return
				var kept: Array = []
				for other in _types:
					if str((other as Dictionary).get("id", "")) != id:
						kept.append(other)
				_types = kept
				_save())
			fields.add_child(delete)
			inner.add_child(margin)
		body.add_child(parts[0])
	fit()


func _is_water(row: Dictionary) -> bool:
	if row.get("water") is bool:
		return bool(row["water"])
	var regex := RegEx.create_from_string("(?i)(?:^|[^\\p{L}])(?:oceans?|seas?|waters?|lakes?)(?:$|[^\\p{L}])")
	return regex.search(str(row.get("name", ""))) != null
