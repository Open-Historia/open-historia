class_name WorkshopReview
extends WorkshopShell

const GREEN_BG := Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.16)
const GREEN_BORDER := Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.45)

var host: Workshop
var _hide_decided := false
var _open_groups := {}


func _init() -> void:
	super._init("Suggested changes", "list", 400.0, "left")


func setup(workshop: Workshop) -> void:
	host = workshop
	host.changed.connect(_on_changed)
	footer.add_child(WorkshopUI.wrap("Accepted changes are on the map now. Save the map to keep them in the scenario.", 11.5, Color(1, 1, 1, 0.62)))
	_render()


func _on_changed(parts: Dictionary) -> void:
	if parts.has("review"):
		_render()


func _small(text: String, green: bool) -> Button:
	var node := WorkshopUI.base_button(text)
	var bg := GREEN_BG if green else Color(1, 1, 1, 0.06)
	var border := GREEN_BORDER if green else Color(1, 1, 1, 0.12)
	var normal := UI.box(bg, border, 9, 1, Vector4(8, 3, 8, 3))
	var hover := UI.box(Color(bg, minf(1.0, bg.a + 0.06)), Color(border, minf(1.0, border.a + 0.1)), 9, 1, Vector4(8, 3, 8, 3))
	WorkshopUI._flat_styles(node, normal, hover, hover, normal)
	WorkshopUI._ink(node, Color(1, 1, 1), 11.0, 600)
	node.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	return node


func _big(text: String, green: bool) -> Button:
	var node := WorkshopUI.pill(text)
	if green:
		var normal := UI.box(GREEN_BG, GREEN_BORDER, 9, 1, Vector4(11, 6, 11, 6))
		var hover := UI.box(Color(GREEN_BG, 0.22), Color(GREEN_BORDER, 0.55), 9, 1, Vector4(11, 6, 11, 6))
		WorkshopUI._flat_styles(node, normal, hover, hover, normal)
	return node


func _accept(ids: Array) -> void:
	var result := await host.request("workshop.review.accept", {"ids": ids})
	if result.has("refused") and not str(result["refused"]).is_empty():
		await host.alert(str(result["refused"]))


func _reject(ids: Array) -> void:
	await host.request("workshop.review.reject", {"ids": ids})


func _undo(change_id: String) -> void:
	var result := await host.request("workshop.review.undo", {"changeId": change_id})
	if result.has("refused") and not str(result["refused"]).is_empty():
		await host.alert(str(result["refused"]))


func _focus(change_id: String) -> void:
	var result := await host.request("workshop.review.focus", {"changeId": change_id})
	var bounds: Variant = result.get("bounds")
	var point: Variant = result.get("point")
	if bounds is Array and (bounds as Array).size() == 2:
		host.map.fit_bounds(bounds, 8.0)
	elif point is Array and (point as Array).size() >= 2:
		host.locate(Vector2(float(point[0]), float(point[1])))


