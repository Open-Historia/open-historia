class_name WorkshopCountries
extends WorkshopShell

var host: Workshop
var _query := ""
var _selected_key := ""
var _bulk := {}
var _draft_name := ""
var _new_name := ""
var _transfer_from := ""
var _usage: Array = []
var _usage_map := {}
var _owned: Array = []
var _roster_preview: Variant = null
var _roster_message := ""
var _list_box: VBoxContainer
var _detail: VBoxContainer
var _bulk_row: HFlowContainer
var _roster_box: VBoxContainer
var _create_box: VBoxContainer
var _pending := false
var _regions_open := false
var _population_text := ""


func _init() -> void:
	super._init("Countries", "list", 390.0, "left")


func setup(workshop: Workshop) -> void:
	host = workshop
	host.changed.connect(_on_changed)
	var search := WorkshopUI.input("", "Search country name…", func(text: String) -> void:
		_query = text
		_render_list(), 13.6, 34.0)
	body.add_child(search)
	_bulk_row = HFlowContainer.new()
	_bulk_row.add_theme_constant_override("h_separation", 6)
	_bulk_row.add_theme_constant_override("v_separation", 6)
	body.add_child(_bulk_row)
	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size.y = 230
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_list_box = VBoxContainer.new()
	_list_box.add_theme_constant_override("separation", 6)
	_list_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(_list_box)
	body.add_child(scroll)
	_detail = VBoxContainer.new()
	_detail.add_theme_constant_override("separation", 9)
	body.add_child(_detail)
	_roster_box = VBoxContainer.new()
	_roster_box.add_theme_constant_override("separation", 7)
	body.add_child(_roster_box)
	_create_box = VBoxContainer.new()
	_create_box.add_theme_constant_override("separation", 6)
	body.add_child(_create_box)
	await _reload()


func _on_changed(parts: Dictionary) -> void:
	if parts.has("regions") or parts.has("doc") or parts.has("selection"):
		if typing_inside():
			_pending = true
			return
		await _reload()


func _process(_delta: float) -> void:
	if _pending and not typing_inside():
		_pending = false
		_reload()


func _reload() -> void:
	var reply := await host.request_raw("workshop.polities")
	if reply.get("ok", false):
		_usage = (reply["result"] as Dictionary).get("usage", [])
	_usage_map = {}
	for row in _usage:
		_usage_map[str((row as Dictionary)["key"])] = row
	if not _selected_key.is_empty():
		var owned := await host.request_raw("workshop.ownerRegions", {"key": _selected_key})
		_owned = (owned["result"] as Dictionary).get("regions", []) if owned.get("ok", false) else []
	_render_all()


func _polities() -> Dictionary:
	var doc: Dictionary = host.state.get("doc", {})
	return doc.get("polities", {})


func _record(key: String) -> Dictionary:
	var record: Variant = _polities().get(key)
	return record if record is Dictionary else {}


func _name_of(key: String) -> String:
	var name := str(_record(key).get("name", "")).strip_edges()
	return name if not name.is_empty() else key


func _counts(key: String) -> Dictionary:
	var row: Variant = _usage_map.get(key)
	return row if row is Dictionary else {"regionCount": 0, "claimantCount": 0}


func _all_keys() -> Array:
	var keys := {}
	for key in _polities():
		keys[str(key)] = true
	for key in _usage_map:
		keys[str(key)] = true
	return keys.keys()


func _rows() -> Array:
	var rows: Array = []
	var query := _query.strip_edges().to_lower()
	for key in _all_keys():
		var record := _record(key)
		var aliases := ""
		if record.get("aliases") is Array:
			var parts: PackedStringArray = []
			for alias in record["aliases"]:
				parts.append(str(alias))
			aliases = " ".join(parts)
		var name := _name_of(key)
		if not query.is_empty() and not ("%s %s %s" % [key, name, aliases]).to_lower().contains(query):
			continue
		var counts := _counts(key)
		rows.append({"key": key, "name": name, "regionCount": int(counts.get("regionCount", 0)), "claimantCount": int(counts.get("claimantCount", 0))})
	rows.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		var left := str(a["name"])
		var right := str(b["name"])
		if left == right:
			return str(a["key"]) < str(b["key"])
		return left.naturalnocasecmp_to(right) < 0)
	return rows


func _render_all() -> void:
	_render_list()
	_render_detail()
	_render_roster()
	_render_create()
	fit()


