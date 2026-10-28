class_name SettingsWorkspace
extends Control

signal back_requested
signal close_requested
signal open_debug_console
signal setting_changed(key: String, value: Variant)

const SECTIONS := [
	{"key": "general", "label": "General", "icon": "◫", "description": "Language, display, accessibility, sound and privacy"},
	{"key": "sound", "label": "Sound", "icon": "♫", "description": "The game's music and sound effects."},
	{"key": "map", "label": "Map", "icon": "◇", "description": "Basemap, labels, globe and camera"},
	{"key": "ai", "label": "AI", "icon": "✦", "description": "Models, backups, keys and reasoning"},
	{"key": "advanced", "label": "Advanced", "icon": "⌘", "description": "Per-task models and expert controls"},
]

const BLUE := Color("#3b82f6")
const BLUE_LIGHT := Color("#60a5fa")
const BLUE_TEXT := Color("#93c5fd")
const BLUE_PALE := Color("#bfdbfe")
const SLATE_INK := Color("#f8fafc")
const HELPER_INK := Color(1, 1, 1, 0.48)
const LABEL_INK := Color(1, 1, 1, 0.88)
const ERROR_INK := Color("#fca5a5")
const PRIVACY_URL := "https://openhistoria.com/privacy/"
const MUSIC_SITE := "www.scottbuckley.com.au"
const MUSIC_SITE_URL := "https://www.scottbuckley.com.au/"
const MUSIC_WORKS := "“Passage Of Time”, “Legionnaire (2022 Remaster)”, “Vanguard”, “Clear Skies”, “Frankincense and Myrrh”, “Discovery”, “Honour Among Thieves”"
const AGENT_KIND_LABELS := [["skip", "Time skips"], ["advisor", "Advisor"], ["diplomacy", "Diplomacy"], ["gameMaster", "Game Master"], ["interactive", "Interactive events"]]
const AGENT_KINDS := ["skip", "advisor", "diplomacy", "gameMaster", "interactive"]
const AGENT_COMMANDS := [["Claude Code", "claude"], ["Codex", "codex"], ["OpenCode", "opencode"], ["Antigravity CLI", "agy"]]
const PERFORMANCE_MODES := [["", "Auto"], ["constrained", "Low memory"], ["full", "Full"]]
const PLAYER_FOCUS_HINTS := {
	"world-first": "The world comes first. At least a quarter of each skip is about you when you have something going on; the rest of the world gets the room.",
	"balanced": "The default. At least 40% of each skip is about you when you have orders, Projects or open threads.",
	"focused": "Your country leads. At least 60% of each skip is about you, and other powers' plans take up less of what the AI is shown.",
	"spotlight": "The story follows you. At least three quarters of each skip is about you, and the wider world is kept to what matters most.",
}
const STATUS_COLORS := {
	"ready": [Color("#86efac"), Color(134 / 255.0, 239 / 255.0, 172 / 255.0, 0.28), Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.1)],
	"spent": [Color("#fbbf24"), Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.32), Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.1)],
	"unusable": [Color("#fca5a5"), Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.34), Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.1)],
	"busy": [Color("#93c5fd"), Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.3), Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.1)],
}
const EYE_SVG := "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z'/><circle cx='12' cy='12' r='3'/></svg>"
const EYE_OFF_SVG := "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24'/><line x1='1' y1='1' x2='23' y2='23'/></svg>"
const AUDIO_UNREADABLE := "The game's sound settings could not be read."
const SYSTEM_MOTION_NOTE := "On, following your system setting for reduced motion."
const PLACEHOLDER_VALUE := "__oh_placeholder__"

var engine: EngineLink
var scope := "game"
var section := "general"
var context := {}
var map_mode := "political"
var export_dir := ""
var reveal_saved_files := true
var from_rect := Rect2()

var _values := {}
var _fallback := {}
var _requests := {}
var _focus := {}
var _diag := {}
var _network: Variant = null
var _cache: Variant = null
var _music: Variant = null
var _audio: Variant = null
var _choices := {}
var _device := {}
var _system_reduced := false
var _detailed_downloading := false
var _maps_browser: Node = null
var _agent_folder := ""
var _last_error := ""

var _editing_entry := ""
var _editing_connection := ""
var _filling := false
var _fill_ticked: Array[String] = []
var _fill_models := ""
var _fill_added := -1
var _catalog_open := {}
var _catalog_query := {}
var _revealed := {}
var _details := {}
var _tasks_expanded := false
var _language_query := {"ui": "", "chat": ""}
var _log_viewing := false
var _log_only_problems := false
var _log_entries: Variant = null
var _log_status := ""
var _log_expanded := -1
var _copy_state := "idle"
var _attach_state := {"kind": "idle"}
var _cleared := false
var _cancel_notice := ""
var _focus_error := ""
var _focus_saving := false
var _network_busy := false
var _network_error := ""
var _cache_busy := false
var _cache_error := ""
var _music_busy := false
var _copied_command := ""
var _daily_limit_draft := ""
var _background_cap_draft := ""
var _label_font_draft := ""
var _pending_writes := {}
var _write_timer: Timer
var _tick_timer: Timer
var _rendering := false
var _closing := false

var _backdrop: ColorRect
var _card: PanelContainer
var _card_body: VBoxContainer
var _title_pill: PanelContainer
var _subtitle: Label
var _nav: VBoxContainer
var _scroll: ScrollContainer
var _content: VBoxContainer
var _confirm_layer: Control
var _confirm_holder: ConfirmAnswer
var _icons := {}


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	_backdrop = ColorRect.new()
	_backdrop.color = Color(8 / 255.0, 9 / 255.0, 11 / 255.0, 0.75)
	_backdrop.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_backdrop.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(_backdrop)
	_build_card()
	_write_timer = Timer.new()
	_write_timer.one_shot = true
	_write_timer.wait_time = 0.35
	_write_timer.timeout.connect(_flush_writes)
	add_child(_write_timer)
	_tick_timer = Timer.new()
	_tick_timer.wait_time = 15.0
	_tick_timer.timeout.connect(_on_tick)
	add_child(_tick_timer)
	_tick_timer.start()
	resized.connect(_layout)
	_layout()


func setup(engine_link: EngineLink, setup_context: Dictionary) -> void:
	engine = engine_link
	scope = str(setup_context.get("scope", "game"))
	section = str(setup_context.get("section", "general"))
	map_mode = str(setup_context.get("map_mode", map_mode))
	export_dir = str(setup_context.get("export_dir", export_dir))
	if setup_context.has("reveal_saved_files"):
		reveal_saved_files = bool(setup_context.get("reveal_saved_files"))
	var given: Variant = setup_context.get("context", {})
	if typeof(given) == TYPE_DICTIONARY:
		context = given
	if not engine.engine_event.is_connected(_on_engine_event):
		engine.engine_event.connect(_on_engine_event)


func open(target_section := "", rect := Rect2()) -> void:
	if not target_section.is_empty():
		section = target_section
	from_rect = rect
	_closing = false
	visible = true
	_refresh_header()
	_build_nav()
	_scroll.scroll_vertical = 0
	await refresh(false)
	_animate_in()


func refresh(keep_scroll := true) -> void:
	if not engine:
		return
	var reply: Variant = await _req("settings.values")
	if typeof(reply) == TYPE_DICTIONARY:
		_values = reply
		var given: Variant = _values.get("context", {})
		if typeof(given) == TYPE_DICTIONARY and context.is_empty():
			context = given
		_label_font_draft = str(_values.get("labelFont", ""))
	_refresh_header()
	await _load_section_data()
	_render(keep_scroll)


func set_section(key: String) -> void:
	if key == section:
		return
	_flush_writes()
	section = key
	_build_nav()
	await _load_section_data()
	_render(false)


func go_back() -> void:
	if _closing:
		return
	_flush_writes()
	if _confirm_layer and is_instance_valid(_confirm_layer):
		if _confirm_holder:
			_confirm_holder.answered.emit(false)
		return
	_closing = true
	if from_rect.size.x > 0.0 and scope != "app":
		var target := _card_rect()
		var tween := create_tween().set_parallel(true).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
		tween.tween_property(_card, "position", from_rect.position, 0.22)
		tween.tween_property(_card, "scale", Vector2(from_rect.size.x / maxf(1.0, target.size.x), from_rect.size.y / maxf(1.0, target.size.y)), 0.22)
		tween.tween_property(_card_body, "modulate:a", 0.0, 0.12)
		tween.tween_property(_backdrop, "modulate:a", 0.0, 0.22)
		await tween.finished
	else:
		var fade := create_tween()
		fade.tween_property(self, "modulate:a", 0.0, 0.15)
		await fade.finished
	visible = false
	back_requested.emit()


func close() -> void:
	_flush_writes()
	visible = false
	close_requested.emit()


func is_typing() -> bool:
	var owner := get_viewport().gui_get_focus_owner() if is_inside_tree() else null
	return owner != null and (owner is LineEdit or owner is TextEdit) and is_ancestor_of(owner)


func _input(event: InputEvent) -> void:
	if not visible or _closing:
		return
	if event is InputEventKey and (event as InputEventKey).pressed and (event as InputEventKey).keycode == KEY_ESCAPE:
		get_viewport().set_input_as_handled()
		go_back()


func _req(method: String, args := {}) -> Variant:
	if not engine:
		return null
	var reply: Dictionary = await engine.request(method, args)
	if not reply.get("ok", false):
		_last_error = str(reply.get("error", "Something went wrong."))
		return null
	_last_error = ""
	return reply.get("result")


func _fs(rem: float) -> int:
	return int(round(rem * 16.0))


func _for_game() -> bool:
	return scope != "app"


func _card_rect() -> Rect2:
	var view := get_viewport_rect().size if is_inside_tree() else Vector2(1440, 900)
	var width := minf(view.x * 0.94, 1120.0)
	var height := minf(800.0, view.y - 38.4)
	return Rect2((view - Vector2(width, height)) * 0.5, Vector2(width, height))


func _layout() -> void:
	if not _card:
		return
	var rect := _card_rect()
	_card.size = rect.size
	if _card.scale == Vector2.ONE:
		_card.position = rect.position


func _animate_in() -> void:
	modulate.a = 1.0
	_layout()
	var target := _card_rect()
	if from_rect.size.x > 0.0 and scope != "app":
		_card.pivot_offset = Vector2.ZERO
		_card.position = from_rect.position
		_card.scale = Vector2(from_rect.size.x / maxf(1.0, target.size.x), from_rect.size.y / maxf(1.0, target.size.y))
		_card_body.modulate.a = 0.0
		_backdrop.modulate.a = 0.0
		var tween := create_tween().set_parallel(true).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
		tween.tween_property(_card, "position", target.position, 0.26)
		tween.tween_property(_card, "scale", Vector2.ONE, 0.26)
		tween.tween_property(_backdrop, "modulate:a", 1.0, 0.2)
		tween.tween_property(_card_body, "modulate:a", 1.0, 0.2).set_delay(0.08)
	else:
		_card.scale = Vector2.ONE
		_card.position = target.position
		_card_body.modulate.a = 1.0
		_backdrop.modulate.a = 1.0
		modulate.a = 0.0
		var fade := create_tween()
		fade.tween_property(self, "modulate:a", 1.0, 0.16)


func _build_card() -> void:
	_card = PanelContainer.new()
	_card.add_theme_stylebox_override("panel", UI.box(Color(20 / 255.0, 21 / 255.0, 24 / 255.0, 0.97), Color(1, 1, 1, 0.08), 18, 1))
	_card.clip_contents = true
	_card.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(_card)
	_card_body = VBoxContainer.new()
	_card_body.add_theme_constant_override("separation", 0)
	_card.add_child(_card_body)
	var header := MarginContainer.new()
	_margins(header, 17.6, 13.6, 17.6, 13.6)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	var back := _square_button("←", 16)
	back.tooltip_text = "Back to game menu"
	back.pressed.connect(go_back)
	back.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(back)
	var titles := VBoxContainer.new()
	titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	titles.add_theme_constant_override("separation", 2)
	var title_row := HBoxContainer.new()
	title_row.add_theme_constant_override("separation", 10)
	var bar := _bar(4, 17, 3)
	bar.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	title_row.add_child(bar)
	var title := UI.label("Settings", _fs(1.04), SLATE_INK, 800)
	title.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	title_row.add_child(title)
	_title_pill = PanelContainer.new()
	_title_pill.add_theme_stylebox_override("panel", UI.box(Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.15), Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.3), 6, 1, Vector4(7, 2, 7, 2)))
	_title_pill.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_title_pill.add_child(UI.label("", _fs(0.7), BLUE_TEXT, 700))
	title_row.add_child(_title_pill)
	titles.add_child(title_row)
	_subtitle = UI.label("", _fs(0.66), Color(1, 1, 1, 0.4))
	_subtitle.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	_subtitle.clip_text = true
	titles.add_child(_subtitle)
	row.add_child(titles)
	var close_button := _square_button("×", 18)
	close_button.tooltip_text = "Close settings"
	close_button.pressed.connect(close)
	close_button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(close_button)
	header.add_child(row)
	_card_body.add_child(header)
	_card_body.add_child(_rule(Color(1, 1, 1, 0.07)))
	var body := HBoxContainer.new()
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_theme_constant_override("separation", 0)
	var aside := PanelContainer.new()
	aside.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0.18)))
	aside.custom_minimum_size.x = 234
	var aside_margin := MarginContainer.new()
	_margins(aside_margin, 10.4, 12, 10.4, 12)
	_nav = VBoxContainer.new()
	_nav.add_theme_constant_override("separation", 6)
	aside_margin.add_child(_nav)
	aside.add_child(aside_margin)
	body.add_child(aside)
	var divider := ColorRect.new()
	divider.color = Color(1, 1, 1, 0.06)
	divider.custom_minimum_size.x = 1
	divider.mouse_filter = Control.MOUSE_FILTER_IGNORE
	body.add_child(divider)
	_scroll = ScrollContainer.new()
	_scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_style_scrollbar(_scroll)
	var main_margin := MarginContainer.new()
	main_margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_margins(main_margin, 20, 17.6, 20, 22.4)
	_content = VBoxContainer.new()
	_content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_content.add_theme_constant_override("separation", 14)
	main_margin.add_child(_content)
	_scroll.add_child(main_margin)
	body.add_child(_scroll)
	_card_body.add_child(body)


func _refresh_header() -> void:
	var scenario := str(context.get("scenarioName", ""))
	_title_pill.visible = _for_game() and not scenario.is_empty()
	(_title_pill.get_child(0) as Label).text = scenario
	if _for_game():
		var parts: PackedStringArray = []
		var country := str(context.get("countryName", ""))
		if not country.is_empty():
			parts.append("Playing as %s" % country)
		var date := str(context.get("date", ""))
		if not date.is_empty():
			parts.append(date)
		_subtitle.text = " · ".join(parts) if not parts.is_empty() else "Game preferences"
	else:
		_subtitle.text = "For every game. A game's own settings are in its ☰ menu."


func _build_nav() -> void:
	for child in _nav.get_children():
		_nav.remove_child(child)
		child.queue_free()
	for entry: Dictionary in SECTIONS:
		var key: String = entry["key"]
		var selected := key == section
		var button := Button.new()
		button.focus_mode = Control.FOCUS_NONE
		button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		var normal := UI.box(Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.12) if selected else Color(0, 0, 0, 0), Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.3) if selected else Color(0, 0, 0, 0), 10, 1, Vector4(10.4, 8.8, 10.4, 8.8))
		var hover := normal.duplicate() as StyleBoxFlat
		if not selected:
			hover.bg_color = Color(1, 1, 1, 0.04)
		for state in ["normal", "focus", "disabled"]:
			button.add_theme_stylebox_override(state, normal)
		for state in ["hover", "pressed", "hover_pressed"]:
			button.add_theme_stylebox_override(state, hover)
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 10)
		row.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var tile := PanelContainer.new()
		tile.mouse_filter = Control.MOUSE_FILTER_IGNORE
		tile.custom_minimum_size = Vector2(30, 30)
		tile.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		tile.add_theme_stylebox_override("panel", UI.box(Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.24) if selected else Color(1, 1, 1, 0.04), Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.4) if selected else Color(0, 0, 0, 0), 8, 1))
		var glyph := UI.label(str(entry["icon"]), _fs(0.85), BLUE_LIGHT if selected else Color(1, 1, 1, 0.7), 700)
		glyph.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		glyph.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		tile.add_child(glyph)
		row.add_child(tile)
		var texts := VBoxContainer.new()
		texts.mouse_filter = Control.MOUSE_FILTER_IGNORE
		texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		texts.add_theme_constant_override("separation", 2)
		texts.add_child(UI.label(str(entry["label"]), _fs(0.8), BLUE_PALE if selected else Color(1, 1, 1, 0.6), 750 if selected else 600))
		var description := UI.wrapped(str(entry["description"]), _fs(0.62), Color(191 / 255.0, 219 / 255.0, 254 / 255.0, 0.65) if selected else Color(1, 1, 1, 0.32))
		texts.add_child(description)
		row.add_child(texts)
		button.add_child(row)
		row.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		row.offset_left = 10.4
		row.offset_right = -10.4
		row.offset_top = 8.8
		row.offset_bottom = -8.8
		button.custom_minimum_size = Vector2(212, 62)
		button.pressed.connect(func() -> void: set_section(key))
		_nav.add_child(button)


