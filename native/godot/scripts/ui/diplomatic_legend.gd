class_name DiplomaticLegend
extends GlassPanel

signal closed
signal legend_toggled(open: bool)
signal open_stats(name: String)

const TITLE := "Diplomacy"
const COLLAPSE := "Hide legend"
const FOCUS := "Focus"
const BACK_TO_MINE := "Back to my country"
const DOSSIER := "Dossier"
const NO_INSTITUTIONS := "No institutions in this world"
const PICK_INSTITUTION := "Pick an institution"
const NO_WARS := "No wars in the world"
const CLICK_TO_FOCUS := "Click a country to make it the focus"
const INSTITUTION := "Institution"
const WIDTH := 320.0
const PHONE_WIDTH := 304.0
const NEUTRAL_LAND := [88, 98, 110]
const DIM_ALPHA := 191
const FORWARD := "M-2 6L6 -2M-2 13L13 -2M5 16L16 5M12 16L16 12"
const BACKWARD := "M-2 8L6 16M-2 1L13 16M5 -2L16 9M12 -2L16 2"
const VIEW_ICONS := {
	"relations": "<circle cx='12' cy='12' r='3'/><circle cx='4' cy='6' r='2'/><circle cx='20' cy='6' r='2'/><circle cx='12' cy='21' r='2'/><path d='M6 7l4 3.5M18 7l-4 3.5M12 15v4'/>",
	"wars": "<path d='M4 4l10 10M14 14l-2 4 6-6-4 2M20 4L10 14M10 14l2 4-6-6 4 2'/>",
	"blocs": "<circle cx='9' cy='10' r='5.5'/><circle cx='15' cy='14' r='5.5'/>",
	"government": "<path d='M3 21h18M5 21V10M10 21V10M14 21V10M19 21V10M2 10h20L12 3z'/>",
}

static var _textures := {}

var engine: EngineLink
var context: Dictionary = {}
var map_view: MapView
var mode := "political"
var data: Dictionary = {}
var renders := 0
var _column: VBoxContainer
var _scroll: ScrollContainer
var _list: VBoxContainer
var _tooltip: PanelContainer
var _tooltip_name: Label
var _tooltip_swatch: TextureRect
var _tooltip_what: Label
var _tooltip_dot: Label
var _tooltip_detail: Label
var _ticket := 0
var _hover_at := Vector2(-1, -1)
var _hovered := ""
var _war_key := ""
var _chips: Array[Button] = []


func _init() -> void:
	super._init(UI.HUD_BG, 12.0, Vector4(8, 7.2, 8, 8))
	theme_as("glass_pill", "hud_border")
	anchor_left = 1.0
	anchor_right = 1.0
	anchor_top = 1.0
	anchor_bottom = 1.0
	grow_horizontal = Control.GROW_DIRECTION_BEGIN
	grow_vertical = Control.GROW_DIRECTION_BEGIN
	var phone := UI.phone()
	var inset := UI.safe_insets() if phone else Vector4.ZERO
	var right := 8.0 + inset.z if phone else 80.0
	var bottom := 134.4 + inset.w if phone else 8.0 + 36.0 + 5.6
	offset_right = -right
	offset_bottom = -bottom
	offset_left = offset_right - _width()
	offset_top = offset_bottom - 60.0
	custom_minimum_size.x = _width()
	_column = VBoxContainer.new()
	_column.add_theme_constant_override("separation", 6)
	_column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_column)
	visible = false


func _width() -> float:
	if not UI.phone():
		return WIDTH
	var view := Vector2(1280, 800)
	var tree := Engine.get_main_loop() as SceneTree
	if tree and tree.root:
		view = tree.root.get_visible_rect().size
	return minf(PHONE_WIDTH, view.x - 16.0)


func _max_height() -> float:
	var view := get_viewport_rect().size if is_inside_tree() else Vector2(1280, 800)
	return minf(view.y * 0.46, 352.0) if UI.phone() else minf(view.y * 0.62, 480.0)


func setup(link: EngineLink, setup_context: Dictionary = {}) -> void:
	engine = link
	context = setup_context
	map_view = setup_context.get("map_view")
	_make_tooltip()


