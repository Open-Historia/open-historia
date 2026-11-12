class_name WorkshopOverlay
extends Control

signal closed

const MAX_WIDTH := 1056.0
const PAD := 18.0

var panel: PanelContainer
var header: HBoxContainer
var body: VBoxContainer
var _scroll: ScrollContainer
var _head_margin: MarginContainer
var _body_margin: MarginContainer


func _init(panel_color: Color) -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	var shade := ColorRect.new()
	shade.color = Color(8 / 255.0, 8 / 255.0, 9 / 255.0, 0.82)
	shade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	shade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(shade)
	panel = PanelContainer.new()
	panel.add_theme_stylebox_override("panel", UI.box(panel_color, Color(1, 1, 1, 0.1), 18, 1, Vector4(1, 1, 1, 1)))
	panel.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(panel)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	panel.add_child(column)
	_head_margin = MarginContainer.new()
	for pair in [["margin_left", 18], ["margin_right", 18], ["margin_top", 14], ["margin_bottom", 14]]:
		_head_margin.add_theme_constant_override(pair[0], pair[1])
	header = HBoxContainer.new()
	header.add_theme_constant_override("separation", 10)
	_head_margin.add_child(header)
	column.add_child(_head_margin)
	var line := ColorRect.new()
	line.color = Color(1, 1, 1, 0.08)
	line.custom_minimum_size.y = 1
	line.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.add_child(line)
	_scroll = ScrollContainer.new()
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	column.add_child(_scroll)
	_body_margin = MarginContainer.new()
	_body_margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for pair in [["margin_left", 18], ["margin_right", 18], ["margin_top", 18], ["margin_bottom", 18]]:
		_body_margin.add_theme_constant_override(pair[0], pair[1])
	_scroll.add_child(_body_margin)
	body = VBoxContainer.new()
	body.add_theme_constant_override("separation", 0)
	body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_body_margin.add_child(body)
	body.minimum_size_changed.connect(_layout)
	gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventMouseButton and (event as InputEventMouseButton).pressed and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT:
			if not panel.get_global_rect().has_point((event as InputEventMouseButton).global_position):
				accept_event()
				closed.emit())


func _ready() -> void:
	resized.connect(_layout)
	_layout.call_deferred()


func panel_width() -> float:
	var view := size if size.x > 0.0 else get_viewport_rect().size
	return minf(MAX_WIDTH, view.x * 0.96)


func content_width() -> float:
	return panel_width() - PAD * 2.0 - 14.0


func columns_for(min_width: float, gap: float) -> int:
	return maxi(1, int(floor((content_width() + gap) / (min_width + gap))))


func _layout() -> void:
	if not is_inside_tree():
		return
	var view := size if size.x > 0.0 else get_viewport_rect().size
	var width := panel_width()
	var tallest := view.y * 0.88
	var chrome := _head_margin.get_combined_minimum_size().y + 3.0
	_scroll.custom_minimum_size.y = maxf(60.0, minf(_body_margin.get_combined_minimum_size().y, tallest - chrome))
	panel.custom_minimum_size.x = width
	panel.reset_size()
	panel.size.x = width
	panel.position = ((view - panel.size) * 0.5).floor()


func title(text: String) -> Label:
	var label := UI.label(text, 17, Color(1, 1, 1), 800)
	label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var holder := MarginContainer.new()
	holder.add_theme_constant_override("margin_right", 6)
	holder.add_child(label)
	header.add_child(holder)
	return label


func spacer() -> Control:
	var gap := Control.new()
	gap.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	gap.mouse_filter = Control.MOUSE_FILTER_IGNORE
	header.add_child(gap)
	return gap


static func tab_button(text: String, active: bool, active_bg: Color, active_border: Color, idle_border: Color, padding: Vector4, weight: int, px := 13.0) -> Button:
	var node := WorkshopUI.base_button(text)
	var style := UI.box(active_bg if active else Color(1, 1, 1, 0.06), active_border if active else idle_border, 999, 1, padding)
	WorkshopUI._flat_styles(node, style, style, style, style)
	WorkshopUI._ink(node, Color(1, 1, 1), px, weight)
	node.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	return node


static func badge(text: String, bg: Color, radius: int, px: float, padding: Vector4, border := Color(0, 0, 0, 0)) -> PanelContainer:
	var holder := PanelContainer.new()
	holder.add_theme_stylebox_override("panel", UI.box(bg, border, radius, 1 if border.a > 0.0 else 0, padding))
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.add_child(UI.label(text, int(round(px)), Color(1, 1, 1), 700))
	return holder


static func pin(node: Control, holder: Control, corner: String, inset := 6.0) -> void:
	holder.add_child(node)
	var left := corner.ends_with("left")
	var top := corner.begins_with("top")
	node.anchor_left = 0.0 if left else 1.0
	node.anchor_right = node.anchor_left
	node.anchor_top = 0.0 if top else 1.0
	node.anchor_bottom = node.anchor_top
	node.grow_horizontal = Control.GROW_DIRECTION_END if left else Control.GROW_DIRECTION_BEGIN
	node.grow_vertical = Control.GROW_DIRECTION_END if top else Control.GROW_DIRECTION_BEGIN
	node.offset_left = inset if left else -inset
	node.offset_right = node.offset_left
	node.offset_top = inset if top else -inset
	node.offset_bottom = node.offset_top


static func row_title(text: String, px := 15.0, alpha := 0.9, weight := 800) -> Label:
	return UI.label(text, int(round(px)), Color(1, 1, 1, alpha), weight)


static func dim_text(text: String, color := Color(1, 1, 1, 0.4)) -> Label:
	var label := WorkshopUI.wrap(text, 13.0, color)
	return label


static func gap(height: float) -> Control:
	var node := Control.new()
	node.custom_minimum_size.y = height
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return node
