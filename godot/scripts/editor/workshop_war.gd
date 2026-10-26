class_name WorkshopWar
extends WorkshopShell

const TABS := [["terrain", "Terrain"], ["fortification", "Fortified lines"], ["climate", "Climate"]]
const TAB_INTROS := {
	"terrain": "Ground troops cross more slowly: mountains, marshes, a river, a crevice. Level 0 is flat ground and 10 cannot be crossed at all.",
	"fortification": "Walls and lines of forts that troops have to break through. Level 3 is the weakest, and 10 can never be broken.",
	"climate": "Zones with their own seasons, weather and dated events. Each zone's colour blends into its neighbours' across its blend width.",
}
const DRAW_LABELS := {"terrain": "Draw terrain on the map", "fortification": "Draw a fortified line on the map", "climate": "Draw a climate zone on the map"}
const DRAWING_LABELS := {"terrain": "Drawing terrain (click to stop)", "fortification": "Drawing fortified lines (click to stop)", "climate": "Drawing climate zones (click to stop)"}
const EMPTY_LABELS := {"terrain": "No terrain drawn yet.", "fortification": "No fortified lines drawn yet.", "climate": "No climate zones drawn yet."}
const BACK_LABELS := {"terrain": "← All terrain", "fortification": "← All fortified lines", "climate": "← All climate zones"}
const LIST_KEYS := {"terrain": "terrainAreas", "fortification": "fortifications", "climate": "climateZones"}
const TERRAIN_LEVEL_LABELS := ["Flat", "Easy", "Uneven", "Rough", "Hard going", "Difficult", "Very difficult", "Severe", "Extreme", "Nearly impassable", "Impassable"]
const WALL_LEVEL_LABELS := {3: "Weak", 4: "Light", 5: "Solid", 6: "Strong", 7: "Very strong", 8: "Formidable", 9: "Nearly unbreakable", 10: "Unbreakable"}
const TERRAIN_LEVEL_MOST := 10
const WALL_LEVEL_LEAST := 3
const WALL_LEVEL_MOST := 10
const WEATHER_LABELS := {"clear": "Clear skies", "rain": "Rain", "storm": "Storm", "mud": "Mud", "snow": "Snow", "blizzard": "Blizzard", "frost": "Frost", "heat": "Heat", "fog": "Fog"}
const WEATHER_STATES := ["clear", "rain", "storm", "mud", "snow", "blizzard", "frost", "heat", "fog"]
const CLIMATE_LABELS := {"polar": "Polar", "continental": "Continental", "arid": "Arid", "tropical": "Tropical"}
const CLIMATE_PRESETS := ["polar", "continental", "arid", "tropical"]
const MONTHS := ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const DAYS_IN_MONTH := [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const ZONE_COLOR := "#7f8c99"
const NEW_SEASON := {"name": "Season", "start": "01-01", "end": "03-31", "weather": {"clear": 100}, "effects": {}}
const NEW_EVENT := {"name": "Event", "from": "", "to": "", "effects": {}}
const EFFECTS := [
	{"key": "pace", "label": "Pace", "min": 0.0, "max": 2.0, "step": 0.05, "usual": 1.0, "sign": "×", "hint": "How far troops get in a day. 1 is the usual."},
	{"key": "attack", "label": "Attack", "min": 0.0, "max": 2.0, "step": 0.05, "usual": 1.0, "sign": "×", "hint": "How hard an attack hits. 1 is the usual."},
	{"key": "wear", "label": "Wear", "min": 0.0, "max": 0.2, "step": 0.005, "usual": 0.0, "sign": "+", "hint": "Fatigue a day adds to every troop."},
	{"key": "cold", "label": "Cold", "min": 0.0, "max": 2.0, "step": 0.05, "usual": 0.0, "sign": "", "hint": "Strength troops short of supply lose to the cold."},
	{"key": "heat", "label": "Heat", "min": 0.0, "max": 2.0, "step": 0.05, "usual": 0.0, "sign": "", "hint": "Strength troops short of supply lose to the heat."},
	{"key": "air", "label": "Air", "min": 0.0, "max": 1.0, "step": 0.05, "usual": 1.0, "sign": "×", "hint": "How often aircraft fly. 1 always, 0 never."},
]
const RED := Color("#f87171")
const HINT := Color(1, 1, 1, 0.55)

var host: Workshop
var _open_season := -1
var _open_event := -1
var _pending := false
var _zone_shown := ""


func _init() -> void:
	super._init("War map", "mountain", 420.0, "left")


func setup(workshop: Workshop) -> void:
	host = workshop
	host.changed.connect(_on_changed)
	_render()


func _on_changed(parts: Dictionary) -> void:
	if not (parts.has("war") or parts.has("doc")):
		return
	if typing_inside():
		_pending = true
		return
	_render()


func _process(_delta: float) -> void:
	if _pending and not typing_inside():
		_pending = false
		_render()


func _rows(kind: String) -> Array:
	var war: Dictionary = host.state.get("war", {})
	var rows: Variant = war.get(str(LIST_KEYS.get(kind, "")), [])
	return rows if rows is Array else []


func _hint(text: String, color := HINT) -> Label:
	return WorkshopUI.wrap(text, 11.5, color)


func _settle_focus() -> void:
	if typing_inside():
		get_viewport().gui_release_focus()


func _patch(kind: String, id: String, fields: Dictionary, typing: bool) -> void:
	if not typing:
		_settle_focus()
	await host.request("workshop.war.patch", {"kind": kind, "rowId": id, "fields": fields})


func _item(zone_id: String, list_name: String, index: int, args: Dictionary, typing: bool) -> void:
	if not typing:
		_settle_focus()
	var payload := args.duplicate()
	payload["rowId"] = zone_id
	payload["list"] = list_name
	payload["index"] = index
	await host.request("workshop.war.patchItem", payload)


func _remove(kind: String, id: String) -> void:
	_settle_focus()
	if str(host.war_selection.get("kind", "")) == kind and str(host.war_selection.get("id", "")) == id:
		host.war_selection = {}
		host._update_war_visibility()
	await host.request("workshop.war.remove", {"kind": kind, "rowId": id})


func _render() -> void:
	clear_body()
	var tab := host.war_tab
	var tabs := HFlowContainer.new()
	tabs.add_theme_constant_override("h_separation", 6)
	tabs.add_theme_constant_override("v_separation", 6)
	for entry in TABS:
		var id := str(entry[0])
		var button := WorkshopUI.base_button(str(entry[1]))
		var style := UI.box(Color(0, 0, 0, 0.49) if tab == id else Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.28) if tab == id else Color(1, 1, 1, 0.1), 999, 1, Vector4(12, 5, 12, 5))
		WorkshopUI._flat_styles(button, style, style, style, style)
		WorkshopUI._ink(button, Color(1, 1, 1), 12.0, 700)
		button.pressed.connect(func() -> void:
			host.war_tab = id
			_open_season = -1
			_open_event = -1
			if host.tool in ["terrain", "fortification", "climate"]:
				host.set_tool(id)
			host._update_war_visibility()
			_render())
		tabs.add_child(button)
	body.add_child(tabs)
	var rows := _rows(tab)
	var picked := {}
	if not host.war_selection.is_empty():
		var wanted := str(host.war_selection.get("id", ""))
		var known := false
		for row in _rows(str(host.war_selection.get("kind", ""))):
			if row is Dictionary and str((row as Dictionary).get("id", "")) == wanted:
				known = true
				if str(host.war_selection.get("kind", "")) == tab:
					picked = row
		if not known:
			host.war_selection = {}
			host._update_war_visibility()
	if not picked.is_empty():
		_render_picked(tab, picked)
	else:
		_render_list(tab, rows)
	fit()


