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
	var redraw := Node2D.new()
	root.add_child(redraw)
	process_frame.connect(redraw.queue_redraw)
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


func _find_charts(node: Node) -> Array:
	var out: Array = []
	if node is AdvisorPanel.AdvisorChart and (node as Control).is_visible_in_tree():
		out.append(node)
	for child in node.get_children():
		out.append_array(_find_charts(child))
	return out


func _find_pictured(node: Node) -> RichTextLabel:
	if node is RichTextLabel and node.has_meta("pictures") and (node as Control).is_visible_in_tree():
		return node
	for child in node.get_children():
		var found := _find_pictured(child)
		if found:
			return found
	return null


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
	var built_by := Time.get_ticks_msec() + 30000
	while shell == null and Time.get_ticks_msec() < built_by:
		await process_frame
		shell = main.get("shell") as ShellBoot
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
	var proposals: Array = reply.get("actionProposals", []) if typeof(reply.get("actionProposals")) == TYPE_ARRAY else []
	_check("the reply carries its Action as a proposal, not a queued order", proposals.size() == 1 and not reply.has("actionsSummary") and str(reply.get("id", "")).begins_with("advisor-reply-") and str((proposals[0] as Dictionary).get("operation", "")) == "create" if not proposals.is_empty() else false, JSON.stringify(proposals))
	_check("the projects receipt is on the reply", typeof(reply.get("projectsSummary")) == TYPE_ARRAY)
	var actions: Variant = await _doc("actions")
	_check("nothing is queued before Proceed", not JSON.stringify(actions).contains("Convene the budget cabinet"))
	var saved: Variant = await _doc("advisor")
	_check("the transcript was saved", typeof(saved) == TYPE_ARRAY and (saved as Array).size() == 2, str((saved as Array).size()) if typeof(saved) == TYPE_ARRAY else "none")
	_check("the proposal card names the Action and offers Discuss and Proceed", _find_text(panel, "Convene the budget cabinet") and _find_text(panel, "Proposed") and _labels_with(panel, "Proposed Action") and _find_button(panel, "Discuss") != null and _find_button(panel, "Proceed / Queue") != null)
	_conversation_look()
	await _shoot("advisor-04-receipts")
	var discuss := _find_button(panel, "Discuss")
	if discuss:
		panel._input.text = ""
		discuss.pressed.emit()
		await _frames(2)
		_check("Discuss puts the proposal in the composer and sends nothing", panel._input.text == "Let's discuss the proposed Action \"Convene the budget cabinet\" before I authorize it." and not panel._loading and panel.messages.size() == 2, panel._input.text)
		panel._input.text = "Keep it short."
		discuss.pressed.emit()
		await _frames(2)
		_check("Discuss keeps what was already typed", panel._input.text == "Keep it short.\n\nLet's discuss the proposed Action \"Convene the budget cabinet\" before I authorize it.", panel._input.text.replace("\n", "/"))
		panel._input.text = ""
		panel._resize_input()
		panel._update_send()
	var proceed := _find_button(panel, "Proceed / Queue")
	if proceed:
		await _scroll_to(proceed)
		await _shoot("advisor-04b-proposal")
		proceed.pressed.emit()
		_check("Proceed queues the Action", await _until(func() -> bool: return _find_text(panel, "Queued"), 20.0))
		await _frames(3)
		actions = await _doc("actions")
		_check("the Action is on the Actions board once", JSON.stringify(actions).count("Convene the budget cabinet") == 1, JSON.stringify(actions).left(300))
		saved = await _doc("advisor")
		var receipts: Variant = panel.messages[1].get("actionReceipts")
		_check("the receipt is kept on the reply and in the file", typeof(receipts) == TYPE_DICTIONARY and str(((receipts as Dictionary).get("proposal-0", {}) as Dictionary).get("status", "")) == "queued" and JSON.stringify(saved).contains("\"actionReceipts\""))
		_check("a confirmed card says the board took it", _find_text(panel, "Confirmed by Actions board. Execution still requires game-time resolution.") and _find_button(panel, "Proceed / Queue") == null and _find_button(panel, "Discuss") == null)
		var again: Dictionary = await main.engine.request("advisor.proceed", {"threadId": "chief", "messageId": str(panel.messages[1].get("id", "")), "proposalId": "proposal-0"})
		var again_result: Dictionary = again.get("result", {}) if again.get("ok", false) else {}
		_check("approving the same proposal twice queues it once", bool(again_result.get("ok", false)) and JSON.stringify(await _doc("actions")).count("Convene the budget cabinet") == 1, JSON.stringify(again_result))
		var queued_id := str((again_result.get("receipt", {}) as Dictionary).get("actionId", ""))
		var removal := {"role": "advisor", "id": "advisor-reply-removalcheck-0001", "text": "We could drop it.", "time": "2016-01-01", "actionProposals": [{"id": "proposal-0", "actionId": "action-advisor-reply-removalcheck-0001-0", "operation": "remove", "targetId": queued_id}]}
		var removal_views: Dictionary = (await main.engine.request("advisor.views", {"json": JSON.stringify([removal], "", false, true)})).get("result", {})
		panel.messages.append(removal)
		panel.views.append((removal_views.get("views", [{}]) as Array)[0])
		panel._render()
		await _wait(0.4)
		_check("a proposal to remove an order names the order, never its id", _labels_with(panel, "Remove proposed Action") and _labels_with(panel, "Existing Action: Convene the budget cabinet") and _find_button(panel, "Proceed / Remove") != null and not _labels_with(panel, queued_id))
		await _scroll_to(_find_button(panel, "Proceed / Remove"))
		await _shoot("advisor-04d-removal-proposal")
		panel.messages.pop_back()
		panel.views.pop_back()
		panel._render()
		await _frames(2)
		await _scroll_to(_find_button(panel, "Open Actions"))
		await _shoot("advisor-04c-proposal-queued")
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
		panel._set_loading(true)
		panel._set_loading(false)
		await _frames(2)
		_check("the hand-off survives a re-render of the row", _find_button(panel, "✓ In Diplomacy — press send there") != null)
		await _shoot("advisor-07-draft-handed")
		await _wait(3.3)
		_check("the button comes back after three seconds", _find_button(panel, "✉️ Draft to Germany") != null)
		_check("a letter not yet sent says nothing of it", not _find_text(panel, "Already sent to Germany."))
		var letter := "Chancellor, France proposes that our finance ministers meet before the next summit to agree a common position on the fiscal rules."
		await main.engine.request("chat.create", {"chat": {"id": "chat-sent-germany", "title": "Germany", "countries": [{"name": "Germany"}], "status": "open", "messages": [{"id": "m-sent-1", "role": "user", "text": letter, "time": "2016-01-04"}]}})
		await panel._refresh_views()
		await _frames(3)
		var note := ""
		for view in panel.views:
			for drafted in ((view as Dictionary).get("messageDrafts", []) if (view as Dictionary).get("messageDrafts") is Array else []):
				if not str((drafted as Dictionary).get("sentNote", "")).is_empty():
					note = str(drafted["sentNote"])
		_check("a letter already sent to that country says when it went", note.begins_with("Already sent to Germany on ") and _find_text(panel, note), note)
		await _shoot("advisor-07b-already-sent")

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
	var errors := _bubbles("error")
	var error_style: StyleBoxFlat = (errors[errors.size() - 1] as PanelContainer).get_theme_stylebox("panel") as StyleBoxFlat if not errors.is_empty() else null
	_check("an error keeps its own treatment: a red rail, a faint red ground, the full width", error_style != null and error_style.border_width_left == 2 and error_style.border_color == Color("#d78686") and error_style.bg_color.r > error_style.bg_color.b and absf((errors[errors.size() - 1] as Control).size.x - panel._list_width()) < 2.0 and _labels_with(panel, " Error"))
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
		_check("Retry says it is retrying", _find_button(panel, "Retrying…") != null)
		await _frames(3)
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
		var notices := _bubbles("notice")
		var notice_style: StyleBoxFlat = (notices[0] as PanelContainer).get_theme_stylebox("panel") as StyleBoxFlat if not notices.is_empty() else null
		_check("a paper notice keeps its own amber rail across the width", notice_style != null and notice_style.border_color == Color("#be9d60") and notice_style.border_width_left == 2 and absf((notices[0] as Control).size.x - panel._list_width()) < 2.0)
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

	var bars_text := "Where the money goes:\n```chart\n{\"type\":\"bar\",\"data\":{\"labels\":[\"Army\",\"Navy\",\"Air force\"],\"datasets\":[{\"label\":\"Budget\",\"data\":[42,27,31],\"backgroundColor\":[\"#34d399\",\"#f472b6\",\"#fbbf24\"]}]},\"options\":{\"indexAxis\":\"y\",\"plugins\":{\"title\":{\"display\":true,\"text\":\"Defence budget\"}},\"scales\":{\"y\":{\"title\":{\"display\":true,\"text\":\"Branch\"}}}}}\n```"
	var line_text := "Approval since the election:\n```chart\n{\"type\":\"line\",\"data\":{\"labels\":[\"Jan\",\"Feb\",\"Mar\",\"Apr\"],\"datasets\":[{\"label\":\"Approval\",\"data\":[41,44,39,47],\"fill\":true,\"tension\":0,\"borderDash\":[6,4],\"pointRadius\":0}]},\"options\":{\"plugins\":{\"subtitle\":{\"display\":true,\"text\":\"Monthly polls\"}},\"scales\":{\"y\":{\"min\":0,\"max\":100,\"title\":{\"display\":true,\"text\":\"Per cent\"}},\"x\":{\"title\":{\"display\":true,\"text\":\"Month\"}}}}}\n```"
	var picture_text := "Our crest: ![Crest](/icon-192.png \"The crest\") and a seal ![Seal](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==). A stranger's ![Remote crest](https://example.org/crest.png) and ![](/api/library) stay links."
	var option_samples := [{"role": "advisor", "text": bars_text, "time": "2016-01-08"}, {"role": "advisor", "text": line_text, "time": "2016-01-08"}, {"role": "advisor", "text": picture_text, "time": "2016-01-08"}]
	var option_views: Dictionary = (await main.engine.request("advisor.views", {"json": JSON.stringify(option_samples, "", false, true)})).get("result", {})
	for index in range(option_samples.size()):
		panel.messages.append(option_samples[index])
		panel.views.append((option_views.get("views", [{}, {}, {}]) as Array)[index])
	panel._render()
	await _wait(1.4)
	var charts := _find_charts(panel)
	var bars_chart: Control = charts[charts.size() - 2] if charts.size() >= 2 else null
	var line_chart_2: Control = charts[charts.size() - 1] if charts.size() >= 2 else null
	_check("charts with options beyond the unit are drawn", bars_chart != null and line_chart_2 != null)
	if bars_chart and line_chart_2:
		await _scroll_to(bars_chart)
		await _wait(1.2)
		var bar_hits: Array = bars_chart.get("_hits")
		var colours: Array = []
		var heights: Array = []
		for hit in bar_hits:
			colours.append(((hit as Dictionary)["color"] as Color).to_html(false))
			heights.append(snappedf(((hit as Dictionary)["rect"] as Rect2).size.y, 0.1))
		_check("a bar per label, each in its own colour", colours == ["34d399", "f472b6", "fbbf24"], str(colours))
		_check("indexAxis y lays the bars on their side", bar_hits.size() == 3 and heights[0] == heights[1] and ((bar_hits[0] as Dictionary)["rect"] as Rect2).size.x > ((bar_hits[1] as Dictionary)["rect"] as Rect2).size.x, str(heights))
		_check("the chart title and the axis title are read", not (bars_chart.call("_box", "title") as Dictionary).is_empty() and (bars_chart.call("_axis", "y") as Dictionary)["title"] == PackedStringArray(["Branch"]))
		if not bar_hits.is_empty():
			var bar_motion := InputEventMouseMotion.new()
			bar_motion.position = ((bar_hits[0] as Dictionary)["rect"] as Rect2).get_center()
			bars_chart._gui_input(bar_motion)
		await _frames(3)
		await _shoot("advisor-15b-horizontal-bars")
		await _scroll_to(line_chart_2)
		await _wait(1.2)
		var y_ticks: Array = line_chart_2.call("_ticks", line_chart_2.call("_axis", "y"), Vector2(0, 100), 130.0, false)
		_check("a y scale with min and max runs from 0 to 100", not y_ticks.is_empty() and float(y_ticks[0]) == 0.0 and float(y_ticks[y_ticks.size() - 1]) == 100.0, str(y_ticks))
		var line_series: Dictionary = (line_chart_2.get("series") as Array)[0]
		_check("the line keeps its fill, straight segments, dashes and hidden points", str(line_series.get("fill", "")) == "origin" and float(line_series.get("tension", -1.0)) == 0.0 and (line_series.get("dash", []) as Array).size() == 2 and float((line_series.get("point_radius", [3]) as Array)[0]) == 0.0)
		await _shoot("advisor-15c-line-options")
	var picture_label: RichTextLabel = _find_pictured(panel)
	_check("a reply with pictures fills its paragraph with them", picture_label != null)
	await _until(func() -> bool: return AdvisorPanel._pictures.get("/icon-192.png") is Texture2D, 15.0)
	await _wait(0.4)
	_check("a picture from the game's own address is drawn", AdvisorPanel._pictures.get("/icon-192.png") is Texture2D)
	_check("a data: picture is drawn", AdvisorPanel._pictures.keys().any(func(key: Variant) -> bool: return str(key).begins_with("data:image/png") and AdvisorPanel._pictures[key] is Texture2D))
	_check("pictures from elsewhere and from the API stay links, as React keeps them", picture_label != null and picture_label.get_parsed_text().contains("Remote crest") and picture_label.get_parsed_text().contains("/api/library") and not AdvisorPanel._pictures.has("/api/library"))
	if picture_label:
		await _scroll_to(picture_label)
		await _wait(0.3)
	await _shoot("advisor-15d-pictures")
	for index in range(option_samples.size()):
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
	await _contacts()
	_say("%d failures" % failures.size())
	_finish(0 if failures.is_empty() else 1)


