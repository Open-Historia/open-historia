class_name CountryPicker
extends Control

signal start(request: Dictionary)
signal cancelled

const SURFACE := Color(17 / 255.0, 20 / 255.0, 26 / 255.0)
const UNPLAYABLE := [20, 25, 35]
const GOLD := Color("#eab308")
const GROUP_TEXTS := {
	"name": "e.g. Cartel del Norte, the Northern Resistance…",
	"description_label": "Description",
	"description": "What is this group — a cartel, a militia, a movement, an outbreak? What does it want? The AI reads this.",
	"area_label": "Starting area",
	"no_area": "No area yet",
	"some_area": "Choose its area",
	"no_area_text": "The group starts with no area on the map. It can take one as the story goes.",
}

var map_view: MapView
var engine: EngineLink
var context := {}
var _data: Dictionary = {}
var _play_game_id := ""
var _flag_host: Control
var _flag_overlay: Control
var _options: Array = []
var _groups: Array = []
var _difficulties: Array = []
var _offers_groups := false
var _tab := "country"
var _query := ""
var _pick: Dictionary = {}
var _hover_owner := -1
var _hover_region := -1
var _mode := "country"
var _owner_index := {}
var _playable := {}
var _region_ids: Array = []
var _creator := {}
var _selected := {}
var _modal: PanelContainer
var _content: VBoxContainer
var _map_frame: PanelContainer
var _container: SubViewportContainer
var _viewport: SubViewport
var _camera: Camera2D
var _list: VBoxContainer
var _dragging := false
var _drag := 0.0


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.7)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	dim.gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventMouseButton and (event as InputEventMouseButton).pressed and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT:
			_close())
	add_child(dim)
	var centre := CenterContainer.new()
	centre.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	centre.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(centre)
	_modal = PanelContainer.new()
	_modal.add_theme_stylebox_override("panel", UI.box(SURFACE, Color(1, 1, 1, 0.14), 18, 1, Vector4(24, 20, 24, 20)))
	centre.add_child(_modal)
	_content = VBoxContainer.new()
	_content.add_theme_constant_override("separation", 0)
	_modal.add_child(_content)
	_build_map()
	get_viewport().size_changed.connect(func() -> void:
		if visible:
			_size_modal())


func _build_map() -> void:
	_map_frame = PanelContainer.new()
	_map_frame.add_theme_stylebox_override("panel", UI.box(Color("#070e18"), Color(1, 1, 1, 0.12), 14, 1, Vector4(1, 1, 1, 1)))
	_map_frame.clip_contents = true
	_map_frame.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_map_frame.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_container = SubViewportContainer.new()
	_container.stretch = true
	_container.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_container.gui_input.connect(_on_map_input)
	_container.mouse_exited.connect(func() -> void: _set_hover(-1))
	_viewport = SubViewport.new()
	_viewport.transparent_bg = false
	_viewport.handle_input_locally = false
	_camera = Camera2D.new()
	_camera.process_mode = Node.PROCESS_MODE_DISABLED
	_viewport.add_child(_camera)
	_viewport.size_changed.connect(_camera.force_update_scroll)
	_container.add_child(_viewport)
	_map_frame.add_child(_container)


func open(data: Dictionary) -> void:
	_data = data
	_options = data.get("options", [])
	_groups = data.get("groups", [])
	_difficulties = data.get("difficulties", [])
	_offers_groups = bool(data.get("offersGroups", false))
	_play_game_id = str(data.get("playGameId", ""))
	var map: Dictionary = data.get("map", {})
	_region_ids = map.get("regionIds", [])
	var state: Dictionary = map.get("state", {})
	var names: Array = state.get("ownerNames", [])
	_owner_index.clear()
	for index in range(names.size()):
		_owner_index[str(names[index])] = index
	_playable.clear()
	for option in _options:
		_playable[str(option.get("code", ""))] = option
	_tab = "country"
	_query = ""
	_pick = {}
	_hover_owner = -1
	_hover_region = -1
	_mode = "country"
	_creator = {}
	_selected = {}
	_viewport.world_2d = map_view.get_viewport().world_2d
	var centre := MapView.CityLayer.ohproject(0.0, 20.0)
	_camera.position = centre
	_camera.zoom = Vector2.ONE * pow(2.0, 2.0) / 8.0
	_render()
	_sync.call_deferred()


func _close() -> void:
	_close_flag_picker()
	_mode = "country"
	cancelled.emit()


func is_play_mode() -> bool:
	return not _play_game_id.is_empty()


func _size_modal() -> void:
	var view := get_viewport_rect().size
	if not _pick.is_empty():
		_modal.custom_minimum_size = Vector2(minf(460.0, view.x * 0.92), 0)
	else:
		_modal.custom_minimum_size = Vector2(minf(1120.0, view.x * 0.95), minf(720.0, view.y * 0.86))
	_modal.reset_size()


func _clear() -> void:
	if _map_frame.get_parent():
		_map_frame.get_parent().remove_child(_map_frame)
	for child in _content.get_children():
		_content.remove_child(child)
		child.queue_free()
	_list = null