func _notification(what: int) -> void:
	super._notification(what)
	if what == NOTIFICATION_PREDELETE and _tooltip and is_instance_valid(_tooltip):
		_tooltip.queue_free()


func show_legend() -> void:
	await apply_mode("diplomatic")


func hide_legend() -> void:
	await apply_mode("political")


func legend_open() -> bool:
	return mode == "diplomatic" and bool(data.get("legendOpen", true))


func apply_mode(next: String) -> void:
	mode = "diplomatic" if next == "diplomatic" else "political"
	if mode != "diplomatic":
		visible = false
		_hide_tooltip()
		_paint_map({})
	await _send({"mode": mode})


func refresh() -> void:
	if mode == "diplomatic":
		await _send({})


func show_again() -> void:
	await _send({"legendOpen": true})


func on_region_clicked(owner: String) -> void:
	if mode != "diplomatic" or owner.is_empty() or str(data.get("view", "")) != "relations":
		return
	if str(data.get("focus", "")) == owner:
		return
	await _send({"focus": owner})


func _send(patch: Dictionary) -> void:
	if not engine:
		return
	_ticket += 1
	var ticket := _ticket
	var reply: Dictionary = await engine.request("diplomap.set" if not patch.is_empty() else "diplomap.view", {"patch": patch})
	if ticket != _ticket or not is_instance_valid(self) or not bool(reply.get("ok", false)) or not (reply.get("result") is Dictionary):
		return
	_render(reply["result"])


func _render(payload: Dictionary) -> void:
	data = payload
	renders += 1
	var shown := mode == "diplomatic" and str(payload.get("mode", "")) == "diplomatic"
	if not shown:
		visible = false
		_paint_map({})
		legend_toggled.emit(false)
		return
	_paint_map(payload)
	_build()
	var open := bool(payload.get("legendOpen", true))
	visible = open
	legend_toggled.emit(open)
	_hovered = ""
	_hover_at = Vector2(-1, -1)


func _paint_map(payload: Dictionary) -> void:
	if not map_view or not is_instance_valid(map_view):
		return
	var colors := {}
	var owners: Dictionary = payload.get("owners", {})
	for name in owners.keys():
		var entry: Dictionary = owners[name]
		var rgb: Array = entry.get("color", [69, 66, 59])
		colors[str(name)] = [int(rgb[0]), int(rgb[1]), int(rgb[2]), DIM_ALPHA if bool(entry.get("dim", false)) else 255]
	var neutral := Color8(NEUTRAL_LAND[0], NEUTRAL_LAND[1], NEUTRAL_LAND[2], DIM_ALPHA if bool(payload.get("neutralDim", false)) else 255)
	map_view.set_owner_color_override(colors, neutral if not colors.is_empty() else Color(0, 0, 0, 0))
	var extras: Node = map_view.extras
	if extras == null:
		return
	var layers: Variant = extras.get("diplomatic")
	if layers is Node and is_instance_valid(layers):
		(layers as Node).call("apply", payload if not colors.is_empty() else {})
	var key := JSON.stringify(colors)
	if key != _war_key:
		_war_key = key
		if extras.has_method("refresh_world"):
			extras.call("refresh_world")
		var war: Variant = extras.call("war_layers")
		if war is Node and is_instance_valid(war) and str((war as Node).get("mode")) == "diplomatic":
			(war as Node).call("refresh")


func _patch(patch: Dictionary) -> void:
	_send(patch)


func _clear(node: Node) -> void:
	for child in node.get_children():
		node.remove_child(child)
		child.queue_free()


