class_name ActionsPanel
extends PanelFrame

signal open_advisor(text: String)

const PANEL_WIDTH := 420.0
const SURFACE := Color(24 / 255.0, 24 / 255.0, 27 / 255.0, 0.95)
const SURFACE_BORDER := Color(1, 1, 1, 0.1)
const BRAINSTORM_TEXT := "Let's brainstorm a plan of concrete actions for this round. Ask me what I'm trying to accomplish, then propose specific ones we can queue."
const GOAL_HINT := "Your advisor, the time skip and the AI suggestions steer by it. Foreign leaders never see it."
const GOAL_LOCKED := "A turn is running. The goal can be changed once it ends."
const GOAL_PLACEHOLDER := "What is your government steering toward? e.g. Keep out of the war and grow the economy"
const GOAL_FAILED := "The goal could not be saved. Try again."
const TURN_RUNNING_NOTE := "A turn is running. This can be changed once it ends."
const ORDER_NOT_SAVED := "Your order could not be saved, so the next time skip would not see it. Try again."
const ORDER_NOT_REMOVED := "The order could not be removed, so the next time skip would still carry it out. Try again."
const COMPOSER_HINT := "Enter your action…  (Shift+Enter for a new line)"
const ADVISOR_MISSING := "The advisor is not in the native app yet."
const REPORT_SAVE_TIP := "Saves the diagnostics log as a file, with this error's details at the top. Attach the file to your bug report."
const REPORT_COPY_TIP := "Copies this error's details. Diagnostics logging is off — turn it on in Settings → Diagnostics to save the full log instead."
const REPORT_SAVE_LABELS := {"working": "Saving…", "saved": "✓ Saved — attach the file to your report", "copied": "✓ Log copied — paste it into your report", "failed": "Couldn't save — try again", "idle": "💾 Save logging file"}
const REPORT_COPY_LABELS := {"working": "Copying…", "copied": "✓ Copied!", "failed": "Couldn't copy — try again", "idle": "Copy for a bug report"}
const AMBER := Color(253 / 255.0, 186 / 255.0, 116 / 255.0, 0.9)
const ZINC := Color("#e4e4e7")
const BLUE := Color("#3b82f6")
const BLUE_HOVER := Color("#2563eb")
const BLUE_DIM := Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.3)
const RED := Color(239 / 255.0, 68 / 255.0, 68 / 255.0)
const NATURAL_LEADING := 1.12
const GLYPHS := {
	"sparkle": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M12 2L13.5 9.5L21 11L13.5 12.5L12 20L10.5 12.5L3 11L10.5 9.5L12 2Z'/></svg>",
	"stop": "<svg viewBox='0 0 24 24' fill='#fff'><rect x='6' y='6' width='12' height='12' rx='2'/></svg>",
	"send": "<svg viewBox='0 0 24 24' fill='#fff'><path d='M2.01 21L23 12 2.01 3 2 10l15 2-15 2z'/></svg>",
}

static var _glyph_cache := {}
static var _italic_cache := {}

var engine: EngineLink
var context := {}
var _view := {}
var _stamp := ""
var _turn_running := false
var _logging_on := true
var _last_round := -1
var _poll: Timer
var _polling := false
var _goal_holder: VBoxContainer
var _goal_mode := ""
var _goal_shown := ""
var _goal_editing := false
var _goal_draft := ""
var _goal_saving := false
var _goal_error := ""
var _goal_edit: TextEdit
var _goal_save: Button
var _goal_clear: Button
var _goal_note: Label
var _brainstorm: Button
var _suggest_button: Button
var _suggest_spinner: ActionsSpinner
var _sections: VBoxContainer
var _list_scroller: ScrollContainer
var _list_owner := ""
var _has_requested := false
var _is_suggesting := false
var _suggestion_error := ""
var _suggestion_fallback := {}
var _open_section := "submitted"
var _notes_margin: MarginContainer
var _notes: VBoxContainer
var _save_error := ""
var _improve_failure := {}
var _report_states := {}
var _composer: TextEdit
var _composer_style: StyleBoxFlat
var _improve_button: Button
var _submit_button: Button
var _submit_icon: TextureRect
var _submit_spinner: ActionsSpinner
var _is_improving := false
var _improve_call := 0
var _is_submitting := false


func _init() -> void:
	super._init("Actions", "", "bottom", PANEL_WIDTH)
	set_tint(SURFACE)
	radius = 16.0
	border = SURFACE_BORDER
	_material.set_shader_parameter("radius", 16.0)
	_material.set_shader_parameter("border_color", SURFACE_BORDER)
	_material.set_shader_parameter("highlight", 0.06)
	_material.set_shader_parameter("blur_px", 8.0)
	_restyle_close()
	scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	var margin := scroll.get_child(0) as MarginContainer
	for side in [["margin_left", 20], ["margin_right", 20], ["margin_top", 14], ["margin_bottom", 14]]:
		margin.add_theme_constant_override(side[0], side[1])
	margin.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_theme_constant_override("separation", 14)
	_goal_holder = VBoxContainer.new()
	_goal_holder.add_theme_constant_override("separation", 0)
	body.add_child(_goal_holder)
	body.add_child(_build_buttons())
	_sections = VBoxContainer.new()
	_sections.add_theme_constant_override("separation", 14)
	_sections.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_child(_sections)
	var column := scroll.get_parent() as VBoxContainer
	_notes_margin = MarginContainer.new()
	for side in [["margin_left", 20], ["margin_right", 20], ["margin_top", 0], ["margin_bottom", 0]]:
		_notes_margin.add_theme_constant_override(side[0], side[1])
	_notes = VBoxContainer.new()
	_notes.add_theme_constant_override("separation", 0)
	_notes_margin.add_child(_notes)
	_notes_margin.visible = false
	column.add_child(_notes_margin)
	column.add_child(_build_composer())
	_poll = Timer.new()
	_poll.wait_time = 0.8
	_poll.timeout.connect(_on_poll)
	add_child(_poll)
	_render_goal()
	_render_sections()


func _ready() -> void:
	get_viewport().size_changed.connect(func() -> void:
		if _open:
			offset_top = -BOTTOM_GAP - _height()
			offset_bottom = -BOTTOM_GAP)


