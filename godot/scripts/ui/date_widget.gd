class_name DateWidget
extends Control

signal panel_changed(name: String)
signal turn_landed(view: Dictionary)
signal open_interactive
signal busy_changed(busy: bool)

const JUMPS := [["6 hours", 0.25], ["1 day", 1.0], ["3 days", 3.0], ["1 week", 7.0], ["1 month", 30.0], ["3 months", 90.0], ["6 months", 180.0], ["1 year", 365.0]]
const UNITS := [["hours", 1.0 / 24.0], ["days", 1.0], ["weeks", 7.0], ["months", 30.0], ["years", 365.0]]
const REQUEST_TEXTS := {
	"waiting": "Waiting for the model to answer…",
	"thinking": "The model is thinking…",
	"writing": "The model is writing its answer…",
	"agent": "Waiting for your Agent. Type /answer in your Claude Code, Codex, OpenCode or Antigravity CLI, opened in the Agent folder.",
}
const REQUEST_STILL_OPEN := "Still working: a slow model can take several minutes. The request is still open."
const HELD_NOTICE := {
	"segment": {"retry": "Retry the segment", "retrying": "Retrying the segment…", "show_progress": true, "still_failing": "that segment still did not come back. Retrying again may help if the problem was temporary; otherwise discard the turn and run it again, perhaps as a shorter skip."},
	"board": {"retry": "Retry the board", "retrying": "Retrying the board…", "still_failing": "the board still did not update. Retrying again may help if the problem was temporary; otherwise discard the turn and run it again."},
	"checks": {"retry": "Retry the checks", "retrying": "Retrying the checks…", "show_progress": true, "can_continue": true, "still_failing": "the checks still did not come back. Retrying again may help if the model is only busy; otherwise continue without them, or discard the turn."},
	"events": {"retry": "Retry the failed events", "retrying": "Retrying the failed events…", "show_progress": true, "player_events": true, "still_failing": "some of your events still failed. Retry them again, retry the whole skip, or keep it and move on."},
}
const AMBER_BG := Color(120 / 255.0, 53 / 255.0, 15 / 255.0, 0.28)
const AMBER_BORDER := Color(251 / 255.0, 191 / 255.0, 36 / 255.0, 0.35)
const AMBER_INK := Color("#fde68a")
const CONNECTOR := Color(1, 1, 1, 0.1)

var engine: EngineLink
var map_view: MapView
var war: Node
var timeline: PanelFrame
var events_panel: PanelFrame
var status := {}
var open_panel := ""
var is_loading := false
var skip_in_flight := false
var is_retrying_held := false
var is_applying_parked := false
var progress_label := ""
var progress_started_at := 0
var request_state := {}
var live_cards: Array = []
var live_range := {}
var error := ""
var fallback_warning := ""
var restore_missing := false
var held := {}
var parked_held := false
var visible_count := 1
var latest := {}
var latest_count := 0
var turn_index := 0
var older := {}
var offer: Variant = null
var scene_in_progress := false
var tag_order: Array = []
var open_map_changes := {}
var category := {"record": "", "tag": ""}
var intervene := {"record": "", "state": "idle"}
var rollback_state := "idle"
var report_label := ""
var custom_value := ""
var custom_unit := 1
var current_call := 0

var _back_button: Button
var _forward_button: Button
var _forward_spinner: Spinner
var _country_label: Label
var _date_label: Label
var _progress_rows: Array[Dictionary] = []
var _custom_landing: Label
var _custom_go: Button
var _clock: Timer
var _caption_timer: Timer
var _stage_seq := 0
var _staged := false
var _camera_event := ""
var _events_scroll_anchor: Control = null
var _pill: GlassPanel
var _pill_tween: Tween
var _focus_event := ""


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	timeline = PanelFrame.new("Timeline")
	timeline.closed.connect(func() -> void: set_panel(""))
	add_child(timeline)
	events_panel = PanelFrame.new("Events")
	events_panel.closed.connect(func() -> void: set_panel(""))
	add_child(events_panel)
	_build_pill()
	_clock = Timer.new()
	_clock.wait_time = 1.0
	_clock.timeout.connect(_tick)
	add_child(_clock)
	_clock.start()
	_caption_timer = Timer.new()
	_caption_timer.wait_time = 60.0
	_caption_timer.timeout.connect(func() -> void:
		if visible and not is_loading:
			await refresh_status()
			_render_timeline())
	add_child(_caption_timer)
	_caption_timer.start()


func setup(link: EngineLink, map: MapView) -> void:
	engine = link
	map_view = map
	engine.engine_event.connect(_on_engine_event)


func busy() -> bool:
	return is_loading or is_retrying_held or is_applying_parked


func _build_pill() -> void:
	var pill := GlassPanel.new(UI.HUD_BG_STRONG, 14, Vector4(8, 0, 8, 0))
	_pill = pill
	pill.anchor_left = 1.0
	pill.anchor_right = 1.0
	pill.offset_left = -296
	pill.offset_right = -8
	pill.offset_top = 8
	pill.offset_bottom = 64
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 4)
	_back_button = _arrow("«", "Events")
	_back_button.pressed.connect(func() -> void: toggle_panel("history"))
	row.add_child(_back_button)
	var middle := HBoxContainer.new()
	middle.alignment = BoxContainer.ALIGNMENT_CENTER
	middle.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	middle.add_theme_constant_override("separation", 8)
	middle.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_country_label = UI.label("", 13, UI.HUD_BLUE, 700, "Arial", 1)
	_country_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	middle.add_child(_country_label)
	_date_label = UI.label("Loading...", 15, Color(1, 1, 1, 0.94))
	_date_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	middle.add_child(_date_label)
	row.add_child(middle)
	_forward_button = _arrow("»", "Timeline")
	_forward_button.pressed.connect(func() -> void:
		if is_loading:
			set_panel("skip")
			return
		toggle_panel("skip"))
	_forward_spinner = Spinner.new(15, Color(1, 1, 1, 0.28))
	_forward_spinner.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	_forward_spinner.visible = false
	_forward_button.add_child(_forward_spinner)
	row.add_child(_forward_button)
	pill.add_child(row)
	add_child(pill)


func _arrow(glyph: String, tip: String) -> Button:
	var button := Button.new()
	button.text = glyph
	button.flat = true
	button.focus_mode = Control.FOCUS_NONE
	button.tooltip_text = tip
	button.custom_minimum_size = Vector2(32, 32)
	button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.add_theme_font_override("font", UI.font(900))
	button.add_theme_font_size_override("font_size", 24)
	button.add_theme_color_override("font_color", Color(1, 1, 1, 0.7))
	button.add_theme_color_override("font_hover_color", UI.WHITE)
	button.add_theme_color_override("font_pressed_color", UI.WHITE)
	button.add_theme_color_override("font_focus_color", Color(1, 1, 1, 0.7))
	for state in ["normal", "hover", "pressed", "focus"]:
		button.add_theme_stylebox_override(state, StyleBoxEmpty.new())
	return button


func _render_pill() -> void:
	var country := str(status.get("playerCountry", ""))
	_country_label.text = country.to_upper()
	_country_label.clip_text = false
	var wide := UI.font(700, "Arial", 1).get_string_size(_country_label.text, HORIZONTAL_ALIGNMENT_LEFT, -1, 13).x
	if wide > 120.0:
		_country_label.clip_text = true
		_country_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		_country_label.custom_minimum_size.x = 120
	else:
		_country_label.text_overrun_behavior = TextServer.OVERRUN_NO_TRIMMING
		_country_label.custom_minimum_size.x = 0
	_country_label.visible = not country.is_empty()
	_date_label.text = str(status.get("displayDate", "Loading..."))
	_back_button.add_theme_color_override("font_color", Color("#bfdbfe") if open_panel == "history" else Color(1, 1, 1, 0.7))
	_forward_button.add_theme_color_override("font_color", Color("#e4e4e7") if open_panel == "skip" else Color(1, 1, 1, 0.7))
	_forward_spinner.visible = is_loading
	_forward_button.text = "" if is_loading else "»"


