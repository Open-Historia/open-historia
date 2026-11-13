extends SceneTree

var main: Node
var shots := ""
var started := 0
var failures: PackedStringArray = []
var requests: PackedStringArray = []


class Spy extends EngineLink:
	var real: EngineLink
	var seen: PackedStringArray

	func request(method: String, args: Dictionary = {}) -> Dictionary:
		seen.append(method)
		return await real.request(method, args)


func _initialize() -> void:
	var redraw := Node2D.new()
	root.add_child(redraw)
	process_frame.connect(redraw.queue_redraw)
	shots = OS.get_environment("OH_SHOTS")
	started = Time.get_ticks_msec()
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.add_child(main)
	_run.call_deferred()


func _say(text: String) -> void:
	print("[phone-pages %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _wait(seconds: float) -> void:
	await create_timer(seconds).timeout


func _shoot(name: String) -> void:
	for i in range(4):
		await process_frame
	await RenderingServer.frame_post_draw
	if shots.is_empty():
		return
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(name + ".png"))
	_say("screenshot " + name)


func _check(ok: bool, what: String) -> void:
	_say(("PASS " if ok else "FAIL ") + what)
	if not ok:
		failures.append(what)


func _finish(code: int) -> void:
	_say("done: %d failure(s) %s" % [failures.size(), ", ".join(failures)])
	main.engine.stop()
	quit(code)


func _until(test: Callable, seconds: float) -> bool:
	var until := Time.get_ticks_msec() + int(seconds * 1000.0)
	while Time.get_ticks_msec() < until:
		if test.call():
			return true
		await process_frame
	return bool(test.call())


func _find(node: Node, test: Callable) -> Array:
	var found: Array = []
	if test.call(node):
		found.append(node)
	for child in node.get_children():
		found.append_array(_find(child, test))
	return found


func _shown(node: Node, kind: String) -> Array:
	return _find(node, func(item: Node) -> bool: return item.is_class(kind) and (item as CanvasItem).is_visible_in_tree())


func _button(node: Node, text: String) -> Button:
	for item in _shown(node, "Button"):
		var button := item as Button
		var words := str(button.text)
		if words.is_empty():
			var inner := _find(button, func(child: Node) -> bool: return child is Label)
			if not inner.is_empty():
				words = str((inner[0] as Label).text)
		if words == text:
			return button
	return null


func _label(node: Node, text: String) -> Control:
	for item in _find(node, func(child: Node) -> bool: return (child is Label or child is RichTextLabel) and (child as CanvasItem).is_visible_in_tree()):
		if str(item.get("text")).begins_with(text):
			return item
	return null


func _within(node: Control, view: Vector2) -> bool:
	var rect := node.get_global_rect()
	return rect.position.x >= -0.5 and rect.end.x <= view.x + 0.5


func _run() -> void:
	await process_frame
	_check(UI.phone(), "the phone layout is on")
	var view := root.get_visible_rect().size
	if not await _until(func() -> bool: return main.menu.visible and main.menu.loaded, 120.0):
		_check(false, "the menu appeared")
		_finish(1)
		return
	await _clear_shell()
	await _setup_part(view)
	await _notice_part(view)
	await _release_part(view)
	await _community_part(view)
	await _lobbies_part(view)
	_finish(0 if failures.is_empty() else 1)


