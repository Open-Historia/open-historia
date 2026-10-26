class_name WorkshopFeatures
extends WorkshopShell

const SYMBOLS := [["square", "Square"], ["circle", "Circle"], ["triangle", "Triangle"], ["star", "Star"]]

var host: Workshop
var _query := ""
var _expanded := ""
var _importing := false
var _note := ""
var _bulk_tag := ""
var _last_pick := ""
var _list: VBoxContainer
var _top: VBoxContainer
var _pending := false


func _init() -> void:
	super._init("Map features", "pin", 340.0, "left")


func setup(workshop: Workshop) -> void:
	host = workshop
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	row.add_child(WorkshopUI.icon_rect("search", 15, Color(1, 1, 1, 0.6)))
	row.add_child(WorkshopUI.input("", "Search name, tag, owner…", func(text: String) -> void:
		_query = text
		_render_list(), 13.6, 32.0))
	body.add_child(row)
	_top = VBoxContainer.new()
	_top.add_theme_constant_override("separation", 6)
	body.add_child(_top)
	_list = VBoxContainer.new()
	_list.add_theme_constant_override("separation", 3)
	body.add_child(_list)
	host.changed.connect(func(parts: Dictionary) -> void:
		if parts.has("features") or parts.has("featureSelection") or parts.has("doc"):
			if typing_inside():
				_pending = true
				return
			_render())
	_render()


func _process(_delta: float) -> void:
	if _pending and not typing_inside():
		_pending = false
		_render()


func _features() -> Array:
	return host.state.get("features", [])


func _filtered() -> Array:
	var query := _query.strip_edges().to_lower()
	var out: Array = []
	for row in _features():
		var entry: Dictionary = row
		if not query.is_empty():
			var tags: PackedStringArray = []
			for tag in entry.get("tags", []):
				tags.append(str(tag))
			var text := "%s %s %s %s %s" % [str(entry.get("name", "")), str(entry.get("type", "")), str(entry.get("owner", "")) if entry.get("owner") != null else "", str(entry.get("country", "")), " ".join(tags)]
			if not text.to_lower().contains(query):
				continue
		out.append(entry)
		if out.size() >= 300:
			break
	return out


func _render() -> void:
	_render_top()
	_render_list()
	clear_footer()
	var total := _features().size()
	var foot := HBoxContainer.new()
	foot.add_theme_constant_override("separation", 8)
	var count := UI.label("%d features total" % total, 12, Color(1, 1, 1, 0.5))
	count.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	foot.add_child(count)
	if total > 0:
		var delete_all := WorkshopUI.danger_pill("Delete All")
		delete_all.pressed.connect(func() -> void:
			var question := "Delete the one city or map feature on this map? Undo brings it back." if total == 1 else "Delete all %d cities and map features on this map? Undo brings them back." % total
			if not await host.confirm(question):
				return
			await host.request("workshop.feature.removeMany", {"all": true})
			host.set_feature_selection([]))
		foot.add_child(delete_all)
	footer.add_child(foot)
	fit()


