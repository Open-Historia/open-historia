extends VBoxContainer

signal details_changed(details: Dictionary)
signal value_changed(value: Variant)

const BASE_LABELS := {"infantry": "Infantry", "armor": "Armor", "air": "Air", "naval": "Naval", "artillery": "Artillery", "garrison": "Garrison"}
const BASE_GLYPHS := {"infantry": "🛡", "armor": "⚙", "air": "✈", "naval": "⚓", "artillery": "💥", "garrison": "🏰"}
const KINDS := ["infantry", "armor", "air", "naval", "artillery", "garrison"]
const FIGURE_HINTS := {
	"attack": "How hard it hits against an ordinary unit of its kind: 2 is twice as hard.",
	"toughness": "How little it loses against an ordinary unit of its kind: 2 loses half as much.",
	"speed": "How fast it moves on the map against an ordinary unit of its kind: 2 is twice as fast.",
}
const DELETE_INK := Color("#f87171")

var engine: EngineLink
var _props := {}
var _value: Array = []
var _countries: Array = []
var _limits := {"most": 32, "figureMost": 10, "speedMost": 5, "nameMost": 60, "noteMost": 240, "iconMost": 4}
var _open := {}
var _draft := ""
var _owner_drafts := {}
var _list: VBoxContainer
var _empty: Label
var _name_input: LineEdit
var _add: Button
var _headers := {}


func setup(engine_link: EngineLink, props: Dictionary) -> void:
	engine = engine_link
	_props = props.duplicate()
	_value = _types_of(props.get("value"))
	_countries = props.get("countries", []) if props.get("countries") is Array else []
	add_theme_constant_override("separation", 0)
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_build()
	_render()
	_load_limits()


func update_props(props: Dictionary) -> void:
	for key in props:
		_props[key] = props[key]
	if props.get("countries") is Array:
		_countries = props["countries"]
	if props.has("value"):
		var next := _types_of(props["value"])
		if JSON.stringify(next) != JSON.stringify(_value):
			_value = next
			if _list:
				_render()


func value() -> Variant:
	return _value


func _types_of(raw: Variant) -> Array:
	return (raw as Array).duplicate(true) if raw is Array else []


func _load_limits() -> void:
	var reply := await engine.request("editor.unitTypes", {"op": "limits"})
	if reply.get("ok", false) and reply.get("result") is Dictionary:
		_limits = reply["result"]
		if _name_input and is_instance_valid(_name_input):
			_name_input.max_length = int(_limits.get("nameMost", 60))
		_sync_add()


func _edit(args: Dictionary, rerender := true) -> bool:
	var payload := args.duplicate()
	payload["types"] = _value
	var reply := await engine.request("editor.unitTypes", payload)
	if not reply.get("ok", false) or not (reply.get("result") is Array):
		return false
	_value = (reply["result"] as Array).duplicate(true)
	value_changed.emit(_value)
	if rerender:
		_render()
	return true


func _pill(text: String, on: bool) -> Button:
	var node := Button.new()
	node.text = text
	node.focus_mode = Control.FOCUS_NONE
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	node.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_style_pill(node, on)
	return node


func _style_pill(node: Button, on: bool, ink := Color(0, 0, 0, 0)) -> void:
	var bg := EditorWarKit.PRIMARY_BG if on else Color(1, 1, 1, 0.04)
	var border := EditorWarKit.PRIMARY_BORDER if on else Color(1, 1, 1, 0.08)
	var color := EditorWarKit.PRIMARY_INK if on else Color(1, 1, 1, 0.7)
	if ink.a > 0.0:
		color = ink
	EditorWarKit._style_button(node, bg, border, color, 999, 10, 11, 44 if UI.phone() else 29)


func _build() -> void:
	var parts := EditorWarKit.card()
	add_child(parts[0])
	add_child(EditorWarKit.gap(15))
	var column: VBoxContainer = parts[1]
	column.add_child(EditorWarKit.title("Unit types"))
	column.add_child(EditorWarKit.gap(13))
	var adder := HBoxContainer.new()
	adder.add_theme_constant_override("separation", 6)
	_name_input = EditorWarKit.input("", "New unit type name (e.g. Dragon)", func(text: String) -> void:
		_draft = text
		_sync_add())
	_name_input.max_length = int(_limits.get("nameMost", 60))
	_name_input.tooltip_text = "New unit type name (e.g. Dragon)"
	_name_input.text_submitted.connect(func(_text: String) -> void: _add_type())
	adder.add_child(_name_input)
	_add = _pill("Add", false)
	_add.pressed.connect(_add_type)
	adder.add_child(_add)
	column.add_child(adder)
	_empty = EditorWarKit.hint("No unit types yet.", EditorWarKit.HINT, 11)
	var empty_wrap := VBoxContainer.new()
	empty_wrap.add_theme_constant_override("separation", 0)
	empty_wrap.add_child(EditorWarKit.gap(10))
	empty_wrap.add_child(_empty)
	column.add_child(empty_wrap)
	_empty.set_meta("wrap", empty_wrap)
	column.add_child(EditorWarKit.gap(11))
	_list = VBoxContainer.new()
	_list.add_theme_constant_override("separation", 8)
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.add_child(_list)
	_sync_add()