func _render_list() -> void:
	var rows := _rows()
	WorkshopUI.clear(_bulk_row)
	var all_selected := not rows.is_empty()
	for row in rows:
		if not _bulk.has(str((row as Dictionary)["key"])):
			all_selected = false
	var toggle_all := WorkshopUI.pill("Unselect filtered" if all_selected else "Select filtered (%d)" % rows.size())
	toggle_all.disabled = rows.is_empty()
	toggle_all.pressed.connect(func() -> void:
		for row in rows:
			var key := str((row as Dictionary)["key"])
			if all_selected:
				_bulk.erase(key)
			else:
				_bulk[key] = true
		_render_list())
	_bulk_row.add_child(toggle_all)
	var clear_bulk := WorkshopUI.pill("Clear selection")
	clear_bulk.disabled = _bulk.is_empty()
	clear_bulk.pressed.connect(func() -> void:
		_bulk = {}
		_render_list())
	_bulk_row.add_child(clear_bulk)
	var present := _bulk_rows()
	var delete := WorkshopUI.pill("Delete selected (%d)" % present.size(), true)
	delete.disabled = present.is_empty()
	delete.pressed.connect(_remove_many)
	_bulk_row.add_child(delete)
	WorkshopUI.clear(_list_box)
	var doc: Dictionary = host.state.get("doc", {})
	var colors: Dictionary = doc.get("colors", {})
	for row in rows:
		var entry: Dictionary = row
		var key := str(entry["key"])
		var line := HBoxContainer.new()
		line.add_theme_constant_override("separation", 6)
		var checked := _bulk.has(key)
		var box := PanelContainer.new()
		box.custom_minimum_size = Vector2(30, 0)
		box.add_theme_stylebox_override("panel", UI.box(Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.12) if checked else Color(1, 1, 1, 0.025), Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.65) if checked else Color(1, 1, 1, 0.08), 8, 1))
		var check := CheckBox.new()
		check.button_pressed = checked
		check.focus_mode = Control.FOCUS_NONE
		check.tooltip_text = "Include %s in bulk actions" % str(entry["name"])
		check.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
		check.toggled.connect(func(on: bool) -> void:
			if on:
				_bulk[key] = true
			else:
				_bulk.erase(key)
			_render_list())
		box.add_child(check)
		line.add_child(box)
		var active := key == _selected_key
		var parts := WorkshopUI.card(8, Color(0, 0, 0, 0.25) if active else Color(1, 1, 1, 0.035), Color(1, 1, 1, 0.28) if active else Color(1, 1, 1, 0.08), Vector4(9, 7, 9, 7), 1)
		var card: PanelContainer = parts[0]
		var inner: VBoxContainer = parts[1]
		var top := HBoxContainer.new()
		top.add_theme_constant_override("separation", 8)
		top.add_child(WorkshopUI.swatch(WorkshopUI.rgb_color(colors[key]) if colors.has(key) else Color(1, 1, 1, 0.18), 14.0, 4))
		var texts := VBoxContainer.new()
		texts.add_theme_constant_override("separation", 1)
		texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var name_label := UI.label(str(entry["name"]), 13, Color(1, 1, 1), 700)
		name_label.clip_text = true
		name_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		texts.add_child(name_label)
		var sub := ("%d regions" % int(entry["regionCount"])) if int(entry["regionCount"]) > 0 else "registered, no regions yet"
		if int(entry["claimantCount"]) > 0:
			sub += " · %d claims" % int(entry["claimantCount"])
		var former: Variant = _record(key).get("formerNames")
		if former is Array and not (former as Array).is_empty():
			var names: PackedStringArray = []
			for value in former:
				names.append(str(value))
			sub += " · formerly " + ", ".join(names)
		var sub_label := UI.label(sub, 11, Color(1, 1, 1, 0.48))
		sub_label.clip_text = true
		sub_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		texts.add_child(sub_label)
		top.add_child(texts)
		inner.add_child(top)
		card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		WorkshopUI.ignore_mouse(card)
		WorkshopUI.clickable(card, func(_event: InputEventMouseButton) -> void:
			_selected_key = key
			_draft_name = _name_of(key)
			_transfer_from = ""
			_select_territory(key)
			_reload())
		line.add_child(card)
		_list_box.add_child(line)


func _bulk_rows() -> Array:
	var keys := {}
	for key in _all_keys():
		keys[key] = true
	var out: Array = []
	for key in _bulk:
		if keys.has(key):
			var counts := _counts(str(key))
			out.append({"key": str(key), "name": _name_of(str(key)), "regionCount": int(counts.get("regionCount", 0)), "claimantCount": int(counts.get("claimantCount", 0))})
	return out


