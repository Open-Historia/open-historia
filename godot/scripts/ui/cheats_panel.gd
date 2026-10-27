class_name CheatsPanel
extends Control

signal closed
signal world_changed
signal open_forces
signal open_interactive
signal country_changed(country: String)

const PANEL_TOP := 76.0
const PANEL_RIGHT := 10.0
const NARROW := 408.0
const WIDE := 496.0
const WIDE_TOOLS := ["edit-country", "events", "history-document", "edit-feature", "add-feature"]
const STATUS_INK := Color(191 / 255.0, 219 / 255.0, 254 / 255.0, 0.9)
const FAIL_INK := Color("#fca5a5")
const ROSE := Color("#fda4af")
const GREEN := Color("#86efac")
const AMBER := Color("#fbbf24")
const BLUE_LINK := Color(147 / 255.0, 197 / 255.0, 253 / 255.0, 0.82)
const CE_NUMBER_FIELDS := {"populationM": [0.001, INF, 0.1], "gdpB": [0.001, INF, 0.1], "gdpGrowth": [-INF, INF, 0.1], "stability": [0.0, 100.0, 1.0], "inflation": [-1000.0, INF, 0.1], "unemployment": [0.0, 100.0, 0.1], "publicDebt": [0.0, INF, 0.1], "budgetBalance": [-INF, INF, 0.1], "sovereignty": [0.0, 100.0, 1.0], "foodAutonomy": [0.0, 100.0, 1.0], "energyAutonomy": [0.0, 100.0, 1.0], "economicIndependence": [0.0, 100.0, 1.0], "internalSecurity": [0.0, 100.0, 1.0], "internationalReputation": [0.0, 100.0, 1.0]}
const PUPPET_KINDS := [["protectorate", "Protectorate"], ["satellite", "Puppet state"], ["client", "Client state"]]
const PUPPET_SECRECY := [["open", "Openly known"], ["covert", "Covert"]]
const REPRESENTATION_OPTIONS := [["electoral", "Electoral"], ["court_factions", "Court factions"], ["party_state", "Party state"], ["elite_factions", "Elite factions"], ["military_factions", "Military factions"], ["revolutionary_factions", "Revolutionary factions"], ["colonial", "Colonial"], ["none", "None"]]
const REGIME_OPTIONS := [["democratic", "Democratic"], ["hybrid", "Hybrid"], ["authoritarian", "Authoritarian"], ["totalitarian", "Totalitarian"], ["theocratic", "Theocratic"], ["military", "Military"], ["colonial", "Colonial"], ["other", "Other"]]

const TOOLS := [
	{"id": "master-ai", "title": "GM Console", "subtitle": "Master AI · AI-assisted world intervention and canonical changes", "icon": "✦", "badge": "AI"},
	{"id": "reminders", "title": "Simulation Reminders", "subtitle": "Standing facts every AI in the game is told until you withdraw them — and what the next skip will hear", "icon": "❖", "badge": ""},
	{"id": "roll-back-turn", "title": "Roll Back Turn", "subtitle": "Restore the game to the start of an earlier turn", "icon": "↶", "badge": ""},
	{"id": "your-country", "title": "Play As Country", "subtitle": "Change which country you're currently controlling", "icon": "♛", "badge": ""},
	{"id": "difficulty", "title": "Difficulty", "subtitle": "Decide how things tend to go for you", "icon": "◈", "badge": ""},
	{"id": "annex-country", "title": "Annex Country", "subtitle": "Transfer an entire country's mapped territory", "icon": "⇢", "badge": ""},
	{"id": "annex-regions", "title": "Annex Regions", "subtitle": "Transfer individual map regions to another country", "icon": "⌖", "badge": ""},
	{"id": "edit-country", "title": "Country Editor", "subtitle": "Edit a country's identity and properties", "icon": "◆", "badge": ""},
	{"id": "add-country", "title": "Add Country", "subtitle": "Create a new polity for custom or fantasy campaigns", "icon": "+", "badge": "Advanced"},
	{"id": "regions", "title": "Region Inspector", "subtitle": "Inspect control, sovereignty, claims, and region identity", "icon": "▦", "badge": ""},
	{"id": "groups", "title": "Groups", "subtitle": "Cartels, militias, outbreaks: groups that control an area without owning it, and what each is", "icon": "⬡", "badge": ""},
	{"id": "puppets", "title": "Puppet States", "subtitle": "Protectorates, puppet states and client states: who answers to whom, how loyally, and ending it", "icon": "⛓", "badge": ""},
	{"id": "edit-feature", "title": "Map Feature Editor", "subtitle": "Inspect and edit runtime features and scenario cities", "icon": "◉", "badge": ""},
	{"id": "add-feature", "title": "Add Map Feature", "subtitle": "Place cities, HQs, landmarks, ports, and other world features", "icon": "+", "badge": ""},
	{"id": "clear-features", "title": "Clear Map Features", "subtitle": "Remove custom features or restore standard cities", "icon": "⌫", "badge": "Advanced"},
	{"id": "events", "title": "Event Editor", "subtitle": "Search, create, and repair canonical timeline events", "icon": "≡", "badge": ""},
	{"id": "interactive-event", "title": "Interactive Event", "subtitle": "Play any event on the record out as a scene, the way a time skip offers one now and then", "icon": "⚡", "badge": ""},
	{"id": "history-document", "title": "History Document", "subtitle": "Read and edit the living history the AI is given in place of older events; the timeline keeps every event", "icon": "≣", "badge": ""},
]

const TOOL_GROUPS := [
	{"title": "GM & History", "subtitle": "Intervene in the world, repair canon, or restore an earlier state.", "icon": "✦", "tools": ["master-ai", "reminders", "events", "interactive-event", "history-document", "roll-back-turn"]},
	{"title": "Countries & Territory", "subtitle": "Edit political actors, borders, and individual regions.", "icon": "◇", "tools": ["edit-country", "annex-country", "annex-regions", "regions", "groups", "puppets", "add-country"]},
	{"title": "Military", "subtitle": "Inspect and manually manipulate forces on the map.", "icon": "⚔", "tools": ["forces"]},
	{"title": "Simulation", "subtitle": "Change player control and simulation challenge settings.", "icon": "◈", "tools": ["difficulty", "your-country"]},
	{"title": "Map", "subtitle": "Manage visible cities, landmarks, and custom map features.", "icon": "⌖", "tools": ["edit-feature", "add-feature", "clear-features"]},
]

const MODE_OPTIONS := [
	{"id": "direct", "title": "Direct / OOC correction", "description": "Exact canonical/admin edits with the smallest possible scope."},
	{"id": "exact-event", "title": "Exact Event", "description": "Author one timeline event and all structured effects it establishes."},
	{"id": "world-intervention", "title": "World Intervention", "description": "Orchestrate a coherent multi-event change across territory, polities, wars, diplomacy, forces and Stats."},
]

const MAP_FEATURE_KINDS := [
	["city", "City / town", "●"], ["landmark", "Landmark", "•"], ["military hq", "Military HQ", "▲"], ["military base", "Military base", "▲"],
	["fortress", "Fortress", "▲"], ["airfield", "Airfield", "▲"], ["port", "Port", "■"], ["mine", "Mine or quarry", "◆"],
	["oil field", "Oil field", "◆"], ["industrial plant", "Industrial plant", "✦"], ["power plant", "Power plant", "✦"],
	["research facility", "Research facility", "✦"], ["embassy", "Embassy", "◇"], ["temporary marker", "Temporary", "•"], ["other", "Other", "+"],
]

const CITY_PROMINENCE := [[1, "Town"], [2, "City"], [3, "Major city"], [4, "Capital"]]

const STATUS_META := {
	"planned": ["Planned", "#e4e4e7"],
	"under_construction": ["Under construction", "#fcd34d"],
	"active": ["Active", "#86efac"],
	"damaged": ["Damaged", "#fca5a5"],
	"inactive": ["Inactive", "#d1d1d5"],
	"abandoned": ["Abandoned", "#fdba74"],
	"destroyed": ["Destroyed", "#f87171"],
}

var engine: EngineLink
var map_view: MapView
var context: Dictionary = {}
var _open := false
var _tool := ""
var _busy := false
var _status := ""
var _polities: Array = []
var _names: Dictionary = {}
var _game: Dictionary = {}
var _groups_on := true
var _s: Dictionary = {}
var _panel: GlassPanel
var _root_box: VBoxContainer
var _header_holder: VBoxContainer
var _scroll: ScrollContainer
var _body: VBoxContainer
var _toast: PanelContainer
var _toast_label: Label
var _picking := false
var _pick_handler: Callable
var _pick_queue: Array[Dictionary] = []
var _pick_running := false
var _render_serial := 0
var _ticker: Timer
var _gm_preview_node: Control
var _gm_generate_button: Button
var _list_holder: VBoxContainer
var _trait_inputs: Dictionary = {}
var _trait_tags: Dictionary = {}
var _trait_alias: Dictionary = {}
var _traits_json_edit: TextEdit
var _syncing := false
var _live_timer: Timer
var _live_kinds: Dictionary = {}


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_panel = GlassPanel.new(Color(24 / 255.0, 24 / 255.0, 27 / 255.0, 0.96), 18.0, Vector4(14, 14, 12, 14), Color(1, 1, 1, 0.1))
	_panel.anchor_left = 1.0
	_panel.anchor_right = 1.0
	_panel.offset_top = PANEL_TOP
	add_child(_panel)
	_root_box = VBoxContainer.new()
	_root_box.add_theme_constant_override("separation", 0)
	_panel.add_child(_root_box)
	_header_holder = VBoxContainer.new()
	_header_holder.add_theme_constant_override("separation", 0)
	_root_box.add_child(_header_holder)
	_scroll = ScrollContainer.new()
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_root_box.add_child(_scroll)
	var pad := MarginContainer.new()
	pad.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	pad.add_theme_constant_override("margin_right", 4)
	_scroll.add_child(pad)
	_body = VBoxContainer.new()
	_body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_body.add_theme_constant_override("separation", 0)
	pad.add_child(_body)
	_build_toast()
	_ticker = Timer.new()
	_ticker.wait_time = 1.0
	_ticker.timeout.connect(_on_tick)
	add_child(_ticker)
	_live_timer = Timer.new()
	_live_timer.one_shot = true
	_live_timer.wait_time = 0.3
	_live_timer.timeout.connect(_apply_live)
	add_child(_live_timer)
	visible = false
	_panel.visible = false
	get_viewport().size_changed.connect(_fit)


func setup(engine_link: EngineLink, setup_context: Dictionary) -> void:
	engine = engine_link
	context = setup_context
	if engine and not engine.engine_event.is_connected(_on_engine_event):
		engine.engine_event.connect(_on_engine_event)
	var view: Variant = setup_context.get("map_view")
	if view is MapView:
		map_view = view
		if not map_view.region_clicked.is_connected(_on_region_clicked):
			map_view.region_clicked.connect(_on_region_clicked)
	var game: Variant = setup_context.get("game")
	if typeof(game) == TYPE_DICTIONARY:
		_game = (game as Dictionary).duplicate()


func is_open() -> bool:
	return _open


func is_picking() -> bool:
	return _picking


func open() -> void:
	_open = true
	visible = true
	_panel.visible = true
	_tool = ""
	_status = ""
	_s = {}
	_ticker.start()
	_render()
	await refresh()


func close() -> void:
	var was_open := _open
	_open = false
	_picking = false
	_pick_handler = Callable()
	_toast.visible = false
	_panel.visible = false
	visible = false
	_tool = ""
	_s = {}
	_ticker.stop()
	if was_open:
		closed.emit()


func refresh() -> void:
	if not engine:
		return
	var reply: Dictionary = await engine.request("cheats.home")
	if reply.get("ok", false):
		var result: Dictionary = reply["result"]
		_polities = result.get("polities", [])
		_names = {}
		for polity in _polities:
			var entry: Dictionary = polity
			_names[str(entry.get("code", ""))] = str(entry.get("name", ""))
		_game = result.get("game", {})
		_groups_on = bool(result.get("groupsOn", true))
	else:
		_status = "Failed to load game data: %s" % str(reply.get("error", ""))
	if not _tool.is_empty():
		await _load_tool()
	_render()


func open_tool(id: String) -> void:
	if not _open:
		_open = true
		visible = true
		_panel.visible = true
		_ticker.start()
		if _polities.is_empty():
			await refresh()
	if id == "forces":
		open_forces.emit()
		return
	await _go(id)


func gm_preview(text: String, mode: String) -> Dictionary:
	if _tool != "master-ai":
		await open_tool("master-ai")
	_s["gm_mode"] = mode
	_s["gm_text"] = text
	_render()
	await _gm_generate()
	await get_tree().process_frame
	var view: Dictionary = _s.get("gm_view", {})
	return {"ok": not view.is_empty(), "error": "" if not view.is_empty() else _status, "summary": str(view.get("summary", ""))}


func edit_country(country: String) -> void:
	await open_tool("edit-country")
	var code := country
	var wanted := country.strip_edges().to_lower()
	for polity in _polities:
		var entry: Dictionary = polity
		if str(entry.get("code", "")).to_lower() == wanted or str(entry.get("name", "")).to_lower() == wanted:
			code = str(entry.get("code", ""))
			break
	await _ce_load(code)


func open_new_puppet() -> void:
	await open_tool("puppets")
	_s["pp_editing"] = ""
	_s["pp_form"] = _pp_defaults()
	_s["pp_armed"] = ""
	_status = ""
	_render()


func _go(tool: String) -> void:
	_tool = tool
	_status = ""
	_s = {}
	_render()
	if not tool.is_empty():
		await _load_tool()
		_render()


func _load_tool() -> void:
	match _tool:
		"reminders":
			await _load_into("cheats.reminders.get", {}, "rem")
		"roll-back-turn":
			var reply: Dictionary = await engine.request("cheats.rollback.list")
			_s["rb_points"] = reply["result"].get("points", []) if reply.get("ok", false) else []
		"difficulty":
			await _load_into("cheats.difficulty.levels", {}, "levels")
		"groups":
			await _load_into("cheats.groups.get", {}, "groups")
		"puppets":
			await _load_into("cheats.puppets.get", {}, "puppets")
		"edit-feature", "add-feature", "clear-features":
			await _load_into("cheats.features.get", {}, "features")
		"events":
			await _load_into("cheats.events.load", _event_query(), "ev")
		"interactive-event":
			await _load_into("cheats.interactive.get", {"search": _sv("ie_search"), "limit": int(_s.get("ie_limit", 30))}, "ie")
		"history-document":
			var history: Dictionary = await engine.request("cheats.history.get")
			if history.get("ok", false):
				_s["hd"] = history["result"]
				var document: Variant = (history["result"] as Dictionary).get("document")
				_s["hd_draft"] = str((document as Dictionary).get("text", "")) if typeof(document) == TYPE_DICTIONARY else ""
			else:
				_s["hd"] = {"document": null, "passes": [], "status": {"text": "Could not read the campaign: %s" % str(history.get("error", "")), "canFoldNow": false}, "totalEvents": 0}
				_s["hd_draft"] = ""


func _load_into(method: String, args: Dictionary, key: String) -> void:
	var reply: Dictionary = await engine.request(method, args)
	if reply.get("ok", false):
		_s[key] = reply["result"]
	else:
		_s[key] = {}
		_status = "Failed: %s" % str(reply.get("error", ""))


func _sv(key: String, fallback := "") -> String:
	return str(_s.get(key, fallback))


func _sd(key: String) -> Dictionary:
	var value: Variant = _s.get(key, {})
	return value if typeof(value) == TYPE_DICTIONARY else {}


func _name_of(code: String) -> String:
	if code.is_empty():
		return "unclaimed land"
	return str(_names.get(code, code))


func _set_busy(busy: bool) -> void:
	_busy = busy
	if busy:
		_status = ""
	_render()


func _run(method: String, args: Dictionary, done_message := "", writes := true) -> Dictionary:
	_set_busy(true)
	var reply: Dictionary = await engine.request(method, args)
	if reply.get("ok", false):
		var result: Variant = reply.get("result")
		var message := ""
		if typeof(result) == TYPE_STRING:
			message = str(result)
		elif typeof(result) == TYPE_DICTIONARY:
			message = str((result as Dictionary).get("message", ""))
		_status = message if not message.is_empty() else (done_message if not done_message.is_empty() else "Done.")
		if writes:
			world_changed.emit()
	else:
		_status = "Failed: %s" % str(reply.get("error", ""))
	_busy = false
	return reply


func _clear(node: Node) -> void:
	for child in node.get_children():
		node.remove_child(child)
		child.queue_free()


func _render() -> void:
	if not is_inside_tree():
		return
	_render_serial += 1
	var serial := _render_serial
	var keep := _scroll.scroll_vertical
	_clear(_header_holder)
	_clear(_body)
	_gm_preview_node = null
	_gm_generate_button = null
	_list_holder = null
	_trait_inputs = {}
	_trait_tags = {}
	_traits_json_edit = null
	if _tool.is_empty():
		_render_home()
	else:
		_render_tool()
	_fit()
	await get_tree().process_frame
	if serial != _render_serial:
		return
	_fit()
	_scroll.scroll_vertical = keep


func _fit() -> void:
	if not is_inside_tree() or not _panel:
		return
	var view := get_viewport_rect().size
	var width: float = min(WIDE if WIDE_TOOLS.has(_tool) else NARROW, view.x - 16.0)
	var max_h: float = max(160.0, view.y - PANEL_TOP - 16.0)
	var wanted := _header_holder.get_combined_minimum_size().y + _body.get_combined_minimum_size().y + 30.0
	var height: float = clamp(wanted, 120.0, max_h)
	_panel.offset_left = -PANEL_RIGHT - width
	_panel.offset_right = -PANEL_RIGHT
	_panel.offset_top = PANEL_TOP
	_panel.offset_bottom = PANEL_TOP + height


func _build_toast() -> void:
	_toast = PanelContainer.new()
	_toast.add_theme_stylebox_override("panel", UI.box(Color(24 / 255.0, 24 / 255.0, 27 / 255.0, 0.96), Color(0, 0, 0, 0.19), 12, 1, Vector4(14, 9, 14, 9)))
	_toast.anchor_left = 0.5
	_toast.anchor_right = 0.5
	_toast.offset_top = PANEL_TOP
	_toast.grow_horizontal = Control.GROW_DIRECTION_BOTH
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	_toast_label = UI.label("", 13, UI.WHITE)
	_toast_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	row.add_child(_toast_label)
	var done := _btn("Done", "primary", 13)
	done.custom_minimum_size.y = 28
	done.pressed.connect(_end_pick)
	row.add_child(done)
	_toast.add_child(row)
	_toast.visible = false
	add_child(_toast)


func _begin_pick(label: String, handler: Callable) -> void:
	_pick_handler = handler
	_picking = true
	_pick_queue.clear()
	_toast_label.text = label
	_toast.visible = true
	_toast.reset_size()
	_toast.offset_left = -_toast.get_combined_minimum_size().x * 0.5
	_toast.offset_right = _toast.get_combined_minimum_size().x * 0.5
	_panel.visible = false


func _end_pick() -> void:
	_picking = false
	_pick_handler = Callable()
	_toast.visible = false
	_panel.visible = _open
	_render()


func _on_region_clicked(index: int) -> void:
	if not _picking or not _pick_handler.is_valid():
		return
	_pick_queue.append({"index": index, "owner": map_view.region_owner(index) if map_view else "", "lnglat": _click_lnglat()})
	if _pick_running:
		return
	_pick_running = true
	while not _pick_queue.is_empty():
		var job: Dictionary = _pick_queue.pop_front()
		if _pick_handler.is_valid():
			await _pick_handler.call(job)
	_pick_running = false


func _click_lnglat() -> Vector2:
	if not map_view or not map_view.camera:
		return Vector2.ZERO
	var camera: Camera2D = map_view.camera
	var half := map_view.get_viewport_rect().size * 0.5
	var mouse := map_view.get_viewport().get_mouse_position()
	var point := camera.position + (mouse - half) / camera.zoom.x
	var lng := fposmod(point.x / MapView.WORLD_WIDTH * 360.0, 360.0) - 180.0
	var n := PI * (1.0 - 2.0 * point.y / MapView.WORLD_WIDTH)
	var lat := rad_to_deg(atan(sinh(n)))
	return Vector2(lng, lat)


func _on_engine_event(name: String, payload: Variant) -> void:
	if name != "cheats.live" or not _open or typeof(payload) != TYPE_DICTIONARY:
		return
	var kind := str((payload as Dictionary).get("kind", ""))
	if (kind == "world" and _tool in ["groups", "puppets"]) or (kind == "events" and _tool == "events"):
		_live_kinds[kind] = true
		if _live_timer.is_stopped():
			_live_timer.start(0.3)


func _typing_here() -> bool:
	var focused := get_viewport().gui_get_focus_owner() if is_inside_tree() else null
	return focused != null and (focused is LineEdit or focused is TextEdit) and _panel.is_ancestor_of(focused)


func _apply_live() -> void:
	if not _open or _live_kinds.is_empty():
		_live_kinds.clear()
		return
	if _busy or _picking or _typing_here():
		_live_timer.start(1.0)
		return
	var kinds := _live_kinds.duplicate()
	_live_kinds.clear()
	if kinds.has("world") and _tool in ["groups", "puppets"]:
		var tool := _tool
		await _load_tool()
		if tool == _tool and _open:
			_render()
	if kinds.has("events") and _tool == "events":
		if int(_s.get("ev_editing", -1)) < 0 and not bool(_s.get("ev_creating", false)):
			await _ev_reload_list()
		else:
			_live_kinds["events"] = true
			_live_timer.start(1.0)


func _on_tick() -> void:
	if not _open or _busy or _picking:
		return
	if _tool == "events" and bool(_sd("ev").get("anyPending", false)) and int(_s.get("ev_editing", -1)) < 0 and not bool(_s.get("ev_creating", false)):
		await _ev_reload_list()


func _esc(text: String) -> String:
	return text.replace("[", "[lb]")


func _hex(color: Color) -> String:
	return "#" + color.to_html(true)


func _gap(height: float) -> Control:
	var node := Control.new()
	node.custom_minimum_size.y = height
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return node


func _note(text: String, size := 11, color := Color(1, 1, 1, 0.48), weight := 400) -> Label:
	var node := UI.wrapped(text, size, color, weight)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


func _rich(bbcode: String, size := 11, color := Color(1, 1, 1, 0.7)) -> RichTextLabel:
	var node := RichTextLabel.new()
	node.bbcode_enabled = true
	node.fit_content = true
	node.scroll_active = false
	node.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	node.add_theme_font_override("normal_font", UI.font(400))
	node.add_theme_font_override("bold_font", UI.font(750))
	node.add_theme_font_override("italics_font", UI.font(400))
	node.add_theme_font_override("mono_font", UI.font(400, "Consolas"))
	for name in ["normal_font_size", "bold_font_size", "italics_font_size", "mono_font_size"]:
		node.add_theme_font_size_override(name, size)
	node.add_theme_color_override("default_color", color)
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.text = bbcode
	return node


func _field_label(text: String, top := 9.0) -> Control:
	var holder := VBoxContainer.new()
	holder.add_theme_constant_override("separation", 0)
	holder.add_child(_gap(top))
	holder.add_child(UI.label(text.to_upper(), 11, Color(1, 1, 1, 0.75), 700, "Arial", 1))
	holder.add_child(_gap(4))
	return holder


func _section_label(text: String) -> Label:
	return UI.label(text.to_upper(), 10, Color(1, 1, 1, 0.48), 850, "Arial", 1)


func _box(bg: Color, border: Color, radius := 9, margin := Vector4(9, 9, 9, 9), separation := 6) -> Array:
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", UI.box(bg, border, radius, 1, margin))
	panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", separation)
	panel.add_child(column)
	return [panel, column]


func _field_box(separation := 6) -> Array:
	return _box(Color(0, 0, 0, 0.22), Color(1, 1, 1, 0.11), 9, Vector4(9, 9, 9, 9), separation)


func _btn(text: String, kind := "plain", size := 13) -> Button:
	var node := Button.new()
	node.text = text
	node.focus_mode = Control.FOCUS_NONE
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var bg := Color(1, 1, 1, 0.06)
	var border := Color(1, 1, 1, 0.12)
	var ink := UI.WHITE
	match kind:
		"primary":
			bg = Color(1, 1, 1, 0.1)
			border = Color(1, 1, 1, 0.28)
		"danger":
			border = Color(244 / 255.0, 63 / 255.0, 94 / 255.0, 0.32)
			ink = ROSE
		"active":
			bg = Color(0, 0, 0, 0.42)
			border = Color(1, 1, 1, 0.28)
			ink = Color("#f4f4f5")
		"quiet":
			bg = Color(1, 1, 1, 0.05)
			border = Color(1, 1, 1, 0.1)
			ink = Color(1, 1, 1, 0.7)
		"link":
			bg = Color(0, 0, 0, 0)
			border = Color(0, 0, 0, 0)
			ink = BLUE_LINK
	var normal := UI.box(bg, border, 8, 1, Vector4(10, 5, 10, 5))
	var hover := normal.duplicate() as StyleBoxFlat
	if kind != "link":
		hover.bg_color = Color(bg.r, bg.g, bg.b, min(1.0, bg.a + 0.05))
		hover.border_color = Color(border.r, border.g, border.b, min(1.0, border.a + 0.08))
	for state in [["normal", normal], ["hover", hover], ["pressed", hover], ["hover_pressed", hover], ["focus", normal], ["disabled", normal]]:
		node.add_theme_stylebox_override(state[0], state[1])
	node.add_theme_font_override("font", UI.font(600))
	node.add_theme_font_size_override("font_size", size)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		node.add_theme_color_override(name, ink)
	node.add_theme_color_override("font_disabled_color", ink)
	node.custom_minimum_size.y = 32 if kind != "link" else 22
	return node


func _enable(node: BaseButton, enabled: bool) -> void:
	node.disabled = not enabled
	node.modulate = Color(1, 1, 1, 1.0 if enabled else 0.5)
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if enabled else Control.CURSOR_ARROW


func _wide(node: Control) -> Control:
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


func _line(value: String, placeholder: String, on_change: Callable) -> LineEdit:
	var node := LineEdit.new()
	node.text = value
	node.placeholder_text = placeholder
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.custom_minimum_size.y = 32
	node.add_theme_stylebox_override("normal", UI.box(Color(0, 0, 0, 0.28), Color(1, 1, 1, 0.16), 8, 1, Vector4(9, 4, 9, 4)))
	node.add_theme_stylebox_override("focus", UI.box(Color(0, 0, 0, 0.32), Color(1, 1, 1, 0.3), 8, 1, Vector4(9, 4, 9, 4)))
	node.add_theme_stylebox_override("read_only", UI.box(Color(0, 0, 0, 0.2), Color(1, 1, 1, 0.1), 8, 1, Vector4(9, 4, 9, 4)))
	node.add_theme_font_override("font", UI.font(400))
	node.add_theme_font_size_override("font_size", 13)
	node.add_theme_color_override("font_color", UI.WHITE)
	node.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.38))
	node.text_changed.connect(func(text: String) -> void: on_change.call(text))
	return node


