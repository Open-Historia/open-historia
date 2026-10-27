extends SceneTree

var main: Node
var shots := ""
var started := 0
var failures: PackedStringArray = []
var panel: AdvisorPanel
var chats: Array = []
var focused: Array = []
var widths: Array = []
var opened_actions := 0
var opened_projects := 0


func _initialize() -> void:
	shots = OS.get_environment("OH_SHOTS")
	started = Time.get_ticks_msec()
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.mouse_passthrough = true
	root.add_child(main)
	_run.call_deferred()


func _say(text: String) -> void:
	print("[advisor %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _check(label: String, ok: bool, detail := "") -> void:
	_say("%s %s%s" % ["ok  " if ok else "FAIL", label, ("  (" + detail + ")") if not detail.is_empty() else ""])
	if not ok:
		failures.append(label)


func _frames(count: int) -> void:
	for i in range(count):
		await process_frame


func _wait(seconds: float) -> void:
	await create_timer(seconds).timeout


func _until(condition: Callable, seconds: float) -> bool:
	var deadline := Time.get_ticks_msec() + int(seconds * 1000.0)
	while Time.get_ticks_msec() < deadline:
		if condition.call():
			return true
		await process_frame
	return false


func _shoot(name: String) -> void:
	await _frames(4)
	await RenderingServer.frame_post_draw
	if shots.is_empty():
		return
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(name + ".png"))
	_say("screenshot " + name)


func _find_button(node: Node, text: String) -> Button:
	if node is Button and (node as Button).text == text and (node as Button).is_visible_in_tree():
		return node as Button
	for child in node.get_children():
		var found := _find_button(child, text)
		if found:
			return found
	return null


func _find_text(node: Node, text: String) -> bool:
	if node is Label and (node as Label).text == text and (node as Label).is_visible_in_tree():
		return true
	if node is RichTextLabel and (node as RichTextLabel).get_parsed_text() == text and (node as RichTextLabel).is_visible_in_tree():
		return true
	for child in node.get_children():
		if _find_text(child, text):
			return true
	return false


func _find_chart(node: Node) -> Control:
	if node is AdvisorPanel.AdvisorChart and (node as Control).is_visible_in_tree():
		return node as Control
	for child in node.get_children():
		var found := _find_chart(child)
		if found:
			return found
	return null


func _visible_problem(node: Node) -> String:
	for child in node.get_children():
		if child is RichTextLabel and (child as RichTextLabel).is_visible_in_tree() and not (child as RichTextLabel).get_parsed_text().is_empty():
			return (child as RichTextLabel).get_parsed_text()
	return ""


func _scroll_to(control: Control) -> void:
	if control:
		panel.scroll.ensure_control_visible(control)
	await _frames(3)


func _doc(key: String) -> Variant:
	var reply: Dictionary = await main.engine.request("doc.read", {"key": key})
	return reply.get("result") if reply.get("ok", false) else null


func _press_enter(shift: bool) -> void:
	var key := InputEventKey.new()
	key.keycode = KEY_ENTER
	key.pressed = true
	key.shift_pressed = shift
	Input.parse_input_event(key)
	var up := InputEventKey.new()
	up.keycode = KEY_ENTER
	up.pressed = false
	up.shift_pressed = shift
	Input.parse_input_event(up)



func _clear_shell() -> void:
	var shell: ShellBoot = main.get("shell") as ShellBoot
	if shell == null:
		return
	var deadline := Time.get_ticks_msec() + 30000
	while shell.door_state == "deciding" and Time.get_ticks_msec() < deadline:
		await process_frame
	if shell.door != null and is_instance_valid(shell.door):
		shell.door.opened.emit()
	if not shell.notice_updates.is_empty():
		deadline = Time.get_ticks_msec() + 5000
		while not (shell.notice != null and is_instance_valid(shell.notice)) and Time.get_ticks_msec() < deadline:
			await process_frame
		for i in range(5):
			await process_frame
	if shell.notice != null and is_instance_valid(shell.notice):
		shell.notice.closed.emit()
	for i in range(3):
		await process_frame

