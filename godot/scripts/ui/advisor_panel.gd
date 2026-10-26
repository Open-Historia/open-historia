class_name AdvisorPanel
extends PanelFrame

signal open_actions
signal open_projects
signal open_chat(country: String, draft: String)
signal open_thread(target: Dictionary, draft: String)
signal focus_point(lng: float, lat: float, zoom: float)
signal width_changed(width: float)
signal open_changed(open: bool)

const SLIDE_SECONDS := 0.35
const PANEL_BG := Color(24 / 255.0, 24 / 255.0, 27 / 255.0, 0.95)
const MIN_WIDTH := 280.0
const DEFAULT_WIDTH := 320.0
const LEFT_CLEARANCE := 376.0
const INITIAL_WINDOW := 12
const WINDOW_STEP := 20
const BLUE := Color("#3b82f6")
const BLUE_HOVER := Color("#2563eb")
const LINK := Color("#60a5fa")
const RED_BG := Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.14)
const RED_BORDER := Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.4)
const RED_INK := Color(254 / 255.0, 202 / 255.0, 202 / 255.0, 0.95)
const GREEN_BG := Color(52 / 255.0, 211 / 255.0, 153 / 255.0, 0.12)
const GREEN_BORDER := Color(52 / 255.0, 211 / 255.0, 153 / 255.0, 0.4)
const GREEN_INK := Color(167 / 255.0, 243 / 255.0, 208 / 255.0, 0.95)
const AMBER_INK := Color(253 / 255.0, 230 / 255.0, 138 / 255.0, 0.95)
const ERROR_INK := Color("#fca5a5")
const MARKER := Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.7)
const SMALL_HEADING := Color(146 / 255.0, 193 / 255.0, 252 / 255.0, 0.9475)
const TABLE_HEAD := Color(129 / 255.0, 184 / 255.0, 251 / 255.0, 0.202)
const CHART_COLORS := ["#60a5fa", "#34d399", "#f472b6", "#fbbf24", "#94a3b8", "#f87171", "#38bdf8"]
const REPORT_REASON := "Saving a bug report is not in the native app yet."
const SAVE_TIP := "Saves the diagnostics log as a file, with this error's details at the top. Attach the file to your bug report."
const COPY_TIP := "Copies this error's details. Diagnostics logging is off — turn it on in Settings → Diagnostics to save the full log instead."
const RETRY_PROJECTS_TEXT := "Continue putting my projects and operations on the board — the last reply was cut off. Pick up from where you stopped and skip anything already on the board. Send no more than ten, one sentence each. Only include efforts that genuinely appear in our history — if everything real is already on the board, just tell me that and add nothing."
const CHECK_SVG := "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='3.2' stroke-linecap='round' stroke-linejoin='round'><path d='M5.5 12.5l4.2 4.2 8.8-9.4'/></svg>"
const RETRY_SVG :="<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><path d='M21 12a9 9 0 1 1-2.64-6.36'/><path d='M21 3v6h-6'/></svg>"
const PARAGRAPH := Vector2(0.0, 8.0)
const HEADING := Vector2(14.4, 6.4)
const LIST := Vector2(4.8, 9.6)
const QUOTE := Vector2(8.8, 8.8)
const RULE := Vector2(13.6, 13.6)
const CODE := Vector2(8.0, 8.0)
const TABLE := Vector2(8.8, 8.8)

static var _italic_fonts := {}
static var _mono_font: Font
static var _svg_cache := {}
static var _re := {}

var engine: EngineLink
var context: Dictionary = {}
var messages: Array = []
var views: Array = []

var _touch := false
var _visible_limit := INITIAL_WINDOW
var _loading := false
var _turn_in_flight := false
var _bootstrapping := false
var _has_bootstrapped := false
var _load_failed := false
var _save_failed := false
var _storage_retrying := false
var _confirming_clear := false
var _auto_scroll := true
var _token := ""
var _live: Dictionary = {}
var _pending_seeds: PackedStringArray = []
var _width := DEFAULT_WIDTH
var _resizing := false
var _handle_hover := false
var _saving := false
var _save_again := false
var _dots := 0
var _logging_on := true
var _chat_dir := ""
var _rows := {}
var _states := {}
var _live_hooks: Array = []
var _build_hooks: Array = []
var _inner_hooks: Array = []

var _clear_button: Button
var _strip_holder: VBoxContainer
var _live_holder: VBoxContainer
var _dots_label: Label
var _dots_timer: Timer
var _input: TextEdit
var _send_button: Button
var _handle: Control
var _handle_bar: Panel
var _handle_style: StyleBoxFlat
var _clear_timer: Timer
var _slide: Tween
var _scroll_tween: Tween


func _init() -> void:
	super._init("Advisor", "", "drawer", DEFAULT_WIDTH)
	_touch = OS.has_feature("mobile")
	set_tint(PANEL_BG)
	_material.set_shader_parameter("radius", 0.0)
	_material.set_shader_parameter("highlight", 0.0)
	_material.set_shader_parameter("border_color", Color(0, 0, 0, 0))
	_material.set_shader_parameter("blur_px", 8.0)
	add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0)))
	modulate.a = 1.0
	anchor_left = 1.0
	anchor_right = 1.0
	anchor_top = 0.0
	anchor_bottom = 1.0
	offset_top = 0.0
	offset_bottom = 0.0
	offset_left = 0.0
	offset_right = DEFAULT_WIDTH
	set_meta("width", DEFAULT_WIDTH)
	_build_header()
	var column: Node = scroll.get_parent()
	_strip_holder = VBoxContainer.new()
	_strip_holder.add_theme_constant_override("separation", 0)
	column.add_child(_strip_holder)
	column.move_child(_strip_holder, scroll.get_index())
	scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_SHOW_NEVER
	scroll.get_v_scroll_bar().value_changed.connect(_on_list_scrolled)
	scroll.resized.connect(_relayout)
	var margin := body.get_parent() as MarginContainer
	for side in ["margin_left", "margin_right", "margin_top", "margin_bottom"]:
		margin.add_theme_constant_override(side, 12)
	body.add_theme_constant_override("separation", 16)
	_live_holder = VBoxContainer.new()
	_live_holder.add_theme_constant_override("separation", 0)
	_live_holder.set_meta("advisor_row", true)
	_live_holder.visible = false
	body.add_child(_live_holder)
	var rule := ColorRect.new()
	rule.color = Color(1, 1, 1, 0.1)
	rule.custom_minimum_size.y = 1
	rule.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.add_child(rule)
	column.add_child(_build_composer())
	_build_handle()
	_dots_timer = Timer.new()
	_dots_timer.wait_time = 0.5
	_dots_timer.timeout.connect(_tick_dots)
	add_child(_dots_timer)
	_clear_timer = Timer.new()
	_clear_timer.one_shot = true
	_clear_timer.wait_time = 4.0
	_clear_timer.timeout.connect(func() -> void:
		_confirming_clear = false
		_style_clear_button())
	add_child(_clear_timer)


func _build_header() -> void:
	var row: HBoxContainer = header_extra.get_parent() as HBoxContainer
	var header := row.get_parent() as MarginContainer
	for side in [["margin_left", 12], ["margin_right", 12], ["margin_top", 11], ["margin_bottom", 11]]:
		header.add_theme_constant_override(side[0], side[1])
	row.add_theme_constant_override("separation", 8)
	var column: Node = header.get_parent()
	var header_rule := column.get_child(header.get_index() + 1) as ColorRect
	if header_rule:
		header_rule.color = Color(1, 1, 1, 0.1)
	var compass := UI.label("🧭", 16, UI.WHITE)
	compass.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(compass)
	row.move_child(compass, 0)
	header_title.add_theme_font_override("font", UI.font(800))
	header_title.add_theme_font_size_override("font_size", 14)
	header_title.add_theme_color_override("font_color", UI.WHITE)
	header_title.get_parent().set("size_flags_vertical", Control.SIZE_SHRINK_CENTER)
	_clear_button = Button.new()
	_clear_button.focus_mode = Control.FOCUS_NONE
	_clear_button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	_clear_button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_clear_button.pressed.connect(_on_clear_pressed)
	header_extra.add_child(_clear_button)
	_style_clear_button()
	var close := row.get_child(row.get_child_count() - 1) as Button
	if close:
		close.icon = null
		close.text = "✕"
		close.flat = false
		close.tooltip_text = "Close advisor"
		close.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		close.add_theme_font_override("font", UI.font(400))
		close.add_theme_font_size_override("font_size", 22)
		var empty := StyleBoxEmpty.new()
		empty.content_margin_left = 8
		for state in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
			close.add_theme_stylebox_override(state, empty)
		for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
			close.add_theme_color_override(name, Color(1, 1, 1, 0.55))
	closed.connect(close_panel)


func setup(link: EngineLink, setup_context: Dictionary = {}) -> void:
	engine = link
	context = setup_context
	if not engine.engine_event.is_connected(_on_engine_event):
		engine.engine_event.connect(_on_engine_event)
	_load_width()


func _ready() -> void:
	get_viewport().size_changed.connect(func() -> void: _apply_width(_width, false))


func open() -> void:
	set_open(true)


func close() -> void:
	set_open(false)


func close_panel() -> void:
	set_open(false)


func set_open(open_state: bool) -> void:
	var changed := _open != open_state
	_open = open_state
	mouse_filter = Control.MOUSE_FILTER_STOP if open_state else Control.MOUSE_FILTER_IGNORE
	if _slide:
		_slide.kill()
	var start := offset_left
	var target := -_width if open_state else 0.0
	_slide = create_tween()
	_slide.tween_method(func(t: float) -> void:
		offset_left = lerp(start, target, ease_slide(t))
		offset_right = offset_left + _width, 0.0, 1.0, SLIDE_SECONDS)
	if changed:
		open_changed.emit(open_state)
	if open_state:
		_ensure_bootstrap()


static func ease_slide(t: float) -> float:
	return _cubic_bezier(t, 0.4, 0.0, 0.2, 1.0)


static func _cubic_bezier(x: float, x1: float, y1: float, x2: float, y2: float) -> float:
	if x <= 0.0:
		return 0.0
	if x >= 1.0:
		return 1.0
	var t := x
	for step in range(10):
		var u := 1.0 - t
		var cx := 3.0 * x1 * u * u * t + 3.0 * x2 * u * t * t + t * t * t - x
		var dx := 3.0 * x1 * u * u + 6.0 * (x2 - x1) * u * t + 3.0 * (1.0 - x2) * t * t
		if abs(cx) < 0.000001 or abs(dx) < 0.000001:
			break
		t = clamp(t - cx / dx, 0.0, 1.0)
	var v := 1.0 - t
	return 3.0 * y1 * v * v * t + 3.0 * y2 * v * t * t + t * t * t


func refresh() -> void:
	if not _has_bootstrapped or engine == null:
		return
	var reply: Dictionary = await engine.request("advisor.notices")
	if reply.get("ok", false):
		var result: Dictionary = reply.get("result", {})
		_apply_flags(result)
		_merge_notices(result.get("notices", []), result.get("views", []))


func reset() -> void:
	messages = []
	views = []
	_live = {}
	_token = ""
	_visible_limit = INITIAL_WINDOW
	_has_bootstrapped = false
	_bootstrapping = false
	_load_failed = false
	_save_failed = false
	_pending_seeds = []
	_input.text = ""
	_resize_input()
	_render_strip()
	_render()


func seed(text: String) -> void:
	if text.is_empty():
		return
	if not _has_bootstrapped:
		_pending_seeds.append(text)
		return
	_apply_seed(text)


func is_loading() -> bool:
	return _loading


func current_width() -> float:
	return _width


func _apply_seed(prompt: String) -> void:
	var current := _input.text
	var typed := current.strip_edges()
	if typed.is_empty():
		_input.text = prompt
	elif typed.contains(prompt.strip_edges()):
		pass
	else:
		_input.text = _regex("\\s+$").sub(current, "") + "\n\n" + prompt
	_input.grab_focus()
	var last_line := _input.get_line_count() - 1
	_input.set_caret_line(last_line)
	_input.set_caret_column(_input.get_line(last_line).length())
	_resize_input()
	_update_send()


func _ensure_bootstrap() -> void:
	if _has_bootstrapped or _bootstrapping or engine == null:
		return
	_bootstrapping = true
	var reply: Dictionary = await engine.request("advisor.load", {"restore": true})
	_bootstrapping = false
	var result: Dictionary = reply.get("result", {}) if reply.get("ok", false) else {"failed": true, "messages": [], "views": []}
	_load_failed = bool(result.get("failed", false))
	_apply_flags(result)
	messages = (result.get("messages", []) as Array).duplicate()
	views = (result.get("views", []) as Array).duplicate()
	while views.size() < messages.size():
		views.append({})
	_has_bootstrapped = true
	_render_strip()
	_render()
	for text in _pending_seeds:
		_apply_seed(text)
	_pending_seeds = []


func _apply_flags(result: Dictionary) -> void:
	if result.has("loggingOn"):
		_logging_on = bool(result["loggingOn"])
	if result.has("chatDir"):
		_chat_dir = str(result["chatDir"])


func _load_width() -> void:
	if engine == null:
		return
	var reply: Dictionary = await engine.request("advisor.width")
	if reply.get("ok", false):
		var saved := float(reply.get("result", 0))
		if saved > 0.0:
			_apply_width(saved, false)


func _on_engine_event(event_name: String, data: Variant) -> void:
	if typeof(data) != TYPE_DICTIONARY:
		return
	var payload: Dictionary = data
	if event_name == "advisor.asked":
		if _token.is_empty() or str(payload.get("token", "")) != _token:
			return
		var asked: Variant = payload.get("message")
		if typeof(asked) == TYPE_DICTIONARY:
			messages.append(asked)
			views.append(payload.get("view", {}))
		elif not messages.is_empty() and str((messages[messages.size() - 1] as Dictionary).get("role", "")) == "error":
			messages.pop_back()
			views.pop_back()
		_auto_scroll = true
		_render()
	elif event_name == "advisor.chunk":
		if _token.is_empty() or str(payload.get("token", "")) != _token:
			return
		_live = {"message": payload.get("message", {}), "view": payload.get("view", {})}
		_render_live()
		_follow()
	elif event_name == "advisor.notices":
		if _has_bootstrapped:
			_merge_notices(payload.get("notices", []), payload.get("views", []))
	elif event_name == "advisor.allowed":
		if _has_bootstrapped:
			_refresh_views()


func _refresh_views() -> void:
	var reply: Dictionary = await engine.request("advisor.views", {"json": _wire(messages)})
	if not reply.get("ok", false):
		return
	var fresh: Array = (reply.get("result", {}) as Dictionary).get("views", [])
	if fresh.size() != messages.size():
		return
	views = fresh
	_render(false)


