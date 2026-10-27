extends SceneTree

var main: Node
var shots := ""
var started := 0
var widget: DateWidget
var failures: PackedStringArray = []
var seen: Dictionary = {}


func _initialize() -> void:
	root.mouse_passthrough = true
	shots = OS.get_environment("OH_SHOTS")
	started = Time.get_ticks_msec()
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.add_child(main)
	_run.call_deferred()


func _say(text: String) -> void:
	print("[timeline %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _check(label: String, ok: bool, detail := "") -> void:
	_say("%s %s%s" % ["ok  " if ok else "FAIL", label, ("  (" + detail + ")") if not detail.is_empty() else ""])
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
	for i in range(4):
		await process_frame
	await RenderingServer.frame_post_draw
	if shots.is_empty():
		return
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(name + ".png"))
	_say("screenshot " + name)


func _call(method: String, args := {}) -> Dictionary:
	var reply: Dictionary = await main.engine.request(method, args)
	if not reply.get("ok", false):
		_say("%s failed: %s" % [method, str(reply.get("error", ""))])
	return reply


func _run() -> void:
	while not main.menu.visible:
		if Time.get_ticks_msec() - started > 120000:
			_check("the main menu appears", false)
			_finish()
			return
		await process_frame
	await _clear_shell()
	main.engine.engine_event.connect(func(name: String, _data: Variant) -> void: seen[name] = int(seen.get(name, 0)) + 1)
	widget = main.hud.date_widget
	_check("DateWidget has reload_history()", widget.has_method("reload_history"))
	await widget.reload_history()
	_check("reload_history is safe outside a game", true)
	await main._start_scenario("default")
	main.picker._choose("France")
	await main._on_country_chosen("France", "medium")
	await _wait(1.5)
	var caption := await _call("timeline.caption")
	_check("timeline.caption answers", caption.get("ok", false) and (caption.get("result", {}) as Dictionary).has("used"))
	var offer := await _call("timeline.offer")
	_check("timeline.offer answers", offer.get("ok", false) and (offer.get("result", {}) as Dictionary).has("offer"))
	var bounds := await _call("timeline.strikeBounds", {"eventId": "none"})
	_check("timeline.strikeBounds answers", bounds.get("ok", false) and (bounds.get("result", {}) as Dictionary).has("bounds"))
	var fronts := await _call("timeline.fronts", {"peek": true})
	_check("timeline.fronts answers", fronts.get("ok", false))
	_say("fronts state %s pending %s, pregame events %d" % [widget._fronts_state, widget._fronts_pending, int(seen.get("turn.pregame", 0))])
	main.hud.toggle_dock("skip")
	await _wait(0.6)
	var before := widget._caption_label.text if widget._caption_label else ""
	_say("caption before: " + before.replace("\n", " / "))
	await _shoot("tl1-timeline")
	var captions_before := int(seen.get("timeline.caption", 0))
	widget.run_jump(7.0)
	await _until(func() -> bool: return int(seen.get("timeline.caption", 0)) > captions_before, 60.0)
	_check("the requests caption hears a request as it is spent", int(seen.get("timeline.caption", 0)) > captions_before, "%d caption events" % (int(seen.get("timeline.caption", 0)) - captions_before))
	while widget.is_loading:
		await process_frame
	await _wait(0.8)
	widget.set_panel("skip")
	await _wait(0.4)
	var after := widget._caption_label.text if widget._caption_label else ""
	_say("caption after: " + after.replace("\n", " / "))
	_check("the caption counts the skip", after != before, after.replace("\n", " / "))
	await _shoot("tl2-timeline-after")
	var events_before := (widget.latest.get("events", []) as Array).size()
	await widget.reload_history()
	_check("reload_history keeps the turn", (widget.latest.get("events", []) as Array).size() == events_before, "%d events" % events_before)
	widget.set_panel("history")
	await _wait(0.5)
	var table := UI.rich("Forces at the border:\n\n| Country | Divisions | Posture |\n|---|---|---|\n| France | 12 | **Holding** |\n| Germany | 9 | Massing |\n| Belgium | 2 | *Neutral* |", 12, Color(228 / 255.0, 228 / 255.0, 231 / 255.0, 0.82))
	table.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	widget.events_panel.body.add_child(table)
	widget.events_panel.body.move_child(table, 0)
	await _wait(0.4)
	_check("a markdown table renders as a table", table.get_parsed_text().contains("Divisions") and not table.get_parsed_text().contains("|"), table.get_parsed_text().replace("\n", " / "))
	await _shoot("tl3-events-table")
	_finish()


func _finish() -> void:
	_say("done: %d failure(s) %s" % [failures.size(), ", ".join(failures)])
	main.engine.stop()
	for i in range(2):
		await process_frame
	quit(1 if failures.size() > 0 else 0)
