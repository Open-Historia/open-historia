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
const TOUCH_ZOOM_THRESHOLD := 0.1
const TOUCH_ROTATION_THRESHOLD := 25.0
const TAP_MAX_INTERVAL_MS := 500
const TAP_MAX_TOUCH_MS := 500
const TAP_MAX_DISTANCE := 30.0
const TAP_DRAG_ZOOM_PIXELS := 128.0
const INERTIA_LINEARITY := 0.3
const ZOOM_INERTIA_DECELERATION := 20.0
const ZOOM_INERTIA_MAX_SPEED := 1400.0
const BEARING_INERTIA_DECELERATION := 1000.0
const BEARING_INERTIA_MAX_SPEED := 360.0

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
	if event is InputEventScreenTouch:
		return _on_touch(event as InputEventScreenTouch)
	if event is InputEventScreenDrag:
		return _on_touch_drag(event as InputEventScreenDrag)
	if (event is InputEventMouseButton or event is InputEventMouseMotion) and event.device == InputEvent.DEVICE_ID_EMULATION:
		return true
	if (event is InputEventMagnifyGesture or event is InputEventPanGesture) and not _touches.is_empty():
		return true
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
	return _pressed or _wheel_active or _wheel_frame_pending or not _ease.is_empty() or not _touches.is_empty()


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
	_apply_pan(delta, point, true)
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
	_flush_touch()
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
	if _ease.has("pin"):
		_touch_ease_step(_ease, k)
		if t >= 1.0:
			_ease = {}
		return
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


func _apply_pan(delta: Vector2, around := Vector2(-1.0, -1.0), grabbed_place := false) -> void:
	if globe:
		globe.sync_active()
	if globe and globe.active:
		globe.pan_by(delta, around, grabbed_place)
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


var _touches := {}
var _touch_moved := false
var _touch_order: Array[int] = []
var _touch_cancelled := false
var _touch_record: Array[Array] = []
var _pan_seen := {}
var _pan_sum := Vector2.ZERO
var _pair: Array[int] = []
var _pair_distance := 0.0
var _pair_start_distance := 0.0
var _pair_zooming := false
var _pair_vector := Vector2.ZERO
var _pair_start_vector := Vector2.ZERO
var _pair_min_diameter := 0.0
var _pair_turning := false
var _pair_used := false
var _tap_begun := -1
var _tap_has := false
var _tap_point := Vector2.ZERO
var _tap_aborted := false
var _tap_time := -1
var _tap_spot := Vector2.ZERO
var _swipe_index := -1
var _swipe_point := Vector2.ZERO
var _swiping := false


func touch_count() -> int:
	return _touches.size()


func _on_touch(touch: InputEventScreenTouch) -> bool:
	_flush_touch()
	var now := Time.get_ticks_msec()
	if touch.pressed:
		if _touches.is_empty():
			_touch_begin()
		_touches[touch.index] = touch.position
		if not _touch_order.has(touch.index):
			_touch_order.append(touch.index)
		_tap_on_start(touch.position, now)
		_swipe_on_start(now)
		if _touches.size() >= 2 and _pair.is_empty():
			_pair_begin()
		_pan_step()
		return true
	if not _touches.has(touch.index):
		return true
	_touches.erase(touch.index)
	_touch_order.erase(touch.index)
	if touch.canceled:
		_touch_cancelled = true
	if not _touch_cancelled and not _swiping:
		var moved := _pan_step()
		if not moved.is_empty():
			_apply_touch(moved["pan"], 0.0, 0.0, moved["around"])
	if not _pair.is_empty() and (not _touches.has(_pair[0]) or not _touches.has(_pair[1])):
		_pair_reset()
	var tapped := _tap_on_end(now)
	if _swipe_index >= 0:
		if _touches.is_empty():
			_swipe_reset()
	elif tapped.size() > 0:
		_tap_time = now
		_tap_spot = tapped[0]
	if _touches.is_empty():
		_touch_finish(tapped)
	return true


func _on_touch_drag(drag: InputEventScreenDrag) -> bool:
	if not _touches.has(drag.index):
		return true
	_touches[drag.index] = drag.position
	_tap_on_move(drag.position)
	_touch_moved = true
	return true