func _number_line(value: String, placeholder: String, min_value: float, max_value: float, step: float, on_change: Callable) -> LineEdit:
	var holder := {"node": null}
	var node := _line(value, placeholder, func(text: String) -> void:
		var field: LineEdit = holder["node"]
		var kept := ""
		for character in text:
			if "0123456789+-.eE".contains(character):
				kept += character
		if kept != text:
			var caret := field.caret_column - (text.length() - kept.length())
			field.text = kept
			field.caret_column = clampi(caret, 0, kept.length())
		if str(field.get_meta("accepted", "")) == kept:
			return
		field.set_meta("accepted", kept)
		on_change.call(_number_value(kept)))
	holder["node"] = node
	node.set_meta("accepted", value)
	node.gui_input.connect(func(event: InputEvent) -> void:
		var key := event as InputEventKey
		if key == null or not key.pressed or (key.keycode != KEY_UP and key.keycode != KEY_DOWN):
			return
		node.accept_event()
		var current := _number_value(node.text)
		var number := current.to_float() if not current.is_empty() else 0.0
		var direction := 1.0 if key.keycode == KEY_UP else -1.0
		var base := min_value if is_finite(min_value) else 0.0
		var steps := (number - base) / step
		if not current.is_empty() and ((direction > 0.0 and number < min_value) or (direction < 0.0 and number > max_value)):
			number = min_value if direction > 0.0 else max_value
		elif absf(steps - roundf(steps)) < 0.000001:
			number = base + (roundf(steps) + direction) * step
		else:
			number = base + (floorf(steps) + (1.0 if direction > 0.0 else 0.0)) * step
		number = clampf(snappedf(number, 0.0000001), min_value, max_value)
		var shown := _number_text(number)
		node.text = shown
		node.caret_column = shown.length()
		node.text_changed.emit(shown))
	return node


static func _number_value(text: String) -> String:
	var pattern := RegEx.create_from_string("^-?(\\d+\\.?\\d*|\\.\\d+)([eE][-+]?\\d+)?$")
	return text if pattern.search(text) != null else ""


static func _number_text(value: float) -> String:
	if is_equal_approx(value, roundf(value)) and absf(value) < 1e15:
		return str(int(roundf(value)))
	var text := String.num(value, 7)
	if text.contains("."):
		text = text.rstrip("0").rstrip(".")
	return text


func _date_line(value: String, on_change: Callable) -> Control:
	var field := CheatsDateField.new(value)
	field.date_changed.connect(func(next: String) -> void: on_change.call(next))
	return field


func _area(value: String, placeholder: String, rows: int, on_change: Callable, max_chars := 0) -> TextEdit:
	var node := TextEdit.new()
	node.text = value
	node.placeholder_text = placeholder
	node.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.custom_minimum_size.y = rows * 19 + 16
	node.scroll_fit_content_height = false
	node.add_theme_stylebox_override("normal", UI.box(Color(0, 0, 0, 0.28), Color(1, 1, 1, 0.16), 8, 1, Vector4(9, 7, 9, 7)))
	node.add_theme_stylebox_override("focus", UI.box(Color(0, 0, 0, 0.32), Color(1, 1, 1, 0.3), 8, 1, Vector4(9, 7, 9, 7)))
	node.add_theme_stylebox_override("read_only", UI.box(Color(0, 0, 0, 0.22), Color(1, 1, 1, 0.1), 8, 1, Vector4(9, 7, 9, 7)))
	node.add_theme_font_override("font", UI.font(400))
	node.add_theme_font_size_override("font_size", 13)
	node.add_theme_color_override("font_color", UI.WHITE)
	node.add_theme_color_override("font_readonly_color", Color(1, 1, 1, 0.72))
	node.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.38))
	node.text_changed.connect(func() -> void:
		if max_chars > 0 and node.text.length() > max_chars:
			node.text = node.text.substr(0, max_chars)
			node.set_caret_column(node.text.length())
		on_change.call(node.text))
	return node


func _select(options: Array, value: String, placeholder: String, on_change: Callable) -> OptionButton:
	var node := OptionButton.new()
	node.focus_mode = Control.FOCUS_NONE
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.custom_minimum_size.y = 32
	node.fit_to_longest_item = false
	node.clip_text = true
	node.add_theme_stylebox_override("normal", UI.box(Color(0, 0, 0, 0.28), Color(1, 1, 1, 0.16), 8, 1, Vector4(9, 4, 9, 4)))
	node.add_theme_stylebox_override("hover", UI.box(Color(0, 0, 0, 0.32), Color(1, 1, 1, 0.24), 8, 1, Vector4(9, 4, 9, 4)))
	node.add_theme_stylebox_override("pressed", UI.box(Color(0, 0, 0, 0.32), Color(1, 1, 1, 0.24), 8, 1, Vector4(9, 4, 9, 4)))
	node.add_theme_stylebox_override("disabled", UI.box(Color(0, 0, 0, 0.2), Color(1, 1, 1, 0.1), 8, 1, Vector4(9, 4, 9, 4)))
	node.add_theme_font_override("font", UI.font(400))
	node.add_theme_font_size_override("font_size", 13)
	node.add_theme_color_override("font_color", UI.WHITE)
	var selected := -1
	if not placeholder.is_empty():
		node.add_item(placeholder)
		node.set_item_metadata(0, "")
		selected = 0
	for option in options:
		var pair: Array = option
		node.add_item(str(pair[1]))
		node.set_item_metadata(node.item_count - 1, str(pair[0]))
		if str(pair[0]) == value:
			selected = node.item_count - 1
	if selected >= 0:
		node.select(selected)
	node.item_selected.connect(func(index: int) -> void: on_change.call(str(node.get_item_metadata(index))))
	return node


func _polity_options() -> Array:
	var options: Array = []
	for polity in _polities:
		var entry: Dictionary = polity
		options.append([str(entry.get("code", "")), str(entry.get("name", ""))])
	return options


func _polity_select(value: String, placeholder: String, on_change: Callable) -> OptionButton:
	return _select(_polity_options(), value, placeholder, on_change)


func _check(text: String, value: bool, on_change: Callable, size := 11) -> CheckBox:
	var node := CheckBox.new()
	node.text = text
	node.button_pressed = value
	node.focus_mode = Control.FOCUS_NONE
	node.add_theme_font_override("font", UI.font(400))
	node.add_theme_font_size_override("font_size", size)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color"]:
		node.add_theme_color_override(name, Color(1, 1, 1, 0.85))
	node.toggled.connect(func(on: bool) -> void: on_change.call(on))
	return node


func _status_line(parent: Container) -> void:
	if _status.is_empty():
		return
	parent.add_child(_gap(8))
	parent.add_child(_note(_status, 12, FAIL_INK if _status.begins_with("Failed") else STATUS_INK))


func _pill_label(text: String, ink: Color, bg: Color, border: Color, size := 9, weight := 800, spacing := 1) -> PanelContainer:
	var holder := PanelContainer.new()
	holder.add_theme_stylebox_override("panel", UI.box(bg, border, 999, 1, Vector4(6, 2, 6, 2)))
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	holder.add_child(UI.label(text, size, ink, weight, "Arial", spacing))
	return holder


func _ignore_mouse(node: Node) -> void:
	for child in node.get_children():
		if child is Control and not (child is BaseButton) and not (child is LineEdit) and not (child is TextEdit):
			(child as Control).mouse_filter = Control.MOUSE_FILTER_IGNORE
			_ignore_mouse(child)


func _clickable(panel: PanelContainer, normal: StyleBoxFlat, hover: StyleBoxFlat, action: Callable) -> void:
	panel.add_theme_stylebox_override("panel", normal)
	panel.mouse_filter = Control.MOUSE_FILTER_STOP
	panel.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	_ignore_mouse(panel)
	panel.mouse_entered.connect(func() -> void: panel.add_theme_stylebox_override("panel", hover))
	panel.mouse_exited.connect(func() -> void: panel.add_theme_stylebox_override("panel", normal))
	panel.gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventMouseButton:
			var mouse := event as InputEventMouseButton
			if mouse.button_index == MOUSE_BUTTON_LEFT and not mouse.pressed:
				action.call())


func _details(title: String, key: String, default_open: bool, parent: Container, size := 11, weight := 800) -> VBoxContainer:
	var opened: bool = bool(_s.get("open:" + key, default_open))
	var toggle := _btn(("▾ " if opened else "▸ ") + title, "link", size)
	toggle.alignment = HORIZONTAL_ALIGNMENT_LEFT
	toggle.add_theme_font_override("font", UI.font(weight))
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		toggle.add_theme_color_override(name, Color(1, 1, 1, 0.82))
	toggle.pressed.connect(func() -> void:
		_s["open:" + key] = not opened
		_render())
	parent.add_child(toggle)
	var inner := VBoxContainer.new()
	inner.add_theme_constant_override("separation", 6)
	inner.visible = opened
	inner.set_meta("toggle", toggle)
	parent.add_child(inner)
	return inner


func _header(title: String, subtitle: String) -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 7)
	if not _tool.is_empty():
		var back := _btn("←", "plain", 13)
		back.custom_minimum_size = Vector2(30, 28)
		back.tooltip_text = "Back to the cheat tools"
		back.pressed.connect(func() -> void:
			if _picking:
				_end_pick()
			_go(""))
		row.add_child(back)
	var title_label := UI.label(title, 16, UI.WHITE, 800)
	title_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	title_label.clip_text = true
	row.add_child(title_label)
	var close_button := _btn("✕", "plain", 13)
	close_button.custom_minimum_size = Vector2(30, 28)
	close_button.tooltip_text = "Close cheats"
	close_button.pressed.connect(close)
	row.add_child(close_button)
	_header_holder.add_child(row)
	if not subtitle.is_empty():
		_header_holder.add_child(_gap(3))
		_header_holder.add_child(_note(subtitle, 12, Color(1, 1, 1, 0.5)))
	_header_holder.add_child(_gap(10))
	var rule := ColorRect.new()
	rule.color = Color(1, 1, 1, 0.08)
	rule.custom_minimum_size.y = 1
	_header_holder.add_child(rule)
	_header_holder.add_child(_gap(11))


func _tool_meta(id: String) -> Dictionary:
	for entry in TOOLS:
		var tool: Dictionary = entry
		if str(tool["id"]) == id:
			return tool
	return {}


func _icon_tile(glyph: String, size := 32.0) -> PanelContainer:
	var tile := PanelContainer.new()
	tile.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.1), 8, 1))
	tile.custom_minimum_size = Vector2(size, size)
	tile.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var label := UI.label(glyph, 14, Color("#f4f4f5"), 800)
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	tile.add_child(label)
	return tile


func _render_home() -> void:
	_header("Cheats", "Game Master, world editing, and simulation administration")
	var intro: Array = _box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.09), 11, Vector4(11, 10, 11, 10))
	var intro_row := HBoxContainer.new()
	intro_row.add_theme_constant_override("separation", 10)
	intro_row.add_child(_icon_tile("⌘", 34.0))
	var intro_text := VBoxContainer.new()
	intro_text.add_theme_constant_override("separation", 1)
	intro_text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	intro_text.add_child(UI.label("Canonical world tools", 12, UI.WHITE, 800))
	intro_text.add_child(_note("Edits become the current canonical state, not permanent locks. Normal simulation remains free to evolve them afterward.", 10, Color(1, 1, 1, 0.48)))
	intro_row.add_child(intro_text)
	(intro[1] as VBoxContainer).add_child(intro_row)
	_body.add_child(intro[0])
	_body.add_child(_gap(13))
	for group_entry in TOOL_GROUPS:
		var group: Dictionary = group_entry
		var head := HBoxContainer.new()
		head.add_theme_constant_override("separation", 7)
		var glyph := UI.label(str(group["icon"]), 12, Color("#e4e4e7"))
		glyph.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
		head.add_child(glyph)
		var titles := VBoxContainer.new()
		titles.add_theme_constant_override("separation", 1)
		titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		titles.add_child(UI.label(str(group["title"]).to_upper(), 11, UI.WHITE, 850, "Arial", 1))
		titles.add_child(_note(str(group["subtitle"]), 10, Color(1, 1, 1, 0.38)))
		head.add_child(titles)
		_body.add_child(head)
		_body.add_child(_gap(6))
		for tool_id in group["tools"]:
			var id := str(tool_id)
			if id == "forces":
				var forces := _tool_tile("⚔", "Force Manager", "Deploy, inspect, edit, and repair forces on the map", "2.0", func() -> void: open_forces.emit())
				_body.add_child(forces)
				_body.add_child(_gap(5))
				continue
			var meta := _tool_meta(id)
			if meta.is_empty() or (id == "groups" and not _groups_on):
				continue
			_body.add_child(_tool_tile(str(meta["icon"]), str(meta["title"]), str(meta["subtitle"]), str(meta.get("badge", "")), func() -> void: _go(id)))
			_body.add_child(_gap(5))
		_body.add_child(_gap(9))
	_status_line(_body)


func _tool_tile(glyph: String, title: String, subtitle: String, badge: String, action: Callable) -> PanelContainer:
	var tile := PanelContainer.new()
	tile.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	row.add_child(_icon_tile(glyph))
	var text := VBoxContainer.new()
	text.add_theme_constant_override("separation", 1)
	text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	text.add_child(UI.label(title, 12, UI.WHITE, 760))
	text.add_child(_note(subtitle, 10, Color(1, 1, 1, 0.45), 500))
	row.add_child(text)
	if not badge.is_empty():
		row.add_child(_pill_label(badge.to_upper(), Color(1, 1, 1, 0.52), Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.1)))
	tile.add_child(row)
	var normal := UI.box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.09), 10, 1, Vector4(11, 10, 11, 10))
	var hover := UI.box(Color(1, 1, 1, 0.08), Color(1, 1, 1, 0.16), 10, 1, Vector4(11, 10, 11, 10))
	_clickable(tile, normal, hover, func() -> void:
		if not tile.has_meta("dimmed"):
			action.call())
	return tile


func _render_tool() -> void:
	match _tool:
		"master-ai":
			_render_gm()
		"reminders":
			_render_reminders()
		"roll-back-turn":
			_render_rollback()
		"your-country":
			_render_play_as()
		"difficulty":
			_render_difficulty()
		"annex-country", "annex-regions":
			_render_annex()
		"edit-country":
			_render_country_editor()
		"add-country":
			_render_add_country()
		"regions":
			_render_regions()
		"groups":
			_render_groups()
		"puppets":
			_render_puppets()
		"edit-feature":
			_render_feature_editor()
		"add-feature":
			_render_add_feature()
		"clear-features":
			_render_clear_features()
		"events":
			_render_events()
		"interactive-event":
			_render_interactive()
		"history-document":
			_render_history()
		_:
			_render_home()


func _meta_header() -> void:
	var meta := _tool_meta(_tool)
	_header(str(meta.get("title", "")), str(meta.get("subtitle", "")))


func _gm_placeholder(mode: String) -> String:
	if mode == "direct":
		return "Example: \"Germany should have a population of 72 million and GDP of €500 billion. Do not add a timeline event.\""
	if mode == "exact-event":
		return "Example: \"On 4 March 1927 Britain and Germany sign a naval consultation accord. Make it major and notable, create the agreement, and set relations to +45.\""
	return "Example: \"Russia enters a constitutional crisis; Finland gains broad autonomy, Polish unrest spreads, Nicholas II replaces the government, and Russia asks Germany for consultations.\""


func _render_gm() -> void:
	_header("GM Console", "Unified GM · natural-language canonical transaction planner")
	var mode := _sv("gm_mode", "world-intervention")
	var info: Array = _box(Color(30 / 255.0, 64 / 255.0, 175 / 255.0, 0.09), Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.18), 9, Vector4(10, 9, 10, 9))
	(info[1] as VBoxContainer).add_child(_rich("[b][color=#bfdbfe]Preview → Apply.[/color][/b] Generate a transaction, inspect every canonical operation, then apply that exact preview. Apply performs no second AI call, revalidates the live world immediately before writing, and never advances the date or round.", 11, Color(219 / 255.0, 234 / 255.0, 254 / 255.0, 0.82)))
	_body.add_child(info[0])
	_body.add_child(_field_label("Mode", 10))
	var grid := GridContainer.new()
	grid.columns = 3
	grid.add_theme_constant_override("h_separation", 6)
	grid.add_theme_constant_override("v_separation", 6)
	for option_entry in MODE_OPTIONS:
		var option: Dictionary = option_entry
		var id := str(option["id"])
		var active := id == mode
		var card := PanelContainer.new()
		card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		card.custom_minimum_size.y = 74
		var column := VBoxContainer.new()
		column.add_theme_constant_override("separation", 3)
		column.add_child(_note(str(option["title"]), 12, Color("#f4f4f5") if active else Color(1, 1, 1, 0.8), 600))
		column.add_child(_note(str(option["description"]), 10, Color(1, 1, 1, 0.42)))
		card.add_child(column)
		var normal := UI.box(Color(0, 0, 0, 0.42) if active else Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.28) if active else Color(1, 1, 1, 0.1), 8, 1, Vector4(9, 9, 9, 9))
		var hover := UI.box(Color(0, 0, 0, 0.42) if active else Color(1, 1, 1, 0.08), Color(1, 1, 1, 0.3), 8, 1, Vector4(9, 9, 9, 9))
		_clickable(card, normal, hover, func() -> void:
			if _busy:
				return
			_s["gm_mode"] = id
			_s["gm_view"] = {}
			_s["gm_expanded"] = {}
			_render())
		grid.add_child(card)
	_body.add_child(grid)
	_body.add_child(_gap(4))
	_body.add_child(_field_label("GM request", 6))
	var request := _area(_sv("gm_text"), _gm_placeholder(mode), 5, func(text: String) -> void:
		_s["gm_text"] = text
		if not _sd("gm_view").is_empty():
			_s["gm_view"] = {}
			_s["gm_expanded"] = {}
			if is_instance_valid(_gm_preview_node):
				_gm_preview_node.queue_free()
				_gm_preview_node = null
		_gm_sync_button())
	_body.add_child(request)
	_body.add_child(_gap(9))
	_gm_generate_button = _btn("", "primary")
	_gm_generate_button.pressed.connect(func() -> void: _gm_generate())
	_body.add_child(_gm_generate_button)
	_gm_sync_button()
	_body.add_child(_gap(7))
	_body.add_child(_note("AI interpretation is constrained by the live native GM schema. Wars, relations, agreements and subordinations are structured objects now — no encoded string mini-language and no turn simulation path.", 11, Color(1, 1, 1, 0.42)))
	var view := _sd("gm_view")
	if not view.is_empty():
		_body.add_child(_gap(12))
		_gm_preview_node = _gm_preview_box(view)
		_body.add_child(_gm_preview_node)
	_status_line(_body)


func _gm_sync_button() -> void:
	if not is_instance_valid(_gm_generate_button):
		return
	var has_text := not _sv("gm_text").strip_edges().is_empty()
	_gm_generate_button.text = "Planning canonical transaction…" if _busy else ("Regenerate Preview" if not _sd("gm_view").is_empty() else "Generate Preview")
	_enable(_gm_generate_button, not _busy and has_text)
	if not has_text and not _busy:
		_gm_generate_button.modulate = Color(1, 1, 1, 0.6)


func _gm_generate() -> void:
	var text := _sv("gm_text").strip_edges()
	if text.is_empty() or _busy:
		return
	_set_busy(true)
	var reply: Dictionary = await engine.request("cheats.gm.preview", {"text": text, "mode": _sv("gm_mode", "world-intervention")})
	_s["gm_expanded"] = {}
	if reply.get("ok", false):
		var result: Dictionary = reply["result"]
		_s["gm_view"] = result.get("view", {})
		var summary := str(result.get("summary", ""))
		_status = "Preview ready — %s" % summary if not summary.is_empty() else "GM transaction preview ready. Nothing has been applied."
	else:
		_status = "Failed: %s" % str(reply.get("error", ""))
	_set_busy(false)


func _gm_apply() -> void:
	var view := _sd("gm_view")
	if view.is_empty() or _busy or bool(view.get("applied", false)):
		return
	_set_busy(true)
	var reply: Dictionary = await engine.request("cheats.gm.apply", {"id": str(view.get("id", ""))})
	if reply.get("ok", false):
		var result: Dictionary = reply["result"]
		_s["gm_view"] = result.get("view", view)
		var summary := str(result.get("summary", ""))
		_status = "Applied — %s" % summary if not summary.is_empty() else "Applied GM transaction %s." % str(result.get("transactionId", ""))
		world_changed.emit()
		refresh()
	else:
		_status = "Failed: %s" % str(reply.get("error", ""))
	_set_busy(false)


func _gm_preview_box(view: Dictionary) -> Control:
	var applied := bool(view.get("applied", false))
	var box: Array = _box(Color(0, 0, 0, 0.18), Color(1, 1, 1, 0.11), 10, Vector4(11, 11, 11, 11), 0)
	var column: VBoxContainer = box[1]
	var top := HBoxContainer.new()
	top.add_theme_constant_override("separation", 7)
	var titles := VBoxContainer.new()
	titles.add_theme_constant_override("separation", 2)
	titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	titles.add_child(UI.label("APPLIED · CANON UPDATED" if applied else "PREVIEW ONLY · NOTHING CHANGED", 10, GREEN if applied else Color("#93c5fd"), 800, "Arial", 1))
	var date := str(view.get("date", ""))
	titles.add_child(_note("%s · %s · source %s" % [date if not date.is_empty() else "Current date", str(view.get("mode", "")), str(view.get("source", "unknown"))], 10, Color(1, 1, 1, 0.42)))
	top.add_child(titles)
	top.add_child(_pill_label("APPLIED" if applied else "VALIDATED", GREEN, Color(0, 0, 0, 0), Color(74 / 255.0, 222 / 255.0, 128 / 255.0, 0.25), 10, 400, 0))
	column.add_child(top)
	column.add_child(_gap(9))
	var summary := str(view.get("summary", ""))
	column.add_child(_note(summary if not summary.is_empty() else "No summary returned.", 12, Color(1, 1, 1, 0.82)))
	column.add_child(_gap(9))
	var chips := HFlowContainer.new()
	chips.add_theme_constant_override("h_separation", 5)
	chips.add_theme_constant_override("v_separation", 5)
	for chip_entry in view.get("chips", []):
		var chip: Array = chip_entry
		var count := int(chip[1])
		chips.add_child(_pill_label("%s %d" % [str(chip[0]), count], Color(219 / 255.0, 234 / 255.0, 254 / 255.0, 0.95) if count > 0 else Color(1, 1, 1, 0.42), Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.13) if count > 0 else Color(1, 1, 1, 0.04), Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.28) if count > 0 else Color(1, 1, 1, 0.08), 10, 400, 0))
	column.add_child(chips)
	var events: Array = view.get("events", [])
	if not events.is_empty():
		column.add_child(_field_label("Authored events", 11))
		for event_entry in events:
			var event: Dictionary = event_entry
			var card: Array = _box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.08), 8, Vector4(9, 8, 9, 8), 4)
			var inner: VBoxContainer = card[1]
			inner.add_child(UI.label(str(event.get("heading", "")), 10, Color(147 / 255.0, 197 / 255.0, 253 / 255.0, 0.82)))
			var badges := HFlowContainer.new()
			badges.add_theme_constant_override("h_separation", 4)
			badges.add_theme_constant_override("v_separation", 4)
			for badge in event.get("badges", []):
				badges.add_child(_pill_label(str(badge), Color(1, 1, 1, 0.5), Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.09), 9, 400, 0))
			inner.add_child(badges)
			inner.add_child(_note(str(event.get("title", "")), 12, Color(1, 1, 1, 0.9), 650))
			inner.add_child(_note(str(event.get("description", "")), 11, Color(1, 1, 1, 0.54)))
			var combatants := str(event.get("combatants", ""))
			if not combatants.is_empty():
				inner.add_child(_note(combatants, 10, Color(1, 1, 1, 0.38)))
			column.add_child(card[0])
			column.add_child(_gap(5))
	column.add_child(_field_label("Exact canonical changes", 11))
	column.add_child(_note("These are the individual operations the Apply step would execute. Authored prose above is not a substitute for these state changes.", 10, Color(1, 1, 1, 0.38)))
	var expanded: Dictionary = _sd("gm_expanded")
	for section_entry in view.get("sections", []):
		var section: Dictionary = section_entry
		column.add_child(_gap(8))
		var head := HBoxContainer.new()
		head.add_theme_constant_override("separation", 6)
		var title := _rich("[b]%s[/b] [color=#93c5fdb8](%d)[/color]" % [_esc(str(section.get("title", ""))), int(section.get("count", 0))], 11, Color(1, 1, 1, 0.76))
		head.add_child(title)
		var note := str(section.get("note", ""))
		if not note.is_empty():
			var note_label := UI.label(note, 9, Color(1, 1, 1, 0.34))
			note_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
			head.add_child(note_label)
		column.add_child(head)
		var none := str(section.get("none", ""))
		var rows: Array = section.get("rows", [])
		var id := str(section.get("id", ""))
		var collapse := bool(section.get("collapse", false))
		if not none.is_empty():
			var none_card: Array = _box(Color(1, 1, 1, 0.03), Color(1, 1, 1, 0.07), 7, Vector4(8, 7, 8, 7), 2)
			(none_card[1] as VBoxContainer).add_child(_note(none, 10, Color(134 / 255.0, 239 / 255.0, 172 / 255.0, 0.72) if str(section.get("noneTone", "")) == "green" else Color(1, 1, 1, 0.66)))
			column.add_child(_gap(4))
			column.add_child(none_card[0])
			continue
		var shown := rows
		var is_open := bool(expanded.get(id, false))
		if collapse and not is_open and rows.size() > 4:
			shown = rows.slice(0, 4)
		for row_entry in shown:
			var row: Dictionary = row_entry
			column.add_child(_gap(4))
			column.add_child(_gm_row(row))
		if collapse and rows.size() > 4:
			var more := _btn("Show fewer" if is_open else "… %d more · click to show all" % (rows.size() - 4), "link", 10)
			more.alignment = HORIZONTAL_ALIGNMENT_LEFT
			more.pressed.connect(func() -> void:
				var next: Dictionary = _sd("gm_expanded").duplicate()
				next[id] = not is_open
				_s["gm_expanded"] = next
				_render())
			column.add_child(more)
	column.add_child(_gap(12))
	var apply := _btn("Applying canonical transaction…" if _busy else ("Applied ✓" if applied else "Apply Transaction"), "primary")
	apply.tooltip_text = "This exact transaction has already been applied." if applied else "Apply exactly the validated preview above. No second AI call."
	_enable(apply, not _busy and not applied)
	apply.pressed.connect(func() -> void: _gm_apply())
	for slot in ["normal", "hover", "pressed", "disabled", "focus", "hover_pressed"]:
		var lifted: Variant = apply.get_theme_stylebox(slot)
		if lifted is StyleBoxFlat:
			var shadowed := (lifted as StyleBoxFlat).duplicate() as StyleBoxFlat
			shadowed.shadow_color = Color(8 / 255.0, 12 / 255.0, 20 / 255.0, 0.88)
			shadowed.shadow_size = 24
			shadowed.shadow_offset = Vector2(0, -10)
			apply.add_theme_stylebox_override(slot, shadowed)
	var sticky := CheatsStickyBottom.new()
	sticky.button = apply
	sticky.scroller = _scroll
	sticky.limit = column
	column.add_child(sticky)
	column.add_child(_gap(6))
	var footer := _note("Applied as %s. Date and round were not advanced." % str(view.get("transactionId", "")) if applied else "Apply uses this exact preview, revalidates current canon, writes through native seams, and records a persistent GM audit entry.", 10, Color(134 / 255.0, 239 / 255.0, 172 / 255.0, 0.72) if applied else Color(1, 1, 1, 0.4))
	footer.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	column.add_child(footer)
	return box[0]


func _gm_row(row: Dictionary) -> Control:
	var card: Array = _box(Color(1, 1, 1, 0.03), Color(1, 1, 1, 0.07), 7, Vector4(8, 7, 8, 7), 2)
	var inner: VBoxContainer = card[1]
	var ref := str(row.get("ref", ""))
	var bbcode := "[b][color=#ffffffe0]%s[/color][/b]%s" % [_esc(str(row.get("strong", ""))), _esc(str(row.get("rest", "")))]
	if not ref.is_empty():
		bbcode += "[color=#ffffff57] · %s[/color]" % _esc(ref)
	inner.add_child(_rich(bbcode, 10, Color(1, 1, 1, 0.66)))
	var tones := {"note": Color(1, 1, 1, 0.42), "detail": Color(1, 1, 1, 0.5), "blue": Color(147 / 255.0, 197 / 255.0, 253 / 255.0, 0.62), "plain": Color(1, 1, 1, 0.66), "faint": Color(1, 1, 1, 0.3)}
	for line_entry in row.get("lines", []):
		var line: Dictionary = line_entry
		inner.add_child(_note(str(line.get("text", "")), 10, tones.get(str(line.get("tone", "note")), Color(1, 1, 1, 0.42))))
	return card[0]