func enter_game() -> void:
	is_loading = false
	skip_in_flight = false
	is_retrying_held = false
	is_applying_parked = false
	error = ""
	fallback_warning = ""
	restore_missing = false
	held = {}
	parked_held = false
	open_map_changes = {}
	turn_index = 0
	older = {}
	_camera_event = ""
	_staged = false
	set_panel("", true)
	await refresh_status()
	var on_open: Variant = status.get("held")
	if typeof(on_open) == TYPE_DICTIONARY:
		held = {"kind": str(on_open.get("kind", "")), "message": str(on_open.get("message", "")), "failures": on_open.get("failures"), "retries": 0}
	parked_held = bool(status.get("parked", false))
	await load_history()
	var entered := await engine.request("turn.enter")
	if entered.get("ok", false):
		var parked := str(entered["result"].get("parked", "none"))
		if parked == "discarded":
			parked_held = false
			error = str(entered["result"].get("note", ""))
			set_panel("skip")
		elif parked == "kept":
			parked_held = true
			set_panel("skip")
		else:
			parked_held = false
	_render_all()


func refresh_status() -> void:
	var reply := await engine.request("turn.status")
	if reply.get("ok", false):
		status = reply["result"]
		scene_in_progress = bool(status.get("sceneInProgress", false))
	_render_pill()


func load_history(carry: Variant = null) -> void:
	var args := {"index": 0}
	if carry != null:
		args["carry"] = carry
	var reply := await engine.request("turn.history", args)
	if not reply.get("ok", false):
		return
	var result: Dictionary = reply["result"]
	latest = result.get("turn", {}) if typeof(result.get("turn")) == TYPE_DICTIONARY else {}
	latest_count = int(result.get("count", 0))
	offer = result.get("offer")
	scene_in_progress = bool(result.get("sceneInProgress", false))
	tag_order = result.get("tagOrder", [])
	visible_count = max(1, int(result.get("revealed", 1)))
	if turn_index > 0:
		await _load_older(turn_index)


func _load_older(index: int) -> void:
	if index <= 0:
		older = {}
		return
	var reply := await engine.request("turn.history", {"index": index})
	if reply.get("ok", false) and typeof(reply["result"].get("turn")) == TYPE_DICTIONARY:
		older = reply["result"]["turn"]
	else:
		older = {}


func toggle_panel(name: String) -> void:
	if is_loading and name != "skip" and not (name == "history" and skip_in_flight):
		return
	set_panel("" if open_panel == name else name)


func set_panel(name: String, quiet := false) -> void:
	var changed := name != open_panel
	open_panel = name
	if name != "history" and turn_index != 0:
		turn_index = 0
		older = {}
	timeline.set_open(name == "skip")
	events_panel.set_open(name == "history")
	if not quiet:
		_render_pill()
		if name == "skip":
			_render_timeline()
		elif name == "history":
			_render_events()
		_after_reveal_change()
	if changed:
		if _war_ready():
			war.call("show_every_troop", "events", name == "history")
		panel_changed.emit(name)


func _war_ready() -> bool:
	return war != null and is_instance_valid(war) and war.has_method("stage")


func _watch_strikes(event: Dictionary) -> void:
	if _war_ready():
		war.call("replay_strikes", str(event.get("id", "")))


func close_panels() -> void:
	set_panel("")


func open_events() -> void:
	set_panel("history")


func _render_all() -> void:
	_render_pill()
	_render_timeline()
	_render_events()
	_after_reveal_change()


func _tick() -> void:
	for row in _progress_rows:
		var clock: Label = row["clock"]
		if is_instance_valid(clock):
			clock.text = _elapsed()
			clock.visible = progress_started_at > 0


func _elapsed() -> String:
	if progress_started_at <= 0:
		return ""
	var seconds := int((Time.get_ticks_msec() - progress_started_at) / 1000)
	return "%d:%02d" % [seconds / 60, seconds % 60]


func _on_engine_event(name: String, data: Variant) -> void:
	if name == "turn.request":
		request_state = data if typeof(data) == TYPE_DICTIONARY else {}
		_refresh_progress_rows()
		return
	if typeof(data) != TYPE_DICTIONARY or int(data.get("call", -1)) != current_call or current_call == 0:
		return
	if name == "turn.progress":
		var progress: Variant = data.get("progress")
		if typeof(progress) == TYPE_DICTIONARY and not str(progress.get("label", "")).is_empty():
			var detail := str(progress.get("detail", ""))
			progress_label = "%s…%s" % [str(progress["label"]), (" (%s)" % detail) if not detail.is_empty() else ""]
		else:
			progress_label = ""
		_refresh_progress_rows()
	elif name == "turn.live":
		live_range = data
		if open_panel == "history":
			_render_events()
	elif name == "turn.events":
		live_cards = data.get("events", [])
		if open_panel == "history":
			_render_events()
			_after_reveal_change()


func _refresh_progress_rows() -> void:
	for row in _progress_rows:
		var label: Label = row["label"]
		if not is_instance_valid(label):
			continue
		var fallback: String = row.get("fallback", "")
		label.text = progress_label if not progress_label.is_empty() else (fallback if not fallback.is_empty() else "Simulating…")
		label.custom_minimum_size.x = minf(UI.font(400).get_string_size(label.text, HORIZONTAL_ALIGNMENT_LEFT, -1, 12).x + 2.0, 190.0)
		var activity: VBoxContainer = row["activity"]
		for child in activity.get_children():
			activity.remove_child(child)
			child.queue_free()
		var state := str(request_state.get("state", ""))
		if state.is_empty() or not REQUEST_TEXTS.has(state):
			activity.visible = false
			continue
		activity.visible = true
		var line: String = REQUEST_TEXTS[state]
		if bool(request_state.get("stillWorking", false)):
			line += " " + REQUEST_STILL_OPEN
		var words := EventCards.text(line, 11.5, Color(1, 1, 1, 0.55))
		words.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		activity.add_child(words)
		if state == "agent":
			var buttons := HBoxContainer.new()
			buttons.alignment = BoxContainer.ALIGNMENT_CENTER
			buttons.add_theme_constant_override("separation", 6)
			var open_folder := EventCards.button("Open the Agent folder", Color(1, 1, 1, 0.08), Color(1, 1, 1, 0.18), UI.WHITE, 8, 12, 400, Vector4(11, 4, 11, 4))
			open_folder.pressed.connect(func() -> void: engine.request("turn.agentFolder"))
			buttons.add_child(open_folder)
			if bool(request_state.get("agentBelow", false)):
				var pass_on := EventCards.button("Use API key", Color(1, 1, 1, 0.08), Color(1, 1, 1, 0.18), UI.WHITE, 8, 12, 600, Vector4(11, 4, 11, 4))
				pass_on.pressed.connect(func() -> void: engine.request("turn.agentPassOn"))
				buttons.add_child(pass_on)
			activity.add_child(buttons)
	_tick()


func _progress_row(fallback: String, with_cancel := true) -> Control:
	var holder := EventCards.frame(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.08), 12, Vector4(13, 11, 13, 11))
	var stack := EventCards.column(6)
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 9)
	row.add_child(Spinner.new(15))
	var label := UI.label("", 12, Color(1, 1, 1, 0.75))
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(label)
	var clock := UI.label("", 12, Color(1, 1, 1, 0.5))
	clock.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(clock)
	if with_cancel:
		var cancel := EventCards.button("Cancel", Color(220 / 255.0, 38 / 255.0, 38 / 255.0, 0.18), Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.5), Color("#fecaca"), 8, 12, 600, Vector4(11, 4, 11, 4))
		cancel.pressed.connect(cancel_jump)
		cancel.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(cancel)
	stack.add_child(row)
	var activity := EventCards.column(5)
	activity.visible = false
	stack.add_child(activity)
	holder.add_child(stack)
	_progress_rows.append({"label": label, "clock": clock, "activity": activity, "fallback": fallback})
	return holder


func _connector(parent: Control) -> void:
	var holder := CenterContainer.new()
	var line := ColorRect.new()
	line.color = CONNECTOR
	line.custom_minimum_size = Vector2(2, 20)
	line.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.add_child(line)
	parent.add_child(holder)


