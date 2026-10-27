class_name ProjectsPanel
extends PanelFrame

signal open_advisor(text: String)
signal show_on_map(lng: float, lat: float, zoom: float)

const PANEL_WIDTH := 420.0
const SURFACE := Color(24 / 255.0, 24 / 255.0, 27 / 255.0, 0.95)
const SURFACE_BORDER := Color(1, 1, 1, 0.1)
const NATURAL_LEADING := 1.12
const TAG_COLUMN := 140.0
const TAG_GAP := 3.0
const BACKFILL_PROMPT := "Put my current projects and operations on the board — the sustained efforts, mine and any belonging to other powers that we know about. Start with the TEN most significant and stop there; I will ask for the next batch after. Keep each summary to one sentence, and give each only the milestones still ahead of it plus the single most recent one already achieved. Only include efforts that genuinely appear in our history — never invent one to round out the list — and say plainly if you are unsure about any of them."
const BRIEF_OWN := "Brief me in full on the %s \"{{name}}\". Where does it actually stand right now, what has moved since the last round, what does the next milestone need from me, and what is most likely to go wrong? Be specific and tell me if the board is out of date."
const BRIEF_FOREIGN_OWNER := "Brief me on {{owner}}'s %s \"{{name}}\". What do we actually know, how good is the sourcing, what has changed since we last looked, and what does it mean for us if it succeeds? Be honest about how much of this is inference rather than intelligence."
const BRIEF_FOREIGN := "Brief me on the foreign %s \"{{name}}\". What do we actually know, how good is the sourcing, what has changed since we last looked, and what does it mean for us if it succeeds? Be honest about how much of this is inference rather than intelligence."
const COUNTER_OWNER := "What can we actually do about {{owner}}'s \"{{name}}\"? Lay out the realistic options — diplomatic, economic, covert, or simply outpacing them — with what each would cost us and how it could go wrong. If we settle on one, open it as our own effort."
const COUNTER := "What can we actually do about this \"{{name}}\"? Lay out the realistic options — diplomatic, economic, covert, or simply outpacing them — with what each would cost us and how it could go wrong. If we settle on one, open it as our own effort."
const STATUS_TONES := {
	"proposed": ["Proposed", Color("#93c5fd"), Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.16)],
	"active": ["Active", Color("#4ade80"), Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.16)],
	"stalled": ["Stalled", Color("#fbbf24"), Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.18)],
	"paused": ["Paused", Color(1, 1, 1, 0.6), Color(1, 1, 1, 0.08)],
	"complete": ["Complete", Color("#67e8f9"), Color(6 / 255.0, 182 / 255.0, 212 / 255.0, 0.16)],
	"failed": ["Failed", Color("#f87171"), Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.18)],
	"cancelled": ["Cancelled", Color(1, 1, 1, 0.45), Color(1, 1, 1, 0.06)],
}
const VERIFICATION := {
	"doubted": ["Doubtful", Color("#fbbf24"), Color(251 / 255.0, 191 / 255.0, 36 / 255.0, 0.14), Color(251 / 255.0, 191 / 255.0, 36 / 255.0, 0.4), "Our analysts do not trust how we came by this. Put someone else in place to settle it."],
	"confirmed": ["Confirmed", Color("#86efac"), Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.14), Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.4), "A second source stands this up."],
	"refuted": ["Fabricated", Color("#fca5a5"), Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.14), Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.4), "A second source showed there was never anything here."],
}
const SECRECY := {"restricted": "🔒", "covert": "🕵"}
const PRIORITY_OPTIONS := [
	["▲", "high", "High priority — the advisor briefs it first and the simulation is told to keep it moving"],
	["●", "normal", "Normal priority"],
	["▼", "low", "Low priority — allowed to drift while more urgent work moves"],
]
const PRIORITY_PILL := {
	"high": ["High", Color("#fcd34d"), Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.16)],
	"low": ["Low", Color(1, 1, 1, 0.5), Color(1, 1, 1, 0.07)],
}
const ORANGE_INK := Color(253 / 255.0, 186 / 255.0, 116 / 255.0, 0.85)
const ZINC_INK := Color("#e4e4e7")
const AMBER_PILL := Color("#fcd34d")
const AMBER_PILL_BG := Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.16)
const GHOST_BG := Color(1, 1, 1, 0.06)
const GLYPHS := {
	"search": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2.2' stroke-linecap='round'><circle cx='11' cy='11' r='7'/><path d='M20 20l-3.5-3.5'/></svg>",
	"close": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2.4' stroke-linecap='round'><path d='M6 6l12 12M18 6L6 18'/></svg>",
	"chevron": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='3.2' stroke-linecap='round' stroke-linejoin='round'><path d='M5 9l7 7 7-7'/></svg>",
	"chevron_up": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='3.2' stroke-linecap='round' stroke-linejoin='round'><path d='M5 15l7-7 7 7'/></svg>",
	"tick": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='3.6' stroke-linecap='round' stroke-linejoin='round'><path d='M5 12.5l4.5 4.5L19 7.5'/></svg>",
}

static var _glyph_cache := {}
static var _italic_cache := {}
static var _flag_cache := {}

var engine: EngineLink
var context := {}
var _view := {}
var _last_json := ""
var _stamp := ""
var _stamp_key := ""
var _loaded := false
var _seq := 0
var _polling := false
var _query := ""
var _sort := "updated"
var _owner := "mine"
var _tags: Array = []
var _show_closed := false
var _expanded := ""
var _pending := ""
var _confirm_id := ""
var _confirm_button: Button
var _poll: Timer
var _count_label: Label
var _filters: PanelContainer
var _search: LineEdit
var _chips: HFlowContainer
var _tag_button: Button
var _banner: PanelContainer
var _banner_label: Label
var _cards: VBoxContainer
var _cards_scroll: ScrollContainer
var _menu: PanelContainer
var _menu_open := false
var _menu_ticked: Array = []
var _menu_needle := ""
var _menu_search: LineEdit
var _menu_scroll: ScrollContainer
var _menu_grid: GridContainer
var _menu_empty_pad: MarginContainer
var _menu_clear: Button
var _menu_rows: Array[Control] = []


func _init() -> void:
	super._init("Projects & Operations", "", "bottom", PANEL_WIDTH)
	set_tint(SURFACE)
	radius = 16.0
	border = SURFACE_BORDER
	_material.set_shader_parameter("radius", 16.0)
	_material.set_shader_parameter("border_color", SURFACE_BORDER)
	_material.set_shader_parameter("highlight", 0.06)
	_material.set_shader_parameter("blur_px", 8.0)
	_restyle_close()
	scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	var margin := scroll.get_child(0) as MarginContainer
	for side in ["margin_left", "margin_right", "margin_top", "margin_bottom"]:
		margin.add_theme_constant_override(side, 0)
	margin.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_theme_constant_override("separation", 0)
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var titles := header_title.get_parent()
	var title_row := HBoxContainer.new()
	title_row.add_theme_constant_override("separation", 6)
	titles.remove_child(header_title)
	title_row.add_child(header_title)
	_count_label = UI.label("", 12, Color(1, 1, 1, 0.35), 500)
	_count_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	title_row.add_child(_count_label)
	titles.add_child(title_row)
	titles.move_child(title_row, 0)
	_build_filters()
	body.add_child(_filters)
	_banner = PanelContainer.new()
	var banner_style := UI.box(Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.12), Color(0, 0, 0, 0), 0, 0, Vector4(16, 8, 16, 8))
	banner_style.border_color = Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.3)
	banner_style.border_width_bottom = 1
	_banner.add_theme_stylebox_override("panel", banner_style)
	_banner_label = UI.wrapped("", 11, Color(253 / 255.0, 230 / 255.0, 138 / 255.0, 0.95))
	_banner.add_child(_leading(_banner_label, 11, 1.45))
	_banner.visible = false
	body.add_child(_banner)
	_cards_scroll = ScrollContainer.new()
	_cards_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_cards_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_thin_scrollbar(_cards_scroll)
	var cards_margin := MarginContainer.new()
	cards_margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for side in [["margin_left", 16], ["margin_right", 16], ["margin_top", 12], ["margin_bottom", 16]]:
		cards_margin.add_theme_constant_override(side[0], side[1])
	_cards = VBoxContainer.new()
	_cards.add_theme_constant_override("separation", 9)
	_cards.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	cards_margin.add_child(_cards)
	_cards_scroll.add_child(cards_margin)
	body.add_child(_cards_scroll)
	_build_menu()
	(scroll.get_parent() as VBoxContainer).add_child(_menu)
	_poll = Timer.new()
	_poll.wait_time = 1.0
	_poll.timeout.connect(_on_poll)
	add_child(_poll)
	_render()


