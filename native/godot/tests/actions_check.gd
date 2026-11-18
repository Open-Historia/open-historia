extends SceneTree

var main: Node
var shots := ""
var downloads := ""
var started := 0
var failures := 0
var advisor_texts: Array[String] = []
var map_targets: Array[Vector3] = []


func _initialize() -> void:
	var redraw := Node2D.new()
	root.add_child(redraw)
	process_frame.connect(redraw.queue_redraw)
	shots = OS.get_environment("OH_SHOTS")
	downloads = OS.get_environment("OH_NATIVE_DOWNLOADS")
	started = Time.get_ticks_msec()
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.mouse_passthrough = true
	root.add_child(main)
	_run.call_deferred()


func _say(text: String) -> void:
	print("[actions_check %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _check(ok: bool, what: String) -> void:
	if ok:
		_say("PASS " + what)
	else:
		failures += 1
		_say("FAIL " + what)


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
	return bool(condition.call())


func _shoot(name: String) -> void:
	await _frames(4)
	await RenderingServer.frame_post_draw
	if shots.is_empty():
		return
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(name + ".png"))
	_say("screenshot " + name)


func _shift(iso: String, days: int) -> String:
	var parts := iso.split("-")
	if parts.size() < 3:
		return iso
	var unix := Time.get_unix_time_from_datetime_dict({"year": int(parts[0]), "month": int(parts[1]), "day": int(parts[2]), "hour": 0, "minute": 0, "second": 0})
	var date := Time.get_datetime_dict_from_unix_time(unix + days * 86400)
	return "%04d-%02d-%02d" % [date["year"], date["month"], date["day"]]


func _find_button(node: Node, text: String) -> Button:
	if node == null:
		return null
	for child in node.get_children():
		if child is Button and (child as Button).text == text:
			return child as Button
		var found := _find_button(child, text)
		if found:
			return found
	return null


func _find_label(node: Node, text: String) -> Label:
	if node == null:
		return null
	for child in node.get_children():
		if child is Label and (child as Label).text == text:
			return child as Label
		var found := _find_label(child, text)
		if found:
			return found
	return null


func _find_label_containing(node: Node, text: String) -> Label:
	if node == null:
		return null
	for child in node.get_children():
		if child is Label and (child as Label).text.contains(text):
			return child as Label
		var found := _find_label_containing(child, text)
		if found:
			return found
	return null


func _card_for(panel: ProjectsPanel, name: String) -> Node:
	var node: Node = _find_label(panel._cards, name)
	while node and node.get_parent() != panel._cards:
		node = node.get_parent()
	return node


func _hover_row(panel: Node, text: String) -> void:
	var node: Node = _find_label(panel, text)
	while node and not (node is PanelContainer):
		node = node.get_parent()
	if node:
		(node as PanelContainer).mouse_entered.emit()


func _key(keycode: Key, shift := false) -> InputEventKey:
	var event := InputEventKey.new()
	event.keycode = keycode
	event.physical_keycode = keycode
	event.pressed = true
	event.shift_pressed = shift
	return event


func _focus_owner() -> Control:
	return root.gui_get_focus_owner()



func _clear_shell() -> void:
	var shell: ShellBoot = main.get("shell") as ShellBoot
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
			failures += 1
			_finish()
			return
		await process_frame
	_say("menu ready")
	await _clear_shell()
	await main._start_scenario("default")
	await _wait(0.4)
	main.picker._choose("France")
	await _wait(0.2)
	await main._on_country_chosen("France", "medium")
	_say("game open: %s" % str(main.game_name))
	await _wait(1.0)
	await _actions_checks()
	await _projects_checks()
	_finish()


