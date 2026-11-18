class_name ProjectsPanel
extends VBoxContainer

signal open_advisor(text: String)
signal show_on_map(lng: float, lat: float, zoom: float)

const NATURAL_LEADING := 1.12
const TAG_COLUMN := 140.0
const TAG_GAP := 3.0
const BRIEF_OWN := "Brief me in full on the %s \"{{name}}\". Where does it actually stand right now, what has moved since the last round, what does the next milestone need from me, and what is most likely to go wrong? Be specific and tell me if the board is out of date."
const BRIEF_FOREIGN_OWNER := "Brief me on {{owner}}'s %s \"{{name}}\". What do we actually know, how good is the sourcing, what has changed since we last looked, and what does it mean for us if it succeeds? Be honest about how much of this is inference rather than intelligence."
const BRIEF_FOREIGN := "Brief me on the foreign %s \"{{name}}\". What do we actually know, how good is the sourcing, what has changed since we last looked, and what does it mean for us if it succeeds? Be honest about how much of this is inference rather than intelligence."
const COUNTER_OWNER := "What can we actually do about {{owner}}'s \"{{name}}\"? Lay out the realistic options — diplomatic, economic, covert, or simply outpacing them — with what each would cost us and how it could go wrong. If we settle on one, open it as our own effort."
const COUNTER := "What can we actually do about this \"{{name}}\"? Lay out the realistic options — diplomatic, economic, covert, or simply outpacing them — with what each would cost us and how it could go wrong. If we settle on one, open it as our own effort."
const ACCENT_SOFT := Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.14)
const ACCENT_EDGE := Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.45)
const AMBER := Color("#fbbf24")
const RED_INK := Color("#fca5a5")
const STATUS_TONES := {
	"planning": ["Planning", Color(1, 1, 1, 0.75), Color(1, 1, 1, 0.1)],
	"active": ["Active", UI.ACCENT, ACCENT_SOFT],
	"running": ["Running", UI.ACCENT, ACCENT_SOFT],
	"stalled": ["Stalled", AMBER, Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.16)],
	"paused": ["Paused", Color(1, 1, 1, 0.6), Color(1, 1, 1, 0.08)],
	"complete": ["Complete", Color("#86efac"), Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.14)],
	"failed": ["Failed", Color("#f87171"), Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.16)],
	"cancelled": ["Cancelled", Color(1, 1, 1, 0.45), Color(1, 1, 1, 0.06)],
}
const STALL_REASONS := {"funds": "Stalled: no funds", "site": "Stalled: site lost", "blocked": "Stalled: blocked"}
const VERIFICATION := {
	"doubted": ["Doubtful", Color("#fbbf24"), Color(251 / 255.0, 191 / 255.0, 36 / 255.0, 0.14), Color(251 / 255.0, 191 / 255.0, 36 / 255.0, 0.4), "Our analysts do not trust how we came by this. Put someone else in place to settle it."],
	"confirmed": ["Confirmed", Color("#86efac"), Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.14), Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.4), "A second source stands this up."],
	"refuted": ["Fabricated", Color("#fca5a5"), Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.14), Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.4), "A second source showed there was never anything here."],
}
const SECRECY := {"restricted": "🔒", "covert": "🕵"}
const FUNDING_OPTIONS := [
	["none", "Off", "No money and no work: the project waits"],
	["low", "Low", "Half the cost, half the speed"],
	["normal", "Normal", "The plan's cost and speed"],
	["high", "High", "One and a half times the cost and the speed"],
]
const VISIBILITY := [["public", "Public"], ["restricted", "Restricted"], ["covert", "Covert"]]
const ORANGE_INK := Color(253 / 255.0, 186 / 255.0, 116 / 255.0, 0.85)
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
var height_source: Callable
var _view := {}
var _last_json := ""
var _stamp := ""
var _stamp_key := ""
var _loaded := false
var _seq := 0
var _polling := false
var _query := ""
var _sort := "updated"
var _tags: Array = []
var _show_closed := false
var _expanded := ""
var _pending := ""
var _planning_id := ""
var _plan_error := ""
var _confirm_id := ""
var _confirm_button: Button
var _confirm_turn := 0
var _poll: Timer
var _filters: PanelContainer
var _new_holder: VBoxContainer
var _means_row: VBoxContainer
var _search_holder: Control
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
var _open := false
var _np_open := false
var _np_planning := false
var _np_saving := false
var _np_error := ""
var _np_draft: Variant = null
var _np_view := {}
var _np_secrecy := "auto"
var _np_name: LineEdit
var _np_goal: TextEdit
var _np_plan_button: Button


func _init() -> void:
	add_theme_constant_override("separation", 0)
	size_flags_vertical = Control.SIZE_EXPAND_FILL
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	mouse_filter = Control.MOUSE_FILTER_PASS
	_build_filters()
	_banner = PanelContainer.new()
	var banner_style := UI.box(Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.12), Color(0, 0, 0, 0), 0, 0, Vector4(16, 8, 16, 8))
	banner_style.border_color = Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.3)
	banner_style.border_width_bottom = 1
	_banner.add_theme_stylebox_override("panel", banner_style)
	_banner_label = UI.wrapped("", 11, Color(253 / 255.0, 230 / 255.0, 138 / 255.0, 0.95))
	_banner.add_child(_leading(_banner_label, 11, 1.45))
	_banner.visible = false
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
	if UI.phone():
		var whole := VBoxContainer.new()
		whole.add_theme_constant_override("separation", 0)
		whole.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		whole.add_child(_filters)
		whole.add_child(_banner)
		whole.add_child(cards_margin)
		_cards_scroll.add_child(whole)
		_cards_scroll.get_v_scroll_bar().value_changed.connect(_on_phone_scroll)
	else:
		add_child(_filters)
		add_child(_banner)
		_cards_scroll.add_child(cards_margin)
	add_child(_cards_scroll)
	_build_menu()
	add_child(_menu)
	_poll = Timer.new()
	_poll.wait_time = 1.0
	_poll.timeout.connect(_on_poll)
	add_child(_poll)
	_render()


func _on_phone_scroll(_value: float) -> void:
	if _menu_open:
		_place_menu()


