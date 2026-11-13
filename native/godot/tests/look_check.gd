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
	await _door_gone()
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
	await _door_gone()
	_check(shell.door == null and shell.door_state == "open", "the vault door is open before the shots", shell.door_state)
	if not shell.notice_updates.is_empty():
		var deadline := Time.get_ticks_msec() + 5000
		while not (shell.notice != null and is_instance_valid(shell.notice)) and Time.get_ticks_msec() < deadline:
			await process_frame
		if shell.notice != null and is_instance_valid(shell.notice):
			shell.notice.closed.emit()
	await _frames(10)


func _door_gone() -> void:
	if not is_instance_valid(main):
		return
	var shell := main.get("shell") as ShellBoot
	if shell == null:
		return
	if shell.door_state == "deciding":
		await _until(func() -> bool: return shell.door_state != "deciding", 600.0)
	if shell.door != null and is_instance_valid(shell.door):
		_say("the vault door is shut (%s); opening it" % shell.door_state)
		shell.door.opened.emit()
		await _until(func() -> bool: return shell.door == null, 10.0)
		await _frames(2)


func _cover_gone() -> void:
	var shell: Variant = main.get("shell")
	if shell == null or shell.get("loading") == null:
		return
	var deadline := Time.get_ticks_msec() + 90000
	while (shell.loading as GameLoadingScreen).is_open() and Time.get_ticks_msec() < deadline:
		await process_frame
	await _wait(0.5)


func _run() -> void:
	await process_frame
	while not main.menu.visible:
		if Time.get_ticks_msec() - started > 90000:
			_say("FAIL the menu never appeared")
			_finish(1)
			return
		await process_frame
	await _clear_shell()
	await _theme_runtime()
	await _settings_part()
	await _library_part()
	await _setup_part()
	await _release_part()
	await _history_part()
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
	var primaries: Array = _find_all(workspace, func(item: Node) -> bool: return item is Button and item.has_meta("settings_primary"), [])
	var primary_style := (primaries[0] as Button).get_theme_stylebox("normal") as StyleBoxFlat if not primaries.is_empty() else null
	_check(primary_style == null or (_same(primary_style.bg_color, UiTheme.pick("active", Color())) and _same(primary_style.border_color, UiTheme.pick("accent", Color()))), "Settings' primary actions follow the palette, not blue", str(primaries.size()))
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


func _library_part() -> void:
	var menu: Variant = main.menu
	for preset in ["default", "forest"]:
		UiTheme.select(preset)
		await _frames(4)
		menu.call("_show_page", "scenarios")
		await _wait(1.0)
		var rail := (menu.get("_rail_panel") as Control).get_theme_stylebox("panel") as StyleBoxFlat
		_check(rail != null and rail.border_width_right == 1 and (_same(rail.border_color, UiTheme.pick("line", Color(1, 1, 1, 0.08))) or _same(_border_of(rail), UiTheme.pick("line", Color(1, 1, 1, 0.08))) or _same(rail.border_color, UiTheme.pick("header", UI.RAIL).blend(Color(1, 1, 1, 0.08)))), "the menu rail has its edge in %s" % preset, "%s %s" % [str(rail.border_width_right if rail else -1), str(rail.border_color if rail else Color())])
		var edit: Array = _find_all(menu, func(item: Node) -> bool: return item is Button and (item as Button).is_visible_in_tree() and not _labels(item, "Edit").is_empty(), [])
		var edit_style := (edit[0] as Button).get_theme_stylebox("normal") as StyleBoxFlat if not edit.is_empty() else null
		_check(edit_style != null and _same(edit_style.bg_color, UiTheme.pick("overlay_card", Color(1, 1, 1, 0.06))) and _same(edit_style.border_color, UiTheme.pick("line", Color(1, 1, 1, 0.12))), "a scenario card's Edit takes the palette's card and line in %s" % preset)
		var tile: Button = (menu.get("_tiles") as Dictionary)["games"]
		var tile_hover := tile.get_theme_stylebox("hover") as StyleBoxFlat
		var rim := Color(UiTheme.pick("accent", Color(1, 1, 1)), 0.38) if preset != "default" else Color(1, 1, 1, 0.12)
		_check(tile_hover != null and _same(tile_hover.border_color, rim), "a rail tile's hover rim in %s" % preset, str(tile_hover.border_color if tile_hover else Color()))
		await _shoot("look-%s-library-scenarios" % preset)
		menu.call("_show_page", "community")
		await _wait(2.0)
		await _shoot("look-%s-library-community" % preset)
		menu.call("_show_page", "lobbies")
		await _wait(1.0)
		var fields: Array = _find_all(menu, func(item: Node) -> bool: return item is LineEdit and (item as LineEdit).is_visible_in_tree(), [])
		var field_style := (fields[0] as LineEdit).get_theme_stylebox("normal") as StyleBoxFlat if not fields.is_empty() else null
		_check(field_style != null and _same(field_style.bg_color, UiTheme.pick("overlay_card", Color(1, 1, 1, 0.04))) and _same(field_style.border_color, UiTheme.pick("line", Color(1, 1, 1, 0.1))), "a lobby field takes the palette in %s" % preset)
		await _shoot("look-%s-library-lobbies" % preset)
	menu.call("_show_page", "games")
	UiTheme.reset()
	await _frames(4)


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
	await _czech_card(setup)
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


