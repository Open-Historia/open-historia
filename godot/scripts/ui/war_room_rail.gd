class_name WarRoomRail
extends Control

signal order(order: String)
signal release
signal withdraw
signal send_back
signal carrier(medium: String)
signal fleets_toggled
signal supply_toggled
signal cleared

const T := preload("res://scripts/ui/war_room_theme.gd")
const W := preload("res://scripts/ui/war_room_words.gd")
const LOAD_MOST := 40
const RAIL_WIDTH := 3.75 * 16.0
const KEY_SIZE := 3.05 * 16.0
const ICONS := {
	"select": "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect x='3.5' y='3.5' width='13' height='13' rx='1' stroke-dasharray='3 3.2'/><path d='M13 13l7.5 3-3.2 1.3L16 20.5z' fill='currentColor' stroke-width='1.4'/></svg>",
	"route": "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M4 19c1-6 4-7 7-7s5-2 5-5'/><path d='M12.5 6.5L16 3.5l3.5 3'/><circle cx='4' cy='19' r='1.2' fill='currentColor'/></svg>",
	"advance": "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M5 6l6 6-6 6'/><path d='M12.5 6l6 6-6 6'/></svg>",
	"dig in": "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M2.5 9h5l2 7h5l2-7h5'/><path d='M12 3.5v6M9.6 7.4L12 9.8l2.4-2.4'/></svg>",
	"hold": "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M12 3l7 2.6v5.6c0 4.4-2.9 7.6-7 9.3-4.1-1.7-7-4.9-7-9.3V5.6z'/></svg>",
	"fall back": "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M19 7v4a4 4 0 0 1-4 4H5'/><path d='M9.5 10.5L5 15l4.5 4.5'/></svg>",
	"withdraw": "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M20.5 4.5v15'/><path d='M16 12H4M8.5 7.5L4 12l4.5 4.5'/></svg>",
	"return": "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M3.5 4.5v15'/><path d='M8 12h12M15.5 7.5L20 12l-4.5 4.5'/></svg>",
	"release": "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M3.5 19.5h17'/><path d='M12 4v10.5M7.8 10.6L12 14.8l4.2-4.2'/></svg>",
	"sea": "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M12 2.5l4.5 6v10L14 21.5h-4l-2.5-3v-10z'/><path d='M12 7v10'/></svg>",
	"land": "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect x='8' y='2.5' width='8' height='8' rx='1.6'/><rect x='8' y='13' width='8' height='8.5' rx='1'/><path d='M12 10.5V13'/></svg>",
	"air": "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M12 2l1.4 7 8.1 5v2l-8.1-2.2-.5 5 2.6 2v1.2L12 21l-3.5 1v-1.2l2.6-2-.5-5L2.5 16v-2l8.1-5z'/></svg>",
	"diversion": "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' stroke-dasharray='3.2 3.4'><path d='M4 18c2-7 6-9 14-10'/><path d='M14.5 4.6L18.4 8l-3.2 3.9' stroke-dasharray='0'/></svg>",
	"deploy": "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M3 19h18'/><path d='M4.5 11h4v4h-4z'/><path d='M10 11h4v4h-4z'/><path d='M15.5 11h4v4h-4z'/></svg>",
	"fortify": "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M3.5 20.5v-11h3v-3h3v3h5v-3h3v3h3v11z'/><path d='M10 20.5v-4.5h4v4.5'/></svg>",
	"fleet": "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M3 15.5h18l-2.8 4.5H5.8z'/><path d='M12 3.5v12'/><path d='M12 5.5l6.5 8H12'/></svg>",
	"supply": "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M4 8l8-4.5L20 8v8.5L12 21l-8-4.5z'/><path d='M4 8l8 4.5L20 8M12 12.5V21'/></svg>",
}
const CHEVRON_LEFT := "<svg viewBox='0 0 10 14' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='M7.5 2l-5 5 5 5'/></svg>"
const CHEVRON_RIGHT := "<svg viewBox='0 0 10 14' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='M2.5 2l5 5-5 5'/></svg>"

