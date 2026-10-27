class_name ForcesPanel
extends Control

signal closed

const TYPE_LABEL := {"infantry": "Infantry", "armor": "Armor", "air": "Air", "naval": "Naval", "artillery": "Artillery", "garrison": "Garrison"}
const TYPE_GLYPH := {"infantry": "🛡", "armor": "⚙", "air": "✈", "naval": "⚓", "artillery": "💥", "garrison": "🏰"}
const POSTURE_LABEL := {"holding": "Holding position", "massing": "Massing", "patrol": "Patrolling", "transit": "In transit", "exercise": "On exercise", "blockade": "Blockading", "withdrawing": "Withdrawing", "assaulting": "Assaulting"}
const MODE_HINT := {"deploy": "Click the map to place your unit", "admin-place": "Click the map to move this unit", "structure-place": "Click the map where this structure really is"}
const STATUS_LABEL := {"idle": "Idle", "moving": "Moving", "engaged": "Engaged", "defeated": "Defeated", "pending": "Pending"}
const BLUE := Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.35)

var engine: EngineLink
var map_view: MapView
var mode: Dictionary = {"kind": "idle"}
var units: Array = []
var player_code := ""
var allowed: Variant = null
var types: Array = ["infantry", "armor", "air", "naval", "artillery", "garrison"]
var statuses: Array = ["idle", "moving", "engaged", "defeated", "pending"]
var turn_running := false
var turn_note := "A turn is running. This can be changed once it ends."
var not_saved := "The unit could not be saved. Try again."
var deploy_type := "infantry"
var deploy_strength := "100"
var deploy_name := ""
var deploy_composition := ""
var editing := ""
var _editor: Dictionary = {}
var _open := false
var _panel: GlassPanel
var _column: VBoxContainer
var _banner: GlassPanel
var _poll: Timer


func _init() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_panel = GlassPanel.new(Color(24 / 255.0, 24 / 255.0, 27 / 255.0, 0.92), 12.0, Vector4(12, 12, 12, 12), Color(1, 1, 1, 0.12))
	_panel.anchor_left = 0.0
	_panel.anchor_right = 0.0
	_panel.anchor_top = 1.0
	_panel.anchor_bottom = 1.0
	_panel.visible = false
	add_child(_panel)
	_column = VBoxContainer.new()
	_column.add_theme_constant_override("separation", 0)
	_panel.add_child(_column)
	_banner = GlassPanel.new(Color(24 / 255.0, 24 / 255.0, 27 / 255.0, 0.92), 12.0, Vector4(14, 8, 14, 8), Color(1, 1, 1, 0.12))
	_banner.visible = false
	add_child(_banner)
	_poll = Timer.new()
	_poll.wait_time = 0.8
	_poll.timeout.connect(_poll_turn)
	add_child(_poll)


func setup(engine_link: EngineLink, context: Dictionary = {}) -> void:
	engine = engine_link
	map_view = context.get("map_view") as MapView
	if map_view and not map_view.region_clicked.is_connected(_on_map_click):
		map_view.region_clicked.connect(_on_map_click)


func is_open() -> bool:
	return _open


func is_placing() -> bool:
	return str(mode.get("kind", "idle")) != "idle"


func open() -> void:
	set_open(true)


func close() -> void:
	set_open(false)


func set_open(value: bool) -> void:
	_open = value
	_panel.visible = value
	if value:
		_poll.start()
		await refresh()
	else:
		_poll.stop()
		editing = ""
		closed.emit()


func refresh() -> void:
	if not engine:
		return
	var reply: Dictionary = await engine.request("forces.list")
	if not reply.get("ok", false):
		return
	var result: Dictionary = reply.get("result", {})
	units = result.get("units", [])
	player_code = str(result.get("playerCode", ""))
	allowed = result.get("allowed")
	types = result.get("types", types)
	statuses = result.get("statuses", statuses)
	turn_running = bool(result.get("busy", false))
	turn_note = str(result.get("turnNote", turn_note))
	not_saved = str(result.get("notSaved", not_saved))
	var available := _available_types()
	if not available.is_empty() and not deploy_type in available:
		deploy_type = str(available[0])
	_render()


