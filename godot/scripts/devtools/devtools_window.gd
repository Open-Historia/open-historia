class_name DevToolsWindow
extends Window

signal session_ready(ok: bool)

const PANELS := [["elements", "Elements"], ["console", "Console"], ["network", "Network"], ["performance", "Performance"]]
const SINGLETONS := ["Engine", "OS", "Performance", "Time", "Input", "DisplayServer", "RenderingServer", "ProjectSettings", "ClassDB", "ResourceLoader"]

var controller: Node
var engine: EngineLink
var app: Node
var capture: DevToolsLog
var highlight: DevToolsHighlight
var elements: DevToolsElements
var console: DevToolsConsole
var network: DevToolsNetwork
var performance: DevToolsPerformance
var active := ""
var session := {}
var _key := ""
var _closing := false
var _tabs := {}
var _panels := {}
var _inspect: Button
var _counts: Label


func _init(owner_node: Node, link: EngineLink, host: Node, log_capture: DevToolsLog) -> void:
	controller = owner_node
	engine = link
	app = host
	capture = log_capture
	name = "DevToolsWindow"
	visible = false
	title = "DevTools - Open Historia"
	var usable := DisplayServer.screen_get_usable_rect(DisplayServer.window_get_current_screen()).size
	size = Vector2i(mini(1180, maxi(640, int(usable.x * 0.9))), mini(760, maxi(400, int(usable.y * 0.9))))
	min_size = Vector2i(640, 400)
	initial_position = Window.WINDOW_INITIAL_POSITION_CENTER_MAIN_WINDOW_SCREEN
	force_native = DisplayServer.has_feature(DisplayServer.FEATURE_SUBWINDOWS)
	transient = false
	exclusive = false
	wrap_controls = false
	process_mode = Node.PROCESS_MODE_ALWAYS
	theme = DevToolsStyle.theme()


func _ready() -> void:
	var back := ColorRect.new()
	back.color = DevToolsStyle.BG
	back.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	back.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(back)
	var column := VBoxContainer.new()
	column.name = "Layout"
	column.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	column.add_theme_constant_override("separation", 0)
	add_child(column)
	column.add_child(_build_top())
	var body := Control.new()
	body.name = "Panels"
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	column.add_child(body)
	highlight = DevToolsHighlight.new()
	controller.add_child(highlight)
	highlight.picked.connect(func(node: Node) -> void:
		show_panel("elements")
		elements.select_node(node)
		grab_focus())
	highlight.picking_changed.connect(func(on: bool) -> void: _inspect.set_pressed_no_signal(on))
	elements = DevToolsElements.new(self)
	console = DevToolsConsole.new(self)
	network = DevToolsNetwork.new(self)
	performance = DevToolsPerformance.new(self)
	for panel in [elements, console, network, performance]:
		var control := panel as Control
		control.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		control.visible = false
		body.add_child(control)
	_panels = {"elements": elements, "console": console, "network": network, "performance": performance}
	elements.node_selected.connect(console.node_selected)
	console.counts_changed.connect(_show_counts)
	console.add_godot(capture.attach(console.add_godot))
	for line in engine.recent_diagnostics(400).split("\n", false):
		console.add_sidecar(line)
	engine.devtools = self
	engine.engine_event.connect(_on_engine_event)
	show_panel("elements")
	elements.start()
	_open_session()


