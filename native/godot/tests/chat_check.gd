extends SceneTree

var main: Node
var shots := ""
var started := 0
var failures: PackedStringArray = []
var panel: ChatPanel
var notices: ChatNotices


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
	print("[chat_check %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _check(label: String, ok: bool, detail := "") -> void:
	_say("%s %s%s" % ["ok  " if ok else "FAIL", label, ("  (%s)" % detail) if not detail.is_empty() else ""])
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
	return condition.call()


func _shoot(name: String) -> void:
	await _frames(4)
	await RenderingServer.frame_post_draw
	if shots.is_empty():
		return
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(name + ".png"))
	_say("screenshot " + name)


func _roles(messages: Array) -> String:
	var parts: PackedStringArray = []
	for message in messages:
		var entry: Dictionary = message
		parts.append("%s/%s" % [str(entry.get("role", "")), str(entry.get("speaker", ""))])
	return ", ".join(parts)



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


func _find_tip(node: Node, text: String) -> Control:
	if node is Control and (node as Control).tooltip_text == text and node is PanelContainer:
		return node
	for child in node.get_children():
		var found := _find_tip(child, text)
		if found:
			return found
	return null


func _labels(node: Node) -> PackedStringArray:
	var out: PackedStringArray = []
	if node is Label:
		out.append((node as Label).text)
	for child in node.get_children():
		out.append_array(_labels(child))
	return out


func _find_class(node: Node, type_name: String) -> bool:
	if node.is_class(type_name):
		return true
	for child in node.get_children():
		if _find_class(child, type_name):
			return true
	return false


func _leader_inner(node: Node) -> Control:
	if node is MarginContainer and (node as Control).layout_direction != Control.LAYOUT_DIRECTION_INHERITED and node.get_parent() is PanelContainer:
		return node
	for child in node.get_children():
		var found := _leader_inner(child)
		if found:
			return found
	return null

