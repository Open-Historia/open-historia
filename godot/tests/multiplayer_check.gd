extends SceneTree

var main: Node
var shots := ""
var signals := ""
var started := 0
var failures: PackedStringArray = []
var _events: Array = []
var remote := false
const ORDER_TEXT := "Open a new rail line from Berlin to the coast."


func _initialize() -> void:
	var redraw := Node2D.new()
	root.add_child(redraw)
	process_frame.connect(redraw.queue_redraw)
	shots = OS.get_environment("OH_SHOTS")
	signals = OS.get_environment("OH_MP_DIR")
	remote = OS.get_environment("OH_MP_REMOTE") == "1"
	started = Time.get_ticks_msec()
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.mouse_passthrough = true
	root.add_child(main)
	_run.call_deferred()


func _say(text: String) -> void:
	print("[multiplayer_check %6d ms] %s" % [Time.get_ticks_msec() - started, text])


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
	if shots.is_empty():
		return
	await _frames(4)
	await RenderingServer.frame_post_draw
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(name + ".png"))
	_say("screenshot " + name)


func _signal(name: String, text := "") -> void:
	if signals.is_empty():
		return
	var file := FileAccess.open(signals.path_join(name), FileAccess.WRITE)
	if file:
		file.store_string(text)
		file.close()


func _texts(node: Node, into: PackedStringArray) -> PackedStringArray:
	if node is Control and not (node as Control).is_visible_in_tree():
		return into
	if node is Label:
		into.append((node as Label).text)
	elif node is Button:
		into.append((node as Button).text)
	elif node is RichTextLabel:
		into.append((node as RichTextLabel).get_parsed_text())
	for child in node.get_children():
		_texts(child, into)
	return into


func _has_text(node: Node, wanted: String) -> bool:
	for value in _texts(node, PackedStringArray()):
		if value.contains(wanted):
			return true
	return false


func _find_button(node: Node, wanted: String) -> Button:
	if node is Button and (node as Button).is_visible_in_tree():
		var button := node as Button
		if button.text == wanted or _has_text(button, wanted):
			return button
	for child in node.get_children():
		var found := _find_button(child, wanted)
		if found:
			return found
	return null


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


func _on_event(name: String, data: Variant) -> void:
	if name.begins_with("multiplayer."):
		_events.append({"name": name, "data": data})


func _last_event(name: String) -> Dictionary:
	for index in range(_events.size() - 1, -1, -1):
		var entry: Dictionary = _events[index]
		if str(entry.get("name", "")) == name and typeof(entry.get("data")) == TYPE_DICTIONARY:
			return entry["data"]
	return {}


func _shared() -> Dictionary:
	return _last_event("multiplayer.shared")


func _overlay() -> SharedGameOverlay:
	return main.get("shared_overlay") as SharedGameOverlay


func _lobbies_page() -> LobbiesPage:
	var menu: MainMenu = main.menu
	menu._show_page("lobbies")
	await _until(func() -> bool: return is_instance_valid(menu._lobbies) and (menu._lobbies as Control).visible, 30.0)
	return menu._lobbies as LobbiesPage


func _view() -> Dictionary:
	var reply: Dictionary = await main.engine.request("game.view")
	return reply.get("result", {}) if reply.get("ok", false) else {}


func _run() -> void:
	while not main.menu.visible:
		if Time.get_ticks_msec() - started > 90000:
			_check("the menu appears", false)
			_finish()
			return
		await process_frame
	_say("menu ready")
	main.engine.engine_event.connect(_on_event)
	await _clear_shell()
	var mode := OS.get_environment("OH_MP_MODE")
	if mode == "host":
		await _as_host()
	elif mode == "duo-host":
		await _duo_host()
	elif mode == "duo-guest":
		await _duo_guest()
	else:
		await _as_guest()
	_finish()


func _seen(name: String) -> bool:
	return not signals.is_empty() and FileAccess.file_exists(signals.path_join(name))


func _read_signal(name: String) -> String:
	return FileAccess.get_file_as_string(signals.path_join(name)) if _seen(name) else ""


func _count(name: String) -> int:
	var found := 0
	for entry in _events:
		if str((entry as Dictionary).get("name", "")) == name:
			found += 1
	return found