func _trigger(name: String, chevron: String, retired := false) -> Button:
	var toggle: Button = panel._recipient_trigger
	if toggle == null or not is_instance_valid(toggle) or not toggle.is_visible_in_tree():
		return null
	if _find_text(toggle, name) and _find_text(toggle, chevron) and _find_text(toggle, "(retired)") == retired:
		return toggle
	return null


func _bubbles(role: String) -> Array:
	var found: Array = []
	var queue: Array = [panel.body]
	while not queue.is_empty():
		var node: Node = queue.pop_front()
		if node is PanelContainer and str(node.get_meta("role", "")) == role and (node as Control).is_visible_in_tree():
			found.append(node)
		queue.append_array(node.get_children())
	return found


func _conversation_look() -> void:
	_check("the drawer is a dark navy conversation surface", panel.tint == Color("#111d2a"))
	_check("the header reads ADVISOR beside a ◇", panel.header_title.uppercase and panel.header_title.get_parent().get_parent().get_child(0) is Label and (panel.header_title.get_parent().get_parent().get_child(0) as Label).text == "◇")
	_check("the send button is a conventional arrow, not a rocket", panel._send_button.text.is_empty() and panel._send_button.icon != null and panel._send_button.tooltip_text == "Send message" and panel._send_button.custom_minimum_size == Vector2(42, 42) and _find_button(panel, "🚀") == null)
	var normal := panel._input.get_theme_stylebox("normal") as StyleBoxFlat
	_check("the composer is a rectangular navy field", normal != null and normal.bg_color == Color("#192b3b") and normal.corner_radius_top_left == 6 and panel._input.custom_minimum_size.y >= 42.0)
	var users := _bubbles("user")
	var replies := _bubbles("advisor")
	var user_style: StyleBoxFlat = (users[0] as PanelContainer).get_theme_stylebox("panel") as StyleBoxFlat if not users.is_empty() else null
	var reply_style: StyleBoxFlat = (replies[0] as PanelContainer).get_theme_stylebox("panel") as StyleBoxFlat if not replies.is_empty() else null
	_check("the player's message stays a compact blue-toned box on the right", user_style != null and user_style.bg_color == Color("#27475e") and (users[0] as Control).size_flags_horizontal == Control.SIZE_SHRINK_END and (users[0] as Control).size.x <= panel._list_width() * 0.89 + 1.0)
	_check("a reply is open text on a narrow left rail, the full width", reply_style != null and reply_style.bg_color.a == 0.0 and reply_style.border_width_left == 2 and reply_style.border_color == Color("#3b6681") and absf((replies[0] as Control).size.x - panel._list_width()) < 2.0)
	var speaker := _speaker_label()
	_check("the speaker is named in the accent", speaker != null and speaker.get_theme_color("font_color") == Color("#85cbe6"))


