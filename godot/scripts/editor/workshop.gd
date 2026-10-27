class_name Workshop
extends Control

signal closed
signal saved(details: Dictionary)
signal play_game(game_id: String)
signal failed(message: String)
signal changed(parts: Dictionary)
signal review_saved(record: Dictionary)

const SIDEBAR_WIDTH := 268.0
const SIDE_KEY := "oh-map-editor-sidebar-side"
const CLEAN_KEY := "oh_editor_border_clean"

const TOOL_GROUPS := [
	{"label": "Select", "tools": [
		{"id": "select", "icon": "select", "label": "Select"},
		{"id": "lasso", "icon": "lasso", "label": "Lasso select (drag to circle regions)"},
		{"id": "pan", "icon": "pan", "label": "Pan"},
	]},
	{"label": "Edit", "tools": [
		{"id": "draw", "icon": "split", "label": "Draw region (click a border to trace along it)"},
		{"id": "modify", "icon": "modify", "label": "Edit vertices (select regions first; snap + undo enabled)"},
		{"id": "border", "icon": "merge", "label": "Shared border precision (select exactly 2 neighbouring regions)"},
		{"id": "move", "icon": "move", "label": "Move"},
		{"id": "delete", "icon": "trash", "label": "Delete (click a region)"},
		{"id": "dissolve", "icon": "eraser", "label": "Delete border (merge two regions)"},
		{"id": "paint", "icon": "paint", "label": "Paint polity (click or drag across regions; one stroke = one undo)"},
	]},
	{"label": "On the map", "tools": [
		{"id": "feature", "icon": "feature", "label": "City tool (click map to add a city, click a city to edit it)"},
		{"id": "marker", "icon": "pin", "label": "Map feature tool (click the map to place a base, port, landmark or other feature; click one to edit it)"},
		{"id": "unit", "icon": "unit", "label": "Unit tool (click the map to place a starting unit, click a unit to edit it)"},
		{"id": "feature-box", "icon": "boxSelect", "label": "Box-select features (drag a rectangle over cities and features to select them all)"},
	]},
	{"label": "War map", "tools": [
		{"id": "terrain", "icon": "mountain", "label": "Terrain (draw an area troops cross more slowly; click an outline to pick one)"},
		{"id": "fortification", "icon": "wall", "label": "Fortified line (draw a wall troops have to break through; click a line to pick one)"},
		{"id": "climate", "icon": "climate", "label": "Climate zone (draw an area with its own seasons and weather; click an outline to pick one)"},
	]},
]

const WAR_TOOL_HINTS := {
	"terrain": "Click to draw an area and double-click to finish (shift-drag draws freehand). Click an outline to pick an area, drag its points to reshape it, and press Delete to remove it.",
	"fortification": "Click to draw a line and double-click to finish. Click a line to pick it, drag its points to reshape it, and press Delete to remove it.",
	"climate": "Click to draw a zone and double-click to finish (shift-drag draws freehand). Click an outline to pick a zone, drag its points to reshape it, and press Delete to remove it.",
}

const SAVE := {
	"saved": {"color": "#22c55e", "label": "All saved"},
	"dirty": {"color": "#f59e0b", "label": "Unsaved changes"},
	"saving": {"color": "#f59e0b", "label": "Saving…"},
	"error": {"color": "#ef4444", "label": "Save failed"},
}

const BASEMAP_LABELS := {"ocean": "Ocean", "ocean-dark": "Ocean - Dark", "atlas-relief": "Atlas Relief", "atlas-relief-dark": "Atlas Relief - Dark", "midnight-terrain": "Midnight Terrain", "imagery": "Satellite", "streets": "Streets", "topo": "Topographic", "terrain": "Terrain", "shaded": "Shaded Relief", "natgeo": "National Geographic", "natgeo-dark": "National Geographic - Dark", "physical": "Physical", "light-gray": "Light Gray Canvas", "dark-gray": "Dark Gray Canvas"}

var engine: EngineLink
var context := {}
var session := ""
var scenario := {}
var options := {}
var state := {"regions": {}, "doc": {}, "features": [], "units": [], "war": {}, "status": {}, "history": {}}
var selection: Array = []
var feature_selection: Array = []
var tool := "select"
var paint_owner := ""
var paint_only := "*"
var open_panel := ""
var hydrated := false
var sidebar_side := "right"
var sidebar_hidden := false
var war_selection := {}
var war_tab := "terrain"
var review := {}
var _style_rev := -1
var map: WorkshopMap
var _busy_action := ""
var _exit_ask := false
var _sidebar: PanelContainer
var _hide_tab: Button
var _map_holder: Control
var _name_edit: LineEdit
var _tools_box: VBoxContainer
var _panels_box: VBoxContainer
var _footer: VBoxContainer
var _undo_button: Button
var _redo_button: Button
var _panel: Control
var _inspector: WorkshopInspector
var _popup: Control
var _overlays: Control
var _cleanup: WorkshopCleanup
var _settings_pop: PanelContainer
var _documents: WorkshopDocuments
var _search: WorkshopSearch
var _fmg_tab: VerticalTab
var _fmg: WorkshopFmg
var _fmg_open := false
var _fmg_info := {}
var paste_simplified := true
var _closing := false
var _rebaking := false
var _last_clean := "deep"
var _scenario_name := ""


func setup(engine_link: EngineLink, setup_context: Dictionary) -> void:
	engine = engine_link
	context = setup_context
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	if not engine.engine_event.is_connected(_on_engine_event):
		engine.engine_event.connect(_on_engine_event)
	_build()


func open(scenario_record: Dictionary, open_options: Dictionary) -> void:
	scenario = scenario_record
	options = open_options
	_scenario_name = str(scenario.get("name", ""))
	hydrated = false
	_render_sidebar()
	var prefs := await request_raw("workshop.pref.get", {"keys": [SIDE_KEY, CLEAN_KEY]})
	if prefs.get("ok", false):
		var values: Dictionary = prefs["result"].get("values", {})
		sidebar_side = "left" if str(values.get(SIDE_KEY, "")) == "left" else "right"
		_last_clean = "quick" if str(values.get(CLEAN_KEY, "")) == "quick" else "deep"
		_layout()
	var args := {"scenarioId": str(scenario.get("id", ""))}
	if options.has("world") and options["world"] is Dictionary:
		args["world"] = options["world"]
	if options.has("gameDate"):
		args["gameDate"] = str(options.get("gameDate", ""))
	if options.has("warSettings"):
		args["warSettings"] = options["warSettings"]
		args["hasWarSettings"] = true
	if options.get("review") is Dictionary:
		args["review"] = options["review"]
	var reply := await engine.request("workshop.open", args)
	if not reply.get("ok", false):
		var message := str(reply.get("error", ""))
		if not message.begins_with("The map editor was closed"):
			message = "The map editor was closed because this scenario's map could not be loaded, so nothing was saved over it. " + message
		failed.emit(message)
		_finish_close()
		return
	var result: Dictionary = reply["result"]
	session = str(result.get("session", ""))
	var named: Dictionary = result.get("scenario", {})
	if not str(named.get("name", "")).is_empty():
		_scenario_name = str(named.get("name", ""))
	await apply(result)
	map.start_view()
	hydrated = true
	_render_sidebar()
	_check_fmg()
	_refresh_overlays()
	if bool(review.get("active", false)):
		var marked := await request_raw("workshop.review.markup")
		if marked.get("ok", false) and marked["result"] is Dictionary:
			_apply_markup(marked["result"])
		open_panel_named("suggestions")


func _check_fmg() -> void:
	var reply := await request_raw("workshop.fmg.available")
	if reply.get("ok", false) and reply["result"] is Dictionary and bool((reply["result"] as Dictionary).get("available", false)):
		_fmg_info = reply["result"]
		_fmg_tab.visible = true
		_layout()


func toggle_fmg() -> void:
	_fmg_open = not _fmg_open
	if _fmg_open and (_fmg == null or not is_instance_valid(_fmg)):
		_fmg = WorkshopFmg.new()
		add_child(_fmg)
		move_child(_fmg, _sidebar.get_index())
		_fmg.setup(self, _fmg_info)
	_fmg_tab.label = "🗺 GENERATE ▸" if _fmg_open else "🗺 GENERATE ◂"
	_layout()


func request_raw(method: String, args := {}) -> Dictionary:
	var payload := args.duplicate()
	if not session.is_empty() and not payload.has("session"):
		payload["session"] = session
	return await engine.request(method, payload)


