class_name WorkshopBasemaps
extends WorkshopOverlay

const HUB_BASEMAPS_URL := "https://github.com/Open-Historia/Open-historia-scenarios/issues?q=is%3Aissue+label%3Abasemap"
const SESSION_ONLY := "the native Workshop cannot show GeoTIFF files or .pmtiles files of vector tiles yet."
const ADD_FILTERS := ["*.geojson, *.json, *.kml, *.kmz, *.zip, *.shp, *.tif, *.tiff, *.pmtiles, *.png, *.jpg, *.jpeg, *.svg ; Basemaps and detailed maps"]
const KIND_LABELS := {"builtin": "built-in", "vector": "drawn map", "image": "picture", "plain": "plain sea", "detailed": "detailed map"}
const CARD_WIDTH := 200.0
const ROW_GAP := 13.0
const FILTER_SHADER := "shader_type canvas_item;\nuniform float brightness = 1.0;\nuniform float saturation = 1.0;\nuniform float contrast = 1.0;\nvoid fragment() {\n\tvec4 c = COLOR;\n\tvec3 v = clamp(c.rgb * brightness, 0.0, 1.0);\n\tfloat s = saturation;\n\tvec3 t = vec3((0.213 + 0.787 * s) * v.r + (0.715 - 0.715 * s) * v.g + (0.072 - 0.072 * s) * v.b, (0.213 - 0.213 * s) * v.r + (0.715 + 0.285 * s) * v.g + (0.072 - 0.072 * s) * v.b, (0.213 - 0.213 * s) * v.r + (0.715 - 0.715 * s) * v.g + (0.072 + 0.928 * s) * v.b);\n\tt = clamp(t, 0.0, 1.0);\n\tCOLOR = vec4(clamp((t - 0.5) * contrast + 0.5, 0.0, 1.0), c.a);\n}\n"

static var _previews := {}

var host: Workshop
var _data := {}
var _loading := true
var _queue: Array = []
var _shader: Shader
var _busy := false
var _notice := {}
var _add_button: Button
var _tab := "mine"
var _tab_buttons := {}
var _filter := "all"
var _community: Array = []
var _community_loading := false
var _community_loaded := false
var _community_error := ""
var _busy_id := ""
var _official := {"entries": [], "error": ""}
var _official_loading := false
var _official_loaded := false
var _download := {}
var _download_call := 0


func _init() -> void:
	super._init(Color(21 / 255.0, 21 / 255.0, 24 / 255.0, 0.98))


func setup(workshop: Workshop) -> void:
	host = workshop
	closed.connect(queue_free)
	host.engine.engine_event.connect(_on_engine_event)
	tree_exiting.connect(func() -> void:
		if is_instance_valid(host) and host.engine.engine_event.is_connected(_on_engine_event):
			host.engine.engine_event.disconnect(_on_engine_event))
	_build_header()
	_render()
	await _refresh()


func _build_header() -> void:
	title("Maps")
	var active_bg := Color(0, 0, 0, 0.49)
	var active_border := Color(1, 1, 1, 0.28)
	var idle_border := Color(1, 1, 1, 0.1)
	for pair in [["mine", "My Maps"], ["community", "Community"]]:
		var id: String = pair[0]
		var tab := WorkshopOverlay.tab_button(str(pair[1]), id == _tab, active_bg, active_border, idle_border, Vector4(14, 5, 14, 5), 700)
		tab.pressed.connect(func() -> void: _set_tab(id))
		_tab_buttons[id] = tab
		header.add_child(tab)
	spacer()
	var add := WorkshopUI.base_button("⬆ Add basemap or detailed map")
	var add_style := UI.box(Color(1, 1, 1, 0.14), Color(1, 1, 1, 0.23), 999, 1, Vector4(14, 5, 14, 5))
	WorkshopUI._flat_styles(add, add_style, add_style, add_style, add_style)
	WorkshopUI._ink(add, Color(1, 1, 1), 13.0, 700)
	add.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	add.tooltip_text = "A basemap: a picture (.png, .jpg) or a painted map (.geojson, .kml, .zip…). Or a detailed map: a .pmtiles file of picture tiles, up to 500 MB."
	add.pressed.connect(_add)
	_add_button = add
	header.add_child(add)
	var close := WorkshopUI.base_button("✕")
	var close_style := UI.box(Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.1), 999, 1, Vector4(0, 0, 0, 0))
	WorkshopUI._flat_styles(close, close_style, UI.box(Color(1, 1, 1, 0.1), Color(1, 1, 1, 0.16), 999, 1, Vector4(0, 0, 0, 0)), close_style, close_style)
	WorkshopUI._ink(close, Color(1, 1, 1), 14.0, 700)
	close.custom_minimum_size = Vector2(32, 32)
	close.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	close.tooltip_text = "Close"
	close.pressed.connect(func() -> void: closed.emit())
	header.add_child(close)


func _refresh() -> void:
	_loading = true
	var reply := await host.request_raw("workshop.maps")
	_loading = false
	_data = reply["result"] if reply.get("ok", false) and reply["result"] is Dictionary else {"maps": [], "builtins": [], "mine": []}
	_render()


func _change(method: String, args: Dictionary) -> void:
	var result := await host.request(method, args)
	if result.has("refused") and not str(result["refused"]).is_empty():
		await host.alert(str(result["refused"]))
	await _refresh()


