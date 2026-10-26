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


func _confirm_dialog() -> void:
	for attempt in range(120):
		await process_frame
		for child in host.get_children():
			if child is ConfirmationDialog:
				(child as ConfirmationDialog).confirmed.emit()
				return


func _on_details(details: Dictionary) -> void:
	details_events += 1
	last_details = details


func _run() -> void:
	while not main.menu.visible:
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
	var form: Dictionary = result.get("form", {})

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

	var props := {"kind": "scenario", "details": details, "form": form, "gameDate": str(form.get("gameDate", "")), "host": host}
	generation = EditorPoliticalGeneration.new()
	column.add_child(generation)
	generation.details_changed.connect(_on_details)
	generation.setup(main.engine, props)
	authoring = EditorPoliticalAuthoring.new()
	column.add_child(authoring)
	authoring.details_changed.connect(_on_details)
	authoring.setup(main.engine, props)
	institutions = EditorInstitutionAuthoring.new()
	column.add_child(institutions)
	institutions.details_changed.connect(_on_details)
	institutions.setup(main.engine, props)

	await _wait_until(func() -> bool: return not generation._view.is_empty() and not authoring._rows.is_empty() and not institutions._state.is_empty(), 60.0, "panels to load")
	await _wait(0.6)
	_check(str(generation._view.get("status", "")) == "Not generated", "status pill reads Not generated (%s)" % str(generation._view.get("status", "")))
	_check(int(generation._view.get("polityCount", 0)) == 202, "202 polities counted")
	await _shoot("pol-01-politics-tab")

	generation._advanced["open"] = true
	(generation._advanced["refresh"] as Callable).call()
	await _wait(0.3)
	await _shoot("pol-02-advanced")

	generation._call("editor.politics.gen.generate", {"test": true}, true)
	await _wait_until(func() -> bool: return bool(generation._view.get("busy", false)) or not generation._rows.is_empty(), 20.0, "test run to start")
	await _shoot("pol-03-test-running")
	await _wait_until(func() -> bool: return not bool(generation._view.get("busy", true)) and generation._running_id == 0, 120.0, "test run to finish")
	await _wait(0.4)
	_say("test progress: " + str(generation._view.get("progress", "")))
	_check(generation._rows.size() == 15, "15 review rows (%d)" % generation._rows.size())
	_check(str(generation._view.get("progress", "")).begins_with("Test complete: "), "test progress line")
	generation._expanded = str((generation._rows[0] as Dictionary).get("polityKey", "")) if not generation._rows.is_empty() else ""
	generation._render_rows()
	await _wait(0.3)
	scroll.scroll_vertical = 520
	await _shoot("pol-04-review-rows")
	for index in range(mini(3, generation._rows.size())):
		(generation._rows[index] as Dictionary)["selected"] = true
	for index in range(3, generation._rows.size()):
		(generation._rows[index] as Dictionary)["selected"] = false
	generation._update_rows_header()
	var before := details_events
	await generation._call("editor.politics.gen.applySelected", {"rows": generation._row_edits()})
	await _wait(0.6)
	_say("apply progress: " + str(generation._view.get("progress", "")) + " | error: " + str(generation._view.get("error", "")))
	_check(details_events > before, "Apply Selected emitted details_changed")
	var actors: Dictionary = ((last_details.get("data", {}) as Dictionary).get("world", {}) as Dictionary).get("politicalActors", {})
	var applied_count := (actors.get("byPolity", {}) as Dictionary).size()
	_check(applied_count == 3, "three Political Actors saved into world.json (%d)" % applied_count)
	_check(str(generation._view.get("lastApplied", "")).begins_with("Applied: "), "Applied line shown")
	scroll.scroll_vertical = 0
	await _shoot("pol-05-applied")

	generation._props = {"kind": "scenario", "details": last_details, "form": form, "gameDate": str(form.get("gameDate", "")), "host": host}
	await generation._send_settings({"callBudget": 2})
	generation._call("editor.politics.gen.run", {"retryDeferred": false}, true)
	await _wait_until(func() -> bool: return generation._view.get("live") is Dictionary, 30.0, "live v2 progress")
	await _shoot("pol-06-v2-running")
	await _wait_until(func() -> bool: return not bool(generation._view.get("busy", true)) and generation._running_id == 0, 300.0, "v2 run to pause")
	await _wait(0.5)
	_say("v2 progress: " + str(generation._view.get("progress", "")))
	_check(generation._view.get("checkpointCard") is Dictionary, "checkpoint card shown after pause")
	_check(str(generation._view.get("generateLabel", "")) == "Continue Generation", "Generate button now reads Continue Generation")
	scroll.scroll_vertical = 0
	await _shoot("pol-07-v2-paused")

	authoring._open_manager()
	await _wait(0.8)
	await _shoot("pol-08-authoring-manager")
	await authoring._select_polity("France")
	await _wait(0.5)
	_check(authoring._selected_key == "France", "France selected in the authoring manager")
	authoring._edit("governmentForm", "Semi-presidential republic")
	authoring._edit("headOfState", "François Hollande")
	authoring._edit_trait("caution", "64.5")
	authoring._parties_section["open"] = true
	(authoring._parties_section["refresh"] as Callable).call()
	(authoring._draft["parties"] as Array).append(authoring._empty_party())
	authoring._render_parties()
	await _wait(0.4)
	_check(str(authoring._draft.get("traitsJson", "")).contains("\"caution\": 64.5"), "traits JSON follows the trait slider")
	await _shoot("pol-09-authoring-edit")
	await authoring._save()
	await _wait(0.5)
	_check(authoring._message == "Political World saved.", "authoring save message (%s)" % authoring._message)
	_check(authoring._has_actor, "France now has a Political World profile")
	await _shoot("pol-10-authoring-saved")
	authoring._dispose_manager()
	await _wait(0.3)

	institutions._open_manager()
	await _wait(0.6)
	await _shoot("pol-11-institutions-empty")
	await institutions._create_new()
	institutions._edit("name", "Northern League")
	institutions._edit("shortName", "NL")
	institutions._edit("kind", "security_alliance")
	institutions._add_member("France")
	institutions._add_member("Germany")
	institutions._add_member("Atlantis")
	institutions._picker._input.text = "Pol"
	institutions._picker._open = true
	institutions._picker._render()
	await _wait(0.4)
	await _shoot("pol-12-institution-draft")
	institutions._picker._open = false
	institutions._picker._input.text = ""
	institutions._picker._render()
	await institutions._save()
	await _wait(0.6)
	_check(institutions._message == "Institution saved to scenario canon.", "institution save message (%s)" % institutions._message)
	_check(institutions._rows.size() == 1, "one institution in the scenario")
	await _shoot("pol-13-institution-saved")
	institutions._delete()
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
