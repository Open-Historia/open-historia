class_name WorkshopMilitary
extends VBoxContainer

signal military_changed(military: Variant)

const CHART_SCRIPT := "res://scripts/editor/war_muster_chart.gd"

static var _open := {}

var host: Workshop
var kind := "polity"
var key := ""
var kept: Variant = null
var _view := {}
var _body: VBoxContainer
var _toggle: Button
var _rating := false
var _rate_error := ""
var _fields := {}


func setup(workshop: Workshop, record_kind: String, record_key: String, value: Variant) -> void:
	host = workshop
	kind = record_kind
	key = record_key
	kept = value
	add_theme_constant_override("separation", 0)
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var frame := PanelContainer.new()
	frame.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0), Color(1, 1, 1, 0.1), 8, 1, Vector4(9, 6, 9, 6)))
	add_child(frame)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 7)
	frame.add_child(column)
	_toggle = WorkshopUI.base_button("")
	var clear := StyleBoxEmpty.new()
	for state_name in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
		_toggle.add_theme_stylebox_override(state_name, clear)
	_toggle.alignment = HORIZONTAL_ALIGNMENT_LEFT
	WorkshopUI._ink(_toggle, Color(1, 1, 1), 11.5, 700)
	_toggle.pressed.connect(func() -> void:
		_open[_open_key()] = not bool(_open.get(_open_key(), false))
		_render())
	column.add_child(_toggle)
	_body = VBoxContainer.new()
	_body.add_theme_constant_override("separation", 7)
	column.add_child(_body)
	await _load()


func _open_key() -> String:
	return "%s:%s" % [kind, key]


func _load() -> void:
	var reply := await host.request_raw("workshop.military.view", {"value": kept})
	if reply.get("ok", false):
		_view = reply["result"]
		kept = _view.get("kept")
	_render()


func _render() -> void:
	var opened := bool(_open.get(_open_key(), false))
	_toggle.text = ("▾ " if opened else "▸ ") + "Military" + (" · its own figures" if kept != null else "")
	WorkshopUI.clear(_body)
	_fields = {}
	_body.visible = opened
	if not opened:
		return
	var texts: Dictionary = _view.get("texts", {})
	var defaults_text: Variant = _view.get("defaultsText")
	var mix := str(_view.get("mix", "both"))
	var horse := "Armour (%)" if mix == "modern" else ("Cavalry (%)" if mix == "old" else "Cavalry / armour (%)")
	var siege := "Artillery (%)" if mix == "modern" else ("Siege (%)" if mix == "old" else "Siege / artillery (%)")
	var defaults: Dictionary = defaults_text if defaults_text is Dictionary else {}
	_group("Its soldiers", [
		["quality", "Troop quality", "How well its soldiers fight, 0 to 100: a levy low, elites high. Empty is 50.", "50"],
		["technology", "Technology", "What its soldiers fight with, 0 to 100. Empty is 50.", "50"],
		["spending", "Spending", "What its forces have to spend, against the other countries', 0 to 100. Empty is 50.", "50"],
		["weariness", "War weariness", "How weary of war it is when it first goes to one, 0 to 100. Empty is 0.", "0"],
	], texts)
	_group("What it can fight with", [
		["land", "Land", "What it can do on land, 0 to 100; 0 is no army at all. Empty is 50.", "50"],
		["sea", "Naval", "What it can do at sea, 0 to 100; 0 is no navy at all. Empty is 50.", "50"],
		["air", "Air", "What it can do in the air, 0 to 100; 0 is no air force at all. Empty is 50.", "50"],
	], texts)
	_group("Its army", [
		["manpowerShare", "Manpower (%)", "The share of its people who can fight, in percent. Every country had 12; the Night's Watch might have 60.", str(defaults.get("manpowerShare", "12"))],
		["menPerCounter", "Men per counter", "The men one of its counters stands for. Empty: the scenario's, else the era's.", str(defaults.get("menPerCounter", "By era"))],
		["cavalryShare", horse, "The share of its counters that are horse (armour from 1850), in percent. Empty: the era's.", str(defaults.get("cavalryShare", "By era"))],
		["siegeShare", siege, "The share of its counters that are siege engines (artillery from 1850), in percent. Empty: the era's.", str(defaults.get("siegeShare", "By era"))],
	], texts)
	_body.add_child(UI.label("Mustering", 11, Color(1, 1, 1, 0.48)))
	_add_chart()
	var actions := HFlowContainer.new()
	actions.add_theme_constant_override("h_separation", 8)
	actions.add_theme_constant_override("v_separation", 6)
	var rate := WorkshopUI.pill("Asking the AI…" if _rating else "Fill in with AI")
	rate.tooltip_text = "Ask the AI for the figures left empty, from what the scenario says of this country and its era"
	rate.disabled = _rating
	rate.pressed.connect(_fill_in)
	actions.add_child(rate)
	if not _rate_error.is_empty():
		actions.add_child(WorkshopUI.small_label(_rate_error, 0.45))
	_body.add_child(actions)
	if kept != null:
		var clear_button := WorkshopUI.pill("Clear its military figures")
		clear_button.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		clear_button.tooltip_text = "Take every one of its military figures away: it fights as every country does"
		clear_button.pressed.connect(func() -> void:
			kept = null
			military_changed.emit(null)
			await _load())
		_body.add_child(clear_button)