func _on_theme_changed() -> void:
	if _open:
		_render()


func _on_viewport_resized() -> void:
	if _menu_open:
		_place_menu.call_deferred()


func _ready() -> void:
	UiTheme.events().changed.connect(_on_theme_changed)
	get_viewport().size_changed.connect(_on_viewport_resized)
	get_viewport().gui_focus_changed.connect(_on_focus_changed)


func setup(link: EngineLink, ctx: Dictionary = {}) -> void:
	engine = link
	context = ctx


func open() -> void:
	set_open(true)


func close() -> void:
	set_open(false)


func is_open() -> bool:
	return _open


func set_open(open: bool) -> void:
	var was := _open
	_open = open
	if open and not was:
		_poll.start()
		_request_view(true)
	elif not open and was:
		_poll.stop()
		_seq += 1
		_expanded = ""
		_show_closed = false
		_confirm_id = ""
		_close_menu()
		_render()


func refresh() -> void:
	await _request_view(true)


func _height() -> float:
	if height_source.is_valid():
		return float(height_source.call())
	var viewport_height := get_viewport_rect().size.y if is_inside_tree() else 900.0
	return maxf(160.0, minf(viewport_height - 144.0, maxf(viewport_height - 256.0, 480.0)))


func _args(force := false, reload := false) -> Dictionary:
	return {"force": force, "reload": reload, "stamp": _stamp if reload and _stamp_key == _view_key() else "", "query": _query, "tags": _tags, "showClosed": _show_closed, "sort": _sort, "expanded": _expanded}


func _view_key() -> String:
	return JSON.stringify([_query, _tags, _show_closed, _sort, _expanded])


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
	var texture := UI.svg_texture(svg, float(size) / 24.0, color.a if color.a < 1.0 else 1.0)
	if texture == null:
		return null
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


static func _ghost(text: String) -> Button:
	var pad := Vector4(10, 5, 10, 5)
	var look := _style(UiTheme.pick("raised", GHOST_BG), Color(1, 1, 1, 0.12), 8, pad)
	var button := _styled_button(text, 11, 600, Color(1, 1, 1, 0.85), look, look)
	button.custom_minimum_size.y = 26
	return button


static func _accent(text: String) -> Button:
	var pad := Vector4(10, 5, 10, 5)
	var look := _style(ACCENT_SOFT, ACCENT_EDGE, 8, pad)
	var button := _styled_button(text, 11, 600, UI.ACCENT, look, look)
	button.custom_minimum_size.y = 26
	return button


static func _dim(button: Button, off: bool) -> void:
	button.disabled = off
	button.modulate.a = 0.5 if off else 1.0
	button.mouse_default_cursor_shape = Control.CURSOR_ARROW if off else Control.CURSOR_POINTING_HAND


static func _pill(text: String, ink: Color, bg: Color, tooltip := "") -> PanelContainer:
	var holder := PanelContainer.new()
	holder.add_theme_stylebox_override("panel", UI.box(bg, Color(0, 0, 0, 0), 999, 0, Vector4(7, 2, 7, 3)))
	holder.tooltip_text = tooltip
	holder.mouse_filter = Control.MOUSE_FILTER_PASS if not tooltip.is_empty() else Control.MOUSE_FILTER_IGNORE
	holder.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var caption := UI.label(text.to_upper(), 10, ink, 700, "Arial", 1)
	caption.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	holder.add_child(caption)
	return holder


static func _small_label(text: String) -> Label:
	var caption := UI.label(text.to_upper(), 10, Color(1, 1, 1, 0.45), 700, "Arial", 1)
	caption.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	return caption


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


static func _field_style(margin: Vector4, focus := false) -> StyleBoxFlat:
	return _style(Color(1, 1, 1, 0.06), Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.6) if focus else Color(1, 1, 1, 0.12), 9, margin)


static func _line_edit(placeholder: String, font_size: int, margin: Vector4) -> LineEdit:
	var edit := LineEdit.new()
	edit.placeholder_text = placeholder
	edit.add_theme_stylebox_override("normal", _field_style(margin))
	edit.add_theme_stylebox_override("focus", _field_style(margin))
	edit.add_theme_stylebox_override("read_only", _field_style(margin))
	edit.add_theme_font_override("font", UI.font(400))
	edit.add_theme_font_size_override("font_size", font_size)
	edit.add_theme_color_override("font_color", UI.WHITE)
	edit.add_theme_color_override("font_uneditable_color", Color(1, 1, 1, 0.5))
	edit.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.4))
	edit.add_theme_color_override("caret_color", UI.WHITE)
	return edit


