class_name RostraPanel
extends Control

signal closed
signal unseen_changed(count: int)
signal enabled_changed(on: bool)

const PHONE := {
	"--rs-accent": "#2bc1f3",
	"--rs-accent-soft": "rgba(43,193,243,0.14)",
	"--rs-accent-edge": "rgba(43,193,243,0.45)",
	"--rs-accent-bar": "rgba(43,193,243,0.28)",
	"--rs-on-accent": "#06171d",
	"--rs-ink": "#f4f4f5",
	"--rs-ink-soft": "rgba(244,244,245,0.62)",
	"--rs-ink-faint": "rgba(244,244,245,0.38)",
	"--rs-line": "rgba(255,255,255,0.08)",
	"--rs-edge": "rgba(255,255,255,0.12)",
	"--rs-wash": "rgba(255,255,255,0.06)",
	"--rs-wash-faint": "rgba(255,255,255,0.03)",
	"--rs-avatar": "#2a2a2f",
	"--rs-screen": "#0b0b0d",
	"--rs-warn": "rgba(253,186,116,0.95)",
	"--rs-font": "sans-serif",
	"--rs-title-font": "sans-serif",
	"--rs-name-font": "sans-serif",
	"--rs-carve": "none",
}
const FRAME := Color("#17171a")
const FRAME_BUTTON := Color("#2c2c31")
const BOTTOM_GAP := 78.0
const RING := 3.0
const TABS := [["all", "For you", "home"], ["search", "Search", "search"], ["mentions", "Mentions", "bell"], ["mine", "Your posts", "person"]]
const EMPTY_TEXTS := {
	"mentions": "Nobody has mentioned you yet. Post something, and the answers come with the next time skip.",
	"mine": "You have not posted yet.",
}
const CANNOT_POST := "You can post again once the time skip has ended."
const MARK := "<svg viewBox='0 0 32 32'><path d='M6 3h20a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4H13l-6 5v-5H6a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4z' fill='#2bc1f3'/><path d='M12 21h8l-1.2-7.5h-5.6z' fill='#06171d'/><path d='M9.5 13.5h13' stroke='#06171d' stroke-width='1.8' stroke-linecap='round'/><circle cx='16' cy='9' r='2' fill='#06171d'/></svg>"
const GLYPHS := {
	"dock": ["<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'><rect x='5.5' y='2' width='13' height='20' rx='3'/><path d='M10.5 5h3'/><path d='M9.5 19h5'/></svg>", 24.0],
	"dock-newspaper": ["<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M4 4.5h13v15H6a2 2 0 0 1-2-2z'/><path d='M17 8.5h3v9a2 2 0 0 1-2 2h-1'/><path d='M7 8h7M7 11.5h7M7 15h4'/></svg>", 24.0],
	"dock-scroll": ["<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M6 4h12M6 20h12'/><path d='M7.5 4v16M16.5 4v16'/><path d='M10 8.5h4M10 12h4M10 15.5h3'/></svg>", 24.0],
	"dock-tablet": ["<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M5 21V9.5a7 6 0 0 1 14 0V21z'/><path d='M9 11h6M9 14.5h6M9 18h4'/></svg>", 24.0],
	"quote": ["<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M7 7h4v4c0 2.5-1.3 4-4 5'/><path d='M14 7h4v4c0 2.5-1.3 4-4 5'/></svg>", 24.0],
	"repost": ["<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M17 3l3 3-3 3'/><path d='M4 12V9a3 3 0 0 1 3-3h13'/><path d='M7 21l-3-3 3-3'/><path d='M20 12v3a3 3 0 0 1-3 3H4'/></svg>", 24.0],
	"heart": ["<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M20.5 5.8a5 5 0 0 0-7.1 0L12 7.2l-1.4-1.4a5 5 0 0 0-7.1 7.1L12 21.4l8.5-8.5a5 5 0 0 0 0-7.1z'/></svg>", 24.0],
	"close": ["<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='M6 6l12 12M18 6L6 18'/></svg>", 24.0],
	"pen": ["<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'><path d='M3 21l3.4-9.4 3.8-1.8 4 4-1.8 3.8z'/><path d='M10.2 9.8l4.6-4.6a1.4 1.4 0 0 1 2 0l2 2a1.4 1.4 0 0 1 0 2l-4.6 4.6'/><path d='M3 21l5.6-5.6'/><circle cx='10' cy='14' r='1.4'/></svg>", 24.0],
	"poll": ["<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'><path d='M4 6h11'/><path d='M4 12h16'/><path d='M4 18h7'/></svg>", 24.0],
	"home": ["<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M4 10.5L12 4l8 6.5V20h-5.5v-5.5h-5V20H4z'/></svg>", 24.0],
	"search": ["<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><circle cx='11' cy='11' r='7'/><path d='M21 21l-4.5-4.5'/></svg>", 24.0],
	"bell": ["<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M18 9a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8'/><path d='M13.7 21a2 2 0 0 1-3.4 0'/></svg>", 24.0],
	"person": ["<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='8' r='4'/><path d='M4.5 21c.8-4.2 3.3-6.3 7.5-6.3s6.7 2.1 7.5 6.3'/></svg>", 24.0],
	"refresh": ["<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'><path d='M21 4v6h-6'/><path d='M3 20v-6h6'/><path d='M5.2 9a8 8 0 0 1 13.6-2.6L21 10'/><path d='M18.8 15a8 8 0 0 1-13.6 2.6L3 14'/></svg>", 24.0],
	"signal": ["<svg viewBox='0 0 17 11' fill='#fff'><rect x='0' y='7' width='3' height='4' rx='0.7'/><rect x='4.6' y='5' width='3' height='6' rx='0.7'/><rect x='9.2' y='2.6' width='3' height='8.4' rx='0.7'/><rect x='13.8' y='0' width='3' height='11' rx='0.7'/></svg>", 17.0],
	"wifi": ["<svg viewBox='0 0 15 11' fill='none' stroke='#fff' stroke-width='1.6' stroke-linecap='round'><path d='M1 4.2a9.2 9.2 0 0 1 13 0'/><path d='M3.4 6.7a5.8 5.8 0 0 1 8.2 0'/><circle cx='7.5' cy='9.3' r='0.9' fill='#fff' stroke='none'/></svg>", 15.0],
	"battery": ["<svg viewBox='0 0 24 11' fill='none'><rect x='0.5' y='0.5' width='20' height='10' rx='2.6' stroke='#fff' stroke-opacity='0.45'/><rect x='2' y='2' width='14' height='7' rx='1.4' fill='#fff'/><rect x='21.6' y='3.4' width='1.6' height='4.2' rx='0.8' fill='#fff' fill-opacity='0.5'/></svg>", 24.0],
	"reply": ["<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'><path d='M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 21l2-5.6A8.4 8.4 0 1 1 21 11.5z'/></svg>", 24.0],
	"reshare": ["<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'><path d='M17 2l4 4-4 4'/><path d='M3 12V9a3 3 0 0 1 3-3h15'/><path d='M7 22l-4-4 4-4'/><path d='M21 12v3a3 3 0 0 1-3 3H3'/></svg>", 24.0],
	"like": ["<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'><path d='M20.8 5.6a5.2 5.2 0 0 0-7.4 0L12 7l-1.4-1.4a5.2 5.2 0 0 0-7.4 7.4L12 21.8l8.8-8.8a5.2 5.2 0 0 0 0-7.4z'/></svg>", 24.0],
	"liked": ["<svg viewBox='0 0 24 24' fill='#fff' stroke='#fff' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'><path d='M20.8 5.6a5.2 5.2 0 0 0-7.4 0L12 7l-1.4-1.4a5.2 5.2 0 0 0-7.4 7.4L12 21.8l8.8-8.8a5.2 5.2 0 0 0 0-7.4z'/></svg>", 24.0],
	"find": ["<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'><circle cx='11' cy='11' r='7'/><path d='M21 21l-4.5-4.5'/></svg>", 24.0],
	"clear": ["<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='M6 6l12 12M18 6L6 18'/></svg>", 24.0],
	"pin": ["<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'><path d='M12 21s-6.5-6.1-6.5-11a6.5 6.5 0 0 1 13 0c0 4.9-6.5 11-6.5 11z'/><circle cx='12' cy='10' r='2.3'/></svg>", 24.0],
	"flag": ["<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'><path d='M5 21V4'/><path d='M5 4.5c4.5-2 7.5 2 14 0v9c-6.5 2-9.5-2-14 0'/></svg>", 24.0],
}

static var _textures := {}
static var _flags := {}
static var _italics := {}
static var _docks: Array = []
static var LOOK := "phone"
static var EDGE_POINTS: Array = []
static var ACCENT := Color("#2bc1f3")
static var ACCENT_SOFT := Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.14)
static var ACCENT_EDGE := Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.45)
static var ACCENT_BAR := Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.28)
static var ON_ACCENT := Color("#06171d")
static var INK := Color("#f4f4f5")
static var INK_SOFT := Color(244 / 255.0, 244 / 255.0, 245 / 255.0, 0.62)
static var INK_FAINT := Color(244 / 255.0, 244 / 255.0, 245 / 255.0, 0.38)
static var LINE := Color(1, 1, 1, 0.08)
static var EDGE := Color(1, 1, 1, 0.12)
static var WASH := Color(1, 1, 1, 0.06)
static var WASH_FAINT := Color(1, 1, 1, 0.03)
static var AVATAR := Color("#2a2a2f")
static var SCREEN := Color("#0b0b0d")
static var WARN := Color(253 / 255.0, 186 / 255.0, 116 / 255.0, 0.95)
static var BODY_FONT := PackedStringArray(["sans-serif"])
static var TITLE_FONT := PackedStringArray(["sans-serif"])
static var NAME_FONT := PackedStringArray(["sans-serif"])
static var CARVE := Color(0, 0, 0, 0)

var engine: EngineLink
var context := {}
var view := {}
var tab := "all"
var framed := true
var _open := false
var _view_json := ""
var _loading := false
var _poll: Timer
var _seen_sent := 0
var _enabled := true
var _unseen := -1
var _rendered_ids := {}
var _next_ids := {}
var _composing := false
var _choices: Variant = null
var _quoting: Dictionary = {}
var _posting := false
var _error := ""
var _posted := false
var _refresh_busy := false
var _refresh_error := ""
var _opened_place: Variant = null
var _search: RostraSearch
var _root: Control
var _backdrop: Control
var _rolls: Array = []
var _mast_issue: Label
var _look_built := "phone"
var _shell: PanelContainer
var _ring: PanelContainer
var _body: PanelContainer
var _screen: PanelContainer
var _side_buttons: Array[ColorRect] = []
var _status: MarginContainer
var _status_date: Label
var _header: MarginContainer
var _header_row: HBoxContainer
var _header_date: Label
var _pen_gap: Control
var _date_gap: Control
var _pen: Button
var _close: Button
var _scroll: ScrollContainer
var _content: VBoxContainer
var _composer: MarginContainer
var _composer_avatar_slot: Control
var _posting_as: Label
var _draft: TextEdit
var _choice_box: VBoxContainer
var _quote_slot: VBoxContainer
var _error_label: Label
var _poll_toggle: Button
var _count: Label
var _post_button: Button
var _posted_note: MarginContainer
var _feed: VBoxContainer
var _tab_pad: MarginContainer
var _tab_buttons := {}
var _mention_badge: PanelContainer
var _mention_label: Label
var _home_bar: MarginContainer


