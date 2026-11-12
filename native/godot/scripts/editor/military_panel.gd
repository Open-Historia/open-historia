class_name EditorMilitaryPanel
extends VBoxContainer

signal details_changed(details: Dictionary)
signal value_changed(value: Variant)

var engine: EngineLink
var _props := {}
var _details := {}
var _scenario_id := ""
var _game_date := ""
var _war_settings: Variant = null
var _rated := 0
var _total := 0
var _running := false
var _call := 0
var _progress := ""
var _message := ""
var _error := ""
var _status_token := 0
var _count_label: Label
var _buttons: HBoxContainer
var _progress_label: Label
var _message_label: Label
var _error_label: Label


func setup(engine_link: EngineLink, props: Dictionary) -> void:
	engine = engine_link
	_props = props.duplicate()
	_details = props.get("details", {}) if props.get("details") is Dictionary else {}
	_scenario_id = _id_of(_details)
	_game_date = str(props.get("gameDate", ""))
	_war_settings = props.get("warSettings")
	add_theme_constant_override("separation", 0)
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_build()
	engine.engine_event.connect(_on_engine_event)
	_render()
	_refresh_status()


func update_props(props: Dictionary) -> void:
	for key in props:
		_props[key] = props[key]
	if props.has("gameDate"):
		_game_date = str(props["gameDate"])
	if props.has("warSettings"):
		_war_settings = props["warSettings"]
	if props.has("details") and props["details"] is Dictionary and not is_same(props["details"], _details):
		_details = props["details"]
		_scenario_id = _id_of(_details)
		if not _running:
			_refresh_status()


func _exit_tree() -> void:
	if engine and engine.engine_event.is_connected(_on_engine_event):
		engine.engine_event.disconnect(_on_engine_event)


func _id_of(details: Dictionary) -> String:
	var scenario: Variant = details.get("scenario")
	return str((scenario as Dictionary).get("id", "")) if scenario is Dictionary else ""


func _build() -> void:
	var parts := EditorWarKit.card()
	add_child(parts[0])
	add_child(EditorWarKit.gap(15))
	var column: VBoxContainer = parts[1]
	column.add_child(EditorWarKit.title("Countries' military figures"))
	column.add_child(EditorWarKit.gap(3))
	column.add_child(EditorWarKit.hint("The AI rates every country and group of this scenario against the others, twenty to a request: how well its soldiers fight, what they fight with, its army, navy and air force, what its forces have to spend, and its people where you gave none. What it says is saved with the scenario, and every game of it begins from it."))
	column.add_child(EditorWarKit.gap(3))
	column.add_child(EditorWarKit.hint("A country you leave out is rated in the game, against the others, when it is first needed. You can change any country's figures in the map editor."))
	column.add_child(EditorWarKit.gap(13))
	var row := HFlowContainer.new()
	row.add_theme_constant_override("h_separation", 8)
	row.add_theme_constant_override("v_separation", 6)
	_count_label = UI.label("", 12, Color(1, 1, 1, 0.78), 700)
	_count_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(_count_label)
	_buttons = HBoxContainer.new()
	_buttons.add_theme_constant_override("separation", 8)
	row.add_child(_buttons)
	column.add_child(row)
	_progress_label = EditorWarKit.hint("", Color(1, 1, 1, 0.72))
	_message_label = EditorWarKit.hint("")
	_error_label = EditorWarKit.hint("", EditorWarKit.ALERT)
	for entry in [_progress_label, _message_label, _error_label]:
		var holder := VBoxContainer.new()
		holder.add_theme_constant_override("separation", 0)
		holder.add_child(EditorWarKit.gap(8))
		holder.add_child(entry)
		holder.visible = false
		entry.set_meta("holder", holder)
		column.add_child(holder)


func _show(label: Label, text: String) -> void:
	label.text = text
	(label.get_meta("holder") as Control).visible = not text.is_empty()


func _render() -> void:
	_count_label.text = "%d of %d have their figures." % [_rated, _total]
	EditorKit.clear(_buttons)
	if _running:
		var stop := EditorWarKit.button("Stop", "soft", 999)
		stop.pressed.connect(_stop)
		_buttons.add_child(stop)
	else:
		var rate := EditorWarKit.button("Rate every country", "primary", 999)
		EditorWarKit.set_enabled(rate, not _scenario_id.is_empty() and _rated < _total, 0.5)
		rate.pressed.connect(func() -> void: _run(false))
		_buttons.add_child(rate)
		var again := EditorWarKit.button("Rate every country again", "soft", 999)
		EditorWarKit.set_enabled(again, not _scenario_id.is_empty() and _total > 0, 0.5)
		again.pressed.connect(func() -> void: _run(true))
		_buttons.add_child(again)
	_show(_progress_label, _progress)
	_show(_message_label, _message)
	_show(_error_label, _error)


func _refresh_status() -> void:
	if _scenario_id.is_empty():
		_rated = 0
		_total = 0
		_render()
		return
	_status_token += 1
	var token := _status_token
	var reply := await engine.request("editor.war.militaryStatus", {"scenarioId": _scenario_id})
	if token != _status_token or not is_inside_tree():
		return
	if reply.get("ok", false):
		_rated = int(reply["result"].get("rated", 0))
		_total = int(reply["result"].get("total", 0))
	_render()


func _run(again: bool) -> void:
	if _running or _scenario_id.is_empty() or _total == 0:
		return
	if again and not await EditorKit.ask(EditorWarKit.host_of(self, _props), "Rate every country again? The figures already set, by you or by the AI, are replaced."):
		return
	_running = true
	_error = ""
	_message = ""
	_progress = ""
	_render()
	_call = engine.last_request_id() + 1
	var reply := await engine.request("editor.war.rate", {"scenarioId": _scenario_id, "again": again, "gameDate": _game_date, "warSettings": _war_settings})
	_call = 0
	_running = false
	_progress = ""
	if not is_inside_tree():
		return
	if reply.get("ok", false):
		var result: Dictionary = reply["result"] if reply["result"] is Dictionary else {}
		_message = str(result.get("message", ""))
		_error = str(result.get("error", ""))
	else:
		_error = "The AI could not rate them: %s" % str(reply.get("error", ""))
	_render()


func _stop() -> void:
	if _call > 0:
		engine.cancel(_call)


func _on_engine_event(event_name: String, data: Variant) -> void:
	if _call == 0 or not (data is Dictionary) or int((data as Dictionary).get("call", -1)) != _call:
		return
	if event_name == "editor.war.progress":
		_progress = str(data.get("text", ""))
		_render()
	elif event_name == "editor.war.saved":
		var status: Variant = data.get("status")
		if status is Dictionary:
			_rated = int((status as Dictionary).get("rated", _rated))
			_total = int((status as Dictionary).get("total", _total))
		var saved: Variant = data.get("details")
		if saved is Dictionary:
			_details = saved
			details_changed.emit(saved)
		_render()
