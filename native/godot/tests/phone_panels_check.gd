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
	print("[phone-panels %6d ms] %s" % [Time.get_ticks_msec() - started, text])


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


func _rect(control: Control) -> Rect2:
	return control.get_global_rect() if control and is_instance_valid(control) else Rect2()


func _near(a: float, b: float, slack := 2.0) -> bool:
	return absf(a - b) <= slack


func _shown(control: Control) -> bool:
	return control != null and is_instance_valid(control) and control.is_visible_in_tree()


func _texts(node: Node, out: PackedStringArray) -> PackedStringArray:
	if node is Label:
		out.append((node as Label).text)
	elif node is Button:
		out.append((node as Button).text)
	elif node is RichTextLabel:
		out.append((node as RichTextLabel).get_parsed_text())
	for child in node.get_children():
		_texts(child, out)
	return out


func _has_text(node: Node, text: String) -> bool:
	if node == null or not is_instance_valid(node):
		return false
	for value in _texts(node, PackedStringArray()):
		if value.contains(text):
			return true
	return false


func _find_label(node: Node, text: String) -> Label:
	if node == null:
		return null
	for child in node.get_children():
		if child is Label and (child as Label).text == text and (child as Label).is_visible_in_tree():
			return child as Label
		var found := _find_label(child, text)
		if found:
			return found
	return null


func _find_button(node: Node, text: String) -> Button:
	if node == null:
		return null
	for child in node.get_children():
		if child is Button:
			var button := child as Button
			if button.text == text or button.tooltip_text == text:
				return button
			for label in button.find_children("*", "Label", true, false):
				if (label as Label).text == text:
					return button
		var found := _find_button(child, text)
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
	var hud: Hud = main.hud
	await _actions(hud)
	await _projects(hud)
	await _social(hud)
	_finish(0 if failures.is_empty() else 1)


func _bottom_box(panel: Control, what: String) -> void:
	var view := root.get_visible_rect().size
	var r := _rect(panel)
	_check(_near(r.position.x, 8.0) and _near(r.end.x, view.x - 8.0, 1.5), "%s fits the phone's width (%.1f to %.1f)" % [what, r.position.x, r.end.x])
	_check(_near(r.end.y, view.y - 78.0, 2.0), "%s stands above the dock (%.1f)" % [what, r.end.y])
	var tall := minf(view.y - 144.0, maxf(view.y - 256.0, 480.0))
	_check(_near(r.size.y, tall, 2.0), "%s is min(screen - 9rem, max(screen - 16rem, 30rem)) tall (%.1f of %.1f)" % [what, r.size.y, tall])


