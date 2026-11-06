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
	print("[phone-hud %6d ms] %s" % [Time.get_ticks_msec() - started, text])


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


func _rect(control: Control) -> Rect2:
	return control.get_global_rect() if control and is_instance_valid(control) else Rect2()


func _near(a: float, b: float, slack := 2.0) -> bool:
	return absf(a - b) <= slack


func _shown(control: Control) -> bool:
	return control != null and is_instance_valid(control) and control.is_visible_in_tree()


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
	await _shoot("h-hud")
	await _hud_checks(hud)
	hud.date_widget.toggle_panel("skip")
	await _wait(1.0)
	await _shoot("h-time-skip")
	_bottom_panel_checks(hud.date_widget.timeline, "the Timeline")
	hud.date_widget.toggle_panel("history")
	await _wait(1.0)
	await _shoot("h-events")
	_bottom_panel_checks(hud.date_widget.events_panel, "the Events panel")
	await _back()
	await _wait(0.6)
	_check(hud.active_panel.is_empty() and hud.date_widget.open_panel.is_empty(), "Back closes the Events panel")
	hud.toggle_dock("chat")
	await _wait(1.0)
	await _shoot("h-chat")
	_check(_launcher_open(hud, "chat"), "the Chat launcher shows the open panel")
	hud.set_active_panel("")
	await _wait(0.5)
	hud.toggle_drawer("advisor")
	await _wait(1.2)
	_check(_near(hud._right_layer.position.x, 0.0) and _near(_rect(hud.date_widget.get("_pill") as Control).end.x, root.get_visible_rect().size.x - 8.0, 1.5), "the HUD does not slide over for a drawer on a phone")
	var advisor_drawer := hud.drawers.get("advisor") as Control
	_check(advisor_drawer != null and advisor_drawer.get_index() > hud.date_widget.get_index(), "a drawer covers the date widget on a phone")
	await _shoot("h-advisor")
	hud.toggle_dock("actions")
	await _wait(0.8)
	_check(hud.open_drawer.is_empty(), "a bottom panel puts the Advisor away on a phone")
	hud.set_active_panel("")
	await _wait(0.5)
	var name_button := hud.date_widget.get("_country_button") as Button
	_check(name_button != null and _shown(name_button), "the country name in the date widget is a button on a phone")
	if name_button:
		name_button.pressed.emit()
		await _wait(2.0)
		_check(hud.open_drawer == "country", "the country name opens the Country drawer")
		await _shoot("h-country")
		name_button.pressed.emit()
		await _wait(0.8)
		_check(hud.open_drawer.is_empty(), "the country name closes the Country drawer again")
	await _region_card(hud)
	await _war_room_button(hud)
	_finish(0 if failures.is_empty() else 1)


func _war_room_button(hud: Hud) -> void:
	var button := main.get("war_room_button") as Control
	if button == null:
		_check(false, "the War room button is mounted")
		return
	var was: bool = button.get("at_war")
	button.set("at_war", true)
	button.call("_apply")
	hud.set_beside_war_room(true)
	await _wait(0.6)
	var view := root.get_visible_rect().size
	var r := _rect(button)
	_check(_shown(button) and _near(r.position.x, 8.0) and _near(r.size.x, 48.0) and _near(r.end.y, view.y - 77.6, 1.5), "on a phone the War room button stands above the dock")
	_check(_near(_rect(hud.search_slot).position.x, hud.beside_dock_left()), "on a phone Search stays beside the dock while the War room button shows")
	await _shoot("h-war-room-button")
	button.set("at_war", was)
	button.call("_apply")
	hud.set_beside_war_room(was)


func _launcher_open(hud: Hud, name: String) -> bool:
	return hud.active_panel == name


func _hud_checks(hud: Hud) -> void:
	var view := root.get_visible_rect().size
	var menu := hud.get("_menu_frame") as Control
	var home := hud.get("_exit_frame") as Control
	var pill := hud.get("_pill_frame") as Control
	_check(_shown(menu) and _near(_rect(menu).position.x, 8.0) and _near(_rect(menu).position.y, 8.0) and _near(_rect(menu).size.x, 51.2, 1.0), "the game menu button is 3.2rem at the top left")
	_check(_shown(home) and _near(_rect(home).position.y, 64.0) and _near(_rect(home).size.x, 51.2, 1.0), "the home button stands under the game menu button")
	_check(not _shown(pill), "the Open Historia pill is left out on a phone")
	var widget := hud.date_widget.get("_pill") as Control
	var wr := _rect(widget)
	_check(_near(wr.size.x, minf(384.0, view.x - 72.0), 1.5) and _near(wr.end.x, view.x - 8.0, 1.5) and _near(wr.size.y, 51.2, 1.0), "the date widget spans the top row beside the menu button")
	var country := hud.date_widget.get("_country_label") as Label
	var date := hud.date_widget.get("_date_label") as Label
	_check(_shown(country) and _shown(date) and _rect(country).position.y < _rect(date).position.y, "the country name sits over the date")
	_check(date.text.begins_with("Jan 1st"), "the date is in the short phone form (%s)" % date.text)
	_check(not _shown(hud._flag_frame), "the country badge is hidden on a phone")
	var advisor := _rect(hud._advisor_frame)
	_check(_near(advisor.size.x, 51.2, 1.0) and _near(advisor.end.x, view.x - 8.0, 1.5) and _near(advisor.end.y, view.y - 57.6, 1.5), "the Advisor button is 3.2rem above the map switch")
	var toggle := hud.get("_mode_frame") as Control
	var tr := _rect(toggle)
	_check(_near(tr.end.x, view.x - 8.0, 1.5) and _near(tr.end.y, view.y - 8.0, 1.5) and tr.size.x < 100.0, "the map switch is icon-only in the bottom right")
	var dock := _rect(hud._dock)
	_check(_near(dock.position.x, 8.0) and _near(dock.end.y, view.y - 8.0, 1.5) and _near(dock.size.y, 64.0, 1.0), "the launcher dock sits bottom left")
	var search := _rect(hud.search_slot)
	_check(search.position.x > dock.end.x and search.end.x < tr.position.x, "Search sits between the dock and the map switch")


func _bottom_panel_checks(panel: PanelFrame, what: String) -> void:
	var view := root.get_visible_rect().size
	var r := _rect(panel)
	_check(panel.is_open() and _near(r.position.x, 8.0) and _near(r.end.x, view.x - 8.0, 1.5), what + " fits the phone's width")
	_check(_near(r.end.y, view.y - 78.4, 2.0), what + " stands above the dock")


func _region_card(hud: Hud) -> void:
	hud.toggle_dock("actions")
	await _wait(1.0)
	var at := Vector2(root.get_visible_rect().size.x * 0.72, 160.0)
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
	await _until(func() -> bool: return hud.map_cards._floating != null, 20.0)
	await _wait(0.8)
	_check(hud.map_cards._floating != null, "a long press opens the region card")
	_check(hud.active_panel.is_empty(), "the region card puts the open bottom panel away")
	await _shoot("h-region")
	var card := hud.map_cards._floating as Control
	if card:
		var view := root.get_visible_rect().size
		var r := _rect(card)
		_check(_near(r.position.x, 8.0, 2.0) and _near(r.end.x, view.x - 8.0, 2.0), "the region card is a sheet the phone's width")
	hud.toggle_dock("chat")
	await _wait(0.8)
	_check(hud.map_cards._floating == null, "a bottom panel puts the region card away")
	hud.set_active_panel("")


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
