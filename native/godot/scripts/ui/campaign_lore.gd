extends Control

signal closed

const PAGE_SIZE := 30

var engine: EngineLink
var context := {}

var _options := {}
var _info := {}
var _snapshot: Variant = null
var _list := {}
var _text := {}
var _status := ""
var _busy := false
var _stale := false
var _chronicle: Variant = null
var _chronicle_busy := false
var _chronicle_status := ""
var _chronicle_call := 0
var _requests := 0
var _saved := ""
var _open_events := {}
var _show_text := false
var _show_limits := false
var _show_sources := false
var _seq := 0

var _card: PanelContainer
var _scroll: ScrollContainer
var _body: VBoxContainer
var _footer: HFlowContainer
var _header: Control
var _footer_box: Control


static func panel_bg() -> Color:
	return Color("#14202d")


static func field_bg() -> Color:
	return UiTheme.pick("overlay_card", Color("#202c38"))


static func line() -> Color:
	return UiTheme.pick("line", Color("#394653"))


static func active_bg() -> Color:
	return UiTheme.pick("active", Color("#30455c"))


static func muted() -> Color:
	return UiTheme.pick("muted", Color("#a9b6c5"))


static func ink() -> Color:
	return UiTheme.pick("text", Color("#f1f5f9"))


func setup(engine_link: EngineLink, menu_context: Dictionary = {}) -> void:
	engine = engine_link
	context = menu_context
	if not engine.engine_event.is_connected(_on_engine_event):
		engine.engine_event.connect(_on_engine_event)


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	var backdrop := ColorRect.new()
	backdrop.color = Color(0, 0, 0, 0.66)
	backdrop.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(backdrop)
	_card = PanelContainer.new()
	_card.clip_contents = true
	_card.add_theme_stylebox_override("panel", UI.box(panel_bg(), UiTheme.pick("line", Color("#415264")), 14, 1))
	add_child(_card)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	_card.add_child(column)
	var header := MarginContainer.new()
	for side: Array in [["margin_left", 19], ["margin_right", 19], ["margin_top", 16], ["margin_bottom", 16]]:
		header.add_theme_constant_override(side[0], side[1])
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 16)
	var titles := VBoxContainer.new()
	titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	titles.add_theme_constant_override("separation", 2)
	titles.add_child(UI.label("Campaign Lore", 18, ink(), 850))
	titles.add_child(_muted("Read and export your campaign's recorded history."))
	row.add_child(titles)
	var close_button := _button("Close", close)
	close_button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(close_button)
	header.add_child(row)
	column.add_child(header)
	_header = header
	column.add_child(_rule())
	_scroll = ScrollContainer.new()
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var bar := _scroll.get_v_scroll_bar()
	bar.add_theme_stylebox_override("scroll", StyleBoxEmpty.new())
	bar.add_theme_stylebox_override("grabber", UI.box(Color(1, 1, 1, 0.16), Color(0, 0, 0, 0), 999, 0))
	var margin := MarginContainer.new()
	margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for side: Array in [["margin_left", 19], ["margin_right", 19], ["margin_top", 16], ["margin_bottom", 16]]:
		margin.add_theme_constant_override(side[0], side[1])
	_body = VBoxContainer.new()
	_body.add_theme_constant_override("separation", 16)
	_body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	margin.add_child(_body)
	_scroll.add_child(margin)
	column.add_child(_scroll)
	var foot := VBoxContainer.new()
	foot.add_theme_constant_override("separation", 0)
	foot.add_child(_rule())
	var foot_margin := MarginContainer.new()
	for side: Array in [["margin_left", 19], ["margin_right", 19], ["margin_top", 13], ["margin_bottom", 13]]:
		foot_margin.add_theme_constant_override(side[0], side[1])
	_footer = HFlowContainer.new()
	_footer.add_theme_constant_override("h_separation", 8)
	_footer.add_theme_constant_override("v_separation", 8)
	foot_margin.add_child(_footer)
	foot.add_child(foot_margin)
	column.add_child(foot)
	_footer_box = foot
	resized.connect(_layout)