func _setup_part(view: Vector2) -> void:
	var shell: ShellBoot = main.shell
	var setup: FirstSetup = shell.show_first_setup()
	await _until(func() -> bool: return not _find(setup, func(item: Node) -> bool: return item.has_meta("language")).is_empty(), 10.0)
	await _wait(1.0)
	var cards := _find(setup, func(item: Node) -> bool: return item.has_meta("language"))
	_check(cards.size() >= 2, "the setup lists the languages")
	if cards.size() >= 2:
		var first := cards[0] as Control
		var second := cards[1] as Control
		_check(absf(first.global_position.y - second.global_position.y) < 1.0 and second.global_position.x > first.global_position.x, "the languages stand two to a row")
		_check(absf(first.size.x - (view.x - 32.0 - 8.8) * 0.5) < 2.0, "a language card is half the page (%d)" % first.size.x)
	var hello: Array = _find(setup, func(item: Node) -> bool: return item is Label and item.get_parent().has_meta("greeting"))
	if not hello.is_empty():
		_check(absi((hello[0] as Label).get_theme_font_size("font_size") - 45) <= 1, "the greeting is beta's phone size (%d)" % (hello[0] as Label).get_theme_font_size("font_size"))
	await _shoot("phone-setup-language")
	setup.call("_choose", "en")
	await _until(func() -> bool: return _label(setup, "Choose your theme") != null, 10.0)
	await _wait(1.0)
	var themes := _find(setup, func(item: Node) -> bool: return item.has_meta("theme_id"))
	_check(themes.size() == 6, "six themes")
	if themes.size() >= 2:
		_check(absf((themes[0] as Control).global_position.y - (themes[1] as Control).global_position.y) < 1.0, "the themes stand two to a row")
	var back := _button(setup, "Back")
	var go := _button(setup, "Continue")
	_check(back != null and go != null and absf(back.size.x - go.size.x) < 2.0 and back.size.x > view.x * 0.4, "Back and Continue share the row")
	await _shoot("phone-setup-theme")
	if go:
		go.pressed.emit()
	await _until(func() -> bool: return shell.first_setup == null, 5.0)
	UiTheme.reset()
	await _wait(0.5)


func _notice_part(view: Vector2) -> void:
	var reply: Dictionary = await main.engine.request("shell.updates")
	var updates: Array = (reply.get("result", {}) as Dictionary).get("updates", []) if reply.get("ok", false) else []
	var themed := {}
	var minor := {}
	for item in updates:
		var update: Dictionary = item
		if str(update.get("id", "")) == "2026-11-themes":
			themed = update
		elif minor.is_empty() and str(update.get("kind", "")) == "minor":
			minor = update
	_check(not themed.is_empty(), "the themes notice is there")
	var shown: Array = [themed]
	if not minor.is_empty():
		shown.append(minor)
	var notice := UpdateNotice.new()
	main.shell.overlay.add_child(notice)
	await notice.setup(main.engine, shown, {"reduceMotion": true})
	await _wait(1.2)
	var column := notice.get("_column") as Control
	_check(column != null and column.size.x <= view.x - 32.0 + 0.5, "the notice keeps 1rem from the phone's sides (%d)" % (column.size.x if column else 0))
	await _shoot("phone-notice-1")
	var scroll := notice.get("_scroll") as ScrollContainer
	if scroll:
		scroll.scroll_vertical = 100000
		await _wait(0.4)
		await _shoot("phone-notice-1-end")
	if notice.page_count() > 1:
		notice.show_page(notice.page_count() - 1)
		await _wait(0.8)
		await _shoot("phone-notice-2")
	notice.queue_free()
	await _wait(0.4)
	await _ai_notice(view, updates)
	await _changelog(view, updates)
	await _prompt_limit(view)


func _prompt_limit(view: Vector2) -> void:
	var notice := PromptLimitNotice.new()
	main.shell.overlay.add_child(notice)
	await _wait(0.2)
	notice.add_entries([{"id": "jump-a", "sectionLabel": "Time skip", "segmentLabel": "Event writing"}, {"id": "advisor-b", "sectionLabel": "Advisor", "segmentLabel": "Tone and voice"}])
	await _wait(0.6)
	var panel := notice.get("_panel") as Control
	var r := panel.get_global_rect()
	_check(r.position.x >= 15.5 and r.end.x <= view.x - 15.5, "the prompt limit notice keeps 1rem from the phone's sides (%s)" % str(r))
	_check(absf(r.position.y - 4.75 * 16.0) < 1.0, "on a phone it hangs 4.75rem from the top")
	var dismiss := _button(notice, "×")
	_check(dismiss != null and dismiss.size.x >= 43.5 and dismiss.size.y >= 43.5, "its × is a 44 px target")
	await _shoot("phone-prompt-limit")
	notice.queue_free()
	await _wait(0.3)


