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
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.add_child(main)
	_run.call_deferred()


func _say(text: String) -> void:
	print("[phone-map %6d ms] %s" % [Time.get_ticks_msec() - started, text])


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


func _check(ok: bool, what: String) -> void:
	_say(("PASS " if ok else "FAIL ") + what)
	if not ok:
		failures.append(what)


func _finish(code: int) -> void:
	_say("done: %d failure(s) %s" % [failures.size(), ", ".join(failures)])
	main.engine.stop()
	quit(code)


func _until(test: Callable, seconds: float) -> bool:
	var until := Time.get_ticks_msec() + int(seconds * 1000.0)
	while Time.get_ticks_msec() < until:
		if test.call():
			return true
		await process_frame
	return bool(test.call())


func _rect(control: Control) -> Rect2:
	return control.get_global_rect() if control and is_instance_valid(control) else Rect2()


func _near(a: float, b: float, slack := 2.0) -> bool:
	return absf(a - b) <= slack


func _shown(control: Control) -> bool:
	return control != null and is_instance_valid(control) and control.is_visible_in_tree()


func _find_all(node: Node, test: Callable, found: Array) -> Array:
	if test.call(node):
		found.append(node)
	for child in node.get_children():
		_find_all(child, test, found)
	return found


func _button(node: Node, words: String) -> BaseButton:
	var found := _find_all(node, func(item: Node) -> bool: return item is BaseButton and _shown(item as Control) and (str(item.get("text")) == words or (item as Control).tooltip_text == words), [])
	if found.is_empty():
		return null
	var button := found[0] as BaseButton
	return button.get_parent() as BaseButton if button is LinkButton and button.get_parent() is Button else button


func _label(node: Node, words: String) -> Control:
	var found := _find_all(node, func(item: Node) -> bool: return (item is Label and (item as Label).text == words) or (item is RichTextLabel and (item as RichTextLabel).get_parsed_text() == words), [])
	return found[0] as Control if not found.is_empty() else null


func _run() -> void:
	await process_frame
	_check(UI.phone(), "the phone layout is on")
	if not await _until(func() -> bool: return main.menu.visible, 120.0):
		_check(false, "the menu appeared")
		_finish(1)
		return
	await _clear_shell()
	await main._start_scenario("default")
	await _wait(3.0)
	main.picker._choose("France")
	await _wait(1.0)
	await main._on_country_chosen("France", "medium")
	var hud: Hud = main.hud
	await _until(func() -> bool: return hud.map_cards != null and hud.search != null, 20.0)
	await _wait(4.0)
	await _search(hud)
	await _region(hud)
	var seeded: Dictionary = await main.engine.request("country.standin_seed", {"blocs": true})
	_check(seeded.get("ok", false), "the stand-in world is seeded")
	await _wait(1.0)
	if hud.war_cards:
		hud.war_cards.visible = false
	await _unit_and_feature(hud)
	await _legend(hud)
	await _ai_setup()
	_finish(0 if failures.is_empty() else 1)


