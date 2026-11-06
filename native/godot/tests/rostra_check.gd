extends SceneTree

var main: Node
var shots := ""
var started := 0
var failures := 0
var map_targets: Array[Vector3] = []


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
	print("[rostra_check %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _check(ok: bool, what: String) -> void:
	if ok:
		_say("PASS " + what)
	else:
		failures += 1
		_say("FAIL " + what)


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
	return bool(condition.call())


func _shoot(name: String) -> void:
	await _frames(4)
	await RenderingServer.frame_post_draw
	if shots.is_empty():
		return
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(name + ".png"))
	_say("screenshot " + name)


func _texts(node: Node, out: PackedStringArray) -> PackedStringArray:
	if node is Label:
		out.append((node as Label).text)
	elif node is Button:
		out.append((node as Button).text)
	elif node is RichTextLabel:
		out.append((node as RichTextLabel).get_parsed_text())
	elif node is LineEdit:
		out.append((node as LineEdit).placeholder_text)
	for child in node.get_children():
		_texts(child, out)
	return out


func _has_text(node: Node, text: String) -> bool:
	if node == null or not is_instance_valid(node):
		return false
	for value in _texts(node, PackedStringArray()):
		if value.contains(text):
			return true
	return false


func _find_button(node: Node, text: String) -> Button:
	if node == null:
		return null
	for child in node.get_children():
		if child is Button:
			var button := child as Button
			if button.text == text or button.tooltip_text == text or _labels_of(button).has(text):
				return button
		var found := _find_button(child, text)
		if found:
			return found
	return null


func _labels_of(node: Node) -> PackedStringArray:
	var out := PackedStringArray()
	for child in node.get_children():
		if child is Label:
			out.append((child as Label).text)
		out.append_array(_labels_of(child))
	return out


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


func _settle() -> void:
	var shell: ShellBoot = main.get("shell") as ShellBoot
	if shell == null:
		await _wait(1.5)
		return
	await _until(func() -> bool: return shell.door_state != "deciding", 30.0)
	if shell.door != null and is_instance_valid(shell.door):
		shell.door.opened.emit()
	if shell.notice != null and is_instance_valid(shell.notice):
		shell.notice.closed.emit()
	var settled := await _until(func() -> bool: return not shell.loading.is_open() and not shell.loading.visible, 90.0)
	_say("the game's loading screen is gone: %s, door %s" % [settled, shell.door_state])
	await _wait(1.0)


func _fits(what: String) -> void:
	var panel := _panel()
	await _frames(2)
	var holder := panel._screen.get_child(0) as Control
	var stack := holder.get_child(0) as Control
	_check(panel._shell.size.x <= panel.size.x + 0.5 and stack.size.x <= holder.size.x + 1.0, "%s: nothing is wider than the phone's screen (%.1f of %.1f)" % [what, stack.size.x, holder.size.x])


func _world() -> Dictionary:
	var reply: Dictionary = await main.engine.request("doc.read", {"key": "world"})
	return reply.get("result", {}) if reply.get("ok", false) and typeof(reply.get("result")) == TYPE_DICTIONARY else {}


func _run() -> void:
	await process_frame
	while not main.menu.visible:
		if Time.get_ticks_msec() - started > 90000:
			_say("FAIL the menu never appeared")
			failures += 1
			_finish()
			return
		await process_frame
	await _clear_shell()
	await main._start_scenario("default")
	await _wait(0.4)
	main.picker._choose("France")
	await _wait(0.2)
	await main._on_country_chosen("France", "medium")
	_say("game open: %s" % str(main.game_name))
	await _settle()
	await _dock_checks()
	await _feed_checks()
	await _search_checks()
	await _card_checks()
	await _actions_checks()
	await _phone_checks()
	await _feature_checks()
	_finish()


func _dock_checks() -> void:
	var hud: Hud = main.hud
	var launchers: Dictionary = hud.get("_launchers")
	_check(launchers.keys() == ["chat", "actions", "social"], "the dock holds Chat, Actions and Rostra (%s)" % str(launchers.keys()))
	_check((launchers["social"] as Button).tooltip_text == "Rostra" and (launchers["actions"] as Button).tooltip_text == "Actions and Projects", "the launchers are named Rostra and Actions and Projects")
	_check(hud.panels.has("social") and not hud.panels.has("projects"), "Projects has no dock window of its own; Rostra has one")
	var dock: Control = hud.get("_dock")
	_check(is_equal_approx(dock.size.x, 205.0), "the dock is three launchers wide (%.0f)" % dock.size.x)