func _ready() -> void:
	get_viewport().size_changed.connect(func() -> void:
		if _open:
			offset_top = -BOTTOM_GAP - _height()
			offset_bottom = -BOTTOM_GAP
		if _menu_open:
			_place_menu.call_deferred())
	get_viewport().gui_focus_changed.connect(_on_focus_changed)


func setup(link: EngineLink, ctx: Dictionary = {}) -> void:
	engine = link
	context = ctx


func open() -> void:
	set_open(true)


func close() -> void:
	set_open(false)


func set_open(open: bool) -> void:
	var was := _open
	_open = open
	var height := _height()
	var tween := create_tween().set_parallel(true).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	tween.tween_property(self, "offset_top", -BOTTOM_GAP - height if open else 200.0, 0.35)
	tween.tween_property(self, "offset_bottom", -BOTTOM_GAP if open else 200.0 + height, 0.35)
	tween.tween_property(self, "modulate:a", 1.0 if open else 0.0, 0.35)
	mouse_filter = Control.MOUSE_FILTER_STOP if open else Control.MOUSE_FILTER_IGNORE
	if open and not was:
		_poll.start()
		_request_view(true)
	elif not open and was:
		_poll.stop()
		_expanded = ""
		_show_closed = false
		_owner = "mine"
		_confirm_id = ""
		_close_menu()
		_render()


func refresh() -> void:
	await _request_view(true)


func _restyle_close() -> void:
	var row := header_extra.get_parent()
	var close_button := row.get_child(header_extra.get_index() + 1) as Button
	if close_button == null:
		return
	close_button.flat = false
	close_button.icon = _glyph("close", 14, Color(1, 1, 1, 0.55))
	close_button.tooltip_text = ""
	var rest := UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 0, Vector4(3, 3, 3, 3))
	for state in ["normal", "focus", "disabled", "hover", "pressed", "hover_pressed"]:
		close_button.add_theme_stylebox_override(state, rest)


func _height() -> float:
	var viewport_height := get_viewport_rect().size.y if is_inside_tree() else 900.0
	return maxf(160.0, minf(viewport_height - 144.0, maxf(viewport_height - 256.0, 480.0)))


func _args(force := false, reload := false) -> Dictionary:
	return {"force": force, "reload": reload, "stamp": _stamp if reload and _stamp_key == _view_key() else "", "query": _query, "owner": _owner, "tags": _tags, "showClosed": _show_closed, "sort": _sort, "expanded": _expanded}


func _view_key() -> String:
	return JSON.stringify([_query, _owner, _tags, _show_closed, _sort, _expanded])


func _on_poll() -> void:
	if _polling or not _open:
		return
	_polling = true
	await _request_view(false, true)
	_polling = false


func _request_view(force := false, reload := false) -> void:
	if engine == null:
		return
	_seq += 1
	var mine := _seq
	var key := _view_key()
	var reply: Dictionary = await engine.request("projects.read", _args(force, reload))
	if mine != _seq:
		return
	if not reply.get("ok", false):
		if not _loaded and force:
			_loaded = true
			_render()
		return
	_apply(reply["result"])
	_stamp_key = key


func _apply(result: Variant) -> void:
	if typeof(result) != TYPE_DICTIONARY:
		return
	var data: Dictionary = result
	if data.get("unchanged", false):
		return
	_stamp = str(data.get("stamp", _stamp))
	var text := JSON.stringify(data)
	var first := not _loaded
	_loaded = true
	if text == _last_json and not first:
		return
	_last_json = text
	_view = data
	_owner = str(_view.get("owner", _owner))
	_show_closed = bool(_view.get("showClosed", _show_closed))
	_tags = (_view.get("activeTags", []) as Array).duplicate()
	if (_view.get("availableTags", []) as Array).is_empty():
		_close_menu()
	_render()


static func _clear(node: Node) -> void:
	for child in node.get_children():
		node.remove_child(child)
		child.queue_free()


static func _glyph(name: String, size: int, color: Color) -> Texture2D:
	var key := "%s:%d:%s" % [name, size, color.to_html()]
	if _glyph_cache.has(key):
		var cached: Texture2D = _glyph_cache[key]
		return cached
	var svg: String = GLYPHS.get(name, "")
	svg = svg.replace("#fff", "#" + color.to_html(false))
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
	_glyph_cache[key] = texture
	return texture


static func _italic(weight := 400) -> Font:
	if _italic_cache.has(weight):
		var cached: Font = _italic_cache[weight]
		return cached
	var system := SystemFont.new()
	system.font_names = PackedStringArray(["Arial", "Segoe UI", "Helvetica", "Liberation Sans", "Segoe UI Emoji", "Segoe UI Symbol", "sans-serif"])
	system.font_weight = weight
	system.font_italic = true
	system.antialiasing = TextServer.FONT_ANTIALIASING_GRAY
	system.hinting = TextServer.HINTING_LIGHT
	_italic_cache[weight] = system
	return system


static func _flag_texture(path: String) -> Texture2D:
	if path.is_empty():
		return null
	if _flag_cache.has(path):
		var cached: Texture2D = _flag_cache[path]
		return cached
	var texture: Texture2D = null
	if path.to_lower().ends_with(".svg"):
		texture = UI.flag(path, 28)
	else:
		texture = ImageLoader.texture_from_file(path)
	_flag_cache[path] = texture
	return texture


static func _style(bg: Color, border_color: Color, corner: int, margin: Vector4) -> StyleBoxFlat:
	return UI.box(bg, border_color, corner, 1, margin)


static func _styled_button(text: String, size: int, weight: int, ink: Color, normal: StyleBoxFlat, hover: StyleBoxFlat = null) -> Button:
	var button := Button.new()
	button.text = text
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var lit: StyleBoxFlat = hover if hover != null else normal
	for state in [["normal", normal], ["focus", normal], ["disabled", normal], ["hover", lit], ["pressed", lit], ["hover_pressed", lit]]:
		button.add_theme_stylebox_override(state[0], state[1])
	button.add_theme_font_override("font", UI.font(weight))
	button.add_theme_font_size_override("font_size", size)
	for slot in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color", "font_disabled_color"]:
		button.add_theme_color_override(slot, ink)
	return button


static func _ghost(text: String, hover_bg := GHOST_BG) -> Button:
	var pad := Vector4(10, 5, 10, 5)
	var button := _styled_button(text, 11, 600, Color(1, 1, 1, 0.85), _style(GHOST_BG, Color(1, 1, 1, 0.12), 8, pad), _style(hover_bg, Color(1, 1, 1, 0.12), 8, pad))
	button.custom_minimum_size.y = 26
	return button