func _poll_turn() -> void:
	if not engine or not _open:
		return
	var reply: Dictionary = await engine.request("warroom.busy")
	if reply.get("ok", false) and bool(reply.get("result", false)) != turn_running:
		turn_running = bool(reply.get("result", false))
		_render()


func _available_types() -> Array:
	if allowed is Array and not (allowed as Array).is_empty():
		var kept: Array = []
		for entry in types:
			if entry in allowed:
				kept.append(entry)
		return kept
	return types


func _label(text: String, size: int, colour: Color, weight := 400) -> Label:
	return UI.label(text, size, colour, weight)


func _field_style() -> StyleBoxFlat:
	return UI.box(Color(0, 0, 0, 0.3), Color(1, 1, 1, 0.15), 6, 1, Vector4(4, 4, 4, 4))


func _line_edit(text: String, placeholder: String, changed: Callable) -> LineEdit:
	var field := LineEdit.new()
	field.text = text
	field.placeholder_text = placeholder
	field.add_theme_font_size_override("font_size", 12)
	field.add_theme_color_override("font_color", UI.WHITE)
	field.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.4))
	field.add_theme_stylebox_override("normal", _field_style())
	field.add_theme_stylebox_override("focus", _field_style())
	field.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	field.text_changed.connect(changed)
	return field


func _select(options: Array, labels: Dictionary, current: String, changed: Callable) -> OptionButton:
	var select := OptionButton.new()
	select.focus_mode = Control.FOCUS_NONE
	select.add_theme_font_size_override("font_size", 12)
	select.add_theme_color_override("font_color", UI.WHITE)
	for state in ["normal", "hover", "pressed", "focus"]:
		select.add_theme_stylebox_override(state, _field_style())
	for index in range(options.size()):
		var value := str(options[index])
		select.add_item(str(labels.get(value, value)))
		select.set_item_metadata(index, value)
		if value == current:
			select.select(index)
	select.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	select.item_selected.connect(func(index: int) -> void: changed.call(str(select.get_item_metadata(index))))
	return select


func _small_button(text: String, bg := Color(1, 1, 1, 0.08), weight := 400) -> Button:
	var button := Button.new()
	button.text = text
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var style := UI.box(bg, Color(1, 1, 1, 0.15), 6, 1, Vector4(8, 4, 8, 4))
	for state in ["normal", "hover", "pressed", "hover_pressed", "focus", "disabled"]:
		button.add_theme_stylebox_override(state, style)
	button.add_theme_font_override("font", UI.font(weight))
	button.add_theme_font_size_override("font_size", 11)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		button.add_theme_color_override(name, UI.WHITE)
	button.add_theme_color_override("font_disabled_color", Color(1, 1, 1, 0.4))
	return button


static func strength_color(strength: float) -> Color:
	return Color("#4ade80") if strength > 60 else (Color("#fbbf24") if strength > 25 else Color("#f87171"))


func _activity(unit: Dictionary) -> String:
	var posture := str(unit.get("posture", ""))
	if POSTURE_LABEL.has(posture):
		return POSTURE_LABEL[posture]
	return posture if not posture.is_empty() else str(unit.get("status", ""))