func _ai_notice(view: Vector2, updates: Array) -> void:
	var overhaul := {}
	for item in updates:
		for banner in (item as Dictionary).get("banners", []):
			if str((banner as Dictionary).get("theme", "")) == "aiOverhaul":
				overhaul = item
	_check(not overhaul.is_empty(), "the AI overhaul notice is there")
	if overhaul.is_empty():
		return
	var notice := UpdateNotice.new()
	main.shell.overlay.add_child(notice)
	await notice.setup(main.engine, [overhaul], {"reduceMotion": true})
	await _wait(1.2)
	var column := notice.get("_column") as Control
	_check(column != null and column.size.x <= view.x - 32.0 + 0.5, "the AI overhaul notice keeps 1rem from the phone's sides (%d)" % (column.size.x if column else 0))
	_check(_rightmost(notice) <= view.x + 0.5, "nothing in the AI overhaul notice runs off the phone (%.1f)" % _rightmost(notice))
	await _shoot("phone-notice-ai")
	var scroll := notice.get("_scroll") as ScrollContainer
	if scroll:
		scroll.scroll_vertical = 100000
		await _wait(0.4)
		await _shoot("phone-notice-ai-end")
	notice.queue_free()
	await _wait(0.4)


func _changelog(view: Vector2, updates: Array) -> void:
	var minors := updates.filter(func(update: Variant) -> bool: return update is Dictionary and str((update as Dictionary).get("kind", "")) == "minor" and not ((update as Dictionary).get("banners", []) as Array).is_empty()).slice(0, 3)
	_check(minors.size() == 3, "three minor updates to show together")
	if minors.size() < 3:
		return
	var notice := UpdateNotice.new()
	main.shell.overlay.add_child(notice)
	await notice.setup(main.engine, minors, {"reduceMotion": true})
	await _wait(1.2)
	var pages: Array = notice.get("_pages")
	_check(pages.size() == 1 and (pages[0] as Dictionary).has("changelog"), "three minor updates are one changelog card")
	var column := notice.get("_column") as Control
	_check(column != null and column.size.x <= view.x - 32.0 + 0.5, "the changelog keeps 1rem from the phone's sides (%d)" % (column.size.x if column else 0))
	_check(_rightmost(notice) <= view.x + 0.5, "nothing in the changelog runs off the phone (%.1f)" % _rightmost(notice))
	await _shoot("phone-changelog")
	var scroll := notice.get("_scroll") as ScrollContainer
	if scroll:
		scroll.scroll_vertical = 100000
		await _wait(0.4)
		await _shoot("phone-changelog-end")
	notice.queue_free()
	await _wait(0.4)


func _rightmost(node: Node) -> float:
	var most := 0.0
	for child in node.get_children():
		if child is Control and (child as Control).is_visible_in_tree() and child.get_parent() is Container:
			most = maxf(most, (child as Control).get_global_rect().end.x)
		if not (child is ScrollContainer and (child as ScrollContainer).horizontal_scroll_mode != ScrollContainer.SCROLL_MODE_DISABLED):
			most = maxf(most, _rightmost(child))
	return most


