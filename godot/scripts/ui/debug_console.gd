class_name DebugConsole
extends Control

signal opened
signal closed

const BG := Color("#0a0e11")
const PANEL := Color("#101518")
const RAISED := Color("#1a1a1c")
const BORDER := Color("#353538")
const TEXT := Color("#cdcdd1")
const MUTED := Color("#8b949e")
const ACCENT := Color("#3b82f6")
const DANGER := Color("#f85149")
const GOLD := Color("#d29922")
const OK_INK := Color("#3fb950")
const ROW_RULE := Color("#262628")
const TABS := [["generations", "Generations"], ["analytics", "Analytics"], ["models", "Models"], ["export", "Export"]]
const SUMMARY_FIELDS := [["eventCount", "events"], ["regionTransferCount", "transfers"], ["controlOpCount", "control ops"], ["polityChangeCount", "polity changes"], ["politicalActorOpCount", "political actor ops"], ["unitOpCount", "unit ops"], ["warUpdateCount", "war updates"], ["relationUpdateCount", "relation updates"], ["storylineUpdateCount", "storylines"], ["chatCount", "chats"]]
const TABLE_HEADERS := ["Calls", "Failed", "Lookups", "Requests", "Tokens in", "Tokens out", "Cache read", "Avg latency", "Avg rating"]
const TABLE_KEYS := ["calls", "failed", "lookups", "requests", "tokensIn", "tokensOut", "cacheRead", "avgLatency", "avgRating"]

var engine: EngineLink
var export_dir := ""
var reveal_saved_files := true
var active_tab := "generations"

var _open := false
var _data := {}
var _selected := ""
var _detail := {}
var _task_filter := "all"
var _model_filter := ""
var _status_filter := "all"
var _search := ""
var _sort := "newest"
var _expanded := {}
var _copied := ""
var _confirming_clear := false
var _notice := ""
var _card: PanelContainer
var _count_pill: Label
var _tab_buttons := {}
var _body: Control


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	visible = false
	var backdrop := ColorRect.new()
	backdrop.color = Color(0, 0, 0, 0.8)
	backdrop.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(backdrop)
	_card = PanelContainer.new()
	_card.add_theme_stylebox_override("panel", UI.box(BG, BORDER, 14, 2))
	_card.clip_contents = true
	add_child(_card)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	_card.add_child(column)
	column.add_child(_build_header())
	column.add_child(_build_tabs())
	_body = Control.new()
	_body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_body.clip_contents = true
	column.add_child(_body)
	resized.connect(_layout)
	_layout()


func setup(engine_link: EngineLink, context: Dictionary = {}) -> void:
	engine = engine_link
	export_dir = str(context.get("export_dir", export_dir))
	if context.has("reveal_saved_files"):
		reveal_saved_files = bool(context.get("reveal_saved_files"))
	if not engine.engine_event.is_connected(_on_engine_event):
		engine.engine_event.connect(_on_engine_event)


func is_open() -> bool:
	return _open


func open() -> void:
	_open = true
	visible = true
	modulate.a = 0.0
	var fade := create_tween()
	fade.tween_property(self, "modulate:a", 1.0, 0.16)
	opened.emit()
	await refresh()


func close() -> void:
	if not _open:
		return
	_open = false
	visible = false
	_selected = ""
	_detail = {}
	if engine:
		engine.request("telemetry.release")
	closed.emit()


func set_open(value: bool) -> void:
	if value:
		open()
	else:
		close()


func refresh() -> void:
	if not engine:
		return
	var reply: Dictionary = await engine.request("telemetry.records", {"task": _task_filter, "model": _model_filter, "status": _status_filter, "search": _search, "sort": _sort})
	if reply.get("ok", false) and typeof(reply.get("result")) == TYPE_DICTIONARY:
		_data = reply["result"]
	if not _selected.is_empty():
		var detail: Dictionary = await engine.request("telemetry.record", {"id": _selected})
		_detail = detail.get("result", {}) if detail.get("ok", false) and typeof(detail.get("result")) == TYPE_DICTIONARY else {}
		if _detail.is_empty():
			_selected = ""
	_render()


func _input(event: InputEvent) -> void:
	if _open and event is InputEventKey and (event as InputEventKey).pressed and (event as InputEventKey).keycode == KEY_ESCAPE:
		get_viewport().set_input_as_handled()
		close()


func _on_engine_event(name: String, _payload: Variant) -> void:
	if _open and name == "telemetry.changed":
		refresh()


func _layout() -> void:
	var view := size if size.x > 0.0 else get_viewport_rect().size
	var width := minf(view.x - 32.0, 1600.0)
	_card.position = Vector2((view.x - width) * 0.5, 16)
	_card.size = Vector2(width, view.y - 32.0)


func _label(text: String, size: int, color: Color, weight := 400, mono := false, spacing := 0) -> Label:
	var node := UI.label(text, size, color, weight, "Consolas" if mono else "Arial", spacing)
	return node


