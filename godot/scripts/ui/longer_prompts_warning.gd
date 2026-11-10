class_name LongerPromptsWarning
extends Control

signal accepted
signal cancelled

const TEXT := "This scenario's prompts are longer than the built-in ones, so it will use a lot more tokens than other scenarios."

var _dialog: PanelContainer


func show_for(scenario_name: String) -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.55)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	dim.gui_input.connect(_on_dim)
	add_child(dim)
	var centre := CenterContainer.new()
	centre.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	centre.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(centre)
	_dialog = PanelContainer.new()
	_dialog.name = "LongerPrompts"
	var face := UI.box(UiTheme.pick("surface", Color("#12141a")), UiTheme.pick("line", Color(1, 1, 1, 0.09)), 16, 1, Vector4(17.6, 17.6, 17.6, 17.6))
	face.shadow_color = Color(0, 0, 0, 0.45)
	face.shadow_size = 16
	face.shadow_offset = Vector2(0, 14)
	_dialog.add_theme_stylebox_override("panel", face)
	_dialog.mouse_filter = Control.MOUSE_FILTER_STOP
	centre.add_child(_dialog)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	_dialog.add_child(column)
	column.add_child(UI.label("Longer prompts", 16, UI.WHITE, 800))
	column.add_child(EditorKit.gap(5.6))
	var named := UI.wrapped(scenario_name, 14, Color(1, 1, 1, 0.86), 700)
	named.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	column.add_child(named)
	column.add_child(EditorKit.gap(8))
	column.add_child(UI.wrapped(TEXT, 13, Color(1, 1, 1, 0.62)))
	column.add_child(EditorKit.gap(16))
	var buttons := VBoxContainer.new()
	buttons.add_theme_constant_override("separation", 7)
	for spec in [["Continue", true], ["Cancel", false]]:
		var button := Button.new()
		button.text = str(spec[0])
		button.focus_mode = Control.FOCUS_NONE
		button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		button.custom_minimum_size.y = 41.6
		var rest := UI.box(UiTheme.pick("overlay_card", Color(1, 1, 1, 0.06)), UiTheme.pick("line", Color(1, 1, 1, 0.12)), 9, 1, Vector4(16, 4, 16, 4))
		var lit := UI.box(UiTheme.pick("hover", Color(1, 1, 1, 0.1)), UiTheme.pick("line", Color(1, 1, 1, 0.2)), 9, 1, Vector4(16, 4, 16, 4))
		for state in [["normal", rest], ["focus", rest], ["disabled", rest], ["hover", lit], ["pressed", lit], ["hover_pressed", lit]]:
			button.add_theme_stylebox_override(state[0], state[1])
		button.add_theme_font_override("font", UI.font(600))
		button.add_theme_font_size_override("font_size", 13)
		for slot in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
			button.add_theme_color_override(slot, EditorKit.BUTTON_INK)
		button.pressed.connect(_answer.bind(bool(spec[1])))
		buttons.add_child(button)
	column.add_child(buttons)
	_fit()
	get_viewport().size_changed.connect(_fit)


func _fit() -> void:
	if is_instance_valid(_dialog):
		_dialog.custom_minimum_size.x = minf(430.0, get_viewport_rect().size.x * 0.92)


func _on_dim(event: InputEvent) -> void:
	if event is InputEventMouseButton and (event as InputEventMouseButton).pressed and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT:
		_answer(false)


func _answer(go: bool) -> void:
	if go:
		accepted.emit()
	else:
		cancelled.emit()
	queue_free()