func _release_part(view: Vector2) -> void:
	var page := ReleaseNotice.new()
	main.shell.overlay.add_child(page)
	await page.open(main.engine, "", true)
	await _until(page.is_settled, 30.0)
	await _wait(0.6)
	_check(str(page.release.get("version", "")) == "2.5.0", "the release page reads 2.5.0")
	_check(bool(page.get("_narrow")) if page.get("_narrow") != null else float(page.get("_vw")) < 760.0, "the release page takes its phone layout")
	var skip := _find(page, func(item: Node) -> bool: return item is Button and str((item as Button).text).to_upper() == "SKIP")
	if not skip.is_empty():
		var at := (skip[0] as Control).get_global_rect()
		_check(at.end.x <= view.x and at.position.y >= UI.safe_insets().y, "Skip sits inside the phone, clear of the notch")
	await _shoot("phone-release")
	var scroll := page.get("_scroll") as ScrollContainer
	var vh: float = page.get("_vh")
	scroll.scroll_vertical = int(vh * 2.1)
	await _wait(0.8)
	await _until(page.is_settled, 30.0)
	await _shoot("phone-release-intro")
	var sections: Array = page.get("_chapters")
	if not sections.is_empty():
		scroll.scroll_vertical = int((sections[0] as Control).position.y + vh * 0.5 + vh * 0.95 * 0.5)
		await _wait(0.8)
		await _until(page.is_settled, 30.0)
		await _shoot("phone-release-chapter")
	page.close()
	page.queue_free()
	await _wait(0.4)


func _community_part(view: Vector2) -> void:
	var menu: Control = main.menu
	menu.call("_show_page", "community")
	var page := menu.get("_community") as Control
	await _until(func() -> bool: return is_instance_valid(page) and bool(page.get("_loaded")) and not (page.get("_browse") as Dictionary).is_empty(), 60.0)
	await _wait(3.0)
	var root_page := menu.get("_page_root") as Control
	_check(root_page.size.x <= view.x - 25.6 + 0.5, "the Community page fits the phone (%d)" % root_page.size.x)
	var settings := _button(root_page, "Settings")
	_check(settings != null and _within(settings, view) and settings.size.x > view.x - 30.0, "Settings spans the page's width")
	for caption in ["Refresh", "⬆ Publish to Hub", "Open Hub ↗"]:
		var button := _button(root_page, caption)
		_check(button != null and _within(button, view) and button.size.y >= 43.5, "%s is on the phone, finger-high" % caption)
	var search := _find(root_page, func(item: Node) -> bool: return item is LineEdit and (item as LineEdit).placeholder_text == "Search scenarios…")
	_check(not search.is_empty() and _within(search[0], view), "the search is on the phone")
	var cards := _find(root_page, func(item: Node) -> bool: return item is PanelContainer and (item as Control).mouse_default_cursor_shape == Control.CURSOR_POINTING_HAND and (item as Control).is_visible_in_tree() and (item as Control).size.x > 250.0)
	var featured := root_page.find_child("Featured", true, false) as ScrollContainer
	if featured and featured.get_child_count() > 0:
		var line := _find(featured, func(item: Node) -> bool: return item is HBoxContainer)
		if not line.is_empty() and (line[0] as Control).get_child_count() > 0:
			var first := (line[0] as Control).get_child(0) as Control
			_check(absf(first.size.x - minf(336.0, view.x - 32.0)) < 1.5, "a Featured card is beta's phone width (%d)" % first.size.x)
		_check(featured.horizontal_scroll_mode == ScrollContainer.SCROLL_MODE_SHOW_NEVER, "the Featured row swipes without a scrollbar")
	var browse := _label(root_page, "Browse Community")
	var newest := _button(root_page, "Newest")
	if browse and newest:
		_check(newest.global_position.y > browse.global_position.y + 30.0 and _within(newest, view), "the sort pills sit under Browse Community")
	var wide := 0
	for card in cards:
		if (card as Control).size.x > view.x - 30.0:
			wide += 1
	_check(wide >= 1, "the browse cards fill the page's width")
	await _shoot("phone-community")
	var body := menu.get("_body") as ScrollContainer
	if browse:
		body.scroll_vertical = int(browse.global_position.y - body.global_position.y + body.scroll_vertical - 40.0)
		await _wait(1.5)
		await _shoot("phone-community-p2")
		body.scroll_vertical += 520
		await _wait(1.5)
		await _shoot("phone-community-p3")
	body.scroll_vertical = 0