func _button(text: String, on_press: Callable, primary := false, tooltip := "") -> Button:
	var node := Button.new()
	node.text = text
	node.focus_mode = Control.FOCUS_NONE
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	node.tooltip_text = tooltip
	var bg := ACCENT if primary else Color("#262628")
	var border := ACCENT if primary else BORDER
	var normal := UI.box(bg, border, 8, 1, Vector4(11.2, 5.6, 11.2, 5.6))
	var hover := UI.box(bg.lightened(0.08), border.lightened(0.1), 8, 1, Vector4(11.2, 5.6, 11.2, 5.6))
	for state in ["normal", "focus", "disabled"]:
		node.add_theme_stylebox_override(state, normal)
	for state in ["hover", "pressed", "hover_pressed"]:
		node.add_theme_stylebox_override(state, hover)
	node.add_theme_font_override("font", UI.font(700))
	node.add_theme_font_size_override("font_size", 12)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		node.add_theme_color_override(name, UI.WHITE)
	if on_press.is_valid():
		node.pressed.connect(func() -> void: on_press.call())
	return node


func _build_header() -> Control:
	var bar := PanelContainer.new()
	var style := UI.box(RAISED, Color(0, 0, 0, 0), 0, 0, Vector4(16, 9.6, 16, 9.6))
	bar.add_theme_stylebox_override("panel", style)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 11)
	row.add_child(_label("AI DEBUG CONSOLE", 13, UI.WHITE, 800, false, 1))
	var pill := PanelContainer.new()
	pill.add_theme_stylebox_override("panel", UI.box(BG, BORDER, 6, 1, Vector4(8, 1.6, 8, 1.6)))
	pill.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_count_pill = _label("0 generations", 11, MUTED, 700, true)
	pill.add_child(_count_pill)
	row.add_child(pill)
	row.add_child(UI.spacer())
	row.add_child(_button("Refresh", func() -> void: refresh(), false, "Refresh"))
	row.add_child(_button("✕ Close", func() -> void: close(), false, "Close"))
	column.add_child(row)
	bar.add_child(column)
	var holder := VBoxContainer.new()
	holder.add_theme_constant_override("separation", 0)
	holder.add_child(bar)
	var rule := ColorRect.new()
	rule.color = BORDER
	rule.custom_minimum_size.y = 2
	holder.add_child(rule)
	return holder


func _build_tabs() -> Control:
	var bar := PanelContainer.new()
	bar.add_theme_stylebox_override("panel", UI.box(PANEL, Color(0, 0, 0, 0), 0, 0, Vector4(12.8, 6.4, 12.8, 6.4)))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 4)
	for pair: Array in TABS:
		var key: String = pair[0]
		var button := Button.new()
		button.text = str(pair[1]).to_upper()
		button.focus_mode = Control.FOCUS_NONE
		button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		button.add_theme_font_override("font", UI.font(700, "Arial", 1))
		button.add_theme_font_size_override("font_size", 12)
		button.pressed.connect(func() -> void:
			active_tab = key
			_render())
		_tab_buttons[key] = button
		row.add_child(button)
	bar.add_child(row)
	var holder := VBoxContainer.new()
	holder.add_theme_constant_override("separation", 0)
	holder.add_child(bar)
	var rule := ColorRect.new()
	rule.color = BORDER
	rule.custom_minimum_size.y = 1
	holder.add_child(rule)
	return holder


func _style_tabs() -> void:
	for key: String in _tab_buttons.keys():
		var button: Button = _tab_buttons[key]
		var selected := key == active_tab
		var normal := UI.box(ACCENT if selected else Color(0, 0, 0, 0), Color(0, 0, 0, 0), 8, 0, Vector4(11.2, 5.6, 11.2, 5.6))
		var hover := UI.box(ACCENT if selected else Color(1, 1, 1, 0.05), Color(0, 0, 0, 0), 8, 0, Vector4(11.2, 5.6, 11.2, 5.6))
		for state in ["normal", "focus"]:
			button.add_theme_stylebox_override(state, normal)
		for state in ["hover", "pressed", "hover_pressed"]:
			button.add_theme_stylebox_override(state, hover)
		for name in ["font_color", "font_focus_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color"]:
			button.add_theme_color_override(name, UI.WHITE if selected else MUTED)


func _clear_body() -> void:
	for child in _body.get_children():
		_body.remove_child(child)
		child.queue_free()


func _render() -> void:
	_style_tabs()
	var count := int(_data.get("count", 0))
	_count_pill.text = "%d generation%s" % [count, "" if count == 1 else "s"]
	_clear_body()
	match active_tab:
		"analytics":
			_body.add_child(_page(_analytics()))
		"models":
			_body.add_child(_page(_models()))
		"export":
			_body.add_child(_page(_export()))
		_:
			_body.add_child(_generations())


func _page(content: Control) -> Control:
	var scroll := ScrollContainer.new()
	scroll.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_style_scroll(scroll)
	var margin := MarginContainer.new()
	margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for side in ["margin_left", "margin_top", "margin_right", "margin_bottom"]:
		margin.add_theme_constant_override(side, 16)
	margin.add_child(content)
	scroll.add_child(margin)
	return scroll


