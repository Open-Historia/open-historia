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
	await _reference()
	await _side_panels()
	await _save()
	await _exit()
	await _review()
	await _import()
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
		await _drag_mouse(shared_screen, shared_screen + Vector2(6, 5))
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


func _reference() -> void:
	var picture := Image.create(320, 200, false, Image.FORMAT_RGBA8)
	picture.fill(Color(0.9, 0.2, 0.2))
	for x in range(0, 320, 20):
		for y in range(200):
			picture.set_pixel(x, y, Color(1, 1, 1))
	var file := OS.get_environment("OH_NATIVE_ROOT").path_join("reference-test.png")
	picture.save_png(file)
	OS.set_environment("OH_EDITOR_PICK", "*=" + file)
	workshop.zoom_to(["FRA.8_1"], 6.0)
	await _wait(1.0)
	workshop.open_panel_named("reference")
	await _frames(4)
	var panel := workshop._panel as WorkshopReference
	_check("the Reference panel opened", panel != null and _find_button(panel, "⬆ Upload reference image") != null)
	if panel == null:
		return
	await panel._upload()
	await _frames(4)
	var reference: Dictionary = workshop.map.reference
	_check("an image is placed on the view", not reference.is_empty() and (reference.get("rect", Rect2()) as Rect2).size.x > 0.0 and _find_button(panel, "⬆ Replace image") != null)
	if reference.is_empty():
		return
	var rect: Rect2 = reference["rect"]
	var centre := workshop.map.global_position + workshop.map.map.world_to_screen(rect.get_center())
	await _drag_mouse(centre, centre + Vector2(60, 40))
	var moved: Rect2 = workshop.map.reference["rect"]
	_check("dragging inside moves the image", moved.position.distance_to(rect.position) > 0.0 and is_equal_approx(moved.size.x, rect.size.x), "%s -> %s" % [str(rect.position), str(moved.position)])
	var corner := workshop.map.global_position + workshop.map.map.world_to_screen(moved.position + moved.size)
	await _drag_mouse(corner, corner + Vector2(50, 30))
	var resized: Rect2 = workshop.map.reference["rect"]
	_check("dragging a corner resizes it", resized.size.x > moved.size.x and is_equal_approx(resized.position.x, moved.position.x), "%s -> %s" % [str(moved.size), str(resized.size)])
	var edits := _find_type(panel, "LineEdit")
	if not edits.is_empty():
		var field: LineEdit = edits[0]
		field.text = "0.7"
		field.text_changed.emit("0.7")
	_check("the opacity follows its field", is_equal_approx(float(workshop.map.reference.get("opacity", 0.0)), 0.7), str(workshop.map.reference.get("opacity")))
	await _shoot("ws-22-reference")
	workshop.close_panel()
	await _frames(3)
	_check("closing the panel ends the adjusting", not workshop.map.reference_adjust and not workshop.map.reference.is_empty())
	await _shoot("ws-23-reference-traced")
	workshop.open_panel_named("reference")
	await _frames(4)
	var remove := _find_button(workshop._panel, "Remove")
	if remove:
		remove.pressed.emit()
	await _frames(2)
	_check("Remove takes the image away", workshop.map.reference.is_empty())
	workshop.close_panel()
	OS.set_environment("OH_EDITOR_PICK", "")


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
	var done := await _until(func() -> bool: return not saved_details.is_empty(), 240.0)
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


func _answer(host: Node, starts: String) -> bool:
	var found := await _until(func() -> bool:
		for child in host.get_children():
			if child is ConfirmationDialog and (child as ConfirmationDialog).dialog_text.begins_with(starts):
				return true
		return false, 10.0)
	if not found:
		return false
	for child in host.get_children():
		if child is ConfirmationDialog and (child as ConfirmationDialog).dialog_text.begins_with(starts):
			(child as ConfirmationDialog).confirmed.emit()
	await _frames(2)
	return true


func _accept(host: Node, starts: String) -> bool:
	var found := await _until(func() -> bool:
		for child in host.get_children():
			if child is AcceptDialog and not (child is ConfirmationDialog) and (child as AcceptDialog).dialog_text.begins_with(starts):
				return true
		return false, 20.0)
	for child in host.get_children():
		if child is AcceptDialog and not (child is ConfirmationDialog) and (child as AcceptDialog).dialog_text.begins_with(starts):
			(child as AcceptDialog).confirmed.emit()
	await _frames(2)
	return found


