extends PanelContainer

signal confirmed(chosen: Array)
signal cancelled

const CARD_MIN := 288.0
const GRID_GAP := 6

var title_text := "New diplomatic channel"
var subtitle_text := "Choose one or more governments for your correspondence."
var selected_label := "Recipients"
var empty_label := "No countries selected yet"
var confirm_label: Callable = func(count: int) -> String: return "Start conversation" if count > 0 else "Choose a recipient"
var single := false
var countries: Array = []
var loading := false
var selected: Array = []
var flag_maker: Callable
var corner := 16

var title_label: Label
var kicker_label: Label
var subtitle_label: Label
var search: LineEdit
var count_badge: Label
var chips: HFlowContainer
var results_count: Label
var results: ScrollContainer
var grid: GridContainer
var empty_note: Label
var confirm_button: Button
var cancel_button: Button
var _search_frame: PanelContainer
var _heading_margin: MarginContainer
var _controls_margin: MarginContainer
var _results_heading: PanelContainer
var _results_margin: MarginContainer
var _footer: PanelContainer
var _confirm_arrow: Label
var _confirm_text: Label


func _init() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	_build()


func configure(options: Dictionary) -> void:
	title_text = str(options.get("title", "New diplomatic channel"))
	subtitle_text = str(options.get("subtitle", "Choose one or more governments for your correspondence."))
	selected_label = str(options.get("selected_label", "Recipients"))
	empty_label = str(options.get("empty_label", "No countries selected yet"))
	single = options.get("single", false) == true
	var label_of: Variant = options.get("confirm_label")
	confirm_label = label_of if label_of is Callable else (func(count: int) -> String: return "Start conversation" if count > 0 else "Choose a recipient")
	if options.has("corner"):
		corner = int(options.get("corner"))
	selected = []
	search.text = ""
	_restyle()
	render()
	if not UI.phone():
		search.grab_focus.call_deferred()


func set_countries(list: Array, still_loading: bool) -> void:
	countries = list
	loading = still_loading
	render()


func unique_countries() -> Array:
	var seen := {}
	var out: Array = []
	for entry in countries:
		var country: Dictionary = entry
		var country_name := str(country.get("name", ""))
		if country_name.is_empty() or seen.has(country_name):
			continue
		seen[country_name] = true
		out.append(country)
	return out


func filtered() -> Array:
	var unique := unique_countries()
	var query := search.text.strip_edges().to_lower()
	if query.is_empty():
		return unique
	var out: Array = []
	for entry in unique:
		var country: Dictionary = entry
		if str(country.get("name", "")).to_lower().contains(query) or str(country.get("code", "")).to_lower().contains(query):
			out.append(country)
			continue
		if query.length() >= 3:
			for alias in country.get("aliases", []):
				if str(alias).begins_with(query):
					out.append(country)
					break
	return out


func is_chosen(country_name: String) -> bool:
	for entry in selected:
		if str((entry as Dictionary).get("name", "")) == country_name:
			return true
	return false


func toggle(country: Dictionary) -> void:
	var country_name := str(country.get("name", ""))
	if is_chosen(country_name):
		selected = selected.filter(func(entry: Variant) -> bool: return str((entry as Dictionary).get("name", "")) != country_name)
	elif single:
		selected = [{"name": country_name, "code": str(country.get("code", "")), "flag": str(country.get("flag", ""))}]
	else:
		selected.append({"name": country_name, "code": str(country.get("code", "")), "flag": str(country.get("flag", ""))})
	var offset := results.scroll_vertical
	render()
	await get_tree().process_frame
	if is_instance_valid(results):
		results.scroll_vertical = offset


func render() -> void:
	title_label.text = title_text
	kicker_label.text = "Target directory" if single else "Diplomatic directory"
	subtitle_label.text = subtitle_text
	_render_selection()
	_render_grid()
	_render_confirm()


func _accent() -> Color:
	return UiTheme.pick("accent", Color("#91c9e7"))


func _text() -> Color:
	return UiTheme.pick("text", Color("#f4f4f5"))


func _muted(alpha: float) -> Color:
	return UiTheme.pick("muted", Color(1, 1, 1, alpha))


func _line(fallback: Color) -> Color:
	return UiTheme.pick("line", fallback)


