class_name InstitutionsView
extends VBoxContainer

signal lifecycle_chat_opened(chat_id: String)
signal council_opened(chat_id: String)
signal council_visible_changed(chat_id: String)
signal chats_changed
signal refreshed

const MOBILE_WIDTH := 700.0
const PANEL_BG := Color(1, 1, 1, 0.035)
const PANEL_BORDER := Color(1, 1, 1, 0.08)
const GREY_TEXT := Color("#e7e7ea")
const GREY_MUTED := Color(231 / 255.0, 231 / 255.0, 234 / 255.0, 0.6)
const GREY_SOFT := Color(231 / 255.0, 231 / 255.0, 234 / 255.0, 0.72)
const GREY_RAISED := Color("#232327")
const GREY_SELECTED := Color("#0e0e10")
const GREY_BORDER := Color(1, 1, 1, 0.1)
const GREY_BORDER_STRONG := Color(1, 1, 1, 0.22)
const RED_TEXT := Color("#fca5a5")
const GREEN_TEXT := Color("#86efac")
const AMBER_TEXT := Color("#fde68a")
const AMBER := Color(245 / 255.0, 158 / 255.0, 11 / 255.0)
const RED := Color(239 / 255.0, 68 / 255.0, 68 / 255.0)
const GREEN := Color(34 / 255.0, 197 / 255.0, 94 / 255.0)
const FOUNDING_DEFAULTS := {
	"name": "", "shortName": "", "kind": "security_alliance", "purpose": "", "politicalCharacter": "",
	"geographicScope": "", "primaryThreatModel": "", "votingRule": "simple-majority",
	"minimumFoundingMembers": "2", "accessionMode": "approval", "allowObserver": true,
	"withdrawalMode": "unilateral", "withdrawalNoticeDays": "0", "expulsionMode": "approval", "dissolutionMode": "approval",
	"invitees": "", "charterNote": "",
}

static var _logo_cache := {}
static var _origin := ""
static var _symbols := {}

var engine: EngineLink
var context := {}
var _model := {}
var _show_all := false
var _selected_id := ""
var _section := "overview"
var _busy := ""
var _error := ""
var _proposal_title := ""
var _proposal_summary := ""
var _founding_open := false
var _advanced := false
var _founding := FOUNDING_DEFAULTS.duplicate()
var _invite_target := ""
var _invite_status := "member"
var _invite_reason := ""
var _application_reason := ""
var _lifecycle_reason := ""
var _amend_drafts := {}
var _vote_comments := {}
var _positions_open := {}
var _member_menu := ""
var _discipline_open := false
var _history_open := false
var _unread_ids: Array = []
var _automation := {}
var _visible_council := "-"
var _loaded := false
var _load_error := ""
var _serial := 0
var _last_width := 0.0
var _live_waiting := false
var _keep_scroll := {}
var _floats: Array[Dictionary] = []
var _embedded: Control
var _focus_request := {}
var _founding_autofocus := false
var _top: VBoxContainer
var _body: VBoxContainer
var _scroll: ScrollContainer
var _confirm: ConfirmationDialog
var _confirm_action := Callable()


func _init() -> void:
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_theme_constant_override("separation", 0)
	_top = VBoxContainer.new()
	_top.add_theme_constant_override("separation", 0)
	_top.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	add_child(_top)
	_body = VBoxContainer.new()
	_body.add_theme_constant_override("separation", 0)
	_body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(_body)
	_confirm = ConfirmationDialog.new()
	_confirm.title = "Open Historia"
	_confirm.confirmed.connect(func() -> void:
		var action := _confirm_action
		_confirm_action = Callable()
		if action.is_valid():
			action.call())
	add_child(_confirm)
	set_process(false)


func _notification(what: int) -> void:
	if what == NOTIFICATION_VISIBILITY_CHANGED and engine != null and is_inside_tree():
		if is_visible_in_tree():
			_remount()
		else:
			_clear_floats()
	elif what == NOTIFICATION_RESIZED and is_inside_tree() and _loaded:
		if absf(size.x - _last_width) > 8.0:
			_render.call_deferred()
	elif what == NOTIFICATION_EXIT_TREE:
		_clear_floats()
		_release_embedded()


func _process(_delta: float) -> void:
	var alive := false
	for entry: Dictionary in _floats:
		var panel: Control = entry.get("panel")
		var anchor: Control = entry.get("anchor")
		if not is_instance_valid(panel) or not is_instance_valid(anchor) or not panel.visible:
			continue
		alive = true
		if not anchor.is_visible_in_tree():
			panel.visible = false
			continue
		var rect := anchor.get_global_rect()
		var width: float = rect.size.x if not bool(entry.get("right", false)) else maxf(float(entry.get("width", 160.0)), panel.get_combined_minimum_size().x)
		panel.size = Vector2(width, 0)
		panel.reset_size()
		panel.size.x = width
		var x := rect.position.x if not bool(entry.get("right", false)) else rect.end.x - width
		panel.global_position = Vector2(x, rect.end.y + float(entry.get("gap", 4.0)))
	if not alive:
		set_process(false)


func setup(link: EngineLink, ctx: Dictionary = {}) -> void:
	engine = link
	context = ctx
	if engine and not engine.engine_event.is_connected(_on_engine_event):
		engine.engine_event.connect(_on_engine_event)


func set_unread_ids(ids: Array) -> void:
	_unread_ids = ids.duplicate()
	if _loaded and _selected_id.is_empty():
		_render()


func focus(institution_id: String, section := "") -> void:
	if institution_id.strip_edges().is_empty():
		return
	_focus_request = {"id": institution_id.strip_edges(), "section": section.strip_edges()}
	_apply_focus()
	await refresh()


func _apply_focus() -> void:
	if _focus_request.is_empty():
		return
	_selected_id = str(_focus_request.get("id", ""))
	var section := str(_focus_request.get("section", ""))
	if not section.is_empty():
		_section = section
	_error = ""


func refresh() -> void:
	if engine == null:
		return
	_serial += 1
	var serial := _serial
	var reply: Dictionary = await engine.request("institutions.view", {"selectedId": _selected_id, "inviteStatus": _invite_status})
	if serial != _serial:
		await refreshed
		return
	if not reply.get("ok", false):
		_load_error = str(reply.get("error", ""))
		_render()
		refreshed.emit()
		return
	_load_error = ""
	_loaded = true
	var result: Variant = reply.get("result")
	_model = result if typeof(result) == TYPE_DICTIONARY else {}
	_automation.clear()
	for entry: Variant in _model.get("automation", []):
		var item: Dictionary = entry
		_automation[str(item.get("key", ""))] = item
	if not _selected_id.is_empty() and typeof(_model.get("selected")) != TYPE_DICTIONARY:
		_selected_id = ""
	_render()
	refreshed.emit()


func _remount() -> void:
	_show_all = false
	_selected_id = ""
	_section = "overview"
	_error = ""
	_proposal_title = ""
	_proposal_summary = ""
	_founding_open = false
	_advanced = false
	_founding = FOUNDING_DEFAULTS.duplicate()
	_invite_target = ""
	_invite_status = "member"
	_invite_reason = ""
	_application_reason = ""
	_lifecycle_reason = ""
	_amend_drafts = {}
	_vote_comments = {}
	_positions_open = {}
	_member_menu = ""
	_discipline_open = false
	_history_open = false
	_keep_scroll = {}
	_apply_focus()
	refresh()


func _on_engine_event(name: String, data: Variant) -> void:
	if name == "institutions.automation" and typeof(data) == TYPE_DICTIONARY:
		var item: Dictionary = data
		var key := str(item.get("key", ""))
		if bool(item.get("active", false)):
			_automation[key] = item
		else:
			_automation.erase(key)
		if _section == "council" and not _selected_id.is_empty() and is_visible_in_tree() and not _typing():
			_render()
	elif name == "institutions.changed" and is_inside_tree() and is_visible_in_tree() and _loaded:
		_live_refresh()


func _typing() -> bool:
	if not is_inside_tree():
		return false
	var owner := get_viewport().gui_get_focus_owner()
	return owner != null and (owner is LineEdit or owner is TextEdit) and is_ancestor_of(owner)


func _live_refresh() -> void:
	if _live_waiting:
		return
	_live_waiting = true
	while is_inside_tree() and (_typing() or not _busy.is_empty()):
		await get_tree().create_timer(0.5).timeout
	_live_waiting = false
	if is_inside_tree() and is_visible_in_tree():
		refresh()


func _mobile() -> bool:
	if not is_inside_tree():
		return false
	return get_viewport().get_visible_rect().size.x <= MOBILE_WIDTH


func _width() -> float:
	if size.x > 0.0:
		return size.x
	if is_inside_tree():
		return minf(928.0, get_viewport().get_visible_rect().size.x - 16.0)
	return 928.0


static func _px(rem: float) -> int:
	return maxi(8, roundi(rem * 16.0))


static func _sp(rem: float) -> int:
	return roundi(rem * 16.0)


static func _text(text: String, rem: float, color: Color, weight := 400) -> Label:
	return UI.label(text, _px(rem), color, weight)


static func _upper(text: String, rem: float, color: Color, weight := 850, spacing := 1) -> Label:
	return UI.label(text.to_upper(), _px(rem), color, weight, "Arial", spacing)


static func _wrap(text: String, rem: float, color: Color, weight := 400, line_height := 1.3) -> Label:
	var node := UI.wrapped(text, _px(rem), color, weight)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.custom_minimum_size.x = 20
	var extra := roundi(float(_px(rem)) * (line_height - 1.15))
	if extra > 0:
		node.add_theme_constant_override("line_spacing", extra)
	return node


static func _clip(text: String, rem: float, color: Color, weight := 400) -> Label:
	var node := UI.label(text, _px(rem), color, weight)
	node.clip_text = true
	node.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.custom_minimum_size.x = 20
	return node


static func _italic(text: String, rem: float, color: Color, line_height := 1.45) -> Label:
	var node := _wrap(text, rem, color, 400, line_height)
	var italic := FontVariation.new()
	italic.base_font = UI.font(400)
	italic.variation_transform = Transform2D(Vector2(1, 0), Vector2(0.2, 1), Vector2.ZERO)
	node.add_theme_font_override("font", italic)
	return node


static func _symbol_font(weight: int) -> Font:
	if _symbols.has(weight):
		return _symbols[weight]
	var symbols := SystemFont.new()
	symbols.font_names = PackedStringArray(["Segoe UI Symbol", "Segoe UI", "DejaVu Sans"])
	symbols.font_weight = weight
	symbols.antialiasing = TextServer.FONT_ANTIALIASING_GRAY
	symbols.hinting = TextServer.HINTING_LIGHT
	var system := SystemFont.new()
	system.font_names = PackedStringArray(["Arial", "Helvetica", "Liberation Sans", "sans-serif"])
	system.font_weight = weight
	system.antialiasing = TextServer.FONT_ANTIALIASING_GRAY
	system.hinting = TextServer.HINTING_LIGHT
	system.fallbacks = [symbols]
	_symbols[weight] = system
	return system


static func _capitalize(text: String) -> String:
	var out: PackedStringArray = []
	for word: String in text.split(" "):
		out.append(word.substr(0, 1).to_upper() + word.substr(1) if not word.is_empty() else word)
	return " ".join(out)


static func _panel(margin: Vector4, bg := PANEL_BG, border := PANEL_BORDER, radius := 12) -> PanelContainer:
	var holder := PanelContainer.new()
	holder.add_theme_stylebox_override("panel", UI.box(bg, border, radius, 1, margin))
	holder.mouse_filter = Control.MOUSE_FILTER_PASS
	holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return holder


static func _column(separation := 0) -> VBoxContainer:
	var node := VBoxContainer.new()
	node.add_theme_constant_override("separation", separation)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


static func _row(separation := 6) -> HBoxContainer:
	var node := HBoxContainer.new()
	node.add_theme_constant_override("separation", separation)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


static func _flow(h_gap: int, v_gap := -1) -> HFlowContainer:
	var node := HFlowContainer.new()
	node.add_theme_constant_override("h_separation", h_gap)
	node.add_theme_constant_override("v_separation", h_gap if v_gap < 0 else v_gap)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


static func _gap(height: int) -> Control:
	var node := Control.new()
	node.custom_minimum_size.y = height
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return node


static func _rule(alpha := 0.06) -> ColorRect:
	var rule := ColorRect.new()
	rule.color = Color(1, 1, 1, alpha)
	rule.custom_minimum_size.y = 1
	rule.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return rule


static func _margin(control: Control, sides: Vector4) -> MarginContainer:
	var margin := MarginContainer.new()
	margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	margin.add_theme_constant_override("margin_left", int(sides.x))
	margin.add_theme_constant_override("margin_top", int(sides.y))
	margin.add_theme_constant_override("margin_right", int(sides.z))
	margin.add_theme_constant_override("margin_bottom", int(sides.w))
	margin.add_child(control)
	return margin


static func _pressable(node: Button) -> void:
	node.button_down.connect(func() -> void:
		node.pivot_offset = node.size * 0.5
		node.scale = Vector2(0.97, 0.97))
	node.button_up.connect(func() -> void: node.scale = Vector2.ONE)


static func _button(text: String, look: Dictionary) -> Button:
	var node := Button.new()
	node.text = text
	node.focus_mode = Control.FOCUS_NONE
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var pad: Vector4 = look.get("pad", Vector4(9, 6, 9, 6))
	var radius: int = look.get("radius", 8)
	var bg: Color = look.get("bg", Color(0, 0, 0, 0))
	var border: Color = look.get("border", Color(0, 0, 0, 0))
	var normal := UI.box(bg, border, radius, 1, pad)
	var hover := UI.box(look.get("hover_bg", bg), look.get("hover_border", border), radius, 1, pad)
	for state: String in ["normal", "focus", "disabled"]:
		node.add_theme_stylebox_override(state, normal)
	for state: String in ["hover", "pressed", "hover_pressed"]:
		node.add_theme_stylebox_override(state, hover)
	node.add_theme_font_override("font", look.get("font", UI.font(int(look.get("weight", 400)))))
	node.add_theme_font_size_override("font_size", _px(float(look.get("size", 0.64))))
	var ink: Color = look.get("ink", UI.WHITE)
	var hover_ink: Color = look.get("hover_ink", ink)
	for name: String in ["font_color", "font_pressed_color", "font_focus_color", "font_disabled_color"]:
		node.add_theme_color_override(name, ink)
	for name: String in ["font_hover_color", "font_hover_pressed_color"]:
		node.add_theme_color_override(name, hover_ink)
	if look.has("align"):
		node.alignment = look["align"]
	_pressable(node)
	return node


static func _lock(button: Button, locked: bool, cursor := Control.CURSOR_WAIT) -> void:
	button.disabled = locked
	button.mouse_default_cursor_shape = cursor if locked else Control.CURSOR_POINTING_HAND


static func _pill(text: String, tone := "neutral") -> PanelContainer:
	var colors := {
		"neutral": [Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.12), Color(1, 1, 1, 0.58)],
		"live": [Color(AMBER, 0.12), Color(AMBER, 0.28), AMBER_TEXT],
		"good": [Color(GREEN, 0.11), Color(GREEN, 0.24), GREEN_TEXT],
		"bad": [Color(RED, 0.1), Color(RED, 0.22), RED_TEXT],
	}
	var chosen: Array = colors.get(tone, colors["neutral"])
	var holder := PanelContainer.new()
	holder.add_theme_stylebox_override("panel", UI.box(chosen[0], chosen[1], 999, 1, Vector4(_sp(0.46), _sp(0.16), _sp(0.46), _sp(0.16))))
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	holder.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	holder.add_child(UI.label(text, _px(0.65), chosen[2], 750))
	return holder