func _merge_notices(stored: Array, stored_views: Array) -> void:
	var stored_by_id := {}
	for index in range(stored.size()):
		stored_by_id[str((stored[index] as Dictionary).get("id", ""))] = index
	var kept: Array = []
	var kept_views: Array = []
	var present := {}
	var changed := false
	for index in range(messages.size()):
		var message: Dictionary = messages[index]
		if str(message.get("role", "")) != "notice":
			kept.append(message)
			kept_views.append(views[index])
			continue
		var id := str(message.get("id", ""))
		if not stored_by_id.has(id):
			changed = true
			continue
		kept.append(message)
		var at: int = stored_by_id[id]
		var fresh: Dictionary = stored_views[at] if at < stored_views.size() else {}
		if JSON.stringify(fresh) != JSON.stringify(views[index]):
			changed = true
			kept_views.append(fresh)
		else:
			kept_views.append(views[index])
		present[id] = true
	for index in range(stored.size()):
		var notice: Dictionary = stored[index]
		var id := str(notice.get("id", ""))
		if present.has(id):
			continue
		kept.append(notice)
		kept_views.append(stored_views[index] if index < stored_views.size() else {})
		changed = true
	if not changed:
		return
	messages = kept
	views = kept_views
	_render()


func _render_strip() -> void:
	for child in _strip_holder.get_children():
		child.queue_free()
	if _load_failed:
		_strip_holder.add_child(_storage_strip("Could not load your conversation with the advisor.", "Nothing new is saved until it loads.", _retry_load))
	elif _save_failed:
		_strip_holder.add_child(_storage_strip("Your latest messages were not saved.", "They are kept here until a save works.", _retry_save))


func _storage_strip(title: String, detail: String, on_retry: Callable) -> Control:
	var strip := PanelContainer.new()
	var style := UI.box(Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.1), Color(0, 0, 0, 0), 0, 0, Vector4(14, 8, 14, 8))
	style.border_color = Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.35)
	style.border_width_bottom = 1
	strip.add_theme_stylebox_override("panel", style)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	var texts := VBoxContainer.new()
	texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	texts.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	texts.add_theme_constant_override("separation", 2)
	texts.add_child(UI.wrapped(title, 12, Color("#fecaca"), 700))
	if not detail.is_empty():
		texts.add_child(UI.wrapped(detail, 11, Color(254 / 255.0, 202 / 255.0, 202 / 255.0, 0.7)))
	row.add_child(texts)
	var retry := _chip("Retrying…" if _storage_retrying else "Retry", RED_BG, RED_BORDER, RED_INK, 11, 600, Vector4(10, 5, 10, 5))
	retry.icon = _svg(RETRY_SVG, 11, RED_INK)
	retry.disabled = _storage_retrying
	retry.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	retry.pressed.connect(on_retry)
	row.add_child(retry)
	strip.add_child(row)
	return strip


func _retry_load() -> void:
	_storage_retrying = true
	_render_strip()
	var reply: Dictionary = await engine.request("advisor.load", {"restore": false})
	var result: Dictionary = reply.get("result", {}) if reply.get("ok", false) else {}
	if not result.is_empty() and not bool(result.get("failed", true)):
		_load_failed = false
		var saved: Array = result.get("messages", [])
		var saved_views: Array = result.get("views", [])
		var stored_ids := {}
		for entry in saved:
			var id := str((entry as Dictionary).get("id", ""))
			if not id.is_empty():
				stored_ids[id] = true
		var merged: Array = saved.duplicate()
		var merged_views: Array = saved_views.duplicate()
		while merged_views.size() < merged.size():
			merged_views.append({})
		var said := 0
		for index in range(messages.size()):
			var message: Dictionary = messages[index]
			var id := str(message.get("id", ""))
			if not id.is_empty() and stored_ids.has(id):
				continue
			merged.append(message)
			merged_views.append(views[index])
			said += 1
		messages = merged
		views = merged_views
		_render()
		await engine.request("advisor.history", {"json": _wire(messages)})
		if said > 0:
			await _save()
	_storage_retrying = false
	_render_strip()


func _retry_save() -> void:
	_storage_retrying = true
	_render_strip()
	await _save()
	_storage_retrying = false
	_render_strip()


func _save() -> void:
	if _saving:
		_save_again = true
		return
	_saving = true
	while true:
		_save_again = false
		var reply: Dictionary = await engine.request("advisor.save", {"json": _wire(messages)})
		if reply.get("ok", false):
			var result: Dictionary = reply.get("result", {})
			if not bool(result.get("blocked", false)):
				_set_save_failed(not bool(result.get("saved", false)))
		else:
			_set_save_failed(true)
		if not _save_again:
			break
	_saving = false


func _set_save_failed(failed: bool) -> void:
	if _save_failed == failed:
		return
	_save_failed = failed
	_render_strip()


func _style_clear_button() -> void:
	if _confirming_clear:
		_clear_button.text = "Clear?"
		_clear_button.tooltip_text = "Tap again to clear the chat"
		var style := UI.box(Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.18), Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.55), 8, 1, Vector4(10, 2, 10, 2))
		for state in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
			_clear_button.add_theme_stylebox_override(state, style)
		_clear_button.add_theme_font_override("font", UI.font(600))
		_clear_button.add_theme_font_size_override("font_size", 13)
		for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
			_clear_button.add_theme_color_override(name, Color("#fca5a5"))
	else:
		_clear_button.text = "🗑"
		_clear_button.tooltip_text = "Clear chat"
		var empty := StyleBoxEmpty.new()
		for state in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
			_clear_button.add_theme_stylebox_override(state, empty)
		_clear_button.add_theme_font_override("font", UI.font(400))
		_clear_button.add_theme_font_size_override("font_size", 22)
		for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
			_clear_button.add_theme_color_override(name, Color(1, 1, 1, 0.4))


func _on_clear_pressed() -> void:
	if _touch and not _confirming_clear:
		_confirming_clear = true
		_style_clear_button()
		_clear_timer.start()
		return
	_confirming_clear = false
	_clear_timer.stop()
	_style_clear_button()
	messages = []
	views = []
	_render()
	if engine == null:
		return
	var reply: Dictionary = await engine.request("advisor.clear")
	if reply.get("ok", false):
		var result: Dictionary = reply.get("result", {})
		if not bool(result.get("blocked", false)):
			_set_save_failed(not bool(result.get("saved", false)))
	else:
		_set_save_failed(true)


func _build_composer() -> Control:
	var margin := MarginContainer.new()
	for side in ["margin_left", "margin_right", "margin_top", "margin_bottom"]:
		margin.add_theme_constant_override(side, 16)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	_input = TextEdit.new()
	_input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_input.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_input.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	_input.placeholder_text = "Ask your advisor…" if _touch else "Ask your advisor…  (Shift+Enter for a new line)"
	_input.add_theme_font_override("font", UI.font(400))
	_input.add_theme_font_size_override("font_size", 14)
	_input.add_theme_constant_override("line_spacing", int(round(21.0 - UI.font(400).get_height(14))))
	_input.add_theme_color_override("font_color", UI.WHITE)
	_input.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.4))
	_input.add_theme_color_override("caret_color", UI.WHITE)
	_input.add_theme_color_override("selection_color", Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.45))
	var normal := UI.box(Color(0, 0, 0, 0.2), Color(1, 1, 1, 0.15), 10, 1, Vector4(12, 9, 12, 9))
	var focus := UI.box(Color(0, 0, 0, 0.2), Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.6), 10, 1, Vector4(12, 9, 12, 9))
	_input.add_theme_stylebox_override("normal", normal)
	_input.add_theme_stylebox_override("read_only", normal)
	_input.add_theme_stylebox_override("focus", focus)
	_input.get_v_scroll_bar().modulate.a = 0.0
	_input.text_changed.connect(func() -> void:
		_resize_input()
		_update_send())
	_input.gui_input.connect(_on_input_key)
	_input.resized.connect(func() -> void: _resize_input.call_deferred())
	row.add_child(_input)
	_send_button = Button.new()
	_send_button.text = "🚀"
	_send_button.focus_mode = Control.FOCUS_NONE
	_send_button.custom_minimum_size = Vector2(40, 40)
	_send_button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_send_button.add_theme_font_override("font", UI.font(400))
	_send_button.add_theme_font_size_override("font_size", 16)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color", "font_disabled_color"]:
		_send_button.add_theme_color_override(name, UI.WHITE)
	_send_button.add_theme_stylebox_override("normal", UI.box(BLUE, Color(0, 0, 0, 0), 10, 0))
	_send_button.add_theme_stylebox_override("hover", UI.box(BLUE_HOVER, Color(0, 0, 0, 0), 10, 0))
	_send_button.add_theme_stylebox_override("pressed", UI.box(BLUE_HOVER, Color(0, 0, 0, 0), 10, 0))
	_send_button.add_theme_stylebox_override("hover_pressed", UI.box(BLUE_HOVER, Color(0, 0, 0, 0), 10, 0))
	_send_button.add_theme_stylebox_override("focus", UI.box(BLUE, Color(0, 0, 0, 0), 10, 0))
	_send_button.add_theme_stylebox_override("disabled", UI.box(Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.4), Color(0, 0, 0, 0), 10, 0))
	_send_button.pressed.connect(_send_from_composer)
	row.add_child(_send_button)
	margin.add_child(row)
	_resize_input()
	_update_send()
	return margin


func _resize_input() -> void:
	if _input == null:
		return
	var lines := 0
	for line in range(_input.get_line_count()):
		lines += _input.get_line_wrap_count(line) + 1
	var room := _input.size.x - 24.0
	if _input.text.is_empty() and room > 0.0:
		var font := UI.font(400)
		var wrapped := font.get_multiline_string_size(_input.placeholder_text, HORIZONTAL_ALIGNMENT_LEFT, room, 14, -1, TextServer.BREAK_MANDATORY | TextServer.BREAK_WORD_BOUND)
		lines = max(lines, int(round(wrapped.y / max(1.0, font.get_height(14)))))
	var height := float(max(1, lines)) * float(_input.get_line_height()) + 18.0 + 2.0
	_input.custom_minimum_size.y = min(height, 300.0)


func _update_send() -> void:
	if _send_button == null:
		return
	var blocked := _loading or _input.text.strip_edges().is_empty()
	_send_button.disabled = blocked
	_send_button.mouse_default_cursor_shape = Control.CURSOR_FORBIDDEN if blocked else Control.CURSOR_POINTING_HAND


func _on_input_key(event: InputEvent) -> void:
	if not (event is InputEventKey):
		return
	var key := event as InputEventKey
	if not key.pressed or key.shift_pressed or _touch:
		return
	if key.keycode != KEY_ENTER and key.keycode != KEY_KP_ENTER:
		return
	if _input.has_ime_text():
		return
	_input.accept_event()
	_send_from_composer()


func _send_from_composer() -> void:
	var text := _input.text.strip_edges()
	if text.is_empty() or _turn_in_flight:
		return
	_input.text = ""
	_resize_input()
	_update_send()
	_run_turn(text, false)


func _retry_turn() -> void:
	var question := ""
	for index in range(messages.size() - 1, -1, -1):
		var message: Dictionary = messages[index]
		if str(message.get("role", "")) == "user":
			question = str(message.get("text", ""))
			break
	if question.is_empty():
		return
	_run_turn(question, true)


func _run_turn(text: String, retry: bool) -> void:
	if text.is_empty() or _turn_in_flight or engine == null:
		return
	_turn_in_flight = true
	_set_loading(true)
	await _ask(text, retry)
	_turn_in_flight = false
	_set_loading(false)


func _set_loading(loading: bool) -> void:
	_loading = loading
	_update_send()
	_render(false)


func _ask(text: String, retry: bool) -> void:
	_token = "%d-%d" % [Time.get_ticks_usec(), randi()]
	var token := _token
	_auto_scroll = true
	var reply: Dictionary = await engine.request("advisor.ask", {"text": text, "json": _wire(messages), "retry": retry, "token": token})
	if token != _token:
		return
	_token = ""
	_live = {}
	if not reply.get("ok", false):
		var failed := {"role": "error", "text": str(reply.get("error", "")), "time": ""}
		messages.append(failed)
		views.append({"text": failed["text"], "md": failed["text"], "details": "Message: " + str(failed["text"]), "hasDetail": false, "date": ""})
		_render()
		_save()
		return
	var result: Dictionary = reply.get("result", {})
	if bool(result.get("dropped", false)):
		_render()
		return
	if result.has("message"):
		messages.append(result["message"])
		views.append(result.get("view", {}))
	elif result.has("error"):
		messages.append(result["error"])
		views.append(result.get("view", {}))
	_render()
	_save()


func _tick_dots() -> void:
	_dots = (_dots + 1) % 4
	if is_instance_valid(_dots_label):
		_dots_label.text = "Thinking" + ".".repeat(_dots) + " "


func _on_list_scrolled(_value: float) -> void:
	if _scroll_tween and _scroll_tween.is_running():
		return
	var bar := scroll.get_v_scroll_bar()
	_auto_scroll = bar.max_value - bar.page - bar.value < 60.0


func _follow() -> void:
	if not _auto_scroll or not is_inside_tree():
		return
	await get_tree().process_frame
	await get_tree().process_frame
	if not _auto_scroll or not is_inside_tree():
		return
	var bar := scroll.get_v_scroll_bar()
	var target := int(max(0.0, bar.max_value - bar.page))
	if target == scroll.scroll_vertical:
		return
	if _scroll_tween:
		_scroll_tween.kill()
	_scroll_tween = create_tween().set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN_OUT)
	_scroll_tween.tween_property(scroll, "scroll_vertical", target, 0.3)


func _list_width() -> float:
	var width := scroll.size.x
	if width <= 0.0:
		width = _width - 1.0
	return max(120.0, width - 24.0)


func _relayout() -> void:
	var available := _list_width()
	for key in _rows.keys():
		var entry: Dictionary = _rows[key]
		for hook in entry.get("hooks", []):
			(hook as Callable).call(available)
	for hook in _live_hooks:
		(hook as Callable).call(available)


func _state(key: String) -> Dictionary:
	if not _states.has(key):
		_states[key] = {}
	return _states[key]


func _view_at(index: int) -> Dictionary:
	if index < views.size() and typeof(views[index]) == TYPE_DICTIONARY:
		return views[index]
	return {}


