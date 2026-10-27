class_name EditorFrontsPanel
extends VBoxContainer

signal details_changed(details: Dictionary)
signal value_changed(value: Variant)

var engine: EngineLink
var _props := {}
var _details := {}
var _scenario_id := ""
var _saved: Array = []
var _draft: Array = []
var _countries: Array = []
var _busy := false
var _message := ""
var _error := ""
var _countries_token := 0
var _countries_loaded := false
var _count_label: Label
var _add_button: Button
var _empty_hint: Control
var _few_hint: Control
var _fronts_box: VBoxContainer
var _error_holder: VBoxContainer
var _error_label: Label
var _message_holder: VBoxContainer
var _message_label: Label
var _save_button: Button
var _discard_button: Button


func setup(engine_link: EngineLink, props: Dictionary) -> void:
	engine = engine_link
	_props = props.duplicate()
	add_theme_constant_override("separation", 0)
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_adopt_details(props.get("details", {}) if props.get("details") is Dictionary else {}, true)
	_build()
	_render_fronts()
	_load_countries()


func update_props(props: Dictionary) -> void:
	for key in props:
		_props[key] = props[key]
	if props.has("details") and props["details"] is Dictionary and not is_same(props["details"], _details):
		var previous := _scenario_id
		_adopt_details(props["details"], false)
		if _scenario_id != previous:
			_draft = _saved.duplicate(true)
			_message = ""
			_error = ""
		if _fronts_box:
			_render_fronts()
			_load_countries()


func _adopt_details(details: Dictionary, reset: bool) -> void:
	_details = details
	var scenario: Variant = details.get("scenario")
	_scenario_id = str((scenario as Dictionary).get("id", "")) if scenario is Dictionary else ""
	var data: Variant = details.get("data")
	var world: Variant = (data as Dictionary).get("world") if data is Dictionary else null
	_saved = EditorWarRules.normalize_scenario_fronts((world as Dictionary).get("scenarioFronts") if world is Dictionary else null, true)
	if reset:
		_draft = _saved.duplicate(true)


func _load_countries() -> void:
	if _scenario_id.is_empty():
		return
	_countries_token += 1
	var token := _countries_token
	var reply := await engine.request("editor.war.fronts", {"scenarioId": _scenario_id})
	if token != _countries_token or not is_inside_tree():
		return
	if reply.get("ok", false):
		_countries = reply["result"].get("countries", [])
		_countries_loaded = true
		_render_fronts()


func _build() -> void:
	var parts := EditorWarKit.card()
	add_child(parts[0])
	add_child(EditorWarKit.gap(15))
	var column: VBoxContainer = parts[1]
	column.add_child(EditorWarKit.title("Fronts"))
	column.add_child(EditorWarKit.gap(3))
	column.add_child(EditorWarKit.hint("The fronts this scenario begins with. A new game opens with their troops already standing along the line, and its war room ready, without asking your AI for anything."))
	column.add_child(EditorWarKit.gap(3))
	column.add_child(EditorWarKit.hint("You do not draw the line: it runs where the two sides’ land meets on your map. Paint the land each side holds in the map editor, then name the sides here."))
	column.add_child(EditorWarKit.gap(13))
	var header := HBoxContainer.new()
	header.add_theme_constant_override("separation", 8)
	_count_label = EditorWarKit.section_title("")
	_count_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_count_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	header.add_child(_count_label)
	_add_button = EditorWarKit.button("+ Add a front", "soft", 999)
	_add_button.pressed.connect(func() -> void:
		if _draft.size() >= EditorWarRules.MAX_SCENARIO_FRONTS:
			return
		_draft.append(EditorWarRules.blank_front())
		_render_fronts())
	header.add_child(_add_button)
	column.add_child(header)
	_empty_hint = _spaced(EditorWarKit.hint("No fronts yet. Without any, a battlefield still opens by itself wherever a war’s two sides hold land that touches, at the first time skip."), 8)
	column.add_child(_empty_hint)
	_few_hint = _spaced(EditorWarKit.hint("This scenario’s map has fewer than two countries holding land. Save a map with the countries on it first.", EditorWarKit.WARN), 7)
	column.add_child(_few_hint)
	_fronts_box = VBoxContainer.new()
	_fronts_box.add_theme_constant_override("separation", 0)
	_fronts_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.add_child(_fronts_box)
	column.add_child(EditorWarKit.gap(11))
	column.add_child(EditorWarKit.hint("Leave Formations empty and the game counts them by each side’s size and the length of the line. Generals are named in the order of their commands, from the north or the west; leave it empty and the player’s generals introduce themselves."))
	_error_label = UI.wrapped("", 12, EditorWarKit.ALERT)
	_error_holder = _spaced(_error_label, 8)
	column.add_child(_error_holder)
	_message_label = UI.wrapped("", 12, EditorWarKit.GOOD)
	_message_holder = _spaced(_message_label, 8)
	column.add_child(_message_holder)
	column.add_child(EditorWarKit.gap(11))
	var actions := HBoxContainer.new()
	actions.add_theme_constant_override("separation", 7)
	_save_button = EditorWarKit.button("Save fronts", "primary", 999)
	_save_button.pressed.connect(_save)
	actions.add_child(_save_button)
	_discard_button = EditorWarKit.button("Discard changes", "soft", 999)
	_discard_button.pressed.connect(func() -> void:
		_draft = _saved.duplicate(true)
		_message = ""
		_error = ""
		_render_fronts())
	actions.add_child(_discard_button)
	column.add_child(actions)


