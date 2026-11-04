extends SceneTree

var main: Node
var shots := ""
var started := 0
var failures: PackedStringArray = []
var room: WarRoom
var button: WarRoomButton
var reports: AfterActionReports
var forces: ForcesPanel
var tilt := Vector2.ZERO


func _initialize() -> void:
	var redraw := Node2D.new()
	root.add_child(redraw)
	process_frame.connect(redraw.queue_redraw)
	shots = OS.get_environment("OH_SHOTS")
	started = Time.get_ticks_msec()
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.mouse_passthrough = true
	root.add_child(main)
	_read_tilt()
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


func _war_layers() -> WarLayers:
	for child in main.map_view.get_children():
		if child is WarLayers and (child as WarLayers).overlay != null:
			return child
	return null


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


func _clear_shell() -> void:
	var shell: ShellBoot = main.get("shell") as ShellBoot
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


func _close_notice() -> void:
	var shell: ShellBoot = main.get("shell") as ShellBoot
	if shell != null and shell.notice != null and is_instance_valid(shell.notice) and shell.notice.is_visible_in_tree():
		shell.notice.closed.emit()
		_say("update notice closed for the test")
		await _frames(3)


func _find(node: Node, kind: String) -> Array:
	var out: Array = []
	if node.is_class(kind) and (not (node is CanvasItem) or (node as CanvasItem).is_visible_in_tree()):
		out.append(node)
	for child in node.get_children():
		out.append_array(_find(child, kind))
	return out


