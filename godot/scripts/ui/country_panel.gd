class_name CountryPanel
extends PanelFrame

signal request_focus(bounds: Rect2)
signal show_event(event_id: String)
signal open_war_report(battlefield: String)
signal width_changed(width: float)

const MIN_WIDTH := 280.0
const DEFAULT_WIDTH := 320.0
const LEFT_CLEARANCE := 376.0
const FOOTER := "Click any country on the map to inspect it, or open its card and choose Stats."
const CARD_BG := Color(1, 1, 1, 0.05)
const CARD_BORDER := Color(1, 1, 1, 0.08)
const ROW_RULE := Color(1, 1, 1, 0.07)

var engine: EngineLink
var context: Dictionary = {}
var target := ""
var tab := "politics"
var data: Dictionary = {}
var sheet_status := "idle"
var sheet_error := ""
var sheet_waiting := false
var ranking: Dictionary = {}
var ranking_metric := ""
var ranking_all := false
var refresh_step := ""
var selected_party := ""
var hovered_party := ""
var institutions_all := false
var findings_all := false
var peace: Dictionary = {}
var tracking_search := ""
var chart_keys: Array = []
var chart_range := "all"
var _sequence := 0
var _sheet_call := 0
var _drawer_width := DEFAULT_WIDTH
var _handle_style: StyleBoxFlat
var _dragging := false
var _handle_hover := false
var _modal: Control
var _modal_kind := ""
var _donut: StatDonut
var _legend_rows: Array = []
var _tabs_fitted := true
var _sheet_target := ""
var _busy_timer: Timer
var _tracking_model: Dictionary = {}


func _init() -> void:
	super._init("Country", "Politics, diplomacy and national statistics", "drawer", DEFAULT_WIDTH)
	set_tint(Color(24 / 255.0, 24 / 255.0, 27 / 255.0, 0.95))
	_restyle_header()
	_build_handle()
	var margin := body.get_parent() as MarginContainer
	for side in [["margin_left", 16], ["margin_right", 16], ["margin_top", 14], ["margin_bottom", 20]]:
		margin.add_theme_constant_override(side[0], side[1])
	body.add_theme_constant_override("separation", 0)
	scroll.get_v_scroll_bar().modulate.a = 0.0
	_busy_timer = Timer.new()
	_busy_timer.wait_time = 0.8
	_busy_timer.timeout.connect(_poll_busy)
	add_child(_busy_timer)


func setup(link: EngineLink, setup_context: Dictionary = {}) -> void:
	engine = link
	context = setup_context
	if not engine.engine_event.is_connected(_on_engine_event):
		engine.engine_event.connect(_on_engine_event)
	var reply: Dictionary = await engine.request("country.width")
	if reply.get("ok", false):
		var saved: float = float((reply.get("result", {}) as Dictionary).get("width", 0))
		if saved > 0.0:
			set_drawer_width(saved)


func show_country(name := "") -> void:
	var asked := name.strip_edges()
	if asked != target or data.is_empty():
		_cancel_sheet()
		refresh_step = ""
		selected_party = ""
		hovered_party = ""
		peace.clear()
		institutions_all = false
		findings_all = false
		sheet_status = "idle"
		sheet_error = ""
	if not is_open():
		set_open(true)
	_busy_timer.start()
	await _load(asked)


func open() -> void:
	if not is_open():
		set_open(true)
	_busy_timer.start()
	var sequence := _sequence
	await get_tree().process_frame
	if sequence == _sequence and is_open():
		await _load(target)


func close() -> void:
	_close_modal()
	_busy_timer.stop()
	_sequence += 1
	set_open(false)


func refresh() -> void:
	if not is_open():
		return
	await _load(target)


func on_region_selected(owner: String) -> void:
	if not is_open() or owner.strip_edges().is_empty():
		return
	await show_country(owner.strip_edges())


func set_tab(next: String) -> void:
	if tab == next or not ["politics", "diplomacy", "economy", "ranking"].has(next):
		return
	tab = next
	refresh_step = ""
	ranking.clear()
	ranking_metric = ""
	ranking_all = false
	await _load(target)


func set_drawer_width(width: float) -> void:
	var viewport := get_viewport_rect().size.x if is_inside_tree() else 1440.0
	var most: float = max(viewport - LEFT_CLEARANCE, min(DEFAULT_WIDTH, viewport - 16.0))
	_drawer_width = round(clamp(width, min(MIN_WIDTH, most), most))
	set_meta("width", _drawer_width)
	if not data.is_empty() and not data.has("empty") and _tabs_fit(_tab_labels()) != _tabs_fitted:
		_render()
	if is_open():
		offset_left = -8.0 - _drawer_width
		offset_right = -8.0


func drawer_width() -> float:
	return _drawer_width


func current_width() -> float:
	return _drawer_width


func _restyle_header() -> void:
	var titles := header_title.get_parent() as VBoxContainer
	var row := titles.get_parent() as HBoxContainer
	var header := row.get_parent() as MarginContainer
	for side in [["margin_left", 12], ["margin_right", 12], ["margin_top", 12], ["margin_bottom", 12]]:
		header.add_theme_constant_override(side[0], side[1])
	header_title.add_theme_font_override("font", UI.font(800))
	header_title.add_theme_font_size_override("font_size", 14)
	header_title.add_theme_color_override("font_color", UI.WHITE)
	header_subtitle.add_theme_font_size_override("font_size", 10)
	header_subtitle.add_theme_color_override("font_color", Color(1, 1, 1, 0.38))
	var mark := UI.label("🏳", 16, UI.WHITE)
	mark.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(mark)
	row.move_child(mark, 0)
	var close_button := row.get_child(row.get_child_count() - 1) as Button
	if close_button:
		close_button.tooltip_text = "Close country panel"
		close_button.icon = UI.icon("close", 18, Color(1, 1, 1, 0.55))
	var rule := header.get_parent().get_child(1) as ColorRect
	if rule:
		rule.color = Color(1, 1, 1, 0.1)


func _build_handle() -> void:
	var overlay := Control.new()
	overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(overlay)
	var handle := Control.new()
	handle.anchor_bottom = 1.0
	handle.offset_right = 10.0
	handle.mouse_filter = Control.MOUSE_FILTER_STOP
	handle.mouse_default_cursor_shape = Control.CURSOR_HSIZE
	handle.tooltip_text = "Drag to resize"
	overlay.add_child(handle)
	var grip := Panel.new()
	_handle_style = UI.box(Color(1, 1, 1, 0.22), Color(0, 0, 0, 0), 2, 0)
	grip.add_theme_stylebox_override("panel", _handle_style)
	grip.anchor_top = 0.5
	grip.anchor_bottom = 0.5
	grip.offset_left = 3.5
	grip.offset_right = 6.5
	grip.offset_top = -21.0
	grip.offset_bottom = 21.0
	grip.mouse_filter = Control.MOUSE_FILTER_IGNORE
	handle.add_child(grip)
	handle.gui_input.connect(_on_handle_input)
	handle.mouse_entered.connect(_on_handle_hover.bind(true))
	handle.mouse_exited.connect(_on_handle_hover.bind(false))


func _on_handle_hover(inside: bool) -> void:
	_handle_hover = inside
	_paint_handle()


func _paint_handle() -> void:
	if _dragging:
		_handle_style.bg_color = Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.95)
	elif _handle_hover:
		_handle_style.bg_color = Color(1, 1, 1, 0.5)
	else:
		_handle_style.bg_color = Color(1, 1, 1, 0.22)


func _on_handle_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT:
		_dragging = (event as InputEventMouseButton).pressed
		_paint_handle()
		if not _dragging:
			width_changed.emit(_drawer_width)
			if engine:
				engine.request("country.width", {"width": _drawer_width})
	elif event is InputEventMouseMotion and _dragging:
		var before := _drawer_width
		set_drawer_width(get_viewport_rect().size.x - 8.0 - get_global_mouse_position().x)
		if not is_equal_approx(before, _drawer_width):
			width_changed.emit(_drawer_width)


func _input(event: InputEvent) -> void:
	if _modal and event is InputEventKey and (event as InputEventKey).pressed and (event as InputEventKey).keycode == KEY_ESCAPE:
		_close_modal()
		get_viewport().set_input_as_handled()


func _on_engine_event(name: String, payload: Variant) -> void:
	if name != "country.sheet_loading" or typeof(payload) != TYPE_DICTIONARY:
		return
	var info: Dictionary = payload
	if not is_open() or str(info.get("target", "")) != target or tab != "economy":
		return
	sheet_status = "loading"
	sheet_waiting = bool(info.get("waiting", false))
	_render()


func _cancel_sheet() -> void:
	if _sheet_call > 0 and engine:
		engine.cancel(_sheet_call)
	_sheet_call = 0
	_sheet_target = ""


func _load(asked: String) -> void:
	if not engine or not is_open():
		return
	_sequence += 1
	var sequence := _sequence
	var reply: Dictionary = await engine.request("country.view", {"target": asked, "tab": tab})
	if sequence != _sequence or not is_open():
		return
	if not reply.get("ok", false):
		data = {"empty": str(reply.get("error", "The country could not be read."))}
		_render()
		return
	data = reply.get("result", {})
	target = str(data.get("target", ""))
	_render()
	if target.is_empty():
		return
	if tab == "economy":
		await _load_sheet(false, false, true, sequence)
		if sequence == _sequence and is_open():
			_background("ensureIntelligenceRated", sequence)
	elif tab == "ranking":
		await _load_sheet(false, false, false, sequence)
		await _load_ranking(sequence)
	else:
		var status := await _load_sheet(false, false, false, sequence)
		if sequence == _sequence and is_open() and status != "generating":
			_background("ensureCountryAssessed", sequence)


func _load_sheet(force: bool, reassess: bool, generate: bool, sequence: int) -> String:
	if force or _sheet_target != target:
		_cancel_sheet()
	var call := engine.last_request_id() + 1
	_sheet_call = call
	_sheet_target = target
	var reply: Dictionary = await engine.request("country.sheet", {"target": target, "force": force, "forceReassess": reassess, "generate": generate})
	if _sheet_call == call:
		_sheet_call = 0
		_sheet_target = ""
	if sequence != _sequence or not is_open():
		return "stale"
	if not reply.get("ok", false):
		if tab == "economy":
			sheet_status = "error"
			sheet_error = str(reply.get("error", "The stat sheet failed."))
			_render()
		return "error"
	var result: Dictionary = reply.get("result", {})
	var status := str(result.get("status", "idle"))
	match status:
		"ready":
			sheet_status = "ready"
			sheet_error = ""
			var view: Dictionary = await engine.request("country.view", {"target": target, "tab": tab})
			if sequence != _sequence or not view.get("ok", false):
				return status
			data = view.get("result", {})
			_render()
		"error":
			sheet_status = "error"
			sheet_error = str(result.get("error", "The stat sheet failed."))
			_render()
		"definition-error":
			sheet_status = "idle"
			_render()
		"aborted", "generating":
			pass
		_:
			if sheet_status != "loading":
				sheet_status = "idle"
				_render()
	return status


func _background(fn: String, sequence: int) -> void:
	if not is_open():
		return
	var asked := target
	var reply: Dictionary = await engine.request("invoke", {"module": "gameplay", "fn": fn, "args": [asked, {"reason": "stats pane"}]})
	if sequence != _sequence or asked != target or not is_open():
		return
	if reply.get("ok", false):
		var view: Dictionary = await engine.request("country.view", {"target": target, "tab": tab})
		if sequence == _sequence and is_open() and view.get("ok", false):
			data = view.get("result", {})
			_render()


func _poll_busy() -> void:
	if not engine or not is_open() or tab != "economy" or data.is_empty() or data.has("empty"):
		return
	var reply: Dictionary = await engine.request("country.busy")
	if not reply.get("ok", false) or not is_open() or data.is_empty():
		return
	var busy := bool((reply.get("result", {}) as Dictionary).get("busy", false))
	if _modal_kind == "tracking" and not _tracking_model.is_empty() and busy != bool(_tracking_model.get("turnRunning", false)):
		_tracking_model["turnRunning"] = busy
		await _render_tracking(_tracking_model)
	if busy != bool(data.get("turnRunning", false)):
		data["turnRunning"] = busy
		if tab == "economy":
			_render()


func _load_ranking(sequence: int) -> void:
	var reply: Dictionary = await engine.request("country.ranking", {"target": target, "metricKey": ranking_metric, "showAll": ranking_all})
	if sequence != _sequence or not reply.get("ok", false):
		return
	ranking = reply.get("result", {})
	_render()


func _retarget(next: String) -> void:
	await show_country(next)


static func tone(hex: String, fallback := Color.WHITE) -> Color:
	return Color.html(hex) if Color.html_is_valid(hex) else fallback


static func texture_for(path: String, height := 32) -> Texture2D:
	if path.is_empty():
		return null
	if path.get_extension().to_lower() == "svg":
		return UI.flag(path, height)
	return ImageLoader.texture_from_file(path)


static func card(bg := CARD_BG, border := CARD_BORDER, radius := 10, margins := Vector4(11, 10, 11, 10)) -> PanelContainer:
	var holder := PanelContainer.new()
	holder.add_theme_stylebox_override("panel", UI.box(bg, border, radius, 1, margins))
	holder.mouse_filter = Control.MOUSE_FILTER_PASS
	holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return holder


static func column(separation := 0) -> VBoxContainer:
	var node := VBoxContainer.new()
	node.add_theme_constant_override("separation", separation)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.mouse_filter = Control.MOUSE_FILTER_PASS
	return node


static func row(separation := 0) -> HBoxContainer:
	var node := HBoxContainer.new()
	node.add_theme_constant_override("separation", separation)
	node.mouse_filter = Control.MOUSE_FILTER_PASS
	return node


static func flow(h := 4, v := 4) -> HFlowContainer:
	var node := HFlowContainer.new()
	node.add_theme_constant_override("h_separation", h)
	node.add_theme_constant_override("v_separation", v)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.mouse_filter = Control.MOUSE_FILTER_PASS
	return node


static func text(value: String, size: int, color: Color, weight := 400, wrap := true, spacing := 0) -> Label:
	var node := UI.label(value, size, color, weight, "Arial", spacing)
	if wrap:
		node.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		node.custom_minimum_size.x = 1
	return node


static func clipped(value: String, size: int, color: Color, weight := 400) -> Label:
	var node := UI.label(value, size, color, weight)
	node.clip_text = true
	node.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.custom_minimum_size.x = 1
	return node


static func gap(height: float) -> Control:
	var node := Control.new()
	node.custom_minimum_size.y = height
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return node