static func _pill(text: String, ink: Color, bg: Color, tooltip := "") -> PanelContainer:
	var holder := PanelContainer.new()
	holder.add_theme_stylebox_override("panel", UI.box(bg, Color(0, 0, 0, 0), 999, 0, Vector4(7, 2, 7, 3)))
	holder.tooltip_text = tooltip
	holder.mouse_filter = Control.MOUSE_FILTER_PASS if not tooltip.is_empty() else Control.MOUSE_FILTER_IGNORE
	holder.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	holder.add_child(UI.label(text.to_upper(), 10, ink, 700, "Arial", 1))
	return holder


static func _thin_scrollbar(target: ScrollContainer) -> void:
	var bar := target.get_v_scroll_bar()
	bar.add_theme_stylebox_override("scroll", StyleBoxEmpty.new())
	bar.add_theme_stylebox_override("scroll_focus", StyleBoxEmpty.new())
	for state in ["grabber", "grabber_highlight", "grabber_pressed"]:
		bar.add_theme_stylebox_override(state, UI.box(Color(1, 1, 1, 0.22), Color(0, 0, 0, 0), 3, 0, Vector4(3, 0, 3, 0)))
	bar.custom_minimum_size.x = 6


static func _leading(label: Label, size: int, line_height: float) -> Control:
	var extra := maxf(0.0, float(size) * (line_height - NATURAL_LEADING))
	label.add_theme_constant_override("line_spacing", int(round(extra)))
	var holder := MarginContainer.new()
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.add_theme_constant_override("margin_top", int(round(extra * 0.5)))
	holder.add_theme_constant_override("margin_bottom", int(round(extra * 0.5)))
	holder.add_child(label)
	return holder


static func _fill(template: String, values: Dictionary) -> String:
	var text := template
	for key in values:
		text = text.replace("{{%s}}" % key, str(values[key]))
	return text


static func _step_tag_focus(key: String, index: int, count: int, columns: int) -> int:
	if count <= 0 or index < 0 or index >= count:
		return -1
	var per_row := maxi(1, columns)
	var last := count - 1
	match key:
		"ArrowRight":
			return mini(index + 1, last)
		"ArrowLeft":
			return maxi(index - 1, 0)
		"ArrowDown":
			return mini(index + per_row, last) if int(index / per_row) < int(last / per_row) else index
		"ArrowUp":
			return index - per_row if index >= per_row else index
		"Home":
			return 0
		"End":
			return last
	return -1


func _advisor_button(button: Button, text: String) -> Button:
	button.pressed.connect(func() -> void: open_advisor.emit(text))
	return button


func _build_filters() -> void:
	_filters = PanelContainer.new()
	var style := UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 0, Vector4(16, 10, 16, 11))
	style.border_color = Color(1, 1, 1, 0.07)
	style.border_width_bottom = 1
	_filters.add_theme_stylebox_override("panel", style)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 8)
	var holder := Control.new()
	holder.custom_minimum_size.y = 29
	_search = LineEdit.new()
	_search.placeholder_text = "Search projects…"
	_search.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var field := _style(Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.12), 9, Vector4(27, 0, 8, 0))
	_search.add_theme_stylebox_override("normal", field)
	_search.add_theme_stylebox_override("focus", field)
	_search.add_theme_font_override("font", UI.font(400))
	_search.add_theme_font_size_override("font_size", 12)
	_search.add_theme_color_override("font_color", UI.WHITE)
	_search.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.4))
	_search.add_theme_color_override("caret_color", UI.WHITE)
	_search.text_changed.connect(func(text: String) -> void:
		_query = text
		_request_view())
	holder.add_child(_search)
	var icon := TextureRect.new()
	icon.texture = _glyph("search", 13, Color(1, 1, 1, 0.35))
	icon.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
	icon.mouse_filter = Control.MOUSE_FILTER_IGNORE
	icon.anchor_top = 0.0
	icon.anchor_bottom = 1.0
	icon.offset_left = 8
	icon.offset_right = 22
	holder.add_child(icon)
	column.add_child(holder)
	_chips = HFlowContainer.new()
	_chips.add_theme_constant_override("h_separation", 6)
	_chips.add_theme_constant_override("v_separation", 6)
	column.add_child(_chips)
	_filters.add_child(column)


func _chip(text: String, active: bool, tooltip: String, action: Callable) -> Button:
	var pad := Vector4(9, 3, 9, 3)
	var normal := _style(Color(0, 0, 0, 0.39) if active else Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.28) if active else Color(1, 1, 1, 0.1), 999, pad)
	var button := _styled_button(text, 11, 600, Color("#f4f4f5") if active else Color(1, 1, 1, 0.6), normal, normal)
	button.custom_minimum_size.y = 24
	button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	button.tooltip_text = tooltip
	button.pressed.connect(action)
	return button


func _render_chips() -> void:
	_clear(_chips)
	_tag_button = null
	var total := int(_view.get("total", 0))
	var mine_count := int(_view.get("mineCount", 0))
	var foreign_count := int(_view.get("foreignCount", 0))
	var closed_count := int(_view.get("closedCount", 0))
	var open_count := int(_view.get("openCount", 0))
	var sort := OptionButton.new()
	sort.focus_mode = Control.FOCUS_NONE
	sort.custom_minimum_size.y = 24
	sort.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	sort.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var select_style := _style(Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.12), 8, Vector4(6, 3, 6, 3))
	for state in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
		sort.add_theme_stylebox_override(state, select_style)
	sort.add_theme_font_override("font", UI.font(400))
	sort.add_theme_font_size_override("font_size", 12)
	for slot in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		sort.add_theme_color_override(slot, UI.WHITE)
	var popup := sort.get_popup()
	popup.add_theme_stylebox_override("panel", UI.box(Color("#18181b"), Color(1, 1, 1, 0.12), 8, 1, Vector4(4, 4, 4, 4)))
	popup.add_theme_font_override("font", UI.font(400))
	popup.add_theme_font_size_override("font_size", 12)
	var sorts: Array = _view.get("sorts", [])
	for entry in sorts:
		var option: Dictionary = entry
		sort.add_item(str(option.get("label", "")))
		sort.set_item_metadata(sort.item_count - 1, str(option.get("key", "")))
		if str(option.get("key", "")) == _sort:
			sort.select(sort.item_count - 1)
	sort.item_selected.connect(func(index: int) -> void:
		_sort = str(sort.get_item_metadata(index))
		_request_view())
	_chips.add_child(sort)
	_chips.add_child(_chip("All", _owner == "all", "Everything on the board (%d)" % total, func() -> void: _set_owner("all")))
	_chips.add_child(_chip("Mine (%d)" % mine_count if mine_count > 0 else "Mine", _owner == "mine", "Your own projects and operations — the ones you can set a priority on or call off", func() -> void: _set_owner("mine")))
	if foreign_count > 0:
		_chips.add_child(_chip("Foreign (%d)" % foreign_count, _owner == "foreign", "Other powers' efforts your services have learned of. You track these; you do not run them.", func() -> void: _set_owner("foreign")))
	if closed_count > 0:
		var closed_tip := "Showing closed entries only — switch back to the %d still running" % open_count if _show_closed else "Show the %d completed, failed or cancelled entries instead" % closed_count
		_chips.add_child(_chip("← Running (%d)" % open_count if _show_closed else "Closed (%d)" % closed_count, _show_closed, closed_tip, func() -> void:
			_show_closed = not _show_closed
			_request_view()))
	if not (_view.get("availableTags", []) as Array).is_empty():
		_chips.add_child(_tags_chip())


