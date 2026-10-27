class_name MapNavigator
extends Node

const CLICK_TOLERANCE := 3.0
const INERTIA_CUTOFF_MS := 160
const PAN_LINEARITY := 0.1
const PAN_DECELERATION := 5000.0
const PAN_MAX_SPEED := 2400.0
const WHEEL_ZOOM_DELTA := 4.000244140625
const WHEEL_ZOOM_RATE := 1.0 / 450.0
const DEFAULT_ZOOM_RATE := 1.0 / 100.0
const MAX_SCALE_PER_FRAME := 2.0
const WHEEL_EASE_MS := 200.0
const WHEEL_TIME_ADJUST_MS := 5.0
const WHEEL_SINGLE_EVENT_MS := 40.0
const WHEEL_NEW_ACTION_MS := 400.0
const WHEEL_FINISH_MS := 200.0
const WHEEL_PIXELS_PER_NOTCH := 100.0
const COCOA_PIXELS_PER_LINE := 40.0
const COCOA_PRECISE_SCALE := 0.03
const PINCH_PIXELS := 100.0
const KEY_PAN_STEP := 100.0
const KEY_BEARING_STEP := 15.0
const KEY_PITCH_STEP := 10.0
const MIN_PITCH := 0.0
const MAX_PITCH := 60.0
const KEY_EASE_MS := 300.0
const BOX_EASE_MS := 500.0
const BOX_FILL := Color(1, 1, 1, 0.5)
const BOX_EDGE := Color(32 / 255.0, 32 / 255.0, 32 / 255.0, 0.5)

var extras: Node
var map_view: MapView
var globe: GlobeView
var _pressed := false
var _press_at := Vector2.ZERO
var _last_at := Vector2.ZERO
var _moved := false
var _boxing := false
var _box_overlay: BoxOverlay
var _inertia: Array[Array] = []
var _ease: Dictionary = {}
var _wheel_active := false
var _wheel_type := ""
var _wheel_last_value := 0.0
var _wheel_timeout_at := -1.0
var _wheel_timeout_around := Vector2.ZERO
var _wheel_last_event_ms := 0.0
var _wheel_delta := 0.0
var _wheel_target := NAN
var _wheel_start_zoom := NAN
var _wheel_expected := NAN
var _wheel_easing: CubicBezier
var _wheel_around := Vector2.ZERO
var _wheel_frame_pending := false
var _wheel_finish_at := -1.0
var _prev_ease: Dictionary = {}
var _default_easing := CubicBezier.new(0.25, 0.1, 0.25, 1.0)
var _inertia_easing := CubicBezier.new(0.0, 0.0, 0.3, 1.0)


func setup(owner_extras: Node, view: MapView, globe_view: GlobeView, ui: Control) -> void:
	extras = owner_extras
	map_view = view
	globe = globe_view
	_box_overlay = BoxOverlay.new()
	ui.add_child(_box_overlay)


func handle(event: InputEvent) -> bool:
	if map_view == null:
		return false
	if event is InputEventMouseButton:
		return _on_button(event as InputEventMouseButton)
	if event is InputEventMouseMotion:
		return _on_motion(event as InputEventMouseMotion)
	if event is InputEventMagnifyGesture:
		var magnify := event as InputEventMagnifyGesture
		_mark()
		if magnify.factor > 0.0:
			wheel_input(-PINCH_PIXELS * log(magnify.factor), magnify.shift_pressed, magnify.position)
		return true
	if event is InputEventPanGesture:
		var pan := event as InputEventPanGesture
		_mark()
		wheel_input(pan.delta.y / COCOA_PRECISE_SCALE, pan.shift_pressed, pan.position)
		return true
	if event is InputEventKey:
		return _on_key(event as InputEventKey)
	return false


func stop() -> void:
	_ease = {}
	_wheel_active = false
	_wheel_frame_pending = false
	_wheel_finish_at = -1.0
	_wheel_target = NAN
	_wheel_expected = NAN


