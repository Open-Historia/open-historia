class_name PhoneShell
extends Node

signal back_unhandled
signal paused
signal resumed

const BACK_DEVICE := 7331
const SYSTEM_STOP_GRACE_MS := 20000
const KEYBOARD_GAP := 12.0
const REPLAY_DEVICE := 7332
const SCROLL_SLOP := 10.0
const FLING_DECAY := 4.0
const FLING_STOP := 30.0

static var resume_game_id := ""

var engine: EngineLink
var host: Node
var asking := false
var _leave_dialog: ConfirmationDialog
var is_paused := false
var _resumed_at := -SYSTEM_STOP_GRACE_MS
var _lifted_layer: CanvasLayer
var _lifted_from := Vector2.ZERO
var _lifted_by := 0.0
var _touch_index := -1
var _touch_start := Vector2.ZERO
var _scroller: ScrollContainer
var _scroll_axis := Vector2.ZERO
var _scrolling := false
var _velocity := Vector2.ZERO
var _last_drag_ms := 0
var _fling: ScrollContainer
var _fling_velocity := Vector2.ZERO
var _held_press: InputEventMouseButton
var _router: TouchRouter
var _debug_timer: Timer


func _init() -> void:
	name = "PhoneShell"
	process_mode = Node.PROCESS_MODE_ALWAYS


func setup(link: EngineLink, owner_node: Node) -> void:
	engine = link
	host = owner_node
	if not get_tree().node_added.is_connected(_on_node_added):
		get_tree().node_added.connect(_on_node_added)
	if OS.is_debug_build() and FileAccess.file_exists(OS.get_user_data_dir().path_join("standin-model")) and _debug_timer == null:
		_debug_timer = Timer.new()
		_debug_timer.wait_time = 1.0
		_debug_timer.timeout.connect(_debug_requests)
		add_child(_debug_timer)
		_debug_timer.start()
	if _router == null:
		_router = TouchRouter.new()
		_router.shell = self
		get_tree().root.add_child.call_deferred(_router)


func _debug_requests() -> void:
	var path := OS.get_user_data_dir().path_join("debug-requests.jsonl")
	if not FileAccess.file_exists(path) or engine == null or not engine.is_ready():
		return
	var lines := FileAccess.get_file_as_string(path).split("\n", false)
	DirAccess.remove_absolute(path)
	for line in lines:
		var item: Variant = JSON.parse_string(line)
		if not (item is Dictionary):
			continue
		var method := str((item as Dictionary).get("method", ""))
		if method == "ui.war_room":
			host.call("_call", host.get("war_room"), "toggle")
			print("[debug-request] ui.war_room")
			continue
		var started := Time.get_ticks_msec()
		var reply: Dictionary = await engine.request(method, (item as Dictionary).get("args", {}))
		print("[debug-request] %s ok=%s in %d ms" % [method, reply.get("ok", false), Time.get_ticks_msec() - started])
		host.call("_world_changed")
		host.call("_refresh_war_parts")


func _exit_tree() -> void:
	if _router and is_instance_valid(_router):
		_router.queue_free()
	_router = null


class TouchRouter extends Node:
	var shell: PhoneShell

	func _init() -> void:
		name = "PhoneTouch"
		process_mode = Node.PROCESS_MODE_ALWAYS

	func _input(event: InputEvent) -> void:
		if shell and is_instance_valid(shell):
			shell.route_input(event)


func _on_node_added(node: Node) -> void:
	if node is BaseButton or node is LineEdit:
		_fit_tap.call_deferred(weakref(node))


func _fit_tap(ref: WeakRef) -> void:
	var control := ref.get_ref() as Control
	if control == null or control.has_meta("oh_tap_exempt"):
		return
	var least := Vector2(0, UI.PHONE_TAP)
	if control is BaseButton and not (control is CheckBox or control is CheckButton) and str(control.get("text")).is_empty():
		least.x = UI.PHONE_TAP
	control.custom_minimum_size = control.custom_minimum_size.max(least)


func _notification(what: int) -> void:
	match what:
		NOTIFICATION_WM_GO_BACK_REQUEST:
			back()
		NOTIFICATION_APPLICATION_PAUSED:
			_on_paused()
		NOTIFICATION_APPLICATION_RESUMED:
			_on_resumed()


func back() -> void:
	if _leave_dialog and is_instance_valid(_leave_dialog) and _leave_dialog.visible:
		_leave_dialog.hide()
		_leave_dialog.canceled.emit()
		return
	var press := InputEventKey.new()
	press.keycode = KEY_ESCAPE
	press.physical_keycode = KEY_ESCAPE
	press.pressed = true
	press.device = BACK_DEVICE
	Input.parse_input_event(press)
	var release := press.duplicate() as InputEventKey
	release.pressed = false
	Input.parse_input_event(release)


