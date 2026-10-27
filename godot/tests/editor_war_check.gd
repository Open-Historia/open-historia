extends SceneTree

var main: Node
var shots := ""
var started := 0
var failures := 0
var host: Control
var scroll: ScrollContainer
var column: VBoxContainer
var last_value: Variant = null
var value_events := 0
var details_events := 0
var stop_armed := false
var military_ref: EditorMilitaryPanel


func _initialize() -> void:
	shots = OS.get_environment("OH_SHOTS")
	started = Time.get_ticks_msec()
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.mouse_passthrough = true
	root.add_child(main)
	_run.call_deferred()


func _say(text: String) -> void:
	print("[editor_war %6d ms] %s" % [Time.get_ticks_msec() - started, text])


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
	var found := _find_all(node, func(entry: Node) -> bool: return entry is Button and (entry as Button).text == text, [])
	return found[0] if not found.is_empty() else null


func _line(node: Node, placeholder: String) -> Array:
	return _find_all(node, func(entry: Node) -> bool: return entry is LineEdit and (entry as LineEdit).placeholder_text == placeholder, [])


func _type(edit: LineEdit, text: String) -> void:
	edit.text = text
	edit.text_changed.emit(text)


func _scroll_to(node: Control) -> void:
	await _frames(6)
	scroll.scroll_vertical = int(node.global_position.y - column.global_position.y) - 10
	await _frames(2)


func _confirm_soon() -> void:
	for attempt in range(120):
		await process_frame
		var dialogs := _find_all(host, func(entry: Node) -> bool: return entry is ConfirmationDialog and (entry as ConfirmationDialog).visible, [])
		if not dialogs.is_empty():
			var dialog: ConfirmationDialog = dialogs[0]
			_say("confirm: " + dialog.dialog_text)
			dialog.confirmed.emit()
			dialog.hide()
			return


func _make_host() -> void:
	host = Control.new()
	host.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var page := ColorRect.new()
	page.color = EditorKit.PANEL
	page.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	host.add_child(page)
	scroll = ScrollContainer.new()
	scroll.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	scroll.offset_left = 270
	scroll.offset_right = -250
	scroll.offset_top = 20
	scroll.offset_bottom = -20
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	host.add_child(scroll)
	column = VBoxContainer.new()
	column.custom_minimum_size.x = 900
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.add_theme_constant_override("separation", 0)
	scroll.add_child(column)
	main.ui.add_child(host)



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
	while not main.menu.visible:
		if Time.get_ticks_msec() - started > 90000:
			_say("FAIL the menu never appeared")
			_finish()
			return
		await process_frame
	_say("menu ready")
	await _clear_shell()
	var opened: Dictionary = await main.engine.request("editor.open", {"kind": "scenario", "id": "default"})
	if not opened.get("ok", false):
		_check(false, "editor.open: %s" % opened.get("error", ""))
		_finish()
		return
	var details: Dictionary = opened["result"]["details"]
	var form: Dictionary = opened["result"]["form"]
	_make_host()
	await _history(details, form)
	EditorKit.clear(column)
	await _frames(2)
	var reopened: Dictionary = await main.engine.request("editor.open", {"kind": "scenario", "id": "default"})
	await _fronts_tab(reopened["result"]["details"], reopened["result"]["form"])
	_finish()


