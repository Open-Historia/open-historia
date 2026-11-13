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
	_check(tabs.has("lobbies") and (tabs["lobbies"] as Control).visible, "the Lobbies tab is on a phone, read-only")
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
	await _editor(view)
	_finish(0 if failures.is_empty() else 1)


func _rightmost(node: Node) -> float:
	var most := 0.0
	for child in node.get_children():
		if child is Control and (child as Control).is_visible_in_tree() and child.get_parent() is Container:
			most = maxf(most, (child as Control).get_global_rect().end.x)
		if not (child is ScrollContainer and (child as ScrollContainer).horizontal_scroll_mode != ScrollContainer.SCROLL_MODE_DISABLED):
			most = maxf(most, _rightmost(child))
	return most


func _chain(node: Node, limit: float) -> String:
	var best: Control = null
	for child in node.get_children():
		if child is Control and (child as Control).visible and (child as Control).get_combined_minimum_size().x > limit:
			if best == null or (child as Control).get_combined_minimum_size().x > best.get_combined_minimum_size().x:
				best = child
	var text := ""
	if node is Label or node is Button:
		text = str(node.get("text")).left(50)
	elif node is RichTextLabel:
		text = (node as RichTextLabel).get_parsed_text().left(50)
	var here := "%s(%s) %.0f \"%s\"" % [node.get_class(), str(node.get_script().resource_path.get_file()) if node.get_script() else "", (node as Control).get_combined_minimum_size().x if node is Control else 0.0, text]
	if best:
		return here + " > " + _chain(best, limit)
	var kids: PackedStringArray = []
	for child in node.get_children():
		if child is Control and (child as Control).visible:
			var label := ""
			if child is Label or child is Button:
				label = str(child.get("text")).left(30)
			kids.append("%s %.0f \"%s\"" % [child.get_class(), (child as Control).get_combined_minimum_size().x, label])
	return here + " [" + ", ".join(kids) + "]"


func _editor(view: Vector2) -> void:
	var editor: Control = main.editor
	if editor == null:
		_check(false, "the scenario editor is mounted")
		return
	await editor.open_scenario("default")
	await _wait(1.5)
	_check(editor.is_open(), "the scenario editor opens")
	var dialog := editor.get("_dialog") as Control
	var r := dialog.get_global_rect()
	_check(r.position == Vector2.ZERO and absf(r.size.x - view.x) < 1.0 and absf(r.size.y - view.y) < 1.0, "on a phone the editor fills the screen (%s)" % str(r))
	var tabs := editor.get("_phone_tabs") as Control
	_check(tabs != null and tabs.is_visible_in_tree() and tabs.get_child_count() >= 8, "the sections are a row of tabs across the top")
	if tabs and tabs.get_child_count() > 0:
		_check((tabs.get_child(0) as Control).size.y >= 43.5, "a section tab is finger-high")
	var close := _find(dialog, func(item: Node) -> bool: return item.has_meta("close_button") and (item as Control).is_visible_in_tree())
	_check(close.size() == 1 and (close[0] as Control).size.x >= 43.5 and (close[0] as Control).size.y >= 43.5, "one close button, 44 px")
	var actions := editor.get("_phone_actions") as Control
	_check(actions != null and actions.is_visible_in_tree() and actions.get_global_rect().end.y <= view.y + 0.5, "Save and the editor's actions stand at the foot")
	var content := editor.get("_content") as Control
	for key in ["overview", "world", "history", "politics", "stats", "features", "prompts", "assets", "music", "languages", "bundles"]:
		editor._go_section(key)
		await _wait(1.4 if key in ["music", "features", "languages", "politics"] else 0.7)
		var widest := _rightmost(content)
		_check(widest <= view.x + 0.5, "the editor's %s fits the phone's width (rightmost %.1f)" % [key, widest])
		if widest > view.x + 0.5:
			_say("too wide: " + _chain(content, view.x - 40.0))
		await _shoot("phone-editor-" + key)
	await _region_picker(view)
	editor.close_editor()
	await _wait(0.6)


func _region_picker(view: Vector2) -> void:
	var picker := EditorRegionPicker.new()
	(main.editor as Control).add_child(picker)
	picker.open(main.engine, {"scenarioId": str(main.editor.current_id()), "customRegions": true, "ownerOverrides": null}, [], false)
	await _until(func() -> bool: return picker.map_ready or picker.load_failed, 120.0)
	await _wait(0.8)
	_check(picker.map_ready, "the region picker draws the scenario's map")
	var dialog := picker.get("_dialog") as Control
	var r := dialog.get_global_rect()
	_check(r.position == Vector2.ZERO and absf(r.size.x - view.x) < 1.0 and absf(r.size.y - view.y) < 1.0, "on a phone the region picker fills the screen (%s)" % str(r))
	var frame := picker.get("_map_frame") as Control
	var search := picker.get("_search") as Control
	_check(frame.get_global_rect().end.y <= search.get_global_rect().position.y, "the map stands over the search and the list")
	_check(_rightmost(dialog) <= view.x + 0.5, "the region picker fits the phone's width (rightmost %.1f)" % _rightmost(dialog))
	await _shoot("phone-region-picker")
	picker.queue_free()
	await _wait(0.4)


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
