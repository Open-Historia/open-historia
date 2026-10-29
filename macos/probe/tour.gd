class_name OhTour
extends "res://probes/click_check.gd"

var tag := ""
var emulated := false
var screen_names := PackedStringArray()
var notify_title := ""
var notify_body := ""


func _initialize() -> void:
	tag = OS.get_environment("OH_TOUR_TAG")
	var wanted := OS.get_environment("OH_TOUR_SCREENS")
	if not wanted.is_empty():
		screen_names = wanted.split(",")
	super._initialize()


func _say(text: String) -> void:
	printerr("[click %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _want(part: String) -> bool:
	return super._want(part) and not OS.get_environment("OH_TOUR_SKIP").split(",").has(part)


func _px(point: Vector2) -> Vector2:
	return root.get_final_transform() * point


func _move(point: Vector2) -> Control:
	var at := _px(point)
	var motion := InputEventMouseMotion.new()
	motion.position = at
	motion.global_position = at
	root.push_input(motion)
	return root.gui_get_hovered_control()


func _click(point: Vector2) -> void:
	_move(point)
	await process_frame
	var at := _px(point)
	for pressed in [true, false]:
		var button := InputEventMouseButton.new()
		button.button_index = MOUSE_BUTTON_LEFT
		button.pressed = pressed
		button.button_mask = MOUSE_BUTTON_MASK_LEFT if pressed else 0
		button.position = at
		button.global_position = at
		root.push_input(button)
		await process_frame
	await process_frame


func _images_settled() -> bool:
	var loader: Variant = HubImages._instance
	if not (loader is Node) or not is_instance_valid(loader):
		return true
	return ((loader as Node).get("_waiting") as Dictionary).is_empty() and int((loader as Node).get("_active")) == 0


func _shoot(name: String) -> void:
	if name.begins_with("c-menu"):
		var settled := await _until(_images_settled, 30.0)
		if not settled:
			_say("hub pictures still loading when %s was taken" % name)
		await _wait(0.4)
	await super._shoot(tag + name)
	_say("SHOT %s%s" % [tag, name])
	if screen_names.has(name) or screen_names.has("*"):
		await _screen(name)


func _screen(name: String) -> void:
	if shots.is_empty():
		return
	var file := shots.path_join("screen-%s%s.png" % [tag, name])
	printerr("TOUR-SCREEN %s" % file)
	var found := await _until(func() -> bool: return FileAccess.file_exists(file), 12.0)
	await _wait(0.3)
	if not found:
		_say("no desktop capture came back for %s" % name)


func _sweep(label: String, scope: Node) -> int:
	if label == "vault door":
		await _shoot("t-vault-door")
	elif label == "update notice":
		await _shoot("t-update-notice")
	return await super._sweep(label, scope)


func _display(when: String) -> void:
	var screen := DisplayServer.window_get_current_screen()
	_say("TOUR-DISPLAY %s os=%s renderer=%s driver=%s screen=%d screen_scale=%.2f max_scale=%.2f screen_size=%s usable=%s dpi=%d window=%s root=%s visible=%s content_scale=%.2f emulated=%s hidpi=%s" % [
		when, OS.get_name(), RenderingServer.get_current_rendering_driver_name(), DisplayServer.get_name(), screen,
		DisplayServer.screen_get_scale(screen), DisplayServer.screen_get_max_scale(), str(DisplayServer.screen_get_size(screen)),
		str(DisplayServer.screen_get_usable_rect(screen)), DisplayServer.screen_get_dpi(screen), str(DisplayServer.window_get_size()),
		str(root.size), str(root.get_visible_rect().size), root.content_scale_factor, emulated, DisplayServer.has_feature(DisplayServer.FEATURE_HIDPI)])


func _apply_size() -> void:
	var base := Vector2(1440, 900)
	var wanted := OS.get_environment("OH_TOUR_SIZE")
	if wanted.contains("x"):
		var parts := wanted.split("x")
		base = Vector2(float(parts[0]), float(parts[1]))
	var scale := 1.0
	var asked := OS.get_environment("OH_TOUR_SCALE")
	if not asked.is_empty():
		scale = maxf(1.0, float(asked))
	var native := 1.0
	if OS.get_name() == "macOS":
		native = maxf(1.0, DisplayServer.screen_get_max_scale())
	if native > 1.0:
		DisplayServer.window_set_size(Vector2i((base * native).round()))
		_check("the UI is scaled to the Retina screen", is_equal_approx(root.content_scale_factor, native), "content scale %.2f on a %.2fx screen" % [root.content_scale_factor, native])
	elif scale > 1.0:
		emulated = true
		await _wait(1.5)
		DisplayServer.window_set_size(Vector2i((base * scale).round()))
		root.content_scale_factor = scale
	else:
		DisplayServer.window_set_size(Vector2i(base.round()))
	await _wait(1.0)
	var screen := DisplayServer.window_get_current_screen()
	var usable := DisplayServer.screen_get_usable_rect(screen)
	var size := DisplayServer.window_get_size()
	DisplayServer.window_set_position(usable.position + (usable.size - size) / 2)
	await _wait(0.5)


func _run() -> void:
	var up := await _until(func() -> bool: return main.menu.visible, 180.0)
	await _display("boot")
	if not up:
		_check("the menu appears", false)
		_finish()
		return
	await _apply_size()
	await _display("sized")
	await _clear_shell()
	if emulated:
		root.content_scale_factor = float(OS.get_environment("OH_TOUR_SCALE"))
	await _until(func() -> bool: return bool(main.menu.get("loaded")), 30.0)
	await _wait(1.0)
	await _shoot("t-menu-after-door")
	if _want("menu"):
		await _menu_part()
	if _want("settings"):
		await _settings_part()
	if _want("history"):
		await _history_part()
	if _want("editor"):
		await _editor_part()
	if _want("game"):
		await _new_game_part()
		if main.in_game:
			await _prompt_part()
			await _hud_part()
			await _game_menu_part()
			if _want("notify"):
				await _notify_part()
			if _want("war"):
				await _war_part()
			if _want("gestures"):
				await _gesture_part()
	await _display("end")
	_finish()


func _notice_items(chat_id: String) -> Array:
	var notices: Control = main.hud.chat_notices
	return (notices.get("_items") as Array).filter(func(item: Variant) -> bool: return str((item as Dictionary).get("chatId", "")) == chat_id)


func _notify_part() -> void:
	var hud: Hud = main.hud
	var notices: Control = hud.chat_notices
	if notices == null:
		_check("the chat notices are there", false)
		return
	var panel: Variant = notices.get("chat_panel")
	var date := str((panel as Object).get("game_date")) if panel is Object else ""
	var chat_id := "chat-tour-notify"
	var first := {"id": "msg-tour-1", "role": "leader", "speaker": "Germany", "code": "DEU", "text": "Berlin would welcome talks on the Rhine crossings.", "time": date}
	await main.engine.request("chat.create", {"chat": {"id": chat_id, "countries": [{"name": "Germany", "code": "DEU"}], "messages": [first], "status": "open"}})
	var toasted := await _until(func() -> bool: return not _notice_items(chat_id).is_empty(), 20.0)
	_check("an incoming letter is toasted in the window", toasted)
	await _wait(1.0)
	await _shoot("n-1-toast")
	var bell: Control = notices.get("_bell")
	await _press(bell, "the notification bell")
	await _wait(0.8)
	await _sweep("notification centre", notices)
	await _shoot("n-2-centre")
	await _press(notices.get("_desktop_button"), "the Desktop notifications button")
	var granted := await _until(func() -> bool: return str(notices.get("_desktop_permission")) == "granted", 10.0)
	_check("a real click turns desktop notifications on", granted, str(notices.get("_desktop_permission")))
	await _wait(0.4)
	await _shoot("n-3-desktop-on")
	await _press(bell, "the notification bell again")
	await _wait(0.6)
	DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_MINIMIZED)
	var minimised := await _until(func() -> bool: return DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_MINIMIZED and bool(main.get("_minimized")), 15.0)
	_check("the window minimises and the game sees it", minimised, "mode %d" % DisplayServer.window_get_mode())
	await _wait(1.5)
	notify_title = "Open Historia — Germany"
	notify_body = "Berlin asks for an answer on the Rhine crossings by Friday."
	var second := {"id": "msg-tour-2", "role": "leader", "speaker": "Germany", "code": "DEU", "text": notify_body, "time": date}
	await main.engine.request("chat.patch", {"id": chat_id, "set": {"messages": [first, second]}})
	printerr("TOUR-NOTIFY title=%s|body=%s" % [notify_title, notify_body])
	var queued := await _until(func() -> bool: return _notice_items(chat_id).size() >= 2, 25.0)
	_check("the letter that arrives while minimised reaches the notices", queued)
	await _wait(5.0)
	DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED)
	var back := await _until(func() -> bool: return DisplayServer.window_get_mode() != DisplayServer.WINDOW_MODE_MINIMIZED and not bool(main.get("_minimized")), 15.0)
	_check("the window comes back", back, "mode %d" % DisplayServer.window_get_mode())
	DisplayServer.window_move_to_foreground()
	await _wait(1.5)
	await _shoot("n-4-restored")
	notices.call("clear")
	await _wait(0.4)