func _flush_touch() -> void:
	if not _touch_moved:
		return
	_touch_moved = false
	if _touch_cancelled or _touches.is_empty():
		return
	if not bool(map_view.get("_dragging")):
		_touch_cancelled = true
		_touch_record.clear()
		return
	_mark()
	var swipe := _swipe_step()
	if _swiping:
		_pan_seen = {}
		_pan_sum = Vector2.ZERO
		_pair_reset()
		if not is_nan(swipe) and swipe != 0.0:
			_apply_touch(Vector2.ZERO, swipe, 0.0, null)
		return
	var moved := _pan_step()
	var paired := _pair_step()
	var pan: Vector2 = moved.get("pan", Vector2.ZERO)
	var zoom_delta := float(paired.get("zoom", 0.0))
	var bearing_delta := float(paired.get("bearing", 0.0))
	if pan == Vector2.ZERO and zoom_delta == 0.0 and bearing_delta == 0.0:
		return
	var around: Variant = paired.get("pinch", moved.get("around"))
	_apply_touch(pan, zoom_delta, bearing_delta, around)


func _touch_begin() -> void:
	_mark()
	stop()
	map_view.extras_stop_flight()
	map_view.get_viewport().gui_release_focus()
	map_view.set("_dragging", true)
	if globe:
		globe.held = true
	_touch_cancelled = false
	_touch_record.clear()
	_pan_seen = {}
	_pan_sum = Vector2.ZERO
	_pair_used = false


func _touch_finish(tapped: Array) -> void:
	_touch_order.clear()
	_pan_seen = {}
	if globe:
		globe.held = false
	var cancelled := _touch_cancelled or not bool(map_view.get("_dragging"))
	map_view.set("_dragging", false)
	if cancelled:
		_touch_record.clear()
		return
	if tapped.size() > 0 and _pan_sum.length() < CLICK_TOLERANCE and not _pair_used:
		_click(tapped[0])
	_pan_sum = Vector2.ZERO
	_touch_inertia()


func _pan_step() -> Dictionary:
	var point_sum := Vector2.ZERO
	var delta_sum := Vector2.ZERO
	var count := 0
	for index in _touches.keys():
		if not _pan_seen.has(index):
			continue
		var point: Vector2 = _touches[index]
		point_sum += point
		delta_sum += point - (_pan_seen[index] as Vector2)
		count += 1
	_pan_seen = _touches.duplicate()
	if count < 1 or delta_sum == Vector2.ZERO:
		return {}
	var delta := delta_sum / count
	_pan_sum += delta
	if _pan_sum.length() < CLICK_TOLERANCE:
		return {}
	return {"pan": delta, "around": point_sum / count}


func _pair_begin() -> void:
	_pair = [_touch_order[0], _touch_order[1]]
	var a: Vector2 = _touches[_pair[0]]
	var b: Vector2 = _touches[_pair[1]]
	_pair_start_distance = a.distance_to(b)
	_pair_distance = _pair_start_distance
	_pair_start_vector = a - b
	_pair_vector = _pair_start_vector
	_pair_min_diameter = _pair_start_distance
	_pair_zooming = false
	_pair_turning = false


func _pair_reset() -> void:
	_pair = []
	_pair_zooming = false
	_pair_turning = false


func _pair_step() -> Dictionary:
	if _pair.is_empty() or not _touches.has(_pair[0]) or not _touches.has(_pair[1]):
		return {}
	var a: Vector2 = _touches[_pair[0]]
	var b: Vector2 = _touches[_pair[1]]
	var pinch := (a + b) * 0.5
	var out := {}
	var last_distance := _pair_distance
	_pair_distance = a.distance_to(b)
	if _pair_zooming or absf(log(maxf(_pair_distance, 1e-6) / maxf(_pair_start_distance, 1e-6)) / log(2.0)) >= TOUCH_ZOOM_THRESHOLD:
		_pair_zooming = true
		_pair_used = true
		out["zoom"] = log(maxf(_pair_distance, 1e-6) / maxf(last_distance, 1e-6)) / log(2.0)
		out["pinch"] = pinch
	var last_vector := _pair_vector
	_pair_vector = a - b
	if not _pair_turning:
		_pair_min_diameter = minf(_pair_min_diameter, _pair_vector.length())
		var threshold := TOUCH_ROTATION_THRESHOLD / maxf(PI * _pair_min_diameter, 1e-6) * 360.0
		if absf(angle_with(_pair_vector, _pair_start_vector)) >= threshold:
			_pair_turning = true
	if _pair_turning:
		_pair_used = true
		out["bearing"] = angle_with(_pair_vector, last_vector)
		out["pinch"] = pinch
	return out


