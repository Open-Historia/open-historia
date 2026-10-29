extends SceneTree

var main: Node
var shots := ""
var started := 0
var failures: PackedStringArray = []
var probed := 0
var screens := 0
var only := ""


func _initialize() -> void:
	var redraw := Node2D.new()
	root.add_child(redraw)
	process_frame.connect(redraw.queue_redraw)
	root.mouse_passthrough = true
	shots = OS.get_environment("OH_SHOTS")
	only = OS.get_environment("OH_CLICK_ONLY")
	started = Time.get_ticks_msec()
	main =(load("res://main.tscn") as PackedScene).instantiate()
	root.add_child(main)
	_run.call_deferred()


func _say(text: String) -> void:
	print("[click %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _check(label: String, ok: bool, detail := "") -> void:
	_say("%s %s%s" % ["ok   " if ok else "FAIL ", label, ("  (" + detail + ")") if not detail.is_empty() else ""])
	if not ok:
		failures.append(label)


func _want(part: String) -> bool:
	return only.is_empty() or only.split(",").has(part)


func _wait(seconds: float) -> void:
	await create_timer(seconds).timeout


func _frames(count: int) -> void:
	for i in range(count):
		await process_frame


func _until(condition: Callable, seconds: float) -> bool:
	var deadline := Time.get_ticks_msec() + int(seconds * 1000.0)
	while Time.get_ticks_msec() < deadline:
		if condition.call():
			return true
		await process_frame
	return bool(condition.call())


func _shoot(name: String) -> void:
	await _frames(3)
	await RenderingServer.frame_post_draw
	if shots.is_empty():
		return
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(name + ".png"))


func _path(node: Node) -> String:
	if node == null:
		return "<nothing>"
	var parts := PackedStringArray()
	var at := node
	while at and at != root:
		var label := at.get_class()
		var script: Variant = at.get_script()
		if script is Script and not (script as Script).resource_path.is_empty():
			label = (script as Script).resource_path.get_file().get_basename()
		parts.insert(0, "%s(%s)" % [at.name, label])
		at = at.get_parent()
	return "/".join(parts)


func _words(control: Control) -> String:
	var said := ""
	if control is Button and not (control as Button).text.is_empty():
		said = (control as Button).text
	elif control is LineEdit:
		said = (control as LineEdit).text if not (control as LineEdit).text.is_empty() else (control as LineEdit).placeholder_text
	elif not control.tooltip_text.is_empty():
		said = control.tooltip_text
	else:
		for child in control.find_children("*", "Label", true, false):
			if (child as Label).is_visible_in_tree() and not (child as Label).text.is_empty():
				said = (child as Label).text
				break
	return said.replace("\n", " ").substr(0, 40)


func _move(point: Vector2) -> Control:
	var motion := InputEventMouseMotion.new()
	motion.position = point
	motion.global_position = point
	root.push_input(motion)
	return root.gui_get_hovered_control()


func _hover(point: Vector2) -> Control:
	var hovered := _move(point)
	await process_frame
	var again := root.gui_get_hovered_control()
	return again if again != null else hovered


func _click(point: Vector2) -> void:
	_move(point)
	await process_frame
	for pressed in [true, false]:
		var button := InputEventMouseButton.new()
		button.button_index = MOUSE_BUTTON_LEFT
		button.pressed = pressed
		button.button_mask = MOUSE_BUTTON_MASK_LEFT if pressed else 0
		button.position = point
		button.global_position = point
		root.push_input(button)
		await process_frame
	await process_frame


func _key(code: Key) -> void:
	for pressed in [true, false]:
		var key := InputEventKey.new()
		key.keycode = code
		key.physical_keycode = code
		key.pressed = pressed
		root.push_input(key)
		await process_frame


func _type(text: String) -> void:
	for character in text:
		var key := InputEventKey.new()
		key.unicode = character.unicode_at(0)
		key.pressed = true
		root.push_input(key)
		await process_frame


