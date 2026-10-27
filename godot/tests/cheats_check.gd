extends SceneTree

var main: Node
var shots := ""
var started := 0
var failures: PackedStringArray = []
var finished := false
var world_changes := 0


func _initialize() -> void:
	shots = OS.get_environment("OH_SHOTS")
	started = Time.get_ticks_msec()
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.mouse_passthrough = true
	root.add_child(main)
	_watchdog.call_deferred()
	_run.call_deferred()


func _watchdog() -> void:
	await create_timer(600.0).timeout
	if not finished:
		_say("FAIL the check did not finish in time")
		_finish(1)


func _say(text: String) -> void:
	print("[cheats_check %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _check(ok: bool, what: String, detail := "") -> void:
	if ok:
		_say("ok   " + what + (("  (" + detail + ")") if not detail.is_empty() else ""))
	else:
		_say("FAIL " + what + (("  (" + detail + ")") if not detail.is_empty() else ""))
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
	return bool(condition.call())


func _shoot(name: String) -> void:
	await _frames(4)
	await RenderingServer.frame_post_draw
	if shots.is_empty():
		return
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(name + ".png"))
	_say("screenshot " + name)


func _texts(node: Node, into: PackedStringArray) -> PackedStringArray:
	if node is CanvasItem and not (node as CanvasItem).is_visible_in_tree():
		return into
	if node is Label:
		into.append((node as Label).text)
	elif node is Button:
		into.append((node as Button).text)
	elif node is RichTextLabel:
		into.append((node as RichTextLabel).get_parsed_text())
	elif node is LineEdit:
		into.append((node as LineEdit).placeholder_text)
	for child in node.get_children():
		_texts(child, into)
	return into


func _has_text(node: Node, wanted: String) -> bool:
	for value in _texts(node, PackedStringArray()):
		if value.contains(wanted):
			return true
	return false


func _find_button(node: Node, text: String) -> Button:
	if node is Button and (node as Button).text == text and (node as Button).is_visible_in_tree():
		return node
	for child in node.get_children():
		var found := _find_button(child, text)
		if found:
			return found
	return null


func _find_script_class(node: Node, wanted: String) -> Node:
	var script: Variant = node.get_script()
	if script is Script and (script as Script).get_global_name() == wanted:
		return node
	if node.has_method("_compose") and wanted == "date":
		return node
	for child in node.get_children():
		var found := _find_script_class(child, wanted)
		if found:
			return found
	return null


func _field_after(node: Node, label: String) -> LineEdit:
	var labels: Array = []
	_collect_labels(node, label, labels)
	for found in labels:
		var column := (found as Node).get_parent()
		for child in column.get_children():
			if child is LineEdit:
				return child
	return null


func _collect_labels(node: Node, text: String, into: Array) -> void:
	if node is Label and (node as Label).text == text and (node as Label).is_visible_in_tree():
		into.append(node)
	for child in node.get_children():
		_collect_labels(child, text, into)


func _key(code: Key) -> InputEventKey:
	var event := InputEventKey.new()
	event.keycode = code
	event.pressed = true
	return event


func _clear_shell() -> void:
	var shell: ShellBoot = main.get("shell") as ShellBoot
	if shell == null:
		return
	var deadline := Time.get_ticks_msec() + 30000
	while shell.door_state == "deciding" and Time.get_ticks_msec() < deadline:
		await process_frame
	if shell.door != null and is_instance_valid(shell.door):
		shell.door.opened.emit()
	if not shell.notice_updates.is_empty():
		deadline = Time.get_ticks_msec() + 5000
		while not (shell.notice != null and is_instance_valid(shell.notice)) and Time.get_ticks_msec() < deadline:
			await process_frame
		for i in range(5):
			await process_frame
	if shell.notice != null and is_instance_valid(shell.notice):
		shell.notice.closed.emit()
	for i in range(3):
		await process_frame


func _idle() -> void:
	var idle_by := Time.get_ticks_msec() + 90000
	while Time.get_ticks_msec() < idle_by:
		var busy: Dictionary = await main.engine.request("invoke", {"module": "simulationStatus", "fn": "isSimulationBusy", "args": []})
		if busy.get("result", false) != true:
			return
		await _wait(0.5)


