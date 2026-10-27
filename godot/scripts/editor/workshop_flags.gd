class_name WorkshopFlags
extends WorkshopOverlay

const MIN_CARD := 128.0
const GAP := 11.0

var host: Workshop
var polity_key := ""
var _catalog := {}
var _query := ""
var _codes: Variant = null
var _error := ""
var _queue: Array = []
var _serial := 0
var _remove_holder: Control
var _tab := "mine"
var _tab_buttons := {}
var _community: Array = []
var _community_loading := false
var _community_loaded := false
var _community_error := ""
var _community_notice := ""
var _hub_url := ""
var _busy_id := ""


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
	for pair in [["mine", "In the game"], ["community", "Community"]]:
		var id: String = pair[0]
		var tab := WorkshopOverlay.tab_button(str(pair[1]), id == _tab, Color(0, 0, 0, 0.5), Color(1, 1, 1, 0.12), Color(1, 1, 1, 0.12), Vector4(13, 6, 13, 6), 400)
		tab.pressed.connect(func() -> void: _set_tab(id))
		_tab_buttons[id] = tab
		header.add_child(tab)
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
	var image := WorkshopThumbnail.load_still(path)
	if image == null or image.get_width() <= 0 or image.get_height() <= 0:
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
	if _tab == "community":
		_render_community()
		_layout()
		return
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
			community_by_image[str(flag["dataUrl"])] = str(flag.get("communityUrl", "")) if flag.get("communityUrl") != null else ""
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
			var map_code := str(row.get("code", ""))
			grid.add_child(_card(map_code, "uploaded", value, str(row.get("file", "")), current != null and str(current) == value, value, value.begins_with("data:"), community_by_image.has(value), false, {"name": "%s flag" % map_code, "polity": map_code, "dataUrl": value}, str(community_by_image.get(value, ""))))
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
			var share := {"name": str(flag.get("name", "")), "polity": str(flag.get("polity", "")) if flag.get("polity") != null else "", "code": code, "dataUrl": value, "author": str(flag.get("author", ""))}
			var card := _card(str(flag.get("name", "")), code if not code.is_empty() else "saved", value, str(flag.get("file", "")), current != null and str(current) == value, value, value.begins_with("data:"), bool(flag.get("community", false)), true, share, str(flag.get("communityUrl", "")) if flag.get("communityUrl") != null else "")
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


func _card(name: String, subtitle: String, image_value: String, file: String, active: bool, pick_value: String, can_publish: bool, from_community: bool, deletable: bool, share_fields := {}, community_url := "") -> MarginContainer:
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
		var source := WorkshopUI.base_button("Community ↗" if not community_url.is_empty() else "Community")
		var source_style := UI.box(Color(0, 0, 0, 0.6), Color(1, 1, 1, 0.2), 999, 1, Vector4(7, 2, 7, 2))
		WorkshopUI._flat_styles(source, source_style, source_style, source_style, source_style)
		WorkshopUI._ink(source, Color(1, 1, 1), 9.6, 700)
		source.tooltip_text = "Installed from the community hub. Open its post" if not community_url.is_empty() else "Installed from the community hub"
		if community_url.is_empty():
			source.mouse_filter = Control.MOUSE_FILTER_PASS
			source.mouse_default_cursor_shape = Control.CURSOR_ARROW
		else:
			source.pressed.connect(func() -> void: host.open_url(community_url))
		WorkshopOverlay.pin(source, layer, "bottom-left")
	elif can_publish:
		var share := WorkshopUI.base_button("⤴")
		var share_style := UI.box(Color(1, 1, 1, 0.1), Color(0, 0, 0, 0), 6, 0, Vector4(5, 2, 5, 2))
		WorkshopUI._flat_styles(share, share_style, share_style, share_style, share_style)
		WorkshopUI._ink(share, Color(1, 1, 1), 11.0, 400)
		share.tooltip_text = "Share this flag with the community"
		share.pressed.connect(func() -> void: _share(share_fields))
		WorkshopOverlay.pin(share, layer, "bottom-left")
	root.gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventMouseButton and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT and not (event as InputEventMouseButton).pressed:
			if pick_value.is_empty():
				_pick(null)
			else:
				_pick(pick_value))
	return root


func _set_tab(id: String) -> void:
	_tab = id
	for key in _tab_buttons:
		var button: Button = _tab_buttons[key]
		var style := UI.box(Color(0, 0, 0, 0.5) if key == id else Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.12), 999, 1, Vector4(13, 6, 13, 6))
		WorkshopUI._flat_styles(button, style, style, style, style)
	if id == "community" and not _community_loaded and not _community_loading:
		_load_community(false)
	_render()


func _load_community(force: bool) -> void:
	_community_loading = true
	_community_error = ""
	_render()
	var reply := await host.request_raw("workshop.flags.community", {"force": force})
	if not is_instance_valid(self):
		return
	_community_loading = false
	var result: Dictionary = reply["result"] if reply.get("ok", false) and reply["result"] is Dictionary else {"error": str(reply.get("error", "Could not load community flags."))}
	if result.has("error"):
		_community_error = str(result["error"])
	else:
		_community = result.get("posts", [])
		_hub_url = str(result.get("hubUrl", ""))
		_community_loaded = true
	_render()


