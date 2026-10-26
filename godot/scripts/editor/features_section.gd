class_name EditorFeaturesSection
extends VBoxContainer

signal details_changed(details: Dictionary)
signal value_changed(value: Variant)

const BUTTON_INK := Color(246 / 255.0, 246 / 255.0, 248 / 255.0, 0.92)

static var definitions := {}

var _engine: EngineLink
var _kind := "scenario"
var _features: Variant = {}
var _scenario_features: Variant = {}
var _world: Dictionary = {}
var _host: Node
var _current_date := ""
var _first_skip_ahead := true
var _built := false
var _building := false
var _refreshers: Array[Callable] = []
var _scripted: EditorScriptedEvents
var _options := {"polities": [], "institutions": [], "memberStatuses": [], "puppetKinds": []}
var _world_signature := ""
var _card: PanelContainer
var _cache: Dictionary = {}
var _guard := false


func setup(engine: EngineLink, props: Dictionary) -> void:
	_engine = engine
	add_theme_constant_override("separation", 0)
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_read(props)
	_start()


func update_props(props: Dictionary) -> void:
	var kind_before := _kind
	var value_before := JSON.stringify(_features)
	_read(props)
	if not _built:
		return
	if kind_before != _kind:
		_rebuild()
		return
	if props.has("details") and _signature_of(_world) != _world_signature:
		_load_options()
	_cache = {}
	if JSON.stringify(_features) != value_before or props.has("scenarioFeatures"):
		_refresh()


func is_ready() -> bool:
	return _built


func current_value() -> Variant:
	return _features


func scripted_editor() -> EditorScriptedEvents:
	return _scripted


func _read(props: Dictionary) -> void:
	if props.has("kind"):
		_kind = str(props["kind"])
	if props.has("value"):
		_features = props["value"] if props["value"] != null else {}
	if props.has("scenarioFeatures"):
		_scenario_features = props["scenarioFeatures"] if props["scenarioFeatures"] != null else {}
	if props.has("details"):
		var details: Dictionary = props["details"] if props["details"] is Dictionary else {}
		var data: Dictionary = details.get("data", {}) if details.get("data") is Dictionary else {}
		_world = data.get("world", {}) if data.get("world") is Dictionary else {}
	if props.has("world") and props["world"] is Dictionary:
		_world = props["world"]
	if props.has("currentDate"):
		_current_date = str(props["currentDate"])
	if props.has("firstSkipAhead"):
		_first_skip_ahead = bool(props["firstSkipAhead"])
	if props.has("host"):
		_host = props["host"]
	if not props.has("scenarioFeatures") and _kind == "scenario" and props.has("value"):
		_scenario_features = _features


func _signature_of(world: Dictionary) -> String:
	return "%d:%d:%d" % [JSON.stringify(world.get("ownerCodes", [])).hash(), JSON.stringify(world.get("polityOverrides", {})).hash(), JSON.stringify(world.get("institutions", {})).hash()]


func _start() -> void:
	if definitions.is_empty():
		var reply := await _engine.request("editor.rules.definitions")
		if reply.get("ok", false) and reply.get("result") is Dictionary:
			definitions = reply["result"]
	if not is_inside_tree():
		return
	if definitions.is_empty():
		add_child(EditorKit.note("The features could not be read from the game engine."))
		return
	_options["memberStatuses"] = definitions.get("memberStatuses", [])
	_options["puppetKinds"] = definitions.get("puppetKinds", [])
	await _load_options()
	_rebuild()


func _load_options() -> void:
	_world_signature = _signature_of(_world)
	var reply := await _engine.request("editor.rules.scriptedOptions", {"world": _world})
	if reply.get("ok", false) and reply.get("result") is Dictionary:
		var result: Dictionary = reply["result"]
		_options["polities"] = result.get("polities", [])
		_options["institutions"] = result.get("institutions", [])
	if _scripted and is_instance_valid(_scripted):
		_scripted.update_props({"options": _options})