func _panel() -> RostraPanel:
	return main.hud.panels["social"] as RostraPanel


func _feed_checks() -> void:
	var hud: Hud = main.hud
	hud.toggle_dock("social")
	var panel := _panel()
	await _until(func() -> bool: return panel.is_open() and not panel.view.is_empty(), 20.0)
	await _wait(0.6)
	_check(panel.framed, "on a computer Rostra is drawn as a phone")
	var box := panel.frame_size()
	_check(absf(box.x / box.y - 9.0 / 19.0) < 0.01 and absf(box.y - minf(736.0, 900.0 - 144.0)) < 1.0, "the phone has a phone's proportions, min(46rem, screen - 9rem) tall (%s)" % str(box))
	_check(_has_text(panel, "Rostra") and _has_text(panel, "What the world is saying"), "the header names the app")
	for label in ["For you", "Search", "Mentions", "Your posts"]:
		_check(_has_text(panel, label), "the tab bar has %s" % label)
	_check(_has_text(panel, "Nothing has been posted yet.") and _has_text(panel, "Refresh to see what the people who make the news are posting.") and _has_text(panel, "One AI request"), "an empty feed offers Refresh")
	await _shoot("r-01-empty")
	var refresh := _find_button(panel._feed, "Refresh")
	_check(refresh != null and not refresh.disabled, "Refresh can be pressed")
	if refresh:
		refresh.pressed.emit()
	await _until(func() -> bool: return (panel.view.get("posts", []) as Array).size() > 0, 30.0)
	await _wait(0.6)
	var posts: Array = panel.view.get("posts", [])
	_check(posts.size() == 6, "Refresh wrote the first posts into the feed (%d)" % posts.size())
	_check(_has_text(panel, "Olaf Scholz") and _has_text(panel, "Chancellor of Germany · Germany"), "a post shows its author, role and country")
	var quoting := false
	for post in posts:
		if typeof((post as Dictionary).get("quote")) == TYPE_DICTIONARY and str(((post as Dictionary)["quote"] as Dictionary).get("author", "")) == "Olaf Scholz":
			quoting = true
	_check(quoting, "a post quoting an earlier one carries it embedded")
	_check(int(panel.view.get("mentionCount", 0)) >= 1 and panel._mention_badge.visible, "Mentions counts the posts that name France")
	await _shoot("r-02-feed")
	await _fits("the feed")
	var world := await _world()
	_check((world.get("socialFeed", []) as Array).size() == 6, "the posts are kept on the world")

	panel._pen.pressed.emit()
	await _frames(3)
	_check(panel._composer.visible and _has_text(panel._composer, "Posting as"), "the pen opens the box, posting as the leader")
	panel._draft.text = "France stands ready to host the summit. Our door is open to every partner."
	panel._draft.text_changed.emit()
	await _frames(2)
	_check(not panel._post_button.disabled and panel._count.text.begins_with("74/"), "the box counts the characters (%s)" % panel._count.text)
	await _shoot("r-03-compose")
	panel._post_button.pressed.emit()
	await _until(func() -> bool:
		for post in panel.view.get("posts", []):
			if bool((post as Dictionary).get("mine", false)):
				return true
		return false, 15.0)
	await _wait(0.4)
	_check(not panel._composer.visible and panel._posted_note.visible, "the post is made and the box put away")
	var mine: Dictionary = {}
	for post in panel.view.get("posts", []):
		if bool((post as Dictionary).get("mine", false)):
			mine = post
	_check(not mine.is_empty() and bool(mine.get("waiting", false)), "the player's post waits for the next time skip")
	_check(_has_text(panel, "The world answers with the next time skip."), "the waiting post says the world answers with the next skip")
	await _shoot("r-04-posted")

	var scholz: Dictionary = {}
	for post in panel.view.get("posts", []):
		if str((post as Dictionary).get("author", "")) == "Olaf Scholz":
			scholz = post
	panel.start_quote(scholz.get("card", {}))
	await _frames(3)
	_check(panel._composer.visible and _has_text(panel._quote_slot, "Olaf Scholz"), "Quote puts the post in the box")
	panel._poll_toggle.pressed.emit()
	await _frames(3)
	var fields := panel._choice_box.find_children("*", "LineEdit", true, false)
	_check(fields.size() == 2, "a poll starts with two choices")
	panel._draft.text = "Should France lead a common European energy purchase?"
	panel._draft.text_changed.emit()
	if fields.size() == 2:
		(fields[0] as LineEdit).text = "Yes, lead it"
		(fields[0] as LineEdit).text_changed.emit("Yes, lead it")
		(fields[1] as LineEdit).text = "No, go alone"
		(fields[1] as LineEdit).text_changed.emit("No, go alone")
	await _frames(2)
	await _shoot("r-05-poll-compose")
	await _fits("the box with a poll and a quote")
	panel._post_button.pressed.emit()
	await _until(func() -> bool:
		for post in panel.view.get("posts", []):
			if typeof((post as Dictionary).get("poll")) == TYPE_DICTIONARY:
				return true
		return false, 15.0)
	await _wait(0.4)
	world = await _world()
	var poll_id := ""
	var player_id := ""
	for post in world.get("socialFeed", []):
		var entry: Dictionary = post
		if str(entry.get("kind", "")) == "player" and typeof(entry.get("poll")) == TYPE_DICTIONARY:
			poll_id = str(entry.get("id", ""))
			_check(str(entry.get("quote", "")) != "", "the poll quotes the post it was written on")
		elif str(entry.get("kind", "")) == "player":
			player_id = str(entry.get("id", ""))
	_check(not poll_id.is_empty() and _has_text(panel, "The public votes until the next time skip."), "a poll is posted and open until the next skip")
	await _shoot("r-06-poll-open")

	var skipped: Dictionary = await main.engine.request("social.testSkip", {
		"posts": [{"author": "Giorgia Meloni", "role": "Prime Minister of Italy", "country": "Italy", "text": "Rome welcomes the invitation from Paris. Italy will be at the table.", "quote": player_id}],
		"pollResults": [{"poll": poll_id, "shares": [62, 38], "votes": 48210, "consensus": "Most think France should lead, but many fear the cost at home."}],
	})
	_check(skipped.get("ok", false), "a time skip's posts and poll results land on the feed")
	await _until(func() -> bool: return _has_text(panel, "Final results"), 15.0)
	await _wait(0.3)
	_check(_has_text(panel, "Final results") and _has_text(panel, "62%") and _has_text(panel, "48,210 votes") and _has_text(panel, "Public consensus:"), "the poll shows its final results and the public consensus")
	await _shoot("r-07-poll-results")
	await _fits("a poll's results")
	panel._set_tab("mentions")
	await _until(func() -> bool: return panel.tab == "mentions" and _has_text(panel._feed, "Giorgia Meloni"), 15.0)
	_check(_has_text(panel._feed, "Giorgia Meloni") and _has_text(panel._feed, "Olaf Scholz"), "Mentions gathers the answer to the player's post and the posts naming France")
	await _shoot("r-08-mentions")
	panel._set_tab("mine")
	await _until(func() -> bool: return panel.tab == "mine" and (panel.view.get("posts", []) as Array).size() == 2, 15.0)
	_check((panel.view.get("posts", []) as Array).size() == 2 and _has_text(panel._feed, "You"), "Your posts holds the player's two posts")
	await _shoot("r-09-your-posts")


