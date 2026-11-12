class_name EditorHistoryPanel
extends VBoxContainer

signal details_changed(details: Dictionary)
signal value_changed(value: Variant)

const PROBLEM_BORDER := Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.35)

var engine: EngineLink
var _props := {}
var _details := {}
var _scenario_id := ""
var _start_date := ""
var _briefing := ""
var _saved: Variant = null
var _draft := {}
var _prompt := ""
var _busy := false
var _generating := false
var _cancelled := false
var _message := ""
var _error := ""
var _call := 0
var _open_advanced := {}
var _cards := {}
var _briefing_hint: Control
var _prompt_edit: TextEdit
var _generate_button: Button
var _cancel_button: Button
var _date_hint: Control
var _count_label: Label
var _add_button: Button
var _start_holder: Control
var _start_hint: Label
var _empty_hint: Control
var _events_box: VBoxContainer
var _summary_edit: TextEdit
var _day_one: Control
var _day_one_rows: VBoxContainer
var _error_holder: Control
var _error_label: Label
var _message_holder: Control
var _message_label: Label
var _problems_holder: Control
var _save_button: Button
var _discard_button: Button


func setup(engine_link: EngineLink, props: Dictionary) -> void:
	engine = engine_link
	_props = props.duplicate()
	add_theme_constant_override("separation", 0)
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_adopt_details(props.get("details", {}) if props.get("details") is Dictionary else {})
	_reset_draft()
	_build()
	_render_all()


func update_props(props: Dictionary) -> void:
	for key in props:
		_props[key] = props[key]
	if props.has("details") and props["details"] is Dictionary:
		var previous := _scenario_id
		_adopt_details(props["details"])
		if _scenario_id != previous:
			_reset_draft()
			_message = ""
			_error = ""
			if _events_box:
				_render_all()
		elif _events_box:
			_render_status()


func _adopt_details(details: Dictionary) -> void:
	_details = details
	var scenario: Variant = details.get("scenario")
	_scenario_id = str((scenario as Dictionary).get("id", "")) if scenario is Dictionary else ""
	var data: Dictionary = details.get("data", {}) if details.get("data") is Dictionary else {}
	var game: Dictionary = data.get("game", {}) if data.get("game") is Dictionary else {}
	var world: Dictionary = data.get("world", {}) if data.get("world") is Dictionary else {}
	var start := EditorWarRules.js_string(game.get("startDate")).strip_edges()
	if start.is_empty():
		start = EditorWarRules.js_string(game.get("gameDate")).strip_edges()
	_start_date = start
	_briefing = EditorWarRules.js_string(world.get("startingTimelineText")).strip_edges()
	_saved = EditorHistoryRules.normalize_record(world.get("prehistory"), true)


func _reset_draft() -> void:
	_draft = (_saved as Dictionary).duplicate(true) if _saved != null else EditorHistoryRules.empty_record()
	_prompt = str((_saved as Dictionary).get("prompt", "")) if _saved != null else ""


func _events() -> Array:
	if not (_draft.get("events") is Array):
		_draft["events"] = []
	return _draft["events"]


func _with_prompt() -> Dictionary:
	var record := _draft.duplicate()
	record["prompt"] = _prompt
	return record


func _changed() -> bool:
	return not EditorHistoryRules.same_record(_with_prompt(), _saved if _saved != null else EditorHistoryRules.empty_record())


func _dirty() -> bool:
	return _changed() or (_saved == null and not _briefing.is_empty())


func _problems() -> Array:
	return EditorHistoryRules.problems(_draft, _start_date)


func _spaced(control: Control, top: float) -> VBoxContainer:
	var holder := VBoxContainer.new()
	holder.add_theme_constant_override("separation", 0)
	holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	holder.add_child(EditorWarKit.gap(top))
	holder.add_child(control)
	return holder


