extends SceneTree

var main: Node
var shots := ""
var started := 0
var failures: PackedStringArray = []
var room: WarRoom
var button: WarRoomButton
var reports: AfterActionReports
var forces: ForcesPanel
var opened_chat := ""


func _initialize() -> void:
	shots = OS.get_environment("OH_SHOTS")
	started = Time.get_ticks_msec()
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.add_child(main)
	_run.call_deferred()


func _say(text: String) -> void:
	print("[warroom_check %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _check(label: String, ok: bool, detail := "") -> void:
	_say("%s %s%s" % ["PASS" if ok else "FAIL", label, "" if detail.is_empty() else "  (" + detail + ")"])
	if not ok:
		failures.append(label)


func _frames(count: int) -> void:
	for i in range(count):
		await process_frame


func _wait(seconds: float) -> void:
	await create_timer(seconds).timeout


func _shoot(name: String) -> void:
	await _frames(4)
	await RenderingServer.frame_post_draw
	if shots.is_empty():
		return
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(name + ".png"))
	_say("screenshot " + name)


func _texts(node: Node, out: PackedStringArray) -> void:
	if node is CanvasItem and not (node as CanvasItem).is_visible_in_tree():
		return
	if node is Label:
		out.append((node as Label).text)
	elif node is Button:
		out.append((node as Button).text)
	elif node is RichTextLabel:
		out.append((node as RichTextLabel).get_parsed_text())
	elif node is LineEdit:
		out.append((node as LineEdit).placeholder_text)
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


func _dump(label: String, node: Node) -> void:
	var found: PackedStringArray = []
	_texts(node, found)
	_say("%s: %s" % [label, " | ".join(found).replace("\n", " / ")])


func _until(condition: Callable, seconds: float) -> bool:
	var deadline := Time.get_ticks_msec() + int(seconds * 1000.0)
	while Time.get_ticks_msec() < deadline:
		if condition.call():
			return true
		await process_frame
	return bool(condition.call())


func _screen_of(place: Array) -> Vector2:
	return main.map_view.world_to_screen(MapView.CityLayer.ohproject(float(place[0]), float(place[1])))


func _idle() -> void:
	for attempt in range(240):
		var reply: Dictionary = await main.engine.request("warroom.busy")
		if reply.get("ok", false) and not bool(reply.get("result", false)) and not room._acting:
			return
		await _wait(0.25)


func _settled() -> void:
	await _until(func() -> bool: return not room._acting, 60.0)
	await _wait(0.6)


func _draw_way(points: Array) -> void:
	await _idle()
	var layer := room.map_layer
	layer._press(points[0], false)
	for index in range(1, points.size()):
		layer._move(points[index])
		await process_frame
	layer._release(points[points.size() - 1])


func _own_screen_points() -> Array:
	var points: Array = []
	for place in room._record.get("standing", []):
		if place is Array:
			points.append(_screen_of(place))
	return points