func _render_picked(tab: String, picked: Dictionary) -> void:
	var id := str(picked.get("id", ""))
	var back := WorkshopUI.pill(str(BACK_LABELS[tab]))
	back.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	back.pressed.connect(func() -> void: host.pick_war_shape(tab, ""))
	body.add_child(back)
	if tab == "terrain":
		_terrain_editor(picked)
	elif tab == "fortification":
		_wall_editor(picked)
	else:
		if id != _zone_shown:
			_zone_shown = id
			_open_season = -1
			_open_event = -1
		_climate_editor(picked)
	var actions := HFlowContainer.new()
	actions.add_theme_constant_override("h_separation", 6)
	actions.add_theme_constant_override("v_separation", 6)
	var zoom := WorkshopUI.pill("Zoom to it")
	zoom.icon = WorkshopUI.icon("fit", 13)
	zoom.pressed.connect(func() -> void: _zoom(tab, id))
	actions.add_child(zoom)
	var delete := WorkshopUI.pill("Delete", false, RED)
	delete.icon = WorkshopUI.icon("trash", 13, RED)
	delete.pressed.connect(func() -> void: _remove(tab, id))
	actions.add_child(delete)
	var gap := MarginContainer.new()
	gap.add_theme_constant_override("margin_top", 4)
	gap.add_child(actions)
	body.add_child(gap)


