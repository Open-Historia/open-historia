class_name WarRoomButton
extends Control

signal pressed
signal presence_changed(at_war: bool)

const SIZE := 4.0 * 16.0
const BESIDE_DOCK_LEFT := 13.8 * 16.0
const DOCK_BOTTOM := 0.5 * 16.0
const OPEN_INSET := 1.1 * 16.0
const PHONE_SIZE := 3.0 * 16.0
const PHONE_BOTTOM := (0.5 + 4.0 + 0.35) * 16.0
const SWORDS := "<svg viewBox='0 0 24 24' fill='none' stroke-linecap='round' stroke-linejoin='round'><g stroke='#ffd6d6' stroke-opacity='0.5' stroke-width='2.1' transform='translate(0.45 0.6)'><path d='M5 4l12.5 12.5M16 19l3-3M18.2 17.8l2 2'/><path d='M19 4L6.5 16.5M8 19l-3-3M5.8 17.8l-2 2'/></g><g stroke='#220406' stroke-opacity='0.88' stroke-width='2.1'><path d='M5 4l12.5 12.5M16 19l3-3M18.2 17.8l2 2'/><path d='M19 4L6.5 16.5M8 19l-3-3M5.8 17.8l-2 2'/></g></svg>"

var engine: EngineLink
var at_war := false
var room_open := false
var in_game := true
var _menu: Control
var _hud: Control
var _swords: Texture2D
var _tween: Tween
var disc := SIZE


func _init() -> void:
	disc = PHONE_SIZE if UI.phone() else SIZE
	anchor_left = 0.0
	anchor_right = 0.0
	anchor_top = 1.0
	anchor_bottom = 1.0
	_place(false)
	mouse_filter = Control.MOUSE_FILTER_STOP
	mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	tooltip_text = "War room"
	focus_mode = Control.FOCUS_NONE
	texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	visible = false
	_swords = UI.svg_texture(SWORDS, 30.0 / 24.0)


func setup(engine_link: EngineLink, _context: Dictionary = {}) -> void:
	engine = engine_link


func set_in_game(value: bool) -> void:
	in_game = value
	_apply()
	if value:
		refresh()


func _game_shown() -> bool:
	if not in_game:
		return false
	if not _menu or not is_instance_valid(_menu) or not _hud or not is_instance_valid(_hud):
		_menu = null
		_hud = null
		var parent := get_parent()
		if parent:
			for child in parent.get_children():
				if child is MainMenu and not _menu:
					_menu = child
				elif child is Hud and not _hud:
					_hud = child
			for watched in [_menu, _hud]:
				if watched and not (watched as Control).visibility_changed.is_connected(_apply):
					(watched as Control).visibility_changed.connect(_apply)
			if _hud and not (_hud as Hud).dock_resized.is_connected(_apply):
				(_hud as Hud).dock_resized.connect(_apply)
	if _menu and _menu.visible:
		return false
	return room_open or not _hud or _hud.visible


func refresh() -> void:
	if not engine or not in_game:
		_apply()
		return
	var reply: Dictionary = await engine.request("warroom.fronts")
	if not reply.get("ok", false):
		_apply()
		return
	var result: Dictionary = reply.get("result", {})
	var next := bool(result.get("atWar", false))
	var changed := next != at_war
	at_war = next
	_apply()
	if changed:
		presence_changed.emit(at_war)


func set_room_open(value: bool) -> void:
	room_open = value
	_apply()
	queue_redraw()


func _apply() -> void:
	visible = _game_shown() and (at_war or room_open) and not (room_open and UI.phone())
	if _tween and _tween.is_valid():
		_tween.kill()
	var left := OPEN_INSET if room_open else _beside_dock()
	var bottom := OPEN_INSET if room_open else _closed_bottom()
	if not is_inside_tree():
		_place(room_open)
		return
	_tween = create_tween().set_parallel(true).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	_tween.tween_property(self, "offset_left", left, 0.3)
	_tween.tween_property(self, "offset_right", left + disc, 0.3)
	_tween.tween_property(self, "offset_top", -bottom - disc, 0.3)
	_tween.tween_property(self, "offset_bottom", -bottom, 0.3)


func _beside_dock() -> float:
	if UI.phone():
		return 8.0 + UI.safe_insets().x
	if _hud and is_instance_valid(_hud):
		return (_hud as Hud).beside_dock_left()
	return BESIDE_DOCK_LEFT


func _closed_bottom() -> float:
	if UI.phone():
		return PHONE_BOTTOM + UI.safe_insets().w
	return DOCK_BOTTOM


func _place(open_state: bool) -> void:
	var left := OPEN_INSET if open_state else _beside_dock()
	var bottom := OPEN_INSET if open_state else _closed_bottom()
	offset_left = left
	offset_right = left + disc
	offset_top = -bottom - disc
	offset_bottom = -bottom


func _draw() -> void:
	var rect := Rect2(Vector2.ZERO, Vector2(disc, disc))
	draw_texture_rect(WarRoomTheme.disc_texture(), rect, false)
	draw_arc(rect.get_center(), disc * 0.5 - 0.5, 0.0, TAU, 64, Color(0, 0, 0, 0.6), 1.0, true)
	if room_open:
		draw_arc(rect.get_center(), disc * 0.5 + 1.0, 0.0, TAU, 64, Color(1, 1, 1, 0.85), 2.0, true)
	if _swords:
		var at := rect.get_center() - _swords.get_size() * 0.5
		draw_texture(_swords, at)


func _has_point(point: Vector2) -> bool:
	return point.distance_to(Vector2(disc, disc) * 0.5) <= disc * 0.5


func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var button := event as InputEventMouseButton
		if button.button_index == MOUSE_BUTTON_LEFT and not button.pressed:
			accept_event()
			pressed.emit()
		elif button.button_index == MOUSE_BUTTON_LEFT:
			accept_event()
