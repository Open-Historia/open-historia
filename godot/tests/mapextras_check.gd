extends SceneTree

var main: Node
var shots := ""
var started := 0
var failures: PackedStringArray = []
var finished := false
var extras: MapExtras
var only := ""
var tilt := Vector2.ZERO


func _initialize() -> void:
	var redraw := Node2D.new()
	root.add_child(redraw)
	process_frame.connect(redraw.queue_redraw)
	shots = OS.get_environment("OH_SHOTS")
	only = OS.get_environment("OH_MAPX_ONLY")
	started = Time.get_ticks_msec()
	root.mouse_passthrough = true
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.add_child(main)
	_read_tilt()
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
	if _wants("turn"):
		await _turn_checks()
	if _wants("touch"):
		await _touch_checks()
	if _wants("terrain"):
		await _terrain_checks()
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


func _mouse(view: MapView, at: Vector2, index: MouseButton, pressed: bool, ctrl := false, factor := 1.0, shift := false) -> void:
	var event := InputEventMouseButton.new()
	event.shift_pressed = shift
	event.position = at
	event.global_position = at
	event.button_index = index
	event.pressed = pressed
	event.ctrl_pressed = ctrl
	event.factor = factor
	view._unhandled_input(event)


func _move_held(view: MapView, at: Vector2, relative: Vector2, mask: int) -> void:
	var event := InputEventMouseMotion.new()
	event.position = at
	event.global_position = at
	event.relative = relative
	event.button_mask = mask
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
	var fades: Array[float] = []
	var sample := func(_world: Dictionary) -> void: fades.append(extras.overlays._group_fade)
	extras.world_refreshed.connect(sample)
	await extras.refresh()
	extras.world_refreshed.disconnect(sample)
	_check(not fades.is_empty() and is_equal_approx(fades[0], 1.0), "a new group's area appears at once, as React's freshly mounted layers do (%s)" % str(fades))
	_check((extras.world.get("groupRegions", []) as Array).size() > 0, "the group's regions reach the map (%d)" % (extras.world.get("groupRegions", []) as Array).size())
	await _until(func() -> bool: return extras.overlays._line_mesh != null, 15.0)
	_check(extras.overlays._line_mesh != null, "the group's outline was drawn from the frontier topology")
	view.fly_to_lonlat(15.0, 62.0, 4.4, 0.0)
	await _wait(2.5)
	await _shoot("groups-1-nordic")
	var overlays := extras.overlays
	overlays._apply_groups(extras.world.get("groups", []), extras.world.get("groupRegions", []), false)
	var start := overlays._group_fade
	await _wait(0.15)
	var middle := overlays._group_fade
	await _wait(0.3)
	_check(start > 0.99 and middle > 0.0 and middle < 1.0 and is_zero_approx(overlays._group_fade) and not overlays._labels.visible, "switching groups off fades their tint, outline and names out over MapLibre's 300 ms paint transition (%.2f, %.2f, %.2f)" % [start, middle, overlays._group_fade])
	await extras.refresh()
	await _until(func() -> bool: return overlays._line_mesh != null, 15.0)
	await main.engine.request("cheats.groups.ops", {"name": "Nordic Pact", "action": "erase"})
	await extras.refresh()
	_check(is_zero_approx(overlays._group_fade) and overlays._line_mesh == null, "an erased group's area goes at once, as React unmounts its layers (%.2f)" % overlays._group_fade)


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
	_check(polity != null and polity.projected() and polity.visibility_layer == 1 and extras.globe.labels.active() and extras.globe.labels.painted_items() > 0, "the country names are drawn on the globe by the screen-space pass, as React's custom layer projects them (%d glyph runs)" % extras.globe.labels.painted_items())
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
	var lifted := extras.globe.relief_shown() or extras.globe.tilted()
	_check(not extras.globe.globe_shown() and extras.globe.active == lifted and view.is_globe() == lifted, "the globe switches off again")
	_check(polity == null or (polity.visibility_layer == 1 and polity.projected() == lifted), "the flat map's names are back on screen, projected only while terrain or a tilt keeps the projector running")
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
	var drag := await _drag_by(view, at, Vector2(30, -20), 6)
	at = drag[0]
	if extras.globe.relief_shown():
		_check(float(drag[1]) < 0.5, "with 3D terrain a drag moves the map by the place under the screen centre, as MapLibre's terrain drag does, so the pointer slides (%.2f px at the centre, the grabbed place %.1f px from the pointer)" % [float(drag[1]), view.world_to_screen(grabbed).distance_to(at)])
	else:
		_check(view.world_to_screen(grabbed).distance_to(at) < 1.5, "a drag keeps the grabbed place under the pointer on a turned, tilted map (%.2f px)" % view.world_to_screen(grabbed).distance_to(at))
	var wheel_at := Vector2(900, 300)
	var kept := _hold_place(view, wheel_at)
	_button(view, wheel_at, MOUSE_BUTTON_WHEEL_UP, true)
	await _wait(0.5)
	_check(_place_gap(view, kept, wheel_at) < 1.5, "a wheel zoom keeps the place under the pointer%s (%.2f px)" % [" on the camera's ground plane, as MapLibre's scroll zoom does with terrain" if extras.globe.relief_shown() else "", _place_gap(view, kept, wheel_at)])
	await _shoot("tilt-2-tilted")
	for step in range(5):
		_key(view, KEY_UP, true)
		await _wait(0.6)
	_check(is_equal_approx(view.pitch, 60.0), "the tilt stops at MapLibre's 60 degrees (%.2f)" % view.pitch)
	await _shoot("tilt-3-steep")
	await _steep_checks(view)
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
	_check(view.bearing == 0.0 and view.pitch == 0.0 and not extras.globe.globe_shown() and extras.globe.active == extras.globe.relief_shown(), "opening a game frames it facing north and flat, as React's first framing does")


