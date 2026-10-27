class_name DevToolsStyle
extends RefCounted

const BG := Color("#131315")
const BAR := Color("#1b1b1e")
const RAISED := Color("#232327")
const FIELD := Color("#0d0d0f")
const LINE := Color(1, 1, 1, 0.08)
const LINE_STRONG := Color(1, 1, 1, 0.16)
const INK := Color8(236, 236, 240)
const MUTED := Color(228 / 255.0, 228 / 255.0, 235 / 255.0, 0.66)
const FAINT := Color(1, 1, 1, 0.4)
const ACCENT := Color("#2bc1f3")
const SELECT := Color(0.169, 0.757, 0.953, 0.2)
const HOVER := Color(1, 1, 1, 0.05)
const WARN := Color("#f2c14e")
const WARN_BG := Color(0.95, 0.76, 0.31, 0.08)
const ERROR := Color("#ef4444")
const ERROR_BG := Color(0.94, 0.27, 0.27, 0.09)
const GOOD := Color("#4ade80")
const STRING := Color("#f0a35e")
const NUMBER := Color("#9ecbff")
const MONO := "Consolas"

static var _theme: Theme


static func theme() -> Theme:
	if _theme:
		return _theme
	var made := Theme.new()
	made.default_font = UI.font(400, "Segoe UI")
	made.default_font_size = 12
	var flat := UI.box(Color(0, 0, 0, 0))
	var field := UI.box(FIELD, LINE_STRONG, 4, 1, Vector4(7, 3, 7, 3))
	var field_focus := UI.box(FIELD, ACCENT, 4, 1, Vector4(7, 3, 7, 3))
	var button := UI.box(Color(1, 1, 1, 0.05), LINE_STRONG, 4, 1, Vector4(9, 3, 9, 3))
	var button_hover := UI.box(Color(1, 1, 1, 0.1), Color(1, 1, 1, 0.24), 4, 1, Vector4(9, 3, 9, 3))
	var button_on := UI.box(SELECT, ACCENT, 4, 1, Vector4(9, 3, 9, 3))
	var popup := UI.box(RAISED, LINE_STRONG, 6, 1, Vector4(4, 4, 4, 4))
	var popup_hover := UI.box(SELECT, Color(0, 0, 0, 0), 4, 0)
	for type in ["Button", "OptionButton", "MenuButton"]:
		made.set_stylebox("normal", type, button)
		made.set_stylebox("hover", type, button_hover)
		made.set_stylebox("pressed", type, button_on)
		made.set_stylebox("hover_pressed", type, button_on)
		made.set_stylebox("focus", type, flat)
		made.set_stylebox("disabled", type, button)
		for name in ["font_color", "font_hover_color", "font_focus_color"]:
			made.set_color(name, type, INK)
		made.set_color("font_pressed_color", type, ACCENT)
		made.set_color("font_hover_pressed_color", type, ACCENT)
		made.set_color("font_disabled_color", type, FAINT)
	for type in ["CheckBox", "CheckButton"]:
		for state in ["normal", "hover", "pressed", "hover_pressed", "focus", "disabled"]:
			made.set_stylebox(state, type, flat)
		for name in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color"]:
			made.set_color(name, type, INK)
	var ticked := _svg("<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><rect x='1' y='1' width='14' height='14' rx='3' fill='#2bc1f3'/><path d='M4.2 8.3l2.5 2.5 5.1-5.4' fill='none' stroke='#0d0d0f' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/></svg>")
	var empty := _svg("<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><rect x='1.75' y='1.75' width='12.5' height='12.5' rx='2.5' fill='#0d0d0f' stroke='#8c8c94' stroke-width='1.5'/></svg>")
	for icon_name in ["checked", "checked_disabled"]:
		made.set_icon(icon_name, "CheckBox", ticked)
	for icon_name in ["unchecked", "unchecked_disabled"]:
		made.set_icon(icon_name, "CheckBox", empty)
	made.set_stylebox("normal", "LineEdit", field)
	made.set_stylebox("focus", "LineEdit", field_focus)
	made.set_stylebox("read_only", "LineEdit", UI.box(Color(0, 0, 0, 0.2), LINE, 4, 1, Vector4(7, 3, 7, 3)))
	made.set_color("font_color", "LineEdit", INK)
	made.set_color("font_placeholder_color", "LineEdit", FAINT)
	made.set_color("caret_color", "LineEdit", ACCENT)
	made.set_color("selection_color", "LineEdit", SELECT)
	made.set_color("font_uneditable_color", "LineEdit", MUTED)
	made.set_stylebox("normal", "TextEdit", field)
	made.set_stylebox("focus", "TextEdit", field_focus)
	made.set_stylebox("read_only", "TextEdit", UI.box(FIELD, LINE, 4, 1, Vector4(8, 6, 8, 6)))
	made.set_color("font_color", "TextEdit", INK)
	made.set_color("font_readonly_color", "TextEdit", INK)
	made.set_color("selection_color", "TextEdit", SELECT)
	made.set_color("background_color", "TextEdit", FIELD)
	made.set_font("font", "TextEdit", UI.font(400, MONO))
	made.set_font_size("font_size", "TextEdit", 12)
	made.set_stylebox("panel", "PopupMenu", popup)
	made.set_stylebox("hover", "PopupMenu", popup_hover)
	made.set_color("font_color", "PopupMenu", INK)
	made.set_color("font_hover_color", "PopupMenu", INK)
	made.set_color("font_disabled_color", "PopupMenu", FAINT)
	made.set_stylebox("panel", "TooltipPanel", UI.box(RAISED, LINE_STRONG, 4, 1, Vector4(8, 5, 8, 5)))
	made.set_color("font_color", "TooltipLabel", INK)
	made.set_color("font_color", "Label", INK)
	made.set_stylebox("panel", "Tree", UI.box(BG))
	made.set_stylebox("focus", "Tree", flat)
	made.set_stylebox("selected", "Tree", UI.box(SELECT))
	made.set_stylebox("selected_focus", "Tree", UI.box(SELECT))
	made.set_stylebox("cursor", "Tree", flat)
	made.set_stylebox("cursor_unfocused", "Tree", flat)
	made.set_stylebox("hovered", "Tree", UI.box(HOVER))
	made.set_stylebox("hovered_dimmed", "Tree", UI.box(HOVER))
	made.set_stylebox("title_button_normal", "Tree", UI.box(BAR, LINE, 0, 1, Vector4(6, 3, 6, 3)))
	made.set_stylebox("title_button_hover", "Tree", UI.box(RAISED, LINE, 0, 1, Vector4(6, 3, 6, 3)))
	made.set_stylebox("title_button_pressed", "Tree", UI.box(RAISED, LINE, 0, 1, Vector4(6, 3, 6, 3)))
	made.set_color("font_color", "Tree", INK)
	made.set_color("font_selected_color", "Tree", INK)
	made.set_color("font_hovered_color", "Tree", INK)
	made.set_color("title_button_color", "Tree", MUTED)
	made.set_color("guide_color", "Tree", LINE)
	made.set_color("relationship_line_color", "Tree", LINE)
	made.set_constant("v_separation", "Tree", 2)
	made.set_constant("item_margin", "Tree", 14)
	made.set_constant("draw_guides", "Tree", 0)
	made.set_font("title_button_font", "Tree", UI.font(600, "Segoe UI"))
	made.set_font_size("title_button_font_size", "Tree", 11)
	made.set_stylebox("normal", "RichTextLabel", flat)
	made.set_stylebox("focus", "RichTextLabel", flat)
	made.set_color("default_color", "RichTextLabel", INK)
	made.set_color("selection_color", "RichTextLabel", SELECT)
	made.set_font("normal_font", "RichTextLabel", UI.font(400, MONO))
	made.set_font("mono_font", "RichTextLabel", UI.font(400, MONO))
	made.set_font("bold_font", "RichTextLabel", UI.font(700, MONO))
	made.set_font_size("normal_font_size", "RichTextLabel", 12)
	made.set_font_size("mono_font_size", "RichTextLabel", 12)
	made.set_font_size("bold_font_size", "RichTextLabel", 12)
	for type in ["VScrollBar", "HScrollBar"]:
		made.set_stylebox("scroll", type, UI.box(Color(0, 0, 0, 0)))
		made.set_stylebox("scroll_focus", type, UI.box(Color(0, 0, 0, 0)))
		made.set_stylebox("grabber", type, UI.box(Color(1, 1, 1, 0.16), Color(0, 0, 0, 0), 4, 0))
		made.set_stylebox("grabber_highlight", type, UI.box(Color(1, 1, 1, 0.26), Color(0, 0, 0, 0), 4, 0))
		made.set_stylebox("grabber_pressed", type, UI.box(Color(1, 1, 1, 0.34), Color(0, 0, 0, 0), 4, 0))
	for type in ["HSplitContainer", "VSplitContainer"]:
		made.set_constant("separation", type, 5)
		made.set_stylebox("split_bar_background", type, UI.box(LINE))
	made.set_stylebox("panel", "PanelContainer", flat)
	_theme = made
	return _theme


