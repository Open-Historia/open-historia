class_name ShellNotices
extends Control

const REM := 16.0
const PANEL := Color(16 / 255.0, 21 / 255.0, 24 / 255.0, 0.96)
const BLUE_EDGE := Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.32)
const BLUE_INK := Color("#dbeafe")
const BLUE_MARK := Color("#93c5fd")

var engine: EngineLink
var borders: BordersFallbackNotice
var fallback: FallbackSwitchNotice
var agent: AgentWaitingNotice
var rating: GenerationRatingToast


func _init() -> void:
	name = "ShellNotices"
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	borders = BordersFallbackNotice.new()
	add_child(borders)
	fallback = FallbackSwitchNotice.new()
	add_child(fallback)
	agent = AgentWaitingNotice.new()
	add_child(agent)
	rating = GenerationRatingToast.new()
	add_child(rating)


func setup(link: EngineLink, _context: Dictionary = {}) -> void:
	engine = link
	fallback.setup(link)
	agent.setup(link)
	rating.setup(link)


func reset_for_game() -> void:
	borders.reset()


static func narrow() -> bool:
	var tree := Engine.get_main_loop() as SceneTree
	return tree != null and tree.root.get_visible_rect().size.x < 640.0


static func top_panel(edge: Color, inner: Vector4) -> PanelContainer:
	var panel := PanelContainer.new()
	panel.mouse_filter = Control.MOUSE_FILTER_STOP
	panel.add_theme_stylebox_override("panel", UI.box(PANEL, edge, 12, 1, inner))
	panel.anchor_left = 0.5
	panel.anchor_right = 0.5
	panel.anchor_top = 0.0
	panel.anchor_bottom = 0.0
	panel.grow_horizontal = Control.GROW_DIRECTION_BOTH
	panel.offset_top = 4.25 * REM
	panel.offset_bottom = 4.25 * REM
	return panel


static func place_top(panel: Control) -> void:
	var top := (4.75 if narrow() else 4.25) * REM
	panel.offset_top = top
	panel.offset_bottom = top
	panel.offset_left = 0.0
	panel.offset_right = 0.0


static func fit_text(label: Label, available: float) -> void:
	var font := label.get_theme_font("font")
	var size := label.get_theme_font_size("font_size")
	var natural := 0.0
	for line in label.text.split("\n"):
		natural = maxf(natural, font.get_string_size(TranslationServer.translate(line) if label.auto_translate_mode != Node.AUTO_TRANSLATE_MODE_DISABLED else line, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x)
	label.custom_minimum_size.x = minf(ceilf(natural) + 1.0, maxf(40.0, available))


static func dismiss_button() -> Button:
	var button := Button.new()
	button.text = "×"
	button.flat = true
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.tooltip_text = "Dismiss"
	button.add_theme_font_override("font", ShellFonts.font("sans-serif", 400))
	button.add_theme_font_size_override("font_size", roundi(0.9 * REM))
	for state in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
		button.add_theme_color_override(state, Color(1, 1, 1, 0.5))
	for state in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
		button.add_theme_stylebox_override(state, StyleBoxEmpty.new())
	button.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	if "accessibility_name" in button:
		button.set("accessibility_name", "Dismiss")
	return button