func _hold_place(view: MapView, at: Vector2) -> Array:
	var globe := extras.globe
	if globe.active and globe.relief_shown() and not globe.globe_shown():
		return [globe.screen_to_world_flat(at), globe.centre_height(), true]
	return [view.screen_to_world(at), 0.0, false]


func _place_gap(view: MapView, held: Array, at: Vector2) -> float:
	if bool(held[2]):
		return extras.globe.world_to_screen_at(held[0], float(held[1])).distance_to(at)
	return view.world_to_screen(held[0]).distance_to(at)


func _drag_by(view: MapView, from: Vector2, step: Vector2, count: int) -> Array:
	var centre := view.get_viewport_rect().size * 0.5
	var at := from
	var gap := 0.0
	_button(view, at, MOUSE_BUTTON_LEFT, true)
	for index in range(count):
		await _frames(1)
		at += step
		var under_centre := extras.globe.screen_to_world_flat(centre - step)
		_move(view, at, step)
		if index > 0:
			gap = maxf(gap, extras.globe.world_to_screen_flat(under_centre).distance_to(centre))
	_button(view, at, MOUSE_BUTTON_LEFT, false)
	extras.navigator.stop()
	return [at, gap]


func _pan_gesture(view: MapView, at: Vector2, delta: Vector2, shift := true) -> void:
	var event := InputEventPanGesture.new()
	event.shift_pressed = shift
	event.position = at
	event.delta = delta
	view._unhandled_input(event)


func _magnify(view: MapView, at: Vector2, factor: float) -> void:
	var event := InputEventMagnifyGesture.new()
	event.position = at
	event.factor = factor
	view._unhandled_input(event)


func _hold_level(on: bool) -> void:
	if on and process_frame.is_connected(_keep_tilt):
		process_frame.disconnect(_keep_tilt)
	elif not on and tilt != Vector2.ZERO and not process_frame.is_connected(_keep_tilt):
		process_frame.connect(_keep_tilt)


func _level_view(view: MapView) -> void:
	extras.navigator.stop()
	view.bearing = 0.0
	view.pitch = 0.0
	view.fly_to_lonlat(10.0, 48.0, 4.5, 0.0)
	await _wait(0.6)


