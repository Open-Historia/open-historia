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
	print("[picker %6d ms] %s" % [Time.get_ticks_msec() - started, text])


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
	var before: Dictionary = await main.engine.request("library.list")
	_say("games before: %d" % (before.get("result", {}).get("games", []) as Array).size())
	await main._start_scenario("default")
	var picker: CountryPicker = main.picker
	await _wait(1.0)
	_say("picker visible=%s options=%d groups offered=%s" % [picker.visible, picker._options.size(), picker._offers_groups])
	await _shoot("p1-picker")
	picker._query = "fr"
	picker._fill_list()
	await _wait(0.4)
	await _shoot("p2-search")
	picker._query = ""
	picker._fill_list()
	picker._set_hover(int(picker._owner_index.get("France", -1)))
	await _wait(0.4)
	await _shoot("p3-hover")
	picker._set_hover(-1)
	picker._tab = "group"
	picker._render()
	await _wait(0.5)
	await _shoot("p4-group")
	picker._creator["name"] = "Northern Resistance"
	picker._creator["landless"] = false
	picker._render()
	var first := -1
	for index in range(2000):
		if main.map_view.region_owner(index) == "France":
			first = index
			break
	picker._selected[first] = true
	picker._selection_changed()
	await _wait(0.5)
	await _shoot("p5-claim")
	picker._creator = {}
	picker._selected = {}
	picker._tab = "country"
	picker._render()
	picker._choose("France")
	await _wait(0.4)
	await _shoot("p6-difficulty")
	var after_pick: Dictionary = await main.engine.request("library.list")
	_say("games while picking: %d" % (after_pick.get("result", {}).get("games", []) as Array).size())
	picker._start("medium")
	var waited := 0.0
	while not main.hud.visible and waited < 60.0:
		await _wait(0.5)
		waited += 0.5
	await _wait(1.5)
	_say("game: %s %s" % [main.hud.date_widget._country_label.text, main.hud.date_widget._date_label.text])
	await _shoot("p7-game")
	var after: Dictionary = await main.engine.request("library.list")
	_say("games after: %s" % str((after.get("result", {}).get("games", []) as Array).map(func(game: Dictionary) -> String: return "%s (%s)" % [str(game.get("name", "")), str(game.get("country", ""))])))
	_finish(0)


func _finish(code: int) -> void:
	main.engine.stop()
	for i in range(2):
		await process_frame
	quit(code)
