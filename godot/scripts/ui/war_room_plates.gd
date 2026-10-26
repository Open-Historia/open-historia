class_name WarRoomPlates
extends Control

signal fortify_level(level: int)
signal fortify_confirm(line_name: String)
signal fortify_redraw
signal fortify_cancel
signal fleet_pick(id: String)
signal fleet_order(op: Dictionary)
signal fleet_place(kind: String)
signal fleets_close

const T := preload("res://scripts/ui/war_room_theme.gd")
const W := preload("res://scripts/ui/war_room_words.gd")
const LEVELS := [3, 4, 5, 6, 7, 8, 9]
const POSTURES := ["patrol", "blockade", "assaulting", "holding", "withdrawing", "transit"]

var store: WarRoomStore
var props: Dictionary = {}
var cost: Dictionary = {}
var line_name := ""
var enemy := ""
var convoy := ""
var _fortify: PanelContainer
var _fleets: PanelContainer
var _name_field: LineEdit


func _init() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_fortify = _plate()
	_fleets = _plate()


func _plate() -> PanelContainer:
	var plate := PanelContainer.new()
	plate.texture_repeat = CanvasItem.TEXTURE_REPEAT_ENABLED
	plate.add_theme_stylebox_override("panel", T.plate_style([T.SEAM, T.SEAM, T.SEAM, T.SEAM], Vector4(2, 2, 2, 2), Vector4(T.px(0.65) + 2.0, T.px(0.55) + 2.0, T.px(0.65) + 2.0, T.px(0.55) + 2.0)))
	plate.mouse_filter = Control.MOUSE_FILTER_STOP
	plate.visible = false
	add_child(plate)
	return plate


func setup(shared: WarRoomStore) -> void:
	store = shared
	store.changed.connect(func(keys: PackedStringArray) -> void:
		for key in ["draft", "level", "fleets", "fleet", "tool", "station", "rail"]:
			if key in keys:
				_render()
				return)


func set_props(value: Dictionary) -> void:
	props = value
	_render()


func set_cost(value: Dictionary) -> void:
	cost = value
	_render()


func reset_name() -> void:
	line_name = ""


func _clear(node: Control) -> void:
	for child in node.get_children():
		node.remove_child(child)
		child.queue_free()


func _column() -> VBoxContainer:
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", int(round(T.px(0.4))))
	return column


func _place(plate: PanelContainer, scroll: ScrollContainer, content: float) -> void:
	var view := get_viewport_rect().size if is_inside_tree() else Vector2(1440, 900)
	var rail := float(store.value("rail")) if store else 0.0
	var width := minf(T.px(21.0), view.x - T.px(7.5))
	var chrome := T.px(1.1) + 4.0
	var height := minf(content + chrome, view.y - T.px(11.0))
	scroll.custom_minimum_size = Vector2(width - T.px(1.3) - 4.0, maxf(0.0, height - chrome))
	plate.custom_minimum_size = Vector2(width, height)
	plate.size = Vector2(width, height)
	var left := rail + T.px(1.5) if rail > 0.0 else T.px(1.5)
	plate.position = Vector2(left, view.y - T.px(1.6) - height)


func _render() -> void:
	if not store:
		return
	var shown := bool(props.get("shown", false))
	var draft: Variant = store.value("draft")
	var drafted := draft is Array and not (draft as Array).is_empty()
	_fortify.visible = shown and drafted
	_fleets.visible = shown and not drafted and bool(store.value("fleets"))
	if _fortify.visible:
		_render_fortify()
	else:
		_clear(_fortify)
	if _fleets.visible:
		_render_fleets()
	else:
		_clear(_fleets)


