extends SceneTree

var main: Node
var shots := ""
var started := 0
var failures: PackedStringArray = []
var finished := false
var taken: PackedStringArray = []


func _initialize() -> void:
	var redraw := Node2D.new()
	root.add_child(redraw)
	process_frame.connect(redraw.queue_redraw)
	shots = OS.get_environment("OH_SHOTS")
	started = Time.get_ticks_msec()
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.mouse_passthrough = true
	root.add_child(main)
	_watchdog.call_deferred()
	_run.call_deferred()


func _watchdog() -> void:
	await create_timer(1500.0).timeout
	if not finished:
		_say("FAIL the check did not finish in time")
		_finish(1)


func _say(text: String) -> void:
	print("[beta_pairs %6d ms] %s" % [Time.get_ticks_msec() - started, text])


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


func _until(condition: Callable, seconds: float) -> bool:
	var deadline := Time.get_ticks_msec() + int(seconds * 1000.0)
	while Time.get_ticks_msec() < deadline:
		if condition.call():
			return true
		await process_frame
	return condition.call()


func _pair(name: String) -> void:
	await _frames(4)
	await RenderingServer.frame_post_draw
	if shots.is_empty():
		return
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(name + "-1x.png"))
	var before := root.size
	root.size = before * 2
	root.content_scale_factor = 2.0
	await _frames(10)
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(name + "-2x.png"))
	root.size = before
	root.content_scale_factor = 1.0
	await _frames(6)
	taken.append(name)
	_say("pair " + name)


func _find_all(node: Node, test: Callable, into: Array) -> Array:
	if node == null or node.is_queued_for_deletion():
		return into
	if test.call(node):
		into.append(node)
	for child in node.get_children():
		_find_all(child, test, into)
	return into


func _button(node: Node, wanted: String) -> Button:
	var found := _find_all(node, func(item: Node) -> bool: return item is Button and (item as Button).text == wanted and (item as Button).is_visible_in_tree(), [])
	return found[0] if not found.is_empty() else null


func _label(node: Node, wanted: String) -> Control:
	var found := _find_all(node, func(item: Node) -> bool: return item is Label and (item as Label).text == wanted and (item as Label).is_visible_in_tree(), [])
	return found[0] if not found.is_empty() else null


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


func _cover_gone() -> void:
	var shell: Variant = main.get("shell")
	if shell == null or shell.get("loading") == null:
		return
	var deadline := Time.get_ticks_msec() + 90000
	while (shell.loading as GameLoadingScreen).is_open() and Time.get_ticks_msec() < deadline:
		await process_frame
	await _wait(0.5)


func _france_view() -> void:
	await _view(2.6, 46.6, 4.6)


func _view(lon: float, lat: float, level: float) -> void:
	var view: MapView = main.map_view
	var x := (lon + 180.0) / 360.0 * MapView.WORLD_WIDTH
	var y := (0.5 - log(tan(PI / 4.0 + deg_to_rad(lat) / 2.0)) / (2.0 * PI)) * MapView.WORLD_WIDTH
	view.camera.zoom = Vector2.ONE * (512.0 * pow(2.0, level) / MapView.WORLD_WIDTH)
	view.camera.position = Vector2(x, y)
	view._after_camera_move()
	await _wait(1.2)


func _close_all() -> void:
	main.hud.close_drawer()
	main.hud.map_cards.dismiss_all()
	main.hud.set_active_panel("")
	await _wait(0.6)