func _centered(control: Control) -> Control:
	var holder := CenterContainer.new()
	holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	holder.add_child(control)
	return holder


func _stacked_button(top: String, bottom: String, bg: Color, border: Color, ink: Color, sub_ink: Color, top_size := 14, top_weight := 600) -> Button:
	var node := EventCards.button("", bg, border, ink, 10, 12, 600, Vector4(0, 6, 0, 6), Color(minf(1.0, bg.r + 0.02), minf(1.0, bg.g + 0.02), minf(1.0, bg.b + 0.02), minf(1.0, bg.a + 0.05)))
	node.custom_minimum_size = Vector2(200, 43 if not bottom.is_empty() else 35)
	var stack := VBoxContainer.new()
	stack.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	stack.alignment = BoxContainer.ALIGNMENT_CENTER
	stack.add_theme_constant_override("separation", 0)
	stack.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var first := UI.label(top, top_size, ink, top_weight)
	first.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	stack.add_child(first)
	if not bottom.is_empty():
		var second := UI.label(bottom, 11, sub_ink)
		second.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		stack.add_child(second)
	node.add_child(stack)
	return node


func _render_timeline() -> void:
	if not timeline:
		return
	_prune_rows(timeline)
	timeline.clear_body()
	var body := timeline.body
	var busy_now := is_loading or is_retrying_held
	var blocked := busy_now or scene_in_progress
	var ladder := VBoxContainer.new()
	ladder.add_theme_constant_override("separation", 0)
	ladder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body.add_child(ladder)
	if scene_in_progress:
		ladder.add_child(_centered(_yellow_box("⚡ A scene is in progress. Time stands still until it ends or is set aside.", "", "Return to the scene", 0.1, 0.5)))
		ladder.add_child(_gap(10))
	elif typeof(offer) == TYPE_DICTIONARY and not skip_in_flight:
		ladder.add_child(_centered(_yellow_box("⚡ An interactive event is on offer: ", str(offer.get("title", "")), "Play it out", 0.07, 0.35)))
		ladder.add_child(_gap(10))
	var undo_count := int(status.get("undoCount", 0))
	if undo_count > 0:
		var undo := _stacked_button("↩ Undo last turn", "%d turn%s can be undone" % [undo_count, "" if undo_count == 1 else "s"], Color(180 / 255.0, 83 / 255.0, 9 / 255.0, 0.18), Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.5), Color("#fcd9a8"), Color(252 / 255.0, 211 / 255.0, 77 / 255.0, 0.72), 14, 700)
		if busy_now:
			EventCards.set_busy(undo, true, 0.7)
		undo.pressed.connect(func() -> void:
			if not busy():
				run_undo())
		ladder.add_child(_centered(undo))
		_connector(ladder)
	var today := PanelContainer.new()
	today.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.07), Color(1, 1, 1, 0.28), 999, 2, Vector4(0, 5, 0, 6)))
	today.custom_minimum_size.x = 88
	var today_label := UI.label(str(status.get("datePill", "")), 11, Color("#e4e4e7"), 700, "Arial", 1)
	today_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	today.add_child(today_label)
	ladder.add_child(_centered(today))
	var landings: Array = status.get("landings", [])
	for index in range(JUMPS.size()):
		_connector(ladder)
		var jump: Array = JUMPS[index]
		var node := _stacked_button(str(landings[index]) if index < landings.size() else "", str(jump[0]), Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.18), UI.WHITE, Color("#e4e4e7"))
		if blocked:
			node.modulate.a = 0.7
		var days: float = jump[1]
		node.pressed.connect(func() -> void:
			if not blocked:
				run_jump(days, "jump"))
		ladder.add_child(_centered(node))
	_connector(ladder)
	var auto := EventCards.button("Auto-jump", Color(37 / 255.0, 99 / 255.0, 235 / 255.0, 0.2), Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.45), UI.WHITE, 12, 14, 700, Vector4(11, 9, 11, 9), Color(37 / 255.0, 99 / 255.0, 235 / 255.0, 0.3))
	auto.custom_minimum_size.x = 200
	if blocked:
		auto.modulate.a = 0.72
	auto.pressed.connect(func() -> void:
		if not blocked:
			run_jump(365.0, "auto"))
	ladder.add_child(_centered(auto))
	_connector(ladder)
	ladder.add_child(_centered(_custom_row(blocked)))
	_custom_landing = UI.label("", 12, Color(1, 1, 1, 0.55))
	_custom_landing.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_custom_landing.visible = false
	var landing_holder := MarginContainer.new()
	landing_holder.add_theme_constant_override("margin_top", 5)
	landing_holder.add_child(_custom_landing)
	ladder.add_child(_centered(landing_holder))
	_update_custom_landing()
	ladder.add_child(_centered(_caption()))
	if is_loading:
		var fallback := ""
		if is_retrying_held:
			fallback = str(HELD_NOTICE.get(str(held.get("kind", "")), {}).get("retrying", ""))
		elif is_applying_parked:
			fallback = "Applying the time skip…"
		body.add_child(_progress_row(fallback))
	if not error.is_empty():
		var box := EventCards.frame(Color(127 / 255.0, 29 / 255.0, 29 / 255.0, 0.24), Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.3), 16, Vector4(14, 13, 14, 13))
		box.add_child(EventCards.text(error, 12, Color("#fecaca")))
		body.add_child(box)
	if parked_held:
		body.add_child(_parked_notice())
	if not held.is_empty() and HELD_NOTICE.has(str(held.get("kind", ""))):
		body.add_child(_held_notice())
	var suggestion: Variant = status.get("modeSuggestion")
	if typeof(suggestion) == TYPE_DICTIONARY and not busy():
		body.add_child(_mode_suggestion(suggestion))
	_refresh_progress_rows()


func _gap(height: int) -> Control:
	var gap := Control.new()
	gap.custom_minimum_size.y = height
	gap.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return gap


func _yellow_box(lead: String, bold: String, action: String, bg_alpha: float, border_alpha: float) -> Control:
	var box := EventCards.frame(Color(250 / 255.0, 204 / 255.0, 21 / 255.0, bg_alpha), Color(250 / 255.0, 204 / 255.0, 21 / 255.0, border_alpha), 10, Vector4(10, 8, 10, 8))
	box.custom_minimum_size.x = 200
	box.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	var stack := EventCards.column(6)
	var words := RichTextLabel.new()
	words.bbcode_enabled = true
	words.fit_content = true
	words.scroll_active = false
	words.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	words.custom_minimum_size.x = 180
	words.add_theme_font_override("normal_font", UI.font(400))
	words.add_theme_font_override("bold_font", UI.font(800))
	words.add_theme_font_size_override("normal_font_size", 12)
	words.add_theme_font_size_override("bold_font_size", 12)
	words.add_theme_color_override("default_color", Color("#fef08a"))
	if bold.is_empty():
		words.text = "[center]%s[/center]" % lead
	else:
		words.text = "[center]%s[b]%s[/b]. The next time skip lets it pass.[/center]" % [lead, bold.replace("[", "[lb]")]
	stack.add_child(words)
	var play := EventCards.button(action, Color("#facc15"), Color(0, 0, 0, 0), Color("#1c1917"), 8, 12, 800, Vector4(11, 5, 11, 5), Color("#fde047"))
	play.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	play.pressed.connect(func() -> void: open_interactive.emit())
	stack.add_child(play)
	box.add_child(stack)
	return box