func setup(link: EngineLink, ctx: Dictionary = {}) -> void:
	engine = link
	context = ctx


func open() -> void:
	set_open(true)


func close() -> void:
	set_open(false)


func set_open(open: bool) -> void:
	var was := _open
	_open = open
	var height := _height()
	var tween := create_tween().set_parallel(true).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	tween.tween_property(self, "offset_top", -BOTTOM_GAP - height if open else 200.0, 0.35)
	tween.tween_property(self, "offset_bottom", -BOTTOM_GAP if open else 200.0 + height, 0.35)
	tween.tween_property(self, "modulate:a", 1.0 if open else 0.0, 0.35)
	mouse_filter = Control.MOUSE_FILTER_STOP if open else Control.MOUSE_FILTER_IGNORE
	if open and not was:
		_has_requested = false
		_suggestion_error = ""
		_save_error = ""
		_render_notes()
		_render_sections()
		_poll.start()
		refresh()
	elif not open and was:
		_poll.stop()
		_goal_editing = false
		_goal_error = ""
		_render_goal()


func refresh(force := true) -> void:
	if engine == null:
		return
	_sync_advisor()
	var reply: Dictionary = await engine.request("actions.read", {"force": force})
	if reply.get("ok", false):
		_apply_view(reply["result"])


func _restyle_close() -> void:
	var row := header_extra.get_parent()
	var close_button := row.get_child(header_extra.get_index() + 1) as Button
	if close_button == null:
		return
	close_button.flat = false
	close_button.icon = null
	close_button.text = "✕"
	close_button.tooltip_text = ""
	close_button.add_theme_font_override("font", UI.font(400))
	close_button.add_theme_font_size_override("font_size", 18)
	var rest := UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 6, 0, Vector4(5, 2, 5, 2))
	var lit := UI.box(Color(1, 1, 1, 0.08), Color(0, 0, 0, 0), 6, 0, Vector4(5, 2, 5, 2))
	for state in [["normal", rest], ["focus", rest], ["disabled", rest], ["hover", lit], ["pressed", lit], ["hover_pressed", lit]]:
		close_button.add_theme_stylebox_override(state[0], state[1])
	for slot in ["font_color", "font_focus_color"]:
		close_button.add_theme_color_override(slot, Color(1, 1, 1, 0.5))
	for slot in ["font_hover_color", "font_pressed_color", "font_hover_pressed_color"]:
		close_button.add_theme_color_override(slot, UI.WHITE)


func _sync_advisor() -> void:
	var wired := not open_advisor.get_connections().is_empty()
	if wired:
		_brainstorm.disabled = false
		_brainstorm.modulate = Color(1, 1, 1, 1)
		_brainstorm.tooltip_text = ""
		_brainstorm.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	else:
		UI.set_disabled_look(_brainstorm, ADVISOR_MISSING)


func _height() -> float:
	var viewport_height := get_viewport_rect().size.y if is_inside_tree() else 900.0
	return maxf(160.0, minf(viewport_height - 144.0, maxf(viewport_height - 256.0, 480.0)))


func _apply_view(view: Variant) -> void:
	if typeof(view) != TYPE_DICTIONARY:
		return
	_view = view
	_stamp = str(_view.get("stamp", _stamp))
	_turn_running = bool(_view.get("busy", false))
	_logging_on = bool(_view.get("loggingOn", _logging_on))
	_last_round = int(_view.get("round", 0))
	_render_goal()
	_render_sections()
	_render_notes()


func _on_poll() -> void:
	if engine == null or not _open or _polling:
		return
	_polling = true
	var reply: Dictionary = await engine.request("actions.busy")
	_polling = false
	if not reply.get("ok", false) or typeof(reply["result"]) != TYPE_DICTIONARY:
		return
	var state: Dictionary = reply["result"]
	var busy := bool(state.get("busy", false))
	var current_round := int(state.get("round", 0))
	var stamp := str(state.get("stamp", ""))
	if current_round > 0 and _last_round > 0 and current_round != _last_round:
		_last_round = current_round
		await refresh(true)
		return
	if not stamp.is_empty() and not _stamp.is_empty() and stamp != _stamp:
		_stamp = stamp
		await refresh(false)
		return
	if busy != _turn_running:
		_turn_running = busy
		_render_goal()
		_render_sections()


static func _clear(node: Node) -> void:
	for child in node.get_children():
		node.remove_child(child)
		child.queue_free()


static func _glyph(name: String, size: int, color: Color) -> Texture2D:
	var key := "%s:%d:%s" % [name, size, color.to_html()]
	if _glyph_cache.has(key):
		var cached: Texture2D = _glyph_cache[key]
		return cached
	var svg: String = GLYPHS.get(name, "")
	svg = svg.replace("#fff", "#" + color.to_html(false))
	var image := Image.new()
	if image.load_svg_from_string(svg, float(size) / 24.0) != OK:
		return null
	if color.a < 1.0:
		image.convert(Image.FORMAT_RGBA8)
		for y in range(image.get_height()):
			for x in range(image.get_width()):
				var pixel := image.get_pixel(x, y)
				pixel.a *= color.a
				image.set_pixel(x, y, pixel)
	var texture := ImageTexture.create_from_image(image)
	_glyph_cache[key] = texture
	return texture


static func _italic(weight := 400) -> Font:
	if _italic_cache.has(weight):
		var cached: Font = _italic_cache[weight]
		return cached
	var system := SystemFont.new()
	system.font_names = PackedStringArray(["Arial", "Segoe UI", "Helvetica", "Liberation Sans", "Segoe UI Emoji", "Segoe UI Symbol", "sans-serif"])
	system.font_weight = weight
	system.font_italic = true
	system.antialiasing = TextServer.FONT_ANTIALIASING_GRAY
	system.hinting = TextServer.HINTING_LIGHT
	_italic_cache[weight] = system
	return system


static func _style(bg: Color, border_color: Color, corner: int, margin: Vector4) -> StyleBoxFlat:
	return UI.box(bg, border_color, corner, 1, margin)