func _speaker_label() -> Label:
	var queue: Array = [panel.body]
	while not queue.is_empty():
		var node: Node = queue.pop_front()
		if node is Label and (node as Label).text.begins_with(" ") and (node as Label).get_parent() is HBoxContainer and (node as Label).get_parent().get_child(0) is Label and ((node as Label).get_parent().get_child(0) as Label).text == "🧭" and (node as Label).is_visible_in_tree():
			return node
		queue.append_array(node.get_children())
	return null


func _picker_look() -> void:
	var selects: Array = []
	var queue: Array = [panel]
	while not queue.is_empty():
		var node: Node = queue.pop_front()
		if node is AdvisorPanel.RecipientRow and (node as Control).is_visible_in_tree():
			selects.append(node)
		queue.append_array(node.get_children())
	var current: Variant = selects.filter(func(node: Node) -> bool: return bool(node.get_meta("current", false)))
	var current_style: StyleBoxFlat = (current[0] as PanelContainer).get_theme_stylebox("panel") as StyleBoxFlat if (current as Array).size() == 1 else null
	_check("the contact list is a ledger with the open conversation marked by an accent rail", current_style != null and current_style.border_width_left == 2 and current_style.border_color == Color("#85cbe6") and current_style.corner_radius_top_left == 0)
	var edit := _find_tipped(panel, "Edit", "Edit chief advisor")
	var edit_style: StyleBoxFlat = edit.get_theme_stylebox("normal") as StyleBoxFlat if edit else null
	_check("Edit is a quiet outlined action", edit_style != null and edit_style.bg_color.a == 0.0 and edit_style.corner_radius_top_left == 5)
	await _shoot("advisor-19b-contact-ledger")
	if (current as Array).size() == 1:
		(current[0] as AdvisorPanel.RecipientRow).pressed.emit()
		await _frames(3)
	_check("choosing a conversation folds the list away", not panel._recipients_open and _trigger("Chief advisor", "▾") != null)
	_trigger("Chief advisor", "▾").pressed.emit()
	await _frames(3)


