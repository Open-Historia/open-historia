class_name PoliticalManager
extends Control

signal close_requested
signal escape_pressed

var aside_top: VBoxContainer
var aside_list: VBoxContainer
var main_header: VBoxContainer
var main_body: VBoxContainer
var subtitle_label: Label
var main_scroll: ScrollContainer
var aside_scroll: ScrollContainer
var _panel: PanelContainer
var _header: Control
var _aside: VBoxContainer
var _aside_top_margin: MarginContainer
var _main_header_margin: MarginContainer
var _main_margin: MarginContainer
var _max_width := 1472.0
var _min_height := 736.0
var _aside_ratio := 0.24
var _aside_min := 240.0


func _init(eyebrow: String, title: String, subtitle: String, max_width: float, min_height: float, aside_ratio: float, aside_min: float, close_tooltip: String) -> void:
	_max_width = max_width
	_min_height = min_height
	_aside_ratio = aside_ratio
	_aside_min = aside_min
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	var dim := ColorRect.new()
	dim.color = Color(6 / 255.0, 6 / 255.0, 7 / 255.0, 0.8)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	dim.mouse_filter = Control.MOUSE_FILTER_STOP
	dim.gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventMouseButton and (event as InputEventMouseButton).pressed and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT:
			close_requested.emit())
	add_child(dim)
	_panel = PanelContainer.new()
	_panel.add_theme_stylebox_override("panel", UI.box(PoliticalKit.MANAGER_PANEL, Color(1, 1, 1, 0.11), 20, 1, Vector4(0, 0, 0, 0)))
	_panel.clip_contents = true
	add_child(_panel)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	_panel.add_child(column)

	var header := MarginContainer.new()
	for side in [["margin_left", 16], ["margin_right", 16], ["margin_top", 13], ["margin_bottom", 13]]:
		header.add_theme_constant_override(side[0], side[1])
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 13)
	var titles := VBoxContainer.new()
	titles.add_theme_constant_override("separation", 2)
	titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	titles.add_child(UI.label(eyebrow.to_upper(), 10, Color(1, 1, 1, 0.46), 850, "Arial", 1))
	titles.add_child(UI.label(title, 18, UI.WHITE, 850, "Arial", -1))
	subtitle_label = UI.label(subtitle, 11, Color(1, 1, 1, 0.46))
	titles.add_child(subtitle_label)
	row.add_child(titles)
	var close_button := PoliticalKit.action_button("×", "quiet")
	close_button.add_theme_font_size_override("font_size", 16)
	close_button.custom_minimum_size = Vector2(38, 32)
	close_button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	close_button.tooltip_text = close_tooltip
	close_button.pressed.connect(func() -> void: close_requested.emit())
	row.add_child(close_button)
	header.add_child(row)
	_header = header
	column.add_child(header)
	column.add_child(EditorKit.rule())

	var body := HBoxContainer.new()
	body.add_theme_constant_override("separation", 0)
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	column.add_child(body)

	_aside = VBoxContainer.new()
	_aside.add_theme_constant_override("separation", 0)
	body.add_child(_aside)
	_aside_top_margin = MarginContainer.new()
	for side in [["margin_left", 11], ["margin_right", 11], ["margin_top", 11], ["margin_bottom", 11]]:
		_aside_top_margin.add_theme_constant_override(side[0], side[1])
	aside_top = VBoxContainer.new()
	aside_top.add_theme_constant_override("separation", 7)
	_aside_top_margin.add_child(aside_top)
	_aside.add_child(_aside_top_margin)
	var aside_rule := ColorRect.new()
	aside_rule.color = Color(1, 1, 1, 0.07)
	aside_rule.custom_minimum_size.y = 1
	_aside.add_child(aside_rule)
	aside_scroll = ScrollContainer.new()
	aside_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	aside_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	var aside_margin := MarginContainer.new()
	aside_margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for side in [["margin_left", 7], ["margin_right", 7], ["margin_top", 7], ["margin_bottom", 7]]:
		aside_margin.add_theme_constant_override(side[0], side[1])
	aside_list = VBoxContainer.new()
	aside_list.add_theme_constant_override("separation", 3)
	aside_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	aside_margin.add_child(aside_list)
	aside_scroll.add_child(aside_margin)
	_aside.add_child(aside_scroll)

	var divider := ColorRect.new()
	divider.color = Color(1, 1, 1, 0.08)
	divider.custom_minimum_size.x = 1
	body.add_child(divider)

	var main := VBoxContainer.new()
	main.add_theme_constant_override("separation", 0)
	main.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body.add_child(main)
	_main_header_margin = MarginContainer.new()
	for side in [["margin_left", 16], ["margin_right", 16], ["margin_top", 13], ["margin_bottom", 11]]:
		_main_header_margin.add_theme_constant_override(side[0], side[1])
	main_header = VBoxContainer.new()
	main_header.add_theme_constant_override("separation", 6)
	_main_header_margin.add_child(main_header)
	main.add_child(_main_header_margin)
	var main_rule := ColorRect.new()
	main_rule.color = Color(1, 1, 1, 0.07)
	main_rule.custom_minimum_size.y = 1
	main.add_child(main_rule)
	main_scroll = ScrollContainer.new()
	main_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	main_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_main_margin = MarginContainer.new()
	_main_margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for side in [["margin_left", 16], ["margin_right", 16], ["margin_top", 12], ["margin_bottom", 16]]:
		_main_margin.add_theme_constant_override(side[0], side[1])
	main_body = VBoxContainer.new()
	main_body.add_theme_constant_override("separation", 11)
	main_body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_main_margin.add_child(main_body)
	main_scroll.add_child(_main_margin)
	main.add_child(main_scroll)
	main_body.minimum_size_changed.connect(_fit)
	aside_list.minimum_size_changed.connect(_fit)


