extends SceneTree

var main: Node
var shots := ""
var started := 0
var failures: PackedStringArray = []


func _initialize() -> void:
	var redraw := Node2D.new()
	root.add_child(redraw)
	process_frame.connect(redraw.queue_redraw)
	shots = OS.get_environment("OH_SHOTS")
	started = Time.get_ticks_msec()
	root.mouse_passthrough = true
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
	hud.set_map_mode("political", true)
	hud._apply_map_mode()
	await _renamed_city(hud)
	_say("static memory %.1f MB" % (OS.get_static_memory_usage() / 1048576.0))
	_say("done: %d failure(s) %s" % [failures.size(), ", ".join(failures)])
	_finish(0 if failures.is_empty() else 1)


func _check(ok: bool, what: String) -> void:
	_say(("PASS " if ok else "FAIL ") + what)
	if not ok:
		failures.append(what)


func _texts(node: Node, out: PackedStringArray) -> PackedStringArray:
	if node is Label:
		out.append((node as Label).text)
	elif node is Button:
		out.append((node as Button).text)
	elif node is RichTextLabel:
		out.append((node as RichTextLabel).get_parsed_text())
	for child in node.get_children():
		_texts(child, out)
	return out


func _city_row(rows: Array, label: String) -> Array:
	for item in rows:
		if item is Array and (item as Array).size() > 7 and str(item[0]) == label:
			return item
	return []


func _renamed_city(hud: Hud) -> void:
	hud.map_cards.dismiss_all()
	var before := _city_row(main._cities_raw, "Lyon")
	_check(not before.is_empty(), "Lyon is among the map's cities")
	var renamed: Dictionary = await main.engine.request("warmap.test.rename", {"name": "Lyon", "newName": "Lugdunum"})
	_check(renamed.get("ok", false) and str((renamed.get("result", {}) as Dictionary).get("lyon", "")) == "Lugdunum", "an event renaming a city of the map keeps the rename")
	var view: Dictionary = await main.engine.request("game.view")
	await main._on_turn_landed(view.get("result", {}))
	var row := _city_row(main._cities_raw, "Lugdunum")
	_check(row.size() > 7 and str(row[7]) == "Lyon" and int(row[6]) == 1 and _city_row(main._cities_raw, "Lyon").is_empty(), "the map's city name changes as the turn lands")
	_check(not _city_row(hud.map_cards._cities, "Lugdunum").is_empty() and _city_row(hud.map_cards._cities, "Lyon").is_empty(), "the place popups read the new name too")
	if row.size() < 3:
		return
	var lng := float(row[1])
	var lat := float(row[2])
	main.map_view.fit_lonlat_bounds([[lng - 0.25, lat - 0.25], [lng + 0.25, lat + 0.25]], 8.5, 0.0)
	await _wait(0.8)
	var pick: Dictionary = hud.map_cards.pick_unit_or_feature(MapView.CityLayer.ohproject(lng, lat))
	var payload: Dictionary = pick.get("payload", {})
	_check(str(payload.get("source", "")) == "city" and str(payload.get("name", "")) == "Lugdunum", "a click on the city picks it under its new name (%s)" % str(payload.get("name", "")))
	hud.map_cards.open_pick(pick)
	var waited := 0.0
	while hud.map_cards._floating == null and waited < 10.0:
		await _wait(0.25)
		waited += 0.25
	await _wait(0.6)
	var shown := _texts(hud.map_cards._floating, PackedStringArray()) if hud.map_cards._floating else PackedStringArray()
	_check(Array(shown).any(func(value: String) -> bool: return value.contains("Lugdunum")), "its place popup shows the new name")
	await _shoot("h-renamed-city")
	hud.map_cards.dismiss_all()


func _finish(code: int) -> void:
	main.engine.stop()
	for i in range(2):
		await process_frame
	quit(code)