func _render() -> void:
	clear_body()
	var view: Dictionary = host.review
	if not bool(view.get("active", false)):
		fit()
		return
	var by := str(view.get("by", ""))
	var note := str(view.get("note", ""))
	if not by.is_empty() or not note.is_empty():
		var about := VBoxContainer.new()
		about.add_theme_constant_override("separation", 4)
		if not by.is_empty():
			about.add_child(UI.label(by, 12, Color(1, 1, 1), 700))
		if not note.is_empty():
			about.add_child(WorkshopUI.wrap(note, 11.5, Color(1, 1, 1, 0.72)))
		body.add_child(about)
	var rows: Array = []
	for section in view.get("sections", []):
		rows.append_array((section as Dictionary).get("rows", []))
	var pending: Array = []
	for row in rows:
		if not bool((row as Dictionary).get("settled", false)):
			pending.append(str((row as Dictionary).get("id", "")))
	var head := HFlowContainer.new()
	head.add_theme_constant_override("h_separation", 6)
	head.add_theme_constant_override("v_separation", 6)
	var tally := UI.label("%d of %d decided" % [int(view.get("settled", 0)), int(view.get("total", 0))], 12, Color(1, 1, 1), 700)
	tally.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	tally.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	head.add_child(tally)
	if not pending.is_empty():
		var accept_all := _big("Accept all", true)
		accept_all.pressed.connect(func() -> void: _accept(pending))
		head.add_child(accept_all)
		var reject_all := _big("Reject all", false)
		reject_all.pressed.connect(func() -> void: _reject(pending))
		head.add_child(reject_all)
	body.add_child(head)
	body.add_child(WorkshopUI.check("Hide the changes already decided", _hide_decided, func(on: bool) -> void:
		_hide_decided = on
		_render(), 11.5))
	var shown := 0
	for entry in view.get("sections", []):
		var section: Dictionary = entry
		var visible_rows: Array = []
		for row in section.get("rows", []):
			if not _hide_decided or not bool((row as Dictionary).get("settled", false)):
				visible_rows.append(row)
		if visible_rows.is_empty():
			continue
		shown += visible_rows.size()
		var block := VBoxContainer.new()
		block.add_theme_constant_override("separation", 6)
		block.add_child(WorkshopUI.label_dim(str(section.get("title", ""))))
		if str(section.get("id", "")) == "ownership":
			_ownership(block, section, visible_rows, str(view.get("focusId", "")))
		else:
			for row in visible_rows:
				block.add_child(_row(row, str(view.get("focusId", "")), false))
		body.add_child(block)
	if shown == 0:
		body.add_child(UI.label("Nothing left to decide.", 12, Color(1, 1, 1, 0.6)))
	fit()


func _ownership(block: VBoxContainer, section: Dictionary, visible_rows: Array, focus_id: String) -> void:
	var by_id := {}
	for row in visible_rows:
		by_id[str((row as Dictionary).get("id", ""))] = row
	var all_rows := {}
	for row in section.get("rows", []):
		all_rows[str((row as Dictionary).get("id", ""))] = row
	for entry in section.get("groups", []):
		var group: Dictionary = entry
		var key := str(group.get("key", ""))
		var items: Array = []
		var pending: Array = []
		for change_id in group.get("ids", []):
			var row: Variant = all_rows.get(str(change_id))
			if row is Dictionary:
				items.append(row)
				if not bool((row as Dictionary).get("settled", false)):
					pending.append(str(change_id))
		var shown_items: Array = []
		for row in items:
			if by_id.has(str((row as Dictionary).get("id", ""))):
				shown_items.append(row)
		if shown_items.is_empty():
			continue
		var wrap := VBoxContainer.new()
		wrap.add_theme_constant_override("separation", 5)
		var line := HBoxContainer.new()
		line.add_theme_constant_override("separation", 6)
		var opened := bool(_open_groups.get(key, false))
		var toggle := WorkshopUI.base_button("")
		var clear := StyleBoxEmpty.new()
		for state_name in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
			toggle.add_theme_stylebox_override(state_name, clear)
		toggle.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var label_row := HBoxContainer.new()
		label_row.add_theme_constant_override("separation", 6)
		label_row.mouse_filter = Control.MOUSE_FILTER_IGNORE
		label_row.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		label_row.add_child(UI.label("%s %s → %s" % ["▾" if opened else "▸", str(group.get("fromLabel", "")), str(group.get("toLabel", ""))], 12, Color(1, 1, 1), 700))
		var count := (group.get("ids", []) as Array).size()
		label_row.add_child(UI.label("1 region" if count == 1 else "%d regions" % count, 12, Color(1, 1, 1, 0.55)))
		WorkshopUI.ignore_mouse(label_row)
		toggle.add_child(label_row)
		toggle.custom_minimum_size.y = 22
		toggle.pressed.connect(func() -> void:
			_open_groups[key] = not bool(_open_groups.get(key, false))
			_render())
		line.add_child(toggle)
		if not pending.is_empty():
			var accept := _small("Accept", true)
			accept.pressed.connect(func() -> void: _accept(pending))
			line.add_child(accept)
			var reject := _small("Reject", false)
			reject.pressed.connect(func() -> void: _reject(pending))
			line.add_child(reject)
		else:
			var decided := UI.label("Decided", 11, Color(1, 1, 1, 0.5))
			decided.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			line.add_child(decided)
		wrap.add_child(line)
		if opened:
			for row in shown_items:
				wrap.add_child(_row(row, focus_id, true))
		block.add_child(wrap)


