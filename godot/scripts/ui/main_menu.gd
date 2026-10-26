class_name MainMenu
extends Control

signal play_game(id: String)
signal start_scenario(id: String)
signal open_settings
signal refresh_requested
signal game_left(id: String)

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
var engine: EngineLink
var _game_view := "active"
var _game_sort := "recent"
var _game_search := ""
var _trash: Variant = null
var _confirm_empty := {}
var _busy := false


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
		_body.remove_child(_page_root)
		_page_root.queue_free()
	_grids.clear()
	_page_root = VBoxContainer.new()
	_page_root.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_page_root.add_theme_constant_override("separation", 14)
	_body.add_child(_page_root)
	var refresh := UI.button("Refresh", "header", "refresh")
	refresh.pressed.connect(func() -> void:
		refresh_trash()
		refresh_requested.emit())
	_actions.add_child(refresh)
	if key == "scenarios":
		_title.text = "Scenarios"
		var import_scenario := UI.button("Import Scenario", "header", "import")
		import_scenario.pressed.connect(func() -> void: _import("scenario"))
		_actions.add_child(import_scenario)
		_build_scenarios_page()
	else:
		_title.text = "Games"
		var import_game := UI.button("Import Game", "header", "import")
		import_game.pressed.connect(func() -> void: _import("game"))
		_actions.add_child(import_game)
		_build_games_page()
	_fit_grids.call_deferred()


func _touched_at(game: Dictionary) -> String:
	for key in ["lastPlayedAt", "importedAt", "updatedAt", "createdAt"]:
		var value := str(game.get(key, ""))
		if not value.is_empty():
			return value
	return ""


func _build_games_page() -> void:
	var games: Array = _library.get("games", [])
	var active := str(_library.get("activeGameId", ""))
	var visible_games := games.filter(func(game: Dictionary) -> bool: return not game.get("archived", false))
	var archived := games.filter(func(game: Dictionary) -> bool: return game.get("archived", false))
	archived.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return str(a.get("lastPlayedAt", "")) > str(b.get("lastPlayedAt", "")))
	if visible_games.is_empty() and archived.is_empty():
		_page_root.add_child(_empty_state())
	else:
		var recent := visible_games.duplicate()
		recent.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
			if str(a["id"]) == active:
				return true
			if str(b["id"]) == active:
				return false
			return _touched_at(a) > _touched_at(b))
		var shelf := recent.slice(0, 6)
		if not shelf.is_empty():
			_page_root.add_child(_menu_row("▶", "Continue Playing", "Pick up exactly where you left off.", null))
			var row := _grid()
			for game in shelf:
				row.add_child(_game_card(game, str(game["id"]) == active))
			_page_root.add_child(row)
			_page_root.add_child(_gap(18))
		_page_root.add_child(_collection_header("All Games", "One library for every campaign. Search, sort or show archived saves without duplicating them into another shelf.", _game_controls()))
		var grid := _grid()
		grid.name = "GamesGrid"
		_page_root.add_child(grid)
		_refill_games_grid()
		_page_root.add_child(_gap(24))
	var deleted := _deleted_row("game")
	if deleted:
		_page_root.add_child(deleted)


func _browsed_games() -> Array:
	var games: Array = _library.get("games", [])
	var active := str(_library.get("activeGameId", ""))
	var visible_games := games.filter(func(game: Dictionary) -> bool: return not game.get("archived", false))
	var archived := games.filter(func(game: Dictionary) -> bool: return game.get("archived", false))
	archived.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return str(a.get("lastPlayedAt", "")) > str(b.get("lastPlayedAt", "")))
	var base: Array = archived if _game_view == "archived" else (visible_games + archived if _game_view == "all" else visible_games)
	var query := _game_search.strip_edges().to_lower()
	var filtered := base.filter(func(game: Dictionary) -> bool:
		if query.is_empty():
			return true
		for key in ["name", "heroTitle", "scenarioName", "country"]:
			if str(game.get(key, "")).to_lower().contains(query):
				return true
		return false)
	match _game_sort:
		"turns":
			filtered.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
				if int(a.get("round", 0)) != int(b.get("round", 0)):
					return int(a.get("round", 0)) > int(b.get("round", 0))
				return _touched_at(a) > _touched_at(b))
		"played":
			filtered.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
				if int(a.get("playCount", 0)) != int(b.get("playCount", 0)):
					return int(a.get("playCount", 0)) > int(b.get("playCount", 0))
				return _touched_at(a) > _touched_at(b))
		"name":
			filtered.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return str(a.get("name", "")).naturalnocasecmp_to(str(b.get("name", ""))) < 0)
		_:
			filtered.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
				if str(a["id"]) == active:
					return true
				if str(b["id"]) == active:
					return false
				return _touched_at(a) > _touched_at(b))
	return filtered