static func _svg(source: String) -> Texture2D:
	var image := Image.new()
	if image.load_svg_from_string(source, 1.0) != OK:
		return null
	return ImageTexture.create_from_image(image)


static func text(value: String, size := 12, color := INK, weight := 400, mono := false) -> Label:
	var node := UI.label(value, size, color, weight, MONO if mono else "Segoe UI")
	node.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	return node


static func bar(margin := Vector4(6, 3, 6, 3), color := BAR) -> PanelContainer:
	var panel := PanelContainer.new()
	var style := UI.box(color, Color(0, 0, 0, 0), 0, 0, margin)
	style.border_color = LINE
	style.border_width_bottom = 1
	panel.add_theme_stylebox_override("panel", style)
	return panel


static func button(caption: String, tooltip := "", toggle := false) -> Button:
	var node := Button.new()
	node.text = caption
	node.tooltip_text = tooltip
	node.toggle_mode = toggle
	node.focus_mode = Control.FOCUS_NONE
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	node.custom_minimum_size.y = 24
	return node


static func chip(caption: String, tooltip := "", pressed := true) -> Button:
	var node := button(caption, tooltip, true)
	node.button_pressed = pressed
	var off := UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 10, 1, Vector4(9, 2, 9, 2))
	var off_hover := UI.box(HOVER, Color(0, 0, 0, 0), 10, 1, Vector4(9, 2, 9, 2))
	var on := UI.box(SELECT, Color(0, 0, 0, 0), 10, 1, Vector4(9, 2, 9, 2))
	node.add_theme_stylebox_override("normal", off)
	node.add_theme_stylebox_override("hover", off_hover)
	node.add_theme_stylebox_override("pressed", on)
	node.add_theme_stylebox_override("hover_pressed", on)
	node.add_theme_color_override("font_color", MUTED)
	node.add_theme_color_override("font_hover_color", INK)
	node.custom_minimum_size.y = 22
	return node