func _actions_checks() -> void:
	var panel := ActionsPanel.new()
	main.hud.add_child(panel)
	panel.setup(main.engine, {})
	panel.open_advisor.connect(func(text: String) -> void: advisor_texts.append(text))
	panel.open()
	await _until(func() -> bool: return not panel._view.is_empty(), 20.0)
	await _wait(0.5)
	_check(str(panel._view.get("country", "")) == "France", "actions.read names the player's country")
	_check(_find_button(panel, "🎯 Set a standing goal") != null, "the empty goal shows the dashed prompt")
	_check(_find_label(panel, "YOUR SUBMITTED ACTIONS") != null and _find_label(panel, "No actions submitted yet.") != null, "an empty queue says so")
	_check(not panel._brainstorm.disabled, "Brainstorm is live once the advisor signal is wired")
	await _shoot("actions-1-open")

	_find_button(panel, "🎯 Set a standing goal").pressed.emit()
	await _frames(3)
	_check(panel._goal_editing and is_instance_valid(panel._goal_edit), "the goal editor opens")
	_check(panel._goal_edit.placeholder_text == ActionsPanel.GOAL_PLACEHOLDER, "the goal editor has the React placeholder")
	_check(_find_button(panel, "Clear goal") == null, "Clear goal is only offered once a goal exists")
	panel._goal_edit.text = "Keep out of the war and grow the economy"
	panel._goal_edit.text_changed.emit()
	await _frames(2)
	_check(not panel._goal_save.disabled, "Save is enabled once the draft differs")
	await _shoot("actions-2-goal-edit")
	panel._goal_edit.gui_input.emit(_key(KEY_ENTER))
	await _until(func() -> bool: return str(panel._view.get("goal", "")) == "Keep out of the war and grow the economy" and not panel._goal_editing, 15.0)
	_check(str(panel._view.get("goal", "")) == "Keep out of the war and grow the economy", "Enter saves the standing goal to the world")
	await _frames(3)
	_check(_find_label(panel, "STANDING GOAL") != null and _find_button(panel, "Edit") != null, "the saved goal shows its card with Edit")
	_find_button(panel, "Edit").pressed.emit()
	await _frames(3)
	_check(_find_button(panel, "Clear goal") != null and panel._goal_save.disabled, "editing a saved goal offers Clear goal and keeps Save off until it changes")
	panel._goal_edit.gui_input.emit(_key(KEY_ESCAPE))
	await _frames(3)
	_check(not panel._goal_editing and _find_button(panel, "Edit") != null, "Escape leaves the goal editor")
	_check(_find_button(panel, "Assess progress") != null and _find_label(panel, "How far has it come?") != null, "the goal card offers Assess progress")
	_find_button(panel, "Assess progress").pressed.emit()
	await _frames(2)
	_check(_find_button(panel, "Assessing…") != null and _find_button(panel, "Assessing…").disabled, "Assess progress reads Assessing… and is locked while it asks")
	await _until(func() -> bool: return typeof(panel._view.get("goalProgress")) == TYPE_DICTIONARY and not panel._progress_busy, 30.0)
	var reading: Variant = panel._view.get("goalProgress")
	_check(typeof(reading) == TYPE_DICTIONARY and int((reading as Dictionary).get("progress", -1)) == 38, "the reading is kept with the goal (38/100)")
	await _frames(3)
	_check(_find_label(panel, "38%") != null, "the bar's figure reads 38%")
	_check(_find_label(panel, "Reached") == null and _find_label_containing(panel, "Click the summary for details.") != null, "the details stay folded until the summary is clicked")
	var summary := _find_label_containing(panel, "The budget is closer to balance")
	_check(summary != null, "the reading's summary is shown")
	if summary:
		var click := InputEventMouseButton.new()
		click.button_index = MOUSE_BUTTON_LEFT
		click.pressed = true
		summary.gui_input.emit(click)
		await _frames(3)
	_check(_find_label(panel, "Reached") != null and _find_label(panel, "In the way") != null and _find_label(panel, "Next steps") != null, "clicking the summary opens Reached, In the way and Next steps")
	_check(_find_label_containing(panel, "A balanced budget passed parliament") != null, "what was reached is listed")
	await _shoot("actions-2b-goal-progress")
	var again := _find_button(panel, "↻")
	_check(again != null and not again.disabled and again.tooltip_text == "Assess again", "↻ offers to assess again")
	if again:
		again.pressed.emit()
	await _until(func() -> bool:
		var now: Variant = panel._view.get("goalProgress")
		return typeof(now) == TYPE_DICTIONARY and int((now as Dictionary).get("progress", -1)) == 46 and not panel._progress_busy, 30.0)
	await _frames(3)
	_check(_find_label(panel, "46%") != null and _find_label(panel, "+8") != null, "a second reading shows the change since the last (+8)")

	_find_button(panel, "Brainstorm").pressed.emit()
	_check(advisor_texts.size() == 1 and advisor_texts[0] == ActionsPanel.BRAINSTORM_TEXT, "Brainstorm asks for the advisor with the React starter text")

	panel._composer.text = "Raise taxes"
	panel._composer.set_caret_column(panel._composer.text.length())
	panel._composer.gui_input.emit(_key(KEY_ENTER, true))
	_check(panel._composer.text.contains("\n"), "Shift+Enter adds a new line instead of sending")
	var holder: Control = panel._composer.get_parent()
	var grip: Control = holder.get_child(1) as Control
	var tall_before: float = holder.size.y
	var press := InputEventMouseButton.new()
	press.button_index = MOUSE_BUTTON_LEFT
	press.pressed = true
	press.global_position = Vector2(0, 500)
	grip._gui_input(press)
	var drag := InputEventMouseMotion.new()
	drag.global_position = Vector2(0, 560)
	grip._gui_input(drag)
	var release := InputEventMouseButton.new()
	release.button_index = MOUSE_BUTTON_LEFT
	release.pressed = false
	grip._gui_input(release)
	await _frames(3)
	_check(holder.size.y >= tall_before + 55.0, "the composer's corner grip drags it taller, as the released textarea resizes (%.0f -> %.0f)" % [tall_before, holder.size.y])
	await _shoot("actions-composer-resized")
	holder.custom_minimum_size.y = 62
	await _frames(2)
	panel._composer.text = "Raise taxes on luxury goods"
	panel._composer.text_changed.emit()
	panel._composer.gui_input.emit(_key(KEY_ENTER))
	await _until(func() -> bool: return (panel._view.get("submitted", []) as Array).size() == 1, 15.0)
	var submitted: Array = panel._view.get("submitted", [])
	_check(submitted.size() == 1 and str((submitted[0] as Dictionary).get("label", "")) == "Raise taxes on luxury goods", "Enter queues the typed order")
	_check(panel._composer.text.is_empty(), "the composer clears after a saved order")

	panel._composer.text = "fix the budget"
	panel._composer.text_changed.emit()
	panel._improve_button.pressed.emit()
	await _until(func() -> bool: return not panel._is_improving, 60.0)
	_check(panel._composer.text.begins_with("Convene the cabinet"), "Improve replaces the text with the model's version")
	_check(panel._improve_failure.is_empty(), "a good Improve leaves no failure note")

	panel._composer.text = "fix the budget [stand-in fails]"
	panel._composer.text_changed.emit()
	panel._improve_button.pressed.emit()
	await _until(func() -> bool: return not panel._is_improving, 120.0)
	_check(not panel._improve_failure.is_empty() and panel._composer.text == "fix the budget [stand-in fails]", "a fallback Improve keeps the text and says it failed")
	var idle_label := "💾 Save logging file" if panel._logging_on else "Copy for a bug report"
	var report := _find_button(panel, idle_label)
	_check(report != null, "the failure note carries the report button (%s)" % idle_label)
	await _shoot("actions-3-improve-failed")
	if report and panel._logging_on and not downloads.is_empty():
		report.pressed.emit()
		await _until(func() -> bool: return _find_button(panel, "✓ Saved — attach the file to your report") != null, 15.0)
		_check(_find_button(panel, "✓ Saved — attach the file to your report") != null, "the report button saves the diagnostics log")
		var saved := DirAccess.get_files_at(downloads)
		_check(saved.size() > 0 and saved[0].contains("improve-failed"), "the log file is named for the failure (%s)" % (saved[0] if saved.size() > 0 else "none"))
		await _shoot("actions-3b-report-saved")
	panel._composer.text = ""
	panel._composer.text_changed.emit()

	panel._suggest_button.pressed.emit()
	await _frames(2)
	_check(panel._is_suggesting and panel._suggest_spinner.visible, "AI Suggestions shows its spinner while it runs")
	await _until(func() -> bool: return not panel._is_suggesting, 120.0)
	var suggestions: Array = panel._view.get("suggestions", [])
	_check(suggestions.size() > 0, "AI Suggestions saved topics on the world (%d)" % suggestions.size())
	_check(_find_label(panel, "SUGGESTED ACTIONS") != null, "the suggested section is open")
	await _shoot("actions-4-suggestions")
	if suggestions.size() > 0:
		var topic: Dictionary = suggestions[0]
		var first: Dictionary = (topic.get("actions", []) as Array)[0]
		await panel._queue_suggestion(str(topic.get("id", "")), str(first.get("id", "")))
		_check((panel._view.get("queuedIds", []) as Array).has(str(first.get("id", ""))), "a suggestion queues")
		await _frames(3)
		_check(_find_label(panel, "✓ Queued — %s" % str(first.get("title", ""))) != null, "the queued card reads ✓ Queued")
		await _shoot("actions-5-queued")

	await _goal_and_resize_checks(panel)
	panel._layout["section"] = "submitted"
	panel._render_sections()
	var before := (panel._view.get("submitted", []) as Array).size()
	var seeded_live: Dictionary = await main.engine.request("actions.testSeed", {"actions": [{"id": "seed-live", "kind": "action", "title": "Recall the ambassador from Rome", "text": "Recall the ambassador from Rome for consultations.", "source": "manual", "status": "planned"}]})
	_check(seeded_live.get("ok", false), "an order was written from outside the panel")
	var live := await _until(func() -> bool: return (panel._view.get("submitted", []) as Array).size() == before + 1, 6.0)
	_check(live, "the panel picks up an order written elsewhere without being reopened")
	await _frames(2)
	_hover_row(panel, "Raise taxes on luxury goods")
	await _shoot("actions-6-submitted")
	submitted = panel._view.get("submitted", [])
	var manual: Dictionary = {}
	for entry in submitted:
		if str((entry as Dictionary).get("label", "")) == "Raise taxes on luxury goods":
			manual = entry
	if not manual.is_empty():
		await panel._delete(manual)
		var after: Array = panel._view.get("submitted", [])
		_check(after.size() == submitted.size() - 1, "✕ removes the order from the queue")

	var seeded: Dictionary = await main.engine.request("actions.testSeed", {"actions": [{"id": "seed-move", "kind": "action", "title": "Move the 2nd Armoured Brigade to Lyon", "text": "Move the 2nd Armoured Brigade to Lyon.", "source": "manual", "status": "planned", "unitRevert": {"unitId": "seed-unit", "lng": 4.83, "lat": 45.76}}]})
	_check(seeded.get("ok", false), "seeded a unit order")
	await panel.refresh()
	var round_before := int(panel._view.get("round", 0))
	var skip_state := {"done": false}
	var run_skip := func() -> void:
		await main.engine.request("skip", {"days": 1.0})
		skip_state["done"] = true
	run_skip.call()
	var saw_running := await _until(func() -> bool:
		panel._on_poll()
		return panel._turn_running, 30.0)
	_check(saw_running, "the panel sees the turn running")
	if saw_running:
		await _frames(3)
		var locked_edit := _find_button(panel, "Edit")
		_check(locked_edit != null and locked_edit.disabled, "the goal's Edit is locked while a turn runs")
		var locked_again := _find_button(panel, "↻")
		_check(locked_again != null and locked_again.disabled and locked_again.tooltip_text == "A turn is running.", "↻ is locked while a turn runs")
		var locked_remove := false
		for entry in panel._view.get("submitted", []):
			if (entry as Dictionary).get("movesUnit", false):
				locked_remove = true
		_check(locked_remove, "the unit order is marked as moving a unit")
		_hover_row(panel, "Move the 2nd Armoured Brigade to Lyon.")
		await _shoot("actions-7-turn-running")
	await _until(func() -> bool: return bool(skip_state["done"]), 180.0)
	await _until(func() -> bool: return int(panel._view.get("round", 0)) != round_before, 20.0)
	await _wait(1.0)
	_check(int(panel._view.get("round", 0)) != round_before, "the panel re-read the queue when the round changed (%d → %d)" % [round_before, int(panel._view.get("round", 0))])
	_check(_find_label_containing(panel, "a turn has passed since; ↻ to update") != null, "a reading from before the skip says a turn has passed since")
	await _shoot("actions-8-after-skip")
	panel.close()
	await _wait(0.5)
	panel.queue_free()
	await _frames(2)


