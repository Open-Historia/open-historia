class_name EditorStatsSheet
extends VBoxContainer

signal details_changed(details: Dictionary)
signal value_changed(value: Variant)

const INPUT_BG := Color("#20242b")
const INPUT_BORDER := Color(1, 1, 1, 0.13)
const INPUT_FOCUS := Color(1, 1, 1, 0.28)
const INPUT_INK := Color("#f8fafc")
const PLACEHOLDER := Color("#9ca3af")
const ROSE := Color("#fca5a5")
const MONO := "Consolas"
const STAT_KINDS := [["index", "0–100 index"], ["number", "Number"], ["percentage", "Percentage"], ["currency", "Currency/value"]]
const INFO_TEXT := "The standard sheet is Open Historia's modern audited economy/statistics model. Customize it to make the entire National Stats panel scenario-defined: add, remove and reorder sections and values for any era. Custom sheets use general-purpose persistent numeric stats, so a medieval scenario can track timber, silver, grain, ships or legitimacy without being forced to generate modern GDP or unemployment."

var _engine: EngineLink
var _host: Node
var _value: Dictionary = {}
var _custom := false
var _sections: Array = []
var _editing_stat := ""
var _editing_section := ""
var _drag_item: Dictionary = {}
var _last_custom: Variant = null
var _built := false
var _section_nodes: Array = []
var _stat_nodes: Array = []
var _guard := false
var _footer_count: Label
var _grids: Array[GridContainer] = []


func setup(engine: EngineLink, props: Dictionary) -> void:
	_engine = engine
	add_theme_constant_override("separation", 13)
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_read(props)
	resized.connect(_fit_grids)
	_start()


func update_props(props: Dictionary) -> void:
	if props.has("host"):
		_host = props["host"]
	if not props.has("value"):
		return
	var incoming: Variant = props["value"]
	if JSON.stringify(incoming) == JSON.stringify(_value):
		return
	_read(props)
	if _built:
		_rebuild()


func current_value() -> Dictionary:
	return _value


func _read(props: Dictionary) -> void:
	if props.has("host"):
		_host = props["host"]
	if not props.has("value"):
		return
	_value = props["value"] if props["value"] is Dictionary else {}
	var defaults := _default_sections()
	if _value.has("custom") and _value["custom"] != null:
		_custom = _truthy(_value["custom"])
	else:
		_custom = _valid_section_count(_value.get("sections")) > 0
	if not _custom:
		_sections = defaults
	elif _value.get("sections") is Array:
		_sections = []
		for section in _value["sections"]:
			var copy: Dictionary = (section as Dictionary).duplicate() if section is Dictionary else {}
			var stats: Array = []
			if copy.get("stats") is Array:
				for stat in copy["stats"]:
					stats.append((stat as Dictionary).duplicate() if stat is Dictionary else stat)
			copy["stats"] = stats
			_sections.append(copy)
	else:
		_sections = defaults


func _truthy(value: Variant) -> bool:
	if value == null:
		return false
	if value is bool:
		return value
	if value is float or value is int:
		return float(value) != 0.0
	if value is String:
		return not str(value).is_empty()
	return true


func _stats_defs() -> Dictionary:
	return EditorFeaturesSection.definitions.get("stats", {}) if EditorFeaturesSection.definitions.get("stats") is Dictionary else {}


func _default_sections() -> Array:
	var raw: Array = _stats_defs().get("defaultSections", [])
	return raw.duplicate(true)


func _max_sections() -> int:
	return int(_stats_defs().get("maxSections", 12))


func _max_per_section() -> int:
	return int(_stats_defs().get("maxPerSection", 20))


func _max_stats() -> int:
	return int(_stats_defs().get("maxStats", 60))


func _start() -> void:
	if EditorFeaturesSection.definitions.is_empty():
		var reply := await _engine.request("editor.rules.definitions")
		if reply.get("ok", false) and reply.get("result") is Dictionary:
			EditorFeaturesSection.definitions = reply["result"]
	if not is_inside_tree():
		return
	if not _custom and _sections.is_empty():
		_sections = _default_sections()
	_rebuild()


func _clean(value: Variant) -> String:
	return EditorFeaturesModel.js_trim(EditorFeaturesModel.text_of(value))


func _label_of(record: Dictionary) -> String:
	var raw: Variant = EditorFeaturesModel.coalesce(record, ["label", "name"])
	return _clean(raw).substr(0, 60)


func _key_valid_or_derived(record: Dictionary, label: String) -> bool:
	var key := _clean(record.get("key"))
	if EditorStatKeys.is_key(key):
		return true
	return not EditorStatKeys.to_key(label).is_empty()


func _valid_section_count(raw: Variant) -> int:
	return int(_normalized_counts(raw)["sections"])


func _normalized_counts(raw: Variant) -> Dictionary:
	var sections := 0
	var stats := 0
	if raw is Array:
		for item in raw:
			if not (item is Dictionary):
				continue
			var section: Dictionary = item
			var label := _label_of(section)
			if label.is_empty() or not _key_valid_or_derived(section, label):
				continue
			var kept := 0
			if section.get("stats") is Array:
				for stat_item in section["stats"]:
					if stats >= _max_stats() or kept >= _max_per_section():
						break
					if not (stat_item is Dictionary):
						continue
					var stat_label := _label_of(stat_item)
					if stat_label.is_empty() or not _key_valid_or_derived(stat_item, stat_label):
						continue
					kept += 1
					stats += 1
			if kept == 0:
				continue
			sections += 1
			if sections >= _max_sections() or stats >= _max_stats():
				break
	return {"sections": sections, "stats": stats}


func _total_stats() -> int:
	var counts := _normalized_counts(_sections)
	if int(counts["sections"]) == 0:
		return int(_normalized_counts(_default_sections())["stats"])
	return int(counts["stats"])


