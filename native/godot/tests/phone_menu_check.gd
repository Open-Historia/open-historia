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
	print("[phone-menu %6d ms] %s" % [Time.get_ticks_msec() - started, text])


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


func _find(node: Node, test: Callable) -> Array:
	var found: Array = []
	if test.call(node):
		found.append(node)
	for child in node.get_children():
		found.append_array(_find(child, test))
	return found


func _button_texts(node: Node) -> PackedStringArray:
	var texts := PackedStringArray()
	for button in _find(node, func(item: Node) -> bool: return item is Button and (item as Button).is_visible_in_tree()):
		var text := str((button as Button).text)
		if text.is_empty():
			var inner := _find(button, func(item: Node) -> bool: return item is Label)
			if not inner.is_empty():
				text = str((inner[0] as Label).text)
		if not text.is_empty():
			texts.append(text)
	return texts


func _labels(node: Node) -> PackedStringArray:
	var texts := PackedStringArray()
	for label in _find(node, func(item: Node) -> bool: return item is Label and (item as Label).is_visible_in_tree()):
		texts.append(str((label as Label).text))
	return texts


func _scroll_page(amount: float) -> void:
	var body := main.menu.get("_body") as ScrollContainer
	body.scroll_vertical = int(amount)
	await _wait(0.4)


func _run() -> void:
	await process_frame
	_check(UI.phone(), "the phone layout is on")
	var view := root.get_visible_rect().size
	if not await _until(func() -> bool: return main.menu.visible and main.menu.loaded, 120.0):
		_check(false, "the menu appeared")
		_finish(1)
		return
	await _clear_shell()
	await _wait(1.0)
	var menu: Control = main.menu
	var rail := menu.get("_rail_panel") as Control
	_check(rail.is_visible_in_tree() and rail.size.x >= view.x - 1.0, "the pages are a row across the top")
	_check(rail.size.y <= 70.0, "the top row is one row high (%d)" % rail.size.y)
	var tabs: Dictionary = menu.get("_tiles")
	_check(not tabs.has("lobbies") or not (tabs["lobbies"] as Control).visible, "no Lobbies tab on a phone")
	_check(tabs.has("games") and tabs.has("scenarios") and tabs.has("community"), "Games, Scenarios and Community tabs")
	var order: Array = []
	for key in ["games", "scenarios", "community"]:
		order.append((tabs[key] as Control).global_position.x)
	_check(order[0] < order[1] and order[1] < order[2], "the tabs run Games, Scenarios, Community")
	var title := menu.get("_title") as Label
	_check(not title.is_visible_in_tree(), "no page title bar on a phone")
	var page := menu.get("_page_root") as Control
	var buttons := _button_texts(page)
	_check(buttons.has("Settings") and buttons.has("Refresh") and buttons.has("Import Game"), "Settings, Refresh and Import Game head the Games page (%s)" % ", ".join(buttons))
	var words := _labels(page)
	_check(words.has("No games yet"), "the empty Games page says No games yet")
	_check(buttons.has("Start from a scenario") and buttons.has("Browse community scenarios"), "the empty state offers its two buttons")
	await _shoot("phone-menu-games-empty")
	menu.call("_show_page", "community")
	await _wait(2.0)
	buttons = _button_texts(menu.get("_page_root") as Control)
	_check(buttons.size() > 0 and buttons[0] == "Settings", "Settings heads the Community page")
	await _shoot("phone-menu-community")
	menu.call("_show_page", "scenarios")
	await _wait(2.5)
	page = menu.get("_page_root") as Control
	buttons = _button_texts(page)
	_check(buttons.has("Import Scenario"), "Import Scenario heads the Scenarios page")
	words = _labels(page)
	_check(words.has("Recently Used") and words.has("Scenario Library"), "Recently Used then the Scenario Library")
	var cards := _find(page, func(item: Node) -> bool: return item is PanelContainer and item.has_meta("oh_card"))
	if not cards.is_empty():
		var first := cards[0] as Control
		_check(absf(first.size.x - minf(336.0, view.x - 38.4)) < 2.0, "a scenario card is a phone shelf card wide (%d)" % first.size.x)
	else:
		_check(false, "scenario cards are shown")
	var rows := _find(page, func(item: Node) -> bool: return item is ScrollContainer and item.has_meta("oh_shelf"))
	_check(rows.size() >= 2, "the cards sit in rows that swipe sideways")
	await _shoot("phone-menu-scenarios")
	await _scroll_page(440)
	await _shoot("phone-menu-scenarios-p2")
	await _scroll_page(900)
	await _shoot("phone-menu-scenarios-p3")
	await _scroll_page(0)
	await main._start_scenario("default")
	await _wait(3.0)
	var picker: Control = main.picker
	var modal := picker.get("_modal") as Control
	_check(modal.size.x <= view.x * 0.94 + 1.0, "the picker card is the phone's width (%d)" % modal.size.x)
	_check(modal.global_position.y <= 14.0 + UI.safe_insets().y, "the picker card sits at the top")
	var search := _find(modal, func(item: Node) -> bool: return item is LineEdit and item.is_visible_in_tree())
	_check(not search.is_empty() and (search[0] as LineEdit).placeholder_text == "Search countries…", "the search box heads the map")
	var frame := picker.get("_map_frame") as Control
	_check(frame.is_visible_in_tree() and absf(frame.size.y - 320.0) < 3.0, "the map is 320 px high (%d)" % frame.size.y)
	if not search.is_empty() and frame.is_visible_in_tree():
		_check((search[0] as Control).global_position.y < frame.global_position.y, "the search box is above the map")
	words = _labels(modal)
	_check(not words.has("Select Nation"), "no Select Nation heading on a phone")
	await _shoot("phone-picker")
	if not search.is_empty():
		var box := search[0] as LineEdit
		box.text = "fra"
		box.text_changed.emit("fra")
		await _wait(0.8)
		_check(not frame.is_visible_in_tree(), "the map folds away while searching")
		await _shoot("phone-picker-search")
		box.text = ""
		box.text_changed.emit("")
		await _wait(0.5)
	picker.call("_choose", "France")
	await _wait(1.0)
	_check(modal.size.x <= minf(460.0, view.x * 0.92) + 1.0, "the difficulty card is 92 percent of the phone (%d)" % modal.size.x)
	words = _labels(modal)
	_check(words.has("Choose your difficulty") and words.has("Selected Nation"), "the difficulty step names the nation")
	await _shoot("phone-picker-chosen")
	await main._on_country_chosen("France", "medium")
	await _wait(4.0)
	await main._exit_game()
	await _wait(2.0)
	menu.call("_show_page", "games")
	await _wait(1.5)
	page = menu.get("_page_root") as Control
	words = _labels(page)
	_check(words.has("Continue Playing") and words.has("All Games"), "Continue Playing then All Games")
	var game_cards := _find(page, func(item: Node) -> bool: return item is PanelContainer and item.has_meta("oh_card"))
	_check(not game_cards.is_empty(), "game cards are shown")
	await _shoot("phone-menu-games")
	await _scroll_page(500)
	await _shoot("phone-menu-games-p2")
	_finish(0 if failures.is_empty() else 1)


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