func request(method: String, args := {}) -> Dictionary:
	var reply := await request_raw(method, args)
	if not reply.get("ok", false):
		await alert(str(reply.get("error", "Something went wrong.")))
		return {}
	var result: Variant = reply.get("result")
	if result is Dictionary:
		await apply(result)
		return result
	return {"value": result}


func apply(result: Dictionary) -> void:
	var parts := {}
	if result.has("status"):
		state["status"] = result["status"]
		parts["status"] = true
	if result.has("history"):
		state["history"] = result["history"]
		parts["history"] = true
	if result.has("doc"):
		state["doc"] = result["doc"]
		parts["doc"] = true
		map.polity_colors = (result["doc"] as Dictionary).get("colors", {})
		var style_rev := int((result["doc"] as Dictionary).get("styleRev", 0))
		if style_rev != _style_rev:
			_style_rev = style_rev
			_apply_basemap.call_deferred()
	if result.has("features"):
		state["features"] = result["features"]
		map.features = result["features"]
		parts["features"] = true
	if result.has("feature") and result["feature"] is Dictionary:
		var row: Dictionary = result["feature"]
		var rows: Array = state["features"]
		for index in range(rows.size()):
			if str((rows[index] as Dictionary).get("id", "")) == str(row.get("id", "")):
				rows[index] = row
		map.features = rows
		parts["features"] = true
	if result.has("units"):
		state["units"] = result["units"]
		map.units = result["units"]
		parts["units"] = true
	if result.has("war"):
		state["war"] = result["war"]
		map.war = result["war"]
		parts["war"] = true
	if result.has("bake") and result["bake"] is Dictionary:
		var file := str((result["bake"] as Dictionary).get("file", ""))
		if not file.is_empty():
			_rebaking = true
			map.load_regions(file)
			await map.baked_map
			_rebaking = false
	if result.has("regions"):
		state["regions"] = result["regions"]
		map.set_regions(result["regions"])
		parts["regions"] = true
	if result.has("selection") and result["selection"] is Array:
		set_selection(result["selection"])
	else:
		_sync_selection()
	if result.get("review") is Dictionary and (result["review"] as Dictionary).has("active"):
		review = result["review"]
		parts["review"] = true
	if result.get("markup") is Dictionary:
		_apply_markup(result["markup"])
	elif parts.has("regions") and bool(review.get("active", false)) and hydrated:
		_refresh_markup.call_deferred()
	if hydrated and (parts.has("regions") or parts.has("doc")):
		_refresh_overlays.call_deferred()
	if parts.has("regions") and tool in ["modify", "border"] and not result.has("rings"):
		_refresh_edit_rings.call_deferred()
	map.redraw()
	_render_dynamic(parts)
	changed.emit(parts)


var _overlay_serial := 0


func _refresh_overlays() -> void:
	_overlay_serial += 1
	var serial := _overlay_serial
	var reply := await request_raw("workshop.regionOverlays")
	if serial != _overlay_serial or not reply.get("ok", false) or not (reply["result"] is Dictionary) or map == null or map.region_overlays == null:
		return
	map.region_overlays.set_data(reply["result"])
	map.sync_overlay_layers()


func _apply_basemap() -> void:
	var reply := await request_raw("workshop.basemapStyle")
	if not reply.get("ok", false) or not (reply["result"] is Dictionary):
		return
	if map and map.map:
		map.map.editor_set_session_layer(null)
		map.map.editor_apply_basemap(reply["result"], engine)


func _refresh_markup() -> void:
	var marked := await request_raw("workshop.review.markup")
	if marked.get("ok", false) and marked["result"] is Dictionary:
		_apply_markup(marked["result"])


func _apply_markup(markup: Dictionary) -> void:
	var tints := {}
	var regions: Dictionary = markup.get("regions", {}) if markup.get("regions") is Dictionary else {}
	for id in regions:
		if map.index_of.has(str(id)):
			tints[int(map.index_of[str(id)])] = WorkshopMap.REVIEW_COLORS.get(str(regions[id]), WorkshopMap.REVIEW_COLORS["pending"])
	map.review_tint = tints
	map.review_outlines = markup.get("outlines", []) if markup.get("outlines") is Array else []
	map.review_shapes = markup.get("shapes", []) if markup.get("shapes") is Array else []
	map.review_points = markup.get("points", []) if markup.get("points") is Array else []
	map.review_focus = markup.get("focus", {}) if markup.get("focus") is Dictionary else {}
	map.apply_fills()
	map.redraw()


func _build() -> void:
	for child in get_children():
		child.queue_free()
	var page := ColorRect.new()
	page.color = WorkshopUI.MAP_BG
	page.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	page.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(page)
	_map_holder = Control.new()
	_map_holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_map_holder)
	map = WorkshopMap.new()
	map.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_map_holder.add_child(map)
	map.setup(str(context.get("tiles_cache", "")))
	map.region_click.connect(_on_region_click)
	map.region_double_click.connect(_on_region_double_click)
	map.empty_click.connect(func(additive: bool) -> void:
		if not additive:
			set_selection([]))
	map.map_click.connect(_on_map_click)
	map.point_click.connect(_on_point_click)
	map.delete_click.connect(_on_delete_click)
	map.dissolve_click.connect(_on_dissolve_click)
	map.paint_stroke.connect(_on_paint_stroke)
	map.lasso_done.connect(_on_lasso)
	map.box_done.connect(_on_box)
	map.move_done.connect(_on_move)
	map.move_started.connect(_on_move_started)
	map.war_drawn.connect(_on_war_drawn)
	map.war_pick.connect(func(kind: String, id: String) -> void: pick_war_shape(kind, id))
	map.war_reshaped.connect(func(kind: String, id: String, geometry: Array) -> void: request("workshop.war.reshape", {"kind": kind, "rowId": id, "points" if kind == "fortification" else "rings": geometry}))
	map.draw_point_requested.connect(_on_draw_point)
	map.draw_finished.connect(_on_draw_finished)
	map.vertex_edit.connect(_on_vertex_edit)
	map.hover_moved.connect(_on_hover_moved)
	map.view_moved.connect(func() -> void:
		if _popup and is_instance_valid(_popup):
			_close_popup())
	_fmg_tab = VerticalTab.new()
	_fmg_tab.label = "🗺 GENERATE ◂"
	_fmg_tab.focus_mode = Control.FOCUS_NONE
	_fmg_tab.tooltip_text = "Generate a world with the Fantasy Map Generator"
	_fmg_tab.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	_fmg_tab.visible = false
	_fmg_tab.pressed.connect(toggle_fmg)
	add_child(_fmg_tab)
	_sidebar = PanelContainer.new()
	add_child(_sidebar)
	_hide_tab = Button.new()
	_hide_tab.focus_mode = Control.FOCUS_NONE
	_hide_tab.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	_hide_tab.custom_minimum_size = Vector2(20, 64)
	_hide_tab.pressed.connect(func() -> void:
		sidebar_hidden = not sidebar_hidden
		_layout())
	add_child(_hide_tab)
	_inspector = WorkshopInspector.new()
	_inspector.visible = false
	add_child(_inspector)
	_inspector.setup(self)
	_overlays = Control.new()
	_overlays.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_overlays.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_overlays)
	_cleanup = WorkshopCleanup.new()
	_cleanup.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_overlays.add_child(_cleanup)
	_cleanup.stop_requested.connect(func() -> void: request_raw("workshop.stopCleanup"))
	resized.connect(_layout)
	_layout()


func _notification(what: int) -> void:
	if what == NOTIFICATION_RESIZED and _sidebar:
		_layout()


func dock_left() -> float:
	return SIDEBAR_WIDTH if not sidebar_hidden and sidebar_side == "left" else 0.0


func dock_right() -> float:
	return SIDEBAR_WIDTH if not sidebar_hidden and sidebar_side != "left" else 0.0