func _load_section_data() -> void:
	match section:
		"general":
			_system_reduced = await _system_motion()
		"sound":
			_audio = await _req("audio.settings.get")
			_music = await _req("settings.music")
		"map":
			_system_reduced = await _system_motion()
			var device: Variant = await _req("mapextras.deviceProfile")
			_device = device if typeof(device) == TYPE_DICTIONARY else {}
			if _for_game():
				var choices: Variant = await _req("mapextras.basemapChoices")
				_choices = choices if typeof(choices) == TYPE_DICTIONARY else {}
		"ai":
			await _load_fallback()
			var requests: Variant = await _req("settings.requests")
			if typeof(requests) == TYPE_DICTIONARY:
				_requests = requests
				_daily_limit_draft = str(_requests.get("dailyLimit", ""))
				_background_cap_draft = str(_requests.get("backgroundDailyCap", ""))
			if _for_game():
				var focus: Variant = await _req("settings.focus")
				if typeof(focus) == TYPE_DICTIONARY:
					_focus = focus
		"advanced":
			await _load_fallback()
			var diag: Variant = await _req("settings.diagnostics")
			if typeof(diag) == TYPE_DICTIONARY:
				_diag = diag
			var network: Variant = await _req("settings.network")
			_network = (network as Dictionary).get("state") if typeof(network) == TYPE_DICTIONARY else null
			_cache = await _req("settings.cache")


func _load_fallback() -> void:
	var view: Variant = await _req("settings.fallback")
	if typeof(view) == TYPE_DICTIONARY:
		_fallback = view
	var folder: Variant = await _req("settings.agentFolder")
	if typeof(folder) == TYPE_DICTIONARY:
		_agent_folder = str((folder as Dictionary).get("path", ""))


func _render(keep_scroll := true) -> void:
	if _rendering:
		return
	_rendering = true
	var scroll_at := _scroll.scroll_vertical if keep_scroll else 0
	for child in _content.get_children():
		_content.remove_child(child)
		child.queue_free()
	_content.add_child(_page_header())
	match section:
		"general":
			_build_general()
		"sound":
			_build_sound()
		"map":
			_build_map()
		"ai":
			_build_ai()
		"advanced":
			_build_advanced()
	_rendering = false
	await get_tree().process_frame
	_scroll.scroll_vertical = scroll_at


func _rerender() -> void:
	if is_typing():
		return
	_render()


func _page_header() -> Control:
	var page: Dictionary = SECTIONS[0]
	for entry: Dictionary in SECTIONS:
		if str(entry["key"]) == section:
			page = entry
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 3)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	row.add_child(UI.label(str(page["icon"]), _fs(0.95), BLUE_LIGHT))
	row.add_child(UI.label(str(page["label"]), _fs(1.1), SLATE_INK, 800))
	column.add_child(row)
	column.add_child(UI.label(str(page["description"]), _fs(0.72), HELPER_INK))
	var holder := MarginContainer.new()
	holder.add_theme_constant_override("margin_bottom", 3)
	holder.add_child(column)
	return holder


func _section(title: String, description := "", right: Control = null) -> VBoxContainer:
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.025), Color(1, 1, 1, 0.06), 14, 1, Vector4(20, 17.6, 20, 17.6)))
	card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 12)
	var titles := VBoxContainer.new()
	titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	titles.add_theme_constant_override("separation", 3)
	var title_row := HBoxContainer.new()
	title_row.add_theme_constant_override("separation", 8)
	var bar := _bar(3, 14, 2)
	bar.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	title_row.add_child(bar)
	title_row.add_child(UI.label(title, _fs(0.92), SLATE_INK, 750))
	titles.add_child(title_row)
	if not description.is_empty():
		var margin := MarginContainer.new()
		margin.add_theme_constant_override("margin_left", 11)
		var text := UI.wrapped(description, _fs(0.72), Color(1, 1, 1, 0.45))
		_line_height(text, 1.45, 0.72)
		margin.add_child(text)
		titles.add_child(margin)
	head.add_child(titles)
	if right:
		right.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
		head.add_child(right)
	column.add_child(head)
	_gap(column, 13.6)
	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 0)
	body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.add_child(body)
	card.add_child(column)
	_content.add_child(card)
	return body


func _gap(parent: Control, height: float) -> Control:
	var spacer := Control.new()
	spacer.custom_minimum_size.y = height
	spacer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	spacer.set_meta("gap", true)
	parent.add_child(spacer)
	return spacer


func _pull_up(parent: Control, amount: float) -> void:
	var count := parent.get_child_count()
	if count == 0:
		return
	var last := parent.get_child(count - 1)
	if last is Control and last.has_meta("gap"):
		var spacer := last as Control
		spacer.custom_minimum_size.y = maxf(0.0, spacer.custom_minimum_size.y - amount)


func _margins(container: MarginContainer, left: float, top: float, right: float, bottom: float) -> void:
	container.add_theme_constant_override("margin_left", int(round(left)))
	container.add_theme_constant_override("margin_top", int(round(top)))
	container.add_theme_constant_override("margin_right", int(round(right)))
	container.add_theme_constant_override("margin_bottom", int(round(bottom)))


func _rule(color: Color) -> ColorRect:
	var rule := ColorRect.new()
	rule.color = color
	rule.custom_minimum_size.y = 1
	rule.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return rule


func _bar(width: float, height: float, radius: int) -> Control:
	var bar := Panel.new()
	bar.custom_minimum_size = Vector2(width, height)
	bar.add_theme_stylebox_override("panel", UI.box(BLUE, Color(0, 0, 0, 0), radius, 0))
	bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return bar


func _line_height(label: Label, ratio: float, rem: float) -> void:
	var size := rem * 16.0
	label.add_theme_constant_override("line_spacing", int(round(maxf(0.0, size * ratio - size * 1.15))))


func _helper(text: String, color := HELPER_INK, rem := 0.72) -> Label:
	var node := UI.wrapped(text, _fs(rem), color)
	_line_height(node, 1.45, rem)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


func _add_helper(parent: Control, text: String, top := 5.6, bottom := 0.0) -> Label:
	if top > 0.0:
		_gap(parent, top)
	var node := _helper(text)
	parent.add_child(node)
	if bottom > 0.0:
		_gap(parent, bottom)
	return node


func _add_settings_helper(parent: Control, text: String, bottom := 12.0) -> Label:
	_pull_up(parent, 7.2)
	var node := _helper(text)
	parent.add_child(node)
	if bottom > 0.0:
		_gap(parent, bottom)
	return node


func _add_toggle_note(parent: Control, text: String, bottom := 9.6) -> Label:
	_pull_up(parent, 9.6)
	var node := _helper(text)
	parent.add_child(node)
	if bottom > 0.0:
		_gap(parent, bottom)
	return node


func _add_text_helper(parent: Control, text: String) -> Label:
	_pull_up(parent, 11.2)
	var node := UI.wrapped(text, _fs(0.72), Color(1, 1, 1, 0.45))
	_line_height(node, 1.35, 0.72)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	parent.add_child(node)
	_gap(parent, 11.2)
	return node


func _field_label(text: String, weight := 650) -> Label:
	return UI.label(text, _fs(0.78), LABEL_INK, weight)


func _add_toggle(parent: Control, label_text: String, enabled: bool, on_toggle: Callable, disabled := false, inactive := "", bottom := 10.4) -> Control:
	var wrap := MarginContainer.new()
	_margins(wrap, 0, 5.6, 0, 5.6)
	wrap.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	var texts := VBoxContainer.new()
	texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	texts.add_theme_constant_override("separation", 2)
	texts.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var title := UI.wrapped(label_text, _fs(0.86), Color(1, 1, 1, 0.9), 550)
	texts.add_child(title)
	if not inactive.is_empty():
		texts.add_child(UI.wrapped(inactive, _fs(0.7), Color(1, 1, 1, 0.45)))
	row.add_child(texts)
	var switch := Switch.new(enabled, not inactive.is_empty())
	switch.tooltip_text = label_text
	switch.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	if disabled:
		switch.disabled = true
		switch.modulate.a = 0.45
		switch.mouse_default_cursor_shape = Control.CURSOR_ARROW
	else:
		switch.pressed.connect(func() -> void:
			switch.set_on(not switch.on)
			on_toggle.call())
	row.add_child(switch)
	wrap.add_child(row)
	parent.add_child(wrap)
	if bottom > 0.0:
		_gap(parent, bottom)
	wrap.set_meta("switch", switch)
	return wrap


func _dim(control: Control, reason: String) -> void:
	UI.set_disabled_look(control, reason)
	control.mouse_filter = Control.MOUSE_FILTER_STOP
	for node in _descendants(control):
		if node is BaseButton:
			(node as BaseButton).disabled = true
			(node as Control).mouse_default_cursor_shape = Control.CURSOR_ARROW
			(node as Control).tooltip_text = reason
		elif node is LineEdit:
			(node as LineEdit).editable = false
			(node as Control).tooltip_text = reason
		elif node is TextEdit:
			(node as TextEdit).editable = false
		elif node is Range:
			(node as Range).editable = false
			(node as Control).tooltip_text = reason


func _descendants(node: Node) -> Array[Node]:
	var found: Array[Node] = []
	for child in node.get_children():
		found.append(child)
		found.append_array(_descendants(child))
	return found


func _input_style(line: Control, monospace := false) -> void:
	var normal := UI.box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.1), 8, 1, Vector4(12, 8.8, 12, 8.8))
	var focus := UI.box(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.22), 8, 1, Vector4(12, 8.8, 12, 8.8))
	line.add_theme_stylebox_override("normal", normal)
	line.add_theme_stylebox_override("focus", focus)
	line.add_theme_stylebox_override("read_only", normal)
	line.add_theme_font_override("font", UI.font(400, "Consolas" if monospace else "Arial"))
	line.add_theme_font_size_override("font_size", _fs(0.82))
	line.add_theme_color_override("font_color", SLATE_INK)
	line.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.36))
	line.add_theme_color_override("caret_color", SLATE_INK)
	line.add_theme_color_override("font_readonly_color", Color(SLATE_INK, 0.6))


func _line(value: String, placeholder: String, on_change: Callable = Callable(), secret := false) -> LineEdit:
	var line := LineEdit.new()
	line.text = value
	line.placeholder_text = placeholder
	line.secret = secret
	line.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	line.custom_minimum_size.y = 36
	_input_style(line)
	if on_change.is_valid():
		line.text_changed.connect(func(text: String) -> void: on_change.call(text))
	return line


func _text_area(value: String, placeholder: String, on_change: Callable) -> TextEdit:
	var area := TextEdit.new()
	area.text = value
	area.placeholder_text = placeholder
	area.custom_minimum_size.y = 96
	area.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	area.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	_input_style(area, true)
	area.text_changed.connect(func() -> void: on_change.call(area.text))
	return area


func _select(options: Array, current: String, on_select: Callable, placeholder := "") -> OptionButton:
	var select := OptionButton.new()
	select.focus_mode = Control.FOCUS_NONE
	select.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	select.custom_minimum_size.y = 36
	select.fit_to_longest_item = false
	select.clip_text = true
	select.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var normal := UI.box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.1), 8, 1, Vector4(12, 6, 12, 6))
	var hover := UI.box(Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.16), 8, 1, Vector4(12, 6, 12, 6))
	for state in ["normal", "focus", "disabled"]:
		select.add_theme_stylebox_override(state, normal)
	for state in ["hover", "pressed", "hover_pressed"]:
		select.add_theme_stylebox_override(state, hover)
	select.add_theme_font_override("font", UI.font(400))
	select.add_theme_font_size_override("font_size", _fs(0.82))
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		select.add_theme_color_override(name, SLATE_INK)
	select.add_theme_color_override("font_disabled_color", Color(SLATE_INK, 0.55))
	_style_popup(select.get_popup())
	var index := 0
	var chosen := -1
	if not placeholder.is_empty():
		select.add_item(placeholder)
		select.set_item_disabled(0, true)
		select.set_item_metadata(0, PLACEHOLDER_VALUE)
		index = 1
	for option: Variant in options:
		var value := ""
		var text := ""
		var disabled := false
		if typeof(option) == TYPE_ARRAY:
			var pair: Array = option
			value = str(pair[0])
			text = str(pair[1])
			disabled = pair.size() > 2 and bool(pair[2])
		else:
			value = str(option)
			text = str(option)
		select.add_item(text)
		select.set_item_metadata(index, value)
		if disabled:
			select.set_item_disabled(index, true)
		if value == current and chosen < 0:
			chosen = index
		index += 1
	select.select(chosen if chosen >= 0 else (0 if not placeholder.is_empty() or select.item_count > 0 else -1))
	select.item_selected.connect(func(item: int) -> void:
		var value: String = str(select.get_item_metadata(item))
		if value != PLACEHOLDER_VALUE:
			on_select.call(value))
	return select


func _style_popup(popup: PopupMenu) -> void:
	popup.add_theme_stylebox_override("panel", UI.box(Color("#1f1f23"), Color(1, 1, 1, 0.12), 8, 1, Vector4(4, 4, 4, 4)))
	popup.add_theme_stylebox_override("hover", UI.box(Color(1, 1, 1, 0.08), Color(0, 0, 0, 0), 6, 0))
	popup.add_theme_font_override("font", UI.font(400))
	popup.add_theme_font_size_override("font_size", _fs(0.82))
	popup.add_theme_color_override("font_color", Color("#f4f4f5"))
	popup.add_theme_color_override("font_hover_color", Color("#ffffff"))
	popup.add_theme_color_override("font_disabled_color", Color("#8b8b93"))
	popup.add_theme_color_override("font_separator_color", Color(1, 1, 1, 0.5))
	popup.add_theme_constant_override("v_separation", 6)


func _style_scrollbar(scroll: ScrollContainer) -> void:
	var bar := scroll.get_v_scroll_bar()
	bar.add_theme_stylebox_override("scroll", StyleBoxEmpty.new())
	bar.add_theme_stylebox_override("grabber", UI.box(Color(1, 1, 1, 0.16), Color(0, 0, 0, 0), 999, 0))
	bar.add_theme_stylebox_override("grabber_highlight", UI.box(Color(1, 1, 1, 0.28), Color(0, 0, 0, 0), 999, 0))
	bar.add_theme_stylebox_override("grabber_pressed", UI.box(Color(1, 1, 1, 0.28), Color(0, 0, 0, 0), 999, 0))
	bar.custom_minimum_size.x = 8


func _button(text: String, on_press: Callable, kind := "small", tooltip := "") -> Button:
	var node := Button.new()
	node.text = text
	node.focus_mode = Control.FOCUS_NONE
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	node.tooltip_text = tooltip
	var bg := Color(1, 1, 1, 0.06)
	var border := Color(1, 1, 1, 0.1)
	var ink := SLATE_INK
	var pad := Vector4(12, 7.2, 12, 7.2)
	var size := _fs(0.78)
	var weight := 600
	match kind:
		"primary":
			bg = Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.22)
			border = Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.45)
			ink = BLUE_TEXT
		"row":
			pad = Vector4(8, 4, 8, 4)
			size = _fs(0.72)
		"diagnostics":
			bg = Color(1, 1, 1, 0.08)
			border = Color(1, 1, 1, 0.18)
			ink = UI.WHITE
			pad = Vector4(9.6, 7.2, 9.6, 7.2)
		"link":
			bg = Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.12)
			border = Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.24)
			ink = BLUE_PALE
			pad = Vector4(10.4, 7.2, 10.4, 7.2)
			size = _fs(0.72)
			weight = 750
		"privacy":
			bg = Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.12)
			border = Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.28)
			ink = BLUE_TEXT
			pad = Vector4(10.4, 7.2, 10.4, 7.2)
			size = _fs(0.72)
			weight = 750
	var normal := UI.box(bg, border, 8, 1, pad)
	var hover := UI.box(Color(bg.r, bg.g, bg.b, minf(1.0, bg.a + 0.05)), Color(border.r, border.g, border.b, minf(1.0, border.a + 0.08)), 8, 1, pad)
	for state in ["normal", "focus", "disabled"]:
		node.add_theme_stylebox_override(state, normal)
	for state in ["hover", "pressed", "hover_pressed"]:
		node.add_theme_stylebox_override(state, hover)
	node.add_theme_font_override("font", UI.font(weight))
	node.add_theme_font_size_override("font_size", size)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		node.add_theme_color_override(name, ink)
	node.add_theme_color_override("font_disabled_color", Color(ink, ink.a * 0.5))
	if on_press.is_valid():
		node.pressed.connect(func() -> void: on_press.call())
	return node


func _square_button(text: String, size: int) -> Button:
	var node := Button.new()
	node.text = text
	node.focus_mode = Control.FOCUS_NONE
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	node.custom_minimum_size = Vector2(34, 34)
	var normal := UI.box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.08), 8, 1)
	var hover := UI.box(Color(1, 1, 1, 0.08), Color(1, 1, 1, 0.12), 8, 1)
	for state in ["normal", "focus"]:
		node.add_theme_stylebox_override(state, normal)
	for state in ["hover", "pressed", "hover_pressed"]:
		node.add_theme_stylebox_override(state, hover)
	node.add_theme_font_override("font", UI.font(400))
	node.add_theme_font_size_override("font_size", size)
	node.add_theme_color_override("font_color", Color(1, 1, 1, 0.7))
	node.add_theme_color_override("font_hover_color", UI.WHITE)
	node.add_theme_color_override("font_pressed_color", UI.WHITE)
	return node


