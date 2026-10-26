class_name IntelligenceView
extends VBoxContainer

signal refreshed

const SECTIONS := [["overview", "Overview"], ["countries", "Countries"], ["operations", "Operations"], ["reports", "Reports"]]
const OPERATION_PLACEHOLDERS := {
	"sabotage": "What to sabotage, e.g. the naval yards at Kiel",
	"recruit": "Whom to recruit, e.g. a senior rocket engineer",
	"assassinate": "Who is the target",
	"operation": "What the agent should do",
}
const MOBILE_WIDTH := 700.0
const PANEL_BG := Color(1, 1, 1, 0.025)
const PANEL_BORDER := Color(1, 1, 1, 0.08)
const GREY_TEXT := Color("#e7e7ea")
const GREY_RAISED := Color("#232327")
const GREY_SELECTED := Color("#0e0e10")
const GREY_BORDER := Color(1, 1, 1, 0.1)
const GREY_BORDER_STRONG := Color(1, 1, 1, 0.22)
const RED_TEXT := Color("#fca5a5")
const GREEN_TEXT := Color("#86efac")
const AMBER_TEXT := Color("#fde68a")
const GREEN_DOT := Color("#4ade80")
const ZINC := Color("#e4e4e7")
const BLUE := Color("#3b82f6")
const BLUE_HOVER := Color("#2563eb")
const GLYPHS := {
	"back": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><path d='M19 12H5M12 5l-7 7 7 7'/></svg>",
	"search": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='11' cy='11' r='8'/><path d='m21 21-4.35-4.35'/></svg>",
}

static var _glyph_cache := {}
static var _mono: Font
static var _symbols := {}

var engine: EngineLink
var context := {}
var _model := {}
var _section := "overview"
var _selected := ""
var _query := ""
var _expanded_report := ""
var _error := ""
var _intercept := {}
var _choosing := false
var _candidates: Array = []
var _candidates_loading := false
var _pick := ""
var _pick_code := ""
var _pick_flag := ""
var _pick_query := ""
var _story_draft := {}
var _order_draft := {}
var _saved_flash := ""
var _busy := false
var _mounted_for := ""
var _load_error := ""
var _serial := 0
var _was_mobile := false
var _live_waiting := false
var _keep_scroll := {}
var _top: VBoxContainer
var _body: VBoxContainer
var _scroll: ScrollContainer
var _country_list: VBoxContainer
var _overlay: PanelContainer
var _pick_grid: GridContainer
var _pick_scroll: ScrollContainer
var _pick_chosen: HBoxContainer
var _pick_confirm: Button
var _pick_confirm_hovered := false
var _pick_confirm_touched := false


func _init() -> void:
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_theme_constant_override("separation", 0)
	_top = VBoxContainer.new()
	_top.add_theme_constant_override("separation", 0)
	_top.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	add_child(_top)
	_body = VBoxContainer.new()
	_body.add_theme_constant_override("separation", 0)
	_body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(_body)


func _notification(what: int) -> void:
	if what == NOTIFICATION_VISIBILITY_CHANGED and engine != null and is_inside_tree() and is_visible_in_tree():
		_remount()
	elif what == NOTIFICATION_RESIZED and is_inside_tree() and not _model.is_empty():
		var mobile := _mobile()
		if mobile != _was_mobile:
			_render()
	elif what == NOTIFICATION_EXIT_TREE:
		_close_overlay()


func setup(link: EngineLink, ctx: Dictionary = {}) -> void:
	engine = link
	context = ctx
	if engine and not engine.engine_event.is_connected(_on_engine_event):
		engine.engine_event.connect(_on_engine_event)


func _on_engine_event(name: String, _data: Variant) -> void:
	if name == "intelligence.changed" and is_inside_tree() and is_visible_in_tree() and not _model.is_empty():
		_live_refresh()


func _typing() -> bool:
	if not is_inside_tree():
		return false
	var owner := get_viewport().gui_get_focus_owner()
	return owner != null and (owner is LineEdit or owner is TextEdit) and (is_ancestor_of(owner) or (_overlay != null and is_instance_valid(_overlay) and _overlay.is_ancestor_of(owner)))


func _live_refresh() -> void:
	if _live_waiting:
		return
	_live_waiting = true
	while is_inside_tree() and (_typing() or _busy):
		await get_tree().create_timer(0.5).timeout
	_live_waiting = false
	if is_inside_tree() and is_visible_in_tree():
		refresh()


func refresh() -> void:
	if engine == null:
		return
	_serial += 1
	var serial := _serial
	var reply: Dictionary = await engine.request("intelligence.view", {"selected": _selected})
	if serial != _serial:
		await refreshed
		return
	if not reply.get("ok", false):
		_load_error = str(reply.get("error", ""))
		_render()
		refreshed.emit()
		return
	_load_error = ""
	var result: Variant = reply.get("result")
	_model = result if typeof(result) == TYPE_DICTIONARY else {}
	_selected = str(_model.get("selected", _selected))
	var player := str(_model.get("player", ""))
	if player != _mounted_for:
		_mounted_for = player
		engine.request("intelligence.mount")
	_render()
	refreshed.emit()


func show_section(section: String) -> void:
	_section = section
	_intercept = {}
	_render()


func _remount() -> void:
	_section = "overview"
	_selected = ""
	_query = ""
	_expanded_report = ""
	_error = ""
	_intercept = {}
	_story_draft = {}
	_order_draft = {}
	_saved_flash = ""
	_mounted_for = ""
	_keep_scroll = {}
	_close_overlay()
	refresh()


func _mobile() -> bool:
	if not is_inside_tree():
		return false
	return get_viewport().get_visible_rect().size.x <= MOBILE_WIDTH


static func _px(rem: float) -> int:
	return maxi(8, roundi(rem * 16.0))


static func _sp(rem: float) -> int:
	return roundi(rem * 16.0)


static func _text(text: String, rem: float, color: Color, weight := 400) -> Label:
	return UI.label(text, _px(rem), color, weight)


static func _wrap(text: String, rem: float, color: Color, weight := 400, line_height := 1.3) -> Label:
	var node := UI.wrapped(text, _px(rem), color, weight)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.custom_minimum_size.x = 20
	var extra := roundi(float(_px(rem)) * (line_height - 1.15))
	if extra > 0:
		node.add_theme_constant_override("line_spacing", extra)
	return node


static func _clip(text: String, rem: float, color: Color, weight := 400) -> Label:
	var node := UI.label(text, _px(rem), color, weight)
	node.clip_text = true
	node.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.custom_minimum_size.x = 20
	return node


static func _italic(text: String, rem: float, color: Color) -> Label:
	var node := _wrap(text, rem, color)
	var italic := FontVariation.new()
	italic.base_font = UI.font(400)
	italic.variation_transform = Transform2D(Vector2(1, 0), Vector2(0.2, 1), Vector2.ZERO)
	node.add_theme_font_override("font", italic)
	return node


static func _subhead(text: String) -> Label:
	return UI.label(text.to_upper(), _px(0.58), Color(1, 1, 1, 0.37), 800, "Arial", 1)


static func _symbol_font(weight: int) -> Font:
	if _symbols.has(weight):
		return _symbols[weight]
	var symbols := SystemFont.new()
	symbols.font_names = PackedStringArray(["Segoe UI Symbol", "Segoe UI", "DejaVu Sans"])
	symbols.font_weight = weight
	symbols.antialiasing = TextServer.FONT_ANTIALIASING_GRAY
	symbols.hinting = TextServer.HINTING_LIGHT
	var system := SystemFont.new()
	system.font_names = PackedStringArray(["Arial", "Helvetica", "Liberation Sans", "sans-serif"])
	system.font_weight = weight
	system.antialiasing = TextServer.FONT_ANTIALIASING_GRAY
	system.hinting = TextServer.HINTING_LIGHT
	system.fallbacks = [symbols]
	_symbols[weight] = system
	return system


static func _glyph(name: String, size: int, color: Color) -> Texture2D:
	var key := "%s:%d:%s" % [name, size, color.to_html()]
	if _glyph_cache.has(key):
		return _glyph_cache[key]
	var svg: String = str(GLYPHS.get(name, "")).replace("#fff", "#" + color.to_html(false))
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


static func _mono_font() -> Font:
	if _mono:
		return _mono
	var system := SystemFont.new()
	system.font_names = PackedStringArray(["Consolas", "Cascadia Mono", "Courier New", "Segoe UI Symbol", "monospace"])
	system.antialiasing = TextServer.FONT_ANTIALIASING_GRAY
	system.hinting = TextServer.HINTING_LIGHT
	var variation := FontVariation.new()
	variation.base_font = system
	variation.spacing_glyph = 0
	_mono = variation
	return _mono


static func _panel(margin: Vector4, bg := PANEL_BG, border := PANEL_BORDER, radius := 10) -> PanelContainer:
	var holder := PanelContainer.new()
	holder.add_theme_stylebox_override("panel", UI.box(bg, border, radius, 1, margin))
	holder.mouse_filter = Control.MOUSE_FILTER_PASS
	holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return holder


static func _column(separation := 0) -> VBoxContainer:
	var node := VBoxContainer.new()
	node.add_theme_constant_override("separation", separation)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


static func _row(separation := 6) -> HBoxContainer:
	var node := HBoxContainer.new()
	node.add_theme_constant_override("separation", separation)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


static func _gap(height: int) -> Control:
	var node := Control.new()
	node.custom_minimum_size.y = height
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return node


static func _rule(alpha: float) -> ColorRect:
	var rule := ColorRect.new()
	rule.color = Color(1, 1, 1, alpha)
	rule.custom_minimum_size.y = 1
	rule.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return rule


