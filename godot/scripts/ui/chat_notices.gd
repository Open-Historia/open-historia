class_name ChatNotices
extends Control

signal open_thread(chat_id: String)

const MAX_ITEMS := 40
const MAX_TOASTS := 4
const TOAST_SECONDS := 12.0
const SAFETY_POLL_SECONDS := 30.0
const TOAST_WIDTH := 368.0
const CENTER_WIDTH := 352.0
const MONTHS := ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

var engine: EngineLink
var context: Dictionary = {}
var chat_panel: ChatPanel
var _items: Array = []
var _toasts: Array = []
var _seq := 0
var _center_open := false
var _sound := true
var _checking := false
var _recheck := false
var _was_open := false
var _toast_box: VBoxContainer
var _bell_holder: Control
var _bell: Button
var _center: GlassPanel
var _center_title: Label
var _center_list: VBoxContainer
var _center_scroll: ScrollContainer
var _sound_button: Button
var _desktop_button: Button
var _desktop_permission := "unsupported"
var _audio: AudioStreamPlayer
var _chime: AudioStreamWAV


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_toast_box = VBoxContainer.new()
	_toast_box.add_theme_constant_override("separation", 9)
	_toast_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_toast_box.anchor_left = 1.0
	_toast_box.anchor_right = 1.0
	_toast_box.offset_left = -12.0 - TOAST_WIDTH
	_toast_box.offset_right = -12.0
	_toast_box.offset_top = 70.0
	_toast_box.offset_bottom = 70.0
	add_child(_toast_box)
	_build_bell()
	_audio = AudioStreamPlayer.new()
	_chime = _make_chime()
	_audio.stream = _chime
	add_child(_audio)
	var safety := Timer.new()
	safety.wait_time = SAFETY_POLL_SECONDS
	safety.autostart = true
	safety.timeout.connect(_check)
	add_child(safety)
	_render()


func setup(engine_link: EngineLink, setup_context: Dictionary = {}) -> void:
	engine = engine_link
	context = setup_context
	var panel: Variant = context.get("chat_panel")
	if panel is ChatPanel:
		chat_panel = panel as ChatPanel
	if not engine.engine_event.is_connected(_on_engine_event):
		engine.engine_event.connect(_on_engine_event)
	var reply := await engine.request("chat.sound.get")
	if reply.get("ok", false):
		_sound = _dict(reply.get("result", {})).get("enabled", true) != false
	var desktop_reply := await engine.request("notify.desktop.get")
	if desktop_reply.get("ok", false):
		_desktop_permission = _s(_dict(desktop_reply.get("result", {})).get("permission", "unsupported"))
	_render()
	_check()


func refresh() -> void:
	_check()


func clear() -> void:
	for toast in _toasts:
		var node: Control = toast["node"]
		if is_instance_valid(node):
			node.queue_free()
	_toasts.clear()
	_items.clear()
	_center_open = false
	_render()


func count() -> int:
	return _items.size()


func _process(_delta: float) -> void:
	var open := chat_panel != null and chat_panel.is_open()
	if open != _was_open:
		_was_open = open
		if open:
			clear()
		else:
			_render()
		_check()
	var right := 12.0 + _right_inset()
	if not is_equal_approx(_toast_box.offset_right, -right):
		_toast_box.offset_right = -right
		_toast_box.offset_left = -right - TOAST_WIDTH


func _right_inset() -> float:
	var offset: Variant = context.get("right_offset")
	if offset is Callable and (offset as Callable).is_valid():
		return float((offset as Callable).call())
	var host := get_parent()
	if host:
		var layer: Variant = host.get("_right_layer")
		if layer is Control:
			return maxf(0.0, -(layer as Control).position.x)
	return 0.0


func _on_engine_event(event_name: String, data: Variant) -> void:
	if event_name == "notify.activated":
		_desktop_activated(_dict(data))
		return
	if event_name != "chat.changed":
		return
	if _dict(data).get("reason", "") == "game":
		clear()
	_check()