func _svg(svg: String, size: int, color: Color) -> Texture2D:
	var key := "%s:%d:%s" % [svg.md5_text(), size, color.to_html()]
	if _icons.has(key):
		return _icons[key]
	var image := Image.new()
	if image.load_svg_from_string(svg.replace("#fff", "#" + color.to_html(false)), float(size) / 24.0) != OK:
		return null
	if color.a < 1.0:
		image.convert(Image.FORMAT_RGBA8)
		for y in range(image.get_height()):
			for x in range(image.get_width()):
				var pixel := image.get_pixel(x, y)
				pixel.a *= color.a
				image.set_pixel(x, y, pixel)
	var texture := ImageTexture.create_from_image(image)
	_icons[key] = texture
	return texture


func _flags() -> Dictionary:
	var flags: Variant = _values.get("flags", {})
	return flags if typeof(flags) == TYPE_DICTIONARY else {}


func _flag(key: String) -> bool:
	return bool(_flags().get(key, false))


func _set_flag(key: String, value: bool) -> void:
	var reply: Variant = await _req("settings.flag", {"key": key, "value": value})
	if typeof(reply) == TYPE_DICTIONARY:
		_values["flags"] = (reply as Dictionary).get("flags", _flags())
	setting_changed.emit(key, value)


func _set_flag_and_render(key: String, value: bool) -> void:
	await _set_flag(key, value)
	_rerender()


func _set_value(key: String, value: String) -> void:
	await _req("settings.value", {"key": key, "value": value})
	setting_changed.emit(key, value)


func _queue_write(id: String, method: String, args: Dictionary) -> void:
	_pending_writes[id] = [method, args]
	_write_timer.start()


func _flush_writes() -> void:
	if _pending_writes.is_empty():
		return
	var writes := _pending_writes.duplicate()
	_pending_writes.clear()
	for id: String in writes.keys():
		var write: Array = writes[id]
		var reply: Variant = await _req(str(write[0]), write[1])
		if typeof(reply) == TYPE_DICTIONARY and (reply as Dictionary).has("entries"):
			_fallback = reply
		elif typeof(reply) == TYPE_DICTIONARY and str(write[0]) == "audio.settings.set":
			_audio = reply


func _on_tick() -> void:
	if not visible or section != "ai" or is_typing():
		return
	await _load_fallback()
	var requests: Variant = await _req("settings.requests")
	if typeof(requests) == TYPE_DICTIONARY:
		_requests = requests
	_rerender()


func _on_engine_event(name: String, _data: Variant) -> void:
	if not visible:
		return
	if name == "settings.fallback_changed" and section in ["ai", "advanced"] and _pending_writes.is_empty() and not is_typing():
		await _load_fallback()
		_rerender()
	elif name == "settings.requests_changed" and section == "ai" and not is_typing():
		var requests: Variant = await _req("settings.requests")
		if typeof(requests) == TYPE_DICTIONARY:
			_requests = requests
			_rerender()


func _confirm(text: String) -> bool:
	if _confirm_layer and is_instance_valid(_confirm_layer):
		_confirm_layer.queue_free()
	var layer := Control.new()
	layer.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	layer.mouse_filter = Control.MOUSE_FILTER_STOP
	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.45)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	layer.add_child(dim)
	var centre := CenterContainer.new()
	centre.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	layer.add_child(centre)
	var card := PanelContainer.new()
	card.custom_minimum_size.x = 440
	card.add_theme_stylebox_override("panel", UI.box(Color(30 / 255.0, 31 / 255.0, 35 / 255.0, 0.99), Color(1, 1, 1, 0.12), 12, 1, Vector4(20, 18, 20, 16)))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 16)
	var message := UI.wrapped(text, 13, Color(1, 1, 1, 0.88))
	message.custom_minimum_size.x = 400
	column.add_child(message)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	row.add_child(UI.spacer())
	var answer := [false]
	var holder := ConfirmAnswer.new()
	_confirm_holder = holder
	var cancel := _button("Cancel", func() -> void: holder.answered.emit(false))
	var ok := _button("OK", func() -> void: holder.answered.emit(true), "primary")
	row.add_child(cancel)
	row.add_child(ok)
	column.add_child(row)
	card.add_child(column)
	centre.add_child(card)
	add_child(layer)
	_confirm_layer = layer
	var result: bool = await holder.answered
	answer[0] = result
	if is_instance_valid(layer):
		layer.queue_free()
	_confirm_layer = null
	_confirm_holder = null
	return bool(answer[0])


func _reveal(path: String) -> void:
	if reveal_saved_files and not path.is_empty():
		OS.shell_show_in_file_manager(path)


func _export_dir() -> String:
	return export_dir if not export_dir.is_empty() else OS.get_system_dir(OS.SYSTEM_DIR_DOWNLOADS)


func _build_general() -> void:
	var language := _section("Language", "Interface language affects the UI. Chat language steers advisor and diplomatic replies.")
	language.add_child(_language_picker("ui", "UI language", str(_values.get("uiLanguage", "en")), func(code: String) -> void:
		_values["uiLanguage"] = code
		setting_changed.emit("ui_language", code)
		_rerender(), true))
	language.add_child(_language_picker("chat", "AI chat language", str(_values.get("chatLanguage", "en")), func(code: String) -> void:
		var reply: Variant = await _req("settings.chatLanguage", {"code": code})
		if typeof(reply) == TYPE_DICTIONARY:
			_values = reply
		_rerender(), false))
	var display := _section("Display", "Window and presentation preferences that apply to the game client.")
	var fullscreen := DisplayServer.window_get_mode() in [DisplayServer.WINDOW_MODE_FULLSCREEN, DisplayServer.WINDOW_MODE_EXCLUSIVE_FULLSCREEN]
	_add_toggle(display, "Fullscreen", fullscreen, func() -> void:
		var next := not (DisplayServer.window_get_mode() in [DisplayServer.WINDOW_MODE_FULLSCREEN, DisplayServer.WINDOW_MODE_EXCLUSIVE_FULLSCREEN])
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN if next else DisplayServer.WINDOW_MODE_WINDOWED)
		_req("settings.window", {"key": "Fullscreen", "value": next})
		setting_changed.emit("fullscreen", next))
	_add_toggle(display, "Show the vault door every time", _flag("vault_door_every_time"), func() -> void: _set_flag("vault_door_every_time", not _flag("vault_door_every_time")))
	_add_toggle_note(display, "On: the vault door appears every time you start the game. Off: only the first time you start it after an update.")
	var access := _section("Accessibility", "Reduce automatic camera motion and map animations without changing simulation behavior.")
	var reduced := _system_reduced or (_flag("map_disable_idle_rotation") and _flag("map_disable_event_camera"))
	_add_toggle(access, "Reduce motion", reduced, func() -> void:
		var next := not (_flag("map_disable_idle_rotation") and _flag("map_disable_event_camera"))
		var reply: Variant = await _req("settings.reduceMotion", {"value": next})
		if typeof(reply) == TYPE_DICTIONARY:
			_values = reply
		setting_changed.emit("map_disable_idle_rotation", next)
		setting_changed.emit("map_disable_event_camera", next), _system_reduced)
	if _system_reduced:
		_add_toggle_note(access, SYSTEM_MOTION_NOTE)
	var policy := _button("Privacy policy", func() -> void: OS.shell_open(PRIVACY_URL), "privacy")
	var privacy := _section("Privacy", "What the game tells other services about you, and the switches for it.", policy)
	_add_toggle(privacy, "Show what I am playing on Discord", _flag("privacy_discord_presence"), func() -> void: _set_flag("privacy_discord_presence", not _flag("privacy_discord_presence")))
	_add_settings_helper(privacy, "Discord shows the country you play, the scenario and the in-game date to people who can see your activity. Desktop app only.", 0)


func _language_options(query: String, current: String, mark_built_in: bool) -> Array:
	var options: Array = []
	var needle := query.strip_edges().to_lower()
	var listed := false
	for language: Dictionary in _values.get("languages", []):
		var code := str(language.get("code", ""))
		var name := str(language.get("name", ""))
		var native := str(language.get("native", ""))
		if not needle.is_empty() and not ("%s %s %s" % [name, native, code]).to_lower().contains(needle):
			continue
		var text := name
		if not native.is_empty() and native != name:
			text += " — " + native
		if mark_built_in and bool(language.get("builtIn", false)):
			text += " ✓"
		options.append([code, text])
		if code == current:
			listed = true
	return [options, listed]


func _fill_language_select(select: OptionButton, query: String, current: String, mark_built_in: bool) -> void:
	var found: Array = _language_options(query, current, mark_built_in)
	var options: Array = found[0]
	var listed: bool = found[1]
	select.clear()
	var index := 0
	if not listed:
		select.add_item("%d matches — pick one" % options.size() if not options.is_empty() else "No matching language")
		select.set_item_disabled(0, true)
		select.set_item_metadata(0, PLACEHOLDER_VALUE)
		index = 1
	var chosen := 0
	for pair: Array in options:
		select.add_item(str(pair[1]))
		select.set_item_metadata(index, str(pair[0]))
		if str(pair[0]) == current:
			chosen = index
		index += 1
	if select.item_count > 0:
		select.select(chosen)


func _language_picker(key: String, label_text: String, current: String, on_select: Callable, mark_built_in: bool) -> Control:
	var group := VBoxContainer.new()
	group.add_theme_constant_override("separation", 0)
	var head := HBoxContainer.new()
	head.add_child(_field_label(label_text))
	head.add_child(UI.spacer())
	var query := str(_language_query.get(key, ""))
	var clear := Button.new()
	clear.text = "Clear"
	clear.flat = true
	clear.focus_mode = Control.FOCUS_NONE
	clear.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	clear.add_theme_font_size_override("font_size", _fs(0.7))
	for name in ["font_color", "font_hover_color", "font_pressed_color"]:
		clear.add_theme_color_override(name, BLUE_LIGHT)
	for state in ["normal", "hover", "pressed", "focus"]:
		clear.add_theme_stylebox_override(state, StyleBoxEmpty.new())
	clear.visible = not query.is_empty()
	head.add_child(clear)
	group.add_child(head)
	_gap(group, 6.4)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	var select := _select([], "", on_select)
	select.size_flags_stretch_ratio = 1.6
	select.add_theme_stylebox_override("normal", UI.box(Color(1, 1, 1, 0.04), Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.3), 8, 1, Vector4(12, 6, 12, 6)))
	_fill_language_select(select, query, current, mark_built_in)
	row.add_child(select)
	var search := _line(query, "Search languages...")
	search.custom_minimum_size.x = 130
	search.text_changed.connect(func(text: String) -> void:
		_language_query[key] = text
		clear.visible = not text.is_empty()
		_fill_language_select(select, text, current, mark_built_in))
	clear.pressed.connect(func() -> void:
		_language_query[key] = ""
		search.text = ""
		clear.visible = false
		_fill_language_select(select, "", current, mark_built_in))
	row.add_child(search)
	group.add_child(row)
	var built_in := current == "en" or _language_built_in(current)
	var helper := ""
	if key == "ui":
		helper = "Languages marked ✓ ship with the game translated. What scenarios add (names, descriptions, custom stats) is translated by your AI model, once." if built_in else "This language is translated by your AI model as you play, once per string. Languages marked ✓ ship with the game translated."
	else:
		helper = "What the advisor and diplomatic chats reply in. Defaults to your interface language."
	_add_helper(group, helper)
	_gap(group, 14.4)
	return group


func _language_built_in(code: String) -> bool:
	for language: Dictionary in _values.get("languages", []):
		if str(language.get("code", "")) == code:
			return bool(language.get("builtIn", false))
	return false


func _audio_set(change: Dictionary) -> void:
	var reply: Variant = await _req("audio.settings.set", change)
	if typeof(reply) == TYPE_DICTIONARY:
		_audio = reply
	if change.has("music"):
		setting_changed.emit("audio_ambient_music", bool(change["music"]))
	if change.has("volume"):
		setting_changed.emit("audio_music_volume", str(int(change["volume"])))
	if change.has("effects"):
		setting_changed.emit("audio_sound_effects", bool(change["effects"]))


func _build_sound() -> void:
	var sound := _section("Sound", "The game's music and sound effects.")
	var audio_ready := typeof(_audio) == TYPE_DICTIONARY
	var audio: Dictionary = _audio if audio_ready else {}
	var music_on := bool(audio.get("music", _flag("audio_ambient_music")))
	var music := _add_toggle(sound, "Music", music_on, func() -> void:
		await _audio_set({"music": not music_on})
		_rerender())
	var volume_row := HBoxContainer.new()
	volume_row.add_theme_constant_override("separation", 12)
	var volume_label := UI.label("Music volume", _fs(0.9), UI.WHITE)
	volume_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	volume_row.add_child(volume_label)
	var slider := HSlider.new()
	slider.min_value = 0
	slider.max_value = 100
	slider.step = 1
	slider.value = float(audio.get("volume", _values.get("musicVolume", 25)))
	slider.custom_minimum_size = Vector2(144, 20)
	slider.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	slider.focus_mode = Control.FOCUS_NONE
	slider.add_theme_stylebox_override("slider", UI.box(Color(1, 1, 1, 0.14), Color(0, 0, 0, 0), 999, 0, Vector4(0, 2, 0, 2)))
	slider.add_theme_stylebox_override("grabber_area", UI.box(BLUE, Color(0, 0, 0, 0), 999, 0, Vector4(0, 2, 0, 2)))
	slider.add_theme_stylebox_override("grabber_area_highlight", UI.box(BLUE, Color(0, 0, 0, 0), 999, 0, Vector4(0, 2, 0, 2)))
	volume_row.add_child(slider)
	var percent := UI.label("%d%%" % int(slider.value), _fs(0.78), BLUE_TEXT, 650)
	percent.custom_minimum_size.x = 42
	percent.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	volume_row.add_child(percent)
	slider.value_changed.connect(func(value: float) -> void:
		percent.text = "%d%%" % int(value)
		_queue_write("audio:volume", "audio.settings.set", {"volume": int(value)})
		setting_changed.emit("audio_music_volume", str(int(value))))
	sound.add_child(volume_row)
	if not music_on:
		volume_row.modulate.a = 0.5
		slider.editable = false
	_gap(sound, 13.6)
	var effects_on := bool(audio.get("effects", _flag("audio_sound_effects")))
	var effects := _add_toggle(sound, "Sound effects", effects_on, func() -> void: _audio_set({"effects": not effects_on}))
	if not audio_ready:
		_dim(music, AUDIO_UNREADABLE)
		_dim(volume_row, AUDIO_UNREADABLE)
		_dim(effects, AUDIO_UNREADABLE)
	if typeof(_music) == TYPE_DICTIONARY and typeof((_music as Dictionary).get("usage")) == TYPE_DICTIONARY:
		var usage: Dictionary = (_music as Dictionary)["usage"]
		var count := int(usage.get("tracks", 0))
		var size := str((_music as Dictionary).get("size", ""))
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 12)
		var text := "Downloaded music: none" if count == 0 else ("Downloaded music: 1 track, %s" % size if count == 1 else "Downloaded music: %d tracks, %s" % [count, size])
		var label := UI.label(text, _fs(0.9), UI.WHITE)
		label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(label)
		var clear := _button("Clear", func() -> void:
			if _music_busy:
				return
			if not await _confirm("Delete the music downloaded to this device? It will be downloaded again when a scenario plays it."):
				return
			_music_busy = true
			var reply: Variant = await _req("settings.music.clear")
			if typeof(reply) == TYPE_DICTIONARY and typeof((reply as Dictionary).get("usage")) == TYPE_DICTIONARY:
				_music = reply
			_music_busy = false
			_rerender(), "diagnostics")
		if _music_busy or count == 0:
			clear.disabled = true
			clear.modulate.a = 0.5
		row.add_child(clear)
		sound.add_child(row)
		_gap(sound, 13.6)
	var credit: Dictionary = audio.get("credit", {}) if typeof(audio.get("credit")) == TYPE_DICTIONARY else {}
	var works := str(credit.get("works", MUSIC_WORKS))
	var site_name := str(credit.get("site", MUSIC_SITE))
	var site_url := str(credit.get("siteUrl", MUSIC_SITE_URL))
	sound.add_child(_credit_line("%s %s" % [str(credit.get("text", "Music by Scott Buckley, released under CC BY 4.0:")), works], site_name, site_url))
	var now_playing: Variant = audio.get("nowPlaying")
	if typeof(now_playing) == TYPE_DICTIONARY and not str((now_playing as Dictionary).get("credit", "")).is_empty():
		var track: Dictionary = now_playing
		_gap(sound, 7.2)
		sound.add_child(_credit_line("Now playing: %s" % str(track.get("credit", "")), str(track.get("site", "")), str(track.get("source", ""))))