const GREETING_WAIT := 5.4


class HeldLink extends EngineLink:
	signal let_go(result: Dictionary)

	var real: EngineLink
	var holding := false

	func request(method: String, args: Dictionary = {}) -> Dictionary:
		if method == "translation.prepare":
			holding = true
			var result: Dictionary = await let_go
			holding = false
			return {"ok": true, "result": result}
		return await real.request(method, args)


func _czech_card(setup: FirstSetup) -> void:
	var words := I18n.current
	_check(words != null, "the language switch is there")
	if words == null:
		return
	var kept := words.engine
	var held := HeldLink.new()
	held.real = kept
	words.engine = held
	setup.call("_choose", "cs")
	await _until(words.card_shown, 20.0)
	_check(words.card_shown(), "Czech asks for its translation model first")
	_check(words.card_text() == "Playing in Čeština needs a one-time download of its translation model (117 MB).", "the card names the language and the size as beta's", words.card_text())
	_check(str(setup.get("_busy")) == "cs", "the Czech card stays chosen while it asks")
	await _wait(0.6)
	await _shoot("look-setup-czech-ask")
	words.answer_card("download")
	await _until(func() -> bool: return held.holding and words.card_text().begins_with("Downloading"), 20.0)
	_check(words.card_text() == "Downloading the translation model… 0%", "a download shows its progress", words.card_text())
	await _wait(0.6)
	await _shoot("look-setup-czech-downloading")
	held.let_go.emit({"ok": false, "error": "stand-in"})
	await _until(func() -> bool: return words.card_text() == "The translation model could not be downloaded.", 20.0)
	_check(words.card_text() == "The translation model could not be downloaded.", "a failed download says so and offers to try again", words.card_text())
	await _wait(0.6)
	await _shoot("look-setup-czech-failed")
	words.answer_card("decline")
	await _until(func() -> bool: return not words.card_shown() and str(setup.get("_busy")).is_empty(), 20.0)
	_check(not words.card_shown() and I18n.code() == "en", "Keep English keeps the game in English", I18n.code())
	_check(not _labels(setup, "Choose your language").is_empty(), "and the setup stays on the language")
	await _wait(0.6)
	await _shoot("look-setup-czech-kept-english")
	words.engine = kept
	held.free()


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
	await _settled(page)
	var views: Array = page.scenes_in_view()
	_check(views.size() == 1 and is_zero_approx((views[0] as ReleaseScene).progress), "with Reduce motion the panorama stands at its start")
	await _shoot("look-release-still-hero")
	var scroll: ScrollContainer = page.get("_scroll")
	var sections: Array = page.get("_chapters")
	scroll.scroll_vertical = int((sections[0] as Control).position.y + page.get("_vh") * 0.5)
	await _settled(page)
	views = page.scenes_in_view()
	_check(not views.is_empty() and is_equal_approx((views[0] as ReleaseScene).progress, 1.0), "with Reduce motion each chapter's picture stands finished")
	await _shoot("look-release-still-chapter-1")
	page.close()
	_check(shut[0], "the button closes it")
	page.queue_free()
	await _frames(4)
	page = ReleaseNotice.new()
	main.shell.overlay.add_child(page)
	await page.open(main.engine, "", false)
	await _wait(0.8)
	await _settled(page)
	var grain := page.get("_grain") as ColorRect
	_check(grain != null and grain.material is ShaderMaterial, "a film grain lies over the page")
	await _shoot("look-release-p-hero")
	scroll = page.get("_scroll")
	sections = page.get("_chapters")
	var vh: float = page.get("_vh")
	var copy := page.get("_hero_copy") as Control
	scroll.scroll_vertical = int(vh * 0.5)
	await _settled(page)
	_check(copy.modulate.a < 0.7 and copy.position.y < vh * 0.24 - 20.0 and copy.scale.x > 1.0, "the title lifts, grows and fades as the panorama scrolls", "%s %s" % [copy.modulate.a, copy.position.y])
	scroll.scroll_vertical = int(vh)
	await _settled(page)
	await _shoot("look-release-p-hero-2")
	scroll.scroll_vertical = int(vh * 2.1)
	await _frames(3)
	var rising := _find_all(page, func(item: Node) -> bool: return item is Container and item.get("rise") != null and float(item.get("rise")) > 0.5 and float(item.get("rise")) < 41.5, [])
	await _wait(0.12)
	rising = _find_all(page, func(item: Node) -> bool: return item is Container and item.get("rise") != null and float(item.get("rise")) > 0.5 and float(item.get("rise")) < 41.5, []) if rising.is_empty() else rising
	_check(not rising.is_empty(), "words rise as they fade in")
	await _wait(1.0)
	await _settled(page)
	await _shoot("look-release-p-intro")
	for index in range(sections.size()):
		var section: Control = sections[index]
		var highlights: Array = (chapters[index] as Dictionary).get("highlights", [])
		var tops: Array = [0.0, vh * 0.5 + vh * 0.95 * 0.5]
		if highlights.size() > 1:
			tops.append(vh * 0.5 + vh * 0.95 * (highlights.size() - 0.5))
		var seen: Array = []
		for at in range(tops.size()):
			scroll.scroll_vertical = int(section.position.y + float(tops[at]))
			await _wait(0.9)
			await _settled(page)
			var in_view: Array = page.scenes_in_view()
			var view: ReleaseScene = in_view[0] if not in_view.is_empty() else null
			seen.append(view.progress if view else -1.0)
			await _shoot("look-release-p-ch%d-%d" % [index + 1, at])
		var scene := str((chapters[index] as Dictionary).get("scene", ""))
		_check(seen.size() >= 2 and float(seen[0]) < 0.05 and float(seen[seen.size() - 1]) > float(seen[0]) + 0.3, "chapter %d's picture plays out with the scroll (%s)" % [index + 1, scene], str(seen))
		if scene == "map":
			var map_view: ReleaseScene = page.scenes_in_view()[0]
			var plane := map_view.get("_plane") as ColorRect
			_check(plane != null and plane.visible and (plane.material as ShaderMaterial).get_shader_parameter("lift") > 0.0, "the map tilts back as the page scrolls")
		if scene == "yours":
			var yours: ReleaseScene = page.scenes_in_view()[0]
			_check((yours.get("_greetings") as PackedStringArray).size() == 12, "greetings drift across chapter six")
		if index == 0:
			scroll.scroll_vertical = int(section.position.y + section.size.y)
			await _wait(1.0)
			await _shoot("look-release-p-ledger-1")
	scroll.scroll_vertical = int((page.get("_page") as Control).size.y)
	await _wait(0.9)
	await _settled(page)
	await _shoot("look-release-p-finale")
	page.close()
	page.queue_free()
	await _frames(4)


