class_name WorkshopFlags
extends WorkshopOverlay

const MIN_CARD := 128.0
const GAP := 11.0
const COMMUNITY_REASON := "The community's flags are not in the native Workshop yet."
const SHARE_REASON := "Sharing a flag with the community is not in the native Workshop yet."

var host: Workshop
var polity_key := ""
var _catalog := {}
var _query := ""
var _codes: Variant = null
var _error := ""
var _queue: Array = []
var _serial := 0
var _remove_holder: Control


func _init() -> void:
	super._init(Color("#1b1b1e"))


func setup(workshop: Workshop, key: String) -> void:
	host = workshop
	polity_key = key
	closed.connect(queue_free)
	_build_header()
	await _load()


func _build_header() -> void:
	title("Flags — %s" % polity_key if not polity_key.is_empty() else "Flags")
	header.add_child(WorkshopOverlay.tab_button("In the game", true, Color(0, 0, 0, 0.5), Color(1, 1, 1, 0.12), Color(1, 1, 1, 0.12), Vector4(13, 6, 13, 6), 400))
	var community := WorkshopOverlay.tab_button("Community", false, Color(0, 0, 0, 0.5), Color(1, 1, 1, 0.12), Color(1, 1, 1, 0.12), Vector4(13, 6, 13, 6), 400)
	UI.set_disabled_look(community, COMMUNITY_REASON)
	header.add_child(community)
	var search := LineEdit.new()
	search.placeholder_text = "Search…"
	search.custom_minimum_size = Vector2(144, 30)
	search.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	search.add_theme_stylebox_override("normal", UI.box(Color(0, 0, 0, 0.3), Color(1, 1, 1, 0.14), 8, 1, Vector4(10, 5, 10, 5)))
	search.add_theme_stylebox_override("focus", UI.box(Color(0, 0, 0, 0.3), Color(1, 1, 1, 0.3), 8, 1, Vector4(10, 5, 10, 5)))
	search.add_theme_font_override("font", UI.font(400))
	search.add_theme_font_size_override("font_size", 13)
	search.add_theme_color_override("font_color", Color(1, 1, 1))
	search.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.4))
	search.add_theme_color_override("caret_color", Color(1, 1, 1))
	search.text_changed.connect(_on_query)
	header.add_child(search)
	spacer()
	var upload := WorkshopUI.base_button("⬆ Upload your own")
	var upload_style := UI.box(Color(1, 1, 1, 0.14), Color(1, 1, 1, 0.14), 8, 1, Vector4(11, 6, 11, 6))
	WorkshopUI._flat_styles(upload, upload_style, UI.box(Color(1, 1, 1, 0.2), Color(1, 1, 1, 0.2), 8, 1, Vector4(11, 6, 11, 6)), upload_style, upload_style)
	WorkshopUI._ink(upload, Color(1, 1, 1), 13.0, 400)
	upload.tooltip_text = "Upload your own"
	upload.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	upload.pressed.connect(_upload)
	header.add_child(upload)
	_remove_holder = HBoxContainer.new()
	_remove_holder.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	header.add_child(_remove_holder)
	var close := _close_button("✕")
	close.tooltip_text = "Close flag picker"
	close.pressed.connect(func() -> void: closed.emit())
	header.add_child(close)


func _close_button(text: String) -> Button:
	var node := WorkshopUI.base_button(text)
	var style := UI.box(Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.12), 8, 1, Vector4(10, 6, 10, 6))
	WorkshopUI._flat_styles(node, style, UI.box(Color(1, 1, 1, 0.1), Color(1, 1, 1, 0.18), 8, 1, Vector4(10, 6, 10, 6)), style, style)
	WorkshopUI._ink(node, Color(1, 1, 1), 14.0, 400)
	node.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	return node


func _load() -> void:
	var reply := await host.request_raw("workshop.flags.catalog", {"owner": polity_key})
	if not reply.get("ok", false):
		_error = str(reply.get("error", ""))
		_render()
		return
	_catalog = reply["result"]
	WorkshopUI.clear(_remove_holder)
	if _catalog.get("current") != null and not str(_catalog.get("current")).is_empty():
		var remove := _close_button("Remove")
		remove.tooltip_text = "Use the standard flag again"
		remove.pressed.connect(func() -> void: _pick(null))
		_remove_holder.add_child(remove)
	_render()