func _contact_named(name: String) -> Dictionary:
	for item in panel.contacts:
		if str((item as Dictionary).get("name", "")) == name:
			return item
	return {}


func _labels_with(node: Node, text: String) -> bool:
	if node is Label and (node as Label).text.contains(text) and (node as Label).is_visible_in_tree():
		return true
	if node is Button and (node as Button).text.contains(text) and (node as Button).is_visible_in_tree():
		return true
	if node is RichTextLabel and (node as RichTextLabel).get_parsed_text().contains(text) and (node as RichTextLabel).is_visible_in_tree():
		return true
	for child in node.get_children():
		if _labels_with(child, text):
			return true
	return false


func _find_option_with(node: Node, item: String) -> OptionButton:
	if node is OptionButton and (node as OptionButton).is_visible_in_tree() and _option_index(node as OptionButton, item) >= 0:
		return node as OptionButton
	for child in node.get_children():
		var found := _find_option_with(child, item)
		if found:
			return found
	return null


func _option_index(choose: OptionButton, item: String) -> int:
	if choose == null:
		return -1
	for index in range(choose.item_count):
		if choose.get_item_text(index) == item:
			return index
	return -1


func _pick(choose: OptionButton, item: String) -> void:
	var at := _option_index(choose, item)
	if at >= 0:
		choose.select(at)
		choose.item_selected.emit(at)
	await _frames(3)


