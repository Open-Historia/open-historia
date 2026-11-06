class_name ThemeSettings
extends VBoxContainer

const ORIGINAL_PREVIEW := {"background": "#131315", "surface": "#232327", "accent": "#4B91FF"}
const FIELDS := [["background", "Background"], ["surface", "Surface"], ["accent", "Accent"]]
const SURFACE := Color("#20364A")
const LINE := Color("#486278")
const ACTIVE := Color("#2D5268")
const HOVER := Color("#29465B")
const ACCENT := Color("#85CBE6")
const INK := Color("#EEF3F7")
const MUTED := Color("#B4C4D0")
const FIELD_BG := Color("#111D2A")
const ERROR := Color("#F7B2A6")

var _drafts := {}
var _errors := {}
var _typing := false
var _error_labels := {}
var _stale := false


func _ready() -> void:
	add_theme_constant_override("separation", 13)
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	UiTheme.events().changed.connect(_render)
	_render()


func _exit_tree() -> void:
	if UiTheme.events().changed.is_connected(_render):
		UiTheme.events().changed.disconnect(_render)


func _render() -> void:
	if _typing:
		_stale = true
		return
	_stale = false
	for child in get_children():
		remove_child(child)
		child.queue_free()
	add_child(_text("Keep the original interface or choose five themed palettes or your own. Map and gameplay colors are not affected.", 12, UiTheme.pick("muted", MUTED), 18))
	var grid := GridContainer.new()
	grid.columns = 2 if _narrow() else 3
	grid.add_theme_constant_override("h_separation", 9)
	grid.add_theme_constant_override("v_separation", 9)
	grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	grid.add_child(_preset_button(UiTheme.DEFAULT, "Default (Original)", ORIGINAL_PREVIEW))
	for item in UiTheme.PRESETS:
		grid.add_child(_preset_button(str(item["id"]), str(item["name"]), item["colors"]))
	grid.add_child(_preset_button("custom", "Custom preset", UiTheme.custom))
	add_child(grid)
	if UiTheme.preset == "custom":
		add_child(_custom_editor())
	add_child(_footer())


func _text(value: String, size: int, ink: Color, line_px := 0.0, weight := 400) -> Label:
	var label := UI.wrapped(value, size, ink, weight)
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	if line_px > 0.0:
		label.add_theme_constant_override("line_spacing", maxi(0, int(round(line_px - UI.font(weight).get_height(size)))))
	return label


func _preset_button(id: String, label: String, colors: Dictionary) -> Button:
	var pressed := UiTheme.preset == id
	var button := Button.new()
	button.focus_mode = Control.FOCUS_NONE
	button.toggle_mode = false
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	button.set_meta("theme_id", id)
	button.set_meta("pressed", pressed)
	var rest := UI.box(UiTheme.pick("active", ACTIVE) if pressed else UiTheme.pick("surface", SURFACE), UiTheme.pick("accent", ACCENT) if pressed else UiTheme.pick("line", LINE), 7, 2 if pressed else 1, Vector4(7, 7, 7, 7))
	var over := UI.box(UiTheme.pick("hover", HOVER), UiTheme.pick("accent", ACCENT) if pressed else UiTheme.pick("line", LINE), 7, 2 if pressed else 1, Vector4(7, 7, 7, 7))
	for state in [["normal", rest], ["focus", rest], ["pressed", rest], ["hover", over], ["hover_pressed", over]]:
		button.add_theme_stylebox_override(state[0], state[1])
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 6)
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	column.offset_left = 7
	column.offset_top = 7
	column.offset_right = -7
	column.offset_bottom = -7
	column.add_child(sample(colors, 55))
	var name_label := UI.label(label, 12, UiTheme.pick("text", INK), 750)
	name_label.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED if not UiTheme.preset_named(id).is_empty() else Node.AUTO_TRANSLATE_MODE_INHERIT
	column.add_child(name_label)
	button.add_child(column)
	button.custom_minimum_size.y = 55 + 6 + 14 + 14
	button.pressed.connect(func() -> void: UiTheme.select(id))
	return button


