class_name MapsBrowser
extends CanvasLayer

signal closed

const OVERLAY := Color(8 / 255.0, 8 / 255.0, 9 / 255.0, 0.82)
const PANEL_BG := Color(21 / 255.0, 21 / 255.0, 24 / 255.0, 0.98)
const PANEL_EDGE := Color(1, 1, 1, 0.1)
const HEADER_EDGE := Color(1, 1, 1, 0.08)
const CARD_BG := Color(1, 1, 1, 0.04)
const CARD_EDGE := Color(1, 1, 1, 0.09)
const PICTURE_BG := Color8(17, 17, 19)
const TITLE_INK := Color(1, 1, 1, 0.9)
const DIM_INK := Color(1, 1, 1, 0.4)
const ERROR_INK := Color("#fecaca")
const WARN_INK := Color("#fde68a")
const ADD_FILTERS := ["*.geojson, *.json, *.kml, *.kmz, *.zip, *.shp, *.tif, *.tiff, *.pmtiles, *.png, *.jpg, *.jpeg, *.svg ; Basemaps and detailed maps"]
const REFERENCE_ONLY := "That file can only be used as a reference inside the Map Editor."
const HUB_BASEMAPS_URL := "https://github.com/Open-Historia/Open-historia-scenarios/issues?q=is%3Aissue+label%3Abasemap"
const ADD_TOOLTIP := "A basemap: a picture (.png, .jpg) or a painted map (.geojson, .kml, .zip…). Or a detailed map: a .pmtiles file of picture tiles, up to 500 MB. GeoTIFF files and .pmtiles of vector tiles are shown for the current session only."
const NO_BASEMAPS := "No basemaps of your own yet. Use “⬆ Add basemap or detailed map” to add a picture or a painted map (.png, .jpg, .geojson…); it stays here so you can reuse it on any scenario."
const NO_DETAILED := "No detailed maps yet. Download one from the Community tab, or add your own .pmtiles file with “⬆ Add basemap or detailed map”. A detailed map is drawn on top of a scenario's basemap."
const NO_COMMUNITY := "No community basemaps yet — share one of yours with the ⤴ button on a “Your basemaps” card in My Maps."

static var _pictures := {}

var engine: EngineLink
var _tab := "mine"
var _filter := "all"
var _mine: Array = []
var _loading := false
var _busy := false
var _community: Array = []
var _community_loading := false
var _community_error := ""
var _community_loaded := false
var _busy_id := ""
var _official := {"entries": [], "error": ""}
var _official_loading := false
var _official_loaded := false
var _download := {}
var _download_call := 0
var _root: Control
var _panel: PanelContainer
var _header: HBoxContainer
var _body: VBoxContainer
var _scroll: ScrollContainer
var _dialog: Control


func _init() -> void:
	layer = 95


func setup(link: EngineLink, _export_dir := "") -> void:
	engine = link
	if engine and not engine.engine_event.is_connected(_on_event):
		engine.engine_event.connect(_on_event)
	_root = Control.new()
	_root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_root.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(_root)
	var shade := ColorRect.new()
	shade.color = OVERLAY
	shade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	shade.mouse_filter = Control.MOUSE_FILTER_STOP
	shade.gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventMouseButton and (event as InputEventMouseButton).pressed and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT:
			close())
	_root.add_child(shade)
	_panel = PanelContainer.new()
	_panel.add_theme_stylebox_override("panel", UI.box(PANEL_BG, PANEL_EDGE, 18, 1))
	_panel.mouse_filter = Control.MOUSE_FILTER_STOP
	_root.add_child(_panel)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	_panel.add_child(column)
	var header_box := PanelContainer.new()
	var header_style := UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 0, Vector4(17.6, 13.6, 17.6, 13.6))
	header_style.border_width_bottom = 1
	header_style.border_color = HEADER_EDGE
	header_box.add_theme_stylebox_override("panel", header_style)
	column.add_child(header_box)
	_header = HBoxContainer.new()
	_header.add_theme_constant_override("separation", 10)
	header_box.add_child(_header)
	_scroll = ScrollContainer.new()
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	column.add_child(_scroll)
	var pad := MarginContainer.new()
	pad.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for side in ["left", "top", "right", "bottom"]:
		pad.add_theme_constant_override("margin_" + side, 18)
	_scroll.add_child(pad)
	_body = VBoxContainer.new()
	_body.add_theme_constant_override("separation", 0)
	_body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	pad.add_child(_body)
	get_viewport().size_changed.connect(_layout)
	_layout()
	_render()
	_refresh_mine()