func _render() -> void:
	_clear()
	_size_modal()
	if not _pick.is_empty():
		_render_difficulty()
		return
	_render_header()
	var credits: Array = _data.get("scenario", {}).get("credits", [])
	if not credits.is_empty():
		var lines := PackedStringArray(["Music:"])
		for entry in credits:
			lines.append(("%s %s" % [str(entry.get("credit", "")), str(entry.get("site", ""))]).strip_edges())
		var block := UI.label("\n".join(lines), 12, Color(1, 1, 1, 0.58))
		block.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		var spaced := MarginContainer.new()
		spaced.add_theme_constant_override("margin_bottom", 10)
		spaced.add_child(block)
		_content.add_child(spaced)
	if _tab == "group" and not is_play_mode():
		_render_group_tab()
		_set_mode("regions" if not _creator.is_empty() and not bool(_creator.get("landless", true)) else "country")
		return
	_set_mode("country")
	var body := HBoxContainer.new()
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_theme_constant_override("separation", 20)
	var left := VBoxContainer.new()
	left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	left.size_flags_stretch_ratio = 1.5
	left.add_theme_constant_override("separation", 8)
	_map_frame.custom_minimum_size = Vector2(0, 480)
	left.add_child(_map_frame)
	var hint := HBoxContainer.new()
	hint.add_child(UI.label("🌍 Drag to pan • Scroll to zoom • Click any nation to select", 12, Color(1, 1, 1, 0.45)))
	hint.add_child(UI.spacer())
	hint.add_child(UI.label("%d playable nations" % _options.size(), 12, Color(1, 1, 1, 0.45)))
	left.add_child(hint)
	body.add_child(left)
	body.add_child(_render_list())
	_content.add_child(body)
	_render_footer()


func _render_header() -> void:
	var header := HBoxContainer.new()
	header.add_theme_constant_override("separation", 10)
	var titles := VBoxContainer.new()
	titles.add_theme_constant_override("separation", 3)
	titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var eyebrow := HBoxContainer.new()
	eyebrow.add_theme_constant_override("separation", 7)
	var chip := PanelContainer.new()
	chip.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.08), Color(0, 0, 0, 0), 4, 0, Vector4(7, 2, 7, 2)))
	chip.add_child(UI.label("SCENARIO", 10, Color(1, 1, 1, 0.55), 700, "Arial", 1))
	chip.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	eyebrow.add_child(chip)
	eyebrow.add_child(UI.label(str(_data.get("scenario", {}).get("name", "")), 13, Color(1, 1, 1, 0.8), 600))
	titles.add_child(eyebrow)
	titles.add_child(UI.label("Play as a group" if _tab == "group" else "Choose your country", 21, UI.WHITE, 800, "Arial", -1))
	header.add_child(titles)
	if is_play_mode():
		var plain := MarginContainer.new()
		plain.add_theme_constant_override("margin_bottom", 12)
		plain.add_child(header)
		_content.add_child(plain)
		return
	var tabs := PanelContainer.new()
	tabs.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0.35), Color(1, 1, 1, 0.1), 10, 1, Vector4(3, 3, 3, 3)))
	tabs.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 2)
	for entry in [["country", "Pick a country"], ["group", "Play as a group"]]:
		var key: String = entry[0]
		var on := _tab == key
		var tab := EventCards.button(entry[1], Color(1, 1, 1, 0.14) if on else Color(0, 0, 0, 0), Color(0, 0, 0, 0), UI.WHITE if on else Color(1, 1, 1, 0.6), 7, 13, 700, Vector4(14, 6, 14, 6), Color(1, 1, 1, 0.14) if on else Color(1, 1, 1, 0.06))
		tab.pressed.connect(func() -> void:
			_tab = key
			_render())
		row.add_child(tab)
	tabs.add_child(row)
	header.add_child(tabs)
	var spaced := MarginContainer.new()
	spaced.add_theme_constant_override("margin_bottom", 12)
	spaced.add_child(header)
	_content.add_child(spaced)


func _render_footer() -> void:
	var rule := ColorRect.new()
	rule.color = Color(1, 1, 1, 0.08)
	rule.custom_minimum_size.y = 1
	var gap := Control.new()
	gap.custom_minimum_size.y = 12
	_content.add_child(gap)
	_content.add_child(rule)
	var row := HBoxContainer.new()
	row.add_child(UI.spacer())
	var cancel := EventCards.button("Done" if is_play_mode() else "Cancel", Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.12), UI.BUTTON_INK, 8, 14, 600, Vector4(20, 7, 20, 7))
	cancel.pressed.connect(_close)
	row.add_child(cancel)
	var spaced := MarginContainer.new()
	spaced.add_theme_constant_override("margin_top", 10)
	spaced.add_child(row)
	_content.add_child(spaced)