static func badge(value: String, ink: Color, size := 9, upper := true) -> PanelContainer:
	var holder := PanelContainer.new()
	holder.add_theme_stylebox_override("panel", UI.box(Color(ink.r, ink.g, ink.b, 0.12), Color(ink.r, ink.g, ink.b, 0.4), 999, 1, Vector4(6, 3, 6, 3)))
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	holder.size_flags_horizontal = Control.SIZE_SHRINK_END
	holder.add_child(UI.label(value.to_upper() if upper else value, size, ink, 800, "Arial", 1 if upper else 0))
	return holder


static func pill(value: String, bg: Color, border: Color, ink: Color, size := 10, weight := 600, pad := Vector4(6, 2, 6, 2)) -> PanelContainer:
	var holder := PanelContainer.new()
	holder.add_theme_stylebox_override("panel", UI.box(bg, border, 999, 1, pad))
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.add_child(UI.label(value, size, ink, weight))
	return holder


static func link(value: String, color: Color, size := 10, weight := 700) -> Button:
	var node := Button.new()
	node.text = value
	node.flat = true
	node.focus_mode = Control.FOCUS_NONE
	node.alignment = HORIZONTAL_ALIGNMENT_LEFT
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	node.add_theme_font_override("font", UI.font(weight))
	node.add_theme_font_size_override("font_size", size)
	for state in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		node.add_theme_color_override(state, color)
	node.add_theme_color_override("font_hover_color", color.lightened(0.2))
	for state in ["normal", "hover", "pressed", "focus", "disabled", "hover_pressed"]:
		node.add_theme_stylebox_override(state, StyleBoxEmpty.new())
	node.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	return node


static func small_button(value: String, bg: Color, border: Color, ink: Color, size := 12, weight := 700, pad := Vector4(11, 6, 11, 6), radius := 8) -> Button:
	var node := Button.new()
	node.text = value
	node.focus_mode = Control.FOCUS_NONE
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	node.add_theme_font_override("font", UI.font(weight))
	node.add_theme_font_size_override("font_size", size)
	for state in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		node.add_theme_color_override(state, ink)
	node.add_theme_color_override("font_disabled_color", Color(ink, ink.a * 0.5))
	var normal := UI.box(bg, border, radius, 1, pad)
	var hover := UI.box(Color(bg.r, bg.g, bg.b, min(1.0, bg.a + 0.06)), Color(border.r, border.g, border.b, min(1.0, border.a + 0.1)), radius, 1, pad)
	for state in [["normal", normal], ["focus", normal], ["disabled", normal], ["hover", hover], ["pressed", hover], ["hover_pressed", hover]]:
		node.add_theme_stylebox_override(state[0], state[1])
	node.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	return node


static func field(options: Array, selected: String) -> OptionButton:
	var node := OptionButton.new()
	node.focus_mode = Control.FOCUS_NONE
	node.fit_to_longest_item = false
	node.clip_text = true
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.custom_minimum_size = Vector2(1, 26)
	node.add_theme_font_size_override("font_size", 10)
	node.add_theme_color_override("font_color", Color8(231, 233, 234))
	var style := UI.box(Color(0, 0, 0, 0.35), Color(1, 1, 1, 0.16), 6, 1, Vector4(6, 3, 6, 3))
	for state in ["normal", "hover", "pressed", "focus"]:
		node.add_theme_stylebox_override(state, style)
	for option in options:
		var entry: Dictionary = option
		node.add_item(str(entry.get("label", "")))
		node.set_item_metadata(node.item_count - 1, str(entry.get("key", "")))
		if str(entry.get("key", "")) == selected:
			node.select(node.item_count - 1)
	return node


func _section(title: String, top := 17.6) -> Control:
	var holder := VBoxContainer.new()
	holder.add_theme_constant_override("separation", 0)
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.add_child(gap(top))
	holder.add_child(text(title.to_upper(), 11, Color(1, 1, 1, 0.45), 700, true, 1))
	holder.add_child(gap(9.6))
	return holder


func _render() -> void:
	var keep := scroll.scroll_vertical
	clear_body()
	_donut = null
	_legend_rows.clear()
	if data.is_empty():
		body.add_child(text("Loading…", 13, Color(1, 1, 1, 0.5)))
		return
	if data.has("empty"):
		body.add_child(text(str(data["empty"]), 13, Color(1, 1, 1, 0.5)))
		return
	_render_header()
	if refresh_step != "" and tab == "economy" and sheet_status != "loading":
		_render_refresh_menu()
	_render_tabs()
	match tab:
		"politics":
			_render_politics()
		"diplomacy":
			_render_diplomacy()
		"economy":
			_render_economy()
		"ranking":
			_render_ranking()
	body.add_child(gap(16))
	body.add_child(text(FOOTER, 11, Color(1, 1, 1, 0.35)))
	await get_tree().process_frame
	scroll.scroll_vertical = keep


func _render_header() -> void:
	var line := row(11)
	var frame := PanelContainer.new()
	frame.custom_minimum_size = Vector2(42, 42)
	frame.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	frame.clip_contents = true
	frame.add_theme_stylebox_override("panel", UI.box(Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.16), Color(1, 1, 1, 0.12), 10, 1))
	frame.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var flag := texture_for(str(data.get("flag", "")), 64)
	if flag:
		var picture := TextureRect.new()
		picture.texture = flag
		picture.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		picture.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
		picture.mouse_filter = Control.MOUSE_FILTER_IGNORE
		frame.add_child(picture)
	else:
		var initials := UI.label(str(data.get("initials", "??")), 15, Color("#93c5fd"), 800)
		initials.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		initials.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		frame.add_child(initials)
	line.add_child(frame)
	var info := column(0)
	var title_row := row(8)
	title_row.add_child(text(str(data.get("name", target)), 16, UI.WHITE, 800))
	if data.get("isPlayer", false):
		var mine := pill("Your country", Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.18), Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.5), Color("#fbbf24"), 10, 700, Vector4(8, 2, 8, 2))
		mine.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		title_row.add_child(mine)
	info.add_child(title_row)
	var header: Dictionary = data.get("header", {})
	if not str(header.get("place", "")).is_empty():
		info.add_child(gap(2))
		info.add_child(text(str(header["place"]), 12, Color(1, 1, 1, 0.7)))
	if not str(header.get("government", "")).is_empty():
		info.add_child(gap(2))
		info.add_child(text(str(header["government"]), 12, Color(1, 1, 1, 0.45)))
	if not str(header.get("leader", "")).is_empty():
		info.add_child(gap(2))
		info.add_child(text(str(header["leader"]), 12, Color("#fbbf24")))
	var tags: Array = header.get("tags", [])
	if not str(header.get("tier", "")).is_empty() or not tags.is_empty():
		info.add_child(gap(4))
		var chips := flow(4, 4)
		if not str(header.get("tier", "")).is_empty():
			chips.add_child(pill(str(header["tier"]), Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.16), Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.38), Color("#bfdbfe"), 10, 700))
		for tag in tags:
			chips.add_child(pill(str(tag), Color(1, 1, 1, 0.06), UI.HUD_BORDER, Color(1, 1, 1, 0.76), 10, 400))
		info.add_child(chips)
	line.add_child(info)
	if tab == "economy" and sheet_status != "loading":
		var again := link("↻", UI.ACCENT if refresh_step != "" else Color(1, 1, 1, 0.4), 16, 400)
		again.tooltip_text = "Refresh options"
		again.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
		again.pressed.connect(_toggle_refresh_menu)
		line.add_child(again)
	body.add_child(line)


func _toggle_refresh_menu() -> void:
	refresh_step = "" if refresh_step != "" else "open"
	_render()


func _menu_button(value: String, ink := Color("#e7e7e9"), border := Color(1, 1, 1, 0.14)) -> Button:
	return small_button(value, Color(1, 1, 1, 0.05), border, ink, 12, 750, Vector4(11, 6, 11, 6), 8)


func _render_refresh_menu() -> void:
	body.add_child(gap(11))
	var box := card()
	var stack := column(9)
	var first := column(4)
	var again := _menu_button("Refresh")
	again.pressed.connect(_refresh_sheet.bind(false))
	first.add_child(again)
	first.add_child(text(str(data.get("refreshHint", "")), 10, Color(1, 1, 1, 0.42)))
	stack.add_child(first)
	if not data.get("custom", false) and refresh_step == "open":
		var second := column(4)
		var rebuild := _menu_button("Rebuild baseline from scratch")
		rebuild.pressed.connect(func() -> void:
			refresh_step = "confirm"
			_render())
		second.add_child(rebuild)
		second.add_child(text("Uses 1 request and replaces the current numbers with a fresh assessment of the country as it stands now.", 10, Color(1, 1, 1, 0.42)))
		stack.add_child(second)
	if not data.get("custom", false) and refresh_step == "confirm":
		var third := column(7)
		third.add_child(text("Rebuild this country's baseline from scratch? It uses 1 request and replaces the current numbers.", 12, Color(1, 1, 1, 0.82)))
		var buttons := flow(7, 7)
		var sure := _menu_button("Rebuild baseline", Color("#fca5a5"), Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.45))
		sure.pressed.connect(_refresh_sheet.bind(true))
		buttons.add_child(sure)
		var cancel := _menu_button("Cancel")
		cancel.pressed.connect(func() -> void:
			refresh_step = "open"
			_render())
		buttons.add_child(cancel)
		third.add_child(buttons)
		stack.add_child(third)
	box.add_child(stack)
	body.add_child(box)


func _refresh_sheet(reassess: bool) -> void:
	refresh_step = ""
	sheet_status = "loading"
	sheet_waiting = false
	_render()
	await _load_sheet(true, reassess, true, _sequence)


func _render_tabs() -> void:
	body.add_child(gap(14))
	var strip := row(8)
	var labels := _tab_labels()
	var widest := _tab_widths(labels)
	var fits := _tabs_fit(labels)
	_tabs_fitted = fits
	for index in range(labels.size()):
		var entry: Array = labels[index]
		var key: String = entry[0]
		var chosen := key == tab
		var button := Button.new()
		button.text = entry[1]
		button.focus_mode = Control.FOCUS_NONE
		button.autowrap_mode = TextServer.AUTOWRAP_WORD
		button.clip_text = not fits
		button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		button.custom_minimum_size = Vector2(widest[index] if fits else 1.0, 39)
		button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		button.add_theme_font_override("font", UI.font(800))
		button.add_theme_font_size_override("font_size", 11)
		var ink := Color("#f4f4f5") if chosen else Color(1, 1, 1, 0.58)
		for state in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
			button.add_theme_color_override(state, ink)
		var style := UI.box(Color(0, 0, 0, 0.42) if chosen else Color(1, 1, 1, 0.03), Color(1, 1, 1, 0.28) if chosen else Color(1, 1, 1, 0.09), 8, 1, Vector4(4, 6, 4, 6))
		var hover := UI.box(Color(0, 0, 0, 0.42) if chosen else Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.28) if chosen else Color(1, 1, 1, 0.16), 8, 1, Vector4(4, 6, 4, 6))
		for state in [["normal", style], ["focus", style], ["disabled", style], ["hover", hover], ["pressed", hover], ["hover_pressed", hover]]:
			button.add_theme_stylebox_override(state[0], state[1])
		button.pressed.connect(set_tab.bind(key))
		strip.add_child(button)
	body.add_child(strip)


func _tab_labels() -> Array:
	return [["politics", "🏛 Politics"], ["diplomacy", "🤝 Diplomacy"], ["economy", str(data.get("economyTab", "📈 Economy"))], ["ranking", "🏆 Ranking"]]


func _tab_widths(labels: Array) -> Array[float]:
	var widths: Array[float] = []
	for entry in labels:
		var most := 0.0
		for word in str(entry[1]).split(" ", false):
			most = max(most, UI.font(800).get_string_size(word, HORIZONTAL_ALIGNMENT_LEFT, -1, 11).x)
		widths.append(ceil(most) + 12.0)
	return widths


func _tabs_fit(labels: Array) -> bool:
	var needed := 8.0 * (labels.size() - 1)
	for width in _tab_widths(labels):
		needed += width
	return needed <= _drawer_width - 32.0


func _politics_card(margins := Vector4(12, 11, 12, 11)) -> PanelContainer:
	return card(Color(1, 1, 1, 0.042), Color(1, 1, 1, 0.08), 12, margins)


func _label_small(value: String) -> Label:
	return text(value.to_upper(), 10, Color(1, 1, 1, 0.42), 800, true, 1)


func _render_politics() -> void:
	var politics: Dictionary = data.get("politics", {})
	body.add_child(gap(13))
	var government: Variant = politics.get("government")
	if typeof(government) == TYPE_DICTIONARY:
		var info: Dictionary = government
		var box := _politics_card()
		var stack := column(0)
		stack.add_child(_label_small("Government"))
		var form := str(info.get("form", ""))
		if not form.is_empty():
			stack.add_child(gap(5))
			stack.add_child(text(form, 12, Color(1, 1, 1, 0.78), 760))
		var heads := GridContainer.new()
		var head_of_government := str(info.get("headOfGovernment", ""))
		heads.columns = 2 if not head_of_government.is_empty() else 1
		heads.add_theme_constant_override("h_separation", 8)
		heads.add_theme_constant_override("v_separation", 8)
		heads.mouse_filter = Control.MOUSE_FILTER_IGNORE
		if not str(info.get("headOfState", "")).is_empty():
			var cell := column(3)
			cell.add_child(text("HEAD OF STATE", 9, Color(1, 1, 1, 0.34), 800, true, 1))
			cell.add_child(text(str(info["headOfState"]), 12, Color("#fbbf24"), 780))
			heads.add_child(cell)
		if not head_of_government.is_empty():
			var cell := column(3)
			cell.add_child(text("HEAD OF GOVERNMENT", 9, Color(1, 1, 1, 0.34), 800, true, 1))
			cell.add_child(text(head_of_government, 12, Color(1, 1, 1, 0.78), 760))
			heads.add_child(cell)
		if heads.get_child_count() > 0:
			stack.add_child(gap(11 if not form.is_empty() else 6))
			stack.add_child(heads)
		if not str(info.get("parties", "")).is_empty():
			stack.add_child(gap(10))
			var rule := ColorRect.new()
			rule.color = Color(1, 1, 1, 0.06)
			rule.custom_minimum_size.y = 1
			stack.add_child(rule)
			stack.add_child(gap(9))
			var line := RichTextLabel.new()
			line.bbcode_enabled = true
			line.fit_content = true
			line.scroll_active = false
			line.mouse_filter = Control.MOUSE_FILTER_IGNORE
			line.add_theme_font_override("normal_font", UI.font(400))
			line.add_theme_font_size_override("normal_font_size", 10)
			line.add_theme_color_override("default_color", Color(1, 1, 1, 0.48))
			line.text = "[color=#ffffff57]%s[/color] %s" % [str(info.get("partiesLabel", "")), _escape(str(info["parties"]))]
			stack.add_child(line)
		box.add_child(stack)
		body.add_child(box)
	var landscape: Variant = politics.get("landscape")
	if typeof(landscape) == TYPE_DICTIONARY:
		_render_landscape(landscape)
	var goals: Array = politics.get("goals", [])
	if not goals.is_empty():
		body.add_child(gap(11))
		var box := _politics_card()
		var stack := column(5)
		stack.add_child(_label_small("National priorities"))
		stack.add_child(gap(2))
		for goal in goals:
			stack.add_child(text("• %s" % str(goal), 11, Color(1, 1, 1, 0.65)))
		box.add_child(stack)
		body.add_child(box)
	var institutions: Array = politics.get("institutions", [])
	if not institutions.is_empty():
		_render_institutions(institutions)
	var intelligence: Variant = politics.get("intelligence")
	if typeof(intelligence) == TYPE_DICTIONARY:
		_render_intelligence(intelligence)
	var groups: Variant = data.get("groups")
	if typeof(groups) == TYPE_DICTIONARY:
		_render_groups(groups)