func _render() -> void:
	WorkshopUI.clear(body)
	if not _notice.is_empty():
		var notice := WorkshopOverlay.dim_text(str(_notice.get("text", "")), Color("#fecaca") if str(_notice.get("tone", "")) == "error" else Color("#fde68a"))
		var notice_box := MarginContainer.new()
		notice_box.add_theme_constant_override("margin_bottom", 11)
		notice_box.add_child(notice)
		body.add_child(notice_box)
	if _tab == "community":
		_render_community()
		_layout()
		return
	_queue.clear()
	var maps: Array = _data.get("maps", []) if _data.get("maps") is Array else []
	if not maps.is_empty():
		body.add_child(_scenario_maps(maps))
		body.add_child(WorkshopOverlay.gap(21))
	body.add_child(_section_title("Built-in basemaps"))
	var builtins := _row()
	for entry in _data.get("builtins", []):
		var builtin: Dictionary = entry
		var id := str(builtin.get("id", ""))
		var card := _card(str(builtin.get("label", "")), "", bool(builtin.get("inScenario", false)), "★ Starting map" if bool(builtin.get("starting", false)) else "✓ In this scenario", false, false, false, "")
		_load_preview(card.get_meta("picture"), str(builtin.get("preview", "")), str(builtin.get("filter", "")))
		card.gui_input.connect(_on_card_click.bind(func() -> void: _change("workshop.maps.addBuiltin", {"builtinId": id})))
		(builtins.get_child(0) as HBoxContainer).add_child(card)
	body.add_child(builtins)
	body.add_child(WorkshopOverlay.gap(21))
	var mine: Array = _data.get("mine", []) if _data.get("mine") is Array else []
	var painted: Array = []
	var detailed: Array = []
	for entry in mine:
		if str((entry as Dictionary).get("kind", "")) == "tiled":
			detailed.append(entry)
		else:
			painted.append(entry)
	body.add_child(_section_title("Your basemaps"))
	if _loading:
		body.add_child(_dim("Loading…"))
	elif painted.is_empty():
		body.add_child(_dim("No basemaps of your own yet. Use “⬆ Add basemap or detailed map” to add a picture or a painted map (.png, .jpg, .geojson…); it stays here so you can reuse it on any scenario."))
	else:
		var row := _row()
		for entry in painted:
			(row.get_child(0) as HBoxContainer).add_child(_library_card(entry, "drawn map" if str((entry as Dictionary).get("kind", "")) == "vector" else "picture"))
		body.add_child(row)
	body.add_child(WorkshopOverlay.gap(21))
	body.add_child(_section_title("Your detailed maps"))
	if _loading:
		body.add_child(_dim("Loading…"))
	elif detailed.is_empty():
		body.add_child(_dim("No detailed maps yet. Download one from the Community tab, or add your own .pmtiles file with “⬆ Add basemap or detailed map”. A detailed map is drawn on top of a scenario's basemap."))
	else:
		var row := _row()
		for entry in detailed:
			var bm: Dictionary = entry
			var official: Variant = bm.get("official")
			var version := (" v%s" % str((official as Dictionary).get("version", ""))) if official is Dictionary else ""
			(row.get_child(0) as HBoxContainer).add_child(_library_card(bm, "detailed%s · %s" % [version, str(bm.get("size", ""))]))
		body.add_child(row)
	_layout()


func _section_title(text: String) -> MarginContainer:
	var holder := MarginContainer.new()
	holder.add_theme_constant_override("margin_bottom", 10)
	holder.add_child(WorkshopOverlay.row_title(text))
	return holder


func _dim(text: String) -> MarginContainer:
	var holder := MarginContainer.new()
	holder.add_theme_constant_override("margin_top", 5)
	holder.add_theme_constant_override("margin_bottom", 11)
	holder.add_child(WorkshopOverlay.dim_text(text))
	return holder


func _row() -> ScrollContainer:
	var scroll := ScrollContainer.new()
	scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_AUTO
	scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.custom_minimum_size.y = floorf(CARD_WIDTH * 2.0 / 3.0) + 46.0
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", int(ROW_GAP))
	scroll.add_child(line)
	return scroll


func _on_card_click(event: InputEvent, action: Callable) -> void:
	if event is InputEventMouseButton and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT and not (event as InputEventMouseButton).pressed:
		action.call()