static func field(placeholder := "", mono := false) -> LineEdit:
	var node := LineEdit.new()
	node.placeholder_text = placeholder
	node.custom_minimum_size.y = 24
	node.clear_button_enabled = false
	if mono:
		node.add_theme_font_override("font", UI.font(400, MONO))
	return node


static func divider(vertical := true) -> Control:
	var line := ColorRect.new()
	line.color = LINE_STRONG
	line.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if vertical:
		line.custom_minimum_size = Vector2(1, 16)
		line.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	else:
		line.custom_minimum_size = Vector2(0, 1)
	return line


static func bytes(count: float) -> String:
	if count < 1000.0:
		return "%d B" % int(count)
	if count < 1000.0 * 1000.0:
		return "%.1f kB" % (count / 1000.0)
	if count < 1000.0 * 1000.0 * 1000.0:
		return "%.1f MB" % (count / 1000000.0)
	return "%.2f GB" % (count / 1000000000.0)


static func duration(ms: float) -> String:
	if ms < 0.0:
		return "(pending)"
	if ms < 1000.0:
		return "%d ms" % int(round(ms))
	return "%.2f s" % (ms / 1000.0)


static func clock(unix: float) -> String:
	var bias := int(Time.get_time_zone_from_system().get("bias", 0)) * 60
	var local := unix + bias
	var day := fposmod(local, 86400.0)
	return "%02d:%02d:%02d.%03d" % [int(day / 3600.0), int(fmod(day, 3600.0) / 60.0), int(fmod(day, 60.0)), int(fmod(local * 1000.0, 1000.0))]


static func escape(value: String) -> String:
	return value.replace("[", "[lb]")


static func hide_secrets(text: String) -> String:
	var pattern := RegEx.create_from_string("(AIza[0-9A-Za-z_\\-]{20,}|sk-(?:ant-|proj-)?[0-9A-Za-z_\\-]{20,})")
	return pattern.sub(text, "•••", true)


static func pretty(value: Variant, limit := 200000) -> String:
	var out := JSON.stringify(value, "  ", false)
	if out.length() > limit:
		return out.substr(0, limit) + "\n… %d more characters" % (out.length() - limit)
	return out