func _render(follow := true) -> void:
	for child in body.get_children():
		body.remove_child(child)
		if not child.has_meta("advisor_row"):
			child.queue_free()
	if messages.is_empty():
		var empty := _rich(_escape("No messages yet. Ask your advisor something!"), 14, Color(1, 1, 1, 0.5), 1.5)
		body.add_child(empty)
	if messages.size() > _visible_limit:
		var hidden: int = min(messages.size() - _visible_limit, WINDOW_STEP)
		var earlier := _chip("Show 1 earlier message" if hidden == 1 else "Show %d earlier messages" % hidden, Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.09), Color(1, 1, 1, 0.58), 11, 400, Vector4(10, 6, 10, 6), 999)
		earlier.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
		earlier.pressed.connect(func() -> void:
			_visible_limit += WINDOW_STEP
			_render(false))
		body.add_child(earlier)
	var used := {}
	var last := messages.size() - 1
	for index in range(max(0, messages.size() - _visible_limit), messages.size()):
		var message: Dictionary = messages[index]
		var view := _view_at(index)
		var notice := str(message.get("role", "")) == "notice"
		var id := str(message.get("id", ""))
		var key := ("n:" + id) if notice and not id.is_empty() else "i:%d" % index
		var kind := "notice" if notice else "row"
		var retry_here := index == last and str(message.get("role", "")) == "error"
		var entry: Dictionary = _rows.get(key, {})
		var stale := entry.is_empty() \
			or str(entry["kind"]) != kind \
			or not is_same(entry["message"], message) \
			or not is_same(entry["view"], view) \
			or bool(entry["retry"]) != retry_here \
			or (not notice and bool(entry["loading"]) != _loading) \
			or str(entry["dir"]) != _chat_dir
		if stale:
			if not entry.is_empty():
				if is_instance_valid(entry["control"]):
					(entry["control"] as Node).queue_free()
				if str(entry["kind"]) != kind:
					_states.erase(key)
			_build_hooks = []
			var control: Control = _notice_row(message, view, _state(key)) if notice else _message_row(message, view, index, retry_here, _state(key))
			control.set_meta("advisor_row", true)
			entry = {"kind": kind, "message": message, "view": view, "retry": retry_here, "loading": _loading, "dir": _chat_dir, "control": control, "hooks": _build_hooks}
			_build_hooks = []
			_rows[key] = entry
		used[key] = true
		body.add_child(entry["control"])
	var live_key := "i:%d" % messages.size()
	for key in _rows.keys():
		if used.has(key):
			continue
		var gone: Dictionary = _rows[key]
		if is_instance_valid(gone["control"]):
			(gone["control"] as Node).queue_free()
		_rows.erase(key)
		if key != live_key:
			_states.erase(key)
	for key in _states.keys():
		if not used.has(key) and key != live_key:
			_states.erase(key)
	body.add_child(_live_holder)
	_render_live()
	_relayout()
	if follow:
		_follow()


func _render_live() -> void:
	for child in _live_holder.get_children():
		_live_holder.remove_child(child)
		child.queue_free()
	_live_hooks = []
	if not _live.is_empty():
		_build_hooks = []
		var index := messages.size()
		_live_holder.add_child(_message_row(_live.get("message", {}), _live.get("view", {}), index, false, _state("i:%d" % index)))
		_live_hooks = _build_hooks
		_build_hooks = []
		var available := _list_width()
		for hook in _live_hooks:
			(hook as Callable).call(available)
		_set_dots(false)
	elif _loading:
		_live_holder.add_child(_thinking_row())
		_set_dots(true)
	else:
		_set_dots(false)
	_live_holder.visible = _live_holder.get_child_count() > 0


func _set_dots(running: bool) -> void:
	if running:
		if _dots_timer.is_stopped():
			_dots_timer.start()
	else:
		_dots_timer.stop()
		_dots_label = null


func _thinking_row() -> Control:
	var row := VBoxContainer.new()
	row.add_theme_constant_override("separation", 4)
	row.add_child(_tagged("🧭", " Advisor", 11, Color(1, 1, 1, 0.4)))
	var bubble := PanelContainer.new()
	var style := UI.box(Color(1, 1, 1, 0.08), Color(0, 0, 0, 0), 12, 0, Vector4(14, 10, 14, 10))
	style.corner_radius_bottom_left = 4
	bubble.add_theme_stylebox_override("panel", style)
	bubble.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	if _dots_timer.is_stopped():
		_dots = 0
	_dots_label = UI.label("Thinking" + ".".repeat(_dots) + " ", 14, Color(1, 1, 1, 0.6))
	bubble.add_child(_dots_label)
	row.add_child(bubble)
	return row


func _gap(height: float) -> Control:
	var gap := Control.new()
	gap.custom_minimum_size.y = height
	gap.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return gap


func _tagged(emoji: String, text: String, size: int, color: Color, weight := 400) -> HBoxContainer:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 0)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var glyph := UI.label(emoji, size, UI.WHITE, weight)
	row.add_child(glyph)
	var words := UI.label(text, size, color, weight)
	row.add_child(words)
	return row


func _message_row(message: Dictionary, view: Dictionary, index: int, retry_here: bool, state: Dictionary) -> Control:
	var role := str(message.get("role", ""))
	var user := role == "user"
	var row := VBoxContainer.new()
	row.add_theme_constant_override("separation", 0)
	var catch_label := str(message.get("catchUpLabel", ""))
	if user and not catch_label.is_empty():
		var tag := _rich("[center]%s[/center]" % _emoji_first("⏳", " " + catch_label), 11, Color(1, 1, 1, 0.38))
		tag.tooltip_text = str(message.get("catchUp", ""))
		tag.selection_enabled = false
		row.add_child(tag)
		row.add_child(_gap(7.2))
	if not user:
		row.add_child(_tagged("⚠️" if role == "error" else "🧭", " Error" if role == "error" else " Advisor", 11, Color(1, 1, 1, 0.4)))
		row.add_child(_gap(4))
	var bubble := PanelContainer.new()
	var bg := BLUE if user else (Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.2) if role == "error" else Color(1, 1, 1, 0.08))
	var border := Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.3) if role == "error" else Color(0, 0, 0, 0)
	var style := UI.box(bg, border, 12, 1, Vector4(14, 10, 14, 10))
	if user:
		style.corner_radius_bottom_right = 2
	else:
		style.corner_radius_bottom_left = 2
	bubble.add_theme_stylebox_override("panel", style)
	bubble.size_flags_horizontal = Control.SIZE_SHRINK_END if user else Control.SIZE_SHRINK_BEGIN
	if role == "advisor" and not _chat_dir.is_empty():
		bubble.layout_direction = Control.LAYOUT_DIRECTION_RTL if _chat_dir == "rtl" else Control.LAYOUT_DIRECTION_LTR
	var content := VBoxContainer.new()
	content.add_theme_constant_override("separation", 0)
	bubble.add_child(content)
	_inner_hooks = []
	var natural := 0.0
	var full := false
	var text := str(view.get("text", message.get("text", "")))
	if user:
		content.add_child(_rich(_escape(text), 14, UI.WHITE, 1.5))
		natural = _line_width(text, 14)
	else:
		var drafts: Array = view.get("messageDrafts", []) if typeof(view.get("messageDrafts")) == TYPE_ARRAY else []
		var markdown := str(view.get("md", text))
		content.add_child(_reply_body(markdown, drafts, view.get("segments", null), state))
		natural = _markdown_width(markdown)
		if not drafts.is_empty():
			full = true
	var streaming := bool(message.get("streaming", false))
	var chart: Variant = view.get("chartConfig", null)
	if typeof(chart) == TYPE_DICTIONARY:
		content.add_child(_gap(12))
		content.add_child(_chart(chart))
		full = true
	var chart_problem := str(view.get("chartProblem", ""))
	if not chart_problem.is_empty() and not streaming:
		content.add_child(_gap(9.6))
		var sentence := " The chart could not be drawn: %s." % chart_problem
		content.add_child(_rich(_emoji_first("📉", sentence), 12, Color(1, 1, 1, 0.45), 1.5))
		natural = max(natural, _line_width("📉" + sentence, 12))
	if typeof(message.get("actionsSummary")) == TYPE_ARRAY:
		content.add_child(_gap(12))
		content.add_child(_actions_card(message["actionsSummary"]))
		full = true
	if typeof(message.get("projectsSummary")) == TYPE_ARRAY:
		content.add_child(_gap(12))
		content.add_child(_projects_card(message["projectsSummary"]))
		full = true
	if not str(message.get("projectsProblem", "")).is_empty():
		content.add_child(_gap(12))
		content.add_child(_projects_problem(message, state))
		full = true
	if role == "error":
		content.add_child(_gap(8))
		var details := _error_details(view, retry_here, state)
		content.add_child(details)
		natural = max(natural, float(details.get_meta("natural", 0.0)))
	var institution: Array = view.get("institutionDrafts", []) if typeof(view.get("institutionDrafts")) == TYPE_ARRAY else []
	if not institution.is_empty():
		content.add_child(_gap(12))
		var completed: Array = message.get("completedInstitutionDrafts", []) if typeof(message.get("completedInstitutionDrafts")) == TYPE_ARRAY else []
		var stack := VBoxContainer.new()
		stack.add_theme_constant_override("separation", 6)
		for draft_index in range(institution.size()):
			stack.add_child(_institution_action(institution[draft_index], index, draft_index, _has_number(completed, draft_index), state))
		content.add_child(stack)
		full = true
	var deployments: Array = view.get("deployments", []) if typeof(view.get("deployments")) == TYPE_ARRAY else []
	if not deployments.is_empty():
		content.add_child(_gap(12))
		var placed: Array = message.get("placedDeployments", []) if typeof(message.get("placedDeployments")) == TYPE_ARRAY else []
		var stack := VBoxContainer.new()
		stack.add_theme_constant_override("separation", 6)
		for deployment in deployments:
			var entry: Dictionary = deployment
			stack.add_child(_deploy_action(entry, index, _has_number(placed, int(entry.get("index", 0))), state))
		content.add_child(stack)
		full = true
	row.add_child(bubble)
	var fixed := 100000.0 if full else natural + 28.0 + 2.0
	var wide_when_open := role == "error" and bool(view.get("hasDetail", false))
	_register_bubble(bubble, func() -> float:
		return 100000.0 if wide_when_open and bool(state.get("details_open", false)) else fixed, _inner_hooks)
	_inner_hooks = []
	var date := str(view.get("date", ""))
	if not user and not str(message.get("time", "")).is_empty() and not date.is_empty():
		row.add_child(_gap(4))
		row.add_child(UI.label(date, 10, Color(1, 1, 1, 0.3)))
	return row


func _register_bubble(bubble: Control, natural: Callable, inner: Array) -> void:
	_build_hooks.append(func(available: float) -> void:
		if not is_instance_valid(bubble):
			return
		var width: float = min(float(natural.call()), available * 0.9)
		bubble.custom_minimum_size.x = width
		for hook in inner:
			(hook as Callable).call(width - 28.0))


func _emoji_first(emoji: String, text: String) -> String:
	return "[color=#ffffffff]%s[/color]%s" % [emoji, _escape(text)]


func _has_number(values: Array, wanted: int) -> bool:
	for value in values:
		if (typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT) and int(value) == wanted:
			return true
	return false


func _line_width(text: String, size: int) -> float:
	var widest := 0.0
	for line in text.split("\n"):
		widest = max(widest, UI.font(400).get_string_size(line, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x)
	return ceil(widest) + 2.0


func _markdown_width(markdown: String) -> float:
	var widest := 0.0
	for raw in markdown.split("\n"):
		var line := raw
		var size := 14
		var extra := 0.0
		var heading := _regex("^\\s{0,3}(#{1,6})\\s+(.*)$").search(line)
		if heading:
			var level := heading.get_string(1).length()
			size = [16, 15, 14, 12, 12, 12][level - 1]
			line = heading.get_string(2)
			if level >= 4:
				line = line.to_upper()
		var item := _regex("^(\\s*)([-*+]|\\d+[.)])\\s+(.*)$").search(line)
		if item and not heading:
			extra = 18.4 * (1.0 + floor(item.get_string(1).length() / 2.0))
			line = item.get_string(3)
		if line.begins_with(">"):
			extra = 24.0
			line = line.substr(1)
		var width := extra
		var bold := false
		for piece in line.replace("__", "**").split("**"):
			var plain := piece.replace("`", "").replace("~~", "").replace("*", "").replace("_", "")
			plain = _regex("!?\\[([^\\]]*)\\]\\([^)]*\\)").sub(plain, "$1", true)
			width += UI.font(700 if bold or heading != null else 400).get_string_size(plain, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
			bold = not bold
		widest = max(widest, width)
	return ceil(widest) + 2.0


func _reply_body(markdown: String, drafts: Array, segments: Variant, state: Dictionary) -> Control:
	if drafts.is_empty() or typeof(segments) != TYPE_ARRAY:
		return _markdown(markdown)
	var by_quote := {}
	for draft_index in range(drafts.size()):
		var draft: Dictionary = drafts[draft_index]
		var quote: Variant = draft.get("quoteIndex")
		if typeof(quote) != TYPE_INT and typeof(quote) != TYPE_FLOAT:
			continue
		var key := int(quote)
		if not by_quote.has(key):
			by_quote[key] = []
		(by_quote[key] as Array).append(draft_index)
	var placed := {}
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 8)
	for segment in segments:
		var part: Dictionary = segment
		column.add_child(_markdown(str(part.get("md", part.get("content", "")))))
		if str(part.get("type", "")) == "quote":
			for draft_index in by_quote.get(int(part.get("quoteIndex", -1)), []):
				placed[int(draft_index)] = true
				column.add_child(_draft_button(drafts[int(draft_index)], int(draft_index), state))
	for draft_index in range(drafts.size()):
		if not placed.has(draft_index):
			column.add_child(_draft_button(drafts[draft_index], draft_index, state))
	return column


func _chip(text: String, bg: Color, border: Color, ink: Color, size := 11, weight := 600, pad := Vector4(8, 3, 8, 3), radius := 6) -> Button:
	var button := Button.new()
	button.text = text
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	button.add_theme_font_override("font", UI.font(weight))
	button.add_theme_font_size_override("font_size", size)
	button.add_theme_constant_override("h_separation", 5)
	_restyle_chip(button, bg, border, ink, pad, radius)
	return button


func _restyle_chip(button: Button, bg: Color, border: Color, ink: Color, pad: Vector4, radius := 8) -> void:
	var normal := UI.box(bg, border, radius, 1, pad)
	for state in ["normal", "focus", "disabled", "hover", "pressed", "hover_pressed"]:
		button.add_theme_stylebox_override(state, normal)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color", "font_disabled_color"]:
		button.add_theme_color_override(name, ink)
	for name in ["icon_normal_color", "icon_hover_color", "icon_pressed_color", "icon_focus_color", "icon_hover_pressed_color", "icon_disabled_color"]:
		button.add_theme_color_override(name, UI.WHITE)


func _report_button(tone: Color, ink: Color) -> Button:
	var button := _chip("💾 Save logging file" if _logging_on else "Copy for a bug report", Color(0, 0, 0, 0), tone, ink)
	UI.set_disabled_look(button, REPORT_REASON)
	return button


func _bullet_line(bbcode: String, size: int, color: Color) -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 0)
	var dot := UI.label("• ", size, color)
	dot.custom_minimum_size.x = 17.6
	dot.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	dot.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	dot.add_theme_constant_override("line_spacing", 0)
	var lead := StyleBoxEmpty.new()
	lead.content_margin_top = _half_leading(size, 1.5)
	dot.add_theme_stylebox_override("normal", lead)
	row.add_child(dot)
	var text := _rich(bbcode, size, color, 1.5)
	text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(text)
	return row