func _find_tipped(node: Node, text: String, tip: String) -> Button:
	if node is Button and (node as Button).text == text and (node as Button).tooltip_text == tip and (node as Button).is_visible_in_tree():
		return node as Button
	for child in node.get_children():
		var found := _find_tipped(child, text, tip)
		if found:
			return found
	return null


func _row_button(node: Node, name: String, text: String) -> Button:
	if node is HBoxContainer and _find_text(node, name):
		var found := _find_button(node, text)
		if found:
			return found
	for child in node.get_children():
		var found := _row_button(child, name, text)
		if found:
			return found
	return null


func _ask_panel(text: String, count: int) -> bool:
	panel._input.text = text
	panel._update_send()
	panel._send_from_composer()
	return await _until(func() -> bool: return not panel._loading and panel.messages.size() == count, 90.0)


func _contacts() -> void:
	var seeded: Dictionary = await main.engine.request("country.standin_seed")
	_check("the player's government is in the Political World", seeded.get("ok", false))
	_check("the two offices of the player's government are offered", await _until(func() -> bool: return panel.offices.size() == 2, 15.0), str(panel.offices))
	_check("the recipients bar reads Chief advisor with + Contact", _trigger("Chief advisor", "▾") != null and _find_button(panel, "+ Contact") != null and _find_button(panel, "+ Contact").tooltip_text == "Add an official or advisor")
	_trigger("Chief advisor", "▾").pressed.emit()
	await _frames(3)
	_check("the list opens with the original conversation and its Edit", _trigger("Chief advisor", "▴") != null and _labels_with(panel, "Chief advisor · Original conversation") and _find_tipped(panel, "Edit", "Edit chief advisor") != null)
	await _picker_look()
	_find_button(panel, "+ Contact").pressed.emit()
	await _frames(3)
	var kinds := _find_option_with(panel, "Advisor / Minister")
	_check("a new recipient is an Advisor / Minister, one of four types", kinds != null and kinds.get_item_text(kinds.selected) == "Advisor / Minister" and kinds.item_count == 4 and _option_index(kinds, "Citizen / Civilian") >= 0 and _option_index(kinds, "Foreign Official") >= 0 and _option_index(kinds, "Other Character") >= 0)
	_check("the editor offers a link to the Political World", _find_text(panel, "Add recipient") and _find_text(panel, "Recipient type") and _find_text(panel, "Link to Political World (optional)") and _find_text(panel, "Name") and _find_text(panel, "Government position") and _find_text(panel, "Personality and principles") and _find_text(panel, "0/1200"))
	var save_button := _find_button(panel, "Save recipient")
	_check("Save recipient waits for a name and a position", save_button != null and save_button.disabled)
	var choose := _find_option_with(panel, "Head of government: Manuel Valls")
	_check("the head of government is offered by name", choose != null and choose.get_item_text(0) == "Independent / custom official")
	if choose:
		await _pick(choose, "Head of government: Manuel Valls")
	_check("a linked contact takes the officeholder's name and says so", str(panel._recipient_draft.get("name", "")) == "Manuel Valls" and _find_text(panel, "Linked to head of government: Manuel Valls. A replacement will not inherit this conversation."))
	var fixed := _find_option_with(panel, "Advisor / Minister")
	_check("a linked contact's type is fixed", fixed != null and fixed.disabled)
	panel._recipient_draft["personality"] = "Blunt about the deficit.\nLoyal to the President."
	await _shoot("advisor-20-contact-editor")
	panel._submit_recipient()
	_check("saving the contact opens its conversation", await _until(func() -> bool: return panel.active_thread != "chief" and not panel._thread_switching, 15.0), panel.active_thread)
	await _frames(3)
	var valls := _contact_named("Manuel Valls")
	_check("the contact is kept with its link, type and personality", not valls.is_empty() and str(valls.get("title", "")) == "Head of government" and typeof(valls.get("binding")) == TYPE_DICTIONARY and str(valls.get("recipientType", "")) == "advisor-minister" and str(valls.get("personality", "")) == "Blunt about the deficit.\nLoyal to the President." and str(valls.get("status", "")) == "current", JSON.stringify(valls))
	_check("the bar names the contact and its office", _trigger("Manuel Valls", "▴") != null and _find_text(panel, "Head of government · Political World"))
	_check("the list gives the contact's type", _labels_with(panel, "Head of government · Advisor / Minister"))
	_check("the composer is addressed to the contact", panel._input.placeholder_text == "Message Manuel Valls…" and panel.messages.is_empty(), panel._input.placeholder_text)
	var actions_before := JSON.stringify(await _doc("actions")).count("Convene the budget cabinet")
	_check("the contact answers", await _ask_panel("What do you make of the budget?", 2), str(panel.messages.size()))
	await _wait(0.8)
	var answer: Dictionary = panel.messages[1] if panel.messages.size() > 1 else {}
	_check("the contact speaks under its own name", _labels_with(panel, " Manuel Valls") and not _find_text(panel, " Advisor"))
	var minister_proposals: Array = answer.get("actionProposals", []) if typeof(answer.get("actionProposals")) == TYPE_ARRAY else []
	_check("a minister's Action waits for the player's review", str(answer.get("role", "")) == "advisor" and minister_proposals.size() == 1 and not bool(answer.get("suggestionsNotApplied", false)) and not answer.has("actionsSummary") and JSON.stringify(await _doc("actions")).count("Convene the budget cabinet") == actions_before)
	_check("a minister's Projects go on the board", typeof(answer.get("projectsSummary")) == TYPE_ARRAY, JSON.stringify(answer.get("projectsSummary")))
	_check("a minister drafts letters but places no troops", _find_button(panel, "✉️ Draft to Germany") != null and _find_button(panel, "📍 Place Brigade de Lorraine here") == null)
	var minister_proceed := _find_button(panel, "Proceed / Queue")
	_check("a minister's proposal has its Proceed", minister_proceed != null)
	if minister_proceed:
		await _scroll_to(minister_proceed)
		minister_proceed.pressed.emit()
		_check("Proceed answers", await _until(func() -> bool: return _find_button(panel, "Queueing…") == null and not panel._loading and panel._side_effects == 0, 20.0))
		await _frames(3)
		_check("an order already given is refused on the card, not queued twice", _labels_with(panel, "so it was not queued again") and JSON.stringify(await _doc("actions")).count("Convene the budget cabinet") == actions_before)
		await _shoot("advisor-21b-minister-proposal-refused")
	var stored: Variant = await _doc("advisor")
	var stored_text := JSON.stringify(stored)
	_check("the contact and its conversation share the advisor file", typeof(stored) == TYPE_ARRAY and stored_text.contains("advisor-contact") and stored_text.count("\"threadId\":\"%s\"" % panel.active_thread) == 2, stored_text.left(300))
	panel.scroll.scroll_vertical = 0
	await _frames(3)
	await _shoot("advisor-21-contact-reply")
	var contact_thread: String = panel.active_thread
	await panel._select_recipient("chief")
	_check("the chief advisor's conversation is its own", panel.active_thread == "chief" and panel.messages.is_empty() and panel._input.placeholder_text.begins_with("Ask your advisor…"))
	await panel._select_recipient(contact_thread)
	_check("and the contact's comes back with it", panel.active_thread == contact_thread and panel.messages.size() == 2)
	await _frames(3)
	var retire := _row_button(panel, "Manuel Valls", "Retire")
	_check("each contact offers Retire", retire != null and retire.tooltip_text == "Retire contact")
	if retire:
		retire.pressed.emit()
		await _frames(3)
	_check("Retire asks Cancel or Retire contact", _find_text(panel, "Retire Manuel Valls?") and _find_text(panel, "The conversation and personality will be preserved. You can restore this contact later.") and _find_button(panel, "Cancel") != null and _find_button(panel, "Retire contact") != null and not bool(_contact_named("Manuel Valls").get("archived", false)))
	await _shoot("advisor-22a-retire-confirm")
	if _find_button(panel, "Cancel"):
		_find_button(panel, "Cancel").pressed.emit()
		await _frames(3)
	_check("Cancel keeps the contact", not _find_text(panel, "Retire Manuel Valls?") and not bool(_contact_named("Manuel Valls").get("archived", false)))
	await panel._retire_recipient(_contact_named("Manuel Valls"), true)
	_check("nothing is retired without the explicit choice", not bool(_contact_named("Manuel Valls").get("archived", false)))
	retire = _row_button(panel, "Manuel Valls", "Retire")
	if retire:
		retire.pressed.emit()
		await _frames(3)
	if _find_button(panel, "Retire contact"):
		_find_button(panel, "Retire contact").pressed.emit()
	await _until(func() -> bool: return panel.active_thread == "chief" and not panel._thread_switching and bool(_contact_named("Manuel Valls").get("archived", false)), 10.0)
	await _frames(3)
	_check("a retired contact leaves for the chief advisor", bool(_contact_named("Manuel Valls").get("archived", false)) and panel.active_thread == "chief" and _find_button(panel, "Show retired contacts") != null)
	_find_button(panel, "Show retired contacts").pressed.emit()
	await _frames(3)
	_check("retired contacts can be shown", _find_text(panel, "Manuel Valls · Retired") and _find_button(panel, "Restore") != null)
	await panel._select_recipient(contact_thread)
	await _frames(3)
	panel._input.text = "One more thing."
	panel._update_send()
	_check("a retired contact cannot be written to", panel._input.placeholder_text == "This contact is retired — restore to reply" and not panel._input.editable and panel._send_button.disabled and _trigger("Manuel Valls", "▴", true) != null)
	_check("a retired contact's proposals cannot be approved", _find_button(panel, "Proceed / Queue") == null and _find_button(panel, "Discuss") == null)
	await _shoot("advisor-22-contact-retired")
	await panel._retire_recipient(_contact_named("Manuel Valls"), false)
	await _frames(3)
	panel._update_send()
	_check("Restore lets it be written to again", not bool(_contact_named("Manuel Valls").get("archived", true)) and panel._input.editable and not panel._send_button.disabled)
	panel._input.text = ""
	panel._open_recipient_editor(_contact_named("Manuel Valls"))
	await _frames(3)
	var linked_type := _find_option_with(panel, "Advisor / Minister")
	_check("Edit keeps a linked name and type fixed", _find_text(panel, "Edit recipient") and _find_option_with(panel, "Independent / custom official") == null and linked_type != null and linked_type.disabled and _find_text(panel, "Recipient type can only change before conversation history exists."))
	panel._recipient_draft["title"] = "Prime Minister"
	await panel._submit_recipient()
	_check("an edit is saved", str(_contact_named("Manuel Valls").get("title", "")) == "Prime Minister" and panel._recipient_editor.is_empty())
	await _shoot("advisor-23-contact-edited")
	await _character()
	await _chief_identity()
	await _unsupported_type()


