class_name WorkshopDocuments
extends PanelContainer

signal closed

const WIDTH := 244.0
const UNSAVED := ["dirty", "saving", "error"]

var host: Workshop
var _docs: Array = []
var _armed := ""
var _remove_error := ""
var _current := ""
var _column: VBoxContainer
var _saved_box: VBoxContainer


func _init() -> void:
	add_theme_stylebox_override("panel", UI.box(WorkshopUI.PANEL, Color(1, 1, 1, 0.09), 16, 1, Vector4(6, 6, 6, 6)))
	custom_minimum_size.x = WIDTH
	mouse_filter = Control.MOUSE_FILTER_STOP
	_column = VBoxContainer.new()
	_column.add_theme_constant_override("separation", 2)
	add_child(_column)


func setup(workshop: Workshop) -> void:
	host = workshop
	_build()
	var reply := await host.request_raw("workshop.documents.current")
	if reply.get("ok", false):
		var doc_id: Variant = (reply["result"] as Dictionary).get("docId")
		_current = str(doc_id) if doc_id != null else ""
	await _refresh()


func _caption(text: String) -> Label:
	return UI.label(text.to_upper(), 11, Color(1, 1, 1, 0.45), 400, "Arial", 0)


func _divider(top: int, bottom: int) -> MarginContainer:
	var holder := MarginContainer.new()
	holder.add_theme_constant_override("margin_top", top)
	holder.add_theme_constant_override("margin_bottom", bottom)
	var line := ColorRect.new()
	line.color = Color(1, 1, 1, 0.1)
	line.custom_minimum_size.y = 1
	line.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.add_child(line)
	return holder


func _menu_item(icon_name: String, text: String, action: Callable) -> Button:
	var node := WorkshopUI.base_button(text)
	var clear := UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 8, 0, Vector4(10, 7, 10, 7))
	WorkshopUI._flat_styles(node, clear, clear, clear, clear)
	WorkshopUI._ink(node, Color(1, 1, 1), 12.5, 400)
	node.icon = WorkshopUI.icon(icon_name, 15)
	node.alignment = HORIZONTAL_ALIGNMENT_LEFT
	node.add_theme_constant_override("h_separation", 8)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.pressed.connect(func() -> void: action.call())
	return node


func _build() -> void:
	WorkshopUI.clear(_column)
	var made := MarginContainer.new()
	for pair in [["margin_left", 8], ["margin_right", 8], ["margin_top", 4], ["margin_bottom", 6]]:
		made.add_theme_constant_override(pair[0], pair[1])
	var made_column := VBoxContainer.new()
	made_column.add_theme_constant_override("separation", 4)
	made_column.add_child(_caption("Made by"))
	var doc: Dictionary = host.state.get("doc", {})
	var author := WorkshopUI.input(str(doc.get("author", "")), "your name / username", func(text: String) -> void: host.request("workshop.meta", {"patch": {"author": text}}), 12.5, 30.0)
	author.add_theme_stylebox_override("normal", UI.box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.1), 10, 1, Vector4(8, 6, 8, 6)))
	author.add_theme_stylebox_override("focus", UI.box(Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.26), 10, 1, Vector4(8, 6, 8, 6)))
	made_column.add_child(author)
	made.add_child(made_column)
	_column.add_child(made)
	_column.add_child(_divider(2, 4))
	_column.add_child(_menu_item("layers", "New — world map", func() -> void: _close_then(func() -> void: WorkshopDocuments.start_new(host, "fault-lines"))))
	_column.add_child(_menu_item("layers", "New — legacy world map", func() -> void: _close_then(func() -> void: WorkshopDocuments.start_new(host, "modern-day"))))
	_column.add_child(_menu_item("draw", "New — blank map", func() -> void: _close_then(func() -> void: WorkshopDocuments.start_new(host, "blank"))))
	_column.add_child(_divider(4, 4))
	_column.add_child(_menu_item("save", "Save now", func() -> void: _close_then(func() -> void: host.request("workshop.flush"))))
	_column.add_child(_menu_item("copy", "Export JSON", func() -> void: _close_then(func() -> void: WorkshopDocuments.export_file(host, false))))
	_column.add_child(_menu_item("feature", "Export for game", func() -> void: _close_then(func() -> void: WorkshopDocuments.export_file(host, true))))
	_column.add_child(_divider(4, 4))
	var saved_caption := MarginContainer.new()
	for pair in [["margin_left", 10], ["margin_right", 10], ["margin_top", 2], ["margin_bottom", 2]]:
		saved_caption.add_theme_constant_override(pair[0], pair[1])
	saved_caption.add_child(_caption("Saved maps"))
	_column.add_child(saved_caption)
	_saved_box = VBoxContainer.new()
	_saved_box.add_theme_constant_override("separation", 0)
	_column.add_child(_saved_box)
	_render_saved()