func _render() -> void:
	for child in _column.get_children():
		_column.remove_child(child)
		child.queue_free()
	_render_banner()
	if not _open:
		return
	var view := get_viewport_rect().size if is_inside_tree() else Vector2(1440, 900)
	var head := HBoxContainer.new()
	var title := _label("Forces", 14, UI.WHITE, 700)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(title)
	var close_button := Button.new()
	close_button.text = "✕"
	close_button.flat = true
	close_button.focus_mode = Control.FOCUS_NONE
	close_button.tooltip_text = "Close forces"
	close_button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	close_button.add_theme_font_size_override("font_size", 14)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
		close_button.add_theme_color_override(name, Color(1, 1, 1, 0.6))
	close_button.pressed.connect(close)
	head.add_child(close_button)
	_column.add_child(head)
	_column.add_child(_gap(8))
	var deploy := PanelContainer.new()
	deploy.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.05), Color(0, 0, 0, 0), 8, 0, Vector4(8, 8, 8, 8)))
	var deploy_column := VBoxContainer.new()
	deploy_column.add_theme_constant_override("separation", 6)
	deploy_column.add_child(_label("Deploy a unit", 11, Color(1, 1, 1, 0.6)))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 5)
	row.add_child(_select(_available_types(), TYPE_LABEL, deploy_type, func(value: String) -> void: deploy_type = value))
	var strength := _line_edit(deploy_strength, "", func(value: String) -> void: deploy_strength = value)
	strength.custom_minimum_size.x = 64
	strength.size_flags_horizontal = Control.SIZE_SHRINK_END
	strength.tooltip_text = "Strength, as a percentage of the formation's established strength"
	row.add_child(strength)
	deploy_column.add_child(row)
	deploy_column.add_child(_line_edit(deploy_name, "Unit name (optional)", func(value: String) -> void: deploy_name = value))
	deploy_column.add_child(_line_edit(deploy_composition, "Composition, e.g. 2 frigates (optional)", func(value: String) -> void: deploy_composition = value))
	var place := Button.new()
	place.text = "Place on map →"
	place.focus_mode = Control.FOCUS_NONE
	place.mouse_default_cursor_shape = Control.CURSOR_FORBIDDEN if turn_running else Control.CURSOR_POINTING_HAND
	var place_style := UI.box(BLUE, Color(1, 1, 1, 0.15), 6, 1, Vector4(0, 6, 0, 6))
	for state in ["normal", "hover", "pressed", "hover_pressed", "focus", "disabled"]:
		place.add_theme_stylebox_override(state, place_style)
	place.add_theme_font_override("font", UI.font(600))
	place.add_theme_font_size_override("font_size", 12)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
		place.add_theme_color_override(name, UI.WHITE)
	place.add_theme_color_override("font_disabled_color", Color(1, 1, 1, 0.4))
	place.disabled = turn_running
	place.pressed.connect(_start_deploy)
	deploy_column.add_child(place)
	if turn_running:
		deploy_column.add_child(_label(turn_note, 10, Color(1, 1, 1, 0.45)))
	deploy.add_child(deploy_column)
	_column.add_child(deploy)
	_column.add_child(_gap(10))
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var list := VBoxContainer.new()
	list.add_theme_constant_override("separation", 0)
	list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var mine: Array = []
	var others: Array = []
	for entry in units:
		var unit: Dictionary = entry
		var owner := str(unit.get("ownerCode", ""))
		if not owner.is_empty() and owner == player_code:
			mine.append(unit)
		if player_code.is_empty() or owner != player_code:
			others.append(unit)
	list.add_child(_label("Your units (%d)" % mine.size(), 11, Color(1, 1, 1, 0.6)))
	list.add_child(_gap(5))
	if mine.is_empty():
		var none := UI.wrapped("None yet — deploy a unit above, or jump time to let the war unfold.", 11, Color(1, 1, 1, 0.35))
		list.add_child(none)
		list.add_child(_gap(8))
	for unit in mine:
		_unit_row(list, unit, false)
	if not others.is_empty():
		list.add_child(_gap(8))
		list.add_child(_label("Other forces (%d)" % others.size(), 11, Color(1, 1, 1, 0.6)))
		list.add_child(_gap(5))
		for unit in others:
			_unit_row(list, unit, true)
	scroll.add_child(list)
	_column.add_child(scroll)
	var width := 17.0 * 16.0
	var most := view.y * 0.6
	_panel.custom_minimum_size = Vector2(width, 0)
	_panel.offset_left = 8.0
	_panel.offset_right = 8.0 + width
	await get_tree().process_frame
	if not is_instance_valid(scroll):
		return
	var fixed := head.get_combined_minimum_size().y + 8.0 + deploy.get_combined_minimum_size().y + 10.0 + 24.0
	var height := minf(fixed + list.get_combined_minimum_size().y, most)
	scroll.custom_minimum_size.y = maxf(0.0, height - fixed)
	_panel.offset_bottom = -76.0
	_panel.offset_top = -76.0 - height


