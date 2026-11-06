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
	while not main.menu.visible:
		if Time.get_ticks_msec() - started > 90000:
			_say("FAIL the menu never appeared")
			_finish(1)
			return
		await process_frame
	_say("menu ready")
	await _clear_shell()
	var i18n: I18n = main.i18n
	await _until(func() -> bool: return i18n.active, 10.0)

	var reply: Dictionary = await main.engine.request("translation.languages")
	var options: Array = reply.get("result", {}).get("options", []) if reply.get("ok", false) else []
	var codes: Array = options.map(func(entry: Dictionary) -> String: return str(entry.get("code", "")))
	_check("the interface is offered in the 28 languages a pack or a model covers", codes.size() == 28, str(codes.size()))
	_check("Czech, Finnish, Danish, Hungarian and Romanian are offered through their models", ["cs", "fi", "da", "hu", "ro"].all(func(code: String) -> bool: return codes.has(code)))
	_check("languages with neither a pack nor a model are not offered for the interface", not codes.has("sw") and not codes.has("he") and not codes.has("el"))
	var values: Dictionary = (await main.engine.request("settings.values")).get("result", {})
	var settings := SettingsWorkspace.new()
	settings._values = values
	var listed: Array = settings._language_options("", "en", true)[0]
	var labels: Array = listed.map(func(pair: Array) -> String: return str(pair[1]))
	_check("Settings' UI language list holds those 28, with no ✓ marks", listed.size() == 28 and labels.has("Czech — Čeština") and labels.has("Finnish — Suomi") and not labels.any(func(text: String) -> bool: return text.contains("✓")), "%d %s" % [listed.size(), ", ".join(PackedStringArray(labels.slice(0, 6)))])
	_check("the AI chat language list keeps all fifty", (settings._language_options("", "en", false)[0] as Array).size() == 50)
	settings.free()

	var offer: Dictionary = (await main.engine.request("translation.offer", {"code": "cs"})).get("result", {})
	_check("Czech's model is Opus-MT's 117 MB download", bool(offer.get("has", false)) and str(offer.get("size", "")) == "117 MB" and str(offer.get("choice", "")) == "", JSON.stringify(offer))

	var switching: Array = [""]
	var run_switch := func(code: String) -> void:
		switching[0] = await i18n.switch_language(code)
	run_switch.call("cs")
	_check("choosing Czech asks for its model first, over the screen", await _until(func() -> bool: return i18n.card_shown(), 10.0))
	_check("the prompt names the language and the size", i18n.card_text() == "Playing in Čeština needs a one-time download of its translation model (117 MB).", i18n.card_text())
	_check("from English it offers Keep English and Download", _find_button(i18n, "Keep English") != null and _find_button(i18n, "Download") != null)
	await _shoot("language-01-czech-prompt")
	_find_button(i18n, "Keep English").pressed.emit()
	await _until(func() -> bool: return not str(switching[0]).is_empty(), 10.0)
	_check("Keep English keeps the game in English and nothing is downloaded", i18n.language == "en" and str(switching[0]) == "en" and not i18n.card_shown())
	offer = (await main.engine.request("translation.offer", {"code": "cs"})).get("result", {})
	_check("the answer is kept on this device", str(offer.get("choice", "")) == "no" and not bool(offer.get("cached", true)), JSON.stringify(offer))

	switching[0] = ""
	run_switch.call("fi")
	await _until(func() -> bool: return i18n.card_shown(), 10.0)
	_check("Finnish asks the same way", i18n.card_text() == "Playing in Suomi needs a one-time download of its translation model (119 MB).", i18n.card_text())
	_find_button(i18n, "Download").pressed.emit()
	_check("Download shows its progress in the card", await _until(func() -> bool: return i18n.card_text().begins_with("Downloading the translation model… ") and not i18n.card_text().ends_with(" 0%"), 10.0), i18n.card_text())
	await _shoot("language-02-finnish-downloading")
	_check("once downloaded the game is in Finnish", await _until(func() -> bool: return str(switching[0]) == "fi", 20.0) and i18n.language == "fi" and not i18n.card_shown(), "%s %s" % [switching[0], i18n.language])
	_check("the model is in use for Finnish", i18n.model_in_use() and bool(i18n.offer.get("cached", false)))
	var unpacked := "Open the reserve depots"
	TranslationServer.translate(unpacked)
	i18n.label_name("Kingdom of Bavaria")
	_check("the interface Finnish has no pack for is translated on the device", await _until(func() -> bool: return i18n.book.translate(unpacked) == "FI·" + unpacked, 20.0), str(i18n.book.translate(unpacked)))
	_check("a scenario's names are translated on the device", await _until(func() -> bool: return I18n.lookup("Kingdom of Bavaria") == "FI·Kingdom of Bavaria", 20.0), I18n.lookup("Kingdom of Bavaria"))
	var placed: Dictionary = (await main.engine.request("shell.language.translate", {"code": "fi", "strings": ["It has 3 regions.", "{{count}} armies"]})).get("result", {})
	_check("numbers and slots survive the model's answer", JSON.stringify(placed.get("pairs", [])) == JSON.stringify([["It has 3 regions.", "FI·It has 3 regions."], ["{{count}} armies", "FI·{{count}} armies"]]), JSON.stringify(placed))
	await _shoot("language-03-finnish")

	switching[0] = ""
	run_switch.call("en")
	await _until(func() -> bool: return not str(switching[0]).is_empty(), 10.0)
	_check("back to English needs no prompt", i18n.language == "en" and not i18n.card_shown())

	await i18n.set_language("da")
	i18n.active = false
	var kept: Array = [false]
	var boot := func() -> void:
		await i18n.activate()
		kept[0] = true
	boot.call()
	_check("a stored language whose model was never accepted asks at start", await _until(func() -> bool: return i18n.card_shown(), 10.0), i18n.card_text())
	_check("in its own words where it has no pack, English", i18n.card_text() == "Playing in Dansk needs a one-time download of its translation model (113 MB).", i18n.card_text())
	_find_button(i18n, "Keep English").pressed.emit()
	await _until(func() -> bool: return bool(kept[0]), 10.0)
	_check("declined at start, the game is in English", i18n.language == "en", i18n.language)

	_say("%d failures" % failures.size())
	_finish(0 if failures.is_empty() else 1)


func _finish(code: int) -> void:
	main.engine.stop()
	await _frames(2)
	quit(code)