func _custom_row(blocked: bool) -> Control:
	var holder := EventCards.frame(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.1), 12, Vector4(8, 7, 8, 7))
	holder.custom_minimum_size.x = 200
	holder.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	var input := LineEdit.new()
	input.placeholder_text = "Custom"
	input.text = custom_value
	input.custom_minimum_size = Vector2(54, 26)
	input.editable = not blocked
	input.add_theme_stylebox_override("normal", UI.box(Color(0, 0, 0, 0.25), Color(1, 1, 1, 0.16), 8, 1, Vector4(6, 0, 6, 0)))
	input.add_theme_stylebox_override("focus", UI.box(Color(0, 0, 0, 0.25), Color(1, 1, 1, 0.26), 8, 1, Vector4(6, 0, 6, 0)))
	input.add_theme_stylebox_override("read_only", UI.box(Color(0, 0, 0, 0.25), Color(1, 1, 1, 0.16), 8, 1, Vector4(6, 0, 6, 0)))
	input.add_theme_font_size_override("font_size", 13)
	input.text_changed.connect(func(value: String) -> void:
		var cleaned := ""
		for character in value:
			if character in "0123456789.":
				cleaned += character
		if cleaned != value:
			var caret := input.caret_column
			input.text = cleaned
			input.caret_column = min(caret, cleaned.length())
		custom_value = cleaned
		_update_custom_landing())
	input.text_submitted.connect(func(_text: String) -> void: _run_custom())
	row.add_child(input)
	var unit := OptionButton.new()
	for entry in UNITS:
		unit.add_item(str(entry[0]))
	unit.select(custom_unit)
	unit.disabled = blocked
	unit.focus_mode = Control.FOCUS_NONE
	unit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	unit.custom_minimum_size.y = 26
	unit.add_theme_stylebox_override("normal", UI.box(Color(0, 0, 0, 0.25), Color(1, 1, 1, 0.16), 8, 1, Vector4(6, 0, 6, 0)))
	unit.add_theme_stylebox_override("hover", UI.box(Color(0, 0, 0, 0.3), Color(1, 1, 1, 0.22), 8, 1, Vector4(6, 0, 6, 0)))
	unit.add_theme_stylebox_override("disabled", UI.box(Color(0, 0, 0, 0.25), Color(1, 1, 1, 0.16), 8, 1, Vector4(6, 0, 6, 0)))
	unit.add_theme_font_size_override("font_size", 13)
	unit.item_selected.connect(func(index: int) -> void:
		custom_unit = index
		_update_custom_landing())
	row.add_child(unit)
	_custom_go = EventCards.button("Go", Color(1, 1, 1, 0.1), Color(1, 1, 1, 0.28), UI.WHITE, 8, 13, 700, Vector4(10, 4, 10, 4), Color(1, 1, 1, 0.16))
	_custom_go.set_meta("blocked", blocked)
	_custom_go.pressed.connect(_run_custom)
	row.add_child(_custom_go)
	holder.add_child(row)
	return holder


func _custom_days() -> float:
	var amount := custom_value.to_float()
	if amount <= 0.0 or not custom_value.is_valid_float():
		return 0.0
	return amount * float(UNITS[custom_unit][1])


func _update_custom_landing() -> void:
	if _custom_go and is_instance_valid(_custom_go):
		var off: bool = bool(_custom_go.get_meta("blocked", false)) or custom_value.is_empty()
		_custom_go.modulate.a = 0.5 if off else 1.0
		_custom_go.disabled = off
	var days := _custom_days()
	if not _custom_landing or not is_instance_valid(_custom_landing):
		return
	if days <= 0.0:
		_custom_landing.visible = false
		return
	var landing := _custom_landing
	var reply := await engine.request("turn.landing", {"from": str(status.get("currentDate", "")), "days": days})
	if is_instance_valid(landing) and reply.get("ok", false) and is_equal_approx(days, _custom_days()):
		landing.text = "Lands on %s" % str(reply["result"].get("label", ""))
		landing.visible = true


func _run_custom() -> void:
	var days := _custom_days()
	if days <= 0.0 or is_loading or is_retrying_held or scene_in_progress:
		return
	run_jump(days, "jump")


func _caption() -> Control:
	var caption: Dictionary = status.get("caption", {})
	var near: bool = caption.get("nearlyOut", false)
	var lines := "%s of %s AI requests used today\n%s" % [str(int(caption.get("used", 0))), str(int(caption.get("limit", 0))), str(caption.get("second", ""))]
	if caption.get("lastUsed") != null:
		lines += " · the last used %s" % str(int(caption["lastUsed"]))
	var label := UI.label(lines, 11, Color("#fbbf24") if near else Color(1, 1, 1, 0.42))
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.custom_minimum_size.x = 200
	label.mouse_filter = Control.MOUSE_FILTER_PASS
	label.tooltip_text = "Counted on this device since midnight Pacific time. Change what the game spends in Settings → AI → AI requests."
	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_top", 7)
	margin.add_child(label)
	return margin


func _amber_box() -> PanelContainer:
	return EventCards.frame(AMBER_BG, AMBER_BORDER, 16, Vector4(14, 13, 14, 13))


func _amber_button(value: String, primary: bool, working: bool) -> Button:
	var node := EventCards.button(value, Color(251 / 255.0, 191 / 255.0, 36 / 255.0, 0.18) if primary else Color(1, 1, 1, 0.06), Color(251 / 255.0, 191 / 255.0, 36 / 255.0, 0.4) if primary else Color(1, 1, 1, 0.16), AMBER_INK if primary else Color(1, 1, 1, 0.72), 12, 12, 400, Vector4(11, 8, 11, 8))
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	if working:
		EventCards.set_busy(node, true)
	return node


func _parked_notice() -> Control:
	var box := _amber_box()
	var stack := EventCards.column(11)
	stack.add_child(EventCards.text("A time skip finished while another campaign was open, so nothing from it has been saved yet.", 12, AMBER_INK))
	stack.add_child(EventCards.text("Apply it to write it into this campaign without asking the model again, or discard it.", 12, AMBER_INK))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	var apply := _amber_button("Applying the time skip…" if is_applying_parked else "Apply the time skip", true, is_applying_parked)
	apply.pressed.connect(apply_parked)
	row.add_child(apply)
	var discard := _amber_button("Discard the time skip", false, is_applying_parked)
	discard.pressed.connect(discard_parked)
	row.add_child(discard)
	stack.add_child(row)
	box.add_child(stack)
	return box


func _held_notice() -> Control:
	var notice: Dictionary = HELD_NOTICE[str(held["kind"])]
	var box := _amber_box()
	var stack := EventCards.column(11)
	stack.add_child(EventCards.text(str(held.get("message", "")), 12, AMBER_INK))
	if notice.get("player_events", false):
		var failures: Variant = held.get("failures")
		if typeof(failures) == TYPE_DICTIONARY:
			var list := EventCards.column(6)
			for event in failures.get("events", []):
				var line := RichTextLabel.new()
				line.bbcode_enabled = true
				line.fit_content = true
				line.scroll_active = false
				line.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
				line.add_theme_font_override("normal_font", UI.font(400))
				line.add_theme_font_override("bold_font", UI.font(600))
				line.add_theme_font_size_override("normal_font_size", 12)
				line.add_theme_font_size_override("bold_font_size", 12)
				line.add_theme_color_override("default_color", AMBER_INK)
				line.text = "•  [b]%s[/b][color=#fde68ab8] — %s[/color]" % [str(event.get("title", "")).replace("[", "[lb]"), str(event.get("reason", "")).replace("[", "[lb]")]
				list.add_child(line)
			for order in failures.get("orders", []):
				var line := RichTextLabel.new()
				line.bbcode_enabled = true
				line.fit_content = true
				line.scroll_active = false
				line.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
				line.add_theme_font_override("normal_font", UI.font(400))
				line.add_theme_font_override("bold_font", UI.font(600))
				line.add_theme_font_size_override("normal_font_size", 12)
				line.add_theme_font_size_override("bold_font_size", 12)
				line.add_theme_color_override("default_color", AMBER_INK)
				line.text = "•  [b]Order: %s[/b][color=#fde68ab8] — not carried out[/color]" % str(order.get("title", "")).replace("[", "[lb]")
				list.add_child(line)
			if list.get_child_count() > 0:
				stack.add_child(list)
	var retries := int(held.get("retries", 0))
	if retries > 0 and not is_retrying_held:
		stack.add_child(EventCards.text("Tried %s — %s" % ["once" if retries == 1 else "%d times" % retries, str(notice["still_failing"])], 11.5, Color(253 / 255.0, 230 / 255.0, 138 / 255.0, 0.68)))
	var row := HFlowContainer.new()
	row.add_theme_constant_override("h_separation", 8)
	row.add_theme_constant_override("v_separation", 8)
	var retry_text: String = notice["retry"]
	if is_retrying_held:
		retry_text = progress_label if notice.get("show_progress", false) and not progress_label.is_empty() else str(notice["retrying"])
	var retry := _amber_button(retry_text, true, is_retrying_held)
	retry.custom_minimum_size.x = 150
	retry.pressed.connect(func() -> void: retry_held({}))
	row.add_child(retry)
	if notice.get("can_continue", false):
		var go_on := _amber_button("Continue without them", false, is_retrying_held)
		go_on.custom_minimum_size.x = 150
		go_on.pressed.connect(func() -> void: retry_held({"withoutFailedChecks": true}))
		row.add_child(go_on)
	if notice.get("player_events", false):
		var whole := _amber_button("Retry the whole skip", false, is_retrying_held)
		whole.custom_minimum_size.x = 150
		whole.pressed.connect(retry_whole_skip)
		row.add_child(whole)
		var keep := _amber_button("Keep it and move on", false, is_retrying_held)
		keep.custom_minimum_size.x = 150
		keep.pressed.connect(func() -> void: retry_held({"keep": true}))
		row.add_child(keep)
	if is_retrying_held:
		var cancel := _amber_button("Cancel", false, false)
		cancel.custom_minimum_size.x = 150
		cancel.pressed.connect(cancel_jump)
		row.add_child(cancel)
	elif not notice.get("player_events", false):
		var discard := _amber_button("Discard the turn", false, is_retrying_held)
		discard.custom_minimum_size.x = 150
		discard.pressed.connect(discard_held)
		row.add_child(discard)
	stack.add_child(row)
	box.add_child(stack)
	return box