func _defs() -> Array:
	return definitions.get("features", [])


func _is_game() -> bool:
	return _kind == "game"


func _derive() -> Dictionary:
	if not _cache.is_empty():
		return _cache
	var defs := _defs()
	var base := EditorFeaturesModel.normalize_settings(_scenario_features, defs)
	var effective := EditorFeaturesModel.resolve(_scenario_features, _features, defs) if _is_game() else EditorFeaturesModel.normalize_settings(_features, defs)
	var overrides: Dictionary = (_features if _features is Dictionary else {}) if _is_game() else effective
	_cache = {"base": base, "effective": effective, "overrides": overrides}
	return _cache


func _set_feature(key: String, patch: Dictionary, removes: Array = []) -> void:
	_cache = {}
	var derived := _derive()
	var next: Dictionary
	if not _is_game():
		var effective: Dictionary = derived["effective"]
		next = effective.duplicate()
		var entry: Dictionary = (effective[key] as Dictionary).duplicate()
		for field in patch:
			entry[field] = patch[field]
		for field in removes:
			entry.erase(field)
		next[key] = entry
	else:
		var overrides: Dictionary = derived["overrides"]
		var current: Dictionary = (overrides.get(key, {}) as Dictionary).duplicate() if overrides.get(key) is Dictionary else {}
		for field in patch:
			current[field] = patch[field]
		for field in removes:
			current.erase(field)
		next = overrides.duplicate()
		if not current.is_empty():
			next[key] = current
		else:
			next.erase(key)
	_features = next
	if _kind == "scenario":
		_scenario_features = next
	_cache = {}
	value_changed.emit(next)
	_refresh()


func _refresh() -> void:
	_cache = {}
	for refresher in _refreshers:
		refresher.call()


func _rebuild() -> void:
	if _building:
		return
	_building = true
	EditorKit.clear(self)
	_refreshers.clear()
	_scripted = null
	_card = PanelContainer.new()
	_card.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.03), Color(1, 1, 1, 0.08), 18, 1, Vector4(14, 14, 14, 14)))
	_card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	_card.add_child(column)
	var intro := "What this game plays with. Anything left on the scenario default follows the scenario, including changes made to it later; On and Off are this game's own choice." if _is_game() else "What games made from this scenario play with. Each game can override these in its own editor."
	var intro_label := UI.wrapped(intro, 13, Color(1, 1, 1, 0.58))
	intro_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.add_child(intro_label)
	column.add_child(EditorKit.gap(14))
	var grid := VBoxContainer.new()
	grid.add_theme_constant_override("separation", 11)
	column.add_child(grid)
	for definition in _defs():
		grid.add_child(_feature_card(definition))
	add_child(_card)
	add_child(EditorKit.gap(15))
	_built = true
	_building = false
	_refresh()


func _choice_button(text: String) -> Button:
	var node := Button.new()
	node.text = text
	node.focus_mode = Control.FOCUS_NONE
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	node.custom_minimum_size.y = 32
	node.add_theme_font_override("font", UI.font(600))
	node.add_theme_font_size_override("font_size", 13)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color", "font_disabled_color"]:
		node.add_theme_color_override(name, BUTTON_INK)
	_style_choice(node, false)
	return node


func _style_choice(node: Button, active: bool, small := false) -> void:
	var bg := Color(0, 0, 0, 0.42) if active else Color(1, 1, 1, 0.04)
	var border := Color(1, 1, 1, 0.25) if active else Color(1, 1, 1, 0.1)
	var pad := 9.0 if small else 11.0
	var normal := UI.box(bg, border, 9, 1, Vector4(pad, 2, pad, 2))
	var hover := UI.box(Color(bg.r, bg.g, bg.b, minf(1.0, bg.a + 0.05)), Color(1, 1, 1, minf(1.0, border.a + 0.1)), 9, 1, Vector4(pad, 2, pad, 2))
	for state in [["normal", normal], ["hover", hover], ["pressed", hover], ["hover_pressed", hover], ["focus", normal], ["disabled", normal]]:
		node.add_theme_stylebox_override(state[0], state[1])
	if small:
		node.custom_minimum_size.y = 27