static func _styled_button(text: String, size: int, weight: int, ink: Color, normal: StyleBoxFlat, hover: StyleBoxFlat = null, disabled_ink := Color(0, 0, 0, 0)) -> Button:
	var button := Button.new()
	button.text = text
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var lit: StyleBoxFlat = hover if hover != null else normal
	for state in [["normal", normal], ["focus", normal], ["disabled", normal], ["hover", lit], ["pressed", lit], ["hover_pressed", lit]]:
		button.add_theme_stylebox_override(state[0], state[1])
	button.add_theme_font_override("font", UI.font(weight))
	button.add_theme_font_size_override("font_size", size)
	for slot in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		button.add_theme_color_override(slot, ink)
	button.add_theme_color_override("font_disabled_color", disabled_ink if disabled_ink.a > 0.0 else ink)
	return button


static func _leading(label: Label, size: int, line_height: float) -> Control:
	var extra := maxf(0.0, float(size) * (line_height - NATURAL_LEADING))
	label.add_theme_constant_override("line_spacing", int(round(extra)))
	var holder := MarginContainer.new()
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.add_theme_constant_override("margin_top", int(round(extra * 0.5)))
	holder.add_theme_constant_override("margin_bottom", int(round(extra * 0.5)))
	holder.add_child(label)
	return holder


static func _text(text: String, size: int, color: Color, weight := 400, line_height := 0.0, lines := 0) -> Control:
	var label := UI.wrapped(text, size, color, weight, lines)
	if line_height <= 0.0:
		return label
	return _leading(label, size, line_height)


static func _text_edit(placeholder: String, size: int) -> TextEdit:
	var edit := TextEdit.new()
	edit.placeholder_text = placeholder
	edit.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	edit.add_theme_font_override("font", UI.font(400))
	edit.add_theme_font_size_override("font_size", size)
	edit.add_theme_color_override("font_color", UI.WHITE)
	edit.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.4))
	edit.add_theme_color_override("caret_color", UI.WHITE)
	edit.add_theme_constant_override("line_spacing", int(round(float(size) * (1.45 - NATURAL_LEADING))))
	return edit


static func _send_key(event: InputEvent) -> int:
	if not (event is InputEventKey):
		return 0
	var key := event as InputEventKey
	if not key.pressed or key.echo:
		return 0
	if key.keycode == KEY_ENTER or key.keycode == KEY_KP_ENTER:
		return 2 if key.shift_pressed else 1
	if key.keycode == KEY_ESCAPE:
		return 3
	return 0


func _build_buttons() -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	_brainstorm = _styled_button("Brainstorm", 13, 500, ZINC, _style(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.2), 10, Vector4(16, 9, 16, 9)), _style(Color(1, 1, 1, 0.1), Color(1, 1, 1, 0.28), 10, Vector4(16, 9, 16, 9)))
	_brainstorm.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_brainstorm.size_flags_stretch_ratio = 1.0
	_brainstorm.custom_minimum_size.y = 37
	_brainstorm.pressed.connect(func() -> void: open_advisor.emit(BRAINSTORM_TEXT))
	row.add_child(_brainstorm)
	_suggest_button = _styled_button("", 13, 400, Color(1, 1, 1, 0.82), _style(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.12), 10, Vector4(16, 8, 16, 8)), _style(Color(1, 1, 1, 0.09), Color(1, 1, 1, 0.18), 10, Vector4(16, 8, 16, 8)))
	_suggest_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_suggest_button.size_flags_stretch_ratio = 1.0
	_suggest_button.custom_minimum_size.y = 37
	var content := HBoxContainer.new()
	content.alignment = BoxContainer.ALIGNMENT_CENTER
	content.add_theme_constant_override("separation", 8)
	content.mouse_filter = Control.MOUSE_FILTER_IGNORE
	content.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_suggest_spinner = ActionsSpinner.new(14.0)
	_suggest_spinner.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_suggest_spinner.visible = false
	content.add_child(_suggest_spinner)
	var caption := UI.label("AI Suggestions", 13, Color(1, 1, 1, 0.82))
	caption.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	content.add_child(caption)
	_suggest_button.add_child(content)
	_suggest_button.pressed.connect(_refresh_suggestions)
	row.add_child(_suggest_button)
	return row


func _build_composer() -> Control:
	var bar := PanelContainer.new()
	var style := UI.box(Color(0, 0, 0, 0.2), Color(0, 0, 0, 0), 0, 0, Vector4(16, 12, 16, 12))
	style.border_color = Color(1, 1, 1, 0.07)
	style.border_width_top = 1
	style.corner_radius_bottom_left = 16
	style.corner_radius_bottom_right = 16
	bar.add_theme_stylebox_override("panel", style)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	var holder := Control.new()
	holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	holder.custom_minimum_size.y = 62
	_composer = _text_edit(COMPOSER_HINT, 13)
	_composer.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_composer_style = _style(Color(0, 0, 0, 0.2), Color(1, 1, 1, 0.15), 10, Vector4(14, 11, 45, 11))
	_composer.add_theme_stylebox_override("normal", _composer_style)
	_composer.add_theme_stylebox_override("focus", _style(Color(0, 0, 0, 0.2), Color(1, 1, 1, 0.25), 10, Vector4(14, 11, 45, 11)))
	_composer.focus_exited.connect(func() -> void: _composer_style.border_color = Color(1, 1, 1, 0.12))
	_composer.get_v_scroll_bar().modulate.a = 0.0
	_composer.text_changed.connect(_update_composer)
	_composer.gui_input.connect(_on_composer_key)
	holder.add_child(_composer)
	_improve_button = Button.new()
	_improve_button.flat = true
	_improve_button.focus_mode = Control.FOCUS_NONE
	_improve_button.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_improve_button.anchor_left = 1.0
	_improve_button.anchor_right = 1.0
	_improve_button.offset_left = -36
	_improve_button.offset_right = -7
	_improve_button.offset_top = 9
	_improve_button.offset_bottom = 38
	var clear := StyleBoxEmpty.new()
	for state in ["normal", "hover", "pressed", "focus", "disabled", "hover_pressed"]:
		_improve_button.add_theme_stylebox_override(state, clear)
	_improve_button.pressed.connect(func() -> void:
		if _is_improving:
			_stop_improve()
		else:
			_improve())
	holder.add_child(_improve_button)
	row.add_child(holder)
	_submit_button = Button.new()
	_submit_button.focus_mode = Control.FOCUS_NONE
	_submit_button.custom_minimum_size = Vector2(35, 35)
	_submit_button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_submit_button.pressed.connect(_submit)
	_submit_icon = TextureRect.new()
	_submit_icon.texture = _glyph("send", 16, UI.WHITE)
	_submit_icon.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
	_submit_icon.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_submit_icon.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_submit_button.add_child(_submit_icon)
	var spinner_holder := CenterContainer.new()
	spinner_holder.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	spinner_holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_submit_spinner = ActionsSpinner.new(14.0)
	_submit_spinner.visible = false
	spinner_holder.add_child(_submit_spinner)
	_submit_button.add_child(spinner_holder)
	row.add_child(_submit_button)
	bar.add_child(row)
	_update_composer()
	return bar