func _tool_button(text: String, bg := Color(1, 1, 1, 0.06), radius := 999) -> Button:
	var node := WorkshopUI.base_button(text)
	var style := UI.box(bg, Color(1, 1, 1, 0.12) if radius == 999 else Color(1, 1, 1, 0.14), radius, 1, Vector4(13, 6, 13, 6) if radius == 999 else Vector4(11, 6, 11, 6))
	WorkshopUI._flat_styles(node, style, UI.box(Color(bg.r, bg.g, bg.b, minf(1.0, bg.a + 0.06)), Color(1, 1, 1, 0.2), radius, 1, Vector4(13, 6, 13, 6) if radius == 999 else Vector4(11, 6, 11, 6)), style, style)
	WorkshopUI._ink(node, Color(1, 1, 1), 13.0, 400)
	node.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	return node


func _render_community() -> void:
	var bar := HBoxContainer.new()
	bar.add_theme_constant_override("separation", 8)
	var share := _tool_button("⬆ Share a flag", Color(1, 1, 1, 0.1), 8)
	share.tooltip_text = "Opens the hub's flag form — drag your image in and submit"
	share.pressed.connect(_share_form)
	bar.add_child(share)
	var hub := _tool_button("Open hub ↗")
	hub.pressed.connect(func() -> void:
		if not _hub_url.is_empty():
			host.open_url(_hub_url))
	bar.add_child(hub)
	var refresh := _tool_button("↻ Refresh")
	refresh.pressed.connect(func() -> void: _load_community(true))
	bar.add_child(refresh)
	body.add_child(bar)
	body.add_child(WorkshopOverlay.gap(10))
	if not _community_error.is_empty():
		body.add_child(WorkshopOverlay.dim_text(_community_error, Color("#fecaca")))
		body.add_child(WorkshopOverlay.gap(8))
	if not _community_notice.is_empty():
		body.add_child(WorkshopOverlay.dim_text(_community_notice, Color("#86efac")))
		body.add_child(WorkshopOverlay.gap(8))
	var q := _query.strip_edges().to_lower()
	var shown: Array = []
	for entry in _community:
		var post: Dictionary = entry
		var haystack := ("%s %s %s %s" % [str(post.get("title", "")), str(post.get("author", "")), str(post.get("code", "")), str(post.get("polity", ""))]).to_lower()
		if q.is_empty() or haystack.contains(q):
			shown.append(post)
	if _community_loading:
		body.add_child(WorkshopOverlay.dim_text("Loading community flags…", Color(1, 1, 1, 0.6)))
		return
	if shown.is_empty():
		body.add_child(WorkshopOverlay.dim_text("No community flags yet — “⬆ Share a flag” posts one to the hub for everyone." if _community.is_empty() else "No community flag matches “%s”." % _query, Color(1, 1, 1, 0.6)))
		return
	var saved_by_post := {}
	for entry in _catalog.get("mine", []):
		var flag: Dictionary = entry
		if bool(flag.get("community", false)) and flag.get("communityUrl") != null and not str(flag.get("communityUrl", "")).is_empty() and not str(flag.get("dataUrl", "")).is_empty():
			saved_by_post[str(flag["communityUrl"])] = flag
	var grid := _grid()
	for post in shown:
		grid.add_child(_community_card(post, saved_by_post))
	body.add_child(grid)


