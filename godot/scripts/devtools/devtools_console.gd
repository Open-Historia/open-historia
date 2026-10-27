class_name DevToolsConsole
extends VBoxContainer

signal counts_changed(warnings: int, errors: int)

const KEEP := 3000
const TARGET_SELECTED := 0
const TARGET_MAIN := 1
const TARGET_ROOT := 2
const TARGET_JS := 3
const SOURCE_INK := {"godot": Color("#7cd3f5"), "sidecar": Color("#a3e3b5"), "engine": Color("#f0c27a"), "eval": Color(1, 1, 1, 0.4)}

var host: DevToolsWindow
var output: RichTextLabel
var filter_field: LineEdit
var prompt: LineEdit
var target: OptionButton
var hidden_label: Label
var context_label: Label
var warnings := 0
var errors := 0
var _entries: Array = []
var _levels := {"verbose": false, "info": true, "warning": true, "error": true}
var _sources := {"godot": true, "sidecar": true, "engine": true}
var _filter := ""
var _pattern: RegEx
var _history: PackedStringArray = []
var _history_at := -1
var _seq := 0
var _shown := 0


func _init(window: DevToolsWindow) -> void:
	host = window
	name = "Console"
	add_theme_constant_override("separation", 0)
	add_child(_build_toolbar())
	output = RichTextLabel.new()
	output.name = "Output"
	output.bbcode_enabled = true
	output.scroll_following = true
	output.selection_enabled = true
	output.context_menu_enabled = true
	output.size_flags_vertical = Control.SIZE_EXPAND_FILL
	output.add_theme_constant_override("line_separation", 3)
	var pad := MarginContainer.new()
	pad.size_flags_vertical = Control.SIZE_EXPAND_FILL
	for side in ["left", "right"]:
		pad.add_theme_constant_override("margin_" + side, 8)
	pad.add_theme_constant_override("margin_top", 4)
	pad.add_child(output)
	add_child(pad)
	add_child(_build_prompt())


func _build_toolbar() -> Control:
	var top := DevToolsStyle.bar()
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	var clear_button := DevToolsStyle.button("Clear", "Clear the console (Ctrl+L)")
	clear_button.pressed.connect(clear)
	row.add_child(clear_button)
	row.add_child(DevToolsStyle.divider())
	target = OptionButton.new()
	target.focus_mode = Control.FOCUS_NONE
	target.tooltip_text = "Where the prompt runs"
	target.add_item("Godot · selected node", TARGET_SELECTED)
	target.add_item("Godot · main", TARGET_MAIN)
	target.add_item("Godot · root", TARGET_ROOT)
	target.add_item("Sidecar · JavaScript", TARGET_JS)
	target.item_selected.connect(func(_index: int) -> void: _update_context())
	row.add_child(target)
	filter_field = DevToolsStyle.field("Filter (text or /regex/)")
	filter_field.custom_minimum_size.x = 200
	filter_field.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	filter_field.text_changed.connect(func(text: String) -> void: set_filter(text))
	row.add_child(filter_field)
	for level in [["verbose", "Verbose"], ["info", "Info"], ["warning", "Warnings"], ["error", "Errors"]]:
		var chip := DevToolsStyle.chip(level[1], "Show %s messages" % String(level[1]).to_lower(), _levels[level[0]])
		var key: String = level[0]
		chip.toggled.connect(func(on: bool) -> void:
			_levels[key] = on
			render())
		row.add_child(chip)
	row.add_child(DevToolsStyle.divider())
	for source in [["godot", "Godot"], ["sidecar", "Sidecar"], ["engine", "Engine log"]]:
		var chip := DevToolsStyle.chip(source[1], "Show lines from %s" % String(source[1]).to_lower(), true)
		var key: String = source[0]
		chip.toggled.connect(func(on: bool) -> void:
			_sources[key] = on
			render())
		row.add_child(chip)
	hidden_label = DevToolsStyle.text("", 11, DevToolsStyle.FAINT)
	row.add_child(hidden_label)
	top.add_child(row)
	return top