func _render_list() -> Control:
	var column := EventCards.frame(Color(0, 0, 0, 0.22), Color(1, 1, 1, 0.08), 14, Vector4(14, 14, 14, 14))
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.size_flags_stretch_ratio = 1.0
	column.custom_minimum_size.x = 300
	var stack := VBoxContainer.new()
	stack.add_theme_constant_override("separation", 0)
	stack.add_child(UI.label("Select Nation", 13, Color(1, 1, 1, 0.85), 700))
	var gap := Control.new()
	gap.custom_minimum_size.y = 6
	stack.add_child(gap)
	var search := LineEdit.new()
	search.placeholder_text = "Search countries or codes…"
	search.text = _query
	search.custom_minimum_size.y = 38
	search.add_theme_stylebox_override("normal", UI.box(Color(0, 0, 0, 0.35), Color(1, 1, 1, 0.16), 8, 1, Vector4(13, 0, 13, 0)))
	search.add_theme_stylebox_override("focus", UI.box(Color(0, 0, 0, 0.35), Color(1, 1, 1, 0.26), 8, 1, Vector4(13, 0, 13, 0)))
	search.add_theme_font_override("font", UI.font(400))
	search.add_theme_font_size_override("font_size", 14)
	search.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.38))
	search.text_changed.connect(func(text: String) -> void:
		_query = text
		_fill_list())
	stack.add_child(search)
	(func() -> void:
		if is_instance_valid(search) and search.is_inside_tree() and search.is_visible_in_tree():
			search.grab_focus()).call_deferred()
	var gap2 := Control.new()
	gap2.custom_minimum_size.y = 10
	stack.add_child(gap2)
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.custom_minimum_size.y = 0
	_list = VBoxContainer.new()
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_list.add_theme_constant_override("separation", 3)
	scroll.add_child(_list)
	stack.add_child(scroll)
	column.add_child(stack)
	column.size_flags_horizontal = Control.SIZE_FILL
	column.custom_minimum_size.x = 360
	_fill_list()
	return column


func _filtered() -> Array:
	var needle := _query.strip_edges().to_lower()
	if needle.is_empty():
		return _options
	return _options.filter(func(option: Dictionary) -> bool: return ("%s %s" % [str(option.get("name", "")), str(option.get("code", ""))]).to_lower().contains(needle))


func _fill_list() -> void:
	if not _list:
		return
	for child in _list.get_children():
		_list.remove_child(child)
		child.queue_free()
	if _query.strip_edges().is_empty():
		var standard := _default_row()
		standard.pressed.connect(func() -> void: _choose(""))
		_list.add_child(standard)
		var gap := Control.new()
		gap.custom_minimum_size.y = 3
		gap.mouse_filter = Control.MOUSE_FILTER_IGNORE
		_list.add_child(gap)
	var options := _filtered()
	var limit := 30 if not _query.strip_edges().is_empty() else 12
	for index in range(mini(limit, options.size())):
		var option: Dictionary = options[index]
		_list.add_child(_country_row(option))
	if options.size() > limit:
		var more := UI.label("%d more… type to search" % (options.size() - limit), 12, Color(1, 1, 1, 0.45))
		more.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		var spaced := MarginContainer.new()
		for side in ["margin_top", "margin_bottom"]:
			spaced.add_theme_constant_override(side, 6)
		spaced.add_child(more)
		_list.add_child(spaced)


func _country_row(option: Dictionary) -> Button:
	var row := Button.new()
	row.focus_mode = Control.FOCUS_NONE
	row.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	row.custom_minimum_size.y = 34
	var rgb: Array = option.get("color", [160, 165, 175])
	var stripe := Color8(int(rgb[0]), int(rgb[1]), int(rgb[2]))
	var normal := UI.box(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.08), 8, 1)
	normal.border_width_left = 4
	var hover := normal.duplicate() as StyleBoxFlat
	hover.bg_color = Color(1, 1, 1, 0.08)
	for state in ["normal", "focus"]:
		row.add_theme_stylebox_override(state, normal)
	for state in ["hover", "pressed", "hover_pressed"]:
		row.add_theme_stylebox_override(state, hover)
	var bar := ColorRect.new()
	bar.color = stripe
	bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	bar.anchor_bottom = 1.0
	bar.offset_left = 0
	bar.offset_right = 4
	bar.offset_top = 1
	bar.offset_bottom = -1
	row.add_child(bar)
	var content := HBoxContainer.new()
	content.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	content.offset_left = 16
	content.offset_right = -10
	content.add_theme_constant_override("separation", 10)
	content.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var thumb := PanelContainer.new()
	thumb.custom_minimum_size = Vector2(23, 17)
	thumb.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	thumb.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var flag_path := str(option.get("flag", ""))
	thumb.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0.3) if not flag_path.is_empty() else stripe, Color(1, 1, 1, 0.18), 3, 1))
	thumb.clip_contents = true
	if not flag_path.is_empty():
		var picture := TextureRect.new()
		picture.texture = UI.flag(flag_path, 17)
		picture.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		picture.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
		picture.mouse_filter = Control.MOUSE_FILTER_IGNORE
		thumb.add_child(picture)
	content.add_child(thumb)
	var name := UI.label(str(option.get("name", "")), 13, Color(246 / 255.0, 246 / 255.0, 248 / 255.0, 0.95), 600)
	name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	name.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	name.clip_text = true
	name.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	content.add_child(name)
	var code := str(option.get("code", ""))
	if not code.is_empty() and code != str(option.get("name", "")) and code.length() <= 4:
		var chip := PanelContainer.new()
		chip.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.06), 4, 1, Vector4(6, 1, 6, 2)))
		chip.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		chip.mouse_filter = Control.MOUSE_FILTER_IGNORE
		chip.add_child(UI.label(code, 11, Color(1, 1, 1, 0.45), 400, "Consolas", 1))
		content.add_child(chip)
	row.add_child(content)
	row.pressed.connect(func() -> void: _choose(code))
	row.mouse_entered.connect(func() -> void: _set_hover(int(_owner_index.get(code, -1))))
	row.mouse_exited.connect(func() -> void:
		if _hover_owner == int(_owner_index.get(code, -1)):
			_set_hover(-1))
	return row


