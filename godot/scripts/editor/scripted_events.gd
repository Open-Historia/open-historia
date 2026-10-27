class_name EditorScriptedEvents
extends VBoxContainer

signal details_changed(details: Dictionary)
signal value_changed(value: Variant)
signal use_scenario_default
signal start_override

const CONDITION_DEFINITIONS := [
	{"type": "polity_exists", "label": "Polity exists", "fields": ["polityId"]},
	{"type": "polity_not_exists", "label": "Polity does not exist", "fields": ["polityId"]},
	{"type": "political_actor_exists", "label": "Polity has Political World data", "fields": ["polityId"]},
	{"type": "political_actor_not_exists", "label": "Polity has no Political World data", "fields": ["polityId"]},
	{"type": "institution_exists", "label": "Institution exists", "fields": ["institutionId"]},
	{"type": "institution_not_exists", "label": "Institution does not exist", "fields": ["institutionId"]},
	{"type": "institution_has_polity", "label": "Polity is in institution", "fields": ["institutionId", "polityId"]},
	{"type": "institution_lacks_polity", "label": "Polity is not in institution", "fields": ["institutionId", "polityId"]},
	{"type": "institution_member_status", "label": "Polity has institution status", "fields": ["institutionId", "polityId", "status"]},
	{"type": "polity_subordinate_to", "label": "Polity is subordinate to polity", "fields": ["polityId", "overlordId", "kind"]},
	{"type": "polity_not_subordinate_to", "label": "Polity is not subordinate to polity", "fields": ["polityId", "overlordId", "kind"]},
	{"type": "polity_controls_region", "label": "Polity controls region", "fields": ["polityId", "regionId", "baseOwner"]},
	{"type": "polity_not_controls_region", "label": "Polity does not control region", "fields": ["polityId", "regionId", "baseOwner"]},
	{"type": "scripted_event_fired", "label": "Earlier scripted event happened", "fields": ["eventId"]},
	{"type": "scripted_event_skipped", "label": "Earlier scripted event was skipped", "fields": ["eventId"]},
	{"type": "scripted_outcome_selected", "label": "Earlier event selected an outcome", "fields": ["eventId", "outcomeId"]},
	{"type": "scripted_outcome_not_selected", "label": "Earlier event did not select an outcome", "fields": ["eventId", "outcomeId"]},
]
const MONO := "Consolas"
const BUTTON_INK := Color(246 / 255.0, 246 / 255.0, 248 / 255.0, 0.92)
const ROSE_INK := Color("#fecaca")
const AMBER := Color("#fbbf24")
const SECTION_BG := Color(1, 1, 1, 0.025)
const SECTION_BORDER := Color(1, 1, 1, 0.07)
const ENTITY_TIP := "Type to search by name. An exact canonical ID may also be entered for an advanced/future reference."

var _engine: EngineLink
var _host: Node
var _events: Array = []
var _scenario_value: Array = []
var _is_game := false
var _overridden := true
var _world: Dictionary = {}
var _options := {"polities": [], "institutions": [], "memberStatuses": [], "puppetKinds": []}
var _summary: Control
var _manager: Control
var _manager_count: Label
var _list: VBoxContainer
var _empty_label: Label
var _articles := {}
var _expanded_key := ""
var _query := ""
var _sort_direction := "asc"
var _filter_mode := "all"
var _search_edit: LineEdit
var _filter_select: OptionButton
var _sort_select: OptionButton
var _editor_refreshers: Array[Callable] = []
var _refreshers_by_key := {}
var _suggest: PanelContainer
var _suggest_list: VBoxContainer
var _suggest_scroll: ScrollContainer
var _suggest_owner: LineEdit


static func clean(value: Variant) -> String:
	return EditorFeaturesModel.js_trim(EditorFeaturesModel.text_of(value))


static func list_of(value: Variant) -> Array:
	return value if value is Array else []


static func definition_of(type: String) -> Dictionary:
	for entry in CONDITION_DEFINITIONS:
		if str((entry as Dictionary)["type"]) == type:
			return entry
	return CONDITION_DEFINITIONS[0]


static func has_definition(type: String) -> bool:
	for entry in CONDITION_DEFINITIONS:
		if str((entry as Dictionary)["type"]) == type:
			return true
	return false


static func random_tail(count: int) -> String:
	var digits := "0123456789abcdefghijklmnopqrstuvwxyz"
	var out := ""
	for _index in range(count):
		out += digits[randi() % 36]
	return out


static func make_id() -> String:
	return "scripted-%s-%s" % [EditorFeaturesModel.base36(int(Time.get_unix_time_from_system() * 1000.0)), random_tail(6)]


static func make_event() -> Dictionary:
	return {
		"id": make_id(),
		"date": "",
		"text": "",
		"textMode": "generated",
		"trigger": {"mode": "rules", "operator": "all", "conditions": [], "percent": 100.0},
	}


static func make_condition() -> Dictionary:
	return {"type": "polity_exists", "polityId": ""}


static func make_outcome() -> Dictionary:
	return {"id": "outcome-%s-%s" % [EditorFeaturesModel.base36(int(Time.get_unix_time_from_system() * 1000.0)), random_tail(4)], "text": "", "weight": 1.0}


static func title_case(value: String) -> String:
	var text := clean(value).replace("_", " ")
	var out := ""
	var boundary := true
	for index in range(text.length()):
		var character := text.substr(index, 1)
		var code := text.unicode_at(index)
		var word := (code >= 48 and code <= 57) or (code >= 65 and code <= 90) or (code >= 97 and code <= 122) or code == 95
		out += character.to_upper() if word and boundary else character
		boundary = not word
	return out


static func rules_from_trigger(trigger_input: Variant) -> Dictionary:
	var trigger: Dictionary = trigger_input if trigger_input is Dictionary else {}
	var mode := clean(trigger.get("mode")).to_lower()
	if mode.is_empty():
		mode = "always"
	var model := EditorFeaturesModel
	if mode == "rules":
		var operator := str(trigger.get("operator")) if ["all", "any", "at_least"].has(trigger.get("operator")) else "all"
		var required_number := model.js_number(trigger["requiredCount"]) if trigger.has("requiredCount") else NAN
		var percent_number := model.js_number(trigger["percent"]) if trigger.has("percent") else NAN
		return {
			"mode": "rules",
			"operator": operator,
			"requiredCount": model.js_trunc(required_number) if model.is_finite_number(required_number) else 1.0,
			"conditions": list_of(trigger.get("conditions")),
			"percent": clampf(percent_number, 0.0, 100.0) if model.is_finite_number(percent_number) else 100.0,
		}
	if mode == "chance":
		var chance := model.js_number(trigger["percent"]) if trigger.has("percent") else NAN
		return {"mode": "rules", "operator": "all", "requiredCount": 0.0, "conditions": [], "percent": clampf(chance, 0.0, 100.0) if model.is_finite_number(chance) else 50.0}
	if mode == "conditional":
		return {"mode": "rules", "operator": "any" if trigger.get("operator") == "any" else "all", "requiredCount": 1.0, "conditions": list_of(trigger.get("conditions")), "percent": 100.0}
	return {"mode": "rules", "operator": "all", "requiredCount": 0.0, "conditions": [], "percent": 100.0}


static func event_key(event: Variant, index: int) -> String:
	var id := clean((event as Dictionary).get("id") if event is Dictionary else null)
	return id if not id.is_empty() else "scripted-row-%d" % index


static func text_mode_of(event: Variant) -> String:
	var raw: Variant = (event as Dictionary).get("textMode") if event is Dictionary else null
	return "exact" if clean(raw).to_lower() == "exact" else "generated"


static func event_title(event: Variant) -> String:
	var text := clean((event as Dictionary).get("text") if event is Dictionary else null)
	if text.is_empty():
		return "Untitled scripted event"
	var first_line := EditorFeaturesModel.js_trim(text.replace("\r\n", "\n").split("\n")[0])
	return first_line.substr(0, 89) + "..." if first_line.length() > 92 else first_line


