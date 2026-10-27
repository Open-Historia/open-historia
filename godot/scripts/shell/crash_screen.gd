class_name CrashScreen
extends Control

signal reload_requested

const SERIF := "Georgia, 'EB Garamond', serif"
const MONO := "ui-monospace, SFMono-Regular, Menlo, monospace"
const COPY_IDLE := "📋 Copy crash details"

var _detail_holder: PanelContainer
var _detail: Label
var _copy: Button
var _report := ""
var _reset_timer: SceneTreeTimer


func _init() -> void:
	name = "CrashScreen"
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	visible = false
	var ground := ColorRect.new()
	ground.color = Color("#050403")
	ground.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	ground.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(ground)
	var centre := CenterContainer.new()
	centre.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	centre.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(centre)
	var card := VBoxContainer.new()
	card.custom_minimum_size.x = 30.0 * 16.0
	card.add_theme_constant_override("separation", 16)
	centre.add_child(card)
	var title := ShellFonts.label("Something went wrong", 1.8 * 16.0, Color("#f0cc40"), SERIF, 700, false, 0.04)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	card.add_child(title)
	var body := ShellFonts.label("The world view hit an unexpected error and had to stop. Your saved games are safe — reloading usually recovers.", 0.95 * 16.0, Color(215 / 255.0, 190 / 255.0, 140 / 255.0, 0.85), SERIF, 400)
	body.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	body.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	body.custom_minimum_size.x = 30.0 * 16.0
	body.add_theme_constant_override("line_spacing", 5)
	card.add_child(body)
	_detail_holder = PanelContainer.new()
	_detail_holder.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.04), Color(210 / 255.0, 165 / 255.0, 55 / 255.0, 0.25), 6, 1, Vector4(12, 9.6, 12, 9.6)))
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.custom_minimum_size.y = 0
	_detail = ShellFonts.label("", 0.75 * 16.0, Color(230 / 255.0, 185 / 255.0, 120 / 255.0, 0.7), MONO, 400)
	_detail.autowrap_mode = TextServer.AUTOWRAP_ARBITRARY
	_detail.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(_detail)
	_detail_holder.add_child(scroll)
	_detail_holder.set_meta("scroll", scroll)
	card.add_child(_detail_holder)
	var actions := HBoxContainer.new()
	actions.alignment = BoxContainer.ALIGNMENT_CENTER
	actions.add_theme_constant_override("separation", 10)
	var spaced := MarginContainer.new()
	spaced.add_theme_constant_override("margin_top", 6)
	spaced.add_child(actions)
	card.add_child(spaced)
	var reload := _button("Reload", Color("#050403"), Color("#e8c040"), Color(0, 0, 0, 0), 0.9, 600, Vector4(25.6, 9.6, 25.6, 9.6), 0.08)
	reload.pressed.connect(func() -> void: reload_requested.emit())
	actions.add_child(reload)
	_copy = _button(COPY_IDLE, Color("#f2e8cc"), Color(1, 1, 1, 0.06), Color(210 / 255.0, 165 / 255.0, 55 / 255.0, 0.4), 0.85, 600, Vector4(17.6, 9.6, 17.6, 9.6), 0.0)
	_copy.tooltip_text = "Copies this crash's details. Diagnostics logging is off — turn it on in Settings → Diagnostics to save the full log instead."
	_copy.pressed.connect(_copy_report)
	actions.add_child(_copy)


func _button(text: String, ink: Color, bg: Color, border: Color, size_rem: float, weight: int, padding: Vector4, spacing_em: float) -> Button:
	var button := Button.new()
	button.text = text
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var normal := UI.box(bg, border, 6, 1 if border.a > 0.0 else 0, padding)
	var hover := UI.box(bg.lightened(0.08) if bg.a > 0.5 else Color(bg.r, bg.g, bg.b, minf(1.0, bg.a + 0.05)), border, 6, 1 if border.a > 0.0 else 0, padding)
	for state in ["normal", "focus", "disabled"]:
		button.add_theme_stylebox_override(state, normal)
	for state in ["hover", "pressed", "hover_pressed"]:
		button.add_theme_stylebox_override(state, hover)
	button.add_theme_font_override("font", ShellFonts.font("Segoe UI", weight, false, spacing_em * size_rem * 16.0))
	button.add_theme_font_size_override("font_size", roundi(size_rem * 16.0))
	for state in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color", "font_disabled_color"]:
		button.add_theme_color_override(state, ink)
	return button


func show_crash(message: String, report: String) -> void:
	_report = report if not report.strip_edges().is_empty() else message
	_detail.text = message
	_detail_holder.visible = not message.strip_edges().is_empty()
	var scroll := _detail_holder.get_meta("scroll") as ScrollContainer
	scroll.custom_minimum_size.y = minf(8.0 * 16.0, _detail.get_combined_minimum_size().y + 2.0)
	_copy.text = COPY_IDLE
	_copy.disabled = false
	visible = true
	move_to_front()


func is_shown() -> bool:
	return visible


func _copy_report() -> void:
	_copy.disabled = true
	_copy.text = "Copying…"
	var text := "Open Historia crash report\n%s\n\n%s" % [Time.get_datetime_string_from_system(true), _report]
	DisplayServer.clipboard_set(text)
	_copy.text = "✓ Copied!" if DisplayServer.clipboard_get() == text else "Couldn't copy — try again"
	_copy.disabled = false
	_reset_timer = get_tree().create_timer(3.0)
	var timer := _reset_timer
	timer.timeout.connect(func() -> void:
		if timer == _reset_timer and is_instance_valid(_copy):
			_copy.text = COPY_IDLE)