func _card(name: String, badge_text: String, active: bool, active_label: String, deletable: bool, publishable: bool, from_community: bool, community_url: Variant) -> MarginContainer:
	var root := MarginContainer.new()
	root.custom_minimum_size.x = CARD_WIDTH
	root.mouse_filter = Control.MOUSE_FILTER_STOP
	root.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	root.tooltip_text = name
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.09), 14, 1, Vector4(1, 1, 1, 1)))
	card.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(card)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	card.add_child(column)
	var image_box := PanelContainer.new()
	var image_style := UI.box(Color("#111113"), Color(0, 0, 0, 0), 0, 0)
	image_style.corner_radius_top_left = 13
	image_style.corner_radius_top_right = 13
	image_box.add_theme_stylebox_override("panel", image_style)
	image_box.custom_minimum_size.y = floorf((CARD_WIDTH - 2.0) * 2.0 / 3.0)
	image_box.clip_contents = true
	image_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var picture := TextureRect.new()
	picture.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	picture.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	picture.mouse_filter = Control.MOUSE_FILTER_IGNORE
	image_box.add_child(picture)
	var layer := Control.new()
	layer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	image_box.add_child(layer)
	column.add_child(image_box)
	root.set_meta("picture", picture)
	if not badge_text.is_empty():
		WorkshopOverlay.pin(WorkshopOverlay.badge(badge_text.to_upper(), Color(0, 0, 0, 0.55), 6, 9.6, Vector4(5, 1, 5, 1)), layer, "top-left")
	if active:
		WorkshopOverlay.pin(WorkshopOverlay.badge(active_label, Color(1, 1, 1, 0.28), 999, 9.9, Vector4(6, 1, 6, 1)), layer, "top-right")
	if from_community:
		var link := str(community_url) if community_url != null else ""
		var tag := WorkshopUI.base_button("Community ↗" if not link.is_empty() else "Community")
		var tag_style := UI.box(Color(0, 0, 0, 0.6), Color(1, 1, 1, 0.2), 999, 1, Vector4(7, 2, 7, 2))
		WorkshopUI._flat_styles(tag, tag_style, tag_style, tag_style, tag_style)
		WorkshopUI._ink(tag, Color(1, 1, 1), 9.6, 700)
		tag.tooltip_text = "Installed from the community hub. Open its post" if not link.is_empty() else "Installed from the community hub"
		if link.is_empty():
			tag.mouse_filter = Control.MOUSE_FILTER_PASS
			tag.mouse_default_cursor_shape = Control.CURSOR_ARROW
		else:
			tag.pressed.connect(func() -> void: host.open_url(link))
		WorkshopOverlay.pin(tag, layer, "bottom-left")
	elif publishable:
		var share := _round_button("⤴", Color(1, 1, 1, 0.28), Color(1, 1, 1, 0.25))
		share.tooltip_text = "Share this basemap to the community"
		WorkshopOverlay.pin(share, layer, "bottom-left")
		root.set_meta("share", share)
	if deletable:
		var delete := _round_button("✕", Color(0, 0, 0, 0.6), Color(1, 1, 1, 0.2))
		delete.tooltip_text = "Remove from your basemaps"
		WorkshopOverlay.pin(delete, layer, "bottom-right")
		root.set_meta("delete", delete)
	var caption := MarginContainer.new()
	for pair in [["margin_left", 10], ["margin_right", 10], ["margin_top", 8], ["margin_bottom", 8]]:
		caption.add_theme_constant_override(pair[0], pair[1])
	caption.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var label := UI.label(name, 13, Color(1, 1, 1), 600)
	label.clip_text = true
	label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	label.custom_minimum_size.x = 40
	caption.add_child(label)
	column.add_child(caption)
	if active:
		var ring := Panel.new()
		var ring_style := StyleBoxFlat.new()
		ring_style.draw_center = false
		ring_style.border_color = Color(1, 1, 1, 0.22)
		ring_style.set_border_width_all(2)
		ring_style.set_corner_radius_all(14)
		ring.add_theme_stylebox_override("panel", ring_style)
		ring.mouse_filter = Control.MOUSE_FILTER_IGNORE
		root.add_child(ring)
	return root


func _round_button(text: String, bg: Color, border: Color) -> Button:
	var node := WorkshopUI.base_button(text)
	var style := UI.box(bg, border, 999, 1, Vector4(0, 0, 0, 0))
	WorkshopUI._flat_styles(node, style, style, style, style)
	WorkshopUI._ink(node, Color(1, 1, 1), 11.0, 400)
	node.custom_minimum_size = Vector2(24, 24)
	return node


func _library_card(bm: Dictionary, badge_text: String) -> MarginContainer:
	var id := str(bm.get("id", ""))
	var tiled := str(bm.get("kind", "")) == "tiled"
	var active_label := "★ Starting map" if tiled and bool(bm.get("starting", false)) else "✓ In this scenario"
	var card := _card(str(bm.get("name", "")), badge_text, bool(bm.get("inScenario", false)), active_label, true, true, bool(bm.get("community", false)), bm.get("communityUrl"))
	var thumbnail := str(bm.get("thumbnail", ""))
	if not thumbnail.is_empty():
		_queue.append([card.get_meta("picture"), thumbnail])
	else:
		_placeholder(card.get_meta("picture"))
	card.gui_input.connect(_on_card_click.bind(func() -> void: _change("workshop.maps.addLibrary", {"basemapId": id})))
	var delete: Button = card.get_meta("delete")
	delete.pressed.connect(func() -> void: _delete_library(bm))
	if card.has_meta("share"):
		(card.get_meta("share") as Button).pressed.connect(func() -> void: _publish(bm))
	return card


func _delete_library(bm: Dictionary) -> void:
	var name := str(bm.get("name", ""))
	var size_text := str(bm.get("size", ""))
	var message := ""
	if str(bm.get("kind", "")) == "tiled":
		var reply := await host.request_raw("workshop.maps.tiledUsers", {"basemapId": str(bm.get("id", ""))})
		var users: Array = (reply["result"] as Dictionary).get("users", []) if reply.get("ok", false) else []
		if not users.is_empty():
			var names: PackedStringArray = []
			for user in users:
				names.append(str((user as Dictionary).get("name", "")) if user is Dictionary else str(user))
			message = "\"%s\" is the detailed map of: %s. Deleting it frees %s; those scenarios will show their basemap until it's downloaded again. Delete it?" % [name, ", ".join(names), size_text if not size_text.is_empty() else "its space"]
		else:
			message = "Delete \"%s\"%s?" % [name, (" and free %s" % size_text) if not size_text.is_empty() else ""]
	else:
		message = "Delete the basemap “%s” from Your basemaps? Maps already using it keep their own copy." % (name if not name.is_empty() else "Custom basemap")
	if not await host.confirm(message):
		return
	var reply := await host.request_raw("workshop.maps.deleteLibrary", {"basemapId": str(bm.get("id", ""))})
	var problem := ""
	if not reply.get("ok", false):
		problem = "Could not delete that basemap: %s" % str(reply.get("error", ""))
	elif (reply["result"] as Dictionary).has("error"):
		problem = str((reply["result"] as Dictionary)["error"])
	if not problem.is_empty():
		await host.alert(problem)
	await _refresh()


