class_name EditorHistoryPanel
extends VBoxContainer

signal details_changed(details: Dictionary)
signal value_changed(value: Variant)

const PROBLEM_BORDER := Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.35)
const DayOneFactEditor := preload("res://scripts/editor/day_one_fact_editor.gd")
const ADD_LABELS := {"relation": "+ Relationship", "agreement": "+ Agreement", "storyline": "+ Storyline"}

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
var _day_one_empty: Control
var _day_one_adds: Array[Button] = []
var _canonical_box: Control
var _canonical_rows: VBoxContainer
var _general_problems: VBoxContainer
var _day_problems_holder: Control
var _canonical_problems_holder: Control
var _canonical_problems_lines: VBoxContainer
var _suggest_box: PanelContainer
var _suggest_list: VBoxContainer
var _suggest_target: LineEdit
var _world := {}
var _canonical: Array = []
var _saved_canonical: Array = []
var _polities: Array = []
var _kinds: Array = ["relation", "agreement", "storyline"]
var _agreement_types: Array = []
var _most_facts := 32
var _day_one_problems: Array = []
var _canonical_problems: Array = []
var _fact_editors := {}
var _agreement_editors := {}
var _open_facts := {}
var _check_seq := 0
var _checks_running := 0
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
	_open_day_one()


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
		_open_day_one()


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
	_world = world
	_saved_canonical = (world.get("agreements") as Array).duplicate(true) if world.get("agreements") is Array else []


func _reset_draft() -> void:
	_draft = (_saved as Dictionary).duplicate(true) if _saved != null else EditorHistoryRules.empty_record()
	_prompt = str((_saved as Dictionary).get("prompt", "")) if _saved != null else ""
	_canonical = _saved_canonical.duplicate(true)
	_day_one_problems = []
	_canonical_problems = []


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


func _canonical_dirty() -> bool:
	return not EditorWarRules.same_json(_canonical, _saved_canonical)


func _dirty() -> bool:
	return _changed() or _canonical_dirty() or (_saved == null and not _briefing.is_empty())


func _shown_canonical_problems() -> Array:
	return _canonical_problems if _canonical_dirty() else []


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
	var day_header := HFlowContainer.new()
	day_header.add_theme_constant_override("h_separation", 7)
	day_header.add_theme_constant_override("v_separation", 7)
	var day_title := EditorWarKit.section_title("Day-one facts")
	day_title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	day_title.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	day_header.add_child(day_title)
	var adds := HBoxContainer.new()
	adds.add_theme_constant_override("separation", 6)
	_day_one_adds.clear()
	for kind in _kinds:
		var add := EditorWarKit.button(str(ADD_LABELS.get(kind, kind)))
		add.pressed.connect(_add_day_one.bind(str(kind)))
		adds.add_child(add)
		_day_one_adds.append(add)
	day_header.add_child(adds)
	day_column.add_child(day_header)
	day_column.add_child(EditorWarKit.gap(9))
	day_column.add_child(EditorWarKit.hint("Add or edit the diplomatic relationships, treaties and ongoing processes that already exist on the start date. They become canonical game records when a new campaign opens. Use the exact scenario country names. Existing wars and subordinations remain removable; the native war and puppet authoring contracts are unchanged."))
	day_column.add_child(EditorWarKit.gap(8))
	_day_one_empty = EditorWarKit.hint("No Day-one facts yet. You can add one without generating pre-history.")
	day_column.add_child(_day_one_empty)
	_day_one_rows = VBoxContainer.new()
	_day_one_rows.add_theme_constant_override("separation", 7)
	day_column.add_child(_day_one_rows)
	var canonical := VBoxContainer.new()
	canonical.add_theme_constant_override("separation", 0)
	canonical.add_child(EditorWarKit.gap(10))
	var rule := ColorRect.new()
	rule.color = Color(1, 1, 1, 0.08)
	rule.custom_minimum_size.y = 1
	canonical.add_child(rule)
	canonical.add_child(EditorWarKit.gap(10))
	canonical.add_child(EditorWarKit.section_title("Existing scenario agreements"))
	canonical.add_child(EditorWarKit.gap(8))
	canonical.add_child(EditorWarKit.hint("These are already in the scenario's formal agreements ledger (including Political World generated treaties), not generated Pre-history facts. Edit or remove them here to change the starting state of NEW campaigns. Existing campaign saves are unaffected."))
	canonical.add_child(EditorWarKit.gap(8))
	_canonical_rows = VBoxContainer.new()
	_canonical_rows.add_theme_constant_override("separation", 7)
	canonical.add_child(_canonical_rows)
	_canonical_box = canonical
	day_column.add_child(canonical)
	_general_problems = VBoxContainer.new()
	_general_problems.add_theme_constant_override("separation", 4)
	day_column.add_child(_general_problems)
	_suggest_box = PanelContainer.new()
	_suggest_box.top_level = true
	_suggest_box.visible = false
	_suggest_box.z_index = 10
	_suggest_box.add_theme_stylebox_override("panel", UI.box(Color8(26, 27, 31, 252), Color(1, 1, 1, 0.14), 9, 1, Vector4(4, 4, 4, 4)))
	var suggest_scroll := ScrollContainer.new()
	suggest_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	suggest_scroll.name = "Scroll"
	_suggest_box.add_child(suggest_scroll)
	_suggest_list = VBoxContainer.new()
	_suggest_list.add_theme_constant_override("separation", 0)
	_suggest_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	suggest_scroll.add_child(_suggest_list)
	add_child(_suggest_box)

	_error_label = UI.wrapped("", 12, EditorWarKit.ALERT)
	_error_holder = _spaced(_error_label, 11)
	column.add_child(_error_holder)
	_message_label = UI.wrapped("", 12, Color(1, 1, 1, 0.72))
	_message_holder = _spaced(_message_label, 11)
	column.add_child(_message_holder)
	_problems_holder = _spaced(UI.wrapped("Fix the events marked above before saving.", 12, EditorWarKit.ALERT), 11)
	column.add_child(_problems_holder)
	_day_problems_holder = _spaced(UI.wrapped("Fix the Day-one facts marked above before saving.", 12, EditorWarKit.ALERT), 6)
	column.add_child(_day_problems_holder)
	var canonical_problems := VBoxContainer.new()
	canonical_problems.add_theme_constant_override("separation", 0)
	canonical_problems.add_child(UI.wrapped("Fix the existing agreement problems before saving.", 12, EditorWarKit.ALERT))
	_canonical_problems_lines = VBoxContainer.new()
	_canonical_problems_lines.add_theme_constant_override("separation", 0)
	canonical_problems.add_child(_canonical_problems_lines)
	_canonical_problems_holder = _spaced(canonical_problems, 6)
	column.add_child(_canonical_problems_holder)
	column.add_child(EditorWarKit.gap(12))
	var actions := HBoxContainer.new()
	actions.add_theme_constant_override("separation", 7)
	_save_button = EditorWarKit.button("Save starting history", "primary")
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