func _all_keys(sections: Array) -> Dictionary:
	var used := {}
	for section in sections:
		if not (section is Dictionary) or not ((section as Dictionary).get("stats") is Array):
			continue
		for stat in (section as Dictionary)["stats"]:
			if stat is Dictionary:
				var key := _clean((stat as Dictionary).get("key")).to_lower()
				if not key.is_empty():
					used[key] = true
	return used


func _unique_key(base_input: String, used: Dictionary) -> String:
	var key := base_input
	var suffix := 2
	while used.has(key.to_lower()):
		var tail := str(suffix)
		key = base_input.substr(0, maxi(1, 40 - tail.length())) + tail
		suffix += 1
	return key


func _unique_key_for(label: String, sections: Array, except_key := "") -> String:
	var used := _all_keys(sections)
	if not except_key.is_empty():
		used.erase(_clean(except_key).to_lower())
	var base := EditorStatKeys.to_key(label)
	return _unique_key(base if not base.is_empty() else "stat", used)


func _unique_section_key_for(label: String, sections: Array, except_key := "") -> String:
	var used := {}
	for section in sections:
		if section is Dictionary:
			var key := _clean((section as Dictionary).get("key")).to_lower()
			if not key.is_empty():
				used[key] = true
	if not except_key.is_empty():
		used.erase(_clean(except_key).to_lower())
	var base := EditorStatKeys.to_key(label)
	return _unique_key(base if not base.is_empty() else "section", used)


func _draft_id(prefix: String) -> String:
	return "%s-%d-%s" % [prefix, int(Time.get_unix_time_from_system() * 1000.0), EditorScriptedEvents.random_tail(5)]


func _emit_sections(next: Array) -> void:
	_sections = next
	_value = {"custom": true, "version": 2.0, "sections": next}
	_custom = true
	value_changed.emit(_value)


func _enable_custom() -> void:
	_editing_stat = ""
	_editing_section = ""
	if _last_custom != null:
		_sections = (_last_custom as Array)
		_value = {"custom": true, "version": 2.0, "sections": _sections}
	else:
		_sections = _default_sections()
		_value = {"custom": true, "version": 2.0, "sections": _sections}
	_custom = true
	value_changed.emit(_value)
	_rebuild()


func _use_standard() -> void:
	var count := _total_stats()
	var question := "Replace your 1 custom statistic with the standard sheet?" if count == 1 else "Replace your %d custom statistics with the standard sheet?" % count
	if not await EditorKit.ask(_dialog_host(), question):
		return
	_last_custom = _sections
	_editing_stat = ""
	_editing_section = ""
	_custom = false
	_sections = _default_sections()
	_value = {"custom": false, "version": 2.0, "sections": _sections}
	value_changed.emit(_value)
	_rebuild()


func _dialog_host() -> Node:
	return _host if _host and is_instance_valid(_host) else self


func _section_index(key: String) -> int:
	for index in range(_sections.size()):
		if str((_sections[index] as Dictionary).get("key", "")) == key:
			return index
	return -1


func _patch_section(section_key: String, patch: Dictionary) -> String:
	var next: Array = []
	var new_key := section_key
	for section in _sections:
		var record: Dictionary = section
		if str(record.get("key", "")) != section_key:
			next.append(record)
			continue
		var candidate := record.duplicate()
		for field in patch:
			candidate[field] = patch[field]
		if _truthy(record.get("isNew")) and patch.has("label"):
			candidate["key"] = _unique_section_key_for(str(patch["label"]), _sections, section_key)
		new_key = str(candidate.get("key", ""))
		next.append(candidate)
	_emit_sections(next)
	if _editing_section == section_key and new_key != section_key:
		_editing_section = new_key
	return new_key


func _add_section() -> void:
	if _sections.size() >= _max_sections() or _total_stats() >= _max_stats():
		return
	var label := "New section"
	var key := _unique_section_key_for(label, _sections)
	var next := _sections.duplicate()
	next.append({"key": key, "label": label, "icon": "◆", "isNew": true, "draftId": _draft_id("section"), "stats": []})
	_emit_sections(next)
	_editing_section = key
	_rebuild()


func _remove_section(section_key: String) -> void:
	if _sections.size() <= 1:
		return
	var index := _section_index(section_key)
	if index < 0:
		return
	var doomed: Dictionary = _sections[index]
	var count := (doomed.get("stats", []) as Array).size() if doomed.get("stats") is Array else 0
	if count > 0:
		var question := "Delete the section \"%s\" and the statistic in it?" % str(doomed.get("label", "")) if count == 1 else "Delete the section \"%s\" and the %d statistics in it?" % [str(doomed.get("label", "")), count]
		if not await EditorKit.ask(_dialog_host(), question):
			return
	var next: Array = []
	for section in _sections:
		if str((section as Dictionary).get("key", "")) != section_key:
			next.append(section)
	_emit_sections(next)
	if _editing_section == section_key:
		_editing_section = ""
	_rebuild()


func _add_stat(section_key: String) -> void:
	var index := _section_index(section_key)
	if index < 0:
		return
	var section: Dictionary = _sections[index]
	var stats: Array = section.get("stats", [])
	if _total_stats() >= _max_stats() or stats.size() >= _max_per_section():
		return
	var label := "New statistic"
	var key := _unique_key_for(label, _sections)
	var stat := {"key": key, "label": label, "kind": "index", "icon": "◆", "color": "#94a3b8", "description": "", "decimals": 0.0, "isNew": true, "draftId": _draft_id("stat")}
	var next: Array = []
	for entry in _sections:
		var record: Dictionary = entry
		if str(record.get("key", "")) == section_key:
			var copy := record.duplicate()
			var list: Array = (record.get("stats", []) as Array).duplicate()
			list.append(stat)
			copy["stats"] = list
			next.append(copy)
		else:
			next.append(record)
	_emit_sections(next)
	_editing_stat = key
	_rebuild()