func _row(row: Dictionary, focus_id: String, indent: bool) -> Control:
	var change_id := str(row.get("id", ""))
	var focused := change_id == focus_id and not focus_id.is_empty()
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.08) if focused else Color(1, 1, 1, 0.03), Color(1, 1, 1, 0.3) if focused else Color(1, 1, 1, 0.07), 8, 1, Vector4(8, 6, 8, 6)))
	card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 5)
	card.add_child(column)
	var top := HBoxContainer.new()
	top.add_theme_constant_override("separation", 8)
	top.add_child(WorkshopUI.wrap(str(row.get("text", "")), 12, Color(1, 1, 1)))
	var decision := _decision(row)
	if decision:
		top.add_child(decision)
	column.add_child(top)
	var chips: Array = row.get("chips", [])
	if not chips.is_empty():
		var flow := HFlowContainer.new()
		flow.add_theme_constant_override("h_separation", 4)
		flow.add_theme_constant_override("v_separation", 4)
		for chip in chips:
			var holder := PanelContainer.new()
			holder.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.07), Color(0, 0, 0, 0), 5, 0, Vector4(6, 1, 6, 1)))
			holder.add_child(UI.label(str(chip), 11, Color(1, 1, 1)))
			flow.add_child(holder)
		column.add_child(flow)
	var lines: Array = row.get("lines", [])
	if not lines.is_empty():
		var list := VBoxContainer.new()
		list.add_theme_constant_override("separation", 2)
		for text in lines:
			list.add_child(UI.label(str(text), 11, Color(1, 1, 1, 0.62)))
		column.add_child(list)
	if str(row.get("decided", "")).is_empty():
		var note := _status_note(str(row.get("status", "")))
		if note:
			column.add_child(note)
	WorkshopUI.ignore_mouse(card)
	WorkshopUI.clickable(card, func(_event: InputEventMouseButton) -> void: _focus(change_id))
	if not indent:
		return card
	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 12)
	margin.add_child(card)
	return margin


func _decision(row: Dictionary) -> Control:
	var change_id := str(row.get("id", ""))
	var decided := str(row.get("decided", ""))
	if not decided.is_empty():
		var line := HBoxContainer.new()
		line.add_theme_constant_override("separation", 6)
		var word := UI.label("Accepted" if decided == "accepted" else "Rejected", 11, Color("#86efac") if decided == "accepted" else Color(1, 1, 1, 0.5), 700)
		word.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		line.add_child(word)
		if bool(row.get("canUndo", true)):
			var undo := _small("Undo", false)
			undo.pressed.connect(func() -> void: _undo(change_id))
			line.add_child(undo)
		else:
			var hint := UI.label("To undo it, change it back by hand.", 11, Color(1, 1, 1, 0.5))
			hint.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			line.add_child(hint)
		return line
	var status := str(row.get("status", ""))
	if status == "applied" or status == "missing":
		return null
	var pair := HBoxContainer.new()
	pair.add_theme_constant_override("separation", 5)
	var accept := _small("Accept", true)
	accept.pressed.connect(func() -> void: _accept([change_id]))
	pair.add_child(accept)
	var reject := _small("Reject", false)
	reject.pressed.connect(func() -> void: _reject([change_id]))
	pair.add_child(reject)
	return pair


func _status_note(status: String) -> Label:
	if status == "conflict":
		var label := UI.label("You changed this too", 11, Color("#fb923c"), 700)
		label.tooltip_text = "You changed this after you posted the scenario. Accepting replaces your version."
		label.mouse_filter = Control.MOUSE_FILTER_PASS
		return label
	if status == "applied":
		return UI.label("Already on your map", 11, Color("#86efac"), 700)
	if status == "missing":
		return UI.label("Not on your map", 11, Color("#cbd5e1"), 700)
	return null
