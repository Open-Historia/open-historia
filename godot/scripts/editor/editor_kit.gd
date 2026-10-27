class_name EditorKit
extends RefCounted

const PANEL := Color("#12141a")
const NAV := Color("#0d0f14")
const CARD := Color("#171a22")
const CARD_BORDER := Color(1, 1, 1, 0.08)
const SOFT_BG := Color(1, 1, 1, 0.03)
const INPUT_BG := Color(1, 1, 1, 0.04)
const INPUT_BORDER := Color(1, 1, 1, 0.1)
const INPUT_FOCUS := Color(1, 1, 1, 0.26)
const INPUT_INK := Color("#f8fafc")
const PLACEHOLDER := Color(1, 1, 1, 0.38)
const LABEL_INK := Color(1, 1, 1, 0.72)
const QUIET_INK := Color(1, 1, 1, 0.58)
const HINT_INK := Color(1, 1, 1, 0.5)
const BUTTON_INK := Color(246 / 255.0, 246 / 255.0, 248 / 255.0, 0.92)
const DANGER_BG := Color(127 / 255.0, 29 / 255.0, 29 / 255.0, 0.34)
const DANGER_BORDER := Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.28)
const DANGER_INK := Color("#fecaca")
const ERROR_BG := Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.12)
const ERROR_BORDER := Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.34)
const ERROR_INK := Color("#fecaca")
const OK_BG := Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.08)
const OK_BORDER := Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.2)
const OK_INK := Color(220 / 255.0, 252 / 255.0, 231 / 255.0, 0.86)
const WARN_BG := Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.1)
const WARN_BORDER := Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.28)
const WARN_INK := Color("#fde68a")
const ACCENT_SOFT_BG := Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.22)
const ACCENT_SOFT_BORDER := Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.5)

const BUTTONS := {
	"theme": {"bg": Color(1, 1, 1, 0.06), "border": Color(1, 1, 1, 0.12), "ink": BUTTON_INK, "radius": 9, "height": 35, "pad": 16, "size": 13, "weight": 600},
	"small": {"bg": Color(1, 1, 1, 0.06), "border": Color(1, 1, 1, 0.12), "ink": BUTTON_INK, "radius": 9, "height": 27, "pad": 10, "size": 12, "weight": 600},
	"chip": {"bg": Color(1, 1, 1, 0.04), "border": Color(1, 1, 1, 0.1), "ink": BUTTON_INK, "radius": 9, "height": 32, "pad": 11, "size": 13, "weight": 600},
	"chip_on": {"bg": Color(1, 1, 1, 0.12), "border": Color(1, 1, 1, 0.25), "ink": UI.WHITE, "radius": 9, "height": 32, "pad": 11, "size": 13, "weight": 600},
	"tab": {"bg": Color(1, 1, 1, 0.05), "border": Color(1, 1, 1, 0.08), "ink": BUTTON_INK, "radius": 9, "height": 32, "pad": 13, "size": 13, "weight": 600},
	"tab_on": {"bg": Color(0, 0, 0, 0.42), "border": Color(1, 1, 1, 0.28), "ink": UI.WHITE, "radius": 9, "height": 32, "pad": 13, "size": 13, "weight": 600},
	"quiet": {"bg": Color(1, 1, 1, 0.03), "border": Color(1, 1, 1, 0.12), "ink": BUTTON_INK, "radius": 9, "height": 35, "pad": 16, "size": 13, "weight": 600},
	"primary": {"bg": ACCENT_SOFT_BG, "border": ACCENT_SOFT_BORDER, "ink": UI.WHITE, "radius": 9, "height": 34, "pad": 13, "size": 13, "weight": 600},
	"accent": {"bg": UI.ACCENT, "border": UI.ACCENT, "ink": UI.WHITE, "radius": 11, "height": 38, "pad": 16, "size": 13, "weight": 700},
	"danger": {"bg": DANGER_BG, "border": DANGER_BORDER, "ink": DANGER_INK, "radius": 9, "height": 35, "pad": 16, "size": 13, "weight": 600},
	"link": {"bg": Color(0, 0, 0, 0), "border": Color(0, 0, 0, 0), "ink": Color("#7dd3fc"), "radius": 6, "height": 24, "pad": 2, "size": 13, "weight": 600},
}


static func gap(height: float) -> Control:
	var node := Control.new()
	node.custom_minimum_size.y = height
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return node


static func clear(node: Node) -> void:
	for child in node.get_children():
		node.remove_child(child)
		child.queue_free()


