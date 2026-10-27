extends SceneTree

var main: Node
var shots := ""
var started := 0
var failures: PackedStringArray = []
var workshop: Workshop
var closed_count := 0
var saved_details: Array = []
var failed_messages: Array = []
var played: Array = []


func _initialize() -> void:
	shots = OS.get_environment("OH_SHOTS")
	started = Time.get_ticks_msec()
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.add_child(main)
	_run.call_deferred()


func _say(text: String) -> void:
	print("[workshop_check %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _check(label: String, ok: bool, detail := "") -> void:
	_say("%s %s%s" % ["ok  " if ok else "FAIL", label, ("  (%s)" % detail) if not detail.is_empty() else ""])
	if not ok:
		failures.append(label)


func _frames(count: int) -> void:
	for i in range(count):
		await process_frame


func _wait(seconds: float) -> void:
	await create_timer(seconds).timeout


func _until(condition: Callable, seconds: float) -> bool:
	var deadline := Time.get_ticks_msec() + int(seconds * 1000.0)
	while Time.get_ticks_msec() < deadline:
		if condition.call():
			return true
		await process_frame
	return bool(condition.call())


func _shoot(shot_name: String) -> void:
	if DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_MINIMIZED:
		_say("screenshot %s skipped: the window is minimised" % shot_name)
		return
	await _frames(4)
	await RenderingServer.frame_post_draw
	if shots.is_empty():
		return
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(shot_name + ".png"))
	_say("screenshot " + shot_name)


func _find_button(node: Node, text: String) -> Button:
	if node is Button and (node as Button).text == text and (node as Button).is_visible_in_tree():
		return node
	for child in node.get_children():
		var found := _find_button(child, text)
		if found:
			return found
	return null


func _find_label(node: Node, text: String) -> Label:
	if node is Label and (node as Label).text == text and (node as Label).is_visible_in_tree():
		return node
	for child in node.get_children():
		var found := _find_label(child, text)
		if found:
			return found
	return null


func _find_type(node: Node, type_name: String) -> Array:
	var out: Array = []
	if node.is_class(type_name):
		out.append(node)
	for child in node.get_children():
		out.append_array(_find_type(child, type_name))
	return out


func _clear_shell() -> void:
	var shell: ShellBoot = main.shell
	if shell == null:
		return
	await _until(func() -> bool: return shell.door_state != "deciding", 30.0)
	if shell.door != null and is_instance_valid(shell.door):
		shell.door.opened.emit()
		_say("vault door opened for the test")
	if not shell.notice_updates.is_empty():
		await _until(func() -> bool: return shell.notice != null and is_instance_valid(shell.notice), 5.0)
		await _frames(5)
	if shell.notice != null and is_instance_valid(shell.notice):
		shell.notice.closed.emit()
		_say("update notice closed for the test")
	await _frames(3)


func _region_index(id: String) -> int:
	return int(workshop.map.index_of.get(id, -1))


func _owner_of(id: String) -> String:
	var index := _region_index(id)
	var regions: Dictionary = workshop.state.get("regions", {})
	var owner_index: Array = regions.get("ownerIndex", [])
	var owners: Array = regions.get("owners", [])
	if index < 0 or index >= owner_index.size():
		return "?"
	var at := int(owner_index[index])
	return str(owners[at]) if at >= 0 and at < owners.size() else ""


func _screen_of_region(id: String) -> Vector2:
	var index := _region_index(id)
	if index < 0:
		return Vector2(-1, -1)
	var world: Vector2 = workshop.map.centroids[index]
	return workshop.map.global_position + workshop.map.map.world_to_screen(world)


func _mouse(at: Vector2, pressed: bool) -> void:
	var event := InputEventMouseButton.new()
	event.button_index = MOUSE_BUTTON_LEFT
	event.pressed = pressed
	event.position = at
	event.global_position = at
	event.button_mask = MOUSE_BUTTON_MASK_LEFT if pressed else 0
	root.push_input(event)


func _drag_to(from: Vector2, to: Vector2) -> void:
	var event := InputEventMouseMotion.new()
	event.position = to
	event.global_position = to
	event.relative = to - from
	event.button_mask = MOUSE_BUTTON_MASK_LEFT
	root.push_input(event)


func _click(at: Vector2) -> void:
	_mouse(at, true)
	await _frames(1)
	_mouse(at, false)
	await _frames(2)