func busy() -> bool:
	return _pressed or _wheel_active or _wheel_frame_pending or not _ease.is_empty()


func pan_view(delta: Vector2, around := Vector2(-1.0, -1.0)) -> void:
	_apply_pan(delta, around)


func _reduced() -> bool:
	return extras != null and bool((extras.get("settings") as Dictionary).get("reduceMotion", false))


func _mark() -> void:
	if globe:
		globe.mark_interaction()


func _now() -> float:
	return Time.get_ticks_usec() / 1000.0


func _on_button(button: InputEventMouseButton) -> bool:
	if button.button_index == MOUSE_BUTTON_WHEEL_UP or button.button_index == MOUSE_BUTTON_WHEEL_DOWN:
		if button.pressed:
			_mark()
			var notches := button.factor if button.factor > 0.0 else 1.0
			var per_notch := COCOA_PIXELS_PER_LINE if OS.get_name() == "macOS" else WHEEL_PIXELS_PER_NOTCH
			wheel_input(per_notch * notches * (-1.0 if button.button_index == MOUSE_BUTTON_WHEEL_UP else 1.0), button.shift_pressed, button.position)
		return true
	if button.button_index == MOUSE_BUTTON_WHEEL_LEFT or button.button_index == MOUSE_BUTTON_WHEEL_RIGHT:
		return true
	if button.button_index == MOUSE_BUTTON_LEFT:
		if button.pressed:
			_mark()
			stop()
			map_view.get_viewport().gui_release_focus()
			_pressed = true
			_moved = false
			_boxing = button.shift_pressed
			_press_at = button.position
			_last_at = button.position
			_inertia.clear()
			map_view.set("_dragging", true)
			if globe:
				globe.held = true
		else:
			if not _pressed:
				return true
			_pressed = false
			if globe:
				globe.held = false
			var cancelled := not bool(map_view.get("_dragging"))
			map_view.set("_dragging", false)
			if _boxing:
				_boxing = false
				_box_overlay.hide_box()
				if _moved and not cancelled and button.position != _press_at:
					_fit_box(_press_at, button.position)
				return true
			if _moved:
				_start_inertia()
			elif not cancelled:
				_click(button.position)
		return true
	if button.button_index == MOUSE_BUTTON_RIGHT or button.button_index == MOUSE_BUTTON_MIDDLE:
		if button.pressed:
			_mark()
		return true
	return false


func _on_motion(motion: InputEventMouseMotion) -> bool:
	if not _pressed:
		return false
	if not bool(map_view.get("_dragging")):
		_pressed = false
		_boxing = false
		_box_overlay.hide_box()
		if globe:
			globe.held = false
		return true
	var point := motion.position
	if not _moved:
		if point.distance_to(_press_at) < CLICK_TOLERANCE:
			return true
		_moved = true
	_mark()
	if _boxing:
		_box_overlay.show_box(_press_at, point)
		return true
	var delta := point - _last_at
	_last_at = point
	if delta == Vector2.ZERO:
		return true
	_record(delta)
	_apply_pan(delta, point)
	return true


