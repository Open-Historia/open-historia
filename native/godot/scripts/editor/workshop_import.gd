class_name WorkshopImport
extends WorkshopShell

const WORLD := {"west": -180.0, "east": 180.0, "north": 85.05112878, "south": -85.05112878}
const PIXEL_CAP := 30000000
const DIM := Color(1, 1, 1, 0.5)
const AMBER_BG := Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.08)
const AMBER_BORDER := Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.2)
const AMBER_INK := Color(254 / 255.0, 215 / 255.0, 170 / 255.0, 0.92)
const GREEN_BG := Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.08)
const GREEN_BORDER := Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.22)
const RED_BG := Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.08)

var host: Workshop
var mode := "raster"
var raster_file := ""
var definition_file := ""
var geojson_file := ""
var metadata_file := ""
var geo_join_key := "auto"
var metadata_join_key := "auto"
var metadata_name_field := "auto"
var merge_all_metadata := true
var geo_key_options: Array = []
var metadata_key_options: Array = []
var metadata_field_options: Array = []
var bounds := {"west": "-180", "east": "180", "north": "85.05112878", "south": "-85.05112878"}
var opacity := 0.46
var overlay_visible := true
var land_only := true
var ignore_black := true
var inherit_owners := true
var simplify_outlines := true
var materialize_standard_flags := true
var import_cities := true
var replace_existing_cities := false
var min_pixels := "1"
var busy := false
var progress := {"fraction": 0.0, "message": ""}
var stats := {}
var ready_regions := 0
var status := ""
var _raster_image: Image
var _raster_texture: Texture2D
var _dynamic: VBoxContainer


func _init() -> void:
	super._init("🗺 Province Map Importer", "", 460.0, "left")


func setup(workshop: Workshop) -> void:
	host = workshop
	if not host.engine.engine_event.is_connected(_on_engine_event):
		host.engine.engine_event.connect(_on_engine_event)
	tree_exiting.connect(_on_exit)
	_render()


func _on_exit() -> void:
	if not is_instance_valid(host):
		return
	if host.engine and host.engine.engine_event.is_connected(_on_engine_event):
		host.engine.engine_event.disconnect(_on_engine_event)
	if host.map:
		host.map.clear_import_preview()
	if busy and mode == "raster":
		host.request_raw("workshop.import.cancel")


func _alive() -> bool:
	return is_instance_valid(self) and is_inside_tree() and is_instance_valid(host)


func _on_engine_event(name: String, data: Variant) -> void:
	if name != "workshop.import.progress" or not (data is Dictionary) or not busy:
		return
	var payload: Dictionary = data
	if str(payload.get("session", "")) != host.session:
		return
	progress = {"fraction": float(payload.get("fraction", 0.0)), "message": str(payload.get("message", ""))}
	_render_dynamic()


func _button(text: String, active := false) -> Button:
	var node := WorkshopUI.base_button(text)
	var bg := Color(0, 0, 0, 0.5) if active else Color(1, 1, 1, 0.06)
	var normal := UI.box(bg, Color(1, 1, 1, 0.09), 16, 1, Vector4(10, 7, 10, 7))
	var hover := UI.box(Color(bg.r, bg.g, bg.b, minf(1.0, bg.a + 0.06)), Color(1, 1, 1, 0.16), 16, 1, Vector4(10, 7, 10, 7))
	WorkshopUI._flat_styles(node, normal, hover, hover, normal)
	WorkshopUI._ink(node, Color(1, 1, 1), 12.0, 700)
	return node


func _caption(text: String, px := 11.5, weight := 800, ink := Color(1, 1, 1)) -> Label:
	var node := WorkshopUI.label(text, px, ink, weight)
	node.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return node


func _check(text: String, value: bool, on_change: Callable, bold := false, px := 11.5) -> CheckBox:
	var node := WorkshopUI.check(text, value, on_change, px)
	if bold:
		node.add_theme_font_override("font", UI.font(700))
	node.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return node