func _gap(height: float) -> Control:
	var gap := Control.new()
	gap.custom_minimum_size = Vector2(0, height)
	gap.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return gap


func _unit_row(list: VBoxContainer, unit: Dictionary, dimmed: bool) -> void:
	var id := str(unit.get("id", ""))
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 5)
	var row := Button.new()
	row.focus_mode = Control.FOCUS_NONE
	row.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var style := UI.box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.08), 8, 1)
	for state in ["normal", "hover", "pressed", "hover_pressed", "focus"]:
		row.add_theme_stylebox_override(state, style)
	row.modulate.a = 0.65 if dimmed else 1.0
	var inner := HBoxContainer.new()
	inner.add_theme_constant_override("separation", 8)
	inner.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var glyph := _label(str(TYPE_GLYPH.get(str(unit.get("type", "")), "🛡")), 17, UI.WHITE)
	glyph.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	inner.add_child(glyph)
	var words := VBoxContainer.new()
	words.add_theme_constant_override("separation", 1)
	words.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	words.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var name_label := _label(str(unit.get("name", "")), 12, UI.WHITE, 600)
	name_label.clip_text = true
	name_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	words.add_child(name_label)
	var type_name := str(unit.get("type", ""))
	var detail := _label("%s · %s · %s" % [str(TYPE_LABEL.get(type_name, type_name)), str(unit.get("owner", "")), _activity(unit)], 10, Color(1, 1, 1, 0.55))
	detail.clip_text = true
	detail.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	words.add_child(detail)
	inner.add_child(words)
	var strength := float(unit.get("strength", 0))
	var strength_label := _label("%d%%" % int(strength), 12, strength_color(strength), 700)
	strength_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	inner.add_child(strength_label)
	var holder := MarginContainer.new()
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for side in [["margin_left", 8], ["margin_right", 8], ["margin_top", 6], ["margin_bottom", 6]]:
		holder.add_theme_constant_override(side[0], side[1])
	holder.add_child(inner)
	holder.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	row.add_child(holder)
	row.custom_minimum_size.y = 42
	row.pressed.connect(func() -> void: _fly_to(unit))
	line.add_child(row)
	var edit := _small_button("✎")
	edit.tooltip_text = "Edit this unit"
	edit.custom_minimum_size = Vector2(32, 0)
	edit.pressed.connect(func() -> void:
		if editing == id:
			editing = ""
		else:
			editing = id
			_editor = {"name": str(unit.get("name", "")), "type": str(unit.get("type", "")), "strength": str(int(float(unit.get("strength", 0)))), "status": str(unit.get("status", "")), "note": str(unit.get("note", "")), "saving": false, "error": ""}
		_render())
	line.add_child(edit)
	list.add_child(line)
	list.add_child(_gap(5))
	if editing == id:
		list.add_child(_unit_editor(unit))
		list.add_child(_gap(7))