func _search(hud: Hud) -> void:
	var view := root.get_visible_rect().size
	var search = hud.search
	var box := search as Control
	var dock := _rect(hud._dock)
	var shut := _rect(box)
	_check(_near(shut.size.x, 51.2, 0.6) and _near(shut.size.y, 51.2, 0.6), "closed, Search is a 3.2rem square (%s)" % str(shut.size))
	_check(_near(shut.end.y, view.y - 14.4, 1.0) and _near(shut.get_center().y, dock.get_center().y, 1.0), "closed, Search stands level with the dock")
	_check(shut.position.x >= dock.end.x + 7.0, "closed, Search sits beside the dock")
	await _shoot("m-search-closed")
	await search.open()
	await _wait(0.6)
	var bar := _rect(box)
	_check(_near(bar.position.x, 8.0, 1.0) and _near(bar.end.x, view.x - 8.0, 1.0), "open, Search is a bar across the phone (%s)" % str(bar))
	_check(_near(bar.size.y, 48.0, 0.6) and _near(bar.end.y, view.y - 80.0, 1.0), "open, the bar is 3rem tall just above the dock")
	var toggle := search.get("_toggle") as Control
	var go := search.get("_go") as Control
	_check(_near(_rect(toggle).size.x, 48.0, 0.6) and _rect(go).size.x >= 43.5 and _rect(go).end.x <= bar.end.x + 0.5, "the close and Go buttons are finger-sized")
	await _shoot("m-search-open")
	var input := search.get("_input") as LineEdit
	input.text = "Pari"
	await search._on_text_changed("Pari")
	await _until(func() -> bool: return (search.get("suggestions") as Array).size() > 0, 10.0)
	await _wait(0.8)
	var list := search.get("_list_panel") as Control
	var rows := _find_all(list, func(node: Node) -> bool: return node is PanelContainer and node.has_signal("picked"), [])
	_check(_shown(list) and rows.size() > 0, "the results list opens (%d rows)" % rows.size())
	if _shown(list):
		var lr := _rect(list)
		_check(_near(lr.end.y, bar.position.y + 1.0, 1.5) and _near(lr.position.x, bar.position.x - 1.0, 1.0) and _near(lr.end.x, bar.end.x + 1.0, 1.0), "the results stand on the bar, its width (%s)" % str(lr))
		_check(lr.position.y >= 0.0, "the results fit above the bar")
	if rows.size() > 0:
		_check(_rect(rows[0] as Control).size.y >= 43.5, "a result row is finger-high (%.1f)" % _rect(rows[0] as Control).size.y)
	await _shoot("m-search-results")
	search.close()
	await _wait(0.6)
	var back := _rect(box)
	_check(_near(back.size.x, 51.2, 0.6) and _near(back.position.x, shut.position.x, 1.0) and _near(back.end.y, shut.end.y, 1.0), "closed again, Search goes back beside the dock")


func _region(hud: Hud) -> void:
	var cards = hud.map_cards
	var view_size := root.get_visible_rect().size
	var map: MapView = main.map_view
	var installed := 0
	for entry in [["Mali", "protectorate"], ["Chad", "client"], ["Andorra", "client"], ["Tunisia", "satellite"], ["Luxembourg", "client"], ["Belgium", "satellite"], ["Monaco", "client"]]:
		var made: Dictionary = await main.engine.request("cheats.puppets.change", {"op": "install", "overlord": "France", "puppet": entry[0], "kind": entry[1]})
		if made.get("ok", false):
			installed += 1
	_check(installed >= 5, "subordinate states installed for France (%d)" % installed)
	var index := -1
	for candidate in range(4000):
		if map.region_owner(candidate) == "France":
			index = candidate
			break
	await cards.show_region(index, map.region_name(index), map.region_owner(index), Vector2(200, 300))
	await _until(func() -> bool: return cards._floating != null, 20.0)
	await _wait(0.8)
	var card := cards._floating as Control
	_check(card != null, "the region card opens")
	if card == null:
		return
	var r := _rect(card)
	_check(_near(r.position.x, 8.0, 1.0) and _near(r.end.x, view_size.x - 8.0, 1.0) and _near(r.end.y, view_size.y - 80.0, 1.5), "the region card is a sheet above the dock")
	var close := _button(card, "Close region card")
	_check(close != null and _near(_rect(close).size.x, 44.0, 0.6) and _near(_rect(close).end.x, r.end.x - 7.0, 1.5), "the close button is 44 px in the flag's corner")
	for title in ["Open diplomatic chat", "Copy name", "Country intel (AI)", "Copy region name", "Region info"]:
		var button := _button(card, title)
		_check(button != null and _near(_rect(button).size.x, 44.0, 0.6) and _near(_rect(button).size.y, 44.0, 0.6), "%s is a 44 px button" % title)
	var chat := _button(card, "Open diplomatic chat")
	var intel := _button(card, "Country intel (AI)")
	if chat and intel:
		_check(_near(_rect(intel).end.x, r.end.x - 11.0, 1.5) and _near(_rect(intel).position.x - _rect(chat).end.x, 44.0 + 8.0, 1.5), "the country's buttons stand 4 px apart at the right")
	var link := _button(card, "Country")
	_check(link != null and _rect(link).size.y >= 43.5 and _rect(link).size.x >= 43.5, "Country → Diplomacy's link is finger-sized")
	_check(_label(card, "Subordinate states") != null and _label(card, "+%d more" % (installed - 2)) != null, "the subordinate states are listed with +%d more" % (installed - 2))
	var rostra := _button(card, "Check in Rostra")
	if rostra == null:
		var rows := _find_all(card, func(node: Node) -> bool: return node is Button and _label(node, "Check in Rostra") != null, [])
		rostra = rows[0] as BaseButton if not rows.is_empty() else null
	_check(rostra != null and _rect(rostra).size.y >= 43.5 and _near(_rect(rostra).size.x, r.size.x - 20.0, 2.5), "Check in Rostra is a finger-high row across the card (%s in %s)" % [str(_rect(rostra).size), str(r.size)])
	await _shoot("m-region")
	var info := _button(card, "Region info")
	if info:
		info.pressed.emit()
		await _wait(0.6)
	var scroll: ScrollContainer = cards._region_scroll
	if scroll:
		scroll.scroll_vertical = 100000
	await _wait(0.4)
	card = cards._floating as Control
	_check(card != null and (_label(card, "Neighbours") != null or _label(card, "Cities") != null), "the region's cities and neighbours show")
	await _shoot("m-region-p2")
	cards.dismiss_all()
	for entry in ["Mali", "Chad", "Andorra", "Tunisia", "Luxembourg", "Belgium", "Monaco"]:
		await main.engine.request("cheats.puppets.change", {"op": "release", "overlord": "France", "puppet": entry})
	await _wait(0.4)