func _build() -> void:
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	var heading := PanelContainer.new()
	heading.name = "Heading"
	_heading_margin = MarginContainer.new()
	var heading_row := HBoxContainer.new()
	heading_row.add_theme_constant_override("separation", 16)
	var copy := VBoxContainer.new()
	copy.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	copy.add_theme_constant_override("separation", 0)
	kicker_label = UI.label("", 10, Color("#91c9e7"), 850, "Arial", 1)
	kicker_label.uppercase = true
	copy.add_child(kicker_label)
	copy.add_child(_gap(6))
	title_label = UI.label("", 18, Color("#f4f4f5"), 840)
	title_label.clip_text = true
	title_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	copy.add_child(title_label)
	copy.add_child(_gap(5))
	subtitle_label = UI.wrapped("", 12, Color(1, 1, 1, 0.52))
	subtitle_label.add_theme_constant_override("line_spacing", 3)
	copy.add_child(subtitle_label)
	heading_row.add_child(copy)
	var close := Button.new()
	close.name = "Close"
	close.text = "✕"
	close.tooltip_text = "Close"
	close.focus_mode = Control.FOCUS_NONE
	close.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	close.custom_minimum_size = Vector2(32, 32)
	close.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	close.add_theme_font_override("font", UI.font(400))
	close.add_theme_font_size_override("font_size", 14)
	close.pressed.connect(_on_cancel)
	UI.tap_size(close)
	heading_row.add_child(close)
	_heading_margin.add_child(heading_row)
	heading.add_child(_heading_margin)
	column.add_child(heading)
	_controls_margin = MarginContainer.new()
	var controls := VBoxContainer.new()
	controls.add_theme_constant_override("separation", 12)
	_search_frame = PanelContainer.new()
	var search_row := HBoxContainer.new()
	search_row.add_theme_constant_override("separation", 0)
	var lens := TextureRect.new()
	lens.texture = UI.svg_texture("<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><circle cx='11' cy='11' r='7'/><line x1='21' y1='21' x2='16.65' y2='16.65'/></svg>", 1.0)
	lens.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
	lens.custom_minimum_size = Vector2(27, 0)
	lens.mouse_filter = Control.MOUSE_FILTER_IGNORE
	lens.name = "Lens"
	search_row.add_child(lens)
	search = LineEdit.new()
	search.placeholder_text = "Search countries..."
	search.flat = true
	for state in ["normal", "focus", "read_only"]:
		search.add_theme_stylebox_override(state, StyleBoxEmpty.new())
	search.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	search.custom_minimum_size.y = 37
	search.add_theme_font_override("font", UI.font(500))
	search.add_theme_font_size_override("font_size", 13)
	search.text_changed.connect(_on_search)
	search.focus_entered.connect(_restyle)
	search.focus_exited.connect(_restyle)
	if UI.phone():
		search.set_meta("oh_tap_exempt", true)
	search_row.add_child(search)
	_search_frame.add_child(search_row)
	controls.add_child(_search_frame)
	var selection := VBoxContainer.new()
	selection.add_theme_constant_override("separation", 7)
	var section_top := HBoxContainer.new()
	section_top.add_theme_constant_override("separation", 9)
	section_top.name = "SectionTop"
	var section_label := UI.label("", 10, Color(1, 1, 1, 0.62), 850, "Arial", 1)
	section_label.uppercase = true
	section_top.add_child(section_label)
	var badge := PanelContainer.new()
	badge.name = "CountBadge"
	badge.custom_minimum_size = Vector2(18, 18)
	count_badge = UI.label("0", 10, Color("#91c9e7"), 850)
	count_badge.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	count_badge.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	badge.add_child(count_badge)
	section_top.add_child(badge)
	selection.add_child(section_top)
	chips = HFlowContainer.new()
	chips.add_theme_constant_override("h_separation", 6)
	chips.add_theme_constant_override("v_separation", 6)
	chips.custom_minimum_size.y = 26
	selection.add_child(chips)
	controls.add_child(selection)
	_controls_margin.add_child(controls)
	column.add_child(_controls_margin)
	_results_heading = PanelContainer.new()
	var results_row := HBoxContainer.new()
	results_row.add_theme_constant_override("separation", 16)
	var available := UI.label("Available countries", 11, Color(1, 1, 1, 0.6), 800, "Arial", 1)
	available.uppercase = true
	available.name = "Available"
	available.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	results_row.add_child(available)
	results_count = UI.label("", 11, Color("#91c9e7"), 700)
	results_count.uppercase = true
	results_row.add_child(results_count)
	_results_heading.add_child(results_row)
	column.add_child(_results_heading)
	results = ScrollContainer.new()
	results.size_flags_vertical = Control.SIZE_EXPAND_FILL
	results.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	results.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_SHOW_NEVER if UI.phone() else ScrollContainer.SCROLL_MODE_AUTO
	var bar := results.get_v_scroll_bar()
	bar.custom_minimum_size.x = 8
	bar.add_theme_stylebox_override("scroll", StyleBoxEmpty.new())
	bar.add_theme_stylebox_override("scroll_focus", StyleBoxEmpty.new())
	bar.add_theme_stylebox_override("grabber", UI.box(Color(1, 1, 1, 0.22), Color(0, 0, 0, 0), 999, 0))
	bar.add_theme_stylebox_override("grabber_highlight", UI.box(Color(1, 1, 1, 0.32), Color(0, 0, 0, 0), 999, 0))
	bar.add_theme_stylebox_override("grabber_pressed", UI.box(Color(1, 1, 1, 0.32), Color(0, 0, 0, 0), 999, 0))
	_results_margin = MarginContainer.new()
	_results_margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var results_column := VBoxContainer.new()
	results_column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	empty_note = UI.label("", 12, Color(1, 1, 1, 0.45))
	empty_note.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	empty_note.visible = false
	results_column.add_child(empty_note)
	grid = GridContainer.new()
	grid.columns = 1
	grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	grid.add_theme_constant_override("h_separation", GRID_GAP)
	grid.add_theme_constant_override("v_separation", GRID_GAP)
	results_column.add_child(grid)
	_results_margin.add_child(results_column)
	results.add_child(_results_margin)
	results.resized.connect(_fit_columns)
	column.add_child(results)
	_footer = PanelContainer.new()
	var foot_row := HBoxContainer.new()
	foot_row.alignment = BoxContainer.ALIGNMENT_END
	foot_row.add_theme_constant_override("separation", 10)
	cancel_button = Button.new()
	cancel_button.text = "Cancel"
	cancel_button.focus_mode = Control.FOCUS_NONE
	cancel_button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	cancel_button.custom_minimum_size.y = 40
	cancel_button.add_theme_font_override("font", UI.font(760))
	cancel_button.add_theme_font_size_override("font_size", 12)
	cancel_button.pressed.connect(_on_cancel)
	foot_row.add_child(cancel_button)
	confirm_button = Button.new()
	confirm_button.focus_mode = Control.FOCUS_NONE
	confirm_button.custom_minimum_size = Vector2(192, 40)
	confirm_button.pressed.connect(_on_confirm)
	var confirm_row := HBoxContainer.new()
	confirm_row.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	confirm_row.alignment = BoxContainer.ALIGNMENT_CENTER
	confirm_row.add_theme_constant_override("separation", 9)
	confirm_row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_confirm_text = UI.label("", 12, Color("#91c9e7"), 760)
	confirm_row.add_child(_confirm_text)
	_confirm_arrow = UI.label("→", 12, Color("#91c9e7"), 760)
	confirm_row.add_child(_confirm_arrow)
	confirm_button.add_child(confirm_row)
	foot_row.add_child(confirm_button)
	_footer.add_child(foot_row)
	column.add_child(_footer)
	add_child(column)
	_restyle()