func _map_state() -> String:
	var map: MapView = main.map_view
	return "zoom=%.4f pitch=%.2f bearing=%.2f centre=%s" % [map.camera.zoom.x, map.pitch, map.bearing, str(map.camera.position.round())]


func _gesture(event: InputEventGesture, count: int, at: Vector2) -> void:
	for i in range(count):
		var copy := event.duplicate() as InputEventGesture
		copy.position = _px(at)
		root.push_input(copy)
		await process_frame


func _gesture_part() -> void:
	var hud: Hud = main.hud
	var map: MapView = main.map_view
	hud.set_active_panel("")
	hud.map_cards.dismiss_all()
	await _wait(1.0)
	var centre := root.get_visible_rect().size * Vector2(0.5, 0.46)
	_move(centre)
	await _wait(0.5)
	var hovered := root.gui_get_hovered_control()
	_say("gestures over %s" % _path(hovered))
	var start_zoom := map.camera.zoom.x
	_say("GESTURE before %s" % _map_state())
	await _shoot("g-0-before")
	var scroll := InputEventPanGesture.new()
	scroll.delta = Vector2(0.0, -0.35)
	await _gesture(scroll, 20, centre)
	await _wait(1.2)
	_say("GESTURE two-finger zoom %s" % _map_state())
	_check("a two-finger scroll zooms the map in", map.camera.zoom.x > start_zoom * 1.05, _map_state())
	await _shoot("g-1-two-finger-zoom")
	var start_pitch := map.pitch
	var tilt := InputEventPanGesture.new()
	tilt.shift_pressed = true
	tilt.delta = Vector2(0.02, 0.09)
	await _gesture(tilt, 24, centre)
	await _wait(1.0)
	_say("GESTURE shift tilt %s" % _map_state())
	_check("Shift with a two-finger scroll tilts the map", map.pitch > start_pitch + 10.0, _map_state())
	await _shoot("g-2-shift-tilt")
	var pinch_from := map.camera.zoom.x
	var pinch := InputEventMagnifyGesture.new()
	pinch.factor = 1.02
	await _gesture(pinch, 40, centre)
	await _wait(1.2)
	_say("GESTURE pinch %s" % _map_state())
	_check("a pinch zooms the map in", map.camera.zoom.x > pinch_from * 1.05, _map_state())
	await _shoot("g-3-pinch")
	var undo := InputEventPanGesture.new()
	undo.shift_pressed = true
	undo.delta = Vector2(-0.02, -0.09)
	await _gesture(undo, 24, centre)
	var out := InputEventMagnifyGesture.new()
	out.factor = 0.98
	await _gesture(out, 40, centre)
	await _wait(1.2)
	_say("GESTURE back %s" % _map_state())