func _patch_stat(section_key: String, stat_key: String, patch: Dictionary, removes: Array = []) -> String:
	var next_key := stat_key
	var next: Array = []
	for entry in _sections:
		var section: Dictionary = entry
		if str(section.get("key", "")) != section_key:
			next.append(section)
			continue
		var copy := section.duplicate()
		var stats: Array = []
		for stat_entry in section.get("stats", []):
			var stat: Dictionary = stat_entry
			if str(stat.get("key", "")) != stat_key:
				stats.append(stat)
				continue
			var candidate := stat.duplicate()
			for field in patch:
				candidate[field] = patch[field]
			for field in removes:
				candidate.erase(field)
			if _truthy(stat.get("isNew")) and patch.has("label"):
				candidate["key"] = _unique_key_for(str(patch["label"]), _sections, stat_key)
			var kinds := ["index", "number", "percentage", "currency"]
			if not kinds.has(candidate.get("kind")):
				candidate["kind"] = "index"
			var kind := str(candidate["kind"])
			if patch.has("kind") and kind != str(stat.get("kind", "")):
				if kind == "index":
					candidate["minimum"] = 0.0
					candidate["maximum"] = 100.0
					candidate["decimals"] = 0.0
					candidate["prefix"] = ""
					candidate["suffix"] = ""
				elif kind == "percentage":
					candidate["minimum"] = 0.0
					candidate["maximum"] = 100.0
					var decimals := EditorFeaturesModel.js_number(candidate.get("decimals")) if candidate.has("decimals") else NAN
					candidate["decimals"] = maxf(0.0, decimals if EditorFeaturesModel.is_finite_number(decimals) and decimals != 0.0 else 0.0)
					if not _truthy(candidate.get("suffix")):
						candidate["suffix"] = "%"
				else:
					var previous := str(stat.get("kind", ""))
					if previous == "index" or previous == "percentage":
						candidate.erase("minimum")
						candidate.erase("maximum")
					if kind == "currency" and previous == "percentage" and candidate.get("suffix") == "%":
						candidate["suffix"] = ""
			elif kind == "index":
				candidate["minimum"] = 0.0
				candidate["maximum"] = 100.0
				candidate["decimals"] = 0.0
			next_key = str(candidate.get("key", ""))
			stats.append(candidate)
		copy["stats"] = stats
		next.append(copy)
	_emit_sections(next)
	if _editing_stat == stat_key and next_key != stat_key:
		_editing_stat = next_key
	return next_key


func _remove_stat(section_key: String, stat_key: String) -> void:
	if _total_stats() <= 1:
		return
	var next: Array = []
	for entry in _sections:
		var section: Dictionary = entry
		if str(section.get("key", "")) == section_key:
			var copy := section.duplicate()
			var stats: Array = []
			for stat in section.get("stats", []):
				if str((stat as Dictionary).get("key", "")) != stat_key:
					stats.append(stat)
			copy["stats"] = stats
			next.append(copy)
		else:
			next.append(section)
	_emit_sections(next)
	if _editing_stat == stat_key:
		_editing_stat = ""
	_rebuild()


func move_section(source_key: String, target_key: String) -> void:
	var source_index := _section_index(source_key)
	var target_index := _section_index(target_key)
	if source_index < 0 or target_index < 0 or source_index == target_index:
		return
	var next := _sections.duplicate()
	var moved: Variant = next[source_index]
	next.remove_at(source_index)
	next.insert(target_index, moved)
	_emit_sections(next)
	_rebuild()


func move_stat(source_section_key: String, stat_key: String, target_section_key: String, target_stat_key := "") -> void:
	if source_section_key.is_empty() or stat_key.is_empty() or target_section_key.is_empty():
		return
	var source_index := _section_index(source_section_key)
	var target_index := _section_index(target_section_key)
	if source_index < 0 or target_index < 0:
		return
	var source_stats: Array = (_sections[source_index] as Dictionary).get("stats", [])
	var found := false
	for stat in source_stats:
		if str((stat as Dictionary).get("key", "")) == stat_key:
			found = true
	if not found:
		return
	var target_stats_before: Array = (_sections[target_index] as Dictionary).get("stats", [])
	if source_section_key != target_section_key and target_stats_before.size() >= _max_per_section():
		return
	var next: Array = []
	for section in _sections:
		var copy: Dictionary = (section as Dictionary).duplicate()
		copy["stats"] = ((section as Dictionary).get("stats", []) as Array).duplicate()
		next.append(copy)
	var next_source: Dictionary = next[source_index]
	var next_target: Dictionary = next[target_index]
	var source_list: Array = next_source["stats"]
	var from := -1
	for index in range(source_list.size()):
		if str((source_list[index] as Dictionary).get("key", "")) == stat_key:
			from = index
			break
	var moved: Variant = source_list[from]
	source_list.remove_at(from)
	var target_list: Array = next_target["stats"]
	var to := target_list.size()
	if not target_stat_key.is_empty():
		to = -1
		for index in range(target_list.size()):
			if str((target_list[index] as Dictionary).get("key", "")) == target_stat_key:
				to = index
				break
		if to < 0:
			to = target_list.size()
	if source_section_key == target_section_key and from < to:
		to -= 1
	target_list.insert(to, moved)
	_emit_sections(next)
	_rebuild()


func _button(text: String, accent := false, ink := Color(1, 1, 1, 0.88)) -> Button:
	var node := Button.new()
	node.text = text
	node.focus_mode = Control.FOCUS_NONE
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var bg := Color(1, 1, 1, 0.08 if accent else 0.06)
	var border := Color(1, 1, 1, 0.21 if accent else 0.09)
	var normal := UI.box(bg, border, 9, 1, Vector4(11, 2, 11, 2))
	var hover := UI.box(Color(1, 1, 1, bg.a + 0.05), Color(1, 1, 1, border.a + 0.1), 9, 1, Vector4(11, 2, 11, 2))
	for state in [["normal", normal], ["hover", hover], ["pressed", hover], ["hover_pressed", hover], ["focus", normal], ["disabled", normal]]:
		node.add_theme_stylebox_override(state[0], state[1])
	node.add_theme_font_override("font", UI.font(750))
	node.add_theme_font_size_override("font_size", 12)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color", "font_disabled_color"]:
		node.add_theme_color_override(name, ink)
	node.custom_minimum_size.y = 32
	return node


