extends SceneTree

var main: Node
var shots := ""
var started := 0
var failures: PackedStringArray = []
var finished := false


func _initialize() -> void:
	var redraw := Node2D.new()
	root.add_child(redraw)
	process_frame.connect(redraw.queue_redraw)
	shots = OS.get_environment("OH_SHOTS")
	started = Time.get_ticks_msec()
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.mouse_passthrough = true
	root.add_child(main)
	_watchdog.call_deferred()
	_run.call_deferred()


func _watchdog() -> void:
	await create_timer(1500.0).timeout
	if not finished:
		_say("FAIL the check did not finish in time")
		_finish(1)


func _say(text: String) -> void:
	print("[look %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _check(ok: bool, what: String, detail := "") -> void:
	if ok:
		_say("ok   " + what)
	else:
		_say("FAIL " + what + ("" if detail.is_empty() else "  (" + detail + ")"))
		failures.append(what)


func _frames(count: int) -> void:
	for i in range(count):
		await process_frame


func _wait(seconds: float) -> void:
	await create_timer(seconds).timeout


func _until(condition: Callable, seconds: float) -> bool:
	var deadline := Time.get_ticks_msec() + int(seconds * 1000.0)
	while Time.get_ticks_msec() < deadline:
		if condition.call():
			return true
		await process_frame
	return condition.call()


func _shoot(name: String) -> void:
	await _frames(4)
	await RenderingServer.frame_post_draw
	if shots.is_empty():
		return
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(name + "-1x.png"))
	var before := root.size
	root.size = before * 2
	root.content_scale_factor = 2.0
	await _frames(10)
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(name + "-2x.png"))
	root.size = before
	root.content_scale_factor = 1.0
	await _frames(6)
	_say("screenshot " + name)


func _find_all(node: Node, test: Callable, into: Array) -> Array:
	if node == null or node.is_queued_for_deletion():
		return into
	if test.call(node):
		into.append(node)
	for child in node.get_children():
		_find_all(child, test, into)
	return into


func _labels(node: Node, wanted: String) -> Array:
	return _find_all(node, func(item: Node) -> bool: return item is Label and (item as Label).text == wanted and (item as Label).is_visible_in_tree(), [])


func _with_meta(node: Node, key: String) -> Array:
	return _find_all(node, func(item: Node) -> bool: return item is Control and item.has_meta(key) and (item as Control).is_visible_in_tree(), [])


func _theme_button(node: Node, id: String) -> Control:
	for item in _with_meta(node, "theme_id"):
		if str(item.get_meta("theme_id")) == id:
			return item as Control
	return null


func _bg(control: Control, style_name := "panel") -> Color:
	var style := control.get_theme_stylebox(style_name) as StyleBoxFlat
	return style.bg_color if style else Color(0, 0, 0, 0)


func _same(a: Color, b: Color) -> bool:
	return a.is_equal_approx(b)


func _clear_shell() -> void:
	var shell: ShellBoot = main.get("shell") as ShellBoot
	var built_by := Time.get_ticks_msec() + 30000
	while shell == null and Time.get_ticks_msec() < built_by:
		await process_frame
		shell = main.get("shell") as ShellBoot
	if shell == null:
		return
	var deadline := Time.get_ticks_msec() + 30000
	while shell.door_state == "deciding" and Time.get_ticks_msec() < deadline:
		await process_frame
	if shell.door != null and is_instance_valid(shell.door):
		shell.door.opened.emit()
	if not shell.notice_updates.is_empty():
		deadline = Time.get_ticks_msec() + 5000
		while not (shell.notice != null and is_instance_valid(shell.notice)) and Time.get_ticks_msec() < deadline:
			await process_frame
		if shell.notice != null and is_instance_valid(shell.notice):
			shell.notice.closed.emit()
	await _frames(10)


func _cover_gone() -> void:
	var shell: Variant = main.get("shell")
	if shell == null or shell.get("loading") == null:
		return
	var deadline := Time.get_ticks_msec() + 90000
	while (shell.loading as GameLoadingScreen).is_open() and Time.get_ticks_msec() < deadline:
		await process_frame
	await _wait(0.5)