func _style_scroll(scroll: ScrollContainer) -> void:
	var bar := scroll.get_v_scroll_bar()
	bar.add_theme_stylebox_override("scroll", StyleBoxEmpty.new())
	bar.add_theme_stylebox_override("grabber", UI.box(Color(1, 1, 1, 0.16), Color(0, 0, 0, 0), 999, 0))
	bar.add_theme_stylebox_override("grabber_highlight", UI.box(Color(1, 1, 1, 0.28), Color(0, 0, 0, 0), 999, 0))
	bar.add_theme_stylebox_override("grabber_pressed", UI.box(Color(1, 1, 1, 0.28), Color(0, 0, 0, 0), 999, 0))


func _section(title: String, right: Control = null) -> VBoxContainer:
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 8)
	var row := HBoxContainer.new()
	row.add_child(_label(title.to_upper(), 11, Color("#60a5fa"), 800, false, 1))
	row.add_child(UI.spacer())
	if right:
		row.add_child(right)
	column.add_child(row)
	return column


func _card_tile(title: String, value: String, sub := "", accent := false) -> Control:
	var tile := PanelContainer.new()
	tile.custom_minimum_size.x = 150
	tile.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	tile.add_theme_stylebox_override("panel", UI.box(Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.06) if accent else RAISED, Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.5) if accent else BORDER, 10, 1, Vector4(12.8, 12.8, 12.8, 12.8)))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 4)
	column.add_child(_label(title.to_upper(), 10, MUTED, 800, false, 1))
	column.add_child(_label(value, 19, UI.WHITE, 800))
	if not sub.is_empty():
		column.add_child(_label(sub, 11, MUTED))
	tile.add_child(column)
	return tile


func _select(options: Array, current: String, on_select: Callable, width := 0.0) -> OptionButton:
	var select := OptionButton.new()
	select.focus_mode = Control.FOCUS_NONE
	select.fit_to_longest_item = width <= 0.0
	select.clip_text = width > 0.0
	if width > 0.0:
		select.custom_minimum_size.x = width
	var normal := UI.box(BG, BORDER, 6, 1, Vector4(8, 4.8, 8, 4.8))
	for state in ["normal", "focus", "hover", "pressed", "hover_pressed"]:
		select.add_theme_stylebox_override(state, normal)
	select.add_theme_font_override("font", UI.font(700))
	select.add_theme_font_size_override("font_size", 12)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		select.add_theme_color_override(name, UI.WHITE)
	var popup := select.get_popup()
	popup.add_theme_stylebox_override("panel", UI.box(Color("#1f1f23"), Color(1, 1, 1, 0.12), 8, 1, Vector4(4, 4, 4, 4)))
	popup.add_theme_stylebox_override("hover", UI.box(Color(1, 1, 1, 0.08), Color(0, 0, 0, 0), 6, 0))
	popup.add_theme_color_override("font_color", Color("#f4f4f5"))
	popup.add_theme_font_size_override("font_size", 12)
	var chosen := 0
	for index in range(options.size()):
		var pair: Array = options[index]
		select.add_item(str(pair[1]))
		select.set_item_metadata(index, str(pair[0]))
		if str(pair[0]) == current:
			chosen = index
	select.select(chosen)
	select.item_selected.connect(func(index: int) -> void: on_select.call(str(select.get_item_metadata(index))))
	return select


