class_name GenerationRatingToast
extends Control

const REM := 16.0
const HIDE_SECONDS := 60.0
const TASK_LABELS := {
	"jumpForward": "time skip",
	"autoJumpForward": "auto time skip",
	"gameMaster": "Game Master edit",
	"interactiveExecutor": "interactive event move",
	"interactiveSummary": "interactive event summary",
}

var engine: EngineLink
var enabled := false
var eligible := {}
var pending := {}
var _bar: PanelContainer
var _serial := 0


func _init() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_bar = PanelContainer.new()
	_bar.mouse_filter = Control.MOUSE_FILTER_STOP
	_bar.add_theme_stylebox_override("panel", UI.box(Color(16 / 255.0, 21 / 255.0, 24 / 255.0, 0.96), Color(1, 1, 1, 0.16), 12, 1, Vector4(0.8 * REM, 0.55 * REM, 0.8 * REM, 0.55 * REM)))
	_bar.anchor_left = 0.5
	_bar.anchor_right = 0.5
	_bar.anchor_top = 1.0
	_bar.anchor_bottom = 1.0
	_bar.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_bar.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_bar.offset_top = -6.0 * REM
	_bar.offset_bottom = -6.0 * REM
	_bar.visible = false
	add_child(_bar)
	if "accessibility_name" in _bar:
		_bar.set("accessibility_name", "Rate this generation")


func setup(link: EngineLink) -> void:
	engine = link
	if not engine.engine_event.is_connected(_on_event):
		engine.engine_event.connect(_on_event)
	var reply: Dictionary = await engine.request("shell.rating.state")
	if reply.get("ok", false):
		enabled = bool(reply["result"].get("enabled", false))
		for task in reply["result"].get("eligible", []):
			eligible[str(task)] = true


func _on_event(event_name: String, data: Variant) -> void:
	if not (data is Dictionary):
		return
	var detail := data as Dictionary
	if event_name == "shell.ratingSetting":
		enabled = bool(detail.get("enabled", false))
		if not enabled:
			hide_toast()
	elif event_name == "shell.generationComplete":
		if not enabled:
			return
		var record: Variant = detail.get("recordId")
		var task := str(detail.get("taskKey", ""))
		if record == null or str(record).is_empty() or not bool(detail.get("ok", true)) or not eligible.has(task):
			return
		show_for(record, task)


func show_for(record_id: Variant, task_key: String) -> void:
	pending = {"recordId": record_id, "taskKey": task_key}
	_serial += 1
	var serial := _serial
	get_tree().create_timer(HIDE_SECONDS).timeout.connect(func() -> void:
		if serial == _serial:
			hide_toast())
	_render()


func hide_toast() -> void:
	pending = {}
	_serial += 1
	_bar.visible = false


func _score_button(text: String) -> Button:
	var button := Button.new()
	button.text = text
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.custom_minimum_size = Vector2(1.5 * REM, 1.5 * REM)
	button.add_theme_font_override("font", ShellFonts.font("sans-serif", 700))
	button.add_theme_font_size_override("font_size", roundi(0.7 * REM))
	var normal := UI.box(Color(0, 0, 0, 0.25), Color(1, 1, 1, 0.16), 6, 1)
	var hover := UI.box(Color(1, 1, 1, 0.08), Color(1, 1, 1, 0.26), 6, 1)
	for state in ["normal", "focus", "disabled"]:
		button.add_theme_stylebox_override(state, normal)
	for state in ["hover", "pressed", "hover_pressed"]:
		button.add_theme_stylebox_override(state, hover)
	for state in ["font_color", "font_focus_color"]:
		button.add_theme_color_override(state, Color(1, 1, 1, 0.8))
	for state in ["font_hover_color", "font_pressed_color", "font_hover_pressed_color"]:
		button.add_theme_color_override(state, Color(1, 1, 1))
	return button


func _render() -> void:
	for child in _bar.get_children():
		_bar.remove_child(child)
		child.queue_free()
	_bar.visible = enabled and not pending.is_empty()
	if not _bar.visible:
		return
	var phone := get_viewport_rect().size.x < 640.0
	var label_text := "Rate this " + str(TASK_LABELS.get(str(pending.get("taskKey", "")), "generation"))
	var title := ShellFonts.label(label_text, 0.78 * REM, Color(1, 1, 1), "sans-serif", 700)
	title.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var scores: Container
	if phone:
		var grid := GridContainer.new()
		grid.columns = 5
		grid.add_theme_constant_override("h_separation", roundi(0.3 * REM))
		grid.add_theme_constant_override("v_separation", roundi(0.3 * REM))
		scores = grid
	else:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", roundi(0.2 * REM))
		scores = row
	var record: Variant = pending.get("recordId")
	for value in range(1, 11):
		var button := _score_button(str(value))
		button.tooltip_text = "%d/10" % value
		if "accessibility_name" in button:
			button.set("accessibility_name", "%d out of 10" % value)
		if phone:
			button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var score := value
		button.pressed.connect(func() -> void:
			if engine:
				await engine.request("shell.rating.set", {"recordId": record, "value": score})
			hide_toast())
		scores.add_child(button)
	var skip := _score_button("Skip")
	skip.custom_minimum_size = Vector2(0, 1.5 * REM)
	skip.add_theme_constant_override("h_separation", 0)
	for state in ["normal", "focus", "disabled"]:
		skip.add_theme_stylebox_override(state, UI.box(Color(0, 0, 0, 0.25), Color(1, 1, 1, 0.16), 6, 1, Vector4(0.5 * REM, 0, 0.5 * REM, 0)))
	for state in ["font_color", "font_focus_color"]:
		skip.add_theme_color_override(state, Color(1, 1, 1, 0.6))
	skip.pressed.connect(hide_toast)
	if phone:
		_bar.anchor_left = 0.0
		_bar.anchor_right = 1.0
		_bar.offset_left = 0.5 * REM
		_bar.offset_right = -0.5 * REM
		var column := VBoxContainer.new()
		column.add_theme_constant_override("separation", roundi(0.45 * REM))
		var head := HBoxContainer.new()
		head.add_child(title)
		head.add_child(UI.spacer())
		head.add_child(skip)
		column.add_child(head)
		column.add_child(scores)
		_bar.add_child(column)
	else:
		_bar.anchor_left = 0.5
		_bar.anchor_right = 0.5
		_bar.offset_left = 0.0
		_bar.offset_right = 0.0
		var line := HBoxContainer.new()
		line.add_theme_constant_override("separation", roundi(0.6 * REM))
		line.add_child(title)
		line.add_child(scores)
		line.add_child(skip)
		_bar.add_child(line)