func _mounted() -> bool:
	button = main.get("war_room_button") as WarRoomButton
	room = main.get("war_room") as WarRoom
	reports = main.get("after_action") as AfterActionReports
	forces = main.get("forces") as ForcesPanel
	_check("the app mounts the war room, its button, the reports and Forces", button != null and room != null and reports != null and forces != null)
	if room == null or button == null or reports == null or forces == null:
		return false
	await _until(func() -> bool: return room.engine != null and button.engine != null and reports.engine != null and forces.engine != null, 60.0)
	await _wait(0.5)
	return room.engine != null


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
	await room.refresh()
	await _wait(0.3)


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
	await _clear_shell()
	if not await _mounted():
		_finish(1)
		return
	if not OS.get_environment("OH_WARROOM_COMPARE").is_empty():
		await _compare()
		return
	await main._start_scenario("default")
	await _wait(0.4)
	main.picker._choose("France")
	await main._on_country_chosen("France", "medium")
	_say("game open")
	await _close_notice()
	await _wait(1.0)
	await button.refresh()
	_check("no war, no war room button", not button.visible)
	var war: Dictionary = await main.engine.request("warroom.test.war", {"fronts": [{"against": "Germany", "name": "Rhine Front", "generals": ["Pierre de Villiers", "Bruno Dary", "Elrick Irastorza"]}, {"against": "Italy", "name": "Alpine Front", "generals": ["Jean-Pierre Bosser"]}]})
	_check("a war is opened through the engine", war.get("ok", false) and not ((war.get("result", {}) as Dictionary).get("fronts", []) as Array).is_empty(), str(war.get("error", "")))
	var skip: Dictionary = await main.engine.request("skip", {"days": 7})
	_check("a week of the war is fought (stand-in skip)", skip.get("ok", false), str(skip.get("error", "")))
	await button.refresh()
	_check("the war room button shows at war", button.visible)
	await _shoot("wr-00-button")
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
	_check("a route drawn becomes a planned movement", await _until(func() -> bool: return _shows(room, "Route"), 10.0), room._notice)
	await _shoot("wr-08-route")
	room.store.take_tool("diversion")
	var feint: Array = []
	for step in range(12):
		feint.append(start + Vector2(-step * 8.0, step * 5.0))
	await _draw_way(feint)
	await _settled()
	_check("a diversion is planned", await _until(func() -> bool: return _shows(room, "Diversion") and _shows(room, "You have turned no agent of theirs"), 10.0), room._notice)
	room.store.take_tool("deploy")
	await _wait(0.3)
	_check("the deploy hint reads as React's", _shows(room.rail, "As many come as your men, supplies, war weariness and mustering allow, called up inside your country.") and not _shows(room.rail, "Formations to call up"))
	_check("no box asks how many to call up", _find(room.rail, "LineEdit").is_empty())
	await _shoot("wr-09-deploy-tool")
	var line: Array = []
	for step in range(10):
		line.append(start + Vector2(-40.0 + step * 2.0, -60.0 + step * 14.0))
	await _draw_way(line)
	await _settled()
	var deployed := await _until(func() -> bool: return _shows(room, "Deployment line") and _shows(room, "Fresh formations come in here when time next passes"), 10.0)
	_check("a deployment line is drawn", deployed, room._notice)
	if not deployed:
		_dump("planned", room._sections)
	await _shoot("wr-10-deployed")
	room.store.take_tool("fortify")
	var wall: Array = []
	for step in range(10):
		wall.append(_screen_of([6.05 + step * 0.03, 49.0 - step * 0.11]))
	await _draw_way(wall)
	_check("a drawn line waits on the fortify plate", await _until(func() -> bool: return room.plates._fortify.visible and _shows(room.plates, "FORTIFIED LINE") and _shows(room.plates, "to build"), 15.0))
	await _shoot("wr-11-fortify-plate")
	room.plates.line_name = "Ligne Moselle"
	await _idle()
	await room._build_line("Ligne Moselle")
	await _wait(0.6)
	_check("the line is ordered built", _shows(room, "FORTIFIED LINES") and _shows(room, "Ligne Moselle"), room._notice)
	await _shoot("wr-12-line-built")
	room.store.set_values({"draft": null})
	await _idle()
	var operation: Dictionary = await main.engine.request("warroom.test.operation", {"name": "Operation Black Forest", "summary": "Strike across the Rhine at Saarbrucken, Karlsruhe, Freiburg im Breisgau, Kaiserslautern, Trier, Mannheim and Stuttgart."})
	_check("an operation is put on the Board", operation.get("ok", false), str(operation.get("error", "")))
	await room.refresh()
	await _wait(0.6)
	var plan_points: Array = []
	for plan in room._record.get("mapPlans", []):
		if str((plan as Dictionary).get("name", "")) == "Operation Black Forest":
			for plan_way in (plan as Dictionary).get("ways", []):
				plan_points.append_array(plan_way)
	_check("the operation is a planned movement with a way", not plan_points.is_empty())
	main.map_view.fly_to_lonlat(6.185, 48.5, 8.0, 0.0)
	await _wait(0.8)
	room.map_layer.queue_redraw()
	await _frames(3)
	_check("the fortified line is named along it at zoom 8", "Ligne Moselle" in room.map_layer.last_labels, ", ".join(room.map_layer.last_labels))
	await _shoot("wr-12b-line-label")
	if not plan_points.is_empty():
		var west := 180.0
		var south := 90.0
		var east := -180.0
		var north := -90.0
		for point in plan_points:
			west = minf(west, float(point[0]))
			east = maxf(east, float(point[0]))
			south = minf(south, float(point[1]))
			north = maxf(north, float(point[1]))
		main.map_view.fit_lonlat_bounds([[west - 0.3, south - 0.3], [east + 0.3, north + 0.3]], 8.0, 0.0)
		await _wait(0.8)
		room.map_layer.queue_redraw()
		await _frames(3)
	_check("the operation is named on its arrow", "Operation Black Forest" in room.map_layer.last_labels, ", ".join(room.map_layer.last_labels))
	await _shoot("wr-12c-plan-label")
	await _frames(3)
	var room_rects: Array[Rect2] = room.map_layer.label_rects
	_check("the War Room publishes where its names stand", not room_rects.is_empty() and main.map_view.room_label_rects == room_rects, "%d boxes" % room_rects.size())
	var clashes := 0
	for room_box in room_rects:
		for other in room.map_layer._war_seen:
			if room_box.intersects(other):
				clashes += 1
	_check("no War Room name stands over a war label placed before it", clashes == 0, "%d clashes with %d war labels" % [clashes, room.map_layer._war_seen.size()])
	var city_clashes := 0
	for room_box in main.map_view.room_label_rects:
		for other in main.map_view.city_label_rects:
			if room_box.intersects(other):
				city_clashes += 1
	_check("city names yield to the War Room's names", city_clashes == 0, "%d clashes, %d city names shown" % [city_clashes, main.map_view.city_label_rects.size()])
	var saved: Array[Rect2] = main.map_view.war_label_rects.duplicate()
	var war_layers := _war_layers()
	var held: Array[Node] = []
	if war_layers:
		held = [war_layers, war_layers.overlay]
	for node in held:
		node.set_process(false)
	var cover: Array[Rect2] = [Rect2(Vector2(-10000, -10000), Vector2(20000, 20000))]
	main.map_view.war_set_label_rects(cover)
	if war_layers:
		war_layers.overlay._layout_dirty = false
	room.map_layer.queue_redraw()
	await _frames(2)
	_check("a War Room name over a war label placed before it is hidden", room.map_layer.last_labels.is_empty(), ", ".join(room.map_layer.last_labels))
	for node in held:
		node.set_process(true)
	main.map_view.war_set_label_rects(saved)
	if war_layers:
		war_layers.overlay.redraw_base()
	room.map_layer.queue_redraw()
	await _frames(2)
	_check("the names come back when the war label goes", "Operation Black Forest" in room.map_layer.last_labels, ", ".join(room.map_layer.last_labels))
	main.map_view.fly_to_lonlat(6.185, 48.5, 8.0, 0.0)
	await _wait(0.8)
	await _shoot("wr-12d-line-label-collide")
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
	var carried := await _until(func() -> bool: return _shows(room, "TRANSPORTERS") or not room._notice.is_empty(), 10.0)
	_check("a transporter is ordered", carried and _shows(room, "TRANSPORTERS"), room._notice)
	if not carried:
		_dump("planned", room._sections)
	await _shoot("wr-15-transport")
	await _aircraft(start)
	await _home_forces()
	room._sections_scroll.scroll_vertical = 100000
	await _wait(0.3)
	await _shoot("wr-16-drawer-bottom")
	var esc := InputEventKey.new()
	esc.keycode = KEY_ESCAPE
	esc.pressed = true
	room._input(esc)
	await _wait(0.6)
	_check("Esc shuts the room", not room.is_open() and main.hud.visible)
	await _frames(3)
	_check("a shut room gives the city names their room back", main.map_view.room_label_rects.is_empty())
	await _shoot("wr-17-closed")
	var report: Dictionary = await main.engine.request("warroom.test.report", {"battlefield": "Rhine Front", "name": "Ardennes Front"})
	_check("a closed battlefield is set up for its report", report.get("ok", false) and bool(report.get("result", false)), str(report.get("error", "")))
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
	await forces.set_open(true)
	await _wait(0.6)
	_check("the Forces panel lists units", _shows(forces, "Your units (") and _shows(forces, "Deploy a unit"))
	var spins: Array = _find(forces, "SpinBox")
	var strength: SpinBox = spins[0] if not spins.is_empty() else null
	_check("strength is a number box from 1 to 100", strength != null and strength.min_value == 1.0 and strength.max_value == 100.0 and strength.step == 1.0)
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
	_check("the button shows in the game at war", button.visible)
	await _peace_terms()
	var dropped: Dictionary = await main.engine.request("warroom.test.home", {"drop": true})
	_check("the forces built up for the test are taken off again", dropped.get("ok", false), str(dropped.get("error", "")))
	await button.refresh()
	var accepted := 0
	for attempt in range(4):
		var offer: Dictionary = await main.engine.request("warroom.test.offer")
		var made: Dictionary = offer.get("result", {}) if offer.get("ok", false) else {}
		if str(made.get("id", "")).is_empty():
			break
		await main.hud.war_cards._answer("accept", str(made["id"]))
		accepted += 1
	_check("an offer of peace is accepted from its card", accepted > 0)
	var gone := await _until(func() -> bool: return not button.visible, 20.0)
	var fronts_left: Dictionary = await main.engine.request("warroom.fronts")
	_check("the War Room button for a war ended in peace goes away at once", gone and not bool((fronts_left.get("result", {}) as Dictionary).get("atWar", true)), str(fronts_left.get("result", {})))
	await _shoot("wr-22-peace")
	await main._exit_game()
	await _wait(0.5)
	await button.refresh()
	await _frames(3)
	_check("leaving the game hides the war room button", main.menu.visible and not button.visible)
	main._refresh_war_parts()
	await _wait(1.0)
	_check("a refresh on the menu does not bring it back", not button.visible)
	_say("done: %d failure(s)" % failures.size())
	for failure in failures:
		_say("  failed: " + failure)
	_finish(0 if failures.is_empty() else 1)