func _feature_value(derived: Dictionary, part: String, key: String) -> Dictionary:
	var table: Dictionary = derived[part]
	return table.get(key, {}) if table.get(key) is Dictionary else {}


func _feature_card(definition_input: Variant) -> Control:
	var definition: Dictionary = definition_input
	var key := str(definition["key"])
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.03), Color(1, 1, 1, 0.08), 14, 1, Vector4(12, 11, 12, 11)))
	card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	card.add_child(column)
	var top := HBoxContainer.new()
	top.add_theme_constant_override("separation", 10)
	var texts := VBoxContainer.new()
	texts.add_theme_constant_override("separation", 2)
	texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	texts.add_child(UI.label(str(definition.get("label", "")), 14, UI.WHITE, 600))
	var description := UI.wrapped(str(definition.get("description", "")), 12, Color(1, 1, 1, 0.58))
	description.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	texts.add_child(description)
	top.add_child(texts)
	if definition.get("toggleable", true) != false:
		var buttons := HBoxContainer.new()
		buttons.add_theme_constant_override("separation", 6)
		buttons.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
		var default_button: Button = null
		if _is_game():
			default_button = _choice_button("")
			default_button.pressed.connect(func() -> void: _set_feature(key, {}, ["enabled"]))
			buttons.add_child(default_button)
		var on_button := _choice_button("On")
		on_button.pressed.connect(func() -> void: _set_feature(key, {"enabled": true}))
		buttons.add_child(on_button)
		var off_button := _choice_button("Off")
		off_button.pressed.connect(func() -> void: _set_feature(key, {"enabled": false}))
		buttons.add_child(off_button)
		top.add_child(buttons)
		_refreshers.append(func() -> void:
			if not is_instance_valid(on_button):
				return
			var derived := _derive()
			var override := _feature_value(derived, "overrides", key)
			var state := ""
			if not _is_game():
				state = "on" if bool(_feature_value(derived, "effective", key).get("enabled", true)) else "off"
			else:
				var enabled: Variant = override.get("enabled") if override.has("enabled") else null
				state = "default" if enabled == null else ("on" if bool(enabled) else "off")
			_style_choice(on_button, state == "on")
			_style_choice(off_button, state == "off")
			if default_button:
				var says := "On" if bool(_feature_value(derived, "base", key).get("enabled", true)) else "Off"
				default_button.text = "Scenario default (%s)" % says
				_style_choice(default_button, state == "default"))
	column.add_child(top)
	var settings: Array = definition.get("settings", [])
	if not settings.is_empty():
		column.add_child(EditorKit.gap(10))
		var list := VBoxContainer.new()
		list.add_theme_constant_override("separation", 10)
		for item in settings:
			var setting: Dictionary = item
			var type := str(setting.get("type", ""))
			if type == "scripted-events":
				list.add_child(_scripted_row(key, setting))
			elif type == "choice":
				list.add_child(_choice_row(key, setting))
			elif type == "text":
				list.add_child(_text_row(key, setting))
			else:
				list.add_child(_number_row(key, setting))
		column.add_child(list)
	return card


func _setting_description(text: String) -> Label:
	var node := UI.wrapped(text, 12, Color(1, 1, 1, 0.5))
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


func _row_column(label: String) -> VBoxContainer:
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.add_child(EditorKit.field_label(label))
	column.add_child(EditorKit.gap(7))
	return column


func _partial_number(text: String) -> bool:
	return RegEx.create_from_string("^[+-]?\\d*\\.?\\d*([eE][+-]?\\d*)?$").search(text.strip_edges()) != null


