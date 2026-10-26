class_name EditorWarMusterChart
extends VBoxContainer

signal points_changed(points: Variant)

const VIEW_W := 300.0
const VIEW_H := 140.0
const LEFT := 32.0
const RIGHT := 10.0
const TOP := 8.0
const BOTTOM := 18.0
const PLOT_W := VIEW_W - LEFT - RIGHT
const PLOT_H := VIEW_H - TOP - BOTTOM
const MOST_WIDTH := 420.0
const TICK_STEPS := [1.0, 2.0, 2.5, 5.0, 10.0]
const END_STEPS := [1.0, 1.2, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0, 8.0, 10.0]
const ACCENT := Color("#2bc1f3")
const MUTED := Color(1, 1, 1, 0.45)
const GRID := Color(1, 1, 1, 0.08)
const AXIS := Color(1, 1, 1, 0.3)
const TICK_TEXT := Color(1, 1, 1, 0.55)
const HANDLE_RING := Color("#0b0b0d")

var own_label := "Its own curve"
var fallback_label := "The game's default"
var editable := true
var _own: Variant = null
var _base: Array = []
var _drag := {}
var _typed: Variant = null
var _problem := false
var _plot: Plot
var _legend: HBoxContainer
var _fields: Array[LineEdit] = []
var _problem_label: Label
var _all_in_label: Label
var _default_button: Button


class Plot extends Control:
	var chart: EditorWarMusterChart

	func _draw() -> void:
		if chart:
			chart.draw_plot(self)

	func _gui_input(event: InputEvent) -> void:
		if chart:
			chart.plot_input(self, event)


class LegendLine extends Control:
	var dashed := false

	func _init(is_dashed: bool) -> void:
		dashed = is_dashed
		custom_minimum_size = Vector2(18, 6)
		size_flags_vertical = Control.SIZE_SHRINK_CENTER
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func _draw() -> void:
		if dashed:
			var x := 0.0
			while x < 18.0:
				draw_line(Vector2(x, 3), Vector2(minf(18.0, x + 4.0), 3), MUTED, 2.0)
				x += 7.0
		else:
			draw_line(Vector2(0, 3), Vector2(18, 3), ACCENT, 2.0)


func _init(own_text := "Its own curve", fallback_text := "The game's default") -> void:
	own_label = own_text
	fallback_label = fallback_text
	add_theme_constant_override("separation", 6)
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_base = EditorWarRules.DEFAULT_MUSTER.duplicate(true)
	add_child(UI.label("Army mustered, by days since the call-up", 11, Color(1, 1, 1, 0.5)))
	_plot = Plot.new()
	_plot.chart = self
	_plot.mouse_filter = Control.MOUSE_FILTER_STOP
	_plot.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	_plot.custom_minimum_size = Vector2(MOST_WIDTH, MOST_WIDTH * VIEW_H / VIEW_W)
	_plot.tooltip_text = "Mustering curve"
	add_child(_plot)
	_legend = HBoxContainer.new()
	_legend.add_theme_constant_override("separation", 12)
	add_child(_legend)
	var grid := GridContainer.new()
	grid.columns = 3
	grid.add_theme_constant_override("h_separation", 6)
	grid.add_theme_constant_override("v_separation", 4)
	grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	grid.add_child(Control.new())
	for heading in ["Mustered (%)", "Days after the call-up"]:
		var head := UI.label(heading, 11, Color(1, 1, 1, 0.5))
		head.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		head.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		grid.add_child(head)
	var tips := [
		"First point: the share of the army mustered, in percent",
		"First point: days since the call-up",
		"Second point: the share of the army mustered, in percent",
		"Second point: days since the call-up",
	]
	for row in range(2):
		grid.add_child(UI.label("First point" if row == 0 else "Second point", 11, Color(1, 1, 1, 0.72)))
		for column in range(2):
			var index := row * 2 + column
			var field := LineEdit.new()
			EditorWarKit.style_line(field, Vector4(8, 4, 8, 4), 30.0)
			field.alignment = HORIZONTAL_ALIGNMENT_RIGHT
			field.tooltip_text = tips[index]
			field.text_changed.connect(func(text: String) -> void: _on_field_text(index, text))
			field.text_submitted.connect(func(_text: String) -> void: field.release_focus())
			field.focus_exited.connect(func() -> void:
				if _typed != null:
					_commit(_typed as Array, true))
			_fields.append(field)
			grid.add_child(field)
	add_child(grid)
	_problem_label = UI.wrapped("The second point needs more of the army than the first, and more days (at most %d)." % EditorWarRules.MUSTER_DAYS_MOST, 11, EditorWarKit.ALERT)
	_problem_label.visible = false
	add_child(_problem_label)
	var footer := HBoxContainer.new()
	footer.add_theme_constant_override("separation", 8)
	_all_in_label = UI.label("", 11, Color(1, 1, 1, 0.5))
	_all_in_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_all_in_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	footer.add_child(_all_in_label)
	_default_button = Button.new()
	_default_button.text = "Use the default"
	_default_button.tooltip_text = "Take this curve away, and the default stands again"
	_default_button.focus_mode = Control.FOCUS_NONE
	_default_button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var normal := UI.box(Color(1, 1, 1, 0.08), Color(1, 1, 1, 0.15), 7, 1, Vector4(8, 3, 8, 3))
	var hover := UI.box(Color(1, 1, 1, 0.13), Color(1, 1, 1, 0.25), 7, 1, Vector4(8, 3, 8, 3))
	for state in [["normal", normal], ["hover", hover], ["pressed", hover], ["hover_pressed", hover], ["focus", normal]]:
		_default_button.add_theme_stylebox_override(state[0], state[1])
	_default_button.add_theme_font_override("font", UI.font(600))
	_default_button.add_theme_font_size_override("font_size", 11)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		_default_button.add_theme_color_override(name, UI.WHITE)
	_default_button.pressed.connect(func() -> void:
		_typed = null
		_problem = false
		points_changed.emit(null))
	footer.add_child(_default_button)
	add_child(footer)
	resized.connect(_fit)