func _mode_suggestion(suggestion: Dictionary) -> Control:
	var box := EventCards.frame(Color(30 / 255.0, 58 / 255.0, 138 / 255.0, 0.28), Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.32), 16, Vector4(14, 13, 14, 13))
	var stack := EventCards.column(11)
	var words := RichTextLabel.new()
	words.bbcode_enabled = true
	words.fit_content = true
	words.scroll_active = false
	words.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	words.add_theme_font_override("normal_font", UI.font(400))
	words.add_theme_font_override("bold_font", UI.font(700))
	words.add_theme_font_size_override("normal_font_size", 12)
	words.add_theme_font_size_override("bold_font_size", 12)
	words.add_theme_color_override("default_color", Color("#bfdbfe"))
	var label := str(suggestion.get("label", ""))
	words.text = "[b]Turns could be faster.[/b] Your AI model%s can't use the method the game tries first, so every turn wastes time working that out. The game can skip straight to what works — on a long turn that can save several minutes. Nothing else changes." % ((" (%s)" % label.replace("[", "[lb]")) if not label.is_empty() else "")
	stack.add_child(words)
	stack.add_child(EventCards.text("You can undo this any time under Settings → AI: edit that model, then How the AI answers.", 11.5, Color(191 / 255.0, 219 / 255.0, 254 / 255.0, 0.62)))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	var yes := EventCards.button("Yes, speed up turns", Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.2), Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.42), Color("#bfdbfe"), 12, 12, 400, Vector4(11, 8, 11, 8))
	yes.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	yes.pressed.connect(func() -> void: _answer_mode(true))
	row.add_child(yes)
	var no := EventCards.button("No thanks", Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.16), Color(1, 1, 1, 0.72), 12, 12, 400, Vector4(11, 8, 11, 8))
	no.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	no.pressed.connect(func() -> void: _answer_mode(false))
	row.add_child(no)
	stack.add_child(row)
	box.add_child(stack)
	return box


func _answer_mode(accept: bool) -> void:
	status["modeSuggestion"] = null
	_render_timeline()
	await engine.request("turn.modeSuggestion", {"accept": accept})


func _prune_rows(panel: PanelFrame) -> void:
	var kept: Array[Dictionary] = []
	for row in _progress_rows:
		var label: Label = row["label"]
		if is_instance_valid(label) and not panel.is_ancestor_of(label):
			kept.append(row)
	_progress_rows = kept


func _display_record() -> Dictionary:
	if skip_in_flight:
		return {"id": "live-turn", "round": int(live_range.get("round", int(status.get("round", 0)) + 1)), "rangeLabel": str(live_range.get("rangeLabel", "")), "events": live_cards, "filedEvents": [], "receipt": null, "warning": "", "live": true}
	if not older.is_empty():
		return older
	return latest


func _filtered(record: Dictionary) -> Array:
	var events: Array = record.get("events", [])
	var tag := _category_tag(record)
	if tag.is_empty():
		return events
	return events.filter(func(event: Dictionary) -> bool: return (event.get("tags", []) as Array).has(tag))


func _category_tag(record: Dictionary) -> String:
	return str(category["tag"]) if str(category["record"]) == str(record.get("id", "")) else ""


func _shown_count(record: Dictionary) -> int:
	var total := (_filtered(record)).size()
	if not older.is_empty() and not skip_in_flight:
		return total
	return min(visible_count, total)


func _render_events() -> void:
	if not events_panel:
		return
	_prune_rows(events_panel)
	events_panel.clear_body()
	_events_scroll_anchor = null
	var record := _display_record()
	var live: bool = record.get("live", false)
	var past := turn_index > 0 and not live
	_render_subtitle(record, live)
	var body := events_panel.body
	if past:
		body.add_child(EventCards.text("This is an earlier turn, shown in full. The map shows the world as it is now.", 11.5, Color(1, 1, 1, 0.5)))
	if restore_missing and older.is_empty():
		var box := EventCards.frame(Color(120 / 255.0, 53 / 255.0, 15 / 255.0, 0.24), AMBER_BORDER, 12, Vector4(14, 12, 14, 12))
		box.add_child(EventCards.text("This turn could not be saved as a restore point, so it cannot be rolled back. The turn itself is saved. If this keeps happening, the save may be too large or the storage full.", 12, AMBER_INK))
		body.add_child(box)
	var warning := ("" if not older.is_empty() else fallback_warning)
	if warning.is_empty() and not live:
		warning = str(record.get("warning", ""))
	if not warning.is_empty():
		body.add_child(_warning_box(warning, past))
	if record.is_empty() or (not live and str(record.get("id", "")).is_empty()):
		body.add_child(EventCards.empty_state("No event chain is available yet."))
	else:
		var events := _filtered(record)
		var all_events: Array = record.get("events", [])
		var total := events.size()
		if all_events.is_empty():
			if not live:
				body.add_child(EventCards.empty_state("No world events were recorded for this time skip."))
		else:
			var list := EventCards.column(12)
			body.add_child(list)
			var chips := _category_chips(record)
			if chips:
				list.add_child(chips)
			var shown := _shown_count(record)
			var anchor_index := 0 if past else shown - 1
			var offer_id := ""
			if typeof(offer) == TYPE_DICTIONARY and not live and older.is_empty():
				offer_id = str(offer.get("id", ""))
			for index in range(shown):
				var event: Dictionary = events[index]
				var key := str(event.get("key", event.get("id", "")))
				var footer: Control = null
				if not offer_id.is_empty() and str(event.get("id", "")) == offer_id:
					footer = EventCards.offer_strip(func() -> void: open_interactive.emit(), _let_offer_pass)
				var card := EventCards.card(event, {
					"map_open": open_map_changes.has(key),
					"on_toggle_map": _toggle_map_changes,
					"on_focus": _focus_bounds,
					"on_watch": _watch_strikes if _war_ready() else Callable(),
					"footer": footer,
				})
				list.add_child(card)
				if index == anchor_index and _focus_event.is_empty():
					_events_scroll_anchor = card
				if not _focus_event.is_empty() and str(event.get("id", "")) == _focus_event:
					_events_scroll_anchor = card
					_mark_card(card)
			if shown < total:
				_reveal_buttons(list, record, events, shown, total)
			if not live and shown >= total:
				var filed := EventCards.filed_section(record.get("filedEvents", []))
				if filed:
					list.add_child(filed)
		if not live and all_events.is_empty() and not (record.get("filedEvents", []) as Array).is_empty():
			var filed_only := EventCards.filed_section(record.get("filedEvents", []))
			if filed_only:
				body.add_child(filed_only)
		if not live:
			var receipt := EventCards.engine_changes(record.get("receipt"))
			if receipt:
				body.add_child(receipt)
	if skip_in_flight:
		body.add_child(_progress_row(""))
		_refresh_progress_rows()
	_scroll_events()