func _run() -> void:
	while not main.menu.visible:
		if Time.get_ticks_msec() - started > 120000:
			_say("FAIL the menu never appeared")
			_finish(1)
			return
		await process_frame
	_say("menu ready")
	await _clear_shell()
	await main._start_scenario("default")
	await _wait(0.4)
	main.picker._choose("France")
	await main._on_country_chosen("France", "medium")
	_say("game open")
	await _until(func() -> bool: return main.cheats != null and main.cheats.engine != null, 20.0)
	await _wait(1.0)
	await _idle()
	var cheats = main.cheats
	cheats.world_changed.connect(func() -> void: world_changes += 1)
	await cheats.open()
	await _wait(0.5)
	_check(cheats.is_open() and _has_text(cheats, "Force Manager"), "the cheats panel opens with the Force Manager live")
	await _shoot("cheats-01-home")

	var inspected: Dictionary = await main.engine.request("cheats.regions.inspect", {"index": 0})
	var state: Dictionary = inspected.get("result", {}) if inspected.get("ok", false) else {}
	_check(state.has("canRename") and typeof(state["canRename"]) == TYPE_BOOL, "the Region Inspector asks the scenario whether its region names can be edited", str(state.get("canRename", "?")))
	cheats._tool = "regions"
	cheats._s = {"rg": state.duplicate(), "open:rg_identity": true}
	cheats._s["rg"]["canRename"] = false
	cheats._render()
	await _wait(0.3)
	_check(_has_text(cheats, "Stock-map region names come from immutable map tiles, so this name is read-only here.") and _find_button(cheats, "Save region name") == null, "a stock map offers no renaming")
	await _shoot("cheats-02-region-stock")
	cheats._s["rg"]["canRename"] = true
	cheats._render()
	await _wait(0.3)
	_check(_has_text(cheats, "This scenario has editable custom region geometry. Renaming preserves the stable region ID.") and _find_button(cheats, "Save region name") != null, "a scenario's own map offers renaming")

	await cheats._go("edit-country")
	await cheats._ce_load("France")
	await _wait(0.6)
	var stability := _field_after(cheats, "GOVERNMENT APPROVAL / 100")
	_check(stability != null, "the Country Editor shows Government approval / 100")
	if stability:
		stability.text = "abc7"
		stability.text_changed.emit("abc7")
		_check(stability.text == "7" and str(cheats._cp().get("approval", "")) == "7", "a number field keeps only the number", stability.text)
		stability.gui_input.emit(_key(KEY_UP))
		_check(stability.text == "7.1", "Up steps it by its step", stability.text)
		stability.text = "100"
		stability.text_changed.emit("100")
		stability.gui_input.emit(_key(KEY_UP))
		_check(stability.text == "100", "and never past its maximum", stability.text)
	await _shoot("cheats-03-country-numbers")

	await cheats._go("events")
	await _wait(0.6)
	var add := _find_button(cheats, "+ Add exact event")
	if add:
		add.pressed.emit()
	await _wait(0.4)
	var date_field: Node = _find_script_class(cheats, "date")
	_check(date_field != null, "the Event Editor's date is a date field")
	if date_field:
		date_field._pick(2016, 3, 14)
		await _frames(2)
		_check(str((cheats._s.get("ev_create", {}) as Dictionary).get("date", "")) == "2016-03-14", "picking a day writes the ISO date", str((cheats._s.get("ev_create", {}) as Dictionary).get("date", "")))
		date_field._open_picker()
		await _wait(0.3)
		_check(date_field._popup != null and date_field._popup.visible and _has_text(date_field._popup, "March 2016"), "the calendar opens on the chosen month")
		await _shoot("cheats-04-event-date-picker")
		date_field._popup.hide()
		var month: LineEdit = date_field._month
		month.text = "13"
		month.text_changed.emit("13")
		await _frames(2)
		_check(str((cheats._s.get("ev_create", {}) as Dictionary).get("date", "x")) == "", "an impossible date is no date, as the browser's field")

	await cheats._go("groups")
	await _wait(0.6)
	var before_groups := world_changes
	var outside: Dictionary = await main.engine.request("cheats.groups.save", {"selected": "", "name": "Northern Watch", "description": "A militia written from outside the panel.", "color": "#2bc1f3"})
	_check(outside.get("ok", false), "a group is written from outside the panel", str(outside.get("error", "")))
	var live: bool = await _until(func() -> bool: return _has_text(cheats, "Northern Watch"), 8.0)
	_check(live, "the Groups tool follows the world without being reopened")
	await _shoot("cheats-05-groups-live")
	var erase: Dictionary = await cheats._run("cheats.groups.ops", {"name": "Northern Watch", "action": "erase"})
	_check(erase.get("ok", false) and world_changes > before_groups, "a cheat that changes the world tells the app to refresh", "%d" % (world_changes - before_groups))

	await cheats._go("master-ai")
	await _wait(0.4)
	var preview: Dictionary = await cheats.gm_preview("Make France and Germany sign a defence pact, move three regions to Belgium and found a Benelux customs group.", "world-intervention")
	await _wait(0.8)
	var apply := _find_button(cheats, "Apply Transaction")
	_check(preview.get("ok", false) and apply != null, "the GM Console previews a transaction", str(preview.get("error", "")))
	if apply:
		cheats._scroll.scroll_vertical = 0
		await _wait(0.4)
		var view_rect: Rect2 = cheats._scroll.get_global_rect()
		var button_rect := apply.get_global_rect()
		var long_preview: bool = cheats._body.get_combined_minimum_size().y > cheats._scroll.size.y + 40.0
		_check(not long_preview or (button_rect.end.y <= view_rect.end.y + 0.5 and button_rect.position.y >= view_rect.position.y), "Apply stays pinned in view over a long preview", "%s in %s" % [str(button_rect), str(view_rect)])
		await _shoot("cheats-06-gm-apply-pinned")
	cheats.close()
	await _console()
	_say("done: %d failure(s) %s" % [failures.size(), ", ".join(failures)])
	_finish(0 if failures.is_empty() else 1)


