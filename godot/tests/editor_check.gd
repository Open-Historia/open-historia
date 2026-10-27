extends SceneTree

var main: Node
var shots := ""
var out_dir := ""
var started := 0
var failures := 0
var editor: ScenarioEditor
var events := {}


func _initialize() -> void:
	shots = OS.get_environment("OH_SHOTS")
	out_dir = OS.get_environment("OH_EDITOR_OUT")
	if out_dir.is_empty():
		out_dir = OS.get_environment("OH_NATIVE_ROOT").path_join("editor-out")
	DirAccess.make_dir_recursive_absolute(out_dir)
	started = Time.get_ticks_msec()
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.add_child(main)
	_run.call_deferred()


func _say(text: String) -> void:
	print("[editor_check %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _check(ok: bool, text: String) -> void:
	if ok:
		_say("ok   " + text)
	else:
		failures += 1
		_say("FAIL " + text)


func _frames(count: int) -> void:
	for i in range(count):
		await process_frame


func _wait(seconds: float) -> void:
	await create_timer(seconds).timeout


func _shoot(name: String) -> void:
	await _frames(6)
	await RenderingServer.frame_post_draw
	if shots.is_empty():
		return
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(name + ".png"))
	_say("screenshot " + name)


func _find_all(node: Node, test: Callable, out: Array) -> Array:
	if test.call(node):
		out.append(node)
	for child in node.get_children():
		_find_all(child, test, out)
	return out


func _button(node: Node, text: String) -> Button:
	var found := _find_all(node, func(entry: Node) -> bool: return entry is Button and (entry as Button).text == text and (entry as Button).is_visible_in_tree(), [])
	return found[0] if not found.is_empty() else null


func _button_with_label(node: Node, text: String) -> Button:
	var found := _find_all(node, func(entry: Node) -> bool:
		if not entry is Button:
			return false
		var labels := _find_all(entry, func(inner: Node) -> bool: return inner is Label and (inner as Label).text == text, [])
		return not labels.is_empty(), [])
	return found[0] if not found.is_empty() else null


func _label(node: Node, text: String) -> Label:
	var found := _find_all(node, func(entry: Node) -> bool: return entry is Label and (entry as Label).text == text and (entry as Label).is_visible_in_tree(), [])
	return found[0] if not found.is_empty() else null


func _field_input(label_text: String) -> Control:
	var label := _label(editor._content, label_text.to_upper())
	if label == null:
		return null
	var column := label.get_parent()
	for child in column.get_children():
		if child is LineEdit or child is TextEdit or child is ColorPickerButton:
			return child
	return null


func _type(edit: Control, text: String) -> void:
	if edit is LineEdit:
		(edit as LineEdit).text = text
		(edit as LineEdit).text_changed.emit(text)
	elif edit is TextEdit:
		(edit as TextEdit).text = text
		(edit as TextEdit).text_changed.emit()


func _press(button: Button) -> void:
	if button == null:
		return
	button.pressed.emit()


func _answer_soon(yes: bool) -> void:
	for attempt in range(240):
		await process_frame
		var dialogs := _find_all(editor, func(entry: Node) -> bool: return entry is ConfirmationDialog and (entry as ConfirmationDialog).visible, [])
		if not dialogs.is_empty():
			var dialog: ConfirmationDialog = dialogs[0]
			_say("dialog: " + dialog.dialog_text)
			events["last_dialog"] = dialog.dialog_text
			if yes:
				dialog.confirmed.emit()
			else:
				dialog.canceled.emit()
			dialog.hide()
			return


func _until(test: Callable, seconds: float) -> bool:
	var deadline := Time.get_ticks_msec() + int(seconds * 1000.0)
	while Time.get_ticks_msec() < deadline:
		if test.call():
			return true
		await process_frame
	return bool(test.call())


func _clear_shell() -> void:
	var shell: Variant = main.get("shell")
	if not shell is ShellBoot:
		return
	var boot: ShellBoot = shell
	await _until(func() -> bool: return boot.door_state != "deciding", 30.0)
	if boot.door != null and is_instance_valid(boot.door):
		boot.door.opened.emit()
		_say("vault door opened for the test")
	if not boot.notice_updates.is_empty():
		await _until(func() -> bool: return boot.notice != null and is_instance_valid(boot.notice), 5.0)
		await _frames(5)
	if boot.notice != null and is_instance_valid(boot.notice):
		boot.notice.closed.emit()
		_say("update notice closed for the test")
	await _frames(3)