func _build_top() -> Control:
	var top := PanelContainer.new()
	var style := UI.box(DevToolsStyle.BAR, Color(0, 0, 0, 0), 0, 0, Vector4(4, 0, 8, 0))
	style.border_color = DevToolsStyle.LINE_STRONG
	style.border_width_bottom = 1
	top.add_theme_stylebox_override("panel", style)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 0)
	_inspect = DevToolsStyle.button("⬚ Inspect", "Select an element in the game to inspect it (Ctrl+Shift+C)", true)
	_inspect.add_theme_stylebox_override("normal", UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 4, 0, Vector4(9, 6, 9, 6)))
	_inspect.toggled.connect(func(on: bool) -> void: highlight.set_picking(on))
	row.add_child(_inspect)
	var gap := DevToolsStyle.divider()
	row.add_child(gap)
	for panel in PANELS:
		var key: String = panel[0]
		var tab := DevToolsStyle.button(panel[1], "", true)
		tab.name = "Tab_" + key
		var off := UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 0, Vector4(12, 7, 12, 6))
		var hover := UI.box(DevToolsStyle.HOVER, Color(0, 0, 0, 0), 0, 0, Vector4(12, 7, 12, 6))
		var on := off.duplicate() as StyleBoxFlat
		on.border_color = DevToolsStyle.ACCENT
		on.border_width_bottom = 2
		tab.add_theme_stylebox_override("normal", off)
		tab.add_theme_stylebox_override("hover", hover)
		tab.add_theme_stylebox_override("pressed", on)
		tab.add_theme_stylebox_override("hover_pressed", on)
		tab.add_theme_color_override("font_color", DevToolsStyle.MUTED)
		tab.add_theme_color_override("font_hover_color", DevToolsStyle.INK)
		tab.add_theme_color_override("font_pressed_color", DevToolsStyle.INK)
		tab.add_theme_color_override("font_hover_pressed_color", DevToolsStyle.INK)
		tab.pressed.connect(func() -> void: show_panel(key))
		_tabs[key] = tab
		row.add_child(tab)
	row.add_child(UI.spacer())
	_counts = DevToolsStyle.text("", 11, DevToolsStyle.MUTED, 600)
	_counts.mouse_filter = Control.MOUSE_FILTER_STOP
	_counts.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	_counts.tooltip_text = "Open the console"
	_counts.gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventMouseButton and (event as InputEventMouseButton).pressed:
			show_panel("console"))
	row.add_child(_counts)
	top.add_child(row)
	return top


func show_panel(key: String) -> void:
	if not _panels.has(key):
		return
	active = key
	for name_key in _panels:
		(_panels[name_key] as Control).visible = name_key == key
		(_tabs[name_key] as Button).set_pressed_no_signal(name_key == key)
	if key == "console":
		console.prompt.grab_focus.call_deferred()


func panel_keys() -> Array:
	return _panels.keys()


func _show_counts(warnings: int, errors: int) -> void:
	var parts := PackedStringArray()
	if errors > 0:
		parts.append("%d error%s" % [errors, "" if errors == 1 else "s"])
	if warnings > 0:
		parts.append("%d warning%s" % [warnings, "" if warnings == 1 else "s"])
	_counts.text = "  ·  ".join(parts)
	_counts.add_theme_color_override("font_color", DevToolsStyle.ERROR if errors > 0 else DevToolsStyle.WARN)


func owns(node: Node) -> bool:
	if node == null:
		return false
	if node == self or is_ancestor_of(node):
		return true
	return highlight != null and (node == highlight or highlight.is_ancestor_of(node))


func _open_session() -> void:
	if not engine.is_ready():
		await engine.engine_ready
	if _closing:
		return
	var reply := await engine.devtools_request(self, "devtools.open")
	if _closing:
		if reply.get("ok", false):
			engine.devtools_request(self, "devtools.close", {"key": str((reply["result"] as Dictionary).get("key", ""))})
		return
	if not reply.get("ok", false) or not (reply.get("result") is Dictionary):
		console.add("sidecar", "error", "The developer tools could not attach to the sidecar: %s" % str(reply.get("error", "")))
		session_ready.emit(false)
		return
	session = reply["result"]
	_key = str(session.get("key", ""))
	network.set_origin(str(session.get("origin", "")))
	console.add_engine(session.get("backlog", []))
	console.add("sidecar", "info", "Attached to the sidecar: Node %s on %s, process %d." % [session.get("node", ""), session.get("platform", ""), int(session.get("pid", 0))])
	session_ready.emit(true)


func is_attached() -> bool:
	return not _key.is_empty()


func request(method: String, args: Dictionary = {}) -> Dictionary:
	if _key.is_empty() or _closing:
		return {"ok": false, "error": "The developer tools are not attached to the sidecar yet."}
	var sent := args.duplicate()
	sent["key"] = _key
	return await engine.devtools_request(self, method, sent)