func _generations() -> Control:
	var column := VBoxContainer.new()
	column.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	column.add_theme_constant_override("separation", 0)
	var filters_bar := PanelContainer.new()
	filters_bar.add_theme_stylebox_override("panel", UI.box(BG, Color(0, 0, 0, 0), 0, 0, Vector4(12.8, 6.4, 12.8, 6.4)))
	var filters := HBoxContainer.new()
	filters.add_theme_constant_override("separation", 6)
	var tasks: Array = [["all", "All tasks"]]
	for task: Variant in _data.get("tasks", []):
		tasks.append([str(task), str(task)])
	filters.add_child(_select(tasks, _task_filter, func(value: String) -> void:
		_task_filter = value
		refresh()))
	var models: Array = [["", "All models"]]
	for model: Variant in _data.get("models", []):
		models.append([str(model), str(model)])
	filters.add_child(_select(models, _model_filter, func(value: String) -> void:
		_model_filter = value
		refresh(), 224))
	filters.add_child(_select([["all", "All statuses"], ["ok", "OK"], ["failed", "Failed"]], _status_filter, func(value: String) -> void:
		_status_filter = value
		refresh()))
	filters.add_child(_select([["newest", "Newest first"], ["requests", "Most requests first"]], _sort, func(value: String) -> void:
		_sort = value
		refresh()))
	var search := LineEdit.new()
	search.text = _search
	search.placeholder_text = "Search prompts and responses…"
	search.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	search.custom_minimum_size.x = 160
	search.add_theme_stylebox_override("normal", UI.box(BG, BORDER, 6, 1, Vector4(8, 4.8, 8, 4.8)))
	search.add_theme_stylebox_override("focus", UI.box(BG, Color(1, 1, 1, 0.3), 6, 1, Vector4(8, 4.8, 8, 4.8)))
	search.add_theme_font_size_override("font_size", 12)
	search.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.38))
	search.text_submitted.connect(func(text: String) -> void:
		_search = text
		refresh())
	search.focus_exited.connect(func() -> void:
		if search.text != _search:
			_search = search.text
			refresh.call_deferred())
	filters.add_child(search)
	filters_bar.add_child(filters)
	column.add_child(filters_bar)
	column.add_child(_rule(BORDER))
	if not bool(_data.get("available", true)):
		UI.set_disabled_look(filters_bar, str(_data.get("reason", "")))
		for node in filters.get_children():
			if node is BaseButton:
				(node as BaseButton).disabled = true
			elif node is LineEdit:
				(node as LineEdit).editable = false
	var split := HBoxContainer.new()
	split.size_flags_vertical = Control.SIZE_EXPAND_FILL
	split.add_theme_constant_override("separation", 0)
	var list_holder := VBoxContainer.new()
	list_holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	list_holder.size_flags_stretch_ratio = 46.0 if not _detail.is_empty() else 100.0
	list_holder.add_theme_constant_override("separation", 0)
	var filtered: Array = _data.get("filtered", [])
	if filtered.is_empty():
		var empty := CenterContainer.new()
		empty.size_flags_vertical = Control.SIZE_EXPAND_FILL
		var empty_column := VBoxContainer.new()
		empty_column.add_theme_constant_override("separation", 8)
		var text := _label("No generations recorded yet — play a turn, then come back.".to_upper(), 11, MUTED, 700, false, 1)
		text.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		empty_column.add_child(text)
		if not bool(_data.get("available", true)):
			var reason := _label(str(_data.get("reason", "")), 11, MUTED)
			reason.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			reason.modulate.a = 0.75
			empty_column.add_child(reason)
		empty.add_child(empty_column)
		list_holder.add_child(empty)
	else:
		var info := PanelContainer.new()
		info.add_theme_stylebox_override("panel", UI.box(BG, Color(0, 0, 0, 0), 0, 0, Vector4(11.2, 4, 11.2, 4)))
		var shown_text := ("%d shown (most requests first)" if _sort == "requests" else "%d shown (newest first)") % filtered.size()
		info.add_child(_label(shown_text.to_upper(), 10, MUTED, 800, false, 1))
		list_holder.add_child(info)
		list_holder.add_child(_rule(ROW_RULE))
		var scroll := ScrollContainer.new()
		scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
		scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
		_style_scroll(scroll)
		var rows := VBoxContainer.new()
		rows.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		rows.add_theme_constant_override("separation", 0)
		for record: Dictionary in filtered:
			rows.add_child(_generation_row(record))
		scroll.add_child(rows)
		list_holder.add_child(scroll)
	split.add_child(list_holder)
	if not _detail.is_empty():
		var divider := ColorRect.new()
		divider.color = BORDER
		divider.custom_minimum_size.x = 1
		split.add_child(divider)
		var detail := _generation_detail()
		detail.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		detail.size_flags_stretch_ratio = 54.0
		split.add_child(detail)
	column.add_child(split)
	return column


func _rule(color: Color) -> ColorRect:
	var rule := ColorRect.new()
	rule.color = color
	rule.custom_minimum_size.y = 1
	rule.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return rule


func _status_color(ok: String) -> Color:
	if ok == "failed":
		return DANGER
	if ok == "ok":
		return OK_INK
	return MUTED


func _fixed(text: String, width: float, color: Color, mono := true, align := HORIZONTAL_ALIGNMENT_RIGHT, tooltip := "") -> Label:
	var node := _label(text, 11, color, 400, mono)
	node.custom_minimum_size.x = width
	node.horizontal_alignment = align
	node.clip_text = true
	node.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	node.tooltip_text = tooltip
	if not tooltip.is_empty():
		node.mouse_filter = Control.MOUSE_FILTER_PASS
	return node