func close() -> void:
	if _download_call != 0 and engine:
		engine.cancel(_download_call)
	if engine and engine.engine_event.is_connected(_on_event):
		engine.engine_event.disconnect(_on_event)
	closed.emit()
	queue_free()


func _layout() -> void:
	if not is_instance_valid(_panel):
		return
	var view := get_viewport().get_visible_rect().size
	var width := minf(1056.0, view.x * 0.96)
	var height := minf(view.y * 0.88, view.y - 48.0)
	_panel.size = Vector2(width, height)
	_panel.position = (view - _panel.size) * 0.5


func _on_event(name: String, data: Variant) -> void:
	if name != "mapextras.install" or not (data is Dictionary) or _download.is_empty():
		return
	var event: Dictionary = data
	if int(event.get("call", 0)) != _download_call:
		return
	var total := float(event.get("total", 0))
	var received := float(event.get("received", 0))
	_download["percent"] = int(roundf(received / total * 100.0)) if total > 0.0 else -1
	_render_body()


func _render() -> void:
	_render_header()
	_render_body()


func _render_header() -> void:
	for child in _header.get_children():
		child.queue_free()
	var title := UI.label("Maps", 17, Color(1, 1, 1), 800)
	title.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_header.add_child(title)
	_header.add_child(_tab_button("My Maps", _tab == "mine", func() -> void: _set_tab("mine")))
	_header.add_child(_tab_button("Community", _tab == "community", func() -> void: _set_tab("community")))
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_header.add_child(spacer)
	var add := _pill("Adding…" if _busy else "⬆ Add basemap or detailed map", Color(1, 1, 1, 0.14), Color(1, 1, 1, 0.23), Color(1, 1, 1), 12.8, Vector4(14.4, 5.4, 14.4, 5.4))
	add.tooltip_text = ADD_TOOLTIP
	add.pressed.connect(_pick_file)
	_header.add_child(add)
	var shut := _pill("✕", Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.1), Color(1, 1, 1), 13.6, Vector4.ZERO)
	shut.custom_minimum_size = Vector2(32, 32)
	shut.tooltip_text = "Close"
	shut.pressed.connect(close)
	_header.add_child(shut)


func _set_tab(next: String) -> void:
	_tab = next
	_render()
	if next == "community":
		if not _community_loaded:
			_load_community(false)
		if not _official_loaded:
			_load_official(false)


func _render_body() -> void:
	if not is_instance_valid(_body):
		return
	for child in _body.get_children():
		child.queue_free()
	if _tab == "mine":
		_render_mine()
	else:
		_render_community()


func _render_mine() -> void:
	var painted := _mine.filter(func(bm: Dictionary) -> bool: return str(bm.get("kind", "")) != "tiled")
	var tiled := _mine.filter(func(bm: Dictionary) -> bool: return str(bm.get("kind", "")) == "tiled")
	_body.add_child(_row_title("Your basemaps"))
	if _loading:
		_body.add_child(_dim("Loading…"))
	elif painted.is_empty():
		_body.add_child(_dim(NO_BASEMAPS))
	else:
		var row := _shelf()
		for bm in painted:
			var entry: Dictionary = bm
			row.get_child(0).add_child(_library_card(entry, "drawn map" if str(entry.get("kind", "")) == "vector" else "picture"))
		_body.add_child(row)
	_gap(_body, 20.8)
	_body.add_child(_row_title("Your detailed maps"))
	if _loading:
		_body.add_child(_dim("Loading…"))
	elif tiled.is_empty():
		_body.add_child(_dim(NO_DETAILED))
	else:
		var row := _shelf()
		for bm in tiled:
			var entry: Dictionary = bm
			var official: Variant = entry.get("official")
			var version := " v%d" % int((official as Dictionary).get("version", 0)) if official is Dictionary else ""
			row.get_child(0).add_child(_library_card(entry, "detailed%s · %s" % [version, str(entry.get("size", ""))]))
		_body.add_child(row)