var store: WarRoomStore
var props: Dictionary = {}
var tucked := false
var choosing := false
var _plate: PanelContainer
var _scroll: ScrollContainer
var _column: VBoxContainer
var _tab: Button
var _hint: PanelContainer
var _carriers: PanelContainer
var _count_input: LineEdit
var _was_shown := false


func _init() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_plate = PanelContainer.new()
	_plate.texture_repeat = CanvasItem.TEXTURE_REPEAT_ENABLED
	var plate_style := T.plate_style([Color(0, 0, 0, 0), T.SEAM, T.SEAM, T.SEAM], Vector4(0, 2, 2, 2), Vector4(T.px(0.3), T.px(0.5) + 2.0, T.px(0.3) + 2.0, T.px(0.4) + 2.0))
	T.add_rivet(plate_style, "top-left", T.px(0.16), T.px(0.16), 0.34)
	T.add_rivet(plate_style, "top-right", T.px(0.16), T.px(0.16), 0.34)
	_plate.add_theme_stylebox_override("panel", plate_style)
	_plate.mouse_filter = Control.MOUSE_FILTER_STOP
	_plate.clip_contents = true
	add_child(_plate)
	_scroll = ScrollContainer.new()
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_SHOW_NEVER
	_plate.add_child(_scroll)
	_column = VBoxContainer.new()
	_column.add_theme_constant_override("separation", int(round(T.px(0.28))))
	_column.alignment = BoxContainer.ALIGNMENT_BEGIN
	_scroll.add_child(_column)
	_tab = Button.new()
	_tab.focus_mode = Control.FOCUS_NONE
	_tab.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	_tab.texture_repeat = CanvasItem.TEXTURE_REPEAT_ENABLED
	var tab_style := T.plate_style([Color(0, 0, 0, 0), T.SEAM, T.SEAM, T.SEAM], Vector4(0, 2, 2, 2))
	for state in ["normal", "hover", "pressed", "hover_pressed", "focus"]:
		_tab.add_theme_stylebox_override(state, tab_style)
	_tab.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_tab.pressed.connect(func() -> void:
		tucked = not tucked
		_render())
	add_child(_tab)
	_hint = PanelContainer.new()
	_hint.texture_repeat = CanvasItem.TEXTURE_REPEAT_ENABLED
	_hint.add_theme_stylebox_override("panel", T.plate_style([T.SEAM, T.SEAM, T.SEAM, T.SEAM], Vector4(2, 2, 2, 2), Vector4(T.px(0.6) + 2.0, T.px(0.4) + 2.0, T.px(0.6) + 2.0, T.px(0.4) + 2.0)))
	_hint.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(_hint)
	_carriers = PanelContainer.new()
	_carriers.texture_repeat = CanvasItem.TEXTURE_REPEAT_ENABLED
	_carriers.add_theme_stylebox_override("panel", T.plate_style([T.SEAM, T.SEAM, T.SEAM, T.SEAM], Vector4(2, 2, 2, 2), Vector4(T.px(0.55) + 2.0, T.px(0.5) + 2.0, T.px(0.55) + 2.0, T.px(0.5) + 2.0)))
	_carriers.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(_carriers)


func setup(shared: WarRoomStore) -> void:
	store = shared
	store.changed.connect(func(keys: PackedStringArray) -> void:
		for key in ["tool", "selected", "fleets", "station", "deploy_form", "deploy_count", "supply", "draft"]:
			if key in keys:
				_render()
				return)


func set_props(value: Dictionary) -> void:
	props = value
	var shown := bool(props.get("shown", false))
	if shown != _was_shown:
		_was_shown = shown
		if not shown:
			tucked = false
			choosing = false
	_render()


func right_edge() -> float:
	if not bool(props.get("shown", false)) or tucked:
		return 0.0
	return _plate.position.x + _plate.size.x


func _icon(name: String, colour: Color) -> TextureRect:
	return T.icon_rect("rail-" + name, ICONS[name], 19, colour)