func _check() -> void:
	if not engine:
		return
	if _checking:
		_recheck = true
		return
	_checking = true
	var open := chat_panel != null and chat_panel.is_open()
	var viewing := chat_panel.active_chat_id() if chat_panel != null else ""
	var reply := await engine.request("chat.watch", {"panelOpen": open, "viewing": viewing})
	_checking = false
	if reply.get("ok", false):
		for item in _arr(_dict(reply.get("result", {})).get("items", [])):
			_push(_dict(item))
	if _recheck:
		_recheck = false
		_check()


func _push(item: Dictionary) -> void:
	_seq += 1
	var entry := item.duplicate()
	entry["id"] = _seq
	entry["at"] = Time.get_unix_time_from_system()
	_items.append(entry)
	while _items.size() > MAX_ITEMS:
		_items.pop_front()
	var node := _toast(entry)
	_toast_box.add_child(node)
	var timer := get_tree().create_timer(TOAST_SECONDS)
	_toasts.append({"id": _seq, "node": node, "item": entry})
	while _toasts.size() > MAX_TOASTS:
		var oldest: Dictionary = _toasts.pop_front()
		var oldest_node: Control = oldest["node"]
		if is_instance_valid(oldest_node):
			oldest_node.queue_free()
	var id := _seq
	timer.timeout.connect(func() -> void: _remove_toast(id))
	if _sound:
		_play_chime()
	if engine and _desktop_permission == "granted":
		_send_desktop(entry)
	_render()


func _send_desktop(entry: Dictionary) -> void:
	var reply := await engine.request("notify.desktop", {"sender": _s(entry.get("sender", "")), "preview": _s(entry.get("preview", "")), "chatId": _s(entry.get("chatId", "")), "notice": int(entry.get("id", 0))})
	var permission := _s(_dict(reply.get("result", {})).get("permission", ""))
	if not permission.is_empty() and permission != _desktop_permission:
		_desktop_permission = permission
		_render()


func _remove_toast(id: int) -> void:
	for index in range(_toasts.size()):
		if int(_toasts[index]["id"]) == id:
			var node: Control = _toasts[index]["node"]
			if is_instance_valid(node):
				node.queue_free()
			_toasts.remove_at(index)
			return


func _open_item(item: Dictionary) -> void:
	_remove_toast(int(item.get("id", 0)))
	var chat_id := _s(item.get("chatId", ""))
	if chat_id.is_empty():
		return
	for index in range(_items.size() - 1, -1, -1):
		if int(_items[index].get("id", 0)) == int(item.get("id", 0)):
			_items.remove_at(index)
	_center_open = false
	_render()
	if not get_signal_connection_list("open_thread").is_empty():
		open_thread.emit(chat_id)
	elif chat_panel != null:
		chat_panel.open_thread(chat_id)


func _render() -> void:
	if not _bell:
		return
	var panel_open := chat_panel != null and chat_panel.is_open()
	_toast_box.visible = not panel_open
	var bell_showing := not _items.is_empty() and not panel_open
	if bell_showing and not _bell_holder.visible:
		_fade_in(_bell_holder)
	_bell_holder.visible = bell_showing
	_bell.text = "🔔 %s" % ("99+" if _items.size() > 99 else str(_items.size()))
	_bell.custom_minimum_size.x = maxf(45.0, UI.font(800).get_string_size(_bell.text, HORIZONTAL_ALIGNMENT_LEFT, -1, 12).x + 22.0)
	var center_showing := _center_open and not _items.is_empty()
	if center_showing and not _center.visible:
		_fade_in(_center)
		_center.visible = true
	elif not center_showing and _center.visible:
		_fade_out(_center)
	_center_title.text = "Diplomatic messages (%d)" % _items.size()
	_sound_button.text = "🔊" if _sound else "🔇"
	_sound_button.tooltip_text = "Mute diplomacy notification sound" if _sound else "Enable diplomacy notification sound"
	_style_desktop()
	for child in _center_list.get_children():
		_center_list.remove_child(child)
		child.queue_free()
	for index in range(_items.size() - 1, -1, -1):
		_center_list.add_child(_center_row(_items[index]))
	_size_center()


