extends SceneTree

var main: Node
var shots := ""
var started := 0
var failures: PackedStringArray = []
var finished := false


func _initialize() -> void:
	shots = OS.get_environment("OH_SHOTS")
	started = Time.get_ticks_msec()
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.add_child(main)
	_watchdog.call_deferred()
	_run.call_deferred()


func _watchdog() -> void:
	await create_timer(600.0).timeout
	if not finished:
		_say("FAIL the check did not finish in time")
		_finish(1)


func _say(text: String) -> void:
	print("[mapextras_check %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _check(ok: bool, what: String) -> void:
	if ok:
		_say("ok   " + what)
	else:
		_say("FAIL " + what)
		failures.append(what)


func _frames(count: int) -> void:
	for i in range(count):
		await process_frame


func _wait(seconds: float) -> void:
	await create_timer(seconds).timeout


func _shoot(name: String) -> void:
	await _frames(4)
	await RenderingServer.frame_post_draw
	if shots.is_empty():
		return
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(name + ".png"))
	_say("screenshot " + name)


func _run() -> void:
	while not main.menu.visible:
		if Time.get_ticks_msec() - started > 90000:
			_say("FAIL the menu never appeared")
			_finish(1)
			return
		await process_frame
	_say("menu ready")
	await main._start_scenario("default")
	main.picker._choose("France")
	await main._on_country_chosen("France", "medium")
	await _wait(3.0)
	var view: MapView = main.map_view
	await _shoot("base-1-start")
	view.fly_to_lonlat(10.0, 50.0, 4.6, 0.0)
	await _wait(3.0)
	await _shoot("base-2-europe")
	view.fly_to_lonlat(34.0, 45.0, 6.0, 0.0)
	await _wait(3.0)
	await _shoot("base-3-crimea")
	_finish(0 if failures.is_empty() else 1)


func _finish(code: int) -> void:
	finished = true
	main.engine.stop()
	await _frames(2)
	quit(code)