func _ready() -> void:
	get_viewport().size_changed.connect(_fit)
	_fit.call_deferred()


func main_width() -> float:
	var view := get_viewport_rect().size if is_inside_tree() else Vector2(1440, 900)
	var width := minf(_max_width, view.x - 16.0)
	return width - maxf(_aside_min, width * _aside_ratio) - 1.0 - 32.0


func _fit() -> void:
	if not is_inside_tree():
		return
	var view := get_viewport_rect().size
	var width := minf(_max_width, view.x - 16.0)
	var max_height := view.y - 19.0
	var aside_width := maxf(_aside_min, width * _aside_ratio)
	_aside.custom_minimum_size.x = aside_width
	var header_height := _header.get_combined_minimum_size().y + 1.0
	var aside_needed := _aside_top_margin.get_combined_minimum_size().y + 1.0 + aside_list.get_combined_minimum_size().y + 14.0
	var main_needed := _main_header_margin.get_combined_minimum_size().y + 1.0 + _main_margin.get_combined_minimum_size().y
	var needed := header_height + maxf(aside_needed, main_needed)
	var height := clampf(needed, minf(_min_height, max_height), max_height)
	_panel.size = Vector2(width, height)
	_panel.position = ((view - _panel.size) * 0.5).round()


func _unhandled_key_input(event: InputEvent) -> void:
	if event is InputEventKey and (event as InputEventKey).pressed and (event as InputEventKey).keycode == KEY_ESCAPE:
		get_viewport().set_input_as_handled()
		escape_pressed.emit()


func clear_main() -> void:
	EditorKit.clear(main_header)
	EditorKit.clear(main_body)


func list_row(title: String, subtitle: String, selected: bool, right: Control, on_press: Callable, mono_subtitle := false) -> Button:
	var holder := Button.new()
	holder.focus_mode = Control.FOCUS_NONE
	holder.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	holder.custom_minimum_size.y = 44
	var normal := UI.box(PoliticalKit.GREY_SELECTED if selected else Color(0, 0, 0, 0), PoliticalKit.GREY_BORDER_STRONG if selected else Color(0, 0, 0, 0), 10, 1, Vector4(0, 0, 0, 0))
	var hover := UI.box(PoliticalKit.GREY_SELECTED if selected else Color(1, 1, 1, 0.04), PoliticalKit.GREY_BORDER_STRONG if selected else Color(0, 0, 0, 0), 10, 1, Vector4(0, 0, 0, 0))
	for state in [["normal", normal], ["hover", hover], ["pressed", hover], ["hover_pressed", hover], ["focus", normal], ["disabled", normal]]:
		holder.add_theme_stylebox_override(state[0], state[1])
	var margin := MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	margin.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for side in [["margin_left", 10], ["margin_right", 10], ["margin_top", 8], ["margin_bottom", 8]]:
		margin.add_theme_constant_override(side[0], side[1])
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 9)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var texts := VBoxContainer.new()
	texts.add_theme_constant_override("separation", 2)
	texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	texts.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var title_label := PoliticalKit.line(title, 12, UI.WHITE, 750)
	title_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	texts.add_child(title_label)
	if not subtitle.is_empty():
		var sub := PoliticalKit.line(subtitle, 9, Color(1, 1, 1, 0.38 if not mono_subtitle else 0.35), 400)
		if mono_subtitle:
			sub.add_theme_font_override("font", UI.font(400, "Consolas"))
		sub.mouse_filter = Control.MOUSE_FILTER_IGNORE
		texts.add_child(sub)
	row.add_child(texts)
	if right:
		right.mouse_filter = Control.MOUSE_FILTER_IGNORE
		row.add_child(right)
	margin.add_child(row)
	holder.add_child(margin)
	holder.pressed.connect(func() -> void: on_press.call())
	holder.custom_minimum_size.y = 48.0 if not subtitle.is_empty() else 36.0
	return holder