func _size_center() -> void:
	if not is_inside_tree():
		return
	await get_tree().process_frame
	await get_tree().process_frame
	var viewport := get_viewport_rect().size
	var height := minf(432.0, viewport.y - 112.0)
	_center.offset_bottom = -48.0
	_center.offset_top = -48.0 - minf(height, _center_list.get_combined_minimum_size().y + 44.0)


func _fade_in(node: Control) -> void:
	if not is_inside_tree():
		return
	node.modulate.a = 0.0
	node.scale = Vector2.ONE
	var tween := create_tween()
	tween.tween_property(node, "modulate:a", 1.0, 0.16).set_ease(Tween.EASE_OUT)


func _fade_out(node: Control) -> void:
	if not is_inside_tree():
		node.visible = false
		return
	node.pivot_offset = node.size * 0.5
	var tween := create_tween().set_parallel(true)
	tween.tween_property(node, "modulate:a", 0.0, 0.15).set_ease(Tween.EASE_IN)
	tween.tween_property(node, "scale", Vector2(0.985, 0.985), 0.15).set_ease(Tween.EASE_IN)
	tween.chain().tween_callback(func() -> void:
		node.visible = false
		node.modulate.a = 1.0
		node.scale = Vector2.ONE)


func _toast(item: Dictionary) -> Control:
	var toast := GlassPanel.new(Color(30 / 255.0, 30 / 255.0, 33 / 255.0, 0.67), 14.0, Vector4(14, 12, 38, 12), Color(230 / 255.0, 230 / 255.0, 233 / 255.0, 0.2))
	toast.mouse_filter = Control.MOUSE_FILTER_STOP
	var has_chat := not _s(item.get("chatId", "")).is_empty()
	toast.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if has_chat else Control.CURSOR_ARROW
	toast.tooltip_text = "Open diplomatic chat" if has_chat else "Notification test"
	toast.focus_mode = Control.FOCUS_ALL if has_chat else Control.FOCUS_NONE
	var resting: StyleBox = toast.get_theme_stylebox("panel")
	var ringed := UI.box(Color(0, 0, 0, 0), Color(1, 1, 1, 0.85), 14, 2, Vector4(14, 12, 38, 12))
	toast.focus_entered.connect(func() -> void: toast.add_theme_stylebox_override("panel", ringed))
	toast.focus_exited.connect(func() -> void: toast.add_theme_stylebox_override("panel", resting))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 4)
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.add_child(UI.label("💬 %s" % _s(item.get("sender", "")), 12, UI.WHITE, 800))
	var preview := UI.wrapped(_s(item.get("preview", "")), 12, Color(1, 1, 1, 0.72))
	preview.add_theme_constant_override("line_spacing", 2)
	column.add_child(preview)
	toast.add_child(column)
	var close := Button.new()
	close.text = "✕"
	close.focus_mode = Control.FOCUS_ALL
	close.tooltip_text = "Dismiss"
	close.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	close.add_theme_font_override("font", UI.font(400))
	close.add_theme_font_size_override("font_size", 12)
	for state in ["font_color", "font_focus_color"]:
		close.add_theme_color_override(state, Color(1, 1, 1, 0.72))
	for state in ["font_hover_color", "font_pressed_color", "font_hover_pressed_color"]:
		close.add_theme_color_override(state, UI.WHITE)
	var normal := UI.box(Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.1), 7, 1)
	var hover := UI.box(Color(1, 1, 1, 0.12), Color(1, 1, 1, 0.1), 7, 1)
	close.add_theme_stylebox_override("normal", normal)
	close.add_theme_stylebox_override("focus", UI.box(Color(0, 0, 0, 0), Color(1, 1, 1, 0.85), 7, 2))
	for state in ["hover", "pressed", "hover_pressed"]:
		close.add_theme_stylebox_override(state, hover)
	var close_holder := Control.new()
	close_holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	close.anchor_left = 1.0
	close.anchor_right = 1.0
	close.offset_left = 7.0
	close.offset_right = 32.0
	close.offset_top = -5.0
	close.offset_bottom = 20.0
	close_holder.add_child(close)
	toast.add_child(close_holder)
	var id := int(item.get("id", 0))
	close.pressed.connect(func() -> void: _remove_toast(id))
	toast.gui_input.connect(func(event: InputEvent) -> void:
		if not has_chat:
			return
		if event is InputEventMouseButton and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT and not (event as InputEventMouseButton).pressed:
			_open_item(item)
		elif event is InputEventKey and (event as InputEventKey).pressed and not (event as InputEventKey).echo and (event as InputEventKey).keycode in [KEY_ENTER, KEY_KP_ENTER, KEY_SPACE]:
			toast.accept_event()
			_open_item(item))
	return toast