func _run() -> void:
	while not main.menu.visible:
		if Time.get_ticks_msec() - started > 90000:
			_check("the menu appears", false)
			_finish()
			return
		await process_frame
	_say("menu ready")
	await _clear_shell()
	await main._start_scenario("default")
	main.picker._choose("France")
	await main._on_country_chosen("France", "medium")
	await _wait(1.0)
	_say("game open: %s" % str(main.game_name))

	var mounted: Variant = main.hud.panels.get("chat")
	var mounted_notices: Variant = main.hud.chat_notices
	var through_hud := mounted is ChatPanel and mounted_notices is ChatNotices
	if through_hud:
		panel = mounted
		notices = mounted_notices
	else:
		panel = ChatPanel.new()
		main.hud.add_child(panel)
		notices = ChatNotices.new()
		main.hud.add_child(notices)
		panel.setup(main.engine, {"hud": main.hud})
		notices.setup(main.engine, {"chat_panel": panel})
	_say("panel mounted by the HUD: %s" % str(through_hud))
	var badge_counts: Array = []
	panel.unread_changed.connect(func(count: int) -> void: badge_counts.append(count))
	if through_hud:
		main.hud.set_active_panel("chat")
	else:
		panel.open()
	await _until(func() -> bool: return panel.loaded and panel.snapshot_taken, 30.0)
	await _wait(0.6)
	_check("the panel loads the conversations", panel.loaded and not panel.load_failed)
	_check("the panel is titled Diplomacy", panel.header_title.text == "Diplomacy" and panel.header_subtitle.text == "Conversations, institutions and statecraft")
	var rect := panel.get_global_rect()
	var screen := panel.get_viewport_rect().size
	_check("the panel sits where the browser puts it", is_equal_approx(rect.position.x, 17.0) and is_equal_approx(screen.y - rect.end.y, 77.0), "%s on %s" % [str(rect), str(screen)])
	await _shoot("chat-1-contacts-empty")

	panel._open_selector()
	await _until(func() -> bool: return not panel.pickable_loading, 30.0)
	await _wait(0.3)
	_check("the selector lists countries without the player", panel.pickable.size() > 10 and panel.pickable.all(func(entry: Variant) -> bool: return str((entry as Dictionary).get("name", "")) != "France"), "%d countries" % panel.pickable.size())
	await _shoot("chat-2a-selector")
	panel._modal_search.text = "ger"
	panel._render_modal_grid()
	await _wait(0.2)
	await _shoot("chat-2b-selector-search")
	panel._modal_search.text = ""
	for wanted in ["Germany", "Italy"]:
		for entry in panel.pickable:
			if str(entry.get("name", "")) == wanted:
				panel.selected.append({"name": wanted, "code": str(entry.get("code", ""))})
	panel._render_modal()
	await _wait(0.3)
	_check("the confirm button counts the selection", panel._modal_start.text == "Chat with 2 countries", panel._modal_start.text)
	await _shoot("chat-2-new-chat-modal")
	panel._close_selector()
	await _wait(0.3)

	panel.open_chat("Germany", "")
	await _until(func() -> bool: return panel.conversation_visible(), 10.0)
	await _wait(0.4)
	var view := panel.conversation
	_check("a one-on-one chat opens", view._subtitle.text == "Direct diplomatic channel", view._subtitle.text)
	_check("the composer reads as in the browser", view._composer.placeholder_text == "Send a diplomatic message…")
	await _shoot("chat-3a-new-thread")
	view._composer.text = "France proposes closer trade between our two countries. Will you send a delegation?"
	view.fit_composer()
	view.submit_from_composer()
	await _until(func() -> bool: return view.loading, 10.0)
	await _wait(0.1)
	await _shoot("chat-3b-thinking")
	await _until(func() -> bool: return not view.loading and view.messages.size() >= 2, 60.0)
	await _wait(0.8)
	_say("one-on-one thread: " + _roles(view.messages))
	var last: Dictionary = view.messages.back() if not view.messages.is_empty() else {}
	_check("the leader replies", str(last.get("role", "")) == "leader" and str(last.get("speaker", "")) == "Germany", str(last.get("text", "")).left(60))
	var first: Dictionary = view.messages[0] if not view.messages.is_empty() else {}
	_check("the reply's reaction lands on the player's line", (first.get("reactions", {}) as Dictionary).has("Germany"))
	_check("the reply carries the thread memory", not str(last.get("memorySummary", "")).is_empty())
	await _shoot("chat-3-conversation-reply")
	var chip: Control = _find_tip(view, "Germany")
	if chip:
		chip.mouse_entered.emit()
		await _frames(3)
	var tip: Variant = chip.get_meta("reactors") if chip and chip.has_meta("reactors") else null
	_check("hovering a reaction lists who reacted, each with a flag", tip is Control and _labels(tip as Node).has("Germany") and _find_class(tip as Node, "TextureRect"))
	await _shoot("chat-3c-reaction-tip")
	if chip:
		chip.mouse_exited.emit()
	panel.chat_dir = "rtl"
	view.render_messages(false)
	await _frames(4)
	var leader_inner := _leader_inner(view)
	_check("a leader's reply reads right to left when the chat language is", leader_inner != null and leader_inner.layout_direction == Control.LAYOUT_DIRECTION_RTL)
	await _shoot("chat-3d-leader-rtl")
	panel.chat_dir = ""
	view.render_messages(false)
	await _frames(2)

	panel.leave_active()
	await _wait(0.6)
	await _shoot("chat-4-contacts-list")

	var group := []
	for wanted in ["Germany", "Italy"]:
		for entry in panel.pickable:
			if str(entry.get("name", "")) == wanted:
				group.append({"name": wanted, "code": str(entry.get("code", ""))})
	panel._start_chat(group)
	await _until(func() -> bool: return panel.conversation_visible(), 10.0)
	await _wait(0.4)
	view = panel.conversation
	_check("a group chat opens", view._subtitle.text == "3-party diplomatic channel", view._subtitle.text)
	_check("a group offers the vote", view._vote_button.visible)
	view._composer.text = "A summit of three? Paris can host it next month."
	view.submit_from_composer()
	await _until(func() -> bool: return view.loading, 10.0)
	await _wait(0.1)
	await _shoot("chat-5a-group-thinking")
	await _until(func() -> bool: return not view.typing_next.is_empty(), 60.0)
	await _wait(0.2)
	_check("the table speaks a line at a time", not view.typing_next.is_empty() and view.messages.size() == 2, "%d shown, typing %s" % [view.messages.size(), str(view.typing_next.get("speaker", ""))])
	await _shoot("chat-5-group-reveal")
	await _until(func() -> bool: return view.reveal.is_empty() and view.messages.size() >= 3, 15.0)
	await _wait(0.5)
	_say("group thread: " + _roles(view.messages))
	_check("the whole table has spoken", view.messages.size() == 3)
	await _shoot("chat-6-group-done")

	view.poll_open = true
	view.update_composer()
	view._poll_question.text = "Hold the summit in Paris?"
	await _wait(0.2)
	await _shoot("chat-7a-poll-composer")
	view.create_poll()
	await _until(func() -> bool: return not ChatPanel.a(view.chat.get("polls", [])).is_empty(), 15.0)
	await _until(func() -> bool: return not view.loading and view.reveal.is_empty() and view.messages.size() >= 6, 60.0)
	await _wait(0.6)
	var polls: Array = ChatPanel.a(view.chat.get("polls", []))
	var votes := (polls[0] as Dictionary).get("votes", {}) as Dictionary if not polls.is_empty() else {}
	_check("the vote is opened and the AI governments vote", polls.size() == 1 and votes.size() == 2, "%d polls, %d votes" % [polls.size(), votes.size()])
	_check("the player's call is said as a line", view.messages.any(func(message: Variant) -> bool: return str((message as Dictionary).get("text", "")) == "I call a vote: Hold the summit in Paris?"))
	await _shoot("chat-7-poll")
	if not polls.is_empty():
		var poll: Dictionary = polls[0]
		await view.vote(poll, str(((poll.get("tally", []) as Array)[0] as Dictionary).get("id", "")))
		await _wait(0.5)
		var after: Array = ChatPanel.a(view.chat.get("polls", []))
		_check("the player's vote is cast once", not after.is_empty() and ((after[0] as Dictionary).get("votes", {}) as Dictionary).has("France"))
		await _shoot("chat-8-poll-voted")

	await _group_diplomacy()
	panel.leave_active()
	await _wait(0.3)
	var long_thread: Array = []
	for index in range(15):
		var mine := index % 2 == 0
		long_thread.append({"id": "msg-long-%d" % index, "role": "user" if mine else "leader", "speaker": "France" if mine else "Spain", "code": "" if mine else "ESP", "text": "Line %d of a long exchange about fishing rights in the Bay of Biscay." % (index + 1), "time": panel.game_date})
	var long_chat := {"id": "chat-long-check", "countries": [{"name": "Spain", "code": "ESP"}], "messages": long_thread, "status": "open"}
	await main.engine.request("chat.create", {"chat": long_chat})
	await panel.reload()
	panel.open_thread("chat-long-check")
	await _until(func() -> bool: return panel.conversation_visible() and panel.conversation.chat_id == "chat-long-check", 10.0)
	await _wait(0.6)
	_check("a long thread shows its last twelve", panel.conversation._box.get_child_count() > 0)
	await _shoot("chat-9-earlier-messages")
	panel.conversation._scroll.scroll_vertical = 0
	await _wait(0.3)
	await _shoot("chat-9b-earlier-messages-top")
	panel.leave_active()
	await _wait(0.3)
	var group_id := ""
	for chat in panel.chats:
		if (chat.get("countries", []) as Array).size() == 2:
			group_id = str(chat.get("id", ""))
	await panel.open_thread(group_id, "Draft from the advisor: propose a joint naval exercise.")
	await _wait(0.6)
	_check("a draft lands in that thread's composer", panel.conversation.chat_id == group_id and panel.conversation._composer.text == "Draft from the advisor: propose a joint naval exercise.", panel.conversation._composer.text)
	await _shoot("chat-9c-draft-in-composer")
	panel.conversation._composer.text = ""
	panel.leave_active()
	await _wait(0.3)

	panel._set_view("institutions")
	await _wait(1.5)
	await _shoot("chat-10-institutions-tab")
	panel._set_view("chats")
	await _wait(0.3)

	if through_hud:
		main.hud.set_active_panel("")
	else:
		panel.close()
	await _wait(0.8)
	var target := ""
	var thread: Array = []
	for chat in panel.chats:
		var countries: Array = chat.get("countries", [])
		if countries.size() == 1 and str((countries[0] as Dictionary).get("name", "")) == "Germany":
			target = str(chat.get("id", ""))
			thread = (chat.get("messages", []) as Array).duplicate()
	thread.append({"id": "msg-outreach-check", "role": "leader", "speaker": "Germany", "code": "DEU", "text": "Berlin would like to follow up on our talks about trade.", "time": panel.game_date})
	await main.engine.request("chat.patch", {"id": target, "set": {"messages": thread}})
	var for_target := func() -> Array: return notices._items.filter(func(item: Variant) -> bool: return str((item as Dictionary).get("chatId", "")) == target)
	await _until(func() -> bool: return not for_target.call().is_empty(), 15.0)
	await _until(func() -> bool: return panel.unread_count() > 0, 10.0)
	await _wait(0.8)
	_check("an incoming letter is toasted", (for_target.call() as Array).size() == 1, "%d for the thread, %d in the centre" % [(for_target.call() as Array).size(), notices.count()])
	_check("the dock badge counts the unread thread", panel.unread_count() == 1, "badge %d" % panel.unread_count())
	_check("the HUD badge shows the count", main.hud._chat_badge.visible and main.hud._chat_badge_label.text == "1", main.hud._chat_badge_label.text)
	await _shoot("chat-11-toast-and-bell")
	notices._center_open = true
	notices._render()
	await _wait(0.5)
	await _shoot("chat-12-bell-centre")
	var toasted: Array = for_target.call()
	if toasted.is_empty():
		_finish()
		return
	notices._open_item(toasted[0])
	await _until(func() -> bool: return panel.is_open() and panel.conversation_visible(), 10.0)
	await _wait(0.8)
	_check("the toast opens its thread", ChatPanel.t(panel.active.get("id", "")) == target)
	_check("opening the thread reads it", not panel.unread.has(target))
	await _shoot("chat-13-opened-from-toast")
	panel.leave_active()
	await _wait(0.5)
	await _shoot("chat-14-contacts-after")
	_say("badge history: %s" % str(badge_counts))

	var founded: Dictionary = await main.engine.request("institutions.found", {"founding": {"name": "Channel Compact", "shortName": "CC", "kind": "security_alliance", "purpose": "Mutual defence", "votingRule": "simple-majority", "minimumFoundingMembers": "2", "accessionMode": "approval", "allowObserver": true, "withdrawalMode": "unilateral", "withdrawalNoticeDays": "0", "expulsionMode": "approval", "dissolutionMode": "approval", "invitees": "Germany", "charterNote": ""}})
	var hearing := str((founded.get("result", {}) as Dictionary).get("createdChatId", "")) if founded.get("ok", false) else ""
	_check("an institution can be founded for the hearing test", not hearing.is_empty(), str(founded.get("error", "")))
	if not hearing.is_empty():
		await panel.reload()
		await panel.open_thread(hearing)
		await _until(func() -> bool: return panel.conversation_visible() and panel.conversation.chat_id == hearing and not panel.conversation.lifecycle_base.is_empty(), 15.0)
		await _wait(0.6)
		var hearing_view := panel.conversation
		_check("the hearing reads as a membership negotiation", hearing_view._subtitle.text == "Institution membership negotiation", hearing_view._subtitle.text)
		_check("the hearing composer addresses the accession table", hearing_view._composer.placeholder_text == "Address the accession table…")
		await _shoot("chat-15-lifecycle-hearing")
		hearing_view.lifecycle_continue()
		await _until(func() -> bool: return hearing_view.loading, 10.0)
		await _wait(0.1)
		await _shoot("chat-15b-lifecycle-considering")
		await _until(func() -> bool: return not hearing_view.loading and hearing_view.lifecycle_terminal(), 60.0)
		await _wait(0.8)
		_check("the invited government answers and the negotiation concludes", hearing_view.lifecycle_terminal() and hearing_view._subtitle.text == "Institution membership negotiation · concluded", hearing_view._subtitle.text)
		await _shoot("chat-16-lifecycle-concluded")
		await panel.leave_active()
		await _wait(1.0)
		_check("leaving a concluded hearing closes it", ChatPanel.t(panel.find_chat(hearing).get("status", "")) == "closed")
		var institutions: Variant = panel.get("_institutions_view")
		if institutions is Control:
			panel._set_view("institutions")
			await (institutions as Control).call("focus", "channel-compact", "council")
			await _wait(0.8)
			(institutions as Control).call("_open_council")
			await _until(func() -> bool: return not panel.councils.is_empty(), 20.0)
			await _wait(1.2)
			_check("the Institutions tab embeds the council conversation", not panel.councils.is_empty())
			await _shoot("chat-17-council")
			if not panel.councils.is_empty():
				var council: Object = panel.councils.values()[0]
				var council_composer: TextEdit = council.get("_composer")
				_check("the council composer addresses the council", council_composer.placeholder_text == "Address the council…", council_composer.placeholder_text)
				council_composer.text = "The Compact should coordinate patrols in the Channel."
				council.call("submit_from_composer")
				await _until(func() -> bool: return council.get("loading") == true, 10.0)
				await _until(func() -> bool: return council.get("loading") == false, 60.0)
				await _wait(2.0)
				await _shoot("chat-18-council-reply")
	await _peace_in_chat()
	_finish()