func open() -> void:
	visible = true
	var reply: Dictionary = await engine.request("lore.open")
	var result: Dictionary = reply.get("result", {}) if reply.get("ok", false) and typeof(reply.get("result")) == TYPE_DICTIONARY else {}
	_info = result
	_options = (result.get("defaults", {}) as Dictionary).duplicate() if typeof(result.get("defaults")) == TYPE_DICTIONARY else {"scope": "global", "from": "", "to": "", "actions": false, "conversations": false, "transcripts": false, "snapshot": true}
	_options["to"] = str(result.get("currentDate", ""))
	_render()


func close() -> void:
	_seq += 1
	if _chronicle_busy and engine:
		engine.request("lore.cancelChronicle")
	if engine:
		engine.request("lore.forget")
	closed.emit()
	queue_free()


func _input(event: InputEvent) -> void:
	if visible and event is InputEventKey and (event as InputEventKey).pressed and (event as InputEventKey).keycode == KEY_ESCAPE:
		get_viewport().set_input_as_handled()
		close()


func _on_engine_event(event_name: String, data: Variant) -> void:
	if event_name == "lore.stale":
		_stale = true
		_render()
	elif event_name == "lore.requests" and data is Dictionary:
		_requests = int((data as Dictionary).get("count", _requests))
		_render()


func _layout() -> void:
	var view := size if size.x > 0.0 else get_viewport_rect().size
	var inset := UI.safe_insets()
	var width := minf(896.0, view.x - 24.0 - inset.x - inset.z)
	var height := view.y - 24.0 - inset.y - inset.w
	var wanted := _header.get_combined_minimum_size().y + 1.0 + (_scroll.get_child(0) as Control).get_combined_minimum_size().y + _footer_box.get_combined_minimum_size().y
	_card.size = Vector2(width, minf(height, wanted))
	_card.position = Vector2(inset.x + (view.x - inset.x - inset.z - _card.size.x) * 0.5, inset.y + (view.y - inset.y - inset.w - _card.size.y) * 0.5)


func _relayout() -> void:
	if not is_inside_tree():
		return
	await get_tree().process_frame
	_layout()


func _rule() -> ColorRect:
	var rule := ColorRect.new()
	rule.color = line()
	rule.custom_minimum_size.y = 1
	return rule


func _muted(text: String) -> Label:
	var node := UI.wrapped(text, 12, muted())
	node.add_theme_constant_override("line_spacing", 6)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


func _strong(text: String, size := 14) -> Label:
	var node := UI.wrapped(text, size, ink(), 700)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


func _field_style(bg: Color) -> StyleBoxFlat:
	return UI.box(bg, line(), 8, 1, Vector4(11.2, 8.8, 11.2, 8.8))


func _button(text: String, on_press: Callable, active := false, disabled := false) -> Button:
	var button := Button.new()
	button.text = text
	button.focus_mode = Control.FOCUS_NONE
	button.custom_minimum_size.y = 40
	button.mouse_default_cursor_shape = Control.CURSOR_ARROW if disabled else Control.CURSOR_POINTING_HAND
	var bg := active_bg() if active else field_bg()
	var normal := _field_style(bg)
	for state in ["normal", "focus", "disabled", "hover", "pressed", "hover_pressed"]:
		button.add_theme_stylebox_override(state, normal if state in ["normal", "focus", "disabled"] or disabled else _field_style(bg.lightened(0.06)))
	button.add_theme_font_override("font", UI.font(700))
	button.add_theme_font_size_override("font_size", 14)
	for key in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color", "font_disabled_color"]:
		button.add_theme_color_override(key, ink())
	button.disabled = disabled
	if disabled:
		button.modulate.a = 0.5
	button.pressed.connect(on_press)
	return button


func _section(boxed: bool, gap := 11) -> VBoxContainer:
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", gap)
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	if not boxed:
		_body.add_child(column)
		return column
	var frame := PanelContainer.new()
	frame.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0), line(), 10, 1, Vector4(13.6, 13.6, 13.6, 13.6)))
	frame.add_child(column)
	_body.add_child(frame)
	return column


func _labelled(title: String, control: Control) -> VBoxContainer:
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 4)
	box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	box.add_child(UI.label(title, 14, ink()))
	box.add_child(control)
	return box


func _input_style(control: Control) -> void:
	for state in ["normal", "focus", "read_only", "hover", "pressed", "disabled"]:
		control.add_theme_stylebox_override(state, _field_style(field_bg()))
	control.add_theme_font_size_override("font_size", 14)
	control.add_theme_color_override("font_color", ink())
	control.add_theme_color_override("font_placeholder_color", Color(muted(), 0.7))