func _on_query(text: String) -> void:
	_query = text
	_serial += 1
	var serial := _serial
	var q := text.strip_edges().to_lower()
	if q.is_empty():
		_codes = null
		_render()
		return
	var reply := await host.request_raw("workshop.flags.filter", {"query": text})
	if serial != _serial or not reply.get("ok", false):
		return
	var codes := {}
	for code in (reply["result"] as Dictionary).get("codes", []):
		codes[str(code)] = true
	_codes = codes
	_render()


func _pick(value: Variant) -> void:
	await host.request("workshop.polity.flag", {"key": polity_key, "value": value})
	closed.emit()


func _upload() -> void:
	var path := await EditorKit.pick_file(self, false, "", PackedStringArray(["*.png, *.jpg, *.jpeg, *.webp, *.gif, *.svg ; Images"]))
	if path.is_empty():
		return
	_error = ""
	var image := Image.new()
	if image.load(path) != OK or image.get_width() <= 0 or image.get_height() <= 0:
		_error = "That file isn't an image the browser can read."
		_render()
		return
	var scale := minf(1.0, 256.0 / float(maxi(image.get_width(), image.get_height())))
	if scale < 1.0:
		image.resize(maxi(1, int(round(image.get_width() * scale))), maxi(1, int(round(image.get_height() * scale))), Image.INTERPOLATE_LANCZOS)
	var data_url := "data:image/png;base64," + Marshalls.raw_to_base64(image.save_png_to_buffer())
	await host.request("workshop.flags.save", {"owner": polity_key, "name": path.get_file().get_basename(), "dataUrl": data_url})
	closed.emit()


func _delete(flag: Dictionary) -> void:
	var label := str(flag.get("name", ""))
	if label.is_empty():
		label = str(flag.get("code", ""))
	if label.is_empty():
		label = "Flag"
	if not await host.confirm("Delete the flag “%s” from My flags? Maps already using it keep their own copy." % label):
		return
	_error = ""
	var reply := await host.request_raw("workshop.flags.delete", {"id": str(flag.get("id", ""))})
	if not reply.get("ok", false):
		_error = "Could not delete that flag: %s" % str(reply.get("error", ""))
	elif (reply["result"] as Dictionary).has("error"):
		_error = str((reply["result"] as Dictionary)["error"])
	await _load()


func _row_title(text: String) -> MarginContainer:
	var holder := MarginContainer.new()
	holder.add_theme_constant_override("margin_top", 3)
	holder.add_theme_constant_override("margin_bottom", 8)
	holder.add_child(UI.label(text, 12, Color(1, 1, 1, 0.6), 400, "Arial", 1))
	return holder


func _grid() -> GridContainer:
	var grid := GridContainer.new()
	grid.columns = columns_for(MIN_CARD, GAP)
	grid.add_theme_constant_override("h_separation", int(GAP))
	grid.add_theme_constant_override("v_separation", int(GAP))
	grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return grid


func _card_width() -> float:
	var columns := columns_for(MIN_CARD, GAP)
	return (content_width() - GAP * float(columns - 1)) / float(columns)


