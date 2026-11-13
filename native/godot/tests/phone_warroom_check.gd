extends SceneTree

var main: Node
var shots := ""
var started := 0
var failures: PackedStringArray = []
var room: WarRoom
var button: WarRoomButton


func _initialize() -> void:
	var redraw := Node2D.new()
	root.add_child(redraw)
	process_frame.connect(redraw.queue_redraw)
	shots = OS.get_environment("OH_SHOTS")
	started = Time.get_ticks_msec()
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.add_child(main)
	_run.call_deferred()


func _say(text: String) -> void:
	print("[phone_warroom %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _wait(seconds: float) -> void:
	await create_timer(seconds).timeout


func _frames(count: int) -> void:
	for i in range(count):
		await process_frame


func _shoot(name: String) -> void:
	await _frames(4)
	await RenderingServer.frame_post_draw
	if shots.is_empty():
		return
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(name + ".png"))
	_say("screenshot " + name)


func _check(ok: bool, what: String) -> void:
	_say(("PASS " if ok else "FAIL ") + what)
	if not ok:
		failures.append(what)


func _finish(code: int) -> void:
	_say("done: %d failure(s) %s" % [failures.size(), ", ".join(failures)])
	main.engine.stop()
	quit(code)


func _until(test: Callable, seconds: float) -> bool:
	var until := Time.get_ticks_msec() + int(seconds * 1000.0)
	while Time.get_ticks_msec() < until:
		if test.call():
			return true
		await process_frame
	return bool(test.call())


func _screen_rect(control: Control) -> Rect2:
	return control.get_global_transform_with_canvas() * Rect2(Vector2.ZERO, control.size)


func _texts(node: Node, out: PackedStringArray) -> void:
	if node is CanvasItem and not (node as CanvasItem).is_visible_in_tree():
		return
	if node is Label:
		out.append((node as Label).text)
	elif node is Button:
		out.append((node as Button).text)
	elif node is RichTextLabel:
		out.append((node as RichTextLabel).get_parsed_text())
	elif node is TextEdit:
		out.append((node as TextEdit).placeholder_text)
	for child in node.get_children():
		_texts(child, out)


func _shows(node: Node, text: String) -> bool:
	var found: PackedStringArray = []
	_texts(node, found)
	for entry in found:
		if entry.find(text) >= 0:
			return true
	return false


func _clear_shell() -> void:
	var shell := main.get("shell") as ShellBoot
	if shell == null:
		return
	await _wait(1.0)
	var setup: Variant = shell.get("first_setup")
	if setup is FirstSetup and is_instance_valid(setup):
		(setup as FirstSetup).finished.emit()
		await _wait(0.8)
	if shell.door_state == "deciding":
		await _until(func() -> bool: return shell.door_state != "deciding", 60.0)
	if shell.door != null and is_instance_valid(shell.door):
		shell.door.opened.emit()
		await _until(func() -> bool: return shell.door == null, 10.0)
	if not shell.notice_updates.is_empty():
		await _until(func() -> bool: return shell.notice != null and is_instance_valid(shell.notice), 5.0)
		if shell.notice != null and is_instance_valid(shell.notice):
			shell.notice.closed.emit()
	await _wait(0.5)


func _run() -> void:
	await process_frame
	_check(UI.phone(), "the phone layout is on")
	if not await _until(func() -> bool: return main.menu.visible, 120.0):
		_check(false, "the menu appeared")
		_finish(1)
		return
	await _clear_shell()
	button = main.get("war_room_button") as WarRoomButton
	room = main.get("war_room") as WarRoom
	if room == null or button == null:
		_check(false, "the war room and its button are mounted")
		_finish(1)
		return
	await _until(func() -> bool: return room.engine != null and button.engine != null, 60.0)
	await main._start_scenario("default")
	await _wait(3.0)
	main.picker._choose("France")
	await _wait(1.0)
	await main._on_country_chosen("France", "medium")
	await _wait(3.0)
	var war: Dictionary = await main.engine.request("warroom.test.war", {"fronts": [{"against": "Germany", "name": "Rhine Front", "generals": ["Pierre de Villiers", "Bruno Dary", "Elrick Irastorza"]}]})
	_check(war.get("ok", false), "a test war is opened")
	var skip: Dictionary = await main.engine.request("skip", {"days": 7})
	_check(skip.get("ok", false), "a week of it is fought")
	await button.refresh()
	await _wait(1.0)
	await _shoot("pw-00-button")
	button.pressed.emit()
	await _until(func() -> bool: return not room._record.is_empty(), 20.0)
	await _wait(1.6)
	await _sheet()
	await _map()
	await _back()
	_finish(0 if failures.is_empty() else 1)


