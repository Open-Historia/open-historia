class_name EditorPoliticalGeneration
extends VBoxContainer

signal details_changed(details: Dictionary)
signal value_changed(value: Variant)

const PROGRESS_EVENT := "editor.politics.progress"

var _engine: EngineLink
var _props: Dictionary = {}
var _scenario_id := ""
var _view: Dictionary = {}
var _rows: Array = []
var _rows_version := -1
var _expanded := ""
var _filter := ""
var _running_id := 0
var _discard_armed := false
var _discard_serial := 0
var _pending_refresh := false
var _advanced: Dictionary = {}
var _head_box: VBoxContainer
var _buttons_box: VBoxContainer
var _tools_flow: HFlowContainer
var _settings_nodes: Array[Control] = []
var _budget_input: LineEdit
var _mode_select: OptionButton
var _mode_note: Label
var _roster_check: CheckBox
var _status_box: VBoxContainer
var _rows_box: VBoxContainer
var _rows_list: VBoxContainer
var _filter_input: LineEdit
var _apply_selected: Button
var _quiet_settings := false


func _init() -> void:
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	add_theme_constant_override("separation", 0)


func setup(engine: EngineLink, props: Dictionary) -> void:
	_engine = engine
	_props = props
	var details: Dictionary = props.get("details", {})
	_scenario_id = str((details.get("scenario", {}) as Dictionary).get("id", ""))
	if not _engine.engine_event.is_connected(_on_engine_event):
		_engine.engine_event.connect(_on_engine_event)
	_build()
	var reply := await _engine.request("editor.politics.gen.open", {"scenarioId": _scenario_id, "form": _form_args()})
	_apply_reply(reply)


func update_props(props: Dictionary) -> void:
	_props = props
	if _view.is_empty():
		return
	if bool(_view.get("busy", false)) or _running_id != 0:
		_pending_refresh = true
		return
	_refresh()


func _refresh() -> void:
	_pending_refresh = false
	var reply := await _engine.request("editor.politics.gen.refresh", {"scenarioId": _scenario_id, "form": _form_args()})
	_apply_reply(reply)


func _exit_tree() -> void:
	if _running_id != 0 and _engine:
		_engine.cancel(_running_id)


func _host() -> Node:
	var host: Variant = _props.get("host")
	if host is Node and is_instance_valid(host):
		return host
	return self


func _form_args() -> Dictionary:
	var form: Dictionary = _props.get("form", {})
	var args := {"gameDate": str(_props.get("gameDate", form.get("gameDate", "")))}
	if form.has("canonContext"):
		args["canonContext"] = form["canonContext"]
	if form.has("canonContextTouched"):
		args["canonContextTouched"] = form["canonContextTouched"]
	return args


func _base_args() -> Dictionary:
	return {"scenarioId": _scenario_id, "form": _form_args()}


func _row_edits() -> Array:
	var edits: Array = []
	for row in _rows:
		var entry: Dictionary = row
		edits.append({
			"polityKey": str(entry.get("polityKey", "")),
			"selected": bool(entry.get("selected", false)),
			"allowEntityExpansion": bool(entry.get("allowEntityExpansion", false)),
			"actorPatchText": str(entry.get("actorPatchText", "")),
			"sourceErrors": entry.get("sourceErrors", []),
		})
	return edits


func _call(method: String, extra := {}, long_running := false) -> void:
	var args := _base_args()
	args.merge(extra, true)
	if long_running:
		_running_id = _engine.last_request_id() + 1
	var reply := await _engine.request(method, args)
	if long_running:
		_running_id = 0
	if not is_inside_tree():
		return
	_apply_reply(reply)
	if _pending_refresh:
		_refresh()


func _apply_reply(reply: Dictionary) -> void:
	if not reply.get("ok", false):
		if _view.is_empty():
			_view = {"error": str(reply.get("error", "")), "busy": false, "applying": false}
		else:
			_view["error"] = str(reply.get("error", ""))
			_view["busy"] = false
			_view["applying"] = false
		_render()
		return
	var result: Dictionary = reply.get("result", {})
	var row_errors: Dictionary = result.get("rowErrors", {})
	if result.has("details") and result["details"] is Dictionary:
		details_changed.emit(result["details"])
	_apply_view(result.get("view", {}), row_errors)


func _apply_view(view: Dictionary, row_errors := {}) -> void:
	if view.is_empty():
		return
	_view = view
	var rows_changed := false
	if view.has("rows") and int(view.get("rowsVersion", 0)) != _rows_version:
		_rows = (view["rows"] as Array).duplicate(true)
		_rows_version = int(view.get("rowsVersion", 0))
		_expanded = str(view.get("expandedPolity", ""))
		rows_changed = true
	if not row_errors.is_empty():
		for row in _rows:
			var entry: Dictionary = row
			var key := str(entry.get("polityKey", ""))
			if row_errors.has(key):
				entry["sourceErrors"] = row_errors[key]
		rows_changed = true
	_render()
	if rows_changed:
		_render_rows()