func _clickable(control: Control) -> bool:
	if control is BaseButton:
		return not (control as BaseButton).disabled
	if control is LineEdit or control is TextEdit or control is Slider or control is ItemList or control is Tree:
		return true
	return control.has_user_signal("pressed") or (control.get_script() != null and _script_has_signal(control.get_script(), "pressed"))


func _script_has_signal(script: Script, name: String) -> bool:
	for entry: Dictionary in script.get_script_signal_list():
		if str(entry.get("name", "")) == name:
			return true
	return false


func _collect(node: Node, out: Array) -> void:
	if node is Window or node is SubViewport:
		return
	if node is CanvasItem and not (node as CanvasItem).visible:
		return
	if node is CanvasLayer and not (node as CanvasLayer).visible:
		return
	if node.has_meta("inert"):
		return
	if node is Control and _clickable(node as Control) and (node as Control).mouse_filter != Control.MOUSE_FILTER_IGNORE:
		out.append(node)
	for child in node.get_children():
		_collect(child, out)


func _alpha(control: Control) -> float:
	var alpha := 1.0
	var at: Node = control
	while at and not (at is CanvasLayer) and at != root:
		if at is CanvasItem:
			alpha *= (at as CanvasItem).modulate.a * (at as CanvasItem).self_modulate.a if at == control else (at as CanvasItem).modulate.a
		at = at.get_parent()
	return alpha


func _shown_rect(control: Control) -> Rect2:
	var rect := control.get_global_transform_with_canvas() * Rect2(Vector2.ZERO, control.size)
	rect = rect.intersection(root.get_visible_rect())
	var at := control.get_parent()
	while at and not (at is CanvasLayer) and at != root:
		if at is Control and (at as Control).clip_contents:
			var box := at as Control
			rect = rect.intersection(box.get_global_transform_with_canvas() * Rect2(Vector2.ZERO, box.size))
		at = at.get_parent()
	return rect


func _verdict(control: Control, hovered: Control) -> String:
	if hovered == null:
		return "nothing under the pointer"
	if hovered == control:
		return ""
	if control.is_ancestor_of(hovered):
		var at: Node = hovered
		while at and at != control:
			if at is Control and _clickable(at as Control):
				return ""
			if at is Control and (at as Control).mouse_filter == Control.MOUSE_FILTER_STOP:
				return "swallowed by its own child " + _path(at)
			at = at.get_parent()
		return ""
	return "blocked by " + _path(hovered)


func _sweep(label: String, scope: Node) -> int:
	screens += 1
	await _frames(2)
	var found: Array = []
	_collect(scope, found)
	var tried := 0
	var failed := 0
	for item in found:
		var control := item as Control
		if not is_instance_valid(control) or not control.is_visible_in_tree():
			continue
		if _alpha(control) < 0.05:
			continue
		var rect := _shown_rect(control)
		if rect.size.x < 3.0 or rect.size.y < 3.0:
			continue
		tried += 1
		var points := [rect.get_center(), rect.position + rect.size * Vector2(0.25, 0.5), rect.position + rect.size * Vector2(0.75, 0.5), rect.position + rect.size * Vector2(0.5, 0.25), rect.position + rect.size * Vector2(0.5, 0.75)]
		var first := ""
		var passed := false
		for point: Vector2 in points:
			var hovered := _move(point)
			var verdict := _verdict(control, hovered)
			if verdict.is_empty():
				passed = true
				break
			if first.is_empty():
				first = verdict
		if not passed:
			var hovered := await _hover(rect.get_center())
			var verdict := _verdict(control, hovered)
			if verdict.is_empty():
				passed = true
			else:
				first = verdict
		if not passed:
			failed += 1
			var line := "%s: %s \"%s\" at %s, %s" % [label, _path(control), _words(control), str(rect.get_center().round()), first]
			_say("FAIL " + line)
			failures.append(line)
	probed += tried
	_say("%s %s: %d controls under the pointer, %d blocked" % ["ok   " if failed == 0 else "FAIL ", label, tried, failed])
	_move(Vector2(2, 2))
	return failed


