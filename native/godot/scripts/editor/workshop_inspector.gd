class_name WorkshopInspector
extends WorkshopShell

var host: Workshop
var _summaries: Array = []
var _polity_options: Array = []
var _tag_suggestions: Array = []
var _form := {}
var _owner_draft: Variant = null
var _pending := false
var _owner_edit: LineEdit
var _owner_extra: VBoxContainer
var _owner_hints: VBoxContainer
var _loading := false


func _init() -> void:
	super._init("Region", "modify", 320.0, "right")


func setup(workshop: Workshop) -> void:
	host = workshop
	closed.connect(func() -> void: host.set_selection([]))
	host.changed.connect(_on_changed)


func refresh_selection() -> void:
	if host.selection.is_empty():
		visible = false
		return
	visible = true
	await _load()


func _on_changed(parts: Dictionary) -> void:
	if not visible or host.selection.is_empty():
		return
	if parts.has("selection"):
		return
	if parts.has("regions") or parts.has("doc") or parts.has("war"):
		if typing_inside():
			_pending = true
			return
		await _load()


func _process(_delta: float) -> void:
	if _pending and not typing_inside():
		_pending = false
		_load()


func _common(values: Array) -> String:
	if values.is_empty():
		return ""
	var first := str(values[0])
	for value in values:
		if str(value) != first:
			return ""
	return first


func _load() -> void:
	if _loading:
		_pending = true
		return
	_loading = true
	var reply := await host.request_raw("workshop.summaries", {"ids": host.selection})
	_loading = false
	if not reply.get("ok", false):
		return
	var result: Dictionary = reply["result"]
	_summaries = result.get("summaries", [])
	_polity_options = result.get("polityOptions", [])
	_tag_suggestions = result.get("tagSuggestions", [])
	var names: Array = []
	var types: Array = []
	var owners: Array = []
	var groups: Array = []
	var lists: Array = []
	for summary in _summaries:
		var row: Dictionary = summary
		names.append(str(row.get("name", "")))
		types.append(str(row.get("typeId", "land")))
		owners.append(str(row.get("owner", "")) if row.get("owner") != null else "")
		groups.append(str(row.get("group", "")) if row.get("group") != null else "")
		lists.append(row.get("claimants", []) if row.get("claimants") is Array else [])
	var claimants := _common_claimants(lists)
	_form = {
		"name": names[0] if _summaries.size() == 1 else "",
		"typeId": _common(types),
		"owner": _common(owners),
		"claimants": claimants["shown"],
		"claimantsMixed": claimants["mixed"],
		"group": _common(groups),
	}
	_owner_draft = null
	_render()


func _common_claimants(lists: Array) -> Dictionary:
	if lists.is_empty():
		return {"shown": [], "mixed": false}
	var first := JSON.stringify(lists[0])
	var mixed := false
	for row in lists:
		if JSON.stringify(row) != first:
			mixed = true
	if not mixed:
		return {"shown": (lists[0] as Array).duplicate(), "mixed": false}
	var shown: Array = []
	for key in lists[0]:
		if shown.has(key):
			continue
		var everywhere := true
		for row in lists:
			if not (row as Array).has(key):
				everywhere = false
		if everywhere:
			shown.append(key)
	return {"shown": shown, "mixed": true}


func _type_is_water(type_row: Dictionary) -> bool:
	if type_row.get("water") is bool:
		return bool(type_row["water"])
	var regex := RegEx.create_from_string("(?i)(?:^|[^\\p{L}])(?:oceans?|seas?|waters?|lakes?)(?:$|[^\\p{L}])")
	return regex.search(str(type_row.get("name", ""))) != null


func _field(text: String, control: Control, tooltip := "") -> VBoxContainer:
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 4)
	column.tooltip_text = tooltip
	column.add_child(UI.label(text, 12, Color(1, 1, 1, 0.72)))
	column.add_child(control)
	return column