func _settled(page: ReleaseNotice) -> void:
	await _until(page.is_settled, 30.0)
	await _frames(3)


func _history_part() -> void:
	var shell: ShellBoot = main.shell
	shell.open_history()
	var texts := func() -> PackedStringArray:
		var found := PackedStringArray()
		if shell.history == null:
			return found
		for item in _find_all(shell.history, func(node: Node) -> bool: return node is Label or node is RichTextLabel, []):
			found.append((item as Label).text if item is Label else (item as RichTextLabel).get_parsed_text())
		return found
	await _until(func() -> bool: return Array(texts.call()).has("Open Historia 2.5 · Total war, a living world, and a game that is yours"), 30.0)
	var shown: PackedStringArray = texts.call()
	_check(Array(shown).has("Open Historia 2.5 · Total war, a living world, and a game that is yours"), "the history names the release by its title")
	_check(Array(shown).has("Version") and Array(shown).has(" 2.5.0"), "and by its version", ", ".join(shown.slice(0, 6)))
	await _wait(1.0)
	await _shoot("look-history-p1")
	var scroll: ScrollContainer = shell.history.get("_scroll")
	for page_at in [2, 3]:
		scroll.scroll_vertical += int(scroll.size.y)
		await _wait(0.6)
		await _shoot("look-history-p%d" % page_at)
	scroll.scroll_vertical = 0
	shell.history.view("2026-11-version-2-5")
	await _until(func() -> bool: return not _find_all(shell.history, func(node: Node) -> bool: return node is ReleaseNotice, []).is_empty(), 20.0)
	_check(not _find_all(shell.history, func(node: Node) -> bool: return node is ReleaseNotice, []).is_empty(), "View opens the release page")
	shell.close_history()
	await _frames(6)


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
	await _map_controls()
	await _scroll_hover()
	await _themes_notice()