func _run() -> void:
	while not main.menu.visible:
		if Time.get_ticks_msec() - started > 90000:
			_say("FAIL the menu never appeared")
			_finish(1)
			return
		await process_frame
	await _clear_shell()
	await _theme_runtime()
	await _settings_part()
	await _setup_part()
	await _release_part()
	await _game_part()
	UiTheme.reset()
	await _wait(0.5)
	_finish(0 if failures.is_empty() else 1)


func _theme_runtime() -> void:
	_check(UiTheme.preset == UiTheme.DEFAULT and not UiTheme.themed(), "a fresh device keeps the original interface")
	_check(UiTheme.pick("bg", Color("#abcdef")) == Color("#abcdef"), "Default (Original) leaves every panel its own colours")
	_check(UiTheme.PRESETS.size() == 5 and str(UiTheme.PRESETS[0]["name"]) == "Midnight Navy", "five presets, Midnight Navy first")
	for item in UiTheme.PRESETS:
		_check(UiTheme.validate(item["colors"]).is_empty(), "%s passes the contrast rules" % item["name"])
	_check(UiTheme.validate({"background": "#FFFFFF", "surface": "#20364A", "accent": "#85CBE6"}) == "Background and surface are too bright for readable text.", "a bright background is refused")
	_check(UiTheme.validate({"background": "#111D2A", "surface": "#20364A", "accent": "#21364A"}) == "Accent needs more contrast against both backgrounds.", "a dull accent is refused")
	_check(UiTheme.normalize({"preset": "<script>", "custom": {"background": "red"}})["preset"] == UiTheme.DEFAULT, "an unknown preset reads as Default")
	_check(UiTheme.mix("#20364A", "#85CBE6", 0.19) == "#335268", "the active tone mixes as beta's", UiTheme.mix("#20364A", "#85CBE6", 0.19))
	_check(_same(main.menu.get("_page_bg").color, UI.PAGE), "the menu page in its own grey")
	await _shoot("look-menu-default")
	UiTheme.select("forest")
	await _frames(4)
	_check(_same(main.menu.get("_page_bg").color, Color("#121E19")), "Forest recolours the main menu at once")
	await _shoot("look-menu-forest")
	await _wait(0.5)
	var stored: Dictionary = await main.engine.request("look.theme.get")
	var result: Variant = stored.get("result")
	var kept: Variant = (result as Dictionary).get("theme") if typeof(result) == TYPE_DICTIONARY else null
	_check(typeof(kept) == TYPE_DICTIONARY and str((kept as Dictionary).get("preset", "")) == "forest", "the choice is kept on the device", str(stored))
	UiTheme.reset()
	await _frames(4)
	_check(_same(main.menu.get("_page_bg").color, UI.PAGE), "Reset to default brings the original back")