func _default_row() -> Button:
	var row := Button.new()
	row.focus_mode = Control.FOCUS_NONE
	row.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	row.custom_minimum_size.y = 46
	var normal := UI.box(Color(1, 1, 1, 0.07), Color(1, 1, 1, 0.16), 8, 1)
	var hover := normal.duplicate() as StyleBoxFlat
	hover.bg_color = Color(1, 1, 1, 0.1)
	for state in ["normal", "focus"]:
		row.add_theme_stylebox_override(state, normal)
	for state in ["hover", "pressed", "hover_pressed"]:
		row.add_theme_stylebox_override(state, hover)
	var bar := ColorRect.new()
	bar.color = GOLD
	bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	bar.anchor_bottom = 1.0
	bar.offset_right = 4
	bar.offset_top = 1
	bar.offset_bottom = -1
	row.add_child(bar)
	var content := HBoxContainer.new()
	content.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	content.offset_left = 16
	content.add_theme_constant_override("separation", 9)
	content.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var star := UI.label("⭐", 17, UI.WHITE, 400, "Segoe UI Emoji")
	star.custom_minimum_size.x = 24
	star.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	content.add_child(star)
	var words := VBoxContainer.new()
	words.alignment = BoxContainer.ALIGNMENT_CENTER
	words.add_theme_constant_override("separation", 1)
	words.mouse_filter = Control.MOUSE_FILTER_IGNORE
	words.add_child(UI.label("Keep scenario default" if is_play_mode() else "Scenario default", 13, UI.WHITE, 700))
	words.add_child(UI.label("Start with the scenario's designated country", 11, Color(1, 1, 1, 0.5)))
	content.add_child(words)
	row.add_child(content)
	return row


func _choose(code: String) -> void:
	_pick = {"country": code}
	_render()


func _render_difficulty() -> void:
	_set_mode("country")
	_content.add_theme_constant_override("separation", 0)
	_content.add_child(UI.label("Choose your difficulty", 19, UI.WHITE, 800, "Arial", -1))
	var subtitle := UI.label("How hard should the world fight back?", 13, Color(1, 1, 1, 0.55))
	var spaced := MarginContainer.new()
	spaced.add_theme_constant_override("margin_top", 3)
	spaced.add_theme_constant_override("margin_bottom", 14)
	spaced.add_child(subtitle)
	_content.add_child(spaced)
	if _pick.has("country") and not str(_pick["country"]).is_empty():
		var option: Dictionary = _playable.get(str(_pick["country"]), {})
		if not option.is_empty():
			_content.add_child(_selected_card(str(option.get("flag", "")), Color(0, 0, 0, 0), str(option.get("name", "")), "Selected Nation"))
	elif _pick.has("group"):
		var group: Dictionary = _pick["group"]
		_content.add_child(_selected_card("", _hex(str(group.get("color", "#a1a1aa"))), str(group.get("name", "")), "Selected Group"))
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 10)
	for level in _difficulties:
		var card := Button.new()
		card.focus_mode = Control.FOCUS_NONE
		card.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		card.custom_minimum_size = Vector2(0, 104)
		card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var normal := UI.box(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.1), 10, 1)
		var hover := UI.box(Color(1, 1, 1, 0.09), Color(1, 1, 1, 0.18), 10, 1)
		for state in ["normal", "focus"]:
			card.add_theme_stylebox_override(state, normal)
		for state in ["hover", "pressed", "hover_pressed"]:
			card.add_theme_stylebox_override(state, hover)
		var stack := VBoxContainer.new()
		stack.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		stack.offset_left = 9
		stack.offset_right = -9
		stack.alignment = BoxContainer.ALIGNMENT_CENTER
		stack.add_theme_constant_override("separation", 4)
		stack.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var emoji := UI.label(str(level.get("emoji", "")), 26, UI.WHITE, 400, "Segoe UI Emoji")
		emoji.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		stack.add_child(emoji)
		var title := UI.label(str(level.get("label", "")), 15, UI.WHITE, 700)
		title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		stack.add_child(title)
		var blurb := UI.wrapped(str(level.get("blurb", "")), 11, Color(1, 1, 1, 0.5))
		blurb.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		stack.add_child(blurb)
		card.add_child(stack)
		var id := str(level.get("id", "medium"))
		card.pressed.connect(func() -> void: _start(id))
		grid.add_child(card)
	_content.add_child(grid)
	var back := EventCards.button("Back", Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.12), UI.BUTTON_INK, 8, 13, 600, Vector4(12, 9, 12, 9))
	back.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	back.pressed.connect(func() -> void:
		_pick = {}
		_render())
	var holder := MarginContainer.new()
	holder.add_theme_constant_override("margin_top", 14)
	holder.add_child(back)
	_content.add_child(holder)


