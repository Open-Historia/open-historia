class_name EditorLanguagesPanel
extends VBoxContainer

signal value_changed(value: Variant)

const CARD_FIELDS := ["name", "heroTitle", "eyebrow", "subtitle", "heroSubtitle", "description", "gameDate"]
const STRINGS_SHOWN := 60
const REM := 16.0
const QUIET := Color(1, 1, 1, 0.58)
const WARN := Color("#fde68a")
const ROW_BG := Color(1, 1, 1, 0.03)
const ROW_BORDER := Color(1, 1, 1, 0.07)
const BOX_OFF := "<svg xmlns='http://www.w3.org/2000/svg' width='13' height='13' viewBox='0 0 13 13'><rect x='0.5' y='0.5' width='12' height='12' rx='2' fill='#ffffff' stroke='#767676'/></svg>"
const BOX_ON := "<svg xmlns='http://www.w3.org/2000/svg' width='13' height='13' viewBox='0 0 13 13'><rect x='0.5' y='0.5' width='12' height='12' rx='2' fill='#2bc1f3' stroke='#2bc1f3'/><path d='M3.2 6.6l2.2 2.2 4.4-4.6' fill='none' stroke='#ffffff' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/></svg>"

var engine: EngineLink
var props := {}
var _id := ""
var _packs := {}
var _codes: Array = []
var _view: Variant = null
var _editing := ""
var _run: Variant = null
var _message := ""
var _query := ""
var _only_missing := false
var _shown := STRINGS_SHOWN
var _view_turn := 0
var _list_turn := 0
var _coverage_labels := {}
var _status: Label
var _generate: Button
var _editor_list: VBoxContainer
var _card_column: VBoxContainer


func _init() -> void:
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	add_theme_constant_override("separation", 0)


func setup(link: EngineLink, next_props: Dictionary) -> void:
	engine = link
	props = next_props
	_id = str(props.get("scenarioId", ""))
	_packs = _copy_packs(props.get("value"))
	if not engine.engine_event.is_connected(_on_engine_event):
		engine.engine_event.connect(_on_engine_event)
	_render()
	var reply := await engine.request("scenarioLanguages.open", {"id": _id, "languages": _packs})
	if not is_instance_valid(self):
		return
	if reply.get("ok", false):
		_codes = reply["result"].get("codes", [])
	else:
		_message = str(reply.get("error", ""))
	await _refresh_view()
	_render()


func update_props(next_props: Dictionary) -> void:
	props = next_props


func _exit_tree() -> void:
	if engine and engine.engine_event.is_connected(_on_engine_event):
		engine.engine_event.disconnect(_on_engine_event)
	if engine and not _id.is_empty():
		engine.request("scenarioLanguages.close", {"id": _id})


func _copy_packs(raw: Variant) -> Dictionary:
	return (raw as Dictionary).duplicate(true) if raw is Dictionary else {}


func _form() -> Dictionary:
	var form: Dictionary = props.get("form", {}) if props.get("form") is Dictionary else {}
	var out := {}
	for key in CARD_FIELDS:
		out[key] = form.get(key, "")
	return out


func _args(extra := {}) -> Dictionary:
	var out := {"id": _id, "form": _form(), "codes": _codes, "languages": _packs}
	for key in extra:
		out[key] = extra[key]
	return out


func _refresh_view() -> void:
	_view_turn += 1
	var turn := _view_turn
	var reply := await engine.request("scenarioLanguages.view", _args())
	if not is_instance_valid(self) or turn != _view_turn:
		return
	if reply.get("ok", false) and reply.get("result") is Dictionary:
		_view = reply["result"]


func _plan() -> int:
	return int((_view as Dictionary).get("plan", 0)) if _view is Dictionary else 0


func _ai_ready() -> bool:
	return _view is Dictionary and bool((_view as Dictionary).get("aiReady", false))


func _on_engine_event(event_name: String, data: Variant) -> void:
	if event_name != "scenarioLanguages.progress" or not (data is Dictionary) or str((data as Dictionary).get("id", "")) != _id or _run == null:
		return
	var info: Dictionary = data
	_run = {"done": int(info.get("done", 0)), "total": int(info.get("total", 0))}
	if info.get("packs") is Dictionary and int(info.get("done", 0)) > 0:
		_packs = _copy_packs(info["packs"])
		value_changed.emit(_packs.duplicate(true))
		await _refresh_view()
		_render()
		return
	_update_status()


func _quiet(text: String, ink := QUIET) -> Label:
	var node := UI.wrapped(text, 12, ink, 400)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