func _details(kind: String, id: String) -> Dictionary:
	var reply: Dictionary = await main.engine.request("editor.details", {"kind": kind, "id": id})
	return reply.get("result", {}) if reply.get("ok", false) else {}


func _run() -> void:
	while not main.menu.visible:
		if Time.get_ticks_msec() - started > 120000:
			_say("FAIL the menu never appeared")
			_finish()
			return
		await process_frame
	_say("menu ready")
	await _clear_shell()
	var mounted: Variant = main.get("editor")
	if mounted is ScenarioEditor:
		editor = mounted
		_say("using the drawer main.gd mounted")
	else:
		editor = ScenarioEditor.new()
		main.ui.add_child(editor)
		editor.setup(main.engine, {"loader": main.menu.loader})
	editor.library_changed.connect(func() -> void: events["library_changed"] = int(events.get("library_changed", 0)) + 1)
	editor.game_deleted.connect(func(id: String) -> void: events["game_deleted"] = id)
	editor.closed.connect(func() -> void: events["closed"] = int(events.get("closed", 0)) + 1)
	await _wait(0.5)
	await _scenario_flow()
	await _create_clone_flow()
	await _game_flow()
	_finish()


func _scenario_flow() -> void:
	await editor.open_scenario("default")
	_check(editor.is_open() and editor.current_kind() == "scenario", "the drawer opened on the built-in scenario")
	var gif := ImageLoader.decode(Marshalls.base64_to_raw("R0lGODdhDAAGAIEAAP8AAAAA/wAAAAAAACwAAAAADAAGAAAIGwABCBwYoKDBgQQNFkQoUOFChg4DMAQQcWLEgAA7"))
	var gif_image: Image = gif.get_image() if gif else null
	_check(gif_image != null and gif_image.get_pixel(1, 1).r > 0.9 and gif_image.get_pixel(10, 4).b > 0.9, "a GIF cover is drawn, not left blank")
	var avif_path := OS.get_user_data_dir().path_join("cover-test.avif")
	var avif_file := FileAccess.open(avif_path, FileAccess.WRITE)
	avif_file.store_buffer(PackedByteArray([0, 0, 0, 28, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0, 0, 0, 0]))
	avif_file.close()
	var avif_reply: Dictionary = await main.engine.request("editor.asset.upload", {"kind": "scenario", "id": "default", "assetKey": "cover", "path": avif_path})
	_check(not avif_reply.get("ok", false) and str(avif_reply.get("error", "")).contains("AVIF"), "an unreadable AVIF cover is refused with a reason (%s)" % str(avif_reply.get("error", "")))
	await _wait(1.0)
	await _shoot("ed-01-overview")
	_check(_label(editor._content, "On its card") != null and _label(editor._content, "Its headline") != null, "the overview shows both cards")
	for key in ["world", "history", "fronts", "politics", "stats", "features", "prompts", "assets", "music", "bundles"]:
		editor._go_section(key)
		await _wait(1.2 if key in ["music", "features"] else 0.6)
		if key == "politics":
			var generation := await _until(func() -> bool: return _button(editor._content, "Generate Political World") != null, 20.0)
			_check(generation, "the Political World panel loaded its generator")
		await _shoot("ed-02-%s" % key)
		_check(editor._header_title.text == str(ScenarioEditor.SECTION_LABELS[key]), "the %s section shows its title" % key)
	editor._go_section("music")
	var listed := await _until(func() -> bool: return _button(editor._content, "Add a track") != null and not (_button(editor._content, "Add a track") as Button).disabled, 20.0)
	if listed:
		_press(_button(editor._content, "Add a track"))
		await _wait(0.6)
		var add := await _until(func() -> bool: return _button(editor._content, "Add") != null, 5.0)
		await _shoot("ed-03-music-picker")
		var music_panel: EditorMusicPanel = null
		for entry in editor._panels:
			if entry.get("panel") is EditorMusicPanel:
				music_panel = entry["panel"]
		var plays := _find_all(editor._content, func(entry: Node) -> bool: return entry is Button and (entry as Button).tooltip_text == "Play a preview", [])
		_check(music_panel != null and not plays.is_empty(), "the picker offers previews")
		if music_panel != null and not plays.is_empty():
			_press(plays[0])
			var playing := await _until(func() -> bool: return music_panel._player.playing or not music_panel._failed_id.is_empty(), 90.0)
			_check(playing and music_panel._player.playing, "a preview plays the track")
			await _shoot("ed-03b-music-preview")
			var stops := _find_all(editor._content, func(entry: Node) -> bool: return entry is Button and (entry as Button).tooltip_text == "Stop the preview", [])
			_check(not stops.is_empty(), "the playing row shows Stop the preview")
			if not stops.is_empty():
				_press(stops[0])
				await _wait(0.3)
				_check(not music_panel._player.playing and music_panel._playing_id.is_empty(), "Stop the preview stops it")
		if add:
			_press(_button(editor._content, "Add"))
			var chosen := await _until(func() -> bool: return editor._form.get("music") is Dictionary, 5.0)
			_check(chosen, "adding a hub track puts it in the form's music")
			await _wait(0.4)
			await _shoot("ed-04-music-chosen")
	else:
		_say("note the hub's music list could not be read; the music picker was not exercised")
	editor._go_section("overview")
	await _wait(0.3)
	var subtitle := _field_input("Subtitle")
	_check(subtitle != null, "the Subtitle field is there")
	_type(subtitle, "Edited in the native editor")
	editor._go_section("world")
	await _wait(0.3)
	var country := _field_input("Player Country")
	_type(country, "Atlantis")
	await _wait(0.3)
	_check(_label(editor._content, "No country or faction by this name is on this map, so the player would start with nothing. Pick one from the list.") != null, "an unknown player country is warned about")
	await _shoot("ed-05-world-warning")
	_type(country, "Fra")
	await _wait(0.3)
	await _shoot("ed-06-country-suggestions")
	var france := _button(editor, "France")
	_press(france)
	await _wait(0.2)
	_check(str(editor._form.get("country", "")) == "France", "picking a suggestion sets the player country")
	var air := _button(editor._content, "✓ Air Force")
	_press(air)
	await _wait(0.3)
	_check(not (editor._form.get("allowedUnitTypes", []) as Array).has("air"), "unchecking Air Force takes it out of the deployable types")
	editor._go_section("prompts")
	await _wait(0.8)
	var areas := _find_all(editor._content, func(entry: Node) -> bool: return entry is TextEdit, [])
	_check(not areas.is_empty(), "the Prompts tab shows its passages")
	if not areas.is_empty():
		var area: TextEdit = areas[0]
		area.text = "You speak as the leader of a small republic."
		area.text_changed.emit()
		await _wait(0.2)
		_check(_label(editor._content, "· edited") != null, "an edited passage is marked edited")
		await _shoot("ed-07-prompts-edited")
	editor._go_section("fronts")
	await _wait(0.8)
	var men := _find_all(editor._content, func(entry: Node) -> bool: return entry is LineEdit and (entry as LineEdit).placeholder_text == "10,000", [])
	_check(not men.is_empty(), "the war settings show Men per counter")
	if not men.is_empty():
		var fronts_panel: EditorFrontsPanel = null
		for entry in editor._panels:
			if entry.get("panel") is EditorFrontsPanel:
				fronts_panel = entry["panel"]
		var fronts_child: Node = fronts_panel._fronts_box.get_child(0) if fronts_panel and fronts_panel._fronts_box.get_child_count() > 0 else null
		(men[0] as LineEdit).grab_focus()
		_type(men[0], "7500")
		await _wait(0.3)
		_check(JSON.stringify(editor._form.get("warSettings")).contains("7500"), "a war setting reaches the drawer's form")
		_check(is_instance_valid(men[0]) and (men[0] as LineEdit).has_focus(), "the war setting keeps the focus while typing")
		_check(fronts_child == null or (is_instance_valid(fronts_child) and not fronts_child.is_queued_for_deletion() and fronts_child.get_parent() == fronts_panel._fronts_box), "the Fronts panel is not rebuilt by a war-setting keystroke")
	editor._go_section("features")
	await _wait(1.0)
	var off := _button(editor._content, "Off")
	_press(off)
	await _wait(0.3)
	var features: Dictionary = editor._form.get("features", {})
	_check(features.get("espionage") is Dictionary and not bool((features["espionage"] as Dictionary).get("enabled", true)), "switching Espionage off reaches the drawer's form")
	editor._go_section("stats")
	await _wait(0.8)
	_press(_button(editor._content, "Customize full sheet"))
	await _wait(0.5)
	_check(editor._stats is Dictionary and bool((editor._stats as Dictionary).get("custom", false)), "customizing the stats sheet reaches the drawer")
	await _shoot("ed-07b-stats-custom")
	_answer_soon(false)
	await editor.close_editor()
	await _wait(0.3)
	_check(editor.is_open() and str(events.get("last_dialog", "")).begins_with("Close the editor?"), "closing with unsaved changes asks first and stays open on Cancel")
	_press(editor._save_button)
	var saved := await _until(func() -> bool: return not editor.is_busy() and str(editor._details.get("scenario", {}).get("subtitle", "")) == "Edited in the native editor", 30.0)
	_check(saved, "Save writes the scenario")
	var disk := await _details("scenario", "default")
	var disk_details: Dictionary = disk.get("details", {})
	_check(str(disk_details.get("scenario", {}).get("subtitle", "")) == "Edited in the native editor", "the saved subtitle is on disk")
	_check(str(disk_details.get("data", {}).get("game", {}).get("country", "")) == "France", "the saved player country is on disk")
	_check(not (disk_details.get("data", {}).get("world", {}).get("allowedUnitTypes", []) as Array).has("air"), "the saved troop types are on disk")
	var prompts: Dictionary = disk_details.get("data", {}).get("prompts", {})
	_check(JSON.stringify(prompts).contains("small republic"), "the edited prompt passage is saved")
	_check(JSON.stringify(disk_details.get("data", {}).get("world", {}).get("warSettings", {})).contains("7500"), "the war setting is saved in the world")
	var saved_features: Dictionary = disk_details.get("scenario", {}).get("features", {})
	_check(saved_features.get("espionage") is Dictionary and not bool((saved_features["espionage"] as Dictionary).get("enabled", true)), "the feature switch is saved")
	_check(bool(disk_details.get("assetStatus", {}).get("stats", false)), "the custom stats sheet is uploaded with Save")
	editor._go_section("assets")
	await _wait(0.3)
	OS.set_environment("OH_EDITOR_PICK", "*=" + UI.repo_path("public/icon-192.png"))
	var upload := _button(editor._content, "Upload")
	_press(upload)
	var uploaded := await _until(func() -> bool: return bool(editor._details.get("assetStatus", {}).get("cover", false)) and str(editor._details.get("scenario", {}).get("coverImageUrl", "")).contains("v="), 20.0)
	_check(uploaded, "uploading a cover stores it in the scenario")
	await _wait(1.0)
	await _shoot("ed-08-assets-cover")
	editor._go_section("bundles")
	await _wait(0.3)
	var zip_target := out_dir.path_join("default-scenario.zip")
	var json_target := out_dir.path_join("default-scenario.json")
	OS.set_environment("OH_EDITOR_PICK", "scenario.zip=%s|scenario.json=%s" % [zip_target, json_target])
	_press(_button(editor._content, "Download .zip"))
	await _until(func() -> bool: return FileAccess.file_exists(zip_target) and not editor.is_busy(), 120.0)
	_check(FileAccess.file_exists(zip_target), "Download .zip writes the bundle")
	_press(_button(editor._content, "Download JSON"))
	await _until(func() -> bool: return FileAccess.file_exists(json_target) and not editor.is_busy(), 120.0)
	_check(FileAccess.file_exists(json_target), "Download JSON writes the bundle")
	OS.set_environment("OH_EDITOR_PICK", "")
	await _shoot("ed-09-bundles")
	editor._go_section("overview")
	await _wait(0.5)
	_press(_button(editor, "🗺️ Open Map Editor"))
	var workshop_up := await _until(func() -> bool: return editor._workshop != null and is_instance_valid(editor._workshop), 5.0)
	_check(workshop_up, "Open Map Editor opens the Workshop over the drawer")
	await _wait(6.0)
	await _shoot("ed-10-workshop")
	if editor._workshop and is_instance_valid(editor._workshop):
		editor._workshop.emit_signal("closed")
	await _wait(0.5)
	_check(editor._workshop == null, "closing the Workshop returns to the drawer")
	events["last_dialog"] = ""
	await editor.close_editor()
	await _until(func() -> bool: return not editor.is_open(), 5.0)
	_check(not editor.is_open(), "the X closes a saved drawer")


