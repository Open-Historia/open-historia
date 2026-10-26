class_name AfterActionReports
extends Control

signal closed

const T := preload("res://scripts/ui/war_room_theme.gd")
const TONE_ENEMY := Color("#e0454d")
const CLOSE_SVG := "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.6' stroke-linecap='round'><path d='M5 5l14 14M19 5L5 19'/></svg>"

var engine: EngineLink
var reports: Array = []
var due := ""
var showing: Dictionary = {}
var _asked := ""
var _dialog: PanelContainer
var _shade: ColorRect
var _seq := 0


func _init() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	visible = false
	_shade = ColorRect.new()
	_shade.color = Color(3 / 255.0, 5 / 255.0, 8 / 255.0, 0.62)
	_shade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_shade.mouse_filter = Control.MOUSE_FILTER_STOP
	_shade.gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventMouseButton and (event as InputEventMouseButton).pressed and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT:
			_close())
	add_child(_shade)


func setup(engine_link: EngineLink, _context: Dictionary = {}) -> void:
	engine = engine_link


func refresh() -> void:
	if not engine:
		return
	_seq += 1
	var seq := _seq
	var reply: Dictionary = await engine.request("warreport.list")
	if seq != _seq or not reply.get("ok", false):
		return
	var result: Dictionary = reply.get("result", {})
	reports = result.get("reports", [])
	due = str(result.get("due", ""))
	_show_current()


func open_report(battlefield: String) -> void:
	_asked = battlefield.strip_edges().to_lower()
	await refresh()


func is_showing() -> bool:
	return not showing.is_empty()


func _show_current() -> void:
	var wanted := _asked if not _asked.is_empty() else due.to_lower()
	var found: Dictionary = {}
	if not wanted.is_empty():
		for entry in reports:
			if str((entry as Dictionary).get("name", "")).strip_edges().to_lower() == wanted:
				found = entry
				break
	if found.is_empty():
		_asked = ""
		if not showing.is_empty():
			return
		visible = false
		return
	if not showing.is_empty() and str(showing.get("key", "")) == str(found.get("key", "")):
		return
	showing = found
	_build()
	visible = true


func _close() -> void:
	if showing.is_empty():
		return
	var key := str(showing.get("key", ""))
	showing = {}
	_asked = ""
	visible = false
	if _dialog:
		_dialog.queue_free()
		_dialog = null
	closed.emit()
	if engine:
		await engine.request("warreport.seen", {"key": key})
		await refresh()


func _input(event: InputEvent) -> void:
	if showing.is_empty() or not (event is InputEventKey):
		return
	var key := event as InputEventKey
	if key.pressed and not key.echo and key.keycode == KEY_ESCAPE:
		get_viewport().set_input_as_handled()
		_close()


func _tones() -> Array:
	var side := int(showing.get("side", -1))
	var tones: Array = []
	for at in range(2):
		if side < 0:
			tones.append(T.BONE if at == 0 else T.BONE_SOFT)
		else:
			tones.append(T.AMBER if at == side else TONE_ENEMY)
	return tones


func _rich(size_rem: float, colour: Color, line_height := 1.4) -> RichTextLabel:
	var rich := RichTextLabel.new()
	rich.fit_content = true
	rich.scroll_active = false
	rich.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	rich.selection_enabled = false
	rich.add_theme_font_override("normal_font", UI.font(400))
	rich.add_theme_font_override("bold_font", UI.font(700))
	rich.add_theme_font_size_override("normal_font_size", T.font_size(size_rem))
	rich.add_theme_font_size_override("bold_font_size", T.font_size(size_rem))
	rich.add_theme_color_override("default_color", colour)
	rich.add_theme_constant_override("line_separation", maxi(0, int(round(size_rem * 16.0 * line_height - T.font_size(size_rem) * 1.15))))
	rich.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	rich.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return rich


static func _who(rich: RichTextLabel, name: String) -> void:
	rich.push_bold()
	rich.push_color(T.BONE)
	rich.add_text(name)
	rich.pop()
	rich.pop()