func _layout() -> void:
	if not _sidebar:
		return
	var view := size
	var on_right := sidebar_side != "left"
	_map_holder.position = Vector2(dock_left(), 0)
	_map_holder.size = Vector2(maxf(1.0, view.x - dock_left() - dock_right()), view.y)
	_sidebar.visible = not sidebar_hidden
	var border := Color(1, 1, 1, 0.08)
	var style := StyleBoxFlat.new()
	style.bg_color = WorkshopUI.NAV
	style.border_color = border
	if on_right:
		style.border_width_left = 1
	else:
		style.border_width_right = 1
	_sidebar.add_theme_stylebox_override("panel", style)
	_sidebar.size = Vector2(SIDEBAR_WIDTH, view.y)
	_sidebar.position = Vector2(view.x - SIDEBAR_WIDTH if on_right else 0.0, 0)
	var tab_x := 0.0
	if on_right:
		tab_x = view.x - (0.0 if sidebar_hidden else SIDEBAR_WIDTH - 1.0) - 20.0
	else:
		tab_x = 0.0 if sidebar_hidden else SIDEBAR_WIDTH - 1.0
	_hide_tab.position = Vector2(tab_x, view.y * 0.5 - 32.0)
	_hide_tab.size = Vector2(20, 64)
	var radius_left := 10 if on_right else 0
	var tab_style := UI.box(WorkshopUI.NAV, Color(1, 1, 1, 0.1), 0, 1)
	tab_style.corner_radius_top_left = radius_left
	tab_style.corner_radius_bottom_left = radius_left
	tab_style.corner_radius_top_right = 10 - radius_left
	tab_style.corner_radius_bottom_right = 10 - radius_left
	if on_right:
		tab_style.border_width_right = 0
	else:
		tab_style.border_width_left = 0
	for state_name in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
		_hide_tab.add_theme_stylebox_override(state_name, tab_style)
	var chevron := "chevronLeft" if sidebar_hidden == on_right else "chevronRight"
	_hide_tab.icon = WorkshopUI.icon(chevron, 15, Color(1, 1, 1, 0.75))
	_hide_tab.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_hide_tab.tooltip_text = "Show" if sidebar_hidden else "Hide"
	_fmg_tab.reset_size()
	var drawer := WorkshopFmg.WIDTH if _fmg_open else 0.0
	_fmg_tab.position = Vector2(view.x - dock_right() - drawer - _fmg_tab.size.x, view.y * 0.5 + 40.0)
	if _fmg and is_instance_valid(_fmg):
		_fmg.visible = _fmg_open
		_fmg.position = Vector2(view.x - dock_right() - WorkshopFmg.WIDTH, 0)
		_fmg.size = Vector2(WorkshopFmg.WIDTH, view.y)
	_place_panel()
	_place_inspector()


func _place_panel() -> void:
	if not _panel or not is_instance_valid(_panel):
		return
	var shell := _panel as WorkshopShell
	if not shell:
		return
	shell.max_height = size.y - 24.0
	var width := minf(shell.panel_width, size.x - dock_left() - dock_right() - 24.0)
	shell.custom_minimum_size.x = width
	if shell.side == "right":
		shell.position = Vector2(size.x - dock_right() - 12.0 - width, 12)
	else:
		shell.position = Vector2(dock_left() + 12.0, 12)
	shell.fit()


func _place_inspector() -> void:
	if not _inspector:
		return
	_inspector.max_height = size.y - 24.0
	var width := minf(_inspector.panel_width, size.x - dock_left() - dock_right() - 24.0)
	_inspector.custom_minimum_size.x = width
	_inspector.position = Vector2(size.x - dock_right() - 12.0 - width, 12)
	_inspector.fit()


func _render_sidebar() -> void:
	WorkshopUI.clear(_sidebar)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	_sidebar.add_child(column)
	var head_margin := MarginContainer.new()
	for pair in [["margin_left", 12], ["margin_right", 12], ["margin_top", 14], ["margin_bottom", 12]]:
		head_margin.add_theme_constant_override(pair[0], pair[1])
	var head := VBoxContainer.new()
	head.add_theme_constant_override("separation", 10)
	head_margin.add_child(head)
	var title_row := HBoxContainer.new()
	title_row.add_theme_constant_override("separation", 10)
	var tile := PanelContainer.new()
	tile.add_theme_stylebox_override("panel", UI.box(Color("#1c1f27"), Color(1, 1, 1, 0.09), 12, 1))
	tile.custom_minimum_size = Vector2(40, 40)
	tile.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var map_glyph := WorkshopUI.icon_rect("map", 20)
	map_glyph.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	tile.add_child(map_glyph)
	title_row.add_child(tile)
	var name_box := VBoxContainer.new()
	name_box.add_theme_constant_override("separation", 3)
	name_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	name_box.add_child(WorkshopUI.section_label("Map name", 9.5))
	var doc: Dictionary = state.get("doc", {})
	_name_edit = WorkshopUI.input(str(doc.get("name", _scenario_name)), "Untitled Map", Callable(), 14.0, 28.0)
	_name_edit.add_theme_font_override("font", UI.font(800))
	_name_edit.add_theme_stylebox_override("normal", UI.box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.1), 8, 1, Vector4(7, 3, 7, 3)))
	_name_edit.add_theme_stylebox_override("focus", UI.box(Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.26), 8, 1, Vector4(7, 3, 7, 3)))
	_name_edit.text_changed.connect(func(text: String) -> void:
		if not session.is_empty():
			request("workshop.meta", {"patch": {"name": text}}))
	name_box.add_child(_name_edit)
	title_row.add_child(name_box)
	var gear := WorkshopUI.tool_button("settings", _settings_pop != null and _settings_pop.visible, "Settings", 16, 32.0)
	gear.custom_minimum_size = Vector2(32, 32)
	gear.size_flags_horizontal = Control.SIZE_SHRINK_END
	gear.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	gear.pressed.connect(func() -> void: _toggle_settings(gear))
	title_row.add_child(gear)
	head.add_child(title_row)
	var tools_row := HBoxContainer.new()
	tools_row.add_theme_constant_override("separation", 6)
	var docs_button := WorkshopUI.base_button("")
	var docs_normal := UI.box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.08), 10, 1, Vector4(7, 0, 7, 0))
	WorkshopUI._flat_styles(docs_button, docs_normal, UI.box(Color(1, 1, 1, 0.08), Color(1, 1, 1, 0.16), 10, 1, Vector4(7, 0, 7, 0)), docs_normal, docs_normal)
	docs_button.custom_minimum_size = Vector2(46, 34)
	docs_button.tooltip_text = "Documents"
	var docs_row := HBoxContainer.new()
	docs_row.add_theme_constant_override("separation", 3)
	docs_row.alignment = BoxContainer.ALIGNMENT_CENTER
	docs_row.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	docs_row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	docs_row.add_child(WorkshopUI.icon_rect("file", 16, Color(236 / 255.0, 236 / 255.0, 240 / 255.0, 0.78)))
	docs_row.add_child(WorkshopUI.icon_rect("chevronDown", 12, Color(1, 1, 1, 0.6)))
	docs_button.add_child(docs_row)
	docs_button.pressed.connect(func() -> void: _toggle_documents(docs_button))
	tools_row.add_child(docs_button)
	var search_box := PanelContainer.new()
	search_box.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.1), 10, 1, Vector4(9, 0, 9, 0)))
	search_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	search_box.custom_minimum_size.y = 34
	var search_row := HBoxContainer.new()
	search_row.add_theme_constant_override("separation", 6)
	search_row.add_child(WorkshopUI.icon_rect("search", 14, Color(1, 1, 1, 0.6)))
	var search_edit := LineEdit.new()
	search_edit.placeholder_text = "Search places…"
	search_edit.flat = true
	search_edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	search_edit.add_theme_font_override("font", UI.font(400))
	search_edit.add_theme_font_size_override("font_size", 12)
	search_edit.add_theme_color_override("font_color", Color(1, 1, 1))
	search_edit.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.38))
	var empty := StyleBoxEmpty.new()
	search_edit.add_theme_stylebox_override("normal", empty)
	search_edit.add_theme_stylebox_override("focus", empty)
	search_row.add_child(search_edit)
	search_box.add_child(search_row)
	tools_row.add_child(search_box)
	if not _search:
		_search = WorkshopSearch.new()
		_overlays.add_child(_search)
		_search.setup(self)
	_search.attach(search_edit, search_box)
	head.add_child(tools_row)
	column.add_child(head_margin)
	column.add_child(_line())
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	var body_margin := MarginContainer.new()
	body_margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for pair in [["margin_left", 12], ["margin_right", 12], ["margin_top", 12], ["margin_bottom", 14]]:
		body_margin.add_theme_constant_override(pair[0], pair[1])
	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 18)
	body_margin.add_child(body)
	scroll.add_child(body_margin)
	column.add_child(scroll)
	_tools_box = VBoxContainer.new()
	_tools_box.add_theme_constant_override("separation", 10)
	body.add_child(_tools_box)
	_panels_box = VBoxContainer.new()
	_panels_box.add_theme_constant_override("separation", 12)
	body.add_child(_panels_box)
	column.add_child(_line())
	var foot_margin := MarginContainer.new()
	for pair in [["margin_left", 12], ["margin_right", 12], ["margin_top", 12], ["margin_bottom", 12]]:
		foot_margin.add_theme_constant_override(pair[0], pair[1])
	_footer = VBoxContainer.new()
	_footer.add_theme_constant_override("separation", 9)
	foot_margin.add_child(_footer)
	column.add_child(foot_margin)
	_render_tools()
	_render_panels_nav()
	_render_footer()


