extends SceneTree

var main: Node
var shots := ""
var started := 0
var war: WarLayers
var picked := ""
var failures: PackedStringArray = []
var tilt := Vector2.ZERO


func _initialize() -> void:
	shots = OS.get_environment("OH_SHOTS")
	started = Time.get_ticks_msec()
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.mouse_passthrough = true
	root.add_child(main)
	_read_tilt()
	_run.call_deferred()


func _say(text: String) -> void:
	print("[warmap %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _check(label: String, ok: bool, detail := "") -> void:
	_say("%s %s%s" % ["ok  " if ok else "FAIL", label, ("  (" + detail + ")") if not detail.is_empty() else ""])
	if not ok:
		failures.append(label)


func _wait(seconds: float) -> void:
	await create_timer(seconds).timeout


func _frames(count: int) -> void:
	for i in range(count):
		await process_frame


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


func _shoot(name: String) -> void:
	for i in range(4):
		await process_frame
	await RenderingServer.frame_post_draw
	if shots.is_empty():
		return
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(name + ".png"))
	_say("screenshot " + name)


func _call(method: String, args := {}) -> Dictionary:
	var reply: Dictionary = await main.engine.request(method, args)
	if not reply.get("ok", false):
		_say("%s failed: %s" % [method, str(reply.get("error", ""))])
	return reply


func _sync_map() -> void:
	await main._world_changed()


func _skip(days: int) -> void:
	var began := Time.get_ticks_msec()
	var reply := await _call("skip", {"days": days})
	_check("a %d-day skip lands" % days, reply.get("ok", false), "%d ms" % (Time.get_ticks_msec() - began))
	await _sync_map()


func _extras() -> Node:
	return main.get("map_extras") as Node


func _flood() -> Object:
	var extras := _extras()
	var flood: Variant = extras.get("flood") if extras else null
	return flood as Object if flood is Object else null


func _flood_token() -> int:
	var flood := _flood()
	return int(flood.get("_token")) if flood else -1


func _flood_mode() -> String:
	var flood := _flood()
	return str(flood.get("last_mode")) if flood else ""


func _flooding() -> bool:
	var flood := _flood()
	return flood != null and bool(flood.call("busy"))


func _patch(image: Image, centre: Vector2, half: int) -> Color:
	var sum := Color(0, 0, 0, 0)
	var count := 0
	for y in range(int(centre.y) - half, int(centre.y) + half):
		for x in range(int(centre.x) - half, int(centre.x) + half):
			if x >= 0 and y >= 0 and x < image.get_width() and y < image.get_height():
				sum += image.get_pixel(x, y)
				count += 1
	return sum / float(maxi(count, 1))


func _painted_world() -> Vector2:
	for run in war.paint.have_runs():
		var field: WarPaint.Field = war.paint.field(str(run))
		if field == null or not field.shown or field.viewport == null:
			continue
		var image := field.viewport.get_texture().get_image()
		var width := image.get_width()
		var height := image.get_height()
		var best := Vector2.INF
		var nearest := INF
		for y in range(0, height, 3):
			for x in range(0, width, 3):
				if image.get_pixel(x, y).a < 0.98:
					continue
				var ok := true
				for d in [Vector2i(-6, 0), Vector2i(6, 0), Vector2i(0, -6), Vector2i(0, 6)]:
					var step: Vector2i = d
					var px: int = x + step.x
					var py: int = y + step.y
					if px < 0 or py < 0 or px >= width or py >= height or image.get_pixel(px, py).a < 0.98:
						ok = false
						break
				if not ok:
					continue
				var distance := Vector2(x - width * 0.5, y - height * 0.5).length()
				if distance < nearest:
					nearest = distance
					best = Vector2(x + 0.5, y + 0.5)
		if best != Vector2.INF:
			return field.rect.position + Vector2(best.x / width * field.rect.size.x, best.y / height * field.rect.size.y)
	return Vector2.INF