static func _select(options: Array, selected: String, font_size: int, margin: Vector4, radius := 9) -> OptionButton:
	var pick := OptionButton.new()
	pick.focus_mode = Control.FOCUS_NONE
	pick.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	pick.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var look := _style(UiTheme.pick("surface", Color(1, 1, 1, 0.06)), Color(1, 1, 1, 0.12), radius, margin)
	for state in ["normal", "hover", "pressed", "focus", "hover_pressed", "disabled"]:
		pick.add_theme_stylebox_override(state, look)
	pick.add_theme_font_override("font", UI.font(400))
	pick.add_theme_font_size_override("font_size", font_size)
	for slot in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color", "font_disabled_color"]:
		pick.add_theme_color_override(slot, UI.WHITE)
	var popup := pick.get_popup()
	popup.add_theme_stylebox_override("panel", UI.box(Color("#18181b"), Color(1, 1, 1, 0.12), 8, 1, Vector4(4, 4, 4, 4)))
	popup.add_theme_font_override("font", UI.font(400))
	popup.add_theme_font_size_override("font_size", font_size)
	for entry in options:
		var option: Array = entry
		pick.add_item(str(option[1]))
		pick.set_item_metadata(pick.item_count - 1, str(option[0]))
		if str(option[0]) == selected:
			pick.select(pick.item_count - 1)
	return pick


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
	_new_holder = VBoxContainer.new()
	_new_holder.add_theme_constant_override("separation", 6)
	column.add_child(_new_holder)
	_np_name = _line_edit("Name", 12, Vector4(9, 7, 9, 7))
	_np_name.max_length = 120
	_np_name.text_changed.connect(_on_np_name_changed)
	_np_goal = TextEdit.new()
	_np_goal.placeholder_text = "What is it for?"
	_np_goal.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	_np_goal.custom_minimum_size.y = 62
	_np_goal.add_theme_stylebox_override("normal", _field_style(Vector4(9, 7, 9, 7)))
	_np_goal.add_theme_stylebox_override("focus", _field_style(Vector4(9, 7, 9, 7)))
	_np_goal.add_theme_stylebox_override("read_only", _field_style(Vector4(9, 7, 9, 7)))
	_np_goal.add_theme_font_override("font", UI.font(400))
	_np_goal.add_theme_font_size_override("font_size", 12)
	_np_goal.add_theme_color_override("font_color", UI.WHITE)
	_np_goal.add_theme_color_override("font_readonly_color", Color(1, 1, 1, 0.5))
	_np_goal.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.4))
	_np_goal.add_theme_color_override("caret_color", UI.WHITE)
	_np_goal.text_changed.connect(_on_np_goal_changed)
	_means_row = VBoxContainer.new()
	_means_row.add_theme_constant_override("separation", 0)
	_means_row.mouse_filter = Control.MOUSE_FILTER_PASS
	column.add_child(_means_row)
	_search_holder = Control.new()
	_search_holder.custom_minimum_size.y = 29
	_search = LineEdit.new()
	_search.set_meta("oh_tap_exempt", true)
	_search.placeholder_text = "Search projects…"
	_search.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	_search.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var field := _style(Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.12), 9, Vector4(27, 0, 8, 0))
	_search.add_theme_stylebox_override("normal", field)
	_search.add_theme_stylebox_override("focus", field)
	_search.add_theme_font_override("font", UI.font(400))
	_search.add_theme_font_size_override("font_size", 12)
	_search.add_theme_color_override("font_color", UI.WHITE)
	_search.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.4))
	_search.add_theme_color_override("caret_color", UI.WHITE)
	_search.text_changed.connect(_on_search_changed)
	_search_holder.add_child(_search)
	var icon := TextureRect.new()
	icon.texture = _glyph("search", 13, Color(1, 1, 1, 0.35))
	icon.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
	icon.mouse_filter = Control.MOUSE_FILTER_IGNORE
	icon.anchor_top = 0.0
	icon.anchor_bottom = 1.0
	icon.offset_left = 8
	icon.offset_right = 22
	_search_holder.add_child(icon)
	column.add_child(_search_holder)
	_chips = HFlowContainer.new()
	_chips.add_theme_constant_override("h_separation", 6)
	_chips.add_theme_constant_override("v_separation", 6)
	column.add_child(_chips)
	_filters.add_child(column)


func _on_search_changed(text: String) -> void:
	_query = text
	_request_view()


func _on_np_name_changed(_text: String) -> void:
	if is_instance_valid(_np_plan_button):
		_dim(_np_plan_button, _np_name.text.strip_edges().is_empty() or _np_planning)


func _on_np_goal_changed() -> void:
	if _np_goal.text.length() > 600:
		var column := _np_goal.get_caret_column()
		_np_goal.text = _np_goal.text.substr(0, 600)
		_np_goal.set_caret_column(mini(column, 600))


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
	var closed_count := int(_view.get("closedCount", 0))
	var open_count := int(_view.get("openCount", 0))
	var sorts: Array = []
	for entry in _view.get("sorts", []):
		var option: Dictionary = entry
		sorts.append([str(option.get("key", "")), str(option.get("label", ""))])
	var sort := _select(sorts, _sort, 12, Vector4(6, 4, 6, 4), 8)
	sort.custom_minimum_size.y = 24
	sort.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	sort.item_selected.connect(_on_sort_selected.bind(sort))
	_chips.add_child(sort)
	if closed_count > 0:
		_chips.add_child(_chip("← Running (%d)" % open_count if _show_closed else "Closed (%d)" % closed_count, _show_closed, "", _toggle_closed))
	if not (_view.get("availableTags", []) as Array).is_empty():
		_chips.add_child(_tags_chip())


func _on_sort_selected(index: int, sort: OptionButton) -> void:
	_sort = str(sort.get_item_metadata(index))
	_request_view()


func _toggle_closed() -> void:
	_show_closed = not _show_closed
	_request_view()


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
	button.pressed.connect(_on_tags_pressed)
	_tag_button = button
	return button


func _on_tags_pressed() -> void:
	if _menu_open:
		_close_menu()
		_render_chips()
	else:
		_open_menu()


func _render() -> void:
	var known := int(_view.get("knownCount", 0)) > 0
	if _new_holder.get_child_count() == 0:
		_render_new()
	_render_means()
	_search_holder.visible = known
	_chips.visible = known
	if known:
		_render_chips()
	var limit := int(_view.get("limit", 0))
	var total := int(_view.get("total", 0))
	_banner.visible = limit > 0 and total >= limit - 10
	if _banner.visible:
		_banner_label.text = "The board is full (%d). New projects are refused; existing entries are preserved." % limit if total >= limit else "%d slots left before new projects are refused." % (limit - total)
	_render_cards()
	if _menu_open:
		_place_menu.call_deferred()


