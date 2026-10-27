class_name WorkshopUI
extends RefCounted

const NAV := Color("#0d0f14")
const PANEL := Color("#12141a")
const CARD := Color("#171a22")
const MAP_BG := Color("#111113")
const ACCENT_GREY := Color("#e7e7ea")
const ACCENT := Color("#2bc1f3")
const INK := Color(1, 1, 1, 1)
const DIM := Color(1, 1, 1, 0.55)
const SECTION := Color(1, 1, 1, 0.4)
const BORDER := Color(1, 1, 1, 0.08)
const RED := Color("#f87171")
const AMBER := Color("#fbbf24")
const WARN := Color("#fde68a")
const GREEN := Color("#86efac")
const BAD := Color("#fca5a5")

const PATHS := {
	"select": ["M12.586 12.586 19 19", "M3.688 3.037a.497.497 0 0 0-.651.651l6.5 15.999a.501.501 0 0 0 .947-.062l1.569-6.083a2 2 0 0 1 1.448-1.479l6.124-1.579a.5.5 0 0 0 .063-.947z"],
	"lasso": ["M7 22a5 5 0 0 1-2-4", "M3.3 14A6.8 6.8 0 0 1 2 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12 12 0 0 1-5-1", "circle:5,20,2"],
	"eraser": ["m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21", "M22 21H7", "m5 11 9 9"],
	"pan": ["M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2", "M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2", "M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8", "M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"],
	"draw": ["rect:3,3,18,18,2"],
	"modify": ["M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7", "M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"],
	"split": ["circle:6,6,3", "M8.12 8.12 12 12", "M20 4 8.12 15.88", "circle:6,18,3", "M14.8 14.8 20 20"],
	"move": ["M12 2v20", "m15 19-3 3-3-3", "m19 9 3 3-3 3", "M2 12h20", "m5 9-3 3 3 3", "m9 5 3-3 3 3"],
	"merge": ["circle:18,18,3", "circle:6,6,3", "M6 21V9a9 9 0 0 0 9 9"],
	"paint": ["M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"],
	"feature": ["M19.914 11.105A7.298 7.298 0 0 0 20 10a8 8 0 0 0-16 0c0 4.993 5.539 10.193 7.399 11.799a1 1 0 0 0 1.202 0 32 32 0 0 0 .824-.738", "circle:12,10,3", "M16 18h6", "M19 15v6"],
	"undo": ["M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5"],
	"redo": ["M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8", "M21 3v5h-5"],
	"fit": ["M15 3h6v6", "m21 3-7 7", "m3 21 7-7", "M9 21H3v-6"],
	"trash": ["M3 6h18", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2", "M10 11v6", "M14 11v6"],
	"copy": ["rect:9,9,13,13,2", "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"],
	"layers": ["M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z", "M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12", "M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"],
	"list": ["M3 5h.01", "M3 12h.01", "M3 19h.01", "M8 5h13", "M8 12h13", "M8 19h13"],
	"types": ["M10 13h4", "M12 6v7", "M16 8V6H8v2", "M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"],
	"pin": ["M15 22a1 1 0 0 1-1-1v-4a1 1 0 0 1 .445-.832l3-2a1 1 0 0 1 1.11 0l3 2A1 1 0 0 1 22 17v4a1 1 0 0 1-1 1z", "M18 10a8 8 0 0 0-16 0c0 4.993 5.539 10.193 7.399 11.799a1 1 0 0 0 .601.2", "circle:10,10,3"],
	"unit": ["M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z", "M12 8v8", "M8 12h8"],
	"search": ["M21 21-4.34-4.34", "circle:11,11,8"],
	"close": ["M18 6 6 18", "m6 6 12 12"],
	"plus": ["M5 12h14", "M12 5v14"],
	"image": ["rect:3,3,18,18,2", "circle:9,9,2", "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"],
	"boxSelect": ["M12.034 12.681a.498.498 0 0 1 .647-.647l9 3.5a.5.5 0 0 1-.033.943l-3.444 1.068a1 1 0 0 0-.66.66l-1.067 3.443a.5.5 0 0 1-.943.033z", "M5 3a2 2 0 0 0-2 2", "M19 3a2 2 0 0 1 2 2", "M5 21a2 2 0 0 1-2-2", "M9 3h1", "M9 21h2", "M14 3h1", "M3 9v1", "M21 9v2", "M3 14v1"],
	"save": ["M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7", "M7 3v4a1 1 0 0 0 1 1h7"],
	"mountain": ["m8 3 4 8 5-5 5 15H2L8 3z"],
	"wall": ["rect:3,3,18,18,2", "M12 9v6", "M16 15v6", "M16 3v6", "M3 15h18", "M3 9h18", "M8 15v6", "M8 3v6"],
	"climate": ["M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242", "M8 15h.01", "M8 19h.01", "M12 17h.01", "M12 21h.01", "M16 15h.01", "M16 19h.01"],
	"map": ["M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z", "M15 5.764v15", "M9 3.236v15"],
	"flag": ["M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"],
	"users": ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "circle:9,7,4", "M22 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
	"globe": ["circle:12,12,10", "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20", "M2 12h20"],
	"upload": ["M12 3v12", "m17 8-5-5-5 5", "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"],
	"file": ["M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", "M14 2v4a2 2 0 0 0 2 2h4"],
	"chevronDown": ["m6 9 6 6 6-6"],
	"chevronLeft": ["m15 18-6-6 6-6"],
	"chevronRight": ["m9 18 6-6-6-6"],
	"settings": ["M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z", "circle:12,12,3"],
	"menu": ["M4 6h16", "M4 12h16", "M4 18h16"],
	"review": ["M7.9 20A9 9 0 1 0 4 16.1L2 22Z"],
}

static var _icon_cache := {}
static var _flag_cache := {}


static func svg_of(name: String, stroke := 2.0) -> String:
	var parts: Array = PATHS.get(name, [])
	var body := ""
	for part in parts:
		var text := str(part)
		if text.begins_with("rect:"):
			var v := text.substr(5).split(",")
			body += "<rect x='%s' y='%s' width='%s' height='%s' rx='%s'/>" % [v[0], v[1], v[2], v[3], v[4] if v.size() > 4 else "0"]
		elif text.begins_with("circle:"):
			var c := text.substr(7).split(",")
			body += "<circle cx='%s' cy='%s' r='%s'/>" % [c[0], c[1], c[2]]
		else:
			body += "<path d='%s'/>" % text
	return "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='#ffffff' stroke-width='%s' stroke-linecap='round' stroke-linejoin='round'>%s</svg>" % [str(stroke), body]


static func icon(name: String, size := 16, color := Color(1, 1, 1, 1)) -> Texture2D:
	var key := "%s:%d:%s" % [name, size, color.to_html()]
	if _icon_cache.has(key):
		return _icon_cache[key]
	var svg := svg_of(name).replace("#ffffff", "#" + color.to_html(false))
	var image := Image.new()
	if image.load_svg_from_string(svg, float(size) / 24.0) != OK:
		return null
	if color.a < 1.0:
		image.convert(Image.FORMAT_RGBA8)
		for y in range(image.get_height()):
			for x in range(image.get_width()):
				var pixel := image.get_pixel(x, y)
				pixel.a *= color.a
				image.set_pixel(x, y, pixel)
	var texture := ImageTexture.create_from_image(image)
	_icon_cache[key] = texture
	return texture


static func icon_rect(name: String, size := 16, color := Color(1, 1, 1, 1)) -> TextureRect:
	var rect := TextureRect.new()
	rect.texture = icon(name, size, color)
	rect.custom_minimum_size = Vector2(size, size)
	rect.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	rect.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	return rect


static func flag_texture(value: String, file := "", height := 40) -> Texture2D:
	var key := "%s|%s|%d" % [value.md5_text() if value.length() > 120 else value, file, height]
	if _flag_cache.has(key):
		return _flag_cache[key]
	var texture: Texture2D = null
	if not file.is_empty():
		texture = UI.flag(file, height)
	elif value.begins_with("data:"):
		var comma := value.find(",")
		if comma > 0:
			var raw := Marshalls.base64_to_raw(value.substr(comma + 1))
			var image := Image.new()
			var status := ERR_FILE_UNRECOGNIZED
			if raw.size() > 4 and raw[0] == 0x89 and raw[1] == 0x50:
				status = image.load_png_from_buffer(raw)
			elif raw.size() > 4 and raw[0] == 0xFF and raw[1] == 0xD8:
				status = image.load_jpg_from_buffer(raw)
			elif raw.size() > 4 and raw[0] == 0x52 and raw[1] == 0x49:
				status = image.load_webp_from_buffer(raw)
			elif value.begins_with("data:image/svg"):
				status = image.load_svg_from_buffer(raw, 1.0)
			if status == OK and image.get_height() > 0:
				texture = ImageTexture.create_from_image(image)
	_flag_cache[key] = texture
	return texture


static func font_size(px: float) -> int:
	return int(round(px))


static func label(text: String, px := 13.0, color := Color(1, 1, 1, 1), weight := 400) -> Label:
	var node := UI.label(text, font_size(px), color, weight)
	return node


static func wrap(text: String, px := 12.0, color := Color(1, 1, 1, 0.55), weight := 400) -> Label:
	var node := UI.wrapped(text, font_size(px), color, weight)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


static func section_label(text: String, px := 10.5) -> Label:
	return UI.label(text.to_upper(), font_size(px), SECTION, 700, "Arial", 1)


static func label_dim(text: String) -> Label:
	var node := UI.label(text.to_upper(), 11, Color(1, 1, 1, 0.55), 600)
	node.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return node


static func small_label(text: String, alpha := 0.48) -> Label:
	var node := UI.label(text, 11, Color(1, 1, 1, alpha), 400)
	node.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return node


static func _flat_styles(node: Button, normal: StyleBoxFlat, hover: StyleBoxFlat, pressed: StyleBoxFlat, disabled: StyleBoxFlat) -> void:
	node.add_theme_stylebox_override("normal", normal)
	node.add_theme_stylebox_override("hover", hover)
	node.add_theme_stylebox_override("pressed", pressed)
	node.add_theme_stylebox_override("hover_pressed", pressed)
	node.add_theme_stylebox_override("focus", normal)
	node.add_theme_stylebox_override("disabled", disabled)


static func _ink(node: Button, color: Color, px := 12.0, weight := 600) -> void:
	node.add_theme_font_override("font", UI.font(weight))
	node.add_theme_font_size_override("font_size", font_size(px))
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		node.add_theme_color_override(name, color)
	node.add_theme_color_override("font_disabled_color", Color(color, color.a * 0.45))
	node.add_theme_color_override("icon_normal_color", color)
	node.add_theme_color_override("icon_hover_color", color)
	node.add_theme_color_override("icon_pressed_color", color)
	node.add_theme_color_override("icon_disabled_color", Color(color, 0.35))


static func base_button(text := "") -> Button:
	var node := Button.new()
	node.text = text
	node.focus_mode = Control.FOCUS_NONE
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	return node


static func pill(text: String, active := false, ink := Color(1, 1, 1, 1)) -> Button:
	var node := base_button(text)
	var bg := Color(1, 1, 1, 0.12) if active else Color(1, 1, 1, 0.06)
	var border := Color(1, 1, 1, 0.26) if active else Color(1, 1, 1, 0.12)
	var normal := UI.box(bg, border, 9, 1, Vector4(11, 6, 11, 6))
	var hover := UI.box(Color(bg, minf(1.0, bg.a + 0.05)), Color(border, minf(1.0, border.a + 0.1)), 9, 1, Vector4(11, 6, 11, 6))
	_flat_styles(node, normal, hover, hover, normal)
	_ink(node, ink, 12.0, 600)
	node.custom_minimum_size.y = 28
	return node


static func danger_pill(text: String) -> Button:
	return pill(text, false, RED)


static func tool_button(icon_name: String, active: bool, tooltip := "", size := 17, height := 36.0) -> Button:
	var node := base_button("")
	var bg := Color(1, 1, 1, 0.12) if active else Color(1, 1, 1, 0.04)
	var border := Color(1, 1, 1, 0.26) if active else Color(1, 1, 1, 0.08)
	var normal := UI.box(bg, border, 10, 1, Vector4(0, 0, 0, 0))
	var hover := UI.box(Color(1, 1, 1, maxf(bg.a, 0.08)), Color(1, 1, 1, maxf(border.a, 0.16)), 10, 1, Vector4(0, 0, 0, 0))
	_flat_styles(node, normal, hover, hover, normal)
	var ink := Color(1, 1, 1, 1) if active else Color(236 / 255.0, 236 / 255.0, 240 / 255.0, 0.78)
	node.icon = icon(icon_name, size, ink)
	node.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
	node.tooltip_text = tooltip
	node.custom_minimum_size = Vector2(28, height)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


static func icon_button(icon_name: String, tooltip := "", size := 15, box := 28.0, ink := Color(1, 1, 1, 0.8)) -> Button:
	var node := base_button("")
	var normal := UI.box(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.1), 9, 1, Vector4(0, 0, 0, 0))
	var hover := UI.box(Color(1, 1, 1, 0.1), Color(1, 1, 1, 0.18), 9, 1, Vector4(0, 0, 0, 0))
	_flat_styles(node, normal, hover, hover, normal)
	node.icon = icon(icon_name, size, ink)
	node.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
	node.tooltip_text = tooltip
	node.custom_minimum_size = Vector2(box, box)
	return node