func _run() -> void:
	while not main.menu.visible:
		if Time.get_ticks_msec() - started > 90000:
			_say("FAIL the menu never appeared")
			_finish(1)
			return
		await process_frame
	await _clear_shell()
	await main._start_scenario("default")
	main.picker._choose("France")
	await main._on_country_chosen("France", "medium")
	await _until(func() -> bool: return main.hud.drawers.has("country") and main.hud.map_cards != null, 20.0)
	await _cover_gone()
	var fixture: Variant = JSON.parse_string(FileAccess.get_file_as_string("res://tests/beta_fixture.json"))
	_check(typeof(fixture) == TYPE_DICTIONARY, "the beta fixture is read")
	var merged: Dictionary = await main.engine.request("country.standin_merge", fixture if typeof(fixture) == TYPE_DICTIONARY else {})
	_check(merged.get("ok", false), "the beta fixture is merged into the world and the advisor")
	await _france_view()
	await _pair("map-hud")
	await _map_shots("France", "france", "Auvergne-Rhône-Alpes")
	await _map_shots("Germany", "germany", "")
	await _country_shots("France", "france")
	await _country_shots("Germany", "germany")
	await _advisor_shots()
	_say("pairs: %d" % taken.size())
	_say("done: %d failure(s) %s" % [failures.size(), ", ".join(failures)])
	_finish(0 if failures.is_empty() else 1)


func _region_index(owner: String, preferred: String) -> int:
	var view: MapView = main.map_view
	var best := -1
	var area := -1.0
	for index in range(view._names.size()):
		if view.region_owner(index) != owner:
			continue
		if not preferred.is_empty() and view.region_name(index) == preferred:
			return index
		if view._areas[index] > area:
			area = view._areas[index]
			best = index
	return best


func _map_shots(country: String, slug: String, region: String) -> void:
	await _close_all()
	var view: MapView = main.map_view
	if country == "France":
		await _france_view()
	else:
		await _view(10.448, 51.36, 5.414)
	var cards = main.hud.map_cards
	var at := Vector2(618, 449)
	var index: int = view.baker.pick(view.screen_to_world(at))
	if index < 0 or view.region_owner(index) != country:
		index = _region_index(country, region)
		at = view.world_to_screen(view._centroids[index])
	_check(index >= 0, "a region of %s under the point beta clicks" % country)
	view.select_region(index)
	await cards.show_region(index, view.region_name(index), view.region_owner(index), at)
	await _wait(1.0)
	await _pair("map-region-popup-%s" % slug)
	await cards._open_country_from_region()
	await _wait(1.5)
	var info_scroll: ScrollContainer = cards._info_body.get_parent().get_parent()
	await _pages("map-country-intel-%s" % slug, info_scroll)
	await _close_all()


func _pages(name: String, scroll: ScrollContainer) -> void:
	var step := maxi(120, int(floor(scroll.size.y * 0.85)))
	scroll.scroll_vertical = 0
	var page := 1
	while true:
		await _wait(0.35)
		await _pair("%s-p%d" % [name, page])
		var bar := scroll.get_v_scroll_bar()
		var top := scroll.scroll_vertical
		var most := int(bar.max_value - bar.page)
		if top >= most - 2 or page >= 12:
			break
		scroll.scroll_vertical = mini(most, top + step)
		page += 1
	scroll.scroll_vertical = 0
	await _frames(3)


func _top(scroll: ScrollContainer) -> void:
	scroll.scroll_vertical = 0
	await _frames(3)


func _scroll_to(scroll: ScrollContainer, control: Control, offset := 12.0) -> void:
	if control == null:
		return
	var delta := control.get_global_rect().position.y - scroll.get_global_rect().position.y - offset
	scroll.scroll_vertical = maxi(0, scroll.scroll_vertical + int(round(delta)))
	await _frames(4)


func _ledger_head(panel: Node, title: String) -> Control:
	var words := _label(panel.get("body"), title)
	if words == null:
		return null
	return words.get_parent().get_parent() as Control


