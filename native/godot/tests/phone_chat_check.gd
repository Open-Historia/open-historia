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
	print("[phone-chat %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _wait(seconds: float) -> void:
	await create_timer(seconds).timeout


func _shoot(shot_name: String) -> void:
	for i in range(4):
		await process_frame
	await RenderingServer.frame_post_draw
	if shots.is_empty():
		return
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(shot_name + ".png"))
	_say("screenshot " + shot_name)


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


func _widest_right(node: Node) -> float:
	var most := 0.0
	for child in node.get_children():
		if child is Control and (child as Control).is_visible_in_tree():
			var control := child as Control
			most = maxf(most, _screen_rect(control).end.x)
			if not (control is ScrollContainer):
				most = maxf(most, _widest_right(control))
	return most


func _find_tooltip(node: Node, tip: String) -> Control:
	if node is Control and (node as Control).tooltip_text == tip:
		return node
	for child in node.get_children():
		var found := _find_tooltip(child, tip)
		if found:
			return found
	return null


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
	await _wait(4.0)
	await _chat()
	_finish(0 if failures.is_empty() else 1)


func _chat() -> void:
	var view_size := root.get_visible_rect().size
	var hud: Hud = main.hud
	var panel := hud.panels.get("chat") as ChatPanel
	hud.set_active_panel("chat")
	await _until(func() -> bool: return panel.loaded and panel.snapshot_taken, 30.0)
	await _wait(1.0)
	await _shoot("pc-chat")
	var rect := _screen_rect(panel)
	_check(absf(rect.position.x - 17.0) < 1.0 and absf(rect.end.x - (view_size.x - 7.0)) < 1.0, "the panel spans the phone's width as beta's does (%s)" % str(rect))
	_check(absf(rect.size.y - minf(800.0, view_size.y - 164.0)) < 1.0, "the panel is beta's phone height (%s)" % str(rect))
	var date_widget: Control = hud.date_widget.get("_pill")
	if date_widget:
		var date_rect := _screen_rect(date_widget)
		_check(date_rect.end.y <= rect.position.y + 0.5, "the date widget stays clear of the panel's header (%s, %s)" % [str(date_rect), str(rect)])
	_check(_widest_right(panel) <= rect.end.x + 0.5, "the contacts screen fits the panel (rightmost %.1f)" % _widest_right(panel))
	var footer: Control = panel.get("_footer")
	var start := footer.get_child(0) as Button
	_check(start.size.y >= UI.PHONE_TAP - 0.5, "Start New Chat is a 44 px target")
	var close := _find_tooltip(panel, "Close diplomacy panel")
	_check(close != null and close.size.x >= UI.PHONE_TAP - 0.5 and close.size.y >= UI.PHONE_TAP - 0.5, "the panel's close button is a 44 px target")
	for key in ["chats", "institutions", "spy"]:
		var tab: Button = panel.get("_tab_buttons")[key]
		if tab.is_visible_in_tree():
			_check(tab.size.y >= UI.PHONE_TAP - 0.5, "the %s tab is a 44 px target" % key)

	panel._open_selector()
	await _until(func() -> bool: return not panel.pickable_loading, 30.0)
	await _wait(0.8)
	await _shoot("pc-chat-new")
	_check(_widest_right(panel._modal) <= rect.end.x + 0.5, "the new-chat picker fits the panel (rightmost %.1f)" % _widest_right(panel._modal))
	_check(panel._modal_grid.columns == 3, "the picker shows three countries a row (%d)" % panel._modal_grid.columns)
	panel._close_selector()
	await _wait(0.4)

	panel.open_chat("Germany", "")
	await _until(func() -> bool: return panel.conversation_visible(), 10.0)
	await _wait(0.8)
	var view := panel.conversation
	await _shoot("pc-chat-thread")
	_check(_widest_right(view) <= rect.end.x + 0.5, "the thread fits the panel (rightmost %.1f)" % _widest_right(view))
	for tip in ["Back to diplomacy", "Edit group title", "Add country to conversation", "Close conversation"]:
		var button := _find_tooltip(view, tip)
		_check(button != null and button.size.y >= UI.PHONE_TAP - 0.5 and button.size.x >= UI.PHONE_TAP - 0.5, "the thread header's %s button is a 44 px target" % tip)
	var title_label: Label = view.get("_title")
	var add_button := _find_tooltip(view, "Add country to conversation")
	_check(_screen_rect(title_label).end.x <= _screen_rect(add_button).position.x + 0.5, "the thread title stops short of Add Country (%s, %s)" % [str(_screen_rect(title_label)), str(_screen_rect(add_button))])
	var send: Button = view.get("_send")
	if send:
		var send_rect := _screen_rect(send)
		_check(send_rect.end.x <= rect.end.x + 0.5 and send.size.x >= UI.PHONE_TAP - 0.5, "the send button is on screen and thumb-wide (%s)" % str(send_rect))
	view._composer.grab_focus()
	view._composer.text = "Hello Berlin, let us talk trade."
	view._composer.set_caret_column(view._composer.text.length())
	view.fit_composer()
	await _wait(0.4)
	await _shoot("pc-chat-draft")
	var before: int = view.messages.size()
	for pressed in [true, false]:
		var key := InputEventKey.new()
		key.keycode = KEY_ENTER
		key.physical_keycode = KEY_ENTER
		key.pressed = pressed
		Input.parse_input_event(key)
		await process_frame
	await _wait(0.4)
	_check(view._composer.text.contains("\n") and view.messages.size() == before, "Enter makes a new line on a phone and does not send")
	await _shoot("pc-chat-reply")
	view._composer.text = "Hello Berlin, let us talk trade."
	view.fit_composer()
	if send:
		send.pressed.emit()
	else:
		view.submit_from_composer()
	await _until(func() -> bool: return not view.loading and view.messages.size() >= before + 2, 60.0)
	await _wait(1.0)
	_check(view.messages.size() >= before + 2, "the send button sends and Germany replies")
	await _shoot("pc-chat-replied")
	_check(_widest_right(view) <= rect.end.x + 0.5, "the replies fit the panel (rightmost %.1f)" % _widest_right(view))

	panel.leave_active()
	await _wait(0.6)
	await _shoot("pc-chat-list")
	_check(_find_tooltip(panel._list_box, "Delete chat") != null, "a contact row shows its delete button without a hover on a phone")
	_check(_widest_right(panel) <= rect.end.x + 0.5, "the contacts list fits the panel (rightmost %.1f)" % _widest_right(panel))
	for key in ["institutions", "spy"]:
		panel._set_view(key)
		await _wait(2.0)
		await _shoot("pc-chat-" + key)
		_check(_widest_right(panel) <= rect.end.x + 0.5, "the %s tab fits the panel (rightmost %.1f)" % [key, _widest_right(panel)])
	panel._set_view("chats")
	await _wait(0.4)
	await _back()
	await _wait(0.6)
	_check(not panel.is_open(), "Back closes the diplomacy panel")
	await _notices(hud)