func _card(bg: Color, border: Color) -> PanelContainer:
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", UI.box(bg, border, 10, 1, Vector4(13, 10, 13, 10)))
	return card


func _summary_of(items: Array, order: Array) -> String:
	var counts := {}
	for item in items:
		var change := str((item as Dictionary).get("change", ""))
		counts[change] = int(counts.get(change, 0)) + 1
	var parts: PackedStringArray = []
	for change in order:
		if counts.has(change):
			parts.append("%d %s" % [int(counts[change]), change])
	return ", ".join(parts)


func _card_header(title: String, color: Color, button_text: String, button_border: Color, button_ink: Color, on_press: Callable) -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	var label := UI.wrapped(title, 12, color, 700)
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(label)
	var button := _chip(button_text, Color(0, 0, 0, 0), button_border, button_ink)
	button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	button.pressed.connect(on_press)
	row.add_child(button)
	return row


func _actions_card(items: Array) -> Control:
	var card := _card(Color(1, 1, 1, 0.08), Color(1, 1, 1, 0.15))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	column.add_child(_card_header("📋 Actions " + _summary_of(items, ["added", "updated", "removed"]), Color("#f4f4f5"), "Open Actions", Color(1, 1, 1, 0.25), Color("#e4e4e7"), func() -> void: open_actions.emit()))
	column.add_child(_gap(6.4))
	for item in items:
		var entry: Dictionary = item
		var change := str(entry.get("change", ""))
		var verb := "Removed: " if change == "removed" else ("Updated: " if change == "updated" else "Added: ")
		column.add_child(_bullet_line(_escape(verb + str(entry.get("title", ""))), 12, Color(1, 1, 1, 0.75)))
	card.add_child(column)
	return card


func _projects_card(items: Array) -> Control:
	var card := _card(Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.1), Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.3))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	column.add_child(_card_header("🎯 Projects " + _summary_of(items, ["opened", "updated", "completed", "closed", "deferred"]), Color(191 / 255.0, 219 / 255.0, 254 / 255.0, 0.95), "Open Projects", Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.5), Color(191 / 255.0, 219 / 255.0, 254 / 255.0, 0.9), func() -> void: open_projects.emit()))
	column.add_child(_gap(6.4))
	var verbs := {"opened": "Opened: ", "updated": "Updated: ", "completed": "Completed: ", "closed": "Closed: ", "deferred": "Awaiting the simulation: "}
	for item in items:
		var entry: Dictionary = item
		var change := str(entry.get("change", ""))
		var line := _escape(str(verbs.get(change, "Changed: ")) + str(entry.get("title", "")))
		if change == "deferred":
			line += "[color=#fcd34de6] — this one changes the world, so the next time skip enacts it[/color]"
		column.add_child(_bullet_line(line, 12, Color(1, 1, 1, 0.75)))
	card.add_child(column)
	return card


func _projects_problem(message: Dictionary, state: Dictionary) -> Control:
	var kind := str(message.get("projectsProblem", ""))
	var detail := str(message.get("projectsDetail", ""))
	var excerpt := str(message.get("projectsExcerpt", ""))
	var text := "The advisor tried to change the board but its instructions could not be read, so nothing was applied. Asking again usually fixes it."
	if kind == "truncated":
		text = "That reply was cut off partway through, so only the entries that arrived complete were added. Ask for the rest to continue the board."
	elif kind == "truncated-empty":
		text = "That reply was cut off before a single entry finished, so nothing could be added. Ask again for a shorter batch — around ten at a time works."
	elif kind == "partial":
		text = "Most of that batch went on the board. A few entries were written in a way that could not be read and were skipped — ask for those again."
	var card := _card(Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.1), Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.35))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	column.add_child(UI.wrapped("⚠ Board not fully updated", 12, AMBER_INK, 700))
	column.add_child(_gap(4.8))
	column.add_child(_rich(_escape(text), 12, Color(1, 1, 1, 0.75), 1.5))
	if not detail.is_empty():
		column.add_child(_gap(4.8))
		column.add_child(_rich(_escape(detail), 11, Color(1, 1, 1, 0.4), 1.45))
	var buttons := HFlowContainer.new()
	buttons.add_theme_constant_override("h_separation", 6)
	buttons.add_theme_constant_override("v_separation", 6)
	var ask := _chip("Ask for the next batch", Color(0, 0, 0, 0), Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.5), AMBER_INK)
	ask.pressed.connect(func() -> void:
		_input.text = RETRY_PROJECTS_TEXT
		_input.grab_focus()
		_resize_input()
		_update_send())
	buttons.add_child(ask)
	var pre: Control = null
	if not excerpt.is_empty():
		var open := bool(state.get("broke_open", false))
		var toggle := _chip(("Hide" if open else "Show") + " what broke", Color(0, 0, 0, 0), Color(1, 1, 1, 0.2), Color(1, 1, 1, 0.6))
		buttons.add_child(toggle)
		buttons.add_child(_report_button(Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.5), AMBER_INK))
		pre = _pre(excerpt, 144.0, 8.0)
		pre.visible = open
		toggle.pressed.connect(func() -> void:
			state["broke_open"] = not bool(state.get("broke_open", false))
			pre.visible = bool(state["broke_open"])
			toggle.text = ("Hide" if pre.visible else "Show") + " what broke")
	column.add_child(_gap(8))
	column.add_child(buttons)
	if pre:
		column.add_child(pre)
	card.add_child(column)
	return card


func _pre(text: String, max_height: float, top: float) -> Control:
	var holder := VBoxContainer.new()
	holder.add_theme_constant_override("separation", 0)
	holder.add_child(_gap(top))
	var box := PanelContainer.new()
	box.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0.35), Color(0, 0, 0, 0), 6, 0, Vector4(8, 8, 8, 8)))
	var area := ScrollContainer.new()
	area.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	var label := _rich(_escape(text), 10, Color(1, 1, 1, 0.6), 1.45)
	label.add_theme_font_override("normal_font", _mono())
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	area.add_child(label)
	box.add_child(area)
	holder.add_child(box)
	label.resized.connect(func() -> void:
		area.custom_minimum_size.y = min(label.get_combined_minimum_size().y, max_height - 16.0))
	return holder


func _error_details(view: Dictionary, retry_here: bool, state: Dictionary) -> Control:
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	var buttons := HFlowContainer.new()
	buttons.add_theme_constant_override("h_separation", 6)
	buttons.add_theme_constant_override("v_separation", 6)
	var natural := 0.0
	if retry_here:
		var retry := _chip("Retrying…" if _loading else "Retry", RED_BG, RED_BORDER, RED_INK, 11, 700, Vector4(9, 3, 9, 3))
		retry.icon = _svg(RETRY_SVG, 11, RED_INK)
		retry.disabled = _loading
		if _loading:
			retry.modulate.a = 0.6
			retry.mouse_default_cursor_shape = Control.CURSOR_ARROW
		retry.pressed.connect(_retry_turn)
		buttons.add_child(retry)
	buttons.add_child(_report_button(Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.45), RED_INK))
	var details: VBoxContainer = null
	if bool(view.get("hasDetail", false)):
		var open := bool(state.get("details_open", false))
		var toggle := _chip("Hide details" if open else "Show details", Color(0, 0, 0, 0), Color(1, 1, 1, 0.2), Color(1, 1, 1, 0.6))
		buttons.add_child(toggle)
		details = VBoxContainer.new()
		details.add_theme_constant_override("separation", 0)
		details.add_child(_gap(6.4))
		details.add_child(_rich(_escape("No API key or endpoint is included. The model's own output is, so this may quote your campaign."), 10, Color(1, 1, 1, 0.35), 1.4))
		details.add_child(_pre(str(view.get("details", "")), 192.0, 5.6))
		details.visible = open
		toggle.pressed.connect(func() -> void:
			state["details_open"] = not bool(state.get("details_open", false))
			details.visible = bool(state["details_open"])
			toggle.text = "Hide details" if details.visible else "Show details"
			_relayout())
	for child in buttons.get_children():
		natural += (child as Control).get_combined_minimum_size().x + 6.0
	column.set_meta("natural", natural - 6.0)
	column.add_child(buttons)
	if details:
		column.add_child(details)
	return column


func _draft_label(draft: Dictionary) -> String:
	var target := str(draft.get("targetType", ""))
	if target == "institution-council":
		return "✉️ Draft to Council · %s" % str(draft.get("institutionId", ""))
	if target == "institution-lifecycle":
		var who := str(draft.get("country", ""))
		return "✉️ Draft to hearing · %s" % (who if not who.is_empty() else str(draft.get("institutionId", "")))
	return "✉️ Draft to %s" % str(draft.get("country", ""))


func _draft_button(draft: Dictionary, draft_index: int, row_state: Dictionary) -> Control:
	var states: Dictionary = row_state.get("drafts", {})
	row_state["drafts"] = states
	if not states.has(draft_index):
		states[draft_index] = {"until": 0}
	var st: Dictionary = states[draft_index]
	var pad := Vector4(10, 6, 10, 6)
	var button := _chip(_draft_label(draft), Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.16), Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.45), Color(191 / 255.0, 219 / 255.0, 254 / 255.0, 0.95), 12, 600, pad, 8)
	var apply := func() -> void:
		if not is_instance_valid(button):
			return
		var handed: bool = Time.get_ticks_msec() < int(st.get("until", 0))
		button.text = "✓ In Diplomacy — press send there" if handed else _draft_label(draft)
		if handed:
			_restyle_chip(button, GREEN_BG, GREEN_BORDER, GREEN_INK, pad)
		else:
			_restyle_chip(button, Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.16), Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.45), Color(191 / 255.0, 219 / 255.0, 254 / 255.0, 0.95), pad)
	st["apply"] = apply
	apply.call()
	button.pressed.connect(func() -> void:
		_hand_off(draft)
		st["until"] = Time.get_ticks_msec() + 3000
		(st["apply"] as Callable).call()
		var stamp: int = st["until"]
		get_tree().create_timer(3.0).timeout.connect(func() -> void:
			if int(st.get("until", 0)) == stamp:
				(st["apply"] as Callable).call()))
	return button


func _hand_off(draft: Dictionary) -> void:
	var target_type := str(draft.get("targetType", "private"))
	var text := str(draft.get("text", ""))
	var name := str(draft.get("country", ""))
	if target_type == "institution-council":
		open_thread.emit({"targetType": "institution-council", "institutionId": str(draft.get("institutionId", "")), "threadId": str(draft.get("threadId", "")), "name": name if not name.is_empty() else str(draft.get("institutionId", ""))}, text)
	elif target_type == "institution-lifecycle":
		open_thread.emit({"targetType": "institution-lifecycle", "institutionId": str(draft.get("institutionId", "")), "caseId": str(draft.get("caseId", "")), "threadId": str(draft.get("threadId", "")), "name": name if not name.is_empty() else str(draft.get("institutionId", ""))}, text)
	else:
		open_chat.emit(name, text)


func _deploy_action(deployment: Dictionary, message_index: int, placed: bool, row_state: Dictionary) -> Control:
	var states: Dictionary = row_state.get("deploys", {})
	row_state["deploys"] = states
	var slot := int(deployment.get("index", 0))
	if not states.has(slot):
		states[slot] = {"status": "placed" if placed else "idle", "error": ""}
	var st: Dictionary = states[slot]
	if placed:
		st["status"] = "placed"
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 4)
	var name := str(deployment.get("name", ""))
	var pad := Vector4(10, 6, 10, 6)
	var button := _chip("", Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.23), Color("#f4f4f5"), 12, 600, pad, 8)
	column.add_child(button)
	var error := _rich("", 11, ERROR_INK, 1.35)
	column.add_child(error)
	var apply := func() -> void:
		if not is_instance_valid(button):
			return
		var status := str(st.get("status", "idle"))
		var done := status == "placed"
		button.text = "✓ %s placed" % name if done else ("Placing %s…" % name if status == "placing" else "📍 Place %s here" % name)
		_restyle_chip(button, GREEN_BG if done else Color(1, 1, 1, 0.06), GREEN_BORDER if done else Color(1, 1, 1, 0.23), GREEN_INK if done else Color("#f4f4f5"), pad)
		button.disabled = status != "idle"
		button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if status == "idle" else Control.CURSOR_ARROW
		error.text = _escape(str(st.get("error", "")))
		error.visible = not str(st.get("error", "")).is_empty()
	st["apply"] = apply
	apply.call()
	button.pressed.connect(func() -> void:
		if str(st.get("status", "idle")) != "idle":
			return
		st["status"] = "placing"
		st["error"] = ""
		(st["apply"] as Callable).call()
		var reply: Dictionary = await engine.request("advisor.deploy", {"deployment": deployment})
		var result: Dictionary = reply.get("result", {}) if reply.get("ok", false) else {"ok": false, "error": str(reply.get("error", ""))}
		if bool(result.get("ok", false)):
			st["status"] = "placed"
			(st["apply"] as Callable).call()
			focus_point.emit(float(deployment.get("lng", 0.0)), float(deployment.get("lat", 0.0)), 4.5)
			_mark(message_index, "placedDeployments", slot, false)
		else:
			st["status"] = "idle"
			var why := str(result.get("error", ""))
			st["error"] = why if not why.is_empty() else "The unit could not be placed. Try again."
			(st["apply"] as Callable).call())
	return column