func _gap(height: int) -> Control:
	var spacer := Control.new()
	spacer.custom_minimum_size.y = height
	spacer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return spacer


func _margins(margin: MarginContainer, left: int, top: int, right: int, bottom: int) -> void:
	margin.add_theme_constant_override("margin_left", left)
	margin.add_theme_constant_override("margin_top", top)
	margin.add_theme_constant_override("margin_right", right)
	margin.add_theme_constant_override("margin_bottom", bottom)


func _restyle() -> void:
	var phone := UI.phone()
	add_theme_stylebox_override("panel", UI.box(UiTheme.pick("overlay", Color("#1b1c22")), Color(0, 0, 0, 0), corner, 0))
	var heading_style := UI.box(UiTheme.pick("overlay_header", Color(1, 1, 1, 0.025)), _line(Color(1, 1, 1, 0.1)), 0, 0)
	heading_style.border_width_bottom = 1
	heading_style.corner_radius_top_left = corner
	heading_style.corner_radius_top_right = corner
	(_heading_margin.get_parent() as PanelContainer).add_theme_stylebox_override("panel", heading_style)
	if phone:
		_margins(_heading_margin, 12, 13, 12, 10)
		_margins(_controls_margin, 12, 11, 12, 11)
		_margins(_results_margin, 9, 8, 9, 8)
	else:
		_margins(_heading_margin, 20, 18, 20, 14)
		_margins(_controls_margin, 18, 14, 18, 12)
		_margins(_results_margin, 16, 12, 16, 12)
	kicker_label.add_theme_color_override("font_color", _accent())
	title_label.add_theme_color_override("font_color", _text())
	subtitle_label.add_theme_color_override("font_color", _muted(0.52))
	var close := _heading_margin.find_child("Close", true, false) as Button
	if close:
		var plain := UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 8, 1)
		var lit := UI.box(UiTheme.pick("hover", Color(1, 1, 1, 0.09)), Color(0, 0, 0, 0), 8, 1)
		for state in ["normal", "focus", "disabled"]:
			close.add_theme_stylebox_override(state, plain)
		for state in ["hover", "pressed", "hover_pressed"]:
			close.add_theme_stylebox_override(state, lit)
		close.add_theme_color_override("font_color", _muted(0.56))
		for state in ["font_hover_color", "font_pressed_color", "font_hover_pressed_color"]:
			close.add_theme_color_override(state, UiTheme.pick("text", UI.WHITE))
	var focused := search.has_focus()
	var frame := UI.box(UiTheme.pick("overlay_card", Color(1, 1, 1, 0.04)), _accent() if focused else _line(Color(1, 1, 1, 0.14)), 10, 1, Vector4(12, 0, 13, 0))
	if focused:
		frame.shadow_color = UiTheme.pick("active", Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.12))
		frame.shadow_size = 2
	_search_frame.add_theme_stylebox_override("panel", frame)
	(_search_frame.find_child("Lens", true, false) as TextureRect).modulate = _muted(0.5)
	search.add_theme_color_override("font_color", UiTheme.pick("text", UI.WHITE))
	search.add_theme_color_override("font_placeholder_color", _muted(0.4))
	search.add_theme_color_override("caret_color", UiTheme.pick("text", UI.WHITE))
	var section_top := _controls_margin.find_child("SectionTop", true, false) as HBoxContainer
	(section_top.get_child(0) as Label).text = selected_label
	(section_top.get_child(0) as Label).add_theme_color_override("font_color", _muted(0.62))
	(section_top.get_child(1) as PanelContainer).add_theme_stylebox_override("panel", UI.box(UiTheme.pick("active", Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.14)), Color(0, 0, 0, 0), 5, 0, Vector4(4, 0, 4, 0)))
	count_badge.add_theme_color_override("font_color", _accent())
	var results_style := UI.box(Color(0, 0, 0, 0), _line(Color(1, 1, 1, 0.08)), 0, 0, Vector4(12 if phone else 19, 9 if phone else 10, 12 if phone else 19, 9 if phone else 10))
	results_style.border_width_top = 1
	results_style.border_width_bottom = 1
	_results_heading.add_theme_stylebox_override("panel", results_style)
	(_results_heading.find_child("Available", true, false) as Label).add_theme_color_override("font_color", _muted(0.6))
	results_count.add_theme_color_override("font_color", _accent())
	empty_note.add_theme_color_override("font_color", _muted(0.45))
	var foot_style := UI.box(UiTheme.pick("overlay_header", Color(1, 1, 1, 0.025)), _line(Color(1, 1, 1, 0.1)), 0, 0, Vector4(12 if phone else 18, 10 if phone else 14, 12 if phone else 18, 10 if phone else 14))
	foot_style.border_width_top = 1
	foot_style.corner_radius_bottom_left = corner
	foot_style.corner_radius_bottom_right = corner
	_footer.add_theme_stylebox_override("panel", foot_style)
	var cancel_normal := UI.box(UiTheme.pick("overlay_card", Color(1, 1, 1, 0.05)), _line(Color(1, 1, 1, 0.13)), 9, 1, Vector4(16, 11, 16, 11))
	var cancel_hover := UI.box(UiTheme.pick("hover", Color(1, 1, 1, 0.1)), _line(Color(1, 1, 1, 0.13)), 9, 1, Vector4(16, 11, 16, 11))
	for state in ["normal", "focus", "disabled"]:
		cancel_button.add_theme_stylebox_override(state, cancel_normal)
	for state in ["hover", "pressed", "hover_pressed"]:
		cancel_button.add_theme_stylebox_override(state, cancel_hover)
	for state in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color"]:
		cancel_button.add_theme_color_override(state, UiTheme.pick("text", UI.WHITE))
	cancel_button.custom_minimum_size.x = 74 if phone else 0
	confirm_button.custom_minimum_size.x = 0 if phone else 192
	confirm_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL if phone else Control.SIZE_FILL