func _community_card(post: Dictionary, saved_by_post: Dictionary) -> PanelContainer:
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.1), 10, 1, Vector4(1, 1, 1, 1)))
	card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	card.add_child(column)
	var image_box := PanelContainer.new()
	var image_style := UI.box(Color(0, 0, 0, 0.35), Color(0, 0, 0, 0), 0, 0)
	image_style.corner_radius_top_left = 9
	image_style.corner_radius_top_right = 9
	image_box.add_theme_stylebox_override("panel", image_style)
	image_box.custom_minimum_size.y = floorf(_card_width() * 2.0 / 3.0)
	var picture := TextureRect.new()
	picture.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	picture.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	picture.mouse_filter = Control.MOUSE_FILTER_IGNORE
	image_box.add_child(picture)
	var layer := Control.new()
	layer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	image_box.add_child(layer)
	column.add_child(image_box)
	var picture_url := str(post.get("pictureUrl", ""))
	if picture_url.is_empty():
		picture.texture = WorkshopUI.icon("flag", 32, Color(1, 1, 1, 0.6))
		picture.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
	else:
		_ensure_images()
		HubImages.fetch(self, picture_url, func(texture: Variant) -> void:
			if is_instance_valid(picture) and texture is Texture2D:
				picture.texture = texture)
	var from_scenario := bool(post.get("fromScenario", false))
	var count := int(post.get("flagCount", 0))
	if from_scenario:
		WorkshopOverlay.pin(WorkshopOverlay.badge("%d flag%s · scenario" % [count, "" if count == 1 else "s"], Color(1, 1, 1, 0.28), 6, 9.9, Vector4(5, 2, 5, 2)), layer, "top-left")
	var texts := MarginContainer.new()
	for pair in [["margin_left", 8], ["margin_right", 8], ["margin_top", 6], ["margin_bottom", 8]]:
		texts.add_theme_constant_override(pair[0], pair[1])
	var lines := VBoxContainer.new()
	lines.add_theme_constant_override("separation", 1)
	var heading := UI.label(("✓ " if bool(post.get("official", false)) else "") + str(post.get("title", "")), 12, Color(1, 1, 1), 700)
	heading.clip_text = true
	heading.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	heading.custom_minimum_size.x = 40
	if bool(post.get("official", false)):
		heading.tooltip_text = "Posted by the project"
		heading.mouse_filter = Control.MOUSE_FILTER_PASS
	lines.add_child(heading)
	var byline := UI.label("by %s" % str(post.get("author", "")), 11, Color(1, 1, 1, 0.55))
	byline.clip_text = true
	byline.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	byline.custom_minimum_size.x = 40
	lines.add_child(byline)
	var id := str(post.get("id", ""))
	var url := str(post.get("url", "")) if post.get("url") != null else ""
	var saved: Variant = saved_by_post.get(url) if not url.is_empty() else null
	var busy := _busy_id == id
	var label := ("Adding…" if from_scenario else "Applying…") if busy else ("⬇ Add %d flag%s" % [count, "" if count == 1 else "s"] if from_scenario else "Use this flag")
	var action := _tool_button(label)
	action.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	action.clip_text = true
	action.custom_minimum_size.x = 40
	action.disabled = busy
	if from_scenario:
		action.tooltip_text = "Save this scenario's custom flags into My flags"
	elif saved is Dictionary:
		action.tooltip_text = "Already in My flags, so it is used from there"
	action.pressed.connect(func() -> void:
		if from_scenario:
			_install_pack(post)
		elif saved is Dictionary:
			_pick(str((saved as Dictionary).get("dataUrl", "")))
		else:
			_use_post(post))
	var gap := Control.new()
	gap.custom_minimum_size.y = 5
	lines.add_child(gap)
	lines.add_child(action)
	texts.add_child(lines)
	column.add_child(texts)
	return card


func _ensure_images() -> void:
	if not HubImages.cache_dir.is_empty():
		return
	var tiles := str(host.context.get("tiles_cache", ""))
	if not tiles.is_empty():
		HubImages.use_data_root(tiles.get_base_dir().get_base_dir())


func _use_post(post: Dictionary) -> void:
	_busy_id = str(post.get("id", ""))
	_community_error = ""
	_render()
	var reply := await host.request_raw("workshop.flags.useCommunity", {"postId": _busy_id})
	if not is_instance_valid(self):
		return
	_busy_id = ""
	var result: Dictionary = reply["result"] if reply.get("ok", false) and reply["result"] is Dictionary else {"error": str(reply.get("error", "Could not download that flag."))}
	if result.has("error"):
		_community_error = str(result["error"])
		_render()
		return
	await _pick(str(result.get("dataUrl", "")))


func _install_pack(post: Dictionary) -> void:
	_busy_id = str(post.get("id", ""))
	_community_error = ""
	_community_notice = ""
	_render()
	var reply := await host.request_raw("workshop.flags.installPack", {"postId": _busy_id})
	if not is_instance_valid(self):
		return
	_busy_id = ""
	var result: Dictionary = reply["result"] if reply.get("ok", false) and reply["result"] is Dictionary else {"error": str(reply.get("error", "Could not install that flag pack."))}
	if result.has("error"):
		_community_error = str(result["error"])
	else:
		_community_notice = str(result.get("notice", ""))
	await _load()


func _share_form() -> void:
	var reply := await host.request_raw("workshop.flags.shareForm", {"name": ("%s flag" % polity_key) if not polity_key.is_empty() else "", "author": str(_catalog.get("author", "")), "polity": polity_key})
	if reply.get("ok", false) and reply["result"] is Dictionary:
		host.open_url(str((reply["result"] as Dictionary).get("url", "")))


func _share(fields: Dictionary) -> void:
	var args := fields.duplicate()
	if str(args.get("author", "")).is_empty():
		args["author"] = str(_catalog.get("author", ""))
	var reply := await host.request_raw("workshop.flags.share", args)
	if not is_instance_valid(self):
		return
	var result: Dictionary = reply["result"] if reply.get("ok", false) and reply["result"] is Dictionary else {"error": "Could not prepare that flag for sharing: %s" % str(reply.get("error", ""))}
	if result.has("error"):
		await host.alert(str(result["error"]))
		return
	host.open_url(str(result.get("url", "")))
	await host.alert(str(result.get("message", "")))


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