func _apply_attrs(patch: Dictionary) -> void:
	await host.request("workshop.attrs", {"ids": host.selection, "patch": patch})


func _render() -> void:
	clear_body()
	var single := host.selection.size() == 1
	title_label.text = "Region" if single else "%d regions" % host.selection.size()
	var doc: Dictionary = host.state.get("doc", {})
	var types: Array = doc.get("types", [])
	var region := section("Region")
	if single:
		var name_edit := WorkshopUI.input(str(_form.get("name", "")), "", func(text: String) -> void:
			_form["name"] = text
			_apply_attrs({"name": text}), 12.5, 30.0)
		region.add_child(_field("Name", name_edit))
	var type_options: Array = []
	if str(_form.get("typeId", "")).is_empty():
		type_options.append(["", "— mixed —"])
	for entry in types:
		var type_row: Dictionary = entry
		type_options.append([str(type_row.get("id", "")), str(type_row.get("name", ""))])
	var type_select := WorkshopUI.select(type_options, str(_form.get("typeId", "")), func(value: String) -> void:
		if value.is_empty():
			return
		_form["typeId"] = value
		_apply_attrs({"typeId": value}), 12.5, 30.0)
	region.add_child(_field("Type", type_select))
	var by_id := {}
	for entry in types:
		by_id[str((entry as Dictionary).get("id", ""))] = entry
	var all_water := not _summaries.is_empty()
	for summary in _summaries:
		var type_id := str((summary as Dictionary).get("typeId", "land"))
		if not by_id.has(type_id) or not _type_is_water(by_id[type_id]):
			all_water = false
	if all_water:
		var war: Dictionary = host.state.get("war", {})
		var freezing: Array = war.get("freezingRegions", [])
		var all_freeze := true
		for summary in _summaries:
			if not freezing.has(str((summary as Dictionary).get("id", ""))):
				all_freeze = false
		var ids: Array = []
		for summary in _summaries:
			ids.append(str((summary as Dictionary).get("id", "")))
		var freeze_row := WorkshopUI.row("Can freeze", WorkshopUI.toggle(all_freeze, func(on: bool) -> void: host.request("workshop.freezing", {"ids": ids, "on": on})), "Ices over in a season of its climate zone whose effects say Water freezes (the War map panel's Climate tab).")
		region.add_child(freeze_row)
	var polity := section("Polity")
	var owner := str(_form.get("owner", ""))
	var owner_line := HBoxContainer.new()
	owner_line.add_theme_constant_override("separation", 6)
	if not owner.is_empty():
		owner_line.add_child(WorkshopUI.swatch(host.polity_color(owner), 18.0, 4))
	_owner_edit = WorkshopUI.input(_owner_shown(), "mixed / unowned" if host.selection.size() > 1 and owner.is_empty() else "Unowned — type a polity", Callable(), 12.5, 30.0)
	_owner_edit.text_changed.connect(func(text: String) -> void:
		_owner_draft = text
		_render_owner_extra())
	_owner_edit.text_submitted.connect(func(_text: String) -> void: _commit_owner())
	_owner_edit.focus_exited.connect(_settle_owner)
	owner_line.add_child(_owner_edit)
	var polities_button := WorkshopUI.pill("Polities…")
	polities_button.tooltip_text = "Create, rename and manage polities"
	polities_button.pressed.connect(func() -> void: host.open_panel_named("polities"))
	owner_line.add_child(polities_button)
	var owner_field := _field("Polity", owner_line, "The polity that owns these regions. Type an existing polity's name, or a name that does not exist yet and press Enter to create it — a country that has never existed is one keystroke away. Rename and manage polities in the Polities panel; changing a display name there keeps all territory attached.")
	_owner_hints = VBoxContainer.new()
	_owner_hints.add_theme_constant_override("separation", 2)
	owner_field.add_child(_owner_hints)
	_owner_extra = VBoxContainer.new()
	_owner_extra.add_theme_constant_override("separation", 6)
	owner_field.add_child(_owner_extra)
	polity.add_child(owner_field)
	_render_owner_extra()
	if not owner.is_empty():
		var pair := GridContainer.new()
		pair.columns = 2
		pair.add_theme_constant_override("h_separation", 10)
		var color_row := HBoxContainer.new()
		color_row.add_theme_constant_override("separation", 6)
		var colors: Dictionary = doc.get("colors", {})
		var overrides: Dictionary = doc.get("colorOverrides", {})
		var picker := WorkshopUI.color_field(colors.get(owner, [128, 128, 128]), func(rgb: Array) -> void: host.request("workshop.polity.color", {"key": owner, "rgb": rgb}))
		color_row.add_child(picker)
		if overrides.has(owner):
			var reset := WorkshopUI.pill("Reset")
			reset.tooltip_text = "Go back to this country's standard colour"
			reset.pressed.connect(func() -> void: host.request("workshop.polity.color", {"key": owner, "rgb": null}))
			color_row.add_child(reset)
		pair.add_child(_field("Colour", color_row, "The colour this country is painted, here and in the game"))
		var flag_row := HBoxContainer.new()
		flag_row.add_theme_constant_override("separation", 6)
		var flags: Dictionary = doc.get("flags", {})
		var flag_files: Dictionary = doc.get("flagFiles", {})
		if flags.has(owner):
			var texture := WorkshopUI.flag_texture(str(flags[owner]), str(flag_files.get(owner, "")), 36)
			if texture:
				var image := TextureRect.new()
				image.texture = texture
				image.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
				image.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
				image.custom_minimum_size = Vector2(26, 18)
				flag_row.add_child(image)
		var flag_button := WorkshopUI.pill("Change" if flags.has(owner) else "Choose flag")
		flag_button.pressed.connect(func() -> void: host.open_flag_picker(owner))
		flag_row.add_child(flag_button)
		pair.add_child(_field("Flag", flag_row, "Shown in the country panel and profile circles in-game"))
		polity.add_child(pair)
		var tags: Dictionary = doc.get("tags", {})
		var tag_field := WorkshopTags.new(tags.get(owner, []) if tags.get(owner) is Array else [], _tag_suggestions)
		tag_field.tags_changed.connect(func(values: Array) -> void: host.request("workshop.polity.tags", {"key": owner, "tags": values}))
		polity.add_child(_field("Tags", tag_field, "What this country IS — ideology, alignment, posture. Shown in the country panel, and given to the AI as context for everything this country does."))
		var polities: Dictionary = doc.get("polities", {})
		var record: Variant = polities.get(owner)
		var military := WorkshopMilitary.new()
		polity.add_child(military)
		military.military_changed.connect(func(value: Variant) -> void: host.request("workshop.polity.upsert", {"key": owner, "patch": {"military": value}}))
		military.setup(host, "inspector", owner, (record as Dictionary).get("military") if record is Dictionary else null)
	var claims := section("Claims")
	var claim_keys: Array = []
	for row in _polity_options:
		claim_keys.append(str((row as Dictionary).get("key", "")))
	var claim_field := WorkshopTags.new(_form.get("claimants", []), claim_keys)
	if bool(_form.get("claimantsMixed", false)):
		claim_field.set_placeholder("mixed — adds to every region…")
	claim_field.tags_changed.connect(func(values: Array) -> void:
		var next: Array = []
		for value in values:
			var text := str(value).strip_edges()
			if not text.is_empty():
				next.append(text)
		if bool(_form.get("claimantsMixed", false)):
			var shown: Array = _form.get("claimants", [])
			var add: Array = []
			for key in next:
				if not shown.has(key) and not add.has(key):
					add.append(key)
			var remove: Array = []
			for key in shown:
				if not next.has(key):
					remove.append(key)
			_form["claimants"] = next
			_apply_attrs({"claimantsDelta": {"add": add, "remove": remove}})
		else:
			_form["claimants"] = next
			_apply_attrs({"claimants": next}))
	claims.add_child(_field("Disputed by", claim_field, "Countries that claim this region. With any claimant set, the region renders STRIPED — the current owner's colour plus each claimant's — here and in the game."))
	var group_line := HBoxContainer.new()
	group_line.add_theme_constant_override("separation", 6)
	var groups: Dictionary = doc.get("groups", {})
	var group := str(_form.get("group", ""))
	if not group.is_empty() and groups.has(group):
		var group_color := str((groups[group] as Dictionary).get("color", "#e11d48"))
		group_line.add_child(WorkshopUI.swatch(Color(group_color) if Color.html_is_valid(group_color) else Color("#e11d48"), 14.0, 3))
	var group_names: Array = []
	for name in groups:
		group_names.append(str(name))
	if not group.is_empty() and not group_names.has(group):
		group_names.append(group)
	group_names.sort()
	var group_options: Array = [["", "— none / mixed —" if host.selection.size() > 1 and group.is_empty() else "— none —"]]
	for name in group_names:
		group_options.append([name, name])
	var group_select := WorkshopUI.select(group_options, group, func(value: String) -> void:
		_form["group"] = value
		_apply_attrs({"group": value if not value.is_empty() else null}), 12.5, 30.0)
	group_line.add_child(group_select)
	var groups_button := WorkshopUI.pill("Groups…")
	groups_button.tooltip_text = "Create, describe and colour groups"
	groups_button.pressed.connect(func() -> void: host.open_panel_named("groups"))
	group_line.add_child(groups_button)
	claims.add_child(_field("Controlled by group", group_line, "A group — a cartel, a militia, a zombie outbreak — that controls these regions without owning them. The game outlines the group's whole area and tints it in the group's colour; the AI is told what the group is. Create and describe groups in the Groups panel."))
	var actions := section("Actions")
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 6)
	grid.add_theme_constant_override("v_separation", 6)
	grid.add_child(_action("Clear country", "", "", func() -> void:
		_form["owner"] = ""
		_apply_attrs({"owner": null})))
	if host.selection.size() >= 2:
		grid.add_child(_action("Merge", "merge", "", func() -> void:
			var reply := await host.request("workshop.regions.merge", {"ids": host.selection})
			if reply.has("refused"):
				await host.alert(str(reply["refused"]))))
	grid.add_child(_action("Simplify", "modify", "Lighten these outlines to this map's own detail", func() -> void: host.request("workshop.regions.simplify", {"ids": host.selection})))
	grid.add_child(_action("Duplicate", "copy", "Duplicate the selection beside itself, on this map", func() -> void: host.request("workshop.regions.duplicate", {"ids": host.selection, "offset": host.map.meters_per_pixel() * 24.0})))
	grid.add_child(_action("Copy to clipboard", "copy", "Copy the selection to the region clipboard, to paste into another map (Ctrl+C)", func() -> void: host.request("workshop.clipboard.copy", {"ids": host.selection})))
	grid.add_child(_action("Zoom", "fit", "", func() -> void: host.zoom_to(host.selection)))
	actions.add_child(grid)
	var delete := _action("Delete", "trash", "", func() -> void:
		var ids := host.selection.duplicate()
		await host.request("workshop.regions.delete", {"ids": ids})
		host.set_selection([]))
	var danger := UI.box(Color(127 / 255.0, 29 / 255.0, 29 / 255.0, 0.34), Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.28), 9, 1, Vector4(9, 7, 9, 7))
	WorkshopUI._flat_styles(delete, danger, danger, danger, danger)
	WorkshopUI._ink(delete, Color("#fecaca"), 12.0, 600)
	delete.icon = WorkshopUI.icon("trash", 13, Color("#fecaca"))
	actions.add_child(delete)
	fit()