static func _field_style(edit: Control, rem := 0.68, pad := Vector4(9, 8, 9, 8), bg := Color(0, 0, 0, 0.2)) -> void:
	var style := UI.box(bg, Color(1, 1, 1, 0.1), 8, 1, pad)
	for state: String in ["normal", "focus", "read_only"]:
		edit.add_theme_stylebox_override(state, style)
	edit.add_theme_font_override("font", UI.font(400))
	edit.add_theme_font_size_override("font_size", _px(rem))
	edit.add_theme_color_override("font_color", UI.WHITE)
	edit.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.45))
	edit.add_theme_color_override("caret_color", UI.WHITE)


static func _field(placeholder: String, text := "", max_length := 0, rem := 0.68) -> LineEdit:
	var node := LineEdit.new()
	node.placeholder_text = placeholder
	node.text = text
	if max_length > 0:
		node.max_length = max_length
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.custom_minimum_size.x = 40
	_field_style(node, rem, Vector4(_sp(0.56), _sp(0.48), _sp(0.56), _sp(0.48)))
	return node


static func _area(placeholder: String, text: String, rows: int, max_length: int, rem := 0.68, line_height := 1.3) -> TextEdit:
	var node := TextEdit.new()
	node.placeholder_text = placeholder
	node.text = text
	node.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.scroll_fit_content_height = false
	var line := ceilf(float(_px(rem)) * line_height)
	node.custom_minimum_size = Vector2(40, rows * line + 2 * _sp(0.48) + 2)
	_field_style(node, rem, Vector4(_sp(0.56), _sp(0.48), _sp(0.56), _sp(0.48)))
	node.add_theme_constant_override("line_spacing", maxi(0, roundi(line - float(_px(rem)) * 1.15)))
	node.text_changed.connect(func() -> void:
		if node.text.length() > max_length:
			var caret := node.get_caret_column()
			node.text = node.text.substr(0, max_length)
			node.set_caret_column(mini(caret, max_length)))
	return node


static func _style_popup(select: OptionButton, rem: float) -> void:
	var popup := select.get_popup()
	popup.add_theme_stylebox_override("panel", UI.box(Color("#1f1f23"), Color(1, 1, 1, 0.12), 6, 1, Vector4(4, 4, 4, 4)))
	popup.add_theme_stylebox_override("hover", UI.box(Color(1, 1, 1, 0.1), Color(0, 0, 0, 0), 4))
	popup.add_theme_color_override("font_color", Color("#f4f4f5"))
	popup.add_theme_color_override("font_hover_color", Color("#f4f4f5"))
	popup.add_theme_font_override("font", UI.font(400))
	popup.add_theme_font_size_override("font_size", _px(rem))


static func _select(options: Array, current: String, rem := 0.68, pad := Vector4(9, 8, 9, 8)) -> OptionButton:
	var node := OptionButton.new()
	node.focus_mode = Control.FOCUS_NONE
	node.fit_to_longest_item = true
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var style := UI.box(Color(0, 0, 0, 0.2), Color(1, 1, 1, 0.1), 8, 1, Vector4(pad.x, pad.y, pad.z + 14, pad.w))
	for state: String in ["normal", "hover", "pressed", "focus", "hover_pressed", "disabled"]:
		node.add_theme_stylebox_override(state, style)
	node.add_theme_font_override("font", UI.font(400))
	node.add_theme_font_size_override("font_size", _px(rem))
	for name: String in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		node.add_theme_color_override(name, UI.WHITE)
	for option: Variant in options:
		var entry: Array = option
		node.add_item(str(entry[1]))
		node.set_item_metadata(node.item_count - 1, str(entry[0]))
		if str(entry[0]) == current:
			node.select(node.item_count - 1)
	_style_popup(node, rem)
	return node


static func _clickable(normal: StyleBoxFlat, on_press: Callable, hover: StyleBoxFlat = null) -> PanelContainer:
	var holder := PanelContainer.new()
	holder.add_theme_stylebox_override("panel", normal)
	holder.mouse_filter = Control.MOUSE_FILTER_STOP
	holder.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	if hover:
		holder.mouse_entered.connect(func() -> void: holder.add_theme_stylebox_override("panel", hover))
		holder.mouse_exited.connect(func() -> void: holder.add_theme_stylebox_override("panel", normal))
	holder.gui_input.connect(func(event: InputEvent) -> void:
		var click := event as InputEventMouseButton
		if click == null or click.button_index != MOUSE_BUTTON_LEFT:
			return
		holder.pivot_offset = holder.size * 0.5
		if click.pressed:
			holder.scale = Vector2(0.97, 0.97)
		else:
			holder.scale = Vector2.ONE
			if Rect2(Vector2.ZERO, holder.size).has_point(click.position):
				holder.accept_event()
				on_press.call_deferred())
	return holder


static func _dot(color: Color, size: int, top := 0) -> Control:
	var holder := MarginContainer.new()
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	holder.add_theme_constant_override("margin_top", top)
	var dot := Panel.new()
	dot.custom_minimum_size = Vector2(size, size)
	dot.add_theme_stylebox_override("panel", UI.box(color, Color(0, 0, 0, 0), 999))
	dot.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.add_child(dot)
	return holder


static func _escape(text: String) -> String:
	return text.replace("[", "[lb]")


static func _markdown(text: String, rem: float, color: Color, line_height := 1.45) -> RichTextLabel:
	var label := RichTextLabel.new()
	label.bbcode_enabled = true
	label.fit_content = true
	label.scroll_active = false
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	label.add_theme_font_override("normal_font", UI.font(400))
	label.add_theme_font_override("bold_font", UI.font(700))
	label.add_theme_font_size_override("normal_font_size", _px(rem))
	label.add_theme_font_size_override("bold_font_size", _px(rem))
	label.add_theme_color_override("default_color", color)
	label.add_theme_constant_override("line_separation", roundi(float(_px(rem)) * (line_height - 1.15)))
	var lines: PackedStringArray = []
	var bold := RegEx.create_from_string("\\*\\*(.+?)\\*\\*")
	for raw: String in text.split("\n"):
		var line := _escape(raw)
		var stripped := line.strip_edges()
		if stripped.begins_with("#"):
			line = "[b]" + stripped.lstrip("#").strip_edges() + "[/b]"
		elif stripped.begins_with("- ") or stripped.begins_with("* "):
			line = "• " + stripped.substr(2)
		line = bold.sub(line, "[b]$1[/b]", true)
		lines.append(line)
	label.text = "\n".join(lines)
	return label


func _clear(node: Node) -> void:
	for child in node.get_children():
		node.remove_child(child)
		child.queue_free()


func _clear_floats() -> void:
	for entry: Dictionary in _floats:
		var panel: Variant = entry.get("panel")
		if panel is Control and is_instance_valid(panel):
			(panel as Control).queue_free()
	_floats.clear()
	set_process(false)


func _float(panel: Control, anchor: Control, right := false, width := 160.0) -> void:
	panel.top_level = true
	panel.z_index = 20
	add_child(panel)
	_floats.append({"panel": panel, "anchor": anchor, "right": right, "width": width, "gap": 4.0})
	set_process(true)


func _scroll_area(padding: Vector4, separation: int, max_width := 0.0) -> VBoxContainer:
	_scroll = ScrollContainer.new()
	_scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	var bar := _scroll.get_v_scroll_bar()
	var grabber := UI.box(Color(1, 1, 1, 0.16), Color(0, 0, 0, 0), 999)
	grabber.content_margin_left = 3
	grabber.content_margin_right = 3
	bar.add_theme_stylebox_override("grabber", grabber)
	bar.add_theme_stylebox_override("grabber_highlight", UI.box(Color(1, 1, 1, 0.28), Color(0, 0, 0, 0), 999))
	bar.add_theme_stylebox_override("grabber_pressed", UI.box(Color(1, 1, 1, 0.28), Color(0, 0, 0, 0), 999))
	bar.add_theme_stylebox_override("scroll", StyleBoxEmpty.new())
	bar.add_theme_stylebox_override("scroll_focus", StyleBoxEmpty.new())
	bar.custom_minimum_size.x = 6
	var margin := MarginContainer.new()
	margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	margin.add_theme_constant_override("margin_left", int(padding.x))
	margin.add_theme_constant_override("margin_top", int(padding.y))
	margin.add_theme_constant_override("margin_right", int(padding.z))
	margin.add_theme_constant_override("margin_bottom", int(padding.w))
	var column := _column(separation)
	if max_width > 0.0:
		var available := _width() - padding.x - padding.z
		if available > max_width:
			var side := int((available - max_width) / 2.0)
			margin.add_theme_constant_override("margin_left", int(padding.x) + side)
			margin.add_theme_constant_override("margin_right", int(padding.z) + side)
	margin.add_child(column)
	_scroll.add_child(margin)
	_body.add_child(_scroll)
	return column


func _columns_for(min_rem: float, gap: int, count: int, available: float) -> int:
	var minimum := min_rem * 16.0
	var columns := maxi(1, int(floor((available + gap) / (minimum + gap))))
	return maxi(1, mini(columns, count))


func _emblem(emblem: Variant, size: int) -> Control:
	var data: Dictionary = emblem if typeof(emblem) == TYPE_DICTIONARY else {}
	var holder := PanelContainer.new()
	holder.custom_minimum_size = Vector2(size, size)
	holder.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	holder.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	holder.add_theme_stylebox_override("panel", UI.box(GREY_RAISED, GREY_BORDER, 11, 1))
	holder.tooltip_text = str(data.get("title", "Institution"))
	holder.mouse_filter = Control.MOUSE_FILTER_PASS
	holder.clip_contents = true
	var mark := _text(str(data.get("mark", "IN")), 0.64, GREY_TEXT, 850)
	mark.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	mark.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	holder.add_child(mark)
	var url := str(data.get("url", ""))
	if not url.is_empty():
		var picture := TextureRect.new()
		picture.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		picture.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		picture.mouse_filter = Control.MOUSE_FILTER_IGNORE
		picture.visible = false
		var inset := _margin(picture, Vector4(4, 4, 4, 4))
		inset.mouse_filter = Control.MOUSE_FILTER_IGNORE
		holder.add_child(inset)
		_load_logo(url, picture, mark)
	return holder


func _load_logo(url: String, picture: TextureRect, mark: Label) -> void:
	if _logo_cache.has(url):
		var cached: Variant = _logo_cache[url]
		if cached is Texture2D:
			picture.texture = cached
			picture.visible = true
			mark.visible = false
		return
	var address := url
	if address.begins_with("/"):
		if _origin.is_empty():
			var hello: Dictionary = await engine.request("hello")
			if hello.get("ok", false):
				_origin = str((hello.get("result", {}) as Dictionary).get("origin", ""))
		address = _origin + address
	if not address.begins_with("http"):
		_logo_cache[url] = false
		return
	var request := HTTPRequest.new()
	request.timeout = 15.0
	add_child(request)
	if request.request(address) != OK:
		request.queue_free()
		_logo_cache[url] = false
		return
	var response: Array = await request.request_completed
	request.queue_free()
	var texture: Texture2D = null
	if int(response[0]) == HTTPRequest.RESULT_SUCCESS and int(response[1]) < 400:
		var body: PackedByteArray = response[3]
		var image := Image.new()
		var lowered := address.to_lower().split("?")[0]
		var status := ERR_FILE_UNRECOGNIZED
		if lowered.ends_with(".svg"):
			status = image.load_svg_from_buffer(body, 2.0)
		elif lowered.ends_with(".png"):
			status = image.load_png_from_buffer(body)
		elif lowered.ends_with(".jpg") or lowered.ends_with(".jpeg"):
			status = image.load_jpg_from_buffer(body)
		elif lowered.ends_with(".webp"):
			status = image.load_webp_from_buffer(body)
		else:
			status = image.load_png_from_buffer(body)
			if status != OK:
				status = image.load_svg_from_buffer(body, 2.0)
		if status == OK and not image.is_empty():
			texture = ImageTexture.create_from_image(image)
	_logo_cache[url] = texture if texture else false
	if texture and is_instance_valid(picture):
		picture.texture = texture
		picture.visible = true
		if is_instance_valid(mark):
			mark.visible = false


func _render() -> void:
	if _scroll and is_instance_valid(_scroll):
		_keep_scroll[_scroll_key()] = _scroll.scroll_vertical
	_last_width = size.x
	_clear_floats()
	_release_embedded()
	_clear(_top)
	_clear(_body)
	_scroll = null
	if not _load_error.is_empty():
		var holder := _scroll_area(Vector4(16, 12, 16, 12), 0)
		holder.add_child(_wrap(_load_error, 0.62, RED_TEXT))
		return
	if not _loaded:
		return
	var selected: Variant = _model.get("selected")
	if typeof(selected) != TYPE_DICTIONARY:
		_announce_council("")
		_render_list()
	else:
		_render_detail(selected)
	if _scroll:
		_restore_scroll.call_deferred(_scroll, int(_keep_scroll.get(_scroll_key(), 0)))


func _release_embedded() -> void:
	if _embedded and is_instance_valid(_embedded):
		var parent := _embedded.get_parent()
		if parent:
			parent.remove_child(_embedded)
	_embedded = null


func _scroll_key() -> String:
	if _selected_id.is_empty():
		return "found" if _founding_open else ("all" if _show_all else "mine")
	return _selected_id + ":" + _section


func _restore_scroll(scroll: ScrollContainer, value: int) -> void:
	if not is_instance_valid(scroll) or value <= 0:
		return
	await get_tree().process_frame
	if is_instance_valid(scroll):
		scroll.scroll_vertical = value


func _announce_council(chat_id: String) -> void:
	if chat_id == _visible_council:
		return
	_visible_council = chat_id
	council_visible_changed.emit(chat_id)


func _error_box() -> Control:
	var box := _panel(Vector4(_sp(0.6), _sp(0.45), _sp(0.6), _sp(0.45)), Color(RED, 0.08), Color(RED, 0.2), 8)
	box.add_child(_wrap(_error, 0.62, RED_TEXT))
	return _margin(box, Vector4(_sp(1.0), _sp(0.5), _sp(1.0), 0))