func _spaced(control: Control, top: float) -> VBoxContainer:
	var holder := VBoxContainer.new()
	holder.add_theme_constant_override("separation", 0)
	holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	holder.add_child(EditorWarKit.gap(top))
	holder.add_child(control)
	return holder


func _changed() -> bool:
	return not EditorWarRules.same_json(EditorWarRules.normalize_scenario_fronts(_draft, true), EditorWarRules.normalize_scenario_fronts(_saved, true))


func _unfinished() -> int:
	var count := 0
	for front in _draft:
		var sides: Array = (front as Dictionary).get("sides", [[], []])
		if (sides[0] as Array).is_empty() or (sides[1] as Array).is_empty():
			count += 1
	return count


func _render_status() -> void:
	_count_label.text = ("1 front" if _draft.size() == 1 else "%d fronts" % _draft.size()).to_upper()
	EditorWarKit.set_enabled(_add_button, _draft.size() < EditorWarRules.MAX_SCENARIO_FRONTS, 0.5)
	_empty_hint.visible = _draft.is_empty()
	_few_hint.visible = _countries_loaded and _countries.size() < 2 and not _draft.is_empty()
	_error_label.text = _error
	_error_holder.visible = not _error.is_empty()
	_message_label.text = _message
	_message_holder.visible = not _message.is_empty()
	var changed := _changed()
	_save_button.text = "Saving…" if _busy else "Save fronts"
	EditorWarKit.set_enabled(_save_button, not _busy and changed and _unfinished() == 0)
	_discard_button.visible = changed
	EditorWarKit.set_enabled(_discard_button, not _busy, 1.0)


func _render_fronts() -> void:
	EditorKit.clear(_fronts_box)
	for index in range(_draft.size()):
		_fronts_box.add_child(_front_section(index))
	_render_status()


func _label_of(name: String) -> String:
	for country in _countries:
		if EditorWarRules.fold(country.get("key", "")) == EditorWarRules.fold(name):
			return str(country.get("label", name))
	return name


func _edit(index: int, next: Dictionary, rebuild: bool) -> void:
	var held := next
	if not bool(next.get("war", true)):
		held = next.duplicate(true)
		var sides: Array = []
		for members in next.get("sides", [[], []]):
			sides.append((members as Array).slice(0, 1))
		held["sides"] = sides
		var stances: Array = []
		for stance in next.get("stance", ["hold", "hold"]):
			stances.append("hold" if str(stance) == "advance" else stance)
		held["stance"] = stances
	_draft[index] = held
	_message = ""
	if rebuild:
		_render_fronts()
	else:
		_render_status()


