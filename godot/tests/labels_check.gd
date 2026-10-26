extends SceneTree

const VIEWS := [
	["l1-world-z2-25", 20.0, 35.0, 2.25],
	["l2-europe-z3", 14.0, 50.0, 3.0],
	["l3-europe-z4", 10.0, 49.0, 4.0],
	["l4-europe-z5-4", 6.0, 47.5, 5.4],
	["l5-russia-z2-2", 92.0, 60.0, 2.2],
	["l6-chile-z3-2", -70.0, -36.0, 3.2],
	["l7-indonesia-z3-6", 117.0, -2.0, 3.6],
	["l8-fade-in-small-z2-5", 20.0, 40.0, 2.5],
	["l9-fade-out-z6", 2.5, 46.5, 6.0],
]

var engine: EngineLink
var map: MapView
var shots := ""
var started := 0
var failures := 0


func _initialize() -> void:
	shots = OS.get_environment("OH_SHOTS")
	started = Time.get_ticks_msec()
	engine = EngineLink.new()
	root.add_child(engine)
	map = MapView.new()
	root.add_child(map)
	map.set_label_engine(engine)
	_run.call_deferred()


func _say(text: String) -> void:
	print("[labels %6d ms] %s" % [Time.get_ticks_msec() - started, text])


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


func _look(lon: float, lat: float, level: float) -> void:
	map.camera.position = MapView.CityLayer.ohproject(lon, lat)
	map.camera.zoom = Vector2.ONE * pow(2.0, level) / 8.0
	map._after_camera_move()


func _visible_report() -> String:
	var layer := map.polity_text()
	var level := map.zoom_level()
	var shown := PackedStringArray()
	for label in layer.labels_snapshot():
		var opacity := PolityTextLayer.opacity_at(level, float(label["min_zoom"]), 6.2, 0.18, 5.0)
		if opacity <= 0.002:
			continue
		var bounds: Rect2 = label["bounds"]
		if not map.get_viewport_rect().has_point(map.world_to_screen(bounds.get_center())):
			continue
		shown.append("%s(%.0fpx a%.2f)" % [label["text"], float(label["font_px_z4"]) * pow(2.0, level - 4.0), opacity])
	return ", ".join(shown)


func _wait_for_layout(layer: PolityTextLayer, previous: int, limit_ms: int) -> bool:
	var deadline := Time.get_ticks_msec() + limit_ms
	while Time.get_ticks_msec() < deadline:
		if layer.revision > previous and layer.label_count > 0 and not layer.busy():
			return true
		await process_frame
	return false


func _request(method: String, args: Dictionary = {}) -> Variant:
	var reply: Dictionary = await engine.request(method, args)
	if not bool(reply.get("ok", false)):
		_say("FAIL %s: %s" % [method, str(reply.get("error", ""))])
		failures += 1
		return null
	return reply.get("result")


func _pan_cost() -> float:
	_look(20.0, 40.0, 2.6)
	await process_frame
	var begin := Time.get_ticks_usec()
	for step in range(60):
		_look(20.0 + step * 0.4, 40.0, 2.6 + step * 0.01)
		await process_frame
	return (Time.get_ticks_usec() - begin) / 60000.0


func _run() -> void:
	if not engine.start():
		_say("FAIL the game engine could not be started")
		_finish(1)
		return
	while not engine.is_ready():
		if Time.get_ticks_msec() - started > 90000:
			_say("FAIL the game engine never became ready")
			_finish(1)
			return
		await process_frame
	var hello: Variant = await _request("hello")
	if hello is Dictionary:
		map.basemap.cache_dir = str((hello as Dictionary).get("dataRoot", "")).path_join("native-cache").path_join("tiles")
	await _request("game.create", {"scenarioId": "default", "country": "France", "difficulty": "medium"})
	var regions: Variant = await _request("map.regions")
	if not regions is Dictionary:
		_finish(1)
		return
	map.load_regions(str((regions as Dictionary)["file"]))
	await map.baked
	var opened := Time.get_ticks_msec()
	var state: Variant = await _request("map.state")
	if state is Dictionary:
		map.set_state(state)
	var cities: Variant = await _request("map.cities")
	if cities is Dictionary:
		map.set_cities((cities as Dictionary).get("cities", []))
	var layer := map.polity_text()
	if layer == null:
		_say("FAIL no polity text layer on the map")
		_finish(1)
		return
	if not await _wait_for_layout(layer, 0, 120000):
		_say("FAIL the names were never laid out: %s" % layer.last_error)
		_finish(1)
		return
	_say("laid out %d names, revision %d, in %d ms after the map state arrived" % [layer.label_count, layer.revision, Time.get_ticks_msec() - opened])
	var sample := PackedStringArray()
	for label in layer.labels_snapshot().slice(-12):
		sample.append("%s z>=%.2f %.0fpx@z4 glyphs=%d" % [label["text"], float(label["min_zoom"]), float(label["font_px_z4"]), int(label["glyphs"])])
	_say("largest: " + " | ".join(sample))
	if not shots.is_empty():
		var file := FileAccess.open(shots.path_join("measures.json"), FileAccess.WRITE)
		if file:
			file.store_string(JSON.stringify(layer.measures_snapshot()))
			file.close()
	for view: Array in VIEWS:
		_look(float(view[1]), float(view[2]), float(view[3]))
		await _wait(0.3)
		_say("%s z%.2f: %s" % [view[0], map.zoom_level(), _visible_report()])
		await _shoot(str(view[0]))
	var with_names := await _pan_cost()
	layer.visible = false
	var without_names := await _pan_cost()
	layer.visible = true
	_say("panning: %.2f ms a frame with the names, %.2f ms without" % [with_names, without_names])
	var before := layer.revision
	var annexed: Variant = await _request("cheats.annex.country", {"source": "Belgium", "owner": "France", "sourceName": "Belgium", "ownerName": "France"})
	_say("annex Belgium into France: %s" % str(annexed))
	var annexed_state: Variant = await _request("map.state")
	if annexed_state is Dictionary:
		map.set_state(annexed_state)
	if await _wait_for_layout(layer, before, 60000):
		var texts := PackedStringArray()
		for label in layer.labels_snapshot():
			texts.append(str(label["text"]))
		var belgium_gone := not texts.has("BELGIUM")
		_say("after annexation: revision %d, %d names, BELGIUM %s" % [layer.revision, layer.label_count, "gone" if belgium_gone else "STILL SHOWN"])
		if not belgium_gone:
			failures += 1
	else:
		_say("FAIL the names were not recomputed after the annexation: %s" % layer.last_error)
		failures += 1
	_look(6.0, 49.0, 4.2)
	await _wait(0.3)
	_say("l10-after-annexation: " + _visible_report())
	await _shoot("l10-after-annexation")
	var unchanged := layer.revision
	map.set_state(annexed_state if annexed_state is Dictionary else {})
	await _wait(1.5)
	_say("same ownership again: revision %d -> %d (no new layout expected)" % [unchanged, layer.revision])
	if layer.revision != unchanged:
		failures += 1
	_say("done with %d failures" % failures)
	_finish(1 if failures > 0 else 0)


func _finish(code: int) -> void:
	engine.stop()
	for i in range(2):
		await process_frame
	quit(code)
