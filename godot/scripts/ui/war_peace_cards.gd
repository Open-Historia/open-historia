class_name WarPeaceCards
extends Control

signal answered(op: String, ref: String)

const CARD_BG := Color(16 / 255.0, 21 / 255.0, 24 / 255.0, 0.97)
const INK := Color(231 / 255.0, 233 / 255.0, 234 / 255.0)

var engine: EngineLink
var context: Dictionary = {}
var folded := false
var state: Dictionary = {}
var _busy: Dictionary = {}
var _errors: Dictionary = {}
var _column: VBoxContainer
var _scroll: ScrollContainer
var _timer: Timer
var _refreshing := false


func _init() -> void:
	anchor_left = 1.0
	anchor_right = 1.0
	anchor_top = 0.0
	anchor_bottom = 1.0
	offset_right = -16.0
	offset_top = 72.0
	offset_left = -16.0 - 352.0
	offset_bottom = -72.0
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_scroll = ScrollContainer.new()
	_scroll.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_scroll.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_scroll.get_v_scroll_bar().modulate.a = 0.0
	_column = VBoxContainer.new()
	_column.add_theme_constant_override("separation", 8)
	_column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_scroll.add_child(_column)
	add_child(_scroll)
	visible = false


func setup(link: EngineLink, setup_context: Dictionary = {}) -> void:
	engine = link
	context = setup_context
	var every := float(setup_context.get("poll_seconds", 5.0))
	if every > 0.0 and not _timer:
		_timer = Timer.new()
		_timer.wait_time = every
		_timer.autostart = true
		_timer.timeout.connect(refresh)
		add_child(_timer)
	await refresh()


func refresh() -> void:
	if not engine or _refreshing:
		return
	_refreshing = true
	var reply: Dictionary = await engine.request("country.warpeace")
	_refreshing = false
	if not reply.get("ok", false):
		return
	var next: Dictionary = reply.get("result", {})
	if next == state:
		return
	state = next
	_render()


func _resize_to_width() -> void:
	var width: float = min(352.0, get_viewport_rect().size.x - 32.0)
	offset_left = -16.0 - width


func _render() -> void:
	_resize_to_width()
	for child in _column.get_children():
		child.queue_free()
	var waiting := int(state.get("waiting", 0))
	visible = waiting > 0
	if waiting == 0:
		return
	if folded:
		var unfold := _pill_button("Waiting for your answer: %d" % waiting, CARD_BG, Color(1, 1, 1, 0.16), INK, 12, 800, Vector4(13, 11, 13, 11), 12)
		unfold.size_flags_horizontal = Control.SIZE_SHRINK_END
		unfold.pressed.connect(func() -> void:
			folded = false
			_render())
		_column.add_child(unfold)
		return
	var fold := _pill_button("Fold away", Color(16 / 255.0, 21 / 255.0, 24 / 255.0, 0.9), Color(1, 1, 1, 0.16), Color(1, 1, 1, 0.7), 10, 700, Vector4(10, 3, 10, 3), 999)
	fold.size_flags_horizontal = Control.SIZE_SHRINK_END
	fold.pressed.connect(func() -> void:
		folded = true
		_render())
	_column.add_child(fold)
	for item in state.get("calls", []):
		_column.add_child(_decision(item))
	for item in state.get("offers", []):
		_column.add_child(_decision(item))


func _pill_button(value: String, bg: Color, border: Color, ink: Color, size: int, weight: int, pad: Vector4, radius: int) -> Button:
	var node := Button.new()
	node.text = value
	node.focus_mode = Control.FOCUS_NONE
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	node.add_theme_font_override("font", UI.font(weight))
	node.add_theme_font_size_override("font_size", size)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		node.add_theme_color_override(name, ink)
	node.add_theme_color_override("font_disabled_color", Color(ink, ink.a * 0.5))
	var normal := UI.box(bg, border, radius, 1, pad)
	var hover := UI.box(Color(bg.r, bg.g, bg.b, min(1.0, bg.a + 0.05)).lightened(0.06), Color(border.r, border.g, border.b, min(1.0, border.a + 0.1)), radius, 1, pad)
	for entry in [["normal", normal], ["focus", normal], ["disabled", normal], ["hover", hover], ["pressed", hover], ["hover_pressed", hover]]:
		node.add_theme_stylebox_override(entry[0], entry[1])
	return node


func _decision(item: Variant) -> Control:
	var decision: Dictionary = item
	var id := str(decision.get("id", ""))
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", UI.box(CARD_BG, Color(1, 1, 1, 0.16), 12, 1, Vector4(13, 11, 13, 11)))
	card.mouse_filter = Control.MOUSE_FILTER_STOP
	var stack := VBoxContainer.new()
	stack.add_theme_constant_override("separation", 0)
	var title := UI.label(str(decision.get("title", "")).to_upper(), 10, Color(1, 1, 1, 0.55), 800, "Arial", 1)
	stack.add_child(title)
	stack.add_child(_gap(5))
	for entry in decision.get("lines", []):
		var line: Dictionary = entry
		if line.get("gap", false):
			stack.add_child(_gap(4))
		var tone := str(line.get("tone", "main"))
		var color := INK
		if tone == "soft":
			color = Color(1, 1, 1, 0.6)
		elif tone == "terms":
			color = Color(1, 1, 1, 0.8)
		stack.add_child(_wrapped(str(line.get("text", "")), 12, color))
	var error := str(_errors.get(id, ""))
	if not error.is_empty():
		stack.add_child(_gap(6))
		stack.add_child(_wrapped(error, 12, Color("#fca5a5")))
	stack.add_child(_gap(10))
	var buttons := HBoxContainer.new()
	buttons.add_theme_constant_override("separation", 8)
	var busy: bool = _busy.get(id, false)
	var yes := _pill_button(str(decision.get("yes", "")), UI.ACCENT, UI.ACCENT, Color("#04141a"), 12, 800, Vector4(10, 6, 10, 6), 8)
	yes.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	yes.custom_minimum_size.y = 37
	yes.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	yes.disabled = busy
	yes.pressed.connect(_answer.bind(str(decision.get("yesOp", "")), id))
	buttons.add_child(yes)
	var no := _pill_button(str(decision.get("no", "")), Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.18), INK, 12, 800, Vector4(10, 6, 10, 6), 8)
	no.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	no.custom_minimum_size.y = 37
	no.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	no.disabled = busy
	no.pressed.connect(_answer.bind(str(decision.get("noOp", "")), id))
	buttons.add_child(no)
	stack.add_child(buttons)
	card.add_child(stack)
	return card


func _gap(height: float) -> Control:
	var node := Control.new()
	node.custom_minimum_size.y = height
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return node


func _wrapped(value: String, size: int, color: Color) -> Label:
	var node := UI.label(value, size, color)
	node.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.custom_minimum_size.x = 1
	return node


func _answer(op: String, ref: String) -> void:
	if _busy.get(ref, false):
		return
	_busy[ref] = true
	_errors.erase(ref)
	_render()
	var reply: Dictionary = await engine.request("country.answer", {"op": op, "ref": ref})
	_busy.erase(ref)
	var result: Dictionary = reply.get("result", {}) if reply.get("ok", false) else {"ok": false, "said": str(reply.get("error", "That could not be done."))}
	if not result.get("ok", false):
		_errors[ref] = str(result.get("said", "That could not be done."))
		_render()
		return
	answered.emit(op, ref)
	state = {}
	await refresh()