func _credit_line(text: String, link_text: String, link_url: String) -> Control:
	var line := RichTextLabel.new()
	line.bbcode_enabled = true
	line.fit_content = true
	line.scroll_active = false
	line.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	line.add_theme_font_override("normal_font", UI.font(400))
	line.add_theme_font_size_override("normal_font_size", _fs(0.72))
	line.add_theme_color_override("default_color", HELPER_INK)
	line.add_theme_constant_override("line_separation", 3)
	line.meta_underlined = true
	var escaped := text.replace("[", "[lb]")
	if not link_text.is_empty() and not link_url.is_empty():
		escaped += " [url=%s]%s[/url]" % [link_url, link_text.replace("[", "[lb]")]
	line.text = escaped
	line.meta_clicked.connect(func(meta: Variant) -> void: OS.shell_open(str(meta)))
	line.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return line


func _build_map() -> void:
	var presentation := _section("Map presentation", "Choose the map mode and visual presentation options.")
	presentation.add_child(_field_label("Map mode"))
	_gap(presentation, 6.4)
	presentation.add_child(_select([["political", "Political (Countries and borders)"], ["diplomatic", "Diplomatic (Allies, enemies, trade partners)"]], map_mode if not map_mode.is_empty() else "political", func(value: String) -> void:
		map_mode = value
		_set_value("map_mode", value)))
	_add_helper(presentation, "Diplomatic mode colours each country by where it stands with you: your puppets, allies, friends, hostile countries and enemies at war.")
	_gap(presentation, 14.4)
	var basemap := _section("Basemap", "The flat map drawn under the countries.")
	if _for_game():
		basemap.add_child(_game_basemap_field())
	else:
		var use_default := _flag("map_basemap_default_on")
		var stored := str(_values.get("defaultBasemap", ""))
		var ids: Array[String] = []
		var options: Array = []
		for entry: Dictionary in _values.get("basemaps", []):
			ids.append(str(entry.get("id", "")))
			options.append([str(entry.get("id", "")), str(entry.get("label", ""))])
		var value := stored if stored in ids else str(_values.get("defaultBasemapId", "ocean"))
		var group := VBoxContainer.new()
		group.add_theme_constant_override("separation", 0)
		_add_toggle(group, "Use my default basemap", use_default, func() -> void:
			if not use_default and not stored in ids:
				await _set_value("map_basemap_default", value)
			_set_flag_and_render("map_basemap_default_on", not use_default))
		group.add_child(_field_label("Default basemap"))
		_gap(group, 6.4)
		var select := _select(options, value, func(next: String) -> void: _set_value("map_basemap_default", next))
		if not use_default:
			select.disabled = true
			select.modulate.a = 0.6
		group.add_child(select)
		_add_helper(group, "Games start on this map wherever their scenario offers it, and on the scenario's starting map elsewhere. Each game's own settings can still pick another." if use_default else "Off: every game starts on its scenario's starting map. Each game's own settings can pick another.")
		_gap(group, 14.4)
		basemap.add_child(group)
	var detailed := _section("Detailed maps", "Large terrain maps, sharp when zoomed in. A scenario offers them among its maps, each drawn over one of its drawn maps.")
	if not _for_game():
		var painted := str(_values.get("scenarioTerrain", "")) == "painted"
		_add_toggle(detailed, "Show detailed maps", not painted, func() -> void: _set_value("map_scenario_terrain", "" if painted else "painted"))
		var note := _add_helper(detailed, "On: a detailed map is drawn when you have it. Off, in every game: the drawn map under it, which is lighter.", 0.0)
		_pull_up(detailed, 0)
		note.modulate.a = 1.0
	else:
		var download := _detailed_download_field()
		if download:
			detailed.add_child(download)
	var browse_group := VBoxContainer.new()
	browse_group.add_theme_constant_override("separation", 0)
	var browse := _button("Browse and download maps…", _open_maps_browser)
	browse.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	browse.add_theme_stylebox_override("normal", UI.box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.1), 8, 1, Vector4(12, 8.8, 12, 8.8)))
	browse.add_theme_stylebox_override("hover", UI.box(Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.16), 8, 1, Vector4(12, 8.8, 12, 8.8)))
	browse.add_theme_stylebox_override("pressed", UI.box(Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.16), 8, 1, Vector4(12, 8.8, 12, 8.8)))
	browse.add_theme_font_override("font", UI.font(400))
	browse.add_theme_font_size_override("font_size", _fs(0.82))
	browse_group.add_child(browse)
	_add_helper(browse_group, "Your basemaps and detailed maps, and the community's. To use one in a scenario, open that scenario in the Map Editor.")
	_gap(browse_group, 14.4)
	detailed.add_child(browse_group)
	var labels := _section("Labels", "Which political labels are shown, and in what font.")
	labels.add_child(_field_label("Country label font"))
	_gap(labels, 6.4)
	var font_row := HBoxContainer.new()
	font_row.add_theme_constant_override("separation", 0)
	var font_line := _line(_label_font_draft, "Scenario default", func(text: String) -> void:
		_label_font_draft = text
		_set_value("map_label_font", text))
	font_row.add_child(font_line)
	var suggestions := MenuButton.new()
	suggestions.text = "▾"
	suggestions.flat = true
	suggestions.focus_mode = Control.FOCUS_NONE
	suggestions.custom_minimum_size = Vector2(30, 36)
	suggestions.add_theme_color_override("font_color", Color(1, 1, 1, 0.55))
	suggestions.tooltip_text = "Country label font"
	var popup := suggestions.get_popup()
	_style_popup(popup)
	for font_name: Variant in _values.get("labelFonts", []):
		popup.add_item(str(font_name))
	popup.index_pressed.connect(func(index: int) -> void:
		var chosen := popup.get_item_text(index)
		font_line.text = chosen
		_label_font_draft = chosen
		_set_value("map_label_font", chosen))
	font_row.add_child(suggestions)
	labels.add_child(font_row)
	_add_helper(labels, "Empty uses the font the scenario author chose. Any font installed on this computer works; overrides apply immediately.")
	_gap(labels, 14.4)
	_add_toggle(labels, "Hide country labels", _flag("map_hide_country_labels"), func() -> void: _set_flag("map_hide_country_labels", not _flag("map_hide_country_labels")))
	var seasons_on := _flag("map_seasons_weather")
	_add_toggle(labels, "Seasons and weather", seasons_on, func() -> void: _set_flag_and_render("map_seasons_weather", not _flag("map_seasons_weather")))
	_add_settings_helper(labels, "On (default): the map is tinted by the season and shows its weather. Frozen water is drawn as ice either way.")
	if seasons_on:
		_add_toggle(labels, "Weather effects", _flag("map_weather_effects"), func() -> void: _set_flag("map_weather_effects", not _flag("map_weather_effects")))
		_add_settings_helper(labels, "On (default): rain, snow, frost, fog and the other weathers are drawn over the land they fall on. Off: no weather is drawn; the season's tint and the ice stay, and the advisor can still tell you the weather.")
	var performance := VBoxContainer.new()
	performance.add_theme_constant_override("separation", 0)
	performance.add_child(_field_label("Performance mode"))
	_gap(performance, 6.4)
	var modes: Array = []
	for mode: Array in PERFORMANCE_MODES:
		modes.append([mode[0], mode[1]])
	var current_mode := str(_device.get("mode", _values.get("deviceProfile", "")))
	var running_line: Label
	var mode_select := _select(modes, current_mode, func(value: String) -> void:
		var reply: Variant = await _req("mapextras.deviceProfile", {"value": value})
		if typeof(reply) == TYPE_DICTIONARY:
			_device = reply
			_values["deviceProfile"] = str((reply as Dictionary).get("mode", ""))
			if is_instance_valid(running_line):
				running_line.text = _running_text())
	mode_select.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	performance.add_child(mode_select)
	_add_helper(performance, "Auto picks Low memory in the Android app, on a touch screen with no mouse, and on a device with 4 GB of memory or less: the map loads in smaller steps with fewer workers. Full is faster on a strong tablet, and Low memory can steady a weak computer. A change applies after the game is reloaded.")
	running_line = _add_helper(performance, _running_text())
	_gap(performance, 14.4)
	labels.add_child(performance)
	var three := _section("3D map", "Globe and terrain rendering are presentation features; they do not change world state.")
	var pill_row := HBoxContainer.new()
	var pill := PanelContainer.new()
	pill.add_theme_stylebox_override("panel", UI.box(Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.12), Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.28), 999, 1, Vector4(7.7, 2.9, 7.7, 2.9)))
	pill.add_child(UI.label("Experimental", _fs(0.58), Color("#fbbf24"), 850))
	pill_row.add_child(pill)
	three.add_child(pill_row)
	_gap(three, 9.6)
	var no_globe := _for_game() and bool(_choices.get("noGlobe", false))
	_add_toggle(three, "3D Globe", bool(_values.get("globe", false)) and not no_globe, func() -> void:
		var next := not bool(_values.get("globe", false))
		_values["globe"] = next
		_req("settings.window", {"key": "Globe", "value": next})
		setting_changed.emit("Globe", next), no_globe, "The 3D globe is disabled for this scenario's map." if no_globe else "")
	_add_toggle(three, "3D Terrain", bool(_values.get("terrain", true)), func() -> void:
		var next := not bool(_values.get("terrain", true))
		_values["terrain"] = next
		_req("settings.window", {"key": "Terrain", "value": next})
		setting_changed.emit("Terrain", next))
	var camera := _section("Camera behavior", "Fine-grained controls for automatic map movement.")
	_add_toggle(camera, "Disable idle globe rotation", _system_reduced or _flag("map_disable_idle_rotation"), func() -> void: _set_flag("map_disable_idle_rotation", not _flag("map_disable_idle_rotation")), _system_reduced)
	_add_toggle(camera, "Disable camera movement during events", _system_reduced or _flag("map_disable_event_camera"), func() -> void: _set_flag("map_disable_event_camera", not _flag("map_disable_event_camera")), _system_reduced)
	if _system_reduced:
		_add_toggle_note(camera, SYSTEM_MOTION_NOTE)


func _running_text() -> String:
	return "Running now: Low memory." if bool(_device.get("running", false)) else "Running now: Full."


func _game_basemap_field() -> VBoxContainer:
	var group := VBoxContainer.new()
	group.add_theme_constant_override("separation", 0)
	group.add_child(_field_label("Basemap"))
	_gap(group, 6.4)
	var options: Array = []
	var header := 0
	for entry: Variant in _choices.get("options", []):
		if typeof(entry) != TYPE_DICTIONARY:
			continue
		var option: Dictionary = entry
		if option.has("header"):
			header += 1
			options.append(["__group_%d" % header, str(option["header"]), true])
		else:
			options.append([str(option.get("pick", "")), str(option.get("label", ""))])
	var only := bool(_choices.get("only", options.size() <= 1))
	var select := _select(options, str(_choices.get("shownPick", "")), func(value: String) -> void:
		if value.begins_with("__group_"):
			return
		_choices["shownPick"] = value
		await _req("mapextras.setGamePick", {"pick": value})
		setting_changed.emit("gamePick", value)
		_refresh_choices())
	if only:
		select.disabled = true
		select.modulate.a = 0.6
		select.mouse_default_cursor_shape = Control.CURSOR_FORBIDDEN
	group.add_child(select)
	_add_helper(group, "This scenario has one map." if only else "The maps this scenario offers. Your pick is kept for this game only, and applies at once.")
	_gap(group, 14.4)
	return group


func _refresh_choices() -> void:
	var choices: Variant = await _req("mapextras.basemapChoices")
	if typeof(choices) == TYPE_DICTIONARY:
		_choices = choices
		_rerender()


func _detailed_download_field() -> Control:
	var offers: Array = _choices.get("offers", []) if typeof(_choices.get("offers")) == TYPE_ARRAY else []
	if offers.is_empty():
		return null
	var group := VBoxContainer.new()
	group.add_theme_constant_override("separation", 0)
	if _detailed_downloading:
		var offer := DetailedMapsOffer.new()
		offer.title = "Download detailed maps"
		offer.intro = "Large terrain maps, sharp up close. Each downloads once, and every scenario on it shares it. Your basemap pick stays as it is."
		group.add_child(offer)
		offer.setup_list(engine, offers)
		offer.done.connect(func() -> void:
			_detailed_downloading = false
			await _refresh_choices()
			setting_changed.emit("gamePick", str(_choices.get("shownPick", ""))))
	else:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 10)
		var line := _helper(str(_choices.get("line", "")))
		line.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		line.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(line)
		row.add_child(_button("Download…", func() -> void:
			_detailed_downloading = true
			_rerender()))
		group.add_child(row)
	_gap(group, 14.4)
	return group


func _open_maps_browser() -> void:
	if _maps_browser and is_instance_valid(_maps_browser):
		return
	var browser := MapsBrowser.new()
	_maps_browser = browser
	get_tree().root.add_child(browser)
	browser.setup(engine, export_dir)
	browser.closed.connect(func() -> void:
		_maps_browser = null
		if _for_game():
			await _refresh_choices()
			setting_changed.emit("gamePick", str(_choices.get("shownPick", ""))))


func _system_motion() -> bool:
	var reply: Variant = await _req("mapextras.systemMotion")
	return typeof(reply) == TYPE_DICTIONARY and bool((reply as Dictionary).get("reduced", false))


func _entries() -> Array:
	var entries: Variant = _fallback.get("entries", [])
	return entries if typeof(entries) == TYPE_ARRAY else []


func _connections() -> Array:
	var connections: Variant = _fallback.get("connections", [])
	return connections if typeof(connections) == TYPE_ARRAY else []


func _connection(id: String) -> Dictionary:
	for connection: Dictionary in _connections():
		if str(connection.get("id", "")) == id:
			return connection
	return {}


func _apply_view(reply: Variant) -> void:
	if typeof(reply) != TYPE_DICTIONARY:
		return
	var view: Dictionary = reply
	if view.has("entries"):
		_fallback = view
	elif typeof(view.get("view")) == TYPE_DICTIONARY:
		_fallback = view["view"]


func _fallback_call(method: String, args: Dictionary) -> Variant:
	await _flush_writes()
	var reply: Variant = await _req(method, args)
	_apply_view(reply)
	_rerender()
	return reply


func _build_ai() -> void:
	_build_fallback_section()
	_build_connections_section()
	var reasoning := _section("Model reasoning", "Applies to every model in the list.")
	_add_toggle(reasoning, "Model reasoning", bool(_values.get("reasoning", true)), func() -> void:
		var reply: Variant = await _req("settings.reasoning", {"value": not bool(_values.get("reasoning", true))})
		if typeof(reply) == TYPE_DICTIONARY:
			_values = reply)
	var reasoning_note := _helper("Lets thinking-capable models reason before answering (Gemini thinking, OpenAI reasoning effort, Claude extended thinking). Slower and costs more tokens; needs a model that supports it.")
	_pull_up(reasoning, 9.6)
	reasoning.add_child(reasoning_note)
	_build_requests_section()
	_build_generation_section()


func _status_chip(entry: Dictionary) -> Control:
	var key := str(entry.get("status", "ready"))
	var colors: Array = STATUS_COLORS.get(key, STATUS_COLORS["ready"])
	var chip := PanelContainer.new()
	chip.add_theme_stylebox_override("panel", UI.box(colors[2], colors[1], 999, 1, Vector4(8, 2, 8, 2)))
	chip.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	chip.add_child(UI.label(str(entry.get("statusText", "Ready")), _fs(0.66), colors[0], 750))
	return chip


func _build_fallback_section() -> void:
	var body := _section("Models", "Backup models: when one runs out, the next one takes over. Every AI call starts at the top of the list and moves down only when a model can't answer — including the call right after a busy moment, so a model is back in use the moment it can answer again. One that has used up its allowance is passed over until it resets, and tried again only if nothing else answers.")
	var entries := _entries()
	if entries.is_empty():
		body.add_child(_helper("No models yet. Add one to let the game write turns and replies."))
		_gap(body, 11.2)
	if entries.size() == 1:
		var only: Dictionary = entries[0]
		var row := HBoxContainer.new()
		row.alignment = BoxContainer.ALIGNMENT_END
		row.add_theme_constant_override("separation", 8)
		row.add_child(_status_chip(only))
		if str(only.get("status", "ready")) != "ready":
			var entry_id := str(only.get("id", ""))
			row.add_child(_button("Reset", func() -> void: _fallback_call("settings.entry.reset", {"id": entry_id}), "row"))
		body.add_child(row)
		_gap(body, 8)
		_entry_editor(body, only)
	elif entries.size() > 1:
		for index in range(entries.size()):
			var entry: Dictionary = entries[index]
			_entry_card(body, entry, index, entries.size())
	var buttons := HFlowContainer.new()
	buttons.add_theme_constant_override("h_separation", 8)
	buttons.add_theme_constant_override("v_separation", 8)
	_gap(body, 9.6)
	buttons.add_child(_button("+ Add a backup" if not entries.is_empty() else "+ Add a model", func() -> void:
		await _flush_writes()
		var reply: Variant = await _req("settings.entry.add", {})
		if typeof(reply) == TYPE_DICTIONARY:
			_editing_entry = str((reply as Dictionary).get("id", ""))
		_apply_view(reply)
		_rerender(), "primary"))
	buttons.add_child(_button("Fill…", func() -> void:
		_filling = not _filling
		_fill_added = -1
		if _filling:
			_fill_ticked.clear()
			for connection: Dictionary in _connections():
				_fill_ticked.append(str(connection.get("id", "")))
		_rerender()))
	if not entries.is_empty():
		buttons.add_child(_button("Clear list", func() -> void:
			var count := _entries().size()
			if not await _confirm("Remove all %d entr%s from the list? Your connections and keys are kept, so Fill can rebuild it. Until you add a model again, the game can't write turns or replies." % [count, "y" if count == 1 else "ies"]):
				return
			_editing_entry = ""
			_filling = false
			_fallback_call("settings.fallback.clear", {})))
	body.add_child(buttons)
	if _filling:
		_fill_panel(body)
	_gap(body, 14.4)
	body.add_child(_field_label("When a model is rate limited"))
	_gap(body, 6.4)
	body.add_child(_select([["next", "Use the next one straight away (default)"], ["wait", "Wait, then try it again"]], str(_fallback.get("rateLimitPolicy", "next")), func(value: String) -> void: _fallback_call("settings.fallback.policy", {"policy": value})))
	_add_helper(body, "A rate limit is a short pause, not a used-up allowance, and it is usually over by the next call — which starts at the top of the list again. Waiting instead keeps your backups' daily allowance, at the cost of a slower turn.")
	_gap(body, 14.4)
	body.add_child(_helper("Mix a free key with a paid one, or with a local model. Each key is used under its provider's terms."))