static func event_rule_summary(event: Variant) -> String:
	var rules := rules_from_trigger((event as Dictionary).get("trigger") if event is Dictionary else null)
	var conditions := list_of(rules["conditions"])
	var raw_percent := EditorFeaturesModel.js_number(rules["percent"])
	var percent := clampf(raw_percent if EditorFeaturesModel.is_finite_number(raw_percent) and raw_percent != 0.0 else 0.0, 0.0, 100.0)
	var percent_text := EditorFeaturesModel.number_text(percent)
	var wording := " · EXACT WORDING" if text_mode_of(event) == "exact" else ""
	var count := conditions.size()
	if count == 0:
		return "NO CONDITIONS · %s%%%s" % [percent_text, wording]
	if rules["operator"] == "any":
		return "ANY · %d CONDITION%s · %s%%%s" % [count, "" if count == 1 else "S", percent_text, wording]
	if rules["operator"] == "at_least":
		var required_raw := EditorFeaturesModel.js_number(rules["requiredCount"])
		var required := maxf(1.0, minf(float(count), required_raw if EditorFeaturesModel.is_finite_number(required_raw) and required_raw != 0.0 else 1.0))
		return "AT LEAST %s/%d · %s%%%s" % [EditorFeaturesModel.number_text(required), count, percent_text, wording]
	return "ALL · %d CONDITION%s · %s%%%s" % [count, "" if count == 1 else "S", percent_text, wording]


static func outcome_weight(value: Variant) -> float:
	var number := EditorFeaturesModel.js_number(value) if value != null else EditorFeaturesModel.js_number(null)
	return maxf(0.0, number) if EditorFeaturesModel.is_finite_number(number) else 0.0


static func weight_of(outcome: Variant) -> float:
	if not (outcome is Dictionary) or not (outcome as Dictionary).has("weight"):
		return 0.0
	return outcome_weight((outcome as Dictionary)["weight"])


static func to_fixed(number: float, digits: int) -> String:
	var scale := pow(10.0, digits)
	var rounded := floorf(number * scale + 0.5) / scale
	return ("%." + str(digits) + "f") % rounded


static func outcome_chance_text(outcomes_input: Variant, index: int) -> String:
	var outcomes := list_of(outcomes_input)
	var total := 0.0
	for outcome in outcomes:
		total += weight_of(outcome)
	var weight := weight_of(outcomes[index]) if index < outcomes.size() else 0.0
	if not (total > 0.0) or not (weight > 0.0):
		return "0%"
	var percent := weight / total * 100.0
	return (to_fixed(percent, 0) if percent >= 10.0 else to_fixed(percent, 1)) + "%"


static func prior_events(events: Array, current_index: int) -> Array:
	var current: Variant = events[current_index] if current_index < events.size() else null
	var current_date := clean((current as Dictionary).get("date") if current is Dictionary else null)
	var prior: Array = []
	for index in range(events.size()):
		if index == current_index:
			continue
		var event: Variant = events[index]
		var date := clean((event as Dictionary).get("date") if event is Dictionary else null)
		var keep := false
		if current_date.is_empty() or date.is_empty():
			keep = index < current_index
		elif date < current_date:
			keep = true
		else:
			keep = date == current_date and index < current_index
		if keep:
			prior.append({"event": event, "index": index})
	return prior


static func clone_event(event: Dictionary) -> Dictionary:
	var copy := event.duplicate()
	copy["id"] = make_id()
	var rules := rules_from_trigger(event.get("trigger"))
	var trigger := rules.duplicate()
	var conditions: Array = []
	for condition in list_of(rules["conditions"]):
		conditions.append((condition as Dictionary).duplicate() if condition is Dictionary else condition)
	trigger["conditions"] = conditions
	copy["trigger"] = trigger
	var outcomes: Array = []
	for outcome in list_of(event.get("outcomes")):
		var record: Dictionary = (outcome as Dictionary).duplicate() if outcome is Dictionary else {}
		var base := clean(record.get("id"))
		record["id"] = "%s-%s" % [base if not base.is_empty() else "outcome", random_tail(4)]
		outcomes.append(record)
	copy["outcomes"] = outcomes
	return copy


static func picker_label(value: String, options: Array) -> String:
	var id := clean(value)
	if id.is_empty():
		return ""
	for option in options:
		if str((option as Dictionary).get("id", "")) == id:
			var label := str((option as Dictionary).get("label", ""))
			return label if not label.is_empty() else id
	return id


static func picker_value(typed: String, options: Array) -> String:
	var value := clean(typed)
	if value.is_empty():
		return ""
	var exact: Array = []
	for option in options:
		if str((option as Dictionary).get("label", "")) == value:
			exact.append(option)
	if exact.size() == 1:
		return str((exact[0] as Dictionary)["id"])
	for option in options:
		if str((option as Dictionary).get("id", "")) == value:
			return value
	return value


static func valid_number_text(text: String) -> bool:
	var trimmed := text.strip_edges()
	if trimmed.is_empty():
		return true
	return RegEx.create_from_string("^[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?$").search(trimmed) != null


func setup(engine: EngineLink, props: Dictionary) -> void:
	_engine = engine
	add_theme_constant_override("separation", 0)
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_read_props(props)
	_build_summary()


func update_props(props: Dictionary) -> void:
	var before_mode := _is_game and not _overridden
	_read_props(props)
	if before_mode != (_is_game and not _overridden):
		_build_summary()
	else:
		_refresh_summary()
	if _manager and is_instance_valid(_manager):
		_render_list()


func _read_props(props: Dictionary) -> void:
	_host = props.get("host", _host)
	_events = list_of(props.get("value", _events))
	_scenario_value = list_of(props.get("scenarioValue", _scenario_value))
	_is_game = bool(props.get("isGame", _is_game))
	_overridden = bool(props.get("overridden", _overridden))
	if props.has("world"):
		_world = props["world"] if props["world"] is Dictionary else {}
	if props.has("options"):
		var options: Dictionary = props["options"]
		for key in options:
			_options[key] = options[key]


func _button(text: String, bg_alpha := 0.06, ink := BUTTON_INK, size := 13) -> Button:
	var node := Button.new()
	node.text = text
	node.focus_mode = Control.FOCUS_NONE
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var normal := UI.box(Color(1, 1, 1, bg_alpha), Color(1, 1, 1, 0.12), 9, 1, Vector4(10, 3, 10, 3))
	var hover := UI.box(Color(1, 1, 1, minf(1.0, bg_alpha + 0.05)), Color(1, 1, 1, 0.22), 9, 1, Vector4(10, 3, 10, 3))
	for state in [["normal", normal], ["hover", hover], ["pressed", hover], ["hover_pressed", hover], ["focus", normal], ["disabled", normal]]:
		node.add_theme_stylebox_override(state[0], state[1])
	node.add_theme_font_override("font", UI.font(600))
	node.add_theme_font_size_override("font_size", size)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		node.add_theme_color_override(name, ink)
	node.custom_minimum_size.y = 32
	return node


func _range_text() -> String:
	var dates: PackedStringArray = []
	for event in _events:
		var date := clean((event as Dictionary).get("date") if event is Dictionary else null)
		if not date.is_empty():
			dates.append(date)
	dates.sort()
	if dates.is_empty():
		return "No dates set"
	if dates.size() == 1:
		return dates[0]
	return "%s → %s" % [dates[0], dates[dates.size() - 1]]


func _count_text(count: int, noun: String) -> String:
	return "%d %s%s" % [count, noun, "" if count == 1 else "s"]


func _build_summary() -> void:
	if _summary and is_instance_valid(_summary):
		_summary.queue_free()
	if _is_game and not _overridden:
		var holder := PanelContainer.new()
		holder.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.025), Color(1, 1, 1, 0.08), 10, 1, Vector4(10, 10, 10, 10)))
		var column := VBoxContainer.new()
		column.add_theme_constant_override("separation", 7)
		var count := _scenario_value.size()
		var line := UI.wrapped("Following the scenario (%d scripted event%s)." % [count, "" if count == 1 else "s"], 12, Color(1, 1, 1, 0.62))
		line.name = "Following"
		column.add_child(line)
		var override := _button("Override for this game")
		override.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		override.pressed.connect(func() -> void: start_override.emit())
		column.add_child(override)
		holder.add_child(column)
		_summary = holder
		add_child(holder)
		return
	var bar := PanelContainer.new()
	bar.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.025), Color(1, 1, 1, 0.08), 12, 1, Vector4(12, 11, 12, 11)))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 11)
	var texts := VBoxContainer.new()
	texts.add_theme_constant_override("separation", 3)
	texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var count_label := UI.label("", 13, Color(1, 1, 1, 0.9), 800)
	count_label.name = "Count"
	texts.add_child(count_label)
	var range_label := UI.label("", 11, Color(1, 1, 1, 0.45))
	range_label.name = "Range"
	texts.add_child(range_label)
	row.add_child(texts)
	var buttons := HBoxContainer.new()
	buttons.add_theme_constant_override("separation", 6)
	buttons.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	if _is_game and _overridden:
		var reset := _button("Use scenario default")
		reset.pressed.connect(func() -> void: use_scenario_default.emit())
		buttons.add_child(reset)
	var manage := _button("Manage scripted events", 0.09)
	manage.name = "Manage"
	manage.pressed.connect(open_manager)
	buttons.add_child(manage)
	row.add_child(buttons)
	bar.add_child(row)
	_summary = bar
	add_child(bar)
	_refresh_summary()