func _scenario_maps(maps: Array) -> PanelContainer:
	var box := PanelContainer.new()
	box.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.03), Color(1, 1, 1, 0.09), 12, 1, Vector4(13, 11, 13, 11)))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 6)
	box.add_child(column)
	var heading := MarginContainer.new()
	heading.add_theme_constant_override("margin_bottom", 0)
	heading.add_child(WorkshopOverlay.row_title("This scenario's maps"))
	column.add_child(heading)
	var drawn: Array = []
	for entry in maps:
		if str((entry as Dictionary).get("kind", "")) == "vector":
			drawn.append(entry)
	var current := {}
	for entry in maps:
		if bool((entry as Dictionary).get("starting", false)):
			current = entry
	for entry in maps:
		column.add_child(_map_row(entry, drawn, maps, current))
	return box


func _map_row(map: Dictionary, drawn: Array, maps: Array, current: Dictionary) -> PanelContainer:
	var key := str(map.get("key", ""))
	var row := PanelContainer.new()
	row.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.04), Color(0, 0, 0, 0), 10, 0, Vector4(8, 6, 8, 6)))
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 8)
	row.add_child(line)
	var star := UI.label("★" if bool(map.get("starting", false)) else "", 13, Color(1, 1, 1))
	star.custom_minimum_size.x = 16
	star.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	star.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	if bool(map.get("starting", false)):
		star.tooltip_text = "The starting map"
		star.mouse_filter = Control.MOUSE_FILTER_PASS
	line.add_child(star)
	var name := UI.label(str(map.get("name", "")), 13, Color(1, 1, 1), 700)
	name.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	line.add_child(name)
	var kind := UI.label(str(KIND_LABELS.get(str(map.get("kind", "")), "")), 11, Color(1, 1, 1, 0.55), 600)
	kind.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	line.add_child(kind)
	if str(map.get("kind", "")) == "detailed":
		var over := HBoxContainer.new()
		over.add_theme_constant_override("separation", 5)
		over.modulate.a = 0.8
		over.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		over.add_child(UI.label("Shown over", 12, Color(1, 1, 1)))
		if drawn.size() > 1:
			var options: Array = []
			for entry in drawn:
				options.append([str((entry as Dictionary).get("key", "")), str((entry as Dictionary).get("name", ""))])
			var pick := WorkshopUI.select(options, str(map.get("over", "")), func(value: String) -> void: _change("workshop.maps.shownOver", {"key": key, "over": value}), 12.0, 24.0)
			pick.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
			pick.custom_minimum_size.x = 140
			over.add_child(pick)
		else:
			var over_name := ""
			for entry in maps:
				if str((entry as Dictionary).get("key", "")) == str(map.get("over", "")):
					over_name = str((entry as Dictionary).get("name", ""))
			over.add_child(UI.label(over_name, 12, Color(1, 1, 1), 700))
		line.add_child(over)
	var gap := Control.new()
	gap.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	gap.mouse_filter = Control.MOUSE_FILTER_IGNORE
	line.add_child(gap)
	if bool(map.get("canSaveToLibrary", false)):
		var keep := _small_button("Save to Your basemaps")
		keep.tooltip_text = "Keep a copy in Your basemaps, to use in your other scenarios"
		keep.pressed.connect(func() -> void: _save_to_library(map))
		line.add_child(keep)
	if not bool(map.get("starting", false)):
		var make := _small_button("★ Make starting map")
		make.tooltip_text = "Players start on this map"
		make.pressed.connect(func() -> void: _make_starting(map, current))
		line.add_child(make)
		var remove := WorkshopUI.base_button("✕")
		var clear := StyleBoxEmpty.new()
		for state_name in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
			remove.add_theme_stylebox_override(state_name, clear)
		WorkshopUI._ink(remove, Color(1, 1, 1), 13.0, 400)
		remove.tooltip_text = "Take this map out of the scenario's maps"
		remove.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		remove.pressed.connect(func() -> void: _change("workshop.maps.remove", {"key": key}))
		line.add_child(remove)
	return row


func _add() -> void:
	if _busy:
		return
	var picked := await EditorKit.pick_file(self, false, "", PackedStringArray(ADD_FILTERS))
	if picked.is_empty() or not is_inside_tree():
		return
	_busy = true
	_add_button.text = "Adding…"
	_notice = {}
	var problem := await _add_file(picked)
	if not is_instance_valid(self) or not is_inside_tree():
		return
	_busy = false
	_add_button.text = "⬆ Add basemap or detailed map"
	if not problem.is_empty():
		await host.alert("Could not add that map: " + problem)
	await _refresh()