func _find_button(scope: Node, text: String) -> Control:
	var found: Array = []
	_collect(scope, found)
	for item in found:
		var control := item as Control
		if control.is_visible_in_tree() and control is Button and (control as Button).text == text:
			return control
	for item in found:
		var control := item as Control
		if not control.is_visible_in_tree():
			continue
		if control is Button and (control as Button).text.contains(text):
			return control
		if control.tooltip_text == text:
			return control
	for item in found:
		var control := item as Control
		if not control.is_visible_in_tree():
			continue
		for child in control.find_children("*", "Label", true, false):
			if (child as Label).text == text and (child as Label).is_visible_in_tree():
				return control
	return null


func _press(control: Control, what: String) -> bool:
	if control == null or not is_instance_valid(control):
		_check("%s is there to click" % what, false)
		return false
	var scroll := control.get_parent()
	while scroll and not (scroll is ScrollContainer):
		scroll = scroll.get_parent()
	if scroll is ScrollContainer:
		(scroll as ScrollContainer).ensure_control_visible(control)
		await _frames(3)
	var rect := _shown_rect(control)
	if rect.size.x < 2.0 or rect.size.y < 2.0:
		_check("%s is on screen to click" % what, false, str(rect))
		return false
	var hovered := _move(rect.get_center())
	var verdict := _verdict(control, hovered)
	if not verdict.is_empty():
		_check("%s takes a real click" % what, false, verdict)
	await _click(rect.get_center())
	return verdict.is_empty()


func _clear_shell() -> void:
	var shell: ShellBoot = main.get("shell") as ShellBoot
	if shell == null:
		return
	await _until(func() -> bool: return shell.door_state != "deciding", 30.0)
	if shell.door != null and is_instance_valid(shell.door):
		await _until(func() -> bool: return shell.door_state == "shut", 20.0)
		await _wait(1.0)
		await _sweep("vault door", shell.door)
		await _click(root.get_visible_rect().size * 0.5)
		var opened := await _until(func() -> bool: return shell.door_is_open(), 15.0)
		_check("a real click opens the vault door", opened)
		if not opened and shell.door != null and is_instance_valid(shell.door):
			shell.door.opened.emit()
	if not shell.notice_updates.is_empty():
		await _until(func() -> bool: return shell.notice != null and is_instance_valid(shell.notice), 8.0)
		await _wait(1.5)
	if shell.notice != null and is_instance_valid(shell.notice):
		await _sweep("update notice", shell.notice)
		await _key(KEY_ESCAPE)
		var gone := await _until(func() -> bool: return shell.notice == null or not is_instance_valid(shell.notice), 5.0)
		_check("Escape closes the update notice", gone)
		if not gone:
			shell.notice.closed.emit()
	await _frames(3)


func _run() -> void:
	var up := await _until(func() -> bool: return main.menu.visible, 120.0)
	var wanted := OS.get_environment("OH_CLICK_SIZE")
	if wanted.contains("x"):
		var parts := wanted.split("x")
		DisplayServer.window_set_size(Vector2i(int(parts[0]), int(parts[1])))
		root.size = Vector2i(int(parts[0]), int(parts[1]))
		await _wait(0.5)
		_say("window %s" % str(root.get_visible_rect().size))
	if not up:
		_check("the menu appears", false)
		_finish()
		return
	await _clear_shell()
	await _until(func() -> bool: return bool(main.menu.get("loaded")), 30.0)
	await _wait(1.0)
	if _want("menu"):
		await _menu_part()
	if _want("settings"):
		await _settings_part()
	if _want("history"):
		await _history_part()
	if _want("editor"):
		await _editor_part()
	if _want("game"):
		await _new_game_part()
		if main.in_game:
			await _prompt_part()
			await _hud_part()
			await _game_menu_part()
			if _want("war"):
				await _war_part()
	_finish()


