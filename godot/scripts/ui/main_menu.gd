class_name MainMenu
extends Control

signal play_game(id: String)
signal start_scenario(id: String)
signal open_settings
signal refresh_requested

const CARD_WIDTH := 305.0
const CARD_GAP := 16

var loader: ImageLoader
var _page := "games"
var _library := {}
var _tiles := {}
var _title: Label
var _actions: HBoxContainer
var _body: ScrollContainer
var _page_root: VBoxContainer
var _grids: Array[GridContainer] = []
var _status: Label
var _search := ""
var _filter := "all"
var _sort := "recent"


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var page := ColorRect.new()
	page.color = UI.PAGE
	page.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	page.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(page)
	loader = ImageLoader.new()
	add_child(loader)
	_build_rail()
	_build_content()
	resized.connect(_fit_grids)
	_show_page("games")


func set_origin(origin: String) -> void:
	loader.origin = origin


func set_library(data: Dictionary) -> void:
	_library = data
	_show_page(_page)


func set_status(text: String, problem := false) -> void:
	_status.text = text
	_status.add_theme_color_override("font_color", UI.PROBLEM if problem else UI.SOFT)
	_status.visible = not text.is_empty()


func _build_rail() -> void:
	var rail := PanelContainer.new()
	rail.add_theme_stylebox_override("panel", UI.box(UI.RAIL, Color(0, 0, 0, 0), 0, 0, Vector4(12, 16, 12, 16)))
	rail.anchor_bottom = 1.0
	rail.offset_right = 110
	add_child(rail)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 9)
	rail.add_child(column)

	var brand := Button.new()
	brand.flat = true
	brand.focus_mode = Control.FOCUS_NONE
	brand.custom_minimum_size = Vector2(86, 87)
	brand.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var brand_box := VBoxContainer.new()
	brand_box.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	brand_box.alignment = BoxContainer.ALIGNMENT_CENTER
	brand_box.add_theme_constant_override("separation", 6)
	brand_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var mark := TextureRect.new()
	mark.texture = UI.logo()
	mark.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	mark.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	mark.custom_minimum_size = Vector2(33, 33)
	mark.mouse_filter = Control.MOUSE_FILTER_IGNORE
	brand_box.add_child(mark)
	var brand_name := UI.label("Open\nHistoria", 11, UI.WHITE, 800)
	brand_name.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	brand_box.add_child(brand_name)
	brand.add_child(brand_box)
	column.add_child(brand)

	column.add_child(UI.spacer(false))
	for entry in [["games", "Games"], ["scenarios", "Scenarios"], ["community", "Community"], ["lobbies", "Lobbies"]]:
		var tile := _rail_tile(entry[0], entry[1])
		column.add_child(tile)
	column.add_child(UI.spacer(false))
	var settings := _rail_tile("settings", "Settings")
	column.add_child(settings)
	UI.set_disabled_look(_tiles["community"], "Community is not in the native app yet.")
	UI.set_disabled_look(_tiles["lobbies"], "Lobbies are not in the native app yet.")


func _rail_tile(key: String, text: String) -> Button:
	var tile := Button.new()
	tile.focus_mode = Control.FOCUS_NONE
	tile.custom_minimum_size = Vector2(86, 82)
	tile.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var stack := VBoxContainer.new()
	stack.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	stack.alignment = BoxContainer.ALIGNMENT_CENTER
	stack.add_theme_constant_override("separation", 7)
	stack.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var glyph := UI.icon_rect(key, 22)
	glyph.name = "Glyph"
	stack.add_child(glyph)
	var caption := UI.label(text, 12, UI.RAIL_INK, 700)
	caption.name = "Caption"
	caption.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	stack.add_child(caption)
	tile.add_child(stack)
	tile.set_meta("glyph", glyph)
	tile.set_meta("caption", caption)
	tile.set_meta("key", key)
	if key == "settings":
		tile.pressed.connect(func() -> void: open_settings.emit())
	else:
		tile.pressed.connect(func() -> void: _show_page(key))
	_tiles[key] = tile
	_style_tile(tile, false)
	return tile