func _rail_key(label_text: String, title: String, icon_name: String, on: Variant, disabled: bool, action: Callable) -> Button:
	var button := Button.new()
	button.focus_mode = Control.FOCUS_NONE
	button.custom_minimum_size = Vector2(KEY_SIZE, KEY_SIZE)
	button.tooltip_text = title
	button.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	var lit := on is bool and bool(on)
	var style := T.key_style(lit, Vector4(T.px(0.05), T.px(0.2), T.px(0.05), T.px(0.2)))
	for state in ["normal", "hover", "pressed", "hover_pressed", "focus", "disabled"]:
		button.add_theme_stylebox_override(state, style)
	button.disabled = disabled
	button.modulate.a = 0.5 if disabled else 1.0
	button.mouse_default_cursor_shape = Control.CURSOR_ARROW if disabled else Control.CURSOR_POINTING_HAND
	var ink := T.BONE_FAINT if disabled else T.BONE
	var inner := VBoxContainer.new()
	inner.alignment = BoxContainer.ALIGNMENT_CENTER
	inner.add_theme_constant_override("separation", int(round(T.px(0.16))))
	inner.mouse_filter = Control.MOUSE_FILTER_IGNORE
	inner.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var glyph := _icon(icon_name, ink)
	glyph.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	inner.add_child(glyph)
	var caption := T.stencil(label_text, 0.56, ink, 0.05)
	caption.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	caption.clip_text = true
	caption.custom_minimum_size.x = KEY_SIZE - 2.0
	caption.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	inner.add_child(caption)
	button.add_child(inner)
	button.pressed.connect(action)
	return button


func _rule() -> Control:
	var gap := Control.new()
	gap.custom_minimum_size = Vector2(0, 1.0 + 2.0 * T.px(0.12))
	gap.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return gap


