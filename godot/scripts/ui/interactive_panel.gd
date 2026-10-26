class_name InteractivePanel
extends Control

signal opened
signal closed
signal open_timeline
signal world_changed

const YELLOW := Color("#facc15")
const CAPTION := Color(1, 1, 1, 0.42)

var engine: EngineLink
var show_timeline_link := true

var _open := false
var _state := {}
var _angle := ""
var _move := ""
var _busy := ""
var _error := ""
var _finished: Variant = null
var _confirming_aside := false
var _card: PanelContainer
var _body: VBoxContainer
var _scroll: ScrollContainer
var _italic_font: Font
var _header: Control
var _content_margin: MarginContainer


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	visible = false
	var backdrop := ColorRect.new()
	backdrop.color = Color(0, 0, 0, 0.55)
	backdrop.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(backdrop)
	_card = PanelContainer.new()
	_card.add_theme_stylebox_override("panel", UI.box(Color(18 / 255.0, 18 / 255.0, 22 / 255.0, 0.97), Color(250 / 255.0, 204 / 255.0, 21 / 255.0, 0.38), 16, 1))
	_card.clip_contents = true
	add_child(_card)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	_card.add_child(column)
	var header := MarginContainer.new()
	for side: Array in [["margin_left", 18], ["margin_right", 18], ["margin_top", 14], ["margin_bottom", 14]]:
		header.add_theme_constant_override(side[0], side[1])
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	var titles := VBoxContainer.new()
	titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	titles.add_theme_constant_override("separation", 2)
	titles.add_child(UI.label("⚡ Interactive event", 15, YELLOW, 850))
	titles.add_child(_caption("A moment of the campaign played out as a scene. Time stands still until it ends."))
	row.add_child(titles)
	var leave := _quiet("✕ Leave", func() -> void: close(), false)
	leave.tooltip_text = "Close — a scene in progress stays where it is, and an offer stays until the next time skip"
	leave.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(leave)
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
	var margin := MarginContainer.new()
	margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for side: Array in [["margin_left", 18], ["margin_right", 18], ["margin_top", 16], ["margin_bottom", 18]]:
		margin.add_theme_constant_override(side[0], side[1])
	_body = VBoxContainer.new()
	_body.add_theme_constant_override("separation", 14)
	_body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	margin.add_child(_body)
	_scroll.add_child(margin)
	_content_margin = margin
	column.add_child(_scroll)
	resized.connect(_layout)
	_body.minimum_size_changed.connect(func() -> void: _layout.call_deferred())


func setup(engine_link: EngineLink, context: Dictionary = {}) -> void:
	engine = engine_link
	if context.has("show_timeline_link"):
		show_timeline_link = bool(context.get("show_timeline_link"))
	if not engine.engine_event.is_connected(_on_engine_event):
		engine.engine_event.connect(_on_engine_event)


func is_open() -> bool:
	return _open


func open() -> void:
	_open = true
	visible = true
	_finished = null
	_error = ""
	modulate.a = 0.0
	var fade := create_tween()
	fade.tween_property(self, "modulate:a", 1.0, 0.16)
	opened.emit()
	await refresh()


func close() -> void:
	if not _open:
		return
	_open = false
	_confirming_aside = false
	visible = false
	closed.emit()


func set_open(value: bool) -> void:
	if value:
		open()
	else:
		close()


func refresh() -> void:
	if not engine:
		return
	var reply: Dictionary = await engine.request("interactive.state")
	if reply.get("ok", false) and typeof(reply.get("result")) == TYPE_DICTIONARY:
		_state = reply["result"]
	_render()


func _on_engine_event(name: String, _data: Variant) -> void:
	if _open and _busy.is_empty() and name in ["turn.landed", "interactive.changed"]:
		refresh()


func _input(event: InputEvent) -> void:
	if _open and event is InputEventKey and (event as InputEventKey).pressed and (event as InputEventKey).keycode == KEY_ESCAPE:
		get_viewport().set_input_as_handled()
		close()


