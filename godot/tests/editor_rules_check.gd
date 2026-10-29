extends SceneTree

var main: Node
var shots := ""
var started := 0
var failures := 0
var host: Control
var column: VBoxContainer
var scroll: ScrollContainer
var last_features: Variant = null
var last_stats: Variant = null
var feature_events := 0
var stats_events := 0


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
	print("[rules %6d ms] %s" % [Time.get_ticks_msec() - started, text])


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


func _shoot(name: String) -> void:
	await _frames(4)
	await RenderingServer.frame_post_draw
	if shots.is_empty():
		return
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(name + ".png"))
	_say("screenshot " + name)


func _collect(node: Node, out: Array) -> void:
	for child in node.get_children():
		out.append(child)
		_collect(child, out)


func _find_button(under: Node, text: String, index := 0) -> Button:
	var nodes: Array = []
	_collect(under, nodes)
	var seen := 0
	for node in nodes:
		if node is Button and (node as Button).text == text and (node as Control).is_visible_in_tree():
			if seen == index:
				return node
			seen += 1
	return null


func _find_line(under: Node, placeholder: String, index := 0) -> LineEdit:
	var nodes: Array = []
	_collect(under, nodes)
	var seen := 0
	for node in nodes:
		if node is LineEdit and (node as LineEdit).placeholder_text == placeholder and (node as Control).is_visible_in_tree():
			if seen == index:
				return node
			seen += 1
	return null


func _find_type(under: Node, type_name: String, index := 0) -> Node:
	var nodes: Array = []
	_collect(under, nodes)
	var seen := 0
	for node in nodes:
		if node.is_class(type_name) and (node as Control).is_visible_in_tree():
			if seen == index:
				return node
			seen += 1
	return null


func _press(button: Button, what: String) -> void:
	if button == null:
		_check(false, "button present: " + what)
		return
	button.pressed.emit()
	await _frames(3)


func _type(edit: LineEdit, text: String) -> void:
	edit.grab_focus()
	edit.text = text
	edit.text_changed.emit(text)
	await _frames(2)


func _confirm_dialog() -> void:
	for attempt in range(30):
		await _frames(2)
		var nodes: Array = []
		_collect(root, nodes)
		for node in nodes:
			if node is ConfirmationDialog and (node as ConfirmationDialog).visible:
				_say("dialog: " + (node as ConfirmationDialog).dialog_text)
				(node as ConfirmationDialog).confirmed.emit()
				return
	_check(false, "a confirmation dialog appeared")


func _make_host() -> void:
	host = Control.new()
	host.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var bg := ColorRect.new()
	bg.color = EditorKit.PANEL
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	host.add_child(bg)
	scroll = ScrollContainer.new()
	scroll.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	scroll.offset_left = 270
	scroll.offset_top = 24
	scroll.offset_bottom = -24
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	host.add_child(scroll)
	column = VBoxContainer.new()
	column.custom_minimum_size.x = 900
	column.add_theme_constant_override("separation", 14)
	scroll.add_child(column)
	main.ui.add_child(host)


func _clear_column() -> void:
	for child in column.get_children():
		column.remove_child(child)
		child.queue_free()


func _scroll_to(control: Control) -> void:
	await _frames(2)
	scroll.ensure_control_visible(control)
	await _frames(2)


func _same_json(a: Variant, b: Variant) -> bool:
	return JSON.stringify(JSON.parse_string(JSON.stringify(a))) == JSON.stringify(JSON.parse_string(JSON.stringify(b)))



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
	if main.get("menu") == null:
		_say("FAIL the main scene did not load")
		_finish(1)
		return
	while not main.menu.visible:
		if Time.get_ticks_msec() - started > 90000:
			_say("FAIL the menu never appeared")
			_finish(1)
			return
		await process_frame
	_say("menu ready")
	await _clear_shell()
	_make_host()
	var opened: Dictionary = await main.engine.request("editor.open", {"kind": "scenario", "id": "default"})
	_check(opened.get("ok", false), "editor.open scenario")
	var result: Dictionary = opened.get("result", {})
	var details: Dictionary = result.get("details", {})
	var form: Dictionary = result.get("form", {})
	await _features_scenario(details, form)
	await _stats(result.get("stats", {}))
	await _features_game()
	_say("done with %d failure(s)" % failures)
	_finish(1 if failures > 0 else 0)


