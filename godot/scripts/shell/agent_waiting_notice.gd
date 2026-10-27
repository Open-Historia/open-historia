class_name AgentWaitingNotice
extends Control

const REM := 16.0
const WAITING_TEXTS := {
	"advisor": "Your advisor's reply is waiting for your Agent: type /answer",
	"diplomacy": "A diplomatic reply is waiting for your Agent: type /answer",
	"gameMaster": "Your Game Master command is waiting for your Agent: type /answer",
	"interactive": "Your interactive event is waiting for your Agent: type /answer",
	"skip": "Your time skip's last step is waiting for your Agent: type /answer",
}

var engine: EngineLink
var kinds: Array = []
var can_pass_on := false
var _panel: PanelContainer
var _flow: HFlowContainer


func _init() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_panel = ShellNotices.top_panel(ShellNotices.BLUE_EDGE, Vector4(0.85 * REM, 0.6 * REM, 0.85 * REM, 0.6 * REM))
	_flow = HFlowContainer.new()
	_flow.add_theme_constant_override("h_separation", roundi(0.7 * REM))
	_flow.add_theme_constant_override("v_separation", roundi(0.5 * REM))
	_panel.add_child(_flow)
	_panel.visible = false
	add_child(_panel)
	resized.connect(_render)


func setup(link: EngineLink) -> void:
	engine = link
	if not engine.engine_event.is_connected(_on_event):
		engine.engine_event.connect(_on_event)
	var reply: Dictionary = await engine.request("shell.agent.state")
	if reply.get("ok", false):
		_take(reply["result"])


func _on_event(event_name: String, data: Variant) -> void:
	if event_name == "shell.agentWaits" and data is Dictionary:
		_take(data)


func _take(state: Dictionary) -> void:
	kinds = state.get("kinds", [])
	can_pass_on = bool(state.get("canPassOn", false))
	_render()


func _button(text: String, action: Callable) -> Button:
	var button := Button.new()
	button.text = text
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.add_theme_font_override("font", ShellFonts.font("sans-serif", 400))
	button.add_theme_font_size_override("font_size", roundi(0.74 * REM))
	var normal := UI.box(Color(1, 1, 1, 0.08), Color(1, 1, 1, 0.18), 8, 1, Vector4(0.7 * REM, 0.28 * REM, 0.7 * REM, 0.28 * REM))
	var hover := UI.box(Color(1, 1, 1, 0.13), Color(1, 1, 1, 0.26), 8, 1, Vector4(0.7 * REM, 0.28 * REM, 0.7 * REM, 0.28 * REM))
	for state in ["normal", "focus", "disabled"]:
		button.add_theme_stylebox_override(state, normal)
	for state in ["hover", "pressed", "hover_pressed"]:
		button.add_theme_stylebox_override(state, hover)
	for state in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		button.add_theme_color_override(state, Color(1, 1, 1))
	button.pressed.connect(action)
	return button


func _render() -> void:
	for child in _flow.get_children():
		_flow.remove_child(child)
		child.queue_free()
	_panel.visible = not kinds.is_empty()
	if kinds.is_empty():
		return
	ShellNotices.place_top(_panel)
	var width := get_viewport_rect().size.x
	var limit := minf(42.0 * REM, width - 2.0 * REM)
	_panel.custom_minimum_size.x = 0.0
	var mark := ShellFonts.label("⏳", 0.8 * REM, ShellNotices.BLUE_MARK, "sans-serif", 800)
	mark.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_flow.add_child(mark)
	var lines := VBoxContainer.new()
	lines.add_theme_constant_override("separation", 0)
	lines.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	for kind in kinds:
		var line := ShellFonts.label(str(WAITING_TEXTS.get(str(kind), "")), 0.8 * REM, ShellNotices.BLUE_INK, "sans-serif", 400)
		line.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		ShellNotices.fit_text(line, maxf(14.0 * REM, limit - 1.7 * REM - 2.0 * 0.7 * REM - 2.0 * REM))
		lines.add_child(line)
	_flow.add_child(lines)
	var buttons := HBoxContainer.new()
	buttons.add_theme_constant_override("separation", roundi(0.35 * REM))
	buttons.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var chosen := kinds.duplicate()
	buttons.add_child(_button("Open the Agent folder", func() -> void: engine.request("shell.agent.open")))
	if can_pass_on:
		buttons.add_child(_button("Use API key", func() -> void: engine.request("shell.agent.passOn", {"kinds": chosen})))
	buttons.add_child(_button("Cancel", func() -> void: engine.request("shell.agent.cancel", {"kinds": chosen})))
	_flow.add_child(buttons)
	var natural := 0.0
	for child in _flow.get_children():
		natural += (child as Control).get_combined_minimum_size().x
	natural += 0.7 * REM * float(_flow.get_child_count() - 1)
	_panel.custom_minimum_size.x = minf(limit, natural + 1.7 * REM)