func _render_list() -> void:
	var personal: Array = _model.get("personal", [])
	var every: Array = _model.get("all", [])
	var bar_style := StyleBoxFlat.new()
	bar_style.bg_color = Color(0, 0, 0, 0)
	bar_style.border_color = Color(1, 1, 1, 0.06)
	bar_style.border_width_bottom = 1
	bar_style.content_margin_left = _sp(1.0)
	bar_style.content_margin_right = _sp(1.0)
	bar_style.content_margin_top = _sp(0.55)
	bar_style.content_margin_bottom = _sp(0.55)
	var bar_panel := PanelContainer.new()
	bar_panel.add_theme_stylebox_override("panel", bar_style)
	var bar := _row(_sp(0.45))
	var pill_pad := Vector4(_sp(0.55), _sp(0.28), _sp(0.55), _sp(0.28))
	var mine := _button("Your institutions (%d)" % personal.size(), {"bg": GREY_SELECTED if not _show_all else Color(1, 1, 1, 0.03), "border": Color(1, 1, 1, 0.1), "ink": GREY_TEXT if not _show_all else Color(1, 1, 1, 0.55), "size": 0.62, "weight": 400, "pad": pill_pad, "radius": 999})
	mine.pressed.connect(func() -> void:
		_show_all = false
		_render())
	bar.add_child(mine)
	var all_button := _button("View all (%d)" % every.size(), {"bg": GREY_SELECTED if _show_all else Color(1, 1, 1, 0.03), "border": Color(1, 1, 1, 0.1), "ink": GREY_TEXT if _show_all else Color(1, 1, 1, 0.55), "size": 0.62, "weight": 400, "pad": pill_pad, "radius": 999})
	all_button.pressed.connect(func() -> void:
		_show_all = true
		_render())
	bar.add_child(all_button)
	var pending := int(_model.get("pending", 0))
	if pending > 0:
		bar.add_child(_pill("%d awaiting you" % pending, "live"))
	bar.add_child(UI.spacer())
	var found := _button("＋ Found institution", {"bg": GREY_RAISED, "border": GREY_BORDER_STRONG, "ink": GREY_TEXT, "size": 0.64, "weight": 780, "pad": Vector4(_sp(0.58), _sp(0.32), _sp(0.58), _sp(0.32)), "radius": 8})
	found.pressed.connect(func() -> void:
		_founding_open = true
		_founding_autofocus = true
		_error = ""
		_render())
	bar.add_child(found)
	bar_panel.add_child(bar)
	_top.add_child(bar_panel)
	if not _error.is_empty():
		_top.add_child(_error_box())
	if _founding_open:
		_render_founding()
		return
	var rows: Array = every if _show_all else personal
	var column := _scroll_area(Vector4(_sp(1.0), _sp(0.75), _sp(1.0), _sp(0.75)), 0)
	if rows.is_empty():
		var empty := _wrap("No institutions exist in this world yet." if _show_all else "Your government is not part of any institution and has no pending invitation or application.", 0.78, Color(1, 1, 1, 0.3))
		empty.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		column.add_child(_margin(empty, Vector4(_sp(2.0), _sp(2.0), _sp(2.0), _sp(2.0))))
		return
	var available := _width() - 2.0 * _sp(1.0)
	var grid := GridContainer.new()
	grid.columns = _columns_for(15.0, _sp(0.55), rows.size(), available)
	grid.add_theme_constant_override("h_separation", _sp(0.55))
	grid.add_theme_constant_override("v_separation", _sp(0.55))
	grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for entry: Variant in rows:
		grid.add_child(_institution_row(entry))
	column.add_child(grid)


func _institution_row(entry: Variant) -> Control:
	var row: Dictionary = entry
	var id := str(row.get("id", ""))
	var channel := str(row.get("channelId", ""))
	var style := UI.box(Color(1, 1, 1, 0.03), PANEL_BORDER, 12, 1, Vector4(_sp(0.7), _sp(0.7), _sp(0.7), _sp(0.7)))
	var holder := _clickable(style, func() -> void:
		_selected_id = id
		_section = "overview"
		_error = ""
		refresh())
	holder.size_flags_vertical = Control.SIZE_FILL
	var line := _row(_sp(0.7))
	line.add_child(_emblem(row.get("emblem"), 42))
	var column := _column(_sp(0.18))
	column.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var top := _row(_sp(0.4))
	var name := _wrap(str(row.get("name", "")), 0.8, UI.WHITE, 700, 1.25)
	name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(name)
	var pending := str(row.get("pending", ""))
	if not pending.is_empty():
		top.add_child(_pill(pending, "live"))
	if not channel.is_empty() and _unread_ids.has(channel):
		top.add_child(_pill("new", "neutral"))
	column.add_child(top)
	column.add_child(_clip(str(row.get("sub", "")), 0.62, Color(1, 1, 1, 0.45)))
	line.add_child(column)
	var chevron := UI.label("›", 16, Color(1, 1, 1, 0.28))
	chevron.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	line.add_child(chevron)
	holder.add_child(line)
	return holder


func _render_detail(selected: Dictionary) -> void:
	var header_style := StyleBoxFlat.new()
	header_style.bg_color = Color(0, 0, 0, 0)
	header_style.border_color = Color(1, 1, 1, 0.055)
	header_style.border_width_bottom = 1
	header_style.content_margin_left = _sp(1.0)
	header_style.content_margin_right = _sp(1.0)
	header_style.content_margin_top = _sp(0.9)
	header_style.content_margin_bottom = _sp(0.78)
	var header_panel := PanelContainer.new()
	header_panel.add_theme_stylebox_override("panel", header_style)
	var header := _row(_sp(0.85))
	var back := _button("‹", {"ink": Color(1, 1, 1, 0.55), "size": 1.08, "weight": 400, "pad": Vector4(6, 1, 6, 1), "radius": 0})
	back.tooltip_text = "Back to institutions"
	back.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	back.pressed.connect(func() -> void:
		_selected_id = ""
		_error = ""
		refresh())
	header.add_child(back)
	header.add_child(_emblem(selected.get("emblem"), 56))
	var titles := _column(0)
	titles.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var name_row := _flow(_sp(0.5))
	name_row.add_child(_text(str(selected.get("name", "")), 1.04, UI.WHITE, 700))
	name_row.add_child(_pill(str(selected.get("status", "active")), str(selected.get("statusTone", "neutral"))))
	titles.add_child(name_row)
	titles.add_child(_gap(_sp(0.2)))
	titles.add_child(_wrap(str(selected.get("sub", "")), 0.65, Color(1, 1, 1, 0.45)))
	var purpose := str(selected.get("purpose", ""))
	if not purpose.is_empty():
		titles.add_child(_gap(_sp(0.3)))
		var purpose_label := _clip(purpose, 0.7, Color(1, 1, 1, 0.62))
		purpose_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		titles.add_child(purpose_label)
	header.add_child(titles)
	header_panel.add_child(header)
	_top.add_child(header_panel)
	var facts := GridContainer.new()
	facts.columns = 3
	facts.add_theme_constant_override("h_separation", _sp(0.45))
	facts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for entry: Variant in selected.get("facts", []):
		var fact: Dictionary = entry
		var card := _panel(Vector4(_sp(0.72), _sp(0.62), _sp(0.72), _sp(0.62)), Color(20 / 255.0, 20 / 255.0, 24 / 255.0, 0.72), PANEL_BORDER, 12)
		card.size_flags_vertical = Control.SIZE_FILL
		var column := _column(_sp(0.18))
		column.add_child(_upper(str(fact.get("label", "")), 0.62, Color(1, 1, 1, 0.4), 400))
		column.add_child(_wrap(str(fact.get("value", "")), 0.76, Color(1, 1, 1, 0.88), 740))
		card.add_child(column)
		facts.add_child(card)
	_top.add_child(_margin(facts, Vector4(_sp(1.0), _sp(0.65), _sp(1.0), _sp(0.7))))
	var tabs_style := StyleBoxFlat.new()
	tabs_style.bg_color = Color(0, 0, 0, 0)
	tabs_style.border_color = Color(1, 1, 1, 0.06)
	tabs_style.border_width_bottom = 1
	tabs_style.content_margin_left = _sp(0.78)
	tabs_style.content_margin_right = _sp(0.78)
	var tabs_panel := PanelContainer.new()
	tabs_panel.add_theme_stylebox_override("panel", tabs_style)
	var tabs := _flow(1, 0)
	var is_member := bool(selected.get("isMember", false))
	for entry: Variant in selected.get("tabs", []):
		var tab_data: Dictionary = entry
		var key := str(tab_data.get("key", ""))
		var label := str(tab_data.get("label", ""))
		if key == "council" and _busy == "council":
			label = "Opening…"
		var active := key == _section
		var tab := Button.new()
		tab.text = label
		tab.focus_mode = Control.FOCUS_NONE
		tab.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		var style := StyleBoxFlat.new()
		style.bg_color = Color(0, 0, 0, 0)
		style.border_width_bottom = 2
		style.border_color = GREY_SOFT if active else Color(0, 0, 0, 0)
		style.content_margin_left = _sp(0.68)
		style.content_margin_right = _sp(0.68)
		style.content_margin_top = _sp(0.58)
		style.content_margin_bottom = _sp(0.62)
		for state: String in ["normal", "hover", "pressed", "focus", "hover_pressed", "disabled"]:
			tab.add_theme_stylebox_override(state, style)
		tab.add_theme_font_override("font", UI.font(730))
		tab.add_theme_font_size_override("font_size", _px(0.68))
		var ink := GREY_TEXT if active else Color(1, 1, 1, 0.52)
		for color_name: String in ["font_color", "font_focus_color", "font_pressed_color", "font_disabled_color", "font_hover_color", "font_hover_pressed_color"]:
			tab.add_theme_color_override(color_name, ink)
		if key == "council" and not _busy.is_empty():
			_lock(tab, true)
		_pressable(tab)
		tab.pressed.connect(func() -> void:
			if key == "council" and is_member:
				_open_council()
			else:
				_section = key
				_render())
		tabs.add_child(tab)
	tabs_panel.add_child(tabs)
	_top.add_child(tabs_panel)
	if not _error.is_empty():
		_top.add_child(_error_box())
	if _section == "council" and int(selected.get("pendingBallots", 0)) + int(selected.get("pendingAmendments", 0)) > 0:
		var banner := _clickable(UI.box(Color(AMBER, 0.08), Color(AMBER, 0.28), 10, 1, Vector4(_sp(0.7), _sp(0.58), _sp(0.7), _sp(0.58))), func() -> void:
			_section = "agenda"
			_render())
		var banner_row := _row(_sp(0.7))
		var banner_text := _column(_sp(0.12))
		banner_text.add_child(_upper("Action required", 0.59, Color(253 / 255.0, 230 / 255.0, 138 / 255.0, 0.7), 850))
		banner_text.add_child(_wrap(str(selected.get("actionRequired", "")), 0.62, AMBER_TEXT, 700))
		banner_row.add_child(banner_text)
		banner_row.add_child(_text("Review agenda →", 0.64, AMBER_TEXT, 700))
		banner.add_child(banner_row)
		_top.add_child(_margin(banner, Vector4(_sp(1.0), _sp(0.55), _sp(1.0), 0)))
	_announce_council(str(selected.get("channelId", "")) if _section == "council" else "")
	match _section:
		"council":
			_render_council(selected)
		"agenda":
			_render_agenda(selected)
		"decisions":
			_render_decisions(selected)
		"charter":
			_render_charter(selected)
		"members":
			_render_members(selected)
		"documents":
			_render_documents(selected)
		_:
			_render_overview(selected)


func _content_area(max_width := 0.0, separation := 0) -> VBoxContainer:
	return _scroll_area(Vector4(_sp(1.0), _sp(0.8), _sp(1.0), _sp(1.0)), separation, max_width)


func _render_overview(selected: Dictionary) -> void:
	var page := _content_area(_sp(56.0), _sp(0.75))
	var business: Dictionary = selected.get("business", {})
	var strong := bool(selected.get("businessStrong", false))
	var card := _panel(Vector4(_sp(1.0), _sp(1.0), _sp(1.0), _sp(1.0)), Color(1, 1, 1, 0.025), GREY_BORDER_STRONG if strong else Color(1, 1, 1, 0.075), 12)
	var column := _column(0)
	var top := _row(_sp(0.75))
	var icon := PanelContainer.new()
	icon.custom_minimum_size = Vector2(_sp(2.25), _sp(2.25))
	icon.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	icon.add_theme_stylebox_override("panel", UI.box(GREY_RAISED, GREY_BORDER, 10, 1))
	icon.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var glyph := UI.label("▤", _px(1.0), GREY_SOFT)
	glyph.add_theme_font_override("font", _symbol_font(400))
	glyph.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	glyph.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	icon.add_child(glyph)
	top.add_child(icon)
	var text_column := _column(0)
	text_column.add_child(_upper("Current business", 0.65, GREY_MUTED))
	text_column.add_child(_gap(_sp(0.28)))
	text_column.add_child(_wrap(str(business.get("title", "")), 0.88, UI.WHITE, 780))
	text_column.add_child(_gap(_sp(0.28)))
	var kind := str(business.get("kind", "none"))
	text_column.add_child(_wrap(str(business.get("text", "")), 0.67, Color(1, 1, 1, 0.45 if kind == "none" else 0.5), 400, 1.5))
	if kind == "proposal":
		var pills := _flow(_sp(0.35))
		pills.add_child(_pill(str(business.get("status", "")), "live" if bool(business.get("live", false)) else "neutral"))
		var more := str(business.get("more", ""))
		if not more.is_empty():
			pills.add_child(_pill(more, "neutral"))
		text_column.add_child(_gap(_sp(0.48)))
		text_column.add_child(pills)
	top.add_child(text_column)
	column.add_child(top)
	column.add_child(_gap(_sp(0.8)))
	column.add_child(_rule(0.06))
	column.add_child(_gap(_sp(0.72)))
	var actions := _row(_sp(0.45))
	if bool(selected.get("canTableProposal", false)):
		var table := _button("＋ Table a matter", {"bg": GREY_RAISED, "border": GREY_BORDER_STRONG, "ink": GREY_TEXT, "size": 0.67, "weight": 780, "pad": Vector4(_sp(0.7), _sp(0.46), _sp(0.7), _sp(0.46)), "radius": 9})
		table.pressed.connect(func() -> void:
			_section = "agenda"
			_render())
		actions.add_child(table)
	if bool(selected.get("isMember", false)):
		var council := _button("Open Council", {"bg": Color(1, 1, 1, 0.045), "border": Color(1, 1, 1, 0.11), "ink": Color(1, 1, 1, 0.78), "size": 0.67, "weight": 720, "pad": Vector4(_sp(0.7), _sp(0.46), _sp(0.7), _sp(0.46)), "radius": 9})
		_lock(council, not _busy.is_empty())
		council.pressed.connect(_open_council)
		actions.add_child(council)
	actions.add_child(UI.spacer())
	if bool(selected.get("hasPendingLifecycle", false)):
		var review := _button("Review membership →", {"ink": GREY_SOFT, "size": 0.65, "weight": 730, "pad": Vector4(_sp(0.2), _sp(0.46), _sp(0.2), _sp(0.46)), "radius": 0})
		review.pressed.connect(func() -> void:
			_section = "members"
			_render())
		actions.add_child(review)
	column.add_child(actions)
	card.add_child(column)
	page.add_child(card)
	var activity := _panel(Vector4(_sp(1.0), _sp(0.9), _sp(1.0), _sp(0.9)))
	var activity_column := _column(0)
	var head := _row(_sp(0.55))
	head.add_child(_wrap("Recent activity", 0.78, UI.WHITE, 700))
	if bool(selected.get("showFormalRecord", false)):
		var record := _button("View formal record →", {"ink": GREY_SOFT, "size": 0.62, "weight": 400, "pad": Vector4(6, 1, 6, 1), "radius": 0})
		record.pressed.connect(func() -> void:
			_section = "decisions"
			_render())
		head.add_child(record)
	activity_column.add_child(head)
	var recent: Array = selected.get("recentActivity", [])
	if recent.is_empty():
		activity_column.add_child(_margin(_wrap("No formal activity has been recorded yet.", 0.66, Color(1, 1, 1, 0.34)), Vector4(_sp(0.1), _sp(1.0), _sp(0.1), _sp(0.4))))
	else:
		activity_column.add_child(_gap(_sp(0.65)))
	for index in range(recent.size()):
		var item: Dictionary = recent[index]
		if index > 0:
			activity_column.add_child(_rule(0.055))
		var line := _row(_sp(0.6))
		var tone := str(item.get("tone", "neutral"))
		line.add_child(_dot(Color("#4ade80") if tone == "good" else (Color("#f87171") if tone == "bad" else Color(1, 1, 1, 0.35)), _sp(0.5), _sp(0.28)))
		var entry_column := _column(_sp(0.12))
		entry_column.add_child(_wrap(str(item.get("title", "")), 0.68, Color(1, 1, 1, 0.82), 710))
		var detail := str(item.get("detail", ""))
		if not detail.is_empty():
			entry_column.add_child(_wrap(detail, 0.64, Color(1, 1, 1, 0.4), 400, 1.4))
		line.add_child(entry_column)
		var date := str(item.get("date", ""))
		if not date.is_empty():
			var date_label := _text(date, 0.61, Color(1, 1, 1, 0.28))
			date_label.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
			line.add_child(date_label)
		activity_column.add_child(_margin(line, Vector4(0, _sp(0.48), 0, _sp(0.48))))
	activity.add_child(activity_column)
	page.add_child(activity)