func _fact_kind(family: String, fact: Dictionary) -> String:
	if family == "canonicalUpdates":
		return str(fact.get("kind", ""))
	return str({"relationUpdates": "relation", "agreementUpdates": "agreement", "storylineUpdates": "storyline"}.get(family, ""))


func _fact_at(family: String, index: int) -> Variant:
	var updates: Variant = _draft.get("updates")
	if not (updates is Dictionary) or not ((updates as Dictionary).get(family) is Array):
		return null
	var rows: Array = (updates as Dictionary)[family]
	return rows[index] if index >= 0 and index < rows.size() and rows[index] is Dictionary else null


func _problems_for(family: String, index: int) -> Array:
	var out: Array = []
	for entry in _day_one_problems:
		if entry is Dictionary and str(entry.get("family", "")) == family and int(EditorWarRules.to_number(entry.get("index"))) == index:
			out.append(str(entry.get("problem", "")))
	return out


func _agreement_problems_for(id: String) -> Array:
	var out: Array = []
	for entry in _shown_canonical_problems():
		if entry is Dictionary and str(entry.get("id", "")) == id:
			out.append(str(entry.get("problem", "")))
	return out


func _agreement_id(agreement: Variant) -> String:
	return EditorWarRules.js_string((agreement as Dictionary).get("id")).strip_edges() if agreement is Dictionary else ""