static func _pressable(node: Button) -> void:
	node.button_down.connect(func() -> void:
		node.pivot_offset = node.size * 0.5
		node.scale = Vector2(0.97, 0.97))
	node.button_up.connect(func() -> void: node.scale = Vector2.ONE)


static func _button(text: String, look: Dictionary) -> Button:
	var node := Button.new()
	node.text = text
	node.focus_mode = Control.FOCUS_NONE
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var pad: Vector4 = look.get("pad", Vector4(10, 6, 10, 6))
	var radius: int = look.get("radius", 8)
	var bg: Color = look.get("bg", Color(0, 0, 0, 0))
	var border: Color = look.get("border", Color(0, 0, 0, 0))
	var normal := UI.box(bg, border, radius, 1, pad)
	var hover := UI.box(look.get("hover_bg", bg), look.get("hover_border", border), radius, 1, pad)
	for state: String in ["normal", "focus", "disabled"]:
		node.add_theme_stylebox_override(state, normal)
	for state: String in ["hover", "pressed", "hover_pressed"]:
		node.add_theme_stylebox_override(state, hover)
	node.add_theme_font_override("font", look.get("font", UI.font(int(look.get("weight", 600)))))
	node.add_theme_font_size_override("font_size", _px(float(look.get("size", 0.72))))
	var ink: Color = look.get("ink", UI.WHITE)
	var hover_ink: Color = look.get("hover_ink", ink)
	for name: String in ["font_color", "font_pressed_color", "font_focus_color", "font_disabled_color"]:
		node.add_theme_color_override(name, ink)
	for name: String in ["font_hover_color", "font_hover_pressed_color"]:
		node.add_theme_color_override(name, hover_ink)
	_pressable(node)
	return node


static func _spy_button(text: String, accent: bool) -> Button:
	return _button(text, {
		"bg": Color(1, 1, 1, 0.08 if accent else 0.06),
		"border": Color(1, 1, 1, 0.23 if accent else 0.12),
		"ink": Color("#f4f4f5") if accent else Color(1, 1, 1, 0.8),
		"size": 0.72, "weight": 600, "pad": Vector4(_sp(0.6), _sp(0.35), _sp(0.6), _sp(0.35)), "radius": 8,
	})


static func _set_enabled(button: Button, enabled: bool, faded := 0.45, cursor := Control.CURSOR_ARROW) -> void:
	button.disabled = not enabled
	button.modulate.a = 1.0 if enabled else faded
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if enabled else cursor


static func _input_style(edit: LineEdit, rem := 0.76) -> void:
	var pad := Vector4(_sp(0.6), _sp(0.45), _sp(0.6), _sp(0.45))
	var style := UI.box(Color(0, 0, 0, 0.25), Color(1, 1, 1, 0.12), 8, 1, pad)
	for state: String in ["normal", "focus", "read_only"]:
		edit.add_theme_stylebox_override(state, style)
	edit.add_theme_font_override("font", UI.font(400))
	edit.add_theme_font_size_override("font_size", _px(rem))
	edit.add_theme_color_override("font_color", UI.WHITE)
	edit.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.45))
	edit.add_theme_color_override("caret_color", UI.WHITE)


static func _field(placeholder: String, text := "") -> LineEdit:
	var node := LineEdit.new()
	node.placeholder_text = placeholder
	node.text = text
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.custom_minimum_size.x = 40
	_input_style(node)
	return node


static func _style_popup(select: OptionButton, rem: float) -> void:
	var popup := select.get_popup()
	popup.add_theme_stylebox_override("panel", UI.box(Color("#1f1f23"), Color(1, 1, 1, 0.12), 6, 1, Vector4(4, 4, 4, 4)))
	popup.add_theme_stylebox_override("hover", UI.box(Color(1, 1, 1, 0.1), Color(0, 0, 0, 0), 4))
	popup.add_theme_color_override("font_color", Color("#f4f4f5"))
	popup.add_theme_color_override("font_hover_color", Color("#f4f4f5"))
	popup.add_theme_font_override("font", UI.font(400))
	popup.add_theme_font_size_override("font_size", _px(rem))


static func _select(options: Array, current: String, label := "") -> OptionButton:
	var node := OptionButton.new()
	node.focus_mode = Control.FOCUS_NONE
	node.fit_to_longest_item = true
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	node.tooltip_text = label
	var pad := Vector4(_sp(0.6), _sp(0.45), _sp(0.6) + 14, _sp(0.45))
	var style := UI.box(Color(0, 0, 0, 0.25), Color(1, 1, 1, 0.12), 8, 1, pad)
	for state: String in ["normal", "hover", "pressed", "focus", "hover_pressed", "disabled"]:
		node.add_theme_stylebox_override(state, style)
	node.add_theme_font_override("font", UI.font(400))
	node.add_theme_font_size_override("font_size", _px(0.76))
	for name: String in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		node.add_theme_color_override(name, UI.WHITE)
	for option: Variant in options:
		var entry: Dictionary = option
		node.add_item(str(entry.get("label", "")))
		node.set_item_metadata(node.item_count - 1, str(entry.get("value", "")))
		if str(entry.get("value", "")) == current:
			node.select(node.item_count - 1)
	_style_popup(node, 0.76)
	return node


static func _clickable(normal: StyleBoxFlat, on_press: Callable, hover: StyleBoxFlat = null) -> PanelContainer:
	var holder := PanelContainer.new()
	holder.add_theme_stylebox_override("panel", normal)
	holder.mouse_filter = Control.MOUSE_FILTER_STOP
	holder.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	if hover:
		holder.mouse_entered.connect(func() -> void: holder.add_theme_stylebox_override("panel", hover))
		holder.mouse_exited.connect(func() -> void: holder.add_theme_stylebox_override("panel", normal))
	holder.gui_input.connect(func(event: InputEvent) -> void:
		var click := event as InputEventMouseButton
		if click == null or click.button_index != MOUSE_BUTTON_LEFT:
			return
		holder.pivot_offset = holder.size * 0.5
		if click.pressed:
			holder.scale = Vector2(0.97, 0.97)
		else:
			holder.scale = Vector2.ONE
			if Rect2(Vector2.ZERO, holder.size).has_point(click.position):
				holder.accept_event()
				on_press.call_deferred())
	return holder


static func _dot(color: Color, size: int) -> Control:
	var holder := CenterContainer.new()
	holder.mouse_filter = Control.MOUSE_FILTER_PASS
	var dot := Panel.new()
	dot.custom_minimum_size = Vector2(size, size)
	dot.add_theme_stylebox_override("panel", UI.box(color, Color(0, 0, 0, 0), 999))
	dot.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.add_child(dot)
	return holder


static func _flag_rect(path: String, box: Vector2) -> Control:
	var texture: Texture2D = null
	if not path.is_empty():
		texture = UI.flag(path, int(ceil(box.y * 2.0)))
	if texture == null:
		var blank := UI.label("🏳", maxi(8, int(box.y * 0.9)), UI.WHITE)
		blank.custom_minimum_size = box
		blank.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		blank.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		return blank
	var frame := PanelContainer.new()
	frame.custom_minimum_size = box
	frame.clip_contents = true
	frame.mouse_filter = Control.MOUSE_FILTER_IGNORE
	frame.add_theme_stylebox_override("panel", StyleBoxEmpty.new())
	var rect := TextureRect.new()
	rect.texture = texture
	rect.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	rect.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	frame.add_child(rect)
	var ring := Panel.new()
	ring.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var ring_style := UI.box(Color(0, 0, 0, 0), Color(1, 1, 1, 0.12), 2, 1)
	ring_style.draw_center = false
	ring.add_theme_stylebox_override("panel", ring_style)
	frame.add_child(ring)
	return frame


static func _escape(text: String) -> String:
	return text.replace("[", "[lb]")


static func _rich(rem: float, color: Color, line_height := 1.45) -> RichTextLabel:
	var label := RichTextLabel.new()
	label.bbcode_enabled = true
	label.fit_content = true
	label.scroll_active = false
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	label.add_theme_font_override("normal_font", UI.font(400))
	label.add_theme_font_override("bold_font", UI.font(700))
	label.add_theme_font_size_override("normal_font_size", _px(rem))
	label.add_theme_font_size_override("bold_font_size", _px(rem))
	label.add_theme_color_override("default_color", color)
	label.add_theme_constant_override("line_separation", roundi(float(_px(rem)) * (line_height - 1.15)))
	return label


static func _style_scroll(scroll: ScrollContainer) -> void:
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_SHOW_NEVER


func _tone_colors(tone: String) -> Array:
	if tone == "green":
		return [Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.09), Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.25), GREEN_TEXT]
	if tone == "amber":
		return [Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.09), Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.25), AMBER_TEXT]
	return [Color(1, 1, 1, 0.035), Color(1, 1, 1, 0.09), Color(1, 1, 1, 0.86)]


func _stat_card(label: String, value: String, hint := "", tone := "neutral") -> Control:
	var colors := _tone_colors(tone)
	var card := _panel(Vector4(_sp(0.8), _sp(0.7), _sp(0.8), _sp(0.7)), colors[0], colors[1], 10)
	var column := _column(0)
	column.add_child(UI.label(label.to_upper(), _px(0.58), Color(1, 1, 1, 0.38), 750, "Arial", 1))
	column.add_child(_gap(_sp(0.22)))
	column.add_child(_clip(value, 0.9, colors[2], 800))
	if not hint.is_empty():
		column.add_child(_gap(_sp(0.2)))
		column.add_child(_wrap(hint, 0.6, Color(1, 1, 1, 0.34), 400, 1.35))
	card.add_child(column)
	return card


func _grid(columns: int, h_gap: int, v_gap: int) -> GridContainer:
	var grid := GridContainer.new()
	grid.columns = columns
	grid.add_theme_constant_override("h_separation", h_gap)
	grid.add_theme_constant_override("v_separation", v_gap)
	grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return grid