func _button(text: String, primary := false) -> Button:
	var node := Button.new()
	node.text = text
	node.focus_mode = Control.FOCUS_NONE
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var bg := Color(1, 1, 1, 0.14) if primary else Color(1, 1, 1, 0.06)
	var border := Color(1, 1, 1, 0.3) if primary else Color(1, 1, 1, 0.12)
	var ink := Color(1, 1, 1) if primary else Color(246 / 255.0, 246 / 255.0, 248 / 255.0, 0.92)
	var normal := UI.box(bg, border, 9, 1, Vector4(0.8 * REM, 0, 0.8 * REM, 0))
	var hover := UI.box(Color(1, 1, 1, bg.a + 0.05), Color(1, 1, 1, border.a + 0.1), 9, 1, Vector4(0.8 * REM, 0, 0.8 * REM, 0))
	for state in [["normal", normal], ["hover", hover], ["pressed", hover], ["hover_pressed", hover], ["focus", normal], ["disabled", normal]]:
		node.add_theme_stylebox_override(state[0], state[1])
	node.add_theme_font_override("font", UI.font(700))
	node.add_theme_font_size_override("font_size", 12)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color", "font_disabled_color"]:
		node.add_theme_color_override(name, ink)
	node.custom_minimum_size.y = 2 * REM
	return node


func _input_style(focus: bool) -> StyleBoxFlat:
	return UI.box(Color(1, 1, 1, 0.06) if focus else Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.26) if focus else Color(1, 1, 1, 0.1), 10, 1, Vector4(0.6 * REM, 0.5 * REM, 0.6 * REM, 0.5 * REM))


func _style_input(node: Control) -> void:
	node.add_theme_stylebox_override("normal", _input_style(false))
	node.add_theme_stylebox_override("focus", _input_style(true))
	node.add_theme_stylebox_override("hover", _input_style(false))
	node.add_theme_stylebox_override("pressed", _input_style(true))
	node.add_theme_font_override("font", UI.font(400))
	node.add_theme_font_size_override("font_size", 13)
	node.add_theme_color_override("font_color", Color("#f8fafc"))
	node.add_theme_color_override("font_hover_color", Color("#f8fafc"))
	node.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.38))
	node.add_theme_color_override("caret_color", Color("#f8fafc"))
	node.add_theme_color_override("background_color", Color(0, 0, 0, 0))


func _render() -> void:
	EditorKit.clear(self)
	_coverage_labels.clear()
	_editor_list = null
	var parts := EditorKit.panel(Color(1, 1, 1, 0.03), Color(1, 1, 1, 0.08), 18, Vector4(0.9 * REM, 0.9 * REM, 0.9 * REM, 0.9 * REM), 0)
	add_child(parts[0])
	var column: VBoxContainer = parts[1]
	_card_column = column
	column.add_child(UI.label("Languages", 14, Color(1, 1, 1), 800))
	column.add_child(EditorKit.gap(0.5 * REM))
	if _view is Dictionary and not _ai_ready():
		column.add_child(_quiet("Set up an AI in Settings to generate language packs.", WARN))
		column.add_child(EditorKit.gap(0.6 * REM))
	var rows := VBoxContainer.new()
	rows.add_theme_constant_override("separation", int(round(0.45 * REM)))
	column.add_child(rows)
	var by_code := {}
	if _view is Dictionary:
		for entry in (_view as Dictionary).get("rows", []):
			by_code[str(entry.get("code", ""))] = entry
	for code_value in _codes:
		var code := str(code_value)
		var holder := VBoxContainer.new()
		holder.add_theme_constant_override("separation", 0)
		holder.add_child(_language_row(code, by_code.get(code, {})))
		if _editing == code and _view is Dictionary:
			holder.add_child(_string_editor(code))
		rows.add_child(holder)
	var unticked: Array = (_view as Dictionary).get("unticked", []) if _view is Dictionary else []
	if not unticked.is_empty():
		column.add_child(EditorKit.gap(0.6 * REM))
		var options: Array = unticked.map(func(entry: Dictionary) -> Array: return [str(entry.get("code", "")), str(entry.get("label", ""))])
		var picker := EditorKit.select(options, "", func(code: String) -> void: _add_language(code), "Add a language")
		_style_input(picker)
		picker.custom_minimum_size.y = 36
		picker.tooltip_text = "Add a language"
		for index in range(1, picker.item_count):
			picker.set_item_auto_translate_mode(index, Node.AUTO_TRANSLATE_MODE_DISABLED)
		column.add_child(picker)
	column.add_child(EditorKit.gap(0.75 * REM))
	var actions := HFlowContainer.new()
	actions.add_theme_constant_override("h_separation", int(round(0.6 * REM)))
	actions.add_theme_constant_override("v_separation", int(round(0.6 * REM)))
	_generate = _button("Generating…" if _run != null else "Generate", true)
	var off := not _ai_ready() or not (_view is Dictionary) or _run != null or _plan() == 0
	_generate.disabled = off
	_generate.modulate = Color(1, 1, 1, 0.55 if off else 1.0)
	_generate.mouse_default_cursor_shape = Control.CURSOR_ARROW if off else Control.CURSOR_POINTING_HAND
	_generate.pressed.connect(_start_generate)
	actions.add_child(_generate)
	if _run != null:
		var stop := _button("Stop")
		stop.pressed.connect(func() -> void: engine.request("scenarioLanguages.stop"))
		actions.add_child(stop)
	_status = _quiet("")
	_status.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	_status.autowrap_mode = TextServer.AUTOWRAP_OFF
	_status.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	actions.add_child(_status)
	column.add_child(actions)
	if not _message.is_empty():
		column.add_child(EditorKit.gap(0.5 * REM))
		column.add_child(_quiet(_message))
	_update_status()