func _style_tile(tile: Button, active: bool) -> void:
	var style := UI.box(Color(1, 1, 1, 0.11 if active else 0.035), Color(1, 1, 1, 0.24 if active else 0.07), 16, 1)
	if active:
		UI.shadowed(style, Color(0, 0, 0, 0.28), 10, Vector2(0, 8))
	var hover := style.duplicate() as StyleBoxFlat
	if not active:
		hover.bg_color = Color(1, 1, 1, 0.07)
		hover.border_color = Color(1, 1, 1, 0.12)
	for state in ["normal", "focus", "disabled"]:
		tile.add_theme_stylebox_override(state, style)
	for state in ["hover", "pressed", "hover_pressed"]:
		tile.add_theme_stylebox_override(state, hover)
	var key: String = tile.get_meta("key")
	var ink := UI.WHITE if active else UI.RAIL_INK
	(tile.get_meta("glyph") as TextureRect).texture = UI.icon(key, 22, ink)
	(tile.get_meta("caption") as Label).add_theme_color_override("font_color", ink)


func _build_content() -> void:
	var margin := MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	margin.add_theme_constant_override("margin_left", 136)
	margin.add_theme_constant_override("margin_right", 26)
	margin.add_theme_constant_override("margin_top", 14)
	add_child(margin)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 18)
	margin.add_child(column)
	var header := HBoxContainer.new()
	header.custom_minimum_size.y = 35
	header.add_theme_constant_override("separation", 8)
	_title = UI.label("Games", 23, UI.WHITE, 800, "Arial", -1)
	header.add_child(_title)
	header.add_child(UI.spacer())
	_actions = HBoxContainer.new()
	_actions.add_theme_constant_override("separation", 8)
	header.add_child(_actions)
	column.add_child(header)
	_status = UI.label("", 13, UI.SOFT)
	_status.visible = false
	column.add_child(_status)
	_body = ScrollContainer.new()
	_body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_body.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	column.add_child(_body)


func _show_page(key: String) -> void:
	_page = key
	for tile_key in _tiles:
		if tile_key != "settings":
			_style_tile(_tiles[tile_key], tile_key == key)
	for child in _actions.get_children():
		child.queue_free()
	if _page_root:
		_page_root.queue_free()
	_grids.clear()
	_page_root = VBoxContainer.new()
	_page_root.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_page_root.add_theme_constant_override("separation", 14)
	_body.add_child(_page_root)
	var refresh := UI.button("Refresh", "header", "refresh")
	refresh.pressed.connect(func() -> void: refresh_requested.emit())
	_actions.add_child(refresh)
	if key == "scenarios":
		_title.text = "Scenarios"
		var import_scenario := UI.button("Import Scenario", "header", "import")
		UI.set_disabled_look(import_scenario, "Importing is not in the native app yet.")
		_actions.add_child(import_scenario)
		_build_scenarios_page()
	else:
		_title.text = "Games"
		var import_game := UI.button("Import Game", "header", "import")
		UI.set_disabled_look(import_game, "Importing is not in the native app yet.")
		_actions.add_child(import_game)
		_build_games_page()
	_fit_grids.call_deferred()


func _build_games_page() -> void:
	var games: Array = _library.get("games", [])
	games = games.filter(func(game: Dictionary) -> bool: return not game.get("archived", false))
	var active := str(_library.get("activeGameId", ""))
	if games.is_empty():
		_page_root.add_child(_empty_state())
		return
	games.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		if (str(a["id"]) == active) != (str(b["id"]) == active):
			return str(a["id"]) == active
		return str(a.get("lastPlayedAt", "")) > str(b.get("lastPlayedAt", "")))
	var grid := _grid()
	for game in games:
		grid.add_child(_game_card(game, str(game["id"]) == active))
	_page_root.add_child(grid)


