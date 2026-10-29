extends SceneTree

var main: Node
var shots := ""
var started := 0
var failures: PackedStringArray = []
var played: PackedStringArray = []
var only := ""

const NEWEST_UPDATES := ["2026-10-native-renamed-regions", "2026-10-native-retina", "2026-10-native-faster-and-mac", "2026-10-renamed-regions"]


func _update_ids(updates: Array) -> Array:
	var ids := []
	for update in updates:
		if update is Dictionary and not ids.has(str((update as Dictionary).get("id", ""))):
			ids.append(str((update as Dictionary).get("id", "")))
	return ids


func _texts(node: Node, out: PackedStringArray) -> PackedStringArray:
	if node is Label:
		out.append((node as Label).text)
	elif node is Button:
		out.append((node as Button).text)
	elif node is RichTextLabel:
		out.append((node as RichTextLabel).get_parsed_text())
	for child in node.get_children():
		_texts(child, out)
	return out


func _missed_updates(shell: ShellBoot) -> void:
	await main.engine.request("shell.notice.shown", {"id": "2026-10-peace-and-weariness"})
	shell._notice_started = false
	await shell.prepare()
	shell._maybe_show_notice()
	var mounted := await _until(func() -> bool: return shell.notice != null and is_instance_valid(shell.notice) and shell.notice.page_count() > 0, 10.0)
	var ids := _update_ids(shell.notice._pages.map(func(page: Dictionary) -> Dictionary: return page.get("update", {}))) if mounted else []
	_check("the vault-door notice shows every update a device missed, newest first", mounted and ids.slice(0, NEWEST_UPDATES.size()) == NEWEST_UPDATES, ", ".join(PackedStringArray(ids)))
	var found := {}
	for index in range(shell.notice.page_count() if mounted else 0):
		shell.notice.show_page(index)
		await _wait(0.5)
		for title in ["Renamed regions and a tidier top bar", "Fixes from your reports", "Sharp on Retina screens", "Faster, and on the Mac"]:
			if Array(_texts(shell.notice, PackedStringArray())).any(func(value: String) -> bool: return value.contains(title)):
				found[title] = true
	_check("their pages read as written", found.size() == 4, ", ".join(PackedStringArray(found.keys())))
	await _shoot("s-10b-missed-notice")
	await _key(KEY_ESCAPE)
	await _frames(4)
	_check("the missed updates' notice closes onto the menu", shell.notice == null and main.menu.visible)


func _initialize() -> void:
	shots = OS.get_environment("OH_SHOTS")
	only = OS.get_environment("SHELL_ONLY")
	started = Time.get_ticks_msec()
	root.mouse_passthrough = true
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.add_child(main)
	_run.call_deferred()


func _say(text: String) -> void:
	print("[shell %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _check(label: String, ok: bool, detail := "") -> void:
	_say("%s %s%s" % ["ok  " if ok else "FAIL", label, ("  (" + detail + ")") if not detail.is_empty() else ""])
	if not ok:
		failures.append(label)


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
	return false


func _shoot(name: String) -> void:
	await _frames(2)
	var drawn := [false]
	var mark := func() -> void: drawn[0] = true
	RenderingServer.frame_post_draw.connect(mark)
	var deadline := Time.get_ticks_msec() + 5000
	while not drawn[0] and Time.get_ticks_msec() < deadline:
		OS.low_processor_usage_mode = false
		if main.has_method("_stay_awake"):
			main.call("_stay_awake")
		await process_frame
	RenderingServer.frame_post_draw.disconnect(mark)
	if not drawn[0]:
		_say("screenshot %s skipped: no frame was drawn" % name)
		return
	if shots.is_empty():
		return
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(name + ".png"))
	_say("screenshot " + name)


func _click(at: Vector2) -> void:
	var press := InputEventMouseButton.new()
	press.button_index = MOUSE_BUTTON_LEFT
	press.pressed = true
	press.position = at
	press.global_position = at
	Input.parse_input_event(press)
	await _frames(2)
	var release := InputEventMouseButton.new()
	release.button_index = MOUSE_BUTTON_LEFT
	release.pressed = false
	release.position = at
	release.global_position = at
	Input.parse_input_event(release)
	await _frames(2)