func _clear(node: Node) -> void:
	for child in node.get_children():
		node.remove_child(child)
		child.queue_free()


func _scroll_area(padding: Vector4, separation: int) -> VBoxContainer:
	_scroll = ScrollContainer.new()
	_scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_style_scroll(_scroll)
	var margin := MarginContainer.new()
	margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	margin.add_theme_constant_override("margin_left", int(padding.x))
	margin.add_theme_constant_override("margin_top", int(padding.y))
	margin.add_theme_constant_override("margin_right", int(padding.z))
	margin.add_theme_constant_override("margin_bottom", int(padding.w))
	var column := _column(separation)
	margin.add_child(column)
	_scroll.add_child(margin)
	_body.add_child(_scroll)
	return column


func _render() -> void:
	var key := _section
	if _scroll and is_instance_valid(_scroll) and _intercept.is_empty():
		_keep_scroll[key] = _scroll.scroll_vertical
	_was_mobile = _mobile()
	_clear(_top)
	_clear(_body)
	_scroll = null
	_country_list = null
	if _model.is_empty():
		if not _load_error.is_empty():
			var holder := _scroll_area(Vector4(16, 13, 16, 13), 0)
			holder.add_child(_wrap(_load_error, 0.66, RED_TEXT))
		return
	if not _intercept.is_empty():
		_render_intercept()
		return
	_render_nav()
	match _section:
		"countries":
			_render_countries()
		"operations":
			_render_operations()
		"reports":
			_render_reports()
		_:
			_render_overview()
	if _choosing and (_overlay == null or not is_instance_valid(_overlay)):
		_render_picker()
	if _scroll:
		_restore_scroll.call_deferred(_scroll, int(_keep_scroll.get(key, 0)))


func _restore_scroll(scroll: ScrollContainer, value: int) -> void:
	if not is_instance_valid(scroll) or value <= 0:
		return
	await get_tree().process_frame
	if is_instance_valid(scroll):
		scroll.scroll_vertical = value


func _render_nav() -> void:
	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", _sp(1.0))
	margin.add_theme_constant_override("margin_right", _sp(1.0))
	margin.add_theme_constant_override("margin_top", _sp(0.65))
	margin.add_theme_constant_override("margin_bottom", _sp(0.55))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", _sp(0.35))
	var horizontal := _sp(0.5) if _mobile() else _sp(0.75)
	for entry: Array in SECTIONS:
		var key: String = entry[0]
		var active := key == _section
		var tab := Button.new()
		tab.text = entry[1]
		tab.focus_mode = Control.FOCUS_NONE
		tab.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		var style := StyleBoxFlat.new()
		style.bg_color = Color(0, 0, 0, 0)
		style.border_width_bottom = 2
		style.border_color = Color(231 / 255.0, 231 / 255.0, 234 / 255.0, 0.72) if active else Color(0, 0, 0, 0)
		style.content_margin_left = horizontal
		style.content_margin_right = horizontal
		style.content_margin_top = _sp(0.35)
		style.content_margin_bottom = _sp(0.35)
		for state: String in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
			tab.add_theme_stylebox_override(state, style)
		tab.add_theme_font_override("font", UI.font(750))
		tab.add_theme_font_size_override("font_size", _px(0.72))
		var ink := UI.WHITE if active else Color(1, 1, 1, 0.46)
		for name: String in ["font_color", "font_focus_color", "font_pressed_color", "font_hover_color", "font_hover_pressed_color"]:
			tab.add_theme_color_override(name, ink)
		_pressable(tab)
		tab.pressed.connect(func() -> void: show_section(key))
		row.add_child(tab)
	margin.add_child(row)
	_top.add_child(margin)
	_top.add_child(_rule(0.06))


func _render_overview() -> void:
	var column := _scroll_area(Vector4(_sp(1.0), _sp(0.8), _sp(1.0), _sp(0.8)), _sp(0.75))
	var mobile := _mobile()
	var stats := _grid(2 if mobile else 4, _sp(0.55), _sp(0.55))
	var alerts := int(_model.get("counterintelAlerts", 0))
	for card: Control in [
		_stat_card("Service capability", str(_model.get("capability", "")), "National intelligence capability", "neutral"),
		_stat_card("Active networks", str(int(_model.get("activeNetworks", 0))), str(_model.get("slotsHint", "")), "green"),
		_stat_card("Current reports", str(int(_model.get("currentReports", 0))), "Latest political assessments retained"),
		_stat_card("Counterintel alerts", str(alerts), "Detected or turned foreign agents", "amber" if alerts > 0 else "neutral"),
	]:
		card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		card.size_flags_vertical = Control.SIZE_FILL
		stats.add_child(card)
	column.add_child(stats)
	var panels := _grid(1 if mobile else 2, _sp(0.65), _sp(0.65))
	var warnings_panel := _panel(Vector4(_sp(0.8), _sp(0.7), _sp(0.8), _sp(0.7)))
	warnings_panel.size_flags_vertical = Control.SIZE_FILL
	var warnings_column := _column(0)
	warnings_column.add_child(_text("Strategic warnings", 0.75, UI.WHITE, 750))
	warnings_column.add_child(_gap(_sp(0.55)))
	var warning_list := _column(_sp(0.3))
	var warnings: Array = _model.get("warnings", [])
	if warnings.is_empty():
		warning_list.add_child(_wrap("No immediate intelligence warnings. This does not imply the absence of undiscovered activity.", 0.65, Color(1, 1, 1, 0.34)))
	for warning: Variant in warnings:
		warning_list.add_child(_wrap("• " + str(warning), 0.65, Color(1, 1, 1, 0.52), 400, 1.45))
	warnings_column.add_child(warning_list)
	warnings_panel.add_child(warnings_column)
	panels.add_child(warnings_panel)
	var recent_panel := _panel(Vector4(_sp(0.8), _sp(0.7), _sp(0.8), _sp(0.7)))
	recent_panel.size_flags_vertical = Control.SIZE_FILL
	var recent_column := _column(0)
	recent_column.add_child(_text("Recent intelligence", 0.75, UI.WHITE, 750))
	recent_column.add_child(_gap(_sp(0.45)))
	var recent_list := _column(_sp(0.38))
	var recent: Array = _model.get("recent", [])
	if recent.is_empty():
		recent_list.add_child(_wrap("No private reporting has been collected yet. Deploy a network to begin receiving intelligence.", 0.65, Color(1, 1, 1, 0.34)))
	for entry: Variant in recent:
		var item: Dictionary = entry
		var style := UI.box(Color(1, 1, 1, 0.02), Color(1, 1, 1, 0.06), 7, 1, Vector4(_sp(0.5), _sp(0.42), _sp(0.5), _sp(0.42)))
		var row := _clickable(style, func() -> void: _open_recent(item))
		var item_column := _column(_sp(0.15))
		var top := _row(_sp(0.45))
		top.add_child(_clip(str(item.get("title", "")), 0.65, UI.WHITE, 700))
		var meta := str(item.get("meta", ""))
		if not meta.is_empty():
			var meta_label := _text(meta, 0.55, Color(1, 1, 1, 0.3))
			meta_label.size_flags_vertical = Control.SIZE_SHRINK_END
			top.add_child(meta_label)
		item_column.add_child(top)
		item_column.add_child(_clip(str(item.get("text", "")), 0.59, Color(1, 1, 1, 0.4)))
		row.add_child(item_column)
		recent_list.add_child(row)
	recent_column.add_child(recent_list)
	recent_panel.add_child(recent_column)
	panels.add_child(recent_panel)
	for child in panels.get_children():
		(child as Control).size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.add_child(panels)


func _open_recent(item: Dictionary) -> void:
	var kind := str(item.get("kind", ""))
	if kind == "intercept":
		_open_intercept(item, false)
	elif kind == "assessment":
		_selected = str(item.get("target", ""))
		_section = "countries"
		_render()
		refresh()
	elif kind == "operation":
		show_section("operations")
	else:
		_expanded_report = str(item.get("reportId", ""))
		show_section("reports")


func _render_countries() -> void:
	var mobile := _mobile()
	var padding := _sp(0.65)
	var margin := MarginContainer.new()
	margin.size_flags_vertical = Control.SIZE_EXPAND_FILL
	margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for side: String in ["margin_left", "margin_right", "margin_top", "margin_bottom"]:
		margin.add_theme_constant_override(side, padding)
	var layout: BoxContainer = VBoxContainer.new() if mobile else HBoxContainer.new()
	layout.add_theme_constant_override("separation", _sp(0.65))
	layout.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var list_panel := _panel(Vector4(_sp(0.55), _sp(0.55), _sp(0.55), _sp(0.55)))
	list_panel.size_flags_vertical = Control.SIZE_EXPAND_FILL if not mobile else Control.SIZE_FILL
	if mobile:
		list_panel.custom_minimum_size.y = _sp(14.0)
	else:
		list_panel.size_flags_stretch_ratio = 0.95
		list_panel.custom_minimum_size.x = _sp(16.0)
	var list_column := _column(0)
	list_column.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var search := _field("Search countries", _query)
	search.text_changed.connect(func(text: String) -> void:
		_query = text
		_fill_country_list())
	list_column.add_child(search)
	list_column.add_child(_gap(_sp(0.45)))
	var list_scroll := ScrollContainer.new()
	_style_scroll(list_scroll)
	list_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	list_scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_country_list = _column(_sp(0.25))
	list_scroll.add_child(_country_list)
	list_column.add_child(list_scroll)
	list_panel.add_child(list_column)
	layout.add_child(list_panel)
	var dossier_panel := _panel(Vector4(0, 0, 0, 0))
	dossier_panel.size_flags_vertical = Control.SIZE_EXPAND_FILL
	if not mobile:
		dossier_panel.size_flags_stretch_ratio = 1.9
	_scroll = ScrollContainer.new()
	_style_scroll(_scroll)
	var dossier_margin := MarginContainer.new()
	dossier_margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for side: String in ["margin_left", "margin_right", "margin_top", "margin_bottom"]:
		dossier_margin.add_theme_constant_override(side, _sp(0.8))
	dossier_margin.add_child(_dossier())
	_scroll.add_child(dossier_margin)
	dossier_panel.add_child(_scroll)
	layout.add_child(dossier_panel)
	margin.add_child(layout)
	_body.add_child(margin)
	_fill_country_list()