func _render_agenda(selected: Dictionary) -> void:
	var id := str(selected.get("id", ""))
	var page := _content_area(0.0, _sp(0.55))
	if bool(selected.get("canTableProposal", false)):
		var form := _panel(Vector4(_sp(0.85), _sp(0.85), _sp(0.85), _sp(0.85)))
		var column := _column(0)
		column.add_child(_text("Table a matter", 0.76, UI.WHITE, 780))
		column.add_child(_gap(_sp(0.2)))
		column.add_child(_wrap("Open a Council debate first, or move a ready matter directly to a formal ballot.", 0.62, Color(1, 1, 1, 0.42), 400, 1.45))
		column.add_child(_gap(_sp(0.58)))
		var title := _field("Proposal title", _proposal_title, 160)
		column.add_child(title)
		column.add_child(_gap(_sp(0.42)))
		var summary := _area("What should the institution decide?", _proposal_summary, 3, 4000)
		column.add_child(summary)
		column.add_child(_gap(_sp(0.55)))
		var buttons := _flow(_sp(0.42))
		var debate := _button("Open for debate", {"bg": GREY_RAISED, "border": GREY_BORDER_STRONG, "ink": GREY_TEXT, "size": 0.64, "weight": 780, "pad": Vector4(_sp(0.64), _sp(0.42), _sp(0.64), _sp(0.42)), "radius": 8})
		var vote := _button("Put to vote now", {"bg": Color(AMBER, 0.075), "border": Color(AMBER, 0.24), "ink": AMBER_TEXT, "size": 0.64, "weight": 760, "pad": Vector4(_sp(0.64), _sp(0.42), _sp(0.64), _sp(0.42)), "radius": 8})
		var update := func() -> void:
			var locked := not _busy.is_empty() or _proposal_title.strip_edges().is_empty()
			_lock(debate, locked, Control.CURSOR_FORBIDDEN)
			_lock(vote, locked, Control.CURSOR_FORBIDDEN)
		update.call()
		title.text_changed.connect(func(value: String) -> void:
			_proposal_title = value
			update.call())
		summary.text_changed.connect(func() -> void: _proposal_summary = summary.text)
		debate.pressed.connect(func() -> void: _create_proposal(id, "debate"))
		vote.pressed.connect(func() -> void: _create_proposal(id, "vote"))
		buttons.add_child(debate)
		buttons.add_child(vote)
		column.add_child(buttons)
		form.add_child(column)
		page.add_child(form)
	var proposals: Array = selected.get("proposals", [])
	if proposals.is_empty():
		var empty := _wrap("No active proposals, amendments or ballots.", 0.67, Color(1, 1, 1, 0.3))
		empty.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		page.add_child(_margin(empty, Vector4(_sp(0.5), _sp(2.0), _sp(0.5), _sp(2.0))))
	for entry: Variant in proposals:
		page.add_child(_proposal_card(id, entry))
	if bool(selected.get("unresolvedNpcNote", false)):
		var note := _panel(Vector4(_sp(0.75), _sp(0.68), _sp(0.75), _sp(0.68)))
		note.add_child(_wrap("When a formal vote opens, one bounded Council round immediately prompts unresolved eligible AI ballots. Any ballots still unresolved remain eligible for the normal post-turn follow-up.", 0.62, Color(1, 1, 1, 0.44), 400, 1.5))
		page.add_child(note)


func _proposal_card(institution_id: String, entry: Variant) -> Control:
	var proposal: Dictionary = entry
	var proposal_id := str(proposal.get("id", ""))
	var needs_vote := bool(proposal.get("needsVote", false))
	var busy := not _busy.is_empty()
	var card := _panel(Vector4(_sp(0.72), _sp(0.72), _sp(0.72), _sp(0.72)), Color(250 / 255.0, 207 / 255.0, 133 / 255.0, 0.048) if needs_vote else Color(1, 1, 1, 0.026), Color(AMBER, 0.32) if needs_vote else GREY_BORDER, 12)
	var column := _column(0)
	var top := _row(_sp(0.45))
	top.add_child(_wrap(str(proposal.get("title", "")), 0.74, UI.WHITE, 700))
	if needs_vote:
		top.add_child(_pill("Your vote", "live"))
	top.add_child(_pill(str(proposal.get("status", "")), str(proposal.get("statusTone", "neutral"))))
	column.add_child(top)
	var summary := str(proposal.get("summary", ""))
	if not summary.is_empty():
		column.add_child(_gap(_sp(0.35)))
		column.add_child(_wrap(summary, 0.65, Color(1, 1, 1, 0.55), 400, 1.45))
	column.add_child(_gap(_sp(0.35)))
	column.add_child(_wrap(str(proposal.get("meta", "")), 0.61, Color(1, 1, 1, 0.32)))
	var ballot := str(proposal.get("ballot", ""))
	if not ballot.is_empty():
		column.add_child(_gap(_sp(0.4)))
		column.add_child(_pill(ballot, "neutral"))
	var choices: Array = proposal.get("choices", [])
	if not choices.is_empty():
		column.add_child(_gap(_sp(0.55)))
		var votes := _flow(_sp(0.35))
		for choice: Variant in choices:
			var value := str(choice)
			var button := _button(_capitalize(value), {"bg": Color(1, 1, 1, 0.055), "border": GREY_BORDER, "ink": GREY_TEXT, "size": 0.64, "weight": 700, "pad": Vector4(_sp(0.5), _sp(0.3), _sp(0.5), _sp(0.3)), "radius": 8})
			_lock(button, busy)
			button.pressed.connect(func() -> void: _run("vote:" + proposal_id, "institutions.vote", {"institutionId": institution_id, "proposalId": proposal_id, "choice": value}))
			votes.add_child(button)
		column.add_child(votes)
	if bool(proposal.get("canCallVote", false)):
		column.add_child(_gap(_sp(0.58)))
		var call_row := _flow(_sp(0.4))
		var comment := _field("Closing comment before the vote (optional)", str(_vote_comments.get(proposal_id, "")), 1200)
		comment.custom_minimum_size.x = _sp(18.0)
		comment.text_changed.connect(func(value: String) -> void: _vote_comments[proposal_id] = value)
		call_row.add_child(comment)
		var call := _button("Call vote", {"bg": Color(AMBER, 0.1), "border": Color(AMBER, 0.28), "ink": AMBER_TEXT, "size": 0.64, "weight": 780, "pad": Vector4(_sp(0.62), _sp(0.4), _sp(0.62), _sp(0.4)), "radius": 8})
		_lock(call, busy)
		call.pressed.connect(func() -> void: _submit_vote(institution_id, proposal_id))
		call_row.add_child(call)
		var fit := func() -> void:
			var room := call_row.size.x - call.get_combined_minimum_size().x - _sp(0.4) - 1.0
			comment.custom_minimum_size.x = maxf(float(_sp(12.0)), room) if room >= _sp(18.0) else float(_sp(18.0))
		call_row.resized.connect(fit)
		column.add_child(call_row)
	var blocked := str(proposal.get("blocked", ""))
	if not blocked.is_empty():
		column.add_child(_gap(_sp(0.5)))
		var notice := _panel(Vector4(_sp(0.5), _sp(0.42), _sp(0.5), _sp(0.42)), Color(AMBER, 0.045), Color(AMBER, 0.16), 8)
		notice.add_child(_wrap(blocked, 0.59, Color(253 / 255.0, 230 / 255.0, 138 / 255.0, 0.72), 400, 1.4))
		column.add_child(notice)
	var amendments: Array = proposal.get("amendments", [])
	if not amendments.is_empty():
		column.add_child(_gap(_sp(0.55)))
		var list_column := _column(_sp(0.35))
		for item: Variant in amendments:
			list_column.add_child(_amendment_row(institution_id, proposal, item))
		column.add_child(list_column)
	if bool(proposal.get("canAmend", false)):
		column.add_child(_gap(_sp(0.55)))
		var amend_row := _row(_sp(0.35))
		var amend := LineEdit.new()
		amend.placeholder_text = "Propose amendment…"
		amend.text = str(_amend_drafts.get(proposal_id, ""))
		amend.max_length = 4000
		amend.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		_field_style(amend, 0.64, Vector4(_sp(0.45), _sp(0.35), _sp(0.45), _sp(0.35)), Color(0, 0, 0, 0.18))
		var add := _button("Add", {"bg": Color(1, 1, 1, 0.055), "border": GREY_BORDER, "ink": GREY_TEXT, "size": 0.61, "weight": 400, "pad": Vector4(_sp(0.45), _sp(0.3), _sp(0.45), _sp(0.3)), "radius": 8})
		_lock(add, busy or str(_amend_drafts.get(proposal_id, "")).strip_edges().is_empty(), Control.CURSOR_FORBIDDEN)
		amend.text_changed.connect(func(value: String) -> void:
			_amend_drafts[proposal_id] = value
			_lock(add, not _busy.is_empty() or value.strip_edges().is_empty(), Control.CURSOR_FORBIDDEN))
		add.pressed.connect(func() -> void: _add_amendment(institution_id, proposal_id))
		amend_row.add_child(amend)
		amend_row.add_child(add)
		column.add_child(amend_row)
	card.add_child(column)
	return card


func _amendment_row(institution_id: String, proposal: Dictionary, entry: Variant) -> Control:
	var amendment: Dictionary = entry
	var proposal_id := str(proposal.get("id", ""))
	var amendment_id := str(amendment.get("id", ""))
	var busy := not _busy.is_empty()
	var holder := HBoxContainer.new()
	holder.add_theme_constant_override("separation", _sp(0.45))
	holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var bar := ColorRect.new()
	bar.color = Color(1, 1, 1, 0.22)
	bar.custom_minimum_size.x = 2
	bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.add_child(bar)
	var column := _column(0)
	column.add_child(_wrap(str(amendment.get("text", "")), 0.64, Color(1, 1, 1, 0.68)))
	column.add_child(_gap(_sp(0.18)))
	var status_row := _row(_sp(0.3))
	status_row.add_child(_pill(str(amendment.get("status", "")), str(amendment.get("tone", "neutral"))))
	status_row.add_child(_text(str(amendment.get("by", "")), 0.59, Color(1, 1, 1, 0.3)))
	column.add_child(status_row)
	if bool(amendment.get("controls", false)):
		column.add_child(_gap(_sp(0.3)))
		var buttons := _flow(_sp(0.3))
		var small := Vector4(_sp(0.35), _sp(0.2), _sp(0.35), _sp(0.2))
		if bool(amendment.get("canResolve", false)):
			for status: String in ["accepted", "rejected"]:
				var resolve := _button("Accept" if status == "accepted" else "Reject", {"bg": Color(1, 1, 1, 0.04), "border": Color(1, 1, 1, 0.1), "ink": GREEN_TEXT if status == "accepted" else RED_TEXT, "size": 0.6, "weight": 400, "pad": small, "radius": 7})
				_lock(resolve, busy)
				resolve.pressed.connect(func() -> void: _run("amend:%s:%s" % [proposal_id, amendment_id], "institutions.amendmentStatus", {"institutionId": institution_id, "proposalId": proposal_id, "amendmentId": amendment_id, "status": status}))
				buttons.add_child(resolve)
		if bool(amendment.get("canAsk", false)):
			var ask := _button("Ask sponsor to decide", {"bg": Color(AMBER, 0.06), "border": Color(AMBER, 0.18), "ink": AMBER_TEXT, "size": 0.6, "weight": 400, "pad": Vector4(_sp(0.38), _sp(0.2), _sp(0.38), _sp(0.2)), "radius": 7})
			_lock(ask, busy)
			ask.pressed.connect(func() -> void: _request_amendment_decision(institution_id, proposal, amendment_id))
			buttons.add_child(ask)
		if bool(amendment.get("canWithdraw", false)):
			var withdraw := _button("Withdraw", {"bg": Color(1, 1, 1, 0.04), "border": Color(1, 1, 1, 0.1), "ink": Color(1, 1, 1, 0.6), "size": 0.6, "weight": 400, "pad": small, "radius": 7})
			_lock(withdraw, busy)
			withdraw.pressed.connect(func() -> void: _run("amend:%s:%s" % [proposal_id, amendment_id], "institutions.amendmentStatus", {"institutionId": institution_id, "proposalId": proposal_id, "amendmentId": amendment_id, "status": "withdrawn"}))
			buttons.add_child(withdraw)
		column.add_child(buttons)
	holder.add_child(column)
	return holder


func _render_decisions(selected: Dictionary) -> void:
	var page := _content_area(0.0, _sp(0.55))
	var intro := _column(0)
	intro.add_child(_upper("Institutional record", 0.59, GREY_MUTED))
	intro.add_child(_gap(_sp(0.18)))
	intro.add_child(_text("Decisions", 0.78, UI.WHITE, 780))
	intro.add_child(_gap(_sp(0.2)))
	intro.add_child(_wrap("Passed, failed and implemented matters are preserved as formal history rather than buried in chat.", 0.61, Color(1, 1, 1, 0.38)))
	page.add_child(_margin(intro, Vector4(_sp(0.1), _sp(0.05), _sp(0.1), _sp(0.2))))
	var decisions: Array = selected.get("decisions", [])
	if decisions.is_empty():
		var empty := _wrap("No recorded formal decisions yet.", 0.67, Color(1, 1, 1, 0.3))
		empty.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		page.add_child(_margin(empty, Vector4(_sp(0.5), _sp(2.0), _sp(0.5), _sp(2.0))))
	for entry: Variant in decisions:
		page.add_child(_decision_card(entry))