func _generation_row(record: Dictionary) -> Control:
	var id := str(record.get("id", ""))
	var selected := id == _selected
	var button := Button.new()
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.custom_minimum_size.y = 30
	var normal := UI.box(Color(0, 0, 0, 0.42) if selected else Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 0)
	var hover := UI.box(Color(0, 0, 0, 0.42) if selected else Color(1, 1, 1, 0.03), Color(0, 0, 0, 0), 0, 0)
	for state in ["normal", "focus"]:
		button.add_theme_stylebox_override(state, normal)
	for state in ["hover", "pressed", "hover_pressed"]:
		button.add_theme_stylebox_override(state, hover)
	var row := HBoxContainer.new()
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	row.offset_left = 11.2
	row.offset_right = -11.2
	row.add_theme_constant_override("separation", 8)
	var dot := StatusDot.new(_status_color(str(record.get("ok", ""))))
	dot.custom_minimum_size = Vector2(7, 7)
	dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(dot)
	row.add_child(_fixed(str(record.get("time", "")), 120, MUTED, true, HORIZONTAL_ALIGNMENT_LEFT))
	var task := str(record.get("taskKey", "direct"))
	if bool(record.get("batch", false)):
		task += " (batch)"
	if int(record.get("maxAttempts", 1)) > 1:
		task += " #%d" % int(record.get("attempt", 1))
	var task_label := _fixed(task, 144, TEXT, false, HORIZONTAL_ALIGNMENT_LEFT)
	task_label.add_theme_font_override("font", UI.font(700))
	row.add_child(task_label)
	var model := str(record.get("model", ""))
	var model_label := _label(model if not model.is_empty() else "unknown model", 11, MUTED)
	model_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	model_label.clip_text = true
	model_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	row.add_child(model_label)
	var calls := int(record.get("lookupCalls", 0))
	var rounds := int(record.get("lookupRounds", 0))
	row.add_child(_fixed("fn ×%d" % calls if calls > 0 else "", 67, MUTED, true, HORIZONTAL_ALIGNMENT_RIGHT, "%d lookup call%s over %d round%s" % [calls, "" if calls == 1 else "s", rounds, "" if rounds == 1 else "s"] if calls > 0 else ""))
	var requests: Variant = record.get("requests")
	var request_count := int(requests) if typeof(requests) != TYPE_NIL else -1
	row.add_child(_fixed("req ×%d" % request_count if request_count >= 0 else "", 58, GOLD if request_count > 1 else MUTED, true, HORIZONTAL_ALIGNMENT_RIGHT, str(record.get("requestsTitle", "")) if request_count >= 0 else ""))
	row.add_child(_fixed(str(record.get("usage", "")), 128, MUTED))
	row.add_child(_fixed(str(record.get("latency", "")), 56, MUTED, true, HORIZONTAL_ALIGNMENT_RIGHT, str(record.get("skipTitle", ""))))
	row.add_child(_fixed(str(record.get("skip", "")), 86, GOLD))
	row.add_child(_fixed(str(record.get("rating", "")), 45, GOLD))
	button.add_child(row)
	button.pressed.connect(func() -> void:
		_selected = "" if _selected == id else id
		refresh())
	var holder := VBoxContainer.new()
	holder.add_theme_constant_override("separation", 0)
	holder.add_child(button)
	holder.add_child(_rule(ROW_RULE))
	return holder


func _generation_detail() -> Control:
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_style_scroll(scroll)
	var margin := MarginContainer.new()
	margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for side in ["margin_left", "margin_top", "margin_right", "margin_bottom"]:
		margin.add_theme_constant_override(side, 14)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 14)
	var head := VBoxContainer.new()
	head.add_theme_constant_override("separation", 2)
	head.add_child(_label(str(_detail.get("taskKey", "direct")), 14, UI.WHITE, 800))
	var header := _label(str(_detail.get("header", "")), 11, MUTED, 400, true)
	header.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	head.add_child(header)
	column.add_child(head)
	var cards := HFlowContainer.new()
	cards.add_theme_constant_override("h_separation", 8)
	cards.add_theme_constant_override("v_separation", 8)
	cards.add_child(_card_tile("Tokens in", str(_detail.get("tokensIn", "—")), str(_detail.get("tokensInSub", ""))))
	cards.add_child(_card_tile("Tokens out", str(_detail.get("tokensOut", "—")), str(_detail.get("tokensOutSub", ""))))
	cards.add_child(_card_tile("Latency", str(_detail.get("latency", "—")), str(_detail.get("latencySub", ""))))
	if not str(_detail.get("wholeSkip", "")).is_empty():
		cards.add_child(_card_tile("Whole time skip", str(_detail.get("wholeSkip", "")), str(_detail.get("wholeSkipSub", ""))))
	if not str(_detail.get("requestsValue", "")).is_empty():
		cards.add_child(_card_tile("Requests", str(_detail.get("requestsValue", "")), str(_detail.get("requestsTitle", ""))))
	if not str(_detail.get("lookupsValue", "")).is_empty():
		cards.add_child(_card_tile("Lookups", str(_detail.get("lookupsValue", "")), str(_detail.get("lookupsSub", ""))))
	cards.add_child(_card_tile("Status", str(_detail.get("status", "Pending")), str(_detail.get("statusSub", ""))))
	column.add_child(cards)
	var phases: Array = _detail.get("phases", [])
	if not phases.is_empty():
		var phase_column := VBoxContainer.new()
		phase_column.add_theme_constant_override("separation", 2)
		phase_column.add_child(_label("WHERE THE TIME SKIP'S TIME WENT", 11, MUTED, 800, true, 1))
		for line: Variant in phases:
			phase_column.add_child(_label(str(line), 11, MUTED, 400, true))
		column.add_child(phase_column)
	var summary: Variant = _detail.get("parsedSummary")
	if typeof(summary) == TYPE_DICTIONARY:
		var box := PanelContainer.new()
		box.add_theme_stylebox_override("panel", UI.box(RAISED, BORDER, 8, 1, Vector4(9.6, 9.6, 9.6, 9.6)))
		var flow := HFlowContainer.new()
		flow.add_theme_constant_override("h_separation", 16)
		for pair: Array in SUMMARY_FIELDS:
			var value: Variant = (summary as Dictionary).get(pair[0])
			if typeof(value) != TYPE_NIL and int(value) != 0:
				var rich := RichTextLabel.new()
				rich.bbcode_enabled = true
				rich.fit_content = true
				rich.autowrap_mode = TextServer.AUTOWRAP_OFF
				rich.scroll_active = false
				rich.add_theme_font_size_override("normal_font_size", 11)
				rich.add_theme_font_size_override("bold_font_size", 11)
				rich.add_theme_font_override("bold_font", UI.font(700))
				rich.add_theme_color_override("default_color", TEXT)
				rich.text = "%s: [b]%d[/b]" % [str(pair[1]), int(value)]
				flow.add_child(rich)
		var stop := str((summary as Dictionary).get("stopDate", ""))
		if not stop.is_empty():
			flow.add_child(_label("stop: %s" % stop, 11, TEXT, 700, true))
		box.add_child(flow)
		column.add_child(box)
	if not str(_detail.get("validationError", "")).is_empty():
		column.add_child(_error_box("Validation failure", str(_detail.get("validationError", ""))))
	if not str(_detail.get("error", "")).is_empty():
		column.add_child(_error_box("Call error", str(_detail.get("error", ""))))
	var rating_section := _section("Human satisfaction")
	rating_section.add_child(_rating(int(_detail.get("ratingValue", 0))))
	column.add_child(rating_section)
	var entries: Array = _detail.get("lookupEntries", [])
	if not entries.is_empty():
		var rounds_note := _label(str(_detail.get("lookupRoundsText", "")), 10, MUTED, 400, true)
		var calls := _section("Function calls", rounds_note)
		for line: Variant in _detail.get("roundUsage", []):
			calls.add_child(_label(str(line), 11, MUTED, 400, true))
		for index in range(entries.size()):
			var entry: Dictionary = entries[index]
			calls.add_child(_pre_block("lookup:%d" % index, str(entry.get("title", "")), str(entry.get("text", "")), "(no answer recorded)", false))
		column.add_child(calls)
	var prompts := _section("Prompt & response")
	prompts.add_child(_pre_block("system", "System prompt", str(_detail.get("systemPrompt", "")), "(not captured for this record)"))
	prompts.add_child(_pre_block("user", "User message", str(_detail.get("userMessage", "")), "(empty)"))
	prompts.add_child(_pre_block("raw", "Raw response", str(_detail.get("rawResponse", "")), "(not captured — a tool call carries its answer as structured input)"))
	column.add_child(prompts)
	margin.add_child(column)
	scroll.add_child(margin)
	return scroll