func _create_clone_flow() -> void:
	events["last_dialog"] = ""
	await editor.create_scenario()
	await _wait(0.6)
	var created_id := editor.current_id()
	_check(editor.is_open() and str(editor._record().get("name", "")) == "New Scenario", "Create Scenario opens the drawer on a new scenario")
	await _shoot("ed-11-created")
	editor._go_section("overview")
	await _wait(0.3)
	_type(_field_input("Name"), "Native Test Scenario")
	_press(editor._save_button)
	await _until(func() -> bool: return not editor.is_busy() and str(editor._record().get("name", "")) == "Native Test Scenario", 30.0)
	_check(str(editor._record().get("name", "")) == "Native Test Scenario", "the new scenario's name saves")
	await editor.clone_scenario({"id": created_id})
	await _wait(0.6)
	var clone_id := editor.current_id()
	_check(clone_id != created_id and str(editor._record().get("name", "")) == "Native Test Scenario Copy", "Clone Scenario opens the drawer on a copy")
	await _shoot("ed-12-clone")
	_answer_soon(true)
	_press(_button(editor, "Delete"))
	await _until(func() -> bool: return not editor.is_open(), 20.0)
	_check(not editor.is_open() and str(events.get("last_dialog", "")).begins_with("Delete the scenario \"Native Test Scenario Copy\"?"), "Delete asks, removes the copy and closes the drawer")
	var trash: Dictionary = await main.engine.request("library.trash")
	var entries: Array = trash.get("result", {}).get("entries", []) if trash.get("ok", false) and trash.get("result") is Dictionary else []
	_check(entries.any(func(entry: Dictionary) -> bool: return str(entry.get("id", "")) == clone_id), "the deleted copy is in Recently deleted")


