extends SceneTree

const GameMenuScript := preload("res://scripts/ui/game_menu.gd")
const CheatsScript := preload("res://scripts/ui/cheats_panel.gd")
const ConsoleScript := preload("res://scripts/ui/debug_console.gd")
const InteractiveScript := preload("res://scripts/ui/interactive_panel.gd")

var main: Node
var shots := ""
var started := 0
var failures: PackedStringArray = []
var signals_seen: PackedStringArray = []


func _initialize() -> void:
	shots = OS.get_environment("OH_SHOTS")
	started = Time.get_ticks_msec()
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.add_child(main)
	_run.call_deferred()


func _say(text: String) -> void:
	print("[menu %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _check(label: String, ok: bool, detail := "") -> void:
	_say("%s %s%s" % ["ok  " if ok else "FAIL", label, ("  (%s)" % detail) if not detail.is_empty() else ""])
	if not ok:
		failures.append(label)


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


func _texts(node: Node, into: PackedStringArray) -> void:
	if node is CanvasItem and not (node as CanvasItem).visible:
		return
	if node is Label:
		into.append((node as Label).text)
	elif node is Button and not (node as Button).text.is_empty():
		into.append("[%s]" % (node as Button).text)
	elif node is RichTextLabel:
		into.append((node as RichTextLabel).get_parsed_text())
	for child in node.get_children():
		_texts(child, into)


func _all_text(node: Node) -> String:
	var found := PackedStringArray()
	_texts(node, found)
	return " | ".join(found).replace("\n", " / ")


func _find_label(node: Node, text: String) -> Label:
	if node is Label and (node as Label).text == text:
		return node as Label
	for child in node.get_children():
		var found := _find_label(child, text)
		if found:
			return found
	return null


func _scroll_to(workspace: Variant, text: String) -> void:
	var label := _find_label(workspace._content, text)
	if not label:
		return
	var scroll: ScrollContainer = workspace._scroll
	scroll.scroll_vertical = int(label.global_position.y - scroll.global_position.y + scroll.scroll_vertical - 24.0)
	await _wait(0.3)


func _request(method: String, args := {}) -> Variant:
	var reply: Dictionary = await main.engine.request(method, args)
	if not reply.get("ok", false):
		_say("request %s failed: %s" % [method, str(reply.get("error", ""))])
		return null
	return reply.get("result")


func _run() -> void:
	while not main.menu.visible:
		if Time.get_ticks_msec() - started > 120000:
			_check("the main menu appears", false)
			_finish()
			return
		await process_frame
	_say("main menu ready")
	var exports := shots.path_join("exports") if not shots.is_empty() else ""
	if not exports.is_empty():
		DirAccess.make_dir_recursive_absolute(exports)
	var menu: GameMenuScript = GameMenuScript.new()
	main.ui.add_child(menu)
	menu.setup(main.engine, {"export_dir": exports, "reveal_saved_files": false})
	for name in ["closed", "open_library", "open_events", "open_cheats", "open_debug_console", "ai_setup_answered"]:
		var signal_name: String = name
		menu.connect(signal_name, func() -> void: signals_seen.append(signal_name))
	menu.setting_changed.connect(func(key: String, value: Variant) -> void: signals_seen.append("setting_changed:%s=%s" % [key, str(value)]))

	await menu.open_app_settings()
	await _wait(0.8)
	var app_text := _all_text(menu._workspace)
	_check("app settings say they are for every game", app_text.contains("For every game. A game's own settings are in its ☰ menu."))
	_check("app settings open on General", app_text.contains("Language") and app_text.contains("Display") and app_text.contains("Accessibility") and app_text.contains("Privacy"))
	await _shoot("m01-app-general")
	await menu._workspace.set_section("map")
	await _wait(0.5)
	app_text = _all_text(menu._workspace)
	_check("app Map shows the default basemap", app_text.contains("Use my default basemap") and app_text.contains("Default basemap") and app_text.contains("Show detailed maps"))
	await _shoot("m02-app-map")
	await menu._workspace.set_section("ai")
	await _wait(0.6)
	menu._workspace._scroll.scroll_vertical = 100000
	await _wait(0.3)
	app_text = _all_text(menu._workspace)
	_check("app AI says player focus is per game", app_text.contains("Player focus is set for each game on its own: open the game, then ☰ → Settings → AI."))
	await _shoot("m03-app-ai-bottom")
	menu._workspace.go_back()
	await _wait(0.5)
	_check("Back from app settings closes them", not menu.is_open() and not menu._workspace.visible)

	await main._start_scenario("default")
	main.picker._choose("France")
	await main._on_country_chosen("France", "medium")
	await _wait(1.5)
	_say("game open")

	await menu.open()
	await _wait(0.6)
	var tools_text := _all_text(menu._card)
	_check("quick menu header names the game", tools_text.contains("Playing as France"), tools_text.substr(0, 160))
	_check("Tools tab", tools_text.contains("Cheats") and tools_text.contains("Events / Timeline") and tools_text.contains("AI debug console"))
	await _shoot("m10-tab-tools")
	for pair: Array in [["game", "m11-tab-game", "Current session"], ["settings", "m12-tab-settings", "Jump straight into the options category you want."], ["help", "m13-tab-help", "Report a Bug"]]:
		menu._show_tab(str(pair[0]))
		await _wait(0.35)
		var text := _all_text(menu._card)
		_check("%s tab" % str(pair[0]), text.contains(str(pair[2])), text.substr(0, 200))
		await _shoot(str(pair[1]))
	menu._show_tab("settings")
	await _wait(0.2)

	await menu._open_workspace("general", "game", menu._card_rect())
	await _wait(0.8)
	var general := _all_text(menu._workspace)
	_check("game settings subtitle", general.contains("Playing as France"))
	await _shoot("m20-general")
	for pair: Array in [["sound", "m21-sound"], ["map", "m22-map"], ["ai", "m23-ai"], ["advanced", "m26-advanced"]]:
		await menu._workspace.set_section(str(pair[0]))
		await _wait(0.6)
		await _shoot(str(pair[1]))
		if str(pair[0]) == "map":
			menu._workspace._scroll.scroll_vertical = 100000
			await _wait(0.3)
			await _shoot("m22b-map-bottom")
		if str(pair[0]) == "ai":
			var ai_text := _all_text(menu._workspace)
			_check("AI section has the Models list", ai_text.contains("Models") and ai_text.contains("gemini-3.5-flash-lite (Gemini)"))
			_check("AI section has the generation toggles", ai_text.contains("Show time skip events as they are written") and ai_text.contains("Stop when my events fail"))
			var entries: Array = menu._workspace._fallback.get("entries", [])
			if not entries.is_empty():
				menu._workspace._editing_entry = str((entries[0] as Dictionary).get("id", ""))
				menu._workspace._render()
				await _wait(0.5)
				await _shoot("m24-ai-entry-editor")
			menu._workspace._editing_entry = ""
			menu._workspace._render()
			await _wait(0.3)
			await _scroll_to(menu._workspace, "AI requests")
			await _shoot("m24b-ai-requests")
			await _scroll_to(menu._workspace, "Connections")
			await _shoot("m24c-ai-connections")
			menu._workspace._scroll.scroll_vertical = 100000
			await _wait(0.3)
			await _shoot("m25-ai-bottom")
			await menu._workspace._set_flag("ai_live_skip_events", false)
			var after: Variant = await _request("settings.values")
			var flags: Dictionary = (after as Dictionary).get("flags", {}) if typeof(after) == TYPE_DICTIONARY else {}
			_check("the live-skip switch writes ai_live_skip_events", not bool(flags.get("ai_live_skip_events", true)))
			await menu._workspace._set_flag("ai_live_skip_events", true)
		if str(pair[0]) == "advanced":
			menu._workspace._tasks_expanded = true
			menu._workspace._render()
			await _wait(0.4)
			await _shoot("m26b-advanced-tasks")
			menu._workspace._tasks_expanded = false
			menu._workspace._log_viewing = true
			await menu._workspace._load_log()
			menu._workspace._render()
			await _wait(0.4)
			menu._workspace._scroll.scroll_vertical = 100000
			await _wait(0.3)
			await _shoot("m27-advanced-diagnostics")
	menu._workspace.go_back()
	await _wait(0.6)
	_check("Back returns to the quick menu", menu._card.visible and not menu._workspace.visible)
	menu.close()
	await _wait(0.4)

	await menu.show_ai_setup(true, "check")
	await _wait(0.5)
	_check("the AI setup prompt opens", menu._prompt != null and _all_text(menu._prompt).contains("Set up your AI provider"))
	await _shoot("m30-ai-setup")
	if menu._prompt:
		menu._prompt.dismissed.emit()
	await _wait(0.3)

	var cheats: CheatsScript = CheatsScript.new()
	main.hud.add_child(cheats)
	cheats.setup(main.engine, {"map_view": main.map_view})
	await cheats.open()
	await _wait(0.6)
	_check("cheats grid", _all_text(cheats).contains("GM Console") and _all_text(cheats).contains("History Document"))
	await _shoot("m40-cheats-grid")
	var preview: Dictionary = await cheats.gm_preview("France opens a national library annex in Paris.", "world-intervention")
	await _wait(0.6)
	_check("GM preview with the stand-in", bool(preview.get("ok", false)), str(preview.get("summary", preview.get("error", ""))))
	await _shoot("m41-gm-preview")
	cheats.close()
	await _wait(0.3)

	var console: ConsoleScript = ConsoleScript.new()
	main.ui.add_child(console)
	console.setup(main.engine, {"export_dir": exports, "reveal_saved_files": false})
	await console.open()
	await _wait(0.5)
	await _shoot("m50-console-generations")
	for pair: Array in [["analytics", "m51-console-analytics"], ["models", "m52-console-models"], ["export", "m53-console-export"]]:
		console.active_tab = str(pair[0])
		console._render()
		await _wait(0.3)
		await _shoot(str(pair[1]))
	await console._export_file("world")
	_check("world state export", console._notice.begins_with("oh-world-state-"), console._notice)
	console.close()

	var widget: Variant = main.hud.date_widget
	widget.run_jump(30.0)
	var skip_started := Time.get_ticks_msec()
	await _wait(1.0)
	while widget.is_loading and Time.get_ticks_msec() - skip_started < 240000:
		await process_frame
	await _wait(1.0)
	_say("skip landed in %d ms" % (Time.get_ticks_msec() - skip_started))
	await _request("turn.seen", {"through": 99})
	var view: Variant = await _request("game.view")
	var offered := {}
	if typeof(view) == TYPE_DICTIONARY:
		for event: Dictionary in (view as Dictionary).get("events", []):
			if bool(event.get("playerRelated", false)):
				offered = event
	_check("a skip event concerns the player", not offered.is_empty())
	var panel: InteractiveScript = InteractiveScript.new()
	main.ui.add_child(panel)
	panel.setup(main.engine, {})
	panel.open_timeline.connect(func() -> void: signals_seen.append("open_timeline"))
	panel.world_changed.connect(func() -> void: signals_seen.append("interactive.world_changed"))
	await panel.open()
	await _wait(0.4)
	await _shoot("m60-interactive-empty")
	if not offered.is_empty():
		await _request("cheats.interactive.offer", {"eventId": str(offered.get("id", "")), "title": str(offered.get("title", ""))})
		await panel.refresh()
		await _wait(0.4)
		_check("the offer shows", _all_text(panel).contains("The last time skip offers this moment to be played out"))
		await _shoot("m61-interactive-offer")
		await panel._begin(str(offered.get("id", "")))
		await _wait(0.4)
		var scene_text := _all_text(panel)
		_check("the scene opens", scene_text.contains("The summit table"), panel._error)
		await _shoot("m62-interactive-scene")
		var scene: Dictionary = panel._state.get("scene", {}) if typeof(panel._state.get("scene")) == TYPE_DICTIONARY else {}
		var choices: Array = scene.get("choices", [])
		if not choices.is_empty():
			await panel._play(str(choices[0]))
			await _wait(0.4)
			_check("a move is played", _all_text(panel).contains("Your move:"), panel._error)
			await _shoot("m63-interactive-beat")
			panel._confirming_aside = true
			panel._render()
			await _wait(0.3)
			await _shoot("m64-interactive-set-aside-confirm")
			panel._confirming_aside = false
			scene = panel._state.get("scene", {}) if typeof(panel._state.get("scene")) == TYPE_DICTIONARY else {}
			choices = scene.get("choices", [])
			if not choices.is_empty():
				await panel._play(str(choices[0]))
				await _wait(0.5)
				_check("the scene ends in the record", typeof(panel._finished) == TYPE_DICTIONARY, panel._error)
				await _shoot("m65-interactive-finished")
	panel.close()
	_say("signals: %s" % ", ".join(signals_seen))
	_say("failures: %d %s" % [failures.size(), ", ".join(failures)])
	_finish()


func _finish() -> void:
	main.engine.stop()
	await process_frame
	await process_frame
	quit(1 if not failures.is_empty() else 0)