func _update_composer() -> void:
	var filled := not _composer.text.strip_edges().is_empty()
	var can_send := filled and not _is_submitting and not _is_improving
	_improve_button.icon = _glyph("stop" if _is_improving else "sparkle", 16, ZINC if _is_improving or filled else Color(1, 1, 1, 0.45))
	_improve_button.tooltip_text = "Stop generating" if _is_improving else "Improve action text"
	_improve_button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if _is_improving or filled else Control.CURSOR_ARROW
	var normal := UI.box(BLUE if can_send else BLUE_DIM, Color(0, 0, 0, 0), 10, 0)
	var hover := UI.box(BLUE_HOVER if can_send else BLUE_DIM, Color(0, 0, 0, 0), 10, 0)
	for state in [["normal", normal], ["focus", normal], ["disabled", normal], ["hover", hover], ["pressed", hover], ["hover_pressed", hover]]:
		_submit_button.add_theme_stylebox_override(state[0], state[1])
	_submit_button.disabled = not can_send
	_submit_button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if can_send else Control.CURSOR_FORBIDDEN
	_submit_icon.visible = not _is_submitting
	_submit_spinner.visible = _is_submitting


func _on_composer_key(event: InputEvent) -> void:
	var kind := _send_key(event)
	if kind == 1:
		_composer.accept_event()
		_submit()
	elif kind == 2:
		_composer.accept_event()
		_composer.insert_text_at_caret("\n")


func _render_notes() -> void:
	_clear(_notes)
	if not _improve_failure.is_empty():
		var reason := str(_improve_failure.get("reason", ""))
		var text := "Improve failed, so your text was left as you wrote it: %s" % reason if not reason.is_empty() else "Improve failed, so your text was left as you wrote it."
		var pad := MarginContainer.new()
		pad.add_theme_constant_override("margin_bottom", 8)
		pad.add_child(_failure_note(text, "improve-failed", "Improve action failed", _improve_failure))
		_notes.add_child(pad)
	if not _save_error.is_empty():
		var pad := MarginContainer.new()
		pad.add_theme_constant_override("margin_bottom", 8)
		pad.add_child(_text(_save_error, 12, AMBER, 400, 1.45))
		_notes.add_child(pad)
	_notes_margin.visible = _notes.get_child_count() > 0


func _failure_note(text: String, kind: String, title: String, failure: Dictionary) -> Control:
	var row := HFlowContainer.new()
	row.add_theme_constant_override("h_separation", 6)
	row.add_theme_constant_override("v_separation", 6)
	var words := _text(text, 12, AMBER, 400, 1.45)
	words.custom_minimum_size.x = 192
	words.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	words.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(words)
	if not failure.is_empty():
		row.add_child(_report_button(kind, title, failure))
	return row


func _report_button(kind: String, title: String, failure: Dictionary) -> Button:
	var state: String = _report_states.get(kind, "idle")
	var labels: Dictionary = REPORT_SAVE_LABELS if _logging_on else REPORT_COPY_LABELS
	var button := _styled_button(str(labels.get(state, labels["idle"])), 11, 600, Color("#fde68a"), _style(Color(0, 0, 0, 0), Color(251 / 255.0, 191 / 255.0, 36 / 255.0, 0.3), 6, Vector4(8, 3, 8, 3)))
	button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	button.tooltip_text = REPORT_SAVE_TIP if _logging_on else REPORT_COPY_TIP
	button.disabled = state == "working"
	if button.disabled:
		button.mouse_default_cursor_shape = Control.CURSOR_ARROW
	button.pressed.connect(func() -> void: _send_report(kind, title, failure))
	return button


func _send_report(kind: String, title: String, failure: Dictionary) -> void:
	if engine == null or str(_report_states.get(kind, "idle")) == "working":
		return
	_report_states[kind] = "working"
	_render_reports()
	var reply: Dictionary = await engine.request("actions.report", {"kind": kind, "title": title, "reason": str(failure.get("reason", "")), "rawResponse": str(failure.get("rawResponse", ""))})
	var state := "failed"
	if reply.get("ok", false) and typeof(reply["result"]) == TYPE_DICTIONARY:
		var result: Dictionary = reply["result"]
		state = str(result.get("state", "failed"))
		_logging_on = bool(result.get("loggingOn", _logging_on))
		var text := str(result.get("text", ""))
		if state == "copied" and not text.is_empty():
			DisplayServer.clipboard_set(text)
	_report_states[kind] = state
	_render_reports()
	await get_tree().create_timer(3.0).timeout
	_report_states[kind] = "idle"
	_render_reports()


func _render_reports() -> void:
	_render_notes()
	if _open_section == "suggested":
		_render_sections()


func _render_goal() -> void:
	var country := str(_view.get("country", ""))
	var goal := str(_view.get("goal", ""))
	var mode := "" if country.is_empty() else ("edit" if _goal_editing else ("set" if not goal.is_empty() else "empty"))
	var key := "%s|%s|%s" % [mode, goal, str(_turn_running)]
	if mode == "edit" and _goal_mode == "edit" and is_instance_valid(_goal_edit):
		_goal_shown = key
		_update_goal_editor()
		return
	if key == _goal_shown and mode == _goal_mode:
		return
	_goal_mode = mode
	_goal_shown = key
	_clear(_goal_holder)
	_goal_edit = null
	_goal_save = null
	_goal_clear = null
	_goal_note = null
	_goal_holder.visible = not mode.is_empty()
	match mode:
		"empty":
			_goal_holder.add_child(_goal_prompt())
		"set":
			_goal_holder.add_child(_goal_card(goal))
		"edit":
			_goal_holder.add_child(_goal_editor(goal))


