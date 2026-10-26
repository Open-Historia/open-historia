extends SceneTree

var main: Node
var shots := ""
var started := 0
var failures: PackedStringArray = []


func _initialize() -> void:
	shots = OS.get_environment("OH_SHOTS")
	started = Time.get_ticks_msec()
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.add_child(main)
	_run.call_deferred()


func _say(text: String) -> void:
	print("[community_check %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _check(ok: bool, what: String) -> void:
	if ok:
		_say("ok   " + what)
	else:
		_say("FAIL " + what)
		failures.append(what)


func _frames(count: int) -> void:
	for i in range(count):
		await process_frame


func _wait(seconds: float) -> void:
	await create_timer(seconds).timeout


func _shoot(name: String) -> void:
	await _frames(4)
	await RenderingServer.frame_post_draw
	if shots.is_empty():
		return
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(name + ".png"))
	_say("screenshot " + name)


func _texts(node: Node, into: PackedStringArray) -> PackedStringArray:
	if node is Control and not (node as Control).is_visible_in_tree():
		return into
	if node is Label:
		into.append((node as Label).text)
	elif node is Button:
		into.append((node as Button).text)
	elif node is RichTextLabel:
		into.append((node as RichTextLabel).get_parsed_text())
	elif node is LineEdit:
		into.append((node as LineEdit).placeholder_text)
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


func _until(condition: Callable, seconds: float) -> bool:
	var deadline := Time.get_ticks_msec() + int(seconds * 1000.0)
	while Time.get_ticks_msec() < deadline:
		if condition.call():
			return true
		await process_frame
	return condition.call()


func _mount_menu_page(key: String, title: String, page: Control, actions: Array = []) -> void:
	var menu: MainMenu = main.menu
	menu._show_page("games")
	for tile_key in menu._tiles:
		var tile: Button = menu._tiles[tile_key]
		tile.modulate = Color(1, 1, 1, 1)
		tile.disabled = false
		if tile_key != "settings":
			menu._style_tile(tile, tile_key == key)
	menu._title.text = title
	for child in menu._actions.get_children():
		menu._actions.remove_child(child)
		child.queue_free()
	for action in actions:
		menu._actions.add_child(action)
	for child in menu._page_root.get_children():
		menu._page_root.remove_child(child)
		child.queue_free()
	menu._grids.clear()
	menu._page_root.add_child(page)
	menu._body.scroll_vertical = 0


func _run() -> void:
	while not main.menu.visible:
		if Time.get_ticks_msec() - started > 90000:
			_say("FAIL the menu never appeared")
			_finish(1)
			return
		await process_frame
	_say("menu ready")
	await _until(func() -> bool: return main.menu._trash != null, 20.0)
	await _wait(1.0)
	var only := OS.get_environment("OH_ONLY")
	if only == "lobbies":
		await _lobbies(false)
		_finish(0 if failures.is_empty() else 1)
		return
	if only == "community":
		await _community()
		_finish(0 if failures.is_empty() else 1)
		return
	await _community()
	await _imports()
	await _suggestions()
	await _lobbies(false)
	await main._start_scenario("default")
	main.picker._choose("France")
	await main._on_country_chosen("France", "medium")
	_say("game open")
	await _wait(1.0)
	await _overlay()
	await main._exit_game()
	await _wait(1.0)
	await _lobbies(true)
	_finish(0 if failures.is_empty() else 1)