func _on_engine_event(event_name: String, data: Variant) -> void:
	if event_name != PROGRESS_EVENT or not (data is Dictionary):
		return
	var payload: Dictionary = data
	if str(payload.get("scenarioId", "")) != _scenario_id or not is_inside_tree():
		return
	var view: Dictionary = payload.get("view", {})
	if view.is_empty():
		return
	_view = view
	_render()


func _build() -> void:
	EditorKit.clear(self)
	var parts := PoliticalKit.box(Color(1, 1, 1, 0.03), Color(1, 1, 1, 0.08), 18, Vector4(14, 14, 14, 14), 0)
	add_child(parts[0])
	add_child(PoliticalKit.gap(15))
	var card: VBoxContainer = parts[1]
	_head_box = VBoxContainer.new()
	_head_box.add_theme_constant_override("separation", 0)
	card.add_child(_head_box)
	_buttons_box = VBoxContainer.new()
	_buttons_box.add_theme_constant_override("separation", 0)
	card.add_child(_buttons_box)
	card.add_child(PoliticalKit.gap(11))
	_advanced = PoliticalKit.section("Advanced generation settings & repair tools", false, Color(1, 1, 1, 0.02), Color(1, 1, 1, 0.07), 12, Vector4(10, 8, 10, 9), 12, 700, Color(1, 1, 1, 0.62))
	card.add_child(_advanced["panel"])
	_build_advanced(_advanced["content"])
	_status_box = VBoxContainer.new()
	_status_box.add_theme_constant_override("separation", 0)
	card.add_child(_status_box)
	_rows_box = VBoxContainer.new()
	_rows_box.add_theme_constant_override("separation", 0)
	_rows_box.visible = false
	card.add_child(_rows_box)
	_build_rows_box()
	var loading := PoliticalKit.text("Political World", 16, UI.WHITE, 800)
	_head_box.add_child(loading)


func _build_advanced(content: VBoxContainer) -> void:
	content.add_theme_constant_override("separation", 0)
	content.add_child(PoliticalKit.gap(10))
	_tools_flow = EditorKit.flow(7)
	content.add_child(_tools_flow)
	var budget_box := HBoxContainer.new()
	budget_box.add_theme_constant_override("separation", 6)
	budget_box.add_child(UI.label("Maximum AI requests this run", 11, Color(1, 1, 1, 0.58)))
	_budget_input = PoliticalKit.input("20")
	_budget_input.custom_minimum_size = Vector2(77, 34)
	_budget_input.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	_budget_input.text_changed.connect(func(value: String) -> void:
		if _quiet_settings:
			return
		var parsed: Array = PoliticalKit.js_to_number(value)
		var budget := maxi(1, int(float(parsed[1]))) if bool(parsed[0]) and float(parsed[1]) != 0.0 else 1
		_send_settings({"callBudget": budget}))
	budget_box.add_child(_budget_input)
	for child in budget_box.get_children():
		(child as Control).size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_tools_flow.add_child(budget_box)
	_settings_nodes.append(budget_box)
	var mode_box := HBoxContainer.new()
	mode_box.add_theme_constant_override("separation", 6)
	mode_box.add_child(UI.label("Generation mode", 11, Color(1, 1, 1, 0.58)))
	_mode_select = PoliticalKit.select([], "")
	_mode_select.custom_minimum_size = Vector2(150, 35)
	_mode_select.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	_mode_select.item_selected.connect(func(index: int) -> void:
		if _quiet_settings:
			return
		_send_settings({"mode": str(_mode_select.get_item_metadata(index))}))
	mode_box.add_child(_mode_select)
	for child in mode_box.get_children():
		(child as Control).size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_tools_flow.add_child(mode_box)
	_settings_nodes.append(mode_box)
	content.add_child(PoliticalKit.gap(8))
	_mode_note = PoliticalKit.text("", 11, Color(1, 1, 1, 0.48))
	content.add_child(_mode_note)
	content.add_child(PoliticalKit.gap(6))
	content.add_child(PoliticalKit.text("Generation mode applies to Generate Political World and to Generate Missing Politics.", 11, Color(1, 1, 1, 0.48)))
	content.add_child(PoliticalKit.gap(8))
	content.add_child(PoliticalKit.text("Repair Governing Alignment can only fill missing rulingPartyIds / coalitionPartyIds from party IDs that already exist and never runs the temporal verifier.", 11, Color(1, 1, 1, 0.48)))
	content.add_child(PoliticalKit.gap(10))
	var roster_row := HBoxContainer.new()
	roster_row.add_theme_constant_override("separation", 7)
	_roster_check = PoliticalKit.check("", false)
	_roster_check.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	_roster_check.toggled.connect(func(on: bool) -> void:
		if _quiet_settings:
			return
		_send_settings({"allowRosterExpansion": on}))
	roster_row.add_child(_roster_check)
	var roster_text := UI.rich("**Allow roster expansion proposals.** This also affects the main Political World generation run. Leave it off for the safest preserve-authored-rosters behavior.", 11, Color(1, 1, 1, 0.56))
	roster_text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	roster_row.add_child(roster_text)
	content.add_child(roster_row)