func _action(text: String, icon_name: String, tooltip: String, run: Callable) -> Button:
	var node := WorkshopUI.pill(text)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.custom_minimum_size.y = 30
	if not icon_name.is_empty():
		node.icon = WorkshopUI.icon(icon_name, 13)
	node.tooltip_text = tooltip
	node.pressed.connect(func() -> void: run.call())
	return node


func _owner_shown() -> String:
	if _owner_draft != null:
		return str(_owner_draft)
	var owner := str(_form.get("owner", ""))
	return host.polity_name(owner) if not owner.is_empty() else ""


func _resolve(text: String) -> Variant:
	var exact := text.strip_edges()
	var wanted := exact.to_lower()
	if wanted.is_empty():
		return ""
	for row in _polity_options:
		if str((row as Dictionary)["key"]) == exact:
			return exact
	for row in _polity_options:
		if str((row as Dictionary)["key"]).to_lower() == wanted:
			return str((row as Dictionary)["key"])
	for row in _polity_options:
		if str((row as Dictionary)["name"]).to_lower() == wanted:
			return str((row as Dictionary)["key"])
	return null


func _render_owner_extra() -> void:
	if not _owner_extra:
		return
	WorkshopUI.clear(_owner_extra)
	WorkshopUI.clear(_owner_hints)
	var owner := str(_form.get("owner", ""))
	var draft_text := _owner_shown().strip_edges()
	var resolved: Variant = owner if _owner_draft == null else _resolve(draft_text)
	if _owner_draft != null and draft_text.is_empty() and not owner.is_empty():
		var unown := WorkshopUI.pill("Make unowned")
		unown.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		unown.pressed.connect(func() -> void: _set_owner(""))
		_owner_extra.add_child(unown)
	if _owner_draft != null and resolved == null:
		var create := WorkshopUI.pill("Create “%s”" % draft_text, true)
		create.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		create.tooltip_text = "No polity has this name yet. Create it and give it these regions (Enter does the same)."
		create.pressed.connect(_commit_owner)
		_owner_extra.add_child(create)
	if _owner_draft != null and not draft_text.is_empty():
		var query := draft_text.to_lower()
		var shown := 0
		for row in _polity_options:
			var entry: Dictionary = row
			if not str(entry["name"]).to_lower().contains(query) or str(entry["name"]).to_lower() == query:
				continue
			var key := str(entry["key"])
			var hint := WorkshopUI.base_button(str(entry["name"]))
			hint.alignment = HORIZONTAL_ALIGNMENT_LEFT
			var flat := UI.box(Color(1, 1, 1, 0.03), Color(0, 0, 0, 0), 6, 0, Vector4(7, 3, 7, 3))
			WorkshopUI._flat_styles(hint, flat, UI.box(Color(1, 1, 1, 0.08), Color(0, 0, 0, 0), 6, 0, Vector4(7, 3, 7, 3)), flat, flat)
			WorkshopUI._ink(hint, Color(1, 1, 1, 0.85), 12.0, 500)
			hint.pressed.connect(func() -> void: _set_owner(key))
			_owner_hints.add_child(hint)
			shown += 1
			if shown >= 6:
				break


func _set_owner(key: String) -> void:
	_owner_draft = null
	if key == str(_form.get("owner", "")):
		_render_owner_extra()
		return
	_form["owner"] = key
	await _apply_attrs({"owner": key if not key.is_empty() else null})


func _commit_owner() -> void:
	if _owner_draft == null:
		return
	var draft_text := str(_owner_draft).strip_edges()
	var key: Variant = _resolve(draft_text)
	if key == null:
		_owner_draft = null
		_form["owner"] = draft_text
		await host.request("workshop.polity.createNamed", {"name": draft_text, "assign": host.selection})
		return
	await _set_owner(str(key))


func _settle_owner() -> void:
	if _owner_draft == null:
		return
	var key: Variant = _resolve(str(_owner_draft).strip_edges())
	if key == null:
		return
	await _set_owner(str(key))