func _render_means() -> void:
	_clear(_means_row)
	var means: Dictionary = _view.get("means", {})
	var mode := str(means.get("mode", "gdp-proxy"))
	var ink := Color(1, 1, 1, 0.5)
	_means_row.tooltip_text = "Projects consume time and capacity, without claiming money or a national treasury." if mode == "nonmonetary" else "The project allowance is an estimate from GDP, budget balance and public debt. Spending is not reconciled to a national treasury."
	_means_row.visible = _loaded
	if not _loaded:
		return
	var parts: Array = []
	if mode == "nonmonetary":
		parts.append(["Non-monetary project funding: time and capacity only; no GDP or cash payments required", ink])
	elif not bool(means.get("assessed", false)):
		parts.append(["No native GDP baseline: paid projects cannot receive funding until assessed", AMBER])
	else:
		parts.append([I18n.ui("Estimated project allowance: {{amount}} per month", {"amount": str(means.get("budget", "0"))}), ink])
		parts.append([I18n.ui("Planned monthly commitments: {{amount}}", {"amount": str(means.get("committed", "0"))}), ink])
		if float(means.get("covered", 1.0)) < 1.0:
			parts.append(["Underfunded: planned costs exceed allowance", AMBER])
	if parts.size() == 1:
		var whole := UI.wrapped(str(parts[0][0]), 11, parts[0][1])
		whole.mouse_filter = Control.MOUSE_FILTER_PASS
		_means_row.add_child(whole)
		return
	var flow := HFlowContainer.new()
	flow.add_theme_constant_override("h_separation", 10)
	flow.add_theme_constant_override("v_separation", 2)
	flow.mouse_filter = Control.MOUSE_FILTER_PASS
	for part in parts:
		var line := UI.label(str(part[0]), 11, part[1])
		line.mouse_filter = Control.MOUSE_FILTER_PASS
		flow.add_child(line)
	_means_row.add_child(flow)


func _render_new() -> void:
	for child in _new_holder.get_children():
		_new_holder.remove_child(child)
		if child != _np_name and child != _np_goal:
			child.queue_free()
	if _np_name.get_parent() != null:
		_np_name.get_parent().remove_child(_np_name)
	if _np_goal.get_parent() != null:
		_np_goal.get_parent().remove_child(_np_goal)
	if not _np_open:
		var start := _accent("＋ " + I18n.ui("New project"))
		start.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		start.pressed.connect(_on_np_open)
		_new_holder.add_child(start)
		return
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", _style(UiTheme.pick("surface", Color(1, 1, 1, 0.05)), Color(1, 1, 1, 0.08), 12, Vector4(13, 11, 13, 11)))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 6)
	var mode := str((_view.get("means", {}) as Dictionary).get("mode", "gdp-proxy"))
	if _np_draft == null:
		_np_name.editable = not _np_planning
		_np_goal.editable = not _np_planning
		column.add_child(_np_name)
		column.add_child(_np_goal)
		var row := HFlowContainer.new()
		row.add_theme_constant_override("h_separation", 6)
		row.add_theme_constant_override("v_separation", 6)
		var plan := _accent(I18n.ui("Planning…") if _np_planning else I18n.ui("Plan it"))
		_dim(plan, _np_name.text.strip_edges().is_empty() or _np_planning)
		plan.pressed.connect(_on_np_plan)
		_np_plan_button = plan
		row.add_child(plan)
		var cancel := _ghost(I18n.ui("Cancel"))
		cancel.disabled = _np_planning
		cancel.pressed.connect(_on_np_cancel)
		row.add_child(cancel)
		if _np_planning:
			var note := UI.label(I18n.ui("One AI request"), 11, Color(1, 1, 1, 0.45))
			note.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			row.add_child(note)
		column.add_child(row)
	var visibility := HBoxContainer.new()
	visibility.add_theme_constant_override("separation", 6)
	var caption := UI.label(I18n.ui("Project visibility"), 12, Color(1, 1, 1, 0.7))
	caption.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	visibility.add_child(caption)
	var first := I18n.ui("Use planner's classification")
	if _np_draft != null:
		first = "As planned (%s)" % str(_np_view.get("secrecy", "public"))
	var options: Array = [["auto", first]]
	for entry in VISIBILITY:
		options.append([entry[0], I18n.ui(str(entry[1]))])
	var pick := _select(options, _np_secrecy, 12, Vector4(7, 5, 7, 5))
	pick.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	pick.disabled = _np_planning or _np_saving
	pick.item_selected.connect(_on_np_secrecy.bind(pick))
	visibility.add_child(pick)
	column.add_child(visibility)
	if _np_draft != null:
		column.add_child(_spaced(_plan_card(mode), 3))
	if not _np_error.is_empty():
		column.add_child(UI.wrapped(_np_error, 11, RED_INK))
	card.add_child(column)
	_new_holder.add_child(card)


func _plan_card(mode: String) -> Control:
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", _style(UiTheme.pick("surface", Color(1, 1, 1, 0.05)), ACCENT_EDGE, 12, Vector4(13, 11, 13, 11)))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	var top := HBoxContainer.new()
	top.add_theme_constant_override("separation", 6)
	var glyph := UI.label("⚔" if str(_np_view.get("kind", "")) == "operation" else "🔬", 13, UI.WHITE)
	glyph.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	top.add_child(glyph)
	var title := UI.wrapped(str(_np_view.get("name", "")), 14, UI.WHITE, 700)
	title.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(title)
	column.add_child(top)
	var summary := str(_np_view.get("summary", ""))
	if not summary.is_empty():
		var text := UI.wrapped(summary, 12, Color(1, 1, 1, 0.72))
		text.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
		column.add_child(_spaced(_leading(text, 12, 1.45), 6))
	var plan: Variant = _np_view.get("plan")
	if typeof(plan) == TYPE_DICTIONARY:
		column.add_child(_plan_facts(plan, str(_view.get("playerCountry", "")), mode == "nonmonetary"))
		var checkpoints := _milestones(plan)
		if checkpoints != null:
			column.add_child(checkpoints)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	var start := _accent(I18n.ui("Start"))
	_dim(start, _np_saving)
	start.pressed.connect(_on_np_start)
	row.add_child(start)
	var discard := _ghost(I18n.ui("Discard"))
	_dim(discard, _np_saving)
	discard.pressed.connect(_on_np_discard)
	row.add_child(discard)
	column.add_child(_spaced(row, 10))
	card.add_child(column)
	return card


func _on_np_open() -> void:
	_np_open = true
	_render_new()
	if not UI.phone():
		_np_name.grab_focus.call_deferred()


func _np_reset() -> void:
	_np_name.text = ""
	_np_goal.text = ""
	_np_draft = null
	_np_view = {}
	_np_error = ""
	_np_secrecy = "auto"


func _on_np_cancel() -> void:
	_np_reset()
	_np_open = false
	_render_new()


func _on_np_discard() -> void:
	_np_draft = null
	_np_view = {}
	_render_new()


func _on_np_secrecy(index: int, pick: OptionButton) -> void:
	_np_secrecy = str(pick.get_item_metadata(index))


