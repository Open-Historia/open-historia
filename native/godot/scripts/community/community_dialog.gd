class_name CommunityDialog
extends Control

signal closed

const PANEL_BG := Color("#1b1b1e")
const PANEL_BORDER := Color(1, 1, 1, 0.12)
const RULE := Color(1, 1, 1, 0.08)
const QUIET := Color(1, 1, 1, 0.58)
const BUTTON_BG := Color(1, 1, 1, 0.06)
const BUTTON_BORDER := Color(1, 1, 1, 0.1)
const BUTTON_INK := Color(246 / 255.0, 246 / 255.0, 248 / 255.0, 0.92)
const PRIMARY_BG := Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.22)
const PRIMARY_BORDER := Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.5)
const LABEL_INK := Color(1, 1, 1, 0.72)
const FIELD_BG := Color(1, 1, 1, 0.04)
const FIELD_BORDER := Color(1, 1, 1, 0.1)
const FIELD_INK := Color("#f8fafc")

var body: VBoxContainer
var footer: HBoxContainer
var title_label: Label
var subtitle_label: Label
var _panel: PanelContainer
var _scroll: ScrollContainer
var _footer_holder: PanelContainer
var _layer: CanvasLayer


func _init(title := "", subtitle := "") -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.55)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	dim.mouse_filter = Control.MOUSE_FILTER_STOP
	dim.gui_input.connect(func(event: InputEvent) -> void:
		var click := event as InputEventMouseButton
		if click and click.pressed and click.button_index == MOUSE_BUTTON_LEFT:
			close())
	add_child(dim)
	var centre := CenterContainer.new()
	centre.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	centre.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(centre)
	_panel = PanelContainer.new()
	_panel.add_theme_stylebox_override("panel", UI.box(PANEL_BG, PANEL_BORDER, 22, 1, Vector4(0, 0, 0, 0)))
	_panel.mouse_filter = Control.MOUSE_FILTER_STOP
	centre.add_child(_panel)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	_panel.add_child(column)
	var header := PanelContainer.new()
	var header_style := UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 0, Vector4(18, 16, 18, 14))
	header_style.border_color = RULE
	header_style.border_width_bottom = 1
	header.add_theme_stylebox_override("panel", header_style)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 13)
	var titles := VBoxContainer.new()
	titles.add_theme_constant_override("separation", 3)
	titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title_label = UI.label(title, 19, Color(1, 1, 1), 800)
	title_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	titles.add_child(title_label)
	subtitle_label = quiet(subtitle)
	subtitle_label.visible = not subtitle.is_empty()
	titles.add_child(subtitle_label)
	row.add_child(titles)
	var cross := button("✕")
	cross.custom_minimum_size = Vector2(35, 34)
	cross.tooltip_text = "Close"
	cross.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	cross.pressed.connect(close)
	row.add_child(cross)
	header.add_child(row)
	column.add_child(header)
	_scroll = ScrollContainer.new()
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var pad := MarginContainer.new()
	pad.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for side in [["margin_left", 18], ["margin_right", 18], ["margin_top", 16], ["margin_bottom", 16]]:
		pad.add_theme_constant_override(side[0], side[1])
	body = VBoxContainer.new()
	body.add_theme_constant_override("separation", 13)
	body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	pad.add_child(body)
	_scroll.add_child(pad)
	column.add_child(_scroll)
	_footer_holder = PanelContainer.new()
	var footer_style := UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 0, Vector4(18, 13, 18, 13))
	footer_style.border_color = RULE
	footer_style.border_width_top = 1
	_footer_holder.add_theme_stylebox_override("panel", footer_style)
	footer = HBoxContainer.new()
	footer.add_theme_constant_override("separation", 8)
	_footer_holder.add_child(footer)
	column.add_child(_footer_holder)
	resized.connect(_fit)
	body.minimum_size_changed.connect(_fit)


func show_over(host: Node) -> void:
	_layer = CanvasLayer.new()
	_layer.layer = 90
	host.get_tree().root.add_child(_layer)
	_layer.add_child(self)
	_fit.call_deferred()