func _layout() -> void:
	var view := size if size.x > 0.0 else get_viewport_rect().size
	var width := minf(640.0, view.x - 32.0)
	var height := minf(736.0, view.y - 32.0)
	var wanted := _header.get_combined_minimum_size().y + 1.0 + _content_margin.get_combined_minimum_size().y
	height = minf(height, wanted)
	_card.size = Vector2(width, height)
	_card.position = (view - _card.size) * 0.5


func _relayout() -> void:
	if not is_inside_tree():
		return
	await get_tree().process_frame
	await get_tree().process_frame
	_layout()


func _italic() -> Font:
	if _italic_font:
		return _italic_font
	var system := SystemFont.new()
	system.font_names = PackedStringArray(["Arial", "Segoe UI", "Helvetica", "sans-serif"])
	system.font_italic = true
	system.antialiasing = TextServer.FONT_ANTIALIASING_GRAY
	_italic_font = system
	return _italic_font


func _caption(text: String, size := 11, color := CAPTION) -> Label:
	var node := UI.wrapped(text, size, color)
	node.add_theme_constant_override("line_spacing", 3)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


func _scene_text(text: String, size := 14, color := UI.WHITE, weight := 400) -> Label:
	var node := UI.wrapped(text, size, color, weight)
	node.add_theme_constant_override("line_spacing", int(round(size * 0.45)))
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


func _quiet(text: String, on_press: Callable, disabled: bool) -> Button:
	var button := Button.new()
	button.text = text
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_ARROW if disabled else Control.CURSOR_POINTING_HAND
	var normal := UI.box(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.12), 10, 1, Vector4(14.4, 8.8, 14.4, 8.8))
	var hover := UI.box(Color(1, 1, 1, 0.09), Color(1, 1, 1, 0.18), 10, 1, Vector4(14.4, 8.8, 14.4, 8.8))
	for state in ["normal", "focus", "disabled"]:
		button.add_theme_stylebox_override(state, normal)
	for state in ["hover", "pressed", "hover_pressed"]:
		button.add_theme_stylebox_override(state, normal if disabled else hover)
	button.add_theme_font_override("font", UI.font(700))
	button.add_theme_font_size_override("font_size", 12)
	var ink := Color(1, 1, 1, 0.35) if disabled else Color(1, 1, 1, 0.85)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color", "font_disabled_color"]:
		button.add_theme_color_override(name, ink)
	button.disabled = disabled
	button.pressed.connect(func() -> void: on_press.call())
	return button


func _primary(text: String, on_press: Callable, disabled: bool) -> Button:
	var button := Button.new()
	button.text = text
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_ARROW if disabled else Control.CURSOR_POINTING_HAND
	var color := Color(250 / 255.0, 204 / 255.0, 21 / 255.0, 0.25) if disabled else YELLOW
	var normal := UI.box(color, Color(0, 0, 0, 0), 10, 0, Vector4(16, 9.6, 16, 9.6))
	var hover := UI.box(color if disabled else YELLOW.lightened(0.12), Color(0, 0, 0, 0), 10, 0, Vector4(16, 9.6, 16, 9.6))
	for state in ["normal", "focus", "disabled"]:
		button.add_theme_stylebox_override(state, normal)
	for state in ["hover", "pressed", "hover_pressed"]:
		button.add_theme_stylebox_override(state, hover)
	button.add_theme_font_override("font", UI.font(800))
	button.add_theme_font_size_override("font_size", 13)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color", "font_disabled_color"]:
		button.add_theme_color_override(name, Color("#1c1917"))
	button.disabled = disabled
	button.pressed.connect(func() -> void: on_press.call())
	return button