static func hex_of(color: Color) -> String:
	return "#" + color.to_html(false)


static func color_of(hex: String, fallback := Color("#a1a1aa")) -> Color:
	var text := hex.strip_edges()
	if text.is_empty() or not Color.html_is_valid(text):
		return fallback
	return Color.html(text)


static func panel(bg: Color, border: Color, radius: int, margin: Vector4, separation := 10) -> Array:
	var holder := PanelContainer.new()
	holder.add_theme_stylebox_override("panel", UI.box(bg, border, radius, 1, margin))
	holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", separation)
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	holder.add_child(column)
	return [holder, column]


static func card(title := "", separation := 12) -> Array:
	var parts := panel(CARD, CARD_BORDER, 16, Vector4(17, 16, 17, 16), separation)
	if not title.is_empty():
		(parts[1] as VBoxContainer).add_child(card_title(title))
	return parts


static func card_title(text: String) -> Label:
	var node := UI.label(text, 15, UI.WHITE, 800, "Arial", 0)
	node.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return node


static func soft_card(separation := 10, radius := 18) -> Array:
	return panel(SOFT_BG, CARD_BORDER, radius, Vector4(14, 14, 14, 14), separation)


static func field_label(text: String, size := 12) -> Label:
	var node := UI.label(text.to_upper(), size, LABEL_INK, 600, "Arial", 1)
	node.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return node


static func section_label(text: String) -> Label:
	return UI.label(text.to_upper(), 11, Color(1, 1, 1, 0.42), 700, "Arial", 1)


static func hint(text: String, size := 12, ink := HINT_INK, weight := 400) -> Label:
	var node := UI.wrapped(text, size, ink, weight)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


static func title(text: String, size := 15, ink := UI.WHITE, weight := 800) -> Label:
	var node := UI.label(text, size, ink, weight)
	node.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return node


static func _input_box(focus: bool, radius := 12, margin := Vector4(14, 10, 14, 10)) -> StyleBoxFlat:
	return UI.box(INPUT_BG if not focus else Color(1, 1, 1, 0.06), INPUT_FOCUS if focus else INPUT_BORDER, radius, 1, margin)


static func line(value: String, placeholder := "", on_change: Callable = Callable(), height := 42.0) -> LineEdit:
	var node := LineEdit.new()
	node.text = value
	node.placeholder_text = placeholder
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.custom_minimum_size.y = height
	node.add_theme_stylebox_override("normal", _input_box(false))
	node.add_theme_stylebox_override("focus", _input_box(true))
	node.add_theme_stylebox_override("read_only", UI.box(Color(1, 1, 1, 0.02), Color(1, 1, 1, 0.07), 12, 1, Vector4(14, 10, 14, 10)))
	node.add_theme_font_override("font", UI.font(400))
	node.add_theme_font_size_override("font_size", 14)
	node.add_theme_color_override("font_color", INPUT_INK)
	node.add_theme_color_override("font_uneditable_color", Color(INPUT_INK, 0.6))
	node.add_theme_color_override("font_placeholder_color", PLACEHOLDER)
	node.add_theme_color_override("caret_color", INPUT_INK)
	node.add_theme_color_override("selection_color", Color(UI.ACCENT, 0.35))
	if on_change.is_valid():
		node.text_changed.connect(func(text: String) -> void: on_change.call(text))
	return node


static func area(value: String, min_height := 128.0, on_change: Callable = Callable(), placeholder := "") -> TextEdit:
	var node := TextEdit.new()
	node.text = value
	node.placeholder_text = placeholder
	node.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.custom_minimum_size.y = min_height
	node.scroll_fit_content_height = true
	node.add_theme_stylebox_override("normal", _input_box(false))
	node.add_theme_stylebox_override("focus", _input_box(true))
	node.add_theme_stylebox_override("read_only", UI.box(Color(1, 1, 1, 0.02), Color(1, 1, 1, 0.07), 12, 1, Vector4(14, 10, 14, 10)))
	node.add_theme_font_override("font", UI.font(400))
	node.add_theme_font_size_override("font_size", 14)
	node.add_theme_color_override("font_color", INPUT_INK)
	node.add_theme_color_override("font_readonly_color", Color(INPUT_INK, 0.7))
	node.add_theme_color_override("font_placeholder_color", PLACEHOLDER)
	node.add_theme_color_override("caret_color", INPUT_INK)
	node.add_theme_color_override("selection_color", Color(UI.ACCENT, 0.35))
	node.add_theme_color_override("background_color", Color(0, 0, 0, 0))
	if on_change.is_valid():
		node.text_changed.connect(func() -> void: on_change.call(node.text))
	return node


