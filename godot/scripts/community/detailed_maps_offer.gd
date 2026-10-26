class_name DetailedMapsOffer
extends MarginContainer

signal done

const PANEL_BG := Color(14 / 255.0, 17 / 255.0, 22 / 255.0, 0.86)
const PANEL_BORDER := Color(1, 1, 1, 0.10)
const PANEL_INK := Color(239 / 255.0, 242 / 255.0, 246 / 255.0, 0.94)
const BUTTON_BG := Color(1, 1, 1, 0.10)
const BUTTON_BORDER := Color(1, 1, 1, 0.18)
const ACCEPT_BG := Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.28)
const ACCEPT_BORDER := Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.5)
const FAILED_INK := Color("#f3a8a8")
const DEFAULT_TITLE := "This scenario has detailed maps"
const DEFAULT_INTRO := "Large terrain maps, sharp up close. Tick the ones to download now; you can get the others later by picking them in Settings → Map. Without one, you see the drawn map under it. Each downloads once, and every scenario on it shares it."

var engine: EngineLink
var _single := {}
var _offers: Array = []
var _ticked := {}
var _phase := "offer"
var _error := ""
var _received := 0.0
var _total := 0.0
var _downloading_name := ""
var _percent := -1
var _call := 0
var _panel: PanelContainer


func _init() -> void:
	add_theme_constant_override("margin_bottom", 14)
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_panel = CommunityKit.panel(PANEL_BG, PANEL_BORDER, 12, Vector4(14, 12, 14, 12))
	add_child(_panel)


func setup_single(link: EngineLink, basemap: Dictionary) -> void:
	engine = link
	_single = basemap
	_total = float(basemap.get("bytes", 0))
	_listen()
	_render()


func setup_list(link: EngineLink, offers: Array) -> void:
	engine = link
	_offers = offers
	for offer in offers:
		var entry: Dictionary = offer
		var ticked: Variant = entry.get("ticked")
		if (bool(ticked) if ticked != null else bool(entry.get("starting", false))):
			_ticked[_key_of(entry)] = true
	_listen()
	_render()


func _listen() -> void:
	if not engine.engine_event.is_connected(_on_event):
		engine.engine_event.connect(_on_event)


func _exit_tree() -> void:
	if _call != 0 and engine:
		engine.cancel(_call)
	if engine and engine.engine_event.is_connected(_on_event):
		engine.engine_event.disconnect(_on_event)


func _key_of(offer: Dictionary) -> String:
	return "%s@%s" % [str(offer.get("id", "")), str(offer.get("version", ""))]


func _on_event(name: String, data: Variant) -> void:
	if name != "community.mapProgress" or typeof(data) != TYPE_DICTIONARY:
		return
	var event: Dictionary = data
	if int(event.get("call", 0)) != _call or _call == 0:
		return
	var received := float(event.get("received", 0))
	var total := float(event.get("total", 0))
	_downloading_name = str(event.get("name", ""))
	_received = received
	if total > 0.0:
		_total = total
	_percent = int(round(received / total * 100.0)) if total > 0.0 else -1
	_render()


func _button(caption: String, accept := false) -> Button:
	var node := CommunityKit.pill_button(caption, {
		"bg": ACCEPT_BG if accept else BUTTON_BG,
		"border": ACCEPT_BORDER if accept else BUTTON_BORDER,
		"ink": PANEL_INK,
		"size": 13,
		"weight": 400,
		"height": 30.0,
		"pad": 12.0,
		"radius": 8,
	})
	return node


func _line(value: String, weight := 400, alpha := 1.0) -> Label:
	return CommunityKit.para(value, 13, Color(PANEL_INK, PANEL_INK.a * alpha), weight, 1.4)


func _render() -> void:
	for child in _panel.get_children():
		_panel.remove_child(child)
		child.queue_free()
	var stack := CommunityKit.column(0)
	_panel.add_child(stack)
	if _single.is_empty():
		_render_list(stack)
	else:
		_render_single(stack)


func _render_single(stack: VBoxContainer) -> void:
	var name := str(_single.get("name", ""))
	if name.is_empty():
		name = "its detailed map"
	if _phase == "downloading":
		stack.add_child(CommunityKit.margin_below(_line("Downloading %s…" % name, 600), 8))
		var track := Control.new()
		track.custom_minimum_size.y = 4
		track.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var percent := minf(100.0, roundf(_received / _total * 100.0)) if _total > 0.0 else 8.0
		track.draw.connect(func() -> void:
			track.draw_style_box(UI.box(Color(1, 1, 1, 0.10), Color(0, 0, 0, 0), 999, 0), Rect2(Vector2.ZERO, track.size))
			track.draw_style_box(UI.box(Color(226 / 255.0, 232 / 255.0, 240 / 255.0, 0.86), Color(0, 0, 0, 0), 999, 0), Rect2(Vector2.ZERO, Vector2(track.size.x * percent / 100.0, track.size.y))))
		stack.add_child(CommunityKit.margin_below(track, 8))
		var row := CommunityKit.row(8)
		var amount := CommunityKit.format_bytes(_received)
		if amount.is_empty():
			amount = "0 KB"
		if _total > 0.0:
			amount += " of %s" % CommunityKit.format_bytes(_total)
		var words := _line(amount, 400, 0.75)
		words.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(words)
		var cancel := _button("Cancel")
		cancel.pressed.connect(func() -> void:
			if _call != 0:
				engine.cancel(_call))
		row.add_child(cancel)
		stack.add_child(row)
		return
	var wording: Dictionary = _single.get("wording", {})
	stack.add_child(CommunityKit.margin_below(_line(str(wording.get("title", "")), 600), 4))
	stack.add_child(CommunityKit.margin_below(_line(str(wording.get("body", "")), 400, 0.8), 10))
	if _phase == "failed":
		var problem := CommunityKit.para(_error, 13, FAILED_INK, 400, 1.4)
		stack.add_child(CommunityKit.margin_below(problem, 8))
	var buttons := CommunityKit.row(8)
	buttons.alignment = BoxContainer.ALIGNMENT_END
	var decline := _button(str(wording.get("decline", "")))
	decline.pressed.connect(func() -> void:
		_phase = "dismissed"
		visible = false
		done.emit())
	buttons.add_child(decline)
	var accept_text: Variant = wording.get("accept")
	var can_download := accept_text != null and not str(accept_text).is_empty() and not str(_single.get("id", "")).is_empty() and int(_single.get("version", 0)) != 0
	if can_download:
		var accept := _button("Try again" if _phase == "failed" else str(accept_text), true)
		accept.pressed.connect(_start_single)
		buttons.add_child(accept)
	stack.add_child(buttons)