func _features_scenario(details: Dictionary, form: Dictionary) -> void:
	_clear_column()
	var section := EditorFeaturesSection.new()
	column.add_child(section)
	section.value_changed.connect(func(value: Variant) -> void:
		last_features = value
		feature_events += 1)
	section.setup(main.engine, {"kind": "scenario", "value": form.get("features", {}), "scenarioFeatures": form.get("features", {}), "details": details, "currentDate": str(form.get("gameDate", "")), "firstSkipAhead": true, "form": form, "host": host})
	for attempt in range(200):
		if section.is_ready():
			break
		await _frames(1)
	_check(section.is_ready(), "features section built")
	await _wait(0.3)
	await _shoot("rules-1-features-scenario")
	await _press(_find_button(section, "Off", 0), "Espionage Off")
	_check(last_features is Dictionary and (last_features as Dictionary)["espionage"]["enabled"] == false, "Espionage Off emits enabled false")
	var pace := _find_line(section, "", 0)
	await _type(pace, "150")
	_check(str((last_features as Dictionary)["fronts"]["pace"]) == "150", "typing the pace emits the typed text")
	pace.release_focus()
	await _frames(3)
	_check(float((last_features as Dictionary)["fronts"]["pace"]) == 150.0 and not ((last_features as Dictionary)["fronts"]["pace"] is String), "leaving the pace settles a number")
	await _type(pace, "999")
	pace.release_focus()
	await _frames(3)
	_check(float((last_features as Dictionary)["fronts"]["pace"]) == 300.0 and pace.text == "300", "a pace above 300 settles at 300")
	var area: TextEdit = _find_type(section, "TextEdit", 0)
	area.grab_focus()
	area.text = "No power may field nuclear weapons before 1945."
	area.text_changed.emit()
	await _frames(2)
	area.release_focus()
	_check(str((last_features as Dictionary)["worldDirection"]["priorityRules"]) == "No power may field nuclear weapons before 1945.", "priority rules typed")
	await _press(_find_button(section, "Focused", 0), "Player focus Focused")
	_check(str((last_features as Dictionary)["playerFocus"]["level"]) == "focused", "player focus level focused")
	await _press(_find_button(section, "Manage scripted events", 0), "Manage scripted events")
	var editor := section.scripted_editor()
	_check(editor != null and editor.is_manager_open(), "manager opened")
	await _shoot("rules-2-manager-empty")
	await _press(_find_button(host, "+ Add event", 0), "+ Add event")
	var date := _find_line(host, "YYYY-MM-DD", 0)
	await _type(date, "2016-06-23")
	var instruction: TextEdit = null
	var nodes: Array = []
	_collect(host, nodes)
	for node in nodes:
		if node is TextEdit and (node as TextEdit).placeholder_text == "What happens on this date?":
			instruction = node
	_check(instruction != null, "event instruction box present")
	if instruction:
		instruction.grab_focus()
		instruction.text = "The United Kingdom votes to leave the European Union. Markets fall sharply."
		instruction.text_changed.emit()
		await _frames(2)
	var events: Array = (last_features as Dictionary)["worldDirection"]["scriptedEvents"]
	_check(events.size() == 1 and str((events[0] as Dictionary)["date"]) == "2016-06-23", "the new event carries its date")
	var mode_select: OptionButton = null
	nodes.clear()
	_collect(host, nodes)
	for node in nodes:
		if node is OptionButton and (node as OptionButton).tooltip_text == "Condition match rule":
			mode_select = node
	if mode_select:
		mode_select.select(1)
		mode_select.item_selected.emit(1)
		await _frames(3)
	events = (last_features as Dictionary)["worldDirection"]["scriptedEvents"]
	var conditions: Array = ((events[0] as Dictionary)["trigger"] as Dictionary)["conditions"]
	_check(conditions.size() == 1 and str((conditions[0] as Dictionary)["type"]) == "polity_exists", "All conditions adds a first condition")
	var polity := _find_line(host, "Search polity", 0)
	_check(polity != null, "polity search field present")
	if polity:
		await _type(polity, "United Kingdom")
		events = (last_features as Dictionary)["worldDirection"]["scriptedEvents"]
		conditions = ((events[0] as Dictionary)["trigger"] as Dictionary)["conditions"]
		_check(str((conditions[0] as Dictionary).get("polityId", "")) == "United Kingdom", "polity picked by name")
		await _type(polity, "an")
		await _frames(2)
		var offered := editor._suggest_list.get_child_count()
		_check(offered > 8 and editor._suggest.visible, "the polity list offers every match, as the browser's list does (%d)" % offered)
		await _shoot("rules-2b-polity-suggestions")
		await _type(polity, "United Kingdom")
		polity.release_focus()
		editor._hide_suggest()
	await _press(_find_button(host, "+ Add outcome", 0), "+ Add outcome")
	await _press(_find_button(host, "+ Add outcome", 0), "+ Add outcome again")
	var outcome_texts: Array = []
	nodes.clear()
	_collect(host, nodes)
	for node in nodes:
		if node is TextEdit and (node as TextEdit).placeholder_text == "What happens if this outcome is selected?":
			outcome_texts.append(node)
	_check(outcome_texts.size() == 2, "two outcome boxes")
	if outcome_texts.size() == 2:
		(outcome_texts[0] as TextEdit).text = "A narrow vote to leave."
		(outcome_texts[0] as TextEdit).text_changed.emit()
		(outcome_texts[1] as TextEdit).text = "A narrow vote to remain."
		(outcome_texts[1] as TextEdit).text_changed.emit()
		await _frames(2)
	var weights: Array = []
	nodes.clear()
	_collect(host, nodes)
	for node in nodes:
		if node is LineEdit and (node as LineEdit).tooltip_text.begins_with("Relative chance"):
			weights.append(node)
	if weights.size() == 2:
		await _type(weights[0], "3")
	events = (last_features as Dictionary)["worldDirection"]["scriptedEvents"]
	var outcomes: Array = (events[0] as Dictionary).get("outcomes", [])
	_check(outcomes.size() == 2 and float((outcomes[0] as Dictionary)["weight"]) == 3.0, "outcome weight 3")
	_check(EditorScriptedEvents.outcome_chance_text(outcomes, 0) == "75%" and EditorScriptedEvents.outcome_chance_text(outcomes, 1) == "25%", "chances 75% / 25%")
	var percent: LineEdit = null
	nodes.clear()
	_collect(host, nodes)
	for node in nodes:
		if node is LineEdit and (node as LineEdit).tooltip_text == "Event chance percent":
			percent = node
	if percent:
		await _type(percent, "140")
		events = (last_features as Dictionary)["worldDirection"]["scriptedEvents"]
		_check(float(((events[0] as Dictionary)["trigger"] as Dictionary)["percent"]) == 100.0 and percent.text == "100", "a chance over 100 settles at 100")
		await _type(percent, "60")
	await _wait(0.2)
	await _shoot("rules-3-manager-event")
	var manager_scroll: ScrollContainer = null
	nodes.clear()
	_collect(host, nodes)
	for node in nodes:
		if node is ScrollContainer and node != scroll and (node as Control).is_visible_in_tree():
			manager_scroll = node
	if manager_scroll:
		manager_scroll.scroll_vertical = 100000
		await _wait(0.2)
		await _shoot("rules-3b-manager-outcomes")
		manager_scroll.scroll_vertical = 0
	await _press(_find_button(host, "Duplicate", 0), "Duplicate")
	events = (last_features as Dictionary)["worldDirection"]["scriptedEvents"]
	_check(events.size() == 2 and str((events[1] as Dictionary)["id"]) != str((events[0] as Dictionary)["id"]), "duplicate made a second event with its own id")
	_say("scripted events emitted: " + JSON.stringify(events).substr(0, 900))
	editor.close_manager()
	await _frames(3)
	_check(not editor.is_manager_open(), "manager closed")
	await _scroll_to(editor)
	await _shoot("rules-4-features-edited")
	var check: Dictionary = await main.engine.request("editor.rules.normalizeFeatures", {"kind": "scenario", "value": last_features})
	var mine := EditorFeaturesModel.normalize_settings(last_features, EditorFeaturesSection.definitions.get("features", []))
	_check(check.get("ok", false) and _same_json(mine, check["result"]["settings"]), "GDScript normalisation matches the engine's on the edited features")
	if not _same_json(mine, check.get("result", {}).get("settings", {})):
		_say("mine:   " + JSON.stringify(mine).substr(0, 1500))
		_say("engine: " + JSON.stringify(check.get("result", {}).get("settings", {})).substr(0, 1500))
	_say("features value emitted %d times; last: %s" % [feature_events, JSON.stringify(last_features).substr(0, 700)])
	var lines := "# a comment
