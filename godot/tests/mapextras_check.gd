extends SceneTree

var main: Node
var shots := ""
var started := 0
var failures: PackedStringArray = []
var finished := false
var extras: MapExtras
var only := ""


func _initialize() -> void:
	shots = OS.get_environment("OH_SHOTS")
	only = OS.get_environment("OH_MAPX_ONLY")
	started = Time.get_ticks_msec()
	root.mouse_passthrough = true
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.add_child(main)
	_watchdog.call_deferred()
	_run.call_deferred()


func _watchdog() -> void:
	await create_timer(900.0).timeout
	if not finished:
		_say("FAIL the check did not finish in time")
		_finish(1)


func _say(text: String) -> void:
	print("[mapextras_check %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _check(ok: bool, what: String) -> void:
	if ok:
		_say("ok   " + what)
	else:
		_say("FAIL " + what)
		failures.append(what)


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
	return condition.call()


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
	await _close_notice()
	await _frames(4)
	await RenderingServer.frame_post_draw
	if shots.is_empty():
		return
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(name + ".png"))
	_say("screenshot " + name)


func _wants(step: String) -> bool:
	return only.is_empty() or only.split(",").has(step)


func _region_named(owner: String, preferred: String) -> int:
	var view: MapView = main.map_view
	var best := -1
	var area := -1.0
	for index in range(view.extras_region_count()):
		if view.region_owner(index) != owner:
			continue
		if view.region_name(index) == preferred:
			return index
		if view._areas[index] > area:
			area = view._areas[index]
			best = index
	return best


func _regions_of(owner: String, limit: int) -> Array[int]:
	var view: MapView = main.map_view
	var found: Array[int] = []
	for index in range(view.extras_region_count()):
		if view.region_owner(index) == owner:
			found.append(index)
			if found.size() >= limit:
				break
	return found


func _reload_state() -> void:
	var state: Dictionary = await main.engine.request("map.state")
	if bool(state.get("ok", false)):
		main.map_view.set_state(state["result"])


func _run() -> void:
	while not main.menu.visible:
		if Time.get_ticks_msec() - started > 90000:
			_say("FAIL the menu never appeared")
			_finish(1)
			return
		await process_frame
	_say("menu ready")
	await _clear_shell()
	await main._start_scenario("default")
	main.picker._choose("France")
	await main._on_country_chosen("France", "medium")
	await _wait(1.0)
	var view: MapView = main.map_view
	extras = main.get("map_extras") as MapExtras
	_check(extras != null, "the game mounts the map extras")
	if extras == null:
		extras = MapExtras.new()
		main.hud.add_child(extras)
		await extras.setup(main.engine, {"map_view": view, "game": {}})
	await _until(func() -> bool: return extras.globe != null and not extras.world.is_empty(), 30.0)
	await main.engine.request("settings.flag", {"key": "map_disable_event_camera", "value": true})
	await main._on_setting_changed("map_disable_event_camera", true)
	_check(view.extras == extras, "the map view talks to that one instance")
	_check(not extras.world.is_empty(), "the world's map extras were read")
	_check(int(extras.world.get("regionCount", 0)) == view.extras_region_count(), "the sidecar's regions match the baked map (%d)" % view.extras_region_count())
	_check((extras.world.get("claims", []) as Array).size() > 0, "disputed regions carry stripes (%d)" % (extras.world.get("claims", []) as Array).size())
	_check(bool(extras.world.get("seasons", false)), "the default scenario has seasons and weather")
	if _wants("flat"):
		await _flat_checks()
	if _wants("ice"):
		await _ice_checks()
	if _wants("groups"):
		await _group_checks()
	if _wants("flood"):
		await _flood_checks()
	if _wants("globe"):
		await _globe_checks()
	if _wants("styles"):
		await _style_checks()
	if _wants("offers"):
		await _offer_checks()
	if _wants("nav"):
		await _navigation_checks()
	if _wants("tilt"):
		await _tilt_checks()
	if _wants("trackpad"):
		await _trackpad_checks()
	if _wants("settings"):
		await _settings_checks()
	_finish(0 if failures.is_empty() else 1)