func _render_reminders() -> void:
	_meta_header()
	var data := _sd("rem")
	var loaded := _s.has("rem")
	var limit := int(data.get("limit", 12))
	var max_chars := int(data.get("maxChars", 600))
	_body.add_child(_note("A reminder is a fact you declare for this game — \"the Kerch bridge is down\", \"the harvest has failed across the south\". The time skip, the checks after it, the advisor and every leader are told it on each call, ahead of the lore and the starting borders, until you withdraw it. Every AI sees every reminder, so keep secrets out of them.", 11))
	_body.add_child(_gap(9))
	var issue: Array = _field_box()
	var issue_column: VBoxContainer = issue[1]
	issue_column.add_child(_section_label("Issue a reminder"))
	var issue_button := _btn("Issue reminder", "primary")
	var draft := _area(_sv("rem_draft"), "The Kerch bridge is destroyed and cannot be crossed until it is rebuilt.", 3, func(text: String) -> void:
		_s["rem_draft"] = text
		_enable(issue_button, not _busy and not text.strip_edges().is_empty()), max_chars)
	issue_column.add_child(draft)
	_enable(issue_button, not _busy and not _sv("rem_draft").strip_edges().is_empty())
	issue_button.pressed.connect(func() -> void:
		var reply := await _run("cheats.reminders.add", {"text": _sv("rem_draft")}, "", true)
		if reply.get("ok", false):
			_s["rem_draft"] = ""
		await _load_into("cheats.reminders.get", {}, "rem")
		_render())
	issue_column.add_child(issue_button)
	_body.add_child(issue[0])
	_body.add_child(_gap(9))
	var standing: Array = _field_box(5)
	var standing_column: VBoxContainer = standing[1]
	var reminders: Array = data.get("reminders", [])
	standing_column.add_child(_section_label("Standing reminders · %d of %d" % [reminders.size(), limit]))
	if not loaded:
		standing_column.add_child(_note("Loading…"))
	elif reminders.is_empty():
		standing_column.add_child(_note("None. Every AI is working from the record alone."))
	var editing := _sv("rem_editing")
	for entry_value in reminders:
		var entry: Dictionary = entry_value
		var id := str(entry.get("id", ""))
		var card: Array = _box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.08), 8, Vector4(9, 8, 9, 8), 5)
		var card_column: VBoxContainer = card[1]
		if editing == id:
			card_column.add_child(_area(_sv("rem_edit_text"), "", 3, func(text: String) -> void: _s["rem_edit_text"] = text, max_chars))
			var buttons := HBoxContainer.new()
			buttons.add_theme_constant_override("separation", 6)
			var save := _wide(_btn("Save", "primary")) as Button
			_enable(save, not _busy)
			save.pressed.connect(func() -> void:
				var reply := await _run("cheats.reminders.edit", {"id": id, "text": _sv("rem_edit_text")})
				if reply.get("ok", false):
					_s["rem_editing"] = ""
				await _load_into("cheats.reminders.get", {}, "rem")
				_render())
			buttons.add_child(save)
			var cancel := _wide(_btn("Cancel")) as Button
			_enable(cancel, not _busy)
			cancel.pressed.connect(func() -> void:
				_s["rem_editing"] = ""
				_render())
			buttons.add_child(cancel)
			card_column.add_child(buttons)
		else:
			card_column.add_child(_note(str(entry.get("text", "")), 12, UI.WHITE))
			var foot := HBoxContainer.new()
			foot.add_theme_constant_override("separation", 5)
			var meta := UI.label(str(entry.get("meta", "")), 10, Color(1, 1, 1, 0.38))
			meta.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			meta.clip_text = true
			foot.add_child(meta)
			var edit := _btn("Edit", "plain", 10)
			edit.custom_minimum_size.y = 24
			_enable(edit, not _busy)
			edit.pressed.connect(func() -> void:
				_s["rem_editing"] = id
				_s["rem_edit_text"] = str(entry.get("text", ""))
				_render())
			foot.add_child(edit)
			var withdraw := _btn("Withdraw", "danger", 10)
			withdraw.custom_minimum_size.y = 24
			_enable(withdraw, not _busy)
			withdraw.pressed.connect(func() -> void:
				await _run("cheats.reminders.remove", {"id": id})
				if _sv("rem_editing") == id:
					_s["rem_editing"] = ""
				await _load_into("cheats.reminders.get", {}, "rem")
				_render())
			foot.add_child(withdraw)
			card_column.add_child(foot)
		standing_column.add_child(card[0])
	_body.add_child(standing[0])
	_body.add_child(_gap(9))
	var told: Array = _field_box(5)
	var told_column: VBoxContainer = told[1]
	told_column.add_child(_section_label("What the next time skip will be told"))
	told_column.add_child(_note("Every change made by hand this round — here, in the GM console or with any other tool in this panel. The skip hears them once, as acts of authority it must not undo.", 11))
	var pending: Array = data.get("pending", [])
	if pending.is_empty():
		told_column.add_child(_note("Nothing has been changed by hand this round.", 11))
	for change_value in pending:
		var change: Dictionary = change_value
		var card: Array = _box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.08), 8, Vector4(9, 8, 9, 8), 2)
		(card[1] as VBoxContainer).add_child(_rich("[b][color=#e4e4e7]%s[/color][/b]  %s" % [_esc(str(change.get("kind", "")).to_upper()), _esc(str(change.get("summary", "")))], 11, UI.WHITE))
		told_column.add_child(card[0])
	_body.add_child(told[0])
	_status_line(_body)


func _render_rollback() -> void:
	_meta_header()
	_body.add_child(_note("Restore the game to how it was at the start of an earlier turn. This permanently discards every turn played after the one you pick.", 12, Color(1, 1, 1, 0.55)))
	_body.add_child(_gap(8))
	if not _s.has("rb_points"):
		_body.add_child(_note("Loading restore points…", 12, Color(1, 1, 1, 0.5)))
		return
	var points: Array = _s["rb_points"]
	if points.is_empty():
		_body.add_child(_note("No restore points yet — one is captured automatically at the start of each turn. Play a turn, then come back.", 12, Color(1, 1, 1, 0.5)))
	var confirming := _sv("rb_confirm")
	for index in range(points.size()):
		var point: Dictionary = points[index]
		var id := str(point.get("id", ""))
		var date := str(point.get("fromDate", ""))
		var card: Array = _box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.08), 8, Vector4(9, 8, 9, 8))
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 6)
		var text := VBoxContainer.new()
		text.add_theme_constant_override("separation", 1)
		text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		text.add_child(UI.label("Round %d%s" % [int(point.get("round", 0)), " · %s" % date if not date.is_empty() else ""], 13, UI.WHITE, 700))
		text.add_child(UI.label("undoes the most recent turn" if index == 0 else "undoes the last %d turns" % (index + 1), 11, Color(1, 1, 1, 0.45)))
		row.add_child(text)
		if confirming == id:
			var confirm := _btn("Confirm", "primary", 12)
			_enable(confirm, not _busy)
			confirm.pressed.connect(func() -> void:
				var reply := await _run("cheats.rollback.apply", {"id": id})
				if reply.get("ok", false):
					_s["rb_points"] = (reply["result"] as Dictionary).get("points", [])
				_s["rb_confirm"] = ""
				await refresh())
			row.add_child(confirm)
			var cancel := _btn("Cancel", "plain", 12)
			cancel.pressed.connect(func() -> void:
				_s["rb_confirm"] = ""
				_render())
			row.add_child(cancel)
		else:
			var roll := _btn("Roll back", "plain", 12)
			_enable(roll, not _busy)
			roll.pressed.connect(func() -> void:
				_s["rb_confirm"] = id
				_render())
			row.add_child(roll)
		(card[1] as VBoxContainer).add_child(row)
		_body.add_child(card[0])
		_body.add_child(_gap(5))
	_status_line(_body)


func _render_play_as() -> void:
	_meta_header()
	var current := str(_game.get("country", ""))
	_body.add_child(_rich("Currently playing: [b]%s[/b]" % _esc(_name_of(current)), 12, Color(1, 1, 1, 0.6)))
	_body.add_child(_field_label("New country"))
	var target := _sv("pa_target")
	var switch := _btn("Switch country", "primary")
	_body.add_child(_polity_select(target, "Pick a country…", func(code: String) -> void:
		_s["pa_target"] = code
		_enable(switch, not _busy and not code.is_empty())))
	_body.add_child(_gap(9))
	_enable(switch, not _busy and not target.is_empty())
	switch.pressed.connect(func() -> void:
		var code := _sv("pa_target")
		var reply := await _run("cheats.country.play", {"code": code, "name": _name_of(code), "previousName": _name_of(current)})
		if reply.get("ok", false):
			country_changed.emit(code)
		await refresh())
	_body.add_child(switch)
	_status_line(_body)


func _render_difficulty() -> void:
	_meta_header()
	var levels: Array = _sd("levels").get("levels", [])
	var current := str(_game.get("difficulty", "medium"))
	var current_meta: Dictionary = {}
	for level_value in levels:
		var level: Dictionary = level_value
		if str(level.get("id", "")) == current:
			current_meta = level
	if current_meta.is_empty() and levels.size() > 2:
		current_meta = levels[2]
	var info: Array = _box(Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.21), 9, Vector4(11, 9, 11, 9), 4)
	var info_column: VBoxContainer = info[1]
	info_column.add_child(UI.label("HOW THINGS GO FOR YOU", 11, Color("#f4f4f5"), 700))
	info_column.add_child(_note("Difficulty decides how things tend to go for you. On the easy levels your orders usually succeed and luck breaks your way; on Medium the world is realistic; on the hard levels your orders fall short and luck breaks against you. At every level each outcome has a cause, and what you order is always attempted.", 11, Color(1, 1, 1, 0.72)))
	info_column.add_child(_note("On battlefields the level is also a stated handicap. Medium is realistic and fair. Above it the armies fighting you fight harder, advance faster and are reinforced more, hugely so on Impossible. Below it they are the ones held back.", 11, Color(1, 1, 1, 0.72)))
	_body.add_child(info[0])
	_body.add_child(_gap(9))
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 7)
	grid.add_theme_constant_override("v_separation", 7)
	for level_value in levels:
		var level: Dictionary = level_value
		var id := str(level.get("id", ""))
		var active := id == current
		var card := PanelContainer.new()
		card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		card.custom_minimum_size.y = 98
		var column := VBoxContainer.new()
		column.add_theme_constant_override("separation", 4)
		var top := HBoxContainer.new()
		top.add_theme_constant_override("separation", 7)
		var emoji := UI.label(str(level.get("emoji", "")), 18, UI.WHITE)
		emoji.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		top.add_child(emoji)
		var names := VBoxContainer.new()
		names.add_theme_constant_override("separation", 1)
		names.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var name_row := HBoxContainer.new()
		name_row.add_theme_constant_override("separation", 5)
		name_row.add_child(UI.label(str(level.get("label", "")), 12, UI.WHITE, 700))
		if active:
			name_row.add_child(_pill_label("ACTIVE", Color("#f4f4f5"), Color(1, 1, 1, 0.1), Color(1, 1, 1, 0.23), 8))
		names.add_child(name_row)
		names.add_child(_note(str(level.get("blurb", "")), 9, Color("#e4e4e7") if active else Color(1, 1, 1, 0.48)))
		top.add_child(names)
		column.add_child(top)
		column.add_child(_note(str(level.get("description", "")), 9, Color(1, 1, 1, 0.58)))
		card.add_child(column)
		var normal := UI.box(Color(0, 0, 0, 0.42) if active else Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.28) if active else Color(1, 1, 1, 0.1), 8, 1, Vector4(10, 9, 10, 9))
		var hover := UI.box(Color(0, 0, 0, 0.42) if active else Color(1, 1, 1, 0.09), Color(1, 1, 1, 0.3), 8, 1, Vector4(10, 9, 10, 9))
		_clickable(card, normal, hover, func() -> void:
			if _busy:
				return
			await _run("cheats.difficulty.set", {"id": id})
			await refresh())
		grid.add_child(card)
	_body.add_child(grid)
	_body.add_child(_gap(9))
	if not current_meta.is_empty():
		var behaviour: Array = _field_box(6)
		var column: VBoxContainer = behaviour[1]
		var head := HBoxContainer.new()
		var left := VBoxContainer.new()
		left.add_theme_constant_override("separation", 1)
		left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		left.add_child(UI.label("CURRENT BEHAVIOR", 9, Color(1, 1, 1, 0.48), 900, "Arial", 1))
		left.add_child(UI.label("%s %s" % [str(current_meta.get("emoji", "")), str(current_meta.get("label", ""))], 13, UI.WHITE, 800))
		head.add_child(left)
		var applies := UI.label("Applies from the next AI decision", 9, Color(1, 1, 1, 0.42))
		applies.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		head.add_child(applies)
		column.add_child(head)
		var profile_grid := GridContainer.new()
		profile_grid.columns = 2
		profile_grid.add_theme_constant_override("h_separation", 5)
		profile_grid.add_theme_constant_override("v_separation", 5)
		var profile: Dictionary = current_meta.get("profile", {})
		for pair in [["Player leniency", "playerLeniency"], ["NPC competence", "npcCompetence"], ["Consequence pressure", "consequencePressure"], ["Diplomatic firmness", "diplomaticFirmness"]]:
			var cell: Array = _box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.07), 7, Vector4(7, 6, 7, 6), 1)
			(cell[1] as VBoxContainer).add_child(UI.label(str(pair[0]).to_upper(), 8, Color(1, 1, 1, 0.4), 800, "Arial", 1))
			(cell[1] as VBoxContainer).add_child(UI.label(str(profile.get(pair[1], "")), 11, Color(1, 1, 1, 0.82), 700))
			profile_grid.add_child(cell[0])
		column.add_child(profile_grid)
		for effect in current_meta.get("effects", []):
			column.add_child(_rich("[color=#d4d4d8]◆[/color] %s" % _esc(str(effect)), 10, Color(1, 1, 1, 0.56)))
		_body.add_child(behaviour[0])
	_body.add_child(_gap(8))
	var neutral: Array = _box(Color(0, 0, 0, 0), Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.2), 8, Vector4(9, 8, 9, 8))
	(neutral[1] as VBoxContainer).add_child(_rich("[b][color=#bbf7d0d1]Difficulty-neutral systems:[/color][/b] GM/Cheats edits, canonical Stats arithmetic, geography resolution, territory/control semantics, timeline curation, and unit/territory directors. Difficulty cannot silently rewrite those systems.", 9, Color(1, 1, 1, 0.48)))
	_body.add_child(neutral[0])
	_status_line(_body)


func _render_annex() -> void:
	_meta_header()
	var whole := _tool == "annex-country"
	_body.add_child(_field_label("Annex into", 0))
	var target := _sv("ax_target")
	var start := _btn("Start clicking the map", "primary")
	_body.add_child(_polity_select(target, "Pick the new owner…", func(code: String) -> void:
		_s["ax_target"] = code
		_enable(start, not code.is_empty())))
	_body.add_child(_gap(9))
	_enable(start, not target.is_empty())
	start.pressed.connect(func() -> void:
		var owner := _sv("ax_target")
		var label := "Click the country to annex into %s" % _name_of(owner) if whole else "Click regions to hand to %s — Done when finished" % _name_of(owner)
		_begin_pick(label, func(job: Dictionary) -> void:
			if whole:
				var source := str(job.get("owner", ""))
				if source.is_empty() or source == owner:
					return
				var reply: Dictionary = await engine.request("cheats.annex.country", {"source": source, "owner": owner, "sourceName": _name_of(source), "ownerName": _name_of(owner)})
				if reply.get("ok", false):
					_status = str((reply["result"] as Dictionary).get("message", ""))
					if int((reply["result"] as Dictionary).get("moved", 0)) > 0:
						world_changed.emit()
				else:
					_status = "Failed: %s" % str(reply.get("error", ""))
			else:
				if int(job.get("index", -1)) < 0:
					return
				var region_reply: Dictionary = await engine.request("cheats.annex.region", {"index": int(job["index"]), "owner": owner, "ownerName": _name_of(owner)})
				if region_reply.get("ok", false):
					_status = str((region_reply["result"] as Dictionary).get("message", ""))
					world_changed.emit()
				else:
					_status = "Failed: %s" % str(region_reply.get("error", ""))))
	_body.add_child(start)
	_body.add_child(_gap(8))
	_body.add_child(_note("The map repaints ownership within ~5 seconds of each change.", 11, Color(1, 1, 1, 0.45)))
	_status_line(_body)


func _render_add_country() -> void:
	_meta_header()
	_body.add_child(_field_label("Name", 0))
	_body.add_child(_line(_sv("ac_name"), "Atlantis", func(text: String) -> void: _s["ac_name"] = text))
	_body.add_child(_field_label("Color (hex)"))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 7)
	var color_text := _sv("ac_color")
	var picker := ColorPickerButton.new()
	var hex := _line(color_text, "#a1a1aa", func(text: String) -> void:
		_s["ac_color"] = text
		if _valid_hex(text):
			picker.color = Color(text if text.begins_with("#") else "#" + text))
	hex.size_flags_horizontal = Control.SIZE_FILL
	hex.custom_minimum_size.x = 128
	row.add_child(hex)
	picker.custom_minimum_size = Vector2(42, 32)
	picker.color = Color(color_text if color_text.begins_with("#") else "#" + color_text) if _valid_hex(color_text) else Color("#a1a1aa")
	picker.edit_alpha = false
	picker.color_changed.connect(func(color: Color) -> void:
		_s["ac_color"] = "#" + color.to_html(false)
		hex.text = _sv("ac_color"))
	row.add_child(picker)
	_body.add_child(row)
	_body.add_child(_gap(11))
	var create := _btn("Create country", "primary")
	_enable(create, not _busy)
	create.pressed.connect(func() -> void:
		await _run("cheats.add_country", {"name": _sv("ac_name"), "color": _sv("ac_color")})
		await refresh())
	_body.add_child(create)
	_status_line(_body)


func _valid_hex(text: String) -> bool:
	var regex := RegEx.new()
	regex.compile("^#?[0-9a-fA-F]{6}$")
	return regex.search(text.strip_edges()) != null


func _render_country_editor() -> void:
	_header(str(_tool_meta(_tool).get("title", "")), "Identity, Political World, national baseline, and present-state administration")
	var banner: Array = _box(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.12), 11, Vector4(11, 10, 11, 10), 3)
	(banner[1] as VBoxContainer).add_child(UI.label("CANONICAL NOW · EVOLVABLE LATER", 10, Color("#f4f4f5"), 900, "Arial", 1))
	(banner[1] as VBoxContainer).add_child(_note("A manual edit sets the country's current baseline. Later wars, annexations, losses, growth, crises, and other world events remain free to change it.", 11, Color(1, 1, 1, 0.52)))
	_body.add_child(banner[0])
	_body.add_child(_gap(11))
	var target := _sv("ce_target")
	var pick := _btn("Pick another country on map →" if not target.is_empty() else "Pick a country on map →", "primary")
	_enable(pick, not _busy and map_view != null)
	pick.pressed.connect(func() -> void:
		_begin_pick("Click another country on the map to edit it" if not _sv("ce_target").is_empty() else "Click a country on the map to edit it", func(job: Dictionary) -> void:
			var owner := str(job.get("owner", "")).strip_edges().to_lower()
			var match_code := ""
			for polity in _polities:
				var entry: Dictionary = polity
				if not owner.is_empty() and (str(entry.get("code", "")).to_lower() == owner or str(entry.get("name", "")).to_lower() == owner):
					match_code = str(entry.get("code", ""))
					break
			if match_code.is_empty():
				_status = "Failed: that map area does not resolve to an editable country."
				_end_pick()
				return
			_status = "Selected %s." % _name_of(match_code)
			_picking = false
			_pick_handler = Callable()
			_toast.visible = false
			_panel.visible = _open
			await _ce_load(match_code)))
	_body.add_child(pick)
	_body.add_child(_gap(5))
	_body.add_child(_note("Click any owned region. The editor resolves the region's current live owner, not the map's historical provenance.", 10, Color(1, 1, 1, 0.4)))
	_body.add_child(_gap(9))
	var advanced: Array = _box(Color(0, 0, 0, 0.22), Color(1, 1, 1, 0.11), 9, Vector4(9, 6, 9, 6), 4)
	var advanced_inner := _details("Advanced · choose from country list", "ce_list", false, advanced[1], 11)
	advanced_inner.add_child(_polity_select(target, "Pick a country…", func(code: String) -> void:
		_status = ""
		_ce_load(code)))
	_body.add_child(advanced[0])
	if bool(_s.get("ce_loading", false)):
		_body.add_child(_gap(11))
		_body.add_child(_note("Loading canonical country state…", 12, Color(1, 1, 1, 0.5)))
	elif not target.is_empty() and _s.has("ce_form"):
		_render_country_form(target)
	_status_line(_body)


func _ce_load(code: String) -> void:
	_s["ce_target"] = code
	if code.is_empty():
		_s.erase("ce_form")
		_render()
		return
	_s["ce_loading"] = true
	_render()
	var reply: Dictionary = await engine.request("cheats.country.load", {"code": code, "fallbackName": _name_of(code)})
	_s["ce_loading"] = false
	if reply.get("ok", false):
		var result: Dictionary = reply["result"]
		_s["ce_form"] = (result.get("form", {}) as Dictionary).duplicate()
		_s["ce_baseline"] = (result.get("form", {}) as Dictionary).duplicate()
		_s["ce_components"] = int(result.get("componentCount", 0))
		_s["ce_per_capita"] = result.get("perCapita")
		var politics: Variant = result.get("politics")
		if typeof(politics) == TYPE_DICTIONARY:
			_s["ce_politics"] = (politics as Dictionary).duplicate(true)
			_s["ce_politics_base"] = (politics as Dictionary).duplicate(true)
		else:
			_s.erase("ce_politics")
			_s.erase("ce_politics_base")
		_s["ce_registry"] = result.get("registry", [])
		_s["ce_debug"] = result.get("debug") if typeof(result.get("debug")) == TYPE_DICTIONARY else {}
		_s["ce_decision"] = str(result.get("decisionContext", ""))
		_trait_alias = {}
		for entry_value in _s["ce_registry"]:
			var entry: Dictionary = entry_value
			var key := str(entry.get("key", ""))
			_trait_alias[_clean_trait_key(key)] = key
			for alias in entry.get("aliases", []):
				_trait_alias[_clean_trait_key(str(alias))] = key
	else:
		_status = "Failed: %s" % str(reply.get("error", ""))
	_render()


func _ce_value(key: String) -> String:
	return str(_sd("ce_form").get(key, ""))


func _ce_set(key: String, value: String) -> void:
	var form := _sd("ce_form")
	form[key] = value
	_s["ce_form"] = form


func _ce_per_capita_text() -> String:
	var population := _ce_value("populationM").to_float() * 1e6
	var gdp := _ce_value("gdpB").to_float() * 1e9
	var per_capita: float = -1.0
	if population > 0.0 and gdp > 0.0:
		per_capita = gdp / population
	elif _s.get("ce_per_capita") != null:
		per_capita = float(_s.get("ce_per_capita"))
	if per_capita < 0.0:
		return "—"
	var whole := str(int(round(per_capita)))
	var grouped := ""
	var count := 0
	for index in range(whole.length() - 1, -1, -1):
		grouped = whole[index] + grouped
		count += 1
		if count % 3 == 0 and index > 0:
			grouped = "," + grouped
	return "€" + grouped


func _ce_field(label: String, key: String, refresh_label: Label = null) -> Control:
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 4)
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.add_child(UI.label(label.to_upper(), 10, Color(1, 1, 1, 0.75), 700, "Arial", 1))
	var on_change := func(text: String) -> void:
		_ce_set(key, text)
		if refresh_label and is_instance_valid(refresh_label):
			refresh_label.text = _ce_per_capita_text()
	var limits: Array = CE_NUMBER_FIELDS.get(key, [])
	if limits.is_empty():
		column.add_child(_line(_ce_value(key), "", on_change))
	else:
		column.add_child(_number_line(_ce_value(key), "", float(limits[0]), float(limits[1]), float(limits[2]), on_change))
	return column


func _two_columns() -> GridContainer:
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 8)
	grid.add_theme_constant_override("v_separation", 8)
	grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return grid