func _choice(text: String, disabled: bool) -> Button:
	var button := Button.new()
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_ARROW if disabled else Control.CURSOR_POINTING_HAND
	button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var normal := UI.box(Color(250 / 255.0, 204 / 255.0, 21 / 255.0, 0.06), Color(250 / 255.0, 204 / 255.0, 21 / 255.0, 0.28), 10, 1)
	var hover := UI.box(Color(250 / 255.0, 204 / 255.0, 21 / 255.0, 0.12), Color(250 / 255.0, 204 / 255.0, 21 / 255.0, 0.45), 10, 1)
	for state in ["normal", "focus", "disabled"]:
		button.add_theme_stylebox_override(state, normal)
	for state in ["hover", "pressed", "hover_pressed"]:
		button.add_theme_stylebox_override(state, normal if disabled else hover)
	var label := UI.wrapped(text, 13, Color(1, 1, 1, 0.4) if disabled else Color("#fef9c3"))
	label.add_theme_constant_override("line_spacing", 5)
	label.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	label.offset_left = 12.8
	label.offset_right = -12.8
	label.offset_top = 9.6
	label.offset_bottom = -9.6
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	button.add_child(label)
	button.custom_minimum_size.y = 42
	button.resized.connect(func() -> void:
		var wanted := label.get_minimum_size().y + 19.2
		if absf(button.custom_minimum_size.y - wanted) > 0.5:
			button.custom_minimum_size.y = maxf(42.0, wanted))
	button.disabled = disabled
	button.pressed.connect(func() -> void: _play(text))
	return button


func _input_box(control: Control) -> void:
	var normal := UI.box(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.14), 10, 1, Vector4(12, 9.6, 12, 9.6))
	var focus := UI.box(Color(1, 1, 1, 0.07), Color(1, 1, 1, 0.24), 10, 1, Vector4(12, 9.6, 12, 9.6))
	control.add_theme_stylebox_override("normal", normal)
	control.add_theme_stylebox_override("focus", focus)
	control.add_theme_stylebox_override("read_only", normal)
	control.add_theme_font_override("font", UI.font(400))
	control.add_theme_font_size_override("font_size", 13)
	control.add_theme_color_override("font_color", UI.WHITE)
	control.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.38))


func _render() -> void:
	for child in _body.get_children():
		_body.remove_child(child)
		child.queue_free()
	var idle := _busy.is_empty()
	if typeof(_finished) == TYPE_DICTIONARY:
		_body.add_child(_finished_banner(_finished))
	var scene: Variant = _state.get("scene")
	var offer: Variant = _state.get("offer")
	if typeof(scene) == TYPE_DICTIONARY:
		_render_scene(scene, idle)
	elif typeof(offer) == TYPE_DICTIONARY:
		_render_offer(offer, idle)
	elif typeof(_finished) != TYPE_DICTIONARY:
		_body.add_child(_caption("No interactive event is waiting. Now and then a time skip offers one of its events that concerns you to be played out; the event's card says so.", 13))
	if not _busy.is_empty():
		_body.add_child(UI.label(_busy, 12, YELLOW, 700))
	if not _error.is_empty():
		var error := UI.wrapped(_error, 12, Color("#fca5a5"))
		error.add_theme_constant_override("line_spacing", 3)
		_body.add_child(error)
	_relayout()


func _finished_banner(finished: Dictionary) -> Control:
	var box := PanelContainer.new()
	box.add_theme_stylebox_override("panel", UI.box(Color(250 / 255.0, 204 / 255.0, 21 / 255.0, 0.08), Color(250 / 255.0, 204 / 255.0, 21 / 255.0, 0.3), 10, 1, Vector4(13.6, 11.2, 13.6, 11.2)))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	var text := RichTextLabel.new()
	text.bbcode_enabled = true
	text.fit_content = true
	text.scroll_active = false
	text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	text.add_theme_font_override("normal_font", UI.font(400))
	text.add_theme_font_override("bold_font", UI.font(800))
	text.add_theme_font_size_override("normal_font_size", 13)
	text.add_theme_font_size_override("bold_font_size", 13)
	text.add_theme_color_override("default_color", UI.WHITE)
	var title := str(finished.get("title", ""))
	text.text = "The scene is over and written into the record%s." % ((": [b]%s[/b]" % title.replace("[", "[lb]")) if not title.is_empty() else "")
	row.add_child(text)
	if show_timeline_link:
		var link := _quiet("See it on the timeline", func() -> void:
			open_timeline.emit()
			close(), false)
		link.add_theme_stylebox_override("normal", UI.box(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.12), 10, 1, Vector4(9.6, 4.8, 9.6, 4.8)))
		link.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(link)
	box.add_child(row)
	return box