func _full() -> bool:
	return _value.size() >= int(_limits.get("most", 32))


func _sync_add() -> void:
	if not _add or not is_instance_valid(_add):
		return
	var ready := not _draft.strip_edges().is_empty() and not _full()
	_style_pill(_add, ready)
	_add.disabled = not ready
	_add.modulate.a = 1.0 if ready else 0.5


func _add_type() -> void:
	if _draft.strip_edges().is_empty() or _full():
		return
	var before := _value.size()
	var name := _draft
	if not await _edit({"op": "add", "name": name}, false):
		return
	if _value.size() == before:
		return
	var made: Dictionary = _value[_value.size() - 1]
	_open[str(made.get("id", ""))] = true
	_draft = ""
	_name_input.text = ""
	_sync_add()
	_render()


func _render() -> void:
	if not _list:
		return
	EditorKit.clear(_list)
	_headers.clear()
	var wrap: Control = _empty.get_meta("wrap")
	wrap.visible = _value.is_empty()
	for entry in _value:
		if entry is Dictionary:
			_list.add_child(_type_row(entry))
	_sync_add()


func _base_of(type: Dictionary) -> String:
	var base := str(type.get("base", "infantry"))
	return base if KINDS.has(base) else "infantry"


func _figure_text(value: Variant) -> String:
	var number := float(value) if value != null else 1.0
	if is_equal_approx(number, roundf(number)):
		return str(int(roundf(number)))
	return str(snappedf(number, 0.01))


func _figures_line(type: Dictionary) -> String:
	return "×%s · ×%s · ×%s" % [_figure_text(type.get("attack", 1)), _figure_text(type.get("toughness", 1)), _figure_text(type.get("speed", 1))]


func _type_row(type: Dictionary) -> Control:
	var id := str(type.get("id", ""))
	var expanded := bool(_open.get(id, false))
	var base := _base_of(type)
	var holder := PanelContainer.new()
	holder.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0), Color(1, 1, 1, 0.1), 12, 1, Vector4(0, 0, 0, 0)))
	holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	holder.add_child(column)
	var header := Button.new()
	header.focus_mode = Control.FOCUS_NONE
	header.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	header.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var top := UI.box(Color(1, 1, 1, 0.04), Color(0, 0, 0, 0), 0, 0, Vector4(11, 9, 11, 9))
	top.corner_radius_top_left = 11
	top.corner_radius_top_right = 11
	if not expanded:
		top.corner_radius_bottom_left = 11
		top.corner_radius_bottom_right = 11
	var hover := top.duplicate() as StyleBoxFlat
	hover.bg_color = Color(1, 1, 1, 0.07)
	for state in [["normal", top], ["hover", hover], ["pressed", hover], ["hover_pressed", hover], ["focus", top]]:
		header.add_theme_stylebox_override(state[0], state[1])
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 9)
	line.mouse_filter = Control.MOUSE_FILTER_IGNORE
	line.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	line.offset_left = 11
	line.offset_right = -11
	var glyph := UI.label(str(type.get("icon", "")) if not str(type.get("icon", "")).is_empty() else str(BASE_GLYPHS.get(base, "🛡")), 16, UI.WHITE)
	glyph.custom_minimum_size.x = 19
	glyph.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	glyph.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	line.add_child(glyph)
	var name_label := UI.label(str(type.get("name", "")), 13, Color("#f8fafc"), 700)
	name_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	name_label.clip_text = true
	name_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	name_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	name_label.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	line.add_child(name_label)
	var kind_label := UI.label(str(BASE_LABELS.get(base, base)), 11, EditorWarKit.HINT)
	kind_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	line.add_child(kind_label)
	var figures := UI.label(_figures_line(type), 11, EditorWarKit.HINT)
	figures.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	line.add_child(figures)
	var caret := UI.label("▴" if expanded else "▾", 11, Color(1, 1, 1, 0.55))
	caret.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	line.add_child(caret)
	for child in line.get_children():
		(child as Control).mouse_filter = Control.MOUSE_FILTER_IGNORE
	header.add_child(line)
	header.custom_minimum_size.y = 38
	header.pressed.connect(func() -> void:
		if bool(_open.get(id, false)):
			_open.erase(id)
		else:
			_open[id] = true
		_render())
	column.add_child(header)
	_headers[id] = {"glyph": glyph, "name": name_label, "figures": figures}
	if expanded:
		column.add_child(_type_body(type))
	return holder


