class_name WorkshopFmg
extends PanelContainer

const WIDTH := 340.0
const SIZES := [["small", "Small (fast)", 4000], ["medium", "Medium", 10000], ["large", "Large (detailed)", 20000]]
const BLUE := Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.85)
const BLUE_BUSY := Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.35)
const BLUE_EDGE := Color(147 / 255.0, 197 / 255.0, 253 / 255.0, 0.5)
const LOG_INK := Color(180 / 255.0, 230 / 255.0, 190 / 255.0, 0.92)

var host: Workshop
var templates: Array = ["random"]
var max_cultures := 30
var busy := false
var log_lines: Array = []
var seed_text := ""
var template := "random"
var size_id := "medium"
var states := "12"
var cultures := "8"
var cities := ""
var use_provinces := true
var _template_used := "random"
var _button: Button
var _log_box: VBoxContainer
var _log_scroll: ScrollContainer
var _page: WebPanel
var embedded := false


func setup(workshop: Workshop, info: Dictionary) -> void:
	host = workshop
	if info.get("templates") is Array and not (info["templates"] as Array).is_empty():
		templates = info["templates"]
	max_cultures = int(info.get("maxCultures", 30))
	var style := UI.box(WorkshopUI.PANEL, Color(147 / 255.0, 197 / 255.0, 253 / 255.0, 0.35), 0, 0, Vector4(16, 16, 16, 12))
	style.border_width_left = 1
	add_theme_stylebox_override("panel", style)
	mouse_filter = Control.MOUSE_FILTER_STOP
	host.engine.engine_event.connect(_on_engine_event)
	tree_exiting.connect(func() -> void:
		if is_instance_valid(host) and host.engine.engine_event.is_connected(_on_engine_event):
			host.engine.engine_event.disconnect(_on_engine_event)
		_close_page()
		if busy and is_instance_valid(host):
			host.request_raw("workshop.fmg.stop"))
	_build()


func _label(text: String) -> Label:
	var node := WorkshopUI.label(text, 11.0, Color(1, 1, 1, 0.6), 400)
	node.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return node


func _field(caption: String, control: Control) -> VBoxContainer:
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 3)
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.add_child(_label(caption))
	column.add_child(control)
	return column


func _build() -> void:
	WorkshopUI.clear(self)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 12)
	add_child(column)
	column.add_child(WorkshopUI.label("Generate a world", 15.0, Color(1, 1, 1), 800))
	var intro := _label("Azgaar's Fantasy Map Generator builds the land, countries and cities; they import straight into your map as vector regions + a biome basemap.")
	column.add_child(intro)
	column.add_child(_field("Seed (blank = random)", WorkshopUI.input(seed_text, "e.g. 174920", func(text: String) -> void: seed_text = text, 13.6, 34.0)))
	var template_options: Array = []
	for entry in templates:
		template_options.append([str(entry), str(entry)])
	column.add_child(_field("Landmass template", WorkshopUI.select(template_options, template, func(value: String) -> void: template = value, 13.0, 34.0)))
	var size_options: Array = []
	for entry in SIZES:
		size_options.append([entry[0], entry[1]])
	column.add_child(_field("Detail", WorkshopUI.select(size_options, size_id, func(value: String) -> void: size_id = value, 13.0, 34.0)))
	var counts := HBoxContainer.new()
	counts.add_theme_constant_override("separation", 10)
	counts.add_child(_field("Countries", WorkshopUI.input(states, "", func(text: String) -> void: states = text, 13.6, 34.0)))
	counts.add_child(_field("Cultures", WorkshopUI.input(cultures, "", func(text: String) -> void: cultures = text, 13.6, 34.0)))
	column.add_child(counts)
	column.add_child(_field("Cities (blank = auto, scales with map size)", WorkshopUI.input(cities, "auto", func(text: String) -> void: cities = text, 13.6, 34.0)))
	column.add_child(WorkshopUI.check("Regions from provinces (finer than whole countries)", use_provinces, func(on: bool) -> void: use_provinces = on, 12.0))
	_button = WorkshopUI.base_button()
	_button.custom_minimum_size.y = 40
	_button.pressed.connect(_generate)
	column.add_child(_button)
	_log_scroll = ScrollContainer.new()
	_log_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_log_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_log_scroll.custom_minimum_size.y = 120
	var log_panel := PanelContainer.new()
	log_panel.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0.35), Color(1, 1, 1, 0.08), 8, 1, Vector4(10, 8, 10, 8)))
	log_panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	log_panel.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_log_box = VBoxContainer.new()
	_log_box.add_theme_constant_override("separation", 2)
	_log_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_log_scroll.add_child(_log_box)
	log_panel.add_child(_log_scroll)
	column.add_child(log_panel)
	_render_state()