func _goal_and_resize_checks(panel: ActionsPanel) -> void:
	_check(not panel.goal_open(), "opening the suggested actions minimizes the standing goal")
	var line := panel.find_child("GoalLine", true, false) as Label
	_check(line != null and line.text == "Keep out of the war and grow the economy" and line.text_overrun_behavior == TextServer.OVERRUN_TRIM_ELLIPSIS, "the minimized goal shows the goal on one line")
	var percent := panel.find_child("GoalPercent", true, false) as Label
	_check(percent != null and percent.text == "46%", "the minimized goal shows how far it has come (46%)")
	_check(_find_button(panel, "↻") == null and _find_button(panel, "Edit") != null, "the minimized goal folds its reading away and keeps Edit")
	await _shoot("actions-4b-goal-minimized")
	var header := panel.find_child("GoalHeader", true, false) as Button
	header.pressed.emit()
	await _until(func() -> bool: return panel.goal_open(), 5.0)
	await _frames(3)
	_check(panel.goal_open() and str(panel._layout["section"]) == "suggested" and _find_label(panel, "SUGGESTED ACTIONS") != null, "expanding the goal leaves the open list open")
	_check(_find_button(panel, "↻") != null, "the expanded goal shows its reading again")
	var saved: Dictionary = await main.engine.request("actions.layout")
	_check(bool(saved.get("result", {}).get("goalOpen", false)), "the goal card's state is remembered")
	await _shoot("actions-4c-goal-expanded-list-open")
	(panel.find_child("GoalHeader", true, false) as Button).pressed.emit()
	await _until(func() -> bool: return not panel.goal_open(), 5.0)
	saved = await main.engine.request("actions.layout")
	_check(not bool(saved.get("result", {}).get("goalOpen", true)), "a minimized goal is remembered too")
	(panel.find_child("GoalHeader", true, false) as Button).pressed.emit()
	await _until(func() -> bool: return panel.goal_open(), 5.0)
	await _frames(3)

	var handle := panel._resize
	_check(handle != null and handle.tooltip_text == "Drag to resize. Double-click for the default height." and handle.size.y == 8.0, "the panel's top edge is a resize handle")
	var height_before := panel.size.y
	var limits := panel.drag_limits()
	var press := InputEventMouseButton.new()
	press.button_index = MOUSE_BUTTON_LEFT
	press.pressed = true
	press.global_position = Vector2(100, 500)
	handle._gui_input(press)
	var drag := InputEventMouseMotion.new()
	drag.global_position = Vector2(100, 440)
	handle._gui_input(drag)
	await _frames(2)
	_check(handle.lit(), "the grip lights while it is dragged")
	var release := InputEventMouseButton.new()
	release.button_index = MOUSE_BUTTON_LEFT
	release.pressed = false
	release.global_position = Vector2(100, 440)
	handle._gui_input(release)
	var wanted := roundf(clampf(height_before + 60.0, limits.x, limits.y))
	await _until(func() -> bool:
		return absf(panel.size.y - wanted) < 1.5, 5.0)
	_check(absf(panel.size.y - wanted) < 1.5, "dragging the top edge up makes the panel taller (%.0f -> %.0f)" % [height_before, panel.size.y])
	saved = await main.engine.request("actions.layout")
	_check(saved.get("result", {}).get("height") != null and absf(float(saved["result"]["height"]) - wanted) < 1.5, "the dragged height is remembered (%s)" % str(saved.get("result", {}).get("height")))
	await _shoot("actions-9-resized")
	handle.grab_focus()
	handle._gui_input(_key(KEY_DOWN))
	await _until(func() -> bool: return absf(panel.size.y - (wanted - 16.0)) < 1.5, 5.0)
	_check(absf(panel.size.y - (wanted - 16.0)) < 1.5, "the down arrow on the focused edge takes 16 px off")
	handle._gui_input(_key(KEY_HOME))
	await _until(func() -> bool: return absf(panel.size.y - limits.x) < 1.5, 5.0)
	_check(absf(panel.size.y - limits.x) < 1.5, "Home makes it the shortest (%.0f)" % panel.size.y)
	var twice := InputEventMouseButton.new()
	twice.button_index = MOUSE_BUTTON_LEFT
	twice.pressed = true
	twice.double_click = true
	handle._gui_input(twice)
	await _until(func() -> bool: return absf(panel.size.y - height_before) < 1.5, 5.0)
	_check(absf(panel.size.y - height_before) < 1.5, "a double-click gives back the usual height (%.0f, was %.0f)" % [panel.size.y, height_before])
	saved = await main.engine.request("actions.layout")
	_check(saved.get("result", {}).get("height") == null, "the usual height is no longer stored")
	handle.release_focus()
	await _frames(2)