1914-06-28 — Archduke Franz Ferdinand is shot in Sarajevo. War follows within weeks.
-0218-03-01: Hannibal crosses the Alps
not a dated line
1990-01-01
2016-06-23 | Britain votes to leave
1914-06-28 — Archduke Franz Ferdinand is shot in Sarajevo. War follows within weeks."
	var tricky := [
		{"date": "1939-09-01", "text": "Germany invades Poland.", "trigger": {"mode": "chance", "percent": "35"}},
		{"date": "1939-09-03", "description": "Britain and France declare war on Germany.", "trigger": {"mode": "conditional", "operator": "any", "conditions": [{"type": "Polity_Exists", "polityId": " Germany "}]}},
		{"id": "Same ID!", "date": "1941-06-22", "text": "Operation Barbarossa begins.", "outcomes": [{"text": "It stalls before Moscow.", "weight": "2"}, {"text": ""}, {"id": "x", "title": "  Quick   win ", "text": "Moscow falls.", "weight": null}]},
		{"id": "same id", "date": "1941-06-22", "text": "A second one with the same id.", "trigger": {"mode": "rules", "operator": "at-least", "requiredCount": 9, "conditions": [{"type": "polity_exists", "polityId": "A"}, {"type": ""}, {"type": "polity_exists", "polityId": "B"}], "chancePercent": 140}},
		{"date": "1945-05-08", "text": "Victory in Europe.", "textMode": "EXACT", "trigger": {"mode": "mystery"}},
		{"date": "bad", "text": "dropped"},
	]
	for source in [lines, tricky]:
		var parity: Dictionary = await main.engine.request("editor.rules.normalizeFeatures", {"kind": "scenario", "value": {"worldDirection": {"scriptedEvents": source}}})
		var engine_events: Variant = parity.get("result", {}).get("scripted", [])
		var mine_events := EditorFeaturesModel.normalize_scripted_events(source)
		var same := _same_json(mine_events, engine_events)
		_check(same, "scripted-event normalisation matches the engine (%s)" % ("text lines" if source is String else "legacy and malformed rows"))
		if not same:
			_say("mine:   " + JSON.stringify(mine_events))
			_say("engine: " + JSON.stringify(engine_events))