func _run() -> void:
	while not main.menu.visible:
		if Time.get_ticks_msec() - started > 90000:
			_say("FAIL the menu never appeared")
			_finish()
			return
		await process_frame
	_say("menu ready")
	await _clear_shell()
	var tiles := str(main.info.get("dataRoot", "")).path_join("native-cache").path_join("tiles")
	workshop = Workshop.new()
	main.ui.add_child(workshop)
	workshop.closed.connect(func() -> void: closed_count += 1)
	workshop.saved.connect(func(details: Dictionary) -> void: saved_details.append(details))
	workshop.failed.connect(func(message: String) -> void: failed_messages.append(message))
	workshop.play_game.connect(func(game_id: String) -> void: played.append(game_id))
	workshop.setup(main.engine, {"tiles_cache": tiles})
	workshop.open({"id": "default", "name": "Modern Day"}, {})
	await _shoot("ws-0-loading")
	var hydrated := await _until(func() -> bool: return workshop.hydrated or not failed_messages.is_empty(), 180.0)
	_check("the scenario's map opened", hydrated and failed_messages.is_empty(), "; ".join(PackedStringArray(failed_messages)))
	if not hydrated or not failed_messages.is_empty():
		_finish()
		return
	await _wait(2.0)
	var regions: Dictionary = workshop.state.get("regions", {})
	_check("regions baked", workshop.map.ids.size() > 3000, "%d regions" % workshop.map.ids.size())
	_check("owners known", (regions.get("owners", []) as Array).size() > 100, "%d owners" % (regions.get("owners", []) as Array).size())
	for text in ["💾 Save", "Exit", "▶ Apply & Play"]:
		_check("footer button %s" % text, _find_button(workshop, text) != null)
	await _shoot("ws-1-opened")
	await _paint()
	await _countries()
	await _city()
	await _edit_tools()
	await _side_panels()
	await _save()
	await _exit()
	await _review()
	_finish()


func _paint() -> void:
	var first := "FRA.1_1"
	var second := "FRA.8_1"
	_check("the test regions exist", _region_index(first) >= 0 and _region_index(second) >= 0)
	if _region_index(first) < 0:
		return
	_say("owners before: %s=%s %s=%s" % [first, _owner_of(first), second, _owner_of(second)])
	workshop.zoom_to([first, second], 6.0)
	await _wait(1.2)
	workshop.paint_owner = "Germany"
	workshop.set_tool("paint")
	workshop._sync_paint()
	await _frames(2)
	await _shoot("ws-2-paint-tool")
	var a := _screen_of_region(first)
	await _click(a)
	await _until(func() -> bool: return _owner_of(first) == "Germany", 10.0)
	_check("a click paints the region", _owner_of(first) == "Germany", _owner_of(first))
	var b := _screen_of_region(second)
	_mouse(b, true)
	await _frames(1)
	_drag_to(b, b + Vector2(6, 4))
	await _frames(1)
	_mouse(b + Vector2(6, 4), false)
	await _until(func() -> bool: return _owner_of(second) == "Germany", 10.0)
	_check("a drag stroke paints the region", _owner_of(second) == "Germany", _owner_of(second))
	var history: Dictionary = workshop.state.get("history", {})
	_check("painting is undoable", bool(history.get("canUndo", false)))
	var status: Dictionary = workshop.state.get("status", {})
	_check("the scenario is marked unsaved", bool(status.get("scenarioDirty", false)))
	await _shoot("ws-3-painted")
	workshop.set_tool("select")