func _init() -> void:
	anchor_left = 0.0
	anchor_right = 0.0
	anchor_top = 1.0
	anchor_bottom = 1.0
	offset_left = 8.0
	offset_right = 8.0 + 360.0
	offset_top = 200.0
	offset_bottom = 900.0
	modulate.a = 0.0
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_build()
	_poll = Timer.new()
	_poll.wait_time = 1.5
	_poll.timeout.connect(_on_poll)
	add_child(_poll)


func _ready() -> void:
	get_viewport().size_changed.connect(func() -> void:
		_apply_look()
		_place(false))
	resized.connect(_lay_dress)
	_apply_look()
	_place(false)
	_poll.start()


func setup(link: EngineLink, ctx: Dictionary = {}) -> void:
	engine = link
	context = ctx
	refresh()


func is_open() -> bool:
	return _open


func open() -> void:
	set_open(true)


func close() -> void:
	set_open(false)


func set_open(open: bool) -> void:
	var was := _open
	_open = open
	if open:
		_phone_layer()
	_apply_look()
	_place(true)
	mouse_filter = Control.MOUSE_FILTER_STOP if open else Control.MOUSE_FILTER_IGNORE
	if open and not was:
		if is_instance_valid(_search):
			_search.set_shown(true)
		await _load_view(true)
	elif not open and was:
		_posted = false
		_error = ""
		_posted_note.visible = false
		_update_composer()
		if is_instance_valid(_search):
			_search.set_shown(false)
		_emit_unseen(0, true)


func _phone_layer() -> void:
	if not UI.phone() or get_parent() == null:
		return
	var layer := get_parent().get("_right_layer") as Control
	if layer and layer.get_parent() == get_parent() and get_index() < layer.get_index():
		get_parent().move_child(self, layer.get_index())


func refresh() -> void:
	if engine == null:
		return
	if _open:
		await _load_view(true)
	else:
		await _load_state()


func open_place(place: Dictionary) -> void:
	_opened_place = place.duplicate()
	if tab != "search":
		_set_tab("search")
	elif is_instance_valid(_search):
		_search.open_place(_opened_place)


static func dock_glyph(size: int) -> TextureRect:
	var rect := TextureRect.new()
	rect.texture = glyph(_dock_name(), size)
	rect.custom_minimum_size = Vector2(size, size)
	rect.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	rect.set_meta("dock_size", size)
	_docks.append(weakref(rect))
	return rect


static func _dock_name() -> String:
	return "dock" if LOOK == "phone" else "dock-" + LOOK


static func apply_dress(dress: Dictionary) -> bool:
	var look := str(dress.get("look", "phone"))
	if not RostraLook.LOOKS.has(look):
		look = "phone"
	var vars: Dictionary = PHONE.duplicate()
	var given: Variant = dress.get("vars")
	if typeof(given) == TYPE_DICTIONARY:
		vars.merge(given, true)
	var changed := look != LOOK
	LOOK = look
	EDGE_POINTS = dress.get("edge", []) if typeof(dress.get("edge")) == TYPE_ARRAY else []
	var read := func(key: String) -> Color: return RostraLook.color_of(vars.get(key, PHONE[key]), RostraLook.color_of(PHONE[key], Color.WHITE))
	ACCENT = read.call("--rs-accent")
	ACCENT_SOFT = read.call("--rs-accent-soft")
	ACCENT_EDGE = read.call("--rs-accent-edge")
	ACCENT_BAR = read.call("--rs-accent-bar")
	ON_ACCENT = read.call("--rs-on-accent")
	INK = read.call("--rs-ink")
	INK_SOFT = read.call("--rs-ink-soft")
	INK_FAINT = read.call("--rs-ink-faint")
	LINE = read.call("--rs-line")
	EDGE = read.call("--rs-edge")
	WASH = read.call("--rs-wash")
	WASH_FAINT = read.call("--rs-wash-faint")
	AVATAR = read.call("--rs-avatar")
	SCREEN = read.call("--rs-screen")
	WARN = read.call("--rs-warn")
	BODY_FONT = RostraLook.families(vars.get("--rs-font", "sans-serif"))
	TITLE_FONT = RostraLook.families(vars.get("--rs-title-font", "sans-serif"))
	NAME_FONT = RostraLook.families(vars.get("--rs-name-font", "sans-serif"))
	var carve := str(vars.get("--rs-carve", "none"))
	CARVE = RostraLook.color_of(carve.substr(carve.find("rgb")), Color(0, 0, 0, 0)) if carve.contains("rgb") else Color(0, 0, 0, 0)
	if changed:
		var kept: Array = []
		for ref in _docks:
			var rect := (ref as WeakRef).get_ref() as TextureRect
			if rect != null and is_instance_valid(rect):
				rect.texture = glyph(_dock_name(), int(rect.get_meta("dock_size", 24)))
				kept.append(ref)
		_docks = kept
	return changed


static func phone_look() -> bool:
	return LOOK == "phone"


static func face(weight := 400, slanted := false, spacing := 0.0, names: PackedStringArray = PackedStringArray()) -> Font:
	var family := names if not names.is_empty() else BODY_FONT
	if LOOK == "phone" and names.is_empty():
		if slanted:
			return italic(weight)
		return UI.font(weight, "Arial", int(round(spacing)))
	return RostraLook.font(family, weight, slanted, spacing)


static func glyph(name: String, size: int) -> Texture2D:
	var key := "%s:%d" % [name, size]
	if _textures.has(key):
		return _textures[key]
	var entry: Array = GLYPHS.get(name, ["", 24.0])
	var texture := UI.svg_texture(str(entry[0]), float(size) / float(entry[1]))
	if texture == null:
		return null
	_textures[key] = texture
	return texture


static func glyph_rect(name: String, size: int, color: Color) -> TextureRect:
	var rect := TextureRect.new()
	rect.texture = glyph(name, size)
	rect.self_modulate = color
	rect.custom_minimum_size = Vector2(size, size)
	rect.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
	rect.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return rect


static func mark_texture(size: int) -> Texture2D:
	var key := "mark:%d" % size
	if _textures.has(key):
		return _textures[key]
	var texture := UI.svg_texture(MARK, float(size) / 32.0)
	if texture == null:
		return null
	_textures[key] = texture
	return texture


static func flag_texture(path: String) -> Texture2D:
	if path.is_empty():
		return null
	if _flags.has(path):
		return _flags[path]
	var texture: Texture2D = UI.flag(path, 40) if path.get_extension().to_lower() == "svg" else ImageLoader.texture_from_file(path)
	_flags[path] = texture
	return texture


static func italic(weight := 400) -> Font:
	if _italics.has(weight):
		return _italics[weight]
	var system := SystemFont.new()
	system.font_names = PackedStringArray(["Arial", "Segoe UI", "Helvetica", "Liberation Sans", "Segoe UI Emoji", "Segoe UI Symbol", "sans-serif"])
	system.font_weight = weight
	system.font_italic = true
	system.antialiasing = TextServer.FONT_ANTIALIASING_GRAY
	system.hinting = TextServer.HINTING_LIGHT
	_italics[weight] = system
	return system


static func text(words: String, size: int, color: Color, weight := 400, own := false) -> Label:
	var node := UI.label(words, size, color, weight)
	if LOOK != "phone":
		node.add_theme_font_override("font", face(weight))
	if own:
		node.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	return node


static func para(words: String, size: int, color: Color, weight := 400, line_height := 1.45, own := false) -> Label:
	var node := text(words, size, color, weight, own)
	node.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	node.custom_minimum_size.x = 1
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.add_theme_constant_override("line_spacing", int(round(maxf(0.0, float(size) * (line_height - 1.15)))))
	return node


static func clipped(words: String, size: int, color: Color, weight := 400, own := false) -> Label:
	var node := text(words, size, color, weight, own)
	node.clip_text = true
	node.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	node.custom_minimum_size.x = 1
	return node


static func pad(child: Control, left: float, top: float, right: float, bottom: float) -> MarginContainer:
	var box := MarginContainer.new()
	box.mouse_filter = Control.MOUSE_FILTER_PASS
	for side in [["margin_left", left], ["margin_top", top], ["margin_right", right], ["margin_bottom", bottom]]:
		box.add_theme_constant_override(side[0], int(round(float(side[1]))))
	if child:
		box.add_child(child)
	return box


static func rule(color: Variant = null) -> ColorRect:
	var line := ColorRect.new()
	line.color = LINE if color == null else color
	line.custom_minimum_size.y = 1
	line.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return line


static func row(gap: float) -> HBoxContainer:
	var node := HBoxContainer.new()
	node.add_theme_constant_override("separation", int(round(gap)))
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return node


static func column(gap: float) -> VBoxContainer:
	var node := VBoxContainer.new()
	node.add_theme_constant_override("separation", int(round(gap)))
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return node