func _number_differs(text: String, shown: String) -> bool:
	if text == shown:
		return false
	if shown.is_empty():
		return not (text.strip_edges().is_empty() or (not EditorScriptedEvents.valid_number_text(text) and _partial_number(text)))
	if not EditorScriptedEvents.valid_number_text(text):
		return not _partial_number(text)
	return text.strip_edges().is_empty() or EditorFeaturesModel.js_number(text) != EditorFeaturesModel.js_number(shown)


func _scripted_row(key: String, setting: Dictionary) -> Control:
	var setting_key := str(setting["key"])
	var column := _row_column(str(setting.get("label", "")))
	var editor := EditorScriptedEvents.new()
	column.add_child(editor)
	_scripted = editor
	editor.setup(_engine, _scripted_props(key, setting_key))
	editor.value_changed.connect(func(next: Variant) -> void: _set_feature(key, {setting_key: next}))
	editor.use_scenario_default.connect(func() -> void: _set_feature(key, {}, [setting_key]))
	editor.start_override.connect(func() -> void:
		var scenario_events := EditorFeaturesModel.normalize_scripted_events(_feature_value(_derive(), "base", key).get(setting_key))
		_set_feature(key, {setting_key: scenario_events.duplicate(true)}))
	column.add_child(EditorKit.gap(5))
	column.add_child(_setting_description(str(setting.get("description", ""))))
	_refreshers.append(func() -> void:
		if is_instance_valid(editor):
			editor.update_props(_scripted_props(key, setting_key)))
	return column


func _scripted_props(key: String, setting_key: String) -> Dictionary:
	var derived := _derive()
	var base := _feature_value(derived, "base", key)
	var scenario_events := EditorFeaturesModel.normalize_scripted_events(base.get(setting_key))
	var override := _feature_value(derived, "overrides", key)
	var raw: Variant = null
	if _features is Dictionary and (_features as Dictionary).get(key) is Dictionary:
		raw = ((_features as Dictionary)[key] as Dictionary).get(setting_key)
	var shown: Array = []
	if raw is Array:
		shown = raw
	else:
		var fallback: Variant = raw
		if fallback == null:
			fallback = scenario_events if _is_game() else _feature_value(derived, "effective", key).get(setting_key)
		shown = EditorFeaturesModel.normalize_scripted_events(fallback)
	var overridden := _is_game() and override.has(setting_key) and override.get(setting_key) != null
	return {
		"value": shown,
		"scenarioValue": scenario_events,
		"isGame": _is_game(),
		"overridden": (not _is_game()) or overridden,
		"world": _world,
		"host": _host,
		"options": _options,
	}


func _choice_row(key: String, setting: Dictionary) -> Control:
	var setting_key := str(setting["key"])
	var column := _row_column(str(setting.get("label", "")))
	var flow := EditorKit.flow(6)
	var default_button: Button = null
	if _is_game():
		default_button = _choice_button("")
		default_button.pressed.connect(func() -> void: _set_feature(key, {}, [setting_key]))
		flow.add_child(default_button)
	var option_buttons: Array[Button] = []
	var options: Array = setting.get("options", [])
	for item in options:
		var option: Dictionary = item
		var button := _choice_button(str(option.get("label", "")))
		var value := str(option.get("value", ""))
		button.pressed.connect(func() -> void: _set_feature(key, {setting_key: value}))
		flow.add_child(button)
		option_buttons.append(button)
	column.add_child(flow)
	column.add_child(EditorKit.gap(5))
	var description := _setting_description("")
	column.add_child(description)
	_refreshers.append(func() -> void:
		if not is_instance_valid(description):
			return
		var derived := _derive()
		var base := _feature_value(derived, "base", key)
		var effective := _feature_value(derived, "effective", key)
		var override := _feature_value(derived, "overrides", key)
		var scenario_choice := EditorFeaturesModel.text_of(base.get(setting_key) if base.get(setting_key) != null else setting.get("defaultValue"))
		var scenario_label := scenario_choice
		for entry in options:
			if str((entry as Dictionary).get("value", "")) == scenario_choice:
				scenario_label = str((entry as Dictionary).get("label", ""))
		var overridden := _is_game() and override.has(setting_key) and override.get(setting_key) != null
		var selected := ""
		if _is_game():
			selected = EditorFeaturesModel.text_of(override.get(setting_key)) if overridden else ""
		else:
			selected = EditorFeaturesModel.text_of(effective.get(setting_key)) if effective.get(setting_key) != null else ""
		if default_button:
			default_button.text = "Scenario default (%s)" % scenario_label
			_style_choice(default_button, not overridden)
		var shown: Dictionary = {}
		for index in range(options.size()):
			var entry: Dictionary = options[index]
			var value := str(entry.get("value", ""))
			var active := selected == value or (not _is_game() and effective.get(setting_key) is String and str(effective.get(setting_key)) == value)
			_style_choice(option_buttons[index], active)
			if value == (selected if not selected.is_empty() else scenario_choice):
				shown = entry
		var prefix := ""
		if not str(shown.get("description", "")).is_empty():
			prefix = "%s: %s " % [str(shown.get("label", "")), str(shown.get("description", ""))]
		description.text = prefix + str(setting.get("description", "")))
	return column