func _selected_card(flag_path: String, swatch: Color, name: String, caption: String) -> Control:
	var card := EventCards.frame(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.1), 10, Vector4(14, 10, 14, 10))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	if swatch.a > 0.0:
		var box := ColorRect.new()
		box.color = swatch
		box.custom_minimum_size = Vector2(20, 20)
		box.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(box)
	else:
		var thumb := PanelContainer.new()
		thumb.custom_minimum_size = Vector2(28, 19)
		thumb.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		thumb.clip_contents = true
		thumb.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.15), Color(1, 1, 1, 0.2), 3, 1))
		if not flag_path.is_empty():
			var picture := TextureRect.new()
			picture.texture = UI.flag(flag_path, 19)
			picture.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
			picture.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
			thumb.add_child(picture)
		row.add_child(thumb)
	var words := VBoxContainer.new()
	words.add_theme_constant_override("separation", 0)
	words.add_child(UI.label(name, 15, UI.WHITE, 700))
	words.add_child(UI.label(caption, 11, Color(1, 1, 1, 0.45)))
	row.add_child(words)
	card.add_child(row)
	var spaced := MarginContainer.new()
	spaced.add_theme_constant_override("margin_bottom", 14)
	spaced.add_child(card)
	return spaced


func _start(difficulty: String) -> void:
	var request := {"difficulty": difficulty}
	if _pick.has("faction"):
		request["faction"] = _pick["faction"]
	elif _pick.has("group"):
		request["group"] = _pick["group"]
	else:
		request["country"] = str(_pick.get("country", ""))
	_pick = {}
	_mode = "country"
	start.emit(request)


func _render_group_tab() -> void:
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var column := VBoxContainer.new()
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.add_theme_constant_override("separation", 0)
	scroll.add_child(column)
	if _offers_groups:
		var intro := UI.wrapped("Lead a group instead of a country: a cartel, a militia, a movement, an outbreak. It owns no land; it controls an area, and the world deals with it as what it is.", 12, Color(1, 1, 1, 0.6))
		column.add_child(_spaced(intro, 10))
		if not _groups.is_empty():
			var list := VBoxContainer.new()
			list.add_theme_constant_override("separation", 6)
			list.add_child(UI.label("This scenario's groups", 13, Color(1, 1, 1, 0.7), 700))
			for entry in _groups:
				list.add_child(_group_row(entry))
			column.add_child(_spaced(list, 13))
		column.add_child(_spaced(UI.label("Or make a new group" if not _groups.is_empty() else "Make a group", 13, Color(1, 1, 1, 0.7), 700), 5))
	column.add_child(_creator_form())
	_content.add_child(scroll)


func _spaced(control: Control, bottom: int) -> Control:
	var holder := MarginContainer.new()
	holder.add_theme_constant_override("margin_bottom", bottom)
	holder.add_child(control)
	return holder


func _group_row(entry: Dictionary) -> Button:
	var row := EventCards.button("", Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.12), UI.BUTTON_INK, 9, 13, 600, Vector4(12, 8, 12, 8))
	row.custom_minimum_size.y = 46
	var content := HBoxContainer.new()
	content.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	content.offset_left = 12
	content.add_theme_constant_override("separation", 10)
	content.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var swatch := ColorRect.new()
	var rgb: Array = entry.get("color", [161, 161, 170])
	swatch.color = Color8(int(rgb[0]), int(rgb[1]), int(rgb[2]))
	swatch.custom_minimum_size = Vector2(16, 16)
	swatch.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	content.add_child(swatch)
	var words := VBoxContainer.new()
	words.alignment = BoxContainer.ALIGNMENT_CENTER
	words.add_theme_constant_override("separation", 1)
	words.add_child(UI.label(str(entry.get("name", "")), 13, UI.WHITE, 700))
	var count := int(entry.get("regionCount", 0))
	words.add_child(UI.label("Controls 1 region" if count == 1 else ("Controls %d regions" % count if count > 0 else "Controls no area yet"), 11, Color(1, 1, 1, 0.5)))
	content.add_child(words)
	row.add_child(content)
	row.pressed.connect(func() -> void:
		_pick = {"group": {"name": str(entry.get("name", "")), "color": str(entry.get("hex", "")), "description": str(entry.get("description", "")), "existing": true}}
		_render())
	return row


