class_name DiscordInvites
extends Control

signal joined

const POLL_SECONDS := 3.0
const CARD_WIDTH := 384.0
const GLASS := Color(20 / 255.0, 20 / 255.0, 23 / 255.0, 0.94)
const GLASS_BORDER := Color(1, 1, 1, 0.12)
const INK := Color(226 / 255.0, 226 / 255.0, 229 / 255.0)
const SOFT := Color(1, 1, 1, 0.6)
const PROBLEM := Color("#fca5a5")
const BUTTON_BG := Color(1, 1, 1, 0.06)
const BUTTON_BORDER := Color(1, 1, 1, 0.16)
const PRIMARY_BG := Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.18)
const PRIMARY_BORDER := Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.55)
const PRIMARY_INK := Color("#e6f8ff")

var engine: EngineLink
var invite := {}
var requests: Array = []
var busy := false
var joining := false
var error := ""
var _reading := false
var _timer: Timer
var _holder: CenterContainer


func _init() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_holder = CenterContainer.new()
	_holder.anchor_left = 0.0
	_holder.anchor_right = 1.0
	_holder.anchor_top = 1.0
	_holder.anchor_bottom = 1.0
	_holder.offset_top = -19.0
	_holder.offset_bottom = -19.0
	_holder.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_holder)
	visible = false


func setup(link: EngineLink, _extra := {}) -> void:
	engine = link
	if not _timer:
		_timer = Timer.new()
		_timer.wait_time = POLL_SECONDS
		_timer.autostart = true
		_timer.timeout.connect(read)
		add_child(_timer)
	await read()


func read() -> void:
	if engine == null or _reading or not engine.is_ready():
		return
	_reading = true
	var reply := await engine.request("discord.inbox")
	_reading = false
	if not reply.get("ok", false) or not is_instance_valid(self):
		return
	var inbox: Dictionary = reply.get("result", {})
	var join: Variant = inbox.get("join")
	if join is Dictionary and not str((join as Dictionary).get("token", "")).is_empty():
		error = ""
		invite = {"token": str((join as Dictionary).get("token", ""))}
	busy = inbox.get("busy", false) == true
	var next: Array = inbox.get("requests", []) if inbox.get("requests") is Array else []
	if next != requests or join is Dictionary:
		requests = next
		_render()


func _render() -> void:
	for child in _holder.get_children():
		_holder.remove_child(child)
		child.queue_free()
	var request: Dictionary = requests[0] if not requests.is_empty() and requests[0] is Dictionary else {}
	visible = not invite.is_empty() or not request.is_empty()
	if not visible:
		return
	var width := minf(CARD_WIDTH, get_viewport_rect().size.x - 32.0)
	var card := PanelContainer.new()
	card.custom_minimum_size.x = width
	card.mouse_filter = Control.MOUSE_FILTER_STOP
	var style := UI.box(GLASS, GLASS_BORDER, 14, 1, Vector4(18, 16, 18, 16))
	style.shadow_color = Color(0, 0, 0, 0.5)
	style.shadow_size = 25
	style.shadow_offset = Vector2(0, 9)
	card.add_theme_stylebox_override("panel", style)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	card.add_child(column)
	var buttons := HBoxContainer.new()
	buttons.alignment = BoxContainer.ALIGNMENT_END
	buttons.add_theme_constant_override("separation", 10)
	if not invite.is_empty():
		var heading := _title("A friend invited you to a shared game")
		heading.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		column.add_child(heading)
		column.add_child(_gap(6))
		column.add_child(_body("Leave the shared game you are in first, then join this one." if busy else "You were invited on Discord. You will need the lobby's scenario in your library.", SOFT))
		column.add_child(_gap(13))
		if not error.is_empty():
			column.add_child(_body(error, PROBLEM))
			column.add_child(_gap(11))
		var later := _button("Not now", false)
		later.pressed.connect(func() -> void:
			invite = {}
			_render())
		buttons.add_child(later)
		var join := _button("Joining…" if joining else "Join", true)
		join.disabled = busy or joining
		join.pressed.connect(_join)
		buttons.add_child(join)
	else:
		var asker := _title("%s asks to join your shared game" % str(request.get("name", "Someone")))
		asker.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		column.add_child(asker)
		column.add_child(_gap(6))
		column.add_child(_body("Accept, and Discord sends them your invitation.", SOFT))
		column.add_child(_gap(13))
		var decline := _button("Decline", false)
		decline.pressed.connect(func() -> void: _answer(request, false))
		buttons.add_child(decline)
		var accept := _button("Accept", true)
		accept.pressed.connect(func() -> void: _answer(request, true))
		buttons.add_child(accept)
	column.add_child(buttons)
	_holder.add_child(card)


func _title(value: String) -> Label:
	return UI.label(value, 16, INK, 800)


func _body(value: String, color: Color) -> Label:
	var node := UI.wrapped(value, 13, color)
	node.custom_minimum_size.x = 1
	node.add_theme_constant_override("line_spacing", 3)
	return node


func _gap(height: float) -> Control:
	var node := Control.new()
	node.custom_minimum_size.y = height
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return node


func _button(caption: String, primary: bool) -> Button:
	var node := Button.new()
	node.text = caption
	node.focus_mode = Control.FOCUS_NONE
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	node.custom_minimum_size.y = 38
	node.add_theme_font_override("font", UI.font(700))
	node.add_theme_font_size_override("font_size", 14)
	var ink := PRIMARY_INK if primary else INK
	for state in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		node.add_theme_color_override(state, ink)
	node.add_theme_color_override("font_disabled_color", Color(ink, 0.5))
	var bg := PRIMARY_BG if primary else BUTTON_BG
	var border := PRIMARY_BORDER if primary else BUTTON_BORDER
	var normal := UI.box(bg, border, 10, 1, Vector4(16, 0, 16, 0))
	var hover := UI.box(Color(bg, minf(1.0, bg.a + 0.08)), Color(border, minf(1.0, border.a + 0.15)), 10, 1, Vector4(16, 0, 16, 0))
	for state in ["normal", "focus", "disabled"]:
		node.add_theme_stylebox_override(state, normal)
	for state in ["hover", "pressed", "hover_pressed"]:
		node.add_theme_stylebox_override(state, hover)
	return node


func _join() -> void:
	if invite.is_empty() or joining:
		return
	joining = true
	error = ""
	_render()
	var state := await engine.request("multiplayer.state")
	var remembered := str((state.get("result", {}) as Dictionary).get("name", "")) if state.get("ok", false) else ""
	var reply := await engine.request("multiplayer.join", {"token": str(invite.get("token", "")), "name": remembered if not remembered.is_empty() else "Player"})
	joining = false
	if not is_instance_valid(self):
		return
	if reply.get("ok", false):
		invite = {}
		_render()
		joined.emit()
		return
	error = str(reply.get("error", ""))
	_render()


func _answer(request: Dictionary, accept: bool) -> void:
	var id := str(request.get("id", ""))
	requests = requests.filter(func(entry: Variant) -> bool: return not (entry is Dictionary and str((entry as Dictionary).get("id", "")) == id))
	_render()
	engine.request("discord.answer", {"userId": id, "accept": accept})