func _unit_and_feature(hud: Hud) -> void:
	var cards = hud.map_cards
	var view_size := root.get_visible_rect().size
	await cards.refresh()
	var unit_pick: Dictionary = cards.pick_unit_or_feature(cards._project(1.6, 47.3))
	if str(unit_pick.get("kind", "")) != "unit":
		main.map_view.fly_to_lonlat(1.6, 47.3, 6.0, 0.01)
		await _wait(0.8)
		unit_pick = cards.pick_unit_or_feature(cards._project(1.6, 47.3))
	_check(str(unit_pick.get("kind", "")) == "unit", "the seeded unit can be picked")
	if str(unit_pick.get("kind", "")) == "unit":
		await cards.open_pick(unit_pick)
		await _wait(0.8)
		var card := cards._floating as Control
		var r := _rect(card)
		_check(card != null and _near(r.position.x, 8.0, 1.0) and _near(r.end.x, view_size.x - 8.0, 1.0), "the unit card is a sheet the phone's width")
		var close := _button(card, "Close unit card")
		_check(close != null and _near(_rect(close).size.x, 44.0, 0.6), "the unit card's close button is 44 px")
		for words in ["Request orders", "Disband"]:
			var button := _button(card, words)
			_check(button != null and _rect(button).size.y >= 43.5, "%s is finger-high" % words)
		await _shoot("m-unit")
		cards.dismiss()
		await _wait(0.4)
	var handled: bool = await cards.handle_click(cards._project(5.93, 43.12))
	await _wait(0.8)
	_check(handled, "the seeded feature opens")
	if handled:
		var card := cards._floating as Control
		var r := _rect(card)
		_check(card != null and _near(r.position.x, 8.0, 1.0) and _near(r.end.x, view_size.x - 8.0, 1.0), "the feature card is a sheet the phone's width")
		var close := _button(card, "Close feature card")
		_check(close != null and _near(_rect(close).size.x, 44.0, 0.6), "the feature card's close button is 44 px")
		await _shoot("m-feature")
		cards.dismiss_all()
		await _wait(0.4)


func _legend(hud: Hud) -> void:
	var view_size := root.get_visible_rect().size
	hud.set_map_mode("diplomatic", true)
	await hud._apply_map_mode()
	await _wait(1.5)
	var legend := hud.legend as Control
	_check(_shown(legend), "the diplomatic legend shows")
	if _shown(legend):
		var r := _rect(legend)
		var toggle := _rect(hud.get("_mode_frame") as Control)
		_check(_near(r.end.x, view_size.x - 80.0, 1.5) and _near(r.end.y, toggle.position.y - 5.6, 1.5), "the legend stands left of the Advisor button, over the map switch (%s)" % str(r))
		var shut := _button(legend, "Close legend")
		_check(shut != null and _rect(shut).size.y < 30.0, "the legend's close mark keeps beta's small size")
	await _shoot("m-legend")
	hud.set_map_mode("political", true)
	await hud._apply_map_mode()
	await _wait(0.6)