func _render_list(tab: String, rows: Array) -> void:
	body.add_child(_hint(str(TAB_INTROS[tab])))
	var drawing := host.tool == tab
	var draw := WorkshopUI.pill(str(DRAWING_LABELS[tab]) if drawing else str(DRAW_LABELS[tab]), drawing)
	draw.icon = WorkshopUI.icon("mountain" if tab == "terrain" else ("wall" if tab == "fortification" else "climate"), 14)
	draw.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	draw.pressed.connect(func() -> void:
		host.set_tool("select" if drawing else tab)
		_render())
	body.add_child(draw)
	var list := VBoxContainer.new()
	list.add_theme_constant_override("separation", 4)
	if rows.is_empty():
		var empty := MarginContainer.new()
		empty.add_theme_constant_override("margin_left", 2)
		empty.add_theme_constant_override("margin_top", 4)
		empty.add_theme_constant_override("margin_bottom", 4)
		empty.add_child(_hint(str(EMPTY_LABELS[tab])))
		list.add_child(empty)
	for row in rows:
		if row is Dictionary:
			list.add_child(_list_row(tab, row))
	body.add_child(list)
	if tab == "climate" or tab == "terrain":
		_world_start(tab, rows.size())
	if tab == "climate":
		var doc: Dictionary = host.state.get("doc", {})
		var count := int(doc.get("freezingCount", 0))
		body.add_child(WorkshopUI.wrap("No water region can freeze yet." if count == 0 else ("1 water region can freeze." if count == 1 else "%d water regions can freeze." % count), 12, Color(1, 1, 1, 0.75)))
		body.add_child(_hint("Mark lakes and seas in the region panel (Can freeze). They freeze in a season whose effects say Water freezes."))


func _list_row(tab: String, entry: Dictionary) -> PanelContainer:
	var id := str(entry.get("id", ""))
	var frame := PanelContainer.new()
	frame.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0), Color(1, 1, 1, 0.09), 8, 1, Vector4(8, 6, 8, 6)))
	frame.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 6)
	frame.add_child(line)
	var pick := PanelContainer.new()
	pick.add_theme_stylebox_override("panel", StyleBoxEmpty.new())
	pick.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var inner := HBoxContainer.new()
	inner.add_theme_constant_override("separation", 8)
	pick.add_child(inner)
	if tab == "climate":
		var color_text := str(entry.get("color", ""))
		inner.add_child(WorkshopUI.swatch(_color(color_text if not color_text.is_empty() else ZONE_COLOR), 14.0, 3))
	var texts := VBoxContainer.new()
	texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	texts.add_theme_constant_override("separation", 1)
	var name := str(entry.get("name", ""))
	texts.add_child(WorkshopUI.wrap(name if not name.is_empty() else "Unnamed", 13, Color(1, 1, 1), 600))
	texts.add_child(WorkshopUI.wrap(_summary(tab, entry), 10.5, Color(1, 1, 1, 0.5)))
	inner.add_child(texts)
	WorkshopUI.ignore_mouse(pick)
	WorkshopUI.clickable(pick, func(_event: InputEventMouseButton) -> void:
		host.pick_war_shape(tab, id)
		host.set_tool(tab)
		_zoom(tab, id))
	line.add_child(pick)
	var zoom := WorkshopUI.bare_icon("fit", "Zoom to it")
	zoom.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	zoom.pressed.connect(func() -> void: _zoom(tab, id))
	line.add_child(zoom)
	var trash := WorkshopUI.bare_icon("trash", "Delete", RED)
	trash.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	trash.pressed.connect(func() -> void: _remove(tab, id))
	line.add_child(trash)
	return frame


func _world_start(tab: String, count: int) -> void:
	var climate := tab == "climate"
	var parts := WorkshopUI.card(9, Color(0, 0, 0, 0), Color(1, 1, 1, 0.1), Vector4(10, 9, 10, 9), 6)
	var inner: VBoxContainer = parts[1]
	inner.add_child(_hint("With no zones of its own, a scenario on the built-in basemaps has the real world's: Siberia's long winter, the monsoon, the Sahara's heat. Painting a zone of its own replaces them all." if climate else "With no hard ground of its own, a scenario on the built-in basemaps has the real world's: the great mountain ranges, the marshes, the jungles and the sand seas. The game's map never shows it: it slows troops. Painting an area of its own replaces it all."))
	var start := WorkshopUI.pill("Start from the real world's climates" if climate else "Start from the real world's hard ground")
	start.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	start.pressed.connect(func() -> void: _start_from_world(tab, count))
	inner.add_child(start)
	body.add_child(parts[0])


func _start_from_world(tab: String, count: int) -> void:
	var climate := tab == "climate"
	if count > 0 and not await host.confirm("Replace this scenario's climate zones with the real world's?" if climate else "Replace this scenario's terrain with the real world's?"):
		return
	await host.request("workshop.war.worldStart", {"kind": tab})


func _color(text: String) -> Color:
	return Color(text) if Color.html_is_valid(text) else Color(ZONE_COLOR)


func _summary(kind: String, row: Dictionary) -> String:
	if kind == "climate":
		var count := (row.get("seasons") as Array).size() if row.get("seasons") is Array else 0
		return "1 season" if count == 1 else "%d seasons" % count
	var level := int(row.get("level", 0))
	var words: PackedStringArray = ["Level %d" % level]
	var word := ""
	if kind == "terrain":
		word = str(TERRAIN_LEVEL_LABELS[level]) if level >= 0 and level < TERRAIN_LEVEL_LABELS.size() else ""
	else:
		word = str(WALL_LEVEL_LABELS.get(level, ""))
	if not word.is_empty():
		words.append(word)
	if kind == "fortification" and not str(row.get("owner", "")).is_empty():
		words.append(host.polity_name(str(row.get("owner", ""))))
	return "  ".join(words)