func _ready() -> void:
	_fit()
	_sync()


func set_points(points: Variant, fallback: Variant = null) -> void:
	_own = EditorWarRules.normalize_muster_points(points)
	var base: Variant = EditorWarRules.normalize_muster_points(fallback if fallback != null else EditorWarRules.DEFAULT_MUSTER)
	_base = base if base != null else EditorWarRules.DEFAULT_MUSTER.duplicate(true)
	_sync()


func _fit() -> void:
	var width := minf(MOST_WIDTH, maxf(120.0, size.x))
	_plot.custom_minimum_size = Vector2(width, width * VIEW_H / VIEW_W)
	_plot.queue_redraw()


func _shown() -> Variant:
	if not _drag.is_empty():
		return _drag["points"]
	return _own


func _handles() -> Array:
	var shown: Variant = _shown()
	return shown if shown != null else _base


func _nice_ceil(value: float, steps: Array) -> float:
	if not (value > 0.0):
		return 1.0
	var power := pow(10.0, floorf(log(value) / log(10.0)))
	for step in steps:
		if float(step) * power >= value - 1e-9:
			return float(step) * power
	return 10.0 * power


func _max_days() -> float:
	var furthest := maxf(float(EditorWarRules.all_in_day(_base)), float(_base[1][1]) * 1.08)
	if _own != null:
		furthest = maxf(furthest, maxf(float(EditorWarRules.all_in_day(_own)), float(_own[1][1]) * 1.08))
	return minf(float(EditorWarRules.MUSTER_DAYS_MOST), _nice_ceil(furthest, END_STEPS))


func _scale() -> float:
	return float(_drag["max"]) if not _drag.is_empty() else _max_days()


func _places(value: float, digits: int) -> String:
	var factor := pow(10.0, digits)
	return EditorWarRules.js_number(floorf(value * factor + 0.5) / factor)


func _text_of(points: Variant) -> Array:
	if points == null:
		return ["", "", "", ""]
	return [_places(float(points[0][0]) * 100.0, 1), _places(float(points[0][1]), 1), _places(float(points[1][0]) * 100.0, 1), _places(float(points[1][1]), 1)]


func _sync() -> void:
	if not is_instance_valid(_plot):
		return
	for child in _legend.get_children():
		_legend.remove_child(child)
		child.queue_free()
	if _shown() != null:
		_legend.add_child(_legend_item(false, own_label))
	_legend.add_child(_legend_item(true, fallback_label))
	var shown_texts: Array = _text_of(_drag["points"]) if not _drag.is_empty() else (_typed if _typed != null else _text_of(_own))
	var placeholders := _text_of(_own if _own != null else _base)
	for index in range(4):
		var field := _fields[index]
		field.placeholder_text = str(placeholders[index])
		field.editable = editable
		if field.text != str(shown_texts[index]):
			var caret := field.caret_column
			field.text = str(shown_texts[index])
			field.caret_column = mini(caret, field.text.length())
	_problem_label.visible = _problem
	_all_in_label.text = "All of the army is in by day %d." % EditorWarRules.all_in_day(_handles())
	_default_button.visible = _own != null and editable
	_plot.mouse_default_cursor_shape = Control.CURSOR_ARROW
	_plot.queue_redraw()