func _on_key(key: InputEventKey) -> bool:
	if not key.pressed or key.alt_pressed or key.ctrl_pressed or key.meta_pressed:
		return false
	if map_view.get_viewport().gui_get_focus_owner() != null:
		return false
	var zoom_dir := 0
	var bearing_dir := 0
	var pitch_dir := 0
	var x_dir := 0
	var y_dir := 0
	match key.keycode:
		KEY_EQUAL, KEY_PLUS, KEY_KP_ADD:
			zoom_dir = 1
		KEY_MINUS, KEY_KP_SUBTRACT:
			zoom_dir = -1
		KEY_LEFT:
			if key.shift_pressed:
				bearing_dir = -1
			else:
				x_dir = -1
		KEY_RIGHT:
			if key.shift_pressed:
				bearing_dir = 1
			else:
				x_dir = 1
		KEY_UP:
			if key.shift_pressed:
				pitch_dir = 1
			else:
				y_dir = -1
		KEY_DOWN:
			if key.shift_pressed:
				pitch_dir = -1
			else:
				y_dir = 1
		_:
			return false
	_mark()
	stop()
	var view := map_view.get_viewport_rect().size
	var ease := {
		"start": Time.get_ticks_msec(),
		"duration": 0.0 if _reduced() else KEY_EASE_MS,
		"curve": "ease_out",
		"pan": Vector2(-x_dir * KEY_PAN_STEP, -y_dir * KEY_PAN_STEP),
		"applied": Vector2.ZERO,
		"around": view * 0.5,
	}
	if zoom_dir != 0:
		var limits := _zoom_limits()
		ease["zoom_from"] = map_view.zoom_level()
		ease["zoom_to"] = clampf(map_view.zoom_level() + zoom_dir * (2 if key.shift_pressed else 1), limits.x, limits.y)
	if bearing_dir != 0:
		ease["bearing_from"] = map_view.bearing
		ease["bearing_to"] = normalize_bearing(map_view.bearing + bearing_dir * KEY_BEARING_STEP, map_view.bearing)
	if pitch_dir != 0:
		ease["pitch_from"] = map_view.pitch
		ease["pitch_to"] = clampf(map_view.pitch + pitch_dir * KEY_PITCH_STEP, MIN_PITCH, MAX_PITCH)
	_ease = ease
	return true


static func wrap_bearing(value: float) -> float:
	var wrapped := fposmod(value + 180.0, 360.0) - 180.0
	return 180.0 if wrapped == -180.0 else wrapped


static func normalize_bearing(bearing: float, current: float) -> float:
	var target := wrap_bearing(bearing)
	var difference := absf(target - current)
	if absf(target - 360.0 - current) < difference:
		target -= 360.0
	if absf(target + 360.0 - current) < difference:
		target += 360.0
	return target


func _record(delta: Vector2) -> void:
	_drain()
	_inertia.append([Time.get_ticks_msec(), delta])


func _drain() -> void:
	var now := Time.get_ticks_msec()
	while not _inertia.is_empty() and now - int(_inertia[0][0]) > INERTIA_CUTOFF_MS:
		_inertia.pop_front()


func _start_inertia() -> void:
	_drain()
	if _inertia.size() < 2 or _reduced():
		_inertia.clear()
		return
	var pan := Vector2.ZERO
	for entry in _inertia:
		pan += entry[1] as Vector2
	var duration := float(int(_inertia[_inertia.size() - 1][0]) - int(_inertia[0][0]))
	_inertia.clear()
	var magnitude := pan.length()
	if magnitude <= 0.0:
		return
	var speed := PAN_MAX_SPEED
	if duration > 0.0:
		speed = clampf(magnitude * PAN_LINEARITY / (duration / 1000.0), -PAN_MAX_SPEED, PAN_MAX_SPEED)
	var seconds := absf(speed) / (PAN_DECELERATION * PAN_LINEARITY)
	var amount := speed * (seconds / 2.0)
	_ease = {
		"start": Time.get_ticks_msec(),
		"duration": seconds * 1000.0,
		"curve": "inertia",
		"pan": pan * (amount / magnitude),
		"applied": Vector2.ZERO,
	}


func wheel_input(value: float, shift: bool, at: Vector2) -> void:
	if not _ease.is_empty():
		_ease = {}
	var now := _now()
	var time_delta := now - _wheel_last_event_ms
	_wheel_last_event_ms = now
	if value != 0.0 and fmod(value, WHEEL_ZOOM_DELTA) == 0.0:
		_wheel_type = "wheel"
	elif value != 0.0 and absf(value) < 4.0:
		_wheel_type = "trackpad"
	elif time_delta > WHEEL_NEW_ACTION_MS:
		_wheel_type = ""
		_wheel_last_value = value
		_wheel_timeout_at = now + WHEEL_SINGLE_EVENT_MS
		_wheel_timeout_around = at
	elif _wheel_type.is_empty():
		_wheel_type = "trackpad" if absf(time_delta * value) < 200.0 else "wheel"
		if _wheel_timeout_at >= 0.0:
			_wheel_timeout_at = -1.0
			value += _wheel_last_value
	if shift and value != 0.0:
		value /= 4.0
	if not _wheel_type.is_empty():
		_wheel_delta -= value
		if not _wheel_active:
			_wheel_begin(at)