func _tags_chip() -> Button:
	var lit := _menu_open or not _tags.is_empty()
	var pad := Vector4(9, 3, 9, 3)
	var normal := _style(Color(0, 0, 0, 0.39) if lit else Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.28) if lit else Color(1, 1, 1, 0.1), 999, pad)
	var ink := Color("#f4f4f5") if lit else Color(1, 1, 1, 0.6)
	var button := _styled_button("", 11, 600, ink, normal, normal)
	button.focus_mode = Control.FOCUS_ALL
	button.tooltip_text = "Show only the entries that carry any of the tags you tick"
	button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var content := HBoxContainer.new()
	content.add_theme_constant_override("separation", 5)
	content.alignment = BoxContainer.ALIGNMENT_CENTER
	content.mouse_filter = Control.MOUSE_FILTER_IGNORE
	content.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var caption := UI.label("Tags", 11, ink, 600)
	caption.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	content.add_child(caption)
	var width := UI.font(600).get_string_size("Tags", HORIZONTAL_ALIGNMENT_LEFT, -1, 11).x
	if not _tags.is_empty():
		var badge := PanelContainer.new()
		badge.add_theme_stylebox_override("panel", UI.box(Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.14), Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.38), 7, 1, Vector4(4, 0, 4, 1)))
		badge.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		badge.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var count := UI.label(str(_tags.size()), 10, UI.ACCENT, 800)
		count.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		count.custom_minimum_size.x = 8
		badge.add_child(count)
		content.add_child(badge)
		width += 22
	var chevron := TextureRect.new()
	chevron.texture = _glyph("chevron_up" if _menu_open else "chevron", 9, ink)
	chevron.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
	chevron.custom_minimum_size = Vector2(9, 9)
	chevron.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	chevron.mouse_filter = Control.MOUSE_FILTER_IGNORE
	content.add_child(chevron)
	button.add_child(content)
	button.custom_minimum_size = Vector2(width + 14 + 18 + 5, 24)
	button.pressed.connect(func() -> void:
		if _menu_open:
			_close_menu()
			_render_chips()
		else:
			_open_menu())
	_tag_button = button
	return button


func _set_owner(owner: String) -> void:
	_owner = owner
	_request_view()


func _render() -> void:
	var total := int(_view.get("total", 0))
	var visible_count := int(_view.get("visibleCount", 0))
	_count_label.text = ("" if total == 0 else (str(total) if visible_count == total else "%d / %d" % [visible_count, total]))
	_count_label.visible = total > 0
	var empty_board := _loaded and total == 0
	_filters.visible = not empty_board
	if not empty_board:
		_render_chips()
	var limit := int(_view.get("limit", 0))
	_banner.visible = limit > 0 and total >= limit - 10
	if _banner.visible:
		_banner_label.text = "The board is full (%d). Completed and cancelled entries are dropped first to make room — ask your advisor to close anything finished." % limit if total >= limit else "%d slots left before the board starts dropping its oldest closed entries." % (limit - total)
	_render_cards()
	if _menu_open:
		_place_menu.call_deferred()


func _render_cards() -> void:
	var offset := _cards_scroll.scroll_vertical
	_clear(_cards)
	_confirm_button = null
	var total := int(_view.get("total", 0))
	var cards: Array = _view.get("cards", [])
	if not _loaded:
		var loading := UI.label("Loading…", 12, Color(1, 1, 1, 0.35))
		loading.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		var pad := MarginContainer.new()
		pad.add_theme_constant_override("margin_top", 16)
		pad.add_theme_constant_override("margin_bottom", 16)
		pad.add_child(loading)
		_cards.add_child(pad)
		return
	if total == 0:
		_cards.add_child(_empty_board())
		return
	if cards.is_empty():
		_cards.add_child(_no_match())
	for entry in cards:
		_cards.add_child(_card(entry))
	if not cards.is_empty():
		var pad := Vector4(7, 7, 7, 7)
		var review := _styled_button("🧭 Ask the advisor to review or extend the board", 11, 600, Color(1, 1, 1, 0.85), _style(GHOST_BG, Color(1, 1, 1, 0.12), 8, pad), _style(Color(1, 1, 1, 0.07), Color(1, 1, 1, 0.12), 8, pad))
		var holder := MarginContainer.new()
		holder.add_theme_constant_override("margin_top", 3)
		holder.add_child(_advisor_button(review, BACKFILL_PROMPT))
		_cards.add_child(holder)
	if offset > 0:
		_keep_scroll(offset)


func _keep_scroll(offset: int) -> void:
	await get_tree().process_frame
	await get_tree().process_frame
	_cards_scroll.scroll_vertical = offset


func _dashed_box(border_alpha: float, corner: float, pad: Vector4) -> PanelContainer:
	var box := ProjectsDashedPanel.new()
	box.ink = Color(1, 1, 1, border_alpha)
	box.corner = corner
	box.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), int(corner), 0, pad))
	return box


func _empty_board() -> Control:
	var box := _dashed_box(0.15, 12.0, Vector4(16, 18, 16, 18))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	var glyph := UI.label("🗂", 24, UI.WHITE)
	glyph.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	column.add_child(glyph)
	var spacer := Control.new()
	spacer.custom_minimum_size.y = 6
	column.add_child(spacer)
	var title := UI.label("Nothing on the board yet", 13, Color(1, 1, 1, 0.75), 600)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	column.add_child(title)
	var gap := Control.new()
	gap.custom_minimum_size.y = 6
	column.add_child(gap)
	var text := UI.wrapped("Projects and operations are opened by your advisor and by what happens in the world — you don't add them by hand. If you already have efforts under way, ask your advisor to put them on the board.", 12, Color(1, 1, 1, 0.45))
	text.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	column.add_child(_leading(text, 12, 1.5))
	var gap2 := Control.new()
	gap2.custom_minimum_size.y = 14
	column.add_child(gap2)
	var pad := Vector4(13, 7, 13, 7)
	var look := _style(Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.25), 10, pad)
	var button := _styled_button("🧭 Ask your advisor to populate this", 12, 600, UI.WHITE, look, look)
	button.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	column.add_child(_advisor_button(button, BACKFILL_PROMPT))
	box.add_child(column)
	return box


func _no_match() -> Control:
	var box := _dashed_box(0.14, 10.0, Vector4(14, 14, 14, 14))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 6)
	var line := UI.wrapped("No closed entries match those filters." if _show_closed else "Nothing matches those filters.", 12, Color(1, 1, 1, 0.4))
	line.add_theme_font_override("font", _italic(400))
	line.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	column.add_child(line)
	var foreign_count := int(_view.get("foreignCount", 0))
	if not _show_closed and _owner == "mine" and foreign_count > 0:
		var row := HBoxContainer.new()
		row.alignment = BoxContainer.ALIGNMENT_CENTER
		row.add_theme_constant_override("separation", 0)
		row.add_child(UI.label(("One entry belongs" if foreign_count == 1 else "%d entries belong" % foreign_count) + " to another power — ", 12, Color(1, 1, 1, 0.4)))
		var link := LinkButton.new()
		link.text = "show Foreign"
		link.underline = LinkButton.UNDERLINE_MODE_ALWAYS
		link.focus_mode = Control.FOCUS_NONE
		link.add_theme_font_override("font", UI.font(400))
		link.add_theme_font_size_override("font_size", 12)
		for slot in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
			link.add_theme_color_override(slot, ZINC_INK)
		link.pressed.connect(func() -> void: _set_owner("foreign"))
		row.add_child(link)
		row.add_child(UI.label(".", 12, Color(1, 1, 1, 0.4)))
		column.add_child(row)
	box.add_child(column)
	return box