func _render_country_form(target: String) -> void:
	_body.add_child(_gap(12))
	var identity: Array = _field_box(4)
	var identity_column: VBoxContainer = identity[1]
	identity_column.add_child(_section_label("Identity"))
	identity_column.add_child(UI.label("Stable key: %s" % target, 10, Color(1, 1, 1, 0.34)))
	identity_column.add_child(_field_label("Display name", 2))
	identity_column.add_child(_line(_ce_value("name"), "", func(text: String) -> void: _ce_set("name", text)))
	identity_column.add_child(_field_label("Color"))
	var color_row := HBoxContainer.new()
	color_row.add_theme_constant_override("separation", 7)
	var picker := ColorPickerButton.new()
	var hex := _line(_ce_value("color"), "#a1a1aa", func(text: String) -> void:
		_ce_set("color", text)
		if _valid_hex(text):
			picker.color = Color(text if text.begins_with("#") else "#" + text))
	color_row.add_child(hex)
	picker.custom_minimum_size = Vector2(45, 32)
	picker.edit_alpha = false
	var current_color := _ce_value("color")
	picker.color = Color(current_color if current_color.begins_with("#") else "#" + current_color) if _valid_hex(current_color) else Color(1, 1, 1, 0.22)
	picker.color_changed.connect(func(color: Color) -> void:
		_ce_set("color", "#" + color.to_html(false))
		hex.text = _ce_value("color"))
	color_row.add_child(picker)
	identity_column.add_child(color_row)
	_body.add_child(identity[0])
	_body.add_child(_gap(10))
	if _s.has("ce_politics"):
		var politics_box: Array = _field_box(6)
		_render_politics(politics_box[1])
		_body.add_child(politics_box[0])
	var components := int(_s.get("ce_components", 0))
	if components == 0:
		_body.add_child(_gap(10))
		var warn: Array = _box(Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.08), Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.24), 10, Vector4(11, 10, 11, 10))
		(warn[1] as VBoxContainer).add_child(_note("This country does not yet have a component-backed canonical Stats baseline. Identity can be edited now; open Stats → Economy once to establish the national baseline before editing GDP, population, or macro values here.", 11, Color(254 / 255.0, 243 / 255.0, 199 / 255.0, 0.88)))
		_body.add_child(warn[0])
	else:
		_body.add_child(_gap(10))
		var baseline: Array = _field_box(7)
		var baseline_column: VBoxContainer = baseline[1]
		var baseline_head := HBoxContainer.new()
		var baseline_label := _section_label("National baseline")
		baseline_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		baseline_head.add_child(baseline_label)
		baseline_head.add_child(UI.label("%d territorial component%s" % [components, "" if components == 1 else "s"], 10, Color(1, 1, 1, 0.38)))
		baseline_column.add_child(baseline_head)
		var per_capita_label := UI.label(_ce_per_capita_text(), 13, Color(1, 1, 1, 0.62))
		var grid := _two_columns()
		grid.add_child(_ce_field("Population (millions) · whole polity", "populationM", per_capita_label))
		grid.add_child(_ce_field("GDP (€ billions) · whole polity", "gdpB", per_capita_label))
		var derived := VBoxContainer.new()
		derived.add_theme_constant_override("separation", 4)
		derived.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		derived.add_child(UI.label("GDP / CAPITA · DERIVED", 10, Color(1, 1, 1, 0.75), 700, "Arial", 1))
		var derived_box := PanelContainer.new()
		derived_box.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0.28), Color(1, 1, 1, 0.16), 8, 1, Vector4(9, 7, 9, 7)))
		derived_box.add_child(per_capita_label)
		derived.add_child(derived_box)
		grid.add_child(derived)
		grid.add_child(_ce_field("GDP growth (%)", "gdpGrowth"))
		baseline_column.add_child(grid)
		var explain: Array = _box(Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.07), Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.18), 8, Vector4(9, 8, 9, 8))
		(explain[1] as VBoxContainer).add_child(_note("These are whole-polity targets. Changing population proportionally rescales population across every current territorial component. Changing GDP proportionally rescales each component's GDP per capita, preserving existing regional and colonial differences. The displayed GDP/capita is derived from the edited totals, and future simulation can still move all of these values naturally.", 10, Color(219 / 255.0, 234 / 255.0, 254 / 255.0, 0.72)))
		baseline_column.add_child(explain[0])
		_body.add_child(baseline[0])
		_body.add_child(_gap(10))
		var macro: Array = _field_box(7)
		(macro[1] as VBoxContainer).add_child(_section_label("Macroeconomy & administration"))
		var macro_grid := _two_columns()
		for pair in [["Capital", "capital"], ["Currency", "currency"], ["Continent / region", "continent"], ["Stability / 100", "stability"], ["Inflation (%)", "inflation"], ["Unemployment (%)", "unemployment"], ["Public debt (% GDP)", "publicDebt"], ["Budget balance (% GDP)", "budgetBalance"]]:
			macro_grid.add_child(_ce_field(str(pair[0]), str(pair[1])))
		(macro[1] as VBoxContainer).add_child(macro_grid)
		_body.add_child(macro[0])
		_body.add_child(_gap(10))
		var indices: Array = _field_box(6)
		var indices_inner := _details("Strategic indices", "ce_indices", false, indices[1], 11)
		var indices_grid := _two_columns()
		for pair in [["Sovereignty", "sovereignty"], ["Food autonomy", "foodAutonomy"], ["Energy autonomy", "energyAutonomy"], ["Economic independence", "economicIndependence"], ["Internal security", "internalSecurity"], ["International reputation", "internationalReputation"]]:
			indices_grid.add_child(_ce_field(str(pair[0]), str(pair[1])))
		indices_inner.add_child(indices_grid)
		_body.add_child(indices[0])
		_body.add_child(_gap(10))
		var sectors: Array = _field_box(6)
		var sectors_inner := _details("GDP sector breakdown", "ce_sectors", false, sectors[1], 11)
		_render_sector_sliders(sectors_inner)
		_body.add_child(sectors[0])
	_body.add_child(_gap(11))
	var actions := HBoxContainer.new()
	actions.add_theme_constant_override("separation", 7)
	var save := _wide(_btn("Save present-state edit", "primary")) as Button
	_enable(save, not _busy)
	save.pressed.connect(func() -> void:
		var code := _sv("ce_target")
		var payload := {"code": code, "form": _sd("ce_form"), "baseline": _sd("ce_baseline"), "componentCount": int(_s.get("ce_components", 0)), "fallbackName": _name_of(code)}
		if _s.has("ce_politics"):
			payload["politics"] = _sd("ce_politics")
			payload["politicsBaseline"] = _sd("ce_politics_base")
		var reply := await _run("cheats.country.save", payload)
		if reply.get("ok", false):
			var message := _status
			await refresh()
			await _ce_load(code)
			_status = message
			_render())
	actions.add_child(save)
	var reset := _btn("Reset")
	_enable(reset, not _busy)
	reset.pressed.connect(func() -> void: _ce_load(_sv("ce_target")))
	actions.add_child(reset)
	_body.add_child(actions)


func _render_sector_sliders(parent: VBoxContainer) -> void:
	var tones := {"agriculture": Color("#22c55e"), "industry": Color("#3b82f6"), "services": Color("#d4d4d8")}
	var bar := HBoxContainer.new()
	bar.add_theme_constant_override("separation", 0)
	bar.custom_minimum_size.y = 7
	var segments: Dictionary = {}
	var values: Dictionary = {}
	for pair in [["Agriculture", "agriculture"], ["Industry", "industry"], ["Services", "services"]]:
		var key := str(pair[1])
		var value: int = clampi(int(round(_ce_value(key).to_float())), 0, 100)
		var head := HBoxContainer.new()
		var label := UI.label(str(pair[0]).to_upper(), 10, Color(1, 1, 1, 0.75), 700, "Arial", 1)
		label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		head.add_child(label)
		var percent := UI.label("%d%%" % value, 11, tones[key], 900)
		values[key] = percent
		head.add_child(percent)
		parent.add_child(head)
		var slider := HSlider.new()
		slider.min_value = 0
		slider.max_value = 100
		slider.step = 1
		slider.value = value
		slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		slider.focus_mode = Control.FOCUS_NONE
		slider.drag_ended.connect(func(_changed: bool) -> void: _render())
		slider.value_changed.connect(func(next: float) -> void:
			_ce_rebalance(key, int(next))
			for other in ["agriculture", "industry", "services"]:
				var share: int = clampi(int(round(_ce_value(other).to_float())), 0, 100)
				(values[other] as Label).text = "%d%%" % share
				if segments.has(other):
					(segments[other] as Control).size_flags_stretch_ratio = max(0.001, float(share)))
		parent.add_child(slider)
	for key in ["agriculture", "industry", "services"]:
		var share: int = clampi(int(round(_ce_value(key).to_float())), 0, 100)
		var segment := ColorRect.new()
		segment.color = tones[key] if key != "services" else Color(1, 1, 1, 0.07)
		segment.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		segment.size_flags_stretch_ratio = max(0.001, float(share))
		segments[key] = segment
		bar.add_child(segment)
	parent.add_child(bar)
	parent.add_child(_note("Always totals 100%. Moving one sector keeps that value and redistributes the remainder across the other two in proportion to their current shares.", 10, Color(1, 1, 1, 0.34)))


func _ce_rebalance(key: String, next_value: int) -> void:
	var value: int = clampi(next_value, 0, 100)
	var others: Array[String] = []
	for candidate in ["agriculture", "industry", "services"]:
		if candidate != key:
			others.append(candidate)
	var remainder := 100 - value
	var current: Array[float] = [clampf(_ce_value(others[0]).to_float(), 0.0, 100.0), clampf(_ce_value(others[1]).to_float(), 0.0, 100.0)]
	var total := current[0] + current[1]
	var distributed: Array[int] = [0, 0]
	if remainder <= 0:
		distributed = [0, 0]
	elif total > 0.0:
		var exact: Array[float] = [remainder * (current[0] / total), remainder * (current[1] / total)]
		distributed = [int(floor(exact[0])), int(floor(exact[1]))]
		var left := remainder - distributed[0] - distributed[1]
		var order: Array[int] = [0, 1]
		if (exact[1] - floor(exact[1])) > (exact[0] - floor(exact[0])):
			order = [1, 0]
		for slot in order:
			if left <= 0:
				break
			distributed[slot] += 1
			left -= 1
	else:
		distributed = [int(floor(remainder / 2.0)), int(ceil(remainder / 2.0))]
	_ce_set(key, str(value))
	_ce_set(others[0], str(distributed[0]))
	_ce_set(others[1], str(distributed[1]))


func _render_regions() -> void:
	_meta_header()
	var intro: Array = _box(Color(1, 1, 1, 0.08), Color(1, 1, 1, 0.17), 10, Vector4(10, 9, 10, 9))
	(intro[1] as VBoxContainer).add_child(_rich("[b][color=#f4f4f5]Canonical now · evolvable later.[/color][/b] Region edits change the present territorial state only. Future wars, treaties and simulated events remain free to move it again.", 11, Color("#e4e4e7")))
	_body.add_child(intro[0])
	_body.add_child(_gap(9))
	var state := _sd("rg")
	var pick := _btn("Pick another region on map →" if not state.is_empty() else "Pick a region on map →", "primary")
	_enable(pick, not _busy and map_view != null)
	pick.pressed.connect(func() -> void:
		_begin_pick("Click a region on the map to inspect it", func(job: Dictionary) -> void:
			_status = ""
			if int(job.get("index", -1)) >= 0:
				var reply: Dictionary = await engine.request("cheats.regions.inspect", {"index": int(job["index"])})
				if reply.get("ok", false):
					_s["rg"] = reply["result"]
					_rg_reset_targets()
				else:
					_status = "Failed: %s" % str(reply.get("error", ""))
			else:
				_status = "Failed: That map click did not resolve to a region id."
			_end_pick()))
	_body.add_child(pick)
	if state.is_empty():
		_body.add_child(_gap(9))
		_body.add_child(_note("Pick any map region to inspect who holds it, who claims it, and its geographic provenance.", 11, Color(1, 1, 1, 0.45)))
		_status_line(_body)
		return
	var controller := str(state.get("controller", ""))
	var sovereign := str(state.get("sovereign", controller))
	var claimants: Array = state.get("claimants", [])
	var occupied := not controller.is_empty() and not sovereign.is_empty() and controller != sovereign
	var contested := not claimants.is_empty()
	var state_label := "Unclaimed" if controller.is_empty() else ("Occupied" if occupied else ("Disputed" if contested else "Held"))
	var tone := Color("#fcd34d") if occupied else (Color("#e4e4e7") if contested else (GREEN if not controller.is_empty() else Color(1, 1, 1, 0.55)))
	_body.add_child(_gap(9))
	var card: Array = _field_box(6)
	var card_column: VBoxContainer = card[1]
	var head := HBoxContainer.new()
	var name_label := _note(str(state.get("name", "")), 15, UI.WHITE, 850)
	head.add_child(name_label)
	head.add_child(_pill_label(state_label.to_upper(), tone, Color(tone, 0.1), Color(tone, 0.33), 9))
	card_column.add_child(head)
	var rule := ColorRect.new()
	rule.color = Color(1, 1, 1, 0.07)
	rule.custom_minimum_size.y = 1
	card_column.add_child(rule)
	var base := _name_of(str(state.get("baseOwner", "")))
	card_column.add_child(_rg_info("Base geography", base))
	card_column.add_child(_rg_info("Controller", _name_of(controller), Color("#fcd34d") if occupied else Color("#d1fae5")))
	card_column.add_child(_rg_info("Sovereign", _name_of(sovereign), Color("#fde68a") if occupied else Color(1, 1, 1, 0.86)))
	var claimant_names: Array[String] = []
	for claimant in claimants:
		claimant_names.append(_name_of(str(claimant)))
	card_column.add_child(_rg_info("Claimants", ", ".join(claimant_names) if not claimant_names.is_empty() else "None", Color("#f4f4f5") if not claimant_names.is_empty() else Color(1, 1, 1, 0.55)))
	_body.add_child(card[0])
	_body.add_child(_gap(9))
	var control_box: Array = _field_box(6)
	var control_column: VBoxContainer = control_box[1]
	control_column.add_child(_section_label("De-facto control"))
	control_column.add_child(_note("Changes who physically administers the region. This uses the same canonical control semantics as occupation/liberation: legal sovereignty stays put and displaced parties may remain claimants.", 10, Color(1, 1, 1, 0.48)))
	var apply_control := _btn("Apply controller change", "primary")
	control_column.add_child(_polity_select(_sv("rg_controller", controller), "Unclaimed / no controller", func(code: String) -> void:
		_s["rg_controller"] = code
		_enable(apply_control, not _busy and not code.is_empty() and code != controller)))
	var controller_target := _sv("rg_controller", controller)
	_enable(apply_control, not _busy and not controller_target.is_empty() and controller_target != controller)
	apply_control.pressed.connect(func() -> void: _rg_apply("controller", _sv("rg_controller")))
	control_column.add_child(apply_control)
	if occupied:
		var restore := _btn("Restore sovereign control")
		_enable(restore, not _busy and not sovereign.is_empty())
		restore.pressed.connect(func() -> void: _rg_apply("restore", ""))
		control_column.add_child(restore)
	_body.add_child(control_box[0])
	_body.add_child(_gap(9))
	var sovereignty: Array = _field_box(6)
	var sovereignty_column: VBoxContainer = sovereignty[1]
	sovereignty_column.add_child(_section_label("Legal sovereignty"))
	sovereignty_column.add_child(_note("Formal title only. A legal transfer also moves administration when the old sovereign still controls the ground; a genuine third-party occupier is preserved.", 10, Color(1, 1, 1, 0.48)))
	var transfer := _btn("Transfer legal sovereignty", "primary")
	sovereignty_column.add_child(_polity_select(_sv("rg_sovereign", sovereign), "Pick legal sovereign…", func(code: String) -> void:
		_s["rg_sovereign"] = code
		_enable(transfer, not _busy and not code.is_empty() and code != sovereign)))
	var sovereign_target := _sv("rg_sovereign", sovereign)
	_enable(transfer, not _busy and not sovereign_target.is_empty() and sovereign_target != sovereign)
	transfer.pressed.connect(func() -> void: _rg_apply("sovereign", _sv("rg_sovereign")))
	sovereignty_column.add_child(transfer)
	_body.add_child(sovereignty[0])
	_body.add_child(_gap(9))
	var claims: Array = _field_box(6)
	var claims_column: VBoxContainer = claims[1]
	claims_column.add_child(_section_label("Claims & disputed state"))
	claims_column.add_child(_note("A claim marks the region disputed — striped in the claimant's colour — without moving the border.", 10, Color(1, 1, 1, 0.48)))
	if claimants.is_empty():
		claims_column.add_child(_note("No active claimants.", 11, Color(1, 1, 1, 0.42)))
	for claimant_value in claimants:
		var claimant := str(claimant_value)
		var row_box: Array = _box(Color(1, 1, 1, 0.08), Color(1, 1, 1, 0.1), 8, Vector4(8, 5, 8, 5))
		var row := HBoxContainer.new()
		var claimant_label := UI.label(_name_of(claimant), 12, Color("#f4f4f5"), 700)
		claimant_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(claimant_label)
		var withdraw := _btn("Withdraw", "plain", 10)
		withdraw.custom_minimum_size.y = 24
		_enable(withdraw, not _busy)
		withdraw.pressed.connect(func() -> void: _rg_apply("withdraw", claimant))
		row.add_child(withdraw)
		(row_box[1] as VBoxContainer).add_child(row)
		claims_column.add_child(row_box[0])
	var add_row := HBoxContainer.new()
	add_row.add_theme_constant_override("separation", 6)
	var add := _btn("Add", "primary")
	var claimant_target := _sv("rg_claimant")
	var can_add := func(code: String) -> bool: return not _busy and not code.is_empty() and code != controller and not claimants.has(code)
	add_row.add_child(_polity_select(claimant_target, "Add a claimant…", func(code: String) -> void:
		_s["rg_claimant"] = code
		_enable(add, can_add.call(code))))
	_enable(add, can_add.call(claimant_target))
	add.pressed.connect(func() -> void: _rg_apply("claim", _sv("rg_claimant")))
	add_row.add_child(add)
	claims_column.add_child(add_row)
	if not claimants.is_empty():
		var withdraw_all := _btn("Withdraw all claims")
		_enable(withdraw_all, not _busy)
		withdraw_all.pressed.connect(func() -> void: _rg_apply("withdraw-all", ""))
		claims_column.add_child(withdraw_all)
	_body.add_child(claims[0])
	if _groups_on:
		_body.add_child(_gap(9))
		var groups_box: Array = _field_box(6)
		var groups_column: VBoxContainer = groups_box[1]
		groups_column.add_child(_section_label("Group control"))
		groups_column.add_child(_note("A group controls the region without owning it: the border stays where it is, and the group's area is outlined and tinted in its colour. Groups are made in the Groups tool.", 10, Color(1, 1, 1, 0.48)))
		var group := str(state.get("group", ""))
		var registry: Array = state.get("groups", [])
		if group.is_empty():
			groups_column.add_child(_note("No group controls this region.", 11, Color(1, 1, 1, 0.42)))
		else:
			var color := Color("#888888")
			for entry_value in registry:
				var entry: Dictionary = entry_value
				if str(entry.get("name", "")) == group:
					color = Color(str(entry.get("color", "#888888")))
			var group_box: Array = _box(Color(1, 1, 1, 0.08), Color(1, 1, 1, 0.1), 8, Vector4(8, 5, 8, 5))
			var row := HBoxContainer.new()
			row.add_theme_constant_override("separation", 6)
			row.add_child(_swatch(color, 12))
			var group_label := UI.label(group, 12, Color("#f4f4f5"), 700)
			group_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			row.add_child(group_label)
			var release := _btn("Release", "plain", 10)
			release.custom_minimum_size.y = 24
			_enable(release, not _busy)
			release.pressed.connect(func() -> void: _rg_apply("group-release", group))
			row.add_child(release)
			(group_box[1] as VBoxContainer).add_child(row)
			groups_column.add_child(group_box[0])
		if not registry.is_empty():
			var set_row := HBoxContainer.new()
			set_row.add_theme_constant_override("separation", 6)
			var options: Array = []
			for entry_value in registry:
				var entry: Dictionary = entry_value
				options.append([str(entry.get("name", "")), str(entry.get("name", ""))])
			var set_button := _btn("Set", "primary")
			var group_target := _sv("rg_group")
			set_row.add_child(_select(options, group_target, "Put under a group…", func(name: String) -> void:
				_s["rg_group"] = name
				_enable(set_button, not _busy and not name.is_empty() and name != group)))
			_enable(set_button, not _busy and not group_target.is_empty() and group_target != group)
			set_button.pressed.connect(func() -> void: _rg_apply("group-take", _sv("rg_group")))
			set_row.add_child(set_button)
			groups_column.add_child(set_row)
		_body.add_child(groups_box[0])
	_body.add_child(_gap(9))
	var advanced: Array = _box(Color(0, 0, 0, 0.22), Color(1, 1, 1, 0.11), 9, Vector4(9, 6, 9, 6), 4)
	var identity := _details("Advanced · region identity", "rg_identity", false, advanced[1], 11)
	identity.add_child(_field_label("Region name", 2))
	var can_rename := bool(state.get("canRename", false))
	var rename := _btn("Save region name", "primary")
	var name_field := _line(_sv("rg_name", str(state.get("name", ""))), "", func(text: String) -> void:
		_s["rg_name"] = text
		_enable(rename, not _busy and not text.strip_edges().is_empty()))
	name_field.editable = can_rename
	identity.add_child(name_field)
	identity.add_child(_note("This scenario has editable custom region geometry. Renaming preserves the stable region ID." if can_rename else "Stock-map region names come from immutable map tiles, so this name is read-only here.", 10, Color(1, 1, 1, 0.4)))
	_enable(rename, not _busy and not _sv("rg_name", str(state.get("name", ""))).strip_edges().is_empty())
	rename.visible = can_rename
	rename.pressed.connect(func() -> void:
		var name := _sv("rg_name", str(state.get("name", ""))).strip_edges()
		if name.is_empty():
			return
		var reply := await _run("cheats.regions.rename", {"id": str(state.get("id", "")), "name": name})
		if reply.get("ok", false):
			_s["rg"] = (reply["result"] as Dictionary).get("state", state)
		_render())
	identity.add_child(rename)
	identity.add_child(_note("Base geography: %s" % (base if not base.is_empty() else "unknown"), 10, Color(1, 1, 1, 0.4)))
	_body.add_child(advanced[0])
	_status_line(_body)


func _rg_reset_targets() -> void:
	for key in ["rg_controller", "rg_sovereign", "rg_claimant", "rg_group", "rg_name"]:
		_s.erase(key)


func _rg_info(label: String, value: String, tone := Color(1, 1, 1, 0.86)) -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 7)
	var key := UI.label(label.to_upper(), 10, Color(1, 1, 1, 0.42), 750)
	key.custom_minimum_size.x = 118
	row.add_child(key)
	row.add_child(_note(value if not value.is_empty() else "—", 12, tone, 650))
	return row


func _rg_apply(action: String, target: String) -> void:
	var state := _sd("rg")
	var reply := await _run("cheats.regions.apply", {"id": str(state.get("id", "")), "action": action, "target": target, "names": _names})
	if reply.get("ok", false):
		_s["rg"] = (reply["result"] as Dictionary).get("state", state)
		_rg_reset_targets()
		await refresh()
	_render()


func _swatch(color: Color, size := 13) -> Control:
	var rect := PanelContainer.new()
	rect.add_theme_stylebox_override("panel", UI.box(color, Color(0, 0, 0, 0.5), 3, 1))
	rect.custom_minimum_size = Vector2(size, size)
	rect.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return rect


func _render_groups() -> void:
	_meta_header()
	if not _groups_on:
		_body.add_child(_note("Groups are switched off for this game. Turn them back on in the scenario or game editor (Features) to edit them here.", 11, Color(1, 1, 1, 0.6)))
		return
	var data := _sd("groups")
	var intro: Array = _box(Color(1, 1, 1, 0.08), Color(1, 1, 1, 0.17), 10, Vector4(10, 9, 10, 9))
	(intro[1] as VBoxContainer).add_child(_note("A group controls an area without owning it: the regions stay their countries', and the map outlines and tints the group's area in its colour. The description is what the AI is told the group is; the AI can found, change, move and erase groups too.", 11, Color("#e4e4e7")))
	_body.add_child(intro[0])
	var groups: Array = data.get("groups", [])
	var palette: Array = data.get("palette", ["#e11d48"])
	if not _s.has("gr_selected"):
		_body.add_child(_gap(9))
		if not _s.has("groups"):
			_body.add_child(_note("Loading…", 11, Color(1, 1, 1, 0.42)))
		elif groups.is_empty():
			_body.add_child(_note("No groups yet.", 11, Color(1, 1, 1, 0.42)))
		for group_value in groups:
			var group: Dictionary = group_value
			var name := str(group.get("name", ""))
			var count := int(group.get("count", 0))
			var row_panel := PanelContainer.new()
			var row := HBoxContainer.new()
			row.add_theme_constant_override("separation", 8)
			row.add_child(_swatch(Color(str(group.get("color", "#888888")))))
			var label := UI.label(name, 13, UI.WHITE, 750)
			label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			row.add_child(label)
			row.add_child(UI.label("1 region" if count == 1 else "%d regions" % count, 10, Color(1, 1, 1, 0.45)))
			row_panel.add_child(row)
			_clickable(row_panel, UI.box(Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.12), 8, 1, Vector4(11, 8, 11, 8)), UI.box(Color(1, 1, 1, 0.1), Color(1, 1, 1, 0.2), 8, 1, Vector4(11, 8, 11, 8)), func() -> void:
				_s["gr_selected"] = name
				_s["gr_form"] = {"name": name, "description": str(group.get("description", "")), "color": str(group.get("color", palette[0]))}
				_s["gr_armed"] = false
				_status = ""
				_render())
			_body.add_child(row_panel)
			_body.add_child(_gap(5))
		_body.add_child(_gap(4))
		var create := _btn("New group", "primary")
		_enable(create, not _busy and _s.has("groups"))
		create.pressed.connect(func() -> void:
			_s["gr_selected"] = ""
			_s["gr_form"] = {"name": "", "description": "", "color": str(palette[groups.size() % palette.size()])}
			_s["gr_armed"] = false
			_status = ""
			_render())
		_body.add_child(create)
		_status_line(_body)
		return
	var selected := _sv("gr_selected")
	var form := _sd("gr_form")
	_body.add_child(_gap(9))
	var back := _btn("← All groups")
	back.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	back.pressed.connect(func() -> void:
		_s.erase("gr_selected")
		_status = ""
		_render())
	_body.add_child(back)
	_body.add_child(_gap(9))
	var editor: Array = _field_box(4)
	var column: VBoxContainer = editor[1]
	column.add_child(_section_label("Group" if not selected.is_empty() else "New group"))
	column.add_child(_field_label("Name", 4))
	var save := _btn("Save group" if not selected.is_empty() else "Create group", "primary")
	var name_line := _line(str(form.get("name", "")), "Cartel del Norte", func(text: String) -> void:
		var next := _sd("gr_form")
		next["name"] = text.substr(0, int(data.get("nameMax", 80)))
		_s["gr_form"] = next
		_enable(save, not _busy and not text.strip_edges().is_empty()))
	name_line.max_length = int(data.get("nameMax", 80))
	column.add_child(name_line)
	column.add_child(_field_label("What it is (the AI is told this)"))
	column.add_child(_area(str(form.get("description", "")), "A drug cartel that runs the border towns, taxes the smuggling routes and fights the army for the highways.", 4, func(text: String) -> void:
		var next := _sd("gr_form")
		next["description"] = text
		_s["gr_form"] = next, int(data.get("descriptionMax", 1200))))
	column.add_child(_field_label("Tint colour"))
	var swatches := HFlowContainer.new()
	swatches.add_theme_constant_override("h_separation", 6)
	swatches.add_theme_constant_override("v_separation", 6)
	var chosen := str(form.get("color", "")).to_lower()
	for color_value in palette:
		var color_text := str(color_value)
		var swatch := Button.new()
		swatch.focus_mode = Control.FOCUS_NONE
		swatch.custom_minimum_size = Vector2(24, 24)
		swatch.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		var style := UI.box(Color(color_text), Color(1, 1, 1) if chosen == color_text.to_lower() else Color(0, 0, 0, 0.5), 5, 2 if chosen == color_text.to_lower() else 1)
		for state in ["normal", "hover", "pressed", "focus"]:
			swatch.add_theme_stylebox_override(state, style)
		swatch.pressed.connect(func() -> void:
			var next := _sd("gr_form")
			next["color"] = color_text
			_s["gr_form"] = next
			_render())
		swatches.add_child(swatch)
	var custom := ColorPickerButton.new()
	custom.custom_minimum_size = Vector2(35, 27)
	custom.edit_alpha = false
	custom.color = Color(chosen) if _valid_hex(chosen) else Color(str(palette[0]))
	custom.popup_closed.connect(func() -> void: _render())
	custom.color_changed.connect(func(color: Color) -> void:
		var next := _sd("gr_form")
		next["color"] = "#" + color.to_html(false)
		_s["gr_form"] = next)
	swatches.add_child(custom)
	column.add_child(swatches)
	column.add_child(_gap(6))
	_enable(save, not _busy and not str(form.get("name", "")).strip_edges().is_empty())
	save.pressed.connect(func() -> void:
		var reply := await _run("cheats.groups.save", {"selected": _sv("gr_selected"), "name": str(_sd("gr_form").get("name", "")), "description": str(_sd("gr_form").get("description", "")), "color": str(_sd("gr_form").get("color", ""))})
		if reply.get("ok", false):
			_s["gr_selected"] = str((reply["result"] as Dictionary).get("selected", ""))
		await _load_into("cheats.groups.get", {}, "groups")
		_render())
	column.add_child(save)
	_body.add_child(editor[0])
	var current: Dictionary = {}
	for group_value in groups:
		var group: Dictionary = group_value
		if str(group.get("name", "")) == selected:
			current = group
	if not selected.is_empty() and not current.is_empty():
		_body.add_child(_gap(9))
		var area: Array = _field_box(6)
		var area_column: VBoxContainer = area[1]
		area_column.add_child(_section_label("Area"))
		var area_text := str(current.get("area", ""))
		area_column.add_child(_note(area_text if not area_text.is_empty() else "It controls no area yet.", 12, Color("#f4f4f5") if not area_text.is_empty() else Color(1, 1, 1, 0.45)))
		var edit_area := _btn("Edit the area on the map →", "primary")
		_enable(edit_area, not _busy and map_view != null)
		edit_area.pressed.connect(func() -> void:
			_begin_pick("Click regions to add to or take out of %s's area — Done when finished" % selected, func(job: Dictionary) -> void:
				if int(job.get("index", -1)) < 0:
					return
				var reply: Dictionary = await engine.request("cheats.groups.ops", {"name": selected, "action": "toggle", "index": int(job["index"])})
				if reply.get("ok", false):
					_status = str((reply["result"] as Dictionary).get("message", ""))
					world_changed.emit()
				else:
					_status = "Failed: %s" % str(reply.get("error", ""))
				await _load_into("cheats.groups.get", {}, "groups")))
		area_column.add_child(edit_area)
		if int(current.get("count", 0)) > 0:
			var clear_area := _btn("Clear the whole area")
			_enable(clear_area, not _busy)
			clear_area.pressed.connect(func() -> void:
				await _run("cheats.groups.ops", {"name": selected, "action": "clear"})
				await _load_into("cheats.groups.get", {}, "groups")
				_render())
			area_column.add_child(clear_area)
		_body.add_child(area[0])
		_body.add_child(_gap(9))
		var armed := bool(_s.get("gr_armed", false))
		var erase := _btn("Erase %s and its area — click again to confirm" % selected if armed else "Erase group", "danger")
		erase.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		(erase.get_theme_stylebox("normal") as StyleBoxFlat).border_color = Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.5)
		erase.add_theme_color_override("font_color", FAIL_INK)
		_enable(erase, not _busy)
		erase.pressed.connect(func() -> void:
			if not bool(_s.get("gr_armed", false)):
				_s["gr_armed"] = true
				_render()
				return
			var reply := await _run("cheats.groups.ops", {"name": selected, "action": "erase"})
			if reply.get("ok", false):
				_s.erase("gr_selected")
			_s["gr_armed"] = false
			await _load_into("cheats.groups.get", {}, "groups")
			_render())
		_body.add_child(erase)
	_status_line(_body)