func _refill_games_grid() -> void:
	var grid := _page_root.get_node_or_null("GamesGrid") as GridContainer
	if not grid:
		return
	for child in grid.get_children():
		grid.remove_child(child)
		child.queue_free()
	var active := str(_library.get("activeGameId", ""))
	var games := _browsed_games()
	var empty := _page_root.get_node_or_null("GamesEmpty")
	if empty:
		_page_root.remove_child(empty)
		empty.queue_free()
	if games.is_empty():
		var note := PanelContainer.new()
		note.name = "GamesEmpty"
		note.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0), Color(1, 1, 1, 0.12), 16, 1, Vector4(16, 16, 16, 16)))
		note.add_child(UI.label("No games match your search." if not _game_search.is_empty() else "No games in this view.", 14, Color(1, 1, 1, 0.48)))
		_page_root.add_child(note)
		_page_root.move_child(note, grid.get_index() + 1)
		return
	for game in games:
		grid.add_child(_game_card(game, str(game["id"]) == active))
	_fit_grids.call_deferred()


func _game_controls() -> Control:
	var controls := HBoxContainer.new()
	controls.add_theme_constant_override("separation", 7)
	controls.size_flags_vertical = Control.SIZE_SHRINK_END
	var search := _search_box("Search games…", _game_search, 256)
	search.text_changed.connect(func(text: String) -> void:
		_game_search = text
		_refill_games_grid())
	controls.add_child(search)
	for entry in [["active", "Active"], ["all", "All"], ["archived", "Archived"]]:
		var key: String = entry[0]
		var pill := _browse_pill(entry[1], key == _game_view)
		pill.pressed.connect(func() -> void:
			_game_view = key
			_show_page("games"))
		controls.add_child(pill)
	var sort := _select(["Recently played", "Most turns", "Most played", "Name"], ["recent", "turns", "played", "name"].find(_game_sort))
	sort.item_selected.connect(func(index: int) -> void:
		_game_sort = ["recent", "turns", "played", "name"][index]
		_refill_games_grid())
	controls.add_child(sort)
	return controls


func _search_box(placeholder: String, value: String, width: float) -> LineEdit:
	var search := LineEdit.new()
	search.placeholder_text = placeholder
	search.text = value
	search.custom_minimum_size = Vector2(width, 37)
	search.add_theme_stylebox_override("normal", UI.box(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.1), 9, 1, Vector4(14, 0, 14, 0)))
	search.add_theme_stylebox_override("focus", UI.box(Color(1, 1, 1, 0.07), Color(1, 1, 1, 0.22), 9, 1, Vector4(14, 0, 14, 0)))
	search.add_theme_font_override("font", UI.font(400))
	search.add_theme_font_size_override("font_size", 13)
	search.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.38))
	return search


func _browse_pill(text: String, active: bool) -> Button:
	var pill := UI.button(text, "small")
	pill.custom_minimum_size.y = 37
	var normal := UI.box(Color(1, 1, 1, 0.12) if active else Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.26) if active else Color(1, 1, 1, 0.08), 9, 1, Vector4(14, 0, 14, 0))
	pill.add_theme_stylebox_override("normal", normal)
	pill.add_theme_stylebox_override("focus", normal)
	for name in ["font_color", "font_focus_color"]:
		pill.add_theme_color_override(name, Color(0.96, 0.96, 0.97) if active else Color(246 / 255.0, 246 / 255.0, 248 / 255.0, 0.78))
	return pill