func _search_checks() -> void:
	var panel := _panel()
	panel._set_tab("search")
	await _until(func() -> bool: return is_instance_valid(panel._search) and not panel._search.view.is_empty(), 20.0)
	await _wait(0.5)
	var search := panel._search
	_check(str(search.view.get("title", "")) == "France", "Search opens on the player's own country")
	_check(_has_text(search, "ON ROSTRA") or _has_text(search, "On Rostra"), "the country's own posts on Rostra come first")
	_check(_has_text(search, "Nothing has been posted here yet.") and _has_text(search, "Refresh to see what ordinary people in France are posting."), "the own country is never asked for by itself")
	await _shoot("r-10-search-own")
	await _fits("Search")
	search._input.text = "Germ"
	search._on_query("Germ")
	await _until(func() -> bool: return not search.hits.is_empty(), 20.0)
	await _wait(0.3)
	var germany: Dictionary = {}
	for hit in search.hits:
		if str((hit as Dictionary).get("title", "")) == "Germany":
			germany = hit
	_check(not germany.is_empty() and str(germany.get("scope", "")) == "country", "a search finds Germany as a country")
	await _shoot("r-11-search-hits")
	search.pick(germany)
	await _until(func() -> bool: return (search.view.get("batches", []) as Array).size() > 0, 30.0)
	await _wait(0.5)
	_check(str(search.view.get("title", "")) == "Germany" and _has_text(search, "Camille Bernard") and _has_text(search, "Written by your AI model. Each new feed is one AI request."), "picking a place asks once for what its people are posting")
	_check(_has_text(search, "TRENDING") or _has_text(search, "Trending"), "the place's trends are shown")
	_check(_find_button(search, "Your country") != null, "Your country goes back to the player's own")
	await _shoot("r-12-search-germany")
	search._input.text = "Berlin"
	search._on_query("Berlin")
	await _until(func() -> bool: return not search.hits.is_empty(), 20.0)
	var region: Dictionary = {}
	for hit in search.hits:
		if str((hit as Dictionary).get("scope", "")) == "region":
			region = hit
			break
	if not region.is_empty():
		search.pick(region)
		await _until(func() -> bool: return typeof(search.view.get("tabs")) == TYPE_ARRAY, 20.0)
		await _until(func() -> bool: return (search.view.get("batches", []) as Array).size() > 0, 30.0)
		await _wait(0.4)
		var tabs: Array = search.view.get("tabs", [])
		_check(tabs.size() == 2 and str(tabs[1]) == "Germany" and not bool(search.view.get("nationwide", true)), "a region turns to the whole of its country and back, the region first")
		await _shoot("r-13-search-region")
		await _fits("a region's feed")
	else:
		_check(false, "a search finds a region")