func _fill_country_list() -> void:
	if _country_list == null or not is_instance_valid(_country_list):
		return
	_clear(_country_list)
	var needle := _query.strip_edges().to_lower()
	var countries: Array = _model.get("countries", [])
	var current := _selected
	for entry: Variant in countries:
		var country: Dictionary = entry
		var name := str(country.get("name", ""))
		if not needle.is_empty() and name.to_lower().find(needle) < 0:
			continue
		var active := name.to_lower() == current.to_lower()
		var style := UI.box(GREY_SELECTED if active else Color(0, 0, 0, 0), GREY_BORDER_STRONG if active else Color(0, 0, 0, 0), 7, 1, Vector4(_sp(0.55), _sp(0.48), _sp(0.55), _sp(0.48)))
		var row := _clickable(style, func() -> void:
			_selected = name
			refresh())
		var line := _row(_sp(0.45))
		line.add_child(_clip(name, 0.68, UI.WHITE))
		if bool(country.get("network", false)):
			var dot := _dot(GREEN_DOT, _sp(0.38))
			dot.tooltip_text = "Active intelligence network"
			line.add_child(dot)
		row.add_child(line)
		_country_list.add_child(row)


func _dossier() -> Control:
	var dossier: Dictionary = _model.get("dossier", {})
	var mobile := _mobile()
	var column := _column(0)
	var header := _row(_sp(0.65))
	var flag_frame := PanelContainer.new()
	flag_frame.custom_minimum_size = Vector2(_sp(2.6), _sp(1.75))
	flag_frame.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.1), 5, 1))
	flag_frame.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	flag_frame.clip_contents = true
	flag_frame.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var flag_path := str(dossier.get("flag", ""))
	var texture: Texture2D = null
	if not flag_path.is_empty():
		texture = UI.flag(flag_path, _sp(1.75) * 2)
	if texture:
		var flag := TextureRect.new()
		flag.texture = texture
		flag.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		flag.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
		flag.mouse_filter = Control.MOUSE_FILTER_IGNORE
		flag_frame.add_child(flag)
	else:
		var blank := _text("🏳", 1.0, UI.WHITE)
		blank.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		blank.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		flag_frame.add_child(blank)
	header.add_child(flag_frame)
	var titles := _column(_sp(0.1))
	titles.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	titles.add_child(_clip(str(dossier.get("name", "Unknown polity")), 0.95, UI.WHITE, 800))
	var subtitle := str(dossier.get("subtitle", ""))
	if not subtitle.is_empty():
		titles.add_child(_wrap(subtitle, 0.61, Color(1, 1, 1, 0.38)))
	header.add_child(titles)
	column.add_child(header)
	column.add_child(_gap(_sp(0.75)))
	var grid := _grid(2 if mobile else 4, _sp(0.45), _sp(0.45))
	for card: Control in [
		_stat_card("Network", str(dossier.get("network", ""))),
		_stat_card("Political", str(dossier.get("political", ""))),
		_stat_card("Diplomatic", str(dossier.get("diplomatic", ""))),
		_stat_card("Source", str(dossier.get("source", "")), "", str(dossier.get("sourceTone", "neutral"))),
	]:
		card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		grid.add_child(card)
	column.add_child(grid)
	if bool(dossier.get("knowledgeMissing", false)):
		column.add_child(_gap(_sp(0.55)))
		column.add_child(_wrap("The engine bundle does not export politicalKnowledge.buildPlayerPoliticalKnowledgeView.", 0.62, RED_TEXT))
	column.add_child(_gap(_sp(0.65)))
	column.add_child(_section_panel("Public political picture", _public_picture(dossier.get("publicPicture"))))
	column.add_child(_gap(_sp(0.55)))
	column.add_child(_section_panel("Institutional position", _institution_position(dossier.get("institutions", []))))
	column.add_child(_gap(_sp(0.55)))
	column.add_child(_section_panel("Intelligence assessment", _assessment(dossier.get("assessment"))))
	return column


func _section_panel(title: String, body: Control) -> Control:
	var panel := _panel(Vector4(_sp(0.7), _sp(0.65), _sp(0.7), _sp(0.65)))
	var column := _column(_sp(0.42))
	column.add_child(UI.label(title.to_upper(), _px(0.58), Color(1, 1, 1, 0.37), 800, "Arial", 1))
	column.add_child(body)
	panel.add_child(column)
	return panel


func _public_picture(profile: Variant) -> Control:
	if typeof(profile) != TYPE_DICTIONARY:
		return _wrap("No structured political profile is currently available.", 0.7, Color(1, 1, 1, 0.35))
	var data: Dictionary = profile
	var column := _column(0)
	var descriptors := str(data.get("descriptors", ""))
	if not descriptors.is_empty():
		column.add_child(_wrap(descriptors, 0.68, Color(1, 1, 1, 0.67), 400, 1.5))
	var leader := str(data.get("leader", ""))
	if not leader.is_empty():
		column.add_child(_gap(_sp(0.2)))
		column.add_child(_wrap("Leadership: " + leader, 0.68, Color(1, 1, 1, 0.52), 400, 1.5))
	var head := str(data.get("headOfGovernment", ""))
	if not head.is_empty():
		column.add_child(_wrap("Head of government: " + head, 0.68, Color(1, 1, 1, 0.45), 400, 1.5))
	var goals: Array = data.get("goals", [])
	if not goals.is_empty():
		column.add_child(_gap(_sp(0.35)))
		for goal: Variant in goals:
			column.add_child(_wrap("- " + str(goal), 0.68, Color(1, 1, 1, 0.67), 400, 1.5))
	return column


func _institution_position(rows: Array) -> Control:
	var column := _column(_sp(0.3))
	if rows.is_empty():
		column.add_child(_wrap("No current or publicly known institutional record.", 0.62, Color(1, 1, 1, 0.34)))
		return column
	for entry: Variant in rows:
		var row_data: Dictionary = entry
		var holder := _panel(Vector4(_sp(0.45), _sp(0.38), _sp(0.45), _sp(0.38)), Color(1, 1, 1, 0.025), Color(1, 1, 1, 0.05), 7)
		var line := _row(_sp(0.45))
		line.add_child(_clip(str(row_data.get("name", "")), 0.62, Color(1, 1, 1, 0.68)))
		line.add_child(_text(str(row_data.get("role", "")), 0.53, Color(231 / 255.0, 231 / 255.0, 234 / 255.0, 0.68) if bool(row_data.get("isMember", false)) else Color(1, 1, 1, 0.35)))
		var pending := str(row_data.get("pending", ""))
		if not pending.is_empty():
			line.add_child(_text(pending, 0.49, AMBER_TEXT))
		var history := str(row_data.get("history", ""))
		if not history.is_empty():
			line.add_child(_text(history, 0.49, Color(1, 1, 1, 0.28)))
		holder.add_child(line)
		column.add_child(holder)
	return column


func _assessment(assessment: Variant) -> Control:
	if typeof(assessment) != TYPE_DICTIONARY:
		return _wrap("No private political assessment is available. Only public information is shown.", 0.68, Color(1, 1, 1, 0.34), 400, 1.5)
	var data: Dictionary = assessment
	var column := _column(0)
	var summary := str(data.get("summary", ""))
	if not summary.is_empty():
		column.add_child(_wrap(summary, 0.68, Color(1, 1, 1, 0.66), 400, 1.5))
	var meta := str(data.get("meta", ""))
	if not meta.is_empty():
		column.add_child(_gap(_sp(0.35)))
		column.add_child(_wrap(meta, 0.61, Color(1, 1, 1, 0.42)))
	var findings: Array = data.get("findings", [])
	if not findings.is_empty():
		column.add_child(_gap(_sp(0.4)))
		var list := _column(_sp(0.22))
		for entry: Variant in findings:
			var finding: Dictionary = entry
			var topic := str(finding.get("topic", ""))
			var label := _rich(0.68, Color(1, 1, 1, 0.66), 1.5)
			var body := _escape(str(finding.get("text", "")))
			label.text = ("- [b][color=#ffffffc7]%s: [/color][/b]%s" % [_escape(topic), body]) if not topic.is_empty() else "- " + body
			list.add_child(label)
		column.add_child(list)
	return column