func _on_np_plan() -> void:
	var wanted := _np_name.text.strip_edges()
	if wanted.is_empty() or _np_planning or engine == null:
		return
	_np_planning = true
	_np_error = ""
	_render_new()
	var reply: Dictionary = await engine.request("projects.plan", {"name": wanted, "goal": _np_goal.text.strip_edges()})
	_np_planning = false
	var result: Dictionary = reply.get("result", {}) if reply.get("ok", false) and typeof(reply.get("result")) == TYPE_DICTIONARY else {}
	if result.has("draft"):
		_np_draft = result["draft"]
		_np_view = result.get("view", {})
	else:
		_np_error = str(result.get("error", reply.get("error", ""))).strip_edges()
		if _np_error.is_empty():
			_np_error = I18n.ui("The plan could not be made.")
	_render_new()


func _on_np_start() -> void:
	if _np_draft == null or _np_saving or engine == null:
		return
	_np_saving = true
	_render_new()
	var view := _args()
	view["showClosed"] = false
	var reply: Dictionary = await engine.request("projects.start", {"draft": _np_draft, "secrecy": _np_secrecy, "view": view})
	_np_saving = false
	var result: Dictionary = reply.get("result", {}) if reply.get("ok", false) and typeof(reply.get("result")) == TYPE_DICTIONARY else {}
	if result.get("ok", false):
		_np_reset()
		_np_open = false
		_show_closed = false
		_seq += 1
		_apply(result.get("view", {}))
		_render_new()
		return
	_np_error = str(result.get("error", reply.get("error", ""))).strip_edges()
	_render_new()


func _render_cards() -> void:
	var offset := _cards_scroll.scroll_vertical
	_clear(_cards)
	_confirm_button = null
	if not _loaded:
		var loading := UI.label("Loading…", 12, Color(1, 1, 1, 0.35))
		loading.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		var pad := MarginContainer.new()
		pad.add_theme_constant_override("margin_top", 16)
		pad.add_theme_constant_override("margin_bottom", 16)
		pad.add_child(loading)
		_cards.add_child(pad)
		return
	if not _plan_error.is_empty():
		_cards.add_child(UI.wrapped(_plan_error, 11, RED_INK))
	var mine: Array = _view.get("mine", [])
	var abroad: Array = _view.get("abroad", [])
	if int(_view.get("knownCount", 0)) > 0 and mine.is_empty() and abroad.is_empty():
		_cards.add_child(_no_match())
	if not mine.is_empty():
		_cards.add_child(_section_title("Your projects", mine.size()))
		for entry in mine:
			_cards.add_child(_card(entry))
	if not abroad.is_empty():
		_cards.add_child(_section_title("Known projects abroad", abroad.size()))
		for entry in abroad:
			_cards.add_child(_card(entry))
	if offset > 0:
		_keep_scroll(offset)


func _section_title(text: String, count: int) -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	row.add_child(_small_label(I18n.ui(text)))
	if count > 0:
		var number := UI.label(str(count), 10, Color(1, 1, 1, 0.3), 700, "Arial", 1)
		number.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
		row.add_child(number)
	return _spaced(row, 3)


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


func _no_match() -> Control:
	var box := _dashed_box(0.14, 10.0, Vector4(14, 14, 14, 14))
	var line := UI.wrapped("No closed entries match those filters." if _show_closed else "Nothing matches those filters.", 12, Color(1, 1, 1, 0.4))
	line.add_theme_font_override("font", _italic(400))
	line.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(line)
	return box


func _progress_color(card: Dictionary) -> Color:
	var status := str(card.get("status", ""))
	if status == "complete":
		return Color("#86efac")
	if status == "failed" or status == "cancelled":
		return Color(1, 1, 1, 0.25)
	if status == "stalled":
		return Color("#f59e0b")
	if status == "paused" or status == "planning":
		return Color(1, 1, 1, 0.35)
	return UI.ACCENT


func _finish_line(card: Dictionary) -> String:
	var status := str(card.get("status", ""))
	if status == "complete":
		var completed := str(card.get("completedAt", ""))
		return I18n.ui("Completed {{date}}", {"date": completed}) if not completed.is_empty() else I18n.ui("Completed")
	if not bool(card.get("open", true)):
		return ""
	if bool(card.get("planning", false)):
		return I18n.ui("Waiting for its plan")
	if bool(card.get("running", false)):
		return I18n.ui("Running")
	if status == "paused":
		return I18n.ui("Paused")
	var finish := str(card.get("finish", ""))
	if not finish.is_empty():
		return I18n.ui("Done by about {{date}}", {"date": finish})
	return I18n.ui("No finish in sight")


func _escape(text: String) -> String:
	return text.replace("[", "[lb]")


func _change_text(effect: Dictionary) -> String:
	var change := str(effect.get("change", ""))
	match str(effect.get("unit", "")):
		"percent":
			return change + "%"
		"points":
			return I18n.ui("{{change}} pts", {"change": change})
	return change


func _effect_text(effect: Dictionary, owner: String) -> String:
	var country := str(effect.get("country", ""))
	match str(effect.get("type", "")):
		"stat":
			var stat := I18n.ui(str(effect.get("stat", "")))
			if not country.is_empty() and country != owner:
				return I18n.ui("{{country}}: {{stat}} {{change}}", {"country": country, "stat": stat, "change": _change_text(effect)})
			return "%s %s" % [stat, _change_text(effect)]
		"relation":
			return I18n.ui("Relations with {{country}} {{change}}", {"country": country, "change": str(effect.get("change", ""))})
		"structure":
			return I18n.ui("Builds {{name}}", {"name": str(effect.get("name", ""))})
		"unitType":
			return I18n.ui("New unit type: {{name}}", {"name": str(effect.get("name", ""))})
		"territory":
			if bool(effect.get("claim", false)):
				return I18n.ui("{{country}} claims {{region}}", {"country": country, "region": str(effect.get("region", ""))})
			return I18n.ui("{{region}} passes to {{country}}", {"country": country, "region": str(effect.get("region", ""))})
	return ""