func _render_fortify() -> void:
	_clear(_fortify)
	var locked := bool(props.get("locked", false))
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	var column := _column()
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(column)
	var level := int(cost.get("level", store.value("level")))
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", int(round(T.px(0.6))))
	head.add_child(T.stencil("Fortified line", 0.72))
	var km := T.text("%s km long" % T.num(cost.get("km", 0)) if not cost.is_empty() else "", 0.72, T.BONE_SOFT)
	km.autowrap_mode = TextServer.AUTOWRAP_OFF
	head.add_child(km)
	column.add_child(head)
	var levels := HFlowContainer.new()
	levels.add_theme_constant_override("h_separation", int(round(T.px(0.25))))
	levels.add_theme_constant_override("v_separation", int(round(T.px(0.25))))
	for value in LEVELS:
		var button := T.key(str(value), value == level, locked, 0.8, Vector4(T.px(0.3), T.px(0.34), T.px(0.3), T.px(0.34)))
		var marked := T.key_style(value == level, Vector4(T.px(0.3), T.px(0.34), T.px(0.3), T.px(0.34)))
		marked.edges = [marked.edges[0], marked.edges[1], marked.edges[2], W.line_colour(value)]
		marked.widths = Vector4(1, 1, 1, 3)
		marked.content_margin_bottom = T.px(0.34) + 2.0
		for state in ["normal", "hover", "pressed", "hover_pressed", "focus", "disabled"]:
			button.add_theme_stylebox_override(state, marked)
		button.custom_minimum_size.x = T.px(2.05)
		button.alignment = HORIZONTAL_ALIGNMENT_CENTER
		var picked: int = value
		button.pressed.connect(func() -> void: fortify_level.emit(picked))
		levels.add_child(button)
	column.add_child(levels)
	if not cost.is_empty():
		var title := RichTextLabel.new()
		title.fit_content = true
		title.scroll_active = false
		title.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		title.add_theme_font_override("normal_font", UI.font(700))
		title.add_theme_font_size_override("normal_font_size", T.font_size(0.82))
		title.add_theme_color_override("default_color", T.BONE)
		title.push_color(W.line_colour(level))
		title.add_text("Level %d" % level)
		title.pop()
		title.add_text(" · " + W.level_word(level))
		column.add_child(title)
		var holds: Variant = cost.get("holds")
		column.add_child(T.soft("Nobody can break through it." if holds == null else "An assault at two to one breaks through a stretch of it in about %d days, and siege guns in a third of that." % int(holds)))
		column.add_child(T.text(W.build_time(cost.get("time", {})), 0.86, T.AMBER, 700))
		var ready := str(cost.get("ready", ""))
		if not ready.is_empty():
			column.add_child(T.soft("It would stand from about %s." % ready))
		if bool(cost.get("supplied", false)):
			var spend: Dictionary = cost.get("spend", {})
			column.add_child(T.soft("While it is built it uses %s%% of your war resources a month, %s%% in all. You have %s%%." % [T.num(spend.get("aMonth", 0)), T.num(spend.get("total", 0)), T.num(cost.get("left", 100))]))
		if int(cost.get("men", 0)) > 0:
			column.add_child(T.soft("Built with your treasury at %d%% and %s men fit to serve: the longer and stronger the line, the longer it takes." % [int(cost.get("treasury", 0)), str(cost.get("menText", ""))]))
		else:
			column.add_child(T.soft("How many people your country has is not known, so it is reckoned a country of middling size."))
	_name_field = LineEdit.new()
	_name_field.text = line_name
	_name_field.max_length = 80
	_name_field.placeholder_text = "Name the line (if you wish)"
	_name_field.tooltip_text = "Name the line"
	_name_field.add_theme_font_size_override("font_size", T.font_size(0.8))
	_name_field.add_theme_color_override("font_color", T.BONE)
	_name_field.add_theme_color_override("font_placeholder_color", Color(T.BONE, 0.45))
	var field := UI.box(Color(0, 0, 0, 0.5), T.SUNK_LINE, 3, 1, Vector4(T.px(0.5), T.px(0.35), T.px(0.5), T.px(0.35)))
	_name_field.add_theme_stylebox_override("normal", field)
	_name_field.add_theme_stylebox_override("focus", field)
	_name_field.text_changed.connect(func(value: String) -> void: line_name = value)
	column.add_child(_name_field)
	var buttons := HFlowContainer.new()
	buttons.add_theme_constant_override("h_separation", int(round(T.px(0.45))))
	var confirm := T.key("Confirm", true, locked)
	confirm.pressed.connect(func() -> void: fortify_confirm.emit(line_name))
	buttons.add_child(confirm)
	var again := T.key("Draw again", false, locked)
	again.pressed.connect(func() -> void: fortify_redraw.emit())
	buttons.add_child(again)
	var cancel := T.link("Cancel")
	cancel.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	cancel.pressed.connect(func() -> void: fortify_cancel.emit())
	buttons.add_child(cancel)
	column.add_child(buttons)
	_fortify.add_child(scroll)
	_place(_fortify, scroll, column.get_combined_minimum_size().y)
	await get_tree().process_frame
	if is_instance_valid(scroll) and scroll.get_parent() == _fortify:
		_place(_fortify, scroll, column.get_combined_minimum_size().y)


