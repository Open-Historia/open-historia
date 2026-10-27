class_name ScenarioEditor
extends Control

signal closed
signal failed(message: String)
signal library_changed
signal play_game(game_id: String)
signal game_deleted(game_id: String)
signal scenario_update_requested(scenario_id: String, post_id: int)
signal busy_changed(busy: bool)

const SECTION_LABELS := {
	"assets": "Assets",
	"bundles": "Bundles",
	"features": "Features",
	"fronts": "Fronts",
	"history": "Pre-history",
	"music": "Music",
	"overview": "Overview",
	"politics": "Politics",
	"prompts": "Prompts",
	"stats": "Stats",
	"world": "World",
}
const SECTION_GROUPS := [
	["Presentation", ["overview", "assets", "music"]],
	["Setting", ["world", "history", "politics"]],
	["War", ["fronts"]],
	["Rules and AI", ["stats", "features", "prompts"]],
	["Sharing", ["bundles"]],
]
const SECTION_BLURBS := {
	"overview": "How it appears in the library: its name, colour and the words on its card.",
	"assets": "The cover and the files the map is drawn from.",
	"music": "The hub's tracks it plays while a game opens, in the game, at war and in the war room.",
	"world": "Where play begins: the player's country, the date, the troops and the story so far.",
	"history": "The events that led to the start date.",
	"politics": "Governments, parties and institutions.",
	"fronts": "How its wars are fought, every country's military and the fronts it begins with.",
	"stats": "The national stats every country is measured by.",
	"features": "Which gameplay features are on.",
	"prompts": "The instructions the AI follows.",
	"bundles": "Download it as one file to share or keep.",
}
const SCENARIO_SECTIONS := ["overview", "world", "history", "fronts", "politics", "stats", "features", "prompts", "assets", "music", "bundles"]
const GAME_SECTIONS := ["overview", "world", "features", "prompts", "assets"]
const SECTION_ICONS := {
	"overview": "<rect x='3.5' y='4.5' width='17' height='15' rx='2.5'/><path d='M7 9h10M7 13h6'/>",
	"assets": "<rect x='3.5' y='5' width='17' height='14' rx='2.5'/><circle cx='9' cy='10' r='1.6'/><path d='m4 17 5-4.5 4 3.5 3-2.5 4 3.5'/>",
	"music": "<path d='M9 17.5V6l10-2v11.5'/><circle cx='6.5' cy='17.5' r='2.5'/><circle cx='16.5' cy='15.5' r='2.5'/>",
	"world": "<circle cx='12' cy='12' r='8.5'/><path d='M3.5 12h17M12 3.5c2.3 2.3 3.5 5.2 3.5 8.5s-1.2 6.2-3.5 8.5c-2.3-2.3-3.5-5.2-3.5-8.5s1.2-6.2 3.5-8.5z'/>",
	"history": "<path d='M5 4.5h11.5a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2z'/><path d='M5 17.5a2 2 0 0 1 2-2h11.5M9 8.5h6'/>",
	"politics": "<path d='M4 9.5 12 5l8 4.5M5.5 19.5h13M7 10.5v7M12 10.5v7M17 10.5v7'/>",
	"fronts": "<path d='M5 5v15M5 5.5c4-2 7 2 11 0v8c-4 2-7-2-11 0'/>",
	"stats": "<path d='M5 19.5V11M10 19.5V6M15 19.5v-6M20 19.5V9'/>",
	"features": "<path d='M6 6.5h12M6 12h12M6 17.5h12'/><circle cx='9' cy='6.5' r='1.8'/><circle cx='15' cy='12' r='1.8'/><circle cx='10' cy='17.5' r='1.8'/>",
	"prompts": "<path d='M5 5.5h14v10H9.5L5 19.5z'/><path d='M8.5 9.5h7M8.5 12.5h4.5'/>",
	"bundles": "<path d='M12 4.5v10M8 10.5l4 4 4-4'/><path d='M5 16.5v2a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-2'/>",
}
const UNIT_TYPES := ["infantry", "armor", "air", "naval", "artillery", "garrison"]
const UNIT_TYPE_LABELS := {
	"infantry": "Infantry",
	"armor": "Armor",
	"air": "Air Force",
	"naval": "Naval",
	"artillery": "Artillery",
	"garrison": "Garrison",
}
const SCENARIO_ASSETS := [["cover", "Cover Image"], ["cities", "Cities PMTiles"], ["colors", "Colors JSON"], ["countries", "Countries PMTiles"], ["regions", "Regions PMTiles"]]
const GAME_ASSETS := [["cover", "Cover Image"]]
const ASSET_FILTERS := {
	"cover": "*.gif, *.jpeg, *.jpg, *.png, *.webp ; Images",
	"cities": "*.pmtiles ; PMTiles",
	"colors": "*.json ; JSON",
	"countries": "*.pmtiles ; PMTiles",
	"regions": "*.pmtiles ; PMTiles",
}
const NAV_INK := Color(236 / 255.0, 236 / 255.0, 240 / 255.0, 0.72)
const COVER_BG := Color("#1c1f27")
const DIALOG_MAX := Vector2(1216, 896)
const NAV_WIDTH := 248.0
const PROMPT_INFO := "Only the guidance is editable: the role, the tone, what to simulate and what makes a good result. The technical parts of every prompt (the placeholders that inject the world, the output contracts, the map rules) are fixed in the app, so every scenario and game keeps up with the game as it changes. A placeholder such as ${PLAYER_POLITY} inside a passage is filled in by the game."
const DATE_PLACEHOLDER := "YYYY-MM-DD — before AD 1 use a minus: -0218-03-01 is 1 March 218 BC"
const DATE_TITLE := "Dates are YYYY-MM-DD. A year before AD 1 carries a leading minus and counts backwards with no year zero: -0218-03-01 is 1 March 218 BC, -0001-12-31 the last day of 1 BC."
const LICENSE_URL_FALLBACK := "https://creativecommons.org/licenses/by/4.0/"

var engine: EngineLink
var context := {}
var loader: ImageLoader
var _kind := ""
var _id := ""
var _details := {}
var _form := {}
var _saved_form := {}
var _stats: Variant = null
var _saved_stats: Variant = null
var _stats_failed := false
var _country_options: Array = []
var _politics_badge := ""
var _error := ""
var _busy := false
var _section := "overview"
var _prompt_section := "leader"
var _prompt_status := {}
var _prompt_catalog: Array = []
var _constants := {}
var _data_root := ""
var _panels: Array = []
var _workshop: Control
var _reload_turn := 0
var _reloading := false
var _reload_again := false
var _reload_take := false
var _open_turn := 0

var _dim: ColorRect
var _dialog: PanelContainer
var _nav_cover: RoundedImage
var _nav_kicker: Label
var _nav_name: Label
var _nav_groups: VBoxContainer
var _nav_actions: VBoxContainer
var _save_button: Button
var _header_title: Label
var _header_blurb: Label
var _scroll: ScrollContainer
var _content: VBoxContainer
var _error_box: PanelContainer
var _error_label: Label
var _suggest_box: SuggestBox


class RoundedImage extends Panel:
	var _picture: TextureRect
	var _frame: Panel

	func _init(size_px: Vector2, radius: int, background: Color, border: Color, border_width: int) -> void:
		custom_minimum_size = size_px
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_theme_stylebox_override("panel", UI.box(background, Color(0, 0, 0, 0), radius, 0))
		clip_children = CanvasItem.CLIP_CHILDREN_AND_DRAW
		_picture = TextureRect.new()
		_picture.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		_picture.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
		_picture.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		_picture.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(_picture)
		_frame = Panel.new()
		_frame.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		_frame.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var ring := StyleBoxFlat.new()
		ring.bg_color = Color(0, 0, 0, 0)
		ring.draw_center = false
		ring.border_color = border
		ring.set_border_width_all(border_width)
		ring.set_corner_radius_all(radius)
		ring.anti_aliasing = true
		_frame.add_theme_stylebox_override("panel", ring)
		add_child(_frame)

	func set_texture(texture: Texture2D) -> void:
		_picture.texture = texture

	func set_border(color: Color) -> void:
		var ring := _frame.get_theme_stylebox("panel") as StyleBoxFlat
		if ring:
			var copy := ring.duplicate() as StyleBoxFlat
			copy.border_color = color
			_frame.add_theme_stylebox_override("panel", copy)