func _entry_card(body: VBoxContainer, entry: Dictionary, index: int, count: int) -> void:
	var id := str(entry.get("id", ""))
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.025), Color(1, 1, 1, 0.08), 8, 1, Vector4(12, 9.6, 12, 9.6)))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 8)
	var texts := VBoxContainer.new()
	texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	texts.add_theme_constant_override("separation", 2)
	var title_row := HBoxContainer.new()
	title_row.add_theme_constant_override("separation", 6)
	title_row.add_child(UI.label(str(index + 1), _fs(0.82), Color(1, 1, 1, 0.4), 650))
	var resolved: Variant = entry.get("resolved")
	var label_text := str((resolved as Dictionary).get("label", "")) if typeof(resolved) == TYPE_DICTIONARY else "(connection removed)"
	var title := UI.label(label_text, _fs(0.82), UI.WHITE, 650)
	title.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	title.clip_text = true
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title_row.add_child(title)
	texts.add_child(title_row)
	texts.add_child(_helper("%s%s" % [str(entry.get("providerLabel", "")), str(entry.get("answered", ""))]))
	head.add_child(texts)
	head.add_child(_status_chip(entry))
	column.add_child(head)
	_gap(column, 7.2)
	var buttons := HBoxContainer.new()
	buttons.add_theme_constant_override("separation", 5)
	var up := _button("↑", func() -> void: _fallback_call("settings.entry.move", {"id": id, "to": index - 1}), "row", "Move up")
	if index == 0:
		up.disabled = true
		up.modulate.a = 0.4
	buttons.add_child(up)
	var down := _button("↓", func() -> void: _fallback_call("settings.entry.move", {"id": id, "to": index + 1}), "row", "Move down")
	if index == count - 1:
		down.disabled = true
		down.modulate.a = 0.4
	buttons.add_child(down)
	buttons.add_child(_button("Done" if _editing_entry == id else "Edit", func() -> void:
		await _flush_writes()
		_editing_entry = "" if _editing_entry == id else id
		if _editing_entry.is_empty():
			await _load_fallback()
		_rerender(), "row"))
	if str(entry.get("status", "ready")) != "ready":
		buttons.add_child(_button("Reset", func() -> void: _fallback_call("settings.entry.reset", {"id": id}), "row", "Clear this status. Every call tries this model again either way."))
	buttons.add_child(_button("✕", func() -> void:
		var name := label_text if typeof(resolved) == TYPE_DICTIONARY else "this entry"
		if not await _confirm("Remove %s from the list?" % name):
			return
		_fallback_call("settings.entry.remove", {"id": id}), "row", "Remove from the list"))
	column.add_child(buttons)
	if _editing_entry == id:
		_gap(column, 12)
		_entry_editor(column, entry)
	card.add_child(column)
	body.add_child(card)
	_gap(body, 7.2)


func _entry_editor(parent: VBoxContainer, entry: Dictionary) -> void:
	var id := str(entry.get("id", ""))
	var connections := _connections()
	var connection := _connection(str(entry.get("connectionId", "")))
	var provider := str(connection.get("provider", _fallback.get("defaultProvider", "gemini")))
	var shared_by := 0
	for other: Dictionary in _entries():
		if str(other.get("connectionId", "")) == str(entry.get("connectionId", "")):
			shared_by += 1
	if connections.size() > 1:
		parent.add_child(_field_label("Connection"))
		_gap(parent, 6.4)
		var options: Array = []
		for candidate: Dictionary in connections:
			options.append([str(candidate.get("id", "")), "%s — %s" % [str(candidate.get("displayName", "")), str(candidate.get("providerLabel", ""))]])
		parent.add_child(_select(options, str(entry.get("connectionId", "")), func(value: String) -> void: _fallback_call("settings.entry.update", {"id": id, "patch": {"connectionId": value}})))
		_gap(parent, 14.4)
	if not connection.is_empty():
		_connection_fields(parent, connection, shared_by)
	if provider == str(_fallback.get("agentProvider", "agent")):
		return
	var placeholder := "Model id"
	var chain: Array = _fallback.get("geminiChain", [])
	if provider == "gemini" and not chain.is_empty():
		placeholder = str(chain[0])
	elif provider == "openai":
		placeholder = str(_fallback.get("openaiDefault", ""))
	elif provider.begins_with("anthropic"):
		placeholder = "claude-haiku-4-5"
	var suggestions: Array = connection.get("recentModels", [])
	_settings_input(parent, "Model", str(entry.get("model", "")), placeholder, func(text: String) -> void: _queue_write("entry:%s:model" % id, "settings.entry.update", {"id": id, "patch": {"model": text}}), "Leave blank to auto-pick a chat-capable model from the server's /models." if provider == "openai-compatible" else "Leave blank to use the built-in default.", false, suggestions)
	var details_key := "entry:%s" % id
	var open := bool(_details.get(details_key, false))
	var summary := _summary_button("This model only", open, func() -> void:
		_details[details_key] = not bool(_details.get(details_key, false))
		_rerender())
	parent.add_child(summary)
	_gap(parent, 9.6)
	if open:
		_settings_input(parent, "Custom parameters for this model (JSON)", str(entry.get("customParamsOverride", "")), "Blank uses the connection's", func(text: String) -> void: _queue_write("entry:%s:params" % id, "settings.entry.update", {"id": id, "patch": {"customParamsOverride": text}}), "Replaces the connection's custom parameters for this entry — e.g. the same model with a larger max_tokens, picked by the Time skip task.", true)
		_structured_mode(parent, id, str(entry.get("structuredMode", "auto")))
		var window: Variant = entry.get("window")
		if typeof(window) == TYPE_DICTIONARY:
			_context_window(parent, id, window)
	_gap(parent, 6.4)


func _summary_button(text: String, open: bool, on_press: Callable) -> Button:
	var node := Button.new()
	node.text = ("▾ " if open else "▸ ") + text
	node.flat = true
	node.focus_mode = Control.FOCUS_NONE
	node.alignment = HORIZONTAL_ALIGNMENT_LEFT
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	node.add_theme_font_override("font", UI.font(400))
	node.add_theme_font_size_override("font_size", _fs(0.74))
	for name in ["font_color", "font_focus_color"]:
		node.add_theme_color_override(name, Color(1, 1, 1, 0.62))
	for name in ["font_hover_color", "font_pressed_color", "font_hover_pressed_color"]:
		node.add_theme_color_override(name, Color(1, 1, 1, 0.85))
	for state in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
		node.add_theme_stylebox_override(state, StyleBoxEmpty.new())
	node.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	node.pressed.connect(func() -> void: on_press.call())
	return node


func _settings_input(parent: VBoxContainer, label_text: String, value: String, placeholder: String, on_change: Callable, helper := "", multiline := false, suggestions: Array = [], secret_key := "") -> void:
	parent.add_child(_field_label(label_text))
	_gap(parent, 6.4)
	if multiline:
		parent.add_child(_text_area(value, placeholder, on_change))
	elif not secret_key.is_empty():
		var revealed := bool(_revealed.get(secret_key, false))
		var holder := Control.new()
		holder.custom_minimum_size.y = 36
		holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var line := _line(value, placeholder, on_change, not revealed)
		line.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		var style := UI.box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.1), 8, 1, Vector4(12, 8.8, 40, 8.8))
		line.add_theme_stylebox_override("normal", style)
		line.add_theme_stylebox_override("focus", UI.box(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.22), 8, 1, Vector4(12, 8.8, 40, 8.8)))
		holder.add_child(line)
		var eye := Button.new()
		eye.flat = true
		eye.focus_mode = Control.FOCUS_NONE
		eye.icon = _svg(EYE_OFF_SVG if revealed else EYE_SVG, 18, Color("#38bdf8") if revealed else Color(1, 1, 1, 0.65))
		eye.tooltip_text = "Hide API key" if revealed else "Show API key"
		eye.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		eye.anchor_left = 1.0
		eye.anchor_right = 1.0
		eye.offset_left = -38
		eye.offset_right = -4
		eye.offset_top = 2
		eye.offset_bottom = 34
		eye.pressed.connect(func() -> void:
			_revealed[secret_key] = not bool(_revealed.get(secret_key, false))
			var now := bool(_revealed[secret_key])
			line.secret = not now
			eye.icon = _svg(EYE_OFF_SVG if now else EYE_SVG, 18, Color("#38bdf8") if now else Color(1, 1, 1, 0.65))
			eye.tooltip_text = "Hide API key" if now else "Show API key")
		holder.add_child(eye)
		parent.add_child(holder)
	elif not suggestions.is_empty():
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 0)
		var line := _line(value, placeholder, on_change)
		row.add_child(line)
		var menu := MenuButton.new()
		menu.text = "▾"
		menu.flat = true
		menu.focus_mode = Control.FOCUS_NONE
		menu.custom_minimum_size = Vector2(30, 36)
		menu.add_theme_color_override("font_color", Color(1, 1, 1, 0.55))
		var popup := menu.get_popup()
		_style_popup(popup)
		for item: Variant in suggestions:
			popup.add_item(str(item))
		popup.index_pressed.connect(func(index: int) -> void:
			line.text = popup.get_item_text(index)
			on_change.call(line.text))
		row.add_child(menu)
		parent.add_child(row)
	else:
		parent.add_child(_line(value, placeholder, on_change))
	if not helper.is_empty():
		_add_helper(parent, helper)
	_gap(parent, 14.4)


func _structured_mode(parent: VBoxContainer, id: String, mode: String) -> void:
	var labels: Dictionary = _fallback.get("structuredLabels", {})
	var hints: Dictionary = _fallback.get("structuredHints", {})
	var current := mode if labels.has(mode) else "auto"
	parent.add_child(_field_label("How the AI answers"))
	_gap(parent, 6.4)
	var options: Array = []
	for key: String in ["auto", "tool", "json_schema", "json_object", "text_json"]:
		options.append([key, str(labels.get(key, key))])
	parent.add_child(_select(options, current, func(value: String) -> void: _fallback_call("settings.entry.update", {"id": id, "patch": {"structuredMode": value}})))
	_add_helper(parent, str(_fallback.get("structuredIntro", "")) if current == "auto" else str(hints.get(current, "")))
	_gap(parent, 14.4)


func _context_window(parent: VBoxContainer, id: String, window: Dictionary) -> void:
	parent.add_child(_field_label("Context window (tokens)"))
	_gap(parent, 6.4)
	var line := _line(str(window.get("value", "")), "Not set")
	line.text_changed.connect(func(text: String) -> void:
		var digits := ""
		for character in text:
			if character >= "0" and character <= "9":
				digits += character
		if digits != text:
			line.text = digits
			line.caret_column = digits.length()
		_queue_write("entry:%s:window" % id, "settings.entry.window", {"id": id, "tokens": int(digits) if not digits.is_empty() else 0}))
	parent.add_child(line)
	_add_helper(parent, str(window.get("helper", "")))
	_gap(parent, 14.4)
	if bool(window.get("known", false)):
		_pull_up(parent, 8)
		var forget := _button("Forget this window", func() -> void: _fallback_call("settings.entry.window", {"id": id, "forget": true}))
		forget.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		parent.add_child(forget)
		_gap(parent, 14.4)


func _connection_fields(parent: VBoxContainer, connection: Dictionary, shared_by: int) -> void:
	var id := str(connection.get("id", ""))
	var provider := str(connection.get("provider", "gemini"))
	var meta: Dictionary = connection.get("providerMeta", {})
	var label := str(meta.get("label", connection.get("providerLabel", "")))
	_provider_selector(parent, id, meta)
	_settings_input(parent, "Connection name", str(connection.get("name", "")), label, func(text: String) -> void: _queue_write("connection:%s:name" % id, "settings.connection.update", {"id": id, "patch": {"name": text}}))
	if bool(connection.get("agent", false)):
		_agent_help(parent, connection)
		return
	var self_hosted := bool(connection.get("selfHosted", false))
	if self_hosted:
		var placeholder := "http://localhost:11434/v1" if provider == "openai-compatible" else "https://my-proxy.example/v1"
		var helper := "Base URL that exposes /chat/completions and /models." if provider == "openai-compatible" else "Base URL of a self-hosted proxy that speaks the Anthropic Messages API (POST /messages)."
		_settings_input(parent, "API endpoint", str(connection.get("endpoint", "")), placeholder, func(text: String) -> void: _queue_write("connection:%s:endpoint" % id, "settings.connection.update", {"id": id, "patch": {"endpoint": text}}), helper)
	var key_helper := "Stored only in this browser." + (" Shared by %d entries in your list." % shared_by if shared_by > 1 else "")
	_settings_input(parent, "API key (optional)" if self_hosted else "%s API key" % label, str(connection.get("apiKey", "")), "Leave empty if your server needs none" if self_hosted else "Paste %s API key" % label, func(text: String) -> void: _queue_write("connection:%s:key" % id, "settings.connection.update", {"id": id, "patch": {"apiKey": text}}), key_helper, false, [], "key:%s" % id)
	_settings_input(parent, "Custom parameters (JSON)", str(connection.get("customParams", "")), "{\"generationConfig\": {\"topP\": 0.9}}" if provider == "gemini" else "{\"top_p\": 0.9}", func(text: String) -> void: _queue_write("connection:%s:params" % id, "settings.connection.update", {"id": id, "patch": {"customParams": text}}), "Optional. Merged into every request this connection sends — e.g. to limit reasoning budget/effort. An entry can override them. Invalid JSON is ignored.", true)
	if provider == "openai-compatible":
		var strict := bool(connection.get("toolStrict", false))
		_add_toggle(parent, "Strict tool schema", strict, func() -> void: _fallback_call("settings.connection.update", {"id": id, "patch": {"toolStrict": not strict}}))
		_pull_up(parent, 9.6)
		parent.add_child(_helper("Sends strict:true with the tool call so a self-hosted backend constrains generation to the schema (SGLang/xgrammar, vLLM). Leave off for OpenAI and Azure: they reject a schema that does not list every property as required."))
		_gap(parent, 14.4)