func _countries() -> void:
	workshop.open_panel_named("polities")
	await _frames(6)
	var panel := workshop._panel as WorkshopCountries
	_check("the Countries panel opened", panel != null)
	if panel == null:
		return
	panel._selected_key = "Germany"
	panel._draft_name = "Greater Germany"
	await panel._reload()
	await _frames(3)
	var rename := _find_button(panel, "Rename")
	_check("the Rename button is there", rename != null)
	if rename:
		rename.pressed.emit()
		await _until(func() -> bool: return ((workshop.state.get("doc", {}) as Dictionary).get("polities", {}) as Dictionary).has("Greater Germany"), 10.0)
	var polities: Dictionary = (workshop.state.get("doc", {}) as Dictionary).get("polities", {})
	_check("the country was renamed", polities.has("Greater Germany") and not polities.has("Germany"))
	_check("its regions follow the new name", _owner_of("FRA.1_1") == "Greater Germany", _owner_of("FRA.1_1"))
	await _frames(4)
	var pickers := _find_type(panel, "ColorPickerButton")
	_check("a colour field is there", not pickers.is_empty())
	if not pickers.is_empty():
		var picker: ColorPickerButton = pickers[0]
		picker.color = Color8(201, 77, 40)
		picker.popup_closed.emit()
		await _until(func() -> bool:
			var colors: Dictionary = (workshop.state.get("doc", {}) as Dictionary).get("colors", {})
			var rgb: Variant = colors.get("Greater Germany")
			return rgb is Array and int(rgb[0]) == 201, 10.0)
	var colors: Dictionary = (workshop.state.get("doc", {}) as Dictionary).get("colors", {})
	_check("the colour changed", colors.get("Greater Germany") is Array and int(colors["Greater Germany"][0]) == 201, str(colors.get("Greater Germany")))
	await _shoot("ws-4-countries")
	workshop.close_panel()
	await _frames(2)


func _ring_screen(coords: Array, index: int) -> Vector2:
	var c: Array = coords[index]
	return workshop.map.global_position + workshop.map.screen_of(Vector2(float(c[0]), float(c[1])))


func _drag_mouse(from: Vector2, to: Vector2, alt := false) -> void:
	var press := InputEventMouseButton.new()
	press.button_index = MOUSE_BUTTON_LEFT
	press.pressed = true
	press.position = from
	press.global_position = from
	press.alt_pressed = alt
	press.button_mask = MOUSE_BUTTON_MASK_LEFT
	root.push_input(press)
	await _frames(1)
	var steps := 6
	for step in range(1, steps + 1):
		var at := from.lerp(to, float(step) / float(steps))
		var motion := InputEventMouseMotion.new()
		motion.position = at
		motion.global_position = at
		motion.relative = (to - from) / float(steps)
		motion.button_mask = MOUSE_BUTTON_MASK_LEFT
		root.push_input(motion)
		await _frames(1)
	var release := InputEventMouseButton.new()
	release.button_index = MOUSE_BUTTON_LEFT
	release.pressed = false
	release.position = to
	release.global_position = to
	release.alt_pressed = alt
	root.push_input(release)
	await _frames(2)