func _unit_editor(unit: Dictionary) -> Control:
	var box := PanelContainer.new()
	box.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.05), Color(0, 0, 0, 0), 8, 0, Vector4(8, 8, 8, 8)))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 5)
	var name_field := _line_edit(str(_editor.get("name", "")), "", func(value: String) -> void: _editor["name"] = value)
	name_field.tooltip_text = "Unit name"
	column.add_child(name_field)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 5)
	row.add_child(_select(types, TYPE_LABEL, str(_editor.get("type", "")), func(value: String) -> void: _editor["type"] = value))
	var strength := _line_edit(str(_editor.get("strength", "")), "", func(value: String) -> void: _editor["strength"] = value)
	strength.custom_minimum_size.x = 64
	strength.size_flags_horizontal = Control.SIZE_SHRINK_END
	strength.tooltip_text = "Strength, as a percentage of the formation's established strength"
	row.add_child(strength)
	column.add_child(row)
	column.add_child(_select(statuses, STATUS_LABEL, str(_editor.get("status", "")), func(value: String) -> void: _editor["status"] = value))
	var note := _line_edit(str(_editor.get("note", "")), "Note (optional)", func(value: String) -> void: _editor["note"] = value)
	note.tooltip_text = "Note"
	column.add_child(note)
	if not str(_editor.get("error", "")).is_empty():
		column.add_child(_label(str(_editor.get("error", "")), 11, Color("#fca5a5")))
	var buttons := HBoxContainer.new()
	buttons.add_theme_constant_override("separation", 5)
	var saving := bool(_editor.get("saving", false))
	var save := _small_button("Saving…" if saving else "Save", BLUE, 600)
	save.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	save.disabled = saving
	save.pressed.connect(func() -> void: _save_unit(unit))
	buttons.add_child(save)
	var move := _small_button("Move on map")
	move.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var id := str(unit.get("id", ""))
	move.pressed.connect(func() -> void:
		mode = {"kind": "admin-place", "unitId": id}
		editing = ""
		close()
		_render_banner())
	buttons.add_child(move)
	var cancel := _small_button("Cancel")
	cancel.pressed.connect(func() -> void:
		editing = ""
		_render())
	buttons.add_child(cancel)
	column.add_child(buttons)
	box.add_child(column)
	return box


func _save_unit(unit: Dictionary) -> void:
	if bool(_editor.get("saving", false)):
		return
	_editor["saving"] = true
	_editor["error"] = ""
	_render()
	var given := str(_editor.get("strength", "")).strip_edges()
	var number := float(given) if given.is_valid_float() else 0.0
	var strength := clampf(number if number != 0.0 else float(unit.get("strength", 0)), 1.0, 100.0)
	var name := str(_editor.get("name", "")).strip_edges()
	var patch := {
		"name": name if not name.is_empty() else str(unit.get("name", "")),
		"type": str(_editor.get("type", "")),
		"strength": strength,
		"status": str(_editor.get("status", "")),
		"note": str(_editor.get("note", "")).strip_edges(),
	}
	var reply: Dictionary = await engine.request("forces.edit", {"id": str(unit.get("id", "")), "patch": patch})
	_editor["saving"] = false
	if reply.get("ok", false) and bool((reply.get("result", {}) as Dictionary).get("ok", false)):
		editing = ""
		await refresh()
	else:
		_editor["error"] = not_saved
		_render()


func _start_deploy() -> void:
	if turn_running:
		return
	var mine := 0
	for entry in units:
		var owner := str((entry as Dictionary).get("ownerCode", ""))
		if not owner.is_empty() and owner == player_code:
			mine += 1
	var name := deploy_name.strip_edges()
	if name.is_empty():
		name = "%s %d" % [str(TYPE_LABEL.get(deploy_type, deploy_type)), mine + 1]
	var given := deploy_strength.strip_edges()
	var number := float(given) if given.is_valid_float() else 0.0
	mode = {
		"kind": "deploy",
		"params": {
			"type": deploy_type,
			"strength": clampf(number if number != 0.0 else 100.0, 1.0, 100.0),
			"name": name,
			"composition": deploy_composition.strip_edges(),
		},
	}
	close()
	_render_banner()