func wheel_type() -> String:
	return _wheel_type


func _wheel_timed_out() -> void:
	_wheel_timeout_at = -1.0
	_wheel_type = "wheel"
	_wheel_delta -= _wheel_last_value
	if not _wheel_active:
		_wheel_begin(_wheel_timeout_around)


func _wheel_begin(at: Vector2) -> void:
	if _wheel_delta == 0.0:
		return
	_wheel_active = true
	_wheel_finish_at = -1.0
	_wheel_around = at
	_wheel_frame_pending = true


func _wheel_frame() -> void:
	if not _wheel_frame_pending:
		return
	_wheel_frame_pending = false
	if not _wheel_active and _wheel_finish_at < 0.0:
		return
	var current := map_view.zoom_level()
	if not is_nan(_wheel_expected):
		var external := current - _wheel_expected
		if not is_nan(_wheel_start_zoom):
			_wheel_start_zoom += external
		if not is_nan(_wheel_target):
			_wheel_target += external
	if _wheel_delta != 0.0:
		var rate := WHEEL_ZOOM_RATE if _wheel_type == "wheel" and absf(_wheel_delta) > WHEEL_ZOOM_DELTA else DEFAULT_ZOOM_RATE
		var scale := MAX_SCALE_PER_FRAME / (1.0 + exp(-absf(_wheel_delta * rate)))
		if _wheel_delta < 0.0 and scale != 0.0:
			scale = 1.0 / scale
		var from_zoom := current if is_nan(_wheel_target) else _wheel_target
		var limits := _zoom_limits()
		_wheel_target = clampf(from_zoom + log(scale) / log(2.0), limits.x, limits.y)
		if _wheel_type == "wheel":
			_wheel_start_zoom = current
			_wheel_easing = _smooth_out_easing(WHEEL_EASE_MS)
		_wheel_delta = 0.0
	var target := current if is_nan(_wheel_target) else _wheel_target
	var finished := false
	var zoom := target
	if _wheel_type == "wheel" and not is_nan(_wheel_start_zoom) and _wheel_start_zoom != 0.0 and _wheel_easing != null:
		var t := minf((_now() - _wheel_last_event_ms + WHEEL_TIME_ADJUST_MS) / WHEEL_EASE_MS, 1.0)
		zoom = lerpf(_wheel_start_zoom, target, _wheel_easing.at(t))
		if t < 1.0:
			_wheel_frame_pending = true
		else:
			finished = true
	else:
		finished = true
	_wheel_active = true
	if finished:
		_wheel_active = false
		_wheel_finish_at = _now() + WHEEL_FINISH_MS
	_wheel_expected = zoom
	_apply_zoom(zoom - current, _wheel_around)


func _smooth_out_easing(duration: float) -> CubicBezier:
	var easing := _default_easing
	if not _prev_ease.is_empty():
		var previous: CubicBezier = _prev_ease["easing"]
		var t := (_now() - float(_prev_ease["start"])) / float(_prev_ease["duration"])
		var speed := previous.at(t + 0.01) - previous.at(t)
		var x := 0.27 / sqrt(speed * speed + 0.0001) * 0.01
		var y := sqrt(maxf(0.0, 0.27 * 0.27 - x * x))
		easing = CubicBezier.new(x, y, 0.25, 1.0)
	_prev_ease = {"start": _now(), "duration": duration, "easing": easing}
	return easing


