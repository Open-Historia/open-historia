extends SceneTree

var main: Node
var shots := ""
var started := 0
var failures: PackedStringArray = []
var phone := false


func _initialize() -> void:
	var redraw := Node2D.new()
	root.add_child(redraw)
	process_frame.connect(redraw.queue_redraw)
	shots = OS.get_environment("OH_SHOTS")
	phone = not OS.get_environment("OH_PHONE").is_empty()
	started = Time.get_ticks_msec()
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.add_child(main)
	_run.call_deferred()


func _say(text: String) -> void:
	print("[diplomatic %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _wait(seconds: float) -> void:
	await create_timer(seconds).timeout


func _shoot(name: String) -> void:
	for i in range(4):
		await process_frame
	await RenderingServer.frame_post_draw
	if shots.is_empty():
		return
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(("p-" if phone else "") + name + ".png"))
	_say("screenshot " + name)


func _check(ok: bool, what: String, detail := "") -> void:
	_say(("PASS " if ok else "FAIL ") + what + ("" if detail.is_empty() else " (%s)" % detail))
	if not ok:
		failures.append(what)


func _finish(code: int) -> void:
	_say("done: %d failure(s) %s" % [failures.size(), ", ".join(failures)])
	main.engine.stop()
	for i in range(2):
		await process_frame
	quit(code)


func _until(test: Callable, seconds: float) -> bool:
	var until := Time.get_ticks_msec() + int(seconds * 1000.0)
	while Time.get_ticks_msec() < until:
		if test.call():
			return true
		await process_frame
	return bool(test.call())


func _find_all(node: Node, test: Callable, found: Array) -> Array:
	if test.call(node):
		found.append(node)
	for child in node.get_children():
		_find_all(child, test, found)
	return found


func _texts(node: Node) -> PackedStringArray:
	var out := PackedStringArray()
	for item in _find_all(node, func(found: Node) -> bool: return (found is Label or found is Button) and (found as Control).is_visible_in_tree(), []):
		out.append(str(item.get("text")))
	return out


func _has_text(node: Node, words: String) -> bool:
	return _texts(node).has(words)


func _button(node: Node, words: String) -> BaseButton:
	var found := _find_all(node, func(item: Node) -> bool: return item is BaseButton and (item as Control).is_visible_in_tree() and (str(item.get("text")) == words or (item as Control).tooltip_text == words), [])
	return found[0] if not found.is_empty() else null


func _rgb(name: String) -> String:
	var override: Dictionary = main.map_view.get("_color_override")
	var shade: Array = override.get(name, [])
	return ",".join(PackedStringArray(shade.map(func(value: Variant) -> String: return str(int(value)))))


func _press(button: BaseButton) -> void:
	if button:
		button.pressed.emit()
	else:
		_say("no such button")


func _settle(legend: Node, before: int) -> void:
	var landed := await _until(func() -> bool: return int(legend.get("renders")) > before, 30.0)
	if not landed:
		_say("the legend did not answer")
	await _wait(0.8)


func _act(legend: Node, button: BaseButton) -> void:
	var before := int(legend.get("renders"))
	_press(button)
	await _settle(legend, before)


func _view(legend: Node, label: String) -> void:
	await _act(legend, _button(legend, label))


func _cover_gone() -> void:
	var shell: Variant = main.get("shell")
	if shell == null or shell.get("loading") == null:
		return
	var deadline := Time.get_ticks_msec() + 90000
	while (shell.loading as GameLoadingScreen).is_open() and Time.get_ticks_msec() < deadline:
		await process_frame
	if (shell.loading as GameLoadingScreen).is_open():
		shell.loading.close_now()
	if shell.door != null and is_instance_valid(shell.door) and shell.door.is_visible_in_tree():
		shell.door.opened.emit()
	if shell.get("notice") != null and is_instance_valid(shell.notice):
		shell.notice.closed.emit()
	for page in _find_all(root, func(item: Node) -> bool: return item is ReleaseNotice or item is UpdateNotice, []):
		(page as Node).queue_free()
	await _wait(0.5)