class SuggestBox extends PanelContainer:
	var _list: VBoxContainer
	var _scroll: ScrollContainer
	var _target: LineEdit
	var _options: Array = []
	var _on_pick: Callable

	func _init() -> void:
		add_theme_stylebox_override("panel", UI.box(Color8(24, 26, 32, 250), Color(1, 1, 1, 0.14), 10, 1, Vector4(4, 4, 4, 4)))
		visible = false
		mouse_filter = Control.MOUSE_FILTER_STOP
		_scroll = ScrollContainer.new()
		_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
		add_child(_scroll)
		_list = VBoxContainer.new()
		_list.add_theme_constant_override("separation", 0)
		_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		_scroll.add_child(_list)

	func attach(target: LineEdit, options: Array, on_pick: Callable) -> void:
		var activate := func() -> void:
			_target = target
			_options = options
			_on_pick = on_pick
		target.focus_entered.connect(func() -> void:
			activate.call()
			show_for(target.text))
		target.text_changed.connect(func(text: String) -> void:
			activate.call()
			show_for(text))
		target.focus_exited.connect(func() -> void: _close_later())
		target.text_submitted.connect(func(_text: String) -> void: visible = false)

	func _close_later() -> void:
		await get_tree().create_timer(0.15).timeout
		if is_instance_valid(self) and is_instance_valid(_target) and not _target.has_focus():
			visible = false

	func show_for(text: String) -> void:
		if not is_instance_valid(_target):
			return
		for child in _list.get_children():
			_list.remove_child(child)
			child.queue_free()
		var wanted := text.strip_edges().to_lower()
		var shown := 0
		for option in _options:
			var pair: Array = option
			var value := str(pair[0])
			var label := str(pair[1])
			if not wanted.is_empty() and not value.to_lower().contains(wanted) and not label.to_lower().contains(wanted):
				continue
			_list.add_child(_row(value, label))
			shown += 1
			if shown >= 60:
				break
		if shown == 0:
			visible = false
			return
		var rect := _target.get_global_rect()
		var holder := get_parent() as Control
		var origin := holder.get_global_rect().position if holder else Vector2.ZERO
		position = Vector2(rect.position.x, rect.end.y + 4) - origin
		var width := maxf(rect.size.x, 220.0)
		_scroll.custom_minimum_size = Vector2(width - 8, minf(260.0, float(shown) * 30.0))
		size = Vector2(width, 0)
		reset_size()
		var room := (holder.size.y if holder else 900.0) - position.y - 8.0
		if room < 120.0:
			position.y = rect.position.y - origin.y - size.y - 4.0
		visible = true
		move_to_front()

	func _row(value: String, label: String) -> Button:
		var row := Button.new()
		row.focus_mode = Control.FOCUS_NONE
		row.alignment = HORIZONTAL_ALIGNMENT_LEFT
		row.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		row.custom_minimum_size.y = 30
		row.text = value if label.is_empty() or label == value else "%s   %s" % [label, value]
		row.clip_text = true
		row.add_theme_font_override("font", UI.font(400))
		row.add_theme_font_size_override("font_size", 13)
		for name in ["font_color", "font_focus_color"]:
			row.add_theme_color_override(name, Color(1, 1, 1, 0.86))
		for name in ["font_hover_color", "font_pressed_color", "font_hover_pressed_color"]:
			row.add_theme_color_override(name, UI.WHITE)
		row.add_theme_stylebox_override("normal", UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 7, 0, Vector4(10, 0, 10, 0)))
		row.add_theme_stylebox_override("focus", UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 7, 0, Vector4(10, 0, 10, 0)))
		row.add_theme_stylebox_override("hover", UI.box(Color(1, 1, 1, 0.1), Color(0, 0, 0, 0), 7, 0, Vector4(10, 0, 10, 0)))
		row.add_theme_stylebox_override("pressed", UI.box(Color(1, 1, 1, 0.14), Color(0, 0, 0, 0), 7, 0, Vector4(10, 0, 10, 0)))
		row.pressed.connect(func() -> void:
			visible = false
			if is_instance_valid(_target):
				_target.text = value
				_target.caret_column = value.length()
			if _on_pick.is_valid():
				_on_pick.call(value))
		return row


func _init() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	visible = false
	_build()


func _ready() -> void:
	get_viewport().size_changed.connect(_fit)
	_fit.call_deferred()


func setup(link: EngineLink, extra := {}) -> void:
	engine = link
	context = extra
	if not engine.engine_event.is_connected(_on_engine_event):
		engine.engine_event.connect(_on_engine_event)
	if extra.get("loader") is ImageLoader:
		loader = extra["loader"]
	else:
		loader = ImageLoader.new()
		add_child(loader)
	_load_constants()


func _load_constants() -> void:
	if engine == null:
		return
	var hello := await engine.request("hello")
	if hello.get("ok", false):
		var info: Dictionary = hello["result"]
		if loader and loader.origin.is_empty():
			loader.origin = str(info.get("origin", ""))
		_data_root = str(info.get("dataRoot", ""))
	var reply := await engine.request("editor.constants")
	if reply.get("ok", false):
		_constants = reply["result"]
		if _data_root.is_empty():
			_data_root = str(_constants.get("dataRoot", ""))


func is_open() -> bool:
	return visible and not _kind.is_empty()


func is_busy() -> bool:
	return _busy


func current_kind() -> String:
	return _kind


func current_id() -> String:
	return _id


func open_scenario(scenario_id: String, note := "") -> void:
	await _open_with("editor.open", {"kind": "scenario", "id": scenario_id})
	_note_after_open("scenario", scenario_id, note)


func open_game(game_id: String, note := "") -> void:
	await _open_with("editor.open", {"kind": "game", "id": game_id})
	_note_after_open("game", game_id, note)


func _note_after_open(kind: String, id: String, note: String) -> void:
	if note.is_empty() or _kind != kind or _id != id or not visible:
		return
	_show_error(note)


func create_scenario() -> void:
	if _busy:
		return
	await _open_with("editor.create", {})
	library_changed.emit()


func clone_scenario(scenario: Variant) -> void:
	if _busy:
		return
	var id := str((scenario as Dictionary).get("id", "")) if scenario is Dictionary else str(scenario)
	await _open_with("editor.clone", {"id": id})
	library_changed.emit()


func open_map_editor(scenario_id := "") -> void:
	if not scenario_id.is_empty() and (_kind != "scenario" or _id != scenario_id or not visible):
		await open_scenario(scenario_id)
	if _kind == "scenario" and not _details.is_empty():
		_open_workshop()


func close_editor() -> void:
	if _kind.is_empty():
		_hide()
		return
	var unsaved := await _differs(true)
	if unsaved and not await EditorKit.ask(self, "Close the editor? The changes you have not saved will be lost."):
		return
	_hide()


func _open_with(method: String, args: Dictionary) -> void:
	_open_turn += 1
	var turn := _open_turn
	_error = ""
	_set_busy(true)
	var reply := await engine.request(method, args)
	_set_busy(false)
	if turn != _open_turn:
		return
	if not reply.get("ok", false):
		var message := str(reply.get("error", "Something went wrong."))
		_error = message
		if visible and not _kind.is_empty():
			_render_error()
		else:
			failed.emit(message)
		return
	_adopt_open(reply["result"])


func _adopt_open(pack: Dictionary) -> void:
	_stop_workshop()
	_kind = str(pack.get("kind", "scenario"))
	_id = str(pack.get("id", ""))
	_details = pack.get("details", {})
	_form = pack.get("form", {})
	_saved_form = _form.duplicate(true)
	_country_options = pack.get("countryOptions", [])
	_politics_badge = str(pack.get("politicsBadge", ""))
	_stats = pack.get("stats")
	_saved_stats = pack.get("savedStats")
	if _stats is Dictionary:
		_stats = (_stats as Dictionary).duplicate(true)
	_stats_failed = bool(pack.get("statsFailed", false))
	_error = str(pack.get("error", ""))
	_section = "overview"
	_prompt_section = "leader"
	_prompt_status = {}
	visible = true
	mouse_filter = Control.MOUSE_FILTER_STOP
	move_to_front()
	_fit()
	_render_all()


func _hide() -> void:
	_stop_workshop()
	_clear_panels()
	_kind = ""
	_id = ""
	_details = {}
	_form = {}
	_saved_form = {}
	_stats = null
	_saved_stats = null
	_stats_failed = false
	_error = ""
	_section = "overview"
	_prompt_section = "leader"
	_prompt_status = {}
	visible = false
	closed.emit()


func _set_busy(busy: bool) -> void:
	_busy = busy
	if _save_button and is_instance_valid(_save_button):
		_save_button.text = "Saving..." if busy else "Save"
	busy_changed.emit(busy)


func _record() -> Dictionary:
	var key := "scenario" if _kind == "scenario" else "game"
	var value: Variant = _details.get(key)
	return value if value is Dictionary else {}


func _world() -> Dictionary:
	var data: Variant = _details.get("data")
	if data is Dictionary and (data as Dictionary).get("world") is Dictionary:
		return (data as Dictionary)["world"]
	return {}


func _data_game() -> Dictionary:
	var data: Variant = _details.get("data")
	if data is Dictionary and (data as Dictionary).get("game") is Dictionary:
		return (data as Dictionary)["game"]
	return {}