func close() -> void:
	closed.emit()
	if is_instance_valid(_layer):
		_layer.queue_free()
	else:
		queue_free()


func _unhandled_input(event: InputEvent) -> void:
	var key := event as InputEventKey
	if key and key.pressed and key.keycode == KEY_ESCAPE:
		close()
		get_viewport().set_input_as_handled()


func _fit() -> void:
	var view := get_viewport_rect().size if is_inside_tree() else Vector2(1440, 900)
	var width := minf(736.0, view.x - 32.0)
	_panel.custom_minimum_size.x = width
	var chrome := 0.0
	for child in (_panel.get_child(0) as VBoxContainer).get_children():
		if child != _scroll and (child as Control).visible:
			chrome += (child as Control).get_combined_minimum_size().y
	var content := (_scroll.get_child(0) as Control).get_combined_minimum_size().y
	_scroll.custom_minimum_size.y = minf(content, maxf(120.0, view.y - 48.0 - chrome))


func set_subtitle(text: String) -> void:
	subtitle_label.text = text
	subtitle_label.visible = not text.is_empty()


func clear_body() -> void:
	for child in body.get_children():
		body.remove_child(child)
		child.queue_free()


func clear_footer() -> void:
	for child in footer.get_children():
		footer.remove_child(child)
		child.queue_free()
	_footer_holder.visible = false


func show_footer() -> void:
	_footer_holder.visible = footer.get_child_count() > 0


static func quiet(text: String, color := QUIET) -> Label:
	return CommunityKit.para(text, 12, color, 400, 1.5)


static func button(caption: String, primary := false) -> Button:
	return CommunityKit.pill_button(caption, {
		"bg": PRIMARY_BG if primary else BUTTON_BG,
		"border": PRIMARY_BORDER if primary else BUTTON_BORDER,
		"ink": Color(1, 1, 1) if primary else BUTTON_INK,
		"size": 13,
		"weight": 600,
		"height": 34.0,
		"pad": 14.0,
	})


static func field_label(text: String) -> Label:
	return UI.label(text.to_upper(), 11, LABEL_INK, 700, "Arial", 1)


static func error_box(text: String) -> PanelContainer:
	var holder := CommunityKit.panel(Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.12), Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.34), 14, Vector4(13, 11, 13, 11))
	holder.add_child(CommunityKit.para(text, 13, Color("#fecaca"), 400, 1.4))
	return holder


static func input(value: String, max_length: int, placeholder := "") -> LineEdit:
	var field := LineEdit.new()
	field.text = value
	field.max_length = max_length
	field.placeholder_text = placeholder
	field.custom_minimum_size.y = 40
	var style := UI.box(FIELD_BG, FIELD_BORDER, 12, 1, Vector4(13, 0, 13, 0))
	field.add_theme_stylebox_override("normal", style)
	field.add_theme_stylebox_override("focus", style)
	field.add_theme_stylebox_override("read_only", style)
	field.add_theme_font_override("font", UI.font(400))
	field.add_theme_font_size_override("font_size", 14)
	field.add_theme_color_override("font_color", FIELD_INK)
	field.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.42))
	return field


static func text_area(value: String, height: float, mono := false, placeholder := "") -> TextEdit:
	var area := TextEdit.new()
	area.text = value
	area.placeholder_text = placeholder
	area.custom_minimum_size.y = height
	area.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	var style := UI.box(FIELD_BG, FIELD_BORDER, 12, 1, Vector4(13, 11, 13, 11))
	area.add_theme_stylebox_override("normal", style)
	area.add_theme_stylebox_override("focus", style)
	area.add_theme_stylebox_override("read_only", style)
	area.add_theme_font_override("font", UI.font(400, "Consolas") if mono else UI.font(400))
	area.add_theme_font_size_override("font_size", 12 if mono else 14)
	area.add_theme_color_override("font_color", FIELD_INK)
	area.add_theme_color_override("font_readonly_color", FIELD_INK)
	area.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.42))
	area.add_theme_color_override("background_color", Color(0, 0, 0, 0))
	return area