func _trackpad_checks() -> void:
	var view: MapView = main.map_view
	var navigator: MapNavigator = extras.navigator
	var at := Vector2(720, 450)
	_hold_level(true)
	extras.apply_map_settings({"Globe": false})
	await _level_view(view)
	var zoom := view.zoom_level()
	var place := view.camera.position
	_pan_gesture(view, at, Vector2(0.0, 0.6))
	await _frames(2)
	_check(navigator.wheel_type() == "trackpad" and absf(view.pitch - 10.0) < 0.01 and absf(view.bearing) < 0.0001 and absf(view.zoom_level() - zoom) < 0.0001 and view.camera.position.distance_to(place) < 0.001, "with Shift held, a two-finger drag up on a trackpad tilts the map and does not zoom (%.2f degrees, zoom %+.4f)" % [view.pitch, view.zoom_level() - zoom])
	_pan_gesture(view, at, Vector2(-0.3, 0.0))
	await _frames(2)
	_check(absf(view.bearing - 8.0) < 0.01 and absf(view.pitch - 10.0) < 0.01 and absf(view.zoom_level() - zoom) < 0.0001, "a two-finger drag sideways turns it (%.2f degrees)" % view.bearing)
	_pan_gesture(view, at, Vector2(0.15, -0.3))
	await _frames(2)
	_check(absf(view.bearing - 4.0) < 0.01 and absf(view.pitch - 5.0) < 0.01, "both at once turn and tilt together (%.2f, %.2f degrees)" % [view.bearing, view.pitch])
	_pan_gesture(view, at, Vector2(0.0, 6.0))
	await _frames(2)
	_check(is_equal_approx(view.pitch, 60.0), "the two-finger tilt stops at MapLibre's 60 degrees (%.2f)" % view.pitch)
	await _level_view(view)
	zoom = view.zoom_level()
	_mouse(view, at, MOUSE_BUTTON_WHEEL_DOWN, true, false, 0.1, true)
	_mouse(view, at, MOUSE_BUTTON_WHEEL_DOWN, true, false, 0.1, true)
	await _frames(2)
	_check(navigator.wheel_type() == "trackpad" and absf(view.pitch - 10.0) < 0.01 and absf(view.zoom_level() - zoom) < 0.0001, "small quick wheel steps from a precision touchpad are read as a trackpad and, with Shift, tilt (%.2f degrees, zoom %+.4f)" % [view.pitch, view.zoom_level() - zoom])
	_mouse(view, at, MOUSE_BUTTON_WHEEL_RIGHT, true, false, 0.1, true)
	_mouse(view, at, MOUSE_BUTTON_WHEEL_RIGHT, true, false, 0.1, true)
	await _frames(2)
	_check(absf(view.bearing + 16.0) < 0.01 and absf(view.zoom_level() - zoom) < 0.0001, "and sideways steps turn the map (%.2f degrees)" % view.bearing)
	await _level_view(view)
	await _wait(0.5)
	zoom = view.zoom_level()
	for step in range(12):
		_mouse(view, at, MOUSE_BUTTON_WHEEL_DOWN, true, false, 0.35)
		await _frames(1)
	await _wait(0.4)
	_check(navigator.wheel_type() == "trackpad" and view.zoom_level() < zoom - 0.05 and view.pitch == 0.0 and view.bearing == 0.0, "a two-finger scroll from a precision touchpad zooms without Shift and does not tilt (zoom %+.4f, %.2f degrees)" % [view.zoom_level() - zoom, view.pitch])
	await _level_view(view)
	await _wait(0.5)
	zoom = view.zoom_level()
	for step in range(4):
		_mouse(view, at, MOUSE_BUTTON_WHEEL_RIGHT, true, false, 0.35)
		await _frames(1)
	await _wait(0.3)
	_check(view.bearing == 0.0 and view.pitch == 0.0 and absf(view.zoom_level() - zoom) < 0.0001, "a sideways two-finger scroll without Shift neither turns nor zooms the map (%.2f degrees)" % view.bearing)
	await _level_view(view)
	await _wait(0.5)
	zoom = view.zoom_level()
	_pan_gesture(view, at, Vector2(0.0, 0.6), false)
	await _frames(2)
	await _wait(0.4)
	_check(view.zoom_level() < zoom - 0.01 and view.pitch == 0.0, "a macOS two-finger pan without Shift zooms (zoom %+.4f)" % (view.zoom_level() - zoom))
	await _level_view(view)
	zoom = view.zoom_level()
	_mouse(view, at, MOUSE_BUTTON_WHEEL_UP, true, true, 0.1)
	_mouse(view, at, MOUSE_BUTTON_WHEEL_UP, true, true, 0.1)
	await _frames(2)
	var expected := log(2.0 / (1.0 + exp(-20.0 / 100.0))) / log(2.0)
	_check(absf(view.zoom_level() - zoom - expected) < 0.003 and view.pitch == 0.0 and view.bearing == 0.0, "a touchpad pinch (Ctrl with the wheel) zooms at MapLibre's trackpad rate and does not turn (%.4f)" % (view.zoom_level() - zoom))
	await _wait(0.6)
	zoom = view.zoom_level()
	_magnify(view, at, 1.1)
	_magnify(view, at, 1.1)
	await _frames(2)
	expected = log(2.0 / (1.0 + exp(-200.0 * log(1.1) / 100.0))) / log(2.0)
	_check(navigator.wheel_type() == "trackpad" and absf(view.zoom_level() - zoom - expected) < 0.003 and view.pitch == 0.0, "a pinch gesture zooms by MapLibre's trackpad rate (%.4f)" % (view.zoom_level() - zoom))
	await _level_view(view)
	zoom = view.zoom_level()
	_mouse(view, at, MOUSE_BUTTON_WHEEL_UP, true)
	await _frames(1)
	_check(navigator.wheel_type() == "wheel", "a whole wheel notch is a mouse wheel at once (%s)" % navigator.wheel_type())
	await _wait(0.4)
	expected = log(2.0 / (1.0 + exp(-100.0 / 450.0))) / log(2.0)
	_check(navigator.wheel_type() == "wheel" and absf(view.zoom_level() - zoom - expected) < 0.01 and view.pitch == 0.0 and view.bearing == 0.0, "and is then treated as a mouse wheel that zooms, as before (%.4f)" % (view.zoom_level() - zoom))
	await _wait(0.5)
	zoom = view.zoom_level()
	for notch in range(3):
		_mouse(view, at, MOUSE_BUTTON_WHEEL_DOWN, true)
		await _frames(1)
	await _wait(0.5)
	_check(navigator.wheel_type() == "wheel" and view.zoom_level() < zoom - 0.2 and view.pitch == 0.0 and view.bearing == 0.0, "a spun mouse wheel keeps zooming and never turns the map (%.3f)" % (view.zoom_level() - zoom))
	extras.apply_map_settings({"Globe": true})
	await _frames(3)
	view.fly_to_lonlat(10.0, 40.0, 3.0, 0.0)
	await _wait(1.0)
	zoom = view.zoom_level()
	_pan_gesture(view, at, Vector2(-0.3, 0.6))
	await _frames(2)
	_check(extras.globe.globe_shown() and absf(view.bearing - 8.0) < 0.01 and absf(view.pitch - 10.0) < 0.01 and absf(view.zoom_level() - zoom) < 0.0001, "the globe turns and tilts with two fingers too (%.2f, %.2f degrees)" % [view.bearing, view.pitch])
	extras.apply_map_settings({"Globe": false})
	await _frames(3)
	await _level_view(view)
	_hold_level(false)