func _decision_card(entry: Variant) -> Control:
	var decision: Dictionary = entry
	var decision_id := str(decision.get("id", ""))
	var card := _panel(Vector4(_sp(0.8), _sp(0.8), _sp(0.8), _sp(0.8)), Color(1, 1, 1, 0.026), PANEL_BORDER, 12)
	var column := _column(0)
	var top := _row(_sp(0.6))
	var titles := _column(0)
	titles.add_child(_upper("Formal decision", 0.59, GREY_MUTED))
	titles.add_child(_gap(_sp(0.2)))
	titles.add_child(_wrap(str(decision.get("title", "")), 0.73, UI.WHITE, 700, 1.35))
	var meta := str(decision.get("meta", ""))
	if not meta.is_empty():
		titles.add_child(_gap(_sp(0.25)))
		titles.add_child(_wrap(meta, 0.6, Color(1, 1, 1, 0.35)))
	top.add_child(titles)
	var status_pill := _pill(str(decision.get("status", "")), str(decision.get("statusTone", "bad")))
	status_pill.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	top.add_child(status_pill)
	column.add_child(top)
	var summary := str(decision.get("summary", ""))
	if not summary.is_empty():
		column.add_child(_gap(_sp(0.55)))
		column.add_child(_wrap(summary, 0.65, Color(1, 1, 1, 0.62), 400, 1.5))
	var reason := str(decision.get("reason", ""))
	if not reason.is_empty():
		column.add_child(_gap(_sp(0.42)))
		column.add_child(_wrap(reason, 0.62, Color(1, 1, 1, 0.45), 400, 1.45))
	column.add_child(_gap(_sp(0.65)))
	var tally := _flow(_sp(0.4))
	for item: Variant in decision.get("tally", []):
		var count: Dictionary = item
		var choice := str(count.get("choice", ""))
		var box := _panel(Vector4(_sp(0.58), _sp(0.48), _sp(0.58), _sp(0.48)), Color(1, 1, 1, 0.035), Color(1, 1, 1, 0.07), 9)
		box.custom_minimum_size.x = _sp(4.2)
		box.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		var box_column := _column(_sp(0.08))
		box_column.add_child(_text(str(int(count.get("count", 0))), 0.78, Color("#dcfce7") if choice == "yes" else (Color("#fecaca") if choice == "no" or choice == "veto" else Color(1, 1, 1, 0.8)), 820))
		box_column.add_child(_upper(str(count.get("label", "")), 0.58, Color(1, 1, 1, 0.35), 400))
		box.add_child(box_column)
		tally.add_child(box)
	column.add_child(tally)
	var ballots: Array = decision.get("ballots", [])
	if not ballots.is_empty():
		column.add_child(_gap(_sp(0.65)))
		column.add_child(_rule(0.06))
		column.add_child(_gap(_sp(0.5)))
		var open := bool(_positions_open.get(decision_id, false))
		var toggle := _clickable(UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0), func() -> void:
			_positions_open[decision_id] = not open
			_render())
		toggle.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		var toggle_row := HBoxContainer.new()
		toggle_row.add_theme_constant_override("separation", _sp(0.35))
		toggle_row.mouse_filter = Control.MOUSE_FILTER_IGNORE
		toggle_row.add_child(_text(("Hide" if open else "View") + " recorded member positions", 0.62, GREY_SOFT, 760))
		toggle_row.add_child(_pill(str(ballots.size()), "neutral"))
		var chevron := UI.label("⌃" if open else "⌄", _px(0.75), Color(1, 1, 1, 0.4))
		chevron.add_theme_font_override("font", _symbol_font(400))
		chevron.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		toggle_row.add_child(chevron)
		toggle.add_child(toggle_row)
		column.add_child(toggle)
		if open:
			column.add_child(_gap(_sp(0.55)))
			var available := _width() - 2.0 * _sp(1.0) - 2.0 * _sp(0.8)
			var grid := GridContainer.new()
			grid.columns = _columns_for(18.0, _sp(0.45), ballots.size(), available)
			grid.add_theme_constant_override("h_separation", _sp(0.45))
			grid.add_theme_constant_override("v_separation", _sp(0.45))
			grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			for item: Variant in ballots:
				var ballot: Dictionary = item
				var box := _panel(Vector4(_sp(0.65), _sp(0.58), _sp(0.65), _sp(0.58)), Color(0, 0, 0, 0.12), Color(1, 1, 1, 0.07), 10)
				box.size_flags_vertical = Control.SIZE_FILL
				var box_column := _column(0)
				var head := _row(_sp(0.4))
				head.add_child(_clip(str(ballot.get("polity", "")), 0.65, UI.WHITE, 700))
				head.add_child(_pill(str(ballot.get("choice", "")), str(ballot.get("tone", "neutral"))))
				box_column.add_child(head)
				var government := str(ballot.get("government", ""))
				if not government.is_empty():
					box_column.add_child(_gap(_sp(0.16)))
					box_column.add_child(_wrap(government, 0.58, Color(1, 1, 1, 0.3)))
				box_column.add_child(_gap(_sp(0.38)))
				var why := str(ballot.get("reason", ""))
				if why.is_empty():
					box_column.add_child(_italic("No recorded public rationale.", 0.62, Color(1, 1, 1, 0.3)))
				else:
					box_column.add_child(_wrap(why, 0.62, Color(1, 1, 1, 0.62), 400, 1.45))
				var date := str(ballot.get("date", ""))
				if not date.is_empty():
					box_column.add_child(_gap(_sp(0.32)))
					box_column.add_child(_text(date, 0.58, Color(1, 1, 1, 0.25)))
				box.add_child(box_column)
				grid.add_child(box)
			column.add_child(grid)
	card.add_child(column)
	return card


func _render_charter(selected: Dictionary) -> void:
	var page := _content_area(_sp(56.0), _sp(0.75))
	var charter: Dictionary = selected.get("charter", {})
	var inner := _width() - 2.0 * _sp(1.0)
	inner = minf(inner, _sp(56.0)) - 2.0 * _sp(1.0)
	var framework := _panel(Vector4(_sp(1.0), _sp(0.9), _sp(1.0), _sp(0.9)))
	var column := _column(0)
	var top := _row(_sp(0.7))
	var titles := _column(0)
	titles.add_child(_upper("Decision framework", 0.64, GREY_MUTED, 400))
	titles.add_child(_gap(_sp(0.25)))
	titles.add_child(_wrap(str(charter.get("rule", "")), 0.86, UI.WHITE, 780))
	top.add_child(titles)
	var default_pill := _pill("Default rule", "neutral")
	default_pill.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	top.add_child(default_pill)
	column.add_child(top)
	var note := str(charter.get("note", ""))
	if not note.is_empty():
		column.add_child(_gap(_sp(0.55)))
		column.add_child(_wrap(note, 0.67, Color(1, 1, 1, 0.55), 400, 1.5))
	var rules: Array = charter.get("proposalRules", [])
	if not rules.is_empty():
		column.add_child(_gap(_sp(0.75)))
		column.add_child(_rule(0.06))
		column.add_child(_gap(_sp(0.65)))
		var grid := GridContainer.new()
		grid.columns = _columns_for(12.0, _sp(0.8), rules.size(), inner)
		grid.add_theme_constant_override("h_separation", _sp(0.8))
		grid.add_theme_constant_override("v_separation", _sp(0.45))
		grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		for entry: Variant in rules:
			var rule: Dictionary = entry
			var line := _row(_sp(0.45))
			line.add_child(_clip(str(rule.get("label", "")), 0.64, Color(1, 1, 1, 0.62)))
			line.add_child(_pill(str(rule.get("rule", "")), "neutral"))
			grid.add_child(line)
		column.add_child(grid)
	framework.add_child(column)
	page.add_child(framework)
	var lifecycle: Variant = charter.get("lifecycle")
	if typeof(lifecycle) != TYPE_DICTIONARY:
		return
	var life: Dictionary = lifecycle
	var constitution := _panel(Vector4(_sp(1.0), _sp(0.9), _sp(1.0), _sp(0.9)))
	var life_column := _column(0)
	life_column.add_child(_text("Membership constitution", 0.78, UI.WHITE, 780))
	var facts: Array[Control] = []
	for pair: Array in [["Purpose", "purpose", 1.45], ["Political character", "politicalCharacter", 1.45], ["Geographic scope", "geographicScope", 1.3], ["Primary threat model", "primaryThreatModel", 1.3]]:
		var value := str(life.get(pair[1], ""))
		if value.is_empty():
			continue
		var fact := _column(_sp(0.2))
		fact.add_child(_upper(str(pair[0]), 0.61, Color(1, 1, 1, 0.34), 400))
		fact.add_child(_wrap(value, 0.66, Color(1, 1, 1, 0.62), 400, float(pair[2])))
		facts.append(fact)
	if not facts.is_empty():
		life_column.add_child(_gap(_sp(0.6)))
		var fact_grid := GridContainer.new()
		fact_grid.columns = _columns_for(14.0, _sp(1.0), facts.size(), inner)
		fact_grid.add_theme_constant_override("h_separation", _sp(1.0))
		fact_grid.add_theme_constant_override("v_separation", _sp(0.6))
		fact_grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		for fact: Control in facts:
			fact.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
			fact_grid.add_child(fact)
		life_column.add_child(fact_grid)
	life_column.add_child(_gap(_sp(0.75)))
	life_column.add_child(_rule(0.06))
	life_column.add_child(_gap(_sp(0.65)))
	var life_rules: Array = life.get("rules", [])
	var rule_grid := GridContainer.new()
	rule_grid.columns = _columns_for(13.0, _sp(0.45), life_rules.size(), inner)
	rule_grid.add_theme_constant_override("h_separation", _sp(0.45))
	rule_grid.add_theme_constant_override("v_separation", _sp(0.45))
	rule_grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for entry: Variant in life_rules:
		var rule: Dictionary = entry
		var box := _panel(Vector4(_sp(0.65), _sp(0.58), _sp(0.65), _sp(0.58)), PANEL_BG, PANEL_BORDER, 12)
		box.size_flags_vertical = Control.SIZE_FILL
		var line := _row(_sp(0.55))
		var label_column := _column(_sp(0.16))
		label_column.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		label_column.add_child(_text(str(rule.get("label", "")), 0.62, UI.WHITE, 760))
		var rule_note := str(rule.get("note", ""))
		if not rule_note.is_empty():
			label_column.add_child(_wrap(rule_note, 0.59, Color(1, 1, 1, 0.35)))
		line.add_child(label_column)
		line.add_child(_pill(str(rule.get("mode", "")), "neutral"))
		var notice := str(rule.get("notice", ""))
		if not notice.is_empty():
			var notice_label := _text(notice, 0.59, Color(1, 1, 1, 0.36))
			notice_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			line.add_child(notice_label)
		box.add_child(line)
		rule_grid.add_child(box)
	life_column.add_child(rule_grid)
	constitution.add_child(life_column)
	page.add_child(constitution)


func _render_members(selected: Dictionary) -> void:
	var id := str(selected.get("id", ""))
	var name := str(selected.get("name", ""))
	var page := _content_area(_sp(56.0), _sp(0.75))
	var busy := not _busy.is_empty()
	var accession: Variant = selected.get("accession")
	if typeof(accession) == TYPE_DICTIONARY:
		var data: Dictionary = accession
		var card := _panel(Vector4(_sp(0.9), _sp(0.9), _sp(0.9), _sp(0.9)), PANEL_BG, GREY_BORDER, 12)
		var column := _column(0)
		column.add_child(_text("Request accession", 0.78, UI.WHITE, 780))
		column.add_child(_gap(_sp(0.24)))
		column.add_child(_wrap("Your request opens formal membership business under this institution's charter. Membership is never granted merely by sending the request.", 0.64, Color(1, 1, 1, 0.46), 400, 1.5))
		column.add_child(_gap(_sp(0.6)))
		var reason := _area("Why is your government seeking membership?", _application_reason, 2, 1200)
		reason.text_changed.connect(func() -> void: _application_reason = reason.text)
		column.add_child(reason)
		column.add_child(_gap(_sp(0.5)))
		var buttons := _flow(_sp(0.45))
		var blocked := bool(data.get("blocked", false))
		var request := _button("Request membership", {"bg": GREY_RAISED, "border": GREY_BORDER_STRONG, "ink": GREY_TEXT, "size": 0.65, "weight": 760, "pad": Vector4(_sp(0.65), _sp(0.42), _sp(0.65), _sp(0.42)), "radius": 8})
		_lock(request, busy or blocked, Control.CURSOR_WAIT if busy else Control.CURSOR_POINTING_HAND)
		request.pressed.connect(func() -> void: _apply(id, "member"))
		buttons.add_child(request)
		if bool(data.get("observer", false)):
			var observer := _button("Request observer status", {"bg": Color(1, 1, 1, 0.04), "border": Color(1, 1, 1, 0.1), "ink": Color(1, 1, 1, 0.72), "size": 0.65, "weight": 400, "pad": Vector4(_sp(0.65), _sp(0.42), _sp(0.65), _sp(0.42)), "radius": 8})
			_lock(observer, busy or blocked, Control.CURSOR_WAIT if busy else Control.CURSOR_POINTING_HAND)
			observer.pressed.connect(func() -> void: _apply(id, "observer"))
			buttons.add_child(observer)
		column.add_child(buttons)
		card.add_child(column)
		page.add_child(card)
	var actions: Variant = selected.get("actions")
	if typeof(actions) == TYPE_DICTIONARY:
		page.add_child(_membership_actions(id, actions))
	var cases: Array = selected.get("lifecycleCases", [])
	if not cases.is_empty():
		var section := _column(0)
		section.add_child(_upper("Pending membership business", 0.64, Color(253 / 255.0, 230 / 255.0, 138 / 255.0, 0.68)))
		section.add_child(_gap(_sp(0.45)))
		var cards := _column(_sp(0.45))
		for entry: Variant in cases:
			cards.add_child(_case_card(id, name, entry))
		section.add_child(cards)
		page.add_child(section)
	var members_section := _column(0)
	var members: Array = selected.get("members", [])
	var head := _row(_sp(0.5))
	head.add_child(_text("Current members", 0.78, UI.WHITE, 700))
	var count := _text("%d listed" % members.size(), 0.64, Color(1, 1, 1, 0.32))
	count.size_flags_vertical = Control.SIZE_SHRINK_END
	head.add_child(count)
	head.add_child(UI.spacer())
	members_section.add_child(head)
	members_section.add_child(_gap(_sp(0.45)))
	var list := _column(_sp(0.35))
	for entry: Variant in members:
		list.add_child(_member_row(id, entry))
	members_section.add_child(list)
	page.add_child(members_section)
	var history: Array = selected.get("history", [])
	if not history.is_empty():
		var box := _panel(Vector4(_sp(0.8), _sp(0.72), _sp(0.8), _sp(0.72)))
		var column := _column(0)
		var toggle := _button(("▾ " if _history_open else "▸ ") + "Membership history (%d)" % int(selected.get("historyCount", history.size())), {"ink": Color(1, 1, 1, 0.68), "size": 0.69, "weight": 730, "pad": Vector4(0, 0, 0, 0), "radius": 0, "align": HORIZONTAL_ALIGNMENT_LEFT, "font": _symbol_font(730)})
		toggle.pressed.connect(func() -> void:
			_history_open = not _history_open
			_render())
		column.add_child(toggle)
		if _history_open:
			column.add_child(_gap(_sp(0.5)))
			for index in range(history.size()):
				var item: Dictionary = history[index]
				if index > 0:
					column.add_child(_rule(0.055))
				var line := _row(_sp(0.5))
				line.add_child(_wrap(str(item.get("line", "")), 0.62, Color(1, 1, 1, 0.58)))
				var date := str(item.get("date", ""))
				if not date.is_empty():
					var date_label := _text(date, 0.6, Color(1, 1, 1, 0.27))
					date_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
					line.add_child(date_label)
				column.add_child(_margin(line, Vector4(_sp(0.05), _sp(0.42), _sp(0.05), _sp(0.42))))
		box.add_child(column)
		page.add_child(box)