func _open_tab(panel: Node, country: String, tab: String) -> void:
	if not panel.is_open() or panel.target != country:
		await main.hud.show_country(country)
		await _until(func() -> bool: return panel.target == country and not panel.data.is_empty(), 20.0)
		await _wait(1.0)
	if panel.tab != tab:
		await panel.set_tab(tab)
	if tab == "economy":
		await _until(func() -> bool: return panel.sheet_status == "ready" or panel.sheet_status == "error", 120.0)
		await _until(func() -> bool: return typeof(panel.data.get("military")) == TYPE_DICTIONARY and str((panel.data.get("military") as Dictionary).get("power", "—")) != "—", 20.0)
	if tab == "ranking":
		await _until(func() -> bool: return not panel.ranking.is_empty(), 20.0)
	await _wait(0.9)


func _view_button(panel: Node, view: String) -> Button:
	var found := _find_all(panel.get("body"), func(node: Node) -> bool: return node is Button and str(node.get_meta("view", "")) == view and (node as Button).is_visible_in_tree(), [])
	return found[0] if not found.is_empty() else null


func _country_shots(country: String, slug: String) -> void:
	await _close_all()
	if country == "France":
		await _france_view()
	else:
		await _view(10.448, 51.36, 5.414)
	var panel = main.hud.drawers["country"]
	await _open_tab(panel, country, "politics")
	await _until(func() -> bool: return not str((panel.data.get("header", {}) as Dictionary).get("place", "")).is_empty(), 30.0)
	await _wait(0.5)
	var scroll: ScrollContainer = panel.scroll
	await _pages("country-%s-politics" % slug, scroll)
	var more := _find_all(panel.body, func(node: Node) -> bool: return node is Button and (node as Button).text.begins_with("Show all (") and (node as Button).is_visible_in_tree(), [])
	if not more.is_empty():
		(more[0] as Button).pressed.emit()
		await _wait(0.4)
		scroll.scroll_vertical = int(scroll.get_v_scroll_bar().max_value)
		await _frames(4)
		await _pair("country-%s-politics-institutions-all" % slug)
		var fewer := _button(panel.body, "Show fewer")
		if fewer:
			fewer.pressed.emit()
			await _wait(0.4)
	var views: Variant = (panel.data.get("politics", {}) as Dictionary).get("landscapes")
	var parties: Variant = (views as Dictionary).get("parties") if typeof(views) == TYPE_DICTIONARY else null
	if typeof(parties) == TYPE_DICTIONARY and not ((parties as Dictionary).get("entries", []) as Array).is_empty():
		var first := str((((parties as Dictionary).get("entries", []) as Array)[0] as Dictionary).get("id", ""))
		panel._pick_party(first)
		await _wait(0.4)
		var switch_button := _view_button(panel, "parties")
		await _scroll_to(scroll, switch_button.get_parent().get_parent() if switch_button else null)
		await _pair("country-%s-politics-party-open" % slug)
		panel._pick_party(first)
		await _wait(0.3)
	var blocs_button := _view_button(panel, "blocs")
	if blocs_button:
		blocs_button.pressed.emit()
		await _wait(0.5)
		await _pages("country-%s-politics-blocs" % slug, scroll)
		var blocs: Dictionary = (panel.data.get("politics", {}) as Dictionary).get("landscapes", {}).get("blocs", {})
		var first_bloc := str(((blocs.get("entries", []) as Array)[0] as Dictionary).get("id", "")) if not (blocs.get("entries", []) as Array).is_empty() else ""
		panel._pick_party(first_bloc)
		await _wait(0.4)
		var ledger := _find_all(panel.body, func(node: Node) -> bool: return node is PanelContainer and node.has_meta("bloc"), [])
		await _scroll_to(scroll, ledger[0] if not ledger.is_empty() else null, 60.0)
		await _pair("country-%s-politics-bloc-open" % slug)
		panel._pick_party(first_bloc)
		await _wait(0.3)
		var parties_button := _view_button(panel, "parties")
		if parties_button:
			parties_button.pressed.emit()
			await _wait(0.4)
	await _open_tab(panel, country, "diplomacy")
	await _pages("country-%s-diplomacy" % slug, scroll)
	if is_instance_valid(panel._relation_field):
		panel._relation_field.grab_focus()
		panel._relation_field.text = "an"
		await panel._search_relations("an")
		await _wait(0.5)
		await _top(scroll)
		await _pair("country-%s-diplomacy-search" % slug)
		panel._relation_field.text = "zz"
		await panel._search_relations("zz")
		await _wait(0.4)
		await _pair("country-%s-diplomacy-search-none" % slug)
		panel._relation_field.text = ""
		await panel._search_relations("")
		for sort in ["weakest", "alphabetical", "strongest"]:
			var orders := _find_all(panel.body, func(node: Node) -> bool: return node is OptionButton and (node as OptionButton).is_visible_in_tree(), [])
			if not orders.is_empty():
				var order: OptionButton = orders[0]
				for at in range(order.item_count):
					if str(order.get_item_metadata(at)) == sort:
						order.select(at)
						order.item_selected.emit(at)
			await _wait(0.5)
			await _top(scroll)
			await _pair("country-%s-diplomacy-sort-%s" % [slug, sort])
		var rows: Array = (panel._roster as Dictionary).get("rows", [])
		if not rows.is_empty():
			var key := str((rows[0] as Dictionary).get("rosterKey", ""))
			root.gui_release_focus()
			panel._toggle_relation(key)
			await _wait(0.3)
			await _top(scroll)
			await _pair("country-%s-diplomacy-row-open" % slug)
			panel._toggle_relation(key)
	await _open_tab(panel, country, "economy")
	await _pages("country-%s-economy" % slug, scroll)
	await _open_tab(panel, country, "ranking")
	await _pages("country-%s-ranking" % slug, scroll)
	await _pick_metric(panel, "gdp")
	await _pair("country-%s-ranking-economy" % slug)
	await _pick_metric(panel, "regions")
	await _close_all()