func _build_bell() -> void:
	_bell_holder = Control.new()
	_bell_holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_bell_holder.anchor_top = 1.0
	_bell_holder.anchor_bottom = 1.0
	_bell_holder.offset_left = 12.0
	_bell_holder.offset_right = 12.0 + CENTER_WIDTH
	_bell_holder.offset_top = -73.0 - 40.0
	_bell_holder.offset_bottom = -73.0
	add_child(_bell_holder)
	_center = GlassPanel.new(Color(29 / 255.0, 29 / 255.0, 32 / 255.0, 0.69), 16.0, Vector4(0, 0, 0, 0), Color(230 / 255.0, 230 / 255.0, 233 / 255.0, 0.18))
	_center.anchor_top = 1.0
	_center.anchor_bottom = 1.0
	_center.offset_left = 0.0
	_center.offset_right = CENTER_WIDTH
	_center.offset_bottom = -48.0
	_center.offset_top = -48.0 - 200.0
	_center.visible = false
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	var header := PanelContainer.new()
	var header_style := StyleBoxFlat.new()
	header_style.bg_color = Color(27 / 255.0, 27 / 255.0, 30 / 255.0, 0.76)
	header_style.border_color = Color(1, 1, 1, 0.08)
	header_style.border_width_bottom = 1
	header_style.corner_radius_top_left = 16
	header_style.corner_radius_top_right = 16
	header_style.content_margin_left = 12
	header_style.content_margin_right = 12
	header_style.content_margin_top = 10
	header_style.content_margin_bottom = 10
	header.add_theme_stylebox_override("panel", header_style)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 7)
	_center_title = UI.label("", 12, UI.WHITE, 700)
	_center_title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(_center_title)
	_sound_button = _plain_button("🔊", 13, Color(1, 1, 1, 0.72))
	_sound_button.pressed.connect(_toggle_sound)
	row.add_child(_sound_button)
	_desktop_button = _plain_button("Desktop", 11, Color(1, 1, 1, 0.55))
	_desktop_button.tooltip_text = "Desktop notification permission"
	_desktop_button.pressed.connect(_enable_desktop)
	row.add_child(_desktop_button)
	var clear_button := _plain_button("Clear", 11, Color("#93c5fd"))
	clear_button.pressed.connect(func() -> void:
		_items.clear()
		_center_open = false
		_render())
	row.add_child(clear_button)
	header.add_child(row)
	column.add_child(header)
	_center_scroll = ScrollContainer.new()
	_center_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_center_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_center_list = VBoxContainer.new()
	_center_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_center_list.add_theme_constant_override("separation", 0)
	_center_scroll.add_child(_center_list)
	column.add_child(_center_scroll)
	_center.add_child(column)
	_bell_holder.add_child(_center)
	var bell_glass := GlassPanel.new(Color(32 / 255.0, 32 / 255.0, 35 / 255.0, 0.67), 10.0, Vector4(0, 0, 0, 0), Color(230 / 255.0, 230 / 255.0, 233 / 255.0, 0.2))
	bell_glass.anchor_top = 0.0
	bell_glass.anchor_bottom = 1.0
	bell_glass.offset_left = 0.0
	bell_glass.offset_right = 45.0
	_bell = Button.new()
	_bell.focus_mode = Control.FOCUS_NONE
	_bell.tooltip_text = "Diplomatic notifications"
	_bell.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	_bell.add_theme_font_override("font", UI.font(800))
	_bell.add_theme_font_size_override("font_size", 12)
	for state in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color"]:
		_bell.add_theme_color_override(state, UI.WHITE)
	var empty := UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 10, 0, Vector4(10, 0, 10, 0))
	var hover := UI.box(Color(1, 1, 1, 0.06), Color(0, 0, 0, 0), 10, 0, Vector4(10, 0, 10, 0))
	for state in ["normal", "focus"]:
		_bell.add_theme_stylebox_override(state, empty)
	for state in ["hover", "pressed", "hover_pressed"]:
		_bell.add_theme_stylebox_override(state, hover)
	_bell.pressed.connect(func() -> void:
		_center_open = not _center_open
		_render())
	_bell.resized.connect(func() -> void: bell_glass.offset_right = _bell.size.x)
	bell_glass.add_child(_bell)
	_bell_holder.add_child(bell_glass)


