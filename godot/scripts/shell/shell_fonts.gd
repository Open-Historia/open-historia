class_name ShellFonts
extends RefCounted

const REM := 16.0
const GENERIC := {
	"serif": "Times New Roman",
	"sans-serif": "Arial",
	"monospace": "Consolas",
	"system-ui": "Segoe UI",
	"inherit": "Segoe UI",
}

static var _cache := {}


static func families(css_stack: String) -> PackedStringArray:
	var names: PackedStringArray = []
	for raw in css_stack.split(","):
		var name := raw.strip_edges().trim_prefix("\"").trim_suffix("\"").trim_prefix("'").trim_suffix("'").strip_edges()
		if name.is_empty() or name == "ui-monospace":
			continue
		var mapped: String = GENERIC.get(name.to_lower(), name)
		if not names.has(mapped):
			names.append(mapped)
	if names.is_empty():
		names.append("Segoe UI")
	return names


static func font(css_stack := "Segoe UI", weight := 400, italic := false, spacing_px := 0.0, stretch := 100) -> Font:
	var key := "%s|%d|%s|%.2f|%d" % [css_stack, weight, italic, spacing_px, stretch]
	if _cache.has(key):
		return _cache[key]
	var system := SystemFont.new()
	var names := families(css_stack)
	for fallback in ["Segoe UI", "Arial", "Segoe UI Emoji", "Segoe UI Symbol"]:
		if not names.has(fallback):
			names.append(fallback)
	system.font_names = names
	system.font_weight = weight
	system.font_italic = italic
	system.font_stretch = stretch
	system.antialiasing = TextServer.FONT_ANTIALIASING_GRAY
	system.hinting = TextServer.HINTING_LIGHT
	system.subpixel_positioning = TextServer.SUBPIXEL_POSITIONING_AUTO
	var result: Font = system
	if absf(spacing_px) > 0.01:
		var variation := FontVariation.new()
		variation.base_font = system
		variation.spacing_glyph = roundi(spacing_px)
		result = variation
	_cache[key] = result
	return result


static func rem(value: float) -> float:
	return value * REM


static func px(value_rem: float) -> int:
	return roundi(value_rem * REM)


static func clamp_vw(min_rem: float, vw: float, max_rem: float, viewport_width: float) -> float:
	return clampf(viewport_width * vw / 100.0, min_rem * REM, max_rem * REM)


static func label(text: String, size_px: float, color: Color, css_stack := "Segoe UI", weight := 400, italic := false, spacing_em := 0.0, upper := false) -> Label:
	var node := Label.new()
	node.text = text
	node.add_theme_font_override("font", font(css_stack, weight, italic, spacing_em * size_px))
	node.add_theme_font_size_override("font_size", roundi(size_px))
	node.add_theme_color_override("font_color", color)
	node.uppercase = upper
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return node