static func bare_icon(icon_name: String, tooltip := "", ink := Color(1, 1, 1, 0.7), size := 14) -> Button:
	var node := base_button("")
	var clear := UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 6, 0, Vector4(2, 2, 2, 2))
	var hover := UI.box(Color(1, 1, 1, 0.06), Color(0, 0, 0, 0), 6, 0, Vector4(2, 2, 2, 2))
	_flat_styles(node, clear, hover, hover, clear)
	node.icon = icon(icon_name, size, ink)
	node.tooltip_text = tooltip
	node.custom_minimum_size = Vector2(22, 22)
	return node


static func nav_item(icon_name: String, text: String, value := "", count := -1, active := false) -> Button:
	var node := base_button("")
	var bg := Color(1, 1, 1, 0.1) if active else Color(0, 0, 0, 0)
	var border := Color(1, 1, 1, 0.18) if active else Color(0, 0, 0, 0)
	var normal := UI.box(bg, border, 9, 1, Vector4(10, 0, 10, 0))
	var hover := UI.box(Color(1, 1, 1, 0.06 if not active else 0.12), Color(1, 1, 1, 0.12 if not active else 0.2), 9, 1, Vector4(10, 0, 10, 0))
	_flat_styles(node, normal, hover, hover, normal)
	node.custom_minimum_size.y = 34
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	row.offset_left = 10
	row.offset_right = -10
	var ink := Color(1, 1, 1, 1) if active else Color(236 / 255.0, 236 / 255.0, 240 / 255.0, 0.74)
	var glyph := icon_rect(icon_name, 16, Color(ink, 1.0 if active else 0.8))
	row.add_child(glyph)
	var caption := UI.label(text, 13, ink, 700 if active else 600)
	caption.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	caption.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	caption.clip_text = true
	caption.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	row.add_child(caption)
	if not value.is_empty():
		var short := value if value.length() <= 13 else value.substr(0, 12) + "…"
		var shown := UI.label(short, 12, Color(1, 1, 1, 0.45), 600)
		shown.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(shown)
		node.tooltip_text = "%s: %s" % [text, value]
	if count >= 0:
		var chip := PanelContainer.new()
		chip.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.07), Color(1, 1, 1, 0.08), 999, 1, Vector4(7, 1, 7, 1)))
		chip.mouse_filter = Control.MOUSE_FILTER_IGNORE
		chip.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		chip.custom_minimum_size.x = 22
		var count_label := UI.label(str(count), 11, Color(1, 1, 1, 0.7), 700)
		count_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		chip.add_child(count_label)
		row.add_child(chip)
	node.add_child(row)
	return node