func _render_selection() -> void:
	count_badge.text = str(selected.size())
	for child in chips.get_children():
		chips.remove_child(child)
		child.queue_free()
	if selected.is_empty():
		var empty := UI.label(empty_label, 12, _muted(0.4))
		empty.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		chips.add_child(empty)
		return
	for entry in selected:
		var country: Dictionary = entry
		chips.add_child(_chip(country))


func _chip(country: Dictionary) -> Control:
	var country_name := str(country.get("name", ""))
	var chip := Button.new()
	chip.focus_mode = Control.FOCUS_NONE
	chip.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	chip.tooltip_text = "Remove " + country_name
	var normal := UI.box(UiTheme.pick("active", Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.14)), _line(Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.22)), 7, 1, Vector4(8, 5, 8, 5))
	var lit := UI.box(UiTheme.pick("hover", Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.22)), _line(Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.22)), 7, 1, Vector4(8, 5, 8, 5))
	for state in ["normal", "focus", "disabled"]:
		chip.add_theme_stylebox_override(state, normal)
	for state in ["hover", "pressed", "hover_pressed"]:
		chip.add_theme_stylebox_override(state, lit)
	var row := HBoxContainer.new()
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.add_theme_constant_override("separation", 7)
	row.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	row.offset_left = 8
	row.offset_right = -8
	if flag_maker.is_valid():
		var flag: Control = flag_maker.call(country_name, str(country.get("flag", "")), Vector2(11, 11))
		flag.mouse_filter = Control.MOUSE_FILTER_IGNORE
		flag.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(flag)
	var label := UI.label(country_name, 11, UiTheme.pick("text", UI.WHITE), 650)
	label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	label.clip_text = true
	label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	label.custom_minimum_size.x = minf(256.0, UI.font(650).get_string_size(country_name, HORIZONTAL_ALIGNMENT_LEFT, -1, 11).x + 1.0)
	row.add_child(label)
	var cross := UI.label("×", 14, _accent())
	cross.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(cross)
	chip.add_child(row)
	chip.custom_minimum_size = Vector2(row.get_combined_minimum_size().x + 16, 26)
	chip.pressed.connect(toggle.bind(country))
	return chip