func _update_status() -> void:
	if not is_instance_valid(_status):
		return
	var plan := _plan()
	if not (_view is Dictionary):
		_status.text = "Reading the scenario's strings…"
	elif _run != null:
		var run: Dictionary = _run
		_status.text = PhraseBook.fill_slots("Request {{min}} of {{total}}", {"min": mini(int(run["done"]) + 1, int(run["total"])), "total": int(run["total"])})
	elif plan == 1:
		_status.text = "1 request to your AI"
	elif plan > 0:
		_status.text = PhraseBook.fill_slots("{{planCount}} requests to your AI", {"planCount": plan})
	else:
		_status.text = "Every language is up to date."


func _coverage_text(coverage: Dictionary) -> String:
	if int(coverage.get("missing", 0)) > 0:
		return PhraseBook.fill_slots("{{done}} of {{total}} strings", {"done": int(coverage.get("done", 0)), "total": int(coverage.get("total", 0))})
	return "Up to date"


func _language_row(code: String, entry: Dictionary) -> Control:
	var row := PanelContainer.new()
	row.add_theme_stylebox_override("panel", UI.box(ROW_BG, ROW_BORDER, 12, 1, Vector4(0.55 * REM, 0.45 * REM, 0.55 * REM, 0.45 * REM)))
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", int(round(0.5 * REM)))
	row.add_child(line)
	var texts := VBoxContainer.new()
	texts.add_theme_constant_override("separation", 0)
	texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	texts.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var name_label := UI.label(str(entry.get("name", code)), 13, Color(1, 1, 1), 700)
	name_label.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	name_label.custom_minimum_size.y = 17
	texts.add_child(name_label)
	var coverage: Variant = entry.get("coverage")
	if coverage is Dictionary:
		var missing := int((coverage as Dictionary).get("missing", 0)) > 0
		var label := _quiet(_coverage_text(coverage), WARN if missing else QUIET)
		label.custom_minimum_size.y = 18
		label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		texts.add_child(label)
		_coverage_labels[code] = label
	line.add_child(texts)
	var edit := _button("Hide strings" if _editing == code else "Edit strings")
	edit.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	edit.pressed.connect(func() -> void:
		_editing = "" if _editing == code else code
		_query = ""
		_only_missing = false
		_shown = STRINGS_SHOWN
		_render())
	line.add_child(edit)
	var remove := _button("Remove")
	remove.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	remove.pressed.connect(func() -> void: _remove_language(code))
	line.add_child(remove)
	return row


func _string_editor(code: String) -> Control:
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", int(round(0.45 * REM)))
	var top := MarginContainer.new()
	top.add_theme_constant_override("margin_top", int(round(0.5 * REM)))
	top.add_child(column)
	var bar := HFlowContainer.new()
	bar.add_theme_constant_override("h_separation", int(round(0.5 * REM)))
	var search := LineEdit.new()
	search.placeholder_text = "Search strings"
	search.text = _query
	search.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	search.custom_minimum_size.x = 12 * REM
	search.clear_button_enabled = true
	_style_input(search)
	search.text_changed.connect(func(text: String) -> void:
		_query = text
		_shown = STRINGS_SHOWN
		_fill_strings(code))
	bar.add_child(search)
	var missing := EditorKit.check("Missing only", _only_missing, func(on: bool) -> void:
		_only_missing = on
		_fill_strings(code), 12)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color"]:
		missing.add_theme_color_override(name, QUIET)
	missing.add_theme_font_override("font", UI.font(400))
	missing.add_theme_icon_override("unchecked", UI.svg_texture(BOX_OFF, 1.0))
	missing.add_theme_icon_override("checked", UI.svg_texture(BOX_ON, 1.0))
	missing.add_theme_constant_override("h_separation", int(round(0.35 * REM)))
	bar.add_child(missing)
	column.add_child(bar)
	_editor_list = VBoxContainer.new()
	_editor_list.add_theme_constant_override("separation", int(round(0.45 * REM)))
	column.add_child(_editor_list)
	_fill_strings(code)
	return top


