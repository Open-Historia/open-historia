class_name WorkshopCleanup
extends Control

signal stop_requested
signal answered(mode: String)

const SAVE_NOW_AFTER_MS := 10000

var limits := {"minWidth": 2, "quickWidth": 500, "maxWidth": 1500, "maxMillis": 60000}
var _choice: Control
var _progress: Control
var _note: PanelContainer
var _started := 0
var _stopping := false
var _state := {}
var _headline: Label
var _detail: Label
var _bar_fill: ColorRect
var _bar: Control
var _left_alone: VBoxContainer
var _explain: Label
var _stop_row: HBoxContainer
var _stop_button: Button
var _spinner: Control
var _tick: Timer
var _note_timer: Timer
var _searching := true
var _fraction := 0.0


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_tick = Timer.new()
	_tick.wait_time = 1.0
	_tick.timeout.connect(_on_tick)
	add_child(_tick)
	_note_timer = Timer.new()
	_note_timer.one_shot = true
	_note_timer.timeout.connect(func() -> void:
		if _note and is_instance_valid(_note):
			_note.queue_free()
		_note = null)
	add_child(_note_timer)


func _card() -> Array:
	var shade := ColorRect.new()
	shade.color = Color(8 / 255.0, 8 / 255.0, 9 / 255.0, 0.82)
	shade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	shade.mouse_filter = Control.MOUSE_FILTER_STOP
	var centre := CenterContainer.new()
	centre.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	centre.mouse_filter = Control.MOUSE_FILTER_IGNORE
	shade.add_child(centre)
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", UI.box(Color("#1b1b1e"), Color(1, 1, 1, 0.12), 14, 1, Vector4(24, 22, 24, 22)))
	card.custom_minimum_size.x = 440
	centre.add_child(card)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 12)
	card.add_child(column)
	return [shade, column]


func choose(last: String) -> String:
	var fetched: Dictionary = await _fetch_limits()
	if not fetched.is_empty():
		limits = fetched
	if _choice and is_instance_valid(_choice):
		_choice.queue_free()
	var parts := _card()
	_choice = parts[0]
	var column: VBoxContainer = parts[1]
	var title := UI.label("Clean up the borders", 17, Color(1, 1, 1), 800)
	column.add_child(title)
	column.add_child(WorkshopUI.wrap("Every region is checked for cracks and slivers first, and the ones narrow enough are repaired. Choose how wide one may be and still be repaired.", 12.5, Color(1, 1, 1, 0.7)))
	var deep_km := _km(float(limits.get("maxWidth", 1500)))
	var quick := _choice_button("Quick clean", "Up to %s m wide. Leaves the wider gaps as they are." % str(int(limits.get("quickWidth", 500))))
	var deep := _choice_button("Deep clean", "Up to %s km wide. Closes the wider gaps too, so there is more to repair." % deep_km)
	column.add_child(quick)
	column.add_child(deep)
	var cancel := WorkshopUI.base_button("Cancel")
	var cancel_style := UI.box(Color(0, 0, 0, 0), Color(1, 1, 1, 0.22), 9, 1, Vector4(14, 7, 14, 7))
	WorkshopUI._flat_styles(cancel, cancel_style, UI.box(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.3), 9, 1, Vector4(14, 7, 14, 7)), cancel_style, cancel_style)
	WorkshopUI._ink(cancel, Color(1, 1, 1, 0.8), 12.5, 700)
	cancel.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	column.add_child(cancel)
	add_child(_choice)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	quick.pressed.connect(func() -> void: answered.emit("quick"))
	deep.pressed.connect(func() -> void: answered.emit("deep"))
	cancel.pressed.connect(func() -> void: answered.emit(""))
	_choice.gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventMouseButton and (event as InputEventMouseButton).pressed and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT:
			answered.emit(""))
	var focused := quick if last == "quick" else deep
	focused.focus_mode = Control.FOCUS_ALL
	focused.grab_focus()
	var mode: String = await answered
	if _choice and is_instance_valid(_choice):
		_choice.queue_free()
	_choice = null
	return mode


func _unhandled_key_input(event: InputEvent) -> void:
	if _choice and is_instance_valid(_choice) and event is InputEventKey and (event as InputEventKey).pressed and (event as InputEventKey).keycode == KEY_ESCAPE:
		get_viewport().set_input_as_handled()
		answered.emit("")