func _card_named(panel: ProjectsPanel, name: String) -> Dictionary:
	for key in ["mine", "abroad"]:
		for entry in panel._view.get(key, []):
			if str((entry as Dictionary).get("name", "")) == name:
				return entry
	return {}


func _world_project(name: String) -> Dictionary:
	var world: Dictionary = (await main.engine.request("doc.read", {"key": "world"})).get("result", {})
	for project in world.get("projects", []):
		if str((project as Dictionary).get("name", "")) == name:
			return project
	return {}


func _projects_checks() -> void:
	var actions := ActionsPanel.new()
	main.hud.add_child(actions)
	actions.setup(main.engine, {})
	actions.open_advisor.connect(func(text: String) -> void: advisor_texts.append(text))
	actions.show_on_map.connect(func(lng: float, lat: float, zoom: float) -> void: map_targets.append(Vector3(lng, lat, zoom)))
	actions.set_tab("projects")
	actions.open()
	var panel := actions.board()
	_check(panel != null and actions.current_tab() == "projects", "Projects is the Actions panel's second tab")
	await _until(func() -> bool: return panel._loaded, 20.0)
	await _wait(0.5)
	_check(int(panel._view.get("total", -1)) == 0, "a new game's board is empty")
	var new_button := _find_button(panel, "＋ New project")
	_check(new_button != null, "an empty board offers New project and nothing else to fill")
	_check(not panel._search_holder.visible and not panel._chips.visible, "with nothing known the search and the filters stay hidden")
	var means: Dictionary = panel._view.get("means", {})
	var means_line := "Estimated project allowance" if bool(means.get("assessed", false)) else "No native GDP baseline"
	_check(_find_label_containing(panel._means_row, means_line) != null, "the budget line says what the player has for projects (%s)" % means_line)
	await _shoot("projects-1-empty")

	new_button.pressed.emit()
	await _frames(2)
	_check(panel._np_open and panel._np_name.is_visible_in_tree() and panel._np_goal.is_visible_in_tree(), "New project opens the name and goal fields")
	var plan_button := _find_button(panel, "Plan it")
	_check(plan_button != null and plan_button.disabled, "Plan it waits for a name")
	panel._np_name.text = "Northern Grid"
	panel._np_name.text_changed.emit("Northern Grid")
	panel._np_goal.text = "Tie the northern wind farms to the cities of the south."
	await _frames(2)
	plan_button = _find_button(panel, "Plan it")
	_check(plan_button != null and not plan_button.disabled, "a name arms Plan it")
	plan_button.pressed.emit()
	await _frames(1)
	_check(_find_label(panel, "One AI request") != null, "planning says it is one AI request")
	await _until(func() -> bool: return panel._np_draft != null or not panel._np_error.is_empty(), 30.0)
	_check(panel._np_draft != null, "the plan comes back from the model (%s)" % panel._np_error)
	await _frames(3)
	_check(_find_label(panel, "Northern Grid Upgrade") != null and _find_label(panel, "240 days of work") != null, "the plan card shows the plan's name and its days of work")
	_check(_find_label_containing(panel, "a month") != null and _find_label(panel, "WHEN DONE") != null, "the plan card shows its monthly cost and what it does when done")
	_check(_find_label(panel, "Route surveyed") != null, "the plan card lists its checkpoints")
	await _shoot("projects-2-plan")
	_find_button(panel, "Start").pressed.emit()
	await _until(func() -> bool: return not panel._np_open and _card_named(panel, "Northern Grid Upgrade").size() > 0, 20.0)
	var started := await _world_project("Northern Grid Upgrade")
	_check(not started.is_empty() and str(started.get("ownerCode", "")).is_empty() and typeof(started.get("plan")) == TYPE_DICTIONARY, "Start writes the player's project with its plan")
	_check(_find_label(panel, "YOUR PROJECTS") != null, "the player's projects stand under Your projects")

	var view: Dictionary = (await main.engine.request("game.view")).get("result", {})
	var event_ids: Array = []
	for event in view.get("events", []):
		event_ids.append(str((event as Dictionary).get("id", "")))
	event_ids = event_ids.slice(maxi(0, event_ids.size() - 2))
	var ops := [
		{"op": "create", "name": "Grand Paris Rail Link", "kind": "project", "secrecy": "public", "summary": "A new high-speed line tying the capital to the northern ports.", "tags": ["infrastructure", "economy"], "plan": {"durationDays": 400, "monthlyCost": 900000000, "milestones": [{"title": "Tunnel boring complete", "atProgress": 30}, {"title": "Tracks laid", "atProgress": 70}], "effects": [{"type": "stat", "stat": "economy.gdpGrowth", "change": 0.4}, {"type": "structure", "name": "Paris-Lille high-speed line"}]}},
		{"op": "create", "name": "Operation Mistral", "kind": "operation", "secrecy": "covert", "summary": "Covert support for a friendly faction abroad.", "tags": ["covert", "military"], "plan": {"durationDays": 180, "monthlyCost": 150000000}},
		{"op": "create", "name": "Pension Reform", "kind": "project", "secrecy": "public", "summary": "Raising the retirement age.", "tags": ["economy"], "plan": {"durationDays": 300, "monthlyCost": 200000000}},
		{"op": "create", "name": "Baltic Shipyard Expansion", "kind": "project", "ownerCode": "Germany", "secrecy": "public", "summary": "Germany is said to be doubling the yards at Kiel.", "tags": ["naval", "military"], "plan": {"durationDays": 300, "monthlyCost": 400000000, "ongoing": true, "yields": [{"type": "stat", "stat": "military.sea", "change": 0.5}]}},
		{"op": "create", "name": "Atlantic Patrol Renewal", "kind": "operation", "ownerCode": "United Kingdom", "secrecy": "covert", "summary": "A new rotation of frigates for the Western Approaches.", "tags": ["naval"], "plan": {"durationDays": 200, "monthlyCost": 100000000}},
		{"op": "create", "name": "Kaliningrad Air Defence", "kind": "operation", "ownerCode": "Russia", "secrecy": "restricted", "summary": "New air-defence batteries around Kaliningrad.", "tags": ["military"], "plan": {"durationDays": 150, "monthlyCost": 300000000}},
	]
	var edits := [
		{"name": "Grand Paris Rail Link", "milestonesReached": 1, "set": {"progress": 35, "lastUpdate": "Boring machines reached the Seine crossing.", "eventIds": event_ids, "focus": {"lng": 2.35, "lat": 48.85}}},
		{"name": "Operation Mistral", "set": {"progress": 60, "status": "stalled", "stallReason": "funds"}},
		{"name": "Pension Reform", "set": {"progress": 40, "status": "cancelled", "spent": 2400000000}},
		{"name": "Baltic Shipyard Expansion", "set": {"progress": 20, "verification": "doubted"}},
		{"name": "Kaliningrad Air Defence", "set": {"progress": 50, "known": true}},
	]
	var seeded: Dictionary = await main.engine.request("projects.testSeed", {"ops": ops, "edits": edits})
	_check(seeded.get("ok", false), "seeded six projects from outside the panel, three of them abroad")
	var live := await _until(func() -> bool: return int(panel._view.get("total", 0)) == 7 and int(panel._view.get("knownCount", 0)) == 6, 10.0)
	_check(live, "the open board picks up the new entries without being reopened")
	await _wait(0.6)
	_check(int(panel._view.get("knownCount", 0)) == 6, "the covert British patrol nobody has found stays off the board (%d known)" % int(panel._view.get("knownCount", 0)))
	_check((panel._view.get("mine", []) as Array).size() == 3 and (panel._view.get("abroad", []) as Array).size() == 2, "three of the player's own running and two abroad")
	_check(_find_label(panel, "KNOWN PROJECTS ABROAD") != null, "the projects of other countries stand under Known projects abroad")
	_check(_find_button(panel, "Closed (1)") != null, "the Closed chip counts the closed project")
	_check(_find_label(panel, "Mine (3)") == null and _find_button(panel, "Foreign (2)") == null, "no Mine and Foreign chips: the board is one list in two sections")
	await _until(func() -> bool: return actions._project_count == 5, 6.0)
	_check(actions._project_count == 5, "the Projects tab counts the open projects the player knows of (%d)" % actions._project_count)
	var mistral := _card_named(panel, "Operation Mistral")
	_check(str(mistral.get("stallReason", "")) == "funds" and _find_label(panel, "STALLED: NO FUNDS") != null, "a stalled project says why")
	_check(_find_label_containing(panel, "Planned cost: ") != null, "an open project of the player's says its cost a month")
	await _shoot("projects-3-board")

	var rail_card := _card_for(panel, "Grand Paris Rail Link")
	_check(_find_label(rail_card, "Tunnel boring complete") != null and _find_label(rail_card, "Tracks laid") != null and _find_label(rail_card, "70%") != null, "the card lists its checkpoints, the one ahead at its share of the work")
	_check(_find_label_containing(rail_card, "Builds Paris-Lille high-speed line") != null, "the card says what it does when done")
	var ask := _find_button(rail_card, "🧭 Ask advisor")
	if ask:
		ask.pressed.emit()
		_check(str(advisor_texts.back()) == "Brief me in full on the project \"Grand Paris Rail Link\". Where does it actually stand right now, what has moved since the last round, what does the next milestone need from me, and what is most likely to go wrong? Be specific and tell me if the board is out of date.", "Ask advisor seeds beta's brief")
	var locate := _find_button(rail_card, "📍 Show on map")
	if locate:
		locate.pressed.emit()
		await _until(func() -> bool: return not map_targets.is_empty(), 10.0)
		_check(not map_targets.is_empty() and is_equal_approx(map_targets[0].x, 2.35) and is_equal_approx(map_targets[0].z, 5.0), "Show on map emits the project's focus at zoom 5")
	var activity := _find_button(rail_card, "▸ Activity (%d)" % event_ids.size())
	if activity:
		activity.pressed.emit()
		await _until(func() -> bool: return panel._expanded != "" and _find_button(panel, "▾ Activity (%d)" % event_ids.size()) != null, 10.0)
		_check(_find_button(panel, "▾ Activity (%d)" % event_ids.size()) != null, "Activity expands the event feed")

	var high := _find_button(_card_for(panel, "Grand Paris Rail Link"), "High")
	_check(high != null and high.tooltip_text == "One and a half times the cost and the speed", "the funding switch offers Off, Low, Normal and High")
	if high:
		high.pressed.emit()
		await _until(func() -> bool: return str(_card_named(panel, "Grand Paris Rail Link").get("funding", "")) == "high", 15.0)
	var rail: Dictionary = await _world_project("Grand Paris Rail Link")
	_check(str(rail.get("funding", "")) == "high", "a funding change is written to the world (%s)" % str(rail.get("funding", "")))
	var visibility: OptionButton = null
	for node in _card_for(panel, "Grand Paris Rail Link").find_children("*", "OptionButton", true, false):
		visibility = node as OptionButton
	_check(visibility != null and str(visibility.get_item_metadata(visibility.selected)) == "public", "the Visibility select shows the project's secrecy")
	if visibility:
		visibility.select(1)
		visibility.item_selected.emit(1)
		await _until(func() -> bool: return str(_card_named(panel, "Grand Paris Rail Link").get("secrecy", "")) == "restricted", 15.0)
	rail = await _world_project("Grand Paris Rail Link")
	_check(str(rail.get("secrecy", "")) == "restricted", "a visibility change is written to the world (%s)" % str(rail.get("secrecy", "")))
	panel._cards_scroll.ensure_control_visible(_find_button(_card_for(panel, "Grand Paris Rail Link"), "High"))
	await _wait(0.2)
	await _shoot("projects-4-funding")

	var abandon := _find_button(_card_for(panel, "Operation Mistral"), "Abandon")
	if abandon:
		abandon.pressed.emit()
		await _frames(2)
		_check(abandon.text == "Confirm abandon?", "Abandon asks to confirm first")
		abandon.pressed.emit()
		await _until(func() -> bool: return int(panel._view.get("closedCount", 0)) == 2, 15.0)
		_check(int(panel._view.get("closedCount", 0)) == 2, "the confirmed Abandon closes the entry")

	var baltic := _card_for(panel, "Baltic Shipyard Expansion")
	_check(_find_button(baltic, "🧭 What do we know?") != null and _find_button(baltic, "⚖ Our options") != null, "cards abroad offer What do we know? and Our options")
	_check(_find_button(baltic, "Abandon") == null and _find_button(baltic, "High") == null, "cards abroad carry no funding and no Abandon")
	_check(_find_label(baltic, "EVERY MONTH") != null and _find_label(baltic, "Runs on once set up") != null, "a programme abroad says it runs on and what it yields every month")
	var counter := _find_button(baltic, "⚖ Our options")
	if counter:
		counter.pressed.emit()
		_check(str(advisor_texts.back()) == "What can we actually do about Germany's \"Baltic Shipyard Expansion\"? Lay out the realistic options — diplomatic, economic, covert, or simply outpacing them — with what each would cost us and how it could go wrong. If we settle on one, open it as our own effort.", "Our options seeds beta's counter question")
	panel._cards_scroll.ensure_control_visible(baltic)
	await _wait(0.2)
	await _shoot("projects-5-abroad")

	panel._tag_button.pressed.emit()
	await _until(func() -> bool: return panel._menu_open and panel._menu_rows.size() > 0, 10.0)
	await _wait(0.3)
	_check(panel._menu_rows.size() == 6, "the Tags menu lists every tag the player can see (%d)" % panel._menu_rows.size())
	_check(_focus_owner() == panel._menu_rows[0], "the menu takes the focus on its first tag")
	panel._menu_rows[0].gui_input.emit(_key(KEY_RIGHT))
	_check(_focus_owner() == panel._menu_rows[1], "Right moves to the next tag")
	panel._menu_rows[3].gui_input.emit(_key(KEY_END))
	_check(_focus_owner() == panel._menu_rows[5], "End goes to the last tag")
	var naval_index := -1
	for index in range(panel._menu_rows.size()):
		if str(panel._menu_rows[index].get_meta("tag")) == "naval":
			naval_index = index
	panel._menu_rows[naval_index].grab_focus()
	panel._menu_rows[naval_index].gui_input.emit(_key(KEY_ENTER))
	await _until(func() -> bool: return (panel._view.get("activeTags", []) as Array).has("naval"), 10.0)
	_check(int(panel._view.get("visibleCount", 0)) == 1, "Enter ticks naval and only the Baltic yards stay")
	await _wait(0.3)
	await _shoot("projects-6-tags-menu")
	root.push_input(_key(KEY_ESCAPE))
	await _frames(3)
	_check(not panel._menu_open and _focus_owner() == panel._tag_button, "Escape shuts the menu and returns to the Tags button")
	panel._tags = []
	panel._request_view()
	await _until(func() -> bool: return (panel._view.get("activeTags", []) as Array).is_empty(), 10.0)
	_find_button(panel, "Closed (2)").pressed.emit()
	await _until(func() -> bool: return bool(panel._view.get("showClosed", false)), 10.0)
	_check(int(panel._view.get("visibleCount", 0)) == 2 and _find_button(panel, "← Running (4)") != null, "Closed is its own view with a way back")
	var pension := _card_named(panel, "Pension Reform")
	_check(not str(pension.get("spent", "")).is_empty() and _find_label_containing(panel, "Actually paid to date: ") != null and _find_label_containing(_card_for(panel, "Pension Reform"), "Planned cost") == null, "a closed project shows what it spent, not a monthly cost")
	await _shoot("projects-7-closed")
	panel._search.text = "zzz"
	panel._search.text_changed.emit("zzz")
	await _until(func() -> bool: return int(panel._view.get("visibleCount", -1)) == 0, 10.0)
	_check(_find_label(panel, "No closed entries match those filters.") != null, "a search with no hits says so")
	panel._search.text = ""
	panel._search.text_changed.emit("")
	actions.close()
	await _wait(0.5)
	_check(not panel._show_closed and panel._expanded.is_empty(), "closing resets the view to running work")
	actions.queue_free()
	await _recovery_checks()