func _aircraft(start: Vector2) -> void:
	var made: Dictionary = await main.engine.request("warroom.test.wing", {"name": "Escadre de chasse 2/30", "lng": 6.2, "lat": 48.7})
	_check("an air unit of the player's is put on the map", made.get("ok", false), str(made.get("error", "")))
	await room.refresh()
	await _wait(0.5)
	var air: Dictionary = room._record.get("air", {})
	_check("the war room lists the air unit and its reach", (air.get("wings", []) as Array).size() > 0 and float(air.get("reach", 0)) > 0.0 and float(air.get("blast", 0)) > 0.0, JSON.stringify(air).left(300))
	_check("the rail has the Aircraft key", _shows(room.rail, "AIRCRAFT"))
	room.rail.aircraft_toggled.emit()
	await _wait(0.6)
	_check("the Aircraft key puts out the Deploy Aircraft plate", room.plates._aircraft.visible and _shows(room.plates, "DEPLOY AIRCRAFT") and _shows(room.plates, "Escadre de chasse 2/30") and _shows(room.plates, "It reaches") and _shows(room.plates, "TROOPS") and _shows(room.plates, "STRUCTURE") and _shows(room.plates, "CITY") and _shows(room.plates, "CHOOSE TARGET"))
	_check("the first air unit is picked out", not str(room.store.value("wing")).is_empty())
	await _shoot("wr-15a-aircraft-plate")
	room.plates.aim.emit()
	await _wait(0.3)
	_check("Choose target takes up the aircraft tool", str(room.store.value("tool")) == "aircraft" and _shows(room.rail, "Click what the air unit is to strike. Its bombs fall inside the ring, on your own troops there too. Drag to move the map.") and _shows(room.plates, "CANCEL"))
	var aim_at := start + Vector2(30.0, -20.0)
	var motion := InputEventMouseMotion.new()
	motion.position = aim_at
	room.map_layer._gui_input(motion)
	await _frames(3)
	_check("a ring the size of where the bombs fall follows the pointer", room.map_layer._aim is Vector3 and float((room.map_layer._aim as Vector3).z) >= 4.0, str(room.map_layer._aim))
	await _shoot("wr-15b-aircraft-aim")
	await _idle()
	room.map_layer._press(aim_at, false)
	room.map_layer._release(aim_at)
	await _settled()
	air = room._record.get("air", {})
	_check("a click orders the strike", (air.get("orders", []) as Array).size() == 1 and _shows(room, "AIR STRIKES") and _shows(room, "Flies when time next passes.") and _shows(room.plates, "Ordered to strike"), room._notice)
	_check("the tool is put down after the click", str(room.store.value("tool")) == "pan")
	await _shoot("wr-15c-aircraft-ordered")
	var wing := str(room.store.value("wing"))
	await _idle()
	room.plates.call_off.emit(wing)
	await _settled()
	air = room._record.get("air", {})
	_check("Call off takes the strike back", (air.get("orders", []) as Array).is_empty(), room._notice)
	room.store.set_values({"strike_kind": "city"})
	room.plates.aim.emit()
	await _wait(0.2)
	var city_at := _screen_of([6.99, 49.23]) + Vector2(6, 4)
	await _idle()
	room.map_layer._press(city_at, false)
	room.map_layer._release(city_at)
	await _settled()
	air = room._record.get("air", {})
	var orders: Array = air.get("orders", [])
	_check("a city strike is sent at the enemy city nearest the click", orders.size() == 1 and not str((orders[0] as Dictionary).get("target", "")).is_empty(), "%s / %s" % [JSON.stringify(orders), room._notice])
	room.store.set_values({"strike_kind": "troops"})
	if orders.is_empty():
		room.plates.aim.emit()
		await _wait(0.2)
		await _idle()
		room.map_layer._press(aim_at, false)
		room.map_layer._release(aim_at)
		await _settled()
	var flown_skip: Dictionary = await main.engine.request("skip", {"days": 7})
	_check("a week passes with the strike waiting", flown_skip.get("ok", false), str(flown_skip.get("error", "")))
	await room.refresh()
	await _wait(0.8)
	air = room._record.get("air", {})
	var flown: Array = air.get("flown", [])
	_check("the strike is flown when time passes and the drawer says what came of it", not flown.is_empty() and (air.get("orders", []) as Array).is_empty(), JSON.stringify(flown).left(400))
	if not flown.is_empty():
		var said := WarRoomWords.strike_outcome(flown[0])
		_check("what the strike came to is in the drawer and on the plate", _shows(room, said) and _shows(room.plates, "LAST STRIKE"), said)
		_check("the war room map rings where it struck", not (air.get("struck", []) as Array).is_empty())
	room._sections_scroll.scroll_vertical = 100000
	await _wait(0.3)
	await _shoot("wr-15d-aircraft-flown")
	room._sections_scroll.scroll_vertical = 0
	room.plates.aircraft_close.emit()
	await _wait(0.2)
	_check("Close puts the plate away", not room.plates._aircraft.visible)


