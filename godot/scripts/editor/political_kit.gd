class_name PoliticalKit
extends RefCounted

const GREY_RAISED := Color("#232327")
const GREY_SELECTED := Color("#0e0e10")
const GREY_BORDER := Color(1, 1, 1, 0.1)
const GREY_BORDER_STRONG := Color(1, 1, 1, 0.22)
const GREY_TEXT := Color("#e7e7ea")
const GREY_MUTED := Color(231 / 255.0, 231 / 255.0, 234 / 255.0, 0.6)
const GREEN_INK := Color("#bbf7d0")
const GREEN_SOFT := Color("#86efac")
const AMBER_INK := Color("#fde68a")
const AMBER_SOFT := Color("#fbbf24")
const RED_INK := Color("#fecaca")
const RED_SOFT := Color("#fca5a5")
const INPUT_INK := Color("#f8fafc")
const MANAGER_PANEL := Color(24 / 255.0, 24 / 255.0, 27 / 255.0, 0.985)

const PILL_BUTTONS := {
	"plain": [Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.1), Color(246 / 255.0, 246 / 255.0, 248 / 255.0, 0.94)],
	"raised": [GREY_RAISED, GREY_BORDER_STRONG, Color(246 / 255.0, 246 / 255.0, 248 / 255.0, 0.94)],
	"green": [Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.22), Color(74 / 255.0, 222 / 255.0, 128 / 255.0, 0.34), Color(246 / 255.0, 246 / 255.0, 248 / 255.0, 0.94)],
	"green_soft": [Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.18), Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.3), Color(246 / 255.0, 246 / 255.0, 248 / 255.0, 0.94)],
	"red": [Color(127 / 255.0, 29 / 255.0, 29 / 255.0, 0.3), Color(1, 1, 1, 0.1), Color(246 / 255.0, 246 / 255.0, 248 / 255.0, 0.94)],
	"faint": [Color(1, 1, 1, 0.045), Color(1, 1, 1, 0.1), Color(246 / 255.0, 246 / 255.0, 248 / 255.0, 0.94)],
}

const ACTION_BUTTONS := {
	"plain": [Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.12), Color(246 / 255.0, 246 / 255.0, 248 / 255.0, 0.94)],
	"raised": [GREY_RAISED, GREY_BORDER_STRONG, Color(246 / 255.0, 246 / 255.0, 248 / 255.0, 0.94)],
	"quiet": [Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.12), Color(246 / 255.0, 246 / 255.0, 248 / 255.0, 0.94)],
	"danger_text": [Color(1, 1, 1, 0.06), Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.28), RED_SOFT],
	"remove": [Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.12), RED_SOFT],
	"danger": [Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.08), Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.3), RED_INK],
}


static func gap(height: float) -> Control:
	return EditorKit.gap(height)


static func styled_button(text: String, colors: Array, radius: int, height: float, pad: float, size: int, weight: int) -> Button:
	var node := Button.new()
	node.text = text
	node.focus_mode = Control.FOCUS_NONE
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var bg: Color = colors[0]
	var border: Color = colors[1]
	var ink: Color = colors[2]
	var normal := UI.box(bg, border, radius, 1, Vector4(pad, 3, pad, 3))
	var hover := normal.duplicate() as StyleBoxFlat
	hover.bg_color = Color(bg.r, bg.g, bg.b, minf(1.0, bg.a + 0.05))
	hover.border_color = Color(border.r, border.g, border.b, minf(1.0, border.a + 0.1))
	for state in [["normal", normal], ["hover", hover], ["pressed", hover], ["hover_pressed", hover], ["focus", normal], ["disabled", normal]]:
		node.add_theme_stylebox_override(state[0], state[1])
	node.add_theme_font_override("font", UI.font(weight))
	node.add_theme_font_size_override("font_size", size)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color", "font_disabled_color"]:
		node.add_theme_color_override(name, ink)
	node.custom_minimum_size.y = height
	return node


static func pill_button(text: String, kind := "plain") -> Button:
	return styled_button(text, PILL_BUTTONS.get(kind, PILL_BUTTONS["plain"]), 999, 34, 14, 13, 700)