func _turn_checks() -> void:
	var view: MapView = main.map_view
	_hold_level(true)
	extras.apply_map_settings({"Globe": false})
	await _level_view(view)
	var centre := view.get_viewport_rect().size * 0.5
	var from := centre + Vector2(-200.0, 60.0)
	var place := view.camera.position
	_mouse(view, from, MOUSE_BUTTON_RIGHT, true)
	_mouse(view, from, MOUSE_BUTTON_RIGHT, false)
	await _frames(3)
	_check(view.bearing == 0.0 and view.pitch == 0.0 and view.camera.position == place, "a right-click without moving leaves the map as it was")
	_mouse(view, from, MOUSE_BUTTON_RIGHT, true)
	var at := from
	for step in range(5):
		await _frames(1)
		at += Vector2(10.0, 0.0)
		_move_held(view, at, Vector2(10.0, 0.0), MOUSE_BUTTON_MASK_RIGHT)
	_check(absf(view.bearing - 40.0) < 0.01 and view.pitch == 0.0 and view.camera.position.distance_to(place) < 0.001, "a right-button drag sideways turns the map about its centre, as MapLibre's drag-rotate does (%.2f degrees)" % view.bearing)
	for step in range(4):
		await _frames(1)
		at += Vector2(0.0, -10.0)
		_move_held(view, at, Vector2(0.0, -10.0), MOUSE_BUTTON_MASK_RIGHT)
	_check(absf(view.pitch - 20.0) < 0.01 and absf(view.bearing - 40.0) < 0.01, "and a drag up tilts it, as MapLibre's pitch-with-rotate does (%.2f degrees)" % view.pitch)
	_mouse(view, at, MOUSE_BUTTON_RIGHT, false)
	await _wait(1.0)
	_check(view.pitch > 20.5 and view.pitch <= 60.0 and not extras.navigator.busy(), "the tilt carries on a little after letting go and comes to rest (%.2f degrees)" % view.pitch)
	_mouse(view, at, MOUSE_BUTTON_RIGHT, true)
	for step in range(12):
		await _frames(1)
		at += Vector2(0.0, -25.0)
		_move_held(view, at, Vector2(0.0, -25.0), MOUSE_BUTTON_MASK_RIGHT)
	_check(is_equal_approx(view.pitch, 60.0), "the right-button tilt stops at 60 degrees (%.2f)" % view.pitch)
	_mouse(view, at, MOUSE_BUTTON_RIGHT, false)
	await _wait(0.8)
	await _level_view(view)
	at = centre + Vector2(-200.0, -160.0)
	_mouse(view, at, MOUSE_BUTTON_RIGHT, true)
	for step in range(3):
		await _frames(1)
		at += Vector2(10.0, 0.0)
		_move_held(view, at, Vector2(10.0, 0.0), MOUSE_BUTTON_MASK_RIGHT)
	var expected := 0.0
	var probe := centre + Vector2(-200.0, -160.0)
	for step in range(3):
		expected += MapNavigator.angle_with(probe + Vector2(10.0, 0.0) - centre, probe - centre)
		probe += Vector2(10.0, 0.0)
	_check(absf(view.bearing - MapNavigator.wrap_bearing(expected)) < 0.01 and view.bearing < 0.0, "far from the centre the drag turns the map around it, as MapLibre does (%.2f degrees)" % view.bearing)
	_mouse(view, at, MOUSE_BUTTON_RIGHT, false)
	await _wait(0.8)
	await _level_view(view)
	at = from
	_mouse(view, at, MOUSE_BUTTON_RIGHT, true)
	await _frames(1)
	at += Vector2(5.0, 0.0)
	_move_held(view, at, Vector2(5.0, 0.0), MOUSE_BUTTON_MASK_RIGHT)
	var nudged := view.bearing
	await _wait(0.3)
	_mouse(view, at, MOUSE_BUTTON_RIGHT, false)
	await _wait(1.3)
	_check(absf(nudged - 4.0) < 0.01 and absf(view.bearing) < 0.001, "a turn of less than 7 degrees springs back to north, as MapLibre's bearing snap does (%.2f then %.2f)" % [nudged, view.bearing])
	await _level_view(view)
	at = from
	_mouse(view, at, MOUSE_BUTTON_LEFT, true, true)
	for step in range(3):
		await _frames(1)
		at += Vector2(0.0, -20.0)
		_move_held(view, at, Vector2(0.0, -20.0), MOUSE_BUTTON_MASK_LEFT)
	_check(absf(view.pitch - 30.0) < 0.01 and view.camera.position.distance_to(place) < 0.001, "Ctrl with a left-button drag tilts too, as MapLibre's drag-rotate does (%.2f degrees)" % view.pitch)
	_mouse(view, at, MOUSE_BUTTON_LEFT, false, true)
	await _wait(0.8)
	await _level_view(view)
	place = view.camera.position
	at = Vector2(600, 450)
	_button(view, at, MOUSE_BUTTON_LEFT, true)
	for step in range(6):
		await _frames(1)
		at += Vector2(40.0, 0.0)
		_move(view, at, Vector2(40.0, 0.0))
	var moved := (place.x - view.camera.position.x) * view.camera.zoom.x
	_button(view, at, MOUSE_BUTTON_LEFT, false)
	extras.navigator.stop()
	_check(absf(moved - 240.0) < 1.0 and view.bearing == 0.0 and view.pitch == 0.0, "a one-finger click and drag still pans the map with the pointer (%.1f px)" % moved)
	extras.apply_map_settings({"Globe": true})
	await _frames(3)
	view.fly_to_lonlat(10.0, 40.0, 3.0, 0.0)
	await _wait(1.0)
	at = from
	_mouse(view, at, MOUSE_BUTTON_RIGHT, true)
	for step in range(5):
		await _frames(1)
		at += Vector2(10.0, -4.0)
		_move_held(view, at, Vector2(10.0, -4.0), MOUSE_BUTTON_MASK_RIGHT)
	_check(extras.globe.globe_shown() and absf(view.bearing - 40.0) < 0.01 and absf(view.pitch - 10.0) < 0.01, "the globe turns and tilts with the right button too (%.2f, %.2f degrees)" % [view.bearing, view.pitch])
	_mouse(view, at, MOUSE_BUTTON_RIGHT, false)
	extras.navigator.stop()
	extras.apply_map_settings({"Globe": false})
	await _frames(3)
	await _level_view(view)
	_hold_level(false)


func _steep_checks(view: MapView) -> void:
	var size := view.get_viewport_rect().size
	var middle := view.label_perspective(view.screen_to_world(size * 0.5))
	var top_ratio := view.label_perspective(view.screen_to_world(Vector2(size.x * 0.5, 40.0)))
	var bottom_ratio := view.label_perspective(view.screen_to_world(Vector2(size.x * 0.5, size.y - 40.0)))
	_check(absf(middle - 1.0) < 0.01 and top_ratio < 0.95 and bottom_ratio > 1.05, "names shrink toward the horizon and grow near the eye by MapLibre's perspective ratio (%.2f, %.2f, %.2f)" % [top_ratio, middle, bottom_ratio])
	var cover: Dictionary = view.basemap.cover
	_check(not cover.is_empty(), "a tilted map picks its tiles from the camera's view, as MapLibre's tile cover does")
	if not cover.is_empty() and bool(cover.get("variable", false)):
		var lowest := 99
		var highest := -1
		for entry: Array in cover["tiles"]:
			lowest = mini(lowest, int(entry[0]))
			highest = maxi(highest, int(entry[0]))
		_check(highest > lowest, "with terrain on, distant tiles load at lower detail (zoom %d to %d)" % [lowest, highest])
	view.fly_to_lonlat(10.0, 78.0, 3.0, 0.0)
	await _wait(1.0)
	await _close_notice()
	await _frames(4)
	await RenderingServer.frame_post_draw
	var image := root.get_viewport().get_texture().get_image()
	var sample := image.get_pixel(int(size.x * 0.5), 110)
	var expected := GlobeView.FLAT_SPACE
	_check(absf(sample.r - expected.r) < 0.02 and absf(sample.g - expected.g) < 0.02 and absf(sample.b - expected.b) < 0.02, "beyond 85°N a steep tilt shows the map's backdrop, as MapLibre's empty canvas does (%s)" % str(sample))
	await _shoot("tilt-3b-north")