func _select(items: Array, selected: int) -> OptionButton:
	var select := OptionButton.new()
	for item in items:
		select.add_item(str(item))
	select.selected = max(0, selected)
	select.focus_mode = Control.FOCUS_NONE
	select.custom_minimum_size = Vector2(0, 37)
	select.add_theme_stylebox_override("normal", UI.box(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.1), 9, 1, Vector4(14, 0, 14, 0)))
	select.add_theme_stylebox_override("hover", UI.box(Color(1, 1, 1, 0.08), Color(1, 1, 1, 0.16), 9, 1, Vector4(14, 0, 14, 0)))
	select.add_theme_stylebox_override("focus", UI.box(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.1), 9, 1, Vector4(14, 0, 14, 0)))
	select.add_theme_font_override("font", UI.font(600))
	select.add_theme_font_size_override("font_size", 13)
	return select


func _gap(height: int) -> Control:
	var gap := Control.new()
	gap.custom_minimum_size.y = height
	gap.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return gap


func _menu_row(icon: String, title: String, description: String, action: Control) -> Control:
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 5)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 14)
	var heading := HBoxContainer.new()
	heading.add_theme_constant_override("separation", 9)
	if not icon.is_empty():
		heading.add_child(UI.label(icon, 16, UI.WHITE))
	heading.add_child(UI.label(title, 18, Color(1, 1, 1, 0.94), 800, "Arial", -1))
	row.add_child(heading)
	var rule := ColorRect.new()
	rule.color = Color(1, 1, 1, 0.08)
	rule.custom_minimum_size.y = 1
	rule.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	rule.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(rule)
	if action:
		row.add_child(action)
	column.add_child(row)
	if not description.is_empty():
		var words := UI.wrapped(description, 14, Color(1, 1, 1, 0.64))
		var indent := MarginContainer.new()
		indent.add_theme_constant_override("margin_left", 25 if not icon.is_empty() else 0)
		indent.add_child(words)
		column.add_child(indent)
	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_bottom", 4)
	margin.add_child(column)
	return margin


func _collection_header(title: String, description: String, controls: Control) -> Control:
	var row := HFlowContainer.new()
	row.add_theme_constant_override("h_separation", 13)
	row.add_theme_constant_override("v_separation", 10)
	var words := VBoxContainer.new()
	words.add_theme_constant_override("separation", 4)
	words.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	words.custom_minimum_size.x = 320
	words.add_child(UI.label(title, 20, Color(1, 1, 1, 0.96), 800, "Arial", -1))
	if not description.is_empty():
		words.add_child(UI.wrapped(description, 14, Color(1, 1, 1, 0.58)))
	row.add_child(words)
	if controls:
		row.add_child(controls)
	return row


func _deleted_when(deleted_at: String) -> String:
	var parsed := Time.get_unix_time_from_datetime_string(deleted_at.substr(0, 19))
	if parsed <= 0:
		return "Deleted today"
	var offset: int = int(Time.get_time_zone_from_system().get("bias", 0)) * 60
	var today := int((Time.get_unix_time_from_system() + offset) / 86400)
	var then := int((parsed + offset) / 86400)
	var days := today - then
	if days <= 0:
		return "Deleted today"
	return "Deleted yesterday" if days == 1 else "Deleted %d days ago" % days


func _format_size(bytes: int) -> String:
	if bytes >= 1048576:
		return "%.1f MB" % (bytes / 1048576.0)
	return "%d KB" % max(1, int(round(bytes / 1024.0)))