func _menu_part() -> void:
	var menu: MainMenu = main.menu
	var tiles: Dictionary = menu.get("_tiles")
	await _sweep("main menu, games", menu)
	await _shoot("c-menu-games")
	for key: String in ["scenarios", "community", "lobbies", "games"]:
		await _press(tiles[key], "the %s rail tile" % key)
		await _wait(1.2)
		_check("the %s rail tile changes the page" % key, str(menu.get("_page")) == key, str(menu.get("_page")))
		if key != "games":
			await _sweep("main menu, %s" % key, menu)
			await _shoot("c-menu-%s" % key)


func _workspace() -> Control:
	var game_menu: Node = main.game_menu
	return game_menu.get("_workspace") as Control if game_menu else null


func _settings_part() -> void:
	var menu: MainMenu = main.menu
	var tiles: Dictionary = menu.get("_tiles")
	await _press(tiles["settings"], "the Settings rail tile")
	var opened := await _until(func() -> bool: return _workspace() != null and _workspace().visible, 10.0)
	_check("the Settings rail tile opens the settings", opened)
	if not opened:
		return
	await _wait(1.0)
	await _settings_tabs("settings")
	await _key(KEY_ESCAPE)
	var closed := await _until(func() -> bool: return not _workspace().visible and not main.game_menu.visible, 5.0)
	_check("Escape closes the settings", closed)
	if not closed:
		main.game_menu.call("close")
	await _wait(0.5)


func _settings_tabs(label: String) -> void:
	var workspace := _workspace()
	var sections: Array = workspace.get("SECTIONS")
	for index in range(sections.size()):
		var key := str((sections[index] as Dictionary).get("key", ""))
		var nav: VBoxContainer = workspace.get("_nav")
		if index < nav.get_child_count():
			await _press(nav.get_child(index) as Control, "the %s settings tab" % key)
		var moved := await _until(func() -> bool: return str(workspace.get("section")) == key, 3.0)
		if not moved:
			_say("the %s settings tab did not answer the first click; the page was still loading, clicking again" % key)
			nav = workspace.get("_nav")
			if index < nav.get_child_count():
				await _press(nav.get_child(index) as Control, "the %s settings tab" % key)
			await _until(func() -> bool: return str(workspace.get("section")) == key, 10.0)
		await _wait(0.8)
		_check("the %s settings tab opens its page" % key, str(workspace.get("section")) == key, str(workspace.get("section")))
		await _sweep("%s, %s" % [label, key], workspace)
		await _shoot("c-%s-%s" % [label.replace(" ", "-"), key])


func _history_part() -> void:
	var menu: MainMenu = main.menu
	var shell: ShellBoot = main.shell
	var brand := _find_button(menu, "Update history: every update to Open Historia")
	await _press(brand, "the logo")
	var opened := await _until(func() -> bool: return shell.history != null and is_instance_valid(shell.history), 10.0)
	_check("the logo opens the update history", opened)
	if not opened:
		return
	await _wait(1.5)
	await _sweep("update history", shell.history)
	await _shoot("c-history")
	await _key(KEY_ESCAPE)
	var closed := await _until(func() -> bool: return shell.history == null or not is_instance_valid(shell.history), 5.0)
	_check("Escape closes the update history", closed)
	if not closed:
		shell.close_history()
	await _wait(0.4)


func _editor_part() -> void:
	var menu: MainMenu = main.menu
	var editor: Node = main.editor
	await _press(menu.get("_tiles")["scenarios"], "the Scenarios rail tile")
	await _wait(1.0)
	var edit := _find_button(menu, "Edit")
	await _press(edit, "a scenario's Edit button")
	var opened := await _until(func() -> bool: return bool(editor.call("is_open")), 20.0)
	_check("Edit opens the scenario editor", opened)
	if not opened:
		return
	await _wait(1.0)
	var groups: Control = editor.get("_nav_groups")
	var count := 0
	for button in groups.find_children("*", "Button", true, false):
		count += 1
	for index in range(count):
		var buttons := groups.find_children("*", "Button", true, false)
		if index >= buttons.size():
			break
		var before := str(editor.get("_section"))
		await _press(buttons[index] as Control, "editor section %d" % index)
		await _wait(0.9)
		var now := str(editor.get("_section"))
		if index > 0:
			_check("the editor's section %s opens" % now, now != before or index == 0, now)
		await _sweep("scenario editor, %s" % now, editor)
		await _shoot("c-editor-%s" % now)
	if _want("workshop"):
		await _workshop_part(editor)
	editor.call("close_editor")
	await _until(func() -> bool: return not bool(editor.call("is_open")), 10.0)
	await _wait(0.5)