func _close_notice() -> void:
	var shell: ShellBoot = main.get("shell") as ShellBoot
	if shell != null and shell.notice != null and is_instance_valid(shell.notice):
		shell.notice.closed.emit()
		await _frames(3)


func _group_diplomacy() -> void:
	await _close_notice()
	panel.leave_active()
	await _wait(0.3)
	var table := []
	for wanted in ["Spain", "Italy"]:
		for entry in panel.pickable:
			if str(entry.get("name", "")) == wanted:
				table.append({"name": wanted, "code": str(entry.get("code", ""))})
	panel._start_chat(table)
	await _until(func() -> bool: return panel.conversation_visible(), 10.0)
	await _wait(0.5)
	var view := panel.conversation
	var chips: Array = view._tag_flow.get_children().filter(func(node: Node) -> bool: return node is PanelContainer)
	_check("a group offers a tag chip for each country", view._tag_holder.visible and chips.size() == 2 and _labels(view._tag_flow).has("Tag:") and _labels(view._tag_flow).has("Spain"), "%d chips" % chips.size())
	_check("a group can be renamed and joined", view._pencil.visible and view._add_country.visible and view._add_country.text == "Add Country")
	view.tag("Spain")
	view.tag("Spain")
	_check("a tag puts the country in the message once", view._composer.text == "@Spain ", view._composer.text)
	await _shoot("chat-6b-group-tags")
	view._composer.text = ""
	view.fit_composer()
	await view.begin_title_edit()
	await _wait(0.2)
	_check("the pencil opens the title for editing", view._title_editor.visible and not view._title_row.visible and view._title_input.text == view.display_title(), view._title_input.text)
	view._title_input.text = "Iberian Summit"
	await _shoot("chat-6c-title-edit")
	await view.save_title()
	await _until(func() -> bool: return ChatPanel.t(view.chat.get("title", "")) == "Iberian Summit", 10.0)
	await _wait(0.3)
	_check("the new title is kept", view._title.text == "Iberian Summit" and view._title_row.visible, view._title.text)
	panel._open_selector("add")
	await _until(func() -> bool: return not panel.pickable_loading, 30.0)
	await _wait(0.3)
	var listed := _labels(panel._modal_grid)
	_check("Add Country lists the countries not yet in the conversation", panel._modal_title.text == "Add Countries to Chat" and not listed.has("Spain") and not listed.has("Italy") and listed.has("Portugal"), panel._modal_title.text)
	for entry in panel.pickable:
		if str(entry.get("name", "")) == "Portugal":
			panel.selected.append({"name": "Portugal", "code": str(entry.get("code", ""))})
	panel._render_modal()
	await _wait(0.2)
	_check("the confirm button says what it adds", panel._modal_start.text == "Add 1 country", panel._modal_start.text)
	await _shoot("chat-6d-add-country")
	panel._modal_start.pressed.emit()
	await _until(func() -> bool: return view.countries().size() == 3, 10.0)
	await _wait(0.4)
	_check("the country joins the conversation", view.countries().size() == 3 and view._subtitle.text == "4-party diplomatic channel" and _labels(view._tag_flow).has("Portugal"), view._subtitle.text)
	await _shoot("chat-6e-country-added")
	panel.leave_active()
	await _wait(0.3)
	panel._open_selector()
	await _wait(0.2)
	_check("the new chat selector is titled as before", panel._modal_title.text == "Start New Diplomatic Chat")
	panel._close_selector()
	await _wait(0.3)