func _empty_state() -> Control:
	var holder := CenterContainer.new()
	holder.custom_minimum_size.y = 560
	holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var column := VBoxContainer.new()
	column.alignment = BoxContainer.ALIGNMENT_CENTER
	column.add_theme_constant_override("separation", 10)
	var mark := TextureRect.new()
	mark.texture = UI.logo()
	mark.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	mark.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	mark.custom_minimum_size = Vector2(80, 80)
	column.add_child(mark)
	var heading := UI.label("No games yet", 21, UI.WHITE, 800)
	heading.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	column.add_child(heading)
	var text := UI.wrapped("Start a new game from one of your scenarios, or grab new scenarios from the community first.", 13, UI.SOFT)
	text.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	text.custom_minimum_size.x = 380
	column.add_child(text)
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 10)
	var start := UI.button("Start from a scenario", "hero")
	start.pressed.connect(func() -> void: _show_page("scenarios"))
	row.add_child(start)
	var browse := UI.button("Browse community scenarios", "hero_quiet")
	UI.set_disabled_look(browse, "Community is not in the native app yet.")
	row.add_child(browse)
	column.add_child(row)
	holder.add_child(column)
	return holder


func _build_scenarios_page() -> void:
	var scenarios: Array = _library.get("scenarios", [])
	var recent := scenarios.filter(func(scenario: Dictionary) -> bool: return int(scenario.get("games", 0)) > 0)
	if not recent.is_empty():
		_page_root.add_child(_section_header("Recently Used", "The scenarios behind your latest games and edits.", "clock"))
		var recent_grid := _grid()
		for scenario in recent.slice(0, 4):
			recent_grid.add_child(_scenario_card(scenario))
		_page_root.add_child(recent_grid)
	var header := HBoxContainer.new()
	header.add_theme_constant_override("separation", 8)
	header.add_child(_section_header("Scenario Library", "Everything you can start a new game from, in one place.", ""))
	header.add_child(UI.spacer())
	var controls := HBoxContainer.new()
	controls.add_theme_constant_override("separation", 6)
	controls.size_flags_vertical = Control.SIZE_SHRINK_END
	var search := LineEdit.new()
	search.placeholder_text = "Search scenarios..."
	search.text = _search
	search.custom_minimum_size = Vector2(200, 30)
	search.add_theme_stylebox_override("normal", UI.box(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.1), 8, 1, Vector4(10, 0, 10, 0)))
	search.add_theme_stylebox_override("focus", UI.box(Color(1, 1, 1, 0.07), Color(1, 1, 1, 0.22), 8, 1, Vector4(10, 0, 10, 0)))
	search.add_theme_font_override("font", UI.font(400))
	search.add_theme_font_size_override("font_size", 12)
	search.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.38))
	search.text_changed.connect(func(text: String) -> void:
		_search = text
		_refill_library_grid())
	controls.add_child(search)
	for chip in [["all", "All"], ["yours", "Yours"], ["community", "Community"], ["updates", "Updates"]]:
		var key: String = chip[0]
		var button := UI.button(chip[1], "small")
		button.custom_minimum_size.y = 30
		if key == _filter:
			button.add_theme_stylebox_override("normal", UI.box(Color(1, 1, 1, 0.16), Color(1, 1, 1, 0.3), 9, 1, Vector4(12, 0, 12, 0)))
		button.pressed.connect(func() -> void:
			_filter = key
			_show_page("scenarios"))
		controls.add_child(button)
	var sort := OptionButton.new()
	sort.add_item("Recently used")
	sort.add_item("Name")
	sort.selected = 0 if _sort == "recent" else 1
	sort.custom_minimum_size = Vector2(130, 30)
	sort.add_theme_stylebox_override("normal", UI.box(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.1), 8, 1, Vector4(10, 0, 10, 0)))
	sort.add_theme_font_override("font", UI.font(600))
	sort.add_theme_font_size_override("font_size", 12)
	sort.item_selected.connect(func(index: int) -> void:
		_sort = "recent" if index == 0 else "name"
		_refill_library_grid())
	controls.add_child(sort)
	header.add_child(controls)
	_page_root.add_child(header)
	var grid := _grid()
	grid.name = "LibraryGrid"
	_page_root.add_child(grid)
	_refill_library_grid()