func _community() -> void:
	var page := CommunityPage.new()
	page.setup(main.engine, {})
	_mount_menu_page("community", "Community", page)
	page.open()
	await _frames(2)
	await _shoot("c01-loading")
	_check(page._loaded or page.find_children("*", "", true, false).any(func(node: Node) -> bool: return node is CommunityKit.Skeleton), "card outlines while the list is on its way")
	var loaded := await _until(func() -> bool: return page._loaded and not page._browse.is_empty(), 30.0)
	_check(loaded, "the hub's posts load")
	_check(page._posts.size() > 0, "posts listed: %d" % page._posts.size())
	await _wait(4.0)
	_check(_has_text(page, "Browse Community") and _has_text(page, "One catalog, sorted the way you want."), "browse header")
	_check(_has_text(page, "📌 Featured"), "featured row")
	_check(_has_text(page, "Scenarios on the Hub are released under CC BY 4.0."), "licence line")
	_check(_has_text(page, "Most Installed") and _has_text(page, "Most Liked") and _has_text(page, "Newest"), "sort pills")
	_check(_has_text(page, "Join the Discord") and _has_text(page, "Open Hub ↗") and _has_text(page, "⬆ Publish to Hub"), "header controls")
	await _shoot("c02-browse")
	main.menu._body.scroll_vertical = 900
	await _wait(1.0)
	await _shoot("c03-browse-scrolled")
	main.menu._body.scroll_vertical = 0
	var before: Array = (page._browse.get("browse", []) as Array).duplicate()
	page._sort = "recent"
	await page._rebrowse()
	var newest: Array = page._browse.get("browse", [])
	_check(not newest.is_empty() and newest != before, "Newest reorders the grid")
	page._sort = "installs"
	await page._rebrowse()
	page._search.text = "war"
	page._search.text_changed.emit("war")
	await _until(func() -> bool: return page._browse.get("search") != null, 5.0)
	await _wait(1.5)
	_check(_has_text(page, "🔍 Results ("), "search results row")
	await _shoot("c04-search")
	page._search.text = ""
	page._search.text_changed.emit("")
	page._from.text = "1900"
	page._from.text_changed.emit("1900")
	page._to.text = "abc"
	page._to.text_changed.emit("abc")
	await _wait(1.0)
	_check(page._clear.visible, "Clear shows with a date")
	_check(str(page._browse.get("fromBound", "")) == "1900-01-01" and str(page._browse.get("toBound", "")).is_empty(), "date bounds read as the engine reads them")
	await _shoot("c05-dates")
	page._clear.pressed.emit()
	await _wait(0.6)
	page._publish_open = true
	page._render()
	await _wait(0.5)
	_check(_has_text(page, "Everything you publish to the Hub is released under CC BY 4.0."), "publish picker licence")
	_check(_has_text(page, "Modern Day"), "publish picker lists the library's scenarios")
	await _shoot("c06-publish-picker")
	page._publish_open = false
	page._render()
	var pinned: Array = page._browse.get("pinned", [])
	var first: Dictionary = page._posts[int(pinned[0])] if not pinned.is_empty() else page._posts.values()[0]
	page._select(first)
	await _wait(3.0)
	_check(_has_text(page, "← Back") and _has_text(page, "▶ Import & Play"), "detail page buttons")
	_check(_has_text(page, "Likes and comments live on the scenario's GitHub post"), "detail note")
	await _shoot("c07-detail")
	main.menu._body.scroll_vertical = 2000
	await _wait(0.8)
	await _shoot("c08-detail-bottom")
	main.menu._body.scroll_vertical = 0
	page._back_to_grid()
	await _wait(0.5)