func _render_top() -> void:
	WorkshopUI.clear(_top)
	var imports := HBoxContainer.new()
	imports.add_theme_constant_override("separation", 6)
	var major := WorkshopUI.pill("Importing…" if _importing else "Import major cities", true)
	major.icon = WorkshopUI.icon("plus", 14)
	major.tooltip_text = "Capitals and cities of 500,000 people or more"
	major.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	major.disabled = _importing
	major.pressed.connect(func() -> void: _import("major"))
	imports.add_child(major)
	var all := WorkshopUI.pill("All cities…")
	all.tooltip_text = "Every city and place in the world list, about 70,000 of them; asks first"
	all.disabled = _importing
	all.pressed.connect(func() -> void: _import("all"))
	imports.add_child(all)
	_top.add_child(imports)
	var from_file := WorkshopUI.pill("Import from file…")
	from_file.icon = WorkshopUI.icon("plus", 14)
	from_file.tooltip_text = "Your own features from a file: GeoJSON points, a Workshop document, or a JSON list of rows with lon/lat — each with a name and, optionally, a symbol, tags and a country"
	from_file.disabled = _importing
	from_file.pressed.connect(_import_file)
	_top.add_child(from_file)
	if not _note.is_empty():
		_top.add_child(WorkshopUI.wrap(_note, 11, Color("#f87171") if _note.begins_with("Import failed") else Color(1, 1, 1, 0.7)))
	var selected := host.feature_selection.size()
	var parts := WorkshopUI.card(8, Color(250 / 255.0, 204 / 255.0, 21 / 255.0, 0.06) if selected > 0 else Color(1, 1, 1, 0.03), Color(1, 1, 1, 0.1), Vector4(9, 8, 9, 8), 6)
	var inner: VBoxContainer = parts[1]
	var bar := HFlowContainer.new()
	bar.add_theme_constant_override("h_separation", 6)
	bar.add_theme_constant_override("v_separation", 6)
	var drag := WorkshopUI.pill("Drag-select is on: drag a box on the map" if host.tool == "feature-box" else "Drag-select on the map", host.tool == "feature-box")
	drag.tooltip_text = "Hold the mouse down on the map and drag a rectangle over features to select them all; shift-drag adds to the selection"
	drag.pressed.connect(func() -> void:
		host.set_tool("select" if host.tool == "feature-box" else "feature-box")
		_render_top())
	bar.add_child(drag)
	var shown := WorkshopUI.pill("Select shown")
	shown.tooltip_text = "Select every feature the search shows"
	shown.pressed.connect(func() -> void:
		var ids: Array = []
		for row in _filtered():
			ids.append(str((row as Dictionary).get("id", "")))
		host.set_feature_selection(ids))
	bar.add_child(shown)
	var clear := WorkshopUI.pill("Clear")
	clear.disabled = selected == 0
	if selected == 0:
		clear.modulate.a = 0.5
	clear.pressed.connect(func() -> void: host.set_feature_selection([]))
	bar.add_child(clear)
	inner.add_child(bar)
	if selected > 0:
		inner.add_child(UI.label("%d selected — tag them or delete them together." % selected, 11, Color(1, 1, 1, 0.6)))
		var tag_row := HFlowContainer.new()
		tag_row.add_theme_constant_override("h_separation", 6)
		tag_row.add_theme_constant_override("v_separation", 6)
		var add := WorkshopUI.pill("Add tag", true)
		var remove := WorkshopUI.pill("Remove tag")
		add.disabled = _bulk_tag.strip_edges().is_empty()
		remove.disabled = _bulk_tag.strip_edges().is_empty()
		var edit := WorkshopUI.input(_bulk_tag, "tag, e.g. fortress", func(text: String) -> void:
			_bulk_tag = text
			add.disabled = text.strip_edges().is_empty()
			remove.disabled = text.strip_edges().is_empty(), 12.0, 28.0)
		edit.custom_minimum_size.x = 120
		edit.text_submitted.connect(func(_text: String) -> void: host.request("workshop.feature.tagMany", {"ids": host.feature_selection, "tag": _bulk_tag, "add": true}))
		tag_row.add_child(edit)
		add.pressed.connect(func() -> void: host.request("workshop.feature.tagMany", {"ids": host.feature_selection, "tag": _bulk_tag, "add": true}))
		tag_row.add_child(add)
		remove.pressed.connect(func() -> void: host.request("workshop.feature.tagMany", {"ids": host.feature_selection, "tag": _bulk_tag, "add": false}))
		tag_row.add_child(remove)
		var delete := WorkshopUI.danger_pill("Delete %d" % selected)
		delete.pressed.connect(func() -> void:
			if not await host.confirm("Delete %d selected feature%s?" % [selected, "" if selected == 1 else "s"]):
				return
			await host.request("workshop.feature.removeMany", {"ids": host.feature_selection})
			host.set_feature_selection([]))
		tag_row.add_child(delete)
		inner.add_child(tag_row)
	_top.add_child(parts[0])


