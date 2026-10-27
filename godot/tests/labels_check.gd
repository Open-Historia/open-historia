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
var extras: MapExtras
var shots := ""
var started := 0
var failures := 0
var tilt := Vector2.ZERO


func _initialize() -> void:
	shots = OS.get_environment("OH_SHOTS")
	started = Time.get_ticks_msec()
	root.mouse_passthrough = true
	var spec := OS.get_environment("OH_MAP_TILT").split(",", false)
	if spec.size() >= 2:
		tilt = Vector2(float(spec[0]), float(spec[1]))
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
	if tilt != Vector2.ZERO:
		map.pitch = tilt.x
		map.bearing = tilt.y
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
	if tilt != Vector2.ZERO:
		await _attach_extras()
		_say("views tilted to pitch %.0f, bearing %.0f" % [tilt.x, tilt.y])
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
	await _projection_checks()
	_say("done with %d failures" % failures)
	_finish(1 if failures > 0 else 0)


func _check(ok: bool, what: String) -> void:
	if ok:
		_say("ok   " + what)
	else:
		_say("FAIL " + what)
		failures += 1


func _attach_extras() -> void:
	if extras != null:
		return
	extras = MapExtras.new()
	root.add_child(extras)
	await extras.setup(engine, {"map_view": map})
	extras.apply_map_settings({"map_disable_idle_rotation": true})


func _place(lon: float, lat: float, level: float, pitch: float, bearing: float) -> void:
	map.camera.position = MapView.CityLayer.ohproject(lon, lat)
	map.camera.zoom = Vector2.ONE * pow(2.0, level) / 8.0
	map.pitch = pitch
	map.bearing = bearing
	map._after_camera_move()
	var globe := extras.globe
	await _wait(0.4)
	var deadline := Time.get_ticks_msec() + 45000
	while Time.get_ticks_msec() < deadline and globe.relief.enabled and not (globe.relief.has_data and not globe.relief.busy()):
		await process_frame
	await _wait(0.4)
	map._after_camera_move()


func _image() -> Image:
	for i in range(4):
		await process_frame
	await RenderingServer.frame_post_draw
	var image := root.get_viewport().get_texture().get_image()
	image.convert(Image.FORMAT_RGBA8)
	return image


static func _green(pixel: Color) -> bool:
	return pixel.g > 0.7 and pixel.r < 0.35 and pixel.b < 0.35


static func _ink_mask(image: Image) -> PackedByteArray:
	var data := image.get_data()
	var mask := PackedByteArray()
	mask.resize(data.size() / 4)
	for index in range(mask.size()):
		var at := index * 4
		mask[index] = 1 if data[at + 1] > 178 and data[at] < 89 and data[at + 2] < 89 else 0
	return mask


static func _ink_overlap(a: PackedByteArray, b: PackedByteArray) -> Vector3:
	var both := 0
	var either := 0
	var first := 0
	for index in range(mini(a.size(), b.size())):
		if a[index] == 1 or b[index] == 1:
			either += 1
			if a[index] == 1 and b[index] == 1:
				both += 1
		if a[index] == 1:
			first += 1
	return Vector3(both, either, first)


static func _ink_within(image: Image, at: Vector2, reach: float) -> bool:
	var span := ceili(reach)
	for y in range(int(at.y) - span, int(at.y) + span + 1):
		for x in range(int(at.x) - span, int(at.x) + span + 1):
			if x < 0 or y < 0 or x >= image.get_width() or y >= image.get_height():
				continue
			if Vector2(x + 0.5, y + 0.5).distance_to(at) > reach:
				continue
			var pixel := image.get_pixel(x, y)
			if pixel.g - maxf(pixel.r, pixel.b) > 0.25:
				return true
	return false


func _full_names(level: float) -> Array[Dictionary]:
	var found: Array[Dictionary] = []
	for label in map.polity_text().labels_snapshot():
		if PolityTextLayer.opacity_at(level, float(label["min_zoom"]), 6.2, 0.18, 5.0) >= 0.999:
			found.append(label)
	return found