func _fit(grid: GridContainer, width: float, least: float, most: int) -> void:
	if width <= 0.0:
		return
	var columns := clampi(int((width + 13.0) / (least + 13.0)), 1, most)
	if grid.columns != columns:
		grid.columns = columns


func _auto_grid(least: float, most: int) -> GridContainer:
	var grid := GridContainer.new()
	grid.columns = most
	grid.add_theme_constant_override("h_separation", 13)
	grid.add_theme_constant_override("v_separation", 13)
	grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	grid.resized.connect(func() -> void: _fit(grid, grid.size.x, least, most))
	return grid


func _cell(label_text: String, control: Control, tooltip := "") -> VBoxContainer:
	var cell := EditorWarKit.field_label(label_text)
	cell.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	cell.add_child(control)
	if not tooltip.is_empty():
		cell.tooltip_text = tooltip
		control.tooltip_text = tooltip
	return cell


func _type_body(type: Dictionary) -> Control:
	var id := str(type.get("id", ""))
	var base := _base_of(type)
	var pad := MarginContainer.new()
	for side in [["margin_left", 12], ["margin_right", 12], ["margin_top", 13], ["margin_bottom", 13]]:
		pad.add_theme_constant_override(side[0], side[1])
	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 13)
	pad.add_child(body)
	var first := _auto_grid(160.0, 3)
	var name_edit := EditorWarKit.input(str(type.get("name", "")), "", func(text: String) -> void: _change_text(id, "name", text))
	name_edit.max_length = int(_limits.get("nameMost", 60))
	first.add_child(_cell("Name", name_edit))
	var kinds: Array = []
	for kind in KINDS:
		kinds.append([kind, str(BASE_LABELS.get(kind, kind))])
	first.add_child(_cell("Kind", EditorWarKit.select(kinds, base, func(picked: String) -> void: _edit({"op": "change", "id": id, "patch": {"base": picked}}))))
	var icon_edit := EditorWarKit.input(str(type.get("icon", "")), str(BASE_GLYPHS.get(base, "🛡")), func(text: String) -> void: _change_text(id, "icon", text))
	icon_edit.max_length = int(_limits.get("iconMost", 4)) * 8
	first.add_child(_cell("Icon", icon_edit))
	body.add_child(first)
	var second := _auto_grid(112.0, 3)
	second.add_child(_figure_field(id, "attack", "Attack", type.get("attack", 1), float(_limits.get("figureMost", 10))))
	second.add_child(_figure_field(id, "toughness", "Toughness", type.get("toughness", 1), float(_limits.get("figureMost", 10))))
	second.add_child(_figure_field(id, "speed", "Speed", type.get("speed", 1), float(_limits.get("speedMost", 5))))
	body.add_child(second)
	var note_edit := EditorWarKit.input(str(type.get("note", "")), "", func(text: String) -> void: _change_text(id, "note", text))
	note_edit.max_length = int(_limits.get("noteMost", 240))
	body.add_child(_cell("Note", note_edit))
	body.add_child(_owners(type))
	var delete_row := HBoxContainer.new()
	var delete := _pill("Delete type", false)
	_style_pill(delete, false, DELETE_INK)
	delete.pressed.connect(func() -> void:
		_open.erase(id)
		_edit({"op": "remove", "id": id}))
	delete_row.add_child(delete)
	body.add_child(delete_row)
	return pad


func _change_text(id: String, field: String, text: String) -> void:
	if not await _edit({"op": "change", "id": id, "patch": {field: text}}, false):
		return
	var parts: Dictionary = _headers.get(id, {})
	if parts.is_empty():
		return
	for entry in _value:
		if entry is Dictionary and str((entry as Dictionary).get("id", "")) == id:
			var type: Dictionary = entry
			if field == "name" and is_instance_valid(parts["name"]):
				(parts["name"] as Label).text = str(type.get("name", ""))
			if field == "icon" and is_instance_valid(parts["glyph"]):
				var icon := str(type.get("icon", ""))
				(parts["glyph"] as Label).text = icon if not icon.is_empty() else str(BASE_GLYPHS.get(_base_of(type), "🛡"))