func _home_forces() -> void:
	var made: Dictionary = await main.engine.request("warroom.test.home", {"battlefield": "Rhine Front", "home": true})
	var home := str(made.get("result", ""))
	_check("forces at home are built up (test record)", made.get("ok", false) and not home.is_empty(), str(made))
	var peace: Dictionary = await main.engine.request("warroom.test.home", {"battlefield": "Rhine Front", "home": false})
	var standing := str(peace.get("result", ""))
	_check("forces built up on a border in peace (test record)", peace.get("ok", false) and not standing.is_empty(), str(peace))
	await room.refresh()
	await _wait(0.5)
	_check("the war room has a tab for each", _shows(room._tabs_row, home.to_upper()) and _shows(room._tabs_row, standing.to_upper()))
	room.store.show_battlefield(home, 0)
	await _until(func() -> bool: return room._name() == home, 15.0)
	await _wait(0.8)
	_check("the frame says forces at home", room._bar_sides.text == "FRANCE · FORCES AT HOME", room._bar_sides.text)
	_check("at home there is no front to go forward or back from, nor an enemy to deceive", not _shows(room.rail, "ADVANCE") and not _shows(room.rail, "FALL BACK") and not _shows(room.rail, "DIVERSION") and _shows(room.rail, "DIG IN") and _shows(room.rail, "DEPLOY"))
	_check("in peace Withdraw is Stand down", _shows(room.rail, "STAND DOWN") and not _shows(room.rail, "WITHDRAW"))
	await _shoot("wr-15e-forces-at-home")
	var layers := _war_layers()
	if layers:
		await layers.refresh()
		await _wait(1.5)
		var names: Array = []
		for entry in layers._entries:
			names.append(str(entry["name"]))
		_check("the map draws forces built up in peace", home.to_lower() in names, ", ".join(names))
	room.store.show_battlefield(standing, 0)
	await _until(func() -> bool: return room._name() == standing, 15.0)
	await _wait(0.8)
	_check("the frame says built up in peace", room._bar_sides.text.ends_with(" · BUILT UP IN PEACE") and room._bar_sides.text.contains(" AGAINST "), room._bar_sides.text)
	_check("on a border in peace the front's keys stay", _shows(room.rail, "ADVANCE") and _shows(room.rail, "DIVERSION") and _shows(room.rail, "STAND DOWN"))
	await _shoot("wr-15f-built-up-in-peace")
	var fronts: Dictionary = await main.engine.request("warroom.fronts")
	var result: Dictionary = fronts.get("result", {})
	_check("forces built up in peace keep the button, and the war is still a war", bool(result.get("atWar", false)) and bool(result.get("fighting", false)), str(result))
	room.store.show_battlefield("Rhine Front", 0)
	await _until(func() -> bool: return room._name() == "Rhine Front", 15.0)
	await _wait(0.6)


