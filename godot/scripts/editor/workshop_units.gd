class_name WorkshopUnits
extends WorkshopShell

const TYPE_LABELS := {"infantry": "Infantry", "armor": "Armour", "air": "Air", "naval": "Naval", "artillery": "Artillery", "garrison": "Garrison"}

var host: Workshop
var _query := ""
var _list: VBoxContainer
var _place: Button


func _init() -> void:
	super._init("Units", "unit", 340.0, "left")


func setup(workshop: Workshop) -> void:
	host = workshop
	_place = WorkshopUI.pill("")
	_place.tooltip_text = "Click the map to place a unit; click an existing unit to edit it"
	_place.pressed.connect(func() -> void:
		host.set_tool("select" if host.tool == "unit" else "unit")
		_render())
	body.add_child(_place)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	row.add_child(WorkshopUI.icon_rect("search", 15, Color(1, 1, 1, 0.6)))
	row.add_child(WorkshopUI.input("", "Search name, type, owner…", func(text: String) -> void:
		_query = text
		_render(), 13.6, 32.0))
	body.add_child(row)
	_list = VBoxContainer.new()
	_list.add_theme_constant_override("separation", 3)
	body.add_child(_list)
	host.changed.connect(func(parts: Dictionary) -> void:
		if parts.has("units") or parts.has("doc"):
			_render())
	_render()


func _render() -> void:
	var placing := host.tool == "unit"
	_place.text = "Placing units — click the map (click again to stop)" if placing else "Place units on the map"
	_place.icon = WorkshopUI.icon("unit", 14)
	var active := UI.box(Color(1, 1, 1, 0.12) if placing else Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.26) if placing else Color(1, 1, 1, 0.12), 9, 1, Vector4(11, 6, 11, 6))
	WorkshopUI._flat_styles(_place, active, active, active, active)
	var units: Array = host.state.get("units", [])
	var query := _query.strip_edges().to_lower()
	var rows: Array = []
	for unit in units:
		var entry: Dictionary = unit
		var owner := str(entry.get("ownerCode", ""))
		if not query.is_empty():
			var text := "%s %s %s %s %s" % [str(entry.get("name", "")), str(entry.get("type", "")), owner, host.polity_name(owner) if not owner.is_empty() else "", str(entry.get("composition", ""))]
			if not text.to_lower().contains(query):
				continue
		rows.append(entry)
	rows.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		var left := host.polity_name(str(a.get("ownerCode", ""))) if not str(a.get("ownerCode", "")).is_empty() else ""
		var right := host.polity_name(str(b.get("ownerCode", ""))) if not str(b.get("ownerCode", "")).is_empty() else ""
		if left == right:
			return str(a.get("name", "")).naturalnocasecmp_to(str(b.get("name", ""))) < 0
		return left.naturalnocasecmp_to(right) < 0)
	WorkshopUI.clear(_list)
	if rows.is_empty():
		_list.add_child(UI.label("No unit matches that search." if not units.is_empty() else "No units yet.", 12, Color(1, 1, 1, 0.5)))
	for unit in rows:
		var entry: Dictionary = unit
		var id := str(entry.get("id", ""))
		var parts := WorkshopUI.card(8, Color(0, 0, 0, 0), Color(1, 1, 1, 0.09), Vector4(8, 6, 8, 6), 2)
		var inner: VBoxContainer = parts[1]
		var line := HBoxContainer.new()
		line.add_theme_constant_override("separation", 6)
		var texts := VBoxContainer.new()
		texts.add_theme_constant_override("separation", 1)
		texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var name := str(entry.get("name", ""))
		texts.add_child(UI.label(name if not name.is_empty() else "Unit", 13, Color(1, 1, 1), 600))
		var owner := str(entry.get("ownerCode", ""))
		var sub := "%s · %s · %d%%" % [str(TYPE_LABELS.get(str(entry.get("type", "")), str(entry.get("type", "")))), host.polity_name(owner) if not owner.is_empty() else "no owner", int(float(entry.get("strength", 100)))]
		if not str(entry.get("composition", "")).is_empty():
			sub += " · " + str(entry.get("composition", ""))
		texts.add_child(UI.label(sub, 11, Color(1, 1, 1, 0.5)))
		WorkshopUI.ignore_mouse(texts)
		var edit := WorkshopUI.base_button("")
		var empty := StyleBoxEmpty.new()
		for state_name in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
			edit.add_theme_stylebox_override(state_name, empty)
		edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		edit.custom_minimum_size.y = 34
		edit.tooltip_text = "Edit"
		texts.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		edit.add_child(texts)
		var lng := float(entry.get("lng", 0))
		var lat := float(entry.get("lat", 0))
		edit.pressed.connect(func() -> void:
			host.locate(Vector2(lng, lat))
			host.open_popup("unit", id, Vector2(host.map.size.x * 0.5, host.map.size.y * 0.5 - 160.0), false))
		line.add_child(edit)
		var locate := WorkshopUI.bare_icon("fit", "Locate")
		locate.pressed.connect(func() -> void: host.locate(Vector2(lng, lat)))
		line.add_child(locate)
		var trash := WorkshopUI.bare_icon("trash", "Delete", Color("#f87171"))
		trash.pressed.connect(func() -> void: host.request("workshop.unit.remove", {"unitId": id}))
		line.add_child(trash)
		inner.add_child(line)
		_list.add_child(parts[0])
	clear_footer()
	var foot := HBoxContainer.new()
	foot.add_theme_constant_override("separation", 8)
	var count := UI.label("%d unit%s at the start of the scenario" % [units.size(), "" if units.size() == 1 else "s"], 12, Color(1, 1, 1, 0.5))
	count.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	foot.add_child(count)
	if not units.is_empty():
		var delete_all := WorkshopUI.danger_pill("Delete All")
		delete_all.pressed.connect(func() -> void:
			if await host.confirm("Remove all %d starting units from this map?" % units.size()):
				host.request("workshop.unit.removeAll"))
		foot.add_child(delete_all)
	footer.add_child(foot)
	fit()
