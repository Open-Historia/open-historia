class_name EditorWarSettings
extends VBoxContainer

signal details_changed(details: Dictionary)
signal value_changed(value: Variant)

const MECHANIC_LABELS := {
	"fatigue": "Troop fatigue",
	"weather": "Seasons and weather",
	"terrain": "Terrain",
	"walls": "Fortified lines",
	"muster": "Mustering",
	"military": "Countries' military figures",
	"air": "Air in battles",
	"supply": "Supplies",
	"attrition": "Attrition",
}
const MECHANIC_HINTS := {
	"fatigue": "Troops tire as they march and fight, and recover at rest; a day after they hold their ground, they fight a little harder.",
	"weather": "The season and the day's weather slow, blunt and wear troops, on land and at sea.",
	"terrain": "Ground the map makes harder to cross slows an advance.",
	"walls": "Fortified lines on the map must be broken through.",
	"muster": "A war's levies come in over weeks, along the mustering curve, not all on its first morning.",
	"military": "Each country's own quality, technology, arms, unit mix and men a counter, from the map editor's Countries panel.",
	"air": "Air wings take part in the fighting below them.",
	"supply": "Building fortified lines uses up a country's war resources, which its funding refills; an army low on them fights worse.",
	"attrition": "Harsh weather and a hard winter wear down every army out in them, the more so tired, short of supply or cut off; what it costs weighs heavily on a country's will to fight.",
}

var engine: EngineLink
var _props := {}
var _value: Variant = null
var _game_date := ""
var _grid: GridContainer
var _era_select: OptionButton
var _era_hint: Label
var _warfare_select: OptionButton
var _warfare_hint: Label
var _men_field: LineEdit
var _men_hint: Label
var _share_field: LineEdit
var _chart: EditorWarMusterChart
var _outcomes_box: VBoxContainer
var _winner: LineEdit
var _loser: LineEdit
var _add_outcome: Button
var _mechanics: HFlowContainer


func setup(engine_link: EngineLink, props: Dictionary) -> void:
	engine = engine_link
	_props = props.duplicate()
	_value = EditorWarRules.compact_war_settings(props.get("value"))
	_game_date = str(props.get("gameDate", ""))
	add_theme_constant_override("separation", 0)
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_build()
	_sync()


func update_props(props: Dictionary) -> void:
	for key in props:
		_props[key] = props[key]
	var changed := false
	if props.has("value") and not EditorWarRules.same_json(EditorWarRules.compact_war_settings(props["value"]), _value):
		_value = EditorWarRules.compact_war_settings(props["value"])
		changed = true
	if props.has("gameDate") and str(props["gameDate"]) != _game_date:
		_game_date = str(props["gameDate"])
		changed = true
	if changed and _grid:
		_sync()


func value() -> Variant:
	return _value


func _settings() -> Dictionary:
	var kept: Variant = EditorWarRules.normalize_war_settings(_value)
	if kept == null:
		return {"mechanics": {}, "era": null, "menPerCounter": null, "manpowerShare": null, "muster": null}
	return kept


func _change(next: Variant) -> void:
	_value = next
	value_changed.emit(next)
	_sync()