func _render_grid() -> void:
	for child in grid.get_children():
		grid.remove_child(child)
		child.queue_free()
	var shown := filtered()
	results_count.text = "Loading..." if loading else "%d of %d" % [shown.size(), unique_countries().size()]
	if loading:
		empty_note.text = "Loading countries…"
		empty_note.visible = true
		return
	if shown.is_empty():
		empty_note.text = "No matching countries."
		empty_note.visible = true
		return
	empty_note.visible = false
	for entry in shown:
		grid.add_child(_country_card(entry))
	_fit_columns()


func _fit_columns() -> void:
	if grid == null or not is_instance_valid(grid):
		return
	var phone := UI.phone()
	var width := results.size.x - (18.0 if phone else 32.0)
	if width <= 0.0:
		return
	grid.columns = maxi(1, floori((width + GRID_GAP) / (minf(width, CARD_MIN) + GRID_GAP)))
	empty_note.custom_minimum_size.y = 96.0


func _country_card(country: Dictionary) -> Control:
	var country_name := str(country.get("name", ""))
	var chosen := is_chosen(country_name)
	var card := Button.new()
	card.focus_mode = Control.FOCUS_NONE
	card.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	card.tooltip_text = country_name
	card.custom_minimum_size = Vector2(0, 50)
	card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var pad := Vector4(12, 8, 12, 8)
	var normal := UI.box(UiTheme.pick("active", Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.14)) if chosen else UiTheme.pick("overlay_card", Color(1, 1, 1, 0.035)), _accent() if chosen else _line(Color(1, 1, 1, 0.07)), 9, 1, pad)
	var lit := normal if chosen else UI.box(UiTheme.pick("hover", Color(1, 1, 1, 0.075)), _line(Color(1, 1, 1, 0.23)), 9, 1, pad)
	for state in ["normal", "focus", "disabled"]:
		card.add_theme_stylebox_override(state, normal)
	for state in ["hover", "pressed", "hover_pressed"]:
		card.add_theme_stylebox_override(state, lit)
	var row := HBoxContainer.new()
	row.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	row.offset_left = 12
	row.offset_right = -12
	row.add_theme_constant_override("separation", 11)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if flag_maker.is_valid():
		var flag: Control = flag_maker.call(country_name, str(country.get("flag", "")), Vector2(27, 18))
		flag.mouse_filter = Control.MOUSE_FILTER_IGNORE
		flag.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(flag)
	var label := UI.label(country_name, 12, _text(), 650)
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	label.clip_text = true
	label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	row.add_child(label)
	var indicator := PanelContainer.new()
	indicator.custom_minimum_size = Vector2(19, 19)
	indicator.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	indicator.mouse_filter = Control.MOUSE_FILTER_IGNORE
	indicator.add_theme_stylebox_override("panel", UI.box(_accent() if chosen else Color(0, 0, 0, 0), Color(0, 0, 0, 0) if chosen else _line(Color(1, 1, 1, 0.16)), 5, 0 if chosen else 1))
	var mark := UI.label("✓" if chosen else "+", 12, UiTheme.pick("overlay", Color("#12141a")) if chosen else _muted(0.38), 800)
	if chosen:
		mark.add_theme_color_override("font_color", Color(UiTheme.pick("overlay", Color("#12141a")), 1.0))
	mark.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	mark.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	indicator.add_child(mark)
	row.add_child(indicator)
	card.add_child(row)
	card.pressed.connect(toggle.bind(country))
	return card


