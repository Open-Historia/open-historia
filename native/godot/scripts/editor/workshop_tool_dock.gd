extends Control

const LINE := Color(1, 1, 1, 0.16)

var workshop: Workshop
var _bar: PanelContainer
var _caption: PanelContainer
var _caption_label: Label
var _undo: Button
var _redo: Button
var _rows: VBoxContainer
var _blocks: Array = []


func setup(owner_workshop: Workshop) -> void:
	workshop = owner_workshop
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	render()


func render() -> void:
	for child in get_children():
		child.queue_free()
	_bar = PanelContainer.new()
	var style := UI.box(WorkshopUI.NAV, Color(1, 1, 1, 0.18), 14, 1, Vector4(10, 7, 10, 7))
	style.shadow_color = Color(0, 0, 0, 0.4)
	style.shadow_size = 21
	style.shadow_offset = Vector2(0, 12)
	_bar.add_theme_stylebox_override("panel", style)
	_bar.mouse_filter = Control.MOUSE_FILTER_STOP
	_rows = VBoxContainer.new()
	_rows.add_theme_constant_override("separation", 8)
	_bar.add_child(_rows)
	_blocks = []
	var index := 0
	for group in workshop.TOOL_GROUPS:
		var row := _group(index > 0)
		for entry in (group as Dictionary)["tools"]:
			row.add_child(_tool(entry))
		_blocks.append(row.get_parent() if index > 0 else row)
		index += 1
	var chrome := _group(true)
	var history: Dictionary = workshop.state.get("history", {})
	_undo = _chrome("undo", "Undo region edit", bool(history.get("canUndo", false)))
	_undo.pressed.connect(workshop.undo)
	chrome.add_child(_undo)
	_redo = _chrome("redo", "Redo region edit", bool(history.get("canRedo", false)))
	_redo.pressed.connect(workshop.redo)
	chrome.add_child(_redo)
	var fit := _chrome("fit", "Fit map to all regions", true)
	fit.pressed.connect(workshop.fit_to_data)
	chrome.add_child(fit)
	_blocks.append(chrome.get_parent())
	add_child(_bar)
	_caption = PanelContainer.new()
	var caption_style := UI.box(WorkshopUI.NAV, Color(1, 1, 1, 0.18), 9, 1, Vector4(10, 5, 10, 5))
	caption_style.shadow_color = Color(0, 0, 0, 0.24)
	caption_style.shadow_size = 9
	caption_style.shadow_offset = Vector2(0, 5)
	_caption.add_theme_stylebox_override("panel", caption_style)
	_caption.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_caption_label = UI.label("", WorkshopUI.font_size(11), Color("#f6f6f8"), 700)
	_caption_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	_caption_label.clip_text = true
	_caption.add_child(_caption_label)
	add_child(_caption)
	var current: Dictionary = workshop._tool_meta(workshop.tool)
	_caption.visible = not current.is_empty()
	_caption_label.text = str(current.get("label", "")).split(" (")[0]
	var text_width := UI.font(700).get_string_size(_caption_label.text, HORIZONTAL_ALIGNMENT_LEFT, -1, WorkshopUI.font_size(11)).x
	_caption_label.custom_minimum_size.x = minf(ceilf(text_width) + 2.0, 230.0)
	place.call_deferred()


func render_history(history: Dictionary) -> void:
	if _undo == null or not is_instance_valid(_undo):
		return
	_paint_chrome(_undo, "undo", bool(history.get("canUndo", false)))
	_paint_chrome(_redo, "redo", bool(history.get("canRedo", false)))


func _group(divided: bool) -> HBoxContainer:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 3)
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	if not divided:
		return row
	var holder := HBoxContainer.new()
	holder.add_theme_constant_override("separation", 8)
	var rule := ColorRect.new()
	rule.color = LINE
	rule.custom_minimum_size = Vector2(1, 43)
	rule.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.add_child(rule)
	holder.add_child(row)
	return row


func _tool(meta: Dictionary) -> Button:
	var id := str(meta["id"])
	var hotkey := str(meta["hotkey"])
	var button := WorkshopUI.tool_button(str(meta["icon"]), workshop.tool == id, "%s (%s)" % [str(meta["label"]), hotkey], 18, 43.0)
	button.custom_minimum_size = Vector2(43, 43)
	button.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	button.pressed.connect(workshop.set_tool.bind(id))
	var letter := UI.label(hotkey, WorkshopUI.font_size(9), Color(Color("#f6f6f8"), 0.85), 800)
	letter.mouse_filter = Control.MOUSE_FILTER_IGNORE
	letter.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_RIGHT)
	letter.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	letter.grow_vertical = Control.GROW_DIRECTION_BEGIN
	letter.offset_right = -3
	letter.offset_bottom = -1
	button.add_child(letter)
	return button


func _chrome(icon_name: String, tip: String, enabled: bool) -> Button:
	var button := WorkshopUI.tool_button(icon_name, false, tip, 16, 38.0)
	button.custom_minimum_size = Vector2(38, 38)
	button.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_paint_chrome(button, icon_name, enabled)
	return button


func _paint_chrome(button: Button, icon_name: String, enabled: bool) -> void:
	if icon_name == "fit":
		return
	button.disabled = not enabled
	button.modulate.a = 1.0 if enabled else 0.38
	button.icon = WorkshopUI.icon(icon_name, 16, Color(236 / 255.0, 236 / 255.0, 240 / 255.0, 0.78))


func place() -> void:
	if _bar == null or not is_instance_valid(_bar):
		return
	var left: float = workshop.dock_left()
	var right: float = workshop.dock_right()
	var room := maxf(80.0, workshop.size.x - left - right - 24.0) - 22.0
	for block in _blocks:
		var holder: Node = (block as Control).get_parent()
		if holder:
			holder.remove_child(block)
	for old in _rows.get_children():
		_rows.remove_child(old)
		old.queue_free()
	var line: HBoxContainer = null
	var used := 0.0
	for block in _blocks:
		var wide := (block as Control).get_combined_minimum_size().x
		if line == null or (used + 8.0 + wide > room and line.get_child_count() > 0):
			line = HBoxContainer.new()
			line.add_theme_constant_override("separation", 8)
			line.alignment = BoxContainer.ALIGNMENT_CENTER
			_rows.add_child(line)
			used = wide
		else:
			used += 8.0 + wide
		line.add_child(block)
	_bar.size = Vector2.ZERO
	_bar.reset_size()
	var wanted := _bar.get_combined_minimum_size()
	_bar.size = wanted
	var centre := left + (workshop.size.x - left - right) * 0.5
	_bar.position = Vector2(round(centre - wanted.x * 0.5), workshop.size.y - 14.0 - wanted.y)
	if _caption.visible:
		_caption.reset_size()
		var cap_width := minf(_caption.get_combined_minimum_size().x, minf(250.0, workshop.size.x * 0.9))
		_caption.size = Vector2(cap_width, _caption.get_combined_minimum_size().y)
		_caption.position = Vector2(round(centre - cap_width * 0.5), _bar.position.y - 8.0 - _caption.size.y)
