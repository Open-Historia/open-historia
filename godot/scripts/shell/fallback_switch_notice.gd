class_name FallbackSwitchNotice
extends Control

const SHOW_SECONDS := 12.0
const REM := 16.0

var engine: EngineLink
var _panel: PanelContainer
var _rows: VBoxContainer
var _notices: Array[Dictionary] = []
var _next := 0


func _init() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_panel = ShellNotices.top_panel(ShellNotices.BLUE_EDGE, Vector4(0.8 * REM, 0.6 * REM, 0.8 * REM, 0.6 * REM))
	_rows = VBoxContainer.new()
	_rows.add_theme_constant_override("separation", roundi(0.6 * REM))
	_panel.add_child(_rows)
	_panel.visible = false
	add_child(_panel)
	resized.connect(_render)


func setup(link: EngineLink) -> void:
	engine = link
	if not engine.engine_event.is_connected(_on_event):
		engine.engine_event.connect(_on_event)


func _on_event(event_name: String, data: Variant) -> void:
	if event_name != "shell.fallbackSwitch" or not (data is Dictionary):
		return
	show_message(str((data as Dictionary).get("message", "")))


func show_message(text: String) -> void:
	var message := text.strip_edges()
	if message.is_empty():
		return
	_next += 1
	var id := _next
	var kept: Array[Dictionary] = []
	for notice in _notices:
		if str(notice["message"]) != message:
			kept.append(notice)
	kept.append({"id": id, "message": message})
	_notices = kept.slice(maxi(0, kept.size() - 3))
	get_tree().create_timer(SHOW_SECONDS).timeout.connect(func() -> void: _remove(id))
	_render()


func _remove(id: int) -> void:
	var kept: Array[Dictionary] = []
	for notice in _notices:
		if int(notice["id"]) != id:
			kept.append(notice)
	_notices = kept
	_render()


func _render() -> void:
	for child in _rows.get_children():
		_rows.remove_child(child)
		child.queue_free()
	_panel.visible = not _notices.is_empty()
	if _notices.is_empty():
		return
	ShellNotices.place_top(_panel)
	var width := get_viewport_rect().size.x
	var available := minf(34.0 * REM, width - 2.0 * REM) - 1.6 * REM - 2.0 * 0.6 * REM - 2.0 * REM
	for notice in _notices:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", roundi(0.6 * REM))
		var mark := ShellFonts.label("↓", 0.76 * REM, ShellNotices.BLUE_MARK, "sans-serif", 800)
		mark.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
		row.add_child(mark)
		var words := ShellFonts.label(str(notice["message"]), 0.76 * REM, ShellNotices.BLUE_INK, "sans-serif", 400)
		words.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		words.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		ShellNotices.fit_text(words, available)
		row.add_child(words)
		var dismiss := ShellNotices.dismiss_button()
		var id := int(notice["id"])
		dismiss.pressed.connect(func() -> void: _remove(id))
		row.add_child(dismiss)
		_rows.add_child(row)


func messages() -> PackedStringArray:
	var out: PackedStringArray = []
	for notice in _notices:
		out.append(str(notice["message"]))
	return out