func _key(code: Key) -> void:
	var press := InputEventKey.new()
	press.keycode = code
	press.physical_keycode = code
	press.pressed = true
	Input.parse_input_event(press)
	await _frames(1)
	var release := InputEventKey.new()
	release.keycode = code
	release.physical_keycode = code
	release.pressed = false
	Input.parse_input_event(release)
	await _frames(2)


func _run() -> void:
	await _frames(3)
	var shell: ShellBoot = main.shell
	_check("startup screen up at launch", shell.startup.visible and not main.menu.visible)
	await _shoot("s-01-startup")
	if not await _until(func() -> bool: return main.menu.visible, 120.0):
		_check("the menu appeared", false)
		_finish()
		return
	_check("menu shown behind the door", main.menu.visible and not shell.startup.visible)
	var door := shell.door
	_check("vault door shut over the menu on a first opening", door != null and is_instance_valid(door) and door.stage == "closed", str(shell.door_state))
	if door:
		door.sounds().played.connect(func(name: String) -> void:
			played.append(name)
			_say("sound played: " + name))
	await _shoot("s-02-door-shut")
	if only in ["", "boot"]:
		await _boot_door(shell)
		await _notice_and_history(shell)
	elif shell.door:
		shell.door.open()
		await _until(func() -> bool: return shell.door == null, 8.0)
		if shell.notice:
			shell.notice.closed.emit()
		await _frames(3)
	if only in ["", "lang"]:
		await _languages(shell)
	if only in ["", "parts"]:
		await _parts()
	if only in ["", "loading", "boot"]:
		await _loading(shell)
	_finish()


const SAMPLES := ["Games", "Scenarios", "Continue Playing", "No games yet", "Settings", "Refresh", "Import Game", "1 game", "3 games", "Jan 1, 2016", "1 March 218 BC", "2016-01-08", "1/8/2016", "January 2016", "Modern Day Session / France / 2016-01-08", "Rate this time skip", "Update notice 2 of 6", "Major update · 24. Oktober 2026", "Playing as France · Jan 1, 2016", "Deleted 3 days ago", "Translating to Deutsch…", "Our forces are ready to move at dawn.", "Reading the world…", "Every update to Open Historia, newest first."]


func _languages(shell: ShellBoot) -> void:
	var i18n: I18n = main.i18n
	main._call(main.menu, "_show_page", ["scenarios"])
	var switching := Time.get_ticks_msec()
	await i18n.set_language("de")
	_say("German applied in %d ms" % (Time.get_ticks_msec() - switching))
	await _wait(1.0)
	_check("German is applied", i18n.language == "de" and TranslationServer.get_locale().begins_with("de"))
	_check("the menu reads German", tr("Scenarios") == "Szenarien" and tr("Games") == "Spiele", tr("Scenarios"))
	var fresh := ["War weariness:", "exhausted", "war-weary", "strained", "uneasy", "A smoother globe", "Peace, weariness and the phone", "Turn and tilt the map", "Zoom in and out", "Spies with a reason"]
	var untranslated := fresh.filter(func(value: String) -> bool: return tr(value) == value)
	_check("the newest strings read German from the language pack", untranslated.is_empty(), ", ".join(PackedStringArray(untranslated)))
	var reply: Dictionary = await main.engine.request("shell.language.check", {"code": "de", "samples": SAMPLES})
	var expected: Array = reply.get("result", {}).get("results", [])
	var differ: PackedStringArray = []
	for index in range(SAMPLES.size()):
		var native: Variant = i18n.book.translate(SAMPLES[index])
		var reference: Variant = expected[index] if index < expected.size() else null
		if str(native) != str(reference):
			differ.append("%s: native=%s js=%s" % [SAMPLES[index], str(native), str(reference)])
		else:
			_say("  de %s -> %s" % [SAMPLES[index], str(native)])
	_check("the native phrase book matches the JS phrase book (German)", differ.is_empty(), " | ".join(differ))
	await _shoot("s-20-menu-german-scenarios")
	main._call(main.menu, "_show_page", ["games"])
	await _wait(0.6)
	await _shoot("s-21-menu-german-games")
	shell.open_history()
	await _wait(1.6)
	await _shoot("s-22-history-german")
	shell.close_history()
	await _frames(3)
	switching = Time.get_ticks_msec()
	await i18n.set_language("ar")
	_say("Arabic applied in %d ms" % (Time.get_ticks_msec() - switching))
	await _wait(1.0)
	_check("Arabic is applied right to left", i18n.language == "ar" and i18n.rtl)
	var reply_ar: Dictionary = await main.engine.request("shell.language.check", {"code": "ar", "samples": SAMPLES})
	var expected_ar: Array = reply_ar.get("result", {}).get("results", [])
	var differ_ar: PackedStringArray = []
	for index in range(SAMPLES.size()):
		var native: Variant = i18n.book.translate(SAMPLES[index])
		var reference: Variant = expected_ar[index] if index < expected_ar.size() else null
		if str(native) != str(reference):
			differ_ar.append("%s: native=%s js=%s" % [SAMPLES[index], str(native), str(reference)])
	_check("the native phrase book matches the JS phrase book (Arabic)", differ_ar.is_empty(), " | ".join(differ_ar))
	await _shoot("s-23-menu-arabic-games")
	main._call(main.menu, "_show_page", ["scenarios"])
	await _wait(0.6)
	await _shoot("s-24-menu-arabic-scenarios")
	shell.startup.show_startup()
	await _wait(1.2)
	await _shoot("s-25-startup-arabic")
	shell.startup.finish()
	await i18n.set_language("en")
	await _wait(0.6)
	_check("English is restored", i18n.language == "en" and tr("Scenarios") == "Scenarios" and not i18n.rtl)
	main._call(main.menu, "_show_page", ["games"])
	await _wait(0.4)
	await _shoot("s-26-menu-english-again")