func _creator_form() -> Control:
	if _creator.is_empty():
		_creator = {"name": "", "color": Color("#a1a1aa"), "lore": "", "landless": true, "flag": null}
	var group_mode := true
	var form := VBoxContainer.new()
	form.add_theme_constant_override("separation", 10)
	form.add_child(_field_label("Name"))
	var name := _field_input(str(_creator["name"]), GROUP_TEXTS["name"] if group_mode else "e.g. Free Cascadia, the Provisional Government…")
	form.add_child(name)
	var create_button := EventCards.button("Create & play", Color(0, 0, 0, 0.39), Color(1, 1, 1, 0.28), UI.WHITE, 999, 13, 700, Vector4(14, 9, 14, 9))
	name.text_changed.connect(func(text: String) -> void:
		_creator["name"] = text
		_refresh_create(create_button))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 13)
	var colour_column := VBoxContainer.new()
	colour_column.add_child(_field_label("Colour"))
	var colour := ColorPickerButton.new()
	colour.color = _creator["color"]
	colour.edit_alpha = false
	colour.custom_minimum_size = Vector2(48, 34)
	colour.color_changed.connect(func(value: Color) -> void:
		_creator["color"] = value
		_selection_changed())
	colour_column.add_child(colour)
	row.add_child(colour_column)
	var flag_column := VBoxContainer.new()
	flag_column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	flag_column.add_child(_field_label("Flag"))
	var flag_row := HFlowContainer.new()
	flag_row.add_theme_constant_override("h_separation", 8)
	flag_row.add_theme_constant_override("v_separation", 8)
	var chosen: Variant = _creator.get("flag")
	var has_flag := chosen is String and not (chosen as String).is_empty()
	var preview := _flag_preview(str(_creator.get("flag_file", ""))) if has_flag else null
	if preview:
		flag_row.add_child(preview)
	else:
		var white := UI.label("🏳️", 21, UI.WHITE, 400, "Segoe UI Emoji")
		white.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		flag_row.add_child(white)
	var choose := _pill("Change flag" if has_flag else "Choose flag", false)
	choose.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	if _flag_scripts().is_empty():
		UI.set_disabled_look(choose, "The flag picker could not be loaded.")
	else:
		choose.pressed.connect(_open_flag_picker)
	flag_row.add_child(choose)
	if has_flag:
		var remove := _pill("Remove", false)
		remove.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		remove.pressed.connect(func() -> void:
			_creator["flag"] = null
			_creator["flag_file"] = ""
			_render())
		flag_row.add_child(remove)
	flag_column.add_child(flag_row)
	row.add_child(flag_column)
	form.add_child(row)
	form.add_child(_field_label(GROUP_TEXTS["description_label"] if group_mode else "Lore"))
	var lore := TextEdit.new()
	lore.text = str(_creator["lore"])
	lore.placeholder_text = GROUP_TEXTS["description"] if group_mode else "Who is this power? Its history, cause, and ambitions. This steers the story the AI tells."
	lore.custom_minimum_size.y = 64
	lore.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	lore.add_theme_stylebox_override("normal", UI.box(Color(0, 0, 0, 0.28), Color(1, 1, 1, 0.16), 8, 1, Vector4(11, 8, 11, 8)))
	lore.add_theme_stylebox_override("focus", UI.box(Color(0, 0, 0, 0.28), Color(1, 1, 1, 0.26), 8, 1, Vector4(11, 8, 11, 8)))
	lore.add_theme_font_override("font", UI.font(400))
	lore.add_theme_font_size_override("font_size", 14)
	lore.text_changed.connect(func() -> void: _creator["lore"] = lore.text)
	form.add_child(lore)
	form.add_child(_field_label(GROUP_TEXTS["area_label"] if group_mode else "Starting territory"))
	var pills := HBoxContainer.new()
	pills.add_theme_constant_override("separation", 6)
	var landless: bool = _creator["landless"]
	var none := _pill(GROUP_TEXTS["no_area"] if group_mode else "Start landless", landless)
	none.pressed.connect(func() -> void:
		_creator["landless"] = true
		_render())
	pills.add_child(none)
	var some := _pill(GROUP_TEXTS["some_area"] if group_mode else "Claim regions", not landless)
	some.pressed.connect(func() -> void:
		_creator["landless"] = false
		_render())
	pills.add_child(some)
	form.add_child(pills)
	if landless:
		form.add_child(UI.wrapped(GROUP_TEXTS["no_area_text"] if group_mode else "You begin with no territory — a stateless power. Your campaign is to gain or retake land.", 12, Color(1, 1, 1, 0.5)))
	else:
		var count := _selected.size()
		var counter := UI.label(("1 region controlled" if count == 1 else "%d regions controlled" % count) if group_mode else ("1 region claimed" if count == 1 else "%d regions claimed" % count), 12, Color(1, 1, 1, 0.55))
		counter.name = "RegionCount"
		form.add_child(counter)
		_map_frame.custom_minimum_size = Vector2(0, 480)
		form.add_child(_map_frame)
	var buttons := HBoxContainer.new()
	buttons.add_theme_constant_override("separation", 8)
	create_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	create_button.pressed.connect(_create)
	buttons.add_child(create_button)
	var cancel := _pill("Cancel", false)
	cancel.pressed.connect(func() -> void:
		_tab = "country"
		_creator = {}
		_selected = {}
		_close())
	buttons.add_child(cancel)
	form.add_child(buttons)
	_refresh_create(create_button)
	return form