func _accent() -> Color:
	return EditorKit.color_of(str(_record().get("accentColor", "")), Color("#a1a1aa"))


func _cover_url() -> String:
	if _kind == "scenario":
		return EditorKit.text_value(_record().get("coverImageUrl"))
	var own := EditorKit.text_value(_record().get("coverImageUrl"))
	if not own.is_empty():
		return own
	var scenario: Variant = _details.get("scenario")
	return EditorKit.text_value((scenario as Dictionary).get("coverImageUrl")) if scenario is Dictionary else ""


func _visible_sections() -> Array:
	return SCENARIO_SECTIONS if _kind == "scenario" else GAME_SECTIONS


func _build() -> void:
	_dim = ColorRect.new()
	_dim.color = Color(0, 0, 0, 0.62)
	_dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_dim.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(_dim)
	_dialog = PanelContainer.new()
	_dialog.add_theme_stylebox_override("panel", UI.box(EditorKit.PANEL, Color(1, 1, 1, 0.09), 22, 1, Vector4(1, 1, 1, 1)))
	_dialog.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(_dialog)
	var columns := HBoxContainer.new()
	columns.add_theme_constant_override("separation", 0)
	_dialog.add_child(columns)
	columns.add_child(_build_nav())
	columns.add_child(_build_main())
	_suggest_box = SuggestBox.new()
	add_child(_suggest_box)


func _build_nav() -> Control:
	var nav := PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = EditorKit.NAV
	style.border_color = Color(1, 1, 1, 0.08)
	style.border_width_right = 1
	style.corner_radius_top_left = 21
	style.corner_radius_bottom_left = 21
	style.content_margin_left = 14
	style.content_margin_right = 14
	style.content_margin_top = 18
	style.content_margin_bottom = 18
	style.anti_aliasing = true
	nav.add_theme_stylebox_override("panel", style)
	nav.custom_minimum_size.x = NAV_WIDTH
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 16)
	nav.add_child(column)
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 11)
	_nav_cover = RoundedImage.new(Vector2(50, 50), 12, COVER_BG, UI.ACCENT, 2)
	_nav_cover.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	head.add_child(_nav_cover)
	var titles := VBoxContainer.new()
	titles.add_theme_constant_override("separation", 2)
	titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	titles.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_nav_kicker = UI.label("SCENARIO EDITOR", 11, Color(1, 1, 1, 0.5), 700, "Arial", 1)
	titles.add_child(_nav_kicker)
	_nav_name = UI.label("", 16, UI.WHITE, 800, "Arial", 0)
	_nav_name.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	_nav_name.clip_text = true
	_nav_name.custom_minimum_size.x = 150
	_nav_name.mouse_filter = Control.MOUSE_FILTER_PASS
	titles.add_child(_nav_name)
	head.add_child(titles)
	column.add_child(head)
	var groups_scroll := ScrollContainer.new()
	groups_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	groups_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_nav_groups = VBoxContainer.new()
	_nav_groups.add_theme_constant_override("separation", 14)
	_nav_groups.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	groups_scroll.add_child(_nav_groups)
	column.add_child(groups_scroll)
	_nav_actions = VBoxContainer.new()
	_nav_actions.add_theme_constant_override("separation", 7)
	column.add_child(_nav_actions)
	return nav


func _build_main() -> Control:
	var main := VBoxContainer.new()
	main.add_theme_constant_override("separation", 0)
	main.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var header := MarginContainer.new()
	for side in [["margin_left", 22], ["margin_right", 22], ["margin_top", 18], ["margin_bottom", 16]]:
		header.add_theme_constant_override(side[0], side[1])
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 16)
	var titles := VBoxContainer.new()
	titles.add_theme_constant_override("separation", 4)
	titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_header_title = UI.label("", 22, UI.WHITE, 800, "Arial", -1)
	titles.add_child(_header_title)
	_header_blurb = UI.wrapped("", 13, Color(1, 1, 1, 0.55), 400)
	titles.add_child(_header_blurb)
	row.add_child(titles)
	var close := EditorKit.button("", "theme")
	close.icon = UI.icon("close", 15, EditorKit.BUTTON_INK)
	close.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
	close.custom_minimum_size = Vector2(38, 35)
	close.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	for state in ["normal", "hover", "pressed", "hover_pressed", "focus", "disabled"]:
		var box := close.get_theme_stylebox(state) as StyleBoxFlat
		if box:
			var copy := box.duplicate() as StyleBoxFlat
			copy.content_margin_left = 0
			copy.content_margin_right = 0
			close.add_theme_stylebox_override(state, copy)
	close.pressed.connect(close_editor)
	close.set_meta("close_button", true)
	row.add_child(close)
	header.add_child(row)
	main.add_child(header)
	var rule := ColorRect.new()
	rule.color = Color(1, 1, 1, 0.07)
	rule.custom_minimum_size.y = 1
	main.add_child(rule)
	_scroll = ScrollContainer.new()
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var margin := MarginContainer.new()
	margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for side in [["margin_left", 22], ["margin_right", 22], ["margin_top", 19], ["margin_bottom", 26]]:
		margin.add_theme_constant_override(side[0], side[1])
	var stack := VBoxContainer.new()
	stack.add_theme_constant_override("separation", 0)
	stack.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_content = VBoxContainer.new()
	_content.add_theme_constant_override("separation", 15)
	_content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	stack.add_child(_content)
	_error_box = PanelContainer.new()
	_error_box.add_theme_stylebox_override("panel", UI.box(Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.12), Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.34), 14, 1, Vector4(14, 13, 14, 13)))
	_error_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_error_label = UI.wrapped("", 14, EditorKit.ERROR_INK, 400)
	_error_box.add_child(_error_label)
	var error_gap := EditorKit.gap(6)
	error_gap.name = "ErrorGap"
	stack.add_child(error_gap)
	stack.add_child(_error_box)
	_error_box.visible = false
	margin.add_child(stack)
	_scroll.add_child(margin)
	main.add_child(_scroll)
	return main


func _fit() -> void:
	if not is_inside_tree():
		return
	var view := get_viewport_rect().size
	var width := minf(DIALOG_MAX.x, view.x - 40.0)
	var height := minf(DIALOG_MAX.y, view.y - 40.0)
	_dialog.size = Vector2(width, height)
	_dialog.custom_minimum_size = Vector2(width, height)
	_dialog.position = ((view - Vector2(width, height)) * 0.5).round()


func _render_all() -> void:
	_render_nav()
	_render_header()
	_render_section()
	_render_error()


func _render_nav() -> void:
	var accent := _accent()
	_nav_cover.set_border(accent)
	_nav_cover.set_texture(null)
	var url := _cover_url()
	if not url.is_empty() and loader:
		var target := _nav_cover
		loader.fetch(url, func(texture: Texture2D) -> void:
			if is_instance_valid(target) and _cover_url() == url:
				target.set_texture(texture))
	var who := "Scenario" if _kind == "scenario" else "Game"
	_nav_kicker.text = ("%s Editor" % who).to_upper()
	_nav_name.text = str(_record().get("name", ""))
	_nav_name.tooltip_text = _nav_name.text
	EditorKit.clear(_nav_groups)
	var visible_sections := _visible_sections()
	for group in SECTION_GROUPS:
		var keys: Array = (group[1] as Array).filter(func(key: String) -> bool: return visible_sections.has(key))
		if keys.is_empty():
			continue
		var block := VBoxContainer.new()
		block.add_theme_constant_override("separation", 2)
		var label_box := MarginContainer.new()
		label_box.add_theme_constant_override("margin_left", 11)
		label_box.add_theme_constant_override("margin_bottom", 4)
		label_box.add_child(UI.label(str(group[0]).to_upper(), 10, Color(1, 1, 1, 0.4), 700, "Arial", 1))
		block.add_child(label_box)
		for key in keys:
			block.add_child(_nav_button(key))
		_nav_groups.add_child(block)
	EditorKit.clear(_nav_actions)
	_save_button = EditorKit.accent_button("Saving..." if _busy else "Save", accent)
	_save_button.custom_minimum_size.y = 38
	_save_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_save_button.pressed.connect(_save)
	_nav_actions.add_child(_save_button)
	if _kind == "scenario":
		var map := _wide_action("🗺️ Open Map Editor", Color(1, 1, 1, 0.08), Color(1, 1, 1, 0.12), EditorKit.BUTTON_INK)
		map.pressed.connect(_open_workshop)
		_nav_actions.add_child(map)
		var origin: Variant = _record().get("hubOrigin")
		if origin is Dictionary and not str((origin as Dictionary).get("editedAt", "")).is_empty():
			var suggest := _wide_action("Suggest changes", Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.18), Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.45), UI.WHITE)
			suggest.tooltip_text = "Send your changes to this community scenario's author, who can accept or reject each one."
			suggest.pressed.connect(_suggest_changes)
			_nav_actions.add_child(suggest)
	if bool(_record().get("canDelete", false)):
		var delete := _wide_action("Delete", EditorKit.DANGER_BG, EditorKit.DANGER_BORDER, EditorKit.DANGER_INK)
		delete.pressed.connect(_delete)
		_nav_actions.add_child(delete)