func _escape(value: String) -> String:
	return value.replace("[", "[lb]")


func _render_landscape(landscape: Dictionary) -> void:
	body.add_child(gap(11))
	var box := _politics_card()
	var stack := column(0)
	var top := row(7)
	var titles := column(2)
	titles.add_child(_label_small(str(landscape.get("title", ""))))
	titles.add_child(text(str(landscape.get("subtitle", "")), 9, Color(1, 1, 1, 0.34)))
	top.add_child(titles)
	var values := column(2)
	values.size_flags_horizontal = Control.SIZE_SHRINK_END
	var mapped := UI.label(str(landscape.get("valueText", "")), 9, Color(1, 1, 1, 0.36), 750)
	mapped.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	values.add_child(mapped)
	if landscape.get("approximate", false):
		var rough := UI.label("APPROXIMATE", 9, Color(253 / 255.0, 230 / 255.0, 138 / 255.0, 0.68), 800, "Arial", 1)
		rough.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		values.add_child(rough)
	top.add_child(values)
	stack.add_child(top)
	var entries: Array = landscape.get("entries", [])
	var slices: Array = landscape.get("slices", [])
	if not slices.is_empty():
		var holder := CenterContainer.new()
		holder.custom_minimum_size.y = 178
		holder.mouse_filter = Control.MOUSE_FILTER_PASS
		_donut = StatDonut.new()
		_donut.slices = slices
		_donut.selected = selected_party
		_donut.hovered = hovered_party
		_donut.center_label = str(landscape.get("centerLabel", "Political"))
		_donut.center_sub = str(landscape.get("centerSubLabel", "landscape"))
		_donut.picked.connect(_pick_party)
		_donut.hovering.connect(_hover_party)
		holder.add_child(_donut)
		stack.add_child(holder)
	var legend := GridContainer.new()
	legend.columns = 2
	legend.add_theme_constant_override("h_separation", 7)
	legend.add_theme_constant_override("v_separation", 5)
	legend.mouse_filter = Control.MOUSE_FILTER_PASS
	for item in entries:
		var party: Dictionary = item
		var chosen := str(party.get("id", "")) == selected_party
		var cell := StatClickable.new(UI.box(Color(1, 1, 1, 0.07) if chosen else Color(0, 0, 0, 0), Color(1, 1, 1, 0.1) if chosen else Color(0, 0, 0, 0), 7, 1, Vector4(6, 5, 6, 5)), UI.box(Color(1, 1, 1, 0.07), Color(1, 1, 1, 0.1), 7, 1, Vector4(6, 5, 6, 5)))
		cell.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var line := row(6)
		var dot := StatDot.new()
		dot.color = tone(str(party.get("color", "")))
		dot.custom_minimum_size = Vector2(8, 8)
		dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		line.add_child(dot)
		line.add_child(clipped(str(party.get("shortName", party.get("name", ""))), 10, Color(1, 1, 1, 0.66)))
		line.add_child(UI.label(str(party.get("valueText", "")), 10, Color(1, 1, 1, 0.43), 800))
		cell.add_child(line)
		cell.clicked.connect(_pick_party.bind(str(party.get("id", ""))))
		cell.mouse_entered.connect(_hover_party.bind(str(party.get("id", ""))))
		cell.mouse_exited.connect(_hover_party.bind(""))
		legend.add_child(cell)
	stack.add_child(legend)
	if not str(landscape.get("governmentNames", "")).is_empty():
		stack.add_child(gap(10))
		var amber := card(Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.07), Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.16), 9, Vector4(9, 8, 9, 8))
		var inner := column(4)
		inner.add_child(text(str(landscape.get("governmentLabel", "")).to_upper(), 9, Color(253 / 255.0, 230 / 255.0, 138 / 255.0, 0.62), 850, true, 1))
		inner.add_child(text(str(landscape["governmentNames"]), 10, Color("#fde68a"), 800))
		amber.add_child(inner)
		stack.add_child(amber)
	for item in entries:
		var party: Dictionary = item
		if str(party.get("id", "")) == selected_party and not selected_party.is_empty():
			stack.add_child(gap(11))
			stack.add_child(_party_detail(party, str(landscape.get("mode", "party")) == "party"))
	box.add_child(stack)
	body.add_child(box)


func _pick_party(id: String) -> void:
	selected_party = "" if selected_party == id else id
	_render()


func _hover_party(id: String) -> void:
	hovered_party = id
	if _donut:
		_donut.hovered = id
		_donut.queue_redraw()


func _detail_list(title: String, values: Array) -> Control:
	var stack := column(4)
	if values.is_empty():
		return stack
	stack.add_child(gap(6))
	stack.add_child(text(title.to_upper(), 9, Color(1, 1, 1, 0.42), 800, true, 1))
	for value in values:
		stack.add_child(text("• %s" % str(value), 11, Color(1, 1, 1, 0.68)))
	return stack


func _party_detail(party: Dictionary, as_party: bool) -> Control:
	var box := _politics_card(Vector4(13, 12, 13, 12))
	var stack := column(0)
	var top := row(8)
	var heading := column(2)
	var close := link("×", Color(1, 1, 1, 0.42), 14, 400)
	close.tooltip_text = "Close party details" if as_party else "Close power bloc details"
	close.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	close.pressed.connect(_pick_party.bind(selected_party))
	if as_party and party.get("isOther", false):
		heading.add_child(text("Other political support", 12, Color(1, 1, 1, 0.92), 850))
		heading.add_child(text("%s combined" % str(party.get("supportText", "—")), 10, Color(1, 1, 1, 0.44)))
		top.add_child(heading)
		top.add_child(close)
		stack.add_child(top)
		var members: Array = party.get("members", [])
		if not members.is_empty():
			stack.add_child(gap(10))
			for item in members:
				var member: Dictionary = item
				var line := row(7)
				line.add_child(text(str(member.get("name", "")), 11, Color(1, 1, 1, 0.7)))
				line.add_child(UI.label(str(member.get("support", "")), 10, Color(1, 1, 1, 0.48), 800))
				stack.add_child(line)
		if not str(party.get("unlistedText", "")).is_empty():
			stack.add_child(gap(9))
			stack.add_child(text(str(party["unlistedText"]), 10, Color(1, 1, 1, 0.4)))
		box.add_child(stack)
		return box
	var name_line := flow(5, 4)
	name_line.add_child(UI.label(str(party.get("name", "")), 13, Color(1, 1, 1, 0.95), 850))
	if as_party:
		if party.get("ruling", false):
			name_line.add_child(pill("Government", Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.14), Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.32), Color("#fde68a"), 9, 750))
		elif party.get("coalition", false):
			name_line.add_child(pill("Coalition", Color(1, 1, 1, 0.06), UI.HUD_BORDER, Color(1, 1, 1, 0.72), 9, 750))
	else:
		if not str(party.get("kind", "")).is_empty():
			name_line.add_child(pill(str(party["kind"]), Color(1, 1, 1, 0.06), UI.HUD_BORDER, Color(1, 1, 1, 0.72), 9, 750))
		if not str(party.get("status", "")).is_empty():
			name_line.add_child(pill(str(party["status"]), Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.12), Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.25), Color("#fde68a"), 9, 750))
	heading.add_child(name_line)
	var support := ""
	var approximate := false
	if as_party:
		support = "%s support" % str(party.get("supportText", "—"))
		approximate = party.get("supportApproximate", false)
	else:
		var shown := str(party.get("displayValue", ""))
		support = "%s influence" % shown if not shown.is_empty() else "Influence not quantified"
		approximate = party.get("influenceApproximate", false)
	var support_line := row(6)
	support_line.add_child(UI.label(support, 11, Color(1, 1, 1, 0.5), 800))
	if approximate:
		support_line.add_child(UI.label("APPROXIMATE", 9, Color(253 / 255.0, 230 / 255.0, 138 / 255.0, 0.62), 700))
	heading.add_child(support_line)
	top.add_child(heading)
	top.add_child(close)
	stack.add_child(top)
	if not str(party.get("publicDescription", "")).is_empty():
		stack.add_child(gap(9))
		stack.add_child(text(str(party["publicDescription"]), 11, Color(1, 1, 1, 0.62)))
	if not str(party.get("leader", "")).is_empty():
		stack.add_child(gap(9))
		var lead := row(4)
		var tag := UI.label("Party leader" if as_party else "Leading figure", 10, Color(1, 1, 1, 0.38), 750)
		tag.custom_minimum_size.x = 90
		lead.add_child(tag)
		lead.add_child(text(str(party["leader"]), 11, Color(1, 1, 1, 0.76), 700))
		stack.add_child(lead)
	var ideology: Array = party.get("ideology", [])
	if not ideology.is_empty():
		stack.add_child(gap(9))
		var chips := flow(4, 4)
		for item in ideology:
			chips.add_child(pill(str(item), Color(1, 1, 1, 0.06), UI.HUD_BORDER, Color(1, 1, 1, 0.72), 9, 750))
		stack.add_child(chips)
	stack.add_child(_detail_list("Public priorities", party.get("priorities", [])))
	stack.add_child(_detail_list("Foreign-policy outlook", party.get("foreignPolicy", [])))
	var described: bool = not str(party.get("leader", "")).is_empty() or not ideology.is_empty() or not str(party.get("publicDescription", "")).is_empty() or not (party.get("priorities", []) as Array).is_empty() or not (party.get("foreignPolicy", []) as Array).is_empty()
	if not as_party:
		described = described or not str(party.get("kind", "")).is_empty() or not str(party.get("status", "")).is_empty()
	if not described:
		stack.add_child(gap(9))
		stack.add_child(text("No additional public party information is currently available." if as_party else "No additional public information about this power bloc is currently available.", 10, Color(1, 1, 1, 0.38)))
	box.add_child(stack)
	return box


func _render_institutions(institutions: Array) -> void:
	body.add_child(gap(11))
	var box := _politics_card()
	var stack := column(0)
	var top := row(7)
	var titles := column(2)
	titles.add_child(_label_small("Institutions"))
	titles.add_child(text("Canonical memberships and institutional history", 9, Color(1, 1, 1, 0.34)))
	top.add_child(titles)
	var count := pill(str(institutions.size()), Color(1, 1, 1, 0.06), UI.HUD_BORDER, Color(1, 1, 1, 0.72), 9, 750)
	count.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	top.add_child(count)
	stack.add_child(top)
	stack.add_child(gap(9))
	var shown := institutions if institutions_all else institutions.slice(0, 10)
	var list := column(7)
	for item in shown:
		var entry: Dictionary = item
		var cell := card(Color(1, 1, 1, 0.025), Color(1, 1, 1, 0.065), 9, Vector4(9, 8, 9, 8))
		var inner := column(3)
		var line := row(7)
		line.add_child(text(str(entry.get("name", "")), 11, Color(1, 1, 1, 0.88), 820))
		var member: bool = entry.get("member", false)
		line.add_child(pill(str(entry.get("label", "")), Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.1) if member else Color(148 / 255.0, 163 / 255.0, 184 / 255.0, 0.09), Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.23) if member else Color(148 / 255.0, 163 / 255.0, 184 / 255.0, 0.18), Color("#86efac") if member else Color(1, 1, 1, 0.55), 9, 750))
		inner.add_child(line)
		inner.add_child(text(str(entry.get("detail", "")), 9, Color(1, 1, 1, 0.36)))
		for pending in entry.get("pending", []):
			inner.add_child(text(str(pending), 9, Color(1, 1, 1, 0.5)))
		cell.add_child(inner)
		list.add_child(cell)
	if institutions.size() > 10:
		var more := link("Show fewer" if institutions_all else "Show all (%d)" % institutions.size(), Color(1, 1, 1, 0.55), 10, 760)
		more.pressed.connect(func() -> void:
			institutions_all = not institutions_all
			_render())
		list.add_child(more)
	stack.add_child(list)
	box.add_child(stack)
	body.add_child(box)


func _render_intelligence(intelligence: Dictionary) -> void:
	body.add_child(gap(11))
	var box := card(Color(1, 1, 1, 0.025), UI.HUD_BORDER, 12, Vector4(12, 11, 12, 11))
	var stack := column(0)
	var top := row(6)
	top.add_child(text("🕵 INTELLIGENCE ASSESSMENT", 10, Color(1, 1, 1, 0.72), 800, true, 1))
	if not str(intelligence.get("confidence", "")).is_empty():
		top.add_child(pill("%s confidence" % str(intelligence["confidence"]), Color(1, 1, 1, 0.06), UI.HUD_BORDER, Color(1, 1, 1, 0.72), 9, 750))
	stack.add_child(top)
	if not str(intelligence.get("summary", "")).is_empty():
		stack.add_child(gap(8))
		stack.add_child(text(str(intelligence["summary"]), 11, Color(1, 1, 1, 0.72)))
	var findings: Array = intelligence.get("findings", [])
	if not findings.is_empty():
		stack.add_child(gap(9))
		var list := column(7)
		for item in (findings if findings_all else findings.slice(0, 4)):
			var finding: Dictionary = item
			var line := row(8)
			var rule := ColorRect.new()
			rule.color = Color(1, 1, 1, 0.22)
			rule.custom_minimum_size.x = 2
			line.add_child(rule)
			var words := column(2)
			if not str(finding.get("topic", "")).is_empty():
				words.add_child(text(str(finding["topic"]), 9, Color(1, 1, 1, 0.5), 800))
			words.add_child(text(str(finding.get("text", "")), 10, Color(1, 1, 1, 0.6)))
			line.add_child(words)
			list.add_child(line)
		if findings.size() > 4:
			var more := link("Show fewer" if findings_all else "Show all findings (%d)" % findings.size(), Color(1, 1, 1, 0.55), 10, 760)
			more.pressed.connect(func() -> void:
				findings_all = not findings_all
				_render())
			list.add_child(more)
		stack.add_child(list)
	if not str(intelligence.get("footer", "")).is_empty():
		stack.add_child(gap(9))
		stack.add_child(text(str(intelligence["footer"]), 9, Color("#fbbf24") if intelligence.get("stale", false) else Color(1, 1, 1, 0.34)))
	box.add_child(stack)
	body.add_child(box)