func _send_settings(patch: Dictionary) -> void:
	var args := _base_args()
	args.merge(patch, true)
	var reply := await _engine.request("editor.politics.gen.settings", args)
	if not is_inside_tree() or not reply.get("ok", false):
		return
	var view: Dictionary = (reply.get("result", {}) as Dictionary).get("view", {})
	if not view.is_empty():
		_view = view
		_render()


func _render() -> void:
	if not is_inside_tree() or _view.is_empty():
		return
	_render_head()
	_render_buttons()
	_render_tools()
	_render_status()
	_update_rows_header()


func _tone_colors() -> Array:
	match str(_view.get("tone", "")):
		"absent":
			return [Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.10), Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.28), PoliticalKit.AMBER_INK]
		"sparse":
			return [Color(1, 1, 1, 0.035), PoliticalKit.GREY_BORDER, PoliticalKit.GREY_TEXT]
	return [Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.09), Color(74 / 255.0, 222 / 255.0, 128 / 255.0, 0.24), PoliticalKit.GREEN_INK]


func _render_head() -> void:
	EditorKit.clear(_head_box)
	var tone := _tone_colors()
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	var titles := VBoxContainer.new()
	titles.add_theme_constant_override("separation", 5)
	titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	titles.add_child(UI.label("Political World", 16, UI.WHITE, 800))
	titles.add_child(PoliticalKit.text("Give this scenario governments, Political Actors, domestic politics, institutions context and its starting geopolitical state. Generation is staged for review and does not change the scenario until you apply it.", 12, Color(1, 1, 1, 0.58)))
	row.add_child(titles)
	if not str(_view.get("status", "")).is_empty():
		var pill := PanelContainer.new()
		pill.add_theme_stylebox_override("panel", UI.box(tone[0], tone[1], 999, 1, Vector4(10, 5, 10, 5)))
		pill.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
		pill.add_child(UI.label(str(_view.get("status", "")), 11, tone[2], 800))
		row.add_child(pill)
	_head_box.add_child(row)
	if str(_view.get("statusNote", "")).is_empty():
		return
	_head_box.add_child(PoliticalKit.gap(12))
	_head_box.add_child(PoliticalKit.tone_box(str(_view.get("statusNote", "")), tone[0], tone[1], tone[2], 12, 12, Vector4(11, 10, 11, 10)))
	_head_box.add_child(PoliticalKit.gap(14))
	var tiles := PoliticalKit.grid(3, 9, 9)
	for tile in [["Start date", str(_view.get("scenarioDate", "")) if not str(_view.get("scenarioDate", "")).is_empty() else "Not set"], ["Polities", str(int(_view.get("polityCount", 0)))], ["Political actors", str(int(_view.get("actorCount", 0)))]]:
		var parts := PoliticalKit.box(Color(1, 1, 1, 0.035), Color(0, 0, 0, 0), 12, Vector4(10, 10, 10, 10), 2)
		var column: VBoxContainer = parts[1]
		column.add_child(UI.label(str(tile[0]).to_upper(), 10, Color(1, 1, 1, 0.45)))
		column.add_child(UI.label(str(tile[1]), 13, UI.WHITE, 700))
		tiles.add_child(parts[0])
	_head_box.add_child(tiles)


func _render_buttons() -> void:
	EditorKit.clear(_buttons_box)
	if str(_view.get("statusNote", "")).is_empty():
		return
	_buttons_box.add_child(PoliticalKit.gap(14))
	var row := EditorKit.flow(9)
	if bool(_view.get("showGenerate", false)):
		var generate := PoliticalKit.pill_button(str(_view.get("generateLabel", "")), "raised")
		generate.custom_minimum_size.x = 184
		PoliticalKit.set_enabled(generate, not bool(_view.get("generateDisabled", false)), 0.55)
		generate.pressed.connect(func() -> void: _call("editor.politics.gen.run", {"retryDeferred": bool(_view.get("retryDeferred", false))}, true))
		row.add_child(generate)
	var apply := PoliticalKit.pill_button(str(_view.get("applyLabel", "")), "green")
	apply.custom_minimum_size.x = 168
	PoliticalKit.set_enabled(apply, not bool(_view.get("applyDisabled", true)), 0.5)
	apply.pressed.connect(func() -> void: _call("editor.politics.gen.apply"))
	row.add_child(apply)
	if bool(_view.get("showPause", false)):
		var pause := PoliticalKit.pill_button("Pause", "red")
		pause.pressed.connect(func() -> void:
			if _running_id != 0:
				_engine.cancel(_running_id))
		row.add_child(pause)
	_buttons_box.add_child(row)
	_buttons_box.add_child(PoliticalKit.gap(7))
	_buttons_box.add_child(PoliticalKit.text(str(_view.get("hint", "")), 11, Color(1, 1, 1, 0.52)))