func _render_subtitle(record: Dictionary, live: bool) -> void:
	var slot := events_panel.header_subtitle_slot
	for child in slot.get_children():
		slot.remove_child(child)
		child.queue_free()
	var count := int(status.get("keptTurns", latest_count))
	if not live and count > 1 and not record.is_empty():
		events_panel.set_subtitle("")
		slot.visible = true
		var can_older := turn_index < count - 1
		var can_newer := turn_index > 0
		var older_button := _picker_button("‹", "Show the previous turn", can_older)
		older_button.pressed.connect(func() -> void:
			if can_older:
				_show_turn(min(count - 1, turn_index + 1)))
		slot.add_child(older_button)
		var round := int(record.get("round", 0))
		var range := str(record.get("rangeLabel", ""))
		if round > 0:
			slot.add_child(UI.label("Round %d" % round, 12, Color(1, 1, 1, 0.45)))
		if round > 0 and not range.is_empty():
			slot.add_child(UI.label("·", 12, Color(1, 1, 1, 0.45)))
		if not range.is_empty():
			var range_label := UI.label(range, 12, Color(1, 1, 1, 0.45))
			range_label.clip_text = true
			range_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
			range_label.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
			slot.add_child(range_label)
		var newer_button := _picker_button("›", "Show the next turn", can_newer)
		newer_button.pressed.connect(func() -> void:
			if can_newer:
				_show_turn(max(0, turn_index - 1)))
		slot.add_child(newer_button)
	else:
		slot.visible = false
		events_panel.set_subtitle(str(record.get("rangeLabel", "")))


func _picker_button(glyph: String, tip: String, enabled: bool) -> Button:
	var node := Button.new()
	node.text = glyph
	node.flat = true
	node.focus_mode = Control.FOCUS_NONE
	node.tooltip_text = tip
	node.custom_minimum_size = Vector2(18, 16)
	node.add_theme_font_size_override("font_size", 15)
	var ink := Color(1, 1, 1, 0.8) if enabled else Color(1, 1, 1, 0.2)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_disabled_color"]:
		node.add_theme_color_override(name, ink)
	for state in ["normal", "hover", "pressed", "focus", "disabled"]:
		node.add_theme_stylebox_override(state, StyleBoxEmpty.new())
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if enabled else Control.CURSOR_ARROW
	return node


func _show_turn(index: int) -> void:
	turn_index = index
	await _load_older(index)
	_render_events()
	_after_reveal_change()


func _category_chips(record: Dictionary) -> Control:
	var present := {}
	for event in record.get("events", []):
		for value in event.get("tags", []):
			present[str(value)] = true
	var tags: Array = tag_order.filter(func(value: Variant) -> bool: return present.has(str(value)))
	if tags.is_empty():
		return null
	var active := _category_tag(record)
	var chips := EventCards.flow(6)
	for value in tags:
		var on := active == str(value)
		var chip := EventCards.button(str(value), Color(0, 0, 0, 0.42) if on else Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.28) if on else Color(1, 1, 1, 0.16), UI.WHITE, 999, 11, 700, Vector4(10, 3, 10, 3))
		var tag := str(value)
		chip.pressed.connect(func() -> void:
			category = {"record": str(record.get("id", "")), "tag": "" if on else tag}
			intervene = {"record": "", "state": "idle"}
			_render_events())
		chips.add_child(chip)
	return chips


func _reveal_buttons(list: VBoxContainer, record: Dictionary, events: Array, shown: int, total: int) -> void:
	var next := EventCards.ghost("Next event", 40)
	next.icon = EventCards.icon("chevron", 14, EventCards.GHOST_INK)
	next.pressed.connect(reveal_next)
	list.add_child(next)
	var skip := EventCards.ghost("Skip to end (%d more)" % (total - shown), 30)
	skip.modulate.a = 0.75
	skip.pressed.connect(reveal_all)
	list.add_child(skip)
	var can := bool(status.get("canIntervene", false)) and int(status.get("undoCount", 0)) > 0 and not is_loading and not skip_in_flight and not is_retrying_held and older.is_empty()
	if not can or not _category_tag(record).is_empty():
		return
	var state := str(intervene["state"]) if str(intervene["record"]) == str(record.get("id", "")) else "idle"
	if state == "asking":
		var box := EventCards.frame(Color(251 / 255.0, 191 / 255.0, 36 / 255.0, 0.10), Color(251 / 255.0, 191 / 255.0, 36 / 255.0, 0.55), 10, Vector4(11, 10, 11, 10))
		var stack := EventCards.column(6)
		var last: Dictionary = events[shown - 1]
		var left := total - shown
		var sentence := ""
		if left == 1:
			sentence = "Stop the round after \"%s\"? The 1 event not yet revealed will be discarded — it never happens — and the date becomes %s. You can still undo the round afterwards." % [str(last.get("title", "")), str(last.get("dateLabel", ""))]
		else:
			sentence = "Stop the round after \"%s\"? The %d events not yet revealed will be discarded — they never happen — and the date becomes %s. You can still undo the round afterwards." % [str(last.get("title", "")), left, str(last.get("dateLabel", ""))]
		stack.add_child(EventCards.text(sentence, 12.5, Color(1, 1, 1, 0.9)))
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 6)
		var stop := EventCards.button("Stop here", Color(251 / 255.0, 191 / 255.0, 36 / 255.0, 0.22), Color(251 / 255.0, 191 / 255.0, 36 / 255.0, 0.8), EventCards.GHOST_INK, 10, 12, 600, Vector4(12, 6, 12, 6))
		stop.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		stop.custom_minimum_size.y = 32
		stop.pressed.connect(_confirm_intervene)
		row.add_child(stop)
		var keep := EventCards.ghost("Keep going", 32)
		keep.modulate.a = 0.8
		keep.pressed.connect(func() -> void:
			intervene = {"record": str(record.get("id", "")), "state": "idle"}
			_render_events())
		row.add_child(keep)
		stack.add_child(row)
		box.add_child(stack)
		list.add_child(box)
	else:
		var button := EventCards.ghost("Stopping the round…" if state == "working" else "✋ Intervene here", 30)
		button.tooltip_text = "Stop the round here: what is revealed happened, what is not never does, and you act before it."
		button.modulate.a = 0.7 if state == "working" else 0.9
		if state == "working":
			button.disabled = true
		button.pressed.connect(func() -> void:
			intervene = {"record": str(record.get("id", "")), "state": "asking"}
			_render_events())
		list.add_child(button)