func _wide_action(text: String, bg: Color, border: Color, ink: Color) -> Button:
	var node := EditorKit.button(text, "theme")
	var normal := UI.box(bg, border, 9, 1, Vector4(16, 4, 16, 4))
	var hover := UI.box(Color(bg.r, bg.g, bg.b, minf(1.0, bg.a + 0.05)), Color(border.r, border.g, border.b, minf(1.0, border.a + 0.1)), 9, 1, Vector4(16, 4, 16, 4))
	for state in [["normal", normal], ["hover", hover], ["pressed", hover], ["hover_pressed", hover], ["focus", normal], ["disabled", normal]]:
		node.add_theme_stylebox_override(state[0], state[1])
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		node.add_theme_color_override(name, ink)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


func _nav_button(key: String) -> Button:
	var active := key == _section
	var node := Button.new()
	node.focus_mode = Control.FOCUS_NONE
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	node.custom_minimum_size.y = 37
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var normal := UI.box(Color(1, 1, 1, 0.1) if active else Color(0, 0, 0, 0), Color(1, 1, 1, 0.18) if active else Color(0, 0, 0, 0), 9, 1, Vector4(11, 0, 11, 0))
	var hover := UI.box(Color(1, 1, 1, 0.1) if active else Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.18) if active else Color(0, 0, 0, 0), 9, 1, Vector4(11, 0, 11, 0))
	for state in [["normal", normal], ["hover", hover], ["pressed", hover], ["hover_pressed", hover], ["focus", normal]]:
		node.add_theme_stylebox_override(state[0], state[1])
	var ink := UI.WHITE if active else NAV_INK
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	row.offset_left = 11
	row.offset_right = -9
	var glyph := TextureRect.new()
	glyph.texture = EditorKit.svg_icon(_section_svg(key), 17, ink)
	glyph.custom_minimum_size = Vector2(17, 17)
	glyph.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
	glyph.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	glyph.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.add_child(glyph)
	var caption := UI.label(str(SECTION_LABELS.get(key, key)), 13, ink, 700 if active else 600)
	caption.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	caption.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(caption)
	if key == "politics" and not _politics_badge.is_empty():
		var badge := EditorKit.badge(_politics_badge, Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.16), Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.28), EditorKit.WARN_INK, 9)
		row.add_child(badge)
	node.add_child(row)
	node.pressed.connect(func() -> void: _go_section(key))
	return node


func _section_svg(key: String) -> String:
	return "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'>%s</svg>" % str(SECTION_ICONS.get(key, "<circle cx='12' cy='12' r='3'/>"))


func _go_section(key: String) -> void:
	if key == _section:
		return
	_section = key
	_render_nav()
	_render_header()
	_render_section()
	_scroll.scroll_vertical = 0


func _render_header() -> void:
	_header_title.text = str(SECTION_LABELS.get(_section, _section))
	var blurb := str(SECTION_BLURBS.get(_section, ""))
	_header_blurb.text = blurb
	_header_blurb.visible = not blurb.is_empty()


func _render_error() -> void:
	_error_label.text = _error
	_error_box.visible = not _error.is_empty()


func _show_error(message: String) -> void:
	_error = message
	_render_error()


func _clear_panels() -> void:
	_panels.clear()
	if _suggest_box:
		_suggest_box.visible = false
	EditorKit.clear(_content)


func _render_section() -> void:
	_clear_panels()
	_content.add_theme_constant_override("separation", 15)
	match _section:
		"overview":
			_render_overview()
		"world":
			_render_world()
		"history":
			_render_history()
		"fronts":
			_render_fronts()
		"politics":
			_render_politics()
		"stats":
			_render_stats()
		"features":
			_render_features()
		"prompts":
			_render_prompts()
		"assets":
			_render_assets()
		"music":
			_render_music()
		"bundles":
			_render_bundles()


func _set_form(field: String, value: Variant) -> void:
	_form[field] = value


func _field_line(label_text: String, field: String, placeholder := "") -> VBoxContainer:
	var edit := EditorKit.line(str(_form.get(field, "")), placeholder, func(text: String) -> void: _set_form(field, text))
	return EditorKit.field(label_text, edit)


func _field_area(label_text: String, field: String, min_height: float) -> VBoxContainer:
	var edit := EditorKit.area(str(_form.get(field, "")), min_height, func(text: String) -> void: _set_form(field, text))
	return EditorKit.field(label_text, edit)


func _two(left: Control, right: Control) -> HBoxContainer:
	var row := EditorKit.row(13)
	left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	right.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	left.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	right.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	row.add_child(left)
	row.add_child(right)
	return row


func _render_overview() -> void:
	if _kind == "scenario":
		var card := ScenarioCommunityCard.new()
		_content.add_child(card)
		card.setup(engine, {"scenario_id": _id, "host": self, "before_suggest": _before_suggest})
		card.changed.connect(func() -> void:
			_reload_details()
			library_changed.emit())
		card.update_requested.connect(func(scenario_id: String, post_id: int) -> void: scenario_update_requested.emit(scenario_id, post_id))
		card.refresh()
	var on_card := EditorKit.card("On its card")
	var column: VBoxContainer = on_card[1]
	var fields := VBoxContainer.new()
	fields.add_theme_constant_override("separation", 13)
	fields.add_child(_field_line("Name", "name"))
	var accent := EditorKit.color_button(str(_form.get("accentColor", "")), func(hex: String) -> void: _set_form("accentColor", hex), 50)
	fields.add_child(_two(_field_line("Eyebrow", "eyebrow"), EditorKit.field("Accent", accent)))
	fields.add_child(_field_line("Subtitle", "subtitle"))
	fields.add_child(_field_area("Description", "description", 96))
	column.add_child(fields)
	_content.add_child(on_card[0])
	var headline := EditorKit.card("Its headline")
	var head_fields := VBoxContainer.new()
	head_fields.add_theme_constant_override("separation", 13)
	head_fields.add_child(_field_line("Hero Title", "heroTitle"))
	head_fields.add_child(_field_area("Hero Subtitle", "heroSubtitle", 80))
	(headline[1] as VBoxContainer).add_child(head_fields)
	_content.add_child(headline[0])


func _offered_country(value: String) -> bool:
	var wanted := value.strip_edges()
	if wanted.is_empty() or _country_options.is_empty():
		return true
	for option in _country_options:
		if option is Dictionary and (str(option.get("code", "")) == wanted or str(option.get("name", "")) == wanted):
			return true
	return false


func _suggest_line(value: String, options: Array, placeholder: String, on_change: Callable) -> LineEdit:
	var edit := EditorKit.line(value, placeholder, on_change)
	_suggest_box.attach(edit, options, on_change)
	return edit