func _touch(view: MapView, index: int, at: Vector2, pressed: bool) -> void:
	var event := InputEventScreenTouch.new()
	event.index = index
	event.position = at
	event.pressed = pressed
	view._unhandled_input(event)


func _drag(view: MapView, index: int, at: Vector2, relative: Vector2) -> void:
	var event := InputEventScreenDrag.new()
	event.index = index
	event.position = at
	event.relative = relative
	view._unhandled_input(event)


func _pinch(view: MapView, centre: Vector2) -> void:
	_touch(view, 0, centre - Vector2(100, 0), true)
	_touch(view, 1, centre + Vector2(100, 0), true)
	for step in range(1, 11):
		await _frames(1)
		_drag(view, 0, centre - Vector2(100 + 10 * step, 0), Vector2(-10, 0))
		_drag(view, 1, centre + Vector2(100 + 10 * step, 0), Vector2(10, 0))
	await _frames(1)


func _lift(view: MapView, centre: Vector2, spread: float) -> void:
	_touch(view, 0, centre - Vector2(spread, 0), false)
	_touch(view, 1, centre + Vector2(spread, 0), false)
	extras.navigator.stop()


func _touch_checks() -> void:
	var view: MapView = main.map_view
	var navigator: MapNavigator = extras.navigator
	extras.apply_map_settings({"Globe": false})
	view.bearing = 0.0
	view.pitch = 0.0
	view.fly_to_lonlat(10.0, 48.0, 4.5, 0.0)
	await _wait(1.0)
	var size := view.get_viewport_rect().size
	var centre := size * 0.5 + Vector2(140, 60)
	var under := _hold_place(view, centre)
	var before := view.zoom_level()
	await _pinch(view, centre)
	_check(absf(view.zoom_level() - before - 1.0) < 0.01, "spreading two fingers zooms in by MapLibre's pinch rate (%.3f)" % (view.zoom_level() - before))
	_check(_place_gap(view, under, centre) < 1.5, "the place between the fingers stays under them (%.2f px)" % _place_gap(view, under, centre))
	_lift(view, centre, 200.0)
	await _wait(0.3)
	under = _hold_place(view, centre)
	_touch(view, 0, centre - Vector2(100, 0), true)
	_touch(view, 1, centre + Vector2(100, 0), true)
	var step_gap := 0.0
	var held := extras.globe.screen_to_world_flat(centre)
	for step in range(1, 13):
		await _frames(1)
		step_gap = maxf(step_gap, extras.globe.world_to_screen_flat(held).distance_to(centre))
		held = extras.globe.screen_to_world_flat(centre)
		var angle := deg_to_rad(3.0 * step)
		var arm := Vector2(cos(angle), sin(angle)) * 100.0
		_drag(view, 0, centre - arm, Vector2.ZERO)
		_drag(view, 1, centre + arm, Vector2.ZERO)
	await _frames(1)
	step_gap = maxf(step_gap, extras.globe.world_to_screen_flat(held).distance_to(centre))
	var turned := view.bearing
	_check(turned < -10.0 and turned > -36.0, "turning two fingers turns the map with them, as MapLibre's touch rotation does (%.1f degrees)" % turned)
	if extras.globe.active and extras.globe.relief_shown() and not extras.globe.globe_shown():
		_check(step_gap < 0.5, "and each turn keeps the place between them on the camera's ground plane, as MapLibre's rotation does without freezing the terrain height (%.2f px per step, %.2f px over the turn)" % [step_gap, _place_gap(view, under, centre)])
	else:
		_check(_place_gap(view, under, centre) < 2.0, "and the place between them stays put (%.2f px)" % _place_gap(view, under, centre))
	var arm_end := Vector2(cos(deg_to_rad(36.0)), sin(deg_to_rad(36.0))) * 100.0
	_touch(view, 0, centre - arm_end, false)
	_touch(view, 1, centre + arm_end, false)
	navigator.stop()
	await _wait(0.3)
	await _shoot("touch-1-turned")
	var picked: Array[int] = []
	var listen := func(index: int) -> void: picked.append(index)
	view.region_clicked.connect(listen)
	var spot := size * 0.5 + Vector2(-60, 20)
	var expected := view.baker.pick(view.screen_to_world(spot))
	_touch(view, 0, spot, true)
	await _frames(1)
	_touch(view, 0, spot, false)
	await _frames(1)
	_check(picked.size() == 1 and picked[0] == expected, "a tap picks the region under the finger (%s, wanted %d)" % [str(picked), expected])
	var still := view.camera.position
	var fake := InputEventMouseButton.new()
	fake.device = InputEvent.DEVICE_ID_EMULATION
	fake.button_index = MOUSE_BUTTON_LEFT
	fake.position = spot
	fake.pressed = true
	view._unhandled_input(fake)
	var fake_move := InputEventMouseMotion.new()
	fake_move.device = InputEvent.DEVICE_ID_EMULATION
	fake_move.position = spot + Vector2(80, 0)
	fake_move.relative = Vector2(80, 0)
	fake_move.button_mask = MOUSE_BUTTON_MASK_LEFT
	view._unhandled_input(fake_move)
	fake.pressed = false
	fake.position = spot + Vector2(80, 0)
	view._unhandled_input(fake)
	_check(view.camera.position == still and picked.size() == 1, "the mouse the system makes from a touch is not read a second time")
	await _wait(0.6)
	before = view.zoom_level()
	_touch(view, 0, spot, true)
	_touch(view, 0, spot, false)
	await _frames(1)
	_touch(view, 0, spot, true)
	for step in range(1, 9):
		await _frames(1)
		_drag(view, 0, spot + Vector2(0, 16 * step), Vector2(0, 16))
	await _frames(1)
	_check(absf(view.zoom_level() - before - 1.0) < 0.02, "a tap then a drag down zooms in, as MapLibre's tap-drag zoom does (%.3f)" % (view.zoom_level() - before))
	_touch(view, 0, spot + Vector2(0, 128), false)
	navigator.stop()
	view.region_clicked.disconnect(listen)
	view.bearing = 20.0
	view.pitch = 40.0
	view.call("_after_camera_move")
	await _frames(2)
	under = _hold_place(view, centre)
	before = view.zoom_level()
	await _pinch(view, centre)
	_check(absf(view.zoom_level() - before - 1.0) < 0.01 and _place_gap(view, under, centre) < 1.5, "a pinch on a turned, tilted map keeps the place between the fingers (%.3f, %.2f px)" % [view.zoom_level() - before, _place_gap(view, under, centre)])
	_lift(view, centre, 200.0)
	await _wait(0.2)
	view.bearing = 0.0
	view.pitch = 0.0
	view.call("_after_camera_move")


