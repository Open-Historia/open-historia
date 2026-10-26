extends SceneTree

var main: Node
var shots := ""
var downloads := ""
var started := 0
var failures := 0
var advisor_texts: Array[String] = []
var map_targets: Array[Vector3] = []


func _initialize() -> void:
	shots = OS.get_environment("OH_SHOTS")
	downloads = OS.get_environment("OH_NATIVE_DOWNLOADS")
	started = Time.get_ticks_msec()
	main = (load("res://main.tscn") as PackedScene).instantiate()
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


func _run() -> void:
	while not main.menu.visible:
		if Time.get_ticks_msec() - started > 90000:
			_say("FAIL the menu never appeared")
			failures += 1
			_finish()
			return
		await process_frame
	_say("menu ready")
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

	_find_button(panel, "Brainstorm").pressed.emit()
	_check(advisor_texts.size() == 1 and advisor_texts[0] == ActionsPanel.BRAINSTORM_TEXT, "Brainstorm asks for the advisor with the React starter text")

	panel._composer.text = "Raise taxes"
	panel._composer.set_caret_column(panel._composer.text.length())
	panel._composer.gui_input.emit(_key(KEY_ENTER, true))
	_check(panel._composer.text.contains("\n"), "Shift+Enter adds a new line instead of sending")
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

	panel._open_section = "submitted"
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
	await _shoot("actions-8-after-skip")
	panel.close()
	await _wait(0.5)
	panel.queue_free()
	await _frames(2)


