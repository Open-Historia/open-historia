class_name DevToolsNetwork
extends VBoxContainer

const KEEP := 1500
const KIND_NAMES := {"call": "engine call", "event": "event", "http": "fetch"}
const DETAIL_TABS := [["headers", "Headers"], ["payload", "Payload"], ["response", "Response"]]

var host: DevToolsWindow
var tree: Tree
var filter_field: LineEdit
var record_button: Button
var summary_label: Label
var detail: VBoxContainer
var detail_title: Label
var detail_text: TextEdit
var recording := true
var _entries: Array = []
var _calls := {}
var _http := {}
var _kinds := {"call": true, "event": true, "http": true}
var _filter := ""
var _selected: Dictionary = {}
var _detail_tab := "headers"
var _detail_buttons := {}
var _seq := 0
var _bytes := 0
var _origin := ""


func _init(window: DevToolsWindow) -> void:
	host = window
	name = "Network"
	add_theme_constant_override("separation", 0)
	add_child(_build_toolbar())
	var split := HSplitContainer.new()
	split.size_flags_vertical = Control.SIZE_EXPAND_FILL
	split.split_offset = 300
	tree = Tree.new()
	tree.name = "Requests"
	tree.columns = 5
	tree.column_titles_visible = true
	tree.hide_root = true
	tree.select_mode = Tree.SELECT_ROW
	tree.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	tree.custom_minimum_size.x = 360
	var titles := ["Name", "Status", "Type", "Size", "Time"]
	var widths := [0, 90, 96, 80, 80]
	for column in range(5):
		tree.set_column_title(column, titles[column])
		tree.set_column_title_alignment(column, HORIZONTAL_ALIGNMENT_LEFT)
		tree.set_column_expand(column, column == 0)
		tree.set_column_clip_content(column, true)
		if widths[column] > 0:
			tree.set_column_custom_minimum_width(column, widths[column])
	tree.add_theme_font_override("font", UI.font(400, DevToolsStyle.MONO))
	tree.add_theme_font_size_override("font_size", 12)
	tree.create_item()
	tree.item_selected.connect(_on_selected)
	split.add_child(tree)
	split.add_child(_build_detail())
	add_child(split)
	var foot := DevToolsStyle.bar(Vector4(8, 3, 8, 3))
	summary_label = DevToolsStyle.text("", 11, DevToolsStyle.MUTED)
	foot.add_child(summary_label)
	add_child(foot)
	_summarise()


func _build_toolbar() -> Control:
	var top := DevToolsStyle.bar()
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	record_button = DevToolsStyle.button("● Recording", "Stop recording network activity", true)
	record_button.button_pressed = true
	record_button.toggled.connect(func(on: bool) -> void:
		recording = on
		record_button.text = "● Recording" if on else "○ Paused"
		record_button.tooltip_text = "Stop recording network activity" if on else "Record network activity")
	row.add_child(record_button)
	var clear_button := DevToolsStyle.button("Clear", "Clear the network log")
	clear_button.pressed.connect(clear)
	row.add_child(clear_button)
	row.add_child(DevToolsStyle.divider())
	filter_field = DevToolsStyle.field("Filter")
	filter_field.custom_minimum_size.x = 200
	filter_field.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	filter_field.text_changed.connect(func(text: String) -> void:
		_filter = text.strip_edges()
		_rebuild())
	row.add_child(filter_field)
	for kind in [["call", "Engine calls"], ["event", "Events"], ["http", "Fetch"]]:
		var key: String = kind[0]
		var chip := DevToolsStyle.chip(kind[1], "Show %s" % String(kind[1]).to_lower(), true)
		chip.toggled.connect(func(on: bool) -> void:
			_kinds[key] = on
			_rebuild())
		row.add_child(chip)
	top.add_child(row)
	return top