func _institution_action(draft: Dictionary, message_index: int, draft_index: int, completed: bool, row_state: Dictionary) -> Control:
	var states: Dictionary = row_state.get("institutions", {})
	row_state["institutions"] = states
	if not states.has(draft_index):
		states[draft_index] = {"status": "completed" if completed else "idle", "error": ""}
	var st: Dictionary = states[draft_index]
	if completed:
		st["status"] = "completed"
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 4)
	var label := str(draft.get("label", "Institution action"))
	var pad := Vector4(10, 6, 10, 6)
	var amber_bg := Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.13)
	var amber_border := Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.42)
	var button := _chip("", amber_bg, amber_border, AMBER_INK, 12, 600, pad, 8)
	button.tooltip_text = str(draft.get("detail", ""))
	column.add_child(button)
	var error := _rich("", 11, ERROR_INK, 1.35)
	column.add_child(error)
	var apply := func() -> void:
		if not is_instance_valid(button):
			return
		var status := str(st.get("status", "idle"))
		var done := status == "completed"
		button.text = "✓ " + label if done else ("Applying institution action…" if status == "working" else "🏛️ " + label)
		_restyle_chip(button, GREEN_BG if done else amber_bg, GREEN_BORDER if done else amber_border, GREEN_INK if done else AMBER_INK, pad)
		button.disabled = status != "idle"
		button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if status == "idle" else Control.CURSOR_ARROW
		error.text = _escape(str(st.get("error", "")))
		error.visible = not str(st.get("error", "")).is_empty()
	st["apply"] = apply
	apply.call()
	button.pressed.connect(func() -> void:
		if str(st.get("status", "idle")) != "idle":
			return
		st["status"] = "working"
		st["error"] = ""
		(st["apply"] as Callable).call()
		var reply: Dictionary = await engine.request("advisor.institution", {"draft": draft})
		var result: Dictionary = reply.get("result", {}) if reply.get("ok", false) else {"ok": false, "error": str(reply.get("error", ""))}
		if bool(result.get("ok", false)):
			st["status"] = "completed"
			(st["apply"] as Callable).call()
			_mark(message_index, "completedInstitutionDrafts", draft_index, true)
		else:
			st["status"] = "idle"
			var why := str(result.get("error", ""))
			st["error"] = why if not why.is_empty() else "The institution action could not be completed."
			(st["apply"] as Callable).call())
	return column


func _mark(message_index: int, field: String, value: int, unique: bool) -> void:
	if message_index < 0 or message_index >= messages.size():
		return
	var target: Dictionary = (messages[message_index] as Dictionary).duplicate()
	var marks: Array = (target.get(field, []) as Array).duplicate() if typeof(target.get(field)) == TYPE_ARRAY else []
	if not unique or not _has_number(marks, value):
		marks.append(value)
	target[field] = marks
	messages[message_index] = target
	_save()
	_render()


func _notice_row(notice: Dictionary, view: Dictionary, state: Dictionary) -> Control:
	if view.is_empty() or bool(view.get("hidden", true)):
		var none := Control.new()
		none.visible = false
		return none
	var row := VBoxContainer.new()
	row.add_theme_constant_override("separation", 0)
	row.add_child(_tagged("🧭", " Advisor", 11, Color(1, 1, 1, 0.4)))
	row.add_child(_gap(4))
	var bubble := PanelContainer.new()
	var style := UI.box(Color(250 / 255.0, 204 / 255.0, 21 / 255.0, 0.06), Color(250 / 255.0, 204 / 255.0, 21 / 255.0, 0.22), 12, 1, Vector4(13, 9, 13, 9))
	style.corner_radius_bottom_left = 2
	bubble.add_theme_stylebox_override("panel", style)
	bubble.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	var lead := "📄 A new paper on your desk: [b]%s[/b], %s." % [_escape(str(view.get("title", ""))), _escape(str(view.get("how", "")))]
	var heading := _rich(lead, 13, UI.WHITE, 1.5)
	heading.add_theme_font_override("bold_font", UI.font(800))
	column.add_child(heading)
	column.add_child(_gap(4.8))
	var open := bool(state.get("read_open", false))
	var toggle := Button.new()
	toggle.text = "Put it away" if open else "Read it"
	toggle.flat = true
	toggle.focus_mode = Control.FOCUS_NONE
	toggle.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	toggle.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	toggle.add_theme_font_override("font", UI.font(700))
	toggle.add_theme_font_size_override("font_size", 12)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		toggle.add_theme_color_override(name, Color("#fde68a"))
	for state_name in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
		toggle.add_theme_stylebox_override(state_name, StyleBoxEmpty.new())
	column.add_child(toggle)
	var paper := VBoxContainer.new()
	paper.add_theme_constant_override("separation", 0)
	paper.add_child(_gap(6.4))
	var rule := ColorRect.new()
	rule.color = Color(1, 1, 1, 0.08)
	rule.custom_minimum_size.y = 1
	paper.add_child(rule)
	paper.add_child(_gap(7.2))
	paper.add_child(_rich(_escape(str(view.get("body", ""))), 13, UI.WHITE, 1.5))
	paper.visible = open
	column.add_child(paper)
	var natural := _line_width("📄 A new paper on your desk: %s, %s." % [str(view.get("title", "")), str(view.get("how", ""))], 13) + 26.0 + 4.0
	toggle.pressed.connect(func() -> void:
		state["read_open"] = not bool(state.get("read_open", false))
		paper.visible = bool(state["read_open"])
		toggle.text = "Put it away" if paper.visible else "Read it"
		_relayout())
	bubble.add_child(column)
	row.add_child(bubble)
	_register_bubble(bubble, func() -> float:
		return 100000.0 if bool(state.get("read_open", false)) else natural, [])
	var date := str(view.get("date", ""))
	if not str(notice.get("time", "")).is_empty() and not date.is_empty():
		row.add_child(_gap(4))
		row.add_child(UI.label(date, 10, Color(1, 1, 1, 0.3)))
	return row


func _build_handle() -> void:
	var layer := Control.new()
	layer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(layer)
	var edge := ColorRect.new()
	edge.color = Color(1, 1, 1, 0.1)
	edge.anchor_top = 0.0
	edge.anchor_bottom = 1.0
	edge.offset_left = 0.0
	edge.offset_right = 1.0
	edge.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(edge)
	_handle = Control.new()
	_handle.anchor_top = 0.0
	_handle.anchor_bottom = 1.0
	_handle.offset_left = 0.0
	_handle.offset_right = 10.0
	_handle.mouse_filter = Control.MOUSE_FILTER_STOP
	_handle.mouse_default_cursor_shape = Control.CURSOR_HSIZE
	_handle.tooltip_text = "Drag to resize"
	layer.add_child(_handle)
	_handle_bar = Panel.new()
	_handle_bar.anchor_top = 0.5
	_handle_bar.anchor_bottom = 0.5
	_handle_bar.offset_left = 3.5
	_handle_bar.offset_right = 6.5
	_handle_bar.offset_top = -21.0
	_handle_bar.offset_bottom = 21.0
	_handle_bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_handle_style = UI.box(Color(1, 1, 1, 0.22), Color(0, 0, 0, 0), 2, 0)
	_handle_bar.add_theme_stylebox_override("panel", _handle_style)
	_handle.add_child(_handle_bar)
	_handle.mouse_entered.connect(func() -> void:
		_handle_hover = true
		_paint_handle())
	_handle.mouse_exited.connect(func() -> void:
		_handle_hover = false
		_paint_handle())
	_handle.gui_input.connect(_on_handle_input)


func _paint_handle() -> void:
	var color := Color(1, 1, 1, 0.22)
	if _resizing:
		color = Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.95)
	elif _handle_hover:
		color = Color(1, 1, 1, 0.5)
	create_tween().tween_property(_handle_style, "bg_color", color, 0.15)


func _on_handle_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var button := event as InputEventMouseButton
		if button.button_index != MOUSE_BUTTON_LEFT:
			return
		if button.pressed:
			_resizing = true
		elif _resizing:
			_resizing = false
			_save_width()
		_paint_handle()
		_handle.accept_event()
	elif event is InputEventMouseMotion and _resizing:
		var motion := event as InputEventMouseMotion
		_apply_width(get_viewport_rect().size.x - motion.global_position.x, true)
		_handle.accept_event()


func clamp_width(px: float) -> float:
	var viewport_width := get_viewport_rect().size.x if is_inside_tree() else 1440.0
	var most: float = max(viewport_width - LEFT_CLEARANCE, min(DEFAULT_WIDTH, viewport_width - 16.0))
	return round(min(max(px, min(MIN_WIDTH, most)), most))


func _apply_width(px: float, announce := true) -> void:
	var width := clamp_width(px)
	var changed := not is_equal_approx(width, _width)
	_width = width
	set_meta("width", _width)
	if _slide and _slide.is_running():
		_slide.kill()
	if is_open():
		offset_left = -_width
		offset_right = 0.0
	else:
		offset_left = 0.0
		offset_right = _width
	_relayout()
	if changed or announce:
		width_changed.emit(_width)


func _save_width() -> void:
	if engine:
		engine.request("advisor.width", {"width": _width})


func _wire(value: Variant) -> String:
	return JSON.stringify(value, "", false, true)


func _escape(text: String) -> String:
	return text.replace("[", "[lb]")


static func _regex(pattern: String) -> RegEx:
	if _re.has(pattern):
		return _re[pattern]
	var compiled := RegEx.new()
	compiled.compile(pattern)
	_re[pattern] = compiled
	return compiled


static func _italic(weight: int) -> Font:
	if _italic_fonts.has(weight):
		return _italic_fonts[weight]
	var font := SystemFont.new()
	font.font_names = PackedStringArray(["Arial", "Segoe UI", "Helvetica", "Liberation Sans", "sans-serif"])
	font.font_italic = true
	font.font_weight = weight
	font.antialiasing = TextServer.FONT_ANTIALIASING_GRAY
	font.hinting = TextServer.HINTING_LIGHT
	_italic_fonts[weight] = font
	return font


static func _mono() -> Font:
	if _mono_font:
		return _mono_font
	var font := SystemFont.new()
	font.font_names = PackedStringArray(["Consolas", "Courier New", "Cascadia Mono", "Menlo", "DejaVu Sans Mono", "monospace"])
	font.antialiasing = TextServer.FONT_ANTIALIASING_GRAY
	_mono_font = font
	return _mono_font


static func _svg(svg: String, size: int, color: Color) -> Texture2D:
	var key := "%s:%d:%s" % [svg.md5_text(), size, color.to_html()]
	if _svg_cache.has(key):
		return _svg_cache[key]
	var image := Image.new()
	if image.load_svg_from_string(svg.replace("currentColor", "#" + color.to_html(false)), float(size) / 24.0) != OK:
		return null
	if color.a < 1.0:
		image.convert(Image.FORMAT_RGBA8)
		for y in range(image.get_height()):
			for x in range(image.get_width()):
				var pixel := image.get_pixel(x, y)
				pixel.a *= color.a
				image.set_pixel(x, y, pixel)
	var texture := ImageTexture.create_from_image(image)
	_svg_cache[key] = texture
	return texture


func _half_leading(size: int, line_height: float) -> float:
	return max(0.0, (float(size) * line_height - UI.font(400).get_height(size)) * 0.5)


func _rich(bbcode: String, size := 14, color := UI.WHITE, line_height := 0.0) -> RichTextLabel:
	var label := RichTextLabel.new()
	label.bbcode_enabled = true
	label.fit_content = true
	label.scroll_active = false
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.selection_enabled = true
	label.context_menu_enabled = true
	label.meta_underlined = false
	label.mouse_filter = Control.MOUSE_FILTER_PASS
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	label.add_theme_font_override("normal_font", UI.font(400))
	label.add_theme_font_override("bold_font", UI.font(700))
	label.add_theme_font_override("italics_font", _italic(400))
	label.add_theme_font_override("bold_italics_font", _italic(700))
	label.add_theme_font_override("mono_font", _mono())
	for name in ["normal_font_size", "bold_font_size", "italics_font_size", "bold_italics_font_size"]:
		label.add_theme_font_size_override(name, size)
	label.add_theme_font_size_override("mono_font_size", max(8, int(round(size * 0.8))))
	label.add_theme_color_override("default_color", color)
	label.add_theme_color_override("selection_color", Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.45))
	if line_height > 0.0:
		var leading := _half_leading(size, line_height)
		label.add_theme_constant_override("line_separation", int(round(leading * 2.0)))
		var pad := StyleBoxEmpty.new()
		pad.content_margin_top = leading
		pad.content_margin_bottom = leading
		label.add_theme_stylebox_override("normal", pad)
	label.meta_clicked.connect(func(meta: Variant) -> void:
		var address := str(meta)
		if address.begins_with("http://") or address.begins_with("https://"):
			OS.shell_open(address))
	label.text = bbcode
	return label


func _replace_matches(pattern: String, text: String, make: Callable) -> String:
	var out := ""
	var at := 0
	for found in _regex(pattern).search_all(text):
		var match := found as RegExMatch
		out += text.substr(at, match.get_start() - at)
		out += str(make.call(match))
		at = match.get_end()
	out += text.substr(at)
	return out


func _inline(source: String) -> String:
	var stash: Array[String] = []
	var hold := func(bbcode: String) -> String:
		stash.append(bbcode)
		return "\u0001%d\u0001" % (stash.size() - 1)
	var text := _replace_matches("\\\\([\\\\`*_{}\\[\\]()#+\\-.!~>|])", source, func(match: RegExMatch) -> String:
		return hold.call(_escape(match.get_string(1))))
	text = _replace_matches("(`+)([^`]|[^`][\\s\\S]*?[^`])\\1(?!`)", text, func(match: RegExMatch) -> String:
		var code := match.get_string(2)
		if code.length() > 1 and code.begins_with(" ") and code.ends_with(" ") and not code.strip_edges().is_empty():
			code = code.substr(1, code.length() - 2)
		return hold.call("[bgcolor=#00000052][code]%s[/code][/bgcolor]" % _escape(code)))
	text = _replace_matches("!?\\[([^\\]]*)\\]\\(\\s*<?([^)\\s>]*)>?(?:\\s+\"[^\"]*\")?\\s*\\)", text, func(match: RegExMatch) -> String:
		var words := match.get_string(1)
		var address := match.get_string(2)
		if words.is_empty():
			words = address
		return hold.call("[url=%s][color=#60a5fa]%s[/color][/url]" % [address.replace("]", "%5D"), _inline(words)]))
	text = _replace_matches("<(https?://[^\\s>]+)>", text, func(match: RegExMatch) -> String:
		return hold.call("[url=%s][color=#60a5fa]%s[/color][/url]" % [match.get_string(1).replace("]", "%5D"), _escape(match.get_string(1))]))
	text = _replace_matches("(?<![\\w/])((?:https?://|www\\.)[^\\s<\\x{1}]*[^\\s<?!.,:*_~)\"'\\x{1}])", text, func(match: RegExMatch) -> String:
		var address := match.get_string(1)
		var target := address if address.begins_with("http") else "http://" + address
		return hold.call("[url=%s][color=#60a5fa]%s[/color][/url]" % [target.replace("]", "%5D"), _escape(address)]))
	text = _escape(text)
	text = _regex("\\*\\*\\*(\\S(?:.*?\\S)?)\\*\\*\\*").sub(text, "[b][i][color=#fffffff7]$1[/color][/i][/b]", true)
	text = _regex("\\*\\*(\\S(?:.*?\\S)?)\\*\\*").sub(text, "[b][color=#fffffff7]$1[/color][/b]", true)
	text = _regex("(^|[^\\w_])__(\\S(?:.*?\\S)?)__(?![\\w_])").sub(text, "$1[b][color=#fffffff7]$2[/color][/b]", true)
	text = _regex("~~(\\S(?:.*?\\S)?)~~").sub(text, "[s][color=#ffffff66]$1[/color][/s]", true)
	text = _regex("(^|[^\\w*])\\*(\\S(?:.*?\\S)?)\\*(?![\\w*])").sub(text, "$1[i][color=#ffffffc7]$2[/color][/i]", true)
	text = _regex("(^|[^\\w_])_(\\S(?:.*?\\S)?)_(?![\\w_])").sub(text, "$1[i][color=#ffffffc7]$2[/color][/i]", true)
	for index in range(stash.size() - 1, -1, -1):
		text = text.replace("\u0001%d\u0001" % index, stash[index])
	return text