func _stats(value: Dictionary) -> void:
	_clear_column()
	await _frames(2)
	scroll.scroll_vertical = 0
	var sheet := EditorStatsSheet.new()
	column.add_child(sheet)
	sheet.value_changed.connect(func(next: Variant) -> void:
		last_stats = next
		stats_events += 1)
	sheet.setup(main.engine, {"value": value, "host": host})
	await _wait(0.4)
	await _shoot("rules-5-stats-standard")
	await _press(_find_button(sheet, "Customize full sheet", 0), "Customize full sheet")
	_check(last_stats is Dictionary and bool((last_stats as Dictionary)["custom"]) and ((last_stats as Dictionary)["sections"] as Array).size() == 4, "customize gives the four default sections")
	await _press(_find_button(sheet, "+ Add statistic", 0), "+ Add statistic")
	var sections: Array = (last_stats as Dictionary)["sections"]
	var stats: Array = (sections[0] as Dictionary)["stats"]
	_check(stats.size() == 3 and str((stats[2] as Dictionary)["key"]) == "newStatistic", "new statistic keyed newStatistic")
	var name_edit: LineEdit = null
	var nodes: Array = []
	_collect(sheet, nodes)
	for node in nodes:
		if node is LineEdit and (node as LineEdit).text == "New statistic":
			name_edit = node
	if name_edit:
		await _type(name_edit, "Grain stores")
	sections = (last_stats as Dictionary)["sections"]
	stats = (sections[0] as Dictionary)["stats"]
	_check(str((stats[2] as Dictionary)["key"]) == "grainStores", "the new statistic's key follows its name")
	var kind: OptionButton = null
	nodes.clear()
	_collect(sheet, nodes)
	for node in nodes:
		if node is OptionButton:
			kind = node
	if kind:
		kind.select(1)
		kind.item_selected.emit(1)
		await _frames(3)
	sections = (last_stats as Dictionary)["sections"]
	stats = (sections[0] as Dictionary)["stats"]
	_check(str((stats[2] as Dictionary)["kind"]) == "number" and not (stats[2] as Dictionary).has("minimum"), "type Number drops the 0-100 bounds")
	var suffix := _find_line(sheet, "%, tonnes, ships", 0)
	if suffix:
		await _type(suffix, "tonnes")
	await _wait(0.2)
	await _shoot("rules-6-stats-custom")
	sheet.move_stat("national", "grainStores", "economy", "gdp")
	await _frames(3)
	sections = (last_stats as Dictionary)["sections"]
	_check(str((((sections[3] as Dictionary)["stats"] as Array)[0] as Dictionary)["key"]) == "grainStores", "drop moved Grain stores before GDP")
	await _press(_find_button(sheet, "+ Add section", 0), "+ Add section")
	sections = (last_stats as Dictionary)["sections"]
	_check(sections.size() == 5 and str((sections[4] as Dictionary)["key"]) == "newSection", "new section keyed newSection")
	var section_name: LineEdit = null
	nodes.clear()
	_collect(sheet, nodes)
	for node in nodes:
		if node is LineEdit and (node as LineEdit).text == "New section":
			section_name = node
	if section_name:
		await _type(section_name, "Économie rurale")
	sections = (last_stats as Dictionary)["sections"]
	_check(str((sections[4] as Dictionary)["key"]) == "economieRurale", "accented section name folds like the engine (economieRurale)")
	var labels := ["Économie nationale", "½ ﬁsh", "1st place", "", "Ölçü", "Straße", "Ⅻ legions", "  spaced   out  ", "naïve café", "東京"]
	var reply: Dictionary = await main.engine.request("editor.rules.statSheet", {"value": last_stats, "labels": labels})
	var engine_keys: Array = reply.get("result", {}).get("keys", [])
	var keys_match := engine_keys.size() == labels.size()
	for index in range(labels.size()):
		if keys_match and EditorStatKeys.to_key(labels[index]) != str(engine_keys[index]):
			keys_match = false
			_say("key mismatch for %s: mine %s, engine %s" % [labels[index], EditorStatKeys.to_key(labels[index]), engine_keys[index]])
	_check(keys_match, "statistic keys match the engine for accented and symbol labels")
	_check(int(reply.get("result", {}).get("total", -1)) == sheet._total_stats(), "statistic count matches the engine (%d)" % sheet._total_stats())
	var standard := _find_button(sheet, "Use standard sheet", 0)
	if standard:
		standard.pressed.emit()
		await _confirm_dialog()
		await _frames(4)
	_check(last_stats is Dictionary and not bool((last_stats as Dictionary)["custom"]), "Use standard sheet goes back after the question")
	await _press(_find_button(sheet, "Customize full sheet", 0), "Customize again")
	sections = (last_stats as Dictionary)["sections"]
	_check(sections.size() == 5, "customizing again brings back the replaced custom sheet")
	_say("stats value emitted %d times; last: %s" % [stats_events, JSON.stringify(last_stats).substr(0, 500)])