func _error_box(title: String, text: String) -> Control:
	var box := PanelContainer.new()
	box.add_theme_stylebox_override("panel", UI.box(Color(73 / 255.0, 2 / 255.0, 2 / 255.0, 0.6), Color(248 / 255.0, 81 / 255.0, 73 / 255.0, 0.4), 8, 1, Vector4(9.6, 9.6, 9.6, 9.6)))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 4)
	column.add_child(_label(title.to_upper(), 10, Color("#ff7b72"), 800, false, 1))
	var body := UI.wrapped(text, 11, Color("#ff7b72"))
	column.add_child(body)
	box.add_child(column)
	return box


func _rating(rating: int) -> Control:
	var row := HFlowContainer.new()
	row.add_theme_constant_override("h_separation", 2)
	for value in range(1, 11):
		var on := rating >= value
		var button := Button.new()
		button.text = str(value)
		button.focus_mode = Control.FOCUS_NONE
		button.tooltip_text = "Rate %d/10" % value
		button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		var normal := UI.box(Color(210 / 255.0, 153 / 255.0, 34 / 255.0, 0.15) if on else Color("#262628"), BORDER, 8, 1, Vector4(5.6, 2.4, 5.6, 2.4))
		for state in ["normal", "focus", "hover", "pressed", "hover_pressed"]:
			button.add_theme_stylebox_override(state, normal)
		button.add_theme_font_override("font", UI.font(700))
		button.add_theme_font_size_override("font_size", 11)
		for name in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color"]:
			button.add_theme_color_override(name, GOLD if on else MUTED)
		var chosen := value
		button.pressed.connect(func() -> void:
			if not engine or _selected.is_empty():
				return
			await engine.request("telemetry.rate", {"id": _selected, "rating": chosen})
			refresh())
		row.add_child(button)
	var note := _label("%d/10" % rating if rating > 0 else "unrated", 11, MUTED, 700, true)
	note.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var holder := HBoxContainer.new()
	holder.add_theme_constant_override("separation", 6)
	holder.add_child(row)
	holder.add_child(note)
	return holder