func _md_blocks(source: String) -> Array:
	var blocks: Array = []
	var lines := source.split("\n")
	var paragraph: PackedStringArray = []
	var index := 0
	var item_re := _regex("^(\\s*)([-*+]|\\d{1,9}[.)])(\\s+(.*))?$")
	var flush := func() -> void:
		if not paragraph.is_empty():
			blocks.append({"type": "p", "text": "\n".join(paragraph)})
			paragraph.clear()
	while index < lines.size():
		var line := lines[index]
		var stripped := line.strip_edges()
		var fence := _regex("^\\s{0,3}(`{3,}|~{3,})").search(line)
		if fence:
			flush.call()
			var mark := fence.get_string(1)
			var code: PackedStringArray = []
			index += 1
			while index < lines.size() and not lines[index].strip_edges().begins_with(mark.substr(0, 3)):
				code.append(lines[index])
				index += 1
			index += 1
			blocks.append({"type": "code", "text": "\n".join(code)})
			continue
		if stripped.is_empty():
			flush.call()
			index += 1
			continue
		if _regex("^\\s{0,3}>").search(line):
			flush.call()
			var quoted: PackedStringArray = []
			while index < lines.size() and _regex("^\\s{0,3}>").search(lines[index]):
				quoted.append(_regex("^\\s{0,3}>\\s?").sub(lines[index], ""))
				index += 1
			blocks.append({"type": "quote", "text": "\n".join(quoted)})
			continue
		if _regex("^\\s{0,3}((\\*\\s*){3,}|(-\\s*){3,}|(_\\s*){3,})$").search(line):
			flush.call()
			blocks.append({"type": "hr"})
			index += 1
			continue
		var heading := _regex("^\\s{0,3}(#{1,6})(?:\\s+(.*?))?(?:\\s+#+)?\\s*$").search(line)
		if heading:
			flush.call()
			blocks.append({"type": "heading", "level": heading.get_string(1).length(), "text": heading.get_string(2)})
			index += 1
			continue
		if line.contains("|") and index + 1 < lines.size() and _regex("^\\s{0,3}\\|?[\\s:-]*-[\\s:|-]*\\|?\\s*$").search(lines[index + 1]) and lines[index + 1].contains("|") and lines[index + 1].contains("-"):
			flush.call()
			var header := _cells(line)
			var align: Array = []
			for cell in _cells(lines[index + 1]):
				var left := cell.begins_with(":")
				var right := cell.ends_with(":")
				align.append("center" if left and right else ("right" if right else ("left" if left else "")))
			var rows: Array = [header]
			index += 2
			while index < lines.size() and lines[index].contains("|") and not lines[index].strip_edges().is_empty():
				rows.append(_cells(lines[index]))
				index += 1
			blocks.append({"type": "table", "rows": rows, "align": align})
			continue
		var starts := item_re.search(line)
		var interrupts := false
		if starts:
			var marker := starts.get_string(2)
			var ordered := marker[0] >= "0" and marker[0] <= "9"
			interrupts = paragraph.is_empty() or (not starts.get_string(4).strip_edges().is_empty() and (not ordered or int(marker.substr(0, marker.length() - 1)) == 1))
		if interrupts:
			flush.call()
			var items: Array = []
			var loose := false
			while index < lines.size():
				var item := item_re.search(lines[index])
				if item:
					var level := int(floor(item.get_string(1).replace("\t", "    ").length() / 2.0))
					items.append([level, item.get_string(2), item.get_string(4)])
					index += 1
					continue
				if lines[index].strip_edges().is_empty():
					var ahead := index + 1
					while ahead < lines.size() and lines[ahead].strip_edges().is_empty():
						ahead += 1
					if ahead < lines.size() and (item_re.search(lines[ahead]) or lines[ahead].begins_with("  ")) and not items.is_empty():
						loose = true
						index = ahead
						continue
					break
				if not items.is_empty() and (lines[index].begins_with(" ") or not (_regex("^\\s{0,3}(>|#|`{3}|~{3})").search(lines[index]))):
					var previous: Array = items[items.size() - 1]
					previous[2] = str(previous[2]) + "\n" + lines[index].strip_edges()
					index += 1
					continue
				break
			blocks.append({"type": "list", "items": items, "loose": loose})
			continue
		paragraph.append(line)
		index += 1
	flush.call()
	return blocks


func _cells(line: String) -> PackedStringArray:
	var trimmed := line.strip_edges()
	if trimmed.begins_with("|"):
		trimmed = trimmed.substr(1)
	if trimmed.ends_with("|") and not trimmed.ends_with("\\|"):
		trimmed = trimmed.substr(0, trimmed.length() - 1)
	var cells: PackedStringArray = []
	var current := ""
	var at := 0
	while at < trimmed.length():
		var ch := trimmed[at]
		if ch == "\\" and at + 1 < trimmed.length() and trimmed[at + 1] == "|":
			current += "|"
			at += 2
			continue
		if ch == "|":
			cells.append(current.strip_edges())
			current = ""
		else:
			current += ch
		at += 1
	cells.append(current.strip_edges())
	return cells


func _markdown(source: String, size := 14, inset := 0.0, color := UI.WHITE) -> Control:
	var holder := VBoxContainer.new()
	holder.add_theme_constant_override("separation", 0)
	var previous := -1.0
	for block in _md_blocks(source):
		var entry: Dictionary = block
		var margins := PARAGRAPH
		match str(entry["type"]):
			"heading":
				margins = HEADING
			"list":
				margins = LIST
			"quote":
				margins = QUOTE
			"hr":
				margins = RULE
			"code":
				margins = CODE
			"table":
				margins = TABLE
		if previous >= 0.0:
			holder.add_child(_gap(max(previous, margins.x)))
		holder.add_child(_md_block(entry, size, inset, color))
		previous = margins.y
	return holder


func _md_block(block: Dictionary, size: int, inset: float, color: Color) -> Control:
	match str(block["type"]):
		"p":
			return _rich(_inline(str(block["text"])), size, color, 1.5)
		"heading":
			return _heading(int(block["level"]), str(block["text"]))
		"list":
			return _list(block["items"], bool(block.get("loose", false)), size, inset, color)
		"quote":
			return _quote_block(str(block["text"]), size, inset)
		"hr":
			var rule := ColorRect.new()
			rule.color = Color(1, 1, 1, 0.14)
			rule.custom_minimum_size.y = 1
			rule.mouse_filter = Control.MOUSE_FILTER_IGNORE
			return rule
		"code":
			return _code_block(str(block["text"]))
		"table":
			return _table(block["rows"], block.get("align", []), inset)
	return Control.new()


func _heading(level: int, text: String) -> Control:
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	var sizes := [16, 15, 14, 12, 12, 12]
	var label: RichTextLabel
	if level >= 4:
		label = _rich("[b]%s[/b]" % _inline(text.to_upper()), 12, SMALL_HEADING, 1.3)
	else:
		label = _rich("[b]%s[/b]" % _inline(text), int(sizes[level - 1]), Color(1, 1, 1, 0.95), 1.3)
	column.add_child(label)
	if level <= 2:
		column.add_child(_gap(4.5 if level == 1 else 3.5))
		var rule := ColorRect.new()
		rule.color = Color(1, 1, 1, 0.14 if level == 1 else 0.09)
		rule.custom_minimum_size.y = 1
		rule.mouse_filter = Control.MOUSE_FILTER_IGNORE
		column.add_child(rule)
	return column


func _list(items: Array, loose: bool, size: int, inset: float, color: Color) -> Control:
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	var counters := {}
	var first := true
	var previous_level := 0
	for entry in items:
		var item: Array = entry
		var level: int = item[0]
		var marker := str(item[1])
		var body_text := str(item[2])
		if not first:
			column.add_child(_gap(8.0 if loose else (3.52 if level == previous_level else 3.52)))
		first = false
		for deeper in counters.keys():
			if int(deeper) > level:
				counters.erase(deeper)
		var ordered := marker.length() > 0 and marker[0] >= "0" and marker[0] <= "9"
		var bullet: String = ["•", "◦", "▪"][min(level, 2)]
		if ordered:
			if not counters.has(level):
				counters[level] = int(marker.substr(0, marker.length() - 1)) - 1
			counters[level] = int(counters[level]) + 1
			bullet = "%d." % int(counters[level])
		else:
			counters.erase(level)
		var task := _regex("^\\[( |x|X)\\]\\s+(.*)$").search(body_text)
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 0)
		var indent := 18.4 * float(level)
		if task:
			body_text = task.get_string(2)
			if indent > 0.0:
				row.add_child(_spacer_width(indent))
			row.add_child(_spacer_width(1.6))
			var holder := MarginContainer.new()
			holder.add_theme_constant_override("margin_top", int(round(_half_leading(size, 1.5) + (UI.font(400).get_height(size) - 13.0) * 0.5)))
			holder.add_theme_constant_override("margin_right", 7)
			holder.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
			holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
			var checked := task.get_string(1) != " "
			var box := Panel.new()
			box.custom_minimum_size = Vector2(13, 13)
			box.mouse_filter = Control.MOUSE_FILTER_IGNORE
			box.add_theme_stylebox_override("panel", UI.box(Color(LINK.r, LINK.g, LINK.b, 0.45) if checked else Color(1, 1, 1, 0.06), Color(LINK.r, LINK.g, LINK.b, 0.45) if checked else Color(1, 1, 1, 0.3), 2, 1))
			if checked:
				var tick := TextureRect.new()
				tick.texture = _svg(CHECK_SVG, 13, UI.WHITE)
				tick.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
				tick.mouse_filter = Control.MOUSE_FILTER_IGNORE
				box.add_child(tick)
			holder.add_child(box)
			row.add_child(holder)
		else:
			if indent > 0.0:
				row.add_child(_spacer_width(indent))
			var dot := UI.label(bullet + " ", size, MARKER, 600 if ordered else 400)
			dot.custom_minimum_size.x = 18.4
			dot.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
			dot.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
			var lead := StyleBoxEmpty.new()
			lead.content_margin_top = _half_leading(size, 1.5)
			dot.add_theme_stylebox_override("normal", lead)
			row.add_child(dot)
		var text := _rich(_inline(body_text), size, color, 1.5)
		text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(text)
		column.add_child(row)
		previous_level = level
	return column


func _spacer_width(width: float) -> Control:
	var spacer := Control.new()
	spacer.custom_minimum_size.x = width
	spacer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return spacer


func _quote_block(text: String, size: int, inset: float) -> Control:
	var box := PanelContainer.new()
	var style := UI.box(Color(LINK.r, LINK.g, LINK.b, 0.07), Color(0, 0, 0, 0), 0, 0, Vector4(11, 6, 11, 6))
	style.border_color = LINK
	style.border_width_left = 2
	style.corner_radius_top_right = 6
	style.corner_radius_bottom_right = 6
	box.add_theme_stylebox_override("panel", style)
	box.add_child(_markdown(text, size, inset + 24.0, Color(1, 1, 1, 0.82)))
	return box


func _code_block(text: String) -> Control:
	var box := PanelContainer.new()
	box.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0.32), Color(1, 1, 1, 0.08), 8, 1, Vector4(12, 10, 12, 10)))
	var area := ScrollContainer.new()
	area.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	area.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_AUTO
	var label := Label.new()
	label.text = text
	label.add_theme_font_override("font", _mono())
	label.add_theme_font_size_override("font_size", 11)
	label.add_theme_color_override("font_color", UI.WHITE)
	label.add_theme_constant_override("line_spacing", int(round(11.0 * 1.5 - _mono().get_height(11))))
	label.mouse_filter = Control.MOUSE_FILTER_PASS
	area.add_child(label)
	box.add_child(area)
	return box


func _table(rows: Array, align: Array, inset: float) -> Control:
	var columns := 0
	for row in rows:
		columns = max(columns, (row as PackedStringArray).size())
	var area := ScrollContainer.new()
	area.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	area.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_AUTO
	var frame := PanelContainer.new()
	var outer := UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 0)
	outer.border_color = Color(1, 1, 1, 0.1)
	outer.border_width_left = 1
	outer.border_width_top = 1
	frame.add_theme_stylebox_override("panel", outer)
	var grid := GridContainer.new()
	grid.columns = max(1, columns)
	grid.add_theme_constant_override("h_separation", 0)
	grid.add_theme_constant_override("v_separation", 0)
	var mins: Array[float] = []
	var maxs: Array[float] = []
	for column in range(columns):
		mins.append(88.0 if column == 0 else 52.0)
		maxs.append(88.0 if column == 0 else 52.0)
	var heads: Array[Control] = []
	for row_index in range(rows.size()):
		var row: PackedStringArray = rows[row_index]
		for column in range(columns):
			var cell_text := row[column] if column < row.size() else ""
			var bg := Color(0, 0, 0, 0)
			if row_index == 0:
				bg = TABLE_HEAD
			elif row_index % 2 == 0:
				bg = Color(1, 1, 1, 0.04)
			var style := UI.box(bg, Color(0, 0, 0, 0), 0, 0, Vector4(8, 4.8, 8, 4.8))
			style.border_color = Color(1, 1, 1, 0.1)
			style.border_width_right = 1
			style.border_width_bottom = 1
			var cell := PanelContainer.new()
			cell.add_theme_stylebox_override("panel", style)
			cell.size_flags_horizontal = Control.SIZE_FILL
			var bbcode := _inline(cell_text)
			var weight := 400
			var ink := UI.WHITE
			if row_index == 0:
				weight = 700
				ink = Color(1, 1, 1, 0.95)
			elif column == 0:
				weight = 600
				ink = Color(1, 1, 1, 0.9)
			var alignment := str(align[column]) if column < align.size() else ""
			if alignment == "center":
				bbcode = "[center]%s[/center]" % bbcode
			elif alignment == "right":
				bbcode = "[right]%s[/right]" % bbcode
			var label := _rich(bbcode, 12, ink, 1.4)
			label.add_theme_font_override("normal_font", UI.font(weight))
			label.add_theme_font_override("bold_font", UI.font(max(weight, 700)))
			cell.add_child(label)
			grid.add_child(cell)
			if row_index == 0:
				heads.append(cell)
			var plain := _regex("[*_`~]").sub(cell_text, "", true)
			var font := UI.font(weight)
			var full := font.get_string_size(plain, HORIZONTAL_ALIGNMENT_LEFT, -1, 12).x + 17.0
			var longest := 0.0
			for word in plain.split(" ", false):
				longest = max(longest, font.get_string_size(word, HORIZONTAL_ALIGNMENT_LEFT, -1, 12).x)
			mins[column] = max(mins[column], longest + 17.0)
			maxs[column] = max(maxs[column], full)
	frame.add_child(grid)
	area.add_child(frame)
	_inner_hooks.append(func(content_width: float) -> void:
		if not is_instance_valid(grid):
			return
		var room: float = max(0.0, content_width - inset - 1.0)
		var min_total := 0.0
		var max_total := 0.0
		for column in range(columns):
			min_total += mins[column]
			max_total += maxs[column]
		for column in range(columns):
			var width: float = mins[column]
			if max_total <= room and max_total > 0.0:
				width = maxs[column] + (room - max_total) * maxs[column] / max_total
			elif min_total < room and max_total > min_total:
				width = mins[column] + (maxs[column] - mins[column]) * (room - min_total) / (max_total - min_total)
			if column < heads.size() and is_instance_valid(heads[column]):
				heads[column].custom_minimum_size.x = floor(width))
	return area