func _refill_library_grid() -> void:
	var grid := _page_root.get_node_or_null("LibraryGrid") as GridContainer
	if not grid:
		return
	for child in grid.get_children():
		child.queue_free()
	grid.add_child(_create_card())
	var scenarios: Array = (_library.get("scenarios", []) as Array).duplicate()
	var needle := _search.strip_edges().to_lower()
	scenarios = scenarios.filter(func(scenario: Dictionary) -> bool:
		if not needle.is_empty() and not str(scenario.get("name", "")).to_lower().contains(needle):
			return false
		match _filter:
			"yours":
				return not scenario.get("builtIn", false) and not scenario.get("fromHub", false)
			"community":
				return scenario.get("fromHub", false)
			"updates":
				return false
		return true)
	if _sort == "name":
		scenarios.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return str(a.get("name", "")).naturalnocasecmp_to(str(b.get("name", ""))) < 0)
	else:
		scenarios.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return str(a.get("updatedAt", "")) > str(b.get("updatedAt", "")))
	for scenario in scenarios:
		grid.add_child(_scenario_card(scenario))


func _section_header(title: String, subtitle: String, icon_name: String) -> Control:
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 3)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	if not icon_name.is_empty():
		row.add_child(UI.icon_rect(icon_name, 14, Color(1, 1, 1, 0.7)))
	row.add_child(UI.label(title, 16, UI.WHITE, 800))
	column.add_child(row)
	column.add_child(UI.label(subtitle, 12, UI.SOFT))
	return column


func _grid() -> GridContainer:
	var grid := GridContainer.new()
	grid.add_theme_constant_override("h_separation", CARD_GAP)
	grid.add_theme_constant_override("v_separation", CARD_GAP)
	grid.columns = 4
	_grids.append(grid)
	return grid


func _fit_grids() -> void:
	var width := _body.size.x
	if width <= 0:
		return
	var columns: int = max(1, int((width + CARD_GAP) / (CARD_WIDTH + CARD_GAP)))
	for grid in _grids:
		if is_instance_valid(grid):
			grid.columns = columns


func _card_frame(active: bool, accent: Color, height: float) -> PanelContainer:
	var card := PanelContainer.new()
	card.custom_minimum_size = Vector2(CARD_WIDTH, height)
	var style := UI.box(UI.CARD, Color(accent, 0.533) if active else Color(1, 1, 1, 0.09), 24, 1, Vector4(1, 1, 1, 1))
	UI.shadowed(style, Color(0, 0, 0, 0.55 if active else 0.45), 19 if active else 16, Vector2(0, 16 if active else 14))
	card.add_theme_stylebox_override("panel", style)
	return card


func _cover(url: String, accent: Color, glow: float) -> CoverRect:
	var cover := CoverRect.new(accent, glow)
	cover.custom_minimum_size = Vector2(CARD_WIDTH - 2, 154)
	loader.fetch(url, func(texture: Texture2D) -> void:
		if is_instance_valid(cover):
			cover.set_cover(texture))
	return cover


func _info_tile(title: String, value: String) -> PanelContainer:
	var tile := PanelContainer.new()
	tile.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.07), 10, 1, Vector4(9, 6, 9, 7)))
	tile.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 1)
	column.add_child(UI.label(title.to_upper(), 10, Color(1, 1, 1, 0.45), 700, "Arial", 1))
	var value_label := UI.label(value, 13, UI.WHITE, 600)
	value_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	column.add_child(value_label)
	tile.add_child(column)
	return tile


func _count_chip(title: String, count: int) -> PanelContainer:
	var chip := PanelContainer.new()
	chip.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.08), 8, 1, Vector4(7, 2, 7, 3)))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 5)
	row.add_child(UI.label(title, 12, Color(1, 1, 1, 0.6)))
	row.add_child(UI.label(str(count), 12, UI.WHITE, 700))
	chip.add_child(row)
	return chip


