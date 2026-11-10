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


func _find_text(node: Node, text: String) -> Control:
	if node is CanvasItem and not (node as CanvasItem).visible:
		return null
	if node is Label and (node as Label).text.contains(text):
		return node as Control
	if node is Button and (node as Button).text.contains(text):
		return node as Control
	for child in node.get_children():
		var found := _find_text(child, text)
		if found:
			return found
	return null


func _scroll_into_view(root_node: Node, text: String) -> bool:
	var label := _find_text(root_node, text)
	if not label:
		return false
	var parent: Node = label.get_parent()
	while parent and not (parent is ScrollContainer):
		parent = parent.get_parent()
	if not parent:
		return false
	var scroll := parent as ScrollContainer
	scroll.scroll_vertical = int(label.global_position.y - scroll.global_position.y + scroll.scroll_vertical - 12.0)
	await _wait(0.3)
	return true


func _request(method: String, args := {}) -> Variant:
	var reply: Dictionary = await main.engine.request(method, args)
	if not reply.get("ok", false):
		_say("request %s failed: %s" % [method, str(reply.get("error", ""))])
		return null
	return reply.get("result")


func _until(condition: Callable, seconds: float) -> bool:
	var deadline := Time.get_ticks_msec() + int(seconds * 1000.0)
	while Time.get_ticks_msec() < deadline:
		if condition.call():
			return true
		await process_frame
	return bool(condition.call())


func _clear_shell() -> void:
	await _until(func() -> bool: return main.shell != null, 120.0)
	var shell: ShellBoot = main.shell
	if shell == null:
		return
	await _until(func() -> bool: return shell.door_state != "deciding", 120.0)
	if shell.door != null and is_instance_valid(shell.door):
		shell.door.open()
		await _until(func() -> bool: return shell.door == null, 8.0)
		_say("vault door opened for the test")
	if not shell.notice_updates.is_empty():
		await _until(func() -> bool: return shell.notice != null and is_instance_valid(shell.notice), 5.0)
		for i in range(5):
			await process_frame
	if shell.notice != null and is_instance_valid(shell.notice):
		shell.notice.closed.emit()
		_say("update notice closed for the test")
	for i in range(3):
		await process_frame