func _render_state() -> void:
	if _button == null:
		return
	_button.text = "Generating…" if busy else "⚙ Generate & import"
	var style := UI.box(BLUE_BUSY if busy else BLUE, BLUE_EDGE, 16, 1, Vector4(14, 10, 14, 10))
	WorkshopUI._flat_styles(_button, style, style, style, style)
	WorkshopUI._ink(_button, Color(1, 1, 1), 14.0, 800)
	_button.add_theme_color_override("font_disabled_color", Color(1, 1, 1))
	_button.disabled = busy
	_button.modulate.a = 0.85 if busy else 1.0
	WorkshopUI.clear(_log_box)
	if log_lines.is_empty():
		_log_box.add_child(_mono("Console output appears here…", Color(1, 1, 1, 0.3)))
	for line in log_lines:
		_log_box.add_child(_mono(str(line), LOG_INK))
	_scroll_down.call_deferred()


func _mono(text: String, ink: Color) -> Label:
	var node := Label.new()
	node.text = text
	node.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var font := SystemFont.new()
	font.font_names = PackedStringArray(["Consolas", "Menlo", "monospace"])
	node.add_theme_font_override("font", font)
	node.add_theme_font_size_override("font_size", WorkshopUI.font_size(11.0))
	node.add_theme_color_override("font_color", ink)
	return node


func _scroll_down() -> void:
	if is_instance_valid(_log_scroll):
		_log_scroll.scroll_vertical = int(_log_scroll.get_v_scroll_bar().max_value)


func _log(line: String) -> void:
	log_lines.append(line)
	_render_state()


func _on_engine_event(name: String, data: Variant) -> void:
	if not busy or not (data is Dictionary) or not name.begins_with("workshop.fmg."):
		return
	var payload: Dictionary = data
	if str(payload.get("session", "")) != host.session:
		return
	match name:
		"workshop.fmg.log":
			_log(str(payload.get("line", "")))
		"workshop.fmg.world":
			_import()
		"workshop.fmg.failed":
			_finish("✗ %s" % str(payload.get("message", "")))


func _finish(line: String) -> void:
	busy = false
	_close_page()
	_log(line)


func _close_page() -> void:
	if _page and is_instance_valid(_page):
		_page.queue_free()
	_page = null


func _open_page(url: String) -> bool:
	if not WebPanel.is_available():
		return false
	_close_page()
	_page = WebPanel.new()
	_page.name = "GeneratorPage"
	_page.keep_hidden = true
	_page.top_level = true
	_page.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_page.position = Vector2.ZERO
	_page.size = Vector2(1920, 1080)
	_page.background = Color(19 / 255.0, 19 / 255.0, 21 / 255.0, 1)
	_page.allowed = "http://127.0.0.1:"
	_page.failed.connect(func(_reason: String) -> void:
		if busy and embedded:
			embedded = false
			_close_page()
			_log("The generator runs in your web browser; keep its tab open until the world arrives here.")
			host.open_url(url))
	add_child(_page)
	if not _page.open_url(url):
		_close_page()
		return false
	return true


func _generate() -> void:
	if busy:
		return
	busy = true
	log_lines = []
	_render_state()
	var points := 10000
	for entry in SIZES:
		if entry[0] == size_id:
			points = int(entry[2])
	var state_count := int(states.to_float()) if states.strip_edges().is_valid_float() else 0
	var culture_count := int(cultures.to_float()) if cultures.strip_edges().is_valid_float() else 0
	var city_count := roundi(cities.to_float()) if cities.strip_edges().is_valid_float() else 0
	_template_used = template
	var params := {
		"seed": seed_text.strip_edges(),
		"template": template,
		"points": points,
		"states": maxi(1, state_count if state_count != 0 else 12),
		"cultures": mini(max_cultures, maxi(1, culture_count if culture_count != 0 else 8)),
		"cities": maxi(0, city_count),
		"useProvinces": use_provinces,
	}
	var reply := await host.request_raw("workshop.fmg.start", {"params": params})
	if not is_instance_valid(self):
		return
	var result: Dictionary = reply["result"] if reply.get("ok", false) and reply["result"] is Dictionary else {"error": str(reply.get("error", ""))}
	if result.has("error"):
		_finish("✗ %s" % str(result["error"]))
		return
	var url := str(result.get("url", ""))
	embedded = _open_page(url)
	if embedded:
		return
	_log("The generator runs in your web browser; keep its tab open until the world arrives here.")
	host.open_url(url)


func _import() -> void:
	var result := await host.request("workshop.fmg.apply", {"useProvinces": use_provinces})
	if not is_instance_valid(self):
		return
	if result.is_empty() or result.has("error"):
		_finish("✗ %s" % str(result.get("error", "The generated world could not be imported.")))
		return
	var thumbnail := await WorkshopThumbnail.drawn(host, result.get("thumbnail"))
	var saved := await host.request_raw("workshop.fmg.saveBasemap", {"thumbnail": thumbnail, "template": _template_used})
	if not is_instance_valid(self):
		return
	if saved.get("ok", false) and saved["result"] is Dictionary and bool((saved["result"] as Dictionary).get("saved", false)):
		_log("Saved this basemap to “Your basemaps”.")
	var stats: Dictionary = result.get("stats", {}) if result.get("stats") is Dictionary else {}
	_finish("✓ Imported %d regions, %d countries, %d cities." % [int(stats.get("regions", 0)), int(stats.get("polities", 0)), int(stats.get("cities", 0))])
	host.fit_to_data()