func _unhandled_key_input(event: InputEvent) -> void:
	var key := event as InputEventKey
	if key == null or key.device != BACK_DEVICE or not key.pressed or key.keycode != KEY_ESCAPE:
		return
	get_viewport().set_input_as_handled()
	back_unhandled.emit()
	if host and host.has_method("close_top") and bool(host.call("close_top")):
		return
	if not asking:
		ask_to_leave()


func ask_to_leave() -> void:
	if asking or host == null:
		return
	asking = true
	_leave_dialog = ConfirmationDialog.new()
	_leave_dialog.title = "Open Historia"
	_leave_dialog.dialog_text = "Leave Open Historia?"
	_leave_dialog.ok_button_text = "Leave"
	_leave_dialog.cancel_button_text = "Stay"
	host.add_child(_leave_dialog)
	var answer := [false, false]
	_leave_dialog.confirmed.connect(func() -> void:
		answer[0] = true
		answer[1] = true)
	_leave_dialog.canceled.connect(func() -> void: answer[1] = true)
	_leave_dialog.popup_centered()
	while not answer[1] and is_instance_valid(_leave_dialog):
		await get_tree().process_frame
	if is_instance_valid(_leave_dialog):
		_leave_dialog.queue_free()
	_leave_dialog = null
	asking = false
	if answer[0] and is_inside_tree():
		get_tree().root.propagate_notification(NOTIFICATION_WM_CLOSE_REQUEST)


func stopped_by_system() -> bool:
	return is_paused or Time.get_ticks_msec() - _resumed_at < SYSTEM_STOP_GRACE_MS


func _on_paused() -> void:
	is_paused = true
	if engine and engine.is_ready():
		engine.request("presence", {"visible": false})
	paused.emit()


func _on_resumed() -> void:
	is_paused = false
	_resumed_at = Time.get_ticks_msec()
	if engine and engine.is_ready():
		engine.request("presence", {"visible": true})
	resumed.emit()


func keyboard_height() -> float:
	var preview := OS.get_environment("OH_PHONE_KEYBOARD")
	if UI.phone_preview() != Vector2.ZERO:
		return float(preview) if preview.is_valid_float() and _typing_in() != null else 0.0
	if not DisplayServer.has_feature(DisplayServer.FEATURE_VIRTUAL_KEYBOARD):
		return 0.0
	var factor := maxf(0.01, get_tree().root.content_scale_factor)
	return float(DisplayServer.virtual_keyboard_get_height()) / factor


func _typing_in() -> Control:
	var focus := get_viewport().gui_get_focus_owner()
	if focus is LineEdit or focus is TextEdit:
		return focus
	return null


func route_input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		_on_touch(event as InputEventScreenTouch)
	elif event is InputEventScreenDrag:
		_on_drag(event as InputEventScreenDrag)
	elif event is InputEventMouseButton and event.device == InputEvent.DEVICE_ID_EMULATION:
		_on_emulated_button(event as InputEventMouseButton)
	elif _scrolling and event is InputEventMouseMotion and event.device == InputEvent.DEVICE_ID_EMULATION:
		get_viewport().set_input_as_handled()


func _on_emulated_button(button: InputEventMouseButton) -> void:
	if button.button_index != MOUSE_BUTTON_LEFT:
		return
	if button.pressed:
		_held_press = null
		if _press_waits(get_viewport().gui_get_hovered_control()):
			_held_press = button.duplicate() as InputEventMouseButton
			get_viewport().set_input_as_handled()
		return
	if _held_press == null:
		if _scrolling:
			get_viewport().set_input_as_handled()
		return
	var press := _held_press
	_held_press = null
	get_viewport().set_input_as_handled()
	if _scrolling:
		return
	press.device = REPLAY_DEVICE
	var release := button.duplicate() as InputEventMouseButton
	release.device = REPLAY_DEVICE
	_replay.call_deferred(press, release)


func _replay(press: InputEventMouseButton, release: InputEventMouseButton) -> void:
	var viewport := get_viewport()
	if viewport == null:
		return
	viewport.push_input(press, true)
	viewport.push_input(release, true)


func _press_waits(under: Control) -> bool:
	if under == null or under is Range or under is LineEdit or under is TextEdit:
		return false
	var at := under
	while at != null:
		if at is ScrollContainer and at.is_visible_in_tree():
			var scroll := at as ScrollContainer
			if scroll.get_v_scroll_bar().max_value > scroll.size.y + 1.0 or scroll.get_h_scroll_bar().max_value > scroll.size.x + 1.0:
				return true
		at = at.get_parent() as Control
	return false