func _history(details: Dictionary, form: Dictionary) -> void:
	var history := EditorHistoryPanel.new()
	column.add_child(history)
	history.details_changed.connect(func(_next: Dictionary) -> void: details_events += 1)
	history.setup(main.engine, {"kind": "scenario", "details": details, "form": form, "host": host})
	await _shoot("war-1-history-empty")
	_check(_button(history, "Generate pre-history") != null, "the Generate button is there")
	var prompt := "The two years of crises before 2016, seen from the great powers."
	history._prompt_edit.text = prompt
	history._prompt_edit.text_changed.emit()
	var started_at := Time.get_ticks_msec()
	await history._generate()
	var events: Array = history._draft.get("events", [])
	_say("generated %d events in %d ms; message: %s; error: %s" % [events.size(), Time.get_ticks_msec() - started_at, history._message, history._error])
	_check(events.size() == 4, "generation filled the draft with the stand-in's four events")
	_check(history._message == "Generated. Edit anything below, then save the pre-history.", "the generated message")
	_check(history._day_one.visible and history._day_one_rows.get_child_count() == 2, "two Day-one facts listed")
	for row in history._day_one_rows.get_children():
		_say("  day one: " + str((_find_all(row, func(entry: Node) -> bool: return entry is Label, [])[0] as Label).text))
	await _shoot("war-2-history-generated")
	var toggles := _find_all(history, func(entry: Node) -> bool: return entry is Button and (entry as Button).text.ends_with("Advanced event metadata"), [])
	if not toggles.is_empty():
		(toggles[0] as Button).pressed.emit()
	var dates := _line(history, "YYYY-MM-DD")
	_type(dates[0], "2017-05-01")
	var titles := _line(history, "Exact event title")
	_type(titles[1], "")
	await _frames(2)
	_check(history._save_button.disabled, "save disabled while events have problems")
	_check(history._problems_holder.visible, "the problems line shows")
	await _scroll_to(history._events_box)
	await _shoot("war-3-history-problems")
	_type(dates[0], "2014-03-18")
	_type(titles[1], "Fighting breaks out in the east")
	var kind_buttons := _find_all(history._events_box.get_child(0), func(entry: Node) -> bool: return entry is Button and (entry as Button).text == "diplomacy", [])
	if not kind_buttons.is_empty():
		(kind_buttons[0] as Button).pressed.emit()
	_check(not history._problems_holder.visible, "problems cleared")
	_check(not history._save_button.disabled, "save enabled")
	var up_buttons := _find_all(history._events_box, func(entry: Node) -> bool: return entry is Button and (entry as Button).tooltip_text == "Move down", [])
	(up_buttons[0] as Button).pressed.emit()
	await _frames(2)
	_say("after move: first title = %s" % str(history._draft["events"][0]["title"]))
	await history._save()
	_check(history._message == "Pre-history saved. New games from this scenario start with it.", "the saved message")
	_check(details_events == 1, "details_changed emitted once on save")
	var check: Dictionary = await main.engine.request("editor.details", {"kind": "scenario", "id": "default"})
	var saved: Dictionary = check["result"]["details"]["data"]["world"].get("prehistory", {})
	var saved_events: Array = saved.get("events", [])
	_say("saved world.prehistory: %d events, prompt=%s, first=%s %s kind=%s, updates canonical=%d" % [saved_events.size(), str(saved.get("prompt", "")), str(saved_events[0].get("date", "")), str(saved_events[0].get("title", "")), str(saved_events[0].get("kind", "")), (saved.get("updates", {}).get("canonicalUpdates", []) as Array).size()])
	_check(saved_events.size() == 4 and str(saved.get("prompt", "")) == prompt, "world.prehistory written with the prompt")
	var facts: Array = saved.get("updates", {}).get("canonicalUpdates", [])
	_say("first Day-one fact keys as saved: " + str((facts[0] as Dictionary).keys()))
	_check(str((facts[0] as Dictionary).keys()[0]) == "ref", "Day-one facts keep the answer's own key order")
	_check(str(saved_events[0].get("date", "")) <= str(saved_events[1].get("date", "")), "saved events are oldest first")
	_check(not history._changed(), "nothing left unsaved after the save")
	await _scroll_to(history)
	await _shoot("war-4-history-saved")
	scroll.scroll_vertical = 100000
	await _shoot("war-5-history-saved-bottom")
	var before := JSON.stringify(history._draft)
	_confirm_soon()
	history._generate()
	await _wait(0.5)
	_check(history._cancel_button.visible and history._generate_button.text == "Generating…", "Cancel shows while generating")
	history._cancel_button.pressed.emit()
	while history._busy:
		await process_frame
	_check(history._message == "Generation cancelled." and JSON.stringify(history._draft) == before, "a cancelled generation changes nothing")
	history._summary_edit.text = "A different summary."
	history._summary_edit.text_changed.emit()
	_check(not history._discard_button.disabled, "Discard enabled after an edit")
	history._discard_button.pressed.emit()
	_check(history._summary_edit.text != "A different summary." and not history._changed(), "Discard puts the saved pre-history back")