func _effect_list(effects: Array, owner: String) -> String:
	var parts := PackedStringArray()
	for entry in effects:
		var text := _effect_text(entry, owner)
		if not text.is_empty():
			parts.append(text)
	return " · ".join(parts)


func _plan_facts(plan: Dictionary, owner: String, cost_shown: bool) -> Control:
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 6)
	var facts := HFlowContainer.new()
	facts.add_theme_constant_override("h_separation", 13)
	facts.add_theme_constant_override("v_separation", 2)
	facts.add_child(UI.label(I18n.ui("{{days}} days of work", {"days": int(plan.get("durationDays", 0))}), 12, Color(1, 1, 1, 0.8)))
	if not cost_shown:
		facts.add_child(UI.label(I18n.ui("{{amount}} a month", {"amount": str(plan.get("monthlyCost", "0"))}), 12, Color(1, 1, 1, 0.8)))
	if bool(plan.get("ongoing", false)):
		facts.add_child(UI.label(I18n.ui("Runs on once set up"), 12, Color(1, 1, 1, 0.8)))
	column.add_child(facts)
	for part in [["effects", "When done"], ["yields", "Every month"]]:
		var listed := _effect_list(plan.get(part[0], []), owner)
		if listed.is_empty():
			continue
		var block := VBoxContainer.new()
		block.add_theme_constant_override("separation", 2)
		block.add_child(_small_label(I18n.ui(str(part[1]))))
		var text := UI.wrapped(listed, 11, Color(1, 1, 1, 0.72))
		text.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
		block.add_child(text)
		column.add_child(block)
	return _spaced(column, 8)


func _milestones(plan: Dictionary) -> Control:
	var list: Array = plan.get("milestones", [])
	if list.is_empty():
		return null
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 3)
	column.add_child(_small_label(I18n.ui("Checkpoints")))
	var rows := VBoxContainer.new()
	rows.add_theme_constant_override("separation", 2)
	for entry in list:
		var milestone: Dictionary = entry
		var reached := bool(milestone.get("reached", false))
		var missed := bool(milestone.get("missed", false))
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 6)
		var mark := UI.label("✓" if reached else ("✕" if missed else "○"), 11, UI.ACCENT if reached else (Color("#f87171") if missed else Color(1, 1, 1, 0.35)))
		mark.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
		row.add_child(mark)
		var title := UI.wrapped(str(milestone.get("title", "")), 11, Color(1, 1, 1, 0.8) if reached else Color(1, 1, 1, 0.55))
		title.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
		title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(title)
		var when := ""
		if reached:
			when = str(milestone.get("reachedAt", ""))
			if when.is_empty():
				when = I18n.ui("Reached")
		elif missed:
			when = I18n.ui("Missed")
		else:
			when = "%d%%" % int(milestone.get("atProgress", 0))
		var right := UI.label(when, 11, Color(1, 1, 1, 0.4))
		right.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
		row.add_child(right)
		rows.add_child(row)
	column.add_child(rows)
	return _spaced(column, 8)


func _card(card: Dictionary) -> Control:
	var id := str(card.get("id", ""))
	var title_text := str(card.get("name", ""))
	var kind := str(card.get("kind", "project"))
	var mine := bool(card.get("mine", true))
	var running := bool(card.get("open", true))
	var busy := _pending == id
	var owner_label := str(card.get("ownerLabel", ""))
	var status := str(card.get("status", "active"))
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", _style(UiTheme.pick("surface", Color(1, 1, 1, 0.05)), Color(1, 1, 1, 0.08), 12, Vector4(13, 11, 13, 11)))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	var top := HBoxContainer.new()
	top.add_theme_constant_override("separation", 6)
	var kind_glyph := UI.label("⚔" if kind == "operation" else "🔬", 13, UI.WHITE)
	kind_glyph.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	top.add_child(kind_glyph)
	var title := UI.wrapped(title_text, 14, UI.WHITE, 700)
	title.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
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
	var tone: Array = STATUS_TONES.get("running" if bool(card.get("running", false)) else status, STATUS_TONES["active"])
	var tone_label := str(tone[0])
	if status == "stalled" and STALL_REASONS.has(str(card.get("stallReason", ""))):
		tone_label = str(STALL_REASONS[str(card.get("stallReason", ""))])
	var pill := _pill(I18n.ui(tone_label), tone[1], tone[2])
	pill.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	top.add_child(pill)
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
			var tag_label := UI.label(str(tag), 10, Color(1, 1, 1, 0.5))
			tag_label.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
			chip.add_child(tag_label)
			tag_row.add_child(chip)
		column.add_child(_spaced(tag_row, 7))
	if not bool(card.get("planning", false)):
		var timing := VBoxContainer.new()
		timing.add_theme_constant_override("separation", 4)
		var timing_row := HBoxContainer.new()
		timing_row.add_theme_constant_override("separation", 8)
		var timeline := UI.label(_finish_line(card), 11, Color(1, 1, 1, 0.5))
		timeline.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		timeline.clip_text = true
		timing_row.add_child(timeline)
		var percent := UI.label("%d%%" % int(card.get("progress", 0)), 11, Color(1, 1, 1, 0.5))
		percent.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
		timing_row.add_child(percent)
		timing.add_child(timing_row)
		var bar := ProjectsProgressLine.new()
		bar.value = float(card.get("progress", 0))
		bar.fill = _progress_color(card)
		timing.add_child(bar)
		column.add_child(_spaced(timing, 9))
	var plan: Variant = card.get("plan")
	var has_plan := typeof(plan) == TYPE_DICTIONARY
	var mode := str(card.get("fundingMode", "gdp-proxy"))
	var spent := str(card.get("spent", ""))
	if has_plan and mode == "nonmonetary":
		column.add_child(_spaced(UI.wrapped(I18n.ui("Time and effort only; no financial payments recorded"), 11, Color(1, 1, 1, 0.6)), 7))
	elif has_plan and (running or not spent.is_empty()):
		var costs := HFlowContainer.new()
		costs.add_theme_constant_override("h_separation", 8)
		costs.add_theme_constant_override("v_separation", 4)
		if running:
			costs.add_child(_cost_label(I18n.ui("Planned cost: {{amount}} per month", {"amount": str(card.get("plannedCost", "0"))})))
		if not spent.is_empty():
			costs.add_child(_cost_label(I18n.ui("Actually paid to date: {{amount}}", {"amount": spent})))
		if bool(card.get("underfunded", false)):
			costs.add_child(_pill(I18n.ui("Underfunded"), AMBER, Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.14), I18n.ui("Received {{share}}% of planned funding last period", {"share": int(card.get("paidShare", 0))})))
		column.add_child(_spaced(costs, 7))
	if has_plan:
		column.add_child(_plan_facts(plan, str(card.get("ownerKey", "")), true))
		var checkpoints := _milestones(plan)
		if checkpoints != null:
			column.add_child(checkpoints)
	var last_update := str(card.get("lastUpdate", ""))
	if not last_update.is_empty():
		var update := UI.wrapped(last_update, 11, Color(1, 1, 1, 0.5))
		update.add_theme_font_override("font", _italic(400))
		column.add_child(_spaced(update, 6))
	var actions := HFlowContainer.new()
	actions.add_theme_constant_override("h_separation", 6)
	actions.add_theme_constant_override("v_separation", 6)
	var brief := _brief_prompt(kind, title_text) if mine else _foreign_prompt(kind, title_text, owner_label)
	actions.add_child(_advisor_button(_ghost("🧭 Ask advisor" if mine else "🧭 What do we know?"), brief))
	if not mine and running:
		actions.add_child(_advisor_button(_ghost("⚖ Our options"), I18n.ui(COUNTER_OWNER if not owner_label.is_empty() else COUNTER, {"name": title_text, "owner": owner_label})))
	if bool(card.get("hasFocus", false)):
		var locate := _ghost("📍 Show on map")
		locate.pressed.connect(_locate.bind(id))
		actions.add_child(locate)
	var event_count := int(card.get("eventCount", 0))
	if event_count > 0:
		var expanded := bool(card.get("expanded", false))
		var activity := _ghost("%s Activity (%d)" % ["▾" if expanded else "▸", event_count])
		activity.pressed.connect(_toggle_expand.bind(id))
		actions.add_child(activity)
	column.add_child(_spaced(actions, 10))
	if running and mine:
		column.add_child(_ruled(_levers(card, id, busy)))
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
			date_label.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
			date_label.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
			row.add_child(date_label)
			var item_title := UI.wrapped(str(item.get("title", "")), 11, Color(1, 1, 1, 0.65))
			item_title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			row.add_child(item_title)
			feed.add_child(row)
		column.add_child(_ruled(feed, 8))
	panel.add_child(column)
	return panel