func _build_prompt() -> Control:
	var holder := PanelContainer.new()
	var style := UI.box(DevToolsStyle.BG, Color(0, 0, 0, 0), 0, 0, Vector4(8, 4, 8, 5))
	style.border_color = DevToolsStyle.LINE
	style.border_width_top = 1
	holder.add_theme_stylebox_override("panel", style)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 2)
	context_label = DevToolsStyle.text("", 10, DevToolsStyle.FAINT, 400, true)
	column.add_child(context_label)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	var mark := DevToolsStyle.text("›", 15, DevToolsStyle.ACCENT, 700, true)
	row.add_child(mark)
	prompt = DevToolsStyle.field("Type an expression and press Enter", true)
	prompt.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var quiet := UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 0, Vector4(2, 3, 2, 3))
	prompt.add_theme_stylebox_override("normal", quiet)
	prompt.add_theme_stylebox_override("focus", quiet)
	prompt.keep_editing_on_text_submit = true
	prompt.text_submitted.connect(func(text: String) -> void:
		prompt.text = ""
		evaluate(text))
	prompt.gui_input.connect(_on_prompt_key)
	row.add_child(prompt)
	column.add_child(row)
	holder.add_child(column)
	_update_context()
	return holder


func _on_prompt_key(event: InputEvent) -> void:
	if not (event is InputEventKey) or not (event as InputEventKey).pressed:
		return
	var key := event as InputEventKey
	if _history.is_empty() or not (key.keycode in [KEY_UP, KEY_DOWN]):
		return
	if key.keycode == KEY_UP:
		_history_at = _history.size() - 1 if _history_at < 0 else maxi(0, _history_at - 1)
	else:
		_history_at = -1 if _history_at < 0 or _history_at >= _history.size() - 1 else _history_at + 1
	prompt.text = _history[_history_at] if _history_at >= 0 else ""
	prompt.caret_column = prompt.text.length()
	prompt.accept_event()


func context_node() -> Node:
	match target.get_selected_id():
		TARGET_MAIN:
			return host.app
		TARGET_ROOT:
			return get_tree().root
		TARGET_SELECTED:
			var picked := host.elements.selected_node() if host.elements else null
			return picked if picked else host.app
	return null


func use_target(id: int) -> void:
	target.select(target.get_item_index(id))
	_update_context()


func _update_context() -> void:
	if context_label == null:
		return
	if target.get_selected_id() == TARGET_JS:
		context_label.text = "JavaScript in the sidecar · engine, api, storage, gameView, mapState and $_ are in scope"
		return
	var node := context_node()
	context_label.text = "Expression on %s · selected, main, root, tree, engine and the engine singletons are in scope" % (str(node.get_path()) if node and node.is_inside_tree() else "nothing")


func node_selected(_node: Node) -> void:
	_update_context()


func add(source: String, level: String, text: String, at := -1.0) -> void:
	_seq += 1
	var entry := {"seq": _seq, "at": at if at >= 0.0 else Time.get_unix_time_from_system(), "source": source, "level": level, "text": text}
	_entries.append(entry)
	if level == "warning":
		warnings += 1
	elif level == "error":
		errors += 1
	if _entries.size() > KEEP + 300:
		_entries = _entries.slice(_entries.size() - KEEP)
		render()
	elif _passes(entry):
		_append(entry)
	else:
		_update_hidden()
	if level in ["warning", "error"]:
		counts_changed.emit(warnings, errors)


func add_godot(fresh: Array) -> void:
	for entry in fresh:
		add("godot", str(entry["level"]), str(entry["text"]), float(entry["at"]))


func add_sidecar(line: String) -> void:
	add("sidecar", sidecar_level(line), line)


func add_engine(entries: Array) -> void:
	for raw in entries:
		if not (raw is Dictionary):
			continue
		var entry: Dictionary = raw
		var category := str(entry.get("category", ""))
		var text := "[%s] %s" % [category, str(entry.get("message", ""))]
		var detail := str(entry.get("detail", ""))
		if not detail.is_empty():
			text += " — " + detail
		add("engine", engine_level(category, bool(entry.get("problem", false))), text, _iso_seconds(str(entry.get("at", ""))))


static func sidecar_level(line: String) -> String:
	var lower := line.to_lower()
	if lower.contains("error") or lower.contains("uncaught") or lower.contains("exception") or lower.contains("fatal"):
		return "error"
	if lower.contains("warn") or lower.contains("deprecat"):
		return "warning"
	return "info"