func _legend_item(dashed: bool, text: String) -> HBoxContainer:
	var item := HBoxContainer.new()
	item.add_theme_constant_override("separation", 5)
	item.add_child(LegendLine.new(dashed))
	item.add_child(UI.label(text, 11, Color(1, 1, 1, 0.6)))
	return item


func _on_field_text(index: int, text: String) -> void:
	if not _drag.is_empty():
		return
	var next: Array = (_typed as Array).duplicate() if _typed != null else _text_of(_own)
	next[index] = text
	_typed = next
	_commit(next, false)


func _read(text: String, otherwise: float, unit: float) -> float:
	var trimmed := text.strip_edges()
	if trimmed.is_empty():
		return otherwise
	var cleaned := RegEx.create_from_string("\\s*%$").sub(trimmed, "").replace(",", ".")
	var number := EditorWarRules.to_number(cleaned) if not cleaned.strip_edges().is_empty() else 0.0
	return number / unit if EditorWarRules.is_finite_number(number) else NAN


func _commit(texts: Array, final: bool) -> void:
	var all_empty := true
	for text in texts:
		if not str(text).strip_edges().is_empty():
			all_empty = false
	if all_empty:
		if final:
			_typed = null
			_problem = false
			_sync()
		return
	var from: Array = _own if _own != null else _base
	var kept: Variant = EditorWarRules.normalize_muster_points([
		[_read(str(texts[0]), float(from[0][0]), 100.0), _read(str(texts[1]), float(from[0][1]), 1.0)],
		[_read(str(texts[2]), float(from[1][0]), 100.0), _read(str(texts[3]), float(from[1][1]), 1.0)],
	])
	if kept == null:
		if final:
			_problem = true
			_sync()
		return
	_problem = false
	if final:
		_typed = null
	if not EditorWarRules.same_json(kept, _own):
		points_changed.emit(kept)
	_sync()


func _view_x(days: float, range_days: float) -> float:
	return LEFT + (minf(days, range_days) / range_days) * PLOT_W


func _view_y(share: float) -> float:
	return TOP + (1.0 - share) * PLOT_H


func _curve(points: Variant, range_days: float) -> PackedVector2Array:
	var all_in_by := float(EditorWarRules.MUSTER_TABLE_DAYS_MOST + 1)
	var drawn: Array = []
	var previous: Variant = null
	for point in EditorWarRules.muster_curve_points(points, 96):
		var days := float(point[0])
		var share := float(point[1])
		if days > all_in_by:
			var at := share
			if previous != null:
				at = float(previous[1]) + ((share - float(previous[1])) * (all_in_by - float(previous[0]))) / (days - float(previous[0]))
			drawn.append([all_in_by, at])
			drawn.append([all_in_by, 1.0])
			break
		drawn.append([days, share])
		previous = [days, share]
	var out := PackedVector2Array()
	for entry in drawn:
		out.append(Vector2(_view_x(float(entry[0]), range_days), _view_y(float(entry[1]))))
	return out


func _dashed(canvas: Control, points: PackedVector2Array, color: Color, width: float, dash: float, space: float) -> void:
	var drawing := true
	var left := dash
	for index in range(points.size() - 1):
		var start := points[index]
		var finish := points[index + 1]
		var length := start.distance_to(finish)
		var travelled := 0.0
		while travelled < length:
			var step := minf(left, length - travelled)
			var from := start.lerp(finish, travelled / length)
			var to := start.lerp(finish, (travelled + step) / length)
			if drawing:
				canvas.draw_line(from, to, color, width, true)
			travelled += step
			left -= step
			if left <= 0.0:
				drawing = not drawing
				left = dash if drawing else space


