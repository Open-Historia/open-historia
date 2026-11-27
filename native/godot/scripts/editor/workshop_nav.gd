extends RefCounted

const WORKSPACES := [
	{"id": "overview", "section": "Your world", "icon": "map", "label": "Overview", "description": "Scenario and editing status", "panel": "", "items": []},
	{"id": "countries", "section": "Edit the scenario", "icon": "flag", "label": "Polities", "description": "Sovereign actors, territory and identity", "panel": "polities", "items": [
		{"id": "polities", "icon": "flag", "label": "Polity details"},
	]},
	{"id": "territory", "section": "Edit the scenario", "icon": "list", "label": "Territory & borders", "description": "Regions, types and clipboard", "panel": "regions", "items": [
		{"id": "regions", "icon": "list", "label": "Regions"},
		{"id": "types", "icon": "types", "label": "Region types"},
		{"id": "clipboard", "icon": "copy", "label": "Copy or paste regions"},
	]},
	{"id": "places", "section": "Edit the scenario", "icon": "pin", "label": "Places & units", "description": "Cities, landmarks and armies", "panel": "features", "items": [
		{"id": "features", "icon": "pin", "label": "Cities and map features"},
		{"id": "units", "icon": "unit", "label": "Starting units"},
	]},
	{"id": "groups", "section": "Edit the scenario", "icon": "users", "label": "Groups", "description": "Non-sovereign actors and territory", "panel": "groups", "items": [
		{"id": "groups", "icon": "users", "label": "Group details"},
	]},
	{"id": "war", "section": "Edit the scenario", "icon": "mountain", "label": "Terrain & war", "description": "Climate and defensive lines", "panel": "war", "items": [
		{"id": "war", "icon": "mountain", "label": "War geography"},
	]},
	{"id": "appearance", "section": "Edit the scenario", "icon": "layers", "label": "Maps & appearance", "description": "Layers, flags and projection", "panel": "layers", "items": [
		{"id": "basemap", "icon": "map", "label": "Base and detailed maps", "action": "basemap"},
		{"id": "layers", "icon": "layers", "label": "Map layers"},
		{"id": "reference", "icon": "image", "label": "Reference picture"},
		{"id": "projection", "icon": "globe", "label": "Projection and scale"},
	]},
	{"id": "import", "section": "Finish & play", "icon": "upload", "label": "Import or generate", "description": "Maps, suggestions and recovery", "panel": "province-import", "items": [
		{"id": "province-import", "icon": "upload", "label": "Import map"},
		{"id": "generator", "icon": "map", "label": "Generate world", "action": "generator"},
		{"id": "suggestions", "icon": "review", "label": "Suggested changes"},
		{"id": "clipboard", "icon": "copy", "label": "Clipboard"},
	]},
	{"id": "review", "section": "Finish & play", "icon": "review", "label": "Review & save", "description": "Document and scenario state", "panel": "", "items": []},
]

const MUTED := Color("#b4c4d0")
const LINE := Color(1, 1, 1, 0.12)


static func workspace_of_panel(panel_id: String, preferred := "") -> String:
	var first := ""
	for workspace in WORKSPACES:
		for item in (workspace as Dictionary)["items"]:
			if str((item as Dictionary)["id"]) == panel_id:
				if str(workspace["id"]) == preferred:
					return preferred
				if first.is_empty():
					first = str(workspace["id"])
	return first


static func render(workshop: Workshop, box: VBoxContainer) -> void:
	WorkshopUI.clear(box)
	box.add_theme_constant_override("separation", 5)
	var doc: Dictionary = workshop.state.get("doc", {})
	var counts: Dictionary = doc.get("counts", {})
	var polity_count := int(doc.get("polityCount", 0))
	var group_count := int(doc.get("groupCount", 0))
	var suggestions_on := bool(workshop.review.get("active", false))
	var native_counts := {
		"regions": int(counts.get("regions", 0)), "polities": polity_count, "groups": group_count,
		"types": int(counts.get("types", 0)), "features": int(counts.get("features", 0)), "units": int(counts.get("units", 0)),
		"clipboard": int(doc.get("clipboardCount", 0)),
	}
	if suggestions_on:
		native_counts["suggestions"] = int(workshop.review.get("total", 0)) - int(workshop.review.get("settled", 0))
	var active_id: String = workshop.selected_workspace
	if not workshop.open_panel.is_empty():
		var found := workspace_of_panel(workshop.open_panel, workshop.selected_workspace)
		if not found.is_empty():
			active_id = found
	var last_section := ""
	for entry in WORKSPACES:
		var workspace: Dictionary = entry
		var holder := VBoxContainer.new()
		holder.add_theme_constant_override("separation", 0)
		var section := str(workspace["section"])
		if section != last_section:
			var head := MarginContainer.new()
			for pair in [["margin_left", 5], ["margin_right", 5], ["margin_top", 10], ["margin_bottom", 7]]:
				head.add_theme_constant_override(pair[0], pair[1])
			head.add_child(WorkshopUI.section_label(section, 10))
			holder.add_child(head)
			last_section = section
		var active := active_id == str(workspace["id"])
		var items: Array = []
		for item in workspace["items"]:
			var id := str((item as Dictionary)["id"])
			if id == "suggestions" and not suggestions_on:
				continue
			if id == "generator" and not workshop.generator_available():
				continue
			items.append(item)
		var panel := str(workspace["panel"])
		holder.add_child(_workspace_button(workspace, active, native_counts.get(panel, -1), workshop))
		if active and items.size() > 1:
			holder.add_child(_items(workshop, items, native_counts))
		if active and str(workspace["id"]) == "overview":
			holder.add_child(_overview(counts, polity_count, group_count))
		if active and str(workspace["id"]) == "review":
			holder.add_child(_review(workshop, counts, polity_count, group_count))
		box.add_child(holder)