func _warning_box(warning: String, past: bool) -> Control:
	var box := EventCards.frame(Color(120 / 255.0, 53 / 255.0, 15 / 255.0, 0.24), AMBER_BORDER, 12, Vector4(14, 12, 14, 12))
	var stack := EventCards.column(10)
	stack.add_child(EventCards.text(warning, 12, AMBER_INK))
	var row := HFlowContainer.new()
	row.add_theme_constant_override("h_separation", 8)
	row.add_theme_constant_override("v_separation", 8)
	if not past:
		var logging_on := bool(status.get("loggingOn", false))
		var idle := "💾 Save logging file" if logging_on else "📋 Copy debugging message"
		var report := EventCards.button(report_label if not report_label.is_empty() else idle, Color(251 / 255.0, 191 / 255.0, 36 / 255.0, 0.1), Color(251 / 255.0, 191 / 255.0, 36 / 255.0, 0.3), AMBER_INK, 8, 12, 600, Vector4(11, 6, 11, 6))
		report.tooltip_text = "Saves the diagnostics log as a file, with this turn's details — what was attempted and the raw model response — at the top. Attach the file to your bug report. No API key is included; the model's response may quote your campaign." if logging_on else "Copies this turn's details — what was attempted, game/provider context, and the raw model response. Diagnostics logging is off — turn it on in Settings → Diagnostics to save the full log instead."
		report.pressed.connect(func() -> void: _send_report(logging_on))
		row.add_child(report)
	var can_rollback := int(status.get("undoCount", 0)) > 0 and not is_loading and not skip_in_flight and not is_retrying_held and older.is_empty()
	if can_rollback or rollback_state == "working":
		var rollback := EventCards.button("Rolling back…" if rollback_state == "working" else "↩ Rollback turn", Color(180 / 255.0, 83 / 255.0, 9 / 255.0, 0.22), Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.45), Color("#fcd9a8"), 8, 12, 600, Vector4(11, 6, 11, 6))
		rollback.tooltip_text = "Undoes this turn and restores the world to how it was before the jump, so you can fix the provider settings and try again."
		if rollback_state == "working":
			EventCards.set_busy(rollback, true, 0.7)
		rollback.pressed.connect(func() -> void:
			if rollback_state == "working":
				return
			rollback_state = "working"
			_render_events()
			await run_undo(true)
			rollback_state = "idle"
			_render_events())
		row.add_child(rollback)
	if row.get_child_count() > 0:
		stack.add_child(row)
	box.add_child(stack)
	return box


func _send_report(logging_on: bool) -> void:
	if report_label in ["Saving…", "Copying…"]:
		return
	report_label = "Saving…" if logging_on else "Copying…"
	_render_events()
	var reply := await engine.request("turn.report")
	var state := "failed"
	if reply.get("ok", false):
		state = str(reply["result"].get("state", "failed"))
		var text := str(reply["result"].get("text", ""))
		if state == "copied" and not text.is_empty():
			DisplayServer.clipboard_set(text)
	if logging_on:
		report_label = {"saved": "✓ Saved — attach the file to your report", "copied": "✓ Log copied — paste it into your report"}.get(state, "Couldn't save — try again")
	else:
		report_label = "✓ Copied!" if state == "copied" else "Couldn't copy — try again"
	_render_events()
	await get_tree().create_timer(3.0).timeout
	report_label = ""
	if open_panel == "history":
		_render_events()


func _scroll_events() -> void:
	var anchor := _events_scroll_anchor
	if not anchor:
		return
	await get_tree().process_frame
	await get_tree().process_frame
	if not is_instance_valid(anchor):
		return
	var scroll := events_panel.scroll
	var target := int(anchor.global_position.y - events_panel.body.global_position.y + 15)
	var tween := create_tween().set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	tween.tween_property(scroll, "scroll_vertical", target, 0.35)


func _toggle_map_changes(key: String) -> void:
	if open_map_changes.has(key):
		open_map_changes.erase(key)
	else:
		open_map_changes[key] = true


func _focus_bounds(bounds: Array) -> void:
	if map_view and bounds.size() >= 2:
		map_view.fit_lonlat_bounds(bounds)


func _let_offer_pass() -> void:
	await engine.request("turn.declineOffer")
	await load_history()
	await refresh_status()
	_render_all()


func reveal_next() -> void:
	var record := _display_record()
	var total := (_filtered(record)).size()
	if total <= 0:
		visible_count = 1
	else:
		visible_count = min(total, visible_count + 1)
		if not skip_in_flight:
			engine.request("turn.seen", {"through": visible_count})
	_render_events()
	_after_reveal_change()


func reveal_all() -> void:
	var record := _display_record()
	var total := (_filtered(record)).size()
	if total > 0:
		visible_count = total
		if not skip_in_flight:
			engine.request("turn.seen", {"through": total})
	_render_events()
	_after_reveal_change()


func _after_reveal_change() -> void:
	_follow_camera()
	_stage_map()


func _follow_camera() -> void:
	if open_panel != "history" or not older.is_empty() or not map_view:
		return
	var record := _display_record()
	var events: Array = record.get("events", [])
	if events.is_empty():
		return
	var event: Dictionary = events[min(max(visible_count, 1), events.size()) - 1]
	var id := str(event.get("id", ""))
	if id == _camera_event:
		return
	_camera_event = id
	if _war_ready():
		war.call("show_strikes_of_event", id)
	if not bool(status.get("eventCamera", true)):
		return
	var focus: Variant = event.get("focus")
	if typeof(focus) == TYPE_ARRAY and (focus as Array).size() >= 2:
		map_view.fit_lonlat_bounds(focus)


func _stage_map() -> void:
	if not map_view or not engine:
		return
	_stage_seq += 1
	var seq := _stage_seq
	var args := {}
	if open_panel == "history" and older.is_empty():
		if skip_in_flight:
			var revealed := live_cards.slice(0, max(1, visible_count)).filter(func(event: Dictionary) -> bool: return typeof(event.get("filed")) != TYPE_DICTIONARY)
			if not revealed.is_empty():
				args = {"through": max(1, visible_count), "live": true}
		else:
			var total: int = (latest.get("events", []) as Array).size()
			if total > 0 and visible_count < total:
				args = {"through": visible_count}
	if args.is_empty():
		if not _staged:
			return
		_staged = false
		if _war_ready():
			await war.call("unstage")
			return
		var final := await engine.request("map.state")
		if seq == _stage_seq and final.get("ok", false):
			map_view.set_state(final["result"])
		return
	if _war_ready():
		_staged = true
		await war.call("stage", int(args["through"]), bool(args.get("live", false)))
		return
	var reply := await engine.request("turn.stage", args)
	if seq != _stage_seq or not reply.get("ok", false) or typeof(reply.get("result")) != TYPE_DICTIONARY:
		return
	_staged = true
	map_view.set_state(reply["result"])


func _hold_from(reply: Dictionary) -> void:
	var kind := str(reply.get("heldKind", ""))
	var retries := int(held.get("retries", 0)) if str(held.get("kind", "")) == kind else 0
	held = {"kind": kind, "message": str(reply.get("error", "")) if not str(reply.get("error", "")).is_empty() else "The turn is held.", "failures": reply.get("failures"), "retries": retries}


func _set_loading(value: bool) -> void:
	is_loading = value
	busy_changed.emit(busy())
	_render_pill()


func _reply_error(reply: Dictionary, fallback: String) -> String:
	var message := str(reply.get("error", ""))
	return message if not message.is_empty() else fallback


func _clear_run() -> void:
	current_call = 0
	skip_in_flight = false
	progress_label = ""
	progress_started_at = 0
	live_cards = []


func _land(view: Variant, panel := "history") -> void:
	_staged = true
	_camera_event = ""
	_set_loading(false)
	set_panel(panel)
	_render_all()
	if typeof(view) == TYPE_DICTIONARY:
		turn_landed.emit(view)


func _settle(panel := "") -> void:
	_set_loading(false)
	if not panel.is_empty():
		set_panel(panel)
	_render_all()


func run_jump(days: float, mode := "jump", retry_directive := "") -> void:
	if is_loading or current_call != 0:
		return
	var live := bool(status.get("liveSkipEvents", true))
	error = ""
	fallback_warning = ""
	held = {}
	parked_held = false
	restore_missing = false
	progress_label = ""
	live_cards = []
	live_range = {"round": int(status.get("round", 0)) + 1}
	_camera_event = ""
	if live:
		open_map_changes = {}
		visible_count = 1
	skip_in_flight = live
	progress_started_at = Time.get_ticks_msec()
	_set_loading(true)
	set_panel("history" if live else "skip")
	current_call = engine.last_request_id() + 1
	var reply := await engine.request("turn.skip", {"days": days, "mode": mode, "retryDirective": retry_directive, "live": live})
	current_call = 0
	if reply.get("ok", false):
		var result: Dictionary = reply["result"]
		var carry: Variant = visible_count if live and str(result.get("source", "")) != "fallback" else null
		restore_missing = bool(result.get("restorePointMissing", false))
		if str(result.get("source", "")) == "fallback":
			var reason := str(result.get("fallbackReason", ""))
			fallback_warning = "Turn generated by fallback: %s" % (reason if not reason.is_empty() else "structured AI output was unavailable")
		await load_history(carry)
		await refresh_status()
		_clear_run()
		_land(result.get("view"))
		return
	if reply.get("aborted", false):
		error = ""
	elif not str(reply.get("heldKind", "")).is_empty():
		error = ""
		_hold_from(reply)
	else:
		error = _reply_error(reply, "The time skip failed.")
	await load_history()
	await refresh_status()
	_clear_run()
	_settle("skip")