func _disabled_fields() -> bool:
	return _busy or _chronicle_busy


func _render() -> void:
	for child in _body.get_children():
		_body.remove_child(child)
		child.queue_free()
	for child in _footer.get_children():
		_footer.remove_child(child)
		child.queue_free()
	_render_campaign()
	_render_coverage()
	if _stale and _snapshot != null:
		_body.add_child(_muted("The campaign changed. Refresh the preview before exporting."))
	if _snapshot != null:
		_render_chronology()
		_render_chronicle()
	if not _status.is_empty():
		_body.add_child(_muted(_status))
	if not _saved.is_empty():
		_body.add_child(_muted("Saved to %s" % _saved))
	var off := _snapshot == null or _busy or _stale
	_footer.add_child(_button("Download Markdown", _download.bind("md"), true, off))
	_footer.add_child(_button("Download JSON", _download.bind("json"), false, off))
	_footer.add_child(_button("Copy record", _copy, false, off))
	_relayout()


func _render_campaign() -> void:
	var column := _section(false, 5)
	column.add_child(_strong(str(context.get("gameName", "")), 16))
	var start := str(_info.get("startDate", ""))
	var current := str(_info.get("currentDate", ""))
	var parts: Array[String] = []
	for value in [str(context.get("scenarioName", "")), str(context.get("countryName", "")), ("%s - %s" % [start, current]) if not start.is_empty() and not current.is_empty() else current]:
		if not value.is_empty():
			parts.append(value)
	column.add_child(_muted(" · ".join(parts)))
	column.add_child(_muted("Native record · No AI requests · Not a reloadable save"))


func _render_coverage() -> void:
	var column := _section(true)
	column.add_child(_strong("Export coverage"))
	var scope := OptionButton.new()
	scope.focus_mode = Control.FOCUS_NONE
	scope.add_item("World history")
	scope.add_item("Player-focused history")
	scope.select(1 if str(_options.get("scope", "global")) == "player" else 0)
	scope.disabled = _disabled_fields()
	_input_style(scope)
	scope.item_selected.connect(_on_scope)
	column.add_child(_labelled("History scope", scope))
	var dates := HFlowContainer.new()
	dates.add_theme_constant_override("h_separation", 10)
	dates.add_theme_constant_override("v_separation", 10)
	for spec: Array in [["from", "From game date", "All retained dates"], ["to", "Through game date", "Current game date"]]:
		var field := LineEdit.new()
		field.text = str(_options.get(spec[0], ""))
		field.placeholder_text = spec[2]
		field.editable = not _disabled_fields()
		field.custom_minimum_size.y = 38
		_input_style(field)
		field.text_changed.connect(_on_date.bind(str(spec[0])))
		var box := _labelled(spec[1], field)
		box.custom_minimum_size.x = 144
		dates.add_child(box)
	dates.resized.connect(_fit_dates.bind(dates))
	column.add_child(dates)
	for spec: Array in [["snapshot", "Current world snapshot"], ["actions", "My retained orders, private projects and standing goal"], ["conversations", "My advisor and diplomatic conversations"], ["transcripts", "Completed interactive event transcripts"]]:
		var check := CheckBox.new()
		check.text = spec[1]
		check.focus_mode = Control.FOCUS_NONE
		check.button_pressed = bool(_options.get(spec[0], false))
		check.disabled = _disabled_fields()
		check.add_theme_font_size_override("font_size", 14)
		check.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		check.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		for key in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
			check.add_theme_color_override(key, ink())
		check.add_theme_icon_override("unchecked", UI.svg_texture("<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><rect x='1.5' y='1.5' width='13' height='13' rx='2.5' fill='#ffffff' stroke='#767676'/></svg>", 1.0))
		check.add_theme_icon_override("unchecked_disabled", UI.svg_texture("<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><rect x='1.5' y='1.5' width='13' height='13' rx='2.5' fill='#ffffff' fill-opacity='0.5' stroke='#767676'/></svg>", 1.0))
		check.add_theme_icon_override("checked", UI.svg_texture("<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><rect x='1' y='1' width='14' height='14' rx='2.5' fill='#2bc1f3'/><path d='M4 8.2 L6.8 11 L12 5' fill='none' stroke='#06121a' stroke-width='2'/></svg>", 1.0))
		check.toggled.connect(_on_check.bind(str(spec[0])))
		column.add_child(check)
	column.add_child(_muted("Private sections are optional. Intelligence and hidden seat records are excluded. Review any personal text before sharing."))
	var label := "Reading campaign…" if _busy else ("Refresh preview" if _snapshot != null else "Generate preview")
	column.add_child(_button(label, _load_preview, true, _disabled_fields()))