func _fleet_key(label_text: String, on: bool, disabled: bool) -> Button:
	return T.key(label_text, on, disabled, 0.7, Vector4(T.px(0.45), T.px(0.34), T.px(0.45), T.px(0.34)))


func _select(options: Array, current: String, disabled: bool, changed: Callable) -> OptionButton:
	var select := OptionButton.new()
	select.focus_mode = Control.FOCUS_NONE
	select.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	select.add_theme_font_size_override("font_size", T.font_size(0.78))
	select.add_theme_color_override("font_color", T.BONE)
	var box := UI.box(Color(0, 0, 0, 0.5), T.SUNK_LINE, 3, 1, Vector4(T.px(0.4), T.px(0.3), T.px(0.4), T.px(0.3)))
	for state in ["normal", "hover", "pressed", "focus", "disabled"]:
		select.add_theme_stylebox_override(state, box)
	for index in range(options.size()):
		var option: Array = options[index]
		select.add_item(str(option[1]))
		select.set_item_metadata(index, str(option[0]))
		if str(option[0]) == current:
			select.select(index)
	select.disabled = disabled
	select.item_selected.connect(func(index: int) -> void: changed.call(str(select.get_item_metadata(index))))
	return select


func _render_fleets() -> void:
	_clear(_fleets)
	var locked := bool(props.get("locked", false))
	var fleets: Array = props.get("fleets", [])
	var enemies: Array = props.get("enemies", [])
	var convoys: Array = props.get("convoys", [])
	var picked := str(store.value("fleet"))
	var fleet: Dictionary = {}
	for entry in fleets:
		if str((entry as Dictionary).get("id", "")) == picked:
			fleet = entry
	if fleet.is_empty() and not fleets.is_empty():
		fleet_pick.emit(str((fleets[0] as Dictionary).get("id", "")))
		return
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	var column := _column()
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(column)
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", int(round(T.px(0.5))))
	var title := T.stencil("Fleets", 0.72)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(title)
	var close := T.link("Close")
	close.pressed.connect(func() -> void: fleets_close.emit())
	head.add_child(close)
	column.add_child(head)
	if fleets.is_empty():
		column.add_child(T.soft("You have no fleets."))
	var list_box := VBoxContainer.new()
	list_box.add_theme_constant_override("separation", int(round(T.px(0.2))))
	for entry in fleets:
		var row: Dictionary = entry
		var id := str(row.get("id", ""))
		var button := Button.new()
		button.focus_mode = Control.FOCUS_NONE
		button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		var style := T.tray_style(id == picked, Vector4(T.px(0.45), T.px(0.3), T.px(0.45), T.px(0.3)))
		for state in ["normal", "hover", "pressed", "hover_pressed", "focus"]:
			button.add_theme_stylebox_override(state, style)
		var line := HBoxContainer.new()
		line.add_theme_constant_override("separation", int(round(T.px(0.45))))
		line.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var name_label := T.text(str(row.get("name", "")), 0.78, T.BONE, 700)
		name_label.autowrap_mode = TextServer.AUTOWRAP_OFF
		name_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		name_label.clip_text = true
		line.add_child(name_label)
		var state_label := T.text("%d%% · %s" % [int(row.get("strength", 0)), W.posture_word(str(row.get("posture", "")))], 0.72, T.BONE_SOFT)
		state_label.autowrap_mode = TextServer.AUTOWRAP_OFF
		state_label.size_flags_horizontal = Control.SIZE_SHRINK_END
		line.add_child(state_label)
		var holder := T.pad(line, Vector4(T.px(0.45), T.px(0.3), T.px(0.45), T.px(0.3)))
		holder.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		button.add_child(holder)
		button.custom_minimum_size = Vector2(0, line.get_combined_minimum_size().y + T.px(0.6) + 2.0)
		button.pressed.connect(func() -> void: fleet_pick.emit(id))
		list_box.add_child(button)
	if fleets.size() > 4:
		var list_scroll := ScrollContainer.new()
		list_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
		list_scroll.custom_minimum_size.y = T.px(9.0)
		list_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		list_scroll.add_child(list_box)
		column.add_child(list_scroll)
	else:
		column.add_child(list_box)
	if not fleet.is_empty():
		var id := str(fleet.get("id", ""))
		var held := bool(fleet.get("pending", false)) or bool(fleet.get("committed", false))
		var off := locked or held
		column.add_child(T.soft(W.fleet_order_line(fleet)))
		if bool(fleet.get("pending", false)):
			column.add_child(T.soft("It joins your order of battle when time next passes; it takes orders then."))
		if bool(fleet.get("committed", false)):
			column.add_child(T.soft("It is fighting on a battlefield, where its orders are the battle's."))
		column.add_child(T.heading("Posture"))
		var postures := HFlowContainer.new()
		postures.add_theme_constant_override("h_separation", int(round(T.px(0.25))))
		postures.add_theme_constant_override("v_separation", int(round(T.px(0.25))))
		for posture in POSTURES:
			var key := _fleet_key(W.posture_key(posture), str(fleet.get("posture", "")) == posture, off)
			var chosen: String = posture
			key.pressed.connect(func() -> void: fleet_order.emit({"op": "posture", "unit": id, "posture": chosen}))
			postures.add_child(key)
		column.add_child(postures)
		column.add_child(T.heading("Orders", null, T.px(0.2)))
		var tool := str(store.value("tool"))
		var station := str(store.value("station"))
		var placing := func(kind: String) -> bool: return tool == "fleet" and (station if not station.is_empty() else "move") == kind
		var orders := HFlowContainer.new()
		orders.add_theme_constant_override("h_separation", int(round(T.px(0.25))))
		orders.add_theme_constant_override("v_separation", int(round(T.px(0.25))))
		var sail := _fleet_key("Sail to", placing.call("move"), off)
		sail.tooltip_text = "Sail to a place at sea: click it on the map"
		sail.pressed.connect(func() -> void: fleet_place.emit("move"))
		orders.add_child(sail)
		var patrol := _fleet_key("Patrol at", placing.call("patrol"), off)
		patrol.tooltip_text = "Patrol a place at sea: click it on the map"
		patrol.pressed.connect(func() -> void: fleet_place.emit("patrol"))
		orders.add_child(patrol)
		var no_order := typeof(fleet.get("order")) != TYPE_DICTIONARY
		var stand := _fleet_key("Call off", false, off or no_order)
		stand.pressed.connect(func() -> void: fleet_order.emit({"op": "stand", "unit": id}))
		orders.add_child(stand)
		column.add_child(orders)
		if not enemies.is_empty():
			var target := enemy if enemy in enemies else str(enemies[0])
			column.add_child(T.heading("Blockade a country", null, T.px(0.2)))
			var row := HBoxContainer.new()
			row.add_theme_constant_override("separation", int(round(T.px(0.35))))
			var options: Array = []
			for name in enemies:
				options.append([str(name), str(name)])
			row.add_child(_select(options, target, off, func(value: String) -> void:
				enemy = value
				_render()))
			var blockade := _fleet_key("Blockade", false, off or target.is_empty())
			blockade.pressed.connect(func() -> void: fleet_order.emit({"op": "blockade", "unit": id, "country": target}))
			row.add_child(blockade)
			column.add_child(row)
			column.add_child(T.soft("It sails to the water off their coast nearest it, and closes what of their trade comes by sea there."))
		if not convoys.is_empty():
			var ids: Array = []
			for entry in convoys:
				ids.append(str((entry as Dictionary).get("id", "")))
			var covered := convoy if convoy in ids else str(ids[0])
			column.add_child(T.heading("Escort a convoy", null, T.px(0.2)))
			var row := HBoxContainer.new()
			row.add_theme_constant_override("separation", int(round(T.px(0.35))))
			var options: Array = []
			for entry in convoys:
				options.append([str((entry as Dictionary).get("id", "")), str((entry as Dictionary).get("label", ""))])
			row.add_child(_select(options, covered, off, func(value: String) -> void:
				convoy = value
				_render()))
			var escort := _fleet_key("Escort", false, off or covered.is_empty())
			escort.pressed.connect(func() -> void: fleet_order.emit({"op": "escort", "unit": id, "transport": covered}))
			row.add_child(escort)
			column.add_child(row)
	_fleets.add_child(scroll)
	_place(_fleets, scroll, column.get_combined_minimum_size().y)
	await get_tree().process_frame
	if is_instance_valid(scroll) and scroll.get_parent() == _fleets:
		_place(_fleets, scroll, column.get_combined_minimum_size().y)