func _render_day_one() -> void:
	_hide_suggest()
	EditorKit.clear(_day_one_rows)
	EditorKit.clear(_canonical_rows)
	_fact_editors.clear()
	_agreement_editors.clear()
	var rows := EditorHistoryRules.update_rows(_draft)
	for row in rows:
		var family := str(row.get("family", ""))
		var at := int(row.get("index", 0))
		var fact: Variant = _fact_at(family, at)
		var kind := _fact_kind(family, fact if fact is Dictionary else {})
		if fact is Dictionary and _kinds.has(kind):
			var key := family + ":" + EditorWarRules.js_string((fact as Dictionary).get("ref", (fact as Dictionary).get("id", at)))
			var editor := DayOneFactEditor.new()
			editor.setup({"family": family, "index": at}, fact, {
				"problems": _problems_for(family, at), "disabled": _busy, "agreementTypes": _agreement_types,
				"suggest": _attach_suggest, "open": bool(_open_facts.get(key, false)),
			})
			editor.toggled.connect(_remember_open.bind(key))
			editor.changed.connect(_edit_fact.bind(family, at))
			editor.type_changed.connect(_change_fact_type.bind(at))
			editor.reciprocal_changed.connect(_change_fact_reciprocal.bind(at))
			editor.remove_requested.connect(_remove_day_one.bind(family, at))
			_fact_editors[family + ":" + str(at)] = editor
			_day_one_rows.add_child(editor)
			continue
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
		remove.pressed.connect(_remove_day_one.bind(family, at))
		line.add_child(remove)
		_day_one_rows.add_child(line)
	_canonical_box.visible = not _canonical.is_empty()
	for index in range(_canonical.size()):
		var agreement: Dictionary = _canonical[index] if _canonical[index] is Dictionary else {}
		var id := _agreement_id(agreement)
		var count := 0
		for other in _canonical:
			if _agreement_id(other) == id:
				count += 1
		var valid := not id.is_empty() and count == 1
		var holder := VBoxContainer.new()
		holder.add_theme_constant_override("separation", 3)
		var editor := DayOneFactEditor.new()
		editor.setup({"family": "worldAgreements"}, agreement, {
			"problems": _agreement_problems_for(id), "disabled": _busy or not valid, "agreementTypes": _agreement_types,
			"suggest": _attach_suggest, "open": bool(_open_facts.get("worldAgreements:" + id, false)),
		})
		editor.toggled.connect(_remember_open.bind("worldAgreements:" + id))
		editor.changed.connect(_edit_agreement.bind(id))
		editor.type_changed.connect(_agreement_op_type.bind(id))
		editor.reciprocal_changed.connect(_agreement_op_reciprocal.bind(id))
		editor.remove_requested.connect(_remove_agreement.bind(id))
		if valid:
			_agreement_editors[id] = editor
		holder.add_child(editor)
		if not valid:
			holder.add_child(UI.wrapped("This older agreement has no unique canonical ID and cannot safely be edited here.", 11, EditorWarKit.ALERT))
		_canonical_rows.add_child(holder)


func _render_day_one_problems() -> void:
	for key in _fact_editors:
		var parts: PackedStringArray = str(key).split(":")
		_fact_editors[key].set_problems(_problems_for(parts[0], int(parts[1])))
	for id in _agreement_editors:
		_agreement_editors[id].set_problems(_agreement_problems_for(str(id)))
	EditorKit.clear(_general_problems)
	for problem in _problems_for("canonicalUpdates", -1):
		_general_problems.add_child(UI.wrapped(problem, 11, EditorWarKit.ALERT))
	_general_problems.visible = _general_problems.get_child_count() > 0
	EditorKit.clear(_canonical_problems_lines)
	for entry in _shown_canonical_problems():
		var id := str((entry as Dictionary).get("id", "")) if entry is Dictionary else ""
		var shown := false
		for agreement in _canonical:
			if _agreement_id(agreement) == id:
				shown = true
				break
		if not shown and entry is Dictionary:
			_canonical_problems_lines.add_child(UI.wrapped(str((entry as Dictionary).get("problem", "")), 12, EditorWarKit.ALERT))


func _remember_open(open: bool, key: String) -> void:
	_open_facts[key] = open


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
	var facts: Array = (_draft.get("updates", {}) as Dictionary).get("canonicalUpdates", []) if _draft.get("updates") is Dictionary else []
	for add in _day_one_adds:
		EditorWarKit.set_enabled(add, not _busy and facts.size() < _most_facts)
	_day_one_empty.visible = EditorHistoryRules.update_rows(_draft).is_empty() and _canonical.is_empty()
	_day_problems_holder.visible = not _day_one_problems.is_empty()
	_canonical_problems_holder.visible = not _shown_canonical_problems().is_empty()
	_render_day_one_problems()
	EditorWarKit.set_enabled(_save_button, not _busy and _dirty() and problems.is_empty() and _day_one_problems.is_empty() and _shown_canonical_problems().is_empty())
	EditorWarKit.set_enabled(_discard_button, not _busy and _dirty())


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
	if (not _events().is_empty() or not EditorHistoryRules.update_rows(_draft).is_empty()) and not await EditorKit.ask(EditorWarKit.host_of(self, _props), "Replace the events and Day-one facts below with a newly generated pre-history? You can still discard the result before saving."):
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
		_request_check()
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
	if _scenario_id.is_empty() or _busy or not _problems().is_empty() or not _day_one_problems.is_empty() or not _shown_canonical_problems().is_empty():
		return
	_busy = true
	_error = ""
	_message = ""
	_render_status()
	var payload := {"scenarioId": _scenario_id, "draft": _draft, "prompt": _prompt, "startDate": _start_date, "withPrehistory": _changed() or (_saved == null and not _briefing.is_empty())}
	if _canonical_dirty():
		payload["agreements"] = _canonical
	var reply := await engine.request("editor.history.save", payload)
	_busy = false
	if not is_inside_tree():
		return
	if reply.get("ok", false):
		var result: Dictionary = reply["result"]
		var details: Dictionary = result.get("details", {})
		details_changed.emit(details)
		_adopt_details(details)
		_draft = (result.get("draft", {}) as Dictionary).duplicate(true)
		_canonical = _saved_canonical.duplicate(true)
		_message = "Starting history saved. New games from this scenario use the updated agreements and Day-one facts."
		_render_all()
		_request_check()
	else:
		_error = str(reply.get("error", ""))
		_render_status()