func _goal_prompt() -> Control:
	var button := ActionsDashedButton.new()
	button.text = "🎯 Set a standing goal"
	button.alignment = HORIZONTAL_ALIGNMENT_LEFT
	button.focus_mode = Control.FOCUS_NONE
	button.custom_minimum_size.y = 33
	var empty := UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 10, 0, Vector4(14, 8, 14, 8))
	for state in ["normal", "hover", "pressed", "focus", "disabled", "hover_pressed"]:
		button.add_theme_stylebox_override(state, empty)
	button.add_theme_font_override("font", UI.font(400))
	button.add_theme_font_size_override("font_size", 12)
	var ink := Color(1, 1, 1, 0.45) if _turn_running else ZINC
	for slot in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color", "font_disabled_color"]:
		button.add_theme_color_override(slot, ink)
	button.disabled = _turn_running
	button.tooltip_text = GOAL_LOCKED if _turn_running else GOAL_HINT
	button.mouse_default_cursor_shape = Control.CURSOR_FORBIDDEN if _turn_running else Control.CURSOR_POINTING_HAND
	button.pressed.connect(_start_goal_editing)
	return button


func _goal_label() -> Label:
	return UI.label("STANDING GOAL", 12, Color(1, 1, 1, 0.9), 700, "Arial", 1)


func _goal_card(goal: String) -> Control:
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", _style(Color(1, 1, 1, 0.08), Color(1, 1, 1, 0.15), 10, Vector4(12, 9, 12, 9)))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 5)
	var row := HBoxContainer.new()
	var label := _goal_label()
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(label)
	var edit := Button.new()
	edit.text = "Edit"
	edit.flat = false
	edit.focus_mode = Control.FOCUS_NONE
	var empty := StyleBoxEmpty.new()
	for state in ["normal", "hover", "pressed", "focus", "disabled", "hover_pressed"]:
		edit.add_theme_stylebox_override(state, empty)
	edit.add_theme_font_override("font", UI.font(400))
	edit.add_theme_font_size_override("font_size", 12)
	var ink := Color(1, 1, 1, 0.18) if _turn_running else Color(1, 1, 1, 0.28)
	for slot in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color", "font_disabled_color"]:
		edit.add_theme_color_override(slot, ink)
	edit.disabled = _turn_running
	edit.tooltip_text = GOAL_LOCKED if _turn_running else "Change or clear the goal"
	edit.mouse_default_cursor_shape = Control.CURSOR_FORBIDDEN if _turn_running else Control.CURSOR_POINTING_HAND
	edit.pressed.connect(_start_goal_editing)
	row.add_child(edit)
	column.add_child(row)
	var words := UI.wrapped("🎯 " + goal, 13, Color(1, 1, 1, 0.82), 400, 3)
	words.tooltip_text = goal
	words.mouse_filter = Control.MOUSE_FILTER_PASS
	column.add_child(_leading(words, 13, 1.45))
	card.add_child(column)
	return card


func _goal_editor(goal: String) -> Control:
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", _style(Color(1, 1, 1, 0.08), Color(1, 1, 1, 0.18), 10, Vector4(12, 10, 12, 10)))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 7)
	column.add_child(_goal_label())
	_goal_edit = _text_edit(GOAL_PLACEHOLDER, 13)
	_goal_edit.custom_minimum_size.y = 58
	var field := _style(Color(0, 0, 0, 0.25), Color(1, 1, 1, 0.15), 8, Vector4(10, 8, 10, 8))
	_goal_edit.add_theme_stylebox_override("normal", field)
	_goal_edit.add_theme_stylebox_override("focus", field)
	_goal_edit.get_v_scroll_bar().modulate.a = 0.0
	_goal_edit.text = _goal_draft
	_goal_edit.text_changed.connect(_on_goal_typed)
	_goal_edit.gui_input.connect(_on_goal_key)
	column.add_child(_goal_edit)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	if not goal.is_empty():
		_goal_clear = _goal_button("Clear goal", false)
		_goal_clear.pressed.connect(func() -> void: _save_goal(""))
		row.add_child(_goal_clear)
	row.add_child(UI.spacer())
	var cancel := _goal_button("Cancel", false)
	cancel.pressed.connect(_cancel_goal_editing)
	row.add_child(cancel)
	_goal_save = _goal_button("Save", true)
	_goal_save.pressed.connect(func() -> void: _save_goal(_goal_draft))
	row.add_child(_goal_save)
	column.add_child(row)
	_goal_note = UI.wrapped("", 12, AMBER)
	column.add_child(_goal_note)
	card.add_child(column)
	_update_goal_editor()
	_focus_goal.call_deferred()
	return card


func _goal_button(text: String, primary: bool) -> Button:
	var pad := Vector4(11, 5, 11, 5)
	var normal := _style(Color(1, 1, 1, 0.1) if primary else Color(0, 0, 0, 0), Color(1, 1, 1, 0.28) if primary else Color(1, 1, 1, 0.14), 8, pad)
	var button := _styled_button(text, 12, 600, Color(1, 1, 1, 0.9), normal, normal, Color(1, 1, 1, 0.4))
	if primary:
		button.add_theme_stylebox_override("disabled", _style(Color(1, 1, 1, 0.07), Color(1, 1, 1, 0.28), 8, pad))
	return button


func _focus_goal() -> void:
	if is_instance_valid(_goal_edit) and _goal_edit.is_inside_tree():
		_goal_edit.grab_focus()
		_goal_edit.set_caret_line(_goal_edit.get_line_count() - 1)
		_goal_edit.set_caret_column(_goal_edit.get_line(_goal_edit.get_line_count() - 1).length())


func _update_goal_editor() -> void:
	if not is_instance_valid(_goal_edit):
		return
	var goal := str(_view.get("goal", ""))
	var can_save := not _goal_saving and not _turn_running and _goal_draft.strip_edges() != goal
	_goal_save.text = "Saving…" if _goal_saving else "Save"
	_goal_save.disabled = not can_save
	_goal_save.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if can_save else Control.CURSOR_FORBIDDEN
	if is_instance_valid(_goal_clear):
		_goal_clear.disabled = _goal_saving or _turn_running
		_goal_clear.mouse_default_cursor_shape = Control.CURSOR_FORBIDDEN if _goal_clear.disabled else Control.CURSOR_POINTING_HAND
	var note := _goal_error if not _goal_error.is_empty() else (GOAL_LOCKED if _turn_running else "")
	_goal_note.text = note
	_goal_note.visible = not note.is_empty()