func _deleted_row(kind: String) -> Control:
	if typeof(_trash) != TYPE_DICTIONARY:
		return null
	var entries: Array = (_trash.get("entries", []) as Array).filter(func(entry: Dictionary) -> bool: return str(entry.get("kind", "")) == kind)
	if entries.is_empty():
		return null
	var count := entries.size()
	var keep_days := int(_trash.get("keepDays", 0))
	var keep_count := int(_trash.get("keepCount", 0))
	var noun := "games" if kind == "game" else "scenarios"
	var single := "game" if kind == "game" else "scenario"
	var description := ""
	if keep_count > 0:
		description = "Deleted %s can be restored for %d days, while they are among the last %d things you deleted." % [noun, keep_days, keep_count]
	else:
		description = "Deleted %s can be restored for %d days, then they are deleted for good." % [noun, keep_days]
	var confirming: bool = _confirm_empty.get(kind, false)
	if confirming:
		description = "Delete the %s in Recently deleted for good? This cannot be undone." % single if count == 1 else "Delete the %d %s in Recently deleted for good? This cannot be undone." % [count, noun]
	var action := HBoxContainer.new()
	action.add_theme_constant_override("separation", 7)
	if confirming:
		var cancel := UI.button("Cancel", "header")
		cancel.pressed.connect(func() -> void:
			_confirm_empty[kind] = false
			_show_page(_page))
		action.add_child(cancel)
		var empty := UI.button("Empty", "header")
		var red := UI.box(Color(185 / 255.0, 28 / 255.0, 28 / 255.0, 0.72), Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.4), 9, 1, Vector4(16, 0, 16, 0))
		empty.add_theme_stylebox_override("normal", red)
		empty.add_theme_stylebox_override("hover", red)
		empty.pressed.connect(func() -> void:
			_confirm_empty[kind] = false
			_trash_action("library.emptyTrash", {"kind": kind}))
		action.add_child(empty)
	else:
		var ask := UI.button("Empty", "header")
		ask.pressed.connect(func() -> void:
			_confirm_empty[kind] = true
			_show_page(_page))
		action.add_child(ask)
	var section := VBoxContainer.new()
	section.add_theme_constant_override("separation", 14)
	section.add_child(_menu_row("🗑️", "Recently deleted", description, action))
	var grid := _grid()
	for entry in entries:
		grid.add_child(_deleted_card(entry))
	section.add_child(grid)
	return section


func _deleted_card(entry: Dictionary) -> Control:
	var card := PanelContainer.new()
	card.custom_minimum_size = Vector2(CARD_WIDTH, 0)
	card.add_theme_stylebox_override("panel", UI.box(UI.CARD, Color(1, 1, 1, 0.09), 24, 1, Vector4(19, 18, 19, 18)))
	var stack := VBoxContainer.new()
	stack.add_theme_constant_override("separation", 13)
	var title := UI.label(str(entry.get("name", "")), 16, UI.WHITE, 800)
	title.clip_text = true
	title.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	stack.add_child(title)
	var meta := HBoxContainer.new()
	meta.add_theme_constant_override("separation", 10)
	meta.add_child(UI.label(_deleted_when(str(entry.get("deletedAt", ""))), 13, Color(1, 1, 1, 0.64)))
	if int(entry.get("bytes", 0)) > 0:
		meta.add_child(UI.label(_format_size(int(entry["bytes"])), 13, Color(1, 1, 1, 0.64)))
	stack.add_child(meta)
	var restore := UI.button("Restore", "header", "refresh")
	restore.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	restore.pressed.connect(func() -> void: _trash_action("library.restore", {"entry": str(entry.get("entry", ""))}))
	stack.add_child(restore)
	card.add_child(stack)
	return card


func _trash_action(method: String, args: Dictionary) -> void:
	if _busy:
		return
	_busy = true
	var reply := await engine.request(method, args)
	_busy = false
	if not reply.get("ok", false):
		set_status(str(reply.get("error", "")), true)
	await refresh_trash()
	refresh_requested.emit()