func _build() -> void:
	var parts := EditorWarKit.card()
	add_child(parts[0])
	add_child(EditorWarKit.gap(15))
	var column: VBoxContainer = parts[1]
	column.add_child(EditorWarKit.title("Pre-game history"))
	column.add_child(EditorWarKit.gap(3))
	column.add_child(EditorWarKit.hint("The events before round one. A new game from this scenario starts with them on its timeline, without asking your AI for them."))
	column.add_child(EditorWarKit.gap(3))
	column.add_child(EditorWarKit.hint("Write them below, or generate them from a prompt and edit the result."))
	_briefing_hint = _spaced(EditorWarKit.hint("Until a pre-history is saved here, a new game from this scenario asks your AI to write one from World Before Round One when it first opens.", EditorWarKit.WARN), 7)
	column.add_child(_briefing_hint)

	var generate := EditorWarKit.section(13)
	column.add_child(generate[0])
	var generate_column: VBoxContainer = generate[1]
	generate_column.add_child(EditorWarKit.section_title("Generate"))
	generate_column.add_child(EditorWarKit.gap(8))
	generate_column.add_child(EditorWarKit.field_label("Prompt"))
	_prompt_edit = EditorWarKit.area(_prompt, "What should the backstory cover? For example: the decade of crises that led to the war, seen from the great powers.", 3, func(text: String) -> void:
		_prompt = text
		_render_status())
	generate_column.add_child(_prompt_edit)
	generate_column.add_child(EditorWarKit.gap(6))
	generate_column.add_child(EditorWarKit.hint("The AI also reads the scenario's map, start date, World Before Round One and Simulation Rules. It writes the events and the Day-one facts, and replaces the events below."))
	generate_column.add_child(EditorWarKit.gap(9))
	var generate_row := HBoxContainer.new()
	generate_row.add_theme_constant_override("separation", 7)
	_generate_button = EditorWarKit.button("Generate pre-history", "primary")
	_generate_button.pressed.connect(_generate)
	generate_row.add_child(_generate_button)
	_cancel_button = EditorWarKit.button("Cancel")
	_cancel_button.pressed.connect(_cancel_generation)
	generate_row.add_child(_cancel_button)
	generate_column.add_child(generate_row)
	_date_hint = _spaced(EditorWarKit.hint("Set and save the scenario's game date first.", EditorWarKit.WARN), 6)
	generate_column.add_child(_date_hint)

	var events := EditorWarKit.section(13)
	column.add_child(events[0])
	var events_column: VBoxContainer = events[1]
	var header := HBoxContainer.new()
	header.add_theme_constant_override("separation", 8)
	_count_label = EditorWarKit.section_title("")
	_count_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_count_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	header.add_child(_count_label)
	_add_button = EditorWarKit.button("+ Add event")
	_add_button.pressed.connect(_add_event)
	header.add_child(_add_button)
	events_column.add_child(header)
	events_column.add_child(EditorWarKit.gap(8))
	_start_hint = EditorWarKit.hint("")
	var start_holder := VBoxContainer.new()
	start_holder.add_theme_constant_override("separation", 0)
	start_holder.add_child(_start_hint)
	start_holder.add_child(EditorWarKit.gap(9))
	_start_holder = start_holder
	events_column.add_child(start_holder)
	_empty_hint = EditorWarKit.hint("No pre-history events yet.")
	events_column.add_child(_empty_hint)
	_events_box = VBoxContainer.new()
	_events_box.add_theme_constant_override("separation", 10)
	_events_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	events_column.add_child(_events_box)

	var summary := EditorWarKit.section(13)
	column.add_child(summary[0])
	var summary_column: VBoxContainer = summary[1]
	summary_column.add_child(EditorWarKit.section_title("Summary"))
	summary_column.add_child(EditorWarKit.gap(8))
	_summary_edit = EditorWarKit.area("", "One paragraph on the era leading into the start date (optional).", 2, func(text: String) -> void:
		_draft["summary"] = text
		_render_status())
	summary_column.add_child(_summary_edit)

	var day_one := EditorWarKit.section(13)
	_day_one = day_one[0]
	column.add_child(_day_one)
	var day_column: VBoxContainer = day_one[1]
	day_column.add_child(EditorWarKit.section_title("Day-one facts"))
	day_column.add_child(EditorWarKit.gap(8))
	day_column.add_child(EditorWarKit.hint("Wars, relations and agreements already true on the start date, written by the generation. A new game starts with them in its records."))
	day_column.add_child(EditorWarKit.gap(6))
	_day_one_rows = VBoxContainer.new()
	_day_one_rows.add_theme_constant_override("separation", 0)
	day_column.add_child(_day_one_rows)

	_error_label = UI.wrapped("", 12, EditorWarKit.ALERT)
	_error_holder = _spaced(_error_label, 11)
	column.add_child(_error_holder)
	_message_label = UI.wrapped("", 12, Color(1, 1, 1, 0.72))
	_message_holder = _spaced(_message_label, 11)
	column.add_child(_message_holder)
	_problems_holder = _spaced(UI.wrapped("Fix the events marked above before saving.", 12, EditorWarKit.ALERT), 11)
	column.add_child(_problems_holder)
	column.add_child(EditorWarKit.gap(12))
	var actions := HBoxContainer.new()
	actions.add_theme_constant_override("separation", 7)
	_save_button = EditorWarKit.button("Save pre-history", "primary")
	_save_button.pressed.connect(_save)
	actions.add_child(_save_button)
	_discard_button = EditorWarKit.button("Discard changes")
	_discard_button.pressed.connect(_discard)
	actions.add_child(_discard_button)
	column.add_child(actions)