func _run() -> void:
	await process_frame
	while not main.menu.visible:
		if Time.get_ticks_msec() - started > 90000:
			_say("FAIL the menu never appeared")
			_finish(1)
			return
		await process_frame
	await main._start_scenario("default")
	main.picker._choose("France")
	await main._on_country_chosen("France", "medium")
	await _cover_gone()
	await _wait(1.0)
	var hud: Hud = main.hud
	var legend: Control = hud.legend
	var map: MapView = main.map_view
	var layers: Node = map.extras.get("diplomatic")
	_check(legend != null and layers != null, "the legend and the map's diplomatic layers are there")
	var kept: Dictionary = await main.engine.request("hud.mapMode")
	_check(str((kept.get("result", {}) as Dictionary).get("mode", "")) == "political", "a new game opens on the political map")
	var seeded: Dictionary = await main.engine.request("diplomap.test.seed")
	_check(bool(seeded.get("ok", false)), "the test world is seeded", str(seeded.get("error", "")))
	map.fit_lonlat_bounds([[-25.0, -5.0], [65.0, 64.0]], 6.0, 0.0)
	await _act(legend, (hud.get("_mode_buttons") as Dictionary)["diplomatic"] as Button)
	await _until(func() -> bool: return legend.visible, 6.0)
	var chosen: Dictionary = await main.engine.request("hud.mapMode")
	_check(str((chosen.get("result", {}) as Dictionary).get("mode", "")) == "diplomatic", "the diplomatic map is kept for this game")

	var data: Dictionary = legend.get("data")
	_check(legend.visible and _has_text(legend, "DIPLOMACY"), "the legend opens with the diplomatic map")
	_check(str(data.get("view", "")) == "relations" and _has_text(legend, "Focus") and _has_text(legend, "France"), "Relations opens on the player's country", str(data.get("focusLabel", "")))
	for words in ["Focus country", "Puppet", "At war", "Alliance", "Non-aggression", "Trade", "Cautious", "Strained", "Hostile", "Rival", "No record"]:
		_check(_has_text(legend, words), "Relations lists %s" % words)
	_check(_rgb("France") == "246,241,227,255" and _rgb("Libya") == "165,28,28,255" and _rgb("Mali") == "168,131,90,255" and _rgb("Morocco") == "214,196,138,255" and _rgb("Algeria") == "63,127,122,255" and _rgb("Germany") == "29,79,145,255", "the fills are beta's Relations colours", "France %s Libya %s Mali %s Morocco %s Algeria %s Germany %s" % [_rgb("France"), _rgb("Libya"), _rgb("Mali"), _rgb("Morocco"), _rgb("Algeria"), _rgb("Germany")])
	_check(is_equal_approx(map._fill_opacity(2.0), 0.78) and is_equal_approx(map._fill_opacity(13.0), 0.83), "the fills take the diplomatic ramp", "%.3f %.3f" % [map._fill_opacity(2.0), map._fill_opacity(13.0)])
	var lines: Array = data.get("lines", [])
	_check(int(layers.call("line_count")) > 3 and data.get("seat") is Array, "lines run from the focus country's capital", "%d lines" % lines.size())
	var kinds := {}
	for line in lines:
		kinds[str((line as Dictionary).get("kind", ""))] = true
	_check(kinds.has("war") and kinds.has("ally"), "the lines tell allies from enemies", str(kinds.keys()))
	_check(not (data.get("fronts", []) as Array).is_empty() and bool(layers.get("_has_edges")), "the focus country's border and its fronts are lit")
	await _shoot("dl-relations")

	legend.call("show_tooltip_for", "Libya", Vector2(420, 300))
	var tooltip: Control = legend.get("_tooltip")
	_check(tooltip != null and tooltip.visible and _has_text(tooltip, "Libya") and _has_text(tooltip, "At war") and _has_text(tooltip, "Southern Border War"), "the tooltip names the country and its tie", ", ".join(_texts(tooltip)) if tooltip else "")
	await _shoot("dl-tooltip")
	legend.call("_hide_tooltip")

	await _act(legend, _button(legend, "At war"))
	_check(_rgb("Libya").ends_with(",255") and _rgb("Germany").ends_with(",191") and _rgb("France").ends_with(",191"), "picking At war dims every other country", "Libya %s Germany %s" % [_rgb("Libya"), _rgb("Germany")])
	await _shoot("dl-picked")
	await _act(legend, _button(legend, "At war"))
	_check(_rgb("Germany").ends_with(",255"), "picking it again lets go")

	var before := int(legend.get("renders"))
	legend.call("on_region_clicked", "Germany")
	await _settle(legend, before)
	data = legend.get("data")
	_check(str(data.get("focus", "")) == "Germany" and _rgb("Germany") == "246,241,227,255" and _has_text(legend, "Back to my country") and _has_text(legend, "Dossier"), "a clicked country becomes the focus", str(data.get("focus", "")))
	await _shoot("dl-focus")
	await _act(legend, _button(legend, "Back to my country"))
	_check(str((legend.get("data") as Dictionary).get("focus", "x")) == "" and _rgb("France") == "246,241,227,255", "Back to my country")

	await _view(legend, "Wars")
	data = legend.get("data")
	for words in ["Southern Border War", "Horn of Africa War", "Caucasus War", "Not at war"]:
		_check(_has_text(legend, words), "Wars lists %s" % words)
	_check(_rgb("Libya") == "60,138,138,255" and _rgb("France") == "201,154,82,255", "each war's sides take beta's pair", "Libya %s France %s" % [_rgb("Libya"), _rgb("France")])
	_check(int(layers.call("hatched_regions")) > 0, "a ceasefire's belligerents are hatched")
	await _shoot("dl-wars")
	await _act(legend, _button(legend, "Southern Border War"))
	data = legend.get("data")
	_check(str(data.get("focusWar", "")) == "war-sahel" and _rgb("Ethiopia").ends_with(",191"), "a war picked in the legend comes first and the rest dim")
	await _act(legend, _button(legend, "Southern Border War"))

	await _view(legend, "Blocs")
	data = legend.get("data")
	for words in ["Member", "Associate", "Participant", "Candidate", "Observer", "Suspended", "Not a member"]:
		_check(_has_text(legend, words), "Blocs lists %s" % words)
	_check(str(data.get("institutionId", "")) == "nato" and _rgb("Ukraine") == "167,195,207,255", "Blocs opens on the player's largest institution", str(data.get("institutionId", "")))
	_check(int(layers.call("hatched_regions")) > 0 and bool(((data.get("owners", {}) as Dictionary).get("Germany", {}) as Dictionary).get("area", false)), "candidates are hatched and the members outlined")
	await _shoot("dl-blocs")

	await _view(legend, "Government")
	data = legend.get("data")
	for words in ["Regime", "Representation", "Ideology", "Power", "Democratic", "Totalitarian", "Puppet, in its overlord's colour"]:
		_check(_has_text(legend, words), "Government shows %s" % words)
	_check(_rgb("France") == "47,111,166,255" and _rgb("China") == "122,31,31,255", "governments by regime in beta's colours", "France %s China %s" % [_rgb("France"), _rgb("China")])
	await _shoot("dl-government")
	await _view(legend, "Power")
	_check(_has_text(legend, "Major power") and _rgb("France") == "40,75,99,255", "Power colours by tier", _rgb("France"))

	await _act(legend, _button(legend, "Hide legend"))
	var shelf: Button = hud.get("_legend_button")
	_check(not legend.visible and shelf != null and shelf.visible, "the legend folds away and the switch offers it back")
	await _shoot("dl-folded")
	await _act(legend, shelf)
	_check(legend.visible and not shelf.visible, "Show legend brings it back")

	var place := legend.get_global_rect()
	var view_size := root.get_visible_rect().size
	var toggle := (hud.get("_mode_frame") as Control).get_global_rect()
	if phone:
		_check(absf(place.end.x - (view_size.x - 8.0)) < 1.5 and absf(place.end.y - (view_size.y - 134.4)) < 1.5, "on a phone the legend stands above the advisor's button", str(place))
	else:
		_check(absf(place.end.x - (view_size.x - 80.0)) < 1.5 and absf(place.end.y - (toggle.position.y - 5.6)) < 1.5 and absf(place.size.x - 320.0) < 1.0, "the legend rides over the switch beside the advisor's button", "%s %s" % [str(place), str((legend.get("_column") as Control).get_children().map(func(child: Node) -> float: return (child as Control).get_combined_minimum_size().x))])

	await _view(legend, "Relations")
	await _act(legend, (hud.get("_mode_buttons") as Dictionary)["political"] as Button)
	_check(not legend.visible and (map.get("_color_override") as Dictionary).is_empty() and not bool(layers.get("active")), "the political map puts its own colours back")
	kept = await main.engine.request("hud.mapMode")
	_check(str((kept.get("result", {}) as Dictionary).get("mode", "")) == "political", "the map mode is kept for the game")
	await _shoot("dl-political")
	_finish(0 if failures.is_empty() else 1)