func _remove_many() -> void:
	var targets := _bulk_rows()
	if targets.is_empty():
		return
	var keys: Array = []
	var region_count := 0
	var claim_count := 0
	for row in targets:
		keys.append(str((row as Dictionary)["key"]))
		region_count += int((row as Dictionary)["regionCount"])
		claim_count += int((row as Dictionary)["claimantCount"])
	var consequences: PackedStringArray = []
	if region_count > 0:
		consequences.append("%s owned region(s) become unowned" % WorkshopUI.format_count(region_count))
	if claim_count > 0:
		consequences.append("%s territorial claim(s) are removed" % WorkshopUI.format_count(claim_count))
	var text := "Delete %s selected countries?" % WorkshopUI.format_count(targets.size())
	if not consequences.is_empty():
		text += "\n\n%s." % " and ".join(consequences)
	text += "\n\nTheir country records, colours, flags and tags will also be deleted."
	if not await host.confirm(text):
		return
	await host.request("workshop.polity.remove", {"keys": keys})
	if keys.has(_selected_key):
		_selected_key = ""
	_bulk = {}
	await _reload()


func _select_territory(key: String) -> void:
	var reply := await host.request_raw("workshop.selectOwner", {"key": key})
	if not reply.get("ok", false):
		return
	var result: Dictionary = reply["result"]
	host.set_selection(result.get("ids", []))
	var bounds: Variant = result.get("bounds")
	if bounds is Array:
		host.map.fit_bounds(bounds, 7.0, 0.3)


func _label(text: String) -> Label:
	return UI.label(text, 11, Color(1, 1, 1, 0.48))