func _paint_shows(label: String, shot: String, unlit := false) -> void:
	var spot := _painted_world()
	if spot == Vector2.INF:
		_check(label, false, "no painted pixel found")
		return
	main.map_view.camera.position = spot
	main.map_view.camera.zoom = Vector2.ONE * pow(2.0, 8.6) / 8.0
	main.map_view.call("_after_camera_move")
	var light: CanvasLayer = null
	if unlit:
		var globe_view: Variant = _extras().get("globe")
		var layer: Variant = (globe_view as Object).get("_light_layer") if globe_view is Object else null
		if layer is CanvasLayer:
			light = layer
			light.visible = false
	await _wait(2.0)
	var at: Vector2 = main.map_view.world_to_screen(spot)
	await _shoot(shot)
	var with_paint := _patch(root.get_viewport().get_texture().get_image(), at, 4)
	for node in war.paint._copy_nodes:
		(node as CanvasItem).visible = false
	await _frames(4)
	await RenderingServer.frame_post_draw
	var without := _patch(root.get_viewport().get_texture().get_image(), at, 4)
	war.paint._sync_visibility()
	if light:
		light.visible = true
	var gap_colour := maxf(absf(with_paint.r - without.r), maxf(absf(with_paint.g - without.g), absf(with_paint.b - without.b)))
	_check(label, gap_colour > 0.03, "%s painted, %s without the paint" % [with_paint.to_html(false), without.to_html(false)])


func _globe_pass() -> void:
	var extras := _extras()
	if extras == null or not extras.has_method("apply_map_settings"):
		_check("the globe can be switched on", false)
		return
	extras.call("apply_map_settings", {"Globe": true, "map_disable_idle_rotation": true})
	await _frames(3)
	await _focus([[1.5, 46.5], [10.0, 51.0]], 6.3)
	await _wait(1.0)
	var target: Variant = war.overlay.unit_positions.get("native-test-fr-5", null)
	var gap := INF
	if target is Vector2:
		var expected: Vector2 = main.map_view.world_to_screen(target)
		for item in war.overlay._unit_hits:
			var hit: Array = item
			if str(hit[2]) == "native-test-fr-5":
				gap = minf(gap, (hit[0] as Vector2).distance_to(expected))
	_check("the war overlay follows the globe", main.map_view.is_globe() and war.overlay.globe and gap < 1.0, "%.2f px off" % gap)
	await _shoot("w13-globe-z6")
	await _focus([[6.6, 48.9], [8.0, 49.7]], 8.6)
	await _wait(1.0)
	await _shoot("w14-globe-z8")
	await _focus([[-25.0, 30.0], [40.0, 65.0]], 2.6)
	await _wait(1.0)
	await _shoot("w15-globe-far")
	await _paint_shows("painted ground is drawn on the globe", "w16-globe-paint", true)
	extras.call("apply_map_settings", {"Globe": false})
	await _frames(3)
	await _wait(0.5)


func _focus(bounds: Array, level: float) -> void:
	main.map_view.fit_lonlat_bounds(bounds, level, 0.0)
	await _wait(0.4)


