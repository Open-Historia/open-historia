class_name UI
extends RefCounted

const ACCENT := Color("#2bc1f3")
const PAGE := Color("#131315")
const RAIL := Color("#0b0b0d")
const CARD := Color8(18, 20, 26)
const INK := Color8(246, 246, 247)
const WHITE := Color(1, 1, 1)
const BUTTON_INK := Color(246 / 255.0, 246 / 255.0, 248 / 255.0, 0.92)
const MUTED := Color(228 / 255.0, 228 / 255.0, 235 / 255.0, 0.78)
const SOFT := Color(244 / 255.0, 244 / 255.0, 245 / 255.0, 0.66)
const FAINT := Color(1, 1, 1, 0.5)
const RAIL_INK := Color(236 / 255.0, 236 / 255.0, 240 / 255.0, 0.7)
const HUD_BG := Color(18 / 255.0, 18 / 255.0, 20 / 255.0, 0.52)
const HUD_BG_STRONG := Color(17 / 255.0, 17 / 255.0, 19 / 255.0, 0.66)
const HUD_BUTTON := Color(35 / 255.0, 35 / 255.0, 39 / 255.0, 0.53)
const HUD_PILL := Color(34 / 255.0, 34 / 255.0, 37 / 255.0, 0.53)
const HUD_BORDER := Color(236 / 255.0, 236 / 255.0, 238 / 255.0, 0.17)
const HUD_BLUE := Color(147 / 255.0, 197 / 255.0, 253 / 255.0, 0.88)
const PROBLEM := Color("#ef4444")

const ICONS := {
	"games": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'><rect x='3.5' y='5' width='17' height='14' rx='3'/><path d='m10.3 9.2 4.5 2.8-4.5 2.8z' fill='#fff' stroke='none'/></svg>",
	"scenarios": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'><path d='M9 4.5 3.5 6.5v13l5.5-2 6 2 5.5-2v-13l-5.5 2z'/><path d='M9 4.5v13M15 6.5v13'/></svg>",
	"community": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='12' r='8.5'/><path d='M3.5 12h17'/><path d='M12 3.5c2.3 2.3 3.5 5.2 3.5 8.5s-1.2 6.2-3.5 8.5c-2.3-2.3-3.5-5.2-3.5-8.5s1.2-6.2 3.5-8.5z'/></svg>",
	"lobbies": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'><circle cx='8.5' cy='8.5' r='3'/><circle cx='16.5' cy='9.5' r='2.4'/><path d='M3 19c.5-3 2.6-4.8 5.5-4.8s5 1.8 5.5 4.8'/><path d='M14.8 14.6c.5-.2 1.1-.3 1.7-.3 2.3 0 4 1.5 4.5 4.2'/></svg>",
	"settings": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='12' r='3'/><path d='M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z'/></svg>",
	"refresh": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'><path d='M20 11a8 8 0 1 0 2.1 5.4'/><path d='M20 4v7h-7'/></svg>",
	"import": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'><path d='M12 4v11'/><path d='m7.5 10.5 4.5 4.5 4.5-4.5'/><path d='M4.5 19.5h15'/></svg>",
	"play": "<svg viewBox='0 0 24 24'><path d='m9 7 8 5-8 5z' fill='#fff'/></svg>",
	"archive": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'><path d='M4.5 7.5h15v11a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18.5z'/><path d='M3.5 4.5h17v3h-17z'/><path d='M9 12h6'/></svg>",
	"edit": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'><path d='M4.5 19.5 9 18l9-9a2.1 2.1 0 0 0-3-3l-9 9-1.5 4.5z'/><path d='m13.5 7.5 3 3'/></svg>",
	"clone": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'><rect x='9' y='9' width='10' height='10' rx='2'/><path d='M6.5 15H6A2 2 0 0 1 4 13V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v.5'/></svg>",
	"plus": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2.4' stroke-linecap='round'><path d='M12 6v12M6 12h12'/></svg>",
	"close": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'><path d='M6.5 6.5l11 11M17.5 6.5l-11 11'/></svg>",
	"more": "<svg viewBox='0 0 24 24' fill='#fff'><circle cx='12' cy='5.5' r='1.7'/><circle cx='12' cy='12' r='1.7'/><circle cx='12' cy='18.5' r='1.7'/></svg>",
	"chat": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'><path d='M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z'/><path d='M8 9h8'/><path d='M8 13h5'/></svg>",
	"actions": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M12 2L13.5 9.5L21 11L13.5 12.5L12 20L10.5 12.5L3 11L10.5 9.5L12 2Z'/></svg>",
	"events": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'><rect x='4' y='3' width='16' height='18' rx='2'/><path d='M8 8h8'/><path d='M8 12h8'/><path d='M8 16h5'/></svg>",
	"search": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2.5' stroke-linecap='round'><circle cx='11' cy='11' r='7'/><line x1='16.5' y1='16.5' x2='22' y2='22'/></svg>",
	"advisor": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'><path d='M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z'/><path d='M4.5 21c.8-4.2 3.3-6.3 7.5-6.3s6.7 2.1 7.5 6.3'/></svg>",
	"political": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polygon points='3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21'/><line x1='9' y1='3' x2='9' y2='18'/><line x1='15' y1='6' x2='15' y2='21'/></svg>",
	"diplomatic": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='12' r='10'/><path d='M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20'/><path d='M2 12h20'/></svg>",
	"clock": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='12' r='9'/><path d='M12 7v5l3 2'/></svg>",
	"star": "<svg viewBox='0 0 24 24'><path d='M12 2.8l2.7 6 6.5.6-4.9 4.3 1.5 6.4L12 16.8l-5.8 3.3 1.5-6.4-4.9-4.3 6.5-.6z' fill='#facc15' stroke='#1c1917' stroke-width='1.2' stroke-linejoin='round'/></svg>",
}