func _render_detail() -> void:
	WorkshopUI.clear(_detail)
	if _selected_key.is_empty():
		return
	var key := _selected_key
	var counts := _counts(key)
	var region_count := int(counts.get("regionCount", 0))
	var claimant_count := int(counts.get("claimantCount", 0))
	var record := _record(key)
	_detail.add_child(WorkshopUI.rule())
	var name_box := VBoxContainer.new()
	name_box.add_theme_constant_override("separation", 4)
	name_box.add_child(_label("Name"))
	var name_row := HBoxContainer.new()
	name_row.add_theme_constant_override("separation", 6)
	if _draft_name.is_empty():
		_draft_name = _name_of(key)
	var rename_button := WorkshopUI.pill("Rename")
	rename_button.tooltip_text = "Renames the country everywhere on this map: its regions, claims, colour, flag, tags, map features, units and puppet ties. The old name is not kept."
	var name_edit := WorkshopUI.input(_draft_name, "", func(text: String) -> void:
		_draft_name = text
		rename_button.disabled = text.strip_edges().is_empty() or text.strip_edges() == key, 13.6, 34.0)
	name_row.add_child(name_edit)
	rename_button.disabled = _draft_name.strip_edges().is_empty() or _draft_name.strip_edges() == key
	rename_button.pressed.connect(func() -> void:
		var next := _draft_name.strip_edges()
		var reply := await host.request("workshop.polity.rename", {"key": key, "name": next})
		if reply.has("refused"):
			await host.alert(str(reply["refused"]))
			return
		if not bool(reply.get("renamed", false)):
			return
		if _bulk.has(key):
			_bulk.erase(key)
			_bulk[next] = true
		if host.paint_owner == key:
			host.paint_owner = next
		if host.paint_only == key:
			host.paint_only = next
		_selected_key = next
		_draft_name = next
		await _reload())
	name_row.add_child(rename_button)
	name_box.add_child(name_row)
	var former: Variant = record.get("formerNames")
	if former is Array and not (former as Array).is_empty():
		var names: PackedStringArray = []
		for value in former:
			names.append(str(value))
		name_box.add_child(UI.label("Formerly " + ", ".join(names), 11, Color(1, 1, 1, 0.45)))
	_detail.add_child(name_box)
	var actions := HFlowContainer.new()
	actions.add_theme_constant_override("h_separation", 6)
	actions.add_theme_constant_override("v_separation", 6)
	var territory := WorkshopUI.pill("Select territory (%d)" % region_count)
	territory.pressed.connect(func() -> void: _select_territory(key))
	actions.add_child(territory)
	var assign := WorkshopUI.pill("Assign selected (%d)" % host.selection.size())
	assign.disabled = host.selection.is_empty()
	assign.pressed.connect(func() -> void: host.request("workshop.attrs", {"ids": host.selection, "patch": {"owner": key}}))
	actions.add_child(assign)
	var paint := WorkshopUI.pill("Paint this polity", true)
	paint.tooltip_text = "Close this panel and start drag-painting this polity across regions"
	paint.pressed.connect(func() -> void:
		host.paint_owner = key
		host.paint_only = "*"
		host.set_tool("paint")
		host.close_panel())
	actions.add_child(paint)
	_detail.add_child(actions)
	var regions_frame := PanelContainer.new()
	regions_frame.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0), Color(1, 1, 1, 0.1), 8, 1, Vector4(9, 6, 9, 6)))
	var regions_column := VBoxContainer.new()
	regions_column.add_theme_constant_override("separation", 6)
	var summary := "Regions (%d)" % _owned.size()
	if claimant_count > 0:
		summary += " · %d claimed" % claimant_count
	var regions_toggle := WorkshopUI.base_button(("▾ " if _regions_open else "▸ ") + summary)
	regions_toggle.alignment = HORIZONTAL_ALIGNMENT_LEFT
	var empty := StyleBoxEmpty.new()
	for state_name in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
		regions_toggle.add_theme_stylebox_override(state_name, empty)
	WorkshopUI._ink(regions_toggle, Color(1, 1, 1), 11.5, 700)
	regions_toggle.pressed.connect(func() -> void:
		_regions_open = not _regions_open
		_render_detail()
		fit())
	regions_column.add_child(regions_toggle)
	if _regions_open and not _owned.is_empty():
		var scroll := ScrollContainer.new()
		scroll.custom_minimum_size.y = mini(200, _owned.size() * 26)
		scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
		var list := VBoxContainer.new()
		list.add_theme_constant_override("separation", 3)
		list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		for region in _owned:
			var entry: Dictionary = region
			var region_id := str(entry.get("id", ""))
			var button := WorkshopUI.base_button(str(entry.get("name", "")) if not str(entry.get("name", "")).is_empty() else region_id)
			button.alignment = HORIZONTAL_ALIGNMENT_LEFT
			var flat := UI.box(Color(1, 1, 1, 0.03), Color(1, 1, 1, 0.08), 6, 1, Vector4(7, 4, 7, 4))
			WorkshopUI._flat_styles(button, flat, UI.box(Color(1, 1, 1, 0.07), Color(1, 1, 1, 0.14), 6, 1, Vector4(7, 4, 7, 4)), flat, flat)
			WorkshopUI._ink(button, Color(1, 1, 1), 11.5, 400)
			button.tooltip_text = "Select this region and zoom to it"
			button.pressed.connect(func() -> void:
				host.set_selection([region_id])
				host.zoom_to([region_id]))
			list.add_child(button)
		scroll.add_child(list)
		regions_column.add_child(scroll)
	regions_frame.add_child(regions_column)
	_detail.add_child(regions_frame)
	var transfer := VBoxContainer.new()
	transfer.add_theme_constant_override("separation", 4)
	transfer.add_child(_label("Transfer all territory from another polity"))
	var transfer_row := HBoxContainer.new()
	transfer_row.add_theme_constant_override("separation", 6)
	var from_options: Array = [["", "Choose polity…"]]
	for row in _usage:
		var entry: Dictionary = row
		if str(entry["key"]) == key or int(entry.get("regionCount", 0)) <= 0:
			continue
		from_options.append([str(entry["key"]), "%s (%d)" % [_name_of(str(entry["key"])), int(entry["regionCount"])]])
	var transfer_button := WorkshopUI.pill("Transfer")
	transfer_button.disabled = _transfer_from.is_empty()
	transfer_row.add_child(WorkshopUI.select(from_options, _transfer_from, func(value: String) -> void:
		_transfer_from = value
		transfer_button.disabled = value.is_empty(), 13.0, 34.0))
	transfer_button.pressed.connect(func() -> void:
		if _transfer_from.is_empty() or _transfer_from == key:
			return
		var from := _transfer_from
		_transfer_from = ""
		await host.request("workshop.polity.transfer", {"from": from, "to": key}))
	transfer_row.add_child(transfer_button)
	transfer.add_child(transfer_row)
	_detail.add_child(transfer)
	var doc: Dictionary = host.state.get("doc", {})
	var colors: Dictionary = doc.get("colors", {})
	var color_row := HBoxContainer.new()
	color_row.add_theme_constant_override("separation", 8)
	var color_caption := UI.label("Colour", 11, Color(1, 1, 1, 0.58))
	color_caption.custom_minimum_size.x = 52
	color_row.add_child(color_caption)
	color_row.add_child(WorkshopUI.color_field(colors.get(key, [128, 128, 128]), func(rgb: Array) -> void: host.request("workshop.polity.color", {"key": key, "rgb": rgb})))
	_detail.add_child(color_row)
	var flag_row := HBoxContainer.new()
	flag_row.add_theme_constant_override("separation", 8)
	var flag_caption := UI.label("Flag", 11, Color(1, 1, 1, 0.58))
	flag_caption.custom_minimum_size.x = 52
	flag_row.add_child(flag_caption)
	var flags: Dictionary = doc.get("flags", {})
	var flag_files: Dictionary = doc.get("flagFiles", {})
	if flags.has(key):
		var texture := WorkshopUI.flag_texture(str(flags[key]), str(flag_files.get(key, "")), 36)
		if texture:
			var image := TextureRect.new()
			image.texture = texture
			image.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
			image.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
			image.custom_minimum_size = Vector2(28, 18)
			flag_row.add_child(image)
	var flag_button := WorkshopUI.pill("Change" if flags.has(key) else "Choose flag")
	flag_button.pressed.connect(func() -> void: host.open_flag_picker(key))
	flag_row.add_child(flag_button)
	_detail.add_child(flag_row)
	var tags_box := VBoxContainer.new()
	tags_box.add_theme_constant_override("separation", 4)
	tags_box.add_child(_label("Tags"))
	var tags: Dictionary = doc.get("tags", {})
	var tag_field := WorkshopTags.new(tags.get(key, []) if tags.get(key) is Array else [], [])
	tag_field.tags_changed.connect(func(values: Array) -> void: host.request("workshop.polity.tags", {"key": key, "tags": values}))
	tags_box.add_child(tag_field)
	_detail.add_child(tags_box)
	_fill_tag_suggestions(tag_field)
	var puppets := VBoxContainer.new()
	puppets.add_theme_constant_override("separation", 6)
	_detail.add_child(puppets)
	_render_puppets(puppets, key, region_count)
	if not record.is_empty():
		var notes := VBoxContainer.new()
		notes.add_theme_constant_override("separation", 4)
		notes.add_child(_label("Scenario note"))
		notes.add_child(WorkshopUI.area(str(record.get("note", "")), 2, "", func(text: String) -> void: host.request("workshop.polity.upsert", {"key": key, "patch": {"note": text}})))
		var gap := Control.new()
		gap.custom_minimum_size.y = 4
		notes.add_child(gap)
		notes.add_child(_label("Population when the scenario begins"))
		var population := WorkshopUI.input("", "Leave empty and the game works it out", Callable(), 13.6, 34.0)
		notes.add_child(population)
		_format_population(population, record.get("population"))
		population.focus_exited.connect(func() -> void:
			var reply := await host.request_raw("workshop.population.format", {"text": population.text})
			if reply.get("ok", false):
				population.text = str((reply["result"] as Dictionary).get("text", ""))
			host.request("workshop.polity.upsert", {"key": key, "patch": {"populationText": population.text}}))
		notes.add_child(WorkshopUI.small_label("Its troops are raised from these people, and its statistics begin from this figure. You can write 12,500,000 or 12.5 million.", 0.42))
		var military := WorkshopMilitary.new()
		notes.add_child(military)
		military.military_changed.connect(func(value: Variant) -> void: host.request("workshop.polity.upsert", {"key": key, "patch": {"military": value}}))
		military.setup(host, "polity", key, record.get("military"))
		_detail.add_child(notes)
	var remove := WorkshopUI.pill("Remove from the map", false, Color("#f87171"))
	remove.tooltip_text = "Make its regions unowned, drop the claims in its name, and remove the polity with its colour, flag and tags"
	remove.pressed.connect(func() -> void:
		var parts: PackedStringArray = []
		if region_count > 0:
			parts.append("%d region(s) become unowned" % region_count)
		if claimant_count > 0:
			parts.append("%d claim(s) are dropped" % claimant_count)
		var summary_text := " and ".join(parts)
		var question := "Remove “%s” from the map?%s its colour, flag and tags go with it." % [_name_of(key), (" %s;" % summary_text) if not summary_text.is_empty() else ""]
		if not await host.confirm(question):
			return
		await host.request("workshop.polity.remove", {"keys": [key]})
		_bulk.erase(key)
		_selected_key = ""
		await _reload())
	_detail.add_child(remove)