func _render_all() -> void:
	if _prompt_edit.text != _prompt:
		_prompt_edit.text = _prompt
	var summary := str(_draft.get("summary", ""))
	if _summary_edit.text != summary:
		_summary_edit.text = summary
	_render_events()
	_render_day_one()
	_render_status()


func _render_events() -> void:
	EditorKit.clear(_events_box)
	_cards.clear()
	var events := _events()
	for index in range(events.size()):
		_events_box.add_child(_event_card(index))


func _render_day_one() -> void:
	EditorKit.clear(_day_one_rows)
	var rows := EditorHistoryRules.update_rows(_draft)
	_day_one.visible = not rows.is_empty()
	for row in rows:
		var line := HBoxContainer.new()
		line.add_theme_constant_override("separation", 8)
		var holder := MarginContainer.new()
		holder.add_theme_constant_override("margin_top", 5)
		holder.add_theme_constant_override("margin_bottom", 5)
		holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var text := UI.wrapped(EditorHistoryRules.row_line(row), 12, Color(1, 1, 1, 0.82))
		text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		holder.add_child(text)
		line.add_child(holder)
		var remove := EditorWarKit.button("Remove")
		remove.custom_minimum_size.y = 27
		remove.add_theme_font_size_override("font_size", 11)
		var family := str(row.get("family", ""))
		var at := int(row.get("index", 0))
		remove.pressed.connect(func() -> void:
			var next: Variant = EditorHistoryRules.without_update(_draft, family, at)
			if next is Dictionary:
				_draft = next
			_render_all())
		line.add_child(remove)
		_day_one_rows.add_child(line)


func _render_status() -> void:
	var problems := _problems()
	var by_id := {}
	for entry in problems:
		var key := str(entry.get("id", ""))
		if not by_id.has(key):
			by_id[key] = []
		(by_id[key] as Array).append(str(entry.get("problem", "")))
	for id in _cards:
		_show_problems(_cards[id], by_id.get(id, []))
	_briefing_hint.visible = _saved == null and not _briefing.is_empty()
	_generate_button.text = "Generating…" if _generating else "Generate pre-history"
	EditorWarKit.set_enabled(_generate_button, not _busy and not _start_date.is_empty())
	_cancel_button.visible = _generating
	_date_hint.visible = _start_date.is_empty()
	var count := _events().size()
	_count_label.text = ("1 event" if count == 1 else "%d events" % count).to_upper()
	_add_button.disabled = count >= EditorHistoryRules.MAX_EVENTS
	_start_hint.text = "Every event is dated before the start date, %s, and they are kept oldest first." % _start_date
	_start_holder.visible = not _start_date.is_empty()
	_empty_hint.visible = count == 0
	_error_label.text = _error
	_error_holder.visible = not _error.is_empty()
	_message_label.text = _message
	_message_holder.visible = not _message.is_empty()
	_problems_holder.visible = not problems.is_empty()
	EditorWarKit.set_enabled(_save_button, not _busy and _dirty() and problems.is_empty())
	EditorWarKit.set_enabled(_discard_button, not _busy and _changed())


