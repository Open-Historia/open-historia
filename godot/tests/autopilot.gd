extends SceneTree

var main: Node
var shots := ""
var started := 0


func _initialize() -> void:
	shots = OS.get_environment("OH_SHOTS")
	started = Time.get_ticks_msec()
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.add_child(main)
	_run.call_deferred()


func _say(text: String) -> void:
	print("[autopilot %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _frames(count: int) -> void:
	for i in range(count):
		await process_frame


func _shoot(name: String) -> void:
	await _frames(6)
	await RenderingServer.frame_post_draw
	if shots.is_empty():
		return
	var image := root.get_viewport().get_texture().get_image()
	image.save_png(shots.path_join(name + ".png"))
	_say("screenshot " + name)


func _run() -> void:
	while not main.engine.is_ready():
		if Time.get_ticks_msec() - started > 90000:
			_say("FAIL the engine never became ready")
			_finish(1)
			return
		await process_frame
	_say("engine ready")
	await _frames(10)
	await _shoot("1-library")
	var opening := Time.get_ticks_msec()
	await main._on_new_game()
	_say("game open in %d ms: %s, %s" % [Time.get_ticks_msec() - opening, main.country_label.text, main.date_label.text])
	await _shoot("2-map")
	var before: String = main.date_label.text
	var skip_started := Time.get_ticks_msec()
	await main._skip(30)
	_say("skip done in %d ms: %s -> %s" % [Time.get_ticks_msec() - skip_started, before, main.date_label.text])
	if main.date_label.text == before:
		_say("FAIL the date did not move: " + main.status_label.text)
	await _shoot("3-after-skip")
	var picked: int = main.map_view.baker.pick(main.map_view.camera.position)
	main._on_region_clicked(picked)
	_say("picked region %d: %s (%s)" % [picked, main.region_title.text, main.region_owner.text])
	main.map_view._zoom_at(main.map_view.get_viewport_rect().size * 0.5, 4.0)
	await _shoot("4-zoomed")
	_say("static memory %.1f MB" % (OS.get_static_memory_usage() / 1048576.0))
	_finish(0)


func _finish(code: int) -> void:
	main.engine.stop()
	await _frames(2)
	quit(code)