func _pp_defaults() -> Dictionary:
	return {"overlord": "", "puppet": "", "kind": "satellite", "secrecy": "open", "loyalty": 50}


func _pp_key(row: Dictionary) -> String:
	return "%s→%s" % [str(row.get("overlord", "")), str(row.get("puppet", ""))]


func _pp_current() -> Dictionary:
	var editing := _sv("pp_editing")
	if editing.is_empty():
		return {}
	for row_value in _sd("puppets").get("live", []):
		var row: Dictionary = row_value
		if _pp_key(row) == editing:
			return row
	return {}


func _render_puppets() -> void:
	_meta_header()
	var data := _sd("puppets")
	var intro: Array = _box(Color(1, 1, 1, 0.08), Color(1, 1, 1, 0.17), 10, Vector4(10, 9, 10, 9))
	(intro[1] as VBoxContainer).add_child(_note("A puppet stays a separate country with its own land; its overlord directs it. The rules are the ledger's: one overlord each, no puppet holds puppets of its own, and a secret once public stays public. The next time skip is told of each change.", 11, Color("#e4e4e7")))
	_body.add_child(intro[0])
	if _s.has("pp_editing"):
		_render_puppet_editor(data)
	else:
		_render_puppet_list(data)
	_status_line(_body)


func _render_puppet_list(data: Dictionary) -> void:
	_body.add_child(_gap(9))
	var live: Array = data.get("live", [])
	if not _s.has("puppets"):
		_body.add_child(_note("Loading…", 11, Color(1, 1, 1, 0.42)))
	elif live.is_empty():
		_body.add_child(_note("No country is anyone's puppet now.", 11, Color(1, 1, 1, 0.42)))
	for row_value in live:
		var row: Dictionary = row_value
		var panel := PanelContainer.new()
		panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var column := VBoxContainer.new()
		column.add_theme_constant_override("separation", 2)
		column.add_child(_note(str(row.get("title", "")), 13, UI.WHITE, 750))
		column.add_child(_note(str(row.get("meta", "")), 10, Color(1, 1, 1, 0.5), 500))
		panel.add_child(column)
		_clickable(panel, UI.box(Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.12), 8, 1, Vector4(11, 8, 11, 8)), UI.box(Color(1, 1, 1, 0.1), Color(1, 1, 1, 0.2), 8, 1, Vector4(11, 8, 11, 8)), func() -> void:
			_s["pp_editing"] = _pp_key(row)
			_s["pp_form"] = {"overlord": str(row.get("overlord", "")), "puppet": str(row.get("puppet", "")), "kind": str(row.get("kind", "client")), "secrecy": "covert" if str(row.get("secrecy", "")) == "covert" else "open", "loyalty": clampi(int(row.get("loyalty", 50)), 0, 100)}
			_s["pp_armed"] = ""
			_status = ""
			_render())
		_body.add_child(panel)
		_body.add_child(_gap(5))
	_body.add_child(_gap(4))
	var create := _btn("New puppet state", "primary")
	_enable(create, not _busy and _s.has("puppets"))
	create.pressed.connect(func() -> void:
		_s["pp_editing"] = ""
		_s["pp_form"] = _pp_defaults()
		_s["pp_armed"] = ""
		_status = ""
		_render())
	_body.add_child(create)
	var ended: Array = data.get("ended", [])
	if not ended.is_empty():
		_body.add_child(_gap(8))
		var holder := VBoxContainer.new()
		var inner := _details("Ended arrangements (%d)" % ended.size(), "pp_ended", false, holder, 11, 400)
		for line in ended:
			inner.add_child(_note(str(line), 11, Color(1, 1, 1, 0.5)))
		_body.add_child(holder)


func _render_puppet_editor(data: Dictionary) -> void:
	var is_new := _sv("pp_editing").is_empty()
	var form := _sd("pp_form")
	var current := _pp_current()
	_body.add_child(_gap(9))
	var back := _btn("← All puppet states")
	back.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	back.pressed.connect(func() -> void:
		_s.erase("pp_editing")
		_s["pp_armed"] = ""
		_status = ""
		_render())
	_body.add_child(back)
	_body.add_child(_gap(9))
	var box: Array = _field_box(4)
	var column: VBoxContainer = box[1]
	column.add_child(_section_label("New puppet state" if is_new else "%s → %s" % [str(form.get("overlord", "")), str(form.get("puppet", ""))]))
	var save := _btn("Make it a puppet state" if is_new else "Save", "primary")
	var sync_save := func() -> void:
		var draft := _sd("pp_form")
		_enable(save, not _busy and (not is_new or (not str(draft.get("overlord", "")).is_empty() and not str(draft.get("puppet", "")).is_empty())))
	if is_new:
		column.add_child(_field_label("Overlord", 4))
		column.add_child(_polity_select(str(form.get("overlord", "")), "Pick the overlord…", func(code: String) -> void:
			var draft := _sd("pp_form")
			draft["overlord"] = code
			sync_save.call()))
		column.add_child(_field_label("Puppet"))
		column.add_child(_polity_select(str(form.get("puppet", "")), "Pick the puppet…", func(code: String) -> void:
			var draft := _sd("pp_form")
			draft["puppet"] = code
			sync_save.call()))
	column.add_child(_field_label("Kind", 9 if is_new else 4))
	column.add_child(_select(PUPPET_KINDS, str(form.get("kind", "satellite")), "", func(value: String) -> void:
		var draft := _sd("pp_form")
		draft["kind"] = value))
	if is_new:
		column.add_child(_field_label("Known"))
		column.add_child(_select(PUPPET_SECRECY, str(form.get("secrecy", "open")), "", func(value: String) -> void:
			var draft := _sd("pp_form")
			draft["secrecy"] = value))
	column.add_child(_field_label("Loyalty"))
	var loyalty: int = clampi(int(form.get("loyalty", 50)), 0, 100)
	var coup := int(data.get("coupLoyalty", 35))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	var slider := HSlider.new()
	slider.min_value = 0
	slider.max_value = 100
	slider.step = 1
	slider.value = loyalty
	slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	slider.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	slider.focus_mode = Control.FOCUS_NONE
	var value_label := UI.label(str(loyalty), 12, UI.WHITE)
	value_label.custom_minimum_size.x = 32
	value_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	var warning := _note("This low, the puppet starts plotting against its overlord.", 11, AMBER)
	warning.visible = loyalty < coup
	slider.value_changed.connect(func(next: float) -> void:
		var draft := _sd("pp_form")
		draft["loyalty"] = int(next)
		value_label.text = str(int(next))
		warning.visible = int(next) < coup)
	row.add_child(slider)
	row.add_child(value_label)
	column.add_child(row)
	column.add_child(warning)
	if str(current.get("secrecy", "")) == "covert":
		column.add_child(_note("Covert: only the two of them know, until someone's spies find out.", 11, Color(1, 1, 1, 0.5)))
	column.add_child(_gap(6))
	sync_save.call()
	save.pressed.connect(func() -> void: _pp_change("install" if is_new else "edit"))
	column.add_child(save)
	_body.add_child(box[0])
	if current.is_empty():
		return
	var armed := _sv("pp_armed")
	var overlord := str(current.get("overlord", ""))
	var puppet := str(current.get("puppet", ""))
	_body.add_child(_gap(9))
	if str(current.get("secrecy", "")) == "covert":
		var reveal := _btn("Make it public")
		_enable(reveal, not _busy)
		reveal.pressed.connect(func() -> void: _pp_change("reveal"))
		_body.add_child(reveal)
		_body.add_child(_gap(6))
	var release := _btn("Release %s — click again to confirm" % puppet if armed == "release" else "Release")
	release.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_enable(release, not _busy)
	release.pressed.connect(func() -> void:
		if _sv("pp_armed") != "release":
			_s["pp_armed"] = "release"
			_render()
			return
		_pp_change("release"))
	_body.add_child(release)
	_body.add_child(_gap(6))
	var annex := _btn("Annex %s and all its land into %s — click again to confirm" % [puppet, overlord] if armed == "annex" else "Annex", "danger")
	annex.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	(annex.get_theme_stylebox("normal") as StyleBoxFlat).border_color = Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.5)
	annex.add_theme_color_override("font_color", FAIL_INK)
	_enable(annex, not _busy)
	annex.pressed.connect(func() -> void:
		if _sv("pp_armed") != "annex":
			_s["pp_armed"] = "annex"
			_render()
			return
		_pp_change("annex"))
	_body.add_child(annex)


func _pp_change(op: String) -> void:
	var form := _sd("pp_form")
	var current := _pp_current()
	var overlord := str(form.get("overlord", "")) if op == "install" or current.is_empty() else str(current.get("overlord", ""))
	var puppet := str(form.get("puppet", "")) if op == "install" or current.is_empty() else str(current.get("puppet", ""))
	var names := {overlord: _name_of(overlord), puppet: _name_of(puppet)}
	var reply := await _run("cheats.puppets.change", {"op": op, "overlord": overlord, "puppet": puppet, "kind": str(form.get("kind", "satellite")), "secrecy": str(form.get("secrecy", "open")), "loyalty": int(form.get("loyalty", 50)), "names": names})
	if reply.get("ok", false):
		if bool((reply["result"] as Dictionary).get("closeEditor", false)):
			_s.erase("pp_editing")
		if op == "release" or op == "annex":
			_s["pp_armed"] = ""
	await _load_into("cheats.puppets.get", {}, "puppets")
	if op == "annex" and reply.get("ok", false):
		await refresh()
	_render()


func _cp() -> Dictionary:
	return _sd("ce_politics")


func _cp_field(label: String, field: Control) -> Control:
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 4)
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.add_child(UI.label(label.to_upper(), 10, Color(1, 1, 1, 0.75), 700, "Arial", 1))
	column.add_child(field)
	return column


func _cp_line(label: String, key: String) -> Control:
	return _cp_field(label, _number_line(str(_cp().get(key, "")), "", 0.0, 100.0, 0.1, func(text: String) -> void:
		var politics := _cp()
		politics[key] = text))


func _cp_select(label: String, key: String, options: Array, placeholder: String) -> Control:
	return _cp_field(label, _select(options, str(_cp().get(key, "")), placeholder, func(value: String) -> void:
		var politics := _cp()
		politics[key] = value))


func _cp_area(label: String, key: String, placeholder := "", rows := 4) -> Control:
	return _cp_field(label, _area(str(_cp().get(key, "")), placeholder, rows, func(text: String) -> void:
		var politics := _cp()
		politics[key] = text))


func _cp_entry_set(list_key: String, index: int, key: String, value: Variant) -> void:
	var entries: Array = _cp().get(list_key, [])
	if index >= 0 and index < entries.size():
		var entry: Dictionary = entries[index]
		entry[key] = value


func _cp_entry_line(list_key: String, index: int, label: String, key: String, on_change: Callable = Callable()) -> Control:
	var entries: Array = _cp().get(list_key, [])
	var entry: Dictionary = entries[index]
	var changed := func(text: String) -> void:
		_cp_entry_set(list_key, index, key, text)
		if on_change.is_valid():
			on_change.call()
	if key == "supportPercent" or key == "influencePercent":
		return _cp_field(label, _number_line(str(entry.get(key, "")), "", 0.0, 100.0, 0.1, changed))
	return _cp_field(label, _line(str(entry.get(key, "")), "", changed))


func _cp_entry_area(list_key: String, index: int, label: String, key: String) -> Control:
	var entries: Array = _cp().get(list_key, [])
	var entry: Dictionary = entries[index]
	return _cp_field(label, _area(str(entry.get(key, "")), "", 3, func(text: String) -> void: _cp_entry_set(list_key, index, key, text)))


func _cp_party_title(party: Dictionary, index: int) -> String:
	var name := str(party.get("name", ""))
	var title := name if not name.is_empty() else "Political entity %d" % (index + 1)
	if bool(party.get("ruling", false)):
		title += " · Government"
	elif bool(party.get("coalition", false)):
		title += " · Coalition"
	return title


func _cp_bloc_title(bloc: Dictionary, index: int) -> String:
	var name := str(bloc.get("name", ""))
	return name if not name.is_empty() else "Power bloc %d" % (index + 1)


func _base36(value: int) -> String:
	var digits := "0123456789abcdefghijklmnopqrstuvwxyz"
	if value <= 0:
		return "0"
	var out := ""
	var rest := value
	while rest > 0:
		out = digits[rest % 36] + out
		rest = floori(rest / 36.0)
	return out


func _now_id() -> String:
	return _base36(int(Time.get_unix_time_from_system() * 1000.0))


func _render_politics(column: VBoxContainer) -> void:
	var politics := _cp()
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 8)
	var head_text := VBoxContainer.new()
	head_text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head_text.add_child(_section_label("Political World"))
	head_text.add_child(_note("Canonical political truth used by the Advisor, diplomacy, institutions and simulation. This is not a Stats-side copy.", 10, Color(1, 1, 1, 0.42)))
	head.add_child(head_text)
	var exists := bool(politics.get("exists", false))
	head.add_child(_pill_label("CANONICAL ACTOR" if exists else "NEW ACTOR", GREEN if exists else AMBER, Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.12) if exists else Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.12), Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.28) if exists else Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.28)))
	column.add_child(head)
	var government := _details("Government & political system", "cp_government", true, column, 12, 850)
	var grid := _two_columns()
	for pair in [["Government form", "governmentForm"], ["Government ideology", "governmentIdeology"], ["Head of state", "headOfState"], ["Head of government", "headOfGovernment"], ["Operative political leader", "politicalLeader"], ["Government status", "governmentStatus"], ["Coalition / cabinet name", "coalitionName"], ["Political system type", "politicalSystemType"]]:
		grid.add_child(_cp_line(str(pair[0]), str(pair[1])))
	grid.add_child(_cp_select("Representation model", "politicalRepresentation", REPRESENTATION_OPTIONS, "Auto / unspecified"))
	grid.add_child(_cp_select("Regime character", "regimeCharacter", REGIME_OPTIONS, "Unspecified"))
	grid.add_child(_cp_line("Government approval / 100", "approval"))
	grid.add_child(_cp_line("Political stability / 100", "politicalStability"))
	government.add_child(grid)
	government.add_child(_cp_line("Public system label", "politicalSystemLabel"))
	government.add_child(_cp_area("Political-system notes", "politicalSystemNotes"))
	var outlook := _details("Strategic outlook · goals, fears, ambitions, pressure", "cp_outlook", true, column, 12, 850)
	outlook.add_child(_note("One item per line. These are canonical causal inputs, not flavor text.", 10, Color(1, 1, 1, 0.38)))
	outlook.add_child(_cp_area("Goals", "goalsText", "One goal per line"))
	outlook.add_child(_cp_area("Fears", "fearsText", "One fear per line"))
	outlook.add_child(_cp_area("Ambitions", "ambitionsText", "One ambition per line"))
	outlook.add_child(_cp_area("Domestic pressure notes", "domesticPressuresText", "One pressure per line"))
	_render_parties(column)
	_render_blocs(column)
	_render_trait_catalog(column)
	var advanced := _details("Advanced structured traits & perceptions", "cp_json", false, column, 12, 850)
	advanced.add_child(_note("Raw JSON remains available for power users and legacy extension traits. Registered canonical trait keys stay synchronized with the controls above whenever this JSON is valid.", 10, Color(1, 1, 1, 0.44)))
	var traits_json := _area(str(politics.get("traitsJson", "{}")), "", 10, func(text: String) -> void:
		if not _syncing:
			_cp_traits_json(text))
	_mono(traits_json)
	_traits_json_edit = traits_json
	advanced.add_child(_cp_field("Traits JSON", traits_json))
	var perceptions_json := _area(str(politics.get("perceptionsJson", "{}")), "", 12, func(text: String) -> void:
		var current := _cp()
		current["perceptionsJson"] = text)
	_mono(perceptions_json)
	advanced.add_child(_cp_field("Perceptions JSON", perceptions_json))
	_render_political_debug(column)


func _mono(edit: TextEdit) -> void:
	edit.add_theme_font_override("font", UI.font(400, "Consolas"))
	edit.add_theme_font_size_override("font_size", 10)


func _render_parties(column: VBoxContainer) -> void:
	var parties: Array = _cp().get("parties", [])
	var section := _details("Parties / political entities (%d)" % parties.size(), "cp_parties", true, column, 12, 850)
	section.add_child(_note("Ruling and coalition membership writes directly to canonical government party IDs.", 10, Color(1, 1, 1, 0.38)))
	for index in range(parties.size()):
		var party: Dictionary = parties[index]
		var card: Array = _box(Color(1, 1, 1, 0.025), Color(1, 1, 1, 0.08), 9, Vector4(8, 4, 8, 8), 5)
		var inner := _details(_cp_party_title(party, index), "cp_party_%d" % index, false, card[1], 11, 800)
		var toggle: Button = inner.get_meta("toggle")
		var retitle := func() -> void:
			if is_instance_valid(toggle):
				toggle.text = toggle.text.substr(0, 2) + _cp_party_title(party, index)
		var grid := _two_columns()
		grid.add_child(_cp_entry_line("parties", index, "Name", "name", retitle))
		grid.add_child(_cp_entry_line("parties", index, "Short name", "shortName"))
		grid.add_child(_cp_entry_line("parties", index, "Leader", "leader"))
		grid.add_child(_cp_entry_line("parties", index, "Ideology", "ideology"))
		grid.add_child(_cp_entry_line("parties", index, "Support (%)", "supportPercent"))
		grid.add_child(_cp_entry_line("parties", index, "Influence (%)", "influencePercent"))
		inner.add_child(grid)
		var flags := HBoxContainer.new()
		flags.add_theme_constant_override("separation", 14)
		var ruling := bool(party.get("ruling", false))
		flags.add_child(_check("Ruling / government", ruling, func(on: bool) -> void:
			_cp_entry_set("parties", index, "ruling", on)
			_render()))
		var coalition := _check("Coalition partner", bool(party.get("coalition", false)), func(on: bool) -> void:
			_cp_entry_set("parties", index, "coalition", on)
			_render())
		coalition.disabled = ruling
		flags.add_child(coalition)
		inner.add_child(flags)
		inner.add_child(_cp_entry_area("parties", index, "Public description", "publicDescription"))
		inner.add_child(_cp_entry_area("parties", index, "Public priorities · one per line", "publicPrioritiesText"))
		inner.add_child(_cp_entry_area("parties", index, "Foreign-policy outlook · one per line", "publicForeignPolicyText"))
		var remove := _btn("Remove political entity")
		remove.add_theme_color_override("font_color", FAIL_INK)
		remove.add_theme_color_override("font_hover_color", FAIL_INK)
		remove.pressed.connect(func() -> void:
			var entries: Array = _cp().get("parties", [])
			if index < entries.size():
				entries.remove_at(index)
			_render())
		inner.add_child(remove)
		section.add_child(card[0])
	var add := _btn("+ Add political entity")
	add.pressed.connect(func() -> void:
		var politics := _cp()
		var entries: Array = politics.get("parties", [])
		entries.append({"id": "custom-party-" + _now_id(), "name": "New political entity", "shortName": "", "leader": "", "ideology": "", "publicDescription": "", "publicPrioritiesText": "", "publicForeignPolicyText": "", "supportPercent": "", "influencePercent": "", "influenceLabel": "", "ruling": false, "coalition": false})
		politics["parties"] = entries
		_render())
	section.add_child(add)


func _render_blocs(column: VBoxContainer) -> void:
	var blocs: Array = _cp().get("powerBlocs", [])
	var section := _details("Power blocs / non-party actors (%d)" % blocs.size(), "cp_blocs", false, column, 12, 850)
	for index in range(blocs.size()):
		var bloc: Dictionary = blocs[index]
		var card: Array = _box(Color(1, 1, 1, 0.025), Color(1, 1, 1, 0.08), 9, Vector4(8, 4, 8, 8), 5)
		var inner := _details(_cp_bloc_title(bloc, index), "cp_bloc_%d" % index, false, card[1], 11, 800)
		var toggle: Button = inner.get_meta("toggle")
		var retitle := func() -> void:
			if is_instance_valid(toggle):
				toggle.text = toggle.text.substr(0, 2) + _cp_bloc_title(bloc, index)
		var grid := _two_columns()
		for pair in [["Name", "name"], ["Short name", "shortName"], ["Kind", "kind"], ["Status", "status"], ["Leader", "leader"], ["Ideology", "ideology"], ["Influence label", "influenceLabel"]]:
			grid.add_child(_cp_entry_line("powerBlocs", index, str(pair[0]), str(pair[1]), retitle if str(pair[1]) == "name" else Callable()))
		grid.add_child(_cp_entry_line("powerBlocs", index, "Influence (%)", "influencePercent"))
		inner.add_child(grid)
		inner.add_child(_cp_entry_area("powerBlocs", index, "Public description", "publicDescription"))
		inner.add_child(_cp_entry_area("powerBlocs", index, "Public priorities · one per line", "publicPrioritiesText"))
		inner.add_child(_cp_entry_area("powerBlocs", index, "Foreign-policy outlook · one per line", "publicForeignPolicyText"))
		var remove := _btn("Remove power bloc")
		remove.add_theme_color_override("font_color", FAIL_INK)
		remove.add_theme_color_override("font_hover_color", FAIL_INK)
		remove.pressed.connect(func() -> void:
			var entries: Array = _cp().get("powerBlocs", [])
			if index < entries.size():
				entries.remove_at(index)
			_render())
		inner.add_child(remove)
		section.add_child(card[0])
	var add := _btn("+ Add power bloc")
	add.pressed.connect(func() -> void:
		var politics := _cp()
		var entries: Array = politics.get("powerBlocs", [])
		entries.append({"id": "custom-bloc-" + _now_id(), "name": "New power bloc", "shortName": "", "kind": "", "status": "", "leader": "", "ideology": "", "publicDescription": "", "publicPrioritiesText": "", "publicForeignPolicyText": "", "influencePercent": "", "influenceLabel": ""})
		politics["powerBlocs"] = entries
		_render())
	section.add_child(add)


func _render_trait_catalog(column: VBoxContainer) -> void:
	var registry: Array = _s.get("ce_registry", [])
	var section := _details("Political traits · full supported catalog (%d)" % registry.size(), "cp_traits", true, column, 12, 850)
	section.add_child(_rich("Every supported Political World trait is listed here. Blank means [b]not specified[/b], not 0. Values run from 0 to 100 and shape how this government behaves.", 10, Color(1, 1, 1, 0.46)))
	var grid := _two_columns()
	var values: Dictionary = _cp().get("traitValues", {})
	for entry_value in registry:
		var entry: Dictionary = entry_value
		var key := str(entry.get("key", ""))
		var raw := str(values.get(key, ""))
		var card: Array = _box(Color(1, 1, 1, 0.025), Color(1, 1, 1, 0.08), 9, Vector4(8, 8, 8, 8), 4)
		var inner: VBoxContainer = card[1]
		var top := HBoxContainer.new()
		top.add_theme_constant_override("separation", 6)
		var name := UI.label(str(entry.get("label", "")).to_upper(), 10, Color(1, 1, 1, 0.75), 700, "Arial", 1)
		name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		name.clip_text = true
		top.add_child(name)
		var tag := UI.label("", 9, GREEN, 800)
		_trait_tags[key] = tag
		top.add_child(tag)
		inner.add_child(top)
		var trait_min: float = float(entry.get("min")) if entry.get("min") != null else -INF
		var trait_max: float = float(entry.get("max")) if entry.get("max") != null else INF
		var input := _number_line(raw, "unset", trait_min, trait_max, 0.1, func(text: String) -> void: _cp_trait(key, text))
		_trait_inputs[key] = input
		inner.add_child(input)
		inner.add_child(_note(str(entry.get("description", "")), 9, Color(1, 1, 1, 0.42)))
		inner.add_child(UI.label(key, 9, Color(1, 1, 1, 0.4), 400, "Consolas"))
		grid.add_child(card[0])
		_trait_tag_update(key, raw)
	section.add_child(grid)


func _trait_tag_update(key: String, raw: String) -> void:
	var tag: Variant = _trait_tags.get(key)
	if not (tag is Label) or not is_instance_valid(tag):
		return
	var label: Label = tag
	var is_set := not raw.is_empty()
	label.text = "SET" if is_set else "UNSET"
	label.add_theme_color_override("font_color", GREEN if is_set else Color(1, 1, 1, 0.35))


func _clean_trait_key(value: String) -> String:
	var out := ""
	for character in value.to_lower():
		if (character >= "a" and character <= "z") or (character >= "0" and character <= "9"):
			out += character
	return out


func _canonical_trait(raw: String) -> String:
	return str(_trait_alias.get(_clean_trait_key(raw), ""))


func _normalize_trait(value: Variant) -> Variant:
	if value == null or typeof(value) == TYPE_BOOL:
		return null
	var text := str(value).strip_edges()
	if text.is_empty() or not text.is_valid_float():
		return null
	var rounded: float = round(clampf(text.to_float(), 0.0, 100.0) * 10.0) / 10.0
	if is_equal_approx(rounded, floor(rounded)):
		return int(rounded)
	return rounded


func _parse_object(text: String) -> Variant:
	var source := text.strip_edges()
	if source.is_empty():
		source = "{}"
	var json := JSON.new()
	if json.parse(source) != OK:
		return null
	var data: Variant = json.data
	return data if typeof(data) == TYPE_DICTIONARY else null


func _jsonify(value: Variant) -> Variant:
	if typeof(value) == TYPE_FLOAT:
		var number: float = value
		if is_finite(number) and absf(number) < 1e15 and is_equal_approx(number, floor(number)):
			return int(number)
		return number
	if typeof(value) == TYPE_DICTIONARY:
		var out: Dictionary = {}
		var source: Dictionary = value
		for key in source.keys():
			out[key] = _jsonify(source[key])
		return out
	if typeof(value) == TYPE_ARRAY:
		var items: Array = []
		for item in value:
			items.append(_jsonify(item))
		return items
	return value