func _render() -> void:
	if not store:
		return
	var shown := bool(props.get("shown", false))
	var top := float(props.get("top", 46.4))
	var locked := bool(props.get("locked", false))
	var tool := str(store.value("tool"))
	var selected: Array = store.value("selected")
	var none := selected.is_empty()
	var out := shown and not tucked
	visible = shown
	for child in _column.get_children():
		_column.remove_child(child)
		child.queue_free()
	var title := T.stencil("Troops", 0.58, T.BRASS, 0.14)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	_column.add_child(title)
	var count := PanelContainer.new()
	count.custom_minimum_size = Vector2(KEY_SIZE, T.px(1.45))
	count.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	count.tooltip_text = "Troops picked out"
	count.mouse_filter = Control.MOUSE_FILTER_PASS
	count.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0.45) if none else T.BRASS, T.BRASS, 2, 1))
	var count_label := T.stencil(str(selected.size()), 0.86, T.BRASS if none else T.DARK_INK, 0.0)
	count_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	count_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	count.add_child(count_label)
	_column.add_child(count)
	_column.add_child(_rail_key("Select", "Select troops: drag a box round them on the map", "select", tool == "select", locked, func() -> void: store.take_tool("select")))
	_column.add_child(_rail_key("Route", "Draw route: draw the way the troops picked out are to go", "route", tool == "route", locked or none, func() -> void: store.take_tool("route")))
	_column.add_child(_rule())
	_column.add_child(_rail_key("Advance", "Send these troops forward from where they stand, with no route drawn for them", "advance", null, locked or none, func() -> void: order.emit("advance")))
	_column.add_child(_rail_key("Dig in", "Dig in: these troops entrench where they stand", "dig in", null, locked or none, func() -> void: order.emit("dig in")))
	_column.add_child(_rail_key("Hold", "Hold: these troops keep their ground and attack nothing", "hold", null, locked or none, func() -> void: order.emit("hold")))
	_column.add_child(_rail_key("Fall back", "Fall back: these troops give ground toward their own rear", "fall back", null, locked or none, func() -> void: order.emit("fall back")))
	_column.add_child(_rail_key("Release", "Give these troops back to their stretch of the line", "release", null, locked or none, func() -> void: release.emit()))
	if bool(props.get("away", false)):
		_column.add_child(_rail_key("Send back", "Send your troops back onto this battlefield", "return", null, locked, func() -> void: send_back.emit()))
	else:
		_column.add_child(_rail_key("Withdraw", "Withdraw: these troops leave the battlefield and go home. With none picked out, all of yours do", "withdraw", null, locked or (none and int(props.get("own", 0)) == 0), func() -> void: withdraw.emit()))
	_column.add_child(_rule())
	var choice := choosing and shown and not none and not locked
	_column.add_child(_rail_key("Transport", "Transport: carry these troops by ship, rail or air to a place your side has no border with", "sea", tool == "transport" or choice, locked or none, func() -> void:
		if str(store.value("tool")) == "transport":
			store.take_tool("pan")
		else:
			choosing = not choosing
			_render()))
	_column.add_child(_rail_key("Diversion", "Draw a diversion: a movement you want the other side to believe", "diversion", tool == "diversion", locked, func() -> void: store.take_tool("diversion")))
	_column.add_child(_rail_key("Deploy", "Deploy: choose where your new troops on this battlefield come in, along a front or as a swarm", "deploy", tool == "deploy", locked, func() -> void: store.take_tool("deploy")))
	_column.add_child(_rule())
	_column.add_child(_rail_key("Fortify", "Fortify: draw a line to be built, then choose how strong it is to be", "fortify", tool == "fortify" or bool(props.get("drafted", false)), locked or not bool(props.get("can_fortify", false)), func() -> void: store.take_tool("fortify")))
	_column.add_child(_rail_key("Fleets", "Fleets: command your fleets at sea", "fleet", bool(store.value("fleets")) or tool == "fleet", int(props.get("fleets", 0)) == 0, func() -> void: fleets_toggled.emit()))
	_column.add_child(_rail_key("Supply", "Supply: shade how well supplied the ground is", "supply", bool(store.value("supply")), false, func() -> void: supply_toggled.emit()))
	var view := get_viewport_rect().size if is_inside_tree() else Vector2(1440, 900)
	var width := T.px(0.3) * 2.0 + KEY_SIZE + 2.0
	var height := minf(_column.get_combined_minimum_size().y + T.px(0.9) + 4.0, view.y - top - T.px(5.6))
	_plate.position = Vector2(0.0 if out else -width, top)
	_plate.size = Vector2(width, height)
	_plate.custom_minimum_size = Vector2(width, height)
	_scroll.custom_minimum_size = Vector2(KEY_SIZE, maxf(0.0, height - T.px(0.9) - 4.0))
	_tab.visible = shown
	_tab.icon = T.svg_icon("rail-chevron-right" if tucked else "rail-chevron-left", CHEVRON_RIGHT if tucked else CHEVRON_LEFT, 13, T.BRASS, 14.0)
	_tab.tooltip_text = "Show the troop tools" if tucked else "Hide the troop tools"
	_tab.position = Vector2(RAIL_WIDTH if out else 0.0, top + T.px(0.5))
	_tab.size = Vector2(T.px(1.0), T.px(2.5))
	_render_carriers(choice, top)
	_render_hint(shown, out, top)