func _process(_delta: float) -> void:
	if map_view == null:
		return
	var now := _now()
	if _wheel_timeout_at >= 0.0 and now >= _wheel_timeout_at:
		_wheel_timed_out()
	if _wheel_frame_pending:
		_wheel_frame()
	if _wheel_finish_at >= 0.0 and _now() >= _wheel_finish_at:
		_wheel_finish_at = -1.0
		_wheel_target = NAN
		_wheel_expected = NAN
	if _ease.is_empty():
		return
	var duration := float(_ease["duration"])
	var t := 1.0 if duration <= 0.0 else clampf((float(Time.get_ticks_msec()) - float(_ease["start"])) / duration, 0.0, 1.0)
	var k := _curve(str(_ease["curve"]), t)
	var turned := false
	if _ease.has("bearing_to"):
		map_view.bearing = wrap_bearing(lerpf(float(_ease["bearing_from"]), float(_ease["bearing_to"]), k))
		turned = true
	if _ease.has("pitch_to"):
		map_view.pitch = clampf(lerpf(float(_ease["pitch_from"]), float(_ease["pitch_to"]), k), MIN_PITCH, MAX_PITCH)
		turned = true
	var moved := false
	if _ease.has("pan"):
		var want: Vector2 = (_ease["pan"] as Vector2) * k
		var step: Vector2 = want - (_ease["applied"] as Vector2)
		_ease["applied"] = want
		if step != Vector2.ZERO:
			_apply_pan(step, _ease.get("around", Vector2(-1.0, -1.0)))
			moved = true
	if _ease.has("zoom_to"):
		var zoom := lerpf(float(_ease["zoom_from"]), float(_ease["zoom_to"]), k)
		if absf(zoom - map_view.zoom_level()) >= 1e-9:
			_apply_zoom(zoom - map_view.zoom_level(), _ease.get("around", map_view.get_viewport_rect().size * 0.5))
			moved = true
	if _ease.has("centre_to"):
		_apply_centre(_ease, k)
		moved = true
	if turned and not moved:
		map_view.call("_after_camera_move")
	if t >= 1.0:
		_ease = {}


func _curve(name: String, t: float) -> float:
	match name:
		"ease_out":
			return t * (2.0 - t)
		"inertia":
			return _inertia_easing.at(t)
		"linear":
			return t
	return _default_easing.at(t)


func _apply_pan(delta: Vector2, around := Vector2(-1.0, -1.0)) -> void:
	if globe:
		globe.sync_active()
	if globe and globe.active:
		globe.pan_by(delta, around)
		return
	map_view.camera.position -= delta / map_view.camera.zoom.x
	map_view.call("_after_camera_move")


func _apply_zoom(delta_zoom: float, around: Vector2) -> void:
	if absf(delta_zoom) < 1e-9:
		return
	if globe:
		globe.sync_active()
	if globe and globe.active:
		globe.zoom_around(around, delta_zoom)
		return
	map_view.call("_zoom_at", around, pow(2.0, delta_zoom))


func _zoom_limits() -> Vector2:
	if globe and globe.active:
		return globe.zoom_limits()
	return Vector2(log(8.0 * MapView.MIN_ZOOM) / log(2.0), log(8.0 * MapView.MAX_ZOOM) / log(2.0))


func _click(at: Vector2) -> void:
	if globe and globe.active and not globe.screen_hits_globe(at):
		map_view.region_clicked.emit(-1)
		return
	map_view.region_clicked.emit(map_view.baker.pick(map_view.screen_to_world(at)))