func _status_tone(status: String) -> Array:
	var tone: Array = STATUS_TONES.get(status, STATUS_TONES["active"])
	return tone


func _progress_color(card: Dictionary) -> Color:
	var status := str(card.get("status", ""))
	var flags: Dictionary = card.get("flags", {})
	if status == "complete":
		return Color("#22d3ee")
	if status == "failed" or status == "cancelled":
		return Color(1, 1, 1, 0.25)
	if bool(flags.get("overdue", false)):
		return Color("#ef4444")
	if bool(flags.get("stale", false)) or bool(flags.get("milestoneMissed", false)):
		return Color("#f59e0b")
	return Color("#22c55e")


func _initials(owner: String) -> String:
	var letters := ""
	for character in owner:
		var code := character.unicode_at(0)
		if (code >= 65 and code <= 90) or (code >= 97 and code <= 122):
			letters += character
		if letters.length() >= 2:
			break
	return letters.to_upper() if not letters.is_empty() else "??"


func _escape(text: String) -> String:
	return text.replace("[", "[lb]")


func _card(card: Dictionary) -> Control:
	var id := str(card.get("id", ""))
	var title_text := str(card.get("name", ""))
	var kind := str(card.get("kind", "project"))
	var mine := bool(card.get("mine", true))
	var running := bool(card.get("open", true))
	var busy := _pending == id
	var flags: Dictionary = card.get("flags", {})
	var owner_label := str(card.get("ownerLabel", ""))
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", _style(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.08), 12, Vector4(13, 11, 13, 11)))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	var top := HBoxContainer.new()
	top.add_theme_constant_override("separation", 6)
	var kind_glyph := UI.label("⚔" if kind == "operation" else "🔬", 13, UI.WHITE)
	kind_glyph.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	top.add_child(kind_glyph)
	var title := UI.wrapped(title_text, 14, UI.WHITE, 700)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(title)
	var secrecy := str(card.get("secrecy", ""))
	if SECRECY.has(secrecy):
		var glyph := UI.label(str(SECRECY[secrecy]), 13, UI.WHITE)
		glyph.tooltip_text = secrecy
		glyph.mouse_filter = Control.MOUSE_FILTER_PASS
		glyph.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
		top.add_child(glyph)
	var verification := str(card.get("verification", ""))
	if VERIFICATION.has(verification):
		var badge_spec: Array = VERIFICATION[verification]
		var badge := PanelContainer.new()
		badge.add_theme_stylebox_override("panel", UI.box(badge_spec[2], badge_spec[3], 999, 1, Vector4(6, 1, 6, 2)))
		badge.tooltip_text = str(badge_spec[4])
		badge.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
		badge.add_child(UI.label(str(badge_spec[0]).to_upper(), 10, badge_spec[1], 700, "Arial", 1))
		top.add_child(badge)
	var pills := HBoxContainer.new()
	pills.add_theme_constant_override("separation", 4)
	pills.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	var priority := str(card.get("priority", "normal"))
	if mine and PRIORITY_PILL.has(priority):
		var spec: Array = PRIORITY_PILL[priority]
		pills.add_child(_pill(str(spec[0]), spec[1], spec[2], "Priority the player set for this effort"))
	if bool(flags.get("ongoing", false)):
		pills.add_child(_pill("Ongoing", Color(1, 1, 1, 0.55), Color(1, 1, 1, 0.08), "A standing effort with no planned end"))
	var tone := _status_tone(str(card.get("status", "")))
	pills.add_child(_pill(str(tone[0]), tone[1], tone[2]))
	top.add_child(pills)
	column.add_child(top)
	if not str(card.get("ownerKey", "")).is_empty():
		column.add_child(_spaced(_owner_badge(card), 4))
	var summary := str(card.get("summary", ""))
	if not summary.is_empty():
		column.add_child(_spaced(_leading(UI.wrapped(summary, 12, Color(1, 1, 1, 0.72)), 12, 1.45), 6))
	var tags: Array = card.get("tags", [])
	if not tags.is_empty():
		var tag_row := HFlowContainer.new()
		tag_row.add_theme_constant_override("h_separation", 4)
		tag_row.add_theme_constant_override("v_separation", 4)
		for tag in tags:
			var chip := PanelContainer.new()
			chip.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.06), Color(0, 0, 0, 0), 999, 0, Vector4(6, 1, 6, 2)))
			chip.mouse_filter = Control.MOUSE_FILTER_IGNORE
			chip.add_child(UI.label(str(tag), 10, Color(1, 1, 1, 0.5)))
			tag_row.add_child(chip)
		column.add_child(_spaced(tag_row, 7))
	var timing := VBoxContainer.new()
	timing.add_theme_constant_override("separation", 4)
	var timing_row := HBoxContainer.new()
	var timeline := UI.label(str(card.get("timeline", "")), 10, Color(1, 1, 1, 0.45))
	timeline.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	timeline.clip_text = true
	timing_row.add_child(timeline)
	timing_row.add_child(UI.label("%d%%" % int(card.get("progress", 0)), 10, Color(1, 1, 1, 0.45)))
	timing.add_child(timing_row)
	var bar := ProjectsProgressLine.new()
	bar.value = float(card.get("progress", 0))
	bar.fill = _progress_color(card)
	timing.add_child(bar)
	column.add_child(_spaced(timing, 9))
	var next: Variant = card.get("nextMilestone")
	if typeof(next) == TYPE_DICTIONARY:
		var milestone: Dictionary = next
		var repeat := str(milestone.get("repeat", ""))
		var line := RichTextLabel.new()
		line.bbcode_enabled = true
		line.fit_content = true
		line.scroll_active = false
		line.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		line.mouse_filter = Control.MOUSE_FILTER_IGNORE
		line.add_theme_font_override("normal_font", UI.font(400))
		line.add_theme_font_size_override("normal_font_size", 11)
		line.add_theme_color_override("default_color", Color(1, 1, 1, 0.6))
		var text := "%s Next: %s" % ["↻" if not repeat.is_empty() else "▸", _escape(str(milestone.get("title", "")))]
		var date := str(milestone.get("date", ""))
		if not date.is_empty():
			text += " — %s" % _escape(date)
		if not repeat.is_empty():
			var done := int(milestone.get("completedCount", 0))
			text += "[color=#ffffff59] (%s%s)[/color]" % [_escape(repeat), ", done %d×" % done if done > 0 else ""]
		line.text = text
		column.add_child(_spaced(line, 7))
	var last_update := str(card.get("lastUpdate", ""))
	if not last_update.is_empty():
		var update := UI.wrapped(last_update, 11, Color(1, 1, 1, 0.5))
		update.add_theme_font_override("font", _italic(400))
		column.add_child(_spaced(update, 6))
	if bool(flags.get("overdue", false)) or bool(flags.get("dueSoon", false)) or bool(flags.get("milestoneMissed", false)) or bool(flags.get("stale", false)):
		var warnings := HFlowContainer.new()
		warnings.add_theme_constant_override("h_separation", 5)
		warnings.add_theme_constant_override("v_separation", 5)
		if bool(flags.get("overdue", false)):
			warnings.add_child(_pill("⚠ Overdue", Color("#fca5a5"), Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.18), "Target date passed %d days ago" % absi(int(flags.get("daysToTarget", 0)))))
		if bool(flags.get("dueSoon", false)):
			warnings.add_child(_pill("⏳ Due in %dd" % int(flags.get("daysToMilestone", 0)), AMBER_PILL, AMBER_PILL_BG, "A milestone falls inside the next month"))
		if bool(flags.get("milestoneMissed", false)) and not bool(flags.get("overdue", false)):
			warnings.add_child(_pill("Milestone slipped", AMBER_PILL, AMBER_PILL_BG, "A milestone's date passed while it was still pending"))
		if bool(flags.get("stale", false)):
			warnings.add_child(_pill("No recent progress" if mine else "No fresh intelligence", Color(1, 1, 1, 0.55), Color(1, 1, 1, 0.07), "No progress reported for several rounds" if mine else "Nothing has reached us about this for several rounds"))
		column.add_child(_spaced(warnings, 8))
	var actions := HFlowContainer.new()
	actions.add_theme_constant_override("h_separation", 6)
	actions.add_theme_constant_override("v_separation", 6)
	var brief := _brief_prompt(kind, title_text) if mine else _foreign_prompt(kind, title_text, owner_label)
	actions.add_child(_advisor_button(_ghost("🧭 Ask advisor" if mine else "🧭 What do we know?", Color(1, 1, 1, 0.09)), brief))
	if not mine and running:
		actions.add_child(_advisor_button(_ghost("⚖ Our options", Color(249 / 255.0, 115 / 255.0, 22 / 255.0, 0.25)), _fill(COUNTER_OWNER if not owner_label.is_empty() else COUNTER, {"name": title_text, "owner": owner_label})))
	if bool(card.get("hasFocus", false)):
		var locate := _ghost("📍 Show on map", Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.25))
		locate.pressed.connect(func() -> void: _locate(id))
		actions.add_child(locate)
	var event_count := int(card.get("eventCount", 0))
	if event_count > 0:
		var expanded := bool(card.get("expanded", false))
		var activity := _ghost("%s Activity (%d)" % ["▾" if expanded else "▸", event_count], Color(1, 1, 1, 0.12))
		activity.pressed.connect(func() -> void:
			_expanded = "" if _expanded == id else id
			_request_view())
		actions.add_child(activity)
	column.add_child(_spaced(actions, 10))
	if not mine and running:
		var note := UI.wrapped("%s — you can watch it and act against it, but its priority and its cancellation are not yours to set." % ("%s runs this" % owner_label if not owner_label.is_empty() else "Another power runs this"), 11, Color(1, 1, 1, 0.38))
		column.add_child(_ruled(_leading(note, 11, 1.45)))
	if running and mine:
		var levers := HBoxContainer.new()
		levers.add_theme_constant_override("separation", 6)
		var switch := HBoxContainer.new()
		switch.add_theme_constant_override("separation", 2)
		for option in PRIORITY_OPTIONS:
			var key := str(option[1])
			var active := priority == key
			var pad := Vector4(7, 4, 7, 4)
			var look := _style(Color(0, 0, 0, 0.39) if active else GHOST_BG, Color(1, 1, 1, 0.28) if active else Color(1, 1, 1, 0.12), 8, pad)
			var segment := _styled_button(str(option[0]), 11, 600, Color("#f4f4f5") if active else Color(1, 1, 1, 0.5), look, look)
			segment.custom_minimum_size = Vector2(26, 26)
			segment.tooltip_text = str(option[2])
			segment.disabled = busy
			if busy:
				segment.modulate.a = 0.5
				segment.mouse_default_cursor_shape = Control.CURSOR_ARROW
			segment.pressed.connect(func() -> void: _set_priority(id, priority, key))
			switch.add_child(segment)
		levers.add_child(switch)
		levers.add_child(UI.spacer())
		var abandon := _ghost("Abandon")
		abandon.tooltip_text = "Close this out. It stays on the board under Closed, keeping the progress it reached."
		_style_abandon(abandon, _confirm_id == id)
		abandon.disabled = busy
		if busy:
			abandon.modulate.a = 0.5
			abandon.mouse_default_cursor_shape = Control.CURSOR_ARROW
		abandon.pressed.connect(func() -> void: _press_abandon(id, abandon))
		if _confirm_id == id:
			_confirm_button = abandon
		levers.add_child(abandon)
		column.add_child(_ruled(levers))
	if bool(card.get("expanded", false)):
		var feed := VBoxContainer.new()
		feed.add_theme_constant_override("separation", 4)
		var activity_rows: Array = card.get("activity", [])
		if activity_rows.is_empty():
			var gone := UI.wrapped("The events behind this are no longer in the log.", 11, Color(1, 1, 1, 0.35))
			gone.add_theme_font_override("font", _italic(400))
			feed.add_child(gone)
		for row_entry in activity_rows:
			var item: Dictionary = row_entry
			var row := HBoxContainer.new()
			row.add_theme_constant_override("separation", 8)
			var item_date := str(item.get("date", ""))
			var date_label := UI.label(item_date if not item_date.is_empty() else "—", 11, Color(1, 1, 1, 0.35))
			date_label.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
			row.add_child(date_label)
			var item_title := UI.wrapped(str(item.get("title", "")), 11, Color(1, 1, 1, 0.65))
			item_title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			row.add_child(item_title)
			feed.add_child(row)
		column.add_child(_ruled(feed, 8))
	panel.add_child(column)
	return panel