func _fit_dates(dates: HFlowContainer) -> void:
	var wide := dates.size.x
	var each := maxf(144.0, (wide - 10.0) * 0.5) if wide >= 298.0 else wide
	for child in dates.get_children():
		var target := Vector2(each, 0)
		if (child as Control).custom_minimum_size.x != target.x:
			(child as Control).custom_minimum_size.x = target.x


func _render_chronology() -> void:
	var view: Dictionary = _snapshot
	var column := _section(false, 10)
	var top := HBoxContainer.new()
	top.add_theme_constant_override("separation", 8)
	top.add_child(_strong("Recorded chronology"))
	var counts := UI.label("%d events · %d KiB (Markdown)" % [int(view.get("eventCount", 0)), int(view.get("kib", 0))], 12, muted())
	top.add_child(counts)
	column.add_child(top)
	column.add_child(_muted("The download contains all selected records, not just this preview page."))
	var page := int(_list.get("page", 0))
	var pages := int(_list.get("pages", 1))
	column.add_child(_pager(page, pages, _event_page))
	var events: Array = _list.get("events", [])
	if events.is_empty():
		column.add_child(_muted("No matching retained events."))
	for index in range(events.size()):
		column.add_child(_event_row(events[index], page * PAGE_SIZE + index))
	var optional := _muted("Optional records included: %d orders · %d diplomatic threads · %d advisor messages" % [int(view.get("orders", 0)), int(view.get("diplomacy", 0)), int(view.get("advisor", 0))])
	column.add_child(optional)
	column.add_child(_details("Full record text preview", _show_text, _toggle_text))
	if _show_text:
		column.add_child(_muted("Review the exact Markdown export, including selected private material. Pages here are only for reading; downloads contain the entire selected record."))
		column.add_child(_pager(int(_text.get("page", 0)), int(_text.get("pages", 1)), _text_page))
		var pre := PanelContainer.new()
		pre.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0), line(), 8, 1, Vector4(9.6, 9.6, 9.6, 9.6)))
		var scroll := ScrollContainer.new()
		scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
		scroll.custom_minimum_size.y = 320
		var text := UI.wrapped(str(_text.get("text", "")), 13, ink())
		text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		text.add_theme_font_override("font", _mono())
		text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		scroll.add_child(text)
		pre.add_child(scroll)
		column.add_child(pre)
	column.add_child(_details("Coverage and limitations", _show_limits, _toggle_limits))
	if _show_limits:
		for limit in view.get("limitations", []):
			column.add_child(_muted("•  " + str(limit)))


func _mono() -> Font:
	var system := SystemFont.new()
	system.font_names = PackedStringArray(["Consolas", "Courier New", "monospace"])
	return system


func _pager(page: int, pages: int, on_step: Callable) -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	row.add_child(_button("Previous", on_step.bind(-1), false, page <= 0))
	var count := UI.label("%d / %d" % [page + 1, max(1, pages)], 12, muted())
	count.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	count.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(count)
	row.add_child(_button("Next", on_step.bind(1), false, page + 1 >= pages))
	return row


func _details(summary: String, open_now: bool, on_toggle: Callable) -> Button:
	var button := Button.new()
	button.text = ("▾ " if open_now else "▸ ") + summary
	button.flat = true
	button.alignment = HORIZONTAL_ALIGNMENT_LEFT
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.add_theme_font_size_override("font_size", 13)
	for key in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		button.add_theme_color_override(key, ink())
	for state in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
		button.add_theme_stylebox_override(state, StyleBoxEmpty.new())
	button.pressed.connect(on_toggle)
	return button