class GroundMark extends Node2D:
	var at := Vector2.ZERO
	var half := 0.4

	func _draw() -> void:
		draw_rect(Rect2(at - Vector2(half, half), Vector2(half, half) * 2.0), Color(0.0, 1.0, 0.0))


func _mark_centre(around: Vector2, reach: int) -> Variant:
	await _close_notice()
	await _frames(3)
	await RenderingServer.frame_post_draw
	var image := root.get_viewport().get_texture().get_image()
	var total := Vector2.ZERO
	var count := 0
	for y in range(maxi(0, int(around.y) - reach), mini(image.get_height(), int(around.y) + reach)):
		for x in range(maxi(0, int(around.x) - reach), mini(image.get_width(), int(around.x) + reach)):
			var pixel := image.get_pixel(x, y)
			if pixel.g > 0.7 and pixel.r < 0.35 and pixel.b < 0.35:
				total += Vector2(x + 0.5, y + 0.5)
				count += 1
	return total / count if count >= 6 else null


func _footprint(view: MapView, mark: GroundMark, around: Vector2, reach: int) -> Dictionary:
	await _close_notice()
	await _frames(3)
	await RenderingServer.frame_post_draw
	var image := root.get_viewport().get_texture().get_image()
	var predicted := 0
	var drawn := 0
	var shared := 0
	var predicted_sum := Vector2.ZERO
	var drawn_sum := Vector2.ZERO
	for y in range(maxi(0, int(around.y) - reach), mini(image.get_height(), int(around.y) + reach)):
		for x in range(maxi(0, int(around.x) - reach), mini(image.get_width(), int(around.x) + reach)):
			var spot := Vector2(x + 0.5, y + 0.5)
			var world := view.screen_to_world(spot)
			var inside := absf(world.x - mark.at.x) <= mark.half and absf(world.y - mark.at.y) <= mark.half
			var pixel := image.get_pixel(x, y)
			var green := pixel.g > 0.7 and pixel.r < 0.35 and pixel.b < 0.35
			if inside:
				predicted += 1
				predicted_sum += spot
			if green:
				drawn += 1
				drawn_sum += spot
			if inside and green:
				shared += 1
	var union := predicted + drawn - shared
	return {
		"overlap": float(shared) / float(union) if union > 0 else 0.0,
		"gap": (predicted_sum / predicted).distance_to(drawn_sum / drawn) if predicted > 0 and drawn > 0 else INF,
		"predicted": predicted,
		"drawn": drawn,
	}


func _settle_relief(view: MapView) -> void:
	var globe := extras.globe
	await _wait(0.3)
	await _until(func() -> bool: return globe.relief.has_data and not globe.relief.busy(), 45.0)
	await _wait(0.4)
	view.call("_after_camera_move")
	await _frames(3)