func _show_problems(card: Dictionary, problems: Array) -> void:
	var panel: PanelContainer = card["panel"]
	panel.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.03), PROBLEM_BORDER if not problems.is_empty() else Color(1, 1, 1, 0.08), 12, 1, Vector4(10, 10, 10, 10)))
	var box: VBoxContainer = card["problems"]
	EditorKit.clear(box)
	box.visible = not problems.is_empty()
	for problem in problems:
		var text := "Give this event a title."
		if problem == "date":
			text = "Give this event a date as YYYY-MM-DD; a negative year is BC."
		elif problem == "late":
			text = "This event must come before the start date, %s." % _start_date
		box.add_child(UI.wrapped(text, 11, EditorWarKit.ALERT))


func _index_of(id: String) -> int:
	var events := _events()
	for index in range(events.size()):
		if str((events[index] as Dictionary).get("id", "")) == id:
			return index
	return -1


func _edit_event(id: String, field: String, value: Variant) -> void:
	var index := _index_of(id)
	if index < 0:
		return
	var event: Dictionary = _events()[index]
	event[field] = value
	_render_status()


func _edit_quote(id: String, field: String, value: String) -> void:
	var index := _index_of(id)
	if index < 0:
		return
	var event: Dictionary = _events()[index]
	var quote: Dictionary = (event.get("quote") as Dictionary).duplicate() if event.get("quote") is Dictionary else {}
	quote[field] = value
	event["quote"] = quote
	_render_status()


func _choice_group(id: String, field: String, values: Array, current: Variant) -> HFlowContainer:
	var flow := HFlowContainer.new()
	flow.add_theme_constant_override("h_separation", 5)
	flow.add_theme_constant_override("v_separation", 5)
	var buttons: Array[Button] = []
	for value in values:
		var button := EditorWarKit.choice(str(value), str(current) == str(value))
		buttons.append(button)
		flow.add_child(button)
	for index in range(buttons.size()):
		var picked: String = str(values[index])
		buttons[index].pressed.connect(func() -> void:
			_edit_event(id, field, picked)
			for other in range(buttons.size()):
				EditorWarKit.set_choice(buttons[other], str(values[other]) == picked))
	return flow


func _tag_group(id: String, current: Array) -> HFlowContainer:
	var flow := HFlowContainer.new()
	flow.add_theme_constant_override("h_separation", 5)
	flow.add_theme_constant_override("v_separation", 5)
	var buttons: Array[Button] = []
	for tag in EditorHistoryRules.EVENT_TAGS:
		var button := EditorWarKit.choice(str(tag), current.has(tag))
		buttons.append(button)
		flow.add_child(button)
	for index in range(buttons.size()):
		var tag: String = str(EditorHistoryRules.EVENT_TAGS[index])
		buttons[index].pressed.connect(func() -> void:
			var at := _index_of(id)
			if at < 0:
				return
			var event: Dictionary = _events()[at]
			var tags: Array = (event.get("tags", []) as Array).duplicate()
			if tags.has(tag):
				tags.erase(tag)
			else:
				tags.append(tag)
				tags = tags.slice(0, 3)
			event["tags"] = tags
			for other in range(buttons.size()):
				EditorWarKit.set_choice(buttons[other], tags.has(EditorHistoryRules.EVENT_TAGS[other]))
			_render_status())
	return flow


