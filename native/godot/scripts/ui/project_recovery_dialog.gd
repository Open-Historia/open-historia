extends Control

signal created(id: String)
signal closed

const SURFACE := Color("#15171c")
const EDGE := Color(1, 1, 1, 0.15)
const INK := Color("#eff1f6")
const SMALL := Color(1, 1, 1, 0.65)
const AMBER_BG := Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.11)
const AMBER_EDGE := Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.35)
const GREEN_BG := Color(55 / 255.0, 155 / 255.0, 101 / 255.0, 0.12)
const GREEN_EDGE := Color("#3e936d")
const RED_EDGE := Color("#de7878")
const RED_INK := Color("#ffbbbb")
const MODE_EDGE := Color("#6b90ba")
const CREATE_BG := Color(50 / 255.0, 113 / 255.0, 166 / 255.0, 0.35)
const CREATE_EDGE := Color(86 / 255.0, 158 / 255.0, 223 / 255.0, 0.6)
const SHOWN_MOST := 250
const BOX_OFF := "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 13 13'><rect x='0.5' y='0.5' width='12' height='12' rx='2' fill='#ffffff' stroke='#767676'/></svg>"
const BOX_ON := "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 13 13'><rect width='13' height='13' rx='2' fill='#0075ff'/><path d='M3 6.8l2.4 2.4L10 4.4' fill='none' stroke='#ffffff' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/></svg>"

var engine: EngineLink
var game := {}
var inspection := {}
var loading := true
var working := false
var error := ""
var made := {}
var mode := "shelve"
var picked_shelve: Array = []
var picked_restore: Array = []
var needle := ""
var _body: VBoxContainer
var _list: VBoxContainer
var _summary: Label
var _create: Button
var _close_buttons: Array[Button] = []
var _search: LineEdit
var _confirming := false
var _scroll: ScrollContainer
var _tallest := 600.0


func setup(link: EngineLink, entry: Dictionary) -> void:
	engine = link
	game = entry


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	var shade := ColorRect.new()
	shade.color = Color(0, 0, 0, 0.82)
	shade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	shade.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(shade)
	var centre := CenterContainer.new()
	centre.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	centre.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(centre)
	var view := get_viewport_rect().size
	var width := minf(784.0, view.x - 32.0)
	var tallest := minf(view.y * 0.9, 850.0)
	var dialog := PanelContainer.new()
	var look := UI.box(SURFACE, EDGE, 14, 1)
	look.shadow_color = Color(0, 0, 0, 0.65)
	look.shadow_size = 40
	look.shadow_offset = Vector2(0, 24)
	dialog.add_theme_stylebox_override("panel", look)
	dialog.custom_minimum_size = Vector2(width, 0)
	centre.add_child(dialog)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	dialog.add_child(column)
	var head := PanelContainer.new()
	head.add_theme_stylebox_override("panel", _rule_box(Vector4(16, 16, 16, 16), false))
	var head_row := HBoxContainer.new()
	head_row.add_theme_constant_override("separation", 12)
	var words := VBoxContainer.new()
	words.add_theme_constant_override("separation", 0)
	words.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var title := UI.wrapped(I18n.ui("Recover Projects — {{name}}", {"name": str(game.get("name", ""))}), 17, INK, 700)
	title.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	words.add_child(title)
	words.add_child(_small("Save-owner maintenance · Creates a new game · Original remains untouched"))
	head_row.add_child(words)
	var close_top := _button("Close")
	close_top.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	close_top.tooltip_text = I18n.ui("Close Projects recovery")
	close_top.pressed.connect(_on_close)
	_close_buttons.append(close_top)
	head_row.add_child(close_top)
	head.add_child(head_row)
	column.add_child(head)
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_scroll = scroll
	_tallest = maxf(160.0, tallest - 150.0)
	var pad := MarginContainer.new()
	pad.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for side in ["margin_left", "margin_right", "margin_top", "margin_bottom"]:
		pad.add_theme_constant_override(side, 16)
	_body = VBoxContainer.new()
	_body.add_theme_constant_override("separation", 13)
	_body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_body.minimum_size_changed.connect(_fit_body)
	pad.add_child(_body)
	scroll.add_child(pad)
	column.add_child(scroll)
	var foot := PanelContainer.new()
	foot.add_theme_stylebox_override("panel", _rule_box(Vector4(16, 13, 16, 13), true))
	var foot_row := HBoxContainer.new()
	foot_row.add_theme_constant_override("separation", 8)
	foot_row.alignment = BoxContainer.ALIGNMENT_END
	var close_bottom := _button("Close")
	close_bottom.pressed.connect(_on_close)
	_close_buttons.append(close_bottom)
	foot_row.add_child(close_bottom)
	_create = _button("Create recovered copy", CREATE_BG, CREATE_EDGE)
	_create.pressed.connect(_on_create)
	foot_row.add_child(_create)
	foot.add_child(foot_row)
	column.add_child(foot)
	_render()
	_load()


