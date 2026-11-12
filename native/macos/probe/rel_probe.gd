extends SceneTree
class_name OhProbe

var main: Node
var started := 0
var handler_failures: Array[String] = []
var engine_ready := false
var ready_ms := -1


func _initialize() -> void:
	started = Time.get_ticks_msec()
	root.mouse_passthrough = true
	main = (load("res://scripts/main.gd") as GDScript).new()
	main.name = "Main"
	root.add_child(main)
	_watch_engine()
	_run.call_deferred()


func _watch_engine() -> void:
	var link: Variant = main.get("engine")
	if link == null:
		return
	(link as Node).connect("engine_event", _on_engine_event)


func _on_engine_event(name: String, data: Variant) -> void:
	if name == "sidecar.handlerFailed":
		var entry: Dictionary = data if typeof(data) == TYPE_DICTIONARY else {}
		handler_failures.append("%s: %s" % [entry.get("file", "?"), entry.get("message", "")])
		_say("handler failed %s" % handler_failures[-1])
	elif name == "ready" and not engine_ready:
		engine_ready = true
		ready_ms = Time.get_ticks_msec() - started
		_say("sidecar ready at %d ms" % ready_ms)


func _say(text: String) -> void:
	printerr("[probe %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _wait(seconds: float) -> void:
	var until := Time.get_ticks_msec() + int(seconds * 1000.0)
	while Time.get_ticks_msec() < until:
		await process_frame


func _until(check: Callable, seconds: float) -> bool:
	var until := Time.get_ticks_msec() + int(seconds * 1000.0)
	while Time.get_ticks_msec() < until:
		if check.call():
			return true
		await process_frame
	return check.call()


func _run() -> void:
	_say("os=%s arch=%s template=%s debug=%s renderer=%s display=%s" % [OS.get_name(), Engine.get_architecture_name(), OS.has_feature("template"), OS.is_debug_build(), RenderingServer.get_current_rendering_driver_name(), DisplayServer.get_name()])
	if main.get("engine") == null:
		_watch_engine()
	var boot := await _until(func() -> bool: return main.get("engine") != null and bool(main.engine.is_ready()), 180.0)
	if boot and not engine_ready:
		engine_ready = true
		ready_ms = Time.get_ticks_msec() - started
		_say("sidecar ready at %d ms" % ready_ms)
	var menu := await _until(func() -> bool: return main.menu != null and main.menu.visible, 180.0)
	var menu_ms := Time.get_ticks_msec() - started
	_say("menu visible=%s at %d ms" % [menu, menu_ms])
	if not menu:
		_say("RESULT fail: the menu never appeared")
		_finish(2)
		return
	var web: Array = await _web_panel_check()
	_say("WEBPANEL %s %s" % [web[0], web[1]])
	var t0 := Time.get_ticks_msec()
	await main._start_scenario("default")
	await main._on_picker_start({"country": "France", "difficulty": "medium"})
	var entered := await _until(func() -> bool: return bool(main.in_game), 120.0)
	var enter_ms := Time.get_ticks_msec() - t0
	_say("in game=%s after %d ms screen=%s" % [entered, enter_ms, str(main.get("_screen"))])
	await _wait(float(OS.get_environment("OH_PROBE_HOLD")) if OS.get_environment("OH_PROBE_HOLD") != "" else 10.0)
	var link: Variant = main.get("engine")
	if link != null and not engine_ready and bool((link as Node).call("is_ready")):
		engine_ready = true
		_say("sidecar ready (seen through is_ready)")
	if link != null:
		for line in str((link as Node).call("recent_diagnostics", 400)).split("\n"):
			if line.contains("was not loaded") and not handler_failures.has(line):
				handler_failures.append(line)
				_say("handler failed %s" % line)
	var failed := handler_failures.size()
	_say("RESULT %s menu_ms=%d enter_ms=%d sidecar_ready_ms=%d failed_handlers=%d in_game=%s" % ["ok" if entered and failed == 0 and engine_ready else "fail", menu_ms, enter_ms, ready_ms, failed, entered])
	_finish(0 if entered and failed == 0 and engine_ready else 1)


func _web_panel_check() -> Array:
	if not ClassDB.class_exists("WebPanel"):
		return ["fail", "the WebPanel class is not registered"]
	if not bool(ClassDB.class_call_static("WebPanel", "is_available")):
		return ["unavailable", str(ClassDB.class_call_static("WebPanel", "unavailable_reason"))]
	var layer := CanvasLayer.new()
	layer.layer = 120
	root.add_child(layer)
	var panel: Control = ClassDB.instantiate("WebPanel")
	panel.position = Vector2(40, 40)
	panel.size = Vector2(320, 180)
	layer.add_child(panel)
	var heard: Array = []
	panel.connect("message", func(text: String) -> void: heard.append(text))
	var started_at := Time.get_ticks_msec()
	var page := "<!doctype html><html><body style='margin:0;background:#1d4ed8;color:#fff'><h1>Open Historia web panel</h1><script>window.addEventListener('oh-message', function(e){ window.oh.send('echo:' + e.data); }); window.oh.send('ready:' + innerWidth + 'x' + innerHeight);</script></body></html>"
	if not bool(panel.call("open_html", page)):
		var reason := str(panel.call("get_error"))
		layer.queue_free()
		return ["fail", "open_html refused: " + reason]
	var ready := await _until(func() -> bool: return heard.any(func(m: String) -> bool: return m.begins_with("ready:")) or not bool(panel.call("is_open")), 60.0)
	if not ready or not bool(panel.call("is_open")):
		var reason := str(panel.call("get_error"))
		layer.queue_free()
		return ["fail", "no message from the page in 60 s %s" % reason]
	panel.call("post_message", "ping")
	var echoed := await _until(func() -> bool: return heard.has("echo:ping"), 20.0)
	var rect: Rect2 = panel.call("get_native_rect")
	var shown := bool(panel.call("is_shown"))
	var detail := "messages=%s rect=%s shown=%s ms=%d url=%s" % [str(heard), str(rect), shown, Time.get_ticks_msec() - started_at, str(panel.call("get_current_url")).left(40)]
	panel.call("close")
	var closed := not bool(panel.call("is_open"))
	layer.queue_free()
	await process_frame
	return ["ok" if echoed and shown and closed else "fail", detail]


func _finish(code: int) -> void:
	var link: Variant = main.get("engine")
	if link != null:
		(link as Node).call("stop")
	for i in range(3):
		await process_frame
	quit(code)