func _close_then(action: Callable) -> void:
	action.call()
	closed.emit()


func _refresh() -> void:
	var reply := await host.request_raw("workshop.documents")
	if not is_instance_valid(self):
		return
	_docs = (reply["result"] as Dictionary).get("docs", []) if reply.get("ok", false) else []
	_render_saved()


func _render_saved() -> void:
	if not _saved_box:
		return
	WorkshopUI.clear(_saved_box)
	if not _remove_error.is_empty():
		var error_margin := MarginContainer.new()
		for pair in [["margin_left", 8], ["margin_right", 8], ["margin_top", 2], ["margin_bottom", 4]]:
			error_margin.add_theme_constant_override(pair[0], pair[1])
		var error_box := PanelContainer.new()
		error_box.add_theme_stylebox_override("panel", UI.box(Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.12), Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.3), 8, 1, Vector4(8, 6, 8, 6)))
		error_box.add_child(WorkshopUI.wrap(_remove_error, 11.5, Color("#fecaca")))
		error_margin.add_child(error_box)
		_saved_box.add_child(error_margin)
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	var rows := VBoxContainer.new()
	rows.add_theme_constant_override("separation", 0)
	rows.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(rows)
	if _docs.is_empty():
		var none := MarginContainer.new()
		for pair in [["margin_left", 10], ["margin_right", 10], ["margin_top", 6], ["margin_bottom", 6]]:
			none.add_theme_constant_override(pair[0], pair[1])
		none.add_child(UI.label("No saved maps yet", 12, Color(1, 1, 1, 0.4)))
		rows.add_child(none)
	for entry in _docs:
		if entry is Dictionary:
			rows.add_child(_doc_row(entry))
	_saved_box.add_child(scroll)
	scroll.custom_minimum_size.y = minf(240.0, rows.get_combined_minimum_size().y)
	reset_size()