func _tool_button(text: String, enabled: bool, action: Callable, kind := "plain") -> Button:
	var node := PoliticalKit.pill_button(text, kind)
	PoliticalKit.set_enabled(node, enabled, 0.55)
	node.pressed.connect(func() -> void: action.call())
	return node


func _render_tools() -> void:
	for child in _tools_flow.get_children():
		if child in _settings_nodes:
			continue
		_tools_flow.remove_child(child)
		child.queue_free()
	_quiet_settings = true
	var budget := str(int(_view.get("callBudget", 20)))
	if _budget_input.text != budget and not _budget_input.has_focus():
		_budget_input.text = budget
	var settings_enabled := not bool(_view.get("settingsDisabled", false))
	_budget_input.editable = settings_enabled
	_mode_select.clear()
	var modes: Array = _view.get("modes", [])
	for option in modes:
		var pair: Array = option
		_mode_select.add_item(str(pair[1]))
		_mode_select.set_item_metadata(_mode_select.item_count - 1, str(pair[0]))
		if str(pair[0]) == str(_view.get("mode", "")):
			_mode_select.select(_mode_select.item_count - 1)
	_mode_select.disabled = not settings_enabled
	_roster_check.button_pressed = bool(_view.get("allowRosterExpansion", false))
	_roster_check.disabled = not settings_enabled
	_quiet_settings = false
	_mode_note.text = str(_view.get("modeDescription", ""))
	var tools_enabled := not bool(_view.get("toolsDisabled", false))
	_tools_flow.add_child(_tool_button("Generate Missing Politics", tools_enabled, func() -> void: _call("editor.politics.gen.generate", {"test": false}, true)))
	_tools_flow.add_child(_tool_button("Repair Governing Alignment", tools_enabled, func() -> void: _call("editor.politics.gen.repair", {}, true)))
	_tools_flow.add_child(_tool_button("Test 15 Polities", tools_enabled, func() -> void: _call("editor.politics.gen.generate", {"test": true}, true)))
	_tools_flow.add_child(_tool_button("Restore Run Log", tools_enabled, _restore_run_log))
	if bool(_view.get("showRecheck", false)):
		_tools_flow.add_child(_tool_button("Re-check Timeline Canon", not bool(_view.get("recheckDisabled", false)), func() -> void: _call("editor.politics.gen.recheck", {"rows": _row_edits()}, true)))
	if bool(_view.get("showRunLog", false)):
		_tools_flow.add_child(_tool_button("Download Run Log", true, func() -> void: _save_file("runLog")))
	if bool(_view.get("showRetryNote", false)):
		var note := UI.label("Use Continue Generation above to retry unfinished polities.", 11, Color(1, 1, 1, 0.5))
		note.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		_tools_flow.add_child(note)
	if bool(_view.get("hasCheckpoint", false)):
		_tools_flow.add_child(_tool_button("Download Generation Diagnostic", true, func() -> void: _save_file("v2Diagnostic")))
		_tools_flow.add_child(_tool_button("Export Checkpoint", not bool(_view.get("exportDisabled", false)), func() -> void: _save_file("checkpoint")))


func _restore_run_log() -> void:
	var source := await EditorKit.pick_file(_host(), false, "", PackedStringArray(["*.json ; JSON"]))
	if source.is_empty():
		return
	_call("editor.politics.gen.restore", {"path": source})


func _save_file(kind: String) -> void:
	var files: Dictionary = _view.get("files", {})
	var name := str(files.get(kind, ""))
	if name.is_empty():
		return
	var target := await EditorKit.pick_file(_host(), true, name, PackedStringArray(["*.json ; JSON"]))
	if target.is_empty():
		return
	_call("editor.politics.gen.save", {"kind": kind, "path": target, "rows": _row_edits()})


func _amber(text: String) -> PanelContainer:
	return PoliticalKit.tone_box(text, Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.11), Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.28), PoliticalKit.AMBER_INK, 12, 12, Vector4(10, 10, 10, 10))


