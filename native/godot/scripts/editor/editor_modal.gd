class_name EditorModal
extends Control

signal closed

var body: VBoxContainer
var footer: HBoxContainer
var header_extra: HBoxContainer
var title_label: Label
var subtitle_label: Label
var _panel: PanelContainer
var _scroll: ScrollContainer
var _margin: MarginContainer
var _width := 640.0
var _closing := false


func _init(title_text := "", width := 640.0, subtitle := "") -> void:
	_width = width
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.62)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	dim.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(dim)
	var centre := CenterContainer.new()
	centre.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	centre.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(centre)
	_panel = PanelContainer.new()
	_panel.add_theme_stylebox_override("panel", UI.box(EditorKit.PANEL, Color(1, 1, 1, 0.09), 18, 1, Vector4(0, 0, 0, 0)))
	_panel.custom_minimum_size.x = width
	centre.add_child(_panel)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	_panel.add_child(column)
	var header := MarginContainer.new()
	for side in [["margin_left", 20], ["margin_right", 16], ["margin_top", 16], ["margin_bottom", 13]]:
		header.add_theme_constant_override(side[0], side[1])
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	var titles := VBoxContainer.new()
	titles.add_theme_constant_override("separation", 3)
	titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title_label = UI.label(title_text, 17, UI.WHITE, 800)
	title_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	titles.add_child(title_label)
	subtitle_label = UI.wrapped(subtitle, 12, Color(1, 1, 1, 0.55))
	subtitle_label.visible = not subtitle.is_empty()
	titles.add_child(subtitle_label)
	row.add_child(titles)
	header_extra = HBoxContainer.new()
	header_extra.add_theme_constant_override("separation", 6)
	row.add_child(header_extra)
	var close_button := EditorKit.button("", "theme")
	close_button.icon = UI.icon("close", 16, Color(1, 1, 1, 0.82))
	close_button.custom_minimum_size = Vector2(36, 36)
	close_button.tooltip_text = "Close"
	close_button.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	close_button.pressed.connect(close)
	row.add_child(close_button)
	header.add_child(row)
	column.add_child(header)
	column.add_child(EditorKit.rule())
	_scroll = ScrollContainer.new()
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	column.add_child(_scroll)
	_margin = MarginContainer.new()
	_margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for side in [["margin_left", 20], ["margin_right", 20], ["margin_top", 16], ["margin_bottom", 18]]:
		_margin.add_theme_constant_override(side[0], side[1])
	_scroll.add_child(_margin)
	body = VBoxContainer.new()
	body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body.add_theme_constant_override("separation", 12)
	_margin.add_child(body)
	var footer_margin := MarginContainer.new()
	for side in [["margin_left", 20], ["margin_right", 20], ["margin_top", 12], ["margin_bottom", 16]]:
		footer_margin.add_theme_constant_override(side[0], side[1])
	footer = HBoxContainer.new()
	footer.add_theme_constant_override("separation", 8)
	footer.alignment = BoxContainer.ALIGNMENT_END
	footer_margin.add_child(footer)
	footer_margin.visible = false
	column.add_child(footer_margin)
	footer.child_entered_tree.connect(func(_node: Node) -> void: footer_margin.visible = true)
	body.minimum_size_changed.connect(_fit)


func _ready() -> void:
	get_viewport().size_changed.connect(_fit)
	_fit.call_deferred()


func _fit() -> void:
	if not is_inside_tree():
		return
	var view := get_viewport_rect().size
	_panel.custom_minimum_size.x = minf(_width, view.x - 32.0)
	var wanted := _margin.get_combined_minimum_size().y
	_scroll.custom_minimum_size.y = minf(wanted, maxf(160.0, view.y - 200.0))


func open_in(host: Node) -> void:
	host.add_child(self)


func close() -> void:
	if _closing:
		return
	_closing = true
	closed.emit()
	queue_free()


func _unhandled_key_input(event: InputEvent) -> void:
	if event is InputEventKey and (event as InputEventKey).pressed and (event as InputEventKey).keycode == KEY_ESCAPE:
		get_viewport().set_input_as_handled()
		close()