func _render() -> void:
	WorkshopUI.clear(body)
	_queue.clear()
	if not _error.is_empty():
		var error := WorkshopOverlay.dim_text(_error, Color("#fecaca"))
		body.add_child(error)
		body.add_child(WorkshopOverlay.gap(10))
	if _catalog.is_empty():
		_layout()
		return
	var q := _query.strip_edges().to_lower()
	var current: Variant = _catalog.get("current")
	var mine: Array = _catalog.get("mine", []) if _catalog.get("mine") is Array else []
	var community_by_image := {}
	for entry in mine:
		var flag: Dictionary = entry
		if bool(flag.get("community", false)) and not str(flag.get("dataUrl", "")).is_empty():
			community_by_image[str(flag["dataUrl"])] = true
	var suggested: Variant = _catalog.get("suggested")
	if suggested is Dictionary and q.is_empty():
		var row: Dictionary = suggested
		body.add_child(_row_title("Suggested"))
		var grid := _grid()
		grid.add_child(_card(str(row.get("name", "")), str(row.get("code", "")), str(row.get("imageUrl", "")), str(row.get("file", "")), current != null and str(current) == str(row.get("imageUrl", "")), str(row.get("imageUrl", "")), false, false, false))
		body.add_child(grid)
		body.add_child(WorkshopOverlay.gap(16))
	var in_map: Array = _catalog.get("inThisMap", []) if _catalog.get("inThisMap") is Array else []
	if not in_map.is_empty():
		body.add_child(_row_title("Already on this map"))
		var grid := _grid()
		for entry in in_map:
			var row: Dictionary = entry
			var value := str(row.get("value", ""))
			grid.add_child(_card(str(row.get("code", "")), "uploaded", value, str(row.get("file", "")), current != null and str(current) == value, value, value.begins_with("data:"), community_by_image.has(value), false))
		body.add_child(grid)
		body.add_child(WorkshopOverlay.gap(16))
	if not mine.is_empty():
		body.add_child(_row_title("My flags"))
		var grid := _grid()
		for entry in mine:
			var flag: Dictionary = entry
			var haystack := ("%s %s %s" % [str(flag.get("name", "")), str(flag.get("code", "")), str(flag.get("polity", "")) if flag.get("polity") != null else ""]).to_lower()
			if not q.is_empty() and not haystack.contains(q):
				continue
			var value := str(flag.get("dataUrl", ""))
			var code := str(flag.get("code", "")) if flag.get("code") != null else ""
			var card := _card(str(flag.get("name", "")), code if not code.is_empty() else "saved", value, str(flag.get("file", "")), current != null and str(current) == value, value, value.begins_with("data:"), bool(flag.get("community", false)), true)
			card.set_meta("flag", flag)
			grid.add_child(card)
		body.add_child(grid)
		body.add_child(WorkshopOverlay.gap(16))
	var built_in: Array = []
	for entry in _catalog.get("builtIn", []):
		var flag: Dictionary = entry
		if _codes == null or (_codes as Dictionary).has(str(flag.get("code", ""))):
			built_in.append(flag)
	body.add_child(_row_title("Built-in flags (%d)" % built_in.size()))
	if built_in.is_empty():
		var none := MarginContainer.new()
		none.add_theme_constant_override("margin_top", 10)
		none.add_theme_constant_override("margin_bottom", 10)
		none.add_child(UI.label("No flag matches “%s”." % _query, 13, Color(1, 1, 1, 0.6)))
		body.add_child(none)
	else:
		var grid := _grid()
		for flag in built_in:
			var row: Dictionary = flag
			grid.add_child(_card(str(row.get("name", "")), str(row.get("code", "")), str(row.get("imageUrl", "")), str(row.get("file", "")), current != null and str(current) == str(row.get("imageUrl", "")), str(row.get("imageUrl", "")), false, false, false))
		body.add_child(grid)
	_layout()