func _on_goal_typed() -> void:
	var limit := int(_view.get("goalMax", 600))
	if _goal_edit.text.length() > limit:
		var line := _goal_edit.get_caret_line()
		var column := _goal_edit.get_caret_column()
		_goal_edit.text = _goal_edit.text.substr(0, limit)
		_goal_edit.set_caret_line(mini(line, _goal_edit.get_line_count() - 1))
		_goal_edit.set_caret_column(column)
	_goal_draft = _goal_edit.text
	_update_goal_editor()


func _on_goal_key(event: InputEvent) -> void:
	var kind := _send_key(event)
	if kind == 1:
		_goal_edit.accept_event()
		var goal := str(_view.get("goal", ""))
		if not _goal_saving and not _turn_running and _goal_draft.strip_edges() != goal:
			_save_goal(_goal_draft)
	elif kind == 2:
		_goal_edit.accept_event()
		_goal_edit.insert_text_at_caret("\n")
	elif kind == 3:
		_goal_edit.accept_event()
		_cancel_goal_editing()


func _start_goal_editing() -> void:
	if _turn_running:
		return
	_goal_draft = str(_view.get("goal", ""))
	_goal_error = ""
	_goal_editing = true
	_render_goal()


func _cancel_goal_editing() -> void:
	_goal_editing = false
	_goal_error = ""
	_render_goal()


func _save_goal(text: String) -> void:
	if _goal_saving or engine == null:
		return
	_goal_saving = true
	_goal_error = ""
	_update_goal_editor()
	var reply: Dictionary = await engine.request("actions.goal", {"text": text})
	_goal_saving = false
	if not reply.get("ok", false):
		_goal_error = GOAL_FAILED
		_update_goal_editor()
		return
	var result: Dictionary = reply["result"] if typeof(reply["result"]) == TYPE_DICTIONARY else {}
	if result.get("locked", false):
		_goal_error = GOAL_LOCKED
		_apply_view(result)
		_update_goal_editor()
		return
	_goal_editing = false
	_apply_view(result)


func _section_header(title: String, count: int, open: bool, toggle: Callable) -> Control:
	var button := Button.new()
	button.flat = false
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.custom_minimum_size.y = 24
	var empty := StyleBoxEmpty.new()
	for state in ["normal", "hover", "pressed", "focus", "disabled", "hover_pressed"]:
		button.add_theme_stylebox_override(state, empty)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var arrow := UI.label("▼" if open else "▶", 11, Color(1, 1, 1, 0.5))
	arrow.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	arrow.custom_minimum_size = Vector2(12, 12)
	arrow.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	arrow.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	row.add_child(arrow)
	var name_label := UI.label(title.to_upper(), 12, Color(1, 1, 1, 0.9), 700, "Arial", 1)
	name_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	name_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(name_label)
	var count_label := UI.label(str(count), 12, Color(1, 1, 1, 0.45))
	count_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(count_label)
	button.add_child(row)
	button.pressed.connect(toggle)
	return button


func _list_scroll(list: VBoxContainer) -> ScrollContainer:
	var list_scroll := ScrollContainer.new()
	list_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	list_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	list_scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_SHOW_NEVER
	list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	list_scroll.add_child(list)
	return list_scroll


func _render_sections() -> void:
	if not is_instance_valid(_sections):
		return
	var kept_owner := _list_owner
	var kept_offset := _list_scroller.scroll_vertical if is_instance_valid(_list_scroller) else 0
	_list_scroller = null
	_clear(_sections)
	_suggest_spinner.visible = _is_suggesting
	var suggestions: Array = _view.get("suggestions", [])
	var submitted: Array = _view.get("submitted", [])
	var show_suggested := _has_requested or _is_suggesting or suggestions.size() > 0
	var suggested_open := show_suggested and _open_section == "suggested"
	var submitted_open := not suggested_open
	if show_suggested:
		var section := VBoxContainer.new()
		section.add_theme_constant_override("separation", 0)
		section.size_flags_vertical = Control.SIZE_EXPAND_FILL if suggested_open else Control.SIZE_SHRINK_BEGIN
		section.add_child(_section_header("Suggested Actions", suggestions.size(), suggested_open, func() -> void:
			_open_section = "submitted" if suggested_open else "suggested"
			_render_sections()))
		if suggested_open:
			var list := VBoxContainer.new()
			list.add_theme_constant_override("separation", 8)
			if not _suggestion_error.is_empty() and not _is_suggesting:
				list.add_child(_failure_note("The AI suggestions could not be generated: %s" % _suggestion_error, "suggestions-error", "AI suggestions failed", {"reason": _suggestion_error}))
			if _suggestion_error.is_empty() and _has_requested and not _is_suggesting and suggestions.is_empty():
				list.add_child(_italic_line("No AI suggestions generated yet.", 12))
			if bool(_view.get("fellBack", false)) and not _is_suggesting:
				list.add_child(_failure_note("The AI gave no usable suggestions, so these are generic ones.", "suggestions-fallback", "AI suggestions fell back", _suggestion_fallback))
			var queued: Array = _view.get("queuedIds", [])
			for topic in suggestions:
				list.add_child(_suggestion_card(topic, queued))
			_list_scroller = _list_scroll(list)
			_list_owner = "suggested"
			section.add_child(_list_scroller)
		_sections.add_child(section)
	var mine := VBoxContainer.new()
	mine.add_theme_constant_override("separation", 0)
	mine.size_flags_vertical = Control.SIZE_EXPAND_FILL if submitted_open else Control.SIZE_SHRINK_BEGIN
	if show_suggested:
		mine.add_child(_section_header("Your Submitted Actions", submitted.size(), submitted_open, func() -> void:
			_open_section = "suggested" if submitted_open else "submitted"
			_render_sections()))
	else:
		var heading := MarginContainer.new()
		heading.add_theme_constant_override("margin_bottom", 8)
		heading.add_child(UI.label("YOUR SUBMITTED ACTIONS", 12, Color(1, 1, 1, 0.9), 700, "Arial", 1))
		mine.add_child(heading)
	if submitted_open:
		var rows := VBoxContainer.new()
		rows.add_theme_constant_override("separation", 6)
		if submitted.is_empty():
			rows.add_child(_italic_line("No actions submitted yet.", 13))
		for entry in submitted:
			rows.add_child(_action_row(entry))
		_list_scroller = _list_scroll(rows)
		_list_owner = "submitted"
		mine.add_child(_list_scroller)
	_sections.add_child(mine)
	if kept_offset > 0 and kept_owner == _list_owner and is_instance_valid(_list_scroller):
		_keep_scroll(_list_scroller, kept_offset)


