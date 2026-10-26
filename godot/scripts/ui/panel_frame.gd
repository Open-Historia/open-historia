class_name PanelFrame
extends GlassPanel

signal closed

const BOTTOM_WIDTH := 418.0
const BOTTOM_HEIGHT := 480.0
const BOTTOM_GAP := 78.0
const DRAWER_WIDTH := 320.0

var kind := "bottom"
var body: VBoxContainer
var scroll: ScrollContainer
var header_title: Label
var header_subtitle: Label
var header_subtitle_slot: HBoxContainer
var header_extra: HBoxContainer
var _open := false


func _init(title := "", subtitle := "", frame_kind := "bottom", width := 0.0) -> void:
	super._init(UI.HUD_BG_STRONG, 18.0)
	kind = frame_kind
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	var header := MarginContainer.new()
	for side in [["margin_left", 20], ["margin_right", 18], ["margin_top", 16], ["margin_bottom", 12]]:
		header.add_theme_constant_override(side[0], side[1])
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	var titles := VBoxContainer.new()
	titles.add_theme_constant_override("separation", 2)
	titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	header_title = UI.label(title, 16, Color(1, 1, 1, 0.96), 700)
	titles.add_child(header_title)
	header_subtitle = UI.label(subtitle, 12, Color(1, 1, 1, 0.45))
	header_subtitle.visible = not subtitle.is_empty()
	header_subtitle.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	titles.add_child(header_subtitle)
	header_subtitle_slot = HBoxContainer.new()
	header_subtitle_slot.add_theme_constant_override("separation", 3)
	header_subtitle_slot.visible = false
	titles.add_child(header_subtitle_slot)
	row.add_child(titles)
	header_extra = HBoxContainer.new()
	header_extra.add_theme_constant_override("separation", 4)
	row.add_child(header_extra)
	var close := Button.new()
	close.flat = true
	close.focus_mode = Control.FOCUS_NONE
	close.icon = UI.icon("close", 16, Color(1, 1, 1, 0.5))
	close.tooltip_text = "Close panel"
	close.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	close.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	close.pressed.connect(func() -> void: closed.emit())
	row.add_child(close)
	header.add_child(row)
	column.add_child(header)
	var rule := ColorRect.new()
	rule.color = Color(1, 1, 1, 0.07)
	rule.custom_minimum_size.y = 1
	column.add_child(rule)
	scroll = ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_SHOW_NEVER
	var margin := MarginContainer.new()
	margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for side in [["margin_left", 20], ["margin_right", 20], ["margin_top", 15], ["margin_bottom", 20]]:
		margin.add_theme_constant_override(side[0], side[1])
	body = VBoxContainer.new()
	body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body.add_theme_constant_override("separation", 14)
	margin.add_child(body)
	scroll.add_child(margin)
	column.add_child(scroll)
	add_child(column)
	if kind == "drawer":
		anchor_left = 1.0
		anchor_right = 1.0
		anchor_top = 0.0
		anchor_bottom = 1.0
		var drawer_width := width if width > 0.0 else DRAWER_WIDTH
		offset_left = 8.0
		offset_right = 8.0 + drawer_width
		offset_top = 8.0
		offset_bottom = -8.0
		set_meta("width", drawer_width)
	else:
		anchor_left = 0.0
		anchor_right = 0.0
		anchor_top = 1.0
		anchor_bottom = 1.0
		var panel_width := width if width > 0.0 else BOTTOM_WIDTH
		offset_left = 8.0
		offset_right = 8.0 + panel_width
		offset_top = 200.0
		offset_bottom = 680.0
	modulate.a = 0.0
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func _ready() -> void:
	get_viewport().size_changed.connect(func() -> void:
		if _open and kind != "drawer":
			offset_top = -BOTTOM_GAP - bottom_height())


func bottom_height() -> float:
	var view := get_viewport_rect().size.y if is_inside_tree() else 1080.0
	return maxf(160.0, minf(view - 144.0, maxf(view - 528.0, BOTTOM_HEIGHT)))


func set_subtitle(text: String) -> void:
	header_subtitle.text = text
	header_subtitle.visible = not text.is_empty()


func is_open() -> bool:
	return _open


func set_open(open: bool) -> void:
	_open = open
	var tween := create_tween().set_parallel(true).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	if kind == "drawer":
		var width: float = get_meta("width", DRAWER_WIDTH)
		tween.tween_property(self, "offset_left", -8.0 - width if open else 8.0, 0.3)
		tween.tween_property(self, "offset_right", -8.0 if open else 8.0 + width, 0.3)
	else:
		var height := bottom_height()
		tween.tween_property(self, "offset_top", -BOTTOM_GAP - height if open else 200.0, 0.35)
		tween.tween_property(self, "offset_bottom", -BOTTOM_GAP if open else 200.0 + height, 0.35)
	tween.tween_property(self, "modulate:a", 1.0 if open else 0.0, 0.3)
	mouse_filter = Control.MOUSE_FILTER_STOP if open else Control.MOUSE_FILTER_IGNORE


func clear_body() -> void:
	for child in body.get_children():
		body.remove_child(child)
		child.queue_free()


func scroll_to_end() -> void:
	await get_tree().process_frame
	scroll.scroll_vertical = int(scroll.get_v_scroll_bar().max_value)
