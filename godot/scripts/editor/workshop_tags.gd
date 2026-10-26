class_name WorkshopTags
extends VBoxContainer

signal tags_changed(values: Array)

var values: Array = []
var suggestions: Array = []
var _chips: HFlowContainer
var _edit: LineEdit
var _hints: HFlowContainer


func _init(start: Array = [], suggestion_list: Array = [], placeholder := "add a tag…") -> void:
	values = start.duplicate()
	suggestions = suggestion_list
	add_theme_constant_override("separation", 4)
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_chips = HFlowContainer.new()
	_chips.add_theme_constant_override("h_separation", 4)
	_chips.add_theme_constant_override("v_separation", 4)
	add_child(_chips)
	_edit = WorkshopUI.input("", placeholder, Callable(), 12.0, 28.0)
	_edit.text_changed.connect(_on_text)
	_edit.text_submitted.connect(func(text: String) -> void: commit(text))
	_edit.focus_exited.connect(func() -> void:
		if not _edit.text.strip_edges().is_empty():
			commit(_edit.text))
	_edit.gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventKey and (event as InputEventKey).pressed and (event as InputEventKey).keycode == KEY_BACKSPACE and _edit.text.is_empty() and not values.is_empty():
			var next := values.duplicate()
			next.pop_back()
			_set(next))
	add_child(_edit)
	_hints = HFlowContainer.new()
	_hints.add_theme_constant_override("h_separation", 4)
	_hints.add_theme_constant_override("v_separation", 4)
	_hints.visible = false
	add_child(_hints)
	_render()


func set_values(next: Array) -> void:
	values = next.duplicate()
	_render()


func set_placeholder(text: String) -> void:
	_edit.placeholder_text = text


func commit(raw: String) -> void:
	var parts: Array = []
	for piece in raw.split(","):
		var text := piece.strip_edges()
		if not text.is_empty():
			parts.append(text)
	_edit.text = ""
	_hints.visible = false
	if parts.is_empty():
		return
	var next := values.duplicate()
	next.append_array(parts)
	_set(next)


func _set(next: Array) -> void:
	values = next
	_render()
	tags_changed.emit(values.duplicate())


func _on_text(text: String) -> void:
	if text.contains(","):
		commit(text)
		return
	WorkshopUI.clear(_hints)
	var query := text.strip_edges().to_lower()
	if query.is_empty():
		_hints.visible = false
		return
	var shown := 0
	for suggestion in suggestions:
		var option := str(suggestion)
		if not option.to_lower().contains(query) or values.has(option):
			continue
		var chip := WorkshopUI.pill(option)
		chip.custom_minimum_size.y = 22
		chip.add_theme_font_size_override("font_size", 11)
		chip.pressed.connect(func() -> void: commit(option))
		_hints.add_child(chip)
		shown += 1
		if shown >= 8:
			break
	_hints.visible = shown > 0


func _render() -> void:
	WorkshopUI.clear(_chips)
	_chips.visible = not values.is_empty()
	for value in values:
		var tag := str(value)
		var chip := PanelContainer.new()
		chip.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.11), Color(1, 1, 1, 0.25), 999, 1, Vector4(7, 1, 3, 1)))
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 2)
		row.add_child(UI.label(tag, 11, Color(1, 1, 1)))
		var remove := WorkshopUI.base_button("×")
		var clear := StyleBoxEmpty.new()
		for state_name in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
			remove.add_theme_stylebox_override(state_name, clear)
		WorkshopUI._ink(remove, Color(1, 1, 1, 0.7), 13.0, 400)
		remove.tooltip_text = "Remove %s" % tag
		remove.custom_minimum_size = Vector2(14, 16)
		remove.pressed.connect(func() -> void:
			var next := values.duplicate()
			next.erase(tag)
			_set(next))
		row.add_child(remove)
		chip.add_child(row)
		_chips.add_child(chip)