func _collect(value: Variant, out: Array) -> void:
	if not (value is Array):
		return
	var list: Array = value
	if list.size() >= 2 and (list[0] is float or list[0] is int):
		out.append(Vector2(float(list[0]), float(list[1])))
		return
	for item in list:
		_collect(item, out)


func _zoom(kind: String, id: String) -> void:
	var row := {}
	for entry in _rows(kind):
		if entry is Dictionary and str((entry as Dictionary).get("id", "")) == id:
			row = entry
	var points: Array = []
	_collect(row.get("points") if kind == "fortification" else row.get("rings"), points)
	if points.is_empty():
		return
	var west := INF
	var south := INF
	var east := -INF
	var north := -INF
	for point in points:
		var p: Vector2 = point
		west = minf(west, p.x)
		east = maxf(east, p.x)
		south = minf(south, p.y)
		north = maxf(north, p.y)
	host.map.fit_bounds([[west, south], [east, north]], 8.0)


func _small_input(value: String, most: int, on_change: Callable, placeholder: String) -> LineEdit:
	var edit := WorkshopUI.input(value, placeholder, on_change, 13.6, 30.0)
	edit.max_length = most
	edit.add_theme_stylebox_override("normal", UI.box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.1), 10, 1, Vector4(7, 5, 7, 5)))
	edit.add_theme_stylebox_override("focus", UI.box(Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.26), 10, 1, Vector4(7, 5, 7, 5)))
	return edit


func _name_field(box: VBoxContainer, value: String, most: int, on_change: Callable) -> void:
	box.add_child(WorkshopUI.label_dim("Name"))
	box.add_child(_small_input(value, most, on_change, ""))


func _caption(text: String) -> Label:
	var caption := UI.label(text, 12, Color(1, 1, 1, 0.72))
	caption.custom_minimum_size.x = 74
	caption.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	return caption


func _slider(value: float, low: float, high: float, step: float) -> HSlider:
	var slider := HSlider.new()
	slider.min_value = low
	slider.max_value = high
	slider.step = step
	slider.value = value
	slider.scrollable = false
	slider.focus_mode = Control.FOCUS_NONE
	slider.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	slider.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	return slider


func _slider_row(value: float, low: float, high: float, step: float, format: Callable, on_change: Callable, label_text: String, value_width: float) -> HBoxContainer:
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 8)
	if not label_text.is_empty():
		line.add_child(_caption(label_text))
	var slider := _slider(value, low, high, step)
	line.add_child(slider)
	var shown := UI.label(str(format.call(value)), 12, Color(1, 1, 1, 0.85))
	shown.custom_minimum_size.x = value_width
	shown.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	shown.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	line.add_child(shown)
	slider.value_changed.connect(func(next: float) -> void: shown.text = str(format.call(next)))
	slider.drag_ended.connect(func(moved: bool) -> void:
		if moved:
			on_change.call(slider.value))
	return line


func _level_word(text: String) -> Label:
	return UI.label(text, 13, Color(1, 1, 1), 600)


func _terrain_editor(area: Dictionary) -> void:
	var id := str(area.get("id", ""))
	_name_field(body, str(area.get("name", "")), 80, func(text: String) -> void: _patch("terrain", id, {"name": text}, true))
	body.add_child(WorkshopUI.label_dim("Level"))
	var level := int(area.get("level", 0))
	var word := _level_word(str(TERRAIN_LEVEL_LABELS[clampi(level, 0, TERRAIN_LEVEL_MOST)]))
	var format := func(value: float) -> String:
		word.text = str(TERRAIN_LEVEL_LABELS[clampi(int(value), 0, TERRAIN_LEVEL_MOST)])
		return str(int(value))
	body.add_child(_slider_row(float(level), 0.0, float(TERRAIN_LEVEL_MOST), 1.0, format, func(value: float) -> void: _patch("terrain", id, {"level": int(value)}, false), "", 28.0))
	body.add_child(word)
	body.add_child(_hint("The higher the level, the slower troops cross it. At 10 nobody can cross."))


func _wall_editor(wall: Dictionary) -> void:
	var id := str(wall.get("id", ""))
	_name_field(body, str(wall.get("name", "")), 80, func(text: String) -> void: _patch("fortification", id, {"name": text}, true))
	body.add_child(WorkshopUI.label_dim("Level"))
	var level := int(wall.get("level", WALL_LEVEL_LEAST))
	var word := _level_word(str(WALL_LEVEL_LABELS.get(level, "")))
	var format := func(value: float) -> String:
		word.text = str(WALL_LEVEL_LABELS.get(int(value), ""))
		return str(int(value))
	body.add_child(_slider_row(float(level), float(WALL_LEVEL_LEAST), float(WALL_LEVEL_MOST), 1.0, format, func(value: float) -> void: _patch("fortification", id, {"level": int(value)}, false), "", 28.0))
	body.add_child(word)
	body.add_child(_hint("The higher the level, the longer troops take to break through. At 10 it never breaks."))
	body.add_child(WorkshopUI.label_dim("Held by"))
	body.add_child(_owner_select(str(wall.get("owner", "")), func(value: String) -> void: _patch("fortification", id, {"owner": value}, false)))
	body.add_child(_hint("The country or group that built it or holds it."))