func _line() -> ColorRect:
	var line := ColorRect.new()
	line.color = Color(1, 1, 1, 0.07)
	line.custom_minimum_size.y = 1
	line.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return line


func _tool_meta(id: String) -> Dictionary:
	for group in TOOL_GROUPS:
		for entry in (group as Dictionary)["tools"]:
			if str((entry as Dictionary)["id"]) == id:
				return entry
	return {}


func _render_tools() -> void:
	if not _tools_box:
		return
	WorkshopUI.clear(_tools_box)
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 8)
	var title := WorkshopUI.section_label("Tools")
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	head.add_child(title)
	var history: Dictionary = state.get("history", {})
	_undo_button = WorkshopUI.tool_button("undo", false, "Undo", 15, 28.0)
	_undo_button.custom_minimum_size = Vector2(28, 28)
	_undo_button.size_flags_horizontal = Control.SIZE_SHRINK_END
	_undo_button.pressed.connect(undo)
	head.add_child(_undo_button)
	_redo_button = WorkshopUI.tool_button("redo", false, "Redo", 15, 28.0)
	_redo_button.custom_minimum_size = Vector2(28, 28)
	_redo_button.size_flags_horizontal = Control.SIZE_SHRINK_END
	_redo_button.pressed.connect(redo)
	head.add_child(_redo_button)
	var fit := WorkshopUI.tool_button("fit", false, "Fit to data", 15, 28.0)
	fit.custom_minimum_size = Vector2(28, 28)
	fit.size_flags_horizontal = Control.SIZE_SHRINK_END
	fit.pressed.connect(fit_to_data)
	head.add_child(fit)
	_tools_box.add_child(head)
	_render_history(history)
	for group in TOOL_GROUPS:
		var block := VBoxContainer.new()
		block.add_theme_constant_override("separation", 5)
		block.add_child(UI.label(str((group as Dictionary)["label"]), 12, Color(1, 1, 1, 0.55), 600))
		var grid := GridContainer.new()
		grid.columns = 6
		grid.add_theme_constant_override("h_separation", 4)
		grid.add_theme_constant_override("v_separation", 4)
		for entry in (group as Dictionary)["tools"]:
			var meta: Dictionary = entry
			var id := str(meta["id"])
			var button := WorkshopUI.tool_button(str(meta["icon"]), tool == id, str(meta["label"]))
			button.custom_minimum_size = Vector2(34, 36)
			button.pressed.connect(func() -> void: set_tool(id))
			grid.add_child(button)
		block.add_child(grid)
		_tools_box.add_child(block)
	var current := _tool_meta(tool)
	if current.is_empty():
		return
	var parts := WorkshopUI.card(12, WorkshopUI.CARD, Color(1, 1, 1, 0.08), Vector4(11, 10, 11, 10), 8)
	var card: PanelContainer = parts[0]
	var inner: VBoxContainer = parts[1]
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 8)
	var glyph := WorkshopUI.icon_rect(str(current["icon"]), 15)
	glyph.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	line.add_child(glyph)
	var caption := UI.label(str(current["label"]), 12, Color(1, 1, 1, 0.92), 700)
	caption.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	caption.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	line.add_child(caption)
	inner.add_child(line)
	_render_tool_options(inner)
	_tools_box.add_child(card)


func _render_history(history: Dictionary) -> void:
	if not _undo_button:
		return
	var can_undo := bool(history.get("canUndo", false))
	var can_redo := bool(history.get("canRedo", false))
	_undo_button.disabled = not can_undo
	_redo_button.disabled = not can_redo
	_undo_button.icon = WorkshopUI.icon("undo", 15, Color(1, 1, 1, 0.78) if can_undo else Color(1, 1, 1, 0.28))
	_redo_button.icon = WorkshopUI.icon("redo", 15, Color(1, 1, 1, 0.78) if can_redo else Color(1, 1, 1, 0.28))


func polity_choices() -> Array:
	var doc: Dictionary = state.get("doc", {})
	var polities: Dictionary = doc.get("polities", {})
	var keys := {}
	for key in polities:
		keys[str(key)] = true
	var regions: Dictionary = state.get("regions", {})
	for key in regions.get("owners", []):
		keys[str(key)] = true
	if not paint_owner.is_empty():
		keys[paint_owner] = true
	var rows: Array = []
	for key in keys:
		var record: Dictionary = polities.get(key, {}) if polities.get(key) is Dictionary else {}
		rows.append({"key": str(key), "name": str(record.get("name", key)) if not str(record.get("name", "")).is_empty() else str(key)})
	rows.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		var left := str(a["name"])
		var right := str(b["name"])
		if left == right:
			return str(a["key"]) < str(b["key"])
		return left.naturalnocasecmp_to(right) < 0)
	return rows


func polity_name(key: String) -> String:
	var doc: Dictionary = state.get("doc", {})
	var polities: Dictionary = doc.get("polities", {})
	var record: Variant = polities.get(key)
	if record is Dictionary and not str((record as Dictionary).get("name", "")).is_empty():
		return str((record as Dictionary)["name"])
	return key


func polity_color(key: String) -> Color:
	var doc: Dictionary = state.get("doc", {})
	var colors: Dictionary = doc.get("colors", {})
	if colors.has(key):
		return WorkshopUI.rgb_color(colors[key])
	return WorkshopUI.code_to_color(key)


func _render_tool_options(inner: VBoxContainer) -> void:
	if tool == "paint":
		var top := HBoxContainer.new()
		top.add_theme_constant_override("separation", 6)
		var doc: Dictionary = state.get("doc", {})
		var colors: Dictionary = doc.get("colors", {})
		if colors.has(paint_owner):
			top.add_child(WorkshopUI.swatch(WorkshopUI.rgb_color(colors[paint_owner]), 16.0, 4))
		var options_list: Array = [["", "Unowned / erase ownership"]]
		for row in polity_choices():
			var entry: Dictionary = row
			var label_text := str(entry["name"]) + ("" if str(entry["name"]) == str(entry["key"]) else " — " + str(entry["key"]))
			options_list.append([str(entry["key"]), label_text])
		var owner_select := WorkshopUI.select(options_list, paint_owner, func(value: String) -> void:
			paint_owner = value
			_sync_paint()
			_render_tools(), 12.0, 28.0)
		owner_select.tooltip_text = "Stable polity key to assign while painting"
		top.add_child(owner_select)
		inner.add_child(top)
		inner.add_child(UI.label("paint over", 12, Color(1, 1, 1, 0.55)))
		var filters: Array = [["*", "Any region"], ["__unowned__", "Unowned regions only"]]
		for row in polity_choices():
			var entry: Dictionary = row
			filters.append([str(entry["key"]), "Only " + str(entry["name"])])
		var only_select := WorkshopUI.select(filters, paint_only, func(value: String) -> void:
			paint_only = value
			_sync_paint(), 12.0, 28.0)
		only_select.tooltip_text = "Restrict a paint stroke to regions that currently have this owner"
		inner.add_child(only_select)
		var manage := WorkshopUI.pill("Manage polities…")
		manage.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		manage.pressed.connect(func() -> void: open_panel_named("polities"))
		inner.add_child(manage)
	elif tool in ["terrain", "fortification", "climate"]:
		inner.add_child(WorkshopUI.wrap(str(WAR_TOOL_HINTS[tool]), 12, Color(1, 1, 1, 0.7)))
	elif tool == "modify":
		var count := selection.size()
		var text := "select the regions to edit first" if count == 0 else ("1 selected region · drag a vertex · drag an edge to insert · Alt-click a vertex to remove · snap magnet enabled · Ctrl/Cmd+Z undo" if count == 1 else "%d selected regions · drag a vertex · drag an edge to insert · Alt-click a vertex to remove · snap magnet enabled · Ctrl/Cmd+Z undo" % count)
		inner.add_child(_tool_note("Manual vertex override:", text, Color(1, 1, 1, 0.7) if count > 0 else Color("#fbbf24")))
	elif tool == "border":
		var count := selection.size()
		var text := "drag a border vertex or edge on either selected region; the released point is welded into BOTH regions · cyan halo = shared-border magnet · Alt-click removes the corresponding shared vertex · a 100 m topology check runs after each edit · Ctrl/Cmd+Z undo" if count == 2 else "select exactly 2 neighbouring regions first (%d selected)" % count
		inner.add_child(_tool_note("Shared border precision:", text, Color(1, 1, 1, 0.74) if count == 2 else Color("#fbbf24")))
	elif tool == "select":
		inner.add_child(WorkshopUI.wrap("Click a region to select it, Shift-click to add more, and double-click to select its whole country.", 12, Color(1, 1, 1, 0.7)))