func _box(bg: Color, border: Color, radius := 9, margin := Vector4(10, 9, 10, 9), separation := 6) -> Array:
	return WorkshopUI.card(radius, bg, border, margin, separation)


func _rich(text: String, px := 11.5, ink := Color(1, 1, 1)) -> RichTextLabel:
	var node := RichTextLabel.new()
	node.bbcode_enabled = true
	node.fit_content = true
	node.scroll_active = false
	node.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	node.add_theme_font_override("normal_font", UI.font(400))
	node.add_theme_font_override("bold_font", UI.font(800))
	for key in ["normal_font_size", "bold_font_size", "mono_font_size"]:
		node.add_theme_font_size_override(key, WorkshopUI.font_size(px))
	node.add_theme_color_override("default_color", ink)
	node.add_theme_constant_override("line_separation", 3)
	node.text = text
	return node


func _escape(text: String) -> String:
	return text.replace("[", "[lb]")


func _count(value: Variant) -> String:
	return WorkshopUI.format_count(int(value))


func _number(value: Variant) -> float:
	var text := str(value).strip_edges()
	return text.to_float() if text.is_valid_float() else NAN


func _bounds_numbers() -> Dictionary:
	return {"west": _number(bounds["west"]), "east": _number(bounds["east"]), "north": _number(bounds["north"]), "south": _number(bounds["south"])}


func _bounds_valid() -> bool:
	var b := _bounds_numbers()
	for key in b:
		if is_nan(float(b[key])) or is_inf(float(b[key])):
			return false
	return float(b["east"]) > float(b["west"]) and float(b["north"]) > float(b["south"])


func _clear_result() -> void:
	stats = {}
	ready_regions = 0


func _sync_preview() -> void:
	if not is_instance_valid(host) or host.map == null:
		return
	if mode != "raster" or _raster_texture == null or not _bounds_valid() or not overlay_visible:
		host.map.clear_import_preview()
		return
	host.map.set_import_preview(_raster_texture, _bounds_numbers(), opacity)


func _file_row(caption: String, path: String, filters: PackedStringArray, on_pick: Callable, hint := "") -> VBoxContainer:
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 5)
	column.add_child(_caption(caption))
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 8)
	var choose := _button("Choose file…")
	choose.pressed.connect(func() -> void:
		var picked := await EditorKit.pick_file(self, false, "", filters)
		if picked.is_empty() or not _alive():
			return
		on_pick.call(picked))
	line.add_child(choose)
	var name_label := WorkshopUI.label(path.get_file() if not path.is_empty() else "No file chosen", 11.5, Color(1, 1, 1, 0.75) if not path.is_empty() else DIM, 400)
	name_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	name_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	name_label.clip_text = true
	name_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	line.add_child(name_label)
	column.add_child(line)
	if not hint.is_empty():
		column.add_child(WorkshopUI.wrap(hint, 11.5, DIM))
	return column


func _render() -> void:
	clear_body()
	body.add_theme_constant_override("separation", 12)
	var modes := HBoxContainer.new()
	modes.add_theme_constant_override("separation", 7)
	var raster := _button("Province raster", mode == "raster")
	raster.pressed.connect(func() -> void:
		mode = "raster"
		overlay_visible = true
		_clear_result()
		_render()
		_sync_preview())
	modes.add_child(raster)
	var geojson := _button("Region GeoJSON + metadata", mode == "geojson")
	geojson.pressed.connect(func() -> void:
		mode = "geojson"
		host.map.clear_import_preview()
		_clear_result()
		_render())
	modes.add_child(geojson)
	body.add_child(modes)
	if mode == "raster":
		_render_raster()
	else:
		_render_geojson()
	body.add_child(_check("Inherit current polity ownership by imported province centroid", inherit_owners, func(on: bool) -> void: inherit_owners = on, true))
	_dynamic = VBoxContainer.new()
	_dynamic.add_theme_constant_override("separation", 12)
	body.add_child(_dynamic)
	_render_dynamic()
	var safety := VBoxContainer.new()
	safety.add_theme_constant_override("separation", 8)
	safety.add_child(WorkshopUI.rule())
	safety.add_child(_rich("[b]Safety:[/b] Apply automatically downloads the current regions plus authored city markers as one mixed GeoJSON backup before replacement, and that backup can be re-imported from the GeoJSON tab. Whole-map import deliberately clears the in-memory region Undo stack instead of keeping two enormous worlds resident at once.", 10.8, DIM))
	body.add_child(safety)
	fit()