func _refresh_create(button: Button) -> void:
	var ready := not str(_creator.get("name", "")).strip_edges().is_empty()
	button.disabled = not ready
	button.modulate.a = 1.0 if ready else 0.5
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if ready else Control.CURSOR_FORBIDDEN


func _create() -> void:
	var name := str(_creator.get("name", "")).strip_edges()
	if name.is_empty():
		return
	var regions: Array = []
	if not bool(_creator.get("landless", true)):
		for index in _selected.keys():
			if int(index) < _region_ids.size():
				regions.append(str(_region_ids[int(index)]))
	var colour: Color = _creator.get("color", Color("#a1a1aa"))
	var chosen_flag: Variant = _creator.get("flag")
	var payload := {"name": name, "color": "#" + colour.to_html(false), "flag": chosen_flag if chosen_flag is String and not (chosen_flag as String).is_empty() else null, "lore": str(_creator.get("lore", "")).strip_edges(), "regionIds": regions}
	if _offers_groups:
		payload["existing"] = false
		_pick = {"group": payload}
	else:
		_pick = {"faction": payload}
	_creator = {}
	_selected = {}
	_render()


func _flag_preview(file: String) -> Control:
	if file.is_empty():
		return null
	var texture: Texture2D = UI.flag(file, 22) if file.get_extension().to_lower() == "svg" else null
	if texture == null:
		texture = ImageLoader.texture_from_file(file)
		if texture == null:
			return null
	var frame := PanelContainer.new()
	frame.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0), Color(1, 1, 1, 0.25), 3, 1, Vector4(1, 1, 1, 1)))
	frame.custom_minimum_size = Vector2(34, 22)
	frame.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var picture := TextureRect.new()
	picture.texture = texture
	picture.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	picture.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	frame.add_child(picture)
	return frame


func _flag_scripts() -> Array:
	var host_script: Variant = load("res://scripts/ui/flag_choice_host.gd")
	var picker_script: Variant = load("res://scripts/editor/workshop_flags.gd")
	if host_script is GDScript and picker_script is GDScript and (host_script as GDScript).can_instantiate() and (picker_script as GDScript).can_instantiate():
		return [host_script, picker_script]
	return []


func _open_flag_picker() -> void:
	if not engine:
		return
	_close_flag_picker()
	var scripts := _flag_scripts()
	if scripts.is_empty():
		return
	_flag_host = (scripts[0] as GDScript).new()
	_flag_host.set("engine", engine)
	_flag_host.set("context", context)
	_flag_host.set("current", _creator.get("flag"))
	_flag_host.connect("chosen", _on_flag_chosen)
	_flag_overlay = (scripts[1] as GDScript).new()
	_flag_host.set("dialog_parent", _flag_overlay)
	add_child(_flag_overlay)
	_flag_overlay.connect("closed", _close_flag_picker)
	_flag_overlay.call("setup", _flag_host, str(_creator.get("name", "")).strip_edges())


func _on_flag_chosen(value: Variant) -> void:
	if value is String and not (value as String).is_empty():
		_creator["flag"] = value
		var reply: Dictionary = await engine.request("picker.flags.file", {"value": value})
		_creator["flag_file"] = str((reply.get("result", {}) as Dictionary).get("file", "")) if reply.get("ok", false) else ""
	else:
		_creator["flag"] = null
		_creator["flag_file"] = ""
	if _tab == "group" and _pick.is_empty():
		_render()


func _close_flag_picker() -> void:
	if _flag_overlay and is_instance_valid(_flag_overlay):
		_flag_overlay.queue_free()
	_flag_overlay = null
	if _flag_host and is_instance_valid(_flag_host):
		_flag_host.queue_free()
	_flag_host = null


func _field_label(text: String) -> Control:
	return UI.label(text, 13, Color(1, 1, 1, 0.7), 700)


func _field_input(value: String, placeholder: String) -> LineEdit:
	var input := LineEdit.new()
	input.text = value
	input.placeholder_text = placeholder
	input.custom_minimum_size.y = 36
	input.add_theme_stylebox_override("normal", UI.box(Color(0, 0, 0, 0.28), Color(1, 1, 1, 0.16), 8, 1, Vector4(11, 0, 11, 0)))
	input.add_theme_stylebox_override("focus", UI.box(Color(0, 0, 0, 0.28), Color(1, 1, 1, 0.26), 8, 1, Vector4(11, 0, 11, 0)))
	input.add_theme_font_override("font", UI.font(400))
	input.add_theme_font_size_override("font_size", 14)
	input.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.38))
	return input