func _render_community() -> void:
	var bar := HBoxContainer.new()
	bar.add_theme_constant_override("separation", 8)
	var title := _row_title("Community maps")
	title.add_theme_constant_override("margin_bottom", 0)
	bar.add_child(title)
	bar.add_child(_tab_button("All", _filter == "all", func() -> void: _set_filter("all")))
	bar.add_child(_tab_button("Basemaps", _filter == "painted", func() -> void: _set_filter("painted")))
	bar.add_child(_tab_button("Detailed maps", _filter == "detailed", func() -> void: _set_filter("detailed")))
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	bar.add_child(spacer)
	var hub := _tab_button("Open hub ↗", false, func() -> void: OS.shell_open(HUB_BASEMAPS_URL))
	bar.add_child(hub)
	bar.add_child(_tab_button("↻ Refresh", false, func() -> void:
		_load_community(true)
		_load_official(true)))
	_body.add_child(bar)
	_gap(_body, 11.2)
	if _filter != "painted":
		if _filter == "all":
			_body.add_child(_row_title("Detailed maps"))
		_render_detailed()
		_gap(_body, 20.8)
	if _filter != "detailed":
		if _filter == "all":
			_body.add_child(_row_title("Basemaps"))
		if not _community_error.is_empty():
			_body.add_child(_dim(_community_error, ERROR_INK))
		if _community_loading:
			_body.add_child(_dim("Loading community basemaps…"))
		elif _community.is_empty() and _community_error.is_empty():
			_body.add_child(_dim(NO_COMMUNITY))
		else:
			var grid := _grid(176.0)
			for post in _community:
				grid.add_child(_community_card(post as Dictionary))
			_body.add_child(grid)


func _set_filter(next: String) -> void:
	_filter = next
	_render_body()


func _render_detailed() -> void:
	var entries: Array = _official.get("entries", [])
	var available := entries.filter(func(entry: Dictionary) -> bool: return not (entry.get("versions", []) as Array).is_empty())
	var error := str(_official.get("error", ""))
	if not error.is_empty():
		_body.add_child(_dim(("Showing the last list this game saw (%s)." % error) if not available.is_empty() else error, ERROR_INK))
	if _official_loading and available.is_empty():
		_body.add_child(_dim("Loading detailed maps…"))
		return
	if available.is_empty():
		if error.is_empty():
			_body.add_child(_dim("No detailed maps yet."))
		return
	var grid := _grid(208.0)
	for entry in available:
		grid.add_child(_detailed_card(entry as Dictionary))
	_body.add_child(grid)