func _build() -> void:
	_clear(_column)
	_chips.clear()
	var view := str(data.get("view", "relations"))
	var phone := UI.phone()
	var header := HBoxContainer.new()
	header.add_theme_constant_override("separation", 6)
	header.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var title := UI.label(TITLE.to_upper(), 10, Color(1, 1, 1, 0.75), 700)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	header.add_child(title)
	if view == "relations":
		var info := UI.label("ⓘ", 12, Color(1, 1, 1, 0.6))
		info.mouse_filter = Control.MOUSE_FILTER_STOP
		info.mouse_default_cursor_shape = Control.CURSOR_HELP
		info.tooltip_text = str(data.get("precedence", ""))
		info.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		header.add_child(info)
	var shut := Button.new()
	shut.text = "▾"
	shut.flat = true
	shut.focus_mode = Control.FOCUS_NONE
	shut.tooltip_text = COLLAPSE
	shut.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	shut.set_meta("oh_tap_exempt", true)
	shut.add_theme_font_size_override("font_size", 13)
	for state in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
		shut.add_theme_color_override(state, Color(1, 1, 1, 0.6))
	for state in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
		shut.add_theme_stylebox_override(state, UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 0, Vector4(2.4, 0, 2.4, 0)))
	shut.pressed.connect(_on_collapse)
	header.add_child(shut)
	_column.add_child(header)

	var tabs := PanelContainer.new()
	tabs.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0.18), Color(0, 0, 0, 0), 9, 0, Vector4(2.4, 2.4, 2.4, 2.4)))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 2)
	for entry in data.get("views", []):
		var id := str((entry as Dictionary).get("id", ""))
		var on := id == view
		var chip := _chip(str((entry as Dictionary).get("label", id)) if (not phone or on) else "", on, id)
		chip.tooltip_text = str((entry as Dictionary).get("label", id))
		chip.set_meta("patch", {"view": id})
		chip.pressed.connect(_on_chip.bind(chip))
		row.add_child(chip)
		_chips.append(chip)
	tabs.add_child(row)
	_column.add_child(tabs)

	if view == "relations":
		_column.add_child(_focus_row())
	elif view == "blocs":
		if bool(data.get("noInstitutions", false)):
			_column.add_child(UI.label(NO_INSTITUTIONS, 11, Color(1, 1, 1, 0.7)))
		else:
			_column.add_child(_institution_picker())
	elif view == "government":
		var axes := HBoxContainer.new()
		axes.add_theme_constant_override("separation", 2)
		var axis_chips: Array[Button] = []
		for entry in data.get("axes", []):
			var id := str((entry as Dictionary).get("id", ""))
			var chip := _chip(str((entry as Dictionary).get("label", id)), id == str(data.get("axis", "")), "")
			chip.set_meta("patch", {"axis": id})
			chip.pressed.connect(_on_chip.bind(chip))
			axes.add_child(chip)
			axis_chips.append(chip)
		_column.add_child(axes)
		_spread.call_deferred(axis_chips)

	_scroll = ScrollContainer.new()
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	if phone:
		_scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_SHOW_NEVER
	_list = VBoxContainer.new()
	_list.add_theme_constant_override("separation", 2)
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_scroll.add_child(_list)
	_column.add_child(_scroll)
	var highlight: Variant = data.get("highlight")
	var picked := str((highlight as Dictionary).get("id", "")) if highlight is Dictionary else ""
	if view == "wars":
		var wars: Array = data.get("wars", [])
		if wars.is_empty():
			_list.add_child(UI.label(NO_WARS, 11, Color(1, 1, 1, 0.7)))
		var focused := str(data.get("focusWar", ""))
		for war in wars:
			_list.add_child(_war_row(war, focused))
	for entry in data.get("entries", []):
		_list.add_child(_entry_row(entry, picked))
	_spread.call_deferred(_chips)
	_fit.call_deferred()


func _fit() -> void:
	if not is_instance_valid(_scroll) or not is_instance_valid(_list):
		return
	var others := 0.0
	for child in _column.get_children():
		if child != _scroll and child is Control:
			others += (child as Control).get_combined_minimum_size().y + 6.0
	var room := maxf(40.0, _max_height() - 15.2 - others)
	_scroll.custom_minimum_size.y = minf(_list.get_combined_minimum_size().y, room)
	offset_top = offset_bottom - get_combined_minimum_size().y
	offset_left = offset_right - _width()