func cancel_jump() -> void:
	if current_call != 0:
		engine.cancel(current_call)


func retry_held(options: Dictionary) -> void:
	if is_retrying_held or is_loading or current_call != 0 or held.is_empty():
		return
	var kind := str(held["kind"])
	var without: bool = options.get("withoutFailedChecks", false)
	var keep: bool = options.get("keep", false)
	var live := kind == "segment" and bool(status.get("liveSkipEvents", true))
	is_retrying_held = true
	if not without and not keep:
		held["retries"] = int(held.get("retries", 0)) + 1
	progress_label = ""
	if kind == "segment":
		skip_in_flight = live
		live_cards = []
	if live:
		open_map_changes = {}
		visible_count = 1
		live_range = {"round": int(status.get("round", 0)) + 1}
	progress_started_at = Time.get_ticks_msec()
	_set_loading(true)
	if live:
		set_panel("history")
	else:
		_render_timeline()
	current_call = engine.last_request_id() + 1
	var reply := await engine.request("turn.retry", {"kind": kind, "keep": keep, "withoutFailedChecks": without, "live": live})
	current_call = 0
	if reply.get("ok", false):
		var carry: Variant = visible_count if kind == "segment" and live else null
		restore_missing = bool(reply["result"].get("restorePointMissing", false))
		held = {}
		if kind != "segment":
			visible_count = 1
		await load_history(carry)
		await refresh_status()
		is_retrying_held = false
		_clear_run()
		_land(reply["result"].get("view"))
		return
	if reply.get("aborted", false):
		pass
	elif not str(reply.get("heldKind", "")).is_empty():
		_hold_from(reply)
	else:
		held = {}
		error = _reply_error(reply, "Failed to finish the held turn.")
	await refresh_status()
	is_retrying_held = false
	_clear_run()
	_settle()


func discard_held() -> void:
	if not held.is_empty():
		engine.request("turn.discardHeld", {"kind": str(held["kind"])})
	held = {}
	_render_timeline()


func retry_whole_skip() -> void:
	if is_retrying_held or is_loading or str(held.get("kind", "")) != "events":
		return
	var reply := await engine.request("turn.rerun")
	var rerun: Variant = reply.get("result") if reply.get("ok", false) else null
	if typeof(rerun) != TYPE_DICTIONARY:
		held = {}
		_render_timeline()
		return
	await run_jump(float(rerun.get("days", 0)), "auto" if str(rerun.get("mode", "")) == "auto" else "jump", str(rerun.get("directive", "")))


func apply_parked() -> void:
	if is_applying_parked or is_loading or current_call != 0:
		return
	is_applying_parked = true
	error = ""
	progress_started_at = Time.get_ticks_msec()
	_set_loading(true)
	_render_timeline()
	current_call = engine.last_request_id() + 1
	var reply := await engine.request("turn.applyParked")
	current_call = 0
	if reply.get("ok", false):
		parked_held = false
		if typeof(reply.get("result")) == TYPE_DICTIONARY:
			restore_missing = bool(reply["result"].get("restorePointMissing", false))
			await load_history()
			visible_count = 1
			await refresh_status()
			is_applying_parked = false
			_clear_run()
			_land(reply["result"].get("view"))
			return
	else:
		await refresh_status()
		if reply.get("aborted", false):
			parked_held = bool(status.get("parked", false))
		elif not str(reply.get("heldKind", "")).is_empty():
			parked_held = false
			_hold_from(reply)
		else:
			parked_held = bool(status.get("parked", false))
			error = _reply_error(reply, "Failed to apply the time skip that finished while another campaign was open.")
	is_applying_parked = false
	_clear_run()
	_settle()


func discard_parked() -> void:
	parked_held = false
	_render_timeline()
	await engine.request("turn.discardParked")


func run_undo(stay_on_history := false) -> bool:
	if is_loading or current_call != 0 or int(status.get("undoCount", 0)) <= 0:
		return false
	if not stay_on_history:
		set_panel("skip")
	error = ""
	fallback_warning = ""
	_set_loading(true)
	_render_timeline()
	var reply := await engine.request("turn.undo")
	if reply.get("ok", false) and typeof(reply.get("result")) == TYPE_DICTIONARY:
		restore_missing = false
		await load_history()
		visible_count = 1
		await refresh_status()
		_land(reply["result"].get("view"))
		return true
	if not reply.get("ok", false):
		error = _reply_error(reply, "Failed to undo the last turn.")
	_settle()
	return false


func _confirm_intervene() -> void:
	var record := _display_record()
	if str(intervene["state"]) == "working" or is_loading or current_call != 0:
		return
	intervene = {"record": str(record.get("id", "")), "state": "working"}
	var keep: int = max(1, visible_count)
	error = ""
	fallback_warning = ""
	_set_loading(true)
	_render_events()
	var reply := await engine.request("turn.intervene", {"keep": keep})
	intervene = {"record": "", "state": "idle"}
	if reply.get("ok", false) and typeof(reply.get("result")) == TYPE_DICTIONARY:
		var result: Dictionary = reply["result"]
		restore_missing = bool(result.get("restorePointMissing", false))
		await load_history()
		visible_count = int(result.get("kept", keep))
		await refresh_status()
		_land(result.get("view"))
		return
	if reply.get("ok", false):
		error = "There was nothing to stop: the round has no events after the ones revealed."
	else:
		error = _reply_error(reply, "Failed to stop the round.")
	_settle()


func set_right_inset(width: float) -> void:
	if not _pill:
		return
	if _pill_tween and _pill_tween.is_valid():
		_pill_tween.kill()
	_pill_tween = create_tween().set_parallel(true).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_IN_OUT)
	_pill_tween.tween_property(_pill, "offset_left", -296.0 - width, 0.35)
	_pill_tween.tween_property(_pill, "offset_right", -8.0 - width, 0.35)


func show_event(event_id: String) -> void:
	if event_id.is_empty() or (is_loading and not skip_in_flight):
		return
	var reply := await engine.request("turn.findEvent", {"eventId": event_id})
	var index := int(reply.get("result", {}).get("index", -1)) if reply.get("ok", false) and typeof(reply.get("result")) == TYPE_DICTIONARY else -1
	if index < 0:
		return
	set_panel("history")
	if skip_in_flight:
		return
	turn_index = index
	if index > 0:
		await _load_older(index)
	else:
		older = {}
		var ids: Array = (latest.get("events", []) as Array).map(func(event: Dictionary) -> String: return str(event.get("id", "")))
		var through := ids.find(event_id) + 1
		if through > visible_count:
			visible_count = through
			engine.request("turn.seen", {"through": through})
	if not _category_tag(_display_record()).is_empty():
		category = {"record": "", "tag": ""}
	_focus_event = event_id
	_render_events()
	_focus_event = ""
	_after_reveal_change()


func _mark_card(card: Control) -> void:
	var ring := Panel.new()
	ring.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ring.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	ring.offset_left = -2
	ring.offset_top = -2
	ring.offset_right = 2
	ring.offset_bottom = 2
	var style := UI.box(Color(0, 0, 0, 0), Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.75), 18, 2)
	ring.add_theme_stylebox_override("panel", style)
	card.add_child(ring)
	await get_tree().create_timer(2.6).timeout
	if is_instance_valid(ring):
		var fade := ring.create_tween()
		fade.tween_property(ring, "modulate:a", 0.0, 0.4)
		fade.tween_callback(ring.queue_free)