func _projects_checks() -> void:
	var panel := ProjectsPanel.new()
	main.hud.add_child(panel)
	panel.setup(main.engine, {})
	panel.open_advisor.connect(func(text: String) -> void: advisor_texts.append(text))
	panel.show_on_map.connect(func(lng: float, lat: float, zoom: float) -> void: map_targets.append(Vector3(lng, lat, zoom)))
	panel.open()
	await _until(func() -> bool: return panel._loaded, 20.0)
	await _wait(0.5)
	_check(int(panel._view.get("total", -1)) == 0, "a new game's board is empty")
	_check(_find_label(panel, "Nothing on the board yet") != null, "the empty board shows its backfill card")
	var backfill := _find_button(panel, "🧭 Ask your advisor to populate this")
	_check(backfill != null and not backfill.disabled, "the backfill button is live")
	if backfill:
		backfill.pressed.emit()
		_check(advisor_texts.back() == ProjectsPanel.BACKFILL_PROMPT, "the backfill button seeds the advisor with the React prompt")
	await _shoot("projects-1-empty")

	var view: Dictionary = (await main.engine.request("game.view")).get("result", {})
	var today := str(view.get("gameDate", ""))
	var event_ids: Array = []
	for event in view.get("events", []):
		event_ids.append(str((event as Dictionary).get("id", "")))
	event_ids = event_ids.slice(maxi(0, event_ids.size() - 2))
	var ops := [
		{"op": "create", "name": "Grand Paris Rail Link", "kind": "project", "status": "active", "priority": "high", "summary": "A new high-speed line tying the capital to the northern ports.", "tags": ["infrastructure", "economy"], "progress": 35, "startedAt": _shift(today, -200), "targetDate": _shift(today, 400), "milestones": [{"title": "Tunnel boring complete", "date": _shift(today, 20), "status": "pending"}], "lastUpdate": "Boring machines reached the Seine crossing.", "eventIds": event_ids, "focus": {"lng": 2.35, "lat": 48.85}},
		{"op": "create", "name": "Operation Mistral", "kind": "operation", "status": "stalled", "secrecy": "covert", "summary": "Covert support for a friendly faction abroad.", "tags": ["covert", "military"], "progress": 60, "startedAt": _shift(today, -300), "targetDate": _shift(today, -12)},
		{"op": "create", "name": "Baltic Shipyard Expansion", "kind": "project", "ownerCode": "Germany", "status": "active", "verification": "doubted", "summary": "Germany is said to be doubling the yards at Kiel.", "tags": ["naval", "military"], "progress": 20, "ongoing": true, "startedAt": _shift(today, -90)},
		{"op": "create", "name": "Atlantic Patrol Renewal", "kind": "operation", "ownerCode": "United Kingdom", "status": "proposed", "summary": "A new rotation of frigates for the Western Approaches.", "tags": ["naval"], "progress": 5, "startedAt": _shift(today, -10), "targetDate": _shift(today, 200), "milestones": [{"title": "Quarterly patrol", "date": _shift(today, 40), "status": "pending", "repeat": "quarterly"}]},
		{"op": "create", "name": "Pension Reform", "kind": "project", "status": "failed", "summary": "Raising the retirement age.", "tags": ["economy"], "progress": 40, "startedAt": _shift(today, -400), "targetDate": _shift(today, -30)},
	]
	var seeded: Dictionary = await main.engine.request("projects.testSeed", {"ops": ops})
	_check(seeded.get("ok", false), "seeded five board entries from outside the panel")
	var live := await _until(func() -> bool: return int(panel._view.get("total", 0)) == 5, 6.0)
	_check(live, "the open board picks up the new entries without being reopened")
	await _wait(0.6)
	_check(int(panel._view.get("mineCount", 0)) == 3 and int(panel._view.get("foreignCount", 0)) == 2, "Mine and Foreign counts (3 / 2)")
	_check(int(panel._view.get("visibleCount", 0)) == 2, "Mine opens on the two running entries of the player")
	_check(_find_button(panel, "Closed (1)") != null, "the Closed chip shows the count")
	_check(_find_button(panel, "Foreign (2)") != null, "the Foreign chip shows the count")
	_check(panel._count_label.text == "2 / 5", "the header counts visible / total (%s)" % panel._count_label.text)
	await _shoot("projects-2-mine")

	var cards: Array = panel._view.get("cards", [])
	var rail: Dictionary = {}
	for entry in cards:
		if str((entry as Dictionary).get("name", "")) == "Grand Paris Rail Link":
			rail = entry
	_check(not rail.is_empty() and str(rail.get("flag", "")).ends_with("fr.svg"), "the player's card carries the French flag")
	var ask := _find_button(_card_for(panel, "Grand Paris Rail Link"), "🧭 Ask advisor")
	if ask:
		ask.pressed.emit()
		_check(str(advisor_texts.back()) == "Brief me in full on the project \"Grand Paris Rail Link\". Where does it actually stand right now, what has moved since the last round, what does the next milestone need from me, and what is most likely to go wrong? Be specific and tell me if the board is out of date.", "Ask advisor seeds the React brief")
	var locate := _find_button(_card_for(panel, "Grand Paris Rail Link"), "📍 Show on map")
	if locate:
		locate.pressed.emit()
		await _until(func() -> bool: return not map_targets.is_empty(), 10.0)
		_check(not map_targets.is_empty() and is_equal_approx(map_targets[0].x, 2.35) and is_equal_approx(map_targets[0].z, 5.0), "Show on map emits the project's focus at zoom 5")
	var activity := _find_button(_card_for(panel, "Grand Paris Rail Link"), "▸ Activity (%d)" % event_ids.size())
	if activity:
		activity.pressed.emit()
		await _until(func() -> bool: return panel._expanded != "" and _find_button(panel, "▾ Activity (%d)" % event_ids.size()) != null, 10.0)
		_check(_find_button(panel, "▾ Activity (%d)" % event_ids.size()) != null, "Activity expands the event feed")
	await _shoot("projects-3-expanded")

	var low := _find_button(_card_for(panel, "Grand Paris Rail Link"), "▼")
	if low:
		low.pressed.emit()
		await _until(func() -> bool:
			for entry in panel._view.get("cards", []):
				if str((entry as Dictionary).get("name", "")) == "Grand Paris Rail Link" and str((entry as Dictionary).get("priority", "")) == "low":
					return true
			return false, 15.0)
	var world: Dictionary = (await main.engine.request("doc.read", {"key": "world"})).get("result", {})
	var saved_priority := ""
	for project in world.get("projects", []):
		if str((project as Dictionary).get("name", "")) == "Grand Paris Rail Link":
			saved_priority = str((project as Dictionary).get("priority", ""))
	_check(saved_priority == "low", "a priority change is written to the world (%s)" % saved_priority)

	var abandon := _find_button(_card_for(panel, "Operation Mistral"), "Abandon")
	if abandon:
		abandon.pressed.emit()
		await _frames(2)
		_check(abandon.text == "Confirm abandon?", "Abandon asks to confirm first")
		panel._cards_scroll.ensure_control_visible(abandon)
		await _wait(0.2)
		await _shoot("projects-4-confirm-abandon")
		abandon.pressed.emit()
		await _until(func() -> bool: return int(panel._view.get("closedCount", 0)) == 2, 15.0)
		_check(int(panel._view.get("closedCount", 0)) == 2, "the confirmed Abandon closes the entry")

	_find_button(panel, "Foreign (2)").pressed.emit()
	await _until(func() -> bool: return str(panel._view.get("owner", "")) == "foreign", 10.0)
	_check(_find_button(panel, "🧭 What do we know?") != null and _find_button(panel, "⚖ Our options") != null, "foreign cards offer What do we know? and Our options")
	_check(_find_button(panel, "Abandon") == null, "foreign cards carry no Abandon")
	var counter := _find_button(_card_for(panel, "Baltic Shipyard Expansion"), "⚖ Our options")
	if counter:
		counter.pressed.emit()
		_check(str(advisor_texts.back()) == "What can we actually do about Germany's \"Baltic Shipyard Expansion\"? Lay out the realistic options — diplomatic, economic, covert, or simply outpacing them — with what each would cost us and how it could go wrong. If we settle on one, open it as our own effort.", "Our options seeds the React counter question")
	await _shoot("projects-5-foreign")

	panel._tag_button.pressed.emit()
	await _until(func() -> bool: return panel._menu_open and panel._menu_rows.size() > 0, 10.0)
	await _wait(0.3)
	_check(panel._menu_rows.size() == 5, "the Tags menu lists every tag (%d)" % panel._menu_rows.size())
	_check(_focus_owner() == panel._menu_rows[0], "the menu takes the focus on its first tag")
	panel._menu_rows[0].gui_input.emit(_key(KEY_RIGHT))
	_check(_focus_owner() == panel._menu_rows[1], "Right moves to the next tag")
	panel._menu_rows[1].gui_input.emit(_key(KEY_DOWN))
	_check(_focus_owner() == panel._menu_rows[3], "Down moves a row down the grid")
	panel._menu_rows[3].gui_input.emit(_key(KEY_END))
	_check(_focus_owner() == panel._menu_rows[4], "End goes to the last tag")
	var naval_index := -1
	for index in range(panel._menu_rows.size()):
		if str(panel._menu_rows[index].get_meta("tag")) == "naval":
			naval_index = index
	panel._menu_rows[naval_index].grab_focus()
	panel._menu_rows[naval_index].gui_input.emit(_key(KEY_ENTER))
	await _until(func() -> bool: return (panel._view.get("activeTags", []) as Array).has("naval"), 10.0)
	_check(int(panel._view.get("visibleCount", 0)) == 2, "Enter ticks naval and both naval foreign entries stay")
	await _wait(0.3)
	_check(_focus_owner() != null and str(_focus_owner().get_meta("tag", "")) == "naval", "the ticked tag keeps the focus")
	await _shoot("projects-6-tags-menu")
	root.push_input(_key(KEY_ESCAPE))
	await _frames(3)
	_check(not panel._menu_open and _focus_owner() == panel._tag_button, "Escape shuts the menu and returns to the Tags button")
	panel._tags = []
	panel._owner = "all"
	panel._request_view()
	await _until(func() -> bool: return str(panel._view.get("owner", "")) == "all" and (panel._view.get("activeTags", []) as Array).is_empty(), 10.0)
	_find_button(panel, "Closed (2)").pressed.emit()
	await _until(func() -> bool: return bool(panel._view.get("showClosed", false)), 10.0)
	_check(int(panel._view.get("visibleCount", 0)) == 2 and _find_button(panel, "← Running (3)") != null, "Closed is its own view with a way back")
	await _shoot("projects-7-closed")
	panel._search.text = "zzz"
	panel._search.text_changed.emit("zzz")
	await _until(func() -> bool: return int(panel._view.get("visibleCount", -1)) == 0, 10.0)
	_check(_find_label(panel, "No closed entries match those filters.") != null, "a search with no hits says so")
	panel.close()
	await _wait(0.5)
	_check(panel._owner == "mine" and not panel._show_closed, "closing resets the view to Mine and running work")


func _finish() -> void:
	_say("%s with %d failure(s)" % ["DONE" if failures == 0 else "FAILED", failures])
	main.engine.stop()
	await _frames(2)
	quit(1 if failures > 0 else 0)