func _pretty_json(value: Variant) -> String:
	return JSON.stringify(_jsonify(value), "  ", false)


func _cp_trait(key: String, value: String) -> void:
	var politics := _cp()
	var values: Dictionary = politics.get("traitValues", {})
	values[key] = value
	politics["traitValues"] = values
	_trait_tag_update(key, value)
	var parsed: Variant = _parse_object(str(politics.get("traitsJson", "{}")))
	if typeof(parsed) != TYPE_DICTIONARY:
		return
	var raw: Dictionary = parsed
	for raw_key in raw.keys():
		if _canonical_trait(str(raw_key)) == key:
			raw.erase(raw_key)
	var normalized: Variant = _normalize_trait(value)
	if normalized != null:
		raw[key] = normalized
	politics["traitsJson"] = _pretty_json(raw)
	if is_instance_valid(_traits_json_edit):
		_syncing = true
		_traits_json_edit.text = str(politics["traitsJson"])
		_syncing = false


func _cp_traits_json(text: String) -> void:
	var politics := _cp()
	politics["traitsJson"] = text
	var parsed: Variant = _parse_object(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		return
	var raw: Dictionary = parsed
	var values: Dictionary = {}
	for entry_value in _s.get("ce_registry", []):
		values[str((entry_value as Dictionary).get("key", ""))] = ""
	for raw_key in raw.keys():
		var key := _canonical_trait(str(raw_key))
		if key.is_empty():
			continue
		var normalized: Variant = _normalize_trait(raw[raw_key])
		if normalized != null:
			values[key] = str(normalized)
	politics["traitValues"] = values
	for key in values.keys():
		var input: Variant = _trait_inputs.get(key)
		if input is LineEdit and is_instance_valid(input) and (input as LineEdit).text != str(values[key]):
			(input as LineEdit).text = str(values[key])
		_trait_tag_update(str(key), str(values[key]))


func _mono_box(text: String, max_height: float) -> TextEdit:
	var node := TextEdit.new()
	node.text = text
	node.editable = false
	node.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var style := UI.box(Color(0, 0, 0, 0.3), Color(1, 1, 1, 0.1), 8, 1, Vector4(9, 9, 9, 9))
	for state in ["normal", "focus", "read_only"]:
		node.add_theme_stylebox_override(state, style)
	node.add_theme_font_override("font", UI.font(400, "Consolas"))
	node.add_theme_font_size_override("font_size", 10)
	node.add_theme_color_override("font_readonly_color", Color(1, 1, 1, 0.72))
	node.add_theme_color_override("font_color", Color(1, 1, 1, 0.72))
	node.custom_minimum_size.y = min(max_height, float(text.count("\n") + 1) * 14.0 + 22.0)
	return node


func _render_political_debug(column: VBoxContainer) -> void:
	var debug := _sd("ce_debug")
	var section := _details("Political Debug · prove what the simulator sees", "cp_debug", false, column, 12, 850)
	section.add_child(_note("Read-only canonical and derived state. This includes values the editor cannot directly modify, plus the complete supported trait catalog with unset dimensions preserved.", 10, Color(1, 1, 1, 0.45)))
	var buttons := HFlowContainer.new()
	buttons.add_theme_constant_override("h_separation", 6)
	buttons.add_theme_constant_override("v_separation", 6)
	for spec in [["Copy full Political World JSON", "actor", "Copied full Political World JSON."], ["Copy decision capsule", "decision", "Copied Political Decision Context capsule."], ["Copy numeric/debug snapshot", "snapshot", "Copied political numeric/debug snapshot."]]:
		var copy := _btn(str(spec[0]), "plain", 12)
		var source := str(spec[1])
		var done := str(spec[2])
		copy.pressed.connect(func() -> void:
			var text := _sv("ce_decision") if source == "decision" else str(_sd("ce_debug").get(source, "null"))
			DisplayServer.clipboard_set(text)
			_status = done
			_render())
		buttons.add_child(copy)
	section.add_child(buttons)
	section.add_child(_gap(4))
	section.add_child(_section_label("All supported traits · current canonical values"))
	var grid := _two_columns()
	grid.add_theme_constant_override("v_separation", 5)
	var traits: Array = debug.get("traits", [])
	if traits.is_empty():
		for entry_value in _s.get("ce_registry", []):
			var entry: Dictionary = entry_value
			traits.append({"key": entry.get("key", ""), "label": entry.get("label", ""), "value": null})
	for trait_value in traits:
		var trait_row: Dictionary = trait_value
		var cell: Array = _box(Color(1, 1, 1, 0.025), Color(0, 0, 0, 0), 7, Vector4(7, 5, 7, 5), 0)
		var line := HBoxContainer.new()
		var label := UI.label(str(trait_row.get("label", "")), 10, UI.WHITE)
		label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		label.clip_text = true
		line.add_child(label)
		var value: Variant = trait_row.get("value")
		line.add_child(UI.label("unset" if value == null else str(value), 10, Color(1, 1, 1, 0.34) if value == null else Color(1, 1, 1, 0.82), 400, "Consolas"))
		(cell[1] as VBoxContainer).add_child(line)
		grid.add_child(cell[0])
	section.add_child(grid)
	for spec in [["Decision authority · derived/native", "decisionAuthority", 208.0], ["Behavioral disposition · stored", "storedDisposition", 208.0], ["Behavioral disposition · derived now", "derivedDisposition", 208.0], ["Full Political World JSON", "actor", 352.0]]:
		section.add_child(_field_label(str(spec[0]), 6))
		section.add_child(_mono_box(str(debug.get(str(spec[1]), "null")), float(spec[2])))
	section.add_child(_field_label("Political decision context · debug", 6))
	var context_box := _mono_box(_sv("ce_decision"), 18.0 * 14.0 + 22.0)
	context_box.custom_minimum_size.y = 18.0 * 14.0 + 22.0
	section.add_child(context_box)


func _feature_kind_label(kind: String) -> String:
	for entry in MAP_FEATURE_KINDS:
		var row: Array = entry
		if str(row[0]) == kind.to_lower():
			return str(row[1])
	return kind.capitalize() if not kind.is_empty() else "Landmark"


func _status_meta(status: String) -> Array:
	var key := status.strip_edges().to_lower()
	return STATUS_META.get(key, STATUS_META["active"])


func _render_feature_editor() -> void:
	_header(str(_tool_meta(_tool).get("title", "")), "Runtime world features + scenario-authored cities")
	var data := _sd("features")
	var markers: Array = data.get("markers", [])
	var cities: Array = data.get("cities", [])
	var custom_cities := bool(data.get("customCities", false))
	var default_tab := "runtime" if (not markers.is_empty() or not custom_cities) else "cities"
	var tab := _sv("fe_tab", default_tab)
	var intro: Array = _box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.1), 10, Vector4(10, 9, 10, 9))
	(intro[1] as VBoxContainer).add_child(_rich("[b][color=#f4f4f5]Two native layers, one editor.[/color][/b] Runtime features live in the canonical world and coexist with cities. Scenario cities are the authored historical city set used when this scenario has custom cities enabled.", 11, Color(1, 1, 1, 0.55)))
	_body.add_child(intro[0])
	_body.add_child(_gap(9))
	var add := _btn("+ Add new map feature", "primary")
	add.pressed.connect(func() -> void: _go("add-feature"))
	_body.add_child(add)
	_body.add_child(_gap(8))
	var tabs := HBoxContainer.new()
	tabs.add_theme_constant_override("separation", 6)
	for pair in [["runtime", "World features · %d" % markers.size()], ["cities", "Scenario cities · %d" % cities.size()]]:
		var key := str(pair[0])
		var tab_button := _wide(_btn(str(pair[1]), "active" if tab == key else "quiet", 11)) as Button
		tab_button.pressed.connect(func() -> void:
			_s["fe_tab"] = key
			_s["fe_editing"] = ""
			_s["fe_fields"] = {}
			_s["fe_search"] = ""
			_render())
		tabs.add_child(tab_button)
	_body.add_child(tabs)
	_body.add_child(_gap(8))
	_body.add_child(_line(_sv("fe_search"), "Search name, type, owner, status…" if tab == "runtime" else "Search scenario cities…", func(text: String) -> void:
		_s["fe_search"] = text
		_fe_rebuild_list()))
	_body.add_child(_gap(8))
	_list_holder = VBoxContainer.new()
	_list_holder.add_theme_constant_override("separation", 6)
	_body.add_child(_list_holder)
	_fe_fill_list()
	_status_line(_body)


func _fe_rebuild_list() -> void:
	if not is_instance_valid(_list_holder):
		return
	_clear(_list_holder)
	_fe_fill_list()
	_fit()


func _fe_fill_list() -> void:
	var data := _sd("features")
	var markers: Array = data.get("markers", [])
	var cities: Array = data.get("cities", [])
	var custom_cities := bool(data.get("customCities", false))
	var tab := _sv("fe_tab", "runtime" if (not markers.is_empty() or not custom_cities) else "cities")
	var query := _sv("fe_search").strip_edges().to_lower()
	if tab == "runtime":
		var shown := 0
		for marker_value in markers:
			var marker: Dictionary = marker_value
			if not query.is_empty():
				var found := false
				for field in ["name", "kind", "ownerCode", "status", "note"]:
					if str(marker.get(field, "")).to_lower().contains(query):
						found = true
				if not found:
					continue
			shown += 1
			if shown > 80:
				break
			_list_holder.add_child(_fe_marker_card(marker))
		if shown == 0:
			_list_holder.add_child(_note("No runtime world features match this view. Use + Add new map feature above to create HQs, ports, landmarks, temporary markers, and more without replacing the city layer.", 11, Color(1, 1, 1, 0.44)))
		return
	if not custom_cities:
		var warn: Array = _box(Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.08), Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.22), 9, Vector4(10, 9, 10, 9))
		(warn[1] as VBoxContainer).add_child(_note("This campaign currently uses the stock PMTiles city database. Those source records are immutable at runtime. Add Map Feature will therefore create new cities as runtime world features instead of replacing every stock city.", 11, Color(253 / 255.0, 230 / 255.0, 138 / 255.0, 0.92)))
		_list_holder.add_child(warn[0])
		return
	var count := 0
	for city_value in cities:
		var city: Dictionary = city_value
		if not query.is_empty() and not str(city.get("name", "")).to_lower().contains(query):
			continue
		count += 1
		if count > 80:
			break
		_list_holder.add_child(_fe_city_card(city))
	if count == 0:
		_list_holder.add_child(_note("No scenario cities match this view.", 11, Color(1, 1, 1, 0.44)))


func _fe_fields() -> Dictionary:
	return _sd("fe_fields")


func _fe_set(key: String, value: Variant) -> void:
	var fields := _fe_fields()
	fields[key] = value
	_s["fe_fields"] = fields


func _fe_marker_card(marker: Dictionary) -> Control:
	var id := str(marker.get("id", ""))
	var key := "marker:" + id
	var editing := _sv("fe_editing") == key
	var name := str(marker.get("name", ""))
	var card: Array = _box(Color(1, 1, 1, 0.04), Color(0, 0, 0, 0.5) if editing else Color(1, 1, 1, 0.09), 10, Vector4(10, 9, 10, 9), 6)
	var column: VBoxContainer = card[1]
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	var text := VBoxContainer.new()
	text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var title_row := HFlowContainer.new()
	title_row.add_theme_constant_override("h_separation", 5)
	title_row.add_theme_constant_override("v_separation", 3)
	var title := UI.label(name, 13, Color("#f4f4f5"), 800)
	title_row.add_child(title)
	title_row.add_child(_pill_label("RUNTIME", Color("#e4e4e7"), Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.1)))
	var meta := _status_meta(str(marker.get("status", "active")))
	title_row.add_child(_pill_label(str(meta[0]).to_upper(), Color(str(meta[1])), Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.1)))
	text.add_child(title_row)
	var owner := str(marker.get("ownerCode", ""))
	text.add_child(UI.label(_feature_kind_label(str(marker.get("kind", ""))) + (" · %s" % _name_of(owner) if not owner.is_empty() else ""), 10, Color(1, 1, 1, 0.42)))
	row.add_child(text)
	var edit := _btn("Close" if editing else "Edit", "plain", 11)
	edit.custom_minimum_size.y = 26
	edit.pressed.connect(func() -> void:
		if editing:
			_s["fe_editing"] = ""
			_s["fe_fields"] = {}
		else:
			var kind := str(marker.get("kind", ""))
			var known := false
			for entry in MAP_FEATURE_KINDS:
				if str((entry as Array)[0]) == kind:
					known = true
			_s["fe_editing"] = key
			_s["fe_fields"] = {"name": name, "kind": kind if known else "other", "customKind": "" if known else kind, "ownerCode": owner, "status": str(marker.get("status", "active")), "note": str(marker.get("note", "")), "foundedAt": str(marker.get("foundedAt", "")), "lng": str(marker.get("lng", "")), "lat": str(marker.get("lat", ""))}
		_render())
	row.add_child(edit)
	var confirming := _sv("fe_confirm") == key
	var delete := _btn("Delete", "danger", 11)
	delete.custom_minimum_size.y = 26
	_enable(delete, not _busy)
	delete.pressed.connect(func() -> void:
		_s["fe_confirm"] = key
		_render())
	row.add_child(delete)
	column.add_child(row)
	if confirming:
		column.add_child(_fe_confirm("Delete “%s” from the canonical world?" % name, func() -> void:
			var reply := await _run("cheats.features.marker_ops", {"ops": [{"op": "remove", "markerId": id, "name": name, "note": "Map Feature Editor delete"}]}, "%s deleted." % name)
			if reply.get("ok", false):
				_status = "%s deleted." % name
				_s["fe_editing"] = ""
			_s["fe_confirm"] = ""
			await _load_into("cheats.features.get", {}, "features")
			_render()))
	if editing:
		_fe_marker_form(column, marker)
	return card[0]


func _fe_confirm(question: String, action: Callable) -> Control:
	var box: Array = _box(Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.08), Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.3), 8, Vector4(9, 8, 9, 8), 6)
	(box[1] as VBoxContainer).add_child(_note(question, 11, Color(1, 1, 1, 0.85)))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	var yes := _wide(_btn("Confirm", "danger", 12)) as Button
	_enable(yes, not _busy)
	yes.pressed.connect(func() -> void: action.call())
	row.add_child(yes)
	var no := _wide(_btn("Cancel", "plain", 12)) as Button
	no.pressed.connect(func() -> void:
		_s["fe_confirm"] = ""
		_render())
	row.add_child(no)
	(box[1] as VBoxContainer).add_child(row)
	return box[0]


func _kind_grid(selected: String, key: String, columns := 3) -> GridContainer:
	var grid := GridContainer.new()
	grid.columns = columns
	grid.add_theme_constant_override("h_separation", 4)
	grid.add_theme_constant_override("v_separation", 4)
	for entry in MAP_FEATURE_KINDS:
		var row: Array = entry
		var id := str(row[0])
		var choice := _wide(_btn("%s %s" % [str(row[2]), str(row[1])], "active" if selected == id else "quiet", 11)) as Button
		choice.custom_minimum_size.y = 30
		choice.pressed.connect(func() -> void:
			_fe_set(key, id)
			_render())
		grid.add_child(choice)
	return grid


func _status_options() -> Array:
	var options: Array = []
	for status in _sd("features").get("statuses", STATUS_META.keys()):
		options.append([str(status), str(_status_meta(str(status))[0])])
	return options


func _fe_marker_form(column: VBoxContainer, marker: Dictionary) -> void:
	var fields := _fe_fields()
	var name := str(marker.get("name", ""))
	var rule := ColorRect.new()
	rule.color = Color(1, 1, 1, 0.07)
	rule.custom_minimum_size.y = 1
	column.add_child(rule)
	column.add_child(_field_label("Name", 2))
	column.add_child(_line(str(fields.get("name", "")), "", func(text: String) -> void: _fe_set("name", text)))
	column.add_child(_field_label("Feature type"))
	column.add_child(_kind_grid(str(fields.get("kind", "")), "kind"))
	if str(fields.get("kind", "")) == "other":
		column.add_child(_line(str(fields.get("customKind", "")), "Custom type, e.g. observatory", func(text: String) -> void: _fe_set("customKind", text)))
	column.add_child(_field_label("Associated country (optional)"))
	column.add_child(_polity_select(str(fields.get("ownerCode", "")), "Neutral / no associated country", func(code: String) -> void: _fe_set("ownerCode", code)))
	column.add_child(_field_label("Lifecycle status"))
	column.add_child(_select(_status_options(), str(fields.get("status", "active")), "", func(value: String) -> void: _fe_set("status", value)))
	column.add_child(_field_label("Note (optional)"))
	column.add_child(_area(str(fields.get("note", "")), "", 3, func(text: String) -> void: _fe_set("note", text)))
	column.add_child(_field_label("Founded / established date (optional)"))
	column.add_child(_line(str(fields.get("foundedAt", "")), str(_game.get("gameDate", "YYYY-MM-DD")), func(text: String) -> void: _fe_set("foundedAt", text)))
	column.add_child(_gap(4))
	var buttons := HBoxContainer.new()
	buttons.add_theme_constant_override("separation", 6)
	var place := _wide(_btn("Place on map →")) as Button
	_enable(place, not _busy and map_view != null)
	place.pressed.connect(func() -> void:
		_begin_pick("Click the new map position for “%s”" % name, func(job: Dictionary) -> void:
			var at: Vector2 = job.get("lnglat", Vector2.ZERO)
			var next := _fe_fields().duplicate()
			next["lng"] = at.x
			next["lat"] = at.y
			var reply: Dictionary = await engine.request("cheats.features.marker_save", {"marker": marker, "fields": next})
			if reply.get("ok", false):
				_status = "%s moved authoritatively." % name
				_s["fe_editing"] = ""
				_s["fe_fields"] = {}
				world_changed.emit()
			else:
				_status = "Failed: %s" % str(reply.get("error", ""))
			await _load_into("cheats.features.get", {}, "features")
			_end_pick()))
	buttons.add_child(place)
	var save := _wide(_btn("Save feature", "primary")) as Button
	_enable(save, not _busy)
	save.pressed.connect(func() -> void:
		var reply := await _run("cheats.features.marker_save", {"marker": marker, "fields": _fe_fields()})
		if reply.get("ok", false):
			_status = "%s saved." % str((reply["result"] as Dictionary).get("name", name))
			_s["fe_editing"] = ""
			_s["fe_fields"] = {}
		await _load_into("cheats.features.get", {}, "features")
		_render())
	buttons.add_child(save)
	column.add_child(buttons)
	var coords_holder := VBoxContainer.new()
	var coords := _details("Manual coordinates · advanced", "fe_coords", false, coords_holder, 10, 400)
	var pair := HBoxContainer.new()
	pair.add_theme_constant_override("separation", 6)
	pair.add_child(_line(str(fields.get("lng", "")), "Longitude", func(text: String) -> void: _fe_set("lng", text)))
	pair.add_child(_line(str(fields.get("lat", "")), "Latitude", func(text: String) -> void: _fe_set("lat", text)))
	coords.add_child(pair)
	column.add_child(coords_holder)


func _fe_city_card(city: Dictionary) -> Control:
	var index := int(city.get("index", -1))
	var key := "city:%d" % index
	var editing := _sv("fe_editing") == key
	var name := str(city.get("name", ""))
	var tier := int(city.get("tier", 2))
	var card: Array = _box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.28) if editing else Color(1, 1, 1, 0.09), 10, Vector4(10, 9, 10, 9), 6)
	var column: VBoxContainer = card[1]
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	var text := VBoxContainer.new()
	text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var title_row := HFlowContainer.new()
	title_row.add_theme_constant_override("h_separation", 5)
	title_row.add_theme_constant_override("v_separation", 3)
	var title := UI.label(name, 13, UI.WHITE, 800)
	title_row.add_child(title)
	title_row.add_child(_pill_label("CITY", Color("#bfdbfe"), Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.1)))
	text.add_child(title_row)
	var prominence := "Tier %d" % tier
	for entry in CITY_PROMINENCE:
		if int((entry as Array)[0]) == tier:
			prominence = str((entry as Array)[1])
	var population := int(city.get("population", 0))
	text.add_child(UI.label(prominence + (" · %s" % _grouped(population) if population > 0 else ""), 10, Color(1, 1, 1, 0.42)))
	row.add_child(text)
	var edit := _btn("Close" if editing else "Edit", "plain", 11)
	edit.custom_minimum_size.y = 26
	edit.pressed.connect(func() -> void:
		if editing:
			_s["fe_editing"] = ""
			_s["fe_fields"] = {}
		else:
			_s["fe_editing"] = key
			_s["fe_fields"] = {"name": name, "tier": str(tier), "population": str(population)}
		_render())
	row.add_child(edit)
	var delete := _btn("Delete", "danger", 11)
	delete.custom_minimum_size.y = 26
	_enable(delete, not _busy)
	delete.pressed.connect(func() -> void:
		_s["fe_confirm"] = key
		_render())
	row.add_child(delete)
	column.add_child(row)
	if _sv("fe_confirm") == key:
		column.add_child(_fe_confirm("Delete scenario city “%s”?" % name, func() -> void:
			var reply := await _run("cheats.features.city_delete", {"index": index})
			if reply.get("ok", false):
				_status = "%s deleted from the scenario city layer." % name
				_s["fe_editing"] = ""
			_s["fe_confirm"] = ""
			await _load_into("cheats.features.get", {}, "features")
			_render()))
	if editing:
		var fields := _fe_fields()
		column.add_child(_field_label("Name", 2))
		column.add_child(_line(str(fields.get("name", "")), "", func(value: String) -> void: _fe_set("name", value)))
		column.add_child(_field_label("Prominence"))
		var grid := GridContainer.new()
		grid.columns = 4
		grid.add_theme_constant_override("h_separation", 4)
		for entry in CITY_PROMINENCE:
			var level := int((entry as Array)[0])
			var choice := _wide(_btn(str((entry as Array)[1]), "active" if int(str(fields.get("tier", "2"))) == level else "quiet", 11)) as Button
			choice.pressed.connect(func() -> void:
				_fe_set("tier", str(level))
				_render())
			grid.add_child(choice)
		column.add_child(grid)
		column.add_child(_field_label("Population"))
		column.add_child(_number_line(str(fields.get("population", "")), "", 0.0, INF, 1000.0, func(value: String) -> void: _fe_set("population", value)))
		column.add_child(_rich("Tier controls historical-map visibility: Town → City → Major city → Capital. Capital uses the renderer's canonical [code]primary[/code] flag.", 10, Color(1, 1, 1, 0.4)))
		var buttons := HBoxContainer.new()
		buttons.add_theme_constant_override("separation", 6)
		var place := _wide(_btn("Place on map →")) as Button
		_enable(place, not _busy and map_view != null)
		place.pressed.connect(func() -> void:
			_begin_pick("Click the new map position for “%s”" % name, func(job: Dictionary) -> void:
				var at: Vector2 = job.get("lnglat", Vector2.ZERO)
				var f := _fe_fields()
				var reply: Dictionary = await engine.request("cheats.features.city_save", {"index": index, "name": str(f.get("name", "")), "tier": int(str(f.get("tier", "2"))), "population": str(f.get("population", "")), "lng": at.x, "lat": at.y})
				if reply.get("ok", false):
					_status = "%s moved on the scenario city layer." % str((reply["result"] as Dictionary).get("name", name))
					_s["fe_editing"] = ""
					_s["fe_fields"] = {}
					world_changed.emit()
				else:
					_status = "Failed: %s" % str(reply.get("error", ""))
				await _load_into("cheats.features.get", {}, "features")
				_end_pick()))
		buttons.add_child(place)
		var save := _wide(_btn("Save city", "primary")) as Button
		_enable(save, not _busy)
		save.pressed.connect(func() -> void:
			var f := _fe_fields()
			var reply := await _run("cheats.features.city_save", {"index": index, "name": str(f.get("name", "")), "tier": int(str(f.get("tier", "2"))), "population": str(f.get("population", ""))})
			if reply.get("ok", false):
				_status = "%s saved and refreshed on the map." % str((reply["result"] as Dictionary).get("name", name))
				_s["fe_editing"] = ""
				_s["fe_fields"] = {}
			await _load_into("cheats.features.get", {}, "features")
			_render())
		buttons.add_child(save)
		column.add_child(buttons)
		column.add_child(UI.label("Coordinates: %.4f, %.4f" % [float(city.get("lng", 0.0)), float(city.get("lat", 0.0))], 10, Color(1, 1, 1, 0.34)))
	return card[0]


func _grouped(value: int) -> String:
	var whole := str(abs(value))
	var out := ""
	var count := 0
	for index in range(whole.length() - 1, -1, -1):
		out = whole[index] + out
		count += 1
		if count % 3 == 0 and index > 0:
			out = "," + out
	return ("-" if value < 0 else "") + out


func _render_add_feature() -> void:
	_header(str(_tool_meta(_tool).get("title", "")), "Create a persistent city or world feature without replacing unrelated map data")
	var fields := _fe_fields()
	var type := str(fields.get("addType", "landmark"))
	var is_city := type == "city"
	var uses_custom := bool(_sd("features").get("customCities", false))
	var back := _btn("← Back to Map Feature Editor")
	back.pressed.connect(func() -> void: _go("edit-feature"))
	_body.add_child(back)
	_body.add_child(_gap(9))
	var intro: Array = _box(Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.07), Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.2), 10, Vector4(10, 9, 10, 9))
	(intro[1] as VBoxContainer).add_child(_rich("[b]Safe coexistence:[/b] HQs, ports, landmarks, and other live features go into [code]world.markers[/code]. A new city joins the scenario city dataset only when this scenario already uses one; otherwise it becomes a runtime city marker so the stock city database stays intact.", 11, Color(219 / 255.0, 234 / 255.0, 254 / 255.0, 0.82)))
	_body.add_child(intro[0])
	_body.add_child(_field_label("Feature type", 9))
	_body.add_child(_kind_grid(type, "addType"))
	if type == "other":
		_body.add_child(_gap(6))
		_body.add_child(_line(str(fields.get("customKind", "")), "Custom type, e.g. observatory", func(text: String) -> void: _fe_set("customKind", text)))
	_body.add_child(_field_label("Name"))
	var place := _btn("Place on map →", "primary")
	_body.add_child(_line(str(fields.get("name", "")), "Alexandria" if is_city else "German Military Mission HQ", func(text: String) -> void:
		_fe_set("name", text)
		_enable(place, not _busy and not text.strip_edges().is_empty())))
	if is_city and uses_custom:
		_body.add_child(_field_label("Prominence"))
		var grid := GridContainer.new()
		grid.columns = 4
		grid.add_theme_constant_override("h_separation", 4)
		for entry in CITY_PROMINENCE:
			var level := int((entry as Array)[0])
			var choice := _wide(_btn(str((entry as Array)[1]), "active" if int(str(fields.get("tier", "2"))) == level else "quiet", 11)) as Button
			choice.pressed.connect(func() -> void:
				_fe_set("tier", str(level))
				_render())
			grid.add_child(choice)
		_body.add_child(grid)
		_body.add_child(_field_label("Population (optional)"))
		_body.add_child(_number_line(str(fields.get("population", "")), "", 0.0, INF, 1000.0, func(text: String) -> void: _fe_set("population", text)))
		_body.add_child(_gap(6))
		_body.add_child(_note("This scenario already uses historical custom cities, so the new city will join that same authored layer with proper population and prominence metadata.", 10, Color("#bfdbfe")))
	else:
		if is_city:
			_body.add_child(_gap(8))
			var warn: Array = _box(Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.07), Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.18), 8, Vector4(9, 7, 9, 7))
			(warn[1] as VBoxContainer).add_child(_note("This campaign uses immutable stock cities. The new city will therefore be a runtime city marker so the stock database stays intact. Runtime markers do not currently carry city population/prominence fields.", 10, Color(253 / 255.0, 230 / 255.0, 138 / 255.0, 0.82)))
			_body.add_child(warn[0])
		_body.add_child(_field_label("Associated country (optional)"))
		_body.add_child(_polity_select(str(fields.get("ownerCode", "")), "Neutral / no associated country", func(code: String) -> void: _fe_set("ownerCode", code)))
		_body.add_child(_field_label("Lifecycle status"))
		_body.add_child(_select(_status_options(), str(fields.get("status", "active")), "", func(value: String) -> void: _fe_set("status", value)))
		_body.add_child(_gap(5))
		_body.add_child(_note("Planned and under-construction features remain canonical map objects before they become operational; damaged, abandoned, and destroyed features also remain visible historical objects.", 10, Color(1, 1, 1, 0.38)))
		_body.add_child(_field_label("Note (optional)"))
		_body.add_child(_area(str(fields.get("note", "")), "Purpose, status, or short description…", 3, func(text: String) -> void: _fe_set("note", text)))
		_body.add_child(_field_label("Founded / established date (optional)"))
		_body.add_child(_line(str(fields.get("foundedAt", _game.get("gameDate", ""))), "YYYY-MM-DD", func(text: String) -> void: _fe_set("foundedAt", text)))
	_body.add_child(_gap(12))
	_enable(place, not _busy and not str(fields.get("name", "")).strip_edges().is_empty() and map_view != null)
	place.pressed.connect(_af_begin_placement)
	_body.add_child(place)
	_body.add_child(_gap(6))
	_body.add_child(_note("Placement changes the present canonical world only. Normal future simulation remains free to rename or lifecycle-update the same stable feature; historical damage/destruction changes status rather than deleting its identity.", 10, Color(1, 1, 1, 0.4)))
	_status_line(_body)