func _run() -> void:
	while not main.menu.visible:
		if Time.get_ticks_msec() - started > 90000:
			_say("FAIL the menu never appeared")
			_finish(1)
			return
		await process_frame
	await _clear_shell()
	await main._start_scenario("default")
	main.picker._choose("France")
	await main._on_country_chosen("France", "medium")
	await _wait(1.0)
	war = main.get("war") as WarLayers
	var mounted: int = (main.map_view.get_children() as Array).filter(func(node: Node) -> bool: return node is WarLayers).size()
	_check("the app mounts one set of war layers", war != null and mounted == 1 and main.hud.date_widget.get("war") == war, "%d mounted" % mounted)
	if war == null:
		_finish(1)
		return
	war.unit_selected.connect(func(id: String) -> void: picked = id)
	_check("the war map reads a game at peace", war._state.has("fronts"), "%d fronts, %d units" % [(war._state.get("fronts", []) as Array).size(), (war._state.get("units", []) as Array).size()])
	await _call("warmap.test.seed", {"a": "France", "b": "Germany", "phase": "war"})
	await _sync_map()
	await _focus([[1.0, 41.0], [12.0, 52.5]], 5.2)
	await _shoot("w0-units-before-war")
	_check("units are drawn as counters", (war.overlay.units as Array).size() >= 6, "%d counters" % (war.overlay.units as Array).size())
	await _skip(7)
	var fronts: Array = war._state.get("fronts", [])
	_check("the engine opened a battlefield", fronts.size() > 0, ", ".join(PackedStringArray(fronts.map(func(front: Dictionary) -> String: return str(front.get("title", ""))))))
	await _focus([[4.0, 47.0], [10.5, 51.5]], 6.0)
	await _wait(0.5)
	await _shoot("w1-front-7days")
	await _skip(30)
	fronts = war._state.get("fronts", [])
	var painted := 0
	for front in fronts:
		var field: WarPaint.Field = war.paint.field(str((front as Dictionary).get("run", "")))
		if field and field.has_bounds:
			painted += 1
	_check("a 30-day run has painted ground", painted > 0, "%d painted" % painted)
	_check("the new run plays", war.playing())
	var play_token := _flood_token()
	await _focus([[4.5, 47.5], [10.0, 51.0]], 6.3)
	await _wait(1.2)
	await _shoot("w2-playing")
	while war.playing():
		await process_frame
	await _wait(0.6)
	_check("front playback queues no conquest flood", _flood_token() == play_token, "%d started while playing" % (_flood_token() - play_token))
	await _shoot("w3-played-z6")
	_check("troops are drawn", (war.overlay.troops as Array).size() > 0 or (war.overlay.sides as Array).size() > 0, "%d troops, %d sides" % [(war.overlay.troops as Array).size(), (war.overlay.sides as Array).size()])
	await _focus([[6.6, 48.9], [8.0, 49.7]], 8.6)
	await _wait(0.8)
	await _shoot("w4-troops-z8")
	await _focus([[5.0, 48.0], [9.5, 50.5]], 7.0)
	await _wait(0.8)
	await _shoot("w5-arrows-z7")
	await _paint_shows("painted ground is drawn on the map", "w5b-paint-z8")
	await _call("warmap.test.seed", {"a": "France", "b": "Germany", "phase": "extras", "gone": 120})
	var german: Dictionary = await _call("warmap.test.regions", {"owner": "Germany", "near": [10.5, 51.5]})
	var french: Dictionary = await _call("warmap.test.regions", {"owner": "France", "near": [5.6, 48.7]})
	var group_regions: Array = (german.get("result", []) as Array).slice(0, 3)
	var claimants := {}
	for id in (french.get("result", []) as Array).slice(0, 2):
		claimants[str(id)] = ["Germany"]
	await _call("warmap.test.groups", {"group": "Rhine Liberation Front", "regions": group_regions, "claimants": claimants})
	await _sync_map()
	var voyage: Array = [false]
	var watch := func(_info: Dictionary) -> void:
		if not war._transport_moves.is_empty():
			voyage[0] = true
	war.state_applied.connect(watch)
	await _call("warmap.test.seed", {"a": "France", "b": "Germany", "phase": "extras", "gone": 640})
	await _sync_map()
	war.state_applied.disconnect(watch)
	_check("a transporter's voyage plays", bool(voyage[0]))
	await _focus([[-3.0, 46.5], [12.0, 56.5]], 5.4)
	await _wait(0.4)
	await _shoot("w6-seas-transport-groups")
	war.replay_strikes("native-test-event")
	await _wait(2.2)
	await _focus([[1.0, 47.0], [10.5, 51.5]], 5.6)
	await _shoot("w7-strike")
	await _wait(1.2)
	await _shoot("w8-strike-later")
	await _focus([[5.0, 48.5], [8.5, 50.5]], 7.6)
	await _wait(0.5)
	await _shoot("w9-markers-z7")
	await _focus([[3.4, 47.6], [6.4, 49.6]], 6.4)
	await _wait(0.6)
	await _shoot("w9b-disputed-air-wing")
	await _close_notice()
	var unit_id := ""
	var target := Vector2.ZERO
	for item in war.overlay._unit_hits:
		var hit: Array = item
		if str(hit[2]) == "native-test-fr-5":
			unit_id = str(hit[2])
			target = hit[0]
			break
	if not unit_id.is_empty():
		var press := InputEventMouseButton.new()
		press.button_index = MOUSE_BUTTON_LEFT
		press.pressed = true
		press.position = target
		press.global_position = target
		root.get_viewport().push_input(press)
		var release := InputEventMouseButton.new()
		release.button_index = MOUSE_BUTTON_LEFT
		release.pressed = false
		release.position = target
		release.global_position = target
		root.get_viewport().push_input(release)
		await _until(func() -> bool: return not picked.is_empty(), 2.0)
	_check("clicking a counter selects its unit", not unit_id.is_empty() and picked == unit_id, "%s -> %s" % [unit_id, picked])
	var cards: Node = main.hud.map_cards
	await _until(func() -> bool: return cards != null and bool(cards.call("is_card_open")), 5.0)
	_check("the unit's card opens", cards != null and bool(cards.call("is_card_open")) and str(cards.get("_floating_kind")) == "unit", str(cards.get("_floating_key")) if cards else "")
	await _shoot("w9d-unit-card")
	if cards:
		cards.call("dismiss_all")
	await _globe_pass()
	var pfalz: Dictionary = await _call("warmap.test.regions", {"owner": "Germany", "near": [7.6, 49.4]})
	await _focus([[6.4, 48.6], [9.4, 50.4]], 7.2)
	await _until(func() -> bool: return not _flooding(), 8.0)
	var before_conquest := _flood_token()
	await _call("warmap.test.owner", {"ids": (pfalz.get("result", []) as Array).slice(0, 2), "owner": "France"})
	await war.refresh()
	await _wait(0.2)
	await _shoot("w9c-conquest-flood")
	await _until(func() -> bool: return not _flooding(), 8.0)
	await _wait(0.5)
	var floods := _flood_token() - before_conquest
	_check("one conquest floods exactly once", floods == 1 and _flood_mode() == "flood", "%d run(s), %s" % [floods, _flood_mode()])
	main.hud.set_map_mode("diplomatic", true)
	await main.hud._apply_map_mode()
	await _wait(1.2)
	_check("the map mode toggle reaches the war layers", war.mode == "diplomatic")
	await _focus([[4.5, 47.5], [10.0, 51.0]], 6.3)
	await _wait(0.5)
	await _shoot("w10-diplomatic")
	main.hud.set_map_mode("political", true)
	await main.hud._apply_map_mode()
	await _wait(1.0)
	var dates: Node = main.hud.date_widget
	await dates.call("load_history")
	dates.set("visible_count", 1)
	dates.call("open_events")
	await _until(func() -> bool: return bool(war._state.get("staged", false)), 8.0)
	var through := str((war._stage as Dictionary).get("through", "")) if war._stage is Dictionary else ""
	_check("the Events panel stages the reveal", bool(war._state.get("staged", false)), "through %s" % through)
	await _shoot("w11-staged-1")
	await main._world_changed()
	await _wait(0.6)
	_check("a world change keeps the staged reveal", bool(war._state.get("staged", false)))
	while war.playing():
		await process_frame
	dates.call("reveal_all")
	await _until(func() -> bool: return war._stage == null and not bool(war._state.get("staged", true)), 8.0)
	var shown_events := "%s of %d events shown" % [str(dates.get("visible_count")), ((dates.get("latest") as Dictionary).get("events", []) as Array).size()]
	_check("revealing every event ends the staging", war._stage == null and not bool(war._state.get("staged", true)), shown_events)
	await _shoot("w12-unstaged")
	dates.call("close_panels")
	_say("done with %d failure(s): %s" % [failures.size(), ", ".join(failures)])
	_finish(0 if failures.is_empty() else 1)


func _finish(code: int) -> void:
	await _wait(1.0)
	main.engine.stop()
	await _wait(0.5)
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