static func engine_level(category: String, problem: bool) -> String:
	if category in ["error", "crash"]:
		return "error"
	if category == "warn" or problem:
		return "warning"
	if category == "log":
		return "verbose"
	return "info"


static func _iso_seconds(iso: String) -> float:
	if iso.is_empty():
		return Time.get_unix_time_from_system()
	var trimmed := iso.trim_suffix("Z")
	var millis := 0.0
	var dot := trimmed.find(".")
	if dot >= 0:
		millis = ("0" + trimmed.substr(dot)).to_float()
		trimmed = trimmed.substr(0, dot)
	return float(Time.get_unix_time_from_datetime_string(trimmed)) + millis


func clear() -> void:
	_entries.clear()
	warnings = 0
	errors = 0
	render()
	counts_changed.emit(0, 0)


func set_filter(text: String) -> void:
	_filter = text.strip_edges()
	_pattern = null
	if _filter.length() > 2 and _filter.begins_with("/") and _filter.ends_with("/"):
		_pattern = RegEx.create_from_string(_filter.substr(1, _filter.length() - 2))
		if _pattern and not _pattern.is_valid():
			_pattern = null
	render()


func _passes(entry: Dictionary) -> bool:
	var level := str(entry["level"])
	var source := str(entry["source"])
	if level in ["input", "result", "failure"]:
		return true
	if not bool(_levels.get(level, true)) or not bool(_sources.get(source, true)):
		return false
	if _filter.is_empty():
		return true
	if _pattern:
		return _pattern.search(str(entry["text"])) != null
	return str(entry["text"]).containsn(_filter)


func render() -> void:
	var lines := PackedStringArray()
	for entry in _entries:
		if _passes(entry):
			lines.append(_line(entry))
	_shown = lines.size()
	output.text = "\n".join(lines)
	_update_hidden()


func _append(entry: Dictionary) -> void:
	output.append_text(("\n" if _shown > 0 else "") + _line(entry))
	_shown += 1


func _update_hidden() -> void:
	var hidden := _entries.size() - _shown
	hidden_label.text = "%d hidden" % hidden if hidden > 0 else ""


func _line(entry: Dictionary) -> String:
	var level := str(entry["level"])
	var source := str(entry["source"])
	var text := DevToolsStyle.escape(str(entry["text"]))
	var stamp := "[color=#%s]%s[/color] " % [DevToolsStyle.FAINT.to_html(), DevToolsStyle.clock(float(entry["at"]))]
	if level == "input":
		return stamp + "[color=#%s]›[/color] %s" % [DevToolsStyle.ACCENT.to_html(false), text]
	if level == "result":
		return stamp + "[color=#%s]‹[/color] [color=#%s]%s[/color]" % [DevToolsStyle.FAINT.to_html(), DevToolsStyle.NUMBER.to_html(false), text]
	if level == "failure":
		return stamp + "[color=#%s]‹ %s[/color]" % [DevToolsStyle.ERROR.to_html(false), text]
	var ink: Color = SOURCE_INK.get(source, DevToolsStyle.MUTED)
	var tag := "[color=#%s]%s[/color] " % [ink.to_html(false), source.rpad(7)]
	match level:
		"error":
			return stamp + tag + "[color=#%s]%s[/color]" % [DevToolsStyle.ERROR.to_html(false), text]
		"warning":
			return stamp + tag + "[color=#%s]%s[/color]" % [DevToolsStyle.WARN.to_html(false), text]
		"verbose":
			return stamp + tag + "[color=#%s]%s[/color]" % [DevToolsStyle.MUTED.to_html(), text]
	return stamp + tag + text


func lines() -> PackedStringArray:
	var out := PackedStringArray()
	for entry in _entries:
		out.append("%s %s %s" % [entry["source"], entry["level"], entry["text"]])
	return out


func evaluate(code: String) -> Dictionary:
	var source := code.strip_edges()
	if source.is_empty():
		return {}
	if _history.is_empty() or _history[_history.size() - 1] != source:
		_history.append(source)
	_history_at = -1
	add("eval", "input", source)
	var result: Dictionary
	if target.get_selected_id() == TARGET_JS:
		result = await host.evaluate_js(source)
	else:
		result = host.evaluate_expression(source, context_node())
	add("eval", "result" if bool(result.get("ok", false)) else "failure", str(result.get("text", "")))
	return result
