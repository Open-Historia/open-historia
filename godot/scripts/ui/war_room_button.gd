class_name WarRoomButton
extends Control

signal pressed
signal presence_changed(at_war: bool)

const SIZE := 4.0 * 16.0
const BESIDE_DOCK_LEFT := 13.8 * 16.0
const DOCK_BOTTOM := 0.5 * 16.0
const OPEN_INSET := 1.1 * 16.0
const SWORDS := "<svg viewBox='0 0 24 24' fill='none' stroke-linecap='round' stroke-linejoin='round'><g stroke='#ffd6d6' stroke-opacity='0.5' stroke-width='2.1' transform='translate(0.45 0.6)'><path d='M5 4l12.5 12.5M16 19l3-3M18.2 17.8l2 2'/><path d='M19 4L6.5 16.5M8 19l-3-3M5.8 17.8l-2 2'/></g><g stroke='#220406' stroke-opacity='0.88' stroke-width='2.1'><path d='M5 4l12.5 12.5M16 19l3-3M18.2 17.8l2 2'/><path d='M19 4L6.5 16.5M8 19l-3-3M5.8 17.8l-2 2'/></g></svg>"

var engine: EngineLink
var at_war := false
var room_open := false
var _swords: Texture2D
var _tween: Tween


func _init() -> void:
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
	var image := Image.new()
	if image.load_svg_from_string(SWORDS, 30.0 / 24.0) == OK:
		_swords = ImageTexture.create_from_image(image)


func setup(engine_link: EngineLink, _context: Dictionary = {}) -> void:
	engine = engine_link


func refresh() -> void:
	if not engine:
		return
	var reply: Dictionary = await engine.request("warroom.fronts")
	if not reply.get("ok", false):
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
	visible = at_war or room_open
	if _tween and _tween.is_valid():
		_tween.kill()
	var left := OPEN_INSET if room_open else BESIDE_DOCK_LEFT
	var bottom := OPEN_INSET if room_open else DOCK_BOTTOM
	if not is_inside_tree():
		_place(room_open)
		return
	_tween = create_tween().set_parallel(true).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	_tween.tween_property(self, "offset_left", left, 0.3)
	_tween.tween_property(self, "offset_right", left + SIZE, 0.3)
	_tween.tween_property(self, "offset_top", -bottom - SIZE, 0.3)
	_tween.tween_property(self, "offset_bottom", -bottom, 0.3)


func _place(open_state: bool) -> void:
	var left := OPEN_INSET if open_state else BESIDE_DOCK_LEFT
	var bottom := OPEN_INSET if open_state else DOCK_BOTTOM
	offset_left = left
	offset_right = left + SIZE
	offset_top = -bottom - SIZE
	offset_bottom = -bottom


func _draw() -> void:
	var rect := Rect2(Vector2.ZERO, Vector2(SIZE, SIZE))
	draw_texture_rect(WarRoomTheme.disc_texture(), rect, false)
	draw_arc(rect.get_center(), SIZE * 0.5 - 0.5, 0.0, TAU, 64, Color(0, 0, 0, 0.6), 1.0, true)
	if room_open:
		draw_arc(rect.get_center(), SIZE * 0.5 + 1.0, 0.0, TAU, 64, Color(1, 1, 1, 0.85), 2.0, true)
	if _swords:
		var at := rect.get_center() - _swords.get_size() * 0.5
		draw_texture(_swords, at)


func _has_point(point: Vector2) -> bool:
	return point.distance_to(Vector2(SIZE, SIZE) * 0.5) <= SIZE * 0.5


func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var button := event as InputEventMouseButton
		if button.button_index == MOUSE_BUTTON_LEFT and not button.pressed:
			accept_event()
			pressed.emit()
		elif button.button_index == MOUSE_BUTTON_LEFT:
			accept_event()
