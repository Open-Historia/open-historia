extends VBoxContainer

signal changed(patch: Dictionary)
signal type_changed(agreement_type: String)
signal reciprocal_changed(on: bool)
signal remove_requested
signal toggled(open: bool)

const LABEL_INK := Color(1, 1, 1, 0.62)
const HINT_INK := Color(1, 1, 1, 0.5)
const NOTE_INK := Color(1, 1, 1, 0.55)
const PROBLEM_INK := Color("#fca5a5")
const INPUT_INK := Color("#f8fafc")
const SUMMARY_INK := Color("#f4f4f5")
const MAX_COUNTRIES := 12

var _row := {}
var _fact := {}
var _problems: Array = []
var _disabled := false
var _types: Array = []
var _suggest := Callable()
var _section := {}
var _countries_boxes := {}
var _problems_box: VBoxContainer


func setup(row: Dictionary, fact: Dictionary, options: Dictionary) -> void:
	_row = row
	_fact = fact
	_problems = options.get("problems", []) if options.get("problems") is Array else []
	_disabled = bool(options.get("disabled", false))
	_types = options.get("agreementTypes", []) if options.get("agreementTypes") is Array else []
	_suggest = options.get("suggest", Callable())
	add_theme_constant_override("separation", 0)
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_section = PoliticalKit.section(_summary_text(), bool(options.get("open", false)), Color(0, 0, 0, 0), Color(1, 1, 1, 0.09), 10, Vector4(10, 8, 10, 8), 12, 750, SUMMARY_INK)
	add_child(_section["panel"])
	(_section["summary"] as Button).pressed.connect(_on_toggled)
	var content: VBoxContainer = _section["content"]
	content.add_theme_constant_override("separation", 10)
	content.add_child(EditorKit.gap(0))
	_build(content)


func _on_toggled() -> void:
	toggled.emit(bool(_section["open"]))


func _family() -> String:
	return str(_row.get("family", ""))


func _canonical_agreement() -> bool:
	return _family() == "worldAgreements"


func kind() -> String:
	if _family() == "canonicalUpdates":
		return str(_fact.get("kind", ""))
	return str({"relationUpdates": "relation", "agreementUpdates": "agreement", "storylineUpdates": "storyline", "worldAgreements": "agreement"}.get(_family(), ""))


func _legacy() -> bool:
	return _family() != "canonicalUpdates" and not _canonical_agreement()


func _reciprocal() -> bool:
	var value: Variant = _fact.get("reciprocalAccess") if _canonical_agreement() else _fact.get("reciprocal")
	return typeof(value) == TYPE_BOOL and bool(value)


func _legacy_undirected_access() -> bool:
	return _canonical_agreement() and str(_fact.get("type", "")) == "military_access" and not _reciprocal() and not _has(_fact.get("grantor")) and not _has(_fact.get("grantee"))


static func _has(value: Variant) -> bool:
	return not clean(value).is_empty()


static func clean(value: Variant) -> String:
	return EditorWarRules.js_string(value).strip_edges()


static func words(value: Variant) -> String:
	var text := clean(value).replace("_", " ")
	var out := ""
	var start := true
	for character in text:
		var letter := character.to_lower() != character.to_upper()
		var digit := "0123456789".contains(character)
		var word := letter or digit or character == "_"
		out += character.to_upper() if start and word else character
		start = not word
	return out


func _description() -> String:
	var kind_now := kind()
	if kind_now == "relation":
		return "Relationship"
	if kind_now == "agreement":
		return "Agreement"
	return "Ongoing storyline"


func _summary_text() -> String:
	var title := ""
	if kind() == "relation":
		var names: Array = []
		for key in ["a", "b"]:
			var name := clean(_fact.get(key))
			if not name.is_empty():
				names.append(name)
		title = " / ".join(PackedStringArray(names))
		if title.is_empty():
			title = "New relationship"
	else:
		title = clean(_fact.get("title"))
		if title.is_empty():
			title = "New " + _description().to_lower()
	return _description() + ": " + title


func set_problems(problems: Array) -> void:
	_problems = problems
	if _problems_box == null:
		return
	EditorKit.clear(_problems_box)
	_problems_box.visible = not problems.is_empty()
	for problem in problems:
		_problems_box.add_child(UI.wrapped(str(problem), 11, PROBLEM_INK))


func refresh_summary() -> void:
	PoliticalKit.set_section_title(_section, _summary_text())


func _change(field: String, value: Variant) -> void:
	changed.emit({field: value})
	refresh_summary()


func _label(text: String) -> Label:
	return UI.label(text, 10, LABEL_INK, 750)


static func _box(focus: bool) -> StyleBoxFlat:
	return UI.box(Color(1, 1, 1, 0.07 if focus else 0.045), Color(1, 1, 1, 0.24 if focus else 0.14), 9, 1, Vector4(9, 7, 9, 7))


