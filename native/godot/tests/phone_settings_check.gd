extends SceneTree

const SECTIONS := ["general", "sound", "map", "ai", "advanced"]

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
	print("[phone-settings %6d ms] %s" % [Time.get_ticks_msec() - started, text])


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


func _back() -> void:
	main.phone_shell.back()
	for i in range(6):
		await process_frame


func _visible_text(node: Node, wanted: String) -> bool:
	if node is CanvasItem and not (node as CanvasItem).is_visible_in_tree():
		return false
	if (node is Label or node is Button) and str(node.get("text")) == wanted:
		return true
	for child in node.get_children():
		if _visible_text(child, wanted):
			return true
	return false


func _run() -> void:
	await process_frame
	_check(UI.phone(), "the phone layout is on")
	var view := root.get_visible_rect().size
	if not await _until(func() -> bool: return main.menu.visible, 120.0):
		_check(false, "the menu appeared")
		_finish(1)
		return
	await _clear_shell()
	await _wait(1.0)
	var menu: Node = main.game_menu
	menu.call("open_app_settings")
	await _wait(1.5)
	var workspace: Control = menu.get("_workspace")
	await _shoot("ps-menu-settings")
	_settings_facts(workspace, view, "app")
	await _back()
	await _wait(0.8)
	_check(not workspace.visible and not bool(menu.call("is_open")), "Back closes the main menu's Settings")
	await main._start_scenario("default")
	await _wait(3.0)
	main.picker._choose("France")
	await _wait(1.0)
	await main._on_country_chosen("France", "medium")
	await _wait(4.0)
	menu.call("open")
	await _wait(1.2)
	var card: Control = menu.get("_card")
	await _shoot("ps-game-menu")
	_check(absf(card.size.x - (view.x - 16.0)) < 1.5, "the game menu is the screen's width less 1 rem (%.0f)" % card.size.x)
	_check(card.position.x <= 8.5, "the game menu sits on the button's corner")
	var tabs: Dictionary = menu.get("_tab_buttons")
	var widths: Array[float] = []
	for key: String in ["game", "tools", "settings", "help"]:
		var button := tabs[key] as Button
		widths.append(button.size.x)
		_check(button.size.y >= 43.5, "the %s tab is a 44 px touch target" % key)
	_check(widths.max() - widths.min() < 60.0 and (tabs["game"] as Button).position.x + 4.0 > 0.0, "the four tabs share the strip")
	var marks: Dictionary = menu.get("_marks")
	var cheats := marks.get("Cheats") as Control
	var events := marks.get("Events / Timeline") as Control
	if cheats and events:
		_check(absf(cheats.global_position.x - events.global_position.x) < 1.0 and events.global_position.y > cheats.global_position.y, "the tools stand in one column")
		_check(cheats.size.x > view.x - 60.0, "a tool card is the menu's full width")
	for key: String in ["game", "settings", "help"]:
		menu.call("_show_tab", key)
		await _wait(0.5)
		await _shoot("ps-game-menu-" + key)
	_check(not _visible_text(card, "Check for updates"), "the phone's Help has no update check")
	menu.call("_show_tab", "settings")
	await _wait(0.4)
	var general := (menu.get("_marks") as Dictionary).get("General") as Control
	var sound := (menu.get("_marks") as Dictionary).get("Sound") as Control
	if general and sound:
		_check(sound.global_position.y > general.global_position.y + 20.0 and absf(sound.global_position.x - general.global_position.x) < 1.0, "the settings categories stand in one column")
	menu.call("_open_workspace", "general", "game", Rect2(card.position, card.size))
	await _wait(1.4)
	workspace = menu.get("_workspace")
	_settings_facts(workspace, view, "game")
	for key: String in SECTIONS:
		workspace.call("set_section", key)
		await _wait(1.6 if key in ["ai", "advanced"] else 1.0)
		await _pages("ps-settings-" + key, workspace)
	workspace.call("set_section", "general")
	await _wait(1.0)
	_check(not _visible_text(workspace, "Display mode"), "the phone's General has no display mode")
	_check(not _visible_text(workspace, "Show the vault door every time"), "the phone's General has no vault door window switch")
	_check(not _visible_text(workspace, "Show what I am playing on Discord"), "the phone's General has no Discord switch")
	await _back()
	await _wait(0.8)
	_check(not workspace.visible and card.visible, "Back steps out of Settings to the game menu")
	await _back()
	await _wait(0.6)
	_check(not bool(menu.call("is_open")), "Back again closes the game menu")
	_finish(0 if failures.is_empty() else 1)


func _settings_facts(workspace: Control, view: Vector2, scope: String) -> void:
	var card: Control = workspace.get("_card")
	var rect := Rect2(card.position, card.size)
	_check(absf(rect.size.x - (view.x - 14.4)) < 1.5 and absf(rect.size.y - (view.y - 14.4)) < 1.5, "%s settings fill the screen less 0.45 rem each side (%s)" % [scope, str(rect.size)])
	var nav: Control = workspace.get("_nav")
	var first := nav.get_child(0) as Control
	var last := nav.get_child(nav.get_child_count() - 1) as Control
	_check(absf(first.global_position.y - last.global_position.y) < 1.0 and last.global_position.x > first.global_position.x + 200.0, "%s settings sections are one row of tabs" % scope)
	_check(first.size.y >= 43.5, "%s settings tabs are touch targets" % scope)
	var scroll: ScrollContainer = workspace.get("_scroll")
	_check(scroll.global_position.y > first.global_position.y + first.size.y and scroll.size.x > view.x - 40.0, "%s settings cards run the full width under the tabs" % scope)


func _pages(name: String, workspace: Control) -> void:
	var scroll: ScrollContainer = workspace.get("_scroll")
	scroll.scroll_vertical = 0
	await _wait(0.3)
	await _shoot(name)
	var card: Control = workspace.get("_card")
	var view := root.get_visible_rect().size
	var fits := card.size.x <= view.x - 14.0 and card.get_combined_minimum_size().x <= view.x - 14.0
	_check(fits, "%s fits the screen's width (%.0f)" % [name, card.get_combined_minimum_size().x])
	if not fits:
		_say("too wide: " + _widest(card, 120.0))
	var page := scroll.size.y
	var height := scroll.get_v_scroll_bar().max_value
	for index in [2, 3]:
		var top := int(round((index - 1) * page * 0.85))
		if top >= height - 10.0:
			break
		scroll.scroll_vertical = top
		await _wait(0.4)
		await _shoot("%s-p%d" % [name, index])
	scroll.scroll_vertical = 0


func _widest(node: Node, limit: float) -> String:
	var best: Control = null
	for child in node.get_children():
		if child is Control and (child as Control).visible and (child as Control).get_combined_minimum_size().x > limit:
			if best == null or (child as Control).get_combined_minimum_size().x > best.get_combined_minimum_size().x:
				best = child
	var text := ""
	if node is Label or node is Button:
		text = str(node.get("text")).left(60)
	var here := "%s %.0f \"%s\"" % [node.get_class(), (node as Control).get_combined_minimum_size().x if node is Control else 0.0, text]
	if best:
		return here + " > " + _widest(best, limit)
	return here


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