func _discard() -> void:
	_reset_draft()
	_message = ""
	_error = ""
	_render_all()
	_request_check()


func _open_day_one() -> void:
	var asked := _scenario_id
	var reply := await engine.request("editor.history.dayOne", {"op": "open", "scenarioId": _scenario_id})
	if not is_inside_tree() or asked != _scenario_id or not reply.get("ok", false):
		return
	var result: Dictionary = reply["result"]
	_polities = result.get("polities", []) if result.get("polities") is Array else []
	_agreement_types = result.get("agreementTypes", []) if result.get("agreementTypes") is Array else []
	_most_facts = int(EditorWarRules.to_number(result.get("most", 32)))
	_render_day_one()
	_render_status()
	_request_check()


func _request_check() -> void:
	_check_seq += 1
	var seq := _check_seq
	_checks_running += 1
	var reply := await engine.request("editor.history.dayOne", {"op": "check", "scenarioId": _scenario_id, "draft": _draft, "agreements": _canonical, "startDate": _start_date})
	_checks_running -= 1
	if not is_inside_tree() or seq != _check_seq or not reply.get("ok", false):
		return
	var result: Dictionary = reply["result"]
	_day_one_problems = result.get("dayOne", []) if result.get("dayOne") is Array else []
	_canonical_problems = result.get("canonical", []) if result.get("canonical") is Array else []
	_render_status()


func _day_one_op(payload: Dictionary) -> bool:
	payload["draft"] = _draft
	var reply := await engine.request("editor.history.dayOne", payload)
	if not is_inside_tree():
		return false
	if not reply.get("ok", false):
		_error = str(reply.get("error", ""))
		_render_status()
		return false
	var result: Dictionary = reply["result"]
	if result.get("draft") is Dictionary:
		_draft = (result["draft"] as Dictionary).duplicate(true)
	_error = ""
	_render_day_one()
	_render_status()
	_request_check()
	return true


func _add_day_one(kind: String) -> void:
	_message = ""
	await _day_one_op({"op": "insert", "kind": kind})


func _edit_fact(patch: Dictionary, family: String, index: int) -> void:
	var fact: Variant = _fact_at(family, index)
	if not (fact is Dictionary):
		return
	for key in patch:
		if patch[key] == null:
			(fact as Dictionary).erase(key)
		else:
			(fact as Dictionary)[key] = patch[key]
	_error = ""
	_message = ""
	_render_status()
	_request_check()


func _change_fact_type(agreement_type: String, index: int) -> void:
	await _day_one_op({"op": "type", "index": index, "type": agreement_type})


func _change_fact_reciprocal(on: bool, index: int) -> void:
	await _day_one_op({"op": "reciprocal", "index": index, "reciprocal": on})


func _remove_day_one(family: String, index: int) -> void:
	var next: Variant = EditorHistoryRules.without_update(_draft, family, index)
	if next is Dictionary:
		_draft = next
	_error = ""
	_message = ""
	_render_day_one()
	_render_status()
	_request_check()


func _agreement_op(payload: Dictionary) -> void:
	payload["agreements"] = _canonical
	var reply := await engine.request("editor.history.dayOne", payload)
	if not is_inside_tree():
		return
	if not reply.get("ok", false):
		_error = str(reply.get("error", ""))
		_render_status()
		return
	var result: Dictionary = reply["result"]
	if result.get("agreements") is Array:
		_canonical = (result["agreements"] as Array).duplicate(true)
	_error = ""
	_message = ""
	_render_day_one()
	_render_status()
	_request_check()