static func _input_style(focus := false, radius := 10, margin := Vector4(10, 6, 10, 6)) -> StyleBoxFlat:
	return UI.box(Color(1, 1, 1, 0.04) if not focus else Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.1) if not focus else Color(1, 1, 1, 0.26), radius, 1, margin)


static func input(value: String, placeholder := "", on_change: Callable = Callable(), px := 13.6, height := 34.0) -> LineEdit:
	var node := LineEdit.new()
	node.text = value
	node.placeholder_text = placeholder
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.custom_minimum_size.y = height
	node.add_theme_stylebox_override("normal", _input_style(false))
	node.add_theme_stylebox_override("focus", _input_style(true))
	node.add_theme_stylebox_override("read_only", _input_style(false))
	node.add_theme_font_override("font", UI.font(400))
	node.add_theme_font_size_override("font_size", font_size(px))
	node.add_theme_color_override("font_color", Color(1, 1, 1, 1))
	node.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.38))
	node.add_theme_color_override("caret_color", Color(1, 1, 1, 1))
	node.add_theme_color_override("selection_color", Color(ACCENT, 0.35))
	if on_change.is_valid():
		node.text_changed.connect(func(text: String) -> void: on_change.call(text))
	return node


static func area(value: String, rows := 3, placeholder := "", on_change: Callable = Callable(), px := 12.5) -> TextEdit:
	var node := TextEdit.new()
	node.text = value
	node.placeholder_text = placeholder
	node.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.custom_minimum_size.y = rows * 18 + 16
	node.add_theme_stylebox_override("normal", _input_style(false, 10, Vector4(8, 6, 8, 6)))
	node.add_theme_stylebox_override("focus", _input_style(true, 10, Vector4(8, 6, 8, 6)))
	node.add_theme_font_override("font", UI.font(400))
	node.add_theme_font_size_override("font_size", font_size(px))
	node.add_theme_color_override("font_color", Color(1, 1, 1, 1))
	node.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.38))
	node.add_theme_color_override("caret_color", Color(1, 1, 1, 1))
	node.add_theme_color_override("background_color", Color(0, 0, 0, 0))
	if on_change.is_valid():
		node.text_changed.connect(func() -> void: on_change.call(node.text))
	return node


