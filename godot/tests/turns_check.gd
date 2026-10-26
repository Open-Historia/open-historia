extends SceneTree

var main: Node
var shots := ""
var started := 0
var widget: DateWidget


func _initialize() -> void:
	shots = OS.get_environment("OH_SHOTS")
	started = Time.get_ticks_msec()
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.add_child(main)
	_run.call_deferred()


func _say(text: String) -> void:
	print("[turns %6d ms] %s" % [Time.get_ticks_msec() - started, text])


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


func _texts(node: Node, into: PackedStringArray) -> void:
	if node is Label:
		into.append((node as Label).text)
	elif node is Button and not (node as Button).text.is_empty():
		into.append("[%s]" % (node as Button).text)
	elif node is RichTextLabel:
		into.append((node as RichTextLabel).get_parsed_text())
	for child in node.get_children():
		_texts(child, into)


func _dump(label: String, node: Node) -> void:
	var found := PackedStringArray()
	_texts(node, found)
	_say("%s: %s" % [label, " | ".join(found).replace("\n", " / ")])


func _run() -> void:
	while not main.menu.visible:
		if Time.get_ticks_msec() - started > 90000:
			_say("FAIL the menu never appeared")
			_finish(1)
			return
		await process_frame
	await main._start_scenario("default")
	main.picker._choose("France")
	await main._on_country_chosen("France", "medium")
	widget = main.hud.date_widget
	await _wait(1.0)
	_say("pill: %s %s" % [widget._country_label.text, widget._date_label.text])
	main.hud.toggle_dock("skip")
	await _wait(0.6)
	_dump("timeline", widget.timeline.body)
	await _shoot("t1-timeline")
	widget.custom_value = "12"
	widget.custom_unit = 0
	widget._render_timeline()
	await _wait(0.5)
	_dump("custom landing", widget._custom_landing)
	widget.custom_value = ""
	widget.run_jump(30.0)
	await _wait(1.2)
	_say("mid-skip: panel=%s loading=%s live=%s cards=%d" % [widget.open_panel, widget.is_loading, widget.skip_in_flight, widget.live_cards.size()])
	await _shoot("t2-mid-skip")
	while widget.is_loading:
		await process_frame
	await _wait(0.8)
	_say("after skip: panel=%s visible=%d of %d date=%s" % [widget.open_panel, widget.visible_count, (widget.latest.get("events", []) as Array).size(), widget._date_label.text])
	_dump("events", widget.events_panel.body)
	await _shoot("t3-events")
	widget.reveal_next()
	await _wait(0.6)
	_say("after next: visible=%d staged=%s" % [widget.visible_count, widget._staged])
	await _shoot("t4-next")
	var record := widget._display_record()
	widget.intervene = {"record": str(record.get("id", "")), "state": "asking"}
	widget._render_events()
	await _wait(0.4)
	_dump("asking", widget.events_panel.body)
	await _shoot("t5-intervene-ask")
	await widget._confirm_intervene()
	await _wait(0.6)
	_say("after intervene: date=%s visible=%d events=%d" % [widget._date_label.text, widget.visible_count, (widget.latest.get("events", []) as Array).size()])
	await _shoot("t6-intervened")
	widget.set_panel("skip")
	await _wait(0.5)
	_dump("timeline after", widget.timeline.body)
	await _shoot("t7-timeline-undo")
	await widget.run_undo()
	await _wait(0.6)
	_say("after undo: date=%s undo=%d" % [widget._date_label.text, int(widget.status.get("undoCount", -1))])
	await _shoot("t8-after-undo")
	main.hud.toggle_dock("chat")
	await _wait(0.4)
	_say("dock chat: active=%s widget=%s" % [main.hud.active_panel, widget.open_panel])
	_say("static memory %.1f MB" % (OS.get_static_memory_usage() / 1048576.0))
	_finish(0)


func _finish(code: int) -> void:
	main.engine.stop()
	for i in range(2):
		await process_frame
	quit(code)
