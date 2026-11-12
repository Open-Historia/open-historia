class_name EditorWarKit
extends RefCounted

const INK := Color(246 / 255.0, 246 / 255.0, 248 / 255.0, 0.92)
const PRIMARY_BG := Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.16)
const PRIMARY_BORDER := Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.4)
const PRIMARY_INK := Color("#e0f6fe")
const WARN := Color("#fde68a")
const ALERT := Color("#fca5a5")
const GOOD := Color("#86efac")
const HINT := Color(1, 1, 1, 0.5)
const INPUT_INK := Color("#f8fafc")
const CHEVRON_UP := "<svg viewBox='0 0 24 24'><path d='M4 16 L12 8 L20 16' fill='none' stroke='currentColor' stroke-width='3.2' stroke-linecap='round' stroke-linejoin='round'/></svg>"
const CHEVRON_DOWN := "<svg viewBox='0 0 24 24'><path d='M4 8 L12 16 L20 8' fill='none' stroke='currentColor' stroke-width='3.2' stroke-linecap='round' stroke-linejoin='round'/></svg>"

static var _chevrons := {}


static func gap(height: float) -> Control:
	return EditorKit.gap(height)


static func card() -> Array:
	var holder := PanelContainer.new()
	holder.add_theme_stylebox_override("panel", UI.box(EditorKit.SOFT_BG, EditorKit.CARD_BORDER, 18, 1, Vector4(14, 14, 14, 14)))
	holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	holder.add_child(column)
	return [holder, column]


static func section(top := 13.0) -> Array:
	var wrap := VBoxContainer.new()
	wrap.add_theme_constant_override("separation", 0)
	wrap.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	if top > 0.0:
		wrap.add_child(gap(top))
	var holder := PanelContainer.new()
	holder.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.02), Color(1, 1, 1, 0.07), 14, 1, Vector4(12, 12, 12, 12)))
	holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	holder.add_child(column)
	wrap.add_child(holder)
	return [wrap, column]


static func title(text: String) -> Label:
	var node := UI.label(text, 15, Color(1, 1, 1, 0.94), 800)
	node.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


static func hint(text: String, ink := HINT, size := 11) -> Label:
	var node := UI.wrapped(text, size, ink, 400)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.add_theme_constant_override("line_spacing", 3)
	return node


static func label(text: String) -> Label:
	var node := UI.label(text.to_upper(), 10, Color(1, 1, 1, 0.58), 700, "Arial", 1)
	node.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return node


static func field_label(text: String) -> VBoxContainer:
	var holder := VBoxContainer.new()
	holder.add_theme_constant_override("separation", 0)
	holder.add_child(label(text))
	holder.add_child(gap(5))
	return holder


static func section_title(text: String) -> Label:
	return UI.label(text.to_upper(), 11, Color(1, 1, 1, 0.78), 800, "Arial", 1)


static func _style_button(node: Button, bg: Color, border: Color, ink: Color, radius: int, pad: float, size: int, height: float) -> void:
	var normal := UI.box(bg, border, radius, 1, Vector4(pad, 2, pad, 2))
	var hover := normal.duplicate() as StyleBoxFlat
	hover.bg_color = Color(bg.r, bg.g, bg.b, minf(1.0, bg.a + 0.05))
	hover.border_color = Color(border.r, border.g, border.b, minf(1.0, border.a + 0.1))
	for state in [["normal", normal], ["hover", hover], ["pressed", hover], ["hover_pressed", hover], ["focus", normal], ["disabled", normal]]:
		node.add_theme_stylebox_override(state[0], state[1])
	node.add_theme_font_override("font", UI.font(700))
	node.add_theme_font_size_override("font_size", size)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color", "font_disabled_color"]:
		node.add_theme_color_override(name, ink)
	node.custom_minimum_size.y = height


static func button(text: String, kind := "plain", radius := 9) -> Button:
	var node := Button.new()
	node.text = text
	node.focus_mode = Control.FOCUS_NONE
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	node.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	if kind == "primary":
		_style_button(node, PRIMARY_BG, PRIMARY_BORDER, PRIMARY_INK, radius, 13, 12, 32)
	elif kind == "soft":
		_style_button(node, Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.1), INK, radius, 13, 12, 32)
	else:
		_style_button(node, Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.12), INK, radius, 13, 12, 32)
	return node


static func choice(text: String, active: bool, radius := 9) -> Button:
	var node := Button.new()
	node.text = text
	node.focus_mode = Control.FOCUS_NONE
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	node.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_style_button(node, Color(0, 0, 0, 0.42) if active else Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.28) if active else Color(1, 1, 1, 0.08), Color("#f4f4f5") if active else Color(1, 1, 1, 0.7), radius, 10, 11, 29)
	return node


static func toggle_pill(text: String, on: bool) -> Button:
	var node := Button.new()
	node.text = text
	node.focus_mode = Control.FOCUS_NONE
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	node.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_style_button(node, Color(0, 0, 0, 0.42) if on else Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.28) if on else Color(1, 1, 1, 0.08), Color("#f4f4f5") if on else Color(1, 1, 1, 0.55), 999, 10, 11, 29)
	return node


static func set_pill(node: Button, on: bool) -> void:
	_style_button(node, Color(0, 0, 0, 0.42) if on else Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.28) if on else Color(1, 1, 1, 0.08), Color("#f4f4f5") if on else Color(1, 1, 1, 0.55), 999, 10, 11, 29)


static func set_choice(node: Button, active: bool, radius := 9) -> void:
	_style_button(node, Color(0, 0, 0, 0.42) if active else Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.28) if active else Color(1, 1, 1, 0.08), Color("#f4f4f5") if active else Color(1, 1, 1, 0.7), radius, 10, 11, 29)


