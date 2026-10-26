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
	await _community()
	_finish(0 if failures.is_empty() else 1)


func _community() -> void:
	var page := CommunityPage.new()
	page.setup(main.engine, {})
	_mount_menu_page("community", "Community", page)
	page.open()
	await _frames(2)
	await _shoot("c01-loading")
	var loaded := await _until(func() -> bool: return page._loaded and not page._browse.is_empty(), 30.0)
	_check(loaded, "the hub's posts load")
	_check(page._posts.size() > 0, "posts listed: %d" % page._posts.size())
	await _wait(4.0)
	_check(_has_text(page, "Browse Community") and _has_text(page, "One catalog, sorted the way you want."), "browse header")
	_check(_has_text(page, "📌 Featured"), "featured row")
	_check(_has_text(page, "Scenarios on the Hub are released under CC BY 4.0."), "licence line")
	_check(_has_text(page, "Most Installed") and _has_text(page, "Most Liked") and _has_text(page, "Newest"), "sort pills")
	await _shoot("c02-browse")
	main.menu._body.scroll_vertical = 900
	await _wait(1.0)
	await _shoot("c03-browse-scrolled")
	main.menu._body.scroll_vertical = 0
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
	await _shoot("c05-dates")
	page._clear.pressed.emit()
	await _wait(0.6)
	page._publish_open = true
	page._render()
	await _wait(0.5)
	_check(_has_text(page, "Everything you publish to the Hub is released under CC BY 4.0."), "publish picker licence")
	await _shoot("c06-publish-picker")
	page._publish_open = false
	page._render()
	var first: Dictionary = page._posts[int(page._browse["pinned"][0])] if not (page._browse.get("pinned", []) as Array).is_empty() else page._posts.values()[0]
	page._select(first)
	await _wait(3.0)
	_check(_has_text(page, "← Back") and _has_text(page, "▶ Import & Play"), "detail page buttons")
	_check(_has_text(page, "Likes and comments live on the scenario's GitHub post"), "detail note")
	await _shoot("c07-detail")
	page._back_to_grid()
	await _wait(0.5)


func _finish(code: int) -> void:
	_say("failures: %d" % failures.size())
	for failure in failures:
		_say("  - " + failure)
	main.engine.stop()
	await _frames(2)
	quit(code)
