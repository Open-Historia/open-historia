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
	print("[wiring %6d ms] %s" % [Time.get_ticks_msec() - started, text])


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


func _run() -> void:
	while not main.menu.visible:
		if Time.get_ticks_msec() - started > 120000:
			_say("FAIL the menu never appeared")
			_finish(1)
			return
		await process_frame
	_say("mounted: menu=%s console=%s interactive=%s cheats=%s" % [main.game_menu != null, main.debug_console != null, main.interactive != null, main.cheats != null])
	main.menu.open_settings.emit()
	await _wait(1.5)
	await _shoot("w1-app-settings")
	main.game_menu.call("close")
	await _wait(0.6)
	await main._start_scenario("default")
	main.picker._choose("France")
	await main._on_country_chosen("France", "medium")
	await _wait(2.0)
	await _shoot("w2-ai-prompt")
	main.hud.open_menu.emit()
	await _wait(1.2)
	await _shoot("w3-quick-menu")
	main.game_menu.call("close")
	await _wait(0.5)
	main.hud.open_interactive.emit()
	await _wait(1.2)
	await _shoot("w4-interactive")
	_finish(0)


func _finish(code: int) -> void:
	main.engine.stop()
	for i in range(2):
		await process_frame
	quit(code)