func _center_row(item: Dictionary) -> Control:
	var row := PanelContainer.new()
	var has_chat := not _s(item.get("chatId", "")).is_empty()
	row.mouse_filter = Control.MOUSE_FILTER_PASS
	row.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if has_chat else Control.CURSOR_ARROW
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0, 0, 0, 0)
	style.border_color = Color(1, 1, 1, 0.07)
	style.border_width_bottom = 1
	style.content_margin_left = 13
	style.content_margin_right = 13
	style.content_margin_top = 11
	style.content_margin_bottom = 11
	var hover: StyleBoxFlat = style.duplicate()
	hover.bg_color = Color(1, 1, 1, 0.04)
	row.add_theme_stylebox_override("panel", style)
	var column := VBoxContainer.new()
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.add_theme_constant_override("separation", 3)
	column.add_child(UI.label(_s(item.get("sender", "")), 12, UI.WHITE, 750))
	column.add_child(UI.wrapped(_s(item.get("preview", "")), 11, Color(1, 1, 1, 0.62)))
	var stamp := _long_date(_s(item.get("gameDate", "")))
	if stamp.is_empty():
		stamp = _local_time(float(item.get("at", 0.0)))
	column.add_child(UI.label(stamp, 10, Color(1, 1, 1, 0.32)))
	row.add_child(column)
	if has_chat:
		row.mouse_entered.connect(func() -> void: row.add_theme_stylebox_override("panel", hover))
		row.mouse_exited.connect(func() -> void: row.add_theme_stylebox_override("panel", style))
		row.gui_input.connect(func(event: InputEvent) -> void:
			if event is InputEventMouseButton and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT and not (event as InputEventMouseButton).pressed:
				_open_item(item))
	return row


func _plain_button(text: String, font_px: int, color: Color) -> Button:
	var button := Button.new()
	button.text = text
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.add_theme_font_override("font", UI.font(400))
	button.add_theme_font_size_override("font_size", font_px)
	for state in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color"]:
		button.add_theme_color_override(state, color)
	button.add_theme_color_override("font_disabled_color", color)
	var empty := UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 6, 0, Vector4(4, 2, 4, 2))
	for state in ["normal", "hover", "pressed", "hover_pressed", "focus", "disabled"]:
		button.add_theme_stylebox_override(state, empty)
	return button


func _style_desktop() -> void:
	if not _desktop_button:
		return
	var granted := _desktop_permission == "granted"
	_desktop_button.text = "Desktop ✓" if granted else "Desktop"
	var color := Color("#86efac") if granted else Color(1, 1, 1, 0.55)
	for state in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color", "font_disabled_color"]:
		_desktop_button.add_theme_color_override(state, color)
	_desktop_button.mouse_default_cursor_shape = Control.CURSOR_ARROW if _desktop_permission == "unsupported" else Control.CURSOR_POINTING_HAND