func _texts(node: Node, into: PackedStringArray) -> void:
	if node is CanvasItem and not (node as CanvasItem).visible:
		return
	if node is Label:
		into.append((node as Label).text)
	elif node is Button and not (node as Button).text.is_empty():
		into.append("[%s]" % (node as Button).text)
	elif node is OptionButton:
		into.append((node as OptionButton).text)
	for child in node.get_children():
		_texts(child, into)


func _all_text(node: Node) -> String:
	var found := PackedStringArray()
	_texts(node, found)
	return " | ".join(found).replace("
", " / ")


func _settings_checks() -> void:
	var menu: Node = main.game_menu
	if menu == null:
		_check(false, "the game menu is mounted")
		return
	await menu.open()
	await _wait(0.5)
	await menu._open_workspace("map", "game", menu._card_rect())
	await _wait(1.5)
	var workspace: Node = menu._workspace
	var text := _all_text(workspace)
	_check(text.contains("Ocean (starting map)"), "the game's basemap list names the starting map as React does")
	_check(text.contains("Browse and download maps…") and not text.contains("not in the native app"), "the maps browser button is live")
	_check(text.contains("Running now: Full.") or text.contains("Running now: Low memory."), "performance mode says what is running")
	await _shoot("set-1-map")
	var choices: Dictionary = workspace._choices
	var options: Array = choices.get("options", [])
	_check(options.size() > 10, "every map the scenario offers is listed (%d)" % options.size())
	var reply: Dictionary = await main.engine.request("mapextras.deviceProfile", {"value": "constrained"})
	_check(str((reply.get("result", {}) as Dictionary).get("mode", "")) == "constrained", "performance mode writes oh_device_profile")
	await main.engine.request("mapextras.deviceProfile", {"value": ""})
	workspace._open_maps_browser()
	await _wait(2.0)
	var browser: MapsBrowser = workspace._maps_browser
	_check(browser != null, "the maps window opens")
	if browser:
		await _shoot("set-2-my-maps")
		browser._set_tab("community")
		await _until(func() -> bool: return not browser._official_loading and not browser._community_loading, 30.0)
		await _wait(2.5)
		var browser_text := _all_text(browser)
		_check(browser_text.contains("Community maps") and browser_text.contains("[All]") and browser_text.contains("[Detailed maps]"), "the Community tab lists its maps")
		await _shoot("set-3-community")
		browser.close()
		await _wait(0.5)
	menu.close()
	await _wait(0.5)


func _button(view: MapView, at: Vector2, index: MouseButton, pressed: bool, shift := false, factor := 1.0) -> void:
	var event := InputEventMouseButton.new()
	event.position = at
	event.global_position = at
	event.button_index = index
	event.pressed = pressed
	event.shift_pressed = shift
	event.factor = factor
	view._unhandled_input(event)


func _move(view: MapView, at: Vector2, relative: Vector2, shift := false) -> void:
	var event := InputEventMouseMotion.new()
	event.position = at
	event.global_position = at
	event.relative = relative
	event.shift_pressed = shift
	event.button_mask = MOUSE_BUTTON_MASK_LEFT
	view._unhandled_input(event)


func _key(view: MapView, code: Key, shift := false) -> void:
	var event := InputEventKey.new()
	event.keycode = code
	event.pressed = true
	event.shift_pressed = shift
	view._unhandled_input(event)


func _navigation_checks() -> void:
	var view: MapView = main.map_view
	extras.apply_map_settings({"Globe": false})
	view.fly_to_lonlat(10.0, 48.0, 4.0, 0.0)
	await _wait(1.0)
	var start := view.camera.position
	var at := Vector2(600, 450)
	_button(view, at, MOUSE_BUTTON_LEFT, true)
	for step in range(6):
		await _frames(1)
		at += Vector2(40, 0)
		_move(view, at, Vector2(40, 0))
	var released := view.camera.position
	_button(view, at, MOUSE_BUTTON_LEFT, false)
	_check(absf((start.x - released.x) * view.camera.zoom.x - 240.0) < 1.0, "a drag moves the map with the pointer (%.1f px)" % ((start.x - released.x) * view.camera.zoom.x))
	await _wait(0.12)
	var gliding := view.camera.position
	await _wait(1.2)
	var settled := view.camera.position
	_check((released.x - gliding.x) * view.camera.zoom.x > 2.0 and settled.x <= gliding.x, "the map keeps gliding after the drag and comes to rest (%.1f px more)" % ((released.x - settled.x) * view.camera.zoom.x))
	await _wait(0.3)
	var before_zoom := view.zoom_level()
	_button(view, Vector2(720, 450), MOUSE_BUTTON_WHEEL_UP, true)
	await _wait(0.35)
	var wheel_step := view.zoom_level() - before_zoom
	_check(absf(wheel_step - log(2.0 / (1.0 + exp(-100.0 / 450.0))) / log(2.0)) < 0.01, "one wheel notch zooms as MapLibre does (%.4f)" % wheel_step)
	root.gui_release_focus()
	var key_from := view.camera.position
	_key(view, KEY_RIGHT)
	await _wait(0.45)
	_check(absf((view.camera.position.x - key_from.x) * view.camera.zoom.x - 100.0) < 1.5, "the right arrow pans 100 px east (%.1f)" % ((view.camera.position.x - key_from.x) * view.camera.zoom.x))
	var key_zoom := view.zoom_level()
	_key(view, KEY_EQUAL)
	await _wait(0.45)
	_check(absf(view.zoom_level() - key_zoom - 1.0) < 0.01, "+ zooms in one level (%.3f)" % (view.zoom_level() - key_zoom))
	_key(view, KEY_MINUS)
	await _wait(0.45)
	var box_zoom := view.zoom_level()
	_button(view, Vector2(600, 350), MOUSE_BUTTON_LEFT, true, true)
	_move(view, Vector2(700, 420), Vector2(100, 70), true)
	_move(view, Vector2(840, 550), Vector2(140, 130), true)
	await _shoot("nav-1-box")
	_button(view, Vector2(840, 550), MOUSE_BUTTON_LEFT, false, true)
	await _wait(0.8)
	_check(absf(view.zoom_level() - box_zoom - log(4.5) / log(2.0)) < 0.05, "a shift-drag box zooms to fit it (%.3f levels)" % (view.zoom_level() - box_zoom))
	extras.apply_map_settings({"Globe": true})
	await _frames(3)
	view.fly_to_lonlat(10.0, 40.0, 3.0, 0.0)
	await _wait(1.0)
	var globe_zoom := view.zoom_level()
	_button(view, Vector2(720, 450), MOUSE_BUTTON_WHEEL_UP, true)
	await _wait(0.35)
	_check(absf(view.zoom_level() - globe_zoom - log(2.0 / (1.0 + exp(-100.0 / 450.0))) / log(2.0)) < 0.02, "the globe takes the same wheel step (%.4f)" % (view.zoom_level() - globe_zoom))
	var globe_from := extras.globe.centre_lonlat()
	at = Vector2(600, 450)
	_button(view, at, MOUSE_BUTTON_LEFT, true)
	for step in range(6):
		await _frames(1)
		at += Vector2(40, 0)
		_move(view, at, Vector2(40, 0))
	_button(view, at, MOUSE_BUTTON_LEFT, false)
	var globe_released := extras.globe.centre_lonlat()
	await _wait(1.0)
	var globe_settled := extras.globe.centre_lonlat()
	_check(GlobeView.difference_of_angles(globe_released.x, globe_settled.x) < -0.05 and globe_released.x < globe_from.x, "the globe keeps turning after a drag (%.2f deg more)" % GlobeView.difference_of_angles(globe_released.x, globe_settled.x))
	extras.apply_map_settings({"Globe": false})
	await _frames(3)


func _flat_checks() -> void:
	var view: MapView = main.map_view
	view.fly_to_lonlat(10.0, 50.0, 4.6, 0.0)
	await _until(func() -> bool: return extras.season._texture != null, 15.0)
	_check(extras.season._texture != null, "the season tint picture arrived for %s" % extras.season.date)
	await _wait(2.5)
	await _shoot("flat-1-europe")
	extras.apply_map_settings({"map_seasons_weather": false})
	await _wait(0.5)
	await _shoot("flat-2-europe-no-season")
	extras.apply_map_settings({"map_seasons_weather": true})
	view.fly_to_lonlat(34.0, 45.0, 6.0, 0.0)
	await _wait(2.5)
	await _shoot("flat-3-crimea-stripes")
	view.fly_to_lonlat(2.3, 46.5, 7.2, 0.0)
	await _wait(2.5)
	await _shoot("flat-4-province-outlines")
	view.camera.zoom = Vector2.ONE * 0.01
	view.call("_after_camera_move")
	_check(view.camera.zoom.x >= MapView.MIN_ZOOM - 0.0001, "the flat map stops at the game's minimum zoom (%.3f)" % view.zoom_level())
	await _wait(2.0)
	await _shoot("flat-5-min-zoom")


func _ice_checks() -> void:
	var view: MapView = main.map_view
	var finland := _regions_of("Finland", 6)
	var reply: Dictionary = await main.engine.request("mapextras.standin_freeze", {"indices": finland})
	_check(bool(reply.get("ok", false)), "frozen water written to the world (%s)" % str(reply.get("result", reply.get("error", ""))))
	await extras.refresh()
	_check((extras.world.get("frozen", []) as Array).size() == finland.size(), "the map reads %d frozen regions" % finland.size())
	await _until(func() -> bool: return extras.overlays._ice_patterns_loaded, 10.0)
	view.fly_to_lonlat(25.0, 63.0, 5.2, 0.0)
	await _wait(2.5)
	await _shoot("ice-1-finland")
	view.fly_to_lonlat(25.0, 63.0, 7.0, 0.0)
	await _wait(2.0)
	await _shoot("ice-2-finland-close")
	await main.engine.request("mapextras.standin_freeze", {"indices": []})
	await extras.refresh()


func _group_checks() -> void:
	var view: MapView = main.map_view
	var saved: Dictionary = await main.engine.request("cheats.groups.save", {"name": "Nordic Pact", "color": "#3b82f6"})
	_check(bool(saved.get("ok", false)), "a group was created (%s)" % str(saved.get("error", "")))
	for owner in ["Sweden", "Norway"]:
		for index in _regions_of(owner, 8):
			await main.engine.request("cheats.groups.ops", {"name": "Nordic Pact", "action": "toggle", "index": index})
	await extras.refresh()
	_check((extras.world.get("groupRegions", []) as Array).size() > 0, "the group's regions reach the map (%d)" % (extras.world.get("groupRegions", []) as Array).size())
	await _until(func() -> bool: return extras.overlays._line_mesh != null, 15.0)
	_check(extras.overlays._line_mesh != null, "the group's outline was drawn from the frontier topology")
	view.fly_to_lonlat(15.0, 62.0, 4.4, 0.0)
	await _wait(2.5)
	await _shoot("groups-1-nordic")
	await main.engine.request("cheats.groups.ops", {"name": "Nordic Pact", "action": "erase"})
	await extras.refresh()


func _flood_checks() -> void:
	var view: MapView = main.map_view
	var target := _region_named("France", "Grand Est")
	_check(target >= 0, "a French region to annex (%s)" % view.region_name(target))
	view.fly_to_lonlat(6.0, 48.5, 5.6, 0.0)
	await _wait(2.5)
	await _shoot("flood-0-before")
	var annexed: Dictionary = await main.engine.request("cheats.annex.region", {"index": target, "owner": "Germany", "ownerName": "Germany"})
	_check(bool(annexed.get("ok", false)), "the region changed hands (%s)" % str(annexed.get("result", annexed.get("error", ""))))
	await _reload_state()
	_check(extras.flood.busy(), "a change of owner starts the conquest flood")
	await _until(func() -> bool: return extras.flood._phase == "running", 5.0)
	_say("flood mode %s, prepared in %d ms (computed in %d ms)" % [extras.flood.last_mode, extras.flood.last_elapsed_ms, extras.flood.last_compute_ms])
	await _wait(0.12)
	await _shoot("flood-1-mid")
	await _until(func() -> bool: return not extras.flood.busy(), 5.0)
	_check(not extras.flood.busy() and view.region_owner(target) == "Germany", "the flood finished and the region is Germany's")
	await _wait(0.3)
	await _shoot("flood-2-after")
	var many := _regions_of("Belgium", 20)
	for index in many:
		await main.engine.request("cheats.annex.region", {"index": index, "owner": "France", "ownerName": "France"})
	view.fly_to_lonlat(4.5, 50.6, 6.4, 0.0)
	await _wait(2.0)
	await _reload_state()
	await _until(func() -> bool: return extras.flood._phase == "running", 5.0)
	_say("second change: mode %s for %d regions, prepared in %d ms (computed in %d ms)" % [extras.flood.last_mode, many.size(), extras.flood.last_elapsed_ms, extras.flood.last_compute_ms])
	await _wait(0.25)
	await _shoot("flood-3-belgium-mid")
	await _until(func() -> bool: return not extras.flood.busy(), 5.0)
	await _wait(0.3)
	await _shoot("flood-4-belgium-after")


func _globe_checks() -> void:
	var view: MapView = main.map_view
	extras.apply_map_settings({"Globe": true})
	await _frames(3)
	_check(extras.globe.active and view.is_globe(), "the 3D globe switches on")
	view.fly_to_lonlat(10.0, 30.0, 2.25, 0.0)
	await _wait(3.0)
	await _shoot("globe-1-far")
	var centre := view.get_viewport_rect().size * 0.5
	var world := view.screen_to_world(centre)
	var back := view.world_to_screen(world)
	_check(back.distance_to(centre) < 1.5, "a point on the globe projects back where it was picked (%.2f px)" % back.distance_to(centre))
	_check(not extras.globe.screen_hits_globe(Vector2(4, 4)), "the corner of the screen is space, not the globe")
	var polity := view.polity_text()
	_check(polity != null and polity.visibility_layer == GlobeView.MAP_LAYER_BIT and extras.globe.labels.visible and extras.globe.labels.painted_items() > 0, "the country names are drawn on the globe's surface (%d names)" % extras.globe.labels.painted_items())
	var pole := view.world_to_screen(GlobeView.world_of_lonlat(0.0, 84.0))
	var below := view.world_to_screen(GlobeView.world_of_lonlat(0.0, 78.0))
	if pole.x > 0.0 and below.x > 0.0:
		var image := root.get_viewport().get_texture().get_image()
		var near_pole := _patch_colour(image, pole, 2)
		var further := _patch_colour(image, below, 2)
		_check(_colour_gap(near_pole, further) < 0.12, "the polar cap shows the map's edge, not a dark hole (%s vs %s)" % [near_pole.to_html(false), further.to_html(false)])
	view.fly_to_lonlat(2.0, 47.0, 3.5, 0.0)
	await _wait(3.0)
	await _shoot("globe-2-europe")
	view.fly_to_lonlat(2.0, 47.0, 6.0, 0.0)
	await _wait(3.0)
	await _shoot("globe-3-close")
	extras.apply_map_settings({"map_disable_idle_rotation": true})
	view.fly_to_lonlat(2.35, 48.85, 8.0, 0.0)
	await _wait(2.0)
	view.camera.zoom = Vector2.ONE * pow(2.0, 11.4) / 8.0
	view.call("_after_camera_move")
	await _wait(2.5)
	await _shoot("globe-4-morph")
	var on_globe := _patch_colour(root.get_viewport().get_texture().get_image(), centre, 10)
	extras.apply_map_settings({"Globe": false})
	await _wait(2.5)
	await _shoot("globe-4-flat")
	var on_flat := _patch_colour(root.get_viewport().get_texture().get_image(), centre, 10)
	_check(_colour_gap(on_globe, on_flat) < 0.06, "between globe and flat the map under the camera is the same (%s vs %s)" % [on_globe.to_html(false), on_flat.to_html(false)])
	extras.apply_map_settings({"Globe": true, "map_disable_idle_rotation": false})
	await _frames(3)
	view.fly_to_lonlat(10.0, 30.0, 2.25, 0.0)
	await _wait(1.0)
	extras.globe.mark_interaction()
	var before := view.camera.position.x
	await _wait(4.2)
	var moved := absf(view.camera.position.x - before)
	_check(moved > 0.5, "the globe turns by itself when left alone (%.2f world units)" % moved)
	extras.apply_map_settings({"map_disable_idle_rotation": true})
	extras.globe.mark_interaction()
	before = view.camera.position.x
	await _wait(4.0)
	_check(absf(view.camera.position.x - before) < 0.001, "the idle rotation stops when it is switched off")
	extras.apply_map_settings({"map_disable_idle_rotation": false})
	await _shoot("globe-5-turned")
	extras.apply_map_settings({"Globe": false})
	await _frames(3)
	_check(not extras.globe.active and not view.is_globe(), "the globe switches off again")
	_check(polity == null or polity.visibility_layer == 1, "the flat map's names are back on screen")
	await _wait(1.0)
	await _shoot("globe-6-flat-again")


func _patch_colour(image: Image, at: Vector2, half: int) -> Color:
	var sum := Color(0, 0, 0, 0)
	var count := 0
	for y in range(int(at.y) - half, int(at.y) + half + 1):
		for x in range(int(at.x) - half, int(at.x) + half + 1):
			if x < 0 or y < 0 or x >= image.get_width() or y >= image.get_height():
				continue
			var pixel := image.get_pixel(x, y)
			sum = Color(sum.r + pixel.r, sum.g + pixel.g, sum.b + pixel.b, 1.0)
			count += 1
	if count == 0:
		return Color(0, 0, 0, 1)
	return Color(sum.r / count, sum.g / count, sum.b / count, 1.0)


func _colour_gap(a: Color, b: Color) -> float:
	return maxf(absf(a.r - b.r), maxf(absf(a.g - b.g), absf(a.b - b.b)))


func _style_checks() -> void:
	var view: MapView = main.map_view
	view.fly_to_lonlat(10.0, 45.0, 3.6, 0.0)
	for pick in ["atlas-relief-dark", "midnight-terrain", "imagery", "natgeo-dark", ""]:
		await main.engine.request("mapextras.setGamePick", {"pick": pick})
		extras.apply_map_settings({"gamePick": pick})
		await extras.refresh_background()
		await _wait(0.5)
		await _until(func() -> bool: return not extras.offers._cover.visible and not extras.natgeo.busy(), 40.0)
		await _wait(1.5)
		if pick == "natgeo-dark":
			_check(extras.natgeo.enabled and not extras.natgeo._shown.is_empty(), "National Geographic Dark draws its vector map (%d tiles)" % extras.natgeo._shown.size())
			_check(extras.natgeo.visible_labels().size() > 0, "and its reference names (%d)" % extras.natgeo.visible_labels().size())
			await _natgeo_detail_checks()
		await _shoot("style-%s" % (pick if not pick.is_empty() else "starting"))
	extras.apply_map_settings({"Terrain": false})
	await _wait(2.0)
	await _shoot("style-no-terrain")
	extras.apply_map_settings({"Terrain": true})


func _offer_checks() -> void:
	extras.offers.set_background({"missing": {"id": "test-relief", "name": "Test Relief", "version": 2, "bytes": 268435456}, "moreDetailedMaps": 1})
	await _wait(1.0)
	await _shoot("offer-1-missing")
	extras.offers.set_background({"update": {"id": "test-relief", "name": "Test Relief", "version": 3, "have": 2, "needed": false, "bytes": 104857600}})
	await _wait(1.0)
	await _shoot("offer-2-update")
	extras.offers.show_transition("atlas-relief")
	await _wait(0.3)
	await _shoot("offer-3-changing-basemap")
	extras.offers.finish_transition()
	extras.offers.set_background({})


func _natgeo_detail_checks() -> void:
	var view: MapView = main.map_view
	var natgeo: NatGeoReference = extras.natgeo
	_check(natgeo._sprite_state == "ready" and natgeo._sprite_json.size() > 100, "the style's sprite sheet is fetched (%d images)" % natgeo._sprite_json.size())
	_check(natgeo._shelf != Vector3i.ZERO, "the style's own glyphs are in the atlas")
	_check(natgeo.labels.glyph_count > 0, "names are drawn from those glyphs (%d glyphs)" % natgeo.labels.glyph_count)
	_check(natgeo.labels.icon_count > 0, "city and spot icons are drawn from the sprite (%d)" % natgeo.labels.icon_count)
	view.fly_to_lonlat(2.35, 48.85, 8.4, 0.0)
	await _wait(1.0)
	await _until(func() -> bool: return not natgeo.busy(), 40.0)
	await _wait(1.5)
	natgeo.labels.queue_redraw()
	await _frames(3)
	await _shoot("style-natgeo-paris")
	_check(natgeo.labels.along_count > 0, "river and road names follow their lines (%d placed)" % natgeo.labels.along_count)
	var repeated := 0
	for label in natgeo.visible_labels():
		if label.has("anchors") and (label["anchors"] as Array).size() > 1:
			repeated += 1
	_check(repeated > 0, "long lines carry their name again every symbol-spacing (%d lines)" % repeated)
	view.fly_to_lonlat(-0.6, 44.9, 11.6, 0.0)
	await _wait(1.0)
	await _until(func() -> bool: return not natgeo.busy(), 40.0)
	await _wait(1.5)
	await _shoot("style-natgeo-close")
	view.fly_to_lonlat(10.0, 45.0, 3.6, 0.0)
	await _wait(1.0)


func _roundtrip_gap(view: MapView) -> float:
	var worst := 0.0
	for at in [Vector2(200, 160), Vector2(720, 450), Vector2(1200, 700), Vector2(380, 760)]:
		if extras.globe.globe_shown() and not extras.globe.screen_hits_globe(at):
			continue
		var world := view.screen_to_world(at)
		worst = maxf(worst, view.world_to_screen(world).distance_to(at))
	return worst


func _tilt_checks() -> void:
	var view: MapView = main.map_view
	extras.apply_map_settings({"Globe": false})
	view.fly_to_lonlat(10.0, 48.0, 4.5, 0.0)
	await _wait(1.0)
	root.gui_release_focus()
	_key(view, KEY_RIGHT, true)
	await _wait(0.45)
	_check(is_equal_approx(view.bearing, 15.0), "Shift+Right turns the map 15 degrees as MapLibre's keyboard does (%.2f)" % view.bearing)
	_check(extras.globe.active and view.is_globe() and not extras.globe.enabled, "a turned flat map goes through the projector")
	var war: Node = extras.war_layers()
	if war:
		await _frames(2)
		_check(bool(war.get("overlay").get("globe")), "the war overlay draws through the same projection")
	_check(_roundtrip_gap(view) < 0.75, "screen and world agree on the turned map (%.3f px)" % _roundtrip_gap(view))
	await _shoot("tilt-1-turned")
	for step in range(3):
		_key(view, KEY_UP, true)
		await _wait(0.6)
	_check(is_equal_approx(view.pitch, 30.0), "Shift+Up tilts the map 10 degrees at a time (%.2f)" % view.pitch)
	_check(not (extras.globe.get("_near") as Dictionary).is_empty(), "the near half of a tilted map gets its own sharper texture")
	_check(_roundtrip_gap(view) < 0.75, "screen and world agree on the tilted map (%.3f px)" % _roundtrip_gap(view))
	var grab := Vector2(500, 600)
	var grabbed := view.screen_to_world(grab)
	var at := grab
	_button(view, at, MOUSE_BUTTON_LEFT, true)
	for step in range(6):
		await _frames(1)
		at += Vector2(30, -20)
		_move(view, at, Vector2(30, -20))
	_button(view, at, MOUSE_BUTTON_LEFT, false)
	extras.navigator.stop()
	_check(view.world_to_screen(grabbed).distance_to(at) < 1.5, "a drag keeps the grabbed place under the pointer on a turned, tilted map (%.2f px)" % view.world_to_screen(grabbed).distance_to(at))
	var wheel_at := Vector2(900, 300)
	var under := view.screen_to_world(wheel_at)
	_button(view, wheel_at, MOUSE_BUTTON_WHEEL_UP, true)
	await _wait(0.5)
	_check(view.world_to_screen(under).distance_to(wheel_at) < 1.5, "a wheel zoom keeps the place under the pointer (%.2f px)" % view.world_to_screen(under).distance_to(wheel_at))
	await _shoot("tilt-2-tilted")
	for step in range(5):
		_key(view, KEY_UP, true)
		await _wait(0.6)
	_check(is_equal_approx(view.pitch, 60.0), "the tilt stops at MapLibre's 60 degrees (%.2f)" % view.pitch)
	await _shoot("tilt-3-steep")
	extras.apply_map_settings({"Globe": true})
	await _frames(3)
	view.fly_to_lonlat(10.0, 40.0, 3.0, 0.0)
	await _wait(1.0)
	_check(extras.globe.globe_shown() and _roundtrip_gap(view) < 1.5, "the globe tilts and turns too (%.3f px)" % _roundtrip_gap(view))
	await _shoot("tilt-4-globe")
	extras.apply_map_settings({"Globe": false})
	await _frames(3)
	view.focus_owner("France")
	await _frames(3)
	_check(view.bearing == 0.0 and view.pitch == 0.0 and not extras.globe.active, "opening a game frames it facing north and flat, as React's first framing does")


func _pan_gesture(view: MapView, at: Vector2, delta_y: float) -> void:
	var event := InputEventPanGesture.new()
	event.position = at
	event.delta = Vector2(0.0, delta_y)
	view._unhandled_input(event)


func _magnify(view: MapView, at: Vector2, factor: float) -> void:
	var event := InputEventMagnifyGesture.new()
	event.position = at
	event.factor = factor
	view._unhandled_input(event)


func _trackpad_checks() -> void:
	var view: MapView = main.map_view
	extras.apply_map_settings({"Globe": false})
	view.fly_to_lonlat(10.0, 48.0, 4.5, 0.0)
	await _wait(1.0)
	var navigator: MapNavigator = extras.navigator
	var before := view.zoom_level()
	_pan_gesture(view, Vector2(720, 450), -0.06)
	await _frames(2)
	var expected := log(2.0 / (1.0 + exp(-2.0 / 100.0))) / log(2.0)
	_check(navigator.wheel_type() == "trackpad" and absf(view.zoom_level() - before - expected) < 0.002, "a two-finger scroll is read as a trackpad and zooms at once (%.4f)" % (view.zoom_level() - before))
	before = view.zoom_level()
	_magnify(view, Vector2(720, 450), 1.1)
	await _frames(2)
	expected = log(2.0 / (1.0 + exp(-100.0 * log(1.1) / 100.0))) / log(2.0)
	_check(absf(view.zoom_level() - before - expected) < 0.003, "a pinch zooms by MapLibre's trackpad rate (%.4f)" % (view.zoom_level() - before))
	await _wait(0.6)
	before = view.zoom_level()
	_button(view, Vector2(720, 450), MOUSE_BUTTON_WHEEL_UP, true, false, 0.1)
	await _frames(1)
	_button(view, Vector2(720, 450), MOUSE_BUTTON_WHEEL_UP, true, false, 0.1)
	await _frames(2)
	_check(navigator.wheel_type() == "trackpad" and view.zoom_level() > before, "small quick wheel steps from a precision touchpad are read as a trackpad")
	await _wait(0.6)
	before = view.zoom_level()
	_button(view, Vector2(720, 450), MOUSE_BUTTON_WHEEL_UP, true)
	await _frames(1)
	_check(absf(view.zoom_level() - before) < 0.0001, "a lone wheel notch waits 40 ms to learn what it is")
	await _wait(0.4)
	_check(navigator.wheel_type() == "wheel", "and is then treated as a mouse wheel")


func _finish(code: int) -> void:
	finished = true
	_say("failures: %d" % failures.size())
	main.engine.stop()
	await _frames(2)
	quit(code)
