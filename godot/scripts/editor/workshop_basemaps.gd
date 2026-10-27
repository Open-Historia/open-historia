class_name WorkshopBasemaps
extends WorkshopOverlay

const COMMUNITY_REASON := "The community's maps are not in the native Workshop yet."
const ADD_REASON := "Adding a basemap or detailed map is not in the native Workshop yet: it reads the file in a web page."
const SAVE_REASON := "Saving one of this scenario's maps to Your basemaps is not in the native Workshop yet: it draws the card's picture in a web page."
const SHARE_REASON := "Sharing a map with the community is not in the native Workshop yet."
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


func _init() -> void:
	super._init(Color(21 / 255.0, 21 / 255.0, 24 / 255.0, 0.98))


func setup(workshop: Workshop) -> void:
	host = workshop
	closed.connect(queue_free)
	_build_header()
	_render()
	await _refresh()


func _build_header() -> void:
	title("Maps")
	var active_bg := Color(0, 0, 0, 0.49)
	var active_border := Color(1, 1, 1, 0.28)
	var idle_border := Color(1, 1, 1, 0.1)
	header.add_child(WorkshopOverlay.tab_button("My Maps", true, active_bg, active_border, idle_border, Vector4(14, 5, 14, 5), 700))
	var community := WorkshopOverlay.tab_button("Community", false, active_bg, active_border, idle_border, Vector4(14, 5, 14, 5), 700)
	UI.set_disabled_look(community, COMMUNITY_REASON)
	header.add_child(community)
	spacer()
	var add := WorkshopUI.base_button("⬆ Add basemap or detailed map")
	var add_style := UI.box(Color(1, 1, 1, 0.14), Color(1, 1, 1, 0.23), 999, 1, Vector4(14, 5, 14, 5))
	WorkshopUI._flat_styles(add, add_style, add_style, add_style, add_style)
	WorkshopUI._ink(add, Color(1, 1, 1), 13.0, 700)
	add.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	UI.set_disabled_look(add, ADD_REASON)
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
		var tag := WorkshopOverlay.badge("Community ↗" if community_url != null and not str(community_url).is_empty() else "Community", Color(0, 0, 0, 0.6), 999, 9.6, Vector4(7, 2, 7, 2), Color(1, 1, 1, 0.2))
		tag.tooltip_text = "Installed from the community hub. Open its post" if community_url != null and not str(community_url).is_empty() else "Installed from the community hub"
		tag.mouse_filter = Control.MOUSE_FILTER_PASS
		WorkshopOverlay.pin(tag, layer, "bottom-left")
	elif publishable:
		var share := _round_button("⤴", Color(1, 1, 1, 0.28), Color(1, 1, 1, 0.25))
		WorkshopOverlay.pin(share, layer, "bottom-left")
		UI.set_disabled_look(share, SHARE_REASON)
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
		UI.set_disabled_look(keep, SAVE_REASON)
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
