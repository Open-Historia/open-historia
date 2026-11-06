class_name UiTheme
extends RefCounted

signal changed

const DEFAULT := "default"
const TEXT := "#EEF3F7"
const PRESETS := [
	{"id": "midnight", "name": "Midnight Navy", "colors": {"background": "#111D2A", "surface": "#20364A", "accent": "#85CBE6"}},
	{"id": "graphite", "name": "Graphite", "colors": {"background": "#15171B", "surface": "#30343B", "accent": "#BAC6D2"}},
	{"id": "forest", "name": "Forest", "colors": {"background": "#121E19", "surface": "#283C32", "accent": "#78C8A1"}},
	{"id": "oxblood", "name": "Oxblood", "colors": {"background": "#21171B", "surface": "#3D2830", "accent": "#DA929E"}},
	{"id": "sepia", "name": "Sepia", "colors": {"background": "#241F19", "surface": "#403528", "accent": "#D6B77D"}},
]
const ENTRIES := ["background", "surface", "accent"]

static var _bus: UiTheme
static var _engine: EngineLink
static var preset := DEFAULT
static var custom := {"background": "#111D2A", "surface": "#20364A", "accent": "#85CBE6"}
static var _tokens := {}


static func events() -> UiTheme:
	if _bus == null:
		_bus = UiTheme.new()
	return _bus


static func themed() -> bool:
	return preset != DEFAULT


static func pick(token: String, fallback: Color) -> Color:
	if preset == DEFAULT or not _tokens.has(token):
		return fallback
	return _tokens[token]


static func accented(fallback: Color) -> Color:
	if preset == DEFAULT or not _tokens.has("accent"):
		return fallback
	return Color(_tokens["accent"] as Color, fallback.a)


static func preset_named(id: String) -> Dictionary:
	for item in PRESETS:
		if str(item["id"]) == id:
			return item
	return {}


static func default_custom() -> Dictionary:
	return (preset_named("midnight")["colors"] as Dictionary).duplicate()


static func normalize_color(value: Variant) -> String:
	if typeof(value) != TYPE_STRING:
		return ""
	var cleaned := str(value).strip_edges()
	var body := cleaned.trim_prefix("#")
	if not cleaned.begins_with("#") or not body.is_valid_hex_number(false):
		return ""
	if body.length() == 6:
		return "#" + body.to_upper()
	if body.length() == 3:
		return "#" + (body[0] + body[0] + body[1] + body[1] + body[2] + body[2]).to_upper()
	return ""


static func _channel(value: float) -> float:
	return value / 12.92 if value <= 0.04045 else pow((value + 0.055) / 1.055, 2.4)


static func _luminance(hex: String) -> float:
	var color := Color(hex)
	return _channel(color.r8 / 255.0) * 0.2126 + _channel(color.g8 / 255.0) * 0.7152 + _channel(color.b8 / 255.0) * 0.0722


static func contrast(a: String, b: String) -> float:
	var first := normalize_color(a)
	var second := normalize_color(b)
	if first.is_empty() or second.is_empty():
		return 0.0
	var x := _luminance(first)
	var y := _luminance(second)
	return (maxf(x, y) + 0.05) / (minf(x, y) + 0.05)


static func validate(colors: Variant) -> String:
	if typeof(colors) != TYPE_DICTIONARY:
		return "Enter all three theme colors."
	var normalized := {}
	for name in ENTRIES:
		normalized[name] = normalize_color((colors as Dictionary).get(name))
		if str(normalized[name]).is_empty():
			return "Use six-digit hexadecimal colors."
	if contrast(normalized["background"], TEXT) < 7.0 or contrast(normalized["surface"], TEXT) < 7.0:
		return "Background and surface are too bright for readable text."
	if contrast(normalized["accent"], normalized["background"]) < 4.5 or contrast(normalized["accent"], normalized["surface"]) < 4.5:
		return "Accent needs more contrast against both backgrounds."
	return ""