func _build() -> void:
	var parts := EditorWarKit.card()
	add_child(parts[0])
	add_child(EditorWarKit.gap(15))
	var column: VBoxContainer = parts[1]
	column.add_child(EditorWarKit.title("How its wars are fought"))
	column.add_child(EditorWarKit.gap(3))
	column.add_child(EditorWarKit.hint("For every war in a game of this scenario. A country may say otherwise for itself: its Military figures in the map editor's Countries panel. The Save button below saves these with the scenario."))
	column.add_child(EditorWarKit.gap(13))
	_grid = GridContainer.new()
	_grid.columns = 4
	_grid.add_theme_constant_override("h_separation", 13)
	_grid.add_theme_constant_override("v_separation", 13)
	_grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.add_child(_grid)
	column.resized.connect(func() -> void: _fit_grid(column.size.x))

	var era_options: Array = []
	for index in range(EditorWarRules.ERA_LABELS.size()):
		era_options.append([str(index), EditorWarRules.ERA_LABELS[index]])
	_era_select = EditorWarKit.select(era_options, "", func(picked: String) -> void:
		_change(EditorWarRules.with_war_settings(_value, {"era": null if picked.is_empty() else int(picked)})), "Automatic (read off the date)")
	_era_select.tooltip_text = "Era"
	_era_hint = EditorWarKit.hint("")
	_grid.add_child(_cell("Era", _era_select, [_era_hint]))

	_warfare_select = EditorWarKit.select([["front", "Fronts"], ["swarm", "Swarms"]], "", func(picked: String) -> void:
		_change(EditorWarRules.with_war_settings(_value, {"warfare": null if picked.is_empty() else picked})), "Automatic (read off the date)")
	_warfare_select.tooltip_text = "Warfare"
	_warfare_hint = EditorWarKit.hint("")
	var before := EditorWarKit.hint("Before %d a war's troops come as swarms: groups, each under a general of its own, not a line where the two sides meet. Each troop still moves and fights as it would on a front, and players can deploy either way in the war room." % EditorWarRules.FRONTS_FROM_YEAR)
	_grid.add_child(_cell("Warfare", _warfare_select, [_warfare_hint, before]))

	_men_field = _number_field("menPerCounter", "Men per counter")
	_men_hint = EditorWarKit.hint("")
	_grid.add_child(_cell("Men per counter", _men_field, [_men_hint]))

	_share_field = _number_field("manpowerShare", "The share of a country's people who can fight, in percent")
	_share_field.placeholder_text = "12"
	_grid.add_child(_cell("Manpower (% of people)", _share_field, [EditorWarKit.hint("Empty: 12, as every country had.")]))

	column.add_child(EditorWarKit.gap(14))
	column.add_child(EditorWarKit.field_label("Mustering"))
	column.add_child(EditorWarKit.hint("How long calling up an army takes, for every country without a curve of its own: from nothing on the first day through the two points. Left alone, half the army is in after 21 days and all of it after 90."))
	column.add_child(EditorWarKit.gap(7))
	_chart = EditorWarMusterChart.new("The scenario's curve", "The game's default")
	_chart.points_changed.connect(func(points: Variant) -> void: _change(EditorWarRules.with_war_settings(_value, {"muster": points})))
	column.add_child(_chart)

	column.add_child(EditorWarKit.gap(14))
	column.add_child(EditorWarKit.field_label("Scripted outcomes"))
	column.add_child(EditorWarKit.hint("A war meant to end one way: in any war between the two, a side nobody plays that is meant to lose is led by a plainer commander. Nothing is decided: a player who fights well can still win a war meant to be lost, and lose one meant to be won."))
	column.add_child(EditorWarKit.gap(7))
	_outcomes_box = VBoxContainer.new()
	_outcomes_box.add_theme_constant_override("separation", 5)
	column.add_child(_outcomes_box)
	var add_row := HBoxContainer.new()
	add_row.add_theme_constant_override("separation", 6)
	_winner = EditorWarKit.input("", "Meant to win", func(_text: String) -> void: _sync_add())
	_winner.tooltip_text = "Country meant to win"
	_winner.text_submitted.connect(func(_text: String) -> void: _add())
	add_row.add_child(_winner)
	var beat := EditorWarKit.hint("is meant to beat")
	beat.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	beat.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	beat.autowrap_mode = TextServer.AUTOWRAP_OFF
	add_row.add_child(beat)
	_loser = EditorWarKit.input("", "Meant to lose", func(_text: String) -> void: _sync_add())
	_loser.tooltip_text = "Country meant to lose"
	_loser.text_submitted.connect(func(_text: String) -> void: _add())
	add_row.add_child(_loser)
	_add_outcome = EditorWarKit.toggle_pill("Add", false)
	_add_outcome.pressed.connect(_add)
	add_row.add_child(_add_outcome)
	column.add_child(add_row)
	column.add_child(EditorWarKit.gap(5))
	column.add_child(EditorWarKit.hint("Countries by their exact names. Every other war is fought by the best commander there is."))

	column.add_child(EditorWarKit.gap(14))
	column.add_child(EditorWarKit.field_label("Mechanics"))
	column.add_child(EditorWarKit.hint("Each is on unless you turn it off here."))
	column.add_child(EditorWarKit.gap(7))
	_mechanics = HFlowContainer.new()
	_mechanics.add_theme_constant_override("h_separation", 6)
	_mechanics.add_theme_constant_override("v_separation", 6)
	column.add_child(_mechanics)
	_sync_add()


func _fit_grid(width: float) -> void:
	if not _grid or width <= 0.0:
		return
	var columns := clampi(int((width + 13.0) / (192.0 + 13.0)), 1, 4)
	if _grid.columns != columns:
		_grid.columns = columns


func _cell(label_text: String, control: Control, hints: Array) -> VBoxContainer:
	var cell := VBoxContainer.new()
	cell.add_theme_constant_override("separation", 0)
	cell.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	cell.add_child(EditorWarKit.field_label(label_text))
	cell.add_child(control)
	for entry in hints:
		cell.add_child(EditorWarKit.gap(5))
		cell.add_child(entry)
	return cell