func _front_section(index: int) -> Control:
	var front: Dictionary = _draft[index]
	var parts := EditorWarKit.section(13)
	var column: VBoxContainer = parts[1]
	var top := HBoxContainer.new()
	top.add_theme_constant_override("separation", 8)
	var name_box := VBoxContainer.new()
	name_box.add_theme_constant_override("separation", 0)
	name_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	name_box.add_child(EditorWarKit.field_label("Name"))
	var name_field := EditorWarKit.input(str(front.get("name", "")), "The Western Front")
	name_field.max_length = 80
	name_field.text_changed.connect(func(text: String) -> void:
		var next: Dictionary = (_draft[index] as Dictionary).duplicate(true)
		next["name"] = text
		_edit(index, next, false))
	name_box.add_child(name_field)
	top.add_child(name_box)
	var remove := EditorWarKit.button("Remove", "soft", 999)
	remove.size_flags_vertical = Control.SIZE_SHRINK_END
	remove.pressed.connect(func() -> void:
		_draft.remove_at(index)
		_message = ""
		_render_fronts())
	top.add_child(remove)
	column.add_child(top)
	column.add_child(EditorWarKit.gap(9))
	var war: bool = bool(front.get("war", true))
	var kinds := HFlowContainer.new()
	kinds.add_theme_constant_override("h_separation", 5)
	kinds.add_theme_constant_override("v_separation", 5)
	var at_war := EditorWarKit.choice("At war from the first day", war, 999)
	at_war.pressed.connect(func() -> void:
		var next: Dictionary = (_draft[index] as Dictionary).duplicate(true)
		next["war"] = true
		_edit(index, next, true))
	kinds.add_child(at_war)
	var at_peace := EditorWarKit.choice("A fortified border, at peace", not war, 999)
	at_peace.pressed.connect(func() -> void:
		var next: Dictionary = (_draft[index] as Dictionary).duplicate(true)
		next["war"] = false
		_edit(index, next, true))
	kinds.add_child(at_peace)
	column.add_child(kinds)
	column.add_child(EditorWarKit.gap(6))
	column.add_child(EditorWarKit.hint("The two sides are at war here when the game begins. If your pre-history does not already put them at war, the war is written into the game for you." if war else "Two countries that have manned their border and are not at war. A side told nothing has no troops there."))
	column.add_child(EditorWarKit.gap(10))
	var sides_row := HBoxContainer.new()
	sides_row.add_theme_constant_override("separation", 14)
	sides_row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for side in range(2):
		sides_row.add_child(_side_editor(index, side))
	column.add_child(sides_row)
	var sides: Array = front.get("sides", [[], []])
	if (sides[0] as Array).is_empty() or (sides[1] as Array).is_empty():
		column.add_child(EditorWarKit.gap(7))
		column.add_child(EditorWarKit.hint("Choose at least one country on each side.", EditorWarKit.WARN))
	return parts[0]


func _side_editor(index: int, side: int) -> Control:
	var front: Dictionary = _draft[index]
	var sides: Array = front.get("sides", [[], []])
	var members: Array = sides[side]
	var war: bool = bool(front.get("war", true))
	var taken := {}
	for list in sides:
		for name in list:
			taken[EditorWarRules.fold(name)] = true
	var free: Array = []
	for country in _countries:
		if not taken.has(EditorWarRules.fold(country.get("key", ""))):
			free.append([str(country.get("key", "")), str(country.get("label", ""))])
	var most := EditorWarRules.MAX_SIDE_MEMBERS if war else 1
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.add_child(EditorWarKit.field_label("One side" if side == 0 else "The other side"))
	if not members.is_empty():
		var chips := HFlowContainer.new()
		chips.add_theme_constant_override("h_separation", 5)
		chips.add_theme_constant_override("v_separation", 5)
		for name in members:
			chips.add_child(_chip(index, side, str(name)))
		column.add_child(chips)
		column.add_child(EditorWarKit.gap(6))
	if members.size() < most:
		var picker := EditorWarKit.select(free, "", func(picked: String) -> void:
			if picked.is_empty():
				return
			var next: Dictionary = (_draft[index] as Dictionary).duplicate(true)
			(next["sides"][side] as Array).append(picked)
			_edit(index, next, true), "Choose a country…" if members.is_empty() else "Add an ally…")
		picker.tooltip_text = "Add a country"
		column.add_child(picker)
	column.add_child(EditorWarKit.gap(9))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	var troops_box := VBoxContainer.new()
	troops_box.add_theme_constant_override("separation", 0)
	troops_box.custom_minimum_size.x = 104
	troops_box.add_child(EditorWarKit.field_label("Formations"))
	var troops: Array = front.get("troops", [0, 0])
	var count := int(EditorWarRules.to_number(troops[side]))
	var troops_field := EditorWarKit.input(str(count) if count != 0 else "", "By size")
	troops_field.text_changed.connect(func(text: String) -> void:
		var number := EditorWarRules.to_number(text.strip_edges()) if not text.strip_edges().is_empty() else 0.0
		if not EditorWarRules.is_finite_number(number):
			number = 0.0
		var kept := int(clampf(floorf(number + 0.5), 0.0, float(EditorWarRules.MAX_TROOPS_PER_SIDE)))
		var next: Dictionary = (_draft[index] as Dictionary).duplicate(true)
		next["troops"][side] = kept
		var shown := str(kept) if kept != 0 else ""
		if shown != text:
			troops_field.text = shown
			troops_field.caret_column = shown.length()
		_edit(index, next, false))
	troops_box.add_child(troops_field)
	row.add_child(troops_box)
	var stance_box := VBoxContainer.new()
	stance_box.add_theme_constant_override("separation", 0)
	stance_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	stance_box.add_child(EditorWarKit.field_label("From the first day"))
	var stances := HFlowContainer.new()
	stances.add_theme_constant_override("h_separation", 5)
	stances.add_theme_constant_override("v_separation", 5)
	var stance_now: Array = front.get("stance", ["hold", "hold"])
	for stance in (["hold", "dig in", "advance"] if war else ["hold", "dig in"]):
		var word := "Dig in" if stance == "dig in" else ("Attack" if stance == "advance" else "Hold")
		var choice := EditorWarKit.choice(word, str(stance_now[side]) == stance, 999)
		var picked: String = stance
		choice.pressed.connect(func() -> void:
			var next: Dictionary = (_draft[index] as Dictionary).duplicate(true)
			next["stance"][side] = picked
			_edit(index, next, true))
		stances.add_child(choice)
	stance_box.add_child(stances)
	row.add_child(stance_box)
	column.add_child(row)
	column.add_child(EditorWarKit.gap(9))
	column.add_child(EditorWarKit.field_label("Deployed as"))
	var forms_row := HFlowContainer.new()
	forms_row.add_theme_constant_override("h_separation", 5)
	forms_row.add_theme_constant_override("v_separation", 5)
	var forms: Array = front.get("forms") if front.get("forms") is Array else ["", ""]
	for form in ["", "front", "swarm"]:
		var word := "Swarms" if form == "swarm" else ("A front" if form == "front" else "As its wars are fought")
		var choice := EditorWarKit.choice(word, str(forms[side] if forms[side] != null else "") == form, 999)
		var picked: String = form
		choice.pressed.connect(func() -> void:
			var next: Dictionary = (_draft[index] as Dictionary).duplicate(true)
			var next_forms: Array = (next.get("forms") as Array).duplicate() if next.get("forms") is Array else ["", ""]
			next_forms[side] = picked
			next["forms"] = next_forms
			_edit(index, next, true))
		forms_row.add_child(choice)
	column.add_child(forms_row)
	column.add_child(EditorWarKit.gap(9))
	column.add_child(EditorWarKit.field_label("Generals"))
	var generals: Array = front.get("generals", [[], []])
	var names := PackedStringArray()
	for name in generals[side]:
		names.append(str(name))
	var generals_field := EditorWarKit.input(", ".join(names), "Names, with commas between them")
	generals_field.max_length = (EditorWarRules.GENERAL_NAME_MAX + 2) * EditorWarRules.MAX_COMMANDS
	generals_field.text_changed.connect(func(text: String) -> void:
		var parts := text.split(",")
		var kept: Array = []
		for part in parts.slice(0, EditorWarRules.MAX_COMMANDS):
			kept.append(str(part).lstrip(" \t\n\r").substr(0, EditorWarRules.GENERAL_NAME_MAX))
		var next: Dictionary = (_draft[index] as Dictionary).duplicate(true)
		next["generals"][side] = kept
		var shown := ", ".join(PackedStringArray(kept))
		if shown != text:
			generals_field.text = shown
			generals_field.caret_column = shown.length()
		_edit(index, next, false))
	column.add_child(generals_field)
	return column