func _card_checks() -> void:
	var hud: Hud = main.hud
	hud.set_active_panel("")
	await _wait(0.6)
	var map: MapView = main.map_view
	var index := -1
	for at in range(4000):
		if map.region_owner(at) == "Germany":
			index = at
			break
	_check(index >= 0, "a German region on the map")
	if index < 0:
		return
	await hud.map_cards.show_region(index, map.region_name(index), map.region_owner(index), Vector2(720, 450))
	await _until(func() -> bool: return hud.map_cards._floating != null and _has_text(hud.map_cards._floating, "Check in Rostra"), 20.0)
	await _wait(0.4)
	_check(_has_text(hud.map_cards._floating, "Check in Rostra") and not _has_text(hud.map_cards, "Listen in"), "the region card has Check in Rostra and no Listen in")
	await _shoot("r-14-region-card")
	var button := _find_button(hud.map_cards._floating, "Check in Rostra")
	if button:
		button.pressed.emit()
	var panel := _panel()
	await _until(func() -> bool: return hud.active_panel == "social" and panel.tab == "search" and is_instance_valid(panel._search) and str(panel._search.view.get("title", "")) == "Germany", 20.0)
	await _wait(0.5)
	_check(hud.active_panel == "social" and panel.tab == "search" and is_instance_valid(panel._search) and str(panel._search.view.get("title", "")) == "Germany", "Check in Rostra opens Rostra's Search on that country")
	_check(await _until(func() -> bool: return hud.map_cards._floating == null, 3.0), "the region card is put away")
	await _shoot("r-15-check-in")
	hud.set_active_panel("")
	await _wait(0.5)