func _pre_block(key: String, title: String, text: String, empty_text: String, show_count := true) -> Control:
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 4)
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 6)
	var counted := "%s · %s" % [title, ("%s chars" % _thousands(text.length())) if not text.is_empty() else "—"] if show_count else title
	var title_label := _label(counted.to_upper(), 10, MUTED, 800, false, 1)
	title_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title_label.clip_text = true
	head.add_child(title_label)
	var expanded := bool(_expanded.get(key, false))
	if text.length() > 4000:
		var toggle := _button("Collapse" if expanded else "Expand", func() -> void:
			_expanded[key] = not bool(_expanded.get(key, false))
			_render())
		toggle.add_theme_font_size_override("font_size", 11)
		head.add_child(toggle)
	if not text.is_empty():
		var copy := _button("Copied" if _copied == key else "Copy", func() -> void:
			DisplayServer.clipboard_set(text)
			_copied = key
			_render()
			await get_tree().create_timer(1.2).timeout
			if _copied == key:
				_copied = ""
				_render(), false, "Copy to clipboard")
		copy.add_theme_font_size_override("font_size", 11)
		head.add_child(copy)
	column.add_child(head)
	if text.is_empty():
		var empty := _label(empty_text, 11, MUTED)
		column.add_child(empty)
		return column
	var frame := PanelContainer.new()
	frame.add_theme_stylebox_override("panel", UI.box(BG, BORDER, 8, 1, Vector4(9.6, 9.6, 9.6, 9.6)))
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_style_scroll(scroll)
	var shown := text if text.length() <= 60000 else text.substr(0, 60000)
	var body := UI.wrapped(shown, 11, TEXT)
	body.add_theme_font_override("font", UI.font(400, "Consolas"))
	body.autowrap_mode = TextServer.AUTOWRAP_ARBITRARY
	body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(body)
	scroll.custom_minimum_size.y = minf(540.0 if expanded else 160.0, maxf(40.0, float(shown.count("\n") + 1) * 16.0 + 8.0))
	if shown.length() > 400 and scroll.custom_minimum_size.y < 160.0:
		scroll.custom_minimum_size.y = 540.0 if expanded else 160.0
	frame.add_child(scroll)
	column.add_child(frame)
	return column


func _thousands(value: int) -> String:
	var text := str(absi(value))
	var out := ""
	while text.length() > 3:
		out = "," + text.substr(text.length() - 3) + out
		text = text.substr(0, text.length() - 3)
	return ("-" if value < 0 else "") + text + out


func _analytics() -> Control:
	var analytics: Dictionary = _data.get("analytics", {})
	var cards: Dictionary = analytics.get("cards", {})
	var column := VBoxContainer.new()
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.add_theme_constant_override("separation", 22)
	var row := HFlowContainer.new()
	row.add_theme_constant_override("h_separation", 10)
	row.add_theme_constant_override("v_separation", 10)
	row.add_child(_card_tile("Generations", str(cards.get("generations", "0"))))
	row.add_child(_card_tile("Failed", str(cards.get("failed", "0")), str(cards.get("failedSub", ""))))
	row.add_child(_card_tile("Tokens in", str(cards.get("tokensIn", "0")), str(cards.get("tokensInSub", ""))))
	row.add_child(_card_tile("Tokens out", str(cards.get("tokensOut", "0"))))
	row.add_child(_card_tile("Avg latency", str(cards.get("avgLatency", "—"))))
	row.add_child(_card_tile("Avg rating", str(cards.get("avgRating", "—")), str(cards.get("ratingSub", ""))))
	row.add_child(_card_tile("Simulated time", str(cards.get("simulated", "—")), "in-game days generated"))
	column.add_child(row)
	var tasks: Array = analytics.get("tasks", [])
	var usage := _section("Token usage by task")
	if tasks.is_empty():
		usage.add_child(_empty_note("No data yet."))
	else:
		var top := float(analytics.get("maxTokensByTask", 1))
		for task: Dictionary in tasks:
			usage.add_child(_bar(str(task.get("label", "")), float(task.get("tokensInValue", 0)), top, "%s in" % str(task.get("tokensIn", "0"))))
	column.add_child(usage)
	var calls := _section("Calls by task")
	if tasks.is_empty():
		calls.add_child(_empty_note("No data yet."))
	else:
		calls.add_child(_table(tasks, "Task"))
	column.add_child(calls)
	return column


func _models() -> Control:
	var analytics: Dictionary = _data.get("analytics", {})
	var column := VBoxContainer.new()
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var section := _section("Model comparison (from recorded generations)")
	var models: Array = _data.get("models", [])
	if models.is_empty():
		section.add_child(_empty_note("No data yet — run a few turns first."))
	else:
		section.add_child(_table(analytics.get("models", []), "Model"))
	section.add_child(_label("Compare models by running the same tasks with different per-task overrides (Settings → provider → Per-task models).", 11, MUTED))
	column.add_child(section)
	return column