func _render_groups(groups: Dictionary) -> void:
	body.add_child(_section(str(groups.get("title", ""))))
	var box := card(CARD_BG, CARD_BORDER, 10, Vector4.ZERO)
	var stack := column(0)
	var first := true
	for item in groups.get("rows", []):
		var group: Dictionary = item
		if not first:
			stack.add_child(_rule())
		first = false
		var bounds: Variant = group.get("bounds")
		var has_bounds := typeof(bounds) == TYPE_ARRAY and (bounds as Array).size() == 4
		var cell := StatClickable.new(UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 0, Vector4(10, 9, 10, 9)), UI.box(Color(1, 1, 1, 0.04), Color(0, 0, 0, 0), 0, 0, Vector4(10, 9, 10, 9)))
		cell.enabled = has_bounds
		if has_bounds:
			cell.tooltip_text = "Show on the map"
			var box_bounds: Array = bounds
			cell.clicked.connect(func() -> void:
				request_focus.emit(Rect2(float(box_bounds[0]), float(box_bounds[1]), float(box_bounds[2]) - float(box_bounds[0]), float(box_bounds[3]) - float(box_bounds[1]))))
		else:
			cell.mouse_default_cursor_shape = Control.CURSOR_ARROW
		var line := row(9)
		var swatch := StatDot.new()
		swatch.square = true
		swatch.color = tone(str(group.get("color", "")))
		swatch.custom_minimum_size = Vector2(10, 10)
		swatch.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
		line.add_child(swatch)
		var words := column(2)
		words.add_child(clipped(str(group.get("name", "")), 12, Color(1, 1, 1, 0.88), 750))
		words.add_child(text(str(group.get("held", "")), 10, Color(1, 1, 1, 0.45)))
		if not str(group.get("description", "")).is_empty():
			var about := text(str(group["description"]), 10, Color(1, 1, 1, 0.38))
			about.max_lines_visible = 2
			about.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
			words.add_child(about)
		line.add_child(words)
		if group.get("ours", false):
			line.add_child(badge("Our group", UI.ACCENT))
		cell.add_child(line)
		stack.add_child(cell)
	box.add_child(stack)
	body.add_child(box)


func _rule() -> ColorRect:
	var rule := ColorRect.new()
	rule.color = ROW_RULE
	rule.custom_minimum_size.y = 1
	rule.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return rule


func _list_card(title: String, right := "") -> Array:
	var box := card(CARD_BG, CARD_BORDER, 10, Vector4.ZERO)
	var stack := column(0)
	var top := MarginContainer.new()
	for side in [["margin_left", 10], ["margin_right", 10], ["margin_top", 9], ["margin_bottom", 9]]:
		top.add_theme_constant_override(side[0], side[1])
	var line := row(6)
	line.add_child(text(title, 12, Color(1, 1, 1, 0.7), 800))
	if not right.is_empty():
		line.add_child(UI.label(right, 10, Color(1, 1, 1, 0.32)))
	top.add_child(line)
	stack.add_child(top)
	box.add_child(stack)
	return [box, stack]


func _list_row(stack: VBoxContainer) -> VBoxContainer:
	stack.add_child(_rule())
	var holder := MarginContainer.new()
	for side in [["margin_left", 10], ["margin_right", 10], ["margin_top", 9], ["margin_bottom", 9]]:
		holder.add_theme_constant_override(side[0], side[1])
	holder.mouse_filter = Control.MOUSE_FILTER_PASS
	var inner := column(0)
	holder.add_child(inner)
	stack.add_child(holder)
	return inner


func _empty_row(stack: VBoxContainer, value: String) -> void:
	var inner := _list_row(stack)
	inner.add_child(text(value, 11, Color(1, 1, 1, 0.4)))


func _render_diplomacy() -> void:
	var diplomacy: Variant = data.get("diplomacy")
	if typeof(diplomacy) != TYPE_DICTIONARY:
		body.add_child(gap(16))
		body.add_child(text("Loading diplomatic state…", 12, Color(1, 1, 1, 0.42)))
		return
	var info: Dictionary = diplomacy
	body.add_child(_section("🤝 Diplomacy"))
	var metrics := GridContainer.new()
	metrics.columns = 3
	metrics.add_theme_constant_override("h_separation", 7)
	metrics.add_theme_constant_override("v_separation", 7)
	for item in info.get("metrics", []):
		var metric: Dictionary = item
		var cell := card(CARD_BG, CARD_BORDER, 10, Vector4(10, 9, 10, 9))
		var inner := column(3)
		inner.add_child(text(str(metric.get("label", "")), 9, Color(1, 1, 1, 0.4), 800))
		inner.add_child(UI.label(str(metric.get("value", "")), 16, tone(str(metric.get("tone", ""))), 900))
		cell.add_child(inner)
		metrics.add_child(cell)
	body.add_child(metrics)
	var subordination: Variant = info.get("subordination")
	if typeof(subordination) == TYPE_DICTIONARY:
		var sub: Dictionary = subordination
		body.add_child(gap(9))
		var box := card(CARD_BG, CARD_BORDER, 10, Vector4(10, 10, 10, 10))
		var stack := column(0)
		stack.add_child(text("SUBORDINATION", 9, Color(1, 1, 1, 0.48), 850, true, 1))
		stack.add_child(gap(4))
		stack.add_child(text(str(sub.get("headline", "")), 12, Color(1, 1, 1, 0.9), 850))
		stack.add_child(gap(4))
		stack.add_child(text(str(sub.get("meaning", "")), 11, Color(1, 1, 1, 0.58)))
		var facts: Array = sub.get("facts", [])
		if not facts.is_empty():
			stack.add_child(gap(7))
			var chips := flow(4, 4)
			for fact in facts:
				chips.add_child(pill(str(fact), Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.1), Color(1, 1, 1, 0.68), 9, 400))
			stack.add_child(chips)
		if not str(sub.get("provenance", "")).is_empty():
			stack.add_child(gap(6))
			stack.add_child(text(str(sub["provenance"]), 9, Color(1, 1, 1, 0.36)))
		box.add_child(stack)
		body.add_child(box)
	var subordinates: Array = info.get("subordinates", [])
	if not subordinates.is_empty():
		body.add_child(gap(9))
		var parts := _list_card("Subordinate states")
		for item in subordinates:
			var entry: Dictionary = item
			var inner := _list_row(parts[1])
			var line := row(9)
			var words := column(2)
			words.add_child(clipped(str(entry.get("name", "")), 12, Color(1, 1, 1, 0.86), 750))
			if not str(entry.get("facts", "")).is_empty():
				words.add_child(text(str(entry["facts"]), 10, Color(1, 1, 1, 0.38)))
			line.add_child(words)
			line.add_child(badge(str(entry.get("badge", "")), tone(str(entry.get("tone", "")))))
			inner.add_child(line)
		body.add_child(parts[0])
	body.add_child(gap(9))
	var relations := _list_card("Bilateral relations", "−100 to +100")
	var relation_rows: Array = info.get("relations", [])
	if relation_rows.is_empty():
		_empty_row(relations[1], "No tracked bilateral relations. An absent record is not the same as explicit neutrality.")
	for item in relation_rows:
		var relation: Dictionary = item
		var inner := _list_row(relations[1])
		var line := row(10)
		var words := column(2)
		words.add_child(clipped(str(relation.get("name", "")), 12, Color(1, 1, 1, 0.88), 750))
		words.add_child(text(str(relation.get("summary", "")), 10, Color(1, 1, 1, 0.38)))
		line.add_child(words)
		var side := column(3)
		side.size_flags_horizontal = Control.SIZE_SHRINK_END
		var color := tone(str(relation.get("tone", "")))
		var score := UI.label(str(relation.get("score", "")), 14, color, 900)
		score.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		side.add_child(score)
		side.add_child(badge(str(relation.get("status", "")), color))
		line.add_child(side)
		inner.add_child(line)
		inner.add_child(gap(6))
		var meter := StatMeter.new()
		meter.value = float(relation.get("scoreValue", 0))
		meter.color = color
		meter.custom_minimum_size.y = 5
		inner.add_child(meter)
	body.add_child(relations[0])
	body.add_child(gap(9))
	var agreements := _list_card("Formal agreements")
	var agreement_rows: Array = info.get("agreements", [])
	if agreement_rows.is_empty():
		_empty_row(agreements[1], "No canonical formal agreements involving this polity.")
	for item in agreement_rows:
		var agreement: Dictionary = item
		var inner := _list_row(agreements[1])
		var line := row(9)
		var words := column(2)
		words.add_child(text(str(agreement.get("title", "")), 12, Color(1, 1, 1, 0.86), 750))
		words.add_child(text(str(agreement.get("detail", "")), 10, Color(1, 1, 1, 0.38)))
		if not str(agreement.get("updated", "")).is_empty():
			words.add_child(text(str(agreement["updated"]), 9, Color(1, 1, 1, 0.28)))
		line.add_child(words)
		line.add_child(badge(str(agreement.get("status", "")), tone(str(agreement.get("tone", "")))))
		inner.add_child(line)
	body.add_child(agreements[0])
	body.add_child(gap(9))
	var conflicts := _list_card("Current conflicts")
	var wars: Array = info.get("wars", [])
	if wars.is_empty():
		_empty_row(conflicts[1], "No active or ceasefire canonical conflicts involving this polity.")
	for item in wars:
		var war: Dictionary = item
		var inner := _list_row(conflicts[1])
		var line := row(9)
		var words := column(2)
		words.add_child(text(str(war.get("title", "")), 12, Color(1, 1, 1, 0.86), 750))
		words.add_child(text(str(war.get("subtitle", "")), 10, Color(1, 1, 1, 0.38)))
		if not str(war.get("allies", "")).is_empty():
			words.add_child(text(str(war["allies"]), 10, Color(1, 1, 1, 0.58)))
		if not str(war.get("cause", "")).is_empty():
			words.add_child(text(str(war["cause"]), 10, Color(1, 1, 1, 0.38)))
		if not str(war.get("timelineEventId", "")).is_empty():
			var timeline := link(str(war.get("timelineText", "")), UI.ACCENT, 10, 700)
			timeline.pressed.connect(func() -> void: show_event.emit(str(war["timelineEventId"])))
			words.add_child(timeline)
		_peace_controls(words, war, info)
		line.add_child(words)
		line.add_child(badge(str(war.get("status", "")), tone(str(war.get("tone", "")))))
		inner.add_child(line)
	body.add_child(conflicts[0])
	var reports: Array = info.get("reports", [])
	if not reports.is_empty():
		body.add_child(gap(9))
		var list := _list_card("War reports")
		for item in reports:
			var report: Dictionary = item
			var inner := _list_row(list[1])
			var line := row(8)
			var words := column(2)
			words.add_child(text(str(report.get("name", "")), 12, Color(1, 1, 1, 0.86), 750))
			words.add_child(text(str(report.get("ended", "")), 10, Color(1, 1, 1, 0.38)))
			line.add_child(words)
			var read := link("Read the report", UI.ACCENT, 11, 700)
			read.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			read.pressed.connect(func() -> void: open_war_report.emit(str(report.get("name", ""))))
			line.add_child(read)
			inner.add_child(line)
		body.add_child(list[0])
	var reparations: Array = info.get("reparations", [])
	if not reparations.is_empty():
		body.add_child(gap(9))
		var note := column(2)
		note.add_child(text("Reparations", 11, Color(1, 1, 1, 0.7), 800))
		for line in reparations:
			note.add_child(text(str(line), 11, Color(1, 1, 1, 0.7)))
		body.add_child(note)


func _peace_controls(holder: VBoxContainer, war: Dictionary, info: Dictionary) -> void:
	var id := str(war.get("id", ""))
	var state: Dictionary = peace.get(id, {"open": false, "territory": "restored", "money": "none", "busy": false, "said": ""})
	peace[id] = state
	holder.add_child(gap(3))
	if not str(war.get("weariness", "")).is_empty():
		holder.add_child(text("War weariness: %s" % str(war["weariness"]), 10, Color(1, 1, 1, 0.58)))
	if war.get("canPropose", false):
		var toggle := link("Propose peace", UI.ACCENT, 10, 700)
		toggle.pressed.connect(func() -> void:
			state["open"] = not bool(state["open"])
			_render())
		holder.add_child(toggle)
	if state["open"] and war.get("canPropose", false):
		var form := column(6)
		form.add_child(gap(2))
		var ground := field(info.get("territoryChoices", []), str(state["territory"]))
		ground.tooltip_text = "The ground"
		ground.item_selected.connect(func(index: int) -> void: state["territory"] = str(ground.get_item_metadata(index)))
		form.add_child(ground)
		var money := field(info.get("reparationChoices", []), str(state["money"]))
		money.tooltip_text = "Reparations"
		money.item_selected.connect(func(index: int) -> void: state["money"] = str(money.get_item_metadata(index)))
		form.add_child(money)
		form.add_child(text("They answer at once, by how the war stands for them and how weary they are. A fresh enemy that is not losing will refuse.", 10, Color(1, 1, 1, 0.45)))
		if not str(state["said"]).is_empty():
			form.add_child(text(str(state["said"]), 10, Color("#fca5a5")))
		var put := small_button("Put these terms", UI.ACCENT, UI.ACCENT, Color("#04141a"), 12, 800, Vector4(10, 6, 10, 6), 8)
		put.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		put.custom_minimum_size.y = 32
		put.disabled = bool(state["busy"])
		put.pressed.connect(_propose.bind(war))
		form.add_child(put)
		holder.add_child(form)


func _propose(war: Dictionary) -> void:
	var id := str(war.get("id", ""))
	var state: Dictionary = peace.get(id, {})
	if state.get("busy", false):
		return
	state["busy"] = true
	state["said"] = ""
	var reply: Dictionary = await engine.request("country.answer", {"op": "propose", "ref": id, "territory": str(state.get("territory", "restored")), "money": str(state.get("money", "none")), "theirs": str(war.get("theirs", ""))})
	state["busy"] = false
	var result: Dictionary = reply.get("result", {}) if reply.get("ok", false) else {"ok": false, "said": str(reply.get("error", "That could not be done."))}
	if result.get("ok", false):
		state["open"] = false
		await _load(target)
		return
	state["said"] = str(result.get("said", ""))
	_render()