func _actions_checks() -> void:
	var hud: Hud = main.hud
	hud.open_actions_tab("projects")
	var actions: ActionsPanel = hud.panels["actions"]
	await _until(func() -> bool: return actions.is_open() and actions.board() != null and actions.board()._loaded, 20.0)
	await _wait(0.6)
	_check(hud.active_panel == "actions" and actions.current_tab() == "projects", "the advisor's board card opens the Projects tab of Actions")
	_check(_has_text(actions, "Actions") and _has_text(actions, "Projects") and not actions.header_title.visible, "the panel's header is the Actions / Projects tab strip")
	_check(actions.board().is_visible_in_tree() and _has_text(actions.board(), "Nothing on the board yet"), "the Projects tab holds the board")
	await _shoot("r-16-projects-tab")
	var seeded: Dictionary = await main.engine.request("projects.testSeed", {"ops": [{"op": "create", "name": "Grand Paris Rail Link", "kind": "project", "status": "active", "summary": "A new line.", "progress": 35}]})
	_check(seeded.get("ok", false), "a board entry is seeded")
	await _until(func() -> bool: return actions._project_count == 1, 10.0)
	var count := actions._tab_buttons["projects"].find_child("Count", true, false) as Control
	_check(actions._project_count == 1 and count.visible, "the Projects tab counts the board's entries")
	await _until(func() -> bool: return int(actions.board()._view.get("total", 0)) == 1, 10.0)
	await _shoot("r-17-projects-count")
	actions.set_tab("actions")
	await _frames(3)
	_check(not actions.board().is_open() and actions._orders.visible, "the Actions tab shows the orders again")
	await _shoot("r-18-actions-tab")
	hud.set_active_panel("")
	await _wait(0.5)


func _phone_checks() -> void:
	var hud: Hud = main.hud
	var window := root.get_window()
	window.size = Vector2i(390, 844)
	await _wait(0.8)
	hud.set_active_panel("social")
	var panel := _panel()
	panel._set_tab("all")
	await _wait(1.0)
	_check(not panel.framed, "on a phone-size window there is no frame")
	_check(absf(panel.size.x - (390.0 - 16.0)) < 2.0, "it rises from the dock as wide as the screen (%.0f)" % panel.size.x)
	_check(not panel._status.visible and not panel._home_bar.visible, "no status bar and no home bar outside the frame")
	await _shoot("r-19-phone")
	hud.set_active_panel("")
	await _wait(0.4)
	window.size = Vector2i(1440, 900)
	await _wait(0.8)


func _feature_checks() -> void:
	var hud: Hud = main.hud
	var off: Dictionary = await main.engine.request("social.testFeature", {"on": false})
	_check(off.get("ok", false) and not bool((off.get("result", {}) as Dictionary).get("enabled", true)), "Social media can be switched off for the game")
	var launchers: Dictionary = hud.get("_launchers")
	await _until(func() -> bool: return not (launchers["social"] as Control).visible, 10.0)
	await _wait(0.3)
	var dock: Control = hud.get("_dock")
	_check(not (launchers["social"] as Control).visible and is_equal_approx(dock.size.x, 140.0) and is_equal_approx(hud.search_slot.offset_left, 156.0), "off, the dock has no Rostra button and closes the gap")
	var war_button := main.get("war_room_button") as WarRoomButton
	_check(war_button != null and is_equal_approx(war_button.offset_left, 156.0) and is_equal_approx(war_button.offset_right, 156.0 + WarRoomButton.SIZE), "off, the war room's button stands beside the narrower dock (%s)" % (str(war_button.offset_left) if war_button else "none"))
	var german := _german_region()
	await hud.map_cards.show_region(german, main.map_view.region_name(german), main.map_view.region_owner(german), Vector2(720, 450))
	await _wait(1.0)
	_check(hud.map_cards._floating != null and not _has_text(hud.map_cards._floating, "Check in Rostra"), "off, the region card has no Check in Rostra")
	await _shoot("r-20-feature-off")
	hud.map_cards.dismiss_all()
	var on: Dictionary = await main.engine.request("social.testFeature", {"on": true})
	_check(on.get("ok", false), "Social media is switched back on")
	await _until(func() -> bool: return (launchers["social"] as Control).visible, 10.0)
	_check((launchers["social"] as Control).visible and is_equal_approx(hud.search_slot.offset_left, 221.0), "on again, the button is back")
	await _wait(0.4)
	var war_again := main.get("war_room_button") as WarRoomButton
	_check(war_again != null and is_equal_approx(war_again.offset_left, 221.0), "on again, the war room's button moves back beside the full dock (%s)" % (str(war_again.offset_left) if war_again else "none"))


func _german_region() -> int:
	var map: MapView = main.map_view
	for at in range(4000):
		if map.region_owner(at) == "Germany":
			return at
	return -1


func _finish() -> void:
	_say("done: %d failure(s)" % failures)
	quit(1 if failures > 0 else 0)
