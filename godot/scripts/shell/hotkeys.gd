class_name Hotkeys
extends Node

signal escape_pressed
signal fullscreen_toggled(fullscreen: bool)
signal zoom_changed(level: float, factor: float)
signal reload_requested(force: bool)
signal devtools_requested
signal close_requested
signal minimize_requested

const ZOOM_STEP := 0.5
const ZOOM_BASE := 1.2
const ZOOM_LEAST := -3.0
const ZOOM_MOST := 4.0

var engine: EngineLink
var apply_defaults := true
var zoom_level := 0.0


func _init() -> void:
	name = "Hotkeys"
	process_mode = Node.PROCESS_MODE_ALWAYS


func setup(link: EngineLink, defaults := true) -> void:
	engine = link
	apply_defaults = defaults
	if apply_defaults and is_inside_tree():
		_fit_screen(true)
		if not get_tree().root.dpi_changed.is_connected(_on_dpi_changed):
			get_tree().root.dpi_changed.connect(_on_dpi_changed)
	if engine == null:
		return
	if not engine.is_ready():
		await engine.engine_ready
	var reply: Dictionary = await engine.request("shell.zoom.get")
	if reply.get("ok", false):
		set_zoom(float(reply["result"].get("level", 0.0)), false)


static func screen_scale() -> float:
	if OS.get_name() != "macOS":
		return 1.0
	return maxf(1.0, DisplayServer.screen_get_max_scale())


func zoom_factor() -> float:
	return pow(ZOOM_BASE, zoom_level)


func ui_factor() -> float:
	return zoom_factor() * screen_scale()


func _fit_screen(resize: bool) -> void:
	var scale := screen_scale()
	get_tree().root.content_scale_factor = ui_factor()
	if not resize or scale <= 1.0 or DisplayServer.window_get_mode() != DisplayServer.WINDOW_MODE_WINDOWED:
		return
	var screen := DisplayServer.window_get_current_screen()
	var usable := DisplayServer.screen_get_usable_rect(screen)
	var wanted := Vector2(float(ProjectSettings.get_setting("display/window/size/viewport_width", 1440)), float(ProjectSettings.get_setting("display/window/size/viewport_height", 900))) * scale
	var size := Vector2i(wanted.min(Vector2(usable.size) * 0.94).round())
	DisplayServer.window_set_size(size)
	DisplayServer.window_set_position(usable.position + (usable.size - size) / 2)


func _on_dpi_changed() -> void:
	if apply_defaults and is_inside_tree():
		_fit_screen(false)


func set_zoom(level: float, remember := true) -> void:
	zoom_level = clampf(level, ZOOM_LEAST, ZOOM_MOST)
	if apply_defaults and is_inside_tree():
		get_tree().root.content_scale_factor = ui_factor()
	zoom_changed.emit(zoom_level, zoom_factor())
	if remember and engine and engine.is_ready():
		engine.request("shell.zoom.set", {"level": zoom_level})


func toggle_fullscreen() -> void:
	var fullscreen := DisplayServer.window_get_mode() in [DisplayServer.WINDOW_MODE_FULLSCREEN, DisplayServer.WINDOW_MODE_EXCLUSIVE_FULLSCREEN]
	if apply_defaults:
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED if fullscreen else DisplayServer.WINDOW_MODE_FULLSCREEN)
	fullscreen_toggled.emit(not fullscreen)


static func devtools_chord(key: InputEventKey) -> bool:
	if key.keycode != KEY_I:
		return false
	if OS.get_name() == "macOS":
		return key.meta_pressed and key.alt_pressed and not key.shift_pressed and not key.ctrl_pressed
	return key.ctrl_pressed and key.shift_pressed and not key.alt_pressed and not key.meta_pressed


func _input(event: InputEvent) -> void:
	if not (event is InputEventKey):
		return
	var key := event as InputEventKey
	if not key.pressed:
		return
	var command := key.is_command_or_control_pressed()
	var code := key.keycode
	if code == KEY_ESCAPE and not command and not key.alt_pressed:
		if not key.echo:
			escape_pressed.emit()
		return
	if code == KEY_F11 and not command and not key.alt_pressed and not key.shift_pressed:
		if not key.echo:
			toggle_fullscreen()
		get_viewport().set_input_as_handled()
		return
	if devtools_chord(key):
		if not key.echo:
			devtools_requested.emit()
		get_viewport().set_input_as_handled()
		return
	if not command or key.alt_pressed:
		return
	match code:
		KEY_EQUAL, KEY_PLUS, KEY_KP_ADD:
			set_zoom(zoom_level + ZOOM_STEP)
			get_viewport().set_input_as_handled()
		KEY_MINUS, KEY_KP_SUBTRACT:
			set_zoom(zoom_level - ZOOM_STEP)
			get_viewport().set_input_as_handled()
		KEY_0, KEY_KP_0:
			if not key.shift_pressed:
				set_zoom(0.0)
				get_viewport().set_input_as_handled()
		KEY_R:
			if not key.echo:
				reload_requested.emit(key.shift_pressed)
			get_viewport().set_input_as_handled()
		KEY_W:
			if not key.shift_pressed and not key.echo:
				close_requested.emit()
				if apply_defaults and is_inside_tree():
					get_tree().root.propagate_notification(NOTIFICATION_WM_CLOSE_REQUEST)
				get_viewport().set_input_as_handled()
		KEY_M:
			if not key.shift_pressed and not key.echo:
				minimize_requested.emit()
				if apply_defaults:
					DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_MINIMIZED)
				get_viewport().set_input_as_handled()