func _render_raster() -> void:
	body.add_child(_file_row("Province image", raster_file, PackedStringArray(["*.bmp, *.png, *.jpg, *.jpeg, *.webp ; Images"]), _choose_raster, "24/32-bit BMP is decoded directly. PNG/JPEG/WebP use the browser image decoder."))
	body.add_child(_file_row("Optional HOI4 definition.csv", definition_file, PackedStringArray(["*.csv ; CSV"]), func(path: String) -> void:
		definition_file = path
		_clear_result()
		_render(), "When supplied, province IDs/type/terrain metadata are preserved and “land only” can exclude sea/lake provinces."))
	var fit_box := VBoxContainer.new()
	fit_box.add_theme_constant_override("separation", 6)
	fit_box.add_child(_caption("Geographic fit"))
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 7)
	grid.add_theme_constant_override("v_separation", 7)
	for pair in [["west", "West longitude"], ["east", "East longitude"], ["north", "North latitude"], ["south", "South latitude"]]:
		var key: String = pair[0]
		var cell := VBoxContainer.new()
		cell.add_theme_constant_override("separation", 3)
		cell.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		cell.add_child(WorkshopUI.label(str(pair[1]), 10.5, Color(1, 1, 1, 0.58), 400))
		var input := WorkshopUI.input(str(bounds[key]), "", func(text: String) -> void: _set_bound(key, text), 12.0, 32.0)
		cell.add_child(input)
		grid.add_child(cell)
	fit_box.add_child(grid)
	var tools := HFlowContainer.new()
	tools.add_theme_constant_override("h_separation", 7)
	tools.add_theme_constant_override("v_separation", 7)
	var reset := _button("Reset whole-world fit")
	reset.pressed.connect(func() -> void:
		bounds = {"west": "-180", "east": "180", "north": str(WORLD["north"]), "south": str(WORLD["south"])}
		_clear_result()
		_render()
		_sync_preview())
	tools.add_child(reset)
	var opacity_line := HBoxContainer.new()
	opacity_line.add_theme_constant_override("separation", 6)
	var opacity_caption := WorkshopUI.label("overlay opacity", 10.5, Color(1, 1, 1, 0.58), 400)
	opacity_caption.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	opacity_line.add_child(opacity_caption)
	var slider := PoliticalKit.slider(opacity, 0.1, 0.9, 0.05)
	slider.custom_minimum_size.x = 130
	slider.value_changed.connect(func(value: float) -> void:
		opacity = value
		_sync_preview())
	opacity_line.add_child(slider)
	tools.add_child(opacity_line)
	fit_box.add_child(tools)
	fit_box.add_child(WorkshopUI.wrap("The image is read as an equirectangular map, its rows spaced evenly in latitude between the north and south bounds, and the overlay is drawn the same way. An image in Web Mercator or another projection will not line up.", 10.8, Color("#fbbf24")))
	body.add_child(fit_box)
	var checks := VBoxContainer.new()
	checks.add_theme_constant_override("separation", 7)
	var has_definition := not definition_file.is_empty()
	var land := _check("Import land provinces only " + ("" if has_definition else "(needs definition.csv)"), land_only, func(on: bool) -> void:
		land_only = on
		_clear_result()
		_render_dynamic())
	land.disabled = not has_definition
	checks.add_child(land)
	checks.add_child(_check("Ignore pure black pixels", ignore_black, func(on: bool) -> void:
		ignore_black = on
		_clear_result()
		_render_dynamic()))
	var minimum := HBoxContainer.new()
	minimum.add_theme_constant_override("separation", 6)
	var lead := WorkshopUI.label("Minimum connected component size", 11.5, Color(1, 1, 1, 0.86), 500)
	lead.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	minimum.add_child(lead)
	var pixels := WorkshopUI.input(min_pixels, "", func(text: String) -> void:
		min_pixels = text
		_clear_result()
		_render_dynamic(), 12.0, 30.0)
	pixels.custom_minimum_size.x = 80
	pixels.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	minimum.add_child(pixels)
	var tail := WorkshopUI.label("pixels", 11.5, Color(1, 1, 1, 0.86), 500)
	tail.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	minimum.add_child(tail)
	checks.add_child(minimum)
	body.add_child(checks)


