extends SceneTree

var main: Node
var shots := ""
var downloads := ""
var started := 0
var widget: DateWidget
var failures: PackedStringArray = []
var prefix := "cl"


func _initialize() -> void:
	var redraw := Node2D.new()
	root.add_child(redraw)
	process_frame.connect(redraw.queue_redraw)
	shots = OS.get_environment("OH_SHOTS")
	downloads = OS.get_environment("OH_NATIVE_DOWNLOADS")
	started = Time.get_ticks_msec()
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.add_child(main)
	_run.call_deferred()


func _say(text: String) -> void:
	print("[campaign_lore %6d ms] %s" % [Time.get_ticks_msec() - started, text])


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


func _call(method: String, args := {}) -> Dictionary:
	var reply: Dictionary = await main.engine.request(method, args)
	if not reply.get("ok", false):
		_say("%s failed: %s" % [method, str(reply.get("error", ""))])
	return reply


func _texts(node: Node, out: PackedStringArray) -> PackedStringArray:
	if node is Label:
		out.append((node as Label).text)
	elif node is Button:
		out.append((node as Button).text)
	elif node is LineEdit:
		out.append((node as LineEdit).placeholder_text)
	for child in node.get_children():
		_texts(child, out)
	return out


func _button(node: Node, text: String) -> Button:
	for found in node.find_children("*", "Button", true, false):
		var button := found as Button
		if button.is_visible_in_tree() and (button.text == text or _texts(button, PackedStringArray()).has(text)):
			return button
	return null


func _reader() -> Control:
	for layer in root.get_children():
		if layer is CanvasLayer:
			for child in layer.get_children():
				if child is Control and (child as Control).has_method("show_event"):
					return child
	return null


