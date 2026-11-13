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
	print("[phone-cheats %6d ms] %s" % [Time.get_ticks_msec() - started, text])


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
	await _until(func() -> bool: return main.cheats != null and main.cheats.engine != null, 20.0)
	await _wait(3.0)
	var cheats = main.cheats
	await cheats.open()
	await _wait(0.8)
	_check(cheats.is_open(), "the Cheats panel opens")
	var hud: Hud = main.hud
	_check(cheats.get_index() == hud.get_child_count() - 1, "on a phone the Cheats panel stands over the dock and the Advisor button")
	await _placed(cheats, "the Cheats home")
	await _shoot("pc-cheats-home")
	var close := _find_button(cheats, "Close cheats")
	_check(close != null and _rect(close).size.x >= 43.5 and _rect(close).size.y >= 43.5, "the Cheats close button is finger-sized")
	var saved: Dictionary = await main.engine.request("cheats.history.save", {"draft": "The Republic stood firm through the winter of 2016. Paris kept its markets open and the ministries met every week."})
	_check(saved.get("ok", false), "a history document is written")
	await cheats._go("history-document")
	await _wait(1.0)
	_check(_has_text(cheats, "events in the timeline.") and _has_text(cheats, "Reset compression"), "the History Document opens")
	await _placed(cheats, "the History Document")
	var back := _find_button(cheats, "Back to the cheat tools")
	_check(back != null and _rect(back).size.x >= 43.5, "the back arrow is finger-sized")
	await _shoot("pc-cheats-history")
	var scroll: ScrollContainer = cheats._scroll
	scroll.scroll_vertical = 100000
	await _wait(0.5)
	await _shoot("pc-cheats-history-p2")
	scroll.scroll_vertical = 0
	cheats._s["gm_text"] = ""
	cheats._s["gm_view"] = {}
	await cheats._go("master-ai")
	await _wait(0.8)
	_check(_has_text(cheats, "Auto - Recommended"), "the GM Console opens on Auto")
	await _placed(cheats, "the GM Console")
	await _shoot("pc-cheats-gm")
	var routed: Dictionary = await cheats.gm_preview("France opens a national library annex in Paris.", "auto")
	await _wait(1.0)
	_check(routed.get("ok", false) and _has_text(cheats, "Auto mode selected:"), "Auto says which mode it chose")
	var node: Control = cheats._gm_preview_node
	if node:
		scroll.scroll_vertical = int(node.position.y) - 40
	await _wait(0.4)
	await _placed(cheats, "the GM preview")
	await _shoot("pc-cheats-gm-preview")
	cheats._s["gm_view"] = {}
	await cheats._go("events")
	await _wait(1.0)
	await _placed(cheats, "the events tool")
	await _shoot("pc-cheats-events")
	_finish(0 if failures.is_empty() else 1)


func _placed(cheats: Node, what: String) -> void:
	var view := root.get_visible_rect().size
	var inset := UI.safe_insets()
	var panel: Control = cheats._panel
	var r := _rect(panel)
	_check(_near(r.end.x, view.x - 10.0 - inset.z, 1.0) and _near(r.size.x, view.x - 16.0, 1.0), "%s stands 0.65rem from the right, the phone's width less 1rem (%s)" % [what, str(r)])
	_check(_near(r.position.y, 76.0 + inset.y, 1.0) and r.end.y <= view.y - 15.5, "%s hangs under the top bar and ends 1rem over the foot" % what)
	var widest := 0.0
	for found in panel.find_children("*", "Control", true, false):
		var c := found as Control
		if c.is_visible_in_tree() and not (c is ScrollContainer) and c.get_parent() is Container and _rect(c).end.x > widest:
			widest = _rect(c).end.x
	_check(widest <= r.end.x + 0.5, "nothing in %s is wider than the panel (%.1f of %.1f)" % [what, widest, r.end.x])


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
