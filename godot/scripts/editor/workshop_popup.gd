class_name WorkshopPopup
extends PanelContainer

signal closed

const SIZES := [[1, "Town"], [2, "City"], [3, "Major city"]]
const UNIT_TYPES := ["infantry", "armor", "air", "naval", "artillery", "garrison"]
const UNIT_LABELS := {"infantry": "Infantry", "armor": "Armour", "air": "Air", "naval": "Naval", "artillery": "Artillery", "garrison": "Garrison"}
const MAP_FEATURE_KINDS := [["landmark", "Landmark"], ["military hq", "Military HQ"], ["military base", "Military base"], ["fortress", "Fortress"], ["airfield", "Airfield"], ["port", "Port"], ["mine", "Mine or quarry"], ["oil field", "Oil field"], ["industrial plant", "Industrial plant"], ["power plant", "Power plant"], ["research facility", "Research facility"], ["embassy", "Embassy"]]
const STATUS_LABELS := [["planned", "Planned"], ["under_construction", "Under construction"], ["active", "Active"], ["damaged", "Damaged"], ["inactive", "Inactive"], ["abandoned", "Abandoned"], ["destroyed", "Destroyed"]]

var host: Workshop
var kind := "feature"
var target_id := ""
var is_new := false
var _column: VBoxContainer
var _custom_kind := false
var _row: Dictionary = {}


func setup(workshop: Workshop, popup_kind: String, id: String, fresh: bool) -> void:
	host = workshop
	kind = popup_kind
	target_id = id
	is_new = fresh
	add_theme_stylebox_override("panel", UI.box(WorkshopUI.PANEL, Color(1, 1, 1, 0.09), 16, 1, Vector4(10, 10, 10, 10)))
	mouse_filter = Control.MOUSE_FILTER_STOP
	_column = VBoxContainer.new()
	_column.add_theme_constant_override("separation", 8)
	add_child(_column)
	_row = _find()
	if kind == "unit":
		custom_minimum_size.x = 282
		_build_unit()
	elif bool(_row.get("isMap", false)):
		custom_minimum_size.x = 280
		var listed := false
		for entry in MAP_FEATURE_KINDS:
			if str(entry[0]) == str(_row.get("kind", "landmark")):
				listed = true
		_custom_kind = not listed
		_build_marker()
	else:
		custom_minimum_size.x = 270
		_build_city()


func place(anchor: Vector2, view: Vector2) -> void:
	reset_size()
	var width := custom_minimum_size.x
	var height_room := 250.0 if kind == "feature" and not bool(_row.get("isMap", false)) else (330.0 if kind == "unit" else 360.0)
	position = Vector2(maxf(8.0, minf(anchor.x - 20.0, view.x - width - 18.0)), maxf(8.0, minf(anchor.y + 14.0, view.y - height_room)))


func _find() -> Dictionary:
	var rows: Array = host.state.get("units", []) if kind == "unit" else host.state.get("features", [])
	for row in rows:
		if str((row as Dictionary).get("id", "")) == target_id:
			return row
	return {}


func _update(patch: Dictionary) -> void:
	for key in patch:
		_row[key] = patch[key]
	if kind == "unit":
		await host.request("workshop.unit.update", {"unitId": target_id, "patch": patch})
	else:
		await host.request("workshop.feature.update", {"featureId": target_id, "patch": patch})


func _name_field(placeholder: String) -> LineEdit:
	var edit := WorkshopUI.input(str(_row.get("name", "")), placeholder, func(text: String) -> void: _update({"name": text}), 13.0, 32.0)
	edit.add_theme_font_override("font", UI.font(600))
	edit.text_submitted.connect(func(_text: String) -> void: closed.emit())
	_column.add_child(edit)
	edit.grab_focus.call_deferred()
	if is_new:
		edit.select_all.call_deferred()
	return edit


func _caption(text: String) -> Label:
	return UI.label(text, 11, Color(1, 1, 1, 0.7), 700)