func _lore() -> Control:
	for found in main.find_children("*", "Control", true, false):
		if found.has_method("open") and found.get_script() == preload("res://scripts/ui/campaign_lore.gd"):
			return found
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
	prefix = "cl-phone" if UI.phone() else "cl"
	widget = main.hud.date_widget
	await main._start_scenario("default")
	main.picker._choose("France")
	await main._on_country_chosen("France", "medium")
	await _wait(1.5)
	widget.run_jump(7.0)
	await _until(func() -> bool: return widget.is_loading, 10.0)
	await _until(func() -> bool: return not widget.is_loading, 240.0)
	await _wait(0.8)
	widget.set_panel("history")
	await _wait(0.4)
	widget.reveal_all()
	await _wait(0.6)
	var seed := await _call("lore.testSeed", {"older": 20})
	_check("the test campaign gets earlier events and a finished scene", seed.get("ok", false), str(seed.get("result", {}).get("sourceId", "")))
	widget.set_panel("")
	await widget.load_history()
	await widget.refresh_status()
	widget.set_panel("history")
	await _wait(0.6)
	_check("a same-day scene joins the skip's Events page", int(widget.latest.get("sceneAppendCount", 0)) == 1, "%d appended" % int(widget.latest.get("sceneAppendCount", 0)))
	var all_events: Array = widget.latest.get("events", [])
	_check("the joined page shows every card at once", widget._shown_count(widget.latest) == all_events.size(), "%d of %d" % [widget._shown_count(widget.latest), all_events.size()])
	_check("there are earlier events to browse", widget.archive_count == 20, "%d" % widget.archive_count)
	var launcher := _button(widget.events_panel, "Explore interactive event")
	_check("the scene's card offers its transcript", launcher != null)
	if launcher:
		widget._events_scroll_anchor = launcher
		await widget._scroll_events()
	await _wait(0.5)
	await _shoot("1-events-joined")
	if launcher:
		launcher.pressed.emit()
	await _wait(0.6)
	var reader := _reader()
	_check("the transcript opens in its own window", reader != null)
	if reader:
		var words := _texts(reader, PackedStringArray())
		_check("it reads the scene, its moves and its outcome", words.has("Interactive event transcript") and words.has("Move 1") and words.has("Move 2") and words.has("Offered choices") and words.has("Scene response") and words.has("Outcome") and words.has("2 moves") and words.has("Resolved by the scene"))
		_check("it links back to the event the scene came from", Array(words).any(func(value: String) -> bool: return value.begins_with("Source event: ")))
		await _shoot("2-transcript")
		reader.call("close")
		await _frames(3)
	var browse := _button(widget.events_panel, "Browse earlier events")
	_check("Events offers Browse earlier events", browse != null)
	if browse:
		browse.pressed.emit()
	await _until(func() -> bool: return widget.archive_open and not (widget.archive["events"] as Array).is_empty(), 10.0)
	await _wait(0.4)
	_check("the browser shows a page of 15", (widget.archive["events"] as Array).size() == 15 and int(widget.archive["pages"]) == 2, "%d events, %d pages" % [(widget.archive["events"] as Array).size(), int(widget.archive["pages"])])
	var words2 := _texts(widget.events_panel, PackedStringArray())
	_check("it has its search, filter and pager", words2.has("Search by title or date") and words2.has("All categories") and words2.has("Newer") and words2.has("Older") and words2.has("1 / 2") and words2.has("Back to recent turns"))
	widget.events_panel.scroll.scroll_vertical = 0
	await _shoot("3-earlier-events")
	await widget._archive_page(1)
	await _wait(0.3)
	_check("Older turns the page", int(widget.archive["page"]) == 1 and (widget.archive["events"] as Array).size() == 5)
	await widget._archive_query("north")
	await _wait(0.3)
	_check("search narrows by title", (widget.archive["events"] as Array).size() == 10 and int(widget.archive["page"]) == 0, "%d" % (widget.archive["events"] as Array).size())
	await widget._archive_query("zzz-nothing")
	await _wait(0.3)
	_check("a search with no match says so", _texts(widget.events_panel, PackedStringArray()).has("No earlier recorded events match."))
	await _shoot("4-earlier-none")
	widget.set_panel("")
	await _wait(0.3)
	await widget.show_event("lore-old-20")
	await _wait(0.8)
	_check("an older event opens in the browser, on its page", widget.archive_open and (widget.archive["events"] as Array).any(func(event: Dictionary) -> bool: return str(event.get("id", "")) == "lore-old-20"))
	widget.set_panel("")
	await _wait(0.3)
	var menu: Variant = main.game_menu
	menu.open()
	await _wait(0.6)
	menu._show_tab("game")
	await _wait(0.4)
	_check("the Game menu offers Campaign Lore", _texts(menu as Node, PackedStringArray()).has("Campaign Lore"))
	await _shoot("5-game-menu")
	menu.open_campaign_lore()
	await _wait(1.0)
	var lore: Variant = _lore()
	_check("Campaign Lore opens", lore != null)
	if lore == null:
		_finish()
		return
	await _shoot("6-lore-empty")
	var words3 := _texts(lore as Node, PackedStringArray())
	_check("it offers scope, dates and the optional sections", words3.has("Export coverage") and words3.has("History scope") and words3.has("From game date") and words3.has("Through game date") and words3.has("Completed interactive event transcripts") and words3.has("Generate preview"))
	lore._on_check(true, "transcripts")
	await lore._load_preview()
	await _wait(0.4)
	var view: Variant = lore._snapshot
	_check("a preview reads the record", typeof(view) == TYPE_DICTIONARY and int((view as Dictionary).get("eventCount", 0)) >= 21, str((view as Dictionary).get("eventCount", 0)) if typeof(view) == TYPE_DICTIONARY else str(lore._status))
	await _shoot("7-lore-preview")
	await lore._download("md")
	var saved := str(lore._saved)
	_check("Download Markdown saves the record", not saved.is_empty() and FileAccess.file_exists(saved) and FileAccess.get_file_as_string(saved).contains("The summit ends in a joint communiqué"), saved)
	await lore._download("json")
	saved = str(lore._saved)
	_check("Download JSON saves the record", saved.ends_with(".json") and FileAccess.file_exists(saved), saved)
	await lore._copy()
	_check("Copy record says so", str(lore._status) == "Copied campaign record.")
	await lore._run_chronicle()
	await _wait(0.4)
	var chronicle: Variant = lore._chronicle
	_check("an AI chronicle comes back with its sources", typeof(chronicle) == TYPE_DICTIONARY and ((chronicle as Dictionary).get("sections", []) as Array).size() == 2, str(lore._chronicle_status))
	var scroll: ScrollContainer = lore._scroll
	scroll.scroll_vertical = 100000
	await _shoot("8-lore-chronicle")
	await lore._save_chronicle(false)
	_check("Download chronicle saves it", str(lore._chronicle_status).begins_with("Chronicle export prepared."))
	lore.close()
	await _frames(3)
	var interactive: Node = main.interactive
	interactive.call("open")
	await _wait(0.8)
	await _shoot("9-interactive-empty")
	interactive.call("close")
	_finish()


func _finish() -> void:
	_say("%s with %d failure(s) %s" % ["DONE" if failures.is_empty() else "FAILED", failures.size(), ", ".join(failures)])
	main.engine.stop()
	for i in range(2):
		await process_frame
	quit(1 if failures.size() > 0 else 0)