func _run() -> void:
	await process_frame
	while not main.menu.visible:
		if Time.get_ticks_msec() - started > 120000:
			_check("the main menu appears", false)
			_finish()
			return
		await process_frame
	_say("main menu ready")
	await _clear_shell()
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
	await _until(func() -> bool: return _all_text(menu._workspace).contains("Privacy"), 20.0)
	await _wait(0.8)
	var app_text := _all_text(menu._workspace)
	_check("app settings say they are for every game", app_text.contains("For every game. A game's own settings are in its ☰ menu."))
	_check("app settings open on General", app_text.contains("Language") and app_text.contains("Display") and app_text.contains("Accessibility") and app_text.contains("Privacy"))
	await _shoot("m01-app-general")
	await _display_mode(menu)
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
				menu._workspace._details["entry:%s" % str((entries[0] as Dictionary).get("id", ""))] = true
				menu._workspace._render()
				await _wait(0.5)
				var entry_text := _all_text(menu._workspace)
				_check("This model only has no Context window field", entry_text.contains("How the AI answers") and not entry_text.contains("Context window") and not entry_text.contains("Forget this window"))
				await _shoot("m24-ai-entry-editor")
				menu._workspace._details.erase("entry:%s" % str((entries[0] as Dictionary).get("id", "")))
			menu._workspace._editing_entry = ""
			menu._workspace._render()
			await _wait(0.3)
			await _scroll_to(menu._workspace, "AI requests")
			await _shoot("m24b-ai-requests")
			await _requests_switch(menu)
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
	await _ai_setup_choices(menu)
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
	await cheats.edit_country("France")
	await _wait(0.8)
	var editor_text := _all_text(cheats)
	_check("Country Editor shows the Political World section", editor_text.contains("POLITICAL WORLD") and editor_text.contains("Government & political system") and editor_text.contains("Political traits · full supported catalog"))
	await _shoot("m42-country-editor")
	if await _scroll_into_view(cheats, "POLITICAL WORLD"):
		await _shoot("m42b-political-world")
	if await _scroll_into_view(cheats, "Political traits · full supported catalog (10)"):
		await _shoot("m42c-political-traits")
	await cheats.open_new_puppet()
	await _wait(0.6)
	var puppet_text := _all_text(cheats)
	_check("Puppet States opens its new puppet state form", puppet_text.to_lower().contains("new puppet state") and puppet_text.contains("Make it a puppet state") and puppet_text.contains("Pick the overlord…"))
	await _shoot("m43-puppet-new")
	cheats.close()
	await _wait(0.3)

	var console: ConsoleScript = ConsoleScript.new()
	main.ui.add_child(console)
	console.setup(main.engine, {"export_dir": exports, "reveal_saved_files": false})
	await console.open()
	await _wait(0.5)
	var recorded := int(console._data.get("count", 0))
	_check("the console lists the AI calls made so far", recorded > 0 and bool(console._data.get("available", false)), "%d generation(s)" % recorded)
	await _shoot("m50-console-generations")
	var listed: Array = console._data.get("filtered", [])
	if not listed.is_empty():
		console._selected = str((listed[0] as Dictionary).get("id", ""))
		await console.refresh()
		await _wait(0.4)
		_check("a generation opens with its prompt", not str(console._detail.get("systemPrompt", "")).is_empty())
		await _shoot("m50b-console-detail")
		console._selected = ""
		console._detail = {}
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
		for attempt in range(6):
			var busy_since := Time.get_ticks_msec()
			while Time.get_ticks_msec() - busy_since < 60000:
				var busy: Variant = await _request("invoke", {"module": "simulationStatus", "fn": "isSimulationBusy", "args": []})
				if not bool(busy):
					break
				await _wait(0.5)
			var made: Variant = await _request("cheats.interactive.offer", {"eventId": str(offered.get("id", "")), "title": str(offered.get("title", ""))})
			_say("offer %d: %s" % [attempt + 1, str(made)])
			await _wait(1.0)
			await panel.refresh()
			if typeof(panel._state.get("offer")) == TYPE_DICTIONARY:
				break
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
	await _library()
	await _discord_invites()
	_say("signals: %s" % ", ".join(signals_seen))
	_say("failures: %d %s" % [failures.size(), ", ".join(failures)])
	_finish()


func _requests_text(menu: Variant) -> String:
	var label := _find_label(menu._workspace._content, "AI requests")
	var node: Node = label
	while node and not node.has_meta("settings_section"):
		node = node.get_parent()
	return _all_text(node) if node else ""


func _requests_switch(menu: Variant) -> void:
	var text := _requests_text(menu)
	_check("AI requests opens on My key has no request limit, off for a Gemini key", text.contains("My key has no request limit") and text.contains("Off (default): for a free key, where requests run out.") and text.contains("of 500 used today"), text.substr(0, 240))
	_check("Save AI requests and Background AI are gone", not text.contains("Save AI requests") and not text.contains("Background AI") and not text.contains("Background requests a day, at most"))
	_check("the daily limit field shows with the switch off", text.contains("Requests a day your key allows") and text.contains("Only used for the count above and to keep requests nobody pressed a button for from spending the end of your day."))
	_check("Countries write to me between time skips, on by default", text.contains("Countries write to me between time skips") and text.contains("Off: between time skips, no country writes to you unless you write first.") and menu._workspace._flag("ai_idle_diplomacy"))
	_check("AI lookup functions left Generation behavior", not _all_text(menu._workspace).contains("Only used while Save AI requests"))
	await menu._workspace._set_flag("ai_idle_diplomacy", false)
	var values: Variant = await _request("settings.values")
	var flags: Dictionary = (values as Dictionary).get("flags", {}) if typeof(values) == TYPE_DICTIONARY else {}
	_check("the idle diplomacy switch writes ai_idle_diplomacy", not bool(flags.get("ai_idle_diplomacy", true)))
	await menu._workspace._set_flag("ai_idle_diplomacy", true)
	await menu._workspace._requests_set("noRequestLimit", true)
	await _wait(0.5)
	text = _requests_text(menu)
	_check("the switch on says what it allows", text.contains("On: for a paid key or a local model.") and text.contains("A time skip may use up to 8 requests, with up to 6 rounds of questions.") and text.contains("used today") and not text.contains("of 500 used today"), text.substr(0, 240))
	_check("the switch on hides the daily limit and offers Advanced", not text.contains("Requests a day your key allows") and text.contains("Advanced") and not text.contains("AI lookup functions"))
	var caption: Variant = await _request("timeline.caption")
	_check("the time controls count without a limit", typeof(caption) == TYPE_DICTIONARY and bool((caption as Dictionary).get("noLimit", false)) and str((caption as Dictionary).get("second", "")).contains("at most 8"), str(caption))
	menu._workspace._details["requestsAdvanced"] = true
	menu._workspace._render()
	await _wait(0.5)
	text = _requests_text(menu)
	_check("Advanced holds AI lookup functions", text.contains("AI lookup functions") and text.contains("in up to 6 extra requests a task"))
	await _scroll_to(menu._workspace, "AI requests")
	await _shoot("m24d-ai-requests-no-limit")
	menu._workspace._details.erase("requestsAdvanced")
	await menu._workspace._requests_set("noRequestLimit", false)
	await _wait(0.5)
	var back: Variant = await _request("settings.requests")
	_check("the switch turns off again", typeof(back) == TYPE_DICTIONARY and not bool((back as Dictionary).get("noLimit", true)))