func _render_carriers(choice: bool, top: float) -> void:
	for child in _carriers.get_children():
		_carriers.remove_child(child)
		child.queue_free()
	_carriers.visible = choice
	if not choice:
		return
	var selected: Array = store.value("selected")
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", int(round(T.px(0.3))))
	column.add_child(T.stencil("Carry the %d picked out" % selected.size(), 0.66))
	var carriers: Array = props.get("carriers", [])
	if carriers.is_empty():
		column.add_child(T.text("Nothing carries troops yet.", 0.74, T.BONE_SOFT))
	if selected.size() > LOAD_MOST:
		column.add_child(T.text("One dispatch carries %d formations at most: the rest stay where they are." % LOAD_MOST, 0.7, T.BONE_SOFT, 400, 1.35))
	var view_width := get_viewport_rect().size.x if is_inside_tree() else 1440.0
	var menu_width := minf(T.px(19.0), view_width - T.px(7.5))
	var words_width := menu_width - T.px(1.1) - 4.0 - T.px(1.1) - 2.0 - 19.0 - T.px(0.55)
	for entry in carriers:
		var row: Dictionary = entry
		var medium := str(row.get("medium", ""))
		var key := PanelContainer.new()
		key.add_theme_stylebox_override("panel", T.key_style(false, Vector4(T.px(0.55), T.px(0.4), T.px(0.55), T.px(0.4))))
		key.mouse_filter = Control.MOUSE_FILTER_STOP
		key.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		var line := HBoxContainer.new()
		line.add_theme_constant_override("separation", int(round(T.px(0.55))))
		line.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var glyph := _icon(medium if ICONS.has(medium) else "sea", T.BONE)
		glyph.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		line.add_child(glyph)
		var words := VBoxContainer.new()
		words.add_theme_constant_override("separation", int(round(T.px(0.14))))
		words.mouse_filter = Control.MOUSE_FILTER_IGNORE
		words.add_child(T.stencil(W.carrier_word(medium), 0.76, T.BONE, 0.05))
		var detail := T.text("%s · %d formations each · %d km a day" % [str(row.get("kind", "")), int(row.get("capacity", 0)), int(row.get("speed", 0))], 0.68, T.BONE_SOFT, 400, 1.2)
		detail.custom_minimum_size.x = words_width
		words.add_child(detail)
		line.add_child(words)
		key.add_child(line)
		key.gui_input.connect(func(event: InputEvent) -> void:
			if event is InputEventMouseButton and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT and not (event as InputEventMouseButton).pressed:
				choosing = false
				carrier.emit(medium))
		column.add_child(key)
	var cancel := T.link("Cancel")
	cancel.pressed.connect(func() -> void:
		choosing = false
		_render())
	column.add_child(cancel)
	_carriers.add_child(column)
	var view := get_viewport_rect().size if is_inside_tree() else Vector2(1440, 900)
	var width := minf(T.px(19.0), view.x - T.px(7.5))
	_fit_width(column, width - T.px(1.1) - 4.0)
	_carriers.custom_minimum_size = Vector2(width, 0)
	_carriers.position = Vector2(RAIL_WIDTH + T.px(1.5), top + T.px(9.0))
	_carriers.reset_size()
	_settle(_carriers)


func _rich(size_rem := 0.74, colour := T.BONE_SOFT) -> RichTextLabel:
	var rich := RichTextLabel.new()
	rich.fit_content = true
	rich.scroll_active = false
	rich.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	rich.selection_enabled = false
	rich.add_theme_font_override("normal_font", UI.font(400))
	rich.add_theme_font_size_override("normal_font_size", T.font_size(size_rem))
	rich.add_theme_color_override("default_color", colour)
	rich.add_theme_constant_override("line_separation", 3)
	rich.meta_underlined = false
	rich.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	rich.mouse_default_cursor_shape = Control.CURSOR_ARROW
	return rich


static func add_text(rich: RichTextLabel, value: String) -> void:
	rich.set_meta("plain", str(rich.get_meta("plain", "")) + value)
	rich.add_text(value)


static func add_link(rich: RichTextLabel, label_text: String, meta: String) -> void:
	var links: Array = rich.get_meta("links", [])
	links.append(label_text.to_upper())
	rich.set_meta("links", links)
	rich.push_font(T.stencil_font(T.spacing_px(0.76, 0.06)), T.font_size(0.76))
	rich.push_color(T.AMBER)
	rich.push_meta(meta)
	rich.add_text(label_text.to_upper())
	rich.pop()
	rich.pop()
	rich.pop()


func _on_hint_meta(meta: Variant) -> void:
	match str(meta):
		"clear":
			cleared.emit()
		"cancel":
			store.take_tool("pan")
		"hide":
			supply_toggled.emit()