func _imports() -> void:
	var stub: Dictionary = await main.engine.request("community.standin.downloads", {"on": true})
	_check(stub.get("ok", false), "hub downloads stubbed for the test (no real download is counted)")
	var page := CommunityPage.new()
	page.setup(main.engine, {})
	_mount_menu_page("community", "Community", page)
	page.open()
	await _until(func() -> bool: return page._loaded and not page._browse.is_empty(), 30.0)
	var browse: Array = page._browse.get("browse", [])
	var post: Dictionary = page._posts[int(browse[0])]
	var changed := [0]
	page.library_changed.connect(func() -> void: changed[0] += 1)
	await page._import(post)
	_check(page._notice.begins_with("Imported \""), "import notice: %s" % page._notice.substr(0, 60))
	_check(page._status_of(post) == "current", "the post now says it is in the library")
	_check(changed[0] == 1, "the library is told it changed")
	_check(_has_text(page, "In your library") and _has_text(page, "Import again"), "badge and Import again")
	await _wait(1.0)
	await _shoot("c09-imported")
	if not page._missing_map.is_empty():
		_check(page._offers_slot.get_child_count() == 1, "the detailed-map offer shows after the import")
		await _shoot("c10-detailed-map-offer")
		page._finish_install()
	page._import(post)
	await _wait(0.3)
	_check(page._armed_id == int(post.get("id", 0)) and _has_text(page, "Import a second copy"), "a second Import asks first")
	page._select(post)
	await _wait(1.5)
	_check(_has_text(page, "▶ Play your copy"), "detail page plays the copy")
	main.menu._body.scroll_vertical = 2000
	await _wait(0.8)
	await _shoot("c11-detail-copy")
	main.menu._body.scroll_vertical = 0
	var updates := HubScenarioUpdates.new()
	main.add_child(updates)
	updates.setup(main.engine)
	await updates.refresh()
	_check(updates.reasons.is_empty(), "a current copy is offered no update")
	var copy := page._copy_of(post)
	var copy_id := str(copy.get("id", ""))
	_check(not copy_id.is_empty(), "the library names its copy of the post")
	await updates.update(copy_id)
	_check(str(updates.notes.get(copy_id, "")).is_empty() and not updates.is_updating(copy_id), "Update takes the post's file again")
	updates.queue_free()
	await main.engine.request("community.standin.downloads", {"on": false})
	var published: Dictionary = await main.engine.request("community.publish", {"scenarioId": "default"})
	_check(published.get("ok", false), "Publish builds the scenario's file (nothing is posted)")
	if published.get("ok", false):
		var result: Dictionary = published["result"]
		_check(FileAccess.file_exists(str(result.get("zipFile", ""))), "the .zip is written: %s" % str(result.get("fileName", "")))
		_check(str(result.get("notice", "")).begins_with("\"default-scenario.zip\""), "publish notice: %s" % str(result.get("notice", "")).substr(0, 70))
		_check(str(result.get("url", "")).begins_with("https://github.com/Open-Historia/Open-historia-scenarios/issues/new?template=scenario.yml&title="), "the prefilled post address")


func _suggestions() -> void:
	var folder := OS.get_environment("OH_NATIVE_ROOT").path_join("community-check")
	DirAccess.make_dir_recursive_absolute(folder)
	var file := folder.path_join("modern-day-suggestion.json")
	var suggestion := {
		"schema": "open-historia-scenario-suggestion/1",
		"id": "sug-native-check",
		"createdAt": "2026-10-26T12:00:00Z",
		"scenario": {"name": "Modern Day"},
		"by": "Native check",
		"note": "Two small changes, made for the native check.",
		"changes": [
			{"id": "meta:accentColor", "area": "details", "kind": "field", "path": ["meta", "accentColor"], "from": "#2bc1f3", "to": "#f97316"},
			{"id": "meta:subtitle", "area": "details", "kind": "field", "path": ["meta", "subtitle"], "text": true, "from": "", "to": "A subtitle the native check suggests."},
			{"id": "region-owner:test", "area": "map", "kind": "region-owner", "region": "test", "from": "France", "to": "Germany"},
		],
	}
	var handle := FileAccess.open(file, FileAccess.WRITE)
	handle.store_string(JSON.stringify(suggestion))
	handle.close()
	var card := ScenarioCommunityCard.new()
	card.setup(main.engine, {"scenario_id": "default", "host": main})
	_mount_menu_page("scenarios", "Scenarios", card)
	await card.refresh()
	await _wait(0.4)
	_check(_has_text(card, "Open a suggestion file"), "community card offers a suggestion file")
	await _shoot("c12-community-card")
	var dialog := SuggestionReviewDialog.new()
	dialog.open_for(main.engine, "default", main, "", file)
	var ready := await _until(func() -> bool: return dialog._phase != "loading", 20.0)
	_check(ready and dialog._phase == "ready", "the suggestion file opens for review")
	await _wait(0.6)
	_check(_has_text(dialog, "CHANGES OUTSIDE THE MAP") and _has_text(dialog, "CHANGES ON THE MAP") and _has_text(dialog, "Who owns which region"), "review lists both kinds of change")
	_check(_has_text(dialog, "0 of 3 changes decided"), "review counts the changes")
	await _shoot("c13-review")
	await dialog._act("accept", ["meta:accentColor"])
	await _wait(0.5)
	_check(_has_text(dialog, "Accepted") and _has_text(dialog, "1 of 3 changes decided"), "accepting applies and records the change")
	await _shoot("c14-review-accepted")
	await dialog._act("undo", ["meta:accentColor"])
	await _wait(0.3)
	_check(_has_text(dialog, "0 of 3 changes decided"), "undo puts the change back")
	dialog.close()
	await _wait(0.4)
	var banner := SuggestionsBanner.new()
	banner.setup(main.engine)
	main.menu._page_root.add_child(banner)
	await banner.refresh(false)
	_check(not banner.visible, "no banner without suggestions on a post")
	banner.queue_free()
	card.queue_free()