func _library_entry(picker: WorkshopBasemaps, name: String) -> Dictionary:
	for entry in picker._data.get("mine", []):
		if str((entry as Dictionary).get("name", "")) == name:
			return entry
	return {}


func _scenario_map(picker: WorkshopBasemaps, name: String) -> Dictionary:
	for entry in picker._data.get("maps", []):
		if str((entry as Dictionary).get("name", "")) == name:
			return entry
	return {}


func _save_thumbnail(url: String, shot_name: String) -> bool:
	if not url.begins_with("data:image/jpeg;base64,"):
		return false
	var image := Image.new()
	if image.load_jpg_from_buffer(Marshalls.base64_to_raw(url.substr(23))) != OK:
		return false
	if not shots.is_empty():
		image.save_png(shots.path_join(shot_name + ".png"))
	return image.get_width() > 0


func _projection_redraw(w: Workshop) -> void:
	var maps := await w.request_raw("workshop.maps")
	var key := ""
	for entry in (maps["result"] as Dictionary).get("maps", []):
		if str((entry as Dictionary).get("name", "")) == "Old Chart":
			key = str((entry as Dictionary).get("key", ""))
	await w.request("workshop.maps.makeStarting", {"key": key})
	w.open_panel_named("projection")
	await _frames(3)
	var panel := w._panel as WorkshopProjection
	await _until(func() -> bool: return not panel._check.is_empty(), 20.0)
	var before := str(panel._options.get("pictureFile", ""))
	_check("the starting picture is known to the Projection panel", not key.is_empty() and bool(panel._options.get("hasPicture", false)) and is_equal_approx(panel._picture_aspect, 2.0), "%s %s" % [key, panel._picture_aspect])
	panel._type = "robinson"
	await panel._recheck()
	var convert := _find_button(panel, "Convert the map")
	if convert:
		convert.pressed.emit()
	await _until(func() -> bool: return panel._busy, 5.0)
	var done := await _until(func() -> bool: return not panel._busy and str((panel._options.get("current", {}) as Dictionary).get("type", "")) == "robinson", 60.0)
	var after := str(panel._options.get("pictureFile", ""))
	var aspect := panel._aspect_of(after)
	_check("converting redraws the starting picture for the new projection", done and panel._error.is_empty() and after != before and not after.is_empty() and absf(aspect - 2.0) > 0.005, "%s %s %s" % [panel._error, after.get_file(), aspect])
	await _wait(1.0)
	await _shoot("ws-35-picture-redrawn")
	panel._picture_aspect = aspect
	panel._type = "freeform"
	await panel._recheck()
	var own := _find_button(panel, "Use the picture's own shape")
	if own:
		own.pressed.emit()
		await _frames(6)
	_check("Freeform offers the picture's own shape", own != null and panel._shape == str(panel._check.get("pictureShape", "")) and not panel._shape.is_empty(), panel._shape)
	w.close_panel()


func _flag_picker(w: Workshop) -> WorkshopFlags:
	for child in w._overlays.get_children():
		if child is WorkshopFlags and not child.is_queued_for_deletion():
			return child
	return null


