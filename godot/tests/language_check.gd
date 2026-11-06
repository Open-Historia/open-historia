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
	root.mouse_passthrough = true
	root.add_child(main)
	_run.call_deferred()


func _say(text: String) -> void:
	print("[language %6d ms] %s" % [Time.get_ticks_msec() - started, text])


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
	await _frames(4)
	await RenderingServer.frame_post_draw
	if shots.is_empty():
		return
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(name + ".png"))
	_say("screenshot " + name)


func _find_button(node: Node, text: String) -> Button:
	if node is Button and (node as Button).text == text and (node as Button).is_visible_in_tree():
		return node as Button
	for child in node.get_children():
		var found := _find_button(child, text)
		if found:
			return found
	return null


func _press(node: Node, text: String) -> void:
	var button := _find_button(node, text)
	if button:
		button.pressed.emit()


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
		for i in range(5):
			await process_frame
	if shell.notice != null and is_instance_valid(shell.notice):
		shell.notice.closed.emit()
	for i in range(3):
		await process_frame


func _run() -> void:
	await process_frame
	while not main.menu.visible:
		if Time.get_ticks_msec() - started > 90000:
			_say("FAIL the menu never appeared")
			_finish(1)
			return
		await process_frame
	_say("menu ready")
	await _clear_shell()
	var i18n: I18n = main.i18n
	_check("the translator starts once the game is up", await _until(func() -> bool: return i18n.active, 180.0))

	var reply: Dictionary = await main.engine.request("translation.languages")
	var options: Array = reply.get("result", {}).get("options", []) if reply.get("ok", false) else []
	var codes: Array = options.map(func(entry: Dictionary) -> String: return str(entry.get("code", "")))
	_check("the interface is offered in the 36 languages a pack or a model covers", codes.size() == 36, str(codes.size()))
	_check("Czech, Finnish, Danish, Hungarian and Romanian are offered through their models", ["cs", "fi", "da", "hu", "ro"].all(func(code: String) -> bool: return codes.has(code)))
	_check("Latvian, Lithuanian, Slovak, Estonian, Greek, Hebrew, Irish and Maltese are offered through their models", ["lv", "lt", "sk", "et", "el", "he", "ga", "mt"].all(func(code: String) -> bool: return codes.has(code)), " ".join(PackedStringArray(codes)))
	_check("they come last, after the fifty, in beta's order", " ".join(PackedStringArray(codes.slice(30))) == "lv lt sk et ga mt", " ".join(PackedStringArray(codes.slice(30))))
	_check("languages with neither a pack nor a model are not offered for the interface", not codes.has("sw") and not codes.has("am") and not codes.has("yo"))
	var sizes := {}
	for code in ["lv", "lt", "sk", "et", "el", "he", "ga", "mt", "sv"]:
		var each: Dictionary = (await main.engine.request("translation.offer", {"code": code})).get("result", {})
		sizes[code] = "%s %s%s%s" % [str(each.get("native", "")), str(each.get("size", "")), " rtl" if bool(each.get("rtl", false)) else "", " packed" if bool(each.get("packed", false)) else ""]
	_check("each new model is its converted Opus-MT download, at beta's size", JSON.stringify(sizes) == JSON.stringify({"lv": "Latviešu 139 MB", "lt": "Lietuvių 139 MB", "sk": "Slovenčina 140 MB", "et": "Eesti 138 MB", "el": "Ελληνικά 148 MB", "he": "עברית 149 MB rtl", "ga": "Gaeilge 135 MB", "mt": "Malti 134 MB", "sv": "Svenska 135 MB packed"}), JSON.stringify(sizes))
	var heard := {}
	for code in ["lv", "lt", "sk", "et", "mt", "el", "he", "ga"]:
		heard[code] = str((await main.engine.request("speech.engine", {"language": code})).get("result", {}).get("onDevice", ""))
	_check("the microphone's on-device model hears every new language but Irish", ["lv", "lt", "sk", "et", "mt", "el", "he"].all(func(code: String) -> bool: return heard[code] == "whisper") and heard["ga"] == "", JSON.stringify(heard))
	var codes_greeted: Array = FirstSetup.GREETINGS.map(func(entry: Array) -> String: return str(entry[0]))
	_check("the first-time setup greets in the eight new languages too", codes_greeted.size() == 36 and " ".join(PackedStringArray(codes_greeted.slice(28))) == "el he sk lt lv et ga mt", " ".join(PackedStringArray(codes_greeted)))
	var setup := FirstSetup.new()
	var hebrew: VBoxContainer = setup._greeting_words(codes_greeted.find("he"))
	var latvian: VBoxContainer = setup._greeting_words(codes_greeted.find("lv"))
	var hebrew_hello := hebrew.get_child(0) as Label
	_check("Hebrew's greeting reads right to left, Latvian's left to right", hebrew_hello.text == "שלום" and hebrew_hello.text_direction == Control.TEXT_DIRECTION_RTL and (hebrew.get_child(1) as Label).text == "ברוכים הבאים" and (latvian.get_child(0) as Label).text_direction == Control.TEXT_DIRECTION_LTR and (latvian.get_child(1) as Label).text == "Laipni lūdzam")
	hebrew.free()
	latvian.free()
	setup.free()
	var values: Dictionary = (await main.engine.request("settings.values")).get("result", {})
	var settings := SettingsWorkspace.new()
	settings._values = values
	var listed: Array = settings._language_options("", "en", true)[0]
	var labels: Array = listed.map(func(pair: Array) -> String: return str(pair[1]))
	_check("Settings' UI language list holds those 36, with no ✓ marks", listed.size() == 36 and labels.has("Latvian — Latviešu") and labels.has("Hebrew — עברית") and labels.has("Czech — Čeština") and labels.has("Finnish — Suomi") and not labels.any(func(text: String) -> bool: return text.contains("✓")), "%d %s" % [listed.size(), ", ".join(PackedStringArray(labels.slice(0, 6)))])
	_check("the AI chat language list keeps all fifty and the six more", (settings._language_options("", "en", false)[0] as Array).size() == 56)
	settings.free()

	var offer: Dictionary = (await main.engine.request("translation.offer", {"code": "cs"})).get("result", {})
	_check("Czech's model is Opus-MT's 117 MB download", bool(offer.get("has", false)) and str(offer.get("size", "")) == "117 MB" and str(offer.get("choice", "")) == "", JSON.stringify(offer))

	var switching: Array = [""]
	var run_switch := func(code: String) -> void:
		switching[0] = await i18n.switch_language(code)
	run_switch.call("cs")
	_check("choosing Czech asks for its model first, over the screen", await _until(func() -> bool: return i18n.card_shown(), 30.0))
	_check("the prompt names the language and the size", i18n.card_text() == "Playing in Čeština needs a one-time download of its translation model (117 MB).", i18n.card_text())
	_check("from English it offers Keep English and Download", _find_button(i18n, "Keep English") != null and _find_button(i18n, "Download") != null)
	await _shoot("language-01-czech-prompt")
	_press(i18n, "Keep English")
	await _until(func() -> bool: return not str(switching[0]).is_empty(), 10.0)
	_check("Keep English keeps the game in English and nothing is downloaded", i18n.language == "en" and str(switching[0]) == "en" and not i18n.card_shown())
	offer = (await main.engine.request("translation.offer", {"code": "cs"})).get("result", {})
	_check("the answer is kept on this device", str(offer.get("choice", "")) == "no" and not bool(offer.get("cached", true)), JSON.stringify(offer))

	switching[0] = ""
	run_switch.call("fi")
	await _until(func() -> bool: return i18n.card_shown(), 10.0)
	_check("Finnish asks the same way", i18n.card_text() == "Playing in Suomi needs a one-time download of its translation model (119 MB).", i18n.card_text())
	_press(i18n, "Download")
	_check("Download shows its progress in the card", await _until(func() -> bool: return i18n.card_text().begins_with("Downloading the translation model… ") and not i18n.card_text().ends_with(" 0%"), 10.0), i18n.card_text())
	await _shoot("language-02-finnish-downloading")
	_check("once downloaded the game is in Finnish", await _until(func() -> bool: return str(switching[0]) == "fi", 20.0) and i18n.language == "fi" and not i18n.card_shown(), "%s %s" % [switching[0], i18n.language])
	_check("the model is in use for Finnish", i18n.model_in_use() and bool(i18n.offer.get("cached", false)))
	var unpacked := "Open the reserve depots"
	TranslationServer.translate(unpacked)
	i18n.label_name("Kingdom of Bavaria")
	_check("the interface Finnish has no pack for is translated on the device", await _until(func() -> bool: return i18n.book.translate(unpacked) == "FI·" + unpacked, 120.0), str(i18n.book.translate(unpacked)))
	_check("a scenario's names are translated on the device", await _until(func() -> bool: return I18n.lookup("Kingdom of Bavaria") == "FI·Kingdom of Bavaria", 120.0), I18n.lookup("Kingdom of Bavaria"))
	var placed: Dictionary = (await main.engine.request("shell.language.translate", {"code": "fi", "strings": ["It has 3 regions.", "{{count}} armies"]})).get("result", {})
	_check("numbers and slots survive the model's answer", JSON.stringify(placed.get("pairs", [])) == JSON.stringify([["It has 3 regions.", "FI·It has 3 regions."], ["{{count}} armies", "FI·{{count}} armies"]]), JSON.stringify(placed))
	await _shoot("language-03-finnish")
	await _check_ai_translation(i18n, unpacked)
	await _check_scenario_pack(i18n)

	switching[0] = ""
	run_switch.call("en")
	await _until(func() -> bool: return not str(switching[0]).is_empty(), 10.0)
	_check("back to English needs no prompt", i18n.language == "en" and not i18n.card_shown())

	switching[0] = ""
	run_switch.call("he")
	await _until(func() -> bool: return i18n.card_shown(), 10.0)
	_check("Hebrew asks for its model the same way", i18n.card_text() == "Playing in עברית needs a one-time download of its translation model (149 MB).", i18n.card_text())
	await _shoot("language-04-hebrew-prompt")
	_press(i18n, "Download")
	_check("once downloaded the game is in Hebrew", await _until(func() -> bool: return str(switching[0]) == "he", 20.0) and i18n.language == "he", "%s %s" % [switching[0], i18n.language])
	await _frames(3)
	var flipped := _rtl_rows(main.menu)
	_check("Hebrew is laid out right to left, as Arabic is", i18n.rtl and flipped > 0, "%d rows flipped" % flipped)
	TranslationServer.translate(unpacked)
	_check("Hebrew's own model translates on the device", await _until(func() -> bool: return i18n.book.translate(unpacked) == "HE·" + unpacked, 120.0), str(i18n.book.translate(unpacked)))
	await _shoot("language-05-hebrew")
	switching[0] = ""
	run_switch.call("en")
	await _until(func() -> bool: return not str(switching[0]).is_empty(), 10.0)
	_check("back in English the layout is left to right again", i18n.language == "en" and not i18n.rtl and _rtl_rows(main.menu) == 0)

	await i18n.set_language("da")
	i18n.active = false
	var kept: Array = [false]
	var boot := func() -> void:
		await i18n.activate()
		kept[0] = true
	boot.call()
	_check("a stored language whose model was never accepted asks at start", await _until(func() -> bool: return i18n.card_shown(), 10.0), i18n.card_text())
	_check("in its own words where it has no pack, English", i18n.card_text() == "Playing in Dansk needs a one-time download of its translation model (113 MB).", i18n.card_text())
	_press(i18n, "Keep English")
	await _until(func() -> bool: return bool(kept[0]), 10.0)
	_check("declined at start, the game is in English", i18n.language == "en", i18n.language)

	_say("%d failures" % failures.size())
	_finish(0 if failures.is_empty() else 1)