func _detailed_card(entry: Dictionary) -> Control:
	var versions: Array = entry.get("versions", [])
	var latest: Dictionary = versions[versions.size() - 1]
	var have := int(entry.get("have", 0))
	var up_to_date := have >= int(latest.get("version", 0))
	var size := str(latest.get("size", ""))
	var busy := not _download.is_empty() and str(_download.get("id", "")) == str(entry.get("id", ""))
	var card := _card_shell(true)
	var picture := _picture_box(str(latest.get("preview", "")), "")
	picture.add_child(_badge("detailed · v%d · %s" % [int(latest.get("version", 0)), size], false))
	card.get_child(0).add_child(picture.get_parent())
	var info := _card_text_box(5.6)
	info.add_child(UI.wrapped(str(entry.get("name", "")), 13, Color(1, 1, 1), 700))
	if not str(entry.get("author", "")).is_empty():
		info.add_child(UI.wrapped("by %s" % str(entry.get("author", "")), 11, Color(1, 1, 1, 0.5)))
	if not str(entry.get("license", "")).is_empty():
		info.add_child(UI.wrapped(str(entry.get("license", "")), 11, Color(1, 1, 1, 0.45)))
	if have > 0 and not up_to_date and not str(latest.get("notes", "")).is_empty():
		info.add_child(UI.wrapped("New in v%d: %s" % [int(latest.get("version", 0)), str(latest.get("notes", ""))], 11, Color(1, 1, 1, 0.65)))
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
	var button := _tab_button(label, false, func() -> void: _download_official(entry))
	if up_to_date or not _download.is_empty():
		button.disabled = true
		button.mouse_default_cursor_shape = Control.CURSOR_ARROW
	if up_to_date:
		button.modulate.a = 0.7
	info.add_child(button)
	if busy:
		info.add_child(_tab_button("Cancel", false, func() -> void:
			if _download_call != 0:
				engine.cancel(_download_call)))
	card.get_child(0).add_child(info.get_parent())
	return card


func _community_card(post: Dictionary) -> Control:
	var installed := bool(post.get("installed", false))
	var can_install := bool(post.get("installable", false)) and not installed
	var card := _card_shell(true)
	var picture := _picture_box(str(post.get("picture", "")), "")
	if str(post.get("kind", "")) == "vector":
		picture.add_child(_badge("vector", false))
	if bool(post.get("fromScenario", false)):
		var scenario := _badge("from scenario", true)
		scenario.tooltip_text = "Shared as part of a scenario — installing pulls the map out of that scenario's file"
		picture.add_child(scenario)
	card.get_child(0).add_child(picture.get_parent())
	var info := _card_text_box(6.4)
	var name := UI.label(str(post.get("title", "")), 13, Color(1, 1, 1), 700)
	name.clip_text = true
	name.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	info.add_child(name)
	var author := UI.label("by %s" % str(post.get("author", "")), 11, Color(1, 1, 1, 0.5))
	author.clip_text = true
	author.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	info.add_child(author)
	var busy := _busy_id == str(post.get("id", ""))
	var text := "Installing…" if busy else ("✓ Installed" if installed else "⬇ Install")
	var button := _pill(text, Color(1, 1, 1, 0.1) if can_install else Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.1), Color(1, 1, 1), 12.8, Vector4(14.4, 5.1, 14.4, 5.1))
	button.tooltip_text = "Already in Your basemaps" if installed else ("Install into Your basemaps" if can_install else "This post has no basemap file attached")
	if not can_install or busy:
		button.disabled = true
		button.mouse_default_cursor_shape = Control.CURSOR_ARROW
	if not can_install and not installed:
		button.modulate.a = 0.5
	button.pressed.connect(func() -> void: _install(post))
	info.add_child(button)
	card.get_child(0).add_child(info.get_parent())
	return card


