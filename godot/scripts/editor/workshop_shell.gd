class_name WorkshopShell
extends PanelContainer

signal closed

var body: VBoxContainer
var footer: VBoxContainer
var side := "left"
var panel_width := 340.0
var max_height := 600.0
var _scroll: ScrollContainer
var _margin: MarginContainer
var _footer_wrap: VBoxContainer
var _header: Control
var title_label: Label


func _init(title_text: String, icon_name := "", width := 340.0, panel_side := "left") -> void:
	panel_width = width
	side = panel_side
	add_theme_stylebox_override("panel", UI.box(WorkshopUI.PANEL, Color(1, 1, 1, 0.09), 16, 1, Vector4(0, 0, 0, 0)))
	mouse_filter = Control.MOUSE_FILTER_STOP
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	add_child(column)
	var header := MarginContainer.new()
	for pair in [["margin_left", 14], ["margin_right", 12], ["margin_top", 12], ["margin_bottom", 12]]:
		header.add_theme_constant_override(pair[0], pair[1])
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	if not icon_name.is_empty():
		var tile := PanelContainer.new()
		tile.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.08), 9, 1, Vector4(0, 0, 0, 0)))
		tile.custom_minimum_size = Vector2(28, 28)
		tile.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var glyph := WorkshopUI.icon_rect(icon_name, 15)
		glyph.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
		tile.add_child(glyph)
		row.add_child(tile)
	var caption := UI.label(title_text, 15, Color(1, 1, 1, 1), 800)
	caption.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	caption.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	caption.clip_text = true
	caption.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	title_label = caption
	row.add_child(caption)
	var close := WorkshopUI.icon_button("close", "Close", 15, 28.0)
	close.pressed.connect(func() -> void: closed.emit())
	row.add_child(close)
	header.add_child(row)
	_header = header
	column.add_child(header)
	var line := ColorRect.new()
	line.color = Color(1, 1, 1, 0.07)
	line.custom_minimum_size.y = 1
	line.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.add_child(line)
	_scroll = ScrollContainer.new()
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	column.add_child(_scroll)
	_margin = MarginContainer.new()
	_margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for pair in [["margin_left", 14], ["margin_right", 14], ["margin_top", 14], ["margin_bottom", 14]]:
		_margin.add_theme_constant_override(pair[0], pair[1])
	_scroll.add_child(_margin)
	body = VBoxContainer.new()
	body.add_theme_constant_override("separation", 10)
	body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_margin.add_child(body)
	_footer_wrap = VBoxContainer.new()
	_footer_wrap.add_theme_constant_override("separation", 0)
	_footer_wrap.visible = false
	var footer_line := ColorRect.new()
	footer_line.color = Color(1, 1, 1, 0.07)
	footer_line.custom_minimum_size.y = 1
	footer_line.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_footer_wrap.add_child(footer_line)
	var footer_margin := MarginContainer.new()
	for pair in [["margin_left", 14], ["margin_right", 14], ["margin_top", 12], ["margin_bottom", 12]]:
		footer_margin.add_theme_constant_override(pair[0], pair[1])
	footer = VBoxContainer.new()
	footer.add_theme_constant_override("separation", 6)
	footer_margin.add_child(footer)
	_footer_wrap.add_child(footer_margin)
	column.add_child(_footer_wrap)
	footer.child_entered_tree.connect(func(_node: Node) -> void: _footer_wrap.visible = true)
	body.minimum_size_changed.connect(fit)
	custom_minimum_size.x = width


func _ready() -> void:
	fit.call_deferred()


func clear_body() -> void:
	WorkshopUI.clear(body)


func typing_inside() -> bool:
	var focus := get_viewport().gui_get_focus_owner() if is_inside_tree() else null
	return focus != null and (focus is LineEdit or focus is TextEdit) and is_ancestor_of(focus)


func section(title_text: String) -> VBoxContainer:
	var wrap := VBoxContainer.new()
	wrap.add_theme_constant_override("separation", 8)
	var line := ColorRect.new()
	line.color = Color(1, 1, 1, 0.08)
	line.custom_minimum_size.y = 1
	line.mouse_filter = Control.MOUSE_FILTER_IGNORE
	wrap.add_child(line)
	var gap := Control.new()
	gap.custom_minimum_size.y = 2
	gap.mouse_filter = Control.MOUSE_FILTER_IGNORE
	wrap.add_child(gap)
	wrap.add_child(UI.label(title_text.to_upper(), 11, Color(1, 1, 1, 0.5), 700, "Arial", 1))
	body.add_child(wrap)
	return wrap


func clear_footer() -> void:
	WorkshopUI.clear(footer)
	_footer_wrap.visible = false


func fit() -> void:
	if not is_inside_tree():
		return
	var chrome := _header.get_combined_minimum_size().y + 1.0
	if _footer_wrap.visible:
		chrome += _footer_wrap.get_combined_minimum_size().y
	var wanted := _margin.get_combined_minimum_size().y
	_scroll.custom_minimum_size.y = maxf(40.0, minf(wanted, max_height - chrome))
	reset_size()