func _render_confirm() -> void:
	var count := selected.size()
	var enabled := count > 0
	_confirm_text.text = str(confirm_label.call(count))
	_confirm_arrow.visible = enabled
	confirm_button.disabled = not enabled
	confirm_button.text = ""
	confirm_button.modulate.a = 1.0 if enabled else 0.43
	confirm_button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if enabled else Control.CURSOR_FORBIDDEN
	var normal := UI.box(UiTheme.pick("active", Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.19)), _accent() if enabled else _line(Color(1, 1, 1, 0.1)), 9, 1, Vector4(16, 11, 16, 11))
	var lit := UI.box(UiTheme.pick("hover", Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.26)), _accent(), 9, 1, Vector4(16, 11, 16, 11)) if enabled else normal
	for state in ["normal", "focus", "disabled"]:
		confirm_button.add_theme_stylebox_override(state, normal)
	for state in ["hover", "pressed", "hover_pressed"]:
		confirm_button.add_theme_stylebox_override(state, lit)
	_confirm_text.add_theme_color_override("font_color", _accent())
	_confirm_arrow.add_theme_color_override("font_color", _accent())
	var natural := UI.font(760).get_string_size(_confirm_text.text, HORIZONTAL_ALIGNMENT_LEFT, -1, 12).x + (21.0 if enabled else 0.0) + 32.0
	if not UI.phone():
		confirm_button.custom_minimum_size.x = maxf(192.0, natural)


func _on_search(_text_now: String) -> void:
	_render_grid()


func _on_cancel() -> void:
	cancelled.emit()


func _on_confirm() -> void:
	if selected.is_empty():
		return
	confirmed.emit(selected.duplicate())