func _render_banner() -> void:
	for child in _banner.get_children():
		if child is HBoxContainer:
			_banner.remove_child(child)
			child.queue_free()
	var kind := str(mode.get("kind", "idle"))
	_banner.visible = kind != "idle"
	if kind == "idle":
		return
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	var error := str(mode.get("error", ""))
	var hint := _label(error if not error.is_empty() else str(MODE_HINT.get(kind, "Select a target")), 13, Color("#fca5a5") if not error.is_empty() else UI.WHITE)
	hint.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(hint)
	var cancel := _small_button("Cancel", Color(220 / 255.0, 70 / 255.0, 70 / 255.0, 0.25))
	cancel.add_theme_stylebox_override("normal", UI.box(Color(220 / 255.0, 70 / 255.0, 70 / 255.0, 0.25), Color(1, 1, 1, 0.15), 6, 1, Vector4(9, 3, 9, 3)))
	cancel.pressed.connect(func() -> void:
		mode = {"kind": "idle"}
		_render_banner())
	row.add_child(cancel)
	_banner.add_child(row)
	var view := get_viewport_rect().size if is_inside_tree() else Vector2(1440, 900)
	var width := row.get_combined_minimum_size().x + 28.0
	_banner.size = Vector2(width, 0)
	_banner.position = Vector2((view.x - width) * 0.5, 72.0)


func _on_map_click(_index: int) -> void:
	if is_placing():
		place_at(get_viewport().get_mouse_position())


func place_at(point: Vector2) -> void:
	var kind := str(mode.get("kind", "idle"))
	if kind == "idle" or not map_view:
		return
	var world := map_view.screen_to_world(point)
	var lng := fposmod(world.x / MapView.WORLD_WIDTH * 360.0 + 180.0, 360.0) - 180.0
	var lat := rad_to_deg(2.0 * atan(exp((0.5 - world.y / MapView.WORLD_WIDTH) * 2.0 * PI)) - PI / 2.0)
	var armed := mode.duplicate(true)
	mode = {"kind": "idle"}
	_render_banner()
	if kind == "admin-place":
		var reply: Dictionary = await engine.request("forces.place", {"id": str(armed.get("unitId", "")), "lng": lng, "lat": lat})
		var placed: bool = reply.get("ok", false) and bool((reply.get("result", {}) as Dictionary).get("ok", false))
		if not placed and str(mode.get("kind", "idle")) == "idle":
			armed["error"] = not_saved
			mode = armed
			_render_banner()
		await refresh()
	elif kind == "deploy":
		var reply: Dictionary = await engine.request("forces.deploy", {"params": armed.get("params", {}), "lng": lng, "lat": lat})
		var result: Dictionary = reply.get("result", {}) if reply.get("ok", false) else {}
		if not bool(result.get("ok", false)) and str(mode.get("kind", "idle")) == "idle":
			armed["error"] = str(result.get("error", "")) if reply.get("ok", false) else str(reply.get("error", ""))
			if str(armed.get("error", "")).is_empty():
				armed.erase("error")
			mode = armed
			_render_banner()
		await refresh()


func _fly_to(unit: Dictionary) -> void:
	if not map_view:
		return
	var level := maxf(map_view.zoom_level(), 4.5)
	var zoom := pow(2.0, level) / 8.0
	var view := map_view.get_viewport_rect().size
	var short_side := minf(view.x, view.y)
	var pad := clampf(roundf(short_side * 0.12), 16.0, 80.0) if short_side > 0.0 else 40.0
	var centre := MapView.CityLayer.ohproject(float(unit.get("lng", 0)), float(unit.get("lat", 0)))
	var half := Vector2((view.x - 2.0 * pad) / zoom, (view.y - 2.0 * pad) / zoom) * 0.5
	var a := WarRoomMap._world_to_lnglat(centre - half)
	var b := WarRoomMap._world_to_lnglat(centre + half)
	map_view.fit_lonlat_bounds([[a.x, b.y], [b.x, a.y]], level + 0.01, 1.2)