func _owner_select(owner: String, on_change: Callable) -> OptionButton:
	var owners := host.polity_choices()
	var doc: Dictionary = host.state.get("doc", {})
	var groups: Dictionary = doc.get("groups") if doc.get("groups") is Dictionary else {}
	var group_names: Array = []
	for name in groups:
		group_names.append(str(name))
	group_names.sort_custom(func(a: Variant, b: Variant) -> bool: return str(a).naturalnocasecmp_to(str(b)) < 0)
	var known := group_names.has(owner)
	for row in owners:
		if str((row as Dictionary)["key"]) == owner:
			known = true
	var first: Array = [["", "No one"]]
	if not owner.is_empty() and not known:
		first.append([owner, owner])
	var node := WorkshopUI.select(first, owner, Callable(), 13.6, 30.0)
	if not owners.is_empty():
		node.add_separator("Countries")
		for row in owners:
			node.add_item(str((row as Dictionary)["name"]))
			node.set_item_metadata(node.item_count - 1, str((row as Dictionary)["key"]))
	if not group_names.is_empty():
		node.add_separator("Groups")
		for name in group_names:
			node.add_item(str(name))
			node.set_item_metadata(node.item_count - 1, str(name))
	for index in range(node.item_count):
		if not node.is_item_separator(index) and str(node.get_item_metadata(index)) == owner:
			node.select(index)
			break
	node.item_selected.connect(func(index: int) -> void: on_change.call(str(node.get_item_metadata(index))))
	return node


func _climate_editor(zone: Dictionary) -> void:
	var id := str(zone.get("id", ""))
	_name_field(body, str(zone.get("name", "")), 80, func(text: String) -> void: _patch("climate", id, {"name": text}, true))
	var zone_color := str(zone.get("color", "")) if not str(zone.get("color", "")).is_empty() else ZONE_COLOR
	var color := WorkshopUI.color_field(WorkshopUI.color_rgb(_color(zone_color)), func(rgb: Array) -> void: _patch("climate", id, {"color": WorkshopUI.hex(WorkshopUI.rgb_color(rgb))}, false))
	body.add_child(WorkshopUI.row("Colour", color, "The zone's colour on the map"))
	body.add_child(WorkshopUI.label_dim("Blend width"))
	var blend := int(zone.get("blendKm")) if zone.get("blendKm") != null else 100
	body.add_child(_slider_row(float(blend), 0.0, 2000.0, 10.0, func(value: float) -> String: return "%d km" % int(value), func(value: float) -> void: _patch("climate", id, {"blendKm": int(value)}, false), "", 56.0))
	body.add_child(_hint("How far the zone's edge fades into the zones beside it."))
	body.add_child(WorkshopUI.label_dim("Transition"))
	var transition := int(zone.get("transitionDays")) if zone.get("transitionDays") != null else 14
	body.add_child(_slider_row(float(transition), 0.0, 120.0, 1.0, func(value: float) -> String: return "1 day" if int(value) == 1 else "%d days" % int(value), func(value: float) -> void: _patch("climate", id, {"transitionDays": int(value)}, false), "", 56.0))
	body.add_child(_hint("How many days one season takes to turn into the next."))
	body.add_child(WorkshopUI.label_dim("Seasons"))
	var seasons: Array = zone.get("seasons") if zone.get("seasons") is Array else []
	if seasons.is_empty():
		body.add_child(_hint("No seasons: the zone has the game's own weather."))
	for index in range(seasons.size()):
		if seasons[index] is Dictionary:
			body.add_child(_season_card(id, zone_color, seasons[index], index))
	var season_row := HBoxContainer.new()
	season_row.add_theme_constant_override("separation", 6)
	var add := WorkshopUI.pill("Add season")
	add.icon = WorkshopUI.icon("plus", 13)
	add.disabled = seasons.size() >= 12
	add.pressed.connect(func() -> void:
		_open_season = seasons.size()
		_item(id, "seasons", -1, {"add": NEW_SEASON.duplicate(true)}, false))
	season_row.add_child(add)
	var presets: Array = [["", "Seasons of a climate…"]]
	for climate in CLIMATE_PRESETS:
		presets.append([climate, str(CLIMATE_LABELS[climate])])
	season_row.add_child(WorkshopUI.select(presets, "", func(value: String) -> void: _apply_climate(id, value, not seasons.is_empty()), 13.6, 30.0))
	body.add_child(season_row)
	body.add_child(WorkshopUI.label_dim("Dated events"))
	var events: Array = zone.get("events") if zone.get("events") is Array else []
	if events.is_empty():
		body.add_child(_hint("A drought, a long winter, a monsoon that fails: weather and effects between two dates."))
	for index in range(events.size()):
		if events[index] is Dictionary:
			body.add_child(_event_card(id, events[index], index))
	var add_event := WorkshopUI.pill("Add event")
	add_event.icon = WorkshopUI.icon("plus", 13)
	add_event.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	add_event.disabled = events.size() >= 40
	add_event.pressed.connect(func() -> void:
		_open_event = events.size()
		_item(id, "events", -1, {"add": NEW_EVENT.duplicate(true)}, false))
	body.add_child(add_event)