func _character() -> void:
	var before_thread: String = panel.active_thread
	_find_button(panel, "+ Contact").pressed.emit()
	await _frames(3)
	var kinds := _find_option_with(panel, "Citizen / Civilian")
	_check("the type list is offered for a new contact", kinds != null)
	if kinds:
		await _pick(kinds, "Citizen / Civilian")
	_check("a character needs no Political World office", str(panel._recipient_draft.get("recipientType", "")) == "citizen-civilian" and not _find_text(panel, "Link to Political World (optional)") and _find_text(panel, "Position / role") and _find_text(panel, "You can speak with this character without a Political World office. Only public scenario information is available to them."))
	panel._recipient_draft["name"] = "Jeanne Martin"
	panel._recipient_draft["title"] = "Baker in Lyon"
	panel._recipient_draft["personality"] = "Plain-spoken; worried about the price of bread."
	panel._render_recipients()
	await _frames(2)
	await _shoot("advisor-24-character-editor")
	panel._submit_recipient()
	_check("saving the character opens its conversation", await _until(func() -> bool: return panel.active_thread != before_thread and panel.active_thread != "chief" and not panel._thread_switching, 15.0), panel.active_thread)
	await _frames(3)
	var jeanne := _contact_named("Jeanne Martin")
	_check("the character is kept as a Citizen / Civilian with no office", str(jeanne.get("recipientType", "")) == "citizen-civilian" and typeof(jeanne.get("binding")) != TYPE_DICTIONARY, JSON.stringify(jeanne))
	_check("a character's conversation says what it can see", _find_text(panel, "This character uses only the public scenario timeline and their own conversation history. Private government records and diplomacy are not shared.") and _find_text(panel, "No messages yet. Start your conversation.") and panel._input.placeholder_text == "Message Jeanne Martin…", panel._input.placeholder_text)
	_check("the list gives the character's type", _labels_with(panel, "Baker in Lyon · Citizen / Civilian"))
	var actions_before := JSON.stringify(await _doc("actions")).count("Hold a rally for the budget")
	_check("the character answers", await _ask_panel("What are people saying about the budget?", 2), str(panel.messages.size()))
	await _wait(0.6)
	var said: Dictionary = panel.messages[1] if panel.messages.size() > 1 else {}
	_check("the character speaks from public context only", str(said.get("role", "")) == "advisor" and str(said.get("text", "")).begins_with("I only know what the papers print") and not str(said.get("text", "")).contains("LEAKED"), str(said.get("text", "")).left(160))
	var world_text := JSON.stringify(await _doc("world"))
	_check("a character's Actions and Projects are not applied", bool(said.get("suggestionsNotApplied", false)) and not said.has("actionProposals") and not said.has("projectsSummary") and not world_text.contains("Neighbourhood Budget Committee") and JSON.stringify(await _doc("actions")).count("Hold a rally for the budget") == actions_before)
	_check("and the reply says so, with nothing to approve", _find_text(panel, "This official's suggested Actions or Projects were not applied. Authorize them through your chief advisor or the relevant panel.") and _find_button(panel, "Proceed / Queue") == null)
	_check("a character speaks under its own name", _labels_with(panel, " Jeanne Martin"))
	var forged: Dictionary = await main.engine.request("advisor.proceed", {"threadId": panel.active_thread, "messageId": str(said.get("id", "")), "proposalId": "proposal-0"})
	var forged_result: Dictionary = forged.get("result", {}) if forged.get("ok", false) else {}
	_check("a character cannot submit an Action even when asked directly", not bool(forged_result.get("ok", true)) and str(forged_result.get("error", "")).contains("Only an active domestic Advisor / Minister conversation"), JSON.stringify(forged_result))
	await _shoot("advisor-25-character-reply")
	panel._open_recipient_editor(_contact_named("Jeanne Martin"))
	await _frames(3)
	var retype := _find_option_with(panel, "Advisor / Minister")
	if retype:
		await _pick(retype, "Advisor / Minister")
	await panel._submit_recipient()
	await _frames(3)
	_check("a character with history cannot become a minister", str(_contact_named("Jeanne Martin").get("recipientType", "")) == "citizen-civilian" and panel._recipient_error.contains("Cannot change a recipient type with existing conversation history"), panel._recipient_error)
	panel._recipient_editor = ""
	panel._recipient_error = ""
	panel._render_recipients()