func _console() -> void:
	var console: Control = (load("res://scripts/ui/debug_console.gd") as GDScript).new()
	var layer := CanvasLayer.new()
	layer.layer = 120
	root.add_child(layer)
	layer.add_child(console)
	console.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	console.setup(main.engine, {"export_dir": OS.get_environment("OH_NATIVE_DOWNLOADS"), "reveal_saved_files": false})
	await console.open()
	await _wait(0.5)
	var everything: int = (console._data.get("filtered", []) as Array).size()
	_check(everything > 0 and not _has_text(console, "The native engine does not hand over its AI telemetry yet."), "the AI console lists this session's calls with nothing dimmed", "%d" % everything)
	var field: LineEdit = console._search_field
	field.grab_focus()
	field.text = "zzqqxx-no-such-text"
	field.caret_column = field.text.length()
	field.text_changed.emit(field.text)
	await _wait(0.6)
	var narrowed: int = (console._data.get("filtered", []) as Array).size()
	_check(narrowed == 0, "search narrows the list as you type, without Enter", "%d of %d" % [narrowed, everything])
	_check(is_instance_valid(console._search_field) and console._search_field.has_focus() and console._search_field.caret_column == "zzqqxx-no-such-text".length() and console._search_field.text == "zzqqxx-no-such-text", "and the search field keeps the focus and caret")
	console._search_field.text = ""
	console._search_field.text_changed.emit("")
	await _wait(0.6)
	var listed: Array = console._data.get("filtered", [])
	if not listed.is_empty():
		console._selected = str((listed[0] as Dictionary).get("id", ""))
		await console.refresh()
		await _wait(0.4)
		var prompt := str(console._detail.get("systemPrompt", ""))
		var shown := ""
		for node in console.find_children("*", "TextEdit", true, false):
			if (node as TextEdit).text == prompt:
				shown = (node as TextEdit).text
		_check(not prompt.is_empty() and shown.length() == prompt.length(), "a prompt is shown whole, never cut", "%d chars" % prompt.length())
		await _shoot("cheats-07-console-detail")
	console.close()
	layer.queue_free()


func _finish(code: int) -> void:
	if finished:
		return
	finished = true
	main.engine.stop()
	await _frames(2)
	quit(code)