func _fetch_limits() -> Dictionary:
	var host := get_parent()
	while host and not (host is Workshop):
		host = host.get_parent()
	if not host:
		return {}
	var reply: Dictionary = await (host as Workshop).request_raw("workshop.cleanupLimits")
	return reply["result"] if reply.get("ok", false) and reply["result"] is Dictionary else {}


func _km(meters: float) -> String:
	var km := meters / 1000.0
	return str(int(km)) if is_equal_approx(km, roundf(km)) else str(snappedf(km, 0.1))


func _choice_button(title: String, text: String) -> Button:
	var node := WorkshopUI.base_button("")
	var normal := UI.box(Color(1, 1, 1, 0.07), Color(1, 1, 1, 0.18), 10, 1, Vector4(14, 11, 14, 11))
	var hover := UI.box(Color(1, 1, 1, 0.11), Color(1, 1, 1, 0.3), 10, 1, Vector4(14, 11, 14, 11))
	var focus := UI.box(Color(1, 1, 1, 0.09), Color(1, 1, 1, 0.45), 10, 1, Vector4(14, 11, 14, 11))
	WorkshopUI._flat_styles(node, normal, hover, hover, normal)
	node.add_theme_stylebox_override("focus", focus)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 3)
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.add_child(UI.label(title, 15, Color(1, 1, 1), 800))
	var body := WorkshopUI.wrap(text, 12, Color(1, 1, 1, 0.68))
	body.custom_minimum_size.x = 360
	column.add_child(body)
	var margin := MarginContainer.new()
	for pair in [["margin_left", 14], ["margin_right", 14], ["margin_top", 11], ["margin_bottom", 11]]:
		margin.add_theme_constant_override(pair[0], pair[1])
	margin.mouse_filter = Control.MOUSE_FILTER_IGNORE
	margin.add_child(column)
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	node.add_child(margin)
	node.custom_minimum_size = Vector2(392, 64)
	margin.minimum_size_changed.connect(func() -> void: node.custom_minimum_size.y = maxf(64.0, margin.get_combined_minimum_size().y))
	return node


func begin(_mode: String) -> void:
	_started = Time.get_ticks_msec()
	_stopping = false
	_searching = true
	_fraction = 0.0
	if _progress and is_instance_valid(_progress):
		_progress.queue_free()
	var parts := _card()
	_progress = parts[0]
	var column: VBoxContainer = parts[1]
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 14)
	_spinner = CleanupSpinner.new()
	_spinner.custom_minimum_size = Vector2(34, 34)
	head.add_child(_spinner)
	var titles := VBoxContainer.new()
	titles.add_theme_constant_override("separation", 2)
	titles.add_child(UI.label("Cleaning up the borders", 17, Color(1, 1, 1), 800))
	_headline = UI.label("", 13, Color(1, 1, 1, 0.7))
	titles.add_child(_headline)
	head.add_child(titles)
	column.add_child(head)
	_bar = Control.new()
	_bar.custom_minimum_size.y = 6
	var track := Panel.new()
	track.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.12), Color(0, 0, 0, 0), 3))
	track.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_bar.add_child(track)
	_bar_fill = ColorRect.new()
	_bar_fill.color = Color(231 / 255.0, 231 / 255.0, 234 / 255.0, 0.72)
	_bar_fill.position = Vector2.ZERO
	_bar_fill.size = Vector2(0, 6)
	_bar.add_child(_bar_fill)
	column.add_child(_bar)
	_detail = UI.label("", 12, Color(1, 1, 1, 0.62))
	column.add_child(_detail)
	_left_alone = VBoxContainer.new()
	_left_alone.add_theme_constant_override("separation", 4)
	column.add_child(_left_alone)
	_explain = WorkshopUI.wrap("", 12, Color(1, 1, 1, 0.55))
	_explain.custom_minimum_size.x = 392
	column.add_child(_explain)
	_stop_row = HBoxContainer.new()
	_stop_row.add_theme_constant_override("separation", 12)
	_stop_button = WorkshopUI.base_button("Save now")
	var stop_style := UI.box(Color(1, 1, 1, 0.12), Color(1, 1, 1, 0.22), 9, 1, Vector4(14, 7, 14, 7))
	WorkshopUI._flat_styles(_stop_button, stop_style, UI.box(Color(1, 1, 1, 0.16), Color(1, 1, 1, 0.3), 9, 1, Vector4(14, 7, 14, 7)), stop_style, UI.box(Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.22), 9, 1, Vector4(14, 7, 14, 7)))
	WorkshopUI._ink(_stop_button, Color(1, 1, 1), 12.5, 700)
	_stop_button.add_theme_color_override("font_disabled_color", Color(1, 1, 1))
	_stop_button.pressed.connect(func() -> void:
		_stopping = true
		_stop_button.text = "Stopping after this step…"
		_stop_button.disabled = true
		stop_requested.emit())
	_stop_row.add_child(_stop_button)
	var keep := WorkshopUI.wrap("Keeps what has been repaired so far; the rest waits for the next save.", 11.5, Color(1, 1, 1, 0.5))
	keep.custom_minimum_size.x = 220
	_stop_row.add_child(keep)
	_stop_row.visible = false
	column.add_child(_stop_row)
	add_child(_progress)
	_update_text()
	_tick.start()