func _add_file(file: String) -> String:
	var ext := file.get_extension().to_lower()
	if ext == "pmtiles":
		var sent := await host.request_raw("workshop.maps.uploadTiled", {"path": file})
		if not sent.get("ok", false):
			return str(sent.get("error", ""))
		var tiled: Dictionary = sent["result"]
		if tiled.get("basemap") is Dictionary:
			await _change("workshop.maps.addLibrary", {"basemapId": str((tiled["basemap"] as Dictionary).get("id", ""))})
			return ""
		return SESSION_ONLY if bool(tiled.get("vectorTiles", false)) else str(tiled.get("error", ""))
	var upload := file
	var format := ""
	if ext == "kml" or ext == "kmz":
		var text := FileAccess.get_file_as_string(file) if ext == "kml" else WorkshopKml.kmz_text(file)
		if ext == "kmz" and text.is_empty():
			return "No .kml found inside the .kmz archive."
		upload = OS.get_temp_dir().path_join("oh-basemap-%d.geojson" % Time.get_ticks_usec())
		var out := FileAccess.open(upload, FileAccess.WRITE)
		if out == null:
			return error_string(FileAccess.get_open_error())
		out.store_string(JSON.stringify(WorkshopKml.to_geojson(text)))
		out.close()
		format = "geojson"
	var read := await host.request_raw("workshop.maps.readUpload", {"path": upload, "name": file.get_file(), "format": format})
	if upload != file:
		DirAccess.remove_absolute(upload)
	if not read.get("ok", false):
		return str(read.get("error", ""))
	var info: Dictionary = read["result"]
	if info.has("error"):
		return str(info["error"])
	if bool(info.get("sessionOnly", false)):
		return SESSION_ONLY
	var thumbnail := ""
	var aspect: Variant = null
	if str(info.get("kind", "")) == "image":
		var image := Image.new()
		if image.load(file) != OK or image.get_width() <= 0 or image.get_height() <= 0:
			return "Could not read that image."
		aspect = float(image.get_width()) / float(image.get_height())
		thumbnail = WorkshopThumbnail.picture(image)
	else:
		thumbnail = await WorkshopThumbnail.drawn(self, info.get("thumbnail"))
	if not is_instance_valid(self):
		return ""
	var result := await host.request("workshop.maps.addUpload", {"thumbnail": thumbnail, "aspect": aspect})
	if result.has("refused") and not str(result["refused"]).is_empty():
		await host.alert(str(result["refused"]))
	if result.has("error"):
		return str(result["error"])
	if result.has("libraryError"):
		_notice = {"tone": "error", "text": "The basemap is in this scenario's maps, but it could not be saved to Your basemaps, so it will not be here to reuse."}
	elif bool(result.get("added", false)):
		_notice = {"tone": "warn", "text": "Added to this scenario's maps. To draw on it, make it the starting map (★)."}
	return ""


func _save_to_library(map: Dictionary) -> void:
	var key := str(map.get("key", ""))
	var reply := await host.request_raw("workshop.maps.thumbnailSource", {"key": key})
	var source: Variant = (reply["result"] as Dictionary).get("source") if reply.get("ok", false) and reply["result"] is Dictionary else null
	var thumbnail := ""
	if source is Dictionary and str((source as Dictionary).get("kind", "")) == "image":
		thumbnail = WorkshopThumbnail.picture_file(str((source as Dictionary).get("file", "")))
	elif source is Dictionary:
		thumbnail = await WorkshopThumbnail.drawn(self, source)
	if not is_instance_valid(self):
		return
	var saved := await host.request_raw("workshop.maps.saveToLibrary", {"key": key, "thumbnail": thumbnail})
	var problem := ""
	if not saved.get("ok", false):
		problem = "Could not save that map to Your basemaps: %s" % str(saved.get("error", ""))
	elif (saved["result"] as Dictionary).has("error"):
		problem = str((saved["result"] as Dictionary)["error"])
	if not problem.is_empty():
		await host.alert(problem)
	await _refresh()


func _publish(bm: Dictionary) -> void:
	var reply := await host.engine.request("mapextras.libraryPublish", {"id": str(bm.get("id", ""))})
	if not is_instance_valid(self):
		return
	if not reply.get("ok", false):
		await host.alert(("Could not prepare that basemap for publishing: %s" if str(bm.get("kind", "")) != "tiled" else "%s") % str(reply.get("error", "")))
		return
	var result: Dictionary = reply["result"] if reply["result"] is Dictionary else {}
	host.open_url(str(result.get("url", "")))
	await host.alert(str(result.get("message", "")))


func _set_tab(id: String) -> void:
	_tab = id
	for key in _tab_buttons:
		var button: Button = _tab_buttons[key]
		var style := UI.box(Color(0, 0, 0, 0.49) if key == id else Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.28) if key == id else Color(1, 1, 1, 0.1), 999, 1, Vector4(14, 5, 14, 5))
		WorkshopUI._flat_styles(button, style, style, style, style)
	if id == "community":
		if not _community_loaded and not _community_loading:
			_load_community(false)
		if not _official_loaded and not _official_loading:
			_load_official(false)
	_render()


func _on_engine_event(name: String, data: Variant) -> void:
	if name != "mapextras.install" or not (data is Dictionary) or _download.is_empty():
		return
	var event: Dictionary = data
	if int(event.get("call", 0)) != _download_call:
		return
	var total := float(event.get("total", 0))
	var received := float(event.get("received", 0))
	_download["percent"] = int(roundf(received / total * 100.0)) if total > 0.0 else -1
	_render()