func _features_game() -> void:
	_clear_column()
	await _frames(2)
	scroll.scroll_vertical = 0
	var created: Dictionary = await main.engine.request("game.create", {"scenarioId": "default"})
	_check(created.get("ok", false), "game.create")
	var game_id := str(created.get("result", {}).get("id", ""))
	var opened: Dictionary = await main.engine.request("editor.open", {"kind": "game", "id": game_id})
	_check(opened.get("ok", false), "editor.open game")
	var result: Dictionary = opened.get("result", {})
	var form: Dictionary = result.get("form", {})
	var details: Dictionary = result.get("details", {})
	var world: Dictionary = details.get("data", {}).get("world", {})
	var history: Variant = world.get("simulationHistory")
	var section := EditorFeaturesSection.new()
	column.add_child(section)
	last_features = null
	section.value_changed.connect(func(value: Variant) -> void: last_features = value)
	section.setup(main.engine, {"kind": "game", "value": form.get("features", {}), "scenarioFeatures": form.get("scenarioFeatures", {}), "details": details, "currentDate": str(form.get("gameDate", "")), "firstSkipAhead": not (history is Array and not (history as Array).is_empty()), "form": form, "host": host})
	for attempt in range(200):
		if section.is_ready():
			break
		await _frames(1)
	await _wait(0.3)
	await _shoot("rules-7-features-game")
	await _press(_find_button(section, "Off", 1), "Groups Off")
	_check(_same_json(last_features, {"groups": {"enabled": false}}), "a game override is sparse: {groups: {enabled: false}}")
	await _press(_find_button(section, "Scenario default (On)", 1), "Groups scenario default")
	_check(_same_json(last_features, {}), "Scenario default removes the override")
	var minutes := _find_line(section, "8", 0)
	_check(minutes != null, "idle diplomacy field shows the scenario's 8 as its placeholder")
	if minutes:
		await _type(minutes, "12")
		_check(_same_json(last_features, {"idleDiplomacy": {"averageMinutes": 12}}), "typing 12 overrides averageMinutes")
		await _frames(2)
		var reset := _find_button(section, "Use scenario default", 0)
		await _press(reset, "Use scenario default")
		_check(_same_json(last_features, {}), "Use scenario default clears the number")
	await _press(_find_button(section, "Override for this game", 0), "Override for this game")
	_check(_same_json(last_features, {"worldDirection": {"scriptedEvents": []}}), "override starts from the scenario's scripted events")
	await _wait(0.2)
	await _shoot("rules-8-features-game-override")
	await _press(_find_button(section, "Use scenario default", 0), "scripted Use scenario default")
	_check(_same_json(last_features, {}), "scripted events follow the scenario again")
	await main.engine.request("game.delete", {"id": game_id})


func _finish(code: int) -> void:
	main.engine.stop()
	await _wait(0.3)
	quit(code)