static func action_button(text: String, kind := "plain") -> Button:
	return styled_button(text, ACTION_BUTTONS.get(kind, ACTION_BUTTONS["plain"]), 9, 32, 12, 12, 700)


static func set_enabled(node: BaseButton, enabled: bool, faded := 0.55) -> void:
	node.disabled = not enabled
	node.modulate = Color(1, 1, 1, 1.0 if enabled else faded)
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if enabled else Control.CURSOR_ARROW


static func input_box(focus := false) -> StyleBoxFlat:
	return UI.box(Color(1, 1, 1, 0.045 if not focus else 0.07), Color(1, 1, 1, 0.1 if not focus else 0.24), 10, 1, Vector4(10, 7, 10, 7))


static func input(value: String, placeholder := "", on_change: Callable = Callable()) -> LineEdit:
	var node := LineEdit.new()
	node.text = value
	node.placeholder_text = placeholder
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.custom_minimum_size.y = 34
	node.add_theme_stylebox_override("normal", input_box(false))
	node.add_theme_stylebox_override("focus", input_box(true))
	node.add_theme_stylebox_override("read_only", input_box(false))
	node.add_theme_font_override("font", UI.font(400))
	node.add_theme_font_size_override("font_size", 12)
	node.add_theme_color_override("font_color", INPUT_INK)
	node.add_theme_color_override("font_uneditable_color", Color(INPUT_INK, 0.7))
	node.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.36))
	node.add_theme_color_override("caret_color", INPUT_INK)
	node.add_theme_color_override("selection_color", Color(UI.ACCENT, 0.35))
	if on_change.is_valid():
		node.text_changed.connect(func(text: String) -> void: on_change.call(text))
	return node


static func number_value(text: String) -> String:
	var pattern := RegEx.create_from_string("^-?(\\d+\\.?\\d*|\\.\\d+)([eE][-+]?\\d+)?$")
	return text if pattern.search(text) != null else ""


static func number_input(value: String, min_value: float, max_value: float, step: float, on_change: Callable = Callable(), placeholder := "") -> LineEdit:
	var node := input(value, placeholder)
	node.set_meta("accepted", value)
	node.text_changed.connect(func(text: String) -> void:
		var kept := ""
		for character in text:
			if "0123456789+-.eE".contains(character):
				kept += character
		if kept != text:
			var caret := node.caret_column - (text.length() - kept.length())
			node.text = kept
			node.caret_column = clampi(caret, 0, kept.length())
		if str(node.get_meta("accepted", "")) == kept:
			return
		node.set_meta("accepted", kept)
		if on_change.is_valid():
			on_change.call(number_value(kept)))
	node.gui_input.connect(func(event: InputEvent) -> void:
		var key := event as InputEventKey
		if key == null or not key.pressed or (key.keycode != KEY_UP and key.keycode != KEY_DOWN):
			return
		node.accept_event()
		var current := number_value(node.text)
		var number := current.to_float() if not current.is_empty() else 0.0
		var direction := 1.0 if key.keycode == KEY_UP else -1.0
		var steps := (number - min_value) / step
		var aligned := absf(steps - roundf(steps)) < 0.000001
		if not current.is_empty() and ((direction > 0.0 and number < min_value) or (direction < 0.0 and number > max_value)):
			number = min_value if direction > 0.0 else max_value
		elif aligned:
			number = min_value + (roundf(steps) + direction) * step
		else:
			number = min_value + (floorf(steps) + (1.0 if direction > 0.0 else 0.0)) * step
		number = clampf(snappedf(number, 0.0000001), min_value, max_value)
		var shown := js_number(number)
		node.text = shown
		node.caret_column = shown.length()
		node.text_changed.emit(shown))
	return node