func _pill(text: String, active: bool) -> Button:
	return EventCards.button(text, Color(0, 0, 0, 0.39) if active else Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.28) if active else Color(1, 1, 1, 0.1), UI.WHITE, 999, 13, 700, Vector4(14, 6, 14, 6))


func _hex(text: String) -> Color:
	return Color(text) if text.begins_with("#") and text.length() == 7 else Color("#a1a1aa")


func _set_mode(mode: String) -> void:
	_mode = mode
	_apply_map()


func _set_hover(owner: int) -> void:
	if _mode == "country":
		if owner == _hover_owner:
			return
		_hover_owner = owner
	else:
		if owner == _hover_region:
			return
		_hover_region = owner
	_apply_map()


func _selection_changed() -> void:
	var counter := _content.find_child("RegionCount", true, false) as Label
	if counter:
		var count := _selected.size()
		counter.text = "1 region controlled" if count == 1 else "%d regions controlled" % count
	_apply_map()


func _apply_map() -> void:
	if not map_view or _data.is_empty():
		return
	var map: Dictionary = _data.get("map", {})
	var base: Dictionary = map.get("state", {})
	var owners: Array = (base.get("owners", []) as Array).duplicate()
	var names: Array = (base.get("ownerNames", []) as Array).duplicate()
	var colors: Array = []
	if _mode == "regions":
		for shade in map.get("palette", []):
			colors.append(shade)
		var selection: Color = _creator.get("color", Color("#a1a1aa"))
		names.append("__selected")
		colors.append([selection.r8, selection.g8, selection.b8])
		var selected_slot := names.size() - 1
		for index in _selected.keys():
			if int(index) < owners.size():
				owners[int(index)] = selected_slot
		if _hover_region >= 0 and _hover_region < owners.size() and not _selected.has(_hover_region):
			var under := int(owners[_hover_region])
			var shade: Array = colors[under] if under >= 0 and under < colors.size() else UNPLAYABLE
			names.append("__hover")
			colors.append(_blend(shade))
			owners[_hover_region] = names.size() - 1
	else:
		for shade in base.get("ownerColors", []):
			colors.append(shade)
		if _hover_owner >= 0 and _hover_owner < colors.size() and colors[_hover_owner] != UNPLAYABLE:
			colors[_hover_owner] = _blend(colors[_hover_owner])
	map_view.set_state({"sha": base.get("sha", ""), "owners": owners, "ownerNames": names, "ownerColors": colors, "player": ""})


func _blend(shade: Array) -> Array:
	return [int(round(float(shade[0]) * 0.52 + 255.0 * 0.48)), int(round(float(shade[1]) * 0.52 + 255.0 * 0.48)), int(round(float(shade[2]) * 0.52 + 255.0 * 0.48))]


func _on_map_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var button := event as InputEventMouseButton
		if button.button_index == MOUSE_BUTTON_WHEEL_UP and button.pressed:
			_zoom(button.position, 1.15)
		elif button.button_index == MOUSE_BUTTON_WHEEL_DOWN and button.pressed:
			_zoom(button.position, 1.0 / 1.15)
		elif button.button_index == MOUSE_BUTTON_LEFT:
			if button.pressed:
				_dragging = true
				_drag = 0.0
			else:
				_dragging = false
				if _drag < 5.0:
					_click(button.position)
	elif event is InputEventMouseMotion:
		var motion := event as InputEventMouseMotion
		if _dragging:
			_drag += motion.relative.length()
			_camera.position -= motion.relative / _camera.zoom.x
			_camera.position.x = fposmod(_camera.position.x, MapView.WORLD_WIDTH)
			_sync()
		else:
			_hover_at(motion.position)


func _hover_at(local: Vector2) -> void:
	var region := map_view.baker.pick(_to_world(local))
	if _mode == "regions":
		_container.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if region >= 0 else Control.CURSOR_ARROW
		_set_hover(region)
		return
	var owner := map_view.region_owner(region) if region >= 0 else ""
	var clickable := not owner.is_empty() and _playable.has(owner)
	_container.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if clickable else Control.CURSOR_ARROW
	_set_hover(int(_owner_index.get(owner, -1)) if clickable else -1)


func _click(local: Vector2) -> void:
	var region := map_view.baker.pick(_to_world(local))
	if region < 0:
		return
	if _mode == "regions":
		if _selected.has(region):
			_selected.erase(region)
		else:
			_selected[region] = true
		_selection_changed()
		return
	var owner := map_view.region_owner(region)
	if not owner.is_empty() and _playable.has(owner):
		_choose(owner)


func _to_world(local: Vector2) -> Vector2:
	return _camera.position + (local - _container.size * 0.5) / _camera.zoom.x


func _zoom(local: Vector2, factor: float) -> void:
	var before := _to_world(local)
	_camera.zoom = Vector2.ONE * clamp(_camera.zoom.x * factor, pow(2.0, 1.0) / 8.0, pow(2.0, 8.0) / 8.0)
	_camera.position += before - _to_world(local)
	_sync()


func _sync() -> void:
	map_view.camera.position = _camera.position
	map_view.camera.zoom = _camera.zoom
	map_view._after_camera_move()