func _render_status() -> void:
	EditorKit.clear(_status_box)
	if bool(_view.get("dateMismatch", false)):
		_status_box.add_child(PoliticalKit.gap(11))
		_status_box.add_child(_amber(str(_view.get("dateMismatchNote", ""))))
	var live: Variant = _view.get("live")
	if live is Dictionary:
		var info: Dictionary = live
		_status_box.add_child(PoliticalKit.gap(11))
		var parts := PoliticalKit.box(Color(1, 1, 1, 0.025), Color(1, 1, 1, 0.08), 12, Vector4(10, 10, 10, 10), 7)
		var column: VBoxContainer = parts[1]
		var head := HBoxContainer.new()
		head.add_theme_constant_override("separation", 10)
		var ready_label := UI.label(str(info.get("readyText", "")), 11, Color(1, 1, 1, 0.76), 700)
		ready_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		head.add_child(ready_label)
		head.add_child(UI.label(str(info.get("requestsText", "")), 11, Color(1, 1, 1, 0.52)))
		column.add_child(head)
		column.add_child(PoliticalKit.Bar.new(float(info.get("percent", 0))))
		for line_text in (info.get("lines", []) as Array):
			column.add_child(PoliticalKit.text(str(line_text), 11, Color(1, 1, 1, 0.5)))
		_status_box.add_child(parts[0])
	var batch: Variant = _view.get("batch")
	if batch is Dictionary:
		var info: Dictionary = batch
		_status_box.add_child(PoliticalKit.gap(11))
		var parts := PoliticalKit.box(Color(1, 1, 1, 0.025), Color(1, 1, 1, 0.08), 12, Vector4(10, 10, 10, 10), 7)
		var column: VBoxContainer = parts[1]
		var head := HBoxContainer.new()
		head.add_theme_constant_override("separation", 10)
		var resolved := UI.label(str(info.get("resolvedText", "")), 11, Color(1, 1, 1, 0.76), 700)
		resolved.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		head.add_child(resolved)
		head.add_child(UI.label(str(info.get("percentText", "")), 11, Color(1, 1, 1, 0.52)))
		column.add_child(head)
		column.add_child(PoliticalKit.Bar.new(float(info.get("percent", 0))))
		for line_text in (info.get("lines", []) as Array):
			column.add_child(PoliticalKit.text(str(line_text), 11, Color(1, 1, 1, 0.5)))
		var sample: Variant = info.get("sample")
		if sample is Dictionary:
			var sample_info: Dictionary = sample
			var reject := PoliticalKit.box(Color(127 / 255.0, 29 / 255.0, 29 / 255.0, 0.13), Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.18), 10, Vector4(8, 8, 8, 8), 2)
			var reject_column: VBoxContainer = reject[1]
			reject_column.add_child(PoliticalKit.text(str(sample_info.get("title", "")), 11, PoliticalKit.RED_INK, 700))
			for entry in (sample_info.get("errors", []) as Array):
				reject_column.add_child(PoliticalKit.text("• " + str(entry), 11, PoliticalKit.RED_INK))
			column.add_child(reject[0])
		_status_box.add_child(parts[0])
	if not str(_view.get("progress", "")).is_empty():
		_status_box.add_child(PoliticalKit.gap(11))
		_status_box.add_child(PoliticalKit.text(str(_view.get("progress", "")), 12, Color(1, 1, 1, 0.62)))
	if bool(_view.get("persistenceWarning", false)):
		_status_box.add_child(PoliticalKit.gap(11))
		_status_box.add_child(_amber("This device did not save the latest Political World progress. Reloading now would lose the work done since the last save."))
	if not str(_view.get("error", "")).is_empty():
		_status_box.add_child(PoliticalKit.gap(11))
		_status_box.add_child(PoliticalKit.tone_box(str(_view.get("error", "")), Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.12), Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.3), PoliticalKit.RED_INK, 12, 12, Vector4(10, 10, 10, 10)))
	if not str(_view.get("lastApplied", "")).is_empty():
		_status_box.add_child(PoliticalKit.gap(11))
		_status_box.add_child(PoliticalKit.tone_box(str(_view.get("lastApplied", "")), Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.1), Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.24), PoliticalKit.GREEN_INK, 12, 12, Vector4(10, 10, 10, 10)))
	var card: Variant = _view.get("checkpointCard")
	if card is Dictionary:
		_render_checkpoint_card(card)
	var pipeline: Variant = _view.get("pipelineCard")
	if pipeline is Dictionary:
		_render_pipeline_card(pipeline)