func _keep_scroll(target: ScrollContainer, offset: int) -> void:
	await get_tree().process_frame
	await get_tree().process_frame
	if is_instance_valid(target):
		target.scroll_vertical = offset


func _italic_line(text: String, size: int) -> Label:
	var line := UI.wrapped(text, size, Color(1, 1, 1, 0.35))
	line.add_theme_font_override("font", _italic(400))
	return line


func _suggestion_card(topic: Dictionary, queued: Array) -> Control:
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", _style(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.08), 12, Vector4(13, 11, 13, 11)))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 9)
	var head := VBoxContainer.new()
	head.add_theme_constant_override("separation", 3)
	head.add_child(UI.wrapped(str(topic.get("title", "")), 13, Color(1, 1, 1, 0.94), 700))
	head.add_child(_text(str(topic.get("description", "")), 12, Color(1, 1, 1, 0.55), 400, 1.5))
	column.add_child(head)
	var actions := VBoxContainer.new()
	actions.add_theme_constant_override("separation", 6)
	var topic_id := str(topic.get("id", ""))
	for action in topic.get("actions", []):
		var entry: Dictionary = action
		var action_id := str(entry.get("id", ""))
		var is_queued := queued.has(action_id)
		var look := _style(Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.12) if is_queued else Color(1, 1, 1, 0.04), Color(74 / 255.0, 222 / 255.0, 128 / 255.0, 0.35) if is_queued else Color(1, 1, 1, 0.12), 10, Vector4(11, 9, 11, 9))
		var choice := _clickable(look, func() -> void: _queue_suggestion(topic_id, action_id), not is_queued)
		var stack := VBoxContainer.new()
		stack.add_theme_constant_override("separation", 3)
		stack.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var title := str(entry.get("title", ""))
		stack.add_child(UI.wrapped("✓ Queued — %s" % title if is_queued else title, 12, Color(1, 1, 1, 0.9), 700))
		stack.add_child(_text(str(entry.get("text", "")), 12, Color(1, 1, 1, 0.62), 400, 1.45))
		choice.add_child(stack)
		actions.add_child(choice)
	column.add_child(actions)
	card.add_child(column)
	return card


func _clickable(look: StyleBoxFlat, action: Callable, enabled := true) -> PanelContainer:
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", look)
	card.mouse_filter = Control.MOUSE_FILTER_STOP
	card.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if enabled else Control.CURSOR_ARROW
	if enabled:
		card.gui_input.connect(func(event: InputEvent) -> void:
			if event is InputEventMouseButton:
				var press := event as InputEventMouseButton
				if press.button_index == MOUSE_BUTTON_LEFT and not press.pressed:
					action.call())
	return card


func _action_row(entry: Dictionary) -> Control:
	var locked := _turn_running and bool(entry.get("movesUnit", false))
	var normal := _style(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.07), 10, Vector4(14, 9, 14, 9))
	var hover := _style(Color(1, 1, 1, 0.08), Color(1, 1, 1, 0.07), 10, Vector4(14, 9, 14, 9))
	var row := PanelContainer.new()
	row.add_theme_stylebox_override("panel", normal)
	row.mouse_filter = Control.MOUSE_FILTER_PASS
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 8)
	var text := VBoxContainer.new()
	text.add_theme_constant_override("separation", 0)
	text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	text.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if bool(entry.get("showTitle", false)):
		var title := _text(str(entry.get("title", "")), 12, Color(1, 1, 1, 0.95), 700, 1.75)
		var title_pad := MarginContainer.new()
		title_pad.add_theme_constant_override("margin_bottom", 2)
		title_pad.add_child(title)
		text.add_child(title_pad)
	text.add_child(_text(str(entry.get("label", "")), 13, Color(1, 1, 1, 0.82), 400, 1.75))
	var meta := UI.label(("%s • %s" % [str(entry.get("kind", "")), str(entry.get("status", ""))]).to_upper(), 11, Color(1, 1, 1, 0.38), 400, "Arial", 1)
	var meta_pad := MarginContainer.new()
	meta_pad.add_theme_constant_override("margin_top", 4)
	meta_pad.add_child(_leading(meta, 11, 1.75))
	text.add_child(meta_pad)
	line.add_child(text)
	var remove := Button.new()
	remove.text = "✕"
	remove.flat = false
	remove.focus_mode = Control.FOCUS_NONE
	remove.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	remove.custom_minimum_size = Vector2(26, 24)
	remove.add_theme_font_override("font", UI.font(400))
	remove.add_theme_font_size_override("font_size", 16)
	var shown := UI.box(Color(0, 0, 0, 0) if locked else Color(RED, 0.1), Color(0, 0, 0, 0), 6, 0)
	for state in ["normal", "focus", "disabled", "hover", "pressed", "hover_pressed"]:
		remove.add_theme_stylebox_override(state, shown)
	var ink := Color(1, 1, 1, 0.18) if locked else Color(RED, 0.95)
	for slot in ["font_color", "font_focus_color", "font_pressed_color", "font_hover_color", "font_hover_pressed_color", "font_disabled_color"]:
		remove.add_theme_color_override(slot, ink)
	remove.disabled = locked
	remove.tooltip_text = TURN_RUNNING_NOTE if locked else "Delete action"
	remove.mouse_default_cursor_shape = Control.CURSOR_FORBIDDEN if locked else Control.CURSOR_POINTING_HAND
	remove.modulate.a = 0.0
	remove.pressed.connect(func() -> void: _delete(entry))
	line.add_child(remove)
	row.add_child(line)
	row.mouse_entered.connect(func() -> void:
		row.add_theme_stylebox_override("panel", hover)
		remove.modulate.a = 1.0)
	row.mouse_exited.connect(func() -> void:
		if row.get_global_rect().has_point(row.get_global_mouse_position()):
			return
		row.add_theme_stylebox_override("panel", normal)
		remove.modulate.a = 0.0)
	return row