func _moment(rich: RichTextLabel, moment: Dictionary, names: Array) -> void:
	var s := int(moment.get("s", -1))
	var who := str(names[s]) if s >= 0 and s < names.size() else ""
	var enemy := str(names[1 - s]) if s >= 0 and 1 - s < names.size() else ""
	var place := str(moment.get("place", ""))
	match str(moment.get("k", "")):
		"offensive":
			_who(rich, who)
			if str(moment.get("at", "")) == "the whole line":
				rich.add_text(" went over to the attack along the whole line.")
			else:
				rich.add_text(" went over to the attack in the %s." % place)
		"counter":
			_who(rich, who)
			rich.add_text(" answered a breakthrough at %s with a counter-offensive." % place)
		"city":
			_who(rich, who)
			rich.add_text(" took %s, a capital." % place if bool(moment.get("capital", false)) else " took %s." % place)
		"pocket":
			_who(rich, enemy)
			rich.add_text(" surrounded troops of ")
			_who(rich, who)
			rich.add_text(" near %s, and they surrendered." % place)
		"siege":
			_who(rich, enemy)
			rich.add_text(" shut troops of ")
			_who(rich, who)
			rich.add_text(" in at %s." % place)
		"breached":
			_who(rich, who)
			rich.add_text(" broke through %s." % place)
		"destroyed":
			_who(rich, who)
			rich.add_text(" destroyed %s." % place)
		"invaded":
			_who(rich, who)
			rich.add_text(" sent its troops into %s." % place)
		"attacked":
			_who(rich, who)
			rich.add_text(" attacked %s." % place)
		"landed":
			rich.add_text("Troops of ")
			_who(rich, who)
			rich.add_text(" came ashore at %s." % place)
		"withdrew":
			_who(rich, who)
			rich.add_text(" withdrew its last troops.")
		"returned":
			_who(rich, who)
			rich.add_text(" sent its troops back.")
		"assault":
			_who(rich, who)
			rich.add_text(" stormed %s." % place)