func _fit_body() -> void:
	if is_instance_valid(_scroll) and is_instance_valid(_body):
		_scroll.custom_minimum_size.y = minf(_tallest, _body.get_combined_minimum_size().y + 32.0)


static func _rule_box(margin: Vector4, top: bool) -> StyleBoxFlat:
	var style := UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 0, margin)
	style.border_color = Color(1, 1, 1, 0.12)
	if top:
		style.border_width_top = 1
	else:
		style.border_width_bottom = 1
	return style


static func _small(text: String) -> Label:
	var line := UI.wrapped(text, 12, SMALL)
	line.add_theme_constant_override("line_spacing", 5)
	return line


static func _button(text: String, bg := Color(0, 0, 0, 0), border := EDGE) -> Button:
	var button := Button.new()
	button.text = text
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var look := UI.box(bg, border, 14, 1, Vector4(14, 9, 14, 9))
	for state in ["normal", "hover", "pressed", "hover_pressed", "focus", "disabled"]:
		button.add_theme_stylebox_override(state, look)
	button.add_theme_font_override("font", UI.font(400))
	button.add_theme_font_size_override("font_size", 12)
	for slot in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		button.add_theme_color_override(slot, INK)
	button.add_theme_color_override("font_disabled_color", INK)
	return button


static func _banner(bg: Color, border: Color) -> PanelContainer:
	var box := PanelContainer.new()
	box.add_theme_stylebox_override("panel", UI.box(bg, border, 9, 1, Vector4(11, 11, 11, 11)))
	return box


func _load() -> void:
	if engine == null:
		return
	var reply: Dictionary = await engine.request("projects.recovery.inspect", {"gameId": str(game.get("id", ""))})
	loading = false
	if not reply.get("ok", false):
		error = str(reply.get("error", ""))
	elif typeof(reply.get("result")) == TYPE_DICTIONARY:
		inspection = reply["result"]
	_render()


func _rows() -> Array:
	var rows: Array = []
	for entry in inspection.get("boards", []):
		var board: Dictionary = entry
		for row_entry in board.get("rows", []):
			var row: Dictionary = (row_entry as Dictionary).duplicate()
			row["boardTitle"] = str(board.get("title", ""))
			rows.append(row)
	return rows


func _active_selected() -> int:
	var count := 0
	for row in _rows():
		if picked_shelve.has(str(row.get("token", ""))) and bool(row.get("open", false)):
			count += 1
	return count


func _shown() -> Array:
	var wanted := needle.to_lower()
	var shown: Array = []
	if mode == "shelve":
		for row in _rows():
			var text := "%s %s %s %s" % [row.get("name", ""), row.get("ownerCode", ""), row.get("id", ""), row.get("boardTitle", "")]
			if wanted.is_empty() or text.to_lower().contains(wanted):
				shown.append(row)
	else:
		for entry in inspection.get("archive", []):
			var item: Dictionary = entry
			var text := "%s %s %s" % [item.get("name", ""), item.get("id", ""), item.get("board", "")]
			if wanted.is_empty() or text.to_lower().contains(wanted):
				shown.append(item)
	return shown


func _render() -> void:
	for child in _body.get_children():
		_body.remove_child(child)
		child.queue_free()
	_list = null
	_summary = null
	_search = null
	for button in _close_buttons:
		button.disabled = working
	if loading:
		_body.add_child(_small("Reading the complete campaign record…"))
	var failure := str(inspection.get("failure", ""))
	if not failure.is_empty():
		var stop := _banner(AMBER_BG, AMBER_EDGE)
		stop.add_child(_small(I18n.ui("Recovery cannot continue: {{failure}}. The source was not modified.", {"failure": failure})))
		_body.add_child(stop)
	if not loading and failure.is_empty() and not inspection.is_empty():
		_render_inspection()
	if not made.is_empty():
		var done := _banner(GREEN_BG, GREEN_EDGE)
		var told := _small("%s %s %s" % [I18n.ui("Recovered game created:"), str(made.get("name", "")), I18n.ui("({{id}}). Find it in your Games library. The original game is unchanged.", {"id": str(made.get("id", ""))})])
		told.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
		done.add_child(told)
		_body.add_child(done)
	if not error.is_empty():
		var wrong := _banner(AMBER_BG, RED_EDGE)
		wrong.add_child(UI.wrapped(error, 12, RED_INK))
		_body.add_child(wrong)
	_update_create()