func _card(name: String, subtitle: String, image_value: String, file: String, active: bool, pick_value: String, can_publish: bool, from_community: bool, deletable: bool) -> MarginContainer:
	var root := MarginContainer.new()
	root.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	root.mouse_filter = Control.MOUSE_FILTER_STOP
	root.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	root.tooltip_text = name
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.1), 10, 1, Vector4(1, 1, 1, 1)))
	card.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(card)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	card.add_child(column)
	var image_box := PanelContainer.new()
	var image_style := UI.box(Color(0, 0, 0, 0.35), Color(0, 0, 0, 0), 0, 0)
	image_style.corner_radius_top_left = 9
	image_style.corner_radius_top_right = 9
	image_box.add_theme_stylebox_override("panel", image_style)
	image_box.custom_minimum_size.y = floorf(_card_width() * 2.0 / 3.0)
	image_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var picture := TextureRect.new()
	picture.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	picture.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	picture.mouse_filter = Control.MOUSE_FILTER_IGNORE
	image_box.add_child(picture)
	column.add_child(image_box)
	_queue.append([picture, image_value, file])
	var texts := MarginContainer.new()
	for pair in [["margin_left", 8], ["margin_right", 8], ["margin_top", 6], ["margin_bottom", 6]]:
		texts.add_theme_constant_override(pair[0], pair[1])
	texts.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var lines := VBoxContainer.new()
	lines.add_theme_constant_override("separation", 1)
	lines.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var heading := UI.label(name, 12, Color(1, 1, 1), 700)
	heading.clip_text = true
	heading.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	heading.custom_minimum_size.x = 40
	lines.add_child(heading)
	if not subtitle.is_empty():
		var sub := UI.label(subtitle, 11, Color(1, 1, 1, 0.55))
		sub.clip_text = true
		sub.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		sub.custom_minimum_size.x = 40
		lines.add_child(sub)
	texts.add_child(lines)
	column.add_child(texts)
	var layer := Control.new()
	layer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(layer)
	if active:
		var ring := Panel.new()
		var ring_style := StyleBoxFlat.new()
		ring_style.draw_center = false
		ring_style.border_color = Color(1, 1, 1, 0.28)
		ring_style.set_border_width_all(2)
		ring_style.set_corner_radius_all(10)
		ring.add_theme_stylebox_override("panel", ring_style)
		ring.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		ring.mouse_filter = Control.MOUSE_FILTER_IGNORE
		layer.add_child(ring)
		WorkshopOverlay.pin(WorkshopOverlay.badge("✓ In use", Color(1, 1, 1, 0.28), 6, 10.0, Vector4(5, 1, 5, 1)), layer, "top-right")
	if deletable:
		var delete := WorkshopUI.base_button("✕")
		var delete_style := UI.box(Color(0, 0, 0, 0.6), Color(0, 0, 0, 0), 6, 0, Vector4(5, 2, 5, 2))
		WorkshopUI._flat_styles(delete, delete_style, delete_style, delete_style, delete_style)
		WorkshopUI._ink(delete, Color(1, 1, 1), 11.0, 400)
		delete.tooltip_text = "Remove from My flags"
		WorkshopOverlay.pin(delete, layer, "bottom-right")
		delete.pressed.connect(func() -> void:
			var flag: Variant = root.get_meta("flag", {})
			if flag is Dictionary:
				_delete(flag))
	if from_community:
		var tag := WorkshopOverlay.badge("Community", Color(0, 0, 0, 0.6), 999, 9.6, Vector4(7, 2, 7, 2), Color(1, 1, 1, 0.2))
		tag.tooltip_text = "Installed from the community hub"
		tag.mouse_filter = Control.MOUSE_FILTER_PASS
		WorkshopOverlay.pin(tag, layer, "bottom-left")
	elif can_publish:
		var share := WorkshopUI.base_button("⤴")
		var share_style := UI.box(Color(1, 1, 1, 0.1), Color(0, 0, 0, 0), 6, 0, Vector4(5, 2, 5, 2))
		WorkshopUI._flat_styles(share, share_style, share_style, share_style, share_style)
		WorkshopUI._ink(share, Color(1, 1, 1), 11.0, 400)
		WorkshopOverlay.pin(share, layer, "bottom-left")
		UI.set_disabled_look(share, SHARE_REASON)
	root.gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventMouseButton and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT and not (event as InputEventMouseButton).pressed:
			if pick_value.is_empty():
				_pick(null)
			else:
				_pick(pick_value))
	return root


func _process(_delta: float) -> void:
	if _queue.is_empty():
		return
	var started := Time.get_ticks_usec()
	while not _queue.is_empty() and Time.get_ticks_usec() - started < 12000:
		var job: Array = _queue.pop_front()
		var picture: TextureRect = job[0]
		if not is_instance_valid(picture):
			continue
		var texture := WorkshopUI.flag_texture(str(job[1]), str(job[2]), 96)
		if texture:
			picture.texture = texture
		else:
			picture.texture = WorkshopUI.icon("flag", 24, Color(1, 1, 1, 0.5))
			picture.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