static func select(options: Array, value: String, on_change: Callable = Callable(), px := 12.0, height := 30.0) -> OptionButton:
	var node := OptionButton.new()
	node.focus_mode = Control.FOCUS_NONE
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.custom_minimum_size.y = height
	node.fit_to_longest_item = false
	node.clip_text = true
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	for state in ["normal", "focus", "disabled"]:
		node.add_theme_stylebox_override(state, _input_style(false, 10, Vector4(8, 4, 8, 4)))
	for state in ["hover", "pressed"]:
		node.add_theme_stylebox_override(state, _input_style(true, 10, Vector4(8, 4, 8, 4)))
	node.add_theme_font_override("font", UI.font(400))
	node.add_theme_font_size_override("font_size", font_size(px))
	node.add_theme_color_override("font_color", Color(1, 1, 1, 1))
	node.add_theme_color_override("font_hover_color", Color(1, 1, 1, 1))
	var selected := -1
	for option in options:
		var pair: Array = option
		node.add_item(str(pair[1]))
		node.set_item_metadata(node.item_count - 1, str(pair[0]))
		if pair.size() > 2 and bool(pair[2]):
			node.set_item_disabled(node.item_count - 1, true)
		if str(pair[0]) == value and selected < 0:
			selected = node.item_count - 1
	if selected >= 0:
		node.select(selected)
	elif node.item_count > 0:
		node.select(0)
	if on_change.is_valid():
		node.item_selected.connect(func(index: int) -> void: on_change.call(str(node.get_item_metadata(index))))
	return node