func _render_world() -> void:
	var begins := EditorKit.card("Where play begins")
	var grid := EditorKit.grid(2, 13)
	var country_column := VBoxContainer.new()
	country_column.add_theme_constant_override("separation", 7)
	country_column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	country_column.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	country_column.add_child(EditorKit.field_label("Player Country"))
	var warning := UI.wrapped("No country or faction by this name is on this map, so the player would start with nothing. Pick one from the list.", 12, EditorKit.WARN_INK, 400)
	var options: Array = []
	for option in _country_options:
		if option is Dictionary:
			var code := str(option.get("code", ""))
			var name := str(option.get("name", ""))
			options.append([code, name if name != code else ""])
	var country := _suggest_line(str(_form.get("country", "")), options, "", func(text: String) -> void:
		_set_form("country", text)
		warning.visible = not _offered_country(text))
	country_column.add_child(country)
	warning.visible = not _offered_country(str(_form.get("country", "")))
	country_column.add_child(warning)
	grid.add_child(country_column)
	var date := EditorKit.line(str(_form.get("gameDate", "")), DATE_PLACEHOLDER, func(text: String) -> void: _set_form("gameDate", text))
	date.tooltip_text = DATE_TITLE
	var date_field := EditorKit.field("Game Date", date)
	date_field.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	grid.add_child(date_field)
	var language := _field_line("Language", "language")
	language.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	grid.add_child(language)
	(begins[1] as VBoxContainer).add_child(grid)
	_content.add_child(begins[0])
	if _kind == "scenario":
		var troops := EditorKit.card("Deployable Troop Types")
		var chips := EditorKit.flow(8)
		_fill_troop_chips(chips)
		(troops[1] as VBoxContainer).add_child(chips)
		(troops[1] as VBoxContainer).add_child(EditorKit.hint("Uncheck types that don't fit the era — e.g. no Air Force in 1200. Players can only deploy the checked types.", 12, Color(1, 1, 1, 0.5)))
		_content.add_child(troops[0])
	var story := EditorKit.card("The story so far")
	var story_fields := VBoxContainer.new()
	story_fields.add_theme_constant_override("separation", 13)
	story_fields.add_child(_field_area("World Before Round One", "startingTimelineText", 128))
	story_fields.add_child(_field_area("Simulation Rules", "simulationRules", 128))
	(story[1] as VBoxContainer).add_child(story_fields)
	_content.add_child(story[0])
	var labels := EditorKit.card("Country labels on the map")
	var label_row := EditorKit.row(13)
	var fonts: Array = []
	for font_name in _constants.get("labelFonts", []):
		fonts.append([str(font_name), ""])
	var font_edit := _suggest_line(str(_form.get("labelFont", "")), fonts, "Georgia (default)", func(text: String) -> void: _set_form("labelFont", text))
	var font_field := EditorKit.field("Country Label Font", font_edit)
	font_field.size_flags_stretch_ratio = 2.0
	label_row.add_child(font_field)
	var text_hex := str(_form.get("labelTextColor", ""))
	var text_color := EditorKit.color_button(text_hex if _is_hex(text_hex) else "#ffffff", func(hex: String) -> void: _set_form("labelTextColor", hex), 38)
	var text_field := EditorKit.field("Label Letter Color", text_color)
	label_row.add_child(text_field)
	var halo_hex := str(_form.get("labelHaloColor", ""))
	var halo_color := EditorKit.color_button(halo_hex if _is_hex(halo_hex) else "#000000", func(hex: String) -> void: _set_form("labelHaloColor", hex), 38)
	var halo_field := EditorKit.field("Label Border Color", halo_color)
	label_row.add_child(halo_field)
	(labels[1] as VBoxContainer).add_child(label_row)
	_content.add_child(labels[0])


func _fill_troop_chips(chips: HFlowContainer) -> void:
	EditorKit.clear(chips)
	var chosen: Array = _form.get("allowedUnitTypes", []) if _form.get("allowedUnitTypes") is Array else []
	for unit_type in UNIT_TYPES:
		var checked := chosen.has(unit_type)
		var chip := EditorKit.button(("✓ " if checked else "") + str(UNIT_TYPE_LABELS.get(unit_type, unit_type)), "chip_on" if checked else "chip")
		chip.pressed.connect(func() -> void:
			var current: Array = _form.get("allowedUnitTypes", []) if _form.get("allowedUnitTypes") is Array else []
			var next: Array = []
			for candidate in UNIT_TYPES:
				var on := current.has(candidate)
				if candidate == unit_type:
					on = not on
				if on:
					next.append(candidate)
			_set_form("allowedUnitTypes", next)
			_fill_troop_chips.call_deferred(chips))
		chips.add_child(chip)


func _is_hex(value: String) -> bool:
	return RegEx.create_from_string("^#[0-9a-fA-F]{6}$").search(value) != null


func _props(extra := {}) -> Dictionary:
	var world := _world()
	var history: Variant = world.get("simulationHistory")
	var out := {
		"kind": _kind,
		"details": _details,
		"form": _form,
		"gameDate": str(_form.get("gameDate", "")),
		"currentDate": str(_form.get("gameDate", "")),
		"warSettings": _form.get("warSettings"),
		"scenarioFeatures": _form.get("features") if _kind == "scenario" else _form.get("scenarioFeatures"),
		"firstSkipAhead": _kind == "scenario" or not (history is Array and (history as Array).size() > 0),
		"host": self,
	}
	for key in extra:
		out[key] = extra[key]
	return out


func _host(panel: Control, extra: Dictionary, on_value := Callable()) -> void:
	panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_content.add_child(panel)
	_panels.append({"panel": panel, "extra": extra})
	if panel.has_signal("details_changed"):
		panel.connect("details_changed", _on_panel_details)
	if on_value.is_valid() and panel.has_signal("value_changed"):
		panel.connect("value_changed", on_value)
	panel.call("setup", engine, _props(extra))


func _update_panels() -> void:
	for entry in _panels:
		var panel: Variant = entry.get("panel")
		if panel is Control and is_instance_valid(panel) and (panel as Control).has_method("update_props"):
			var extra: Dictionary = entry.get("extra", {})
			if extra.has("value_field"):
				extra["value"] = _form.get(str(extra["value_field"]))
			if extra.has("value_stats"):
				extra["value"] = _stats
			(panel as Control).call("update_props", _props(extra))


func _on_panel_details(details: Dictionary) -> void:
	var took := details is Dictionary and not details.is_empty()
	if took:
		_details = details
	_update_panels()
	_render_nav_identity()
	_reload_details(not took)
	library_changed.emit()


func _render_nav_identity() -> void:
	_nav_name.text = str(_record().get("name", ""))
	_nav_cover.set_border(_accent())


func _reload_details(take_details := true) -> void:
	if _kind.is_empty():
		return
	if _reloading:
		_reload_again = true
		_reload_take = _reload_take or take_details
		return
	_reloading = true
	_reload_turn += 1
	var turn := _reload_turn
	var kind := _kind
	var id := _id
	var reply := await engine.request("editor.details", {"kind": kind, "id": id})
	_reloading = false
	if turn == _reload_turn and kind == _kind and id == _id and reply.get("ok", false):
		var pack: Dictionary = reply["result"]
		_saved_form = pack.get("form", _saved_form)
		_country_options = pack.get("countryOptions", _country_options)
		var badge := str(pack.get("politicsBadge", ""))
		var badge_changed := badge != _politics_badge
		_politics_badge = badge
		if take_details:
			_details = pack.get("details", _details)
			_update_panels()
		if badge_changed or take_details:
			_render_nav()
		else:
			_render_nav_identity()
	if _reload_again:
		var again_take := _reload_take
		_reload_again = false
		_reload_take = false
		_reload_details(again_take)


func _render_history() -> void:
	_content.add_theme_constant_override("separation", 0)
	_host(EditorHistoryPanel.new(), {})


func _render_fronts() -> void:
	_content.add_theme_constant_override("separation", 0)
	_host(EditorWarSettings.new(), {"value": _form.get("warSettings"), "value_field": "warSettings"}, func(value: Variant) -> void:
		_set_form("warSettings", value)
		_update_panels())
	_host(EditorMilitaryPanel.new(), {})
	_host(EditorFrontsPanel.new(), {})


func _render_politics() -> void:
	_content.add_theme_constant_override("separation", 0)
	_host(EditorPoliticalGeneration.new(), {})
	_host(EditorPoliticalAuthoring.new(), {})
	_host(EditorInstitutionAuthoring.new(), {})


func _render_stats() -> void:
	var parts := EditorKit.soft_card(0, 18)
	var column: VBoxContainer = parts[1]
	column.add_child(UI.label("National Stats", 15, Color(1, 1, 1, 0.92), 800))
	column.add_child(EditorKit.gap(3))
	column.add_child(EditorKit.hint("Define the entire National Stats sheet for this scenario. Sections, values, units, order, icons, colours and AI guidance are scenario data and travel with exports.", 11, Color(1, 1, 1, 0.46)))
	column.add_child(EditorKit.gap(13))
	_content.add_child(parts[0])
	var sheet := EditorStatsSheet.new()
	sheet.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.add_child(sheet)
	_panels.append({"panel": sheet, "extra": {"value": _stats, "value_stats": true}})
	sheet.value_changed.connect(func(value: Variant) -> void: _stats = value)
	sheet.setup(engine, _props({"value": _stats}))


func _render_features() -> void:
	_host(EditorFeaturesSection.new(), {"value": _form.get("features"), "value_field": "features"}, func(value: Variant) -> void: _set_form("features", value))


func _render_music() -> void:
	_content.add_theme_constant_override("separation", 15)
	_host(EditorMusicPanel.new(), {"value": _form.get("music"), "value_field": "music"}, func(value: Variant) -> void: _set_form("music", value))


func _prompt_catalog_ready() -> void:
	if not _prompt_catalog.is_empty():
		return
	var reply := await engine.request("editor.prompts.catalog")
	if reply.get("ok", false):
		_prompt_catalog = reply["result"].get("sections", [])


func _prompt_section_entry() -> Dictionary:
	for section in _prompt_catalog:
		if section is Dictionary and str(section.get("key", "")) == _prompt_section:
			return section
	return _prompt_catalog[0] if not _prompt_catalog.is_empty() and _prompt_catalog[0] is Dictionary else {}