func _doc_text(key: String) -> String:
	var reply: Dictionary = await main.engine.request("doc.read", {"key": key})
	return JSON.stringify(reply.get("result")) if reply.get("ok", false) else ""


func _thread_with(chat: ChatPanel, text: String) -> Dictionary:
	for entry in chat.chats:
		if typeof(entry) == TYPE_DICTIONARY and JSON.stringify(entry).contains(text):
			return entry
	return {}


func _hud_date() -> String:
	return str(main.hud.date_widget.status.get("currentDate", ""))


func _skip_refused(tag: String) -> void:
	var widget: DateWidget = main.hud.date_widget
	widget.set_panel("")
	await widget.run_jump(7.0)
	await _frames(3)
	_check("%s: the skip panel shows the shared-game refusal" % tag, widget.open_panel == "skip" and widget.error == SharedGame.SKIP_REFUSAL and _has_text(widget.timeline, SharedGame.SKIP_REFUSAL), widget.error)
	await _shoot("%s-skip-refused" % tag)
	widget.set_panel("")


func _duo_host() -> void:
	await main._start_scenario("default")
	main.picker._choose("France")
	await main._on_country_chosen("France", "medium")
	await _until(func() -> bool: return bool(main.get("in_game")), 60.0)
	var first := await _view()
	main._show("menu")
	var page := await _lobbies_page()
	page.set_hosting(true)
	await page.refresh()
	page._host_name = "Native host"
	page._settings["name"] = "Two networks" if remote else "Two windows"
	page._settings["daysPerRound"] = 7
	page._settings["countdownSeconds"] = 0
	page._render()
	await _until(func() -> bool: return _find_button(page, "Open the lobby") != null, 20.0)
	_find_button(page, "Open the lobby").pressed.emit()
	var overlay := _overlay()
	var lobby_open := await _until(func() -> bool: return overlay.visible and _has_text(overlay, "Invite code"), 180.0)
	_check("host: the lobby opens", lobby_open, str(_shared().get("error", "")))
	await _until(func() -> bool: return bool(main.get("in_game")) and main.get("_screen") == "game", 30.0)
	_signal("token", str(_shared().get("token", "")))
	_say("host: invite code ready")
	var guest_in := await _until(func() -> bool: return _has_text(overlay, "Germany"), 3000.0 if remote else 300.0)
	_check("host: the guest's seat shows", guest_in)
	_find_button(overlay, "Start the game").pressed.emit()
	await _until(func() -> bool: return _has_text(overlay, "Round 1 · Planning"), 60.0)
	await _skip_refused("host")
	var queue_file := OS.get_environment("OH_NATIVE_ROOT").path_join("server/data/games").path_join(str(main.get("game_id"))).path_join("storage/actions.json")
	var asked := false
	if remote:
		asked = await _until(func() -> bool: return FileAccess.get_file_as_string(queue_file).contains(ORDER_TEXT), 900.0)
		await _wait(8.0)
	else:
		asked = await _until(func() -> bool: return _seen("requests-sent"), 300.0)
	_check("host: the guest sent its requests", asked)
	var order_text := ORDER_TEXT if remote else _read_signal("requests-sent")
	var orders_arrived := false
	var chat_arrived := false
	var deadline := Time.get_ticks_msec() + 30000
	while Time.get_ticks_msec() < deadline and not (orders_arrived and chat_arrived):
		var queue := FileAccess.get_file_as_string(queue_file)
		orders_arrived = queue.contains(order_text) and queue.contains("\"ownerCode\":\"Germany\"")
		var chats := await _doc_text("chat")
		chat_arrived = chats.contains("Hello from the native guest.") and chats.contains("A second line from the guest.")
		await _wait(0.5)
	_check("host: the guest's order is in the hosted game's queue, as Germany's", orders_arrived, order_text)
	_check("host: both of the guest's chat lines are in the host's threads", chat_arrived)
	var date_before := _hud_date()
	_find_button(overlay, "End round now").pressed.emit()
	var landed := await _until(func() -> bool: return _count("multiplayer.round") > 0, 240.0)
	_check("host: the round lands on the host's screen", landed)
	var followed := await _until(func() -> bool: return _hud_date() != date_before and not _hud_date().is_empty(), 30.0)
	var after := await _view()
	_check("host: the HUD date follows the round", followed and _hud_date() == str(after.get("gameDate", "")), "%s -> %s (game %s)" % [date_before, _hud_date(), str(after.get("gameDate", ""))])
	_check("host: the game moved on", str(after.get("gameDate", "")) != str(first.get("gameDate", "")))
	var events_open := await _until(func() -> bool: return main.hud.date_widget.open_panel == "history", 20.0)
	_check("host: the Events panel opens on the landed round", events_open)
	await _wait(1.0)
	await _shoot("duo-h01-round-landed")
	_signal("resolved", str(after.get("gameDate", "")))
	if remote:
		var gone := await _until(_guest_left, 900.0)
		_check("host: the guest's leaving shows on the host", gone, JSON.stringify(_shared().get("lobby", {}).get("seats", []) if typeof(_shared().get("lobby")) == TYPE_DICTIONARY else []))
	else:
		await _until(func() -> bool: return _seen("guest-done"), 600.0)
	_find_button(overlay, "Stop").pressed.emit()
	var stopped := await _until(func() -> bool: return not overlay.visible and main.menu.visible, 60.0)
	_check("host: stopping closes the box", stopped)
	_signal("stopped")


