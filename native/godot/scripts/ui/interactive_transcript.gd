extends Control

const GOLD := Color("#fde68a")
const CAPTION := Color(1, 1, 1, 0.60)
const QUIET_INK := Color(1, 1, 1, 0.85)

var _card: PanelContainer
var _scroll: ScrollContainer
var _header: Control
var _body: VBoxContainer
var _margin: MarginContainer
var _on_source := Callable()
var _italic_font: Font


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	var backdrop := ColorRect.new()
	backdrop.color = Color(0, 0, 0, 0.68)
	backdrop.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	backdrop.gui_input.connect(_on_backdrop)
	add_child(backdrop)
	_card = PanelContainer.new()
	_card.add_theme_stylebox_override("panel", UI.box(UiTheme.pick("overlay_strong", Color(18 / 255.0, 18 / 255.0, 22 / 255.0, 0.97)), Color(250 / 255.0, 204 / 255.0, 21 / 255.0, 0.38), 16, 1))
	_card.clip_contents = true
	add_child(_card)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	_card.add_child(column)
	var header := MarginContainer.new()
	for side: Array in [["margin_left", 20], ["margin_right", 20], ["margin_top", 16], ["margin_bottom", 16]]:
		header.add_theme_constant_override(side[0], side[1])
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 13)
	var titles := VBoxContainer.new()
	titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	titles.add_theme_constant_override("separation", 3)
	titles.add_child(UI.label("Interactive event transcript", 12, GOLD, 800))
	titles.add_child(_caption("Completed scene · Read-only history"))
	row.add_child(titles)
	var close_button := _quiet("Close", close)
	close_button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(close_button)
	header.add_child(row)
	column.add_child(header)
	_header = header
	var rule := ColorRect.new()
	rule.color = Color(250 / 255.0, 204 / 255.0, 21 / 255.0, 0.18)
	rule.custom_minimum_size.y = 1
	column.add_child(rule)
	_scroll = ScrollContainer.new()
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var bar := _scroll.get_v_scroll_bar()
	bar.add_theme_stylebox_override("scroll", StyleBoxEmpty.new())
	bar.add_theme_stylebox_override("grabber", UI.box(Color(1, 1, 1, 0.16), Color(0, 0, 0, 0), 999, 0))
	_margin = MarginContainer.new()
	_margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_body = VBoxContainer.new()
	_body.add_theme_constant_override("separation", 18)
	_body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_margin.add_child(_body)
	_scroll.add_child(_margin)
	column.add_child(_scroll)
	resized.connect(_layout)
	_body.minimum_size_changed.connect(_relayout)


func _input(event: InputEvent) -> void:
	if event is InputEventKey and (event as InputEventKey).pressed and (event as InputEventKey).keycode == KEY_ESCAPE:
		get_viewport().set_input_as_handled()
		close()


func _on_backdrop(event: InputEvent) -> void:
	if event is InputEventMouseButton and (event as InputEventMouseButton).pressed and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT:
		close()


func close() -> void:
	if get_parent() is CanvasLayer:
		get_parent().queue_free()
	else:
		queue_free()


func _layout() -> void:
	var view := size if size.x > 0.0 else get_viewport_rect().size
	var pad := roundi(clampf(view.x * 0.025, 16.0, 26.4))
	for side in ["margin_left", "margin_right", "margin_top", "margin_bottom"]:
		_margin.add_theme_constant_override(side, pad)
	var width := minf(768.0, view.x - 32.0)
	var height := minf(832.0, view.y - 32.0)
	var wanted := _header.get_combined_minimum_size().y + 1.0 + _margin.get_combined_minimum_size().y
	_card.size = Vector2(width, minf(height, wanted))
	_card.position = (view - _card.size) * 0.5


func _relayout() -> void:
	if is_inside_tree():
		_layout.call_deferred()


func _italic() -> Font:
	if _italic_font:
		return _italic_font
	var system := SystemFont.new()
	system.font_names = PackedStringArray(["Arial", "Segoe UI", "Helvetica", "sans-serif"])
	system.font_italic = true
	system.antialiasing = TextServer.FONT_ANTIALIASING_GRAY
	_italic_font = system
	return _italic_font


func _caption(text: String, size := 12, color := CAPTION, weight := 400) -> Label:
	var node := UI.wrapped(text, size, color, weight)
	node.add_theme_constant_override("line_spacing", 3)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


func _scene_text(text: String, size := 15, color := UI.WHITE, weight := 400, line := 1.7) -> Label:
	var node := UI.wrapped(text, size, color, weight)
	node.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	node.add_theme_constant_override("line_spacing", int(round(size * (line - 1.0))))
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


func _quiet(text: String, on_press: Callable, wrap := false) -> Button:
	var button := Button.new()
	button.text = text
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	if wrap:
		button.alignment = HORIZONTAL_ALIGNMENT_LEFT
		button.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var normal := UI.box(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.12), 10, 1, Vector4(14.4, 8.8, 14.4, 8.8))
	var hover := UI.box(Color(1, 1, 1, 0.09), Color(1, 1, 1, 0.18), 10, 1, Vector4(14.4, 8.8, 14.4, 8.8))
	for state in ["normal", "focus", "disabled"]:
		button.add_theme_stylebox_override(state, normal)
	for state in ["hover", "pressed", "hover_pressed"]:
		button.add_theme_stylebox_override(state, hover)
	button.add_theme_font_override("font", UI.font(700))
	button.add_theme_font_size_override("font_size", 12)
	for key in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		button.add_theme_color_override(key, QUIET_INK)
	button.pressed.connect(on_press)
	return button


func _block(label: String, content: Control, label_weight := 400, label_gap := 0.0) -> VBoxContainer:
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", int(label_gap))
	box.add_child(_caption(label, 12, CAPTION, label_weight))
	box.add_child(content)
	return box