func _render_operations() -> void:
	var column := _scroll_area(Vector4(_sp(0.8), _sp(0.75), _sp(0.8), _sp(0.75)), _sp(0.65))
	var header := _panel(Vector4(_sp(0.7), _sp(0.55), _sp(0.7), _sp(0.55)), Color(1, 1, 1, 0.035), GREY_BORDER, 10)
	var header_row := _row(8)
	var titles := _column(0)
	titles.add_child(_text("Field networks", 0.72, UI.WHITE, 750))
	titles.add_child(_wrap("Persistent HUMINT networks also appear as covert Projects.", 0.58, Color(1, 1, 1, 0.35)))
	header_row.add_child(titles)
	var networks: Array = _model.get("networks", [])
	var count := _text("%d/%d" % [networks.size(), int(_model.get("max", 3))], 0.7, UI.WHITE, 800)
	count.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	header_row.add_child(count)
	header.add_child(header_row)
	column.add_child(header)
	if networks.is_empty():
		var empty := MarginContainer.new()
		for side: String in ["margin_left", "margin_right", "margin_top", "margin_bottom"]:
			empty.add_theme_constant_override(side, _sp(0.25))
		empty.add_child(_wrap("No networks are currently in the field.", 0.68, Color(1, 1, 1, 0.34)))
		column.add_child(empty)
	for entry: Variant in networks:
		column.add_child(_network_card(entry))
	var history: Array = _model.get("history", [])
	if not history.is_empty():
		var history_column := _column(_sp(0.2))
		for line: Variant in history:
			history_column.add_child(_italic(str(line), 0.61, Color(1, 1, 1, 0.34)))
		column.add_child(history_column)
	column.add_child(_spaced(_subhead("Operations log"), _sp(0.15)))
	var log: Array = _model.get("operationLog", [])
	if log.is_empty():
		var empty_log := _panel(Vector4(_sp(0.7), _sp(0.7), _sp(0.7), _sp(0.7)))
		empty_log.add_child(_wrap("No operations have been carried out yet. Give a network an order and it acts during the next time skip.", 0.66, Color(1, 1, 1, 0.34)))
		column.add_child(empty_log)
	for entry: Variant in log:
		var record: Dictionary = entry
		var card := _panel(Vector4(_sp(0.65), _sp(0.5), _sp(0.65), _sp(0.5)))
		var record_column := _column(0)
		var top := _row(_sp(0.5))
		top.add_child(_wrap(str(record.get("title", "")), 0.66, UI.WHITE, 700))
		var date := str(record.get("date", ""))
		if not date.is_empty():
			var date_label := _text(date, 0.55, Color(1, 1, 1, 0.3))
			date_label.size_flags_vertical = Control.SIZE_SHRINK_END
			top.add_child(date_label)
		record_column.add_child(top)
		var instructions := str(record.get("instructions", ""))
		if not instructions.is_empty():
			record_column.add_child(_gap(_sp(0.12)))
			record_column.add_child(_wrap(instructions, 0.6, Color(1, 1, 1, 0.45)))
		var tone := str(record.get("tone", ""))
		var tone_color := GREEN_TEXT if tone == "good" else (RED_TEXT if tone == "bad" else Color(1, 1, 1, 0.55))
		record_column.add_child(_gap(_sp(0.18)))
		record_column.add_child(_wrap(str(record.get("outcome", "")), 0.6, tone_color))
		card.add_child(record_column)
		column.add_child(card)
	column.add_child(_spaced(_subhead("Counterintelligence cases"), _sp(0.15)))
	var cases: Array = _model.get("cases", [])
	if cases.is_empty():
		var empty_cases := _panel(Vector4(_sp(0.7), _sp(0.7), _sp(0.7), _sp(0.7)))
		empty_cases.add_child(_wrap("No detected foreign agents currently require action.", 0.66, Color(1, 1, 1, 0.34)))
		column.add_child(empty_cases)
	for entry: Variant in cases:
		column.add_child(_case_card(entry))
	for line: Variant in _model.get("caughtUnknown", []):
		column.add_child(_italic(str(line), 0.61, Color(1, 1, 1, 0.34)))
	if not _error.is_empty():
		column.add_child(_wrap(_error, 0.66, RED_TEXT))
	var full := bool(_model.get("full", false))
	var deploy := _button("♟ Deploy a network", {
		"bg": GREY_RAISED, "border": GREY_BORDER_STRONG, "ink": GREY_TEXT, "size": 0.72,
		"font": _symbol_font(750), "pad": Vector4(_sp(0.65), _sp(0.65), _sp(0.65), _sp(0.65)), "radius": 8,
	})
	deploy.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	if full:
		_set_enabled(deploy, false, 0.5, Control.CURSOR_FORBIDDEN)
	deploy.pressed.connect(_start_choosing)
	column.add_child(_spaced(deploy, _sp(0.1)))


func _spaced(control: Control, top: int) -> Control:
	if top <= 0:
		return control
	var margin := MarginContainer.new()
	margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	margin.add_theme_constant_override("margin_top", top)
	margin.add_child(control)
	return margin


func _network_card(entry: Variant) -> Control:
	var spy: Dictionary = entry
	var spy_id := str(spy.get("id", ""))
	var card := _panel(Vector4(_sp(0.7), _sp(0.55), _sp(0.7), _sp(0.55)))
	var column := _column(0)
	var top := _row(_sp(0.5))
	var titles := _column(_sp(0.12))
	titles.add_child(_clip(str(spy.get("target", "")), 0.76, UI.WHITE, 750))
	titles.add_child(_wrap(str(spy.get("meta", "")), 0.59, Color(1, 1, 1, 0.4)))
	top.add_child(titles)
	var dossier := _spy_button("Dossier", false)
	dossier.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	dossier.pressed.connect(func() -> void:
		_selected = str(spy.get("target", ""))
		_section = "countries"
		_render()
		refresh())
	top.add_child(dossier)
	var recall := _spy_button("Recall", false)
	recall.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	recall.pressed.connect(func() -> void: _command("intelligence.recall", {"spyId": spy_id}))
	top.add_child(recall)
	column.add_child(top)
	column.add_child(_gap(_sp(0.5)))
	column.add_child(_rule(0.06))
	column.add_child(_gap(_sp(0.5)))
	var orders := _column(_sp(0.42))
	var focus_row := _row(_sp(0.45))
	var focus_label := _text("Collect on", 0.62, Color(1, 1, 1, 0.5))
	focus_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	focus_row.add_child(focus_label)
	var focus := _select(_model.get("foci", []), str(spy.get("focus", "diplomacy")))
	focus.item_selected.connect(func(index: int) -> void:
		_command("intelligence.focus", {"spyId": spy_id, "focus": str(focus.get_item_metadata(index))}))
	focus_row.add_child(focus)
	focus_row.add_child(UI.spacer())
	orders.add_child(focus_row)
	var assets := str(spy.get("assets", ""))
	if not assets.is_empty():
		orders.add_child(_wrap("Recruited sources: " + assets, 0.6, Color(1, 1, 1, 0.45)))
	var mission: Variant = spy.get("mission")
	if typeof(mission) == TYPE_DICTIONARY:
		var order: Dictionary = mission
		var box := _panel(Vector4(_sp(0.5), _sp(0.42), _sp(0.5), _sp(0.42)), Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.07), Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.22), 7)
		var box_row := _row(_sp(0.5))
		var text_column := _column(0)
		var line := _rich(0.62, Color(1, 1, 1, 0.7), 1.45)
		line.text = "[b][color=#fde68a]%s[/color][/b] — %s" % [_escape(str(order.get("label", ""))), _escape(str(order.get("instructions", "")))]
		text_column.add_child(line)
		text_column.add_child(_wrap("Carried out during the next time skip.", 0.62, Color(1, 1, 1, 0.4), 400, 1.45))
		box_row.add_child(text_column)
		var cancel := _spy_button("Cancel order", false)
		cancel.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		cancel.pressed.connect(func() -> void: _command("intelligence.cancelOrder", {"spyId": spy_id}))
		box_row.add_child(cancel)
		box.add_child(box_row)
		orders.add_child(box)
	else:
		var draft: Dictionary = _order_draft.get(spy_id, {})
		var kind := str(draft.get("kind", "sabotage"))
		var text := str(draft.get("text", ""))
		var flow := HFlowContainer.new()
		flow.add_theme_constant_override("h_separation", _sp(0.4))
		flow.add_theme_constant_override("v_separation", _sp(0.4))
		flow.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var kind_select := _select(_model.get("operationKinds", []), kind, "Operation")
		flow.add_child(kind_select)
		var instructions := _field(str(OPERATION_PLACEHOLDERS.get(kind, "")), text)
		instructions.max_length = int(_model.get("instructionsMax", 300))
		instructions.custom_minimum_size.x = _sp(10.0)
		flow.add_child(instructions)
		var give := _spy_button("Give the order", true)
		_set_enabled(give, not text.strip_edges().is_empty())
		flow.add_child(give)
		orders.add_child(flow)
		var odds_row := HFlowContainer.new()
		odds_row.add_theme_constant_override("h_separation", _sp(0.3))
		var odds: Dictionary = spy.get("odds", {})
		odds_row.add_child(_text("Odds of success:", 0.58, Color(1, 1, 1, 0.38)))
		var success_value := _text("", 0.58, Color(1, 1, 1, 0.62), 700)
		odds_row.add_child(success_value)
		odds_row.add_child(_text("·", 0.58, Color(1, 1, 1, 0.38)))
		odds_row.add_child(_text("Risk of capture:", 0.58, Color(1, 1, 1, 0.38)))
		var capture_value := _text("", 0.58, Color(1, 1, 1, 0.62), 700)
		odds_row.add_child(capture_value)
		orders.add_child(odds_row)
		var show_odds := func(which: String) -> void:
			var entry_odds: Dictionary = odds.get(which, {})
			success_value.text = str(entry_odds.get("success", ""))
			capture_value.text = str(entry_odds.get("capture", ""))
		show_odds.call(kind)
		var fit_input := func() -> void:
			var used := kind_select.get_combined_minimum_size().x + give.get_combined_minimum_size().x + 2.0 * _sp(0.4)
			var room := flow.size.x - used
			instructions.custom_minimum_size.x = maxf(float(_sp(10.0)), room - 1.0)
		flow.resized.connect(fit_input)
		kind_select.item_selected.connect(func(index: int) -> void:
			var chosen := str(kind_select.get_item_metadata(index))
			_order_draft[spy_id] = {"kind": chosen, "text": instructions.text}
			instructions.placeholder_text = str(OPERATION_PLACEHOLDERS.get(chosen, ""))
			show_odds.call(chosen)
			fit_input.call_deferred())
		instructions.text_changed.connect(func(value: String) -> void:
			var current: Dictionary = _order_draft.get(spy_id, {})
			_order_draft[spy_id] = {"kind": str(current.get("kind", kind_select.get_item_metadata(kind_select.selected))), "text": value}
			_set_enabled(give, not value.strip_edges().is_empty()))
		instructions.text_submitted.connect(func(value: String) -> void:
			if not value.strip_edges().is_empty():
				_give_order(spy_id))
		give.pressed.connect(func() -> void: _give_order(spy_id))
	column.add_child(orders)
	card.add_child(column)
	return card