func _load_community(force: bool) -> void:
	_community_loading = true
	_community_error = ""
	_render()
	var reply := await host.engine.request("mapextras.communityMaps", {"force": force})
	if not is_instance_valid(self) or not is_inside_tree():
		return
	_community_loading = false
	_community_loaded = true
	if reply.get("ok", false) and reply["result"] is Dictionary:
		_community = (reply["result"] as Dictionary).get("posts", [])
	else:
		_community_error = str(reply.get("error", "Could not load community basemaps."))
	_render()


func _load_official(refresh: bool) -> void:
	_official_loading = true
	_render()
	var reply := await host.engine.request("mapextras.officialMaps", {"refresh": refresh})
	if not is_instance_valid(self) or not is_inside_tree():
		return
	_official_loading = false
	_official_loaded = true
	if reply.get("ok", false) and reply["result"] is Dictionary:
		_official = reply["result"]
	else:
		_official = {"entries": _official.get("entries", []), "error": str(reply.get("error", ""))}
	_render()


func _pill(text: String, active := false) -> Button:
	return WorkshopOverlay.tab_button(text, active, Color(0, 0, 0, 0.49), Color(1, 1, 1, 0.28), Color(1, 1, 1, 0.1), Vector4(14, 5, 14, 5), 400, 12.8)


func _render_community() -> void:
	var bar := HFlowContainer.new()
	bar.add_theme_constant_override("h_separation", 8)
	bar.add_theme_constant_override("v_separation", 8)
	var heading := WorkshopOverlay.row_title("Community maps")
	heading.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	bar.add_child(heading)
	for pair in [["all", "All"], ["painted", "Basemaps"], ["detailed", "Detailed maps"]]:
		var id: String = pair[0]
		var chip := _pill(str(pair[1]), _filter == id)
		chip.pressed.connect(func() -> void:
			_filter = id
			_render())
		bar.add_child(chip)
	var hub := _pill("Open hub ↗")
	hub.pressed.connect(func() -> void: host.open_url(HUB_BASEMAPS_URL))
	bar.add_child(hub)
	var refresh := _pill("↻ Refresh")
	refresh.pressed.connect(func() -> void:
		_load_community(true)
		_load_official(true))
	bar.add_child(refresh)
	body.add_child(bar)
	body.add_child(WorkshopOverlay.gap(11))
	if _filter != "painted":
		if _filter == "all":
			body.add_child(_section_title("Detailed maps"))
		_render_detailed()
		body.add_child(WorkshopOverlay.gap(21))
	if _filter != "detailed":
		if _filter == "all":
			body.add_child(_section_title("Basemaps"))
		if not _community_error.is_empty():
			body.add_child(_dim_colored(_community_error, Color("#fecaca")))
		if _community_loading:
			body.add_child(_dim("Loading community basemaps…"))
		elif _community.is_empty() and _community_error.is_empty():
			body.add_child(_dim("No community basemaps yet — share one of yours with the ⤴ button on a “Your basemaps” card in My Maps."))
		elif not _community.is_empty():
			var grid := _community_grid(176.0)
			for post in _community:
				grid.add_child(_community_card(post as Dictionary))
			body.add_child(grid)


func _dim_colored(text: String, color: Color) -> MarginContainer:
	var holder := MarginContainer.new()
	holder.add_theme_constant_override("margin_top", 5)
	holder.add_theme_constant_override("margin_bottom", 11)
	holder.add_child(WorkshopOverlay.dim_text(text, color))
	return holder


func _community_grid(min_width: float) -> GridContainer:
	var grid := GridContainer.new()
	grid.columns = columns_for(min_width, 13.0)
	grid.add_theme_constant_override("h_separation", 13)
	grid.add_theme_constant_override("v_separation", 13)
	grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return grid


func _render_detailed() -> void:
	var entries: Array = _official.get("entries", []) if _official.get("entries") is Array else []
	var available := entries.filter(func(entry: Variant) -> bool: return entry is Dictionary and not ((entry as Dictionary).get("versions", []) as Array).is_empty())
	var error := str(_official.get("error", ""))
	if not error.is_empty():
		body.add_child(_dim_colored(("Showing the last list this game saw (%s)." % error) if not available.is_empty() else error, Color("#fecaca")))
	if _official_loading and available.is_empty():
		body.add_child(_dim("Loading detailed maps…"))
		return
	if available.is_empty():
		if error.is_empty():
			body.add_child(_dim("No detailed maps yet."))
		return
	var grid := _community_grid(208.0)
	for entry in available:
		grid.add_child(_detailed_card(entry as Dictionary))
	body.add_child(grid)