func _doc_row(doc: Dictionary) -> MarginContainer:
	var id := str(doc.get("id", ""))
	var name := str(doc.get("name", ""))
	var current := id == _current and not id.is_empty()
	var armed := _armed == id
	var holder := MarginContainer.new()
	for pair in [["margin_left", 4], ["margin_right", 4], ["margin_top", 2], ["margin_bottom", 2]]:
		holder.add_theme_constant_override(pair[0], pair[1])
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 6)
	holder.add_child(line)
	var open := PanelContainer.new()
	open.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.08) if current else Color(0, 0, 0, 0), Color(0, 0, 0, 0), 8, 0, Vector4(8, 6, 8, 6)))
	open.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var texts := VBoxContainer.new()
	texts.add_theme_constant_override("separation", 1)
	var title := UI.label(name, 13, Color(1, 1, 1), 600)
	title.clip_text = true
	title.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	title.custom_minimum_size.x = 120
	title.tooltip_text = name
	texts.add_child(title)
	texts.add_child(UI.label("%s regions · %s features" % [str(int(doc.get("regionCount", 0))), str(int(doc.get("featureCount", 0)))], 10, Color(1, 1, 1, 0.45)))
	open.add_child(texts)
	WorkshopUI.ignore_mouse(open)
	WorkshopUI.clickable(open, func(_event: InputEventMouseButton) -> void: _close_then(func() -> void: WorkshopDocuments.open_document(host, id)))
	line.add_child(open)
	var trash := WorkshopUI.base_button("Delete?" if armed else "")
	var style := UI.box(Color(185 / 255.0, 28 / 255.0, 28 / 255.0, 0.72) if armed else Color(0, 0, 0, 0), Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.4) if armed else Color(0, 0, 0, 0), 8, 1, Vector4(7, 3, 7, 3) if armed else Vector4(4, 3, 4, 3))
	WorkshopUI._flat_styles(trash, style, style, style, style)
	var ink := Color(1, 1, 1) if armed else WorkshopUI.RED
	WorkshopUI._ink(trash, ink, 11.5, 700)
	trash.add_theme_color_override("font_disabled_color", ink)
	trash.add_theme_color_override("icon_disabled_color", ink)
	trash.icon = WorkshopUI.icon("trash", 13, ink)
	trash.add_theme_constant_override("h_separation", 4)
	trash.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	if current:
		trash.tooltip_text = "This map is open. Open or start another map to delete it."
		trash.disabled = true
		trash.modulate.a = 0.3
		trash.mouse_default_cursor_shape = Control.CURSOR_ARROW
	elif armed:
		trash.tooltip_text = "Delete “%s” for good? This cannot be undone." % (name if not name.is_empty() else "Untitled Map")
	else:
		trash.tooltip_text = "Delete"
	trash.pressed.connect(func() -> void: _remove(id))
	line.add_child(trash)
	return holder


func _remove(id: String) -> void:
	if _armed != id:
		_armed = id
		_remove_error = ""
		_render_saved()
		return
	_armed = ""
	var reply := await host.request_raw("workshop.documents.delete", {"docId": id})
	if not is_instance_valid(self):
		return
	if not reply.get("ok", false):
		_remove_error = "Could not delete this map: %s" % str(reply.get("error", ""))
	elif (reply["result"] as Dictionary).has("error"):
		_remove_error = str((reply["result"] as Dictionary)["error"])
	await _refresh()


static func settle(workshop: Workshop, question: String) -> bool:
	var status: Dictionary = workshop.state.get("status", {})
	if not (str(status.get("saveStatus", "saved")) in UNSAVED):
		return true
	var reply := await workshop.request_raw("workshop.flush")
	if reply.get("ok", false) and bool((reply["result"] as Dictionary).get("ok", false)):
		return true
	return await workshop.confirm(question)


static func start_new(workshop: Workshop, kind: String) -> void:
	if not await WorkshopDocuments.settle(workshop, "This map has changes that could not be saved. Start a new map and lose them?"):
		return
	var result := await workshop.request("workshop.documents.new", {"kind": kind})
	if result.is_empty():
		return
	workshop.set_selection([])
	if kind != "blank":
		workshop.fit_to_data()


static func open_document(workshop: Workshop, doc_id: String) -> void:
	if not await WorkshopDocuments.settle(workshop, "This map has changes that could not be saved. Open the other map and lose them?"):
		return
	var result := await workshop.request("workshop.documents.open", {"docId": doc_id})
	if result.has("refused"):
		await workshop.alert(str(result["refused"]))
		return
	if result.is_empty():
		return
	workshop.set_selection([])
	workshop.fit_to_data()


static func export_file(workshop: Workshop, game: bool) -> void:
	var named := await workshop.request_raw("workshop.documents.fileName", {"game": game})
	if not named.get("ok", false):
		return
	var file_name := str((named["result"] as Dictionary).get("fileName", "map.json"))
	var target := await EditorKit.pick_file(workshop, true, file_name, PackedStringArray(["*.json ; JSON"]))
	if target.is_empty():
		return
	await workshop.request("workshop.documents.export", {"path": target, "game": game})
