class_name StorageProblemNotice
extends PanelContainer

signal retry

const REM := 16.0

var retrying := false
var _title: Label
var _detail: Label
var _button: Button
var _caption: Label
var _icon: TextureRect


func _init(title := "", detail := "", can_retry := true, retry_icon: Texture2D = null) -> void:
	var style := StyleBoxFlat.new()
	style.bg_color = Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.1)
	style.border_color = Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.35)
	style.border_width_bottom = 1
	style.content_margin_left = 0.85 * REM
	style.content_margin_right = 0.85 * REM
	style.content_margin_top = 0.5 * REM
	style.content_margin_bottom = 0.5 * REM
	add_theme_stylebox_override("panel", style)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", roundi(0.6 * REM))
	var words := VBoxContainer.new()
	words.add_theme_constant_override("separation", roundi(0.1 * REM))
	words.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	words.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_title = ShellFonts.label(title, 0.75 * REM, Color("#fecaca"), "Segoe UI", 700)
	_title.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	words.add_child(_title)
	_detail = ShellFonts.label(detail, 0.68 * REM, Color(254 / 255.0, 202 / 255.0, 202 / 255.0, 0.7), "Segoe UI", 400)
	_detail.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_detail.visible = not detail.is_empty()
	words.add_child(_detail)
	row.add_child(words)
	_button = Button.new()
	_button.focus_mode = Control.FOCUS_NONE
	_button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	_button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var normal := UI.box(Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.14), Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.4), 6, 1, Vector4(0.6 * REM, 0.3 * REM, 0.6 * REM, 0.3 * REM))
	var hover := UI.box(Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.2), Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.5), 6, 1, Vector4(0.6 * REM, 0.3 * REM, 0.6 * REM, 0.3 * REM))
	for state in ["normal", "focus", "disabled"]:
		_button.add_theme_stylebox_override(state, normal)
	for state in ["hover", "pressed", "hover_pressed"]:
		_button.add_theme_stylebox_override(state, hover)
	var inside := HBoxContainer.new()
	inside.add_theme_constant_override("separation", roundi(0.3 * REM))
	inside.alignment = BoxContainer.ALIGNMENT_CENTER
	inside.mouse_filter = Control.MOUSE_FILTER_IGNORE
	inside.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_icon = TextureRect.new()
	_icon.texture = retry_icon
	_icon.visible = retry_icon != null
	_icon.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
	_icon.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_icon.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	inside.add_child(_icon)
	_caption = ShellFonts.label("Retry", 0.7 * REM, Color(254 / 255.0, 202 / 255.0, 202 / 255.0, 0.95), "sans-serif", 600)
	_caption.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	inside.add_child(_caption)
	_button.add_child(inside)
	_button.pressed.connect(func() -> void:
		if not retrying:
			retry.emit())
	_button.visible = can_retry
	row.add_child(_button)
	add_child(row)
	_fit_button()


func _fit_button() -> void:
	var font := _caption.get_theme_font("font")
	var width := font.get_string_size(TranslationServer.translate(_caption.text), HORIZONTAL_ALIGNMENT_LEFT, -1, roundi(0.7 * REM)).x
	if _icon.visible and _icon.texture:
		width += _icon.texture.get_width() + 0.3 * REM
	_button.custom_minimum_size = Vector2(ceilf(width) + 1.2 * REM + 2.0, ceilf(0.7 * REM * 1.4) + 0.6 * REM)


func set_text(title: String, detail: String) -> void:
	_title.text = title
	_detail.text = detail
	_detail.visible = not detail.is_empty()


func set_retrying(value: bool) -> void:
	retrying = value
	_caption.text = "Retrying…" if value else "Retry"
	_button.disabled = value
	_button.mouse_default_cursor_shape = Control.CURSOR_ARROW if value else Control.CURSOR_POINTING_HAND
	_fit_button()


func _notification(what: int) -> void:
	if what == NOTIFICATION_TRANSLATION_CHANGED and _caption:
		_fit_button()