func _give_order(spy_id: String) -> void:
	var draft: Dictionary = _order_draft.get(spy_id, {})
	var kind := str(draft.get("kind", "sabotage"))
	if kind.is_empty():
		kind = "sabotage"
	var instructions := str(draft.get("text", "")).strip_edges()
	instructions = instructions.substr(0, int(_model.get("instructionsMax", 300)))
	var ok := await _command("intelligence.order", {"spyId": spy_id, "kind": kind, "instructions": instructions})
	if ok:
		_order_draft[spy_id] = {"kind": kind, "text": ""}
		_render()


func _case_card(entry: Variant) -> Control:
	var spy: Dictionary = entry
	var spy_id := str(spy.get("id", ""))
	var status := str(spy.get("status", ""))
	var card := _panel(Vector4(_sp(0.7), _sp(0.65), _sp(0.7), _sp(0.65)))
	var column := _column(0)
	var top := _row(_sp(0.55))
	var titles := _column(_sp(0.12))
	titles.add_child(_clip(("🕵️ " if status == "discovered" else "🎭 ") + str(spy.get("owner", "")), 0.77, UI.WHITE, 750))
	titles.add_child(_wrap(str(spy.get("line", "")), 0.6, Color(1, 1, 1, 0.4)))
	top.add_child(titles)
	var story_of := func() -> String:
		return str(_story_draft[spy_id]) if _story_draft.has(spy_id) else str(spy.get("coverStory", ""))
	var turn: Button = null
	if status == "discovered":
		var expel := _spy_button("Expel", false)
		expel.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		expel.pressed.connect(func() -> void: _command("intelligence.expel", {"spyId": spy_id}))
		top.add_child(expel)
		turn = _spy_button("Turn & plant story" if not str(story_of.call()).is_empty() else "Turn", true)
		turn.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		turn.pressed.connect(func() -> void: _command("intelligence.turn", {"spyId": spy_id, "story": str(_story_draft.get(spy_id, ""))}))
		top.add_child(turn)
	column.add_child(top)
	if status != "exposed":
		column.add_child(_gap(_sp(0.5)))
		var row := _row(_sp(0.4))
		var input := _field(str(spy.get("placeholder", "")), str(story_of.call()))
		row.add_child(input)
		var save: Button = null
		if status == "turned":
			var just_saved := _saved_flash == spy_id
			save = _spy_button("Saved ✓" if just_saved else "Save", true)
			var unchanged := str(story_of.call()) == str(spy.get("coverStory", ""))
			_set_enabled(save, not (unchanged and not just_saved))
			save.pressed.connect(func() -> void: _save_story(spy_id))
			row.add_child(save)
			input.text_submitted.connect(func(_value: String) -> void: _save_story(spy_id))
		input.text_changed.connect(func(value: String) -> void:
			_story_draft[spy_id] = value
			if turn:
				turn.text = "Turn & plant story" if not value.is_empty() else "Turn"
			if save:
				var flash := _saved_flash == spy_id
				save.text = "Saved ✓" if flash else "Save"
				_set_enabled(save, not (value == str(spy.get("coverStory", "")) and not flash)))
		column.add_child(row)
	card.add_child(column)
	return card


func _save_story(spy_id: String) -> void:
	var args := {"spyId": spy_id}
	if _story_draft.has(spy_id):
		args["story"] = str(_story_draft[spy_id])
	var ok := await _command("intelligence.story", args)
	if not ok:
		return
	_saved_flash = spy_id
	_render()
	await get_tree().create_timer(1.8).timeout
	if _saved_flash == spy_id:
		_saved_flash = ""
		_render()


func _command(method: String, args: Dictionary) -> bool:
	if _busy:
		return false
	_busy = true
	_error = ""
	var reply: Dictionary = await engine.request(method, args)
	_busy = false
	if not reply.get("ok", false):
		_error = str(reply.get("error", ""))
		_render()
		return false
	await refresh()
	return true


func _render_reports() -> void:
	var column := _scroll_area(Vector4(_sp(0.85), _sp(0.75), _sp(0.85), _sp(0.75)), _sp(0.7))
	column.add_child(_subhead("Political assessments"))
	var row_style := UI.box(PANEL_BG, PANEL_BORDER, 10, 1, Vector4(_sp(0.7), _sp(0.6), _sp(0.7), _sp(0.6)))
	var assessments: Array = _model.get("assessments", [])
	if assessments.is_empty():
		column.add_child(_wrap("No private political assessments are currently on file.", 0.65, Color(1, 1, 1, 0.34)))
	for entry: Variant in assessments:
		var item: Dictionary = entry
		var target := str(item.get("target", ""))
		var row := _clickable(row_style, func() -> void:
			_selected = target
			_section = "countries"
			_render()
			refresh())
		var item_column := _column(_sp(0.2))
		var top := _row(_sp(0.5))
		top.add_child(_clip(target, 0.7, UI.WHITE, 700))
		var meta := str(item.get("meta", ""))
		if not meta.is_empty():
			var meta_label := _text(meta, 0.57, Color(1, 1, 1, 0.3))
			meta_label.size_flags_vertical = Control.SIZE_SHRINK_END
			top.add_child(meta_label)
		item_column.add_child(top)
		item_column.add_child(_clip(str(item.get("summary", "")), 0.62, Color(1, 1, 1, 0.47)))
		row.add_child(item_column)
		column.add_child(row)
	column.add_child(_spaced(_subhead("Intercepted traffic"), _sp(0.2)))
	var intercepts: Array = _model.get("intercepts", [])
	if intercepts.is_empty():
		column.add_child(_wrap("No intercepted diplomatic traffic is on file.", 0.65, Color(1, 1, 1, 0.34)))
	for entry: Variant in intercepts:
		var item: Dictionary = entry
		var row := _clickable(UI.box(PANEL_BG, PANEL_BORDER, 10, 1, Vector4(_sp(0.7), _sp(0.58), _sp(0.7), _sp(0.58))), func() -> void:
			_open_intercept(item, true))
		var line := _row(_sp(0.55))
		var icon := _text("📡", 0.9, UI.WHITE)
		icon.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		line.add_child(icon)
		var item_column := _column(_sp(0.1))
		item_column.add_child(_clip(str(item.get("title", "")), 0.69, UI.WHITE, 700))
		item_column.add_child(_clip(str(item.get("sub", "")), 0.59, Color(1, 1, 1, 0.4)))
		line.add_child(item_column)
		row.add_child(line)
		column.add_child(row)
	column.add_child(_spaced(_subhead("Documents on file"), _sp(0.2)))
	var documents: Array = _model.get("documents", [])
	if documents.is_empty():
		column.add_child(_wrap("No readable government documents are currently on file.", 0.65, Color(1, 1, 1, 0.34)))
	for entry: Variant in documents:
		var report: Dictionary = entry
		var report_id := str(report.get("id", ""))
		var open := _expanded_report == report_id
		var row := _clickable(row_style, func() -> void:
			_expanded_report = "" if _expanded_report == report_id else report_id
			_render())
		var item_column := _column(0)
		var top := _row(_sp(0.5))
		top.add_child(_wrap(str(report.get("title", "")), 0.69, UI.WHITE, 700))
		var meta := str(report.get("meta", ""))
		if not meta.is_empty():
			var meta_label := _text(meta, 0.57, Color(1, 1, 1, 0.3))
			meta_label.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
			top.add_child(meta_label)
		item_column.add_child(top)
		item_column.add_child(_gap(_sp(0.15)))
		item_column.add_child(_wrap(str(report.get("line", "")), 0.59, Color(1, 1, 1, 0.4)))
		if open:
			item_column.add_child(_gap(_sp(0.5)))
			item_column.add_child(_rule(0.06))
			item_column.add_child(_gap(_sp(0.45)))
			item_column.add_child(_wrap(str(report.get("body", "")), 0.64, Color(1, 1, 1, 0.62), 400, 1.55))
		row.add_child(item_column)
		column.add_child(row)


func _open_intercept(item: Dictionary, read: bool) -> void:
	_intercept = {
		"target": str(item.get("target", "")),
		"exchangeId": str(item.get("exchangeId", "")),
		"counterpart": str(item.get("counterpart", "")),
		"sub": str(item.get("sub", "")),
		"clarity": float(item.get("clarity", 0.0)),
		"messages": [],
		"loading": true,
	}
	_render()
	var reply: Dictionary = await engine.request("intelligence.intercept", {"target": _intercept["target"], "exchangeId": _intercept["exchangeId"], "read": read})
	if _intercept.is_empty() or str(_intercept.get("exchangeId", "")) != str(item.get("exchangeId", "")):
		return
	if reply.get("ok", false):
		var result: Dictionary = reply.get("result", {})
		for key: String in ["counterpart", "sub", "clarity", "messages"]:
			if result.has(key):
				_intercept[key] = result[key]
	else:
		_intercept["error"] = str(reply.get("error", ""))
	_intercept.erase("loading")
	_render()