func _library_card(bm: Dictionary, badge_text: String) -> Control:
	var card := _card_shell(false)
	card.custom_minimum_size.x = 200
	card.tooltip_text = str(bm.get("name", ""))
	var picture := _picture_box(str(bm.get("thumbnail", "")), "")
	if not badge_text.is_empty():
		picture.add_child(_badge(badge_text, false))
	if bool(bm.get("community", false)):
		var url := str(bm.get("communityUrl", ""))
		var source := _pill("Community ↗" if not url.is_empty() else "Community", Color(0, 0, 0, 0.6), Color(1, 1, 1, 0.2), Color(1, 1, 1), 9.6, Vector4(7.2, 1.9, 7.2, 1.9))
		source.tooltip_text = "Installed from the community hub. Open its post" if not url.is_empty() else "Installed from the community hub"
		if not url.is_empty():
			source.pressed.connect(func() -> void: OS.shell_open(url))
		else:
			source.disabled = true
		_corner(source, "bottom_left")
		picture.add_child(source)
	else:
		var share := _pill("⤴", Color(1, 1, 1, 0.28), Color(1, 1, 1, 0.25), Color(1, 1, 1), 11.2, Vector4.ZERO)
		share.custom_minimum_size = Vector2(24, 24)
		share.tooltip_text = "Share this basemap to the community"
		share.pressed.connect(func() -> void: _publish(bm))
		_corner(share, "bottom_left")
		picture.add_child(share)
	var remove := _pill("✕", Color(0, 0, 0, 0.6), Color(1, 1, 1, 0.2), Color(1, 1, 1), 11.2, Vector4.ZERO)
	remove.custom_minimum_size = Vector2(24, 24)
	remove.tooltip_text = "Remove from your basemaps"
	remove.pressed.connect(func() -> void: _delete(bm))
	_corner(remove, "bottom_right")
	picture.add_child(remove)
	card.get_child(0).add_child(picture.get_parent())
	var info := _card_text_box(0)
	var title := UI.label(str(bm.get("name", "")), 13, Color(1, 1, 1), 600)
	title.clip_text = true
	title.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	info.add_child(title)
	card.get_child(0).add_child(info.get_parent())
	return card


func _card_shell(grid: bool) -> PanelContainer:
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", UI.box(CARD_BG, CARD_EDGE, 14, 1))
	card.clip_contents = true
	if grid:
		card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	card.add_child(column)
	return card


func _card_text_box(gap: float) -> VBoxContainer:
	var pad := MarginContainer.new()
	pad.add_theme_constant_override("margin_left", 10)
	pad.add_theme_constant_override("margin_right", 10)
	pad.add_theme_constant_override("margin_top", 8)
	pad.add_theme_constant_override("margin_bottom", 8)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", int(gap))
	pad.add_child(column)
	return column


func _picture_box(url: String, _filter_text: String) -> Control:
	var box := MarginContainer.new()
	box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	box.clip_contents = true
	var holder := Control.new()
	holder.clip_contents = true
	holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	holder.custom_minimum_size.y = 133
	holder.resized.connect(func() -> void:
		var wanted := roundf(holder.size.x / 1.5)
		if wanted > 0.0 and absf(holder.custom_minimum_size.y - wanted) >= 1.0:
			holder.custom_minimum_size.y = wanted)
	box.add_child(holder)
	var back := ColorRect.new()
	back.color = PICTURE_BG
	back.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	back.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.add_child(back)
	var picture := TextureRect.new()
	picture.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	picture.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	picture.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	picture.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.add_child(picture)
	if url.is_empty():
		var empty := UI.label("🗺️", 26, Color(1, 1, 1, 0.5))
		empty.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		empty.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		empty.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		holder.add_child(empty)
	else:
		_load_picture(picture, url)
	return holder


func _load_picture(target: TextureRect, url: String) -> void:
	if _pictures.has(url):
		target.texture = _pictures[url]
		return
	var reply: Dictionary = await engine.request("mapextras.picture", {"url": url})
	if not is_instance_valid(target):
		return
	var data := str((reply.get("result", {}) as Dictionary).get("data", "")) if reply.get("result") is Dictionary else ""
	if data.is_empty():
		return
	var bytes := Marshalls.base64_to_raw(data)
	var texture := ImageLoader.decode(bytes)
	if texture == null:
		return
	_pictures[url] = texture
	target.texture = texture


func _badge(text: String, right: bool) -> Label:
	var badge := UI.label(text.to_upper(), 10, Color(1, 1, 1), 700, "Arial", 0)
	var style := UI.box(Color(0, 0, 0, 0.55), Color(0, 0, 0, 0), 6, 0, Vector4(5.6, 1.6, 5.6, 1.6))
	badge.add_theme_stylebox_override("normal", style)
	badge.mouse_filter = Control.MOUSE_FILTER_PASS
	_corner(badge, "top_right" if right else "top_left")
	return badge