static func toggle(value: bool, on_change: Callable = Callable()) -> Button:
	var node := base_button("")
	node.toggle_mode = true
	node.button_pressed = value
	node.custom_minimum_size = Vector2(38, 22)
	node.size_flags_horizontal = Control.SIZE_SHRINK_END
	node.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var clear := StyleBoxEmpty.new()
	for state in ["normal", "hover", "pressed", "hover_pressed", "focus", "disabled"]:
		node.add_theme_stylebox_override(state, clear)
	var knob := Switch.new()
	knob.on = value
	knob.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	knob.mouse_filter = Control.MOUSE_FILTER_IGNORE
	node.add_child(knob)
	node.toggled.connect(func(on: bool) -> void:
		knob.on = on
		knob.queue_redraw()
		if on_change.is_valid():
			on_change.call(on))
	return node


class Switch extends Control:
	var on := false

	func _draw() -> void:
		var rect := Rect2(Vector2.ZERO, size)
		var track := StyleBoxFlat.new()
		track.bg_color = WorkshopUI.ACCENT_GREY if on else Color(1, 1, 1, 0.12)
		track.border_color = Color(1, 1, 1, 0.2)
		track.set_border_width_all(1)
		track.set_corner_radius_all(11)
		track.anti_aliasing = true
		draw_style_box(track, rect)
		var x := rect.size.x - 11.0 if on else 11.0
		draw_circle(Vector2(x, rect.size.y * 0.5), 8.0, Color(1, 1, 1, 1), true, -1.0, true)