func _render_checkpoint_card(card: Dictionary) -> void:
	var ready := bool(card.get("ready", false))
	_status_box.add_child(PoliticalKit.gap(13))
	var parts := PoliticalKit.box(Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.08) if ready else Color(1, 1, 1, 0.035), Color(74 / 255.0, 222 / 255.0, 128 / 255.0, 0.24) if ready else PoliticalKit.GREY_BORDER, 12, Vector4(12, 12, 12, 12), 5)
	var column: VBoxContainer = parts[1]
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 10)
	var title := UI.label(str(card.get("title", "")), 12, PoliticalKit.GREEN_INK if ready else PoliticalKit.GREY_TEXT, 800)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(title)
	head.add_child(UI.label(str(card.get("badge", "")), 11, Color(1, 1, 1, 0.48)))
	column.add_child(head)
	for line_text in (card.get("lines", []) as Array):
		column.add_child(PoliticalKit.text(str(line_text), 11, Color(1, 1, 1, 0.64)))
	if not str(card.get("partial", "")).is_empty():
		column.add_child(PoliticalKit.text(str(card.get("partial", "")), 11, Color(1, 1, 1, 0.64)))
	if ready:
		column.add_child(PoliticalKit.text(str(card.get("readyText", "")), 11, PoliticalKit.GREEN_INK))
	else:
		column.add_child(PoliticalKit.text(str(card.get("pausedText", "")), 11, Color(1, 1, 1, 0.55)))
		if not str(card.get("unfinished", "")).is_empty():
			column.add_child(PoliticalKit.text(str(card.get("unfinished", "")), 11, Color(1, 1, 1, 0.55)))
		if bool(card.get("ceiling", false)):
			var actions := EditorKit.flow(7)
			var disabled := bool(card.get("actionsDisabled", false))
			actions.add_child(_tool_button("Allow more AI calls", not disabled, func() -> void: _call("editor.politics.gen.allowMore")))
			actions.add_child(_tool_button(str(card.get("applyCompleteLabel", "Apply what is complete")), not bool(card.get("applyCompleteDisabled", false)), func() -> void: _call("editor.politics.gen.applyComplete")))
			actions.add_child(_tool_button("Discard for good" if _discard_armed else "Discard checkpoint", not disabled, _press_discard, "red" if _discard_armed else "plain"))
			column.add_child(PoliticalKit.gap(3))
			column.add_child(actions)
			column.add_child(PoliticalKit.text("Apply what is complete writes only the polities that passed every check into the scenario, with the institutions and standing agreements once all of them are done. Everything else stays in this checkpoint for a later run.", 11, Color(1, 1, 1, 0.55)))
	_status_box.add_child(parts[0])


func _press_discard() -> void:
	if not _discard_armed:
		_discard_armed = true
		_discard_serial += 1
		var serial := _discard_serial
		_render()
		await get_tree().create_timer(4.0).timeout
		if serial == _discard_serial and _discard_armed and is_inside_tree():
			_discard_armed = false
			_render()
		return
	_discard_armed = false
	_discard_serial += 1
	_call("editor.politics.gen.discard")


func _render_pipeline_card(card: Dictionary) -> void:
	var blocked := bool(card.get("blocked", false))
	_status_box.add_child(PoliticalKit.gap(13))
	var parts := PoliticalKit.box(Color(127 / 255.0, 29 / 255.0, 29 / 255.0, 0.12) if blocked else Color(1, 1, 1, 0.035), Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.28) if blocked else PoliticalKit.GREY_BORDER, 12, Vector4(12, 12, 12, 12), 5)
	var column: VBoxContainer = parts[1]
	column.add_child(UI.label("Political World review", 12, PoliticalKit.RED_INK if blocked else PoliticalKit.GREY_TEXT, 800))
	column.add_child(PoliticalKit.text(str(card.get("summary", "")), 11, Color(1, 1, 1, 0.64)))
	if not str(card.get("catalog", "")).is_empty():
		column.add_child(PoliticalKit.text(str(card.get("catalog", "")), 11, PoliticalKit.GREY_MUTED))
	if blocked:
		var box := PoliticalKit.box(Color(127 / 255.0, 29 / 255.0, 29 / 255.0, 0.18), Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.25), 10, Vector4(9, 9, 9, 9), 2)
		var box_column: VBoxContainer = box[1]
		box_column.add_child(PoliticalKit.text("Apply to Scenario is blocked.", 11, PoliticalKit.RED_INK, 700))
		for entry in (card.get("blockingErrors", []) as Array):
			box_column.add_child(PoliticalKit.text("• " + str(entry), 11, PoliticalKit.RED_INK))
		box_column.add_child(PoliticalKit.text("This older combined run cannot be finished. Generate Political World builds the Political World again and saves its progress as it goes.", 11, PoliticalKit.RED_INK))
		column.add_child(box[0])
	else:
		column.add_child(PoliticalKit.tone_box("Preview ready. No scenario data has been written yet. Review this summary, then use Apply to Scenario above.", Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.09), Color(74 / 255.0, 222 / 255.0, 128 / 255.0, 0.2), PoliticalKit.GREEN_INK, 11, 10, Vector4(9, 9, 9, 9)))
	var download := PoliticalKit.pill_button("Download Combined Diagnostic", "faint")
	download.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	download.pressed.connect(func() -> void: _save_file("diagnostic"))
	column.add_child(download)
	_status_box.add_child(parts[0])