static func area(value: String, min_height: float, on_change: Callable = Callable(), placeholder := "", mono := false, size := 12) -> TextEdit:
	var node := TextEdit.new()
	node.text = value
	node.placeholder_text = placeholder
	node.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.custom_minimum_size.y = min_height
	node.add_theme_stylebox_override("normal", input_box(false))
	node.add_theme_stylebox_override("focus", input_box(true))
	node.add_theme_stylebox_override("read_only", input_box(false))
	node.add_theme_font_override("font", UI.font(400, "Consolas") if mono else UI.font(400))
	node.add_theme_font_size_override("font_size", size)
	node.add_theme_color_override("font_color", INPUT_INK)
	node.add_theme_color_override("font_readonly_color", Color(INPUT_INK, 0.85))
	node.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.36))
	node.add_theme_color_override("caret_color", INPUT_INK)
	node.add_theme_color_override("selection_color", Color(UI.ACCENT, 0.35))
	node.add_theme_color_override("background_color", Color(0, 0, 0, 0))
	if on_change.is_valid():
		node.text_changed.connect(func() -> void: on_change.call(node.text))
	return node


static func select(options: Array, value: String, on_change: Callable = Callable()) -> OptionButton:
	var node := OptionButton.new()
	node.focus_mode = Control.FOCUS_NONE
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.custom_minimum_size.y = 34
	node.fit_to_longest_item = false
	node.clip_text = true
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	for state in ["normal", "focus", "disabled"]:
		node.add_theme_stylebox_override(state, input_box(false))
	for state in ["hover", "pressed"]:
		node.add_theme_stylebox_override(state, input_box(true))
	node.add_theme_font_override("font", UI.font(400))
	node.add_theme_font_size_override("font_size", 12)
	node.add_theme_color_override("font_color", INPUT_INK)
	node.add_theme_color_override("font_hover_color", INPUT_INK)
	var selected := -1
	for option in options:
		var pair: Array = option
		node.add_item(str(pair[1]))
		node.set_item_metadata(node.item_count - 1, str(pair[0]))
		if str(pair[0]) == value:
			selected = node.item_count - 1
	if selected >= 0:
		node.select(selected)
	if on_change.is_valid():
		node.item_selected.connect(func(index: int) -> void: on_change.call(str(node.get_item_metadata(index))))
	return node


static var _check_icons := {}


static func check_icon(checked: bool, faded: bool) -> Texture2D:
	var key := "%s:%s" % [checked, faded]
	if _check_icons.has(key):
		return _check_icons[key]
	var svg := "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' width='16' height='16'><rect x='1' y='1' width='14' height='14' rx='3.5' fill='#ffffff' fill-opacity='0.06' stroke='#ffffff' stroke-opacity='0.5' stroke-width='1.3'/></svg>"
	if checked:
		svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' width='16' height='16'><rect x='1' y='1' width='14' height='14' rx='3.5' fill='#2bc1f3'/><path d='M4.2 8.3l2.4 2.4 5-5.2' fill='none' stroke='#ffffff' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'/></svg>"
	var image := Image.new()
	if image.load_svg_from_string(svg, 1.0) != OK:
		return null
	if faded:
		image.convert(Image.FORMAT_RGBA8)
		for y in range(image.get_height()):
			for x in range(image.get_width()):
				var pixel := image.get_pixel(x, y)
				pixel.a *= 0.45
				image.set_pixel(x, y, pixel)
	var texture := ImageTexture.create_from_image(image)
	_check_icons[key] = texture
	return texture


static func check(text: String, value: bool, on_change: Callable = Callable(), size := 11, ink := Color(1, 1, 1, 0.62)) -> CheckBox:
	var node := CheckBox.new()
	node.text = text
	node.button_pressed = value
	node.focus_mode = Control.FOCUS_NONE
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	node.add_theme_icon_override("checked", check_icon(true, false))
	node.add_theme_icon_override("unchecked", check_icon(false, false))
	node.add_theme_icon_override("checked_disabled", check_icon(true, true))
	node.add_theme_icon_override("unchecked_disabled", check_icon(false, true))
	node.add_theme_constant_override("h_separation", 7)
	node.add_theme_font_override("font", UI.font(400))
	node.add_theme_font_size_override("font_size", size)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color", "font_disabled_color"]:
		node.add_theme_color_override(name, ink)
	if on_change.is_valid():
		node.toggled.connect(func(on: bool) -> void: on_change.call(on))
	return node