func _parts() -> void:
	var hotkeys: Hotkeys = main.hotkeys
	var holder := Control.new()
	holder.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	main.shell.overlay.add_child(holder)
	var shade := ColorRect.new()
	shade.color = UI.PAGE
	shade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	holder.add_child(shade)
	var page := HBoxContainer.new()
	page.position = Vector2(40, 40)
	page.add_theme_constant_override("separation", 16)
	for card in MenuSkeleton.cards("game", 2, 305.0) + MenuSkeleton.cards("scenario", 2, 305.0):
		page.add_child(card)
	holder.add_child(page)
	var community := MenuSkeleton.community(4, true)
	community.position = Vector2(40, 470)
	community.custom_minimum_size.x = 1360
	holder.add_child(community)
	await _wait(0.9)
	await _shoot("s-30-skeletons")
	holder.queue_free()
	await _frames(2)
	var lobby_holder := Control.new()
	lobby_holder.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	lobby_holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	main.shell.overlay.add_child(lobby_holder)
	var lobby_shade := ColorRect.new()
	lobby_shade.color = UI.PAGE
	lobby_shade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	lobby_holder.add_child(lobby_shade)
	var lobbies := MenuSkeleton.lobbies()
	lobbies.position = Vector2(40, 40)
	lobbies.custom_minimum_size.x = 992
	lobby_holder.add_child(lobbies)
	var notices := ShellNotices.new()
	lobby_holder.add_child(notices)
	notices.setup(main.engine)
	await _wait(0.8)
	notices.borders.show_notice()
	notices.fallback.show_message("gemini-3.7-flash (Main Google) has used today's allowance. Now using gemini-3.6-flash (Main Google).")
	await _frames(2)
	notices.rating.enabled = true
	notices.rating.show_for("record-1", "jumpForward")
	var strip := StorageProblemNotice.new("Could not load your conversations.", "Nothing new is saved until they load.")
	strip.position = Vector2(1060, 300)
	strip.custom_minimum_size.x = 360
	lobby_holder.add_child(strip)
	await _wait(0.8)
	await _shoot("s-31-lobbies-and-notices")
	_check("the fallback notice holds its message", notices.fallback.messages().size() == 1)
	notices.fallback._remove(1)
	notices.agent._take({"kinds": ["advisor", "diplomacy"], "canPassOn": true})
	await _wait(0.3)
	await _shoot("s-32-agent-waiting")
	notices.agent._take({"kinds": [], "canPassOn": false})
	await _wait(0.3)
	await _shoot("s-33-borders-fallback")
	lobby_holder.queue_free()
	await _frames(2)
	var before := root.content_scale_factor
	var press := InputEventKey.new()
	press.keycode = KEY_EQUAL
	press.ctrl_pressed = true
	press.pressed = true
	Input.parse_input_event(press)
	await _frames(3)
	_check("Ctrl+= zooms in one step", is_equal_approx(root.content_scale_factor, pow(1.2, 0.5)), str(root.content_scale_factor))
	var steps := [[KEY_EQUAL, false, 1.0], [KEY_EQUAL, true, 1.5], [KEY_KP_ADD, false, 2.0], [KEY_MINUS, false, 1.5], [KEY_KP_SUBTRACT, false, 1.0]]
	var landed: Array = []
	for step in steps:
		var hit := InputEventKey.new()
		hit.keycode = step[0]
		hit.ctrl_pressed = true
		hit.shift_pressed = step[1]
		hit.pressed = true
		Input.parse_input_event(hit)
		await _frames(2)
		landed.append(hotkeys.zoom_level)
	_check("Ctrl with = or +, main row or keypad, zooms in; with - it zooms out; half a level a press", landed == steps.map(func(step: Array) -> float: return float(step[2])), str(landed))
	for i in range(14):
		hotkeys.set_zoom(hotkeys.zoom_level + Hotkeys.ZOOM_STEP, false)
	var most := hotkeys.zoom_level
	for i in range(20):
		hotkeys.set_zoom(hotkeys.zoom_level - Hotkeys.ZOOM_STEP, false)
	_check("the zoom is held between -3 and 4 levels, as the desktop app's", is_equal_approx(most, 4.0) and is_equal_approx(hotkeys.zoom_level, -3.0), "%.1f to %.1f" % [hotkeys.zoom_level, most])
	var reset := InputEventKey.new()
	reset.keycode = KEY_0
	reset.ctrl_pressed = true
	reset.pressed = true
	Input.parse_input_event(reset)
	await _frames(3)
	_check("Ctrl+0 resets the zoom", is_equal_approx(root.content_scale_factor, 1.0) and is_equal_approx(before, 1.0), str(root.content_scale_factor))
	var escapes := [0]
	hotkeys.escape_pressed.connect(func() -> void: escapes[0] += 1)
	await _key(KEY_ESCAPE)
	_check("Escape is announced", int(escapes[0]) == 1)