func _format_population(edit: LineEdit, value: Variant) -> void:
	if value == null:
		return
	var reply := await host.request_raw("workshop.population.format", {"value": value})
	if reply.get("ok", false) and is_instance_valid(edit):
		edit.text = str((reply["result"] as Dictionary).get("text", ""))


func _fill_tag_suggestions(field: WorkshopTags) -> void:
	var reply := await host.request_raw("workshop.summaries", {"ids": []})
	if reply.get("ok", false) and is_instance_valid(field):
		field.suggestions = (reply["result"] as Dictionary).get("tagSuggestions", [])


func _render_puppets(box: VBoxContainer, key: String, region_count: int) -> void:
	var reply := await host.request_raw("workshop.puppets.view", {"polity": key})
	if not reply.get("ok", false) or not is_instance_valid(box):
		return
	var view: Dictionary = reply["result"]
	WorkshopUI.clear(box)
	var own: Variant = view.get("own")
	var held: Array = view.get("held", [])
	var options: Array = view.get("options", [])
	box.add_child(_label("Puppet of"))
	var choices: Array = [["", "— independent —"]]
	var seen := {}
	if own is Dictionary and not str((own as Dictionary).get("overlord", "")).is_empty():
		var overlord := str((own as Dictionary)["overlord"])
		choices.append([overlord, _name_of(overlord)])
		seen[overlord] = true
	for option in options:
		if seen.has(str(option)):
			continue
		choices.append([str(option), _name_of(str(option))])
	var current := str((own as Dictionary).get("overlord", "")) if own is Dictionary else ""
	var select := WorkshopUI.select(choices, current, func(value: String) -> void:
		var result := await host.request("workshop.puppets.overlord", {"polity": key, "overlord": value})
		var error := str(result.get("error", ""))
		await _render_puppets(box, key, region_count)
		if not error.is_empty():
			box.add_child(UI.label(error, 11, Color("#fca5a5"))), 13.0, 34.0)
	if not (own is Dictionary) and options.is_empty():
		select.disabled = true
	box.add_child(select)
	if not held.is_empty() and not (own is Dictionary):
		box.add_child(WorkshopUI.small_label("It holds puppets of its own, so it cannot be one.", 0.45))
	if own is Dictionary:
		var row: Dictionary = own
		var grid := GridContainer.new()
		grid.columns = 2
		grid.add_theme_constant_override("h_separation", 6)
		var kinds: Array = []
		for entry in view.get("kinds", []):
			kinds.append([str((entry as Dictionary)["id"]), str((entry as Dictionary)["label"])])
		grid.add_child(WorkshopUI.select(kinds, str(row.get("kind", "satellite")), func(value: String) -> void: _patch_puppet(box, key, region_count, {"kind": value}), 13.0, 34.0))
		var secrecy: Array = []
		for entry in view.get("secrecy", []):
			secrecy.append([str((entry as Dictionary)["id"]), str((entry as Dictionary)["label"])])
		grid.add_child(WorkshopUI.select(secrecy, "covert" if str(row.get("secrecy", "")) == "covert" else "open", func(value: String) -> void: _patch_puppet(box, key, region_count, {"secrecy": value}), 13.0, 34.0))
		box.add_child(grid)
		var loyalty_row := HBoxContainer.new()
		loyalty_row.add_theme_constant_override("separation", 6)
		loyalty_row.add_child(UI.label("Loyalty", 11, Color(1, 1, 1, 0.45)))
		var loyalty_value := float(row.get("loyalty", 50)) if row.get("loyalty") != null else 50.0
		var slider := HSlider.new()
		slider.min_value = 0
		slider.max_value = 100
		slider.step = 1
		slider.value = loyalty_value
		slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		slider.focus_mode = Control.FOCUS_NONE
		var number := UI.label(str(int(loyalty_value)), 11, Color(1, 1, 1, 0.45))
		number.custom_minimum_size.x = 26
		number.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		slider.value_changed.connect(func(value: float) -> void: number.text = str(int(value)))
		slider.drag_ended.connect(func(_changed: bool) -> void: _patch_puppet(box, key, region_count, {"loyalty": int(slider.value)}))
		loyalty_row.add_child(slider)
		loyalty_row.add_child(number)
		box.add_child(loyalty_row)
		if loyalty_value < float(view.get("coupLoyalty", 30)):
			box.add_child(UI.label("This low, the puppet starts the game plotting against its overlord.", 11, Color("#fbbf24")))
		if str(row.get("secrecy", "")) == "covert":
			box.add_child(WorkshopUI.small_label("Covert: only the two of them know, until someone's spies find out.", 0.45))
		if region_count == 0:
			box.add_child(WorkshopUI.small_label("It holds no land yet: paint it some territory.", 0.45))
	if not held.is_empty():
		var kind_labels := {}
		for entry in view.get("kinds", []):
			kind_labels[str((entry as Dictionary)["id"])] = str((entry as Dictionary)["label"]).to_lower()
		var names: PackedStringArray = []
		for entry in held:
			var row: Dictionary = entry
			names.append("%s (%s)" % [_name_of(str(row.get("puppet", ""))), str(kind_labels.get(str(row.get("kind", "")), "puppet state"))])
		box.add_child(WorkshopUI.small_label("Its puppets: " + ", ".join(names), 0.45))
	fit()


