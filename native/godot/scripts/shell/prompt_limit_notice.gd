class_name PromptLimitNotice
extends Control

const REM := 16.0
const ONE := "A prompt passage in this game is more than 20% longer than the built-in one, so the AI uses the built-in passage instead. Shorten it in the Prompts tab to use it."
const MANY := "Some prompt passages in this game are more than 20% longer than the built-in ones, so the AI uses the built-in passages instead. Shorten them in the Prompts tab to use them."

var engine: EngineLink
var entries: Array = []
var _panel: PanelContainer
var _words: Label
var _list: VBoxContainer


func _init() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_panel = ShellNotices.top_panel(Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.32), Vector4(0.8 * REM, 0.6 * REM, 0.8 * REM, 0.6 * REM))
	_panel.name = "PromptLimitNotice"
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", roundi(0.6 * REM))
	var mark := ShellFonts.label("!", 0.76 * REM, Color("#2bc1f3"), "sans-serif", 800)
	mark.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	row.add_child(mark)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", roundi(0.3 * REM))
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_words = ShellFonts.label(ONE, 0.76 * REM, Color("#e5e7eb"), "sans-serif", 400)
	_words.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	column.add_child(_words)
	_list = VBoxContainer.new()
	_list.add_theme_constant_override("separation", 0)
	column.add_child(_list)
	row.add_child(column)
	var dismiss := ShellNotices.dismiss_button()
	dismiss.pressed.connect(_dismiss)
	row.add_child(dismiss)
	_panel.add_child(row)
	add_child(_panel)
	_panel.visible = false
	resized.connect(_render)


func setup(link: EngineLink) -> void:
	engine = link
	if not engine.engine_event.is_connected(_on_event):
		engine.engine_event.connect(_on_event)


func pull() -> void:
	if engine == null:
		return
	var reply: Dictionary = await engine.request("shell.promptLimit")
	if reply.get("ok", false) and reply.get("result") is Dictionary:
		add_entries((reply["result"] as Dictionary).get("entries", []))


func _on_event(event_name: String, data: Variant) -> void:
	if event_name != "shell.promptLimit" or not (data is Dictionary):
		return
	add_entries((data as Dictionary).get("entries", []))


func add_entries(more: Array) -> void:
	var known := {}
	for entry in entries:
		known[str((entry as Dictionary).get("id", ""))] = true
	var added := false
	for entry in more:
		if entry is Dictionary and not known.has(str((entry as Dictionary).get("id", ""))):
			entries.append(entry)
			known[str((entry as Dictionary).get("id", ""))] = true
			added = true
	if added:
		_render()


func _dismiss() -> void:
	entries = []
	_render()


func _render() -> void:
	_panel.visible = not entries.is_empty()
	if not _panel.visible:
		return
	_words.text = ONE if entries.size() == 1 else MANY
	for child in _list.get_children():
		_list.remove_child(child)
		child.queue_free()
	for entry in entries:
		var line := ShellFonts.label("%s: %s" % [I18n.now(str((entry as Dictionary).get("sectionLabel", ""))), I18n.now(str((entry as Dictionary).get("segmentLabel", "")))], 0.76 * REM, Color(1, 1, 1, 0.62), "sans-serif", 400)
		line.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
		line.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		_list.add_child(line)
	ShellNotices.place_top(_panel)
	var width := get_viewport_rect().size.x
	var available := ShellNotices.text_room(width)
	ShellNotices.fit_text(_words, available)
	for child in _list.get_children():
		ShellNotices.fit_text(child as Label, available)