static var _fonts := {}
static var _icons := {}
static var _flags := {}
static var _logo: Texture2D


static func repo_path(relative: String) -> String:
	return ProjectSettings.globalize_path("res://").path_join("../..").path_join(relative).simplify_path()


static func font(weight := 400, family := "Arial", spacing := 0) -> Font:
	var key := "%s:%d:%d" % [family, weight, spacing]
	if _fonts.has(key):
		return _fonts[key]
	var system := SystemFont.new()
	system.font_names = PackedStringArray([family, "Segoe UI", "Helvetica", "Liberation Sans", "Segoe UI Emoji", "Segoe UI Symbol", "sans-serif"])
	system.font_weight = weight
	system.antialiasing = TextServer.FONT_ANTIALIASING_GRAY
	system.hinting = TextServer.HINTING_LIGHT
	system.subpixel_positioning = TextServer.SUBPIXEL_POSITIONING_AUTO
	var result: Font = system
	if spacing != 0:
		var variation := FontVariation.new()
		variation.base_font = system
		variation.spacing_glyph = spacing
		result = variation
	_fonts[key] = result
	return result


static func label(text: String, size := 14, color := INK, weight := 400, family := "Arial", spacing := 0) -> Label:
	var node := Label.new()
	node.text = text
	node.add_theme_font_override("font", font(weight, family, spacing))
	node.add_theme_font_size_override("font_size", size)
	node.add_theme_color_override("font_color", color)
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return node


static func wrapped(text: String, size := 13, color := MUTED, weight := 400, lines := 0) -> Label:
	var node := label(text, size, color, weight)
	node.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	if lines > 0:
		node.max_lines_visible = lines
		node.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	return node


static func box(bg: Color, border := Color(0, 0, 0, 0), radius := 0, border_width := 1, margin := Vector4(0, 0, 0, 0)) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = bg
	style.border_color = border
	if border.a > 0.0:
		style.set_border_width_all(border_width)
	style.set_corner_radius_all(radius)
	style.content_margin_left = margin.x
	style.content_margin_top = margin.y
	style.content_margin_right = margin.z
	style.content_margin_bottom = margin.w
	style.anti_aliasing = true
	return style


static func shadowed(style: StyleBoxFlat, color: Color, size: int, offset := Vector2.ZERO) -> StyleBoxFlat:
	style.shadow_color = color
	style.shadow_size = size
	style.shadow_offset = offset
	return style


