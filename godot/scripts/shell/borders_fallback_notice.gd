class_name BordersFallbackNotice
extends Control

const REM := 16.0
const TEXT := "Borders and labels could not be drawn in full on this device, so the map shows a simpler version."

var failed := false
var dismissed := false
var _panel: PanelContainer
var _words: Label


func _init() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_panel = ShellNotices.top_panel(Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.32), Vector4(0.8 * REM, 0.6 * REM, 0.8 * REM, 0.6 * REM))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", roundi(0.6 * REM))
	var mark := ShellFonts.label("!", 0.76 * REM, Color("#2bc1f3"), "sans-serif", 800)
	mark.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	row.add_child(mark)
	_words = ShellFonts.label(TEXT, 0.76 * REM, Color("#e5e7eb"), "sans-serif", 400)
	_words.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_words.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(_words)
	var dismiss := ShellNotices.dismiss_button()
	dismiss.pressed.connect(func() -> void:
		dismissed = true
		_render())
	row.add_child(dismiss)
	_panel.add_child(row)
	add_child(_panel)
	_panel.visible = false
	resized.connect(_render)


func show_notice() -> void:
	failed = true
	_render()


func reset() -> void:
	failed = false
	dismissed = false
	_render()


func _render() -> void:
	_panel.visible = failed and not dismissed
	if not _panel.visible:
		return
	ShellNotices.place_top(_panel)
	var width := get_viewport_rect().size.x
	ShellNotices.fit_text(_words, minf(34.0 * REM, width - 2.0 * REM) - 1.6 * REM - 2.0 * 0.6 * REM - 2.0 * REM)