func _render_scene(scene: Dictionary, idle: bool) -> void:
	var head := VBoxContainer.new()
	head.add_theme_constant_override("separation", 3)
	var title := str(scene.get("title", ""))
	head.add_child(_scene_text(title if not title.is_empty() else "Untitled scene", 17, UI.WHITE, 850))
	var premise := str(scene.get("premise", ""))
	if not premise.is_empty():
		var premise_label := _scene_text(premise, 12, Color(1, 1, 1, 0.55))
		premise_label.add_theme_font_override("font", _italic())
		head.add_child(premise_label)
	var request := str(scene.get("request", ""))
	if not request.is_empty():
		head.add_child(_caption("Your angle: %s" % request))
	_body.add_child(head)
	var beats: Array = scene.get("beats", [])
	if not beats.is_empty():
		var list := VBoxContainer.new()
		list.add_theme_constant_override("separation", 8)
		for index in range(beats.size()):
			var beat: Dictionary = beats[index]
			var card := PanelContainer.new()
			card.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.03), Color(1, 1, 1, 0.07), 10, 1, Vector4(11.2, 8.8, 11.2, 8.8)))
			var column := VBoxContainer.new()
			column.add_theme_constant_override("separation", 4)
			var top := HBoxContainer.new()
			top.add_theme_constant_override("separation", 8)
			var move := UI.wrapped("Your move: %s" % str(beat.get("choice", "")), 12, Color("#fde68a"))
			move.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			top.add_child(move)
			if bool(beat.get("canRewind", false)):
				var beat_index := index
				var back := _quiet("↶ Take back", func() -> void: _take_back(beat_index), not idle)
				back.add_theme_font_size_override("font_size", 11)
				for state in ["normal", "focus", "disabled"]:
					back.add_theme_stylebox_override(state, UI.box(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.12), 10, 1, Vector4(8, 3.2, 8, 3.2)))
				back.tooltip_text = "Return the scene to just before this move — free; choosing again is one request"
				back.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
				top.add_child(back)
			column.add_child(top)
			var summary := str(beat.get("summary", ""))
			if not summary.is_empty():
				column.add_child(_scene_text(summary, 13, Color(1, 1, 1, 0.72)))
			card.add_child(column)
			list.add_child(card)
		_body.add_child(list)
	else:
		var opening := str(scene.get("opening", ""))
		if not opening.is_empty():
			_body.add_child(_scene_text(opening, 14))
	var choices := VBoxContainer.new()
	choices.add_theme_constant_override("separation", 7)
	for choice: Variant in scene.get("choices", []):
		choices.add_child(_choice(str(choice), not idle))
	_body.add_child(choices)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	var line := LineEdit.new()
	line.text = _move
	line.placeholder_text = "Or write your own move…"
	line.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	line.custom_minimum_size.y = 40
	line.editable = idle
	_input_box(line)
	row.add_child(line)
	var play := _primary("Play", func() -> void: _play(_move), not idle or _move.strip_edges().is_empty())
	line.text_changed.connect(func(text: String) -> void:
		_move = text
		var off := not _busy.is_empty() or _move.strip_edges().is_empty()
		play.disabled = off
		var color := Color(250 / 255.0, 204 / 255.0, 21 / 255.0, 0.25) if off else YELLOW
		play.add_theme_stylebox_override("normal", UI.box(color, Color(0, 0, 0, 0), 10, 0, Vector4(16, 9.6, 16, 9.6)))
		play.add_theme_stylebox_override("disabled", UI.box(color, Color(0, 0, 0, 0), 10, 0, Vector4(16, 9.6, 16, 9.6))))
	line.text_submitted.connect(func(_text: String) -> void: _play(_move))
	row.add_child(play)
	_body.add_child(row)
	_body.add_child(_caption("Each move is one AI request. The scene ends when it reaches its outcome, or when you end it."))
	var footer := VBoxContainer.new()
	footer.add_theme_constant_override("separation", 0)
	var rule := ColorRect.new()
	rule.color = Color(1, 1, 1, 0.07)
	rule.custom_minimum_size.y = 1
	footer.add_child(rule)
	var gap := Control.new()
	gap.custom_minimum_size.y = 12.8
	footer.add_child(gap)
	var actions := HFlowContainer.new()
	actions.add_theme_constant_override("h_separation", 10)
	actions.add_theme_constant_override("v_separation", 8)
	var end := _quiet("End the scene", func() -> void: _end(), not idle or beats.is_empty())
	end.tooltip_text = "Write what has happened into the record — one request" if not beats.is_empty() else "Play a move first; with none played there is nothing to record"
	actions.add_child(end)
	var aside_text := "Set aside"
	if _confirming_aside:
		aside_text = "You've played 1 move — set it aside anyway?" if beats.size() == 1 else "You've played %d moves — set it aside anyway?" % beats.size()
	var aside := _quiet(aside_text, func() -> void: _set_aside(beats.size()), not idle)
	aside.tooltip_text = "Press again to set the scene aside: the moves played in it are not kept" if _confirming_aside else "Close the scene without writing anything — free"
	if _confirming_aside:
		var red := UI.box(Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.2), Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.6), 10, 1, Vector4(14.4, 8.8, 14.4, 8.8))
		for state in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
			aside.add_theme_stylebox_override(state, red)
		for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
			aside.add_theme_color_override(name, Color("#fca5a5"))
		aside.mouse_exited.connect(func() -> void:
			if _confirming_aside:
				_confirming_aside = false
				_render.call_deferred())
	actions.add_child(aside)
	var note := _caption("Ending writes the scene into the record (one request). Setting it aside keeps nothing.")
	note.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	note.custom_minimum_size.x = 200
	actions.add_child(note)
	footer.add_child(actions)
	_body.add_child(footer)