func _recovery_checks() -> void:
	var game_id := str(main.get("game_id"))
	var dialog: Control = (load("res://scripts/ui/project_recovery_dialog.gd") as GDScript).new()
	dialog.call("setup", main.engine, {"id": game_id, "name": str(main.game_name)})
	var made_ids: Array[String] = []
	dialog.connect("created", func(id: String) -> void: made_ids.append(id))
	var layer := CanvasLayer.new()
	layer.layer = 100
	main.add_child(layer)
	layer.add_child(dialog)
	await _until(func() -> bool: return not bool(dialog.get("loading")), 20.0)
	await _frames(3)
	var inspection: Dictionary = dialog.get("inspection")
	_check(not inspection.is_empty() and not inspection.has("failure"), "the recovery dialog reads the whole campaign (%s)" % str(dialog.get("error")))
	_check(_find_label_containing(dialog, "No board is over the live limit.") != null, "a board under the limit says nothing must be shelved")
	_check(_find_button(dialog, "Create recovered copy") != null and _find_button(dialog, "Create recovered copy").disabled, "Create recovered copy waits for a choice")
	await _shoot("projects-8-recovery")
	var closed_pick := _find_button(dialog, "Select closed")
	_check(closed_pick != null, "a board with closed projects offers Select closed")
	if closed_pick:
		closed_pick.pressed.emit()
		await _frames(2)
	var picked: Array = dialog.get("picked_shelve")
	_check(picked.size() == 2, "Select closed ticks the two closed projects (%d)" % picked.size())
	var create := _find_button(dialog, "Create recovered copy")
	_check(create != null and not create.disabled, "a choice arms Create recovered copy")
	if create:
		create.pressed.emit()
		await _until(func() -> bool: return not made_ids.is_empty() or not str(dialog.get("error")).is_empty(), 30.0)
	_check(made_ids.size() == 1 and not made_ids[0].is_empty() and made_ids[0] != game_id, "a recovered copy is made as a new game (%s)" % str(dialog.get("error")))
	_check(_find_label_containing(dialog, "Recovered game created: ") != null, "the dialog says the copy was made and the original is unchanged")
	await _shoot("projects-9-recovered")
	var world: Dictionary = (await main.engine.request("doc.read", {"key": "world"})).get("result", {})
	_check((world.get("projects", []) as Array).size() == 7, "the original campaign keeps every project")
	layer.queue_free()
	await _frames(2)


func _finish() -> void:
	_say("%s with %d failure(s)" % ["DONE" if failures == 0 else "FAILED", failures])
	main.engine.stop()
	await _frames(2)
	quit(1 if failures > 0 else 0)