func show_progress(payload: Dictionary) -> void:
	if payload.get("state") == null:
		return
	if not _progress or not is_instance_valid(_progress):
		begin("")
	_state = payload.get("state", {})
	var phase := str(_state.get("phase", ""))
	_searching = phase != "save" and phase != "done"
	_fraction = clampf(float(payload.get("fraction", 0.0)), 0.0, 1.0)
	_headline.text = "%s…" % str(payload.get("headline", ""))
	var left: Array = payload.get("leftAlone", [])
	WorkshopUI.clear(_left_alone)
	for line in left:
		_left_alone.add_child(UI.label(str(line), 12, Color(1, 1, 1, 0.62)))
	_detail.set_meta("detail", str(payload.get("detail", "")))
	_update_text()


func _update_text() -> void:
	if not _progress or not is_instance_valid(_progress):
		return
	var seconds := maxi(0, int((Time.get_ticks_msec() - _started) / 1000))
	var detail := str(_detail.get_meta("detail", ""))
	_detail.text = ("%s · " % detail if not detail.is_empty() else "") + "%d s" % seconds
	var max_width := float(_state.get("maxWidth", limits.get("maxWidth", 1500)))
	_explain.text = "The Workshop is not frozen. Before the map is saved it checks every region for cracks and slivers between %d m and %s km wide and repairs them as one undo step, then looks again around each repair until nothing is left. A whole world takes about ten seconds; a very detailed map stops after %d s, keeps what it repaired, and says so." % [int(limits.get("minWidth", 2)), _km(max_width), int(round(float(limits.get("maxMillis", 60000)) / 1000.0))]
	_bar_fill.size = Vector2(_bar.size.x * _fraction, 6)
	_stop_row.visible = _searching and seconds * 1000 >= SAVE_NOW_AFTER_MS


func _on_tick() -> void:
	_update_text()
	if _spinner:
		_spinner.queue_redraw()


func finish() -> void:
	_tick.stop()
	if _progress and is_instance_valid(_progress):
		_progress.queue_free()
	_progress = null


func show_note(lines: Array) -> void:
	if _note and is_instance_valid(_note):
		_note.queue_free()
	_note = null
	if lines.is_empty():
		return
	_note = PanelContainer.new()
	_note.add_theme_stylebox_override("panel", UI.box(Color(17 / 255.0, 24 / 255.0, 39 / 255.0, 0.92), Color(52 / 255.0, 211 / 255.0, 153 / 255.0, 0.4), 10, 1, Vector4(12, 8, 12, 8)))
	_note.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 5)
	for line in lines:
		var text := WorkshopUI.wrap(str(line), 12.5, Color(1, 1, 1))
		text.custom_minimum_size.x = 356
		column.add_child(text)
	_note.add_child(column)
	add_child(_note)
	_note.reset_size()
	var host := get_parent()
	while host and not (host is Workshop):
		host = host.get_parent()
	var right := 12.0
	if host:
		right += (host as Workshop).dock_right()
	_note.position = Vector2(size.x - right - _note.size.x, 12)
	_note_timer.start(9.0 + 5.0 * float(lines.size() - 1))


class CleanupSpinner extends Control:
	var _angle := 0.0

	func _process(delta: float) -> void:
		_angle = fposmod(_angle + delta * TAU / 0.9, TAU)
		queue_redraw()

	func _draw() -> void:
		var centre := size * 0.5
		var radius := minf(size.x, size.y) * 0.5 - 1.5
		draw_arc(centre, radius, 0.0, TAU, 40, Color(1, 1, 1, 0.11), 3.0, true)
		draw_arc(centre, radius, _angle, _angle + PI * 0.5, 16, Color(1, 1, 1, 0.28), 3.0, true)