func _provider_selector(parent: VBoxContainer, id: String, meta: Dictionary) -> void:
	var open := bool(_catalog_open.get(id, false))
	parent.add_child(UI.label("AI Provider", _fs(0.9), UI.WHITE))
	_gap(parent, 9.6)
	var button := Button.new()
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.custom_minimum_size.y = 62
	var normal := UI.box(Color(0, 0, 0, 0.18), Color(1, 1, 1, 0.12), 10, 1)
	var hover := UI.box(Color(0, 0, 0, 0.24), Color(1, 1, 1, 0.18), 10, 1)
	for state in ["normal", "focus"]:
		button.add_theme_stylebox_override(state, normal)
	for state in ["hover", "pressed", "hover_pressed"]:
		button.add_theme_stylebox_override(state, hover)
	var row := HBoxContainer.new()
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	row.offset_left = 14.4
	row.offset_right = -14.4
	row.offset_top = 10
	row.offset_bottom = -10
	row.add_theme_constant_override("separation", 12)
	var texts := VBoxContainer.new()
	texts.mouse_filter = Control.MOUSE_FILTER_IGNORE
	texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	texts.alignment = BoxContainer.ALIGNMENT_CENTER
	texts.add_theme_constant_override("separation", 3)
	texts.add_child(UI.label(str(meta.get("label", "")), _fs(0.9), UI.WHITE, 700))
	var sub := UI.label("%s · %s" % [str(meta.get("group", "")), str(meta.get("description", ""))], _fs(0.72), Color(1, 1, 1, 0.6))
	sub.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	sub.clip_text = true
	texts.add_child(sub)
	row.add_child(texts)
	var change := UI.label("Hide" if open else "Change", _fs(0.85), Color(1, 1, 1, 0.7))
	change.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(change)
	button.add_child(row)
	button.pressed.connect(func() -> void:
		await _flush_writes()
		_catalog_open[id] = not bool(_catalog_open.get(id, false))
		_rerender())
	parent.add_child(button)
	_add_helper(parent, "Searchable catalog instead of a wall of provider buttons.")
	if not open:
		_gap(parent, 16)
		return
	_gap(parent, 10.4)
	_gap(parent, 11.2)
	var box := PanelContainer.new()
	box.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.1), 10, 1, Vector4(12, 12, 12, 12)))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	var query := str(_catalog_query.get(id, ""))
	var search := _line(query, "Search provider, protocol or gateway...")
	column.add_child(search)
	_gap(column, 10.4)
	var list_scroll := ScrollContainer.new()
	list_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	list_scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_SHOW_NEVER
	list_scroll.custom_minimum_size.y = 192
	var groups := VBoxContainer.new()
	groups.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	groups.add_theme_constant_override("separation", 11)
	list_scroll.add_child(groups)
	column.add_child(list_scroll)
	box.add_child(column)
	parent.add_child(box)
	_gap(parent, 16)
	var fill := func(needle: String) -> void:
		for child in groups.get_children():
			groups.remove_child(child)
			child.queue_free()
		var normalized := needle.strip_edges().to_lower()
		var grouped := {}
		var order: Array[String] = []
		for option: Dictionary in _fallback.get("providers", []):
			var haystack := " ".join([str(option.get("label", "")), str(option.get("group", "")), str(option.get("description", ""))] + Array(option.get("searchTerms", [])).map(func(term: Variant) -> String: return str(term))).to_lower()
			if not normalized.is_empty() and not haystack.contains(normalized):
				continue
			var group_name := str(option.get("group", ""))
			if not grouped.has(group_name):
				grouped[group_name] = []
				order.append(group_name)
			(grouped[group_name] as Array).append(option)
		if order.is_empty():
			groups.add_child(_helper("Nothing matched the search."))
			return
		for group_name in order:
			var block := VBoxContainer.new()
			block.add_theme_constant_override("separation", 6)
			block.add_child(UI.label(group_name.to_upper(), _fs(0.68), Color(1, 1, 1, 0.45), 700, "Arial", 1))
			for option: Dictionary in grouped[group_name]:
				block.add_child(_provider_option(id, option, str(option.get("value", "")) == str(meta.get("value", ""))))
			groups.add_child(block)
	fill.call(query)
	search.text_changed.connect(func(text: String) -> void:
		_catalog_query[id] = text
		fill.call(text))


func _provider_option(id: String, option: Dictionary, selected: bool) -> Button:
	var button := Button.new()
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var normal := UI.box(Color(0, 0, 0, 0.42) if selected else Color(0, 0, 0, 0.16), Color(1, 1, 1, 0.28) if selected else Color(1, 1, 1, 0.08), 8, 1)
	var hover := UI.box(Color(0, 0, 0, 0.42) if selected else Color(0, 0, 0, 0.26), Color(1, 1, 1, 0.28) if selected else Color(1, 1, 1, 0.16), 8, 1)
	for state in ["normal", "focus"]:
		button.add_theme_stylebox_override(state, normal)
	for state in ["hover", "pressed", "hover_pressed"]:
		button.add_theme_stylebox_override(state, hover)
	var column := VBoxContainer.new()
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	column.offset_left = 12
	column.offset_right = -12
	column.offset_top = 9
	column.offset_bottom = -9
	column.add_theme_constant_override("separation", 3)
	var top := HBoxContainer.new()
	top.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var name := UI.label(str(option.get("label", "")), _fs(0.84), UI.WHITE, 700 if selected else 600)
	name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(name)
	if selected:
		top.add_child(UI.label("Active", _fs(0.68), BLUE_TEXT, 700))
	column.add_child(top)
	var description := UI.label(str(option.get("description", "")), _fs(0.72), Color(1, 1, 1, 0.6))
	description.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	description.clip_text = true
	column.add_child(description)
	button.add_child(column)
	button.custom_minimum_size.y = 54
	var value := str(option.get("value", ""))
	button.pressed.connect(func() -> void:
		_catalog_open[id] = false
		_catalog_query[id] = ""
		_fallback_call("settings.connection.update", {"id": id, "patch": {"provider": value}}))
	return button


func _agent_help(parent: VBoxContainer, connection: Dictionary) -> void:
	var id := str(connection.get("id", ""))
	for text: String in [
		"What you start (the kinds ticked below) waits for your own Agent, on your own subscription. No API key is used.",
		"Open a terminal in the Agent folder, start Claude Code, Codex, OpenCode or Antigravity CLI there, signed in with your own account, and type /answer whenever something is waiting. One /answer answers all of it, a whole time skip included.",
		"The first /answer asks which models to use for Open Historia. The game never starts your Agent and never reads its sign-in.",
		"Anything unticked, and what the game starts by itself (background diplomacy, idle chats, automatic stat tracking), goes to the entry below it.",
		"With nothing below it, those don't run. Add an entry below it, such as a free Gemini key, to keep them.",
	]:
		parent.add_child(_helper(text))
		_gap(parent, 8)
	_pull_up(parent, 8)
	_gap(parent, 9.6)
	var kinds: Array = connection.get("kinds", AGENT_KINDS)
	for pair: Array in AGENT_KIND_LABELS:
		var kind: String = pair[0]
		var ticked := kind in kinds
		_add_toggle(parent, str(pair[1]), ticked, func() -> void:
			var current: Array = connection.get("kinds", AGENT_KINDS).duplicate()
			if kind in current:
				current.erase(kind)
			else:
				current.append(kind)
			_fallback_call("settings.connection.update", {"id": id, "patch": {"kinds": current}}))
	var paused := bool(connection.get("paused", false))
	_add_toggle(parent, "Pause my Agent", paused, func() -> void: _fallback_call("settings.connection.update", {"id": id, "patch": {"paused": not paused}}))
	_pull_up(parent, 6.4)
	parent.add_child(_helper("While paused, everything goes to the entry below, for when you are away from your terminal."))
	if not _agent_folder.is_empty():
		_gap(parent, 8)
		var folder := UI.wrapped(_agent_folder, _fs(0.72), HELPER_INK)
		folder.add_theme_font_override("font", UI.font(400, "Consolas"))
		folder.autowrap_mode = TextServer.AUTOWRAP_ARBITRARY
		parent.add_child(folder)
	_gap(parent, 9.6)
	var buttons := HFlowContainer.new()
	buttons.add_theme_constant_override("h_separation", 6)
	buttons.add_theme_constant_override("v_separation", 6)
	buttons.add_child(_button("Open the Agent folder", func() -> void: _req("settings.agentFolder.open")))
	if not _agent_folder.is_empty():
		for pair: Array in AGENT_COMMANDS:
			var command: String = pair[1]
			var name: String = pair[0]
			buttons.add_child(_button("Copied" if _copied_command == command else "Copy the command for %s" % name, func() -> void:
				DisplayServer.clipboard_set("cd %s; %s" % [JSON.stringify(_agent_folder), command])
				_copied_command = command
				_rerender()))
	parent.add_child(buttons)
	_gap(parent, 14.4)


func _fill_panel(body: VBoxContainer) -> void:
	_gap(body, 11.2)
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.03), Color(1, 1, 1, 0.1), 10, 1, Vector4(12, 12, 12, 12)))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	column.add_child(UI.label("Fill the list", _fs(0.8), UI.WHITE, 700))
	_gap(column, 6.4)
	column.add_child(_helper("Every model on every ticked connection, strongest model first across all of them: the first model on each connection, then the second, and so on. Rows you already have are skipped."))
	_gap(column, 9.6)
	for connection: Dictionary in _connections():
		var cid := str(connection.get("id", ""))
		var check := CheckBox.new()
		check.button_pressed = cid in _fill_ticked
		check.focus_mode = Control.FOCUS_NONE
		check.text = "%s (%s)" % [str(connection.get("displayName", "")), str(connection.get("providerLabel", ""))]
		check.add_theme_font_size_override("font_size", _fs(0.8))
		check.add_theme_color_override("font_color", UI.WHITE)
		check.add_theme_color_override("font_hover_color", UI.WHITE)
		check.add_theme_color_override("font_pressed_color", UI.WHITE)
		check.toggled.connect(func(on: bool) -> void:
			if on and not cid in _fill_ticked:
				_fill_ticked.append(cid)
			elif not on:
				_fill_ticked.erase(cid)
			_rerender())
		column.add_child(check)
		_gap(column, 5.6)
	var chain: Array = _fallback.get("geminiChain", [])
	var chain_text: PackedStringArray = []
	for model: Variant in chain:
		chain_text.append(str(model))
	_settings_input(column, "Models, strongest first (one per line)", _fill_models, "\n".join(chain_text), func(text: String) -> void: _fill_models = text, "", true)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	var ready := not _fill_ticked.is_empty() and not _fill_models.strip_edges().is_empty()
	var fill := _button("Fill", func() -> void:
		if _fill_ticked.is_empty() or _fill_models.strip_edges().is_empty():
			return
		var order: Array[String] = []
		for connection: Dictionary in _connections():
			var cid := str(connection.get("id", ""))
			if cid in _fill_ticked:
				order.append(cid)
		var reply: Variant = await _req("settings.fallback.fill", {"connectionIds": order, "models": _fill_models})
		if typeof(reply) == TYPE_DICTIONARY:
			_fill_added = int((reply as Dictionary).get("added", 0))
		_apply_view(reply)
		_rerender(), "primary")
	if not ready:
		fill.modulate.a = 0.5
	row.add_child(fill)
	row.add_child(_button("Close", func() -> void:
		_filling = false
		_rerender()))
	if _fill_added >= 0:
		var result := _helper(("Added %d entr%s." % [_fill_added, "y" if _fill_added == 1 else "ies"]) if _fill_added > 0 else "Nothing new to add.")
		result.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(result)
	column.add_child(row)
	panel.add_child(column)
	body.add_child(panel)


func _build_connections_section() -> void:
	var body := _section("Connections", "Saved ways to reach a provider: a name you choose, the key, and the endpoint if it needs one. Type a key once and use it in as many entries as you like.")
	for connection: Dictionary in _connections():
		var id := str(connection.get("id", ""))
		var card := PanelContainer.new()
		card.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.025), Color(1, 1, 1, 0.08), 8, 1, Vector4(12, 9.6, 12, 9.6)))
		var column := VBoxContainer.new()
		column.add_theme_constant_override("separation", 0)
		var head := HBoxContainer.new()
		head.add_theme_constant_override("separation", 8)
		var texts := VBoxContainer.new()
		texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		texts.add_theme_constant_override("separation", 2)
		var name := UI.label(str(connection.get("displayName", "")), _fs(0.82), UI.WHITE, 650)
		name.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		name.clip_text = true
		texts.add_child(name)
		texts.add_child(_helper(str(connection.get("summary", ""))))
		head.add_child(texts)
		var buttons := HBoxContainer.new()
		buttons.add_theme_constant_override("separation", 5)
		buttons.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		buttons.add_child(_button("Done" if _editing_connection == id else "Edit", func() -> void:
			await _flush_writes()
			_editing_connection = "" if _editing_connection == id else id
			if _editing_connection.is_empty():
				await _load_fallback()
			_rerender(), "row"))
		buttons.add_child(_button("✕", func() -> void:
			await _flush_writes()
			var question: Variant = await _req("settings.connection.removeQuestion", {"id": id})
			var text := str((question as Dictionary).get("question", "")) if typeof(question) == TYPE_DICTIONARY else ""
			if text.is_empty() or not await _confirm(text):
				return
			_fallback_call("settings.connection.remove", {"id": id}), "row", "Remove connection"))
		head.add_child(buttons)
		column.add_child(head)
		if _editing_connection == id:
			_gap(column, 12)
			_connection_fields(column, connection, int(connection.get("using", 0)))
		card.add_child(column)
		body.add_child(card)
		_gap(body, 7.2)
	_gap(body, 6.4)
	var row := HFlowContainer.new()
	row.add_theme_constant_override("h_separation", 6)
	row.add_theme_constant_override("v_separation", 6)
	row.add_child(_button("+ New connection", func() -> void:
		await _flush_writes()
		var reply: Variant = await _req("settings.connection.add", {"fields": {"provider": str(_fallback.get("defaultProvider", "gemini")), "name": ""}})
		if typeof(reply) == TYPE_DICTIONARY:
			_editing_connection = str((reply as Dictionary).get("id", ""))
		_apply_view(reply)
		_rerender(), "primary"))
	for template: Dictionary in _fallback.get("templates", []):
		var fields := template.duplicate()
		row.add_child(_button("+ %s" % str(template.get("name", "")), func() -> void:
			await _flush_writes()
			var reply: Variant = await _req("settings.connection.add", {"fields": fields})
			if typeof(reply) == TYPE_DICTIONARY:
				_editing_connection = str((reply as Dictionary).get("id", ""))
			_apply_view(reply)
			_rerender()))
	body.add_child(row)


func _build_requests_section() -> void:
	var body := _section("AI requests", "A free key allows a few hundred requests a day. These settings decide how many the game spends, and on what.")
	if _requests.is_empty():
		body.add_child(_helper(_last_error))
		return
	var used := int(_requests.get("used", 0))
	var limit := int(_requests.get("limit", 0))
	var share := float(_requests.get("share", 0.0))
	var top := HBoxContainer.new()
	var count := UI.label("%d of %d used today" % [used, limit], _fs(0.82), Color(1, 1, 1, 0.92), 800)
	count.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(count)
	var resets := UI.label("resets at %s" % str(_requests.get("resetText", "")), _fs(0.64), Color(1, 1, 1, 0.4))
	resets.size_flags_vertical = Control.SIZE_SHRINK_END
	top.add_child(resets)
	body.add_child(top)
	_gap(body, 6.4)
	var track := PanelContainer.new()
	track.custom_minimum_size.y = 6
	track.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.07), Color(0, 0, 0, 0), 999, 0))
	var fill_color := Color("#f87171") if share >= 0.9 else (Color("#fbbf24") if share >= 0.7 else BLUE_LIGHT)
	var fill := ShareBar.new(fill_color, share)
	fill.custom_minimum_size.y = 6
	track.add_child(fill)
	body.add_child(track)
	var parts := ""
	if typeof(_requests.get("lastJump")) != TYPE_NIL:
		parts += "Your last time skip used %d. " % int(_requests.get("lastJump"))
	if int(_requests.get("background", 0)) > 0:
		parts += "Background AI has used %d of its %d. " % [int(_requests.get("background", 0)), int(_requests.get("backgroundCap", 0))]
	if int(_requests.get("refused", 0)) > 0:
		parts += "The provider turned away %d for coming too fast; those cost a wait, not allowance. " % int(_requests.get("refused", 0))
	var failed := int(_requests.get("failed", 0))
	if failed > 0:
		parts += ("1 request failed with an error. " if failed == 1 else "%d requests failed with an error. " % failed)
	parts += "Counted on this device, from midnight Pacific time, which is when a Gemini key's day begins."
	_add_helper(body, parts, 6.4)
	var tasks: Array = _requests.get("tasks", [])
	if not tasks.is_empty():
		_gap(body, 6.4)
		var open := bool(_details.get("requests", false))
		body.add_child(_summary_button("Used today, by task", open, func() -> void:
			_details["requests"] = not bool(_details.get("requests", false))
			_rerender()))
		if open:
			_gap(body, 4.8)
			for task: Dictionary in tasks:
				var line := HBoxContainer.new()
				var name := UI.label(str(task.get("label", "")), _fs(0.72), Color(1, 1, 1, 0.72))
				name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
				name.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
				name.clip_text = true
				line.add_child(name)
				line.add_child(UI.label(str(int(task.get("count", 0))), _fs(0.72), Color(1, 1, 1, 0.72)))
				body.add_child(line)
				_gap(body, 2.4)
	_gap(body, 15.2)
	var active := int(_requests.get("active", 0))
	var stop := PanelContainer.new()
	stop.add_theme_stylebox_override("panel", UI.box(Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.055), Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.18), 10, 1, Vector4(12, 11.2, 12, 11.2)))
	var stop_column := VBoxContainer.new()
	stop_column.add_theme_constant_override("separation", 0)
	var stop_row := HBoxContainer.new()
	stop_row.add_theme_constant_override("separation", 10)
	var stop_texts := VBoxContainer.new()
	stop_texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	stop_texts.add_theme_constant_override("separation", 3)
	stop_texts.add_child(UI.label("Emergency AI stop", _fs(0.76), Color(1, 1, 1, 0.9), 800))
	stop_texts.add_child(_helper("Cancels all live AI generation requests the client can abort, including retries and fallback attempts. It does not undo finished work; an already-submitted provider batch job, or an Android native-LAN request already inside the native HTTP plugin, cannot be recalled."))
	stop_row.add_child(stop_texts)
	var cancel := _button("Cancel all AI requests%s" % (" (%d)" % active if active > 0 else ""), func() -> void:
		var reply: Variant = await _req("settings.requests.cancelAll")
		if typeof(reply) == TYPE_DICTIONARY:
			var cancelled := int((reply as Dictionary).get("cancelled", 0))
			_cancel_notice = ("Cancel requested for %d active AI request%s." % [cancelled, "" if cancelled == 1 else "s"]) if cancelled > 0 else "No AI requests are currently running."
			var view: Variant = (reply as Dictionary).get("view")
			if typeof(view) == TYPE_DICTIONARY:
				_requests = view
		_rerender(), "diagnostics")
	cancel.add_theme_stylebox_override("normal", UI.box(Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.18) if active > 0 else Color(1, 1, 1, 0.06), Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.4) if active > 0 else Color(1, 1, 1, 0.13), 8, 1, Vector4(9.6, 7.2, 9.6, 7.2)))
	cancel.add_theme_font_override("font", UI.font(800))
	cancel.add_theme_color_override("font_color", Color("#fecaca") if active > 0 else Color(1, 1, 1, 0.72))
	cancel.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	stop_row.add_child(cancel)
	stop_column.add_child(stop_row)
	if not _cancel_notice.is_empty():
		_gap(stop_column, 7.2)
		stop_column.add_child(_helper(_cancel_notice, Color(1, 1, 1, 0.68)))
	stop.add_child(stop_column)
	body.add_child(stop)
	_gap(body, 15.2)
	var saving := bool(_requests.get("saving", true))
	_add_toggle(body, "Save AI requests", saving, func() -> void: _requests_set("saveRequests", not saving))
	if saving:
		_add_settings_helper(body, "On (default): a time skip is one request. Each event arrives as soon as it is written, already carrying what it changed: the map, your units and structures, your orders and your Projects board. Your spies' reports come back in the same answer, and so does the history document when older events are due to be folded into it. The model is handed the names it needs instead of looking them up, and a small mistake in its answer is cut out rather than asked for again. A skip takes a second request only when its answer could not be used at all, when a provider refuses the single-request form, or on a turn where something you switched on yourself falls due: the automatic Stats refresh, or NPC votes in an institution.")
	else:
		_add_settings_helper(body, "Off: for a key with no daily limit. A time skip is still one request, and with AI lookup functions on (below) the model may look things up before it answers: each round of questions is another request, two at most, so a skip never uses more than %d. On Gemini such a skip shows its events together at the end instead of one at a time. Outside a skip, a task may look things up in up to three extra requests, and a flawed answer is sent back to be redone instead of being cut down." % int(_requests.get("lookupCap", 3)))
	body.add_child(_field_label("Requests a day your key allows"))
	_gap(body, 6.4)
	body.add_child(_number_line(_daily_limit_draft, func(text: String) -> void: _daily_limit_draft = text, func() -> void: _requests_set("dailyLimit", _daily_limit_draft)))
	_add_helper(body, "Only used for the count above and to keep background AI from spending the end of your day. The game never stops you at the limit; your provider does.")
	_gap(body, 14.4)
	var background := bool(_requests.get("backgroundOn", true))
	_add_toggle(body, "Background AI", background, func() -> void: _requests_set("backgroundAi", not background))
	if background:
		_add_settings_helper(body, "On (default): while you are not skipping time, countries may write to you unprompted, forces may reposition, agents may file extra reports, and a country you look at gets its first intelligence reading — each of those is a request nobody pressed a button for, and together they stop at the daily cap below.")
		body.add_child(_field_label("Background requests a day, at most"))
		_gap(body, 6.4)
		body.add_child(_number_line(_background_cap_draft, func(text: String) -> void: _background_cap_draft = text, func() -> void: _requests_set("backgroundDailyCap", _background_cap_draft)))
		_add_helper(body, "It also stops by itself once less than a tenth of your day is left.")
	else:
		_add_settings_helper(body, "Off: the game only calls the model when you do something.", 0)