func _build_rows_box() -> void:
	_rows_box.add_child(PoliticalKit.gap(15))
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 8)
	_filter_input = LineEdit.new()
	_filter_input.placeholder_text = "Filter polities…"
	_filter_input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_filter_input.custom_minimum_size.y = 35
	var style := UI.box(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.1), 10, 1, Vector4(10, 4, 10, 4))
	_filter_input.add_theme_stylebox_override("normal", style)
	_filter_input.add_theme_stylebox_override("focus", UI.box(Color(1, 1, 1, 0.07), Color(1, 1, 1, 0.24), 10, 1, Vector4(10, 4, 10, 4)))
	_filter_input.add_theme_font_override("font", UI.font(400))
	_filter_input.add_theme_font_size_override("font_size", 13)
	_filter_input.add_theme_color_override("font_color", PoliticalKit.INPUT_INK)
	_filter_input.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.38))
	_filter_input.text_changed.connect(func(value: String) -> void:
		_filter = value
		_render_rows())
	head.add_child(_filter_input)
	_apply_selected = PoliticalKit.pill_button("Apply Selected (0)", "green_soft")
	_apply_selected.pressed.connect(func() -> void: _call("editor.politics.gen.applySelected", {"rows": _row_edits()}))
	head.add_child(_apply_selected)
	_rows_box.add_child(head)
	_rows_box.add_child(PoliticalKit.gap(10))
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.custom_minimum_size.y = 0
	_rows_list = VBoxContainer.new()
	_rows_list.add_theme_constant_override("separation", 7)
	_rows_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(_rows_list)
	_rows_list.minimum_size_changed.connect(func() -> void:
		scroll.custom_minimum_size.y = minf(_rows_list.get_combined_minimum_size().y, 480.0))
	_rows_box.add_child(scroll)


func _selected_count() -> int:
	var count := 0
	for row in _rows:
		var entry: Dictionary = row
		if str(entry.get("status", "")) == "valid" and bool(entry.get("selected", false)):
			count += 1
	return count


func _update_rows_header() -> void:
	if not _rows_box:
		return
	_rows_box.visible = bool(_view.get("showRows", false)) and not _rows.is_empty()
	var applying := bool(_view.get("applying", false))
	_apply_selected.text = "Applying…" if applying else "Apply Selected (%d)" % _selected_count()
	PoliticalKit.set_enabled(_apply_selected, _selected_count() > 0 and not applying, 0.5)


func _render_rows() -> void:
	EditorKit.clear(_rows_list)
	_update_rows_header()
	var needle := PoliticalKit.clean(_filter).to_lower()
	for row in _rows:
		var entry: Dictionary = row
		if not needle.is_empty() and not str(entry.get("polityKey", "")).to_lower().contains(needle):
			continue
		_rows_list.add_child(_row_card(entry))