func _pick_metric(panel: Node, key: String) -> void:
	var selects := _find_all(panel.get("body"), func(node: Node) -> bool: return node is OptionButton and (node as OptionButton).is_visible_in_tree(), [])
	if selects.is_empty():
		return
	var select: OptionButton = selects[0]
	for at in range(select.item_count):
		if str(select.get_item_metadata(at)) == key:
			select.select(at)
			select.item_selected.emit(at)
	await _until(func() -> bool: return str(panel.ranking.get("metric", "")) == key, 15.0)
	await _wait(0.6)


func _advisor_shots() -> void:
	await _close_all()
	await _france_view()
	var advisor: AdvisorPanel = main.hud.drawers["advisor"]
	main.hud.open_drawer_named("advisor")
	await _until(func() -> bool: return advisor._has_bootstrapped, 30.0)
	await _wait(1.5)
	if advisor.active_thread != "chief":
		await advisor._select_recipient("chief")
	advisor._recipients_open = false
	advisor._render_recipients()
	await _wait(0.6)
	await _pages("advisor-conversation", advisor.scroll)
	advisor.scroll.scroll_vertical = int(advisor.scroll.get_v_scroll_bar().max_value)
	await _wait(0.4)
	await _pair("advisor-picker-closed")
	var discuss := _find_all(advisor.body, func(node: Node) -> bool: return node is Button and (node as Button).text == "Discuss" and (node as Button).is_visible_in_tree(), [])
	if not discuss.is_empty():
		var card: Control = (discuss[0] as Control)
		var middle := card.get_global_rect().get_center().y - advisor.scroll.get_global_rect().get_center().y
		advisor.scroll.scroll_vertical = maxi(0, advisor.scroll.scroll_vertical + int(middle))
		await _wait(0.3)
	await _pair("advisor-action-proposal")
	advisor._input.text = "Could the Strasbourg office also buy for the Belgians and the Dutch?"
	advisor._resize_input()
	advisor._update_send()
	await _pair("advisor-composer-draft")
	advisor._input.text = ""
	advisor._resize_input()
	advisor._update_send()
	discuss = _find_all(advisor.body, func(node: Node) -> bool: return node is Button and (node as Button).text == "Discuss" and (node as Button).is_visible_in_tree(), [])
	if not discuss.is_empty():
		(discuss[0] as Button).pressed.emit()
		await _wait(0.5)
	await _pair("advisor-action-discuss")
	advisor._input.text = ""
	advisor._resize_input()
	advisor._update_send()
	root.gui_release_focus()
	advisor._recipients_open = true
	advisor._render_recipients()
	await _wait(0.4)
	var shown := _button(advisor, "Show retired contacts")
	if shown:
		shown.pressed.emit()
		await _wait(0.4)
	await _pair("advisor-picker-open")
	await _pair("advisor-picker-open-retired")
	var steinmeier := _contact(advisor, "Frank-Walter Steinmeier")
	advisor._recipient_confirm = str(steinmeier.get("id", ""))
	advisor._recipient_error = ""
	advisor._render_recipients()
	await _wait(0.4)
	await _pair("advisor-retire-confirm")
	advisor._recipient_confirm = ""
	advisor._render_recipients()
	await _wait(0.3)
	advisor._open_recipient_editor(_contact(advisor, "Jean-Yves Le Drian"))
	await _wait(0.4)
	await _editor_pages(advisor, "advisor-contact-edit")
	advisor._open_chief_editor()
	await _wait(0.4)
	await _editor_pages(advisor, "advisor-chief-edit")
	advisor._recipient_editor = ""
	advisor._render_recipients()
	advisor._open_recipient_editor({})
	await _wait(0.4)
	await _editor_pages(advisor, "advisor-contact-add")
	var offices: Array = advisor.offices
	if not offices.is_empty():
		var office: Dictionary = offices[0]
		advisor._recipient_draft["name"] = str(office.get("name", ""))
		advisor._recipient_draft["title"] = str(office.get("title", ""))
		advisor._recipient_draft["binding"] = (office.get("binding", {}) as Dictionary).duplicate()
		advisor._recipient_draft["officeKey"] = str((office.get("binding", {}) as Dictionary).get("office", ""))
		advisor._render_recipients()
		await _wait(0.4)
		await _editor_pages(advisor, "advisor-contact-add-linked")
	advisor._recipient_draft["recipientType"] = "foreign-official"
	advisor._recipient_draft["binding"] = null
	advisor._recipient_draft["officeKey"] = ""
	advisor._render_recipients()
	await _wait(0.4)
	await _editor_pages(advisor, "advisor-contact-add-foreign")
	advisor._recipient_editor = ""
	advisor._recipients_open = false
	advisor._render_recipients()
	await advisor._select_recipient(str(steinmeier.get("id", "")))
	await _wait(1.0)
	await _pair("advisor-contact-foreign-empty")
	await advisor._select_recipient(str(_contact(advisor, "Michel Sapin").get("id", "")))
	await _wait(1.0)
	advisor.scroll.scroll_vertical = 0
	await _wait(0.3)
	await _pair("advisor-retired-contact")
	advisor.scroll.scroll_vertical = int(advisor.scroll.get_v_scroll_bar().max_value)
	await _wait(0.3)
	await _pair("advisor-retired-contact-bottom")
	await advisor._select_recipient("chief")
	await _close_all()


func _contact(advisor: AdvisorPanel, name: String) -> Dictionary:
	for item in advisor.contacts:
		if str((item as Dictionary).get("name", "")) == name:
			return item
	return {}


func _editor_pages(advisor: AdvisorPanel, name: String) -> void:
	await _frames(4)
	var list: ScrollContainer = advisor._recipient_list
	if list == null or not is_instance_valid(list):
		await _pair("%s-p1" % name)
		return
	await _pages(name, list)


func _finish(code: int) -> void:
	if finished:
		return
	finished = true
	main.engine.stop()
	await _frames(2)
	quit(code)