func _render_hint(shown: bool, out: bool, top: float) -> void:
	for child in _hint.get_children():
		_hint.remove_child(child)
		child.queue_free()
	var tool := str(store.value("tool"))
	var selected: Array = store.value("selected")
	var none := selected.is_empty()
	var drawing := tool != "pan"
	var turn_running := bool(props.get("turn_running", false))
	var notice := str(props.get("notice", ""))
	var supply := bool(store.value("supply"))
	var says := shown and (turn_running or drawing or not none or not notice.is_empty() or supply)
	_hint.visible = says
	if not says:
		return
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	var rich := _rich()
	rich.meta_clicked.connect(_on_hint_meta)
	var lead := ""
	if turn_running:
		lead = "A turn is being resolved. Orders are taken once it has landed."
	elif tool == "select":
		lead = "Drag a box round your troops on the map. Hold Shift to add to those picked."
		if selected.size() > 0:
			lead += " %d picked out." % selected.size()
	elif tool == "route":
		lead = "Draw the way for the %d picked out. They follow it as the ground and the enemy allow." % selected.size()
	elif tool == "diversion":
		lead = "Draw the movement you want the other side to believe."
	elif tool == "replan":
		lead = "Draw the operation’s way anew."
	elif tool == "transport":
		lead = "Click the place the %d picked out are to be carried to. Drag to move the map. They board when time next passes." % selected.size()
	elif tool == "fortify":
		lead = "Draw the fortified line on the map. You choose how strong it is to be once it is drawn."
	elif tool == "fleet":
		lead = "Click the place at sea the fleet is to patrol. Drag to move the map." if str(store.value("station")) == "patrol" else "Click the place at sea the fleet is to sail to. Drag to move the map."
	if not turn_running and tool == "deploy":
		var form := str(store.value("deploy_form"))
		var forms := HBoxContainer.new()
		forms.add_theme_constant_override("separation", int(round(T.px(0.3))))
		for pair in [["front", "Front"], ["swarm", "Swarm"]]:
			var value: String = pair[0]
			var picked := (form == "swarm") == (value == "swarm")
			var radio := T.key(pair[1], picked, false, 0.72, Vector4(T.px(0.7), T.px(0.28), T.px(0.7), T.px(0.28)))
			radio.pressed.connect(func() -> void: store.set_values({"deploy_form": "swarm" if value == "swarm" else "front"}))
			forms.add_child(radio)
		column.add_child(T.pad(forms, Vector4(0, 0, 0, T.px(0.35))))
		var count_row := HBoxContainer.new()
		count_row.add_theme_constant_override("separation", int(round(T.px(0.45))))
		var count_label := T.text("Formations to call up", 0.74, T.BONE_SOFT)
		count_label.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		count_label.autowrap_mode = TextServer.AUTOWRAP_OFF
		count_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		count_row.add_child(count_label)
		_count_input = LineEdit.new()
		_count_input.text = str(store.value("deploy_count"))
		_count_input.placeholder_text = "Usual"
		_count_input.custom_minimum_size = Vector2(T.px(4.5), 0)
		_count_input.add_theme_font_size_override("font_size", T.font_size(0.78))
		_count_input.add_theme_color_override("font_color", T.BONE)
		_count_input.add_theme_color_override("font_placeholder_color", Color(T.BONE, 0.45))
		var field := UI.box(Color(0, 0, 0, 0.5), T.SUNK_LINE, 3, 1, Vector4(T.px(0.4), T.px(0.2), T.px(0.4), T.px(0.2)))
		_count_input.add_theme_stylebox_override("normal", field)
		_count_input.add_theme_stylebox_override("focus", field)
		_count_input.text_changed.connect(func(value: String) -> void:
			var cleaned := ""
			for character in value:
				if character in "0123456789":
					cleaned += character
			if cleaned != value:
				var caret := _count_input.caret_column
				_count_input.text = cleaned
				_count_input.caret_column = mini(caret, cleaned.length())
			store.state["deploy_count"] = cleaned)
		count_row.add_child(_count_input)
		column.add_child(T.pad(count_row, Vector4(0, 0, 0, T.px(0.2))))
		column.add_child(T.pad(T.text("Empty calls up as many as a usual draft; 0 calls up none.", 0.74, T.BONE_FAINT), Vector4(0, 0, 0, T.px(0.35))))
		if form == "swarm":
			lead = "Click the place your new troops here are to gather at. Those called up come in there as a swarm when time next passes, under one general of their own, and so do later levies, drafts and reinforcements. Each moves and fights as troops on a front do. Drag to move the map."
		else:
			lead = "Draw the line your new troops here are to come in on. Those called up come in on it when time next passes, and so do later levies, drafts and reinforcements. They stand on ground your side holds along it."
	if not lead.is_empty():
		add_text(rich, lead)
	if drawing and not turn_running:
		add_text(rich, " ")
		add_link(rich, "Cancel", "cancel")
	var has_lead := not lead.is_empty() or (drawing and not turn_running)
	if has_lead:
		column.add_child(rich)
	if not turn_running and not drawing and supply:
		var shade := _rich()
		shade.meta_clicked.connect(_on_hint_meta)
		var areas: Variant = props.get("supply_areas")
		var said := "Supply: your ground in amber is stretched past where supplies come in full, in red it is cut off; pale ground is theirs, cut off."
		if typeof(areas) != TYPE_DICTIONARY:
			said += " How well supplied it is shows once time next passes here."
		else:
			var found: Dictionary = areas
			if int(found.get("stretched", 0)) > 0 or int(found.get("cut", 0)) > 0 or int(found.get("theirsCut", 0)) > 0:
				said += " Stretched %s km², cut off %s km²; theirs cut off %s km²." % [str(found.get("stretchedText", "")), str(found.get("cutText", "")), str(found.get("theirsCutText", ""))]
			else:
				said += " All your ground here is well supplied."
		add_text(shade, said + " ")
		add_link(shade, "Hide", "hide")
		column.add_child(shade)
	if not turn_running and not drawing and selected.size() > 0:
		var picked := _rich()
		picked.meta_clicked.connect(_on_hint_meta)
		add_text(picked, "%d picked out. " % selected.size())
		add_link(picked, "Clear", "clear")
		column.add_child(picked)
	if not notice.is_empty():
		var alert := T.text(notice, 0.74, T.ALERT)
		if turn_running or drawing or not none:
			column.add_child(T.pad(alert, Vector4(0, T.px(0.25), 0, 0)))
		else:
			column.add_child(alert)
	_hint.add_child(column)
	var view := get_viewport_rect().size if is_inside_tree() else Vector2(1440, 900)
	var width := minf(T.px(21.0), view.x - T.px(7.5))
	var natural := _natural_width(column, width)
	_fit_width(column, natural - T.px(1.2) - 4.0)
	_hint.custom_minimum_size = Vector2(natural, 0)
	_hint.position = Vector2((RAIL_WIDTH if out else 0.0) + T.px(1.5), top)
	_hint.reset_size()
	_settle(_hint)