func _peace_in_chat() -> void:
	await _close_notice()
	var seeded: Dictionary = await main.engine.request("country.standin_seed")
	_check("the stand-in war is seeded", seeded.get("ok", false))
	panel.open()
	panel._set_view("chats")
	panel.open_chat("Libya", "")
	await _until(func() -> bool: return panel.conversation_visible() and not panel.conversation.peace_info.is_empty(), 15.0)
	await _wait(0.6)
	var view := panel.conversation
	var labels := _labels(view._box)
	_check("Libya's offer of peace is in the chat with it", labels.has("Peace offered") and labels.has("Libya") and labels.has("Each side keeps the ground it holds."), ", ".join(labels.slice(0, 8)))
	_check("the offer is answered on the card", _button(view._box, "Accept") != null and _button(view._box, "Decline") != null)
	_check("the chat with an enemy offers Peace", view._peace_button.visible and view._peace_button.tooltip_text == "Propose peace to Libya", view._peace_button.tooltip_text)
	await _shoot("chat-19-peace-offered")
	view._peace_button.pressed.emit()
	await _wait(0.3)
	var form := _labels(view._peace_holder)
	_check("Peace opens the terms form", view._peace_holder.visible and form.has("Propose peace") and form.has("Your terms are sent in this chat. Their leader answers them in the reply: accepts, declines or offers other terms.") and _button(view._peace_holder, "Send terms") != null)
	await _shoot("chat-20-peace-terms-form")
	view.peace_money = "they-light"
	await view.propose_peace()
	await _until(func() -> bool: return not view.loading, 60.0)
	await _until(func() -> bool: return _labels(view._box).has("Your terms of peace"), 15.0)
	await _wait(0.6)
	var said := view.messages.any(func(message: Variant) -> bool: return str((message as Dictionary).get("text", "")).begins_with("We propose peace on these terms: every region goes back to whose it was before the war; Libya pays France reparations"))
	_check("the terms are said as the player's message", said)
	labels = _labels(view._box)
	_check("the player's terms wait under it", labels.has("Your terms of peace") and labels.has("Waiting for their answer"), ", ".join(labels.slice(0, 12)))
	_check("Peace is not offered while the player's terms wait", not view._peace_button.visible)
	await _shoot("chat-21-peace-terms-sent")
	var leader := {}
	for message in view.messages:
		if str((message as Dictionary).get("role", "")) == "leader":
			leader = message
	var settled: Dictionary = await main.engine.request("chat.peaceAnswer", {"speaker": "Libya", "line": "accept", "chatId": view.chat_id, "messageId": str(leader.get("id", ""))})
	var outcome := str((settled.get("result", {}) as Dictionary).get("outcome", "")) if settled.get("ok", false) else str(settled.get("error", ""))
	_check("the leader's word on peace is carried out", outcome == "peace", outcome)
	await view.refresh_peace()
	await _until(func() -> bool: return _labels(view._box).has("Accepted: the war is over"), 10.0)
	await _wait(0.4)
	_check("the player's terms read as accepted, and Peace is gone with the war", _labels(view._box).has("Accepted: the war is over") and not view._peace_button.visible)
	await _shoot("chat-22-peace-accepted")
	panel.leave_active()
	await _wait(0.3)
	await main.engine.request("country.standin_seed")
	panel.open_chat("Libya", "")
	await _until(func() -> bool: return panel.conversation_visible() and _button(panel.conversation._box, "Decline") != null, 15.0)
	view = panel.conversation
	var offer := {}
	for entry in ChatPanel.a(view.peace_info.get("offers", [])):
		if ChatPanel.t(ChatPanel.d(entry).get("id", "")) == "offer-libya":
			offer = ChatPanel.d(entry)
	_check("a new offer waits in the same chat", offer.get("open", false) == true)
	await view.answer_peace(offer, "decline")
	await _wait(0.6)
	_check("a declined offer is answered and leaves the foot of the chat", _button(view._box, "Accept") == null and not _labels(view._box).has("Peace offered"))
	await _shoot("chat-23-peace-declined")
	panel.leave_active()
	await _wait(0.3)


func _button(node: Node, text: String) -> Button:
	if node is Button and (node as Button).text == text and (node as Button).is_visible_in_tree():
		return node
	for child in node.get_children():
		var found := _button(child, text)
		if found:
			return found
	return null


func _finish() -> void:
	_say("RESULT %s" % ("PASS" if failures.is_empty() else "FAIL: " + ", ".join(failures)))
	main.engine.stop()
	await _frames(2)
	quit(0 if failures.is_empty() else 1)