func _render_geojson() -> void:
	body.add_child(_file_row("Region geometry GeoJSON", geojson_file, PackedStringArray(["*.geojson, *.json ; GeoJSON"]), func(path: String) -> void:
		geojson_file = path
		geo_join_key = "auto"
		geo_key_options = []
		_clear_result()
		status = ""
		_render()))
	body.add_child(_file_row("Optional separate region metadata JSON", metadata_file, PackedStringArray(["*.json, *.geojson ; JSON"]), func(path: String) -> void:
		metadata_file = path
		metadata_join_key = "auto"
		metadata_name_field = "auto"
		metadata_key_options = []
		metadata_field_options = []
		_clear_result()
		status = ""
		_render()))
	if not metadata_file.is_empty():
		var join := _box(Color(1, 1, 1, 0.1), Color(1, 1, 1, 0.1), 9, Vector4(10, 9, 10, 9), 7)
		var inner: VBoxContainer = join[1]
		inner.add_child(_caption("Metadata join"))
		var geo_options: Array = [["auto", "Auto-detect"]]
		for field in geo_key_options:
			geo_options.append([str(field), "Feature ID" if str(field) == "__featureId" else str(field)])
		inner.add_child(_select_field("Geometry key", geo_options, geo_join_key, func(value: String) -> void:
			geo_join_key = value
			_clear_result()
			_render()))
		var meta_options: Array = [["auto", "Auto-detect"]]
		for field in metadata_key_options:
			var text := str(field)
			meta_options.append([text, "JSON object key" if text == "__objectKey" else ("Feature ID" if text == "__featureId" else text)])
		inner.add_child(_select_field("Metadata key", meta_options, metadata_join_key, func(value: String) -> void:
			metadata_join_key = value
			_clear_result()
			_render()))
		var name_options: Array = [["auto", "Auto-detect name / region_name / NAME…"]]
		for field in metadata_field_options:
			name_options.append([str(field), str(field)])
		inner.add_child(_select_field("Region name field", name_options, metadata_name_field, func(value: String) -> void:
			metadata_name_field = value
			_clear_result()
			_render()))
		inner.add_child(_check("Merge all metadata fields into each region", merge_all_metadata, func(on: bool) -> void:
			merge_all_metadata = on
			_clear_result()
			_render(), false, 11.0))
		body.add_child(join[0])
	body.add_child(_check("Simplify outlines to about 100 m", simplify_outlines, func(on: bool) -> void: simplify_outlines = on, true))
	var flags := _box(Color(234 / 255.0, 179 / 255.0, 8 / 255.0, 0.06), Color(234 / 255.0, 179 / 255.0, 8 / 255.0, 0.18))
	(flags[1] as VBoxContainer).add_child(_check("Store recognized standard flags in this scenario", materialize_standard_flags, func(on: bool) -> void:
		materialize_standard_flags = on
		_clear_result()
		_render(), true, 11.2))
	body.add_child(flags[0])
	if int(stats.get("cityMarkers", 0)) > 0:
		var cities := _box(Color(1, 1, 1, 0.08), Color(1, 1, 1, 0.1))
		var inner: VBoxContainer = cities[1]
		inner.add_child(_caption("City markers detected: " + _count(stats["cityMarkers"])))
		inner.add_child(_check("Import explicit city Point markers", import_cities, func(on: bool) -> void:
			import_cities = on
			_render(), false, 11.0))
		var replace := _check("Replace existing city markers instead of merge/update", replace_existing_cities, func(on: bool) -> void: replace_existing_cities = on, false, 11.0)
		replace.disabled = not import_cities
		replace.modulate.a = 1.0 if import_cities else 0.5
		inner.add_child(replace)
		body.add_child(cities[0])


