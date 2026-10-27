extends SceneTree

var main: Node
var shots := ""
var started := 0
var only := ""
var failures: PackedStringArray = []


func _initialize() -> void:
	root.mouse_passthrough = true
	shots = OS.get_environment("OH_SHOTS")
	only = OS.get_environment("OH_PARITY_ONLY")
	started = Time.get_ticks_msec()
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.add_child(main)
	_run.call_deferred()


func _say(text: String) -> void:
	print("[parity %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _check(label: String, ok: bool, detail := "") -> void:
	_say("%s %s%s" % ["ok  " if ok else "FAIL", label, ("  (" + detail + ")") if not detail.is_empty() else ""])
	if not ok:
		failures.append(label)


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


func _clear_shell() -> void:
	var shell: ShellBoot = main.get("shell") as ShellBoot
	if shell == null:
		return
	await _until(func() -> bool: return shell.door_state != "deciding", 30.0)
	if shell.door != null and is_instance_valid(shell.door):
		shell.door.opened.emit()
	if not shell.notice_updates.is_empty():
		await _until(func() -> bool: return shell.notice != null and is_instance_valid(shell.notice), 5.0)
		await _frames(5)
	if shell.notice != null and is_instance_valid(shell.notice):
		shell.notice.closed.emit()
	await _frames(3)


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
	for child in node.get_children():
		_texts(child, into)


func _all_text(node: Node) -> String:
	var found := PackedStringArray()
	_texts(node, found)
	return " | ".join(found)


func _want(part: String) -> bool:
	return only.is_empty() or only.split(",").has(part)


func _run() -> void:
	await _until(func() -> bool: return main.menu.visible, 120.0)
	await _clear_shell()
	await _until(func() -> bool: return bool(main.menu.get("loaded")), 30.0)
	_check("menu up, library loaded", main.menu.visible and bool(main.menu.get("loaded")))
	var shell: ShellBoot = main.shell
	await main._start_scenario("default")
	main.picker._choose("France")
	var begun := Time.get_ticks_msec()
	main._on_country_chosen("France", "medium")
	await _frames(3)
	_check("cover up at the press", shell.loading.is_open())
	var saw_settling := [false]
	var lifted := await _until(func() -> bool:
		if shell.loading.phase == "settling":
			saw_settling[0] = true
		return not shell.loading.is_open(), 70.0)
	var text_layer: PolityTextLayer = main.map_view.polity_text()
	_check("cover lifts once the labels are laid out", lifted and text_layer != null and not text_layer.busy() and text_layer.label_count > 0, "%d ms, labels %d, settling seen %s" % [Time.get_ticks_msec() - begun, text_layer.label_count if text_layer else -1, str(saw_settling[0])])
	await _until(func() -> bool: return main.in_game and main.hud.visible, 10.0)
	await _wait(1.0)
	if _want("hud"):
		await _hud_part()
	if _want("menu"):
		await _menu_part()
	if _want("globe"):
		await _globe_part()
	if _want("play"):
		await _play_part()
	if _want("flag"):
		await _flag_part()
	if _want("crash"):
		await _crash_part()
	_say("failures: %d %s" % [failures.size(), ", ".join(failures)])
	main.engine.stop()
	quit(1 if failures.size() > 0 else 0)


func _hud_part() -> void:
	var hud: Hud = main.hud
	var pill := hud.get("_pill_subtitle") as Label
	_check("session pill names country and date", pill.text.contains(" / France / ") and not pill.text.ends_with("/ "), pill.text)
	var cities: Array = main.get("_cities_raw")
	_check("cities carry the source name and rename flag", not cities.is_empty() and (cities[0] as Array).size() == 8, str(cities.size()))
	_check("flag badge has a picture", (hud.get("_flag") as TextureRect).texture != null)
	var flag_button: Button = null
	for child in (hud.get("_flag_frame") as Node).get_children():
		if child is Button:
			flag_button = child
	flag_button.pressed.emit()
	await _wait(1.2)
	_check("flag badge opens the country drawer", hud.open_drawer == "country")
	flag_button.pressed.emit()
	await _wait(0.6)
	_check("second press closes it", hud.open_drawer == "")
	(hud.get("_advisor_button") as Button).pressed.emit()
	await _wait(1.0)
	_check("advisor open", hud.open_drawer == "advisor")
	await _shoot("p-advisor-lit")
	(hud.get("_advisor_button") as Button).pressed.emit()
	await _wait(0.6)
	hud.set_chat_badge(0, true)
	var first := (hud.get("_chat_badge_label") as Label).text
	await _wait(0.5)
	var second := (hud.get("_chat_badge_label") as Label).text
	_check("typing badge animates", first != second and second.begins_with("."), "%s -> %s" % [first, second])
	await _shoot("p-typing-badge")
	hud.set_chat_badge(3, false)
	_check("count badge after typing", (hud.get("_chat_badge_label") as Label).text == "3")
	hud.date_widget.is_loading = true
	hud.toggle_dock("chat")
	_check("dock opens during a skip", hud.active_panel == "chat")
	hud.toggle_dock("chat")
	hud.date_widget.is_loading = false
	var search: Control = hud.search
	if search and search.has_method("_fly_to_query"):
		search.call("open")
		await _wait(0.5)
		var input := search.get("_input") as LineEdit
		input.text = "Qzxqzxq Nowhere"
		search.call("_on_text_changed", input.text)
		await search.call("_fly_to_query", input.text)
		_check("place not found keeps the typed text", input.text == "Qzxqzxq Nowhere" and str(search.get("status")) == "error", "%s / %s" % [input.text, str(search.get("status"))])
		await _shoot("p-search-not-found")
		search.call("close")
	var ctx: Dictionary = hud.map_cards.get("context")
	_check("map cards get the move_structure handler", ctx.get("move_structure") is Callable)
	if ctx.get("move_structure") is Callable:
		var forces: Node = main.forces
		var moved := [false]
		forces.connect("world_changed", func() -> void: moved[0] = true)
		(ctx["move_structure"] as Callable).call("no-such-structure")
		await _wait(0.4)
		_check("Move arms the placement banner", bool(forces.call("is_placing")) and _all_text(forces).contains("Click the map where this structure really is"))
		await _shoot("p-structure-place")
		await forces.place_at(Vector2(720, 450))
		await _wait(0.4)
		_check("placing settles the structure and redraws", moved[0] and not bool(forces.call("is_placing")))


func _menu_part() -> void:
	var menu: Node = main.game_menu
	await menu.open()
	await _wait(0.6)
	_check("Cheats tile in a solo game", _all_text(menu.get("_card")).contains("Cheats"))
	main.engine.engine_event.emit("multiplayer.shared", {"mode": "playing", "role": "guest"})
	await _wait(0.4)
	_check("Cheats tile hidden in a shared game", not _all_text(menu.get("_card")).contains("Cheats"))
	await _shoot("p-menu-shared")
	main.engine.engine_event.emit("multiplayer.shared", {"mode": "off", "role": ""})
	await _wait(0.3)
	await menu.close()
	await _wait(0.4)
	await menu.show_ai_setup(true, "")
	await _wait(0.8)
	var prompt: Control = menu.get("_prompt")
	_check("AI setup prompt opens", prompt != null)
	if prompt:
		prompt.set("online", false)
		prompt.call("_render")
		await _wait(0.3)
		_check("offline note", _all_text(prompt).contains("The video needs an internet connection."))
		await _shoot("p-ai-offline")
		var table: Dictionary = (prompt.get("setup") as Dictionary).get("recentModels", {})
		table[str(prompt.get("provider"))] = ["gemini-test-model-a", "gemini-test-model-b"]
		prompt.set("online", true)
		prompt.call("_render")
		await _wait(0.3)
		var line := prompt.get("_model_line") as LineEdit
		line.grab_focus()
		await _wait(0.3)
		var box := prompt.get("_suggest_box") as Control
		_check("model suggestions show", box.visible and _all_text(box).contains("gemini-test-model-a"), _all_text(box))
		await _shoot("p-ai-suggestions")
		menu.call("_close_prompt")
		await _wait(0.3)


func _globe_part() -> void:
	var shell: ShellBoot = main.shell
	main._on_setting_changed("Globe", true)
	await _frames(2)
	_check("globe switch raises the cover", shell.loading.is_open())
	await _shoot("p-globe-cover")
	var lifted := await _until(func() -> bool: return not shell.loading.is_open(), 70.0)
	_check("cover lifts after the globe redraw", lifted)
	await _wait(0.8)
	await _shoot("p-globe-on")
	main._on_setting_changed("Globe", false)
	await _until(func() -> bool: return not shell.loading.is_open(), 70.0)
	await _wait(0.6)


func _play_part() -> void:
	var id := str(main.game_id)
	main._play_from_workshop(id)
	await _until(func() -> bool: return main.picker.visible, 30.0)
	await _wait(1.0)
	var text := _all_text(main.picker)
	_check("Apply & Play picker: Choose your country, Done, no tabs", text.contains("Choose your country") and text.contains("[Done]") and not text.contains("Play as a group") and text.contains("Keep scenario default"), text.substr(0, 300))
	await _shoot("p-play-picker")
	var options: Array = main.picker.get("_options")
	var target := ""
	for option in options:
		if str(option.get("code", "")) != "France":
			target = str(option.get("code", ""))
			break
	main.picker._choose(target)
	await _wait(0.3)
	main.picker._start("medium")
	await _until(func() -> bool: return not main.picker.visible and main.in_game and not main.shell.loading.is_open(), 70.0)
	await _wait(0.8)
	var view: Dictionary = (await main.engine.request("game.view")).get("result", {})
	_check("Apply & Play pick changes the played country", str(view.get("country", "")) == target, "%s vs %s" % [str(view.get("country", "")), target])
	main._play_from_workshop(id)
	await _until(func() -> bool: return main.picker.visible, 30.0)
	await _wait(0.6)
	main.picker._close()
	await _until(func() -> bool: return not main.picker.visible, 10.0)
	await _wait(1.0)
	_check("Done keeps the game", main.in_game and main.hud.visible)
	await _shoot("p-play-done")


func _flag_part() -> void:
	await main._exit_game()
	await main._start_scenario("default")
	var picker: CountryPicker = main.picker
	picker.set("_tab", "group")
	picker.call("_render")
	await _wait(0.4)
	var creator: Dictionary = picker.get("_creator")
	creator["name"] = "Northern League"
	picker.call("_open_flag_picker")
	await _wait(2.0)
	var overlay: Variant = picker.get("_flag_overlay")
	_check("faction flag picker opens", overlay != null and is_instance_valid(overlay) and _all_text(overlay).contains("Built-in flags"), _all_text(overlay).substr(0, 200) if overlay else "")
	await _shoot("p-flag-picker")
	await overlay._pick("https://flagcdn.com/it.svg")
	await _wait(0.8)
	_check("flag picker closes on a pick", picker.get("_flag_overlay") == null)
	creator = picker.get("_creator")
	_check("chosen flag lands in the form", str(creator.get("flag", "")) == "https://flagcdn.com/it.svg" and not str(creator.get("flag_file", "")).is_empty(), str(creator))
	_check("form says Change flag", _all_text(picker).contains("[Change flag]") and _all_text(picker).contains("[Remove]"))
	await _shoot("p-flag-chosen")
	picker.call("_create")
	await _wait(0.3)
	var pick: Dictionary = picker.get("_pick")
	var lead: Dictionary = pick.get("group", pick.get("faction", {}))
	_check("the lead carries the flag", str(lead.get("flag", "")) == "https://flagcdn.com/it.svg")
	picker._start("medium")
	await _until(func() -> bool: return main.in_game and not main.shell.loading.is_open(), 90.0)
	await _wait(1.0)
	var hud: Hud = main.hud
	_check("landless lead shows its chosen flag", (hud.get("_flag") as TextureRect).texture != null, str(hud.get("_flag_info")))
	await _shoot("p-group-flag")


func _crash_part() -> void:
	var old := main
	var app_script: Script = old.get_script()
	main._on_engine_stopped("The game engine stopped (code 1).\nboom")
	await _wait(0.5)
	var crash: CrashScreen = main.crash
	_check("crash screen shows", crash.is_shown() and _all_text(crash).contains("Something went wrong"))
	await _shoot("p-crash")
	crash.reload_requested.emit()
	await _frames(5)
	var fresh: Node = null
	for child in root.get_children():
		if child.get_script() == app_script and (not is_instance_valid(old) or child != old):
			fresh = child
	_check("reload builds a fresh app", fresh != null)
	if fresh:
		main = fresh
		var back := await _until(func() -> bool: return main.menu.visible and main.engine.is_ready(), 120.0)
		_check("reload returns to the menu with a new engine", back)
		await _clear_shell()
		await _shoot("p-after-reload")