func _guest_left() -> bool:
	var lobby: Variant = _shared().get("lobby")
	if typeof(lobby) != TYPE_DICTIONARY or typeof((lobby as Dictionary).get("seats")) != TYPE_ARRAY or ((lobby as Dictionary)["seats"] as Array).is_empty():
		return false
	for seat in (lobby as Dictionary)["seats"]:
		if typeof(seat) == TYPE_DICTIONARY and str((seat as Dictionary).get("country", "")) == "Germany" and str((seat as Dictionary).get("status", "")) == "human":
			return false
	return true


func _duo_guest() -> void:
	var token := OS.get_environment("OH_MP_TOKEN").strip_edges()
	var waited := not token.is_empty()
	if not waited:
		waited = await _until(func() -> bool: return _seen("token"), 600.0)
	_check("guest: the host's invite code arrives", waited)
	var page := await _lobbies_page()
	page._code = token if not token.is_empty() else _read_signal("token")
	var join_name := OS.get_environment("OH_MP_NAME")
	page._join_name = join_name if not join_name.is_empty() else "Native guest"
	page._restyle_join()
	_say("guest: join pressed")
	page._join_button.pressed.emit()
	var overlay := _overlay()
	var lobby_ready := await _until(func() -> bool: return _has_text(overlay, "Choose your country…"), 180.0)
	_check("guest: the lobby arrives", lobby_ready)
	overlay._choice = "Germany"
	overlay._render()
	await _frames(2)
	_find_button(overlay, "Take it").pressed.emit()
	var entered := await _until(func() -> bool: return bool(main.get("in_game")) and str(main.get("game_id")).begins_with("shared-game-") and main.get("_screen") == "game", 120.0)
	_check("guest: the game opens by itself once the host's view arrives", entered, str(main.get("game_id")))
	var view := await _view()
	var hud_country := await _until(func() -> bool: return str(main.hud.date_widget.status.get("playerCountry", "")).contains("Germany"), 30.0)
	_check("guest: the HUD shows the guest's country", str(view.get("country", "")) == "Germany" and hud_country, str(main.hud.date_widget.status.get("playerCountry", "")))
	var planning := await _until(func() -> bool: return _has_text(overlay, "Round 1 · Planning"), 300.0)
	_check("guest: round 1 begins", planning)
	var shell: ShellBoot = main.get("shell") as ShellBoot
	var lifted := await _until(func() -> bool: return shell == null or not shell.loading.is_open(), 60.0)
	_check("guest: the loading cover lifts", lifted)
	await _shoot("duo-g01-in-game")
	await _skip_refused("guest")
	var chat: ChatPanel = main.hud.panels.get("chat") as ChatPanel
	main.hud.set_active_panel("chat")
	await _wait(0.5)
	_check("guest: the chat panel knows it is in a shared game", chat.shared_game)
	chat._start_chat([{"name": "France", "code": "France"}])
	await _frames(2)
	_check("guest: a new thread waits on this screen until its first line", chat.active.get("pendingShared", false) == true and not chat.chats.any(func(entry: Variant) -> bool: return str((entry as Dictionary).get("id", "")) == str(chat.active.get("id", ""))))
	await chat.conversation.submit_player_text("Hello from the native guest.")
	_check("guest: sending the first line goes back to the list", chat.active.is_empty())
	var came_back := await _until(func() -> bool: return not _thread_with(chat, "Hello from the native guest.").is_empty(), 60.0)
	_check("guest: the new thread comes back from the host with the line", came_back)
	if came_back:
		chat.set_active(_thread_with(chat, "Hello from the native guest."))
		await _frames(2)
		await chat.conversation.submit_player_text("A second line from the guest.")
		var second := await _until(func() -> bool: return not _thread_with(chat, "A second line from the guest.").is_empty(), 60.0)
		_check("guest: a line in an open thread round-trips", second)
	await _shoot("duo-g02-chat")
	var peace: Dictionary = await main.engine.request("country.answer", {"op": "propose", "ref": "war-that-does-not-exist", "territory": "restored", "money": "none", "theirs": "France"})
	var said := str((peace.get("result", {}) as Dictionary).get("said", "")) if peace.get("ok", false) else str(peace.get("error", ""))
	_check("guest: a peace request is answered by the host", said == "This is no longer open.", said)
	main.hud.set_active_panel("actions")
	var actions: Node = main.hud.panels.get("actions")
	var order_text := ORDER_TEXT
	(actions.get("_composer") as TextEdit).text = order_text
	await actions.call("_submit")
	var queued := await _until(func() -> bool: return JSON.stringify(actions.get("_view")).contains(order_text), 60.0)
	_check("guest: the order comes back in the guest's queue", queued)
	await _shoot("duo-g03-order")
	main.hud.set_active_panel("")
	_signal("requests-sent", order_text)
	var revealed_before := _count("multiplayer.revealed")
	var landed := await _until(func() -> bool: return _count("multiplayer.round") > 0, 300.0)
	_check("guest: the host's round lands", landed)
	var round_view: Dictionary = _last_event("multiplayer.round").get("view", {}) if typeof(_last_event("multiplayer.round").get("view")) == TYPE_DICTIONARY else {}
	var followed := await _until(func() -> bool: return _hud_date() == str(round_view.get("gameDate", "")) and not _hud_date().is_empty(), 30.0)
	_check("guest: the HUD date follows the round", followed, "%s / %s" % [_hud_date(), str(round_view.get("gameDate", ""))])
	var events_open := await _until(func() -> bool: return main.hud.date_widget.open_panel == "history", 20.0)
	_check("guest: the Events panel opens on the landed round", events_open)
	await _wait(1.0)
	await _shoot("duo-g04-round-landed")
	_check("guest: nothing is told to the host before the round is read", _count("multiplayer.revealed") == revealed_before)
	main.hud.date_widget.reveal_all()
	var told := await _until(func() -> bool: return _count("multiplayer.revealed") > revealed_before, 20.0)
	main.hud.date_widget.reveal_all()
	main.hud.date_widget.set_panel("")
	main.hud.date_widget.set_panel("history")
	await _wait(2.0)
	_check("guest: the host is told the round was read, once", told and _count("multiplayer.revealed") == revealed_before + 1, "%d" % (_count("multiplayer.revealed") - revealed_before))
	_signal("guest-done")
	if remote:
		var leave := _find_button(overlay, "Leave")
		_check("guest: Leave is offered", leave != null)
		if leave:
			leave.pressed.emit()
		var gone := await _until(func() -> bool: return not overlay.visible and main.menu.visible, 60.0)
		_check("guest: leaving closes the box and shows the menu", gone)
		return
	var ended := await _until(func() -> bool: return _has_text(overlay, "The shared game ended"), 300.0)
	_check("guest: the guest is told the host stopped", ended)
	await _shoot("duo-g05-ended")
	var back := _find_button(overlay, "Back to my games")
	if back:
		back.pressed.emit()
	var left := await _until(func() -> bool: return not overlay.visible and main.menu.visible, 30.0)
	_check("guest: back to the menu", left)