static func caps(text: String, size := 10, ink := Color(1, 1, 1, 0.58), weight := 800) -> Label:
	var node := UI.label(text.to_upper(), size, ink, weight, "Arial", 1)
	node.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return node


static func text(value: String, size := 12, ink := Color(1, 1, 1, 0.58), weight := 400) -> Label:
	var node := UI.wrapped(value, size, ink, weight)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


static func line(value: String, size := 12, ink := Color(1, 1, 1, 0.9), weight := 400) -> Label:
	var node := UI.label(value, size, ink, weight)
	node.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	node.clip_text = true
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


static func box(bg: Color, border: Color, radius: int, pad: Vector4, separation := 6) -> Array:
	return EditorKit.panel(bg, border, radius, pad, separation)


static func tone_box(message: String, bg: Color, border: Color, ink: Color, size := 12, radius := 12, pad := Vector4(11, 10, 11, 10)) -> PanelContainer:
	var parts := box(bg, border, radius, pad, 3)
	var column: VBoxContainer = parts[1]
	column.add_child(text(message, size, ink))
	return parts[0]


static func badge(value: String, bg: Color, border: Color, ink: Color, size := 9, weight := 900) -> PanelContainer:
	var holder := PanelContainer.new()
	holder.add_theme_stylebox_override("panel", UI.box(bg, border, 999, 1, Vector4(6, 2, 6, 2)))
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	holder.add_child(UI.label(value, size, ink, weight))
	return holder


static func section(title: String, open: bool, bg := Color(1, 1, 1, 0.025), border := Color(1, 1, 1, 0.075), radius := 13, pad := Vector4(12, 11, 12, 11), size := 12, weight := 850, ink := UI.WHITE) -> Dictionary:
	var parts := box(bg, border, radius, pad, 0)
	var column: VBoxContainer = parts[1]
	var summary := Button.new()
	summary.flat = true
	summary.focus_mode = Control.FOCUS_NONE
	summary.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	summary.alignment = HORIZONTAL_ALIGNMENT_LEFT
	summary.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	summary.add_theme_font_override("font", UI.font(weight))
	summary.add_theme_font_size_override("font_size", size)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		summary.add_theme_color_override(name, ink)
	var empty := StyleBoxEmpty.new()
	for state in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
		summary.add_theme_stylebox_override(state, empty)
	column.add_child(summary)
	var content := VBoxContainer.new()
	content.add_theme_constant_override("separation", 8)
	content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	content.visible = open
	column.add_child(content)
	var state := {"panel": parts[0], "content": content, "summary": summary, "title": title, "open": open}
	var refresh := func() -> void:
		summary.text = ("▾ " if bool(state["open"]) else "▸ ") + str(state["title"])
		content.visible = bool(state["open"])
	refresh.call()
	summary.pressed.connect(func() -> void:
		state["open"] = not bool(state["open"])
		refresh.call())
	state["refresh"] = refresh
	return state


static func remember(section_state: Dictionary, store: Dictionary, key: String) -> Dictionary:
	var summary: Button = section_state["summary"]
	summary.pressed.connect(func() -> void: store[key] = bool(section_state["open"]))
	return section_state


static func set_section_title(section_state: Dictionary, title: String) -> void:
	section_state["title"] = title
	(section_state["refresh"] as Callable).call()


static func grid(columns: int, h_gap := 9, v_gap := 9) -> GridContainer:
	var node := GridContainer.new()
	node.columns = columns
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.add_theme_constant_override("h_separation", h_gap)
	node.add_theme_constant_override("v_separation", v_gap)
	return node


static func field(label_text: String, control: Control) -> VBoxContainer:
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 5)
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.add_child(caps(label_text))
	column.add_child(control)
	return column


static func clean(value: Variant) -> String:
	if value == null:
		return ""
	var text_value := js_string(value)
	var spaces := RegEx.create_from_string("\\s+")
	return spaces.sub(text_value, " ", true).strip_edges()