func show_event(event: Dictionary, on_source: Callable = Callable()) -> void:
	_on_source = on_source
	var transcript: Dictionary = event.get("transcript", {})
	var head := VBoxContainer.new()
	head.add_theme_constant_override("separation", 6)
	head.add_child(_scene_text(str(transcript.get("title", "")), 21, UI.WHITE, 800, 1.35))
	var facts := HFlowContainer.new()
	facts.add_theme_constant_override("h_separation", 8)
	var started := str(transcript.get("startedOn", ""))
	if not started.is_empty():
		facts.add_child(_caption(started))
	var beats: Array = transcript.get("beats", [])
	facts.add_child(_caption("%d moves" % beats.size()))
	facts.add_child(_caption("Ended by the player" if str(transcript.get("endedBy", "")) == "player" else "Resolved by the scene"))
	for child in facts.get_children():
		(child as Control).size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		(child as Label).autowrap_mode = TextServer.AUTOWRAP_OFF
	head.add_child(facts)
	_body.add_child(head)
	var source: Variant = transcript.get("source")
	if typeof(source) == TYPE_DICTIONARY and _on_source.is_valid():
		var source_id := str((source as Dictionary).get("id", ""))
		var link := _quiet("Source event: %s (%s)" % [str((source as Dictionary).get("title", "")), str((source as Dictionary).get("date", ""))], func() -> void:
			close()
			_on_source.call(source_id), true)
		_body.add_child(link)
	var premise := str(transcript.get("premise", ""))
	if not premise.is_empty():
		var premise_label := _scene_text(premise, 15, Color(1, 1, 1, 0.72))
		premise_label.add_theme_font_override("font", _italic())
		_body.add_child(premise_label)
	var request := str(transcript.get("request", ""))
	if not request.is_empty():
		_body.add_child(_caption("Your angle: %s" % request, 13))
	var opening := str(transcript.get("firstOpening", ""))
	if not opening.is_empty():
		_body.add_child(_block("Scene opening", _scene_text(opening), 800, 6.4))
	if not bool(transcript.get("complete", true)):
		_body.add_child(_caption("Some original scene text or choices were not saved. Only recorded information is shown."))
	for index in range(beats.size()):
		_body.add_child(_beat(beats[index], index))
	var outcome := VBoxContainer.new()
	outcome.add_theme_constant_override("separation", 0)
	var rule := ColorRect.new()
	rule.color = UiTheme.pick("line", Color(1, 1, 1, 0.12))
	rule.custom_minimum_size.y = 1
	outcome.add_child(rule)
	var gap := Control.new()
	gap.custom_minimum_size.y = 16
	outcome.add_child(gap)
	outcome.add_child(_caption("Outcome", 12, CAPTION, 800))
	var gap2 := Control.new()
	gap2.custom_minimum_size.y = 4.8
	outcome.add_child(gap2)
	outcome.add_child(_scene_text(str(event.get("title", "")), 16, UI.WHITE, 800))
	var description := str(event.get("description", ""))
	if not description.is_empty():
		var gap3 := Control.new()
		gap3.custom_minimum_size.y = 6.4
		outcome.add_child(gap3)
		outcome.add_child(_scene_text(description))
	_body.add_child(outcome)
	_layout.call_deferred()


func _beat(beat: Dictionary, index: int) -> Control:
	var holder := HBoxContainer.new()
	holder.add_theme_constant_override("separation", 0)
	var line := ColorRect.new()
	line.color = Color(250 / 255.0, 204 / 255.0, 21 / 255.0, 0.35)
	line.custom_minimum_size.x = 2
	holder.add_child(line)
	var margin := MarginContainer.new()
	margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	margin.add_theme_constant_override("margin_left", 16)
	margin.add_theme_constant_override("margin_top", 3)
	margin.add_theme_constant_override("margin_bottom", 10)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 11)
	column.add_child(_caption("Move %d" % (index + 1), 12, GOLD, 800))
	var before := str(beat.get("before", ""))
	if not before.is_empty():
		column.add_child(_block("Before the move", _scene_text(before)))
	var offered: Array = beat.get("offered", [])
	var choice := str(beat.get("choice", ""))
	if not offered.is_empty():
		var choices := VBoxContainer.new()
		choices.add_theme_constant_override("separation", 4)
		for item in offered:
			var picked := str(item) == choice
			var entry := UI.wrapped("•  " + str(item), 13, GOLD if picked else Color(1, 1, 1, 0.65), 700 if picked else 400)
			entry.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			choices.add_child(entry)
		var padded := MarginContainer.new()
		padded.add_theme_constant_override("margin_left", 6)
		padded.add_theme_constant_override("margin_top", 5)
		padded.add_theme_constant_override("margin_bottom", 5)
		padded.add_child(choices)
		column.add_child(_block("Offered choices", padded))
	var move := PanelContainer.new()
	move.add_theme_stylebox_override("panel", UI.box(Color(250 / 255.0, 204 / 255.0, 21 / 255.0, 0.06), Color(250 / 255.0, 204 / 255.0, 21 / 255.0, 0.18), 8, 1, Vector4(12.8, 10.4, 12.8, 10.4)))
	var move_column := VBoxContainer.new()
	move_column.add_theme_constant_override("separation", 0)
	move_column.add_child(_caption("Your move", 12, GOLD))
	move_column.add_child(_scene_text(choice))
	move.add_child(move_column)
	column.add_child(move)
	var summary := str(beat.get("summary", ""))
	if not summary.is_empty():
		column.add_child(_block("Scene response", _scene_text(summary), 400, 4.8))
	margin.add_child(column)
	holder.add_child(margin)
	return holder