func _grid_card(picture_url: String) -> Array:
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.09), 14, 1, Vector4(1, 1, 1, 1)))
	card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	card.add_child(column)
	var image_box := PanelContainer.new()
	var image_style := UI.box(Color("#111113"), Color(0, 0, 0, 0), 0, 0)
	image_style.corner_radius_top_left = 13
	image_style.corner_radius_top_right = 13
	image_box.add_theme_stylebox_override("panel", image_style)
	image_box.clip_contents = true
	image_box.custom_minimum_size.y = 120
	image_box.resized.connect(func() -> void:
		var wanted := roundf(image_box.size.x / 1.5)
		if wanted > 0.0 and absf(image_box.custom_minimum_size.y - wanted) >= 1.0:
			image_box.custom_minimum_size.y = wanted)
	var picture := TextureRect.new()
	picture.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	picture.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	picture.mouse_filter = Control.MOUSE_FILTER_IGNORE
	image_box.add_child(picture)
	var layer := Control.new()
	layer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	image_box.add_child(layer)
	column.add_child(image_box)
	if picture_url.is_empty():
		_placeholder(picture)
	else:
		_community_picture(picture, picture_url)
	var info := MarginContainer.new()
	for pair in [["margin_left", 10], ["margin_right", 10], ["margin_top", 8], ["margin_bottom", 10]]:
		info.add_theme_constant_override(pair[0], pair[1])
	var lines := VBoxContainer.new()
	lines.add_theme_constant_override("separation", 6)
	info.add_child(lines)
	column.add_child(info)
	return [card, layer, lines]


func _community_picture(target: TextureRect, url: String) -> void:
	if _previews.has(url):
		target.texture = _previews[url]
		return
	var reply := await host.engine.request("mapextras.picture", {"url": url})
	if not is_instance_valid(target):
		return
	var data := str((reply["result"] as Dictionary).get("data", "")) if reply.get("ok", false) and reply["result"] is Dictionary else ""
	if data.is_empty():
		return
	var image := HubImages.decode_image(Marshalls.base64_to_raw(data))
	if image == null or image.is_empty():
		return
	var texture := ImageTexture.create_from_image(image)
	_previews[url] = texture
	target.texture = texture


func _detailed_card(entry: Dictionary) -> PanelContainer:
	var versions: Array = entry.get("versions", [])
	var latest: Dictionary = versions[versions.size() - 1]
	var have := int(entry.get("have", 0))
	var up_to_date := have >= int(latest.get("version", 0))
	var size := str(latest.get("size", ""))
	var busy := not _download.is_empty() and str(_download.get("id", "")) == str(entry.get("id", ""))
	var parts := _grid_card(str(latest.get("preview", "")))
	WorkshopOverlay.pin(WorkshopOverlay.badge(("detailed · v%d · %s" % [int(latest.get("version", 0)), size]).to_upper(), Color(0, 0, 0, 0.55), 6, 9.6, Vector4(5, 1, 5, 1)), parts[1], "top-left")
	var lines: VBoxContainer = parts[2]
	lines.add_child(WorkshopUI.wrap(str(entry.get("name", "")), 12.8, Color(1, 1, 1), 700))
	if not str(entry.get("author", "")).is_empty():
		lines.add_child(WorkshopUI.wrap("by %s" % str(entry.get("author", "")), 10.9, Color(1, 1, 1, 0.5)))
	if not str(entry.get("license", "")).is_empty():
		lines.add_child(WorkshopUI.wrap(str(entry.get("license", "")), 10.6, Color(1, 1, 1, 0.45)))
	if have > 0 and not up_to_date and not str(latest.get("notes", "")).is_empty():
		lines.add_child(WorkshopUI.wrap("New in v%d: %s" % [int(latest.get("version", 0)), str(latest.get("notes", ""))], 10.9, Color(1, 1, 1, 0.65)))
	var label := ""
	if busy:
		var percent := int(_download.get("percent", -1))
		label = "Downloading…" + (" %d%%" % percent if percent >= 0 else "")
	elif up_to_date:
		label = "✓ Downloaded (v%d)" % have
	elif have > 0:
		label = "⬆ Update to v%d (%s)" % [int(latest.get("version", 0)), size]
	else:
		label = "⬇ Download (%s)" % size
	var button := _pill(label)
	if up_to_date or not _download.is_empty():
		button.disabled = true
		button.mouse_default_cursor_shape = Control.CURSOR_ARROW
	if up_to_date:
		button.modulate.a = 0.7
	button.pressed.connect(func() -> void: _download_official(entry))
	lines.add_child(button)
	if busy:
		var cancel := _pill("Cancel")
		cancel.pressed.connect(func() -> void:
			if _download_call != 0:
				host.engine.cancel(_download_call))
		lines.add_child(cancel)
	return parts[0]


func _community_card(post: Dictionary) -> PanelContainer:
	var installed := bool(post.get("installed", false))
	var can_install := bool(post.get("installable", false)) and not installed
	var parts := _grid_card(str(post.get("picture", "")))
	if str(post.get("kind", "")) == "vector":
		WorkshopOverlay.pin(WorkshopOverlay.badge("VECTOR", Color(0, 0, 0, 0.55), 6, 9.6, Vector4(5, 1, 5, 1)), parts[1], "top-left")
	if bool(post.get("fromScenario", false)):
		var scenario := WorkshopOverlay.badge("FROM SCENARIO", Color(0, 0, 0, 0.55), 6, 9.6, Vector4(5, 1, 5, 1))
		scenario.tooltip_text = "Shared as part of a scenario — installing pulls the map out of that scenario's file"
		scenario.mouse_filter = Control.MOUSE_FILTER_PASS
		WorkshopOverlay.pin(scenario, parts[1], "top-right")
	var lines: VBoxContainer = parts[2]
	var name := UI.label(str(post.get("title", "")), 13, Color(1, 1, 1), 700)
	name.clip_text = true
	name.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	name.custom_minimum_size.x = 40
	lines.add_child(name)
	var byline := UI.label("by %s" % str(post.get("author", "")), 11, Color(1, 1, 1, 0.5))
	byline.clip_text = true
	byline.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	byline.custom_minimum_size.x = 40
	lines.add_child(byline)
	var busy := _busy_id == str(post.get("id", ""))
	var button := WorkshopOverlay.tab_button("Installing…" if busy else ("✓ Installed" if installed else "⬇ Install"), false, Color(0, 0, 0, 0.49), Color(1, 1, 1, 0.28), Color(1, 1, 1, 0.1), Vector4(14, 5, 14, 5), 400, 12.8)
	var style := UI.box(Color(1, 1, 1, 0.1) if can_install else Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.1), 999, 1, Vector4(14, 5, 14, 5))
	WorkshopUI._flat_styles(button, style, style, style, style)
	button.tooltip_text = "Already in Your basemaps" if installed else ("Install into Your basemaps" if can_install else "This post has no basemap file attached")
	if not can_install or busy:
		button.disabled = true
		button.mouse_default_cursor_shape = Control.CURSOR_ARROW
	if not can_install and not installed:
		button.modulate.a = 0.5
	button.pressed.connect(func() -> void: _install(post))
	lines.add_child(button)
	return parts[0]