func _cost_label(text: String) -> Label:
	var line := UI.label(text, 11, Color(1, 1, 1, 0.65))
	line.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	return line


func _levers(card: Dictionary, id: String, busy: bool) -> Control:
	var levers := HFlowContainer.new()
	levers.add_theme_constant_override("h_separation", 6)
	levers.add_theme_constant_override("v_separation", 6)
	if bool(card.get("planning", false)):
		var planning := _planning_id == id
		var plan := _accent(I18n.ui("Planning…") if planning else I18n.ui("Plan it"))
		_dim(plan, busy or planning)
		plan.pressed.connect(_plan_entry.bind(id))
		levers.add_child(plan)
	else:
		var switch := HBoxContainer.new()
		switch.add_theme_constant_override("separation", 2)
		var funding := str(card.get("funding", "normal"))
		for option in FUNDING_OPTIONS:
			var key := str(option[0])
			var active := funding == key
			var pad := Vector4(8, 4, 8, 4)
			var look := _style(ACCENT_SOFT if active else GHOST_BG, ACCENT_EDGE if active else Color(1, 1, 1, 0.12), 8, pad)
			var segment := _styled_button(I18n.ui(str(option[1])), 11, 600, UI.ACCENT if active else Color(1, 1, 1, 0.55), look, look)
			segment.custom_minimum_size.y = 26
			segment.tooltip_text = I18n.ui(str(option[2]))
			segment.set_meta("funding", key)
			_dim(segment, busy)
			segment.pressed.connect(_set_funding.bind(id, funding, key))
			switch.add_child(segment)
		levers.add_child(switch)
	levers.add_child(UI.spacer())
	var visibility := HBoxContainer.new()
	visibility.add_theme_constant_override("separation", 5)
	var caption := UI.label(I18n.ui("Visibility"), 11, Color(1, 1, 1, 0.7))
	caption.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	visibility.add_child(caption)
	var options: Array = []
	for entry in VISIBILITY:
		options.append([entry[0], I18n.ui(str(entry[1]))])
	var current := str(card.get("secrecy", ""))
	if current.is_empty():
		current = "public"
	var pick := _select(options, current, 11, Vector4(6, 4, 6, 4))
	pick.tooltip_text = I18n.ui("Project visibility")
	pick.disabled = busy
	pick.item_selected.connect(_on_secrecy_selected.bind(pick, id, current))
	visibility.add_child(pick)
	levers.add_child(visibility)
	levers.add_child(UI.spacer())
	var abandon := _ghost("Abandon")
	_style_abandon(abandon, _confirm_id == id)
	_dim(abandon, busy)
	abandon.pressed.connect(_press_abandon.bind(id, abandon))
	if _confirm_id == id:
		_confirm_button = abandon
	levers.add_child(abandon)
	return levers


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
	frame.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.08), Color(1, 1, 1, 0.12), 3, 1))
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
		var initials := UI.label(str(card.get("initials", "??")), 8, Color(1, 1, 1, 0.7), 800)
		initials.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
		initials.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		initials.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		frame.add_child(initials)
	row.add_child(frame)
	var owner_name := UI.label(label, 11, Color(1, 1, 1, 0.55) if mine else ORANGE_INK)
	owner_name.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	owner_name.clip_text = true
	owner_name.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	owner_name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	owner_name.tooltip_text = label
	owner_name.mouse_filter = Control.MOUSE_FILTER_PASS
	owner_name.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(owner_name)
	return row


func _brief_prompt(kind: String, name_text: String) -> String:
	return I18n.ui(BRIEF_OWN % ("operation" if kind == "operation" else "project"), {"name": name_text})