func _select_field(caption: String, options: Array, value: String, on_change: Callable) -> VBoxContainer:
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 3)
	column.add_child(WorkshopUI.label(caption, 10.7, Color(1, 1, 1, 0.65), 400))
	column.add_child(WorkshopUI.select(options, value, on_change, 12.0, 32.0))
	return column


func _set_bound(key: String, text: String) -> void:
	bounds[key] = text
	_clear_result()
	_render_dynamic()
	_sync_preview()


func _choose_raster(path: String) -> void:
	host.map.clear_import_preview()
	raster_file = path
	overlay_visible = true
	_clear_result()
	status = ""
	_raster_image = null
	_raster_texture = null
	var image := Image.new()
	if image.load(path) == OK and image.get_width() > 0 and image.get_height() > 0:
		_raster_image = image
		_raster_texture = ImageTexture.create_from_image(image)
	_render()
	_sync_preview()


func _render_dynamic() -> void:
	if _dynamic == null or not is_instance_valid(_dynamic):
		return
	WorkshopUI.clear(_dynamic)
	var actions := HFlowContainer.new()
	actions.add_theme_constant_override("h_separation", 8)
	actions.add_theme_constant_override("v_separation", 8)
	var analyze_text := "Working…" if busy else ("Vectorize / analyze" if mode == "raster" else ("Join metadata / analyze" if not metadata_file.is_empty() else "Analyze GeoJSON"))
	var analyze := _button(analyze_text)
	analyze.disabled = busy or (raster_file.is_empty() if mode == "raster" else geojson_file.is_empty())
	analyze.modulate.a = 0.6 if busy else 1.0
	analyze.pressed.connect(_analyze)
	actions.add_child(analyze)
	var apply := _button("Import / replace regions", true)
	apply.disabled = busy or ready_regions <= 0
	apply.modulate.a = 1.0 if ready_regions > 0 else 0.5
	apply.pressed.connect(_apply)
	actions.add_child(apply)
	if mode == "raster":
		var overlay := _button("Hide raster overlay" if overlay_visible else "Show raster overlay")
		overlay.pressed.connect(func() -> void:
			overlay_visible = not overlay_visible
			_render_dynamic()
			_sync_preview())
		actions.add_child(overlay)
	_dynamic.add_child(actions)
	var message := str(progress.get("message", ""))
	if busy or not message.is_empty():
		var meter := VBoxContainer.new()
		meter.add_theme_constant_override("separation", 5)
		var track := Panel.new()
		track.custom_minimum_size.y = 7
		track.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.08), Color(0, 0, 0, 0), 999, 0))
		var fill := Panel.new()
		fill.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.14), Color(0, 0, 0, 0), 999, 0))
		fill.anchor_bottom = 1.0
		fill.anchor_right = clampf(float(progress.get("fraction", 0.0)), 0.0, 1.0)
		track.add_child(fill)
		meter.add_child(track)
		meter.add_child(WorkshopUI.wrap(message, 11.0, Color(1, 1, 1, 0.62)))
		_dynamic.add_child(meter)
	if not stats.is_empty():
		_dynamic.add_child(_stats_box())
		if int(stats.get("metadataRows", 0)) > 0 and (int(stats.get("metadataUnmatchedGeometry", 0)) > 0 or int(stats.get("metadataUnused", 0)) > 0):
			var text := "Metadata join warning:"
			if int(stats.get("metadataUnmatchedGeometry", 0)) > 0:
				text += " %s geometry regions had no metadata match." % _count(stats["metadataUnmatchedGeometry"])
			if int(stats.get("metadataUnused", 0)) > 0:
				text += " %s metadata records were unused." % _count(stats["metadataUnused"])
			text += " Check the join keys before importing if those numbers are unexpected."
			_dynamic.add_child(_warning(_escape(text)))
		var orphans := int(stats.get("ownerColorsWithoutOwner", 0))
		if orphans > 0:
			_dynamic.add_child(_warning("Owner colour warning: %s region%s supplied [code]ownerColor[/code] without an [code]owner[/code], so no polity colour can be assigned from %s." % [_count(orphans), "" if orphans == 1 else "s", "it" if orphans == 1 else "them"]))
		var unnamed := int(stats.get("cityMarkersSkippedUnnamed", 0))
		var invalid := int(stats.get("cityMarkersSkippedInvalidCoordinates", 0))
		if unnamed > 0 or invalid > 0:
			var text := "City marker warning:"
			if unnamed > 0:
				text += " %s explicit city Point%s skipped because no name was present." % [_count(unnamed), " was" if unnamed == 1 else "s were"]
			if invalid > 0:
				text += " %s explicit city Point%s invalid coordinates." % [_count(invalid), " had" if invalid == 1 else "s had"]
			_dynamic.add_child(_warning(text))
	if not status.is_empty():
		var box := _box(GREEN_BG if status.contains("imported") else RED_BG, Color(1, 1, 1, 0.12), 8, Vector4(9, 8, 9, 8))
		(box[1] as VBoxContainer).add_child(WorkshopUI.wrap(status, 11.5, Color(1, 1, 1, 0.9)))
		_dynamic.add_child(box[0])
	fit()