static func set_enabled(node: BaseButton, enabled: bool, faded := 0.55) -> void:
	node.disabled = not enabled
	node.modulate = Color(1, 1, 1, 1.0 if enabled else faded)
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if enabled else Control.CURSOR_ARROW


static func _input_box(focus: bool, margin: Vector4) -> StyleBoxFlat:
	return UI.box(Color(1, 1, 1, 0.06) if focus else Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.26) if focus else Color(1, 1, 1, 0.1), 10, 1, margin)


static func style_line(node: LineEdit, margin := Vector4(11, 6, 11, 6), height := 34.0) -> void:
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.custom_minimum_size.y = height
	node.add_theme_stylebox_override("normal", _input_box(false, margin))
	node.add_theme_stylebox_override("focus", _input_box(true, margin))
	node.add_theme_stylebox_override("read_only", UI.box(Color(1, 1, 1, 0.02), Color(1, 1, 1, 0.07), 10, 1, margin))
	node.add_theme_font_override("font", UI.font(400))
	node.add_theme_font_size_override("font_size", 12)
	node.add_theme_color_override("font_color", INPUT_INK)
	node.add_theme_color_override("font_uneditable_color", Color(INPUT_INK, 0.55))
	node.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.36))
	node.add_theme_color_override("caret_color", INPUT_INK)
	node.add_theme_color_override("selection_color", Color(UI.ACCENT, 0.35))


static func input(value: String, placeholder: String, on_change: Callable = Callable()) -> LineEdit:
	var node := LineEdit.new()
	node.text = value
	node.placeholder_text = placeholder
	style_line(node)
	if on_change.is_valid():
		node.text_changed.connect(func(text: String) -> void: on_change.call(text))
	return node


static func area(value: String, placeholder: String, rows: int, on_change: Callable = Callable()) -> TextEdit:
	var node := TextEdit.new()
	node.text = value
	node.placeholder_text = placeholder
	node.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.custom_minimum_size.y = rows * 18 + 16
	node.scroll_fit_content_height = true
	var margin := Vector4(11, 8, 11, 8)
	node.add_theme_stylebox_override("normal", _input_box(false, margin))
	node.add_theme_stylebox_override("focus", _input_box(true, margin))
	node.add_theme_stylebox_override("read_only", UI.box(Color(1, 1, 1, 0.02), Color(1, 1, 1, 0.07), 10, 1, margin))
	node.add_theme_font_override("font", UI.font(400))
	node.add_theme_font_size_override("font_size", 12)
	node.add_theme_constant_override("line_spacing", 5)
	node.add_theme_color_override("font_color", INPUT_INK)
	node.add_theme_color_override("font_readonly_color", Color(INPUT_INK, 0.7))
	node.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.36))
	node.add_theme_color_override("caret_color", INPUT_INK)
	node.add_theme_color_override("selection_color", Color(UI.ACCENT, 0.35))
	node.add_theme_color_override("background_color", Color(0, 0, 0, 0))
	if on_change.is_valid():
		node.text_changed.connect(func() -> void: on_change.call(node.text))
	return node


static func select(options: Array, value: String, on_change: Callable = Callable(), placeholder := "") -> OptionButton:
	var node := OptionButton.new()
	node.focus_mode = Control.FOCUS_NONE
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.custom_minimum_size.y = 34
	node.fit_to_longest_item = false
	node.clip_text = true
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var margin := Vector4(11, 4, 11, 4)
	node.add_theme_stylebox_override("normal", _input_box(false, margin))
	node.add_theme_stylebox_override("hover", _input_box(true, margin))
	node.add_theme_stylebox_override("pressed", _input_box(true, margin))
	node.add_theme_stylebox_override("focus", _input_box(false, margin))
	node.add_theme_stylebox_override("disabled", UI.box(Color(1, 1, 1, 0.02), Color(1, 1, 1, 0.07), 10, 1, margin))
	node.add_theme_font_override("font", UI.font(400))
	node.add_theme_font_size_override("font_size", 12)
	node.add_theme_color_override("font_color", INPUT_INK)
	node.add_theme_color_override("font_hover_color", INPUT_INK)
	node.add_theme_color_override("font_pressed_color", INPUT_INK)
	node.add_theme_color_override("font_focus_color", INPUT_INK)
	var selected := -1
	if not placeholder.is_empty():
		node.add_item(placeholder)
		node.set_item_metadata(0, "")
		selected = 0
	for option in options:
		var pair: Array = option
		node.add_item(str(pair[1]))
		node.set_item_metadata(node.item_count - 1, str(pair[0]))
		if str(pair[0]) == value:
			selected = node.item_count - 1
	if selected >= 0:
		node.select(selected)
	var popup := node.get_popup()
	popup.add_theme_font_override("font", UI.font(400))
	popup.add_theme_font_size_override("font_size", 13)
	if on_change.is_valid():
		node.item_selected.connect(func(index: int) -> void: on_change.call(str(node.get_item_metadata(index))))
	return node


static func chevron(up: bool, color := INK) -> Texture2D:
	var key := "%s:%s" % [up, color.to_html()]
	if _chevrons.has(key):
		return _chevrons[key]
	var texture := EditorKit.svg_icon(CHEVRON_UP if up else CHEVRON_DOWN, 12, color)
	_chevrons[key] = texture
	return texture


static func host_of(node: Node, props: Dictionary) -> Node:
	var host: Variant = props.get("host")
	if host is Node and is_instance_valid(host) and (host as Node).is_inside_tree():
		return host
	return node