func _refresh_summary() -> void:
	if not _summary or not is_instance_valid(_summary):
		return
	var count_label := _summary.find_child("Count", true, false) as Label
	if count_label:
		count_label.text = _count_text(_events.size(), "scripted event")
	var range_label := _summary.find_child("Range", true, false) as Label
	if range_label:
		range_label.text = _range_text()
	var following := _summary.find_child("Following", true, false) as Label
	if following:
		var count := _scenario_value.size()
		following.text = "Following the scenario (%d scripted event%s)." % [count, "" if count == 1 else "s"]


func _change(next: Array) -> void:
	_events = next
	value_changed.emit(next)
	_refresh_summary()
	if _manager and is_instance_valid(_manager):
		_render_list()


func is_manager_open() -> bool:
	return _manager != null and is_instance_valid(_manager)


func open_manager() -> void:
	if is_manager_open():
		return
	var target: Node = _host if _host and is_instance_valid(_host) else get_tree().root
	_manager = Control.new()
	_manager.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_manager.mouse_filter = Control.MOUSE_FILTER_STOP
	var backdrop := GlassPanel.new(Color(6 / 255.0, 6 / 255.0, 7 / 255.0, 0.78), 0.0, Vector4(0, 0, 0, 0), Color(0, 0, 0, 0))
	backdrop.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	backdrop.gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventMouseButton and (event as InputEventMouseButton).pressed and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT:
			close_manager())
	_manager.add_child(backdrop)
	var centre := CenterContainer.new()
	centre.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	centre.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_manager.add_child(centre)
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", UI.box(Color(24 / 255.0, 24 / 255.0, 27 / 255.0, 0.98), Color(1, 1, 1, 0.11), 20, 1, Vector4(0, 0, 0, 0)))
	panel.mouse_filter = Control.MOUSE_FILTER_STOP
	centre.add_child(panel)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	panel.add_child(column)
	var header := _manager_header()
	column.add_child(header)
	var toolbar := _manager_toolbar()
	column.add_child(toolbar)
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var body_margin := MarginContainer.new()
	body_margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for side in [["margin_left", 16], ["margin_right", 16], ["margin_top", 12], ["margin_bottom", 16]]:
		body_margin.add_theme_constant_override(side[0], side[1])
	scroll.add_child(body_margin)
	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 10)
	body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body_margin.add_child(body)
	var info := PanelContainer.new()
	info.add_theme_stylebox_override("panel", UI.box(SECTION_BG, SECTION_BORDER, 12, 1, Vector4(10, 9, 10, 9)))
	info.add_child(UI.wrapped("Conditions are checked once when an event becomes due. If they pass, chance is rolled once and persisted. No conditions + 100% is the old Always behavior.", 11, Color(1, 1, 1, 0.52)))
	body.add_child(info)
	_empty_label = UI.label("", 12, Color(1, 1, 1, 0.42))
	_empty_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_empty_label.custom_minimum_size.y = 80
	_empty_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	body.add_child(_empty_label)
	_list = VBoxContainer.new()
	_list.add_theme_constant_override("separation", 8)
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body.add_child(_list)
	column.add_child(scroll)
	_suggest = PanelContainer.new()
	_suggest.top_level = true
	_suggest.visible = false
	_suggest.z_index = 10
	_suggest.add_theme_stylebox_override("panel", UI.box(Color8(26, 27, 31, 252), Color(1, 1, 1, 0.14), 9, 1, Vector4(4, 4, 4, 4)))
	_suggest_scroll = ScrollContainer.new()
	_suggest_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_suggest.add_child(_suggest_scroll)
	_suggest_list = VBoxContainer.new()
	_suggest_list.add_theme_constant_override("separation", 0)
	_suggest_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_suggest_scroll.add_child(_suggest_list)
	_manager.add_child(_suggest)
	target.add_child(_manager)
	var fit := func() -> void:
		if not is_instance_valid(panel) or not panel.is_inside_tree():
			return
		var view := panel.get_viewport_rect().size
		var width := minf(1216.0, view.x - 17.6)
		var most := view.y - 24.0
		var least := minf(672.0, most)
		var content := header.get_combined_minimum_size().y + toolbar.get_combined_minimum_size().y + body_margin.get_combined_minimum_size().y
		var height := clampf(content, least, most)
		column.custom_minimum_size = Vector2(width, height)
		panel.custom_minimum_size = Vector2(width, height)
		panel.reset_size()
	_manager.resized.connect(fit)
	body.minimum_size_changed.connect(func() -> void: fit.call_deferred())
	_render_list()
	fit.call()


func close_manager() -> void:
	if _manager and is_instance_valid(_manager):
		_manager.queue_free()
	_manager = null
	_articles.clear()
	_editor_refreshers = []
	_refreshers_by_key.clear()
	_suggest_owner = null


func _unhandled_key_input(event: InputEvent) -> void:
	if not is_manager_open():
		return
	if event is InputEventKey and (event as InputEventKey).pressed and (event as InputEventKey).keycode == KEY_ESCAPE:
		get_viewport().set_input_as_handled()
		close_manager()


func _manager_header() -> Control:
	var margin := MarginContainer.new()
	for side in [["margin_left", 16], ["margin_right", 16], ["margin_top", 14], ["margin_bottom", 14]]:
		margin.add_theme_constant_override(side[0], side[1])
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 13)
	var texts := VBoxContainer.new()
	texts.add_theme_constant_override("separation", 2)
	texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	texts.add_child(UI.label("SCENARIO AUTHORING", 10, Color(1, 1, 1, 0.48), 800, "Arial", 1))
	texts.add_child(UI.label("Scripted Events", 18, UI.WHITE, 850, "Arial", -1))
	_manager_count = UI.label("", 11, Color(1, 1, 1, 0.48))
	texts.add_child(_manager_count)
	row.add_child(texts)
	var close := _button("×", 0.04, BUTTON_INK, 16)
	close.custom_minimum_size = Vector2(38, 32)
	close.tooltip_text = "Close scripted events manager"
	close.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	close.pressed.connect(close_manager)
	row.add_child(close)
	margin.add_child(row)
	var holder := VBoxContainer.new()
	holder.add_theme_constant_override("separation", 0)
	holder.add_child(margin)
	var rule := ColorRect.new()
	rule.color = Color(1, 1, 1, 0.08)
	rule.custom_minimum_size.y = 1
	holder.add_child(rule)
	return holder


func _manager_toolbar() -> Control:
	var margin := MarginContainer.new()
	for side in [["margin_left", 16], ["margin_right", 16], ["margin_top", 11], ["margin_bottom", 11]]:
		margin.add_theme_constant_override(side[0], side[1])
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	_search_edit = EditorKit.line(_query, "Search date or event text...", func(text: String) -> void:
		_query = text
		_render_list())
	_search_edit.size_flags_stretch_ratio = 2.0
	_search_edit.custom_minimum_size.x = 192
	row.add_child(_search_edit)
	_filter_select = EditorKit.select([["all", "All events"], ["unconditional", "No conditions"], ["conditional", "Has conditions"], ["chance", "Chance below 100%"]], _filter_mode, func(value: String) -> void:
		_filter_mode = value
		_render_list())
	_filter_select.size_flags_horizontal = Control.SIZE_FILL
	_filter_select.custom_minimum_size.x = 176
	row.add_child(_filter_select)
	_sort_select = EditorKit.select([["asc", "Date ↑"], ["desc", "Date ↓"]], _sort_direction, func(value: String) -> void:
		_sort_direction = value
		_render_list())
	_sort_select.size_flags_horizontal = Control.SIZE_FILL
	_sort_select.custom_minimum_size.x = 176
	row.add_child(_sort_select)
	var add := _button("+ Add event", 0.09)
	add.custom_minimum_size.y = 42
	add.pressed.connect(_add_event)
	row.add_child(add)
	margin.add_child(row)
	var holder := VBoxContainer.new()
	holder.add_theme_constant_override("separation", 0)
	holder.add_child(margin)
	var rule := ColorRect.new()
	rule.color = Color(1, 1, 1, 0.07)
	rule.custom_minimum_size.y = 1
	holder.add_child(rule)
	return holder