func _build_detail() -> Control:
	detail = VBoxContainer.new()
	detail.name = "Detail"
	detail.add_theme_constant_override("separation", 0)
	detail.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	detail.custom_minimum_size.x = 320
	detail.visible = false
	var top := DevToolsStyle.bar(Vector4(8, 2, 6, 0))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 2)
	var close_button := DevToolsStyle.button("×", "Close the detail")
	close_button.pressed.connect(func() -> void:
		_selected = {}
		tree.deselect_all()
		detail.visible = false)
	row.add_child(close_button)
	for tab in DETAIL_TABS:
		var key: String = tab[0]
		var button := _tab_button(tab[1])
		button.pressed.connect(func() -> void: show_detail_tab(key))
		_detail_buttons[key] = button
		row.add_child(button)
	detail_title = DevToolsStyle.text("", 11, DevToolsStyle.FAINT, 400, true)
	detail_title.clip_text = true
	detail_title.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	detail_title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	detail_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	row.add_child(detail_title)
	top.add_child(row)
	detail.add_child(top)
	detail_text = TextEdit.new()
	detail_text.name = "Body"
	detail_text.editable = false
	detail_text.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	detail_text.size_flags_vertical = Control.SIZE_EXPAND_FILL
	detail.add_child(detail_text)
	return detail


func _tab_button(caption: String) -> Button:
	var button := DevToolsStyle.button(caption, "", true)
	var off := UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 0, Vector4(10, 5, 10, 5))
	var on := off.duplicate() as StyleBoxFlat
	on.border_color = DevToolsStyle.ACCENT
	on.border_width_bottom = 2
	for state in ["normal", "hover", "disabled"]:
		button.add_theme_stylebox_override(state, off)
	for state in ["pressed", "hover_pressed"]:
		button.add_theme_stylebox_override(state, on)
	button.add_theme_color_override("font_color", DevToolsStyle.MUTED)
	button.add_theme_color_override("font_hover_color", DevToolsStyle.INK)
	return button


func set_origin(origin: String) -> void:
	_origin = origin


func entries() -> Array:
	return _entries


func clear() -> void:
	_entries.clear()
	_calls.clear()
	_http.clear()
	_bytes = 0
	_selected = {}
	detail.visible = false
	_rebuild()


func on_request(id: int, method: String, args: Dictionary, size: int) -> void:
	if not recording:
		return
	var entry := _add({"kind": "call", "name": method, "id": id, "args": args, "request_size": size, "status": "(pending)", "size": 0, "duration": -1.0, "started": Time.get_ticks_usec(), "at": Time.get_unix_time_from_system()})
	_calls[id] = entry


func on_reply(id: int, reply: Dictionary, size: int) -> void:
	var entry: Dictionary = _calls.get(id, {})
	if entry.is_empty():
		return
	_calls.erase(id)
	entry["reply"] = reply
	entry["size"] = size
	entry["duration"] = (Time.get_ticks_usec() - int(entry["started"])) / 1000.0
	entry["ok"] = bool(reply.get("ok", false))
	entry["status"] = "ok" if entry["ok"] else ("aborted" if bool(reply.get("aborted", false)) else "error")
	_bytes += size
	_refresh(entry)


func on_event(event_name: String, data: Variant, size: int) -> void:
	if not recording:
		return
	_bytes += size
	_add({"kind": "event", "name": event_name, "data": data, "status": "pushed", "ok": true, "size": size, "duration": 0.0, "at": Time.get_unix_time_from_system()})


func on_http(record: Dictionary) -> void:
	var id := int(record.get("id", 0))
	var phase := str(record.get("phase", ""))
	if phase == "start":
		if not recording:
			return
		var entry := _add({"kind": "http", "name": _short_url(str(record.get("url", ""))), "url": str(record.get("url", "")), "method": str(record.get("method", "GET")), "request_headers": record.get("requestHeaders", []), "request_body": str(record.get("requestBody", "")), "request_size": int(record.get("requestSize", 0)), "status": "(pending)", "size": 0, "duration": -1.0, "at": float(record.get("at", 0)) / 1000.0})
		_http[id] = entry
		return
	var found: Dictionary = _http.get(id, {})
	if found.is_empty():
		return
	match phase:
		"response":
			found["status"] = str(int(record.get("status", 0)))
			found["status_text"] = str(record.get("statusText", ""))
			found["type"] = str(record.get("type", ""))
			found["headers"] = record.get("headers", [])
			found["ok"] = int(record.get("status", 0)) < 400
			found["waited"] = float(record.get("waited", 0))
		"done":
			found["size"] = int(record.get("size", 0))
			found["body"] = str(record.get("body", ""))
			found["duration"] = float(record.get("duration", 0))
			_bytes += int(found["size"])
			_http.erase(id)
		"failed":
			found["status"] = "(failed)"
			found["ok"] = false
			found["error"] = str(record.get("error", ""))
			found["duration"] = float(record.get("duration", 0))
			_http.erase(id)
	_refresh(found)