func _event_card(index: int) -> Control:
	var event: Dictionary = _events()[index]
	var id := str(event.get("id", ""))
	var count := _events().size()
	var panel := PanelContainer.new()
	panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 9)
	panel.add_child(column)
	var top := HBoxContainer.new()
	top.add_theme_constant_override("separation", 9)
	var date_box := VBoxContainer.new()
	date_box.add_theme_constant_override("separation", 0)
	date_box.custom_minimum_size.x = 192
	date_box.add_child(EditorWarKit.field_label("Date"))
	date_box.add_child(EditorWarKit.input(str(event.get("date", "")), "YYYY-MM-DD", func(text: String) -> void: _edit_event(id, "date", text)))
	top.add_child(date_box)
	var title_box := VBoxContainer.new()
	title_box.add_theme_constant_override("separation", 0)
	title_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title_box.add_child(EditorWarKit.field_label("Title"))
	title_box.add_child(EditorWarKit.input(str(event.get("title", "")), "Exact event title", func(text: String) -> void: _edit_event(id, "title", text)))
	top.add_child(title_box)
	column.add_child(top)
	var description := VBoxContainer.new()
	description.add_theme_constant_override("separation", 0)
	description.add_child(EditorWarKit.field_label("Description"))
	description.add_child(EditorWarKit.area(str(event.get("description", "")), "What canonically happened?", 3, func(text: String) -> void: _edit_event(id, "description", text)))
	column.add_child(description)
	var opened: bool = bool(_open_advanced.get(id, false))
	var toggle := Button.new()
	toggle.text = ("▾ " if opened else "▸ ") + "Advanced event metadata"
	toggle.flat = true
	toggle.focus_mode = Control.FOCUS_NONE
	toggle.alignment = HORIZONTAL_ALIGNMENT_LEFT
	toggle.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	toggle.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	toggle.add_theme_font_override("font", UI.font(700))
	toggle.add_theme_font_size_override("font_size", 11)
	for color_name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		toggle.add_theme_color_override(color_name, Color(1, 1, 1, 0.72))
	var empty := StyleBoxEmpty.new()
	for state in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
		toggle.add_theme_stylebox_override(state, empty)
	column.add_child(toggle)
	var advanced := VBoxContainer.new()
	advanced.add_theme_constant_override("separation", 9)
	advanced.visible = opened
	toggle.pressed.connect(func() -> void:
		var now := not advanced.visible
		advanced.visible = now
		_open_advanced[id] = now
		toggle.text = ("▾ " if now else "▸ ") + "Advanced event metadata")
	advanced.add_child(_labelled("Importance", _choice_group(id, "importance", EditorHistoryRules.IMPORTANCE, event.get("importance", "minor"))))
	advanced.add_child(_labelled("Kind", _choice_group(id, "kind", EditorHistoryRules.KINDS, event.get("kind", "world"))))
	advanced.add_child(_labelled("Categories", _tag_group(id, event.get("tags", []) if event.get("tags") is Array else [])))
	var notable := EditorKit.check("Notable", event.get("notable") == true, func(on: bool) -> void: _edit_event(id, "notable", on), 12)
	advanced.add_child(notable)
	var quote: Dictionary = event.get("quote", {}) if event.get("quote") is Dictionary else {}
	advanced.add_child(_labelled("Quote text", EditorWarKit.area(str(quote.get("text", "")), "Quotation text without surrounding quotation marks", 2, func(text: String) -> void: _edit_quote(id, "text", text))))
	var people := GridContainer.new()
	people.columns = 2
	people.add_theme_constant_override("h_separation", 8)
	people.add_theme_constant_override("v_separation", 8)
	people.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var speaker := _labelled("Speaker", EditorWarKit.input(str(quote.get("speaker", "")), "Optional attribution", func(text: String) -> void: _edit_quote(id, "speaker", text)))
	speaker.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	people.add_child(speaker)
	var role := _labelled("Role / title", EditorWarKit.input(str(quote.get("role", "")), "Optional office or role", func(text: String) -> void: _edit_quote(id, "role", text)))
	role.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	people.add_child(role)
	advanced.add_child(people)
	column.add_child(advanced)
	var problems := VBoxContainer.new()
	problems.add_theme_constant_override("separation", 2)
	column.add_child(problems)
	var actions := HBoxContainer.new()
	actions.add_theme_constant_override("separation", 6)
	actions.alignment = BoxContainer.ALIGNMENT_END
	var up := EditorWarKit.button("")
	up.icon = EditorWarKit.chevron(true)
	up.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
	up.tooltip_text = "Move up"
	up.custom_minimum_size.x = 40
	EditorWarKit.set_enabled(up, index > 0, 0.4)
	up.pressed.connect(func() -> void: _move(id, -1))
	actions.add_child(up)
	var down := EditorWarKit.button("")
	down.icon = EditorWarKit.chevron(false)
	down.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
	down.tooltip_text = "Move down"
	down.custom_minimum_size.x = 40
	EditorWarKit.set_enabled(down, index < count - 1, 0.4)
	down.pressed.connect(func() -> void: _move(id, 1))
	actions.add_child(down)
	var remove := EditorWarKit.button("Remove")
	remove.pressed.connect(func() -> void:
		var at := _index_of(id)
		if at >= 0:
			_events().remove_at(at)
		_render_events()
		_render_status())
	actions.add_child(remove)
	column.add_child(actions)
	_cards[id] = {"panel": panel, "problems": problems}
	_show_problems(_cards[id], [])
	return panel