func _sheet() -> void:
	var view := root.get_visible_rect().size
	var rect := _screen_rect(room._drawer_panel)
	_check(absf(rect.position.x) < 1.0 and absf(rect.size.x - view.x) < 1.0, "the War Room covers the phone's whole width (%s)" % str(rect))
	_check(absf(rect.position.y) < 1.0 and absf(rect.size.y - view.y) < 1.0, "the War Room covers the phone's whole height")
	_check(not room._bar.visible and not room._strip_left.visible and not room._strip_bottom.visible, "no frame round the map on a phone")
	_check(not room._handle.visible, "no resize edge on a phone")
	_check(not room.rail.visible, "the troop tools are out of sight while the sheet covers the map")
	_check(_shows(room, "WAR ROOM") and _shows(room._head_sides, "France against Germany"), "the head says War Room over France against Germany")
	_check(room._map_key.is_visible_in_tree() and room._map_key.text == "MAP", "the head has the Map key")
	for key in [room._map_key, room._fit_key, room._close_key]:
		var size: Vector2 = (key as Control).size
		_check(size.x >= UI.PHONE_TAP - 0.5 and size.y >= UI.PHONE_TAP - 0.5, "%s is a 44 px target (%s)" % [(key as Control).tooltip_text if (key as Button).text.is_empty() else (key as Button).text, str(size)])
	_check(_shows(room._status_holder, "RHINE FRONT"), "the battlefield's name heads the notice")
	_check(_shows(room._status_holder, "Nothing moves here: orders are carried out when time next passes. The troop tools are beside the map: press Map to use them."), "the notice says the tools are beside the map")
	_check(_shows(room, "YOUR GENERALS") and _shows(room, "Pierre de Villiers"), "the generals are listed")
	_check(_shows(room, "Speak to your generals. Tell them what you want done"), "the talk's empty state")
	var input_rect := _screen_rect(room._talk_input)
	_check(input_rect.end.y <= view.y + 0.5 and input_rect.end.y > view.y - 80.0, "the composer sits at the foot of the screen (%s)" % str(input_rect))
	var sections := _screen_rect(room._sections_panel)
	_check(sections.size.y <= rect.size.y * 0.44 + 2.0, "the lists take at most 44%% of the sheet (%s)" % str(sections))
	await _shoot("pw-01-sheet")
	room._sections_scroll.scroll_vertical = int(room._sections_scroll.get_v_scroll_bar().max_value)
	await _wait(0.4)
	await _shoot("pw-02-sheet-p2")
	_check(_shows(room, "REHEARSE THE NEXT WEEK") and _shows(room, "WHAT IS KNOWN OF THEIRS"), "the planned movements and what is known of theirs follow")
	room._sections_scroll.scroll_vertical = 0
	await _wait(0.3)


func _map() -> void:
	var view := root.get_visible_rect().size
	var inset := UI.safe_insets()
	room._map_key.pressed.emit()
	await _wait(0.8)
	_check(room._folded, "Map folds the sheet down to the map")
	_check(room._map_key.text == "GENERALS", "the key then reads Generals")
	var drawer := _screen_rect(room._drawer_panel)
	_check(absf(drawer.end.y - view.y) < 1.0 and drawer.size.y < view.y * 0.4, "the folded sheet sits at the foot of the screen (%s)" % str(drawer))
	_check(not room._sections_panel.is_visible_in_tree() and not room._talk_panel.is_visible_in_tree(), "the lists and the talk fold away")
	_check(_shows(room._status_holder, "The troop tools are on the left of the map."), "the notice then says the tools are on the left of the map")
	_check(room.rail.visible, "the troop tools come out")
	var plate := _screen_rect(room.rail._plate)
	_check(absf(plate.position.y - (inset.y + 0.6 * 16.0)) < 1.0, "the rail starts 0.6rem under the top (%s)" % str(plate))
	_check(plate.end.y <= drawer.position.y - 0.5 * 16.0 + 1.0, "the rail ends above the folded sheet (%s over %s)" % [str(plate), str(drawer)])
	_check(int(room.store.value("cover")) == 0, "the sheet is not counted as covering the map's side")
	await _shoot("pw-03-map")
	var generals: Array = room._record.get("generals", [])
	var first: Dictionary = generals[0] if not generals.is_empty() else {}
	room.store.set_values({"selected": first.get("troops", []), "highlight": 0})
	room.store.take_tool("route")
	await _wait(0.6)
	var hint := _screen_rect(room.rail._hint)
	_check(room.rail._hint.visible and absf(hint.position.y - (inset.y + 0.6 * 16.0 + 3.4 * 16.0)) < 1.0, "the tool's hint stands 3.4rem under the rail's top (%s)" % str(hint))
	_check(hint.end.x <= view.x + 0.5, "the hint fits the phone's width")
	await _shoot("pw-04-route")
	room.store.take_tool("pan")
	room.store.set_values({"selected": []})
	var fleets: Array = room._record.get("fleets", [])
	if not fleets.is_empty():
		room.store.set_values({"fleets": true})
		await _wait(0.6)
		var plate_rect := _screen_rect(room.plates._fleets)
		_check(absf(plate_rect.end.y - (view.y - 7.5 * 16.0 - inset.w)) < 1.5, "the fleets' plate stands 7.5rem over the foot (%s)" % str(plate_rect))
		_check(plate_rect.size.y <= view.y - 13.0 * 16.0 + 1.0, "the fleets' plate is at most the screen less 13rem")
		await _shoot("pw-05-fleets")
		room.store.set_values({"fleets": false})
	await _aircraft(view, inset)
	await _carriers(view)
	room._map_key.pressed.emit()
	await _wait(0.6)
	_check(not room._folded and room._sections_panel.is_visible_in_tree() and not room.rail.visible, "Generals brings the sheet back over the map")


