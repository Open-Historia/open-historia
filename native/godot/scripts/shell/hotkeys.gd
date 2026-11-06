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
const DESIGN_SCREEN := Vector2(1920.0, 1080.0)
const DESIGN_WINDOW := Vector2(1440.0, 900.0)
const SCALE_STEPS := 64.0
const SCALE_LEAST := 1.0
const SCREEN_WATCH_SECONDS := 0.5

var engine: EngineLink
var apply_defaults := true
var zoom_level := 0.0
var _scale_now := 0.0
var _windowed_size := Vector2i.ZERO
var _screen_watch: Timer


func _init() -> void:
	name = "Hotkeys"
	process_mode = Node.PROCESS_MODE_ALWAYS


func setup(link: EngineLink, defaults := true) -> void:
	engine = link
	apply_defaults = defaults
	if apply_defaults and is_inside_tree():
		_fit_screen(true)
		if not get_tree().root.size_changed.is_connected(_apply_scale):
			get_tree().root.size_changed.connect(_apply_scale)
		if not get_tree().root.dpi_changed.is_connected(_on_dpi_changed):
			get_tree().root.dpi_changed.connect(_on_dpi_changed)
		if _screen_watch == null:
			_screen_watch = Timer.new()
			_screen_watch.wait_time = SCREEN_WATCH_SECONDS
			_screen_watch.timeout.connect(_watch_screen)
			add_child(_screen_watch)
			_screen_watch.start()
	if engine == null:
		return
	if not engine.is_ready():
		await engine.engine_ready
	var reply: Dictionary = await engine.request("shell.zoom.get")
	if reply.get("ok", false):
		set_zoom(float(reply["result"].get("level", 0.0)), false)


static func os_scale() -> float:
	if OS.get_name() != "macOS":
		return 1.0
	return maxf(1.0, DisplayServer.screen_get_max_scale())


static func resolution_scale(pixels: Vector2) -> float:
	if pixels.x <= 0.0 or pixels.y <= 0.0:
		return 1.0
	return maxf(1.0, minf(pixels.x / DESIGN_SCREEN.x, pixels.y / DESIGN_SCREEN.y))


static func window_scale(pixels: Vector2) -> float:
	if pixels.x <= 0.0 or pixels.y <= 0.0:
		return 1.0
	return maxf(SCALE_LEAST, roundf(minf(pixels.x / DESIGN_WINDOW.x, pixels.y / DESIGN_WINDOW.y) * SCALE_STEPS) / SCALE_STEPS)


static func screen_scale(screen := -1) -> float:
	var at := DisplayServer.window_get_current_screen() if screen < 0 else screen
	return maxf(os_scale(), resolution_scale(Vector2(DisplayServer.screen_get_size(at))))


func zoom_factor() -> float:
	return pow(ZOOM_BASE, zoom_level)


func ui_factor() -> float:
	return zoom_factor() * window_scale(Vector2(get_tree().root.size) if is_inside_tree() else Vector2.ZERO)


func _apply_scale() -> void:
	if not apply_defaults or not is_inside_tree():
		return
	var factor := ui_factor()
	if not is_equal_approx(get_tree().root.content_scale_factor, factor):
		get_tree().root.content_scale_factor = factor


func _fit_screen(resize: bool) -> void:
	var scale := screen_scale()
	_scale_now = scale
	if DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_WINDOWED:
		_windowed_size = DisplayServer.window_get_size()
	if not resize or scale <= 1.0 or DisplayServer.window_get_mode() != DisplayServer.WINDOW_MODE_WINDOWED:
		_apply_scale()
		return
	var screen := DisplayServer.window_get_current_screen()
	var usable := DisplayServer.screen_get_usable_rect(screen)
	var wanted := Vector2(float(ProjectSettings.get_setting("display/window/size/viewport_width", 1440)), float(ProjectSettings.get_setting("display/window/size/viewport_height", 900))) * scale
	var size := Vector2i(wanted.min(Vector2(usable.size) * 0.94).round())
	DisplayServer.window_set_size(size)
	DisplayServer.window_set_position(usable.position + (usable.size - size) / 2)
	_windowed_size = size
	_apply_scale()


func _on_dpi_changed() -> void:
	_watch_screen()


func _watch_screen() -> void:
	if not apply_defaults or not is_inside_tree():
		return
	var windowed := DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_WINDOWED
	var scale := screen_scale()
	if is_equal_approx(scale, _scale_now):
		if windowed:
			_windowed_size = DisplayServer.window_get_size()
		return
	var was := _scale_now
	_scale_now = scale
	if was <= 0.0 or not windowed or _windowed_size == Vector2i.ZERO:
		return
	var usable := DisplayServer.screen_get_usable_rect(DisplayServer.window_get_current_screen())
	var size := Vector2i((Vector2(_windowed_size) * scale / was).min(Vector2(usable.size) * 0.94).round())
	var at := DisplayServer.window_get_position()
	DisplayServer.window_set_size(size)
	DisplayServer.window_set_position(Vector2i(clampi(at.x, usable.position.x, maxi(usable.position.x, usable.end.x - size.x)), clampi(at.y, usable.position.y, maxi(usable.position.y, usable.end.y - size.y))))
	_windowed_size = size


func set_zoom(level: float, remember := true) -> void:
	zoom_level = clampf(level, ZOOM_LEAST, ZOOM_MOST)
	_apply_scale()
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