func _edit_tools() -> void:
	workshop.set_selection([])
	workshop.zoom_to(["FRA.8_1"], 7.0)
	await _wait(1.0)
	var count_before := workshop.map.ids.size()
	workshop.set_tool("draw")
	await _frames(2)
	var centre := _screen_of_region("FRA.8_1")
	var corners := [centre + Vector2(-50, -35), centre + Vector2(55, -30), centre + Vector2(10, 50)]
	for at in corners:
		var placed := workshop.map.draw_points.size()
		await _click(at)
		await _until(func() -> bool: return workshop.map.draw_points.size() > placed, 10.0)
	_check("the Draw tool places points", workshop.map.draw_points.size() == 3, str(workshop.map.draw_points.size()))
	await _shoot("ws-18-draw-sketch")
	await _click(corners[0])
	var drawn := await _until(func() -> bool: return workshop.map.ids.size() == count_before + 1 and not workshop._rebaking, 30.0)
	_check("clicking the first point draws the region and bakes it", drawn, "%d -> %d" % [count_before, workshop.map.ids.size()])
	var new_id := ""
	for id in workshop.map.ids:
		if str(id).begins_with("reg_"):
			new_id = str(id)
	_check("the new region is on the map", not new_id.is_empty() and workshop.map.region_name(workshop.map.index_of.get(new_id, -1)) == "New Region", new_id)
	await _wait(0.5)
	await _shoot("ws-19-drawn")
	if new_id.is_empty():
		return
	workshop.set_selection([new_id])
	workshop.set_tool("modify")
	await _until(func() -> bool: return not workshop.map.edit_rings.is_empty(), 10.0)
	_check("Edit vertices shows the selected outline", not workshop.map.edit_rings.is_empty())
	var ring: Dictionary = workshop.map.edit_rings[0]
	var coords: Array = ring.get("coords", [])
	var before_count := coords.size()
	var first: Array = coords[0]
	var from := _ring_screen(coords, 0)
	await _drag_mouse(from, from + Vector2(30, -20))
	await _until(func() -> bool:
		var now: Array = (workshop.map.edit_rings[0] as Dictionary).get("coords", []) if not workshop.map.edit_rings.is_empty() else []
		return not now.is_empty() and (now[0] as Array) != first, 10.0)
	var moved: Array = (workshop.map.edit_rings[0] as Dictionary).get("coords", [])
	_check("dragging a vertex moves it", not moved.is_empty() and (moved[0] as Array) != first, "%s -> %s" % [str(first), str(moved[0] if not moved.is_empty() else [])])
	var a := _ring_screen(moved, 1)
	var b := _ring_screen(moved, 2)
	await _drag_mouse((a + b) * 0.5, (a + b) * 0.5 + Vector2(18, 18))
	await _until(func() -> bool: return ((workshop.map.edit_rings[0] as Dictionary).get("coords", []) as Array).size() == before_count + 1, 10.0)
	var grown := ((workshop.map.edit_rings[0] as Dictionary).get("coords", []) as Array).size()
	_check("dragging an edge inserts a vertex", grown == before_count + 1, "%d -> %d" % [before_count, grown])
	await _shoot("ws-20-edit-vertices")
	var removed_at := _ring_screen((workshop.map.edit_rings[0] as Dictionary).get("coords", []), 2)
	await _drag_mouse(removed_at, removed_at, true)
	await _until(func() -> bool: return ((workshop.map.edit_rings[0] as Dictionary).get("coords", []) as Array).size() == grown - 1, 10.0)
	_check("Alt-click removes a vertex", ((workshop.map.edit_rings[0] as Dictionary).get("coords", []) as Array).size() == grown - 1)
	workshop.set_selection(["FRA.1_1", "FRA.13_1"])
	workshop.set_tool("border")
	workshop.zoom_to(["FRA.1_1", "FRA.13_1"], 7.0)
	await _until(func() -> bool: return workshop.map.edit_rings.size() >= 2, 10.0)
	await _wait(1.0)
	var keys := {}
	var shared_screen := Vector2(-1, -1)
	for entry in workshop.map.edit_rings:
		var row: Dictionary = entry
		if str(row.get("id", "")) != "FRA.1_1":
			continue
		for c in row.get("coords", []):
			keys["%.6f,%.6f" % [float(c[0]), float(c[1])]] = true
	var view := workshop.map.size
	for entry in workshop.map.edit_rings:
		var row: Dictionary = entry
		if str(row.get("id", "")) != "FRA.13_1":
			continue
		var list: Array = row.get("coords", [])
		for index in range(list.size()):
			var c: Array = list[index]
			if keys.has("%.6f,%.6f" % [float(c[0]), float(c[1])]):
				var local := workshop.map.screen_of(Vector2(float(c[0]), float(c[1])))
				if local.x > 80 and local.y > 80 and local.x < view.x - 360 and local.y < view.y - 80:
					shared_screen = workshop.map.global_position + local
					break
		if shared_screen.x >= 0:
			break
	_check("the two neighbours share a border vertex on screen", shared_screen.x >= 0)
	if shared_screen.x >= 0:
		var undo_before := bool((workshop.state.get("history", {}) as Dictionary).get("canUndo", false))
		await _drag_mouse(shared_screen, shared_screen + Vector2(12, 9))
		await _wait(3.0)
		await _until(func() -> bool: return not workshop._rebaking, 15.0)
		var a_keys := {}
		var shared := 0
		for entry in workshop.map.edit_rings:
			var row: Dictionary = entry
			if str(row.get("id", "")) == "FRA.1_1":
				for c in row.get("coords", []):
					a_keys["%.6f,%.6f" % [float(c[0]), float(c[1])]] = true
		for entry in workshop.map.edit_rings:
			var row: Dictionary = entry
			if str(row.get("id", "")) == "FRA.13_1":
				for c in row.get("coords", []):
					if a_keys.has("%.6f,%.6f" % [float(c[0]), float(c[1])]):
						shared += 1
		_check("a shared-border edit keeps the two regions joined", shared >= 2, "%d shared vertices, undo before %s, %d diagnostics" % [shared, str(undo_before), (workshop.map.diagnostics as Array).size()])
		await _shoot("ws-21-shared-border")
	workshop.set_tool("select")
	workshop.set_selection([])