func _game_flow() -> void:
	await main._start_scenario("default")
	await _wait(0.5)
	await main._on_country_chosen("France", "medium")
	await _wait(1.0)
	var game_id := str(main.game_id)
	_check(not game_id.is_empty(), "a game was started for the game editor")
	await main._exit_game()
	await _wait(0.5)
	await editor.open_game(game_id)
	await _wait(0.6)
	_check(editor.is_open() and editor.current_kind() == "game", "the game editor opened")
	await _shoot("ed-13-game-overview")
	for key in ["world", "features", "prompts", "assets"]:
		editor._go_section(key)
		await _wait(0.6)
		await _shoot("ed-14-game-%s" % key)
	editor._go_section("world")
	await _wait(0.3)
	_type(_field_input("Simulation Rules"), "No nuclear weapons.")
	editor._go_section("overview")
	await _wait(0.3)
	_type(_field_input("Name"), "Renamed by the native editor")
	_press(editor._save_button)
	await _until(func() -> bool: return not editor.is_busy() and str(editor._record().get("name", "")) == "Renamed by the native editor", 30.0)
	var disk := await _details("game", game_id)
	var details: Dictionary = disk.get("details", {})
	_check(str(details.get("game", {}).get("name", "")) == "Renamed by the native editor", "the game's name saves")
	_check(str(details.get("data", {}).get("world", {}).get("simulationRules", "")) == "No nuclear weapons.", "the game's rules save as a world patch")
	_check(str(details.get("data", {}).get("game", {}).get("country", "")) == "France", "the game's country is untouched by the save")
	_answer_soon(true)
	_press(_button(editor, "Delete"))
	await _until(func() -> bool: return not editor.is_open(), 20.0)
	_check(str(events.get("game_deleted", "")) == game_id, "deleting the game tells the app which game left")


func _finish() -> void:
	_say("RESULT %s (%d failures)" % ["PASS" if failures == 0 else "FAIL", failures])
	main.engine.stop()
	await _wait(0.3)
	quit(0 if failures == 0 else 1)
