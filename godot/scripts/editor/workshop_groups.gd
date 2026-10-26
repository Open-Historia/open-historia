class_name WorkshopGroups
extends WorkshopShell

const PALETTE := ["#e11d48", "#f97316", "#eab308", "#65a30d", "#10b981", "#06b6d4", "#3b82f6", "#ec4899", "#dc2626", "#0ea5e9"]

var host: Workshop
var _current := ""
var _draft := ""
var _new_name := ""
var _delete_armed := false
var _note := ""
var _usage := {}
var _pending := false
var _in_group: Array = []


func _init() -> void:
	super._init("Groups", "list", 340.0, "left")


func setup(workshop: Workshop) -> void:
	host = workshop
	host.changed.connect(func(parts: Dictionary) -> void:
		if parts.has("regions") or parts.has("doc") or parts.has("selection"):
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
	var reply := await host.request_raw("workshop.groups.usage")
	if reply.get("ok", false):
		_usage = (reply["result"] as Dictionary).get("usage", {})
	_in_group = await _selected_in_group(_current) if not _current.is_empty() else []
	_render()


func _registry() -> Dictionary:
	var doc: Dictionary = host.state.get("doc", {})
	return doc.get("rawGroups", {})


func _names() -> Array:
	var all := {}
	for key in _registry():
		all[str(key)] = true
	for key in _usage:
		all[str(key)] = true
	var names: Array = all.keys()
	names.sort_custom(func(a: Variant, b: Variant) -> bool: return str(a).naturalnocasecmp_to(str(b)) < 0)
	return names


func _record(name: String) -> Dictionary:
	var doc: Dictionary = host.state.get("doc", {})
	var normalized: Dictionary = doc.get("groups", {})
	var raw: Dictionary = _registry()
	if raw.get(name) is Dictionary:
		var merged: Dictionary = (normalized.get(name, {}) as Dictionary).duplicate() if normalized.get(name) is Dictionary else {}
		for key in raw[name]:
			merged[key] = raw[name][key]
		return merged
	return normalized.get(name, {"name": name, "description": "", "color": PALETTE[0]}) if normalized.get(name) is Dictionary else {"name": name, "description": "", "color": PALETTE[0]}


func _color_of(name: String) -> Color:
	var text := str(_record(name).get("color", PALETTE[0]))
	return Color(text) if Color.html_is_valid(text) else Color(PALETTE[0])


func _count_text(name: String) -> String:
	var count := int(_usage.get(name, 0))
	return "1 region" if count == 1 else "%d regions" % count


func _render() -> void:
	clear_body()
	var names := _names()
	if not _current.is_empty() and not names.has(_current):
		_current = ""
	if _current.is_empty():
		var list := VBoxContainer.new()
		list.add_theme_constant_override("separation", 4)
		if names.is_empty():
			list.add_child(UI.label("No groups yet.", 12, Color(1, 1, 1, 0.5)))
		for name in names:
			var group_name := str(name)
			var button := WorkshopUI.pill("")
			button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			button.custom_minimum_size.y = 30
			var row := HBoxContainer.new()
			row.add_theme_constant_override("separation", 8)
			row.mouse_filter = Control.MOUSE_FILTER_IGNORE
			row.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
			row.offset_left = 11
			row.offset_right = -11
			row.add_child(WorkshopUI.swatch(_color_of(group_name), 14.0, 3))
			var caption := UI.label(group_name, 12, Color(1, 1, 1), 600)
			caption.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			caption.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			row.add_child(caption)
			var count := UI.label(_count_text(group_name), 11, Color(1, 1, 1, 0.5), 500)
			count.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			row.add_child(count)
			button.add_child(row)
			button.pressed.connect(func() -> void: _open(group_name))
			list.add_child(button)
		body.add_child(list)
		body.add_child(WorkshopUI.label_dim("New group"))
		var line := HBoxContainer.new()
		line.add_theme_constant_override("separation", 6)
		var create := WorkshopUI.pill("Create", true)
		create.disabled = _new_name.strip_edges().is_empty()
		var edit := WorkshopUI.input(_new_name, "Cartel del Norte", func(text: String) -> void:
			_new_name = text
			create.disabled = text.strip_edges().is_empty(), 12.5, 30.0)
		edit.max_length = 80
		edit.text_submitted.connect(func(_text: String) -> void: _create())
		line.add_child(edit)
		create.pressed.connect(_create)
		line.add_child(create)
		body.add_child(line)
		if not host.selection.is_empty():
			body.add_child(UI.label("A new group takes the %s." % ("selected region" if host.selection.size() == 1 else "%d selected regions" % host.selection.size()), 11, Color(1, 1, 1, 0.5)))
	else:
		var record := _record(_current)
		var back := WorkshopUI.pill("← All groups")
		back.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		back.pressed.connect(func() -> void:
			_current = ""
			_note = ""
			_render())
		body.add_child(back)
		body.add_child(WorkshopUI.label_dim("Name"))
		var name_edit := WorkshopUI.input(_draft, "", func(text: String) -> void: _draft = text, 12.5, 30.0)
		name_edit.max_length = 80
		name_edit.text_submitted.connect(func(_text: String) -> void: _rename())
		name_edit.focus_exited.connect(_rename)
		body.add_child(name_edit)
		body.add_child(WorkshopUI.label_dim("What it is (the AI is told this)"))
		var current := _current
		var description := WorkshopUI.area(str(record.get("description", "")), 5, "A drug cartel that runs the border towns, taxes the smuggling routes and fights the army for the highways.", func(text: String) -> void: host.request("workshop.group.patch", {"name": current, "patch": {"description": text}}), 12.5)
		description.focus_exited.connect(func() -> void: host.request("workshop.group.patch", {"name": current, "patch": {"descriptionFinal": description.text}}))
		body.add_child(description)
		body.add_child(WorkshopUI.label_dim("Population when the scenario begins"))
		var population := WorkshopUI.input("", "Leave empty and the game goes by the land it holds", Callable(), 12.5, 30.0)
		body.add_child(population)
		_format_population(population, record.get("population"))
		population.focus_exited.connect(func() -> void:
			var reply := await host.request_raw("workshop.population.format", {"text": population.text})
			if reply.get("ok", false):
				population.text = str((reply["result"] as Dictionary).get("text", ""))
			host.request("workshop.group.patch", {"name": current, "patch": {"populationText": population.text}}))
		var military := WorkshopMilitary.new()
		body.add_child(military)
		military.military_changed.connect(func(value: Variant) -> void: host.request("workshop.group.patch", {"name": current, "patch": {"military": value}}))
		military.setup(host, "group", current, record.get("military"))
		body.add_child(WorkshopUI.label_dim("Tint colour"))
		var swatches := HFlowContainer.new()
		swatches.add_theme_constant_override("h_separation", 5)
		swatches.add_theme_constant_override("v_separation", 5)
		var chosen := str(record.get("color", "")).to_lower()
		for color in PALETTE:
			var chip := WorkshopUI.base_button("")
			chip.custom_minimum_size = Vector2(22, 22)
			chip.tooltip_text = str(color)
			var style := UI.box(Color(str(color)), Color(1, 1, 1) if chosen == str(color) else Color(0, 0, 0, 0.5), 5, 2 if chosen == str(color) else 1)
			for state_name in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
				chip.add_theme_stylebox_override(state_name, style)
			var value := str(color)
			chip.pressed.connect(func() -> void: host.request("workshop.group.patch", {"name": current, "patch": {"color": value}}))
			swatches.add_child(chip)
		var custom := WorkshopUI.color_field(WorkshopUI.color_rgb(_color_of(current)), func(rgb: Array) -> void: host.request("workshop.group.patch", {"name": current, "patch": {"color": WorkshopUI.hex(WorkshopUI.rgb_color(rgb))}}))
		custom.tooltip_text = "Custom colour"
		custom.custom_minimum_size = Vector2(30, 24)
		swatches.add_child(custom)
		body.add_child(swatches)
		body.add_child(WorkshopUI.label_dim("Area"))
		var area_text := _count_text(current)
		if not host.selection.is_empty():
			area_text += " · %d selected" % host.selection.size()
		body.add_child(UI.label(area_text, 12, Color(1, 1, 1, 0.75)))
		var actions := HFlowContainer.new()
		actions.add_theme_constant_override("h_separation", 6)
		actions.add_theme_constant_override("v_separation", 6)
		var select := WorkshopUI.pill("Select its regions")
		select.disabled = int(_usage.get(current, 0)) == 0
		select.pressed.connect(func() -> void:
			var reply := await host.request_raw("workshop.selectGroup", {"name": current})
			if reply.get("ok", false):
				var result: Dictionary = reply["result"]
				host.set_selection(result.get("ids", []))
				var bounds: Variant = result.get("bounds")
				if bounds is Array:
					host.map.fit_bounds(bounds, 7.0, 0.3))
		actions.add_child(select)
		var add := WorkshopUI.pill("Add the selection")
		add.tooltip_text = "Put the selected regions in this group's area"
		add.disabled = host.selection.is_empty()
		add.pressed.connect(func() -> void:
			await host.request("workshop.attrs", {"ids": host.selection, "patch": {"group": current}})
			_note = "%s now controls the selection." % current
			_reload())
		actions.add_child(add)
		var remove := WorkshopUI.pill("Remove the selection")
		remove.tooltip_text = "Take the selected regions out of this group's area"
		var in_group := _in_group.duplicate()
		remove.disabled = in_group.is_empty()
		remove.pressed.connect(func() -> void:
			await host.request("workshop.attrs", {"ids": in_group, "patch": {"group": null}})
			_note = "Taken out of %s's area." % current
			_reload())
		actions.add_child(remove)
		body.add_child(actions)
		var erase := WorkshopUI.pill(("Erase %s and its area? Click again" % current) if _delete_armed else "Erase group", false, Color("#f87171"))
		erase.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		erase.pressed.connect(func() -> void:
			if not _delete_armed:
				_delete_armed = true
				_render()
				return
			var reply := await host.request("workshop.group.erase", {"name": current})
			_current = ""
			_delete_armed = false
			_note = str(reply.get("note", ""))
			await _reload())
		body.add_child(erase)
	if not _note.is_empty():
		body.add_child(WorkshopUI.wrap(_note, 11.5, Color(191 / 255.0, 219 / 255.0, 254 / 255.0, 0.9)))
	fit()


func _selected_in_group(name: String) -> Array:
	if host.selection.is_empty():
		return []
	var reply := await host.request_raw("workshop.summaries", {"ids": host.selection})
	var out: Array = []
	if reply.get("ok", false):
		for summary in (reply["result"] as Dictionary).get("summaries", []):
			if str((summary as Dictionary).get("group", "")) == name:
				out.append(str((summary as Dictionary).get("id", "")))
	return out


func _format_population(edit: LineEdit, value: Variant) -> void:
	if value == null:
		return
	var reply := await host.request_raw("workshop.population.format", {"value": value})
	if reply.get("ok", false) and is_instance_valid(edit):
		edit.text = str((reply["result"] as Dictionary).get("text", ""))


func _open(name: String) -> void:
	_current = name
	_draft = name
	_delete_armed = false
	_note = ""
	_reload()


func _create() -> void:
	var name := _new_name.strip_edges()
	if name.is_empty():
		return
	var reply := await host.request("workshop.group.create", {"name": name, "selection": host.selection})
	if reply.has("name"):
		_new_name = ""
		_current = str(reply["name"])
		_draft = _current
		_delete_armed = false
	_note = str(reply.get("note", ""))
	await _reload()


func _rename() -> void:
	if _current.is_empty():
		return
	var to := _draft.strip_edges()
	if to.is_empty() or to == _current:
		_draft = _current
		return
	var reply := await host.request("workshop.group.rename", {"from": _current, "to": to})
	_current = str(reply.get("name", _current))
	_draft = _current
	_note = str(reply.get("note", ""))
	await _reload()