static func icon(name: String, size := 16, color := WHITE) -> Texture2D:
	var key := "%s:%d:%s" % [name, size, color.to_html()]
	if _icons.has(key):
		return _icons[key]
	var svg: String = ICONS.get(name, "")
	if svg.is_empty():
		return null
	if color != WHITE and name != "star":
		svg = svg.replace("#fff", "#" + color.to_html(false))
	var image := Image.new()
	var scale := float(size) / 24.0
	if image.load_svg_from_string(svg, scale) != OK:
		return null
	if color.a < 1.0 and name != "star":
		image.convert(Image.FORMAT_RGBA8)
		for y in range(image.get_height()):
			for x in range(image.get_width()):
				var pixel := image.get_pixel(x, y)
				pixel.a *= color.a
				image.set_pixel(x, y, pixel)
	var texture := ImageTexture.create_from_image(image)
	_icons[key] = texture
	return texture


static func icon_rect(name: String, size := 16, color := WHITE) -> TextureRect:
	var rect := TextureRect.new()
	rect.texture = icon(name, size, color)
	rect.custom_minimum_size = Vector2(size, size)
	rect.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return rect


static func logo() -> Texture2D:
	if _logo:
		return _logo
	var image := Image.load_from_file(repo_path("public/logo.png"))
	if image:
		_logo = ImageTexture.create_from_image(image)
	return _logo


static func flag(path: String, height := 32) -> Texture2D:
	if path.is_empty():
		return null
	var key := "%s:%d" % [path, height]
	if _flags.has(key):
		return _flags[key]
	var file := FileAccess.open(path, FileAccess.READ)
	if not file:
		return null
	var svg := file.get_as_text()
	var probe := Image.new()
	if probe.load_svg_from_string(svg, 1.0) != OK or probe.get_height() == 0:
		return null
	var image := Image.new()
	image.load_svg_from_string(svg, float(height) / probe.get_height())
	var texture := ImageTexture.create_from_image(image)
	_flags[key] = texture
	return texture


static func button(text: String, preset := "header", icon_name := "") -> Button:
	var node := Button.new()
	node.text = text
	node.focus_mode = Control.FOCUS_NONE
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var specs := {
		"header": {"bg": Color(1, 1, 1, 0.06), "border": Color(1, 1, 1, 0.12), "radius": 9, "height": 35, "pad": 16, "size": 13, "weight": 600, "ink": BUTTON_INK},
		"hero": {"bg": Color(1, 1, 1, 0.15), "border": Color(1, 1, 1, 0.28), "radius": 9, "height": 45, "pad": 22, "size": 13, "weight": 600, "ink": BUTTON_INK},
		"hero_quiet": {"bg": Color(1, 1, 1, 0.06), "border": Color(1, 1, 1, 0.12), "radius": 9, "height": 45, "pad": 22, "size": 13, "weight": 600, "ink": BUTTON_INK},
		"accent": {"bg": ACCENT, "border": ACCENT, "radius": 11, "height": 38, "pad": 16, "size": 14, "weight": 700, "ink": WHITE},
		"current": {"bg": Color(1, 1, 1, 0.06), "border": Color(1, 1, 1, 0.22), "radius": 11, "height": 38, "pad": 16, "size": 14, "weight": 700, "ink": WHITE},
		"small": {"bg": Color(1, 1, 1, 0.06), "border": Color(1, 1, 1, 0.12), "radius": 9, "height": 32, "pad": 12, "size": 12, "weight": 600, "ink": BUTTON_INK},
		"glass": {"bg": HUD_PILL, "border": HUD_BORDER, "radius": 11, "height": 46, "pad": 12, "size": 11, "weight": 600, "ink": BUTTON_INK},
		"plain": {"bg": Color(0, 0, 0, 0), "border": Color(0, 0, 0, 0), "radius": 6, "height": 26, "pad": 6, "size": 13, "weight": 600, "ink": Color(1, 1, 1, 0.6)},
	}
	var spec: Dictionary = specs.get(preset, specs["header"])
	var bg: Color = spec["bg"]
	var normal := box(bg, spec["border"], spec["radius"], 1, Vector4(spec["pad"], 0, spec["pad"], 0))
	var hover := normal.duplicate() as StyleBoxFlat
	if preset == "accent":
		hover.bg_color = ACCENT.lightened(0.12)
		hover.border_color = hover.bg_color
		shadowed(normal, Color(ACCENT, 0.2), 6, Vector2(0, 3))
		shadowed(hover, Color(ACCENT, 0.28), 7, Vector2(0, 3))
	else:
		hover.bg_color = Color(bg.r, bg.g, bg.b, min(1.0, bg.a + 0.05))
		hover.border_color = Color(1, 1, 1, min(1.0, (spec["border"] as Color).a + 0.1))
	var disabled := normal.duplicate() as StyleBoxFlat
	for state in [["normal", normal], ["hover", hover], ["pressed", hover], ["focus", normal], ["disabled", disabled], ["hover_pressed", hover]]:
		node.add_theme_stylebox_override(state[0], state[1])
	var ink: Color = spec["ink"]
	node.add_theme_font_override("font", font(spec["weight"]))
	node.add_theme_font_size_override("font_size", spec["size"])
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		node.add_theme_color_override(name, ink)
	node.add_theme_color_override("font_disabled_color", Color(ink, ink.a * 0.45))
	node.custom_minimum_size.y = spec["height"]
	if not icon_name.is_empty():
		node.text = ""
		var content := HBoxContainer.new()
		content.alignment = BoxContainer.ALIGNMENT_CENTER
		content.add_theme_constant_override("separation", 7)
		content.mouse_filter = Control.MOUSE_FILTER_IGNORE
		content.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		var glyph := icon_rect(icon_name, 15, ink)
		glyph.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		content.add_child(glyph)
		var caption := label(text, spec["size"], ink, spec["weight"])
		caption.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		content.add_child(caption)
		node.add_child(content)
		var text_width := font(spec["weight"]).get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, spec["size"]).x
		node.custom_minimum_size.x = text_width + 15 + 7 + 2 * float(spec["pad"])
	return node