func _add_event() -> void:
	var next := make_event()
	_query = ""
	_filter_mode = "all"
	_sort_direction = "asc"
	if _search_edit:
		_search_edit.text = ""
	if _filter_select:
		_filter_select.select(0)
	if _sort_select:
		_sort_select.select(0)
	var events := _events.duplicate()
	events.append(next)
	_expanded_key = str(next["id"])
	_change(events)


func _duplicate_event(index: int) -> void:
	var next := clone_event(_events[index])
	var events := _events.duplicate()
	events.insert(index + 1, next)
	_expanded_key = str(next["id"])
	_change(events)


func _remove_event(index: int) -> void:
	var key := event_key(_events[index], index)
	var events: Array = []
	for row in range(_events.size()):
		if row != index:
			events.append(_events[row])
	if _expanded_key == key:
		_expanded_key = ""
	_change(events)


func _replace_at(index: int, next: Dictionary) -> void:
	var events := _events.duplicate()
	events[index] = next
	_change(events)


func _patch_event(index: int, patch: Dictionary) -> void:
	var current: Dictionary = (_events[index] as Dictionary).duplicate() if _events[index] is Dictionary else {}
	for key in patch:
		current[key] = patch[key]
	_replace_at(index, current)


func _patch_rules(index: int, patch: Dictionary) -> void:
	var rules := rules_from_trigger((_events[index] as Dictionary).get("trigger") if _events[index] is Dictionary else null)
	var trigger := rules.duplicate()
	for key in patch:
		trigger[key] = patch[key]
	trigger["mode"] = "rules"
	_patch_event(index, {"trigger": trigger})


func _patch_condition(event_index: int, condition_index: int, patch: Dictionary) -> void:
	var rules := rules_from_trigger((_events[event_index] as Dictionary).get("trigger"))
	var conditions := list_of(rules["conditions"]).duplicate()
	var current: Dictionary = (conditions[condition_index] as Dictionary).duplicate() if condition_index < conditions.size() and conditions[condition_index] is Dictionary else {}
	for key in patch:
		current[key] = patch[key]
	conditions[condition_index] = current
	_patch_rules(event_index, {"conditions": conditions})


func _set_condition_type(event_index: int, condition_index: int, type: String) -> void:
	var rules := rules_from_trigger((_events[event_index] as Dictionary).get("trigger"))
	var conditions := list_of(rules["conditions"]).duplicate()
	var current: Dictionary = conditions[condition_index] if condition_index < conditions.size() and conditions[condition_index] is Dictionary else {}
	var definition := definition_of(type) if has_definition(type) else definition_of("polity_exists")
	var next := {"type": type}
	for field in definition["fields"]:
		if field == "status":
			var status := clean(current.get("status"))
			next["status"] = status if not status.is_empty() else "member"
		elif field == "kind":
			next["kind"] = clean(current.get("kind"))
		else:
			next[field] = clean(current.get(field))
	conditions[condition_index] = next
	_patch_rules(event_index, {"conditions": conditions})


func _visible_events() -> Array:
	var dated: Array = []
	for index in range(_events.size()):
		dated.append({"event": _events[index], "index": index, "key": event_key(_events[index], index)})
	dated.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		var a_date := clean((a["event"] as Dictionary).get("date") if a["event"] is Dictionary else null)
		var b_date := clean((b["event"] as Dictionary).get("date") if b["event"] is Dictionary else null)
		var comparison := 0
		if a_date != b_date:
			comparison = -1 if a_date < b_date else 1
		else:
			comparison = int(a["index"]) - int(b["index"])
		return comparison < 0 if _sort_direction != "desc" else comparison > 0)
	var query := clean(_query).to_lower()
	var visible: Array = []
	for item in dated:
		var event: Variant = item["event"]
		var rules := rules_from_trigger((event as Dictionary).get("trigger") if event is Dictionary else null)
		var conditions := list_of(rules["conditions"])
		if _filter_mode == "unconditional" and not conditions.is_empty():
			continue
		if _filter_mode == "conditional" and conditions.is_empty():
			continue
		if _filter_mode == "chance" and EditorFeaturesModel.js_number(rules["percent"]) >= 100.0:
			continue
		if not query.is_empty():
			var record: Dictionary = event if event is Dictionary else {}
			var haystack := ("%s %s %s" % [EditorFeaturesModel.text_of(record.get("date")) if record.get("date") != null else "", EditorFeaturesModel.text_of(record.get("text")) if record.get("text") != null else "", event_rule_summary(event)]).to_lower()
			if not haystack.contains(query):
				continue
		visible.append(item)
	return visible


func _render_list() -> void:
	if not is_manager_open():
		return
	_manager_count.text = "%s · %s" % [_count_text(_events.size(), "event"), _range_text()]
	var visible := _visible_events()
	var keys := {}
	for item in visible:
		keys[str(item["key"])] = item
	var all_keys := {}
	for index in range(_events.size()):
		all_keys[event_key(_events[index], index)] = true
	for key in _articles.keys():
		if not all_keys.has(key):
			var gone: Dictionary = _articles[key]
			(gone["node"] as Control).queue_free()
			_articles.erase(key)
	_empty_label.visible = visible.is_empty()
	_empty_label.text = "No scripted events match this view." if not _events.is_empty() else "No scripted events yet."
	var position := 0
	for item in visible:
		var key := str(item["key"])
		if not _articles.has(key):
			_articles[key] = _make_article(key)
			_list.add_child((_articles[key] as Dictionary)["node"])
		var article: Dictionary = _articles[key]
		var node: Control = article["node"]
		node.visible = true
		_list.move_child(node, position)
		position += 1
		_refresh_article(key, item["event"], int(item["index"]))
	for key in _articles:
		if not keys.has(key):
			((_articles[key] as Dictionary)["node"] as Control).visible = false
	for refresher in _refreshers_by_key.get(_expanded_key, []):
		(refresher as Callable).call()


func _index_of_key(key: String) -> int:
	for index in range(_events.size()):
		if event_key(_events[index], index) == key:
			return index
	return -1


func _make_article(key: String) -> Dictionary:
	var node := PanelContainer.new()
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	node.add_child(column)
	var header := Button.new()
	header.flat = true
	header.focus_mode = Control.FOCUS_NONE
	header.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	header.custom_minimum_size.y = 52
	header.add_theme_stylebox_override("normal", UI.box(Color(0, 0, 0, 0)))
	header.add_theme_stylebox_override("hover", UI.box(Color(1, 1, 1, 0.02)))
	header.add_theme_stylebox_override("pressed", UI.box(Color(1, 1, 1, 0.02)))
	header.add_theme_stylebox_override("focus", UI.box(Color(0, 0, 0, 0)))
	var margin := MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	margin.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for side in [["margin_left", 13], ["margin_right", 13], ["margin_top", 11], ["margin_bottom", 11]]:
		margin.add_theme_constant_override(side[0], side[1])
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var arrow := UI.label("▶", 12, Color(1, 1, 1, 0.46))
	arrow.custom_minimum_size = Vector2(12, 14)
	arrow.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	arrow.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	arrow.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(arrow)
	var texts := VBoxContainer.new()
	texts.add_theme_constant_override("separation", 3)
	texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	texts.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 7)
	line.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var date_label := UI.label("", 11, Color(1, 1, 1, 0.78), 800, MONO)
	line.add_child(date_label)
	var title_label := UI.label("", 13, UI.WHITE, 750)
	title_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	title_label.clip_text = true
	line.add_child(title_label)
	texts.add_child(line)
	var summary := UI.label("", 10, Color(1, 1, 1, 0.42), 800, "Arial", 1)
	texts.add_child(summary)
	row.add_child(texts)
	var action := UI.label("Edit", 11, Color(1, 1, 1, 0.4), 700)
	action.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(action)
	margin.add_child(row)
	header.add_child(margin)
	header.pressed.connect(func() -> void:
		_expanded_key = "" if _expanded_key == key else key
		_render_list())
	column.add_child(header)
	var editor_holder := VBoxContainer.new()
	editor_holder.add_theme_constant_override("separation", 0)
	column.add_child(editor_holder)
	return {"node": node, "header": header, "arrow": arrow, "date": date_label, "title": title_label, "summary": summary, "action": action, "editor": editor_holder, "built": false}