static func sample(colors: Dictionary, tall := 55.0) -> Control:
	var frame := PanelContainer.new()
	frame.mouse_filter = Control.MOUSE_FILTER_IGNORE
	frame.custom_minimum_size.y = tall
	frame.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	frame.add_theme_stylebox_override("panel", UI.box(Color(str(colors["background"])), Color(1, 1, 1, 0.13), 5, 1, Vector4(5.4, 5.4, 5.4, 5.4)))
	var drawing := ThemeSample.new()
	drawing.colors = colors
	drawing.mouse_filter = Control.MOUSE_FILTER_IGNORE
	frame.add_child(drawing)
	return frame


func _custom_editor() -> Control:
	var box := PanelContainer.new()
	box.add_theme_stylebox_override("panel", UI.box(UiTheme.pick("surface", SURFACE), UiTheme.pick("line", LINE), 7, 1, Vector4(12, 12, 12, 12)))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	column.add_child(UI.label("Custom colors", 12, UiTheme.pick("text", INK), 800))
	var spacer := Control.new()
	spacer.custom_minimum_size.y = 11
	column.add_child(spacer)
	var grid := GridContainer.new()
	grid.columns = 1 if _narrow() else 3
	grid.add_theme_constant_override("h_separation", 9)
	grid.add_theme_constant_override("v_separation", 9)
	for field in FIELDS:
		grid.add_child(_color_field(str(field[0]), str(field[1])))
	column.add_child(grid)
	var gap := Control.new()
	gap.custom_minimum_size.y = 10
	column.add_child(gap)
	column.add_child(_text("High-contrast colors are required so text and controls remain readable.", 12, UiTheme.pick("muted", MUTED), 18))
	box.add_child(column)
	return box


func _color_field(key: String, label: String) -> Control:
	var selected := str(UiTheme.custom.get(key, ""))
	var draft := str(_drafts.get(key, selected))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 5)
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.add_child(UI.label(label, 11, UiTheme.pick("muted", MUTED), 750))
	var controls := HBoxContainer.new()
	controls.add_theme_constant_override("separation", 5)
	var picker := ColorPickerButton.new()
	picker.edit_alpha = false
	picker.custom_minimum_size = Vector2(32, 32)
	picker.focus_mode = Control.FOCUS_NONE
	picker.color = Color(UiTheme.normalize_color(draft) if not UiTheme.normalize_color(draft).is_empty() else selected)
	picker.tooltip_text = label
	var flat := StyleBoxFlat.new()
	flat.bg_color = Color(0, 0, 0, 0)
	for state in ["normal", "hover", "pressed", "focus"]:
		picker.add_theme_stylebox_override(state, flat)
	picker.popup_closed.connect(func() -> void: _update(key, "#" + picker.color.to_html(false).to_upper()))
	controls.add_child(picker)
	var field := LineEdit.new()
	field.text = draft
	field.max_length = 7
	if _narrow():
		field.custom_minimum_size.x = 192
	else:
		field.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	field.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	field.tooltip_text = label + " hex color"
	field.add_theme_font_override("font", _mono())
	field.add_theme_font_size_override("font_size", 11)
	field.add_theme_color_override("font_color", UiTheme.pick("text", INK))
	var field_style := UI.box(UiTheme.pick("bg", FIELD_BG), UiTheme.pick("line", LINE), 4, 1, Vector4(5, 7, 5, 7))
	for state in ["normal", "focus", "read_only"]:
		field.add_theme_stylebox_override(state, field_style)
	field.text_changed.connect(func(value: String) -> void: _update(key, value, false))
	field.focus_entered.connect(func() -> void: _typing = true)
	field.focus_exited.connect(func() -> void:
		_typing = false
		if not str(_errors.get(key, "")).is_empty():
			_drafts.erase(key)
			_errors.erase(key)
			_stale = true
		if _stale:
			_render.call_deferred())
	controls.add_child(field)
	column.add_child(controls)
	var problem := str(_errors.get(key, ""))
	var error := _text(problem, 10, ERROR, 13.6)
	error.visible = not problem.is_empty()
	_error_labels[key] = error
	column.add_child(error)
	return column