func _themed_panels() -> void:
	await _close_notices()
	for preset in ["forest", "midnight"]:
		UiTheme.select(preset)
		await _wait(0.4)
		for name in ["chat", "actions", "history"]:
			main.hud.set_active_panel(name)
			await _wait(1.2)
			if name == "actions":
				var actions: Variant = main.hud.get("panels").get("actions")
				var chosen: Button = (actions.get("_tab_buttons") as Dictionary)[actions.get("_tab")]
				var tab_style := chosen.get_theme_stylebox("normal") as StyleBoxFlat
				_check(tab_style != null and _same(tab_style.bg_color, UiTheme.pick("active", Color())) and _same(tab_style.border_color, UiTheme.pick("accent", Color())), "the chosen Actions tab takes the palette in %s" % preset)
				var brainstorm: Button = actions.get("_brainstorm")
				var brainstorm_style := brainstorm.get_theme_stylebox("normal") as StyleBoxFlat
				_check(brainstorm_style != null and _same(brainstorm_style.bg_color, UiTheme.pick("overlay_card", Color())) and _same(brainstorm_style.border_color, UiTheme.pick("line", Color())), "Brainstorm takes the palette's card and line in %s" % preset)
				var composer: TextEdit = actions.get("_composer")
				composer.text = "Fund the rail network."
				composer.text_changed.emit()
				await _frames(2)
				var send_style := (actions.get("_submit_button") as Button).get_theme_stylebox("normal") as StyleBoxFlat
				_check(send_style != null and _same(send_style.bg_color, UiTheme.pick("active", Color())) and _same(send_style.border_color, UiTheme.pick("accent", Color())) and send_style.border_width_left == 1, "the send button is the palette's active tone with an accent ring in %s" % preset)
				await _shoot("look-%s-actions-typed" % preset)
				composer.text = ""
				composer.text_changed.emit()
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
		await _update_banner(preset)
	var chat_panel: Variant = main.hud.get("panels").get("chat")
	_check(chat_panel != null, "the Diplomacy panel is there to theme")
	UiTheme.reset()
	await _wait(0.4)