func _refresh_article(key: String, event: Variant, index: int) -> void:
	var article: Dictionary = _articles[key]
	var expanded := _expanded_key == key
	var record: Dictionary = event if event is Dictionary else {}
	var date := clean(record.get("date"))
	(article["date"] as Label).text = date if not date.is_empty() else "No date"
	(article["title"] as Label).text = event_title(event)
	(article["summary"] as Label).text = event_rule_summary(event)
	(article["action"] as Label).text = "Collapse" if expanded else "Edit"
	(article["arrow"] as Label).text = "▼" if expanded else "▶"
	(article["node"] as PanelContainer).add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.045 if expanded else 0.025), Color(1, 1, 1, 0.15 if expanded else 0.075), 13, 1, Vector4(0, 0, 0, 0)))
	var holder: VBoxContainer = article["editor"]
	if expanded and not bool(article["built"]):
		_build_editor(key, holder)
		article["built"] = true
	elif not expanded and bool(article["built"]):
		EditorKit.clear(holder)
		article["built"] = false
		_refreshers_by_key.erase(key)
	holder.visible = expanded


func _rebuild_editor(key: String) -> void:
	if not _articles.has(key):
		return
	var article: Dictionary = _articles[key]
	var holder: VBoxContainer = article["editor"]
	EditorKit.clear(holder)
	_refreshers_by_key.erase(key)
	_hide_suggest()
	_build_editor(key, holder)
	article["built"] = true


func _section(title_text: String, separation := 7) -> Array:
	var holder := PanelContainer.new()
	holder.add_theme_stylebox_override("panel", UI.box(SECTION_BG, SECTION_BORDER, 12, 1, Vector4(10, 10, 10, 10)))
	holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", separation)
	holder.add_child(column)
	if not title_text.is_empty():
		column.add_child(UI.label(title_text.to_upper(), 12, Color(1, 1, 1, 0.66), 800, "Arial", 1))
	return [holder, column]


func _small_label(text: String, size := 11, ink := Color(1, 1, 1, 0.43)) -> Label:
	var node := UI.wrapped(text, size, ink)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


func _number_edit(value: float, width: float, on_text: Callable, align_right := false) -> LineEdit:
	var edit := EditorKit.line(EditorFeaturesModel.number_text(value), "", Callable())
	edit.custom_minimum_size.x = width
	edit.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	if align_right:
		edit.alignment = HORIZONTAL_ALIGNMENT_RIGHT
	edit.text_changed.connect(func(text: String) -> void:
		if not valid_number_text(text):
			return
		on_text.call(text, edit))
	return edit


func _sync_number(edit: LineEdit, value: float) -> void:
	if edit.text.strip_edges().is_empty():
		if value == 0.0:
			_set_text(edit, "0")
			return
		_set_text(edit, EditorFeaturesModel.number_text(value))
		return
	var typed := EditorFeaturesModel.js_number(edit.text)
	if typed != value:
		_set_text(edit, EditorFeaturesModel.number_text(value))


func _set_text(edit: LineEdit, text: String) -> void:
	if edit.text == text:
		return
	edit.text = text
	edit.caret_column = text.length()


func _event_of(key: String) -> Dictionary:
	var index := _index_of_key(key)
	return _events[index] if index >= 0 and _events[index] is Dictionary else {}


func _build_editor(key: String, holder: VBoxContainer) -> void:
	var index := _index_of_key(key)
	if index < 0:
		return
	_editor_refreshers = []
	_refreshers_by_key[key] = _editor_refreshers
	var event: Dictionary = _events[index] if _events[index] is Dictionary else {}
	var rule := ColorRect.new()
	rule.color = Color(1, 1, 1, 0.08)
	rule.custom_minimum_size.y = 1
	holder.add_child(rule)
	var margin := MarginContainer.new()
	for side in ["margin_left", "margin_right", "margin_top", "margin_bottom"]:
		margin.add_theme_constant_override(side, 13)
	holder.add_child(margin)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 10)
	margin.add_child(column)

	var top := HBoxContainer.new()
	top.add_theme_constant_override("separation", 7)
	var date_column := VBoxContainer.new()
	date_column.add_theme_constant_override("separation", 7)
	date_column.custom_minimum_size.x = 240
	date_column.add_child(EditorKit.field_label("Date"))
	var date_edit := EditorKit.line(EditorFeaturesModel.text_of(event.get("date")) if event.get("date") != null else "", "YYYY-MM-DD", func(text: String) -> void:
		var at := _index_of_key(key)
		if at >= 0:
			_patch_event(at, {"date": text}))
	date_edit.tooltip_text = "Event date"
	date_column.add_child(date_edit)
	top.add_child(date_column)
	top.add_child(UI.spacer())
	var duplicate := _button("Duplicate")
	duplicate.size_flags_vertical = Control.SIZE_SHRINK_END
	duplicate.pressed.connect(func() -> void:
		var at := _index_of_key(key)
		if at >= 0:
			_duplicate_event(at))
	top.add_child(duplicate)
	var remove := _button("Remove", 0.06, ROSE_INK)
	remove.size_flags_vertical = Control.SIZE_SHRINK_END
	remove.pressed.connect(func() -> void:
		var at := _index_of_key(key)
		if at >= 0:
			_remove_event(at))
	top.add_child(remove)
	column.add_child(top)

	var text_column := VBoxContainer.new()
	text_column.add_theme_constant_override("separation", 7)
	text_column.add_child(EditorKit.field_label("Event instruction"))
	var text_edit := EditorKit.area(EditorFeaturesModel.text_of(event.get("text")) if event.get("text") != null else "", 88.0, func(text: String) -> void:
		var at := _index_of_key(key)
		if at >= 0:
			_patch_event(at, {"text": text.substr(0, 4000)}), "What happens on this date?")
	text_edit.tooltip_text = "Scripted event text"
	text_column.add_child(text_edit)
	column.add_child(text_column)

	column.add_child(_wording_section(key, event))
	column.add_child(_conditions_section(key, index, event))
	column.add_child(_outcomes_section(key, event))
	column.add_child(_chance_section(key, event))


func _wording_section(key: String, event: Dictionary) -> Control:
	var parts := _section("Event wording")
	var body: VBoxContainer = parts[1]
	var select := EditorKit.select([["generated", "Let the AI write it"], ["exact", "Use my exact wording"]], text_mode_of(event), func(value: String) -> void:
		var at := _index_of_key(key)
		if at >= 0:
			_patch_event(at, {"textMode": value})
			_rebuild_editor(key))
	select.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	select.custom_minimum_size.x = 384
	select.tooltip_text = "Event wording mode"
	body.add_child(select)
	var help := "The timeline body uses these exact words. The AI can still supply canonical consequences such as Political World, map, institution, unit or Stats changes." if text_mode_of(event) == "exact" else "This text tells the simulation what must happen. The AI writes the final timeline event in the campaign's context."
	body.add_child(_small_label(help, 11))
	return parts[0]