func _spaced(control: Control, top: int) -> Control:
	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_top", top)
	margin.add_child(control)
	return margin


func _ruled(control: Control, inner := 9) -> Control:
	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_top", 10)
	var holder := PanelContainer.new()
	var style := UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 0, Vector4(0, inner, 0, 0))
	style.border_color = Color(1, 1, 1, 0.07)
	style.border_width_top = 1
	holder.add_theme_stylebox_override("panel", style)
	holder.add_child(control)
	margin.add_child(holder)
	return margin


func _owner_badge(card: Dictionary) -> Control:
	var mine := bool(card.get("mine", true))
	var label := str(card.get("ownerLabel", ""))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	var frame := PanelContainer.new()
	frame.add_theme_stylebox_override("panel", UI.box(Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.16), Color(1, 1, 1, 0.12), 3, 1))
	frame.custom_minimum_size = Vector2(21, 14)
	frame.clip_contents = true
	frame.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	frame.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var texture := _flag_texture(str(card.get("flag", "")))
	if texture:
		var image := TextureRect.new()
		image.texture = texture
		image.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		image.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
		image.custom_minimum_size = Vector2(21, 14)
		image.mouse_filter = Control.MOUSE_FILTER_IGNORE
		frame.add_child(image)
	else:
		var initials := UI.label(_initials(label), 8, Color("#93c5fd"), 800)
		initials.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		initials.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		frame.add_child(initials)
	row.add_child(frame)
	var owner_name := UI.label(label, 11, Color(1, 1, 1, 0.55) if mine else ORANGE_INK)
	if UI.font(400).get_string_size(label, HORIZONTAL_ALIGNMENT_LEFT, -1, 11).x > 240.0:
		owner_name.clip_text = true
		owner_name.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		owner_name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	owner_name.tooltip_text = label
	owner_name.mouse_filter = Control.MOUSE_FILTER_PASS
	owner_name.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(owner_name)
	if not mine:
		row.add_child(_pill("Foreign", Color(253 / 255.0, 186 / 255.0, 116 / 255.0, 0.9), Color(249 / 255.0, 115 / 255.0, 22 / 255.0, 0.16), "Another power's effort. You are tracking it, not running it."))
	return row


func _brief_prompt(kind: String, name_text: String) -> String:
	return _fill(BRIEF_OWN % ("operation" if kind == "operation" else "project"), {"name": name_text})


func _foreign_prompt(kind: String, name_text: String, owner: String) -> String:
	var noun := "operation" if kind == "operation" else "programme"
	return _fill((BRIEF_FOREIGN_OWNER if not owner.is_empty() else BRIEF_FOREIGN) % noun, {"name": name_text, "owner": owner})