func _corner(node: Control, where: String) -> void:
	match where:
		"top_left":
			node.set_anchors_preset(Control.PRESET_TOP_LEFT)
			node.position = Vector2(6, 6)
		"top_right":
			node.set_anchors_preset(Control.PRESET_TOP_RIGHT)
			node.grow_horizontal = Control.GROW_DIRECTION_BEGIN
			node.offset_right = -6
			node.offset_top = 6
		"bottom_left":
			node.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
			node.grow_vertical = Control.GROW_DIRECTION_BEGIN
			node.offset_left = 6
			node.offset_bottom = -6
		"bottom_right":
			node.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
			node.grow_horizontal = Control.GROW_DIRECTION_BEGIN
			node.grow_vertical = Control.GROW_DIRECTION_BEGIN
			node.offset_right = -6
			node.offset_bottom = -6


func _shelf() -> ScrollContainer:
	var scroll := ScrollContainer.new()
	scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.custom_minimum_size.y = 200 / 1.5 + 44
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 13)
	scroll.add_child(row)
	return scroll


func _grid(min_width: float) -> GridContainer:
	var grid := GridContainer.new()
	var width := maxf(_panel.size.x - 36.0, min_width)
	grid.columns = maxi(1, int(floor((width + 13.0) / (min_width + 13.0))))
	grid.add_theme_constant_override("h_separation", 13)
	grid.add_theme_constant_override("v_separation", 13)
	grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return grid


func _row_title(text: String) -> MarginContainer:
	var holder := MarginContainer.new()
	holder.add_theme_constant_override("margin_bottom", 10)
	holder.add_child(UI.label(text, 15, TITLE_INK, 800))
	return holder


func _dim(text: String, colour := DIM_INK) -> MarginContainer:
	var holder := MarginContainer.new()
	holder.add_theme_constant_override("margin_top", 5)
	holder.add_theme_constant_override("margin_bottom", 11)
	var label := UI.wrapped(text, 13, colour)
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	holder.add_child(label)
	return holder


func _gap(parent: Control, height: float) -> void:
	var spacer := Control.new()
	spacer.custom_minimum_size.y = height
	parent.add_child(spacer)


func _pill(text: String, bg: Color, edge: Color, ink: Color, size: float, pad: Vector4) -> Button:
	var button := Button.new()
	button.text = text
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.add_theme_font_override("font", UI.font(700))
	button.add_theme_font_size_override("font_size", int(roundf(size)))
	for state in ["normal", "hover", "pressed", "hover_pressed", "focus", "disabled"]:
		button.add_theme_stylebox_override(state, UI.box(bg, edge, 999, 1, pad))
	for colour_name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color", "font_disabled_color"]:
		button.add_theme_color_override(colour_name, ink)
	button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	return button


func _tab_button(text: String, active: bool, on_press: Callable) -> Button:
	var bg := Color(0, 0, 0, 0.49) if active else Color(1, 1, 1, 0.06)
	var edge := Color(1, 1, 1, 0.28) if active else Color(1, 1, 1, 0.1)
	var button := _pill(text, bg, edge, Color(1, 1, 1), 12.8, Vector4(14.4, 5.1, 14.4, 5.1))
	button.pressed.connect(on_press)
	return button


func _refresh_mine() -> void:
	_loading = true
	_render_body()
	var reply: Dictionary = await engine.request("mapextras.library")
	if not is_inside_tree():
		return
	_loading = false
	var result: Variant = reply.get("result")
	_mine = (result as Dictionary).get("entries", []) if result is Dictionary else []
	_render_body()


func _load_community(force: bool) -> void:
	_community_loading = true
	_community_error = ""
	_render_body()
	var reply: Dictionary = await engine.request("mapextras.communityMaps", {"force": force})
	if not is_inside_tree():
		return
	_community_loading = false
	_community_loaded = true
	if bool(reply.get("ok", false)) and reply.get("result") is Dictionary:
		_community = (reply["result"] as Dictionary).get("posts", [])
	else:
		_community_error = str(reply.get("error", "The community's basemaps could not be read."))
	_render_body()