func _foreign_prompt(kind: String, name_text: String, owner: String) -> String:
	var noun := "operation" if kind == "operation" else "programme"
	return I18n.ui((BRIEF_FOREIGN_OWNER if not owner.is_empty() else BRIEF_FOREIGN) % noun, {"name": name_text, "owner": owner})


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
		if UI.phone():
			_confirm_turn += 1
			_lapse_abandon(_confirm_turn)
		return
	_confirm_id = ""
	_confirm_button = null
	_run_op(id, "abandon", "")


func _lapse_abandon(turn: int) -> void:
	await get_tree().create_timer(4.0).timeout
	if turn != _confirm_turn or _confirm_id.is_empty():
		return
	_confirm_id = ""
	if is_instance_valid(_confirm_button):
		_style_abandon(_confirm_button, false)
	_confirm_button = null


func _set_funding(id: String, current: String, funding: String) -> void:
	if current == funding:
		return
	_run_op(id, "funding", funding)


func _on_secrecy_selected(index: int, pick: OptionButton, id: String, current: String) -> void:
	var chosen := str(pick.get_item_metadata(index))
	if chosen == current:
		return
	_run_op(id, "secrecy", chosen)


func _toggle_expand(id: String) -> void:
	_expanded = "" if _expanded == id else id
	_request_view()


func _run_op(id: String, op: String, value: String) -> void:
	if engine == null:
		return
	_pending = id
	_render_cards()
	_seq += 1
	var mine := _seq
	var reply: Dictionary = await engine.request("projects.op", {"projectId": id, "op": op, "value": value, "view": _args()})
	_pending = ""
	if mine == _seq and reply.get("ok", false) and typeof(reply.get("result")) == TYPE_DICTIONARY:
		var result: Dictionary = reply["result"]
		var error := str(result.get("error", ""))
		if not error.is_empty():
			_plan_error = error
		_apply(result)
		_render_cards()
	else:
		_render_cards()
		_request_view(false, true)


func _plan_entry(id: String) -> void:
	if engine == null or not _planning_id.is_empty():
		return
	_planning_id = id
	_plan_error = ""
	_render_cards()
	_seq += 1
	var mine := _seq
	var reply: Dictionary = await engine.request("projects.planEntry", {"projectId": id, "view": _args()})
	_planning_id = ""
	if reply.get("ok", false) and typeof(reply.get("result")) == TYPE_DICTIONARY:
		var result: Dictionary = reply["result"]
		_plan_error = str(result.get("error", ""))
		if mine == _seq:
			_apply(result)
	else:
		_plan_error = I18n.ui("The plan could not be made.")
	_render_cards()


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
	_menu.add_theme_stylebox_override("panel", UI.box(UiTheme.pick("surface", Color("#1b1b1e")), Color(1, 1, 1, 0.14), 10, 1))
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
	_menu_search.set_meta("oh_tap_exempt", true)
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
	_menu_search.text_changed.connect(_on_menu_search_changed)
	_menu_search.gui_input.connect(_on_menu_search_input)
	head_row.add_child(_menu_search)
	head_row.add_child(UI.spacer())
	_menu_clear = _ghost("Clear selection")
	_menu_clear.pressed.connect(_on_menu_clear)
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


func _on_menu_search_changed(text: String) -> void:
	_menu_needle = text
	_fill_menu()


func _on_menu_search_input(event: InputEvent) -> void:
	if event is InputEventKey:
		var key := event as InputEventKey
		if key.pressed and key.keycode == KEY_DOWN and not _menu_rows.is_empty():
			_menu_search.accept_event()
			_menu_rows[0].grab_focus()


func _on_menu_clear() -> void:
	if _tags.is_empty():
		return
	_tags = []
	_after_tags_changed()


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
	if not _menu_open or UI.phone():
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
	var row := ProjectsTagRow.new()
	row.normal = UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 7, 0, Vector4(7, 5, 7, 5))
	row.lit = UI.box(Color(1, 1, 1, 0.07), Color(0, 0, 0, 0), 7, 0, Vector4(7, 5, 7, 5))
	row.add_theme_stylebox_override("panel", row.normal)
	row.set_meta("tag", tag)
	row.focus_mode = Control.FOCUS_ALL
	row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.custom_minimum_size.x = TAG_COLUMN
	row.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	row.gui_input.connect(_on_tag_key.bind(row, tag))
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
	text.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	text.autowrap_mode = TextServer.AUTOWRAP_ARBITRARY
	text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	line.add_child(text)
	row.add_child(line)
	return row


func _on_tag_key(event: InputEvent, row: Control, tag: String) -> void:
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
	var limit := minf(288.0, maxf(176.0, _height() - 224.0)) if UI.phone() else minf(288.0, _height() - 192.0)
	var content := _menu_grid.get_combined_minimum_size().y + 10.0
	_menu_scroll.custom_minimum_size.y = minf(content, maxf(limit - 39.0, 40.0))
	_menu.size = Vector2(width, 0)
	_menu.reset_size()
	_menu.size.x = width
	_menu.global_position = _chips.global_position + Vector2(0, _chips.size.y + 5.0)


class ProjectsTagRow extends PanelContainer:
	var normal: StyleBoxFlat
	var lit: StyleBoxFlat

	func _init() -> void:
		mouse_entered.connect(_paint)
		mouse_exited.connect(_paint)
		focus_entered.connect(_paint)
		focus_exited.connect(_paint)

	func _paint() -> void:
		var hovered := get_global_rect().has_point(get_global_mouse_position())
		add_theme_stylebox_override("panel", lit if hovered or has_focus() else normal)


class ProjectsProgressLine extends Control:
	var value := 0.0
	var fill := UI.ACCENT

	func _init() -> void:
		custom_minimum_size.y = 6
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func _draw() -> void:
		var track := StyleBoxFlat.new()
		track.bg_color = Color(1, 1, 1, 0.1)
		track.set_corner_radius_all(3)
		track.anti_aliasing = true
		draw_style_box(track, Rect2(Vector2.ZERO, size))
		var share := clampf(value, 0.0, 100.0) / 100.0
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