func _render_offer(offer: Dictionary, idle: bool) -> void:
	var revealing := bool(_state.get("revealing", false))
	var head := VBoxContainer.new()
	head.add_theme_constant_override("separation", 3)
	head.add_child(_caption("The last time skip offers this moment to be played out"))
	head.add_child(_scene_text(str(offer.get("title", "")), 17, UI.WHITE, 850))
	var date := str(offer.get("date", ""))
	if not date.is_empty():
		head.add_child(_caption(date))
	var description := str(offer.get("description", ""))
	if not description.is_empty():
		var spacer := Control.new()
		spacer.custom_minimum_size.y = 4
		head.add_child(spacer)
		var scroll := ScrollContainer.new()
		scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
		var text := _scene_text(description, 13, Color(1, 1, 1, 0.72))
		scroll.add_child(text)
		scroll.custom_minimum_size.y = minf(152.0, maxf(24.0, float(description.length()) / 78.0 * 21.0 + 22.0))
		head.add_child(scroll)
	_body.add_child(head)
	var label_row := HBoxContainer.new()
	label_row.add_theme_constant_override("separation", 5)
	label_row.add_child(UI.label("Your angle", 13, UI.WHITE, 800))
	var optional := UI.label("(optional)", 11, CAPTION)
	optional.size_flags_vertical = Control.SIZE_SHRINK_END
	label_row.add_child(optional)
	_body.add_child(label_row)
	var area := TextEdit.new()
	area.text = _angle
	area.placeholder_text = "Who you are in the room, what you are after… Leave it empty and the scene is built on the event as it stands."
	area.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	area.custom_minimum_size.y = 66
	area.editable = idle
	_input_box(area)
	area.text_changed.connect(func() -> void: _angle = area.text)
	_body.add_child(area)
	if revealing:
		_body.add_child(_caption("Finish revealing the last time skip first: a scene starts from what you have seen.", 11, Color("#fde68a")))
	var row := HFlowContainer.new()
	row.add_theme_constant_override("h_separation", 12)
	row.add_theme_constant_override("v_separation", 8)
	row.add_child(_primary("Play it out", func() -> void: _begin(str(offer.get("id", ""))), not idle or revealing))
	var pass_button := _quiet("Let it pass", func() -> void: _let_pass(), not idle)
	pass_button.tooltip_text = "Let the moment pass as it happened — free"
	row.add_child(pass_button)
	var note := _caption("Playing it out is one AI request, and each move is one more. Ending it yourself is one more; a scene that reaches its own end is usually written up with its last move. Letting it pass costs nothing.")
	note.custom_minimum_size.x = 260
	note.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(note)
	_body.add_child(row)