func _event_row(event: Dictionary, at: int) -> Control:
	var frame := PanelContainer.new()
	frame.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0), line(), 8, 1, Vector4(10.4, 10.4, 10.4, 10.4)))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 9)
	var date := str(event.get("date", ""))
	var title := str(event.get("title", ""))
	var open_now := _open_events.has(at)
	var head := _details("%s - %s" % [date if not date.is_empty() else "Undated", title if not title.is_empty() else "Untitled event"], open_now, _toggle_event.bind(at))
	head.add_theme_font_size_override("font_size", 14)
	head.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	column.add_child(head)
	if open_now:
		var text := UI.wrapped(str(event.get("description", "")), 14, ink())
		text.add_theme_constant_override("line_spacing", 8)
		text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		column.add_child(text)
		if bool(event.get("transcript", false)):
			column.add_child(_muted("Completed transcript included in export."))
	frame.add_child(column)
	return frame


func _render_chronicle() -> void:
	var view: Dictionary = _snapshot
	var column := _section(true)
	column.add_child(_strong("AI-generated campaign chronicle"))
	column.add_child(_muted("Optional narrative summary of the selected record. Generation sends these selected records to your configured AI provider. One generation request, with normal configured provider fallback and retry behavior; this may consume more than one provider request. Normal AI telemetry settings apply."))
	var fits := bool(view.get("fits", false))
	if not fits:
		column.add_child(_muted("The selected record exceeds the AI input limit. Narrow the dates or deselect optional sections. Your native export is not limited."))
	column.add_child(_muted("AI input size: %d / %d KiB" % [int(view.get("inputKib", 0)), int(view.get("maxKib", 96))]))
	var row := HFlowContainer.new()
	row.add_theme_constant_override("h_separation", 8)
	row.add_theme_constant_override("v_separation", 8)
	var off := _snapshot == null or _busy or _stale
	row.add_child(_button("Generating chronicle…" if _chronicle_busy else "Generate AI chronicle", _run_chronicle, false, off or _chronicle_busy or not fits))
	if _chronicle_busy:
		row.add_child(_button("Cancel", _cancel_chronicle))
	if _chronicle_busy or _requests > 0:
		var count := UI.label("Provider requests: %d" % _requests, 12, muted())
		count.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(count)
	column.add_child(row)
	if not _chronicle_status.is_empty():
		column.add_child(_muted(_chronicle_status))
	if typeof(_chronicle) != TYPE_DICTIONARY or _stale:
		return
	var chronicle: Dictionary = _chronicle
	column.add_child(_muted("AI-generated summary. References checked against the source record; narrative claims are not independently fact-checked."))
	column.add_child(_muted("Referenced source records: %d / %d" % [int(chronicle.get("referencedCount", 0)), int(chronicle.get("suppliedCount", 0))]))
	for section in chronicle.get("sections", []):
		var part := VBoxContainer.new()
		part.add_theme_constant_override("separation", 6)
		part.add_child(_rule())
		part.add_child(_strong(str(section.get("title", "")), 15))
		var text := UI.wrapped(str(section.get("text", "")), 14, ink())
		text.add_theme_constant_override("line_spacing", 9)
		text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		part.add_child(text)
		part.add_child(_muted("Sources: %s" % ", ".join(PackedStringArray(section.get("references", [])))))
		column.add_child(part)
	column.add_child(_details("Source reference index", _show_sources, _toggle_sources))
	if _show_sources:
		for source in chronicle.get("sources", []):
			column.add_child(_muted("•  " + str(source)))
	var actions := HFlowContainer.new()
	actions.add_theme_constant_override("h_separation", 8)
	actions.add_child(_button("Download chronicle", _save_chronicle.bind(false), false, off or _chronicle_busy))
	actions.add_child(_button("Copy chronicle", _save_chronicle.bind(true), false, off or _chronicle_busy))
	column.add_child(actions)


func _changed_option() -> void:
	_snapshot = null
	_chronicle = null
	_chronicle_status = ""
	_requests = 0
	_status = ""
	_saved = ""
	_open_events = {}


func _on_scope(index: int) -> void:
	_options["scope"] = "player" if index == 1 else "global"
	_changed_option()
	_render()


func _on_date(text: String, key: String) -> void:
	_options[key] = text
	var had := _snapshot != null
	_changed_option()
	if had:
		_render()
		var fields := _body.find_children("*", "LineEdit", true, false)
		var at := 0 if key == "from" else 1
		if fields.size() > at:
			(fields[at] as LineEdit).grab_focus()
			(fields[at] as LineEdit).caret_column = text.length()


func _on_check(on: bool, key: String) -> void:
	_options[key] = on
	_changed_option()
	_render()