func _download_official(entry: Dictionary) -> void:
	if not _download.is_empty():
		return
	_download = {"id": str(entry.get("id", "")), "percent": -1}
	_render()
	_download_call = host.engine.last_request_id() + 1
	var reply := await host.engine.request("mapextras.installBasemap", {"id": str(entry.get("id", ""))})
	_download_call = 0
	if not is_instance_valid(self) or not is_inside_tree():
		return
	_download = {}
	if not reply.get("ok", false) and not bool(reply.get("aborted", false)):
		await host.alert("Download failed: %s" % str(reply.get("error", "")))
	await _refresh()
	_load_official(false)


func _install(post: Dictionary) -> void:
	if not _busy_id.is_empty():
		return
	_busy_id = str(post.get("id", ""))
	_render()
	var reply := await host.engine.request("mapextras.communityInstall", {"id": _busy_id})
	if not is_instance_valid(self) or not is_inside_tree():
		return
	_busy_id = ""
	if not reply.get("ok", false):
		await host.alert("Install failed: %s" % str(reply.get("error", "")))
		_render()
		return
	_community_loaded = false
	await _refresh()
	_set_tab("mine")


func _small_button(text: String) -> Button:
	var node := WorkshopOverlay.tab_button(text, false, Color(0, 0, 0, 0.49), Color(1, 1, 1, 0.28), Color(1, 1, 1, 0.1), Vector4(10, 3, 10, 3), 700, 11.5)
	return node


func _make_starting(map: Dictionary, current: Dictionary) -> void:
	if str(map.get("kind", "")) == "builtin" and not current.is_empty() and str(current.get("kind", "")) != "builtin":
		var was := str(current.get("name", ""))
		if not await host.confirm("%s won't be the starting map any more: players will start on %s, a map of the real world. %s stays in this scenario's maps." % [was, str(map.get("name", "")), was]):
			return
	await _change("workshop.maps.makeStarting", {"key": str(map.get("key", ""))})


func _placeholder(picture: TextureRect) -> void:
	picture.texture = WorkshopUI.icon("map", 26, Color(1, 1, 1, 0.5))
	picture.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED


func _filter_material(filter: String) -> ShaderMaterial:
	if filter.is_empty():
		return null
	if _shader == null:
		_shader = Shader.new()
		_shader.code = FILTER_SHADER
	var material := ShaderMaterial.new()
	material.shader = _shader
	for pair in [["brightness", "brightness"], ["saturate", "saturation"], ["contrast", "contrast"]]:
		var found := RegEx.create_from_string(str(pair[0]) + "\\(([0-9.]+)\\)").search(filter)
		if found:
			material.set_shader_parameter(str(pair[1]), float(found.get_string(1)))
	return material


func _load_preview(picture: TextureRect, url: String, filter: String) -> void:
	picture.material = _filter_material(filter)
	if _previews.has(url):
		picture.texture = _previews[url]
		return
	var reply := await host.request_raw("workshop.maps.preview", {"url": url})
	if not is_instance_valid(picture):
		return
	var file := str((reply["result"] as Dictionary).get("file", "")) if reply.get("ok", false) else ""
	var texture: Texture2D = null
	if not file.is_empty():
		var bytes := FileAccess.get_file_as_bytes(file)
		var image := Image.new()
		var status := ERR_FILE_UNRECOGNIZED
		if bytes.size() > 4 and bytes[0] == 0xFF and bytes[1] == 0xD8:
			status = image.load_jpg_from_buffer(bytes)
		elif bytes.size() > 4 and bytes[0] == 0x89 and bytes[1] == 0x50:
			status = image.load_png_from_buffer(bytes)
		if status == OK:
			texture = ImageTexture.create_from_image(image)
			_previews[url] = texture
	if texture:
		picture.texture = texture
	else:
		picture.material = null
		_placeholder(picture)


func _process(_delta: float) -> void:
	if _queue.is_empty():
		return
	var started := Time.get_ticks_usec()
	while not _queue.is_empty() and Time.get_ticks_usec() - started < 12000:
		var job: Array = _queue.pop_front()
		var picture: TextureRect = job[0]
		if not is_instance_valid(picture):
			continue
		var texture := WorkshopUI.flag_texture(str(job[1]), "", 0)
		if texture:
			picture.texture = texture
		else:
			_placeholder(picture)