func _css_color(value: Variant, fallback: Color) -> Color:
	if typeof(value) == TYPE_ARRAY:
		return _css_color((value as Array)[0], fallback) if not (value as Array).is_empty() else fallback
	if typeof(value) != TYPE_STRING:
		return fallback
	var text := (value as String).strip_edges()
	if text.begins_with("rgb"):
		var inside := text.substr(text.find("(") + 1).trim_suffix(")")
		var parts := inside.replace("/", ",").replace(" ", ",").split(",", false)
		if parts.size() >= 3:
			var alpha := float(parts[3]) if parts.size() >= 4 else 1.0
			return Color(float(parts[0]) / 255.0, float(parts[1]) / 255.0, float(parts[2]) / 255.0, alpha)
		return fallback
	return Color.from_string(text, fallback)


func _chart(config: Dictionary) -> Control:
	var kind := str(config.get("type", "bar"))
	var pie := kind == "pie" or kind == "doughnut"
	var data: Dictionary = config.get("data", {})
	var labels: PackedStringArray = []
	for label in data.get("labels", []):
		labels.append(str(label))
	var options: Dictionary = config.get("options", {}) if typeof(config.get("options")) == TYPE_DICTIONARY else {}
	var series: Array = []
	var raw_sets: Array = data.get("datasets", [])
	for set_index in range(raw_sets.size()):
		var dataset: Dictionary = raw_sets[set_index]
		var base := Color(str(CHART_COLORS[set_index % CHART_COLORS.size()]))
		var slices: Array = []
		var slice_borders: Array = []
		var own: Variant = dataset.get("backgroundColor")
		for label_index in range(labels.size()):
			var fallback := Color(str(CHART_COLORS[label_index % CHART_COLORS.size()]))
			if typeof(own) == TYPE_ARRAY and label_index < (own as Array).size():
				slices.append(_css_color((own as Array)[label_index], fallback))
			elif typeof(own) == TYPE_STRING:
				slices.append(_css_color(own, fallback))
			else:
				slices.append(fallback)
			slice_borders.append(_css_color(dataset.get("borderColor"), Color(1, 1, 1)))
		var stroke := _css_color(dataset.get("borderColor"), base)
		var fill := _css_color(dataset.get("backgroundColor"), Color(base.r, base.g, base.b, 0x26 / 255.0) if kind == "line" else base)
		series.append({"label": str(dataset.get("label", "")), "values": dataset.get("data", []), "stroke": stroke, "fill": fill, "slices": slices, "slice_borders": slice_borders})
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	var legend := HFlowContainer.new()
	legend.add_theme_constant_override("h_separation", 14)
	legend.add_theme_constant_override("v_separation", 6)
	if pie:
		var first: Array = (series[0] as Dictionary).get("slices", []) if not series.is_empty() else []
		for label_index in range(labels.size()):
			legend.add_child(_legend_item(labels[label_index], first[label_index] if label_index < first.size() else Color(str(CHART_COLORS[label_index % CHART_COLORS.size()]))))
	else:
		for entry in series:
			var item: Dictionary = entry
			legend.add_child(_legend_item(str(item["label"]), item["stroke"]))
	if legend.get_child_count() > 0:
		column.add_child(legend)
		column.add_child(_gap(8))
	var canvas := AdvisorChart.new()
	canvas.kind = kind
	canvas.labels = labels
	canvas.series = series
	canvas.percent = str(options.get("unit", "")) == "percent"
	canvas.font = UI.font(400)
	canvas.bold = UI.font(700)
	canvas.custom_minimum_size = Vector2(0, 175)
	canvas.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.add_child(canvas)
	return column


func _legend_item(text: String, color: Color) -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var swatch := Panel.new()
	swatch.custom_minimum_size = Vector2(8, 8)
	swatch.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	swatch.add_theme_stylebox_override("panel", UI.box(color, Color(0, 0, 0, 0), 2, 0))
	swatch.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.add_child(swatch)
	row.add_child(UI.label(text, 12, Color(1, 1, 1, 0.5)))
	return row