func _ai_setup_choices(menu: Variant) -> void:
	var prompt: Variant = menu._prompt
	if prompt == null:
		return
	var text := _all_text(prompt)
	_check("the AI setup opens on three choices", text.contains("Gemini") and text.contains("Best free option") and text.contains("Command Code") and text.contains("Best quality option") and text.contains("Custom") and text.contains("Configure any provider and any model, or a local model"), text.substr(0, 300))
	_check("no choice is marked recommended", not text.to_lower().contains("recommended"))
	_check("the choices have Not now and Open full settings, no Save", text.contains("[Not now]") and text.contains("[Open full settings]") and not text.contains("[Save and play]"))
	var cards: Node = prompt.find_child("SetupChoices", true, false)
	_check("the three cards sit side by side", cards is HBoxContainer and cards.get_child_count() == 3)
	for choice_key in ["gemini", "commandcode", "custom"]:
		var mark := prompt.find_child("Mark_%s" % choice_key, true, false) as TextureRect
		_check("the %s card shows its mark" % choice_key, mark != null and mark.texture != null)
	prompt.open_choice("gemini")
	await _wait(0.5)
	text = _all_text(prompt)
	_check("Gemini opens the free-key steps", text.contains("New to API keys?") and text.contains("GEMINI API KEY") and text.contains("MODEL (OPTIONAL)") and text.contains("[← Back]") and text.contains("[Save and play]") and not text.contains("[Open full settings]"), text.substr(0, 300))
	await _shoot("m30b-ai-setup-gemini")
	prompt.open_choice("commandcode")
	await _wait(0.5)
	text = _all_text(prompt)
	_check("Command Code opens its plan, its keys page and only the key", text.contains("1. Get the GOAT plan, $10 a month") and text.contains("[Open the plans ↗]") and text.contains("2. Generate an API key") and text.contains("[Open the API keys page ↗]") and text.contains("COMMAND CODE API KEY") and text.contains("GLM 5.3 Flash") and text.contains("MY KEY HAS NO REQUEST LIMIT") and not text.contains("MODEL (OPTIONAL)"), text.substr(0, 400))
	await _shoot("m30c-ai-setup-commandcode")
	prompt.open_choice("custom")
	await _until(func() -> bool: return prompt.custom_no_limit, 5.0)
	text = _all_text(prompt)
	_check("Custom starts on a local server", text.contains("PROVIDER") and text.contains("API ENDPOINT") and str(prompt.endpoint) == "http://localhost:11434/v1" and text.contains("[Open full settings]"), text.substr(0, 300))
	_check("a local server shows My key has no request limit: On", bool(prompt.custom_no_limit) and text.contains("MY KEY HAS NO REQUEST LIMIT"))
	await _shoot("m30d-ai-setup-custom")
	prompt._on_endpoint_changed("https://api.example.com/v1")
	await _until(func() -> bool: return not prompt.custom_no_limit, 5.0)
	_check("a hosted endpoint leaves the switch as it is", not bool(prompt.custom_no_limit) and not _all_text(prompt).contains("MY KEY HAS NO REQUEST LIMIT"))
	for pair: Array in [["commandcode", "", true], ["gemini", "", false], ["custom", "http://127.0.0.1:1234/v1", true], ["custom", "https://api.example.com/v1", false]]:
		var answer: Variant = await _request("settings.setupNoRequestLimit", {"choice": str(pair[0]), "provider": "openai-compatible", "endpoint": str(pair[1])})
		_check("%s %s sets no request limit %s" % [str(pair[0]), str(pair[1]), str(pair[2])], typeof(answer) == TYPE_DICTIONARY and bool((answer as Dictionary).get("on", false)) == bool(pair[2]))
	prompt.back_to_choices()
	await _wait(0.3)
	_check("Back returns to the three choices", _all_text(prompt).contains("Best free option"))
	prompt.open_choice("gemini")
	prompt.api_key = "stand-in"
	await prompt._save()
	await _wait(0.4)
	_check("saving Gemini closes the prompt", menu._prompt == null)
	var requests: Variant = await _request("settings.requests")
	_check("Gemini's free key leaves no request limit off", typeof(requests) == TYPE_DICTIONARY and not bool((requests as Dictionary).get("noLimit", true)))