func _conditions_section(key: String, index: int, event: Dictionary) -> Control:
	var rules := rules_from_trigger(event.get("trigger"))
	var conditions := list_of(rules["conditions"])
	var required_raw := EditorFeaturesModel.js_number(rules["requiredCount"])
	var required_count := 0.0
	if not conditions.is_empty():
		required_count = maxf(1.0, minf(float(conditions.size()), EditorFeaturesModel.js_trunc(required_raw) if EditorFeaturesModel.is_finite_number(required_raw) else 1.0))
	var condition_mode := str(rules["operator"]) if not conditions.is_empty() else "none"
	var parts := _section("", 8)
	var body: VBoxContainer = parts[1]
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 7)
	var title := UI.label("CONDITIONS", 12, Color(1, 1, 1, 0.64), 800, "Arial", 1)
	title.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	head.add_child(title)
	var mode_select := EditorKit.select([["none", "No conditions"], ["all", "All conditions"], ["any", "Any condition"], ["at_least", "At least"]], condition_mode, func(mode: String) -> void:
		var at := _index_of_key(key)
		if at < 0:
			return
		var current_rules := rules_from_trigger((_events[at] as Dictionary).get("trigger"))
		var current_conditions := list_of(current_rules["conditions"])
		if mode == "none":
			_patch_rules(at, {"operator": "all", "requiredCount": 0.0, "conditions": []})
		else:
			_patch_rules(at, {"operator": mode, "requiredCount": 1.0 if mode == "at_least" else current_rules["requiredCount"], "conditions": current_conditions if not current_conditions.is_empty() else [make_condition()]})
		_rebuild_editor(key))
	mode_select.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	mode_select.custom_minimum_size.x = 176
	mode_select.tooltip_text = "Condition match rule"
	head.add_child(mode_select)
	if condition_mode == "at_least" and not conditions.is_empty():
		var count_edit := _number_edit(required_count, 72.0, func(text: String, count_edit: LineEdit) -> void:
			var at := _index_of_key(key)
			if at < 0:
				return
			var count := list_of(rules_from_trigger((_events[at] as Dictionary).get("trigger"))["conditions"]).size()
			var typed := EditorFeaturesModel.js_number(text)
			var next := maxf(1.0, minf(float(count), typed if EditorFeaturesModel.is_finite_number(typed) and typed != 0.0 else 1.0))
			_patch_rules(at, {"requiredCount": next})
			_sync_number(count_edit, next))
		count_edit.tooltip_text = "Required condition count"
		head.add_child(count_edit)
		var of_label := UI.label("of %d" % conditions.size(), 12, Color(1, 1, 1, 0.5))
		of_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		head.add_child(of_label)
	if condition_mode != "none":
		var add := _button("+ Add condition")
		add.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		add.pressed.connect(func() -> void:
			var at := _index_of_key(key)
			if at < 0:
				return
			var current := list_of(rules_from_trigger((_events[at] as Dictionary).get("trigger"))["conditions"]).duplicate()
			current.append(make_condition())
			_patch_rules(at, {"conditions": current})
			_rebuild_editor(key))
		head.add_child(add)
	body.add_child(head)
	body.add_child(_small_label("Conditions are checked once when this date is reached. If they do not match, this event is skipped permanently rather than waiting for them to become true later.", 12))
	if condition_mode == "none":
		body.add_child(_small_label("No conditions - this event becomes eligible as soon as its date is reached. Chance is still rolled once below.", 12))
	else:
		var rows := VBoxContainer.new()
		rows.add_theme_constant_override("separation", 7)
		for condition_index in range(conditions.size()):
			rows.add_child(_condition_row(key, index, condition_index, conditions[condition_index]))
		body.add_child(rows)
	return parts[0]


func _condition_row(key: String, event_index: int, condition_index: int, condition_input: Variant) -> Control:
	var condition: Dictionary = condition_input if condition_input is Dictionary else {}
	var type := clean(condition.get("type"))
	if type.is_empty():
		type = "polity_exists"
	var definition := definition_of(type) if has_definition(type) else definition_of("polity_exists")
	var fields: Array = definition["fields"]
	var holder := PanelContainer.new()
	holder.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0.14), Color(1, 1, 1, 0.055), 9, 1, Vector4(8, 8, 8, 8)))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	holder.add_child(row)
	var type_options: Array = []
	for entry in CONDITION_DEFINITIONS:
		type_options.append([str((entry as Dictionary)["type"]), str((entry as Dictionary)["label"])])
	var type_select := EditorKit.select(type_options, str(definition["type"]), func(value: String) -> void:
		var at := _index_of_key(key)
		if at >= 0:
			_set_condition_type(at, condition_index, value)
			_rebuild_editor(key))
	type_select.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	type_select.size_flags_stretch_ratio = 1.2
	type_select.custom_minimum_size.x = 150
	type_select.tooltip_text = "Condition type"
	row.add_child(type_select)
	var polities: Array = _options.get("polities", [])
	var institutions: Array = _options.get("institutions", [])
	var subordinate := str(definition["type"]).contains("subordinate")
	if fields.has("institutionId"):
		row.add_child(_entity_field(key, condition_index, "institutionId", institutions, "Search institution", "Institution"))
	if fields.has("polityId"):
		row.add_child(_entity_field(key, condition_index, "polityId", polities, "Search subordinate polity" if subordinate else "Search polity", "Subordinate polity" if subordinate else "Polity"))
	if fields.has("overlordId"):
		row.add_child(_entity_field(key, condition_index, "overlordId", polities, "Search overlord", "Overlord polity"))
	if fields.has("regionId"):
		var region := EditorKit.line(clean(condition.get("regionId")) if condition.get("regionId") != null else "", "Stable region ID", func(text: String) -> void:
			var at := _index_of_key(key)
			if at >= 0:
				_patch_condition(at, condition_index, {"regionId": text}))
		region.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
		region.custom_minimum_size.x = 120
		region.tooltip_text = "Region id"
		row.add_child(region)
	if fields.has("baseOwner"):
		row.add_child(_entity_field(key, condition_index, "baseOwner", polities, "Base owner", "Base region owner"))
	if fields.has("eventId"):
		row.add_child(_event_reference(key, event_index, condition_index, condition))
	if fields.has("outcomeId"):
		row.add_child(_outcome_reference(key, condition_index, condition))
	if fields.has("status"):
		var statuses: Array = []
		for entry in _options.get("memberStatuses", []):
			statuses.append([str((entry as Dictionary)["value"]), str((entry as Dictionary)["label"])])
		var status := clean(condition.get("status"))
		var status_select := EditorKit.select(statuses, status if not status.is_empty() else "member", func(value: String) -> void:
			var at := _index_of_key(key)
			if at >= 0:
				_patch_condition(at, condition_index, {"status": value}))
		status_select.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
		status_select.size_flags_stretch_ratio = 0.8
		status_select.custom_minimum_size.x = 110
		status_select.tooltip_text = "Institution membership status"
		row.add_child(status_select)
	if fields.has("kind"):
		var kinds: Array = [["", "Any relationship"]]
		for entry in _options.get("puppetKinds", []):
			kinds.append([str((entry as Dictionary)["value"]), str((entry as Dictionary)["label"])])
		var kind_select := EditorKit.select(kinds, clean(condition.get("kind")), func(value: String) -> void:
			var at := _index_of_key(key)
			if at >= 0:
				_patch_condition(at, condition_index, {"kind": value}))
		kind_select.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
		kind_select.size_flags_stretch_ratio = 0.8
		kind_select.custom_minimum_size.x = 110
		kind_select.tooltip_text = "Subordination kind"
		row.add_child(kind_select)
	var remove := _button("Remove", 0.06, ROSE_INK)
	remove.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	remove.custom_minimum_size.y = 42
	remove.pressed.connect(func() -> void:
		var at := _index_of_key(key)
		if at < 0:
			return
		var current := list_of(rules_from_trigger((_events[at] as Dictionary).get("trigger"))["conditions"])
		var kept: Array = []
		for row_index in range(current.size()):
			if row_index != condition_index:
				kept.append(current[row_index])
		_patch_rules(at, {"conditions": kept})
		_rebuild_editor(key))
	row.add_child(remove)
	return holder


func _entity_field(key: String, condition_index: int, field: String, options: Array, placeholder: String, aria: String) -> Control:
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 3)
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.custom_minimum_size.x = 120
	var condition := _condition_at(key, condition_index)
	var value := str(condition.get(field, "")) if condition.get(field) != null else ""
	var edit := EditorKit.line(picker_label(value, options), placeholder, Callable())
	edit.tooltip_text = ENTITY_TIP
	edit.set("accessibility_name", aria)
	column.add_child(edit)
	var warning := UI.wrapped("", 10, Color(251 / 255.0, 191 / 255.0, 36 / 255.0, 0.78))
	column.add_child(warning)
	var refresh := func() -> void:
		if not is_instance_valid(warning):
			return
		var current := _condition_at(key, condition_index)
		var stored := str(current.get(field, "")) if current.get(field) != null else ""
		var unresolved := not clean(stored).is_empty() and not options.any(func(option: Variant) -> bool: return str((option as Dictionary).get("id", "")) == stored)
		warning.visible = unresolved
		warning.text = "Custom/unresolved canonical ID: %s" % stored
	refresh.call()
	_editor_refreshers.append(refresh)
	edit.text_changed.connect(func(text: String) -> void:
		var at := _index_of_key(key)
		if at < 0:
			return
		var stored := picker_value(text, options)
		_patch_condition(at, condition_index, {field: stored})
		var shown := picker_label(stored, options)
		if edit.text != shown:
			edit.text = shown
			edit.caret_column = shown.length()
		_show_suggest(edit, options, field, key, condition_index))
	edit.focus_entered.connect(func() -> void: _show_suggest(edit, options, field, key, condition_index))
	var owner_id := edit.get_instance_id()
	edit.focus_exited.connect(func() -> void:
		get_tree().create_timer(0.15).timeout.connect(func() -> void:
			if _suggest_owner != null and is_instance_valid(_suggest_owner) and _suggest_owner.get_instance_id() == owner_id:
				_hide_suggest()))
	return column