func _spread(chips: Array[Button]) -> void:
	if chips.is_empty() or not is_instance_valid(chips[0]):
		return
	var room := _width() - 16.0 - (4.8 if chips == _chips else 0.0) - 2.0 * (chips.size() - 1)
	var widths: Array[float] = []
	var used := 0.0
	for chip in chips:
		var font: Font = chip.get_theme_font("font")
		var width := 9.6 + (font.get_string_size(chip.text, HORIZONTAL_ALIGNMENT_LEFT, -1, 11).x if not chip.text.is_empty() else 0.0)
		if chip.icon:
			width += 13.0 + (4.0 if not chip.text.is_empty() else 0.0)
		widths.append(width)
		used += width
	var share := maxf(0.0, (room - used) / chips.size())
	for at in range(chips.size()):
		chips[at].custom_minimum_size.x = floorf(widths[at] + share) - 1.0


func _chip(text: String, on: bool, icon_id: String) -> Button:
	var chip := Button.new()
	chip.text = text
	chip.focus_mode = Control.FOCUS_NONE
	chip.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	chip.set_meta("oh_tap_exempt", true)
	chip.alignment = HORIZONTAL_ALIGNMENT_CENTER
	chip.icon_alignment = HORIZONTAL_ALIGNMENT_LEFT if not text.is_empty() else HORIZONTAL_ALIGNMENT_CENTER
	chip.add_theme_constant_override("h_separation", 4)
	chip.add_theme_font_override("font", UI.font(600 if on else 500))
	chip.add_theme_font_size_override("font_size", 11)
	chip.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	var ink := Color.WHITE if on else Color(1, 1, 1, 0.62)
	for state in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "icon_normal_color", "icon_hover_color", "icon_pressed_color", "icon_focus_color"]:
		chip.add_theme_color_override(state, ink)
	if not icon_id.is_empty():
		chip.icon = _view_icon(icon_id)
	var fill := UiTheme.pick("glass_active", Color(1, 1, 1, 0.14)) if on else Color(0, 0, 0, 0)
	var edge := UiTheme.pick("glass_active_line", Color(1, 1, 1, 0.28)) if on else Color(0, 0, 0, 0)
	var style := UI.box(fill, edge, 7, 1, Vector4(4.8, 4.48, 4.8, 4.48))
	if not on:
		style.set_border_width_all(1)
	for state in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
		chip.add_theme_stylebox_override(state, style)
	return chip


func _small_button(text: String) -> Button:
	var button := Button.new()
	button.text = text
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.set_meta("oh_tap_exempt", true)
	button.add_theme_font_size_override("font_size", 10)
	for state in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
		button.add_theme_color_override(state, Color(1, 1, 1, 0.82))
	var style := UI.box(Color(0, 0, 0, 0), UiTheme.pick("hud_border", UI.HUD_BORDER), 6, 1, Vector4(6.4, 1.92, 6.4, 1.92))
	for state in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
		button.add_theme_stylebox_override(state, style)
	button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	return button


func _focus_row() -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	row.add_child(UI.label(FOCUS, 11, Color(1, 1, 1, 0.55)))
	var name := UI.label(str(data.get("focusLabel", "")), 11, Color.WHITE, 700)
	name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	name.clip_text = true
	name.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	name.mouse_filter = Control.MOUSE_FILTER_STOP
	name.tooltip_text = CLICK_TO_FOCUS
	row.add_child(name)
	if not bool(data.get("focusIsMine", true)) and not str(data.get("player", "")).is_empty():
		var back := _small_button(BACK_TO_MINE)
		back.set_meta("patch", {"focus": ""})
		back.pressed.connect(_on_chip.bind(back))
		row.add_child(back)
	var focus_name := str(data.get("focusName", ""))
	if not focus_name.is_empty():
		var dossier := _small_button(DOSSIER)
		dossier.set_meta("country", focus_name)
		dossier.pressed.connect(_on_dossier.bind(dossier))
		row.add_child(dossier)
	return row