func _render_economy() -> void:
	var definition_error := str(data.get("definitionError", ""))
	if not definition_error.is_empty():
		body.add_child(gap(16))
		var box := card(Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.12), Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.3), 10, Vector4(13, 11, 13, 11))
		box.add_child(text(definition_error, 13, UI.WHITE))
		body.add_child(box)
		return
	if sheet_status == "loading":
		body.add_child(gap(16))
		body.add_child(text("Waiting for the world to finish updating, then compiling national statistics…" if sheet_waiting else "Compiling national statistics…", 13, Color(1, 1, 1, 0.5)))
		return
	if sheet_status == "error":
		body.add_child(gap(16))
		var box := card(Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.12), Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.3), 10, Vector4(13, 11, 13, 11))
		var stack := column(6)
		stack.add_child(text(sheet_error, 13, UI.WHITE))
		var again := link("Try again", Color("#93c5fd"), 13, 700)
		again.pressed.connect(_refresh_sheet.bind(false))
		stack.add_child(again)
		box.add_child(stack)
		body.add_child(box)
		return
	var economy: Variant = data.get("economy")
	if typeof(economy) != TYPE_DICTIONARY or sheet_status != "ready":
		return
	var sheet: Dictionary = economy
	var intelligence: Variant = sheet.get("intelligence")
	var rated := typeof(intelligence) == TYPE_INT or typeof(intelligence) == TYPE_FLOAT
	if sheet.get("custom", false):
		if rated:
			body.add_child(gap(16))
			body.add_child(_intelligence_card(float(intelligence)))
		var first := true
		for item in sheet.get("sections", []):
			var section: Dictionary = item
			body.add_child(_section(str(section.get("title", "")), 16.0 if first else 17.6))
			first = false
			var grid := GridContainer.new()
			grid.columns = 2
			grid.add_theme_constant_override("h_separation", 9)
			grid.add_theme_constant_override("v_separation", 9)
			var wide: Array = []
			for stat_item in section.get("stats", []):
				var stat: Dictionary = stat_item
				if str(stat.get("kind", "")) == "index":
					wide.append(_index_card(str(stat.get("label", "")), str(stat.get("value", "")), float(stat.get("bar", 0)), tone(str(stat.get("color", "")))))
				else:
					var cell := card()
					var inner := column(5)
					inner.add_child(text(str(stat.get("label", "")), 10, Color(1, 1, 1, 0.45), 700, true, 1))
					inner.add_child(text(str(stat.get("value", "")), 17, tone(str(stat.get("color", ""))), 800))
					cell.add_child(inner)
					grid.add_child(cell)
			for card_node in wide:
				body.add_child(card_node)
				body.add_child(gap(9))
			if grid.get_child_count() > 0:
				body.add_child(grid)
	else:
		body.add_child(gap(16))
		var stability: Dictionary = sheet.get("stability", {})
		var box := card()
		var stack := column(7)
		var line := row(6)
		line.add_child(text("⚠ NATIONAL STABILITY", 11, Color(1, 1, 1, 0.55), 700, true, 1))
		line.add_child(UI.label("%d/100" % int(stability.get("value", 0)), 14, UI.WHITE, 800))
		stack.add_child(line)
		stack.add_child(_bar(float(stability.get("value", 0)), tone(str(stability.get("color", "")))))
		box.add_child(stack)
		body.add_child(box)
		if rated:
			body.add_child(gap(10))
			body.add_child(_intelligence_card(float(intelligence)))
		body.add_child(_section("⚑ Strategic indices"))
		var indices := column(9)
		for item in sheet.get("indices", []):
			var index: Dictionary = item
			indices.add_child(_index_card(str(index.get("label", "")), "%d%%" % int(index.get("value", 0)), float(index.get("value", 0)), tone(str(index.get("color", "")))))
		body.add_child(indices)
		body.add_child(_section("👥 Population"))
		var population: Dictionary = sheet.get("population", {})
		var people := card()
		var people_stack := column(5)
		people_stack.add_child(text("TOTAL POPULATION", 10, Color(1, 1, 1, 0.45), 700, true, 1))
		people_stack.add_child(UI.label(str(population.get("total", "—")), 18, Color("#e7e7e9"), 800))
		if not str(population.get("scope", "")).is_empty():
			people_stack.add_child(text(str(population["scope"]), 11, Color(1, 1, 1, 0.45)))
		people.add_child(people_stack)
		body.add_child(people)
		body.add_child(_section("📈 Economy"))
		var grid := GridContainer.new()
		grid.columns = 2
		grid.add_theme_constant_override("h_separation", 9)
		grid.add_theme_constant_override("v_separation", 9)
		for item in sheet.get("cards", []):
			var entry: Dictionary = item
			var cell := card()
			cell.size_flags_vertical = Control.SIZE_FILL
			var inner := column(5)
			inner.add_child(text(str(entry.get("label", "")), 10, Color(1, 1, 1, 0.45), 700, true, 1))
			inner.add_child(text(str(entry.get("value", "")), 17, tone(str(entry.get("tone", ""))), 800))
			if not str(entry.get("sub", "")).is_empty():
				inner.add_child(text(str(entry["sub"]), 11, Color(1, 1, 1, 0.4)))
			cell.add_child(inner)
			grid.add_child(cell)
		body.add_child(grid)
		if not str(sheet.get("currency", "")).is_empty():
			body.add_child(gap(7))
			body.add_child(text("Domestic currency: %s · GDP accounting shown in 2026-EUR-equivalent values." % str(sheet["currency"]), 11, Color(1, 1, 1, 0.35)))
		body.add_child(gap(14))
		var split := card()
		var split_stack := column(8)
		split_stack.add_child(text("GDP breakdown", 12, Color(1, 1, 1, 0.7)))
		var parts := StatSplit.new()
		parts.parts = sheet.get("breakdown", [])
		parts.custom_minimum_size.y = 10
		split_stack.add_child(parts)
		var keys := flow(13, 5)
		for item in sheet.get("breakdown", []):
			var part: Dictionary = item
			var key := row(5)
			var dot := StatDot.new()
			dot.square = true
			dot.color = tone(str(part.get("color", "")))
			dot.custom_minimum_size = Vector2(7, 7)
			dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			key.add_child(dot)
			key.add_child(UI.label("%s %d%%" % [str(part.get("label", "")), int(part.get("value", 0))], 11, Color(1, 1, 1, 0.6)))
			keys.add_child(key)
		split_stack.add_child(keys)
		split.add_child(split_stack)
		body.add_child(split)
	var military: Variant = data.get("military")
	if typeof(military) == TYPE_DICTIONARY:
		body.add_child(_section("⚔ Military"))
		body.add_child(_military_card(military))
	body.add_child(gap(14))
	var advanced := _wide_button("📊", Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.18), Color(147 / 255.0, 197 / 255.0, 253 / 255.0, 0.2), Color.WHITE, "Advanced statistics", ["Explore campaign trends and historical snapshots"], Color(147 / 255.0, 197 / 255.0, 253 / 255.0, 0.75), false)
	advanced.clicked.connect(_open_advanced)
	body.add_child(advanced)
	body.add_child(gap(9))
	var tracking: Dictionary = data.get("tracking", {})
	var running: bool = data.get("turnRunning", false)
	var lines: Array = [str(tracking.get("line", "")), str(tracking.get("preview", ""))]
	if running:
		lines.append(str(data.get("turnRunningNote", "")))
	var history := _wide_button("⚙", Color(234 / 255.0, 179 / 255.0, 8 / 255.0, 0.12), Color(250 / 255.0, 204 / 255.0, 21 / 255.0, 0.22), Color("#fbbf24"), "Historical tracking", lines, Color(1, 1, 1, 0.5), running)
	if running:
		history.enabled = false
		history.modulate.a = 0.55
		history.tooltip_text = str(data.get("turnRunningNote", ""))
		history.mouse_default_cursor_shape = Control.CURSOR_FORBIDDEN
	else:
		history.clicked.connect(_open_tracking)
	body.add_child(history)


func _bar(value: float, color: Color, height := 6.0, mark := -1.0) -> StatBar:
	var node := StatBar.new()
	node.value = value
	node.color = color
	node.mark = mark
	node.custom_minimum_size.y = height
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


func _index_card(label: String, value: String, bar: float, color: Color) -> PanelContainer:
	var box := card()
	var stack := column(6)
	var line := row(8)
	line.add_child(text(label, 12, Color(1, 1, 1, 0.8)))
	line.add_child(UI.label(value, 12, UI.WHITE, 800))
	stack.add_child(line)
	stack.add_child(_bar(bar, color))
	box.add_child(stack)
	return box


func _intelligence_card(value: float) -> PanelContainer:
	var box := card()
	var stack := column(7)
	var line := row(6)
	line.add_child(text("🕵 INTELLIGENCE SERVICE", 11, Color(1, 1, 1, 0.55), 700, true, 1))
	line.add_child(UI.label("%d/100" % int(value), 14, UI.WHITE, 800))
	stack.add_child(line)
	stack.add_child(_bar(value, Color("#38bdf8")))
	box.add_child(stack)
	return box


func _military_card(military: Dictionary) -> PanelContainer:
	var box := card()
	var stack := column(0)
	var top := row(6)
	top.add_child(text("MILITARY POWER", 11, Color(1, 1, 1, 0.55), 700, true, 1))
	top.add_child(UI.label(str(military.get("power", "—")), 17, UI.WHITE, 800))
	stack.add_child(top)
	stack.add_child(gap(3))
	stack.add_child(text("What it weighs in a land war, by its people and what its forces have to spend, through the figures below.", 10, Color(1, 1, 1, 0.42)))
	stack.add_child(gap(9))
	var rows := column(6)
	for item in military.get("rows", []):
		var figure: Dictionary = item
		var line := row(8)
		var own: bool = figure.get("own", false)
		var name := UI.label(str(figure.get("label", "")), 11, Color(1, 1, 1, 0.85) if own else Color(1, 1, 1, 0.6))
		name.custom_minimum_size.x = 102
		name.clip_text = true
		line.add_child(name)
		var bar := _bar(float(figure.get("value", 0)), tone(str(figure.get("color", ""))), 6.0, float(figure.get("mark", -1)))
		bar.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		line.add_child(bar)
		var figure_text := UI.label(str(figure.get("text", "")), 11, UI.WHITE, 800)
		figure_text.custom_minimum_size.x = 51
		figure_text.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		line.add_child(figure_text)
		rows.add_child(line)
	stack.add_child(rows)
	stack.add_child(gap(9))
	stack.add_child(text(str(military.get("note", "")), 10, Color(1, 1, 1, 0.38)))
	for key in ["attrition", "refill"]:
		if not str(military.get(key, "")).is_empty():
			stack.add_child(gap(5))
			stack.add_child(text(str(military[key]), 10, Color(1, 1, 1, 0.38)))
	box.add_child(stack)
	return box


func _wide_button(glyph: String, glyph_bg: Color, glyph_border: Color, glyph_ink: Color, title: String, lines: Array, arrow: Color, dim_lines: bool) -> StatClickable:
	var cell := StatClickable.new(UI.box(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.12), 11, 1, Vector4(13, 11, 13, 11)), UI.box(Color(1, 1, 1, 0.08), Color(1, 1, 1, 0.18), 11, 1, Vector4(13, 11, 13, 11)))
	var line := row(10)
	var icon := PanelContainer.new()
	icon.custom_minimum_size = Vector2(32, 32)
	icon.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	icon.add_theme_stylebox_override("panel", UI.box(glyph_bg, glyph_border, 8, 1))
	icon.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var mark := UI.label(glyph, 15, glyph_ink)
	mark.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	mark.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	icon.add_child(mark)
	line.add_child(icon)
	var words := column(2)
	words.add_child(text(title, 12, Color("#e7e7ea"), 850))
	var index := 0
	for value in lines:
		if str(value).is_empty():
			index += 1
			continue
		var faint := Color(1, 1, 1, 0.42 if index == 0 else 0.34)
		if dim_lines and index == 2:
			faint = Color(1, 1, 1, 0.46)
		var piece := clipped(str(value), 10, faint) if index == 1 else text(str(value), 10, faint)
		words.add_child(piece)
		index += 1
	line.add_child(words)
	var more := UI.label("›", 16, arrow)
	more.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	line.add_child(more)
	cell.add_child(line)
	return cell


func _render_ranking() -> void:
	if ranking.is_empty():
		return
	body.add_child(_section("Ranked by"))
	var chips := flow(6, 6)
	for item in ranking.get("metrics", []):
		var metric: Dictionary = item
		var chosen: bool = metric.get("selected", false)
		var chip := small_button(str(metric.get("label", "")), Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.16) if chosen else Color(1, 1, 1, 0.04), Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.6) if chosen else Color(1, 1, 1, 0.1), Color("#e8f8fe") if chosen else Color(1, 1, 1, 0.62), 11, 700, Vector4(10, 4, 10, 4), 999)
		chip.pressed.connect(_pick_metric.bind(str(metric.get("key", ""))))
		chips.add_child(chip)
	body.add_child(chips)
	body.add_child(gap(12))
	var list := column(5)
	for item in ranking.get("rows", []):
		var entry: Dictionary = item
		var mine: bool = entry.get("mine", false)
		var opened: bool = entry.get("open", false)
		var border := Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.6) if mine else (Color(1, 1, 1, 0.28) if opened else Color(1, 1, 1, 0.08))
		var cell := StatClickable.new(UI.box(Color(1, 1, 1, 0.1) if opened else Color(1, 1, 1, 0.04), border, 8, 1, Vector4(9, 6, 9, 6)), UI.box(Color(1, 1, 1, 0.08), border, 8, 1, Vector4(9, 6, 9, 6)))
		if mine:
			cell.tooltip_text = "Your country"
		var stack := column(3)
		var line := row(8)
		var rank := UI.label(str(entry.get("rank", "")), 12, Color(1, 1, 1, 0.5), 800)
		rank.custom_minimum_size.x = 27
		line.add_child(rank)
		var flag_box := PanelContainer.new()
		flag_box.custom_minimum_size = Vector2(24, 16)
		flag_box.clip_contents = true
		flag_box.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		flag_box.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.08), Color(0, 0, 0, 0), 3, 0))
		flag_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var flag := texture_for(str(entry.get("flag", "")), 32)
		if flag:
			var picture := TextureRect.new()
			picture.texture = flag
			picture.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
			picture.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
			picture.mouse_filter = Control.MOUSE_FILTER_IGNORE
			flag_box.add_child(picture)
		line.add_child(flag_box)
		line.add_child(clipped(str(entry.get("label", "")), 12, Color("#f4f4f5"), 800 if mine else 600))
		line.add_child(UI.label(str(entry.get("value", "")), 12, Color("#f4f4f5"), 800))
		stack.add_child(line)
		var bar := _bar(float(entry.get("bar", 0)), UI.ACCENT, 3.0)
		bar.track = Color(1, 1, 1, 0.08)
		stack.add_child(bar)
		cell.add_child(stack)
		cell.clicked.connect(_retarget.bind(str(entry.get("key", ""))))
		list.add_child(cell)
	body.add_child(list)
	if ranking.get("more", false):
		body.add_child(gap(10))
		var every := _menu_button("Show every country")
		every.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		every.pressed.connect(func() -> void:
			ranking_all = true
			_load_ranking(_sequence))
		body.add_child(every)
	if not str(ranking.get("empty", "")).is_empty():
		body.add_child(gap(13))
		body.add_child(text(str(ranking["empty"]), 12, Color(1, 1, 1, 0.55)))
	if not str(ranking.get("unranked", "")).is_empty():
		body.add_child(gap(11))
		body.add_child(text(str(ranking["unranked"]), 11, Color(1, 1, 1, 0.42)))


