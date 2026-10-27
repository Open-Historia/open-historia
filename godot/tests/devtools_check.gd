extends SceneTree

class Probe extends RefCounted:
	func link_request(_id: int, _method: String, _args: Dictionary, _size: int) -> void:
		pass

	func link_reply(_id: int, _reply: Dictionary, _size: int) -> void:
		pass

	func link_event(_name: String, _data: Variant, _size: int) -> void:
		pass

	func link_diagnostic(_line: String) -> void:
		pass

var main: Node
var shots := ""
var started := 0
var failures: PackedStringArray = []


func _initialize() -> void:
	shots = OS.get_environment("OH_SHOTS")
	started = Time.get_ticks_msec()
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.mouse_passthrough = true
	root.add_child(main)
	_run.call_deferred()


func _say(text: String) -> void:
	print("[devtools %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _check(label: String, ok: bool, detail := "") -> void:
	_say("%s %s%s" % ["ok  " if ok else "FAIL", label, ("  (" + detail + ")") if not detail.is_empty() else ""])
	if not ok:
		failures.append(label)


func _wait(seconds: float) -> void:
	await create_timer(seconds).timeout


func _frames(count: int) -> void:
	for i in range(count):
		await process_frame


func _until(condition: Callable, seconds: float) -> bool:
	var deadline := Time.get_ticks_msec() + int(seconds * 1000.0)
	while Time.get_ticks_msec() < deadline:
		if condition.call():
			return true
		await process_frame
	return bool(condition.call())


func _clear_shell() -> void:
	var shell: ShellBoot = main.get("shell") as ShellBoot
	if shell == null:
		return
	await _until(func() -> bool: return shell.door_state != "deciding", 30.0)
	if shell.door != null and is_instance_valid(shell.door):
		shell.door.opened.emit()
		_say("vault door opened for the test")
	if not shell.notice_updates.is_empty():
		await _until(func() -> bool: return shell.notice != null and is_instance_valid(shell.notice), 5.0)
		await _frames(5)
	if shell.notice != null and is_instance_valid(shell.notice):
		shell.notice.closed.emit()
		_say("update notice closed for the test")
	await _frames(3)


func _chord(window_id: int) -> void:
	var press := InputEventKey.new()
	press.keycode = KEY_I
	press.physical_keycode = KEY_I
	press.window_id = window_id
	if OS.get_name() == "macOS":
		press.meta_pressed = true
		press.alt_pressed = true
	else:
		press.ctrl_pressed = true
		press.shift_pressed = true
	press.pressed = true
	Input.parse_input_event(press)
	await _frames(2)
	var release := press.duplicate() as InputEventKey
	release.pressed = false
	Input.parse_input_event(release)
	await _frames(3)


func _shoot(viewport: Viewport, name: String) -> void:
	await _frames(4)
	await RenderingServer.frame_post_draw
	if shots.is_empty() or viewport == null:
		return
	viewport.get_texture().get_image().save_png(shots.path_join(name + ".png"))
	_say("screenshot " + name)


func _has_line(console: DevToolsConsole, needle: String, source: String) -> bool:
	for line in console.lines():
		if line.begins_with(source + " ") and line.contains(needle):
			return true
	return false


func _entry(network: DevToolsNetwork, kind: String, needle: String) -> Dictionary:
	for entry in network.entries():
		if str(entry["kind"]) == kind and (str(entry["name"]).contains(needle) or str(entry.get("url", "")).contains(needle)):
			return entry
	return {}


func _run() -> void:
	while not main.menu.visible:
		if Time.get_ticks_msec() - started > 90000:
			_say("FAIL the menu never appeared")
			_finish(1)
			return
		await process_frame
	await _clear_shell()
	await main._start_scenario("default")
	main.picker._choose("France")
	await main._on_country_chosen("France", "medium")
	await _wait(2.0)
	var engine: EngineLink = main.engine
	var hud: Hud = main.hud
	var tools: DevTools = main.get("devtools") as DevTools
	_check("the app mounts the developer tools", tools != null and tools.get_parent() == main)
	if tools == null:
		_finish(1)
		return
	tools.focus_on_open = false
	var outside := await engine.request("devtools.eval", {"key": "x", "code": "1"})
	_check("game code cannot reach the JavaScript evaluator", not outside.get("ok", false), str(outside.get("error", "")))
	var stranger := await engine.devtools_request(Probe.new(), "devtools.eval", {"key": "x", "code": "1"})
	_check("nothing but the open window can reach it", not stranger.get("ok", false), str(stranger.get("error", "")))
	_check("closed tools hold no window and no tap", not tools.is_open() and engine.devtools == null and tools.get_child_count() == 0)

	await _chord(0)
	_check("Ctrl+Shift+I opens the developer tools", tools.is_open())
	if not tools.is_open():
		_finish(1)
		return
	var window: DevToolsWindow = tools.window
	window.mouse_passthrough = true
	_check("it is a window of its own titled like Chromium's", window.title == "DevTools - Open Historia" and not window.is_embedded(), "%s, embedded %s" % [window.title, window.is_embedded()])
	await _until(func() -> bool: return window.is_attached(), 20.0)
	_check("it attaches to the sidecar", window.is_attached())

	var elements := window.elements
	var hits := elements.find("Hud")
	_check("Elements finds the HUD by its class", hits.has(hud), "%d found" % hits.size())
	_check("the search shows the HUD in the tree", elements._items.has(hud.get_instance_id()))
	_check("selecting the HUD reveals it", elements.select_node(hud) and elements.selected_node() == hud and elements._items.has(hud.get_instance_id()))
	_check("the HUD is outlined in the game window", window.highlight.target_id == hud.get_instance_id() and DevToolsHighlight.outline(hud).size() == 4)
	await _shoot(window, "dt-elements")
	await _shoot(root, "dt-game-outline")
	var before := hud.modulate
	_check("the modulate row takes an edit", elements.edit("modulate", "#ffffffb3"))
	await _frames(2)
	_check("editing modulate changes the HUD", absf(hud.modulate.a - 179.0 / 255.0) < 0.002 and is_equal_approx(hud.modulate.r, 1.0), str(hud.modulate))
	elements.edit("modulate", "#" + before.to_html(true))
	await _frames(2)
	_check("the edit is put back", hud.modulate.is_equal_approx(before), str(hud.modulate))
	var shown_position := ""
	for row in elements._rows:
		if row["key"] == "position" and row["editor"] is LineEdit:
			shown_position = (row["editor"] as LineEdit).text
	_check("layout properties read like the Styles pane", shown_position == DevToolsElements.show_value(hud.position), shown_position)
	_check("the HUD's script variables are listed", elements._rows.any(func(row: Dictionary) -> bool: return row["key"] == "active_panel"))
	var styled: Control = null
	for label in hud.find_children("*", "Label", true, false):
		if (label as Label).has_theme_color_override("font_color"):
			styled = label
			break
	if styled:
		elements.select_node(styled)
		_check("theme overrides are listed", elements._rows.any(func(row: Dictionary) -> bool: return row["key"] == "theme_override_colors/font_color"), str(styled.get_path()))
		elements.select_node(hud)

	window.show_panel("console")
	var console := window.console
	print("devtools-check godot marker")
	await _until(func() -> bool: return _has_line(console, "devtools-check godot marker", "godot"), 5.0)
	_check("Console shows the Godot log live", _has_line(console, "devtools-check godot marker", "godot"))
	console.use_target(DevToolsConsole.TARGET_SELECTED)
	var expression := await console.evaluate("size.x > 0 and visible")
	_check("an Expression runs against the selected node", expression.get("ok", false) and str(expression.get("text", "")) == "true", str(expression.get("text", "")))
	var singleton := await console.evaluate("Engine.get_frames_per_second() >= 0")
	_check("engine singletons are in scope", singleton.get("ok", false) and str(singleton.get("text", "")) == "true", str(singleton.get("text", "")))
	console.use_target(DevToolsConsole.TARGET_JS)
	var sum := await console.evaluate("1 + 2")
	_check("JavaScript runs in the sidecar", sum.get("ok", false) and str(sum.get("text", "")) == "3", str(sum.get("text", "")))
	var scope := await console.evaluate("typeof engine.debugLog.logDebugEvent")
	_check("the engine is in the JavaScript scope", str(scope.get("text", "")) == "\"function\"", str(scope.get("text", "")))
	await console.evaluate("console.log('devtools-check sidecar marker'); engine.debugLog.logDebugEvent('app', 'devtools-check engine marker')")
	await _until(func() -> bool: return _has_line(console, "devtools-check sidecar marker", "sidecar") and _has_line(console, "devtools-check engine marker", "engine"), 5.0)
	_check("Console shows the sidecar's stderr", _has_line(console, "devtools-check sidecar marker", "sidecar"))
	_check("Console shows the engine log", _has_line(console, "devtools-check engine marker", "engine"))
	var thrown := await console.evaluate("null.boom")
	_check("a JavaScript error comes back as an error", not thrown.get("ok", true) and str(thrown.get("text", "")).contains("TypeError"), str(thrown.get("text", "")).get_slice("\n", 0))
	await _shoot(window, "dt-console")

	window.show_panel("network")
	var network := window.network
	var view := await engine.request("game.view")
	_check("the game still talks to the engine", view.get("ok", false))
	var call := _entry(network, "call", "game.view")
	_check("Network records the request and its reply", not call.is_empty() and str(call.get("status", "")) == "ok" and int(call.get("size", 0)) > 0 and float(call.get("duration", -1.0)) >= 0.0, "%s %s B %s ms" % [call.get("status", ""), call.get("size", 0), call.get("duration", -1)])
	_check("devtools traffic stays out of Network", _entry(network, "call", "devtools.").is_empty())
	console.use_target(DevToolsConsole.TARGET_JS)
	await console.evaluate("await fetch('/api/library?key=devtools-secret').then((response) => response.status)")
	await _until(func() -> bool: return float(_entry(network, "http", "/api/library").get("duration", -1.0)) >= 0.0, 10.0)
	var fetched := _entry(network, "http", "/api/library")
	_check("Network records the sidecar's fetch", str(fetched.get("status", "")) == "200" and int(fetched.get("size", 0)) > 0, "%s %s B" % [fetched.get("status", ""), fetched.get("size", 0)])
	_check("keys in fetched URLs are hidden", not str(fetched.get("url", "")).contains("devtools-secret"), str(fetched.get("url", "")))
	_check("API keys in payloads are hidden", DevToolsStyle.hide_secrets("{\"key\": \"AIzaSyD-devtools0check0secret00\"}") == "{\"key\": \"•••\"}")
	if not call.is_empty():
		network.select_entry(call)
		network.show_detail_tab("response")
		_check("the detail view shows the reply", network.detail_body().contains("\"ok\": true"))
		network.show_detail_tab("headers")
	await _shoot(window, "dt-network")

	window.show_panel("performance")
	var performance := window.performance
	await _until(func() -> bool: return performance.latest.has("fps") and performance.latest.has("rss"), 6.0)
	_check("Performance reads FPS", float(performance.latest.get("fps", 0.0)) > 0.0, str(performance.latest.get("fps", 0.0)))
	_check("Performance reads the sidecar's memory and lag", float(performance.latest.get("rss", 0.0)) > 0.0 and performance.latest.has("lag"), "%s, lag %s ms" % [DevToolsStyle.bytes(float(performance.latest.get("rss", 0.0))), performance.latest.get("lag", -1)])
	await _wait(1.2)
	await _shoot(window, "dt-performance")

	var spot := Vector2(root.get_visible_rect().size * 0.5)
	var buttons := hud.find_children("*", "BaseButton", true, false).filter(func(node: Node) -> bool: return (node as Control).is_visible_in_tree() and (node as Control).get_global_rect().has_area())
	if not buttons.is_empty():
		spot = (buttons[0] as Control).get_global_rect().get_center()
	window.highlight.set_picking(true)
	_check("Ctrl+Shift+C style inspect mode turns on", window.highlight.picking and window._inspect.button_pressed)
	var motion := InputEventMouseMotion.new()
	motion.position = spot
	motion.global_position = spot
	Input.parse_input_event(motion)
	await _frames(4)
	var hovered := root.gui_get_hovered_control()
	var click := InputEventMouseButton.new()
	click.button_index = MOUSE_BUTTON_LEFT
	click.position = spot
	click.global_position = spot
	click.pressed = true
	Input.parse_input_event(click)
	await _frames(2)
	var lift := click.duplicate() as InputEventMouseButton
	lift.pressed = false
	Input.parse_input_event(lift)
	await _frames(3)
	_check("clicking the game picks the element under the mouse", hovered != null and elements.selected_node() == hovered and not window.highlight.picking and window.active == "elements", "%s at %s" % [str(hovered.get_path()) if hovered else "nothing", str(spot)])

	var key := window._key
	await _chord(window.get_window_id())
	await _frames(3)
	_check("Ctrl+Shift+I in the tools closes them", not tools.is_open())
	await _until(func() -> bool: return tools.get_child_count() == 0, 3.0)
	_check("closing frees the window and the outline", tools.get_child_count() == 0 and engine.devtools == null, "%d children" % tools.get_child_count())
	_check("nothing is left listening to the Godot log", not tools.capture.listener.is_valid())
	var probe := Probe.new()
	engine.devtools = probe
	var stale := await engine.devtools_request(probe, "devtools.eval", {"key": key, "code": "1"})
	engine.devtools = null
	_check("the sidecar dropped the session", not stale.get("ok", false), str(stale.get("error", "")))
	tools.toggle()
	_check("the tools open again", tools.is_open())
	if tools.is_open():
		tools.window.mouse_passthrough = true
		await _until(func() -> bool: return tools.window.is_attached(), 20.0)
		_check("a second session attaches", tools.window.is_attached())
	tools.toggle()
	await _frames(3)
	_check("and close again", not tools.is_open() and engine.devtools == null)
	_finish(0 if failures.is_empty() else 1)


func _finish(code: int) -> void:
	_say("failures: %d %s" % [failures.size(), ", ".join(failures)])
	main.engine.stop()
	for i in range(2):
		await process_frame
	quit(code)