func evaluate_js(code: String) -> Dictionary:
	var reply := await request("devtools.eval", {"code": code})
	if not reply.get("ok", false):
		return {"ok": false, "text": str(reply.get("error", "The sidecar did not answer."))}
	var result: Dictionary = reply["result"] if reply.get("result") is Dictionary else {}
	return {"ok": bool(result.get("ok", false)), "text": str(result.get("text", "")), "type": str(result.get("type", ""))}


func evaluate_expression(code: String, target: Node) -> Dictionary:
	var names := PackedStringArray(["selected", "main", "root", "tree", "engine"])
	var values: Array = [elements.selected_node(), app, get_tree().root, get_tree(), engine]
	for singleton in SINGLETONS:
		names.append(singleton)
		values.append(Engine.get_singleton(singleton))
	var expression := Expression.new()
	if expression.parse(code, names) != OK:
		return {"ok": false, "text": "Parse error: " + expression.get_error_text()}
	var value: Variant = expression.execute(values, target, false, false)
	if expression.has_execute_failed():
		return {"ok": false, "text": expression.get_error_text() if not expression.get_error_text().is_empty() else "The expression failed."}
	return {"ok": true, "text": describe(value), "value": value}


static func describe(value: Variant) -> String:
	match typeof(value):
		TYPE_OBJECT:
			var object: Object = value
			if object == null or not is_instance_valid(object):
				return "null"
			return "%s #%d" % [DevToolsElements.show_value(object), object.get_instance_id()]
		TYPE_STRING, TYPE_STRING_NAME:
			return JSON.stringify(str(value))
		TYPE_ARRAY, TYPE_DICTIONARY:
			var text := str(value)
			return text.substr(0, 20000) + " …" if text.length() > 20000 else text
	return var_to_str(value)


func link_request(id: int, method: String, args: Dictionary, size: int) -> void:
	network.on_request(id, method, args, size)


func link_reply(id: int, reply: Dictionary, size: int) -> void:
	network.on_reply(id, reply, size)


func link_event(event_name: String, data: Variant, size: int) -> void:
	network.on_event(event_name, data, size)


func link_diagnostic(line: String) -> void:
	console.add_sidecar(line)


func _on_engine_event(event_name: String, data: Variant) -> void:
	if not (data is Dictionary):
		return
	if event_name == "devtools.log":
		console.add_engine((data as Dictionary).get("entries", []))
	elif event_name == "devtools.http":
		network.on_http(data)


func _input(event: InputEvent) -> void:
	if not (event is InputEventKey) or not (event as InputEventKey).pressed or (event as InputEventKey).echo:
		return
	var key := event as InputEventKey
	if Hotkeys.devtools_chord(key):
		set_input_as_handled()
		controller.call("close")
		return
	if not key.is_command_or_control_pressed() or key.alt_pressed:
		return
	if key.keycode == KEY_C and key.shift_pressed:
		set_input_as_handled()
		highlight.set_picking(not highlight.picking)
	elif key.keycode == KEY_BRACKETLEFT or key.keycode == KEY_BRACKETRIGHT:
		set_input_as_handled()
		var keys := _panels.keys()
		var at := keys.find(active)
		show_panel(keys[posmod(at + (1 if key.keycode == KEY_BRACKETRIGHT else -1), keys.size())])
	elif key.keycode == KEY_L and not key.shift_pressed and active == "console":
		set_input_as_handled()
		console.clear()


func shutdown() -> void:
	if _closing:
		return
	_closing = true
	if not _key.is_empty():
		engine.devtools_request(self, "devtools.close", {"key": _key})
	if engine.devtools == self:
		engine.devtools = null
	if engine.engine_event.is_connected(_on_engine_event):
		engine.engine_event.disconnect(_on_engine_event)
	capture.detach()
	elements.stop()
	performance.stop()
	if highlight and is_instance_valid(highlight):
		highlight.set_picking(false)
		highlight.queue_free()
	highlight = null
	_key = ""