func _fit_width(node: Node, inner: float) -> void:
	for child in node.get_children():
		if child is RichTextLabel or (child is Label and (child as Label).autowrap_mode != TextServer.AUTOWRAP_OFF):
			(child as Control).custom_minimum_size.x = maxf(0.0, inner)
		elif child is MarginContainer or child is VBoxContainer:
			_fit_width(child, inner)


func _settle(panel: Control) -> void:
	await get_tree().process_frame
	if is_instance_valid(panel):
		panel.reset_size()


func _natural_width(column: VBoxContainer, most: float) -> float:
	var widest := _widest(column)
	return clampf(widest + T.px(1.2) + 4.0, 0.0, most)


func _widest(node: Node) -> float:
	var widest := 0.0
	if node is RichTextLabel:
		var rich := node as RichTextLabel
		var width := UI.font(400).get_string_size(str(rich.get_meta("plain", "")), HORIZONTAL_ALIGNMENT_LEFT, -1, T.font_size(0.74)).x
		var stencil := T.stencil_font(T.spacing_px(0.76, 0.06))
		for link in rich.get_meta("links", []):
			width += stencil.get_string_size(str(link), HORIZONTAL_ALIGNMENT_LEFT, -1, T.font_size(0.76)).x
		return width + 2.0
	if node is Label:
		var label := node as Label
		var font := label.get_theme_font("font")
		var size := label.get_theme_font_size("font_size")
		return font.get_string_size(label.text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x + 2.0
	if node is LineEdit or node is Button:
		return (node as Control).get_combined_minimum_size().x
	if node is HBoxContainer:
		var total := 0.0
		for child in node.get_children():
			total += _widest(child) + float((node as HBoxContainer).get_theme_constant("separation"))
		return total
	for child in node.get_children():
		widest = maxf(widest, _widest(child))
	return widest