func _refresh_suggestions() -> void:
	if _is_suggesting or engine == null:
		return
	_has_requested = true
	_open_section = "suggested"
	_is_suggesting = true
	_suggestion_error = ""
	_render_sections()
	var reply: Dictionary = await engine.request("actions.suggest")
	_is_suggesting = false
	if not reply.get("ok", false):
		_suggestion_error = str(reply.get("error", ""))
		_render_sections()
		return
	var result: Dictionary = reply["result"] if typeof(reply["result"]) == TYPE_DICTIONARY else {}
	_suggestion_fallback = {"reason": str(result.get("fallbackReason", "")), "rawResponse": str(result.get("rawResponse", ""))} if str(result.get("source", "")) == "fallback" else {}
	_apply_view(result.get("view", {}))
	_render_sections()


func _queue_suggestion(topic_id: String, action_id: String) -> void:
	if engine == null:
		return
	var reply: Dictionary = await engine.request("actions.queue", {"topicId": topic_id, "actionId": action_id})
	if not reply.get("ok", false):
		_save_error = ORDER_NOT_SAVED
		_render_notes()
		return
	var result: Dictionary = reply["result"] if typeof(reply["result"]) == TYPE_DICTIONARY else {}
	if not result.get("unusable", false):
		_save_error = ""
	_apply_view(result)


func _delete(entry: Dictionary) -> void:
	if engine == null:
		return
	if bool(entry.get("movesUnit", false)) and _turn_running:
		return
	var reply: Dictionary = await engine.request("actions.remove", {"id": str(entry.get("id", "")), "index": int(entry.get("index", -1))})
	if not reply.get("ok", false):
		_save_error = ORDER_NOT_REMOVED
		_render_notes()
		return
	var result: Dictionary = reply["result"] if typeof(reply["result"]) == TYPE_DICTIONARY else {}
	if not result.get("locked", false):
		_save_error = ""
	_apply_view(result)


func _submit() -> void:
	var trimmed := _composer.text.strip_edges()
	if trimmed.is_empty() or _is_submitting or _is_improving or engine == null:
		return
	_open_section = "submitted"
	_is_submitting = true
	_update_composer()
	_render_sections()
	var reply: Dictionary = await engine.request("actions.add", {"text": trimmed})
	_is_submitting = false
	if not reply.get("ok", false):
		_save_error = ORDER_NOT_SAVED
		_render_notes()
		_update_composer()
		return
	_save_error = ""
	_composer.text = ""
	_improve_failure = {}
	_update_composer()
	_apply_view(reply["result"])


func _improve() -> void:
	var trimmed := _composer.text.strip_edges()
	if trimmed.is_empty() or _is_improving or _is_submitting or engine == null:
		return
	_is_improving = true
	_improve_failure = {}
	_render_notes()
	_update_composer()
	_improve_call = engine.last_request_id() + 1
	var reply: Dictionary = await engine.request("actions.improve", {"text": trimmed})
	_improve_call = 0
	_is_improving = false
	if not reply.get("ok", false):
		_improve_failure = {"reason": str(reply.get("error", "")), "rawResponse": ""}
	else:
		var result: Dictionary = reply["result"] if typeof(reply["result"]) == TYPE_DICTIONARY else {}
		if result.get("aborted", false):
			pass
		elif result.get("fallback", false) or result.get("failed", false):
			_improve_failure = {"reason": str(result.get("reason", "")), "rawResponse": str(result.get("rawResponse", ""))}
		else:
			_composer.text = str(result.get("text", trimmed))
			_composer.grab_focus()
			_composer.set_caret_line(_composer.get_line_count() - 1)
			_composer.set_caret_column(_composer.get_line(_composer.get_line_count() - 1).length())
	_render_notes()
	_update_composer()


func _stop_improve() -> void:
	if _improve_call > 0 and engine != null:
		engine.cancel(_improve_call)


class ActionsSpinner extends Control:
	var tone := Color(1, 1, 1, 0.88)
	var angle := 0.0

	func _init(diameter := 14.0) -> void:
		custom_minimum_size = Vector2(diameter, diameter)
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func _process(delta: float) -> void:
		if not is_visible_in_tree():
			return
		angle = fmod(angle + delta * TAU / 0.7, TAU)
		queue_redraw()

	func _draw() -> void:
		var side := minf(size.x, size.y)
		var centre := size * 0.5
		var ring := side * 8.0 / 24.0
		var width := side * 2.2 / 24.0
		draw_arc(centre, ring, 0.0, TAU, 32, Color(1, 1, 1, 0.2), width, true)
		draw_arc(centre, ring, angle - PI * 0.5, angle, 12, tone, width, true)


class ActionsDashedButton extends Button:
	func _draw() -> void:
		var rect := Rect2(Vector2(0.5, 0.5), size - Vector2(1, 1))
		var corner := 10.0
		var ink := Color(1, 1, 1, 0.2)
		var edges := [
			[Vector2(rect.position.x + corner, rect.position.y), Vector2(rect.end.x - corner, rect.position.y)],
			[Vector2(rect.end.x, rect.position.y + corner), Vector2(rect.end.x, rect.end.y - corner)],
			[Vector2(rect.end.x - corner, rect.end.y), Vector2(rect.position.x + corner, rect.end.y)],
			[Vector2(rect.position.x, rect.end.y - corner), Vector2(rect.position.x, rect.position.y + corner)],
		]
		for edge in edges:
			draw_dashed_line(edge[0], edge[1], ink, 1.0, 3.0)
		var corners := [[rect.position + Vector2(corner, corner), PI, PI * 1.5], [Vector2(rect.end.x - corner, rect.position.y + corner), PI * 1.5, TAU], [rect.end - Vector2(corner, corner), 0.0, PI * 0.5], [Vector2(rect.position.x + corner, rect.end.y - corner), PI * 0.5, PI]]
		for arc in corners:
			draw_arc(arc[0], corner, arc[1], arc[2], 8, ink, 1.0, true)