func _run() -> void:
	while not main.menu.visible:
		if Time.get_ticks_msec() - started > 90000:
			_say("FAIL the menu never appeared")
			_finish(1)
			return
		await process_frame
	_say("menu ready")
	await _clear_shell()
	await main._start_scenario("default")
	await _wait(0.4)
	main.picker._choose("France")
	await main._on_country_chosen("France", "medium")
	_say("game open")
	await _wait(1.0)

	panel = AdvisorPanel.new()
	main.hud.add_child(panel)
	panel.setup(main.engine, {"map_view": main.map_view})
	panel.open_chat.connect(func(country: String, draft: String) -> void: chats.append([country, draft]))
	panel.focus_point.connect(func(lng: float, lat: float, zoom: float) -> void: focused.append([lng, lat, zoom]))
	panel.open_actions.connect(func() -> void: opened_actions += 1)
	panel.open_projects.connect(func() -> void: opened_projects += 1)
	panel.width_changed.connect(func(width: float) -> void: widths.append(width))
	await _frames(2)
	_check("the closed drawer waits off the right edge", is_equal_approx(panel.offset_left, 0.0) and is_equal_approx(panel.offset_right, 320.0))
	panel.seed("Help me steady the budget.")
	panel.open()
	await _wait(0.2)
	_check("the drawer is still sliding in", panel.offset_left < 0.0 and panel.offset_left > -320.0, str(panel.offset_left))
	_check("the conversation loads on first open", await _until(func() -> bool: return panel._has_bootstrapped, 30.0))
	await _wait(0.5)
	_check("the drawer is full height, flush right, 320 wide", is_equal_approx(panel.offset_left, -320.0) and is_equal_approx(panel.offset_right, 0.0) and is_equal_approx(panel.offset_top, 0.0) and is_equal_approx(panel.offset_bottom, 0.0))
	_check("the header reads Advisor with its clear and close buttons", panel.header_title.text == "Advisor" and _find_button(panel, "🗑") != null and _find_button(panel, "✕") != null and _find_button(panel, "✕").tooltip_text == "Close advisor" and _find_button(panel, "🗑").tooltip_text == "Clear chat")
	_check("a seed before the load lands in the composer", panel._input.text == "Help me steady the budget.", panel._input.text)
	panel.seed("Keep the defence budget as it is.")
	_check("a second seed is appended, never sent", panel._input.text == "Help me steady the budget.\n\nKeep the defence budget as it is." and panel.messages.is_empty(), panel._input.text.replace("\n", "/"))
	panel.seed("Keep the defence budget as it is.")
	_check("the same seed twice leaves the composer alone", panel._input.text == "Help me steady the budget.\n\nKeep the defence budget as it is.")
	_check("the empty state says so", _find_text(panel, "No messages yet. Ask your advisor something!"))
	await _shoot("advisor-01-empty-seeded")

	panel._input.text = "Help me steady the budget."
	panel._update_send()
	panel._send_from_composer()
	await _wait(0.5)
	_check("the question is shown at once", panel.messages.size() == 1 and str(panel.messages[0].get("role", "")) == "user")
	_check("the send button is disabled while the advisor thinks", panel._send_button.disabled)
	await _shoot("advisor-02-thinking")
	_check("the reply streams in", await _until(func() -> bool: return not panel._live.is_empty(), 30.0))
	await _wait(0.9)
	await _shoot("advisor-03-streaming")
	_check("the turn finishes", await _until(func() -> bool: return not panel._loading, 60.0))
	await _wait(1.2)
	var reply: Dictionary = panel.messages[panel.messages.size() - 1] if not panel.messages.is_empty() else {}
	_check("the reply is kept as an advisor message", str(reply.get("role", "")) == "advisor")
	_check("the memory line is kept off the text", not str(reply.get("text", "")).contains("ADVISOR_MEMORY") and not str(reply.get("memory", "")).is_empty())
	_check("the actions receipt is on the reply", typeof(reply.get("actionsSummary")) == TYPE_ARRAY and (reply["actionsSummary"] as Array).size() == 1)
	_check("the projects receipt is on the reply", typeof(reply.get("projectsSummary")) == TYPE_ARRAY)
	var actions: Variant = await _doc("actions")
	_check("the action was queued", JSON.stringify(actions).contains("Convene the budget cabinet"))
	var saved: Variant = await _doc("advisor")
	_check("the transcript was saved", typeof(saved) == TYPE_ARRAY and (saved as Array).size() == 2, str((saved as Array).size()) if typeof(saved) == TYPE_ARRAY else "none")
	await _shoot("advisor-04-receipts")
	var chart := _find_chart(panel)
	_check("the chart is drawn natively", chart != null)
	if chart:
		await _scroll_to(chart)
		var motion := InputEventMouseMotion.new()
		var hit_found := false
		for hit in chart.get("_hits"):
			var entry: Dictionary = hit
			if str(entry["shape"]) == "rect" and int(entry["index"]) == 0 and int(entry["set"]) == 0:
				motion.position = (entry["rect"] as Rect2).get_center()
				hit_found = true
		if hit_found:
			chart._gui_input(motion)
			await _frames(3)
			_check("hovering a bar shows its tooltip", int(chart.get("_hover_index")) == 0)
			await _shoot("advisor-05-chart-tooltip")
	panel.scroll.scroll_vertical = 0
	await _frames(3)
	await _shoot("advisor-06-reply-top")

	var open_actions_button := _find_button(panel, "Open Actions")
	_check("Open Actions is offered", open_actions_button != null)
	if open_actions_button:
		open_actions_button.pressed.emit()
	_check("Open Actions asks for the Actions panel", opened_actions == 1)
	var open_projects_button := _find_button(panel, "Open Projects")
	if open_projects_button:
		open_projects_button.pressed.emit()
	_check("Open Projects asks for the Projects panel", opened_projects == 1)

	var draft := _find_button(panel, "✉️ Draft to Germany")
	_check("the drafted letter has its button", draft != null)
	if draft:
		await _scroll_to(draft)
		draft.pressed.emit()
		await _frames(2)
		_check("the letter goes to Diplomacy, not sent", chats.size() == 1 and str(chats[0][0]) == "Germany" and str(chats[0][1]).begins_with("Chancellor, France proposes"))
		_check("the button says where it went", draft.text == "✓ In Diplomacy — press send there")
		await _shoot("advisor-07-draft-handed")
		panel._set_loading(true)
		panel._set_loading(false)
		await _frames(2)
		_check("the hand-off survives a re-render of the row", _find_button(panel, "✓ In Diplomacy — press send there") != null)
		await _wait(3.3)
		_check("the button comes back after three seconds", _find_button(panel, "✉️ Draft to Germany") != null)

	var place := _find_button(panel, "📍 Place Brigade de Lorraine here")
	_check("the deployment has its button", place != null)
	if place:
		place.pressed.emit()
		_check("the unit is placed", await _until(func() -> bool: return _find_button(panel, "✓ Brigade de Lorraine placed") != null, 20.0))
		_check("the map is asked to fly there", focused.size() == 1 and is_equal_approx(float(focused[0][0]), 6.18) and is_equal_approx(float(focused[0][2]), 4.5))
		_check("the placement is marked on the message", JSON.stringify(panel.messages[1].get("placedDeployments", [])).contains("0"))
		await _scroll_to(_find_button(panel, "✓ Brigade de Lorraine placed"))
		await _shoot("advisor-08-placed")

	var skipped: Dictionary = await main.engine.request("skip", {"days": 7.0})
	_check("a week passes", skipped.get("ok", false), str(skipped.get("error", "")))
	await _wait(0.6)
	panel._input.text = "What should we table in the institution?"
	panel._update_send()
	panel._send_from_composer()
	_check("the second turn ends", await _until(func() -> bool: return not panel._loading and panel.messages.size() == 4, 90.0))
	await _wait(0.6)
	var second_question: Dictionary = panel.messages[2]
	_check("a question after a skip carries its catch-up", not str(second_question.get("catchUpLabel", "")).is_empty() and str(second_question.get("catchUp", "")).begins_with("[Since your last reply"), str(second_question.get("catchUpLabel", "")))
	var institution := _find_button(panel, "🏛️ Table proposal in european-union")
	_check("the institution draft has its button", institution != null)
	if institution:
		_check("the institution button names what it does", institution.tooltip_text == "Common fiscal rules")
		institution.pressed.emit()
		_check("the institution action answers", await _until(func() -> bool: return _find_button(panel, "Applying institution action…") == null, 20.0))
		await _frames(3)
		var settled := _find_button(panel, "✓ Table proposal in european-union") != null
		var why := _visible_problem(_find_button(panel, "🏛️ Table proposal in european-union").get_parent()) if not settled and _find_button(panel, "🏛️ Table proposal in european-union") else ""
		_check("it either lands or says why not", settled or not why.is_empty(), why)
		await _shoot("advisor-09-catch-up-and-institution")

	await panel.refresh()
	_check("refresh keeps the conversation", panel.messages.size() == 4)
	panel._input.text = "Is the fleet ready?"
	panel._input.grab_focus()
	panel._input.set_caret_column(panel._input.text.length())
	await _frames(2)
	_press_enter(true)
	await _frames(3)
	_check("Shift+Enter starts a new line and sends nothing", panel._input.text.contains("\n") and not panel._loading, panel._input.text.replace("\n", "/"))
	panel._input.text = "Is the fleet ready?"
	panel._input.set_caret_column(panel._input.text.length())
	_press_enter(false)
	await _frames(3)
	_check("Enter sends and empties the composer", panel._input.text.is_empty() and panel._turn_in_flight, panel._input.text.replace("\n", "/"))
	_check("a failing turn ends", await _until(func() -> bool: return not panel._loading and panel.messages.size() == 6, 90.0))
	await _wait(0.6)
	var failed: Dictionary = panel.messages[panel.messages.size() - 1]
	_check("the failure is an error message", str(failed.get("role", "")) == "error", str(failed.get("text", "")))
	var saved_after_error: Variant = await _doc("advisor")
	_check("the error is saved with the transcript", typeof(saved_after_error) == TYPE_ARRAY and (saved_after_error as Array).size() == 6)
	var report := _find_button(panel, "💾 Save logging file")
	_check("the error offers its report button with the released tooltip", report != null and not report.disabled and report.tooltip_text == AdvisorPanel.SAVE_TIP)
	await _shoot("advisor-10-error")
	if report:
		var downloads := OS.get_environment("OH_NATIVE_DOWNLOADS")
		report.pressed.emit()
		_check("the report saves the log", await _until(func() -> bool: return _find_button(panel, "✓ Saved — attach the file to your report") != null, 30.0))
		var logs: Array = []
		if not downloads.is_empty():
			for file in DirAccess.get_files_at(downloads):
				if file.ends_with("advisor-error.txt"):
					logs.append(file)
		_check("the log file lands in the downloads folder", downloads.is_empty() or logs.size() == 1, str(logs))
		await _shoot("advisor-10b-report-saved")
		_check("the button returns to its label", await _until(func() -> bool: return _find_button(panel, "💾 Save logging file") != null, 10.0))
	var retry := _find_button(panel, "Retry")
	_check("Retry is offered on the last error", retry != null)
	if retry:
		retry.pressed.emit()
		await _frames(3)
		_check("Retry says it is retrying", _find_button(panel, "Retrying…") != null)
		await _shoot("advisor-11-retrying")
		_check("the retry ends", await _until(func() -> bool: return not panel._loading, 90.0))
		await _wait(0.4)
		_check("a retry replaces the error rather than asking twice", panel.messages.size() == 6 and str(panel.messages[4].get("role", "")) == "user" and str(panel.messages[5].get("role", "")) == "error")

	var with_details := {"role": "error", "text": "The provider answered 503: the model is overloaded.", "time": "2016-01-08", "diagnostics": {"Provider": "Gemini", "Status": 503, "Finish reason": "", "Frames": 0}}
	var computed: Dictionary = (await main.engine.request("advisor.views", {"json": JSON.stringify([with_details], "", false, true)})).get("result", {})
	panel.messages.append(with_details)
	panel.views.append((computed.get("views", [{}]) as Array)[0])
	panel._render()
	await _wait(0.4)
	var details := _find_button(panel, "Show details")
	_check("an error with diagnostics offers its details", details != null)
	if details:
		details.pressed.emit()
		await _frames(3)
		_check("the details open with the privacy note", _find_button(panel, "Hide details") != null and _find_text(panel, "No API key or endpoint is included. The model's own output is, so this may quote your campaign."))
		panel._set_loading(true)
		panel._set_loading(false)
		await _frames(3)
		_check("open details stay open when the row is drawn again", _find_button(panel, "Hide details") != null)
		panel.scroll.scroll_vertical = int(panel.scroll.get_v_scroll_bar().max_value)
		await _frames(3)
		await _shoot("advisor-12-error-details")
	panel.messages.pop_back()
	panel.views.pop_back()
	panel.messages.append({"role": "notice", "id": "notice-ui-check", "time": "2016-01-08", "reportId": "report-ui-check", "eventId": "", "channel": "diplomacy", "from": "Germany"})
	panel.views.append({"hidden": false, "title": "Berlin on the fiscal rules", "how": "from Germany, filed in our correspondence with them", "body": "Berlin, 8 January\n\nThe Chancellor welcomes the French proposal and asks that the finance ministers meet in Brussels before the summit.", "date": "Jan 8, 2016"})
	panel._render()
	await _wait(0.4)
	var read_it := _find_button(panel, "Read it")
	_check("a paper notice offers Read it", read_it != null)
	if read_it:
		read_it.pressed.emit()
		await _frames(3)
		_check("Read it opens the paper and turns into Put it away", read_it.text == "Put it away")
		panel.scroll.scroll_vertical = int(panel.scroll.get_v_scroll_bar().max_value)
		await _frames(3)
		await _shoot("advisor-13-paper-notice")
	panel.messages.pop_back()
	panel.views.pop_back()
	panel._render()

	var sample_text := "# Briefing\nA line with `inline code`, ~~struck~~ words and a [link](https://example.org).\n\n### Steps\n1. First step\n2. Second step\n   - nested point\n- [x] done item\n- [ ] open item\n\n#### Small label\n```\ncode block line\n```\n---\nAfter the rule.\n```chart\n{\"type\":\"line\",\"data\":{\"labels\":[\"Jan\",\"Feb\",\"Mar\",\"Apr\",\"May\"],\"datasets\":[{\"label\":\"Approval\",\"data\":[41,44,39,47,52]}]},\"options\":{\"unit\":\"percent\"}}\n```"
	var pie_text := "Where the budget goes:\n```chart\n{\"type\":\"doughnut\",\"data\":{\"labels\":[\"Defence\",\"Health\",\"Schools\",\"Debt\"],\"datasets\":[{\"label\":\"Share\",\"data\":[18,34,22,26]}]}}\n```"
	var samples := [{"role": "advisor", "text": sample_text, "time": "2016-01-08"}, {"role": "advisor", "text": pie_text, "time": "2016-01-08"}]
	var sample_views: Dictionary = (await main.engine.request("advisor.views", {"json": JSON.stringify(samples, "", false, true)})).get("result", {})
	for index in range(samples.size()):
		panel.messages.append(samples[index])
		panel.views.append((sample_views.get("views", [{}, {}]) as Array)[index])
	panel._render()
	await _wait(1.4)
	var line_chart := _find_chart(panel)
	_check("a line chart and a doughnut are drawn too", line_chart != null)
	panel.scroll.scroll_vertical = int(panel.scroll.get_v_scroll_bar().max_value) - 1130
	await _frames(3)
	await _shoot("advisor-14-markdown-and-line-chart")
	panel.scroll.scroll_vertical = int(panel.scroll.get_v_scroll_bar().max_value)
	await _wait(1.2)
	await _shoot("advisor-15-doughnut")
	panel.messages.pop_back()
	panel.views.pop_back()
	panel.messages.pop_back()
	panel.views.pop_back()
	panel._render()

	panel._load_failed = true
	panel._render_strip()
	await _wait(0.3)
	await _shoot("advisor-16-load-failed-strip")
	panel._load_failed = false
	panel._render_strip()

	var viewport_width := panel.get_viewport_rect().size.x
	var press := InputEventMouseButton.new()
	press.button_index = MOUSE_BUTTON_LEFT
	press.pressed = true
	panel._on_handle_input(press)
	var drag := InputEventMouseMotion.new()
	drag.global_position = Vector2(viewport_width - 520.0, 300.0)
	panel._on_handle_input(drag)
	var release := InputEventMouseButton.new()
	release.button_index = MOUSE_BUTTON_LEFT
	release.pressed = false
	panel._on_handle_input(release)
	await _wait(0.5)
	_check("dragging the left edge resizes the drawer", is_equal_approx(panel.current_width(), 520.0) and is_equal_approx(panel.offset_left, -520.0), str(panel.current_width()))
	_check("the HUD is told the new width", not widths.is_empty() and is_equal_approx(float(widths[widths.size() - 1]), 520.0))
	var stored_width: Dictionary = await main.engine.request("advisor.width")
	_check("the width is remembered when the drag ends", is_equal_approx(float(stored_width.get("result", 0)), 520.0))
	panel._apply_width(5000.0)
	_check("the drawer is no wider than the window less 376", is_equal_approx(panel.current_width(), viewport_width - 376.0), str(panel.current_width()))
	panel._apply_width(100.0)
	_check("the drawer is no narrower than 280", is_equal_approx(panel.current_width(), 280.0))
	panel._apply_width(520.0)
	panel.scroll.scroll_vertical = 0
	await _frames(3)
	await _shoot("advisor-17-wide")
	panel._apply_width(320.0)
	panel._save_width()

	var long: Array = panel.messages.duplicate(true)
	for index in range(14):
		long.append({"role": "user" if index % 2 == 0 else "advisor", "text": "Filler message %d." % index, "time": "2016-01-08"})
	var hidden: int = min(long.size() - 12, 20)
	var earlier_text := "Show %d earlier messages" % hidden
	await main.engine.request("advisor.save", {"json": JSON.stringify(long, "", false, true)})
	var second := AdvisorPanel.new()
	main.hud.add_child(second)
	second.setup(main.engine, {})
	panel.close()
	second.open()
	await _until(func() -> bool: return second._has_bootstrapped, 20.0)
	await _wait(0.6)
	_check("a long conversation shows its last twelve", _find_button(second, earlier_text) != null, earlier_text)
	second.scroll.scroll_vertical = 0
	await _frames(3)
	await _shoot("advisor-18-render-window")
	var earlier := _find_button(second, earlier_text)
	if earlier:
		earlier.pressed.emit()
		await _frames(3)
		_check("Show earlier brings the rest", _find_button(second, earlier_text) == null and second.messages.size() == long.size())
	second.close()
	await _wait(0.5)
	_check("closing slides the drawer back off the edge", is_equal_approx(second.offset_left, 0.0))
	second.queue_free()
	panel.open()
	await _wait(0.5)

	panel._on_clear_pressed()
	await _wait(1.0)
	var cleared: Variant = await _doc("advisor")
	_check("Clear chat empties the conversation and the file", panel.messages.is_empty() and typeof(cleared) == TYPE_ARRAY and (cleared as Array).is_empty())
	await _shoot("advisor-19-cleared")
	_say("%d failures" % failures.size())
	_finish(0 if failures.is_empty() else 1)


func _finish(code: int) -> void:
	main.engine.stop()
	await _frames(2)
	quit(code)