static func button(text: String, kind := "theme", size := 0) -> Button:
	var spec: Dictionary = BUTTONS.get(kind, BUTTONS["theme"])
	var node := Button.new()
	node.text = text
	node.focus_mode = Control.FOCUS_NONE
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var bg: Color = spec["bg"]
	var border: Color = spec["border"]
	var pad: float = float(spec["pad"])
	var normal := UI.box(bg, border, int(spec["radius"]), 1, Vector4(pad, 4, pad, 4))
	var hover := normal.duplicate() as StyleBoxFlat
	if kind == "accent":
		hover.bg_color = UI.ACCENT.lightened(0.12)
		hover.border_color = hover.bg_color
	elif kind != "link":
		hover.bg_color = Color(bg.r, bg.g, bg.b, minf(1.0, bg.a + 0.05))
		hover.border_color = Color(border.r, border.g, border.b, minf(1.0, border.a + 0.1))
	for state in [["normal", normal], ["hover", hover], ["pressed", hover], ["hover_pressed", hover], ["focus", normal], ["disabled", normal]]:
		node.add_theme_stylebox_override(state[0], state[1])
	var ink: Color = spec["ink"]
	node.add_theme_font_override("font", UI.font(int(spec["weight"])))
	node.add_theme_font_size_override("font_size", size if size > 0 else int(spec["size"]))
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		node.add_theme_color_override(name, ink)
	node.add_theme_color_override("font_disabled_color", Color(ink, ink.a * 0.45))
	node.custom_minimum_size.y = float(spec["height"])
	return node


static func accent_button(text: String, accent: Color) -> Button:
	var node := button(text, "accent")
	var normal := UI.box(accent, accent, 11, 1, Vector4(16, 4, 16, 4))
	var hover := UI.box(accent.lightened(0.1), accent.lightened(0.1), 11, 1, Vector4(16, 4, 16, 4))
	for state in [["normal", normal], ["hover", hover], ["pressed", hover], ["hover_pressed", hover], ["focus", normal], ["disabled", normal]]:
		node.add_theme_stylebox_override(state[0], state[1])
	return node


static func enable(node: BaseButton, enabled: bool) -> void:
	node.disabled = not enabled
	node.modulate = Color(1, 1, 1, 1.0 if enabled else 0.55)
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if enabled else Control.CURSOR_ARROW


static func color_button(hex: String, on_change: Callable = Callable(), height := 42.0) -> ColorPickerButton:
	var node := ColorPickerButton.new()
	node.color = color_of(hex, Color("#ffffff"))
	node.edit_alpha = false
	node.focus_mode = Control.FOCUS_NONE
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.custom_minimum_size.y = height
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var style := UI.box(INPUT_BG, INPUT_BORDER, 12, 1, Vector4(5, 4, 5, 4))
	for state in ["normal", "hover", "pressed", "focus", "hover_pressed", "disabled"]:
		node.add_theme_stylebox_override(state, style)
	if on_change.is_valid():
		node.color_changed.connect(func(color: Color) -> void: on_change.call(hex_of(color)))
	return node


static func select(options: Array, value: String, on_change: Callable = Callable(), placeholder := "") -> OptionButton:
	var node := OptionButton.new()
	node.focus_mode = Control.FOCUS_NONE
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.custom_minimum_size.y = 42
	node.fit_to_longest_item = false
	node.clip_text = true
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	node.add_theme_stylebox_override("normal", _input_box(false))
	node.add_theme_stylebox_override("hover", _input_box(true))
	node.add_theme_stylebox_override("pressed", _input_box(true))
	node.add_theme_stylebox_override("focus", _input_box(false))
	node.add_theme_stylebox_override("disabled", UI.box(Color(1, 1, 1, 0.02), Color(1, 1, 1, 0.07), 12, 1, Vector4(14, 10, 14, 10)))
	node.add_theme_font_override("font", UI.font(400))
	node.add_theme_font_size_override("font_size", 14)
	node.add_theme_color_override("font_color", INPUT_INK)
	node.add_theme_color_override("font_hover_color", INPUT_INK)
	var selected := -1
	if not placeholder.is_empty():
		node.add_item(placeholder)
		node.set_item_metadata(0, "")
		selected = 0
	for option in options:
		var pair: Array = option if option is Array else [option, option]
		node.add_item(str(pair[1]))
		node.set_item_metadata(node.item_count - 1, str(pair[0]))
		if str(pair[0]) == value:
			selected = node.item_count - 1
	if selected >= 0:
		node.select(selected)
	if on_change.is_valid():
		node.item_selected.connect(func(index: int) -> void: on_change.call(str(node.get_item_metadata(index))))
	return node