static func angle_with(a: Vector2, b: Vector2) -> float:
	return rad_to_deg(atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y))


func _tap_on_start(point: Vector2, now: int) -> void:
	if _tap_has or _touches.size() > 1:
		_tap_aborted = true
	if _tap_aborted:
		return
	if _tap_begun < 0:
		_tap_begun = now
	if _touches.size() == 1:
		_tap_has = true
		_tap_point = point


func _tap_on_move(point: Vector2) -> void:
	if _tap_aborted or not _tap_has:
		return
	if point.distance_to(_tap_point) > TAP_MAX_DISTANCE:
		_tap_aborted = true


func _tap_on_end(now: int) -> Array:
	if not _tap_has or now - _tap_begun > TAP_MAX_TOUCH_MS:
		_tap_aborted = true
	if not _touches.is_empty():
		return []
	var found: Array = [] if _tap_aborted else [_tap_point]
	_tap_has = false
	_tap_begun = -1
	_tap_aborted = false
	return found


func _swipe_on_start(now: int) -> void:
	if _swipe_index >= 0 or _tap_time < 0 or _touch_order.is_empty():
		return
	var first: Vector2 = _touches[_touch_order[0]]
	if now - _tap_time < TAP_MAX_INTERVAL_MS and _tap_spot.distance_to(first) < TAP_MAX_DISTANCE:
		_swipe_index = _touch_order[0]
		_swipe_point = first
	else:
		_swipe_reset()


func _swipe_step() -> float:
	if _swipe_index < 0 or _touch_order.is_empty() or _touch_order[0] != _swipe_index:
		return NAN
	var point: Vector2 = _touches[_swipe_index]
	var distance := point.y - _swipe_point.y
	_swipe_point = point
	_swiping = true
	return distance / TAP_DRAG_ZOOM_PIXELS


func _swipe_reset() -> void:
	_swipe_index = -1
	_swiping = false
	_tap_time = -1


func _world_at(at: Vector2) -> Vector2:
	if globe:
		globe.sync_active()
	if globe and globe.active:
		var frame := globe._compute_frame()
		if globe._globe_controls():
			var lonlat := globe._unproject_location(frame, at)
			var world := GlobeView.world_of_lonlat(lonlat.x, lonlat.y)
			world.x += MapView.WORLD_WIDTH * roundf((map_view.camera.position.x - world.x) / MapView.WORLD_WIDTH)
			return world
		return globe.pick_world(at)
	return map_view.camera.position + (at - map_view.get_viewport_rect().size * 0.5) / map_view.camera.zoom.x


func _set_level(level: float) -> void:
	var limits := _zoom_limits()
	var target := clampf(level, limits.x, limits.y)
	if globe and globe.active and globe._globe_controls():
		globe._set_zoom(target)
	else:
		map_view.camera.zoom = Vector2.ONE * pow(2.0, target) / 8.0


func _pin_location(world: Vector2, at: Vector2) -> void:
	if globe:
		globe.sync_active()
	if globe and globe.active and globe._globe_controls():
		globe._set_location_at_point(GlobeView.lonlat_of_world(world), at)
	elif globe and globe.active:
		globe.pin_world(world, at)
	else:
		var delta := world - _world_at(at)
		delta.x -= MapView.WORLD_WIDTH * roundf(delta.x / MapView.WORLD_WIDTH)
		map_view.camera.position += delta
	map_view.call("_after_camera_move")