func _lobbies(with_game: bool) -> void:
	var page := LobbiesPage.new()
	page.setup(main.engine, {})
	var host := page.make_host_button()
	_mount_menu_page("lobbies", "Lobbies", page, [host])
	await page.open()
	await _wait(0.8)
	_check(_has_text(page, "Join a private lobby") and _has_text(page, "Public lobbies") and _has_text(page, "Coming soon"), "lobbies page sections")
	_check(page._join_button.disabled, "Join is dimmed without WebRTC")
	if not with_game:
		await _shoot("l01-lobbies")
	host.pressed.emit()
	await _wait(1.0)
	_check(_has_text(page, "Host a lobby"), "host panel opens")
	if with_game:
		_check(_has_text(page, "ROUND LENGTH (MINUTES)") and _has_text(page, "Open the lobby"), "host form with a game open")
		var open := _find_button(page, "Open the lobby")
		_check(open != null and open.disabled, "Open the lobby is dimmed without WebRTC")
		await _shoot("l03-host-form")
		main.menu._body.scroll_vertical = 600
		await _wait(0.6)
		await _shoot("l04-host-form-bottom")
		main.menu._body.scroll_vertical = 0
	else:
		await _shoot("l02-host-no-game")


func _overlay() -> void:
	var overlay := SharedGameOverlay.new()
	main.ui.add_child(overlay)
	await overlay.setup(main.engine, {})
	_check(not overlay.visible, "no shared game, no overlay")
	var lobby := {
		"t": "lobby",
		"settings": {"v": 1, "name": "Weekend war", "seats": 8, "roundMinutes": 20, "readyThreshold": 0.6667, "countdownSeconds": 60, "minPlanningSeconds": 0, "afkSeconds": 0, "daysPerRound": 30, "leaverGraceMinutes": 5, "allowMidGameJoin": true, "cheats": "off", "payment": "host"},
		"scenario": {"id": "default", "name": "Modern Day", "hash": ""},
		"countries": ["France", "Germany", "Italy", "Spain"],
		"seats": [{"country": "France", "name": "Anna", "status": "human", "you": false}, {"country": "Germany", "name": "", "status": "ai", "you": false}],
		"started": false,
	}
	overlay.show_state({"mode": "lobby", "role": "guest", "token": "", "lobby": lobby, "round": null, "notices": [], "standIn": "ready", "error": "", "me": "", "stage": "", "people": [], "ownMapNote": "Until you are in, the map behind this box is your own game, not the host's.", "remainingMs": 0})
	await _wait(0.5)
	_check(_has_text(overlay, "Weekend war") and _has_text(overlay, "Choose your country…") and _has_text(overlay, "Take it"), "sample lobby renders (test-only state)")
	await _shoot("m01-overlay-lobby")
	lobby["started"] = true
	(lobby["seats"] as Array).append({"country": "Italy", "name": "You", "status": "human", "you": true})
	overlay.show_state({"mode": "playing", "role": "guest", "lobby": lobby, "round": {"t": "round", "phase": "planning", "round": 3, "remainingMs": 754000, "paused": false, "ready": ["France"], "counted": 2, "needed": 2}, "notices": [], "me": "Italy", "remainingMs": 754000})
	await _wait(0.6)
	_check(_has_text(overlay, "Round 3 · Planning") and _has_text(overlay, "I'm ready"), "sample round bar renders (test-only state)")
	await _shoot("m02-overlay-round")
	overlay.show_state({"mode": "off"})
	_check(not overlay.visible, "overlay hides again")
	overlay.queue_free()


func _finish(code: int) -> void:
	_say("failures: %d" % failures.size())
	for failure in failures:
		_say("  - " + failure)
	main.engine.stop()
	await _frames(2)
	quit(code)