func _settings_part() -> void:
	main.game_menu.call("open_app_settings", "general")
	await _until(func() -> bool:
		var opened: Variant = main.game_menu.get("_workspace")
		return opened != null and not _labels(opened, "Interface appearance").is_empty(), 15.0)
	var workspace: Variant = main.game_menu.get("_workspace")
	_check(workspace != null and not _labels(workspace, "Interface appearance").is_empty(), "General has an Interface appearance section")
	if workspace == null:
		main.game_menu.call("close")
		return
	var picker: Array = _find_all(workspace, func(item: Node) -> bool: return item is ThemeSettings, [])
	_check(picker.size() == 1, "the theme picker is in it")
	if picker.is_empty():
		return
	var settings: ThemeSettings = picker[0]
	var ids: Array = []
	for item in _with_meta(settings, "theme_id"):
		ids.append(str(item.get_meta("theme_id")))
	_check(ids == ["default", "midnight", "graphite", "forest", "oxblood", "sepia", "custom"], "Default (Original), the five presets and Custom preset, in beta's order", str(ids))
	_check(not _labels(settings, "Default (Original)").is_empty() and not _labels(settings, "Custom preset").is_empty() and not _labels(settings, "Live preview").is_empty(), "the cards and the live preview are named as beta's")
	var reset := _find_all(settings, func(item: Node) -> bool: return item is Button and (item as Button).text == "Reset to default", [])
	_check(not reset.is_empty() and (reset[0] as Button).disabled, "Reset to default waits until something changed")
	var page := (workspace as Control).get("_content") as Control
	await _scroll_into_view(workspace, settings)
	await _shoot("look-settings-appearance")
	_theme_button(settings, "midnight").emit_signal("pressed")
	await _frames(6)
	_check(UiTheme.preset == "midnight", "a preset card applies its palette")
	var card: PanelContainer = (workspace as Control).get("_card")
	_check(_same(_bg(card), Color("#111D2A")), "Settings itself takes the palette")
	_check(page != null, "the settings page is there")
	settings = _find_all(workspace, func(item: Node) -> bool: return item is ThemeSettings, [])[0]
	_check(bool(_theme_button(settings, "midnight").get_meta("pressed")), "the chosen card is marked")
	await _scroll_into_view(workspace, settings)
	await _shoot("look-settings-appearance-midnight")
	_theme_button(settings, "custom").emit_signal("pressed")
	await _frames(6)
	settings = _find_all(workspace, func(item: Node) -> bool: return item is ThemeSettings, [])[0]
	_check(not _labels(settings, "Custom colors").is_empty() and _find_all(settings, func(item: Node) -> bool: return item is ColorPickerButton, []).size() == 3, "Custom preset opens three colour fields")
	settings.call("_update", "background", "#FFFFFF")
	await _frames(4)
	settings = _find_all(workspace, func(item: Node) -> bool: return item is ThemeSettings, [])[0]
	_check(not _labels(settings, "Background and surface are too bright for readable text.").is_empty() and UiTheme.custom["background"] == "#111D2A", "an unreadable colour is explained and not applied")
	settings.call("_update", "background", "#0B1A12")
	await _frames(4)
	_check(UiTheme.preset == "custom" and UiTheme.custom["background"] == "#0B1A12", "a readable colour applies at once")
	await _scroll_into_view(workspace, _find_all(workspace, func(item: Node) -> bool: return item is ThemeSettings, [])[0])
	await _shoot("look-settings-appearance-custom")
	UiTheme.reset()
	await _frames(4)
	main.game_menu.call("close")
	await _until(func() -> bool: return not (workspace as Control).is_visible_in_tree(), 5.0)
	_check(not (workspace as Control).is_visible_in_tree(), "Settings closes")
	await _wait(0.4)


func _scroll_into_view(workspace: Variant, control: Control) -> void:
	var scroll := (workspace as Control).get("_scroll") as ScrollContainer
	if scroll == null or control == null:
		return
	await _frames(3)
	scroll.scroll_vertical = maxi(0, int(control.global_position.y - scroll.global_position.y + scroll.scroll_vertical - 120))
	await _frames(3)


func _setup_part() -> void:
	var shell: ShellBoot = main.shell
	var setup: FirstSetup = shell.show_first_setup()
	await _until(func() -> bool: return not _with_meta(setup, "language").is_empty(), 10.0)
	_check(not _labels(setup, "Choose your language").is_empty(), "the setup asks for the language first")
	_check(_with_meta(setup, "language").size() >= 1, "it lists the languages", str(_with_meta(setup, "language").size()))
	_check(not _labels(setup, "Hello").is_empty() and not _labels(setup, "Welcome").is_empty(), "Hello and Welcome open it")
	await _wait(0.5)
	await _shoot("look-setup-language")
	await _wait(GREETING_WAIT)
	_check(_labels(setup, "Hello").is_empty(), "the greeting turns to another language")
	setup.call("_choose", "en")
	await _until(func() -> bool: return not _labels(setup, "Choose your theme").is_empty(), 10.0)
	_check(not _labels(setup, "Choose your theme").is_empty(), "then the theme")
	var ids: Array = []
	for item in _with_meta(setup, "theme_id"):
		ids.append(str(item.get_meta("theme_id")))
	_check(ids == ["default", "midnight", "graphite", "forest", "oxblood", "sepia"], "the six themes, Default (Original) first", str(ids))
	_check(_find_all(setup, func(item: Node) -> bool: return item is Button and (item as Button).text in ["Back", "Continue"], []).size() == 2, "Back and Continue")
	await _wait(0.6)
	await _shoot("look-setup-theme")
	_theme_button(setup, "graphite").emit_signal("pressed")
	await _wait(0.6)
	_check(UiTheme.preset == "graphite" and _same(setup.get("_backdrop").color, Color("#15171B")), "a theme is applied as it is picked, the setup in its colours")
	await _shoot("look-setup-theme-graphite")
	var go: Array = _find_all(setup, func(item: Node) -> bool: return item is Button and (item as Button).text == "Continue", [])
	(go[0] as Button).pressed.emit()
	await _until(func() -> bool: return shell.first_setup == null, 5.0)
	_check(shell.first_setup == null, "Continue gives onto the door")
	UiTheme.reset()
	await _frames(4)