func _apply_touch(pan: Vector2, zoom_delta: float, bearing_delta: float, around: Variant) -> void:
	var size := map_view.get_viewport_rect().size
	var at: Vector2 = around if around is Vector2 else size * 0.5
	_touch_record.append([Time.get_ticks_msec(), pan, zoom_delta, bearing_delta, around])
	if globe:
		globe.sync_active()
	if globe and globe.active and globe._globe_controls():
		if bearing_delta != 0.0:
			map_view.bearing = wrap_bearing(map_view.bearing + bearing_delta)
		if zoom_delta != 0.0:
			globe._zoom_around(at, zoom_delta)
		if pan != Vector2.ZERO:
			globe._pan(pan)
		globe._moved()
		return
	var before := _world_at(at - pan)
	if bearing_delta != 0.0:
		map_view.bearing = wrap_bearing(map_view.bearing + bearing_delta)
	if zoom_delta != 0.0:
		_set_level(map_view.zoom_level() + zoom_delta)
	if at.distance_squared_to(size * 0.5) < 1e-2:
		map_view.call("_after_camera_move")
		return
	_pin_location(before, at)


static func inertia_easing(amount: float, seconds_span: float, linearity: float, deceleration: float, max_speed: float) -> Vector2:
	var speed := clampf(amount * linearity / seconds_span, -max_speed, max_speed) if seconds_span > 0.0 else (max_speed if amount > 0.0 else -max_speed)
	var seconds := absf(speed) / (deceleration * linearity)
	return Vector2(speed * seconds / 2.0, seconds * 1000.0)


func _touch_inertia() -> void:
	var now := Time.get_ticks_msec()
	while not _touch_record.is_empty() and now - int(_touch_record[0][0]) > INERTIA_CUTOFF_MS:
		_touch_record.pop_front()
	if _touch_record.size() < 2 or _reduced():
		_touch_record.clear()
		return
	var pan := Vector2.ZERO
	var zoom := 0.0
	var bearing := 0.0
	var around: Variant = null
	for entry in _touch_record:
		pan += entry[1] as Vector2
		zoom += float(entry[2])
		bearing += float(entry[3])
		if entry[4] is Vector2:
			around = entry[4]
	var span := float(int(_touch_record[_touch_record.size() - 1][0]) - int(_touch_record[0][0])) / 1000.0
	_touch_record.clear()
	var ease := {"start": now, "duration": 0.0, "curve": "inertia"}
	if pan.length() > 0.0:
		var moved := inertia_easing(pan.length(), span, PAN_LINEARITY, PAN_DECELERATION, PAN_MAX_SPEED)
		ease["pan"] = pan * (moved.x / pan.length())
		ease["applied"] = Vector2.ZERO
		ease["duration"] = maxf(float(ease["duration"]), moved.y)
	if zoom != 0.0:
		var zoomed := inertia_easing(zoom, span, INERTIA_LINEARITY, ZOOM_INERTIA_DECELERATION, ZOOM_INERTIA_MAX_SPEED)
		var limits := _zoom_limits()
		ease["zoom_from"] = map_view.zoom_level()
		ease["zoom_to"] = clampf(map_view.zoom_level() + zoomed.x, limits.x, limits.y)
		ease["duration"] = maxf(float(ease["duration"]), zoomed.y)
	if bearing != 0.0:
		var turned := inertia_easing(bearing, span, INERTIA_LINEARITY, BEARING_INERTIA_DECELERATION, BEARING_INERTIA_MAX_SPEED)
		ease["bearing_from"] = map_view.bearing
		ease["bearing_to"] = map_view.bearing + clampf(turned.x, -179.0, 179.0)
		ease["duration"] = maxf(float(ease["duration"]), turned.y)
	if zoom != 0.0 or bearing != 0.0:
		var at: Vector2 = around if around is Vector2 else map_view.get_viewport_rect().size * 0.5
		ease.erase("pan")
		ease["pin_at"] = at
		ease["pin"] = _world_at(at)
	if ease.has("pan") or ease.has("pin"):
		_ease = ease


func _touch_ease_step(ease: Dictionary, k: float) -> void:
	if ease.has("bearing_to"):
		map_view.bearing = wrap_bearing(lerpf(float(ease["bearing_from"]), float(ease["bearing_to"]), k))
	if ease.has("zoom_to"):
		_set_level(lerpf(float(ease["zoom_from"]), float(ease["zoom_to"]), k))
	_pin_location(ease["pin"], ease["pin_at"])


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
