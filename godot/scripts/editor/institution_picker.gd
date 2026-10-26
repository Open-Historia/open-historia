class_name InstitutionPolityPicker
extends VBoxContainer

signal chosen(name: String)

var _polities: Array = []
var _label := ""
var _allow_unlisted := false
var _input: LineEdit
var _results: PanelContainer
var _results_list: VBoxContainer
var _open := false


func setup(label: String, allow_unlisted: bool) -> void:
	_label = label
	_allow_unlisted = allow_unlisted
	add_theme_constant_override("separation", 4)
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var frame := PanelContainer.new()
	frame.add_theme_stylebox_override("panel", UI.box(Color(8 / 255.0, 8 / 255.0, 12 / 255.0, 0.72), Color(1, 1, 1, 0.1), 8, 1, Vector4(6, 4, 6, 4)))
	_input = LineEdit.new()
	_input.placeholder_text = label
	_input.custom_minimum_size.y = 26
	_input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var empty := StyleBoxEmpty.new()
	for state in ["normal", "focus", "read_only"]:
		_input.add_theme_stylebox_override(state, empty)
	_input.add_theme_font_override("font", UI.font(400))
	_input.add_theme_font_size_override("font_size", 11)
	_input.add_theme_color_override("font_color", Color(1, 1, 1, 0.86))
	_input.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.38))
	_input.add_theme_color_override("caret_color", UI.WHITE)
	_input.text_changed.connect(func(_value: String) -> void:
		_open = true
		_render())
	_input.focus_entered.connect(func() -> void:
		_open = true
		_render())
	_input.focus_exited.connect(func() -> void:
		await get_tree().create_timer(0.12).timeout
		if is_instance_valid(self) and not _input.has_focus():
			_open = false
			_render())
	_input.text_submitted.connect(func(_value: String) -> void: _choose_first())
	_input.gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventKey and (event as InputEventKey).pressed and (event as InputEventKey).keycode == KEY_ESCAPE:
			_open = false
			_render()
			_input.accept_event())
	frame.add_child(_input)
	add_child(frame)
	_results = PanelContainer.new()
	_results.add_theme_stylebox_override("panel", UI.box(Color(20 / 255.0, 20 / 255.0, 25 / 255.0, 0.985), PoliticalKit.GREY_BORDER, 9, 1, Vector4(4, 4, 4, 4)))
	_results_list = VBoxContainer.new()
	_results_list.add_theme_constant_override("separation", 0)
	_results.add_child(_results_list)
	_results.visible = false
	add_child(_results)


func set_polities(polities: Array) -> void:
	_polities = polities
	_render()


func _query() -> String:
	return _input.text.strip_edges().to_lower() if _input else ""


func _matches() -> Array:
	var needle := _query()
	var found: Array = []
	for entry in _polities:
		var polity := str(entry)
		if needle.is_empty() or polity.to_lower().contains(needle):
			found.append(polity)
	found.sort_custom(func(a: Variant, b: Variant) -> bool:
		var a_starts := 0 if not needle.is_empty() and str(a).to_lower().begins_with(needle) else 1
		var b_starts := 0 if not needle.is_empty() and str(b).to_lower().begins_with(needle) else 1
		if a_starts != b_starts:
			return a_starts < b_starts
		return str(a).strip_edges().nocasecmp_to(str(b).strip_edges()) < 0)
	return found.slice(0, 8)


func _choose(polity: String) -> void:
	var exact := polity.strip_edges()
	if exact.is_empty():
		return
	chosen.emit(exact)
	_input.text = ""
	_open = false
	_render()


func _choose_first() -> void:
	var needle := _query()
	var candidate := ""
	for entry in _polities:
		if str(entry).to_lower() == needle:
			candidate = str(entry)
			break
	if candidate.is_empty():
		var found := _matches()
		if not found.is_empty():
			candidate = str(found[0])
		elif _allow_unlisted:
			candidate = _input.text
	if not candidate.is_empty():
		_choose(candidate)


func _render() -> void:
	if not _results_list:
		return
	EditorKit.clear(_results_list)
	var found := _matches()
	var typed := _input.text
	if _open and not found.is_empty():
		for entry in found:
			var polity := str(entry)
			var row := Button.new()
			row.focus_mode = Control.FOCUS_NONE
			row.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
			row.alignment = HORIZONTAL_ALIGNMENT_LEFT
			row.text = "●  " + polity
			row.custom_minimum_size.y = 28
			row.add_theme_font_override("font", UI.font(400))
			row.add_theme_font_size_override("font_size", 10)
			for state in ["font_color", "font_focus_color"]:
				row.add_theme_color_override(state, Color(1, 1, 1, 0.82))
			row.add_theme_color_override("font_hover_color", UI.WHITE)
			row.add_theme_stylebox_override("normal", UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 7, 0, Vector4(8, 0, 8, 0)))
			row.add_theme_stylebox_override("hover", UI.box(Color(1, 1, 1, 0.07), Color(0, 0, 0, 0), 7, 0, Vector4(8, 0, 8, 0)))
			row.add_theme_stylebox_override("pressed", UI.box(Color(1, 1, 1, 0.07), Color(0, 0, 0, 0), 7, 0, Vector4(8, 0, 8, 0)))
			row.add_theme_stylebox_override("focus", UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 7, 0, Vector4(8, 0, 8, 0)))
			row.button_down.connect(func() -> void: _choose(polity))
			_results_list.add_child(row)
		_results.visible = true
	elif _open and not typed.is_empty():
		var message := "No polity in this scenario matches “%s”. Press Enter to add it as written." % typed if _allow_unlisted else "No canonical polity matches “%s”." % typed
		var label := UI.wrapped(message, 10, Color(1, 1, 1, 0.38))
		var margin := MarginContainer.new()
		for side in [["margin_left", 6], ["margin_right", 6], ["margin_top", 5], ["margin_bottom", 5]]:
			margin.add_theme_constant_override(side[0], side[1])
		margin.add_child(label)
		_results_list.add_child(margin)
		_results.visible = true
	else:
		_results.visible = false