static func _check_icon(on: bool, faded: bool) -> Texture2D:
	var key := "check:%s:%s" % [on, faded]
	if _icon_cache.has(key):
		return _icon_cache[key]
	var box := "<rect x='1.5' y='1.5' width='13' height='13' rx='3' fill='%s' fill-opacity='%s' stroke='%s' stroke-opacity='%s' stroke-width='1.2'/>" % ["#e7e7ea" if on else "#ffffff", "1" if on else "0.06", "#e7e7ea" if on else "#ffffff", "1" if on else "0.55"]
	var mark := "<path d='M4.5 8.3l2.4 2.4 4.6-5.2' fill='none' stroke='#12141a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/>" if on else ""
	var svg := "<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16' opacity='%s'>%s%s</svg>" % ["0.45" if faded else "1", box, mark]
	var image := Image.new()
	if image.load_svg_from_string(svg, 1.0) != OK:
		return null
	var texture := ImageTexture.create_from_image(image)
	_icon_cache[key] = texture
	return texture


static func check(text: String, value: bool, on_change: Callable = Callable(), px := 12.0) -> CheckBox:
	var node := CheckBox.new()
	node.text = text
	node.button_pressed = value
	node.add_theme_icon_override("checked", _check_icon(true, false))
	node.add_theme_icon_override("unchecked", _check_icon(false, false))
	node.add_theme_icon_override("checked_disabled", _check_icon(true, true))
	node.add_theme_icon_override("unchecked_disabled", _check_icon(false, true))
	node.add_theme_constant_override("h_separation", 7)
	node.focus_mode = Control.FOCUS_NONE
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	node.add_theme_font_override("font", UI.font(500))
	node.add_theme_font_size_override("font_size", font_size(px))
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color"]:
		node.add_theme_color_override(name, Color(1, 1, 1, 0.86))
	if on_change.is_valid():
		node.toggled.connect(func(on: bool) -> void: on_change.call(on))
	return node


static func color_field(rgb: Array, on_change: Callable = Callable()) -> ColorPickerButton:
	var node := ColorPickerButton.new()
	node.color = rgb_color(rgb)
	node.edit_alpha = false
	node.focus_mode = Control.FOCUS_NONE
	node.custom_minimum_size = Vector2(40, 26)
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var style := UI.box(Color(0, 0, 0, 0), Color(1, 1, 1, 0.2), 6, 1, Vector4(2, 2, 2, 2))
	for state in ["normal", "hover", "pressed", "focus", "hover_pressed", "disabled"]:
		node.add_theme_stylebox_override(state, style)
	if on_change.is_valid():
		node.popup_closed.connect(func() -> void: on_change.call(color_rgb(node.color)))
	return node


static func rgb_color(rgb: Variant) -> Color:
	if rgb is Array and (rgb as Array).size() >= 3:
		var list: Array = rgb
		return Color8(int(list[0]), int(list[1]), int(list[2]))
	return Color8(128, 128, 128)


static func color_rgb(color: Color) -> Array:
	return [int(round(color.r * 255.0)), int(round(color.g * 255.0)), int(round(color.b * 255.0))]


static func hex(color: Color) -> String:
	return "#" + color.to_html(false)