func draw_plot(canvas: Control) -> void:
	var s := canvas.size.x / VIEW_W
	canvas.draw_style_box(UI.box(Color(0, 0, 0, 0.25), Color(1, 1, 1, 0.1), 8, 1), Rect2(Vector2.ZERO, canvas.size))
	var range_days := _scale()
	var step := _nice_ceil(range_days / 4.0, TICK_STEPS)
	var ticks: Array = []
	var day := 0.0
	while day <= range_days + 1e-9:
		ticks.append(roundf(day * 10.0) / 10.0)
		day += step
	var font := UI.font(400)
	var text_size := maxi(7, int(roundf(9.0 * s)))
	for share in [0.0, 0.25, 0.5, 0.75, 1.0]:
		var y := _view_y(share) * s
		canvas.draw_line(Vector2(LEFT * s, y), Vector2((LEFT + PLOT_W) * s, y), AXIS if share == 0.0 else GRID, maxf(1.0, s * 0.9))
	for tick in ticks:
		var x := _view_x(float(tick), range_days) * s
		canvas.draw_line(Vector2(x, TOP * s), Vector2(x, (TOP + PLOT_H) * s), AXIS if float(tick) == 0.0 else GRID, maxf(1.0, s * 0.9))
	for share in [0.0, 0.5, 1.0]:
		var text := "%d%%" % int(share * 100.0)
		var width := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, text_size).x
		canvas.draw_string(font, Vector2((LEFT - 4.0) * s - width, (_view_y(share) + 3.0) * s), text, HORIZONTAL_ALIGNMENT_LEFT, -1, text_size, TICK_TEXT)
	for index in range(ticks.size()):
		var text := EditorWarRules.js_number(float(ticks[index]))
		var width := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, text_size).x
		var x := _view_x(float(ticks[index]), range_days) * s
		canvas.draw_string(font, Vector2(x if index == 0 else x - width * 0.5, (VIEW_H - 5.0) * s), text, HORIZONTAL_ALIGNMENT_LEFT, -1, text_size, TICK_TEXT)
	var base_line := _curve(_base, range_days)
	for index in range(base_line.size()):
		base_line[index] *= s
	_dashed(canvas, base_line, MUTED, 1.5 * s, 4.0 * s, 3.0 * s)
	var shown: Variant = _shown()
	if shown != null:
		var own_line := _curve(shown, range_days)
		for index in range(own_line.size()):
			own_line[index] *= s
		canvas.draw_polyline(own_line, ACCENT, 2.0 * s, true)
	canvas.draw_circle(Vector2(_view_x(0.0, range_days), _view_y(0.0)) * s, 3.0 * s, Color(1, 1, 1, 0.8), true, -1.0, true)
	var colour := ACCENT if _own != null or not _drag.is_empty() else MUTED
	var handles := _handles()
	for index in range(handles.size()):
		var centre := Vector2(_view_x(float(handles[index][1]), range_days), _view_y(float(handles[index][0]))) * s
		var radius := (6.5 if not _drag.is_empty() and int(_drag["index"]) == index else 5.5) * s
		canvas.draw_circle(centre, radius, colour, true, -1.0, true)
		canvas.draw_arc(centre, radius, 0.0, TAU, 32, HANDLE_RING, 1.5 * s, true)


func _pointer_at(canvas: Control, position: Vector2, range_days: float) -> Vector2:
	var s := canvas.size.x / VIEW_W
	var px := position.x / s
	var py := position.y / s
	return Vector2(((px - LEFT) / PLOT_W) * range_days, 1.0 - (py - TOP) / PLOT_H)


func _place_point(points: Array, index: int, days: float, share: float, most: float) -> Array:
	var step := 1.0 if most > 60.0 else 0.5
	var day := roundf(days / step) * step
	var part := roundf(share * 100.0) / 100.0
	var first: Array = points[0]
	var second: Array = points[1]
	if index == 0:
		return [[clampf(part, 0.01, float(second[0]) - 0.01), clampf(day, step, float(second[1]) - step)], second.duplicate()]
	return [first.duplicate(), [clampf(part, float(first[0]) + 0.01, 1.0), clampf(day, float(first[1]) + step, most)]]


func plot_input(canvas: Control, event: InputEvent) -> void:
	if not editable:
		return
	var s := canvas.size.x / VIEW_W
	if event is InputEventMouseButton and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT:
		var button := event as InputEventMouseButton
		if button.pressed:
			var range_days := _max_days()
			var handles := _handles()
			for index in range(handles.size()):
				var centre := Vector2(_view_x(float(handles[index][1]), range_days), _view_y(float(handles[index][0]))) * s
				if centre.distance_to(button.position) <= 12.0 * s:
					_drag = {"index": index, "points": (handles as Array).duplicate(true), "max": range_days}
					canvas.accept_event()
					_sync()
					return
		elif not _drag.is_empty():
			var kept: Variant = EditorWarRules.normalize_muster_points(_drag["points"])
			_drag = {}
			_typed = null
			_problem = false
			canvas.accept_event()
			if kept != null and not EditorWarRules.same_json(kept, _own):
				points_changed.emit(kept)
			_sync()
	elif event is InputEventMouseMotion:
		var motion := event as InputEventMouseMotion
		if not _drag.is_empty():
			var at := _pointer_at(canvas, motion.position, float(_drag["max"]))
			_drag["points"] = _place_point(_drag["points"], int(_drag["index"]), at.x, at.y, float(_drag["max"]))
			canvas.accept_event()
			_sync()
			return
		var range_days := _max_days()
		var over := false
		var handles := _handles()
		for index in range(handles.size()):
			var centre := Vector2(_view_x(float(handles[index][1]), range_days), _view_y(float(handles[index][0]))) * s
			if centre.distance_to(motion.position) <= 12.0 * s:
				over = true
		canvas.mouse_default_cursor_shape = Control.CURSOR_DRAG if over else Control.CURSOR_ARROW