func _number_line(value: String, on_change: Callable, on_commit: Callable) -> LineEdit:
	var line := _line(value, "")
	line.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	line.custom_minimum_size.x = 144
	line.text_changed.connect(func(text: String) -> void:
		var digits := ""
		for character in text:
			if character >= "0" and character <= "9":
				digits += character
		if digits != text:
			line.text = digits
			line.caret_column = digits.length()
		on_change.call(digits))
	line.focus_exited.connect(func() -> void: on_commit.call())
	line.text_submitted.connect(func(_text: String) -> void: line.release_focus())
	return line


func _requests_set(field: String, value: Variant) -> void:
	var reply: Variant = await _req("settings.requests.set", {"field": field, "value": value})
	if typeof(reply) == TYPE_DICTIONARY:
		_requests = reply
		_daily_limit_draft = str(_requests.get("dailyLimit", ""))
		_background_cap_draft = str(_requests.get("backgroundDailyCap", ""))
	_render.call_deferred()


func _build_generation_section() -> void:
	var body := _section("Generation behavior", "Bound model waiting behavior without changing the deterministic fallback path.")
	if _for_game():
		_player_focus(body)
	else:
		body.add_child(_helper("Player focus is set for each game on its own: open the game, then ☰ → Settings → AI."))
		_gap(body, 12.8)
	var saving := bool(_requests.get("saving", true))
	var rows := [
		["ai_limit_generation", "Limit AI generation", "Off (default): waits as long as the model needs, however stuck. On: the game stops waiting and falls back to canned events when the model goes quiet — 5 minutes of silence part-way through an answer, or 15 minutes with no answer at all. A model that is still writing is never interrupted, however long it takes. Cancel works either way.", ""],
		["ai_chunk_long_jumps", "Generate long time skips in segments", "Off (default): the whole skip is generated in a single request. On: skips of more than a few months are generated in several shorter requests and merged into one round — slower and costlier in tokens, but far less likely to time out on a hosted provider.", ""],
		["ai_lookup_functions", "AI lookup functions", "Only used while Save AI requests (above) is off, because every lookup is a whole extra request. On: before it answers, the model can call lookup functions — the exact power and region names, a region's neighbours, the war ledger, a chat — in up to three extra requests per task, and two inside a time skip. Off: one request per task, with the region lists and ledgers written into the prompt instead. Needs a provider that supports function calling.", "Paused while Save AI requests is on" if saving else ""],
		["ai_live_skip_events", "Show time skip events as they are written", "On (default): a skip opens the Events panel and fills it as the model writes, with the spinner and Cancel underneath. Reveal with Next event as they arrive, and the map and camera follow; wherever you get to is kept when the turn lands. Off: the skip stays behind the Timeline panel's spinner and the round appears at the end. The turn itself is the same either way. On Gemini, a skip that may look things up (Save AI requests off) still arrives all at once.", ""],
		["ai_stop_on_player_failures", "Stop when my events fail", "Off (default): an event about your country that the game refuses is left out, and an order of yours that got no outcome carries over to the next skip as overdue. On: the skip stops before anything is saved and lists what failed. Retry the failed events (one more request, for the same dates), retry the whole skip, or keep it and move on.", ""],
		["ai_batch_background_tasks", "Batch background AI tasks", "Anthropic only. On: history consolidation runs through the Message Batches API at about half the price and lands a little later, applied between turns. Off (default): every task answers in the same call. Other providers are unaffected either way.", ""],
	]
	for index in range(rows.size()):
		var row: Array = rows[index]
		var key: String = row[0]
		_add_toggle(body, str(row[1]), _flag(key), func() -> void: _set_flag(key, not _flag(key)), false, str(row[3]))
		_add_settings_helper(body, str(row[2]), 0.0 if index == rows.size() - 1 else 12.0)


func _player_focus(body: VBoxContainer) -> void:
	body.add_child(_field_label("Player focus — for this game", 700))
	_gap(body, 6.4)
	var options: Array = [["", "Scenario default (%s)" % str(_focus.get("scenarioLabel", "Balanced"))]]
	for level: Dictionary in _focus.get("levels", []):
		options.append([str(level.get("key", "")), str(level.get("label", ""))])
	var following := bool(_focus.get("following", true))
	var select := _select(options, "" if following else str(_focus.get("focus", "balanced")), func(value: String) -> void:
		if str(_focus.get("gameId", "")).is_empty():
			_focus_error = "No game is open, so there is nothing to set it on."
			_rerender()
			return
		_focus_saving = true
		_focus_error = ""
		var reply: Variant = await _req("settings.focus.set", {"level": value})
		_focus_saving = false
		if typeof(reply) == TYPE_DICTIONARY:
			_focus = reply
		else:
			_focus_error = _last_error if not _last_error.is_empty() else "That could not be saved."
		_rerender())
	if _focus_saving or str(_focus.get("gameId", "")).is_empty():
		select.disabled = true
	body.add_child(select)
	_gap(body, 5.6)
	var focus := str(_focus.get("focus", "balanced"))
	for level: Dictionary in _focus.get("levels", []):
		var key := str(level.get("key", ""))
		var line := RichTextLabel.new()
		line.bbcode_enabled = true
		line.fit_content = true
		line.scroll_active = false
		line.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		line.mouse_filter = Control.MOUSE_FILTER_IGNORE
		line.add_theme_font_override("normal_font", UI.font(400))
		line.add_theme_font_override("bold_font", UI.font(700))
		line.add_theme_font_size_override("normal_font_size", _fs(0.72))
		line.add_theme_font_size_override("bold_font_size", _fs(0.72))
		line.add_theme_color_override("default_color", HELPER_INK)
		line.text = "[b]%s[/b] — %s" % [str(level.get("label", "")), str(PLAYER_FOCUS_HINTS.get(key, ""))]
		line.modulate.a = 1.0 if key == focus else 0.65
		body.add_child(line)
		_gap(body, 4)
	_gap(body, 2)
	body.add_child(_helper("It never invents events for you: in a quiet stretch the world fills the skip as usual, and what you have going on — orders, milestones due, wars, open threads — is what the share is measured against."))
	if not _focus_error.is_empty():
		_gap(body, 6)
		body.add_child(_helper(_focus_error, ERROR_INK))
	_gap(body, 14.4)


func _build_advanced() -> void:
	var ai_link := _button("AI settings", func() -> void: set_section("ai"), "link")
	var picks := _section("Per-task models", "Route individual AI tasks to a cheaper or a stronger model from your list. A task tries its pick first, then the list from the top, so it only fails when every model is used up.", ai_link)
	_task_picks(picks)
	var console := _button("Open console", func() -> void: open_debug_console.emit(), "link")
	var telemetry := _section("Telemetry", "What the AI debug console can show about every call.", console)
	_add_toggle(telemetry, "Record AI telemetry", bool(_values.get("telemetry", true)), func() -> void:
		var reply: Variant = await _req("settings.telemetry", {"value": not bool(_values.get("telemetry", true))})
		if typeof(reply) == TYPE_DICTIONARY:
			_values = reply)
	_add_settings_helper(telemetry, "Keeps every AI call — prompt, answer, model, tokens, latency, validation verdict — in this browser for the AI debug console (200 across sessions). Off: the console sees this session only. Keys are never recorded.")
	_add_toggle(telemetry, "Rate AI generations", bool(_values.get("rating", false)), func() -> void:
		var reply: Variant = await _req("settings.rating", {"value": not bool(_values.get("rating", false))})
		if typeof(reply) == TYPE_DICTIONARY:
			_values = reply)
	_add_settings_helper(telemetry, "A small 1-10 bar after each time skip, Game Master edit and interactive event. Ratings sit beside the call in the console and its exports.", 0)
	var network := _section("Network", "Other devices — the Android app, a browser on another computer — reach this server only while you say so.")
	_network_sharing(network)
	var storage := _section("Storage", "What this server keeps on disk for you.")
	_download_cache(storage)
	var diagnostics := _section("Diagnostics", "The log a bug report needs. Copy it for Discord, save it for a GitHub issue.")
	_diagnostics_panel(diagnostics)


func _task_picks(body: VBoxContainer) -> void:
	var with_connection: Array = []
	for entry: Dictionary in _entries():
		if typeof(entry.get("resolved")) == TYPE_DICTIONARY:
			with_connection.append(entry)
	var picks: Dictionary = _fallback.get("picks", {})
	var active := 0
	for key: String in picks.keys():
		for entry: Dictionary in with_connection:
			if str(entry.get("id", "")) == str(picks[key]):
				active += 1
				break
	var toggle := Button.new()
	toggle.focus_mode = Control.FOCUS_NONE
	toggle.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	toggle.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	toggle.custom_minimum_size.y = 34
	var normal := UI.box(Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.1), 8, 1)
	for state in ["normal", "focus"]:
		toggle.add_theme_stylebox_override(state, normal)
	for state in ["hover", "pressed", "hover_pressed"]:
		toggle.add_theme_stylebox_override(state, UI.box(Color(1, 1, 1, 0.1), Color(1, 1, 1, 0.16), 8, 1))
	var row := HBoxContainer.new()
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	row.offset_left = 12
	row.offset_right = -12
	var left := UI.label("Per-task models%s" % (" (%d set)" % active if active > 0 else ""), _fs(0.78), SLATE_INK, 600)
	left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	left.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	left.size_flags_vertical = Control.SIZE_FILL
	row.add_child(left)
	var right := UI.label("Hide" if _tasks_expanded else "Show", _fs(0.78), SLATE_INK, 600)
	right.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	right.size_flags_vertical = Control.SIZE_FILL
	row.add_child(right)
	toggle.add_child(row)
	toggle.pressed.connect(func() -> void:
		_tasks_expanded = not _tasks_expanded
		_rerender())
	body.add_child(toggle)
	if not _tasks_expanded:
		return
	_gap(body, 9.6)
	var groups: Array[String] = []
	for task: Dictionary in _fallback.get("routing", []):
		var group := str(task.get("group", ""))
		if not group in groups:
			groups.append(group)
	for group in groups:
		_gap(body, 8)
		var heading := UI.label(group, _fs(0.76), Color(1, 1, 1, 0.8), 700)
		body.add_child(heading)
		_gap(body, 6.4)
		for task: Dictionary in _fallback.get("routing", []):
			if str(task.get("group", "")) != group:
				continue
			var key := str(task.get("key", ""))
			body.add_child(_field_label(str(task.get("label", ""))))
			_gap(body, 6.4)
			var options: Array = [["", "Start at the top of the list"]]
			var current := str(picks.get(key, ""))
			var known := false
			for index in range(with_connection.size()):
				var entry: Dictionary = with_connection[index]
				options.append([str(entry.get("id", "")), "%d. %s" % [index + 1, str((entry["resolved"] as Dictionary).get("label", ""))]])
				if str(entry.get("id", "")) == current:
					known = true
			body.add_child(_select(options, current if known else "", func(value: String) -> void: _fallback_call("settings.taskPick", {"key": key, "entryId": value})))
			_add_helper(body, str(task.get("hint", "")))
			_gap(body, 14.4)


func _network_sharing(body: VBoxContainer) -> void:
	if typeof(_network) != TYPE_DICTIONARY:
		body.add_child(_helper("No local server is behind this build, so there is nothing to share."))
		return
	var state: Dictionary = _network
	var locked := bool(state.get("lockedByEnv", false))
	var lan := bool(state.get("lanEnabled", false))
	var toggle := _add_toggle(body, "Let other devices connect", lan, func() -> void: _network_change({"lanEnabled": not lan}, "Let other devices connect", "lanEnabled"))
	if locked:
		toggle.modulate.a = 0.5
		_dim(toggle, "Set by the OH_HOST environment variable.")
		toggle.modulate.a = 0.5
	if locked:
		_add_text_helper(body, "Set by the OH_HOST environment variable (%s), so this switch is read-only. Unset it to control sharing from here." % str(state.get("host", "")))
	else:
		_add_text_helper(body, "On: the Android app and browsers on other computers can reach this server. Off (default): only this machine can.")
	if lan:
		var relay_locked := bool(state.get("relayLockedByEnv", false))
		var relay := bool(state.get("relayForLan", false))
		var relay_toggle := _add_toggle(body, "Let other devices send AI calls through this server", relay, func() -> void: _network_change({"relayForLan": not relay}, "Let other devices send AI calls through this server", "relayForLan"))
		if relay_locked:
			_dim(relay_toggle, "Set by the OH_ALLOW_REMOTE_RELAY environment variable.")
			relay_toggle.modulate.a = 0.5
		_add_text_helper(body, "Set by the OH_ALLOW_REMOTE_RELAY environment variable, so this switch is read-only." if relay_locked else "For a browser on another device whose AI runs on this computer (LM Studio, Ollama) and refuses calls from other sites. Anyone on your network could send requests through this server while it is on.")
		var addresses: Array = state.get("addresses", [])
		if not addresses.is_empty():
			var box := PanelContainer.new()
			box.add_theme_stylebox_override("panel", UI.box(Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.12), Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.35), 8, 1, Vector4(9.6, 8, 9.6, 8)))
			var column := VBoxContainer.new()
			column.add_theme_constant_override("separation", 3)
			var intro := UI.label("Type this into the Android app:", _fs(0.74), Color(1, 1, 1, 0.8))
			column.add_child(intro)
			for address: Dictionary in addresses:
				var line := HBoxContainer.new()
				line.add_theme_constant_override("separation", 4)
				var url := UI.label(str(address.get("url", "")), _fs(0.74), UI.WHITE, 600)
				url.add_theme_font_override("font", UI.font(600, "Consolas"))
				line.add_child(url)
				if addresses.size() > 1:
					line.add_child(UI.label("(%s)" % str(address.get("interface", "")), _fs(0.74), Color(1, 1, 1, 0.55)))
				column.add_child(line)
			box.add_child(column)
			body.add_child(box)
			_gap(body, 8)
		var warning := PanelContainer.new()
		warning.add_theme_stylebox_override("panel", UI.box(Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.12), Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.35), 8, 1, Vector4(9.6, 7.2, 9.6, 7.2)))
		var warning_text := UI.wrapped("This server has no password. Anyone on the same network can open, change and delete your games while this is on — fine at home, not on public Wi-Fi.", _fs(0.72), Color("#fbbf24"))
		warning.add_child(warning_text)
		body.add_child(warning)
		_gap(body, 6.4)
	if not _network_error.is_empty():
		body.add_child(_helper(_network_error, ERROR_INK))
		_gap(body, 6.4)