func _find_label(node: Node, text: String) -> Label:
	if node is Label and (node as Label).text == text and (node as Label).is_visible_in_tree():
		return node as Label
	for child in node.get_children():
		var found := _find_label(child, text)
		if found:
			return found
	return null


func _open_general(engine: EngineLink) -> SettingsWorkspace:
	var workspace := SettingsWorkspace.new()
	workspace.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var layer := CanvasLayer.new()
	layer.layer = 90
	root.add_child(layer)
	layer.add_child(workspace)
	workspace.setup(engine, {"scope": "menu", "section": "general"})
	await workspace.open("general")
	await _frames(6)
	return workspace


func _close_general(workspace: SettingsWorkspace) -> void:
	var layer := workspace.get_parent()
	layer.queue_free()
	await _frames(2)


func _check_ai_translation(i18n: I18n, unpacked: String) -> void:
	var values: Dictionary = (await main.engine.request("settings.values")).get("result", {})
	_check("Translate with my AI is offered in a language with a downloaded model", bool(values.get("aiTranslationOffered", false)) and not bool((values.get("flags", {}) as Dictionary).get("i18n_translate_with_ai", true)), JSON.stringify(values.get("aiTranslationOffered")))
	var workspace := await _open_general(main.engine)
	var title := _find_label(workspace, "Translate with my AI")
	var helper := _find_label(workspace, "Uses your AI provider instead of the translation model, and spends its requests.")
	_check("Settings → General → Language has the switch, with beta's line under it", title != null and helper != null and helper.get_global_rect().position.y > title.get_global_rect().position.y)
	await _shoot("language-06-translate-with-my-ai")
	await _close_general(workspace)
	await main.engine.request("settings.flag", {"key": "i18n_translate_with_ai", "value": true})
	await i18n.follow_ai_switch()
	_check("turned on, the player's AI translates for Finnish", i18n.ai_in_use() and i18n.ai_shown)
	TranslationServer.translate(unpacked)
	_check("what the model translated is asked of the AI again as it is shown", await _until(func() -> bool: return i18n.book.translate(unpacked) == "AI·" + unpacked, 60.0), str(i18n.book.translate(unpacked)))
	i18n.label_name("Duchy of Lower Silesia")
	_check("a scenario's names go to the AI, not the model", await _until(func() -> bool: return I18n.lookup("Duchy of Lower Silesia") == "AI·Duchy of Lower Silesia", 60.0), I18n.lookup("Duchy of Lower Silesia"))
	var stored: Dictionary = (await main.engine.request("shell.language.ai", {"code": "fi"})).get("result", {})
	_check("the AI's translations are kept on this device apart from the model's", str((stored.get("entries", {}) as Dictionary).get(unpacked, "")) == "AI·" + unpacked, JSON.stringify(stored.get("entries", {})))
	var broken := "[stand-in fails] Hold the line"
	i18n.label_name(broken)
	_check("a request that fails leaves the batch to the model", await _until(func() -> bool: return I18n.lookup(broken) == "FI·" + broken, 60.0), I18n.lookup(broken))
	_check("and the pill says so, once a session", i18n._ai_notice_shown and I18n.AI_FAILED_TEXT == "Your AI could not translate, so the translation model on this device did.")
	await main.engine.request("settings.flag", {"key": "i18n_translate_with_ai", "value": false})
	await i18n.follow_ai_switch()
	_check("turned off, the model's translations are back at once", not i18n.ai_shown and i18n.book.translate(unpacked) == "FI·" + unpacked, str(i18n.book.translate(unpacked)))