func _fit_box(a: Vector2, b: Vector2) -> void:
	var view := map_view.get_viewport_rect().size
	var box := Rect2(a, Vector2.ZERO).expand(b)
	if box.size.x <= 0.0 or box.size.y <= 0.0:
		return
	var limits := _zoom_limits()
	var ease := {
		"start": Time.get_ticks_msec(),
		"duration": 0.0 if _reduced() else BOX_EASE_MS,
		"curve": "default",
		"zoom_from_level": map_view.zoom_level(),
	}
	if globe and globe.globe_shown():
		var scale := minf(view.x / box.size.x, view.y / box.size.y)
		ease["zoom_to_level"] = clampf(map_view.zoom_level() + log(scale) / log(2.0), limits.x, limits.y)
		ease["centre_from"] = globe.centre_lonlat()
		ease["centre_to"] = GlobeView.lonlat_of_world(map_view.screen_to_world(box.get_center()))
		ease["globe"] = true
	else:
		var first := map_view.screen_to_world(a)
		var second := map_view.screen_to_world(b)
		second.x += MapView.WORLD_WIDTH * roundf((first.x - second.x) / MapView.WORLD_WIDTH)
		var low := first.min(second)
		var high := first.max(second)
		var angle := -deg_to_rad(map_view.bearing)
		var turned_low := Vector2(INF, INF)
		var turned_high := Vector2(-INF, -INF)
		for corner: Vector2 in [low, Vector2(high.x, low.y), high, Vector2(low.x, high.y)]:
			var turned := corner.rotated(angle)
			turned_low = turned_low.min(turned)
			turned_high = turned_high.max(turned)
		var size := (turned_high - turned_low) * map_view.camera.zoom.x
		if size.x <= 0.0 or size.y <= 0.0:
			return
		var scale := minf(view.x / size.x, view.y / size.y)
		ease["zoom_to_level"] = clampf(map_view.zoom_level() + log(scale) / log(2.0), limits.x, limits.y)
		var centre := (low + high) * 0.5
		centre.x += MapView.WORLD_WIDTH * roundf((map_view.camera.position.x - centre.x) / MapView.WORLD_WIDTH)
		ease["centre_from"] = map_view.camera.position
		ease["centre_to"] = centre
		ease["globe"] = false
	_ease = ease


func _apply_centre(ease: Dictionary, k: float) -> void:
	var zoom := lerpf(float(ease["zoom_from_level"]), float(ease["zoom_to_level"]), k)
	var from: Vector2 = ease["centre_from"]
	var to: Vector2 = ease["centre_to"]
	if bool(ease["globe"]):
		var lon := from.x + GlobeView.difference_of_angles(from.x, to.x) * k
		globe.set_centre_zoom(Vector2(lon, lerpf(from.y, to.y, k)), zoom)
		return
	map_view.camera.position = from.lerp(to, k)
	var limits := _zoom_limits()
	map_view.camera.zoom = Vector2.ONE * pow(2.0, clampf(zoom, limits.x, limits.y)) / 8.0
	map_view.call("_after_camera_move")


class BoxOverlay extends Control:
	var _rect := Rect2()

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		visible = false

	func show_box(a: Vector2, b: Vector2) -> void:
		_rect = Rect2(a, Vector2.ZERO).expand(b)
		visible = true
		queue_redraw()

	func hide_box() -> void:
		visible = false

	func _draw() -> void:
		draw_rect(_rect, MapNavigator.BOX_FILL)
		var edge := MapNavigator.BOX_EDGE
		var dash := 2.0
		var outer := _rect.grow(2.0)
		_dotted(Vector2(outer.position.x, outer.position.y + 1.0), Vector2(outer.end.x, outer.position.y + 1.0), dash, edge)
		_dotted(Vector2(outer.position.x, outer.end.y - 1.0), Vector2(outer.end.x, outer.end.y - 1.0), dash, edge)
		_dotted(Vector2(outer.position.x + 1.0, outer.position.y), Vector2(outer.position.x + 1.0, outer.end.y), dash, edge)
		_dotted(Vector2(outer.end.x - 1.0, outer.position.y), Vector2(outer.end.x - 1.0, outer.end.y), dash, edge)

	func _dotted(a: Vector2, b: Vector2, step: float, colour: Color) -> void:
		var length := a.distance_to(b)
		if length <= 0.0:
			return
		var direction := (b - a) / length
		var at := 0.0
		while at < length:
			var end := minf(at + step, length)
			draw_line(a + direction * at, a + direction * end, colour, 2.0)
			at += step * 2.0