func _render_list() -> void:
	WorkshopUI.clear(_list)
	var rows := _filtered()
	_list.add_child(UI.label("%d%s shown" % [rows.size(), "+" if rows.size() >= 300 else ""], 11, Color(1, 1, 1, 0.5)))
	var selected := {}
	for id in host.feature_selection:
		selected[str(id)] = true
	for index in range(rows.size()):
		var entry: Dictionary = rows[index]
		var id := str(entry.get("id", ""))
		var is_selected := selected.has(id)
		var parts := WorkshopUI.card(8, Color(0, 0, 0, 0), Color(250 / 255.0, 204 / 255.0, 21 / 255.0, 0.6) if is_selected else Color(1, 1, 1, 0.09), Vector4(8, 6, 8, 6), 6)
		var inner: VBoxContainer = parts[1]
		var line := HBoxContainer.new()
		line.add_theme_constant_override("separation", 6)
		var check := CheckBox.new()
		check.button_pressed = is_selected
		check.focus_mode = Control.FOCUS_NONE
		check.tooltip_text = "Select %s" % str(entry.get("name", ""))
		var at := index
		check.gui_input.connect(func(event: InputEvent) -> void:
			if event is InputEventMouseButton and (event as InputEventMouseButton).pressed and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT:
				check.accept_event()
				_toggle(id, at, (event as InputEventMouseButton).shift_pressed, rows))
		line.add_child(check)
		var texts := VBoxContainer.new()
		texts.add_theme_constant_override("separation", 1)
		texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		texts.add_child(UI.label(str(entry.get("name", "")), 13, Color(1, 1, 1), 600))
		var tags: PackedStringArray = []
		for tag in entry.get("tags", []):
			tags.append(str(tag))
		var holder := str(entry.get("country", ""))
		if holder.is_empty() and entry.get("owner") != null:
			holder = host.polity_name(str(entry.get("owner", "")))
		var sub := UI.label("%s · %s · %s" % [str(entry.get("type", "Coordinate")), holder if not holder.is_empty() else "—", ", ".join(tags)], 11, Color(1, 1, 1, 0.5))
		sub.clip_text = true
		sub.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		texts.add_child(sub)
		var expand := WorkshopUI.base_button("")
		var clear_style := StyleBoxEmpty.new()
		for state_name in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
			expand.add_theme_stylebox_override(state_name, clear_style)
		expand.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		expand.add_child(texts)
		texts.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		texts.mouse_filter = Control.MOUSE_FILTER_IGNORE
		expand.custom_minimum_size.y = 34
		expand.pressed.connect(func() -> void:
			_expanded = "" if _expanded == id else id
			_render_list()
			fit())
		line.add_child(expand)
		var locate := WorkshopUI.bare_icon("fit", "Locate")
		var coord: Variant = entry.get("coord")
		locate.pressed.connect(func() -> void:
			if coord is Array and (coord as Array).size() >= 2:
				host.locate(Vector2(float(coord[0]), float(coord[1]))))
		line.add_child(locate)
		var trash := WorkshopUI.bare_icon("trash", "Delete", Color("#f87171"))
		trash.pressed.connect(func() -> void: host.request("workshop.feature.remove", {"featureId": id, "undoable": true}))
		line.add_child(trash)
		inner.add_child(line)
		if _expanded == id:
			inner.add_child(WorkshopUI.input(str(entry.get("name", "")), "Name", func(text: String) -> void: host.request("workshop.feature.update", {"featureId": id, "patch": {"name": text}}), 12.0, 28.0))
			inner.add_child(WorkshopUI.select(SYMBOLS, str(entry.get("symbol", "square")), func(value: String) -> void: host.request("workshop.feature.update", {"featureId": id, "patch": {"symbol": value}}), 12.0, 28.0))
			inner.add_child(WorkshopUI.input(", ".join(tags), "tags, comma separated", func(text: String) -> void:
				var next: Array = []
				for piece in text.split(","):
					if not piece.strip_edges().is_empty():
						next.append(piece.strip_edges())
				host.request("workshop.feature.update", {"featureId": id, "patch": {"tags": next}}), 12.0, 28.0))
		_list.add_child(parts[0])


func _toggle(id: String, index: int, shift: bool, rows: Array) -> void:
	var ids: Array = []
	for row in rows:
		ids.append(str((row as Dictionary).get("id", "")))
	var next: Array = host.feature_selection.duplicate()
	var from := ids.find(_last_pick) if not _last_pick.is_empty() else -1
	if shift and from >= 0 and index >= 0:
		var a := mini(from, index)
		var b := maxi(from, index)
		for at in range(a, b + 1):
			if not next.has(ids[at]):
				next.append(ids[at])
	elif next.has(id):
		next.erase(id)
	else:
		next.append(id)
	_last_pick = id
	host.set_feature_selection(next)


func _import(mode: String) -> void:
	_importing = true
	_note = ""
	_render_top()
	var reply := await host.request("workshop.feature.import", {"mode": mode})
	if reply.has("ask"):
		if await host.confirm(str(reply["ask"])):
			reply = await host.request("workshop.feature.import", {"mode": mode, "confirmed": true})
		else:
			_importing = false
			_render()
			return
	_importing = false
	_note = str(reply.get("note", ""))
	_render()


func _import_file() -> void:
	var file := await EditorKit.pick_file(self, false, "", PackedStringArray(["*.json, *.geojson ; GeoJSON or JSON"]))
	if file.is_empty():
		return
	_note = ""
	var reply := await host.request("workshop.feature.importFile", {"path": file})
	_note = str(reply.get("note", ""))
	_render()