func _check_scenario_pack(i18n: I18n) -> void:
	var created: Dictionary = await main.engine.request("editor.create")
	var opened: Dictionary = created.get("result", {}) if created.get("ok", false) and created.get("result") is Dictionary else {}
	var id := str(opened.get("id", ""))
	_check("a scenario is made for the pack check", not id.is_empty(), JSON.stringify(created).left(200))
	if id.is_empty():
		return
	await main.engine.request("scenarioLanguages.open", {"id": id})
	var view: Dictionary = (await main.engine.request("scenarioLanguages.view", {"id": id, "form": {"name": "New Scenario"}, "codes": ["fi", "de"], "languages": {}})).get("result", {})
	_check("the Languages tab plans its requests before Generate", int(view.get("plan", 0)) >= 1 and (view.get("rows", []) as Array).size() == 2, JSON.stringify(view).left(300))
	var made: Dictionary = (await main.engine.request("scenarioLanguages.generate", {"id": id, "form": {"name": "New Scenario"}, "codes": ["fi"], "languages": {}})).get("result", {})
	var packs: Dictionary = made.get("packs", {}) if made.get("packs") is Dictionary else {}
	var fi: Dictionary = packs.get("fi", {}) if packs.get("fi") is Dictionary else {}
	_check("Generate asks the author's AI and fills the pack", str(fi.get("New Scenario", "")) == "FI~New Scenario" and str(made.get("failed", "")).is_empty(), JSON.stringify(made).left(300))
	var form: Dictionary = (opened.get("form", {}) as Dictionary).duplicate(true) if opened.get("form") is Dictionary else {}
	form["languages"] = packs
	var saved: Dictionary = await main.engine.request("editor.save", {"kind": "scenario", "id": id, "form": form, "savedForm": opened.get("form", {})})
	_check("the packs are saved with the scenario", saved.get("ok", false), str(saved.get("error", "")))
	var read: Dictionary = (await main.engine.request("shell.language.scenarioPack", {"code": "fi", "id": id})).get("result", {})
	_check("a game reads one language's pack from the library", str((read.get("entries", {}) as Dictionary).get("New Scenario", "")) == "FI~New Scenario", JSON.stringify(read).left(300))
	i18n.set_scenario_pack("fi", read.get("entries", {}))
	_check("the scenario's own pack comes first, over the model's", I18n.lookup("New Scenario") == "FI~New Scenario", I18n.lookup("New Scenario"))
	i18n.set_scenario_pack("", {})
	_check("and goes when the scenario is left", I18n.lookup("New Scenario") != "FI~New Scenario", I18n.lookup("New Scenario"))


func _rtl_rows(node: Node) -> int:
	var count := 0
	if node is Control and (node as Control).layout_direction == Control.LAYOUT_DIRECTION_RTL:
		count += 1
	for child in node.get_children():
		count += _rtl_rows(child)
	return count


func _finish(code: int) -> void:
	main.engine.stop()
	await _frames(2)
	quit(code)