func _terrain_checks() -> void:
	var view: MapView = main.map_view
	var globe := extras.globe
	extras.apply_map_settings({"Globe": false, "Terrain": true})
	view.fly_to_lonlat(6.0, 46.15, 7.0, 0.0)
	view.bearing = 0.0
	view.pitch = 50.0
	view.call("_after_camera_move")
	await _drag_by(view, view.get_viewport_rect().size * 0.5, Vector2(4.0, 0.0), 2)
	await _settle_relief(view)
	_check(globe.relief_shown() and globe.relief.has_data and globe.active, "3D terrain is on by default and raises the map from the terrarium elevation tiles React uses (%d tiles)" % globe.relief.tiles.size())
	var peak := GlobeView.world_of_lonlat(6.8652, 45.8326)
	var peak_height := globe.height_at(peak)
	_check(peak_height > 2000.0 * TerrainRelief.EXAGGERATION, "Mont Blanc stands on raised ground, at MapLibre's 15-times exaggeration (%.0f m from %.0f m of elevation)" % [peak_height, peak_height / TerrainRelief.EXAGGERATION])
	var raised := view.world_to_screen(peak)
	var plain := globe.world_to_screen_flat(peak)
	_check(plain.y - raised.y > 20.0, "the tilted map lifts the mountain on screen (%.1f px above the sea-level plane)" % (plain.y - raised.y))
	var mark := GroundMark.new()
	mark.at = peak
	mark.z_as_relative = false
	mark.z_index = RenderingServer.CANVAS_ITEM_Z_MAX
	view.add_child(mark)
	var seen: Variant = await _mark_centre((raised + plain) * 0.5, int(raised.distance_to(plain) * 0.5) + 60)
	_check(seen is Vector2 and (seen as Vector2).distance_to(raised) < (seen as Vector2).distance_to(plain) * 0.25, "the drawn map is raised with the surface, not left on the sea-level plane (%s, raised %s, plane %s)" % [str(seen), str(raised), str(plain)])
	var footprint: Dictionary = await _footprint(view, mark, raised, 40)
	_check(float(footprint["overlap"]) > 0.6 and float(footprint["gap"]) < 1.5, "the drawn map is draped over the raised surface where picking finds it (%.0f%% overlap, %.2f px apart, %d/%d px)" % [100.0 * float(footprint["overlap"]), float(footprint["gap"]), int(footprint["drawn"]), int(footprint["predicted"])])
	await _shoot("terrain-1-alps")
	var size := view.get_viewport_rect().size
	var slope := -1
	var slope_at := Vector2.ZERO
	var best_gap := 0.0
	for index in range(view.extras_region_count()):
		var centroid := view.war_region_centroid(index)
		var at := view.world_to_screen(centroid)
		if at.x < 80.0 or at.y < 80.0 or at.x > size.x - 80.0 or at.y > size.y - 80.0:
			continue
		if view.baker.pick(centroid) != index:
			continue
		var gap := at.distance_to(globe.world_to_screen_flat(centroid))
		if gap <= best_gap or view.baker.pick(globe.screen_to_world_flat(at)) == index:
			continue
		best_gap = gap
		slope = index
		slope_at = at
	var clicked: Array[int] = []
	var listen := func(index: int) -> void: clicked.append(index)
	view.region_clicked.connect(listen)
	if slope >= 0:
		_button(view, slope_at, MOUSE_BUTTON_LEFT, true)
		_button(view, slope_at, MOUSE_BUTTON_LEFT, false)
		await _frames(1)
	view.region_clicked.disconnect(listen)
	_check(slope >= 0 and clicked.size() == 1 and clicked[0] == slope, "a click on a slope picks the region drawn there, as MapLibre's terrain picking does (%s, %.0f px off the plane, got %s)" % [view.region_name(slope), best_gap, str(clicked)])
	var pointer := slope_at if slope >= 0 else size * 0.5 + Vector2(0.0, 120.0)
	var grabbed := view.screen_to_world(pointer)
	var drag := await _drag_by(view, pointer, Vector2(-25.0, 15.0), 6)
	pointer = drag[0]
	var slid := view.world_to_screen(grabbed).distance_to(pointer)
	_check(float(drag[1]) < 0.5 and slid > 1.0, "a drag over the mountains moves the map by the place under the screen centre, so the pointer slides over the slope, as MapLibre's terrain drag does (%.2f px at the centre, %.1f px slide)" % [float(drag[1]), slid])
	var occluded := 1.0
	var behind := ""
	view.fly_to_lonlat(9.0, 44.9, 7.6, 0.0)
	view.bearing = 0.0
	view.pitch = 60.0
	view.call("_after_camera_move")
	await _settle_relief(view)
	for spot in [["Bern", 7.447, 46.948], ["Interlaken", 7.86, 46.69], ["Lucerne", 8.31, 47.05], ["Zurich", 8.541, 47.377], ["Basel", 7.589, 47.56]]:
		var fade := view.terrain_visibility(GlobeView.world_of_lonlat(float(spot[1]), float(spot[2])))
		if fade < occluded:
			occluded = fade
			behind = str(spot[0])
	var open := view.terrain_visibility(GlobeView.world_of_lonlat(9.19, 45.46))
	_check(occluded < 0.5 and open > 0.99, "a place behind the Alps fades by MapLibre's terrain depth test while one in front stays (%s %.2f, Milan %.2f)" % [behind, occluded, open])
	await _shoot("terrain-1b-behind-alps")
	extras.apply_map_settings({"Globe": true})
	view.fly_to_lonlat(10.0, 46.0, 6.0, 0.0)
	view.pitch = 40.0
	view.bearing = 0.0
	view.call("_after_camera_move")
	await _settle_relief(view)
	var globe_levels: Array[int] = []
	for level in range(TerrainRelief.LEVELS):
		if globe.relief.level_sizes[level] != Vector2i.ONE:
			globe_levels.append(level)
	_check(globe.globe_shown() and globe_levels.size() >= 2, "on the globe above zoom 4 the elevation detail varies with distance, as MapLibre's globe tile cover does (levels %s)" % str(globe_levels))
	extras.apply_map_settings({"Globe": false})
	await _frames(3)
	view.fly_to_lonlat(7.2, 45.6, 7.0, 0.0)
	view.bearing = 0.0
	view.pitch = 50.0
	view.call("_after_camera_move")
	await _settle_relief(view)
	var start_height := globe.centre_height()
	root.gui_release_focus()
	_key(view, KEY_RIGHT)
	await _wait(0.5)
	var under_height := globe.height_at(view.camera.position)
	_check(absf(globe.centre_height() - start_height) < 0.01 and absf(under_height - start_height) > 1.0, "an arrow-key pan keeps the camera's ground height, as MapLibre's keyboard easeTo does (%.0f m kept, %.0f m under the new centre)" % [globe.centre_height(), under_height])
	view.fit_lonlat_bounds([[7.3, 45.8], [7.9, 46.2]], 7.4, 0.6)
	await _wait(0.3)
	var halfway_height := globe.centre_height()
	await _wait(0.6)
	var landed := globe.height_at(view.camera.position)
	_check(absf(globe.centre_height() - landed) < 1.0 and absf(halfway_height - landed) > 1.0 and absf(halfway_height - start_height) > 1.0, "a flight eases the camera's ground height to the target's, as MapLibre's flyTo does (%.0f m, %.0f m halfway, %.0f m at the end)" % [start_height, halfway_height, globe.centre_height()])
	view.fly_to_lonlat(6.0, 46.15, 7.0, 0.0)
	view.bearing = 0.0
	view.pitch = 50.0
	view.call("_after_camera_move")
	await _drag_by(view, size * 0.5, Vector2(4.0, 0.0), 2)
	await _settle_relief(view)
	var levels: Array[int] = []
	view.pitch = 60.0
	view.call("_after_camera_move")
	await _settle_relief(view)
	for level in range(TerrainRelief.LEVELS):
		if globe.relief.level_sizes[level] != Vector2i.ONE:
			levels.append(level)
	_check(levels.size() >= 2 and levels.has(TerrainRelief.SOURCE_MAX_ZOOM), "near ground uses the detailed elevation tiles and distant ground coarser ones, as MapLibre's terrain tile cover does (levels %s)" % str(levels))
	view.pitch = 50.0
	view.call("_after_camera_move")
	await _frames(2)
	extras.apply_map_settings({"Terrain": false})
	await _frames(1)
	raised = view.world_to_screen(peak)
	plain = globe.world_to_screen_flat(peak)
	var flat_seen: Variant = await _mark_centre(plain, 80)
	_check(not globe.relief_shown() and raised.distance_to(plain) < 0.01 and flat_seen is Vector2 and (flat_seen as Vector2).distance_to(plain) < 3.0, "switching 3D Terrain off flattens the map at once (%s, %s)" % [str(flat_seen), str(plain)])
	await _shoot("terrain-2-off")
	view.pitch = 0.0
	view.bearing = 0.0
	view.call("_after_camera_move")
	await _frames(2)
	_check(globe.tilted() or not globe.active, "a flat-facing map with terrain off draws straight, without the projector")
	var names := view.polity_text()
	_check(names == null or globe.tilted() or not names.projected(), "and its country names are drawn by the flat path again")
	extras.apply_map_settings({"Terrain": true})
	view.pitch = 0.0
	view.bearing = 0.0
	view.call("_after_camera_move")
	await _settle_relief(view)
	var shifted := view.world_to_screen(peak).distance_to(globe.world_to_screen_flat(peak))
	_check(globe.active and shifted > 1.0, "the terrain comes back and raises a north-up, flat-facing map too, as MapLibre's terrain does (%.1f px)" % shifted)
	mark.queue_free()
	await _frames(1)
	await _terrain_names_checks(view)


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