func refresh_trash() -> void:
	if not engine:
		return
	var reply := await engine.request("library.trash")
	_trash = reply.get("result") if reply.get("ok", false) else null
	if _page in ["games", "scenarios"]:
		_show_page(_page)


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
	var deleted := _deleted_row("scenario")
	if deleted:
		_page_root.add_child(_gap(24))
		_page_root.add_child(deleted)


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
	var eyebrow := str(game.get("eyebrow", ""))
	badges.add_child(UI.pill("Current Game" if active else (eyebrow if not eyebrow.is_empty() else "Game"), Color(accent, 0.533) if active else Color(10 / 255.0, 12 / 255.0, 18 / 255.0, 0.72), Color(1, 1, 1, 0.18), Color(0.973, 0.973, 0.98, 0.96), true))
	var scenario_pill := UI.pill(str(game.get("scenarioName", "")), Color(10 / 255.0, 12 / 255.0, 18 / 255.0, 0.72), Color(1, 1, 1, 0.12), Color(1, 1, 1, 0.85))
	scenario_pill.tooltip_text = str(game.get("scenarioName", ""))
	scenario_pill.clip_contents = true
	scenario_pill.custom_minimum_size.x = 0
	badges.add_child(scenario_pill)
	badges.add_child(UI.spacer())
	var menu := Button.new()
	menu.icon = UI.icon("more", 16)
	menu.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
	menu.custom_minimum_size = Vector2(32, 35)
	menu.focus_mode = Control.FOCUS_NONE
	menu.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	menu.tooltip_text = "More for %s" % str(game.get("name", ""))
	var menu_style := UI.box(Color(10 / 255.0, 12 / 255.0, 18 / 255.0, 0.72), Color(1, 1, 1, 0.12), 9, 1)
	menu.add_theme_stylebox_override("normal", menu_style)
	menu.add_theme_stylebox_override("hover", UI.box(Color(1, 1, 1, 0.18), Color(1, 1, 1, 0.2), 9, 1))
	menu.add_theme_stylebox_override("pressed", UI.box(Color(1, 1, 1, 0.18), Color(1, 1, 1, 0.2), 9, 1))
	menu.pressed.connect(func() -> void: _open_card_menu(menu, game))
	if _busy:
		UI.set_disabled_look(menu, "Working…")
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
	var country := str(game.get("country", ""))
	stack.add_child(_info_tile("Country", country if not country.is_empty() else "No player country"))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	var date_text := str(game.get("gameDate", ""))
	var date := _info_tile("Date", date_text if not date_text.is_empty() else "No date")
	date.size_flags_stretch_ratio = 1.66
	row.add_child(date)
	row.add_child(_info_tile("Round", str(max(1, int(game.get("round", 1))))))
	stack.add_child(row)
	var description_text := str(game.get("description", ""))
	var description := UI.wrapped(description_text if not description_text.is_empty() else "Playable campaign session.", 13, UI.MUTED, 400, 3)
	description.tooltip_text = description_text
	description.mouse_filter = Control.MOUSE_FILTER_PASS
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
	if not active:
		var accent_style := UI.box(accent, accent, 11, 1, Vector4(16, 0, 16, 0))
		play.add_theme_stylebox_override("normal", accent_style)
		play.add_theme_stylebox_override("focus", accent_style)
		var accent_hover := UI.box(accent.lightened(0.12), accent.lightened(0.12), 11, 1, Vector4(16, 0, 16, 0))
		play.add_theme_stylebox_override("hover", accent_hover)
		play.add_theme_stylebox_override("pressed", accent_hover)
	play.pressed.connect(func() -> void: play_game.emit(id))
	stack.add_child(play)
	var buttons := HBoxContainer.new()
	buttons.add_theme_constant_override("separation", 7)
	var archived: bool = game.get("archived", false)
	var archive := UI.button("Unarchive" if archived else "Archive", "small", "archive")
	archive.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	archive.tooltip_text = "Move back into your library" if archived else "Hide from the library without deleting"
	archive.pressed.connect(func() -> void: _archive_game(game))
	buttons.add_child(archive)
	if archived and game.get("canDelete", false):
		var delete := UI.button("Delete", "small")
		delete.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var red := UI.box(Color(127 / 255.0, 29 / 255.0, 29 / 255.0, 0.34), Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.28), 9, 1, Vector4(12, 0, 12, 0))
		delete.add_theme_stylebox_override("normal", red)
		delete.add_theme_stylebox_override("hover", UI.box(Color(127 / 255.0, 29 / 255.0, 29 / 255.0, 0.46), Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.4), 9, 1, Vector4(12, 0, 12, 0)))
		for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
			delete.add_theme_color_override(name, Color("#fecaca"))
		if _busy:
			delete.disabled = true
		delete.pressed.connect(func() -> void: _delete_game(game))
		buttons.add_child(delete)
	stack.add_child(buttons)
	body.add_child(stack)
	column.add_child(body)
	return card