func _icon_button(text: String, tip: String, ink := Color(1, 1, 1, 0.88)) -> Button:
	var node := _button(text, false, ink)
	var normal := UI.box(Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.09), 9, 1, Vector4(0, 0, 0, 0))
	var hover := UI.box(Color(1, 1, 1, 0.11), Color(1, 1, 1, 0.19), 9, 1, Vector4(0, 0, 0, 0))
	for state in [["normal", normal], ["hover", hover], ["pressed", hover], ["hover_pressed", hover], ["focus", normal], ["disabled", normal]]:
		node.add_theme_stylebox_override(state[0], state[1])
	node.custom_minimum_size = Vector2(32, 32)
	node.tooltip_text = tip
	node.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	return node


func _field_label(text: String) -> Label:
	return UI.label(text.to_upper(), 9, Color(1, 1, 1, 0.48), 800)


func _input_style(focus: bool) -> StyleBoxFlat:
	return UI.box(INPUT_BG, INPUT_FOCUS if focus else INPUT_BORDER, 9, 1, Vector4(10, 7, 10, 7))


func _line_input(value: String, max_length: int, on_change: Callable, placeholder := "", centered := false) -> LineEdit:
	var edit := LineEdit.new()
	edit.text = value
	edit.max_length = max_length
	edit.placeholder_text = placeholder
	edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	edit.custom_minimum_size.y = 34
	if centered:
		edit.alignment = HORIZONTAL_ALIGNMENT_CENTER
	edit.add_theme_stylebox_override("normal", _input_style(false))
	edit.add_theme_stylebox_override("focus", _input_style(true))
	edit.add_theme_font_override("font", UI.font(400))
	edit.add_theme_font_size_override("font_size", 12)
	edit.add_theme_color_override("font_color", INPUT_INK)
	edit.add_theme_color_override("font_placeholder_color", PLACEHOLDER)
	edit.add_theme_color_override("caret_color", INPUT_INK)
	edit.add_theme_color_override("selection_color", Color(UI.ACCENT, 0.35))
	if on_change.is_valid():
		edit.text_changed.connect(func(text: String) -> void: on_change.call(text))
	return edit


func _field(label: String, control: Control) -> VBoxContainer:
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 4)
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.add_child(_field_label(label))
	column.add_child(control)
	return column


func _fit_grids() -> void:
	for grid in _grids:
		if not is_instance_valid(grid):
			continue
		var width := grid.size.x if grid.size.x > 0.0 else size.x - 60.0
		grid.columns = maxi(1, int(floor((width + 9.0) / (112.0 + 9.0))))


func _rebuild() -> void:
	EditorKit.clear(self)
	_grids.clear()
	_section_nodes.clear()
	_stat_nodes.clear()
	var info := PanelContainer.new()
	info.add_theme_stylebox_override("panel", UI.box(Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.07), Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.15), 12, 1, Vector4(12, 11, 12, 11)))
	var info_text := UI.wrapped(INFO_TEXT, 11, Color(219 / 255.0, 234 / 255.0, 254 / 255.0, 0.74))
	info.add_child(info_text)
	add_child(info)
	if not _custom:
		var standard := PanelContainer.new()
		standard.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.03), Color(1, 1, 1, 0.07), 12, 1, Vector4(12, 12, 12, 12)))
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 12)
		var texts := VBoxContainer.new()
		texts.add_theme_constant_override("separation", 3)
		texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		texts.add_child(UI.label("Standard National Stats sheet", 12, UI.WHITE, 800))
		texts.add_child(UI.wrapped("Uses the current audited population/GDP engine, strategic indices, and modern economy fields.", 10, Color(1, 1, 1, 0.42)))
		row.add_child(texts)
		var customize := _button("Customize full sheet", true)
		customize.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		customize.pressed.connect(_enable_custom)
		row.add_child(customize)
		standard.add_child(row)
		add_child(standard)
	else:
		for index in range(_sections.size()):
			add_child(_section_card(index))
		var footer := HBoxContainer.new()
		footer.add_theme_constant_override("separation", 8)
		var add_section := _button("+ Add section", true)
		var section_full := _sections.size() >= _max_sections() or _total_stats() >= _max_stats()
		add_section.disabled = section_full
		add_section.modulate.a = 0.45 if section_full else 1.0
		add_section.pressed.connect(_add_section)
		footer.add_child(add_section)
		var standard_button := _button("Use standard sheet")
		standard_button.pressed.connect(_use_standard)
		footer.add_child(standard_button)
		footer.add_child(UI.spacer())
		_footer_count = UI.label("", 10, Color(1, 1, 1, 0.35))
		_footer_count.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		footer.add_child(_footer_count)
		add_child(footer)
		_refresh_counts()
	_built = true
	_fit_grids.call_deferred()


func _refresh_counts() -> void:
	if _footer_count and is_instance_valid(_footer_count):
		_footer_count.text = "%d/%d sections · %d/%d stats" % [_sections.size(), _max_sections(), _total_stats(), _max_stats()]


func _notification(what: int) -> void:
	if what == NOTIFICATION_DRAG_END and not _drag_item.is_empty():
		_drag_item = {}
		_restyle_drag()


func _restyle_drag() -> void:
	for entry in _section_nodes:
		var pair: Array = entry
		if is_instance_valid(pair[1]):
			(pair[1] as PanelContainer).add_theme_stylebox_override("panel", _section_style(str((pair[0] as Array)[0])))
	for entry in _stat_nodes:
		var pair: Array = entry
		if is_instance_valid(pair[1]):
			(pair[1] as PanelContainer).add_theme_stylebox_override("panel", _stat_style(str((pair[0] as Array)[0])))