static func _restyle(node: Control) -> void:
	node.add_theme_stylebox_override("normal", _box(false))
	node.add_theme_stylebox_override("focus", _box(true))
	node.add_theme_stylebox_override("read_only", _box(false))


func _line(value: String) -> LineEdit:
	var node := PoliticalKit.input(value)
	node.custom_minimum_size.y = 32
	node.editable = not _disabled
	_restyle(node)
	return node


func _field(label: String, key: String, options := {}) -> VBoxContainer:
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 4)
	box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	box.add_child(_label(label))
	var numeric := str(options.get("type", "")) == "number"
	var line := _line(EditorWarRules.js_string(_fact.get(key)) if _fact.has(key) and _fact.get(key) != null else "")
	line.text_changed.connect(func(text: String) -> void:
		if numeric:
			_change(key, _number_or_blank(text))
		else:
			_change(key, text))
	if bool(options.get("countries", false)) and _suggest.is_valid():
		_suggest.call(line)
	box.add_child(line)
	var hint := str(options.get("hint", ""))
	if not hint.is_empty():
		box.add_child(UI.wrapped(hint, 10, HINT_INK))
	return box


static func _number_or_blank(text: String) -> Variant:
	if text.strip_edges().is_empty():
		return null
	var number := PoliticalKit.number_value(text.strip_edges())
	if number.is_empty():
		return text
	var parsed := number.to_float()
	return int(parsed) if parsed == floorf(parsed) and absf(parsed) < 1e15 else parsed


func _multiline(label: String, key: String) -> VBoxContainer:
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 4)
	box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	box.add_child(_label(label))
	var area := PoliticalKit.area(EditorWarRules.js_string(_fact.get(key)) if _fact.get(key) != null else "", 66, Callable(), "", false, 12)
	area.editable = not _disabled
	_restyle(area)
	area.text_changed.connect(func() -> void: _change(key, area.text))
	box.add_child(area)
	return box


func _compact_button(text: String) -> Button:
	var node := PoliticalKit.styled_button(text, [Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.12), INPUT_INK], 8, 28, 10, 11, 750)
	PoliticalKit.set_enabled(node, not _disabled)
	return node


func _country_rows(label: String, key: String) -> VBoxContainer:
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 6)
	box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_countries_boxes[key] = box
	_fill_countries(box, label, key)
	return box


func _countries(key: String) -> Array:
	return (_fact.get(key) as Array).duplicate() if _fact.get(key) is Array else []


func _fill_countries(box: VBoxContainer, label: String, key: String) -> void:
	EditorKit.clear(box)
	box.add_child(_label(label))
	var countries := _countries(key)
	for index in range(countries.size()):
		var line_row := HBoxContainer.new()
		line_row.add_theme_constant_override("separation", 6)
		var line := _line(EditorWarRules.js_string(countries[index]))
		line.tooltip_text = "%s %d" % [label, index + 1]
		var at := index
		line.text_changed.connect(func(text: String) -> void:
			var next := _countries(key)
			if at < next.size():
				next[at] = text
			_change(key, next))
		if _suggest.is_valid():
			_suggest.call(line)
		line_row.add_child(line)
		var remove := _compact_button("Remove country")
		remove.pressed.connect(func() -> void:
			var next := _countries(key)
			if at < next.size():
				next.remove_at(at)
			_change(key, next)
			_fill_countries(box, label, key))
		line_row.add_child(remove)
		box.add_child(line_row)
	var add_row := HBoxContainer.new()
	var add := _compact_button("+ Add country")
	PoliticalKit.set_enabled(add, not _disabled and countries.size() < MAX_COUNTRIES)
	add.pressed.connect(func() -> void:
		var next := _countries(key)
		next.append("")
		_change(key, next)
		_fill_countries(box, label, key))
	add_row.add_child(add)
	box.add_child(add_row)
	box.add_child(UI.wrapped("Use the canonical scenario country name.", 10, HINT_INK))


func _select(label: String, key: String, choices: Array, on_select: Callable) -> VBoxContainer:
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 4)
	box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	box.add_child(_label(label))
	var current := EditorWarRules.js_string(_fact.get(key)) if _fact.get(key) != null else ""
	var options: Array = []
	if not choices.has(current):
		var shown := words(current)
		options.append([current, shown if not shown.is_empty() else "?"])
	for value in choices:
		options.append([str(value), words(value)])
	var node := PoliticalKit.select(options, current, func(value: String) -> void: on_select.call(value))
	node.custom_minimum_size.y = 32
	node.disabled = _disabled
	for state in ["normal", "focus", "disabled"]:
		node.add_theme_stylebox_override(state, _box(false))
	for state in ["hover", "pressed"]:
		node.add_theme_stylebox_override(state, _box(true))
	box.add_child(node)
	return box