func _warning(text: String) -> PanelContainer:
	var box := _box(AMBER_BG, AMBER_BORDER, 8, Vector4(9, 8, 9, 8))
	(box[1] as VBoxContainer).add_child(_rich(text, 11.0, AMBER_INK))
	return box[0]


func _stats_box() -> PanelContainer:
	var parts := "[b]Ready to import:[/b] %s regions" % _count(int(stats.get("regions", 0)) if int(stats.get("regions", 0)) > 0 else ready_regions)
	if int(stats.get("width", 0)) > 0:
		parts += " · raster %s×%s" % [_count(stats["width"]), _count(stats.get("height", 0))]
	if int(stats.get("definitionRows", 0)) > 0:
		parts += " · %s definition rows" % _count(stats["definitionRows"])
	if bool(stats.get("landOnly", false)):
		parts += " · land only"
	if int(stats.get("metadataRows", 0)) > 0:
		parts += " · metadata %s/%s matched" % [_count(stats.get("metadataMatched", 0)), _count(stats["metadataRows"])]
	if stats.get("namesImported") is float or stats.get("namesImported") is int:
		parts += " · %s names" % _count(stats["namesImported"])
	for pair in [["polityOwners", "owners"], ["polityColors", "polity colours"], ["embeddedPolities", "embedded polity records"], ["polityFlags", "scenario flags"], ["embeddedPolityFlags", "explicit GeoJSON flags"], ["polityFlagsPreserved", "existing flags preserved"], ["resolvedOwnerAliases", "owner aliases resolved"], ["cityMarkers", "city markers"]]:
		if int(stats.get(pair[0], 0)) > 0:
			parts += " · %s %s" % [_count(stats[pair[0]]), pair[1]]
	var geo_key := str(stats.get("geoJoinKey", "")) if stats.get("geoJoinKey") != null else ""
	var meta_key := str(stats.get("metadataJoinKey", "")) if stats.get("metadataJoinKey") != null else ""
	if not geo_key.is_empty() and not meta_key.is_empty():
		parts += " · join [b]%s[/b] ↔ [b]%s[/b]" % [_escape("Feature ID" if geo_key == "__featureId" else geo_key), _escape("JSON object key" if meta_key == "__objectKey" else meta_key)]
	var name_field := str(stats.get("metadataNameField", "")) if stats.get("metadataNameField") != null else ""
	if not name_field.is_empty():
		parts += " · name field [b]%s[/b]" % _escape(name_field)
	var box := _box(GREEN_BG, GREEN_BORDER)
	(box[1] as VBoxContainer).add_child(_rich(parts, 11.5))
	return box[0]