func _style_abandon(button: Button, confirming: bool) -> void:
	var pad := Vector4(10, 5, 10, 5)
	var look := _style(Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.25) if confirming else GHOST_BG, Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.6) if confirming else Color(1, 1, 1, 0.12), 8, pad)
	for state in ["normal", "focus", "disabled", "hover", "pressed", "hover_pressed"]:
		button.add_theme_stylebox_override(state, look)
	var ink := Color("#fca5a5") if confirming else Color(1, 1, 1, 0.55)
	for slot in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color", "font_disabled_color"]:
		button.add_theme_color_override(slot, ink)
	button.text = "Confirm abandon?" if confirming else "Abandon"


func _press_abandon(id: String, button: Button) -> void:
	if _confirm_id != id:
		if is_instance_valid(_confirm_button):
			_style_abandon(_confirm_button, false)
		_confirm_id = id
		_confirm_button = button
		_style_abandon(button, true)
		return
	_confirm_id = ""
	_confirm_button = null
	_run_op(id, "abandon", "")


func _set_priority(id: String, current: String, priority: String) -> void:
	if current == priority:
		return
	_run_op(id, "priority", priority)


func _run_op(id: String, op: String, priority: String) -> void:
	if engine == null:
		return
	_pending = id
	_render_cards()
	_seq += 1
	var mine := _seq
	var reply: Dictionary = await engine.request("projects.op", {"projectId": id, "op": op, "priority": priority, "view": _args()})
	_pending = ""
	if mine == _seq and reply.get("ok", false):
		_apply(reply["result"])
	else:
		_render_cards()
		_request_view(false, true)


func _locate(id: String) -> void:
	if engine == null:
		return
	var reply: Dictionary = await engine.request("projects.focus", {"projectId": id})
	if not reply.get("ok", false) or typeof(reply["result"]) != TYPE_DICTIONARY:
		return
	var target: Dictionary = reply["result"]
	show_on_map.emit(float(target.get("lng", 0.0)), float(target.get("lat", 0.0)), float(target.get("zoom", 5.0)))


func _input(event: InputEvent) -> void:
	if not _open:
		return
	if event is InputEventMouseButton:
		var press := event as InputEventMouseButton
		if not press.pressed:
			return
		var point := press.position
		if not _confirm_id.is_empty():
			if not (is_instance_valid(_confirm_button) and _confirm_button.get_global_rect().has_point(point)):
				if is_instance_valid(_confirm_button):
					_style_abandon(_confirm_button, false)
				_confirm_id = ""
				_confirm_button = null
		if _menu_open:
			var on_menu := _menu.get_global_rect().has_point(point)
			var on_button := is_instance_valid(_tag_button) and _tag_button.get_global_rect().has_point(point)
			if not on_menu and not on_button:
				_close_menu()
				_render_chips()
	elif event is InputEventKey and _menu_open:
		var key := event as InputEventKey
		if key.pressed and not key.echo and key.keycode == KEY_ESCAPE:
			get_viewport().set_input_as_handled()
			_close_menu()
			_render_chips()
			if is_instance_valid(_tag_button):
				_tag_button.grab_focus()


func _on_focus_changed(node: Control) -> void:
	if not _menu_open or node == null:
		return
	if _menu.is_ancestor_of(node) or node == _tag_button:
		return
	_close_menu()
	_render_chips()


func _build_menu() -> void:
	_menu = PanelContainer.new()
	_menu.top_level = true
	_menu.visible = false
	_menu.add_theme_stylebox_override("panel", UI.box(Color("#1b1b1e"), Color(1, 1, 1, 0.14), 10, 1))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	var head := PanelContainer.new()
	var head_style := UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 0, Vector4(6, 6, 6, 6))
	head_style.border_color = Color(1, 1, 1, 0.08)
	head_style.border_width_bottom = 1
	head.add_theme_stylebox_override("panel", head_style)
	var head_row := HBoxContainer.new()
	head_row.add_theme_constant_override("separation", 6)
	_menu_search = LineEdit.new()
	_menu_search.placeholder_text = "Find a tag…"
	_menu_search.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_menu_search.custom_minimum_size.y = 26
	_menu_search.add_theme_stylebox_override("normal", _style(Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.12), 8, Vector4(8, 0, 8, 0)))
	_menu_search.add_theme_stylebox_override("focus", _style(Color(1, 1, 1, 0.06), Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.6), 8, Vector4(8, 0, 8, 0)))
	_menu_search.add_theme_font_override("font", UI.font(400))
	_menu_search.add_theme_font_size_override("font_size", 12)
	_menu_search.add_theme_color_override("font_color", UI.WHITE)
	_menu_search.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.4))
	_menu_search.add_theme_color_override("caret_color", UI.WHITE)
	_menu_search.text_changed.connect(func(text: String) -> void:
		_menu_needle = text
		_fill_menu())
	_menu_search.gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventKey:
			var key := event as InputEventKey
			if key.pressed and key.keycode == KEY_DOWN and not _menu_rows.is_empty():
				_menu_search.accept_event()
				_menu_rows[0].grab_focus())
	head_row.add_child(_menu_search)
	head_row.add_child(UI.spacer())
	_menu_clear = _ghost("Clear selection")
	_menu_clear.pressed.connect(func() -> void:
		if _tags.is_empty():
			return
		_tags = []
		_after_tags_changed())
	head_row.add_child(_menu_clear)
	head.add_child(head_row)
	column.add_child(head)
	_menu_scroll = ScrollContainer.new()
	_menu_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_thin_scrollbar(_menu_scroll)
	var pad := MarginContainer.new()
	pad.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for side in ["margin_left", "margin_right", "margin_top", "margin_bottom"]:
		pad.add_theme_constant_override(side, 5)
	_menu_grid = GridContainer.new()
	_menu_grid.columns = 2
	_menu_grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_menu_grid.add_theme_constant_override("h_separation", int(TAG_GAP))
	_menu_grid.add_theme_constant_override("v_separation", 2)
	pad.add_child(_menu_grid)
	_menu_scroll.add_child(pad)
	column.add_child(_menu_scroll)
	var empty := UI.label("Nothing matched the search.", 12, Color(1, 1, 1, 0.4))
	empty.add_theme_font_override("font", _italic(400))
	empty.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_menu_empty_pad = MarginContainer.new()
	_menu_empty_pad.add_theme_constant_override("margin_top", 12)
	_menu_empty_pad.add_theme_constant_override("margin_bottom", 12)
	_menu_empty_pad.add_child(empty)
	_menu_empty_pad.visible = false
	column.add_child(_menu_empty_pad)
	_menu.add_child(column)


func _open_menu() -> void:
	_menu_open = true
	_menu_ticked = _tags.duplicate()
	_menu_needle = ""
	_menu_search.text = ""
	_menu_rows.clear()
	_clear(_menu_grid)
	_menu.visible = true
	_render_chips()
	await _fill_menu()
	if not _menu_open:
		return
	if _menu_search.visible:
		_menu_search.grab_focus()
	elif not _menu_rows.is_empty():
		_menu_rows[0].grab_focus()


func _close_menu() -> void:
	_menu_open = false
	if is_instance_valid(_menu):
		_menu.visible = false


func _fill_menu() -> void:
	if engine == null or not _menu_open:
		return
	var reply: Dictionary = await engine.request("projects.tags", {"tickedAtOpen": _menu_ticked, "query": _menu_needle})
	if not _menu_open or not reply.get("ok", false) or typeof(reply["result"]) != TYPE_DICTIONARY:
		return
	var result: Dictionary = reply["result"]
	_menu_search.visible = bool(result.get("searchable", false))
	_render_menu(result.get("shown", []))