func _notices(hud: Hud) -> void:
	var view_size := root.get_visible_rect().size
	var notices: ChatNotices = hud.chat_notices
	notices._push({"sender": "Italy", "preview": "Rome would welcome a word about the Mediterranean.", "chatId": ""})
	notices._push({"sender": "Germany", "preview": "Berlin would like to follow up on our talks about trade.", "chatId": ""})
	await _wait(0.8)
	await _shoot("pc-chat-toast")
	var shown: Array = notices._toasts.filter(func(toast: Dictionary) -> bool: return (toast["node"] as Control).visible)
	_check(shown.size() == 1 and shown[0]["item"]["sender"] == "Germany", "a phone shows the newest toast only (%d shown)" % shown.size())
	if shown.size() == 1:
		var toast_rect := _screen_rect(shown[0]["node"] as Control)
		_check(toast_rect.position.x >= -0.5 and toast_rect.end.x <= view_size.x + 0.5, "the toast fits the phone's width (%s)" % str(toast_rect))
		var dismiss := _find_tooltip(shown[0]["node"], "Dismiss")
		_check(dismiss != null and dismiss.size.x >= UI.PHONE_TAP - 0.5 and dismiss.size.y >= UI.PHONE_TAP - 0.5, "the toast's dismiss button is a 44 px target")
		_check(dismiss != null and _screen_rect(dismiss).end.x <= toast_rect.end.x + 0.5, "the dismiss button sits inside the toast")
	notices._center_open = true
	notices._render()
	await _wait(0.8)
	await _shoot("pc-chat-bell-centre")
	var centre: Control = notices.get("_center")
	var centre_rect := _screen_rect(centre)
	_check(centre_rect.position.x >= -0.5 and centre_rect.end.x <= view_size.x + 0.5 and centre_rect.position.y >= 0.0, "the notification list fits the phone (%s)" % str(centre_rect))
	notices.clear()


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