func _text_row(key: String, setting: Dictionary) -> Control:
	var setting_key := str(setting["key"])
	var limit := int(setting.get("maxLength", 0))
	if limit <= 0:
		limit = 2000
	var rows := int(setting.get("rows", 0))
	if rows <= 0:
		rows = 4
	var column := _row_column(str(setting.get("label", "")))
	var area := EditorKit.area("", maxf(80.0, rows * 21.0 + 22.0), Callable())
	area.scroll_fit_content_height = false
	column.add_child(area)
	area.text_changed.connect(func() -> void:
		if _guard:
			return
		var raw := area.text
		if raw.length() > limit:
			var caret_line := area.get_caret_line()
			var caret_column := area.get_caret_column()
			raw = raw.substr(0, limit)
			_guard = true
			area.text = raw
			_guard = false
			area.set_caret_line(caret_line)
			area.set_caret_column(caret_column)
		if _is_game() and raw.strip_edges().is_empty():
			_set_feature(key, {}, [setting_key])
		else:
			_set_feature(key, {setting_key: raw}))
	var status_row := HBoxContainer.new()
	status_row.add_theme_constant_override("separation", 8)
	var status := UI.label("", 12, Color(1, 1, 1, 0.45))
	status.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	status_row.add_child(status)
	var reset := _choice_button("Use scenario default")
	_style_choice(reset, false, true)
	reset.pressed.connect(func() -> void: _set_feature(key, {}, [setting_key]))
	status_row.add_child(reset)
	var status_gap := EditorKit.gap(5)
	status_gap.visible = _is_game()
	column.add_child(status_gap)
	status_row.visible = _is_game()
	column.add_child(status_row)
	column.add_child(EditorKit.gap(5))
	column.add_child(_setting_description(str(setting.get("description", ""))))
	_refreshers.append(func() -> void:
		if not is_instance_valid(area):
			return
		var derived := _derive()
		var base := _feature_value(derived, "base", key)
		var effective := _feature_value(derived, "effective", key)
		var override := _feature_value(derived, "overrides", key)
		var overridden := _is_game() and override.has(setting_key) and override.get(setting_key) != null
		var value: Variant = (override.get(setting_key) if overridden else "") if _is_game() else effective.get(setting_key)
		var typed: Variant = null
		if _features is Dictionary and (_features as Dictionary).get(key) is Dictionary:
			typed = ((_features as Dictionary)[key] as Dictionary).get(setting_key)
		var shown := str(typed) if typed is String else EditorFeaturesModel.text_of(value) if value != null else ""
		if area.text != shown:
			var caret_line := area.get_caret_line()
			var caret_column := area.get_caret_column()
			_guard = true
			area.text = shown
			_guard = false
			area.set_caret_line(mini(caret_line, area.get_line_count() - 1))
			area.set_caret_column(caret_column)
		var scenario_text := EditorFeaturesModel.text_of(base.get(setting_key)) if base.get(setting_key) != null else ""
		area.placeholder_text = (scenario_text if not scenario_text.is_empty() else "Following the scenario, which sets none") if _is_game() else ""
		status.text = "This game's own rules replace the scenario's." if overridden else "Following the scenario"
		reset.visible = overridden)
	return column