func _chip(index: int, side: int, name: String) -> Control:
	var chip := PanelContainer.new()
	chip.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.08), Color(0, 0, 0, 0), 999, 0, Vector4(10, 3, 4, 3)))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 4)
	var text := UI.label(_label_of(name), 12, UI.WHITE, 700)
	text.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(text)
	var remove := Button.new()
	remove.text = "✕"
	remove.flat = true
	remove.focus_mode = Control.FOCUS_NONE
	remove.tooltip_text = "Remove"
	remove.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	remove.add_theme_font_override("font", UI.font(400))
	remove.add_theme_font_size_override("font_size", 13)
	for color_name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		remove.add_theme_color_override(color_name, Color(1, 1, 1, 0.6))
	var empty := StyleBoxEmpty.new()
	empty.content_margin_left = 4
	empty.content_margin_right = 4
	for state in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
		remove.add_theme_stylebox_override(state, empty)
	remove.pressed.connect(func() -> void:
		var next: Dictionary = (_draft[index] as Dictionary).duplicate(true)
		var kept: Array = []
		for other in next["sides"][side]:
			if str(other) != name:
				kept.append(other)
		next["sides"][side] = kept
		_edit(index, next, true))
	row.add_child(remove)
	chip.add_child(row)
	return chip


func _save() -> void:
	if _scenario_id.is_empty() or _busy or _unfinished() > 0:
		return
	_busy = true
	_error = ""
	_message = ""
	_render_status()
	var reply := await engine.request("editor.war.saveFronts", {"scenarioId": _scenario_id, "fronts": _draft})
	_busy = false
	if not is_inside_tree():
		return
	if reply.get("ok", false):
		var result: Dictionary = reply["result"]
		var details: Dictionary = result.get("details", {})
		details_changed.emit(details)
		_adopt_details(details, false)
		_draft = (result.get("fronts", []) as Array).duplicate(true)
		if result.get("countries") is Array:
			_countries = result["countries"]
			_countries_loaded = true
		_message = "Fronts saved. New games from this scenario begin with them."
		_render_fronts()
	else:
		_error = str(reply.get("error", ""))
		_render_status()
