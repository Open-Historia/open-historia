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
	print("[drawers %6d ms] %s" % [Time.get_ticks_msec() - started, text])


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


func _screen_rect(control: Control) -> Rect2:
	return control.get_global_transform_with_canvas() * Rect2(Vector2.ZERO, control.size)


func _run() -> void:
	await process_frame
	_check(UI.phone(), "the phone layout is on")
	if not await _until(func() -> bool: return main.menu.visible, 120.0):
		_check(false, "the menu appeared")
		_finish(1)
		return
	await _clear_shell()
	await main._start_scenario("default")
	await _wait(3.0)
	main.picker._choose("France")
	await _wait(1.0)
	await main._on_country_chosen("France", "medium")
	var hud: Hud = main.hud
	await _wait(4.0)
	await _advisor(hud)
	await _country(hud)
	_finish(0 if failures.is_empty() else 1)


func _advisor(hud: Hud) -> void:
	var view := root.get_visible_rect().size
	var advisor := hud.drawers["advisor"] as AdvisorPanel
	hud.toggle_drawer("advisor")
	await _until(func() -> bool: return advisor.is_open() and not advisor.is_loading(), 30.0)
	await _wait(1.6)
	await _shoot("d-advisor")
	var rect := _screen_rect(advisor)
	_check(absf(rect.position.x) < 1.0 and absf(rect.size.x - view.x) < 1.0, "the Advisor covers the phone's whole width (%s)" % str(rect))
	_check(absf(rect.position.y) < 1.0 and absf(rect.size.y - view.y) < 1.0, "the Advisor covers the phone's whole height")
	var handle: Control = advisor.get("_handle")
	_check(handle == null or not handle.is_visible_in_tree(), "the Advisor has no resize handle on a phone")
	var mic: Control = advisor.get("_mic")
	_check(mic == null or not mic.is_visible_in_tree(), "the Advisor's microphone is hidden on a phone")
	var close := _close_of(advisor)
	_check(close != null and close.size.x >= UI.PHONE_TAP - 0.5 and close.size.y >= UI.PHONE_TAP - 0.5, "the Advisor's close button is a 44 px target")
	var send: Button = advisor.get("_send_button")
	_check(send != null and send.size.y >= UI.PHONE_TAP - 0.5, "the send button is a 44 px target")
	var trigger: Button = advisor.get("_recipient_trigger")
	if trigger and trigger.is_visible_in_tree():
		trigger.pressed.emit()
		await _wait(0.8)
		await _shoot("d-advisor-contacts")
		var list: Control = advisor.get("_recipient_list")
		if list:
			var list_rect := _screen_rect(list)
			_check(list_rect.end.x <= view.x + 0.5 and list_rect.position.x >= -0.5, "the contact picker stays on screen")
		trigger = advisor.get("_recipient_trigger")
		if trigger:
			trigger.pressed.emit()
		await _wait(0.5)
	var input: TextEdit = advisor.get("_input")
	input.grab_focus()
	input.text = "First line"
	input.set_caret_line(0)
	input.set_caret_column(input.text.length())
	var sent_before: int = (advisor.messages as Array).size()
	for pressed in [true, false]:
		var key := InputEventKey.new()
		key.keycode = KEY_ENTER
		key.physical_keycode = KEY_ENTER
		key.pressed = pressed
		Input.parse_input_event(key)
		await process_frame
	await _wait(0.3)
	_check(input.text.contains("\n") and (advisor.messages as Array).size() == sent_before, "Enter in the composer makes a new line on a phone and does not send")
	OS.set_environment("OH_PHONE_KEYBOARD", "300")
	input.grab_focus()
	await _wait(0.6)
	var field_rect := _screen_rect(input)
	_check(field_rect.end.y <= view.y - 300.0 + 0.5, "the composer sits above the on-screen keyboard (%s)" % str(field_rect))
	await _shoot("d-advisor-keyboard")
	OS.set_environment("OH_PHONE_KEYBOARD", "")
	input.release_focus()
	input.text = ""
	await _wait(0.4)
	var layer := advisor.get_canvas_layer_node()
	_check(layer == null or layer.offset.y == 0.0, "the sheet drops back when the keyboard goes")
	await _back()
	await _wait(0.6)
	_check(not advisor.is_open(), "Back closes the Advisor")


func _country(hud: Hud) -> void:
	var view := root.get_visible_rect().size
	var panel := hud.drawers["country"] as CountryPanel
	await hud.show_country("France")
	await _until(func() -> bool: return not panel.data.is_empty(), 30.0)
	await _wait(2.0)
	var rect := _screen_rect(panel)
	_check(absf(rect.position.x) < 1.0 and absf(rect.size.x - view.x) < 1.0, "the Country dossier covers the phone's whole width (%s)" % str(rect))
	var close := _close_of(panel)
	_check(close != null and close.size.x >= UI.PHONE_TAP - 0.5 and close.size.y >= UI.PHONE_TAP - 0.5, "the dossier's close button is a 44 px target")
	for tab in ["politics", "diplomacy", "economy", "ranking"]:
		if tab != "politics":
			await panel.set_tab(tab)
			await _wait(2.0)
		panel.scroll.scroll_vertical = 0
		await _wait(0.6)
		await _shoot("d-country-" + tab)
		var widest := _widest_right(panel.page)
		_check(widest <= view.x + 0.5, "%s fits the phone's width (rightmost %.1f)" % [tab, widest])
		for step in [1, 2]:
			panel.scroll.scroll_vertical = int(step * (panel.scroll.size.y - 120.0))
			await _wait(0.5)
			await _shoot("d-country-%s-p%d" % [tab, step + 1])
		panel.scroll.scroll_vertical = 0
	await _back()
	await _wait(0.6)
	_check(not panel.is_open(), "Back closes the Country dossier")


func _widest_right(node: Node) -> float:
	var most := 0.0
	for child in node.get_children():
		if child is Control and (child as Control).is_visible_in_tree():
			var control := child as Control
			most = maxf(most, _screen_rect(control).end.x)
			if not (control is ScrollContainer):
				most = maxf(most, _widest_right(control))
	return most


func _close_of(frame: PanelFrame) -> Button:
	var row := frame.header_title.get_parent().get_parent()
	return row.get_child(row.get_child_count() - 1) as Button


func _clear_shell() -> void:
	var shell := main.get("shell") as ShellBoot
	if shell == null:
		return
	await _wait(1.0)
	var setup: Variant = shell.get("first_setup")
	if setup is FirstSetup and is_instance_valid(setup):
		(setup as FirstSetup).finished.emit()
		await _wait(0.8)
	if shell.door_state == "deciding":
		await _until(func() -> bool: return shell.door_state != "deciding", 60.0)
	if shell.door != null and is_instance_valid(shell.door):
		shell.door.opened.emit()
		await _until(func() -> bool: return shell.door == null, 10.0)
	if not shell.notice_updates.is_empty():
		await _until(func() -> bool: return shell.notice != null and is_instance_valid(shell.notice), 5.0)
		if shell.notice != null and is_instance_valid(shell.notice):
			shell.notice.closed.emit()
	await _wait(0.5)