func _labelled(text: String, control: Control) -> VBoxContainer:
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 0)
	box.add_child(EditorWarKit.field_label(text))
	box.add_child(control)
	return box


func _move(id: String, step: int) -> void:
	var index := _index_of(id)
	var target := index + step
	var events := _events()
	if index < 0 or target < 0 or target >= events.size():
		return
	var moving: Variant = events[index]
	events[index] = events[target]
	events[target] = moving
	_render_events()
	_render_status()


func _add_event() -> void:
	if _events().size() >= EditorHistoryRules.MAX_EVENTS:
		return
	_events().append({"id": EditorHistoryRules.new_event_id(), "date": "", "title": "", "description": "", "importance": "minor", "kind": "world", "tags": []})
	_render_events()
	_render_status()


func _generate() -> void:
	if _scenario_id.is_empty() or _busy:
		return
	if not _events().is_empty() and not await EditorKit.ask(EditorWarKit.host_of(self, _props), "Replace the events below with a newly generated pre-history? You can still discard the result before saving."):
		return
	_error = ""
	_message = ""
	_busy = true
	_generating = true
	_cancelled = false
	_render_status()
	_call = engine.last_request_id() + 1
	var reply := await engine.request("editor.history.generate", {"scenarioId": _scenario_id, "prompt": _prompt})
	_call = 0
	_busy = false
	_generating = false
	if not is_inside_tree():
		return
	if _cancelled:
		_render_status()
		return
	if reply.get("ok", false) and reply["result"] is Dictionary and (reply["result"] as Dictionary).get("record") is Dictionary:
		_draft = (reply["result"]["record"] as Dictionary).duplicate(true)
		_message = "Generated. Edit anything below, then save the pre-history."
		_render_all()
	else:
		if not bool(reply.get("aborted", false)):
			_error = str(reply.get("error", ""))
		_render_status()


func _cancel_generation() -> void:
	if _call > 0:
		engine.cancel(_call)
	_cancelled = true
	_message = "Generation cancelled."
	_render_status()


func _save() -> void:
	if _scenario_id.is_empty() or _busy or not _problems().is_empty():
		return
	_busy = true
	_error = ""
	_message = ""
	_render_status()
	var reply := await engine.request("editor.history.save", {"scenarioId": _scenario_id, "draft": _draft, "prompt": _prompt})
	_busy = false
	if not is_inside_tree():
		return
	if reply.get("ok", false):
		var result: Dictionary = reply["result"]
		var details: Dictionary = result.get("details", {})
		details_changed.emit(details)
		_adopt_details(details)
		_draft = (result.get("draft", {}) as Dictionary).duplicate(true)
		_message = "Pre-history saved. New games from this scenario start with it."
		_render_all()
	else:
		_error = str(reply.get("error", ""))
		_render_status()


func _discard() -> void:
	_reset_draft()
	_message = ""
	_error = ""
	_render_all()
