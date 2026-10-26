extends SceneTree

var main: Node
var started := 0
var war: WarLayers


func _initialize() -> void:
	started = Time.get_ticks_msec()
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.add_child(main)
	_run.call_deferred()


func _say(text: String) -> void:
	print("[debug %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _wait(seconds: float) -> void:
	await create_timer(seconds).timeout


func _measure(label: String) -> void:
	var frames := 0
	var t0 := Time.get_ticks_msec()
	while Time.get_ticks_msec() - t0 < 2000:
		war.overlay.queue_redraw()
		await process_frame
		frames += 1
	_say("%s: %d frames in 2 s, draw calls %d" % [label, frames, Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)])


func _run() -> void:
	while not main.menu.visible:
		await process_frame
	var games: Array = main.library.get("games", [])
	await main._open_game(str((games[0] as Dictionary).get("id", "")))
	await _wait(2.0)
	main.map_view.fit_lonlat_bounds([[4.0, 47.0], [10.0, 51.0]], 6.0, 0.0)
	war = WarLayers.new()
	war.setup(main.engine, main.map_view)
	await war.refresh()
	await _wait(1.0)
	war.set_process(false)
	await _measure("all")
	var seas: Dictionary = war.overlay.seas
	war.overlay.seas = {}
	await _measure("no seas")
	war.overlay.seas = seas
	var transports: Dictionary = war.overlay.transports
	war.overlay.transports = {}
	await _measure("no transports")
	war.overlay.transports = transports
	var planes: Array = war.overlay.planes
	war.overlay.planes = []
	await _measure("no planes")
	war.overlay.planes = planes
	var labels: Array = war.overlay.group_labels
	war.overlay.group_labels = []
	await _measure("no group labels")
	war.overlay.group_labels = labels
	var markers: Array = war.overlay.markers
	war.overlay.markers = []
	await _measure("no markers")
	war.overlay.markers = markers
	var units: Array = war.overlay.units
	war.overlay.units = []
	await _measure("no units")
	war.overlay.units = units
	var sides: Array = war.overlay.sides
	war.overlay.sides = []
	war.overlay.troops = []
	await _measure("no fronts")
	war.overlay.seas = {}
	war.overlay.transports = {}
	war.overlay.planes = []
	war.overlay.group_labels = []
	war.overlay.markers = []
	war.overlay.units = []
	await _measure("nothing")
	main.engine.stop()
	await _wait(0.5)
	quit(0)