func _group(title: String, rows: Array, texts: Dictionary) -> void:
	_body.add_child(UI.label(title, 11, Color(1, 1, 1, 0.48)))
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 12)
	grid.add_theme_constant_override("v_separation", 5)
	for row in rows:
		var spec: Array = row
		var field := str(spec[0])
		var line := HBoxContainer.new()
		line.add_theme_constant_override("separation", 6)
		line.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		line.tooltip_text = str(spec[2])
		var caption := UI.label(str(spec[1]), 11, Color(1, 1, 1, 0.72))
		caption.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		caption.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		caption.custom_minimum_size.x = 70
		line.add_child(caption)
		var edit := WorkshopUI.input(str(texts.get(field, "")), str(spec[3]), Callable(), 12.0, 26.0)
		edit.custom_minimum_size.x = 64
		edit.size_flags_horizontal = Control.SIZE_SHRINK_END
		edit.alignment = HORIZONTAL_ALIGNMENT_RIGHT
		edit.text_changed.connect(func(text: String) -> void: _typed(field, text, null))
		edit.text_submitted.connect(func(_text: String) -> void: edit.release_focus())
		edit.focus_exited.connect(func() -> void: _typed(field, edit.text, edit))
		line.add_child(edit)
		_fields[field] = edit
		grid.add_child(line)
	_body.add_child(grid)


func _typed(field: String, text: String, edit: LineEdit) -> void:
	var reply := await host.request_raw("workshop.military.field", {"value": kept, "field": field, "text": text})
	if not reply.get("ok", false):
		return
	var result: Dictionary = reply["result"]
	if edit and is_instance_valid(edit):
		edit.text = str(result.get("text", ""))
	if bool(result.get("changed", false)):
		kept = result.get("military")
		military_changed.emit(kept)
		_toggle.text = "▾ Military" + (" · its own figures" if kept != null else "")


func _add_chart() -> void:
	if not ResourceLoader.exists(CHART_SCRIPT):
		return
	var script: Script = load(CHART_SCRIPT)
	var defaults: Variant = _view.get("defaults")
	var fallback_label := "The game's default"
	var fallback: Variant = null
	if defaults is Dictionary:
		fallback = (defaults as Dictionary).get("muster")
		if bool((defaults as Dictionary).get("scenarioMuster", false)):
			fallback_label = "The scenario's curve"
	var chart: Control = script.new("Its own curve", fallback_label)
	_body.add_child(chart)
	var own: Variant = (kept as Dictionary).get("muster") if kept is Dictionary else null
	if chart.has_method("set_points"):
		chart.call("set_points", own, fallback)
	if chart.has_signal("points_changed"):
		chart.connect("points_changed", func(points: Variant) -> void:
			var reply: Dictionary = await host.request_raw("workshop.military.muster", {"value": kept, "points": points})
			if reply.get("ok", false) and bool((reply["result"] as Dictionary).get("changed", false)):
				kept = (reply["result"] as Dictionary).get("military")
				military_changed.emit(kept))


func _fill_in() -> void:
	_rating = true
	_rate_error = ""
	_render()
	var reply := await host.request_raw("workshop.military.rate", {"kind": kind, "key": key})
	_rating = false
	if not reply.get("ok", false):
		_rate_error = str(reply.get("error", "")) if not str(reply.get("error", "")).is_empty() else "The AI could not be asked."
		_render()
		return
	await host.apply(reply["result"])