func _analyze() -> void:
	if busy:
		return
	busy = true
	status = ""
	_clear_result()
	progress = {"fraction": 0.01, "message": "Preparing import…"}
	_render_dynamic()
	var error := ""
	if mode == "geojson":
		error = await _analyze_geojson()
	else:
		error = await _analyze_raster()
	if not _alive():
		return
	if not error.is_empty():
		progress = {"fraction": 0.0, "message": ""}
		status = error
	busy = false
	_render()


func _analyze_geojson() -> String:
	if geojson_file.is_empty():
		return "Choose a GeoJSON file first."
	var reply := await host.request_raw("workshop.import.geojson", {
		"file": geojson_file,
		"metadataFile": metadata_file,
		"geoJoinKey": geo_join_key,
		"metadataJoinKey": metadata_join_key,
		"metadataNameField": metadata_name_field,
		"mergeAllMetadata": merge_all_metadata,
		"materializeStandardFlags": materialize_standard_flags,
	})
	if not _alive():
		return ""
	if not reply.get("ok", false):
		return str(reply.get("error", "The GeoJSON could not be analyzed."))
	var result: Dictionary = reply["result"]
	if result.get("geoKeyOptions") is Array:
		geo_key_options = result["geoKeyOptions"]
	if result.get("metadataKeyOptions") is Array:
		metadata_key_options = result["metadataKeyOptions"]
	if result.get("metadataFieldOptions") is Array:
		metadata_field_options = result["metadataFieldOptions"]
	if result.has("error"):
		return str(result["error"])
	stats = result.get("stats", {})
	ready_regions = int(result.get("regions", 0))
	progress = {"fraction": 1.0, "message": str(result.get("message", ""))}
	return ""


func _analyze_raster() -> String:
	if raster_file.is_empty():
		return "Choose a province raster first."
	if not _bounds_valid():
		return "The geographic bounds are invalid."
	progress = {"fraction": 0.01, "message": "Decoding raster…"}
	_render_dynamic()
	await get_tree().process_frame
	if not _alive():
		return ""
	if _raster_image == null:
		return "That file is not a readable image."
	var width := _raster_image.get_width()
	var height := _raster_image.get_height()
	if width * height > PIXEL_CAP:
		return "Raster is too large (%s pixels). Current safety cap is %s." % [_count(width * height), _count(PIXEL_CAP)]
	var raw_file := OS.get_temp_dir().path_join("oh-province-import-%d.rgba" % Time.get_ticks_usec())
	var out := FileAccess.open(raw_file, FileAccess.WRITE)
	if out == null:
		return "The raster could not be prepared: %s." % error_string(FileAccess.get_open_error())
	if _raster_image.get_format() == Image.FORMAT_RGBA8:
		out.store_buffer(_raster_image.get_data())
	else:
		var copy := _raster_image.duplicate() as Image
		copy.convert(Image.FORMAT_RGBA8)
		out.store_buffer(copy.get_data())
	out.close()
	var reply := await host.request_raw("workshop.import.raster", {
		"rawFile": raw_file,
		"width": width,
		"height": height,
		"definitionFile": definition_file,
		"landOnly": land_only,
		"ignoreBlack": ignore_black,
		"minPixels": min_pixels,
		"bounds": _bounds_numbers(),
	})
	if not _alive():
		return ""
	if not reply.get("ok", false):
		DirAccess.remove_absolute(raw_file)
		return str(reply.get("error", "Raster vectorization failed."))
	var result: Dictionary = reply["result"]
	if result.has("error"):
		return str(result["error"])
	stats = result.get("stats", {})
	ready_regions = int(result.get("regions", 0))
	return ""