func _render_menu(shown: Array) -> void:
	var focused := get_viewport().gui_get_focus_owner() if is_inside_tree() else null
	var focused_tag := ""
	if focused != null and focused.has_meta("tag") and _menu.is_ancestor_of(focused):
		focused_tag = str(focused.get_meta("tag"))
	_clear(_menu_grid)
	_menu_rows.clear()
	var none_ticked := _tags.is_empty()
	_menu_clear.modulate.a = 0.45 if none_ticked else 1.0
	_menu_clear.mouse_default_cursor_shape = Control.CURSOR_ARROW if none_ticked else Control.CURSOR_POINTING_HAND
	_menu_scroll.visible = not shown.is_empty()
	_menu_empty_pad.visible = shown.is_empty()
	for entry in shown:
		var tag := str(entry)
		var row := _tag_row(tag, _tags.has(tag))
		_menu_rows.append(row)
		_menu_grid.add_child(row)
	_place_menu()
	if not focused_tag.is_empty():
		for row in _menu_rows:
			if str(row.get_meta("tag")) == focused_tag:
				row.grab_focus()


func _tag_row(tag: String, checked: bool) -> Control:
	var row := PanelContainer.new()
	var normal := UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 7, 0, Vector4(7, 5, 7, 5))
	var lit := UI.box(Color(1, 1, 1, 0.07), Color(0, 0, 0, 0), 7, 0, Vector4(7, 5, 7, 5))
	row.add_theme_stylebox_override("panel", normal)
	row.set_meta("tag", tag)
	row.focus_mode = Control.FOCUS_ALL
	row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.custom_minimum_size.x = TAG_COLUMN
	row.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var paint := func() -> void:
		var hovered := row.get_global_rect().has_point(row.get_global_mouse_position())
		row.add_theme_stylebox_override("panel", lit if hovered or row.has_focus() else normal)
	row.mouse_entered.connect(func() -> void: row.add_theme_stylebox_override("panel", lit))
	row.mouse_exited.connect(paint)
	row.focus_entered.connect(paint)
	row.focus_exited.connect(paint)
	row.gui_input.connect(func(event: InputEvent) -> void: _on_tag_key(row, tag, event))
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 7)
	line.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var tick := PanelContainer.new()
	tick.custom_minimum_size = Vector2(15, 15)
	tick.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	tick.mouse_filter = Control.MOUSE_FILTER_IGNORE
	tick.add_theme_stylebox_override("panel", UI.box(UI.ACCENT if checked else Color(0, 0, 0, 0), UI.ACCENT if checked else Color(1, 1, 1, 0.32), 4, 1))
	if checked:
		var mark := TextureRect.new()
		mark.texture = _glyph("tick", 10, Color("#0e0e10"))
		mark.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
		mark.mouse_filter = Control.MOUSE_FILTER_IGNORE
		tick.add_child(mark)
	line.add_child(tick)
	var text := UI.wrapped(tag, 12, Color("#f4f4f5") if checked else Color(1, 1, 1, 0.68))
	text.autowrap_mode = TextServer.AUTOWRAP_ARBITRARY
	text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	line.add_child(text)
	row.add_child(line)
	return row


func _on_tag_key(row: Control, tag: String, event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var press := event as InputEventMouseButton
		if press.button_index == MOUSE_BUTTON_LEFT and not press.pressed:
			row.grab_focus()
			_toggle_tag(tag)
		return
	if not (event is InputEventKey):
		return
	var key := event as InputEventKey
	if not key.pressed or key.alt_pressed or key.ctrl_pressed or key.meta_pressed:
		return
	if key.keycode == KEY_ENTER or key.keycode == KEY_KP_ENTER or key.keycode == KEY_SPACE:
		row.accept_event()
		if not key.echo:
			_toggle_tag(tag)
		return
	var names := {KEY_RIGHT: "ArrowRight", KEY_LEFT: "ArrowLeft", KEY_DOWN: "ArrowDown", KEY_UP: "ArrowUp", KEY_HOME: "Home", KEY_END: "End"}
	if not names.has(key.keycode):
		return
	var index := _menu_rows.find(row)
	var columns := mini(_menu_grid.columns, _menu_rows.size())
	var next := _step_tag_focus(str(names[key.keycode]), index, _menu_rows.size(), columns)
	if next < 0:
		return
	row.accept_event()
	if next == index and key.keycode == KEY_UP and _menu_search.visible:
		_menu_search.grab_focus()
	else:
		_menu_rows[next].grab_focus()
		_menu_scroll.ensure_control_visible(_menu_rows[next])


func _toggle_tag(tag: String) -> void:
	if _tags.has(tag):
		_tags.erase(tag)
	else:
		_tags.append(tag)
	_after_tags_changed()


func _after_tags_changed() -> void:
	_fill_menu()
	_request_view()


func _place_menu() -> void:
	if not _menu_open or not is_instance_valid(_chips) or not _chips.is_inside_tree():
		return
	var width := _chips.size.x
	var inner := width - 2.0 - 10.0
	_menu_grid.columns = maxi(1, int(floor((inner + TAG_GAP) / (TAG_COLUMN + TAG_GAP))))
	var limit := minf(288.0, _height() - 192.0)
	var content := _menu_grid.get_combined_minimum_size().y + 10.0
	_menu_scroll.custom_minimum_size.y = minf(content, maxf(limit - 39.0, 40.0))
	_menu.size = Vector2(width, 0)
	_menu.reset_size()
	_menu.size.x = width
	_menu.global_position = _chips.global_position + Vector2(0, _chips.size.y + 5.0)


class ProjectsProgressLine extends Control:
	var value := 0.0
	var fill := Color("#22c55e")

	func _init() -> void:
		custom_minimum_size.y = 6
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func _draw() -> void:
		var track := StyleBoxFlat.new()
		track.bg_color = Color(1, 1, 1, 0.1)
		track.set_corner_radius_all(3)
		track.anti_aliasing = true
		draw_style_box(track, Rect2(Vector2.ZERO, size))
		var share := clampf(roundf(value), 0.0, 100.0) / 100.0
		if share <= 0.0:
			return
		var bar := StyleBoxFlat.new()
		bar.bg_color = fill
		bar.set_corner_radius_all(3)
		bar.anti_aliasing = true
		draw_style_box(bar, Rect2(Vector2.ZERO, Vector2(maxf(size.x * share, 6.0), size.y)))


class ProjectsDashedPanel extends PanelContainer:
	var ink := Color(1, 1, 1, 0.15)
	var corner := 12.0

	func _draw() -> void:
		var rect := Rect2(Vector2(0.5, 0.5), size - Vector2(1, 1))
		var edges := [
			[Vector2(rect.position.x + corner, rect.position.y), Vector2(rect.end.x - corner, rect.position.y)],
			[Vector2(rect.end.x, rect.position.y + corner), Vector2(rect.end.x, rect.end.y - corner)],
			[Vector2(rect.end.x - corner, rect.end.y), Vector2(rect.position.x + corner, rect.end.y)],
			[Vector2(rect.position.x, rect.end.y - corner), Vector2(rect.position.x, rect.position.y + corner)],
		]
		for edge in edges:
			draw_dashed_line(edge[0], edge[1], ink, 1.0, 3.0)
		var corners := [[rect.position + Vector2(corner, corner), PI, PI * 1.5], [Vector2(rect.end.x - corner, rect.position.y + corner), PI * 1.5, TAU], [rect.end - Vector2(corner, corner), 0.0, PI * 0.5], [Vector2(rect.position.x + corner, rect.end.y - corner), PI * 0.5, PI]]
		for arc in corners:
			draw_arc(arc[0], corner, arc[1], arc[2], 8, ink, 1.0, true)