func _display_mode(menu: Variant) -> void:
	var workspace: Variant = menu._workspace
	var select: OptionButton = workspace._display_select
	var modes := []
	if select:
		for index in range(select.item_count):
			modes.append(str(select.get_item_metadata(index)))
	var text := _all_text(workspace)
	_check("Display has a Display mode: Windowed, Maximized, Fullscreen", select != null and modes == ["windowed", "maximized", "fullscreen"] and text.contains("Display mode") and text.contains("[Windowed]") and text.contains("Runs the game in a standard resizable desktop window."), str(modes))
	_check("the Fullscreen switch is gone", _find_label(workspace._content, "Fullscreen") == null)
	if not select:
		return
	select.select(1)
	select.item_selected.emit(1)
	await _until(func() -> bool: return ShellBoot.display_mode() == "maximized", 4.0)
	await _wait(0.6)
	var kept: Variant = await _request("settings.values")
	var shown_mode := str((kept as Dictionary).get("displayMode", "")) if kept is Dictionary else ""
	var file := FileAccess.open(OS.get_environment("OH_NATIVE_ROOT").path_join("display-mode.json"), FileAccess.READ)
	var on_disk := file.get_as_text() if file else ""
	_check("Maximized fills the screen and is kept for the next opening", ShellBoot.display_mode() == "maximized" and shown_mode == "maximized" and on_disk.contains("maximized") and str(workspace._display_helper.text) == "The game's window fills your screen, with its title bar.", "%s, %s, %s" % [ShellBoot.display_mode(), shown_mode, on_disk])
	await _shoot("m01b-display-maximized")
	select.select(0)
	select.item_selected.emit(0)
	await _until(func() -> bool: return ShellBoot.display_mode() == "windowed", 4.0)
	await _wait(0.6)
	_check("Windowed gives the window back", ShellBoot.display_mode() == "windowed" and select.selected == 0)