func _patch_puppet(box: VBoxContainer, key: String, region_count: int, patch: Dictionary) -> void:
	await host.request("workshop.puppets.patch", {"polity": key, "patch": patch})
	await _render_puppets(box, key, region_count)


func _render_roster() -> void:
	WorkshopUI.clear(_roster_box)
	_roster_box.add_child(WorkshopUI.rule())
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 7)
	var title := UI.label("Bulk polity roster", 12, Color(1, 1, 1), 700)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(title)
	var fill := WorkshopUI.pill("Fill standard flags")
	fill.tooltip_text = "Fill only missing scenario flags from Open Historia's built-in standard country flag catalog"
	fill.pressed.connect(_fill_standard_flags)
	head.add_child(fill)
	var import_button := WorkshopUI.pill("Import roster JSON…", true)
	import_button.pressed.connect(_read_roster)
	head.add_child(import_button)
	_roster_box.add_child(head)
	if _roster_preview is Dictionary:
		var preview: Dictionary = _roster_preview
		var parts := WorkshopUI.card(8, Color(1, 1, 1, 0.1), Color(1, 1, 1, 0.1), Vector4(9, 8, 9, 8), 6)
		var inner: VBoxContainer = parts[1]
		inner.add_child(UI.label(str(preview.get("fileName", "")), 11.5, Color(1, 1, 1), 700))
		var rows: Array = preview.get("rows", [])
		var text := "%s unique polity keys · %s new · %s already present" % [WorkshopUI.format_count(rows.size()), WorkshopUI.format_count(int(preview.get("fresh", 0))), WorkshopUI.format_count(int(preview.get("existing", 0)))]
		if int(preview.get("incomingColors", 0)) > 0:
			text += " · %s colours" % WorkshopUI.format_count(int(preview["incomingColors"]))
		if int(preview.get("incomingTags", 0)) > 0:
			text += " · %s tag sets" % WorkshopUI.format_count(int(preview["incomingTags"]))
		if int(preview.get("incomingFlags", 0)) > 0:
			text += " · %s flags" % WorkshopUI.format_count(int(preview["incomingFlags"]))
		if int(preview.get("duplicates", 0)) > 0:
			text += " · %s duplicate rows ignored" % WorkshopUI.format_count(int(preview["duplicates"]))
		if int(preview.get("invalid", 0)) > 0:
			text += " · %s invalid rows ignored" % WorkshopUI.format_count(int(preview["invalid"]))
		inner.add_child(WorkshopUI.wrap(text, 11, Color(1, 1, 1, 0.62)))
		var buttons := HBoxContainer.new()
		buttons.add_theme_constant_override("separation", 6)
		var apply := WorkshopUI.pill("Import / merge %s" % WorkshopUI.format_count(rows.size()), true)
		apply.pressed.connect(_apply_roster)
		buttons.add_child(apply)
		var cancel := WorkshopUI.pill("Cancel")
		cancel.pressed.connect(func() -> void:
			_roster_preview = null
			_render_roster()
			fit())
		buttons.add_child(cancel)
		inner.add_child(buttons)
		_roster_box.add_child(parts[0])
	if not _roster_message.is_empty():
		var good := _roster_message.begins_with("Imported ") or _roster_message.begins_with("Added ") or _roster_message.begins_with("Every ")
		_roster_box.add_child(WorkshopUI.wrap(_roster_message, 11, Color("#86efac") if good else Color("#fca5a5")))