func _render_inspection() -> void:
	var notice := _banner(AMBER_BG, AMBER_EDGE)
	var notice_column := VBoxContainer.new()
	notice_column.add_theme_constant_override("separation", 8)
	if not bool(inspection.get("canCopySnapshots", true)):
		notice_column.add_child(_small("Older owner-format campaign: restore points cannot safely be carried into the repaired copy. They stay in your original campaign."))
	var needs := int(inspection.get("required", 0))
	var lead := I18n.ui("{{needs}} project(s) exceed the 120-entry live-board limit. Choose at least that many to shelve, in their respective boards. No project is chosen automatically. An active project stops progressing while shelved; restoring it does not retroactively simulate skipped days.", {"needs": needs}) if needs > 0 else I18n.ui("No board is over the live limit. You may restore previously shelved projects if enough slots are available, or shelve projects to free slots. An active project stops progressing while shelved; restoring it does not retroactively simulate skipped days.")
	var lead_label := _small(lead)
	lead_label.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	notice_column.add_child(lead_label)
	notice.add_child(notice_column)
	_body.add_child(notice)
	for entry in inspection.get("boards", []):
		var board: Dictionary = entry
		var rows: Array = board.get("rows", [])
		var line := HFlowContainer.new()
		line.add_theme_constant_override("h_separation", 10)
		line.add_theme_constant_override("v_separation", 4)
		var label := RichTextLabel.new()
		label.bbcode_enabled = true
		label.fit_content = true
		label.scroll_active = false
		label.autowrap_mode = TextServer.AUTOWRAP_OFF
		label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		label.mouse_filter = Control.MOUSE_FILTER_IGNORE
		label.add_theme_font_override("normal_font", UI.font(400))
		label.add_theme_font_override("bold_font", UI.font(700))
		label.add_theme_font_size_override("normal_font_size", 12)
		label.add_theme_font_size_override("bold_font_size", 12)
		label.add_theme_color_override("default_color", SMALL)
		label.text = "[b][color=#%s]%s[/color][/b] %s" % [INK.to_html(false), str(board.get("title", "")).replace("[", "[lb]"), I18n.ui("— {{rowsCount}} live records, {{excess}} over limit{{value}}", {"rowsCount": rows.size(), "excess": int(board.get("excess", 0)), "value": ""})]
		line.add_child(label)
		var closed_rows: Array = rows.filter(func(row: Dictionary) -> bool: return not bool(row.get("open", false)))
		if mode == "shelve" and not closed_rows.is_empty():
			var pick_closed := _button("Select closed")
			for state in ["normal", "hover", "pressed", "hover_pressed", "focus", "disabled"]:
				pick_closed.add_theme_stylebox_override(state, UI.box(Color(0, 0, 0, 0), EDGE, 14, 1, Vector4(7, 3, 7, 3)))
			pick_closed.disabled = working
			pick_closed.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			pick_closed.pressed.connect(_select_closed.bind(closed_rows))
			line.add_child(pick_closed)
		_body.add_child(line)
	var modes := HBoxContainer.new()
	modes.add_theme_constant_override("separation", 8)
	var shelve := _button("Shelve from live boards", Color(0, 0, 0, 0), MODE_EDGE if mode == "shelve" else EDGE)
	shelve.pressed.connect(_set_mode.bind("shelve"))
	modes.add_child(shelve)
	var archive: Array = inspection.get("archive", [])
	var restore := _button(I18n.ui("Restore shelved ({{archiveCount}})", {"archiveCount": archive.size()}), Color(0, 0, 0, 0), MODE_EDGE if mode == "restore" else EDGE)
	restore.disabled = archive.is_empty()
	restore.pressed.connect(_set_mode.bind("restore"))
	modes.add_child(restore)
	_body.add_child(modes)
	_search = LineEdit.new()
	_search.placeholder_text = "Find by title, country or ID…"
	_search.text = needle
	_search.tooltip_text = I18n.ui("Filter projects")
	var field := UI.box(Color(0, 0, 0, 0), EDGE, 14, 1, Vector4(14, 9, 14, 9))
	_search.add_theme_stylebox_override("normal", field)
	_search.add_theme_stylebox_override("focus", field)
	_search.add_theme_font_override("font", UI.font(400))
	_search.add_theme_font_size_override("font_size", 12)
	_search.add_theme_color_override("font_color", INK)
	_search.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.4))
	_search.add_theme_color_override("caret_color", INK)
	_search.text_changed.connect(_on_search)
	_body.add_child(_search)
	var frame := PanelContainer.new()
	frame.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0), Color(1, 1, 1, 0.1), 10, 1))
	var list_scroll := ScrollContainer.new()
	list_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_list = VBoxContainer.new()
	_list.add_theme_constant_override("separation", 0)
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	list_scroll.add_child(_list)
	frame.add_child(list_scroll)
	_body.add_child(frame)
	_fill_list(list_scroll)
	_summary = _small("")
	_body.add_child(_summary)
	_update_summary()