const GREETING_WAIT := 2.4


func _release_part() -> void:
	var page := ReleaseNotice.new()
	main.shell.overlay.add_child(page)
	var shut := [false]
	page.closed.connect(func() -> void: shut[0] = true)
	await page.open(main.engine, "", true)
	await _frames(6)
	_check(not page.release.is_empty() and str(page.release.get("version", "")) == "2.5.0", "the release page reads 2.5.0's announcement")
	var chapters: Array = page.release.get("chapters", [])
	_check(chapters.size() == 7, "seven chapters", str(chapters.size()))
	var listed := 0
	for chapter in chapters:
		listed += ((chapter as Dictionary).get("entries", []) as Array).size()
	_check(listed > 20, "every chapter lists the updates under it", str(listed))
	_check(not _labels(page, "Skip").is_empty() or not _labels(page, "SKIP").is_empty() or not _find_all(page, func(item: Node) -> bool: return item is Button and (item as Button).text.to_upper() == "SKIP", []).is_empty(), "a way out at the top")
	await _shoot("look-release-hero")
	var scroll: ScrollContainer = page.get("_scroll")
	var sections: Array = page.get("_chapters")
	scroll.scroll_vertical = int(page.get("_vh") * 2.1)
	await _frames(6)
	await _shoot("look-release-intro")
	if not sections.is_empty():
		scroll.scroll_vertical = int((sections[0] as Control).position.y)
		await _frames(6)
		await _shoot("look-release-chapter-1")
		scroll.scroll_vertical = int((sections[0] as Control).position.y + page.get("_vh") * 1.0)
		await _frames(6)
		await _shoot("look-release-chapter-1-card")
		scroll.scroll_vertical = int((sections[0] as Control).position.y + (sections[0] as Control).size.y)
		await _frames(6)
		await _shoot("look-release-ledger-1")
	scroll.scroll_vertical = int((page.get("_page") as Control).size.y)
	await _frames(6)
	await _shoot("look-release-finale")
	page.close()
	_check(shut[0], "the button closes it")
	page.queue_free()
	await _frames(4)


func _close_notices() -> void:
	var shell: ShellBoot = main.get("shell") as ShellBoot
	if shell and shell.notice != null and is_instance_valid(shell.notice):
		shell.notice.closed.emit()
	for page in _find_all(root, func(item: Node) -> bool: return item is ReleaseNotice or item is UpdateNotice, []):
		(page as Node).queue_free()
	await _frames(6)