static func check(text: String, value: bool, on_change: Callable = Callable(), size := 13) -> CheckBox:
	var node := CheckBox.new()
	node.text = text
	node.button_pressed = value
	node.focus_mode = Control.FOCUS_NONE
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	node.add_theme_font_override("font", UI.font(500))
	node.add_theme_font_size_override("font_size", size)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color"]:
		node.add_theme_color_override(name, Color(1, 1, 1, 0.86))
	if on_change.is_valid():
		node.toggled.connect(func(on: bool) -> void: on_change.call(on))
	return node


static func spin(value: float, min_value: float, max_value: float, step := 1.0, on_change: Callable = Callable()) -> SpinBox:
	var node := SpinBox.new()
	node.min_value = min_value
	node.max_value = max_value
	node.step = step
	node.value = value
	node.allow_greater = false
	node.allow_lesser = false
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.custom_minimum_size.y = 42
	var edit := node.get_line_edit()
	edit.add_theme_stylebox_override("normal", _input_box(false))
	edit.add_theme_stylebox_override("focus", _input_box(true))
	edit.add_theme_font_override("font", UI.font(400))
	edit.add_theme_font_size_override("font_size", 14)
	edit.add_theme_color_override("font_color", INPUT_INK)
	if on_change.is_valid():
		node.value_changed.connect(func(next: float) -> void: on_change.call(next))
	return node


static func note(text: String, kind := "error", size := 13) -> PanelContainer:
	var bg := ERROR_BG
	var border := ERROR_BORDER
	var ink := ERROR_INK
	match kind:
		"ok":
			bg = OK_BG
			border = OK_BORDER
			ink = OK_INK
		"warn":
			bg = WARN_BG
			border = WARN_BORDER
			ink = WARN_INK
		"info":
			bg = Color(1, 1, 1, 0.03)
			border = Color(1, 1, 1, 0.11)
			ink = Color(1, 1, 1, 0.62)
	var holder := PanelContainer.new()
	holder.add_theme_stylebox_override("panel", UI.box(bg, border, 12, 1, Vector4(12, 9, 12, 9)))
	holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var text_label := UI.wrapped(text, size, ink, 400)
	text_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	holder.add_child(text_label)
	return holder


static func grid(columns: int, separation := 13) -> GridContainer:
	var node := GridContainer.new()
	node.columns = columns
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.add_theme_constant_override("h_separation", separation)
	node.add_theme_constant_override("v_separation", separation)
	return node


static func field(label_text: String, control: Control, help := "") -> VBoxContainer:
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 7)
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	if not label_text.is_empty():
		column.add_child(field_label(label_text))
	if not help.is_empty():
		column.add_child(hint(help, 12, Color(1, 1, 1, 0.45)))
	column.add_child(control)
	return column


static func row(separation := 8) -> HBoxContainer:
	var node := HBoxContainer.new()
	node.add_theme_constant_override("separation", separation)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


static func flow(separation := 7) -> HFlowContainer:
	var node := HFlowContainer.new()
	node.add_theme_constant_override("h_separation", separation)
	node.add_theme_constant_override("v_separation", separation)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


static func rule() -> ColorRect:
	var line_node := ColorRect.new()
	line_node.color = Color(1, 1, 1, 0.08)
	line_node.custom_minimum_size.y = 1
	line_node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return line_node


static func ask(host: Node, text: String, ok_text := "OK", cancel_text := "Cancel") -> bool:
	var dialog := ConfirmationDialog.new()
	dialog.dialog_text = text
	dialog.dialog_autowrap = true
	dialog.min_size = Vector2i(460, 0)
	dialog.ok_button_text = ok_text
	dialog.cancel_button_text = cancel_text
	host.add_child(dialog)
	var answer := [false]
	var finished := [false]
	dialog.confirmed.connect(func() -> void:
		answer[0] = true
		finished[0] = true)
	dialog.canceled.connect(func() -> void: finished[0] = true)
	dialog.popup_centered()
	while not finished[0] and is_instance_valid(dialog):
		await host.get_tree().process_frame
	if is_instance_valid(dialog):
		dialog.queue_free()
	return bool(answer[0])