func _update(key: String, value: String, redraw := true) -> void:
	_drafts[key] = value
	var problem := UiTheme.set_custom_color(key, value)
	if problem.is_empty():
		_drafts.erase(key)
		_errors.erase(key)
		var cleared: Variant = _error_labels.get(key)
		if cleared is Label and is_instance_valid(cleared):
			(cleared as Label).visible = false
		return
	_errors[key] = problem
	var shown: Variant = _error_labels.get(key)
	if shown is Label and is_instance_valid(shown):
		(shown as Label).text = problem
		(shown as Label).visible = true
	if redraw:
		_render()


func _narrow() -> bool:
	return UI.phone() and get_viewport_rect().size.x <= 480.0


func _footer() -> Control:
	var line: BoxContainer = VBoxContainer.new() if _narrow() else HBoxContainer.new()
	line.add_theme_constant_override("separation", 11)
	var preview := HBoxContainer.new()
	preview.add_theme_constant_override("separation", 9)
	preview.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var large := sample(ORIGINAL_PREVIEW if UiTheme.preset == UiTheme.DEFAULT else UiTheme.colors_of(UiTheme.preset), 55)
	large.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	large.custom_minimum_size.x = 80
	preview.add_child(large)
	var words := UI.label("Live preview", 11, UiTheme.pick("muted", MUTED))
	words.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	preview.add_child(words)
	line.add_child(preview)
	var reset := Button.new()
	reset.text = "Reset to default"
	reset.focus_mode = Control.FOCUS_NONE
	reset.custom_minimum_size.y = 36
	reset.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	if _narrow():
		reset.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	reset.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	reset.add_theme_font_override("font", UI.font(700))
	reset.add_theme_font_size_override("font_size", 11)
	reset.add_theme_color_override("font_color", UiTheme.pick("text", INK))
	reset.add_theme_color_override("font_hover_color", UiTheme.pick("text", INK))
	reset.add_theme_color_override("font_disabled_color", Color(UiTheme.pick("text", INK), 0.5))
	var rest := UI.box(UiTheme.pick("surface", SURFACE), UiTheme.pick("line", LINE), 5, 1, Vector4(10, 6, 10, 6))
	var dim := UI.box(Color(UiTheme.pick("surface", SURFACE), 0.5), Color(UiTheme.pick("line", LINE), 0.5), 5, 1, Vector4(10, 6, 10, 6))
	for state in [["normal", rest], ["hover", rest], ["pressed", rest], ["focus", rest], ["disabled", dim]]:
		reset.add_theme_stylebox_override(state[0], state[1])
	reset.disabled = UiTheme.reset_unchanged()
	reset.pressed.connect(func() -> void:
		_drafts.clear()
		_errors.clear()
		UiTheme.reset())
	line.add_child(reset)
	return line


static func _mono() -> Font:
	var font := SystemFont.new()
	font.font_names = PackedStringArray(["Consolas", "Courier New", "monospace"])
	return font


class ThemeSample:
	extends Control

	var colors := {}

	func _draw() -> void:
		var wide := size.x
		var bg := Color(str(colors.get("background", "#131315")))
		var surface := Color(str(colors.get("surface", "#232327")))
		var accent := Color(str(colors.get("accent", "#4B91FF")))
		draw_rect(Rect2(0, 0, wide, size.y), bg)
		draw_rect(Rect2(0, 0, wide * 0.35, 3), accent)
		draw_rect(Rect2(wide * 0.35 + 3.5, 0, wide * 0.28, 3), surface)
		var panel := Rect2(0, 8.6, wide, maxf(0.0, size.y - 8.6))
		draw_style_box(UI.box(surface, Color(0, 0, 0, 0), 3, 0), panel)
		var inner := panel.size.x - 12.2
		draw_rect(Rect2(6.1, panel.position.y + 6.1, inner * 0.45, 4), accent)
		draw_rect(Rect2(6.1, panel.position.y + 6.1 + 4 + 5.1, inner * 0.89, 3), Color(1, 1, 1, 0.22))
		draw_rect(Rect2(6.1, panel.position.y + 6.1 + 4 + 5.1 + 3 + 5.1, inner * 0.63, 3), Color(1, 1, 1, 0.3))