func _export() -> Control:
	var available := bool(_data.get("available", true))
	var reason := str(_data.get("reason", ""))
	var column := VBoxContainer.new()
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.add_theme_constant_override("separation", 22)
	var section := _section("Export recorded data")
	var buttons := HFlowContainer.new()
	buttons.add_theme_constant_override("h_separation", 10)
	buttons.add_theme_constant_override("v_separation", 10)
	var json := _button("All generations (JSON, raw prompts)", func() -> void: _export_file("json"), true)
	var csv := _button("Summary (CSV)", func() -> void: _export_file("csv"))
	var world := _button("World state (JSON)", func() -> void: _export_file("world"))
	var clear := _button("Delete ALL recorded AI generations? This cannot be undone." if _confirming_clear else "Clear all telemetry", func() -> void:
		if not _confirming_clear:
			_confirming_clear = true
			_render()
			return
		_confirming_clear = false
		var reply: Dictionary = await engine.request("telemetry.clear")
		if reply.get("ok", false):
			_selected = ""
			_detail = {}
		await refresh())
	clear.add_theme_color_override("font_color", Color("#ff7b72"))
	clear.add_theme_color_override("font_hover_color", Color("#ff7b72"))
	clear.mouse_exited.connect(func() -> void:
		if _confirming_clear:
			_confirming_clear = false
			_render.call_deferred())
	buttons.add_child(json)
	buttons.add_child(csv)
	buttons.add_child(world)
	buttons.add_child(clear)
	if not available:
		UI.set_disabled_look(json, reason)
		UI.set_disabled_look(csv, reason)
		UI.set_disabled_look(clear, reason)
	section.add_child(buttons)
	var note := UI.wrapped("The JSON export carries every recorded generation at full fidelity — system prompt, user message, raw response, token usage, model, latency, validation errors and ratings. The CSV is a flat per-call summary. Prompts contain campaign text only; API keys never enter a record.", 11, MUTED)
	section.add_child(note)
	if not _notice.is_empty():
		section.add_child(_label(_notice, 11, TEXT, 400, true))
	column.add_child(section)
	var storage := _section("Storage")
	storage.add_child(_label("%d generation record(s) retained (200 persisted across sessions, 500 within this session)." % int(_data.get("count", 0)), 11, TEXT, 400, true))
	column.add_child(storage)
	return column


func _export_file(kind: String) -> void:
	if not engine:
		return
	var folder := export_dir if not export_dir.is_empty() else OS.get_system_dir(OS.SYSTEM_DIR_DOWNLOADS)
	var reply: Dictionary = await engine.request("telemetry.export", {"kind": kind, "dir": folder})
	if reply.get("ok", false):
		var path := str((reply.get("result", {}) as Dictionary).get("path", ""))
		_notice = path.get_file()
		if reveal_saved_files and not path.is_empty():
			OS.shell_show_in_file_manager(path)
	else:
		_notice = str(reply.get("error", ""))
	_render()


func _empty_note(text: String) -> Label:
	var node := _label(text, 11, MUTED)
	return node


func _bar(label_text: String, value: float, top: float, right: String) -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 11)
	var name := _label(label_text if not label_text.is_empty() else "—", 11, TEXT, 700)
	name.custom_minimum_size.x = 160
	name.clip_text = true
	name.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	name.tooltip_text = label_text
	name.mouse_filter = Control.MOUSE_FILTER_PASS
	row.add_child(name)
	var track := PanelContainer.new()
	track.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	track.custom_minimum_size.y = 16
	track.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	track.add_theme_stylebox_override("panel", UI.box(BG, BORDER, 4, 1))
	var fill := FillBar.new(clampf(maxf(0.02, value / maxf(1.0, top)) if top > 0.0 else 0.0, 0.0, 1.0))
	track.add_child(fill)
	row.add_child(track)
	var figure := _label(right, 11, MUTED, 700, true)
	figure.custom_minimum_size.x = 112
	figure.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	row.add_child(figure)
	return row


func _table(rows: Array, first_header: String) -> Control:
	var frame := PanelContainer.new()
	frame.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0), BORDER, 10, 1))
	frame.clip_contents = true
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	var head := PanelContainer.new()
	head.add_theme_stylebox_override("panel", UI.box(RAISED, Color(0, 0, 0, 0), 0, 0, Vector4(9.6, 7.2, 9.6, 7.2)))
	var head_row := HBoxContainer.new()
	head_row.add_theme_constant_override("separation", 0)
	var first := _label(first_header.to_upper(), 10, MUTED, 400, false, 1)
	first.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head_row.add_child(first)
	for header: String in TABLE_HEADERS:
		var cell := _label(header.to_upper(), 10, MUTED, 400, false, 1)
		cell.custom_minimum_size.x = 92
		head_row.add_child(cell)
	head.add_child(head_row)
	column.add_child(head)
	for row: Dictionary in rows:
		column.add_child(_rule(ROW_RULE))
		var line := PanelContainer.new()
		line.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 0, Vector4(9.6, 5.6, 9.6, 5.6)))
		var cells := HBoxContainer.new()
		cells.add_theme_constant_override("separation", 0)
		var name := _label(str(row.get("label", "")), 11, TEXT, 700)
		name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		name.clip_text = true
		name.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		name.tooltip_text = str(row.get("label", ""))
		name.mouse_filter = Control.MOUSE_FILTER_PASS
		cells.add_child(name)
		for key: String in TABLE_KEYS:
			var cell := _label(str(row.get(key, "")), 11, TEXT, 400, true)
			cell.custom_minimum_size.x = 92
			cells.add_child(cell)
		line.add_child(cells)
		column.add_child(line)
	frame.add_child(column)
	return frame


class StatusDot extends Control:
	var color := Color.WHITE

	func _init(dot: Color) -> void:
		color = dot
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func _draw() -> void:
		draw_circle(size * 0.5, minf(size.x, size.y) * 0.5, color, true, -1.0, true)


class FillBar extends Control:
	var share := 0.0

	func _init(amount: float) -> void:
		share = amount
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func _draw() -> void:
		if share > 0.0:
			draw_rect(Rect2(Vector2.ZERO, Vector2(size.x * share, size.y)), Color(231 / 255.0, 231 / 255.0, 234 / 255.0, 0.65))