func _game_card(game: Dictionary, active: bool) -> Control:
	var accent := Color(str(game.get("accentColor", "#2bc1f3")))
	var card := _card_frame(active, accent, 466)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	card.add_child(column)
	var top := Control.new()
	top.custom_minimum_size = Vector2(CARD_WIDTH - 2, 154)
	var cover := _cover(str(game.get("coverImageUrl", "")), accent, 1.0)
	cover.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	top.add_child(cover)
	var badges := HBoxContainer.new()
	badges.set_anchors_preset(Control.PRESET_TOP_WIDE)
	badges.offset_left = 14
	badges.offset_top = 13
	badges.offset_right = -13
	badges.add_theme_constant_override("separation", 6)
	badges.add_child(UI.pill("Current Game" if active else "Game", Color(accent, 0.533) if active else Color(10 / 255.0, 12 / 255.0, 18 / 255.0, 0.72), Color(1, 1, 1, 0.18), Color(0.973, 0.973, 0.98, 0.96), true))
	badges.add_child(UI.pill(str(game.get("scenarioName", "")), Color(10 / 255.0, 12 / 255.0, 18 / 255.0, 0.72), Color(1, 1, 1, 0.12), Color(1, 1, 1, 0.85)))
	badges.add_child(UI.spacer())
	var menu := Button.new()
	menu.icon = UI.icon("more", 16)
	menu.custom_minimum_size = Vector2(32, 35)
	menu.focus_mode = Control.FOCUS_NONE
	menu.add_theme_stylebox_override("normal", UI.box(Color(10 / 255.0, 12 / 255.0, 18 / 255.0, 0.72), Color(1, 1, 1, 0.12), 9, 1))
	UI.set_disabled_look(menu, "Edit, Clone and Export are not in the native app yet.")
	menu.modulate = Color(1, 1, 1, 0.8)
	badges.add_child(menu)
	top.add_child(badges)
	column.add_child(top)
	var body := MarginContainer.new()
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	for side in [["margin_left", 17], ["margin_right", 17], ["margin_top", 13], ["margin_bottom", 16]]:
		body.add_theme_constant_override(side[0], side[1])
	var stack := VBoxContainer.new()
	stack.add_theme_constant_override("separation", 7)
	var title := UI.label(str(game.get("name", "")), 21, UI.WHITE, 800, "Arial", -1)
	title.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	stack.add_child(title)
	stack.add_child(_info_tile("Country", str(game.get("country", ""))))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	var date := _info_tile("Date", str(game.get("gameDate", "")))
	date.size_flags_stretch_ratio = 1.66
	row.add_child(date)
	row.add_child(_info_tile("Round", str(int(game.get("round", 1)))))
	stack.add_child(row)
	var description := UI.wrapped(str(game.get("description", "")), 13, UI.MUTED, 400, 2)
	description.custom_minimum_size.y = 38
	stack.add_child(description)
	stack.add_child(UI.spacer(false))
	var chips := HBoxContainer.new()
	chips.add_theme_constant_override("separation", 6)
	chips.add_child(_count_chip("Actions", int(game.get("pendingActions", 0))))
	chips.add_child(_count_chip("Events", int(game.get("eventCount", 0))))
	stack.add_child(chips)
	var id := str(game.get("id", ""))
	var play := UI.button("Current" if active else "Play", "current" if active else "accent", "" if active else "play")
	play.pressed.connect(func() -> void: play_game.emit(id))
	stack.add_child(play)
	var archive := UI.button("Archive", "small", "archive")
	UI.set_disabled_look(archive, "Archiving is not in the native app yet.")
	stack.add_child(archive)
	body.add_child(stack)
	column.add_child(body)
	return card