func _section_style(key: String) -> StyleBoxFlat:
	var dragged := not _drag_item.is_empty() and str(_drag_item.get("sectionKey", "")) == key and str(_drag_item.get("type", "")) == "section"
	return UI.box(Color(1, 1, 1, 0.03), Color(1, 1, 1, 0.23 if dragged else 0.08), 13, 1, Vector4(0, 0, 0, 0))


func _stat_style(key: String) -> StyleBoxFlat:
	var dragged := not _drag_item.is_empty() and str(_drag_item.get("statKey", "")) == key
	return UI.box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.24 if dragged else 0.07), 11, 1, Vector4(10, 10, 10, 10))


func _accept_drop(target: Control, can_drop: Callable, drop: Callable) -> void:
	target.set_drag_forwarding(Callable(), can_drop, drop)


func _key_text(node: RichTextLabel, prefix: String, key: String, tail: String) -> void:
	node.clear()
	node.add_text(prefix)
	node.push_font(UI.font(400, MONO))
	node.add_text(key)
	node.pop()
	node.add_text(tail)


func _key_line() -> RichTextLabel:
	var node := RichTextLabel.new()
	node.bbcode_enabled = false
	node.fit_content = true
	node.scroll_active = false
	node.autowrap_mode = TextServer.AUTOWRAP_ARBITRARY
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	node.add_theme_font_override("normal_font", UI.font(400))
	node.add_theme_font_size_override("normal_font_size", 10)
	node.add_theme_color_override("default_color", Color(1, 1, 1, 0.3))
	return node


func _handle(tip: String) -> Button:
	var handle := _icon_button("☰", tip)
	handle.mouse_default_cursor_shape = Control.CURSOR_DRAG
	return handle


func _section_card(section_index: int) -> Control:
	var section: Dictionary = _sections[section_index]
	var section_ref := [str(section.get("key", ""))]
	var stats: Array = section.get("stats", []) if section.get("stats") is Array else []
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", _section_style(str(section_ref[0])))
	card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_section_nodes.append([section_ref, card])
	var can_drop := func(_at: Vector2, data: Variant) -> bool:
		return data is Dictionary and (data as Dictionary).has("ohStat")
	var drop := func(_at: Vector2, data: Variant) -> void:
		var item: Dictionary = (data as Dictionary)["ohStat"]
		_drag_item = {}
		if str(item.get("type", "")) == "section":
			move_section(str(item.get("sectionKey", "")), str(section_ref[0]))
		elif str(item.get("type", "")) == "stat":
			move_stat(str(item.get("sectionKey", "")), str(item.get("statKey", "")), str(section_ref[0]))
		else:
			_restyle_drag()
	_accept_drop(card, can_drop, drop)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	column.mouse_filter = Control.MOUSE_FILTER_PASS
	card.add_child(column)
	var head := PanelContainer.new()
	head.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.03), Color(0, 0, 0, 0), 0, 0, Vector4(10, 10, 10, 10)))
	head.mouse_filter = Control.MOUSE_FILTER_PASS
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	row.mouse_filter = Control.MOUSE_FILTER_PASS
	var handle := _handle("Drag section")
	handle.set_drag_forwarding(func(_at: Vector2) -> Variant:
		var data := {"type": "section", "sectionKey": str(section_ref[0])}
		_drag_item = data
		handle.set_drag_preview(UI.label("☰ " + _section_label(str(section_ref[0])), 12, UI.WHITE, 700))
		_restyle_drag()
		return {"ohStat": data}, can_drop, drop)
	row.add_child(handle)
	var icon_text := str(section.get("icon", "")) if section.get("icon") != null else ""
	var icon := UI.label(icon_text if not icon_text.is_empty() else "◆", 14, UI.WHITE)
	icon.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(icon)
	var names := VBoxContainer.new()
	names.add_theme_constant_override("separation", 1)
	names.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	names.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var title := UI.label("", 12, Color(1, 1, 1, 0.9), 850, "Arial", 1)
	title.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	title.clip_text = true
	names.add_child(title)
	var meta := UI.label("", 9, Color(1, 1, 1, 0.28), 400, MONO)
	meta.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	meta.clip_text = true
	names.add_child(meta)
	row.add_child(names)
	var refresh_head := func() -> void:
		var index := _section_index(str(section_ref[0]))
		if index < 0 or not is_instance_valid(title):
			return
		var current: Dictionary = _sections[index]
		var count := (current.get("stats", []) as Array).size() if current.get("stats") is Array else 0
		title.text = str(current.get("label", "")).to_upper()
		var current_icon := str(current.get("icon", "")) if current.get("icon") != null else ""
		icon.text = current_icon if not current_icon.is_empty() else "◆"
		meta.text = "%s · %d stat%s" % [str(section_ref[0]), count, "" if count == 1 else "s"]
	refresh_head.call()
	var edit := _icon_button("✎", "Edit section")
	edit.pressed.connect(func() -> void:
		_editing_section = "" if _editing_section == str(section_ref[0]) else str(section_ref[0])
		_rebuild())
	_accept_drop(edit, can_drop, drop)
	row.add_child(edit)
	var only_one := _sections.size() <= 1
	var delete := _icon_button("🗑", "A custom sheet needs at least one section" if only_one else "Delete section", ROSE)
	delete.disabled = only_one
	delete.modulate.a = 0.4 if only_one else 1.0
	delete.pressed.connect(func() -> void: _remove_section(str(section_ref[0])))
	_accept_drop(delete, can_drop, drop)
	row.add_child(delete)
	head.add_child(row)
	column.add_child(head)
	if _editing_section == str(section_ref[0]):
		column.add_child(_section_editor(section_ref, refresh_head))
	var list_margin := MarginContainer.new()
	list_margin.mouse_filter = Control.MOUSE_FILTER_PASS
	for side in ["margin_left", "margin_right", "margin_top", "margin_bottom"]:
		list_margin.add_theme_constant_override(side, 9)
	var list := VBoxContainer.new()
	list.add_theme_constant_override("separation", 8)
	list.mouse_filter = Control.MOUSE_FILTER_PASS
	list_margin.add_child(list)
	for stat_index in range(stats.size()):
		list.add_child(_stat_row(section_ref, stats[stat_index]))
	var total := _total_stats()
	var full := stats.size() >= _max_per_section() or total >= _max_stats()
	var add := _button("+ Add statistic", true)
	add.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	add.disabled = full
	add.modulate.a = 0.45 if full else 1.0
	add.pressed.connect(func() -> void: _add_stat(str(section_ref[0])))
	_accept_drop(add, can_drop, drop)
	list.add_child(add)
	column.add_child(list_margin)
	return card