func _af_begin_placement() -> void:
	var fields := _fe_fields()
	var type := str(fields.get("addType", "landmark"))
	var name := str(fields.get("name", "")).strip_edges()
	var custom_kind := str(fields.get("customKind", "")).strip_edges() if type == "other" else type
	if name.is_empty():
		_status = "Failed: Give the feature a name first."
		_render()
		return
	if type == "other" and custom_kind.is_empty():
		_status = "Failed: Give the custom feature type a name."
		_render()
		return
	var is_city := type == "city"
	var uses_custom := bool(_sd("features").get("customCities", false))
	var status_value := str(fields.get("status", "active")).strip_edges().to_lower()
	if not STATUS_META.has(status_value):
		status_value = "active"
	var marker := {"name": name, "kind": "city" if is_city else custom_kind, "ownerCode": str(fields.get("ownerCode", "")).strip_edges(), "status": status_value, "note": str(fields.get("note", "")).strip_edges(), "foundedAt": str(fields.get("foundedAt", _game.get("gameDate", ""))).strip_edges()}
	_begin_pick("Click the map where “%s” goes" % name, func(job: Dictionary) -> void:
		var at: Vector2 = job.get("lnglat", Vector2.ZERO)
		var reply: Dictionary = {}
		if is_city and uses_custom:
			reply = await engine.request("cheats.features.city_add", {"name": name, "tier": int(str(fields.get("tier", "2"))), "population": str(fields.get("population", "")), "lng": at.x, "lat": at.y})
			if reply.get("ok", false):
				_status = "%s added to the scenario city layer and refreshed live." % name
				_s["fe_fields"] = {"addType": "city"}
		else:
			var placed := marker.duplicate()
			placed["lng"] = at.x
			placed["lat"] = at.y
			reply = await engine.request("cheats.features.marker_add", {"marker": placed})
			if reply.get("ok", false):
				_status = "%s added as a persistent world feature." % name
				_s["fe_fields"] = {"addType": type, "status": "active"}
		if reply.get("ok", false):
			world_changed.emit()
		else:
			_status = "Failed: %s" % str(reply.get("error", ""))
		await _load_into("cheats.features.get", {}, "features")
		_end_pick())


func _render_clear_features() -> void:
	_header(str(_tool_meta(_tool).get("title", "")), "Destructive cleanup for runtime features and scenario city layers")
	var data := _sd("features")
	var marker_count := (data.get("markers", []) as Array).size()
	var city_count := (data.get("cities", []) as Array).size()
	var custom := bool(data.get("customCities", false))
	var grid := _two_columns()
	for pair in [["Runtime features", str(marker_count)], ["Scenario cities", str(city_count) if custom else "Stock"]]:
		var cell: Array = _box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.08), 9, Vector4(9, 9, 9, 9), 2)
		(cell[1] as VBoxContainer).add_child(UI.label(str(pair[0]).to_upper(), 10, Color(1, 1, 1, 0.42), 800))
		(cell[1] as VBoxContainer).add_child(UI.label(str(pair[1]), 16, UI.WHITE, 850))
		grid.add_child(cell[0])
	_body.add_child(grid)
	_body.add_child(_gap(10))
	var confirm := _sv("cf_confirm")
	var delete_markers := _btn("Delete all runtime features", "danger")
	if marker_count == 0:
		delete_markers.add_theme_color_override("font_color", Color(1, 1, 1, 0.35))
		delete_markers.add_theme_color_override("font_disabled_color", Color(1, 1, 1, 0.35))
	_enable(delete_markers, not _busy and marker_count > 0)
	delete_markers.pressed.connect(func() -> void:
		_s["cf_confirm"] = "markers"
		_render())
	_body.add_child(delete_markers)
	if confirm == "markers":
		_body.add_child(_gap(6))
		_body.add_child(_cf_confirm("Delete all %d runtime world feature%s?" % [marker_count, "" if marker_count == 1 else "s"], "markers"))
	if custom:
		_body.add_child(_gap(7))
		var delete_cities := _btn("Delete all scenario cities", "danger")
		_enable(delete_cities, not _busy and city_count > 0)
		delete_cities.pressed.connect(func() -> void:
			_s["cf_confirm"] = "cities"
			_render())
		_body.add_child(delete_cities)
		if confirm == "cities":
			_body.add_child(_gap(6))
			_body.add_child(_cf_confirm("Delete all %d scenario-authored cities? The historical city layer will become empty." % city_count, "cities"))
	_body.add_child(_gap(9))
	var advanced: Array = _box(Color(1, 1, 1, 0.03), Color(1, 1, 1, 0.07), 9, Vector4(9, 6, 9, 6), 5)
	var inner := _details("Advanced · city-layer source", "cf_source", false, advanced[1], 11)
	inner.add_child(_note("Turning off scenario cities restores the stock PMTiles city database. On historical scenarios this may reintroduce modern/anachronistic cities, so this is intentionally not the default cleanup action.", 10, Color(1, 1, 1, 0.43)))
	var stock := _btn("Use standard world cities instead")
	_enable(stock, not _busy and custom)
	stock.pressed.connect(func() -> void:
		await _run("cheats.features.clear", {"what": "stock"})
		await _load_into("cheats.features.get", {}, "features")
		await refresh())
	inner.add_child(stock)
	_body.add_child(advanced[0])
	_status_line(_body)


func _cf_confirm(question: String, what: String) -> Control:
	var box: Array = _box(Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.08), Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.3), 8, Vector4(9, 8, 9, 8), 6)
	(box[1] as VBoxContainer).add_child(_note(question, 11, Color(1, 1, 1, 0.85)))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	var yes := _wide(_btn("Confirm", "danger", 12)) as Button
	_enable(yes, not _busy)
	yes.pressed.connect(func() -> void:
		_s["cf_confirm"] = ""
		await _run("cheats.features.clear", {"what": what})
		await _load_into("cheats.features.get", {}, "features")
		_render())
	row.add_child(yes)
	var no := _wide(_btn("Cancel", "plain", 12)) as Button
	no.pressed.connect(func() -> void:
		_s["cf_confirm"] = ""
		_render())
	row.add_child(no)
	(box[1] as VBoxContainer).add_child(row)
	return box[0]


func _event_query() -> Dictionary:
	return {"search": _sv("ev_search"), "filter": _sv("ev_filter", "all"), "sort": _sv("ev_sort", "newest"), "limit": int(_s.get("ev_limit", 80))}


func _ev_reload_list() -> void:
	var reply: Dictionary = await engine.request("cheats.events.rows", _event_query())
	if reply.get("ok", false):
		_s["ev"] = reply["result"]
	if is_instance_valid(_list_holder):
		_clear(_list_holder)
		_ev_fill_list()
		_fit()


func _ev_after_change(_reply: Dictionary) -> void:
	await _load_into("cheats.events.rows", _event_query(), "ev")
	_render()


func _ev_choice(text: String, active: bool, action: Callable) -> Button:
	var button := _wide(_btn(text.capitalize() if text == text.to_lower() else text, "active" if active else "quiet", 10)) as Button
	button.custom_minimum_size.y = 30
	button.pressed.connect(func() -> void: action.call())
	return button


func _ev_form_editor(form_key: String, parent: VBoxContainer, with_date_hint: bool) -> void:
	var form := _sd(form_key)
	var setter := func(key: String, value: Variant) -> void:
		var next := _sd(form_key)
		next[key] = value
		_s[form_key] = next
	parent.add_child(_field_label("Date", 6))
	parent.add_child(_date_line(str(form.get("date", "")), func(text: String) -> void: setter.call("date", text)))
	parent.add_child(_field_label("Title", 6))
	parent.add_child(_line(str(form.get("title", "")), "Exact event title" if with_date_hint else "", func(text: String) -> void: setter.call("title", text)))
	parent.add_child(_field_label("Description", 6))
	parent.add_child(_area(str(form.get("description", "")), "What canonically happened?" if with_date_hint else "", 4, func(text: String) -> void: setter.call("description", text)))
	parent.add_child(_gap(6))
	var quote_box: Array = _box(Color(0, 0, 0, 0.22), Color(1, 1, 1, 0.11), 9, Vector4(9, 5, 9, 5), 4)
	var quote := _details("Optional quotation", form_key + "-quote", false, quote_box[1], 11, 750)
	quote.add_child(_note("Quotes are occasional presentation metadata, not a mechanical impact. Leave blank for ordinary events.", 10, Color(1, 1, 1, 0.4)))
	quote.add_child(_field_label("Quote text", 4))
	quote.add_child(_area(str(form.get("quoteText", "")), "Quotation text without surrounding quotation marks", 3, func(text: String) -> void: setter.call("quoteText", text)))
	var quote_grid := _two_columns()
	var speaker := VBoxContainer.new()
	speaker.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	speaker.add_child(_field_label("Speaker", 4))
	speaker.add_child(_line(str(form.get("quoteSpeaker", "")), "Optional attribution", func(text: String) -> void: setter.call("quoteSpeaker", text)))
	quote_grid.add_child(speaker)
	var role := VBoxContainer.new()
	role.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	role.add_child(_field_label("Role / title", 4))
	role.add_child(_line(str(form.get("quoteRole", "")), "Optional office or role", func(text: String) -> void: setter.call("quoteRole", text)))
	quote_grid.add_child(role)
	quote.add_child(quote_grid)
	parent.add_child(quote_box[0])
	parent.add_child(_gap(6))
	var meta_box: Array = _box(Color(0, 0, 0, 0.22), Color(1, 1, 1, 0.11), 9, Vector4(9, 5, 9, 5), 4)
	var meta := _details("Advanced event metadata", form_key + "-meta", false, meta_box[1], 11, 750)
	var data := _sd("ev")
	meta.add_child(_field_label("Importance", 4))
	var importance_options: Array = data.get("importanceOptions", ["minor", "major"])
	var importance_grid := GridContainer.new()
	importance_grid.columns = clampi(importance_options.size(), 1, 4)
	importance_grid.add_theme_constant_override("h_separation", 5)
	importance_grid.add_theme_constant_override("v_separation", 5)
	for option in importance_options:
		var value := str(option)
		importance_grid.add_child(_ev_choice(value, str(form.get("importance", "minor")) == value, func() -> void:
			setter.call("importance", value)
			_render()))
	meta.add_child(importance_grid)
	meta.add_child(_field_label("Kind", 6))
	var kind_grid := GridContainer.new()
	kind_grid.columns = 3
	kind_grid.add_theme_constant_override("h_separation", 5)
	kind_grid.add_theme_constant_override("v_separation", 5)
	for option in data.get("kindOptions", []):
		var value := str(option)
		kind_grid.add_child(_ev_choice(value, str(form.get("kind", "world")) == value, func() -> void:
			setter.call("kind", value)
			_render()))
	meta.add_child(kind_grid)
	var flags := HBoxContainer.new()
	flags.add_theme_constant_override("separation", 14)
	flags.add_child(_check("Notable", bool(form.get("notable", false)), func(on: bool) -> void: setter.call("notable", on)))
	flags.add_child(_check("Player-related", bool(form.get("playerRelated", false)), func(on: bool) -> void: setter.call("playerRelated", on)))
	meta.add_child(flags)
	parent.add_child(meta_box[0])
	parent.add_child(_gap(6))
	var allow := bool(form.get("allowNpcReactions", false))
	var npc: Array = _box(Color(16 / 255.0, 185 / 255.0, 129 / 255.0, 0.07) if allow else Color(0, 0, 0, 0.22), Color(52 / 255.0, 211 / 255.0, 153 / 255.0, 0.28) if allow else Color(1, 1, 1, 0.11), 9, Vector4(9, 8, 9, 8), 3)
	var npc_check := _check("Allow NPC diplomatic reactions", allow, func(on: bool) -> void:
		setter.call("allowNpcReactions", on)
		_render())
	npc_check.add_theme_font_override("font", UI.font(800))
	(npc[1] as VBoxContainer).add_child(npc_check)
	(npc[1] as VBoxContainer).add_child(_note("After a 12-second undo window, the AI may send one natural diplomatic follow-up — or none. Minor friendly reactions such as congratulations, condolences, curiosity, or simple goodwill are allowed; enabling this never guarantees a message.", 10, Color(1, 1, 1, 0.42)))
	parent.add_child(npc[0])


func _render_events() -> void:
	_meta_header()
	var data := _sd("ev")
	var intro: Array = _box(Color(1, 1, 1, 0.045), Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.2), 10, Vector4(10, 9, 10, 9))
	(intro[1] as VBoxContainer).add_child(_rich("[b][color=#dbeafe]Canonical history editor.[/color][/b] Text, optional quotations, and metadata edits immediately change the persistent timeline. Already-applied state effects are deliberately not replayed, reverted, or reinterpreted here.", 11, Color(219 / 255.0, 234 / 255.0, 254 / 255.0, 0.78)))
	_body.add_child(intro[0])
	_body.add_child(_gap(9))
	var counts: Dictionary = data.get("counts", {})
	var grid := GridContainer.new()
	grid.columns = 4
	grid.add_theme_constant_override("h_separation", 6)
	for pair in [["Events", "total"], ["Campaign", "campaign"], ["Notable", "notable"], ["Manual", "manual"]]:
		var cell: Array = _box(Color(0, 0, 0, 0.22), Color(1, 1, 1, 0.11), 9, Vector4(8, 7, 8, 7), 1)
		(cell[0] as Control).size_flags_horizontal = Control.SIZE_EXPAND_FILL
		(cell[1] as VBoxContainer).add_child(UI.label(str(pair[0]).to_upper(), 8, Color(1, 1, 1, 0.4), 800, "Arial", 1))
		(cell[1] as VBoxContainer).add_child(UI.label(str(int(counts.get(pair[1], 0))), 14, UI.WHITE, 850))
		grid.add_child(cell[0])
	_body.add_child(grid)
	_body.add_child(_gap(9))
	var add := _btn("+ Add exact event", "primary")
	_enable(add, not _busy)
	add.pressed.connect(func() -> void:
		_s["ev_editing"] = -1
		_s["ev_creating"] = true
		_s["ev_create"] = {"date": str(data.get("currentDate", "")), "title": "", "description": "", "quoteText": "", "quoteSpeaker": "", "quoteRole": "", "importance": "major", "kind": "world", "notable": true, "playerRelated": false, "allowNpcReactions": false}
		_render())
	_body.add_child(add)
	if bool(_s.get("ev_creating", false)):
		_body.add_child(_gap(9))
		var create: Array = _box(Color(0, 0, 0, 0.22), Color(1, 1, 1, 0.23), 9, Vector4(9, 9, 9, 9), 2)
		var column: VBoxContainer = create[1]
		column.add_child(UI.label("NEW CANONICAL EVENT", 11, Color("#f4f4f5"), 850, "Arial", 1))
		column.add_child(_note("Inserts history directly and links it into the normal Events panel. Optional NPC reactions are evaluated separately only after the undo window.", 10, Color(1, 1, 1, 0.42)))
		_ev_form_editor("ev_create", column, true)
		column.add_child(_gap(8))
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 7)
		var confirm := _wide(_btn("Add to canonical history", "primary")) as Button
		_enable(confirm, not _busy)
		confirm.pressed.connect(func() -> void:
			var reply := await _run("cheats.events.add", {"form": _sd("ev_create")})
			if reply.get("ok", false):
				_s["ev_creating"] = false
				_s["ev_create"] = {}
				_s["ev_filter"] = "all"
				_s["ev_sort"] = "newest"
				_s["ev_limit"] = 80
			await _ev_after_change(reply))
		row.add_child(confirm)
		var cancel := _btn("Cancel")
		_enable(cancel, not _busy)
		cancel.pressed.connect(func() -> void:
			_s["ev_creating"] = false
			_s["ev_create"] = {}
			_render())
		row.add_child(cancel)
		column.add_child(row)
		_body.add_child(create[0])
	_body.add_child(_gap(9))
	var search_row := HBoxContainer.new()
	search_row.add_theme_constant_override("separation", 6)
	search_row.add_child(_line(_sv("ev_search"), "Search title, description, date, kind…", func(text: String) -> void:
		_s["ev_search"] = text
		_s["ev_limit"] = 80
		_ev_reload_list()))
	var sort := _sv("ev_sort", "newest")
	for pair in [["newest", "Newest"], ["oldest", "Oldest"]]:
		var key := str(pair[0])
		var sort_button := _btn(str(pair[1]), "active" if sort == key else "quiet", 10)
		sort_button.custom_minimum_size = Vector2(66, 32)
		sort_button.pressed.connect(func() -> void:
			_s["ev_sort"] = key
			await _ev_after_change({}))
		search_row.add_child(sort_button)
	_body.add_child(search_row)
	_body.add_child(_gap(7))
	var filters := HFlowContainer.new()
	filters.add_theme_constant_override("h_separation", 5)
	filters.add_theme_constant_override("v_separation", 5)
	var filter := _sv("ev_filter", "all")
	for pair in [["all", "All"], ["campaign", "Campaign"], ["notable", "Notable"], ["player", "Player"], ["manual", "Manual"]]:
		var key := str(pair[0])
		var chip := _btn(str(pair[1]), "active" if filter == key else "quiet", 10)
		chip.custom_minimum_size.y = 26
		chip.pressed.connect(func() -> void:
			_s["ev_filter"] = key
			_s["ev_limit"] = 80
			await _ev_after_change({}))
		filters.add_child(chip)
	var matches := int(data.get("matches", 0))
	var match_label := UI.label("%d match%s" % [matches, "" if matches == 1 else "es"], 10, Color(1, 1, 1, 0.34))
	match_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	filters.add_child(match_label)
	_body.add_child(filters)
	_body.add_child(_gap(8))
	_list_holder = VBoxContainer.new()
	_list_holder.add_theme_constant_override("separation", 6)
	_body.add_child(_list_holder)
	_ev_fill_list()
	_status_line(_body)


func _ev_fill_list() -> void:
	var data := _sd("ev")
	if not _s.has("ev"):
		_list_holder.add_child(_note("Loading canonical timeline…", 12, Color(1, 1, 1, 0.45)))
		return
	var rows: Array = data.get("rows", [])
	if rows.is_empty():
		_list_holder.add_child(_note("No matching events.", 12, Color(1, 1, 1, 0.45)))
	for row_value in rows:
		_list_holder.add_child(_ev_card(row_value))
	var matches := int(data.get("matches", 0))
	var limit := int(_s.get("ev_limit", 80))
	if matches > limit:
		var more := _btn("Show 80 more · %d remaining" % (matches - limit))
		more.pressed.connect(func() -> void:
			_s["ev_limit"] = limit + 80
			await _ev_after_change({}))
		_list_holder.add_child(more)


func _badge(text: String, tone: Color) -> PanelContainer:
	return _pill_label(text.to_upper(), tone, Color(1, 1, 1, 0.05), tone, 8)


func _ev_card(row_value: Variant) -> Control:
	var row: Dictionary = row_value
	var index := int(row.get("index", -1))
	var editing := int(_s.get("ev_editing", -1)) == index
	var card: Array = _box(Color(0, 0, 0, 0.22), Color(1, 1, 1, 0.23) if editing else Color(1, 1, 1, 0.1), 9, Vector4(9, 9, 9, 9), 6)
	var column: VBoxContainer = card[1]
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 6)
	var titles := VBoxContainer.new()
	titles.add_theme_constant_override("separation", 1)
	titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var date := str(row.get("date", ""))
	titles.add_child(UI.label(date if not date.is_empty() else "Undated", 10, Color(1, 1, 1, 0.46), 700))
	var title := str(row.get("title", ""))
	titles.add_child(_note(title if not title.is_empty() else "(untitled)", 12, UI.WHITE, 780))
	head.add_child(titles)
	var edit := _btn("Close" if editing else "Edit", "plain", 11)
	edit.custom_minimum_size.y = 26
	_enable(edit, not _busy)
	edit.pressed.connect(func() -> void:
		if editing:
			_s["ev_editing"] = -1
		else:
			_s["ev_creating"] = false
			_s["ev_editing"] = index
			_s["ev_form"] = {"title": title, "date": date, "description": str(row.get("description", "")), "quoteText": str(row.get("quoteText", "")), "quoteSpeaker": str(row.get("quoteSpeaker", "")), "quoteRole": str(row.get("quoteRole", "")), "importance": str(row.get("importance", "")) if not str(row.get("importance", "")).is_empty() else "minor", "kind": str(row.get("kind", "")) if not str(row.get("kind", "")).is_empty() else "world", "notable": bool(row.get("notable", false)), "playerRelated": bool(row.get("playerRelated", false)), "allowNpcReactions": bool(row.get("npcEnabled", false))}
		_render())
	head.add_child(edit)
	var delete := _btn("🗑", "danger", 11)
	delete.custom_minimum_size = Vector2(32, 26)
	delete.tooltip_text = "Delete event from canonical history"
	_enable(delete, not _busy)
	delete.pressed.connect(func() -> void:
		_s["ev_confirm"] = index
		_render())
	head.add_child(delete)
	column.add_child(head)
	var impact_count := int(row.get("impactCount", 0))
	if int(_s.get("ev_confirm", -1)) == index:
		var question := "Delete “%s” from canonical history?" % (title if not title.is_empty() else "this event")
		if impact_count > 0:
			question += "\n\nThis event has %d structured state impact(s). Deleting the timeline record will NOT undo state changes that were already applied." % impact_count
		var confirm: Array = _box(Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.08), Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.3), 8, Vector4(9, 8, 9, 8), 6)
		(confirm[1] as VBoxContainer).add_child(_note(question, 11, Color(1, 1, 1, 0.85)))
		var buttons := HBoxContainer.new()
		buttons.add_theme_constant_override("separation", 6)
		var yes := _wide(_btn("Confirm", "danger", 12)) as Button
		_enable(yes, not _busy)
		yes.pressed.connect(func() -> void:
			_s["ev_confirm"] = -1
			var reply := await _run("cheats.events.delete", {"index": index})
			if reply.get("ok", false) and int(_s.get("ev_editing", -1)) == index:
				_s["ev_editing"] = -1
			await _ev_after_change(reply))
		buttons.add_child(yes)
		var no := _wide(_btn("Cancel", "plain", 12)) as Button
		no.pressed.connect(func() -> void:
			_s["ev_confirm"] = -1
			_render())
		buttons.add_child(no)
		(confirm[1] as VBoxContainer).add_child(buttons)
		column.add_child(confirm[0])
	var badges := HFlowContainer.new()
	badges.add_theme_constant_override("h_separation", 4)
	badges.add_theme_constant_override("v_separation", 4)
	if bool(row.get("major", false)):
		badges.add_child(_badge("Major", Color(251 / 255.0, 191 / 255.0, 36 / 255.0, 0.85)))
	if bool(row.get("notable", false)):
		badges.add_child(_badge("Notable", Color("#e4e4e7")))
	if bool(row.get("playerRelated", false)):
		badges.add_child(_badge("Player", Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.85)))
	if bool(row.get("manual", false)):
		badges.add_child(_badge("Manual", Color(52 / 255.0, 211 / 255.0, 153 / 255.0, 0.85)))
	if not str(row.get("quoteText", "")).is_empty():
		badges.add_child(_badge("Quote", Color(148 / 255.0, 163 / 255.0, 184 / 255.0, 0.82)))
	var pending := bool(row.get("pending", false))
	var seconds := int(row.get("pendingSeconds", 0))
	var result := str(row.get("reactionResult", ""))
	if pending:
		badges.add_child(_badge("NPC reaction pending · %ds" % seconds, Color(52 / 255.0, 211 / 255.0, 153 / 255.0, 0.9)))
	elif result == "sent":
		badges.add_child(_badge("NPC chat sent", Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.85)))
	if impact_count > 0:
		var linked := _badge("State-linked · %d" % impact_count, Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.82))
		linked.tooltip_text = str(row.get("impactText", ""))
		linked.mouse_filter = Control.MOUSE_FILTER_PASS
		badges.add_child(linked)
	var kind := str(row.get("kind", ""))
	badges.add_child(_badge(kind if not kind.is_empty() else "world", Color(1, 1, 1, 0.55)))
	column.add_child(badges)
	var description := str(row.get("description", ""))
	if not editing and not description.is_empty():
		column.add_child(_note(description.substr(0, 257) + "…" if description.length() > 260 else description, 11, Color(1, 1, 1, 0.49)))
	if pending and not editing:
		var attempts := int(row.get("pendingAttempts", 0))
		var box: Array = _box(Color(16 / 255.0, 185 / 255.0, 129 / 255.0, 0.055), Color(52 / 255.0, 211 / 255.0, 153 / 255.0, 0.18), 8, Vector4(8, 6, 8, 6))
		var line := HBoxContainer.new()
		line.add_theme_constant_override("separation", 8)
		var text_column := VBoxContainer.new()
		text_column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		if attempts > 0:
			text_column.add_child(_note("The reaction request failed once. Trying again in %ds." % seconds if attempts == 1 else "The reaction request failed %d times. Trying again in %ds." % [attempts, seconds], 10, Color(167 / 255.0, 243 / 255.0, 208 / 255.0, 0.72)))
			var error := str(row.get("pendingError", ""))
			if not error.is_empty():
				text_column.add_child(_note("Last error: %s" % error, 10, Color(254 / 255.0, 202 / 255.0, 202 / 255.0, 0.72)))
		else:
			text_column.add_child(_note("NPCs may react after the grace window. Editing this event before delivery changes what they evaluate. Delivery check in %ds." % seconds, 10, Color(167 / 255.0, 243 / 255.0, 208 / 255.0, 0.72)))
		line.add_child(text_column)
		var cancel := _btn("Cancel delivery", "plain", 10)
		_enable(cancel, not _busy)
		cancel.pressed.connect(func() -> void:
			var reply := await _run("cheats.events.cancel_reaction", {"index": index})
			await _ev_after_change(reply))
		line.add_child(cancel)
		(box[1] as VBoxContainer).add_child(line)
		column.add_child(box[0])
	if not pending and not editing and result == "failed":
		var failed_attempts := int(row.get("failedAttempts", 0))
		var box: Array = _box(Color(127 / 255.0, 29 / 255.0, 29 / 255.0, 0.13), Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.2), 8, Vector4(8, 6, 8, 6))
		var line := HBoxContainer.new()
		line.add_theme_constant_override("separation", 8)
		var text_column := VBoxContainer.new()
		text_column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		text_column.add_child(_note("The reaction request failed %d times, so it was given up. No chat message was sent." % failed_attempts if failed_attempts > 1 else "The reaction request failed, so it was given up. No chat message was sent.", 10, Color(254 / 255.0, 202 / 255.0, 202 / 255.0, 0.78)))
		var failed_error := str(row.get("failedError", ""))
		if not failed_error.is_empty():
			text_column.add_child(_note("Last error: %s" % failed_error, 10, Color(254 / 255.0, 202 / 255.0, 202 / 255.0, 0.78)))
		line.add_child(text_column)
		var retry := _btn("Retry", "plain", 10)
		_enable(retry, not _busy)
		retry.pressed.connect(func() -> void:
			var reply := await _run("cheats.events.retry_reaction", {"index": index})
			await _ev_after_change(reply))
		line.add_child(retry)
		(box[1] as VBoxContainer).add_child(line)
		column.add_child(box[0])
	if not pending and not editing and result == "silent":
		var box: Array = _box(Color(148 / 255.0, 163 / 255.0, 184 / 255.0, 0.055), Color(148 / 255.0, 163 / 255.0, 184 / 255.0, 0.16), 8, Vector4(8, 6, 8, 6))
		(box[1] as VBoxContainer).add_child(_note("NPC reaction check complete. No chat message sent.", 10, Color(212 / 255.0, 212 / 255.0, 216 / 255.0, 0.72)))
		column.add_child(box[0])
	if not pending and not editing and result == "sent":
		var box: Array = _box(Color(59 / 255.0, 130 / 255.0, 246 / 255.0, 0.055), Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.18), 8, Vector4(8, 6, 8, 6))
		(box[1] as VBoxContainer).add_child(_note("NPC reaction check complete. 1 chat message sent.", 10, Color(191 / 255.0, 219 / 255.0, 254 / 255.0, 0.78)))
		column.add_child(box[0])
	var quote_text := str(row.get("quoteText", ""))
	if not editing and not quote_text.is_empty():
		var quote := HBoxContainer.new()
		quote.add_theme_constant_override("separation", 9)
		var bar := ColorRect.new()
		bar.color = Color(148 / 255.0, 163 / 255.0, 184 / 255.0, 0.38)
		bar.custom_minimum_size.x = 2
		quote.add_child(bar)
		var quote_column := VBoxContainer.new()
		quote_column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		quote_column.add_child(_rich("[i]“%s”[/i]" % _esc(quote_text), 10, Color(247 / 255.0, 247 / 255.0, 249 / 255.0, 0.78)))
		var speaker := str(row.get("quoteSpeaker", ""))
		var role := str(row.get("quoteRole", ""))
		if not speaker.is_empty() or not role.is_empty():
			quote_column.add_child(_note("— %s%s" % [speaker if not speaker.is_empty() else "Unknown speaker", ", %s" % role if not role.is_empty() else ""], 9, Color(206 / 255.0, 206 / 255.0, 210 / 255.0, 0.46)))
		quote.add_child(quote_column)
		column.add_child(quote)
	if editing:
		var rule := ColorRect.new()
		rule.color = Color(1, 1, 1, 0.08)
		rule.custom_minimum_size.y = 1
		column.add_child(rule)
		_ev_form_editor("ev_form", column, false)
		if pending:
			column.add_child(_note("Reaction evaluation is pending. Saving text/date changes does not reset the timer; the worker will re-read this exact event before delivery.", 10, Color(167 / 255.0, 243 / 255.0, 208 / 255.0, 0.72)))
		if impact_count > 0:
			var applied: Array = _box(Color(127 / 255.0, 29 / 255.0, 29 / 255.0, 0.13), Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.2), 8, Vector4(8, 7, 8, 7))
			(applied[1] as VBoxContainer).add_child(_rich("[b]Structured state already applied:[/b] %s. Saving this editor changes the canonical event record only; those effects are preserved exactly as they are." % _esc(str(row.get("impactText", ""))), 10, Color(254 / 255.0, 202 / 255.0, 202 / 255.0, 0.78)))
			column.add_child(applied[0])
		column.add_child(UI.label("source %s" % str(row.get("source", "scenario")), 9, Color(1, 1, 1, 0.28)))
		var buttons := HBoxContainer.new()
		buttons.add_theme_constant_override("separation", 7)
		var save := _wide(_btn("Save canonical edit", "primary")) as Button
		_enable(save, not _busy)
		save.pressed.connect(func() -> void:
			var reply := await _run("cheats.events.edit", {"index": index, "form": _sd("ev_form")})
			if reply.get("ok", false):
				_s["ev_editing"] = -1
				_s["ev_form"] = {}
			await _ev_after_change(reply))
		buttons.add_child(save)
		var cancel := _btn("Cancel")
		_enable(cancel, not _busy)
		cancel.pressed.connect(func() -> void:
			_s["ev_editing"] = -1
			_s["ev_form"] = {}
			_render())
		buttons.add_child(cancel)
		column.add_child(buttons)
	return card[0]