func _buttons() -> void:
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 8)
	var delete := WorkshopUI.danger_pill("Delete")
	delete.pressed.connect(func() -> void:
		if kind == "unit":
			await host.request("workshop.unit.remove", {"unitId": target_id})
		else:
			await host.request("workshop.feature.remove", {"featureId": target_id})
		closed.emit())
	line.add_child(delete)
	line.add_child(UI.spacer())
	var done := WorkshopUI.pill("Done", true)
	done.pressed.connect(func() -> void: closed.emit())
	line.add_child(done)
	_column.add_child(line)


func _tier() -> int:
	var authored := float(_row.get("tier", 0)) if _row.get("tier") != null else 0.0
	if authored >= 1.0 and authored <= 3.0:
		return int(round(authored))
	var pop := float(_row.get("population", 0)) if _row.get("population") != null else 0.0
	return 3 if pop >= 1000000.0 else (2 if pop >= 100000.0 else 1)


func _build_city() -> void:
	_name_field("City name")
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 8)
	var options: Array = []
	for entry in SIZES:
		options.append([str(entry[0]), str(entry[1])])
	var size_select := WorkshopUI.select(options, str(_tier()), func(value: String) -> void: _update({"tier": int(value)}), 12.0, 28.0)
	size_select.tooltip_text = "City size"
	line.add_child(size_select)
	var tags: Array = _row.get("tags", []) if _row.get("tags") is Array else []
	var capital := WorkshopUI.check("★ Capital", tags.has("capital"), func(on: bool) -> void:
		var current: Array = (_row.get("tags", []) as Array).duplicate() if _row.get("tags") is Array else []
		current.erase("capital")
		if on:
			current.append("capital")
		_update({"tags": current}))
	line.add_child(capital)
	_column.add_child(line)
	_column.add_child(_caption("Population"))
	var population := WorkshopUI.input("" if _row.get("population") == null else str(int(float(_row.get("population", 0)))), "0", Callable(), 12.0, 28.0)
	population.text_changed.connect(func(text: String) -> void:
		var trimmed := text.strip_edges()
		if trimmed.is_empty():
			_update({"population": null})
		elif trimmed.is_valid_float():
			_update({"population": maxi(0, int(round(trimmed.to_float())))}))
	population.focus_exited.connect(func() -> void:
		if population.text.strip_edges().is_empty():
			_update({"population": 0}))
	_column.add_child(population)
	_column.add_child(_caption("Population by year"))
	var series := ""
	var by_year: Variant = _row.get("populationByYear")
	if by_year is Dictionary:
		var years: Array = (by_year as Dictionary).keys()
		years.sort_custom(func(a: Variant, b: Variant) -> bool: return int(str(a)) < int(str(b)))
		var lines: PackedStringArray = []
		for year in years:
			lines.append("%s: %s" % [str(year), str(int(float((by_year as Dictionary)[year])))])
		series = "\n".join(lines)
	var area := WorkshopUI.area(series, 3, "1950: 1200000\n2000: 3400000", func(text: String) -> void: _update({"populationByYearText": text}), 12.0)
	_column.add_child(area)
	_buttons()