func _city() -> void:
	workshop.set_tool("feature")
	workshop.locate(Vector2(2.35, 48.86))
	await _wait(0.6)
	var spot := workshop.map.global_position + workshop.map.size * 0.5 + Vector2(90, 70)
	var before := (workshop.state.get("features", []) as Array).size()
	await _click(spot)
	await _until(func() -> bool: return workshop._popup != null and is_instance_valid(workshop._popup), 10.0)
	var popup := workshop._popup as WorkshopPopup
	_check("a click with the City tool adds a city and opens its card", popup != null and (workshop.state.get("features", []) as Array).size() == before + 1)
	if popup:
		var edits := _find_type(popup, "LineEdit")
		if not edits.is_empty():
			var name_edit: LineEdit = edits[0]
			name_edit.text = "Testopolis"
			name_edit.text_changed.emit("Testopolis")
			await _wait(0.5)
		await _shoot("ws-5-city")
		var named := false
		for row in workshop.state.get("features", []):
			if str((row as Dictionary).get("name", "")) == "Testopolis":
				named = true
		_check("the city was named", named)
		var done := _find_button(popup, "Done")
		if done:
			done.pressed.emit()
		await _frames(3)
	workshop.set_tool("select")


func _side_panels() -> void:
	workshop.open_panel_named("war")
	await _frames(6)
	_check("the War map panel opened", workshop._panel is WorkshopWar and _find_label(workshop._panel, "Ground troops cross more slowly: mountains, marshes, a river, a crevice. Level 0 is flat ground and 10 cannot be crossed at all.") != null)
	await _shoot("ws-6-war-map")
	var made := await workshop.request("workshop.war.create", {"kind": "climate", "rings": [[[-5.0, 42.0], [8.0, 42.0], [8.0, 51.0], [-5.0, 51.0], [-5.0, 42.0]]]})
	var zone_id := str(made.get("id", ""))
	_check("a climate zone can be drawn", not zone_id.is_empty())
	if not zone_id.is_empty():
		workshop.pick_war_shape("climate", zone_id)
		await _frames(4)
		var war := workshop._panel as WorkshopWar
		war._open_season = 0
		war._render()
		await _frames(4)
		_check("the zone opens on its editor", _find_label(war, "SEASON STARTS") != null or _find_label(war, "Season starts") != null)
		await war._item(zone_id, "seasons", 0, {"fields": {"name": "Long winter"}, "effects": {"pace": 0.6}}, false)
		var zones: Array = (workshop.state.get("war", {}) as Dictionary).get("climateZones", [])
		var season: Dictionary = ((zones[0] as Dictionary).get("seasons", []) as Array)[0] if not zones.is_empty() else {}
		_check("a season's fields and effects are edited in place", str(season.get("name", "")) == "Long winter" and is_equal_approx(float((season.get("effects", {}) as Dictionary).get("pace", 0.0)), 0.6), JSON.stringify(season).left(160))
		await _frames(3)
		await _shoot("ws-6b-climate-zone")
		await workshop.request("workshop.war.remove", {"kind": "climate", "rowId": zone_id})
		_check("the zone is deleted", ((workshop.state.get("war", {}) as Dictionary).get("climateZones", []) as Array).is_empty())
	workshop.close_panel()
	await _frames(2)
	workshop.open_basemaps()
	await _wait(2.5)
	var maps := _find_overlay(WorkshopBasemaps)
	_check("the Maps window opened", maps != null and _find_label(maps, "This scenario's maps") != null)
	await _shoot("ws-7-maps")
	if maps:
		var scroller := (maps as WorkshopOverlay)._scroll
		scroller.scroll_vertical = 100000
		await _wait(1.0)
		_check("the built-in basemaps are listed", _find_label(maps, "Built-in basemaps") != null)
		await _shoot("ws-7b-maps-builtins")
		(maps as WorkshopOverlay).closed.emit()
	await _frames(3)
	await workshop.request("workshop.maps.makeStarting", {"key": "builtin:atlas-relief"})
	var restyled := await _until(func() -> bool: return str(workshop.map.map.basemap.style.get("basemapId", "")) == "atlas-relief", 10.0)
	_check("the map shows the starting basemap", restyled, str(workshop.map.map.basemap.style))
	await _wait(2.5)
	await _shoot("ws-7c-atlas-relief")
	await workshop.request("workshop.maps.makeStarting", {"key": "builtin:ocean"})
	await _until(func() -> bool: return str(workshop.map.map.basemap.style.get("basemapId", "")) == "ocean", 10.0)
	workshop.open_flag_picker("Greater Germany")
	await _wait(2.5)
	var flags := _find_overlay(WorkshopFlags)
	_check("the flag picker opened", flags != null and _find_label(flags, "Flags — Greater Germany") != null)
	await _shoot("ws-8-flags")
	if flags:
		(flags as WorkshopOverlay).closed.emit()
	await _frames(3)
	var docs_button: Button = null
	for button in _find_type(workshop._sidebar, "Button"):
		if (button as Button).tooltip_text == "Documents":
			docs_button = button
	if docs_button:
		docs_button.pressed.emit()
		await _wait(1.0)
		_check("the Documents menu opened", workshop._documents != null and _find_button(workshop._documents, "Save now") != null)
		await _shoot("ws-9-documents")
		docs_button.pressed.emit()
		await _frames(2)
	var search_edit: LineEdit = null
	for edit in _find_type(workshop._sidebar, "LineEdit"):
		if (edit as LineEdit).placeholder_text == "Search places…":
			search_edit = edit
	if search_edit:
		search_edit.grab_focus()
		search_edit.text = "Testo"
		search_edit.text_changed.emit("Testo")
		await _wait(1.2)
		_check("search finds the new city", _find_label(workshop._search, "Testopolis") != null)
		await _shoot("ws-10-search")
		search_edit.text = ""
		search_edit.text_changed.emit("")
		search_edit.release_focus()
		await _frames(2)