func _chief_identity() -> void:
	await panel._select_recipient("chief")
	await _frames(3)
	panel._recipients_open = true
	panel._render_recipients()
	await _frames(2)
	var edit := _find_tipped(panel, "Edit", "Edit chief advisor")
	_check("the chief advisor has Edit and no Retire", edit != null and edit.get_parent().get_child_count() == 2)
	if edit:
		edit.pressed.emit()
		await _frames(3)
	_check("the chief advisor opens in its own editor", _find_text(panel, "Edit chief advisor") and _find_text(panel, "Position / title") and not _find_text(panel, "Recipient type") and _find_button(panel, "Save chief advisor") != null and _find_button(panel, "Restore scenario defaults") == null and str(panel._recipient_draft.get("name", "")) == "Chief advisor" and str(panel._recipient_draft.get("title", "")) == "Chief advisor")
	panel._recipient_draft["name"] = "Dmitri Orlov"
	panel._recipient_draft["title"] = "Chief of Staff"
	panel._recipient_draft["personality"] = "Candid and pragmatic; challenges weak arguments."
	await panel._submit_recipient()
	await _frames(3)
	_check("the chief advisor takes its new name and title", str(panel.chief_profile.get("name", "")) == "Dmitri Orlov" and _trigger("Dmitri Orlov", "▴") != null and _find_text(panel, "Chief of Staff") and _labels_with(panel, "Dmitri Orlov · Original conversation") and panel._input.placeholder_text == "Message Dmitri Orlov…", panel._input.placeholder_text)
	var stored := JSON.stringify(await _doc("advisor"))
	_check("the identity is kept as its own record", stored.contains("advisor-chief-profile") and stored.contains("Candid and pragmatic"))
	await _shoot("advisor-26-chief-customised")
	var before := panel.messages.size()
	_check("the chief advisor answers", await _ask_panel("Who am I speaking with?", before + 2), str(panel.messages.size()))
	await _wait(0.6)
	var reply: Dictionary = panel.messages[panel.messages.size() - 1]
	_check("the chief advisor answers as its new self", str(reply.get("text", "")).begins_with("I am Dmitri Orlov.") and _labels_with(panel, " Dmitri Orlov"), str(reply.get("text", "")).left(80))
	_check("the chief's Action still waits for review", typeof(reply.get("actionProposals")) == TYPE_ARRAY and not reply.has("actionsSummary"))
	await _shoot("advisor-27-chief-reply")
	edit = _find_tipped(panel, "Edit", "Edit chief advisor")
	if edit:
		edit.pressed.emit()
		await _frames(3)
	var defaults := _find_button(panel, "Restore scenario defaults")
	_check("Restore scenario defaults is offered once customised", defaults != null and str(panel._recipient_draft.get("name", "")) == "Dmitri Orlov")
	if defaults:
		defaults.pressed.emit()
		await _until(func() -> bool: return panel.chief_profile.is_empty() and not panel._recipient_saving, 10.0)
		await _frames(3)
	stored = JSON.stringify(await _doc("advisor"))
	_check("Restore scenario defaults brings back the scenario's advisor and keeps the conversation", panel.chief_profile.is_empty() and _trigger("Chief advisor", "▴") != null and not stored.contains("advisor-chief-profile") and stored.contains("Who am I speaking with?") and panel.messages.size() == before + 2 and panel._recipient_editor.is_empty())


func _unsupported_type() -> void:
	var kept_contacts: Array = panel.contacts.duplicate(true)
	var kept_thread: String = panel.active_thread
	panel.contacts.append({"id": "advisor-unknownkind01", "name": "Odd Visitor", "title": "Unknown", "personality": "", "recipientType": "", "typeLabel": "", "archived": false, "binding": null, "status": "unbound"})
	panel.active_thread = "advisor-unknownkind01"
	panel._apply_composer()
	panel._render_recipients()
	await _frames(2)
	_check("an unsupported recipient type cannot be written to", panel._input.placeholder_text == "Unsupported recipient type — cannot open conversation" and not panel._input.editable and _labels_with(panel, "Unknown · Unsupported recipient type"))
	panel.contacts = kept_contacts
	panel.active_thread = kept_thread
	panel._apply_composer()
	panel._render_recipients()


func _finish(code: int) -> void:
	main.engine.stop()
	await _frames(2)
	quit(code)