func _tool_note(lead: String, text: String, color: Color) -> RichTextLabel:
	var note := RichTextLabel.new()
	note.bbcode_enabled = true
	note.fit_content = true
	note.scroll_active = false
	note.mouse_filter = Control.MOUSE_FILTER_IGNORE
	note.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	note.add_theme_font_override("normal_font", UI.font(400))
	note.add_theme_font_override("bold_font", UI.font(700))
	note.add_theme_font_size_override("normal_font_size", 12)
	note.add_theme_font_size_override("bold_font_size", 12)
	note.add_theme_color_override("default_color", color)
	note.text = "[b]%s[/b] %s" % [lead, text.replace("[", "[lb]")]
	return note


func _sync_paint() -> void:
	map.paint_owner = paint_owner
	map.paint_only = paint_only
	map.paint_color = WorkshopMap.NEUTRAL if paint_owner.is_empty() else polity_color(paint_owner)


func set_tool(id: String) -> void:
	tool = id
	map.tool = id
	map.abort_sketch()
	map.diagnostics = []
	map.snap_marker = null
	if id in ["modify", "border"]:
		_refresh_edit_rings()
	else:
		map.edit_rings = []
	if id in ["terrain", "fortification", "climate"]:
		war_tab = id
		if open_panel != "war":
			open_panel_named("war")
		else:
			changed.emit({"war": true})
	_sync_paint()
	_update_war_visibility()
	_render_tools()
	map.redraw()


func _update_war_visibility() -> void:
	map.show_terrain = tool == "terrain" or (open_panel == "war" and war_tab == "terrain")
	map.show_climate = tool == "climate" or (open_panel == "war" and war_tab == "climate")
	map.war_selected = war_selection
	map.redraw()


func _render_panels_nav() -> void:
	if not _panels_box:
		return
	WorkshopUI.clear(_panels_box)
	_panels_box.add_child(WorkshopUI.section_label("Panels"))
	var doc: Dictionary = state.get("doc", {})
	var counts: Dictionary = doc.get("counts", {})
	var metadata: Dictionary = doc.get("metadata", {})
	var basemap_label := "Custom" if metadata.get("customBackground") != null else str(BASEMAP_LABELS.get(str(metadata.get("basemap", "ocean")), ""))
	var tiled: Variant = metadata.get("tiledBasemap")
	var detailed_label := str((tiled as Dictionary).get("name", "")) if tiled is Dictionary else ""
	var groups := [
		{"label": "Map", "items": [
			{"id": "regions", "icon": "list", "label": "Regions", "count": int(counts.get("regions", 0))},
			{"id": "polities", "icon": "flag", "label": "Countries", "count": int(doc.get("polityCount", 0))},
			{"id": "groups", "icon": "users", "label": "Groups", "count": int(doc.get("groupCount", 0))},
			{"id": "types", "icon": "types", "label": "Region Types", "count": int(counts.get("types", 0))},
			{"id": "features", "icon": "pin", "label": "Map features", "count": int(counts.get("features", 0))},
			{"id": "units", "icon": "unit", "label": "Units", "count": int(counts.get("units", 0))},
			{"id": "war", "icon": "mountain", "label": "War map", "count": -1},
		]},
		{"label": "View", "items": [
			{"id": "basemap", "icon": "map", "label": "Basemap", "value": basemap_label, "run": true},
			{"id": "detailed", "icon": "image", "label": "Detailed map", "value": detailed_label, "run": true},
			{"id": "layers", "icon": "layers", "label": "Layers", "count": -1},
			{"id": "reference", "icon": "image", "label": "Reference", "count": -1},
			{"id": "projection", "icon": "globe", "label": "Projection", "count": -1},
		]},
		{"label": "Import", "items": ([{"id": "suggestions", "icon": "review", "label": "Suggested changes", "count": int(review.get("total", 0)) - int(review.get("settled", 0))}] if bool(review.get("active", false)) else []) + [
			{"id": "province-import", "icon": "upload", "label": "Import Map", "count": -1},
			{"id": "clipboard", "icon": "copy", "label": "Clipboard", "count": int(doc.get("clipboardCount", 0))},
		]},
	]
	for group in groups:
		var block := VBoxContainer.new()
		block.add_theme_constant_override("separation", 2)
		var label_holder := MarginContainer.new()
		label_holder.add_theme_constant_override("margin_bottom", 3)
		label_holder.add_child(UI.label(str((group as Dictionary)["label"]), 12, Color(1, 1, 1, 0.55), 600))
		block.add_child(label_holder)
		for entry in (group as Dictionary)["items"]:
			var item: Dictionary = entry
			var id := str(item["id"])
			var runs := bool(item.get("run", false))
			var button := WorkshopUI.nav_item(str(item["icon"]), str(item["label"]), str(item.get("value", "")), int(item.get("count", -1)), not runs and open_panel == id)
			if runs:
				button.pressed.connect(open_basemaps)
			else:
				button.pressed.connect(func() -> void: toggle_panel(id))
			block.add_child(button)
		_panels_box.add_child(block)


func _render_footer() -> void:
	if not _footer:
		return
	WorkshopUI.clear(_footer)
	var status: Dictionary = state.get("status", {})
	var save_status := str(status.get("saveStatus", "saved"))
	var save: Dictionary = SAVE.get(save_status, SAVE["saved"])
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 8)
	var dot := Panel.new()
	dot.custom_minimum_size = Vector2(9, 9)
	dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	dot.add_theme_stylebox_override("panel", UI.box(Color(str(save["color"])), Color(0, 0, 0, 0), 5))
	dot.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if save_status == "error":
		var error_text := str(status.get("saveError", ""))
		var retry := WorkshopUI.base_button("")
		var clear := StyleBoxEmpty.new()
		for state_name in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
			retry.add_theme_stylebox_override(state_name, clear)
		retry.tooltip_text = ("Save failed: %s. Click to try again." % error_text) if not error_text.is_empty() else "Save failed. Click to try again."
		var retry_row := HBoxContainer.new()
		retry_row.add_theme_constant_override("separation", 7)
		retry_row.mouse_filter = Control.MOUSE_FILTER_IGNORE
		retry_row.add_child(dot)
		var retry_label := UI.label(("Save failed: %s — Retry" % error_text) if not error_text.is_empty() else "Save failed — Retry", 12, Color(1, 1, 1, 1))
		retry_label.clip_text = true
		retry_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		retry_label.custom_minimum_size.x = 150
		retry_row.add_child(retry_label)
		retry.add_child(retry_row)
		retry.custom_minimum_size = Vector2(170, 18)
		retry.pressed.connect(func() -> void: request("workshop.flush"))
		line.add_child(retry)
	else:
		line.add_child(dot)
		line.add_child(UI.label(str(save["label"]), 12, Color(1, 1, 1, 0.8)))
	if bool(status.get("scenarioDirty", false)):
		line.add_child(UI.spacer())
		var badge := PanelContainer.new()
		badge.add_theme_stylebox_override("panel", UI.box(Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.12), Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.35), 999, 1, Vector4(8, 3, 8, 3)))
		badge.tooltip_text = "The editor document may be autosaved, but these changes have not yet been written into the scenario."
		badge.add_child(UI.label("Scenario unsaved", 11, Color("#fbbf24"), 700))
		line.add_child(badge)
	_footer.add_child(line)
	var action := _busy_action if not _busy_action.is_empty() else str(status.get("action", ""))
	var dim := not action.is_empty() or not hydrated
	var tip := "The scenario’s map is still loading" if not hydrated else ""
	if _exit_ask:
		var parts := WorkshopUI.card(12, Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.08), Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.3), Vector4(11, 10, 11, 10), 8)
		var box: VBoxContainer = parts[1]
		var question := "This scenario has Workshop changes that have not been saved into the scenario yet. Close without applying them?" if bool(status.get("scenarioDirty", false)) else "Leave the map editor?"
		box.add_child(WorkshopUI.wrap(question, 12, Color("#fde68a")))
		var save_exit := _scenario_button("Save & Exit", true, dim)
		save_exit.tooltip_text = tip if not hydrated else "Save this map into %s and leave the Workshop" % (_scenario_name if not _scenario_name.is_empty() else "the scenario")
		save_exit.pressed.connect(func() -> void:
			_exit_ask = false
			_render_footer()
			persist(false, true))
		box.add_child(save_exit)
		var pair := GridContainer.new()
		pair.columns = 2
		pair.add_theme_constant_override("h_separation", 6)
		var cancel := _scenario_button("Cancel", false, false)
		cancel.pressed.connect(func() -> void:
			_exit_ask = false
			_render_footer())
		pair.add_child(cancel)
		var leave := _scenario_button("Exit", false, false)
		var leave_style := UI.box(Color(185 / 255.0, 28 / 255.0, 28 / 255.0, 0.72), Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.4), 10, 1, Vector4(10, 0, 10, 0))
		WorkshopUI._flat_styles(leave, leave_style, leave_style, leave_style, leave_style)
		leave.pressed.connect(func() -> void:
			_exit_ask = false
			request_close(true))
		pair.add_child(leave)
		box.add_child(pair)
		_footer.add_child(parts[0])
		return
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 6)
	grid.add_theme_constant_override("v_separation", 6)
	var save_label := "Loading map…" if not hydrated else ("Saving…" if action == "save" else "💾 Save")
	var save_button := _scenario_button(save_label, false, dim)
	save_button.tooltip_text = tip if not hydrated else "Save this map into %s and keep editing" % (_scenario_name if not _scenario_name.is_empty() else "the scenario")
	save_button.pressed.connect(func() -> void: persist(false, false))
	grid.add_child(save_button)
	var exit_button := _scenario_button("Saving…" if action == "save-exit" else "Exit", false, not action.is_empty())
	exit_button.pressed.connect(func() -> void:
		_exit_ask = true
		_render_footer())
	grid.add_child(exit_button)
	_footer.add_child(grid)
	var play := _scenario_button("Applying…" if action == "play" else "▶ Apply & Play", true, dim)
	play.tooltip_text = tip if not hydrated else "Save this map into %s and start playing it" % (_scenario_name if not _scenario_name.is_empty() else "the scenario")
	play.pressed.connect(func() -> void: persist(true, false))
	_footer.add_child(play)