func _fill_strings(code: String) -> void:
	_list_turn += 1
	var turn := _list_turn
	var reply := await engine.request("scenarioLanguages.strings", _args({"code": code, "query": _query, "onlyMissing": _only_missing, "shown": _shown}))
	if not is_instance_valid(self) or turn != _list_turn or not is_instance_valid(_editor_list) or not reply.get("ok", false):
		return
	EditorKit.clear(_editor_list)
	var result: Dictionary = reply["result"]
	for item in result.get("items", []):
		var entry: Dictionary = item
		var source := str(entry.get("text", ""))
		var pair := VBoxContainer.new()
		pair.add_theme_constant_override("separation", int(round(0.25 * REM)))
		var english := _quiet(source)
		english.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
		english.autowrap_mode = TextServer.AUTOWRAP_ARBITRARY
		pair.add_child(english)
		var area := TextEdit.new()
		area.text = str(entry.get("value", ""))
		area.placeholder_text = str(entry.get("placeholder", ""))
		area.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
		area.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
		area.scroll_fit_content_height = true
		area.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		area.custom_minimum_size.y = (3 if source.length() > 90 else 1) * 13 * 1.4 + 0.5 * REM * 2 + 2
		_style_input(area)
		area.text_changed.connect(func() -> void: _edit_string(code, source, area.text))
		pair.add_child(area)
		_editor_list.add_child(pair)
	var total := int(result.get("total", 0))
	if total > _shown:
		var more := _button(PhraseBook.fill_slots("Show {{min}} more", {"min": mini(STRINGS_SHOWN, total - _shown)}))
		more.pressed.connect(func() -> void:
			_shown += STRINGS_SHOWN
			_fill_strings(code))
		_editor_list.add_child(more)


func _edit_string(code: String, source: String, value: String) -> void:
	var pack: Dictionary = (_packs.get(code, {}) as Dictionary).duplicate() if _packs.get(code) is Dictionary else {}
	if value.strip_edges().is_empty():
		pack.erase(source)
	else:
		pack[source] = value
	_packs[code] = pack
	value_changed.emit(_packs.duplicate(true))
	await _refresh_view()
	if not is_instance_valid(self) or not (_view is Dictionary):
		return
	for entry in (_view as Dictionary).get("rows", []):
		var label: Variant = _coverage_labels.get(str(entry.get("code", "")))
		if label is Label and is_instance_valid(label) and entry.get("coverage") is Dictionary:
			var coverage: Dictionary = entry["coverage"]
			(label as Label).text = _coverage_text(coverage)
			(label as Label).add_theme_color_override("font_color", WARN if int(coverage.get("missing", 0)) > 0 else QUIET)
	var off := not _ai_ready() or _run != null or _plan() == 0
	if is_instance_valid(_generate):
		_generate.disabled = off
		_generate.modulate = Color(1, 1, 1, 0.55 if off else 1.0)
	_update_status()


func _remove_language(code: String) -> void:
	_codes = _codes.filter(func(entry: Variant) -> bool: return str(entry) != code)
	if _editing == code:
		_editing = ""
	_packs.erase(code)
	value_changed.emit(_packs.duplicate(true))
	await _refresh_view()
	_render()


func _add_language(code: String) -> void:
	if not code.is_empty() and not _codes.has(code):
		_codes.append(code)
	await _refresh_view()
	_render()


func _start_generate() -> void:
	if _run != null or not (_view is Dictionary):
		return
	_message = ""
	_run = {"done": 0, "total": _plan()}
	_render()
	var reply := await engine.request("scenarioLanguages.generate", _args())
	if not is_instance_valid(self):
		return
	_run = null
	if not reply.get("ok", false):
		_message = PhraseBook.fill_slots("The AI stopped: {{value}}", {"value": str(reply.get("error", ""))})
	else:
		var result: Dictionary = reply["result"]
		if result.get("packs") is Dictionary:
			_packs = _copy_packs(result["packs"])
			value_changed.emit(_packs.duplicate(true))
		var failed := str(result.get("failed", ""))
		if not failed.is_empty() and bool(result.get("aborted", false)):
			_message = "Stopped. What was translated is kept."
		elif not failed.is_empty():
			_message = PhraseBook.fill_slots("The AI stopped: {{value}}", {"value": failed})
		elif int(result.get("requests", 0)) > 0:
			_message = "Generated. Save the scenario to keep them."
		else:
			_message = "Every language is up to date."
	await _refresh_view()
	_render()