func _start_single() -> void:
	_phase = "downloading"
	_error = ""
	_received = 0.0
	_total = float(_single.get("bytes", 0))
	_render()
	_call = engine.last_request_id() + 1
	var reply := await engine.request("community.installMaps", {"offers": [{"id": _single.get("id", ""), "version": _single.get("version", 0), "name": _single.get("name", ""), "bytes": _single.get("bytes", 0)}]})
	_call = 0
	if not is_instance_valid(self):
		return
	if reply.get("ok", false):
		done.emit()
		return
	if reply.get("aborted", false):
		_phase = "offer"
	else:
		_error = str(reply.get("error", ""))
		if _error.is_empty():
			_error = "The download failed."
		_phase = "failed"
	_render()


func _render_list(stack: VBoxContainer) -> void:
	if _phase == "downloading":
		var line := "Downloading %s…" % _downloading_name
		if _percent >= 0:
			line += " %d%%" % _percent
		stack.add_child(CommunityKit.margin_below(_line(line, 600), 8))
		var cancel := _button("Cancel")
		cancel.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		cancel.pressed.connect(func() -> void:
			if _call != 0:
				engine.cancel(_call))
		stack.add_child(cancel)
		return
	stack.add_child(CommunityKit.margin_below(_line(DEFAULT_TITLE, 600), 4))
	stack.add_child(CommunityKit.margin_below(_line(DEFAULT_INTRO, 400, 0.8), 10))
	var choices := CommunityKit.column(6)
	var total := 0.0
	for entry in _offers:
		var offer: Dictionary = entry
		var key := _key_of(offer)
		if _ticked.get(key, false):
			total += float(offer.get("bytes", 0))
		var row := CommunityKit.row(8)
		var box := CheckBox.new()
		box.button_pressed = _ticked.get(key, false)
		box.focus_mode = Control.FOCUS_NONE
		box.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		box.toggled.connect(func(on: bool) -> void:
			if on:
				_ticked[key] = true
			else:
				_ticked.erase(key)
			_render())
		row.add_child(box)
		var name := _line(str(offer.get("name", "")), 600)
		name.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		name.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(name)
		var size_text := _line(CommunityKit.format_bytes(float(offer.get("bytes", 0))), 400, 0.65)
		size_text.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		size_text.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(size_text)
		if offer.get("starting", false):
			var starting := _line("★ the starting map", 400, 0.65)
			starting.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
			starting.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			row.add_child(starting)
		if offer.get("have") != null and str(offer.get("have")) != "" and str(offer.get("have")) != "0":
			var update := _line("an update", 400, 0.65)
			update.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
			update.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			row.add_child(update)
		choices.add_child(row)
	stack.add_child(CommunityKit.margin_below(choices, 10))
	if not _error.is_empty():
		stack.add_child(CommunityKit.margin_below(CommunityKit.para(_error, 13, FAILED_INK, 400, 1.4), 8))
	var buttons := CommunityKit.row(8)
	buttons.alignment = BoxContainer.ALIGNMENT_END
	var later := _button("Not now")
	later.pressed.connect(func() -> void: done.emit())
	buttons.add_child(later)
	var chosen := _chosen()
	var download := _button("Download %s" % CommunityKit.format_bytes(total) if total > 0.0 else "Download", true)
	if chosen.is_empty():
		download.modulate.a = 0.5
		CommunityKit.set_idle(download, true)
	download.pressed.connect(_start_list)
	buttons.add_child(download)
	stack.add_child(buttons)


func _chosen() -> Array:
	return _offers.filter(func(offer: Dictionary) -> bool: return _ticked.get(_key_of(offer), false))


func _start_list() -> void:
	var chosen := _chosen()
	if chosen.is_empty():
		return
	_error = ""
	_phase = "downloading"
	_downloading_name = str((chosen[0] as Dictionary).get("name", ""))
	_percent = -1
	_render()
	var payload: Array = []
	for offer in chosen:
		var entry: Dictionary = offer
		payload.append({"id": entry.get("id", ""), "version": entry.get("version", 0), "name": entry.get("name", ""), "bytes": entry.get("bytes", 0)})
	_call = engine.last_request_id() + 1
	var reply := await engine.request("community.installMaps", {"offers": payload})
	_call = 0
	if not is_instance_valid(self):
		return
	_phase = "offer"
	if reply.get("ok", false):
		done.emit()
		return
	if not reply.get("aborted", false):
		_error = str(reply.get("error", ""))
		if _error.is_empty():
			_error = "The download failed."
	_render()