func _build() -> void:
	if _dialog:
		_dialog.queue_free()
	var report := showing
	var names: Array = report.get("names", [])
	var sides: Array = report.get("sides", [[], []])
	var tones := _tones()
	var none := Color(0, 0, 0, 0)
	_dialog = PanelContainer.new()
	_dialog.texture_repeat = CanvasItem.TEXTURE_REPEAT_ENABLED
	var style := T.plate_style([T.SEAM, T.RED, T.SEAM, T.SEAM], Vector4(2, 4, 2, 2), Vector4(2, 4, 2, 2))
	style.inner_top = T.LIP
	T.add_rivet(style, "top-left", T.px(0.4), T.px(0.4), 0.5)
	T.add_rivet(style, "top-right", T.px(0.4), T.px(0.4), 0.5)
	_dialog.add_theme_stylebox_override("panel", style)
	_dialog.mouse_filter = Control.MOUSE_FILTER_STOP
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	var head := PanelContainer.new()
	head.add_theme_stylebox_override("panel", T.bevel(none, [none, none, none, T.SEAM], Vector4(0, 0, 0, 2), Vector4(T.px(1.1), T.px(0.75), T.px(1.1), T.px(0.6) + 2.0)))
	var head_row := HBoxContainer.new()
	head_row.add_theme_constant_override("separation", int(round(T.px(0.6))))
	var titles := VBoxContainer.new()
	titles.add_theme_constant_override("separation", 0)
	titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	titles.add_child(T.stencil("After-action report", 0.68, T.BONE_SOFT, 0.2))
	var name_label := T.stencil(str(report.get("name", "")), 1.15, T.BONE, 0.12)
	name_label.autowrap_mode = TextServer.AUTOWRAP_ARBITRARY
	titles.add_child(T.pad(name_label, Vector4(0, T.px(0.15), 0, 0)))
	var against := "%s against %s" % [", ".join(PackedStringArray(sides[0] if sides.size() > 0 else [])), ", ".join(PackedStringArray(sides[1] if sides.size() > 1 else []))]
	titles.add_child(T.pad(T.text(against, 0.74, T.BONE_SOFT, 400, 1.25), Vector4(0, T.px(0.2), 0, 0)))
	var when := "%s to %s" % [str(report.get("opened", "")), str(report.get("closed", ""))]
	if report.get("days") != null:
		when += " · %d days" % int(report.get("days", 0))
	titles.add_child(T.pad(T.text(when, 0.7, T.BONE_FAINT, 400, 1.25), Vector4(0, T.px(0.12), 0, 0)))
	head_row.add_child(titles)
	var close_key := Button.new()
	close_key.focus_mode = Control.FOCUS_NONE
	close_key.tooltip_text = "Close the report"
	close_key.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var key_style := T.key_style(false, Vector4(T.px(0.55), T.px(0.42), T.px(0.55), T.px(0.42)))
	for state in ["normal", "hover", "pressed", "hover_pressed", "focus"]:
		close_key.add_theme_stylebox_override(state, key_style)
	close_key.icon = T.svg_icon("aar-close", CLOSE_SVG, 14, T.BONE)
	close_key.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	close_key.pressed.connect(_close)
	head_row.add_child(close_key)
	head.add_child(head_row)
	column.add_child(head)
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var body_margin := MarginContainer.new()
	body_margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for side in [["margin_left", T.px(1.1)], ["margin_right", T.px(1.1)], ["margin_top", T.px(0.7)], ["margin_bottom", T.px(1.0)]]:
		body_margin.add_theme_constant_override(side[0], int(round(side[1])))
	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 0)
	body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var strength: Array = report.get("strength", [])
	if strength.size() > 0:
		var first: Array = strength[0]
		var last: Array = strength[strength.size() - 1]
		var tray := T.tray(false, Vector4(T.px(0.55), T.px(0.45), T.px(0.55), T.px(0.45)))
		var stack := VBoxContainer.new()
		stack.add_theme_constant_override("separation", 0)
		stack.add_child(T.stencil("Strength", 0.66))
		if strength.size() >= 2:
			var chart := _Chart.new()
			chart.points = strength
			chart.tones = tones
			chart.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			stack.add_child(T.pad(chart, Vector4(0, T.px(0.3), 0, 0)))
		for at in range(2):
			var line := HBoxContainer.new()
			line.add_theme_constant_override("separation", int(round(T.px(0.35))))
			var swatch := ColorRect.new()
			swatch.color = tones[at]
			swatch.custom_minimum_size = Vector2(T.px(0.9), T.px(0.2))
			swatch.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
			var swatch_holder := T.pad(swatch, Vector4(0, T.px(0.45), 0, 0))
			swatch_holder.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
			line.add_child(swatch_holder)
			var rich := _rich(0.72, T.BONE_SOFT)
			_who(rich, str(names[at]) if at < names.size() else "")
			rich.add_text(": %d formations at the first count, %d at the end, at %d%% strength" % [int(first[at + 1]), int(last[at + 1]), int(last[at + 3])])
			line.add_child(rich)
			stack.add_child(T.pad(line, Vector4(0, T.px(0.3) if at == 0 else 0.0, 0, 0)))
		tray.add_child(stack)
		body.add_child(tray)
	body.add_child(T.pad(T.stencil("Turning points", 0.7), Vector4(0, T.px(0.8), 0, 0)))
	var points: Array = report.get("points", [])
	if points.is_empty():
		body.add_child(T.pad(T.text("Nothing that turned the war was kept of it.", 0.74, T.BONE_SOFT), Vector4(0, T.px(0.3), 0, 0)))
	var list := VBoxContainer.new()
	list.add_theme_constant_override("separation", 0)
	for entry in points:
		var moment: Dictionary = entry
		var s := int(moment.get("s", -1))
		var item := PanelContainer.new()
		item.add_theme_stylebox_override("panel", T.bevel(none, [tones[s] if s >= 0 and s < tones.size() else T.BONE_FAINT, none, none, none], Vector4(2, 0, 0, 0), Vector4(T.px(0.55) + 2.0, 0, 0, 0)))
		var stack := VBoxContainer.new()
		stack.add_theme_constant_override("separation", 0)
		stack.add_child(T.text(str(moment.get("date", "")), 0.66, T.BONE_FAINT, 400, 1.3))
		var rich := _rich(0.76, T.BONE_SOFT)
		_moment(rich, moment, names)
		stack.add_child(rich)
		item.add_child(stack)
		list.add_child(T.pad(item, Vector4(0, T.px(0.35), 0, 0)))
	body.add_child(T.pad(list, Vector4(0, T.px(0.3), 0, 0)))
	body.add_child(T.pad(T.stencil("What each side came to", 0.7), Vector4(0, T.px(0.8), 0, 0)))
	var tallies: Array = report.get("tallies", [])
	for at in range(2):
		var tally: Dictionary = tallies[at] if at < tallies.size() else {}
		var rich := _rich(0.74, T.BONE_SOFT, 1.45)
		_who(rich, str(names[at]) if at < names.size() else "")
		rich.add_text(": ")
		var towns := int(tally.get("towns", 0))
		if towns > 0:
			rich.add_text("took %d %s (%s%s)" % [towns, "town" if towns == 1 else "towns", ", ".join(PackedStringArray(tally.get("names", []))), " and more" if bool(tally.get("more", false)) else ""])
		else:
			rich.add_text("took no town")
		var breached := int(tally.get("breached", 0))
		if breached > 0:
			rich.add_text("; broke through a fortified line %s" % ("once" if breached == 1 else "%d times" % breached))
		var surrendered := int(tally.get("surrendered", 0))
		if surrendered > 0:
			rich.add_text("; had troops surrounded and surrender %s" % ("once" if surrendered == 1 else "%d times" % surrendered))
		rich.add_text(".")
		body.add_child(T.pad(rich, Vector4(0, T.px(0.3), 0, 0)))
	var close_button := T.key("Close")
	close_button.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	close_button.pressed.connect(_close)
	body.add_child(T.pad(close_button, Vector4(0, T.px(0.9), 0, 0)))
	body_margin.add_child(body)
	scroll.add_child(body_margin)
	column.add_child(scroll)
	_dialog.add_child(column)
	add_child(_dialog)
	_layout_dialog(scroll, body_margin, head)