static func prompt_text(host: Node, text: String, value := "") -> Array:
	var dialog := ConfirmationDialog.new()
	dialog.title = ""
	dialog.min_size = Vector2i(460, 0)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 8)
	var message := Label.new()
	message.text = text
	message.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	column.add_child(message)
	var edit := LineEdit.new()
	edit.text = value
	column.add_child(edit)
	dialog.add_child(column)
	host.add_child(dialog)
	var answer := [false, ""]
	var finished := [false]
	dialog.confirmed.connect(func() -> void:
		answer[0] = true
		answer[1] = edit.text
		finished[0] = true)
	dialog.canceled.connect(func() -> void: finished[0] = true)
	dialog.popup_centered()
	edit.grab_focus()
	while not finished[0] and is_instance_valid(dialog):
		await host.get_tree().process_frame
	if is_instance_valid(dialog):
		dialog.queue_free()
	return answer


static func tell(host: Node, text: String) -> void:
	var dialog := AcceptDialog.new()
	dialog.dialog_text = text
	dialog.dialog_autowrap = true
	dialog.min_size = Vector2i(460, 0)
	host.add_child(dialog)
	var finished := [false]
	dialog.confirmed.connect(func() -> void: finished[0] = true)
	dialog.canceled.connect(func() -> void: finished[0] = true)
	dialog.popup_centered()
	while not finished[0] and is_instance_valid(dialog):
		await host.get_tree().process_frame
	if is_instance_valid(dialog):
		dialog.queue_free()


static func pick_file(host: Node, save: bool, default_name: String, filters: PackedStringArray) -> String:
	var forced := OS.get_environment("OH_EDITOR_PICK")
	if not forced.is_empty():
		var picks := forced.split("|")
		for entry in picks:
			var pair := entry.split("=", true, 1)
			if pair.size() == 2 and pair[0] != "*" and not default_name.is_empty() and default_name.ends_with(pair[0]):
				return pair[1]
		for entry in picks:
			var pair := entry.split("=", true, 1)
			if pair.size() == 2 and pair[0] == "*":
				return pair[1].path_join(default_name) if save else pair[1]
	var dialog := FileDialog.new()
	dialog.use_native_dialog = true
	dialog.access = FileDialog.ACCESS_FILESYSTEM
	dialog.file_mode = FileDialog.FILE_MODE_SAVE_FILE if save else FileDialog.FILE_MODE_OPEN_FILE
	dialog.filters = filters
	dialog.current_dir = OS.get_system_dir(OS.SYSTEM_DIR_DOWNLOADS)
	if save:
		dialog.current_file = default_name
	host.add_child(dialog)
	var picked := [""]
	var finished := [false]
	dialog.file_selected.connect(func(path: String) -> void:
		picked[0] = path
		finished[0] = true)
	dialog.canceled.connect(func() -> void: finished[0] = true)
	dialog.popup_centered()
	while not finished[0] and is_instance_valid(dialog):
		await host.get_tree().process_frame
	if is_instance_valid(dialog):
		dialog.queue_free()
	return str(picked[0])


static func dim(control: Control, reason: String) -> Control:
	UI.set_disabled_look(control, reason)
	return control


static func expand(control: Control) -> Control:
	control.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return control


static func badge(text: String, bg: Color, border: Color, ink: Color, size := 10) -> PanelContainer:
	var holder := PanelContainer.new()
	holder.add_theme_stylebox_override("panel", UI.box(bg, border, 999, 1, Vector4(6, 2, 6, 2)))
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	holder.add_child(UI.label(text, size, ink, 800))
	return holder


static func svg_icon(svg: String, size := 17, color := UI.WHITE) -> Texture2D:
	var source := svg.replace("currentColor", "#" + color.to_html(false))
	var image := Image.new()
	if image.load_svg_from_string(source, float(size) / 24.0) != OK:
		return null
	if color.a < 1.0:
		image.convert(Image.FORMAT_RGBA8)
		for y in range(image.get_height()):
			for x in range(image.get_width()):
				var pixel := image.get_pixel(x, y)
				pixel.a *= color.a
				image.set_pixel(x, y, pixel)
	return ImageTexture.create_from_image(image)


static func text_value(value: Variant) -> String:
	if value == null:
		return ""
	if value is float and is_equal_approx(value, roundf(value)) and absf(value) < 1e15:
		return str(int(value))
	return str(value)