func _apply() -> void:
	if ready_regions <= 0 or busy:
		return
	var count := ready_regions
	var city_count := int(stats.get("cityMarkers", 0)) if import_cities and mode == "geojson" else 0
	var text := "Replace the current region geometry with %s imported regions?" % _count(count)
	if city_count > 0:
		text += "\nAlso import %s city marker%s%s." % [_count(city_count), "" if city_count == 1 else "s", " (replacing existing city markers)" if replace_existing_cities else " (merging with existing city markers)"]
	text += "\n\nThe importer will automatically download a GeoJSON backup of the current regions and city markers first. This is intentionally NOT kept in the in-memory Undo stack because whole-map imports can be very large."
	if not await host.confirm(text) or not _alive():
		return
	busy = true
	status = ""
	progress = {"fraction": 0.1, "message": "Backing up current regions…"}
	_render_dynamic()
	var args := {"mode": mode, "inheritOwners": inherit_owners, "simplify": simplify_outlines, "importCities": import_cities, "replaceExistingCities": replace_existing_cities}
	var reply := await host.import_regions(args)
	if not _alive():
		return
	if reply.get("ok", false) and reply["result"] is Dictionary and (reply["result"] as Dictionary).has("backupFailed"):
		var reason := str((reply["result"] as Dictionary)["backupFailed"])
		var anyway := await host.confirm("The backup of the current map could not be saved (%s). Replace the map anyway, with no backup and no undo?" % reason)
		if not _alive():
			return
		if not anyway:
			progress = {"fraction": 0.0, "message": ""}
			status = "Nothing was replaced: the backup of the current map could not be saved."
			busy = false
			_render_dynamic()
			return
		args["skipBackup"] = true
		reply = await host.import_regions(args)
		if not _alive():
			return
	busy = false
	if not reply.get("ok", false):
		status = str(reply.get("error", "The map rejected the imported region collection."))
		_render_dynamic()
		return
	var result: Dictionary = reply["result"]
	var applied: Dictionary = result.get("applied", {}) if result.get("applied") is Dictionary else {}
	if applied.is_empty():
		status = str(result.get("error", "The map rejected the imported region collection."))
		_render_dynamic()
		return
	var polity: Dictionary = applied.get("polityImport", {}) if applied.get("polityImport") is Dictionary else {}
	var city: Dictionary = applied.get("cityImport", {}) if applied.get("cityImport") is Dictionary else {}
	var imported := int(applied.get("count", 0))
	progress = {"fraction": 1.0, "message": "Imported %s regions%s" % [_count(imported), (" and %s city markers" % _count(city["count"])) if int(city.get("count", 0)) > 0 else ""]}
	var line := "%s regions imported" % _count(imported)
	if int(applied.get("inheritedOwners", 0)) > 0:
		line += "; %s inherited existing polity ownership" % _count(applied["inheritedOwners"])
	if int(polity.get("count", 0)) > 0:
		line += "; %s polities resolved/registered" % _count(polity["count"])
	if int(polity.get("colors", 0)) > 0:
		line += "; %s polity colours imported" % _count(polity["colors"])
	if int(polity.get("flags", 0)) > 0:
		line += "; %s standard flags stored in scenario" % _count(polity["flags"])
	if int(city.get("count", 0)) > 0:
		line += "; %s city markers imported" % _count(city["count"])
	if int(city.get("updated", 0)) > 0:
		line += " (%s existing markers updated)" % _count(city["updated"])
	status = line + "."
	_render()