func _figure_field(id: String, field: String, label_text: String, current: Variant, most: float) -> VBoxContainer:
	var shown := _figure_text(current if current != null else 1)
	var edit := EditorWarKit.input(shown, "")
	edit.virtual_keyboard_type = LineEdit.KEYBOARD_TYPE_NUMBER_DECIMAL
	var held := {"value": current if current != null else 1}
	var typed := func(leaving: bool) -> void:
		var reply := await engine.request("editor.unitTypes", {"op": "figure", "text": edit.text, "most": most})
		if not reply.get("ok", false) or not (reply.get("result") is Dictionary):
			return
		var result: Dictionary = reply["result"]
		var ok := bool(result.get("ok", false))
		var next: Variant = result.get("value", 1)
		if ok and not is_equal_approx(float(next), float(held["value"])):
			held["value"] = next
			if await _edit({"op": "change", "id": id, "patch": {field: next}}, false):
				var parts: Dictionary = _headers.get(id, {})
				for entry in _value:
					if entry is Dictionary and str((entry as Dictionary).get("id", "")) == id and not parts.is_empty() and is_instance_valid(parts["figures"]):
						(parts["figures"] as Label).text = _figures_line(entry)
		if leaving and is_instance_valid(edit):
			edit.text = _figure_text(next if ok else held["value"])
	edit.text_changed.connect(func(_text: String) -> void: typed.call(false))
	edit.focus_exited.connect(func() -> void: typed.call(true))
	edit.text_submitted.connect(func(_text: String) -> void: edit.release_focus())
	return _cell(label_text, edit, str(FIGURE_HINTS.get(field, "")))


func _owners(type: Dictionary) -> Control:
	var id := str(type.get("id", ""))
	var owners: Array = type.get("owners", []) if type.get("owners") is Array else []
	var column := EditorWarKit.field_label("Who may field it")
	var chips := HFlowContainer.new()
	chips.add_theme_constant_override("h_separation", 6)
	chips.add_theme_constant_override("v_separation", 6)
	if owners.is_empty():
		var any := EditorWarKit.hint("Any country", EditorWarKit.HINT, 11)
		any.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		chips.add_child(any)
	for owner in owners:
		var named := str(owner)
		var chip := PanelContainer.new()
		chip.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.08), 999, 1, Vector4(10, 2, 5, 2)))
		chip.custom_minimum_size.y = 44 if UI.phone() else 29
		var inner := HBoxContainer.new()
		inner.add_theme_constant_override("separation", 5)
		var text := UI.label(named, 11, Color(1, 1, 1, 0.7), 700)
		text.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		text.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
		inner.add_child(text)
		var remove := Button.new()
		remove.text = "×"
		remove.flat = true
		remove.focus_mode = Control.FOCUS_NONE
		remove.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		remove.tooltip_text = "Remove %s" % named
		remove.add_theme_font_size_override("font_size", 13)
		remove.add_theme_color_override("font_color", Color(1, 1, 1, 0.6))
		remove.add_theme_color_override("font_hover_color", UI.WHITE)
		remove.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		remove.pressed.connect(func() -> void: _edit({"op": "removeOwner", "id": id, "owner": named}))
		inner.add_child(remove)
		chip.add_child(inner)
		chips.add_child(chip)
	column.add_child(chips)
	column.add_child(EditorWarKit.gap(6))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	var add := _pill("Add", false)
	var sync := func() -> void:
		var ready := not str(_owner_drafts.get(id, "")).strip_edges().is_empty()
		_style_pill(add, ready)
		add.disabled = not ready
		add.modulate.a = 1.0 if ready else 0.5
	var on_text := func(text: String) -> void:
		_owner_drafts[id] = text
		sync.call()
	var draft := str(_owner_drafts.get(id, ""))
	var input: LineEdit
	var host: Variant = _props.get("host")
	if host is Node and is_instance_valid(host) and (host as Node).has_method("_suggest_line"):
		var options: Array = []
		for name in _countries:
			options.append([str(name), ""])
		input = (host as Node).call("_suggest_line", draft, options, "Add a country", on_text)
		EditorWarKit.style_line(input)
	else:
		input = EditorWarKit.input(draft, "Add a country", on_text)
	input.tooltip_text = "Add a country"
	var submit := func() -> void:
		var wanted := str(_owner_drafts.get(id, "")).strip_edges()
		if wanted.is_empty():
			return
		_owner_drafts.erase(id)
		_edit({"op": "addOwner", "id": id, "owner": wanted})
	input.text_submitted.connect(func(_text: String) -> void: submit.call())
	add.pressed.connect(func() -> void: submit.call())
	row.add_child(input)
	row.add_child(add)
	sync.call()
	column.add_child(row)
	return column