func _ink_report(image: Image, labels: Array[Dictionary], placed: Callable, other: Callable, apart: float) -> Dictionary:
	var size := map.get_viewport_rect().size
	var counted := 0
	var hits := 0
	var other_hits := 0
	var raised := 0
	var raised_hits := 0
	var missed := PackedStringArray()
	for label in labels:
		var height := float(label["glyph_height"])
		var glyph := -1
		for centre: Vector2 in label["centres"]:
			glyph += 1
			var at: Vector2 = placed.call(centre)
			if at.x < 24.0 or at.y < 24.0 or at.x > size.x - 24.0 or at.y > size.y - 24.0:
				continue
			var glyph_px := at.distance_to(placed.call(centre + Vector2(0.0, height)))
			if glyph_px < 5.0:
				continue
			var reach := 0.4 * glyph_px
			var elsewhere: Vector2 = other.call(centre) if other.is_valid() else at
			if apart > 0.0 and at.distance_to(elsewhere) < apart * glyph_px:
				continue
			counted += 1
			var hit := _ink_within(image, at, reach)
			if hit:
				hits += 1
			elif missed.size() < 8:
				missed.append("%s#%d@(%d,%d)" % [label["text"], glyph, roundi(at.x), roundi(at.y)])
			if other.is_valid() and _ink_within(image, elsewhere, reach):
				other_hits += 1
			if extras.globe.height_at(centre) > 100.0:
				raised += 1
				if hit:
					raised_hits += 1
	if not missed.is_empty():
		_say("glyph centres without ink: " + ", ".join(missed))
	return {"counted": counted, "hits": hits, "other_hits": other_hits, "raised": raised, "raised_hits": raised_hits}