func _institution_picker() -> Control:
	var picker := OptionButton.new()
	picker.focus_mode = Control.FOCUS_NONE
	picker.tooltip_text = INSTITUTION
	picker.add_theme_font_size_override("font_size", 11)
	picker.fit_to_longest_item = false
	picker.clip_text = true
	var style := UI.box(Color(0, 0, 0, 0.3), UiTheme.pick("hud_border", UI.HUD_BORDER), 7, 1, Vector4(4.8, 3.52, 4.8, 3.52))
	for state in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
		picker.add_theme_stylebox_override(state, style)
	for state in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
		picker.add_theme_color_override(state, Color.WHITE)
	var current := str(data.get("institutionId", ""))
	var ids: Array[String] = []
	if current.is_empty():
		picker.add_item(PICK_INSTITUTION)
		ids.append("")
	for entry in data.get("institutions", []):
		var item: Dictionary = entry
		picker.add_item("%s (%d)" % [str(item.get("label", "")), int(item.get("members", 0))])
		ids.append(str(item.get("id", "")))
	picker.selected = max(0, ids.find(current))
	picker.set_meta("ids", ids)
	picker.item_selected.connect(_on_institution.bind(picker))
	return picker


func _entry_row(entry: Dictionary, picked: String) -> Control:
	var id := str(entry.get("id", ""))
	var on := not picked.is_empty() and picked == id
	var row := Button.new()
	row.focus_mode = Control.FOCUS_NONE
	row.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	row.set_meta("oh_tap_exempt", true)
	row.tooltip_text = str(entry.get("label", ""))
	var fill := UiTheme.pick("glass_active", Color(1, 1, 1, 0.1)) if on else Color(0, 0, 0, 0)
	var edge := UiTheme.pick("glass_active_line", Color(1, 1, 1, 0.3)) if on else Color(0, 0, 0, 0)
	var style := UI.box(fill, edge, 6, 1, Vector4(4.8, 2.56, 4.8, 2.56))
	style.set_border_width_all(1)
	for state in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
		row.add_theme_stylebox_override(state, style)
	if not picked.is_empty() and not on:
		row.modulate.a = 0.45
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 7)
	line.mouse_filter = Control.MOUSE_FILTER_IGNORE
	line.add_child(_swatch_rect(entry.get("rgb", []), str(entry.get("hatch", ""))))
	var label := UI.label(str(entry.get("label", "")), 11, Color(1, 1, 1, 0.9))
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	label.clip_text = true
	label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	line.add_child(label)
	line.add_child(UI.label(str(int(entry.get("count", 0))), 11, Color(1, 1, 1, 0.55)))
	row.add_child(line)
	row.custom_minimum_size.y = 21.0
	line.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	line.offset_left = 4.8
	line.offset_right = -4.8
	line.offset_top = 2.0
	line.offset_bottom = -2.0
	row.set_meta("entry", entry)
	row.pressed.connect(_on_entry.bind(row))
	return row


func _war_row(war: Dictionary, focused: String) -> Control:
	var id := str(war.get("id", ""))
	var on := focused == id
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 2)
	if not focused.is_empty() and not on:
		box.modulate.a = 0.45
	var head := Button.new()
	head.text = str(war.get("label", ""))
	head.focus_mode = Control.FOCUS_NONE
	head.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	head.set_meta("oh_tap_exempt", true)
	head.alignment = HORIZONTAL_ALIGNMENT_LEFT
	head.clip_text = true
	head.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	head.add_theme_font_override("font", UI.font(600))
	head.add_theme_font_size_override("font_size", 11)
	for state in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
		head.add_theme_color_override(state, Color(1, 1, 1, 0.82))
	var fill := UiTheme.pick("glass_active", Color(1, 1, 1, 0.1)) if on else Color(0, 0, 0, 0)
	var edge := UiTheme.pick("glass_active_line", Color(1, 1, 1, 0.3)) if on else Color(0, 0, 0, 0)
	var style := UI.box(fill, edge, 6, 1, Vector4(4.8, 2.56, 4.8, 2.56))
	style.set_border_width_all(1)
	for state in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
		head.add_theme_stylebox_override(state, style)
	head.set_meta("war", war)
	head.pressed.connect(_on_war.bind(head))
	box.add_child(head)
	var hatch := "ceasefire" if str(war.get("status", "")) == "ceasefire" else ""
	for side in war.get("sides", []):
		var item: Dictionary = side
		var line := HBoxContainer.new()
		line.add_theme_constant_override("separation", 6)
		var pad := MarginContainer.new()
		pad.add_theme_constant_override("margin_left", 14)
		pad.add_theme_constant_override("margin_right", 5)
		line.add_child(_swatch_rect(item.get("rgb", []), hatch))
		var names: Array = item.get("names", [])
		var words := ", ".join(PackedStringArray(names.map(func(value: Variant) -> String: return str(value))))
		if int(item.get("more", 0)) > 0:
			words += " +%d" % int(item.get("more", 0))
		var label := UI.label(words, 11, Color(1, 1, 1, 0.8))
		label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		label.clip_text = true
		label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		line.add_child(label)
		line.add_child(UI.label(str(int(item.get("count", 0))), 11, Color(1, 1, 1, 0.5)))
		pad.add_child(line)
		box.add_child(pad)
	return box