static func shrinking(node: Control, weight := 1.0, least := 0.0) -> Control:
	node.set_meta("shrink", weight)
	node.set_meta("least", least)
	if node is Label:
		var label := node as Label
		var font: Font = label.get_theme_font("font")
		var size := label.get_theme_font_size("font_size")
		node.set_meta("basis", ceilf(font.get_string_size(label.text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x) + 2.0)
	return node


static func filling(node: Control) -> Control:
	node.set_meta("fill", true)
	return node


static func spacer() -> Control:
	var node := Control.new()
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return node


static func boxed(bg: Color, edge: Color, corner: float, margin: Vector4, width := 1) -> PanelContainer:
	var holder := PanelContainer.new()
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.add_theme_stylebox_override("panel", UI.box(bg, edge, int(round(corner)), width, margin))
	return holder


static func plain_button(look: StyleBox, hover: StyleBox = null) -> Button:
	var node := Button.new()
	node.focus_mode = Control.FOCUS_NONE
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var lit: StyleBox = hover if hover != null else look
	for state in [["normal", look], ["focus", look], ["disabled", look], ["hover", lit], ["pressed", lit], ["hover_pressed", lit]]:
		node.add_theme_stylebox_override(state[0], state[1])
	return node


static func fill_button(button: Button, child: Control) -> void:
	child.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	button.add_child(child)
	var keep := func() -> void:
		if is_instance_valid(button) and is_instance_valid(child):
			button.custom_minimum_size = child.get_combined_minimum_size().max(tap_floor(button))
	child.minimum_size_changed.connect(keep)
	keep.call()


static func tap_floor(button: Control) -> Vector2:
	if not UI.phone() or button.has_meta("oh_tap_exempt"):
		return Vector2.ZERO
	return Vector2(UI.PHONE_TAP, UI.PHONE_TAP)


static func round_button(name: String, glyph_size: int, color: Color, bg: Color, edge := Color(0, 0, 0, 0), size := 32.0) -> Button:
	var node := plain_button(UI.box(bg, edge, 999, 1))
	node.custom_minimum_size = Vector2(size, size)
	node.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var mark := glyph_rect(name, glyph_size, color)
	mark.name = "Glyph"
	var center := CenterContainer.new()
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	center.add_child(mark)
	node.add_child(center)
	return node


static func avatar(name: String, initials_text: String, flag_path: String, mine: bool, size_rem: float) -> Control:
	var size := size_rem * 16.0
	var holder := Control.new()
	holder.custom_minimum_size = Vector2(size, size)
	holder.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var bg := ACCENT_SOFT if mine else AVATAR
	var edge := ACCENT_EDGE if mine else EDGE
	var face := boxed(bg, edge, 999, Vector4.ZERO)
	if LOOK == "newspaper":
		face = boxed(bg, EDGE, 2, Vector4.ZERO)
	elif LOOK == "scroll":
		face = boxed(bg, EDGE, 999, Vector4.ZERO, 2)
	elif LOOK == "tablet":
		face = PanelContainer.new()
		face.mouse_filter = Control.MOUSE_FILTER_IGNORE
		face.add_theme_stylebox_override("panel", Hollow.new(bg, 999))
	face.name = "Face"
	face.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var letters := text(initials_text if not initials_text.is_empty() else "?", int(round(size_rem * 0.34 * 16.0)), ACCENT if mine else INK_SOFT, 800, true)
	letters.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	letters.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	face.add_child(letters)
	holder.add_child(face)
	var picture := flag_texture(flag_path)
	if picture:
		var width := size_rem * 0.52 * 16.0
		var height := size_rem * 0.36 * 16.0
		var ring := SCREEN
		var corner := 3
		if LOOK == "newspaper":
			ring = INK
			corner = 0
		elif LOOK == "scroll":
			ring = INK_SOFT
		elif LOOK == "tablet":
			ring = Color(0, 0, 0, 0.3)
		var frame := boxed(Color(0, 0, 0, 0), ring, corner, Vector4(1.5, 1.5, 1.5, 1.5), 2)
		frame.name = "Flag"
		frame.clip_contents = true
		frame.position = Vector2(size + 0.2 * 16.0 - width - 3.0, size + 0.12 * 16.0 - height - 3.0)
		frame.size = Vector2(width + 3.0, height + 3.0)
		var image := TextureRect.new()
		image.texture = picture
		image.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		image.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
		image.custom_minimum_size = Vector2(width, height)
		image.mouse_filter = Control.MOUSE_FILTER_IGNORE
		image.material = RostraLook.flag_material(LOOK)
		if LOOK == "phone":
			frame.add_theme_stylebox_override("panel", UI.box(SCREEN, SCREEN, corner, 2, Vector4(1.5, 1.5, 1.5, 1.5)))
		frame.add_child(image)
		holder.add_child(frame)
	return holder


static func quoted_card(post: Dictionary) -> Control:
	if post.is_empty() or bool(post.get("gone", false)):
		var gone := boxed(Color(0, 0, 0, 0), LINE, 10, Vector4(11, 9, 11, 9))
		var words := para("This post is no longer available.", 12, INK_FAINT, 400, 1.3)
		words.add_theme_font_override("font", face(400, true))
		gone.add_child(words)
		return gone
	var card := boxed(Color(0, 0, 0, 0), EDGE, 10, Vector4(11, 9, 11, 9))
	var stack := column(5)
	var top := FitRow.new(7)
	top.add_child(avatar(str(post.get("author", "")), str(post.get("initials", "")), str(post.get("flag", "")), bool(post.get("mine", false)), 1.3))
	top.add_child(shrinking(clipped(str(post.get("author", "")), 12, INK, 700, true)))
	if not str(post.get("role", "")).is_empty():
		top.add_child(shrinking(clipped(str(post["role"]), 11, INK_FAINT, 400, true)))
	top.add_child(filling(spacer()))
	top.add_child(text(str(post.get("date", "")), 11, INK_FAINT))
	stack.add_child(top)
	var body := para(str(post.get("text", "")), 12, INK_SOFT, 400, 1.45, true)
	body.max_lines_visible = 4
	body.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	stack.add_child(body)
	card.add_child(stack)
	return card


static func poll_card(poll: Dictionary) -> Control:
	var card := boxed(WASH_FAINT, EDGE, 12, Vector4(10, 10, 10, 9))
	var stack := column(7)
	var grid := column(6)
	var results: Variant = poll.get("results")
	var has_results := typeof(results) == TYPE_DICTIONARY
	var winner := int(poll.get("winner", -1))
	var choices: Array = poll.get("choices", [])
	for index in range(choices.size()):
		var choice := str(choices[index])
		if has_results:
			var shares: Array = (results as Dictionary).get("shares", [])
			var share := float(shares[index]) if index < shares.size() else 0.0
			var won := index == winner
			var bar := ShareBar.new()
			bar.share = share
			bar.fill = ACCENT_BAR if won else EDGE
			bar.add_theme_stylebox_override("panel", UI.box(WASH, Color(0, 0, 0, 0), 8, 0))
			var line := row(8)
			var name := clipped("✓ %s" % choice if won else choice, 13, INK, 800 if won else 600, true)
			name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			line.add_child(name)
			line.add_child(text("%d%%" % int(share), 12, ACCENT if won else INK_SOFT, 800, true))
			bar.add_child(pad(line, 10, 7, 10, 7))
			grid.add_child(bar)
		else:
			var open := boxed(Color(0, 0, 0, 0), ACCENT_EDGE, 8, Vector4(10, 6, 10, 6))
			open.add_child(clipped(choice, 13, INK, 650, true))
			grid.add_child(open)
	stack.add_child(grid)
	var foot := row(8)
	if has_results:
		var votes := str((results as Dictionary).get("votes", ""))
		foot.add_child(text(I18n.ui("{{votes}} votes", {"votes": votes}) if not votes.is_empty() else "", 11, INK_FAINT, 400, true))
		foot.add_child(spacer())
		foot.add_child(text("Final results", 11, INK_FAINT))
	else:
		foot.add_child(para("The public votes until the next time skip.", 11, INK_FAINT, 400, 1.3))
	stack.add_child(foot)
	if has_results and not str((results as Dictionary).get("consensus", "")).is_empty():
		var box := boxed(WASH_FAINT, LINE, 8, Vector4(9, 7, 9, 7))
		var words := RichTextLabel.new()
		words.bbcode_enabled = true
		words.fit_content = true
		words.scroll_active = false
		words.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		words.mouse_filter = Control.MOUSE_FILTER_IGNORE
		words.add_theme_font_override("normal_font", face(400))
		words.add_theme_font_override("bold_font", face(700))
		words.add_theme_font_size_override("normal_font_size", 12)
		words.add_theme_font_size_override("bold_font_size", 12)
		words.add_theme_color_override("default_color", INK_SOFT)
		words.add_theme_constant_override("line_separation", 4)
		var lead := I18n.now("Public consensus:")
		words.text = "[b][color=#%s]%s[/color][/b] %s" % [INK.to_html(false), lead.replace("[", "[lb]"), str((results as Dictionary)["consensus"]).replace("[", "[lb]")]
		words.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
		box.add_child(words)
		stack.add_child(box)
	card.add_child(stack)
	return card


func post_card(post: Dictionary, can_post: bool, lead := false) -> Control:
	var id := str(post.get("id", ""))
	var mine := bool(post.get("mine", false))
	var article := VBoxContainer.new()
	article.add_theme_constant_override("separation", 0)
	article.mouse_filter = Control.MOUSE_FILTER_PASS
	var line := row(10)
	line.add_child(avatar(str(post.get("author", "")), str(post.get("initials", "")), str(post.get("flag", "")), mine, 2.4))
	var words := column(0)
	words.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var top := FitRow.new(6)
	var author_text := str(post.get("author", ""))
	if LOOK == "newspaper" and lead:
		var headline := para(author_text, 20, INK, 700, 1.15, true)
		headline.name = "Author"
		headline.add_theme_font_override("font", face(700, false, 0.0, NAME_FONT))
		headline.set_meta("least", 40.0)
		headline.set_meta("shrink", 1.0)
		headline.set_meta("basis", ceilf(face(700, false, 0.0, NAME_FONT).get_string_size(author_text, HORIZONTAL_ALIGNMENT_LEFT, -1, 20).x) + 2.0)
		top.add_child(headline)
	else:
		top.add_child(shrinking(author_label(author_text)))
	if mine:
		var you := boxed(ACCENT_SOFT, ACCENT_EDGE, 999, Vector4(6, 1, 6, 1))
		you.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		var you_words := UI.label("You", 9, ACCENT, 800, "Arial", 1)
		if LOOK != "phone":
			you_words.add_theme_font_override("font", face(800, false, 1.0))
		you_words.uppercase = true
		you.add_child(you_words)
		top.add_child(you)
	top.add_child(filling(spacer()))
	top.add_child(text(str(post.get("date", "")), 11, INK_FAINT))
	words.add_child(top)
	if bool(post.get("hasMeta", false)):
		var meta := row(6)
		if typeof(post.get("poll")) == TYPE_DICTIONARY:
			var badge := boxed(ACCENT_SOFT, ACCENT_EDGE, 5, Vector4(5, 0, 5, 0))
			badge.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			badge.add_child(text("Poll", 10, ACCENT, 800))
			meta.add_child(badge)
		var about := clipped(str(post.get("meta", "")), 11, INK_FAINT, 400, true)
		if LOOK == "newspaper":
			about.add_theme_font_override("font", face(400, true))
		elif LOOK == "tablet":
			about.uppercase = true
			about.add_theme_font_size_override("font_size", 10)
			about.add_theme_color_override("font_color", INK_SOFT)
			about.add_theme_font_override("font", face(400, false, 0.6))
		about.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		meta.add_child(about)
		words.add_child(meta)
	words.add_child(pad(post_text(str(post.get("text", "")), lead), 0, 6, 0, 0))
	if typeof(post.get("poll")) == TYPE_DICTIONARY:
		words.add_child(pad(poll_card(post["poll"]), 0, 10, 0, 0))
	if typeof(post.get("quote")) == TYPE_DICTIONARY:
		words.add_child(pad(quoted_card(post["quote"]), 0, 9, 0, 0))
	var actions := row(18)
	var quote := plain_button(StyleBoxEmpty.new())
	quote.disabled = not can_post
	quote.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if can_post else Control.CURSOR_ARROW
	quote.tooltip_text = "Quote this post" if can_post else CANNOT_POST
	quote.modulate.a = 1.0 if can_post else 0.5
	var quote_row := row(5)
	quote_row.add_child(glyph_rect("quote", 16, INK_FAINT))
	quote_row.add_child(text(str(post.get("quotes", "0")), 12, INK_FAINT, 400, true))
	fill_button(quote, quote_row)
	var card: Dictionary = post.get("card", {})
	quote.pressed.connect(func() -> void: start_quote(card))
	actions.add_child(quote)
	if bool(post.get("waiting", false)):
		var waiting := para("The world answers with the next time skip.", 11, INK_FAINT, 400, 1.3)
		waiting.add_theme_font_override("font", face(400, true))
		actions.add_child(waiting)
	else:
		actions.add_child(_count_chip("repost", str(post.get("reposts", "0")), "Reposts"))
		actions.add_child(_count_chip("heart", str(post.get("likes", "0")), "Likes"))
	words.add_child(pad(actions, 0, 9, 0, 0))
	line.add_child(words)
	article.add_child(pad(line, 16, 13, 16, 13 + post_tail()))
	article.add_child(post_rule(lead))
	if not id.is_empty():
		if not _rendered_ids.has(id):
			article.modulate.a = 0.0
			article.create_tween().tween_property(article, "modulate:a", 1.0, 0.28)
		_next_ids[id] = true
	return article


static func author_label(words: String) -> Label:
	var node: Label
	if LOOK == "newspaper":
		node = clipped(words, 15, INK, 700, true)
		node.add_theme_font_override("font", face(700, false, 0.0, NAME_FONT))
	elif LOOK == "scroll":
		node = clipped(words, 16, INK, 400, true)
		node.add_theme_font_override("font", face(400, false, 0.0, NAME_FONT))
	elif LOOK == "tablet":
		node = clipped(words, 13, INK, 800, true)
		node.uppercase = true
		node.add_theme_font_override("font", face(800, false, 1.3, NAME_FONT))
	else:
		node = clipped(words, 13, INK, 800, true)
	node.name = "Author"
	return node


static func post_text(words: String, lead := false) -> Control:
	if LOOK != "newspaper":
		return para(words, 13, INK, 400, 1.5, true)
	if not lead or words.is_empty():
		var plain := para(words, 14, INK, 400, 1.42, true)
		plain.horizontal_alignment = HORIZONTAL_ALIGNMENT_FILL
		return plain
	var rich := RichTextLabel.new()
	rich.bbcode_enabled = true
	rich.fit_content = true
	rich.scroll_active = false
	rich.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	rich.mouse_filter = Control.MOUSE_FILTER_IGNORE
	rich.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	rich.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	rich.custom_minimum_size.x = 1
	rich.add_theme_font_override("normal_font", face(400))
	rich.add_theme_font_size_override("normal_font_size", 14)
	rich.add_theme_color_override("default_color", INK)
	rich.add_theme_constant_override("line_separation", 4)
	rich.push_paragraph(HORIZONTAL_ALIGNMENT_FILL)
	rich.push_dropcap(words.substr(0, 1), face(700, false, 0.0, NAME_FONT), 42, Rect2(0, 1, 2, -2), INK)
	rich.add_text(words.substr(1))
	rich.pop()
	rich.name = "Lead"
	return rich


static func post_tail() -> float:
	return 1.55 * 16.0 - 0.8 * 16.0 if LOOK == "scroll" else 0.0


static func post_rule(lead := false) -> Control:
	if LOOK == "newspaper":
		return RostraLook.double_rule(INK_SOFT) if lead else rule(EDGE)
	if LOOK == "tablet":
		return RostraLook.groove(Color(0, 0, 0, 0.22), Color(1, 1, 1, 0.32))
	if LOOK == "scroll":
		var holder := Control.new()
		holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
		holder.custom_minimum_size.y = 0
		var mark := text("❦", 18, INK_FAINT, 400, true)
		mark.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		mark.set_anchors_and_offsets_preset(Control.PRESET_CENTER_BOTTOM)
		mark.anchor_left = 0.0
		mark.anchor_right = 1.0
		mark.offset_left = 0
		mark.offset_right = 0
		mark.offset_top = -0.15 * 16.0 - 18.0
		mark.offset_bottom = -0.15 * 16.0
		mark.vertical_alignment = VERTICAL_ALIGNMENT_BOTTOM
		holder.add_child(mark)
		return holder
	return rule()


func _count_chip(name: String, value: String, tip: String) -> Control:
	var holder := row(5)
	holder.mouse_filter = Control.MOUSE_FILTER_PASS
	holder.tooltip_text = tip
	holder.add_child(glyph_rect(name, 16, INK_FAINT))
	holder.add_child(text(value, 12, INK_FAINT, 400, true))
	return holder


func _build() -> void:
	_root = Control.new()
	_root.name = "Look"
	_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(_root)
	if LOOK != "phone":
		_backdrop = Control.new()
		_backdrop.name = "Backdrop"
		_backdrop.mouse_filter = Control.MOUSE_FILTER_IGNORE
		_root.add_child(_backdrop)
	_shell = PanelContainer.new()
	_shell.mouse_filter = Control.MOUSE_FILTER_STOP
	_shell.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_root.add_child(_shell)
	_ring = PanelContainer.new()
	_ring.mouse_filter = Control.MOUSE_FILTER_PASS
	_shell.add_child(_ring)
	_body = PanelContainer.new()
	_body.mouse_filter = Control.MOUSE_FILTER_PASS
	_ring.add_child(_body)
	_screen = PanelContainer.new()
	_screen.mouse_filter = Control.MOUSE_FILTER_PASS
	_screen.clip_contents = true
	if LOOK == "tablet":
		var carved := Theme.new()
		for kind in ["Label", "RichTextLabel"]:
			carved.set_color("font_shadow_color", kind, CARVE)
			carved.set_constant("shadow_offset_x", kind, 0)
			carved.set_constant("shadow_offset_y", kind, 1)
		_screen.theme = carved
	_body.add_child(_screen)
	for spec in [[true, 6.2, 1.8], [true, 9.0, 3.0], [false, 9.6, 4.4]]:
		var button := ColorRect.new()
		button.color = FRAME_BUTTON
		button.mouse_filter = Control.MOUSE_FILTER_IGNORE
		button.set_meta("left", spec[0])
		button.set_meta("top", float(spec[1]) * 16.0)
		button.size = Vector2(3, float(spec[2]) * 16.0)
		_side_buttons.append(button)
		_root.add_child(button)
	var room := Control.new()
	room.mouse_filter = Control.MOUSE_FILTER_PASS
	_screen.add_child(room)
	var stack := column(0)
	stack.mouse_filter = Control.MOUSE_FILTER_PASS
	stack.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	room.add_child(stack)
	_status = MarginContainer.new()
	_status.custom_minimum_size.y = 40
	for side in [["margin_left", 22], ["margin_right", 22], ["margin_top", 5], ["margin_bottom", 0]]:
		_status.add_theme_constant_override(side[0], side[1])
	var status_row := row(0)
	_status_date = clipped("", 11, INK, 700, true)
	_status_date.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_status_date.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	status_row.add_child(_status_date)
	var island := boxed(Color(0, 0, 0), Color(1, 1, 1, 0.05), 999, Vector4.ZERO)
	island.custom_minimum_size = Vector2(83, 23)
	island.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	status_row.add_child(island)
	var marks := row(4)
	marks.alignment = BoxContainer.ALIGNMENT_END
	marks.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	marks.add_child(glyph_rect("signal", 16, INK))
	marks.add_child(glyph_rect("wifi", 14, INK))
	marks.add_child(glyph_rect("battery", 22, INK))
	status_row.add_child(marks)
	_status.add_child(status_row)
	stack.add_child(_status)
	_pen = round_button("pen", 17, INK_SOFT, WASH, Color(0, 0, 0, 0))
	_pen.tooltip_text = "Write a post"
	_pen.pressed.connect(_on_pen)
	_close = round_button("close", 15, INK_SOFT, WASH)
	_close.pressed.connect(_on_close)
	if LOOK != "phone":
		for state in ["normal", "focus", "disabled", "hover", "pressed", "hover_pressed"]:
			_close.add_theme_stylebox_override(state, _button_look(false))
	if LOOK == "newspaper":
		_header = _masthead()
		stack.add_child(_header)
	else:
		_header = MarginContainer.new()
		_header_row = row(10)
		if LOOK == "phone":
			var mark := TextureRect.new()
			mark.texture = mark_texture(26)
			mark.custom_minimum_size = Vector2(26, 26)
			mark.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
			mark.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			mark.mouse_filter = Control.MOUSE_FILTER_IGNORE
			_header_row.add_child(mark)
		else:
			_header_row.add_child(RostraLook.look_mark(LOOK))
		var titles := column(2)
		titles.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		var name := UI.label("Rostra", 17, INK, 900, "Arial", 1)
		if LOOK == "scroll":
			name = UI.label("Rostra", 25, INK, 400)
			name.add_theme_font_override("font", face(400, false, 1.0, TITLE_FONT))
		elif LOOK == "tablet":
			name = UI.label("Rostra", 22, INK, 700)
			name.uppercase = true
			name.add_theme_font_override("font", face(700, false, 1.0, TITLE_FONT))
		name.name = "Title"
		name.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
		titles.add_child(name)
		titles.add_child(text("What the world is saying", 10, INK_FAINT))
		if LOOK != "phone":
			titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			titles.clip_contents = true
			titles.custom_minimum_size.x = 1
		_header_row.add_child(titles)
		_date_gap = spacer()
		_header_row.add_child(_date_gap)
		_header_date = text("", 11, INK_FAINT)
		_header_date.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		_header_row.add_child(_header_date)
		_pen_gap = spacer()
		_header_row.add_child(_pen_gap)
		_header_row.add_child(_pen)
		_header_row.add_child(_close)
		_header.add_child(_header_row)
		stack.add_child(_header)
		if LOOK == "phone":
			stack.add_child(rule())
		else:
			stack.add_child(_look_rule(false))
	_scroll = ScrollContainer.new()
	_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	var bar := _scroll.get_v_scroll_bar()
	bar.add_theme_stylebox_override("scroll", StyleBoxEmpty.new())
	bar.add_theme_stylebox_override("scroll_focus", StyleBoxEmpty.new())
	for state in ["grabber", "grabber_highlight", "grabber_pressed"]:
		bar.add_theme_stylebox_override(state, UI.box(Color(1, 1, 1, 0.2) if LOOK == "phone" else EDGE, Color(0, 0, 0, 0), 3, 0, Vector4(3, 0, 3, 0)))
	bar.custom_minimum_size.x = 6
	_content = column(0)
	_content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_content.mouse_filter = Control.MOUSE_FILTER_PASS
	_scroll.add_child(_content)
	stack.add_child(_scroll)
	_build_composer()
	_content.add_child(_composer)
	var note := text("Posted. The world answers with the next time skip.", 12, ACCENT)
	note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	note.custom_minimum_size.x = 1
	var note_stack := column(0)
	note_stack.add_child(pad(note, 16, 10, 16, 10))
	note_stack.add_child(rule())
	_posted_note = pad(note_stack, 0, 0, 0, 0)
	_posted_note.visible = false
	_content.add_child(_posted_note)
	_feed = column(0)
	_feed.mouse_filter = Control.MOUSE_FILTER_PASS
	_content.add_child(_feed)
	stack.add_child(rule() if LOOK == "phone" else _look_rule(true))
	_tab_pad = MarginContainer.new()
	var tabs := row(0)
	tabs.mouse_filter = Control.MOUSE_FILTER_PASS
	for entry in TABS:
		var key: String = entry[0]
		var button := plain_button(StyleBoxEmpty.new())
		button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var inner := column(3)
		inner.alignment = BoxContainer.ALIGNMENT_CENTER
		var icon_holder := Control.new()
		icon_holder.custom_minimum_size = Vector2(21, 21)
		icon_holder.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
		icon_holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var icon := glyph_rect(str(entry[2]), 21, INK_FAINT)
		icon.name = "Glyph"
		icon.position = Vector2.ZERO
		icon.size = Vector2(21, 21)
		icon_holder.add_child(icon)
		if key == "mentions":
			_mention_badge = boxed(ACCENT, SCREEN, 999, Vector4(3, 0, 3, 0), 2)
			_mention_badge.custom_minimum_size = Vector2(17, 17)
			_mention_label = text("", 9, ON_ACCENT, 800, true)
			_mention_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			_mention_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
			_mention_badge.add_child(_mention_label)
			_mention_badge.visible = false
			icon_holder.add_child(_mention_badge)
		inner.add_child(icon_holder)
		var caption := clipped(str(entry[1]), _caption_size(), INK_FAINT, 650)
		caption.name = "Caption"
		caption.uppercase = LOOK == "newspaper" or LOOK == "tablet"
		caption.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		caption.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		inner.add_child(caption)
		var holder := pad(inner, 2, 5, 2, 5)
		holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
		fill_button(button, holder)
		button.pressed.connect(_set_tab.bind(key))
		_tab_buttons[key] = button
		tabs.add_child(button)
	_tab_pad.add_child(tabs)
	stack.add_child(_tab_pad)
	var home := CenterContainer.new()
	home.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var pill := boxed(Color(244 / 255.0, 244 / 255.0, 245 / 255.0, 0.85), Color(0, 0, 0, 0), 999, Vector4.ZERO)
	pill.custom_minimum_size = Vector2(106, 4)
	home.add_child(pill)
	_home_bar = pad(home, 0, 5, 0, 7)
	stack.add_child(_home_bar)
	_rolls = []
	if LOOK == "scroll":
		for end in ["top", "bottom"]:
			var roll := RostraLook.Roll.new(end)
			_rolls.append(roll)
			_root.add_child(roll)
	_look_built = LOOK
	_style_tabs()
	_render_feed()


func _on_pen() -> void:
	if _composing:
		_close_composer()
	else:
		_open_composer()


func _on_close() -> void:
	closed.emit()


func _masthead() -> MarginContainer:
	var mast := pad(null, 0.85 * 16.0, 0.35 * 16.0, 0.85 * 16.0, 0)
	var col := column(0)
	var title := UI.label("Rostra", 39, INK, 400)
	title.name = "Title"
	title.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	title.add_theme_font_override("font", face(400, false, 0.0, TITLE_FONT))
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(pad(title, 4.4 * 16.0, 0.15 * 16.0, 4.4 * 16.0, 0.2 * 16.0))
	col.add_child(rule(INK_SOFT))
	var line := row(6)
	_mast_issue = text("", 10, INK_SOFT, 400, true)
	_mast_issue.uppercase = true
	_mast_issue.add_theme_font_override("font", face(400, false, 0.6))
	_mast_issue.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	line.add_child(_mast_issue)
	var motto := text("What the world is saying", 10, INK_SOFT)
	motto.add_theme_font_override("font", face(400, true))
	line.add_child(motto)
	_header_date = text("", 10, INK_SOFT, 400, true)
	_header_date.uppercase = true
	_header_date.add_theme_font_override("font", face(400, false, 0.6))
	_header_date.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_header_date.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	line.add_child(_header_date)
	col.add_child(pad(line, 1.6, 3.5, 1.6, 3.5))
	col.add_child(RostraLook.double_rule(INK_SOFT))
	var gap := Control.new()
	gap.custom_minimum_size.y = 0.35 * 16.0
	gap.mouse_filter = Control.MOUSE_FILTER_IGNORE
	col.add_child(gap)
	mast.add_child(col)
	var overlay := Control.new()
	overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var actions := row(0.3 * 16.0)
	actions.mouse_filter = Control.MOUSE_FILTER_PASS
	actions.add_child(_pen)
	actions.add_child(_close)
	actions.anchor_left = 1.0
	actions.anchor_right = 1.0
	actions.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	actions.offset_right = 0.85 * 16.0 - 0.6 * 16.0
	actions.offset_left = actions.offset_right
	actions.offset_top = 0.45 * 16.0 - 0.35 * 16.0
	overlay.add_child(actions)
	mast.add_child(overlay)
	_date_gap = spacer()
	_pen_gap = spacer()
	return mast


func _look_rule(flip: bool) -> Control:
	if LOOK == "scroll":
		var line := row(0.45 * 16.0)
		var left := rule()
		left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		left.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		line.add_child(left)
		var mark := text("❧", 20, ACCENT, 400, true)
		if flip:
			mark.name = "Flipped"
			var turned := FlipBox.new()
			turned.add_child(mark)
			line.add_child(turned)
		else:
			line.add_child(mark)
		var right := rule()
		right.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		right.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		line.add_child(right)
		return pad(line, 16, 0, 16, 0)
	if LOOK == "tablet":
		return pad(RostraLook.groove(Color(0, 0, 0, 0.28), Color(1, 1, 1, 0.35)), 0.7 * 16.0, 0, 0.7 * 16.0, 0)
	return RostraLook.double_rule(INK_SOFT)


func _caption_size() -> int:
	if LOOK == "newspaper":
		return 10
	if LOOK == "scroll":
		return 11
	if LOOK == "tablet":
		return 9
	return 10


func _button_look(active: bool) -> StyleBox:
	if LOOK == "newspaper":
		return UI.box(Color(0, 0, 0, 0), EDGE, 2, 1)
	if LOOK == "scroll":
		return UI.box(Color(0, 0, 0, 0), EDGE, 999, 1)
	if LOOK == "tablet":
		return Hollow.new(Color(0, 0, 0, 0), 999)
	return UI.box(ACCENT_SOFT if active else WASH, ACCENT_EDGE if active else Color(0, 0, 0, 0), 999, 1)


func _build_composer() -> void:
	var stack := column(0)
	var line := row(10)
	_composer_avatar_slot = Control.new()
	_composer_avatar_slot.custom_minimum_size = Vector2(38.4, 38.4)
	_composer_avatar_slot.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	_composer_avatar_slot.mouse_filter = Control.MOUSE_FILTER_IGNORE
	line.add_child(_composer_avatar_slot)
	var right := column(0)
	right.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	right.mouse_filter = Control.MOUSE_FILTER_PASS
	var who := row(4)
	who.add_child(text("Posting as", 11, INK_FAINT))
	_posting_as = clipped("", 11, INK_SOFT, 700, true)
	_posting_as.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	who.add_child(_posting_as)
	right.add_child(who)
	_draft = TextEdit.new()
	_draft.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	_draft.scroll_fit_content_height = true
	_draft.add_theme_font_override("font", face(400))
	_draft.add_theme_font_size_override("font_size", 14)
	_draft.add_theme_color_override("font_color", INK)
	_draft.add_theme_color_override("font_readonly_color", INK_SOFT)
	_draft.add_theme_color_override("font_placeholder_color", INK_FAINT)
	_draft.add_theme_color_override("caret_color", INK)
	_draft.add_theme_constant_override("line_spacing", 5)
	for state in ["normal", "focus", "read_only"]:
		_draft.add_theme_stylebox_override(state, StyleBoxEmpty.new())
	for bar in [_draft.get_v_scroll_bar(), _draft.get_h_scroll_bar()]:
		for state in ["scroll", "scroll_focus", "grabber", "grabber_highlight", "grabber_pressed"]:
			(bar as ScrollBar).add_theme_stylebox_override(state, StyleBoxEmpty.new())
		(bar as ScrollBar).modulate.a = 0.0
	_draft.text_changed.connect(func() -> void:
		_posted = false
		_posted_note.visible = false
		_update_composer())
	_draft.gui_input.connect(_on_draft_key)
	right.add_child(pad(_draft, 0, 5, 0, 0))
	_choice_box = column(6)
	_choice_box.mouse_filter = Control.MOUSE_FILTER_PASS
	right.add_child(_choice_box)
	_quote_slot = column(0)
	_quote_slot.mouse_filter = Control.MOUSE_FILTER_PASS
	right.add_child(_quote_slot)
	_error_label = para("", 12, WARN, 400, 1.3, true)
	right.add_child(_error_label)
	var foot_stack := column(8)
	foot_stack.mouse_filter = Control.MOUSE_FILTER_PASS
	foot_stack.add_child(rule())
	var foot := row(10)
	foot.mouse_filter = Control.MOUSE_FILTER_PASS
	_poll_toggle = plain_button(StyleBoxEmpty.new())
	var toggle_row := row(5)
	toggle_row.add_child(glyph_rect("poll", 16, INK_SOFT))
	toggle_row.add_child(text("Poll", 12, INK_SOFT, 700))
	fill_button(_poll_toggle, pad(toggle_row, 9, 5, 9, 5))
	_poll_toggle.pressed.connect(func() -> void:
		_choices = null if _choices != null else ["", ""]
		_render_choices()
		_update_composer())
	foot.add_child(_poll_toggle)
	foot.add_child(spacer())
	_count = text("0/280", 11, INK_FAINT, 400, true)
	_count.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	foot.add_child(_count)
	_post_button = plain_button(UI.box(ACCENT, Color(0, 0, 0, 0), 999, 0, Vector4(17, 6, 17, 6)))
	_post_button.add_theme_font_override("font", face(800))
	_post_button.add_theme_font_size_override("font_size", 12)
	for slot in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color", "font_disabled_color"]:
		_post_button.add_theme_color_override(slot, ON_ACCENT)
	_post_button.text = "Post"
	_post_button.pressed.connect(_submit)
	foot.add_child(_post_button)
	foot_stack.add_child(foot)
	right.add_child(pad(foot_stack, 0, 8, 0, 0))
	line.add_child(right)
	stack.add_child(pad(line, 16, 14, 16, 14))
	stack.add_child(rule())
	_composer = pad(stack, 0, 0, 0, 0)
	_composer.visible = false


func _apply_look() -> void:
	var area := get_viewport_rect().size if is_inside_tree() else Vector2(1600, 900)
	var touch := DisplayServer.is_touchscreen_available() or UI.phone()
	framed = area.x > 700.0 and not (touch and area.y <= 500.0)
	var phone := LOOK == "phone"
	if phone and framed:
		var outer := UI.box(Color("#0e0e10"), Color(0, 0, 0, 0), int(round(41.6 + RING)), 0, Vector4(2, 2, 2, 2))
		outer.shadow_color = Color(0, 0, 0, 0.55)
		outer.shadow_size = 30
		outer.shadow_offset = Vector2(0, 24)
		_shell.add_theme_stylebox_override("panel", outer)
		_ring.add_theme_stylebox_override("panel", UI.box(Color("#3a3a40"), Color(0, 0, 0, 0), int(round(41.6 + 1.0)), 0, Vector4(1, 1, 1, 1)))
		_body.add_theme_stylebox_override("panel", UI.box(FRAME, Color(0, 0, 0, 0), 42, 0, Vector4(8, 8, 8, 8)))
		_screen.add_theme_stylebox_override("panel", UI.box(SCREEN, Color(0, 0, 0, 0), 34, 0))
	elif phone:
		var look := UI.box(Color(11 / 255.0, 11 / 255.0, 13 / 255.0, 0.97), Color(1, 1, 1, 0.1), 16, 1)
		look.shadow_color = Color(0, 0, 0, 0.4)
		look.shadow_size = 12
		look.shadow_offset = Vector2(-4, 0)
		_shell.add_theme_stylebox_override("panel", look)
		_ring.add_theme_stylebox_override("panel", StyleBoxEmpty.new())
		_body.add_theme_stylebox_override("panel", StyleBoxEmpty.new())
		_screen.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 16, 0))
	else:
		var shell := StyleBoxEmpty.new()
		if framed:
			var padding: Vector4 = (RostraLook.FRAMES[LOOK] as Dictionary)["padding"]
			shell.content_margin_left = padding.x * 16.0
			shell.content_margin_top = padding.y * 16.0
			shell.content_margin_right = padding.z * 16.0
			shell.content_margin_bottom = padding.w * 16.0
		else:
			for side in [SIDE_LEFT, SIDE_TOP, SIDE_RIGHT, SIDE_BOTTOM]:
				shell.set_content_margin(side, 1.0)
		_shell.add_theme_stylebox_override("panel", shell)
		_ring.add_theme_stylebox_override("panel", StyleBoxEmpty.new())
		_body.add_theme_stylebox_override("panel", StyleBoxEmpty.new())
		var screen := StyleBoxFlat.new()
		screen.bg_color = Color(0, 0, 0, 0)
		if framed and LOOK == "newspaper":
			screen.border_width_bottom = 1
			screen.border_color = Color(27 / 255.0, 26 / 255.0, 23 / 255.0, 0.55)
		if framed and LOOK == "tablet":
			screen.content_margin_top = float((RostraLook.FRAMES["tablet"] as Dictionary)["inner_top"]) * 16.0
		_screen.add_theme_stylebox_override("panel", screen)
		_dress_backdrop()
	for button in _side_buttons:
		button.visible = framed and phone
	_status.visible = framed and phone
	_home_bar.visible = framed and phone
	for roll in _rolls:
		(roll as Control).visible = framed
	_header_date.visible = LOOK == "newspaper" or not (framed and phone)
	_date_gap.visible = not (framed and phone)
	_pen_gap.visible = framed and phone
	if LOOK != "newspaper":
		var header_pad := Vector4(15, 4, 15, 10) if framed else (Vector4(14, 10, 14, 9) if touch else Vector4(18, 14, 18, 10))
		for side in [["margin_left", header_pad.x], ["margin_top", header_pad.y], ["margin_right", header_pad.z], ["margin_bottom", header_pad.w]]:
			_header.add_theme_constant_override(side[0], int(side[1]))
	for side in [["margin_left", 6], ["margin_top", 5], ["margin_right", 6], ["margin_bottom", 1 if framed else 6]]:
		_tab_pad.add_theme_constant_override(side[0], side[1])
	_draft.custom_minimum_size.y = 46.0 if (touch or framed) else 66.0
	if _mention_badge:
		_mention_badge.add_theme_stylebox_override("panel", UI.box(ACCENT, SCREEN if (framed or not phone) else Color("#18181b"), 999, 2, Vector4(3, 0, 3, 0)))
	_lay_dress()


