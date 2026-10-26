extends SceneTree

var main: Node
var shots := ""
var started := 0
var failures: PackedStringArray = []
var host: Control
var column: VBoxContainer
var scroll: ScrollContainer
var generation: EditorPoliticalGeneration
var authoring: EditorPoliticalAuthoring
var institutions: EditorInstitutionAuthoring
var details_events := 0
var last_details: Dictionary = {}
var form: Dictionary = {}


func _initialize() -> void:
	shots = OS.get_environment("OH_SHOTS")
	started = Time.get_ticks_msec()
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.add_child(main)
	_run.call_deferred()


func _say(text: String) -> void:
	print("[politics %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _check(ok: bool, text: String) -> void:
	_say(("PASS " if ok else "FAIL ") + text)
	if not ok:
		failures.append(text)


func _frames(count: int) -> void:
	for i in range(count):
		await process_frame


func _wait(seconds: float) -> void:
	await create_timer(seconds).timeout


func _shoot(name: String) -> void:
	await _frames(4)
	await RenderingServer.frame_post_draw
	if shots.is_empty():
		return
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(name + ".png"))
	_say("screenshot " + name)


func _wait_until(condition: Callable, seconds: float, label: String) -> bool:
	var deadline := Time.get_ticks_msec() + int(seconds * 1000.0)
	while not bool(condition.call()):
		if Time.get_ticks_msec() > deadline:
			_say("timed out waiting for " + label)
			return false
		await process_frame
	return true


func _find(node: Node, predicate: Callable) -> Node:
	if bool(predicate.call(node)):
		return node
	for child in node.get_children():
		var found := _find(child, predicate)
		if found:
			return found
	return null


func _button(under: Node, text: String) -> Button:
	return _find(under, func(node: Node) -> bool: return node is Button and (node as Button).text == text and (node as Button).is_visible_in_tree()) as Button


func _field(under: Node, label: String) -> Control:
	var holder := _find(under, func(node: Node) -> bool:
		if not (node is VBoxContainer) or node.get_child_count() < 2:
			return false
		var first := node.get_child(0)
		return first is Label and (first as Label).text == label.to_upper())
	return holder.get_child(1) as Control if holder else null


func _type(control: Control, text: String) -> void:
	if control is LineEdit:
		(control as LineEdit).text = text
		(control as LineEdit).text_changed.emit(text)
	elif control is TextEdit:
		(control as TextEdit).text = text
		(control as TextEdit).text_changed.emit()


func _choose_option(control: Control, value: String) -> void:
	var select := control as OptionButton
	for index in range(select.item_count):
		if str(select.get_item_metadata(index)) == value:
			select.select(index)
			select.item_selected.emit(index)
			return


func _confirm_dialog() -> void:
	for attempt in range(120):
		await process_frame
		for child in host.get_children():
			if child is ConfirmationDialog:
				(child as ConfirmationDialog).confirmed.emit()
				return


func _props(details: Dictionary) -> Dictionary:
	return {"kind": "scenario", "details": details, "form": form, "gameDate": str(form.get("gameDate", "")), "host": host}


func _on_details(details: Dictionary, source: Node) -> void:
	details_events += 1
	last_details = details
	for panel in [generation, authoring, institutions]:
		if panel != source:
			panel.update_props(_props(details))