func _section_label(key: String) -> String:
	var index := _section_index(key)
	return str((_sections[index] as Dictionary).get("label", "")) if index >= 0 else ""


func _section_editor(section_ref: Array, refresh_head: Callable) -> Control:
	var index := _section_index(str(section_ref[0]))
	var section: Dictionary = _sections[index] if index >= 0 else {}
	var holder := VBoxContainer.new()
	holder.add_theme_constant_override("separation", 0)
	var line := ColorRect.new()
	line.color = Color(1, 1, 1, 0.06)
	line.custom_minimum_size.y = 1
	holder.add_child(line)
	var margin := MarginContainer.new()
	for side in ["margin_left", "margin_right", "margin_top", "margin_bottom"]:
		margin.add_theme_constant_override(side, 10)
	holder.add_child(margin)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 9)
	margin.add_child(column)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 9)
	var key_label := _key_line()
	_key_text(key_label, "Section key: ", str(section_ref[0]), "")
	var name_edit := _line_input(str(section.get("label", "")), 60, func(text: String) -> void:
		section_ref[0] = _patch_section(str(section_ref[0]), {"label": text})
		_key_text(key_label, "Section key: ", str(section_ref[0]), "")
		refresh_head.call()
		_refresh_counts())
	row.add_child(_field("Section name", name_edit))
	var icon_edit := _line_input(str(section.get("icon", "")) if section.get("icon") != null else "", 8, func(text: String) -> void:
		section_ref[0] = _patch_section(str(section_ref[0]), {"icon": text})
		refresh_head.call(), "", true)
	var icon_field := _field("Icon", icon_edit)
	icon_field.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	icon_field.custom_minimum_size.x = 80
	row.add_child(icon_field)
	column.add_child(row)
	column.add_child(key_label)
	return holder


func _stat_row(section_ref: Array, stat: Dictionary) -> Control:
	var stat_ref := [str(stat.get("key", ""))]
	var row := PanelContainer.new()
	row.add_theme_stylebox_override("panel", _stat_style(str(stat_ref[0])))
	row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_stat_nodes.append([stat_ref, row])
	var can_drop := func(_at: Vector2, data: Variant) -> bool:
		return data is Dictionary and (data as Dictionary).has("ohStat") and str(((data as Dictionary)["ohStat"] as Dictionary).get("type", "")) == "stat"
	var drop := func(_at: Vector2, data: Variant) -> void:
		var item: Dictionary = (data as Dictionary)["ohStat"]
		_drag_item = {}
		move_stat(str(item.get("sectionKey", "")), str(item.get("statKey", "")), str(section_ref[0]), str(stat_ref[0]))
	_accept_drop(row, can_drop, drop)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	column.mouse_filter = Control.MOUSE_FILTER_PASS
	row.add_child(column)
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 8)
	line.mouse_filter = Control.MOUSE_FILTER_PASS
	var handle := _handle("Drag to reorder or move to another section")
	handle.set_drag_forwarding(func(_at: Vector2) -> Variant:
		var data := {"type": "stat", "sectionKey": str(section_ref[0]), "statKey": str(stat_ref[0])}
		_drag_item = data
		var current := _stat_of(str(section_ref[0]), str(stat_ref[0]))
		handle.set_drag_preview(UI.label("☰ " + str(current.get("label", "")), 12, UI.WHITE, 700))
		_restyle_drag()
		return {"ohStat": data}, can_drop, drop)
	line.add_child(handle)
	var preview := _stat_preview(stat)
	line.add_child(preview["node"])
	var buttons := HBoxContainer.new()
	buttons.add_theme_constant_override("separation", 5)
	buttons.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	var edit := _icon_button("✎", "Edit")
	edit.pressed.connect(func() -> void:
		_editing_stat = "" if _editing_stat == str(stat_ref[0]) else str(stat_ref[0])
		_rebuild())
	_accept_drop(edit, can_drop, drop)
	buttons.add_child(edit)
	var total := _total_stats()
	var delete := _icon_button("🗑", "A custom sheet needs at least one statistic" if total <= 1 else "Delete", ROSE)
	delete.disabled = total <= 1
	delete.modulate.a = 0.4 if total <= 1 else 1.0
	delete.pressed.connect(func() -> void: _remove_stat(str(section_ref[0]), str(stat_ref[0])))
	_accept_drop(delete, can_drop, drop)
	buttons.add_child(delete)
	line.add_child(buttons)
	column.add_child(line)
	if _editing_stat == str(stat_ref[0]):
		column.add_child(_stat_editor(section_ref, stat_ref, stat, preview))
	return row


func _preview_value(stat: Dictionary) -> String:
	var kind := str(stat.get("kind", ""))
	var prefix := str(stat.get("prefix", "")) if stat.get("prefix") != null else ""
	var suffix := str(stat.get("suffix", "")) if stat.get("suffix") != null else ""
	var compact := _truthy(stat.get("compact"))
	if kind == "index":
		return "67/100"
	if kind == "percentage":
		return "%s42%s" % [prefix, suffix if not suffix.is_empty() else "%"]
	if kind == "currency":
		return "%s%s%s" % [prefix if not prefix.is_empty() else "¤", "4.2K" if compact else "4,200", suffix]
	return "%s%s%s" % [prefix, "18.6K" if compact else "18,600", (" " + suffix) if not suffix.is_empty() else ""]