func _as_guest() -> void:
	var token := OS.get_environment("OH_MP_TOKEN")
	var page := await _lobbies_page()
	_check("the Lobbies page opens", page != null)
	if page == null:
		return
	await _wait(0.6)
	_check("Join is not dimmed", page._state.get("webrtc", false) and page._join_button.tooltip_text.is_empty(), str(page._join_button.tooltip_text))
	page._code = token
	page._join_name = "Native guest"
	page._restyle_join()
	_check("Join is ready once a code is typed", not page._join_button.disabled)
	await _shoot("g00-lobbies")
	page._join_button.pressed.emit()
	var overlay := _overlay()
	var joined := await _until(func() -> bool: return overlay.visible and _has_text(overlay, "PLAYERS"), 30.0)
	_check("the lobby box opens", joined)
	var lobby_ready := await _until(func() -> bool: return _has_text(overlay, "Choose your country…"), 120.0)
	_check("the host's lobby and countries arrive", lobby_ready, str(_shared().get("stage", "")))
	await _shoot("g01-lobby")
	var lobby: Dictionary = _shared().get("lobby", {}) if typeof(_shared().get("lobby")) == TYPE_DICTIONARY else {}
	var host_country := ""
	for seat in lobby.get("seats", []):
		if not bool((seat as Dictionary).get("you", false)):
			host_country = str((seat as Dictionary).get("country", ""))
	_check("the host's seat is listed", _has_text(overlay, host_country) and not host_country.is_empty(), host_country)
	overlay._choice = "Germany"
	overlay._render()
	await _frames(2)
	var take := _find_button(overlay, "Take it")
	_check("Take it is offered", take != null)
	if take:
		take.pressed.emit()
	var seated := await _until(func() -> bool: return _has_text(overlay, "You play Germany."), 30.0)
	_check("the seat is taken", seated)
	await _shoot("g02-seated")
	_signal("seated", "Germany")
	var view_ready := await _until(func() -> bool: return bool(_shared().get("viewReady", false)), 60.0)
	_check("the host's view arrives", view_ready)
	var entered := await _until(func() -> bool: return bool(main.get("in_game")) and str(main.get("game_id")).begins_with("shared-game-"), 120.0)
	_check("the shared game opens by itself", entered, str(main.get("game_id")))
	var view := await _view()
	_check("the game shows the guest's country", str(view.get("country", "")) == "Germany", str(view.get("country", "")))
	var first_date := str(view.get("gameDate", ""))
	var planning := await _until(func() -> bool: return _has_text(overlay, "Round 1 · Planning"), 90.0)
	_check("the round bar shows round 1", planning)
	await _shoot("g03-round")
	var ready := _find_button(overlay, "I'm ready")
	_check("I'm ready is offered", ready != null)
	if ready:
		ready.pressed.emit()
	await _until(func() -> bool: return _find_button(overlay, "Ready ✓") != null, 15.0)
	_signal("ready")
	var landed := await _until(func() -> bool: return not _last_event("multiplayer.round").is_empty(), 240.0)
	_check("the host's round lands", landed)
	var round_view: Dictionary = _last_event("multiplayer.round").get("view", {}) if typeof(_last_event("multiplayer.round").get("view")) == TYPE_DICTIONARY else {}
	_check("the turn moved the date", not str(round_view.get("gameDate", "")).is_empty() and str(round_view.get("gameDate", "")) != first_date, "%s -> %s" % [first_date, str(round_view.get("gameDate", ""))])
	var titles: PackedStringArray = []
	for entry in round_view.get("events", []):
		titles.append(str((entry as Dictionary).get("title", "")))
	_check("the round's events arrive", " | ".join(titles).contains("regional summit"), " | ".join(titles.slice(maxi(0, titles.size() - 4))))
	var revealing := await _until(func() -> bool: return _has_text(overlay, "Round 1 · What happened"), 30.0)
	_check("the round bar shows what happened", revealing)
	var listed: Dictionary = await main.engine.request("library.list")
	var games: Array = (listed.get("result", {}) as Dictionary).get("games", []) if listed.get("ok", false) else []
	var entry_country := ""
	for game in games:
		if str((game as Dictionary).get("id", "")) == str(main.get("game_id")):
			entry_country = str((game as Dictionary).get("country", ""))
	_check("the library names the guest's country for the shared game", entry_country == "Germany", entry_country)
	await _wait(1.0)
	await _shoot("g04-after-round")
	var leave := _find_button(overlay, "Leave")
	_check("Leave is offered", leave != null)
	if leave:
		leave.pressed.emit()
	var left := await _until(func() -> bool: return not overlay.visible and main.menu.visible, 30.0)
	_check("leaving closes the box and shows the menu", left)
	await _shoot("g05-left")
	_signal("left")