static func js_string(value: Variant) -> String:
	match typeof(value):
		TYPE_NIL:
			return "null"
		TYPE_BOOL:
			return "true" if bool(value) else "false"
		TYPE_INT:
			return str(value)
		TYPE_FLOAT:
			return js_number(float(value))
		TYPE_DICTIONARY:
			return "[object Object]"
		TYPE_ARRAY:
			var parts: PackedStringArray = []
			for item in (value as Array):
				parts.append("" if item == null else js_string(item))
			return ",".join(parts)
	return str(value)


static func js_truthy(value: Variant) -> bool:
	match typeof(value):
		TYPE_NIL:
			return false
		TYPE_BOOL:
			return bool(value)
		TYPE_INT:
			return int(value) != 0
		TYPE_FLOAT:
			return float(value) != 0.0 and not is_nan(float(value))
		TYPE_STRING, TYPE_STRING_NAME:
			return not str(value).is_empty()
	return true


static func js_number(value: float) -> String:
	if is_nan(value) or is_inf(value):
		return "null"
	if is_equal_approx(value, roundf(value)) and absf(value) < 1e15:
		return str(int(roundf(value)))
	var shown := String.num(value, 10)
	if shown.contains("."):
		shown = shown.rstrip("0").rstrip(".")
	return shown


static func js_stringify(value: Variant, indent := "  ", level := 0) -> String:
	match typeof(value):
		TYPE_NIL:
			return "null"
		TYPE_BOOL:
			return "true" if bool(value) else "false"
		TYPE_INT:
			return str(value)
		TYPE_FLOAT:
			return js_number(float(value))
		TYPE_STRING, TYPE_STRING_NAME:
			return JSON.stringify(str(value))
		TYPE_ARRAY:
			var items: Array = value
			if items.is_empty():
				return "[]"
			var lines: PackedStringArray = []
			for item in items:
				lines.append(indent.repeat(level + 1) + js_stringify(item, indent, level + 1))
			return "[\n" + ",\n".join(lines) + "\n" + indent.repeat(level) + "]"
		TYPE_DICTIONARY:
			var entries: Dictionary = value
			if entries.is_empty():
				return "{}"
			var lines: PackedStringArray = []
			for key in entries:
				lines.append(indent.repeat(level + 1) + JSON.stringify(str(key)) + ": " + js_stringify(entries[key], indent, level + 1))
			return "{\n" + ",\n".join(lines) + "\n" + indent.repeat(level) + "}"
	return JSON.stringify(str(value))


static func parse_json(text: String) -> Array:
	var parser := JSON.new()
	if parser.parse(text) != OK:
		return [false, null]
	return [true, parser.data]


static func js_to_number(value: Variant) -> Array:
	match typeof(value):
		TYPE_NIL:
			return [false, 0.0]
		TYPE_BOOL:
			return [true, 1.0 if bool(value) else 0.0]
		TYPE_INT, TYPE_FLOAT:
			var number := float(value)
			return [not (is_nan(number) or is_inf(number)), number]
		TYPE_STRING, TYPE_STRING_NAME:
			var stripped := str(value).strip_edges()
			if stripped.is_empty():
				return [true, 0.0]
			if stripped.is_valid_float() or stripped.is_valid_int():
				return [true, stripped.to_float()]
			return [false, 0.0]
	return [false, 0.0]


static func base36(number: int) -> String:
	var digits := "0123456789abcdefghijklmnopqrstuvwxyz"
	if number <= 0:
		return "0"
	var out := ""
	var rest := number
	while rest > 0:
		out = digits[rest % 36] + out
		rest = rest / 36
	return out


static func now_base36() -> String:
	return base36(int(Time.get_unix_time_from_system() * 1000.0))


static func random_base36(length: int) -> String:
	var digits := "0123456789abcdefghijklmnopqrstuvwxyz"
	var out := ""
	for i in range(length):
		out += digits[randi() % 36]
	return out