func _prompt_edits(section: Dictionary) -> Dictionary:
	var prompts: Dictionary = _form.get("prompts", {}) if _form.get("prompts") is Dictionary else {}
	var guidance: Dictionary = prompts.get("guidance", {}) if prompts.get("guidance") is Dictionary else {}
	var key := str(section.get("key", ""))
	if str(section.get("type", "")) == "root":
		return guidance.get(key, {}) if guidance.get(key) is Dictionary else {}
	var tasks: Dictionary = guidance.get("tasks", {}) if guidance.get("tasks") is Dictionary else {}
	return tasks.get(key, {}) if tasks.get(key) is Dictionary else {}


func _prompt_edited(section: Dictionary, segment_id: String) -> bool:
	var edits := _prompt_edits(section)
	if not edits.get(segment_id) is String:
		return false
	var text := str(edits[segment_id]).strip_edges()
	var defaults: Dictionary = section.get("defaults", {})
	var english: Dictionary = section.get("englishDefaults", {})
	return text != str(defaults.get(segment_id, "")).strip_edges() and text != str(english.get(segment_id, "")).strip_edges()


func _change_prompt(section: Dictionary, segment_id: Variant, value: Variant) -> void:
	var prompts: Dictionary = (_form.get("prompts", {}) as Dictionary).duplicate(true) if _form.get("prompts") is Dictionary else {}
	var guidance: Dictionary = prompts.get("guidance", {"advisor": {}, "leader": {}, "tasks": {}}) if prompts.get("guidance") is Dictionary else {"advisor": {}, "leader": {}, "tasks": {}}
	var key := str(section.get("key", ""))
	var root := str(section.get("type", "")) == "root"
	var tasks: Dictionary = guidance.get("tasks", {}) if guidance.get("tasks") is Dictionary else {}
	var bucket: Dictionary = (guidance.get(key, {}) if guidance.get(key) is Dictionary else {}) if root else (tasks.get(key, {}) if tasks.get(key) is Dictionary else {})
	var next_bucket := {}
	if segment_id != null:
		next_bucket = bucket.duplicate()
		if value == null:
			next_bucket.erase(str(segment_id))
		else:
			next_bucket[str(segment_id)] = value
	if root:
		guidance[key] = next_bucket
	else:
		tasks[key] = next_bucket
		guidance["tasks"] = tasks
	prompts["guidance"] = guidance
	_form["prompts"] = prompts


func _render_prompts() -> void:
	await _prompt_catalog_ready()
	if _section != "prompts" or not is_instance_valid(_content):
		return
	var outer := EditorKit.soft_card(0, 18)
	var column: VBoxContainer = outer[1]
	column.add_theme_constant_override("separation", 0)
	_content.add_child(outer[0])
	var transfer := _kind == "scenario"
	if transfer:
		var head := EditorKit.row(7)
		var texts := VBoxContainer.new()
		texts.add_theme_constant_override("separation", 2)
		texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		texts.add_child(UI.label("Prompt pack", 13, Color(1, 1, 1, 0.9), 700))
		texts.add_child(EditorKit.hint("Move every scenario-authored prompt passage at once. Tooling and output contracts stay with the app.", 12, Color(1, 1, 1, 0.48)))
		head.add_child(texts)
		var export_button := EditorKit.button("Export all prompts", "theme")
		export_button.custom_minimum_size.y = 32
		export_button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		export_button.pressed.connect(_export_prompts)
		head.add_child(export_button)
		var import_button := EditorKit.button("Import all prompts", "theme")
		import_button.custom_minimum_size.y = 32
		import_button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		import_button.pressed.connect(_import_prompts)
		head.add_child(import_button)
		column.add_child(head)
		column.add_child(EditorKit.gap(14))
	if not _prompt_status.is_empty():
		var failed_status := bool(_prompt_status.get("error", false))
		var status := PanelContainer.new()
		status.add_theme_stylebox_override("panel", UI.box(Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.1) if failed_status else Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.08), Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.28) if failed_status else Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.2), 10, 1, Vector4(10, 8, 10, 8)))
		status.add_child(UI.wrapped(str(_prompt_status.get("text", "")), 12, Color("#fca5a5") if failed_status else EditorKit.OK_INK, 400))
		column.add_child(status)
		column.add_child(EditorKit.gap(13))
	if transfer:
		column.add_child(EditorKit.gap(2))
		column.add_child(EditorKit.rule())
		column.add_child(EditorKit.gap(10))
		column.add_child(UI.label("PROMPT PASSAGES", 11, Color(1, 1, 1, 0.42), 700, "Arial", 1))
		column.add_child(EditorKit.gap(12))
	var tabs := EditorKit.flow(7)
	var current := _prompt_section_entry()
	for section in _prompt_catalog:
		if not section is Dictionary:
			continue
		var key := str(section.get("key", ""))
		var tab := EditorKit.button(str(section.get("label", key)), "tab_on" if key == str(current.get("key", "")) else "tab")
		tab.pressed.connect(func() -> void:
			_prompt_section = key
			_render_section())
		tabs.add_child(tab)
	column.add_child(tabs)
	column.add_child(EditorKit.gap(14))
	column.add_child(EditorKit.hint(str(current.get("description", "")), 13, Color(1, 1, 1, 0.58)))
	column.add_child(EditorKit.gap(8))
	var info := PanelContainer.new()
	info.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.03), Color(1, 1, 1, 0.11), 12, 1, Vector4(11, 9, 11, 9)))
	info.add_child(UI.wrapped(PROMPT_INFO, 12, Color(1, 1, 1, 0.62), 400))
	column.add_child(info)
	column.add_child(EditorKit.gap(14))
	var segments_box := VBoxContainer.new()
	segments_box.add_theme_constant_override("separation", 14)
	var reset_all := EditorKit.button("Reset every passage in this section", "small")
	reset_all.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	var reset_all_holder := VBoxContainer.new()
	reset_all_holder.add_theme_constant_override("separation", 0)
	reset_all_holder.add_child(EditorKit.gap(14))
	reset_all_holder.add_child(reset_all)
	var refresh_reset_all := func() -> void:
		var count := 0
		for segment in current.get("segments", []):
			if segment is Dictionary and _prompt_edited(current, str(segment.get("id", ""))):
				count += 1
		reset_all_holder.visible = count > 0
	reset_all.pressed.connect(func() -> void:
		_change_prompt(current, null, null)
		_render_section())
	for segment in current.get("segments", []):
		if not segment is Dictionary:
			continue
		var segment_id := str(segment.get("id", ""))
		var label_text := str(segment.get("label", ""))
		var block := VBoxContainer.new()
		block.add_theme_constant_override("separation", 0)
		var label_row := EditorKit.row(8)
		var label_box := HBoxContainer.new()
		label_box.add_theme_constant_override("separation", 6)
		label_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		label_box.add_child(UI.label(label_text.to_upper(), 12, EditorKit.LABEL_INK, 600, "Arial", 1))
		var marker := UI.label("· edited", 12, Color("#e4e4e7"), 600)
		label_box.add_child(marker)
		label_row.add_child(label_box)
		var reset := EditorKit.button("Reset to default", "small")
		reset.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		label_row.add_child(reset)
		block.add_child(label_row)
		var hint_text := str(segment.get("hint", ""))
		if not hint_text.is_empty():
			block.add_child(EditorKit.gap(4))
			block.add_child(EditorKit.hint(hint_text, 12, Color(1, 1, 1, 0.45)))
			block.add_child(EditorKit.gap(6))
		else:
			block.add_child(EditorKit.gap(7))
		var edits := _prompt_edits(current)
		var defaults: Dictionary = current.get("defaults", {})
		var value := str(edits[segment_id]) if edits.get(segment_id) is String else str(defaults.get(segment_id, ""))
		var area := EditorKit.area(value, 112)
		area.tooltip_text = "%s: %s" % [str(current.get("label", "")), label_text]
		var mark_state := func() -> void:
			var edited := _prompt_edited(current, segment_id)
			marker.visible = edited
			reset.visible = edited
			refresh_reset_all.call()
		area.text_changed.connect(func() -> void:
			_change_prompt(current, segment_id, area.text)
			mark_state.call())
		reset.pressed.connect(func() -> void:
			_change_prompt(current, segment_id, null)
			_render_section())
		block.add_child(area)
		segments_box.add_child(block)
		mark_state.call()
	column.add_child(segments_box)
	column.add_child(reset_all_holder)
	refresh_reset_all.call()


func _export_prompts() -> void:
	if _kind != "scenario" or _details.is_empty():
		return
	var target := await EditorKit.pick_file(self, true, "%s-prompts.json" % _id, PackedStringArray(["*.json ; JSON"]))
	if target.is_empty():
		return
	_error = ""
	_render_error()
	var reply := await engine.request("editor.prompts.export", {"id": _id, "prompts": _form.get("prompts", {}), "path": target})
	if not reply.get("ok", false):
		_show_error(str(reply.get("error", "")))
	_prompt_status = {"error": false, "text": "Exported every editable prompt passage. Technical/tooling prompt text stays app-owned and is intentionally excluded."}
	if _section == "prompts":
		_render_section()