func _short_url(url: String) -> String:
	if not _origin.is_empty() and url.begins_with(_origin):
		return url.substr(_origin.length())
	return url.trim_prefix("https://").trim_prefix("http://")


func _add(entry: Dictionary) -> Dictionary:
	_seq += 1
	entry["seq"] = _seq
	if not entry.has("ok"):
		entry["ok"] = true
	_entries.append(entry)
	if _entries.size() > KEEP + 200:
		_entries = _entries.slice(_entries.size() - KEEP)
		_rebuild()
	elif _passes(entry):
		_make_item(entry)
	_summarise()
	return entry


func _passes(entry: Dictionary) -> bool:
	if not bool(_kinds.get(str(entry["kind"]), true)):
		return false
	if _filter.is_empty():
		return true
	return str(entry["name"]).containsn(_filter) or str(entry.get("url", "")).containsn(_filter)


func _make_item(entry: Dictionary) -> void:
	var item := tree.create_item(tree.get_root())
	entry["item"] = item
	item.set_metadata(0, int(entry["seq"]))
	_paint(item, entry)


func _paint(item: TreeItem, entry: Dictionary) -> void:
	var kind := str(entry["kind"])
	var label := str(entry["name"])
	if kind == "http":
		label = "%s %s" % [entry.get("method", "GET"), label]
	item.set_text(0, label)
	item.set_tooltip_text(0, str(entry.get("url", entry["name"])))
	item.set_text(1, str(entry["status"]))
	item.set_text(2, KIND_NAMES.get(kind, kind))
	item.set_text(3, DevToolsStyle.bytes(float(entry.get("size", 0))) if float(entry.get("duration", -1.0)) >= 0.0 or kind == "event" else "")
	item.set_text(4, "" if kind == "event" else DevToolsStyle.duration(float(entry.get("duration", -1.0))))
	var ink := DevToolsStyle.ERROR if not bool(entry.get("ok", true)) else (DevToolsStyle.MUTED if kind == "event" else DevToolsStyle.INK)
	for column in range(5):
		item.set_custom_color(column, ink if column < 2 else (DevToolsStyle.ERROR if ink == DevToolsStyle.ERROR else DevToolsStyle.MUTED))


func _refresh(entry: Dictionary) -> void:
	var item: Variant = entry.get("item")
	if item is TreeItem and is_instance_valid(item):
		_paint(item, entry)
	if not _selected.is_empty() and int(_selected.get("seq", -1)) == int(entry["seq"]):
		_render_detail()
	_summarise()


func _rebuild() -> void:
	tree.clear()
	tree.create_item()
	for entry in _entries:
		entry.erase("item")
		if _passes(entry):
			_make_item(entry)
	_summarise()


func _summarise() -> void:
	var shown := 0
	for entry in _entries:
		if entry.has("item"):
			shown += 1
	summary_label.text = "%d / %d requests  ·  %s transferred" % [shown, _entries.size(), DevToolsStyle.bytes(_bytes)]


func _on_selected() -> void:
	var item := tree.get_selected()
	if item == null:
		return
	var seq := int(item.get_metadata(0))
	for entry in _entries:
		if int(entry["seq"]) == seq:
			select_entry(entry)
			return


func select_entry(entry: Dictionary) -> void:
	_selected = entry
	detail.visible = true
	_render_detail()