func _stat_preview(stat: Dictionary) -> Dictionary:
	var holder := VBoxContainer.new()
	holder.add_theme_constant_override("separation", 0)
	holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 6)
	line.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var icon := UI.label("", 14, UI.WHITE)
	icon.custom_minimum_size.x = 18
	line.add_child(icon)
	var label := UI.label("", 12, Color(1, 1, 1, 0.91), 780)
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	label.clip_text = true
	line.add_child(label)
	var key := UI.label("", 9, Color(1, 1, 1, 0.28), 400, MONO)
	key.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	key.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	key.clip_text = true
	line.add_child(key)
	var value := UI.label("", 10, Color(1, 1, 1, 0.45), 800)
	value.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	line.add_child(value)
	holder.add_child(line)
	var bar_gap := EditorKit.gap(6)
	holder.add_child(bar_gap)
	var bar := ProgressBar.new()
	bar.show_percentage = false
	bar.min_value = 0
	bar.max_value = 100
	bar.value = 67
	bar.custom_minimum_size.y = 5
	bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	bar.add_theme_stylebox_override("background", UI.box(Color(1, 1, 1, 0.09), Color(0, 0, 0, 0), 999))
	holder.add_child(bar)
	var description_gap := EditorKit.gap(5)
	holder.add_child(description_gap)
	var description := UI.wrapped("", 10, Color(1, 1, 1, 0.4))
	description.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	holder.add_child(description)
	var parts := {"node": holder, "icon": icon, "label": label, "key": key, "value": value, "bar": bar, "bar_gap": bar_gap, "description": description, "description_gap": description_gap}
	_fill_preview(parts, stat)
	return parts


func _fill_preview(parts: Dictionary, stat: Dictionary) -> void:
	var icon_text := str(stat.get("icon", "")) if stat.get("icon") != null else ""
	(parts["icon"] as Label).text = icon_text if not icon_text.is_empty() else "◆"
	(parts["label"] as Label).text = str(stat.get("label", "")) if stat.get("label") != null else ""
	var key_label: Label = parts["key"]
	key_label.text = str(stat.get("key", "")) if stat.get("key") != null else ""
	var key_width := key_label.get_theme_font("font").get_string_size(key_label.text, HORIZONTAL_ALIGNMENT_LEFT, -1, 9).x
	key_label.custom_minimum_size.x = minf(112.0, ceilf(key_width) + 1.0)
	(parts["value"] as Label).text = _preview_value(stat)
	var is_index := str(stat.get("kind", "")) == "index"
	(parts["bar"] as ProgressBar).visible = is_index
	(parts["bar_gap"] as Control).visible = is_index
	var color_text := str(stat.get("color", "")) if stat.get("color") != null else ""
	var fill := EditorKit.color_of(color_text, Color(1, 1, 1, 0.22)) if not color_text.is_empty() else Color(1, 1, 1, 0.22)
	(parts["bar"] as ProgressBar).add_theme_stylebox_override("fill", UI.box(fill, Color(0, 0, 0, 0), 999))
	var description := str(stat.get("description", "")) if stat.get("description") != null else ""
	(parts["description"] as Label).text = description
	(parts["description"] as Label).visible = not description.is_empty()
	(parts["description_gap"] as Control).visible = not description.is_empty()


func _stat_of(section_key: String, stat_key: String) -> Dictionary:
	var index := _section_index(section_key)
	if index < 0:
		return {}
	for stat in (_sections[index] as Dictionary).get("stats", []):
		if str((stat as Dictionary).get("key", "")) == stat_key:
			return stat
	return {}


func _number_input(value: Variant, placeholder: String) -> LineEdit:
	return _line_input(EditorFeaturesModel.text_of(value) if value != null else "", 0, Callable(), placeholder)