func _find_class(node: Node, kind: String, found: Array) -> Array:
	if node.is_class(kind) and (node as CanvasItem).is_visible_in_tree():
		found.append(node)
	for child in node.get_children():
		_find_class(child, kind, found)
	return found


func _aircraft(view: Vector2, inset: Vector4) -> void:
	var air: Dictionary = room._record.get("air", {})
	if not bool(air.get("on", true)) or (air.get("wings", []) as Array).is_empty():
		_say("no air units in the test war: the aircraft plate is not shown")
		return
	room.store.set_values({"aircraft": true, "fleets": false})
	await _wait(0.8)
	var plate := room.plates.get("_aircraft") as Control
	if plate == null or not plate.is_visible_in_tree():
		_check(false, "the aircraft plate comes out beside the rail")
		return
	var r := _screen_rect(plate)
	_check(absf(r.end.y - (view.y - 7.5 * 16.0 - inset.w)) < 1.5, "the aircraft plate stands 7.5rem over the foot (%s)" % str(r))
	_check(r.end.x <= view.x + 0.5, "the aircraft plate fits the phone's width")
	var sliders := _find_class(plate, "HSlider", []).filter(func(node: Node) -> bool: return node.has_meta("strike_radius"))
	_check(not sliders.is_empty(), "the plate has the strike radius slider")
	if not sliders.is_empty():
		var slider := sliders[0] as HSlider
		_check(_screen_rect(slider).end.x <= r.end.x + 0.5 and slider.size.x > 100.0, "the slider fits the plate (%s)" % str(_screen_rect(slider)))
		_check(_shows(plate, "Smaller is deadlier; wider touches more, each less."), "the slider's hint is beside it")
	await _shoot("pw-07-aircraft")
	room.store.set_values({"aircraft": false})
	await _wait(0.4)


func _carriers(view: Vector2) -> void:
	var carriers: Array = room._record.get("carriers", [])
	var own: Array = room._record.get("ownTroops", [])
	if carriers.is_empty() or own.is_empty():
		_say("no carriers in the test war")
		return
	room.store.set_values({"selected": own.slice(0, mini(own.size(), 30))})
	await _wait(0.4)
	room.rail.choosing = true
	room.rail._render()
	await _wait(0.5)
	var menu := room.rail.get("_carriers") as Control
	_check(menu != null and menu.is_visible_in_tree(), "Transport opens the carriers")
	if menu:
		var r := _screen_rect(menu)
		_check(r.end.x <= view.x + 0.5 and r.position.x >= 0.0, "the carriers fit the phone's width (%s)" % str(r))
		_check(r.end.y <= view.y + 0.5, "the carriers fit the phone's height")
	var air_row: Dictionary = {}
	for entry in carriers:
		if str((entry as Dictionary).get("medium", "")) == "air":
			air_row = entry
	if not air_row.is_empty() and str(air_row.get("bar", "")).is_empty():
		_check(_shows(room.rail, "%d formations at most ·" % int(air_row.get("most", 0))), "an airlift says how many it takes at most")
	await _shoot("pw-08-carriers")
	room.rail.choosing = false
	room.rail._render()
	room.store.set_values({"selected": []})
	await _wait(0.3)


func _back() -> void:
	room._map_key.pressed.emit()
	await _wait(0.5)
	main.phone_shell.back()
	await _frames(6)
	await _wait(0.6)
	_check(not room.is_open(), "Back closes the War Room")
	_check(main.hud.visible, "the HUD comes back")
	await _shoot("pw-06-closed")