static func normalize(value: Variant) -> Dictionary:
	var source: Dictionary = value if typeof(value) == TYPE_DICTIONARY else {}
	var wanted := str(source.get("preset", ""))
	var selection := wanted if not preset_named(wanted).is_empty() or wanted == "custom" or wanted == DEFAULT else DEFAULT
	var raw: Dictionary = source.get("custom") if typeof(source.get("custom")) == TYPE_DICTIONARY else {}
	var fallback := default_custom()
	var colors := {}
	for name in ENTRIES:
		var given := normalize_color(raw.get(name))
		colors[name] = given if not given.is_empty() else str(fallback[name])
	if not validate(colors).is_empty():
		colors = fallback
	return {"preset": selection, "custom": colors}


static func colors_of(selection: String) -> Dictionary:
	if selection == "custom":
		return custom
	var item := preset_named(selection)
	return item["colors"] if not item.is_empty() else default_custom()


static func _hex(value: float) -> String:
	return "%02X" % int(round(clampf(value, 0.0, 255.0)))


static func mix(a: String, b: String, amount: float) -> String:
	var first := Color(a)
	var second := Color(b)
	return "#" + _hex(first.r8 * (1.0 - amount) + second.r8 * amount) + _hex(first.g8 * (1.0 - amount) + second.g8 * amount) + _hex(first.b8 * (1.0 - amount) + second.b8 * amount)


static func _alpha(hex: String, amount: float) -> Color:
	var color := Color(hex)
	color.a = amount
	return color


static func tokens_for(selection: String, palette: Dictionary) -> Dictionary:
	if selection == DEFAULT:
		return {}
	var bg := str(palette["background"])
	var surface := str(palette["surface"])
	var accent := str(palette["accent"])
	return {
		"bg": Color(bg),
		"surface": Color(surface),
		"accent": Color(accent),
		"raised": Color(mix(surface, "#FFFFFF", 0.055)),
		"header": Color(mix(bg, "#000000", 0.32)),
		"active": Color(mix(surface, accent, 0.19)),
		"hover": Color(mix(surface, accent, 0.11)),
		"text": Color(TEXT),
		"muted": Color("#B4C4D0"),
		"line": Color(mix(surface, "#9AC0D1", 0.26)),
		"focus": Color(accent),
		"overlay": _alpha(bg, 0.86),
		"overlay_strong": _alpha(bg, 0.94),
		"overlay_card": _alpha(surface, 0.68),
		"overlay_header": _alpha(surface, 0.78),
		"grey_bg": Color(bg),
		"grey_surface": Color(surface),
		"grey_raised": Color(mix(surface, "#FFFFFF", 0.055)),
		"grey_selected": Color(mix(bg, "#000000", 0.2)),
		"grey_border": Color(mix(surface, "#9AC0D1", 0.26)),
		"grey_border_strong": Color(mix(surface, "#9AC0D1", 0.48)),
		"grey_text": Color(TEXT),
		"grey_muted": Color("#B4C4D0"),
		"grey_faint": Color("#839AAA"),
	}


static func state() -> Dictionary:
	return {"preset": preset, "custom": custom.duplicate()}


static func _apply(value: Variant, persist: bool) -> void:
	var normalized := normalize(value)
	preset = str(normalized["preset"])
	custom = normalized["custom"]
	_tokens = tokens_for(preset, colors_of(preset))
	if persist and _engine:
		_engine.request("look.theme.set", {"theme": state()})
	events().changed.emit()


static func install(link: EngineLink) -> void:
	_engine = link
	var reply: Dictionary = await link.request("look.theme.get")
	if reply.get("ok", false) and typeof(reply.get("result")) == TYPE_DICTIONARY:
		_apply((reply["result"] as Dictionary).get("theme"), false)


static func select(id: String) -> bool:
	if preset_named(id).is_empty() and id != "custom" and id != DEFAULT:
		return false
	_apply({"preset": id, "custom": custom}, true)
	return true


static func set_custom_color(name: String, value: String) -> String:
	if not ENTRIES.has(name):
		return "Unknown theme color."
	var normalized := normalize_color(value)
	if normalized.is_empty():
		return "Use a hexadecimal color."
	var next := custom.duplicate()
	next[name] = normalized
	var problem := validate(next)
	if not problem.is_empty():
		return problem
	_apply({"preset": "custom", "custom": next}, true)
	return ""


static func reset() -> void:
	_apply({"preset": DEFAULT, "custom": default_custom()}, true)


static func reset_unchanged() -> bool:
	return preset == DEFAULT and custom == default_custom()