func _membership_actions(institution_id: String, actions: Dictionary) -> Control:
	var busy := not _busy.is_empty()
	var card := _panel(Vector4(_sp(0.9), _sp(0.9), _sp(0.9), _sp(0.9)))
	var column := _column(0)
	var top := _row(_sp(0.5))
	var titles := _column(_sp(0.18))
	titles.add_child(_text("Membership actions", 0.78, UI.WHITE, 700))
	titles.add_child(_wrap("Invite governments or begin a formal membership procedure.", 0.62, Color(1, 1, 1, 0.4)))
	top.add_child(titles)
	top.add_child(_pill(str(actions.get("status", "")), "live" if bool(actions.get("live", false)) else "neutral"))
	column.add_child(top)
	column.add_child(_gap(_sp(0.6)))
	var invitable: Array = actions.get("invitable", [])
	var polities: Array = []
	var notes := {}
	for entry: Variant in invitable:
		var item: Dictionary = entry
		polities.append(str(item.get("polity", "")))
		var note := str(item.get("note", ""))
		if not note.is_empty():
			notes[str(item.get("polity", "")).to_lower()] = note
	if not _invite_target.is_empty() and not polities.any(func(name: Variant) -> bool: return str(name).to_lower() == _invite_target.to_lower()):
		_invite_target = ""
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", _sp(0.45))
	grid.add_theme_constant_override("v_separation", _sp(0.45))
	grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var send := _button("Send invitation", {"bg": Color(1, 1, 1, 0.055), "border": GREY_BORDER, "ink": GREY_TEXT, "size": 0.65, "weight": 750, "pad": Vector4(_sp(0.62), _sp(0.4), _sp(0.62), _sp(0.4)), "radius": 8})
	var picker := PolityPicker.new(self, polities, notes, "Search a government…", false, _invite_target, func(value: String) -> void:
		_invite_target = value
		_lock(send, not _busy.is_empty() or _invite_target.strip_edges().is_empty(), Control.CURSOR_FORBIDDEN))
	picker.custom_minimum_size.x = _sp(12.0)
	grid.add_child(picker)
	var statuses: Array = []
	for entry: Variant in actions.get("statuses", []):
		var option: Dictionary = entry
		statuses.append([str(option.get("value", "")), str(option.get("label", ""))])
	var status := _select(statuses, _invite_status, 0.68, Vector4(_sp(0.56), _sp(0.48), _sp(0.56), _sp(0.48)))
	status.size_flags_vertical = Control.SIZE_FILL
	status.item_selected.connect(func(index: int) -> void:
		_invite_status = str(status.get_item_metadata(index))
		refresh())
	grid.add_child(status)
	var reason := _field("Reason or proposed terms (optional)", _invite_reason, 1200)
	reason.text_changed.connect(func(value: String) -> void: _invite_reason = value)
	grid.add_child(reason)
	_lock(send, busy or _invite_target.strip_edges().is_empty(), Control.CURSOR_WAIT if busy else Control.CURSOR_FORBIDDEN)
	send.pressed.connect(func() -> void: _invite(institution_id))
	grid.add_child(send)
	column.add_child(grid)
	column.add_child(_gap(_sp(0.65)))
	column.add_child(_rule(0.06))
	column.add_child(_gap(_sp(0.6)))
	var toggle := _button(("▾ " if _discipline_open else "▸ ") + "Withdrawal, discipline & dissolution", {"ink": Color(1, 1, 1, 0.62), "size": 0.64, "weight": 720, "pad": Vector4(0, 0, 0, 0), "radius": 0, "align": HORIZONTAL_ALIGNMENT_LEFT, "font": _symbol_font(720)})
	toggle.pressed.connect(func() -> void:
		_discipline_open = not _discipline_open
		_render())
	column.add_child(toggle)
	if _discipline_open:
		column.add_child(_gap(_sp(0.55)))
		var why := _area("Reason for withdrawal, disciplinary motion or dissolution proposal (optional)", _lifecycle_reason, 2, 1200)
		why.text_changed.connect(func() -> void: _lifecycle_reason = why.text)
		column.add_child(why)
		column.add_child(_gap(_sp(0.45)))
		var buttons := _flow(_sp(0.4))
		var pad := Vector4(_sp(0.55), _sp(0.36), _sp(0.55), _sp(0.36))
		var withdraw := _button("Withdraw from institution", {"bg": Color(AMBER, 0.07), "border": Color(AMBER, 0.2), "ink": AMBER_TEXT, "size": 0.62, "weight": 400, "pad": pad, "radius": 8})
		var dissolve := _button("Propose dissolution", {"bg": Color(RED, 0.06), "border": Color(RED, 0.2), "ink": RED_TEXT, "size": 0.62, "weight": 400, "pad": pad, "radius": 8})
		_lock(withdraw, busy)
		_lock(dissolve, busy)
		withdraw.pressed.connect(func() -> void:
			_confirmed(str(actions.get("withdrawConfirm", "")), func() -> void: _lifecycle(institution_id, "withdraw", {"type": "withdraw", "reason": _lifecycle_reason})))
		dissolve.pressed.connect(func() -> void:
			_confirmed(str(actions.get("dissolveConfirm", "")), func() -> void: _lifecycle(institution_id, "dissolve:", {"type": "dissolve", "polity": "", "reason": _lifecycle_reason})))
		buttons.add_child(withdraw)
		buttons.add_child(dissolve)
		column.add_child(buttons)
	card.add_child(column)
	return card


func _case_card(institution_id: String, institution_name: String, entry: Variant) -> Control:
	var item: Dictionary = entry
	var case_id := str(item.get("id", ""))
	var busy := not _busy.is_empty()
	var card := _panel(Vector4(_sp(0.65), _sp(0.6), _sp(0.65), _sp(0.6)), Color(1, 1, 1, 0.025), PANEL_BORDER, 12)
	var column := _column(0)
	var top := _row(_sp(0.45))
	top.add_child(_wrap(str(item.get("title", "")), 0.63, UI.WHITE, 700))
	top.add_child(_pill(str(item.get("status", "")), str(item.get("tone", "neutral"))))
	column.add_child(top)
	column.add_child(_gap(_sp(0.28)))
	var line := str(item.get("line", ""))
	column.add_child(_wrap(line if not line.is_empty() else institution_name, 0.61, Color(1, 1, 1, 0.48), 400, 1.45))
	var reason := str(item.get("reason", ""))
	if not reason.is_empty():
		column.add_child(_gap(_sp(0.34)))
		column.add_child(_wrap(reason, 0.62, Color(1, 1, 1, 0.58), 400, 1.45))
	var terms := str(item.get("terms", ""))
	if not terms.is_empty():
		column.add_child(_gap(_sp(0.28)))
		column.add_child(_wrap("Terms: " + terms, 0.6, GREY_MUTED, 400, 1.4))
	var add_controls := func(control: Control, align_end: bool) -> void:
		column.add_child(_gap(_sp(0.5)))
		column.add_child(_rule(0.06))
		column.add_child(_gap(_sp(0.45)))
		if align_end:
			var holder := _row(0)
			holder.add_child(UI.spacer())
			holder.add_child(control)
			column.add_child(holder)
		else:
			column.add_child(control)
	var small := Vector4(_sp(0.42), _sp(0.26), _sp(0.42), _sp(0.26))
	if bool(item.get("canOpenNegotiation", false)):
		var open := _button("Opening…" if _busy == "open-lifecycle:" + case_id else "Open negotiation →", {"bg": Color(1, 1, 1, 0.05), "border": GREY_BORDER, "ink": GREY_TEXT, "size": 0.6, "weight": 760, "pad": Vector4(_sp(0.46), _sp(0.28), _sp(0.46), _sp(0.28)), "radius": 7})
		_lock(open, busy)
		open.pressed.connect(func() -> void: _open_lifecycle(institution_id, case_id))
		add_controls.call(open, true)
	if bool(item.get("canCancelApplication", false)) and not bool(item.get("canRetract", false)):
		var cancel := _button("Withdraw application", {"bg": Color(RED, 0.06), "border": Color(RED, 0.2), "ink": RED_TEXT, "size": 0.6, "weight": 400, "pad": small, "radius": 7})
		_lock(cancel, busy)
		cancel.pressed.connect(func() -> void: _lifecycle(institution_id, "cancel-application:" + case_id, {"type": "cancel-application", "caseId": case_id, "reason": _lifecycle_reason}))
		add_controls.call(cancel, true)
	if bool(item.get("canRespond", false)):
		var buttons := _flow(_sp(0.3))
		for choice: Array in [["accept", "Accept", Color(GREEN, 0.08), Color(GREEN, 0.24), Color("#bbf7d0"), 760], ["seek-observer", "Seek observer status", Color(1, 1, 1, 0.045), GREY_BORDER, GREY_TEXT, 400], ["delay", "Decide later", Color(AMBER, 0.06), Color(AMBER, 0.2), AMBER_TEXT, 400], ["reject", "Reject", Color(RED, 0.06), Color(RED, 0.2), RED_TEXT, 400]]:
			var decision: String = choice[0]
			var respond := _button(str(choice[1]), {"bg": choice[2], "border": choice[3], "ink": choice[4], "size": 0.6, "weight": int(choice[5]), "pad": small, "radius": 7})
			_lock(respond, busy)
			respond.pressed.connect(func() -> void: _lifecycle(institution_id, "respond:%s:%s" % [case_id, decision], {"type": "respond", "caseId": case_id, "decision": decision, "reason": _lifecycle_reason}))
			buttons.add_child(respond)
		add_controls.call(buttons, false)
	if bool(item.get("canRetract", false)):
		var retract := _button("Retract", {"bg": Color(RED, 0.06), "border": Color(RED, 0.2), "ink": RED_TEXT, "size": 0.6, "weight": 400, "pad": small, "radius": 7})
		_lock(retract, busy)
		retract.pressed.connect(func() -> void: _lifecycle(institution_id, "retract:" + case_id, {"type": "retract", "caseId": case_id}))
		add_controls.call(retract, true)
	card.add_child(column)
	return card


func _member_row(institution_id: String, entry: Variant) -> Control:
	var member: Dictionary = entry
	var polity := str(member.get("polity", ""))
	var busy := not _busy.is_empty()
	var card := _panel(Vector4(_sp(0.72), _sp(0.62), _sp(0.72), _sp(0.62)), PANEL_BG, PANEL_BORDER, 12)
	var line := _row(_sp(0.55))
	line.add_child(_wrap(polity, 0.69, UI.WHITE, 700))
	line.add_child(_pill(str(member.get("label", "")), "bad" if bool(member.get("suspended", false)) else "neutral"))
	var since := str(member.get("since", ""))
	if not since.is_empty():
		var since_label := _text(since, 0.61, Color(1, 1, 1, 0.3))
		since_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		line.add_child(since_label)
	if bool(member.get("canAct", false)):
		var open := _member_menu == polity
		var more := _button("•••", {"ink": Color(1, 1, 1, 0.46), "size": 0.75, "weight": 400, "pad": Vector4(_sp(0.2), _sp(0.1), _sp(0.2), _sp(0.1)), "radius": 0})
		more.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		more.pressed.connect(func() -> void:
			_member_menu = "" if _member_menu == polity else polity
			_render())
		line.add_child(more)
		if open:
			var menu := PanelContainer.new()
			menu.add_theme_stylebox_override("panel", UI.box(Color(18 / 255.0, 18 / 255.0, 23 / 255.0, 0.98), Color(1, 1, 1, 0.1), 9, 1, Vector4(_sp(0.35), _sp(0.35), _sp(0.35), _sp(0.35))))
			var menu_column := _column(_sp(0.25))
			var item_pad := Vector4(_sp(0.45), _sp(0.38), _sp(0.45), _sp(0.38))
			if bool(member.get("suspended", false)):
				var reinstate := _button("Propose reinstatement", {"bg": Color(GREEN, 0.06), "ink": GREEN_TEXT, "size": 0.64, "weight": 400, "pad": item_pad, "radius": 7, "align": HORIZONTAL_ALIGNMENT_LEFT})
				_lock(reinstate, busy)
				reinstate.pressed.connect(func() -> void: _lifecycle(institution_id, "reinstate:" + polity, {"type": "reinstate", "polity": polity, "reason": _lifecycle_reason}))
				menu_column.add_child(reinstate)
			else:
				var suspend := _button("Propose suspension", {"bg": Color(AMBER, 0.06), "ink": AMBER_TEXT, "size": 0.64, "weight": 400, "pad": item_pad, "radius": 7, "align": HORIZONTAL_ALIGNMENT_LEFT})
				_lock(suspend, busy)
				suspend.pressed.connect(func() -> void: _lifecycle(institution_id, "suspend:" + polity, {"type": "suspend", "polity": polity, "reason": _lifecycle_reason}))
				menu_column.add_child(suspend)
			var expel := _button("Propose expulsion", {"bg": Color(RED, 0.06), "ink": RED_TEXT, "size": 0.64, "weight": 400, "pad": item_pad, "radius": 7, "align": HORIZONTAL_ALIGNMENT_LEFT})
			_lock(expel, busy)
			expel.pressed.connect(func() -> void:
				_confirmed(str(member.get("expelConfirm", "")), func() -> void: _lifecycle(institution_id, "expel:" + polity, {"type": "expel", "polity": polity, "reason": _lifecycle_reason})))
			menu_column.add_child(expel)
			menu.add_child(menu_column)
			_float(menu, more, true, _sp(10.0))
	card.add_child(line)
	return card


func _render_documents(selected: Dictionary) -> void:
	var page := _content_area(0.0, _sp(0.45))
	var documents: Array = selected.get("documents", [])
	if documents.is_empty():
		var empty := _wrap("No institution-related documents currently readable by your government.", 0.67, Color(1, 1, 1, 0.3))
		empty.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		page.add_child(_margin(empty, Vector4(_sp(0.5), _sp(2.0), _sp(0.5), _sp(2.0))))
		return
	for entry: Variant in documents:
		var report: Dictionary = entry
		var card := _panel(Vector4(_sp(0.65), _sp(0.65), _sp(0.65), _sp(0.65)))
		var column := _column(0)
		var top := _row(_sp(0.4))
		top.add_child(UI.label("📄", 16, UI.WHITE))
		top.add_child(_wrap(str(report.get("title", "")), 0.65, UI.WHITE, 700))
		var dateline := str(report.get("dateline", ""))
		if not dateline.is_empty():
			top.add_child(_text(dateline, 0.59, Color(1, 1, 1, 0.3)))
		column.add_child(top)
		column.add_child(_gap(_sp(0.3)))
		column.add_child(_wrap(str(report.get("line", "")), 0.62, Color(1, 1, 1, 0.45)))
		column.add_child(_gap(_sp(0.35)))
		column.add_child(_markdown(str(report.get("body", "")), 0.65, Color(1, 1, 1, 0.6)))
		card.add_child(column)
		page.add_child(card)


func _render_council(selected: Dictionary) -> void:
	var institution_id := str(selected.get("id", ""))
	var margin := MarginContainer.new()
	margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	margin.size_flags_vertical = Control.SIZE_EXPAND_FILL
	margin.add_theme_constant_override("margin_left", _sp(1.0))
	margin.add_theme_constant_override("margin_right", _sp(1.0))
	margin.add_theme_constant_override("margin_top", _sp(0.55))
	margin.add_theme_constant_override("margin_bottom", _sp(0.8))
	var column := _column(0)
	column.size_flags_vertical = Control.SIZE_EXPAND_FILL
	margin.add_child(column)
	_body.add_child(margin)
	var banner := _automation_text(institution_id, str(selected.get("automation", "")))
	if not banner.is_empty():
		var box := _panel(Vector4(_sp(0.7), _sp(0.55), _sp(0.7), _sp(0.55)), Color(1, 1, 1, 0.035), GREY_BORDER, 10)
		box.add_child(_wrap(banner, 0.66, Color(1, 1, 1, 0.72), 400, 1.45))
		column.add_child(box)
		column.add_child(_gap(_sp(0.5)))
	if not bool(selected.get("isMember", false)):
		var public := _panel(Vector4(_sp(0.8), _sp(0.8), _sp(0.8), _sp(0.8)))
		var public_column := _column(0)
		public_column.add_child(_text("Council channel", 0.68, UI.WHITE, 700))
		public_column.add_child(_gap(_sp(0.4)))
		public_column.add_child(_wrap("Only participating governments receive a persistent institutional council channel. This public view does not create one.", 0.62, Color(1, 1, 1, 0.5), 400, 1.5))
		public.add_child(public_column)
		column.add_child(public)
		return
	var channel_id := str(selected.get("channelId", ""))
	var renderer := _council_renderer()
	if not channel_id.is_empty() and renderer.is_valid():
		var pane := _panel(Vector4(0, 0, 0, 0), Color(7 / 255.0, 7 / 255.0, 10 / 255.0, 0.22), GREY_BORDER, 12)
		pane.size_flags_vertical = Control.SIZE_EXPAND_FILL
		pane.clip_contents = true
		var embedded: Variant = renderer.call(channel_id)
		if embedded is Control:
			_embedded = embedded as Control
			var previous := _embedded.get_parent()
			if previous:
				previous.remove_child(_embedded)
			_embedded.size_flags_vertical = Control.SIZE_EXPAND_FILL
			pane.add_child(_embedded)
			column.add_child(pane)
			return
	var card := _panel(Vector4(_sp(0.8), _sp(0.8), _sp(0.8), _sp(0.8)))
	var card_column := _column(0)
	card_column.add_child(_text("Council channel", 0.68, UI.WHITE, 700))
	card_column.add_child(_gap(_sp(0.4)))
	card_column.add_child(_wrap("Preparing the persistent council channel…" if _busy == "council" else "This institution has a persistent Council channel for member discussion. Formal proposals, amendments and ballots remain governed by the institution's charter.", 0.62, Color(1, 1, 1, 0.5), 400, 1.5))
	card_column.add_child(_gap(_sp(0.65)))
	var open := _button("Opening…" if _busy == "council" else "Open council channel", {"bg": GREY_RAISED, "border": GREY_BORDER_STRONG, "ink": GREY_TEXT, "size": 0.64, "weight": 760, "pad": Vector4(_sp(0.65), _sp(0.45), _sp(0.65), _sp(0.45)), "radius": 9})
	open.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	_lock(open, not _busy.is_empty())
	if not channel_id.is_empty():
		UI.set_disabled_look(open, "The Council conversation is not in the native app yet.")
	open.pressed.connect(_open_council)
	card_column.add_child(open)
	card.add_child(card_column)
	column.add_child(card)