func _scenario_button(text: String, primary: bool, dim: bool) -> Button:
	var node := WorkshopUI.base_button(text)
	var bg := WorkshopUI.ACCENT if primary else Color(1, 1, 1, 0.06)
	var border := WorkshopUI.ACCENT if primary else Color(1, 1, 1, 0.12)
	var normal := UI.box(bg, border, 10, 1, Vector4(10, 0, 10, 0))
	var hover := UI.box(bg.lightened(0.08) if primary else Color(1, 1, 1, 0.1), border, 10, 1, Vector4(10, 0, 10, 0))
	WorkshopUI._flat_styles(node, normal, hover, hover, normal)
	WorkshopUI._ink(node, Color(1, 1, 1), 12.5, 700)
	node.add_theme_color_override("font_disabled_color", Color(1, 1, 1))
	node.custom_minimum_size.y = 36
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	if dim:
		node.disabled = true
		node.modulate.a = 0.7
		node.mouse_default_cursor_shape = Control.CURSOR_ARROW
	return node


func _render_dynamic(parts: Dictionary) -> void:
	if parts.has("history"):
		_render_history(state.get("history", {}))
	if parts.has("status"):
		_render_footer()
	if parts.has("doc") or parts.has("regions"):
		_render_panels_nav()
		if _name_edit and not _name_edit.has_focus():
			var doc: Dictionary = state.get("doc", {})
			if _name_edit.text != str(doc.get("name", "")):
				_name_edit.text = str(doc.get("name", ""))
		if tool == "paint":
			_render_tools()


func _on_engine_event(name: String, data: Variant) -> void:
	if not (data is Dictionary):
		return
	var payload: Dictionary = data
	if str(payload.get("session", "")) != session or session.is_empty():
		return
	if name == "workshop.status":
		var status: Dictionary = state.get("status", {})
		for key in ["saveStatus", "saveError", "scenarioDirty", "hydrated", "action"]:
			if payload.has(key):
				status[key] = payload[key]
		state["status"] = status
		_render_footer()
	elif name == "workshop.cleanup":
		_cleanup.show_progress(payload)


func set_selection(ids: Array, zoom := false) -> void:
	selection = []
	for id in ids:
		selection.append(str(id))
	_sync_selection()
	_inspector.refresh_selection()
	_place_inspector()
	changed.emit({"selection": true})
	if tool in ["modify", "border"]:
		map.diagnostics = []
		_refresh_edit_rings()
		_render_tools()
	if zoom and not selection.is_empty():
		zoom_to(selection)


var _edit_serial := 0


func _refresh_edit_rings() -> void:
	_edit_serial += 1
	var serial := _edit_serial
	if selection.is_empty() or (tool == "border" and selection.size() != 2):
		map.edit_rings = []
		map.redraw()
		return
	var reply := await request_raw("workshop.edit.rings", {"ids": selection})
	if serial != _edit_serial or not reply.get("ok", false):
		return
	map.edit_rings = (reply["result"] as Dictionary).get("rings", [])
	map.redraw()


var _draw_queue: Array = []
var _draw_busy := false


func _on_draw_point(lonlat: Vector2, previous: Variant) -> void:
	_draw_queue.append([lonlat, previous])
	if _draw_busy:
		return
	_draw_busy = true
	while not _draw_queue.is_empty():
		var job: Array = _draw_queue.pop_front()
		var at: Vector2 = job[0]
		var before: Variant = job[1]
		if not map.draw_points.is_empty():
			before = map.draw_points[map.draw_points.size() - 1]
		var reply := await request_raw("workshop.draw.point", {"at": [at.x, at.y], "previous": before, "resolution": map.meters_per_pixel()})
		if not reply.get("ok", false) or tool != "draw":
			continue
		var result: Dictionary = reply["result"]
		var points: Array = (result.get("trace", []) as Array).duplicate()
		points.append(result.get("point", [at.x, at.y]))
		map.add_draw_points(points)
	_draw_busy = false


func _on_draw_finished(ring: Array) -> void:
	await request("workshop.draw.finish", {"ring": ring})


var _hover_busy := false
var _hover_next: Variant = null


func _on_hover_moved(lonlat: Vector2) -> void:
	_hover_next = lonlat
	if _hover_busy:
		return
	_hover_busy = true
	while _hover_next != null:
		var at: Vector2 = _hover_next
		_hover_next = null
		var reply := await request_raw("workshop.edit.snap", {"at": [at.x, at.y], "resolution": map.meters_per_pixel(), "pixels": 10})
		if reply.get("ok", false) and tool == "draw":
			var result: Dictionary = reply["result"]
			var point: Array = result.get("point", [at.x, at.y])
			map.snap_marker = Vector2(float(point[0]), float(point[1])) if result.get("kind") != null else null
			map.redraw()
	_hover_busy = false


func _on_vertex_edit(op: String, target: String, path: Array, index: int, lonlat: Vector2, alt: bool) -> void:
	var result := await request("workshop.edit.vertex", {"ids": selection, "op": op, "target": target, "path": path, "index": index, "to": [lonlat.x, lonlat.y], "alt": alt, "resolution": map.meters_per_pixel(), "mode": "border" if tool == "border" else "modify"})
	if result.has("rings"):
		map.edit_rings = result["rings"]
	map.diagnostics = result.get("diagnostics", []) if result.get("diagnostics") is Array else []
	map.redraw()


func _sync_selection() -> void:
	var indices: Array = []
	for id in selection:
		if map.index_of.has(id):
			indices.append(int(map.index_of[id]))
	map.set_selection(indices)


func zoom_to(ids: Array, max_level := 8.0) -> void:
	var reply := await request_raw("workshop.bounds", {"ids": ids})
	if reply.get("ok", false):
		var bounds: Variant = (reply["result"] as Dictionary).get("bounds")
		if bounds is Array:
			map.fit_bounds(bounds, max_level)


func fit_to_data() -> void:
	var reply := await request_raw("workshop.extent")
	if reply.get("ok", false):
		var bounds: Variant = (reply["result"] as Dictionary).get("bounds")
		if bounds is Array:
			map.fit_bounds(bounds, 20.0, 0.3)


func import_regions(args: Dictionary) -> Dictionary:
	var reply := await request_raw("workshop.import.apply", args)
	if reply.get("ok", false) and reply["result"] is Dictionary and (reply["result"] as Dictionary).has("session"):
		map.clear_import_preview()
		await apply(reply["result"])
		if (reply["result"] as Dictionary).get("applied") is Dictionary:
			fit_to_data()
	return reply