static func pill(text: String, bg: Color, border: Color, ink := WHITE, upper := false, size := 11) -> PanelContainer:
	var holder := PanelContainer.new()
	holder.add_theme_stylebox_override("panel", box(bg, border, 999, 1, Vector4(9, 2, 9, 3)))
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var text_label := label(text.to_upper() if upper else text, size, ink, 700 if upper else 600, "Arial", 1 if upper else 0)
	holder.add_child(text_label)
	return holder


static func spacer(horizontal := true) -> Control:
	var node := Control.new()
	if horizontal:
		node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	else:
		node.size_flags_vertical = Control.SIZE_EXPAND_FILL
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return node


static func set_disabled_look(control: Control, reason: String) -> void:
	control.modulate = Color(1, 1, 1, 0.42)
	control.tooltip_text = reason
	if control is BaseButton:
		(control as BaseButton).disabled = true
		control.mouse_default_cursor_shape = Control.CURSOR_ARROW


static func format_long_date(iso: String) -> String:
	var parts := iso.split("-")
	if parts.size() < 3:
		return iso
	var months := ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
	var month := int(parts[1])
	var day := int(parts[2])
	if month < 1 or month > 12:
		return iso
	var suffix := "th"
	if day % 100 < 11 or day % 100 > 13:
		suffix = {1: "st", 2: "nd", 3: "rd"}.get(day % 10, "th")
	return "%s %d%s, %s" % [months[month - 1], day, suffix, parts[0]]


static func add_days(iso: String, days: float) -> String:
	var parts := iso.split("-")
	if parts.size() < 3:
		return iso
	var unix := Time.get_unix_time_from_datetime_dict({"year": int(parts[0]), "month": int(parts[1]), "day": int(parts[2]), "hour": 0, "minute": 0, "second": 0})
	var whole := int(round(max(0.0, days))) if days >= 1.0 else 0
	var date := Time.get_datetime_dict_from_unix_time(unix + whole * 86400)
	return "%04d-%02d-%02d" % [date["year"], date["month"], date["day"]]


static func short_date(iso: String) -> String:
	var parts := iso.split("-")
	if parts.size() < 3:
		return iso
	return "%d/%d/%s" % [int(parts[1]), int(parts[2]), parts[0]]