func _find_overlay(type: Variant) -> Node:
	for child in workshop._overlays.get_children():
		if is_instance_of(child, type):
			return child
	return null


func _save() -> void:
	workshop.persist(false, false)
	var asked := await _until(func() -> bool: return workshop._cleanup._choice != null and is_instance_valid(workshop._cleanup._choice), 10.0)
	_check("Save asks how to clean the borders", asked and _find_label(workshop._cleanup, "Clean up the borders") != null)
	await _shoot("ws-11-cleanup-choice")
	workshop._cleanup.answered.emit("quick")
	await _wait(1.5)
	await _shoot("ws-12-cleanup-progress")
	var done := await _until(func() -> bool: return workshop._busy_action.is_empty(), 240.0)
	_check("the save finished", done and not saved_details.is_empty(), str(saved_details.size()))
	var status: Dictionary = workshop.state.get("status", {})
	_check("the scenario is saved", not bool(status.get("scenarioDirty", true)))
	await _wait(0.4)
	await _shoot("ws-13-saved")


func _exit() -> void:
	var exit_button := _find_button(workshop, "Exit")
	_check("Exit is there", exit_button != null)
	if exit_button == null:
		return
	exit_button.pressed.emit()
	await _frames(3)
	_check("Exit asks first", _find_label(workshop, "Leave the map editor?") != null)
	await _shoot("ws-14-exit-question")
	var leave: Button = null
	for button in _find_type(workshop._footer, "Button"):
		if (button as Button).text == "Exit":
			leave = button
	if leave:
		leave.pressed.emit()
	await _until(func() -> bool: return closed_count > 0, 10.0)
	_check("the Workshop closed", closed_count == 1)
	await _frames(3)
	await _shoot("ws-15-closed")


func _owner_in(w: Workshop, id: String) -> String:
	var index := int(w.map.index_of.get(id, -1))
	var regions: Dictionary = w.state.get("regions", {})
	var owner_index: Array = regions.get("ownerIndex", [])
	var owners: Array = regions.get("owners", [])
	if index < 0 or index >= owner_index.size():
		return "?"
	var at := int(owner_index[index])
	return str(owners[at]) if at >= 0 and at < owners.size() else ""