func _boot_door(shell: ShellBoot) -> void:
	var door := shell.door
	if door == null:
		return
	await _wait(10.25)
	await _shoot("s-03-door-shudder")
	await _wait(0.6)
	_check("the door shuddered with its rattle", played.has("rattle"), ", ".join(played))
	if not is_instance_valid(door) or door.stage != "closed":
		_check("the door waited shut for its click", false)
		return
	var centre := root.get_viewport().get_visible_rect().size * 0.5
	await _click(centre)
	var clicked := Time.get_ticks_msec()
	_check("a click on the wheel starts the spin", is_instance_valid(door) and door.stage == "spinning", door.stage if is_instance_valid(door) else "gone")
	await _wait(0.7)
	await _shoot("s-04-door-spin")
	await _until(func() -> bool: return Time.get_ticks_msec() - clicked >= 1700, 3.0)
	await _shoot("s-05-door-bolts")
	await _until(func() -> bool: return Time.get_ticks_msec() - clicked >= 2450, 3.0)
	await _shoot("s-06-door-opening-30")
	_check("the notice is mounted as the leaves part", shell.notice != null and is_instance_valid(shell.notice))
	await _until(func() -> bool: return Time.get_ticks_msec() - clicked >= 3050, 3.0)
	await _shoot("s-07-door-opening-60")
	await _until(func() -> bool: return shell.door == null, 6.0)
	_check("the door is gone after opening", shell.door == null and shell.door_state == "open")
	for name in ["spin", "unlock", "open"]:
		_check("sound " + name + " played", played.has(name), ", ".join(played))
	var state: Dictionary = await main.engine.request("shell.state")
	var remembered: Dictionary = state.get("result", {})
	_check("the door's build is remembered once it opened", not str(remembered.get("doorBuild", "")).is_empty(), str(remembered))