func _two(children: Array) -> GridContainer:
	var grid := GridContainer.new()
	grid.columns = 1 if UI.phone() else 2
	grid.add_theme_constant_override("h_separation", 8)
	grid.add_theme_constant_override("v_separation", 8)
	grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for child in children:
		(child as Control).size_flags_horizontal = Control.SIZE_EXPAND_FILL
		grid.add_child(child)
	return grid


func _check(text: String, on: bool) -> CheckBox:
	var node := PoliticalKit.check(text, on, Callable(), 12, SUMMARY_INK)
	node.disabled = _disabled
	node.toggled.connect(func(value: bool) -> void: reciprocal_changed.emit(value))
	return node


func _build(content: VBoxContainer) -> void:
	var kind_now := kind()
	var legacy := _legacy()
	if legacy:
		content.add_child(UI.wrapped("Older generated record. Its internal ID and existing event links are preserved when you edit it.", 11, NOTE_INK))
	if _canonical_agreement():
		content.add_child(UI.wrapped("Existing scenario agreement - ID: " + EditorWarRules.js_string(_fact.get("id")) + " - Status: " + words(_fact.get("status") if _has(_fact.get("status")) else "active") + ". Editing its starting record does not modify existing campaigns.", 11, Color(1, 1, 1, 0.6)))
	if kind_now == "relation":
		content.add_child(_two([_field("First country", "a", {"countries": true}), _field("Second country", "b", {"countries": true})]))
		content.add_child(_field("Relationship score (-100 to 100)", "score", {"type": "number"}))
		content.add_child(_multiline("Relationship summary", "summary"))
	elif kind_now == "agreement":
		content.add_child(_field("Agreement title", "title"))
		var on_type := func(value: String) -> void:
			if legacy:
				_change("type", value)
			else:
				type_changed.emit(value)
		content.add_child(_select("Agreement type", "type", _types, on_type))
		var agreement_type := str(_fact.get("type", ""))
		var reciprocal := _reciprocal()
		if not legacy and agreement_type == "guarantee":
			content.add_child(_two([_field("Guarantor (protecting country)", "guarantor", {"countries": true}), _field("Beneficiary (protected country)", "beneficiary", {"countries": true})]))
		elif not legacy and agreement_type == "military_access" and not reciprocal and not _legacy_undirected_access():
			content.add_child(_check("Reciprocal access (both countries grant access)", false))
			content.add_child(_two([_field("Access grantor", "grantor", {"countries": true}), _field("Access grantee", "grantee", {"countries": true})]))
		else:
			if not legacy and agreement_type == "military_access":
				content.add_child(_check("Reciprocal access (both countries grant access)", reciprocal))
				if _legacy_undirected_access():
					content.add_child(UI.wrapped("The original access direction was not recorded; editing this treaty does not invent one.", 11, NOTE_INK))
			content.add_child(_country_rows("Signatory countries", "parties"))
		content.add_child(_multiline("Terms / obligations", "terms"))
		if not legacy:
			content.add_child(_field("Signed / effective date (optional)", "startedDate", {"hint": "YYYY-MM-DD, no later than the scenario start." if _canonical_agreement() else "YYYY-MM-DD, before the game begins."}))
		if _canonical_agreement() and ["ended", "expired"].has(str(_fact.get("status", ""))):
			content.add_child(_field("Agreement ended date (optional)", "endedDate", {"hint": "YYYY-MM-DD, no later than the scenario start."}))
	elif kind_now == "storyline":
		content.add_child(_field("Storyline title", "title"))
		var process_key := "kind" if legacy else "processKind"
		content.add_child(_two([_field("Process kind (e.g. diplomacy or crisis)", process_key), _select("Status", "status", ["active", "dormant"], func(value: String) -> void: _change("status", value))]))
		content.add_child(_country_rows("Participating countries", "participants"))
		content.add_child(_two([_field("Pressure (0-100)", "pressure", {"type": "number"}), _field("Momentum (0-100)", "momentum", {"type": "number"})]))
		content.add_child(_multiline("What is happening now", "state"))
		content.add_child(_field("Started date (optional)", "startedDate", {"hint": "YYYY-MM-DD, before the game begins."}))
	_problems_box = VBoxContainer.new()
	_problems_box.add_theme_constant_override("separation", 10)
	content.add_child(_problems_box)
	set_problems(_problems)
	var actions := HBoxContainer.new()
	actions.alignment = BoxContainer.ALIGNMENT_END
	var remove := _compact_button("Remove fact")
	remove.pressed.connect(func() -> void: remove_requested.emit())
	actions.add_child(remove)
	content.add_child(actions)