func _actions(hud: Hud) -> void:
	hud.toggle_dock("actions")
	await _wait(1.2)
	var panel := hud.panels.get("actions") as ActionsPanel
	if panel == null:
		_check(false, "the Actions panel is mounted")
		return
	panel.set_tab("actions")
	await _wait(0.8)
	await _shoot("p-actions")
	_bottom_box(panel, "the Actions panel")
	var tabs: Dictionary = panel._tab_buttons
	var actions_tab := tabs["actions"] as Button
	var projects_tab := tabs["projects"] as Button
	_check(_rect(actions_tab).size.y >= 43.5 and _rect(projects_tab).size.y >= 43.5, "the Actions and Projects tabs are finger-sized (%.1f)" % _rect(actions_tab).size.y)
	_check(_rect(actions_tab).end.x < _rect(projects_tab).position.x, "Actions comes before Projects")
	_check(_shown(panel._goal_holder) and _rect(panel._goal_holder).end.y <= _rect(panel._brainstorm).position.y, "the standing goal sits over Brainstorm and AI Suggestions")
	_check(_near(_rect(panel._brainstorm).position.y, _rect(panel._suggest_button).position.y) and _near(_rect(panel._brainstorm).size.x, _rect(panel._suggest_button).size.x, 1.5), "Brainstorm and AI Suggestions share a row half and half")
	_check(_rect(panel._brainstorm).size.y >= 43.5, "Brainstorm is finger-sized (%.1f)" % _rect(panel._brainstorm).size.y)
	_check(_find_label(panel, "No actions submitted yet.") != null, "an empty queue says so")
	_check(panel._composer.placeholder_text == "Enter your action…", "the composer's hint leaves out Shift+Enter on a phone")
	_check(_rect(panel._submit_button).size.x >= 43.5 and _rect(panel._improve_button).size.x >= 43.5, "send and improve are finger-sized")
	var r := _rect(panel)
	_check(_rect(panel._submit_button).end.x <= r.end.x - 15.0 and _rect(panel._composer).position.x >= r.position.x + 15.0, "the composer row keeps its padding inside the panel")
	await main.engine.request("actions.testSeed", {"actions": [
		{"id": "phone-1", "kind": "action", "title": "Recall the ambassador from Rome", "text": "Recall the ambassador from Rome for consultations.", "source": "manual", "status": "planned"},
		{"id": "phone-2", "kind": "action", "title": "Raise the defence budget", "text": "Raise the defence budget by two percent of GDP over the next three years.", "source": "manual", "status": "planned"},
	]})
	await _until(func() -> bool: return _find_label(panel, "No actions submitted yet.") == null, 8.0)
	await _wait(0.6)
	await _shoot("p-actions-queued")
	_check(_has_text(panel, "Recall the ambassador from Rome"), "a queued order shows in the list")
	panel._suggest_button.pressed.emit()
	await _until(func() -> bool: return not panel._is_suggesting, 120.0)
	await _wait(0.8)
	await _shoot("p-actions-suggested")
	_check(_find_label(panel, "SUGGESTED ACTIONS") != null, "the suggested section opens")
	_check(panel.scroll.vertical_scroll_mode != ScrollContainer.SCROLL_MODE_DISABLED, "on a phone the Actions body scrolls as one")
	panel._composer.text = "Open talks with Germany on a joint energy purchase."
	panel._composer.text_changed.emit()
	await _wait(0.3)
	await _shoot("p-actions-draft")
	_check(not panel._submit_button.disabled, "a typed order can be sent")
	panel._composer.text = ""
	panel._composer.text_changed.emit()


func _projects(hud: Hud) -> void:
	var panel := hud.panels.get("actions") as ActionsPanel
	if panel == null:
		return
	panel.set_tab("projects")
	await _wait(1.5)
	await _shoot("p-projects")
	_bottom_box(panel, "the Projects board")
	var board := panel.board()
	_check(board != null and _find_label(board, "Nothing on the board yet") != null, "the empty board shows its card")
	var ask := _find_button(board, "🧭 Ask your advisor to populate this")
	_check(ask != null and _rect(ask).size.y >= 43.5, "the advisor button is finger-sized")
	if board:
		var empty_card := ask.get_parent() as Control if ask else null
		while empty_card and not (empty_card is PanelContainer):
			empty_card = empty_card.get_parent() as Control
		var pr := _rect(panel)
		var cr := _rect(empty_card)
		_check(empty_card != null and cr.position.x >= pr.position.x + 15.0 and cr.end.x <= pr.end.x - 15.0, "the empty card fits inside the board's padding (%.1f to %.1f)" % [cr.position.x, cr.end.x])
	var view: Dictionary = (await main.engine.request("game.view")).get("result", {})
	var today := str(view.get("gameDate", ""))
	var ops := [
		{"op": "create", "name": "Grand Paris Rail Link", "kind": "project", "status": "active", "priority": "high", "summary": "A new high-speed line tying the capital to the northern ports.", "tags": ["infrastructure", "economy"], "progress": 35, "startedAt": _shift(today, -200), "targetDate": _shift(today, 400), "milestones": [{"title": "Tunnel boring complete", "date": _shift(today, 20), "status": "pending"}], "lastUpdate": "Boring machines reached the Seine crossing.", "focus": {"lng": 2.35, "lat": 48.85}},
		{"op": "create", "name": "Operation Mistral", "kind": "operation", "status": "stalled", "secrecy": "covert", "summary": "Covert support for a friendly faction abroad.", "tags": ["covert", "military"], "progress": 60, "startedAt": _shift(today, -300), "targetDate": _shift(today, -12)},
		{"op": "create", "name": "Baltic Shipyard Expansion", "kind": "project", "ownerCode": "Germany", "status": "active", "verification": "doubted", "summary": "Germany is said to be doubling the yards at Kiel.", "tags": ["naval", "military"], "progress": 20, "ongoing": true, "startedAt": _shift(today, -90)},
	]
	await main.engine.request("projects.testSeed", {"ops": ops})
	if board:
		await _until(func() -> bool: return int(board._view.get("total", 0)) == 3, 8.0)
	await _wait(0.8)
	await _shoot("p-projects-board")
	if board:
		var pr := _rect(panel)
		var widest := 0.0
		for node in board.find_children("*", "Control", true, false):
			var c := node as Control
			if c.is_visible_in_tree() and _rect(c).end.x > widest:
				widest = _rect(c).end.x
		_check(widest <= pr.end.x + 0.5, "nothing on the board is wider than the phone (%.1f of %.1f)" % [widest, pr.end.x])
	hud.set_active_panel("")
	await _wait(0.6)