func _condition_at(key: String, condition_index: int) -> Dictionary:
	var event := _event_of(key)
	var conditions := list_of(rules_from_trigger(event.get("trigger"))["conditions"])
	return conditions[condition_index] if condition_index < conditions.size() and conditions[condition_index] is Dictionary else {}


func _show_suggest(edit: LineEdit, options: Array, field: String, key: String, condition_index: int) -> void:
	if not _suggest or not is_instance_valid(_suggest) or not is_instance_valid(edit):
		return
	_suggest_owner = edit
	EditorKit.clear(_suggest_list)
	var typed := edit.text.strip_edges().to_lower()
	var shown := 0
	for option in options:
		var label := str((option as Dictionary).get("label", ""))
		var option_id := str((option as Dictionary).get("id", ""))
		if not typed.is_empty() and not label.to_lower().contains(typed) and not option_id.to_lower().contains(typed):
			continue
		if not typed.is_empty() and label.to_lower() == typed:
			continue
		var pick := Button.new()
		pick.focus_mode = Control.FOCUS_NONE
		pick.flat = true
		pick.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		pick.custom_minimum_size.y = 28
		pick.tooltip_text = option_id
		var line := HBoxContainer.new()
		line.add_theme_constant_override("separation", 10)
		line.mouse_filter = Control.MOUSE_FILTER_IGNORE
		line.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		line.offset_left = 8
		line.offset_right = -8
		var name_label := UI.label(label, 13, Color(1, 1, 1, 0.86), 500)
		name_label.clip_text = true
		name_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		name_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		name_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
		line.add_child(name_label)
		if option_id != label:
			var id_label := UI.label(option_id, 11, Color(1, 1, 1, 0.42))
			id_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			id_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
			line.add_child(id_label)
		pick.add_child(line)
		pick.add_theme_stylebox_override("hover", UI.box(Color(1, 1, 1, 0.08), Color(0, 0, 0, 0), 6, 1, Vector4(8, 0, 8, 0)))
		pick.add_theme_stylebox_override("normal", UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 6, 1, Vector4(8, 0, 8, 0)))
		pick.add_theme_stylebox_override("pressed", UI.box(Color(1, 1, 1, 0.12), Color(0, 0, 0, 0), 6, 1, Vector4(8, 0, 8, 0)))
		pick.pressed.connect(func() -> void:
			var at := _index_of_key(key)
			if at < 0:
				return
			var stored := picker_value(label, options)
			_patch_condition(at, condition_index, {field: stored})
			if is_instance_valid(edit):
				edit.text = picker_label(stored, options)
				edit.caret_column = edit.text.length()
			_hide_suggest())
		_suggest_list.add_child(pick)
		shown += 1
	if shown == 0:
		_hide_suggest()
		return
	var rect := edit.get_global_rect()
	_suggest_scroll.custom_minimum_size = Vector2(0, minf(float(shown), 8.0) * 28.0)
	_suggest_scroll.scroll_vertical = 0
	_suggest.custom_minimum_size = Vector2(rect.size.x, 0)
	_suggest.size = Vector2(rect.size.x, 0)
	_suggest.global_position = rect.position + Vector2(0, rect.size.y + 2)
	_suggest.visible = true
	_suggest.reset_size()
	var tall := _suggest.get_combined_minimum_size().y
	if rect.end.y + 2.0 + tall > edit.get_viewport_rect().size.y and rect.position.y - 2.0 - tall >= 0.0:
		_suggest.global_position = rect.position - Vector2(0, tall + 2.0)


func _hide_suggest() -> void:
	if _suggest and is_instance_valid(_suggest):
		_suggest.visible = false
	_suggest_owner = null


func _event_reference(key: String, event_index: int, condition_index: int, condition: Dictionary) -> Control:
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 3)
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.custom_minimum_size.x = 160
	var select := EditorKit.select([], "", Callable())
	select.tooltip_text = "Referenced scripted event"
	column.add_child(select)
	var warning := UI.wrapped("This dependency points to an event that has not resolved yet. Choose an earlier event or this condition will fail when checked.", 10, AMBER)
	column.add_child(warning)
	var fill := func() -> void:
		if not is_instance_valid(select) or select.get_popup().visible:
			return
		var at := _index_of_key(key)
		if at < 0:
			return
		var current := _condition_at(key, condition_index)
		var wanted := str(current.get("eventId", "")) if current.get("eventId") != null else ""
		var prior := prior_events(_events, at)
		var referenced: Variant = null
		for candidate in _events:
			if candidate is Dictionary and str((candidate as Dictionary).get("id", "")) == wanted and not wanted.is_empty():
				referenced = candidate
				break
		var future := false
		if referenced != null:
			future = not prior.any(func(item: Variant) -> bool: return str(((item as Dictionary)["event"] as Dictionary).get("id", "")) == str((referenced as Dictionary)["id"]))
		var items: Array = [["", "Select earlier event"]]
		if future:
			items.append([str((referenced as Dictionary)["id"]), "⚠ %s (not earlier)" % event_title(referenced)])
		for item in prior:
			var candidate: Dictionary = (item as Dictionary)["event"]
			items.append([str(candidate.get("id", "")), event_title(candidate)])
		var signature := JSON.stringify(items) + "|" + wanted
		if select.get_meta("signature", "") == signature:
			warning.visible = future
			return
		select.set_meta("signature", signature)
		select.clear()
		var chosen := 0
		for entry in items:
			select.add_item(str(entry[1]))
			select.set_item_metadata(select.item_count - 1, str(entry[0]))
			if str(entry[0]) == wanted:
				chosen = select.item_count - 1
		select.select(chosen)
		warning.visible = future
	fill.call()
	_editor_refreshers.append(fill)
	select.item_selected.connect(func(item: int) -> void:
		var at := _index_of_key(key)
		if at >= 0:
			_patch_condition(at, condition_index, {"eventId": str(select.get_item_metadata(item)), "outcomeId": ""})
			_rebuild_editor(key))
	return column


func _outcome_reference(key: String, condition_index: int, condition: Dictionary) -> Control:
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 3)
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.custom_minimum_size.x = 160
	var current_event := str(condition.get("eventId", "")) if condition.get("eventId") != null else ""
	var referenced: Dictionary = {}
	for candidate in _events:
		if candidate is Dictionary and str((candidate as Dictionary).get("id", "")) == current_event:
			referenced = candidate
			break
	var outcomes := list_of(referenced.get("outcomes"))
	var wanted := str(condition.get("outcomeId", "")) if condition.get("outcomeId") != null else ""
	var missing := not clean(wanted).is_empty() and not outcomes.any(func(outcome: Variant) -> bool: return outcome is Dictionary and str((outcome as Dictionary).get("id", "")) == wanted)
	var items: Array = []
	if missing:
		items.append([wanted, "⚠ Missing outcome: %s" % wanted])
	for outcome in outcomes:
		if not (outcome is Dictionary):
			continue
		var record: Dictionary = outcome
		var label := clean(record.get("title")) if not clean(record.get("title")).is_empty() else (clean(record.get("text")) if not clean(record.get("text")).is_empty() else clean(record.get("id")))
		items.append([str(record.get("id", "")), label])
	var select := EditorKit.select(items, wanted, func(value: String) -> void:
		var at := _index_of_key(key)
		if at >= 0:
			_patch_condition(at, condition_index, {"outcomeId": value})
			_rebuild_editor(key), "Select outcome")
	select.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	select.tooltip_text = "Referenced scripted outcome"
	column.add_child(select)
	if missing:
		column.add_child(UI.wrapped("The referenced outcome no longer exists. Pick another outcome before saving.", 10, AMBER))
	return column