func _scenario_card(scenario: Dictionary) -> Control:
	var accent := Color(str(scenario.get("accentColor", "#2bc1f3")))
	var card := _card_frame(false, accent, 363)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	card.add_child(column)
	var top := Control.new()
	top.custom_minimum_size = Vector2(CARD_WIDTH - 2, 154)
	var cover := _cover(str(scenario.get("coverImageUrl", "")), accent, 0.6)
	cover.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	top.add_child(cover)
	var badges := HBoxContainer.new()
	badges.set_anchors_preset(Control.PRESET_TOP_WIDE)
	badges.offset_left = 14
	badges.offset_top = 13
	badges.offset_right = -13
	badges.add_theme_constant_override("separation", 6)
	badges.add_child(UI.pill("Scenario", Color(accent, 0.533), Color(1, 1, 1, 0.18), Color(0.973, 0.973, 0.98, 0.96), true))
	if scenario.get("builtIn", false):
		badges.add_child(UI.pill("Built-In", Color(10 / 255.0, 12 / 255.0, 18 / 255.0, 0.72), Color(1, 1, 1, 0.22), UI.WHITE, true))
	badges.add_child(UI.spacer())
	var count := int(scenario.get("games", 0))
	badges.add_child(UI.pill("%d game%s" % [count, "" if count == 1 else "s"], Color(10 / 255.0, 12 / 255.0, 18 / 255.0, 0.72), Color(1, 1, 1, 0.12), Color(1, 1, 1, 0.85)))
	top.add_child(badges)
	column.add_child(top)
	var body := MarginContainer.new()
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	for side in [["margin_left", 17], ["margin_right", 17], ["margin_top", 13], ["margin_bottom", 15]]:
		body.add_theme_constant_override(side[0], side[1])
	var stack := VBoxContainer.new()
	stack.add_theme_constant_override("separation", 7)
	var title := UI.label(str(scenario.get("name", "")), 21, UI.WHITE, 800, "Arial", -1)
	title.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	stack.add_child(title)
	var subtitle := str(scenario.get("heroSubtitle", "")) if not str(scenario.get("heroSubtitle", "")).is_empty() else str(scenario.get("description", ""))
	var description := UI.wrapped(subtitle, 13, UI.MUTED, 400, 2)
	description.custom_minimum_size.y = 38
	stack.add_child(description)
	stack.add_child(UI.spacer(false))
	stack.add_child(UI.label(str(scenario.get("subtitle", "")), 12, UI.FAINT))
	var id := str(scenario.get("id", ""))
	var start := UI.button("New Game", "accent", "plus")
	start.pressed.connect(func() -> void: start_scenario.emit(id))
	stack.add_child(start)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 7)
	var edit := UI.button("Edit", "small", "edit")
	edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	UI.set_disabled_look(edit, "The Workshop is not in the native app yet.")
	row.add_child(edit)
	var clone := UI.button("Clone Scenario", "small", "clone")
	clone.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	clone.size_flags_stretch_ratio = 1.25
	UI.set_disabled_look(clone, "Cloning is not in the native app yet.")
	row.add_child(clone)
	stack.add_child(row)
	body.add_child(stack)
	column.add_child(body)
	return card


func _create_card() -> Control:
	var card := DashedCard.new()
	card.custom_minimum_size = Vector2(CARD_WIDTH, 363)
	card.tooltip_text = "The Workshop is not in the native app yet."
	card.modulate = Color(1, 1, 1, 0.55)
	return card


class DashedCard extends Control:
	func _draw() -> void:
		var rect := Rect2(Vector2(1, 1), size - Vector2(2, 2))
		var radius := 24.0
		var ink := Color(1, 1, 1, 0.22)
		var edges := [
			[Vector2(rect.position.x + radius, rect.position.y), Vector2(rect.end.x - radius, rect.position.y)],
			[Vector2(rect.end.x, rect.position.y + radius), Vector2(rect.end.x, rect.end.y - radius)],
			[Vector2(rect.end.x - radius, rect.end.y), Vector2(rect.position.x + radius, rect.end.y)],
			[Vector2(rect.position.x, rect.end.y - radius), Vector2(rect.position.x, rect.position.y + radius)],
		]
		for edge in edges:
			draw_dashed_line(edge[0], edge[1], ink, 1.5, 7.0)
		var corners := [[rect.position + Vector2(radius, radius), PI, PI * 1.5], [Vector2(rect.end.x - radius, rect.position.y + radius), PI * 1.5, TAU], [rect.end - Vector2(radius, radius), 0.0, PI * 0.5], [Vector2(rect.position.x + radius, rect.end.y - radius), PI * 0.5, PI]]
		for corner in corners:
			draw_arc(corner[0], radius, corner[1], corner[2], 10, ink, 1.5, true)
		var centre := size * 0.5
		draw_line(centre + Vector2(-13, -12), centre + Vector2(13, -12), Color(1, 1, 1, 0.85), 3.0, true)
		draw_line(centre + Vector2(0, -25), centre + Vector2(0, 1), Color(1, 1, 1, 0.85), 3.0, true)
		var font := UI.font(600)
		var text := "Create Scenario"
		var width := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, 13).x
		draw_string(font, Vector2(centre.x - width * 0.5, centre.y + 30), text, HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Color(1, 1, 1, 0.85))