func _council_renderer() -> Callable:
	var direct: Variant = context.get("render_council")
	if direct is Callable and (direct as Callable).is_valid():
		return direct
	var host: Variant = context.get("chat_panel")
	if host is Object and is_instance_valid(host) and (host as Object).has_method("render_council"):
		return Callable(host, "render_council")
	return Callable()


func _automation_text(institution_id: String, fallback: String) -> String:
	for key: Variant in _automation:
		var entry: Dictionary = _automation[key]
		if str(entry.get("institutionId", "")).to_lower() == institution_id.to_lower():
			return "Member governments are casting formal ballots…" if str(entry.get("kind", "")) == "vote" else "Council members are considering the tabled matter…"
	return fallback


func _render_founding() -> void:
	var page := _scroll_area(Vector4(_sp(1.0), _sp(1.0), _sp(1.15), _sp(1.2)), _sp(0.85), _sp(50.0))
	var mobile := _mobile()
	var intro := _column(0)
	intro.add_child(_upper("Found an institution", 0.64, GREY_MUTED))
	intro.add_child(_gap(_sp(0.2)))
	intro.add_child(_wrap("Create the institution first. Let diplomacy decide who joins it.", 1.0, UI.WHITE, 820))
	intro.add_child(_gap(_sp(0.3)))
	var description := _wrap("Foreign governments are invited, never auto-enrolled. Their decisions use the current Political World, relations, strategic fit and the institution's actual purpose. The simple form uses sensible charter defaults; advanced settings remain fully editable.", 0.7, Color(1, 1, 1, 0.5), 400, 1.55)
	intro.add_child(description)
	page.add_child(intro)
	var panel := _panel(Vector4(_sp(0.9), _sp(0.9), _sp(0.9), _sp(0.9)))
	var fields := _column(_sp(0.75))
	var pair := func(left: Control, right: Control) -> void:
		if mobile:
			fields.add_child(left)
			if right:
				fields.add_child(right)
			return
		var row := _row(_sp(0.75))
		left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(left)
		if right:
			right.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			row.add_child(right)
		else:
			var filler := Control.new()
			filler.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			row.add_child(filler)
		fields.add_child(row)
	var name_edit := _founding_line("name", "Baltic Union", 160)
	_field_style(name_edit, 0.72, Vector4(_sp(0.62), _sp(0.52), _sp(0.62), _sp(0.52)))
	fields.add_child(_labelled("Name", name_edit))
	if _founding_autofocus:
		_founding_autofocus = false
		name_edit.grab_focus.call_deferred()
	var kinds: Array = []
	for entry: Variant in _model.get("kinds", []):
		var kind: Dictionary = entry
		kinds.append([str(kind.get("value", "")), str(kind.get("label", ""))])
	var type_select := _founding_select("kind", kinds, 0.7, Vector4(_sp(0.58), _sp(0.5), _sp(0.58), _sp(0.5)))
	var advanced := _button("Hide advanced settings" if _advanced else "Advanced settings", {"bg": GREY_SELECTED if _advanced else Color(1, 1, 1, 0.035), "border": GREY_BORDER_STRONG if _advanced else GREY_BORDER, "ink": GREY_TEXT if _advanced else Color(1, 1, 1, 0.68), "size": 0.64, "weight": 760, "pad": Vector4(_sp(0.7), _sp(0.48), _sp(0.7), _sp(0.48)), "radius": 8})
	advanced.pressed.connect(func() -> void:
		_advanced = not _advanced
		_render())
	var toggle_holder := HBoxContainer.new()
	toggle_holder.alignment = BoxContainer.ALIGNMENT_END
	advanced.size_flags_vertical = Control.SIZE_SHRINK_END
	toggle_holder.add_child(advanced)
	pair.call(_labelled("Type", type_select), toggle_holder)
	var purpose := _area("What is this institution for?", str(_founding.get("purpose", "")), 3, 1600, 0.7, 1.5)
	purpose.text_changed.connect(func() -> void: _founding["purpose"] = purpose.text)
	fields.add_child(_labelled("Purpose", purpose))
	var polities: Array = _model.get("polities", [])
	var invitees := PolityPicker.new(self, polities, {}, "Search governments…", true, str(_founding.get("invitees", "")), func(value: String) -> void: _founding["invitees"] = value)
	fields.add_child(_labelled("Invite founding governments", invitees))
	if _advanced:
		var section := _column(0)
		section.add_child(_gap(_sp(0.05)))
		section.add_child(_rule(0.07))
		section.add_child(_gap(_sp(0.7)))
		section.add_child(_upper("Advanced identity & governance", 0.62, GREY_MUTED))
		fields.add_child(section)
		pair.call(_labelled("Short name", _founding_line("shortName", "BU", 24)), _labelled("Decision rule", _founding_select("votingRule", [["simple-majority", "Simple majority"], ["qualified-majority", "Qualified majority"], ["unanimity", "Unanimity"]])))
		fields.add_child(_labelled("Political character", _founding_line("politicalCharacter", "Regional political and security integration", 500)))
		pair.call(_labelled("Geographic scope", _founding_line("geographicScope", "Baltic States", 800)), _labelled("Primary threat / adversary model", _founding_line("primaryThreatModel", "Optional", 800)))
		pair.call(_labelled("Minimum founding members", _founding_number("minimumFoundingMembers", 1, 64, true)), null)
		var constitution := _column(0)
		constitution.add_child(_gap(_sp(0.05)))
		constitution.add_child(_rule(0.07))
		constitution.add_child(_gap(_sp(0.7)))
		constitution.add_child(_upper("Membership constitution", 0.62, GREY_MUTED))
		constitution.add_child(_gap(_sp(0.2)))
		constitution.add_child(_wrap("These rules become canonical charter law. Diplomacy may negotiate within them, but neither chat nor the AI can bypass them.", 0.62, Color(1, 1, 1, 0.36), 400, 1.45))
		fields.add_child(constitution)
		pair.call(_labelled("Accession", _founding_select("accessionMode", [["approval", "Member vote required"], ["direct", "Direct after acceptance"]])), _labelled("Observer status", _founding_select("allowObserver", [["yes", "Allowed"], ["no", "Not allowed"]])))
		pair.call(_labelled("Withdrawal", _founding_select("withdrawalMode", [["unilateral", "Unilateral"], ["notice", "Notice required"], ["approval", "Institution approval required"], ["not-permitted", "Not permitted"]])), _labelled("Withdrawal notice", _founding_number("withdrawalNoticeDays", 0, 3650, str(_founding.get("withdrawalMode", "")) == "notice")))
		pair.call(_labelled("Expulsion", _founding_select("expulsionMode", [["approval", "Formal vote permitted"], ["not-permitted", "Not permitted"]])), _labelled("Dissolution", _founding_select("dissolutionMode", [["approval", "Formal vote permitted"], ["not-permitted", "Not permitted"]])))
		var note := _area("Optional public founding principles or special terms", str(_founding.get("charterNote", "")), 2, 1200)
		note.text_changed.connect(func() -> void: _founding["charterNote"] = note.text)
		fields.add_child(_labelled("Founding charter note", note))
	panel.add_child(fields)
	page.add_child(panel)
	var footer := _flow(_sp(0.6))
	var hint := _text("Advanced charter settings are visible." if _advanced else "Simple mode uses the charter defaults shown under Advanced settings.", 0.62, Color(1, 1, 1, 0.34))
	hint.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	footer.add_child(hint)
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	spacer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	footer.add_child(spacer)
	var buttons := HBoxContainer.new()
	buttons.add_theme_constant_override("separation", _sp(0.45))
	var founding_busy := _busy == "found"
	var cancel := _button("Cancel", {"bg": Color(1, 1, 1, 0.035), "border": Color(1, 1, 1, 0.1), "ink": Color(1, 1, 1, 0.65), "size": 0.66, "weight": 400, "pad": Vector4(_sp(0.75), _sp(0.46), _sp(0.75), _sp(0.46)), "radius": 8})
	_lock(cancel, founding_busy)
	cancel.pressed.connect(func() -> void:
		_founding_open = false
		_render())
	buttons.add_child(cancel)
	var submit := _button("Founding…" if founding_busy else "Found institution", {"bg": GREY_RAISED, "border": GREY_BORDER_STRONG, "ink": GREY_TEXT, "size": 0.66, "weight": 780, "pad": Vector4(_sp(0.8), _sp(0.46), _sp(0.8), _sp(0.46)), "radius": 8})
	var refresh_submit := func() -> void:
		_lock(submit, founding_busy or str(_founding.get("name", "")).strip_edges().is_empty(), Control.CURSOR_FORBIDDEN)
	refresh_submit.call()
	submit.pressed.connect(_found_institution)
	buttons.add_child(submit)
	footer.add_child(buttons)
	page.add_child(footer)
	name_edit.text_changed.connect(func(_value: String) -> void: refresh_submit.call())


func _labelled(label: String, control: Control) -> Control:
	var column := _column(_sp(0.28))
	column.add_child(_text(label, 0.66, Color(1, 1, 1, 0.58), 650))
	column.add_child(control)
	return column


func _founding_line(key: String, placeholder: String, max_length: int) -> LineEdit:
	var edit := _field(placeholder, str(_founding.get(key, "")), max_length)
	edit.text_changed.connect(func(value: String) -> void: _founding[key] = value)
	return edit


func _founding_select(key: String, options: Array, rem := 0.68, pad := Vector4(9, 8, 9, 8)) -> OptionButton:
	var current := str(_founding.get(key, ""))
	if key == "allowObserver":
		current = "yes" if bool(_founding.get(key, true)) else "no"
	var select := _select(options, current, rem, Vector4(_sp(0.56), _sp(0.48), _sp(0.56), _sp(0.48)) if pad == Vector4(9, 8, 9, 8) else pad)
	select.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	select.fit_to_longest_item = false
	select.item_selected.connect(func(index: int) -> void:
		var value := str(select.get_item_metadata(index))
		if key == "allowObserver":
			_founding[key] = value == "yes"
		else:
			_founding[key] = value
		if key == "withdrawalMode":
			_render())
	return select


func _founding_number(key: String, low: int, high: int, enabled: bool) -> SpinBox:
	var spin := SpinBox.new()
	spin.min_value = low
	spin.max_value = high
	spin.step = 1
	spin.value = clampi(str(_founding.get(key, str(low))).to_int(), low, high)
	spin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	spin.editable = enabled
	spin.modulate.a = 1.0 if enabled else 0.45
	var line := spin.get_line_edit()
	_field_style(line, 0.68, Vector4(_sp(0.56), _sp(0.48), _sp(0.56), _sp(0.48)))
	spin.value_changed.connect(func(value: float) -> void: _founding[key] = str(int(value)))
	return spin


func _confirmed(question: String, action: Callable) -> void:
	if question.strip_edges().is_empty():
		action.call()
		return
	_confirm_action = action
	_confirm.dialog_text = question
	_confirm.popup_centered(Vector2i(420, 0))


func _chats_changed() -> void:
	chats_changed.emit()
	if chats_changed.get_connections().is_empty():
		var host: Variant = context.get("chat_panel")
		if host is Object and is_instance_valid(host) and (host as Object).has_method("refresh"):
			(host as Object).call("refresh")


func _open_chat(chat_id: String) -> void:
	lifecycle_chat_opened.emit(chat_id)
	if lifecycle_chat_opened.get_connections().is_empty():
		var host: Variant = context.get("chat_panel")
		if host is Object and is_instance_valid(host) and (host as Object).has_method("open_thread"):
			if (host as Object).has_method("refresh"):
				await (host as Object).call("refresh")
			(host as Object).call("open_thread", chat_id)


func _run(key: String, method: String, args: Dictionary) -> Variant:
	if not _busy.is_empty():
		return null
	_busy = key
	_error = ""
	_render()
	var reply: Dictionary = await engine.request(method, args)
	_busy = ""
	if not reply.get("ok", false):
		_error = str(reply.get("error", ""))
		await refresh()
		return null
	_chats_changed()
	var result: Variant = reply.get("result")
	await refresh()
	return result if result != null else true


func _lifecycle(institution_id: String, key: String, command: Dictionary) -> void:
	await _run(key, "institutions.lifecycle", {"institutionId": institution_id, "command": command})


func _apply(institution_id: String, status: String) -> void:
	var result: Variant = await _run("apply:" + status, "institutions.apply", {"institutionId": institution_id, "requestedStatus": status, "reason": _application_reason})
	if typeof(result) == TYPE_DICTIONARY:
		var chat_id := str((result as Dictionary).get("createdChatId", ""))
		if not chat_id.is_empty():
			_open_chat(chat_id)


func _invite(institution_id: String) -> void:
	if _invite_target.strip_edges().is_empty():
		return
	var result: Variant = await _run("invite", "institutions.invite", {"institutionId": institution_id, "polity": _invite_target, "requestedStatus": _invite_status, "reason": _invite_reason})
	if result == null:
		return
	_invite_target = ""
	_invite_reason = ""
	_render()
	if typeof(result) == TYPE_DICTIONARY:
		var chat_id := str((result as Dictionary).get("createdChatId", ""))
		if not chat_id.is_empty():
			_open_chat(chat_id)


func _open_lifecycle(institution_id: String, case_id: String) -> void:
	var result: Variant = await _run("open-lifecycle:" + case_id, "institutions.openLifecycle", {"institutionId": institution_id, "caseId": case_id})
	if typeof(result) == TYPE_DICTIONARY:
		var chat_id := str((result as Dictionary).get("channelId", ""))
		if not chat_id.is_empty():
			_open_chat(chat_id)


func _open_council() -> void:
	var selected: Variant = _model.get("selected")
	_section = "council"
	if typeof(selected) != TYPE_DICTIONARY or not bool((selected as Dictionary).get("isMember", false)):
		_render()
		return
	var data: Dictionary = selected
	var existing := str(data.get("channelId", ""))
	if not existing.is_empty():
		_render()
		council_opened.emit(existing)
		return
	var result: Variant = await _run("council", "institutions.openCouncil", {"institutionId": str(data.get("id", ""))})
	if typeof(result) == TYPE_DICTIONARY:
		var chat_id := str((result as Dictionary).get("channelId", ""))
		if not chat_id.is_empty():
			council_opened.emit(chat_id)