func _open_card_menu(anchor: Button, game: Dictionary) -> void:
	var popup := PopupPanel.new()
	popup.add_theme_stylebox_override("panel", UI.box(Color8(24, 26, 32, 250), Color(1, 1, 1, 0.12), 12, 1))
	var stack := VBoxContainer.new()
	stack.add_theme_constant_override("separation", 0)
	stack.custom_minimum_size.x = 208
	var items := [["Edit", "Editing a game's details is not in the native app yet."], ["Clone", ""], ["Export", ""]]
	for item in items:
		var label: String = item[0]
		var row := Button.new()
		row.text = label
		row.alignment = HORIZONTAL_ALIGNMENT_LEFT
		row.focus_mode = Control.FOCUS_NONE
		row.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		row.custom_minimum_size.y = 36
		row.add_theme_font_override("font", UI.font(600))
		row.add_theme_font_size_override("font_size", 13)
		row.add_theme_color_override("font_color", Color(248 / 255.0, 250 / 255.0, 252 / 255.0, 0.82))
		row.add_theme_color_override("font_hover_color", UI.WHITE)
		row.add_theme_stylebox_override("normal", UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 0, Vector4(13, 0, 13, 0)))
		row.add_theme_stylebox_override("hover", UI.box(Color(1, 1, 1, 0.16), Color(0, 0, 0, 0), 0, 0, Vector4(13, 0, 13, 0)))
		row.add_theme_stylebox_override("pressed", UI.box(Color(1, 1, 1, 0.16), Color(0, 0, 0, 0), 0, 0, Vector4(13, 0, 13, 0)))
		row.add_theme_stylebox_override("focus", UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 0, Vector4(13, 0, 13, 0)))
		if not str(item[1]).is_empty():
			UI.set_disabled_look(row, item[1])
		elif label == "Clone":
			row.pressed.connect(func() -> void:
				popup.hide()
				_clone_game(game))
		else:
			row.pressed.connect(func() -> void:
				row.text = "Exporting…"
				for other in stack.get_children():
					if other is Button and other != row:
						(other as Button).modulate.a = 0.45
				await _export_game(game)
				if is_instance_valid(popup):
					popup.hide())
		stack.add_child(row)
	var rule := ColorRect.new()
	rule.color = Color(1, 1, 1, 0.08)
	rule.custom_minimum_size.y = 1
	stack.add_child(rule)
	var footer := MarginContainer.new()
	for side in [["margin_left", 13], ["margin_right", 13], ["margin_top", 8], ["margin_bottom", 9]]:
		footer.add_theme_constant_override(side[0], side[1])
	var note := UI.wrapped("An exported game carries its conversations, advisors and events — worth a look before posting it publicly.", 11, Color(1, 1, 1, 0.45))
	note.custom_minimum_size.x = 182
	footer.add_child(note)
	stack.add_child(footer)
	popup.add_child(stack)
	add_child(popup)
	popup.popup_hide.connect(func() -> void: popup.queue_free())
	var at := anchor.get_screen_position() + Vector2(anchor.size.x - 210, anchor.size.y + 6)
	popup.popup(Rect2i(Vector2i(at), Vector2i(210, 0)))


func _archive_game(game: Dictionary) -> void:
	var archived: bool = game.get("archived", false)
	var reply := await engine.request("library.archive", {"id": str(game.get("id", "")), "archived": not archived})
	if not reply.get("ok", false):
		set_status(str(reply.get("error", "")), true)
		return
	if not archived:
		game_left.emit(str(game.get("id", "")))
	refresh_requested.emit()