func _workshop_part(editor: Node) -> void:
	var map_button := _find_button(editor, "🗺️ Open Map Editor")
	await _press(map_button, "Open Map Editor")
	var opened := await _until(func() -> bool:
		var shop: Variant = editor.get("_workshop")
		return shop is Control and is_instance_valid(shop) and bool((shop as Control).get("hydrated")), 240.0)
	_check("Open Map Editor opens the Workshop", opened)
	if not opened:
		return
	await _wait(3.0)
	var shop: Control = editor.get("_workshop")
	await _sweep("workshop", shop)
	await _shoot("c-workshop")
	var leave := _find_button(shop, "Exit")
	await _press(leave, "the Workshop's Exit")
	await _wait(0.6)
	await _sweep("workshop, leave without saving?", shop)
	await _press(_find_button(shop, "Exit"), "the Workshop's Exit confirmation")
	var closed := await _until(func() -> bool:
		var still: Variant = editor.get("_workshop")
		return not (still is Control) or not is_instance_valid(still) or not (still as Control).is_visible_in_tree(), 20.0)
	_check("Exit leaves the Workshop", closed)
	await _wait(1.0)


func _new_game_part() -> void:
	var menu: MainMenu = main.menu
	var shell: ShellBoot = main.shell
	await _press(menu.get("_tiles")["scenarios"], "the Scenarios rail tile")
	await _wait(1.0)
	var start := _find_button(menu, "New Game")
	await _press(start, "a scenario's New Game")
	var picking := await _until(func() -> bool: return main.picker.visible, 30.0)
	_check("New Game opens the country picker", picking)
	if not picking:
		await main._start_scenario("default")
		await _until(func() -> bool: return main.picker.visible, 30.0)
	await _wait(1.5)
	var picker: CountryPicker = main.picker
	await _sweep("country picker", picker)
	await _shoot("c-picker")
	var boxes := picker.find_children("*", "LineEdit", true, false)
	if not boxes.is_empty():
		await _press(boxes[0] as Control, "the picker's search box")
		await _type("France")
		await _wait(0.8)
	var row := _find_button(picker, "France")
	await _press(row, "France in the picker")
	await _wait(0.8)
	_check("a real click on France picks it", str((picker.get("_pick") as Dictionary).get("country", "")) == "France", str(picker.get("_pick")))
	await _sweep("country picker, difficulty", picker)
	await _shoot("c-picker-difficulty")
	var medium: Control = null
	for level: Dictionary in picker.get("_difficulties"):
		if str(level.get("id", "")) == "medium":
			medium = _find_button(picker, str(level.get("label", "")))
	var pressed := await _press(medium, "a difficulty")
	if not pressed:
		picker._start("medium")
	var entered := await _until(func() -> bool: return main.in_game and not shell.loading.is_open(), 120.0)
	_check("picking a difficulty starts the game", entered and main.in_game)
	await _wait(2.0)


func _prompt_part() -> void:
	var game_menu: Node = main.game_menu
	var prompt: Variant = game_menu.get("_prompt")
	if not (prompt is Control and is_instance_valid(prompt)):
		await game_menu.show_ai_setup(true, "")
	await _wait(1.0)
	prompt = game_menu.get("_prompt")
	if not (prompt is Control and is_instance_valid(prompt)):
		_check("the AI setup prompt opens", false)
		return
	await _sweep("AI setup prompt", prompt)
	await _shoot("c-ai-setup")
	var not_now := _find_button(prompt, "Not now")
	await _press(not_now, "Not now")
	var closed := await _until(func() -> bool: return not is_instance_valid(prompt) or game_menu.get("_prompt") == null, 5.0)
	_check("Not now closes the AI setup prompt", closed)
	await _wait(0.5)


