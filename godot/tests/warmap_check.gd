extends SceneTree

var main: Node
var shots := ""
var started := 0
var war: WarLayers
var picked := ""
var failures: PackedStringArray = []


func _initialize() -> void:
	shots = OS.get_environment("OH_SHOTS")
	started = Time.get_ticks_msec()
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.add_child(main)
	_run.call_deferred()


func _say(text: String) -> void:
	print("[warmap %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _check(label: String, ok: bool, detail := "") -> void:
	_say("%s %s%s" % ["ok  " if ok else "FAIL", label, ("  (" + detail + ")") if not detail.is_empty() else ""])
	if not ok:
		failures.append(label)


func _wait(seconds: float) -> void:
	await create_timer(seconds).timeout


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
	var state := await _call("map.state")
	if state.get("ok", false):
		main.map_view.set_state(state["result"])
	await war.refresh()


func _skip(days: int) -> void:
	var began := Time.get_ticks_msec()
	var reply := await _call("skip", {"days": days})
	_check("a %d-day skip lands" % days, reply.get("ok", false), "%d ms" % (Time.get_ticks_msec() - began))
	await _sync_map()


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
	await main._start_scenario("default")
	main.picker._choose("France")
	await main._on_country_chosen("France", "medium")
	await _wait(1.0)
	war = WarLayers.new()
	war.setup(main.engine, main.map_view)
	war.unit_selected.connect(func(id: String) -> void: picked = id)
	await war.refresh()
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
	await _focus([[4.5, 47.5], [10.0, 51.0]], 6.3)
	await _wait(1.2)
	await _shoot("w2-playing")
	while war.playing():
		await process_frame
	await _wait(0.6)
	await _shoot("w3-played-z6")
	_check("troops are drawn", (war.overlay.troops as Array).size() > 0 or (war.overlay.sides as Array).size() > 0, "%d troops, %d sides" % [(war.overlay.troops as Array).size(), (war.overlay.sides as Array).size()])
	await _focus([[6.2, 48.6], [8.6, 50.0]], 8.2)
	await _wait(0.8)
	await _shoot("w4-troops-z8")
	await _focus([[5.0, 48.0], [9.5, 50.5]], 7.0)
	await _wait(0.8)
	await _shoot("w5-arrows-z7")
	await _call("warmap.test.seed", {"a": "France", "b": "Germany", "phase": "extras", "gone": 120})
	var german: Dictionary = await _call("warmap.test.regions", {"owner": "Germany", "near": [10.5, 51.5]})
	var french: Dictionary = await _call("warmap.test.regions", {"owner": "France", "near": [5.6, 48.7]})
	var group_regions: Array = (german.get("result", []) as Array).slice(0, 3)
	var claimants := {}
	for id in (french.get("result", []) as Array).slice(0, 2):
		claimants[str(id)] = ["Germany"]
	await _call("warmap.test.groups", {"group": "Rhine Liberation Front", "regions": group_regions, "claimants": claimants})
	await _sync_map()
	await _call("warmap.test.seed", {"a": "France", "b": "Germany", "phase": "extras", "gone": 640})
	await _sync_map()
	_check("a transporter's voyage plays", not (war.overlay.carrier_override as Dictionary).is_empty())
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
		await _wait(0.2)
	_check("clicking a counter selects its unit", not unit_id.is_empty() and picked == unit_id, "%s -> %s" % [unit_id, picked])
	await war.set_map_mode("diplomatic")
	await _focus([[4.5, 47.5], [10.0, 51.0]], 6.3)
	await _wait(0.5)
	await _shoot("w10-diplomatic")
	await war.set_map_mode("political")
	await war.stage(1)
	await _wait(0.8)
	_check("a staged reveal step reads", bool(war._state.get("staged", false)) or (war._state.get("fronts", []) as Array).size() > 0, "staged=%s" % str(war._state.get("staged", false)))
	await _shoot("w11-staged-1")
	while war.playing():
		await process_frame
	await war.unstage()
	await _wait(0.5)
	await _shoot("w12-unstaged")
	_say("done with %d failure(s): %s" % [failures.size(), ", ".join(failures)])
	_finish(0 if failures.is_empty() else 1)


func _finish(code: int) -> void:
	main.engine.stop()
	await _wait(0.5)
	quit(code)