func _dress_backdrop() -> void:
	if not is_instance_valid(_backdrop):
		return
	var key := "%s:%s" % [LOOK, framed]
	if str(_backdrop.get_meta("dressed", "")) == key:
		return
	_backdrop.set_meta("dressed", key)
	for child in _backdrop.get_children():
		_backdrop.remove_child(child)
		child.queue_free()
	var frame: Dictionary = RostraLook.FRAMES.get(LOOK, {})
	if framed:
		var params: Dictionary = (frame["material"] as Dictionary).duplicate()
		params["drops"] = frame.get("drops", [])
		var jags := RostraLook.edge_jags(EDGE_POINTS) if LOOK == "scroll" or LOOK == "tablet" else {}
		var material := RostraLook.surface(params, LOOK, jags, 64.0)
		material.name = "Material"
		_backdrop.add_child(material)
		if LOOK == "newspaper":
			for fold in [[0, Color(60 / 255.0, 48 / 255.0, 26 / 255.0, 0.12)], [1, Color(1, 1, 1, 0.45)]]:
				var line := ColorRect.new()
				line.name = "Fold"
				line.color = fold[1]
				line.set_meta("below", fold[0])
				line.mouse_filter = Control.MOUSE_FILTER_IGNORE
				_backdrop.add_child(line)
		if LOOK == "tablet":
			var cracks := RostraLook.Cracks.new()
			cracks.name = "Cracks"
			_backdrop.add_child(cracks)
			var inner := RostraLook.surface(frame["inner"], "", {}, 4.0)
			inner.name = "Inner"
			_backdrop.add_child(inner)
	else:
		var plain := RostraLook.surface({"base": SCREEN, "top": Vector2(16, 16), "bottom": Vector2(16, 16), "border": [1.0, EDGE], "drops": [[Vector2(-4, 0), 24.0, Color(0, 0, 0, 0.4)]]}, LOOK, {}, 40.0)
		plain.name = "Material"
		_backdrop.add_child(plain)