func _library() -> void:
	await main._exit_game()
	main._call(main.menu, "_show_page", ["games"])
	await main._refresh_library()
	await _wait(1.2)
	var library: Node = main.menu
	var grid := library._page_root.get_node_or_null("GamesGrid") as GridContainer
	var games: Array = main.library.get("games", [])
	_check("the library shows the game's card", grid != null and grid.get_child_count() > 0 and not games.is_empty())
	if grid == null or grid.get_child_count() == 0 or games.is_empty():
		return
	var game: Dictionary = games[0]
	var card: Control = grid.get_child(0)
	var title := _find_label(card, str(game.get("name", "")))
	_check("the card's name is smaller and wraps", title != null and title.get_theme_font_size("font_size") == 17 and title.autowrap_mode != TextServer.AUTOWRAP_OFF)
	var date_text := str(game.get("dateText", ""))
	_check("the card's date is written in the player's language", not date_text.is_empty() and date_text != str(game.get("gameDate", "")) and _find_label(card, date_text) != null, "%s from %s" % [date_text, str(game.get("gameDate", ""))])
	_check("a game in the library has no Archive button on its card", _find_text(card, "Archive") == null)
	await _shoot("m80-library-card")
	var more: Button = null
	for node in card.find_children("*", "Button", true, false):
		if (node as Button).tooltip_text.begins_with("More for"):
			more = node
	_check("the card has its ⋯ menu", more != null)
	if more == null:
		return
	more.pressed.emit()
	await _wait(0.5)
	var popup: PopupPanel = null
	for child in library.get_children():
		if child is PopupPanel and (child as PopupPanel).visible:
			popup = child
	var rows := []
	if popup:
		for node in popup.find_children("*", "Button", true, false):
			rows.append((node as Button).text)
	_check("the card's menu offers Edit, Clone, Archive, Export", rows == ["Edit", "Clone", "Archive", "Export"], str(rows))
	await _shoot("m81-card-menu")
	if popup == null:
		return
	var archive: Button = null
	for node in popup.find_children("*", "Button", true, false):
		if (node as Button).text == "Archive":
			archive = node
	archive.pressed.emit()
	var id := str(game.get("id", ""))
	var archived := await _until(func() -> bool: return (main.library.get("games", []) as Array).any(func(entry: Dictionary) -> bool: return str(entry.get("id", "")) == id and bool(entry.get("archived", false))), 10.0)
	_check("Archive from the menu archives the game", archived)
	library._game_view = "archived"
	library._show_page("games")
	await _wait(1.0)
	var shelf := library._page_root.get_node_or_null("GamesGrid") as GridContainer
	var archived_card: Control = shelf.get_child(0) if shelf and shelf.get_child_count() > 0 else null
	_check("an archived game's card offers Unarchive and Delete", archived_card != null and _find_text(archived_card, "Unarchive") != null and (_find_text(archived_card, "Delete") != null or not bool(game.get("canDelete", false))))
	await _shoot("m82-archived-card")
	var unarchive: Button = null
	var found: Node = _find_text(archived_card, "Unarchive") if archived_card else null
	while found and not (found is Button):
		found = found.get_parent()
	if found is Button:
		unarchive = found
	_check("the Unarchive button is there", unarchive != null)
	if unarchive:
		unarchive.pressed.emit()
		var back := await _until(func() -> bool: return (main.library.get("games", []) as Array).any(func(entry: Dictionary) -> bool: return str(entry.get("id", "")) == id and not bool(entry.get("archived", false))), 10.0)
		_check("Unarchive puts it back in the library", back)
	library._game_view = "active"
	library._show_page("games")
	await _wait(0.4)


func _discord_invites() -> void:
	var invites: Variant = main.get("discord_invites")
	_check("the Discord invitations are mounted above the menu and the game", invites is DiscordInvites and (invites as Node).get_index() > main.menu.get_index() and (invites as Node).get_index() > main.hud.get_index() and (invites as Node).get_index() > main.shared_overlay.get_index())
	if not invites is DiscordInvites:
		return
	var card := invites as DiscordInvites
	card._timer.stop()
	await _until(func() -> bool: return not card._reading, 5.0)
	var inbox: Variant = await _request("discord.inbox")
	_check("the inbox is empty while the presence is off", inbox is Dictionary and (inbox as Dictionary).get("join") == null and ((inbox as Dictionary).get("requests", []) as Array).is_empty(), str(inbox))
	_check("nothing shows without an invitation", not card.visible)
	card.invite = {"token": "oh1-test"}
	card._render()
	await _wait(0.3)
	_check("a friend's invitation asks to join", card.visible and _all_text(card).contains("A friend invited you to a shared game") and _all_text(card).contains("You were invited on Discord. You will need the lobby's scenario in your library.") and _all_text(card).contains("Not now") and _all_text(card).contains("Join"))
	await _shoot("m70-discord-invite")
	card.invite = {}
	card.requests = [{"id": "123456789", "name": "Aster"}]
	card._render()
	await _wait(0.3)
	_check("a request to join asks the host", card.visible and _all_text(card).contains("Aster asks to join your shared game") and _all_text(card).contains("Accept, and Discord sends them your invitation.") and _all_text(card).contains("Decline"))
	await _shoot("m71-discord-request")
	card._answer(card.requests[0], false)
	await _wait(0.2)
	_check("an answered request leaves", not card.visible)


func _finish() -> void:
	main.engine.stop()
	await process_frame
	await process_frame
	quit(1 if not failures.is_empty() else 0)
