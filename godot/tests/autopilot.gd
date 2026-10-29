extends SceneTree

var main: Node
var shots := ""
var started := 0


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
	print("[autopilot %6d ms] %s" % [Time.get_ticks_msec() - started, text])


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
	await _wait(0.4)
	await _shoot("1-games-empty")
	main.menu._show_page("scenarios")
	await _wait(1.2)
	await _shoot("2-scenarios")
	var opening := Time.get_ticks_msec()
	await main._start_scenario("default")
	_say("picker open in %d ms" % (Time.get_ticks_msec() - opening))
	await _wait(0.6)
	await _shoot("3-picker")
	main.picker._choose("France")
	await _wait(0.2)
	await _shoot("4-difficulty")
	await main._on_country_chosen("France", "medium")
	_say("game open: %s" % main.hud.date_widget._country_label.text)
	await _wait(1.5)
	await _shoot("5-game")
	main.hud.date_widget.toggle_panel("skip")
	await _wait(0.6)
	await _shoot("6-timeline")
	var skip_started := Time.get_ticks_msec()
	await main.hud.date_widget.run_jump(30.0)
	_say("skip done in %d ms: %s" % [Time.get_ticks_msec() - skip_started, main.hud.date_widget._date_label.text])
	await _wait(0.6)
	await _shoot("7-after-skip")
	main.hud.date_widget.set_panel("")
	main.map_view._zoom_at(main.map_view.get_viewport_rect().size * 0.5, 6.0)
	await _wait(3.0)
	await _shoot("8-zoomed")
	await main._exit_game()
	main.menu._show_page("games")
	await _wait(2.5)
	await _shoot("9-games")
	main.menu._show_page("scenarios")
	await _wait(1.0)
	await _shoot("10-scenarios")
	_say("static memory %.1f MB" % (OS.get_static_memory_usage() / 1048576.0))
	_finish(0)


func _finish(code: int) -> void:
	main.engine.stop()
	await _frames(2)
	quit(code)