func _delete_game(game: Dictionary) -> void:
	if not game.get("canDelete", false) or _busy:
		return
	_busy = true
	var reply := await engine.request("library.delete", {"id": str(game.get("id", ""))})
	_busy = false
	if not reply.get("ok", false):
		set_status(str(reply.get("error", "")), true)
	else:
		game_left.emit(str(game.get("id", "")))
	await refresh_trash()
	refresh_requested.emit()


func _clone_game(game: Dictionary) -> void:
	if _busy:
		return
	_busy = true
	var reply := await engine.request("library.cloneGame", {"id": str(game.get("id", "")), "name": str(game.get("name", ""))})
	_busy = false
	if not reply.get("ok", false):
		set_status(str(reply.get("error", "")), true)
	refresh_requested.emit()


func _pick_file(save: bool, default_name: String, filters: PackedStringArray) -> String:
	var dialog := FileDialog.new()
	dialog.use_native_dialog = true
	dialog.access = FileDialog.ACCESS_FILESYSTEM
	dialog.file_mode = FileDialog.FILE_MODE_SAVE_FILE if save else FileDialog.FILE_MODE_OPEN_FILE
	dialog.filters = filters
	dialog.current_dir = OS.get_system_dir(OS.SYSTEM_DIR_DOWNLOADS)
	if save:
		dialog.current_file = default_name
	add_child(dialog)
	var picked := [""]
	var finished := [false]
	dialog.file_selected.connect(func(path: String) -> void:
		picked[0] = path
		finished[0] = true)
	dialog.canceled.connect(func() -> void: finished[0] = true)
	dialog.popup_centered()
	while not finished[0] and is_instance_valid(dialog):
		await get_tree().process_frame
	if is_instance_valid(dialog):
		dialog.queue_free()
	return str(picked[0])


func _ask(text: String) -> bool:
	var dialog := ConfirmationDialog.new()
	dialog.dialog_text = text
	dialog.dialog_autowrap = true
	dialog.min_size = Vector2i(460, 0)
	add_child(dialog)
	var answer := [false]
	var finished := [false]
	dialog.confirmed.connect(func() -> void:
		answer[0] = true
		finished[0] = true)
	dialog.canceled.connect(func() -> void: finished[0] = true)
	dialog.popup_centered()
	while not finished[0] and is_instance_valid(dialog):
		await get_tree().process_frame
	if is_instance_valid(dialog):
		dialog.queue_free()
	return bool(answer[0])


func _export_game(game: Dictionary) -> void:
	if _busy:
		return
	var id := str(game.get("id", ""))
	var target := await _pick_file(true, "%s-game.zip" % id, PackedStringArray(["*.zip ; Game export"]))
	if target.is_empty():
		return
	_busy = true
	var reply := await engine.request("library.exportGame", {"id": id, "path": target})
	if reply.get("ok", false) and not str(reply["result"].get("ask", "")).is_empty():
		if await _ask(str(reply["result"]["ask"])):
			reply = await engine.request("library.exportGame", {"id": id, "path": target, "carry": true})
		else:
			reply = {"ok": true, "result": {"cancelled": true}}
	_busy = false
	if not reply.get("ok", false):
		set_status(str(reply.get("error", "")), true)
	elif not str(reply["result"].get("note", "")).is_empty():
		set_status(str(reply["result"]["note"]), true)


func _import(kind: String) -> void:
	if _busy:
		return
	var source := await _pick_file(false, "", PackedStringArray(["*.zip ; Game export"]) if kind == "game" else PackedStringArray(["*.zip, *.json ; Scenario"]))
	if source.is_empty():
		return
	_busy = true
	set_status("")
	var reply := await engine.request("library.importGame" if kind == "game" else "library.importScenario", {"path": source})
	_busy = false
	if not reply.get("ok", false):
		set_status(str(reply.get("error", "")), true)
		return
	if not str(reply["result"].get("note", "")).is_empty():
		set_status(str(reply["result"]["note"]), true)
	_show_page("games" if kind == "game" else "scenarios")
	refresh_requested.emit()


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