func _read_roster() -> void:
	_roster_message = ""
	_roster_preview = null
	var file := await EditorKit.pick_file(self, false, "", PackedStringArray(["*.json ; JSON"]))
	if file.is_empty():
		return
	var reply := await host.request_raw("workshop.roster.read", {"path": file})
	if not reply.get("ok", false):
		_roster_message = str(reply.get("error", ""))
	else:
		var result: Dictionary = reply["result"]
		if result.has("message"):
			_roster_message = str(result["message"])
		else:
			_roster_preview = result.get("preview")
	_render_roster()
	fit()


func _apply_roster() -> void:
	if not (_roster_preview is Dictionary):
		return
	var rows: Array = (_roster_preview as Dictionary).get("rows", [])
	if rows.is_empty():
		return
	if not await host.confirm("Import / merge %s polity records?\n\nStable keys already present will be updated in place. Territory ownership is NOT changed." % WorkshopUI.format_count(rows.size())):
		return
	var result := await host.request("workshop.roster.apply", {"rows": rows})
	var summary: Dictionary = result.get("summary", {})
	if int(summary.get("count", 0)) <= 0:
		_roster_message = "The roster contained no usable polity records."
	else:
		_selected_key = str(summary.get("firstKey", ""))
		var message := "Imported %s polities: %s new, %s updated" % [WorkshopUI.format_count(int(summary["count"])), WorkshopUI.format_count(int(summary.get("created", 0))), WorkshopUI.format_count(int(summary.get("updated", 0)))]
		if int(summary.get("colors", 0)) > 0:
			message += " · %s colours" % WorkshopUI.format_count(int(summary["colors"]))
		if int(summary.get("tags", 0)) > 0:
			message += " · %s tag sets" % WorkshopUI.format_count(int(summary["tags"]))
		if int(summary.get("flags", 0)) > 0:
			message += " · %s flags" % WorkshopUI.format_count(int(summary["flags"]))
		_roster_message = message + "."
		_roster_preview = null
	await _reload()


