extends SceneTree

var main: Node
var shots := ""
var started := 0
var failures: PackedStringArray = []


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
	print("[phone %6d ms] %s" % [Time.get_ticks_msec() - started, text])


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


func _back() -> void:
	main.phone_shell.back()
	for i in range(6):
		await process_frame


func _run() -> void:
	await process_frame
	_check(UI.phone(), "the phone layout is on")
	var size := root.get_visible_rect().size
	_say("viewport %s factor %.3f window %s" % [str(size), root.content_scale_factor, str(DisplayServer.window_get_size())])
	_check(absf(size.x - UI.phone_preview().x) < 2.0, "the viewport is the phone's width in density-independent pixels")
	if not await _until(func() -> bool: return main.menu.visible, 120.0):
		_check(false, "the menu appeared")
		_finish(1)
		return
	await _clear_shell()
	await _wait(1.0)
	await _shoot("p-menu")
	main.menu.call("_show_page", "scenarios")
	await _wait(2.5)
	await _shoot("p-scenarios")
	main.menu.call("_show_page", "games")
	await _wait(1.5)
	await _shoot("p-games")
	await main._start_scenario("default")
	await _wait(3.0)
	await _shoot("p-picker")
	await _pinch_picker()
	main.picker._choose("France")
	await _wait(1.0)
	await _shoot("p-picker-chosen")
	await main._on_country_chosen("France", "medium")
	var hud: Hud = main.hud
	await _wait(4.0)
	await _shoot("p-hud")
	hud.toggle_drawer("advisor")
	await _wait(1.6)
	await _shoot("p-advisor")
	await _back()
	await _wait(0.6)
	_check(not (hud.drawers["advisor"] as PanelFrame).is_open(), "Back closes the Advisor")
	await hud.show_country("France")
	await _wait(2.0)
	await _shoot("p-country")
	await _back()
	await _wait(0.6)
	_check(not (hud.drawers["country"] as PanelFrame).is_open(), "Back closes the Country drawer")
	if main.game_menu:
		main.game_menu.call("open_app_settings")
		await _wait(1.5)
		await _shoot("p-settings")
		await _back()
		await _wait(0.8)
	await _back()
	await _wait(0.5)
	_check(main.phone_shell.asking, "Back with nothing open asks before leaving")
	await _shoot("p-leave")
	await _back()
	await _wait(0.5)
	_check(not main.phone_shell.asking, "Back again keeps the game")
	await _hold_on_map(hud)
	_finish(0 if failures.is_empty() else 1)


func _touch(index: int, at: Vector2, pressed: bool) -> void:
	var touch := InputEventScreenTouch.new()
	touch.index = index
	touch.position = at
	touch.pressed = pressed
	Input.parse_input_event(touch)


func _pinch_picker() -> void:
	var picker: CountryPicker = main.picker
	var area: Control = picker.get("_container")
	var camera: Camera2D = picker.get("_camera")
	if area == null or camera == null or not area.is_visible_in_tree():
		_check(false, "the picker's map is shown")
		return
	var centre := area.get_global_rect().get_center()
	var before := camera.zoom.x
	_touch(0, centre - Vector2(30, 0), true)
	_touch(1, centre + Vector2(30, 0), true)
	await process_frame
	for step in range(1, 9):
		var gap := 30.0 + 10.0 * step
		for finger in [0, 1]:
			var drag := InputEventScreenDrag.new()
			drag.index = finger
			drag.position = centre + Vector2(gap if finger == 1 else -gap, 0)
			drag.relative = Vector2(10 if finger == 1 else -10, 0)
			Input.parse_input_event(drag)
		await process_frame
	_touch(0, centre - Vector2(110, 0), false)
	_touch(1, centre + Vector2(110, 0), false)
	await _wait(0.4)
	_say("picker zoom %.3f -> %.3f" % [before, camera.zoom.x])
	_check(camera.zoom.x > before * 2.5, "two fingers spread on the picker's map zoom it in")
	await _shoot("p-picker-pinched")
	picker.call("_zoom", centre - area.get_global_rect().position, before / camera.zoom.x)


func _clear_shell() -> void:
	var shell := main.get("shell") as ShellBoot
	if shell == null:
		return
	await _wait(1.0)
	var setup: Variant = shell.get("first_setup")
	if setup is FirstSetup and is_instance_valid(setup):
		await _shoot("p-setup")
		(setup as FirstSetup).finished.emit()
		await _wait(0.8)
	if shell.door_state == "deciding":
		await _until(func() -> bool: return shell.door_state != "deciding", 60.0)
	if shell.door != null and is_instance_valid(shell.door):
		await _shoot("p-door")
		shell.door.opened.emit()
		await _until(func() -> bool: return shell.door == null, 10.0)
	if not shell.notice_updates.is_empty():
		await _until(func() -> bool: return shell.notice != null and is_instance_valid(shell.notice), 5.0)
		if shell.notice != null and is_instance_valid(shell.notice):
			await _shoot("p-notice")
			shell.notice.closed.emit()
	await _wait(0.5)


func _hold_on_map(hud: Hud) -> void:
	hud.map_cards.dismiss_all()
	var held := [false]
	main.map_view.region_held.connect(func(_index: int, _at: Vector2) -> void: held[0] = true)
	var at := root.get_visible_rect().size * 0.5
	var press := InputEventScreenTouch.new()
	press.index = 0
	press.position = at
	press.pressed = true
	Input.parse_input_event(press)
	await _wait(0.9)
	var release := InputEventScreenTouch.new()
	release.index = 0
	release.position = at
	release.pressed = false
	Input.parse_input_event(release)
	_check(held[0], "a long press on the map is seen as a hold")
	await _until(func() -> bool: return hud.map_cards._floating != null, 20.0)
	await _wait(0.6)
	_check(hud.map_cards._floating != null, "a long press on the map opens the region card")
	await _shoot("p-hold")