func _lay_dress() -> void:
	if not is_instance_valid(_backdrop):
		return
	var box := Rect2(Vector2.ZERO, size)
	for child in _backdrop.get_children():
		var node := child as Control
		match str(node.name):
			"Material":
				RostraLook.place_surface(node, box)
			"Cracks":
				node.position = Vector2.ZERO
				node.size = size
			"Fold":
				node.position = Vector2(0, roundf(size.y * 0.5) + float(node.get_meta("below", 0)))
				node.size = Vector2(size.x, 1)
			"Inner":
				var padding: Vector4 = (RostraLook.FRAMES["tablet"] as Dictionary)["padding"] * 16.0
				RostraLook.place_surface(node, Rect2(padding.x, padding.y, size.x - padding.x - padding.z, size.y - padding.y - padding.w))
	var reach := 1.45 * 16.0
	for roll in _rolls:
		var node := roll as RostraLook.Roll
		var top := -reach if node.end == "top" else size.y + reach - 1.7 * 16.0
		node.position = Vector2(-reach, top)
		node.size = Vector2(size.x + reach * 2.0, 1.7 * 16.0)


func frame_size() -> Vector2:
	var area := get_viewport_rect().size if is_inside_tree() else Vector2(1600, 900)
	if framed and LOOK != "phone":
		var tall := maxf(minf(736.0, area.y - 144.0), 384.0)
		return Vector2(minf(384.0, area.x - 16.0), tall)
	if framed:
		var height := maxf(minf(736.0, area.y - 144.0), 384.0)
		var width := maxf(height * 9.0 / 19.0, minf(280.0, area.x - 16.0))
		return Vector2(minf(width, area.x - 16.0), height)
	var tall := maxf(160.0, minf(area.y - 144.0, maxf(area.y - 256.0, 480.0)))
	var inset := UI.safe_insets()
	var wide := area.x - 16.0 - inset.x - inset.z if area.x <= 700.0 else minf(496.0, area.x - 16.0)
	return Vector2(wide, tall)