func locate(lonlat: Vector2) -> void:
	map.locate(lonlat, 6.0)


func _on_region_click(index: int, additive: bool) -> void:
	if index < 0 or index >= map.ids.size():
		return
	var id := map.ids[index]
	var next: Array = []
	if additive:
		next = selection.duplicate()
		if next.has(id):
			next.erase(id)
		else:
			next.append(id)
	else:
		next = [id]
	set_selection(next)


func _on_region_double_click(index: int) -> void:
	if index < 0 or index >= map.ids.size():
		return
	var reply := await request_raw("workshop.selectOwner", {"regionId": map.ids[index]})
	if reply.get("ok", false):
		set_selection((reply["result"] as Dictionary).get("ids", []))


func _on_paint_stroke(indices: PackedInt32Array) -> void:
	var ids: Array = []
	for index in indices:
		if index >= 0 and index < map.ids.size():
			ids.append(map.ids[index])
	await request("workshop.paint", {"ids": ids, "owner": paint_owner, "only": paint_only})


func _on_lasso(ring: Array) -> void:
	var reply := await request_raw("workshop.lasso", {"ring": ring})
	if reply.get("ok", false):
		set_selection((reply["result"] as Dictionary).get("ids", []))


func _on_box(ids: PackedStringArray, additive: bool) -> void:
	var next: Array = []
	if additive:
		next = feature_selection.duplicate()
	for id in ids:
		if not next.has(id):
			next.append(id)
	set_feature_selection(next)


func set_feature_selection(ids: Array) -> void:
	feature_selection = ids.duplicate()
	map.feature_selection = {}
	for id in feature_selection:
		map.feature_selection[str(id)] = true
	map.redraw()
	changed.emit({"featureSelection": true})


func _on_move_started(index: int) -> void:
	if index < 0 or index >= map.ids.size():
		return
	var reply := await request_raw("workshop.edit.rings", {"ids": [map.ids[index]]})
	if reply.get("ok", false) and map._move_line.size() == 2:
		map.move_rings = (reply["result"] as Dictionary).get("rings", [])
		map.redraw()


func _on_move(index: int, from: Vector2, to: Vector2) -> void:
	if index < 0 or index >= map.ids.size():
		return
	await request("workshop.regions.move", {"ids": [map.ids[index]], "from": [from.x, from.y], "to": [to.x, to.y]})


func _on_map_click(lonlat: Vector2, screen: Vector2, index: int) -> void:
	var region_id := map.ids[index] if index >= 0 and index < map.ids.size() else ""
	if tool == "unit":
		var reply := await request("workshop.unit.add", {"lng": lonlat.x, "lat": lonlat.y, "regionId": region_id})
		if reply.has("id"):
			open_popup("unit", str(reply["id"]), screen, true)
		return
	var reply := await request("workshop.feature.add", {"coord": [lonlat.x, lonlat.y], "regionId": region_id, "mapFeature": tool == "marker"})
	if reply.has("id"):
		open_popup("feature", str(reply["id"]), screen, true)


func _on_point_click(kind: String, id: String, screen: Vector2) -> void:
	open_popup(kind, id, screen, false)


func _on_delete_click(kind: String, id: String, _index: int) -> void:
	if kind == "unit":
		await request("workshop.unit.remove", {"unitId": id, "undoable": true})
		_close_popup_for(id)
	elif kind == "feature":
		await request("workshop.feature.remove", {"featureId": id, "undoable": true})
		_close_popup_for(id)
	elif kind.begins_with("war:"):
		var war_kind := kind.substr(4)
		await request("workshop.war.remove", {"kind": war_kind, "rowId": id})
		if str(war_selection.get("id", "")) == id:
			war_selection = {}
			_update_war_visibility()
	elif kind == "region" and not id.is_empty():
		var remaining: Array = selection.duplicate()
		remaining.erase(id)
		await request("workshop.regions.delete", {"ids": [id]})
		set_selection(remaining)


func _on_dissolve_click(index: int, neighbour: int) -> void:
	if index < 0 or neighbour < 0 or index >= map.ids.size() or neighbour >= map.ids.size():
		return
	var reply := await request("workshop.regions.dissolve", {"ids": [map.ids[index], map.ids[neighbour]]})
	if reply.has("refused"):
		await alert(str(reply["refused"]))


func _on_war_drawn(kind: String, coords: Array) -> void:
	var args := {"kind": kind}
	if kind == "fortification":
		args["points"] = coords
		args["owner"] = ""
	else:
		args["rings"] = coords
	var reply := await request("workshop.war.create", args)
	if reply.has("id"):
		pick_war_shape(kind, str(reply["id"]))


func pick_war_shape(kind: String, id: String) -> void:
	war_selection = {"kind": kind, "id": id} if not id.is_empty() else {}
	if not id.is_empty():
		war_tab = kind
		if open_panel != "war":
			open_panel_named("war")
	_update_war_visibility()
	changed.emit({"war": true})


func open_popup(kind: String, id: String, screen: Vector2, is_new: bool) -> void:
	_close_popup()
	var popup := WorkshopPopup.new()
	_overlays.add_child(popup)
	popup.setup(self, kind, id, is_new)
	var anchor := screen + map.global_position - global_position
	popup.place(anchor, size)
	popup.closed.connect(func() -> void:
		if _popup == popup:
			_popup = null
		popup.queue_free())
	_popup = popup


func _close_popup() -> void:
	if _popup and is_instance_valid(_popup):
		_popup.queue_free()
	_popup = null


func _close_popup_for(id: String) -> void:
	if _popup and is_instance_valid(_popup) and (_popup as WorkshopPopup).target_id == id:
		_close_popup()


func toggle_panel(id: String) -> void:
	if open_panel == id:
		close_panel()
	else:
		open_panel_named(id)


func close_panel() -> void:
	var was := open_panel
	if _panel and is_instance_valid(_panel):
		_panel.queue_free()
	_panel = null
	open_panel = ""
	if was == "war" and tool in ["terrain", "fortification", "climate"]:
		set_tool("select")
	if was == "features" and tool == "feature-box":
		set_tool("select")
	if was == "units" and tool == "unit":
		set_tool("select")
	_update_war_visibility()
	_render_panels_nav()


func open_panel_named(id: String) -> void:
	if _panel and is_instance_valid(_panel):
		_panel.queue_free()
	_panel = null
	open_panel = id
	var shell: WorkshopShell = null
	match id:
		"regions":
			shell = WorkshopRegions.new()
		"polities":
			shell = WorkshopCountries.new()
		"groups":
			shell = WorkshopGroups.new()
		"types":
			shell = WorkshopTypes.new()
		"features":
			shell = WorkshopFeatures.new()
		"units":
			shell = WorkshopUnits.new()
		"war":
			shell = WorkshopWar.new()
		"layers":
			shell = WorkshopLayers.new()
		"projection":
			shell = WorkshopProjection.new()
		"clipboard":
			shell = WorkshopClipboard.new()
		"reference":
			shell = WorkshopReference.new()
		"province-import":
			shell = WorkshopImport.new()
		"suggestions":
			if bool(review.get("active", false)):
				shell = WorkshopReview.new()
	if shell == null:
		open_panel = ""
		_render_panels_nav()
		return
	add_child(shell)
	move_child(shell, _inspector.get_index())
	shell.closed.connect(close_panel)
	shell.call("setup", self)
	_panel = shell
	_place_panel()
	_update_war_visibility()
	_render_panels_nav()


func open_basemaps() -> void:
	var picker := WorkshopBasemaps.new()
	_overlays.add_child(picker)
	picker.setup(self)


func open_flag_picker(key: String) -> void:
	var picker := WorkshopFlags.new()
	_overlays.add_child(picker)
	picker.setup(self, key)