func _outcomes_section(key: String, event: Dictionary) -> Control:
	var parts := _section("", 9)
	var body: VBoxContainer = parts[1]
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 8)
	var texts := VBoxContainer.new()
	texts.add_theme_constant_override("separation", 3)
	texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	texts.add_child(UI.label("POSSIBLE OUTCOMES - CHOOSE ONE", 12, Color(1, 1, 1, 0.66), 800))
	var help := UI.rich("", 11, Color(1, 1, 1, 0.42))
	help.text = "Optional. If this event fires, the game picks exactly one outcome and remembers it permanently. Outcomes inherit the event wording mode above. [b]Weight is relative, not a percentage:[/b] 3 / 1 / 1 means 60% / 20% / 20%."
	help.custom_minimum_size.x = 300
	texts.add_child(help)
	head.add_child(texts)
	var add := _button("+ Add outcome")
	add.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	add.pressed.connect(func() -> void:
		var at := _index_of_key(key)
		if at < 0:
			return
		var outcomes := list_of((_events[at] as Dictionary).get("outcomes")).duplicate()
		outcomes.append(make_outcome())
		_patch_event(at, {"outcomes": outcomes})
		_rebuild_editor(key))
	head.add_child(add)
	body.add_child(head)
	var outcomes := list_of(event.get("outcomes"))
	if outcomes.is_empty():
		return parts[0]
	var zero_warning := UI.wrapped("At least one outcome needs a weight above 0. If every weight is 0, this event will be skipped.", 10, AMBER)
	body.add_child(zero_warning)
	_editor_refreshers.append(func() -> void:
		if not is_instance_valid(zero_warning):
			return
		var current := list_of(_event_of(key).get("outcomes"))
		zero_warning.visible = not current.is_empty() and not current.any(func(outcome: Variant) -> bool: return weight_of(outcome) > 0.0))
	for outcome_index in range(outcomes.size()):
		body.add_child(_outcome_card(key, outcome_index, outcomes[outcome_index]))
	return parts[0]


func _outcome_rows(key: String) -> Array:
	return list_of(_event_of(key).get("outcomes")).duplicate()


func _patch_outcome(key: String, outcome_index: int, field: String, value: Variant) -> void:
	var at := _index_of_key(key)
	if at < 0:
		return
	var rows := _outcome_rows(key)
	if outcome_index >= rows.size():
		return
	var record: Dictionary = (rows[outcome_index] as Dictionary).duplicate() if rows[outcome_index] is Dictionary else {}
	record[field] = value
	rows[outcome_index] = record
	_patch_event(at, {"outcomes": rows})


func _two_labels(main: String, extra: String) -> HBoxContainer:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 5)
	row.add_child(UI.label(main.to_upper(), 12, EditorKit.LABEL_INK, 600, "Arial", 1))
	var tail := UI.label(extra.to_upper(), 12, Color(1, 1, 1, 0.35), 500, "Arial", 1)
	row.add_child(tail)
	return row


func _outcome_card(key: String, outcome_index: int, outcome_input: Variant) -> Control:
	var outcome: Dictionary = outcome_input if outcome_input is Dictionary else {}
	var holder := PanelContainer.new()
	holder.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0), Color(1, 1, 1, 0.06), 9, 1, Vector4(9, 9, 9, 9)))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 7)
	holder.add_child(column)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 7)
	var id_column := VBoxContainer.new()
	id_column.add_theme_constant_override("separation", 7)
	id_column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	id_column.add_child(_two_labels("Outcome ID", "(advanced)"))
	var id_edit := EditorKit.line(str(outcome.get("id", "")) if outcome.get("id") != null else "", "outcome-id", func(text: String) -> void: _patch_outcome(key, outcome_index, "id", text))
	id_edit.tooltip_text = "Outcome id"
	id_column.add_child(id_edit)
	row.add_child(id_column)
	var weight_column := VBoxContainer.new()
	weight_column.add_theme_constant_override("separation", 7)
	weight_column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	weight_column.size_flags_stretch_ratio = 0.45
	var weight_head := HBoxContainer.new()
	weight_head.add_theme_constant_override("separation", 5)
	weight_head.add_child(UI.label("WEIGHT", 12, EditorKit.LABEL_INK, 600, "Arial", 1))
	var chance := UI.label("", 12, Color(1, 1, 1, 0.35), 500, "Arial", 1)
	weight_head.add_child(chance)
	weight_column.add_child(weight_head)
	var weight_value: Variant = outcome.get("weight") if outcome.has("weight") and outcome.get("weight") != null else 1.0
	var weight_edit := _number_edit(EditorFeaturesModel.js_number(weight_value), 112.0, func(text: String, weight_edit: LineEdit) -> void:
		var number := EditorFeaturesModel.js_number(text)
		_patch_outcome(key, outcome_index, "weight", number)
		_sync_number(weight_edit, number))
	weight_edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	weight_edit.tooltip_text = "Relative chance compared with the other outcomes. 0 means this outcome can never be selected."
	weight_column.add_child(weight_edit)
	row.add_child(weight_column)
	var remove := _button("Remove", 0.06, ROSE_INK)
	remove.size_flags_vertical = Control.SIZE_SHRINK_END
	remove.custom_minimum_size.y = 42
	remove.pressed.connect(func() -> void:
		var at := _index_of_key(key)
		if at < 0:
			return
		var rows := _outcome_rows(key)
		var kept: Array = []
		for row_index in range(rows.size()):
			if row_index != outcome_index:
				kept.append(rows[row_index])
		_patch_event(at, {"outcomes": kept})
		_rebuild_editor(key))
	row.add_child(remove)
	column.add_child(row)
	var text_column := VBoxContainer.new()
	text_column.add_theme_constant_override("separation", 7)
	text_column.add_child(EditorKit.field_label("What happens"))
	var text_edit := EditorKit.area(str(outcome.get("text", "")) if outcome.get("text") != null else "", 72.0, func(text: String) -> void: _patch_outcome(key, outcome_index, "text", text), "What happens if this outcome is selected?")
	text_edit.tooltip_text = "Outcome text"
	text_column.add_child(text_edit)
	column.add_child(text_column)
	var missing := UI.wrapped("Add outcome text before saving. Blank outcomes are discarded.", 10, AMBER)
	column.add_child(missing)
	var refresh := func() -> void:
		if not is_instance_valid(chance):
			return
		var rows := list_of(_event_of(key).get("outcomes"))
		chance.text = "(%s CHANCE)" % outcome_chance_text(rows, outcome_index).to_upper()
		var current: Dictionary = rows[outcome_index] if outcome_index < rows.size() and rows[outcome_index] is Dictionary else {}
		missing.visible = clean(current.get("text")).is_empty()
	refresh.call()
	_editor_refreshers.append(refresh)
	return holder


func _chance_section(key: String, event: Dictionary) -> Control:
	var rules := rules_from_trigger(event.get("trigger"))
	var parts := _section("", 10)
	var body: VBoxContainer = parts[1]
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 8)
	var texts := VBoxContainer.new()
	texts.add_theme_constant_override("separation", 3)
	texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	texts.add_child(UI.label("CHANCE AFTER CONDITIONS PASS", 12, Color(1, 1, 1, 0.66), 800, "Arial", 1))
	texts.add_child(UI.label("Rolled once when due, then persisted. No save/reload rerolls.", 11, Color(1, 1, 1, 0.42)))
	head.add_child(texts)
	var slider := HSlider.new()
	var percent_edit := _number_edit(EditorFeaturesModel.js_number(rules["percent"]), 88.0, func(text: String, percent_edit: LineEdit) -> void:
		var at := _index_of_key(key)
		if at < 0:
			return
		var typed := EditorFeaturesModel.js_number(text)
		var next := clampf(typed if EditorFeaturesModel.is_finite_number(typed) else 0.0, 0.0, 100.0)
		_patch_rules(at, {"percent": next})
		_sync_number(percent_edit, next)
		slider.set_value_no_signal(next), true)
	percent_edit.tooltip_text = "Event chance percent"
	percent_edit.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	head.add_child(percent_edit)
	var sign := UI.label("%", 12, Color(1, 1, 1, 0.55))
	sign.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	head.add_child(sign)
	body.add_child(head)
	slider.min_value = 0
	slider.max_value = 100
	slider.step = 1
	slider.value = EditorFeaturesModel.js_number(rules["percent"])
	slider.focus_mode = Control.FOCUS_NONE
	slider.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	slider.tooltip_text = "Event chance slider"
	slider.add_theme_stylebox_override("slider", UI.box(Color(1, 1, 1, 0.16), Color(0, 0, 0, 0), 4, 1, Vector4(0, 2, 0, 2)))
	slider.add_theme_stylebox_override("grabber_area", UI.box(Color("#a1a1aa"), Color(0, 0, 0, 0), 4, 1, Vector4(0, 2, 0, 2)))
	slider.add_theme_stylebox_override("grabber_area_highlight", UI.box(Color("#a1a1aa"), Color(0, 0, 0, 0), 4, 1, Vector4(0, 2, 0, 2)))
	slider.value_changed.connect(func(value: float) -> void:
		var at := _index_of_key(key)
		if at < 0:
			return
		_patch_rules(at, {"percent": value})
		if is_instance_valid(percent_edit):
			_set_text(percent_edit, EditorFeaturesModel.number_text(value)))
	body.add_child(slider)
	return parts[0]