func _run(label: String, method: String, args: Dictionary) -> Variant:
	if not _busy.is_empty() or not engine:
		return null
	_busy = label
	_error = ""
	_render()
	var reply: Dictionary = await engine.request(method, args)
	_busy = ""
	if not reply.get("ok", false):
		_error = str(reply.get("error", "Something went wrong."))
		_render()
		return null
	return reply.get("result")


func _apply_state(result: Variant) -> void:
	if typeof(result) != TYPE_DICTIONARY:
		return
	var data: Dictionary = result
	if data.has("state") and typeof(data.get("state")) == TYPE_DICTIONARY:
		_state = data["state"]
	elif data.has("scene") or data.has("offer"):
		_state = data


func _begin(event_id: String) -> void:
	_finished = null
	var result: Variant = await _run("Writing the scene…", "interactive.create", {"eventId": event_id, "angle": _angle})
	if typeof(result) == TYPE_DICTIONARY:
		_apply_state(result)
		_angle = ""
	_render()


func _let_pass() -> void:
	var result: Variant = await _run("Letting it pass…", "interactive.decline", {})
	if typeof(result) == TYPE_DICTIONARY:
		_apply_state(result)
		world_changed.emit()
		close()
		return
	_render()


func _play(text: String) -> void:
	var wording := text.strip_edges()
	if wording.is_empty() or not _busy.is_empty():
		return
	_confirming_aside = false
	var result: Variant = await _run("Playing the move…", "interactive.advance", {"text": wording})
	if typeof(result) == TYPE_DICTIONARY:
		_move = ""
		_apply_state(result)
		var finished: Variant = (result as Dictionary).get("finished")
		if typeof(finished) == TYPE_DICTIONARY:
			_finished = finished
			world_changed.emit()
	_render()


func _take_back(index: int) -> void:
	_confirming_aside = false
	var result: Variant = await _run("Taking the move back…", "interactive.rewind", {"index": index})
	_apply_state(result)
	_render()


func _end() -> void:
	_confirming_aside = false
	var result: Variant = await _run("Writing the scene into the record…", "interactive.end", {})
	if typeof(result) == TYPE_DICTIONARY:
		_apply_state(result)
		var finished: Variant = (result as Dictionary).get("finished")
		if typeof(finished) == TYPE_DICTIONARY:
			_finished = finished
		world_changed.emit()
	_render()


func _set_aside(beats: int) -> void:
	if beats > 0 and not _confirming_aside:
		_confirming_aside = true
		_render()
		return
	_confirming_aside = false
	var result: Variant = await _run("Setting the scene aside…", "interactive.setAside", {})
	_apply_state(result)
	_render()