func _notice_and_history(shell: ShellBoot) -> void:
	if shell.notice == null or not is_instance_valid(shell.notice):
		_check("an update notice is shown behind the door", false)
		return
	var notice := shell.notice
	await _wait(1.2)
	var pages := notice.page_count()
	_check("the notice pages through the updates", pages >= 2, str(pages))
	var shown_ids := _update_ids(notice._pages.map(func(page: Dictionary) -> Dictionary: return page.get("update", {})))
	_check("a first opening's notice starts on the newest update", not shown_ids.is_empty() and shown_ids[0] == NEWEST_UPDATES[0], ", ".join(PackedStringArray(shown_ids)))
	var state: Dictionary = await main.engine.request("shell.state")
	var remembered: Dictionary = state.get("result", {})
	_check("the newest update is remembered the moment it shows", not str(remembered.get("seen", "")).is_empty(), str(remembered))
	await _shoot("s-08-notice-page-1")
	for index in range(1, mini(pages, 4)):
		notice.show_page(index)
		await _wait(1.6)
		await _shoot("s-09-notice-page-%d" % (index + 1))
	await _key(KEY_ESCAPE)
	await _frames(4)
	_check("Escape closes the notice onto the menu", shell.notice == null and main.menu.visible)
	await _shoot("s-10-menu")
	await _missed_updates(shell)
	shell.open_history()
	await _wait(1.5)
	_check("the update history opens", shell.history != null and is_instance_valid(shell.history))
	await _shoot("s-11-history")
	if shell.history:
		var history_ids := _update_ids(shell.history._updates)
		_check("the update history lists the newest updates", (NEWEST_UPDATES + ["2026-10-peace-and-weariness"]).all(func(id: String) -> bool: return history_ids.has(id)), ", ".join(PackedStringArray(history_ids.slice(0, 6))))
		shell.history.view("2026-10-peace-and-weariness")
		await _wait(1.6)
		var viewed := _texts(shell.history.viewing(), PackedStringArray()) if shell.history.viewing() else PackedStringArray()
		_check("the history opens the peace and weariness notice", Array(viewed).any(func(value: String) -> bool: return value.contains("Peace, weariness and the phone")) and Array(viewed).any(func(value: String) -> bool: return value.contains("Listening in on a region now opens on its country's feed first.")))
		await _shoot("s-12b-history-peace")
		await _key(KEY_ESCAPE)
		await _frames(4)
		shell.history.view("2026-10-war-and-peace")
		await _wait(1.6)
		await _shoot("s-12-history-view")
		await _key(KEY_ESCAPE)
		await _frames(4)
		await _key(KEY_ESCAPE)
		await _frames(4)
	_check("Escape closes the viewed notice, then the history", shell.history == null)


func _loading(shell: ShellBoot) -> void:
	await main._start_scenario("default")
	main.picker._choose("France")
	var begun := Time.get_ticks_msec()
	main._on_country_chosen("France", "medium")
	await _frames(3)
	_check("the cover loading screen is up from the press", shell.loading.visible and shell.loading.is_open())
	_check("it starts on reading the world", shell.loading.phase == "world", shell.loading.phase)
	await _shoot("s-13-loading-world")
	await _until(func() -> bool: return shell.loading.phase != "world" or not shell.loading.is_open(), 5.0)
	_say("loading phase %s after %d ms" % [shell.loading.phase, Time.get_ticks_msec() - begun])
	await _shoot("s-14-loading-" + shell.loading.phase)
	await _until(func() -> bool: return not shell.loading.is_open(), 70.0)
	_say("loading finished after %d ms" % (Time.get_ticks_msec() - begun))
	await _until(func() -> bool: return not shell.loading.visible, 2.0)
	_check("the loading screen fades off onto the game", not shell.loading.visible and main.hud.visible)
	await _wait(0.5)
	await _shoot("s-15-game")


func _finish() -> void:
	_say("sounds: " + ", ".join(played))
	_say("failures: %d %s" % [failures.size(), ", ".join(failures)])
	main.engine.stop()
	for i in range(2):
		await process_frame
	quit(0 if failures.is_empty() else 1)