func _enable_desktop() -> void:
	if not engine or _desktop_permission == "unsupported":
		return
	var reply := await engine.request("notify.desktop.request")
	if reply.get("ok", false):
		_desktop_permission = _s(_dict(reply.get("result", {})).get("permission", _desktop_permission))
	_render()


func _desktop_activated(data: Dictionary) -> void:
	var window_id := get_window().get_window_id() if is_inside_tree() else DisplayServer.MAIN_WINDOW_ID
	if DisplayServer.window_get_mode(window_id) == DisplayServer.WINDOW_MODE_MINIMIZED:
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED, window_id)
	DisplayServer.window_move_to_foreground(window_id)
	var chat_id := _s(data.get("chatId", ""))
	if chat_id.is_empty() or data.get("sameGame", true) == false:
		return
	_open_item({"id": int(data.get("notice", 0)), "chatId": chat_id})


func _toggle_sound() -> void:
	_sound = not _sound
	_render()
	if engine:
		engine.request("chat.sound.set", {"enabled": _sound})
	if _sound:
		_play_chime()


func _play_chime() -> void:
	if _audio and _audio.is_inside_tree():
		_audio.play()


func _make_chime() -> AudioStreamWAV:
	var rate := 44100
	var length := int(rate * 0.3)
	var data := PackedByteArray()
	data.resize(length * 2)
	var notes := [[740.0, 0.0, 0.115], [988.0, 0.082, 0.145]]
	for index in range(length):
		var t := float(index) / float(rate)
		var master := _ramp(t, 0.0, 0.0001, 0.008, 0.028) if t < 0.008 else _ramp(t, 0.008, 0.028, 0.26, 0.0001)
		var sample := 0.0
		for note in notes:
			var start: float = note[1]
			var stop: float = start + float(note[2])
			if t < start or t > stop + 0.01:
				continue
			var gain := _ramp(t, start, 0.0001, start + 0.006, 0.72) if t < start + 0.006 else _ramp(t, start + 0.006, 0.72, stop, 0.0001)
			sample += gain * sin(TAU * float(note[0]) * (t - start))
		var value := clampi(int(master * sample * 32767.0), -32768, 32767)
		data.encode_s16(index * 2, value)
	var stream := AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = rate
	stream.stereo = false
	stream.data = data
	return stream


func _ramp(t: float, t0: float, v0: float, t1: float, v1: float) -> float:
	if t <= t0:
		return v0
	if t >= t1:
		return v1
	return v0 * pow(v1 / v0, (t - t0) / (t1 - t0))


func _long_date(value: String) -> String:
	var pattern := RegEx.create_from_string("^([+-]?)(\\d{1,6})-(\\d{1,2})-(\\d{1,2})")
	var found := pattern.search(value.strip_edges())
	if not found:
		return ""
	var year := int(found.get_string(2))
	if found.get_string(1) == "-":
		year = -year
	var month := int(found.get_string(3))
	if month < 1 or month > 12 or year == 0:
		return ""
	return "%s %d, %s" % [MONTHS[month - 1], int(found.get_string(4)), "%d BC" % -year if year < 0 else str(year)]


func _local_time(at: float) -> String:
	var bias := float(Time.get_time_zone_from_system().get("bias", 0))
	var moment := Time.get_datetime_dict_from_unix_time(int(at + bias * 60.0))
	var hour := int(moment["hour"])
	var twelve := hour % 12
	if twelve == 0:
		twelve = 12
	return "%d:%02d:%02d %s" % [twelve, int(moment["minute"]), int(moment["second"]), "PM" if hour >= 12 else "AM"]


func _s(value: Variant) -> String:
	if value == null:
		return ""
	return str(value).strip_edges()


func _dict(value: Variant) -> Dictionary:
	return value if typeof(value) == TYPE_DICTIONARY else {}


func _arr(value: Variant) -> Array:
	return value if typeof(value) == TYPE_ARRAY else []
