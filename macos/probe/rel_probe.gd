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
	var menu := await _until(func() -> bool: return main.menu != null and main.menu.visible, 180.0)
	var menu_ms := Time.get_ticks_msec() - started
	_say("menu visible=%s at %d ms" % [menu, menu_ms])
	if not menu:
		_say("RESULT fail: the menu never appeared")
		_finish(2)
		return
	var t0 := Time.get_ticks_msec()
	await main._start_scenario("default")
	await main._on_picker_start({"country": "France", "difficulty": "medium"})
	var entered := await _until(func() -> bool: return bool(main.in_game), 120.0)
	var enter_ms := Time.get_ticks_msec() - t0
	_say("in game=%s after %d ms screen=%s" % [entered, enter_ms, str(main.get("_screen"))])
	await _wait(float(OS.get_environment("OH_PROBE_HOLD")) if OS.get_environment("OH_PROBE_HOLD") != "" else 10.0)
	var failed := handler_failures.size()
	_say("RESULT %s menu_ms=%d enter_ms=%d sidecar_ready_ms=%d failed_handlers=%d in_game=%s" % ["ok" if entered and failed == 0 and engine_ready else "fail", menu_ms, enter_ms, ready_ms, failed, entered])
	_finish(0 if entered and failed == 0 and engine_ready else 1)


func _finish(code: int) -> void:
	var link: Variant = main.get("engine")
	if link != null:
		(link as Node).call("stop")
	for i in range(3):
		await process_frame
	quit(code)