func _render_interactive() -> void:
	_meta_header()
	var data := _sd("ie")
	_body.add_child(_note("Pick an event and it becomes the moment to play out: the scene opens inside it, you make the moves, and how it ends is written into the record as one event. Only the scene costs requests — offering one costs nothing, and letting it pass costs nothing.", 11))
	var scene := bool(data.get("sceneInProgress", false))
	var warn_bg := Color(250 / 255.0, 204 / 255.0, 21 / 255.0, 0.08)
	var warn_border := Color(250 / 255.0, 204 / 255.0, 21 / 255.0, 0.32)
	if scene:
		_body.add_child(_gap(9))
		var warn: Array = _box(warn_bg, warn_border, 8, Vector4(9, 8, 9, 8), 6)
		(warn[1] as VBoxContainer).add_child(_note("A scene is already in progress. End it or set it aside before opening another.", 11, Color("#fde68a")))
		var open_scene := _btn("Open the scene")
		open_scene.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		open_scene.pressed.connect(_ie_open_scene)
		(warn[1] as VBoxContainer).add_child(open_scene)
		_body.add_child(warn[0])
	var offer: Variant = data.get("offer")
	if typeof(offer) == TYPE_DICTIONARY and not scene:
		_body.add_child(_gap(9))
		var warn: Array = _box(warn_bg, warn_border, 8, Vector4(9, 8, 9, 8), 6)
		(warn[1] as VBoxContainer).add_child(_note("%s is offered now." % str((offer as Dictionary).get("title", "")), 11, Color("#fde68a")))
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 6)
		var play := _wide(_btn("Play it out", "primary")) as Button
		play.pressed.connect(_ie_open_scene)
		row.add_child(play)
		var clear := _wide(_btn("Clear the offer")) as Button
		_enable(clear, not _busy)
		clear.pressed.connect(func() -> void:
			await _run("cheats.interactive.clear", {})
			await _ie_reload())
		row.add_child(clear)
		(warn[1] as VBoxContainer).add_child(row)
		_body.add_child(warn[0])
	_body.add_child(_gap(9))
	_body.add_child(_line(_sv("ie_search"), "Search the record…", func(text: String) -> void:
		_s["ie_search"] = text
		_ie_reload_list()))
	_body.add_child(_gap(9))
	_list_holder = VBoxContainer.new()
	_list_holder.add_theme_constant_override("separation", 6)
	_body.add_child(_list_holder)
	_ie_fill_list()
	_status_line(_body)


func _ie_open_scene() -> void:
	open_interactive.emit()
	close()


func _ie_reload() -> void:
	await _load_into("cheats.interactive.get", {"search": _sv("ie_search"), "limit": int(_s.get("ie_limit", 30))}, "ie")
	_render()


func _ie_reload_list() -> void:
	var reply: Dictionary = await engine.request("cheats.interactive.get", {"search": _sv("ie_search"), "limit": int(_s.get("ie_limit", 30))})
	if reply.get("ok", false):
		_s["ie"] = reply["result"]
	if is_instance_valid(_list_holder):
		_clear(_list_holder)
		_ie_fill_list()
		_fit()


func _ie_fill_list() -> void:
	var data := _sd("ie")
	if not _s.has("ie"):
		_list_holder.add_child(_note("Loading the record…", 11))
		return
	var rows: Array = data.get("rows", [])
	if rows.is_empty():
		_list_holder.add_child(_note("No event matches that." if not _sv("ie_search").strip_edges().is_empty() else "The record is empty: play a turn first.", 11))
	var scene := bool(data.get("sceneInProgress", false))
	for row_value in rows:
		var row: Dictionary = row_value
		var revealing := bool(row.get("revealing", false))
		var card: Array = _box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.08), 8, Vector4(9, 8, 9, 8), 5)
		var column: VBoxContainer = card[1]
		column.add_child(_note(str(row.get("title", "")), 12, UI.WHITE, 700))
		var line := HBoxContainer.new()
		line.add_theme_constant_override("separation", 5)
		var date := str(row.get("date", ""))
		if not date.is_empty():
			line.add_child(UI.label(date, 10, Color(1, 1, 1, 0.48)))
		var offerable := bool(row.get("offerable", false))
		line.add_child(_pill_label("A SKIP COULD OFFER THIS" if offerable else "A SKIP NEVER WOULD", Color(134 / 255.0, 239 / 255.0, 172 / 255.0, 0.5) if offerable else Color(1, 1, 1, 0.28), Color(1, 1, 1, 0.05), Color(134 / 255.0, 239 / 255.0, 172 / 255.0, 0.5) if offerable else Color(1, 1, 1, 0.28), 8))
		column.add_child(line)
		var play := _btn("Not revealed yet" if revealing else "Play this out", "primary")
		play.tooltip_text = "Finish revealing the last time skip first: a scene starts from what you have seen." if revealing else "Offer this moment and open the scene"
		_enable(play, not _busy and not revealing and not scene)
		var event_id := str(row.get("id", ""))
		var event_title := str(row.get("title", ""))
		play.pressed.connect(func() -> void:
			var reply := await _run("cheats.interactive.offer", {"eventId": event_id, "title": event_title})
			if reply.get("ok", false):
				_ie_open_scene()
			else:
				_render())
		column.add_child(play)
		_list_holder.add_child(card[0])
	var total := int(data.get("total", 0))
	var limit := int(_s.get("ie_limit", 30))
	if total > limit:
		var more := _btn("Show %d more of %d" % [mini(30, total - limit), total])
		more.pressed.connect(func() -> void:
			_s["ie_limit"] = limit + 30
			await _ie_reload())
		_list_holder.add_child(more)


func _render_history() -> void:
	_meta_header()
	_body.add_child(_note("Every event stays in the timeline in full. When enough have piled up, a pass folds the older ones into this document — the first pass writes it, every later one rewrites it with the new period added and unimportant older material condensed to stay near 1500 words — and the AI is shown the document in their place, plus the newest 24 events one by one.", 12, Color(1, 1, 1, 0.55)))
	_body.add_child(_gap(8))
	if not _s.has("hd"):
		_body.add_child(_note("Reading the campaign…", 12, Color(1, 1, 1, 0.5)))
		return
	var data := _sd("hd")
	var status: Dictionary = data.get("status", {})
	var document: Variant = data.get("document")
	var has_document := typeof(document) == TYPE_DICTIONARY
	var passes: Array = data.get("passes", [])
	var info: Array = _field_box(7)
	var info_column: VBoxContainer = info[1]
	info_column.add_child(_note("%d events in the timeline. %s" % [int(data.get("totalEvents", 0)), str(status.get("text", ""))], 12, Color(1, 1, 1, 0.72)))
	var buttons := HBoxContainer.new()
	buttons.add_theme_constant_override("separation", 5)
	var can_fold := bool(status.get("canFoldNow", false))
	var fold := _btn("Fold the older events now", "primary", 12)
	fold.tooltip_text = "Runs the AI consolidator on the older events now" if can_fold else "Only the retained tail is waiting; there is nothing older to fold"
	_enable(fold, not _busy and can_fold)
	fold.pressed.connect(func() -> void:
		await _run("cheats.history.fold", {})
		await _load_tool()
		_render())
	buttons.add_child(fold)
	if bool(_s.get("hd_confirm_reset", false)):
		var confirm := _btn("Confirm reset", "primary", 12)
		_enable(confirm, not _busy)
		confirm.pressed.connect(func() -> void:
			_s["hd_confirm_reset"] = false
			await _run("cheats.history.reset", {})
			await _load_tool()
			_render())
		buttons.add_child(confirm)
		var keep := _btn("Keep", "plain", 12)
		_enable(keep, not _busy)
		keep.pressed.connect(func() -> void:
			_s["hd_confirm_reset"] = false
			_render())
		buttons.add_child(keep)
	else:
		var reset := _btn("Reset compression", "plain", 12)
		reset.tooltip_text = "Deletes the document and the pass ledger; every event is shown to the AI in full again until the next pass"
		_enable(reset, not _busy and (has_document or not passes.is_empty()))
		reset.pressed.connect(func() -> void:
			_s["hd_confirm_reset"] = true
			_render())
		buttons.add_child(reset)
	info_column.add_child(buttons)
	_body.add_child(info[0])
	_body.add_child(_gap(9))
	var saved_text := str((document as Dictionary).get("text", "")) if has_document else ""
	var draft := _sv("hd_draft", saved_text)
	var heading := _section_label("")
	_body.add_child(heading)
	_body.add_child(_gap(4))
	var save := _btn("Save document", "primary", 12)
	var revert := _btn("Revert", "plain", 12)
	var update_heading := func() -> void:
		var current := _sv("hd_draft", saved_text)
		var dirty := current != saved_text
		var words := current.strip_edges().replace("\n", " ").replace("\t", " ").replace("\r", " ").split(" ", false).size()
		heading.text = ("THE DOCUMENT" + (" · %d WORDS%s" % [words, " · UNSAVED CHANGES" if dirty else ""] if has_document or not current.is_empty() else ""))
		_enable(save, not _busy and dirty)
		_enable(revert, not _busy and dirty)
	var area := _area(draft, "No history document yet. The first pass writes it — or type one here and save it.", 16, func(text: String) -> void:
		_s["hd_draft"] = text
		update_heading.call())
	_body.add_child(area)
	_body.add_child(_gap(6))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 5)
	save.pressed.connect(func() -> void:
		await _run("cheats.history.save", {"draft": _sv("hd_draft")})
		await _load_tool()
		_render())
	row.add_child(save)
	revert.pressed.connect(func() -> void:
		_s["hd_draft"] = saved_text
		_render())
	row.add_child(revert)
	_body.add_child(row)
	update_heading.call()
	if not passes.is_empty():
		_body.add_child(_gap(9))
		var holder := VBoxContainer.new()
		var inner := _details("%d pass%s so far — what each one folded" % [passes.size(), "" if passes.size() == 1 else "es"], "hd_passes", false, holder, 12, 400)
		for pass_value in passes:
			var entry: Dictionary = pass_value
			var card: Array = _box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.08), 8, Vector4(9, 8, 9, 8), 4)
			(card[1] as VBoxContainer).add_child(UI.label(str(entry.get("meta", "")), 11, Color(1, 1, 1, 0.45)))
			(card[1] as VBoxContainer).add_child(_note(str(entry.get("summary", "")), 12, Color(1, 1, 1, 0.78)))
			inner.add_child(card[0])
		_body.add_child(holder)
	_status_line(_body)


class CheatsDateField extends PanelContainer:
	signal date_changed(value: String)
	const MONTHS := ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
	var value := ""
	var _month: LineEdit
	var _day: LineEdit
	var _year: LineEdit
	var _popup: PopupPanel
	var _grid: GridContainer
	var _heading: Label
	var _shown_year := 2000
	var _shown_month := 1

	func _init(initial := "") -> void:
		custom_minimum_size.y = 32
		size_flags_horizontal = Control.SIZE_EXPAND_FILL
		add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0.28), Color(1, 1, 1, 0.16), 8, 1, Vector4(9, 0, 6, 0)))
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 0)
		add_child(row)
		_month = _segment("mm", 2, 22.0)
		_day = _segment("dd", 2, 22.0)
		_year = _segment("yyyy", 6, 46.0)
		row.add_child(_month)
		row.add_child(_slash())
		row.add_child(_day)
		row.add_child(_slash())
		row.add_child(_year)
		var spring := Control.new()
		spring.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		spring.mouse_filter = Control.MOUSE_FILTER_IGNORE
		row.add_child(spring)
		var open := Button.new()
		open.flat = true
		open.focus_mode = Control.FOCUS_NONE
		open.icon = UI.icon("calendar", 15, Color(1, 1, 1, 0.75))
		open.tooltip_text = "Show date picker"
		open.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		open.pressed.connect(_open_picker)
		row.add_child(open)
		_assign(initial)

	func _segment(hint: String, length: int, wide: float) -> LineEdit:
		var node := LineEdit.new()
		node.placeholder_text = hint
		node.max_length = length
		node.flat = true
		node.select_all_on_focus = true
		node.alignment = HORIZONTAL_ALIGNMENT_CENTER
		node.custom_minimum_size = Vector2(wide, 30)
		node.add_theme_constant_override("minimum_character_width", 0)
		for slot in ["normal", "focus", "read_only"]:
			node.add_theme_stylebox_override(slot, StyleBoxEmpty.new())
		node.add_theme_font_override("font", UI.font(400))
		node.add_theme_font_size_override("font_size", 13)
		node.add_theme_color_override("font_color", UI.WHITE)
		node.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.5))
		node.add_theme_color_override("selection_color", Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.45))
		node.text_changed.connect(_typed.bind(node))
		node.gui_input.connect(_segment_key.bind(node))
		return node

	func _slash() -> Label:
		var mark := UI.label("/", 13, Color(1, 1, 1, 0.5))
		mark.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		mark.mouse_filter = Control.MOUSE_FILTER_IGNORE
		return mark

	func _assign(text: String) -> void:
		var parts := text.strip_edges().split("-")
		if parts.size() == 3 and parts[0].is_valid_int() and parts[1].is_valid_int() and parts[2].is_valid_int() and int(parts[0]) >= 1:
			_year.text = "%04d" % int(parts[0])
			_month.text = "%02d" % int(parts[1])
			_day.text = "%02d" % int(parts[2])
		else:
			_year.text = ""
			_month.text = ""
			_day.text = ""
		value = _compose()

	func _digits(text: String) -> String:
		var kept := ""
		for character in text:
			if "0123456789".contains(character):
				kept += character
		return kept

	func _typed(text: String, node: LineEdit) -> void:
		var kept := _digits(text)
		if kept != text:
			node.text = kept
			node.caret_column = kept.length()
		var advance := false
		if node == _month:
			advance = kept.length() >= 2 or (kept.length() == 1 and int(kept) > 1)
			if advance and kept.length() == 1:
				node.text = "0" + kept
		elif node == _day:
			advance = kept.length() >= 2 or (kept.length() == 1 and int(kept) > 3)
			if advance and kept.length() == 1:
				node.text = "0" + kept
		if advance:
			var next := _day if node == _month else _year
			next.grab_focus()
			next.select_all()
		_emit()

	func _segment_key(event: InputEvent, node: LineEdit) -> void:
		var key := event as InputEventKey
		if key == null or not key.pressed:
			return
		if key.keycode == KEY_UP or key.keycode == KEY_DOWN:
			node.accept_event()
			var direction := 1 if key.keycode == KEY_UP else -1
			var current := int(node.text) if node.text.is_valid_int() else 0
			var low := 1
			var high := 12 if node == _month else (31 if node == _day else 275760)
			var next := current + direction if current > 0 else (low if direction > 0 else high)
			if node == _year and current <= 0:
				next = Time.get_date_dict_from_system()["year"]
			if next > high:
				next = low
			elif next < low:
				next = high
			node.text = ("%04d" % next) if node == _year else ("%02d" % next)
			node.caret_column = node.text.length()
			_emit()
		elif key.keycode == KEY_SLASH or key.keycode == KEY_RIGHT and node.caret_column >= node.text.length():
			if node != _year:
				node.accept_event()
				var next_node := _day if node == _month else _year
				next_node.grab_focus()
				next_node.select_all()

	func _compose() -> String:
		if not (_month.text.is_valid_int() and _day.text.is_valid_int() and _year.text.is_valid_int()):
			return ""
		var month := int(_month.text)
		var day := int(_day.text)
		var year := int(_year.text)
		if year < 1 or month < 1 or month > 12 or day < 1 or day > _days_in(year, month):
			return ""
		return "%04d-%02d-%02d" % [year, month, day]

	func _emit() -> void:
		var next := _compose()
		if next == value:
			return
		value = next
		date_changed.emit(value)

	static func _days_in(year: int, month: int) -> int:
		if month == 2:
			return 29 if (year % 4 == 0 and year % 100 != 0) or year % 400 == 0 else 28
		return 30 if month in [4, 6, 9, 11] else 31

	static func _weekday(year: int, month: int, day: int) -> int:
		var table := [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4]
		var y := year - 1 if month < 3 else year
		return posmod(y + floori(y / 4.0) - floori(y / 100.0) + floori(y / 400.0) + int(table[month - 1]) + day, 7)

	func _open_picker() -> void:
		if not _popup:
			_build_popup()
		var today := Time.get_date_dict_from_system()
		if value.is_empty():
			_shown_year = int(today["year"])
			_shown_month = int(today["month"])
		else:
			_shown_year = int(value.substr(0, value.length() - 6))
			_shown_month = int(value.substr(value.length() - 5, 2))
		_fill()
		var rect := get_global_rect()
		_popup.reset_size()
		var at := Vector2i(int(rect.position.x), int(rect.end.y + 2.0))
		var room := get_viewport_rect().size
		var wanted := _popup.get_contents_minimum_size()
		if at.y + wanted.y > room.y:
			at.y = int(rect.position.y - wanted.y - 2.0)
		at.x = clampi(at.x, 0, maxi(0, int(room.x - wanted.x)))
		_popup.popup(Rect2i(at, Vector2i(wanted)))

	func _build_popup() -> void:
		_popup = PopupPanel.new()
		_popup.add_theme_stylebox_override("panel", UI.box(Color(32 / 255.0, 33 / 255.0, 36 / 255.0, 0.99), Color(1, 1, 1, 0.16), 6, 1, Vector4(8, 8, 8, 8)))
		add_child(_popup)
		var column := VBoxContainer.new()
		column.add_theme_constant_override("separation", 6)
		_popup.add_child(column)
		var head := HBoxContainer.new()
		head.add_theme_constant_override("separation", 4)
		_heading = UI.label("", 13, UI.WHITE, 700)
		_heading.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		head.add_child(_heading)
		for entry in [["▲", -1, "Previous month"], ["▼", 1, "Next month"]]:
			var arrow := _plain(str(entry[0]), 11)
			arrow.tooltip_text = str(entry[2])
			arrow.pressed.connect(_turn.bind(int(entry[1])))
			head.add_child(arrow)
		column.add_child(head)
		_grid = GridContainer.new()
		_grid.columns = 7
		_grid.add_theme_constant_override("h_separation", 2)
		_grid.add_theme_constant_override("v_separation", 2)
		column.add_child(_grid)
		var foot := HBoxContainer.new()
		var clear := _plain("Clear", 12)
		clear.pressed.connect(func() -> void:
			_assign("")
			date_changed.emit(value)
			_popup.hide())
		foot.add_child(clear)
		var spring := Control.new()
		spring.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		foot.add_child(spring)
		var today := _plain("Today", 12)
		today.pressed.connect(func() -> void:
			var now := Time.get_date_dict_from_system()
			_pick(int(now["year"]), int(now["month"]), int(now["day"])))
		foot.add_child(today)
		column.add_child(foot)

	func _plain(text: String, size: int) -> Button:
		var node := Button.new()
		node.text = text
		node.flat = true
		node.focus_mode = Control.FOCUS_NONE
		node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		node.add_theme_font_size_override("font_size", size)
		node.add_theme_color_override("font_color", Color(138 / 255.0, 180 / 255.0, 248 / 255.0))
		node.add_theme_color_override("font_hover_color", UI.WHITE)
		return node

	func _turn(direction: int) -> void:
		_shown_month += direction
		if _shown_month > 12:
			_shown_month = 1
			_shown_year += 1
		elif _shown_month < 1:
			_shown_month = 12
			_shown_year -= 1
		_fill()

	func _fill() -> void:
		_heading.text = "%s %d" % [MONTHS[_shown_month - 1], _shown_year]
		for child in _grid.get_children():
			_grid.remove_child(child)
			child.queue_free()
		for name in ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]:
			var head := UI.label(name, 11, Color(1, 1, 1, 0.6), 600)
			head.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			head.custom_minimum_size = Vector2(30, 20)
			_grid.add_child(head)
		var lead := _weekday(_shown_year, _shown_month, 1)
		for index in range(lead):
			var blank := Control.new()
			blank.custom_minimum_size = Vector2(30, 26)
			_grid.add_child(blank)
		var chosen := "%04d-%02d-" % [_shown_year, _shown_month]
		var now := Time.get_date_dict_from_system()
		for day in range(1, _days_in(_shown_year, _shown_month) + 1):
			var cell := Button.new()
			cell.text = str(day)
			cell.focus_mode = Control.FOCUS_NONE
			cell.custom_minimum_size = Vector2(30, 26)
			cell.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
			cell.add_theme_font_size_override("font_size", 12)
			var picked := value == chosen + ("%02d" % day)
			var is_today := int(now["year"]) == _shown_year and int(now["month"]) == _shown_month and int(now["day"]) == day
			var rest := UI.box(Color(138 / 255.0, 180 / 255.0, 248 / 255.0, 1.0) if picked else Color(0, 0, 0, 0), Color(138 / 255.0, 180 / 255.0, 248 / 255.0, 0.9) if is_today and not picked else Color(0, 0, 0, 0), 4, 1 if is_today else 0)
			var lit := UI.box(Color(138 / 255.0, 180 / 255.0, 248 / 255.0, 1.0) if picked else Color(1, 1, 1, 0.1), Color(0, 0, 0, 0), 4, 0)
			for slot in ["normal", "focus", "disabled"]:
				cell.add_theme_stylebox_override(slot, rest)
			for slot in ["hover", "pressed", "hover_pressed"]:
				cell.add_theme_stylebox_override(slot, lit)
			var ink := Color(32 / 255.0, 33 / 255.0, 36 / 255.0) if picked else Color(1, 1, 1, 0.9)
			for slot in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color"]:
				cell.add_theme_color_override(slot, ink)
			cell.pressed.connect(_pick.bind(_shown_year, _shown_month, day))
			_grid.add_child(cell)

	func _pick(year: int, month: int, day: int) -> void:
		_assign("%04d-%02d-%02d" % [year, month, day])
		date_changed.emit(value)
		if _popup:
			_popup.hide()


class CheatsStickyBottom extends Control:
	var button: Control
	var scroller: ScrollContainer
	var limit: Control
	var inset := 7.2

	func _ready() -> void:
		size_flags_horizontal = Control.SIZE_EXPAND_FILL
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		if button and button.get_parent() == null:
			add_child(button)
		button.z_index = 4
		custom_minimum_size.y = button.get_combined_minimum_size().y
		_place()

	func _process(_delta: float) -> void:
		if is_visible_in_tree():
			_place()

	func _place() -> void:
		if not button or not scroller or not is_instance_valid(scroller):
			return
		custom_minimum_size.y = button.get_combined_minimum_size().y
		button.size = Vector2(size.x, custom_minimum_size.y)
		var natural := global_position.y
		var bottom := scroller.get_global_rect().end.y
		var offset := minf(0.0, bottom - inset - button.size.y - natural)
		if limit and is_instance_valid(limit):
			offset = maxf(offset, limit.get_global_rect().position.y - natural)
		button.position = Vector2(0, offset)