func _run() -> void:
	while not main.menu.visible:
		if Time.get_ticks_msec() - started > 120000:
			_say("FAIL the menu never appeared")
			_finish(1)
			return
		await process_frame
	_say("menu ready")
	if not OS.get_environment("OH_WARROOM_COMPARE").is_empty():
		await _compare()
		return
	await main._start_scenario("default")
	await _wait(0.4)
	main.picker._choose("France")
	await main._on_country_chosen("France", "medium")
	_say("game open")
	await _wait(1.0)
	button = WarRoomButton.new()
	main.ui.add_child(button)
	button.setup(main.engine)
	await button.refresh()
	_check("no war, no war room button", not button.visible)
	var war: Dictionary = await main.engine.request("warroom.test.war", {"fronts": [{"against": "Germany", "name": "Rhine Front", "generals": ["Pierre de Villiers", "Bruno Dary", "Elrick Irastorza"]}, {"against": "Italy", "name": "Alpine Front", "generals": ["Jean-Pierre Bosser"]}]})
	_check("a war is opened through the engine", war.get("ok", false) and not ((war.get("result", {}) as Dictionary).get("fronts", []) as Array).is_empty(), str(war.get("error", "")))
	var skip: Dictionary = await main.engine.request("skip", {"days": 7})
	_check("a week of the war is fought (stand-in skip)", skip.get("ok", false), str(skip.get("error", "")))
	await button.refresh()
	_check("the war room button shows at war", button.visible)
	await _shoot("wr-00-button")
	room = WarRoom.new()
	main.ui.add_child(room)
	await room.setup(main.engine, {"map_view": main.map_view})
	room.shown_changed.connect(func(open: bool) -> void:
		main.hud.visible = not open
		button.set_room_open(open))
	room.open_chat.connect(func(country: String) -> void: opened_chat = country)
	button.pressed.connect(room.toggle)
	button.pressed.emit()
	await _until(func() -> bool: return not room._record.is_empty(), 20.0)
	await _wait(1.6)
	_check("the room opens on the battlefield", room._name() == "Rhine Front", room._name())
	_check("the HUD is out of sight", not main.hud.visible)
	_check("the head says War Room", _shows(room, "WAR ROOM"))
	_check("the generals are listed", _shows(room, "YOUR GENERALS") and _shows(room, "Pierre de Villiers"))
	_check("the status line reads as React's", _shows(room, "Nothing moves here: orders are carried out when time next passes. The troop tools are on the left of the map."))
	_check("planned movements empty state", _shows(room, "None. A route you draw, an order a general takes, and an operation on your Board that sends troops at a place here all show on the map as arrows."))
	_check("what is known of theirs", _shows(room, "WHAT IS KNOWN OF THEIRS"))
	_check("weather ahead", _shows(room, "WEATHER AHEAD"))
	_check("the talk's empty state", _shows(room, "Speak to your generals. Tell them what you want done"))
	_check("a tab a battlefield", room._tabs_holder.visible and _shows(room._tabs_row, "RHINE FRONT") and _shows(room._tabs_row, "ALPINE FRONT"))
	_dump("drawer", room._drawer)
	await _shoot("wr-01-open")
	room.store.set_values({"highlight": 0})
	var generals: Array = room._record.get("generals", [])
	var first: Dictionary = generals[0] if not generals.is_empty() else {}
	room.store.set_values({"selected": first.get("troops", []), "highlight": 0})
	await _wait(0.4)
	_check("picking a general's troops counts them on the rail", _shows(room.rail, "%d picked out." % (first.get("troops", []) as Array).size()))
	await _shoot("wr-02-picked")
	await _idle()
	await room._order_picked("dig in")
	await _wait(0.5)
	_check("an order lands on the general", _shows(room, "Ordered: Dig in"), room._notice)
	_check("the order is a planned movement", _shows(room, "PICK ITS TROOPS") and _shows(room, "CALL IT OFF"))
	await _shoot("wr-03-ordered")
	room._talk_input.text = "Hold the line along the Moselle and dig in."
	room._on_talk_changed()
	await _idle()
	await room._say(room._talk_input.text)
	await _wait(0.5)
	_check("the generals answer (stand-in)", _shows(room, "We can hold the river line"), str(room._failure))
	_check("the order they took is said", _shows(room, "Carried out when time next passes."))
	await _shoot("wr-04-talk")
	await _idle()
	await room._rehearse()
	await _until(func() -> bool: return str(room._rehearsal.get("status", "")) != "running", 30.0)
	_check("the week is rehearsed", str(room._rehearsal.get("status", "")) in ["done", "nothing"], str(room._rehearsal))
	await _wait(0.4)
	if room.rehearsal_tray:
		room._sections_scroll.ensure_control_visible(room.rehearsal_tray)
	await _wait(0.2)
	_check("the rehearsal says what the week comes to", _shows(room, "with your orders as they stand"))
	await _shoot("wr-05-rehearsed")
	room._sections_scroll.scroll_vertical = 0
	room.store.show_battlefield("Alpine Front", 0)
	await _until(func() -> bool: return room._name() == "Alpine Front", 15.0)
	await _wait(0.8)
	_check("a tab shows its own battlefield", room._name() == "Alpine Front" and _shows(room, "Jean-Pierre Bosser"))
	await _shoot("wr-05b-second-front")
	room.store.show_battlefield("Rhine Front", 0)
	await _until(func() -> bool: return room._name() == "Rhine Front", 15.0)
	await _wait(0.8)
	room.store.set_values({"supply": true})
	await _wait(1.0)
	_check("the supply key says what it shades", _shows(room.rail, "Supply: your ground in amber is stretched"))
	await _shoot("wr-06-supply")
	room.store.set_values({"supply": false, "selected": []})
	room.store.take_tool("select")
	await _wait(0.2)
	var points := _own_screen_points()
	var box := Rect2(points[0] if not points.is_empty() else Vector2(600, 400), Vector2.ZERO)
	for point in points:
		box = box.expand(point)
	box = box.grow(12.0)
	await _draw_way([box.position, box.position + box.size * 0.5, box.end])
	await _wait(0.2)
	var picked: Array = room.store.value("selected")
	_check("a box dragged on the map picks troops out", picked.size() > 0, "%d picked" % picked.size())
	room.store.set_values({"selected": picked.slice(0, mini(6, picked.size()))})
	room.store.take_tool("route")
	await _wait(0.2)
	await _shoot("wr-07-route-tool")
	var start: Vector2 = points[0] if not points.is_empty() else Vector2(600, 400)
	var way: Array = []
	for step in range(12):
		way.append(start + Vector2(step * 9.0, -step * 4.0))
	await _draw_way(way)
	await _settled()
	_check("a route drawn becomes a planned movement", _shows(room, "Route"), room._notice)
	await _shoot("wr-08-route")
	room.store.take_tool("diversion")
	var feint: Array = []
	for step in range(12):
		feint.append(start + Vector2(-step * 8.0, step * 5.0))
	await _draw_way(feint)
	await _settled()
	_check("a diversion is planned", _shows(room, "Diversion") and _shows(room, "You have turned no agent of theirs"), room._notice)
	room.store.take_tool("deploy")
	await _wait(0.3)
	_check("the deploy hint reads as React's", _shows(room.rail, "Formations to call up") and _shows(room.rail, "Empty calls up as many as a usual draft; 0 calls up none."))
	await _shoot("wr-09-deploy-tool")
	var line: Array = []
	for step in range(10):
		line.append(start + Vector2(-40.0 + step * 2.0, -60.0 + step * 14.0))
	await _draw_way(line)
	await _settled()
	_check("a deployment line is drawn", _shows(room, "Deployment line") and _shows(room, "Fresh formations come in here when time next passes"), room._notice)
	await _shoot("wr-10-deployed")
	room.store.take_tool("fortify")
	var wall: Array = []
	for step in range(10):
		wall.append(_screen_of([6.05 + step * 0.03, 49.0 - step * 0.11]))
	await _draw_way(wall)
	await _wait(1.0)
	_check("a drawn line waits on the fortify plate", room.plates._fortify.visible and _shows(room.plates, "FORTIFIED LINE") and _shows(room.plates, "to build"))
	await _shoot("wr-11-fortify-plate")
	room.plates.line_name = "Ligne Moselle"
	await _idle()
	await room._build_line("Ligne Moselle")
	await _wait(0.6)
	_check("the line is ordered built", _shows(room, "FORTIFIED LINES") and _shows(room, "Ligne Moselle"), room._notice)
	await _shoot("wr-12-line-built")
	room.store.set_values({"draft": null})
	room.store.set_values({"fleets": true})
	await _wait(0.6)
	_check("the fleets plate commands a fleet", room.plates._fleets.visible and _shows(room.plates, "POSTURE") and _shows(room.plates, "BLOCKADE A COUNTRY"))
	await _shoot("wr-13-fleets")
	var fleets: Array = room._record.get("fleets", [])
	if not fleets.is_empty():
		await _idle()
		await room._order_with("warroom.fleet", {"op": "posture", "unit": str((fleets[0] as Dictionary).get("id", "")), "posture": "holding"})
		await _wait(0.4)
		var after: Array = room._record.get("fleets", [])
		_check("a posture order is written", not after.is_empty() and str((after[0] as Dictionary).get("posture", "")) == "holding", room._notice)
	room.store.set_values({"fleets": false})
	room.store.set_values({"selected": picked.slice(0, mini(4, picked.size()))})
	room.rail.choosing = true
	room.rail._render()
	await _wait(0.3)
	_check("the carriers menu offers what carries troops", _shows(room.rail, "CARRY THE") and _shows(room.rail, "BY RAIL"))
	await _shoot("wr-14-carriers")
	room.rail.choosing = false
	room.store.take_tool("transport", {"medium": "land"})
	var target := start + Vector2(-160.0, -40.0)
	await _idle()
	room.map_layer._press(target, false)
	room.map_layer._release(target)
	await _settled()
	_check("a transporter is ordered", _shows(room, "TRANSPORTERS"), room._notice)
	await _shoot("wr-15-transport")
	room._sections_scroll.scroll_vertical = 100000
	await _wait(0.3)
	await _shoot("wr-16-drawer-bottom")
	var esc := InputEventKey.new()
	esc.keycode = KEY_ESCAPE
	esc.pressed = true
	room._input(esc)
	await _wait(0.6)
	_check("Esc shuts the room", not room.is_open() and main.hud.visible)
	await _shoot("wr-17-closed")
	var report: Dictionary = await main.engine.request("warroom.test.report", {"battlefield": "Rhine Front", "name": "Ardennes Front"})
	_check("a closed battlefield is set up for its report", report.get("ok", false) and bool(report.get("result", false)), str(report.get("error", "")))
	reports = AfterActionReports.new()
	main.ui.add_child(reports)
	reports.setup(main.engine)
	await reports.refresh()
	await _wait(0.6)
	_check("the report of a war just over is put before the player", reports.is_showing() and _shows(reports, "AFTER-ACTION REPORT") and _shows(reports, "TURNING POINTS") and _shows(reports, "WHAT EACH SIDE CAME TO"))
	_dump("report", reports)
	await _shoot("wr-18-report")
	await reports._close()
	await _wait(0.4)
	_check("once read it is not put before the player again", not reports.is_showing())
	await reports.open_report("Ardennes Front")
	await _wait(0.4)
	_check("the report opens again when asked", reports.is_showing())
	await reports._close()
	forces = ForcesPanel.new()
	main.ui.add_child(forces)
	forces.setup(main.engine, {"map_view": main.map_view})
	await forces.set_open(true)
	await _wait(0.6)
	_check("the Forces panel lists units", _shows(forces, "Your units (") and _shows(forces, "Deploy a unit"))
	await _shoot("wr-19-forces")
	forces.deploy_name = "1re Brigade"
	forces._start_deploy()
	await _wait(0.3)
	_check("placing says so", forces.is_placing() and _shows(forces, "Click the map to place your unit"))
	await _shoot("wr-20-forces-placing")
	await forces.place_at(main.map_view.world_to_screen(MapView.CityLayer.ohproject(2.35, 48.85)))
	await _wait(0.5)
	await forces.set_open(true)
	await _wait(0.5)
	_check("the unit is placed (pending)", _shows(forces, "1re Brigade"))
	await _shoot("wr-21-forces-placed")
	forces.close()
	await _wait(0.2)
	_say("done: %d failure(s)" % failures.size())
	for failure in failures:
		_say("  failed: " + failure)
	_finish(0 if failures.is_empty() else 1)