func _pick_metric(key: String) -> void:
	ranking_metric = key
	ranking_all = false
	await _load_ranking(_sequence)


func _modal_frame(width: float, height: float) -> VBoxContainer:
	_close_modal()
	var holder: Control = get_parent() as Control if get_parent() is Control else self
	_modal = Control.new()
	_modal.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_modal.mouse_filter = Control.MOUSE_FILTER_STOP
	var dim := ColorRect.new()
	dim.color = Color(6 / 255.0, 6 / 255.0, 7 / 255.0, 0.8)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_modal.add_child(dim)
	var centre := CenterContainer.new()
	centre.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_modal.add_child(centre)
	var view := holder.get_viewport_rect().size
	var sheet := PanelContainer.new()
	sheet.custom_minimum_size = Vector2(min(view.x * 0.96, width), min(height, view.y - 38.0))
	sheet.add_theme_stylebox_override("panel", UI.box(Color(20 / 255.0, 20 / 255.0, 22 / 255.0, 0.995), UI.HUD_BORDER, 18, 1))
	sheet.clip_contents = true
	centre.add_child(sheet)
	var stack := column(0)
	sheet.add_child(stack)
	holder.add_child(_modal)
	return stack


func _close_modal() -> void:
	if _modal:
		_modal.queue_free()
	_modal = null
	_modal_kind = ""


func _modal_header(stack: VBoxContainer, glyph: Control, title: String, extra: String, subtitle: String, close_label: String) -> void:
	var header := MarginContainer.new()
	for side in [["margin_left", 16], ["margin_right", 16], ["margin_top", 14], ["margin_bottom", 14]]:
		header.add_theme_constant_override(side[0], side[1])
	var line := row(12)
	line.add_child(glyph)
	var words := column(3)
	var top := row(10)
	top.add_child(UI.label(title, 16, Color("#f8fafc"), 900))
	if not extra.is_empty():
		var named := UI.label(extra, 12, Color(1, 1, 1, 0.48), 700)
		named.size_flags_vertical = Control.SIZE_SHRINK_END
		top.add_child(named)
	words.add_child(top)
	if not subtitle.is_empty():
		words.add_child(text(subtitle, 10, Color(1, 1, 1, 0.32)))
	line.add_child(words)
	var shut := small_button("×", Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.09), Color(1, 1, 1, 0.62), 16, 400, Vector4(0, 0, 0, 0), 8)
	shut.custom_minimum_size = Vector2(36, 36)
	shut.tooltip_text = close_label
	shut.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	shut.pressed.connect(_close_modal)
	line.add_child(shut)
	header.add_child(line)
	stack.add_child(header)
	var rule := ColorRect.new()
	rule.color = Color(1, 1, 1, 0.08)
	rule.custom_minimum_size.y = 1
	stack.add_child(rule)


func _open_advanced() -> void:
	chart_range = "all"
	_modal_kind = "advanced"
	await _render_advanced(true)
	if _modal_kind == "advanced":
		await _render_advanced()


func _render_advanced(loading := false) -> void:
	var reply: Dictionary = await engine.request("country.chart", {"target": target, "metricKeys": chart_keys, "range": chart_range, "loading": loading})
	if not reply.get("ok", false):
		return
	if not loading and _modal_kind != "advanced":
		return
	var model: Dictionary = reply.get("result", {})
	chart_keys = model.get("keys", [])
	var stack := _modal_frame(1380.0, 880.0)
	_modal_kind = "advanced"
	var badge_box := PanelContainer.new()
	badge_box.custom_minimum_size = Vector2(36, 36)
	badge_box.clip_contents = true
	badge_box.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	badge_box.add_theme_stylebox_override("panel", UI.box(Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.12), Color(1, 1, 1, 0.1), 9, 1))
	var flag := texture_for(str(model.get("flag", "")), 48)
	if flag:
		var picture := TextureRect.new()
		picture.texture = flag
		picture.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		picture.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
		badge_box.add_child(picture)
	else:
		var initials := UI.label(str(model.get("initials", "")), 12, Color("#93c5fd"), 900)
		initials.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		initials.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		badge_box.add_child(initials)
	_modal_header(stack, badge_box, "Advanced Statistics", str(model.get("countryName", "")), "%s · %s" % [str(model.get("sampleSpan", "")), str(model.get("snapshots", ""))], "Close advanced statistics")
	var split := row(0)
	split.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var left := MarginContainer.new()
	for side in [["margin_left", 16], ["margin_right", 16], ["margin_top", 16], ["margin_bottom", 14]]:
		left.add_theme_constant_override(side[0], side[1])
	left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var main := column(0)
	var top := row(9)
	var titles := column(2)
	titles.add_child(text(str(model.get("title", "")), 13, Color(1, 1, 1, 0.9), 850))
	titles.add_child(text(str(model.get("unitLabel", "")), 10, Color(1, 1, 1, 0.34)))
	top.add_child(titles)
	var legend := flow(9, 4)
	legend.size_flags_horizontal = Control.SIZE_SHRINK_END
	for item in model.get("legend", []):
		var entry: Dictionary = item
		var key := row(5)
		var dot := StatDot.new()
		dot.color = tone(str(entry.get("color", "")))
		dot.custom_minimum_size = Vector2(7, 7)
		dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		key.add_child(dot)
		key.add_child(UI.label(str(entry.get("label", "")), 10, Color(1, 1, 1, 0.58)))
		legend.add_child(key)
	top.add_child(legend)
	main.add_child(top)
	main.add_child(gap(6))
	var chart_box := PanelContainer.new()
	chart_box.size_flags_vertical = Control.SIZE_EXPAND_FILL
	chart_box.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.02), Color(1, 1, 1, 0.07), 12, 1, Vector4(6, 6, 6, 6)))
	if str(model.get("status", "")) == "error":
		var problem := text(str(model.get("error", "Historical Stats could not be loaded.")), 13, Color("#fca5a5"))
		problem.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		problem.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		chart_box.add_child(problem)
	elif typeof(model.get("chart")) == TYPE_DICTIONARY:
		var chart := StatChart.new()
		chart.model = model["chart"]
		chart.size_flags_vertical = Control.SIZE_EXPAND_FILL
		chart_box.add_child(chart)
	else:
		var empty := text(str(model.get("emptyText", "")), 13, Color(1, 1, 1, 0.42) if str(model.get("status", "")) == "loading" else Color(1, 1, 1, 0.38))
		empty.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		empty.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		chart_box.add_child(empty)
	main.add_child(chart_box)
	var summary: Array = model.get("summary", [])
	if not summary.is_empty():
		main.add_child(gap(11))
		var grid := GridContainer.new()
		grid.columns = clampi(summary.size(), 1, 4)
		grid.add_theme_constant_override("h_separation", 9)
		for item in summary:
			var entry: Dictionary = item
			var cell := card(Color(1, 1, 1, 0.03), Color(1, 1, 1, 0.07), 9, Vector4(10, 9, 10, 9))
			var inner := column(2)
			inner.add_child(clipped(str(entry.get("label", "")), 9, Color(1, 1, 1, 0.36), 800))
			inner.add_child(UI.label(str(entry.get("value", "")), 15, tone(str(entry.get("color", ""))), 900))
			inner.add_child(UI.label(str(entry.get("delta", "")), 9, tone(str(entry.get("tone", "")))))
			cell.add_child(inner)
			grid.add_child(cell)
		main.add_child(grid)
	left.add_child(main)
	split.add_child(left)
	var aside_bg := PanelContainer.new()
	aside_bg.custom_minimum_size.x = 310
	aside_bg.add_theme_stylebox_override("panel", UI.box(Color(9 / 255.0, 9 / 255.0, 10 / 255.0, 0.24), Color(0, 0, 0, 0), 0, 0))
	var aside_scroll := ScrollContainer.new()
	aside_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	var aside_margin := MarginContainer.new()
	aside_margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for side in [["margin_left", 14], ["margin_right", 14], ["margin_top", 14], ["margin_bottom", 16]]:
		aside_margin.add_theme_constant_override(side[0], side[1])
	var aside := column(0)
	aside.add_child(text("TIME RANGE", 9, Color(1, 1, 1, 0.42), 900, true, 1))
	aside.add_child(gap(8))
	var ranges := flow(6, 6)
	for entry in [["all", "All"], ["1y", "1 year"], ["5y", "5 years"], ["10y", "10 years"]]:
		var active: bool = entry[0] == chart_range
		var choice := small_button(entry[1], Color(0, 0, 0, 0.42) if active else Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.28) if active else Color(1, 1, 1, 0.08), Color("#f4f4f5") if active else Color(1, 1, 1, 0.5), 11, 800, Vector4(10, 6, 10, 6), 7)
		choice.pressed.connect(func() -> void:
			chart_range = entry[0]
			_render_advanced())
		ranges.add_child(choice)
	aside.add_child(ranges)
	aside.add_child(gap(16))
	var stats_line := row(6)
	stats_line.add_child(text("STATISTICS", 9, Color(1, 1, 1, 0.42), 900, true, 1))
	stats_line.add_child(UI.label(str(model.get("selectedCount", "")), 9, Color(147 / 255.0, 197 / 255.0, 253 / 255.0, 0.8), 800))
	aside.add_child(stats_line)
	aside.add_child(gap(5))
	aside.add_child(text("Compatible metrics can share a chart. Choosing a different scale switches the graph automatically.", 9, Color(1, 1, 1, 0.28)))
	for item in model.get("groups", []):
		var group: Dictionary = item
		aside.add_child(gap(12))
		aside.add_child(_rule())
		aside.add_child(gap(10))
		aside.add_child(text(str(group.get("title", "")), 11, Color(1, 1, 1, 0.62), 850))
		aside.add_child(gap(6))
		var metrics := column(4)
		for metric_item in group.get("metrics", []):
			var metric: Dictionary = metric_item
			metrics.add_child(_metric_toggle(metric, model))
		aside.add_child(metrics)
	aside.add_child(gap(14))
	var campaign := card(Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.07), Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.14), 9, Vector4(10, 10, 10, 10))
	var campaign_stack := column(3)
	campaign_stack.add_child(text("Campaign history", 10, Color("#bfdbfe"), 850))
	campaign_stack.add_child(text(str(model.get("campaign", "")), 9, Color(1, 1, 1, 0.38)))
	campaign.add_child(campaign_stack)
	aside.add_child(campaign)
	aside_margin.add_child(aside)
	aside_scroll.add_child(aside_margin)
	aside_bg.add_child(aside_scroll)
	split.add_child(aside_bg)
	stack.add_child(split)


func _metric_toggle(metric: Dictionary, model: Dictionary) -> StatClickable:
	var checked: bool = metric.get("checked", false)
	var compatible: bool = metric.get("compatible", false)
	var color := tone(str(metric.get("color", "")))
	var cell := StatClickable.new(UI.box(Color(color.r, color.g, color.b, 0.086) if checked else Color(0, 0, 0, 0), Color(color.r, color.g, color.b, 0.31) if checked else Color(0, 0, 0, 0), 7, 1, Vector4(7, 6, 7, 6)), UI.box(Color(1, 1, 1, 0.05), Color(color.r, color.g, color.b, 0.31) if checked else Color(0, 0, 0, 0), 7, 1, Vector4(7, 6, 7, 6)))
	var line := row(7)
	var box := PanelContainer.new()
	box.custom_minimum_size = Vector2(14, 14)
	box.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	box.add_theme_stylebox_override("panel", UI.box(color if checked else Color(1, 1, 1, 0.08), color if checked else Color(1, 1, 1, 0.13), 4, 1))
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if checked:
		var tick := UI.label("✓", 9, Color("#121214"), 900)
		tick.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		tick.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		box.add_child(tick)
	line.add_child(box)
	var ink := Color(1, 1, 1, 0.9) if checked else (Color(1, 1, 1, 0.55) if compatible else Color(1, 1, 1, 0.32))
	line.add_child(text(str(metric.get("label", "")), 11, ink, 800 if checked else 650))
	cell.add_child(line)
	cell.clicked.connect(_toggle_metric.bind(metric, model))
	return cell


func _toggle_metric(metric: Dictionary, model: Dictionary) -> void:
	var key := str(metric.get("key", ""))
	var units := {}
	for item in model.get("groups", []):
		for metric_item in (item as Dictionary).get("metrics", []):
			var entry: Dictionary = metric_item
			units[str(entry.get("key", ""))] = str(entry.get("unit", ""))
	var current: Array = chart_keys.duplicate()
	if current.has(key):
		if current.size() == 1:
			return
		current.erase(key)
	elif current.is_empty() or str(units.get(current[0], "")) != str(units.get(key, "")):
		current = [key]
	elif current.size() >= 4:
		current = current.slice(1)
		current.append(key)
	else:
		current.append(key)
	chart_keys = current
	await _render_advanced()


func _open_tracking() -> void:
	tracking_search = ""
	_modal_kind = "tracking"
	await _render_tracking(null)