func _load_official(refresh: bool) -> void:
	_official_loading = true
	_render_body()
	var reply: Dictionary = await engine.request("mapextras.officialMaps", {"refresh": refresh})
	if not is_inside_tree():
		return
	_official_loading = false
	_official_loaded = true
	if bool(reply.get("ok", false)) and reply.get("result") is Dictionary:
		_official = reply["result"]
	else:
		_official = {"entries": _official.get("entries", []), "error": str(reply.get("error", ""))}
	_render_body()


func _download_official(entry: Dictionary) -> void:
	if not _download.is_empty():
		return
	_download = {"id": str(entry.get("id", "")), "percent": -1}
	_render_body()
	_download_call = engine.last_request_id() + 1
	var reply: Dictionary = await engine.request("mapextras.installBasemap", {"id": str(entry.get("id", ""))})
	_download_call = 0
	if not is_inside_tree():
		return
	_download = {}
	if not bool(reply.get("ok", false)) and not bool(reply.get("aborted", false)):
		await _alert("Download failed: %s" % str(reply.get("error", "")))
	_refresh_mine()
	_load_official(false)


func _install(post: Dictionary) -> void:
	if not _busy_id.is_empty():
		return
	_busy_id = str(post.get("id", ""))
	_render_body()
	var reply: Dictionary = await engine.request("mapextras.communityInstall", {"id": _busy_id})
	if not is_inside_tree():
		return
	_busy_id = ""
	if not bool(reply.get("ok", false)):
		await _alert("Install failed: %s" % str(reply.get("error", "")))
		_render_body()
		return
	_tab = "mine"
	_render()
	_refresh_mine()
	_community_loaded = false


func _delete(bm: Dictionary) -> void:
	var name := str(bm.get("name", ""))
	var message := ""
	if str(bm.get("kind", "")) == "tiled":
		var reply: Dictionary = await engine.request("mapextras.libraryUsers", {"id": str(bm.get("id", ""))})
		var users: Array = (reply.get("result", {}) as Dictionary).get("users", []) if reply.get("result") is Dictionary else []
		var size := str(bm.get("size", ""))
		if not users.is_empty():
			var names: PackedStringArray = []
			for user in users:
				names.append(str((user as Dictionary).get("name", "")))
			message = "\"%s\" is the detailed map of: %s. Deleting it frees %s; those scenarios will show their basemap until it's downloaded again. Delete it?" % [name, ", ".join(names), size if not size.is_empty() else "its space"]
		else:
			message = "Delete \"%s\"%s?" % [name, (" and free %s" % size) if not size.is_empty() else ""]
	else:
		message = "Delete the basemap “%s” from Your basemaps? Maps already using it keep their own copy." % (name if not name.is_empty() else "Custom basemap")
	if not await _confirm(message):
		return
	var removed: Dictionary = await engine.request("mapextras.libraryDelete", {"id": str(bm.get("id", ""))})
	if not bool(removed.get("ok", false)):
		await _alert("Could not delete that basemap: %s" % str(removed.get("error", "")))
	_refresh_mine()


func _publish(bm: Dictionary) -> void:
	var reply: Dictionary = await engine.request("mapextras.libraryPublish", {"id": str(bm.get("id", ""))})
	if not bool(reply.get("ok", false)):
		await _alert("Could not prepare that basemap for publishing: %s" % str(reply.get("error", "")))
		return
	var result: Dictionary = reply.get("result", {})
	var url := str(result.get("url", ""))
	if not url.is_empty():
		OS.shell_open(url)
	await _alert(str(result.get("message", "")))


func _pick_file() -> void:
	if _busy:
		return
	var picked := await EditorKit.pick_file(self, false, "", PackedStringArray(ADD_FILTERS))
	if picked.is_empty() or not is_inside_tree():
		return
	_add_file(picked)