func _on_chip(button: Button) -> void:
	_patch(button.get_meta("patch", {}))


func _on_collapse() -> void:
	visible = false
	legend_toggled.emit(false)
	closed.emit()
	_patch({"legendOpen": false})


func _on_dossier(button: Button) -> void:
	open_stats.emit(str(button.get_meta("country", "")))


func _on_institution(index: int, picker: OptionButton) -> void:
	var ids: Array = picker.get_meta("ids", [])
	if index >= 0 and index < ids.size():
		_patch({"institution": str(ids[index])})


func _on_entry(row: Button) -> void:
	var entry: Dictionary = row.get_meta("entry", {})
	var colors: Array = entry.get("colors", [])
	if colors.is_empty():
		return
	var highlight: Variant = data.get("highlight")
	var current := str((highlight as Dictionary).get("id", "")) if highlight is Dictionary else ""
	var id := str(entry.get("id", ""))
	_patch({"highlight": null if current == id else {"id": id, "colors": colors}})


func _on_war(head: Button) -> void:
	var war: Dictionary = head.get_meta("war", {})
	var id := str(war.get("id", ""))
	var on := str(data.get("focusWar", "")) != id
	_patch({"focusWar": id if on else "", "highlight": {"id": "war:" + id, "colors": war.get("colors", [])} if on else null})


func _view_icon(id: String) -> Texture2D:
	var key := "view:" + id
	if not _textures.has(key):
		var svg := "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='#ffffff' stroke-width='2' stroke-linecap='round'>%s</svg>" % str(VIEW_ICONS.get(id, ""))
		_textures[key] = UI.svg_texture(svg, 13.0 / 24.0)
	return _textures[key]


func swatch(rgb: Array, hatch: String) -> Texture2D:
	var colour := Color8(int(rgb[0]), int(rgb[1]), int(rgb[2])) if rgb.size() >= 3 else Color("#45423b")
	var key := "swatch:%s:%s" % [colour.to_html(false), hatch]
	if _textures.has(key):
		return _textures[key]
	var lines := ""
	var hatches: Dictionary = data.get("hatches", {})
	if hatches.has(hatch):
		var look: Dictionary = hatches[hatch]
		var ink: Array = look.get("color", [246, 241, 227])
		var style := str(look.get("style", ""))
		var paths := ""
		if style != "back":
			paths += "<path d='%s'/>" % FORWARD
		if style != "diag":
			paths += "<path d='%s'/>" % BACKWARD
		lines = "<g clip-path='url(#c)' stroke='#%s' stroke-width='1.6' opacity='0.9' fill='none'>%s</g>" % [Color8(int(ink[0]), int(ink[1]), int(ink[2])).to_html(false), paths]
	var svg := "<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 14 14'><defs><clipPath id='c'><rect width='14' height='14' rx='3'/></clipPath></defs><rect width='14' height='14' rx='3' fill='#%s'/>%s<rect x='0.5' y='0.5' width='13' height='13' rx='2.5' fill='none' stroke='#ffffff' stroke-opacity='0.22'/></svg>" % [colour.to_html(false), lines]
	_textures[key] = UI.svg_texture(svg, 1.0)
	return _textures[key]