func _render_tracking(model_in: Variant) -> void:
	var model: Dictionary = {}
	if typeof(model_in) == TYPE_DICTIONARY:
		model = model_in
	else:
		var reply: Dictionary = await engine.request("country.tracking", {"target": target, "search": tracking_search})
		if not reply.get("ok", false):
			return
		model = reply.get("result", {})
	_tracking_model = model
	var stack := _modal_frame(980.0, 760.0)
	_modal_kind = "tracking"
	var glyph := PanelContainer.new()
	glyph.custom_minimum_size = Vector2(40, 40)
	glyph.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	glyph.add_theme_stylebox_override("panel", UI.box(Color(234 / 255.0, 179 / 255.0, 8 / 255.0, 0.12), Color(250 / 255.0, 204 / 255.0, 21 / 255.0, 0.22), 12, 1))
	var cog := UI.label("⚙", 19, Color("#fbbf24"))
	cog.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	cog.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	glyph.add_child(cog)
	_modal_header(stack, glyph, "Historical tracking", "", "Choose how often Stats should re-check tracked countries, and which countries you want on your long-term graphs.", "Close historical tracking")
	var outer := MarginContainer.new()
	for side in [["margin_left", 17], ["margin_right", 17], ["margin_top", 16], ["margin_bottom", 17]]:
		outer.add_theme_constant_override(side[0], side[1])
	outer.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var split := row(16)
	var left := column(14)
	left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var cadence := card(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.08), 12, Vector4(14, 14, 14, 14))
	var cadence_stack := column(8)
	cadence_stack.add_child(text("Auto-refresh cadence", 12, Color(1, 1, 1, 0.8), 800))
	var choices := flow(7, 7)
	var running: bool = model.get("turnRunning", false)
	for item in model.get("intervals", []):
		var interval: Dictionary = item
		var active: bool = interval.get("active", false)
		var choice := small_button(str(interval.get("label", "")), Color(0, 0, 0, 0.42) if active else Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.28) if active else Color(1, 1, 1, 0.08), Color("#f4f4f5") if active else Color(1, 1, 1, 0.68), 12, 800 if active else 700, Vector4(11, 7, 11, 7), 999)
		choice.pressed.connect(_set_interval.bind(int(interval.get("months", 0))))
		if running:
			UI.set_disabled_look(choice, str(data.get("turnRunningNote", "")))
		choices.add_child(choice)
	cadence_stack.add_child(choices)
	var current := RichTextLabel.new()
	current.add_theme_font_override("normal_font", UI.font(400))
	current.bbcode_enabled = true
	current.fit_content = true
	current.scroll_active = false
	current.mouse_filter = Control.MOUSE_FILTER_IGNORE
	current.add_theme_font_size_override("normal_font_size", 11)
	current.add_theme_color_override("default_color", Color(1, 1, 1, 0.42))
	current.text = "Current setting: [color=#dbeafe]%s[/color]. Your country is automatically kept in the tracked list whenever auto-refresh is enabled." % _escape(str(model.get("intervalLabel", "")))
	cadence_stack.add_child(current)
	cadence.add_child(cadence_stack)
	left.add_child(cadence)
	var tracked := card(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.08), 12, Vector4(14, 14, 14, 14))
	tracked.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var tracked_stack := column(0)
	var tracked_top := row(11)
	var tracked_titles := column(2)
	tracked_titles.add_child(text("Tracked countries", 12, Color(1, 1, 1, 0.8), 800))
	tracked_titles.add_child(text(str(model.get("pickText", "")), 11, Color(1, 1, 1, 0.42)))
	tracked_top.add_child(tracked_titles)
	var count := pill(str(model.get("count", "")), Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.09), Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.18), Color("#bfdbfe"), 11, 800, Vector4(9, 4, 9, 4))
	count.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	tracked_top.add_child(count)
	tracked_stack.add_child(tracked_top)
	tracked_stack.add_child(gap(12))
	var search := LineEdit.new()
	search.placeholder_text = "Search countries..."
	search.text = tracking_search
	search.custom_minimum_size.y = 34
	search.add_theme_font_size_override("font_size", 12)
	search.add_theme_stylebox_override("normal", UI.box(Color(1, 1, 1, 0.03), Color(1, 1, 1, 0.09), 10, 1, Vector4(11, 6, 11, 6)))
	search.add_theme_stylebox_override("focus", UI.box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.16), 10, 1, Vector4(11, 6, 11, 6)))
	search.text_changed.connect(_search_tracking)
	tracked_stack.add_child(search)
	tracked_stack.add_child(gap(11))
	var chips := flow(6, 6)
	var chip_rows: Array = model.get("chips", [])
	for item in chip_rows:
		var chip: Dictionary = item
		var button := StatClickable.new(UI.box(Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.12), Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.2), 999, 1, Vector4(10, 5, 10, 5)), UI.box(Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.18), Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.3), 999, 1, Vector4(10, 5, 10, 5)))
		button.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		button.tooltip_text = "Remove from tracked countries"
		var line := row(7)
		line.add_child(UI.label(str(chip.get("label", "")), 11, Color("#dbeafe")))
		if chip.get("isPlayer", false):
			line.add_child(UI.label("you", 10, Color("#fbbf24"), 800))
		if not chip.get("ready", false):
			line.add_child(UI.label("baseline needed", 10, Color("#fbbf24"), 800))
		line.add_child(UI.label("×", 11, Color(1, 1, 1, 0.45)))
		button.add_child(line)
		button.clicked.connect(_toggle_tracked.bind(str(chip.get("key", ""))))
		if running:
			button.enabled = false
		chips.add_child(button)
	if chip_rows.is_empty():
		chips.add_child(UI.label("No countries tracked yet.", 11, Color(1, 1, 1, 0.35)))
	tracked_stack.add_child(chips)
	tracked_stack.add_child(gap(13))
	tracked_stack.add_child(_rule())
	tracked_stack.add_child(gap(13))
	var list_scroll := ScrollContainer.new()
	list_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	list_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var list := column(6)
	for item in model.get("rows", []):
		var entry: Dictionary = item
		list.add_child(_tracking_row(entry, running))
	list_scroll.add_child(list)
	tracked_stack.add_child(list_scroll)
	tracked.add_child(tracked_stack)
	left.add_child(tracked)
	split.add_child(left)
	var aside := column(14)
	aside.custom_minimum_size.x = 310
	var glance := card(Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.07), Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.14), 12, Vector4(14, 14, 14, 14))
	var glance_stack := column(5)
	glance_stack.add_child(text("At a glance", 12, Color("#bfdbfe"), 850))
	var glance_text := RichTextLabel.new()
	glance_text.add_theme_font_override("normal_font", UI.font(400))
	glance_text.bbcode_enabled = true
	glance_text.fit_content = true
	glance_text.scroll_active = false
	glance_text.mouse_filter = Control.MOUSE_FILTER_IGNORE
	glance_text.add_theme_font_size_override("normal_font_size", 11)
	glance_text.add_theme_color_override("default_color", Color(1, 1, 1, 0.5))
	glance_text.text = "Auto-refresh is currently set to [color=#dbeafe]%s[/color]. When tracked countries become due, Continuum refreshes all initialized sheets in one bounded AI batch after a completed turn. Countries marked [color=#fbbf24]baseline needed[/color] begin auto-refreshing after their first normal Stats sheet exists." % _escape(str(model.get("intervalLabel", "")))
	glance_stack.add_child(glance_text)
	glance.add_child(glance_stack)
	aside.add_child(glance)
	var status_rows: Array = model.get("status", [])
	if not status_rows.is_empty():
		var refresh_box := card(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.08), 12, Vector4(14, 14, 14, 14))
		var refresh_stack := column(5)
		refresh_stack.add_child(text("Refresh status", 12, Color(1, 1, 1, 0.8), 800))
		refresh_stack.add_child(text(str(model.get("lastBatch", "")), 11, Color(1, 1, 1, 0.48)))
		refresh_stack.add_child(gap(4))
		for item in status_rows:
			var entry: Dictionary = item
			var line := row(8)
			var words := column(1)
			words.add_child(clipped(str(entry.get("label", "")), 11, Color(1, 1, 1, 0.82), 700))
			var ready: bool = entry.get("ready", false)
			words.add_child(text(str(entry.get("text", "")), 10, Color(1, 1, 1, 0.42) if ready else Color("#fbbf24")))
			line.add_child(words)
			if not ready:
				var assess := small_button("Assess now", Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.1), Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.3), UI.ACCENT, 10, 800, Vector4(10, 4, 10, 4), 999)
				assess.size_flags_vertical = Control.SIZE_SHRINK_CENTER
				assess.pressed.connect(_assess_now.bind(str(entry.get("key", ""))))
				line.add_child(assess)
			refresh_stack.add_child(line)
		refresh_stack.add_child(gap(4))
		refresh_stack.add_child(text("A country without a complete Stats sheet is skipped by the automatic refresh. Assessing it opens its Stats, which builds the first sheet with one request.", 10, Color(1, 1, 1, 0.38)))
		refresh_box.add_child(refresh_stack)
		aside.add_child(refresh_box)
	var advice := card(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.08), 12, Vector4(14, 14, 14, 14))
	var advice_stack := column(5)
	advice_stack.add_child(text("Suggested approach", 12, Color(1, 1, 1, 0.8), 800))
	for value in ["Keep your country tracked.", "Add nearby powers or direct rivals.", "6 months is a good default.", "Stay bounded: 4–8 countries is usually plenty."]:
		advice_stack.add_child(text("•  %s" % value, 11, Color(1, 1, 1, 0.48)))
	advice.add_child(advice_stack)
	aside.add_child(advice)
	aside.add_child(UI.spacer(false))
	var done := small_button("Done", Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.1), Color(1, 1, 1, 0.75), 12, 800, Vector4(14, 11, 14, 11), 10)
	done.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	done.pressed.connect(_close_tracking)
	aside.add_child(done)
	split.add_child(aside)
	outer.add_child(split)
	stack.add_child(outer)
	if not tracking_search.is_empty():
		search.grab_focus()
		search.caret_column = search.text.length()


func _tracking_row(entry: Dictionary, running: bool) -> StatClickable:
	var tracked: bool = entry.get("tracked", false)
	var maxed: bool = entry.get("maxed", false)
	var cell := StatClickable.new(UI.box(Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.08) if tracked else Color(1, 1, 1, 0.02), Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.24) if tracked else Color(1, 1, 1, 0.07), 10, 1, Vector4(11, 9, 11, 9)), UI.box(Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.12) if tracked else Color(1, 1, 1, 0.05), Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.3) if tracked else Color(1, 1, 1, 0.12), 10, 1, Vector4(11, 9, 11, 9)))
	cell.enabled = not maxed and not running
	if maxed:
		cell.modulate.a = 0.75
		cell.mouse_default_cursor_shape = Control.CURSOR_FORBIDDEN
	var line := row(8)
	var words := column(3)
	var top := row(6)
	var box := PanelContainer.new()
	box.custom_minimum_size = Vector2(14, 14)
	box.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	box.add_theme_stylebox_override("panel", UI.box(Color("#22c55e") if tracked else Color(1, 1, 1, 0.06), Color("#22c55e") if tracked else Color(1, 1, 1, 0.12), 4, 1))
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if tracked:
		var tick := UI.label("✓", 9, Color("#121214"), 900)
		tick.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		box.add_child(tick)
	top.add_child(box)
	top.add_child(clipped(str(entry.get("label", "")), 12, Color(1, 1, 1, 0.92) if tracked else (Color(1, 1, 1, 0.32) if maxed else Color(1, 1, 1, 0.7)), 800 if tracked else 700))
	words.add_child(top)
	var notes := row(6)
	if entry.get("isPlayer", false):
		notes.add_child(UI.label("your country", 10, Color("#fbbf24")))
	if entry.get("isViewed", false):
		notes.add_child(UI.label("currently viewed", 10, Color("#93c5fd")))
	if not str(entry.get("keyText", "")).is_empty():
		notes.add_child(UI.label(str(entry["keyText"]), 10, Color(1, 1, 1, 0.42)))
	var ready: bool = entry.get("ready", false)
	notes.add_child(UI.label("Stats ready" if ready else "baseline needed", 10, Color("#86efac") if ready else Color("#fbbf24")))
	words.add_child(notes)
	line.add_child(words)
	var action := UI.label(str(entry.get("action", "")), 11, Color("#86efac") if tracked else Color(1, 1, 1, 0.38), 800)
	action.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	line.add_child(action)
	cell.add_child(line)
	cell.clicked.connect(_toggle_tracked.bind(str(entry.get("key", ""))))
	return cell


func _search_tracking(value: String) -> void:
	tracking_search = value
	var asked := value
	var reply: Dictionary = await engine.request("country.tracking", {"target": target, "search": value})
	if asked != tracking_search or _modal_kind != "tracking" or not reply.get("ok", false):
		return
	await _render_tracking(reply.get("result", {}))


func _set_interval(months: int) -> void:
	var reply: Dictionary = await engine.request("country.tracking.interval", {"months": months, "target": target, "search": tracking_search})
	if reply.get("ok", false) and _modal_kind == "tracking":
		await _render_tracking(reply.get("result", {}))


func _toggle_tracked(key: String) -> void:
	var reply: Dictionary = await engine.request("country.tracking.toggle", {"key": key, "target": target, "search": tracking_search})
	if reply.get("ok", false) and _modal_kind == "tracking":
		await _render_tracking(reply.get("result", {}))


func _close_tracking() -> void:
	_close_modal()
	await _load(target)


func _assess_now(key: String) -> void:
	_close_modal()
	tab = "economy"
	await show_country(key)


class StatClickable extends PanelContainer:
	signal clicked
	var normal: StyleBox
	var hover: StyleBox
	var enabled := true

	func _init(normal_style: StyleBox, hover_style: StyleBox = null) -> void:
		normal = normal_style
		hover = hover_style if hover_style else normal_style
		add_theme_stylebox_override("panel", normal)
		mouse_filter = Control.MOUSE_FILTER_STOP
		mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		size_flags_horizontal = Control.SIZE_EXPAND_FILL
		mouse_entered.connect(_on_enter)
		mouse_exited.connect(_on_exit)

	func _on_enter() -> void:
		if enabled:
			add_theme_stylebox_override("panel", hover)

	func _on_exit() -> void:
		add_theme_stylebox_override("panel", normal)

	func _gui_input(event: InputEvent) -> void:
		if not enabled or not (event is InputEventMouseButton):
			return
		var button := event as InputEventMouseButton
		if button.button_index != MOUSE_BUTTON_LEFT:
			return
		if not button.pressed and Rect2(Vector2.ZERO, size).has_point(button.position):
			clicked.emit()
		accept_event()


class StatDot extends Control:
	var color := Color.WHITE
	var square := false

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func _draw() -> void:
		if square:
			draw_style_box(UI.box(color, Color(0, 0, 0, 0.55), 2, 1), Rect2(Vector2.ZERO, size))
		else:
			draw_circle(size * 0.5, min(size.x, size.y) * 0.5, color, true, -1.0, true)


class StatBar extends Control:
	var value := 0.0
	var color := Color.WHITE
	var mark := -1.0
	var track := Color(1, 1, 1, 0.1)

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func _draw() -> void:
		var radius := int(ceil(size.y * 0.5))
		draw_style_box(UI.box(track, Color(0, 0, 0, 0), radius, 0), Rect2(Vector2.ZERO, size))
		var fraction: float = clamp(round(value), 0.0, 100.0) / 100.0
		if fraction > 0.0:
			draw_style_box(UI.box(color, Color(0, 0, 0, 0), radius, 0), Rect2(Vector2.ZERO, Vector2(max(size.y, size.x * fraction), size.y)))
		if mark >= 0.0:
			var x: float = size.x * clamp(round(mark), 0.0, 100.0) / 100.0
			draw_rect(Rect2(x, 0, 1, size.y), Color(1, 1, 1, 0.55))