func _toggle_settings(anchor: Control) -> void:
	if _settings_pop and is_instance_valid(_settings_pop):
		_settings_pop.queue_free()
		_settings_pop = null
		return
	_settings_pop = PanelContainer.new()
	_settings_pop.add_theme_stylebox_override("panel", UI.box(WorkshopUI.PANEL, Color(1, 1, 1, 0.09), 16, 1, Vector4(10, 10, 10, 10)))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 7)
	column.add_child(WorkshopUI.section_label("Side", 10.0))
	var pair := GridContainer.new()
	pair.columns = 2
	pair.add_theme_constant_override("h_separation", 4)
	for entry in [["left", "Left"], ["right", "Right"]]:
		var value := str(entry[0])
		var active := (value == "right") == (sidebar_side != "left")
		var button := WorkshopUI.pill(str(entry[1]), active)
		button.custom_minimum_size = Vector2(88, 32)
		button.pressed.connect(func() -> void:
			sidebar_side = value
			request_raw("workshop.pref.set", {"key": SIDE_KEY, "value": value})
			if _settings_pop and is_instance_valid(_settings_pop):
				_settings_pop.queue_free()
			_settings_pop = null
			_layout())
		pair.add_child(button)
	column.add_child(pair)
	_settings_pop.add_child(column)
	_settings_pop.custom_minimum_size.x = 200
	_overlays.add_child(_settings_pop)
	_settings_pop.mouse_filter = Control.MOUSE_FILTER_STOP
	var at := anchor.global_position - global_position + Vector2(0, anchor.size.y + 6)
	_settings_pop.position = Vector2(clampf(at.x + anchor.size.x - 200.0 if sidebar_side != "left" else at.x, 4.0, size.x - 204.0), at.y)


func _toggle_documents(anchor: Control) -> void:
	if _documents and is_instance_valid(_documents):
		_documents.queue_free()
		_documents = null
		return
	_documents = WorkshopDocuments.new()
	_overlays.add_child(_documents)
	_documents.setup(self)
	var at := anchor.global_position - global_position + Vector2(0, anchor.size.y + 6)
	_documents.position = Vector2(clampf(at.x, 4.0, size.x - 248.0), at.y)
	_documents.closed.connect(func() -> void:
		if _documents and is_instance_valid(_documents):
			_documents.queue_free()
		_documents = null)


func undo() -> void:
	await request("workshop.undo")


func redo() -> void:
	await request("workshop.redo")


func persist(play: bool, close_after: bool) -> void:
	if not hydrated or not _busy_action.is_empty() or session.is_empty():
		return
	var mode := await _cleanup.choose(_last_clean)
	if mode.is_empty():
		return
	_last_clean = mode
	request_raw("workshop.pref.set", {"key": CLEAN_KEY, "value": mode})
	_busy_action = "play" if play else ("save-exit" if close_after else "save")
	_render_footer()
	_cleanup.begin(mode)
	var reply := await request_raw("workshop.save", {"mode": mode, "play": play})
	_busy_action = ""
	_cleanup.finish()
	if not reply.get("ok", false):
		_render_footer()
		await alert("Could not save the map into the scenario: " + str(reply.get("error", "")))
		return
	var result: Dictionary = reply["result"]
	if result.has("error"):
		await apply(result)
		await alert(str(result["error"]))
		return
	await apply(result)
	var details: Variant = result.get("details")
	if details is Dictionary:
		saved.emit(details)
	if result.get("review") is Dictionary and not (result["review"] as Dictionary).has("active"):
		review_saved.emit(result["review"])
	var note: Array = result.get("note", [])
	if play:
		var game_id := str(result.get("gameId", ""))
		_finish_close()
		if not game_id.is_empty():
			play_game.emit(game_id)
		return
	_cleanup.show_note(note)
	if close_after:
		_finish_close()


func request_close(confirmed := false) -> void:
	var status: Dictionary = state.get("status", {})
	if bool(status.get("scenarioDirty", false)) and not confirmed:
		if not await confirm("This scenario has Workshop changes that have not been saved into the scenario yet. Close without applying them?"):
			return
	if not session.is_empty() and str(status.get("saveStatus", "saved")) in ["dirty", "saving", "error"]:
		var reply := await request_raw("workshop.flush")
		var ok: bool = reply.get("ok", false) and bool((reply["result"] as Dictionary).get("ok", false))
		if not ok and not await confirm("This map has changes that could not be saved. Close it and lose them?"):
			return
	_finish_close()


func _finish_close() -> void:
	if _closing:
		return
	_closing = true
	if not session.is_empty():
		engine.request("workshop.close", {"session": session})
	session = ""
	closed.emit()
	queue_free()


func alert(text: String) -> void:
	await EditorKit.tell(self, text)


func open_url(url: String) -> void:
	if url.is_empty():
		return
	var log_file := OS.get_environment("OH_EDITOR_OPEN_LOG")
	if log_file.is_empty():
		OS.shell_open(url)
		return
	var out := FileAccess.open(log_file, FileAccess.READ_WRITE if FileAccess.file_exists(log_file) else FileAccess.WRITE)
	if out:
		out.seek_end()
		out.store_line(url)
		out.close()


func confirm(text: String) -> bool:
	return await EditorKit.ask(self, text)


func _unhandled_key_input(event: InputEvent) -> void:
	if not (event is InputEventKey) or not (event as InputEventKey).pressed:
		return
	var key := event as InputEventKey
	var focus := get_viewport().gui_get_focus_owner()
	var typing := focus is LineEdit or focus is TextEdit
	if (key.ctrl_pressed or key.meta_pressed) and not typing:
		if key.keycode == KEY_Z and not key.shift_pressed:
			get_viewport().set_input_as_handled()
			if map.is_sketching():
				map.undo_sketch_point()
			else:
				undo()
			return
		if (key.keycode == KEY_Z and key.shift_pressed) or key.keycode == KEY_Y:
			get_viewport().set_input_as_handled()
			redo()
			return
		if key.keycode == KEY_C and not key.shift_pressed and not key.alt_pressed:
			if not selection.is_empty():
				get_viewport().set_input_as_handled()
				request("workshop.clipboard.copy", {"ids": selection})
			return
		if key.keycode == KEY_V and not key.shift_pressed and not key.alt_pressed:
			get_viewport().set_input_as_handled()
			paste_clipboard(paste_simplified)
			return
	if typing:
		return
	if tool == "draw" and map.is_sketching():
		if key.keycode == KEY_ESCAPE:
			get_viewport().set_input_as_handled()
			map.abort_sketch()
			return
		if key.keycode == KEY_BACKSPACE or key.keycode == KEY_DELETE:
			get_viewport().set_input_as_handled()
			map.undo_sketch_point()
			return
	if tool in ["terrain", "fortification", "climate"]:
		if key.keycode == KEY_ESCAPE:
			get_viewport().set_input_as_handled()
			if not map.abort_sketch() and not war_selection.is_empty():
				pick_war_shape(tool, "")
			return
		if key.keycode == KEY_DELETE or key.keycode == KEY_BACKSPACE:
			get_viewport().set_input_as_handled()
			if map.is_sketching():
				if key.keycode == KEY_BACKSPACE:
					map.undo_sketch_point()
				return
			if str(war_selection.get("kind", "")) == tool:
				var id := str(war_selection.get("id", ""))
				war_selection = {}
				await request("workshop.war.remove", {"kind": tool, "rowId": id})
				_update_war_visibility()
			return
	if key.keycode == KEY_ESCAPE and _popup and is_instance_valid(_popup):
		get_viewport().set_input_as_handled()
		_close_popup()
		return
	if (key.keycode == KEY_DELETE or key.keycode == KEY_BACKSPACE) and not selection.is_empty():
		get_viewport().set_input_as_handled()
		var ids := selection.duplicate()
		await request("workshop.regions.delete", {"ids": ids})
		set_selection([])


func paste_clipboard(simplify: bool) -> Dictionary:
	var reply := await request("workshop.clipboard.paste", {"simplify": simplify})
	var bounds: Variant = reply.get("bounds")
	if bounds is Array:
		map.fit_bounds(bounds, 8.0)
	return reply


class VerticalTab extends Button:
	var label := "":
		set(value):
			label = value
			var font := UI.font(700)
			custom_minimum_size = Vector2(font.get_height(12) + 14.0, font.get_string_size(value, HORIZONTAL_ALIGNMENT_LEFT, -1, 12).x + 28.0)
			queue_redraw()

	func _init() -> void:
		var clear := StyleBoxEmpty.new()
		for state_name in ["normal", "hover", "pressed", "focus", "hover_pressed", "disabled"]:
			add_theme_stylebox_override(state_name, clear)

	func _draw() -> void:
		var style := UI.box(Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.85), Color(147 / 255.0, 197 / 255.0, 253 / 255.0, 0.4), 0, 1)
		style.corner_radius_top_left = 10
		style.corner_radius_bottom_left = 10
		style.border_width_right = 0
		draw_style_box(style, Rect2(Vector2.ZERO, size))
		var font := UI.font(700)
		var across := size.x * 0.5 + (font.get_descent(12) - font.get_ascent(12)) * 0.5
		draw_set_transform(Vector2(across, 14.0), PI * 0.5)
		draw_string(font, Vector2.ZERO, label, HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color(1, 1, 1))
		draw_set_transform(Vector2.ZERO)