static func _workspace_button(workspace: Dictionary, active: bool, count: int, workshop: Workshop) -> Button:
	var node := WorkshopUI.base_button("")
	var bg := Color(1, 1, 1, 0.1) if active else Color(0, 0, 0, 0)
	var border := Color(1, 1, 1, 0.18) if active else Color(0, 0, 0, 0)
	var normal := UI.box(bg, border, 10, 1, Vector4(9, 8, 9, 8))
	var hover := UI.box(Color(1, 1, 1, 0.12 if active else 0.06), Color(1, 1, 1, 0.2 if active else 0.12), 10, 1, Vector4(9, 8, 9, 8))
	WorkshopUI._flat_styles(node, normal, hover, hover, normal)
	node.custom_minimum_size.y = 49
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.tooltip_text = str(workspace["description"])
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	row.offset_left = 9
	row.offset_right = -9
	var glyph := WorkshopUI.icon_rect(str(workspace["icon"]), 18, WorkshopUI.ACCENT_GREY if active else MUTED)
	glyph.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(glyph)
	var text := VBoxContainer.new()
	text.add_theme_constant_override("separation", 2)
	text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	text.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	text.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var ink := Color(1, 1, 1, 1) if active else Color(236 / 255.0, 236 / 255.0, 240 / 255.0, 0.74)
	var title := UI.label(str(workspace["label"]), WorkshopUI.font_size(12.5), ink, 750)
	title.clip_text = true
	title.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	text.add_child(title)
	var detail := UI.label(str(workspace["description"]), WorkshopUI.font_size(10.5), MUTED, 400)
	detail.clip_text = true
	detail.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	text.add_child(detail)
	row.add_child(text)
	if count >= 0:
		var chip := PanelContainer.new()
		chip.add_theme_stylebox_override("panel", UI.box(WorkshopUI.CARD, Color(1, 1, 1, 0.12), 6, 1, Vector4(6, 2, 6, 2)))
		chip.mouse_filter = Control.MOUSE_FILTER_IGNORE
		chip.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		chip.add_child(UI.label(str(count), WorkshopUI.font_size(10), MUTED, 700))
		row.add_child(chip)
	node.add_child(row)
	node.pressed.connect(workshop.choose_workspace.bind(str(workspace["id"]), str(workspace["panel"])))
	return node


static func _items(workshop: Workshop, items: Array, native_counts: Dictionary) -> MarginContainer:
	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 17)
	margin.add_theme_constant_override("margin_top", 5)
	margin.add_theme_constant_override("margin_bottom", 8)
	var rail := PanelContainer.new()
	var rail_style := StyleBoxFlat.new()
	rail_style.bg_color = Color(0, 0, 0, 0)
	rail_style.border_color = LINE
	rail_style.border_width_left = 1
	rail_style.content_margin_left = 8
	rail.add_theme_stylebox_override("panel", rail_style)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 3)
	rail.add_child(column)
	margin.add_child(rail)
	for entry in items:
		var item: Dictionary = entry
		var id := str(item["id"])
		var on := workshop.open_panel == id
		var node := WorkshopUI.base_button("")
		var normal := UI.box(Color(1, 1, 1, 0.12) if on else Color(0, 0, 0, 0), LINE if on else Color(0, 0, 0, 0), 9, 1, Vector4(9, 0, 9, 0))
		var hover := UI.box(Color(1, 1, 1, 0.12 if on else 0.06), Color(1, 1, 1, 0.16), 9, 1, Vector4(9, 0, 9, 0))
		WorkshopUI._flat_styles(node, normal, hover, hover, normal)
		node.custom_minimum_size.y = 34
		node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 10)
		row.mouse_filter = Control.MOUSE_FILTER_IGNORE
		row.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		row.offset_left = 9
		row.offset_right = -9
		var ink := Color(1, 1, 1, 1) if on else Color(236 / 255.0, 236 / 255.0, 240 / 255.0, 0.74)
		var glyph := WorkshopUI.icon_rect(str(item["icon"]), 15, ink)
		glyph.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(glyph)
		var caption := UI.label(str(item["label"]), WorkshopUI.font_size(11.5), ink, 700 if on else 600)
		caption.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		caption.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		caption.clip_text = true
		caption.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		row.add_child(caption)
		if native_counts.has(id):
			var count := UI.label(str(native_counts[id]), WorkshopUI.font_size(10), Color(ink, 0.7), 600)
			count.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			row.add_child(count)
		node.add_child(row)
		node.pressed.connect(workshop.activate_workspace_item.bind(id))
		column.add_child(node)
	return margin