func _render_intercept() -> void:
	var header_margin := MarginContainer.new()
	header_margin.add_theme_constant_override("margin_left", _sp(1.0))
	header_margin.add_theme_constant_override("margin_right", _sp(1.0))
	header_margin.add_theme_constant_override("margin_top", _sp(0.85))
	header_margin.add_theme_constant_override("margin_bottom", _sp(0.6))
	var header := _row(_sp(0.6))
	var back := Button.new()
	back.flat = true
	back.focus_mode = Control.FOCUS_NONE
	back.icon = _glyph("back", 14, Color(1, 1, 1, 0.6))
	back.tooltip_text = "Back"
	back.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	back.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var empty := StyleBoxEmpty.new()
	empty.content_margin_left = _sp(0.2)
	empty.content_margin_right = _sp(0.2)
	empty.content_margin_top = _sp(0.2)
	empty.content_margin_bottom = _sp(0.2)
	for state: String in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
		back.add_theme_stylebox_override(state, empty)
	_pressable(back)
	back.pressed.connect(func() -> void:
		_intercept = {}
		_render())
	header.add_child(back)
	var titles := _column(0)
	titles.add_child(_clip("🕵 %s ↔ %s" % [str(_intercept.get("target", "")), str(_intercept.get("counterpart", ""))], 0.9, UI.WHITE, 700))
	titles.add_child(_clip(str(_intercept.get("sub", "")), 0.7, Color(1, 1, 1, 0.5)))
	header.add_child(titles)
	header_margin.add_child(header)
	_top.add_child(header_margin)
	_top.add_child(_rule(0.07))
	var meter_margin := MarginContainer.new()
	meter_margin.add_theme_constant_override("margin_left", _sp(1.0))
	meter_margin.add_theme_constant_override("margin_right", _sp(1.0))
	meter_margin.add_theme_constant_override("margin_top", _sp(0.6))
	meter_margin.add_theme_constant_override("margin_bottom", _sp(0.2))
	var clarity := clampf(float(_intercept.get("clarity", 0.0)), 0.0, 1.0)
	var meter := _column(_sp(0.2))
	meter.tooltip_text = "How much of the intercept your service could decode"
	meter.mouse_filter = Control.MOUSE_FILTER_PASS
	var meter_row := _row(6)
	meter_row.add_child(_text("Signal clarity", 0.68, Color(1, 1, 1, 0.5)))
	meter_row.add_child(UI.spacer())
	meter_row.add_child(_text("%d%%" % roundi(clarity * 100.0), 0.68, ZINC, 700))
	meter.add_child(meter_row)
	var track := Panel.new()
	track.custom_minimum_size.y = _sp(0.3)
	track.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	track.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.08), Color(0, 0, 0, 0), 999))
	track.mouse_filter = Control.MOUSE_FILTER_IGNORE
	track.clip_contents = true
	var fill := Panel.new()
	fill.add_theme_stylebox_override("panel", UI.box(Color(231 / 255.0, 231 / 255.0, 234 / 255.0, 0.7), Color(0, 0, 0, 0), 0))
	fill.mouse_filter = Control.MOUSE_FILTER_IGNORE
	fill.anchor_bottom = 1.0
	fill.anchor_right = clarity
	track.add_child(fill)
	meter.add_child(track)
	meter_margin.add_child(meter)
	_top.add_child(meter_margin)
	var column := _scroll_area(Vector4(_sp(1.0), _sp(0.6), _sp(1.0), _sp(1.0)), _sp(0.55))
	if _intercept.has("error") and not str(_intercept["error"]).is_empty():
		column.add_child(_wrap(str(_intercept["error"]), 0.66, RED_TEXT))
	var width := maxf(200.0, (size.x if size.x > 0.0 else 900.0) - 2.0 * _sp(1.0))
	var messages: Array = _intercept.get("messages", [])
	for entry: Variant in messages:
		var message: Dictionary = entry
		var mine := bool(message.get("mine", false))
		var holder := HBoxContainer.new()
		holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		holder.alignment = BoxContainer.ALIGNMENT_BEGIN if mine else BoxContainer.ALIGNMENT_END
		var bubble_column := VBoxContainer.new()
		bubble_column.add_theme_constant_override("separation", _sp(0.15))
		var speaker := _text(str(message.get("speaker", "")), 0.65, Color(1, 1, 1, 0.45))
		speaker.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT if mine else HORIZONTAL_ALIGNMENT_RIGHT
		bubble_column.add_child(speaker)
		var bubble := PanelContainer.new()
		bubble.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.09 if mine else 0.07), Color(1, 1, 1, 0.08), 12, 1, Vector4(_sp(0.75), _sp(0.55), _sp(0.75), _sp(0.55))))
		bubble.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var body := Label.new()
		body.text = str(message.get("text", ""))
		body.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		body.add_theme_font_override("font", _mono_font())
		body.add_theme_font_size_override("font_size", _px(0.82))
		body.add_theme_color_override("font_color", UI.WHITE)
		body.add_theme_constant_override("line_spacing", roundi(float(_px(0.82)) * 0.3))
		body.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var natural := _mono_font().get_string_size(body.text, HORIZONTAL_ALIGNMENT_LEFT, -1, _px(0.82)).x + 4.0
		var limit := width * 0.88 - 2.0 * _sp(0.75)
		body.custom_minimum_size.x = minf(limit, natural)
		bubble.add_child(body)
		bubble_column.add_child(bubble)
		holder.add_child(bubble_column)
		column.add_child(holder)
	var footer := _italic("Improve your intelligence service to decode more of this exchange.", 0.66, Color(1, 1, 1, 0.35))
	footer.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	column.add_child(_spaced(footer, _sp(0.4)))


func _host_panel() -> Control:
	var host: Variant = context.get("chat_panel")
	if host is PanelContainer and is_instance_valid(host):
		return host
	var node: Node = get_parent()
	while node:
		if node is PanelFrame:
			return node as Control
		node = node.get_parent()
	return null


func _start_choosing() -> void:
	if bool(_model.get("full", false)):
		return
	_choosing = true
	_pick = ""
	_pick_code = ""
	_pick_flag = ""
	_pick_query = ""
	_candidates = []
	_candidates_loading = true
	_render_picker()
	var reply: Dictionary = await engine.request("intelligence.candidates")
	_candidates_loading = false
	if reply.get("ok", false):
		_candidates = reply.get("result", [])
	if _choosing:
		_fill_pick_grid()


func _close_overlay() -> void:
	_choosing = false
	if _overlay and is_instance_valid(_overlay):
		var leaving := _overlay
		_overlay = null
		_pick_grid = null
		_pick_confirm = null
		_pick_chosen = null
		if leaving.is_inside_tree():
			var tween := leaving.create_tween()
			tween.tween_property(leaving, "modulate:a", 0.0, 0.15)
			tween.tween_callback(leaving.queue_free)
		else:
			leaving.queue_free()