func _run() -> void:
	while not main.get("menu") or not main.menu.visible:
		if Time.get_ticks_msec() - started > 90000:
			_say("FAIL the menu never appeared")
			_finish(1)
			return
		await process_frame
	_say("menu ready")
	var opened: Dictionary = await main.engine.request("editor.open", {"kind": "scenario", "id": "default"})
	_check(opened.get("ok", false), "editor.open answered")
	if not opened.get("ok", false):
		_say(str(opened.get("error", "")))
		_finish(1)
		return
	var result: Dictionary = opened["result"]
	var details: Dictionary = result.get("details", {})
	form = result.get("form", {})

	host = Control.new()
	host.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	main.ui.add_child(host)
	var bg := ColorRect.new()
	bg.color = EditorKit.PANEL
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	host.add_child(bg)
	scroll = ScrollContainer.new()
	scroll.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	scroll.offset_left = 270
	scroll.offset_right = -270
	scroll.offset_top = 20
	scroll.offset_bottom = -20
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	host.add_child(scroll)
	column = VBoxContainer.new()
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.add_theme_constant_override("separation", 0)
	scroll.add_child(column)

	generation = EditorPoliticalGeneration.new()
	column.add_child(generation)
	authoring = EditorPoliticalAuthoring.new()
	column.add_child(authoring)
	institutions = EditorInstitutionAuthoring.new()
	column.add_child(institutions)
	generation.details_changed.connect(func(next: Dictionary) -> void: _on_details(next, generation))
	authoring.details_changed.connect(func(next: Dictionary) -> void: _on_details(next, authoring))
	institutions.details_changed.connect(func(next: Dictionary) -> void: _on_details(next, institutions))
	generation.setup(main.engine, _props(details))
	authoring.setup(main.engine, _props(details))
	institutions.setup(main.engine, _props(details))

	await _wait_until(func() -> bool: return not generation._view.is_empty() and not authoring._rows.is_empty() and not institutions._state.is_empty(), 60.0, "panels to load")
	await _wait(0.6)
	_check(str(generation._view.get("status", "")) == "Not generated", "status pill reads Not generated (%s)" % str(generation._view.get("status", "")))
	_check(int(generation._view.get("polityCount", 0)) == 202, "202 polities counted")
	await _shoot("pol-01-politics-tab")

	(generation._advanced["summary"] as Button).pressed.emit()
	await _wait(0.3)
	await _shoot("pol-02-advanced")

	_button(generation, "Test 15 Polities").pressed.emit()
	await _wait_until(func() -> bool: return bool(generation._view.get("busy", false)) or not generation._rows.is_empty(), 20.0, "test run to start")
	await _shoot("pol-03-test-running")
	await _wait_until(func() -> bool: return not bool(generation._view.get("busy", true)) and generation._running_id == 0, 120.0, "test run to finish")
	await _wait(0.4)
	_say("test progress: " + str(generation._view.get("progress", "")))
	_check(generation._rows.size() == 15, "15 review rows (%d)" % generation._rows.size())
	_check(str(generation._view.get("progress", "")).begins_with("Test complete: "), "test progress line")
	var picks: Array = []
	for index in range(generation._rows_list.get_child_count()):
		var box := _find(generation._rows_list.get_child(index), func(node: Node) -> bool: return node is CheckBox) as CheckBox
		if box and picks.size() < 3:
			box.button_pressed = true
			picks.append(box)
	await _wait(0.2)
	_check(_button(generation, "Apply Selected (3)") != null, "Apply Selected counts three ticked rows")
	scroll.scroll_vertical = 560
	await _shoot("pol-04-review-rows")
	var before := details_events
	_button(generation, "Apply Selected (3)").pressed.emit()
	await _wait_until(func() -> bool: return details_events > before, 20.0, "apply selected")
	await _wait(1.0)
	_say("apply progress: " + str(generation._view.get("progress", "")) + " | error: " + str(generation._view.get("error", "")))
	_check(details_events > before, "Apply Selected emitted details_changed")
	var actors: Dictionary = ((last_details.get("data", {}) as Dictionary).get("world", {}) as Dictionary).get("politicalActors", {})
	var applied_count := (actors.get("byPolity", {}) as Dictionary).size()
	_check(applied_count == 3, "three Political Actors saved into world.json (%d)" % applied_count)
	_check(str(generation._view.get("lastApplied", "")).begins_with("Applied: "), "Applied line shown")
	_check(authoring._actor_count == 3, "authoring card followed the save (%d actors)" % authoring._actor_count)
	scroll.scroll_vertical = 0
	await _shoot("pol-05-applied")

	var budget := generation._budget_input
	_type(budget, "2")
	await _wait(0.4)
	_check(int(generation._view.get("callBudget", 0)) == 2, "call budget set to 2")
	_button(generation, "Generate Political World").pressed.emit()
	await _wait_until(func() -> bool: return generation._view.get("live") is Dictionary, 30.0, "live v2 progress")
	await _shoot("pol-06-v2-running")
	await _wait_until(func() -> bool: return not bool(generation._view.get("busy", true)) and generation._running_id == 0, 300.0, "v2 run to pause")
	await _wait(0.5)
	_say("v2 progress: " + str(generation._view.get("progress", "")))
	_check(generation._view.get("checkpointCard") is Dictionary, "checkpoint card shown after pause")
	_check(str(generation._view.get("generateLabel", "")) == "Continue Generation", "Generate button now reads Continue Generation")
	scroll.scroll_vertical = 0
	await _shoot("pol-07-v2-paused")

	_button(authoring, "Manage Political World").pressed.emit()
	await _wait(0.8)
	await _shoot("pol-08-authoring-manager")
	var search := _find(authoring._manager.aside_top, func(node: Node) -> bool: return node is LineEdit) as LineEdit
	_type(search, "fran")
	await _wait(0.3)
	var france := _find(authoring._manager.aside_list, func(node: Node) -> bool: return node is Button and node.get_child_count() > 0) as Button
	france.pressed.emit()
	await _wait_until(func() -> bool: return authoring._selected_key == "France", 10.0, "France selected")
	await _wait(0.4)
	_check(authoring._selected_key == "France", "France selected in the authoring manager")
	_type(_field(authoring._manager.main_body, "Government form"), "Semi-presidential republic")
	_type(_field(authoring._manager.main_body, "Head of state"), "François Hollande")
	_type(_field(authoring._manager.main_body, "Head of government"), "Manuel Valls")
	_choose_option(_field(authoring._manager.main_body, "Representation model"), "electoral")
	_find(authoring._manager.main_body, func(node: Node) -> bool: return node is Button and (node as Button).text.ends_with("Political traits · full supported catalog (10)")).pressed.emit()
	await _wait(0.2)
	var caution: Dictionary = authoring._trait_controls.get("caution", {})
	(caution["slider"] as HSlider).value = 64.5
	_find(authoring._manager.main_body, func(node: Node) -> bool: return node is Button and (node as Button).text.ends_with("Parties / political entities (0)")).pressed.emit()
	await _wait(0.2)
	_button(authoring._manager.main_body, "+ Add political entity").pressed.emit()
	await _wait(0.3)
	_find(authoring._manager.main_body, func(node: Node) -> bool: return node is Button and (node as Button).text.ends_with("New political entity")).pressed.emit()
	await _wait(0.2)
	_type(_field(authoring._manager.main_body, "Name"), "Socialist Party")
	_type(_field(authoring._manager.main_body, "Support (%)"), "28")
	var ruling := _find(authoring._manager.main_body, func(node: Node) -> bool: return node is CheckBox and (node as CheckBox).text == "Ruling / government") as CheckBox
	ruling.button_pressed = true
	await _wait(0.4)
	_check(str(authoring._draft.get("traitsJson", "")).contains("\"caution\": 64.5"), "traits JSON follows the trait slider")
	_check(authoring._dirty, "authoring marks the draft dirty")
	authoring._manager.main_scroll.scroll_vertical = 520
	await _shoot("pol-09-authoring-edit")
	_button(authoring._manager.main_header, "Save Political World").pressed.emit()
	await _wait_until(func() -> bool: return not authoring._busy and not authoring._message.is_empty(), 20.0, "authoring save")
	await _wait(0.5)
	_check(authoring._message == "Political World saved.", "authoring save message (%s)" % authoring._message)
	_check(authoring._has_actor, "France now has a Political World profile")
	var saved_france: Dictionary = ((((last_details.get("data", {}) as Dictionary).get("world", {}) as Dictionary).get("politicalActors", {}) as Dictionary).get("byPolity", {}) as Dictionary).get("France", {})
	_check(str((saved_france.get("government", {}) as Dictionary).get("form", "")) == "Semi-presidential republic", "government form saved into world.json")
	_check(((saved_france.get("government", {}) as Dictionary).get("rulingPartyIds", []) as Array).size() == 1, "ruling party written to rulingPartyIds")
	_check(float((saved_france.get("traits", {}) as Dictionary).get("caution", 0)) == 64.5, "caution trait saved as 64.5")
	await _shoot("pol-10-authoring-saved")
	authoring._manager.main_scroll.scroll_vertical = 2000
	await _wait(0.3)
	await _shoot("pol-10b-authoring-bottom")
	authoring._dispose_manager()
	await _wait(0.3)

	_button(institutions, "Manage institutions").pressed.emit()
	await _wait(0.6)
	await _shoot("pol-11-institutions-empty")
	_button(institutions._manager.aside_top, "+ Create institution").pressed.emit()
	await _wait(0.3)
	_type(_field(institutions._manager.main_body, "Name"), "Northern League")
	_type(_field(institutions._manager.main_body, "Short name"), "NL")
	_choose_option(_field(institutions._manager.main_body, "Type"), "security_alliance")
	_type(_field(institutions._manager.main_body, "Founded"), "2014-03-01")
	for name in ["France", "Germany", "Atlantis"]:
		institutions._picker._input.text = name
		institutions._picker._input.text_changed.emit(name)
		institutions._picker._input.text_submitted.emit(name)
		await _wait(0.1)
	institutions._picker._input.text = "Pol"
	institutions._picker._input.text_changed.emit("Pol")
	await _wait(0.4)
	_check(institutions._member_names().size() == 3, "three starting members listed")
	await _shoot("pol-12-institution-draft")
	institutions._picker._input.text = ""
	institutions._picker._input.text_changed.emit("")
	institutions._picker._open = false
	institutions._picker._render()
	_button(institutions._manager.main_header, "Save institution").pressed.emit()
	await _wait_until(func() -> bool: return not institutions._busy and not institutions._message.is_empty(), 20.0, "institution save")
	await _wait(0.6)
	_check(institutions._message == "Institution saved to scenario canon.", "institution save message (%s)" % institutions._message)
	_check(institutions._rows.size() == 1, "one institution in the scenario")
	var saved_institutions: Dictionary = ((last_details.get("data", {}) as Dictionary).get("world", {}) as Dictionary).get("institutions", {})
	var saved_league: Dictionary = (saved_institutions.get("byId", {}) as Dictionary).get("northern-league", {})
	_check(str(saved_league.get("kind", "")) == "security_alliance" and (saved_league.get("members", []) as Array).size() == 3, "institution with three members saved into world.json")
	await _shoot("pol-13-institution-saved")
	_find(institutions._manager.main_body, func(node: Node) -> bool: return node is Button and (node as Button).text.ends_with("Visual identity")).pressed.emit()
	await _wait(0.2)
	_button(institutions._manager.main_body, "Upload small logo").pressed.emit()
	await _wait_until(func() -> bool: return not institutions._pending_logo.is_empty() or not institutions._message.is_empty(), 10.0, "logo upload")
	await _wait(0.5)
	_check(institutions._pending_logo.begins_with("data:image/png;base64,"), "small logo read as a PNG data URL (%s)" % institutions._message)
	institutions._manager.main_scroll.scroll_vertical = 400
	await _shoot("pol-13b-logo-pending")
	_button(institutions._manager.main_header, "Save institution").pressed.emit()
	await _wait_until(func() -> bool: return not institutions._busy and institutions._message == "Institution saved to scenario canon." and institutions._pending_logo.is_empty(), 20.0, "save with logo")
	var stored_url := "/api/scenarios/default/institution-logo/northern-league"
	await _wait_until(func() -> bool: return institutions._logo_cache.has(stored_url), 10.0, "stored logo fetch")
	_check(institutions._logo_cache.get(stored_url) != null, "stored logo served back from the scenario")
	await _shoot("pol-13c-logo-stored")
	_choose_option(_field(institutions._manager.main_body, "Historical emblem"), "nato")
	await _wait_until(func() -> bool: return institutions._logo_cache.has("https://upload.wikimedia.org/wikipedia/commons/3/37/Flag_of_NATO.svg"), 15.0, "emblem fetch")
	await _wait(0.4)
	_say("emblem fetched: %s" % str(institutions._logo_cache.get("https://upload.wikimedia.org/wikipedia/commons/3/37/Flag_of_NATO.svg") != null))
	await _shoot("pol-13d-emblem")
	_button(institutions._manager.main_header, "Delete institution").pressed.emit()
	await _confirm_dialog()
	await _wait_until(func() -> bool: return not institutions._busy and institutions._rows.is_empty(), 20.0, "institution delete")
	await _wait(0.4)
	_check(institutions._message == "Northern League deleted from the scenario.", "institution delete message (%s)" % institutions._message)
	await _shoot("pol-14-institution-deleted")
	institutions._close_manager()
	await _wait(0.3)
	scroll.scroll_vertical = 0
	await _shoot("pol-15-cards")
	_say("details_changed events: %d" % details_events)
	_say("RESULT %s" % ("PASS" if failures.is_empty() else "FAIL: " + "; ".join(failures)))
	_finish(0 if failures.is_empty() else 1)


func _finish(code: int) -> void:
	main.engine.stop()
	await _frames(2)
	quit(code)