func _map_controls() -> void:
	await _close_notices()
	var hud: Hud = main.hud
	var dock: GlassPanel = hud.get("_dock")
	var toggle := (hud.get("_mode_buttons") as Dictionary)["diplomatic"].get_parent().get_parent() as GlassPanel
	var advisor_frame: GlassPanel = hud.get("_advisor_frame")
	var expected := {
		"default": {"dock": UI.HUD_BG, "edge": UI.HUD_BORDER, "pill": UI.HUD_BUTTON, "diplo": Color(37 / 255.0, 99 / 255.0, 235 / 255.0, 0.3), "diplo_ink": Color("#60a5fa"), "diplo_line": Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.4), "open": Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.16), "rest": Color(1, 1, 1, 0.04)},
	}
	for preset in ["forest", "oxblood"]:
		var palette: Dictionary = UiTheme.preset_named(preset)["colors"]
		var surface := Color(str(palette["surface"]))
		var accent := Color(str(palette["accent"]))
		expected[preset] = {
			"dock": Color(surface, 0.6), "edge": Color(Color(UiTheme.mix(str(palette["surface"]), "#FFFFFF", 0.55)), 0.2), "pill": Color(surface, 0.6),
			"diplo": Color(accent, 0.22), "diplo_ink": Color(UiTheme.mix(str(palette["accent"]), "#FFFFFF", 0.3)), "diplo_line": Color(accent, 0.45),
			"open": Color(accent, 0.22), "rest": Color(Color(UiTheme.mix(str(palette["surface"]), "#FFFFFF", 0.08)), 0.42),
		}
	for preset in ["default", "forest"]:
		UiTheme.select(preset)
		hud.open_drawer_named("advisor")
		await _wait(0.9)
		var line_open := UiTheme.pick("glass_active_line", UiTheme.pick("hud_border", UI.HUD_BORDER))
		_check(_same(advisor_frame.border, line_open), "the open Advisor button takes the active line in %s" % preset, str(advisor_frame.border))
		var advisor_button: Button = hud.get("_advisor_button")
		advisor_button.mouse_entered.emit()
		await _frames(2)
		var rims: Array = _find_all(advisor_frame, func(item: Node) -> bool: return item.has_meta("theme_rim"), [])
		_check(rims.size() == 1 and (rims[0] as Control).visible == (preset != "default"), "a HUD control is ringed in the accent on hover only with a palette (%s)" % preset)
		await _shoot("look-%s-advisor-open-hover" % preset)
		advisor_button.mouse_exited.emit()
		hud.close_drawer()
		await _wait(0.6)
		_check(_same(advisor_frame.border, UiTheme.pick("hud_border", UI.HUD_BORDER)), "the closed Advisor button keeps the HUD line in %s" % preset)
	for preset in ["default", "forest", "oxblood"]:
		UiTheme.select(preset)
		((hud.get("_mode_buttons") as Dictionary)["diplomatic"] as Button).pressed.emit()
		hud.set_active_panel("")
		await _wait(0.9)
		await _shoot("look-%s-map-controls" % preset)
		hud.set_active_panel("actions")
		await _wait(0.9)
		var want: Dictionary = expected[preset]
		var diplo: Button = (hud.get("_mode_buttons") as Dictionary)["diplomatic"]
		var political: Button = (hud.get("_mode_buttons") as Dictionary)["political"]
		var diplo_style := diplo.get_theme_stylebox("normal") as StyleBoxFlat
		var launchers: Dictionary = hud.get("_launchers")
		var open_style := (launchers["actions"] as Button).get_theme_stylebox("normal") as StyleBoxFlat
		var rest_style := (launchers["chat"] as Button).get_theme_stylebox("normal") as StyleBoxFlat
		_check(_same(dock.tint, want["dock"]) and _same(dock.border, want["edge"]) and _same(toggle.tint, want["dock"]), "the dock and the map-mode switch take the glass of %s" % preset, "%s %s" % [dock.tint, toggle.tint])
		_check(_same(advisor_frame.tint, want["pill"]) and _same(advisor_frame.border, want["edge"]), "the Advisor button takes the pill of %s" % preset, str(advisor_frame.tint))
		_check(diplo_style != null and _same(diplo_style.bg_color, want["diplo"]) and _same(diplo.get_theme_color("font_color"), want["diplo_ink"]) and _same(_border_of(diplo_style), want["diplo_line"]), "Diplomatic, chosen, is drawn as beta's in %s" % preset, "%s %s" % [diplo_style.bg_color if diplo_style else Color(), diplo.get_theme_color("font_color")])
		_check(_same(political.get_theme_color("font_color"), Color(1, 1, 1, 0.55)), "Political, not chosen, stays dimmed white in %s" % preset)
		_check(open_style != null and _same(open_style.bg_color, want["open"]) and rest_style != null and _same(rest_style.bg_color, want["rest"]), "the dock's open and resting buttons take %s" % preset, "%s %s" % [open_style.bg_color if open_style else Color(), rest_style.bg_color if rest_style else Color()])
		await _shoot("look-%s-map-controls-open" % preset)
		political.pressed.emit()
		await _wait(0.4)
		var political_style := political.get_theme_stylebox("normal") as StyleBoxFlat
		_check(political_style != null and _same(political_style.bg_color, Color(1, 1, 1, 0.14) if preset == "default" else Color(want["diplo"])), "Political, chosen, takes %s" % preset, str(political_style.bg_color if political_style else Color()))
		await _shoot("look-%s-map-controls-political" % preset)
		hud.set_active_panel("")
	UiTheme.reset()
	await _wait(0.4)


func _border_of(style: StyleBoxFlat) -> Color:
	if style.has_meta(StyleSettle.TINT_FROM):
		return style.get_meta(StyleSettle.TINT_FROM)
	return style.border_color