func _shift(date: String, days: int) -> String:
	var parts := date.split("-")
	if parts.size() < 3:
		return date
	var unix := Time.get_unix_time_from_datetime_dict({"year": int(parts[0]), "month": int(parts[1]), "day": int(parts[2])}) + days * 86400
	return Time.get_date_string_from_unix_time(unix)


func _social(hud: Hud) -> void:
	hud.toggle_dock("social")
	var panel := hud.panels.get("social") as RostraPanel
	if panel == null:
		_check(false, "Rostra is mounted")
		return
	await _until(func() -> bool: return panel.is_open() and not panel.view.is_empty(), 20.0)
	await _wait(0.8)
	await _shoot("p-social")
	_bottom_box(panel, "Rostra")
	_check(not panel.framed, "on a phone Rostra has no phone frame")
	_check(_shown(panel._header_date) and panel._header_date.text == "1 Jan 2016", "the header shows the date (%s)" % panel._header_date.text)
	_check(_rect(panel._pen).size.x >= 43.5 and _rect(panel._close).size.x >= 43.5, "the pen and close buttons are finger-sized")
	_check(_rect(panel._pen).end.x <= _rect(panel._close).position.x, "the pen comes before close")
	_check(_has_text(panel, "Nothing has been posted yet.") and _has_text(panel, "One AI request"), "an empty feed offers Refresh")
	var refresh := _find_button(panel._feed, "Refresh")
	_check(refresh != null and _rect(refresh).size.y >= 43.5, "Refresh is finger-sized")
	var tabs: Array = []
	for key in ["all", "search", "mentions", "mine"]:
		tabs.append(panel._tab_buttons[key])
	var ordered := true
	for i in range(1, tabs.size()):
		ordered = ordered and _rect(tabs[i - 1]).end.x <= _rect(tabs[i]).position.x + 0.5
	_check(ordered and _near(_rect(tabs[3]).end.y, _rect(panel).end.y - 6.0, 3.0), "For you, Search, Mentions and Your posts run along the bottom")
	if refresh:
		refresh.pressed.emit()
	await _until(func() -> bool: return (panel.view.get("posts", []) as Array).size() > 0, 30.0)
	await _wait(0.8)
	await _shoot("p-social-feed")
	_check(_has_text(panel, "Olaf Scholz"), "Refresh fills the feed")
	var widest := 0.0
	for node in panel._feed.find_children("*", "Control", true, false):
		var c := node as Control
		if c.is_visible_in_tree() and _rect(c).end.x > widest:
			widest = _rect(c).end.x
	_check(widest <= _rect(panel).end.x + 0.5, "no post is wider than the phone (%.1f)" % widest)
	panel._pen.pressed.emit()
	await _wait(0.5)
	await _shoot("p-social-compose")
	_check(panel._composer.visible, "the pen opens the box")
	panel._pen.pressed.emit()
	await _wait(0.3)
	panel._set_tab("search")
	await _wait(0.8)
	await _shoot("p-social-search")
	panel._set_tab("all")
	hud.set_active_panel("")
	await _wait(0.5)


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
