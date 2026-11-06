class_name PhoneShell
extends Node

signal back_unhandled
signal paused
signal resumed

const BACK_DEVICE := 7331
const SYSTEM_STOP_GRACE_MS := 20000
const KEYBOARD_GAP := 12.0

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


func _init() -> void:
	name = "PhoneShell"
	process_mode = Node.PROCESS_MODE_ALWAYS


func setup(link: EngineLink, owner_node: Node) -> void:
	engine = link
	host = owner_node
	if not get_tree().node_added.is_connected(_on_node_added):
		get_tree().node_added.connect(_on_node_added)


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


func _process(_delta: float) -> void:
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