func _scroll_hover() -> void:
	var holder := ScrollContainer.new()
	holder.position = Vector2(40, 140)
	holder.size = Vector2(260, 220)
	var rows := VBoxContainer.new()
	rows.custom_minimum_size = Vector2(240, 0)
	for index in range(30):
		var row := Button.new()
		row.text = "Row %d" % index
		row.custom_minimum_size = Vector2(240, 30)
		rows.add_child(row)
	holder.add_child(rows)
	var layer := CanvasLayer.new()
	layer.layer = 120
	layer.add_child(holder)
	main.add_child(layer)
	await _frames(3)
	_check(holder.has_meta(ScrollHoverFreeze.HOOKED), "a list put on screen is watched for the wheel")
	var lists: Array = _find_all(main, func(node: Node) -> bool: return node is ScrollContainer, [])
	_check(lists.all(func(node: Node) -> bool: return node.has_meta(ScrollHoverFreeze.HOOKED)), "every list in the game is", "%d lists" % lists.size())
	var at := holder.global_position + Vector2(120, 100)
	var move := InputEventMouseMotion.new()
	move.position = at
	move.global_position = at
	root.get_viewport().push_input(move)
	await _frames(2)
	holder.scroll_vertical = 90
	await _frames(2)
	_check(not ScrollHoverFreeze.scrolling(holder) and rows.mouse_behavior_recursive == Control.MOUSE_BEHAVIOR_INHERITED, "a list that scrolls itself keeps taking the pointer")
	var wheel := InputEventMouseButton.new()
	wheel.button_index = MOUSE_BUTTON_WHEEL_DOWN
	wheel.pressed = true
	wheel.factor = 1.0
	wheel.position = at
	wheel.global_position = at
	root.get_viewport().push_input(wheel)
	var up := wheel.duplicate() as InputEventMouseButton
	up.pressed = false
	root.get_viewport().push_input(up)
	await _frames(2)
	_check(holder.scroll_vertical > 90, "the wheel scrolls the list", str(holder.scroll_vertical))
	_check(ScrollHoverFreeze.scrolling(holder) and rows.mouse_behavior_recursive == Control.MOUSE_BEHAVIOR_DISABLED, "while the wheel scrolls it, what is inside takes no hover")
	root.get_viewport().push_input(wheel)
	root.get_viewport().push_input(up)
	await _frames(2)
	_check(ScrollHoverFreeze.scrolling(holder) and rows.mouse_behavior_recursive == Control.MOUSE_BEHAVIOR_DISABLED, "the wheel still reaches the list while it is held")
	var hovered: Array = rows.get_children().filter(func(row: Button) -> bool: return row.is_hovered())
	_check(hovered.is_empty(), "no row lights up as it passes under the cursor", "%d hovered" % hovered.size())
	await _wait(0.1)
	_check(ScrollHoverFreeze.scrolling(holder), "it is held until the list has been still a moment")
	await _wait(0.12)
	_check(not ScrollHoverFreeze.scrolling(holder) and rows.mouse_behavior_recursive == Control.MOUSE_BEHAVIOR_INHERITED, "150 ms after the last turn of the wheel the rows take the pointer again")
	layer.queue_free()
	await _frames(2)


func _update_banner(preset: String) -> void:
	var updater: Variant = main.get("app_update")
	if updater == null:
		return
	var kept: Dictionary = updater.state
	updater.state = {"supported": true, "available": true, "canInstall": false, "latest": {"build": "20261105120000", "notes": ""}}
	updater.call("_refresh_banner")
	await _wait(0.6)
	var style := (updater.banner as Control).get_theme_stylebox("panel") as StyleBoxFlat
	_check(updater.banner.visible and style != null and _same(style.bg_color, UiTheme.pick("surface", Color(0, 0, 0, 0))), "the update banner takes the palette (%s)" % preset)
	await _shoot("look-%s-update-banner" % preset)
	updater.call("_show_cover", updater.LEDE_BUILD, true)
	updater._cover_bar.fraction = 0.42
	updater._cover_bar.queue_redraw()
	updater._cover_pct.text = "42%"
	await _wait(0.6)
	_check(_same(updater._cover_page.color, UiTheme.pick("surface", Color(0, 0, 0, 0))), "the update cover takes the palette (%s)" % preset)
	await _shoot("look-%s-update-cover" % preset)
	updater.cover.visible = false
	updater.state = kept
	updater.call("_refresh_banner")
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