static func _card() -> Array:
	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_top", 6)
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", UI.box(WorkshopUI.PANEL, Color(1, 1, 1, 0.09), 10, 1, Vector4(11, 11, 11, 11)))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 6)
	card.add_child(column)
	margin.add_child(card)
	return [margin, column]


static func _muted(text: String) -> Label:
	var label := WorkshopUI.wrap(text, 11, MUTED)
	return label


static func _overview(counts: Dictionary, polity_count: int, group_count: int) -> MarginContainer:
	var parts := _card()
	var column: VBoxContainer = parts[1]
	column.add_child(UI.label("Current map", WorkshopUI.font_size(12), Color(1, 1, 1), 700))
	column.add_child(_muted("%s regions · %d polities · %d groups" % [WorkshopUI.format_count(int(counts.get("regions", 0))), polity_count, group_count]))
	column.add_child(_muted("Choose what to edit. The map's drawing tools remain in the compact icon toolbar."))
	return parts[0]


static func _review(workshop: Workshop, counts: Dictionary, polity_count: int, group_count: int) -> MarginContainer:
	var parts := _card()
	var column: VBoxContainer = parts[1]
	column.add_theme_constant_override("separation", 7)
	column.add_child(UI.label("Review scenario authoring", WorkshopUI.font_size(12), Color(1, 1, 1), 700))
	column.add_child(_muted("Confirm the authored data below, then use the native Save or Apply action. This is a review, not a second save state."))
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 6)
	grid.add_theme_constant_override("v_separation", 6)
	for pair in [["Regions", counts.get("regions", 0)], ["Polities", polity_count], ["Groups", group_count], ["Region types", counts.get("types", 0)], ["Places", counts.get("features", 0)], ["Starting units", counts.get("units", 0)]]:
		var tile := PanelContainer.new()
		tile.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.05), Color(0, 0, 0, 0), 7, 0, Vector4(7, 7, 7, 7)))
		tile.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var stack := VBoxContainer.new()
		stack.add_theme_constant_override("separation", 0)
		stack.add_child(UI.label(WorkshopUI.format_count(int(pair[1])), WorkshopUI.font_size(14), Color(1, 1, 1), 700))
		stack.add_child(UI.label(str(pair[0]), WorkshopUI.font_size(10), MUTED))
		tile.add_child(stack)
		grid.add_child(tile)
	column.add_child(grid)
	var status: Dictionary = workshop.state.get("status", {})
	var save: Dictionary = workshop.SAVE.get(str(status.get("saveStatus", "saved")), workshop.SAVE["saved"])
	column.add_child(_muted("Working document: %s" % str(save["label"])))
	if bool(status.get("scenarioDirty", false)):
		column.add_child(WorkshopUI.wrap("Changes have not yet been applied to the scenario.", 11, Color("#fbbf24")))
	column.add_child(_muted("The working map and the playable scenario are saved separately. These buttons use the existing native Save and Apply paths."))
	var busy := not workshop.hydrated or not workshop._busy_action.is_empty() or not str(status.get("action", "")).is_empty()
	var save_button := _review_button("Save changes to scenario", true, busy)
	save_button.pressed.connect(workshop.persist.bind(false, false))
	column.add_child(save_button)
	var play := _review_button("Apply & Play", false, busy)
	play.pressed.connect(workshop.persist.bind(true, false))
	column.add_child(play)
	return parts[0]


static func _review_button(text: String, active: bool, busy: bool) -> Button:
	var node := WorkshopUI.base_button(text)
	var bg := Color(1, 1, 1, 0.1) if active else Color(0, 0, 0, 0)
	var border := Color(1, 1, 1, 0.18) if active else Color(0, 0, 0, 0)
	var normal := UI.box(bg, border, 9, 1, Vector4(10, 0, 10, 0))
	var hover := UI.box(Color(1, 1, 1, 0.12 if active else 0.06), Color(1, 1, 1, 0.2), 9, 1, Vector4(10, 0, 10, 0))
	WorkshopUI._flat_styles(node, normal, hover, hover, normal)
	WorkshopUI._ink(node, Color(1, 1, 1, 1) if active else Color(236 / 255.0, 236 / 255.0, 240 / 255.0, 0.74), 13.0, 700 if active else 600)
	node.custom_minimum_size.y = 36
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	if busy:
		node.disabled = true
		node.modulate.a = 0.5
	return node