func _flag_community(w: Workshop, opened: String) -> void:
	var root_dir := OS.get_environment("OH_NATIVE_ROOT")
	w.open_flag_picker("France")
	await _frames(4)
	var picker := _flag_picker(w)
	await _until(func() -> bool: return not picker._catalog.is_empty(), 20.0)
	picker._set_tab("community")
	var listed := await _until(func() -> bool: return picker._community_loaded or not picker._community_error.is_empty(), 60.0)
	_check("the flag picker's Community tab lists hub flags", listed and not picker._community.is_empty() and _find_button(picker, "Use this flag") != null, picker._community_error)
	var pack_button: Button = null
	for button in _find_type(picker, "Button"):
		if (button as Button).text.begins_with("⬇ Add "):
			pack_button = button
	_check("scenario flag packs are offered", pack_button != null)
	await _wait(2.0)
	await _shoot("ws-34-flags-community")
	picker._share_form()
	await _until(func() -> bool: return FileAccess.get_file_as_string(opened).contains("template=flag.yml"), 10.0)
	_check("⬆ Share a flag opens the hub's flag form", FileAccess.get_file_as_string(opened).contains("title=%5BFlag%5D%20France%20flag"))
	var single := {}
	for entry in picker._community:
		if not bool((entry as Dictionary).get("fromScenario", false)):
			single = entry
			break
	await picker._use_post(single)
	var applied := await _until(func() -> bool:
		var flag := str(((w.state.get("doc", {}) as Dictionary).get("flags", {}) as Dictionary).get("France", ""))
		return flag.begins_with("data:image/"), 30.0)
	_check("Use this flag applies it and keeps it in My flags", applied and _flag_picker(w) == null)
	var picture := Image.create(60, 40, false, Image.FORMAT_RGB8)
	picture.fill(Color8(20, 120, 60))
	var file := root_dir.path_join("Green Banner.png")
	picture.save_png(file)
	w.open_flag_picker("Narnia")
	await _frames(4)
	picker = _flag_picker(w)
	await _until(func() -> bool: return not picker._catalog.is_empty(), 20.0)
	_check("a community flag in My flags links to its post", _find_button(picker, "Community ↗") != null)
	OS.set_environment("OH_EDITOR_PICK", "*=" + file)
	await picker._upload()
	OS.set_environment("OH_EDITOR_PICK", "")
	w.open_flag_picker("Narnia")
	await _frames(4)
	picker = _flag_picker(w)
	await _until(func() -> bool: return not picker._catalog.is_empty(), 20.0)
	var mine := {}
	for entry in picker._catalog.get("mine", []):
		if str((entry as Dictionary).get("name", "")) == "Green Banner":
			mine = entry
	picker._share({"name": "Green Banner", "polity": "Narnia", "code": "Narnia", "dataUrl": str(mine.get("dataUrl", "")), "author": ""})
	_check("⤴ shares a flag: file saved, hub form opened", not mine.is_empty() and await _accept(w, "\"green-banner.png\" was downloaded.") and FileAccess.get_file_as_string(opened).contains("Flag-Polity%3A%20Narnia"))
	var downloads := OS.get_environment("OH_NATIVE_DOWNLOADS")
	_check("the shared files are in the downloads folder", FileAccess.file_exists(downloads.path_join("green-banner.png")) and FileAccess.file_exists(downloads.path_join("old-chart.png")))
	OS.set_environment("OH_EDITOR_OPEN_LOG", "")
	picker.closed.emit()
	await _frames(2)