func _apply_climate(zone_id: String, climate: String, ask: bool) -> void:
	if climate.is_empty():
		return
	if ask and not await host.confirm("Replace this zone's seasons with that climate's?"):
		_render()
		return
	var reply := await host.request_raw("workshop.war.climateSeasons", {"climate": climate})
	if not reply.get("ok", false):
		_render()
		return
	_open_season = -1
	await _patch("climate", zone_id, {"seasons": (reply["result"] as Dictionary).get("seasons", [])}, false)


func _card(open: bool, title: String, detail: String, swatch: Variant, toggle: Callable) -> Array:
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0), Color(1, 1, 1, 0.1), 9, 1, Vector4(1, 1, 1, 1)))
	card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	card.add_child(column)
	var head := PanelContainer.new()
	var head_style := UI.box(Color(1, 1, 1, 0.04), Color(0, 0, 0, 0), 0, 0, Vector4(8, 6, 8, 6))
	head_style.corner_radius_top_left = 8
	head_style.corner_radius_top_right = 8
	head_style.corner_radius_bottom_left = 0 if open else 8
	head_style.corner_radius_bottom_right = 0 if open else 8
	head.add_theme_stylebox_override("panel", head_style)
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 8)
	if swatch is Color:
		line.add_child(WorkshopUI.swatch(swatch, 12.0, 3))
	line.add_child(WorkshopUI.wrap(title if not title.is_empty() else "Unnamed", 12.5, Color(1, 1, 1), 600))
	var dim := UI.label(detail, 11, Color(1, 1, 1, 0.5))
	dim.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	line.add_child(dim)
	line.add_child(WorkshopUI.icon_rect("close" if open else "plus", 12))
	head.add_child(line)
	WorkshopUI.ignore_mouse(head)
	WorkshopUI.clickable(head, func(_event: InputEventMouseButton) -> void: toggle.call())
	column.add_child(head)
	var fields := VBoxContainer.new()
	fields.add_theme_constant_override("separation", 7)
	if open:
		var margin := MarginContainer.new()
		for pair in [["margin_left", 9], ["margin_right", 9], ["margin_top", 8], ["margin_bottom", 8]]:
			margin.add_theme_constant_override(pair[0], pair[1])
		margin.add_child(fields)
		column.add_child(margin)
	return [card, fields]


func _season_card(zone_id: String, zone_color: String, season: Dictionary, index: int) -> PanelContainer:
	var open := _open_season == index
	var own := str(season.get("color", "")) if season.get("color") != null else ""
	var parts := _card(open, str(season.get("name", "")), "%s → %s" % [str(season.get("start", "")), str(season.get("end", ""))], _color(own) if not own.is_empty() else null, func() -> void:
		_open_season = -1 if _open_season == index else index
		_render())
	if not open:
		return parts[0]
	var fields: VBoxContainer = parts[1]
	var save := func(changes: Dictionary, typing: bool) -> void: _item(zone_id, "seasons", index, {"fields": changes}, typing)
	_name_field(fields, str(season.get("name", "")), 40, func(text: String) -> void: save.call({"name": text}, true))
	fields.add_child(_day_picker("Season starts", str(season.get("start", "")), func(value: String) -> void: save.call({"start": value}, false)))
	fields.add_child(_day_picker("Season ends", str(season.get("end", "")), func(value: String) -> void: save.call({"end": value}, false)))
	var own_box := HBoxContainer.new()
	own_box.add_theme_constant_override("separation", 6)
	own_box.add_child(WorkshopUI.toggle(not own.is_empty(), func(on: bool) -> void: save.call({"color": zone_color if on else null}, false)))
	if not own.is_empty():
		var picker := WorkshopUI.color_field(WorkshopUI.color_rgb(_color(own)), func(rgb: Array) -> void: save.call({"color": WorkshopUI.hex(WorkshopUI.rgb_color(rgb))}, false))
		picker.custom_minimum_size = Vector2(34, 24)
		own_box.add_child(picker)
	fields.add_child(WorkshopUI.row("Own colour", own_box, "The zone's colour on the game's map in this season"))
	fields.add_child(WorkshopUI.label_dim("Weather"))
	fields.add_child(_hint("How often each weather comes in this season."))
	var weights: Dictionary = season.get("weather") if season.get("weather") is Dictionary else {}
	var total := 0.0
	for state_name in WEATHER_STATES:
		total += maxf(0.0, float(weights.get(state_name, 0)))
	for state_name in WEATHER_STATES:
		var state_key := str(state_name)
		var weight := maxf(0.0, float(weights.get(state_key, 0)))
		var others := total - weight
		var share := func(value: float) -> String:
			var sum := others + value
			return "%d%%" % int(round(value / sum * 100.0)) if sum > 0.0 else "0%"
		fields.add_child(_slider_row(weight, 0.0, 100.0, 1.0, share, func(value: float) -> void: _item(zone_id, "seasons", index, {"weather": {state_key: int(value)}}, false), str(WEATHER_LABELS[state_key]), 56.0))
	fields.add_child(WorkshopUI.label_dim("Effects"))
	fields.add_child(_hint("What the season does besides its weather. An effect left unset is the weather's own."))
	_effects(fields, season.get("effects") if season.get("effects") is Dictionary else {}, func(changes: Dictionary) -> void: _item(zone_id, "seasons", index, {"effects": changes}, false))
	var remove := WorkshopUI.pill("Remove season", false, RED)
	remove.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	remove.pressed.connect(func() -> void:
		_open_season = -1
		_item(zone_id, "seasons", index, {"remove": true}, false))
	fields.add_child(remove)
	return parts[0]