func _compare() -> void:
	await main._open_game(OS.get_environment("OH_WARROOM_COMPARE"))
	await _wait(2.0)
	button = WarRoomButton.new()
	main.ui.add_child(button)
	button.setup(main.engine)
	await button.refresh()
	room = WarRoom.new()
	main.ui.add_child(room)
	await room.setup(main.engine, {"map_view": main.map_view})
	room.shown_changed.connect(func(open: bool) -> void:
		main.hud.visible = not open
		button.set_room_open(open))
	button.pressed.connect(room.toggle)
	button.pressed.emit()
	await _until(func() -> bool: return not room._record.is_empty(), 20.0)
	await _wait(2.5)
	await _shoot("cmp-01-open")
	room._sections_scroll.scroll_vertical = 100000
	await _wait(0.4)
	await _shoot("cmp-02-drawer-bottom")
	room._sections_scroll.scroll_vertical = 0
	var generals: Array = room._record.get("generals", [])
	if generals.size() > 1:
		room.store.set_values({"selected": (generals[1] as Dictionary).get("troops", []), "highlight": 1})
	await _wait(0.4)
	await _shoot("cmp-03-picked")
	room.store.set_values({"selected": []})
	room.store.take_tool("deploy")
	await _wait(0.4)
	await _shoot("cmp-04-deploy-hint")
	room.store.take_tool("pan")
	room.store.set_values({"supply": true})
	await _wait(1.0)
	await _shoot("cmp-05-supply")
	room.store.set_values({"supply": false})
	await room._rehearse()
	await _until(func() -> bool: return str(room._rehearsal.get("status", "")) != "running", 30.0)
	await _wait(0.5)
	await _shoot("cmp-06-rehearsed")
	room.close()
	await _wait(0.6)
	reports = AfterActionReports.new()
	main.ui.add_child(reports)
	reports.setup(main.engine)
	await reports.refresh()
	await _wait(0.8)
	if reports.is_showing():
		await _shoot("cmp-07-report")
	_finish(0)


func _finish(code: int) -> void:
	main.engine.stop()
	for i in range(2):
		await process_frame
	quit(code)