func _toggle_text() -> void:
	_show_text = not _show_text
	_render()


func _toggle_limits() -> void:
	_show_limits = not _show_limits
	_render()


func _toggle_sources() -> void:
	_show_sources = not _show_sources
	_render()


func _toggle_event(at: int) -> void:
	if _open_events.has(at):
		_open_events.erase(at)
	else:
		_open_events[at] = true
	_render()


func _load_preview() -> void:
	_seq += 1
	var seq := _seq
	_busy = true
	_changed_option()
	_stale = false
	_show_text = false
	_render()
	var reply: Dictionary = await engine.request("lore.preview", {"options": _options})
	if seq != _seq or not is_inside_tree():
		return
	_busy = false
	if reply.get("ok", false) and typeof(reply.get("result")) == TYPE_DICTIONARY:
		_snapshot = reply["result"]
		_list = (_snapshot as Dictionary).get("list", {})
		_text = (_snapshot as Dictionary).get("text", {})
	else:
		var message := str(reply.get("error", ""))
		_status = message if not message.is_empty() else "Unable to read campaign history."
	_render()


func _event_page(step: int) -> void:
	var reply: Dictionary = await engine.request("lore.events", {"page": int(_list.get("page", 0)) + step})
	if reply.get("ok", false) and typeof(reply.get("result")) == TYPE_DICTIONARY:
		_list = reply["result"]
		_open_events = {}
		_render()


func _text_page(step: int) -> void:
	var reply: Dictionary = await engine.request("lore.text", {"page": int(_text.get("page", 0)) + step})
	if reply.get("ok", false) and typeof(reply.get("result")) == TYPE_DICTIONARY:
		_text = reply["result"]
		_render()


func _download(format: String) -> void:
	var reply: Dictionary = await engine.request("lore.save", {"format": format})
	var result: Dictionary = reply.get("result", {}) if reply.get("ok", false) and typeof(reply.get("result")) == TYPE_DICTIONARY else {}
	_status = str(result.get("status", "")) if reply.get("ok", false) else str(reply.get("error", "Unable to save the record."))
	_saved = str(result.get("path", ""))
	_render()


func _copy() -> void:
	var reply: Dictionary = await engine.request("lore.copy")
	var result: Dictionary = reply.get("result", {}) if reply.get("ok", false) and typeof(reply.get("result")) == TYPE_DICTIONARY else {}
	var text := str(result.get("text", ""))
	if not text.is_empty():
		DisplayServer.clipboard_set(text)
	_status = str(result.get("status", "Clipboard unavailable. Download Markdown instead."))
	_saved = ""
	_render()


func _run_chronicle() -> void:
	if _chronicle_busy:
		return
	_chronicle_busy = true
	_chronicle = null
	_chronicle_status = ""
	_requests = 0
	_render()
	_chronicle_call = engine.last_request_id() + 1
	var reply: Dictionary = await engine.request("lore.chronicle")
	_chronicle_call = 0
	if not is_inside_tree():
		return
	_chronicle_busy = false
	var result: Dictionary = reply.get("result", {}) if reply.get("ok", false) and typeof(reply.get("result")) == TYPE_DICTIONARY else {}
	_chronicle = result.get("chronicle")
	_requests = int(result.get("requests", _requests))
	_chronicle_status = str(result.get("status", "")) if reply.get("ok", false) else str(reply.get("error", "Chronicle generation failed. The native record remains available."))
	_render()


func _cancel_chronicle() -> void:
	if _chronicle_call != 0:
		engine.cancel(_chronicle_call)
	engine.request("lore.cancelChronicle")


func _save_chronicle(copy: bool) -> void:
	var reply: Dictionary = await engine.request("lore.saveChronicle", {"copy": copy})
	var result: Dictionary = reply.get("result", {}) if reply.get("ok", false) and typeof(reply.get("result")) == TYPE_DICTIONARY else {}
	var text := str(result.get("text", ""))
	if copy and not text.is_empty():
		DisplayServer.clipboard_set(text)
	_chronicle_status = str(result.get("status", "")) if reply.get("ok", false) else str(reply.get("error", "Unable to export the chronicle."))
	if not copy and not str(result.get("path", "")).is_empty():
		_chronicle_status += " " + "Saved to %s" % str(result.get("path", ""))
	_render()