func _stat_editor(section_ref: Array, stat_ref: Array, stat: Dictionary, preview: Dictionary) -> Control:
	var holder := VBoxContainer.new()
	holder.add_theme_constant_override("separation", 9)
	holder.add_child(EditorKit.gap(1))
	var line := ColorRect.new()
	line.color = Color(1, 1, 1, 0.07)
	line.custom_minimum_size.y = 1
	holder.add_child(line)
	var grid := GridContainer.new()
	grid.columns = 6
	grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	grid.add_theme_constant_override("h_separation", 9)
	grid.add_theme_constant_override("v_separation", 9)
	_grids.append(grid)
	holder.add_child(grid)
	var key_line := _key_line()
	var refresh := func() -> void:
		var latest := _stat_of(str(section_ref[0]), str(stat_ref[0]))
		if latest.is_empty() or not is_instance_valid(key_line):
			return
		_fill_preview(preview, latest)
		var tail := " · follows the name until the scenario is saved, then freezes" if _truthy(latest.get("isNew")) else " · frozen so renaming does not break campaign history"
		_key_text(key_line, "Machine key: ", str(latest.get("key", "")), tail)
	var patch := func(values: Dictionary, removes: Array) -> void:
		stat_ref[0] = _patch_stat(str(section_ref[0]), str(stat_ref[0]), values, removes)
		_restyle_drag()
		refresh.call()
		_refresh_counts()
	var name_edit := _line_input(str(stat.get("label", "")) if stat.get("label") != null else "", 60, func(text: String) -> void: patch.call({"label": text}, []))
	grid.add_child(_field("Name", name_edit))
	var kind_select := OptionButton.new()
	kind_select.focus_mode = Control.FOCUS_NONE
	kind_select.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	kind_select.custom_minimum_size.y = 34
	kind_select.clip_text = true
	kind_select.fit_to_longest_item = false
	kind_select.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	for state in ["normal", "hover", "pressed", "focus", "disabled"]:
		kind_select.add_theme_stylebox_override(state, _input_style(state == "hover" or state == "pressed"))
	kind_select.add_theme_font_override("font", UI.font(400))
	kind_select.add_theme_font_size_override("font_size", 12)
	kind_select.add_theme_color_override("font_color", INPUT_INK)
	kind_select.add_theme_color_override("font_hover_color", INPUT_INK)
	var current_kind := str(stat.get("kind", "")) if not str(stat.get("kind", "")).is_empty() else "index"
	for entry in STAT_KINDS:
		kind_select.add_item(str(entry[1]))
		kind_select.set_item_metadata(kind_select.item_count - 1, str(entry[0]))
		if str(entry[0]) == current_kind:
			kind_select.select(kind_select.item_count - 1)
	kind_select.item_selected.connect(func(index: int) -> void:
		patch.call({"kind": str(kind_select.get_item_metadata(index))}, [])
		_editing_stat = str(stat_ref[0])
		_rebuild())
	grid.add_child(_field("Type", kind_select))
	var icon_edit := _line_input(str(stat.get("icon", "")) if stat.get("icon") != null else "", 8, func(text: String) -> void: patch.call({"icon": text}, []), "", true)
	grid.add_child(_field("Icon", icon_edit))
	var color := ColorPickerButton.new()
	var color_text := str(stat.get("color", "")) if stat.get("color") != null else ""
	color.color = EditorKit.color_of(color_text if not color_text.is_empty() else "#94a3b8", Color("#94a3b8"))
	color.edit_alpha = false
	color.focus_mode = Control.FOCUS_NONE
	color.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	color.custom_minimum_size.y = 36
	color.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	for state in ["normal", "hover", "pressed", "focus", "hover_pressed", "disabled"]:
		color.add_theme_stylebox_override(state, UI.box(INPUT_BG, INPUT_BORDER, 9, 1, Vector4(3, 3, 3, 3)))
	color.color_changed.connect(func(value: Color) -> void: patch.call({"color": EditorKit.hex_of(value)}, []))
	grid.add_child(_field("Colour", color))
	if str(stat.get("kind", "")) != "index":
		var prefix := _line_input(str(stat.get("prefix", "")) if stat.get("prefix") != null else "", 12, func(text: String) -> void: patch.call({"prefix": text}, []), "€, $, £")
		grid.add_child(_field("Prefix", prefix))
		var suffix := _line_input(str(stat.get("suffix", "")) if stat.get("suffix") != null else "", 24, func(text: String) -> void: patch.call({"suffix": text}, []), "%, tonnes, ships")
		grid.add_child(_field("Suffix / unit", suffix))
		var decimals := _number_input(stat.get("decimals") if stat.get("decimals") != null else 0.0, "")
		decimals.text_changed.connect(func(text: String) -> void:
			if not EditorScriptedEvents.valid_number_text(text):
				return
			patch.call({"decimals": EditorFeaturesModel.js_number(text)}, [])
			if text.strip_edges().is_empty():
				decimals.text = "0"
				decimals.caret_column = 1)
		grid.add_child(_field("Decimals", decimals))
		var compact := CheckBox.new()
		compact.text = "Compact K/M/B/T"
		compact.button_pressed = _truthy(stat.get("compact"))
		compact.focus_mode = Control.FOCUS_NONE
		compact.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		compact.add_theme_font_override("font", UI.font(400))
		compact.add_theme_font_size_override("font_size", 11)
		for name in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color"]:
			compact.add_theme_color_override(name, Color(1, 1, 1, 0.58))
		compact.toggled.connect(func(on: bool) -> void: patch.call({"compact": on}, []))
		var compact_holder := VBoxContainer.new()
		compact_holder.alignment = BoxContainer.ALIGNMENT_END
		compact_holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		compact_holder.size_flags_vertical = Control.SIZE_FILL
		compact_holder.add_child(compact)
		grid.add_child(compact_holder)
		var minimum := _number_input(stat.get("minimum"), "unbounded")
		minimum.text_changed.connect(func(text: String) -> void:
			if not EditorScriptedEvents.valid_number_text(text):
				return
			if text.strip_edges().is_empty():
				patch.call({}, ["minimum"])
			else:
				patch.call({"minimum": EditorFeaturesModel.js_number(text)}, []))
		grid.add_child(_field("Minimum", minimum))
		var maximum := _number_input(stat.get("maximum"), "unbounded")
		maximum.text_changed.connect(func(text: String) -> void:
			if not EditorScriptedEvents.valid_number_text(text):
				return
			if text.strip_edges().is_empty():
				patch.call({}, ["maximum"])
			else:
				patch.call({"maximum": EditorFeaturesModel.js_number(text)}, []))
		grid.add_child(_field("Maximum", maximum))
	var description := VBoxContainer.new()
	description.add_theme_constant_override("separation", 4)
	description.add_child(_field_label("What it tracks / AI guidance"))
	var area := TextEdit.new()
	area.text = str(stat.get("description", "")) if stat.get("description") != null else ""
	area.placeholder_text = "Explain what this value means in this scenario and what kinds of events should move it."
	area.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	area.custom_minimum_size.y = 62
	area.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	area.add_theme_stylebox_override("normal", _input_style(false))
	area.add_theme_stylebox_override("focus", _input_style(true))
	area.add_theme_font_override("font", UI.font(400))
	area.add_theme_font_size_override("font_size", 12)
	area.add_theme_color_override("font_color", INPUT_INK)
	area.add_theme_color_override("font_placeholder_color", PLACEHOLDER)
	area.add_theme_color_override("caret_color", INPUT_INK)
	area.add_theme_color_override("background_color", Color(0, 0, 0, 0))
	area.text_changed.connect(func() -> void:
		if _guard:
			return
		var text := area.text
		if text.length() > 360:
			text = text.substr(0, 360)
			_guard = true
			area.text = text
			_guard = false
			area.set_caret_column(text.length())
		patch.call({"description": text}, []))
	description.add_child(area)
	holder.add_child(description)
	holder.add_child(key_line)
	refresh.call()
	return holder