func _add_file(file: String) -> void:
	_busy = true
	_render_header()
	var problem := await _add_upload(file)
	if not is_inside_tree():
		return
	_busy = false
	_render_header()
	if not problem.is_empty():
		await _alert("Could not add that map: %s" % problem)
	_refresh_mine()


func _add_upload(file: String) -> String:
	var ext := file.get_extension().to_lower()
	if ext == "pmtiles":
		var sent: Dictionary = await engine.request("workshop.library.uploadTiled", {"path": file})
		if not bool(sent.get("ok", false)):
			return str(sent.get("error", ""))
		var tiled: Dictionary = sent.get("result", {})
		return "" if tiled.get("basemap") is Dictionary else str(tiled.get("error", ""))
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
	var read: Dictionary = await engine.request("workshop.library.readUpload", {"path": upload, "name": file.get_file(), "format": format})
	if upload != file:
		DirAccess.remove_absolute(upload)
	if not bool(read.get("ok", false)):
		return str(read.get("error", ""))
	var info: Dictionary = read.get("result", {})
	if info.has("error"):
		return str(info["error"])
	if bool(info.get("sessionOnly", false)):
		return REFERENCE_ONLY
	var thumbnail := ""
	var aspect: Variant = null
	if str(info.get("kind", "")) == "image":
		var image := Image.new()
		var loaded := image.load_svg_from_buffer(FileAccess.get_file_as_bytes(file)) if ext == "svg" else image.load(file)
		if loaded != OK or image.get_width() <= 0 or image.get_height() <= 0:
			return "Could not read that image."
		aspect = float(image.get_width()) / float(image.get_height())
		thumbnail = WorkshopThumbnail.picture(image)
	else:
		thumbnail = await WorkshopThumbnail.drawn(self, info.get("thumbnail"))
	if not is_inside_tree():
		return ""
	var added: Dictionary = await engine.request("workshop.library.addUpload", {"token": info.get("token", ""), "thumbnail": thumbnail, "aspect": aspect})
	if not bool(added.get("ok", false)):
		return str(added.get("error", ""))
	var result: Dictionary = added.get("result", {})
	return str(result["error"]) if result.has("error") else ""


func _confirm(text: String) -> bool:
	return await _ask(text, true)


func _alert(text: String) -> void:
	await _ask(text, false)


func _ask(text: String, choice: bool) -> bool:
	if _dialog and is_instance_valid(_dialog):
		_dialog.queue_free()
	var layer := Control.new()
	layer.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	layer.mouse_filter = Control.MOUSE_FILTER_STOP
	_root.add_child(layer)
	_dialog = layer
	var shade := ColorRect.new()
	shade.color = Color(0, 0, 0, 0.45)
	shade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	layer.add_child(shade)
	var centre := CenterContainer.new()
	centre.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	layer.add_child(centre)
	var card := PanelContainer.new()
	card.custom_minimum_size.x = 440
	card.add_theme_stylebox_override("panel", UI.box(Color(30 / 255.0, 31 / 255.0, 35 / 255.0, 0.99), Color(1, 1, 1, 0.12), 12, 1, Vector4(20, 18, 20, 16)))
	centre.add_child(card)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 16)
	card.add_child(column)
	var message := UI.wrapped(text, 13, Color(1, 1, 1, 0.88))
	message.custom_minimum_size.x = 400
	column.add_child(message)
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_END
	row.add_theme_constant_override("separation", 8)
	column.add_child(row)
	var answer := [false]
	var finished := [false]
	if choice:
		var cancel := _tab_button("Cancel", false, func() -> void:
			finished[0] = true)
		row.add_child(cancel)
	var ok := _tab_button("OK", true, func() -> void:
		answer[0] = true
		finished[0] = true)
	row.add_child(ok)
	while not finished[0] and is_instance_valid(layer):
		await get_tree().process_frame
	if is_instance_valid(layer):
		layer.queue_free()
	return bool(answer[0])