static func number_field(value: Variant, on_change: Callable, width := 76.0) -> LineEdit:
	var text := ""
	if value != null:
		var number := float(value)
		text = str(int(number)) if is_equal_approx(number, roundf(number)) else str(snappedf(number, 0.0001))
	var node := input(text, "", Callable(), 12.0, 28.0)
	node.custom_minimum_size.x = width
	node.size_flags_horizontal = Control.SIZE_SHRINK_END
	node.alignment = HORIZONTAL_ALIGNMENT_RIGHT
	node.text_changed.connect(func(next: String) -> void:
		var trimmed := next.strip_edges()
		if trimmed.is_empty():
			on_change.call(null)
		elif trimmed.is_valid_float():
			on_change.call(trimmed.to_float()))
	return node


static func row(text: String, control: Control, tooltip := "") -> HBoxContainer:
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 8)
	line.tooltip_text = tooltip
	var caption := UI.label(text, 12, Color(1, 1, 1, 0.72), 400)
	caption.custom_minimum_size.x = 120
	caption.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	caption.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	caption.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	line.add_child(caption)
	var holder := HBoxContainer.new()
	holder.alignment = BoxContainer.ALIGNMENT_END
	holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	holder.add_child(control)
	line.add_child(holder)
	return line


static func field(text: String, control: Control, tooltip := "") -> VBoxContainer:
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 4)
	column.tooltip_text = tooltip
	column.add_child(UI.label(text, 12, Color(1, 1, 1, 0.72), 400))
	column.add_child(control)
	return column


static func swatch(color: Color, size := 14.0, radius := 4) -> Panel:
	var node := Panel.new()
	node.custom_minimum_size = Vector2(size, size)
	node.add_theme_stylebox_override("panel", UI.box(color, Color(1, 1, 1, 0.25), radius, 1))
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	node.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	return node


static func rule() -> ColorRect:
	var line := ColorRect.new()
	line.color = Color(1, 1, 1, 0.1)
	line.custom_minimum_size.y = 1
	line.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return line


static func card(radius := 8, bg := Color(1, 1, 1, 0.035), border := Color(1, 1, 1, 0.08), margin := Vector4(9, 7, 9, 7), separation := 6) -> Array:
	var holder := PanelContainer.new()
	holder.add_theme_stylebox_override("panel", UI.box(bg, border, radius, 1, margin))
	holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", separation)
	holder.add_child(column)
	return [holder, column]


static func clickable(panel: Control, action: Callable) -> void:
	panel.mouse_filter = Control.MOUSE_FILTER_STOP
	panel.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	panel.gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventMouseButton:
			var mouse := event as InputEventMouseButton
			if mouse.button_index == MOUSE_BUTTON_LEFT and not mouse.pressed:
				action.call(mouse))


static func ignore_mouse(node: Node) -> void:
	for child in node.get_children():
		if child is Control and not (child is BaseButton) and not (child is LineEdit) and not (child is TextEdit) and not (child is Range):
			(child as Control).mouse_filter = Control.MOUSE_FILTER_IGNORE
		ignore_mouse(child)


static func clear(node: Node) -> void:
	for child in node.get_children():
		node.remove_child(child)
		child.queue_free()


static func format_count(value: int) -> String:
	var text := str(absi(value))
	var out := ""
	var count := 0
	for index in range(text.length() - 1, -1, -1):
		out = text[index] + out
		count += 1
		if count % 3 == 0 and index > 0:
			out = "," + out
	return ("-" if value < 0 else "") + out


static func code_to_color(code: String) -> Color:
	var h := 0
	for index in range(code.length()):
		h = (h * 31 + code.unicode_at(index)) & 0xFFFFFFFF
	var hue := h % 360
	var c := 0.5
	var x := c * (1.0 - absf(fmod(float(hue) / 60.0, 2.0) - 1.0))
	var m := 0.25
	var rgb := [c, x, 0.0]
	if hue < 60:
		rgb = [c, x, 0.0]
	elif hue < 120:
		rgb = [x, c, 0.0]
	elif hue < 180:
		rgb = [0.0, c, x]
	elif hue < 240:
		rgb = [0.0, x, c]
	elif hue < 300:
		rgb = [x, 0.0, c]
	else:
		rgb = [c, 0.0, x]
	return Color8(int(round((float(rgb[0]) + m) * 255.0)), int(round((float(rgb[1]) + m) * 255.0)), int(round((float(rgb[2]) + m) * 255.0)))