func show_detail_tab(key: String) -> void:
	_detail_tab = key
	_render_detail()


func detail_body() -> String:
	return detail_text.text


func _render_detail() -> void:
	for key in _detail_buttons:
		(_detail_buttons[key] as Button).set_pressed_no_signal(key == _detail_tab)
	if _selected.is_empty():
		detail_text.text = ""
		return
	var entry := _selected
	detail_title.text = str(entry.get("url", entry["name"]))
	var text := ""
	match _detail_tab:
		"headers":
			text = _headers(entry)
		"payload":
			match str(entry["kind"]):
				"call":
					text = DevToolsStyle.pretty(entry.get("args", {}))
				"event":
					text = DevToolsStyle.pretty(entry.get("data"))
				"http":
					text = _json_or_text(str(entry.get("request_body", ""))) if not str(entry.get("request_body", "")).is_empty() else "This request has no payload."
		"response":
			match str(entry["kind"]):
				"call":
					text = DevToolsStyle.pretty(entry["reply"]) if entry.has("reply") else "Waiting for the reply…"
				"event":
					text = "Pushed events have no response."
				"http":
					text = str(entry.get("error", "")) if entry.has("error") else (_json_or_text(str(entry.get("body", ""))) if entry.has("body") else "Waiting for the body…")
	detail_text.text = DevToolsStyle.hide_secrets(text)


func _json_or_text(text: String) -> String:
	if text.length() < 400000 and (text.begins_with("{") or text.begins_with("[")):
		var parsed: Variant = JSON.parse_string(text)
		if parsed != null:
			return DevToolsStyle.pretty(parsed)
	return text


func _headers(entry: Dictionary) -> String:
	var lines := PackedStringArray()
	var kind := str(entry["kind"])
	lines.append("General")
	match kind:
		"call":
			lines.append("  Method: %s" % entry["name"])
			lines.append("  Request id: %d" % int(entry.get("id", 0)))
			lines.append("  Status: %s" % entry["status"])
			if entry.has("reply") and not bool(entry.get("ok", true)):
				lines.append("  Error: %s" % str((entry["reply"] as Dictionary).get("error", "")))
			lines.append("  Request size: %s" % DevToolsStyle.bytes(float(entry.get("request_size", 0))))
			lines.append("  Response size: %s" % DevToolsStyle.bytes(float(entry.get("size", 0))))
			lines.append("  Duration: %s" % DevToolsStyle.duration(float(entry.get("duration", -1.0))))
		"event":
			lines.append("  Event: %s" % entry["name"])
			lines.append("  Size: %s" % DevToolsStyle.bytes(float(entry.get("size", 0))))
		"http":
			lines.append("  Request URL: %s" % entry.get("url", ""))
			lines.append("  Request method: %s" % entry.get("method", "GET"))
			lines.append("  Status: %s %s" % [entry["status"], entry.get("status_text", "")])
			if entry.has("error"):
				lines.append("  Error: %s" % entry["error"])
			lines.append("  Content type: %s" % entry.get("type", ""))
			lines.append("  Request size: %s" % DevToolsStyle.bytes(float(entry.get("request_size", 0))))
			lines.append("  Response size: %s" % DevToolsStyle.bytes(float(entry.get("size", 0))))
			lines.append("  Waiting for the server: %s" % DevToolsStyle.duration(float(entry.get("waited", -1.0))))
			lines.append("  Duration: %s" % DevToolsStyle.duration(float(entry.get("duration", -1.0))))
			for block in [["Response headers", "headers"], ["Request headers", "request_headers"]]:
				var rows: Variant = entry.get(block[1], [])
				if rows is Array and not (rows as Array).is_empty():
					lines.append("")
					lines.append(block[0])
					for pair in rows:
						if pair is Array and (pair as Array).size() >= 2:
							lines.append("  %s: %s" % [pair[0], pair[1]])
	lines.append("  Started: %s" % DevToolsStyle.clock(float(entry.get("at", 0))))
	return "\n".join(lines)