func _game_part() -> void:
	_say("game: starting the scenario")
	await main._start_scenario("default")
	await _wait(0.4)
	_say("game: choosing France")
	main.picker._choose("France")
	await _wait(0.2)
	await main._on_country_chosen("France", "medium")
	_say("game: country chosen")
	var entered := await _until(func() -> bool: return main.hud.drawers.has("country") and main.hud.map_cards != null, 120.0)
	_check(entered, "a game opens to theme its panels")
	if not entered:
		return
	await _cover_gone()
	await _close_notices()
	UiTheme.select("midnight")
	var panel = main.hud.drawers["country"]
	await main.hud.show_country("France")
	await _until(func() -> bool: return panel.target == "France" and not panel.data.is_empty(), 20.0)
	await _wait(1.0)
	var page_style := (panel.scroll as ScrollContainer).get_theme_stylebox("panel") as StyleBoxFlat
	_check(page_style != null and _same(page_style.bg_color, Color("#111D2A")), "the Country dossier takes the palette")
	await _shoot("look-country-midnight")
	UiTheme.select("oxblood")
	await _wait(0.6)
	page_style = (panel.scroll as ScrollContainer).get_theme_stylebox("panel") as StyleBoxFlat
	_check(page_style != null and _same(page_style.bg_color, Color("#21171B")), "an open dossier follows a new palette")
	await _shoot("look-country-oxblood")
	main.hud.close_drawer()
	await _wait(0.6)
	UiTheme.select("forest")
	var advisor: AdvisorPanel = main.hud.drawers["advisor"]
	main.hud.open_drawer_named("advisor")
	await _until(func() -> bool: return advisor._has_bootstrapped, 30.0)
	await _wait(1.0)
	_check(advisor._input.placeholder_text.is_empty(), "the Advisor's box has no placeholder")
	var tray := advisor.get("_tray") as PanelContainer
	_check(tray != null and _same(_bg(tray), Color(UiTheme.mix("#121E19", "#000000", 0.32))), "the Advisor's composer takes the palette's header tone")
	await _shoot("look-advisor-forest")
	main.hud.close_drawer()
	await _wait(0.6)
	main.game_menu.call("toggle")
	await _until(func() -> bool: return bool(main.game_menu.call("is_open")), 8.0)
	await _wait(1.0)
	main.game_menu.call("_show_tab", "settings")
	await _wait(0.5)
	var colours: Array = []
	for title in ["General", "Sound", "Map", "AI", "Advanced"]:
		for label in _labels(main.game_menu, title):
			var node: Node = label
			while node != null and node.get("_normal") == null:
				node = node.get_parent()
			if node != null:
				var style := node.get("_normal") as StyleBoxFlat
				colours.append(style.bg_color if style else Color(0, 0, 0, 0))
				break
	_check(colours.size() == 5 and colours.count(colours[0]) == 5, "Settings' General, Sound and Map cards look like the others", str(colours.size()))
	await _shoot("look-game-menu-settings")
	main.game_menu.call("close")
	await _wait(0.4)
	await _themed_panels()
	await _themes_notice()


func _themed_panels() -> void:
	await _close_notices()
	for preset in ["forest", "midnight"]:
		UiTheme.select(preset)
		await _wait(0.4)
		for name in ["chat", "actions", "history"]:
			main.hud.set_active_panel(name)
			await _wait(1.2)
			await _shoot("look-%s-%s" % [preset, name])
		main.hud.set_active_panel("")
		await _wait(0.5)
		if main.cheats:
			main.cheats.call("open")
			await _wait(1.0)
			await _shoot("look-%s-cheats" % preset)
			main.cheats.call("close")
			await _wait(0.5)
		if main.debug_console:
			main.debug_console.call("open")
			await _wait(1.0)
			await _shoot("look-%s-debug-console" % preset)
			main.debug_console.call("close")
			await _wait(0.5)
	var chat_panel: Variant = main.hud.get("panels").get("chat")
	_check(chat_panel != null, "the Diplomacy panel is there to theme")
	UiTheme.reset()
	await _wait(0.4)


func _themes_notice() -> void:
	var reply: Dictionary = await main.engine.request("shell.updates")
	var updates: Array = (reply.get("result", {}) as Dictionary).get("updates", []) if reply.get("ok", false) else []
	var found := {}
	for item in updates:
		if str((item as Dictionary).get("id", "")) == "2026-11-themes":
			found = item
	_check(not found.is_empty(), "the themes notice is on native")
	if found.is_empty():
		return
	for preset in ["default", "forest"]:
		UiTheme.select(preset)
		var notice := UpdateNotice.new()
		main.shell.overlay.add_child(notice)
		await notice.setup(main.engine, [found], {"reduceMotion": true})
		await _wait(1.2)
		await _shoot("look-themes-notice-%s-1" % preset)
		notice.call("show_page", 1)
		await _wait(1.2)
		await _shoot("look-themes-notice-%s-2" % preset)
		notice.queue_free()
		await _wait(0.4)
	UiTheme.reset()


func _finish(code: int) -> void:
	if finished:
		return
	finished = true
	_say("done: %d failure(s) %s" % [failures.size(), ", ".join(failures)])
	quit(code)