func _import_prompts() -> void:
	if _kind != "scenario":
		return
	var source := await EditorKit.pick_file(self, false, "", PackedStringArray(["*.json ; JSON"]))
	if source.is_empty():
		return
	var reply := await engine.request("editor.prompts.import", {"path": source})
	if reply.get("ok", false):
		_form["prompts"] = reply["result"].get("prompts", _form.get("prompts", {}))
		_prompt_status = {"error": false, "text": "Imported %s. Save the scenario to persist these prompt edits." % str(reply["result"].get("name", source.get_file()))}
	else:
		_prompt_status = {"error": true, "text": "Import failed: %s" % str(reply.get("error", ""))}
	if _section == "prompts":
		_render_section()


func _render_assets() -> void:
	var outer := EditorKit.soft_card(11, 18)
	var column: VBoxContainer = outer[1]
	_content.add_child(outer[0])
	var status: Dictionary = _details.get("assetStatus", {}) if _details.get("assetStatus") is Dictionary else {}
	var scenario_cover := ""
	var scenario_record: Variant = _details.get("scenario")
	if scenario_record is Dictionary:
		scenario_cover = EditorKit.text_value((scenario_record as Dictionary).get("coverImageUrl"))
	for entry in (SCENARIO_ASSETS if _kind == "scenario" else GAME_ASSETS):
		var asset_key := str(entry[0])
		var label_text := str(entry[1])
		var cover := asset_key == "cover"
		var own := bool(status.get(asset_key, false))
		var preview_url := ""
		if cover:
			preview_url = scenario_cover if _kind == "scenario" else _cover_url()
		var fallback := ""
		if _kind == "scenario":
			fallback = "Displayed on this scenario card." if cover else "Using default/base asset"
		else:
			fallback = "Using the linked scenario cover image." if not scenario_cover.is_empty() else "No custom cover image."
		var state_text := fallback
		if own:
			state_text = ("Stored in this scenario." if _kind == "scenario" else "Stored in this session.") if cover else "Stored in this scenario bundle"
		var row_box := PanelContainer.new()
		row_box.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.03), Color(1, 1, 1, 0.08), 14, 1, Vector4(12, 12, 12, 12)))
		var row := EditorKit.row(12)
		var texts := VBoxContainer.new()
		texts.add_theme_constant_override("separation", 2)
		texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		texts.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		texts.add_child(UI.label(label_text, 14, UI.WHITE, 600))
		texts.add_child(UI.wrapped(state_text, 12, Color(1, 1, 1, 0.58), 400))
		if cover and not preview_url.is_empty():
			texts.add_child(EditorKit.gap(9))
			var image := RoundedImage.new(Vector2(138, 77), 12, COVER_BG, Color(1, 1, 1, 0.08), 1)
			image.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
			texts.add_child(image)
			if loader:
				loader.fetch(preview_url, func(texture: Texture2D) -> void:
					if is_instance_valid(image):
						image.set_texture(texture))
		row.add_child(texts)
		var buttons := HBoxContainer.new()
		buttons.add_theme_constant_override("separation", 7)
		buttons.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		var upload := EditorKit.button("Upload", "theme")
		upload.pressed.connect(func() -> void: _upload_asset(asset_key))
		buttons.add_child(upload)
		var reset := EditorKit.button("Reset", "quiet")
		var reset_ink := Color(1, 1, 1, 0.92) if own else Color(1, 1, 1, 0.35)
		for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color", "font_disabled_color"]:
			reset.add_theme_color_override(name, reset_ink)
		reset.disabled = not own
		reset.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if own else Control.CURSOR_ARROW
		reset.pressed.connect(func() -> void: _clear_asset(asset_key))
		buttons.add_child(reset)
		row.add_child(buttons)
		row_box.add_child(row)
		column.add_child(row_box)


func _upload_asset(asset_key: String) -> void:
	if _kind.is_empty() or _details.is_empty():
		return
	var source := await EditorKit.pick_file(self, false, "", PackedStringArray([str(ASSET_FILTERS.get(asset_key, "*.* ; Files"))]))
	if source.is_empty():
		return
	_error = ""
	_render_error()
	_set_busy(true)
	var reply := await engine.request("editor.asset.upload", {"kind": _kind, "id": _id, "assetKey": asset_key, "path": source})
	_set_busy(false)
	if not reply.get("ok", false):
		_show_error(str(reply.get("error", "")))
		return
	_adopt_details_only(reply["result"])


func _clear_asset(asset_key: String) -> void:
	var status: Dictionary = _details.get("assetStatus", {}) if _details.get("assetStatus") is Dictionary else {}
	if _kind.is_empty() or not bool(status.get(asset_key, false)):
		return
	_error = ""
	_render_error()
	_set_busy(true)
	var reply := await engine.request("editor.asset.clear", {"kind": _kind, "id": _id, "assetKey": asset_key})
	_set_busy(false)
	if not reply.get("ok", false):
		_show_error(str(reply.get("error", "")))
		return
	_adopt_details_only(reply["result"])


func _on_engine_event(event_name: String, payload: Variant) -> void:
	if event_name != "editor.basemap" or not payload is Dictionary:
		return
	var info: Dictionary = payload
	if _kind != "scenario" or str(info.get("id", "")) != _id:
		return
	if bool(info.get("restored", false)) and info.get("pack") is Dictionary:
		_adopt_details_only(info["pack"])
	else:
		_show_error(str(info.get("error", "")))


func _adopt_details_only(pack: Dictionary) -> void:
	_details = pack.get("details", _details)
	_saved_form = pack.get("form", _saved_form)
	_country_options = pack.get("countryOptions", _country_options)
	_politics_badge = str(pack.get("politicsBadge", _politics_badge))
	library_changed.emit()
	_render_nav()
	if _section in ["assets", "overview", "world", "prompts", "bundles"]:
		_render_section()
	else:
		_update_panels()


func _render_bundles() -> void:
	var outer := EditorKit.soft_card(0, 18)
	var column: VBoxContainer = outer[1]
	_content.add_child(outer[0])
	var intro := RichTextLabel.new()
	intro.bbcode_enabled = true
	intro.fit_content = true
	intro.scroll_active = false
	intro.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	intro.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	intro.mouse_filter = Control.MOUSE_FILTER_IGNORE
	intro.add_theme_font_override("normal_font", UI.font(400))
	intro.add_theme_font_override("bold_font", UI.font(700))
	intro.add_theme_font_size_override("normal_font_size", 13)
	intro.add_theme_font_size_override("bold_font_size", 13)
	intro.add_theme_color_override("default_color", Color(1, 1, 1, 0.58))
	intro.add_theme_constant_override("line_separation", 4)
	intro.text = "Download the scenario as one self-contained file — custom map geometry, cities and basemap all travel with it, ready to share or re-import. The [b].zip[/b] carries a custom basemap as a real image file (smaller, and the form the community hub expects); the [b]JSON[/b] packs everything into one text file."
	column.add_child(intro)
	column.add_child(EditorKit.gap(14))
	var license := PanelContainer.new()
	license.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.16), 10, 1, Vector4(11, 9, 11, 9)))
	var license_column := VBoxContainer.new()
	license_column.add_theme_constant_override("separation", 3)
	license_column.add_child(UI.wrapped("A scenario you post or share in any way is released under CC BY 4.0.", 13, Color(1, 1, 1, 0.88), 700))
	license_column.add_child(UI.label("The file says so.", 13, Color(1, 1, 1, 0.88)))
	var link := LinkButton.new()
	link.text = "About CC BY 4.0 ↗"
	link.underline = LinkButton.UNDERLINE_MODE_ALWAYS
	link.focus_mode = Control.FOCUS_NONE
	link.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	link.add_theme_font_override("font", UI.font(400))
	link.add_theme_font_size_override("font_size", 13)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		link.add_theme_color_override(name, Color(1, 1, 1, 0.88))
	var url := str(_constants.get("licenseUrl", LICENSE_URL_FALLBACK))
	link.pressed.connect(func() -> void: OS.shell_open(url))
	license_column.add_child(link)
	license.add_child(license_column)
	column.add_child(license)
	column.add_child(EditorKit.gap(14))
	var buttons := EditorKit.flow(9)
	var zip := EditorKit.button("Download .zip", "theme")
	zip.pressed.connect(func() -> void: _export_bundle("zip"))
	buttons.add_child(zip)
	var json := EditorKit.button("Download JSON", "theme")
	json.pressed.connect(func() -> void: _export_bundle("json"))
	buttons.add_child(json)
	column.add_child(buttons)