func _network_change(change: Dictionary, label_text: String, key: String) -> void:
	if _network_busy:
		return
	_network_busy = true
	_network_error = ""
	var reply: Variant = await _req("settings.network.set", {"body": change, "label": label_text, "key": key})
	_network_busy = false
	if typeof(reply) == TYPE_DICTIONARY:
		_network = (reply as Dictionary).get("state")
	else:
		_network_error = _last_error if not _last_error.is_empty() else "Could not change this."
	_rerender()


func _download_cache(body: VBoxContainer) -> void:
	var usage: Variant = (_cache as Dictionary).get("usage") if typeof(_cache) == TYPE_DICTIONARY else null
	if typeof(usage) != TYPE_DICTIONARY:
		body.add_child(_helper("No local server is behind this build, so nothing is stored here."))
		return
	var files := int((usage as Dictionary).get("files", 0))
	var size := str((_cache as Dictionary).get("size", ""))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	var text := "No community downloads are stored." if files == 0 else ("1 community download is stored (%s)." % size if files == 1 else "%d community downloads are stored (%s)." % [files, size])
	var label := UI.label(text, _fs(0.8), UI.WHITE)
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(label)
	var clear := _button("Clear download cache", func() -> void:
		if _cache_busy:
			return
		_cache_busy = true
		_cache_error = ""
		var reply: Variant = await _req("settings.cache.clear")
		_cache_busy = false
		if typeof(reply) == TYPE_DICTIONARY:
			_cache = reply
		else:
			_cache_error = _last_error if not _last_error.is_empty() else "Could not clear the download cache."
		_rerender(), "diagnostics")
	if _cache_busy or files == 0:
		clear.disabled = true
		clear.modulate.a = 0.5
	row.add_child(clear)
	body.add_child(row)
	_gap(body, 8)
	body.add_child(_helper("Scenarios, maps and flags you download from the community are kept so opening them again needs no new download. Past 1 GB, the ones used longest ago are removed on their own."))
	if not _cache_error.is_empty():
		_gap(body, 6.4)
		body.add_child(_helper(_cache_error, ERROR_INK))


func _attach_title(enabled: bool, game_name: String) -> String:
	var which := "“%s”" % game_name if not game_name.is_empty() else "the game you are playing"
	if enabled:
		return "Saves the log file, then %s as a .zip. Send both with the report: the log says what happened, the game is what it happened to." % which
	return "Logging is off, so there is no log to save — this saves %s as a .zip." % which


func _short_name(name: String) -> String:
	var text := name.strip_edges()
	return text.substr(0, 27) + "…" if text.length() > 28 else text


func _diagnostics_panel(body: VBoxContainer) -> void:
	var enabled := bool(_diag.get("enabled", true))
	var verbose := bool(_diag.get("verbose", false))
	var intro := UI.wrapped("The game keeps a running log of what you did — saves opened, orders queued, turns taken, and anything that went wrong. Send it with a bug report and it says what happened, in order. Saving it with the game attaches the campaign it happened in, which is what lets a fix be tested against it.", _fs(0.72), Color(1, 1, 1, 0.45))
	_line_height(intro, 1.35, 0.72)
	body.add_child(intro)
	_gap(body, 8.8)
	var copy_row := HBoxContainer.new()
	copy_row.add_theme_constant_override("separation", 8)
	var copy_text := "📋 Copy log"
	match _copy_state:
		"copied":
			copy_text = "✓ Copied!"
		"failed":
			copy_text = "Couldn't copy"
		"copying":
			copy_text = "Copying…"
	var copy := _button(copy_text, func() -> void:
		_copy_state = "copying"
		_rerender()
		var reply: Variant = await _req("settings.log.text")
		if typeof(reply) == TYPE_DICTIONARY:
			DisplayServer.clipboard_set(str((reply as Dictionary).get("text", "")))
			_copy_state = "copied"
		else:
			_copy_state = "failed"
		_rerender()
		await get_tree().create_timer(2.5).timeout
		_copy_state = "idle"
		_rerender(), "diagnostics")
	copy.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	copy.disabled = _copy_state == "copying"
	copy_row.add_child(copy)
	var save := _button("💾 Save log file", func() -> void:
		var reply: Variant = await _req("settings.log.save", {"dir": _export_dir()})
		if typeof(reply) == TYPE_DICTIONARY:
			_reveal(str((reply as Dictionary).get("path", "")))
		else:
			var text: Variant = await _req("settings.log.text")
			if typeof(text) == TYPE_DICTIONARY:
				DisplayServer.clipboard_set(str((text as Dictionary).get("text", "")))
				_copy_state = "copied"
				_rerender()
				await get_tree().create_timer(2.5).timeout
				_copy_state = "idle"
				_rerender(), "diagnostics")
	save.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	copy_row.add_child(save)
	if not enabled:
		copy_row.modulate.a = 0.45
	body.add_child(copy_row)
	_gap(body, 8)
	var game_name := str(_diag.get("gameName", ""))
	var attach_kind := str(_attach_state.get("kind", "idle"))
	var attach_text := ("💾 Save log file + game" if enabled else "💾 Save game")
	match attach_kind:
		"working":
			attach_text = "Packing the game…"
		"no game":
			attach_text = "No game open"
		"failed":
			attach_text = "Couldn't save the game"
		"saved":
			attach_text = "✓ Saved %s“%s” (%s)" % ["log + " if bool(_attach_state.get("enabled", enabled)) else "", _short_name(str(_attach_state.get("name", ""))), str(_attach_state.get("size", ""))]
	var attach := _button(attach_text, func() -> void:
		_attach_state = {"kind": "working"}
		_rerender()
		var reply: Variant = await _req("settings.log.saveGame", {"dir": _export_dir()})
		if typeof(reply) == TYPE_DICTIONARY:
			_attach_state = reply
			var paths: Array = (reply as Dictionary).get("paths", [])
			if not paths.is_empty():
				_reveal(str(paths[paths.size() - 1]))
		else:
			_attach_state = {"kind": "failed"}
		_rerender()
		await get_tree().create_timer(2.5 if str(_attach_state.get("kind", "")) == "no game" else 4.0).timeout
		_attach_state = {"kind": "idle"}
		_rerender(), "diagnostics", _attach_title(enabled, game_name))
	attach.disabled = attach_kind == "working"
	attach.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body.add_child(attach)
	_gap(body, 8)
	var view := _button("Hide log" if _log_viewing else "🔎 View log", func() -> void:
		_log_viewing = not _log_viewing
		if _log_viewing:
			await _load_log()
		_rerender(), "diagnostics")
	view.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body.add_child(view)
	_gap(body, 8)
	if _log_viewing:
		_log_viewer(body)
	var count_row := HBoxContainer.new()
	count_row.add_theme_constant_override("separation", 8)
	var count_column := VBoxContainer.new()
	count_column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	count_column.add_theme_constant_override("separation", 0)
	var count := int(_diag.get("count", 0))
	var count_text := "Not recorded." if false else ""
	if not enabled:
		count_text = "Not recording."
	elif _cleared:
		count_text = "Cleared."
	else:
		count_text = "%d %s · %s of %s" % [count, "entry" if count == 1 else "entries", str(_diag.get("bytesText", "")), str(_diag.get("limitText", ""))]
	count_column.add_child(UI.label(count_text, _fs(0.7), Color(1, 1, 1, 0.4)))
	var dropped := int(_diag.get("dropped", 0))
	if enabled and not _cleared and dropped > 0:
		count_column.add_child(UI.label("1 older entry dropped to stay within the limit" if dropped == 1 else "%d older entries dropped to stay within the limit" % dropped, _fs(0.7), Color(1, 1, 1, 0.4)))
	count_row.add_child(count_column)
	var clear := _button("Clear", func() -> void:
		var reply: Variant = await _req("settings.log.clear")
		if typeof(reply) == TYPE_DICTIONARY:
			_diag = reply
		_cleared = true
		_rerender()
		await get_tree().create_timer(2.5).timeout
		_cleared = false
		_rerender(), "diagnostics", "Empties the log. Do this just before reproducing a bug and the log will contain only the steps that caused it.")
	clear.add_theme_font_size_override("font_size", _fs(0.7))
	clear.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	count_row.add_child(clear)
	body.add_child(count_row)
	_gap(body, 8)
	var warning := UI.wrapped("Your API key is never included. Country names, your queued orders and error messages are%s — read it before posting it somewhere public." % (", and while detailed logging is on, everything you and the AI said to each other" if verbose else ""), _fs(0.68), Color(1, 1, 1, 0.38))
	body.add_child(warning)
	_gap(body, 16)
	_add_toggle(body, "Keep a diagnostics log", enabled, func() -> void:
		var reply: Variant = await _req("settings.log.enabled", {"value": not enabled})
		if typeof(reply) == TYPE_DICTIONARY:
			_diag = reply
		_rerender())
	_add_text_helper(body, "On by default. Off: nothing is recorded and the log on this device is deleted. The desktop app still notes its own start-up and server errors, which never include your campaign. Remembered across save changes and restarts.")
	_add_toggle(body, "Detailed logging", verbose, func() -> void:
		var reply: Variant = await _req("settings.log.verbose", {"value": not verbose})
		if typeof(reply) == TYPE_DICTIONARY:
			_diag = reply
		_rerender())
	_pull_up(body, 11.2)
	var details := VBoxContainer.new()
	details.add_theme_constant_override("separation", 2)
	var note := UI.wrapped("Off by default, and remembered like the switch above. Turn it on before reproducing a bug, then send the log. Adds:", _fs(0.72), Color(1, 1, 1, 0.45))
	details.add_child(note)
	for item: String in ["Every message to and from your advisor, in full", "Every diplomatic message, in full, with who said it to whom", "Letters the advisor drafted, and the notes countries send you", "Every AI task and what it answered, and why an answer was rejected", "What each turn changed in the world", "Every server request and every save, with sizes", "Which panels you opened", "Full error stacks and much longer details", "The game's routine console messages"]:
		var bullet := UI.wrapped("•  %s" % item, _fs(0.72), Color(1, 1, 1, 0.45))
		var indent := MarginContainer.new()
		indent.add_theme_constant_override("margin_left", 8)
		indent.add_child(bullet)
		details.add_child(indent)
	var tail := UI.wrapped("The log fills much faster while this is on, so it reaches less far back. It quotes your conversations word for word — read it before posting it somewhere public.", _fs(0.72), Color(1, 1, 1, 0.45))
	details.add_child(tail)
	body.add_child(details)


func _load_log() -> void:
	_log_entries = null
	var reply: Variant = await _req("settings.log.entries")
	if typeof(reply) == TYPE_DICTIONARY:
		_log_entries = (reply as Dictionary).get("entries", [])
		_log_status = str((reply as Dictionary).get("status", ""))
	else:
		_log_entries = []
	_log_expanded = -1


func _log_viewer(body: VBoxContainer) -> void:
	var buttons := HBoxContainer.new()
	buttons.add_theme_constant_override("separation", 8)
	var refresh := _button("Refresh", func() -> void:
		await _load_log()
		_rerender(), "diagnostics")
	refresh.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	buttons.add_child(refresh)
	var only := _button("Showing problems only" if _log_only_problems else "Showing everything", func() -> void:
		_log_only_problems = not _log_only_problems
		_rerender(), "diagnostics")
	only.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	buttons.add_child(only)
	body.add_child(buttons)
	_gap(body, 6.4)
	if _log_status == "unavailable":
		body.add_child(UI.label("The desktop app's own entries could not be read just now.", _fs(0.68), Color(1, 200 / 255.0, 97 / 255.0, 0.8)))
		_gap(body, 6.4)
	var frame := PanelContainer.new()
	frame.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0), Color(1, 1, 1, 0.1), 6, 1))
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_style_scrollbar(scroll)
	var rows := VBoxContainer.new()
	rows.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	rows.add_theme_constant_override("separation", 0)
	scroll.add_child(rows)
	frame.add_child(scroll)
	if typeof(_log_entries) != TYPE_ARRAY:
		rows.add_child(_note_line("Reading the log…"))
	else:
		var shown: Array = []
		for entry: Dictionary in _log_entries:
			if not _log_only_problems or bool(entry.get("problem", false)):
				shown.append(entry)
		if shown.is_empty():
			rows.add_child(_note_line("No problems logged." if _log_only_problems else "Nothing logged yet."))
		for index in range(mini(shown.size(), 400)):
			rows.add_child(_log_row(shown[index], index))
	var height := 0.0
	scroll.custom_minimum_size.y = 288.0 if typeof(_log_entries) == TYPE_ARRAY and (_log_entries as Array).size() > 8 else height
	if scroll.custom_minimum_size.y <= 0.0:
		scroll.custom_minimum_size.y = 120.0
	body.add_child(frame)
	_gap(body, 12.8)


func _note_line(text: String) -> Control:
	var margin := MarginContainer.new()
	_margins(margin, 9.6, 9.6, 9.6, 9.6)
	margin.add_child(UI.label(text, _fs(0.72), Color(1, 1, 1, 0.45)))
	return margin


func _log_row(entry: Dictionary, index: int) -> Control:
	var wrap := VBoxContainer.new()
	wrap.add_theme_constant_override("separation", 0)
	var margin := MarginContainer.new()
	_margins(margin, 7.2, 4.8, 7.2, 4.8)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 4)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 7)
	row.add_child(UI.label(str(entry.get("time", "")), _fs(0.72), Color(1, 1, 1, 0.4)))
	row.add_child(UI.label(str(entry.get("category", "")), _fs(0.72), Color("#ffb35c") if bool(entry.get("problem", false)) else Color(1, 1, 1, 0.55), 700))
	var repeat := int(entry.get("repeat", 0))
	var message := UI.label(str(entry.get("message", "")) + (" (×%d)" % repeat if repeat > 1 else ""), _fs(0.72), UI.WHITE)
	message.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	message.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	message.clip_text = true
	row.add_child(message)
	var detail := str(entry.get("detail", ""))
	if not detail.is_empty():
		row.add_child(UI.label("▾" if _log_expanded == index else "▸", _fs(0.72), Color(1, 1, 1, 0.35)))
	column.add_child(row)
	if _log_expanded == index and not detail.is_empty():
		var pre := PanelContainer.new()
		pre.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0.35), Color(0, 0, 0, 0), 6, 0, Vector4(7, 7, 7, 7)))
		var text := UI.wrapped(detail, _fs(0.68), Color(1, 1, 1, 0.8))
		text.add_theme_font_override("font", UI.font(400, "Consolas"))
		text.autowrap_mode = TextServer.AUTOWRAP_ARBITRARY
		pre.add_child(text)
		column.add_child(pre)
	margin.add_child(column)
	if not detail.is_empty():
		var hit := Button.new()
		hit.flat = true
		hit.focus_mode = Control.FOCUS_NONE
		hit.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		hit.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		for state in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
			hit.add_theme_stylebox_override(state, StyleBoxEmpty.new())
		hit.pressed.connect(func() -> void:
			_log_expanded = -1 if _log_expanded == index else index
			_rerender())
		margin.add_child(hit)
	wrap.add_child(margin)
	wrap.add_child(_rule(Color(1, 1, 1, 0.06)))
	return wrap


class ConfirmAnswer extends RefCounted:
	signal answered(value: bool)


class ShareBar extends Control:
	var color := Color.WHITE
	var share := 0.0

	func _init(fill: Color, amount: float) -> void:
		color = fill
		share = clampf(amount, 0.0, 1.0)
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func _draw() -> void:
		if share <= 0.0:
			return
		draw_style_box(UI.box(color, Color(0, 0, 0, 0), 3, 0), Rect2(Vector2.ZERO, Vector2(size.x * share, size.y)))


class Switch extends Button:
	var on := false
	var inactive := false
	var knob := 0.0

	func _init(enabled: bool, is_inactive: bool) -> void:
		on = enabled
		inactive = is_inactive
		knob = 1.0 if enabled else 0.0
		custom_minimum_size = Vector2(44, 24)
		focus_mode = Control.FOCUS_NONE
		mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		for state in ["normal", "hover", "pressed", "focus", "disabled", "hover_pressed"]:
			add_theme_stylebox_override(state, StyleBoxEmpty.new())

	func set_on(value: bool) -> void:
		on = value
		var tween := create_tween()
		tween.tween_method(_set_knob, knob, 1.0 if value else 0.0, 0.15)

	func _set_knob(value: float) -> void:
		knob = value
		queue_redraw()

	func _draw() -> void:
		var track := Color(1, 1, 1, 0.14)
		if on:
			track = Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.35) if inactive else Color("#3b82f6")
		draw_style_box(UI.box(track, Color(0, 0, 0, 0), 12, 0), Rect2(Vector2.ZERO, Vector2(44, 24)))
		draw_circle(Vector2(12.0 + 20.0 * knob, 12.0), 10.0, Color.WHITE, true, -1.0, true)