func _swatch_rect(rgb: Array, hatch: String) -> TextureRect:
	var rect := TextureRect.new()
	rect.texture = swatch(rgb, hatch)
	rect.custom_minimum_size = Vector2(14, 14)
	rect.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
	rect.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	rect.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return rect


func _make_tooltip() -> void:
	if _tooltip and is_instance_valid(_tooltip):
		return
	_tooltip = PanelContainer.new()
	_tooltip.top_level = true
	_tooltip.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_tooltip.z_index = 100
	_tooltip.add_theme_stylebox_override("panel", UI.box(UiTheme.pick("overlay", Color(24 / 255.0, 24 / 255.0, 27 / 255.0, 0.95)), UiTheme.pick("hud_border", UI.HUD_BORDER), 8, 1, Vector4(8, 4.8, 8, 4.8)))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 1)
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_tooltip_name = UI.label("", 11, Color.WHITE, 700)
	column.add_child(_tooltip_name)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_tooltip_swatch = _swatch_rect([69, 66, 59], "")
	row.add_child(_tooltip_swatch)
	_tooltip_what = UI.label("", 11, Color(1, 1, 1, 0.82))
	row.add_child(_tooltip_what)
	_tooltip_dot = UI.label("·", 11, Color(1, 1, 1, 0.82))
	row.add_child(_tooltip_dot)
	_tooltip_detail = UI.label("", 11, Color(1, 1, 1, 0.82))
	_tooltip_detail.clip_text = true
	_tooltip_detail.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	row.add_child(_tooltip_detail)
	column.add_child(row)
	_tooltip.add_child(column)
	_tooltip.visible = false
	var parent := get_parent()
	if parent:
		parent.add_child.call_deferred(_tooltip)


func _hide_tooltip() -> void:
	if _tooltip and is_instance_valid(_tooltip):
		_tooltip.visible = false
	_hovered = ""


func show_tooltip_for(owner: String, at: Vector2) -> void:
	var owners: Dictionary = data.get("owners", {})
	if owner.is_empty() or not owners.has(owner) or not _tooltip or not is_instance_valid(_tooltip):
		_hide_tooltip()
		return
	var entry: Dictionary = owners[owner]
	var tie: Array = entry.get("tie", ["", ""])
	_tooltip_name.text = str(entry.get("name", owner))
	_tooltip_swatch.texture = swatch(entry.get("color", []), str(entry.get("hatch", "")))
	_tooltip_what.text = str(tie[0]) if tie.size() > 0 else ""
	var detail := str(tie[1]) if tie.size() > 1 else ""
	_tooltip_detail.text = detail
	_tooltip_detail.visible = not detail.is_empty()
	_tooltip_dot.visible = not detail.is_empty()
	_tooltip_detail.custom_minimum_size.x = 0.0
	_tooltip.reset_size()
	var width := minf(_tooltip.get_combined_minimum_size().x, 240.0)
	if _tooltip.get_combined_minimum_size().x > 240.0:
		_tooltip_detail.custom_minimum_size.x = maxf(20.0, 240.0 - (_tooltip.get_combined_minimum_size().x - _tooltip_detail.get_combined_minimum_size().x))
	var view := get_viewport_rect().size
	_tooltip.position = Vector2(minf(at.x + 14.0, view.x - 230.0), at.y + 16.0)
	_tooltip.size = Vector2(width, 0)
	_tooltip.visible = true
	_hovered = owner


func _process(_delta: float) -> void:
	if mode != "diplomatic" or UI.phone() or not map_view or not is_instance_valid(map_view) or data.get("owners", {}).is_empty():
		if not _hovered.is_empty():
			_hide_tooltip()
		return
	var at := get_viewport().get_mouse_position()
	if at == _hover_at:
		return
	_hover_at = at
	if get_viewport().gui_get_hovered_control() != null or not get_viewport().get_visible_rect().has_point(at):
		_hide_tooltip()
		return
	var index: int = map_view.baker.pick(map_view.screen_to_world(at))
	var owner := map_view.region_owner(index) if index >= 0 else ""
	if owner.is_empty():
		_hide_tooltip()
		return
	show_tooltip_for(owner, at)