func _review() -> void:
	var tiles := str(main.info.get("dataRoot", "")).path_join("native-cache").path_join("tiles")
	var second := Workshop.new()
	main.ui.add_child(second)
	var records: Array = []
	var shut := [false]
	second.review_saved.connect(func(record: Dictionary) -> void: records.append(record))
	second.closed.connect(func() -> void: shut[0] = true)
	second.setup(main.engine, {"tiles_cache": tiles})
	var suggestion := {"id": "sugg-test", "by": "Tester", "note": "The north of Spain as a new country.", "changes": [
		{"id": "polity-add:Free Spain", "area": "map", "kind": "polity-add", "key": "Free Spain", "record": {"name": "Free Spain", "aliases": ["Free Spain"], "status": "active"}, "color": [200, 90, 30], "flag": null, "tags": null},
		{"id": "region-owner:ESP.2_1", "area": "map", "kind": "region-owner", "regionId": "ESP.2_1", "regionName": "Aragón", "from": "Spain", "to": "Free Spain"},
		{"id": "region-owner:ESP.3_1", "area": "map", "kind": "region-owner", "regionId": "ESP.3_1", "regionName": "Cantabria", "from": "Spain", "to": "Free Spain"},
		{"id": "city-add:testburg@-3.70,40.40", "area": "map", "kind": "city-add", "name": "Testburg", "to": {"name": "Testburg", "coord": [-3.7, 40.4], "population": 50000, "capital": false, "tier": 1}},
	]}
	second.open({"id": "default", "name": "Modern Day"}, {"review": {"suggestion": suggestion, "decisions": {"accepted": [], "rejected": []}, "key": "sugg-test"}})
	var ready := await _until(func() -> bool: return second.hydrated and second._panel is WorkshopReview, 180.0)
	_check("a suggestion opens with its review beside the map", ready)
	if not ready:
		return
	await _wait(1.0)
	var panel := second._panel as WorkshopReview
	_check("the review lists the four changes", _find_label(panel, "0 of 4 decided") != null and _find_label(panel, "New country: Free Spain") != null and _find_label(panel, "Add the city Testburg") != null)
	_check("the sidebar offers Suggested changes", _find_label(second._sidebar, "Suggested changes") != null)
	second.zoom_to(["ESP.2_1", "ESP.3_1"], 6.0)
	await _wait(1.0)
	await _shoot("ws-16-review")
	var accept := _find_button(panel, "Accept")
	_check("each change can be accepted", accept != null)
	if accept:
		accept.pressed.emit()
		await _until(func() -> bool: return int(second.review.get("settled", 0)) >= 1, 10.0)
	_check("accepting the new country applies it", ((second.state.get("doc", {}) as Dictionary).get("polities", {}) as Dictionary).has("Free Spain"))
	var group_accept := _find_button(second._panel, "Accept")
	if group_accept:
		group_accept.pressed.emit()
		await _until(func() -> bool: return _owner_in(second, "ESP.2_1") == "Free Spain", 10.0)
	_check("accepting the ownership group moves both regions", _owner_in(second, "ESP.2_1") == "Free Spain" and _owner_in(second, "ESP.3_1") == "Free Spain", "%s %s" % [_owner_in(second, "ESP.2_1"), _owner_in(second, "ESP.3_1")])
	var reject := _find_button(second._panel, "Reject")
	if reject:
		reject.pressed.emit()
		await _until(func() -> bool: return int(second.review.get("settled", 0)) == 4, 10.0)
	_check("rejecting the city decides the last change", int(second.review.get("settled", 0)) == 4, str(second.review.get("settled", 0)))
	var undo := _find_button(second._panel, "Undo")
	_check("an acceptance can be undone", undo != null)
	await (second._panel as WorkshopReview)._focus("region-owner:ESP.3_1")
	await _wait(0.8)
	await _shoot("ws-17-review-decided")
	second.persist(false, false)
	await _until(func() -> bool: return second._cleanup._choice != null and is_instance_valid(second._cleanup._choice), 10.0)
	second._cleanup.answered.emit("quick")
	await _until(func() -> bool: return not records.is_empty(), 240.0)
	var record: Dictionary = records[0] if not records.is_empty() else {}
	_check("saving records the review", str(record.get("status", "")) == "done" and (record.get("accepted", []) as Array).size() == 3 and (record.get("rejected", []) as Array).size() == 1, JSON.stringify(record))
	await _wait(0.5)
	second.request_close(true)
	await _until(func() -> bool: return shut[0], 10.0)
	_check("the review Workshop closed", shut[0])


func _finish() -> void:
	_say("done: %d failure(s) %s" % [failures.size(), ", ".join(failures)])
	main.engine.stop()
	quit(1 if failures.size() > 0 else 0)