func _fill_standard_flags() -> void:
	var reply := await host.request_raw("workshop.flags.fillPlan")
	if not reply.get("ok", false):
		return
	var plan: Dictionary = reply["result"]
	var rows: Array = plan.get("importRows", [])
	var unresolved := int(plan.get("unresolved", 0))
	var already := int(plan.get("alreadyFlagged", 0))
	if rows.is_empty():
		_roster_message = ("No missing standard flags could be resolved; %s polities remain without a safe built-in match." % WorkshopUI.format_count(unresolved)) if unresolved > 0 else "Every current polity already has a scenario flag."
		_render_roster()
		fit()
		return
	if not await host.confirm("Store %s built-in standard flags in this scenario?\n\nOnly polities that currently have NO scenario flag are included. Existing custom/historical flags will not be overwritten." % WorkshopUI.format_count(rows.size())):
		return
	var result := await host.request("workshop.roster.apply", {"rows": rows})
	var summary: Dictionary = result.get("summary", {})
	var count := int(summary.get("flags", rows.size())) if int(summary.get("flags", 0)) > 0 else rows.size()
	var message := "Added %s standard flags to the scenario" % WorkshopUI.format_count(count)
	if already > 0:
		message += " · %s existing flags preserved" % WorkshopUI.format_count(already)
	if unresolved > 0:
		message += " · %s unresolved/ambiguous polities skipped" % WorkshopUI.format_count(unresolved)
	_roster_message = message + "."
	await _reload()


func _render_create() -> void:
	WorkshopUI.clear(_create_box)
	_create_box.add_child(WorkshopUI.rule())
	_create_box.add_child(UI.label("Create country", 12, Color(1, 1, 1), 700))
	var count := host.selection.size()
	var create := WorkshopUI.pill(("Create country + assign %d selected regions" % count) if count > 0 else "Create country (no regions yet)")
	create.disabled = _new_name.strip_edges().is_empty()
	var name_edit := WorkshopUI.input(_new_name, "Name, e.g. Austria-Hungary", func(text: String) -> void:
		_new_name = text
		create.disabled = text.strip_edges().is_empty(), 13.6, 34.0)
	_create_box.add_child(name_edit)
	create.pressed.connect(func() -> void:
		var name := _new_name.strip_edges()
		if name.is_empty():
			return
		var reply := await host.request("workshop.polity.create", {"name": name, "assign": host.selection})
		if reply.has("refused"):
			await host.alert(str(reply["refused"]))
			return
		_selected_key = name
		_draft_name = name
		_new_name = ""
		await _reload())
	_create_box.add_child(create)