func _number_field(key: String, tip: String) -> LineEdit:
	var field := EditorWarKit.input(EditorWarRules.war_number_text(_value, key), "")
	field.tooltip_text = tip
	field.text_changed.connect(func(text: String) -> void: _typed_number(key, text, null))
	field.text_submitted.connect(func(_text: String) -> void: field.release_focus())
	field.focus_exited.connect(func() -> void: _typed_number(key, field.text, field))
	return field


func _typed_number(key: String, text: String, field: LineEdit) -> void:
	var result := EditorWarRules.with_war_number(_value, key, text)
	var ok: bool = result["ok"]
	var next: Variant = result["settings"]
	if field != null:
		field.text = EditorWarRules.war_number_text(next if ok else _value, key)
	if ok and not EditorWarRules.same_json(next, _value):
		_change(next)


func _ready_to_add() -> bool:
	var winner := _winner.text.strip_edges()
	var loser := _loser.text.strip_edges()
	return not winner.is_empty() and not loser.is_empty() and winner.to_lower() != loser.to_lower()


func _sync_add() -> void:
	var ready := _ready_to_add()
	EditorWarKit.set_pill(_add_outcome, ready)
	_add_outcome.disabled = not ready
	_add_outcome.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if ready else Control.CURSOR_ARROW


func _add() -> void:
	if not _ready_to_add():
		return
	var next: Variant = EditorWarRules.with_war_outcome(_value, _winner.text.strip_edges(), _loser.text.strip_edges())
	_winner.text = ""
	_loser.text = ""
	_sync_add()
	_change(next)


func _select_value(select: OptionButton, value: String) -> void:
	for index in range(select.item_count):
		if str(select.get_item_metadata(index)) == value:
			if select.selected != index:
				select.select(index)
			return


func _sync() -> void:
	var settings := _settings()
	var date_era := EditorWarRules.era_of(_game_date, null)
	var era := int(settings["era"]) if settings["era"] != null else date_era
	_select_value(_era_select, "" if settings["era"] == null else str(int(settings["era"])))
	_era_hint.text = "Read off the game date: %s" % EditorWarRules.ERA_LABELS[date_era]
	var without_warfare := settings.duplicate(true)
	without_warfare["warfare"] = null
	var date_warfare := EditorWarRules.warfare_of(without_warfare, _game_date)
	_select_value(_warfare_select, str(settings.get("warfare", "")) if settings.get("warfare") != null else "")
	_warfare_hint.text = "Read off the game date: %s" % ("Swarms" if date_warfare == "swarm" else "Fronts")
	var men := EditorWarRules.format_population_figure(EditorWarRules.MEN_PER_FORMATION_BY_ERA[era])
	_men_field.placeholder_text = men
	_men_hint.text = "Empty: the era's own, %s men." % men
	if not _men_field.has_focus():
		_men_field.text = EditorWarRules.war_number_text(_value, "menPerCounter")
	if not _share_field.has_focus():
		_share_field.text = EditorWarRules.war_number_text(_value, "manpowerShare")
	_chart.set_points(settings["muster"], EditorWarRules.DEFAULT_MUSTER)
	EditorKit.clear(_outcomes_box)
	var outcomes: Array = settings.get("outcomes", [])
	for index in range(outcomes.size()):
		var rule: Dictionary = outcomes[index]
		var row := HFlowContainer.new()
		row.add_theme_constant_override("h_separation", 6)
		row.add_theme_constant_override("v_separation", 4)
		var winner := UI.label(str(rule.get("winner", "")), 12, EditorWarKit.INPUT_INK, 700)
		winner.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(winner)
		var words := UI.label("is meant to beat", 11, EditorWarKit.HINT)
		words.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(words)
		var loser := UI.label(str(rule.get("loser", "")), 12, EditorWarKit.INPUT_INK, 700)
		loser.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(loser)
		var remove := EditorWarKit.toggle_pill("Remove", false)
		var at := index
		remove.pressed.connect(func() -> void: _change(EditorWarRules.without_war_outcome(_value, at)))
		row.add_child(remove)
		_outcomes_box.add_child(row)
	_outcomes_box.visible = not outcomes.is_empty()
	EditorKit.clear(_mechanics)
	var mechanics: Dictionary = settings.get("mechanics", {})
	for key in EditorWarRules.WAR_MECHANICS:
		var on: bool = mechanics.get(key) != false
		var pill := EditorWarKit.toggle_pill(("✓ " if on else "○ ") + str(MECHANIC_LABELS[key]), on)
		pill.tooltip_text = MECHANIC_HINTS[key]
		pill.set_meta("mechanic", key)
		var mechanic: String = key
		pill.pressed.connect(func() -> void: _change(EditorWarRules.with_war_mechanic(_value, mechanic, not on)))
		_mechanics.add_child(pill)