func _hud_part() -> void:
	var hud: Hud = main.hud
	await _sweep("HUD", hud)
	await _shoot("c-hud")
	var launchers: Dictionary = hud.get("_launchers")
	for name: String in launchers.keys():
		await _press(launchers[name], "the %s dock button" % name)
		await _wait(1.6)
		_check("the %s dock button opens its panel" % name, hud.active_panel == name, hud.active_panel)
		await _sweep("HUD, %s panel" % name, hud)
		await _shoot("c-dock-%s" % name)
		var panel: Variant = hud.panels.get(name)
		var close: Control = null
		if panel is Control:
			close = _find_button(panel as Control, "Close panel")
		if close:
			await _press(close, "the %s panel's close button" % name)
		else:
			await _press(launchers[name], "the %s dock button again" % name)
		await _wait(0.8)
		_check("the %s panel closes" % name, hud.active_panel != name, hud.active_panel)
	var widget: DateWidget = hud.date_widget
	for entry: Array in [["history", widget.get("_back_button")], ["skip", widget.get("_forward_button")]]:
		await _press(entry[1], "the date widget's %s arrow" % entry[0])
		await _wait(1.4)
		_check("the date widget opens %s" % entry[0], widget.open_panel == entry[0], widget.open_panel)
		await _sweep("HUD, date widget %s" % entry[0], hud)
		await _shoot("c-date-%s" % entry[0])
		var frame: Control = widget.get("events_panel") if entry[0] == "history" else widget.get("timeline")
		await _press(_find_button(frame, "Close panel"), "the %s panel's close button" % entry[0])
		await _wait(0.8)
		_check("the %s panel closes" % entry[0], widget.open_panel == "", widget.open_panel)
	await _press(hud.get("_advisor_button"), "the advisor button")
	await _wait(1.6)
	_check("the advisor button opens the advisor", hud.open_drawer == "advisor", hud.open_drawer)
	await _sweep("HUD, advisor", hud)
	await _shoot("c-advisor")
	await _press(hud.get("_advisor_button"), "the advisor button again")
	await _wait(0.8)
	_check("the advisor button closes the advisor", hud.open_drawer == "", hud.open_drawer)
	var flag_button: Control = null
	for child in (hud.get("_flag_frame") as Node).get_children():
		if child is Button:
			flag_button = child
	await _press(flag_button, "the flag badge")
	await _wait(2.0)
	_check("the flag badge opens the country drawer", hud.open_drawer == "country", hud.open_drawer)
	await _sweep("HUD, country drawer", hud)
	await _shoot("c-country")
	await _press(flag_button, "the flag badge again")
	await _wait(0.8)
	_check("the flag badge closes the country drawer", hud.open_drawer == "", hud.open_drawer)
	var search: Control = hud.search
	if search:
		var toggle := search.get("_toggle") as Control
		if toggle == null:
			toggle = _find_button(search, "Search")
		var flips := [0]
		search.connect("expanded_changed", func(_open: bool) -> void: flips[0] += 1)
		await _press(toggle, "the search button")
		_say("search after the click: expanded=%s, changes=%d, hovered=%s" % [str(search.call("is_expanded")), flips[0], _path(root.gui_get_hovered_control())])
		await _wait(0.8)
		_check("the search button opens search", bool(search.call("is_expanded")))
		await _sweep("HUD, search", hud)
		await _shoot("c-search")
		await _key(KEY_ESCAPE)
		await _wait(0.6)
		_check("Escape closes search", not bool(search.call("is_expanded")))
	var map: MapView = main.map_view
	var region := -1
	for index in range(4000):
		if map.region_owner(index) == "France":
			region = index
			break
	var centre := root.get_visible_rect().size * 0.5
	hud.map_cards.show_region(region, map.region_name(region), map.region_owner(region), centre)
	await _until(func() -> bool: return hud.map_cards.get("_floating") != null, 20.0)
	await _wait(1.0)
	var card: Variant = hud.map_cards.get("_floating")
	_check("a region card opens", card is Control)
	if card is Control:
		await _sweep("HUD, region card", hud)
		await _shoot("c-region-card")
		await _key(KEY_ESCAPE)
		await _wait(0.6)
	hud.map_cards.dismiss_all()
	await _wait(0.4)