func _place(animate: bool) -> void:
	var box := frame_size()
	var grow := RING if framed and LOOK == "phone" else 0.0
	var lift := float((RostraLook.FRAMES.get(LOOK, {}) as Dictionary).get("margin", 0.0)) * 16.0 if framed else 0.0
	var inset := UI.safe_insets()
	var top := -BOTTOM_GAP - lift - inset.w - box.y - grow if _open else 200.0
	var bottom := -BOTTOM_GAP - lift - inset.w + grow if _open else 200.0 + box.y + grow * 2.0
	offset_left = 8.0 + inset.x - grow
	offset_right = 8.0 + inset.x + box.x + grow
	for button in _side_buttons:
		var on_left: bool = button.get_meta("left")
		button.position = Vector2(0.0 if on_left else grow + box.x, grow + float(button.get_meta("top")))
	if not animate:
		offset_top = top
		offset_bottom = bottom
		modulate.a = 1.0 if _open else 0.0
		return
	var tween := create_tween().set_parallel(true).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	tween.tween_property(self, "offset_top", top, 0.35)
	tween.tween_property(self, "offset_bottom", bottom, 0.35)
	tween.tween_property(self, "modulate:a", 1.0 if _open else 0.0, 0.35)


func _take_dress(reply: Dictionary) -> void:
	var dress: Variant = reply.get("dress")
	if typeof(dress) != TYPE_DICTIONARY:
		return
	apply_dress(dress)
	if LOOK == _look_built:
		return
	_rebuild()


func _rebuild() -> void:
	var keep_tab := tab
	if is_instance_valid(_search):
		_search = null
	_tab_buttons = {}
	_side_buttons = []
	_rolls = []
	_backdrop = null
	if is_instance_valid(_root):
		remove_child(_root)
		_root.queue_free()
	_composing = false
	_choices = null
	_quoting = {}
	_posted = false
	_rendered_ids = {}
	_build()
	tab = keep_tab
	_apply_look()
	_place(false)
	_view_json = ""
	if not view.is_empty():
		_render()


func _on_poll() -> void:
	if engine == null or _loading:
		return
	if _open:
		await _load_view(false)
	else:
		await _load_state()


func _load_state() -> void:
	if engine == null:
		return
	var reply: Dictionary = await engine.request("social.state")
	if not reply.get("ok", false) or typeof(reply.get("result")) != TYPE_DICTIONARY:
		return
	var state: Dictionary = reply["result"]
	_take_dress(state)
	_set_enabled(bool(state.get("enabled", true)))
	if not _open:
		_emit_unseen(int(state.get("unseen", 0)))


func _emit_unseen(count: int, force := false) -> void:
	if count == _unseen and not force:
		return
	_unseen = count
	unseen_changed.emit(count)