func _event_card(zone_id: String, event: Dictionary, index: int) -> PanelContainer:
	var open := _open_event == index
	var from := str(event.get("from", "")) if event.get("from") != null else ""
	var to := str(event.get("to", "")) if event.get("to") != null else ""
	var parts := _card(open, str(event.get("name", "")), "%s → %s" % [from if not from.is_empty() else "…", to if not to.is_empty() else "…"], null, func() -> void:
		_open_event = -1 if _open_event == index else index
		_render())
	if not open:
		return parts[0]
	var fields: VBoxContainer = parts[1]
	var save := func(changes: Dictionary, typing: bool) -> void: _item(zone_id, "events", index, {"fields": changes}, typing)
	_name_field(fields, str(event.get("name", "")), 80, func(text: String) -> void: save.call({"name": text}, true))
	var warning := _hint("Write each date as YYYY-MM-DD, with a minus before a year BC. An event without both dates is not saved.", Color("#fbbf24"))
	var dates := {"from": from, "to": to}
	var refresh := func() -> void: warning.visible = not (_is_game_date(str(dates["from"])) and _is_game_date(str(dates["to"])))
	fields.add_child(_date_row("First day", from, func(value: String, typing: bool) -> void:
		dates["from"] = value
		refresh.call()
		save.call({"from": value}, typing)))
	fields.add_child(_date_row("Last day", to, func(value: String, typing: bool) -> void:
		dates["to"] = value
		refresh.call()
		save.call({"to": value}, typing)))
	fields.add_child(warning)
	refresh.call()
	var weather: Array = [["", "Weather as usual"]]
	for state_name in WEATHER_STATES:
		weather.append([state_name, str(WEATHER_LABELS[state_name])])
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 8)
	line.add_child(_caption("Weather"))
	var current := str(event.get("weather", "")) if event.get("weather") != null else ""
	line.add_child(WorkshopUI.select(weather, current, func(value: String) -> void: save.call({"weather": value if not value.is_empty() else null}, false), 13.6, 30.0))
	fields.add_child(line)
	fields.add_child(WorkshopUI.label_dim("Effects"))
	_effects(fields, event.get("effects") if event.get("effects") is Dictionary else {}, func(changes: Dictionary) -> void: _item(zone_id, "events", index, {"effects": changes}, false))
	var remove := WorkshopUI.pill("Remove event", false, RED)
	remove.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	remove.pressed.connect(func() -> void:
		_open_event = -1
		_item(zone_id, "events", index, {"remove": true}, false))
	fields.add_child(remove)
	return parts[0]


func _day_picker(label_text: String, value: String, on_change: Callable) -> HBoxContainer:
	var parsed := RegEx.create_from_string("^(\\d{1,2})-(\\d{1,2})$").search(value.strip_edges())
	var month := 1
	var day := 1
	if parsed:
		month = clampi(int(parsed.get_string(1)), 1, 12)
		day = clampi(int(parsed.get_string(2)), 1, int(DAYS_IN_MONTH[month - 1]))
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 8)
	line.add_child(_caption(label_text))
	var months: Array = []
	for index in range(12):
		months.append([str(index + 1), MONTHS[index]])
	line.add_child(WorkshopUI.select(months, str(month), func(next: String) -> void: on_change.call(_month_day(int(next), day)), 13.6, 30.0))
	var days: Array = []
	for number in range(1, int(DAYS_IN_MONTH[month - 1]) + 1):
		days.append([str(number), str(number)])
	var day_select := WorkshopUI.select(days, str(day), func(next: String) -> void: on_change.call(_month_day(month, int(next))), 13.6, 30.0)
	day_select.custom_minimum_size.x = 62
	day_select.size_flags_horizontal = Control.SIZE_SHRINK_END
	line.add_child(day_select)
	return line