class AdvisorChart extends Control:
	const DURATION := 1000.0
	const TICK_SIZE := 10
	const TICK_LINE := 12.0
	const TICK_MARK := 8.0
	const TICK_PAD := 3.0
	const GRID := Color(1, 1, 1, 0.06)
	const AXIS := Color(1, 1, 1, 0.08)
	const INK := Color(1, 1, 1, 0.45)

	var kind := "bar"
	var labels: PackedStringArray = []
	var series: Array = []
	var percent := false
	var font: Font
	var bold: Font
	var _born := 0
	var _hover_set := -1
	var _hover_index := -1
	var _hits: Array = []

	func _ready() -> void:
		_born = Time.get_ticks_msec()
		mouse_filter = Control.MOUSE_FILTER_PASS
		set_process(true)

	func _process(_delta: float) -> void:
		queue_redraw()
		if Time.get_ticks_msec() - _born > DURATION:
			set_process(false)

	func _notification(what: int) -> void:
		if what == NOTIFICATION_RESIZED:
			queue_redraw()
		elif what == NOTIFICATION_MOUSE_EXIT:
			if _hover_set != -1:
				_hover_set = -1
				_hover_index = -1
				queue_redraw()

	func _gui_input(event: InputEvent) -> void:
		if event is InputEventMouseMotion:
			var at := (event as InputEventMouseMotion).position
			var found_set := -1
			var found_index := -1
			for hit in _hits:
				var entry: Dictionary = hit
				if _inside(entry, at):
					found_set = int(entry["set"])
					found_index = int(entry["index"])
			if found_set != _hover_set or found_index != _hover_index:
				_hover_set = found_set
				_hover_index = found_index
				queue_redraw()

	func _inside(entry: Dictionary, at: Vector2) -> bool:
		match str(entry["shape"]):
			"rect":
				return (entry["rect"] as Rect2).has_point(at)
			"point":
				return at.distance_to(entry["at"]) < float(entry["reach"])
			"arc":
				var center: Vector2 = entry["center"]
				var distance := at.distance_to(center)
				if distance > float(entry["outer"]) or distance < float(entry["inner"]):
					return false
				var angle := fposmod(atan2(at.y - center.y, at.x - center.x) - float(entry["start"]), TAU)
				return angle <= float(entry["sweep"])
		return false

	func _progress() -> float:
		var t: float = clamp(float(Time.get_ticks_msec() - _born) / DURATION, 0.0, 1.0)
		return 1.0 - pow(1.0 - t, 4.0)

	func _number(value: Variant) -> Variant:
		if typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT:
			return float(value)
		return null

	func _js(value: float) -> String:
		if is_zero_approx(value):
			return "0"
		if is_equal_approx(value, round(value)) and abs(value) < 1e15:
			return str(int(round(value)))
		var text := String.num(value, 10)
		if text.contains("."):
			while text.ends_with("0"):
				text = text.substr(0, text.length() - 1)
			if text.ends_with("."):
				text = text.substr(0, text.length() - 1)
		return text

	func _label_text(value: float) -> String:
		return _js(value) + ("%" if percent else "")

	func _hover_color(color: Color) -> Color:
		var high: float = max(color.r, max(color.g, color.b))
		var low: float = min(color.r, min(color.g, color.b))
		var light := (high + low) * 0.5
		var hue := 0.0
		var sat := 0.0
		if high != low:
			var delta := high - low
			sat = delta / (2.0 - high - low) if light > 0.5 else delta / (high + low)
			if high == color.r:
				hue = (color.g - color.b) / delta + (6.0 if color.g < color.b else 0.0)
			elif high == color.g:
				hue = (color.b - color.r) / delta + 2.0
			else:
				hue = (color.r - color.g) / delta + 4.0
			hue /= 6.0
		sat = min(1.0, sat + sat * 0.5)
		light = light - light * 0.1
		if sat == 0.0:
			return Color(light, light, light, color.a)
		var q := light * (1.0 + sat) if light < 0.5 else light + sat - light * sat
		var p := 2.0 * light - q
		return Color(_hue(p, q, hue + 1.0 / 3.0), _hue(p, q, hue), _hue(p, q, hue - 1.0 / 3.0), color.a)

	func _hue(p: float, q: float, t: float) -> float:
		var u := fposmod(t, 1.0)
		if u < 1.0 / 6.0:
			return p + (q - p) * 6.0 * u
		if u < 0.5:
			return q
		if u < 2.0 / 3.0:
			return p + (q - p) * (2.0 / 3.0 - u) * 6.0
		return p

	func _nice(range_value: float) -> float:
		var rounded: float = round(range_value)
		var value := rounded if abs(range_value - rounded) < range_value / 1000.0 else range_value
		var magnitude: float = pow(10.0, floorf(log(value) / log(10.0)))
		var fraction := value / magnitude
		var nice := 1.0 if fraction <= 1.0 else (2.0 if fraction <= 2.0 else (5.0 if fraction <= 5.0 else 10.0))
		return nice * magnitude

	func _decimals(value: float) -> int:
		var places := 0
		var scale := 1.0
		while places < 12 and not is_equal_approx(round(value * scale) / scale, value):
			scale *= 10.0
			places += 1
		return places

	func _ticks(low: float, high: float, length: float) -> Array[float]:
		var max_ticks: int = max(2, min(11, int(ceil(length / TICK_LINE))))
		var spaces := max_ticks - 1
		var spacing := _nice((high - low) / float(spaces))
		var result: Array[float] = []
		if spacing < 1e-14:
			result.append(low)
			result.append(high)
			return result
		var count: float = ceilf(high / spacing) - floorf(low / spacing)
		if count > spaces:
			spacing = _nice(count * spacing / float(spaces))
		var nice_min: float = floorf(low / spacing) * spacing
		var nice_max: float = ceilf(high / spacing) * spacing
		var steps: float = (nice_max - nice_min) / spacing
		var whole: float = round(steps) if abs(steps - round(steps)) < spacing / 1000.0 else ceil(steps)
		var factor: float = pow(10.0, float(max(_decimals(spacing), _decimals(nice_min))))
		nice_min = round(nice_min * factor) / factor
		nice_max = round(nice_max * factor) / factor
		for step in range(int(whole)):
			result.append(round((nice_min + float(step) * spacing) * factor) / factor)
		result.append(nice_max)
		return result

	func _draw() -> void:
		_hits.clear()
		if series.is_empty() or labels.is_empty():
			return
		if kind == "pie" or kind == "doughnut":
			_draw_pie()
		else:
			_draw_axes()

	func _draw_pie() -> void:
		var first: Dictionary = series[0]
		var values: Array = first.get("values", [])
		var slices: Array = first.get("slices", [])
		var borders: Array = first.get("slice_borders", [])
		var total := 0.0
		for value in values:
			var number: Variant = _number(value)
			if number != null and float(number) > 0.0:
				total += float(number)
		if total <= 0.0:
			return
		var area := Rect2(0, 4, size.x, max(0.0, size.y - 8.0))
		var center := area.get_center()
		var outer: float = max(0.0, min(area.size.x, area.size.y) * 0.5)
		var inner := outer * 0.5 if kind == "doughnut" else 0.0
		var progress := _progress()
		var angle := -PI * 0.5
		var drawn: Array = []
		for index in range(values.size()):
			var number: Variant = _number(values[index])
			if number == null or float(number) <= 0.0:
				continue
			var sweep := float(number) / total * TAU * progress
			var color: Color = slices[index] if index < slices.size() else Color("#60a5fa")
			var edge: Color = borders[index] if index < borders.size() else Color(1, 1, 1)
			if index == _hover_index:
				color = _hover_color(color)
				edge = _hover_color(edge)
			var steps: int = max(2, int(ceil(sweep / TAU * 96.0)))
			var points := PackedVector2Array()
			for step in range(steps + 1):
				var at := angle + sweep * float(step) / float(steps)
				points.append(center + Vector2(cos(at), sin(at)) * outer)
			if inner > 0.0:
				for step in range(steps, -1, -1):
					var at := angle + sweep * float(step) / float(steps)
					points.append(center + Vector2(cos(at), sin(at)) * inner)
			else:
				points.append(center)
			if points.size() >= 3 and sweep > 0.0001:
				draw_colored_polygon(points, color)
				var outline := points.duplicate()
				outline.append(points[0])
				drawn.append([outline, edge])
			_hits.append({"shape": "arc", "set": 0, "index": index, "center": center, "outer": outer, "inner": inner, "start": angle, "sweep": sweep, "at": center + Vector2(cos(angle + sweep * 0.5), sin(angle + sweep * 0.5)) * ((outer + inner) * 0.5), "value": float(number), "color": color, "border": edge})
			angle += sweep
		for entry in drawn:
			var pair: Array = entry
			draw_polyline(pair[0], pair[1], 2.0, true)
		_draw_tooltip()

	func _draw_axes() -> void:
		var all: Array[float] = []
		for entry in series:
			for value in (entry as Dictionary).get("values", []):
				var number: Variant = _number(value)
				if number != null:
					all.append(float(number))
		if all.is_empty():
			return
		var line := kind == "line"
		var low: float = all.min()
		var high: float = all.max()
		if not line:
			if low > 0.0 and high > 0.0:
				low = 0.0
			elif low < 0.0 and high < 0.0:
				high = 0.0
		if is_equal_approx(low, high):
			var offset: float = 1.0 if is_zero_approx(high) else absf(high * 0.05)
			high += offset
			if line:
				low -= offset
		var count := labels.size()
		var label_sizes: Array[float] = []
		var widest := 0.0
		for label in labels:
			var width := font.get_string_size(label, HORIZONTAL_ALIGNMENT_LEFT, -1, TICK_SIZE).x
			label_sizes.append(width)
			widest = max(widest, width)
		var top := TICK_LINE * 0.5 + TICK_PAD
		var rotation := 0.0
		var x_height := TICK_MARK + TICK_LINE + TICK_PAD * 2.0
		var ticks: Array[float] = _ticks(low, high, size.y - top - 4.0 - x_height)
		var y_width := 0.0
		for value in ticks:
			y_width = max(y_width, font.get_string_size(_label_text(value), HORIZONTAL_ALIGNMENT_LEFT, -1, TICK_SIZE).x)
		var left := TICK_MARK + y_width + TICK_PAD * 2.0
		var right_pad := 0.0
		var plot_width: float = max(10.0, size.x - left)
		if count > 1:
			var tick_width := plot_width / float(count) if not line else plot_width / float(count - 1)
			if widest + 6.0 > tick_width:
				tick_width = plot_width / (float(count) - (0.5 if not line else 1.0))
				var max_height := (size.y - 8.0) * 0.5 - TICK_MARK - TICK_PAD
				var diagonal := sqrt(widest * widest + TICK_LINE * TICK_LINE)
				rotation = min(asin(clamp((TICK_LINE + 6.0) / tick_width, -1.0, 1.0)), asin(clamp(max_height / diagonal, -1.0, 1.0)) - asin(clamp(TICK_LINE / diagonal, -1.0, 1.0)))
				rotation = clamp(rotation, 0.0, deg_to_rad(50.0))
		if rotation > 0.0:
			x_height = TICK_MARK + TICK_PAD * 2.0 + sin(rotation) * widest + cos(rotation) * TICK_LINE
			right_pad = sin(rotation) * TICK_LINE + TICK_PAD
			ticks = _ticks(low, high, size.y - top - 4.0 - x_height)
		elif line and count > 0:
			right_pad = label_sizes[count - 1] * 0.5 + TICK_PAD
		elif count > 0:
			var band := plot_width / float(count)
			right_pad = max(label_sizes[count - 1] * 0.5 - band * 0.5 + TICK_PAD, 0.0)
		low = ticks[0]
		high = ticks[ticks.size() - 1]
		var plot := Rect2(left, top, max(10.0, size.x - left - right_pad), max(10.0, size.y - top - 4.0 - x_height))
		var to_y := func(value: float) -> float:
			return plot.end.y - (value - low) / (high - low) * plot.size.y
		var group := plot.size.x / float(count)
		var x_of := func(index: int) -> float:
			if line:
				return plot.position.x + (plot.size.x * float(index) / float(count - 1) if count > 1 else plot.size.x * 0.5)
			return plot.position.x + group * (float(index) + 0.5)
		for value in ticks:
			var y: float = to_y.call(value)
			draw_line(Vector2(plot.position.x - TICK_MARK, y), Vector2(plot.end.x, y), GRID, 1.0)
		var grid_count := count + 1 if not line else count
		for index in range(grid_count):
			var x: float = (plot.position.x + group * float(index)) if not line else float(x_of.call(index))
			draw_line(Vector2(x, plot.position.y), Vector2(x, plot.end.y + TICK_MARK), GRID, 1.0)
		var progress := _progress()
		var base_value := 0.0
		if low > 0.0 and high > 0.0:
			base_value = low
		elif low < 0.0 and high < 0.0:
			base_value = high
		var base: float = to_y.call(base_value)
		if line:
			for set_index in range(series.size()):
				var item: Dictionary = series[set_index]
				var stroke: Color = item["stroke"]
				var values: Array = item.get("values", [])
				var points: Array = []
				for index in range(min(count, values.size())):
					var number: Variant = _number(values[index])
					if number == null:
						points.append(null)
						continue
					var target: float = to_y.call(float(number))
					points.append(Vector2(x_of.call(index), lerp(base, target, progress)))
				_draw_curve(points, stroke)
				for index in range(points.size()):
					if points[index] == null:
						continue
					var at: Vector2 = points[index]
					var hovered := set_index == _hover_set and index == _hover_index
					var radius := 5.0 if hovered else 3.0
					var dot_fill: Color = item["fill"]
					var dot_edge := stroke
					if hovered:
						dot_fill = _hover_color(dot_fill)
						dot_edge = _hover_color(dot_edge)
					draw_circle(at, radius, dot_fill)
					draw_arc(at, radius, 0.0, TAU, 24, dot_edge, 1.0, true)
					_hits.append({"shape": "point", "set": set_index, "index": index, "at": at, "reach": radius + 1.0, "value": float(_number(values[index])), "color": item["fill"], "border": stroke})
		else:
			var sets := series.size()
			var inner_width := group * 0.8
			var bar := inner_width / float(sets) * 0.9
			for set_index in range(sets):
				var item: Dictionary = series[set_index]
				var values: Array = item.get("values", [])
				for index in range(min(count, values.size())):
					var number: Variant = _number(values[index])
					if number == null:
						continue
					var start := plot.position.x + group * float(index) + (group - inner_width) * 0.5 + inner_width / float(sets) * float(set_index) + (inner_width / float(sets) - bar) * 0.5
					var target: float = to_y.call(float(number))
					var top_y: float = lerp(base, target, progress)
					var rect := Rect2(start, min(top_y, base), bar, abs(base - top_y))
					var hovered := set_index == _hover_set and index == _hover_index
					var fill: Color = item["fill"]
					var stroke: Color = item["stroke"]
					if hovered:
						fill = _hover_color(fill)
						stroke = _hover_color(stroke)
					var border: float = min(2.0, min(rect.size.x * 0.5, rect.size.y))
					var upward := target <= base
					var inner := Rect2(rect.position.x + border, rect.position.y + (border if upward else 0.0), rect.size.x - border * 2.0, rect.size.y - border)
					if border > 0.0:
						draw_rect(rect, stroke)
					if inner.size.x > 0.0 and inner.size.y > 0.0:
						draw_rect(inner, fill)
					elif border <= 0.0:
						draw_rect(rect, fill)
					_hits.append({"shape": "rect", "set": set_index, "index": index, "rect": Rect2(rect.position.x, min(target, base), rect.size.x, abs(base - target)), "at": Vector2(rect.get_center().x, target), "value": float(number), "color": item["fill"], "border": item["stroke"]})
		draw_line(Vector2(plot.position.x, plot.position.y), Vector2(plot.position.x, plot.end.y), AXIS, 1.0)
		draw_line(Vector2(plot.position.x, plot.end.y), Vector2(plot.end.x, plot.end.y), AXIS, 1.0)
		var ascent := font.get_ascent(TICK_SIZE)
		var middle := (font.get_ascent(TICK_SIZE) - font.get_descent(TICK_SIZE)) * 0.5
		for value in ticks:
			var y: float = to_y.call(value)
			var text := _label_text(value)
			var width := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, TICK_SIZE).x
			draw_string(font, Vector2(plot.position.x - TICK_MARK - TICK_PAD - width, y + middle), text, HORIZONTAL_ALIGNMENT_LEFT, -1, TICK_SIZE, INK)
		var stride := 1
		if count > 1:
			var w := widest + 3.0
			var h := TICK_LINE + 3.0
			var tick_size := w
			if rotation > 0.0:
				tick_size = w / cos(rotation) if h * cos(rotation) > w * sin(rotation) else h / sin(rotation)
			var limit: int = int(floor(min(plot.size.x / max(1.0, tick_size) + (1.0 if line else 0.0), size.x / max(1.0, tick_size))))
			limit = max(1, limit)
			stride = int(ceil(max(float(count) / float(limit), 1.0)))
		for index in range(0, count, stride):
			var x: float = x_of.call(index)
			var text := labels[index]
			var width: float = label_sizes[index]
			if rotation == 0.0:
				draw_string(font, Vector2(x - width * 0.5, plot.end.y + TICK_MARK + TICK_PAD + ascent), text, HORIZONTAL_ALIGNMENT_LEFT, -1, TICK_SIZE, INK)
			else:
				draw_set_transform(Vector2(x, plot.end.y + TICK_MARK + TICK_PAD), -rotation, Vector2.ONE)
				draw_string(font, Vector2(-width, middle), text, HORIZONTAL_ALIGNMENT_LEFT, -1, TICK_SIZE, INK)
				draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
		_draw_tooltip()

	func _draw_curve(points: Array, color: Color) -> void:
		var run: Array[Vector2] = []
		var runs: Array = []
		for point in points:
			if point == null:
				if run.size() > 0:
					runs.append(run)
				run = []
			else:
				run.append(point)
		if run.size() > 0:
			runs.append(run)
		for entry in runs:
			var pts: Array[Vector2] = entry
			if pts.size() < 2:
				continue
			var controls: Array = []
			for index in range(pts.size()):
				var previous: Vector2 = pts[max(0, index - 1)]
				var current: Vector2 = pts[index]
				var following: Vector2 = pts[min(pts.size() - 1, index + 1)]
				var d01 := previous.distance_to(current)
				var d12 := current.distance_to(following)
				var s01 := d01 / (d01 + d12) if d01 + d12 > 0.0 else 0.0
				var s12 := d12 / (d01 + d12) if d01 + d12 > 0.0 else 0.0
				var fa := 0.4 * s01
				var fb := 0.4 * s12
				controls.append([current - (following - previous) * fa, current + (following - previous) * fb])
			var curve := PackedVector2Array()
			curve.append(pts[0])
			for index in range(pts.size() - 1):
				var p0: Vector2 = pts[index]
				var p1: Vector2 = (controls[index] as Array)[1]
				var p2: Vector2 = (controls[index + 1] as Array)[0]
				var p3: Vector2 = pts[index + 1]
				p1.y = clamp(p1.y, 0.0, size.y)
				p2.y = clamp(p2.y, 0.0, size.y)
				for step in range(1, 17):
					var t := float(step) / 16.0
					var u := 1.0 - t
					curve.append(p0 * u * u * u + p1 * 3.0 * u * u * t + p2 * 3.0 * u * t * t + p3 * t * t * t)
			draw_polyline(curve, color, 2.0, true)

	func _draw_tooltip() -> void:
		if _hover_set < 0 or _hover_index < 0:
			return
		var active: Dictionary = {}
		for hit in _hits:
			var entry: Dictionary = hit
			if int(entry["set"]) == _hover_set and int(entry["index"]) == _hover_index:
				active = entry
		if active.is_empty():
			return
		var pie := kind == "pie" or kind == "doughnut"
		var title := "" if pie else labels[_hover_index]
		var body := " " + _label_text(float(active["value"]))
		var pad := 10.0
		var title_line := 14.4
		var body_line := 14.4
		var box := 12.0
		var width: float = max(bold.get_string_size(title, HORIZONTAL_ALIGNMENT_LEFT, -1, 12).x if not title.is_empty() else 0.0, font.get_string_size(body, HORIZONTAL_ALIGNMENT_LEFT, -1, 12).x + box + 2.0) + pad * 2.0
		var height := pad * 2.0 + body_line + ((title_line + 6.0) if not title.is_empty() else 0.0)
		var caret_at: Vector2 = active["at"]
		var y_align := "center"
		if caret_at.y < height / 2.0:
			y_align = "top"
		elif caret_at.y > size.y - height / 2.0:
			y_align = "bottom"
		var x_align := "center"
		if y_align == "center":
			x_align = "left" if caret_at.x <= size.x / 2.0 else "right"
		elif caret_at.x <= width / 2.0:
			x_align = "left"
		elif caret_at.x >= size.x - width / 2.0:
			x_align = "right"
		var reach := 7.0
		if x_align == "left" and caret_at.x + width + reach > size.x:
			x_align = "center"
		elif x_align == "right" and caret_at.x - width - reach < 0.0:
			x_align = "center"
		var x := caret_at.x
		if x_align == "right":
			x -= width
		elif x_align == "center":
			x -= width / 2.0
		var y := caret_at.y
		if y_align == "top":
			y += reach
		elif y_align == "bottom":
			y -= height + reach
		else:
			y -= height / 2.0
		if y_align == "center":
			x += reach if x_align == "left" else (-reach if x_align == "right" else 0.0)
		elif x_align == "left":
			x -= 8.0 + 5.0
		elif x_align == "right":
			x += 8.0 + 5.0
		x = clamp(x, 0.0, max(0.0, size.x - width))
		y = clamp(y, 0.0, max(0.0, size.y - height))
		var style := StyleBoxFlat.new()
		style.bg_color = Color(17 / 255.0, 17 / 255.0, 19 / 255.0, 0.95)
		style.border_color = Color(1, 1, 1, 0.12)
		style.set_border_width_all(1)
		style.set_corner_radius_all(8)
		style.anti_aliasing = true
		draw_style_box(style, Rect2(x, y, width, height))
		var caret := PackedVector2Array()
		if y_align == "top":
			caret = PackedVector2Array([Vector2(caret_at.x - 5.0, y), Vector2(caret_at.x, y - 5.0), Vector2(caret_at.x + 5.0, y)])
		elif y_align == "bottom":
			caret = PackedVector2Array([Vector2(caret_at.x - 5.0, y + height), Vector2(caret_at.x, y + height + 5.0), Vector2(caret_at.x + 5.0, y + height)])
		elif x_align == "left":
			caret = PackedVector2Array([Vector2(x, caret_at.y - 5.0), Vector2(x - 5.0, caret_at.y), Vector2(x, caret_at.y + 5.0)])
		elif x_align == "right":
			caret = PackedVector2Array([Vector2(x + width, caret_at.y - 5.0), Vector2(x + width + 5.0, caret_at.y), Vector2(x + width, caret_at.y + 5.0)])
		if caret.size() == 3:
			draw_colored_polygon(caret, style.bg_color)
		var line_y := y + pad
		var ascent := font.get_ascent(12)
		if not title.is_empty():
			draw_string(bold, Vector2(x + pad, line_y + (title_line - 12.0 * 1.15) * 0.5 + bold.get_ascent(12)), title, HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color(1, 1, 1, 0.85))
			line_y += title_line + 6.0
		var swatch := Rect2(x + pad, line_y + (body_line - box) * 0.5, box, box)
		draw_rect(swatch, Color(1, 1, 1))
		draw_rect(swatch, active["border"], false, 1.0)
		draw_rect(Rect2(swatch.position.x + 1.0, swatch.position.y + 1.0, box - 2.0, box - 2.0), active["color"])
		draw_string(font, Vector2(x + pad + box + 2.0, line_y + (body_line - 12.0 * 1.15) * 0.5 + ascent), body, HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color(1, 1, 1, 0.6))