func _peace_terms() -> void:
	var asked: Dictionary = await main.engine.request("chat.peace", {"chatId": "", "messageIds": [], "counterpart": "Germany", "player": "France"})
	var info: Dictionary = asked.get("result", {})
	var labels: Array = []
	for choice in info.get("countryChoices", []):
		labels.append(str((choice as Dictionary).get("label", "")))
	_check("the terms of peace offer what becomes of their country", labels == ["Their country stays independent", "We annex all of their country", "Their country becomes our puppet state", "Their country becomes our protectorate", "Their country becomes our client state"], ", ".join(labels))
	var war: Dictionary = info.get("war", {}) if info.get("war") is Dictionary else {}
	if str(war.get("id", "")).is_empty():
		_check("a war to make peace in", false, str(info))
		return
	var put: Dictionary = await main.engine.request("country.answer", {"op": "propose", "ref": str(war["id"]), "territory": "as held", "money": "they-light", "theirs": "Germany", "country": "satellite", "cede": "Saarland, Rhineland-Palatinate", "ours": "", "more": "Germany disarms west of the Rhine", "chatId": "native-peace-test", "messageId": "native-peace-test-msg"})
	var answer: Dictionary = put.get("result", {}) if put.get("ok", false) else {}
	var terms := str(answer.get("terms", ""))
	_check("terms on any terms are put", bool(answer.get("ok", false)) and terms.contains("Saarland") and terms.contains("puppet state") and terms.contains("Germany disarms west of the Rhine"), "%s %s" % [terms, str(answer.get("said", put.get("error", "")))])
	var shown: Dictionary = await main.engine.request("chat.peace", {"chatId": "native-peace-test", "messageIds": ["native-peace-test-msg"], "counterpart": "Germany", "player": "France"})
	var lines: Array = []
	for offer in (shown.get("result", {}) as Dictionary).get("offers", []):
		lines.append_array((offer as Dictionary).get("terms", []))
	_check("the offer card says every term", "Ceded to France: Saarland, Rhineland-Palatinate." in lines and "Germany becomes France's puppet state." in lines and "And:" in lines and "- Germany disarms west of the Rhine" in lines, " | ".join(lines))


func _compare() -> void:
	await main._open_game(OS.get_environment("OH_WARROOM_COMPARE"))
	await _close_notice()
	await _wait(2.0)
	await button.refresh()
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


func _read_tilt() -> void:
	var spec := OS.get_environment("OH_MAP_TILT").split(",", false)
	if spec.size() >= 2:
		tilt = Vector2(float(spec[0]), float(spec[1]))
		process_frame.connect(_keep_tilt)


func _keep_tilt() -> void:
	var view: Variant = main.get("map_view") if main != null and is_instance_valid(main) else null
	if not (view is MapView):
		return
	var map := view as MapView
	if map.extras_ready() and map.extras != null and is_zero_approx(map.pitch) and is_zero_approx(map.bearing):
		map.pitch = tilt.x
		map.bearing = tilt.y
		map.call("_after_camera_move")