func _basemaps(w: Workshop) -> void:
	var root_dir := OS.get_environment("OH_NATIVE_ROOT")
	w.open_basemaps()
	await _frames(4)
	var picker: WorkshopBasemaps = null
	for child in w._overlays.get_children():
		if child is WorkshopBasemaps:
			picker = child
	_check("the Maps window opens", picker != null)
	if picker == null:
		return
	await _until(func() -> bool: return not picker._loading, 20.0)
	_check("Add basemap is offered", picker._add_button != null and not picker._add_button.disabled and picker._add_button.tooltip_text.begins_with("A basemap:"))
	var drawn := {"type": "FeatureCollection", "features": [
		{"type": "Feature", "properties": {"fill": "#2f6b3a"}, "geometry": {"type": "Polygon", "coordinates": [[[-20, 20], [40, 20], [40, 60], [-20, 60], [-20, 20]], [[0, 35], [15, 35], [15, 45], [0, 45], [0, 35]]]}},
		{"type": "Feature", "properties": {"fill": "#c9a25b"}, "geometry": {"type": "Polygon", "coordinates": [[[3, 38], [12, 38], [12, 42], [3, 42], [3, 38]]]}},
	]}
	var drawn_file := root_dir.path_join("Test Biomes.geojson")
	var out := FileAccess.open(drawn_file, FileAccess.WRITE)
	out.store_string(JSON.stringify(drawn))
	out.close()
	OS.set_environment("OH_EDITOR_PICK", "*=" + drawn_file)
	await picker._add()
	var biomes := _library_entry(picker, "Test Biomes")
	_check("a painted map joins Your basemaps and the scenario", not biomes.is_empty() and not _scenario_map(picker, "Test Biomes").is_empty() and str(picker._notice.get("text", "")) == "Added to this scenario's maps. To draw on it, make it the starting map (★).")
	_check("its card picture is drawn natively", _save_thumbnail(str(biomes.get("thumbnail", "")), "ws-29-thumb-drawn"))
	var picture := Image.create(300, 150, false, Image.FORMAT_RGB8)
	picture.fill(Color8(40, 90, 160))
	picture.fill_rect(Rect2i(100, 40, 100, 70), Color8(230, 200, 90))
	var picture_file := root_dir.path_join("Old Chart.png")
	picture.save_png(picture_file)
	OS.set_environment("OH_EDITOR_PICK", "*=" + picture_file)
	await picker._add()
	var chart := _library_entry(picker, "Old Chart")
	_check("a picture joins Your basemaps with its thumbnail", not chart.is_empty() and _save_thumbnail(str(chart.get("thumbnail", "")), "ws-30-thumb-picture") and not _scenario_map(picker, "Old Chart").is_empty())
	var kml_file := root_dir.path_join("Coast.kml")
	out = FileAccess.open(kml_file, FileAccess.WRITE)
	out.store_string("<?xml version=\"1.0\" encoding=\"UTF-8\"?><kml xmlns=\"http://www.opengis.net/kml/2.2\"><Document><Folder><Placemark id=\"p1\"><name>Isle &amp; Bay</name><Polygon><outerBoundaryIs><LinearRing><coordinates>-5,50,0 5,50,0 5,55,0 -5,55,0 -5,50,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Folder></Document></kml>")
	out.close()
	OS.set_environment("OH_EDITOR_PICK", "*=" + kml_file)
	await picker._add()
	_check("a KML map is read and added", not _library_entry(picker, "Coast").is_empty() and not _scenario_map(picker, "Coast").is_empty())
	await _shoot("ws-31-maps-added")
	var tif_file := root_dir.path_join("survey.tif")
	FileAccess.open(tif_file, FileAccess.WRITE).store_string("II*")
	OS.set_environment("OH_EDITOR_PICK", "*=" + tif_file)
	picker._add()
	_check("a GeoTIFF is refused honestly", await _accept(w, "Could not add that map: the native Workshop cannot show GeoTIFF"))
	await _until(func() -> bool: return not picker._busy, 10.0)
	OS.set_environment("OH_EDITOR_PICK", "")
	var reply := await w.request_raw("workshop.maps.deleteLibrary", {"basemapId": str(biomes.get("id", ""))})
	await picker._refresh()
	var row := _scenario_map(picker, "Test Biomes")
	_check("a scenario map missing from Your basemaps offers Save", reply.get("ok", false) and bool(row.get("canSaveToLibrary", false)) and _find_button(picker, "Save to Your basemaps") != null)
	await picker._save_to_library(row)
	var again := _library_entry(picker, "Test Biomes")
	_check("Save to Your basemaps keeps a copy with a native picture", not again.is_empty() and str(again.get("thumbnail", "")).begins_with("data:image/jpeg;base64,") and not bool(_scenario_map(picker, "Test Biomes").get("canSaveToLibrary", true)))
	await _shoot("ws-32-maps-saved")
	var opened := root_dir.path_join("opened-urls.txt")
	OS.set_environment("OH_EDITOR_OPEN_LOG", opened)
	var chart_entry := _library_entry(picker, "Old Chart")
	picker._publish(chart_entry)
	_check("⤴ shares a basemap: file saved, hub form opened", await _accept(w, "\"old-chart.png\" was downloaded.") and FileAccess.get_file_as_string(opened).contains("template=basemap.yml"))
	picker._set_tab("community")
	var listed := await _until(func() -> bool: return picker._community_loaded and picker._official_loaded and not picker._community_loading and not picker._official_loading, 60.0)
	_check("the Community tab lists the hub's maps", listed and not picker._community.is_empty() and _find_button(picker, "⬇ Install") != null and _find_label(picker, "Community maps") != null, picker._community_error)
	_check("detailed maps are offered with their size", _find_type(picker, "Button").any(func(button: Button) -> bool: return button.text.begins_with("⬇ Download (") or button.text.begins_with("✓ Downloaded")))
	await _wait(2.0)
	await _shoot("ws-33-maps-community")
	var target := {}
	for entry in picker._community:
		var post: Dictionary = entry
		if bool(post.get("installable", false)) and not bool(post.get("installed", false)) and not bool(post.get("fromScenario", false)):
			target = post
			break
	if not target.is_empty():
		await picker._install(target)
		var installed := _library_entry(picker, str(target.get("title", "")))
		_check("⬇ Install brings a community basemap into Your basemaps", picker._tab == "mine" and not installed.is_empty() and bool(installed.get("community", false)), str(target.get("title", "")))
	picker.closed.emit()
	await _frames(2)
	await _flag_community(w, opened)
	await _projection_redraw(w)