func _build_marker() -> void:
	_name_field("Feature name")
	_column.add_child(_caption("Type"))
	var options: Array = MAP_FEATURE_KINDS.duplicate()
	options.append(["__other", "Other…"])
	var current_kind := str(_row.get("kind", "landmark"))
	var kind_select := WorkshopUI.select(options, "__other" if _custom_kind else current_kind, func(value: String) -> void:
		if value == "__other":
			_custom_kind = true
			_rebuild()
			return
		_custom_kind = false
		_update({"kind": value})
		_rebuild(), 12.0, 28.0)
	_column.add_child(kind_select)
	if _custom_kind:
		var listed := false
		for entry in MAP_FEATURE_KINDS:
			if str(entry[0]) == current_kind:
				listed = true
		var custom := WorkshopUI.input("" if listed else current_kind, "shipyard, missile silo, monastery…", func(text: String) -> void: _update({"kind": text.to_lower()}), 12.0, 28.0)
		_column.add_child(custom)
	_column.add_child(_caption("Held by"))
	var owner := str(_row.get("owner", "")) if _row.get("owner") != null else ""
	var holders: Array = [["", "No one"]]
	var seen := {}
	for row in host.polity_choices():
		var entry: Dictionary = row
		holders.append([str(entry["key"]), str(entry["name"])])
		seen[str(entry["key"])] = true
	if not owner.is_empty() and not seen.has(owner):
		holders.append([owner, owner])
	_column.add_child(WorkshopUI.select(holders, owner, func(value: String) -> void: _update({"owner": value if not value.is_empty() else null}), 12.0, 28.0))
	_column.add_child(_caption("State"))
	_column.add_child(WorkshopUI.select(STATUS_LABELS, str(_row.get("status", "active")) if not str(_row.get("status", "")).is_empty() else "active", func(value: String) -> void: _update({"status": value}), 12.0, 28.0))
	_column.add_child(_caption("Note (the AI reads it)"))
	_column.add_child(WorkshopUI.area(str(_row.get("note", "")), 3, "The fleet's northern anchorage; nuclear submarines.", func(text: String) -> void: _update({"note": text}), 12.0))
	_buttons()


func _rebuild() -> void:
	WorkshopUI.clear(_column)
	_row = _find() if _row.is_empty() else _row
	_build_marker()


func _build_unit() -> void:
	_name_field("Unit name, e.g. 3rd Army")
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 6)
	var types: Array = []
	for type_id in UNIT_TYPES:
		types.append([type_id, str(UNIT_LABELS.get(type_id, type_id))])
	var type_select := WorkshopUI.select(types, str(_row.get("type", "infantry")), func(value: String) -> void: _update({"type": value}), 12.0, 28.0)
	type_select.tooltip_text = "Unit type"
	line.add_child(type_select)
	line.add_child(_caption("Strength"))
	var strength := WorkshopUI.input(str(int(float(_row.get("strength", 100)))), "", Callable(), 12.0, 28.0)
	strength.custom_minimum_size.x = 62
	strength.size_flags_horizontal = Control.SIZE_SHRINK_END
	strength.tooltip_text = "Unit strength percent"
	strength.text_changed.connect(func(text: String) -> void:
		var trimmed := text.strip_edges()
		if trimmed.is_valid_float():
			var value := trimmed.to_float()
			if value >= 1.0 and value <= 100.0:
				_update({"strength": clampi(int(round(value)), 1, 100)}))
	strength.focus_exited.connect(func() -> void: strength.text = str(int(float(_row.get("strength", 100)))))
	line.add_child(strength)
	_column.add_child(line)
	_column.add_child(_caption("Owner"))
	var owner := str(_row.get("ownerCode", ""))
	var known := false
	var owners: Array = []
	for row in host.polity_choices():
		var entry: Dictionary = row
		owners.append([str(entry["key"]), str(entry["name"])])
		if str(entry["key"]) == owner:
			known = true
	if not known:
		owners.insert(0, ["", ("%s (not on this map)" % owner) if not owner.is_empty() else "Choose a country…"])
	_column.add_child(WorkshopUI.select(owners, owner if known else "", func(value: String) -> void: _update({"ownerCode": value}), 12.0, 28.0))
	_column.add_child(_caption("Composition"))
	_column.add_child(WorkshopUI.input(str(_row.get("composition", "")), "e.g. 3 tank regiments, 1 mechanised brigade", func(text: String) -> void: _update({"composition": text}), 12.0, 28.0))
	_column.add_child(_caption("What it is doing"))
	_column.add_child(WorkshopUI.input(str(_row.get("note", "")), "One sentence, e.g. Holding the northern border", func(text: String) -> void: _update({"note": text}), 12.0, 28.0))
	_buttons()