func _on_touch(touch: InputEventScreenTouch) -> void:
	if touch.pressed:
		if _touch_index < 0 or touch.index == _touch_index:
			_touch_index = touch.index
			_touch_start = touch.position
			_scrolling = false
			_scroller = null
			_fling = null
			_velocity = Vector2.ZERO
		return
	if touch.index != _touch_index:
		return
	_touch_index = -1
	if not _scrolling:
		return
	get_viewport().set_input_as_handled()
	if _scroller and is_instance_valid(_scroller) and Time.get_ticks_msec() - _last_drag_ms < 80:
		_fling = _scroller
		_fling_velocity = _velocity
	_scroller = null


func _on_drag(drag: InputEventScreenDrag) -> void:
	if drag.index != _touch_index:
		return
	if not _scrolling:
		var moved := drag.position - _touch_start
		if moved.length() < SCROLL_SLOP:
			return
		var found := _scroller_for(moved)
		if found == null:
			if _held_press != null:
				_scrolling = true
			_touch_index = -1
			return
		_scroller = found
		_scrolling = true
	if not is_instance_valid(_scroller):
		_scrolling = false
		return
	var step := drag.relative * _scroll_axis
	_scroll_by(_scroller, -step)
	var now := Time.get_ticks_msec()
	var elapsed := maxf(1.0, float(now - _last_drag_ms))
	_velocity = _velocity.lerp(-step / (elapsed / 1000.0), 0.5) if _last_drag_ms > 0 and elapsed < 100.0 else -step / (elapsed / 1000.0)
	_last_drag_ms = now
	get_viewport().set_input_as_handled()


func _scroller_for(moved: Vector2) -> ScrollContainer:
	var under: Control = get_viewport().gui_get_hovered_control()
	var vertical := absf(moved.y) >= absf(moved.x)
	while under != null:
		if under is ScrollContainer and under.is_visible_in_tree():
			var scroll := under as ScrollContainer
			if vertical and scroll.vertical_scroll_mode != ScrollContainer.SCROLL_MODE_DISABLED and scroll.get_v_scroll_bar().max_value > scroll.size.y + 1.0:
				_scroll_axis = Vector2(0, 1)
				return scroll
			if not vertical and scroll.horizontal_scroll_mode != ScrollContainer.SCROLL_MODE_DISABLED and scroll.get_h_scroll_bar().max_value > scroll.size.x + 1.0:
				_scroll_axis = Vector2(1, 0)
				return scroll
		under = under.get_parent() as Control
	return null


func _scroll_by(scroll: ScrollContainer, amount: Vector2) -> void:
	if amount.y != 0.0:
		scroll.scroll_vertical = int(round(float(scroll.scroll_vertical) + amount.y))
	if amount.x != 0.0:
		scroll.scroll_horizontal = int(round(float(scroll.scroll_horizontal) + amount.x))


func _fling_step(delta: float) -> void:
	if _fling == null:
		return
	if not is_instance_valid(_fling) or _fling_velocity.length() < FLING_STOP:
		_fling = null
		return
	var before := Vector2(_fling.scroll_horizontal, _fling.scroll_vertical)
	_scroll_by(_fling, _fling_velocity * delta)
	_fling_velocity *= exp(-FLING_DECAY * delta)
	if Vector2(_fling.scroll_horizontal, _fling.scroll_vertical) == before:
		_fling = null


func _process(delta: float) -> void:
	_fling_step(delta)
	var field := _typing_in()
	var height := keyboard_height() if field else 0.0
	if field == null or height <= 0.0:
		_drop_lift()
		return
	var layer := field.get_canvas_layer_node()
	if layer == null:
		return
	if _lifted_layer != layer:
		_drop_lift()
		_lifted_layer = layer
		_lifted_from = layer.offset
		_lifted_by = 0.0
	var view_height := get_viewport().get_visible_rect().size.y
	var bottom := field.get_global_transform_with_canvas() * Vector2(0, field.size.y)
	var resting := bottom.y + _lifted_by
	var wanted := clampf(resting + KEYBOARD_GAP - (view_height - height), 0.0, height)
	if not is_equal_approx(wanted, _lifted_by):
		_lifted_by = wanted
		layer.offset = _lifted_from - Vector2(0, _lifted_by)


func _drop_lift() -> void:
	if _lifted_layer and is_instance_valid(_lifted_layer):
		_lifted_layer.offset = _lifted_from
	_lifted_layer = null
	_lifted_by = 0.0