func _row_card(row: Dictionary) -> Control:
	var key := str(row.get("polityKey", ""))
	var failed := str(row.get("status", "")) == "failed"
	var expanded := _expanded == key
	var parts := PoliticalKit.box(Color(127 / 255.0, 29 / 255.0, 29 / 255.0, 0.16) if failed else Color(1, 1, 1, 0.035), Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.25) if failed else Color(1, 1, 1, 0.08), 13, Vector4(10, 10, 10, 10), 0)
	var column: VBoxContainer = parts[1]
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 9)
	if not failed:
		var pick := PoliticalKit.check("", bool(row.get("selected", false)), func(on: bool) -> void:
			row["selected"] = on
			_update_rows_header())
		pick.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		head.add_child(pick)
	var toggle := Button.new()
	toggle.flat = true
	toggle.focus_mode = Control.FOCUS_NONE
	toggle.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	toggle.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var empty := StyleBoxEmpty.new()
	for state in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
		toggle.add_theme_stylebox_override(state, empty)
	var texts := VBoxContainer.new()
	texts.add_theme_constant_override("separation", 3)
	texts.mouse_filter = Control.MOUSE_FILTER_IGNORE
	texts.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var top := HBoxContainer.new()
	top.add_theme_constant_override("separation", 6)
	top.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var name_label := UI.label(key, 13, UI.WHITE, 800)
	name_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(name_label)
	var right_text := "failed" if failed else "%s · %s" % [str(row.get("depth", "")), str(row.get("confidence", ""))]
	top.add_child(UI.label(right_text.to_upper(), 10, PoliticalKit.RED_SOFT if failed else Color(1, 1, 1, 0.48)))
	texts.add_child(top)
	var summary: Label = null
	if not failed:
		summary = UI.label(EditorPoliticalGeneration.patch_summary(str(row.get("actorPatchText", ""))), 11, Color(1, 1, 1, 0.5))
		summary.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		summary.clip_text = true
		texts.add_child(summary)
	toggle.add_child(texts)
	toggle.custom_minimum_size.y = 36 if not failed else 18
	toggle.pressed.connect(func() -> void:
		_expanded = "" if _expanded == key else key
		_render_rows())
	head.add_child(toggle)
	column.add_child(head)
	if expanded:
		column.add_child(PoliticalKit.gap(10))
		var needs: Array = row.get("needs", [])
		var needs_text := ", ".join(PackedStringArray(needs.map(func(entry: Variant) -> String: return str(entry))))
		column.add_child(PoliticalKit.text("Needs: " + (needs_text if not needs_text.is_empty() else "none"), 11, Color(1, 1, 1, 0.5)))
		var errors: Array = row.get("sourceErrors", [])
		if not errors.is_empty():
			column.add_child(PoliticalKit.gap(7))
			for entry in errors:
				column.add_child(PoliticalKit.text("• " + str(entry), 11, PoliticalKit.RED_INK))
		if not failed:
			column.add_child(PoliticalKit.gap(9))
			var on_patch := func(value: String) -> void:
				row["actorPatchText"] = value
				row["sourceErrors"] = []
				if summary:
					summary.text = EditorPoliticalGeneration.patch_summary(value)
			var editor := PoliticalKit.area(str(row.get("actorPatchText", "")), 208, on_patch, "", true, 12)
			editor.add_theme_stylebox_override("normal", UI.box(Color(0, 0, 0, 0.2), Color(1, 1, 1, 0.1), 12, 1, Vector4(12, 12, 12, 12)))
			editor.add_theme_stylebox_override("focus", UI.box(Color(0, 0, 0, 0.24), Color(1, 1, 1, 0.22), 12, 1, Vector4(12, 12, 12, 12)))
			editor.add_theme_color_override("font_color", Color("#e5e7eb"))
			editor.tooltip_text = "%s political actor patch" % key
			column.add_child(editor)
			column.add_child(PoliticalKit.gap(8))
			var on_expand := func(on: bool) -> void:
				row["allowEntityExpansion"] = on
			column.add_child(PoliticalKit.check("Allow this reviewed patch to add new parties/power blocs to an already-authored roster.", bool(row.get("allowEntityExpansion", false)), on_expand, 11, Color(1, 1, 1, 0.62)))
	return parts[0]


static func patch_summary(text: String) -> String:
	var parsed: Array = PoliticalKit.parse_json(text)
	if not bool(parsed[0]):
		return "Invalid JSON edit"
	var patch: Variant = parsed[1]
	var dict: Dictionary = patch if patch is Dictionary else {}
	var system_value: Dictionary = dict.get("politicalSystem", {}) if dict.get("politicalSystem") is Dictionary else {}
	var system_type: Variant = system_value.get("type")
	var system := PoliticalKit.clean(system_type if PoliticalKit.js_truthy(system_type) else system_value.get("representation"))
	var parties := (dict.get("parties") as Array).size() if dict.get("parties") is Array else 0
	var blocs := (dict.get("powerBlocs") as Array).size() if dict.get("powerBlocs") is Array else 0
	var government: Dictionary = dict.get("government", {}) if dict.get("government") is Dictionary else {}
	var hog: Variant = government.get("headOfGovernment")
	var leader: Variant = dict.get("leader")
	var head_value: Variant = null
	if hog is Dictionary and PoliticalKit.js_truthy((hog as Dictionary).get("name")):
		head_value = (hog as Dictionary).get("name")
	elif PoliticalKit.js_truthy(hog):
		head_value = hog
	elif leader is Dictionary and PoliticalKit.js_truthy((leader as Dictionary).get("name")):
		head_value = (leader as Dictionary).get("name")
	else:
		head_value = leader
	var head := PoliticalKit.clean(head_value)
	var ruling: PackedStringArray = []
	if government.get("rulingPartyIds") is Array:
		for entry in (government["rulingPartyIds"] as Array):
			var value := PoliticalKit.clean(entry)
			if not value.is_empty():
				ruling.append(value)
	var coalition: PackedStringArray = []
	if government.get("coalitionPartyIds") is Array:
		for entry in (government["coalitionPartyIds"] as Array):
			var value := PoliticalKit.clean(entry)
			if not value.is_empty():
				coalition.append(value)
	var pieces: PackedStringArray = []
	if not system.is_empty():
		pieces.append(system)
	if not head.is_empty():
		pieces.append("leader: " + head)
	if not ruling.is_empty():
		pieces.append("government: " + ", ".join(ruling))
	if not coalition.is_empty():
		pieces.append("coalition: " + ", ".join(coalition))
	if parties > 0:
		pieces.append("%d parties" % parties)
	if blocs > 0:
		pieces.append("%d blocs" % blocs)
	var joined := " · ".join(pieces)
	return joined if not joined.is_empty() else "Structured political patch"