func _edit_agreement(patch: Dictionary, id: String) -> void:
	for agreement in _canonical:
		if _agreement_id(agreement) == id:
			for key in patch:
				(agreement as Dictionary)[key] = patch[key] if patch[key] != null else ""
			break
	_error = ""
	_message = ""
	_render_status()
	_request_check()


func _agreement_op_type(agreement_type: String, id: String) -> void:
	await _agreement_op({"op": "agreement-type", "id": id, "type": agreement_type})


func _agreement_op_reciprocal(on: bool, id: String) -> void:
	await _agreement_op({"op": "agreement-reciprocal", "id": id, "reciprocal": on})


func _remove_agreement(id: String) -> void:
	if not await EditorKit.ask(EditorWarKit.host_of(self, _props), "Remove this existing agreement from the scenario? Existing campaigns will not change."):
		return
	await _agreement_op({"op": "agreement-remove", "id": id})


func _attach_suggest(line: LineEdit) -> void:
	line.focus_entered.connect(_show_suggest.bind(line))
	line.text_changed.connect(_suggest_typed.bind(line))
	line.focus_exited.connect(_hide_suggest_later)


func _suggest_typed(_text: String, line: LineEdit) -> void:
	_show_suggest(line)


func _suggest_row(value: String) -> Button:
	var row := Button.new()
	row.focus_mode = Control.FOCUS_NONE
	row.alignment = HORIZONTAL_ALIGNMENT_LEFT
	row.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	row.custom_minimum_size.y = 28
	row.text = value
	row.clip_text = true
	row.add_theme_font_override("font", UI.font(400))
	row.add_theme_font_size_override("font_size", 12)
	for color_name in ["font_color", "font_focus_color"]:
		row.add_theme_color_override(color_name, Color(1, 1, 1, 0.86))
	for color_name in ["font_hover_color", "font_pressed_color", "font_hover_pressed_color"]:
		row.add_theme_color_override(color_name, UI.WHITE)
	row.add_theme_stylebox_override("normal", UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 7, 0, Vector4(10, 0, 10, 0)))
	row.add_theme_stylebox_override("focus", UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 7, 0, Vector4(10, 0, 10, 0)))
	row.add_theme_stylebox_override("hover", UI.box(Color(1, 1, 1, 0.1), Color(0, 0, 0, 0), 7, 0, Vector4(10, 0, 10, 0)))
	row.add_theme_stylebox_override("pressed", UI.box(Color(1, 1, 1, 0.14), Color(0, 0, 0, 0), 7, 0, Vector4(10, 0, 10, 0)))
	row.pressed.connect(_pick_suggestion.bind(value))
	return row


func _show_suggest(line: LineEdit) -> void:
	if not is_instance_valid(line) or not line.is_inside_tree() or _polities.is_empty():
		return
	_suggest_target = line
	EditorKit.clear(_suggest_list)
	var wanted := line.text.strip_edges().to_lower()
	var shown := 0
	for name in _polities:
		var value := str(name)
		if value == line.text or (not wanted.is_empty() and not value.to_lower().contains(wanted)):
			continue
		_suggest_list.add_child(_suggest_row(value))
		shown += 1
		if shown >= 60:
			break
	if shown == 0:
		_suggest_box.visible = false
		return
	var rect := line.get_global_rect()
	var width := maxf(rect.size.x, 220.0)
	var scroll: ScrollContainer = _suggest_box.get_node("Scroll")
	scroll.custom_minimum_size = Vector2(width - 8, minf(220.0, float(shown) * 28.0))
	_suggest_box.global_position = Vector2(rect.position.x, rect.end.y + 4)
	_suggest_box.size = Vector2(width, 0)
	_suggest_box.reset_size()
	var view := get_viewport_rect().size
	if _suggest_box.global_position.y + _suggest_box.size.y > view.y - 8.0:
		_suggest_box.global_position.y = rect.position.y - _suggest_box.size.y - 4.0
	_suggest_box.visible = true


func _pick_suggestion(value: String) -> void:
	_suggest_box.visible = false
	if not is_instance_valid(_suggest_target):
		return
	var target := _suggest_target
	target.text = value
	target.caret_column = value.length()
	target.text_changed.emit(value)
	_suggest_box.visible = false


func _hide_suggest_later() -> void:
	await get_tree().create_timer(0.15).timeout
	if is_instance_valid(self) and is_inside_tree() and (not is_instance_valid(_suggest_target) or not _suggest_target.has_focus()):
		_suggest_box.visible = false


func _hide_suggest() -> void:
	if _suggest_box:
		_suggest_box.visible = false
	_suggest_target = null