func _set_enabled(on: bool) -> void:
	if on == _enabled:
		return
	_enabled = on
	enabled_changed.emit(on)
	if not on and _open:
		closed.emit()


func _load_view(force: bool) -> void:
	if engine == null:
		return
	_loading = true
	var asked := tab
	var reply: Dictionary = await engine.request("social.view", {"tab": tab, "force": force})
	_loading = false
	if not reply.get("ok", false) or typeof(reply.get("result")) != TYPE_DICTIONARY or asked != tab:
		return
	var next: Dictionary = reply["result"]
	_take_dress(next)
	_set_enabled(bool(next.get("enabled", true)))
	var newest := int(next.get("newest", 0))
	if _open and newest > _seen_sent:
		_seen_sent = newest
		engine.request("social.seen", {"number": newest})
	if _open:
		_emit_unseen(0)
	var json := JSON.stringify(next)
	if json == _view_json:
		return
	view = next
	_view_json = json
	_render()


func _render() -> void:
	var day := str(view.get("date", ""))
	if day != _status_date.text and not _status_date.text.is_empty() and is_instance_valid(_search):
		_search.refresh_view()
	_status_date.text = str(view.get("date", ""))
	_header_date.text = str(view.get("date", ""))
	if is_instance_valid(_mast_issue):
		var issue := int(view.get("round", 0))
		_mast_issue.text = "№ %d" % issue if issue > 0 else ""
	var has_country := not str(view.get("country", "")).is_empty()
	_pen.disabled = not has_country
	_pen.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if has_country else Control.CURSOR_ARROW
	_style_pen()
	_style_tabs()
	_update_composer()
	_render_feed()


func _style_pen() -> void:
	var look := _button_look(_composing)
	for state in ["normal", "focus", "disabled", "hover", "pressed", "hover_pressed"]:
		_pen.add_theme_stylebox_override(state, look)
	var mark := _pen.find_child("Glyph", true, false) as TextureRect
	if mark:
		mark.self_modulate = ACCENT if _composing else INK_SOFT
	_pen.tooltip_text = "Put the post away" if _composing else "Write a post"


func _caption_face(weight: int) -> Font:
	if LOOK == "newspaper":
		return face(weight, false, 0.4)
	if LOOK == "scroll":
		return face(weight, true)
	if LOOK == "tablet":
		return face(weight, false, 0.7)
	return face(weight)


func _style_tabs() -> void:
	for key in _tab_buttons:
		var button: Button = _tab_buttons[key]
		var active: bool = key == tab
		var ink := INK if active else INK_FAINT
		var mark := button.find_child("Glyph", true, false) as TextureRect
		mark.self_modulate = ink
		var caption := button.find_child("Caption", true, false) as Label
		caption.add_theme_color_override("font_color", ink)
		caption.add_theme_font_override("font", _caption_face(800 if active else 650))
	var count := int(view.get("mentionCount", 0))
	_mention_badge.visible = count > 0
	_mention_label.text = "9+" if count > 9 else str(count)
	_mention_badge.reset_size()
	_mention_badge.position = Vector2(21.0 + 9.6 - _mention_badge.size.x, -6.4)


func _set_tab(key: String) -> void:
	if key == tab:
		return
	tab = key
	if is_instance_valid(_search) and key != "search":
		_search.queue_free()
		_search = null
	view["posts"] = []
	_style_tabs()
	_render_feed()
	_scroll.scroll_vertical = 0
	await _load_view(true)


func _render_feed() -> void:
	if tab == "search":
		for child in _feed.get_children():
			if child != _search:
				_feed.remove_child(child)
				child.queue_free()
		if not is_instance_valid(_search):
			_search = RostraSearch.new()
			_search.setup(engine, func(post: Dictionary, lead: bool) -> Control: return post_card(post, bool(view.get("canPost", false)), lead), _opened_place, _open)
			_feed.add_child(_search)
		else:
			_search.set_can_post(bool(view.get("canPost", false)))
		return
	var keep := _scroll.scroll_vertical
	for child in _feed.get_children():
		_feed.remove_child(child)
		child.queue_free()
	if view.is_empty():
		return
	_next_ids = {}
	var posts: Array = view.get("posts", [])
	if posts.is_empty() and tab == "all":
		_feed.add_child(_empty_refresh())
	elif posts.is_empty():
		var words := para(str(EMPTY_TEXTS.get(tab, "")), 12, INK_FAINT, 400, 1.5)
		words.add_theme_font_override("font", face(400, true))
		_feed.add_child(pad(words, 18, 19, 18, 19))
	else:
		var can_post := bool(view.get("canPost", false))
		for index in range(posts.size()):
			_feed.add_child(post_card(posts[index], can_post, index == 0))
	_rendered_ids = _next_ids
	_restore_scroll.call_deferred(keep)


func _restore_scroll(offset: int) -> void:
	if is_instance_valid(_scroll):
		_scroll.scroll_vertical = offset


func _empty_refresh() -> Control:
	var stack := column(0)
	stack.alignment = BoxContainer.ALIGNMENT_CENTER
	var headline := text("Nothing has been posted yet.", 14, INK, 750)
	headline.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	stack.add_child(headline)
	if bool(view.get("shared", false)):
		var words := para("The people who make the news post with the next time skip.", 12, INK_SOFT)
		words.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		stack.add_child(pad(words, 0, 6, 0, 0))
	else:
		var words := para("Refresh to see what the people who make the news are posting.", 12, INK_SOFT)
		words.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		stack.add_child(pad(words, 0, 6, 0, 0))
		stack.add_child(refresh_button(_refresh_busy, not bool(view.get("canPost", false)), _refresh_feed))
		if not _refresh_error.is_empty():
			var problem := para(_refresh_error, 12, WARN, 400, 1.4, true)
			problem.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			stack.add_child(pad(problem, 0, 10, 0, 0))
	return pad(stack, 18, 26, 18, 26)


static func refresh_button(busy: bool, disabled: bool, action: Callable) -> Control:
	var stack := column(0)
	var look := UI.box(INK, Color(0, 0, 0, 0), 999, 0, Vector4(17, 7, 17, 7))
	var button := plain_button(look)
	button.disabled = busy or disabled
	button.mouse_default_cursor_shape = Control.CURSOR_ARROW if busy or disabled else Control.CURSOR_POINTING_HAND
	button.modulate.a = 0.5 if disabled else 1.0
	button.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	var inside := row(6)
	inside.alignment = BoxContainer.ALIGNMENT_CENTER
	inside.add_child(glyph_rect("refresh", 15, SCREEN))
	inside.add_child(text("Refreshing…" if busy else "Refresh", 12, SCREEN, 800))
	fill_button(button, pad(inside, 17, 7, 17, 7))
	button.pressed.connect(action)
	stack.add_child(pad(button, 0, 10, 0, 0))
	var cost := text("One AI request", 11, INK_FAINT)
	cost.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	stack.add_child(pad(cost, 0, 8, 0, 0))
	return stack


func _refresh_feed() -> void:
	if _refresh_busy or engine == null:
		return
	_refresh_busy = true
	_refresh_error = ""
	_render_feed()
	var reply: Dictionary = await engine.request("social.refresh")
	_refresh_busy = false
	var result: Dictionary = reply.get("result", {}) if reply.get("ok", false) and typeof(reply.get("result")) == TYPE_DICTIONARY else {"ok": false, "error": str(reply.get("error", "The posts could not be loaded."))}
	if not bool(result.get("ok", false)):
		_refresh_error = str(result.get("error", ""))
	_view_json = ""
	await _load_view(true)
	_render_feed()


func start_quote(card: Dictionary) -> void:
	_quoting = card.duplicate()
	_open_composer()


func _open_composer() -> void:
	_composing = true
	_error = ""
	_posted = false
	_posted_note.visible = false
	_composer.visible = true
	_render_quote()
	_render_choices()
	_update_composer()
	_style_pen()
	var tween := create_tween()
	tween.tween_property(_scroll, "scroll_vertical", 0, 0.25)
	await get_tree().create_timer(0.06).timeout
	if is_instance_valid(_draft) and _draft.is_visible_in_tree():
		_draft.grab_focus()


func _close_composer() -> void:
	_composing = false
	_choices = null
	_quoting = {}
	_error = ""
	_composer.visible = false
	_render_quote()
	_render_choices()
	_update_composer()
	_style_pen()


func _render_quote() -> void:
	for child in _quote_slot.get_children():
		_quote_slot.remove_child(child)
		child.queue_free()
	if _quoting.is_empty():
		return
	var holder := MarginContainer.new()
	holder.mouse_filter = Control.MOUSE_FILTER_PASS
	holder.add_child(quoted_card(_quoting))
	var overlay := Control.new()
	overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.add_child(overlay)
	var remove := plain_button(UI.box(SCREEN, EDGE, 999, 1))
	remove.tooltip_text = "Remove the quote"
	remove.anchor_left = 1.0
	remove.anchor_right = 1.0
	remove.offset_left = -22.4 + 5.6
	remove.offset_right = 5.6
	remove.offset_top = 3.2
	remove.offset_bottom = 3.2 + 22.4
	var center := CenterContainer.new()
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	center.add_child(glyph_rect("close", 15, INK_SOFT))
	remove.add_child(center)
	remove.pressed.connect(func() -> void:
		_quoting = {}
		_render_quote())
	overlay.add_child(remove)
	_quote_slot.add_child(pad(holder, 0, 9, 0, 0))


func _render_choices() -> void:
	for child in _choice_box.get_children():
		_choice_box.remove_child(child)
		child.queue_free()
	if _choices == null:
		_choice_box.visible = false
		return
	_choice_box.visible = true
	var choices: Array = _choices
	var can_post := bool(view.get("canPost", false))
	var least := int(view.get("pollMin", 2))
	var most := int(view.get("pollMax", 4))
	var gap := Control.new()
	gap.custom_minimum_size.y = 0
	_choice_box.add_child(gap)
	for index in range(choices.size()):
		var line := row(6)
		line.mouse_filter = Control.MOUSE_FILTER_PASS
		var field := LineEdit.new()
		field.text = str(choices[index])
		field.max_length = int(view.get("choiceMax", 40))
		field.editable = can_post
		field.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
		field.placeholder_text = I18n.ui("Choice {{value}}", {"value": index + 1})
		field.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		field.add_theme_font_override("font", face(400))
		field.add_theme_font_size_override("font_size", 13)
		field.add_theme_color_override("font_color", INK)
		field.add_theme_color_override("font_placeholder_color", INK_FAINT)
		field.add_theme_color_override("caret_color", INK)
		var look := UI.box(WASH_FAINT, ACCENT_EDGE, 8, 1, Vector4(9, 6, 9, 6))
		for state in ["normal", "focus", "read_only"]:
			field.add_theme_stylebox_override(state, look)
		var at := index
		field.text_changed.connect(func(value: String) -> void:
			if _choices != null and at < (_choices as Array).size():
				(_choices as Array)[at] = value
			_update_composer())
		line.add_child(field)
		if choices.size() > least:
			var remove := plain_button(StyleBoxEmpty.new())
			remove.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
			remove.tooltip_text = I18n.ui("Remove choice {{value}}", {"value": index + 1})
			var mark := glyph_rect("close", 15, INK_FAINT)
			fill_button(remove, pad(mark, 3, 3, 3, 3))
			remove.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			remove.pressed.connect(func() -> void:
				if _choices != null:
					(_choices as Array).remove_at(at)
				_render_choices()
				_update_composer())
			line.add_child(remove)
		_choice_box.add_child(line)
	var foot := row(10)
	foot.mouse_filter = Control.MOUSE_FILTER_PASS
	if choices.size() < most:
		var add := plain_button(StyleBoxEmpty.new())
		add.text = "Add a choice"
		add.add_theme_font_override("font", face(700))
		add.add_theme_font_size_override("font_size", 12)
		for slot in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
			add.add_theme_color_override(slot, ACCENT)
		add.pressed.connect(func() -> void:
			if _choices != null:
				(_choices as Array).append("")
			_render_choices()
			_update_composer())
		foot.add_child(add)
	foot.add_child(spacer())
	var note := para("The public votes until the next time skip.", 11, INK_FAINT, 400, 1.3)
	note.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	note.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	foot.add_child(note)
	_choice_box.add_child(foot)