func _as_host() -> void:
	await main._start_scenario("default")
	main.picker._choose("France")
	await main._on_country_chosen("France", "medium")
	await _until(func() -> bool: return bool(main.get("in_game")), 60.0)
	var first := await _view()
	_say("game open: %s %s" % [str(first.get("country", "")), str(first.get("gameDate", ""))])
	main._show("menu")
	var page := await _lobbies_page()
	_check("the Lobbies page opens", page != null)
	if page == null:
		return
	page.set_hosting(true)
	await page.refresh()
	page._host_name = "Native host"
	page._settings["name"] = "Native lobby"
	page._settings["daysPerRound"] = 7
	page._settings["countdownSeconds"] = 0
	page._render()
	await _until(func() -> bool: return _find_button(page, "Open the lobby") != null, 20.0)
	var open := _find_button(page, "Open the lobby")
	_check("Open the lobby is not dimmed", open != null and not open.disabled and open.tooltip_text.is_empty(), "" if open == null else open.tooltip_text)
	await _shoot("h00-host-form")
	open = _find_button(page, "Open the lobby")
	if open:
		open.pressed.emit()
	var busy := await _until(func() -> bool: return _has_text(page, "Opening…") or _overlay().visible, 10.0)
	_check("the page says the lobby is opening", busy)
	var overlay := _overlay()
	var lobby_open := await _until(func() -> bool: return overlay.visible and _has_text(overlay, "Invite code"), 180.0)
	_check("the lobby opens with an invite code", lobby_open, str(_shared().get("error", "")))
	var token := str(_shared().get("token", ""))
	_check("the invite code is known", token.begins_with("oh1-"), token.left(12))
	await _until(func() -> bool: return _has_text(overlay, "Relays: 1 of 1 connected"), 30.0)
	await _shoot("h01-lobby")
	_signal("token", token)
	var guest_in := await _until(func() -> bool: return _has_text(overlay, "Germany"), 180.0)
	_check("the guest's seat shows", guest_in)
	await _shoot("h02-guest-seated")
	var start := _find_button(overlay, "Start the game")
	_check("Start the game is offered", start != null)
	if start:
		start.pressed.emit()
	var planning := await _until(func() -> bool: return _has_text(overlay, "Round 1 · Planning"), 60.0)
	_check("the round bar shows round 1", planning)
	await _shoot("h03-round")
	var refused: Dictionary = await main.engine.request("game.open", {"id": "another-game"})
	_check("the hosted game stays open", not refused.get("ok", false) and str(refused.get("error", "")).contains("hosting a shared game"), str(refused.get("error", "")))
	var end_now := _find_button(overlay, "End round now")
	_check("End round now is offered", end_now != null)
	if end_now:
		end_now.pressed.emit()
	var landed := await _until(func() -> bool: return _has_text(overlay, "Round 2"), 240.0)
	_check("the round resolves", landed)
	var after := await _view()
	_check("the host's game moved on", str(after.get("gameDate", "")) != str(first.get("gameDate", "")), "%s -> %s" % [str(first.get("gameDate", "")), str(after.get("gameDate", ""))])
	await _wait(1.0)
	await _shoot("h04-after-round")
	_signal("resolved", str(after.get("gameDate", "")))
	var stop := _find_button(overlay, "Stop")
	_check("Stop is offered", stop != null)
	if stop:
		stop.pressed.emit()
	var stopped := await _until(func() -> bool: return not overlay.visible and main.menu.visible, 30.0)
	_check("stopping closes the box and shows the menu", stopped)
	var freed := false
	var deadline := Time.get_ticks_msec() + 30000
	while Time.get_ticks_msec() < deadline:
		var probe: Dictionary = await main.engine.request("game.open", {"id": "another-game"})
		if not str(probe.get("error", "")).contains("hosting a shared game"):
			freed = true
			break
		await _wait(0.5)
	_check("stopping lets go of the hosted game", freed)
	await _shoot("h05-stopped")
	_signal("stopped")


func _finish() -> void:
	_say("failures: %d" % failures.size())
	for failure in failures:
		_say("  - " + failure)
	main.engine.stop()
	await _frames(2)
	quit(0 if failures.is_empty() else 1)