func _game_menu_part() -> void:
	var hud: Hud = main.hud
	var game_menu: Node = main.game_menu
	var opener := _find_button(hud, "Game menu")
	await _press(opener, "the game menu button")
	var opened := await _until(func() -> bool: return bool(game_menu.call("is_open")) and (game_menu.get("_card") as Control).visible, 8.0)
	_check("the ☰ button opens the game menu", opened)
	if not opened:
		return
	await _wait(0.8)
	var tabs: Dictionary = game_menu.get("_tab_buttons")
	for key: String in ["game", "tools", "settings", "help"]:
		await _press(tabs[key], "the game menu's %s tab" % key)
		await _wait(0.7)
		_check("the %s tab opens" % key, str(game_menu.get("tab")) == key, str(game_menu.get("tab")))
		await _sweep("game menu, %s" % key, game_menu)
		await _shoot("c-game-menu-%s" % key)
	await _press(tabs["settings"], "the game menu's settings tab")
	await _wait(0.6)
	await _press(_find_button(game_menu, "General"), "the General settings tile")
	var workspace_up := await _until(func() -> bool: return _workspace() != null and _workspace().visible, 8.0)
	_check("the General tile opens the settings", workspace_up)
	if workspace_up:
		await _wait(1.0)
		await _settings_tabs("game settings")
		await _key(KEY_ESCAPE)
		var back := await _until(func() -> bool: return not _workspace().visible and (game_menu.get("_card") as Control).visible, 6.0)
		_check("Escape steps back from the settings to the game menu", back)
		await _wait(0.6)
	await _key(KEY_ESCAPE)
	var closed := await _until(func() -> bool: return not bool(game_menu.call("is_open")), 5.0)
	_check("Escape closes the game menu", closed)
	if not closed:
		await game_menu.call("close")
	await _wait(0.5)
	await _sweep("HUD after the game menu", hud)


func _war_part() -> void:
	var button: Node = main.get("war_room_button")
	var room: Node = main.get("war_room")
	if button == null or room == null:
		return
	var war: Dictionary = await main.engine.request("warroom.test.war", {"fronts": [{"against": "Germany", "name": "Rhine Front", "generals": ["Pierre de Villiers"]}]})
	if not war.get("ok", false):
		_say("no war could be set up: %s" % str(war.get("error", "")))
		return
	await main.engine.request("skip", {"days": 7})
	var shown := false
	for attempt in range(20):
		await button.call("refresh")
		await _wait(0.5)
		if (button as Control).is_visible_in_tree():
			shown = true
			break
	if not shown:
		_say("the war room button stayed hidden, so the War Room is not swept: %s" % str(war.get("result", {})).substr(0, 200))
		return
	await _sweep("HUD at war", main.hud)
	await _press(button as Control, "the war room button")
	var opened := await _until(func() -> bool: return bool(room.call("is_open")), 10.0)
	_check("the war room button opens the War Room", opened)
	if not opened:
		return
	await _wait(2.0)
	await _sweep("War Room", room)
	await _shoot("c-war-room")
	await _key(KEY_ESCAPE)
	var closed := await _until(func() -> bool: return not bool(room.call("is_open")), 5.0)
	_check("Escape closes the War Room", closed)
	await _wait(1.0)
	await _sweep("HUD after the War Room", main.hud)


func _finish() -> void:
	_say("screens %d, controls probed %d" % [screens, probed])
	_say("done: %d failure(s)" % failures.size())
	for line in failures:
		_say("  - " + line)
	if main and main.engine:
		main.engine.stop()
	for i in range(3):
		await process_frame
	quit(0 if failures.is_empty() else 1)