func _fill_list(list_scroll: ScrollContainer) -> void:
	var shown := _shown()
	var selected: Array = picked_shelve if mode == "shelve" else picked_restore
	for index in range(mini(shown.size(), SHOWN_MOST)):
		var item: Dictionary = shown[index]
		var token := str(item.get("token", "")) if mode == "shelve" else str(item.get("id", ""))
		var title := str(item.get("name", ""))
		var status := str(item.get("status", "")) if mode == "shelve" else str(item.get("priorStatus", ""))
		var board := str(item.get("boardTitle", "")) if mode == "shelve" else str(item.get("board", ""))
		var owner := str(item.get("ownerCode", ""))
		var row := PanelContainer.new()
		var line := UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 0, Vector4(12, 9, 12, 9))
		line.border_color = Color(1, 1, 1, 0.06)
		line.border_width_bottom = 1
		row.add_theme_stylebox_override("panel", line)
		var row_line := HBoxContainer.new()
		row_line.add_theme_constant_override("separation", 10)
		var tick := CheckBox.new()
		tick.button_pressed = selected.has(token)
		tick.disabled = working
		tick.focus_mode = Control.FOCUS_NONE
		tick.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
		tick.set_meta("token", token)
		var off_icon := UI.svg_texture(BOX_OFF, 1.0)
		var on_icon := UI.svg_texture(BOX_ON, 1.0)
		for slot in ["unchecked", "unchecked_disabled"]:
			tick.add_theme_icon_override(slot, off_icon)
		for slot in ["checked", "checked_disabled"]:
			tick.add_theme_icon_override(slot, on_icon)
		tick.toggled.connect(_on_toggle.bind(token))
		row_line.add_child(tick)
		var words := VBoxContainer.new()
		words.add_theme_constant_override("separation", 0)
		words.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var name_label := UI.wrapped(title if not title.is_empty() else I18n.ui("Untitled project"), 13, INK, 700)
		name_label.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
		words.add_child(name_label)
		var detail := _small("%s · %s · %s · %s" % [board, owner if not owner.is_empty() else I18n.ui("Unspecified owner"), status if not status.is_empty() else I18n.ui("unknown"), str(item.get("id", ""))])
		detail.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
		words.add_child(detail)
		row_line.add_child(words)
		row.add_child(row_line)
		_list.add_child(row)
	if shown.is_empty():
		var none := MarginContainer.new()
		none.add_theme_constant_override("margin_left", 13)
		none.add_theme_constant_override("margin_top", 13)
		none.add_theme_constant_override("margin_bottom", 13)
		none.add_child(_small("No matching projects."))
		_list.add_child(none)
	if shown.size() > SHOWN_MOST:
		var more := MarginContainer.new()
		for side in ["margin_left", "margin_right", "margin_top", "margin_bottom"]:
			more.add_theme_constant_override(side, 8)
		more.add_child(_small("Showing 250 matches. Filter to find additional projects."))
		_list.add_child(more)
	list_scroll.custom_minimum_size.y = minf(288.0, _list.get_combined_minimum_size().y)
	_list.minimum_size_changed.connect(_fit_list.bind(list_scroll))


func _fit_list(list_scroll: ScrollContainer) -> void:
	if is_instance_valid(_list):
		list_scroll.custom_minimum_size.y = minf(288.0, _list.get_combined_minimum_size().y)