func _typed_choices() -> Array:
	var typed: Array = []
	if _choices == null:
		return typed
	for choice in (_choices as Array):
		var clean := str(choice).strip_edges()
		if not clean.is_empty():
			typed.append(clean)
	return typed


func _can_post() -> bool:
	return bool(view.get("canPost", false))


func _ready_to_post() -> bool:
	var body := _draft.text.strip_edges()
	var length := body.length()
	var poll_ready := _choices == null or _typed_choices().size() >= int(view.get("pollMin", 2))
	return not body.is_empty() and length <= int(view.get("maxChars", 280)) and _can_post() and poll_ready


func _update_composer() -> void:
	if not is_instance_valid(_draft):
		return
	var can_post := _can_post()
	var author := str(view.get("author", ""))
	var role := str(view.get("role", ""))
	var parts: PackedStringArray = []
	for part in [author, role]:
		if not str(part).is_empty():
			parts.append(str(part))
	_posting_as.text = ", ".join(parts)
	for child in _composer_avatar_slot.get_children():
		_composer_avatar_slot.remove_child(child)
		child.queue_free()
	_composer_avatar_slot.add_child(avatar(author, str(view.get("playerInitials", "")), str(view.get("playerFlag", "")), true, 2.4))
	_draft.editable = can_post
	_draft.placeholder_text = CANNOT_POST if not can_post else ("Ask the public a question" if _choices != null else "What would you like to tell the world?")
	var length := _draft.text.strip_edges().length()
	var most := int(view.get("maxChars", 280))
	_count.text = "%d/%d" % [length, most]
	_count.add_theme_color_override("font_color", WARN if length > most else INK_FAINT)
	var ready := _ready_to_post()
	_post_button.text = "Posting…" if _posting else "Post"
	_post_button.disabled = not ready or _posting
	_post_button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if ready and not _posting else Control.CURSOR_ARROW
	var look := UI.box(ACCENT if ready else ACCENT_SOFT, Color(0, 0, 0, 0), 999, 0, Vector4(17, 6, 17, 6))
	for state in ["normal", "focus", "disabled", "hover", "pressed", "hover_pressed"]:
		_post_button.add_theme_stylebox_override(state, look)
	var polling := _choices != null
	var toggle_look := UI.box(ACCENT_SOFT if polling else Color(0, 0, 0, 0), Color(0, 0, 0, 0), 999, 0)
	for state in ["normal", "focus", "disabled", "hover", "pressed", "hover_pressed"]:
		_poll_toggle.add_theme_stylebox_override(state, toggle_look)
	_poll_toggle.disabled = not can_post
	_poll_toggle.tooltip_text = "Remove the poll" if polling else "Add a poll"
	_poll_toggle.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if can_post else Control.CURSOR_ARROW
	for child in _poll_toggle.find_children("*", "TextureRect", true, false):
		(child as TextureRect).self_modulate = ACCENT if polling else INK_SOFT
	for child in _poll_toggle.find_children("*", "Label", true, false):
		(child as Label).add_theme_color_override("font_color", ACCENT if polling else INK_SOFT)
	_error_label.text = _error
	_error_label.visible = not _error.is_empty()
	_composer.visible = _composing
	_posted_note.visible = _posted and not _composing


func _on_draft_key(event: InputEvent) -> void:
	if not (event is InputEventKey) or _draft.has_ime_text():
		return
	var key := event as InputEventKey
	if not key.pressed or key.echo:
		return
	if (key.keycode == KEY_ENTER or key.keycode == KEY_KP_ENTER) and not key.shift_pressed and not DisplayServer.is_touchscreen_available() and not UI.phone():
		_draft.accept_event()
		_submit()


func _submit() -> void:
	if not _ready_to_post() or _posting or engine == null:
		return
	var body := _draft.text.strip_edges()
	var args := {"text": body, "quote": str(_quoting.get("id", ""))}
	if _choices != null:
		args["choices"] = _typed_choices()
	_posting = true
	_error = ""
	_update_composer()
	var reply: Dictionary = await engine.request("social.post", args)
	_posting = false
	var result: Dictionary = reply.get("result", {}) if reply.get("ok", false) and typeof(reply.get("result")) == TYPE_DICTIONARY else {"ok": false, "error": "The post could not be saved. Try again."}
	if not bool(result.get("ok", false)):
		_error = str(result.get("error", ""))
		_update_composer()
		return
	_draft.text = ""
	_quoting = {}
	_choices = null
	_composing = false
	_posted = true
	_render_quote()
	_render_choices()
	_style_pen()
	_update_composer()
	if tab != "all" and tab != "mine":
		await _set_tab("all")
	else:
		await _load_view(true)


class Hollow extends StyleBox:
	var fill := Color(0, 0, 0, 0)
	var corner := 999

	func _init(bg := Color(0, 0, 0, 0), radius := 999, margin := Vector4.ZERO) -> void:
		fill = bg
		corner = radius
		content_margin_left = margin.x
		content_margin_top = margin.y
		content_margin_right = margin.z
		content_margin_bottom = margin.w

	func _draw(to_canvas_item: RID, rect: Rect2) -> void:
		var lip := StyleBoxFlat.new()
		lip.draw_center = false
		lip.border_width_bottom = 1
		lip.border_color = Color(1, 1, 1, 0.35)
		lip.set_corner_radius_all(corner)
		lip.anti_aliasing = true
		lip.draw(to_canvas_item, Rect2(rect.position + Vector2(0, 1), rect.size))
		if fill.a > 0.0:
			var body := StyleBoxFlat.new()
			body.bg_color = fill
			body.set_corner_radius_all(corner)
			body.anti_aliasing = true
			body.draw(to_canvas_item, rect)
		var shade := StyleBoxFlat.new()
		shade.draw_center = false
		shade.border_width_top = 3
		shade.border_width_left = 1
		shade.border_width_right = 1
		shade.border_blend = true
		shade.bg_color = Color(0, 0, 0, 0)
		shade.border_color = Color(0, 0, 0, 0.35)
		shade.set_corner_radius_all(corner)
		shade.anti_aliasing = true
		shade.draw(to_canvas_item, rect)


class FlipBox extends Container:
	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		size_flags_vertical = Control.SIZE_SHRINK_CENTER

	func _get_minimum_size() -> Vector2:
		var least := Vector2.ZERO
		for child in get_children():
			if child is Control:
				least = least.max((child as Control).get_combined_minimum_size())
		return least

	func _notification(what: int) -> void:
		if what != NOTIFICATION_SORT_CHILDREN:
			return
		for child in get_children():
			if child is Control:
				var node := child as Control
				fit_child_in_rect(node, Rect2(Vector2.ZERO, size))
				node.pivot_offset = size * 0.5
				node.scale = Vector2(1, -1)


class ShareBar extends PanelContainer:
	var share := 0.0
	var fill := Color(1, 1, 1, 0.1)

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.05), Color(0, 0, 0, 0), 8, 0))

	func _draw() -> void:
		var width := size.x * clampf(share, 0.0, 100.0) / 100.0
		if width <= 0.0:
			return
		var bar := StyleBoxFlat.new()
		bar.bg_color = fill
		bar.corner_radius_top_left = 8
		bar.corner_radius_bottom_left = 8
		bar.corner_radius_top_right = 8 if width >= size.x - 0.5 else 0
		bar.corner_radius_bottom_right = 8 if width >= size.x - 0.5 else 0
		bar.anti_aliasing = true
		draw_style_box(bar, Rect2(Vector2.ZERO, Vector2(width, size.y)))


class FitRow extends Container:
	var gap := 6.0

	func _init(spacing := 6.0) -> void:
		gap = spacing
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		size_flags_horizontal = Control.SIZE_EXPAND_FILL

	func _items() -> Array[Control]:
		var out: Array[Control] = []
		for child in get_children():
			if child is Control and (child as Control).visible and not (child as Control).top_level:
				out.append(child as Control)
		return out

	func _get_minimum_size() -> Vector2:
		var items := _items()
		var width := gap * maxf(0.0, float(items.size() - 1))
		var height := 0.0
		for child in items:
			var least := child.get_combined_minimum_size()
			width += float(child.get_meta("least", 0.0)) if child.has_meta("shrink") else (0.0 if child.has_meta("fill") else least.x)
			height = maxf(height, least.y)
		return Vector2(width, height)

	func _notification(what: int) -> void:
		if what != NOTIFICATION_SORT_CHILDREN:
			return
		var items := _items()
		var widths: Array[float] = []
		var total := gap * maxf(0.0, float(items.size() - 1))
		var weight := 0.0
		var fills := 0
		for child in items:
			var width: float = float(child.get_meta("basis", child.get_combined_minimum_size().x))
			if child.has_meta("fill"):
				width = 0.0
				fills += 1
			widths.append(width)
			total += width
			if child.has_meta("shrink"):
				weight += float(child.get_meta("shrink")) * width
		var over := total - size.x
		if over > 0.0 and weight > 0.0:
			for index in range(items.size()):
				var child := items[index]
				if child.has_meta("shrink"):
					var cut := over * float(child.get_meta("shrink")) * widths[index] / weight
					widths[index] = maxf(float(child.get_meta("least", 0.0)), widths[index] - cut)
		elif over < 0.0 and fills > 0:
			for index in range(items.size()):
				if items[index].has_meta("fill"):
					widths[index] = -over / float(fills)
		var x := 0.0
		for index in range(items.size()):
			var child := items[index]
			var height := child.get_combined_minimum_size().y
			fit_child_in_rect(child, Rect2(x, roundf((size.y - height) * 0.5), widths[index], height))
			x += widths[index] + gap