func _month_day(month: int, day: int) -> String:
	var m := clampi(month, 1, 12)
	var d := clampi(day, 1, int(DAYS_IN_MONTH[m - 1]))
	return "%02d-%02d" % [m, d]


func _date_row(label_text: String, value: String, on_change: Callable) -> HBoxContainer:
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 8)
	line.add_child(_caption(label_text))
	var edit := _small_input(value, 40, func(text: String) -> void: on_change.call(text, true), "YYYY-MM-DD")
	edit.focus_exited.connect(func() -> void:
		if not is_instance_valid(edit):
			return
		var parsed := _parse_game_date(edit.text)
		if parsed.is_empty():
			return
		var normal := _format_game_date(parsed)
		if normal != edit.text:
			edit.text = normal
			on_change.call(normal, true))
	line.add_child(edit)
	return line


func _parse_game_date(value: String) -> Dictionary:
	var raw := value.strip_edges()
	if raw.is_empty():
		return {}
	var bc := false
	var era := RegEx.create_from_string("(?i)\\s*(BCE|BC|CE|AD)$").search(raw)
	if era:
		bc = era.get_string(1).to_upper().begins_with("BC")
		raw = raw.substr(0, era.get_start()).strip_edges()
	var date_part := raw
	for index in range(raw.length()):
		if raw[index] == "T" or raw[index] == " ":
			date_part = raw.substr(0, index)
			break
	var found := RegEx.create_from_string("^([+-]?)(\\d{1,6})-(\\d{1,2})-(\\d{1,2})$").search(date_part)
	if not found:
		return {}
	var year := int(found.get_string(2))
	var month := int(found.get_string(3))
	var day := int(found.get_string(4))
	if found.get_string(1) == "-" or bc:
		year = -year
	if year == 0 or absi(year) > 999999 or month < 1 or month > 12:
		return {}
	var astronomical := year + 1 if year < 0 else year
	var leap := astronomical % 4 == 0 and (astronomical % 100 != 0 or astronomical % 400 == 0)
	var lengths := [31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
	if day < 1 or day > int(lengths[month - 1]):
		return {}
	return {"year": year, "month": month, "day": day}


func _is_game_date(value: String) -> bool:
	return not _parse_game_date(value).is_empty()


func _format_game_date(parts: Dictionary) -> String:
	var year := int(parts["year"])
	return "%s%s-%s-%s" % ["-" if year < 0 else "", str(absi(year)).pad_zeros(4), str(int(parts["month"])).pad_zeros(2), str(int(parts["day"])).pad_zeros(2)]


func _effect_text(effect: Dictionary, value: float) -> String:
	return str(effect["sign"]) + (("%.3f" % value) if str(effect["key"]) == "wear" else ("%.2f" % value))


func _effects(box: VBoxContainer, effects: Dictionary, save: Callable) -> void:
	for spec in EFFECTS:
		var effect: Dictionary = spec
		var key := str(effect["key"])
		var set := effects.has(key) and effects[key] != null
		var shown_value := float(effects[key]) if set else float(effect["usual"])
		var line := HBoxContainer.new()
		line.add_theme_constant_override("separation", 8)
		line.tooltip_text = str(effect["hint"])
		line.add_child(_caption(str(effect["label"])))
		var slider := _slider(shown_value, float(effect["min"]), float(effect["max"]), float(effect["step"]))
		slider.tooltip_text = str(effect["hint"])
		line.add_child(slider)
		var value_label := UI.label(_effect_text(effect, shown_value), 12, Color(1, 1, 1, 0.85 if set else 0.34))
		value_label.custom_minimum_size.x = 56
		value_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		value_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		line.add_child(value_label)
		slider.value_changed.connect(func(next: float) -> void:
			value_label.text = _effect_text(effect, next)
			value_label.add_theme_color_override("font_color", Color(1, 1, 1, 0.85)))
		slider.drag_ended.connect(func(moved: bool) -> void:
			if moved:
				save.call({key: slider.value}))
		var reset := WorkshopUI.bare_icon("close", "Back to the weather's own", Color(1, 1, 1, 0.7), 12)
		reset.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		reset.disabled = not set
		reset.modulate.a = 1.0 if set else 0.25
		if not set:
			reset.mouse_default_cursor_shape = Control.CURSOR_ARROW
		reset.pressed.connect(func() -> void: save.call({key: null}))
		line.add_child(reset)
		box.add_child(line)
	box.add_child(WorkshopUI.check("Water freezes", effects.get("freezes") == true, func(on: bool) -> void: save.call({"freezes": true if on else null})))