class StatMeter extends Control:
	var value := 0.0
	var color := Color.WHITE

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		size_flags_horizontal = Control.SIZE_EXPAND_FILL

	func _draw() -> void:
		var radius := int(ceil(size.y * 0.5))
		draw_style_box(UI.box(Color(1, 1, 1, 0.08), Color(0, 0, 0, 0), radius, 0), Rect2(Vector2.ZERO, size))
		var half := size.x * 0.5
		draw_rect(Rect2(half, 0, 1, size.y), Color(1, 1, 1, 0.22))
		var width: float = abs(clamp(value, -100.0, 100.0)) / 200.0 * size.x
		if width > 0.0:
			var left := half if value >= 0.0 else half - width
			draw_style_box(UI.box(color, Color(0, 0, 0, 0), radius, 0), Rect2(left, 0, width, size.y))


class StatSplit extends Control:
	var parts: Array = []

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		size_flags_horizontal = Control.SIZE_EXPAND_FILL

	func _draw() -> void:
		var x := 0.0
		var radius := int(ceil(size.y * 0.5))
		var shown: Array = []
		for item in parts:
			var part: Dictionary = item
			var width: float = size.x * float(part.get("share", 0)) / 100.0
			if width > 0.0:
				shown.append([x, width, StatPaint.tone(str(part.get("color", "")))])
			x += width
		for index in range(shown.size()):
			var piece: Array = shown[index]
			var style := UI.box(piece[2], Color(0, 0, 0, 0), 0, 0)
			style.corner_radius_top_left = radius if index == 0 else 0
			style.corner_radius_bottom_left = radius if index == 0 else 0
			style.corner_radius_top_right = radius if index == shown.size() - 1 else 0
			style.corner_radius_bottom_right = radius if index == shown.size() - 1 else 0
			draw_style_box(style, Rect2(float(piece[0]), 0, float(piece[1]), size.y))


class StatDonut extends Control:
	signal picked(id: String)
	signal hovering(id: String)
	var slices: Array = []
	var selected := ""
	var hovered := ""
	var center_label := "Political"
	var center_sub := "landscape"
	var _segments: Array = []

	func _init() -> void:
		custom_minimum_size = Vector2(178, 178)
		mouse_filter = Control.MOUSE_FILTER_STOP

	func _segments_now() -> Array:
		var result: Array = []
		var cursor := 0.0
		for item in slices:
			var party: Dictionary = item
			var span: float = max(0.0, float(party.get("chartPercent", 0))) * 3.6
			var spacing := 1.2 if span >= 7.0 else 0.25
			var start := cursor + spacing * 0.5
			var finish: float = max(start + 0.1, cursor + span - spacing * 0.5)
			cursor += span
			result.append([party, start, finish])
		return result

	func _point(angle: float, radius: float, scale: float) -> Vector2:
		var radians := deg_to_rad(angle - 90.0)
		return (Vector2(90, 90) + Vector2(cos(radians), sin(radians)) * radius) * scale

	func _draw() -> void:
		var scale := size.x / 180.0
		draw_circle(Vector2(90, 90) * scale, 78.0 * scale, Color(1, 1, 1, 0.025), true, -1.0, true)
		_segments = _segments_now()
		for segment in _segments:
			var party: Dictionary = segment[0]
			var id := str(party.get("id", ""))
			var start: float = segment[1]
			var finish: float = segment[2]
			var points := PackedVector2Array()
			var steps: int = max(2, int(ceil((finish - start) / 3.0)))
			for step in range(steps + 1):
				points.append(_point(lerp(start, finish, float(step) / steps), 78.0, scale))
			for step in range(steps, -1, -1):
				points.append(_point(lerp(start, finish, float(step) / steps), 50.0, scale))
			var color := StatPaint.tone(str(party.get("color", "")))
			var alpha := 1.0 if id == selected or id == hovered else (0.58 if not selected.is_empty() else 0.9)
			if id == hovered:
				color = color.lightened(0.12)
			draw_colored_polygon(points, Color(color.r, color.g, color.b, color.a * alpha))
			var outline := points.duplicate()
			outline.append(points[0])
			draw_polyline(outline, Color(1, 1, 1, 0.9) if id == selected else Color(11 / 255.0, 15 / 255.0, 23 / 255.0, 0.88), (2.4 if id == selected else 1.5) * scale * 0.5, true)
		draw_circle(Vector2(90, 90) * scale, 47.0 * scale, Color(18 / 255.0, 20 / 255.0, 27 / 255.0, 0.98), true, -1.0, true)
		draw_circle(Vector2(90, 90) * scale, 47.0 * scale, Color(1, 1, 1, 0.07), false, 1.0, true)
		var active: Dictionary = {}
		for item in slices:
			var party: Dictionary = item
			if str(party.get("id", "")) == hovered and not hovered.is_empty():
				active = party
		if active.is_empty():
			for item in slices:
				var party: Dictionary = item
				if str(party.get("id", "")) == selected and not selected.is_empty():
					active = party
		var name := center_label
		var sub := center_sub
		if not active.is_empty():
			name = str(active.get("shortName", active.get("name", "")))
			sub = str(active.get("valueText", ""))
		if name.length() > 18:
			name = name.substr(0, 16) + "…"
		var bold := UI.font(800)
		var regular := UI.font(700)
		var top_size := int(round(11 * scale))
		var sub_size := int(round(9 * scale))
		var width := bold.get_string_size(name, HORIZONTAL_ALIGNMENT_LEFT, -1, top_size).x
		draw_string(bold, Vector2(90 * scale - width * 0.5, 85 * scale), name, HORIZONTAL_ALIGNMENT_LEFT, -1, top_size, Color(1, 1, 1, 0.94))
		var sub_width := regular.get_string_size(sub, HORIZONTAL_ALIGNMENT_LEFT, -1, sub_size).x
		draw_string(regular, Vector2(90 * scale - sub_width * 0.5, 101 * scale), sub, HORIZONTAL_ALIGNMENT_LEFT, -1, sub_size, Color(1, 1, 1, 0.58) if not active.is_empty() else Color(1, 1, 1, 0.36))

	func _slice_at(position: Vector2) -> String:
		var scale := size.x / 180.0
		var local := position / scale - Vector2(90, 90)
		var distance := local.length()
		if distance < 50.0 or distance > 78.0:
			return ""
		var angle := fposmod(rad_to_deg(atan2(local.y, local.x)) + 90.0, 360.0)
		for segment in _segments:
			if angle >= float(segment[1]) and angle <= float(segment[2]):
				return str((segment[0] as Dictionary).get("id", ""))
		return ""

	func _gui_input(event: InputEvent) -> void:
		if event is InputEventMouseMotion:
			var id := _slice_at((event as InputEventMouseMotion).position)
			if id != hovered:
				hovering.emit(id)
			mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if not id.is_empty() else Control.CURSOR_ARROW
		elif event is InputEventMouseButton and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT and not (event as InputEventMouseButton).pressed:
			var id := _slice_at((event as InputEventMouseButton).position)
			if not id.is_empty():
				picked.emit(id)

	func _notification(what: int) -> void:
		if what == NOTIFICATION_MOUSE_EXIT and not hovered.is_empty():
			hovering.emit("")


class StatChart extends Control:
	var model: Dictionary = {}
	var hover := -1

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_STOP
		size_flags_horizontal = Control.SIZE_EXPAND_FILL

	func _layout() -> Array:
		var width := float(model.get("width", 900))
		var height := float(model.get("height", 470))
		var scale: float = min(size.x / width, size.y / height)
		var offset := Vector2((size.x - width * scale) * 0.5, 0.0)
		return [scale, offset]

	func _draw() -> void:
		if model.is_empty():
			return
		var layout := _layout()
		var scale: float = layout[0]
		if scale <= 0.01:
			return
		var offset: Vector2 = layout[1]
		var at := func(x: float, y: float) -> Vector2: return offset + Vector2(x, y) * scale
		var plot: Array = model.get("plot", [78, 34, 788, 378])
		var plot_rect := Rect2(at.call(float(plot[0]), float(plot[1])), Vector2(float(plot[2]), float(plot[3])) * scale)
		draw_style_box(UI.box(Color(8 / 255.0, 8 / 255.0, 10 / 255.0, 0.18), Color(1, 1, 1, 0.06), int(10 * scale), 1), plot_rect)
		var font := UI.font(600)
		var label_size := int(max(9.0, round(12 * scale)))
		var right := float(plot[0]) + float(plot[2])
		for item in model.get("yTicks", []):
			var tick: Dictionary = item
			var y := float(tick.get("y", 0))
			var from: Vector2 = at.call(float(plot[0]), y)
			var to: Vector2 = at.call(right, y)
			if tick.get("solid", false):
				draw_line(from, to, Color(1, 1, 1, 0.08), 1.0)
			else:
				draw_dashed_line(from, to, Color(1, 1, 1, 0.08), 1.0, 3.0 * scale)
			var words := str(tick.get("label", ""))
			var width := font.get_string_size(words, HORIZONTAL_ALIGNMENT_LEFT, -1, label_size).x
			draw_string(font, at.call(float(plot[0]) - 12.0, y + 4.0) - Vector2(width, 0), words, HORIZONTAL_ALIGNMENT_LEFT, -1, label_size, Color(1, 1, 1, 0.42))
		for item in model.get("xTicks", []):
			var tick: Dictionary = item
			var x := float(tick.get("x", 0))
			draw_line(at.call(x, float(plot[1])), at.call(x, float(plot[1]) + float(plot[3])), Color(1, 1, 1, 0.05), 1.0)
			var words := str(tick.get("label", ""))
			var width := font.get_string_size(words, HORIZONTAL_ALIGNMENT_LEFT, -1, label_size).x
			draw_string(font, at.call(x, float(model.get("height", 470)) - 24.0) - Vector2(width * 0.5, 0), words, HORIZONTAL_ALIGNMENT_LEFT, -1, label_size, Color(1, 1, 1, 0.42))
		for item in model.get("series", []):
			var series: Dictionary = item
			var color := StatPaint.tone(str(series.get("color", "")))
			for run in series.get("runs", []):
				var points := PackedVector2Array()
				for point in run:
					points.append(at.call(float(point[0]), float(point[1])))
				if points.size() > 1:
					draw_polyline(points, color, max(1.5, 3.0 * scale), true)
				if model.get("dots", false):
					for point in points:
						draw_circle(point, 3.7 * scale + 2.0 * scale, Color8(20, 20, 23), true, -1.0, true)
						draw_circle(point, 3.7 * scale, color, true, -1.0, true)
		var samples: Array = model.get("samples", [])
		if hover >= 0 and hover < samples.size():
			var sample: Dictionary = samples[hover]
			var x := float(sample.get("x", 0))
			draw_line(at.call(x, float(plot[1])), at.call(x, float(plot[1]) + float(plot[3])), Color(1, 1, 1, 0.34), 1.0)
			var values: Array = sample.get("values", [])
			for item in values:
				var value: Dictionary = item
				var point: Vector2 = at.call(x, float(value.get("y", 0)))
				draw_circle(point, 6.0 * scale + 3.0 * scale, Color8(20, 20, 23), true, -1.0, true)
				draw_circle(point, 6.0 * scale, StatPaint.tone(str(value.get("color", ""))), true, -1.0, true)
			var box_width := 180.0
			var box_height := 26.0 + values.size() * 18.0
			var anchor: Vector2 = at.call(x, 0) + Vector2(10, 18)
			anchor.x = min(anchor.x, size.x - box_width - 10.0)
			draw_style_box(UI.box(Color(16 / 255.0, 16 / 255.0, 18 / 255.0, 0.96), Color(148 / 255.0, 163 / 255.0, 184 / 255.0, 0.22), 10, 1), Rect2(anchor, Vector2(box_width, box_height)))
			draw_string(UI.font(800), anchor + Vector2(10, 18), str(sample.get("date", "")), HORIZONTAL_ALIGNMENT_LEFT, -1, 10, Color(1, 1, 1, 0.62))
			var line_y := 36.0
			for item in values:
				var value: Dictionary = item
				draw_circle(anchor + Vector2(13.5, line_y - 4), 3.5, StatPaint.tone(str(value.get("color", ""))), true, -1.0, true)
				draw_string(UI.font(400), anchor + Vector2(21, line_y), str(value.get("label", "")), HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Color(1, 1, 1, 0.62))
				var figure := str(value.get("text", ""))
				var figure_width := UI.font(850).get_string_size(figure, HORIZONTAL_ALIGNMENT_LEFT, -1, 11).x
				draw_string(UI.font(850), anchor + Vector2(box_width - 10 - figure_width, line_y), figure, HORIZONTAL_ALIGNMENT_LEFT, -1, 11, UI.WHITE)
				line_y += 18.0
		var unit_font := UI.font(700, "Arial", 1)
		draw_string(unit_font, at.call(float(plot[0]), 18.0), str(model.get("unitLabel", "")), HORIZONTAL_ALIGNMENT_LEFT, -1, int(max(9.0, round(11 * scale))), Color(1, 1, 1, 0.38))

	func _gui_input(event: InputEvent) -> void:
		if not (event is InputEventMouseMotion):
			return
		var layout := _layout()
		var scale: float = layout[0]
		var offset: Vector2 = layout[1]
		var local := ((event as InputEventMouseMotion).position - offset) / scale
		var samples: Array = model.get("samples", [])
		var plot: Array = model.get("plot", [78, 34, 788, 378])
		var best := -1
		if local.y >= float(plot[1]) and local.y <= float(plot[1]) + float(plot[3]) and local.x >= float(plot[0]) and local.x <= float(plot[0]) + float(plot[2]):
			var nearest := INF
			for index in range(samples.size()):
				var distance: float = abs(float((samples[index] as Dictionary).get("x", 0)) - local.x)
				if distance < nearest:
					nearest = distance
					best = index
		if best != hover:
			hover = best
			queue_redraw()

	func _notification(what: int) -> void:
		if what == NOTIFICATION_MOUSE_EXIT and hover != -1:
			hover = -1
			queue_redraw()
		elif what == NOTIFICATION_RESIZED:
			queue_redraw()


class StatPaint extends RefCounted:
	static func tone(hex: String, fallback := Color.WHITE) -> Color:
		return Color.html(hex) if Color.html_is_valid(hex) else fallback