func _number_row(key: String, setting: Dictionary) -> Control:
	var setting_key := str(setting["key"])
	var column := _row_column(str(setting.get("label", "")))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	var edit := EditorKit.line("", "", Callable())
	edit.custom_minimum_size.x = 112
	edit.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	row.add_child(edit)
	var unit := UI.label(str(setting.get("unit", "")), 13, Color(1, 1, 1, 0.58))
	unit.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(unit)
	var status := UI.label("", 12, Color(1, 1, 1, 0.45))
	status.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	status.visible = _is_game()
	row.add_child(status)
	var reset := _choice_button("Use scenario default")
	_style_choice(reset, false, true)
	reset.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	reset.pressed.connect(func() -> void: _set_feature(key, {}, [setting_key]))
	row.add_child(reset)
	column.add_child(row)
	column.add_child(EditorKit.gap(5))
	column.add_child(_setting_description(str(setting.get("description", ""))))
	edit.text_changed.connect(func(text: String) -> void:
		var raw := text if EditorScriptedEvents.valid_number_text(text) else ""
		if _is_game() and raw.is_empty():
			_set_feature(key, {}, [setting_key])
			return
		if not _is_game():
			_set_feature(key, {setting_key: raw})
			return
		var next := EditorFeaturesModel.js_number(raw)
		if EditorFeaturesModel.is_finite_number(next):
			_set_feature(key, {setting_key: next}))
	edit.focus_exited.connect(func() -> void:
		if not is_inside_tree() or not is_visible_in_tree():
			return
		var derived := _derive()
		var effective := _feature_value(derived, "effective", key)
		var override := _feature_value(derived, "overrides", key)
		var typed: Variant = null
		if not _is_game() and _features is Dictionary and (_features as Dictionary).get(key) is Dictionary:
			typed = ((_features as Dictionary)[key] as Dictionary).get(setting_key)
		var overridden := _is_game() and override.has(setting_key) and override.get(setting_key) != null
		if not _is_game() and typed is String:
			_set_feature(key, {setting_key: effective.get(setting_key)})
		elif overridden and not _same_number(effective.get(setting_key), override.get(setting_key)):
			_set_feature(key, {setting_key: effective.get(setting_key)})
		_refresh())
	_refreshers.append(func() -> void:
		if not is_instance_valid(edit):
			return
		var derived := _derive()
		var base := _feature_value(derived, "base", key)
		var effective := _feature_value(derived, "effective", key)
		var override := _feature_value(derived, "overrides", key)
		var overridden := _is_game() and override.has(setting_key) and override.get(setting_key) != null
		var value: Variant = (override.get(setting_key) if overridden else "") if _is_game() else effective.get(setting_key)
		var typed: Variant = null
		if not _is_game() and _features is Dictionary and (_features as Dictionary).get(key) is Dictionary:
			typed = ((_features as Dictionary)[key] as Dictionary).get(setting_key)
		var shown := str(typed) if typed is String else (EditorFeaturesModel.text_of(value) if value != null else "")
		if _number_differs(edit.text, shown):
			var caret := edit.caret_column
			edit.text = shown
			edit.caret_column = mini(caret, shown.length())
		edit.placeholder_text = EditorFeaturesModel.text_of(base.get(setting_key)) if _is_game() else ""
		status.text = ("Scenario default: %s" % EditorFeaturesModel.text_of(base.get(setting_key))) if overridden else "Following the scenario"
		reset.visible = overridden)
	return column


func _same_number(left: Variant, right: Variant) -> bool:
	if (left is float or left is int) and (right is float or right is int):
		return float(left) == float(right)
	return typeof(left) == typeof(right) and left == right