static func decode_image(body: PackedByteArray, url_hint := "") -> Texture2D:
	if body.size() < 4:
		return null
	if ImageLoader.is_gif(body) or ImageLoader.is_avif(body):
		return ImageLoader.decode(body)
	var image := Image.new()
	var status := ERR_FILE_UNRECOGNIZED
	var head := body.slice(0, mini(body.size(), 512)).get_string_from_utf8().to_lower()
	if body[0] == 0x89 and body[1] == 0x50:
		status = image.load_png_from_buffer(body)
	elif body[0] == 0xFF and body[1] == 0xD8:
		status = image.load_jpg_from_buffer(body)
	elif body[0] == 0x52 and body[1] == 0x49:
		status = image.load_webp_from_buffer(body)
	elif head.contains("<svg") or url_hint.to_lower().contains(".svg"):
		status = image.load_svg_from_buffer(body, 1.0)
		if status == OK and image.get_height() > 0 and image.get_height() < 256:
			var scaled := Image.new()
			if scaled.load_svg_from_buffer(body, 256.0 / float(image.get_height())) == OK:
				image = scaled
	if status != OK:
		return null
	return ImageTexture.create_from_image(image)


static var _grabber: Texture2D


static func grabber() -> Texture2D:
	if _grabber:
		return _grabber
	var image := Image.create_empty(14, 14, false, Image.FORMAT_RGBA8)
	image.fill(Color(0, 0, 0, 0))
	for y in range(14):
		for x in range(14):
			var distance := Vector2(x + 0.5 - 7.0, y + 0.5 - 7.0).length()
			var alpha := clampf(6.5 - distance, 0.0, 1.0)
			if alpha > 0.0:
				image.set_pixel(x, y, Color(231 / 255.0, 231 / 255.0, 234 / 255.0, alpha))
	_grabber = ImageTexture.create_from_image(image)
	return _grabber


static func slider(value: float, min_value: float, max_value: float, step: float) -> HSlider:
	var node := HSlider.new()
	node.min_value = min_value
	node.max_value = max_value
	node.step = step
	node.value = value
	node.focus_mode = Control.FOCUS_NONE
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var track := UI.box(Color(1, 1, 1, 0.14), Color(0, 0, 0, 0), 999)
	track.content_margin_top = 2
	track.content_margin_bottom = 2
	var filled := UI.box(Color(231 / 255.0, 231 / 255.0, 234 / 255.0, 0.72), Color(0, 0, 0, 0), 999)
	filled.content_margin_top = 2
	filled.content_margin_bottom = 2
	node.add_theme_stylebox_override("slider", track)
	node.add_theme_stylebox_override("grabber_area", filled)
	node.add_theme_stylebox_override("grabber_area_highlight", filled)
	node.add_theme_icon_override("grabber", grabber())
	node.add_theme_icon_override("grabber_highlight", grabber())
	return node


class AutoGrid extends GridContainer:
	var min_cell := 208.0
	var gap := 9.0

	func _init(cell := 208.0, spacing := 9.0) -> void:
		min_cell = cell
		gap = spacing
		columns = 1
		size_flags_horizontal = Control.SIZE_EXPAND_FILL
		add_theme_constant_override("h_separation", int(spacing))
		add_theme_constant_override("v_separation", int(spacing))

	func _notification(what: int) -> void:
		if what == NOTIFICATION_RESIZED:
			var wanted := maxi(1, int(floor((size.x + gap) / (min_cell + gap))))
			if wanted != columns:
				columns = wanted


class Bar extends Control:
	var percent := 0.0

	func _init(value := 0.0) -> void:
		percent = value
		custom_minimum_size.y = 8
		size_flags_horizontal = Control.SIZE_EXPAND_FILL
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func _draw() -> void:
		draw_style_box(UI.box(Color(1, 1, 1, 0.08), Color(0, 0, 0, 0), 999), Rect2(Vector2.ZERO, size))
		var width := size.x * clampf(percent, 0.0, 100.0) / 100.0
		if width > 0.5:
			draw_style_box(UI.box(Color(231 / 255.0, 231 / 255.0, 234 / 255.0, 0.72), Color(0, 0, 0, 0), 999), Rect2(Vector2.ZERO, Vector2(width, size.y)))


static func data_url_texture(url: String) -> Texture2D:
	var comma := url.find(",")
	if comma < 0 or not url.substr(0, comma).contains(";base64"):
		return null
	var bytes := Marshalls.base64_to_raw(url.substr(comma + 1))
	return decode_image(bytes, url.substr(0, comma))