func _fronts_tab(details: Dictionary, form: Dictionary) -> void:
	var war := EditorWarSettings.new()
	var military := EditorMilitaryPanel.new()
	var fronts := EditorFrontsPanel.new()
	military_ref = military
	for panel in [war, military, fronts]:
		column.add_child(panel)
	war.value_changed.connect(func(next: Variant) -> void:
		last_value = next
		value_events += 1
		_say("  value_changed: " + JSON.stringify(next))
		military.update_props({"warSettings": next}))
	for panel in [military, fronts]:
		(panel as Node).connect("details_changed", func(next: Dictionary) -> void:
			details_events += 1
			for other in [war, military, fronts]:
				if other != panel:
					other.update_props({"details": next}))
	var props := {"kind": "scenario", "details": details, "form": form, "host": host, "value": form.get("warSettings"), "gameDate": str(form.get("gameDate", "")), "warSettings": form.get("warSettings")}
	war.setup(main.engine, props)
	military.setup(main.engine, props)
	fronts.setup(main.engine, props)
	await _wait(0.6)
	await _shoot("war-6-fronts-tab-top")
	_check(war._era_hint.text == "Read off the game date: From 1945", "era read off 2016-01-01")
	_check(war._warfare_hint.text == "Read off the game date: Fronts", "warfare read off the date")
	_check(war._men_hint.text == "Empty: the era's own, 10,000 men.", "men per counter hint")
	war._era_select.select(2)
	war._era_select.item_selected.emit(2)
	_check(last_value is Dictionary and int(last_value.get("era", -1)) == 1, "era set to 1500 to 1850")
	_check(war._men_hint.text == "Empty: the era's own, 5,000 men.", "men hint follows the era")
	_type(war._men_field, "7.5k")
	war._typed_number("menPerCounter", war._men_field.text, war._men_field)
	_check(war._men_field.text == "7,500" and int(last_value.get("menPerCounter", 0)) == 7500, "men per counter read as a figure")
	_type(war._share_field, "15%")
	war._typed_number("manpowerShare", war._share_field.text, war._share_field)
	_check(is_equal_approx(float(last_value.get("manpowerShare", 0)), 15.0), "manpower share read")
	var weather := _button(war._mechanics, "✓ Seasons and weather")
	weather.pressed.emit()
	_check(last_value.get("mechanics", {}).get("weather") == false, "weather switched off")
	_check(_button(war._mechanics, "○ Seasons and weather") != null, "the switch shows off")
	_type(war._winner, "France")
	_type(war._loser, "Germany")
	war._add()
	_check((last_value.get("outcomes", []) as Array).size() == 1, "an outcome added")
	var chart := war._chart
	var plot: Control = chart._plot
	await _frames(2)
	var s := plot.size.x / EditorWarMusterChart.VIEW_W
	var range_days := chart._max_days()
	var handle := Vector2(chart._view_x(21.0, range_days), chart._view_y(0.5)) * s
	var press := InputEventMouseButton.new()
	press.button_index = MOUSE_BUTTON_LEFT
	press.pressed = true
	press.position = handle
	chart.plot_input(plot, press)
	var move := InputEventMouseMotion.new()
	move.position = Vector2(chart._view_x(40.0, range_days), chart._view_y(0.6)) * s
	chart.plot_input(plot, move)
	var release := InputEventMouseButton.new()
	release.button_index = MOUSE_BUTTON_LEFT
	release.pressed = false
	release.position = move.position
	chart.plot_input(plot, release)
	_say("muster after drag: " + JSON.stringify(last_value.get("muster")))
	_check(last_value.get("muster") is Array and is_equal_approx(float(last_value["muster"][0][0]), 0.6), "the first handle dragged to 60 %")
	_type(chart._fields[3], "120")
	chart._fields[3].focus_exited.emit()
	_check(is_equal_approx(float(last_value["muster"][1][1]), 120.0), "the second point typed as 120 days")
	await _shoot("war-7-war-settings")
	await _scroll_to(war._chart)
	await _shoot("war-8-war-settings-chart")
	await _scroll_to(military)
	await _frames(4)
	_say("military: %s" % military._count_label.text)
	_check(military._count_label.text == "0 of 202 have their figures.", "nobody rated yet")
	await _shoot("war-9-military-before")
	var started_at := Time.get_ticks_msec()
	await military._run(false)
	_say("military run: %s in %d ms; message=%s error=%s" % [military._count_label.text, Time.get_ticks_msec() - started_at, military._message, military._error])
	_check(military._count_label.text == "202 of 202 have their figures.", "every country rated")
	_check(military._message == "Every country has its figures.", "the done message")
	await _shoot("war-10-military-done")
	main.engine.engine_event.connect(_stop_on_progress)
	stop_armed = true
	_confirm_soon()
	await military._run(true)
	_say("military again, stopped: message=%s error=%s" % [military._message, military._error])
	_check(military._message == "Stopped. What was rated is saved with the scenario.", "the Stop message")
	await _shoot("war-11-military-stopped")
	await _scroll_to(fronts)
	fronts._add_button.pressed.emit()
	await _frames(2)
	_type(_line(fronts, "The Western Front")[0], "The Eastern Front")
	var pickers := _find_all(fronts, func(entry: Node) -> bool: return entry is OptionButton and (entry as OptionButton).tooltip_text == "Add a country", [])
	_check(pickers.size() == 2, "both sides offer a country picker")
	_pick(pickers[0], "Ukraine")
	pickers = _find_all(fronts, func(entry: Node) -> bool: return entry is OptionButton and (entry as OptionButton).tooltip_text == "Add a country", [])
	_pick(pickers[1], "Russia")
	pickers = _find_all(fronts, func(entry: Node) -> bool: return entry is OptionButton and (entry as OptionButton).tooltip_text == "Add a country", [])
	_pick(pickers[0], "Poland")
	var attack := _find_all(fronts, func(entry: Node) -> bool: return entry is Button and (entry as Button).text == "Attack", [])
	(attack[1] as Button).pressed.emit()
	var swarms := _find_all(fronts, func(entry: Node) -> bool: return entry is Button and (entry as Button).text == "Swarms", [])
	(swarms[1] as Button).pressed.emit()
	var formations := _line(fronts, "By size")
	_type(formations[0], "012")
	_check((formations[0] as LineEdit).text == "12", "formations kept as a whole number")
	var generals := _line(fronts, "Names, with commas between them")
	_type(generals[0], "Zaluzhny,Syrskyi")
	_check((generals[0] as LineEdit).text == "Zaluzhny, Syrskyi", "generals split at commas")
	_check(not fronts._save_button.disabled, "Save fronts enabled")
	await _scroll_to(fronts)
	await _shoot("war-12-fronts-edited")
	scroll.scroll_vertical = 100000
	await _shoot("war-12b-fronts-edited-bottom")
	await fronts._save()
	_check(fronts._message == "Fronts saved. New games from this scenario begin with them.", "the fronts saved message")
	var check: Dictionary = await main.engine.request("editor.details", {"kind": "scenario", "id": "default"})
	var world: Dictionary = check["result"]["details"]["data"]["world"]
	_say("saved world.scenarioFronts: " + JSON.stringify(world.get("scenarioFronts")))
	var saved_fronts: Array = world.get("scenarioFronts", [])
	_check(saved_fronts.size() == 1 and saved_fronts[0]["sides"][0].size() == 2 and str(saved_fronts[0]["stance"][1]) == "advance", "the front written as edited")
	var usa: Dictionary = world.get("polityOverrides", {}).get("United States", {})
	_say("United States military after the runs: " + JSON.stringify(usa.get("military", {})) + " population " + str(usa.get("population", "")))
	scroll.scroll_vertical = 100000
	await _shoot("war-13-fronts-saved")
	var peace := _button(fronts, "A fortified border, at peace")
	peace.pressed.emit()
	await _frames(2)
	_check(fronts._draft[0]["sides"][0].size() == 1 and str(fronts._draft[0]["stance"][1]) == "hold", "a border at peace keeps one country a side and no attack")
	await _scroll_to(fronts._fronts_box)
	await _shoot("war-14-fronts-peace")
	_say("value events %d, details events %d" % [value_events, details_events])


func _pick(picker: OptionButton, label: String) -> void:
	for index in range(picker.item_count):
		if picker.get_item_text(index) == label:
			picker.select(index)
			picker.item_selected.emit(index)
			return
	_check(false, "no %s in the picker" % label)


func _stop_on_progress(event_name: String, _data: Variant) -> void:
	if stop_armed and event_name == "editor.war.progress":
		stop_armed = false
		_say("stopping after the first progress line: " + military_ref._progress)
		military_ref._stop()


func _finish() -> void:
	_say("done: %d failure(s)" % failures)
	main.engine.stop()
	quit(1 if failures > 0 else 0)