func _layout_dialog(scroll: ScrollContainer, body: Control, head: Control) -> void:
	var view := get_viewport_rect().size if is_inside_tree() else Vector2(1440, 900)
	var width := minf(T.px(34.0), view.x - T.px(1.0))
	_dialog.custom_minimum_size = Vector2(width, 0)
	_dialog.size = Vector2(width, 0)
	await get_tree().process_frame
	if not is_instance_valid(_dialog):
		return
	var most := view.y - T.px(1.0)
	var wanted := head.get_combined_minimum_size().y + body.get_combined_minimum_size().y + 6.0
	var height := minf(wanted, most)
	scroll.custom_minimum_size.y = maxf(0.0, height - head.get_combined_minimum_size().y - 6.0)
	_dialog.size = Vector2(width, height)
	_dialog.position = Vector2((view.x - width) * 0.5, (view.y - height) * 0.5)


class _Chart extends Control:
	var points: Array = []
	var tones: Array = []

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		custom_minimum_size = Vector2(0, 92)

	func _notification(what: int) -> void:
		if what == NOTIFICATION_RESIZED:
			var wanted := roundf(size.x * 92.0 / 300.0)
			if absf(custom_minimum_size.y - wanted) > 0.5 and size.x > 0.0:
				custom_minimum_size.y = wanted
			queue_redraw()

	func _draw() -> void:
		if points.size() < 2 or size.x <= 0.0:
			return
		var scale := size.x / 300.0
		var width := 300.0
		var height := 92.0
		var most := 1.0
		for point in points:
			most = maxf(most, maxf(float(point[1]), float(point[2])))
		draw_rect(Rect2(Vector2.ZERO, Vector2(width, height) * scale), Color(0, 0, 0, 0.32))
		draw_rect(Rect2(Vector2(0.5, 0.5), Vector2(width, height) * scale - Vector2(1, 1)), WarRoomTheme.SEAM, false, 1.0)
		draw_line(Vector2(6, height - 8) * scale, Vector2(width - 6, height - 8) * scale, WarRoomTheme.BONE_FAINT, maxf(0.6 * scale, 0.6), true)
		for side in range(2):
			var line := PackedVector2Array()
			for at in range(points.size()):
				var x := 6.0 + (float(at) * (width - 12.0)) / (points.size() - 1)
				var y := height - 8.0 - (float(points[at][side + 1]) * (height - 18.0)) / most
				line.append(Vector2(x, y) * scale)
			draw_polyline(line, tones[side], 2.0 * scale, true)