func _terrain_names_checks(view: MapView) -> void:
	var globe := extras.globe
	var layer := view.polity_text()
	if layer == null:
		_check(false, "the map has its country names")
		return
	var pitch := tilt.x if tilt != Vector2.ZERO else 55.0
	var bearing := tilt.y if tilt != Vector2.ZERO else 0.0
	view.fly_to_lonlat(8.6, 45.4, 5.0, 0.0)
	view.pitch = pitch
	view.bearing = bearing
	view.call("_after_camera_move")
	await _settle_relief(view)
	await _shoot("terrain-3-names")
	var fill: Color = layer._fill
	var halo: Color = layer._halo
	layer._fill = Color(0.0, 1.0, 0.0, 1.0)
	layer._halo = Color(0.0, 0.0, 0.0, 0.0)
	layer._apply_colors()
	view._cities.visible = false
	main.hud.visible = false
	await _close_notice()
	await _frames(3)
	await RenderingServer.frame_post_draw
	var image := root.get_viewport().get_texture().get_image()
	var size := view.get_viewport_rect().size
	var level := view.zoom_level()
	var apart := 0
	var on_plane := 0
	var on_relief := 0
	var raised := 0
	var raised_drawn := 0
	for label in layer.labels_snapshot():
		if PolityTextLayer.opacity_at(level, float(label["min_zoom"]), 6.2, 0.18, 5.0) < 0.999:
			continue
		var height := float(label["glyph_height"])
		for centre: Vector2 in label["centres"]:
			var sea := globe.project_label_point(centre)
			if sea.x < 24.0 or sea.y < 24.0 or sea.x > size.x - 24.0 or sea.y > size.y - 24.0:
				continue
			var glyph_px := sea.distance_to(globe.project_label_point(centre + Vector2(0.0, height)))
			if glyph_px < 5.0:
				continue
			var reach := 0.4 * glyph_px
			var hit := _ink_within(image, sea, reach)
			if globe.height_at(centre) > 100.0:
				raised += 1
				if hit:
					raised_drawn += 1
			var draped := globe.world_to_screen(centre)
			if sea.distance_to(draped) < glyph_px:
				continue
			apart += 1
			if hit:
				on_plane += 1
			if _ink_within(image, draped, reach):
				on_relief += 1
	layer._fill = fill
	layer._halo = halo
	layer._apply_colors()
	view._cities.visible = true
	main.hud.visible = true
	_check(layer.projected() and apart >= 6 and float(on_plane) >= 0.9 * apart and float(on_relief) <= 0.5 * apart, "over the Alps at pitch %.0f the country names stay a flat plane at sea level, as React's polity text layer draws them, instead of following the relief (of %d glyphs the relief would move by more than their height, %d are on the plane, %d where draping would put them)" % [pitch, apart, on_plane, on_relief])
	_check(raised >= 20 and float(raised_drawn) >= 0.9 * raised, "and they are not hidden where the raised ground stands in front of them, since React draws that layer without a depth test (%d of %d glyphs over raised ground)" % [raised_drawn, raised])
	view.pitch = 0.0
	view.bearing = 0.0
	view.call("_after_camera_move")
	await _frames(2)


func _finish(code: int) -> void:
	finished = true
	_say("failures: %d" % failures.size())
	main.engine.stop()
	await _frames(2)
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