func _projection_checks() -> void:
	await _attach_extras()
	var layer := map.polity_text()
	var globe := extras.globe
	var fill: Color = layer._fill
	var halo: Color = layer._halo
	layer._fill = Color(0.0, 1.0, 0.0, 1.0)
	layer._halo = Color(0.0, 0.0, 0.0, 0.0)
	layer._apply_colors()
	map._cities.visible = false
	extras.apply_map_settings({"Terrain": false, "Globe": false})
	await _place(10.0, 49.0, 4.0, 0.0, 0.0)
	map.basemap.visible = false
	extras._ui.visible = false
	var untouched := await _image()
	map.basemap.visible = true
	extras._ui.visible = true
	var on_flat := func(point: Vector2) -> Vector2: return map.world_to_screen(point)
	var on_plane := func(point: Vector2) -> Vector2: return globe.project_label_point(point)
	var on_relief := func(point: Vector2) -> Vector2: return globe.world_to_screen(point)
	for spot: Array in [["p1-europe-z4", 10.0, 49.0, 4.0], ["p2-fade-in-z2-5", 20.0, 40.0, 2.5]]:
		await _place(float(spot[1]), float(spot[2]), float(spot[3]), 0.0, 0.0)
		_check(not globe.active and not layer.projected(), "%s: a north-up map with terrain off draws its names on the flat path" % spot[0])
		var flat_image := await _image()
		var flat := _ink_mask(flat_image)
		await _shoot(str(spot[0]) + "-flat")
		var calibrate := _ink_report(flat_image, _full_names(map.zoom_level()), on_flat, Callable(), 0.0)
		_check(int(calibrate["counted"]) >= 20 and float(calibrate["hits"]) >= 0.97 * float(calibrate["counted"]), "%s: on the flat path the measured glyph centres sit on drawn ink (%d of %d)" % [spot[0], int(calibrate["hits"]), int(calibrate["counted"])])
		await _place(float(spot[1]), float(spot[2]), float(spot[3]), 0.0, 0.001)
		_check(globe.active and layer.projected() and globe.labels.painted_items() > 0, "%s: once the projector runs the names move to its screen-space pass (%d glyph runs)" % [spot[0], globe.labels.painted_items()])
		var projected := _ink_mask(await _image())
		await _shoot(str(spot[0]) + "-projected")
		var overlap := _ink_overlap(flat, projected)
		_check(overlap.z > 2000.0 and overlap.x / maxf(overlap.y, 1.0) > 0.9, "%s: the screen-space pass draws the same curves, sizes and zoom fades as the flat map (%.1f%% of %d ink pixels shared)" % [spot[0], 100.0 * overlap.x / maxf(overlap.y, 1.0), int(overlap.z)])
	var pitch := tilt.x if tilt != Vector2.ZERO else 60.0
	var bearing := tilt.y if tilt != Vector2.ZERO else 0.0
	extras.apply_map_settings({"Terrain": true})
	await _place(8.6, 45.4, 5.0, pitch, bearing)
	var relief_ok := globe.relief_shown() and globe.relief.has_data
	var image := await _image()
	await _shoot("p3-alps-terrain-p%d-b%d" % [roundi(pitch), roundi(bearing)])
	var names := _full_names(map.zoom_level())
	var plane := _ink_report(image, names, on_plane, on_relief, 1.0)
	_check(relief_ok and layer.projected() and int(plane["counted"]) >= 6 and float(plane["hits"]) >= 0.9 * float(plane["counted"]) and float(plane["other_hits"]) <= 0.5 * float(plane["counted"]), "over the Alps at pitch %.0f the names lie flat on the sea-level plane of React's custom layer, not draped over the relief (of %d glyphs the relief would move by more than their height, %d are on the plane and %d where draping would put them)" % [pitch, int(plane["counted"]), int(plane["hits"]), int(plane["other_hits"])])
	var everything := _ink_report(image, names, on_plane, Callable(), 0.0)
	_check(int(everything["raised"]) >= 20 and float(everything["raised_hits"]) >= 0.9 * float(everything["raised"]), "names stay drawn where the raised terrain stands in front of their plane, as React's layer draws without a depth test (%d of %d glyphs over raised ground)" % [int(everything["raised_hits"]), int(everything["raised"])])
	extras.apply_map_settings({"Globe": true})
	await _place(15.0, 45.0, 3.0, 0.0, 0.0)
	globe._light_material.set_shader_parameter("overlay", 0.0)
	image = await _image()
	await _shoot("p4-globe-z3")
	var front: Array[Dictionary] = []
	var eye: Vector3 = globe.current_frame()["pos"]
	for label in _full_names(map.zoom_level()):
		var on_side := true
		for centre: Vector2 in label["centres"]:
			var lonlat := GlobeView.lonlat_of_world(centre)
			if GlobeView.direction_of(lonlat.x, lonlat.y).dot(eye) < 1.02:
				on_side = false
		if on_side:
			front.append(label)
	var sphere := _ink_report(image, front, on_plane, Callable(), 0.0)
	_check(globe.globe_shown() and layer.projected() and int(sphere["counted"]) >= 20 and float(sphere["hits"]) >= 0.9 * float(sphere["counted"]), "on the globe the names are drawn on the sphere's surface by the same pass (%d of %d glyphs)" % [int(sphere["hits"]), int(sphere["counted"])])
	extras.apply_map_settings({"Globe": false, "Terrain": false})
	await _place(10.0, 49.0, 4.0, 0.0, 0.0)
	map.basemap.visible = false
	extras._ui.visible = false
	var returned := await _image()
	map.basemap.visible = true
	extras._ui.visible = true
	var changed := 0
	var before_bytes := untouched.get_data()
	var after_bytes := returned.get_data()
	for index in range(mini(before_bytes.size(), after_bytes.size())):
		if before_bytes[index] != after_bytes[index]:
			changed += 1
	if changed > 0 and not shots.is_empty():
		untouched.save_png(shots.path_join("p5-flat-before-projector.png"))
		returned.save_png(shots.path_join("p5-flat-after-projector.png"))
	_check(not globe.active and not layer.projected() and before_bytes.size() == after_bytes.size() and changed == 0, "back to a flat north-up map the names return to the flat path, pixel for pixel as before the projector ran (%d bytes differ)" % changed)
	layer._fill = fill
	layer._halo = halo
	layer._apply_colors()
	map._cities.visible = true


func _finish(code: int) -> void:
	engine.stop()
	for i in range(2):
		await process_frame
	quit(code)