func _import() -> void:
	var tiles := str(main.info.get("dataRoot", "")).path_join("native-cache").path_join("tiles")
	var third := Workshop.new()
	main.ui.add_child(third)
	var shut := [false]
	third.closed.connect(func() -> void: shut[0] = true)
	third.setup(main.engine, {"tiles_cache": tiles})
	third.open({"id": "default", "name": "Modern Day"}, {})
	var ready := await _until(func() -> bool: return third.hydrated, 180.0)
	_check("a fresh Workshop opens for the importer", ready)
	if not ready:
		return
	var root_dir := OS.get_environment("OH_NATIVE_ROOT")
	var picture := Image.create(80, 50, false, Image.FORMAT_RGB8)
	var palette := [Color8(200, 30, 30), Color8(30, 200, 30), Color8(30, 30, 200), Color8(200, 200, 30)]
	for y in range(50):
		for x in range(80):
			picture.set_pixel(x, y, palette[(0 if x < 40 else 1) + (0 if y < 25 else 2)])
	var raster := root_dir.path_join("provinces.png")
	picture.save_png(raster)
	third.open_panel_named("province-import")
	await _frames(4)
	var panel := third._panel as WorkshopImport
	_check("the Province Map Importer opens", panel != null and _find_button(panel, "Vectorize / analyze") != null and _find_label(panel, "Geographic fit") != null)
	if panel == null:
		return
	OS.set_environment("OH_EDITOR_PICK", "*=" + raster)
	_find_button(panel, "Choose file…").pressed.emit()
	await _until(func() -> bool: return not panel.raster_file.is_empty(), 5.0)
	var edits := _find_type(panel, "LineEdit")
	var values := ["-5", "15", "52", "40"]
	for index in range(mini(4, edits.size())):
		var field: LineEdit = edits[index]
		field.text = values[index]
		field.text_changed.emit(values[index])
	await _frames(2)
	_check("the picture is laid over the map within its bounds", not third.map.import_preview.is_empty() and is_equal_approx(float((third.map.import_preview["bounds"] as Dictionary)["east"]), 15.0))
	third.zoom_to(["FRA.8_1"], 4.0)
	await _wait(1.0)
	await _shoot("ws-24-import-preview")
	_find_button(panel, "Vectorize / analyze").pressed.emit()
	var analyzed := await _until(func() -> bool: return panel.ready_regions > 0 or not panel.status.is_empty(), 60.0)
	_check("vectorizing finds the four provinces", analyzed and panel.ready_regions == 4 and int(panel.stats.get("width", 0)) == 80, "%d %s" % [panel.ready_regions, panel.status])
	_check("the progress ends on the worker's last step", str(panel.progress.get("message", "")) == "Ready: 4 regions", str(panel.progress.get("message", "")))
	await _shoot("ws-25-import-analyzed")
	var downloads := OS.get_environment("OH_NATIVE_DOWNLOADS")
	var before_backups := DirAccess.get_files_at(downloads).size() if DirAccess.dir_exists_absolute(downloads) else 0
	_find_button(panel, "Import / replace regions").pressed.emit()
	_check("Import asks first", await _answer(third, "Replace the current region geometry with 4 imported regions?"))
	var replaced := await _until(func() -> bool: return panel.status.contains("regions imported") and third.map.ids.size() == 4 and not third._rebaking, 60.0)
	_check("the map is replaced by the imported provinces", replaced, "%s %d" % [panel.status, third.map.ids.size()])
	_check("ownership is inherited by centroid", _owner_in(third, "imp-rgb-C81E1E") == "France" and panel.status.contains("inherited existing polity ownership"), _owner_in(third, "imp-rgb-C81E1E"))
	_check("a backup of the old map was written first", DirAccess.dir_exists_absolute(downloads) and DirAccess.get_files_at(downloads).size() == before_backups + 1)
	_check("the import cleared the preview and the undo", third.map.import_preview.is_empty() and not bool((third.state.get("history", {}) as Dictionary).get("canUndo", true)))
	await _wait(0.8)
	await _shoot("ws-26-imported")
	var regions := {"type": "FeatureCollection", "features": [
		{"type": "Feature", "id": "a", "properties": {"code": "A1", "owner": "France"}, "geometry": {"type": "Polygon", "coordinates": [[[0, 45], [2, 45], [2, 47], [0, 47], [0, 45]]]}},
		{"type": "Feature", "id": "b", "properties": {"code": "B1", "owner": "Narnia", "ownerColor": "#2BC1F3"}, "geometry": {"type": "Polygon", "coordinates": [[[2, 45], [4, 45], [4, 47], [2, 47], [2, 45]]]}},
		{"type": "Feature", "properties": {"markerType": "city", "name": "Probeville", "owner": "Narnia", "population": 12000}, "geometry": {"type": "Point", "coordinates": [3, 46]}},
	]}
	var geojson := root_dir.path_join("regions.geojson")
	var out := FileAccess.open(geojson, FileAccess.WRITE)
	out.store_string(JSON.stringify(regions))
	out.close()
	var meta := root_dir.path_join("regions-meta.json")
	out = FileAccess.open(meta, FileAccess.WRITE)
	out.store_string(JSON.stringify({"A1": {"region_name": "Alpha"}, "B1": {"region_name": "Beta"}, "C9": {"region_name": "Unused"}}))
	out.close()
	_find_button(panel, "Region GeoJSON + metadata").pressed.emit()
	await _frames(3)
	_check("the GeoJSON tab drops the picture", third.map.import_preview.is_empty() and _find_label(panel, "Region geometry GeoJSON") != null)
	OS.set_environment("OH_EDITOR_PICK", "*=" + geojson)
	var choosers: Array = []
	for button in _find_type(panel, "Button"):
		if (button as Button).text == "Choose file…":
			choosers.append(button)
	(choosers[0] as Button).pressed.emit()
	await _until(func() -> bool: return not panel.geojson_file.is_empty(), 5.0)
	OS.set_environment("OH_EDITOR_PICK", "*=" + meta)
	choosers.clear()
	for button in _find_type(panel, "Button"):
		if (button as Button).text == "Choose file…":
			choosers.append(button)
	(choosers[1] as Button).pressed.emit()
	await _until(func() -> bool: return not panel.metadata_file.is_empty(), 5.0)
	OS.set_environment("OH_EDITOR_PICK", "")
	_check("a metadata file opens the join options", _find_label(panel, "Metadata join") != null and _find_button(panel, "Join metadata / analyze") != null)
	_find_button(panel, "Join metadata / analyze").pressed.emit()
	await _until(func() -> bool: return panel.ready_regions > 0 or not panel.status.is_empty(), 30.0)
	_check("the join matches both regions", panel.ready_regions == 2 and int(panel.stats.get("metadataMatched", 0)) == 2 and str(panel.stats.get("metadataJoinKey", "")) == "__objectKey", "%s %s" % [panel.status, JSON.stringify(panel.stats)])
	_check("the city marker is detected", _find_label(panel, "City markers detected: 1") != null)
	_check("the join keys are listed for choosing", panel.geo_key_options.has("code") and panel.metadata_key_options.has("__objectKey"))
	await _shoot("ws-27-import-geojson")
	_find_button(panel, "Import / replace regions").pressed.emit()
	_check("Import names the city too", await _answer(third, "Replace the current region geometry with 2 imported regions?\nAlso import 1 city marker (merging with existing city markers)."))
	var joined := await _until(func() -> bool: return panel.status.contains("regions imported") and third.map.ids.size() == 2 and not third._rebaking, 60.0)
	_check("the GeoJSON regions replace the map", joined, panel.status)
	var named := third.map.region_name(int(third.map.index_of.get("a", -1))) == "Alpha" and third.map.region_name(int(third.map.index_of.get("b", -1))) == "Beta"
	_check("names come from the metadata", named)
	var polities: Dictionary = (third.state.get("doc", {}) as Dictionary).get("polities", {})
	_check("the new owner is registered", polities.has("Narnia") and _owner_in(third, "b") == "Narnia" and panel.status.contains("polities resolved/registered"))
	var city := false
	for row in third.state.get("features", []):
		if str((row as Dictionary).get("name", "")) == "Probeville":
			city = true
	_check("the city marker is imported", city and panel.status.contains("1 city markers imported"), panel.status)
	await _wait(0.6)
	await _shoot("ws-28-imported-geojson")
	third.close_panel()
	await _basemaps(third)
	third.request_close(true)
	await _until(func() -> bool: return shut[0], 20.0)
	_check("the importer's Workshop closed", shut[0])


func _finish() -> void:
	_say("done: %d failure(s) %s" % [failures.size(), ", ".join(failures)])
	main.engine.stop()
	quit(1 if failures.size() > 0 else 0)
