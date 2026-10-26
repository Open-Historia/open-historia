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
	print("[hud %6d ms] %s" % [Time.get_ticks_msec() - started, text])


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
		if Time.get_ticks_msec() - started > 90000:
			_say("FAIL the menu never appeared")
			_finish(1)
			return
		await process_frame
	await main._start_scenario("default")
	main.picker._choose("France")
	await main._on_country_chosen("France", "medium")
	var hud: Hud = main.hud
	await _wait(2.0)
	_say("panels: %s drawers: %s" % [hud.panels.keys(), hud.drawers.keys()])
	for name in ["chat", "actions", "projects"]:
		hud.toggle_dock(name)
		await _wait(1.6)
		_say("%s open=%s active=%s" % [name, (hud.panels[name] as PanelFrame).is_open(), hud.active_panel])
		await _shoot("h-%s" % name)
	hud.toggle_dock("projects")
	await _wait(0.5)
	hud.toggle_drawer("advisor")
	await _wait(1.6)
	_say("advisor drawer open=%s" % (hud.drawers["advisor"] as PanelFrame).is_open())
	await _shoot("h-advisor")
	await hud.show_country("France")
	await _wait(2.0)
	_say("country drawer open=%s advisor=%s" % [(hud.drawers["country"] as PanelFrame).is_open(), (hud.drawers["advisor"] as PanelFrame).is_open()])
	await _shoot("h-country")
	hud.close_drawer()
	await _wait(0.6)
	var map: MapView = main.map_view
	var paris := -1
	for index in range(2000):
		if map.region_owner(index) == "France":
			paris = index
			break
	hud.map_cards.show_region(paris, map.region_name(paris), map.region_owner(paris), Vector2(720, 450))
	var waited := 0.0
	while hud.map_cards._floating == null and waited < 20.0:
		await _wait(0.25)
		waited += 0.25
	await _wait(0.6)
	var card: Control = hud.map_cards._floating
	_say("card: %s kind=%s anchor=%s" % [card != null, hud.map_cards._floating_kind, str(hud.map_cards._floating_anchor)])
	if card:
		_say("card visible=%s pos=%s size=%s min=%s screen=%s" % [card.visible, str(card.position), str(card.size), str(card.get_combined_minimum_size()), str(map.world_to_screen(hud.map_cards._floating_anchor))])
	await _shoot("h-region-card")
	hud.set_map_mode("diplomatic", true)
	hud._apply_map_mode()
	await _wait(2.0)
	await _shoot("h-diplomatic")
	_say("static memory %.1f MB" % (OS.get_static_memory_usage() / 1048576.0))
	_finish(0)


func _finish(code: int) -> void:
	main.engine.stop()
	for i in range(2):
		await process_frame
	quit(code)