func _update_summary() -> void:
	if _summary == null:
		return
	_summary.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	_summary.text = I18n.ui("{{selectedShelveCount}} selected for shelving ({{activeSelected}} active); {{selectedRestoreCount}} selected for restoration. On a full board, choose a live record to shelve and an archived record to restore in the same recovered copy. The original game and its history remain available. Old restore points may themselves contain oversized boards.", {"selectedShelveCount": picked_shelve.size(), "activeSelected": _active_selected(), "selectedRestoreCount": picked_restore.size()})


func _update_create() -> void:
	_create.text = I18n.ui("Creating recovered copy…") if working else I18n.ui("Create recovered copy")
	var count := picked_shelve.size() + picked_restore.size()
	_create.disabled = loading or working or inspection.is_empty() or inspection.has("failure") or count == 0 or not made.is_empty()


func _select_closed(rows: Array) -> void:
	for row in rows:
		var token := str((row as Dictionary).get("token", ""))
		if not picked_shelve.has(token):
			picked_shelve.append(token)
	_render()


func _set_mode(next: String) -> void:
	mode = next
	needle = ""
	_render()


func _on_search(text: String) -> void:
	needle = text
	_render()
	if is_instance_valid(_search):
		_search.grab_focus()
		_search.caret_column = _search.text.length()


func _on_toggle(_on: bool, token: String) -> void:
	var selected: Array = picked_shelve if mode == "shelve" else picked_restore
	if selected.has(token):
		selected.erase(token)
	else:
		selected.append(token)
	_update_summary()
	_update_create()


func _on_close() -> void:
	if working:
		return
	closed.emit()
	queue_free()


func _unhandled_key_input(event: InputEvent) -> void:
	var key := event as InputEventKey
	if key != null and key.pressed and not key.echo and key.keycode == KEY_ESCAPE and not working and not _confirming:
		get_viewport().set_input_as_handled()
		_on_close()


func _warnings() -> Array:
	var active := _active_selected()
	var active_text := ""
	var history_text := ""
	if active > 0:
		active_text = I18n.ui("This will temporarily shelve {{activeSelected}} ACTIVE project(s). They will NOT advance while shelved.", {"activeSelected": active}) + " "
	if not bool(inspection.get("canCopySnapshots", true)):
		history_text = I18n.ui("This older campaign requires a country-ownership migration. Its old restore points cannot safely be copied into the recovered game, and will remain in the ORIGINAL campaign only.") + " "
	return [active_text, history_text]


func _ask(text: String) -> bool:
	_confirming = true
	var dialog := ConfirmationDialog.new()
	dialog.dialog_text = text
	dialog.dialog_autowrap = true
	dialog.min_size = Vector2i(460, 0)
	add_child(dialog)
	var answer := [false]
	var finished := [false]
	dialog.confirmed.connect(_on_answer.bind(answer, finished, true))
	dialog.canceled.connect(_on_answer.bind(answer, finished, false))
	dialog.popup_centered()
	while not finished[0] and is_instance_valid(dialog):
		await get_tree().process_frame
	if is_instance_valid(dialog):
		dialog.queue_free()
	_confirming = false
	return bool(answer[0])


func _on_answer(answer: Array, finished: Array, yes: bool) -> void:
	answer[0] = yes
	finished[0] = true


func _on_create() -> void:
	if engine == null or working or inspection.is_empty() or inspection.has("failure") or picked_shelve.size() + picked_restore.size() == 0:
		return
	var warnings := _warnings()
	if not str(warnings[0]).is_empty() or not str(warnings[1]).is_empty():
		var go: bool = await _ask(I18n.ui("{{activeWarning}}{{historyWarning}}The full project records will be preserved. The original campaign remains untouched. Create a recovered COPY?", {"activeWarning": str(warnings[0]), "historyWarning": str(warnings[1])}))
		if not go:
			return
	working = true
	error = ""
	_render()
	var reply: Dictionary = await engine.request("projects.recovery.create", {"gameId": str(game.get("id", "")), "shelve": picked_shelve, "restore": picked_restore})
	working = false
	if not reply.get("ok", false):
		error = str(reply.get("error", ""))
	elif typeof(reply.get("result")) == TYPE_DICTIONARY:
		var result: Dictionary = reply["result"]
		made = result.get("created", {})
		error = str(result.get("error", ""))
		if error.is_empty():
			picked_shelve = []
			picked_restore = []
		created.emit(str(made.get("id", "")))
	_render()