func _found_institution() -> void:
	if not _busy.is_empty() or str(_founding.get("name", "")).strip_edges().is_empty():
		return
	_busy = "found"
	_error = ""
	_render()
	var reply: Dictionary = await engine.request("institutions.found", {"founding": _founding})
	_busy = ""
	if not reply.get("ok", false):
		_error = str(reply.get("error", ""))
		_render()
		return
	_chats_changed()
	var result: Dictionary = reply.get("result", {})
	var institution_id := str(result.get("institutionId", ""))
	if institution_id.is_empty():
		_render()
		return
	_founding_open = false
	_founding = FOUNDING_DEFAULTS.duplicate()
	_selected_id = institution_id
	_section = "overview"
	await refresh()
	var chat_id := str(result.get("createdChatId", ""))
	if not chat_id.is_empty():
		_open_chat(chat_id)


func _council_turn(institution_id: String, proposal_id: String, kind: String, comment := "", source := "player") -> String:
	var reply: Dictionary = await engine.request("institutions.councilTurn", {"institutionId": institution_id, "proposalId": proposal_id, "kind": kind, "playerComment": comment, "source": source})
	_chats_changed()
	if not reply.get("ok", false):
		return str(reply.get("error", ""))
	return ""


func _create_proposal(institution_id: String, mode: String) -> void:
	if _proposal_title.strip_edges().is_empty() or institution_id.is_empty() or not _busy.is_empty():
		return
	_busy = "proposal:" + mode
	_error = ""
	_render()
	var reply: Dictionary = await engine.request("institutions.proposal", {"institutionId": institution_id, "title": _proposal_title, "summary": _proposal_summary, "mode": mode})
	if not reply.get("ok", false):
		_busy = ""
		_error = str(reply.get("error", ""))
		await refresh()
		return
	_chats_changed()
	var proposal_id := str((reply.get("result", {}) as Dictionary).get("proposalId", ""))
	_proposal_title = ""
	_proposal_summary = ""
	if mode == "debate":
		_section = "council"
	await refresh()
	var failure := await _council_turn(institution_id, proposal_id, "vote" if mode == "vote" else "debate", "", "table-proposal:" + mode)
	_busy = ""
	if not failure.is_empty():
		_error = "The proposal is %s, but the Council response could not be generated: %s" % ["open for voting" if mode == "vote" else "tabled for debate", failure]
	await refresh()


func _submit_vote(institution_id: String, proposal_id: String) -> void:
	if not _busy.is_empty():
		return
	_busy = "submit:" + proposal_id
	_error = ""
	_render()
	var reply: Dictionary = await engine.request("institutions.submit", {"institutionId": institution_id, "proposalId": proposal_id})
	if not reply.get("ok", false):
		_busy = ""
		_error = str(reply.get("error", ""))
		await refresh()
		return
	_chats_changed()
	var comment := str(_vote_comments.get(proposal_id, "")).strip_edges()
	_vote_comments.erase(proposal_id)
	await refresh()
	var failure := await _council_turn(institution_id, proposal_id, "vote", comment, "call-vote")
	_busy = ""
	if not failure.is_empty():
		_error = "The formal vote is open, but the Council response could not be generated: " + failure
	await refresh()


func _add_amendment(institution_id: String, proposal_id: String) -> void:
	var text := str(_amend_drafts.get(proposal_id, "")).strip_edges()
	if text.is_empty():
		return
	var result: Variant = await _run("amend:" + proposal_id, "institutions.amend", {"institutionId": institution_id, "proposalId": proposal_id, "text": text})
	if result != null:
		_amend_drafts.erase(proposal_id)
		_render()


func _request_amendment_decision(institution_id: String, proposal: Dictionary, amendment_id: String) -> void:
	var proposal_id := str(proposal.get("id", ""))
	if not _busy.is_empty() or proposal_id.is_empty() or amendment_id.is_empty():
		return
	_busy = "amend-request:%s:%s" % [proposal_id, amendment_id]
	_error = ""
	_section = "council"
	_render()
	var comment := "Please resolve the pending amendment on %s. The proposal sponsor should accept or reject it so the proposal can proceed to a formal vote." % str(proposal.get("title", ""))
	var failure := await _council_turn(institution_id, proposal_id, "amendment", comment, "resolve-amendment")
	_busy = ""
	if not failure.is_empty():
		_error = "The amendment is still pending because the sponsor response could not be generated: " + failure
	await refresh()


class PolityPicker extends VBoxContainer:
	var owner_view: Control
	var polities: Array = []
	var notes := {}
	var label := ""
	var multiple := true
	var value := ""
	var on_change := Callable()
	var _query := ""
	var _open := false
	var _frame: PanelContainer
	var _chips: HFlowContainer
	var _edit: LineEdit
	var _results: VBoxContainer
	var _results_panel: PanelContainer

	static func _size(rem: float) -> int:
		return maxi(8, roundi(rem * 16.0))

	func _init(view: Control, choices: Array, marks: Dictionary, placeholder: String, many: bool, initial: String, changed: Callable) -> void:
		owner_view = view
		polities = choices
		notes = marks
		label = placeholder
		multiple = many
		value = initial
		on_change = changed
		size_flags_horizontal = Control.SIZE_EXPAND_FILL
		add_theme_constant_override("separation", 0)
		_frame = PanelContainer.new()
		_frame.add_theme_stylebox_override("panel", UI.box(Color(8 / 255.0, 8 / 255.0, 12 / 255.0, 0.72), Color(1, 1, 1, 0.1), 8, 1, Vector4(6, 4, 6, 4)))
		_frame.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		_frame.custom_minimum_size.y = 34
		_chips = HFlowContainer.new()
		_chips.add_theme_constant_override("h_separation", 5)
		_chips.add_theme_constant_override("v_separation", 5)
		_chips.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		_frame.add_child(_chips)
		add_child(_frame)
		_edit = LineEdit.new()
		_edit.flat = true
		_edit.custom_minimum_size = Vector2(144, 22)
		_edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var plain := StyleBoxEmpty.new()
		plain.content_margin_left = 4
		plain.content_margin_right = 4
		for state: String in ["normal", "focus", "read_only"]:
			_edit.add_theme_stylebox_override(state, plain)
		_edit.add_theme_font_override("font", UI.font(400))
		_edit.add_theme_font_size_override("font_size", _size(0.64))
		_edit.add_theme_color_override("font_color", Color(1, 1, 1, 0.86))
		_edit.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.45))
		_edit.add_theme_color_override("caret_color", UI.WHITE)
		_edit.text_changed.connect(func(text: String) -> void:
			_query = text
			_open = true
			_fill())
		_edit.focus_entered.connect(func() -> void:
			_open = true
			_fill())
		_edit.focus_exited.connect(_close_soon)
		_edit.text_submitted.connect(func(_text: String) -> void: _choose_first())
		_edit.gui_input.connect(func(event: InputEvent) -> void:
			var key := event as InputEventKey
			if key and key.pressed:
				if key.keycode == KEY_ESCAPE:
					_open = false
					_fill()
				elif key.keycode == KEY_BACKSPACE and _query.is_empty():
					var current := _selected()
					if not current.is_empty():
						_remove(str(current[current.size() - 1]))
						_edit.accept_event())
		_results_panel = PanelContainer.new()
		_results_panel.add_theme_stylebox_override("panel", UI.box(Color(20 / 255.0, 20 / 255.0, 25 / 255.0, 0.985), GREY_BORDER, 9, 1, Vector4(4, 4, 4, 4)))
		_results_panel.mouse_filter = Control.MOUSE_FILTER_STOP
		_results = VBoxContainer.new()
		_results.add_theme_constant_override("separation", 0)
		_results.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		_results_panel.add_child(_results)
		_results_panel.visible = false
		_rebuild_chips()

	func _ready() -> void:
		owner_view.call("_float", _results_panel, _frame, false, 160.0)
		_results_panel.visible = false

	func _exit_tree() -> void:
		if is_instance_valid(_results_panel):
			_results_panel.visible = false

	func _close_soon() -> void:
		await get_tree().create_timer(0.12).timeout
		if is_instance_valid(self) and is_instance_valid(_edit) and not _edit.has_focus():
			_open = false
			_fill()

	func _selected() -> Array:
		var out: Array = []
		if multiple:
			for part: String in value.replace("\n", ";").replace(",", ";").split(";"):
				var name := part.strip_edges()
				if not name.is_empty() and not out.any(func(entry: Variant) -> bool: return str(entry).to_lower() == name.to_lower()):
					out.append(name)
		elif not value.strip_edges().is_empty():
			out.append(value.strip_edges())
		return out

	func _commit(next: Array) -> void:
		var names: PackedStringArray = []
		for entry: Variant in next:
			names.append(str(entry))
		value = "; ".join(names) if multiple else (names[0] if names.size() > 0 else "")
		if on_change.is_valid():
			on_change.call(value)
		_rebuild_chips()

	func _choose(polity: String) -> void:
		var exact := polity.strip_edges()
		var current := _selected()
		if exact.is_empty() or current.any(func(entry: Variant) -> bool: return str(entry).to_lower() == exact.to_lower()):
			return
		if multiple:
			current.append(exact)
			_commit(current)
		else:
			_commit([exact])
		_query = ""
		_edit.text = ""
		_open = multiple
		_fill()
		if multiple:
			_edit.grab_focus.call_deferred()

	func _remove(polity: String) -> void:
		var current := _selected().filter(func(entry: Variant) -> bool: return str(entry).to_lower() != polity.to_lower())
		_commit(current)
		_fill()

	func _matches() -> Array:
		var needle := _query.strip_edges().to_lower()
		var keys := _selected().map(func(entry: Variant) -> String: return str(entry).to_lower())
		var found: Array = []
		for entry: Variant in polities:
			var name := str(entry)
			if keys.has(name.to_lower()):
				continue
			if not needle.is_empty() and name.to_lower().find(needle) < 0:
				continue
			found.append(name)
		found.sort_custom(func(a: Variant, b: Variant) -> bool:
			var a_name := str(a)
			var b_name := str(b)
			var a_starts := 0 if not needle.is_empty() and a_name.to_lower().begins_with(needle) else 1
			var b_starts := 0 if not needle.is_empty() and b_name.to_lower().begins_with(needle) else 1
			if a_starts != b_starts:
				return a_starts < b_starts
			var a_noted := 0 if needle.is_empty() and notes.has(a_name.to_lower()) else 1
			var b_noted := 0 if needle.is_empty() and notes.has(b_name.to_lower()) else 1
			if a_noted != b_noted:
				return a_noted < b_noted
			return a_name.naturalnocasecmp_to(b_name) < 0)
		return found.slice(0, 8)

	func _choose_first() -> void:
		var needle := _query.strip_edges().to_lower()
		for entry: Variant in polities:
			if str(entry).to_lower() == needle:
				_choose(str(entry))
				return
		var found := _matches()
		if not found.is_empty():
			_choose(str(found[0]))

	func _rebuild_chips() -> void:
		for child in _chips.get_children():
			_chips.remove_child(child)
			if child != _edit:
				child.queue_free()
		var current := _selected()
		for entry: Variant in current:
			var name := str(entry)
			var chip := PanelContainer.new()
			chip.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.055), GREY_BORDER, 999, 1, Vector4(_size(0.46), _size(0.22) - 4, _size(0.38), _size(0.22) - 4)))
			var chip_row := HBoxContainer.new()
			chip_row.add_theme_constant_override("separation", 4)
			var chip_label := UI.label(name, _size(0.6), GREY_TEXT, 720)
			chip_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			chip_row.add_child(chip_label)
			var remove := Button.new()
			remove.flat = true
			remove.text = "×"
			remove.focus_mode = Control.FOCUS_NONE
			remove.tooltip_text = "Remove " + name
			remove.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
			remove.add_theme_font_size_override("font_size", _size(0.7))
			for color_name: String in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color"]:
				remove.add_theme_color_override(color_name, Color(1, 1, 1, 0.5))
			for state: String in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
				remove.add_theme_stylebox_override(state, StyleBoxEmpty.new())
			remove.pressed.connect(func() -> void: _remove(name))
			chip_row.add_child(remove)
			chip.add_child(chip_row)
			_chips.add_child(chip)
		_chips.add_child(_edit)
		_edit.placeholder_text = (("Add another government…" if multiple else "Change government…") if not current.is_empty() else label)

	func _fill() -> void:
		for child in _results.get_children():
			_results.remove_child(child)
			child.queue_free()
		if not _open:
			_results_panel.visible = false
			return
		var found := _matches()
		if found.is_empty():
			if _query.is_empty():
				_results_panel.visible = false
				return
			var none := UI.wrapped("No canonical polity matches “%s”." % _query, _size(0.6), Color(1, 1, 1, 0.38))
			var pad := MarginContainer.new()
			pad.add_theme_constant_override("margin_left", 6)
			pad.add_theme_constant_override("margin_right", 6)
			pad.add_theme_constant_override("margin_top", 5)
			pad.add_theme_constant_override("margin_bottom", 5)
			pad.add_child(none)
			_results.add_child(pad)
			_results_panel.visible = true
			owner_view.set_process(true)
			return
		for entry: Variant in found:
			var name := str(entry)
			var row := Button.new()
			row.focus_mode = Control.FOCUS_NONE
			row.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
			row.custom_minimum_size.y = _size(0.62) + 2 * _size(0.42)
			row.add_theme_stylebox_override("hover", UI.box(Color(1, 1, 1, 0.07), Color(0, 0, 0, 0), 7))
			row.add_theme_stylebox_override("normal", StyleBoxEmpty.new())
			row.add_theme_stylebox_override("pressed", UI.box(Color(1, 1, 1, 0.07), Color(0, 0, 0, 0), 7))
			row.add_theme_stylebox_override("hover_pressed", UI.box(Color(1, 1, 1, 0.07), Color(0, 0, 0, 0), 7))
			row.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
			var content := HBoxContainer.new()
			content.add_theme_constant_override("separation", _size(0.45))
			content.mouse_filter = Control.MOUSE_FILTER_IGNORE
			content.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
			content.offset_left = 8
			content.offset_right = -8
			var dot := Panel.new()
			dot.custom_minimum_size = Vector2(7, 7)
			dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			dot.add_theme_stylebox_override("panel", UI.box(Color(231 / 255.0, 231 / 255.0, 234 / 255.0, 0.58), Color(0, 0, 0, 0), 999))
			dot.mouse_filter = Control.MOUSE_FILTER_IGNORE
			content.add_child(dot)
			var caption := UI.label(name, _size(0.62), Color(1, 1, 1, 0.82))
			caption.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			caption.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			caption.clip_text = true
			content.add_child(caption)
			var note := str(notes.get(name.to_lower(), ""))
			if not note.is_empty():
				var tag := PanelContainer.new()
				tag.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0), GREY_BORDER, 999, 1, Vector4(6, 1, 6, 1)))
				tag.size_flags_vertical = Control.SIZE_SHRINK_CENTER
				tag.mouse_filter = Control.MOUSE_FILTER_IGNORE
				tag.add_child(UI.label(note, _size(0.6), Color(1, 1, 1, 0.6), 720))
				content.add_child(tag)
			row.add_child(content)
			row.button_down.connect(func() -> void: _choose(name))
			_results.add_child(row)
		_results_panel.visible = true
		owner_view.set_process(true)