func _export_bundle(format: String) -> void:
	if _kind != "scenario" or _details.is_empty():
		return
	var name := "%s-scenario.%s" % [_id, "zip" if format == "zip" else "json"]
	var target := await EditorKit.pick_file(self, true, name, PackedStringArray(["*.zip ; Scenario"]) if format == "zip" else PackedStringArray(["*.json ; Scenario"]))
	if target.is_empty():
		return
	_error = ""
	_render_error()
	_set_busy(true)
	var reply := await engine.request("editor.bundle.export", {"id": _id, "format": format, "path": target})
	if reply.get("ok", false) and reply["result"] is Dictionary and not str(reply["result"].get("needsPreview", "")).is_empty():
		var ask: Dictionary = reply["result"]
		var preview := ""
		if str(ask.get("kind", "image")) == "raw":
			preview = _raw_preview(str(ask["needsPreview"]), int(ask.get("width", 0)), int(ask.get("height", 0)), float(ask.get("quality", 0.75)))
		else:
			preview = _thumbnail(str(ask["needsPreview"]), int(ask.get("maxDim", 320)), float(ask.get("quality", 0.7)))
		reply = await engine.request("editor.bundle.finish", {"token": str(ask.get("token", "")), "preview": preview})
	_set_busy(false)
	if not reply.get("ok", false):
		_show_error(str(reply.get("error", "")))


func _raw_preview(source: String, width: int, height: int, quality: float) -> String:
	var bytes := FileAccess.get_file_as_bytes(source)
	if width <= 0 or height <= 0 or bytes.size() != width * height * 3:
		return ""
	var image := Image.create_from_data(width, height, false, Image.FORMAT_RGB8, bytes)
	if image == null:
		return ""
	var out := source + ".preview.jpg"
	if image.save_jpg(out, quality) != OK:
		return ""
	return out


func _thumbnail(source: String, max_dim: int, quality := 0.7) -> String:
	var bytes := FileAccess.get_file_as_bytes(source)
	if bytes.size() < 4:
		return ""
	var image := Image.new()
	var status := ERR_FILE_UNRECOGNIZED
	if bytes[0] == 0x89 and bytes[1] == 0x50:
		status = image.load_png_from_buffer(bytes)
	elif bytes[0] == 0xFF and bytes[1] == 0xD8:
		status = image.load_jpg_from_buffer(bytes)
	elif bytes[0] == 0x52 and bytes[1] == 0x49:
		status = image.load_webp_from_buffer(bytes)
	if status != OK or image.get_width() <= 0 or image.get_height() <= 0:
		return ""
	var width := image.get_width()
	var height := image.get_height()
	var scale := minf(1.0, float(max_dim) / float(maxi(width, height)))
	var target_width := maxi(1, roundi(width * scale))
	var target_height := maxi(1, roundi(height * scale))
	image.convert(Image.FORMAT_RGBA8)
	image.resize(target_width, target_height, Image.INTERPOLATE_BILINEAR)
	for y in range(target_height):
		for x in range(target_width):
			var pixel := image.get_pixel(x, y)
			image.set_pixel(x, y, Color(pixel.r * pixel.a, pixel.g * pixel.a, pixel.b * pixel.a, 1.0))
	image.convert(Image.FORMAT_RGB8)
	var out := source + ".preview.jpg"
	if image.save_jpg(out, quality) != OK:
		return ""
	return out


func _differs(with_stats: bool) -> bool:
	if _kind.is_empty() or _form.is_empty():
		return false
	var args := {"form": _form, "savedForm": _saved_form}
	if with_stats and _kind == "scenario":
		args["stats"] = _stats
		args["savedStats"] = _saved_stats
	var reply := await engine.request("editor.differs", args)
	return bool(reply.get("result", false)) if reply.get("ok", false) else false


func _save() -> void:
	if _kind.is_empty() or _details.is_empty() or _form.is_empty():
		return
	if _busy:
		return
	_error = ""
	_render_error()
	_set_busy(true)
	var reply := await engine.request("editor.save", {"kind": _kind, "id": _id, "form": _form, "savedForm": _saved_form, "stats": _stats, "statsFailed": _stats_failed})
	_set_busy(false)
	if not reply.get("ok", false):
		_show_error(str(reply.get("error", "")))
		return
	var pack: Dictionary = reply["result"]
	_details = pack.get("details", _details)
	_form = pack.get("form", _form)
	_saved_form = _form.duplicate(true)
	_country_options = pack.get("countryOptions", _country_options)
	_politics_badge = str(pack.get("politicsBadge", _politics_badge))
	if _kind == "scenario" and not bool(pack.get("keepStats", false)):
		_stats = pack.get("stats")
		if _stats is Dictionary:
			_stats = (_stats as Dictionary).duplicate(true)
		_saved_stats = pack.get("stats")
	library_changed.emit()
	_render_nav()
	if _section in ["overview", "world", "prompts", "assets", "bundles"]:
		_render_section()
	else:
		_update_panels()


func _before_suggest() -> bool:
	if _kind != "scenario":
		return true
	if await _differs(false):
		if not await EditorKit.ask(self, "Save your changes to this scenario first? Only saved changes can be suggested."):
			return false
		await _save()
	return true


func _suggest_changes() -> void:
	if not await _before_suggest():
		return
	var dialog := SuggestChangesDialog.new()
	dialog.update_requested.connect(func(scenario_id: String, post_id: int) -> void: scenario_update_requested.emit(scenario_id, post_id))
	dialog.open_for(engine, _id, self)


func _delete() -> void:
	var record := _record()
	if _kind.is_empty() or not bool(record.get("canDelete", false)):
		return
	var trash_reply := await engine.request("library.trash")
	var trash: Variant = trash_reply.get("result") if trash_reply.get("ok", false) else null
	var noun := "scenario" if _kind == "scenario" else "game"
	var name := str(record.get("name", ""))
	var question := "Delete the %s \"%s\"?" % [noun, name]
	if trash is Dictionary:
		var keep_days := int((trash as Dictionary).get("keepDays", 0))
		var keep_count := int((trash as Dictionary).get("keepCount", 0))
		if keep_count > 0:
			question = "Delete the %s \"%s\"? You can restore it from Recently deleted for %d days, while it is among the last %d things you deleted." % [noun, name, keep_days, keep_count]
		else:
			question = "Delete the %s \"%s\"? You can restore it from Recently deleted for %d days." % [noun, name, keep_days]
	if not await EditorKit.ask(self, question):
		return
	_error = ""
	_render_error()
	_set_busy(true)
	var kind := _kind
	var id := _id
	var reply := await engine.request("editor.delete", {"kind": kind, "id": id})
	_set_busy(false)
	if not reply.get("ok", false):
		_show_error(str(reply.get("error", "")))
		return
	if kind == "game":
		game_deleted.emit(id)
	_hide()
	library_changed.emit()


func _open_workshop() -> void:
	if _kind != "scenario" or _details.is_empty():
		return
	_stop_workshop()
	var scenario: Dictionary = _details.get("scenario", {}) if _details.get("scenario") is Dictionary else {}
	var workshop := Workshop.new()
	_workshop = workshop
	add_child(workshop)
	var tiles := _data_root.path_join("native-cache").path_join("tiles") if not _data_root.is_empty() else ""
	workshop.setup(engine, {"tiles_cache": tiles, "loader": loader})
	workshop.saved.connect(_on_workshop_saved)
	workshop.play_game.connect(func(game_id: String) -> void:
		_stop_workshop()
		_hide()
		library_changed.emit()
		play_game.emit(game_id))
	workshop.failed.connect(func(message: String) -> void:
		_show_error(message))
	workshop.closed.connect(func() -> void:
		if is_instance_valid(workshop):
			workshop.queue_free()
		if _workshop == workshop:
			_workshop = null)
	var game_date := str(_form.get("gameDate", _data_game().get("gameDate", "")))
	workshop.open(scenario, {"world": _world(), "gameDate": game_date, "warSettings": _form.get("warSettings")})


func _stop_workshop() -> void:
	if _workshop and is_instance_valid(_workshop):
		_workshop.queue_free()
	_workshop = null


func _on_workshop_saved(details: Dictionary) -> void:
	if _kind != "scenario":
		return
	var before := _data_game().duplicate()
	var reply := await engine.request("editor.details", {"kind": "scenario", "id": _id})
	var pack: Dictionary = reply["result"] if reply.get("ok", false) else {"details": details}
	_details = pack.get("details", details)
	_saved_form = pack.get("form", _saved_form)
	_country_options = pack.get("countryOptions", _country_options)
	_politics_badge = str(pack.get("politicsBadge", _politics_badge))
	var after := _data_game()
	for key in ["country", "gameDate"]:
		if str(_form.get(key, "")) == str(before.get(key, "")):
			_form[key] = after.get(key, "")
	library_changed.emit()
	_render_nav()
	if _section in ["overview", "world", "prompts", "assets", "bundles"]:
		_render_section()
	else:
		_update_panels()