func _ai_setup() -> void:
	var view_size := root.get_visible_rect().size
	var menu = main.game_menu
	var setup: Dictionary = await main.engine.request("settings.aiSetup")
	_say("ai setup ready=%s" % str((setup.get("result", {}) as Dictionary).get("ready", false)))
	await menu.show_ai_setup(true, "phone-map")
	await _wait(1.0)
	var prompt := menu.get("_prompt") as Control
	_check(_shown(prompt), "the AI setup prompt shows")
	if not _shown(prompt):
		return
	var cards := _find_all(prompt, func(node: Node) -> bool: return node is PanelContainer and node.get_parent() is CenterContainer, [])
	var card := cards[0] as Control if not cards.is_empty() else null
	var r := _rect(card)
	_check(card != null and _near(r.position.x, 16.0, 1.0) and _near(r.end.x, view_size.x - 16.0, 1.0), "the prompt is the phone's width less 1rem a side (%s)" % str(r))
	_check(r.position.y >= 15.5 and r.end.y <= view_size.y - 15.5, "the prompt fits the phone's height and scrolls")
	var cross: BaseButton = null
	for node in _find_all(prompt, func(item: Node) -> bool: return item is Button and (item as Button).text == "✕", []):
		cross = node
	_check(cross != null and _near(_rect(cross).size.x, 44.0, 0.6) and _rect(cross).position.y < r.position.y + 40.0, "a 44 px ✕ answers Not now at the top")
	var key := _button(prompt, "Get a key at Google AI Studio ↗")
	var heading := _label(prompt, "New to API keys?")
	_check(key != null and heading != null and _rect(key).position.y > _rect(heading).position.y + 20.0, "the key button wraps under New to API keys?")
	var video := _button(prompt, "▶   Play the video (loads YouTube)")
	_check(video != null and _near(_rect(video).size.y, roundf(_rect(video).size.x * 9.0 / 16.0), 1.5), "the video is 16:9 of the box")
	var watch := _button(prompt, "Watch on YouTube ↗")
	var hide := _button(prompt, "Hide the video")
	_check(watch != null and hide != null and _rect(watch).size.y >= 43.5 and _rect(hide).size.y >= 43.5, "the video's links are finger-high")
	var lines := _find_all(prompt, func(node: Node) -> bool: return node is LineEdit and _shown(node as Control), [])
	_check(lines.size() == 2 and lines.all(func(node: Node) -> bool: return _rect(node as Control).size.y < 40.0), "the key and model fields keep beta's height")
	await _shoot("m-ai-setup")
	var scroll := _find_all(prompt, func(node: Node) -> bool: return node is ScrollContainer, [])
	if not scroll.is_empty():
		(scroll[0] as ScrollContainer).scroll_vertical = 100000
	await _wait(0.4)
	var later := _button(prompt, "Not now")
	var full := _button(prompt, "Open full settings")
	var save := _button(prompt, "Save and play")
	_check(later != null and full != null and save != null and _rect(save).position.y > _rect(full).position.y + 20.0 and _near(_rect(save).end.x, _rect(full).end.x, 1.5), "the buttons wrap to the right, Save and play on its own row")
	_check(later != null and _rect(later).size.y >= 43.5, "the buttons are finger-high")
	await _shoot("m-ai-setup-p2")
	main.phone_shell.back()
	await _wait(0.6)
	_check(not is_instance_valid(menu.get("_prompt")) or menu.get("_prompt") == null, "Back answers the prompt with Not now")
	_check(main.in_game, "Back did not leave the game")


func _clear_shell() -> void:
	var shell := main.get("shell") as ShellBoot
	if shell == null:
		return
	await _wait(1.0)
	var setup: Variant = shell.get("first_setup")
	if setup is FirstSetup and is_instance_valid(setup):
		(setup as FirstSetup).finished.emit()
		await _wait(0.8)
	if shell.door_state == "deciding":
		await _until(func() -> bool: return shell.door_state != "deciding", 60.0)
	if shell.door != null and is_instance_valid(shell.door):
		shell.door.opened.emit()
		await _until(func() -> bool: return shell.door == null, 10.0)
	if not shell.notice_updates.is_empty():
		await _until(func() -> bool: return shell.notice != null and is_instance_valid(shell.notice), 5.0)
		if shell.notice != null and is_instance_valid(shell.notice):
			shell.notice.closed.emit()
	await _wait(0.5)