func _render_picker() -> void:
	var host := _host_panel()
	var fresh := _overlay == null or not is_instance_valid(_overlay)
	if fresh:
		_overlay = PanelContainer.new()
		var radius := 16
		if host is GlassPanel:
			radius = int((host as GlassPanel).radius)
		_overlay.add_theme_stylebox_override("panel", UI.box(Color(24 / 255.0, 24 / 255.0, 27 / 255.0, 0.98), Color(0, 0, 0, 0), radius))
		_overlay.mouse_filter = Control.MOUSE_FILTER_STOP
		if host:
			host.add_child(_overlay)
		else:
			_body.add_child(_overlay)
			_overlay.size_flags_vertical = Control.SIZE_EXPAND_FILL
		_overlay.modulate.a = 0.0
		_overlay.create_tween().tween_property(_overlay, "modulate:a", 1.0, 0.15)
	else:
		_clear(_overlay)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	var head := MarginContainer.new()
	head.add_theme_constant_override("margin_left", _sp(1.25))
	head.add_theme_constant_override("margin_right", _sp(1.25))
	head.add_theme_constant_override("margin_top", _sp(1.1))
	head.add_theme_constant_override("margin_bottom", _sp(0.6))
	var head_column := _column(0)
	var title_row := _row(8)
	var titles := _column(_sp(0.2))
	titles.add_child(_text("Deploy a Network", 1.05, UI.WHITE, 700))
	titles.add_child(_wrap("Choose a country for a persistent HUMINT network", 0.78, Color(1, 1, 1, 0.4)))
	title_row.add_child(titles)
	var close := _button("✕", {
		"ink": Color(1, 1, 1, 0.5), "hover_ink": UI.WHITE, "hover_bg": Color(1, 1, 1, 0.08),
		"size": 1.1, "weight": 400, "pad": Vector4(_sp(0.3), _sp(0.1), _sp(0.3), _sp(0.1)), "radius": 6,
		"font": _symbol_font(400),
	})
	close.tooltip_text = "Close"
	close.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	close.pressed.connect(_cancel_choosing)
	title_row.add_child(close)
	head_column.add_child(title_row)
	head_column.add_child(_gap(_sp(0.85)))
	var chosen := _panel(Vector4(_sp(0.9), _sp(0.65), _sp(0.9), _sp(0.65)), Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.1), 10)
	var chosen_column := _column(_sp(0.2))
	chosen_column.add_child(_text("Target:", 0.8, Color(1, 1, 1, 0.8), 600))
	_pick_chosen = _row(_sp(0.25))
	chosen_column.add_child(_pick_chosen)
	chosen.add_child(chosen_column)
	head_column.add_child(chosen)
	head_column.add_child(_gap(_sp(0.75)))
	var search_frame := PanelContainer.new()
	var search_normal := UI.box(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.12), 10, 1, Vector4(_sp(0.75), 0, _sp(0.85), 0))
	var search_focus := UI.box(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.25), 10, 1, Vector4(_sp(0.75), 0, _sp(0.85), 0))
	search_frame.add_theme_stylebox_override("panel", search_normal)
	var search_row := _row(_sp(0.45))
	var lens := TextureRect.new()
	lens.texture = _glyph("search", 13, Color(1, 1, 1, 0.35))
	lens.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
	lens.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	lens.mouse_filter = Control.MOUSE_FILTER_IGNORE
	search_row.add_child(lens)
	var search := LineEdit.new()
	search.placeholder_text = "Search countries..."
	search.text = _pick_query
	search.flat = true
	search.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	search.custom_minimum_size.y = _sp(0.55) * 2 + _px(0.82) + 6
	search.add_theme_font_override("font", UI.font(400))
	search.add_theme_font_size_override("font_size", _px(0.82))
	search.add_theme_color_override("font_color", UI.WHITE)
	search.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.45))
	search.add_theme_color_override("caret_color", UI.WHITE)
	search.focus_entered.connect(func() -> void: search_frame.add_theme_stylebox_override("panel", search_focus))
	search.focus_exited.connect(func() -> void: search_frame.add_theme_stylebox_override("panel", search_normal))
	search.text_changed.connect(func(text: String) -> void:
		_pick_query = text
		_fill_pick_grid())
	search_row.add_child(search)
	search_frame.add_child(search_row)
	head_column.add_child(search_frame)
	head.add_child(head_column)
	column.add_child(head)
	_pick_scroll = ScrollContainer.new()
	_style_scroll(_pick_scroll)
	_pick_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var grid_margin := MarginContainer.new()
	grid_margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	grid_margin.add_theme_constant_override("margin_left", _sp(1.0))
	grid_margin.add_theme_constant_override("margin_right", _sp(1.0))
	grid_margin.add_theme_constant_override("margin_top", _sp(0.5))
	grid_margin.add_theme_constant_override("margin_bottom", _sp(0.5))
	_pick_grid = _grid(3, _sp(0.5), _sp(0.5))
	grid_margin.add_child(_pick_grid)
	_pick_scroll.add_child(grid_margin)
	column.add_child(_pick_scroll)
	column.add_child(_rule(0.07))
	var foot := MarginContainer.new()
	foot.add_theme_constant_override("margin_left", _sp(1.0))
	foot.add_theme_constant_override("margin_right", _sp(1.0))
	foot.add_theme_constant_override("margin_top", _sp(0.75))
	foot.add_theme_constant_override("margin_bottom", _sp(0.75))
	var footer := _row(_sp(0.5))
	var cancel := _button("Cancel", {
		"bg": Color(1, 1, 1, 0.06), "hover_bg": Color(1, 1, 1, 0.1), "border": Color(1, 1, 1, 0.12),
		"ink": Color(1, 1, 1, 0.8), "size": 0.85, "weight": 500, "pad": Vector4(_sp(0.65), _sp(0.65), _sp(0.65), _sp(0.65)), "radius": 10,
	})
	cancel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	cancel.size_flags_stretch_ratio = 1.0
	cancel.pressed.connect(_cancel_choosing)
	footer.add_child(cancel)
	_pick_confirm = Button.new()
	_pick_confirm.focus_mode = Control.FOCUS_NONE
	_pick_confirm.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_pick_confirm.size_flags_stretch_ratio = 2.0
	_pick_confirm.add_theme_font_override("font", UI.font(600))
	_pick_confirm.add_theme_font_size_override("font_size", _px(0.85))
	for name: String in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color", "font_disabled_color"]:
		_pick_confirm.add_theme_color_override(name, UI.WHITE)
	_pressable(_pick_confirm)
	_pick_confirm_hovered = false
	_pick_confirm_touched = false
	_pick_confirm.mouse_entered.connect(func() -> void:
		_pick_confirm_hovered = true
		if not _pick.is_empty():
			_pick_confirm_touched = true
		_update_pick_confirm())
	_pick_confirm.mouse_exited.connect(func() -> void:
		_pick_confirm_hovered = false
		_update_pick_confirm())
	_pick_confirm.pressed.connect(_confirm_deploy)
	footer.add_child(_pick_confirm)
	foot.add_child(footer)
	column.add_child(foot)
	_overlay.add_child(column)
	_update_pick_confirm()
	_fill_pick_grid()


func _update_pick_confirm() -> void:
	if _pick_confirm == null or not is_instance_valid(_pick_confirm):
		return
	var has_pick := not _pick.is_empty()
	_pick_confirm.text = "Deploy the network" if has_pick else "Choose a target"
	var bg := Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.3)
	if has_pick:
		bg = BLUE_HOVER if _pick_confirm_hovered else (BLUE if _pick_confirm_touched else Color(1, 1, 1, 0.28))
	var style := UI.box(bg, Color(0, 0, 0, 0), 10, 0, Vector4(_sp(0.65), _sp(0.65), _sp(0.65), _sp(0.65)))
	for state: String in ["normal", "focus", "disabled", "hover", "pressed", "hover_pressed"]:
		_pick_confirm.add_theme_stylebox_override(state, style)
	_pick_confirm.disabled = not has_pick
	_pick_confirm.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if has_pick else Control.CURSOR_FORBIDDEN
	if _pick_chosen and is_instance_valid(_pick_chosen):
		_clear(_pick_chosen)
		if has_pick:
			var size := maxi(8, roundi(_px(0.78) * 0.9))
			_pick_chosen.add_child(_flag_rect(_pick_flag, Vector2(size, size)))
			_pick_chosen.add_child(_text(_pick, 0.78, Color(1, 1, 1, 0.35)))
		else:
			_pick_chosen.add_child(_text("No target chosen yet", 0.78, Color(1, 1, 1, 0.35)))


func _fill_pick_grid() -> void:
	if _pick_grid == null or not is_instance_valid(_pick_grid):
		return
	_clear(_pick_grid)
	if _candidates_loading:
		_pick_grid.columns = 1
		var loading := _italic("Loading countries…", 0.82, Color(1, 1, 1, 0.35))
		loading.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		_pick_grid.add_child(loading)
		return
	_pick_grid.columns = 3
	var needle := _pick_query.to_lower()
	var tiles: Array[Dictionary] = []
	for entry: Variant in _candidates:
		var country: Dictionary = entry
		var name := str(country.get("name", ""))
		if not needle.is_empty() and name.to_lower().find(needle) < 0:
			continue
		var selected := name == _pick
		var pad := Vector4(_sp(0.4), 0, _sp(0.4), 0)
		var normal := UI.box(Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.18) if selected else Color(1, 1, 1, 0.04), Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.6) if selected else Color(1, 1, 1, 0.07), 10, 1, pad)
		var hover := UI.box(Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.18) if selected else Color(1, 1, 1, 0.07), Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.6) if selected else Color(1, 1, 1, 0.15), 10, 1, pad)
		var code := str(country.get("code", ""))
		var flag_path := str(country.get("flag", ""))
		var tile := _clickable(normal, func() -> void:
			if _pick == name:
				_pick = ""
				_pick_code = ""
				_pick_flag = ""
			else:
				_pick = name
				_pick_code = code
				_pick_flag = flag_path
			_update_pick_confirm()
			_fill_pick_grid(), hover)
		tile.custom_minimum_size.y = _sp(5.5)
		tile.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var column := VBoxContainer.new()
		column.alignment = BoxContainer.ALIGNMENT_CENTER
		column.add_theme_constant_override("separation", _sp(0.35))
		column.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var flag_slot := CenterContainer.new()
		flag_slot.mouse_filter = Control.MOUSE_FILTER_IGNORE
		flag_slot.custom_minimum_size = Vector2(_sp(2.3), _sp(1.6))
		column.add_child(flag_slot)
		var short := name if name.length() <= 12 else name.substr(0, 11) + "…"
		var caption := _text(short, 0.72, Color(1, 1, 1, 0.8))
		caption.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		column.add_child(caption)
		tile.add_child(column)
		if selected:
			var corner := MarginContainer.new()
			corner.mouse_filter = Control.MOUSE_FILTER_IGNORE
			corner.add_theme_constant_override("margin_top", _sp(0.3) - 1)
			corner.add_theme_constant_override("margin_right", _sp(0.3) - _sp(0.4))
			var badge := PanelContainer.new()
			badge.add_theme_stylebox_override("panel", UI.box(BLUE, Color(0, 0, 0, 0), 999))
			badge.custom_minimum_size = Vector2(14, 14)
			badge.size_flags_horizontal = Control.SIZE_SHRINK_END
			badge.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
			badge.mouse_filter = Control.MOUSE_FILTER_IGNORE
			var tick := UI.label("✓", _px(0.55), UI.WHITE, 700)
			tick.add_theme_font_override("font", _symbol_font(700))
			tick.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			tick.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
			badge.add_child(tick)
			corner.add_child(badge)
			tile.add_child(corner)
		_pick_grid.add_child(tile)
		tiles.append({"slot": flag_slot, "path": flag_path})
	_load_flags(tiles)


func _load_flags(tiles: Array[Dictionary]) -> void:
	var grid := _pick_grid
	var count := 0
	for tile: Dictionary in tiles:
		if grid != _pick_grid or not is_instance_valid(grid):
			return
		var slot: CenterContainer = tile["slot"]
		if not is_instance_valid(slot):
			return
		slot.add_child(_flag_rect(str(tile["path"]), Vector2(_sp(2.3), _sp(1.6))))
		count += 1
		if count % 12 == 0:
			await get_tree().process_frame


func _cancel_choosing() -> void:
	_close_overlay()
	_pick = ""


func _confirm_deploy() -> void:
	if _pick.is_empty():
		return
	var target := _pick
	_close_overlay()
	_pick = ""
	_error = ""
	_busy = true
	var reply: Dictionary = await engine.request("intelligence.deploy", {"target": target})
	_busy = false
	if not reply.get("ok", false):
		_error = str(reply.get("error", ""))
		_render()
		return
	_selected = target
	_section = "countries"
	await refresh()