func _lobbies_part(view: Vector2) -> void:
	var menu: Control = main.menu
	var tabs: Dictionary = menu.get("_tiles")
	_check(tabs.has("lobbies") and (tabs["lobbies"] as Control).is_visible_in_tree(), "the Lobbies tab is back on a phone")
	for key in tabs:
		var each := tabs[key] as Button
		_say("tab %s at %d wide %d min %s font %s" % [key, each.global_position.x, each.size.x, each.get_combined_minimum_size(), (each.get_theme_font("font") as SystemFont).font_names if each.get_theme_font("font") is SystemFont else "?"])
	if tabs.has("lobbies"):
		var tab := tabs["lobbies"] as Control
		_check(tab.get_global_rect().end.x <= view.x + 0.5, "the four tabs fit across the phone")
	var spy := Spy.new()
	spy.real = main.engine
	spy.seen = requests
	menu.set("engine", spy)
	menu.call("_show_page", "lobbies")
	await _wait(2.0)
	menu.set("engine", main.engine)
	var page := menu.get("_page_root") as Control
	var lobby_calls := Array(spy.seen).filter(func(name: String) -> bool: return name.begins_with("multiplayer."))
	_check(lobby_calls.is_empty(), "the Lobbies page starts no multiplayer work (%s)" % ", ".join(PackedStringArray(lobby_calls)))
	var host := _button(page, "Host a lobby")
	var settings := _button(page, "Settings")
	_check(host != null and settings != null and absf(host.global_position.y - settings.global_position.y) < 1.0, "Settings and Host a lobby head the page side by side")
	_check(host != null and host.disabled, "Host a lobby is off")
	var join := _button(page, "Join")
	_check(join != null and join.disabled, "Join is off")
	var fields := _find(page, func(item: Node) -> bool: return item is LineEdit and (item as LineEdit).is_visible_in_tree() and (item as LineEdit).placeholder_text in ["oh1-…", "Player"])
	_check(fields.size() == 2 and not (fields[0] as LineEdit).editable and not (fields[1] as LineEdit).editable, "the invite code and name are read-only")
	if fields.size() == 2:
		_check((fields[1] as Control).global_position.y > (fields[0] as Control).global_position.y + 20.0, "the name sits under the invite code")
		if join:
			_check(absf(join.get_global_rect().end.y - (fields[1] as Control).get_global_rect().end.y) < 2.0, "Join stands beside the name")
	_check(_label(page, "Multiplayer is not available in the phone app yet.") != null, "the page says multiplayer is not on phones yet")
	_check(_label(page, "Public lobbies") != null and _label(page, "Coming soon") != null, "Public lobbies, Coming soon")
	_check(page.size.x <= view.x - 25.6 + 0.5, "the Lobbies page fits the phone (%d)" % page.size.x)
	await _shoot("phone-lobbies")
	var lobbies := menu.get("_lobbies") as Control
	if host:
		host.pressed.emit()
	await _wait(0.5)
	_check(is_instance_valid(lobbies) and not bool(lobbies.get("hosting")), "Host a lobby opens nothing")
	_check(Array(spy.seen).filter(func(name: String) -> bool: return name.begins_with("multiplayer.")).is_empty(), "and still no multiplayer work")


func _clear_shell() -> void:
	var shell := main.get("shell") as ShellBoot
	if shell == null:
		return
	await _wait(1.0)
	var setup: Variant = shell.get("first_setup")
	if setup is FirstSetup and is_instance_valid(setup):
		(setup as FirstSetup).finished.emit()
		await _wait(0.8)
	if shell.door_state == "deciding":
		await _until(func() -> bool: return shell.door_state != "deciding", 60.0)
	if shell.door != null and is_instance_valid(shell.door):
		shell.door.opened.emit()
		await _until(func() -> bool: return shell.door == null, 10.0)
	if not shell.notice_updates.is_empty():
		await _until(func() -> bool: return shell.notice != null and is_instance_valid(shell.notice), 5.0)
		if shell.notice != null and is_instance_valid(shell.notice):
			shell.notice.closed.emit()
	await _wait(0.5)
