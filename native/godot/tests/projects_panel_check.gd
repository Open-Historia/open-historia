extends SceneTree

var main: Node
var shots := ""
var started := 0
var failures: PackedStringArray = []
var prefix := "pp"


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
	print("[projects_panel %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _check(label: String, ok: bool, detail := "") -> void:
	_say("%s %s%s" % ["PASS" if ok else "FAIL", label, ("  (" + detail + ")") if not detail.is_empty() else ""])
	if not ok:
		failures.append(label)


func _wait(seconds: float) -> void:
	await create_timer(seconds).timeout


func _frames(count: int) -> void:
	for i in range(count):
		await process_frame


func _until(condition: Callable, seconds: float) -> bool:
	var deadline := Time.get_ticks_msec() + int(seconds * 1000.0)
	while Time.get_ticks_msec() < deadline:
		if condition.call():
			return true
		await process_frame
	return bool(condition.call())


func _clear_shell() -> void:
	var shell: ShellBoot = main.get("shell") as ShellBoot
	if shell == null:
		return
	await _until(func() -> bool: return shell.door_state != "deciding", 30.0)
	if shell.door != null and is_instance_valid(shell.door):
		shell.door.opened.emit()
	if not shell.notice_updates.is_empty():
		await _until(func() -> bool: return shell.notice != null and is_instance_valid(shell.notice), 5.0)
		await _frames(5)
	if shell.notice != null and is_instance_valid(shell.notice):
		shell.notice.closed.emit()
	await _frames(3)


func _shoot(name: String) -> void:
	await _frames(4)
	await RenderingServer.frame_post_draw
	if shots.is_empty():
		return
	root.get_viewport().get_texture().get_image().save_png(shots.path_join("%s-%s.png" % [prefix, name]))
	_say("screenshot " + name)


func _texts(node: Node, out: PackedStringArray) -> PackedStringArray:
	if node is Label:
		out.append((node as Label).text)
	elif node is Button:
		out.append((node as Button).text)
	for child in node.get_children():
		_texts(child, out)
	return out


func _has_text(node: Node, text: String) -> bool:
	return Array(_texts(node, PackedStringArray())).any(func(value: String) -> bool: return value.contains(text))


func _button(node: Node, text: String) -> Button:
	for found in node.find_children("*", "Button", true, false):
		if (found as Button).text == text and (found as Button).is_visible_in_tree():
			return found as Button
	return null


func _run() -> void:
	await process_frame
	while not main.menu.visible:
		if Time.get_ticks_msec() - started > 120000:
			_check("the main menu appears", false)
			_finish()
			return
		await process_frame
	await _clear_shell()
	prefix = "pp-phone" if UI.phone() else "pp"
	await main._start_scenario("default")
	main.picker._choose("France")
	await main._on_country_chosen("France", "medium")
	var shell: ShellBoot = main.get("shell") as ShellBoot
	await _until(func() -> bool: return shell == null or shell.loading == null or not shell.loading.visible, 60.0)
	await _wait(1.5)
	var ops := [
		{"op": "create", "name": "Grand Paris Rail Link", "kind": "project", "secrecy": "public", "summary": "A new high-speed line tying the capital to the northern ports.", "tags": ["infrastructure"], "plan": {"durationDays": 400, "monthlyCost": 900000000}},
		{"op": "create", "name": "Pension Reform", "kind": "project", "secrecy": "public", "summary": "Raising the retirement age.", "tags": ["economy"], "plan": {"durationDays": 300, "monthlyCost": 200000000}},
		{"op": "create", "name": "Coastal Defence Line", "kind": "project", "secrecy": "public", "summary": "Batteries along the Channel.", "tags": ["military"], "plan": {"durationDays": 200, "monthlyCost": 100000000}},
	]
	var edits := [
		{"name": "Grand Paris Rail Link", "set": {"progress": 35}},
		{"name": "Pension Reform", "set": {"progress": 40, "status": "cancelled", "spent": 2400000000}},
		{"name": "Coastal Defence Line", "set": {"progress": 100, "status": "complete", "completedAt": "2016-01-01", "spent": 600000000}},
	]
	var seeded: Dictionary = await main.engine.request("projects.testSeed", {"ops": ops, "edits": edits})
	_check("three projects seeded, two of them closed", seeded.get("ok", false))
	var actions := ActionsPanel.new()
	main.hud.add_child(actions)
	actions.setup(main.engine, {})
	actions.set_tab("projects")
	actions.open()
	var panel := actions.board()
	await _until(func() -> bool: return panel._loaded and int(panel._view.get("total", 0)) == 3, 20.0)
	await _wait(0.6)
	var means: Dictionary = panel._view.get("means", {})
	_check("the allowance is told in the GDP display currency", str(means.get("committed", "")).begins_with("$") and str(means.get("unit", "")) == "2026-USD equivalent.", "%s / %s" % [str(means.get("committed", "")), str(means.get("unit", ""))])
	_check("the allowance's note names the unit", panel._means_row.tooltip_text.ends_with("2026-USD equivalent."))
	var rail: Dictionary = (panel._view.get("mine", []) as Array).filter(func(card: Dictionary) -> bool: return str(card.get("name", "")) == "Grand Paris Rail Link").front()
	_check("a planned cost is in dollars", str(rail.get("plannedCost", "")) == "$900M", str(rail.get("plannedCost", "")))
	var archive: Dictionary = panel._view.get("archive", {})
	_check("closed projects can be archived", bool(archive.get("canArchive", false)) and _button(panel, "Archive closed projects") != null)
	await _shoot("1-archive-offered")
	await panel._archive_closed()
	await _wait(0.4)
	_check("archiving says how many were moved", str(panel._archive_message.get("text", "")) == "Archived 2 closed project records.", str(panel._archive_message.get("text", "")))
	_check("the board keeps only the running project", int(panel._view.get("total", 0)) == 1)
	var list_button := _button(panel, "Archived projects (2)")
	_check("the archive counts its records", list_button != null)
	if list_button:
		list_button.pressed.emit()
	await _wait(0.3)
	_check("the archive lists them to restore", _has_text(panel, "Select archived project...") and _has_text(panel, "Restoration requires a free slot and does not replay missed progress."))
	await _shoot("2-archive-open")
	var entries: Array = (panel._view.get("archive", {}) as Dictionary).get("entries", [])
	var pension: Array = entries.filter(func(entry: Dictionary) -> bool: return str(entry.get("label", "")).begins_with("Pension Reform"))
	_check("each record says what became of it", not pension.is_empty() and str(pension[0].get("label", "")) == "Pension Reform (cancelled)", str(pension[0].get("label", "")) if not pension.is_empty() else "")
	if not pension.is_empty():
		panel._archive_pick = str(pension[0].get("id", ""))
		await panel._restore_archived()
		await _wait(0.4)
	_check("Restore selected puts it back on the board", str(panel._archive_message.get("text", "")) == "Archived project restored to the live board." and int(panel._view.get("total", 0)) == 2, str(panel._archive_message.get("text", "")))
	await _shoot("3-restored")
	_finish()


func _finish() -> void:
	_say("%s with %d failure(s) %s" % ["DONE" if failures.is_empty() else "FAILED", failures.size(), ", ".join(failures)])
	main.engine.stop()
	for i in range(2):
		await process_frame
	quit(1 if failures.size() > 0 else 0)
